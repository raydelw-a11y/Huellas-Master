import fs from 'fs';
import fsp from 'fs/promises';
import os from 'os';
import path from 'path';
import { spawn } from 'child_process';
import type { ClipLoudness } from '../src/utils/audioMix';

/**
 * Loudness of a clip's own audio (EBU R128 integrated loudness + sample peak), measured once per file with FFmpeg
 * and remembered on disk. The editor preview and the export both level each clip's audio from this measurement.
 *
 * A clip that iCloud has evicted from the disk is never read here: opening it would download it, and a
 * documentary can hold hundreds of 4K clips.
 */

export type ClipLoudnessStatus = 'ready' | 'pending' | 'noaudio' | 'dataless' | 'missing';

export interface ClipLoudnessResult {
  status: ClipLoudnessStatus;
  lufs?: number;
  peakDb?: number;
}

interface CacheEntry {
  lufs?: number;
  peakDb?: number;
  noAudio?: boolean;
  at: number;
}

const CACHE_FILE = path.join(os.homedir(), '.huellas-runtime', 'clip-loudness-cache.json');
const CACHE_MAX_ENTRIES = 6000;
const MEASURE_TIMEOUT_MS = 90_000;
const BACKGROUND_PARALLEL = 2;

let cache: Map<string, CacheEntry> | null = null;
let saveTimer: NodeJS.Timeout | null = null;
const inFlight = new Map<string, Promise<ClipLoudnessResult>>();
const backgroundQueue: Array<{ ffmpegBin: string; filePath: string }> = [];
const backgroundQueued = new Set<string>();
let backgroundActive = 0;

function loadCache(): Map<string, CacheEntry> {
  if (cache) return cache;
  cache = new Map();
  try {
    const parsed = JSON.parse(fs.readFileSync(CACHE_FILE, 'utf8'));
    if (parsed && typeof parsed === 'object') {
      for (const [k, v] of Object.entries(parsed as Record<string, CacheEntry>)) {
        if (v && typeof v === 'object') cache.set(k, v);
      }
    }
  } catch {}
  return cache;
}

function scheduleSave(): void {
  if (saveTimer) return;
  saveTimer = setTimeout(() => {
    saveTimer = null;
    try {
      const map = loadCache();
      let entries = Array.from(map.entries());
      if (entries.length > CACHE_MAX_ENTRIES) {
        entries = entries.sort((a, b) => (b[1].at || 0) - (a[1].at || 0)).slice(0, CACHE_MAX_ENTRIES);
        cache = new Map(entries);
      }
      fs.mkdirSync(path.dirname(CACHE_FILE), { recursive: true });
      const tmp = `${CACHE_FILE}.${process.pid}.tmp`;
      fs.writeFileSync(tmp, JSON.stringify(Object.fromEntries(entries)));
      fs.renameSync(tmp, CACHE_FILE);
    } catch {}
  }, 1500);
  saveTimer.unref?.();
}

function cacheKeyFor(filePath: string, st: fs.Stats): string {
  return `${path.resolve(filePath)}|${st.size}|${Math.floor(st.mtimeMs)}`;
}

function isDataless(st: fs.Stats): boolean {
  const blocks = (st as any).blocks;
  return st.size > 0 && typeof blocks === 'number' && blocks === 0;
}

function entryToResult(entry: CacheEntry): ClipLoudnessResult {
  if (entry.noAudio || typeof entry.lufs !== 'number') return { status: 'noaudio' };
  return { status: 'ready', lufs: entry.lufs, peakDb: entry.peakDb };
}

/** Parses the summary FFmpeg's ebur128 filter prints at the end of its log. */
export function parseEbur128Summary(stderrText: string): ClipLoudness | null {
  const at = stderrText.lastIndexOf('Summary:');
  if (at < 0) return null;
  const summary = stderrText.slice(at);
  const mI = summary.match(/\bI:\s+(-?\d+(?:\.\d+)?|-?inf|nan)\s+LUFS/i);
  if (!mI) return null;
  const mP = summary.match(/\bPeak:\s+(-?\d+(?:\.\d+)?|-?inf|nan)\s+dBFS/i);
  const num = (raw: string | undefined, fallback: number) => {
    const n = Number(raw);
    return Number.isFinite(n) ? n : fallback;
  };
  return {
    // ebur128 reports -70.0 (or -inf / nan on some builds) for silence
    lufs: Math.max(-70, num(mI[1], -70)),
    peakDb: Math.max(-120, num(mP?.[1], -120)),
  };
}

