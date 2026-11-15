import type { Request, Response } from 'express';
import fs from 'fs';
import fsp from 'fs/promises';
import path from 'path';
import crypto from 'crypto';
import { spawn } from 'child_process';

export type OfficialAssetKind = 'intro' | 'outro';
export type OfficialAssetTier = 'icloud_hydrated' | 'custom_uploaded' | 'fallback';

export interface OfficialAssetStatusEntry {
  tier: OfficialAssetTier;
  version: number;
  hydrating: boolean;
  hasMaster: boolean;
  hasWeb: boolean;
  hasPoster: boolean;
  error?: string;
}

export interface OfficialAssetsStatusPayload {
  ok: true;
  version: number;
  intro: OfficialAssetStatusEntry;
  outro: OfficialAssetStatusEntry;
}

export interface BoundedReadProbeResult {
  ok: boolean;
  timedOut: boolean;
  size: number;
  mtimeMs: number;
  error?: string;
}

interface ManifestAssetRecord {
  tier: OfficialAssetTier;
  version: number;
  updatedAt: string;
  fileName?: string;
  hasRealPoster?: boolean;
  sourceSize?: number;
  sourceMtimeMs?: number;
  lastError?: string;
}

interface OfficialAssetsManifest {
  intro: ManifestAssetRecord;
  outro: ManifestAssetRecord;
}

export interface OfficialAssetsManagerOptions {
  dataDir: string;
  introOutroIcloudDir?: string;
  getFfmpegBin: () => string;
  resolveOfficialLogoDataUrl?: () => string;
}

export type ExportAssetResolution =
  | {
      ok: true;
      filePath: string;
      tier: 'custom_uploaded' | 'icloud_hydrated_master' | 'icloud_hydrated_web' | 'fallback';
    }
  | {
      ok: false;
      status: number;
      error: string;
    };

// ============================================================================
// BOUNDED CHILD-PROCESS READABILITY PROBE (DEFEATS KERNEL fileproviderd HANGS)
// ============================================================================
const positiveReadProbeCache = new Map<
  string,
  { expiresAt: number; size: number; mtimeMs: number }
>();
const negativeReadProbeCache = new Map<
  string,
  { until: number; timedOut: boolean; error?: string }
>();
const inFlightReadProbes = new Map<string, Promise<BoundedReadProbeResult>>();
const lastBrctlKickByPath = new Map<string, number>();

const POSITIVE_PROBE_TTL_MS = 60_000;
const DEFAULT_NEGATIVE_COOLDOWN_MS = 4_000;

export function kickIcloudDownloadDetached(targetPath: string, minIntervalMs = 15_000): void {
  if (process.platform !== 'darwin' || !targetPath) return;
  const key = path.resolve(targetPath);
  const now = Date.now();
  if (now - (lastBrctlKickByPath.get(key) || 0) < minIntervalMs) return;
  lastBrctlKickByPath.set(key, now);
  try {
    const child = spawn('/usr/bin/brctl', ['download', key], {
      detached: true,
      stdio: 'ignore',
    });
    child.on('error', () => {});
    child.unref();
  } catch {}
}

export function probeFileReadableBounded(
  filePath: string,
  timeoutMs = 1500,
  failCooldownMs = DEFAULT_NEGATIVE_COOLDOWN_MS
): Promise<BoundedReadProbeResult> {
  const raw = String(filePath || '').trim();
  if (!raw) {
    return Promise.resolve({
      ok: false,
      timedOut: false,
      size: 0,
      mtimeMs: 0,
      error: 'EMPTY_PATH',
    });
  }
  const resolved = path.resolve(raw);
  const now = Date.now();

  const pos = positiveReadProbeCache.get(resolved);
  if (pos && pos.expiresAt > now) {
    return Promise.resolve({
      ok: true,
      timedOut: false,
      size: pos.size,
      mtimeMs: pos.mtimeMs,
    });
  }

  const neg = negativeReadProbeCache.get(resolved);
  if (neg && neg.until > now) {
    return Promise.resolve({
      ok: false,
      timedOut: neg.timedOut,
      size: 0,
      mtimeMs: 0,
      error: neg.error,
    });
  }

  const inflight = inFlightReadProbes.get(resolved);
  if (inflight) return inflight;

  const probeScript = [
    'const fs=require("fs");',
    'const p=process.argv[1];',
    'try{',
    'const fd=fs.openSync(p,"r");',
    'const st=fs.fstatSync(fd);',
    'if(!st.isFile()){fs.closeSync(fd);process.stderr.write("NOT_A_FILE");process.exit(2);}',
    'if(st.size>0){const b=Buffer.alloc(16);const n=fs.readSync(fd,b,0,Math.min(16,st.size),0);if(n<=0){fs.closeSync(fd);process.stderr.write("ZERO_READ");process.exit(3);}}',
    'fs.closeSync(fd);',
    'process.stdout.write(JSON.stringify({size:st.size,mtimeMs:st.mtimeMs}));',
    'process.exit(0);',
    '}catch(e){process.stderr.write(String((e&&e.code)||(e&&e.message)||"OPEN_ERR"));process.exit(4);}',
  ].join('');

  const task = new Promise<BoundedReadProbeResult>((resolve) => {
    let settled = false;
    let timedOut = false;
    let stdout = '';
    let stderr = '';

    const finish = (res: BoundedReadProbeResult) => {
      if (settled) return;
      settled = true;
      inFlightReadProbes.delete(resolved);
      if (res.ok) {
        positiveReadProbeCache.set(resolved, {
          expiresAt: Date.now() + POSITIVE_PROBE_TTL_MS,
          size: res.size,
          mtimeMs: res.mtimeMs,
        });
        negativeReadProbeCache.delete(resolved);
      } else if (failCooldownMs > 0) {
        negativeReadProbeCache.set(resolved, {
          until: Date.now() + failCooldownMs,
          timedOut: res.timedOut,
          error: res.error,
        });
      }
      resolve(res);
    };

    try {
      const child = spawn(process.execPath, ['-e', probeScript, resolved], {
        stdio: ['ignore', 'pipe', 'pipe'],
      });
      const killTimer = setTimeout(() => {
        timedOut = true;
        try {
          child.kill('SIGKILL');
        } catch {}
      }, Math.max(250, timeoutMs));

      child.stdout?.on('data', (chunk) => {
        stdout += chunk.toString();
      });
      child.stderr?.on('data', (chunk) => {
        stderr += chunk.toString();
      });
      child.on('error', (err) => {
        clearTimeout(killTimer);
        finish({
          ok: false,
          timedOut,
          size: 0,
          mtimeMs: 0,
          error: err.message || 'SPAWN_ERROR',
        });
      });
      child.on('close', (code) => {
        clearTimeout(killTimer);
        if (timedOut) {
          finish({
            ok: false,
            timedOut: true,
            size: 0,
            mtimeMs: 0,
            error: `TIMEOUT_${timeoutMs}MS`,
          });
          return;
        }
        if (code === 0) {
          try {
            const parsed = JSON.parse(stdout.trim());
            const size = Number(parsed?.size ?? 0);
            const mtimeMs = Number(parsed?.mtimeMs ?? 0);
            if (Number.isFinite(size) && size >= 0) {
              finish({ ok: true, timedOut: false, size, mtimeMs });
              return;
            }
          } catch {}
        }
        finish({
          ok: false,
          timedOut: false,
          size: 0,
          mtimeMs: 0,
          error: stderr.trim() || `EXIT_${code}`,
        });
      });
    } catch (err: any) {
      finish({
        ok: false,
        timedOut: false,
        size: 0,
        mtimeMs: 0,
        error: err?.message || 'PROBE_EXCEPTION',
      });
    }
  });

  inFlightReadProbes.set(resolved, task);
  return task;
}

