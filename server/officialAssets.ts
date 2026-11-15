import type { Request, Response } from 'express';
import fs from 'fs';
import fsp from 'fs/promises';
import path from 'path';
import crypto from 'crypto';
import { spawn, type ChildProcess } from 'child_process';

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
// PERSISTENT BOUNDED PROBE WORKER POOL (DEFEATS KERNEL fileproviderd HANGS
// AND AMORTIZES macOS 26.7+ 10.0s Sandbox.kext PER-PID APPROVAL WATCHDOG)
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

const POSITIVE_PROBE_TTL_MS = 10 * 60_000;
const DEFAULT_NEGATIVE_COOLDOWN_MS = 4_000;
const PROBE_POOL_SIZE = 4;
const MAX_INFLIGHT_PER_WORKER = 32;

const PERSISTENT_PROBE_WORKER_SCRIPT = [
  'const fsp=require("fs/promises"),path=require("path"),rl=require("readline");',
  'const iface=rl.createInterface({input:process.stdin,crlfDelay:Infinity});',
  'const reply=(id,obj)=>{try{process.stdout.write(JSON.stringify(Object.assign({id},obj))+"\\n");}catch{}};',
  'iface.on("line",async(line)=>{',
  '  if(!line)return;',
  '  let msg;try{msg=JSON.parse(line);}catch{return;}',
  '  const id=msg.id,op=msg.op,target=String(msg.path||"");',
  '  let fh=null;',
  '  try{',
  '    if(op==="dir"){',
  '      await fsp.readdir(target);',
  '      const subs=Array.isArray(msg.subdirs)?msg.subdirs:[];',
  '      if(subs.length>0){',
  '        await Promise.all(subs.map(async(sub)=>{',
  '          const fullSub=path.join(target,String(sub||""));',
  '          try{await fsp.readdir(fullSub);}catch(e){if(e&&e.code!=="ENOENT"&&e.code!=="ENOTDIR")throw e;}',
  '        }));',
  '      }',
  '      reply(id,{ok:true});return;',
  '    }',
  '    const preSt=await fsp.stat(target);',
  '    if(!preSt.isFile()){reply(id,{ok:false,error:"NOT_A_FILE"});return;}',
  '    if(preSt.size<=0||(typeof preSt.blocks==="number"&&preSt.blocks<=0)){reply(id,{ok:false,error:"DATALESS"});return;}',
  '    fh=await fsp.open(target,"r");',
  '    const st=await fh.stat();',
  '    if(st.size>0){',
  '      const b=Buffer.allocUnsafe(16);',
  '      const rd=await fh.read(b,0,Math.min(16,st.size),0);',
  '      if(!rd||rd.bytesRead<=0){await fh.close();fh=null;reply(id,{ok:false,error:"ZERO_READ"});return;}',
  '    }',
  '    await fh.close();fh=null;',
  '    reply(id,{ok:true,size:st.size,mtimeMs:st.mtimeMs});',
  '  }catch(e){',
  '    if(fh){try{await fh.close();}catch{}}',
  '    reply(id,{ok:false,error:String((e&&e.code)||(e&&e.message)||"OPEN_ERR")});',
  '  }',
  '});',
].join('\n');

interface PersistentProbeWorker {
  proc: ChildProcess;
  alive: boolean;
  hungCount: number;
  stdoutBuf: string;
  activeReqs: Map<
    number,
    {
      timer: ReturnType<typeof setTimeout>;
      resolve: (res: {
        ok: boolean;
        timedOut?: boolean;
        size?: number;
        mtimeMs?: number;
        error?: string;
      }) => void;
    }
  >;
}

const probeWorkers: PersistentProbeWorker[] = [];
let nextProbeReqId = 1;
let rrWorkerIdx = 0;

function destroyProbeWorker(worker: PersistentProbeWorker, reasonError = 'WORKER_CLOSED'): void {
  if (!worker.alive) return;
  worker.alive = false;
  const idx = probeWorkers.indexOf(worker);
  if (idx >= 0) probeWorkers.splice(idx, 1);
  try {
    worker.proc.kill('SIGKILL');
  } catch {}
  for (const [, req] of worker.activeReqs.entries()) {
    clearTimeout(req.timer);
    req.resolve({ ok: false, timedOut: reasonError.startsWith('TIMEOUT_'), error: reasonError });
  }
  worker.activeReqs.clear();
}

function createPersistentProbeWorker(): PersistentProbeWorker | null {
  try {
    const proc = spawn(process.execPath, ['-e', PERSISTENT_PROBE_WORKER_SCRIPT], {
      stdio: ['pipe', 'pipe', 'ignore'],
      env: { ...process.env, UV_THREADPOOL_SIZE: '64' },
    });
    if (typeof proc.unref === 'function') proc.unref();

    const worker: PersistentProbeWorker = {
      proc,
      alive: true,
      hungCount: 0,
      stdoutBuf: '',
      activeReqs: new Map(),
    };

    proc.stdout?.on('data', (chunk: Buffer) => {
      worker.stdoutBuf += chunk.toString('utf8');
      let nlIdx = worker.stdoutBuf.indexOf('\n');
      while (nlIdx >= 0) {
        const line = worker.stdoutBuf.slice(0, nlIdx).trim();
        worker.stdoutBuf = worker.stdoutBuf.slice(nlIdx + 1);
        nlIdx = worker.stdoutBuf.indexOf('\n');
        if (!line) continue;
        try {
          const parsed = JSON.parse(line);
          const reqId = Number(parsed?.id);
          const req = worker.activeReqs.get(reqId);
          if (req) {
            worker.activeReqs.delete(reqId);
            clearTimeout(req.timer);
            req.resolve({
              ok: Boolean(parsed.ok),
              size: Number(parsed.size ?? 0),
              mtimeMs: Number(parsed.mtimeMs ?? 0),
              error: parsed.error ? String(parsed.error) : undefined,
            });
          }
        } catch {}
      }
    });

    proc.on('error', () => {
      destroyProbeWorker(worker, 'SPAWN_ERROR');
    });

    proc.on('close', (code) => {
      destroyProbeWorker(worker, `EXIT_${code}`);
    });

    probeWorkers.push(worker);
    return worker;
  } catch {
    return null;
  }
}

function ensureProbeWorkerPool(): void {
  while (probeWorkers.length < PROBE_POOL_SIZE) {
    const created = createPersistentProbeWorker();
    if (!created) break;
  }
}

export function warmUpIcloudProbePool(): void {
  if (process.platform !== 'darwin') return;
  ensureProbeWorkerPool();
}

