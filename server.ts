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

app.get('/api/documentaries', (req, res) => {
  res.json(readDocumentaries());
});

app.get('/api/documentaries/:id', (req, res) => {
  const list = readDocumentaries();
  const doc = list.find((d) => d.id === req.params.id);
  if (!doc) {
    res.status(404).json({ error: 'Documental no encontrado.' });
    return;
  }
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
  const list = readDocumentaries();
  const idx = list.findIndex((d) => d.id === req.params.id);
  if (idx === -1) {
    // Upsert documentary if it existed in browser cache or another device but wasn't in local data/documentaries.json yet
    const now = new Date().toISOString();
    const upserted = {
      ...req.body,
      id: req.params.id,
      createdAt: req.body?.createdAt || now,
      updatedAt: now,
    };
    list.unshift(upserted);
    writeDocumentaries(list);
    res.json(upserted);
    return;
  }
  const updated = {
    ...list[idx],
    ...req.body,
    id: list[idx].id,
    updatedAt: new Date().toISOString(),
  };
  list[idx] = updated;
  writeDocumentaries(list);
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
    const viralContextBlock = youtubeViralLink
      ? `\nENLACE DE VIDEO VIRAL DE YOUTUBE DE REFERENCIA: ${youtubeViralLink}\nINSTRUCCIÓN OBLIGATORIA DE ANÁLISIS VIRAL: Analiza profunda, minuciosa, detallada, incisiva e intensamente, detalle por detalle y sin obviar nada, el video de YouTube en el enlace (${youtubeViralLink}) para entender cómo se hizo viral en la plataforma y RECREA EXACTAMENTE LA MISMA ESTRUCTURA GANADORA en este documental.\n`
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
3. Prompt Maestro detallado para desarrollar Investigación Profunda (Deep Research / NotebookLM).`;
    } else if (stageNumber === 4) {
      const targetChars = Math.round(((doc.targetDurationSeconds || 120) - voiceEntrySec) * 13.5);
      stagePrompt = `Actúa como un historiador, director de cine, y periodista profesional para "Huellas de la Humanidad".
Tema: ${doc.topic || doc.title} (${doc.historicalTime}, ${doc.historicalLocation})
Estructura e Investigación previa:
${doc.sectionsStructure || ''}
${doc.deepResearchResult || ''}

Redacta la ETAPA 4: GUION DE LA VOZ EN OFF en español neutro documental:
- Sincronización de Entrada de Voz: ${
        doc.clip1SyncMode === 'VOZ_EN_CLIP_2'
          ? `El Clip 1 dura ${c1Dur}s (00:00 - 00:0${c1Dur}) sin voz y los primeros 2s del Clip 2 (00:0${c1Dur} - 00:0${voiceEntrySec}) tampoco llevan voz; por lo tanto, los primeros ${voiceEntrySec} segundos no llevan locución y la voz narrativa entra obligatoriamente en el segundo ${voiceEntrySec} del video (que es el segundo 2 del segundo clip).`
          : `El Clip 1 de ${c1Dur}s se ralentiza en edición a ${voiceEntrySec}s (00:00 - 00:0${voiceEntrySec}) sin voz; la voz narrativa entra en el segundo ${voiceEntrySec} del video (al inicio del Clip 2).`
      }
- La duración total del guion NO tiene que ser exacta al segundo, sino APROXIMADA a la duración pedida (~${doc.targetDurationSeconds || 120}s).
- Comienza obligatoriamente con la tríada en la primera oración cerrada con punto: "Año [número en dígitos], [Lugar, Ciudad, País]. [Premisa intrigante]." (Prohibido poner "en el" después del año).
- Años siempre en dígitos, siglos y monarcas en números romanos (ej. siglo XIX, Felipe II), miles con palabra "mil" (ej. "70 mil"), cero signos de exclamación.
- Incluye etiquetas de pausa estratégicas como [pausa: 1.5s] o [pausa: 2s].
- Si es documental largo, incluye antes del segundo 30 el slogan en párrafo aparte y cierra el guion en párrafo aparte con la llamada a comentarios y el lema: "Cada historia deja una huella. Aquí seguimos sus rastros."
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
Genera la ETAPA 8: PROMPTS DE IMÁGENES INICIALES (Nano Banana 2.1) Y CLIPS DE VIDEO (Omni Flash) para el documental "${doc.topic || doc.title}" (${doc.historicalTime}, ${doc.historicalLocation}).
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
  if ((/^Documental_|_Master|_Final|_4K|_2K|_8K|_HD/i.test(clean)) && /\.mp4$/i.test(clean)) {
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
    const { folderPath, fileName, videoDataUrl, subFolder } = req.body;
    if (!folderPath || !fileName || !videoDataUrl) {
      res.status(400).json({ error: 'Faltan parámetros para guardar el video.' });
      return;
    }
    const safeName = path.basename(String(fileName).replace(/[^a-zA-Z0-9._-]/g, '_'));
    const rootDir = String(folderPath).trim();
    ensureDocumentarySubfolders(rootDir);
    const resolvedSub = resolveSubfolderForDocumentaryAsset(safeName, subFolder || '05_Clips_Video');
    const targetDir = path.join(rootDir, resolvedSub);
    if (!fs.existsSync(targetDir)) {
      fs.mkdirSync(targetDir, { recursive: true });
    }
    const fullTarget = path.join(targetDir, safeName);
    const cleanBase64 = String(videoDataUrl).replace(/^data:[^;]+;base64,/, '');
    const rawBuffer = Buffer.from(cleanBase64, 'base64');
    const finalBuffer =
      resolvedSub === '05_Clips_Video' && /\.mp4$/i.test(safeName)
        ? await upscaleMp4BufferTo4K(rawBuffer)
        : rawBuffer;
    fs.writeFileSync(fullTarget, finalBuffer);
    res.json({
      ok: true,
      savedPath: fullTarget,
      subFolder: resolvedSub,
      fileName: safeName,
      bytes: finalBuffer.length,
      resolution: '3840x2160',
    });
  } catch (err: any) {
    console.error('Error guardando video en carpeta elegida:', err);
    res.status(500).json({ error: err.message || 'Error guardando el archivo MP4.' });
  }
});