export function mayBeOfficialIntroOutroIcloudPath(
  rawPath: string | null | undefined
): { kind: OfficialAssetKind; mediaType: 'video' | 'poster' } | null {
  if (!rawPath || typeof rawPath !== 'string') return null;
  const normalized = rawPath.trim().normalize('NFC').replace(/\\/g, '/');
  if (!normalized) return null;
  const lower = normalized.toLowerCase();
  if (!lower.includes('/intro:outro/') && !lower.includes('/intro_outro/')) {
    return null;
  }
  const base = path.posix.basename(normalized);
  const posterRegexByKind = {
    intro: /^\.?intro[_-]poster\.(?:jpg|jpeg|png|webp)$/i,
    outro: /^\.?outro[_-]poster\.(?:jpg|jpeg|png|webp)$/i,
  };
  const videoRegexByKind = {
    intro: /^\.?intro(?:[_-][a-z0-9]+)?\.(?:mp4|mov|m4v|webm)$/i,
    outro: /^\.?outro(?:[_-][a-z0-9]+)?\.(?:mp4|mov|m4v|webm)$/i,
  };
  if (posterRegexByKind.intro.test(base)) return { kind: 'intro', mediaType: 'poster' };
  if (videoRegexByKind.intro.test(base)) return { kind: 'intro', mediaType: 'video' };
  if (posterRegexByKind.outro.test(base)) return { kind: 'outro', mediaType: 'poster' };
  if (videoRegexByKind.outro.test(base)) return { kind: 'outro', mediaType: 'video' };
  return null;
}

// ============================================================================
// INTERNAL HELPERS (BOUNDED SUBPROCESSES, SILENT WAV, ATOMIC WRITE)
// ============================================================================
function runSubprocessBounded(
  command: string,
  args: string[],
  timeoutMs: number
): Promise<{ ok: boolean; code: number | null; stderr: string; timedOut: boolean }> {
  return new Promise((resolve) => {
    let settled = false;
    let timedOut = false;
    let stderr = '';
    const finish = (res: { ok: boolean; code: number | null; stderr: string; timedOut: boolean }) => {
      if (settled) return;
      settled = true;
      resolve(res);
    };
    try {
      const child = spawn(command, args, { stdio: ['ignore', 'ignore', 'pipe'] });
      const timer = setTimeout(() => {
        timedOut = true;
        try {
          child.kill('SIGKILL');
        } catch {}
      }, Math.max(500, timeoutMs));
      child.stderr?.on('data', (chunk) => {
        if (stderr.length < 16_384) stderr += chunk.toString();
      });
      child.on('error', (err) => {
        clearTimeout(timer);
        finish({ ok: false, code: null, stderr: err.message, timedOut });
      });
      child.on('close', (code) => {
        clearTimeout(timer);
        finish({ ok: !timedOut && code === 0, code, stderr, timedOut });
      });
    } catch (err: any) {
      finish({ ok: false, code: null, stderr: err?.message || 'SPAWN_FAILED', timedOut: false });
    }
  });
}

function probeDirectoryExistsBounded(dirPath: string, timeoutMs = 1500): Promise<boolean> {
  if (!dirPath) return Promise.resolve(false);
  return new Promise((resolve) => {
    let settled = false;
    const finish = (ok: boolean) => {
      if (settled) return;
      settled = true;
      resolve(ok);
    };
    try {
      const child = spawn(
        process.execPath,
        [
          '-e',
          'const fs=require("fs");try{const s=fs.statSync(process.argv[1]);process.exit(s.isDirectory()?0:2);}catch{process.exit(3);}',
          path.resolve(dirPath),
        ],
        { stdio: 'ignore' }
      );
      const timer = setTimeout(() => {
        try {
          child.kill('SIGKILL');
        } catch {}
        finish(false);
      }, timeoutMs);
      child.on('error', () => {
        clearTimeout(timer);
        finish(false);
      });
      child.on('close', (code) => {
        clearTimeout(timer);
        finish(code === 0);
      });
    } catch {
      finish(false);
    }
  });
}

async function inspectLocalVideoFile(
  ffmpegBin: string,
  localFilePath: string,
  timeoutMs = 12_000
): Promise<{ valid: boolean; durationSec: number; isH264Yuv420: boolean; hasAudio: boolean }> {
  const res = await runSubprocessBounded(ffmpegBin, ['-hide_banner', '-i', localFilePath], timeoutMs);
  const info = res.stderr || '';
  const durMatch = info.match(/Duration:\s*(\d+):(\d+):(\d+(?:\.\d+)?)/);
  const durationSec = durMatch
    ? parseInt(durMatch[1], 10) * 3600 + parseInt(durMatch[2], 10) * 60 + parseFloat(durMatch[3])
    : 0;
  const isH264 = /Video:\s*h264\b/i.test(info);
  const isYuv420 = /\byuv420p\b/i.test(info);
  const hasAudio = /Audio:\s*[a-z0-9_]+/i.test(info);
  return {
    valid: durationSec >= 1.5 && /Video:\s*[a-z0-9_]+/i.test(info),
    durationSec,
    isH264Yuv420: isH264 && isYuv420,
    hasAudio,
  };
}

function buildSilentStereoWavBuffer(durationSec = 8, sampleRate = 48_000): Buffer {
  const numChannels = 2;
  const bitsPerSample = 16;
  const bytesPerSample = bitsPerSample / 8;
  const blockAlign = numChannels * bytesPerSample;
  const byteRate = sampleRate * blockAlign;
  const totalSamples = Math.floor(durationSec * sampleRate);
  const dataSize = totalSamples * blockAlign;
  const buf = Buffer.alloc(44 + dataSize); // Zero-filled = digital silence

  buf.write('RIFF', 0, 'ascii');
  buf.writeUInt32LE(36 + dataSize, 4);
  buf.write('WAVE', 8, 'ascii');
  buf.write('fmt ', 12, 'ascii');
  buf.writeUInt32LE(16, 16); // PCM chunk size
  buf.writeUInt16LE(1, 20); // AudioFormat = 1 (PCM)
  buf.writeUInt16LE(numChannels, 22);
  buf.writeUInt32LE(sampleRate, 24);
  buf.writeUInt32LE(byteRate, 28);
  buf.writeUInt16LE(blockAlign, 32);
  buf.writeUInt16LE(bitsPerSample, 34);
  buf.write('data', 36, 'ascii');
  buf.writeUInt32LE(dataSize, 40);
  return buf;
}

// Minimal 1x1 dark obsidian PNG fallback if official_huellas_logo.json is absent
const MINIMAL_DARK_PNG_BASE64 =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==';