export function primePositiveReadProbeCache(filePath: string, size: number, mtimeMs: number): void {
  if (!filePath || !Number.isFinite(size) || size < 0) return;
  positiveReadProbeCache.set(path.resolve(filePath), {
    expiresAt: Date.now() + POSITIVE_PROBE_TTL_MS,
    size,
    mtimeMs,
  });
}

function runProbePoolJob(
  payload: { op: 'file' | 'dir'; path: string; subdirs?: string[] },
  timeoutMs: number
): Promise<{ ok: boolean; timedOut?: boolean; size?: number; mtimeMs?: number; error?: string }> {
  return new Promise((resolve) => {
    ensureProbeWorkerPool();
    let chosen: PersistentProbeWorker | null = null;
    for (let i = 0; i < probeWorkers.length; i++) {
      const cand = probeWorkers[(rrWorkerIdx + i) % probeWorkers.length];
      if (cand && cand.alive && cand.activeReqs.size < MAX_INFLIGHT_PER_WORKER) {
        chosen = cand;
        rrWorkerIdx = (rrWorkerIdx + i + 1) % Math.max(1, probeWorkers.length);
        break;
      }
    }
    if (!chosen) {
      chosen = createPersistentProbeWorker() || probeWorkers[0] || null;
    }
    if (!chosen || !chosen.alive) {
      resolve({ ok: false, error: 'NO_PROBE_WORKER' });
      return;
    }

    const worker = chosen;
    const id = nextProbeReqId++;
    // macOS 26.7+ Sandbox.kext FileProviderDomain watchdog is 5.003s per uncached vnode component (~30.1s cold walk)
    const effectiveTimeoutMs = Math.max(45_000, timeoutMs);
    const timer = setTimeout(() => {
      const pending = worker.activeReqs.get(id);
      if (!pending) return;
      worker.activeReqs.delete(id);
      worker.hungCount++;
      pending.resolve({ ok: false, timedOut: true, error: `TIMEOUT_${effectiveTimeoutMs}MS` });
      if (worker.hungCount >= 12) {
        destroyProbeWorker(worker, `TIMEOUT_${effectiveTimeoutMs}MS`);
        ensureProbeWorkerPool();
      }
    }, effectiveTimeoutMs);
    if (typeof (timer as any).unref === 'function') {
      (timer as any).unref();
    }

    worker.activeReqs.set(id, { timer, resolve });
    try {
      worker.proc.stdin?.write(JSON.stringify({ id, ...payload }) + '\n');
    } catch (err: any) {
      clearTimeout(timer);
      worker.activeReqs.delete(id);
      destroyProbeWorker(worker, err?.message || 'STDIN_WRITE_ERR');
      ensureProbeWorkerPool();
      resolve({ ok: false, error: err?.message || 'STDIN_WRITE_ERR' });
    }
  });
}

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

export async function probeDocRootOpenableBounded(
  dirPath: string,
  subdirs: string[] = ['05_Clips_Video'],
  timeoutMs = 60_000
): Promise<boolean> {
  const raw = String(dirPath || '').trim();
  if (!raw) return false;
  const resolved = path.resolve(raw);
  const res = await runProbePoolJob({ op: 'dir', path: resolved, subdirs }, Math.max(45_000, timeoutMs));
  return Boolean(res.ok);
}

export function probeFileReadableBounded(
  filePath: string,
  timeoutMs = 45_000,
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

  const task = runProbePoolJob({ op: 'file', path: resolved }, Math.max(1_500, timeoutMs)).then(
    (rawRes): BoundedReadProbeResult => {
      inFlightReadProbes.delete(resolved);
      const res: BoundedReadProbeResult = {
        ok: Boolean(rawRes.ok),
        timedOut: Boolean(rawRes.timedOut),
        size: Number(rawRes.size ?? 0),
        mtimeMs: Number(rawRes.mtimeMs ?? 0),
        error: rawRes.error,
      };
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
      return res;
    }
  );

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
    intro: /^\.?intro(?:[_ -][a-z0-9_ -]+)?\.(?:mp4|mov|m4v|webm)$/i,
    outro: /^\.?outro(?:[_ -][a-z0-9_ -]+)?\.(?:mp4|mov|m4v|webm)$/i,
  };
  if (posterRegexByKind.intro.test(base)) return { kind: 'intro', mediaType: 'poster' };
  if (videoRegexByKind.intro.test(base) || /^00[_ -]?intro/i.test(base)) {
    return { kind: 'intro', mediaType: 'video' };
  }
  if (posterRegexByKind.outro.test(base)) return { kind: 'outro', mediaType: 'poster' };
  if (videoRegexByKind.outro.test(base)) return { kind: 'outro', mediaType: 'video' };
  return null;
}

export const isIntroOutroIcloudPath = mayBeOfficialIntroOutroIcloudPath;

interface DiscoveredIcloudCandidate {
  logicalName: string;
  fullPath: string;
  size: number;
  mtimeMs: number;
  materialized: boolean;
  isEvictedStub: boolean;
  stagedPath?: string;
}

interface DiscoveredKindSources {
  poster: DiscoveredIcloudCandidate | null;
  webPreview: DiscoveredIcloudCandidate | null;
  master: DiscoveredIcloudCandidate | null;
}

interface DiscoverIntroOutroResult {
  ok: boolean;
  resolvedDir: string;
  intro: DiscoveredKindSources;
  outro: DiscoveredKindSources;
  error?: string;
}

