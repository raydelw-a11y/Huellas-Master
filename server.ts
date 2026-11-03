import express from 'express';
import path from 'path';
import fs from 'fs';
import os from 'os';
import { exec, execSync, spawn, ChildProcess } from 'child_process';
import multer from 'multer';
import dotenv from 'dotenv';
import cors from 'cors';
import { GoogleGenAI, Type } from '@google/genai';
import speech from '@google-cloud/speech';
import textToSpeech from '@google-cloud/text-to-speech';
import { createServer as createViteServer } from 'vite';
import ffmpegStatic from 'ffmpeg-static';

// Load local .env first
dotenv.config();

// Auto-discover credentials from sibling apps (VoxFlow & Narration-Timeline-Extractor) without modifying them
const SIBLING_VOXFLOW_DIR = path.resolve(process.cwd(), '..', 'VoxFlow');
const SIBLING_EXTRACTOR_DIR = path.resolve(process.cwd(), '..', 'Narration-Timeline-Extractor');

function loadSiblingEnv(envPath: string) {
  try {
    if (fs.existsSync(envPath)) {
      const parsed = dotenv.parse(fs.readFileSync(envPath, 'utf8'));
      for (const [k, v] of Object.entries(parsed)) {
        if (!process.env[k] && v) {
          process.env[k] = v;
        }
      }
    }
  } catch (e) {
    console.warn('[Init] Warning reading sibling env:', envPath);
  }
}

loadSiblingEnv(path.join(SIBLING_VOXFLOW_DIR, '.env'));
loadSiblingEnv(path.join(SIBLING_EXTRACTOR_DIR, '.env'));

process.on('uncaughtException', (err) => {
  console.error('[Huellas Master Server] Uncaught Exception:', err);
});
process.on('unhandledRejection', (reason) => {
  console.error('[Huellas Master Server] Unhandled Rejection:', reason);
});

const app = express();
const PORT = process.env.PORT ? parseInt(process.env.PORT, 10) : 4200;

app.use((req, res, next) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
  res.setHeader(
    'Access-Control-Allow-Headers',
    'Content-Type, Authorization, Range, Access-Control-Request-Private-Network'
  );
  res.setHeader(
    'Access-Control-Expose-Headers',
    'Content-Range, Accept-Ranges, Content-Length'
  );
  res.setHeader('Access-Control-Allow-Private-Network', 'true');
  res.setHeader('Cross-Origin-Resource-Policy', 'cross-origin');
  if (req.method === 'OPTIONS') {
    res.sendStatus(204);
    return;
  }
  next();
});
app.use(cors({ origin: '*', optionsSuccessStatus: 200 }));
app.use(express.json({ limit: '200mb' }));
app.use(express.urlencoded({ limit: '200mb', extended: true }));

// Initialize Local Database Directories inside Huellas Master/data
const DATA_DIR = path.join(process.cwd(), 'data');
const TTS_DIR = path.join(DATA_DIR, 'tts-files');
const ASSETS_DIR = path.join(DATA_DIR, 'assets');
const CHUNK_DIR = path.join(os.tmpdir(), 'huellas-master-chunks');
const DOCS_FILE = path.join(DATA_DIR, 'documentaries.json');
const CONFIG_FILE = path.join(DATA_DIR, 'config.json');
const CUSTOM_VOICES_FILE = path.join(DATA_DIR, 'custom_voices.json');

for (const dir of [DATA_DIR, TTS_DIR, ASSETS_DIR, CHUNK_DIR]) {
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
}

// Seed config.json & custom_voices.json from VoxFlow if not yet created locally
try {
  const voxConfig = path.join(SIBLING_VOXFLOW_DIR, 'data', 'config.json');
  if (!fs.existsSync(CONFIG_FILE) && fs.existsSync(voxConfig)) {
    fs.copyFileSync(voxConfig, CONFIG_FILE);
  }
  const voxVoices = path.join(SIBLING_VOXFLOW_DIR, 'data', 'custom_voices.json');
  if (!fs.existsSync(CUSTOM_VOICES_FILE) && fs.existsSync(voxVoices)) {
    fs.copyFileSync(voxVoices, CUSTOM_VOICES_FILE);
  }
} catch (e) {
  console.warn('[Init] Could not seed initial config from VoxFlow:', e);
}

// Serve static local audio & asset files (with automatic .wav -> .mp3 fallback)
app.use(
  '/tts-files',
  (req, res, next) => {
    if (req.path.toLowerCase().endsWith('.wav')) {
      const wavPath = path.join(TTS_DIR, req.path);
      const mp3Path = wavPath.replace(/\.wav$/i, '.mp3');
      if (!fs.existsSync(wavPath) && fs.existsSync(mp3Path)) {
        res.sendFile(mp3Path);
        return;
      }
    }
    next();
  },
  express.static(TTS_DIR)
);
app.use('/assets', express.static(ASSETS_DIR));

// Probe FFmpeg & FFprobe
let ffmpegAvailable = !!ffmpegStatic;
let ffprobeAvailable = false;

exec(`"${ffmpegStatic}" -version`, (err) => {
  if (!err) ffmpegAvailable = true;
});
exec('ffprobe -version', (err) => {
  if (!err) ffprobeAvailable = true;
});

function getFfmpegPath(): string {
  if (ffmpegStatic && fs.existsSync(ffmpegStatic)) return ffmpegStatic;
  return 'ffmpeg';
}

// ============================================================================
// CREDENTIALS & GEMINI CLIENT MANAGEMENT
// ============================================================================
function getMaskedKey(key: string): string {
  if (!key || key.length < 8) return '';
  return `${key.slice(0, 6)}••••••••••••••••••••••••••${key.slice(-4)}`;
}

function getSavedGeminiKey(): string {
  try {
    if (fs.existsSync(CONFIG_FILE)) {
      const cfg = JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf8'));
      if (cfg.geminiApiKey && typeof cfg.geminiApiKey === 'string' && !cfg.geminiApiKey.startsWith('AQ.')) {
        return cfg.geminiApiKey.trim();
      }
    }
  } catch {}

  const candidates = [
    process.env.GEMINI_API_KEY,
    process.env.GCP_API_KEY,
    process.env.GOOGLE_CLOUD_API_KEY,
    process.env.API_KEY,
  ];
  for (const c of candidates) {
    if (c && c.trim() && !c.trim().startsWith('AQ.')) {
      return c.trim();
    }
  }
  return '';
}

function saveGeminiKey(key: string) {
  const cleanKey = key.trim();
  process.env.GEMINI_API_KEY = cleanKey;
  let cfg: any = {};
  if (fs.existsSync(CONFIG_FILE)) {
    try {
      cfg = JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf8'));
    } catch {}
  }
  cfg.geminiApiKey = cleanKey;
  fs.writeFileSync(CONFIG_FILE, JSON.stringify(cfg, null, 2), 'utf8');
}

function getGeminiClient(): GoogleGenAI | null {
  const key = getSavedGeminiKey();
  if (!key) return null;
  try {
    return new GoogleGenAI({
      apiKey: key,
      httpOptions: { headers: { 'User-Agent': 'aistudio-build' } },
    });
  } catch (e) {
    console.error('Error creating GoogleGenAI client:', e);
    return null;
  }
}

app.get('/api/status', (req, res) => {
  const activeKey = getSavedGeminiKey();
  const hasGeminiKey = !!activeKey;
  const maskedKey = hasGeminiKey ? getMaskedKey(activeKey) : '';
  res.json({
    hasGeminiKey,
    maskedKey,
    gcsBucket: null,
    storageMode: 'local',
    authMethod: hasGeminiKey ? `Activa (${maskedKey})` : null,
    hasElevenLabsKey: !!process.env.ELEVENLABS_API_KEY,
    hasGoogleTts: true,
    ffmpegAvailable,
  });
});

app.get('/api/health', (req, res) => {
  res.json({
    status: 'ok',
    ffmpeg_available: ffmpegAvailable,
    ffprobe_available: ffprobeAvailable,
    model_available: !!(getSavedGeminiKey() || process.env.GOOGLE_APPLICATION_CREDENTIALS_JSON),
  });
});

app.post('/api/settings/gemini-key', async (req, res) => {
  try {
    const { key } = req.body;
    if (!key || typeof key !== 'string' || !key.trim()) {
      res.status(400).json({ error: 'La clave API no puede estar vacía.' });
      return;
    }
    const cleanKey = key.trim();
    saveGeminiKey(cleanKey);
    res.json({
      success: true,
      maskedKey: getMaskedKey(cleanKey),
      message: '¡Gemini API Key guardada y activada en Huellas Master!',
    });
  } catch (err: any) {
    res.status(400).json({ error: err.message || 'Error al guardar la clave.' });
  }
});

// ============================================================================
// DOCUMENTARIES DATABASE CRUD (/api/documentaries)
// ============================================================================
const DEFAULT_OPERATIONAL_HEADER_SERVER = `Actúa como un historiador, director de cine, y periodista profesional.
Cambia los nombres de los clips a las primeras 6 palabras literales del prompt proveído pegado y enviado que incluyen la numeración.
Usa Veo 3.1 - Lite [Lower Priority] para videos y nano banana 2.1 para imágenes iniciales de cada clip.
Crea las imágenes primero y luego los clips usando cada imagen como fotograma inicial.
Usa las imágenes de referencia de personas y lugares para generar las imágenes iniciales y los clips para mantener fidelidad visual.
No hagas cambios de shot nunca en ningun clip (excepto en aquel clip específico donde el prompt indique expresamente hacer dos shots de 5 segundos cada uno porque la voz narrativa cambió de escena) y asegúrate de que los clips de video no hagan desapariciones ni transformaciones, la imagen inicial creada se usará para el inicio de cada clip.
Divide la creación en batches de 10.
rename everything adding _ as the blank spaces between words
from 1 to 9 change them to 01 to 09`;

function ensureOperationalHeaderText(rawText: string, operationalHeader?: string): string {
  const header = (operationalHeader || DEFAULT_OPERATIONAL_HEADER_SERVER).trim();
  const trimmed = (rawText || '').trim();
  if (!trimmed) return '';
  if (
    /^Act[uú]a como un historiador/i.test(trimmed) ||
    trimmed.includes('Cambia los nombres de los clips a las primeras 6 palabras')
  ) {
    return trimmed;
  }
  return `${header}\n\n${trimmed}`;
}

function readDocumentaries(): any[] {
  try {
    if (fs.existsSync(DOCS_FILE)) {
      const data = JSON.parse(fs.readFileSync(DOCS_FILE, 'utf8'));
      if (Array.isArray(data)) {
        let modified = false;
        for (const doc of data) {
          if (doc && typeof doc.rawClipsText === 'string' && doc.rawClipsText.trim()) {
            const fixed = ensureOperationalHeaderText(doc.rawClipsText, doc.operationalHeader);
            if (fixed !== doc.rawClipsText) {
              doc.rawClipsText = fixed;
              modified = true;
            }
          }
        }
        if (modified) {
          fs.writeFileSync(DOCS_FILE, JSON.stringify(data, null, 2), 'utf8');
        }
        return data;
      }
    }
  } catch (e) {
    console.error('Error reading documentaries.json:', e);
  }
  return [];
}

const GITHUB_OWNER = 'raydelw-a11y';
const GITHUB_REPO = 'Huellas-Master';
const GITHUB_BRANCH = 'main';

function getLocalGitHubToken(): string {
  try {
    if (fs.existsSync(CONFIG_FILE)) {
      const cfg = JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf8'));
      if (cfg.githubToken && typeof cfg.githubToken === 'string' && cfg.githubToken.trim()) {
        return cfg.githubToken.trim();
      }
    }
  } catch {}

  if (process.env.GITHUB_TOKEN && process.env.GITHUB_TOKEN.trim()) {
    return process.env.GITHUB_TOKEN.trim();
  }

  try {
    const out = execSync(
      'printf "protocol=https\\nhost=github.com\\n\\n" | git credential-osxkeychain get',
      { encoding: 'utf8', stdio: ['pipe', 'pipe', 'ignore'] }
    );
    for (const line of out.split(/\r?\n/)) {
      if (line.startsWith('password=')) {
        return line.slice('password='.length).trim();
      }
    }
  } catch {}

  return '';
}

let lastPushedGitHubJson = '';

function writeDocumentaries(list: any[], skipCloudPush = false) {
  const jsonStr = JSON.stringify(list, null, 2);
  try {
    const currentDisk = fs.existsSync(DOCS_FILE) ? fs.readFileSync(DOCS_FILE, 'utf8') : '';
    if (currentDisk !== jsonStr) {
      fs.writeFileSync(DOCS_FILE, jsonStr, 'utf8');
    }
  } catch {
    fs.writeFileSync(DOCS_FILE, jsonStr, 'utf8');
  }
  try {
    if (fs.existsSync(DOCS_FILE)) {
      lastServerWriteDocsMtimeMs = Math.floor(fs.statSync(DOCS_FILE).mtimeMs);
      serverDocsRevisionCounter = Math.max(serverDocsRevisionCounter + 1, lastServerWriteDocsMtimeMs);
    }
  } catch {}
  try {
    const docsDataDir = path.join(process.cwd(), 'docs', 'data');
    if (fs.existsSync(docsDataDir)) {
      const docsTarget = path.join(docsDataDir, 'documentaries.json');
      const currentDocsDisk = fs.existsSync(docsTarget) ? fs.readFileSync(docsTarget, 'utf8') : '';
      if (currentDocsDisk !== jsonStr) {
        fs.writeFileSync(docsTarget, jsonStr, 'utf8');
      }
    }
  } catch {}
  if (!skipCloudPush) {
    scheduleGitHubPush();
  }
}

let githubPushTimer: NodeJS.Timeout | null = null;
function scheduleGitHubPush() {
  if (githubPushTimer) clearTimeout(githubPushTimer);
  githubPushTimer = setTimeout(() => {
    syncDocumentariesWithGitHubServer(false).catch((e) =>
      console.warn('[CloudSync] Auto push warning:', e?.message || e)
    );
  }, 2500);
}

async function getServerGitHubFileSha(filePath: string, token: string): Promise<string | null> {
  try {
    const dirPath = filePath.includes('/') ? filePath.split('/').slice(0, -1).join('/') : '';
    const fileName = filePath.split('/').pop() || filePath;
    const url = `https://api.github.com/repos/${GITHUB_OWNER}/${GITHUB_REPO}/contents/${dirPath}?ref=${GITHUB_BRANCH}&t=${Date.now()}`;
    const headers: Record<string, string> = {
      Accept: 'application/vnd.github+json',
      'User-Agent': 'HuellasMaster-Studio',
    };
    if (token) headers['Authorization'] = `token ${token}`;
    const res = await fetch(url, { headers });
    if (!res.ok) return null;
    const items: any = await res.json();
    if (Array.isArray(items)) {
      const found = items.find((it: any) => it && it.name === fileName);
      return found?.sha || null;
    }
  } catch {}
  return null;
}

function mergeServerDocObjects(winner: any, other: any) {
  if (!winner || !other) return winner || other;
  if (!Array.isArray(winner.clips) || !Array.isArray(other.clips) || other.clips.length === 0) {
    return winner;
  }
  const otherClipByNum = new Map<number, any>();
  for (const c of other.clips) {
    if (c && typeof c.clipNumber === 'number') {
      otherClipByNum.set(c.clipNumber, c);
    }
  }
  const mergedClips = winner.clips.map((c: any) => {
    const o = otherClipByNum.get(c.clipNumber);
    if (!o) return c;
    return {
      ...c,
      reviewedForEditor:
        c.reviewedForEditor !== undefined
          ? Boolean(c.reviewedForEditor)
          : Boolean(o.reviewedForEditor),
      recreated: Boolean(c.recreated || o.recreated),
      videoReady: Boolean(c.videoReady || o.videoReady),
      imageReady: Boolean(c.imageReady || o.imageReady),
      videoSavedFileName: c.videoSavedFileName || o.videoSavedFileName,
      videoFrames:
        Array.isArray(c.videoFrames) && c.videoFrames.length > 0 ? c.videoFrames : o.videoFrames,
    };
  });
  return { ...winner, clips: mergedClips };
}

function stripHeavyMediaForGitHubServer(list: any[], stripReferenceImages = false): any[] {
  return (list || []).map((doc: any) => ({
    ...doc,
    ...(stripReferenceImages &&
    typeof doc.thumbnailImageUrl === 'string' &&
    doc.thumbnailImageUrl.startsWith('data:') &&
    doc.thumbnailImageUrl.length > 60000
      ? { thumbnailImageUrl: '' }
      : {}),
    ...(stripReferenceImages &&
    typeof doc.masterAudioUrl === 'string' &&
    doc.masterAudioUrl.startsWith('data:') &&
    doc.masterAudioUrl.length > 60000
      ? { masterAudioUrl: '' }
      : {}),
    ...(stripReferenceImages && Array.isArray(doc.audioTracks)
      ? {
          audioTracks: doc.audioTracks.map((t: any) =>
            typeof t?.audioUrl === 'string' && t.audioUrl.startsWith('data:') && t.audioUrl.length > 60000
              ? { ...t, audioUrl: '' }
              : t
          ),
        }
      : {}),
    ...(stripReferenceImages && Array.isArray(doc.references)
      ? {
          references: doc.references.map((r: any) =>
            typeof r?.imageUrl === 'string' && r.imageUrl.startsWith('data:') && r.imageUrl.length > 60000
              ? { ...r, imageUrl: '' }
              : r
          ),
        }
      : {}),
    clips: Array.isArray(doc.clips)
      ? doc.clips.map((c: any) => {
          if (!c?.videoFrames || c.videoFrames.length === 0) return c;
          const { videoFrames, ...rest } = c;
          return rest;
        })
      : [],
  }));
}

async function syncDocumentariesWithGitHubServer(pullFirst = true): Promise<{
  synced: boolean;
  total: number;
  error?: string;
}> {
  const token = getLocalGitHubToken();
  const initialLocalList = readDocumentaries();
  if (!token) {
    return { synced: false, total: initialLocalList.length, error: 'No GitHub token found' };
  }

  let mergedList = initialLocalList;
  if (pullFirst) {
    try {
      const sha = await getServerGitHubFileSha('data/documentaries.json', token);
      if (sha) {
        const blobRes = await fetch(
          `https://api.github.com/repos/${GITHUB_OWNER}/${GITHUB_REPO}/git/blobs/${sha}?t=${Date.now()}`,
          {
            headers: {
              Accept: 'application/vnd.github.raw+json',
              Authorization: `token ${token}`,
              'User-Agent': 'HuellasMaster-Studio',
            },
          }
        );
        if (blobRes.ok) {
          const remoteList: any = await blobRes.json();
          if (Array.isArray(remoteList)) {
            // Re-read localList AFTER network await so concurrent PUT /api/documentaries/:id writes are never overwritten!
            const latestLocalList = readDocumentaries();
            const byId = new Map<string, any>();
            for (const r of remoteList) {
              if (r && r.id) byId.set(r.id, r);
            }
            for (const l of latestLocalList) {
              if (!l || !l.id) continue;
              const existing = byId.get(l.id);
              if (!existing) {
                byId.set(l.id, l);
              } else {
                const lTime = Date.parse(l.updatedAt || l.createdAt || '') || 0;
                const rTime = Date.parse(existing.updatedAt || existing.createdAt || '') || 0;
                if (lTime >= rTime) {
                  byId.set(l.id, mergeServerDocObjects(l, existing));
                } else {
                  byId.set(l.id, mergeServerDocObjects(existing, l));
                }
              }
            }
            mergedList = Array.from(byId.values()).sort((a, b) => {
              const tA = Date.parse(a.updatedAt || a.createdAt || '') || 0;
              const tB = Date.parse(b.updatedAt || b.createdAt || '') || 0;
              return tB - tA;
            });
            if (JSON.stringify(mergedList) !== JSON.stringify(latestLocalList)) {
              writeDocumentaries(mergedList, true);
            }
          }
        }
      }
    } catch (e) {
      console.warn('[CloudSync] Pull warning:', e);
    }
    return { synced: true, total: mergedList.length };
  }

  try {
    const freshLocalList = readDocumentaries();
    let jsonStr = JSON.stringify(freshLocalList, null, 2);
    if (jsonStr.length > 900000) {
      jsonStr = JSON.stringify(stripHeavyMediaForGitHubServer(freshLocalList, false), null, 2);
      if (jsonStr.length > 900000) {
        jsonStr = JSON.stringify(stripHeavyMediaForGitHubServer(freshLocalList, true), null, 2);
      }
    }
    if (jsonStr === lastPushedGitHubJson) {
      return { synced: true, total: freshLocalList.length };
    }
    lastPushedGitHubJson = jsonStr;
    const encodedContent = Buffer.from(jsonStr, 'utf8').toString('base64');
    const headers: Record<string, string> = {
      Accept: 'application/vnd.github+json',
      Authorization: `token ${token}`,
      'Content-Type': 'application/json',
      'User-Agent': 'HuellasMaster-Studio',
    };

    for (const targetPath of ['data/documentaries.json', 'docs/data/documentaries.json']) {
      const existingSha = await getServerGitHubFileSha(targetPath, token);
      const bodyObj: Record<string, any> = {
        message: `Sync ${targetPath} (${freshLocalList.length} documentales)`,
        content: encodedContent,
        branch: GITHUB_BRANCH,
      };
      if (existingSha) bodyObj.sha = existingSha;

      await fetch(`https://api.github.com/repos/${GITHUB_OWNER}/${GITHUB_REPO}/contents/${targetPath}`, {
        method: 'PUT',
        headers,
        body: JSON.stringify(bodyObj),
      });
    }
    return { synced: true, total: freshLocalList.length };
  } catch (e: any) {
    return { synced: false, total: mergedList.length, error: e?.message || 'Error pushing to GitHub' };
  }
}

app.get('/api/cloud/setup-link', (req, res) => {
  const g = getSavedGeminiKey();
  const h = getLocalGitHubToken();
  const payload = Buffer.from(JSON.stringify({ g, h }), 'utf8').toString('base64');
  const url = `https://${GITHUB_OWNER}.github.io/${GITHUB_REPO}/#setup=${payload}`;
  res.json({
    url,
    publicUrl: `https://${GITHUB_OWNER}.github.io/${GITHUB_REPO}/`,
    hasGeminiKey: !!g,
    hasGitHubToken: !!h,
  });
});

app.post('/api/cloud/sync', async (req, res) => {
  const result = await syncDocumentariesWithGitHubServer(true);
  res.json({
    ...result,
    documentaries: readDocumentaries(),
  });
});

let lastServerWriteDocsMtimeMs = 0;
let serverDocsRevisionCounter = Date.now();

function getServerVersionInfo(): {
  codeMtimeMs: number;
  docsMtimeMs: number;
  docsRevision: number;
} {
  const codeCandidates = [
    path.join(process.cwd(), 'src', 'App.tsx'),
    path.join(process.cwd(), 'src', 'components', 'CapCutEditor.tsx'),
    path.join(process.cwd(), 'src', 'components', 'PromptGenerator.jsx'),
    path.join(process.cwd(), 'src', 'utils', 'cloudSync.ts'),
    path.join(process.cwd(), 'server.ts'),
    path.join(process.cwd(), 'docs', 'index.html'),
  ];
  let codeMtimeMs = 0;
  for (const p of codeCandidates) {
    try {
      if (fs.existsSync(p)) {
        const st = fs.statSync(p);
        if (st.mtimeMs > codeMtimeMs) codeMtimeMs = Math.floor(st.mtimeMs);
      }
    } catch {}
  }
  let docsMtimeMs = 0;
  try {
    if (fs.existsSync(DOCS_FILE)) {
      const st = fs.statSync(DOCS_FILE);
      docsMtimeMs = Math.floor(st.mtimeMs);
      if (docsMtimeMs > lastServerWriteDocsMtimeMs + 50) {
        // External/disk modification detected (e.g. code update or git pull); advance revision so disk always wins over stale tabs
        lastServerWriteDocsMtimeMs = docsMtimeMs;
        serverDocsRevisionCounter = Math.max(serverDocsRevisionCounter + 1, docsMtimeMs);
      }
    }
  } catch {}
  return {
    codeMtimeMs,
    docsMtimeMs,
    docsRevision: serverDocsRevisionCounter,
  };
}

app.get('/api/version', (_req, res) => {
  res.json(getServerVersionInfo());
});

app.get('/api/documentaries', (req, res) => {
  const v = getServerVersionInfo();
  res.setHeader('X-Server-Code-Version', String(v.codeMtimeMs));
  res.setHeader('X-Server-Docs-Version', String(v.docsRevision));
  res.json(readDocumentaries());
});

app.get('/api/documentaries/:id', (req, res) => {
  const list = readDocumentaries();
  const doc = list.find((d) => d.id === req.params.id);
  if (!doc) {
    res.status(404).json({ error: 'Documental no encontrado.' });
    return;
  }
  const v = getServerVersionInfo();
  res.setHeader('X-Server-Code-Version', String(v.codeMtimeMs));
  res.setHeader('X-Server-Docs-Version', String(v.docsRevision));
  res.json(doc);
});

app.post('/api/documentaries', (req, res) => {
  const list = readDocumentaries();
  const now = new Date().toISOString();
  const body = req.body || {};
  const newDoc = {
    id: `doc-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
    title: body.title || 'Nuevo Documental — Huellas de la Humanidad',
    subtitle: body.subtitle || '',
    productionType: body.productionType || 'DOCUMENTAL_16X9',
    status: body.status || 'planificacion',
    createdAt: now,
    updatedAt: now,
    promptConfig: body.promptConfig || {
      TIPO_PRODUCCION: 'REELS',
      SUB_OPCION_POST: 'EXPECTATIVA_ESTRENO',
      SUB_OPCION_REELS: body.productionType === 'REEL_9X16' ? '9X16' : '16X9',
      SINCRONIZACION_CLIP_1: 'VOZ_EN_CLIP_2',
      TEXTO_PANTALLA_CLIP_1: 'CAPCUT_MANUAL',
      DURACION_CLIP_1: '6',
      DURACION_CLIPS: '10_SEGUNDOS',
      VOZ_NARRATIVA_EN_CLIPS: 'INCLUIR',
      UBICACION_INTRO_MARCA: 'INTRO_INICIO_00',
    },
    compiledMasterPrompt: body.compiledMasterPrompt || '',
    topic: body.topic || '',
    typology: body.typology || 'Un suceso histórico',
    historicalTime: body.historicalTime || '',
    historicalLocation: body.historicalLocation || '',
    targetDurationSeconds: body.targetDurationSeconds || 120,
    clipDurationMode: body.clipDurationMode || '10_SEGUNDOS',
    clip1SyncMode: body.clip1SyncMode || 'VOZ_EN_CLIP_2',
    clip1DurationSeconds: body.clip1DurationSeconds || 6,
    sectionsStructure: body.sectionsStructure || '',
    deepResearchPrompt: body.deepResearchPrompt || '',
    deepResearchResult: body.deepResearchResult || '',
    voiceoverScript: body.voiceoverScript || '',
    selectedVoice: body.selectedVoice || 'Charon',
    selectedStyle: body.selectedStyle || 'dramatic',
    selectedSpeed: body.selectedSpeed || 'medium',
    selectedLanguage: body.selectedLanguage || 'es-la',
    audioTracks: body.audioTracks || [],
    masterAudioUrl: body.masterAudioUrl || '',
    timelineSentences: body.timelineSentences || [],
    timelineFormattedText: body.timelineFormattedText || '',
    timelineSettings: body.timelineSettings || {
      language: 'es',
      customLanguage: '',
      quality: 'high',
      outputStyle: 'timeline',
      timestampFormat: 'MM:SS',
      sentenceMode: 'split-10-seconds',
      noBlankLines: true,
      strictNarration: false,
      removeFiller: false,
      mergeShort: false,
      preservePunctuation: true,
      includeLineNumbers: true,
    },
    rawReferencePrompts: body.rawReferencePrompts || '',
    references: body.references || [],
    clip1TextMode: body.clip1TextMode || 'CAPCUT_MANUAL',
    clip1Line1LocationTime: body.clip1Line1LocationTime || '',
    clip1Line2Hook: body.clip1Line2Hook || '',
    clip1OptionsRaw: body.clip1OptionsRaw || '',
    operationalHeader: body.operationalHeader || '',
    rawClipsText: body.rawClipsText || '',
    clips: body.clips || [],
    capcutRawSrt: body.capcutRawSrt || '',
    correctedSrt: body.correctedSrt || '',
    srtFileName: body.srtFileName || 'captions_corregidos',
    confirmedFinalDuration: body.confirmedFinalDuration || '02:00',
    rawSunoText: body.rawSunoText || '',
    sunoTracks: body.sunoTracks || [],
    thumbnailOrientation:
      body.thumbnailOrientation ||
      (body.productionType === 'REEL_9X16' ? 'VERTICAL_9X16' : 'HORIZONTAL_16X9'),
    thumbnailTextOptions: body.thumbnailTextOptions || [],
    thumbnailPrompt: body.thumbnailPrompt || '',
    thumbnailTextOverlay: body.thumbnailTextOverlay || '',
    thumbnailImageUrl: body.thumbnailImageUrl || '',
    thumbnailReady: false,
    platform: body.platform || 'YOUTUBE',
    rawMetadataText: body.rawMetadataText || '',
    rawYoutubeMetadata: body.rawYoutubeMetadata || body.rawMetadataText || '',
    rawFacebookMetadata: body.rawFacebookMetadata || '',
    publishTitle: body.publishTitle || '',
    publishDescription: body.publishDescription || '',
    youtubeChapters: body.youtubeChapters || '',
    aiNote: body.aiNote || '',
    slogan: body.slogan || 'Cada historia deja una huella. Aquí seguimos sus rastros.',
    hashtags: body.hashtags || '',
    youtubeTags: body.youtubeTags || '',
    pinnedComment: body.pinnedComment || '',
  };

  list.unshift(newDoc);
  writeDocumentaries(list);
  res.json(newDoc);
});

app.put('/api/documentaries/:id', (req, res) => {
  const vBefore = getServerVersionInfo();
  const list = readDocumentaries();
  const idx = list.findIndex((d) => d.id === req.params.id);
  const incomingBody = { ...(req.body || {}) };
  const patchKeys: string[] | undefined = Array.isArray(incomingBody._patchKeys)
    ? incomingBody._patchKeys
    : undefined;
  const clientDocsVersion = Number(incomingBody._clientDocsVersion || 0);
  const clientCodeVersion = Number(incomingBody._clientCodeVersion || 0);
  const isBackgroundCacheSync = Boolean(incomingBody._isBackgroundCacheSync);
  delete incomingBody._patchKeys;
  delete incomingBody._clientDocsVersion;
  delete incomingBody._clientCodeVersion;
  delete incomingBody._isBackgroundCacheSync;

  if (idx === -1) {
    // Upsert documentary if it existed in browser cache or another device but wasn't in local data/documentaries.json yet
    const now = new Date().toISOString();
    const upserted = {
      ...incomingBody,
      id: req.params.id,
      createdAt: incomingBody?.createdAt || now,
      updatedAt: now,
    };
    list.unshift(upserted);
    writeDocumentaries(list);
    const vAfter = getServerVersionInfo();
    res.setHeader('X-Server-Code-Version', String(vAfter.codeMtimeMs));
    res.setHeader('X-Server-Docs-Version', String(vAfter.docsRevision));
    res.json(upserted);
    return;
  }

  const currentDiskDoc = list[idx];

  // VERSION LOCK: If an un-refreshed tab attempts a background/cache sync (no explicit _patchKeys)
  // or carries an older clientDocsVersion/clientCodeVersion without explicit field patchKeys,
  // NEVER let it overwrite the newer disk documentary! Return the authoritative disk documentary instead.
  if (
    isBackgroundCacheSync ||
    (!patchKeys &&
      ((clientDocsVersion > 0 && clientDocsVersion < vBefore.docsRevision) ||
        (clientCodeVersion > 0 && clientCodeVersion < vBefore.codeMtimeMs)))
  ) {
    res.setHeader('X-Server-Code-Version', String(vBefore.codeMtimeMs));
    res.setHeader('X-Server-Docs-Version', String(vBefore.docsRevision));
    res.setHeader('X-Server-Version-Locked', 'true');
    res.json(currentDiskDoc);
    return;
  }

  // SMART FIELD-LEVEL MERGE: When _patchKeys is provided by updateActiveDoc(patch),
  // apply ONLY the explicitly edited fields onto currentDiskDoc so stale fields in an un-refreshed tab's memory never overwrite disk changes!
  let updated: any;
  if (patchKeys && patchKeys.length > 0) {
    const surgicalPatch: Record<string, any> = {};
    for (const key of patchKeys) {
      if (key === 'id' || key === 'createdAt') continue;
      if (key === 'promptConfig' && incomingBody.promptConfig && typeof incomingBody.promptConfig === 'object') {
        surgicalPatch.promptConfig = {
          ...(currentDiskDoc.promptConfig || {}),
          ...incomingBody.promptConfig,
        };
      } else if (
        key === 'timelineSettings' &&
        incomingBody.timelineSettings &&
        typeof incomingBody.timelineSettings === 'object'
      ) {
        surgicalPatch.timelineSettings = {
          ...(currentDiskDoc.timelineSettings || {}),
          ...incomingBody.timelineSettings,
        };
      } else if (key in incomingBody) {
        surgicalPatch[key] = incomingBody[key];
      }
    }
    updated = {
      ...currentDiskDoc,
      ...surgicalPatch,
      id: currentDiskDoc.id,
      updatedAt: new Date().toISOString(),
    };
  } else {
    updated = {
      ...currentDiskDoc,
      ...incomingBody,
      promptConfig: {
        ...(currentDiskDoc.promptConfig || {}),
        ...(incomingBody.promptConfig || {}),
      },
      id: currentDiskDoc.id,
      updatedAt: new Date().toISOString(),
    };
  }

  list[idx] = updated;
  writeDocumentaries(list);
  const vAfter = getServerVersionInfo();
  res.setHeader('X-Server-Code-Version', String(vAfter.codeMtimeMs));
  res.setHeader('X-Server-Docs-Version', String(vAfter.docsRevision));
  res.json(updated);
});

app.delete('/api/documentaries/:id', (req, res) => {
  let list = readDocumentaries();
  list = list.filter((d) => d.id !== req.params.id);
  writeDocumentaries(list);
  res.json({ success: true });
});

app.post('/api/documentaries/:id/duplicate', (req, res) => {
  const list = readDocumentaries();
  const orig = list.find((d) => d.id === req.params.id);
  if (!orig) {
    res.status(404).json({ error: 'Documental no encontrado.' });
    return;
  }
  const now = new Date().toISOString();
  const copy = {
    ...JSON.parse(JSON.stringify(orig)),
    id: `doc-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
    title: `${orig.title} (Copia)`,
    createdAt: now,
    updatedAt: now,
  };
  list.unshift(copy);
  writeDocumentaries(list);
  res.json(copy);
});

// ============================================================================
// ASSET UPLOAD API (Reference Images, Thumbnails, Suno MP3s, CapCut Audios)
// ============================================================================
const assetStorage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, ASSETS_DIR),
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname) || '.bin';
    const safeBase = path
      .basename(file.originalname, ext)
      .replace(/[^a-zA-Z0-9_-]/g, '_')
      .slice(0, 45);
    cb(null, `asset-${Date.now()}-${safeBase}${ext}`);
  },
});
const uploadAsset = multer({ storage: assetStorage, limits: { fileSize: 150 * 1024 * 1024 } });

app.post('/api/assets/upload', uploadAsset.single('file'), (req, res) => {
  if (!req.file) {
    res.status(400).json({ error: 'No se recibió ningún archivo.' });
    return;
  }
  const url = `/assets/${req.file.filename}`;
  res.json({
    filename: req.file.filename,
    originalName: req.file.originalname,
    url,
  });
});

// ============================================================================
// VOXFLOW TTS ENGINE INTEGRATED (/api/tts, /api/custom-voices)
// ============================================================================
function getCustomVoices(): any[] {
  try {
    if (fs.existsSync(CUSTOM_VOICES_FILE)) {
      return JSON.parse(fs.readFileSync(CUSTOM_VOICES_FILE, 'utf8'));
    }
  } catch {}
  return [];
}

app.get('/api/custom-voices', (req, res) => {
  res.json({ voices: getCustomVoices() });
});

app.post('/api/custom-voices', (req, res) => {
  const { name, styleDescription, baseVoice, speed, prompt } = req.body;
  const voices = getCustomVoices();
  const newVoice = {
    id: `voice_${Date.now()}`,
    name: (name || 'Voz Personalizada').trim(),
    styleDescription: (styleDescription || '').trim(),
    baseVoice: baseVoice || 'Charon',
    speed: speed || 'medium',
    prompt: prompt || '',
    createdAt: new Date().toISOString(),
  };
  voices.unshift(newVoice);
  fs.writeFileSync(CUSTOM_VOICES_FILE, JSON.stringify(voices, null, 2), 'utf8');
  res.json({ voice: newVoice, voices });
});

function pcmToWav(pcmBuffer: Buffer, sampleRate: number = 24000): Buffer {
  const numChannels = 1;
  const bitsPerSample = 16;
  const byteRate = sampleRate * numChannels * (bitsPerSample / 8);
  const blockAlign = numChannels * (bitsPerSample / 8);
  const wavHeader = Buffer.alloc(44);
  wavHeader.write('RIFF', 0);
  wavHeader.writeUInt32LE(36 + pcmBuffer.length, 4);
  wavHeader.write('WAVE', 8);
  wavHeader.write('fmt ', 12);
  wavHeader.writeUInt32LE(16, 16);
  wavHeader.writeUInt16LE(1, 20);
  wavHeader.writeUInt16LE(numChannels, 22);
  wavHeader.writeUInt32LE(sampleRate, 24);
  wavHeader.writeUInt32LE(byteRate, 28);
  wavHeader.writeUInt16LE(blockAlign, 32);
  wavHeader.writeUInt16LE(bitsPerSample, 34);
  wavHeader.write('data', 36);
  wavHeader.writeUInt32LE(pcmBuffer.length, 40);
  return Buffer.concat([wavHeader, pcmBuffer]);
}

function extractPcmFromWav(wavBuffer: Buffer): Buffer {
  let current = wavBuffer;
  let guard = 0;
  while (
    current.length >= 12 &&
    current.toString('binary', 0, 4) === 'RIFF' &&
    current.toString('binary', 8, 12) === 'WAVE' &&
    guard < 5
  ) {
    guard++;
    let foundData = false;
    let index = 12;
    while (index < current.length - 8) {
      const chunkName = current.toString('binary', index, index + 4);
      let chunkSize = 0;
      try {
        chunkSize = current.readUInt32LE(index + 4);
      } catch {
        break;
      }
      if (chunkName === 'data') {
        const dataStart = index + 8;
        const dataEnd = Math.min(dataStart + chunkSize, current.length);
        current = current.subarray(dataStart, dataEnd);
        foundData = true;
        break;
      }
      index += 8 + chunkSize + (chunkSize % 2);
      if (chunkSize <= 0 || index <= 12) break;
    }
    if (!foundData) {
      if (current.length >= 44) current = current.subarray(44);
      else break;
    }
  }
  if (current.length % 2 !== 0) {
    current = current.subarray(0, current.length - 1);
  }
  return current;
}

function applyMicroFade(pcmBuffer: Buffer, fadeSamples: number = 240): Buffer {
  const evenLen = pcmBuffer.length - (pcmBuffer.length % 2);
  const numSamples = Math.floor(evenLen / 2);
  if (numSamples < fadeSamples * 2) return pcmBuffer.subarray(0, evenLen);
  const out = Buffer.from(pcmBuffer.subarray(0, evenLen));

  // Detect and silence any high-frequency static/radio interference bursts (e.g. trailing Gemini TTS artifacts)
  const winSamples = 480; // 20ms at 24kHz
  const numWins = Math.floor(numSamples / winSamples);
  if (numWins > 0) {
    const burstWins = new Uint8Array(numWins);
    for (let w = 0; w < numWins; w++) {
      const startSample = w * winSamples;
      let sumSq = 0;
      let diffSq = 0;
      let maxAbs = 0;
      let prev = out.readInt16LE(startSample * 2);
      for (let i = 0; i < winSamples; i++) {
        const s = out.readInt16LE((startSample + i) * 2);
        const a = Math.abs(s);
        if (a > maxAbs) maxAbs = a;
        sumSq += s * s;
        const d = s - prev;
        diffSq += d * d;
        prev = s;
      }
      const rms = Math.sqrt(sumSq / winSamples) / 32768;
      const peak = maxAbs / 32768;
      const hfRms = Math.sqrt(diffSq / winSamples) / 65536;
      if (hfRms > 0.13 && (peak > 0.72 || rms > 0.11)) {
        burstWins[w] = 1;
      }
    }
    for (let w = 0; w < numWins; w++) {
      if (burstWins[w] === 1) {
        const s0 = Math.max(0, (w - 1) * winSamples);
        const s1 = Math.min(numSamples, (w + 2) * winSamples);
        for (let i = s0; i < s1; i++) {
          out.writeInt16LE(0, i * 2);
        }
      }
    }
  }

  for (let i = 0; i < fadeSamples; i++) {
    const factor = i / fadeSamples;
    const sample = out.readInt16LE(i * 2);
    out.writeInt16LE(Math.round(sample * factor), i * 2);
  }
  for (let i = 0; i < fadeSamples; i++) {
    const factor = (fadeSamples - i) / fadeSamples;
    const idx = (numSamples - fadeSamples + i) * 2;
    const sample = out.readInt16LE(idx);
    out.writeInt16LE(Math.round(sample * factor), idx);
  }
  return out;
}

function getAudioDurationInSeconds(buffer: Buffer, defaultSampleRate: number = 24000): number {
  try {
    if (
      buffer.length >= 44 &&
      buffer.toString('binary', 0, 4) === 'RIFF' &&
      buffer.toString('binary', 8, 12) === 'WAVE'
    ) {
      const sampleRate = buffer.readUInt32LE(24) || defaultSampleRate;
      const numChannels = buffer.readUInt16LE(22) || 1;
      const bitsPerSample = buffer.readUInt16LE(34) || 16;
      const byteRate = buffer.readUInt32LE(28) || sampleRate * numChannels * (bitsPerSample / 8);
      const pcmData = extractPcmFromWav(buffer);
      if (byteRate > 0 && pcmData.length > 0) {
        return parseFloat((pcmData.length / byteRate).toFixed(2));
      }
    }
  } catch {}
  return parseFloat(((buffer.length > 44 ? buffer.length - 44 : buffer.length) / 48000).toFixed(2));
}

interface TextOrPauseSegment {
  type: 'text' | 'pause';
  text?: string;
  duration?: number;
}

// Reconoce [1s], [2s], [3s], [1.5s], [1], [2], [3], [1}, [2}, {2s], [pausa: 2s], [pausa 2], [silencio: 2s], <break time="2s"/>
const UNIVERSAL_PAUSE_REGEX =
  /[\[{]\s*(?:(?:pausa|pause|silencio)\s*:?\s*)?([0-9]{1,2}(?:[.,][0-9]+)?)\s*(s|seg|segundos|ms|milisegundos)?\s*[\]}]|[\[{]\s*(?:pausa|pause|silencio)\s*[\]}]|<break\s+time=["']?([0-9]+(?:\.[0-9]+)?)(s|ms)["']?\s*\/?>/gi;

function parseTextWithPauses(rawText: string): TextOrPauseSegment[] {
  if (!rawText) return [];
  const pauseRegex = new RegExp(UNIVERSAL_PAUSE_REGEX.source, 'gi');
  const segments: TextOrPauseSegment[] = [];
  let lastIndex = 0;
  let match: RegExpExecArray | null;

  while ((match = pauseRegex.exec(rawText)) !== null) {
    const textBefore = rawText.slice(lastIndex, match.index);
    if (textBefore.trim()) {
      segments.push({ type: 'text', text: textBefore.trim() });
    }
    let durationSec = 1.5;
    if (match[1] !== undefined) {
      const val = parseFloat(match[1].replace(',', '.'));
      const unit = (match[2] || 's').toLowerCase();
      durationSec = unit.startsWith('ms') || unit.startsWith('mili') ? val / 1000 : val;
    } else if (match[3] !== undefined) {
      const val = parseFloat(match[3].replace(',', '.'));
      const unit = (match[4] || 's').toLowerCase();
      durationSec = unit === 'ms' ? val / 1000 : val;
    }
    durationSec = Math.max(0.1, Math.min(30, durationSec));
    segments.push({ type: 'pause', duration: durationSec });
    lastIndex = match.index + match[0].length;
  }

  const remainingText = rawText.slice(lastIndex);
  if (remainingText.trim()) {
    segments.push({ type: 'text', text: remainingText.trim() });
  }
  return segments;
}

let gcloudTtsClient: any = null;
function getGcloudTtsClient() {
  if (!gcloudTtsClient) {
    try {
      const defaultJson = process.env.GOOGLE_APPLICATION_CREDENTIALS_JSON;
      if (defaultJson) {
        const credentials = JSON.parse(defaultJson);
        gcloudTtsClient = new textToSpeech.TextToSpeechClient({ credentials });
      } else {
        gcloudTtsClient = new textToSpeech.TextToSpeechClient();
      }
    } catch (e) {
      console.warn('Error initializing Google Cloud TTS Client:', e);
    }
  }
  return gcloudTtsClient;
}

async function synthesizeSpeechCore({
  text,
  voice = 'Charon',
  style = 'dramatic',
  speed = 'medium',
  language = 'es-la',
  consistencyMode = true,
  customStyleDescription,
}: {
  text: string;
  voice?: string;
  style?: string;
  speed?: string;
  language?: string;
  consistencyMode?: boolean;
  customStyleDescription?: string;
}): Promise<{ buffer: Buffer; providerUsed: string }> {
  const cleanText = text
    .replace(new RegExp(UNIVERSAL_PAUSE_REGEX.source, 'gi'), '')
    .trim();
  if (!cleanText) {
    return { buffer: pcmToWav(Buffer.alloc(4800), 24000), providerUsed: 'Silencio' };
  }

  const ai = getGeminiClient();
  const physicalVoices: Record<string, string> = {
    Kore: 'Kore', Aoede: 'Aoede', Puck: 'Puck', Charon: 'Charon', Fenrir: 'Fenrir', Zephyr: 'Zephyr',
    Adam: 'Fenrir', Antoni: 'Zephyr', Bella: 'Aoede', Domi: 'Kore', Grace: 'Aoede', Michael: 'Charon', Rachel: 'Aoede', Serena: 'Kore',
    Journey_F: 'Aoede', Journey_M: 'Charon', Wavenet_A: 'Kore', Wavenet_B: 'Fenrir', Neural2_F: 'Kore', Neural2_M: 'Zephyr',
  };
  const physicalVoice = physicalVoices[voice] || 'Charon';

  const languageInstructions: Record<string, string> = {
    es: 'Speak in Spanish with native European Spanish pronunciation.',
    'es-la': 'Speak in Spanish with a neutral, solemn, warm Latin American documentary accent (Español Neutro). Do NOT use European Spanish ceceo.',
    en: 'Speak in English with a native accent.',
    pt: 'Speak in Portuguese with a native accent.',
    fr: 'Speak in French with a native accent.',
    de: 'Speak in German with a native accent.',
  };

  const styleDescriptions: Record<string, string> = {
    standard: 'Speak clearly with a professional documentary narrator cadence.',
    dramatic: 'Speak with deep cinematic documentary gravitas, emotional resonance, and deliberate pacing.',
    formal: 'Speak formally with historical rigor, solemn tone, and crisp articulation.',
    whisper: 'Speak in a soft, intimate, mysterious low-volume voice.',
    cheerful: 'Speak with bright, engaging enthusiasm.',
  };

  const speedDescriptions: Record<string, string> = {
    slow: 'Speak slowly and deliberately.',
    medium: 'Speak at a measured, natural documentary narration speed.',
    fast: 'Speak at a brisk, dynamic pace while keeping every word clear.',
  };

  const langInstr = languageInstructions[language] || languageInstructions['es-la'];
  const speedInstr = speedDescriptions[speed] || speedDescriptions.medium;
  const styleInstr = customStyleDescription || styleDescriptions[style] || styleDescriptions.dramatic;

  // ElevenLabs direct path if configured and selected
  const elevenVoices: Record<string, string> = {
    Adam: 'pNInz6obpg7ANgmeW148', Antoni: 'ErXwobaYiN019vkySvjV', Bella: 'EXAVITQu4vr4xnSDxMaL',
    Domi: 'AZnzlk1XvdvUeBnXmlld', Grace: 'oWA07Hg9P7m8COV6hTh7', Michael: 'flq6f7yk4E4fJM5XTYuz',
    Rachel: '21m00Tcm4TlvDq8ikWAM', Serena: 'pMs2g854xbocwMw7G8S4',
  };
  if (elevenVoices[voice] && process.env.ELEVENLABS_API_KEY) {
    try {
      const resEl = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${elevenVoices[voice]}`, {
        method: 'POST',
        headers: {
          'xi-api-key': process.env.ELEVENLABS_API_KEY,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          text: cleanText,
          model_id: 'eleven_multilingual_v2',
          voice_settings: { stability: 0.55, similarity_boost: 0.78 },
        }),
      });
      if (resEl.ok) {
        const ab = await resEl.arrayBuffer();
        return { buffer: Buffer.from(ab), providerUsed: 'ElevenLabs API' };
      }
    } catch (e) {
      console.warn('ElevenLabs fallback to Gemini:', e);
    }
  }

  if (!ai) {
    throw new Error('Configura tu Gemini API Key en el botón de llave superior para sintetizar voz.');
  }

  const fullPrompt = `[DIRECTOR_INSTRUCTION]
Vocal Character Profile: "${voice}" (Physical base "${physicalVoice}")
Mood, Emotion & Delivery: ${styleInstr} ${consistencyMode ? 'Maintain strict vocal consistency and uniform documentary pitch.' : ''}
Vocal Speed: ${speedInstr}
Accent & Language Vibe: ${langInstr}

ACTOR INSTRUCTION: Deliver the exact text inside [TEXT] once from beginning to end. Never repeat sentences, never read markup tags or brackets.

[TEXT]
${cleanText}`;

  // Usar EXCLUSIVAMENTE el último modelo TTS oficial (gemini-3.8-flash-tts) sin caer en modelos anteriores
  const targetModel = 'gemini-3.8-flash-tts';
  let generation: any = null;
  let lastErr: any = null;
  let usedModel = '';

  for (let attempt = 0; attempt < 4; attempt++) {
    try {
      generation = await ai.models.generateContent({
        model: targetModel,
        contents: [{ parts: [{ text: fullPrompt }] }],
        config: {
          responseModalities: ['AUDIO'],
          speechConfig: {
            voiceConfig: {
              prebuiltVoiceConfig: { voiceName: physicalVoice as any },
            },
          },
        },
      });
      if (generation?.candidates?.[0]?.content?.parts?.[0]?.inlineData?.data) {
        const rawData = generation.candidates[0].content.parts[0].inlineData.data;
        const tempBuffer = Buffer.from(rawData, 'base64');
        const tempSec = tempBuffer.length / 48000;
        const wCount = cleanText.split(/\s+/).filter(Boolean).length;
        const expectedSec = wCount / 2.0;

        if (wCount >= 20 && tempSec > expectedSec * 2.3 && attempt < 3) {
          console.warn(
            `[Gemini TTS] Posible duplicación detectada en ${targetModel} (${tempSec.toFixed(1)}s vs ~${expectedSec.toFixed(1)}s). Reintentando con ${targetModel}...`
          );
          await new Promise((r) => setTimeout(r, 800));
          continue;
        }

        usedModel = targetModel;
        break;
      }
    } catch (e: any) {
      lastErr = e;
      if (attempt < 3) {
        await new Promise((r) => setTimeout(r, 1500 * (attempt + 1)));
        continue;
      }
      break;
    }
  }

  const base64Audio = generation?.candidates?.[0]?.content?.parts?.[0]?.inlineData?.data;
  if (!base64Audio) {
    throw new Error(`Error al sintetizar audio con ${targetModel}: ${lastErr?.message || 'Sin datos de audio'}`);
  }

  const rawPcmBuffer = Buffer.from(base64Audio, 'base64');
  const buffer =
    rawPcmBuffer.length >= 12 &&
    rawPcmBuffer.toString('binary', 0, 4) === 'RIFF' &&
    rawPcmBuffer.toString('binary', 8, 12) === 'WAVE'
      ? rawPcmBuffer
      : pcmToWav(rawPcmBuffer, 24000);

  return {
    buffer,
    providerUsed: 'Gemini 3.8 Flash TTS',
  };
}

function convertWavToMp3(wavPath: string, mp3Path: string): Promise<boolean> {
  return new Promise((resolve) => {
    const ffmpegBin = getFfmpegPath();
    exec(`"${ffmpegBin}" -y -i "${wavPath}" -codec:a libmp3lame -b:a 192k "${mp3Path}"`, (err) => {
      resolve(!err && fs.existsSync(mp3Path));
    });
  });
}

app.post('/api/tts', async (req, res) => {
  try {
    const {
      text,
      voice = 'Charon',
      style = 'dramatic',
      speed = 'medium',
      language = 'es-la',
      consistencyMode = true,
      label = '',
      customStyleDescription,
    } = req.body;

    if (!text || typeof text !== 'string' || !text.trim()) {
      res.status(400).json({ error: 'El texto del guion es requerido para generar la locución.' });
      return;
    }

    const segments = parseTextWithPauses(text);
    const hasPauses = segments.some((s) => s.type === 'pause');

    let buffer: Buffer;
    let providerUsed = 'Gemini TTS';

    if (!hasPauses) {
      const result = await synthesizeSpeechCore({
        text,
        voice,
        style,
        speed,
        language,
        consistencyMode,
        customStyleDescription,
      });
      buffer = result.buffer;
      providerUsed = result.providerUsed;
    } else {
      const pauseCount = segments.filter((s) => s.type === 'pause').length;
      const totalPauseSec = segments
        .filter((s) => s.type === 'pause')
        .reduce((acc, s) => acc + (s.duration || 0), 0);
      console.log(
        `[TTS Pauses] Detectadas ${pauseCount} pausas (${totalPauseSec.toFixed(1)}s totales). Sintetizando segmentos con silencios PCM exactos...`
      );
      const pcmBuffers: Buffer[] = [];
      for (const seg of segments) {
        if (seg.type === 'pause' && seg.duration) {
          const pauseSamples = Math.round(24000 * seg.duration);
          pcmBuffers.push(Buffer.alloc(pauseSamples * 2));
        } else if (seg.type === 'text' && seg.text) {
          const result = await synthesizeSpeechCore({
            text: seg.text,
            voice,
            style,
            speed,
            language,
            consistencyMode,
            customStyleDescription,
          });
          providerUsed = result.providerUsed;
          const pcm = extractPcmFromWav(result.buffer);
          pcmBuffers.push(applyMicroFade(pcm, 240));
        }
      }
      buffer = pcmToWav(Buffer.concat(pcmBuffers), 24000);
      providerUsed = `${providerUsed} (${pauseCount} Pausas · ${totalPauseSec.toFixed(1)}s)`;
    }

    const wordCount = text
      .replace(new RegExp(UNIVERSAL_PAUSE_REGEX.source, 'gi'), '')
      .split(/\s+/)
      .filter(Boolean).length;
    const fileId = `tts-${Date.now()}-${Math.floor(Math.random() * 1000)}`;
    const wavFilename = `${fileId}.wav`;
    const mp3Filename = `${fileId}.mp3`;
    const localWavPath = path.join(TTS_DIR, wavFilename);
    const localMp3Path = path.join(TTS_DIR, mp3Filename);
    fs.writeFileSync(localWavPath, buffer);

    const mp3Success = await convertWavToMp3(localWavPath, localMp3Path);
    const filename = mp3Success ? mp3Filename : wavFilename;

    const actualDuration = getAudioDurationInSeconds(buffer);
    const newRecord = {
      id: fileId,
      label: label || `Locución (${voice})`,
      text,
      voice,
      style,
      speed,
      language,
      consistencyMode,
      filename,
      audioUrl: `tts-files/${filename}`,
      createdAt: new Date().toISOString(),
      storageMode: 'local',
      wordCount,
      duration: actualDuration,
      providerUsed,
    };

    res.json(newRecord);
  } catch (error: any) {
    console.error('Error en /api/tts:', error);
    res.status(500).json({ error: error.message || 'Error interno al sintetizar locución.' });
  }
});

// Merge multiple TTS tracks into a single Master Narration MP3
app.post('/api/tts/merge', async (req, res) => {
  try {
    const { filenames, text, voice, style, speed, language, label } = req.body;
    if (!Array.isArray(filenames) || filenames.length === 0) {
      res.status(400).json({ error: 'Selecciona al menos 2 pistas para fusionar.' });
      return;
    }
    const pcmBuffers: Buffer[] = [];
    for (const name of filenames) {
      const safeName = path.basename(name);
      const baseWithoutExt = safeName.replace(/\.(?:wav|mp3)$/i, '');
      const wavCandidate = path.join(TTS_DIR, `${baseWithoutExt}.wav`);
      const exactCandidate = path.join(TTS_DIR, safeName);
      const targetWavPath = fs.existsSync(wavCandidate) ? wavCandidate : exactCandidate;
      if (!fs.existsSync(targetWavPath)) {
        res.status(404).json({ error: `Archivo no encontrado: ${safeName}` });
        return;
      }
      pcmBuffers.push(extractPcmFromWav(fs.readFileSync(targetWavPath)));
    }

    const pauseSamples = Math.round(24000 * 0.25);
    const silenceBuffer = Buffer.alloc(pauseSamples * 2);
    const combinedChunks: Buffer[] = [];
    pcmBuffers.forEach((b, idx) => {
      combinedChunks.push(applyMicroFade(b, 240));
      if (idx < pcmBuffers.length - 1) combinedChunks.push(silenceBuffer);
    });

    const combinedWav = pcmToWav(Buffer.concat(combinedChunks), 24000);
    const fileId = `tts-master-${Date.now()}`;
    const wavFilename = `${fileId}.wav`;
    const mp3Filename = `${fileId}.mp3`;
    const localWavPath = path.join(TTS_DIR, wavFilename);
    const localMp3Path = path.join(TTS_DIR, mp3Filename);
    fs.writeFileSync(localWavPath, combinedWav);

    const mp3Success = await convertWavToMp3(localWavPath, localMp3Path);
    const filename = mp3Success ? mp3Filename : wavFilename;

    const duration = getAudioDurationInSeconds(combinedWav);
    res.json({
      id: fileId,
      label: label || 'Voz Narrativa Video',
      text: text || 'Audio Maestro Fusionado',
      voice: voice || 'Charon',
      style: style || 'dramatic',
      speed: speed || 'medium',
      language: language || 'es-la',
      filename,
      audioUrl: `tts-files/${filename}`,
      createdAt: new Date().toISOString(),
      storageMode: 'local',
      wordCount: (text || '').split(/\s+/).filter(Boolean).length,
      duration,
      providerUsed: 'VoxFlow Master Merge',
    });
  } catch (err: any) {
    res.status(500).json({ error: err.message || 'Error al fusionar audios.' });
  }
});

// Download any TTS voiceover track guaranteed in MP3 format
app.get('/api/tts/download-mp3', async (req, res) => {
  try {
    const rawFile = String(req.query.file || '').trim();
    const rawDownloadName = String(req.query.name || 'Voz Narrativa Video.mp3').trim();
    if (!rawFile) {
      res.status(400).json({ error: 'Se requiere el parámetro file.' });
      return;
    }

    const safeBase = path.basename(rawFile).replace(/\.(?:wav|mp3)$/i, '');
    const mp3Path = path.join(TTS_DIR, `${safeBase}.mp3`);
    const wavPath = path.join(TTS_DIR, `${safeBase}.wav`);

    if (!fs.existsSync(mp3Path)) {
      if (!fs.existsSync(wavPath)) {
        res.status(404).json({ error: 'El archivo de audio no existe en el servidor.' });
        return;
      }
      const converted = await convertWavToMp3(wavPath, mp3Path);
      if (!converted || !fs.existsSync(mp3Path)) {
        res.status(500).json({ error: 'No se pudo convertir el audio a MP3.' });
        return;
      }
    }

    const finalDownloadName = rawDownloadName.toLowerCase().endsWith('.mp3')
      ? rawDownloadName
      : `${rawDownloadName.replace(/\.wav$/i, '')}.mp3`;

    res.download(mp3Path, finalDownloadName);
  } catch (err: any) {
    res.status(500).json({ error: err.message || 'Error al descargar el audio en MP3.' });
  }
});

// ============================================================================
// NARRATION TIMELINE EXTRACTOR ENGINE INTEGRATED
// ============================================================================
const chunkUpload = multer({
  dest: CHUNK_DIR,
  limits: { fileSize: 150 * 1024 * 1024 },
});

app.post('/api/upload-chunk', chunkUpload.single('chunk'), (req, res) => {
  try {
    const { uploadId, chunkIndex, totalChunks } = req.body;
    if (!uploadId || !req.file) {
      res.status(400).json({ error: 'Falta uploadId o archivo chunk.' });
      return;
    }
    const finalFilePath = path.join(CHUNK_DIR, `${path.basename(uploadId)}`);
    const chunkData = fs.readFileSync(req.file.path);
    fs.appendFileSync(finalFilePath, chunkData);
    fs.unlinkSync(req.file.path);
    res.json({ success: true, uploadedChunk: chunkIndex, totalChunks });
  } catch (err: any) {
    res.status(500).json({ error: 'Error al subir chunk: ' + err.message });
  }
});

function convertToLinear16Raw(inputPath: string, outputPath: string): Promise<boolean> {
  return new Promise((resolve) => {
    const ffmpegBin = getFfmpegPath();
    exec(`"${ffmpegBin}" -y -i "${inputPath}" -ar 16000 -ac 1 -f s16le -c:a pcm_s16le "${outputPath}"`, (err) => {
      resolve(!err);
    });
  });
}

function parseTimeString(timeObj: any): number {
  if (timeObj == null) return 0;
  if (typeof timeObj === 'number') return timeObj;
  if (typeof timeObj === 'string') return parseFloat(timeObj.replace('s', ''));
  let sec = 0;
  if (timeObj.seconds !== undefined && timeObj.seconds !== null) {
    if (typeof timeObj.seconds === 'number') sec = timeObj.seconds;
    else if (typeof timeObj.seconds === 'string') sec = parseInt(timeObj.seconds, 10);
    else if (timeObj.seconds.low !== undefined) sec = timeObj.seconds.low;
  }
  let nanos = 0;
  if (timeObj.nanos !== undefined && timeObj.nanos !== null) {
    if (typeof timeObj.nanos === 'number') nanos = timeObj.nanos;
    else if (typeof timeObj.nanos === 'string') nanos = parseInt(timeObj.nanos, 10);
    else if (timeObj.nanos.low !== undefined) nanos = timeObj.nanos.low;
  }
  const result = sec + nanos / 1e9;
  return isNaN(result) ? 0 : result;
}

function splitSegmentsIntoInterval(segments: any[], interval: number): any[] {
  if (segments.length === 0) return [];
  interface WordEstimate {
    text: string;
    start: number;
    end: number;
  }
  const wordsList: WordEstimate[] = [];
  for (const seg of segments) {
    if (seg.words && seg.words.length > 0) {
      seg.words.forEach((w: any) => {
        wordsList.push({ text: w.word, start: w.start, end: w.end });
      });
    } else {
      const rawWords = seg.text.trim().split(/\s+/).filter(Boolean);
      if (rawWords.length === 0) continue;
      const duration = seg.end - seg.start;
      const avgDuration = duration > 0 ? duration / rawWords.length : 1 / rawWords.length;
      rawWords.forEach((wordText: string, idx: number) => {
        wordsList.push({
          text: wordText,
          start: seg.start + idx * avgDuration,
          end: seg.start + (idx + 1) * avgDuration,
        });
      });
    }
  }
  if (wordsList.length === 0) return [];

  const resultChunks: any[] = [];
  let firstWordChunkIdx = Math.floor(wordsList[0].start / interval);
  if (wordsList[0].end > (firstWordChunkIdx + 1) * interval) {
    firstWordChunkIdx = Math.floor(wordsList[0].end / interval);
  }
  let chunkIndex = firstWordChunkIdx;
  let currentWords: string[] = [];

  wordsList.forEach((word) => {
    let wordChunkIdx = Math.floor(word.start / interval);
    const targetBoundary = (wordChunkIdx + 1) * interval;
    if (word.end > targetBoundary) {
      wordChunkIdx = Math.floor(word.end / interval);
    }
    if (wordChunkIdx > chunkIndex && currentWords.length > 0) {
      resultChunks.push({
        index: resultChunks.length + 1,
        start: chunkIndex * interval,
        end: (chunkIndex + 1) * interval,
        text: currentWords.join(' '),
      });
      currentWords = [];
      chunkIndex = wordChunkIdx;
    }
    if (currentWords.length === 0) {
      chunkIndex = wordChunkIdx;
    }
    currentWords.push(word.text);
  });

  if (currentWords.length > 0) {
    resultChunks.push({
      index: resultChunks.length + 1,
      start: chunkIndex * interval,
      end: (chunkIndex + 1) * interval,
      text: currentWords.join(' '),
    });
  }
  return resultChunks;
}

async function runTranscriptionOnFile(
  sourcePath: string,
  originalName: string,
  options: {
    language?: string;
    customLanguage?: string;
    sentenceMode?: string;
    preservePunctuation?: boolean;
  }
) {
  const { language = 'es', customLanguage = '', sentenceMode = 'split-10-seconds', preservePunctuation = true } = options;
  const convertedRawPath = `${sourcePath}.raw`;

  try {
    const success = await convertToLinear16Raw(sourcePath, convertedRawPath);
    if (!success || !fs.existsSync(convertedRawPath)) {
      throw new Error('FFmpeg no pudo convertir el archivo de audio a PCM 16kHz.');
    }

    const audioBuffer = fs.readFileSync(convertedRawPath);
    const durationSeconds = audioBuffer.length / 32000;

    let languageCode = 'es-ES';
    if (language === 'en') languageCode = 'en-US';
    else if (language === 'custom' && customLanguage) languageCode = customLanguage;

    let speechClient: any = null;
    try {
      const defaultJson = process.env.GOOGLE_APPLICATION_CREDENTIALS_JSON;
      if (defaultJson) {
        const credentials = JSON.parse(defaultJson);
        speechClient = new speech.SpeechClient({ credentials, fallback: 'rest' });
      } else {
        const apiKey = process.env.GCP_API_KEY || process.env.GOOGLE_CLOUD_API_KEY || getSavedGeminiKey();
        speechClient = apiKey
          ? new speech.SpeechClient({ apiKey, fallback: 'rest' })
          : new speech.SpeechClient();
      }
    } catch (e) {
      console.warn('SpeechClient init warning:', e);
    }

    const audioConfig: any = {
      encoding: 'LINEAR16',
      sampleRateHertz: 16000,
      languageCode,
      enableWordTimeOffsets: true,
      enableAutomaticPunctuation: preservePunctuation !== false,
    };

    const CHUNK_DURATION_SEC = 12;
    const OVERLAP_SEC = 2;
    const STEP_SEC = CHUNK_DURATION_SEC - OVERLAP_SEC;
    const BYTES_PER_SEC = 32000;
    const STEP_BYTES = STEP_SEC * BYTES_PER_SEC;
    const CHUNK_SIZE_BYTES = CHUNK_DURATION_SEC * BYTES_PER_SEC;

    const chunksCount = Math.ceil(audioBuffer.length / STEP_BYTES);
    const sentences: any[] = [];
    let sentenceIndex = 1;

    for (let i = 0; i < chunksCount; i++) {
      const startByte = i * STEP_BYTES;
      const endByte = Math.min(startByte + CHUNK_SIZE_BYTES, audioBuffer.length);
      const chunkBuffer = audioBuffer.subarray(startByte, endByte);
      const audioContent = chunkBuffer.toString('base64');
      const chunkTimeOffset = i * STEP_SEC;

      let textResponse: any = null;
      if (speechClient) {
        const [response] = await speechClient.recognize({
          config: audioConfig,
          audio: { content: audioContent },
        });
        textResponse = response;
      }

      if (textResponse && textResponse.results) {
        for (const result of textResponse.results) {
          if (result.alternatives && result.alternatives.length > 0) {
            const alternative = result.alternatives[0];
            const words = alternative.words || [];
            let startSeconds = chunkTimeOffset;
            let endSeconds = chunkTimeOffset + 5;
            let validWords: any[] = [];
            let transcriptText = '';
            const isLastChunk = i === chunksCount - 1;

            if (words.length > 0) {
              validWords = words.filter((w: any) => {
                const wStart = parseTimeString(w.startTime) + chunkTimeOffset;
                return isLastChunk || wStart < chunkTimeOffset + STEP_SEC;
              });
              if (validWords.length === 0) continue;
              transcriptText = validWords.map((w: any) => w.word).join(' ');
              startSeconds = parseTimeString(validWords[0].startTime) + chunkTimeOffset;
              endSeconds = parseTimeString(validWords[validWords.length - 1].endTime) + chunkTimeOffset;
            } else {
              transcriptText = alternative.transcript ? alternative.transcript.trim() : '';
              if (!transcriptText) continue;
            }

            sentences.push({
              index: sentenceIndex++,
              start: Number(startSeconds),
              end: Number(endSeconds),
              text: transcriptText,
              words: validWords.map((w: any) => ({
                word: w.word,
                start: parseTimeString(w.startTime) + chunkTimeOffset,
                end: parseTimeString(w.endTime) + chunkTimeOffset,
              })),
            });
          }
        }
      }
    }

    let finalSentences = sentences;
    if (sentenceMode === 'split-10-seconds') {
      finalSentences = splitSegmentsIntoInterval(sentences, 10);
    } else if (sentenceMode === 'split-8-seconds') {
      finalSentences = splitSegmentsIntoInterval(sentences, 8);
    } else if (sentenceMode === 'split-4-seconds') {
      finalSentences = splitSegmentsIntoInterval(sentences, 4);
    }

    return {
      file_name: originalName,
      duration_seconds: durationSeconds,
      language: languageCode,
      sentences: finalSentences,
    };
  } finally {
    if (fs.existsSync(convertedRawPath)) {
      try {
        fs.unlinkSync(convertedRawPath);
      } catch {}
    }
  }
}

app.post('/api/transcribe-process', async (req, res) => {
  const { uploadId, originalName, language, customLanguage, sentenceMode, preservePunctuation } = req.body;
  if (!uploadId) {
    res.status(400).json({ error: 'Falta uploadId' });
    return;
  }
  const sourcePath = path.join(CHUNK_DIR, `${path.basename(uploadId)}`);
  if (!fs.existsSync(sourcePath)) {
    res.status(404).json({ error: 'Archivo subido no encontrado.' });
    return;
  }
  try {
    const result = await runTranscriptionOnFile(sourcePath, originalName || 'audio.wav', {
      language,
      customLanguage,
      sentenceMode,
      preservePunctuation,
    });
    res.json(result);
  } catch (err: any) {
    res.status(500).json({ error: err.message || 'Error al extraer el timeline.' });
  } finally {
    if (fs.existsSync(sourcePath)) {
      try {
        fs.unlinkSync(sourcePath);
      } catch {}
    }
  }
});

// Direct 1-click timeline extraction from any audio track generated in VoxFlow!
app.post('/api/transcribe-tts-file', async (req, res) => {
  const { filename, language = 'es', sentenceMode = 'split-10-seconds', preservePunctuation = true } = req.body;
  if (!filename) {
    res.status(400).json({ error: 'Se requiere el nombre del archivo de audio de VoxFlow.' });
    return;
  }
  const safeName = path.basename(filename);
  const sourcePath = path.join(TTS_DIR, safeName);
  if (!fs.existsSync(sourcePath)) {
    res.status(404).json({ error: 'El archivo de audio no existe en la biblioteca local.' });
    return;
  }
  try {
    const result = await runTranscriptionOnFile(sourcePath, safeName, {
      language,
      sentenceMode,
      preservePunctuation,
    });
    res.json(result);
  } catch (err: any) {
    res.status(500).json({ error: err.message || 'Error al extraer el timeline desde el audio de VoxFlow.' });
  }
});

// ============================================================================
// HYBRID AI COPILOT FOR ANY DOCUMENTARY STAGE (/api/ai/generate-stage)
// ============================================================================
app.post('/api/ai/generate-stage', async (req, res) => {
  try {
    const { stageNumber, documentary, customInstruction } = req.body;
    const ai = getGeminiClient();
    if (!ai) {
      res.status(400).json({
        error: 'No hay Gemini API Key activa. Configúrala en el botón de llave superior.',
      });
      return;
    }

    const doc = documentary || {};
    const clipDurationLabel = doc.clipDurationMode === '8_SEGUNDOS' ? '8 segundos' : '10 segundos';
    const is16x9 = doc.productionType === 'DOCUMENTAL_16X9' || doc.productionType === 'NOTEBOOKLM';
    const c1Dur = Number(doc.clip1DurationSeconds) || (doc.clip1SyncMode === 'VOZ_EN_CLIP_2' ? 6 : 4);
    const voiceEntrySec = c1Dur + 2;
    const clip2StartSec = doc.clip1SyncMode === 'RALENTIZAR_CAPCUT' ? c1Dur + 2 : c1Dur;
    const youtubeViralLink = (doc.promptConfig?.YOUTUBE_VIRAL_LINK || '').trim();
    const youtubeCommentsResearchBlock = (
      doc.promptConfig?.YOUTUBE_COMMENTS_RESEARCH_BLOCK || ''
    ).trim();
    const viralContextBlock = youtubeViralLink
      ? `\nENLACE DE VIDEO VIRAL DE YOUTUBE DE REFERENCIA: ${youtubeViralLink}\nINSTRUCCIÓN OBLIGATORIA DE ANÁLISIS VIRAL: Analiza profunda, minuciosa, detallada, incisiva e intensamente, detalle por detalle y sin obviar nada, el video de YouTube en el enlace (${youtubeViralLink}) para entender cómo se hizo viral en la plataforma y RECREA EXACTAMENTE LA MISMA ESTRUCTURA GANADORA en este documental.\n${
          youtubeCommentsResearchBlock ? `\n${youtubeCommentsResearchBlock}\n` : ''
        }`
      : youtubeCommentsResearchBlock
      ? `\n${youtubeCommentsResearchBlock}\n`
      : '';

    let stagePrompt = '';
    if (stageNumber === 2 || stageNumber === 3) {
      stagePrompt = `Actúa como un historiador, director de cine, y periodista profesional para "Huellas de la Humanidad".${viralContextBlock}
Tema del documental: ${doc.topic || doc.title || 'Por definir'}
Tipología: ${doc.typology || 'Suceso histórico'}
Tiempo histórico: ${doc.historicalTime || 'Por definir'}
Lugar histórico: ${doc.historicalLocation || 'Por definir'}
Duración aproximada objetivo: ~${doc.targetDurationSeconds || 120} segundos (la duración total no tiene que ser exacta al segundo, sino aproximada a la pedida).

Genera la ETAPA 3 completa:
1. Recuento estructural de secciones cronológicas del documental.
2. Datos insólitos, curiosidades verificadas y contradicciones históricas centrales.
3. Prompt Maestro detallado para desarrollar Investigación Profunda (Deep Research / NotebookLM)${
        youtubeCommentsResearchBlock
          ? ' — INCLUYENDO OBLIGATORIAMENTE DENTRO DE ESTE PROMPT DE INVESTIGACIÓN todas las preguntas, dudas, debates y sugerencias detectadas en los comentarios del video de referencia y del canal @huellas_de_la_humanidad para que la investigación profunda las responda exhaustivamente'
          : ''
      }.`;
    } else if (stageNumber === 4) {
      const introPlacement = doc.promptConfig?.UBICACION_INTRO_MARCA || 'INTRO_INICIO_00';
      const FIXED_INTRO_SEC = 8;
      const FIXED_OUTRO_SEC = 8;
      const effectiveVoiceEntrySec =
        introPlacement === 'INTRO_INICIO_00' ? voiceEntrySec + FIXED_INTRO_SEC : voiceEntrySec;
      const targetChars = Math.round(
        Math.max(10, (doc.targetDurationSeconds || 120) - FIXED_OUTRO_SEC - effectiveVoiceEntrySec) * 13.5
      );
      stagePrompt = `Actúa como un historiador, director de cine, y periodista profesional para "Huellas de la Humanidad".
Tema: ${doc.topic || doc.title} (${doc.historicalTime}, ${doc.historicalLocation})
Estructura e Investigación previa:
${doc.sectionsStructure || ''}
${doc.deepResearchResult || ''}

Redacta la ETAPA 4: GUION DE LA VOZ EN OFF en español neutro documental:
- Sincronización de Entrada de Voz: ${
        introPlacement === 'INTRO_INICIO_00'
          ? `El documental abre en 00:00 - 00:08 con el Intro Oficial de Marca de 8s (Intro.mp4), seguido por la ventana sin voz del Hook (${voiceEntrySec}s); por lo tanto, la voz narrativa entra obligatoriamente en el segundo ${effectiveVoiceEntrySec} del video.`
          : doc.clip1SyncMode === 'VOZ_EN_CLIP_2'
          ? `El Clip 1 dura ${c1Dur}s (00:00 - 00:0${c1Dur}) sin voz y los primeros 2s del Clip 2 (00:0${c1Dur} - 00:0${voiceEntrySec}) tampoco llevan voz; por lo tanto, los primeros ${voiceEntrySec} segundos no llevan locución y la voz narrativa entra obligatoriamente en el segundo ${voiceEntrySec} del video (que es el segundo 2 del segundo clip).`
          : `El Clip 1 de ${c1Dur}s se ralentiza en edición a ${voiceEntrySec}s (00:00 - 00:0${voiceEntrySec}) sin voz; la voz narrativa entra en el segundo ${voiceEntrySec} del video (al inicio del Clip 2).`
      }
- La duración total del guion NO tiene que ser exacta al segundo, sino APROXIMADA a la duración pedida (~${doc.targetDurationSeconds || 120}s).
- Comienza obligatoriamente con la tríada en la primera oración cerrada con punto: "Año [número en dígitos], [Lugar, Ciudad, País]. [Premisa intrigante]." (Prohibido poner "en el" después del año).
- Años siempre en dígitos, siglos y monarcas en números romanos (ej. siglo XIX, Felipe II), miles con palabra "mil" (ej. "70 mil"), cero signos de exclamación.
- Incluye etiquetas de pausa estratégicas como [pausa: 1.5s] o [pausa: 2s].
- Si es documental largo, incluye antes del segundo 30 el slogan en párrafo aparte (Párrafo 2: "En los próximos minutos... Cada historia deja una huella. Aquí seguimos sus rastros.")${
        introPlacement === 'INTRO_POST_SLOGAN'
          ? ' e INMEDIATAMENTE al cerrar ese Párrafo 2 coloca OBLIGATORIAMENTE la etiqueta [pausa: 8s] para que durante esos 8 segundos exactos de silencio del narrador entre el Intro Oficial de Marca de 8s (Intro.mp4 — "Minimalismo en Piedra y Oro") antes del Párrafo 3'
          : ''
      }, y cierra el guion en párrafo aparte con la llamada a comentarios y el lema: "Cada historia deja una huella. Aquí seguimos sus rastros."
- Extensión aproximada calibrada: ~${targetChars} caracteres.`;
    } else if (stageNumber === 5) {
      const thumbOrientation =
        doc.thumbnailOrientation ||
        (doc.productionType === 'REEL_9X16' ? 'VERTICAL_9X16' : 'HORIZONTAL_16X9');
      const isThumbHorizontal = thumbOrientation === 'HORIZONTAL_16X9';
      const overlayText = (doc.thumbnailTextOverlay || '').trim() || 'EL SECRETO OCULTO';
      const refsContext = Array.isArray(doc.references)
        ? doc.references
            .slice(0, 6)
            .map((r: any) => `${r.tag}: ${r.prompt}`)
            .join('\n')
        : '';
      const clipsContext = Array.isArray(doc.clips)
        ? doc.clips
            .slice(0, 6)
            .map((c: any) => c.imagePrompt)
            .filter(Boolean)
            .join('\n')
        : '';
      stagePrompt = `Actúa como diseñador experto en neuropsicología del clic (alto CTR en YouTube) para "Huellas de la Humanidad".
Tema / Título: ${doc.topic || doc.title} (${doc.historicalTime || doc.clip1Line1LocationTime || ''}, ${doc.historicalLocation || ''})
Gancho Clip 1: ${doc.clip1Line1LocationTime || ''} — ${doc.clip1Line2Hook || ''}
Guion REAL del documental (PRIORIDAD ABSOLUTA sobre cualquier título provisional):
"""
${(doc.voiceoverScript || doc.sectionsStructure || '').slice(0, 1500)}
"""
Personajes y Lugares del documental (@Referencias):
${refsContext}
Primeras escenas visuales del documental (Clips):
${clipsContext}
Orientación seleccionada: ${isThumbHorizontal ? 'HORIZONTAL (16:9)' : 'VERTICAL (9:16)'}
Texto en pantalla obligatorio (Curiosity Gap): "${overlayText}"

REGLA CRÍTICA DE FIDELIDAD TEMÁTICA: Si el campo "Título" contiene el nombre de un video anterior o provisional (ej. "Video 75..."), IGNÓRALO y basa la escena visual de la miniatura 100% en el Guion REAL, los Personajes (@Referencias) y las escenas de los Clips de arriba.

APLICA OBLIGATORIAMENTE LOS 5 PRINCIPIOS NEUROPSICOLÓGICOS DEL CTR EN LA IMAGEN:
1. PROCESAMIENTO EN 13 MILISEGUNDOS (CERO RUIDO VISUAL): Composición ultra-limpia de máximo 3 elementos visuales (1 rostro dominante del protagonista real del guion en primer plano + 1 elemento detonante de peligro/misterio del guion + texto gancho), instantáneamente legible en la pantalla diminuta de un teléfono móvil.
2. ROSTRO HUMANO + EMOCIÓN EXTREMA + CONTACTO VISUAL DIRECTO: El protagonista histórico real del guion ocupa el 60% del encuadre en Medium Close-Up o Extreme Close-Up, mirando directamente al lente de la cámara ("direct piercing eye contact with the viewer"), con ojos muy abiertos mostrando la esclerótica blanca, expresión visceral intensa de shock, asombro, terror o traición descubierta, textura real de poros, sudor o lágrimas.
3. BRECHA DE LA CURIOSIDAD (CURIOSITY GAP): Muestra el segundo exacto antes del desastre o una contradicción visual enigmática del guion que obligue al cerebro del espectador a preguntarse "¿Qué acaba de pasar ahí?".
4. PSICOLOGÍA DEL COLOR Y ALTO CONTRASTE: Iluminación dramática de claroscuro con luz clave cálida de alto impacto (oro ardiente, fuego carmesí o ámbar intenso) sobre el rostro y luz de recorte (rim light) brillante que lo despega de un fondo oscuro saturado en tonos fríos (azul cian nocturno profundo o negro abismal).
5. POSICIÓN Y TEXTO EN PANTALLA OBLIGATORIO:
   ${
     isThumbHorizontal
       ? `Al ser HORIZONTAL (16:9), el texto en pantalla "${overlayText}" debe ir OBLIGATORIAMENTE ABAJO A LA IZQUIERDA: incluye textualmente 'bold high-contrast cinematic documentary typography text overlay positioned in the bottom-left area of the image reading "${overlayText}"'.`
       : `Al ser VERTICAL (9:16), el texto en pantalla "${overlayText}" debe ir OBLIGATORIAMENTE CENTRADO Y JUSTIFICADO EN EL MEDIO DE LA IMAGEN: incluye textualmente 'bold high-contrast cinematic documentary typography text overlay centered and middle-justified right in the middle center of the image reading "${overlayText}"'.`
   }
6. LOGO SUPERIOR DERECHO AL 5% EN DORADO:
   ${
     isThumbHorizontal
       ? `Al ser HORIZONTAL (16:9), el logo superior derecho es "8K": incluye textualmente 'a small discreet 5% scale logo in the top-right corner displaying "8K" in metallic gold'.`
       : `Al ser VERTICAL (9:16), el logo superior derecho es "HD": incluye textualmente 'a small discreet 5% scale logo in the top-right corner displaying "HD" in metallic gold'.`
   }
7. LOGO OFICIAL SUPERIOR IZQUIERDO AL 5% (IMAGEN DE REFERENCIA):
   Incluye textualmente: 'official page logo cleanly integrated in the top-left corner from provided reference image at 5% scale, strictly preserving and visibly rendering both the logo emblem and the exact text underneath it "Huellas de la Humanidad" without cropping, blurring, or omitting the sub-text'.
8. Cierra con: 'cinematic documentary realism, 8k resolution, sharp focus, safe framing composition, no modern objects, no CGI look, no unintended floating text, no music.'
Entrega únicamente el prompt en inglés listo para copiar y pegar.`;
    } else if (stageNumber === 6) {
      stagePrompt = `Actúa como un historiador y director de fotografía para "Huellas de la Humanidad".
Basado en este guion de voz en off y tema (${doc.topic || doc.title}, ${doc.historicalTime}, ${doc.historicalLocation}):
"""
${doc.voiceoverScript || doc.sectionsStructure || ''}
"""
Genera la ETAPA 6: PROMPTS DE IMÁGENES MODELO DE REFERENCIA para Nano Banana 2.1:
- Antepón la orden: "Cambia los nombres y ponles @ seguido del nombre de la persona o lugar correspondiente."
- Lista cada personaje principal con @Nombre_Personaje y cada lugar principal (sin @ en lugares), y entrega su prompt en inglés comenzando con "Create an image ..." incluyendo época (${doc.historicalTime}) y lugar (${doc.historicalLocation}), fotorrealista cinematográfico 8k, 'no text'.`;
    } else if (stageNumber === 7) {
      stagePrompt = `Actúa como director creativo de "Huellas de la Humanidad".
Tema: ${doc.topic || doc.title} | Lugar: ${doc.historicalLocation} | Tiempo: ${doc.historicalTime}
Título del video: ${doc.title || ''}
Texto en pantalla de la Miniatura: ${doc.thumbnailTextOverlay || ''}
Guion: ${(doc.voiceoverScript || '').slice(0, 600)}
Propón 3 opciones magnéticas para el TEXTO EN PANTALLA DEL CLIP 1 (Primeros ${voiceEntrySec}s del video):
Línea 1: [Ciudad, País, Año XXXX (con la palabra "Año" delante del año en dígitos) o Siglo XX (con "Siglo" con S mayúscula y números romanos)] (ej. "Santander, España, Año 1885" o "París, Francia, Siglo XIII")
Línea 2: [Título Gancho sugerente de lo que va a tratar el documental: intrigante a la vez que revelador del tema central. PROHIBIDO usar una frase suelta o abstracta que no sugiera directamente el tema del documental]
REGLA INQUEBRANTABLE DE NO REPETICIÓN: Lo que NO podemos hacer es repetir lo mismo entre la Miniatura, el Título del video y el Texto en pantalla en los primeros ${voiceEntrySec} segundos. Asegúrate de que la Línea 2 (el gancho en pantalla de los primeros ${voiceEntrySec}s) sea distinta y NO repita lo mismo que el Título del video ni el Texto de la Miniatura, pero que sí revele e intrigue directamente sobre el tema central del documental.`;
    } else if (stageNumber === 8) {
      const opHeader = (doc.operationalHeader || DEFAULT_OPERATIONAL_HEADER_SERVER).trim();
      stagePrompt = `Actúa como un historiador, director de cine, y periodista profesional.
Genera la ETAPA 8: PROMPTS DE IMÁGENES INICIALES (Nano Banana 2.1) Y CLIPS DE VIDEO (Veo 3.1 - Lite [Lower Priority]) para el documental "${doc.topic || doc.title}" (${doc.historicalTime}, ${doc.historicalLocation}).
Duración de cada clip a partir del Clip 2: ${clipDurationLabel}.
Sincronización de Clip 1 y Entrada de Voz: ${
        doc.clip1SyncMode === 'VOZ_EN_CLIP_2'
          ? `Clip 1 de 00:00 a 00:0${c1Dur} (${c1Dur}s sin voz). Clip 2 comienza en 00:0${clip2StartSec} y la voz narrativa entra en el segundo ${voiceEntrySec} del video (segundo 2 del Clip 2).`
          : `Clip 1 creado de ${c1Dur}s y ralentizado en CapCut a ${voiceEntrySec}s (00:00 - 00:0${voiceEntrySec} sin voz). Clip 2 comienza en 00:0${clip2StartSec} con la entrada de la voz.`
      }
Regla de Duración Aproximada: La duración total del video es aproximada a la pedida (~${doc.targetDurationSeconds || 120}s); todos los clips del 2 al final mantienen su duración estándar de ${clipDurationLabel} sin forzar micro-clips de relleno de 2s o 4s al final.
Texto en pantalla Clip 1: ${doc.clip1Line1LocationTime} — ${doc.clip1Line2Hook}
Referencias creadas: ${(doc.references || []).map((r: any) => r.tag).join(', ')}

Timeline de la Voz Narrativa:
"""
${doc.timelineFormattedText || doc.voiceoverScript || ''}
"""

OBLIGACIÓN INQUEBRANTABLE DEL PÁRRAFO INICIAL DE 9 LÍNEAS:
Tu respuesta DEBE COMENZAR OBLIGATORIA Y LITERALMENTE con este párrafo inicial de 9 líneas (sin omitir ninguna línea) antes de "Image 1: Create an image":
${opHeader}

Inmediatamente después del párrafo inicial de 9 líneas, entrega cada Clip (empezando por Clip 1 sin voz narrativa, y luego Clip 2 en adelante siguiendo el timeline) cumpliendo esta REGLA INQUEBRANTABLE DE SIMPLICIDAD, PRECISIÓN Y NO DUPLICACIÓN ENTRE CLIPS CONSECUTIVOS:
- REGLA INQUEBRANTABLE DE NO DUPLICACIÓN VISUAL ENTRE CLIPS CONTIGUOS (Clip [N] vs Clip [N+1]): Si la voz narrativa continúa en la misma escena, tema o hilo argumental por más de un clip, los siguientes clips NO deben duplicarse visualmente bajo ningún concepto (queda terminantemente prohibido poner dos oficinas seguidas, dos escritorios o mostradores de madera con documentos/monedas seguidos, o la misma puesta en escena en dos clips consecutivos). Cada clip siguiente debe mostrar algo completamente diferente en entorno, iluminación y perspectiva pero visualmente referente a la locución (por ejemplo, si el Clip N es un interior oscuro en un escritorio, el Clip N+1 debe pasar a un exterior luminoso en el muelle frente al buque de vapor, una calle abierta o un plano radicalmente distinto).
- Image [N]: Concisa, directa y clara (~20 a 35 palabras), describiendo únicamente el sujeto/escena principal, época y lugar (${doc.historicalTime}, ${doc.historicalLocation}), e iluminación, cerrando con "cinematic lighting, historical accuracy, no text."
- Clip [N] ([MM:SS - MM:SS]): Como la IA de video ya usa Image [N] como primer fotograma, NO repitas toda la descripción de vestuario o arquitectura. Describe en UNA SOLA ORACIÓN SIMPLE Y DIRECTA (~12 a 22 palabras) únicamente UN movimiento de cámara suave (ej. slow zoom-in, panning slowly, gliding slowly, slow tilt-up) y UNA micro-acción física natural sobre la imagen inicial, seguido de "Ambient Foley: [2-3 sonidos puntuales], single continuous shot, strictly no shot changes, no music, no speech, no text." ${doc.promptConfig?.VOZ_NARRATIVA_EN_CLIPS !== 'EXCLUIR' ? 'seguido de la oración de la voz narrativa correspondiente y' : 'y'} cerrando con "fix the name".

Formato exacto de ejemplo:
Image [N]: Create an image of [escena clara con época y lugar], cinematic lighting, historical accuracy, no text.

Clip [N] ([MM:SS - MM:SS]): Create a video showing [1 movimiento suave de cámara + 1 acción física simple sobre la imagen inicial]. Ambient Foley: [sonidos puntuales], single continuous shot, strictly no shot changes, no music, no speech, no text. ${doc.promptConfig?.VOZ_NARRATIVA_EN_CLIPS !== 'EXCLUIR' ? '[oración de la voz narrativa correspondiente]. ' : ''}fix the name`;
    } else if (stageNumber === 10) {
      const parseMmSsToSec = (str?: string): number => {
        if (!str) return 0;
        const m = String(str).match(/(\d{1,3}):(\d{2})/);
        if (!m) return 0;
        return parseInt(m[1], 10) * 60 + parseInt(m[2], 10);
      };
      const formatSecToMmSs = (sec: number): string => {
        const safe = Math.max(60, Math.round(sec));
        const mm = Math.floor(safe / 60);
        const ss = safe % 60;
        return `${String(mm).padStart(2, '0')}:${String(ss).padStart(2, '0')}`;
      };
      const stdClipSec = doc.clipDurationMode === '8_SEGUNDOS' ? 8 : 10;
      let lastClipEndSec = 0;
      if (Array.isArray(doc.clips) && doc.clips.length > 0) {
        for (const c of doc.clips) {
          const rangeParts = String(c.timeRange || '').split('-');
          const endPart = rangeParts[1] || rangeParts[0] || '';
          const endSec = parseMmSsToSec(endPart);
          if (endSec > lastClipEndSec) lastClipEndSec = endSec;
        }
        if (!lastClipEndSec) {
          lastClipEndSec = clip2StartSec + Math.max(0, doc.clips.length - 1) * stdClipSec;
        }
      }
      const voiceDurSec =
        Array.isArray(doc.audioTracks) && doc.audioTracks[0]?.duration
          ? Math.round(clip2StartSec + Number(doc.audioTracks[0].duration))
          : 0;
      const confirmedSec = parseMmSsToSec(doc.confirmedFinalDuration);
      const totalDocSec = Math.max(
        lastClipEndSec,
        voiceDurSec,
        confirmedSec > 125 ? confirmedSec : 0,
        doc.targetDurationSeconds || 120
      );
      const resolvedFinalDuration = formatSecToMmSs(totalDocSec);
      const outroStartMmSs = formatSecToMmSs(Math.max(0, totalDocSec - 90));
      const minRecommendedTracks =
        totalDocSec >= 660 ? 6 : totalDocSec >= 420 ? 5 : totalDocSec >= 240 ? 4 : 3;
      const maxRecommendedTracks =
        totalDocSec >= 660 ? 8 : totalDocSec >= 420 ? 7 : totalDocSec >= 240 ? 5 : 4;
      const clipsVisualSummary =
        Array.isArray(doc.clips) && doc.clips.length > 0
          ? doc.clips
              .filter(
                (_: any, idx: number, arr: any[]) =>
                  idx === 0 ||
                  idx === arr.length - 1 ||
                  idx % Math.max(1, Math.floor(arr.length / 18)) === 0
              )
              .map(
                (c: any) =>
                  `Clip ${c.clipNumber} (${c.timeRange || ''}): ${(c.imagePrompt || '').slice(0, 120)} | Voz: "${(c.narrationSegment || '').slice(0, 90)}"`
              )
              .join('\n')
          : '';

      stagePrompt = `Actúa como compositor cinematográfico maestro de "Huellas de la Humanidad" para **Google Flow Music (https://www.flowmusic.app/)**.
Tema: ${doc.topic || doc.title} (${doc.historicalTime || doc.historicalEra || ''}, ${doc.historicalLocation || doc.cityCountry || ''})
Duración total exacta del documental (calculada de la Voz Narrativa y el Timeline de Clips): ${resolvedFinalDuration} (${totalDocSec} segundos)
Guion / Estructura de escenas: ${(doc.voiceoverScript || doc.sectionsStructure || '').slice(0, 2400)}
${clipsVisualSummary ? `\nMapa de escenas visuales y clips:\n${clipsVisualSummary}\n` : ''}
Genera la **ETAPA 10: BANDA SONORA CINEMATOGRÁFICA MULTIESCENA PARA FLOW MUSIC (flowmusic.app)** cumpliendo estas REGLAS OBLIGATORIAS E INQUEBRANTABLES:
1. CANTIDAD DINÁMICA DE CANCIONES SEGÚN LAS ESCENAS (${minRecommendedTracks} a ${maxRecommendedTracks} canciones): Diseña entre ${minRecommendedTracks} y ${maxRecommendedTracks} canciones instrumentales distintas acompañando los cambios visuales de escena, giros de la trama y actos emocionales del documental.
2. SILENCIOS DRAMÁTICOS OBLIGATORIOS ENTRE CADA CANCIÓN (10 a 20 segundos):
   - Entre el final de una canción y el inicio de la siguiente DEBE haber obligatoriamente un silencio musical de 10 a 20 segundos sin música, ubicado en un cambio de escena o pregunta retórica donde solo se escuche la Voz Narrativa y el Foley ambiental.
   - En el campo "3. De dónde a dónde cubre en el video en tiempo", deja explícito el rango exacto y los clips que cubre (ej. 00:00 - 02:16 (Clip 1 al Clip 15)).
3. LA ÚLTIMA CANCIÓN DEBE SER OBLIGATORIAMENTE DE SOLO 1:30 (01:30):
   - La ÚLTIMA canción de la banda sonora tiene que durar OBLIGATORIA E INQUEBRANTABLEMENTE solo 1:30 (${outroStartMmSs} - ${resolvedFinalDuration}), cubriendo el último minuto y medio del documental.
4. FADE-IN, FADE-OUT Y VOLUMEN POR DEBAJO DE LA VOZ NARRATIVA (DUCKING DOCUMENTAL):
   - En cada "5. Prompt de Style" (en inglés para Flow Music) incluye obligatoriamente: \`smooth 2.5-second fade-in intro, gentle 3-second fade-out outro, mixed as warm low-mid frequency documentary underscore designed to sit softly below a deep male narrator voice without competing in the 1kHz-4kHz vocal clarity range, 100% instrumental, strictly no vocals, no singing, no spoken words\`.
5. Entrega cada canción con los 6 campos exactos en este orden:
1. Título: [Título evocador de la escena]
2. Duración: [Duración exacta en Flow Music; la última canción OBLIGATORIAMENTE 01:30]
3. De dónde a dónde cubre en el video en tiempo: [MM:SS - MM:SS (Clip X al Clip Y)]
4. Prompt de Lyrics: [Mapa instrumental en corchetes con [Soft 2.5s Fade-In Intro], [Warm Documentary Underscore Below Voice], [Gentle 3s Fade-Out Outro]]
5. Prompt de Style: [Prompt técnico 100% en inglés para Flow Music (flowmusic.app) con instrumentos auténticos de la época, fade-in intro, fade-out outro y mezcla cálida debajo de la voz narrativa, strictly instrumental only, no vocals, no singing, no speech, no lyrics]
6. Explicación de la Canción: [Explicación de cómo suena, instrumentos, escenas que cubre y silencio dramático de 10-20s previo]`;
    } else if (stageNumber === 101) {
      stagePrompt = `Actúa como estratega de CTR y director creativo de miniaturas para el canal documental "Huellas de la Humanidad".
Título del video: ${doc.title || ''}
Texto en pantalla en los primeros ${voiceEntrySec} segundos (Clip 1): ${doc.clip1Line2Hook || ''}
Tema histórico: ${doc.topic || doc.title || ''} (${doc.historicalTime || doc.clip1Line1LocationTime || ''}, ${doc.historicalLocation || ''})
Guion REAL del documental (PRIORIDAD ABSOLUTA sobre cualquier título provisional):
"""
${(doc.voiceoverScript || doc.sectionsStructure || '').slice(0, 1500)}
"""

TAREA OBLIGATORIA:
Genera EXACTAMENTE 3 opciones de TEXTO EN PANTALLA para la miniatura oficial del video basadas 100% en el Guion REAL de arriba.
REGLAS INQUEBRANTABLES:
1. Cada opción debe tener estrictamente de 1 a 3 palabras contundentes en ESPAÑOL y en MAYÚSCULAS (ejemplo: EL PACTO OCULTO, TRAICIÓN REAL, LA NOCHE FINAL).
2. PROHIBICIÓN ESTRICTA DE REPETICIÓN ENTRE MINIATURA, TÍTULO Y TEXTO EN PANTALLA EN LOS PRIMEROS 8 SEGUNDOS: Lo que NO podemos hacer bajo ningún concepto es repetir lo mismo entre la Miniatura, el Título del video ("${doc.title || ''}") y el Texto en pantalla en los primeros ${voiceEntrySec} segundos ("${doc.clip1Line2Hook || ''}"). Cada opción debe ser completamente distinta y complementarlos psicológicamente sin repetir lo mismo.
3. Entrega ÚNICAMENTE las 3 opciones, una por línea, sin numeración, sin viñetas, sin comillas y sin explicaciones adicionales.`;
    } else if (stageNumber === 11 || stageNumber === 111) {
      stagePrompt = `Actúa como estratega de publicación de "Huellas de la Humanidad".
Tema: ${doc.topic || doc.title} (${doc.historicalTime || doc.historicalEra || ''}, ${doc.historicalLocation || doc.cityCountry || ''})
Duración final confirmada: ${doc.confirmedFinalDuration || '02:00'}
Plataforma: YOUTUBE
Texto en pantalla de la Miniatura: ${doc.thumbnailTextOverlay || ''}
Texto en pantalla en los primeros ${voiceEntrySec} segundos (Clip 1): ${doc.clip1Line2Hook || ''}
Guion de referencia: ${(doc.voiceoverScript || '').slice(0, 1500)}

Genera la ETAPA 11: METADATA DE PUBLICACIÓN PARA YOUTUBE en formato "Todo Corrido" separada únicamente por líneas con carácter braille (⠀), cumpliendo estas reglas inquebrantables:
1. CERO encabezados de sección (prohibido "Título:", "Descripción:", "Nota IA:", "Slogan:", "Hashtags:"), con la ÚNICA excepción obligatoria del encabezado "Capítulos:".
2. Extensión de 3000 caracteres contando espacios y líneas braille (⠀) desde el inicio del título hasta el final de los 5 hashtags.
3. REGLA INQUEBRANTABLE DE NO REPETICIÓN ENTRE MINIATURA, TÍTULO Y TEXTO EN PANTALLA EN LOS PRIMEROS 8 SEGUNDOS:
   - Lo que NO podemos hacer bajo ningún concepto es repetir lo mismo entre la Miniatura ("${doc.thumbnailTextOverlay || ''}"), el Título del video y el Texto en pantalla en los primeros ${voiceEntrySec} segundos ("${doc.clip1Line2Hook || ''}").
   - El Título directo (con años en dígitos y siglos/nombres con número en números romanos) debe ser completamente distinto a la Miniatura y al Texto en pantalla de los primeros ${voiceEntrySec} segundos.
4. LIBERTAD EN EL RESTO DE LA METADATA Y DESCRIPCIÓN EN 3 PÁRRAFOS:
   - En lo demás de la metadata (los 3 párrafos de la descripción, capítulos, etc.) NO importa que se repitan algunas palabras del guion o del tema.
   - La descripción debe estar dividida obligatoriamente en EXACTAMENTE 3 PÁRRAFOS separados por línea con carácter braille (⠀).
5. Sección obligatoria "Capítulos:" con 10 capítulos cronológicos (donde 00:00 es parte directa de la historia, NUNCA poner "Prólogo" ni "Introducción").
6. Nota IA oficial: (Nota: Este documental inmersivo ha sido recreado utilizando herramientas de inteligencia artificial generativa basándonos estrictamente en registros históricos de la época. Es posible que existan incongruencias o errores visuales).
7. Slogan oficial: Cada historia deja una huella. Aquí seguimos sus rastros.
8. Exactamente 5 hashtags en español en #CamelCase compuestos obligatoriamente por DOS PALABRAS cada uno (concluyendo aquí el bloque para copiar directo en la descripción de YouTube, ya que los Tags y el Comentario Fijado tienen sus propias secciones dedicadas).`;
    } else if (stageNumber === 112) {
      stagePrompt = `Actúa como estratega de publicación de "Huellas de la Humanidad".
Tema: ${doc.topic || doc.title} (${doc.historicalTime || doc.historicalEra || ''}, ${doc.historicalLocation || doc.cityCountry || ''})
Duración final confirmada: ${doc.confirmedFinalDuration || '02:00'}
Plataforma: FACEBOOK
Texto en pantalla de la Miniatura: ${doc.thumbnailTextOverlay || ''}
Texto en pantalla en los primeros ${voiceEntrySec} segundos (Clip 1): ${doc.clip1Line2Hook || ''}
Guion de referencia: ${(doc.voiceoverScript || '').slice(0, 1500)}

Genera la ETAPA 11: METADATA DE PUBLICACIÓN PARA FACEBOOK en formato "Todo Corrido" separada únicamente por líneas con carácter braille (⠀), cumpliendo estas reglas inquebrantables:
1. CERO encabezados de sección en toda la entrega (prohibido "Título:", "Descripción:", "Nota IA:", "Slogan:", "Hashtags:").
2. SIN sección de Capítulos y SIN bloque de Tags SEO (estrictamente prohibido incluir capítulos o tags en Facebook).
3. Extensión de 3000 caracteres contando espacios y líneas braille (⠀) medidos desde el inicio del título hasta el final de los 5 hashtags.
4. REGLA INQUEBRANTABLE DE NO REPETICIÓN ENTRE MINIATURA, TÍTULO Y TEXTO EN PANTALLA EN LOS PRIMEROS 8 SEGUNDOS:
   - Lo que NO podemos hacer bajo ningún concepto es repetir lo mismo entre la Miniatura ("${doc.thumbnailTextOverlay || ''}"), el Título del video y el Texto en pantalla en los primeros ${voiceEntrySec} segundos ("${doc.clip1Line2Hook || ''}").
   - El Título directo (con años en dígitos y siglos/nombres con número en números romanos) debe ser completamente distinto a la Miniatura y al Texto en pantalla de los primeros ${voiceEntrySec} segundos.
5. LIBERTAD EN EL RESTO DE LA METADATA Y DESCRIPCIÓN EN 3 PÁRRAFOS:
   - En lo demás de la metadata (los 3 párrafos de la descripción, etc.) NO importa que se repitan algunas palabras del guion o del tema.
   - La descripción debe estar dividida obligatoriamente en EXACTAMENTE 3 PÁRRAFOS separados por línea con carácter braille (⠀).
6. Nota IA oficial: (Nota: Este video inmersivo ha sido recreado utilizando herramientas de inteligencia artificial generativa basándonos estrictamente en registros históricos de la época. Es posible que existan incongruencias o errores visuales).
7. Slogan oficial: Cada historia deja una huella. Aquí seguimos sus rastros.
8. Exactamente 5 hashtags en español en #CamelCase compuestos obligatoriamente por DOS PALABRAS cada uno (concluyendo aquí el bloque para copiar directo en Facebook, ya que el Comentario Fijado tiene su propia sección dedicada).`;
    } else if (stageNumber === 113) {
      stagePrompt = `Actúa como estratega de comunidad y retención de "Huellas de la Humanidad".
Tema del video: ${doc.topic || doc.title} (${doc.historicalTime || doc.historicalEra || ''}, ${doc.historicalLocation || doc.cityCountry || ''})
Guion / Contexto: ${(doc.voiceoverScript || doc.sectionsStructure || '').slice(0, 1200)}

Genera EXCLUSIVAMENTE el COMENTARIO FIJADO DEL VIDEO cumpliendo estas reglas inquebrantables:
1. Entrega el texto directo sin ningún encabezado ni etiqueta (prohibido poner "Comentario Fijado:" o comillas).
2. Formula una reflexión histórica magnética seguida de un llamado a la acción (CTA) natural que invite a la audiencia a debatir, opinar o compartir una experiencia/vivencia vinculada al hecho histórico.
3. Queda terminantemente prohibido pedir genéricamente "dale like" o "suscríbete", y prohibido usar signos de exclamación (!).
4. Escribe todos los años en dígitos y los siglos/nombres con número en números romanos.`;
    } else if (stageNumber === 114) {
      stagePrompt = `Actúa como especialista en SEO de YouTube para "Huellas de la Humanidad".
Tema del video: ${doc.topic || doc.title} (${doc.historicalTime || doc.historicalEra || ''}, ${doc.historicalLocation || doc.cityCountry || ''})
Guion / Contexto: ${(doc.voiceoverScript || doc.sectionsStructure || '').slice(0, 1200)}

Genera EXCLUSIVAMENTE el bloque de TAGS SEO DE YOUTUBE cumpliendo estas reglas inquebrantables:
1. Entrega ÚNICAMENTE las etiquetas separadas por comas, en un solo bloque continuo, sin ningún encabezado (prohibido poner "Tags:" o "Tags SEO:").
2. La longitud total del bloque debe ser de aproximadamente 460 a 500 caracteres contando espacios y comas (nunca superar los 500 caracteres).
3. Incluye palabras clave de alto volumen de búsqueda en español sobre el tema histórico, personajes, época, lugar y documentales de historia.`;
    }

    if (customInstruction) {
      stagePrompt += `\n\nInstrucción adicional del director: ${customInstruction}`;
    }

    const models = [
      'gemini-3.1-pro-preview',
      'gemini-3.6-flash',
      'gemini-3-flash-preview',
      'gemini-2.5-flash',
      'gemini-2.5-flash-lite',
    ];
    let outputText = '';
    let lastError: any = null;

    for (const m of models) {
      try {
        const resp = await ai.models.generateContent({
          model: m,
          contents: [{ role: 'user', parts: [{ text: stagePrompt }] }],
        });
        if (resp.text) {
          outputText = resp.text;
          break;
        }
      } catch (e: any) {
        lastError = e;
      }
    }

    if (!outputText) {
      throw new Error(lastError?.message || 'No se pudo generar respuesta con Gemini.');
    }

    if (stageNumber === 8) {
      outputText = ensureOperationalHeaderText(outputText, doc.operationalHeader);
    }

    res.json({ text: outputText });
  } catch (err: any) {
    res.status(500).json({ error: err.message || 'Error al generar etapa con IA.' });
  }
});

// ============================================================================
// DIRECT IN-APP THUMBNAIL IMAGE GENERATOR (NANO BANANA / GEMINI-2.5-FLASH-IMAGE)
// Generates the exact thumbnail image from the Stage 5 prompt + Official Logo
// ============================================================================
app.post('/api/ai/generate-thumbnail-image', async (req, res) => {
  try {
    const { prompt, logoDataUrl } = req.body || {};
    const ai = getGeminiClient();
    if (!ai) {
      res.status(400).json({
        error: 'No hay Gemini API Key activa en el servidor.',
      });
      return;
    }

    const cleanPrompt = String(prompt || '')
      .replace(/^Thumbnail\s*:\s*/i, '')
      .trim();
    if (!cleanPrompt) {
      res.status(400).json({ error: 'El prompt de la miniatura está vacío.' });
      return;
    }

    const parts: any[] = [];
    if (logoDataUrl && typeof logoDataUrl === 'string') {
      if (logoDataUrl.startsWith('data:')) {
        const match = logoDataUrl.match(/^data:([^;]+);base64,(.+)$/);
        if (match && match[1] && match[2]) {
          parts.push({
            inlineData: {
              mimeType: match[1],
              data: match[2],
            },
          });
        }
      } else if (logoDataUrl.startsWith('/assets/')) {
        const localAssetPath = path.join(ASSETS_DIR, path.basename(logoDataUrl));
        if (fs.existsSync(localAssetPath)) {
          const buf = fs.readFileSync(localAssetPath);
          const ext = path.extname(localAssetPath).toLowerCase();
          const mime =
            ext === '.webp' ? 'image/webp' : ext === '.jpg' || ext === '.jpeg' ? 'image/jpeg' : 'image/png';
          parts.push({
            inlineData: {
              mimeType: mime,
              data: buf.toString('base64'),
            },
          });
        }
      }
    }

    parts.push({ text: cleanPrompt });

    const response = await ai.models.generateContent({
      model: 'gemini-2.5-flash-image',
      contents: [{ role: 'user', parts }],
      config: {
        responseModalities: ['TEXT', 'IMAGE'],
      },
    });

    const candidateParts = response?.candidates?.[0]?.content?.parts || [];
    const imgPart: any = candidateParts.find((p: any) => p?.inlineData?.data);
    if (!imgPart || !imgPart.inlineData?.data) {
      res.status(500).json({
        error: 'Nano Banana (gemini-2.5-flash-image) no devolvió imagen en este intento.',
      });
      return;
    }

    const mimeType = imgPart.inlineData.mimeType || 'image/png';
    const imageDataUrl = `data:${mimeType};base64,${imgPart.inlineData.data}`;
    res.json({ ok: true, imageDataUrl });
  } catch (err: any) {
    console.error('[Thumbnail Image Gen Error]:', err);
    res.status(500).json({
      error: err?.message || 'Error generando imagen de miniatura con Nano Banana.',
    });
  }
});

// ============================================================================
// AI PRODUCTION AUDITOR: VERIFY VOICEOVER vs CLIPS & SUGGEST IMPROVEMENTS
// ============================================================================
app.post('/api/ai/audit-clips', async (req, res) => {
  try {
    const { documentary } = req.body;
    const ai = getGeminiClient();
    if (!ai) {
      res.status(400).json({
        error: 'No hay Gemini API Key activa. Configúrala en el botón de llave superior.',
      });
      return;
    }

    const doc = documentary || {};
    const clipsList = Array.isArray(doc.clips) ? doc.clips : [];
    if (clipsList.length === 0) {
      res.status(400).json({ error: 'No hay clips cargados para auditar.' });
      return;
    }

    const includeVoiceInClips = doc.promptConfig?.VOZ_NARRATIVA_EN_CLIPS !== 'EXCLUIR';

    const auditPrompt = `Actúa como Director de Cine, Historiador y Supervisor de Continuidad de "Huellas de la Humanidad".
Tu tarea es auditar la coherencia entre:
1) La VOZ NARRATIVA RAW CON PAUSAS:
"""
${doc.voiceoverScript || ''}
"""

2) La VOZ NARRATIVA CON TIMESTAMPS (Narration Timeline Extractor):
"""
${doc.timelineFormattedText || ''}
"""

3) Los CLIPS ACTUALES DEL DOCUMENTAL (Tema: "${doc.topic || doc.title}", Época: "${doc.historicalTime}", Lugar: "${doc.historicalLocation}"):
${JSON.stringify(
  clipsList.map((c: any) => ({
    clipNumber: c.clipNumber,
    timeRange: c.timeRange,
    narrationSegment: c.narrationSegment,
    pauseNotes: c.pauseNotes,
    imagePrompt: c.imagePrompt,
    videoPrompt: c.videoPrompt,
  })),
  null,
  2
)}

REGLAS DE AUDITORÍA CLIP POR CLIP:
- Para el Clip 1 (00:00 - 00:04 / 00:06): Es el Hook visual sin voz narrativa, con audio Foley. Verifica que sea impactante y acorde al tema.
- Para cada Clip del 2 en adelante:
  1. Revisa si lo que describe el Prompt de Imagen Inicial (Image N) y el Prompt de Video (Clip N) HACE SENTIDO VISUAL Y NARRATIVO con lo que dice exactamente la voz narrativa ("narrationSegment") en ese intervalo de tiempo ("timeRange").
  2. PROHIBICIÓN DE DUPLICACIÓN ENTRE CLIPS CONSECUTIVOS (Clip N vs Clip N-1): Si la voz narrativa continúa en la misma escena o hilo argumental por más de un clip, el Clip [N] NO debe duplicar visualmente la misma puesta en escena del Clip [N-1] (ej. prohibido encadenar dos escenas seguidas de escritorio/mostrador de madera en una oficina con documentos, o dos habitaciones iguales seguidas). Si el Clip [N] repite un escenario o composición similar al Clip [N-1], márcalo como "warning" o "mismatch" y propón en "suggestedImagePrompt" y "suggestedVideoPrompt" una escena visualmente diferente pero referente a la locución (ej. pasar de un interior de oficina a un exterior luminoso en un muelle frente a un buque de vapor, o cambiar radicalmente de entorno y escala).
  3. Si la voz narrativa habla de una cosa (ej. el interior de un laboratorio o un documento específico, o la mesa del historiador cuando dice el slogan inicial "En los próximos minutos...") pero el prompt del clip muestra otra cosa desconectada o repetitiva, márcalo como "mismatch" o "warning".
  4. Revisa las pausas ([pausa: Xs]): Si a mitad del clip la voz narrativa hace una pausa y cambia a otra escena distinta, sugiere en "suggestedVideoPrompt" usar 2 shots de 5 segundos ("two-shot sequence of 5 seconds each: Shot 1 [0s-5s]...; Shot 2 [5s-10s]: clean cinematic cut at second 5 to..."). En caso contrario, mantén 1 solo shot continuo ("single continuous shot, strictly no shot changes").
  5. Si el clip tiene prompts vacíos, sobrecargados o mejorables, redacta "suggestedImagePrompt" (iniciando con "Image [N]: Create an image of ...", conciso de ~20-35 palabras con época, lugar, sujeto claro y cerrando con "cinematic lighting, historical accuracy, no text.") y "suggestedVideoPrompt" (iniciando con "Clip [N] ([timeRange]): Create a video showing ...", manteniendo el prompt de video MUY SIMPLE Y DIRECTO: 1 sola oración corta con 1 movimiento de cámara + 1 micro-acción física sobre la imagen inicial para que la IA generadora de clips no cometa errores, seguido de "Ambient Foley: [2-3 sonidos], single continuous shot, strictly no shot changes, no music, no speech, no text.", ${includeVoiceInClips ? 'la oración de la voz narrativa sin comillas ni paréntesis,' : ''} y terminando con "fix the name").
  6. Si el clip ya es coherente y cumple todas las reglas, pon auditStatus: "ok", explica brevemente por qué encaja bien en "auditReason", y deja "suggestedImagePrompt" y "suggestedVideoPrompt" vacíos ("").

Devuelve EXCLUSIVAMENTE un objeto JSON válido con la propiedad "audits" (array):
{
  "summary": "Resumen general en español de la revisión del timeline",
  "audits": [
    {
      "clipNumber": 1,
      "auditStatus": "ok" | "warning" | "mismatch",
      "auditReason": "Explicación clara en español de si el clip hace sentido con la voz narrativa o qué cambio se sugiere",
      "suggestedImagePrompt": "Image N: Create an image ... (solo si requiere cambio o estaba vacío, sino string vacío)",
      "suggestedVideoPrompt": "Clip N (MM:SS - MM:SS): Create a video ... fix the name (solo si requiere cambio o estaba vacío, sino string vacío)"
    }
  ]
}`;

    const models = [
      'gemini-3.1-pro-preview',
      'gemini-3.6-flash',
      'gemini-3-flash-preview',
      'gemini-2.5-flash',
    ];
    let responseText = '';
    let lastErr: any = null;

    for (const m of models) {
      try {
        const resp = await ai.models.generateContent({
          model: m,
          contents: [{ role: 'user', parts: [{ text: auditPrompt }] }],
          config: {
            responseMimeType: 'application/json',
          },
        });
        if (resp.text) {
          responseText = resp.text;
          break;
        }
      } catch (e: any) {
        lastErr = e;
      }
    }

    if (!responseText) {
      throw new Error(lastErr?.message || 'No se recibió respuesta del modelo al auditar los clips.');
    }

    const parsed = JSON.parse(responseText.trim());
    res.json(parsed);
  } catch (err: any) {
    console.error('Error en /api/ai/audit-clips:', err);
    res.status(500).json({ error: err.message || 'Error al auditar coherencia de los clips.' });
  }
});

// ============================================================================
// AI VISUAL VIDEO AUDITOR: VERIFY GOOGLE FLOW VIDEO FRAMES vs PROMPT & VOICEOVER
// ============================================================================
app.post('/api/ai/audit-clip-video', async (req, res) => {
  try {
    const { documentary, clip, frames, attempt } = req.body;
    const ai = getGeminiClient();
    if (!ai) {
      res.status(400).json({
        error: 'No hay Gemini API Key activa. Configúrala en el botón de llave superior.',
      });
      return;
    }

    const doc = documentary || {};
    const clipObj = clip || {};
    const frameList: string[] = Array.isArray(frames) ? frames : [];
    if (frameList.length === 0) {
      res.status(400).json({ error: 'No se recibieron fotogramas del video para auditar.' });
      return;
    }

    const includeVoiceInClips = doc.promptConfig?.VOZ_NARRATIVA_EN_CLIPS !== 'EXCLUIR';
    const promptText = `Actúa como Director de Cine, Historiador y Supervisor de Control de Calidad Visual de "Huellas de la Humanidad".
Acabas de recibir ${frameList.length} fotogramas reales (inicio, mitad y final) del video recién generado en Google Flow para el Clip #${clipObj.clipNumber || 1} (Intento #${attempt || 1}).

CONTEXTO DEL DOCUMENTAL:
- Título / Tema: ${doc.topic || doc.title || ''}
- Época Histórica: ${doc.historicalTime || ''}
- Lugar Histórico: ${doc.historicalLocation || ''}

DATOS DEL CLIP #${clipObj.clipNumber || 1} (${clipObj.timeRange || ''}):
- Voz Narrativa en este clip: "${
      Number(clipObj.clipNumber) === 1
        ? '[Clip 1 Hook inicial sin voz — Solo Foley y Texto en pantalla: ' +
          (doc.clip1Line1LocationTime || '') +
          ' / ' +
          (doc.clip1Line2Hook || '') +
          ']'
        : clipObj.narrationSegment || ''
    }"
- Prompt de Imagen Inicial: ${clipObj.imagePrompt || ''}
- Prompt de Video enviado a Google Flow: ${clipObj.videoPrompt || ''}

TU TAREA DE AUDITORÍA VISUAL (VIDEO REAL vs PROMPT vs VOZ NARRATIVA):
Observa detenidamente los fotogramas reales adjuntos y evalúa:
1. COHERENCIA CON LA VOZ NARRATIVA: ¿Lo que se ve en el video acompaña y tiene sentido directo con lo que dice la Voz Narrativa en este segmento?
2. CUMPLIMIENTO DEL PROMPT E HISTORIA: ¿Se respeta la época histórica (${doc.historicalTime || ''}), escenario y acción principal del prompt?
3. CALIDAD VISUAL Y LIBRE DE ERRORES IA: ¿Está libre de deformaciones graves (caras/manos monstruosas), anacronismos modernos evidentes, pantallas en negro o texto basura quemado?

CRITERIO DE VEREDICTO:
- "approved": El video se ve bien, encaja con la voz narrativa y con el prompt (score >= 75).
- "warning": El video es utilizable pero tiene un detalle menor (score 60-74).
- "rejected": El video NO coincide con la voz narrativa, ignoró el prompt, tiene errores visuales graves o anacronismos (score < 60). Si es "rejected", redacta obligatoriamente en "fixedVideoPrompt" un prompt de video corregido, más claro y directo para Google Flow iniciando con "Clip ${clipObj.clipNumber || 1} (${clipObj.timeRange || '00:00 - 00:10'}): Create a video showing ..." ${
      includeVoiceInClips && Number(clipObj.clipNumber) > 1 && clipObj.narrationSegment
        ? `incluyendo la oración narrativa "${clipObj.narrationSegment}" `
        : ''
    }y cerrando con "fix the name".

Devuelve EXCLUSIVAMENTE un objeto JSON válido:
{
  "clipNumber": ${Number(clipObj.clipNumber) || 1},
  "verdict": "approved" | "warning" | "rejected",
  "score": 90,
  "narrationMatch": true,
  "promptMatch": true,
  "visualQualityOk": true,
  "auditReason": "Explicación concisa en español de lo que se ve en el video y por qué aprueba o falla frente a la voz narrativa y el prompt",
  "issues": ["Lista de fallos si los hay"],
  "fixedVideoPrompt": "Prompt corregido listo para re-enviar a Google Flow si verdict es rejected, o string vacío si aprobó"
}`;

    const parts: any[] = [{ text: promptText }];
    for (const frame of frameList.slice(0, 4)) {
      const cleanBase64 = String(frame).replace(/^data:[^;]+;base64,/, '');
      if (cleanBase64) {
        parts.push({
          inlineData: {
            data: cleanBase64,
            mimeType: 'image/jpeg',
          },
        });
      }
    }

    const models = [
      'gemini-3.6-flash',
      'gemini-3-flash-preview',
      'gemini-2.5-flash',
      'gemini-3.1-pro-preview',
    ];
    let responseText = '';
    let lastErr: any = null;

    for (const m of models) {
      try {
        const resp = await ai.models.generateContent({
          model: m,
          contents: [{ role: 'user', parts }],
          config: {
            responseMimeType: 'application/json',
          },
        });
        if (resp.text) {
          responseText = resp.text;
          break;
        }
      } catch (e: any) {
        lastErr = e;
      }
    }

    if (!responseText) {
      throw new Error(lastErr?.message || 'No se recibió respuesta del modelo al auditar el video.');
    }

    const parsed = JSON.parse(responseText.trim());
    res.json(parsed);
  } catch (err: any) {
    console.error('Error en /api/ai/audit-clip-video:', err);
    res.status(500).json({ error: err.message || 'Error al auditar visualmente el video del clip.' });
  }
});

// ============================================================================
// NATIVE FOLDER PICKER & AUTO-DOWNLOAD SAVER FOR APPROVED GOOGLE FLOW VIDEOS
// ============================================================================
app.post('/api/system/pick-folder', async (_req, res) => {
  try {
    const { execFile } = await import('child_process');
    execFile(
      'osascript',
      [
        '-e',
        'POSIX path of (choose folder with prompt "Selecciona la carpeta donde Huellas Master descargará automáticamente los videos aprobados de Google Flow:")',
      ],
      (err, stdout) => {
        if (err) {
          res.status(400).json({ cancelled: true, error: 'Selección de carpeta cancelada.' });
          return;
        }
        const folderPath = (stdout || '').trim();
        res.json({ ok: true, folderPath });
      }
    );
  } catch (err: any) {
    res.status(500).json({ error: err.message || 'No se pudo abrir el selector de carpetas.' });
  }
});

function resolveSubfolderForDocumentaryAsset(fileName: string, explicitSubFolder?: string): string {
  if (explicitSubFolder && explicitSubFolder.trim()) {
    return path.basename(explicitSubFolder.trim());
  }
  const clean = path.basename(fileName);
  if (/^Miniatura_|^Logo_|miniatura/i.test(clean)) return '03_Miniaturas';
  if (/\.(mp3|wav|m4a|ogg)$/i.test(clean)) return '02_Audio';
  if (/^@|^Ref_|referencia/i.test(clean)) return '04_Referencias';
  if (/^(?:0*\d+[_\-\s.]|clip[_\-\s.]*0*\d+)/i.test(clean) && /\.(mp4|webm|mov)$/i.test(clean)) {
    return '05_Clips_Video';
  }
  if ((/^Documental_|_Master|_Final/i.test(clean)) && /\.mp4$/i.test(clean)) {
    return '06_Video_Final';
  }
  if (/\.(mp4|webm|mov)$/i.test(clean) || /_(Inicio|Fin)\.(png|jpg|jpeg|webp)$/i.test(clean)) {
    return '05_Clips_Video';
  }
  if (/\.(srt|txt|json|md)$/i.test(clean)) return '01_Guion_y_SEO';
  return '03_Miniaturas';
}

function ensureDocumentarySubfolders(rootFolderPath: string) {
  const subfolders = [
    '01_Guion_y_SEO',
    '02_Audio',
    '03_Miniaturas',
    '04_Referencias',
    '05_Clips_Video',
    '06_Video_Final',
  ];
  if (!fs.existsSync(rootFolderPath)) {
    fs.mkdirSync(rootFolderPath, { recursive: true });
  }
  for (const sf of subfolders) {
    const p = path.join(rootFolderPath, sf);
    if (!fs.existsSync(p)) {
      fs.mkdirSync(p, { recursive: true });
    }
  }
}

function resolveFfmpegBin(): string {
  const candidates = ['/usr/local/bin/ffmpeg', '/opt/homebrew/bin/ffmpeg', ffmpegStatic || 'ffmpeg'];
  for (const c of candidates) {
    try {
      if (c && (c === 'ffmpeg' || fs.existsSync(c))) return c;
    } catch {}
  }
  return 'ffmpeg';
}

async function upscaleMp4BufferTo4K(inputBuffer: Buffer): Promise<Buffer> {
  const tmpDir = os.tmpdir();
  const stamp = `${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  const inPath = path.join(tmpDir, `huellas_in_${stamp}.mp4`);
  const outPath = path.join(tmpDir, `huellas_4k_${stamp}.mp4`);
  const ffmpegBin = resolveFfmpegBin();
  const vfFilter = 'scale=3840:2160:flags=lanczos+accurate_rnd+full_chroma_int,unsharp=5:5:0.85:3:3:0.35';

  try {
    fs.writeFileSync(inPath, inputBuffer);

    const runFfmpeg = (args: string[]) =>
      new Promise<void>((resolve, reject) => {
        const proc = spawn(ffmpegBin, args, { stdio: 'ignore' });
        proc.on('error', reject);
        proc.on('close', (code) => {
          if (code === 0 && fs.existsSync(outPath) && fs.statSync(outPath).size > 10000) {
            resolve();
          } else {
            reject(new Error(`ffmpeg exited with code ${code}`));
          }
        });
      });

    try {
      // Primary: Apple Silicon / Mac Hardware Accelerated VideoToolbox 4K @ 28 Mbps (~6-8s per clip)
      await runFfmpeg([
        '-y',
        '-i',
        inPath,
        '-t',
        '10.5',
        '-r',
        '24',
        '-vf',
        vfFilter,
        '-c:v',
        'h264_videotoolbox',
        '-b:v',
        '28M',
        '-profile:v',
        'high',
        '-pix_fmt',
        'yuv420p',
        '-movflags',
        '+faststart',
        '-c:a',
        'copy',
        outPath,
      ]);
    } catch {
      // Fallback: CPU libx264 4K
      await runFfmpeg([
        '-y',
        '-i',
        inPath,
        '-t',
        '10.5',
        '-r',
        '24',
        '-vf',
        vfFilter,
        '-c:v',
        'libx264',
        '-preset',
        'veryfast',
        '-crf',
        '16',
        '-pix_fmt',
        'yuv420p',
        '-movflags',
        '+faststart',
        '-c:a',
        'copy',
        outPath,
      ]);
    }

    return fs.readFileSync(outPath);
  } catch (err) {
    console.warn('[4K Upscale] Usando buffer original por fallo en ffmpeg:', err);
    return inputBuffer;
  } finally {
    try {
      if (fs.existsSync(inPath)) fs.unlinkSync(inPath);
    } catch {}
    try {
      if (fs.existsSync(outPath)) fs.unlinkSync(outPath);
    } catch {}
  }
}

app.post('/api/flow/upscale-clip-4k', async (req, res) => {
  try {
    const { videoDataUrl } = req.body;
    if (!videoDataUrl || typeof videoDataUrl !== 'string') {
      res.status(400).json({ error: 'Falta videoDataUrl para escalar a 4K.' });
      return;
    }
    const cleanBase64 = videoDataUrl.replace(/^data:[^;]+;base64,/, '');
    const rawBuffer = Buffer.from(cleanBase64, 'base64');
    const upscaledBuffer = await upscaleMp4BufferTo4K(rawBuffer);
    const outDataUrl = `data:video/mp4;base64,${upscaledBuffer.toString('base64')}`;
    res.json({
      ok: true,
      videoDataUrl: outDataUrl,
      width: 3840,
      height: 2160,
      bytes: upscaledBuffer.length,
    });
  } catch (err: any) {
    console.error('[4K Upscale Endpoint Error]:', err);
    res.status(500).json({ error: err.message || 'Error al escalar clip a 4K.' });
  }
});

app.post('/api/flow/save-video-to-folder', async (req, res) => {
  try {
    const { folderPath = '', folderName = '', docTitle = '', fileName, videoDataUrl, subFolder } = req.body || {};
    const resolvedRoot =
      (folderPath && String(folderPath).trim() && fs.existsSync(String(folderPath).trim())
        ? String(folderPath).trim()
        : '') || resolveLocalDocumentaryFolder(folderPath, folderName, docTitle);
    if (!resolvedRoot || !fileName || !videoDataUrl) {
      res.status(400).json({ error: 'Faltan parámetros para guardar el video.' });
      return;
    }
    let safeName = path.basename(String(fileName).replace(/[^a-zA-Z0-9._-]/g, '_'));
    ensureDocumentarySubfolders(resolvedRoot);
    const resolvedSub = resolveSubfolderForDocumentaryAsset(safeName, subFolder || '05_Clips_Video');
    const targetDir = path.join(resolvedRoot, resolvedSub);
    if (!fs.existsSync(targetDir)) {
      fs.mkdirSync(targetDir, { recursive: true });
    }
    const isClipVideo = resolvedSub === '05_Clips_Video' && /\.mp4$/i.test(safeName);
    if (isClipVideo && !/[_\-]4k\.mp4$/i.test(safeName)) {
      safeName = safeName.replace(/\.mp4$/i, '_4K.mp4');
    }
    const fullTarget = path.join(targetDir, safeName);
    const cleanBase64 = String(videoDataUrl).replace(/^data:[^;]+;base64,/, '');
    const rawBuffer = Buffer.from(cleanBase64, 'base64');
    const finalBuffer = isClipVideo ? await upscaleMp4BufferTo4K(rawBuffer) : rawBuffer;
    fs.writeFileSync(fullTarget, finalBuffer);
    try {
      execSync(`chflags nohidden "${fullTarget.replace(/"/g, '\\"')}"`, { stdio: 'ignore' });
    } catch {}
    if (isClipVideo) {
      const mClip = safeName.match(/^0*(\d+)_/);
      if (mClip) {
        const paddedNum = String(parseInt(mClip[1], 10)).padStart(2, '0');
        const prefix = `${paddedNum}_`;
        for (const entry of fs.readdirSync(targetDir)) {
          if (
            entry !== safeName &&
            entry.startsWith(prefix) &&
            /\.(mp4|mov|webm)$/i.test(entry) &&
            !/^0*\d+_Imagen_Inicial/i.test(entry)
          ) {
            try {
              fs.unlinkSync(path.join(targetDir, entry));
            } catch {}
          }
        }
        // Extract/update initial frame .jpg for the 4K clip
        const baseNo4k = path.basename(safeName, path.extname(safeName)).replace(/[_\-]4k$/i, '');
        const suffixWithoutNum = baseNo4k.replace(/^0*\d+_/, '');
        const frameFileName = `${paddedNum}_Imagen_Inicial_${suffixWithoutNum}.jpg`;
        const frameFullPath = path.join(targetDir, frameFileName);
        try {
          const ffmpegBin = resolveFfmpegBin();
          await new Promise<void>((resolve) => {
            const proc = spawn(
              ffmpegBin,
              ['-y', '-i', fullTarget, '-frames:v', '1', '-q:v', '2', frameFullPath],
              { stdio: 'ignore' }
            );
            proc.on('error', () => resolve());
            proc.on('close', () => resolve());
          });
          if (fs.existsSync(frameFullPath)) {
            execSync(`chflags nohidden "${frameFullPath.replace(/"/g, '\\"')}"`, { stdio: 'ignore' });
          }
        } catch {}
      }
    }
    const savedSt = fs.statSync(fullTarget);
    res.json({
      ok: true,
      savedPath: fullTarget,
      subFolder: resolvedSub,
      fileName: safeName,
      bytes: finalBuffer.length,
      resolution: '3840x2160',
      url: `/api/flow/serve-folder-file?filePath=${encodeURIComponent(fullTarget)}&v=${Math.floor(savedSt.mtimeMs)}`,
    });
  } catch (err: any) {
    console.error('Error guardando video en carpeta elegida:', err);
    res.status(500).json({ error: err.message || 'Error guardando el archivo MP4.' });
  }
});

// Save any captured asset into its corresponding subfolder inside the single root folder
app.post('/api/flow/save-asset-to-folder', async (req, res) => {
  try {
    const { folderPath = '', folderName = '', docTitle = '', fileName, dataUrl, subFolder } = req.body || {};
    const resolvedRoot =
      (folderPath && String(folderPath).trim() && fs.existsSync(String(folderPath).trim())
        ? String(folderPath).trim()
        : '') || resolveLocalDocumentaryFolder(folderPath, folderName, docTitle);
    if (!resolvedRoot || !fileName || !dataUrl) {
      res.status(400).json({ error: 'Faltan parámetros para guardar el archivo.' });
      return;
    }
    let safeName = path.basename(String(fileName).replace(/[^a-zA-Z0-9._@-]/g, '_'));
    if (/^suno[_\-\s]*0*\d+\.(mp3|wav|m4a|ogg)$/i.test(safeName)) {
      res.json({ ok: true, skippedLegacySuno: true, fileName: safeName });
      return;
    }
    ensureDocumentarySubfolders(resolvedRoot);
    const resolvedSub = resolveSubfolderForDocumentaryAsset(safeName, subFolder);
    const targetDir = path.join(resolvedRoot, resolvedSub);
    if (!fs.existsSync(targetDir)) {
      fs.mkdirSync(targetDir, { recursive: true });
    }
    const isClipVideo = resolvedSub === '05_Clips_Video' && /\.(mp4|mov|webm)$/i.test(safeName);
    if (isClipVideo && !/[_\-]4k\.(mp4|mov|webm)$/i.test(safeName)) {
      safeName = safeName.replace(/\.(mp4|mov|webm)$/i, '_4K.mp4');
    }
    const fullTarget = path.join(targetDir, safeName);
    const cleanBase64 = String(dataUrl).replace(/^data:[^;]+;base64,/, '');
    const rawBuffer = Buffer.from(cleanBase64, 'base64');
    const finalBuffer = isClipVideo ? await upscaleMp4BufferTo4K(rawBuffer) : rawBuffer;
    fs.writeFileSync(fullTarget, finalBuffer);
    try {
      execSync(`chflags nohidden "${fullTarget.replace(/"/g, '\\"')}"`, { stdio: 'ignore' });
    } catch {}
    let frameUrl = '';
    if (isClipVideo) {
      const mClip = safeName.match(/^0*(\d+)_/);
      if (mClip) {
        const paddedNum = String(parseInt(mClip[1], 10)).padStart(2, '0');
        const prefix = `${paddedNum}_`;
        for (const entry of fs.readdirSync(targetDir)) {
          if (
            entry !== safeName &&
            entry.startsWith(prefix) &&
            /\.(mp4|mov|webm)$/i.test(entry) &&
            !/^0*\d+_Imagen_Inicial/i.test(entry)
          ) {
            try {
              fs.unlinkSync(path.join(targetDir, entry));
            } catch {}
          }
        }
        // Extract/update initial frame .jpg for the 4K clip
        const baseNo4k = path.basename(safeName, path.extname(safeName)).replace(/[_\-]4k$/i, '');
        const suffixWithoutNum = baseNo4k.replace(/^0*\d+_/, '');
        const frameFileName = `${paddedNum}_Imagen_Inicial_${suffixWithoutNum}.jpg`;
        const frameFullPath = path.join(targetDir, frameFileName);
        try {
          const ffmpegBin = resolveFfmpegBin();
          await new Promise<void>((resolve) => {
            const proc = spawn(
              ffmpegBin,
              ['-y', '-i', fullTarget, '-frames:v', '1', '-q:v', '2', frameFullPath],
              { stdio: 'ignore' }
            );
            proc.on('error', () => resolve());
            proc.on('close', () => resolve());
          });
          if (fs.existsSync(frameFullPath)) {
            execSync(`chflags nohidden "${frameFullPath.replace(/"/g, '\\"')}"`, { stdio: 'ignore' });
            const fst = fs.statSync(frameFullPath);
            frameUrl = `/api/flow/serve-folder-file?filePath=${encodeURIComponent(frameFullPath)}&v=${Math.floor(fst.mtimeMs)}`;
          }
        } catch {}
      }
    }
    const savedSt = fs.statSync(fullTarget);
    res.json({
      ok: true,
      savedPath: fullTarget,
      subFolder: resolvedSub,
      fileName: safeName,
      bytes: finalBuffer.length,
      url: `/api/flow/serve-folder-file?filePath=${encodeURIComponent(fullTarget)}&v=${Math.floor(savedSt.mtimeMs)}`,
      frameUrl,
    });
  } catch (err: any) {
    res.status(500).json({ error: err.message || 'Error guardando activo en carpeta.' });
  }
});

// ============================================================================
// ITEM 6: EXPORT ALL PROJECT FILES INTO ORGANIZED SUBFOLDERS INSIDE THE ROOT FOLDER
// ============================================================================
app.post('/api/project/export-organized-package', async (req, res) => {
  try {
    const {
      folderPath,
      docTitle,
      seoText,
      scriptText,
      srtText,
      rawClipsText,
      pinnedCommentText,
      thumbnailPromptsText,
      voiceoverDataUrl,
      sunoTracks,
      thumbnails,
    } = req.body;

    if (!folderPath || !String(folderPath).trim()) {
      res.status(400).json({ error: 'Se requiere folderPath para exportar en servidor.' });
      return;
    }

    const targetRoot = String(folderPath).trim();
    ensureDocumentarySubfolders(targetRoot);

    const seoDir = path.join(targetRoot, '01_Guion_y_SEO');
    const audioDir = path.join(targetRoot, '02_Audio');
    const thumbsDir = path.join(targetRoot, '03_Miniaturas');

    const savedFiles: string[] = [];

    if (srtText) {
      const srtPath = path.join(seoDir, 'Subtitulos.srt');
      fs.writeFileSync(srtPath, String(srtText), 'utf8');
      savedFiles.push('01_Guion_y_SEO/Subtitulos.srt');
    }

    if (scriptText) {
      const scriptPath = path.join(seoDir, 'Guion_Master.txt');
      fs.writeFileSync(scriptPath, String(scriptText), 'utf8');
      savedFiles.push('01_Guion_y_SEO/Guion_Master.txt');
    }

    if (rawClipsText) {
      const clipsTxtPath = path.join(seoDir, 'Prompts_Clips_Flow.txt');
      fs.writeFileSync(clipsTxtPath, String(rawClipsText), 'utf8');
      savedFiles.push('01_Guion_y_SEO/Prompts_Clips_Flow.txt');
    }

    const seoPackageContent = [
      '========================================================================',
      `HUELLAS DE LA HUMANIDAD — PAQUETE DE PUBLICACIÓN YOUTUBE / REELS`,
      `PROYECTO: ${docTitle || 'Documental'}`,
      `FECHA: ${new Date().toLocaleString('es-ES')}`,
      '========================================================================\n',
      '--- 1. TÍTULOS, DESCRIPCIÓN CON CAPÍTULOS (00:00) Y TAGS SEO (ETAPA 4) ---\n',
      seoText || '(Pendiente de generar Etapa 4)',
      '\n\n--- 2. COMENTARIO FIJADO PARA DEBATE EN YOUTUBE (ETAPA 9) ---\n',
      pinnedCommentText || '(Pendiente de generar Etapa 9)',
      '\n\n--- 3. PROMPTS DE MINIATURAS A/B TESTING (ETAPA 5) ---\n',
      thumbnailPromptsText || '(Pendiente de generar Etapa 5)',
      '\n',
    ].join('\n');

    const seoPath = path.join(seoDir, 'SEO_YouTube_Copiar_Pegar.txt');
    fs.writeFileSync(seoPath, seoPackageContent, 'utf8');
    savedFiles.push('01_Guion_y_SEO/SEO_YouTube_Copiar_Pegar.txt');

    if (voiceoverDataUrl && String(voiceoverDataUrl).startsWith('data:')) {
      const cleanB64 = String(voiceoverDataUrl).replace(/^data:[^;]+;base64,/, '');
      const voPath = path.join(audioDir, 'Voz_Narrativa.mp3');
      fs.writeFileSync(voPath, Buffer.from(cleanB64, 'base64'));
      savedFiles.push('02_Audio/Voz_Narrativa.mp3');
    }

    if (Array.isArray(sunoTracks)) {
      for (let i = 0; i < sunoTracks.length; i++) {
        const st = sunoTracks[i];
        if (st && st.audioDataUrl && String(st.audioDataUrl).startsWith('data:')) {
          const cleanB64 = String(st.audioDataUrl).replace(/^data:[^;]+;base64,/, '');
          const name = st.fileName || `FlowMusic_${String(i + 1).padStart(2, '0')}.mp3`;
          const stPath = path.join(audioDir, path.basename(name));
          fs.writeFileSync(stPath, Buffer.from(cleanB64, 'base64'));
          savedFiles.push(`02_Audio/${path.basename(name)}`);
        }
      }
    }

    if (Array.isArray(thumbnails)) {
      for (const th of thumbnails) {
        if (th && th.imageDataUrl && String(th.imageDataUrl).startsWith('data:')) {
          const cleanB64 = String(th.imageDataUrl).replace(/^data:[^;]+;base64,/, '');
          const name = th.fileName || `Miniatura_Opcion_${th.option || 'A'}.png`;
          const thPath = path.join(thumbsDir, path.basename(name));
          fs.writeFileSync(thPath, Buffer.from(cleanB64, 'base64'));
          savedFiles.push(`03_Miniaturas/${path.basename(name)}`);
        }
      }
    }

    res.json({
      ok: true,
      folderPath: targetRoot,
      savedFiles,
    });
  } catch (err: any) {
    console.error('Error exportando paquete organizado:', err);
    res.status(500).json({ error: err.message || 'Error creando paquete organizado.' });
  }
});

// ============================================================================
// ITEM 3: ULTRA-FAST NATIVE FFMPEG MULTI-TRACK RENDERER (HD / 2K / 4K / 8K)
// ============================================================================
app.post('/api/editor/render-ffmpeg', async (req, res) => {
  try {
    const {
      folderPath,
      docTitle,
      aspectRatio = '16:9',
      resolution = 'HD_1080P',
      clips = [],
      voiceoverStartSec = 6,
      voiceoverVolume = 1.0,
      voiceoverGainDb = 5,
      voiceoverDataUrl = '',
      sunoSilenceGapSec = 15,
      sunoMasterVolume = 0.14,
      musicTracks = [],
      srtContent = '',
    } = req.body;

    const resolvedDocFolder = resolveLocalDocumentaryFolder(folderPath, '', docTitle);
    const targetRoot =
      resolvedDocFolder ||
      (folderPath && String(folderPath).trim()
        ? String(folderPath).trim()
        : path.join(process.env.HOME || '/tmp', 'Downloads'));

    if (!fs.existsSync(targetRoot)) {
      fs.mkdirSync(targetRoot, { recursive: true });
    }

    const workDir = path.join(targetRoot, '.huellas_ffmpeg_temp');
    if (!fs.existsSync(workDir)) {
      fs.mkdirSync(workDir, { recursive: true });
    }

    // Resolution dimensions
    const resMap: Record<string, { w169: number; h169: number; label: string }> = {
      HD_1080P: { w169: 1920, h169: 1080, label: 'HD_1080p' },
      '2K_1440P': { w169: 2560, h169: 1440, label: '2K_1440p' },
      '4K_2160P': { w169: 3840, h169: 2160, label: '4K_2160p' },
      '8K_4320P': { w169: 7680, h169: 4320, label: '8K_4320p' },
    };
    const preset = resMap[resolution] || resMap.HD_1080P;
    const outW = aspectRatio === '9:16' ? preset.h169 : preset.w169;
    const outH = aspectRatio === '9:16' ? preset.w169 : preset.h169;

    // 1. Collect all available MP4 clips on disk (from 05_Clips_Video, Clips_Aprobados, or targetRoot)
    const normalizedClipPaths: string[] = [];
    const clipsVideoSubdir = path.join(targetRoot, '05_Clips_Video');
    const clipsSubdir = path.join(targetRoot, 'Clips_Aprobados');

    const introOutroDir = path.join(
      process.env.HOME || '/Users/raydelsantana',
      'Library/Mobile Documents/com~apple~CloudDocs/0YouTube/Huellas de la Humanidad/Intro:Outro'
    );

    for (let i = 0; i < clips.length; i++) {
      const c = clips[i];
      const fileName = c.fileName || `${String(c.clipNumber || i + 1).padStart(2, '0')}_Clip.mp4`;
      let sourceMp4 = '';

      const candidate0 = path.join(clipsVideoSubdir, fileName);
      const candidate1 = path.join(targetRoot, fileName);
      const candidate2 = path.join(clipsSubdir, fileName);
      if (Number(c.clipNumber) === 0 || /intro_huellas/i.test(fileName)) {
        const introPath = path.join(introOutroDir, 'Intro.mp4');
        if (fs.existsSync(introPath)) sourceMp4 = introPath;
      } else if (Number(c.clipNumber) === 999 || /outro_huellas/i.test(fileName)) {
        const outroPath = path.join(introOutroDir, 'Outro.mp4');
        if (fs.existsSync(outroPath)) sourceMp4 = outroPath;
      }
      if (sourceMp4) {
        // Already resolved Intro/Outro
      } else if (fs.existsSync(candidate0)) {
        sourceMp4 = candidate0;
      } else if (fs.existsSync(candidate1)) {
        sourceMp4 = candidate1;
      } else if (fs.existsSync(candidate2)) {
        sourceMp4 = candidate2;
      } else if (c.videoDataUrl && String(c.videoDataUrl).startsWith('data:')) {
        const cleanB64 = String(c.videoDataUrl).replace(/^data:[^;]+;base64,/, '');
        sourceMp4 = candidate1;
        fs.writeFileSync(sourceMp4, Buffer.from(cleanB64, 'base64'));
      } else {
        // Fallback: match by prefix number (e.g. "01_") in 05_Clips_Video, targetRoot, or Clips_Aprobados (prioritizing _4K.mp4)
        const num = Number(c.clipNumber || i + 1);
        const prefixRegex = new RegExp(`^(?:clip[_\\-\\s.]*)?0*${num}[_\\-\\s.]`, 'i');
        for (const searchDir of [clipsVideoSubdir, targetRoot, clipsSubdir]) {
          if (fs.existsSync(searchDir)) {
            const matches = fs
              .readdirSync(searchDir)
              .filter((f) => prefixRegex.test(f) && /\.(mp4|mov|webm)$/i.test(f))
              .sort((a, b) => {
                const a4k = /[_\-]4k\.(mp4|mov|webm)$/i.test(a) ? 1 : 0;
                const b4k = /[_\-]4k\.(mp4|mov|webm)$/i.test(b) ? 1 : 0;
                if (b4k !== a4k) return b4k - a4k;
                try {
                  return (
                    fs.statSync(path.join(searchDir, b)).mtimeMs -
                    fs.statSync(path.join(searchDir, a)).mtimeMs
                  );
                } catch {
                  return 0;
                }
              });
            if (matches.length > 0) {
              sourceMp4 = path.join(searchDir, matches[0]);
              break;
            }
          }
        }
      }

      // Prefer cleaned audio MP4 (.foley_only_cache / .vocals_cache / .music_cache) if present on c.videoUrl
      if (c.videoUrl && typeof c.videoUrl === 'string') {
        try {
          const parsedVid = new URL(c.videoUrl, 'http://localhost:4200');
          const vidFile = parsedVid.searchParams.get('filePath');
          if (
            vidFile &&
            fs.existsSync(vidFile) &&
            (!sourceMp4 ||
              c.foleyOnlyIsolated ||
              c.vocalsSeparated ||
              c.musicSeparated ||
              vidFile.includes('.foley_only_cache') ||
              vidFile.includes('.vocals_cache') ||
              vidFile.includes('.music_cache'))
          ) {
            sourceMp4 = vidFile;
          }
        } catch {}
      }

      // Check if an Optical Flow baked file already exists for this clip segment
      if (c.opticalFlowUrl && typeof c.opticalFlowUrl === 'string') {
        try {
          const parsedOpt = new URL(c.opticalFlowUrl, 'http://localhost:4200');
          const optFile = parsedOpt.searchParams.get('filePath');
          if (optFile && fs.existsSync(optFile)) {
            sourceMp4 = optFile;
          }
        } catch {}
      }

      if (!sourceMp4 || !fs.existsSync(sourceMp4)) continue;

      // Normalize each segment with FFmpeg so concat is 100% glitch-free
      const ffmpegBin = resolveFfmpegBin();
      const segOut = path.join(workDir, `seg_${String(i + 1).padStart(3, '0')}.mp4`);
      const usingPrebakedOpticalFlow =
        Boolean(c.opticalFlowUrl) && sourceMp4.includes('.optical_flow_cache');
      const slotDur =
        Number(c.end) > Number(c.start) + 0.2
          ? Math.max(0.4, Number(c.end) - Number(c.start))
          : 0;
      const probedSegDur = !usingPrebakedOpticalFlow
        ? await new Promise<number>((resolve) => {
            const p = spawn(ffmpegBin, ['-i', sourceMp4], {
              stdio: ['ignore', 'ignore', 'pipe'],
            });
            let se = '';
            p.stderr?.on('data', (d) => {
              se += d.toString();
            });
            p.on('close', () => {
              const m = se.match(/Duration:\s*(\d+):(\d+):(\d+(?:\.\d+)?)/);
              if (m) {
                const sec =
                  parseInt(m[1], 10) * 3600 +
                  parseInt(m[2], 10) * 60 +
                  parseFloat(m[3]);
                if (Number.isFinite(sec) && sec > 0.3) {
                  resolve(Math.max(0.3, sec - 0.06));
                  return;
                }
              }
              resolve(0);
            });
            p.on('error', () => resolve(0));
          })
        : 0;
      const trimStartSec = usingPrebakedOpticalFlow
        ? 0
        : Math.max(0, Number(c.trimStart || 0));
      const rawTrimEnd = usingPrebakedOpticalFlow
        ? 0
        : Number(c.trimEnd || 0) > trimStartSec
        ? Number(c.trimEnd)
        : 0;
      const trimEndSec =
        !usingPrebakedOpticalFlow && probedSegDur > 0.4
          ? rawTrimEnd > trimStartSec + 0.1 && rawTrimEnd < probedSegDur - 0.05
            ? rawTrimEnd
            : Math.max(trimStartSec + 0.2, probedSegDur - 0.05)
          : rawTrimEnd;
      const effectiveSpan =
        trimEndSec > trimStartSec + 0.1
          ? trimEndSec - trimStartSec
          : probedSegDur > trimStartSec + 0.2
          ? probedSegDur - trimStartSec
          : 0;
      const speed = usingPrebakedOpticalFlow
        ? 1
        : slotDur > 0.3 && effectiveSpan > 0.2
        ? Math.max(0.15, Math.min(4.0, effectiveSpan / slotDur))
        : Number(c.speed) > 0
        ? Number(c.speed)
        : 1;
      const smoothSlowMo =
        c.smoothSlowMo !== undefined ? Boolean(c.smoothSlowMo) : speed < 0.99;
      const ptsFactor = usingPrebakedOpticalFlow
        ? '1.0000'
        : slotDur > 0.3 && effectiveSpan > 0.2
        ? ((slotDur + 0.08) / effectiveSpan).toFixed(5)
        : (1 / speed).toFixed(4);
      const foleyVol = c.audioMuted
        ? 0
        : typeof c.foleyVolume === 'number'
        ? c.foleyVolume
        : 0.35;
      const isIntroClip = Number(c.clipNumber) === 0 || /intro_huellas/i.test(fileName);
      const isOutroClip = Number(c.clipNumber) === 999 || /outro_huellas/i.test(fileName);
      const isFirstClipAfterIntro =
        !isIntroClip &&
        !isOutroClip &&
        (Number(c.clipNumber) === 1 || (i === 1 && Number(clips[0]?.clipNumber) === 0));
      const effectiveClipDur =
        slotDur > 0.3
          ? slotDur
          : Number(c.durationSec) > 0.3
          ? Number(c.durationSec)
          : 8;
      const defaultAudioFadeIn = isIntroClip || isOutroClip ? 1.5 : isFirstClipAfterIntro ? 1.2 : 0;
      const defaultAudioFadeOut = isIntroClip || isOutroClip ? 2.5 : 0;
      const audioFadeInSec =
        typeof c.audioFadeInSec === 'number' ? Math.max(0, c.audioFadeInSec) : defaultAudioFadeIn;
      const audioFadeOutSec =
        typeof c.audioFadeOutSec === 'number' ? Math.max(0, c.audioFadeOutSec) : defaultAudioFadeOut;
      const afFades: string[] = [];
      if (audioFadeInSec > 0.01) {
        afFades.push(`afade=t=in:st=0:d=${audioFadeInSec.toFixed(2)}`);
      }
      if (audioFadeOutSec > 0.01 && effectiveClipDur > 0.1) {
        const fadeOutStart = Math.max(0, effectiveClipDur - audioFadeOutSec);
        afFades.push(`afade=t=out:st=${fadeOutStart.toFixed(2)}:d=${audioFadeOutSec.toFixed(2)}`);
      }
      const afFadePrefix = afFades.length > 0 ? `${afFades.join(',')},` : '';

      const vfFadeSuffix = isFirstClipAfterIntro
        ? ',fade=t=in:st=0:d=1.2'
        : isIntroClip
        ? ',fade=t=in:st=0:d=0.6,fade=t=out:st=7.2:d=0.8'
        : isOutroClip
        ? ',fade=t=in:st=0:d=1.2,fade=t=out:st=5.5:d=2.5'
        : '';
      const slowMoInterpFilter =
        !usingPrebakedOpticalFlow && speed < 0.96 && smoothSlowMo
          ? ',minterpolate=fps=30:mi_mode=mci:mc_mode=obmc:me_mode=bilat:me=ds:mb_size=16:search_param=8:scd=none'
          : ',fps=30';
      const vfTrimSuffix =
        !usingPrebakedOpticalFlow && slotDur > 0.3
          ? `,trim=duration=${slotDur.toFixed(3)},setpts=PTS-STARTPTS`
          : '';
      const vfFilter = `setpts=${ptsFactor}*(PTS-STARTPTS),scale=${outW}:${outH}:force_original_aspect_ratio=decrease,pad=${outW}:${outH}:(ow-iw)/2:(oh-ih)/2:black${slowMoInterpFilter},format=yuv420p${vfTrimSuffix}${vfFadeSuffix}`;
      const buildAtempoChain = (spd: number): string => {
        if (Math.abs(spd - 1) < 0.003) return '';
        const stages: string[] = [];
        let rem = Math.max(0.2, Math.min(4.0, spd));
        while (rem < 0.5) {
          stages.push('atempo=0.5');
          rem /= 0.5;
        }
        while (rem > 2.0) {
          stages.push('atempo=2.0');
          rem /= 2.0;
        }
        stages.push(`atempo=${rem.toFixed(4)}`);
        return `${stages.join(',')},`;
      };
      const atempoPrefix = buildAtempoChain(speed);
      const afTrimSuffix =
        !usingPrebakedOpticalFlow && slotDur > 0.3
          ? `,apad,atrim=duration=${slotDur.toFixed(3)},asetpts=PTS-STARTPTS`
          : '';
      const afFilter = `${atempoPrefix}${afFadePrefix}volume=${foleyVol}${afTrimSuffix}`;

      const inputTrimArgs: string[] = [];
      if (trimStartSec > 0.01) {
        inputTrimArgs.push('-ss', trimStartSec.toFixed(3));
      }
      if (trimEndSec > trimStartSec + 0.05) {
        inputTrimArgs.push('-to', trimEndSec.toFixed(3));
      }

      await new Promise<void>((resolve, reject) => {
        execFile(
          ffmpegBin,
          [
            '-y',
            ...inputTrimArgs,
            '-i',
            sourceMp4,
            '-vf',
            vfFilter,
            '-af',
            afFilter,
            '-c:v',
            'libx264',
            '-preset',
            'ultrafast',
            '-crf',
            '18',
            '-c:a',
            'aac',
            '-ar',
            '44100',
            '-ac',
            '2',
            segOut,
          ],
          { timeout: 180000 },
          (err) => {
            if (err) {
              // Retry without audio filter if source clip had no audio stream
              execFile(
                ffmpegBin,
                [
                  '-y',
                  ...inputTrimArgs,
                  '-i',
                  sourceMp4,
                  '-f',
                  'lavfi',
                  '-i',
                  'anullsrc=channel_layout=stereo:sample_rate=44100',
                  '-vf',
                  vfFilter,
                  '-c:v',
                  'libx264',
                  '-preset',
                  'ultrafast',
                  '-crf',
                  '18',
                  '-c:a',
                  'aac',
                  '-shortest',
                  segOut,
                ],
                { timeout: 180000 },
                (err2) => (err2 ? reject(err2) : resolve())
              );
            } else {
              resolve();
            }
          }
        );
      });

      normalizedClipPaths.push(segOut);
    }

    if (normalizedClipPaths.length === 0) {
      res.status(400).json({
        error:
          'No se encontraron archivos MP4 en la carpeta elegida ni en memoria. Asegúrate de haber descargado o importado al menos un clip MP4.',
      });
      return;
    }

    const startedAt = Date.now();

    // 2. Concatenate all normalized segments
    const concatListPath = path.join(workDir, 'concat_list.txt');
    const concatContent = normalizedClipPaths
      .map((p) => `file '${p.replace(/'/g, "'\\''")}'`)
      .join('\n');
    fs.writeFileSync(concatListPath, concatContent, 'utf8');

    const concatVideoPath = path.join(workDir, 'concat_video.mp4');
    await new Promise<void>((resolve, reject) => {
      execFile(
        'ffmpeg',
        ['-y', '-f', 'concat', '-safe', '0', '-i', concatListPath, '-c', 'copy', concatVideoPath],
        { timeout: 300000 },
        (err) => (err ? reject(err) : resolve())
      );
    });

    // 3. Check for Voiceover MP3 and Flow Music / Suno tracks to mix in final pass
    let voPath = path.join(targetRoot, '02_Audio', 'Voz_Narrativa.mp3');
    if (!fs.existsSync(voPath)) {
      voPath = path.join(targetRoot, 'Audio', 'Voz_Narrativa.mp3');
    }
    if (!fs.existsSync(voPath) && voiceoverDataUrl && String(voiceoverDataUrl).startsWith('data:')) {
      const cleanB64 = String(voiceoverDataUrl).replace(/^data:[^;]+;base64,/, '');
      voPath = path.join(workDir, 'voiceover_input.mp3');
      fs.writeFileSync(voPath, Buffer.from(cleanB64, 'base64'));
    }

    // Discover Flow Music / Suno tracks on disk or from base64 payload
    const resolvedMusicInputs: Array<{
      filePath: string;
      startSec: number;
      durationSec: number;
      volume?: number;
      fadeInSec: number;
      fadeOutSec: number;
    }> = [];
    const audioDirs = [path.join(targetRoot, '02_Audio'), path.join(targetRoot, 'Audio'), targetRoot];
    if (Array.isArray(musicTracks) && musicTracks.length > 0) {
      for (let i = 0; i < musicTracks.length; i++) {
        const mt = musicTracks[i] || {};
        const tNum = Number(mt.trackNumber || i + 1);
        let foundTrackPath = '';
        for (const ad of audioDirs) {
          if (!fs.existsSync(ad) || !fs.statSync(ad).isDirectory()) continue;
          const matchFile = fs.readdirSync(ad).find((f) => {
            const m = f.match(/(?:suno|flowmusic|flow_music|musica|pista|track)[_\-\s]*0*(\d+)/i);
            return m && parseInt(m[1], 10) === tNum && /\.(mp3|m4a|wav)$/i.test(f);
          });
          if (matchFile) {
            foundTrackPath = path.join(ad, matchFile);
            break;
          }
        }
        if (!foundTrackPath && mt.audioDataUrl && String(mt.audioDataUrl).startsWith('data:')) {
          const cleanB64 = String(mt.audioDataUrl).replace(/^data:[^;]+;base64,/, '');
          foundTrackPath = path.join(workDir, `flowmusic_${tNum}.mp3`);
          fs.writeFileSync(foundTrackPath, Buffer.from(cleanB64, 'base64'));
        }
        if (foundTrackPath && fs.existsSync(foundTrackPath)) {
          resolvedMusicInputs.push({
            filePath: foundTrackPath,
            startSec: Math.max(0, Number(mt.startSec || 0)),
            durationSec: Math.max(10, Number(mt.durationSec || 90)),
            volume:
              typeof mt.volume === 'number' && Number.isFinite(mt.volume)
                ? Math.max(0, Math.min(1, Number(mt.volume)))
                : undefined,
            fadeInSec:
              mt.fadeInSec !== undefined && mt.fadeInSec !== null
                ? Math.max(0, Number(mt.fadeInSec))
                : 5,
            fadeOutSec:
              mt.fadeOutSec !== undefined && mt.fadeOutSec !== null
                ? Math.max(0, Number(mt.fadeOutSec))
                : 5,
          });
        }
      }
    }

    const safeDocName = String(docTitle || 'Huellas_Documental')
      .replace(/[^a-zA-Z0-9_-]/g, '_')
      .slice(0, 45);
    const finalFileName = `${safeDocName}_${preset.label}_${aspectRatio.replace(':', 'x')}.mp4`;
    const finalOutputPath = path.join(targetRoot, finalFileName);

    if (srtContent) {
      fs.writeFileSync(path.join(targetRoot, 'Subtitulos.srt'), String(srtContent), 'utf8');
    }

    const hasVo = fs.existsSync(voPath);
    if (hasVo || resolvedMusicInputs.length > 0) {
      const ffmpegArgs: string[] = ['-y', '-i', concatVideoPath];
      const filterParts: string[] = [];
      const mixLabels: string[] = ['[0:a]'];
      let nextInputIdx = 1;

      const safeVoVol = Math.max(0.5, Math.min(1.0, Number(voiceoverVolume || 1.0)));
      const voDbMultiplier = Math.pow(10, Number(voiceoverGainDb ?? 5) / 20); // +5 dB => ~1.778x
      const boostedVoVol = safeVoVol * voDbMultiplier;
      if (hasVo) {
        ffmpegArgs.push('-i', voPath);
        const delayMs = Math.max(0, Math.round(Number(voiceoverStartSec || 0) * 1000));
        filterParts.push(
          `[${nextInputIdx}:a]adelay=${delayMs}|${delayMs},volume=${boostedVoVol.toFixed(3)}[vo]`
        );
        mixLabels.push('[vo]');
        nextInputIdx++;
      }

      const defaultMusicVol = Math.max(0, Math.min(1.0, Number(sunoMasterVolume ?? 0.1)));
      for (let mIdx = 0; mIdx < resolvedMusicInputs.length; mIdx++) {
        const mItem = resolvedMusicInputs[mIdx];
        ffmpegArgs.push('-i', mItem.filePath);
        const startMs = Math.max(0, Math.round(mItem.startSec * 1000));
        const dur = Math.max(8, mItem.durationSec);
        const trackVol =
          typeof mItem.volume === 'number' ? mItem.volume : defaultMusicVol;
        const fadeFilters: string[] = [];
        if (mItem.fadeInSec > 0) {
          fadeFilters.push(`afade=t=in:st=0:d=${mItem.fadeInSec}:curve=tri`);
        }
        if (mItem.fadeOutSec > 0) {
          const fadeOutStart = Math.max(0, Number((dur - mItem.fadeOutSec).toFixed(2)));
          fadeFilters.push(`afade=t=out:st=${fadeOutStart}:d=${mItem.fadeOutSec}:curve=tri`);
        }
        const fadeChain = fadeFilters.length > 0 ? `,${fadeFilters.join(',')}` : '';
        const lbl = `mus${mIdx}`;
        filterParts.push(
          `[${nextInputIdx}:a]atrim=0:${dur},asetpts=PTS-STARTPTS${fadeChain},volume=${trackVol.toFixed(3)},adelay=${startMs}|${startMs}[${lbl}]`
        );
        mixLabels.push(`[${lbl}]`);
        nextInputIdx++;
      }

      filterParts.push(
        `${mixLabels.join('')}amix=inputs=${mixLabels.length}:duration=first:dropout_transition=2:normalize=0[aout]`
      );

      ffmpegArgs.push(
        '-filter_complex',
        filterParts.join(';'),
        '-map',
        '0:v',
        '-map',
        '[aout]',
        '-c:v',
        'copy',
        '-c:a',
        'aac',
        '-b:a',
        '192k',
        finalOutputPath
      );

      await new Promise<void>((resolve, reject) => {
        execFile('ffmpeg', ffmpegArgs, { timeout: 300000 }, (err) => (err ? reject(err) : resolve()));
      });
    } else {
      fs.copyFileSync(concatVideoPath, finalOutputPath);
    }

    // Cleanup temp folder
    try {
      fs.rmSync(workDir, { recursive: true, force: true });
    } catch {}

    const elapsedSec = ((Date.now() - startedAt) / 1000).toFixed(1);
    res.json({
      ok: true,
      outputPath: finalOutputPath,
      fileName: finalFileName,
      clipsRendered: normalizedClipPaths.length,
      elapsedSec,
    });
  } catch (err: any) {
    console.error('Error en renderizado nativo FFmpeg:', err);
    res.status(500).json({
      error: err.message || 'Error ejecutando FFmpeg para renderizar el documental.',
    });
  }
});

// ============================================================================
// PERMANENT OFFICIAL LOGO ("HUELLAS DE LA HUMANIDAD") — UPLOAD ONCE FOREVER
// ============================================================================
const OFFICIAL_LOGO_FILE = path.join(DATA_DIR, 'official_huellas_logo.json');

app.get('/api/assets/official-logo', (_req, res) => {
  try {
    if (fs.existsSync(OFFICIAL_LOGO_FILE)) {
      const parsed = JSON.parse(fs.readFileSync(OFFICIAL_LOGO_FILE, 'utf8'));
      res.json({ ok: true, logoDataUrl: parsed.logoDataUrl || '', updatedAt: parsed.updatedAt || '' });
      return;
    }
    res.json({ ok: true, logoDataUrl: '' });
  } catch {
    res.json({ ok: true, logoDataUrl: '' });
  }
});

app.post('/api/assets/official-logo', (req, res) => {
  try {
    const { logoDataUrl } = req.body;
    if (!logoDataUrl) {
      res.status(400).json({ error: 'No se envió imagen de logo.' });
      return;
    }
    if (!fs.existsSync(DATA_DIR)) {
      fs.mkdirSync(DATA_DIR, { recursive: true });
    }
    const payload = {
      logoDataUrl: String(logoDataUrl),
      updatedAt: new Date().toISOString(),
    };
    fs.writeFileSync(OFFICIAL_LOGO_FILE, JSON.stringify(payload, null, 2), 'utf8');
    res.json({ ok: true, ...payload });
  } catch (err: any) {
    res.status(500).json({ error: err.message || 'Error guardando logo oficial.' });
  }
});

// ============================================================================
// PERMANENT OFFICIAL INTRO VIDEO (4s STINGER "MINIMALISMO EN PIEDRA Y ORO")
// Uploaded ONCE, stored forever across all documentaries
// ============================================================================
const OFFICIAL_INTRO_MP4_FILE = path.join(DATA_DIR, 'official_huellas_intro.mp4');
const OFFICIAL_INTRO_META_FILE = path.join(DATA_DIR, 'official_huellas_intro.json');

app.get('/api/assets/official-intro', (_req, res) => {
  try {
    if (fs.existsSync(OFFICIAL_INTRO_MP4_FILE)) {
      const stat = fs.statSync(OFFICIAL_INTRO_MP4_FILE);
      let meta: any = {};
      if (fs.existsSync(OFFICIAL_INTRO_META_FILE)) {
        try {
          meta = JSON.parse(fs.readFileSync(OFFICIAL_INTRO_META_FILE, 'utf8'));
        } catch {}
      }
      res.json({
        ok: true,
        hasIntro: true,
        introUrl: `/api/assets/official-intro-stream?t=${Math.floor(stat.mtimeMs)}`,
        fileName: meta.fileName || 'Intro_Oficial_Huellas_4s.mp4',
        updatedAt: meta.updatedAt || new Date(stat.mtimeMs).toISOString(),
      });
      return;
    }
    res.json({ ok: true, hasIntro: false, introUrl: '' });
  } catch {
    res.json({ ok: true, hasIntro: false, introUrl: '' });
  }
});

app.get('/api/assets/official-intro-stream', (_req, res) => {
  try {
    if (!fs.existsSync(OFFICIAL_INTRO_MP4_FILE)) {
      res.status(404).json({ error: 'No hay video de Intro Oficial guardado.' });
      return;
    }
    res.setHeader('Content-Type', 'video/mp4');
    res.sendFile(OFFICIAL_INTRO_MP4_FILE);
  } catch (err: any) {
    res.status(500).json({ error: err.message || 'Error sirviendo Intro Oficial.' });
  }
});

app.post('/api/assets/official-intro', (req, res) => {
  try {
    const { videoDataUrl, fileName = 'Intro_Oficial_Huellas_4s.mp4' } = req.body || {};
    if (!videoDataUrl || typeof videoDataUrl !== 'string') {
      res.status(400).json({ error: 'No se envió el archivo de video del Intro Oficial.' });
      return;
    }
    if (!fs.existsSync(DATA_DIR)) {
      fs.mkdirSync(DATA_DIR, { recursive: true });
    }
    const base64Clean = videoDataUrl.replace(/^data:[^;]+;base64,/, '');
    const buf = Buffer.from(base64Clean, 'base64');
    fs.writeFileSync(OFFICIAL_INTRO_MP4_FILE, buf);
    const meta = {
      fileName: String(fileName),
      sizeBytes: buf.length,
      updatedAt: new Date().toISOString(),
    };
    fs.writeFileSync(OFFICIAL_INTRO_META_FILE, JSON.stringify(meta, null, 2), 'utf8');
    res.json({
      ok: true,
      hasIntro: true,
      introUrl: `/api/assets/official-intro-stream?t=${Date.now()}`,
      ...meta,
    });
  } catch (err: any) {
    res.status(500).json({ error: err.message || 'Error guardando Intro Oficial.' });
  }
});

// ============================================================================
// AUTO-DISCOVER & STREAM MEDIA FROM CHOSEN DOCUMENTARY FOLDER FOR VIDEO EDITOR
// ============================================================================
function extractVideoNumberFromText(text?: string): string {
  const t = String(text || '').normalize('NFC').toLowerCase();
  const m = t.match(/\b(?:video|documental|ep\.?)\s*0*(\d+)\b/i);
  if (m) return String(parseInt(m[1], 10));
  if (t.includes('éxodo español') || t.includes('exodo espanol') || t.includes('maliaño')) return '76';
  if (t.includes('louvre')) return '75';
  if (t.includes('princesas de la edad media')) return '74';
  return '';
}

function resolveLocalDocumentaryFolder(
  folderPathQuery?: string,
  folderNameQuery?: string,
  docTitleQuery?: string
): string {
  const rawPath = String(folderPathQuery || '').trim();
  const rawName = String(folderNameQuery || '').trim();
  const rawTitle = String(docTitleQuery || '').trim();
  const homeDir = process.env.HOME || process.env.USERPROFILE || '';
  if (!homeDir) return '';

  const icloudVideosDir = path.join(
    homeDir,
    'Library',
    'Mobile Documents',
    'com~apple~CloudDocs',
    '0YouTube',
    'Huellas de la Humanidad',
    'Videos'
  );

  const titleVidNum = extractVideoNumberFromText(rawTitle);
  const pathVidNum = extractVideoNumberFromText(rawPath);
  const nameVidNum = extractVideoNumberFromText(rawName);

  // 1. Prioridad absoluta al número de Video del documental activo (docTitleQuery) para que nunca se crucen carpetas entre Video 75 y Video 76
  if (
    titleVidNum &&
    fs.existsSync(icloudVideosDir) &&
    fs.statSync(icloudVideosDir).isDirectory()
  ) {
    const prefixRegex = new RegExp(`^video\\s*0*${titleVidNum}\\b`, 'i');
    for (const entry of fs.readdirSync(icloudVideosDir)) {
      if (prefixRegex.test(entry.normalize('NFC'))) {
        const full = path.join(icloudVideosDir, entry);
        if (fs.existsSync(full) && fs.statSync(full).isDirectory()) return full;
      }
    }
  }

  // 2. Usar rawPath o rawName solo si no contradicen el número de Video de docTitleQuery
  const pathContradictsTitle = Boolean(titleVidNum && pathVidNum && titleVidNum !== pathVidNum);
  if (!pathContradictsTitle && rawPath && fs.existsSync(rawPath) && fs.statSync(rawPath).isDirectory()) {
    return rawPath;
  }

  const nameContradictsTitle = Boolean(titleVidNum && nameVidNum && titleVidNum !== nameVidNum);
  if (!nameContradictsTitle && rawName) {
    const candidates = [
      path.join(icloudVideosDir, rawName),
      path.join(icloudVideosDir, rawName.normalize('NFD')),
      path.join(icloudVideosDir, rawName.normalize('NFC')),
      path.join(homeDir, 'Desktop', rawName),
      path.join(homeDir, 'Downloads', rawName),
      path.join(homeDir, 'Documents', rawName),
      path.join(homeDir, rawName),
    ];
    for (const c of candidates) {
      if (fs.existsSync(c) && fs.statSync(c).isDirectory()) {
        return c;
      }
    }
    if (fs.existsSync(icloudVideosDir) && fs.statSync(icloudVideosDir).isDirectory()) {
      const targetNorm = rawName.normalize('NFC').toLowerCase();
      for (const entry of fs.readdirSync(icloudVideosDir)) {
        if (entry.normalize('NFC').toLowerCase() === targetNorm) {
          const full = path.join(icloudVideosDir, entry);
          if (fs.existsSync(full) && fs.statSync(full).isDirectory()) return full;
        }
      }
    }
  }

  // 3. Match by Video number from combined hint if titleVidNum was empty
  if (!titleVidNum && fs.existsSync(icloudVideosDir) && fs.statSync(icloudVideosDir).isDirectory()) {
    const combinedVidNum = nameVidNum || pathVidNum;
    if (combinedVidNum) {
      const prefixRegex = new RegExp(`^video\\s*0*${combinedVidNum}\\b`, 'i');
      for (const entry of fs.readdirSync(icloudVideosDir)) {
        if (prefixRegex.test(entry.normalize('NFC'))) {
          const full = path.join(icloudVideosDir, entry);
          if (fs.existsSync(full) && fs.statSync(full).isDirectory()) return full;
        }
      }
    }
  }

  return '';
}

app.get('/api/flow/list-folder-media', async (req, res) => {
  try {
    const folderPath = String(req.query.folderPath || '');
    const folderName = String(req.query.folderName || '');
    const docTitle = String(req.query.docTitle || '');
    const resolvedRoot = resolveLocalDocumentaryFolder(folderPath, folderName, docTitle);

    const clipVideos: Array<{ clipNumber: number; fileName: string; url: string }> = [];
    const clipFrames: Array<{ clipNumber: number; fileName: string; url: string }> = [];
    const voiceoverFiles: Array<{ fileName: string; url: string }> = [];
    const sunoFiles: Array<{ trackNumber: number; fileName: string; url: string }> = [];

    if (resolvedRoot) {
      const clipsDir = path.join(resolvedRoot, '05_Clips_Video');
      if (!fs.existsSync(clipsDir)) {
        try {
          fs.mkdirSync(clipsDir, { recursive: true });
        } catch {}
      }

      // Move any loose clip videos dropped in the project root into 05_Clips_Video first
      try {
        for (const rootEntry of fs.readdirSync(resolvedRoot)) {
          if (rootEntry.startsWith('.') || /^Documental_|_Master|_Final/i.test(rootEntry)) continue;
          if (/^(?:(?:clip|video|scene|escena)[_\-\s.]*)?0*\d+[_\-\s.(].*\.(mp4|webm|mov)$/i.test(rootEntry)) {
            const srcLoose = path.join(resolvedRoot, rootEntry);
            if (fs.statSync(srcLoose).isFile()) {
              fs.renameSync(srcLoose, path.join(clipsDir, rootEntry));
            }
          }
        }
      } catch {}

      // Auto-upscale any manually regenerated / newly added non-4K clip in 05_Clips_Video BEFORE serving it
      if (fs.existsSync(clipsDir) && fs.statSync(clipsDir).isDirectory()) {
        try {
          const allDirEntries = fs.readdirSync(clipsDir);
          const nowMs = Date.now();
          const has4kOrFrameByClip = new Set<number>();
          const canonicalBaseByClip = new Map<number, string>();
          const non4kVideos: Array<{
            entry: string;
            full: string;
            clipNum: number;
            mtimeMs: number;
            size: number;
          }> = [];

          for (const entry of allDirEntries) {
            if (entry.startsWith('.') || /\.tmp\.(mp4|webm|mov)$/i.test(entry)) continue;
            const full = path.join(clipsDir, entry);
            let st: fs.Stats;
            try {
              st = fs.statSync(full);
            } catch {
              continue;
            }
            if (!st.isFile()) continue;

            const mFrame = entry.match(/^0*(\d+)_Imagen_Inicial_(.+)\.(jpg|jpeg|png|webp)$/i);
            if (mFrame) {
              const cNum = parseInt(mFrame[1], 10);
              if (cNum > 0) {
                has4kOrFrameByClip.add(cNum);
                const padded = String(cNum).padStart(2, '0');
                if (!canonicalBaseByClip.has(cNum)) {
                  canonicalBaseByClip.set(cNum, `${padded}_${mFrame[2]}`);
                }
              }
              continue;
            }

            const mVid = entry.match(
              /^(?:(?:clip|video|scene|escena)[_\-\s.]*)?0*(\d+)[_\-\s.(].*\.(mp4|webm|mov)$/i
            );
            if (mVid) {
              const cNum = parseInt(mVid[1], 10);
              if (cNum <= 0) continue;
              const is4kName = /[_\-]4k\.(mp4|webm|mov)$/i.test(entry);
              const isReal4k = is4kName && st.size >= 12 * 1024 * 1024;
              const ext = path.extname(entry);
              const cleanBase = path.basename(entry, ext).replace(/[_\-]4k$/i, '');
              if (
                new RegExp(`^0*${cNum}_[a-zA-Z0-9]`, 'i').test(entry) &&
                !/^(?:clip|video|scene|escena)[_\-\s.]/i.test(entry)
              ) {
                canonicalBaseByClip.set(cNum, cleanBase);
              }
              if (isReal4k) {
                has4kOrFrameByClip.add(cNum);
              } else if (st.size > 10000) {
                non4kVideos.push({
                  entry,
                  full,
                  clipNum: cNum,
                  mtimeMs: st.mtimeMs,
                  size: st.size,
                });
              }
            }
          }

          // Identify recent non-4K videos (added/modified in the last 3 hours, or replacing an existing 4K/regenerated clip)
          // Exclude bulk batch dumps where >6 files share the exact same minute timestamp
          const recentWindowNon4k = non4kVideos.filter(
            (v) => nowMs - v.mtimeMs <= 3 * 3600 * 1000
          );
          const isSmallManualBatch = recentWindowNon4k.length > 0 && recentWindowNon4k.length <= 6;

          const toAutoUpscale = non4kVideos
            .filter((v) => has4kOrFrameByClip.has(v.clipNum) || (isSmallManualBatch && nowMs - v.mtimeMs <= 3 * 3600 * 1000))
            .sort((a, b) => b.mtimeMs - a.mtimeMs)
            .slice(0, 4);

          for (const item of toAutoUpscale) {
            if (!fs.existsSync(item.full)) continue;
            const paddedNum = String(item.clipNum).padStart(2, '0');
            let canonicalBase = canonicalBaseByClip.get(item.clipNum) || '';
            if (!canonicalBase) {
              let rawBase = path
                .basename(item.entry, path.extname(item.entry))
                .replace(/[_\-]4k$/i, '')
                .replace(/^(?:(?:clip|video|scene|escena)[_\-\s.]*)?0*\d+[_\-\s.]*/i, '')
                .replace(/\s+/g, '_')
                .replace(/_+/g, '_')
                .replace(/^_|_$/g, '');
              if (!rawBase) rawBase = 'Clip';
              canonicalBase = `${paddedNum}_${rawBase}`;
            }
            const final4kName = `${canonicalBase}_4K.mp4`;
            const final4kFull = path.join(clipsDir, final4kName);
            const tmp4kFull = path.join(
              os.tmpdir(),
              `huellas_autoload_4k_${canonicalBase}_${Date.now()}_${Math.random().toString(36).slice(2, 5)}.mp4`
            );
            try {
              await upscaleFileTo4KOnDisk(item.full, tmp4kFull, '16:9');
              if (fs.existsSync(tmp4kFull) && fs.statSync(tmp4kFull).size > 10000) {
                fs.copyFileSync(tmp4kFull, final4kFull);
                try {
                  execSync(`chflags nohidden "${final4kFull.replace(/"/g, '\\"')}"`, { stdio: 'ignore' });
                } catch {}
                // Delete non-4K original and any other older video files for this clip number
                const prefix = `${paddedNum}_`;
                for (const existing of fs.readdirSync(clipsDir)) {
                  const fullExisting = path.join(clipsDir, existing);
                  if (
                    path.resolve(fullExisting) !== path.resolve(final4kFull) &&
                    /\.(mp4|mov|webm)$/i.test(existing) &&
                    (existing.startsWith(prefix) || existing === item.entry)
                  ) {
                    try {
                      fs.unlinkSync(fullExisting);
                    } catch {}
                  }
                }
                // Extract/update initial frame .jpg
                const suffixWithoutNum = canonicalBase.replace(/^0*\d+_/, '');
                const frameFileName = `${paddedNum}_Imagen_Inicial_${suffixWithoutNum}.jpg`;
                const frameFullPath = path.join(clipsDir, frameFileName);
                try {
                  const ffmpegBin = resolveFfmpegBin();
                  await new Promise<void>((resolve) => {
                    const proc = spawn(
                      ffmpegBin,
                      ['-y', '-i', final4kFull, '-frames:v', '1', '-q:v', '2', frameFullPath],
                      { stdio: 'ignore' }
                    );
                    proc.on('error', () => resolve());
                    proc.on('close', () => resolve());
                  });
                  if (fs.existsSync(frameFullPath)) {
                    execSync(`chflags nohidden "${frameFullPath.replace(/"/g, '\\"')}"`, { stdio: 'ignore' });
                  }
                } catch {}
              }
            } catch (err) {
              console.warn(`[Auto-4K on Load] Failed to upscale ${item.entry}:`, err);
            } finally {
              try {
                if (fs.existsSync(tmp4kFull)) fs.unlinkSync(tmp4kFull);
              } catch {}
            }
          }
        } catch {}
      }

      const videoSubfolders = ['05_Clips_Video', 'Clips_Aprobados', ''];
      const seenVideoClips = new Set<number>();
      for (const sub of videoSubfolders) {
        const dir = sub ? path.join(resolvedRoot, sub) : resolvedRoot;
        if (!fs.existsSync(dir) || !fs.statSync(dir).isDirectory()) continue;
        const entries = fs.readdirSync(dir).sort((a, b) => {
          const a4k = /[_\-]4k\.(mp4|webm|mov)$/i.test(a) ? 1 : 0;
          const b4k = /[_\-]4k\.(mp4|webm|mov)$/i.test(b) ? 1 : 0;
          if (b4k !== a4k) return b4k - a4k;
          try {
            return fs.statSync(path.join(dir, b)).mtimeMs - fs.statSync(path.join(dir, a)).mtimeMs;
          } catch {
            return 0;
          }
        });
        for (const entry of entries) {
          if (entry.startsWith('.') || /\.tmp\.(mp4|webm|mov)$/i.test(entry)) continue;
          const full = path.join(dir, entry);
          const st = fs.statSync(full);
          if (!st.isFile()) continue;
          // Ensure macOS UF_HIDDEN flag is cleared on any visible clip video/image inside 05_Clips_Video
          if ((st as any).mode && /[_\-]4k\.(mp4|webm|mov)$/i.test(entry)) {
            try {
              execSync(`chflags nohidden "${full.replace(/"/g, '\\"')}"`, { stdio: 'ignore' });
            } catch {}
          }
          const mVid = entry.match(/^(?:(?:clip|video)[_\-\s.]*)?0*(\d+)[_\-\s.(].*\.(mp4|webm|mov)$/i);
          if (mVid) {
            const num = parseInt(mVid[1], 10);
            if (num > 0 && !seenVideoClips.has(num)) {
              seenVideoClips.add(num);
              clipVideos.push({
                clipNumber: num,
                fileName: entry,
                url: `/api/flow/serve-folder-file?filePath=${encodeURIComponent(full)}&v=${Math.floor(st.mtimeMs)}`,
              });
            }
          }
          const mImg = entry.match(/^(?:(?:image|imagen|clip)[_\-\s.]*)?0*(\d+)[_\-\s.(].*\.(png|jpg|jpeg|webp)$/i);
          if (mImg) {
            const num = parseInt(mImg[1], 10);
            if (num > 0) {
              clipFrames.push({
                clipNumber: num,
                fileName: entry,
                url: `/api/flow/serve-folder-file?filePath=${encodeURIComponent(full)}&v=${Math.floor(st.mtimeMs)}`,
              });
            }
          }
        }
      }

      const audioSubfolders = ['02_Audio', 'Audio', ''];
      for (const sub of audioSubfolders) {
        const dir = sub ? path.join(resolvedRoot, sub) : resolvedRoot;
        if (!fs.existsSync(dir) || !fs.statSync(dir).isDirectory()) continue;
        const entries = fs.readdirSync(dir);
        const hasFlowMusicByNum = new Set<number>();
        const hasTitledFlowMusicByNum = new Set<number>();
        for (const entry of entries) {
          const fullCheck = path.join(dir, entry);
          let stCheck: fs.Stats | null = null;
          try {
            stCheck = fs.statSync(fullCheck);
          } catch {}
          if (!stCheck || !stCheck.isFile() || stCheck.size < 1024) continue;
          const fm = entry.match(/^(?:flowmusic|flow_music)[_\-\s]*0*(\d+)/i);
          if (fm) {
            const num = parseInt(fm[1], 10) || 1;
            hasFlowMusicByNum.add(num);
            if (!/^(?:flowmusic|flow_music)[_\-\s]*0*\d+\.(mp3|wav|m4a|ogg)$/i.test(entry)) {
              hasTitledFlowMusicByNum.add(num);
            }
          }
        }
        for (const entry of entries) {
          const full = path.join(dir, entry);
          let st: fs.Stats;
          try {
            st = fs.statSync(full);
          } catch {
            continue;
          }
          if (!st.isFile()) continue;
          if (!/\.(mp3|wav|m4a|ogg)$/i.test(entry)) continue;
          // Auto-remove 0-byte / corrupted audio files
          if (st.size < 1024) {
            try {
              fs.unlinkSync(full);
            } catch {}
            continue;
          }
          // Auto-clean duplicate legacy Suno_0X.mp3 when FlowMusic_0X...mp3 exists in the same folder
          const legacySunoMatch = entry.match(/^suno[_\-\s]*0*(\d+)\.(mp3|wav|m4a|ogg)$/i);
          if (legacySunoMatch && hasFlowMusicByNum.has(parseInt(legacySunoMatch[1], 10) || 1)) {
            try {
              fs.unlinkSync(full);
              continue;
            } catch {}
          }
          // Auto-clean untitled duplicate FlowMusic_0X.mp3 when titled FlowMusic_0X_Title.mp3 exists
          const untitledFlowMatch = entry.match(/^(?:flowmusic|flow_music)[_\-\s]*0*(\d+)\.(mp3|wav|m4a|ogg)$/i);
          if (untitledFlowMatch && hasTitledFlowMusicByNum.has(parseInt(untitledFlowMatch[1], 10) || 1)) {
            try {
              fs.unlinkSync(full);
              continue;
            } catch {}
          }
          const sunoMatch = entry.match(
            /(?:flowmusic|flow_music|suno|musica|pista|track)[_\-\s]*0*(\d+)/i
          );
          if (sunoMatch) {
            sunoFiles.push({
              trackNumber: parseInt(sunoMatch[1], 10) || 1,
              fileName: entry,
              url: `/api/flow/serve-folder-file?filePath=${encodeURIComponent(full)}&v=${Math.floor(st.mtimeMs)}`,
            });
          } else {
            voiceoverFiles.push({
              fileName: entry,
              url: `/api/flow/serve-folder-file?filePath=${encodeURIComponent(full)}&v=${Math.floor(st.mtimeMs)}`,
            });
          }
        }
      }
    }

    // Also include available local TTS files as fallback voiceover options
    const localTtsFiles: Array<{ fileName: string; url: string }> = [];
    if (fs.existsSync(TTS_DIR)) {
      const ttsEntries = fs
        .readdirSync(TTS_DIR)
        .filter((f) => /\.(mp3|wav)$/i.test(f))
        .sort((a, b) => {
          try {
            return (
              fs.statSync(path.join(TTS_DIR, b)).mtimeMs -
              fs.statSync(path.join(TTS_DIR, a)).mtimeMs
            );
          } catch {
            return 0;
          }
        });
      for (const f of ttsEntries) {
        localTtsFiles.push({
          fileName: f,
          url: `/tts-files/${f}`,
        });
      }
    }

    res.json({
      ok: true,
      resolvedRoot,
      clipVideos: clipVideos.sort((a, b) => a.clipNumber - b.clipNumber),
      clipFrames: clipFrames.sort((a, b) => a.clipNumber - b.clipNumber),
      voiceoverFiles,
      sunoFiles: sunoFiles.sort((a, b) => a.trackNumber - b.trackNumber),
      localTtsFiles,
    });
  } catch (err: any) {
    res.json({
      ok: false,
      error: err.message || 'Error listando archivos de carpeta.',
      clipVideos: [],
      clipFrames: [],
      voiceoverFiles: [],
      sunoFiles: [],
      localTtsFiles: [],
    });
  }
});

app.get('/api/flow/serve-folder-file', (req, res) => {
  try {
    let filePath = String(req.query.filePath || '').trim();
    if (!filePath) {
      res.status(404).send('Archivo no encontrado');
      return;
    }
    // Redirect legacy destructive _foley_only.mp4 requests to _foley_v2.mp4 or the pristine source MP4
    if (/_foley_only\.mp4$/i.test(filePath)) {
      const v2Candidate = filePath.replace(/_foley_only\.mp4$/i, '_foley_v2.mp4');
      if (fs.existsSync(v2Candidate) && fs.statSync(v2Candidate).isFile()) {
        filePath = v2Candidate;
      } else if (filePath.includes('.foley_only_cache')) {
        const parentDir = path.dirname(path.dirname(filePath));
        const origName = path.basename(filePath).replace(/_foley_only\.mp4$/i, '.mp4');
        const origCandidate = path.join(parentDir, origName);
        if (fs.existsSync(origCandidate) && fs.statSync(origCandidate).isFile()) {
          filePath = origCandidate;
        }
      } else {
        const unSuffixed = filePath.replace(/_foley_only\.mp4$/i, '.mp4');
        if (fs.existsSync(unSuffixed) && fs.statSync(unSuffixed).isFile()) {
          filePath = unSuffixed;
        }
      }
    }
    // Serve 1080p H.264 web-preview for 8K HEVC Intro.mp4 / Outro.mp4 so browser live playback never stutters or distorts audio
    if (/(?:^|[\/\\])(Intro|Outro)\.mp4$/i.test(filePath)) {
      const baseName = path.basename(filePath, '.mp4');
      const webPreviewCandidate = path.join(
        path.dirname(filePath),
        `.${baseName}_WebPreview.mp4`
      );
      if (fs.existsSync(webPreviewCandidate) && fs.statSync(webPreviewCandidate).isFile()) {
        filePath = webPreviewCandidate;
      }
    }
    if (!fs.existsSync(filePath) || !fs.statSync(filePath).isFile()) {
      // Fallback: if non-4K clip path was requested after upgrading to _4K.mp4, serve the _4K.mp4 file seamlessly
      const ext = path.extname(filePath);
      const baseNoExt = path.basename(filePath, ext).replace(/[_\-]4k$/i, '');
      const dir = path.dirname(filePath);
      const candidate4k = path.join(dir, `${baseNoExt}_4K${ext}`);
      if (fs.existsSync(candidate4k) && fs.statSync(candidate4k).isFile()) {
        filePath = candidate4k;
      } else {
        res.status(404).send('Archivo no encontrado');
        return;
      }
    }
    // Allow browser to cache MP4 range chunks in memory (URLs already include ?v=mtimeMs cache-buster)
    const resolvedFilePath = path.resolve(filePath);
    try {
      const fileSize = fs.statSync(resolvedFilePath).size;
      const rangeHeader = req.headers.range;
      if (typeof rangeHeader === 'string') {
        const m = rangeHeader.match(/bytes=(\d*)-(\d*)/);
        if (m) {
          const start = m[1] ? parseInt(m[1], 10) : 0;
          const end = m[2] ? parseInt(m[2], 10) : fileSize - 1;
          if (start >= fileSize || start < 0) {
            delete req.headers.range;
          } else if (m[2] && end >= fileSize) {
            req.headers.range = `bytes=${start}-${Math.max(start, fileSize - 1)}`;
          }
        }
      }
    } catch {
      // ignore stat errors
    }
    res.setHeader('Cache-Control', 'private, max-age=3600');
    res.sendFile(resolvedFilePath, { dotfiles: 'allow' });
  } catch (err: any) {
    res.status(500).send(err.message || 'Error sirviendo archivo');
  }
});

// ============================================================================
// UNIFIED SEMI-AUTOMATIC PIPELINE: LOCATE, UNZIP & DELETE ZIP, NORMALIZE, UPSCALE 4K (_4K) & REPLACE ORIGINALS
// ============================================================================
interface ClipsPipelineStatus {
  running: boolean;
  phase: 'idle' | 'locating' | 'unzipping' | 'normalizing' | 'upscaling_4k' | 'completed' | 'error';
  current: number;
  total: number;
  currentFileName: string;
  message: string;
  extractedZipsCount: number;
  importedFilesCount: number;
  upscaled4kCount: number;
  already4kCount: number;
  completedAt?: string;
  error?: string;
}

let activeClipsPipelineStatus: ClipsPipelineStatus = {
  running: false,
  phase: 'idle',
  current: 0,
  total: 0,
  currentFileName: '',
  message: '',
  extractedZipsCount: 0,
  importedFilesCount: 0,
  upscaled4kCount: 0,
  already4kCount: 0,
};

app.get('/api/flow/process-clips-status', (_req, res) => {
  res.json({ ok: true, ...activeClipsPipelineStatus });
});

function normalizeWordTokensForMatch(str: string): string[] {
  return String(str || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
    .split(/\s+/)
    .filter((w) => w.length >= 2);
}

function inferClipNumberFromFileName(
  fileName: string,
  clipsList: Array<{ clipNumber: number; videoPrompt?: string; narrationSegment?: string }>
): number {
  const base = path.basename(fileName, path.extname(fileName));
  // 1. Direct leading number or Clip_XX prefix
  const mDirect = base.match(/^(?:(?:clip|video|scene|escena)[_\-\s.]*)?0*(\d+)(?:[_\-\s.(]|$)/i);
  if (mDirect) {
    const n = parseInt(mDirect[1], 10);
    if (n > 0 && n <= 300) return n;
  }
  // 2. Match against narrationSegment or videoPrompt words
  const fileTokens = normalizeWordTokensForMatch(base.replace(/[_\-]?4k$/i, ''));
  if (fileTokens.length >= 2 && Array.isArray(clipsList) && clipsList.length > 0) {
    let bestClipNum = 0;
    let bestScore = 0;
    for (const c of clipsList) {
      const cNum = Number(c.clipNumber);
      if (!cNum) continue;
      const narTokens = normalizeWordTokensForMatch(c.narrationSegment || '');
      const vidTokens = normalizeWordTokensForMatch(
        String(c.videoPrompt || '').replace(/^Clip\s*\d+\s*\([^)]*\)\s*:\s*/i, '')
      );
      let score = 0;
      for (let i = 0; i < Math.min(fileTokens.length, 7); i++) {
        const tok = fileTokens[i];
        if (narTokens.slice(0, 10).includes(tok)) score += 3;
        if (vidTokens.slice(0, 12).includes(tok)) score += 2;
      }
      if (score > bestScore && score >= 5) {
        bestScore = score;
        bestClipNum = cNum;
      }
    }
    if (bestClipNum > 0) return bestClipNum;
  }
  return 0;
}

async function upscaleFileTo4KOnDisk(
  inputPath: string,
  outputPath: string,
  aspectRatio: string = '16:9'
): Promise<void> {
  const ffmpegBin = resolveFfmpegBin();
  const isVertical = aspectRatio === '9:16';
  const targetW = isVertical ? 2160 : 3840;
  const targetH = isVertical ? 3840 : 2160;
  const vfFilter = `scale=${targetW}:${targetH}:flags=bicubic,unsharp=3:3:0.5:3:3:0.0,format=yuv420p`;

  const runFfmpegCmd = (args: string[]) =>
    new Promise<void>((resolve, reject) => {
      const proc = spawn(ffmpegBin, args, { stdio: 'ignore' });
      proc.on('error', reject);
      proc.on('close', (code) => {
        if (code === 0 && fs.existsSync(outputPath) && fs.statSync(outputPath).size > 10000) {
          resolve();
        } else {
          reject(new Error(`ffmpeg exited with code ${code}`));
        }
      });
    });

  try {
    await runFfmpegCmd([
      '-y',
      '-threads',
      '0',
      '-i',
      inputPath,
      '-vf',
      vfFilter,
      '-c:v',
      'h264_videotoolbox',
      '-b:v',
      '28M',
      '-profile:v',
      'high',
      '-pix_fmt',
      'yuv420p',
      '-movflags',
      '+faststart',
      '-c:a',
      'copy',
      outputPath,
    ]);
  } catch {
    await runFfmpegCmd([
      '-y',
      '-threads',
      '0',
      '-i',
      inputPath,
      '-vf',
      vfFilter,
      '-c:v',
      'libx264',
      '-preset',
      'veryfast',
      '-crf',
      '17',
      '-pix_fmt',
      'yuv420p',
      '-movflags',
      '+faststart',
      '-c:a',
      'copy',
      outputPath,
    ]);
  }
}

app.post('/api/flow/process-clips-pipeline', async (req, res) => {
  try {
    const {
      folderPath = '',
      folderName = '',
      docTitle = '',
      aspectRatio = '16:9',
      clips = [],
    } = req.body || {};

    const resolvedRoot = resolveLocalDocumentaryFolder(folderPath, folderName, docTitle);
    if (!resolvedRoot || !fs.existsSync(resolvedRoot)) {
      res.status(400).json({
        ok: false,
        error:
          'No se encontró la carpeta local del proyecto. Asegúrate de tener vinculada la carpeta del documental en tu Mac.',
      });
      return;
    }

    ensureDocumentarySubfolders(resolvedRoot);
    const clipsDir = path.join(resolvedRoot, '05_Clips_Video');
    const downloadsDir = path.join(process.env.HOME || '', 'Downloads');
    const clipsList = Array.isArray(clips) ? clips : [];

    activeClipsPipelineStatus = {
      running: true,
      phase: 'locating',
      current: 0,
      total: 0,
      currentFileName: '',
      message: 'Localizando clips y verificando archivos ZIP...',
      extractedZipsCount: 0,
      importedFilesCount: 0,
      upscaled4kCount: 0,
      already4kCount: 0,
    };

    // ------------------------------------------------------------------------
    // STEP 1: EXTRACT ANY .ZIP FILES IN 05_Clips_Video, resolvedRoot, OR ~/Downloads AND DELETE THE .ZIP
    // ------------------------------------------------------------------------
    activeClipsPipelineStatus.phase = 'unzipping';
    const zipCandidates: string[] = [];

    for (const dir of [clipsDir, resolvedRoot]) {
      if (!fs.existsSync(dir)) continue;
      for (const entry of fs.readdirSync(dir)) {
        if (entry.startsWith('.')) continue;
        if (/\.zip$/i.test(entry)) {
          zipCandidates.push(path.join(dir, entry));
        }
      }
    }

    // Also check ~/Downloads for recent .zip files (last 24h) that contain clip videos
    if (downloadsDir && fs.existsSync(downloadsDir)) {
      const nowMs = Date.now();
      for (const entry of fs.readdirSync(downloadsDir)) {
        if (entry.startsWith('.') || !/\.zip$/i.test(entry)) continue;
        const fullZip = path.join(downloadsDir, entry);
        try {
          const st = fs.statSync(fullZip);
          if (!st.isFile() || nowMs - st.mtimeMs > 24 * 3600 * 1000) continue;
          const listOut = execSync(`unzip -l "${fullZip.replace(/"/g, '\\"')}"`, {
            encoding: 'utf8',
            stdio: ['ignore', 'pipe', 'ignore'],
          });
          const hasClipVideos =
            /\.(mp4|mov|webm)/i.test(listOut) &&
            (/(?:^|\s|\/)(?:0*\d+_|clip|video|create_a_video)/i.test(listOut) ||
              /flow/i.test(entry));
          if (hasClipVideos) {
            zipCandidates.push(fullZip);
          }
        } catch {}
      }
    }

    for (const zipFull of zipCandidates) {
      if (!fs.existsSync(zipFull)) continue;
      const tmpUnzipDir = path.join(
        os.tmpdir(),
        `huellas_unzip_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`
      );
      try {
        activeClipsPipelineStatus.message = `Descomprimiendo ${path.basename(zipFull)}...`;
        fs.mkdirSync(tmpUnzipDir, { recursive: true });
        execSync(`unzip -o -j "${zipFull.replace(/"/g, '\\"')}" -d "${tmpUnzipDir}"`, {
          stdio: 'ignore',
        });
        for (const extracted of fs.readdirSync(tmpUnzipDir)) {
          if (extracted.startsWith('.') || extracted.startsWith('__MACOSX')) continue;
          if (/\.(mp4|mov|webm)$/i.test(extracted)) {
            const srcFile = path.join(tmpUnzipDir, extracted);
            const destFile = path.join(clipsDir, extracted);
            fs.copyFileSync(srcFile, destFile);
            activeClipsPipelineStatus.importedFilesCount++;
          }
        }
        // Delete the .zip file immediately after extraction as requested
        fs.unlinkSync(zipFull);
        activeClipsPipelineStatus.extractedZipsCount++;
      } catch (e) {
        console.warn('[ClipsPipeline] Warning extracting zip:', zipFull, e);
      } finally {
        try {
          if (fs.existsSync(tmpUnzipDir)) {
            fs.rmSync(tmpUnzipDir, { recursive: true, force: true });
          }
        } catch {}
      }
    }

    // ------------------------------------------------------------------------
    // STEP 2: LOCATE LOOSE CLIP VIDEOS IN resolvedRoot OR ~/Downloads (RECENT) AND MOVE TO 05_Clips_Video
    // ------------------------------------------------------------------------
    activeClipsPipelineStatus.phase = 'locating';
    if (fs.existsSync(resolvedRoot)) {
      for (const entry of fs.readdirSync(resolvedRoot)) {
        if (entry.startsWith('.') || !/\.(mp4|mov|webm)$/i.test(entry)) continue;
        if (/^Documental_|_Master|_Final/i.test(entry)) continue;
        const fullSrc = path.join(resolvedRoot, entry);
        try {
          if (fs.statSync(fullSrc).isFile()) {
            const dest = path.join(clipsDir, entry);
            fs.renameSync(fullSrc, dest);
            activeClipsPipelineStatus.importedFilesCount++;
          }
        } catch {}
      }
    }

    if (downloadsDir && fs.existsSync(downloadsDir) && clipsList.length > 0) {
      const nowMs = Date.now();
      for (const entry of fs.readdirSync(downloadsDir)) {
        if (entry.startsWith('.') || !/\.(mp4|mov|webm)$/i.test(entry)) continue;
        if (/^Documental_|_Master|_Final/i.test(entry)) continue;
        const fullDl = path.join(downloadsDir, entry);
        try {
          const st = fs.statSync(fullDl);
          if (!st.isFile() || nowMs - st.mtimeMs > 12 * 3600 * 1000) continue;
          const inferredNum = inferClipNumberFromFileName(entry, clipsList);
          if (inferredNum > 0) {
            // Verify word overlap with this documentary's clip so we only import clips belonging to this project
            const targetClip = clipsList.find((c: any) => Number(c.clipNumber) === inferredNum);
            if (targetClip) {
              const fileToks = normalizeWordTokensForMatch(entry);
              const clipToks = normalizeWordTokensForMatch(
                `${targetClip.narrationSegment || ''} ${targetClip.videoPrompt || ''}`
              );
              const overlap = fileToks.filter((t) => clipToks.includes(t)).length;
              if (overlap >= 2) {
                const dest = path.join(clipsDir, entry);
                fs.copyFileSync(fullDl, dest);
                fs.unlinkSync(fullDl);
                activeClipsPipelineStatus.importedFilesCount++;
              }
            }
          }
        } catch {}
      }
    }

    // ------------------------------------------------------------------------
    // STEP 3: NORMALIZE FILENAMES IN 05_Clips_Video (01 to 09 zero-padded, _ between words)
    // ------------------------------------------------------------------------
    activeClipsPipelineStatus.phase = 'normalizing';
    activeClipsPipelineStatus.message = 'Normalizando numeración y nombres de clips...';
    if (fs.existsSync(clipsDir)) {
      for (const entry of fs.readdirSync(clipsDir)) {
        if (entry.startsWith('.') || /\.tmp\.(mp4|mov|webm)$/i.test(entry)) continue;
        if (!/\.(mp4|mov|webm)$/i.test(entry)) continue;
        const fullOrig = path.join(clipsDir, entry);
        let st: fs.Stats;
        try {
          st = fs.statSync(fullOrig);
        } catch {
          continue;
        }
        if (!st.isFile()) continue;

        const clipNum = inferClipNumberFromFileName(entry, clipsList);
        if (clipNum > 0) {
          const isAlready4k = /[_\-]4k\.(mp4|mov|webm)$/i.test(entry);
          const ext = path.extname(entry);
          let rawBase = path.basename(entry, ext).replace(/[_\-]4k$/i, '');
          // Strip leading Clip_01 / 01_ prefix so we can re-prefix cleanly with 2-digit pad
          rawBase = rawBase
            .replace(/^(?:(?:clip|video|scene|escena)[_\-\s.]*)?0*\d+[_\-\s.]*/i, '')
            .replace(/\s+/g, '_')
            .replace(/_+/g, '_')
            .replace(/^_|_$/g, '');
          if (!rawBase) {
            rawBase = 'Clip';
          }
          const numPrefix = String(clipNum).padStart(2, '0');
          const normalizedName = `${numPrefix}_${rawBase}${isAlready4k ? '_4K' : ''}${ext}`;
          if (normalizedName !== entry) {
            const fullNormalized = path.join(clipsDir, normalizedName);
            if (!fs.existsSync(fullNormalized)) {
              try {
                fs.renameSync(fullOrig, fullNormalized);
              } catch {}
            }
          }
        }
      }
    }

    // ------------------------------------------------------------------------
    // STEP 4: UPSCALE ALL NON-4K VIDEOS TO 4K (_4K.mp4) AND DELETE OLD ORIGINALS
    // ------------------------------------------------------------------------
    activeClipsPipelineStatus.phase = 'upscaling_4k';
    const allVideoEntries = fs.existsSync(clipsDir)
      ? fs
          .readdirSync(clipsDir)
          .filter(
            (e) =>
              !e.startsWith('.') &&
              !/\.tmp\.(mp4|mov|webm)$/i.test(e) &&
              /\.(mp4|mov|webm)$/i.test(e)
          )
      : [];

    // Separate files that already have _4K vs files that need 4K conversion
    const pendingUpscaleFiles: string[] = [];
    for (const entry of allVideoEntries) {
      if (/[_\-]4k\.(mp4|mov|webm)$/i.test(entry)) {
        activeClipsPipelineStatus.already4kCount++;
      } else {
        pendingUpscaleFiles.push(entry);
      }
    }

    // Sort pending files by clip number
    pendingUpscaleFiles.sort((a, b) => {
      const na = inferClipNumberFromFileName(a, clipsList) || 9999;
      const nb = inferClipNumberFromFileName(b, clipsList) || 9999;
      return na - nb;
    });

    activeClipsPipelineStatus.total = pendingUpscaleFiles.length;
    activeClipsPipelineStatus.current = 0;

    // Process with concurrency = 2 for fast hardware-accelerated 4K conversion on Mac
    let nextIdx = 0;
    const workerCount = Math.min(2, pendingUpscaleFiles.length);
    const workers = Array.from({ length: workerCount }, async () => {
      while (nextIdx < pendingUpscaleFiles.length) {
        const myIdx = nextIdx++;
        const entry = pendingUpscaleFiles[myIdx];
        const srcFull = path.join(clipsDir, entry);
        if (!fs.existsSync(srcFull)) continue;

        const baseNoExt = path.basename(entry, path.extname(entry)).replace(/[_\-]4k$/i, '');
        const final4kName = `${baseNoExt}_4K.mp4`;
        const final4kFull = path.join(clipsDir, final4kName);
        // Write temp 4K file in os.tmpdir() WITHOUT a leading dot so macOS / iCloud Drive never sets UF_HIDDEN on the file
        const tmp4kFull = path.join(
          os.tmpdir(),
          `huellas_4k_${baseNoExt}_${Date.now()}_${Math.random().toString(36).slice(2, 5)}.mp4`
        );

        activeClipsPipelineStatus.currentFileName = entry;
        activeClipsPipelineStatus.message = `Mejorando a 4K (${activeClipsPipelineStatus.current + 1}/${activeClipsPipelineStatus.total}): ${entry}`;

        try {
          await upscaleFileTo4KOnDisk(srcFull, tmp4kFull, aspectRatio);
          if (fs.existsSync(tmp4kFull) && fs.statSync(tmp4kFull).size > 10000) {
            // Remove any older 4K file for the same clip number before placing the new _4K.mp4
            const clipNum = inferClipNumberFromFileName(entry, clipsList);
            if (clipNum > 0) {
              const prefix = `${String(clipNum).padStart(2, '0')}_`;
              for (const existing of fs.readdirSync(clipsDir)) {
                if (
                  existing.startsWith(prefix) &&
                  /[_\-]4k\.(mp4|mov|webm)$/i.test(existing) &&
                  existing !== path.basename(tmp4kFull)
                ) {
                  try {
                    fs.unlinkSync(path.join(clipsDir, existing));
                  } catch {}
                }
              }
            }
            fs.copyFileSync(tmp4kFull, final4kFull);
            try {
              execSync(`chflags nohidden "${final4kFull.replace(/"/g, '\\"')}"`, { stdio: 'ignore' });
            } catch {}
            // Delete the original non-4K video file so only the _4K.mp4 remains
            if (fs.existsSync(srcFull) && path.resolve(srcFull) !== path.resolve(final4kFull)) {
              fs.unlinkSync(srcFull);
            }
            activeClipsPipelineStatus.upscaled4kCount++;
          }
        } catch (err) {
          console.warn(`[ClipsPipeline] Error upscaling ${entry} to 4K:`, err);
        } finally {
          try {
            if (fs.existsSync(tmp4kFull)) fs.unlinkSync(tmp4kFull);
          } catch {}
          activeClipsPipelineStatus.current++;
        }
      }
    });

    await Promise.all(workers);

    // ------------------------------------------------------------------------
    // STEP 5: COLLECT FINAL 4K CLIPS LIST FOR STAGE 8 & VIDEO EDITOR TIMELINE
    // ------------------------------------------------------------------------
    const clipVideos: Array<{ clipNumber: number; fileName: string; url: string; is4K: boolean }> = [];
    const seenClips = new Set<number>();
    if (fs.existsSync(clipsDir)) {
      const finalEntries = fs
        .readdirSync(clipsDir)
        .filter(
          (e) =>
            !e.startsWith('.') &&
            !/\.tmp\.(mp4|mov|webm)$/i.test(e) &&
            /\.(mp4|mov|webm)$/i.test(e)
        )
        .sort((a, b) => {
          const a4k = /[_\-]4k\.(mp4|mov|webm)$/i.test(a) ? 1 : 0;
          const b4k = /[_\-]4k\.(mp4|mov|webm)$/i.test(b) ? 1 : 0;
          if (b4k !== a4k) return b4k - a4k;
          try {
            return (
              fs.statSync(path.join(clipsDir, b)).mtimeMs -
              fs.statSync(path.join(clipsDir, a)).mtimeMs
            );
          } catch {
            return 0;
          }
        });

      for (const entry of finalEntries) {
        const full = path.join(clipsDir, entry);
        const st = fs.statSync(full);
        if (!st.isFile()) continue;
        const mVid = entry.match(/^(?:(?:clip|video)[_\-\s.]*)?0*(\d+)[_\-\s.(].*\.(mp4|webm|mov)$/i);
        if (mVid) {
          const num = parseInt(mVid[1], 10);
          if (num > 0 && !seenClips.has(num)) {
            seenClips.add(num);
            clipVideos.push({
              clipNumber: num,
              fileName: entry,
              url: `/api/flow/serve-folder-file?filePath=${encodeURIComponent(full)}&v=${Math.floor(st.mtimeMs)}`,
              is4K: /[_\-]4k\.(mp4|webm|mov)$/i.test(entry),
            });
          }
        }
      }
    }

    clipVideos.sort((a, b) => a.clipNumber - b.clipNumber);

    activeClipsPipelineStatus = {
      ...activeClipsPipelineStatus,
      running: false,
      phase: 'completed',
      currentFileName: '',
      message: `Proceso completado: ${activeClipsPipelineStatus.upscaled4kCount} convertidos a 4K, ${activeClipsPipelineStatus.already4kCount} ya en 4K (${clipVideos.length} listos en el Timeline).`,
      completedAt: new Date().toISOString(),
    };

    res.json({
      ok: true,
      resolvedRoot,
      clipVideos,
      extractedZipsCount: activeClipsPipelineStatus.extractedZipsCount,
      importedFilesCount: activeClipsPipelineStatus.importedFilesCount,
      upscaled4kCount: activeClipsPipelineStatus.upscaled4kCount,
      already4kCount: activeClipsPipelineStatus.already4kCount,
      message: activeClipsPipelineStatus.message,
    });
  } catch (err: any) {
    activeClipsPipelineStatus = {
      ...activeClipsPipelineStatus,
      running: false,
      phase: 'error',
      error: err?.message || 'Error procesando clips a 4K.',
      message: err?.message || 'Error procesando clips a 4K.',
    };
    res.status(500).json({
      ok: false,
      error: err?.message || 'Error procesando clips a 4K.',
    });
  }
});

// ============================================================================
// SINGLE CLIP LOADER + 4K UPSCALER FOR STAGE 8 ("CARGAR CLIP")
// Finds the newest generated version of a clip in 05_Clips_Video / root / Downloads,
// upscales it to 4K (_4K.mp4), updates initial frame .jpg, and returns fresh stream URLs
// ============================================================================
app.post('/api/flow/load-and-upscale-single-clip', async (req, res) => {
  try {
    const {
      folderPath = '',
      folderName = '',
      docTitle = '',
      aspectRatio = '16:9',
      clip = {},
    } = req.body || {};

    const clipNumber = Number(clip.clipNumber || 0);
    if (!clipNumber || clipNumber <= 0) {
      res.status(400).json({ ok: false, error: 'Número de clip inválido.' });
      return;
    }

    const resolvedRoot = resolveLocalDocumentaryFolder(folderPath, folderName, docTitle);
    if (!resolvedRoot || !fs.existsSync(resolvedRoot)) {
      res.status(400).json({
        ok: false,
        error: 'No se encontró la carpeta local del documental en tu Mac.',
      });
      return;
    }

    ensureDocumentarySubfolders(resolvedRoot);
    const clipsDir = path.join(resolvedRoot, '05_Clips_Video');
    const downloadsDir = path.join(process.env.HOME || '', 'Downloads');
    const singleClipList = [
      {
        clipNumber,
        videoPrompt: String(clip.videoPrompt || ''),
        narrationSegment: String(clip.narrationSegment || ''),
      },
    ];

    // 1. Extract any .zip files sitting in 05_Clips_Video or resolvedRoot
    for (const dir of [clipsDir, resolvedRoot]) {
      if (!fs.existsSync(dir)) continue;
      for (const entry of fs.readdirSync(dir)) {
        if (entry.startsWith('.') || !/\.zip$/i.test(entry)) continue;
        const zipFull = path.join(dir, entry);
        const tmpUnzipDir = path.join(
          os.tmpdir(),
          `huellas_single_unzip_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`
        );
        try {
          fs.mkdirSync(tmpUnzipDir, { recursive: true });
          execSync(`unzip -o -j "${zipFull.replace(/"/g, '\\"')}" -d "${tmpUnzipDir}"`, {
            stdio: 'ignore',
          });
          for (const extracted of fs.readdirSync(tmpUnzipDir)) {
            if (extracted.startsWith('.') || extracted.startsWith('__MACOSX')) continue;
            if (/\.(mp4|mov|webm)$/i.test(extracted)) {
              fs.copyFileSync(path.join(tmpUnzipDir, extracted), path.join(clipsDir, extracted));
            }
          }
          fs.unlinkSync(zipFull);
        } catch {
        } finally {
          try {
            if (fs.existsSync(tmpUnzipDir)) fs.rmSync(tmpUnzipDir, { recursive: true, force: true });
          } catch {}
        }
      }
    }

    // 2. Gather all candidate video files for this clipNumber across 05_Clips_Video, resolvedRoot, Clips_Aprobados, and recent ~/Downloads
    const candidates: Array<{ fullPath: string; fileName: string; mtimeMs: number; dir: string }> = [];
    const matchesTargetClip = (entryName: string, checkOverlap = false): boolean => {
      if (entryName.startsWith('.') || /\.tmp\.(mp4|mov|webm)$/i.test(entryName)) return false;
      if (!/\.(mp4|mov|webm)$/i.test(entryName)) return false;
      if (/^Documental_|_Master|_Final/i.test(entryName)) return false;
      const mPrefix = entryName.match(
        /^(?:(?:clip|video|scene|escena)[_\-\s.]*)?0*(\d+)(?:[_\-\s.(]|$)/i
      );
      if (mPrefix && parseInt(mPrefix[1], 10) === clipNumber) {
        if (!checkOverlap) return true;
        // If from ~/Downloads, verify either explicit Clip_XX / 6-word overlap so we don't grab another project's file unless it's clearly this clip
        const fileToks = normalizeWordTokensForMatch(entryName);
        const clipToks = normalizeWordTokensForMatch(
          `${clip.narrationSegment || ''} ${clip.videoPrompt || ''}`
        );
        const overlap = fileToks.filter((t) => clipToks.includes(t)).length;
        if (overlap >= 1 || /^clip[_\-\s.]*0*\d+/i.test(entryName)) return true;
      }
      const inferred = inferClipNumberFromFileName(entryName, singleClipList);
      return inferred === clipNumber;
    };

    const projectDirs = [
      clipsDir,
      resolvedRoot,
      path.join(resolvedRoot, 'Clips_Aprobados'),
    ];
    for (const d of projectDirs) {
      if (!fs.existsSync(d) || !fs.statSync(d).isDirectory()) continue;
      for (const entry of fs.readdirSync(d)) {
        if (!matchesTargetClip(entry, false)) continue;
        const full = path.join(d, entry);
        try {
          const st = fs.statSync(full);
          if (st.isFile() && st.size > 10000) {
            candidates.push({ fullPath: full, fileName: entry, mtimeMs: st.mtimeMs, dir: d });
          }
        } catch {}
      }
    }

    if (downloadsDir && fs.existsSync(downloadsDir)) {
      const nowMs = Date.now();
      for (const entry of fs.readdirSync(downloadsDir)) {
        if (!matchesTargetClip(entry, true)) continue;
        const full = path.join(downloadsDir, entry);
        try {
          const st = fs.statSync(full);
          if (st.isFile() && st.size > 10000 && nowMs - st.mtimeMs <= 12 * 3600 * 1000) {
            candidates.push({ fullPath: full, fileName: entry, mtimeMs: st.mtimeMs, dir: downloadsDir });
          }
        } catch {}
      }
    }

    if (candidates.length === 0) {
      res.status(404).json({
        ok: false,
        error: `No se encontró ningún archivo de video para el Clip ${String(clipNumber).padStart(2, '0')} en 05_Clips_Video ni en Descargas.`,
      });
      return;
    }

    // Sort strictly by newest mtimeMs first ("la versión última generada del clip")
    candidates.sort((a, b) => b.mtimeMs - a.mtimeMs);
    const newest = candidates[0];

    // Determine canonical base filename for this clip (e.g. "06_para_levantar_un_nuevo_mundo_Si")
    const paddedNum = String(clipNumber).padStart(2, '0');
    let canonicalBase = '';
    const existingCanonical = candidates.find(
      (c) =>
        c.dir === clipsDir &&
        new RegExp(`^0*${clipNumber}_[a-zA-Z0-9]`, 'i').test(c.fileName) &&
        !/^(?:clip|video)[_\-\s.]/i.test(c.fileName)
    );
    if (clip.expectedFileName) {
      canonicalBase = path
        .basename(String(clip.expectedFileName), path.extname(String(clip.expectedFileName)))
        .replace(/[_\-]4k$/i, '');
    } else if (existingCanonical) {
      canonicalBase = path
        .basename(existingCanonical.fileName, path.extname(existingCanonical.fileName))
        .replace(/[_\-]4k$/i, '');
    } else {
      let rawBase = path
        .basename(newest.fileName, path.extname(newest.fileName))
        .replace(/[_\-]4k$/i, '')
        .replace(/^(?:(?:clip|video|scene|escena)[_\-\s.]*)?0*\d+[_\-\s.]*/i, '')
        .replace(/\s+/g, '_')
        .replace(/_+/g, '_')
        .replace(/^_|_$/g, '');
      if (!rawBase) rawBase = 'Clip';
      canonicalBase = `${paddedNum}_${rawBase}`;
    }

    const final4kName = `${canonicalBase}_4K.mp4`;
    const final4kFull = path.join(clipsDir, final4kName);

    // Check if the newest file is ALREADY a 4K file in clipsDir
    const isNewestAlready4KName = /[_\-]4k\.(mp4|mov|webm)$/i.test(newest.fileName);
    let wasUpscaled = false;

    if (isNewestAlready4KName && path.resolve(newest.fullPath) === path.resolve(final4kFull)) {
      // Touch mtime so cache-buster refreshes
      const now = new Date();
      try {
        fs.utimesSync(final4kFull, now, now);
      } catch {}
    } else if (isNewestAlready4KName) {
      fs.copyFileSync(newest.fullPath, final4kFull);
      if (path.resolve(newest.fullPath) !== path.resolve(final4kFull)) {
        try {
          fs.unlinkSync(newest.fullPath);
        } catch {}
      }
    } else {
      // Upscale newest file to 4K UHD (_4K.mp4) using os.tmpdir() WITHOUT a leading dot so macOS / iCloud Drive never sets UF_HIDDEN
      const tmp4kFull = path.join(
        os.tmpdir(),
        `huellas_single_4k_${canonicalBase}_${Date.now()}_${Math.random().toString(36).slice(2, 5)}.mp4`
      );
      try {
        await upscaleFileTo4KOnDisk(newest.fullPath, tmp4kFull, aspectRatio);
        if (fs.existsSync(tmp4kFull) && fs.statSync(tmp4kFull).size > 10000) {
          fs.copyFileSync(tmp4kFull, final4kFull);
          wasUpscaled = true;
        }
      } finally {
        try {
          if (fs.existsSync(tmp4kFull)) fs.unlinkSync(tmp4kFull);
        } catch {}
      }
    }

    // Ensure macOS UF_HIDDEN flag is explicitly cleared on the final 4K clip so it is 100% visible in Finder
    if (fs.existsSync(final4kFull)) {
      try {
        execSync(`chflags nohidden "${final4kFull.replace(/"/g, '\\"')}"`, { stdio: 'ignore' });
      } catch {}
    }

    // Clean up any other older / non-4K video files for this clipNumber in clipsDir (and if newest came from Downloads, remove the duplicate from Downloads)
    if (fs.existsSync(final4kFull)) {
      for (const c of candidates) {
        if (
          (c.dir === clipsDir || c.dir === downloadsDir) &&
          path.resolve(c.fullPath) !== path.resolve(final4kFull) &&
          fs.existsSync(c.fullPath)
        ) {
          try {
            fs.unlinkSync(c.fullPath);
          } catch {}
        }
      }
    }

    const activeVideoFull = fs.existsSync(final4kFull) ? final4kFull : newest.fullPath;
    const activeVideoName = path.basename(activeVideoFull);
    const activeVideoStat = fs.statSync(activeVideoFull);

    // Also extract/update the initial frame .jpg in 05_Clips_Video so the thumbnail/poster matches the updated clip
    const suffixWithoutNum = canonicalBase.replace(/^0*\d+_/, '');
    const frameFileName = `${paddedNum}_Imagen_Inicial_${suffixWithoutNum}.jpg`;
    const frameFullPath = path.join(clipsDir, frameFileName);
    let frameUrl = '';
    try {
      const ffmpegBin = resolveFfmpegBin();
      await new Promise<void>((resolve) => {
        const proc = spawn(
          ffmpegBin,
          ['-y', '-i', activeVideoFull, '-frames:v', '1', '-q:v', '2', frameFullPath],
          { stdio: 'ignore' }
        );
        proc.on('error', () => resolve());
        proc.on('close', () => resolve());
      });
      if (fs.existsSync(frameFullPath)) {
        try {
          execSync(`chflags nohidden "${frameFullPath.replace(/"/g, '\\"')}"`, { stdio: 'ignore' });
        } catch {}
        const fst = fs.statSync(frameFullPath);
        frameUrl = `/api/flow/serve-folder-file?filePath=${encodeURIComponent(frameFullPath)}&v=${Math.floor(fst.mtimeMs)}`;
      }
    } catch {}

    const videoUrl = `/api/flow/serve-folder-file?filePath=${encodeURIComponent(activeVideoFull)}&v=${Math.floor(activeVideoStat.mtimeMs)}`;

    res.json({
      ok: true,
      clipNumber,
      fileName: activeVideoName,
      url: videoUrl,
      frameUrl,
      is4K: /[_\-]4k\.(mp4|mov|webm)$/i.test(activeVideoName),
      wasUpscaled,
    });
  } catch (err: any) {
    res.status(500).json({
      ok: false,
      error: err?.message || 'Error cargando y mejorando el clip a 4K.',
    });
  }
});

// ============================================================================
// ETAPA 12: POST-PRODUCTION AUDIENCE COMMENT REPLIES (SCREENSHOTS OR TEXT)
// ============================================================================
app.post('/api/ai/reply-comments', async (req, res) => {
  try {
    const { documentary, commentText, imageBase64, mimeType, customInstruction } = req.body;
    const ai = getGeminiClient();
    if (!ai) {
      res.status(400).json({
        error: 'No hay Gemini API Key activa. Configúrala en el botón de llave superior.',
      });
      return;
    }

    if (!commentText && !imageBase64) {
      res.status(400).json({
        error: 'Envía una captura de pantalla de los comentarios o escribe el texto del comentario.',
      });
      return;
    }

    const doc = documentary || {};
    const promptText = `Actúa como el historiador principal y director de "Huellas de la Humanidad".
Contexto del documental publicado:
- Título / Tema: ${doc.publishTitle || doc.topic || doc.title || 'Documental Histórico'}
- Época y Lugar: ${doc.historicalTime || ''} | ${doc.historicalLocation || ''}
- Resumen / Guion de referencia:
"""
${(doc.voiceoverScript || doc.sectionsStructure || doc.publishDescription || '').slice(0, 3500)}
"""

${commentText ? `Comentario(s) enviado(s) en texto por el usuario:\n"""\n${commentText}\n"""\n` : ''}
${customInstruction ? `Enfoque o instrucción adicional del director: ${customInstruction}\n` : ''}

TU TAREA (ETAPA 12 POST-PRODUCCIÓN — RESPONDER COMENTARIOS DE LA AUDIENCIA DE FORMA CERTERA Y CONCISA):
1. Si se adjuntó una captura de pantalla, transcribe fielmente cada comentario visible de la audiencia (incluyendo el @usuario si aparece). Si se envió texto, úsalo directamente.
2. Para cada comentario (sea duda histórica, debate, corrección, escepticismo o elogio), redacta:
   - "replyConcise": Una respuesta **certera, históricamente rigurosa y concisa** (1 a 3 oraciones máximo, directa al grano, elegante, con autoridad académica pero cercana, que aporte un dato histórico verificado del episodio o aclare la duda con precisión quirúrgica).
   - "replyAlternative": Una segunda opción de respuesta breve que cierre con una pregunta sutil o reflexión histórica para impulsar el engagement en el hilo de comentarios.
   - "historicalContextNote": Nota interna brevísima para el creador confirmando el dato histórico exacto utilizado.
3. REGLAS DE FORMATO OBLIGATORIAS DE LA MARCA:
   - Años siempre en dígitos numéricos (ej. 1888, 1943).
   - Siglos y nombres de monarcas/papas/emperadores con número en números romanos (ej. siglo XIX, Felipe II, Luis XIV).
   - Cantidades en miles con dígitos seguidos de la palabra "mil" (ej. 70 mil).
   - CERO signos de exclamación (¡!) en las respuestas.

Devuelve EXCLUSIVAMENTE un objeto JSON válido con esta estructura:
{
  "replies": [
    {
      "author": "@usuario o Audiencia",
      "commentText": "Texto exacto del comentario detectado",
      "replyConcise": "Respuesta principal certera y concisa (1-3 oraciones, sin signos de exclamación)",
      "replyAlternative": "Opción alternativa breve con cierre de engagement (sin signos de exclamación)",
      "historicalContextNote": "Dato histórico de respaldo"
    }
  ]
}`;

    const parts: any[] = [{ text: promptText }];
    if (imageBase64) {
      const cleanBase64 = String(imageBase64).replace(/^data:[^;]+;base64,/, '');
      parts.push({
        inlineData: {
          data: cleanBase64,
          mimeType: mimeType || 'image/png',
        },
      });
    }

    const models = [
      'gemini-3.1-pro-preview',
      'gemini-3.6-flash',
      'gemini-3-flash-preview',
      'gemini-2.5-flash',
    ];
    let responseText = '';
    let lastErr: any = null;

    for (const m of models) {
      try {
        const resp = await ai.models.generateContent({
          model: m,
          contents: [{ role: 'user', parts }],
          config: {
            responseMimeType: 'application/json',
          },
        });
        if (resp.text) {
          responseText = resp.text;
          break;
        }
      } catch (e: any) {
        lastErr = e;
      }
    }

    if (!responseText) {
      throw new Error(lastErr?.message || 'No se pudo generar respuesta para los comentarios.');
    }

    const parsed = JSON.parse(responseText.trim());
    res.json(parsed);
  } catch (err: any) {
    console.error('Error en /api/ai/reply-comments:', err);
    res.status(500).json({ error: err.message || 'Error al procesar los comentarios de la audiencia.' });
  }
});

// ============================================================================
// ETAPA 1 & 3: YOUTUBE COMMENTS MINER (TARGET VIDEO + @huellas_de_la_humanidad)
// Data-only Innertube JSON requests (/youtubei/v1/next) — ZERO video playback,
// ZERO views counted, ZERO retention impact, 100% public read-only.
// ============================================================================
const HUELLAS_OFFICIAL_CHANNEL_HANDLE = '@huellas_de_la_humanidad';
const HUELLAS_OFFICIAL_CHANNEL_URL = 'https://www.youtube.com/@huellas_de_la_humanidad';
const HUELLAS_CHANNEL_COMMENTS_CACHE_FILE = path.join(
  DATA_DIR,
  'huellas_channel_comments_cache.json'
);
const HUELLAS_CHANNEL_CACHE_TTL_MS = 6 * 60 * 60 * 1000; // 6 hours

interface YoutubeExtractedComment {
  author: string;
  text: string;
  likes: string;
  videoTitle?: string;
  videoId?: string;
}

function extractYoutubeVideoId(rawUrl: string): string | null {
  const clean = String(rawUrl || '').trim();
  if (!clean) return null;
  if (/^[a-zA-Z0-9_-]{11}$/.test(clean)) return clean;
  const patterns = [
    /[?&]v=([a-zA-Z0-9_-]{11})/,
    /youtu\.be\/([a-zA-Z0-9_-]{11})/,
    /youtube\.com\/shorts\/([a-zA-Z0-9_-]{11})/,
    /youtube\.com\/embed\/([a-zA-Z0-9_-]{11})/,
    /youtube\.com\/live\/([a-zA-Z0-9_-]{11})/,
  ];
  for (const rx of patterns) {
    const m = clean.match(rx);
    if (m && m[1]) return m[1];
  }
  return null;
}

async function fetchYoutubeVideoCommentsDataOnly(
  videoId: string,
  maxPages: number = 2
): Promise<{ videoId: string; title: string; comments: YoutubeExtractedComment[] }> {
  const innertubeUrl = 'https://www.youtube.com/youtubei/v1/next?prettyPrint=false';
  const clientContext = {
    client: {
      clientName: 'WEB',
      clientVersion: '2.20240501.00.00',
      hl: 'es',
      gl: 'ES',
    },
  };

  try {
    const res1 = await fetch(innertubeUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'User-Agent':
          'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
      },
      body: JSON.stringify({ context: clientContext, videoId }),
    });
    if (!res1.ok) return { videoId, title: videoId, comments: [] };
    const j1: any = await res1.json();
    const s1 = JSON.stringify(j1);
    const titleMatch = s1.match(/"title":\{"runs":\[\{"text":"([^"]+)"\}\]/);
    const title = titleMatch ? titleMatch[1] : videoId;

    const findContinuationTokens = (obj: any): string[] => {
      const tokens: string[] = [];
      const walk = (node: any) => {
        if (!node || typeof node !== 'object') return;
        if (
          (node.itemSectionRenderer &&
            node.itemSectionRenderer.sectionIdentifier === 'comment-item-section') ||
          (node.engagementPanelSectionListRenderer &&
            node.engagementPanelSectionListRenderer.panelIdentifier ===
              'engagement-panel-comments-section')
        ) {
          const str = JSON.stringify(node);
          for (const m of str.matchAll(/"token":"([^"]+)"/g)) {
            if (m[1] && !tokens.includes(m[1])) tokens.push(m[1]);
          }
        }
        for (const k of Object.keys(node)) walk(node[k]);
      };
      walk(obj);
      return tokens;
    };

    const initialTokens = findContinuationTokens(j1);
    if (initialTokens.length === 0) {
      return { videoId, title, comments: [] };
    }

    const collected: YoutubeExtractedComment[] = [];
    const seenTexts = new Set<string>();
    let nextToken: string | undefined = initialTokens[0];

    for (let page = 0; page < maxPages && nextToken; page++) {
      const resPage = await fetch(innertubeUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'User-Agent':
            'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
        },
        body: JSON.stringify({ context: clientContext, continuation: nextToken }),
      });
      if (!resPage.ok) break;
      const jPage: any = await resPage.json();

      let nextContinuation: string | undefined;
      const extractFromPage = (node: any) => {
        if (!node || typeof node !== 'object') return;
        if (node.commentEntityPayload?.properties?.content?.content) {
          const text = String(node.commentEntityPayload.properties.content.content || '').trim();
          const author = String(node.commentEntityPayload.author?.displayName || '').trim();
          const likes = String(node.commentEntityPayload.toolbar?.likeCountNotliked || '0').trim();
          const key = `${author}::${text}`;
          if (text && !seenTexts.has(key)) {
            seenTexts.add(key);
            collected.push({ author, text, likes, videoTitle: title, videoId });
          }
        } else if (node.commentRenderer?.contentText?.runs) {
          const text = (node.commentRenderer.contentText.runs || [])
            .map((r: any) => r.text || '')
            .join('')
            .trim();
          const author = String(node.commentRenderer.authorText?.simpleText || '').trim();
          const likes = String(node.commentRenderer.voteCount?.simpleText || '0').trim();
          const key = `${author}::${text}`;
          if (text && !seenTexts.has(key)) {
            seenTexts.add(key);
            collected.push({ author, text, likes, videoTitle: title, videoId });
          }
        }
        if (
          node.continuationItemRenderer?.continuationEndpoint?.continuationCommand?.token &&
          !nextContinuation
        ) {
          nextContinuation =
            node.continuationItemRenderer.continuationEndpoint.continuationCommand.token;
        }
        for (const k of Object.keys(node)) extractFromPage(node[k]);
      };
      extractFromPage(jPage);
      nextToken = nextContinuation;
    }

    return { videoId, title, comments: collected };
  } catch {
    return { videoId, title: videoId, comments: [] };
  }
}

async function fetchHuellasChannelCommentsCached(forceRefresh: boolean = false): Promise<{
  videoCount: number;
  comments: YoutubeExtractedComment[];
  updatedAt: string;
}> {
  if (!forceRefresh && fs.existsSync(HUELLAS_CHANNEL_COMMENTS_CACHE_FILE)) {
    try {
      const cached = JSON.parse(fs.readFileSync(HUELLAS_CHANNEL_COMMENTS_CACHE_FILE, 'utf8'));
      const ageMs = Date.now() - new Date(cached.updatedAt || 0).getTime();
      if (ageMs < HUELLAS_CHANNEL_CACHE_TTL_MS && Array.isArray(cached.comments)) {
        return cached;
      }
    } catch {}
  }

  const videoIdsSet = new Set<string>();
  const tabs = ['videos', 'shorts'];
  for (const tab of tabs) {
    try {
      const res = await fetch(`${HUELLAS_OFFICIAL_CHANNEL_URL}/${tab}`, {
        headers: {
          'User-Agent':
            'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
          'Accept-Language': 'es-ES,es;q=0.9',
        },
      });
      if (res.ok) {
        const html = await res.text();
        const match = html.match(/var ytInitialData = (\{.*?\});<\/script>/s);
        const searchSource = match ? match[1] : html;
        for (const m of searchSource.matchAll(/"videoId":"([a-zA-Z0-9_-]{11})"/g)) {
          if (m[1]) videoIdsSet.add(m[1]);
        }
      }
    } catch {}
  }

  const allVideoIds = Array.from(videoIdsSet).slice(0, 35);
  const allAudienceComments: YoutubeExtractedComment[] = [];
  const batchSize = 5;

  for (let i = 0; i < allVideoIds.length; i += batchSize) {
    const batch = allVideoIds.slice(i, i + batchSize);
    const results = await Promise.all(
      batch.map((vid) => fetchYoutubeVideoCommentsDataOnly(vid, 1))
    );
    for (const r of results) {
      for (const c of r.comments) {
        // Exclude comments written by our own channel (@huellas_de_la_humanidad) so only viewer comments remain
        if (
          c.author &&
          c.author.toLowerCase().includes('huellas_de_la_humanidad')
        ) {
          continue;
        }
        allAudienceComments.push(c);
      }
    }
  }

  const payload = {
    videoCount: allVideoIds.length,
    comments: allAudienceComments,
    updatedAt: new Date().toISOString(),
  };

  try {
    fs.writeFileSync(
      HUELLAS_CHANNEL_COMMENTS_CACHE_FILE,
      JSON.stringify(payload, null, 2),
      'utf8'
    );
  } catch {}

  return payload;
}

interface DeduplicatedAudienceComment {
  id: string;
  text: string;
  author: string;
  likes: number;
  repeatCount: number;
  category: 'question' | 'suggestion' | 'comment';
  sourceType: 'channel' | 'analyzed_video';
  videoTitle: string;
  videoId: string;
}

interface AnalyzedVideoStructuralBlock {
  name: string;
  pct: number;
  description: string;
}

interface AnalyzedVideoLibraryEntry {
  id: string;
  videoId: string;
  url: string;
  title: string;
  channelName: string;
  analyzedAt: string;
  commentsCount: number;
  structureSummary: string;
  structuralBlocks: AnalyzedVideoStructuralBlock[];
  comments: DeduplicatedAudienceComment[];
}

const ANALYZED_VIDEOS_LIBRARY_FILE = path.join(DATA_DIR, 'analyzed_videos_library.json');

const DEFAULT_ANALYZED_VIDEOS_SEED: AnalyzedVideoLibraryEntry[] = [
  {
    id: 'seed_louvre_medieval',
    videoId: 'louvre_medieval_p1',
    url: 'https://www.youtube.com/@huellas_de_la_humanidad',
    title: 'Castillo del Louvre Medieval (Estructura de Fortaleza Oculta bajo Monumento Famoso)',
    channelName: '@huellas_de_la_humanidad',
    analyzedAt: new Date().toISOString(),
    commentsCount: 42,
    structureSummary: `1. DECONSTRUCCIÓN DEL HOOK (00:00 - 00:30):
   - Arranca con el Intro Oficial (8s) seguido del Clip 1 (8s) mostrando el monumento actual frente a su pasado subterráneo oscuro. En el segundo 16 entra la voz con Año y Lugar cerrados con punto ("Año 1190, París, Francia."), planteando la paradoja central: millones caminan sobre una fortaleza de guerra sin saberlo. Antes del segundo 30 cierra con el Slogan Oficial sobre la mesa del historiador.
2. RADIOGRAFÍA ESTRUCTURAL BLOQUE POR BLOQUE:
   - Bloque 1 (Hook + Promesa, 8%): Choque visual entre el palacio actual y la mazmorra medieval original.
   - Bloque 2 (El Miedo que dio Origen al Muro, 20%): Por qué Felipe II Augusto ordenó levantar una fortaleza inexpugnable antes de ir a las Cruzadas.
   - Bloque 3 (Ingeniería Secreta y Foso Sumergido, 24%): Dimensiones reales del torreón (Grosse Tour), muros de piedra caliza y trampas defensivas.
   - Bloque 4 (Vida Cotidiana, Prisioneros y Tesoro Real, 22%): El olor, la humedad, las bóvedas acorazadas y los prisioneros de Estado.
   - Bloque 5 (Demolición, Transformación y Redescubrimiento, 18%): Cómo quedó sepultado bajo el Renacimiento y cómo las excavaciones del siglo XX sacaron a la luz sus cimientos intactos.
   - Bloque 6 (Reflexión Final + Outro Oficial de 8s, 8%): Qué nos revela esa piedra oculta hoy + cierre limpio antes del Outro de 8s.
3. GATILLOS PSICOLÓGICOS DE VIRALIDAD:
   - "Lo oculto a plena vista": revelar que debajo de un lugar mundialmente conocido existe una estructura secreta que casi ningún turista comprende.`,
    structuralBlocks: [
      { name: 'Intro (8s) + Hook y Promesa', pct: 8, description: 'Contraste monumento actual vs. fortaleza subterránea oculta y Slogan.' },
      { name: 'Acto I: La Amenaza Original', pct: 20, description: 'El peligro militar que obligó a construir la fortaleza.' },
      { name: 'Acto II: Ingeniería y Secretos', pct: 24, description: 'Anatomía arquitectónica, fosos, muros y mecanismos ocultos.' },
      { name: 'Acto III: Vida y Sombras Dentro', pct: 22, description: 'Cárceles, tesoros, traiciones y vida real tras los muros.' },
      { name: 'Acto IV: Sepultura y Hallazgo', pct: 18, description: 'Cómo desapareció y cómo la arqueología lo redescubrió.' },
      { name: 'Clímax Reflexivo + Outro (8s)', pct: 8, description: 'Legado histórico, pregunta a la audiencia y Outro Oficial de 8s.' },
    ],
    comments: [
      {
        id: 'seed-c1',
        text: '¿Qué pasó con los túneles subterráneos que conectaban el torreón con el río Sena?',
        author: 'Suscriptor Huellas',
        likes: 34,
        repeatCount: 6,
        category: 'question',
        sourceType: 'channel',
        videoTitle: 'Castillo del Louvre Parte I',
        videoId: 'louvre_medieval_p1',
      },
      {
        id: 'seed-c2',
        text: 'Deberían hacer la continuación contando cómo Carlos V transformó la fortaleza militar en residencia real y biblioteca.',
        author: 'Suscriptor Huellas',
        likes: 29,
        repeatCount: 5,
        category: 'suggestion',
        sourceType: 'channel',
        videoTitle: 'Castillo del Louvre Parte I',
        videoId: 'louvre_medieval_p1',
      },
    ],
  },
  {
    id: 'seed_princesas_edad_media',
    videoId: 'princesas_edad_media',
    url: 'https://www.youtube.com/@huellas_de_la_humanidad',
    title: 'Las Princesas de la Edad Media (Estructura de Desmitificación de Vida Cotidiana e Intimidad Histórica)',
    channelName: '@huellas_de_la_humanidad',
    analyzedAt: new Date().toISOString(),
    commentsCount: 58,
    structureSummary: `1. DECONSTRUCCIÓN DEL HOOK (00:00 - 00:30):
   - Desmonta en los primeros 20 segundos el cuento de hadas moderno: frente al lujo imaginado, muestra el frío glacial de los castillos, los matrimonios políticos en la infancia y la falta total de privacidad.
2. RADIOGRAFÍA ESTRUCTURAL BLOQUE POR BLOQUE:
   - Bloque 1 (Intro 8s + Hook de Desmitificación, 9%): El contraste brutal entre el mito romántico y la realidad física medieval.
   - Bloque 2 (Infancia como Moneda de Alianza, 21%): Educación rígida, despedida de su familia a los 12 años y viaje a un reino extranjero.
   - Bloque 3 (Higiene, Vestimenta Pesada y Frío en el Castillo, 24%): Detalles sensoriales hiperrealistas (capas de lana, parásitos, chimeneas humeantes, comida y protocolo).
   - Bloque 4 (El Peligro de la Noche de Bodas y el Parto, 23%): La presión dinástica por dar un heredero varón y la altísima mortalidad materna.
   - Bloque 5 (Poder Oculto, Regencias y Conspiraciones, 15%): Cómo las mujeres que sobrevivían lograban gobernar imperios desde la sombra.
   - Bloque 6 (Cierre Reflexivo + Outro 8s, 8%): Reflexión humana final y entrada limpia del Outro Oficial de 8s.
3. GATILLOS PSICOLÓGICOS DE VIRALIDAD:
   - Empatía corporal + desmitificación sensorial: el espectador siente el frío, el peso de la ropa y el miedo real de una persona de carne y hueso en otra época.`,
    structuralBlocks: [
      { name: 'Intro (8s) + Choque Mito vs Realidad', pct: 9, description: 'Destruye el cliché de cuento de hadas en los primeros segundos.' },
      { name: 'Acto I: Peones de Alianza', pct: 21, description: 'Infancia, contratos matrimoniales y destierro diplomático.' },
      { name: 'Acto II: Intimidad y Supervivencia', pct: 24, description: 'Frío, higiene, banquetes, vestimenta y vida diaria real.' },
      { name: 'Acto III: El Precio de la Corona', pct: 23, description: 'Presión por el heredero, medicina medieval y peligros mortales.' },
      { name: 'Acto IV: El Poder tras el Trono', pct: 15, description: 'Intriga política, regencias y legado histórico.' },
      { name: 'Cierre Humano + Outro (8s)', pct: 8, description: 'Pregunta reflexiva a la comunidad y Outro Oficial de 8s.' },
    ],
    comments: [
      {
        id: 'seed-c3',
        text: '¿Cómo era realmente la higiene y los baños dentro de los palacios europeos antes del siglo XVIII?',
        author: 'Comunidad Huellas',
        likes: 51,
        repeatCount: 8,
        category: 'question',
        sourceType: 'channel',
        videoTitle: 'Las Princesas de la Edad Media',
        videoId: 'princesas_edad_media',
      },
      {
        id: 'seed-c4',
        text: 'Hagan un documental sobre cómo vivían los sirvientes y guardias invisibles dentro de los grandes castillos.',
        author: 'Comunidad Huellas',
        likes: 41,
        repeatCount: 4,
        category: 'suggestion',
        sourceType: 'channel',
        videoTitle: 'Las Princesas de la Edad Media',
        videoId: 'princesas_edad_media',
      },
    ],
  },
  {
    id: 'seed_misterio_investigativo',
    videoId: 'misterio_cronologico_viral',
    url: 'https://www.youtube.com/@huellas_de_la_humanidad',
    title: 'Misterio Histórico / True Crime Antiguo (Estructura de Investigación Forense en 5 Pistas)',
    channelName: 'Plantilla Viral Analizada',
    analyzedAt: new Date().toISOString(),
    commentsCount: 31,
    structureSummary: `1. DECONSTRUCCIÓN DEL HOOK (00:00 - 00:30):
   - Abre con la escena del hallazgo o el instante exacto de la desaparición/crimen histórico, presentando una prueba física que contradice la versión oficial de los libros.
2. RADIOGRAFÍA ESTRUCTURAL BLOQUE POR BLOQUE:
   - Bloque 1 (Intro 8s + Escena del Enigma, 8%): Fecha exacta, lugar y el hallazgo inexplicable que abre la investigación.
   - Bloque 2 (La Versión Oficial y su Grieta, 19%): Qué se creyó durante siglos y cuál es el documento o rastro que no encaja.
   - Bloque 3 (Reconstrucción Minuto a Minuto, 25%): Seguimiento cronológico de las últimas horas de los protagonistas como un thriller documental.
   - Bloque 4 (Los Sospechosos y el Motivo Oculto, 22%): Intereses políticos, religiosos o económicos detrás del encubrimiento.
   - Bloque 5 (La Evidencia Forense / Arqueológica Moderna, 18%): Qué reveló la ciencia moderna al analizar los restos o archivos secretos.
   - Bloque 6 (Veredicto Abierto + Outro 8s, 8%): Presentación de la conclusión más sólida + pregunta de debate + Outro Oficial de 8s.
3. GATILLOS PSICOLÓGICOS DE VIRALIDAD:
   - Efecto Zeigarnik (bucles abiertos): cada acto resuelve una pista pero abre una pregunta mayor hasta el veredicto del último bloque.`,
    structuralBlocks: [
      { name: 'Intro (8s) + El Hallazgo Inexplicable', pct: 8, description: 'Presenta el enigma central y la contradicción histórica.' },
      { name: 'Acto I: La Versión Oficial rota', pct: 19, description: 'Expone la historia oficial y la pista que la desmiente.' },
      { name: 'Acto II: Cronología del Suceso', pct: 25, description: 'Reconstrucción inmersiva hora por hora de los hechos.' },
      { name: 'Acto III: Conspiración y Motivos', pct: 22, description: 'Quién ganaba con el silencio y cómo se ocultó la verdad.' },
      { name: 'Acto IV: Ciencia vs. Mito', pct: 18, description: 'Descubrimientos arqueológicos o forenses recientes.' },
      { name: 'Veredicto + Outro (8s)', pct: 8, description: 'Cierre reflexivo con la huella histórica y Outro de 8s.' },
    ],
    comments: [],
  },
];

function deduplicateAndClusterComments(
  rawComments: YoutubeExtractedComment[],
  sourceType: 'channel' | 'analyzed_video',
  fallbackVideoTitle: string = ''
): DeduplicatedAudienceComment[] {
  const questionRx =
    /\?|¿|\b(por qu[eé]|c[oó]mo|cu[aá]ndo|d[oó]nde|qui[eé]n|qu[eé] pas[oó]|es verdad|ser[aá] cierto|alguien sabe|duda|pregunta)\b/i;
  const suggestionRx =
    /\b(deber[ií]as|deber[ií]an|podr[ií]as|podr[ií]an|haz un video|hagan un video|habla sobre|hablen sobre|falta hablar|falt[oó] mencionar|sugiero|recomiendo|ser[ií]a bueno|me gustar[ií]a ver|para cu[aá]ndo un video|siguiente video|parte 2|parte ii|segunda parte)\b/i;

  const stopWords = new Set([
    'para', 'como', 'este', 'esta', 'estos', 'estas', 'pero', 'porque', 'cuando', 'donde',
    'quien', 'sobre', 'entre', 'hasta', 'desde', 'todo', 'toda', 'todos', 'todas', 'muy',
    'mas', 'tambien', 'solo', 'hacer', 'hace', 'hizo', 'video', 'videos', 'canal', 'hola',
    'saludos', 'gracias', 'buen', 'bueno', 'buena', 'excelente', 'encanta', 'gustaria',
    'puedes', 'podrias', 'deberian', 'deberias', 'hablar', 'hacerlo', 'favor', 'amigo',
  ]);

  const extractSignificantTokens = (text: string): string[] => {
    const norm = text
      .toLowerCase()
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/[^a-z0-9\s]/g, ' ')
      .split(/\s+/)
      .filter((w) => w.length >= 4 && !stopWords.has(w));
    return Array.from(new Set(norm));
  };

  interface Cluster {
    item: DeduplicatedAudienceComment;
    tokens: Set<string>;
    normKey: string;
  }

  const clusters: Cluster[] = [];

  for (const c of rawComments) {
    const clean = String(c.text || '').replace(/\s+/g, ' ').trim();
    if (clean.length < 8) continue;

    const category: 'question' | 'suggestion' | 'comment' = questionRx.test(clean)
      ? 'question'
      : suggestionRx.test(clean)
      ? 'suggestion'
      : 'comment';

    const tokensArr = extractSignificantTokens(clean);
    const normKey = tokensArr.slice(0, 8).sort().join('_');
    const tokenSet = new Set(tokensArr);
    const numericLikes = parseInt(String(c.likes || '0').replace(/[^0-9]/g, ''), 10) || 0;

    let matchedCluster: Cluster | null = null;
    for (const cl of clusters) {
      if (cl.item.category !== category) continue;
      if (normKey && cl.normKey === normKey) {
        matchedCluster = cl;
        break;
      }
      if (tokenSet.size >= 2 && cl.tokens.size >= 2) {
        let overlap = 0;
        for (const t of tokenSet) {
          if (cl.tokens.has(t)) overlap++;
        }
        const minSize = Math.min(tokenSet.size, cl.tokens.size);
        const maxSize = Math.max(tokenSet.size, cl.tokens.size);
        if (overlap >= 2 && (overlap / minSize >= 0.65 || overlap / maxSize >= 0.5)) {
          matchedCluster = cl;
          break;
        }
      }
    }

    if (matchedCluster) {
      matchedCluster.item.repeatCount += 1;
      matchedCluster.item.likes += numericLikes;
      // Keep the clearer/more complete phrasing if the new one is slightly more detailed (up to 220 chars)
      if (clean.length > matchedCluster.item.text.length && clean.length <= 220) {
        matchedCluster.item.text = clean;
      }
      for (const t of tokenSet) matchedCluster.tokens.add(t);
    } else {
      clusters.push({
        normKey,
        tokens: tokenSet,
        item: {
          id: `${sourceType}-${clusters.length + 1}-${Date.now().toString(36)}`,
          text: clean,
          author: c.author || 'Espectador',
          likes: numericLikes,
          repeatCount: 1,
          category,
          sourceType,
          videoTitle: c.videoTitle || fallbackVideoTitle || 'Video analizado',
          videoId: c.videoId || '',
        },
      });
    }
  }

  return clusters
    .map((c) => c.item)
    .sort((a, b) => {
      if (b.repeatCount !== a.repeatCount) return b.repeatCount - a.repeatCount;
      if (a.category !== b.category) {
        const order = { question: 0, suggestion: 1, comment: 2 };
        return order[a.category] - order[b.category];
      }
      return b.likes - a.likes;
    });
}

function loadAnalyzedVideosLibrary(): AnalyzedVideoLibraryEntry[] {
  try {
    if (fs.existsSync(ANALYZED_VIDEOS_LIBRARY_FILE)) {
      const parsed = JSON.parse(fs.readFileSync(ANALYZED_VIDEOS_LIBRARY_FILE, 'utf8'));
      if (Array.isArray(parsed) && parsed.length > 0) {
        return parsed;
      }
    }
  } catch {}
  try {
    fs.writeFileSync(
      ANALYZED_VIDEOS_LIBRARY_FILE,
      JSON.stringify(DEFAULT_ANALYZED_VIDEOS_SEED, null, 2),
      'utf8'
    );
  } catch {}
  return [...DEFAULT_ANALYZED_VIDEOS_SEED];
}

function saveAnalyzedVideosLibrary(list: AnalyzedVideoLibraryEntry[]): void {
  try {
    fs.writeFileSync(ANALYZED_VIDEOS_LIBRARY_FILE, JSON.stringify(list, null, 2), 'utf8');
  } catch {}
}

function classifyQuestionsAndSuggestionsHeuristic(comments: YoutubeExtractedComment[]): {
  questions: string[];
  suggestions: string[];
  notableComments: string[];
} {
  const deduped = deduplicateAndClusterComments(comments, 'analyzed_video');
  const questions = deduped
    .filter((c) => c.category === 'question')
    .slice(0, 15)
    .map(
      (c) =>
        `${c.repeatCount > 1 ? `[Repetido ×${c.repeatCount}] ` : ''}[${c.author}]: "${c.text}"`
    );
  const suggestions = deduped
    .filter((c) => c.category === 'suggestion')
    .slice(0, 15)
    .map(
      (c) =>
        `${c.repeatCount > 1 ? `[Repetido ×${c.repeatCount}] ` : ''}[${c.author}]: "${c.text}"`
    );
  const notableComments = deduped
    .filter((c) => c.category === 'comment')
    .slice(0, 12)
    .map(
      (c) =>
        `${c.repeatCount > 1 ? `[Repetido ×${c.repeatCount}] ` : ''}[${c.author}]: "${c.text}"`
    );

  return { questions, suggestions, notableComments };
}

app.get('/api/youtube/analyzed-videos', async (_req, res) => {
  try {
    const library = loadAnalyzedVideosLibrary();
    const channelData = await fetchHuellasChannelCommentsCached(false);
    const deduplicatedChannelComments = deduplicateAndClusterComments(
      channelData.comments,
      'channel',
      '@huellas_de_la_humanidad'
    );
    // Merge seed channel comments if live channel scrape returned 0 comments (e.g. offline)
    const effectiveChannelComments =
      deduplicatedChannelComments.length > 0
        ? deduplicatedChannelComments
        : library
            .flatMap((v) => v.comments || [])
            .filter((c) => c.sourceType === 'channel');

    const analyzedVideosComments = library.flatMap((v) =>
      (v.comments || []).map((c) => ({
        ...c,
        videoTitle: c.videoTitle || v.title,
        videoId: c.videoId || v.videoId,
      }))
    );

    res.json({
      ok: true,
      videos: library,
      channelComments: effectiveChannelComments,
      analyzedVideosComments,
      channelVideosScanned: channelData.videoCount,
      channelUpdatedAt: channelData.updatedAt,
    });
  } catch (err: any) {
    res.status(500).json({ error: err?.message || 'Error cargando biblioteca de videos analizados.' });
  }
});

app.post('/api/youtube/analyzed-videos', (req, res) => {
  try {
    const body = req.body || {};
    const library = loadAnalyzedVideosLibrary();
    const rawUrl = String(body.url || '').trim();
    const extractedId = extractYoutubeVideoId(rawUrl) || String(body.videoId || body.id || `vid_${Date.now()}`);
    const existingIdx = library.findIndex(
      (v) => v.id === body.id || v.videoId === extractedId || (rawUrl && v.url === rawUrl)
    );

    const entry: AnalyzedVideoLibraryEntry = {
      id: existingIdx >= 0 ? library[existingIdx].id : String(body.id || `vid_${extractedId}`),
      videoId: extractedId,
      url: rawUrl || (existingIdx >= 0 ? library[existingIdx].url : ''),
      title: String(body.title || (existingIdx >= 0 ? library[existingIdx].title : `Video Analizado (${extractedId})`)).trim(),
      channelName: String(body.channelName || (existingIdx >= 0 ? library[existingIdx].channelName : 'YouTube')).trim(),
      analyzedAt: new Date().toISOString(),
      commentsCount: Number(body.commentsCount ?? (existingIdx >= 0 ? library[existingIdx].commentsCount : 0)),
      structureSummary: String(
        body.structureSummary ||
          (existingIdx >= 0 ? library[existingIdx].structureSummary : '')
      ).trim(),
      structuralBlocks:
        Array.isArray(body.structuralBlocks) && body.structuralBlocks.length > 0
          ? body.structuralBlocks
          : existingIdx >= 0
          ? library[existingIdx].structuralBlocks
          : [
              { name: 'Intro (8s) + Hook Sensorial', pct: 8, description: 'Apertura de alto impacto y promesa narrativa antes del segundo 30.' },
              { name: 'Acto I: Contexto y Paradoja', pct: 20, description: 'Planteamiento del escenario histórico y la contradicción central.' },
              { name: 'Acto II: Escalada y Revelaciones', pct: 25, description: 'Desarrollo cronológico con micro-ganchos de retención.' },
              { name: 'Acto III: Giro Dramático', pct: 22, description: 'Punto de inflexión histórico y consecuencias humanas.' },
              { name: 'Acto IV: Desenlace y Huella', pct: 17, description: 'Resolución del misterio y conexión con el presente.' },
              { name: 'Cierre Reflexivo + Outro (8s)', pct: 8, description: 'Slogan final, pregunta a la audiencia y Outro Oficial de 8s.' },
            ],
      comments:
        Array.isArray(body.comments) && body.comments.length > 0
          ? body.comments
          : existingIdx >= 0
          ? library[existingIdx].comments
          : [],
    };

    if (existingIdx >= 0) {
      library[existingIdx] = entry;
    } else {
      library.unshift(entry);
    }
    saveAnalyzedVideosLibrary(library);
    res.json({ ok: true, entry, videos: library });
  } catch (err: any) {
    res.status(500).json({ error: err?.message || 'Error guardando video analizado.' });
  }
});

app.post('/api/youtube/analyze-comments-research', async (req, res) => {
  try {
    const { videoUrl = '', forceRefreshChannel = false, allowPaidApi = false } = req.body || {};
    const targetVideoId = extractYoutubeVideoId(videoUrl);

    const [targetData, channelData] = await Promise.all([
      targetVideoId
        ? fetchYoutubeVideoCommentsDataOnly(targetVideoId, 3)
        : Promise.resolve({ videoId: '', title: '', comments: [] as YoutubeExtractedComment[] }),
      fetchHuellasChannelCommentsCached(Boolean(forceRefreshChannel)),
    ]);

    // Filter out channel owner comments on target video if target video happens to be on our own channel
    const targetViewerComments = targetData.comments.filter(
      (c) => !c.author.toLowerCase().includes('huellas_de_la_humanidad')
    );

    const deduplicatedTargetComments = deduplicateAndClusterComments(
      targetViewerComments,
      'analyzed_video',
      targetData.title || videoUrl
    );
    const deduplicatedChannelComments = deduplicateAndClusterComments(
      channelData.comments,
      'channel',
      '@huellas_de_la_humanidad'
    );

    const targetClassified = classifyQuestionsAndSuggestionsHeuristic(targetViewerComments);
    const channelClassified = classifyQuestionsAndSuggestionsHeuristic(channelData.comments);

    let aiSynthesizedQuestions: string[] = [];
    let aiSynthesizedSuggestions: string[] = [];
    let aiResearchDirectives: string[] = [];

    // NEVER use paid Gemini API unless explicitly authorized by user (allowPaidApi === true)
    const ai = allowPaidApi ? getGeminiClient() : null;
    if (ai && (targetViewerComments.length > 0 || channelData.comments.length > 0)) {
      try {
        const sampleTarget = targetViewerComments
          .slice(0, 45)
          .map((c) => `- (${c.author}): ${c.text.replace(/\s+/g, ' ').slice(0, 280)}`)
          .join('\n');
        const sampleChannel = channelData.comments
          .slice(0, 55)
          .map(
            (c) =>
              `- [${(c.videoTitle || '').slice(0, 55)}] (${c.author}): ${c.text
                .replace(/\s+/g, ' ')
                .slice(0, 260)}`
          )
          .join('\n');

        const promptText = `Actúa como Investigador Jefe y Estratega de Contenido de "Huellas de la Humanidad" (${HUELLAS_OFFICIAL_CHANNEL_URL}).
Hemos extraído los comentarios reales de dos fuentes:
1) VIDEO DE YOUTUBE A ANALIZAR (${videoUrl || 'No especificado'} — Título: "${targetData.title || ''}"):
${sampleTarget || '(Sin comentarios públicos detectados en este video)'}

2) COMENTARIOS DE TODOS LOS VIDEOS DE MI CANAL OFICIAL (${HUELLAS_OFFICIAL_CHANNEL_HANDLE} — ${channelData.videoCount} videos escaneados):
${sampleChannel || '(Sin comentarios adicionales)'}

TU TAREA:
Analiza todos estos comentarios buscando específicamente:
- Preguntas, dudas históricas, vacíos de información o inquietudes que las personas dejaron en los comentarios.
- Sugerencias de temas, enfoques, personajes, épocas o ángulos que las personas piden o debaten.
- Qué puntos específicos DEBE incluir el PROMPT PARA REALIZAR LA INVESTIGACIÓN PROFUNDA para que la investigación responda con rigor histórico a esas preguntas y aproveche esas sugerencias de la audiencia.

Devuelve EXCLUSIVAMENTE un JSON válido con esta estructura:
{
  "questionsDetected": [
    "Pregunta o duda real detectada en los comentarios"
  ],
  "suggestionsDetected": [
    "Sugerencia, petición o debate real detectado en los comentarios"
  ],
  "researchPromptDirectives": [
    "Directriz concreta de investigación para incluir dentro del Prompt de Investigación Profunda"
  ]
}`;

        const models = ['gemini-2.5-flash', 'gemini-3-flash-preview', 'gemini-3.1-pro-preview'];
        for (const m of models) {
          try {
            const resp = await ai.models.generateContent({
              model: m,
              contents: [{ role: 'user', parts: [{ text: promptText }] }],
              config: { responseMimeType: 'application/json' },
            });
            if (resp.text) {
              const parsed = JSON.parse(resp.text.trim());
              if (Array.isArray(parsed.questionsDetected)) {
                aiSynthesizedQuestions = parsed.questionsDetected.map(String).filter(Boolean);
              }
              if (Array.isArray(parsed.suggestionsDetected)) {
                aiSynthesizedSuggestions = parsed.suggestionsDetected.map(String).filter(Boolean);
              }
              if (Array.isArray(parsed.researchPromptDirectives)) {
                aiResearchDirectives = parsed.researchPromptDirectives.map(String).filter(Boolean);
              }
              break;
            }
          } catch {}
        }
      } catch {}
    }

    const finalQuestions =
      aiSynthesizedQuestions.length > 0
        ? aiSynthesizedQuestions
        : [
            ...targetClassified.questions.map((q) => `(Video analizado) ${q}`),
            ...channelClassified.questions.map((q) => `(@huellas_de_la_humanidad) ${q}`),
          ].slice(0, 15);

    const finalSuggestions =
      aiSynthesizedSuggestions.length > 0
        ? aiSynthesizedSuggestions
        : [
            ...targetClassified.suggestions.map((s) => `(Video analizado) ${s}`),
            ...channelClassified.suggestions.map((s) => `(@huellas_de_la_humanidad) ${s}`),
            ...targetClassified.notableComments.slice(0, 4).map((n) => `(Reacción en video analizado) ${n}`),
            ...channelClassified.notableComments
              .slice(0, 4)
              .map((n) => `(Reacción en @huellas_de_la_humanidad) ${n}`),
          ].slice(0, 15);

    // Save or update target video in the persistent Analyzed Videos Library if a valid YouTube link was provided
    const library = loadAnalyzedVideosLibrary();
    let matchedLibraryEntry: AnalyzedVideoLibraryEntry | null = null;
    if (targetVideoId) {
      const existingIdx = library.findIndex((v) => v.videoId === targetVideoId || v.url === videoUrl);
      const defaultSummary = `Análisis de "${targetData.title || videoUrl}":\n- Comentarios públicos extraídos y agrupados: ${targetViewerComments.length} (${deduplicatedTargetComments.length} únicos agrupados por repetición).\n- Al ejecutar "✨ Comenzar Investigación", Gemini Web (en modo High + Deep Research) realizará la radiografía completa de los 8 ejes virales de este video junto con la investigación del documental en curso y actualizará esta ficha automáticamente.`;
      const entry: AnalyzedVideoLibraryEntry = {
        id: existingIdx >= 0 ? library[existingIdx].id : `vid_${targetVideoId}`,
        videoId: targetVideoId,
        url: videoUrl,
        title:
          targetData.title && targetData.title !== targetVideoId
            ? targetData.title
            : existingIdx >= 0
            ? library[existingIdx].title
            : `Video de YouTube (${targetVideoId})`,
        channelName: existingIdx >= 0 ? library[existingIdx].channelName : 'YouTube Referencia Viral',
        analyzedAt: new Date().toISOString(),
        commentsCount: targetViewerComments.length,
        structureSummary:
          existingIdx >= 0 && library[existingIdx].structureSummary
            ? library[existingIdx].structureSummary
            : defaultSummary,
        structuralBlocks:
          existingIdx >= 0 && library[existingIdx].structuralBlocks?.length > 0
            ? library[existingIdx].structuralBlocks
            : [
                { name: 'Intro (8s) + Hook Viral', pct: 8, description: 'Apertura magnética en los primerossegundos y promesa narrativa.' },
                { name: 'Acto I: Planteamiento Histórico', pct: 20, description: 'Contexto de época, lugar y contradicción inicial.' },
                { name: 'Acto II: Desarrollo y Tensión', pct: 25, description: 'Progresión narrativa con micro-ganchos de retención.' },
                { name: 'Acto III: Revelación Central', pct: 22, description: 'Giro dramático y hallazgos documentales.' },
                { name: 'Acto IV: Impacto y Legado', pct: 17, description: 'Resolución histórica de las preguntas planteadas.' },
                { name: 'Cierre + Outro Oficial (8s)', pct: 8, description: 'Reflexión final, Slogan y Outro Oficial de 8s.' },
              ],
        comments: deduplicatedTargetComments,
      };
      if (existingIdx >= 0) {
        library[existingIdx] = entry;
      } else {
        library.unshift(entry);
      }
      saveAnalyzedVideosLibrary(library);
      matchedLibraryEntry = entry;
    }

    const lines: string[] = [
      `================================================================================`,
      `💬 MINERÍA REAL DE COMENTARIOS DE LA AUDIENCIA (VIDEO ANALIZADO + CANAL ${HUELLAS_OFFICIAL_CHANNEL_HANDLE})`,
      `================================================================================`,
      `- Video de referencia analizado: ${targetData.title || videoUrl || 'Canal General'} (${targetViewerComments.length} comentarios leídos, agrupados por frecuencia)`,
      `- Canal propio escaneado (${HUELLAS_OFFICIAL_CHANNEL_URL}): ${channelData.videoCount} videos revisados (${channelData.comments.length} comentarios de suscriptores leídos)`,
      ``,
      `❓ PREGUNTAS, DUDAS E INQUIETUDES DE LAS PERSONAS EN LOS COMENTARIOS (CON FRECUENCIA DE REPETICIÓN):`,
      ...(finalQuestions.length > 0
        ? finalQuestions.map((q, i) => `   ${i + 1}. ${q}`)
        : [
            `   - No se detectaron preguntas literales con signo de interrogación; analiza las reacciones de la audiencia para anticipar sus dudas históricas sobre "${targetData.title || 'este tema'}".`,
          ]),
      ``,
      `💡 SUGERENCIAS, PETICIONES Y DEBATES DE LA AUDIENCIA EN LOS COMENTARIOS (CON FRECUENCIA DE REPETICIÓN):`,
      ...(finalSuggestions.length > 0
        ? finalSuggestions.map((s, i) => `   ${i + 1}. ${s}`)
        : [
            `   - Profundizar en los detalles humanos, cotidianos y psicológicos que más despiertan conversación en la comunidad de ${HUELLAS_OFFICIAL_CHANNEL_HANDLE}.`,
          ]),
      ...(aiResearchDirectives.length > 0
        ? [
            ``,
            `🎯 ÁNGULOS OBLIGATORIOS A INCLUIR EN EL PROMPT PARA REALIZAR LA INVESTIGACIÓN:`,
            ...aiResearchDirectives.map((d, i) => `   ${i + 1}. ${d}`),
          ]
        : []),
      ``,
      `-> REGLA INQUEBRANTABLE SOBRE ESTOS COMENTARIOS (SOLO EN EL PROMPT DE INVESTIGACIÓN):`,
      `   NO insertes estas preguntas ni sugerencias directamente como texto suelto en el resultado final, SINO INCLÚYELAS OBLIGATORIAMENTE DENTRO DEL PROMPT PARA REALIZAR LA INVESTIGACIÓN PROFUNDA para que al ejecutar dicho prompt de investigación se investiguen y respondan a fondo todas las dudas, preguntas y sugerencias reales de la audiencia.`,
      `================================================================================`,
    ];

    const researchPromptBlock = lines.join('\n');

    res.json({
      ok: true,
      targetVideoId,
      targetVideoTitle: targetData.title || videoUrl,
      targetCommentsCount: targetViewerComments.length,
      channelVideosScanned: channelData.videoCount,
      channelCommentsCount: channelData.comments.length,
      channelUpdatedAt: channelData.updatedAt,
      questionsDetected: finalQuestions,
      suggestionsDetected: finalSuggestions,
      researchDirectives: aiResearchDirectives,
      researchPromptBlock,
      deduplicatedTargetComments,
      deduplicatedChannelComments,
      analyzedVideosLibrary: library,
      matchedLibraryEntry,
    });
  } catch (err: any) {
    console.error('Error en /api/youtube/analyze-comments-research:', err);
    res.status(500).json({
      error: err?.message || 'Error al analizar comentarios de YouTube.',
    });
  }
});

// ============================================================================
// CAPCUT-STYLE SMOOTH SLOW MOTION (OPTICAL FLOW / MINTERPOLATE) & CLIP TRIMMER
// ============================================================================
app.post('/api/video/optical-flow', async (req, res) => {
  try {
    const {
      folderPath = '',
      folderName = '',
      docTitle = '',
      clipId = '',
      clipNumber = 0,
      fileName = '',
      videoUrl = '',
      aspectRatio = '16:9',
      trimStart = 0,
      trimEnd = 0,
      speed = 1,
      targetDuration = 0,
      smoothSlowMo = true,
    } = req.body || {};

    let sourceMp4 = '';

    // 1. Try extracting filePath directly from videoUrl query parameter (unless it points to a previous optical_flow_cache or foley/vocals/music cache file)
    if (videoUrl && typeof videoUrl === 'string') {
      try {
        const parsed = new URL(videoUrl, 'http://localhost:4200');
        const fp = parsed.searchParams.get('filePath');
        if (
          fp &&
          !fp.includes('.optical_flow_cache') &&
          !fp.includes('.foley_only_cache') &&
          !fp.includes('.vocals_cache') &&
          !fp.includes('.music_cache') &&
          !/_foley_(?:only|v2)\.mp4$/i.test(fp) &&
          fs.existsSync(fp)
        ) {
          sourceMp4 = fp;
        }
      } catch {}
    }

    const resolvedRoot = resolveLocalDocumentaryFolder(folderPath, folderName, docTitle);
    const clipsVideoSubdir = resolvedRoot ? path.join(resolvedRoot, '05_Clips_Video') : '';
    const clipsApprovedSubdir = resolvedRoot ? path.join(resolvedRoot, 'Clips_Aprobados') : '';

    // 2. Fallback: locate pristine source MP4 in 05_Clips_Video, resolvedRoot, or Clips_Aprobados
    if (!sourceMp4 && resolvedRoot && fs.existsSync(resolvedRoot)) {
      const searchDirs = [clipsVideoSubdir, resolvedRoot, clipsApprovedSubdir].filter(
        (d) => d && fs.existsSync(d)
      );
      if (fileName) {
        const cleanFileName = path
          .basename(fileName)
          .replace(/_foley_(?:only|v2)(?=\.[^.]+$)/i, '');
        for (const d of searchDirs) {
          const cand = path.join(d, cleanFileName);
          if (fs.existsSync(cand) && fs.statSync(cand).isFile()) {
            sourceMp4 = cand;
            break;
          }
        }
      }
      if (!sourceMp4 && Number(clipNumber) > 0) {
        const num = Number(clipNumber);
        const prefixRegex = new RegExp(`^(?:clip[_\\-\\s.]*)?0*${num}[_\\-\\s.]`, 'i');
        for (const d of searchDirs) {
          const matches = fs
            .readdirSync(d)
            .filter(
              (f) =>
                !f.startsWith('.') &&
                prefixRegex.test(f) &&
                /\.(mp4|mov|webm)$/i.test(f)
            )
            .sort((a, b) => {
              const a4k = /[_\-]4k\.(mp4|mov|webm)$/i.test(a) ? 1 : 0;
              const b4k = /[_\-]4k\.(mp4|mov|webm)$/i.test(b) ? 1 : 0;
              if (b4k !== a4k) return b4k - a4k;
              try {
                return (
                  fs.statSync(path.join(d, b)).mtimeMs -
                  fs.statSync(path.join(d, a)).mtimeMs
                );
              } catch {
                return 0;
              }
            });
          if (matches.length > 0) {
            sourceMp4 = path.join(d, matches[0]);
            break;
          }
        }
      }
    }

    if (!sourceMp4 || !fs.existsSync(sourceMp4)) {
      res.status(404).json({
        ok: false,
        error: `No se encontró el archivo MP4 original para el Clip ${String(clipNumber || '').padStart(2, '0')}.`,
      });
      return;
    }

    const ffmpegBin = resolveFfmpegBin();

    // Probe actual video stream duration of sourceMp4 so trimmed slow-mo never assumes 10s when the MP4 is ~7.92s
    const probeMediaDurationSec = (filePath: string): Promise<number> =>
      new Promise((resolve) => {
        exec(
          `ffprobe -v error -select_streams v:0 -show_entries stream=duration -of default=noprint_wrappers=1:nokey=1 "${filePath.replace(/"/g, '\\"')}"`,
          { timeout: 4000 },
          (err, stdout) => {
            const parsed = parseFloat(String(stdout || '').trim());
            if (!err && Number.isFinite(parsed) && parsed > 0.3) {
              resolve(parsed);
              return;
            }
            const proc = spawn(ffmpegBin, ['-i', filePath]);
            let stderr = '';
            proc.stderr.on('data', (d) => {
              stderr += d.toString();
            });
            proc.on('close', () => {
              const m = stderr.match(/Duration:\s*(\d+):(\d+):(\d+(?:\.\d+)?)/);
              if (m) {
                const sec =
                  parseInt(m[1], 10) * 3600 +
                  parseInt(m[2], 10) * 60 +
                  parseFloat(m[3]);
                if (Number.isFinite(sec) && sec > 0.3) {
                  // Container duration includes audio tail (~0.06s longer than 24fps video stream)
                  resolve(Math.max(0.3, sec - 0.06));
                  return;
                }
              }
              resolve(0);
            });
            proc.on('error', () => resolve(0));
          }
        );
      });

    const probedSourceDur = await probeMediaDurationSec(sourceMp4);
    const actualSourceDur =
      probedSourceDur > 0.4
        ? probedSourceDur
        : Number(trimEnd) > 0.5
        ? Number(trimEnd)
        : 8;

    const reqSpeed = Math.max(0.15, Math.min(4.0, Number(speed) || 1));
    const reqTrimStart = Math.max(0, Number(trimStart) || 0);
    const reqTrimEnd = Number(trimEnd) > reqTrimStart + 0.05 ? Number(trimEnd) : actualSourceDur;

    const realTrimStart = Math.max(0, Math.min(actualSourceDur - 0.35, reqTrimStart));
    const realTrimEnd =
      reqTrimEnd > realTrimStart + 0.1 && reqTrimEnd < actualSourceDur - 0.06
        ? reqTrimEnd
        : Math.max(realTrimStart + 0.35, actualSourceDur - 0.06);
    const realSpan = Math.max(0.3, realTrimEnd - realTrimStart);

    const effectiveTargetDur =
      Number(targetDuration) > 0.4
        ? Number(targetDuration)
        : Number((Math.max(0.3, reqTrimEnd - reqTrimStart) / reqSpeed).toFixed(3));

    const safeSpeed = Math.max(
      0.15,
      Math.min(4.0, Number((realSpan / effectiveTargetDur).toFixed(4)))
    );
    const safeTrimStart = realTrimStart;
    const safeTrimEnd = realTrimEnd;
    const useOpticalFlow = Boolean(smoothSlowMo) && (safeSpeed < 0.99 || reqSpeed < 0.99);

    const cacheDir = path.join(path.dirname(sourceMp4), '.optical_flow_cache');
    if (!fs.existsSync(cacheDir)) {
      fs.mkdirSync(cacheDir, { recursive: true });
    }

    const baseKey = path
      .basename(sourceMp4, path.extname(sourceMp4))
      .replace(/[^a-zA-Z0-9_-]/g, '_')
      .slice(0, 48);
    const bakedKey = `t${safeTrimStart.toFixed(2)}_${safeTrimEnd.toFixed(2)}_d${effectiveTargetDur.toFixed(2)}_of${useOpticalFlow ? 2 : 0}`;
    const outFileName = `${baseKey}_${bakedKey}.mp4`;
    const outFullPath = path.join(cacheDir, outFileName);

    // Return cached optical-flow MP4 immediately if already generated for these exact parameters
    if (fs.existsSync(outFullPath) && fs.statSync(outFullPath).size > 15000) {
      const st = fs.statSync(outFullPath);
      res.json({
        ok: true,
        cached: true,
        clipId,
        clipNumber,
        bakedKey,
        speed: safeSpeed,
        trimStart: safeTrimStart,
        trimEnd: safeTrimEnd,
        actualSourceDuration: Number(actualSourceDur.toFixed(3)),
        targetDuration: effectiveTargetDur,
        smoothSlowMo: useOpticalFlow,
        opticalFlowUrl: `/api/flow/serve-folder-file?filePath=${encodeURIComponent(outFullPath)}&v=${Math.floor(st.mtimeMs)}`,
      });
      return;
    }

    // Stretch slightly past effectiveTargetDur (+0.12s) and trim at exact effectiveTargetDur so video frames never end before audio
    const ptsFactor = ((effectiveTargetDur + 0.12) / realSpan).toFixed(5);
    const isVertical = aspectRatio === '9:16';
    const outW = isVertical ? 1080 : 1920;
    const outH = isVertical ? 1920 : 1080;
    const motionEstW = isVertical ? 480 : 854;
    const motionEstH = isVertical ? 854 : 480;

    const inputTrimArgs: string[] = [];
    if (safeTrimStart > 0.01) {
      inputTrimArgs.push('-ss', safeTrimStart.toFixed(3));
    }
    if (safeTrimEnd > safeTrimStart + 0.05) {
      inputTrimArgs.push('-to', safeTrimEnd.toFixed(3));
    }

    const buildAtempoChain = (spd: number): string => {
      const stages: string[] = [];
      let rem = Math.max(0.15, Math.min(4.0, spd));
      if (Math.abs(rem - 1) >= 0.02) {
        while (rem < 0.5) {
          stages.push('atempo=0.5');
          rem /= 0.5;
        }
        while (rem > 2.0) {
          stages.push('atempo=2.0');
          rem /= 2.0;
        }
        stages.push(`atempo=${rem.toFixed(3)}`);
      } else {
        stages.push('volume=1.0');
      }
      stages.push(`apad=whole_dur=${effectiveTargetDur.toFixed(3)}`);
      return stages.join(',');
    };
    const afFilter = buildAtempoChain(safeSpeed);

    // Optical Flow MCI filter chain (CapCut Smooth Slow Motion equivalent) — uses PTS-STARTPTS + trim=duration so trimmed clips stretch across 100% of targetDuration
    const vfMci = useOpticalFlow
      ? `scale=${motionEstW}:${motionEstH}:force_original_aspect_ratio=decrease,pad=${motionEstW}:${motionEstH}:(ow-iw)/2:(oh-ih)/2,setpts=${ptsFactor}*(PTS-STARTPTS),minterpolate=fps=30:mi_mode=mci:mc_mode=obmc:me_mode=bilat:me=ds:mb_size=16:search_param=8:scd=none,trim=duration=${effectiveTargetDur.toFixed(3)},scale=${outW}:${outH}:flags=bicubic,unsharp=3:3:0.55:3:3:0.0,format=yuv420p`
      : `setpts=${ptsFactor}*(PTS-STARTPTS),trim=duration=${effectiveTargetDur.toFixed(3)},scale=${outW}:${outH}:force_original_aspect_ratio=decrease,pad=${outW}:${outH}:(ow-iw)/2:(oh-ih)/2:black,fps=30,format=yuv420p`;

    const vfBlendFallback = useOpticalFlow
      ? `setpts=${ptsFactor}*(PTS-STARTPTS),minterpolate=fps=60:mi_mode=blend,trim=duration=${effectiveTargetDur.toFixed(3)},scale=${outW}:${outH}:force_original_aspect_ratio=decrease,pad=${outW}:${outH}:(ow-iw)/2:(oh-ih)/2:black,format=yuv420p`
      : vfMci;

    const tmpOutPath = path.join(
      cacheDir,
      `.tmp_${Date.now()}_${Math.random().toString(36).slice(2, 6)}.mp4`
    );

    const runEncode = (vf: string, withAudio: boolean) =>
      new Promise<void>((resolve, reject) => {
        const args = [
          '-y',
          ...inputTrimArgs,
          '-i',
          sourceMp4,
          ...(withAudio
            ? ['-af', afFilter]
            : ['-f', 'lavfi', '-i', 'anullsrc=channel_layout=stereo:sample_rate=44100', '-shortest']),
          '-t',
          effectiveTargetDur.toFixed(3),
          '-vf',
          vf,
          '-c:v',
          'h264_videotoolbox',
          '-b:v',
          '16M',
          '-pix_fmt',
          'yuv420p',
          '-movflags',
          '+faststart',
          '-c:a',
          'aac',
          '-ar',
          '44100',
          '-ac',
          '2',
          tmpOutPath,
        ];
        const proc = spawn(ffmpegBin, args, { stdio: 'ignore' });
        proc.on('error', reject);
        proc.on('close', (code) => {
          if (code === 0 && fs.existsSync(tmpOutPath) && fs.statSync(tmpOutPath).size > 10000) {
            resolve();
          } else {
            reject(new Error(`ffmpeg exited with code ${code}`));
          }
        });
      });

    try {
      try {
        await runEncode(vfMci, true);
      } catch {
        try {
          await runEncode(vfMci, false);
        } catch {
          try {
            await runEncode(vfBlendFallback, true);
          } catch {
            await runEncode(vfBlendFallback, false);
          }
        }
      }

      fs.renameSync(tmpOutPath, outFullPath);
    } finally {
      try {
        if (fs.existsSync(tmpOutPath)) fs.unlinkSync(tmpOutPath);
      } catch {}
    }

    const st = fs.statSync(outFullPath);
    res.json({
      ok: true,
      cached: false,
      clipId,
      clipNumber,
      bakedKey,
      speed: safeSpeed,
      trimStart: safeTrimStart,
      trimEnd: safeTrimEnd,
      actualSourceDuration: Number(actualSourceDur.toFixed(3)),
      targetDuration: effectiveTargetDur,
      smoothSlowMo: useOpticalFlow,
      opticalFlowUrl: `/api/flow/serve-folder-file?filePath=${encodeURIComponent(outFullPath)}&v=${Math.floor(st.mtimeMs)}`,
    });
  } catch (err: any) {
    console.error('Error en /api/video/optical-flow:', err);
    res.status(500).json({
      ok: false,
      error: err?.message || 'Error procesando Smooth Slow Motion (Optical Flow).',
    });
  }
});

// Separate vocal stem (speech) from a video clip into a standalone MP3 and a vocal-attenuated MP4
app.post('/api/flow/separate-clip-vocals', async (req, res) => {
  try {
    const {
      clipId,
      clipNumber,
      videoUrl,
      fileName,
      folderPath,
      folderName,
      docTitle,
      trimStart,
      trimEnd,
      speed,
    } = req.body || {};

    let sourceMp4 = '';
    if (typeof videoUrl === 'string' && videoUrl.includes('filePath=')) {
      try {
        const parsed = new URL(videoUrl, 'http://localhost:4200');
        const fp = parsed.searchParams.get('filePath');
        if (fp && fs.existsSync(fp)) {
          sourceMp4 = fp;
        }
      } catch {}
    }

    const resolvedRoot = resolveLocalDocumentaryFolder(folderPath, folderName, docTitle);
    const clipsVideoSubdir = resolvedRoot ? path.join(resolvedRoot, '05_Clips_Video') : '';
    const clipsApprovedSubdir = resolvedRoot ? path.join(resolvedRoot, 'Clips_Aprobados') : '';

    if (!sourceMp4 && resolvedRoot && fs.existsSync(resolvedRoot)) {
      const searchDirs = [clipsVideoSubdir, resolvedRoot, clipsApprovedSubdir].filter(
        (d) => d && fs.existsSync(d)
      );
      if (fileName) {
        for (const d of searchDirs) {
          const cand = path.join(d, path.basename(fileName));
          if (fs.existsSync(cand) && fs.statSync(cand).isFile()) {
            sourceMp4 = cand;
            break;
          }
        }
      }
      if (!sourceMp4 && Number(clipNumber) > 0) {
        const num = Number(clipNumber);
        const prefixRegex = new RegExp(`^(?:clip[_\\-\\s.]*)?0*${num}[_\\-\\s.]`, 'i');
        for (const d of searchDirs) {
          const matches = fs
            .readdirSync(d)
            .filter(
              (f) =>
                !f.startsWith('.') &&
                prefixRegex.test(f) &&
                /\.(mp4|mov|webm)$/i.test(f)
            )
            .sort((a, b) => {
              const a4k = /[_\-]4k\.(mp4|mov|webm)$/i.test(a) ? 1 : 0;
              const b4k = /[_\-]4k\.(mp4|mov|webm)$/i.test(b) ? 1 : 0;
              if (b4k !== a4k) return b4k - a4k;
              try {
                return (
                  fs.statSync(path.join(d, b)).mtimeMs -
                  fs.statSync(path.join(d, a)).mtimeMs
                );
              } catch {
                return 0;
              }
            });
          if (matches.length > 0) {
            sourceMp4 = path.join(d, matches[0]);
            break;
          }
        }
      }
    }

    if (!sourceMp4 || !fs.existsSync(sourceMp4)) {
      res.status(404).json({
        ok: false,
        error: `No se encontró el archivo MP4 original para separar voces del Clip ${String(clipNumber || '').padStart(2, '0')}.`,
      });
      return;
    }

    const safeSpeed = Math.max(0.2, Math.min(4.0, Number(speed) || 1));
    const safeTrimStart = Math.max(0, Number(trimStart) || 0);
    const safeTrimEnd = Number(trimEnd) > safeTrimStart + 0.05 ? Number(trimEnd) : 0;

    const cacheDir = path.join(path.dirname(sourceMp4), '.vocals_cache');
    if (!fs.existsSync(cacheDir)) {
      fs.mkdirSync(cacheDir, { recursive: true });
    }

    const baseKey = path
      .basename(sourceMp4, path.extname(sourceMp4))
      .replace(/[^a-zA-Z0-9_-]/g, '_')
      .slice(0, 48);
    const bakedKey = `t${safeTrimStart.toFixed(2)}_${safeTrimEnd.toFixed(2)}_s${safeSpeed.toFixed(3)}`;
    const vocalsMp3Path = path.join(cacheDir, `${baseKey}_${bakedKey}_vocals.mp3`);
    const cleanMp4Path = path.join(cacheDir, `${baseKey}_${bakedKey}_novocals.mp4`);

    const ffmpegBin = resolveFfmpegBin();
    const inputTrimArgs: string[] = [];
    if (safeTrimStart > 0.01) {
      inputTrimArgs.push('-ss', safeTrimStart.toFixed(3));
    }
    if (safeTrimEnd > safeTrimStart + 0.05) {
      inputTrimArgs.push('-to', safeTrimEnd.toFixed(3));
    }

    const buildAtempoChain = (spd: number): string => {
      if (Math.abs(spd - 1) < 0.02) return '';
      const stages: string[] = [];
      let rem = Math.max(0.2, Math.min(4.0, spd));
      while (rem < 0.5) {
        stages.push('atempo=0.5');
        rem /= 0.5;
      }
      while (rem > 2.0) {
        stages.push('atempo=2.0');
        rem /= 2.0;
      }
      stages.push(`atempo=${rem.toFixed(3)}`);
      return stages.join(',');
    };
    const atempoPart = buildAtempoChain(safeSpeed);

    // 1. Extract vocal speech stem (.mp3)
    if (!fs.existsSync(vocalsMp3Path) || fs.statSync(vocalsMp3Path).size < 1024) {
      const vocalFilter = [
        'highpass=f=200',
        'lowpass=f=3600',
        'afftdn=nf=-24',
        'acompressor=threshold=-20dB:ratio=3:makeup=4dB',
        atempoPart,
      ]
        .filter(Boolean)
        .join(',');

      await new Promise<void>((resolve) => {
        const args = [
          '-y',
          ...inputTrimArgs,
          '-i',
          sourceMp4,
          '-vn',
          '-af',
          vocalFilter,
          '-c:a',
          'libmp3lame',
          '-q:a',
          '2',
          vocalsMp3Path,
        ];
        const proc = spawn(ffmpegBin, args, { stdio: 'ignore' });
        proc.on('error', () => resolve());
        proc.on('close', () => resolve());
      });

      // Fallback if clip had no audio stream or afftdn wasn't supported
      if (!fs.existsSync(vocalsMp3Path) || fs.statSync(vocalsMp3Path).size < 512) {
        await new Promise<void>((resolve) => {
          const fallbackArgs = [
            '-y',
            '-f',
            'lavfi',
            '-i',
            'anullsrc=channel_layout=stereo:sample_rate=44100',
            '-t',
            '4',
            '-c:a',
            'libmp3lame',
            '-q:a',
            '4',
            vocalsMp3Path,
          ];
          const proc = spawn(ffmpegBin, fallbackArgs, { stdio: 'ignore' });
          proc.on('error', () => resolve());
          proc.on('close', () => resolve());
        });
      }
    }

    // 2. Create vocal-suppressed MP4 copy (video stream copy + surgical FFT narrowband vocal harmonic clamp that preserves 100% of broadband Foley)
    if (!fs.existsSync(cleanMp4Path) || fs.statSync(cleanMp4Path).size < 5000) {
      const sum4V =
        '(hypot(real(b-10,ch),imag(b-10,ch))+hypot(real(b-6,ch),imag(b-6,ch))+hypot(real(b+6,ch),imag(b+6,ch))+hypot(real(b+10,ch),imag(b+10,ch)))';
      const magV = 'max(0.000001,hypot(re,im))';
      const exprV = `if(between(b,20,290)*gt(${magV},0.58*${sum4V}),(0.27*${sum4V})/${magV},1)`;
      const suppressVocalFilter = `afftfilt=real='re*(${exprV})':imag='im*(${exprV})':win_size=4096:overlap=0.75`;
      await new Promise<void>((resolve) => {
        const args = [
          '-y',
          '-i',
          sourceMp4,
          '-c:v',
          'copy',
          '-af',
          suppressVocalFilter,
          '-c:a',
          'aac',
          '-b:a',
          '160k',
          cleanMp4Path,
        ];
        const proc = spawn(ffmpegBin, args, { stdio: 'ignore' });
        proc.on('error', () => resolve());
        proc.on('close', () => resolve());
      });
    }

    const vocalsStat = fs.existsSync(vocalsMp3Path) ? fs.statSync(vocalsMp3Path) : null;
    const cleanStat =
      fs.existsSync(cleanMp4Path) && fs.statSync(cleanMp4Path).size > 5000
        ? fs.statSync(cleanMp4Path)
        : null;

    res.json({
      ok: true,
      clipId,
      clipNumber,
      vocalsAudioUrl: vocalsStat
        ? `/api/flow/serve-folder-file?filePath=${encodeURIComponent(vocalsMp3Path)}&v=${Math.floor(vocalsStat.mtimeMs)}`
        : '',
      cleanVideoUrl: cleanStat
        ? `/api/flow/serve-folder-file?filePath=${encodeURIComponent(cleanMp4Path)}&v=${Math.floor(cleanStat.mtimeMs)}`
        : '',
    });
  } catch (err: any) {
    console.error('Error en /api/flow/separate-clip-vocals:', err);
    res.status(500).json({
      ok: false,
      error: err?.message || 'Error separando voces del clip.',
    });
  }
});

// Separate background music stem from a video clip into a standalone MP3 and a music-attenuated MP4
app.post('/api/flow/separate-clip-music', async (req, res) => {
  try {
    const {
      clipId,
      clipNumber,
      videoUrl,
      fileName,
      folderPath,
      folderName,
      docTitle,
      trimStart,
      trimEnd,
      speed,
    } = req.body || {};

    let sourceMp4 = '';
    if (typeof videoUrl === 'string' && videoUrl.includes('filePath=')) {
      try {
        const parsed = new URL(videoUrl, 'http://localhost:4200');
        const fp = parsed.searchParams.get('filePath');
        if (fp && fs.existsSync(fp)) {
          sourceMp4 = fp;
        }
      } catch {}
    }

    const resolvedRoot = resolveLocalDocumentaryFolder(folderPath, folderName, docTitle);
    const clipsVideoSubdir = resolvedRoot ? path.join(resolvedRoot, '05_Clips_Video') : '';
    const clipsApprovedSubdir = resolvedRoot ? path.join(resolvedRoot, 'Clips_Aprobados') : '';

    if (!sourceMp4 && resolvedRoot && fs.existsSync(resolvedRoot)) {
      const searchDirs = [clipsVideoSubdir, resolvedRoot, clipsApprovedSubdir].filter(
        (d) => d && fs.existsSync(d)
      );
      if (fileName) {
        for (const d of searchDirs) {
          const cand = path.join(d, path.basename(fileName));
          if (fs.existsSync(cand) && fs.statSync(cand).isFile()) {
            sourceMp4 = cand;
            break;
          }
        }
      }
      if (!sourceMp4 && Number(clipNumber) > 0) {
        const num = Number(clipNumber);
        const prefixRegex = new RegExp(`^(?:clip[_\\-\\s.]*)?0*${num}[_\\-\\s.]`, 'i');
        for (const d of searchDirs) {
          const matches = fs
            .readdirSync(d)
            .filter(
              (f) =>
                !f.startsWith('.') &&
                prefixRegex.test(f) &&
                /\.(mp4|mov|webm)$/i.test(f)
            )
            .sort((a, b) => {
              const a4k = /[_\-]4k\.(mp4|mov|webm)$/i.test(a) ? 1 : 0;
              const b4k = /[_\-]4k\.(mp4|mov|webm)$/i.test(b) ? 1 : 0;
              if (b4k !== a4k) return b4k - a4k;
              try {
                return (
                  fs.statSync(path.join(d, b)).mtimeMs -
                  fs.statSync(path.join(d, a)).mtimeMs
                );
              } catch {
                return 0;
              }
            });
          if (matches.length > 0) {
            sourceMp4 = path.join(d, matches[0]);
            break;
          }
        }
      }
    }

    if (!sourceMp4 || !fs.existsSync(sourceMp4)) {
      res.status(404).json({
        ok: false,
        error: `No se encontró el archivo MP4 original para extraer música del Clip ${String(clipNumber || '').padStart(2, '0')}.`,
      });
      return;
    }

    const safeSpeed = Math.max(0.2, Math.min(4.0, Number(speed) || 1));
    const safeTrimStart = Math.max(0, Number(trimStart) || 0);
    const safeTrimEnd = Number(trimEnd) > safeTrimStart + 0.05 ? Number(trimEnd) : 0;

    const cacheDir = path.join(path.dirname(sourceMp4), '.music_cache');
    if (!fs.existsSync(cacheDir)) {
      fs.mkdirSync(cacheDir, { recursive: true });
    }

    const baseKey = path
      .basename(sourceMp4, path.extname(sourceMp4))
      .replace(/[^a-zA-Z0-9_-]/g, '_')
      .slice(0, 48);
    const bakedKey = `t${safeTrimStart.toFixed(2)}_${safeTrimEnd.toFixed(2)}_s${safeSpeed.toFixed(3)}`;
    const musicMp3Path = path.join(cacheDir, `${baseKey}_${bakedKey}_music.mp3`);
    const cleanMp4Path = path.join(cacheDir, `${baseKey}_${bakedKey}_nomusic.mp4`);

    const ffmpegBin = resolveFfmpegBin();
    const inputTrimArgs: string[] = [];
    if (safeTrimStart > 0.01) {
      inputTrimArgs.push('-ss', safeTrimStart.toFixed(3));
    }
    if (safeTrimEnd > safeTrimStart + 0.05) {
      inputTrimArgs.push('-to', safeTrimEnd.toFixed(3));
    }

    const buildAtempoChain = (spd: number): string => {
      if (Math.abs(spd - 1) < 0.02) return '';
      const stages: string[] = [];
      let rem = Math.max(0.2, Math.min(4.0, spd));
      while (rem < 0.5) {
        stages.push('atempo=0.5');
        rem /= 0.5;
      }
      while (rem > 2.0) {
        stages.push('atempo=2.0');
        rem /= 2.0;
      }
      stages.push(`atempo=${rem.toFixed(3)}`);
      return stages.join(',');
    };
    const atempoPart = buildAtempoChain(safeSpeed);

    // 1. Extract musical / harmonic stem (.mp3)
    if (!fs.existsSync(musicMp3Path) || fs.statSync(musicMp3Path).size < 1024) {
      const musicFilter = [
        'highpass=f=70',
        'lowpass=f=9500',
        'afftdn=nf=-28',
        'acompressor=threshold=-22dB:ratio=2.5:makeup=3dB',
        atempoPart,
      ]
        .filter(Boolean)
        .join(',');

      await new Promise<void>((resolve) => {
        const args = [
          '-y',
          ...inputTrimArgs,
          '-i',
          sourceMp4,
          '-vn',
          '-af',
          musicFilter,
          '-c:a',
          'libmp3lame',
          '-q:a',
          '2',
          musicMp3Path,
        ];
        const proc = spawn(ffmpegBin, args, { stdio: 'ignore' });
        proc.on('error', () => resolve());
        proc.on('close', () => resolve());
      });

      if (!fs.existsSync(musicMp3Path) || fs.statSync(musicMp3Path).size < 512) {
        await new Promise<void>((resolve) => {
          const fallbackArgs = [
            '-y',
            '-f',
            'lavfi',
            '-i',
            'anullsrc=channel_layout=stereo:sample_rate=44100',
            '-t',
            '4',
            '-c:a',
            'libmp3lame',
            '-q:a',
            '4',
            musicMp3Path,
          ];
          const proc = spawn(ffmpegBin, fallbackArgs, { stdio: 'ignore' });
          proc.on('error', () => resolve());
          proc.on('close', () => resolve());
        });
      }
    }

    // 2. Create music-suppressed MP4 copy (video stream copy + surgical FFT narrowband musical harmonic clamp while preserving 100% of broadband Foley)
    if (!fs.existsSync(cleanMp4Path) || fs.statSync(cleanMp4Path).size < 5000) {
      const sum4M =
        '(hypot(real(b-10,ch),imag(b-10,ch))+hypot(real(b-6,ch),imag(b-6,ch))+hypot(real(b+6,ch),imag(b+6,ch))+hypot(real(b+10,ch),imag(b+10,ch)))';
      const magM = 'max(0.000001,hypot(re,im))';
      const exprM = `if(between(b,12,320)*gt(${magM},0.58*${sum4M}),(0.27*${sum4M})/${magM},1)`;
      const suppressMusicFilter = `afftfilt=real='re*(${exprM})':imag='im*(${exprM})':win_size=4096:overlap=0.75`;
      await new Promise<void>((resolve) => {
        const args = [
          '-y',
          '-i',
          sourceMp4,
          '-c:v',
          'copy',
          '-af',
          suppressMusicFilter,
          '-c:a',
          'aac',
          '-b:a',
          '160k',
          cleanMp4Path,
        ];
        const proc = spawn(ffmpegBin, args, { stdio: 'ignore' });
        proc.on('error', () => resolve());
        proc.on('close', () => resolve());
      });
    }

    const musicStat = fs.existsSync(musicMp3Path) ? fs.statSync(musicMp3Path) : null;
    const cleanStat =
      fs.existsSync(cleanMp4Path) && fs.statSync(cleanMp4Path).size > 5000
        ? fs.statSync(cleanMp4Path)
        : null;

    res.json({
      ok: true,
      clipId,
      clipNumber,
      musicAudioUrl: musicStat
        ? `/api/flow/serve-folder-file?filePath=${encodeURIComponent(musicMp3Path)}&v=${Math.floor(musicStat.mtimeMs)}`
        : '',
      cleanVideoUrl: cleanStat
        ? `/api/flow/serve-folder-file?filePath=${encodeURIComponent(cleanMp4Path)}&v=${Math.floor(cleanStat.mtimeMs)}`
        : '',
    });
  } catch (err: any) {
    console.error('Error en /api/flow/separate-clip-music:', err);
    res.status(500).json({
      ok: false,
      error: err?.message || 'Error extrayendo música del clip.',
    });
  }
});

// Acoustic detector: analyzes a clip's 280Hz–3400Hz vocal/harmonic band in 100ms frames
// to distinguish true spoken voice or musical chords/melody from pure ambient/resonant Foley
// (rain, wind, waves, footsteps, wood creaks, fire crackle, steamship horns, bells, etc.).
async function detectVoiceOrMusicInClipAudio(
  inputMp4Path: string,
  ffmpegBin: string
): Promise<{
  hasVoiceOrMusic: boolean;
  isSpeech: boolean;
  isMusic: boolean;
  enableClause: string;
}> {
  const bname = path.basename(inputMp4Path).toLowerCase();
  if (bname.includes('sin_voz')) {
    return { hasVoiceOrMusic: false, isSpeech: false, isMusic: false, enableClause: '' };
  }

  return new Promise((resolve) => {
    const chunks: Buffer[] = [];
    const proc = spawn(
      ffmpegBin,
      [
        '-hide_banner',
        '-loglevel',
        'error',
        '-i',
        inputMp4Path,
        '-vn',
        '-af',
        'highpass=f=280,lowpass=f=3400',
        '-ac',
        '1',
        '-ar',
        '16000',
        '-f',
        's16le',
        '-',
      ],
      { stdio: ['ignore', 'pipe', 'ignore'] }
    );

    proc.stdout.on('data', (d: Buffer) => chunks.push(d));
    proc.on('error', () =>
      resolve({ hasVoiceOrMusic: false, isSpeech: false, isMusic: false, enableClause: '' })
    );
    proc.on('close', () => {
      try {
        const raw = Buffer.concat(chunks);
        const totalSamples = Math.floor(raw.length / 2);
        if (totalSamples < 8000) {
          resolve({ hasVoiceOrMusic: false, isSpeech: false, isMusic: false, enableClause: '' });
          return;
        }
        const win = 1600; // 100ms window at 16kHz
        const nWins = Math.floor(totalSamples / win);
        let voicedWins = 0;
        let transitions = 0;
        let prevVoiced = false;
        const pitchClasses = new Set<number>();
        const voicedFlags: boolean[] = [];

        for (let w = 0; w < nWins; w++) {
          const byteOffset = w * win * 2;
          let sumSq = 0;
          let zc = 0;
          let prevSample = raw.readInt16LE(byteOffset);
          for (let i = 0; i < win; i++) {
            const s = raw.readInt16LE(byteOffset + i * 2);
            sumSq += s * s;
            if (i > 0 && s >= 0 !== prevSample >= 0) zc++;
            prevSample = s;
          }
          const meanSq = sumSq / win;
          const rms = Math.sqrt(meanSq) / 32768;
          const zcr = zc / win;

          let isVoiced = false;
          if (rms > 0.01 && zcr < 0.24 && sumSq > 0) {
            let bestR = 0;
            let bestLag = 0;
            for (let lag = 36; lag < 165; lag += 3) {
              let num = 0;
              const limit = win - lag;
              for (let k = 0; k < limit; k++) {
                const s1 = raw.readInt16LE(byteOffset + k * 2);
                const s2 = raw.readInt16LE(byteOffset + (k + lag) * 2);
                num += s1 * s2;
              }
              const r = num / (meanSq * limit + 1e-9);
              if (r > bestR) {
                bestR = r;
                bestLag = lag;
              }
            }
            if (bestR > 0.58 && bestLag > 0) {
              isVoiced = true;
              voicedWins++;
              pitchClasses.add(Math.round(Math.log(bestLag) * 8));
            }
          }
          voicedFlags.push(isVoiced);
          if (isVoiced !== prevVoiced) {
            transitions++;
            prevVoiced = isVoiced;
          }
        }

        const voicedFrac = voicedWins / Math.max(1, nWins);
        const distinctPitches = pitchClasses.size;
        const isSpeech = transitions >= 8 && voicedFrac >= 0.18 && distinctPitches >= 3;
        const isMusic = voicedFrac >= 0.5 && distinctPitches >= 3;
        const hasVoiceOrMusic = isSpeech || isMusic;

        if (!hasVoiceOrMusic) {
          resolve({ hasVoiceOrMusic: false, isSpeech: false, isMusic: false, enableClause: '' });
          return;
        }

        // If music covers >=50% of the clip, apply across the clip; otherwise build padded timeline intervals around voiced windows
        if (isMusic || voicedFrac >= 0.48) {
          resolve({ hasVoiceOrMusic: true, isSpeech, isMusic, enableClause: '' });
          return;
        }

        const intervals: Array<[number, number]> = [];
        for (let w = 0; w < nWins; w++) {
          if (!voicedFlags[w]) continue;
          const t0 = Math.max(0, w * 0.1 - 0.3);
          const t1 = (w + 1) * 0.1 + 0.35;
          if (intervals.length > 0 && t0 <= intervals[intervals.length - 1][1] + 0.45) {
            intervals[intervals.length - 1][1] = Math.max(intervals[intervals.length - 1][1], t1);
          } else {
            intervals.push([t0, t1]);
          }
        }

        const enableExpr = intervals
          .slice(0, 12)
          .map(([a, b]) => `between(t,${a.toFixed(2)},${b.toFixed(2)})`)
          .join('+');
        const enableClause = enableExpr ? `:enable='${enableExpr}'` : '';
        resolve({ hasVoiceOrMusic: true, isSpeech, isMusic, enableClause });
      } catch {
        resolve({ hasVoiceOrMusic: false, isSpeech: false, isMusic: false, enableClause: '' });
      }
    });
  });
}

// Detect, separate, and eliminate BOTH background music and voices from a video clip, leaving ONLY pure ambient Foley audio
app.post('/api/flow/isolate-clip-foley', async (req, res) => {
  try {
    const {
      clipId,
      clipNumber,
      videoUrl,
      opticalFlowUrl,
      fileName,
      folderPath,
      folderName,
      docTitle,
    } = req.body || {};

    let sourceMp4 = '';
    if (typeof videoUrl === 'string' && videoUrl.includes('filePath=')) {
      try {
        const parsed = new URL(videoUrl, 'http://localhost:4200');
        const fp = parsed.searchParams.get('filePath');
        if (fp && fs.existsSync(fp)) {
          sourceMp4 = fp;
        }
      } catch {}
    }

    const resolvedRoot = resolveLocalDocumentaryFolder(folderPath, folderName, docTitle);
    const clipsVideoSubdir = resolvedRoot ? path.join(resolvedRoot, '05_Clips_Video') : '';
    const clipsApprovedSubdir = resolvedRoot ? path.join(resolvedRoot, 'Clips_Aprobados') : '';

    if (
      (!sourceMp4 ||
        sourceMp4.includes('.vocals_cache') ||
        sourceMp4.includes('.music_cache') ||
        sourceMp4.includes('.foley_only_cache') ||
        /_foley_(?:only|v2)\.mp4$/i.test(sourceMp4)) &&
      resolvedRoot &&
      fs.existsSync(resolvedRoot)
    ) {
      const searchDirs = [clipsVideoSubdir, resolvedRoot, clipsApprovedSubdir].filter(
        (d) => d && fs.existsSync(d)
      );
      if (fileName) {
        const cleanFileName = path
          .basename(fileName)
          .replace(/_foley_(?:only|v2)(?=\.[^.]+$)/i, '');
        for (const d of searchDirs) {
          const cand = path.join(d, cleanFileName);
          if (fs.existsSync(cand) && fs.statSync(cand).isFile()) {
            sourceMp4 = cand;
            break;
          }
        }
      }
      if (
        (!sourceMp4 ||
          sourceMp4.includes('.vocals_cache') ||
          sourceMp4.includes('.music_cache') ||
          sourceMp4.includes('.foley_only_cache') ||
          /_foley_(?:only|v2)\.mp4$/i.test(sourceMp4)) &&
        Number(clipNumber) > 0
      ) {
        const num = Number(clipNumber);
        const prefixRegex = new RegExp(`^(?:clip[_\\-\\s.]*)?0*${num}[_\\-\\s.]`, 'i');
        for (const d of searchDirs) {
          const matches = fs
            .readdirSync(d)
            .filter(
              (f) =>
                !f.startsWith('.') &&
                prefixRegex.test(f) &&
                !/foley_(?:only|v2)/i.test(f) &&
                /\.(mp4|mov|webm)$/i.test(f)
            )
            .sort((a, b) => {
              const a4k = /[_\-]4k\.(mp4|mov|webm)$/i.test(a) ? 1 : 0;
              const b4k = /[_\-]4k\.(mp4|mov|webm)$/i.test(b) ? 1 : 0;
              if (b4k !== a4k) return b4k - a4k;
              try {
                return (
                  fs.statSync(path.join(d, b)).mtimeMs -
                  fs.statSync(path.join(d, a)).mtimeMs
                );
              } catch {
                return 0;
              }
            });
          if (matches.length > 0) {
            sourceMp4 = path.join(d, matches[0]);
            break;
          }
        }
      }
    }

    if (!sourceMp4 || !fs.existsSync(sourceMp4)) {
      res.status(404).json({
        ok: false,
        error: `No se encontró el archivo MP4 original para aislar el Foley del Clip ${String(clipNumber || '').padStart(2, '0')}.`,
      });
      return;
    }

    const cacheDir = path.join(path.dirname(sourceMp4), '.foley_only_cache');
    if (!fs.existsSync(cacheDir)) {
      fs.mkdirSync(cacheDir, { recursive: true });
    }

    const baseKey = path
      .basename(sourceMp4, path.extname(sourceMp4))
      .replace(/_foley_(?:only|v2)$/i, '')
      .replace(/[^a-zA-Z0-9_-]/g, '_')
      .slice(0, 56);

    // Clean up legacy destructive v1 cache file if present
    const legacyFoleyMp4Path = path.join(cacheDir, `${baseKey}_foley_only.mp4`);
    if (fs.existsSync(legacyFoleyMp4Path)) {
      try {
        fs.unlinkSync(legacyFoleyMp4Path);
      } catch {}
    }

    const ffmpegBin = resolveFfmpegBin();
    const detection = await detectVoiceOrMusicInClipAudio(sourceMp4, ffmpegBin);
    const srcStat = fs.statSync(sourceMp4);

    // Resolve clean Optical Flow path (removing any legacy _foley_only suffix)
    let rawOptPath = '';
    if (typeof opticalFlowUrl === 'string' && opticalFlowUrl.includes('filePath=')) {
      try {
        const parsedOpt = new URL(opticalFlowUrl, 'http://localhost:4200');
        const fp = parsedOpt.searchParams.get('filePath');
        if (fp) {
          const baseOpt = fp.replace(/_foley_(?:only|v2)\.mp4$/i, '.mp4');
          if (fs.existsSync(baseOpt)) rawOptPath = baseOpt;
          else if (fs.existsSync(fp)) rawOptPath = fp;
        }
      } catch {}
    }

    // CASE 1: Clip already contains 100% pure ambient Foley (no spoken voice and no music detected).
    // Preserve its original Foley audio stream 100% untouched (0.0 dB loss)!
    if (!detection.hasVoiceOrMusic) {
      let cleanOpticalFlowUrl = '';
      if (rawOptPath && fs.existsSync(rawOptPath)) {
        const optSt = fs.statSync(rawOptPath);
        cleanOpticalFlowUrl = `/api/flow/serve-folder-file?filePath=${encodeURIComponent(rawOptPath)}&v=${Math.floor(optSt.mtimeMs)}`;
      }
      res.json({
        ok: true,
        clipId,
        clipNumber,
        alreadyPureFoley: true,
        cleanFoleyVideoUrl: `/api/flow/serve-folder-file?filePath=${encodeURIComponent(sourceMp4)}&v=${Math.floor(srcStat.mtimeMs)}`,
        cleanOpticalFlowUrl,
      });
      return;
    }

    // CASE 2: Clip contains detected spoken voice or musical chords/melody.
    // Apply surgical FFT narrowband harmonic-peak clamp (afftfilt) that shaves ONLY narrow harmonic spikes
    // (mag > 2.4x local floor in 165Hz–3500Hz) down to the surrounding ambient Foley floor (1.12x local floor),
    // preserving 100% of stereo channels and broadband/transient Foley (rain, wind, waves, footsteps, fire, wood, cloth).
    const foleyMp4Path = path.join(cacheDir, `${baseKey}_foley_v2.mp4`);
    const sumNeighbors =
      '(hypot(real(b-10,ch),imag(b-10,ch))+hypot(real(b-6,ch),imag(b-6,ch))+hypot(real(b+6,ch),imag(b+6,ch))+hypot(real(b+10,ch),imag(b+10,ch)))';
    const magBin = 'max(0.000001,hypot(re,im))';
    const harmonicClampExpr = `if(between(b,14,300)*gt(${magBin},0.60*${sumNeighbors}),(0.28*${sumNeighbors})/${magBin},1)`;
    const isolateFoleyFilter = `afftfilt=real='re*(${harmonicClampExpr})':imag='im*(${harmonicClampExpr})':win_size=4096:overlap=0.75${detection.enableClause}`;

    const needsRebuild =
      !fs.existsSync(foleyMp4Path) ||
      fs.statSync(foleyMp4Path).size < 5000 ||
      fs.statSync(foleyMp4Path).mtimeMs < srcStat.mtimeMs;

    if (needsRebuild) {
      await new Promise<void>((resolve) => {
        const args = [
          '-y',
          '-i',
          sourceMp4,
          '-c:v',
          'copy',
          '-af',
          isolateFoleyFilter,
          '-c:a',
          'aac',
          '-b:a',
          '160k',
          foleyMp4Path,
        ];
        const proc = spawn(ffmpegBin, args, { stdio: 'ignore' });
        proc.on('error', () => resolve());
        proc.on('close', () => resolve());
      });
    }

    // If the clip also has a pre-baked 60fps Optical Flow MP4, clean its audio stream in-place (preserving 60fps video)
    let cleanOpticalFlowUrl = '';
    if (rawOptPath && fs.existsSync(rawOptPath)) {
      try {
        const optBase = path
          .basename(rawOptPath, path.extname(rawOptPath))
          .replace(/_foley_(?:only|v2)$/i, '');
        const foleyOptPath = path.join(path.dirname(rawOptPath), `${optBase}_foley_v2.mp4`);
        const optFilter = `afftfilt=real='re*(${harmonicClampExpr})':imag='im*(${harmonicClampExpr})':win_size=4096:overlap=0.75`;
        if (!fs.existsSync(foleyOptPath) || fs.statSync(foleyOptPath).size < 5000) {
          await new Promise<void>((resolve) => {
            const proc = spawn(
              ffmpegBin,
              [
                '-y',
                '-i',
                rawOptPath,
                '-c:v',
                'copy',
                '-af',
                optFilter,
                '-c:a',
                'aac',
                '-b:a',
                '160k',
                foleyOptPath,
              ],
              { stdio: 'ignore' }
            );
            proc.on('error', () => resolve());
            proc.on('close', () => resolve());
          });
        }
        if (fs.existsSync(foleyOptPath) && fs.statSync(foleyOptPath).size > 5000) {
          const optSt = fs.statSync(foleyOptPath);
          cleanOpticalFlowUrl = `/api/flow/serve-folder-file?filePath=${encodeURIComponent(foleyOptPath)}&v=${Math.floor(optSt.mtimeMs)}`;
        }
      } catch {}
    }

    const cleanStat =
      fs.existsSync(foleyMp4Path) && fs.statSync(foleyMp4Path).size > 5000
        ? fs.statSync(foleyMp4Path)
        : null;

    res.json({
      ok: true,
      clipId,
      clipNumber,
      alreadyPureFoley: false,
      cleanFoleyVideoUrl: cleanStat
        ? `/api/flow/serve-folder-file?filePath=${encodeURIComponent(foleyMp4Path)}&v=${Math.floor(cleanStat.mtimeMs)}`
        : `/api/flow/serve-folder-file?filePath=${encodeURIComponent(sourceMp4)}&v=${Math.floor(srcStat.mtimeMs)}`,
      cleanOpticalFlowUrl,
    });
  } catch (err: any) {
    console.error('Error en /api/flow/isolate-clip-foley:', err);
    res.status(500).json({
      ok: false,
      error: err?.message || 'Error aislando el audio Foley del clip.',
    });
  }
});

// Repair choppy static-image slow-zoom clips into 60 FPS sub-pixel smooth zoom MP4s
app.post('/api/flow/repair-choppy-zoom', async (req, res) => {
  try {
    const { clipId, clipNumber, videoUrl, fileName, folderPath, folderName, docTitle } =
      req.body || {};

    let sourceMp4 = '';
    const rawUrl = String(videoUrl || '');
    if (rawUrl.includes('filePath=')) {
      try {
        const parsed = new URL(rawUrl, 'http://localhost:4200');
        const fp = parsed.searchParams.get('filePath');
        if (fp && fs.existsSync(fp)) sourceMp4 = fp;
      } catch {}
    }

    if (!sourceMp4) {
      const targetRoot = resolveLocalDocumentaryFolder(folderPath, folderName, docTitle);
      if (targetRoot && fs.existsSync(targetRoot)) {
        const clipsDir = path.join(targetRoot, '05_Clips_Video');
        const searchDirs = fs.existsSync(clipsDir) ? [clipsDir, targetRoot] : [targetRoot];
        const padded = String(Number(clipNumber) || 0).padStart(2, '0');
        for (const d of searchDirs) {
          if (fileName && fs.existsSync(path.join(d, fileName))) {
            sourceMp4 = path.join(d, fileName);
            break;
          }
          const files = fs.readdirSync(d).filter((f) => f.toLowerCase().endsWith('.mp4'));
          const match = files.find(
            (f) => f.startsWith(`${padded}_`) || new RegExp(`^Clip[ _-]0*${Number(clipNumber)}\\b`, 'i').test(f)
          );
          if (match) {
            sourceMp4 = path.join(d, match);
            break;
          }
        }
      }
    }

    if (!sourceMp4 || !fs.existsSync(sourceMp4)) {
      return res.status(404).json({
        ok: false,
        error: 'No se encontró el archivo .MP4 local del clip para suavizar su zoom.',
      });
    }

    const ffmpegBin = resolveFfmpegBin();
    if (!ffmpegBin) {
      return res.status(500).json({
        ok: false,
        error: 'No se encontró FFmpeg en el servidor.',
      });
    }

    const tmpOut = path.join('/tmp', `smooth_zoom_${process.pid}_${Date.now()}_${path.basename(sourceMp4)}`);
    const vf =
      "trim=end_frame=1,fps=60,format=rgb24,tpad=stop_mode=clone:stop_duration=10,trim=duration=10,perspective=" +
      "x0='W*0.06*(in/600)':y0='H*0.06*(in/600)':" +
      "x1='W*(1-0.06*(in/600))':y1='H*0.06*(in/600)':" +
      "x2='W*0.06*(in/600)':y2='H*(1-0.06*(in/600))':" +
      "x3='W*(1-0.06*(in/600))':y3='H*(1-0.06*(in/600))':" +
      'interpolation=linear:sense=source:eval=frame,format=yuv420p';

    await new Promise<void>((resolve, reject) => {
      const proc = spawn(
        ffmpegBin,
        [
          '-y',
          '-i',
          sourceMp4,
          '-vf',
          vf,
          '-an',
          '-c:v',
          'h264_videotoolbox',
          '-b:v',
          '8M',
          '-movflags',
          '+faststart',
          tmpOut,
        ],
        { stdio: 'ignore' }
      );
      proc.on('error', reject);
      proc.on('close', (code) => {
        if (code === 0 && fs.existsSync(tmpOut) && fs.statSync(tmpOut).size > 50000) {
          resolve();
        } else {
          reject(new Error(`FFmpeg exited with code ${code}`));
        }
      });
    });

    fs.copyFileSync(tmpOut, sourceMp4);
    try {
      fs.unlinkSync(tmpOut);
    } catch {}

    const st = fs.statSync(sourceMp4);
    res.json({
      ok: true,
      clipId,
      clipNumber,
      repairedVideoUrl: `/api/flow/serve-folder-file?filePath=${encodeURIComponent(sourceMp4)}&v=${Math.floor(st.mtimeMs)}`,
    });
  } catch (err: any) {
    console.error('Error en /api/flow/repair-choppy-zoom:', err);
    res.status(500).json({
      ok: false,
      error: err?.message || 'Error suavizando el slow zoom-in del clip.',
    });
  }
});

// Setup Vite Dev Server or Production static serving
async function bootstrap() {
  if (process.env.NODE_ENV !== 'production') {
    const vite = await createViteServer({
      server: {
        middlewareMode: true,
        watch: {
          ignored: ['**/data/**', '**/dist/**', '**/docs/**', '**/chrome-extension/**', '**/*.log'],
        },
      },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), 'dist');
    app.use(express.static(distPath));
    app.get('*', (req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`Huellas Master running at http://localhost:${PORT}`);
  });
}

bootstrap();