async function fileNonEmptyAsync(filePath: string, minBytes = 512): Promise<fs.Stats | null> {
  try {
    const st = await fsp.stat(filePath);
    if (st.isFile() && st.size >= minBytes) return st;
  } catch {}
  return null;
}

async function writeJsonAtomicAsync(targetPath: string, data: unknown): Promise<void> {
  const dir = path.dirname(targetPath);
  await fsp.mkdir(dir, { recursive: true });
  const tmp = path.join(dir, `.tmp_${path.basename(targetPath)}_${crypto.randomUUID()}`);
  await fsp.writeFile(tmp, JSON.stringify(data, null, 2), 'utf8');
  await fsp.rename(tmp, targetPath);
}

// ============================================================================
// OFFICIAL ASSETS MANAGER FACTORY
// ============================================================================
export function createOfficialAssetsManager(options: OfficialAssetsManagerOptions) {
  const { dataDir, getFfmpegBin, resolveOfficialLogoDataUrl } = options;
  const introOutroIcloudDir =
    options.introOutroIcloudDir ||
    path.join(
      process.env.HOME || '/Users/raydelsantana',
      'Library/Mobile Documents/com~apple~CloudDocs/0YouTube/Huellas de la Humanidad/Intro:Outro'
    );

  const assetsDir = path.join(dataDir, 'assets');
  const stagingDir = path.join(assetsDir, '.staging');
  const manifestPath = path.join(assetsDir, 'official_assets_manifest.json');
  const logoJsonAssetsPath = path.join(assetsDir, 'official_huellas_logo.json');
  const logoJsonRootPath = path.join(dataDir, 'official_huellas_logo.json');
  const legacyIntroMp4Path = path.join(dataDir, 'official_huellas_intro.mp4');
  const legacyIntroMetaPath = path.join(dataDir, 'official_huellas_intro.json');

  const pathsFor = (kind: OfficialAssetKind) => {
    const cap = kind === 'intro' ? 'Intro' : 'Outro';
    return {
      fallbackMp4: path.join(assetsDir, `official_huellas_${kind}_fallback.mp4`),
      webMp4: path.join(assetsDir, `official_huellas_${kind}_web.mp4`),
      masterMp4: path.join(assetsDir, `official_huellas_${kind}_master.mp4`),
      customMp4: path.join(assetsDir, `official_huellas_${kind}_custom.mp4`),
      posterJpg: path.join(assetsDir, `official_huellas_${kind}_poster.jpg`),
      icloudMaster: path.join(introOutroIcloudDir, `${cap}.mp4`),
      icloudWebPreview: path.join(introOutroIcloudDir, `.${cap}_WebPreview.mp4`),
      icloudPoster: path.join(introOutroIcloudDir, `.${cap}_Poster.jpg`),
    };
  };

  let manifest: OfficialAssetsManifest = {
    intro: {
      tier: 'fallback',
      version: 1,
      updatedAt: new Date(0).toISOString(),
    },
    outro: {
      tier: 'fallback',
      version: 1,
      updatedAt: new Date(0).toISOString(),
    },
  };

  const hydratingByKind: Record<OfficialAssetKind, Promise<boolean> | null> = {
    intro: null,
    outro: null,
  };
  let coldBootInitPromise: Promise<void> | null = null;
  let legacyIntroChecked = false;
  let retryTimer: ReturnType<typeof setTimeout> | null = null;
  let retryStepIdx = 0;
  const BACKOFF_STEPS_MS = [5_000, 15_000, 45_000, 120_000];

  function loadManifestSyncSafe(): void {
    try {
      if (fs.existsSync(manifestPath)) {
        const parsed = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
        if (parsed && typeof parsed === 'object') {
          for (const k of ['intro', 'outro'] as const) {
            if (parsed[k] && typeof parsed[k] === 'object') {
              manifest[k] = {
                ...manifest[k],
                ...parsed[k],
                version: Number(parsed[k].version || 1) || 1,
              };
            }
          }
        }
      }
    } catch {}
  }
  loadManifestSyncSafe();

  async function saveManifest(): Promise<void> {
    try {
      await writeJsonAtomicAsync(manifestPath, manifest);
    } catch (err) {
      console.warn('[OfficialAssets] Warning saving manifest:', err);
    }
  }

  async function readLogoBufferLocalOnly(): Promise<Buffer> {
    try {
      if (resolveOfficialLogoDataUrl) {
        const dUrl = resolveOfficialLogoDataUrl();
        if (dUrl && dUrl.startsWith('data:image/')) {
          const b64 = dUrl.replace(/^data:[^;]+;base64,/, '');
          const buf = Buffer.from(b64, 'base64');
          if (buf.length > 100) return buf;
        }
      }
    } catch {}
    for (const candidate of [logoJsonAssetsPath, logoJsonRootPath]) {
      try {
        const st = await fileNonEmptyAsync(candidate, 64);
        if (st) {
          const parsed = JSON.parse(await fsp.readFile(candidate, 'utf8'));
          if (parsed?.logoDataUrl && String(parsed.logoDataUrl).startsWith('data:image/')) {
            const b64 = String(parsed.logoDataUrl).replace(/^data:[^;]+;base64,/, '');
            const buf = Buffer.from(b64, 'base64');
            if (buf.length > 100) return buf;
          }
        }
      } catch {}
    }
    return Buffer.from(MINIMAL_DARK_PNG_BASE64, 'base64');
  }

  async function migrateLegacyRootIntroIfPresent(): Promise<void> {
    try {
      const legacySt = await fileNonEmptyAsync(legacyIntroMp4Path, 1024);
      if (!legacySt) return;
      const introP = pathsFor('intro');
      const existingCustom = await fileNonEmptyAsync(introP.customMp4, 1024);
      if (!existingCustom) {
        await fsp.mkdir(stagingDir, { recursive: true });
        const tmpCustom = path.join(stagingDir, `legacy_intro_${crypto.randomUUID()}.mp4`);
        await fsp.copyFile(legacyIntroMp4Path, tmpCustom);
        await fsp.rename(tmpCustom, introP.customMp4);

        let fileName = 'Intro_Oficial_Huellas.mp4';
        try {
          if (await fileNonEmptyAsync(legacyIntroMetaPath, 2)) {
            const meta = JSON.parse(await fsp.readFile(legacyIntroMetaPath, 'utf8'));
            if (meta?.fileName) fileName = String(meta.fileName);
          }
        } catch {}

        await buildWebAndPosterFromLocalMaster('intro', introP.customMp4, true);
        manifest.intro = {
          tier: 'custom_uploaded',
          version: Math.floor(legacySt.mtimeMs) || Date.now(),
          updatedAt: new Date().toISOString(),
          fileName,
          hasRealPoster: true,
        };
        await saveManifest();
      }
      await fsp.rm(legacyIntroMp4Path, { force: true }).catch(() => {});
      await fsp.rm(legacyIntroMetaPath, { force: true }).catch(() => {});
    } catch (err) {
      console.warn('[OfficialAssets] Legacy intro migration warning:', err);
    }
  }

  async function buildWebAndPosterFromLocalMaster(
    kind: OfficialAssetKind,
    localSourceMp4: string,
    buildPosterToo: boolean
  ): Promise<boolean> {
    const p = pathsFor(kind);
    const ffmpegBin = getFfmpegBin();
    await fsp.mkdir(stagingDir, { recursive: true });

    const info = await inspectLocalVideoFile(ffmpegBin, localSourceMp4, 15_000);
    if (!info.valid) return false;

    const tmpWeb = path.join(stagingDir, `${kind}_web_${crypto.randomUUID()}.mp4`);
    let webOk = false;

    if (info.isH264Yuv420 && info.hasAudio) {
      // Fast remux with +faststart if already H.264 yuv420p (e.g. .Intro_WebPreview.mp4)
      const remuxRes = await runSubprocessBounded(
        ffmpegBin,
        ['-y', '-i', localSourceMp4, '-c', 'copy', '-movflags', '+faststart', tmpWeb],
        30_000
      );
      webOk = remuxRes.ok && Boolean(await fileNonEmptyAsync(tmpWeb, 4096));
    }

    if (!webOk) {
      const silentWav = path.join(stagingDir, 'silence_8s.wav');
      if (!(await fileNonEmptyAsync(silentWav, 44))) {
        await fsp.writeFile(silentWav, buildSilentStereoWavBuffer(10, 48_000));
      }
      const transArgs = info.hasAudio
        ? [
            '-y',
            '-i',
            localSourceMp4,
            '-vf',
            'scale=1920:1080:force_original_aspect_ratio=decrease,pad=1920:1080:(ow-iw)/2:(oh-ih)/2:color=#060504,format=yuv420p',
            '-c:v',
            'libx264',
            '-preset',
            'veryfast',
            '-crf',
            '20',
            '-pix_fmt',
            'yuv420p',
            '-c:a',
            'aac',
            '-b:a',
            '192k',
            '-ar',
            '48000',
            '-ac',
            '2',
            '-movflags',
            '+faststart',
            tmpWeb,
          ]
        : [
            '-y',
            '-i',
            localSourceMp4,
            '-i',
            silentWav,
            '-vf',
            'scale=1920:1080:force_original_aspect_ratio=decrease,pad=1920:1080:(ow-iw)/2:(oh-ih)/2:color=#060504,format=yuv420p',
            '-c:v',
            'libx264',
            '-preset',
            'veryfast',
            '-crf',
            '20',
            '-pix_fmt',
            'yuv420p',
            '-c:a',
            'aac',
            '-b:a',
            '128k',
            '-ar',
            '48000',
            '-ac',
            '2',
            '-shortest',
            '-movflags',
            '+faststart',
            tmpWeb,
          ];
      const transRes = await runSubprocessBounded(ffmpegBin, transArgs, 90_000);
      webOk = transRes.ok && Boolean(await fileNonEmptyAsync(tmpWeb, 4096));
    }

    if (!webOk) {
      await fsp.rm(tmpWeb, { force: true }).catch(() => {});
      return false;
    }

    await fsp.rename(tmpWeb, p.webMp4);

    if (buildPosterToo) {
      const tmpPoster = path.join(stagingDir, `${kind}_poster_${crypto.randomUUID()}.jpg`);
      const seekSec = Math.min(2.5, Math.max(0.2, info.durationSec * 0.35)).toFixed(2);
      const posterRes = await runSubprocessBounded(
        ffmpegBin,
        [
          '-y',
          '-ss',
          seekSec,
          '-i',
          p.webMp4,
          '-frames:v',
          '1',
          '-vf',
          'scale=1920:1080:force_original_aspect_ratio=decrease,pad=1920:1080:(ow-iw)/2:(oh-ih)/2:color=#060504,format=yuvj420p',
          '-q:v',
          '3',
          tmpPoster,
        ],
        15_000
      );
      if (posterRes.ok && (await fileNonEmptyAsync(tmpPoster, 512))) {
        await fsp.rename(tmpPoster, p.posterJpg);
      } else {
        await fsp.rm(tmpPoster, { force: true }).catch(() => {});
      }
    }

    return true;
  }

  async function ensureColdBootFallbacks(): Promise<void> {
    if (coldBootInitPromise) return coldBootInitPromise;
    coldBootInitPromise = (async () => {
      try {
        await fsp.mkdir(assetsDir, { recursive: true });
        await fsp.mkdir(stagingDir, { recursive: true });

        if (!legacyIntroChecked) {
          legacyIntroChecked = true;
          await migrateLegacyRootIntroIfPresent();
        }

        const ffmpegBin = getFfmpegBin();
        let logoPath = '';
        let silentWavPath = '';
        let manifestDirty = false;

        for (const kind of ['intro', 'outro'] as const) {
          const p = pathsFor(kind);
          const hasWeb = Boolean(await fileNonEmptyAsync(p.webMp4, 4096));
          const hasFallback = Boolean(await fileNonEmptyAsync(p.fallbackMp4, 4096));
          const hasPoster = Boolean(await fileNonEmptyAsync(p.posterJpg, 512));

          // Reconcile manifest tier with physical disk reality
          if (hasWeb && manifest[kind].tier === 'fallback') {
            const webSt = await fileNonEmptyAsync(p.webMp4, 4096);
            manifest[kind].tier = (await fileNonEmptyAsync(p.customMp4, 1024))
              ? 'custom_uploaded'
              : 'icloud_hydrated';
            manifest[kind].version = Math.floor(webSt?.mtimeMs || Date.now());
            manifestDirty = true;
          } else if (!hasWeb && manifest[kind].tier !== 'fallback') {
            manifest[kind].tier = 'fallback';
            manifestDirty = true;
          }

          if (hasPoster && (hasWeb || hasFallback)) {
            continue;
          }

          if (!logoPath) {
            logoPath = path.join(stagingDir, 'institutional_logo.png');
            const logoBuf = await readLogoBufferLocalOnly();
            await fsp.writeFile(logoPath, logoBuf);
          }

          if (!hasPoster) {
            const tmpPoster = path.join(stagingDir, `${kind}_fb_poster_${crypto.randomUUID()}.jpg`);
            const posterRes = await runSubprocessBounded(
              ffmpegBin,
              [
                '-y',
                '-i',
                logoPath,
                '-vf',
                'scale=540:540:force_original_aspect_ratio=decrease,pad=1920:1080:(ow-iw)/2:(oh-ih)/2:color=#0b0907,format=yuvj420p',
                '-frames:v',
                '1',
                '-q:v',
                '3',
                tmpPoster,
              ],
              10_000
            );
            if (posterRes.ok && (await fileNonEmptyAsync(tmpPoster, 512))) {
              await fsp.rename(tmpPoster, p.posterJpg);
            } else {
              await fsp.rm(tmpPoster, { force: true }).catch(() => {});
            }
          }

          if (!hasFallback && !hasWeb) {
            if (!silentWavPath) {
              silentWavPath = path.join(stagingDir, 'silence_8s.wav');
              if (!(await fileNonEmptyAsync(silentWavPath, 44))) {
                await fsp.writeFile(silentWavPath, buildSilentStereoWavBuffer(8, 48_000));
              }
            }
            const posterSource = (await fileNonEmptyAsync(p.posterJpg, 512))
              ? p.posterJpg
              : logoPath;
            const tmpFb = path.join(stagingDir, `${kind}_fb_${crypto.randomUUID()}.mp4`);
            const fbRes = await runSubprocessBounded(
              ffmpegBin,
              [
                '-y',
                '-loop',
                '1',
                '-framerate',
                '24',
                '-t',
                '8',
                '-i',
                posterSource,
                '-i',
                silentWavPath,
                '-t',
                '8',
                '-vf',
                'scale=1920:1080:force_original_aspect_ratio=decrease,pad=1920:1080:(ow-iw)/2:(oh-ih)/2:color=#0b0907,fade=t=in:st=0:d=0.8,fade=t=out:st=6.5:d=1.5,format=yuv420p',
                '-c:v',
                'libx264',
                '-preset',
                'ultrafast',
                '-crf',
                '23',
                '-pix_fmt',
                'yuv420p',
                '-c:a',
                'aac',
                '-b:a',
                '128k',
                '-ar',
                '48000',
                '-ac',
                '2',
                '-shortest',
                '-movflags',
                '+faststart',
                tmpFb,
              ],
              15_000
            );
            if (fbRes.ok && (await fileNonEmptyAsync(tmpFb, 4096))) {
              await fsp.rename(tmpFb, p.fallbackMp4);
              const fbSt = await fileNonEmptyAsync(p.fallbackMp4, 4096);
              if (manifest[kind].version <= 1 && fbSt) {
                manifest[kind].version = Math.floor(fbSt.mtimeMs);
                manifestDirty = true;
              }
            } else {
              await fsp.rm(tmpFb, { force: true }).catch(() => {});
            }
          }
        }
        if (manifestDirty) {
          await saveManifest();
        }
      } catch (err) {
        console.warn('[OfficialAssets] Cold-boot fallback setup warning:', err);
      }
    })();
    try {
      await coldBootInitPromise;
    } finally {
      coldBootInitPromise = null;
    }
  }

  async function copyFromIcloudBounded(
    sourcePath: string,
    destPath: string,
    probeTimeoutMs: number,
    cpTimeoutMs: number,
    minSizeBytes: number
  ): Promise<{ ok: boolean; size: number; mtimeMs: number; error?: string }> {
    const probe = await probeFileReadableBounded(sourcePath, probeTimeoutMs, 3_500);
    if (!probe.ok || probe.size < minSizeBytes) {
      kickIcloudDownloadDetached(sourcePath);
      return {
        ok: false,
        size: 0,
        mtimeMs: 0,
        error: probe.error || 'ICLOUD_SOURCE_UNREADABLE',
      };
    }

    await fsp.mkdir(stagingDir, { recursive: true });
    const tmpFile = path.join(
      stagingDir,
      `cp_${path.basename(destPath)}_${crypto.randomUUID()}`
    );
    try {
      const cpRes = await runSubprocessBounded('/bin/cp', ['--', sourcePath, tmpFile], cpTimeoutMs);
      if (!cpRes.ok) {
        await fsp.rm(tmpFile, { force: true }).catch(() => {});
        return {
          ok: false,
          size: 0,
          mtimeMs: 0,
          error: cpRes.timedOut ? `CP_TIMEOUT_${cpTimeoutMs}MS` : cpRes.stderr || 'CP_FAILED',
        };
      }
      const st = await fileNonEmptyAsync(tmpFile, minSizeBytes);
      if (!st) {
        await fsp.rm(tmpFile, { force: true }).catch(() => {});
        return { ok: false, size: 0, mtimeMs: 0, error: 'CP_EMPTY_RESULT' };
      }
      await fsp.rename(tmpFile, destPath);
      return { ok: true, size: st.size, mtimeMs: st.mtimeMs };
    } catch (err: any) {
      await fsp.rm(tmpFile, { force: true }).catch(() => {});
      return { ok: false, size: 0, mtimeMs: 0, error: err?.message || 'CP_EXCEPTION' };
    }
  }

  function hydrateKind(
    kind: OfficialAssetKind,
    opts?: { force?: boolean; onDemandTimeoutMs?: number }
  ): Promise<boolean> {
    if (hydratingByKind[kind]) return hydratingByKind[kind]!;

    const job = (async (): Promise<boolean> => {
      const p = pathsFor(kind);

      // Preserve explicit custom uploaded asset unless forced
      if (!opts?.force && manifest[kind].tier === 'custom_uploaded') {
        if ((await fileNonEmptyAsync(p.webMp4, 4096)) || (await fileNonEmptyAsync(p.customMp4, 4096))) {
          return true;
        }
      }

      const dirExists = await probeDirectoryExistsBounded(introOutroIcloudDir, 1500);
      if (!dirExists) {
        manifest[kind].lastError = 'ICLOUD_DIR_NOT_AVAILABLE';
        return Boolean(await fileNonEmptyAsync(p.webMp4, 4096));
      }

      if (process.platform === 'darwin') {
        // Non-blocking warm-up download request for Poster, WebPreview, and Master
        await runSubprocessBounded(
          '/usr/bin/brctl',
          ['download', p.icloudPoster, p.icloudWebPreview, p.icloudMaster],
          8_000
        ).catch(() => {});
      }

      const probeBudgetMs = opts?.onDemandTimeoutMs
        ? Math.min(6_000, Math.max(2_000, Math.floor(opts.onDemandTimeoutMs * 0.25)))
        : 2_200;
      const cpMasterBudgetMs = opts?.onDemandTimeoutMs
        ? Math.max(12_000, opts.onDemandTimeoutMs)
        : 60_000;

      // 1. Hydrate Poster (.Intro_Poster.jpg / .Outro_Poster.jpg) if needed
      let hasRealPoster = Boolean(manifest[kind].hasRealPoster && (await fileNonEmptyAsync(p.posterJpg, 1024)));
      if (!hasRealPoster || opts?.force) {
        const posterCopy = await copyFromIcloudBounded(
          p.icloudPoster,
          p.posterJpg,
          probeBudgetMs,
          15_000,
          1024
        );
        if (posterCopy.ok) {
          hasRealPoster = true;
          manifest[kind].hasRealPoster = true;
        }
      }

      // 2. Hydrate lightweight 1080p WebPreview (.Intro_WebPreview.mp4 / .Outro_WebPreview.mp4) first
      let hasWeb = Boolean(
        manifest[kind].tier === 'icloud_hydrated' && (await fileNonEmptyAsync(p.webMp4, 10_000))
      );
      if (!hasWeb || opts?.force) {
        const tmpRawWeb = path.join(stagingDir, `${kind}_icloud_webpreview_${crypto.randomUUID()}.mp4`);
        const webPreviewCopy = await copyFromIcloudBounded(
          p.icloudWebPreview,
          tmpRawWeb,
          probeBudgetMs,
          Math.min(40_000, cpMasterBudgetMs),
          10_000
        );
        if (webPreviewCopy.ok) {
          const built = await buildWebAndPosterFromLocalMaster(kind, tmpRawWeb, !hasRealPoster);
          await fsp.rm(tmpRawWeb, { force: true }).catch(() => {});
          if (built) {
            hasWeb = true;
            hasRealPoster = true;
            const webSt = await fileNonEmptyAsync(p.webMp4, 10_000);
            manifest[kind] = {
              ...manifest[kind],
              tier: 'icloud_hydrated',
              version: Math.floor(webSt?.mtimeMs || Date.now()),
              updatedAt: new Date().toISOString(),
              hasRealPoster: true,
              lastError: undefined,
            };
            await saveManifest();
          }
        } else {
          await fsp.rm(tmpRawWeb, { force: true }).catch(() => {});
        }
      }

      // 3. Hydrate full 8K Master (Intro.mp4 / Outro.mp4) for 4K FFmpeg exports
      let hasMaster = Boolean(await fileNonEmptyAsync(p.masterMp4, 50_000));
      if (!hasMaster || opts?.force) {
        const tmpMasterVerify = path.join(stagingDir, `${kind}_icloud_master_${crypto.randomUUID()}.mp4`);
        const masterCopy = await copyFromIcloudBounded(
          p.icloudMaster,
          tmpMasterVerify,
          probeBudgetMs,
          cpMasterBudgetMs,
          50_000
        );
        if (masterCopy.ok) {
          const check = await inspectLocalVideoFile(getFfmpegBin(), tmpMasterVerify, 15_000);
          if (check.valid) {
            await fsp.rename(tmpMasterVerify, p.masterMp4);
            hasMaster = true;
            if (!hasWeb) {
              const builtFromMaster = await buildWebAndPosterFromLocalMaster(
                kind,
                p.masterMp4,
                !hasRealPoster
              );
              if (builtFromMaster) {
                hasWeb = true;
                hasRealPoster = true;
              }
            }
            const webSt = await fileNonEmptyAsync(p.webMp4, 10_000);
            const masterSt = await fileNonEmptyAsync(p.masterMp4, 50_000);
            manifest[kind] = {
              ...manifest[kind],
              tier: hasWeb ? 'icloud_hydrated' : manifest[kind].tier,
              version: Math.floor(webSt?.mtimeMs || masterSt?.mtimeMs || Date.now()),
              updatedAt: new Date().toISOString(),
              hasRealPoster,
              sourceSize: masterCopy.size,
              sourceMtimeMs: masterCopy.mtimeMs,
              lastError: undefined,
            };
            await saveManifest();
          } else {
            await fsp.rm(tmpMasterVerify, { force: true }).catch(() => {});
            manifest[kind].lastError = 'MASTER_INVALID_CONTAINER';
          }
        } else {
          await fsp.rm(tmpMasterVerify, { force: true }).catch(() => {});
          if (!hasWeb) {
            manifest[kind].lastError = masterCopy.error || 'ICLOUD_HYDRATION_PENDING';
          }
        }
      }

      return hasWeb || hasMaster;
    })();

    hydratingByKind[kind] = job;
    return job.finally(() => {
      if (hydratingByKind[kind] === job) {
        hydratingByKind[kind] = null;
      }
    });
  }

  function scheduleBackgroundHydration(delayMs: number): void {
    if (retryTimer) return;
    retryTimer = setTimeout(async () => {
      retryTimer = null;
      try {
        await Promise.all([hydrateKind('intro'), hydrateKind('outro')]);
        const introDone =
          manifest.intro.tier !== 'fallback' &&
          Boolean(await fileNonEmptyAsync(pathsFor('intro').masterMp4, 50_000));
        const outroDone =
          manifest.outro.tier !== 'fallback' &&
          Boolean(await fileNonEmptyAsync(pathsFor('outro').masterMp4, 50_000));
        if (!introDone || !outroDone) {
          const dirOk = await probeDirectoryExistsBounded(introOutroIcloudDir, 1200);
          if (dirOk) {
            const nextDelay =
              BACKOFF_STEPS_MS[Math.min(retryStepIdx, BACKOFF_STEPS_MS.length - 1)];
            retryStepIdx++;
            scheduleBackgroundHydration(nextDelay);
          }
        } else {
          retryStepIdx = 0;
        }
      } catch {
        const nextDelay = BACKOFF_STEPS_MS[Math.min(retryStepIdx, BACKOFF_STEPS_MS.length - 1)];
        retryStepIdx++;
        scheduleBackgroundHydration(nextDelay);
      }
    }, Math.max(0, delayMs));
    if (typeof (retryTimer as any).unref === 'function') {
      (retryTimer as any).unref();
    }
  }

  function init(): void {
    void ensureColdBootFallbacks().then(() => {
      scheduleBackgroundHydration(250);
    });
  }

  async function getStatusPayload(): Promise<OfficialAssetsStatusPayload> {
    await ensureColdBootFallbacks();
    const buildEntry = async (kind: OfficialAssetKind): Promise<OfficialAssetStatusEntry> => {
      const p = pathsFor(kind);
      const [masterSt, webSt, customSt, posterSt] = await Promise.all([
        fileNonEmptyAsync(p.masterMp4, 50_000),
        fileNonEmptyAsync(p.webMp4, 4096),
        fileNonEmptyAsync(p.customMp4, 1024),
        fileNonEmptyAsync(p.posterJpg, 512),
      ]);
      const effectiveTier: OfficialAssetTier = customSt && manifest[kind].tier === 'custom_uploaded'
        ? 'custom_uploaded'
        : webSt
          ? 'icloud_hydrated'
          : 'fallback';
      const version =
        Number(manifest[kind].version) > 1
          ? Number(manifest[kind].version)
          : Math.floor(webSt?.mtimeMs || posterSt?.mtimeMs || 1);
      return {
        tier: effectiveTier,
        version,
        hydrating: Boolean(hydratingByKind[kind]) || effectiveTier === 'fallback',
        hasMaster: Boolean(masterSt || customSt),
        hasWeb: Boolean(webSt),
        hasPoster: Boolean(posterSt),
        ...(manifest[kind].lastError && effectiveTier === 'fallback'
          ? { error: manifest[kind].lastError }
          : {}),
      };
    };

    const [intro, outro] = await Promise.all([buildEntry('intro'), buildEntry('outro')]);
    if (intro.tier === 'fallback' || outro.tier === 'fallback') {
      scheduleBackgroundHydration(1000);
    }
    return {
      ok: true,
      version: Math.max(intro.version, outro.version),
      intro,
      outro,
    };
  }

  function applyStandardAssetHeaders(res: Response, tier: OfficialAssetTier | 'error'): void {
    if (!res.getHeader('Access-Control-Allow-Origin')) {
      res.setHeader('Access-Control-Allow-Origin', '*');
    }
    res.setHeader('Vary', 'Origin');
    res.setHeader(
      'Access-Control-Expose-Headers',
      'Content-Range, Accept-Ranges, Content-Length, ETag, Last-Modified, X-Official-Asset-Tier'
    );
    res.setHeader('Cross-Origin-Resource-Policy', 'cross-origin');
    res.setHeader('Accept-Ranges', 'bytes');
    res.setHeader('X-Official-Asset-Tier', tier);
  }

  async function streamLocalAssetRfc9110(
    req: Request,
    res: Response,
    filePath: string,
    contentType: string,
    tier: OfficialAssetTier
  ): Promise<void> {
    const stat = await fileNonEmptyAsync(filePath, 64);
    if (!stat) {
      applyStandardAssetHeaders(res, 'error');
      res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate');
      res.setHeader('Retry-After', '2');
      res.status(503).end();
      return;
    }

    const fileSize = stat.size;
    const mtimeFloor = Math.floor(stat.mtimeMs);
    // Strong ETag (without W/) required by RFC 9110 §14.27 for If-Range byte-splicing validation
    const etag = `"${tier}-${fileSize.toString(16)}-${mtimeFloor.toString(16)}"`;
    const lastModified = stat.mtime.toUTCString();
    const hasVersionQuery = Boolean(req.query.v || req.query.t);

    applyStandardAssetHeaders(res, tier);
    res.setHeader('ETag', etag);
    res.setHeader('Last-Modified', lastModified);
    res.setHeader(
      'Cache-Control',
      tier === 'fallback'
        ? 'no-store, no-cache, must-revalidate'
        : hasVersionQuery
          ? 'private, max-age=3600'
          : 'private, max-age=0, must-revalidate'
    );

    const rawRange = typeof req.headers.range === 'string' ? req.headers.range.trim() : '';
    const ifRange = typeof req.headers['if-range'] === 'string' ? req.headers['if-range'].trim() : '';

    if (!rawRange && req.headers['if-none-match'] === etag) {
      res.status(304).end();
      return;
    }

    let canHonorRange = Boolean(rawRange);
    if (canHonorRange && ifRange) {
      if (ifRange.startsWith('W/')) {
        // Weak entity tags are never valid in If-Range per RFC 9110
        canHonorRange = false;
      } else if (ifRange.startsWith('"')) {
        canHonorRange = ifRange === etag;
      } else {
        const parsedDate = Date.parse(ifRange);
        canHonorRange =
          Number.isFinite(parsedDate) &&
          Math.floor(parsedDate / 1000) === Math.floor(stat.mtimeMs / 1000);
      }
    }

    if (canHonorRange) {
      const m = rawRange.match(/^bytes=(\d*)-(\d*)$/i);
      if (!m || (m[1] === '' && m[2] === '')) {
        res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate');
        res.setHeader('Content-Range', `bytes */${fileSize}`);
        res.status(416).end();
        return;
      }

      let start = 0;
      let end = fileSize - 1;
      if (m[1] === '' && m[2] !== '') {
        const suffixLen = parseInt(m[2], 10);
        if (!Number.isFinite(suffixLen) || suffixLen <= 0) {
          res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate');
          res.setHeader('Content-Range', `bytes */${fileSize}`);
          res.status(416).end();
          return;
        }
        start = Math.max(0, fileSize - suffixLen);
        end = fileSize - 1;
      } else {
        start = parseInt(m[1], 10);
        const requestedEnd = m[2] !== '' ? parseInt(m[2], 10) : fileSize - 1;
        if (
          !Number.isFinite(start) ||
          start < 0 ||
          start >= fileSize ||
          !Number.isFinite(requestedEnd) ||
          requestedEnd < start
        ) {
          res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate');
          res.setHeader('Content-Range', `bytes */${fileSize}`);
          res.status(416).end();
          return;
        }
        end = Math.min(requestedEnd, fileSize - 1);
      }

      const chunkLength = end - start + 1;
      res.status(206);
      res.setHeader('Content-Type', contentType);
      res.setHeader('Content-Range', `bytes ${start}-${end}/${fileSize}`);
      res.setHeader('Content-Length', String(chunkLength));

      if (req.method === 'HEAD') {
        res.end();
        return;
      }

      const stream = fs.createReadStream(filePath, { start, end });
      const cleanup = () => {
        if (!stream.destroyed) stream.destroy();
      };
      req.on('close', cleanup);
      stream.on('error', () => {
        cleanup();
        if (!res.headersSent) {
          res.status(500).end();
        } else {
          res.destroy();
        }
      });
      stream.pipe(res);
      return;
    }

    res.status(200);
    res.setHeader('Content-Type', contentType);
    res.setHeader('Content-Length', String(fileSize));

    if (req.method === 'HEAD') {
      res.end();
      return;
    }

    const stream = fs.createReadStream(filePath);
    const cleanup = () => {
      if (!stream.destroyed) stream.destroy();
    };
    req.on('close', cleanup);
    stream.on('error', () => {
      cleanup();
      if (!res.headersSent) {
        res.status(500).end();
      } else {
        res.destroy();
      }
    });
    stream.pipe(res);
  }

  async function handleStream(kind: OfficialAssetKind, req: Request, res: Response): Promise<void> {
    try {
      const p = pathsFor(kind);
      const customSt =
        manifest[kind].tier === 'custom_uploaded' ? await fileNonEmptyAsync(p.customMp4, 1024) : null;
      const webSt = await fileNonEmptyAsync(p.webMp4, 4096);

      if (customSt && webSt) {
        await streamLocalAssetRfc9110(req, res, p.webMp4, 'video/mp4', 'custom_uploaded');
        return;
      }
      if (customSt) {
        await streamLocalAssetRfc9110(req, res, p.customMp4, 'video/mp4', 'custom_uploaded');
        return;
      }
      if (webSt) {
        await streamLocalAssetRfc9110(req, res, p.webMp4, 'video/mp4', 'icloud_hydrated');
        return;
      }

      await ensureColdBootFallbacks();
      scheduleBackgroundHydration(150);

      const webAfterInit = await fileNonEmptyAsync(p.webMp4, 4096);
      if (webAfterInit) {
        await streamLocalAssetRfc9110(req, res, p.webMp4, 'video/mp4', 'icloud_hydrated');
        return;
      }

      const fallbackSt = await fileNonEmptyAsync(p.fallbackMp4, 4096);
      if (fallbackSt) {
        await streamLocalAssetRfc9110(req, res, p.fallbackMp4, 'video/mp4', 'fallback');
        return;
      }

      applyStandardAssetHeaders(res, 'error');
      res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate');
      res.setHeader('Retry-After', '2');
      res.status(503).json({ error: `Hidratando ${kind} oficial...` });
    } catch (err: any) {
      if (!res.headersSent) {
        applyStandardAssetHeaders(res, 'error');
        res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate');
        res.status(500).json({ error: err?.message || `Error sirviendo ${kind} oficial.` });
      }
    }
  }

  async function handlePoster(kind: OfficialAssetKind, req: Request, res: Response): Promise<void> {
    try {
      const p = pathsFor(kind);
      let posterSt = await fileNonEmptyAsync(p.posterJpg, 512);
      if (!posterSt) {
        await ensureColdBootFallbacks();
        posterSt = await fileNonEmptyAsync(p.posterJpg, 512);
      }
      if (!posterSt) {
        applyStandardAssetHeaders(res, 'error');
        res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate');
        res.status(404).end();
        return;
      }
      const webSt = await fileNonEmptyAsync(p.webMp4, 4096);
      const customSt =
        manifest[kind].tier === 'custom_uploaded' ? await fileNonEmptyAsync(p.customMp4, 1024) : null;
      const tier: OfficialAssetTier = customSt
        ? 'custom_uploaded'
        : webSt && manifest[kind].hasRealPoster
          ? 'icloud_hydrated'
          : 'fallback';
      if (tier === 'fallback') {
        scheduleBackgroundHydration(500);
      }
      await streamLocalAssetRfc9110(req, res, p.posterJpg, 'image/jpeg', tier);
    } catch (err: any) {
      if (!res.headersSent) {
        applyStandardAssetHeaders(res, 'error');
        res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate');
        res.status(500).json({ error: err?.message || `Error sirviendo poster ${kind}.` });
      }
    }
  }

  async function handleGetMetadata(kind: OfficialAssetKind, _req: Request, res: Response): Promise<void> {
    try {
      const status = await getStatusPayload();
      const entry = status[kind];
      const streamUrl = `/api/assets/official-${kind}-stream?v=${entry.version}`;
      const posterUrl = `/api/assets/official-${kind}-poster?v=${entry.version}`;
      res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate');
      res.json({
        ok: true,
        hasIntro: Boolean(status.intro.hasWeb || status.intro.hasMaster || status.intro.hasPoster),
        hasOutro: Boolean(status.outro.hasWeb || status.outro.hasMaster || status.outro.hasPoster),
        introUrl: `/api/assets/official-intro-stream?v=${status.intro.version}`,
        introPosterUrl: `/api/assets/official-intro-poster?v=${status.intro.version}`,
        outroUrl: `/api/assets/official-outro-stream?v=${status.outro.version}`,
        outroPosterUrl: `/api/assets/official-outro-poster?v=${status.outro.version}`,
        streamUrl,
        posterUrl,
        tier: entry.tier,
        version: entry.version,
        hydrating: entry.hydrating,
        fileName:
          manifest[kind].fileName ||
          (kind === 'intro'
            ? '00_Intro_Huellas_de_la_Humanidad_8K.mp4'
            : 'Outro_Huellas_de_la_Humanidad_8K_FadeOut.mp4'),
        updatedAt: manifest[kind].updatedAt || new Date().toISOString(),
      });
    } catch (err: any) {
      res.status(500).json({ ok: false, error: err?.message || 'Error consultando asset oficial.' });
    }
  }

  async function handleUploadCustom(kind: OfficialAssetKind, req: Request, res: Response): Promise<void> {
    try {
      const { videoDataUrl, fileName } = req.body || {};
      if (!videoDataUrl || typeof videoDataUrl !== 'string') {
        res.status(400).json({ error: `No se envió el archivo de video del ${kind} oficial.` });
        return;
      }
      await fsp.mkdir(stagingDir, { recursive: true });
      const base64Clean = videoDataUrl.replace(/^data:[^;]+;base64,/, '');
      const buf = Buffer.from(base64Clean, 'base64');
      if (buf.length < 1024) {
        res.status(400).json({ error: 'El archivo de video recibido está vacío o incompleto.' });
        return;
      }

      const p = pathsFor(kind);
      const tmpCustom = path.join(stagingDir, `${kind}_upload_${crypto.randomUUID()}.mp4`);
      await fsp.writeFile(tmpCustom, buf);

      const check = await inspectLocalVideoFile(getFfmpegBin(), tmpCustom, 15_000);
      if (!check.valid) {
        await fsp.rm(tmpCustom, { force: true }).catch(() => {});
        res.status(400).json({ error: 'El archivo subido no es un contenedor de video válido.' });
        return;
      }

      await fsp.rename(tmpCustom, p.customMp4);
      await buildWebAndPosterFromLocalMaster(kind, p.customMp4, true);

      const nowMs = Date.now();
      const safeName = String(
        fileName ||
          (kind === 'intro' ? 'Intro_Oficial_Huellas_Custom.mp4' : 'Outro_Oficial_Huellas_Custom.mp4')
      );
      manifest[kind] = {
        tier: 'custom_uploaded',
        version: nowMs,
        updatedAt: new Date(nowMs).toISOString(),
        fileName: safeName,
        hasRealPoster: true,
        sourceSize: buf.length,
        sourceMtimeMs: nowMs,
        lastError: undefined,
      };
      await saveManifest();

      res.json({
        ok: true,
        hasIntro: true,
        hasOutro: true,
        introUrl: `/api/assets/official-intro-stream?v=${manifest.intro.version}`,
        outroUrl: `/api/assets/official-outro-stream?v=${manifest.outro.version}`,
        posterUrl: `/api/assets/official-${kind}-poster?v=${nowMs}`,
        tier: 'custom_uploaded',
        version: nowMs,
        fileName: safeName,
        sizeBytes: buf.length,
        updatedAt: manifest[kind].updatedAt,
      });
    } catch (err: any) {
      res.status(500).json({ error: err?.message || `Error guardando ${kind} oficial.` });
    }
  }

  async function resolveForExport(
    kind: OfficialAssetKind,
    opts?: { timeoutMs?: number }
  ): Promise<ExportAssetResolution> {
    const p = pathsFor(kind);

    // 1. Custom user-uploaded override
    if (manifest[kind].tier === 'custom_uploaded') {
      const customSt = await fileNonEmptyAsync(p.customMp4, 4096);
      if (customSt) {
        return { ok: true, filePath: p.customMp4, tier: 'custom_uploaded' };
      }
    }

    // 2. Local 8K/4K master already materialized in data/assets/
    const existingMaster = await fileNonEmptyAsync(p.masterMp4, 50_000);
    if (existingMaster) {
      return { ok: true, filePath: p.masterMp4, tier: 'icloud_hydrated_master' };
    }

    // 3. On-demand bounded hydration (~25s default) from Intro:Outro
    const timeoutMs = opts?.timeoutMs ?? 25_000;
    await hydrateKind(kind, { onDemandTimeoutMs: timeoutMs });

    const hydratedMaster = await fileNonEmptyAsync(p.masterMp4, 50_000);
    if (hydratedMaster) {
      return { ok: true, filePath: p.masterMp4, tier: 'icloud_hydrated_master' };
    }

    // 4. Real hydrated 1080p WebPreview from iCloud (real channel video + real audio, NEVER synthetic logo)
    const hydratedWeb = await fileNonEmptyAsync(p.webMp4, 10_000);
    if (hydratedWeb && manifest[kind].tier === 'icloud_hydrated') {
      return { ok: true, filePath: p.webMp4, tier: 'icloud_hydrated_web' };
    }

    // 5. Never bake synthetic fallback into a final 4K export on Mac when iCloud Intro:Outro directory exists
    const macIcloudDirExists = await probeDirectoryExistsBounded(introOutroIcloudDir, 1500);
    if (macIcloudDirExists || process.platform === 'darwin') {
      const label = kind === 'intro' ? 'Intro.mp4' : 'Outro.mp4';
      return {
        ok: false,
        status: 503,
        error: `No se pudo leer el archivo real ${label} desde iCloud Drive (retenido temporalmente por fileproviderd en Intro:Outro). Abre la carpeta Intro:Outro en Finder para forzar su descarga local y vuelve a exportar el Master 4K.`,
      };
    }

    // Headless non-Mac environment without iCloud folder: allow fallback if present
    await ensureColdBootFallbacks();
    const fbSt = await fileNonEmptyAsync(p.fallbackMp4, 4096);
    if (fbSt) {
      return { ok: true, filePath: p.fallbackMp4, tier: 'fallback' };
    }
    return {
      ok: false,
      status: 503,
      error: `Activo oficial (${kind}) no disponible para exportación.`,
    };
  }

  return {
    init,
    getStatusPayload,
    handleStream,
    handlePoster,
    handleGetMetadata,
    handleUploadCustom,
    resolveForExport,
    hydrateKind,
  };
}