const DISCOVER_INTRO_OUTRO_SCRIPT = [
  'const fsp = require("fs/promises");',
  'const path = require("path");',
  'const { spawn } = require("child_process");',
  'const rawTarget = String(process.argv[1] || "");',
  'const stagingOutDir = String(process.argv[2] || "");',
  'function kickBrctl(p) {',
  '  if (process.platform !== "darwin" || !p) return;',
  '  try {',
  '    const c = spawn("/usr/bin/brctl", ["download", p], { detached: true, stdio: "ignore" });',
  '    c.on("error", () => {});',
  '    c.unref();',
  '  } catch {}',
  '}',
  'async function resolveTargetDirAndEntries(target) {',
  '  const direct = Array.from(new Set([target, target.normalize("NFC"), target.normalize("NFD")].filter(Boolean)));',
  '  const directHits = await Promise.all(direct.map(async (cand) => {',
  '    try { const ents = await fsp.readdir(cand, { withFileTypes: true }); return { dir: cand, ents }; } catch { return null; }',
  '  }));',
  '  const foundDirect = directHits.find(Boolean);',
  '  if (foundDirect) return foundDirect;',
  '  const parentRaw = path.dirname(target);',
  '  const parents = Array.from(new Set([parentRaw, parentRaw.normalize("NFC"), parentRaw.normalize("NFD")].filter(Boolean)));',
  '  const parentHits = await Promise.all(parents.map(async (pCand) => {',
  '    try { const ents = await fsp.readdir(pCand, { withFileTypes: true }); return { dir: pCand, ents }; } catch { return null; }',
  '  }));',
  '  for (const pHit of parentHits) {',
  '    if (!pHit) continue;',
  '    for (const d of pHit.ents) {',
  '      if (d.isFile() || d.isSymbolicLink()) continue;',
  '      const norm = String(d.name || "").normalize("NFC").toLowerCase();',
  '      if (norm === "intro:outro" || norm === "intro_outro" || norm === "intro-outro") {',
  '        const full = path.join(pHit.dir, d.name);',
  '        try { const subEnts = await fsp.readdir(full, { withFileTypes: true }); return { dir: full, ents: subEnts }; } catch {}',
  '      }',
  '    }',
  '  }',
  '  return null;',
  '}',
  'async function stageRelativeFile(relName, destPath, minBytes) {',
  '  let fhIn = null, fhOut = null;',
  '  try {',
  '    fhIn = await fsp.open(relName, "r");',
  '    const st = await fhIn.stat();',
  '    if (!st.isFile() || st.size < minBytes || (typeof st.blocks === "number" && st.blocks <= 0)) {',
  '      await fhIn.close(); fhIn = null; return false;',
  '    }',
  '    fhOut = await fsp.open(destPath, "w");',
  '    const buf = Buffer.allocUnsafe(1024 * 1024);',
  '    let pos = 0;',
  '    while (pos < st.size) {',
  '      const { bytesRead } = await fhIn.read(buf, 0, buf.length, pos);',
  '      if (bytesRead <= 0) break;',
  '      let written = 0;',
  '      while (written < bytesRead) {',
  '        const w = await fhOut.write(buf, written, bytesRead - written, pos + written);',
  '        written += w.bytesWritten;',
  '      }',
  '      pos += bytesRead;',
  '    }',
  '    await fhOut.close(); fhOut = null;',
  '    await fhIn.close(); fhIn = null;',
  '    return pos >= minBytes;',
  '  } catch {',
  '    if (fhOut) { try { await fhOut.close(); } catch {} try { await fsp.rm(destPath, { force: true }); } catch {} }',
  '    if (fhIn) { try { await fhIn.close(); } catch {} }',
  '    return false;',
  '  }',
  '}',
  '(async () => {',
  '  try {',
  '    const hit = await resolveTargetDirAndEntries(rawTarget);',
  '    if (!hit) {',
  '      process.stdout.write(JSON.stringify({ ok: false, resolvedDir: "", error: "ICLOUD_DIR_NOT_AVAILABLE" }));',
  '      process.exit(0);',
  '    }',
  '    const resolvedDir = hit.dir;',
  '    let chdirOk = false;',
  '    try { process.chdir(resolvedDir); chdirOk = true; } catch {}',
  '    const byLogical = new Map();',
  '    const toStat = [];',
  '    for (const dirent of hit.ents) {',
  '      const entry = dirent.name;',
  '      if (!entry || entry === ".DS_Store") continue;',
  '      const stubMatch = entry.match(/^\\.(.+)\\.icloud$/i);',
  '      if (stubMatch) {',
  '        const logicalName = stubMatch[1];',
  '        const key = logicalName.normalize("NFC");',
  '        if (!byLogical.has(key)) {',
  '          byLogical.set(key, {',
  '            logicalName,',
  '            fullPath: path.join(resolvedDir, logicalName),',
  '            size: 0,',
  '            mtimeMs: 0,',
  '            materialized: false,',
  '            isEvictedStub: true,',
  '          });',
  '        }',
  '        continue;',
  '      }',
  '      if (!dirent.isDirectory()) toStat.push(entry);',
  '    }',
  '    await Promise.all(toStat.map(async (entry) => {',
  '      const fullPath = path.join(resolvedDir, entry);',
  '      const statTarget = chdirOk ? entry : fullPath;',
  '      try {',
  '        const st = await fsp.stat(statTarget);',
  '        if (!st.isFile()) return;',
  '        const blocks = typeof st.blocks === "number" ? st.blocks : 1;',
  '        const materialized = st.size > 0 && blocks > 0;',
  '        const key = entry.normalize("NFC");',
  '        byLogical.set(key, {',
  '          logicalName: entry,',
  '          fullPath,',
  '          size: Number(st.size || 0),',
  '          mtimeMs: Number(st.mtimeMs || 0),',
  '          materialized,',
  '          isEvictedStub: false,',
  '        });',
  '      } catch {}',
  '    }));',
  '    const items = Array.from(byLogical.values());',
  '    function pickForKind(kind) {',
  '      const posterRe = new RegExp("^\\\\.?" + kind + "[_ -]?poster\\\\.(?:jpg|jpeg|png|webp)$", "i");',
  '      const webRe = new RegExp("^\\\\.?" + kind + "[_ -]?webpreview\\\\.(?:mp4|mov|m4v)$", "i");',
  '      const exactMasterRe = new RegExp("^" + kind + "\\\\.(?:mp4|mov|m4v)$", "i");',
  '      const flexMasterRe = new RegExp("^(?:00[_ -]?)?" + kind + "(?![_ -]?webpreview)(?!.*fallback).*\\\\.(?:mp4|mov|m4v)$", "i");',
  '      const dotMasterRe = new RegExp("^\\\\." + kind + "(?![_ -]?webpreview)(?!.*fallback).*\\\\.(?:mp4|mov|m4v)$", "i");',
  '      const sortBest = (arr, exactTest) => arr.sort((a, b) => {',
  '        if (a.materialized !== b.materialized) return a.materialized ? -1 : 1;',
  '        const aEx = exactTest ? (exactTest(a.logicalName.normalize("NFC")) ? 1 : 0) : 0;',
  '        const bEx = exactTest ? (exactTest(b.logicalName.normalize("NFC")) ? 1 : 0) : 0;',
  '        if (aEx !== bEx) return bEx - aEx;',
  '        if (b.size !== a.size) return b.size - a.size;',
  '        return b.mtimeMs - a.mtimeMs;',
  '      })[0] || null;',
  '      const posters = items.filter((it) => posterRe.test(it.logicalName.normalize("NFC")));',
  '      const webs = items.filter((it) => webRe.test(it.logicalName.normalize("NFC")));',
  '      const masters = items.filter((it) => {',
  '        const n = it.logicalName.normalize("NFC");',
  '        return exactMasterRe.test(n) || flexMasterRe.test(n) || dotMasterRe.test(n);',
  '      });',
  '      const poster = sortBest(posters, (n) => n.startsWith("."));',
  '      const webPreview = sortBest(webs, (n) => n.startsWith("."));',
  '      const master = sortBest(masters, (n) => exactMasterRe.test(n));',
  '      for (const c of [poster, webPreview, master]) {',
  '        if (c && !c.materialized) kickBrctl(c.fullPath);',
  '      }',
  '      return { poster, webPreview, master };',
  '    }',
  '    const introPicked = pickForKind("intro");',
  '    const outroPicked = pickForKind("outro");',
  '    if (stagingOutDir) {',
  '      try { await fsp.mkdir(stagingOutDir, { recursive: true }); } catch {}',
  '      const jobs = [];',
  '      for (const [kName, picked] of [["intro", introPicked], ["outro", outroPicked]]) {',
  '        for (const [slot, minB] of [["poster", 512], ["webPreview", 10000], ["master", 50000]]) {',
  '          const cand = picked[slot];',
  '          if (cand && cand.materialized) {',
  '            const ext = path.extname(cand.logicalName) || (slot === "poster" ? ".jpg" : ".mp4");',
  '            const dest = path.join(stagingOutDir, "batch_" + kName + "_" + slot + ext);',
  '            const openRef = chdirOk ? cand.logicalName : cand.fullPath;',
  '            jobs.push(stageRelativeFile(openRef, dest, minB).then((ok) => { if (ok) cand.stagedPath = dest; }));',
  '          }',
  '        }',
  '      }',
  '      await Promise.all(jobs);',
  '    }',
  '    process.stdout.write(JSON.stringify({',
  '      ok: true,',
  '      resolvedDir,',
  '      intro: introPicked,',
  '      outro: outroPicked,',
  '    }));',
  '    process.exit(0);',
  '  } catch (e) {',
  '    process.stderr.write(String((e && e.code) || (e && e.message) || "DISCOVER_ERR"));',
  '    process.exit(2);',
  '  }',
  '})();',
].join('\n');