// Save any captured asset into its corresponding subfolder inside the single root folder
app.post('/api/flow/save-asset-to-folder', async (req, res) => {
  try {
    const { folderPath, fileName, dataUrl, subFolder } = req.body;
    if (!folderPath || !fileName || !dataUrl) {
      res.status(400).json({ error: 'Faltan parámetros para guardar el archivo.' });
      return;
    }
    const safeName = path.basename(String(fileName).replace(/[^a-zA-Z0-9._@-]/g, '_'));
    if (/^suno[_\-\s]*0*\d+\.(mp3|wav|m4a|ogg)$/i.test(safeName)) {
      res.json({ ok: true, skippedLegacySuno: true, fileName: safeName });
      return;
    }
    const rootDir = String(folderPath).trim();
    ensureDocumentarySubfolders(rootDir);
    const resolvedSub = resolveSubfolderForDocumentaryAsset(safeName, subFolder);
    const targetDir = path.join(rootDir, resolvedSub);
    if (!fs.existsSync(targetDir)) {
      fs.mkdirSync(targetDir, { recursive: true });
    }
    const fullTarget = path.join(targetDir, safeName);
    const cleanBase64 = String(dataUrl).replace(/^data:[^;]+;base64,/, '');
    const rawBuffer = Buffer.from(cleanBase64, 'base64');
    const finalBuffer =
      resolvedSub === '05_Clips_Video' && /\.mp4$/i.test(safeName)
        ? await upscaleMp4BufferTo4K(rawBuffer)
        : rawBuffer;
    fs.writeFileSync(fullTarget, finalBuffer);
    res.json({ ok: true, savedPath: fullTarget, subFolder: resolvedSub, fileName: safeName, bytes: finalBuffer.length });
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
      voiceoverDataUrl = '',
      sunoSilenceGapSec = 15,
      sunoMasterVolume = 0.14,
      musicTracks = [],
      srtContent = '',
    } = req.body;

    const targetRoot =
      folderPath && String(folderPath).trim()
        ? String(folderPath).trim()
        : path.join(process.env.HOME || '/tmp', 'Downloads');

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

    // 1. Collect all available MP4 clips on disk (from clips array or folderPath)
    const normalizedClipPaths: string[] = [];
    const clipsSubdir = path.join(targetRoot, 'Clips_Aprobados');

    for (let i = 0; i < clips.length; i++) {
      const c = clips[i];
      const fileName = c.fileName || `${String(c.clipNumber || i + 1).padStart(2, '0')}_Clip.mp4`;
      let sourceMp4 = '';

      const candidate1 = path.join(targetRoot, fileName);
      const candidate2 = path.join(clipsSubdir, fileName);
      if (fs.existsSync(candidate1)) {
        sourceMp4 = candidate1;
      } else if (fs.existsSync(candidate2)) {
        sourceMp4 = candidate2;
      } else if (c.videoDataUrl && String(c.videoDataUrl).startsWith('data:')) {
        const cleanB64 = String(c.videoDataUrl).replace(/^data:[^;]+;base64,/, '');
        sourceMp4 = candidate1;
        fs.writeFileSync(sourceMp4, Buffer.from(cleanB64, 'base64'));
      } else {
        // Fallback: match by prefix number (e.g. "01_") in targetRoot or Clips_Aprobados
        const prefix = `${String(c.clipNumber || i + 1).padStart(2, '0')}_`;
        for (const searchDir of [targetRoot, clipsSubdir]) {
          if (fs.existsSync(searchDir)) {
            const found = fs
              .readdirSync(searchDir)
              .find((f) => f.startsWith(prefix) && f.toLowerCase().endsWith('.mp4'));
            if (found) {
              sourceMp4 = path.join(searchDir, found);
              break;
            }
          }
        }
      }

      if (!sourceMp4 || !fs.existsSync(sourceMp4)) continue;

      // Normalize each segment with FFmpeg so concat is 100% glitch-free
      const segOut = path.join(workDir, `seg_${String(i + 1).padStart(3, '0')}.mp4`);
      const speed = Number(c.speed) > 0 ? Number(c.speed) : 1;
      const ptsFactor = (1 / speed).toFixed(3);
      const foleyVol = typeof c.foleyVolume === 'number' ? c.foleyVolume : 0.35;

      const vfFilter = `setpts=${ptsFactor}*PTS,scale=${outW}:${outH}:force_original_aspect_ratio=decrease,pad=${outW}:${outH}:(ow-iw)/2:(oh-ih)/2:black,fps=30,format=yuv420p`;

      await new Promise<void>((resolve, reject) => {
        execFile(
          'ffmpeg',
          [
            '-y',
            '-i',
            sourceMp4,
            '-vf',
            vfFilter,
            '-af',
            `volume=${foleyVol}`,
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
                'ffmpeg',
                [
                  '-y',
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
            fadeInSec: Math.max(0.5, Number(mt.fadeInSec || 2.5)),
            fadeOutSec: Math.max(0.5, Number(mt.fadeOutSec || 3.0)),
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
      if (hasVo) {
        ffmpegArgs.push('-i', voPath);
        const delayMs = Math.max(0, Math.round(Number(voiceoverStartSec || 0) * 1000));
        filterParts.push(
          `[${nextInputIdx}:a]adelay=${delayMs}|${delayMs},volume=${safeVoVol.toFixed(2)}[vo]`
        );
        mixLabels.push('[vo]');
        nextInputIdx++;
      }

      // Strict Voice-Priority Ceiling: music volume is always capped <= 18% of narrator voice volume
      const safeMusicVol = Math.min(
        safeVoVol * 0.18,
        Math.max(0.08, Number(sunoMasterVolume || 0.14))
      );
      for (let mIdx = 0; mIdx < resolvedMusicInputs.length; mIdx++) {
        const mItem = resolvedMusicInputs[mIdx];
        ffmpegArgs.push('-i', mItem.filePath);
        const startMs = Math.max(0, Math.round(mItem.startSec * 1000));
        const dur = Math.max(8, mItem.durationSec);
        const fadeOutStart = Math.max(0.5, Number((dur - mItem.fadeOutSec).toFixed(2)));
        const lbl = `mus${mIdx}`;
        filterParts.push(
          `[${nextInputIdx}:a]atrim=0:${dur},asetpts=PTS-STARTPTS,afade=t=in:st=0:d=${mItem.fadeInSec}:curve=tri,afade=t=out:st=${fadeOutStart}:d=${mItem.fadeOutSec}:curve=tri,volume=${safeMusicVol.toFixed(3)},adelay=${startMs}|${startMs}[${lbl}]`
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
// AUTO-DISCOVER & STREAM MEDIA FROM CHOSEN DOCUMENTARY FOLDER FOR VIDEO EDITOR
// ============================================================================
function resolveLocalDocumentaryFolder(folderPathQuery?: string, folderNameQuery?: string): string {
  const rawPath = String(folderPathQuery || '').trim();
  if (rawPath && fs.existsSync(rawPath) && fs.statSync(rawPath).isDirectory()) {
    return rawPath;
  }
  const rawName = String(folderNameQuery || '').trim();
  const homeDir = process.env.HOME || process.env.USERPROFILE || '';
  if (rawName && homeDir) {
    const icloudVideosDir = path.join(
      homeDir,
      'Library',
      'Mobile Documents',
      'com~apple~CloudDocs',
      '0YouTube',
      'Huellas de la Humanidad',
      'Videos'
    );
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
  return '';
}

app.get('/api/flow/list-folder-media', (req, res) => {
  try {
    const folderPath = String(req.query.folderPath || '');
    const folderName = String(req.query.folderName || '');
    const resolvedRoot = resolveLocalDocumentaryFolder(folderPath, folderName);

    const clipVideos: Array<{ clipNumber: number; fileName: string; url: string }> = [];
    const clipFrames: Array<{ clipNumber: number; fileName: string; url: string }> = [];
    const voiceoverFiles: Array<{ fileName: string; url: string }> = [];
    const sunoFiles: Array<{ trackNumber: number; fileName: string; url: string }> = [];

    if (resolvedRoot) {
      const videoSubfolders = ['05_Clips_Video', 'Clips_Aprobados', ''];
      const seenVideoClips = new Set<number>();
      for (const sub of videoSubfolders) {
        const dir = sub ? path.join(resolvedRoot, sub) : resolvedRoot;
        if (!fs.existsSync(dir) || !fs.statSync(dir).isDirectory()) continue;
        const entries = fs.readdirSync(dir).sort((a, b) => {
          try {
            return fs.statSync(path.join(dir, b)).mtimeMs - fs.statSync(path.join(dir, a)).mtimeMs;
          } catch {
            return 0;
          }
        });
        for (const entry of entries) {
          const full = path.join(dir, entry);
          const st = fs.statSync(full);
          if (!st.isFile()) continue;
          const mVid = entry.match(/^0*(\d+)[_\-\s.].*\.(mp4|webm|mov)$/i);
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
          const mImg = entry.match(/^0*(\d+)[_\-\s.].*\.(png|jpg|jpeg|webp)$/i);
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
        for (const entry of entries) {
          const fm = entry.match(/^(?:flowmusic|flow_music)[_\-\s]*0*(\d+)/i);
          if (fm) hasFlowMusicByNum.add(parseInt(fm[1], 10) || 1);
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
          // Auto-clean duplicate legacy Suno_0X.mp3 when FlowMusic_0X...mp3 exists in the same folder
          const legacySunoMatch = entry.match(/^suno[_\-\s]*0*(\d+)\.(mp3|wav|m4a|ogg)$/i);
          if (legacySunoMatch && hasFlowMusicByNum.has(parseInt(legacySunoMatch[1], 10) || 1)) {
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
    const filePath = String(req.query.filePath || '').trim();
    if (!filePath || !fs.existsSync(filePath) || !fs.statSync(filePath).isFile()) {
      res.status(404).send('Archivo no encontrado');
      return;
    }
    // Allow browser to cache MP4 range chunks in memory (URLs already include ?v=mtimeMs cache-buster)
    res.setHeader('Cache-Control', 'private, max-age=3600');
    res.sendFile(path.resolve(filePath));
  } catch (err: any) {
    res.status(500).send(err.message || 'Error sirviendo archivo');
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