function runMeasurement(ffmpegBin: string, filePath: string): Promise<CacheEntry | null> {
  return new Promise((resolve) => {
    let settled = false;
    const done = (val: CacheEntry | null) => {
      if (settled) return;
      settled = true;
      resolve(val);
    };
    let stderrText = '';
    const proc = spawn(
      ffmpegBin,
      ['-hide_banner', '-nostats', '-i', filePath, '-vn', '-map', '0:a:0', '-af', 'ebur128=peak=sample', '-f', 'null', '-'],
      { stdio: ['ignore', 'ignore', 'pipe'] }
    );
    const killTimer = setTimeout(() => {
      try {
        proc.kill('SIGKILL');
      } catch {}
      done(null);
    }, MEASURE_TIMEOUT_MS);
    proc.stderr?.on('data', (d) => {
      stderrText += d.toString();
      // Only the end of the log matters (the summary); keep memory bounded on long files
      if (stderrText.length > 262_144) stderrText = stderrText.slice(-131_072);
    });
    proc.on('error', () => {
      clearTimeout(killTimer);
      done(null);
    });
    proc.on('close', (code) => {
      clearTimeout(killTimer);
      const parsed = parseEbur128Summary(stderrText);
      if (parsed) {
        done({ lufs: parsed.lufs, peakDb: parsed.peakDb, at: Date.now() });
      } else if (/matches no streams|does not contain any stream|Output file .*does not contain/i.test(stderrText)) {
        done({ noAudio: true, at: Date.now() });
      } else {
        // Unknown failure (unreadable file, killed process): not remembered, so it is tried again later
        done(code === 0 ? { noAudio: true, at: Date.now() } : null);
      }
    });
  });
}

/** What is already known about a file, without measuring anything. */
export async function peekClipLoudness(filePath: string): Promise<ClipLoudnessResult & { key?: string }> {
  const st = await fsp.stat(filePath).catch(() => null);
  if (!st || !st.isFile()) return { status: 'missing' };
  const key = cacheKeyFor(filePath, st);
  const hit = loadCache().get(key);
  if (hit) return { ...entryToResult(hit), key };
  if (isDataless(st)) return { status: 'dataless', key };
  return { status: 'pending', key };
}

/**
 * Measures a file now (or returns the remembered measurement). A file evicted by iCloud is only read when the
 * caller says it will read it anyway (`allowDataless`, the export).
 */
export async function measureClipLoudness(
  ffmpegBin: string,
  filePath: string,
  opts: { allowDataless?: boolean } = {}
): Promise<ClipLoudnessResult> {
  const peek = await peekClipLoudness(filePath);
  const mustMeasure = peek.status === 'pending' || (peek.status === 'dataless' && Boolean(opts.allowDataless));
  if (!mustMeasure || !peek.key) return { status: peek.status, lufs: peek.lufs, peakDb: peek.peakDb };
  const key = peek.key;
  const running = inFlight.get(key);
  if (running) return running;
  const task = (async (): Promise<ClipLoudnessResult> => {
    const entry = await runMeasurement(ffmpegBin, filePath);
    if (!entry) return { status: 'missing' };
    loadCache().set(key, entry);
    scheduleSave();
    return entryToResult(entry);
  })().finally(() => {
    inFlight.delete(key);
  });
  inFlight.set(key, task);
  return task;
}

function pumpBackgroundQueue(): void {
  while (backgroundActive < BACKGROUND_PARALLEL && backgroundQueue.length > 0) {
    const job = backgroundQueue.shift()!;
    backgroundActive++;
    void measureClipLoudness(job.ffmpegBin, job.filePath)
      .catch(() => null)
      .finally(() => {
        backgroundQueued.delete(path.resolve(job.filePath));
        backgroundActive--;
        pumpBackgroundQueue();
      });
  }
}

/**
 * What is known about a file right now; if it was never measured, queues the measurement in the background and
 * answers 'pending' (the editor asks again a little later).
 */
export async function getOrQueueClipLoudness(ffmpegBin: string, filePath: string): Promise<ClipLoudnessResult> {
  const peek = await peekClipLoudness(filePath);
  if (peek.status === 'pending') {
    const resolved = path.resolve(filePath);
    if (!backgroundQueued.has(resolved)) {
      backgroundQueued.add(resolved);
      backgroundQueue.push({ ffmpegBin, filePath });
      pumpBackgroundQueue();
    }
  }
  return { status: peek.status, lufs: peek.lufs, peakDb: peek.peakDb };
}