const CHUNKED_COPY_FROM_ICLOUD_SCRIPT = [
  'const fs = require("fs");',
  'const path = require("path");',
  'const { spawn } = require("child_process");',
  'const src = process.argv[1];',
  'const dst = process.argv[2];',
  'const minBytes = Math.max(1, Number(process.argv[3] || 512));',
  'const mediaType = String(process.argv[4] || "video");',
  'function kickBrctl(p) {',
  '  if (process.platform !== "darwin" || !p) return;',
  '  try {',
  '    const c = spawn("/usr/bin/brctl", ["download", p], { detached: true, stdio: "ignore" });',
  '    c.on("error", () => {});',
  '    c.unref();',
  '  } catch {}',
  '}',
  'function sleepMs(ms) {',
  '  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);',
  '}',
  'function hasValidMagic(hdr, n, kind) {',
  '  if (n < 12) return false;',
  '  if (kind === "image") {',
  '    const isJpg = hdr[0] === 0xff && hdr[1] === 0xd8 && hdr[2] === 0xff;',
  '    const isPng = hdr[0] === 0x89 && hdr[1] === 0x50 && hdr[2] === 0x4e && hdr[3] === 0x47;',
  '    const isWebp = hdr.subarray(0, 4).toString("ascii") === "RIFF" && hdr.subarray(8, 12).toString("ascii") === "WEBP";',
  '    return isJpg || isPng || isWebp;',
  '  }',
  '  const slice = hdr.subarray(0, Math.min(n, 32));',
  '  if (slice.includes(Buffer.from("ftyp"))) return true;',
  '  if (hdr[0] === 0x1a && hdr[1] === 0x45 && hdr[2] === 0xdf && hdr[3] === 0xa3) return true;',
  '  return false;',
  '}',
  'let fdIn = -1;',
  'let fdOut = -1;',
  'try {',
  '  const deadline = Date.now() + 90000;',
  '  while (true) {',
  '    try {',
  '      fdIn = fs.openSync(src, "r");',
  '      break;',
  '    } catch (openErr) {',
  '      if (openErr && openErr.code === "ENOENT" && Date.now() < deadline) {',
  '        kickBrctl(src);',
  '        sleepMs(1000);',
  '        continue;',
  '      }',
  '      throw openErr;',
  '    }',
  '  }',
  '  const st = fs.fstatSync(fdIn);',
  '  if (!st.isFile()) throw new Error("NOT_REGULAR_FILE");',
  '  if (typeof st.blocks === "number" && st.blocks === 0) kickBrctl(src);',
  '  fdOut = fs.openSync(dst, "w");',
  '  const chunkBuf = Buffer.allocUnsafe(1024 * 1024);',
  '  const hdr = Buffer.alloc(32);',
  '  let hdrLen = 0;',
  '  let bytesCopied = 0;',
  '  while (true) {',
  '    const n = fs.readSync(fdIn, chunkBuf, 0, chunkBuf.length, bytesCopied);',
  '    if (n <= 0) break;',
  '    if (hdrLen < 32) {',
  '      const take = Math.min(32 - hdrLen, n);',
  '      chunkBuf.copy(hdr, hdrLen, 0, take);',
  '      hdrLen += take;',
  '    }',
  '    let written = 0;',
  '    while (written < n) {',
  '      written += fs.writeSync(fdOut, chunkBuf, written, n - written);',
  '    }',
  '    bytesCopied += n;',
  '  }',
  '  if (bytesCopied < minBytes || (st.size > 0 && bytesCopied !== st.size)) {',
  '    throw new Error("INCOMPLETE_COPY_" + bytesCopied + "_OF_" + st.size);',
  '  }',
  '  if (!hasValidMagic(hdr, hdrLen, mediaType)) {',
  '    throw new Error("INVALID_MEDIA_MAGIC_" + mediaType.toUpperCase());',
  '  }',
  '  fs.fsyncSync(fdOut);',
  '  fs.closeSync(fdOut); fdOut = -1;',
  '  fs.closeSync(fdIn); fdIn = -1;',
  '  process.stdout.write(JSON.stringify({ ok: true, size: bytesCopied, mtimeMs: st.mtimeMs }));',
  '  process.exit(0);',
  '} catch (err) {',
  '  try { if (fdOut >= 0) fs.closeSync(fdOut); } catch {}',
  '  try { if (fdIn >= 0) fs.closeSync(fdIn); } catch {}',
  '  try { if (fs.existsSync(dst)) fs.unlinkSync(dst); } catch {}',
  '  process.stderr.write(String((err && err.code) || (err && err.message) || "CHUNK_COPY_ERR"));',
  '  process.exit(3);',
  '}',
].join('\n');

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

function probeDirectoryExistsBounded(dirPath: string, timeoutMs = 3_000): Promise<boolean> {
  if (!dirPath) return Promise.resolve(false);
  return probeDocRootOpenableBounded(dirPath, [], timeoutMs);
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
  let manifestSaveChain: Promise<void> = Promise.resolve();
  let inFlightDiscoveryPromise: Promise<DiscoverIntroOutroResult> | null = null;
  let lastDiscoveryCache: { expiresAt: number; result: DiscoverIntroOutroResult } | null = null;
  const BACKOFF_STEPS_MS = [3_000, 8_000, 15_000, 30_000, 60_000];

  function nextMonotonicVersion(candidateMs?: number): number {
    const cand =
      typeof candidateMs === 'number' && Number.isFinite(candidateMs) && candidateMs > 0
        ? Math.floor(candidateMs)
        : 0;
    return Math.max(
      Date.now(),
      cand,
      (Number(manifest.intro.version) || 0) + 1,
      (Number(manifest.outro.version) || 0) + 1
    );
  }

  function fileNonEmptySyncLocal(filePath: string, minBytes = 512): fs.Stats | null {
    try {
      const st = fs.statSync(filePath);
      if (st.isFile() && st.size >= minBytes) return st;
    } catch {}
    return null;
  }

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

  function saveManifest(): Promise<void> {
    const snapshot: OfficialAssetsManifest = {
      intro: { ...manifest.intro },
      outro: { ...manifest.outro },
    };
    manifestSaveChain = manifestSaveChain
      .catch(() => {})
      .then(async () => {
        try {
          await writeJsonAtomicAsync(manifestPath, snapshot);
        } catch (err) {
          console.warn('[OfficialAssets] Warning saving manifest:', err);
        }
      });
    return manifestSaveChain;
  }

  async function cleanupOrphanStagingFiles(): Promise<void> {
    try {
      await fsp.mkdir(stagingDir, { recursive: true });
      const entries = await fsp.readdir(stagingDir).catch(() => [] as string[]);
      await Promise.all(
        entries.map(async (name) => {
          if (!name || name === 'silence_8s.wav') return;
          const full = path.join(stagingDir, name);
          await fsp.rm(full, { recursive: true, force: true }).catch(() => {});
        })
      );
    } catch {}
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
          version: nextMonotonicVersion(legacySt.mtimeMs),
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
            manifest[kind].version = nextMonotonicVersion(webSt?.mtimeMs);
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

  function discoverIntroOutroSourcesBounded(
    targetDir: string,
    timeoutMs = 120_000
  ): Promise<DiscoverIntroOutroResult> {
    const emptyKind = (): DiscoveredKindSources => ({
      poster: null,
      webPreview: null,
      master: null,
    });
    if (!targetDir) {
      return Promise.resolve({
        ok: false,
        resolvedDir: '',
        intro: emptyKind(),
        outro: emptyKind(),
        error: 'EMPTY_ICLOUD_DIR',
      });
    }
    const now = Date.now();
    if (lastDiscoveryCache && lastDiscoveryCache.expiresAt > now) {
      return Promise.resolve(lastDiscoveryCache.result);
    }
    if (inFlightDiscoveryPromise) return inFlightDiscoveryPromise;

    const promise = new Promise<DiscoverIntroOutroResult>((resolve) => {
      let settled = false;
      let timedOut = false;
      let stdout = '';
      let stderr = '';
      const finish = (res: DiscoverIntroOutroResult) => {
        if (settled) return;
        settled = true;
        inFlightDiscoveryPromise = null;
        if (res.ok) {
          lastDiscoveryCache = { expiresAt: Date.now() + 90_000, result: res };
        }
        resolve(res);
      };
      try {
        const child = spawn(
          process.execPath,
          ['-e', DISCOVER_INTRO_OUTRO_SCRIPT, path.resolve(targetDir), path.resolve(stagingDir)],
          {
            stdio: ['ignore', 'pipe', 'pipe'],
            env: { ...process.env, UV_THREADPOOL_SIZE: '64' },
          }
        );
        const timer = setTimeout(() => {
          timedOut = true;
          try {
            child.kill('SIGKILL');
          } catch {}
        }, Math.max(1_500, timeoutMs));
        child.stdout?.on('data', (chunk) => {
          stdout += chunk.toString();
        });
        child.stderr?.on('data', (chunk) => {
          if (stderr.length < 8_192) stderr += chunk.toString();
        });
        child.on('error', (err) => {
          clearTimeout(timer);
          finish({
            ok: false,
            resolvedDir: '',
            intro: emptyKind(),
            outro: emptyKind(),
            error: err.message || 'DISCOVER_SPAWN_ERR',
          });
        });
        child.on('close', (code) => {
          clearTimeout(timer);
          if (timedOut) {
            finish({
              ok: false,
              resolvedDir: '',
              intro: emptyKind(),
              outro: emptyKind(),
              error: `DISCOVER_TIMEOUT_${timeoutMs}MS`,
            });
            return;
          }
          if (code === 0 && stdout.trim()) {
            try {
              const parsed = JSON.parse(stdout.trim());
              if (parsed && typeof parsed === 'object') {
                finish({
                  ok: Boolean(parsed.ok),
                  resolvedDir: String(parsed.resolvedDir || ''),
                  intro: parsed.intro || emptyKind(),
                  outro: parsed.outro || emptyKind(),
                  error: parsed.error ? String(parsed.error) : undefined,
                });
                return;
              }
            } catch {}
          }
          finish({
            ok: false,
            resolvedDir: '',
            intro: emptyKind(),
            outro: emptyKind(),
            error: stderr.trim() || `DISCOVER_EXIT_${code}`,
          });
        });
      } catch (err: any) {
        finish({
          ok: false,
          resolvedDir: '',
          intro: emptyKind(),
          outro: emptyKind(),
          error: err?.message || 'DISCOVER_EXCEPTION',
        });
      }
    });

    inFlightDiscoveryPromise = promise;
    return promise;
  }

  async function copyFromIcloudSubprocessChunked(
    sourcePath: string,
    destTempPath: string,
    timeoutMs: number,
    minSizeBytes: number,
    expectedMediaType: 'video' | 'image'
  ): Promise<{ ok: boolean; size: number; mtimeMs: number; error?: string }> {
    if (!sourcePath) {
      return { ok: false, size: 0, mtimeMs: 0, error: 'EMPTY_SOURCE_PATH' };
    }
    await fsp.mkdir(path.dirname(destTempPath), { recursive: true });

    const res = await new Promise<{ ok: boolean; size: number; mtimeMs: number; error?: string }>(
      (resolve) => {
        let settled = false;
        let timedOut = false;
        let stdout = '';
        let stderr = '';
        const budget = Math.max(5_000, timeoutMs);
        const finish = (out: { ok: boolean; size: number; mtimeMs: number; error?: string }) => {
          if (settled) return;
          settled = true;
          resolve(out);
        };
        try {
          const child = spawn(
            process.execPath,
            [
              '-e',
              CHUNKED_COPY_FROM_ICLOUD_SCRIPT,
              path.resolve(sourcePath),
              path.resolve(destTempPath),
              String(Math.max(1, minSizeBytes)),
              expectedMediaType,
            ],
            { stdio: ['ignore', 'pipe', 'pipe'] }
          );
          const timer = setTimeout(() => {
            timedOut = true;
            try {
              child.kill('SIGKILL');
            } catch {}
          }, budget);
          child.stdout?.on('data', (chunk) => {
            stdout += chunk.toString();
          });
          child.stderr?.on('data', (chunk) => {
            if (stderr.length < 8_192) stderr += chunk.toString();
          });
          child.on('error', (err) => {
            clearTimeout(timer);
            finish({
              ok: false,
              size: 0,
              mtimeMs: 0,
              error: err.message || 'COPY_SPAWN_ERROR',
            });
          });
          child.on('close', (code) => {
            clearTimeout(timer);
            if (timedOut) {
              kickIcloudDownloadDetached(sourcePath, 5_000);
              finish({
                ok: false,
                size: 0,
                mtimeMs: 0,
                error: `COPY_TIMEOUT_${budget}MS`,
              });
              return;
            }
            if (code === 0 && stdout.trim()) {
              try {
                const parsed = JSON.parse(stdout.trim());
                const size = Number(parsed?.size || 0);
                const mtimeMs = Number(parsed?.mtimeMs || Date.now());
                if (parsed?.ok && size >= minSizeBytes) {
                  finish({ ok: true, size, mtimeMs });
                  return;
                }
              } catch {}
            }
            finish({
              ok: false,
              size: 0,
              mtimeMs: 0,
              error: stderr.trim() || `COPY_EXIT_${code}`,
            });
          });
        } catch (err: any) {
          finish({
            ok: false,
            size: 0,
            mtimeMs: 0,
            error: err?.message || 'COPY_EXCEPTION',
          });
        }
      }
    );

    if (!res.ok) {
      await fsp.rm(destTempPath, { force: true }).catch(() => {});
      return res;
    }

    const verifiedSt = await fileNonEmptyAsync(destTempPath, minSizeBytes);
    if (!verifiedSt) {
      await fsp.rm(destTempPath, { force: true }).catch(() => {});
      return { ok: false, size: 0, mtimeMs: 0, error: 'COPY_EMPTY_LOCAL_FILE' };
    }
    return { ok: true, size: res.size, mtimeMs: res.mtimeMs };
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

      // Fast local self-heal if masterMp4 already exists on local SSD while webMp4 was missing
      let hasMaster = Boolean(await fileNonEmptyAsync(p.masterMp4, 50_000));
      let hasWeb = Boolean(
        manifest[kind].tier === 'icloud_hydrated' && (await fileNonEmptyAsync(p.webMp4, 10_000))
      );
      let hasRealPoster = Boolean(
        manifest[kind].hasRealPoster && (await fileNonEmptyAsync(p.posterJpg, 1024))
      );

      if (hasMaster && !hasWeb && !opts?.force) {
        const builtFromExistingMaster = await buildWebAndPosterFromLocalMaster(
          kind,
          p.masterMp4,
          !hasRealPoster
        );
        if (builtFromExistingMaster) {
          hasWeb = true;
          hasRealPoster = true;
          const masterSt = await fileNonEmptyAsync(p.masterMp4, 50_000);
          manifest[kind] = {
            ...manifest[kind],
            tier: 'icloud_hydrated',
            version: nextMonotonicVersion(masterSt?.mtimeMs),
            updatedAt: new Date().toISOString(),
            hasRealPoster: true,
            lastError: undefined,
          };
          await saveManifest();
          return true;
        }
      }

      if (hasWeb && hasMaster && hasRealPoster && !opts?.force) {
        return true;
      }

      const discovery = await discoverIntroOutroSourcesBounded(introOutroIcloudDir, 120_000);
      if (!discovery.ok) {
        manifest[kind].lastError = discovery.error || 'ICLOUD_DIR_NOT_AVAILABLE';
        await saveManifest();
        return Boolean(await fileNonEmptyAsync(p.webMp4, 4096));
      }

      const cand = discovery[kind];
      const copyBudgetMs = opts?.onDemandTimeoutMs
        ? Math.min(180_000, Math.max(45_000, opts.onDemandTimeoutMs))
        : 160_000;

      let lastCopyError = '';

      const resolveLocalOrCopyFromIcloud = async (
        srcCand: DiscoveredIcloudCandidate,
        destTmp: string,
        budgetMs: number,
        minBytes: number,
        mediaKind: 'video' | 'image'
      ): Promise<{ ok: boolean; size: number; mtimeMs: number; error?: string }> => {
        if (srcCand.stagedPath) {
          const stagedSt = await fileNonEmptyAsync(srcCand.stagedPath, minBytes);
          if (stagedSt) {
            await fsp.copyFile(srcCand.stagedPath, destTmp);
            return {
              ok: true,
              size: stagedSt.size,
              mtimeMs: srcCand.mtimeMs || stagedSt.mtimeMs,
            };
          }
        }
        return copyFromIcloudSubprocessChunked(
          srcCand.fullPath,
          destTmp,
          budgetMs,
          minBytes,
          mediaKind
        );
      };

      const tryHydratePosterFromIcloud = async (budgetMs: number): Promise<void> => {
        if (!cand.poster || (hasRealPoster && !opts?.force)) return;
        const tmpPosterCopy = path.join(
          stagingDir,
          `${kind}_icloud_poster_${crypto.randomUUID()}${path.extname(cand.poster.logicalName) || '.jpg'}`
        );
        const posterCopy = await resolveLocalOrCopyFromIcloud(
          cand.poster,
          tmpPosterCopy,
          budgetMs,
          1024,
          'image'
        );
        if (!posterCopy.ok) {
          await fsp.rm(tmpPosterCopy, { force: true }).catch(() => {});
          return;
        }
        if (/\.jpe?g$/i.test(cand.poster.logicalName)) {
          await fsp.rename(tmpPosterCopy, p.posterJpg);
          hasRealPoster = true;
          manifest[kind].hasRealPoster = true;
        } else {
          const tmpPosterJpg = path.join(stagingDir, `${kind}_icloud_poster_conv_${crypto.randomUUID()}.jpg`);
          const convRes = await runSubprocessBounded(
            getFfmpegBin(),
            [
              '-y',
              '-i',
              tmpPosterCopy,
              '-frames:v',
              '1',
              '-vf',
              'scale=1920:1080:force_original_aspect_ratio=decrease,pad=1920:1080:(ow-iw)/2:(oh-ih)/2:color=#060504,format=yuvj420p',
              '-q:v',
              '3',
              tmpPosterJpg,
            ],
            12_000
          );
          await fsp.rm(tmpPosterCopy, { force: true }).catch(() => {});
          if (convRes.ok && (await fileNonEmptyAsync(tmpPosterJpg, 512))) {
            await fsp.rename(tmpPosterJpg, p.posterJpg);
            hasRealPoster = true;
            manifest[kind].hasRealPoster = true;
          } else {
            await fsp.rm(tmpPosterJpg, { force: true }).catch(() => {});
          }
        }
      };

      const hydrateFromWebPreview = async (): Promise<boolean> => {
        if (!cand.webPreview) return false;
        const tmpRawWeb = path.join(stagingDir, `${kind}_icloud_webpreview_${crypto.randomUUID()}.mp4`);
        const webCopy = await resolveLocalOrCopyFromIcloud(
          cand.webPreview,
          tmpRawWeb,
          copyBudgetMs,
          10_000,
          'video'
        );
        if (!webCopy.ok) {
          lastCopyError = webCopy.error || lastCopyError;
          await fsp.rm(tmpRawWeb, { force: true }).catch(() => {});
          return false;
        }
        const built = await buildWebAndPosterFromLocalMaster(kind, tmpRawWeb, !hasRealPoster);
        await fsp.rm(tmpRawWeb, { force: true }).catch(() => {});
        if (!built) {
          lastCopyError = 'WEBPREVIEW_INVALID_CONTAINER';
          return false;
        }
        hasWeb = true;
        hasRealPoster = true;
        manifest[kind] = {
          ...manifest[kind],
          tier: 'icloud_hydrated',
          version: nextMonotonicVersion(webCopy.mtimeMs),
          updatedAt: new Date().toISOString(),
          fileName: cand.master?.logicalName || cand.webPreview.logicalName,
          hasRealPoster: true,
          lastError: undefined,
        };
        await saveManifest();
        return true;
      };

      const hydrateFromMaster = async (): Promise<boolean> => {
        if (!cand.master) return false;
        const tmpMasterVerify = path.join(stagingDir, `${kind}_icloud_master_${crypto.randomUUID()}.mp4`);
        const masterCopy = await resolveLocalOrCopyFromIcloud(
          cand.master,
          tmpMasterVerify,
          copyBudgetMs,
          50_000,
          'video'
        );
        if (!masterCopy.ok) {
          lastCopyError = masterCopy.error || lastCopyError;
          await fsp.rm(tmpMasterVerify, { force: true }).catch(() => {});
          return false;
        }
        const check = await inspectLocalVideoFile(getFfmpegBin(), tmpMasterVerify, 15_000);
        if (!check.valid) {
          lastCopyError = 'MASTER_INVALID_CONTAINER';
          await fsp.rm(tmpMasterVerify, { force: true }).catch(() => {});
          return false;
        }
        await fsp.rename(tmpMasterVerify, p.masterMp4);
        hasMaster = true;
        if (!hasWeb || opts?.force) {
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
        manifest[kind] = {
          ...manifest[kind],
          tier: hasWeb ? 'icloud_hydrated' : manifest[kind].tier,
          version: nextMonotonicVersion(masterCopy.mtimeMs),
          updatedAt: new Date().toISOString(),
          fileName: cand.master.logicalName,
          hasRealPoster,
          sourceSize: masterCopy.size,
          sourceMtimeMs: masterCopy.mtimeMs,
          lastError: undefined,
        };
        await saveManifest();
        return true;
      };

      if (cand.poster?.materialized) {
        await tryHydratePosterFromIcloud(35_000);
      }

      // Smart hydration order:
      // (a) webPreview materialized -> publish webMp4 immediately, then hydrate masterMp4
      // (b) master materialized or no webPreview -> copy master directly -> transcode 1080p webMp4 + real poster
      // (c) both unmaterialized (blocks === 0 / evicted) -> try webPreview if present, then master with 75s budget
      if (cand.webPreview?.materialized) {
        if (!hasWeb || opts?.force) {
          await hydrateFromWebPreview();
        }
        if ((!hasMaster || opts?.force) && cand.master) {
          await hydrateFromMaster();
        }
      } else if (cand.master?.materialized || !cand.webPreview) {
        if ((!hasMaster || !hasWeb || opts?.force) && cand.master) {
          await hydrateFromMaster();
        }
      } else {
        if (!hasWeb || opts?.force) {
          await hydrateFromWebPreview();
        }
        if ((!hasMaster || !hasWeb || opts?.force) && cand.master) {
          await hydrateFromMaster();
        }
      }

      if (!hasRealPoster && cand.poster) {
        await tryHydratePosterFromIcloud(40_000);
        if (hasRealPoster) {
          manifest[kind].version = nextMonotonicVersion();
          await saveManifest();
        }
      }

      if (!hasWeb && !hasMaster) {
        manifest[kind].lastError =
          lastCopyError ||
          (!cand.master && !cand.webPreview ? 'NO_INTRO_OUTRO_MEDIA_FOUND' : 'ICLOUD_HYDRATION_PENDING');
        await saveManifest();
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

  async function evaluateAndScheduleNextRetry(): Promise<void> {
    const isKindDone = async (kind: OfficialAssetKind): Promise<boolean> => {
      const p = pathsFor(kind);
      if (manifest[kind].tier === 'custom_uploaded') {
        return Boolean(
          (await fileNonEmptyAsync(p.webMp4, 4096)) || (await fileNonEmptyAsync(p.customMp4, 1024))
        );
      }
      return (
        manifest[kind].tier === 'icloud_hydrated' &&
        Boolean(await fileNonEmptyAsync(p.webMp4, 4096)) &&
        Boolean(await fileNonEmptyAsync(p.masterMp4, 50_000))
      );
    };

    const [introDone, outroDone] = await Promise.all([isKindDone('intro'), isKindDone('outro')]);
    if (!introDone || !outroDone) {
      const nextDelay = BACKOFF_STEPS_MS[Math.min(retryStepIdx, BACKOFF_STEPS_MS.length - 1)];
      retryStepIdx++;
      scheduleBackgroundHydration(nextDelay);
    } else {
      retryStepIdx = 0;
    }
  }

  function scheduleBackgroundHydration(delayMs: number): void {
    if (retryTimer) return;
    retryTimer = setTimeout(async () => {
      retryTimer = null;
      try {
        await Promise.all([hydrateKind('intro'), hydrateKind('outro')]);
        await evaluateAndScheduleNextRetry();
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
    warmUpIcloudProbePool();
    void cleanupOrphanStagingFiles()
      .then(() => ensureColdBootFallbacks())
      .then(() => {
        scheduleBackgroundHydration(250);
      });
  }

  function buildStatusPayloadSync(): OfficialAssetsStatusPayload {
    const buildEntrySync = (kind: OfficialAssetKind): OfficialAssetStatusEntry => {
      const p = pathsFor(kind);
      const masterSt = fileNonEmptySyncLocal(p.masterMp4, 50_000);
      const webSt = fileNonEmptySyncLocal(p.webMp4, 4096);
      const customSt = fileNonEmptySyncLocal(p.customMp4, 1024);
      const posterSt = fileNonEmptySyncLocal(p.posterJpg, 512);
      const effectiveTier: OfficialAssetTier =
        customSt && manifest[kind].tier === 'custom_uploaded'
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
        hydrating: Boolean(
          hydratingByKind[kind] || (effectiveTier === 'fallback' && retryTimer !== null)
        ),
        hasMaster: Boolean(masterSt || customSt),
        hasWeb: Boolean(webSt),
        hasPoster: Boolean(posterSt),
        ...(manifest[kind].lastError && effectiveTier === 'fallback'
          ? { error: manifest[kind].lastError }
          : {}),
      };
    };
    const intro = buildEntrySync('intro');
    const outro = buildEntrySync('outro');
    return {
      ok: true,
      version: Math.max(intro.version, outro.version),
      intro,
      outro,
    };
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
        hydrating: Boolean(
          hydratingByKind[kind] || (effectiveTier === 'fallback' && retryTimer !== null)
        ),
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
      if (intro.tier === 'fallback') {
        intro.hydrating = Boolean(hydratingByKind.intro || retryTimer !== null);
      }
      if (outro.tier === 'fallback') {
        outro.hydrating = Boolean(hydratingByKind.outro || retryTimer !== null);
      }
    }
    return {
      ok: true,
      version: Math.max(intro.version, outro.version),
      intro,
      outro,
    };
  }

  function triggerRehydrate(opts?: {
    force?: boolean;
    resetBackoff?: boolean;
  }): { triggered: boolean; status: OfficialAssetsStatusPayload } {
    negativeReadProbeCache.clear();
    lastBrctlKickByPath.clear();
    lastDiscoveryCache = null;
    if (opts?.resetBackoff || opts?.force) {
      retryStepIdx = 0;
    }
    if (retryTimer) {
      clearTimeout(retryTimer);
      retryTimer = null;
    }
    const force = Boolean(opts?.force);
    const alreadyBothInFlight = Boolean(hydratingByKind.intro && hydratingByKind.outro);
    const pIntro = hydrateKind('intro', { force });
    const pOutro = hydrateKind('outro', { force });
    void Promise.all([pIntro, pOutro])
      .then(() => evaluateAndScheduleNextRetry())
      .catch(() => {
        scheduleBackgroundHydration(BACKOFF_STEPS_MS[0]);
      });
    return {
      triggered: !alreadyBothInFlight || force,
      status: buildStatusPayloadSync(),
    };
  }

  async function handleRehydrate(req: Request, res: Response): Promise<void> {
    try {
      await ensureColdBootFallbacks();
      const result = triggerRehydrate({
        force: Boolean(req.body?.force),
        resetBackoff: true,
      });
      const freshStatus = await getStatusPayload();
      res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate');
      res.json({
        ok: true,
        triggered: result.triggered,
        status: freshStatus,
      });
    } catch (err: any) {
      res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate');
      res.status(500).json({
        ok: false,
        error: err?.message || 'Error rehidratando assets oficiales.',
      });
    }
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
      res.on('close', () => {
        if (!res.writableFinished) cleanup();
      });
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
    res.on('close', () => {
      if (!res.writableFinished) cleanup();
    });
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

      const nextVer = nextMonotonicVersion();
      const safeName = String(
        fileName ||
          (kind === 'intro' ? 'Intro_Oficial_Huellas_Custom.mp4' : 'Outro_Oficial_Huellas_Custom.mp4')
      );
      manifest[kind] = {
        tier: 'custom_uploaded',
        version: nextVer,
        updatedAt: new Date().toISOString(),
        fileName: safeName,
        hasRealPoster: true,
        sourceSize: buf.length,
        sourceMtimeMs: nextVer,
        lastError: undefined,
      };
      await saveManifest();

      res.json({
        ok: true,
        hasIntro: true,
        hasOutro: true,
        introUrl: `/api/assets/official-intro-stream?v=${manifest.intro.version}`,
        outroUrl: `/api/assets/official-outro-stream?v=${manifest.outro.version}`,
        posterUrl: `/api/assets/official-${kind}-poster?v=${nextVer}`,
        tier: 'custom_uploaded',
        version: nextVer,
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

    // 3. On-demand bounded hydration (~45s default) from Intro:Outro
    const timeoutMs = opts?.timeoutMs ?? 45_000;
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
    handleUpload: handleUploadCustom,
    resolveForExport,
    hydrateKind,
    triggerRehydrate,
    handleRehydrate,
    isIntroOutroIcloudPath: mayBeOfficialIntroOutroIcloudPath,
  };
}
