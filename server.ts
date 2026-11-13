import express from 'express';
import http from 'http';
import path from 'path';
import fs from 'fs';
import os from 'os';
import { exec, execFile, execSync, spawn, ChildProcess } from 'child_process';
import multer from 'multer';
import dotenv from 'dotenv';
import cors from 'cors';
import { createFlowPcManager } from './server/flowPcManager';
import { GoogleGenAI, Type } from '@google/genai';
import speech from '@google-cloud/speech';
import textToSpeech from '@google-cloud/text-to-speech';
import { createServer as createViteServer } from 'vite';
import ffmpegStatic from 'ffmpeg-static';
import {
  autoFitVoiceoverScriptToDuration,
  parseStage5TriggerBlocksShared,
  parseStage101ShortHooksShared,
  cleanAndNormalizeStage5ThumbnailPrompt,
  sanitizeBrandSafeEditorialText,
  normalizeFirstDayOfMonthInVoiceover,
  parseReferencesFromRawText,
  normalizeReferenceTagSlug,
} from './src/utils/smartParsers';
import {
  extractCleanPcmFromGeminiAudio,
  polishCleanTtsPcmBlock,
  hasEmbeddedC2paInAudioBytes,
  cleanMasterWavEmbeddedC2paInPlace,
  trimDuplicatedTakeInPcm,
} from './src/utils/geminiTtsAudioClean';

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
  if (
    req.method === 'GET' &&
    !req.path.startsWith('/api/flow/serve-folder-file') &&
    !req.path.startsWith('/flow-cap/')
  ) {
    res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
    res.setHeader('Pragma', 'no-cache');
    res.setHeader('Expires', '0');
  }
  if (req.method === 'OPTIONS') {
    res.sendStatus(204);
    return;
  }
  next();
});
app.use(cors({ origin: '*', optionsSuccessStatus: 200 }));
let flowCapEarlyHandler: express.RequestHandler | null = null;
app.use((req, res, next) => {
  if (flowCapEarlyHandler) {
    flowCapEarlyHandler(req, res, next);
    return;
  }
  next();
});
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

// Serve static local & Git-tracked portable audio files (with automatic .wav -> .mp3 fallback and Render docs/tts-files support)
const DOCS_TTS_DIR = path.join(process.cwd(), 'docs', 'tts-files');
app.use(
  '/tts-files',
  (req, res, next) => {
    if (req.path.toLowerCase().endsWith('.wav')) {
      for (const baseDir of [TTS_DIR, DOCS_TTS_DIR]) {
        const wavPath = path.join(baseDir, req.path);
        const mp3Path = wavPath.replace(/\.wav$/i, '.mp3');
        if (!fs.existsSync(wavPath) && fs.existsSync(mp3Path)) {
          res.sendFile(mp3Path);
          return;
        }
      }
    }
    next();
  },
  express.static(TTS_DIR),
  express.static(DOCS_TTS_DIR),
  (_req, res) => {
    res.status(404).json({ error: 'TTS audio file not found' });
  }
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
const DEFAULT_OPERATIONAL_HEADER_SERVER = `Act as a historian, film director, and professional journalist. Before starting the generation of any images or video clips, first analyze all provided prompts, check scene by scene whether people/human subjects are present or whether the scene is tagged [IMAGE ONLY — DO NOT GENERATE VIDEO CLIP], and give me a clear pre-generation report stating: (1) the exact total number of scenes, (2) how many video clips will be made with Omni (Omni 1.1 Flash), (3) how many video clips will be made with Lower Priority (Veo 3.1 - Lite [Lower Priority]), and (4) how many scenes are [IMAGE ONLY — DO NOT GENERATE VIDEO CLIP] Static B-Roll plates (for which ONLY the image is generated in Nano Banana 2.1 and NO video clip is created in Flow because optical camera motion is rendered locally in our editor), and only after delivering that report proceed with generation.
Rename every generated image and video clip using these exact prefixes followed by the 2-digit scene number (01 to 09 for 1 to 9) and the first 6 words of its pasted prompt: start initial clip images with "Inicial_##_" (e.g., Inicial_01_create_an_image_in_16_9), start [IMAGE ONLY — DO NOT GENERATE VIDEO CLIP] Static B-Roll plates with "Broll_##_" (e.g., Broll_18_create_an_image_in_16_9), and start video clips with "Clip_##_" (e.g., Clip_01_create_a_cinematic_8_second_video).
Use Omni 1.1 Flash exclusively for video clips featuring people and use Veo 3.1 - Lite [Lower Priority] for all remaining video clips without people; use nano banana 2.1 for the initial images of each clip and for all [IMAGE ONLY — DO NOT GENERATE VIDEO CLIP] Static B-Roll plates.
Create the images first and then the video clips using each image as the starting frame, EXCEPT for any prompt tagged [IMAGE ONLY — DO NOT GENERATE VIDEO CLIP] [B-Roll: STATIC_...]: for those B-Roll scenes, generate ONLY the high-resolution Nano Banana 2.1 still image and strictly SKIP creating any video clip in Flow.
Use the @Reference images of people and locations ONLY when generating the initial images ("Inicial_##") with Nano Banana 2.1 to maintain visual fidelity; when generating each video clip ("Clip_##"), use ONLY its corresponding generated initial image ("Inicial_##") as the starting frame without re-attaching @Person reference sheets or real historical person names.
Never make shot changes in any clip (except in that specific clip where the prompt explicitly instructs making two 5-second shots each because the narration voice changed scenes) and ensure video clips have no disappearances or transformations; the created initial image will be used as the start of each clip.
Divide creation into batches of 10.
rename everything adding _ as the blank spaces between words and replacing any colons (:) or hyphens with _ (never use : in filenames)
from 1 to 9 change the scene number to 01 to 09 (e.g., Inicial_01, Clip_01, Broll_08)`;

function sanitizeOperationalHeaderServer(
  operationalHeader?: string,
  engine: 'HYBRID_PEOPLE_OMNI_REST_LOWER' | 'VEO_3_1_LITE_LOWER_PRIORITY' | 'OMNI_1_1_FLASH' = 'HYBRID_PEOPLE_OMNI_REST_LOWER'
): string {
  const engineLine =
    engine === 'HYBRID_PEOPLE_OMNI_REST_LOWER'
      ? 'Use Omni 1.1 Flash exclusively for video clips featuring people and use Veo 3.1 - Lite [Lower Priority] for all remaining video clips without people; use nano banana 2.1 for the initial images of each clip and for all [IMAGE ONLY — DO NOT GENERATE VIDEO CLIP] Static B-Roll plates.'
      : engine === 'OMNI_1_1_FLASH'
      ? 'Use Omni 1.1 Flash for videos and nano banana 2.1 for the initial images of each clip and for all [IMAGE ONLY — DO NOT GENERATE VIDEO CLIP] Static B-Roll plates.'
      : 'Use Veo 3.1 - Lite [Lower Priority] for videos and nano banana 2.1 for the initial images of each clip and for all [IMAGE ONLY — DO NOT GENERATE VIDEO CLIP] Static B-Roll plates.';

  const trimmed = String(operationalHeader || '').trim();
  const isCorruptedOrIncomplete =
    !trimmed ||
    /^Act[uú]a como un historiador/i.test(trimmed) ||
    /Cambia\s+los\s+nombres/i.test(trimmed) ||
    /del\s+1\s+al\s+10/i.test(trimmed) ||
    /Cuando\s+se\s+hayan\s+generado\s+todas\s+las\s+im[áa]genes\s+me\s+avisas/i.test(trimmed) ||
    /keep\s+the\s+starting\s+image\s+100%\s+frozen\s+as\s+a\s+still\s+documentary\s+B-roll\s+plate\s+with\s+zero\s+internal\s+object\s+animation/i.test(trimmed) ||
    !/^Act as a (?:professional |master )?historian/i.test(trimmed) ||
    !/pre-generation\s+report/i.test(trimmed) ||
    !/IMAGE\s+ONLY\s*[—–-]?\s*DO\s+NOT\s+GENERATE\s+VIDEO\s+CLIP/i.test(trimmed) ||
    !/Inicial_/i.test(trimmed) ||
    !/Broll_/i.test(trimmed) ||
    !/Clip_/i.test(trimmed) ||
    !/(?:literal first 6 words|first 6 literal words|first 6 words)/i.test(trimmed) ||
    !/never use : in filenames/i.test(trimmed) ||
    !/batches of 10/i.test(trimmed) ||
    !trimmed.includes('01 to 09');
  const base = isCorruptedOrIncomplete ? DEFAULT_OPERATIONAL_HEADER_SERVER : trimmed;
  const lineRegex =
    /(?:Use|Usa)\s+(?:omni\s*(?:1\.1\s*)?flash|veo\s*3\.1\s*(?:-\s*lite\s*\[lower\s*priority\])?|lower\s*priority)[^\n]*(?:Static\s+B-Roll\s+plates|for\s+(?:the\s+)?(?:initial|starting(?:\s+keyframe)?)\s+images\s+of\s+each\s+clip|para\s+im[áa]genes\s+iniciales\s+de\s+cada\s+clip)\.?/gi;
  return lineRegex.test(base) ? base.replace(lineRegex, engineLine) : DEFAULT_OPERATIONAL_HEADER_SERVER.replace(lineRegex, engineLine);
}

function ensureOperationalHeaderText(
  rawText: string,
  operationalHeader?: string,
  engine: 'HYBRID_PEOPLE_OMNI_REST_LOWER' | 'VEO_3_1_LITE_LOWER_PRIORITY' | 'OMNI_1_1_FLASH' = 'HYBRID_PEOPLE_OMNI_REST_LOWER'
): string {
  const header = sanitizeOperationalHeaderServer(operationalHeader, engine);
  const trimmed = (rawText || '').trim();
  if (!trimmed) return '';

  const firstPromptIdx = trimmed.search(/(?:^|\n)\s*(?:Image|Imagen|Clip)\s*\[?0*1\]?\s*[:(\-]/i);
  if (firstPromptIdx >= 0) {
    const bodyOnly = trimmed.slice(firstPromptIdx).trim();
    return bodyOnly ? `${header}\n\n${bodyOnly}` : header;
  }

  if (
    /^Act as a (?:professional |master )?historian/i.test(trimmed) &&
    /pre-generation\s+report|how\s+many\s+clips\s+will\s+be\s+(?:made|generated)\s+with\s+Omni/i.test(trimmed) &&
    /Static\s+B-Roll|\[B-Roll:\s*STATIC_/i.test(trimmed) &&
    /(?:literal first 6 words|first 6 literal words|first 6 words)/i.test(trimmed) &&
    trimmed.includes('01 to 09')
  ) {
    return trimmed;
  }
  if (
    /^Act[uú]a como un historiador/i.test(trimmed) ||
    /^Act as a (?:professional |master )?historian/i.test(trimmed) ||
    /del\s+1\s+al\s+10|Cuando\s+se\s+hayan\s+generado\s+todas\s+las\s+im[áa]genes/i.test(trimmed)
  ) {
    return header;
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
          if (doc) {
            const eng =
              doc.flowVideoEngine === 'OMNI_1_1_FLASH' || doc.flowVideoEngine === 'VEO_3_1_LITE_LOWER_PRIORITY'
                ? doc.flowVideoEngine
                : 'HYBRID_PEOPLE_OMNI_REST_LOWER';
            const cleanHeader = sanitizeOperationalHeaderServer(doc.operationalHeader, eng);
            if (doc.operationalHeader && cleanHeader !== doc.operationalHeader) {
              doc.operationalHeader = cleanHeader;
              modified = true;
            }
            if (typeof doc.rawClipsText === 'string' && doc.rawClipsText.trim()) {
              const fixed = ensureOperationalHeaderText(doc.rawClipsText, cleanHeader, eng);
              if (fixed !== doc.rawClipsText) {
                doc.rawClipsText = fixed;
                modified = true;
              }
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

function isServerNonPortableAudioUrl(rawUrl?: any): boolean {
  if (!rawUrl || typeof rawUrl !== 'string') return true;
  const u = rawUrl.trim();
  if (!u || u.startsWith('blob:')) return true;
  return (
    /^https?:\/\/(?:localhost|127\.0\.0\.1|0\.0\.0\.0|\[::1\]|192\.168\.\d+\.\d+|10\.\d+\.\d+\.\d+|172\.(?:1[6-9]|2\d|3[01])\.\d+\.\d+)(?::\d+)?(?:\/|$)/i.test(
      u
    ) ||
    /\/api\/flow\/serve-folder-file\b/i.test(u) ||
    /^(?:file:\/\/|\/Users\/|\/private\/)/i.test(u)
  );
}

function normalizeServerPortableAudioUrl(rawUrl?: any): string {
  if (!rawUrl || typeof rawUrl !== 'string') return '';
  let u = rawUrl
    .trim()
    .replace(/^(?:\.\/|\/+)?Huellas-Master\/(?=tts-files\/)/i, '')
    .replace(/^(?:\.\/|\/+)?(?:docs|data)\/(?=tts-files\/)/i, '')
    .replace(/^\.\/(?=tts-files\/)/i, '');
  if (u.startsWith('/tts-files/')) u = u.slice(1);
  if (/^tts-files\/tts-video-77-penicilina\.mp3(?:\?.*)?$/i.test(u)) {
    return 'tts-files/tts-video-77-penicilina.mp3?v=nodup3';
  }
  return u;
}

function sanitizeServerDocAudioUrls(doc: any): any {
  if (!doc || typeof doc !== 'object') return doc;
  const rawTracks = Array.isArray(doc.audioTracks) ? doc.audioTracks : [];
  const folderDonor = rawTracks.find(
    (t: any) =>
      (String(t?.id || '').startsWith('tts-folder-') || isServerNonPortableAudioUrl(t?.audioUrl)) &&
      Array.isArray(t?.segmentTimings) &&
      t.segmentTimings.length > 0
  );
  const cleanedTracks = rawTracks
    .filter((t: any) => !String(t?.id || '').startsWith('tts-folder-'))
    .map((t: any) => {
      const cleanUrl = normalizeServerPortableAudioUrl(t?.audioUrl);
      if (isServerNonPortableAudioUrl(cleanUrl)) {
        return { ...t, audioUrl: '' };
      }
      const nextTrack = cleanUrl !== t?.audioUrl ? { ...t, audioUrl: cleanUrl } : { ...t };
      if (
        folderDonor &&
        (!Array.isArray(nextTrack.segmentTimings) || nextTrack.segmentTimings.length === 0) &&
        Math.abs((Number(nextTrack.duration) || 0) - (Number(folderDonor.duration) || 0)) <= 6
      ) {
        nextTrack.segmentTimings = folderDonor.segmentTimings;
        nextTrack.duration = nextTrack.duration || folderDonor.duration;
      }
      return nextTrack;
    });
  const normMaster = normalizeServerPortableAudioUrl(doc.masterAudioUrl);
  let cleanedMaster = isServerNonPortableAudioUrl(normMaster) ? '' : normMaster;
  if (!cleanedMaster) {
    const portableTrack = cleanedTracks.find(
      (t: any) => t?.audioUrl && !isServerNonPortableAudioUrl(t.audioUrl)
    );
    if (portableTrack?.audioUrl) {
      cleanedMaster = portableTrack.audioUrl;
    } else if (doc.id === 'doc-video-77-huellas') {
      cleanedMaster = 'tts-files/tts-video-77-penicilina.mp3?v=nodup3';
    }
  }
  return {
    ...doc,
    masterAudioUrl: cleanedMaster,
    audioTracks: cleanedTracks,
  };
}

function writeFileAtomicUtf8(targetPath: string, content: string) {
  const dir = path.dirname(targetPath);
  const tmpPath = path.join(dir, `${path.basename(targetPath)}.tmp.${process.pid}.${Date.now()}`);
  fs.writeFileSync(tmpPath, content, 'utf8');
  fs.renameSync(tmpPath, targetPath);
}

function writeDocumentaries(list: any[], skipCloudPush = false) {
  const sanitizedList = Array.isArray(list) ? list.map(sanitizeServerDocAudioUrls) : list;
  const jsonStr = JSON.stringify(sanitizedList, null, 2);
  try {
    const currentDisk = fs.existsSync(DOCS_FILE) ? fs.readFileSync(DOCS_FILE, 'utf8') : '';
    if (currentDisk !== jsonStr) {
      writeFileAtomicUtf8(DOCS_FILE, jsonStr);
    }
  } catch {
    writeFileAtomicUtf8(DOCS_FILE, jsonStr);
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
        writeFileAtomicUtf8(docsTarget, jsonStr);
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

const SERVER_AUTO_SKELETON_RE =
  /\((?:Ruta Principal(?:\s+Completa)?|Arco Integral|Tema Central)[^)]*\)|Authentic historical visual scene for|Create an image of a .* shot in \(Ruta Principal|Create an image of escena cinematogr[aá]fica documental correspondiente a:|depicting the historical documentary scene with dramatic cinematic lighting, historical accuracy, photorealistic 8k film still/i;

function isServerAutoSkeletonPromptText(text?: any): boolean {
  if (!text || typeof text !== 'string') return false;
  const t = text.trim();
  if (!t) return false;
  return SERVER_AUTO_SKELETON_RE.test(t);
}

function stripServerOperationalHeaderOnly(raw?: any): string {
  const trimmed = String(raw || '').trim();
  if (!trimmed) return '';
  const firstPromptIdx = trimmed.search(
    /(?:^|\n)\s*(?:[#*\-\d.)\s]*)(?:Image|Imagen|Clip)\s*\[?0*\d+\]?\s*(?:\([^)]*\))?\s*[:(\-–]/i
  );
  if (firstPromptIdx >= 0) {
    return trimmed.slice(firstPromptIdx).trim();
  }
  if (
    /^(?:Act[uú]a como un historiador|Act as a (?:professional |master )?historian|Before generating anything)/i.test(
      trimmed
    ) ||
    /Cambia\s+los\s+nombres\s+de\s+los\s+clips/i.test(trimmed)
  ) {
    return '';
  }
  return trimmed;
}

function getServerRawClipsQualityTier(raw?: any): 0 | 1 | 2 {
  const body = stripServerOperationalHeaderOnly(raw);
  if (!body) return 0;
  if (isServerAutoSkeletonPromptText(body)) return 1;
  return 2;
}

function isServerClipRealAuthored(clip?: any): boolean {
  if (!clip || typeof clip !== 'object') return false;
  const img = String(clip.imagePrompt || '').trim();
  const vid = String(clip.videoPrompt || '').trim();
  if (!img && !vid) return false;
  if (isServerAutoSkeletonPromptText(img) || isServerAutoSkeletonPromptText(vid)) return false;
  return true;
}

function countServerRealAuthoredClips(clips?: any): number {
  if (!Array.isArray(clips) || clips.length === 0) return 0;
  let count = 0;
  for (const c of clips) {
    if (isServerClipRealAuthored(c)) count++;
  }
  return count;
}

function countServerAuthoredBlocksInRawText(raw?: any): number {
  const body = stripServerOperationalHeaderOnly(raw);
  if (!body || isServerAutoSkeletonPromptText(body)) return 0;
  const uniqueSceneNums = new Set<number>();
  const re =
    /(?:^|\n)\s*(?:[#*\-\d.)\s]*)(?:Clip|Image|Imagen)\s*\[?0*(\d+)\]?\s*(?:\([^)]*\))?\s*[:\-–]/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(body)) !== null) {
    const n = parseInt(m[1], 10);
    if (n > 0) uniqueSceneNums.add(n);
  }
  return uniqueSceneNums.size;
}

function sanitizeServerClipSkeleton(clip: any): any {
  if (!clip || typeof clip !== 'object') return clip;
  const badImg = isServerAutoSkeletonPromptText(clip.imagePrompt);
  const badVid = isServerAutoSkeletonPromptText(clip.videoPrompt);
  if (!badImg && !badVid) return clip;
  return {
    ...clip,
    ...(badImg ? { imagePrompt: '' } : {}),
    ...(badVid ? { videoPrompt: '' } : {}),
  };
}

function mergeServerClipsPreservingAuthored(
  winnerClipsRaw: any,
  otherClipsRaw: any,
  rawClipsLegitimatelyTombstoned = false
): any[] {
  const wClips = Array.isArray(winnerClipsRaw)
    ? winnerClipsRaw.map(sanitizeServerClipSkeleton)
    : [];
  const oClips = Array.isArray(otherClipsRaw)
    ? otherClipsRaw.map(sanitizeServerClipSkeleton)
    : [];
  if (wClips.length === 0) {
    return !rawClipsLegitimatelyTombstoned && oClips.length > 0 ? oClips : [];
  }
  if (oClips.length === 0) return wClips;

  const otherClipByNum = new Map<number, any>();
  for (const c of oClips) {
    if (c && typeof c.clipNumber === 'number') {
      otherClipByNum.set(c.clipNumber, c);
    }
  }
  return wClips.map((c: any) => {
    const o = otherClipByNum.get(c.clipNumber);
    if (!o) return c;
    const wHasReal = isServerClipRealAuthored(c);
    const oHasReal = isServerClipRealAuthored(o);
    const rescuePrompts = !wHasReal && oHasReal && !rawClipsLegitimatelyTombstoned;
    const resolvedIsBroll = rescuePrompts
      ? typeof o.isStaticBroll === 'boolean'
        ? o.isStaticBroll
        : c.isStaticBroll
      : c.isStaticBroll;
    return {
      ...c,
      ...(rescuePrompts
        ? {
            imagePrompt: o.imagePrompt || c.imagePrompt,
            videoPrompt: resolvedIsBroll ? '' : o.videoPrompt || c.videoPrompt,
            previousVideoPrompt: o.previousVideoPrompt || c.previousVideoPrompt,
            isStaticBroll: resolvedIsBroll,
            brollCameraMotion: o.brollCameraMotion || c.brollCameraMotion,
            flowClipEngine: o.flowClipEngine || c.flowClipEngine,
            cameraSelection: c.cameraSelection || o.cameraSelection,
            visualExplanation: c.visualExplanation || o.visualExplanation,
          }
        : resolvedIsBroll
          ? {
              videoPrompt: '',
              previousVideoPrompt: c.previousVideoPrompt || o.previousVideoPrompt,
            }
          : {}),
      reviewedForEditor:
        c.reviewedForEditor !== undefined
          ? Boolean(c.reviewedForEditor || o.reviewedForEditor)
          : Boolean(o.reviewedForEditor),
      recreated: Boolean(c.recreated || o.recreated),
      videoReady: Boolean(c.videoReady || o.videoReady),
      imageReady: Boolean(c.imageReady || o.imageReady),
      videoSavedFileName: c.videoSavedFileName || o.videoSavedFileName,
      videoFrames:
        Array.isArray(c.videoFrames) && c.videoFrames.length > 0 ? c.videoFrames : o.videoFrames,
    };
  });
}

function mergeServerDocObjects(winner: any, other: any) {
  if (!winner || !other) return winner || other;
  let baseWinner = { ...winner };
  let outerRawClipsLegitimatelyTombstoned = false;
  try {
    const wCmdRaw = winner.promptConfig?.REMOTE_RENAME_COMMAND_JSON;
    const oCmdRaw = other.promptConfig?.REMOTE_RENAME_COMMAND_JSON;
    if (oCmdRaw) {
      const oCmd = JSON.parse(oCmdRaw);
      const wCmd = wCmdRaw ? JSON.parse(wCmdRaw) : null;
      const oReqAt = Number(oCmd?.requestedAt || 0);
      const wReqAt = Number(wCmd?.requestedAt || 0);
      const wAckId = winner.promptConfig?.REMOTE_RENAME_ACK_ID || '';
      if (oReqAt > wReqAt && oCmd?.commandId && oCmd.commandId !== wAckId) {
        const cleanTarget = String(oCmd.newName || other.title || '').trim();
        baseWinner = {
          ...baseWinner,
          ...(cleanTarget
            ? {
                title: cleanTarget,
                downloadFolderName: cleanTarget,
                geminiChatTitle: cleanTarget,
              }
            : {}),
          promptConfig: {
            ...(baseWinner.promptConfig || {}),
            REMOTE_RENAME_COMMAND_JSON: oCmdRaw,
          },
        };
      }
    }
  } catch {}
  try {
    const oStage = other.promptConfig?.REMOTE_GEMINI_STAGE_COMMAND_JSON;
    const wStage = baseWinner.promptConfig?.REMOTE_GEMINI_STAGE_COMMAND_JSON;
    const reqAt = (r: any) => {
      try {
        return Number(JSON.parse(r)?.requestedAt || 0);
      } catch {
        return 0;
      }
    };
    const pc: any = { ...(baseWinner.promptConfig || {}) };
    if (oStage && reqAt(oStage) > reqAt(wStage)) pc.REMOTE_GEMINI_STAGE_COMMAND_JSON = oStage;
    for (const k of ['REMOTE_GEMINI_STAGE_ACK_ID', 'REMOTE_GEMINI_STAGE_STATUS']) {
      if (!pc[k] && other.promptConfig?.[k]) pc[k] = other.promptConfig[k];
    }
    baseWinner = { ...baseWinner, promptConfig: pc };
    // "Limpiar Etapa 1" tombstone: never resurrect Stage 1 texts from a copy saved before the clear
    const toMs = (v: any) => (typeof v === 'number' ? v : Date.parse(String(v || '')) || Number(v) || 0);
    const clearedAt = Math.max(
      Number(baseWinner.promptConfig?.STAGE1_CLEARED_AT || 0),
      Number(other.promptConfig?.STAGE1_CLEARED_AT || 0)
    );
    if (clearedAt > 0) {
      baseWinner.promptConfig = { ...(baseWinner.promptConfig || {}), STAGE1_CLEARED_AT: String(clearedAt) };
    }
    const otherSavedMs = toMs(other.updatedAt || other.createdAt);
    const stage1Tombstoned = clearedAt > 0 && clearedAt >= otherSavedMs;
    const promptsRestoredAt = Math.max(
      Number(baseWinner.promptConfig?.PROMPTS_RESTORED_AT || 0),
      Number(other.promptConfig?.PROMPTS_RESTORED_AT || 0)
    );
    if (promptsRestoredAt > 0) {
      baseWinner.promptConfig = {
        ...(baseWinner.promptConfig || {}),
        PROMPTS_RESTORED_AT: String(promptsRestoredAt),
      };
    }
    let rawClipsLegitimatelyTombstoned = false;
    for (const k of [
      'deepResearchResult',
      'deepResearchPrompt',
      'sectionsStructure',
      'voiceoverScript',
      'correctedSrt',
      'thumbnailPrompt',
      'thumbnailTextOverlay',
      'rawReferencePrompts',
      'clip1OptionsRaw',
      'clip1Line1LocationTime',
      'clip1Line2Hook',
      'rawClipsText',
      'rawSunoText',
      'rawYoutubeMetadata',
      'rawFacebookMetadata',
      'pinnedComment',
      'youtubeTags',
      'publishTitle',
    ]) {
      const fieldClearedKey = `FIELD_CLEARED_AT_${k}`;
      let fieldClearedAt = Math.max(
        Number(baseWinner.promptConfig?.[fieldClearedKey] || 0),
        Number(other.promptConfig?.[fieldClearedKey] || 0)
      );
      if (k === 'rawClipsText' && promptsRestoredAt > 0 && fieldClearedAt <= promptsRestoredAt) {
        fieldClearedAt = 0;
        baseWinner.promptConfig = {
          ...(baseWinner.promptConfig || {}),
          [fieldClearedKey]: '0',
          PROMPTS_RESTORED_AT: String(promptsRestoredAt),
        };
      } else if (fieldClearedAt > 0) {
        baseWinner.promptConfig = {
          ...(baseWinner.promptConfig || {}),
          [fieldClearedKey]: String(fieldClearedAt),
        };
      }
      const fieldTombstoned =
        fieldClearedAt > 0 &&
        fieldClearedAt >= otherSavedMs &&
        (k !== 'rawClipsText' || fieldClearedAt > promptsRestoredAt);
      if (k === 'rawClipsText') {
        rawClipsLegitimatelyTombstoned = fieldTombstoned;
        outerRawClipsLegitimatelyTombstoned = fieldTombstoned;
      }
      if (fieldTombstoned || (stage1Tombstoned && ['deepResearchResult', 'deepResearchPrompt', 'sectionsStructure'].includes(k))) continue;
      const wv = baseWinner[k];
      const ov = other[k];
      if (k === 'thumbnailPrompt') {
        const isBadThumb = (v: any) =>
          /\((?:Tema Central|Arco Integral|Ruta Principal|Opci[oó]n\s*\d+|F[oó]rmula Exacta)[^)]*\)\s*:|—\s*(?:Recomendada|Arco hist[oó]rico completo|Escenario hist[oó]rico principal)|\[DISPARADOR_[ABC]\]|\bDESCRIPCI[OÓ]N\s*:|enigmatic forbidden historical detail or shadowy betrayal from this exact story/i.test(
            String(v || '')
          );
        const wClean = wv && !isBadThumb(wv) ? String(wv) : '';
        const oClean = ov && !isBadThumb(ov) ? String(ov) : '';
        baseWinner.thumbnailPrompt = wClean || oClean || '';
        continue;
      }
      if (k === 'rawClipsText') {
        const wTier = getServerRawClipsQualityTier(wv);
        const oTier = getServerRawClipsQualityTier(ov);
        if (wTier === 1 && oTier === 2) {
          baseWinner.rawClipsText = ov;
          if (!baseWinner.operationalHeader && other.operationalHeader) {
            baseWinner.operationalHeader = other.operationalHeader;
          }
        } else if (wTier === 1 && oTier < 2) {
          baseWinner.rawClipsText = '';
        } else if (wTier === 0 && oTier === 2) {
          baseWinner.rawClipsText = ov;
          if (!baseWinner.operationalHeader && other.operationalHeader) {
            baseWinner.operationalHeader = other.operationalHeader;
          }
        } else if (wTier === 2 && oTier === 2) {
          const wBlocks = countServerAuthoredBlocksInRawText(wv);
          const oBlocks = countServerAuthoredBlocksInRawText(ov);
          const wHasImgOnly = /\[IMAGE\s+ONLY\s*[—–-]?\s*DO\s+NOT\s+GENERATE\s+VIDEO\s+CLIP\]/i.test(
            String(wv || '')
          );
          const oHasImgOnly = /\[IMAGE\s+ONLY\s*[—–-]?\s*DO\s+NOT\s+GENERATE\s+VIDEO\s+CLIP\]/i.test(
            String(ov || '')
          );
          if (!wHasImgOnly && oHasImgOnly && oBlocks >= Math.floor(wBlocks * 0.9)) {
            baseWinner.rawClipsText = ov;
            if (other.operationalHeader) {
              baseWinner.operationalHeader = other.operationalHeader;
            }
          } else if (oBlocks > wBlocks && wBlocks < Math.floor(oBlocks * 0.5)) {
            baseWinner.rawClipsText = ov;
          }
        }
        continue;
      }
      if ((!wv || !String(wv).trim()) && ov && String(ov).trim()) baseWinner[k] = ov;
    }
    if (
      (!Array.isArray(baseWinner.thumbnailPsychTriggers) || baseWinner.thumbnailPsychTriggers.length === 0) &&
      Array.isArray(other.thumbnailPsychTriggers) &&
      other.thumbnailPsychTriggers.length > 0
    ) {
      baseWinner.thumbnailPsychTriggers = other.thumbnailPsychTriggers;
    }
    if (
      (!Array.isArray(baseWinner.thumbnailTextOptions) || baseWinner.thumbnailTextOptions.length === 0) &&
      Array.isArray(other.thumbnailTextOptions) &&
      other.thumbnailTextOptions.length > 0
    ) {
      baseWinner.thumbnailTextOptions = other.thumbnailTextOptions;
    }
    if (!baseWinner.thumbnailPsychVariant && other.thumbnailPsychVariant) {
      baseWinner.thumbnailPsychVariant = other.thumbnailPsychVariant;
    }
    if (
      (!baseWinner.thumbnailImageUrl || !String(baseWinner.thumbnailImageUrl).trim()) &&
      other.thumbnailImageUrl &&
      String(other.thumbnailImageUrl).trim()
    ) {
      baseWinner.thumbnailImageUrl = other.thumbnailImageUrl;
      if (other.thumbnailReady) baseWinner.thumbnailReady = true;
    }
    if (
      (!baseWinner.thumbnailHorizontalImageUrl || !String(baseWinner.thumbnailHorizontalImageUrl).trim()) &&
      other.thumbnailHorizontalImageUrl &&
      String(other.thumbnailHorizontalImageUrl).trim()
    ) {
      baseWinner.thumbnailHorizontalImageUrl = other.thumbnailHorizontalImageUrl;
      if (other.thumbnailReady) baseWinner.thumbnailReady = true;
    }
    if (
      (!baseWinner.thumbnailVerticalImageUrl || !String(baseWinner.thumbnailVerticalImageUrl).trim()) &&
      other.thumbnailVerticalImageUrl &&
      String(other.thumbnailVerticalImageUrl).trim()
    ) {
      baseWinner.thumbnailVerticalImageUrl = other.thumbnailVerticalImageUrl;
      if (other.thumbnailReady) baseWinner.thumbnailReady = true;
    }

    // Preserve linked Gemini Main & Deep Research chat URLs across server merges
    const winMainUrl = String(baseWinner.geminiChatUrl || baseWinner.promptConfig?.GEMINI_CHAT_URL || '').trim();
    const othMainUrl = String(other.geminiChatUrl || other.promptConfig?.GEMINI_CHAT_URL || '').trim();
    const mergedMainUrl = winMainUrl || othMainUrl;

    const winDeepUrl = String(
      baseWinner.geminiDeepResearchChatUrl || baseWinner.promptConfig?.GEMINI_DEEP_RESEARCH_CHAT_URL || ''
    ).trim();
    const othDeepUrl = String(
      other.geminiDeepResearchChatUrl || other.promptConfig?.GEMINI_DEEP_RESEARCH_CHAT_URL || ''
    ).trim();
    let mergedDeepUrl = winDeepUrl || othDeepUrl;
    if (mergedMainUrl && mergedDeepUrl && mergedMainUrl === mergedDeepUrl) {
      mergedDeepUrl = '';
    }
    if (mergedMainUrl) {
      baseWinner.geminiChatUrl = mergedMainUrl;
      baseWinner.promptConfig = { ...(baseWinner.promptConfig || {}), GEMINI_CHAT_URL: mergedMainUrl };
    }
    if (mergedDeepUrl) {
      baseWinner.geminiDeepResearchChatUrl = mergedDeepUrl;
      baseWinner.promptConfig = {
        ...(baseWinner.promptConfig || {}),
        GEMINI_DEEP_RESEARCH_CHAT_URL: mergedDeepUrl,
      };
    }
    if ((!baseWinner.geminiChatTitle || !String(baseWinner.geminiChatTitle).trim()) && other.geminiChatTitle) {
      baseWinner.geminiChatTitle = other.geminiChatTitle;
    }
    const wCleanDoc = sanitizeServerDocAudioUrls(baseWinner);
    const oCleanDoc = sanitizeServerDocAudioUrls(other);
    baseWinner.masterAudioUrl = wCleanDoc.masterAudioUrl || oCleanDoc.masterAudioUrl || '';
    const wPortableTracks = Array.isArray(wCleanDoc.audioTracks)
      ? wCleanDoc.audioTracks.filter((t: any) => t?.audioUrl)
      : [];
    const oPortableTracks = Array.isArray(oCleanDoc.audioTracks)
      ? oCleanDoc.audioTracks.filter((t: any) => t?.audioUrl)
      : [];
    baseWinner.audioTracks =
      wPortableTracks.length > 0
        ? wCleanDoc.audioTracks
        : oPortableTracks.length > 0
        ? oCleanDoc.audioTracks
        : wCleanDoc.audioTracks || [];
  } catch {}
  const mergedClips = mergeServerClipsPreservingAuthored(
    baseWinner.clips,
    other.clips,
    outerRawClipsLegitimatelyTombstoned
  );
  return { ...baseWinner, clips: mergedClips };
}

function stripHeavyMediaForGitHubServer(list: any[], stripReferenceImages = false): any[] {
  return (list || []).map(sanitizeServerDocAudioUrls).map((doc: any) => ({
    ...doc,
    ...(stripReferenceImages &&
    typeof doc.thumbnailImageUrl === 'string' &&
    doc.thumbnailImageUrl.startsWith('data:') &&
    doc.thumbnailImageUrl.length > 60000
      ? { thumbnailImageUrl: '' }
      : {}),
    ...(stripReferenceImages &&
    typeof doc.thumbnailHorizontalImageUrl === 'string' &&
    doc.thumbnailHorizontalImageUrl.startsWith('data:') &&
    doc.thumbnailHorizontalImageUrl.length > 60000
      ? { thumbnailHorizontalImageUrl: '' }
      : {}),
    ...(stripReferenceImages &&
    typeof doc.thumbnailVerticalImageUrl === 'string' &&
    doc.thumbnailVerticalImageUrl.startsWith('data:') &&
    doc.thumbnailVerticalImageUrl.length > 60000
      ? { thumbnailVerticalImageUrl: '' }
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
    let jsonStr = JSON.stringify(stripHeavyMediaForGitHubServer(freshLocalList, false), null, 2);
    if (jsonStr.length > 3500000) {
      jsonStr = JSON.stringify(stripHeavyMediaForGitHubServer(freshLocalList, true), null, 2);
    }
    if (jsonStr === lastPushedGitHubJson) {
      return { synced: true, total: freshLocalList.length };
    }
    lastPushedGitHubJson = jsonStr;
    const headers: Record<string, string> = {
      Accept: 'application/vnd.github+json',
      Authorization: `token ${token}`,
      'Content-Type': 'application/json',
      'User-Agent': 'HuellasMaster-Studio',
    };

    try {
      const refRes = await fetch(
        `https://api.github.com/repos/${GITHUB_OWNER}/${GITHUB_REPO}/git/ref/heads/${GITHUB_BRANCH}`,
        { headers }
      );
      if (refRes.ok) {
        const refData: any = await refRes.json();
        const latestCommitSha = refData?.object?.sha;
        if (latestCommitSha) {
          const commitRes = await fetch(
            `https://api.github.com/repos/${GITHUB_OWNER}/${GITHUB_REPO}/git/commits/${latestCommitSha}`,
            { headers }
          );
          const commitData: any = await commitRes.json();
          const baseTreeSha = commitData?.tree?.sha;

          const blobRes = await fetch(
            `https://api.github.com/repos/${GITHUB_OWNER}/${GITHUB_REPO}/git/blobs`,
            {
              method: 'POST',
              headers,
              body: JSON.stringify({ content: jsonStr, encoding: 'utf-8' }),
            }
          );
          const blobData: any = await blobRes.json();
          const newBlobSha = blobData?.sha;

          if (baseTreeSha && newBlobSha) {
            const treeRes = await fetch(
              `https://api.github.com/repos/${GITHUB_OWNER}/${GITHUB_REPO}/git/trees`,
              {
                method: 'POST',
                headers,
                body: JSON.stringify({
                  base_tree: baseTreeSha,
                  tree: [
                    { path: 'data/documentaries.json', mode: '100644', type: 'blob', sha: newBlobSha },
                    { path: 'docs/data/documentaries.json', mode: '100644', type: 'blob', sha: newBlobSha },
                  ],
                }),
              }
            );
            const treeData: any = await treeRes.json();
            if (treeData?.sha) {
              const newCommitRes = await fetch(
                `https://api.github.com/repos/${GITHUB_OWNER}/${GITHUB_REPO}/git/commits`,
                {
                  method: 'POST',
                  headers,
                  body: JSON.stringify({
                    message: `Sync documentaries.json (${freshLocalList.length} documentales)`,
                    tree: treeData.sha,
                    parents: [latestCommitSha],
                  }),
                }
              );
              const newCommitData: any = await newCommitRes.json();
              if (newCommitData?.sha) {
                const patchRes = await fetch(
                  `https://api.github.com/repos/${GITHUB_OWNER}/${GITHUB_REPO}/git/refs/heads/${GITHUB_BRANCH}`,
                  {
                    method: 'PATCH',
                    headers,
                    body: JSON.stringify({ sha: newCommitData.sha, force: false }),
                  }
                );
                if (patchRes.ok) {
                  return { synced: true, total: freshLocalList.length };
                }
              }
            }
          }
        }
      }
    } catch {}

    const encodedContent = Buffer.from(jsonStr, 'utf8').toString('base64');
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
      BROLL_ESTATICO_INTERVALO_MIN: '2',
      VOZ_NARRATIVA_EN_CLIPS: 'INCLUIR',
      UBICACION_INTRO_MARCA: 'INTRO_INICIO_00',
    },
    compiledMasterPrompt: body.compiledMasterPrompt || '',
    topic: body.topic || '',
    typology: body.typology ?? '',
    historicalTime: body.historicalTime || '',
    historicalLocation: body.historicalLocation || '',
    targetDurationSeconds: body.targetDurationSeconds || 900,
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
    thumbnailHorizontalImageUrl: body.thumbnailHorizontalImageUrl || '',
    thumbnailVerticalImageUrl: body.thumbnailVerticalImageUrl || '',
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
  const diskPromptsRestoredAt = Number(currentDiskDoc.promptConfig?.PROMPTS_RESTORED_AT || 0);
  const incPromptsRestoredAt = Number(incomingBody?.promptConfig?.PROMPTS_RESTORED_AT || 0);
  const effectivePromptsRestoredAt = Math.max(diskPromptsRestoredAt, incPromptsRestoredAt);
  const rawIncomingClearedAt = Number(incomingBody?.promptConfig?.FIELD_CLEARED_AT_rawClipsText || 0);
  const diskSavedMs = Date.parse(String(currentDiskDoc.updatedAt || '')) || 0;
  const hasValidExplicitPromptClear =
    rawIncomingClearedAt > 0 &&
    rawIncomingClearedAt > effectivePromptsRestoredAt &&
    rawIncomingClearedAt >= diskSavedMs - 5000;

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

    if (effectivePromptsRestoredAt > 0 || surgicalPatch.promptConfig) {
      const nextPc: Record<string, any> = {
        ...(currentDiskDoc.promptConfig || {}),
        ...(surgicalPatch.promptConfig || {}),
      };
      if (effectivePromptsRestoredAt > 0) {
        nextPc.PROMPTS_RESTORED_AT = String(effectivePromptsRestoredAt);
        const pcCleared = Number(nextPc.FIELD_CLEARED_AT_rawClipsText || 0);
        if (pcCleared > 0 && pcCleared <= effectivePromptsRestoredAt) {
          nextPc.FIELD_CLEARED_AT_rawClipsText = '0';
        }
      }
      surgicalPatch.promptConfig = nextPc;
    }

    if ('rawClipsText' in surgicalPatch) {
      const diskTier = getServerRawClipsQualityTier(currentDiskDoc.rawClipsText);
      const patchTier = getServerRawClipsQualityTier(surgicalPatch.rawClipsText);
      if (diskTier === 2 && patchTier < 2 && !hasValidExplicitPromptClear) {
        console.warn(
          `[ServerDataLossGuard] Blocked destructive PUT rawClipsText (tier ${patchTier}) over Tier 2 prompts on ${currentDiskDoc.id}`
        );
        delete surgicalPatch.rawClipsText;
      } else if (patchTier === 1) {
        surgicalPatch.rawClipsText = '';
      }
    }

    if ('clips' in surgicalPatch) {
      surgicalPatch.clips = mergeServerClipsPreservingAuthored(
        surgicalPatch.clips,
        currentDiskDoc.clips,
        hasValidExplicitPromptClear
      );
    }

    updated = {
      ...currentDiskDoc,
      ...surgicalPatch,
      id: currentDiskDoc.id,
      updatedAt: new Date().toISOString(),
    };
  } else {
    const mergedFull = mergeServerDocObjects(incomingBody, currentDiskDoc);
    updated = {
      ...mergedFull,
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
  if (hasEmbeddedC2paInAudioBytes(wavBuffer)) {
    const cleanedMaster = cleanMasterWavEmbeddedC2paInPlace(wavBuffer);
    if (cleanedMaster.cleanedBlocks > 0) {
      const { pcmBytes } = extractCleanPcmFromGeminiAudio(cleanedMaster.wavBytes, 24000);
      return Buffer.from(pcmBytes.buffer, pcmBytes.byteOffset, pcmBytes.byteLength);
    }
  }
  const { pcmBytes } = extractCleanPcmFromGeminiAudio(wavBuffer, 24000);
  return Buffer.from(pcmBytes.buffer, pcmBytes.byteOffset, pcmBytes.byteLength);
}

function applyMicroFade(pcmBuffer: Buffer, fadeSamples: number = 288): Buffer {
  const fadeMs = Math.max(8, Math.round((fadeSamples / 24000) * 1000));
  const polished = polishCleanTtsPcmBlock(pcmBuffer, 24000, fadeMs);
  return Buffer.from(polished.buffer, polished.byteOffset, polished.byteLength);
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

// Reconoce [1s], [2s], [3s], [1.5s], [1], [2], [3], [1}, [2}, {2s], [pausa: 2s], (pausa de 2s), [silencio: 2s], <break time="2s"/>
const UNIVERSAL_PAUSE_REGEX =
  /[\[{]\s*(?:(?:pausa|pause|silencio)(?:\s+de)?\s*:?\s*)?([0-9]{1,2}(?:[.,][0-9]+)?)\s*(s|seg|segundos?|ms|milisegundos?)?\s*[\]}]|[\[{]\s*(?:pausa|pause|silencio)\s*:?\s*[\]}]|\(\s*(?:pausa|pause|silencio)(?:\s+de)?\s*:?\s*([0-9]{1,2}(?:[.,][0-9]+)?)\s*(s|seg|segundos?|ms|milisegundos?)?\s*\)|<break\s+time=["']?([0-9]+(?:\.[0-9]+)?)(s|ms)["']?\s*\/?>/gi;

function splitServerOversizedTtsBlock(text: string, maxChars: number = 2800): string[] {
  const trimmed = (text || '').trim();
  if (!trimmed) return [];
  if (trimmed.length <= maxChars) return [trimmed];

  const sentences = trimmed
    .split(/(?<=[.!?…])\s+|\n{2,}/)
    .map((s) => s.trim())
    .filter(Boolean);

  const chunks: string[] = [];
  let current = '';
  for (const sent of sentences) {
    if (!current) {
      if (sent.length <= maxChars) {
        current = sent;
      } else {
        const words = sent.split(/\s+/);
        let wBuf = '';
        for (const w of words) {
          if (wBuf && wBuf.length + 1 + w.length > maxChars) {
            chunks.push(wBuf);
            wBuf = w;
          } else {
            wBuf = wBuf ? `${wBuf} ${w}` : w;
          }
        }
        current = wBuf;
      }
    } else if (current.length + 1 + sent.length <= maxChars) {
      current = `${current} ${sent}`;
    } else {
      chunks.push(current);
      current = sent;
    }
  }
  if (current) chunks.push(current);
  return chunks;
}

const serverTtsRequestTimestamps: number[] = [];
let serverTtsCooldownUntilMs = 0;
const SERVER_TTS_WINDOW_MS = 66000;
const SERVER_TTS_MAX_PER_WINDOW = 8;
const SERVER_TTS_MIN_SPACING_MS = 6800;

function settleServerTtsRateSlot(previousStamp: number): void {
  const settledAt = Date.now();
  const idx = serverTtsRequestTimestamps.indexOf(previousStamp);
  if (idx !== -1) {
    serverTtsRequestTimestamps[idx] = settledAt;
  } else {
    serverTtsRequestTimestamps.push(settledAt);
  }
  serverTtsRequestTimestamps.sort((a, b) => a - b);
}

async function acquireServerTtsRateSlot(): Promise<number> {
  while (true) {
    const now = Date.now();
    if (serverTtsCooldownUntilMs > now) {
      const cdWait = serverTtsCooldownUntilMs - now;
      console.log(
        `[VoxFlow Tier-1 Cooldown] Esperando ${(cdWait / 1000).toFixed(1)}s antes de continuar...`
      );
      await new Promise((r) => setTimeout(r, cdWait));
      continue;
    }
    while (
      serverTtsRequestTimestamps.length > 0 &&
      now - serverTtsRequestTimestamps[0] >= SERVER_TTS_WINDOW_MS
    ) {
      serverTtsRequestTimestamps.shift();
    }
    if (serverTtsRequestTimestamps.length >= SERVER_TTS_MAX_PER_WINDOW) {
      const waitMs = serverTtsRequestTimestamps[0] + SERVER_TTS_WINDOW_MS - now + 1200;
      if (waitMs > 0) {
        console.log(
          `[VoxFlow Tier-1 Pacer] Esperando ${(waitMs / 1000).toFixed(1)}s para respetar el límite de 10 RPM...`
        );
        await new Promise((r) => setTimeout(r, waitMs));
        continue;
      }
    }
    const lastTs =
      serverTtsRequestTimestamps.length > 0
        ? serverTtsRequestTimestamps[serverTtsRequestTimestamps.length - 1]
        : 0;
    const sinceLast = Date.now() - lastTs;
    if (lastTs > 0 && sinceLast < SERVER_TTS_MIN_SPACING_MS) {
      await new Promise((r) => setTimeout(r, SERVER_TTS_MIN_SPACING_MS - sinceLast));
      continue;
    }
    const stamp = Date.now();
    serverTtsRequestTimestamps.push(stamp);
    return stamp;
  }
}

function parseServerTtsRetryDelayMs(err: any, rateWaitCount: number): number {
  const msg = String(err?.message || err || '');
  const m = msg.match(/Please\s+retry\s+in\s+([0-9]+(?:\.[0-9]+)?)\s*s/i);
  if (m?.[1]) {
    const sec = parseFloat(m[1]);
    if (Number.isFinite(sec) && sec > 0) {
      return Math.min(95000, Math.max(12000, Math.ceil(sec * 1000) + 3500));
    }
  }
  return Math.min(75000, 22000 + Math.min(5, rateWaitCount) * 10000);
}

function cleanServerVoiceoverNarrationOnly(rawText: string): string {
  if (!rawText) return '';
  let s = String(rawText).replace(/\r\n/g, '\n').trim();
  s = s.replace(/^```(?:[a-zA-Z0-9_-]+)?\s*\n?/i, '').replace(/\n?```\s*$/i, '');
  s = s.replace(
    /\(\s*(?:\d{1,2}:\d{2}(?::\d{2})?(?:\s*[-–—a]\s*\d{1,2}:\d{2}(?::\d{2})?)?[^)]*|(?:Intro\s+Oficial|Outro\s+Oficial|Clip\s+\d+|Hook\s+Visual|Sin\s+voz|Entrada\s+(?:exacta\s+)?de\s+la\s+voz|Foley|SFX|Efecto\s+de\s+sonido|M[uú]sica\s+de\s+fondo|Sonido\s+(?:seco|ambiente)|Texto\s+en\s+pantalla|Fin\s+del\s+guion|Cierre\s+institucional)[^)]*)\s*\)/gi,
    ''
  );
  s = s.replace(
    /\[\s*(?:\d{1,2}:\d{2}(?::\d{2})?(?:\s*[-–—a]\s*\d{1,2}:\d{2}(?::\d{2})?)?\s*(?:\||[-–—:])[^[\]]*|(?:Intro\s+Oficial|Outro\s+Oficial|Clip\s+\d+|Hook\s+Visual|Sin\s+voz|Entrada\s+(?:exacta\s+)?de\s+la\s+voz|P[aá]rrafo\s+(?:\d+|final)|Slogan\s+(?:Completo|Corto)|Cierre\s+en\s+p[aá]rrafo|Foley|SFX|M[uú]sica|Texto\s+en\s+pantalla|Narrador|Voz\s+en\s+off|Locutor)[^[\]]*)\s*\]\s*:?\s*/gi,
    ''
  );
  const outLines: string[] = [];
  for (const rawLine of s.split('\n')) {
    let l = rawLine.trim();
    if (!l) continue;
    const plain = l.replace(/^#{1,6}\s+/, '').replace(/^\*+|\*+$/g, '').trim();
    if (
      /^(?:[-—*]+\s*)?(?:ETAPA\s+\d+|PASO\s+\d+[A-Z]?|GUION\s+DE\s+(?:LA\s+)?VOZ\s+EN\s+OFF|GUION\s+NARRATIVO|VOZ\s+EN\s+OFF\s+COMPLETA|LOCUCI[OÓ]N\s+DOCUMENTAL)(?:\s*[:—\-|(].*)?$/i.test(
        plain
      )
    ) {
      continue;
    }
    if (/^(?:BLOQUE|SECCI[OÓ]N|CAP[IÍ]TULO|PARTE)\s+\d+\s*(?:[:.\-—|(].*)?$/i.test(plain)) continue;
    if (/^ACTO\s+(?:[IVXLC]+|\d+)\s*(?:[:.\-—|(].*)?$/i.test(plain)) continue;
    if (/^[-—*_]{3,}$/.test(plain)) continue;
    if (/^\d{1,2}:\d{2}(?::\d{2})?(?:\s*[-–—a]\s*\d{1,2}:\d{2}(?::\d{2})?)?\s*(?:\|.*)?$/i.test(plain)) continue;
    if (
      /^(?:[-—*•]+\s*)?(?:Caracteres\s+Totales|Palabras\s+Totales|Conteo\s+de\s+(?:palabras|caracteres)|Extensi[oó]n\s+(?:total|estimada|aproximada|final)|Pausas\s+Narrativas\s*:|Duraci[oó]n\s+Total\s+Estimada|Tiempo\s+Neto\s+de\s+Voz|Reporte\s+al\s+pie|¿Deseas\s+(?:pasar|continuar|que\s+proceda|avanzar)|¿Est[aá]s\s+listo\s+para\s+(?:pasar|proceder)|Por\s+favor\s+confirma\s+si\s+el\s+guion)/i.test(
        plain
      )
    ) {
      continue;
    }
    l = l.replace(/^#{1,6}\s+/, '');
    l = l.replace(/^\s*(?:\*+)?(?:Narrador|Voz\s+en\s+[Oo]ff|Locutor|Audio|Voiceover)\s*(?:\*+)?\s*:\s*/i, '');
    l = l.replace(/^\s*\d{1,2}:\d{2}(?::\d{2})?(?:\s*[-–—]\s*\d{1,2}:\d{2}(?::\d{2})?)?\s*(?:\||[-–—:])\s*/, '');
    l = l.replace(/\*\*([^*]+)\*\*/g, '$1').replace(/\*([^*]+)\*/g, '$1').replace(/\s{2,}/g, ' ').trim();
    if (l) outLines.push(l);
  }
  return outLines.join('\n\n');
}

function parseTextWithPauses(rawText: string): TextOrPauseSegment[] {
  const sanitized = cleanServerVoiceoverNarrationOnly(rawText);
  if (!sanitized) return [];
  const pauseRegex = new RegExp(UNIVERSAL_PAUSE_REGEX.source, 'gi');
  const rawSegments: TextOrPauseSegment[] = [];
  let lastIndex = 0;
  let match: RegExpExecArray | null;

  while ((match = pauseRegex.exec(sanitized)) !== null) {
    const textBefore = sanitized.slice(lastIndex, match.index);
    if (textBefore.trim()) {
      rawSegments.push({ type: 'text', text: textBefore.trim() });
    }
    let durationSec = 1.5;
    if (match[1] !== undefined) {
      const val = parseFloat(match[1].replace(',', '.'));
      const unit = (match[2] || 's').toLowerCase();
      durationSec = unit.startsWith('ms') || unit.startsWith('mili') ? val / 1000 : val;
    } else if (match[3] !== undefined) {
      const val = parseFloat(match[3].replace(',', '.'));
      const unit = (match[4] || 's').toLowerCase();
      durationSec = unit.startsWith('ms') || unit.startsWith('mili') ? val / 1000 : val;
    } else if (match[5] !== undefined) {
      const val = parseFloat(match[5].replace(',', '.'));
      const unit = (match[6] || 's').toLowerCase();
      durationSec = unit === 'ms' ? val / 1000 : val;
    }
    durationSec = Math.max(0.1, Math.min(30, durationSec));
    rawSegments.push({ type: 'pause', duration: durationSec });
    lastIndex = match.index + match[0].length;
  }

  const remainingText = sanitized.slice(lastIndex);
  if (remainingText.trim()) {
    rawSegments.push({ type: 'text', text: remainingText.trim() });
  }

  const finalSegments: TextOrPauseSegment[] = [];
  for (const seg of rawSegments) {
    if (seg.type === 'text' && seg.text) {
      const subChunks = splitServerOversizedTtsBlock(seg.text, 2800);
      subChunks.forEach((sub, idx) => {
        if (idx > 0) {
          finalSegments.push({ type: 'pause', duration: 0.35 });
        }
        finalSegments.push({ type: 'text', text: sub });
      });
    } else {
      finalSegments.push(seg);
    }
  }
  return finalSegments;
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

  const maxHardAttempts = 6;
  const maxRateLimitWaits = 24;
  let hardAttempt = 0;
  let rateLimitWaits = 0;
  while (hardAttempt < maxHardAttempts && rateLimitWaits <= maxRateLimitWaits) {
    let slotStamp = 0;
    try {
      slotStamp = await acquireServerTtsRateSlot();
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
      settleServerTtsRateSlot(slotStamp);
      if (generation?.candidates?.[0]?.content?.parts?.[0]?.inlineData?.data) {
        const rawData = generation.candidates[0].content.parts[0].inlineData.data;
        const tempBuffer = Buffer.from(rawData, 'base64');
        const tempExtracted = extractCleanPcmFromGeminiAudio(tempBuffer, 24000);
        const srCheck = tempExtracted.sampleRate || 24000;
        const wCount = cleanText.split(/\s+/).filter(Boolean).length;
        const dedupCheck = trimDuplicatedTakeInPcm(tempExtracted.pcmBytes, srCheck, wCount);
        const tempSec = dedupCheck.pcmBytes.byteLength / Math.max(16000, srCheck * 2);

        if (!dedupCheck.wasTrimmed && wCount >= 8 && tempSec > 6 && wCount / tempSec < 1.35 && hardAttempt < 2) {
          hardAttempt++;
          console.warn(
            `[Gemini TTS] Posible duplicación sin valle limpio en ${targetModel} (${tempSec.toFixed(1)}s para ${wCount} pal.). Reintentando...`
          );
          await new Promise((r) => setTimeout(r, 800));
          continue;
        }

        usedModel = targetModel;
        break;
      }
      hardAttempt++;
    } catch (e: any) {
      if (slotStamp) settleServerTtsRateSlot(slotStamp);
      lastErr = e;
      const errMsg = String(e?.message || e || '');
      const isPerMinuteQuota =
        /per\s+minute|Please\s+retry\s+in\s+[0-9]+(?:\.[0-9]+)?\s*s|limit:\s*10\b/i.test(errMsg);
      const isDailyHardCap =
        !isPerMinuteQuota &&
        /per_day|RequestsPerDay|GenerateRequestsPerDay/i.test(errMsg);

      if (isDailyHardCap) {
        lastErr = new Error(
          'Se alcanzó el límite diario (RPD) de Gemini 3.8 Flash TTS en esta API Key. Espera al reinicio diario de cuota en Google AI Studio o cambia la API Key.'
        );
        break;
      }

      const isRateLimit =
        e?.status === 429 ||
        isPerMinuteQuota ||
        /429|quota|rate.?limit|RESOURCE_EXHAUSTED|retry in/i.test(errMsg);

      if (isRateLimit && rateLimitWaits < maxRateLimitWaits) {
        const waitMs = parseServerTtsRetryDelayMs(e, rateLimitWaits);
        rateLimitWaits++;
        serverTtsCooldownUntilMs = Math.max(serverTtsCooldownUntilMs, Date.now() + waitMs);
        console.warn(
          `[Gemini TTS] Pausa automática Tier-1 (${rateLimitWaits}/${maxRateLimitWaits}) por ${(waitMs / 1000).toFixed(1)}s (${errMsg.slice(0, 120)})`
        );
        await new Promise((r) => setTimeout(r, waitMs));
        continue;
      }

      hardAttempt++;
      if (hardAttempt < maxHardAttempts) {
        const waitMs = 3500 * hardAttempt;
        console.warn(
          `[Gemini TTS] Reintento ${hardAttempt}/${maxHardAttempts} tras ${(waitMs / 1000).toFixed(1)}s (${errMsg.slice(0, 120)})`
        );
        await new Promise((r) => setTimeout(r, waitMs));
        continue;
      }
      break;
    }
  }

  const base64Audio = generation?.candidates?.[0]?.content?.parts?.[0]?.inlineData?.data;
  if (!base64Audio) {
    throw new Error(`Error al sintetizar audio con ${targetModel}: ${lastErr?.message || 'Sin datos de audio'}`);
  }

  const rawAudioBuffer = Buffer.from(base64Audio, 'base64');
  const extracted = extractCleanPcmFromGeminiAudio(rawAudioBuffer, 24000);
  const finalSr = extracted.sampleRate || 24000;
  const finalWordCount = cleanText.split(/\s+/).filter(Boolean).length;
  const deduped = trimDuplicatedTakeInPcm(extracted.pcmBytes, finalSr, finalWordCount);
  if (deduped.wasTrimmed) {
    console.warn(
      `[Gemini TTS] Toma duplicada recortada automáticamente: ${deduped.originalDurationSec.toFixed(2)}s -> ${deduped.trimmedDurationSec.toFixed(2)}s`
    );
  }
  const cleanPcm = Buffer.from(
    deduped.pcmBytes.buffer,
    deduped.pcmBytes.byteOffset,
    deduped.pcmBytes.byteLength
  );
  const buffer = pcmToWav(cleanPcm, finalSr);

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
      targetDurationSeconds,
      docContext,
    } = req.body;

    if (!text || typeof text !== 'string' || !text.trim()) {
      res.status(400).json({ error: 'El texto del guion es requerido para generar la locución.' });
      return;
    }

    const durationTarget = docContext || (Number(targetDurationSeconds) > 0 ? Number(targetDurationSeconds) : null);
    const cleanedScriptForTts = durationTarget
      ? autoFitVoiceoverScriptToDuration(text, durationTarget)
      : cleanServerVoiceoverNarrationOnly(text);
    if (!cleanedScriptForTts) {
      res.status(400).json({ error: 'El guion no contiene texto narrable válido.' });
      return;
    }
    const segments = parseTextWithPauses(cleanedScriptForTts);
    const hasPauses = segments.some((s) => s.type === 'pause');

    let buffer: Buffer;
    let providerUsed = 'Gemini TTS';

    const segmentTimings: Array<{
      type: 'text' | 'pause';
      text?: string;
      startSec: number;
      endSec: number;
      durationSec: number;
    }> = [];

    if (!hasPauses && segments.length <= 1) {
      const result = await synthesizeSpeechCore({
        text: cleanedScriptForTts,
        voice,
        style,
        speed,
        language,
        consistencyMode,
        customStyleDescription,
      });
      const singlePcm = applyMicroFade(extractPcmFromWav(result.buffer), 288);
      buffer = pcmToWav(singlePcm, 24000);
      providerUsed = result.providerUsed;
      const singleDur = getAudioDurationInSeconds(buffer);
      segmentTimings.push({
        type: 'text',
        text: cleanedScriptForTts,
        startSec: 0,
        endSec: singleDur,
        durationSec: singleDur,
      });
    } else {
      const pauseCount = segments.filter((s) => s.type === 'pause').length;
      const totalPauseSec = segments
        .filter((s) => s.type === 'pause')
        .reduce((acc, s) => acc + (s.duration || 0), 0);
      console.log(
        `[TTS Pauses] Detectadas ${pauseCount} pausas (${totalPauseSec.toFixed(1)}s totales). Sintetizando segmentos con silencios PCM exactos...`
      );
      const pcmBuffers: Buffer[] = [];
      let runningSec = 0;
      for (const seg of segments) {
        if (seg.type === 'pause' && seg.duration) {
          const pauseSamples = Math.round(24000 * seg.duration);
          const pauseBuf = Buffer.alloc(pauseSamples * 2);
          pcmBuffers.push(pauseBuf);
          const dSec = Number((pauseBuf.length / 48000).toFixed(3));
          segmentTimings.push({
            type: 'pause',
            startSec: Number(runningSec.toFixed(3)),
            endSec: Number((runningSec + dSec).toFixed(3)),
            durationSec: dSec,
          });
          runningSec += dSec;
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
          const pcm = applyMicroFade(extractPcmFromWav(result.buffer), 288);
          pcmBuffers.push(pcm);
          const dSec = Number((pcm.length / 48000).toFixed(3));
          segmentTimings.push({
            type: 'text',
            text: seg.text,
            startSec: Number(runningSec.toFixed(3)),
            endSec: Number((runningSec + dSec).toFixed(3)),
            durationSec: dSec,
          });
          runningSec += dSec;
        }
      }
      buffer = pcmToWav(Buffer.concat(pcmBuffers), 24000);
      providerUsed = `${providerUsed} (${pauseCount} Pausas · ${totalPauseSec.toFixed(1)}s)`;
    }

    const wordCount = cleanedScriptForTts
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
    try {
      const docsTtsDir = path.join(process.cwd(), 'docs', 'tts-files');
      fs.mkdirSync(docsTtsDir, { recursive: true });
      fs.copyFileSync(path.join(TTS_DIR, filename), path.join(docsTtsDir, filename));
    } catch {}

    const actualDuration = getAudioDurationInSeconds(buffer);
    const newRecord = {
      id: fileId,
      label: label || `Locución (${voice})`,
      text: cleanedScriptForTts,
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
      segmentTimings,
    };

    res.json(newRecord);
  } catch (error: any) {
    console.error('Error en /api/tts:', error);
    res.status(500).json({ error: error.message || 'Error interno al sintetizar locución.' });
  }
});

// Persist an uploaded or recovered WAV/MP3 voiceover file permanently into tts-files/ (and docs/tts-files/)
app.post('/api/tts/persist-upload', uploadAsset.single('file'), async (req, res) => {
  try {
    if (!req.file) {
      res.status(400).json({ error: 'No se recibió archivo de audio.' });
      return;
    }
    const rawExt = path.extname(req.file.originalname || '').toLowerCase() || '.wav';
    const baseId = `tts-restored-${Date.now()}`;
    const rawFilename = `${baseId}${rawExt}`;
    const rawDestPath = path.join(TTS_DIR, rawFilename);
    fs.copyFileSync(req.file.path, rawDestPath);
    try {
      fs.unlinkSync(req.file.path);
    } catch {}

    let finalFilename = rawFilename;
    if (rawExt !== '.mp3') {
      try {
        const uploadedBytes = fs.readFileSync(rawDestPath);
        if (hasEmbeddedC2paInAudioBytes(uploadedBytes)) {
          const cleaned = cleanMasterWavEmbeddedC2paInPlace(uploadedBytes);
          if (cleaned.cleanedBlocks > 0 || cleaned.strippedPostDataBytes > 0) {
            fs.writeFileSync(rawDestPath, Buffer.from(cleaned.wavBytes));
          }
        }
      } catch {}
      const mp3Name = `${baseId}.mp3`;
      const mp3DestPath = path.join(TTS_DIR, mp3Name);
      const converted = await convertWavToMp3(rawDestPath, mp3DestPath);
      if (converted) {
        finalFilename = mp3Name;
      }
    }
    try {
      const docsTtsDir = path.join(process.cwd(), 'docs', 'tts-files');
      fs.mkdirSync(docsTtsDir, { recursive: true });
      fs.copyFileSync(path.join(TTS_DIR, finalFilename), path.join(docsTtsDir, finalFilename));
    } catch {}

    res.json({
      ok: true,
      filename: finalFilename,
      audioUrl: `tts-files/${finalFilename}`,
    });
  } catch (err: any) {
    res.status(500).json({ error: err.message || 'Error guardando el audio en tts-files.' });
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
      pcmBuffers.push(applyMicroFade(extractPcmFromWav(fs.readFileSync(targetWavPath)), 288));
    }

    // Level active-speech RMS across all segments so no fragment sounds louder/quieter than the others
    const computeActiveRms = (buf: Buffer): number => {
      const n = Math.floor(buf.length / 2);
      if (n === 0) return 0;
      let sumSq = 0;
      let activeCount = 0;
      for (let i = 0; i < n; i++) {
        const s = buf.readInt16LE(i * 2) / 32768;
        if (Math.abs(s) > 0.015) {
          sumSq += s * s;
          activeCount++;
        }
      }
      return activeCount > 100 ? Math.sqrt(sumSq / activeCount) : 0;
    };
    const rmsList = pcmBuffers.map(computeActiveRms).filter((r) => r > 0.01);
    const sortedRms = [...rmsList].sort((a, b) => a - b);
    const targetRms =
      sortedRms.length > 0 ? sortedRms[Math.floor(sortedRms.length / 2)] : 0.11;

    const pauseSamples = Math.round(24000 * 0.25);
    const silenceBuffer = Buffer.alloc(pauseSamples * 2);
    const combinedChunks: Buffer[] = [];
    pcmBuffers.forEach((b, idx) => {
      const segRms = computeActiveRms(b);
      let leveledBuf = Buffer.from(b);
      if (segRms > 0.01 && targetRms > 0.01) {
        const gain = Math.max(0.35, Math.min(2.2, targetRms / segRms));
        if (Math.abs(gain - 1) > 0.05) {
          const n = Math.floor(leveledBuf.length / 2);
          for (let i = 0; i < n; i++) {
            const v = Math.round(leveledBuf.readInt16LE(i * 2) * gain);
            leveledBuf.writeInt16LE(Math.max(-32767, Math.min(32767, v)), i * 2);
          }
        }
      }
      combinedChunks.push(leveledBuf);
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
  const { filename, language = 'es', sentenceMode = 'split-8-seconds', preservePunctuation = true } = req.body;
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
    const clipDurationLabel = doc.clipDurationMode === '8_SEGUNDOS' ? '8 seconds' : '10 seconds';
    const is16x9 = doc.productionType === 'DOCUMENTAL_16X9' || doc.productionType === 'NOTEBOOKLM';
    const c1Dur = Number(doc.clip1DurationSeconds) || (doc.clip1SyncMode === 'VOZ_EN_CLIP_2' ? 6 : 4);
    const voiceEntrySec = c1Dur + 2;
    const clip2StartSec = doc.clip1SyncMode === 'RALENTIZAR_CAPCUT' ? c1Dur + 2 : c1Dur;
    const youtubeViralLink = (doc.promptConfig?.YOUTUBE_VIRAL_LINK || '').trim();
    const youtubeVideoTitle = (
      doc.promptConfig?.YOUTUBE_VIDEO_TITLE ||
      doc.promptConfig?.ESTRUCTURA_VIRAL_TITULO ||
      ''
    ).trim();
    const youtubeVideoDescription = (doc.promptConfig?.YOUTUBE_VIDEO_DESCRIPTION || '').trim();
    const youtubeVideoTags = (doc.promptConfig?.YOUTUBE_VIDEO_TAGS || '').trim();
    const youtubeCommentsResearchBlock = (
      doc.promptConfig?.YOUTUBE_COMMENTS_RESEARCH_BLOCK || ''
    ).trim();
    const youtubeMetadataBlock =
      youtubeVideoTitle || youtubeVideoDescription || youtubeVideoTags
        ? `\nEXTRACTED REFERENCE YOUTUBE VIDEO METADATA:\n- VIDEO TITLE: ${youtubeVideoTitle || youtubeViralLink}\n- VIDEO TAGS / KEYWORDS: ${youtubeVideoTags || '(Extract from title and description)'}\n- VIDEO DESCRIPTION:\n${youtubeVideoDescription ? youtubeVideoDescription.slice(0, 3500) : '(No additional description)'}\n-> MANDATORY INSTRUCTION ON TITLE, DESCRIPTION, AND TAGS: Thoroughly analyze the title, description (chapters, sources, narrative angle, and hooks), and tags of this reference YouTube video and integrate them directly into our documentary Deep Research.\n`
        : '';
    const viralContextBlock = youtubeViralLink
      ? `\nREFERENCE VIRAL YOUTUBE VIDEO LINK: ${youtubeViralLink}\nMANDATORY VIRAL ANALYSIS INSTRUCTION (STRUCTURE + TITLE + DESCRIPTION + TAGS): Deeply, meticulously, and incisively analyze the YouTube video at (${youtubeViralLink}), including its TITLE, full DESCRIPTION, and TAGS/keywords, to understand why it succeeded on the platform, leverage its thematic angles, and RECREATE THE EXACT SAME WINNING NARRATIVE ARCHITECTURE in our documentary research.${youtubeMetadataBlock}${
          youtubeCommentsResearchBlock ? `\n${youtubeCommentsResearchBlock}\n` : ''
        }`
      : youtubeMetadataBlock || youtubeCommentsResearchBlock
      ? `\n${youtubeMetadataBlock}${youtubeCommentsResearchBlock}\n`
      : '';

    let stagePrompt = '';
    if (stageNumber === 2 || stageNumber === 3) {
      stagePrompt = `Act as a professional historian, film director, and investigative journalist for the Spanish-language historical documentary channel "Huellas de la Humanidad".${viralContextBlock}
Documentary topic: ${doc.topic || doc.title || 'To be defined'}
Typology: ${doc.typology || 'Historical event'}
Historical era: ${doc.historicalTime || 'To be defined'}
Historical location: ${doc.historicalLocation || 'To be defined'}
Approximate target duration: ~${doc.targetDurationSeconds || 120} seconds (total duration is approximate rather than millisecond-exact).

Generate the complete STAGE 3 deliverable in NEUTRAL SPANISH (except any technical sub-instructions that benefit from English precision):
1. Structural breakdown of chronological documentary sections.
2. Verified unusual facts, historical curiosities, and central historical contradictions.
3. Detailed Master Prompt to run Deep Research / NotebookLM${
        youtubeCommentsResearchBlock
          ? ' — MANDATORILY INCLUDING INSIDE THIS DEEP RESEARCH PROMPT all audience questions, doubts, debates, and topic requests detected in the reference video comments and @huellas_de_la_humanidad channel comments so the Deep Research answers them exhaustively'
          : ''
      }.`;
    } else if (stageNumber === 4) {
      const introPlacement = doc.promptConfig?.UBICACION_INTRO_MARCA || 'INTRO_INICIO_00';
      const FIXED_INTRO_SEC = 8;
      const FIXED_OUTRO_SEC = 8;
      const effectiveVoiceEntrySec =
        introPlacement === 'INTRO_INICIO_00' ? voiceEntrySec + FIXED_INTRO_SEC : voiceEntrySec;
      const totalDurSec = Math.max(30, Number(doc.targetDurationSeconds) || 900);
      const totalMinLabel = Number.isInteger(totalDurSec / 60)
        ? String(totalDurSec / 60)
        : (totalDurSec / 60).toFixed(1);
      const estPauseSec =
        totalDurSec >= 300
          ? Math.min(45, Math.max(8, Math.round((totalDurSec / 60) * 1.35)))
          : Math.max(2, Math.round(totalDurSec * 0.04));
      const netSpeechSec = Math.max(
        10,
        totalDurSec - FIXED_OUTRO_SEC - effectiveVoiceEntrySec - estPauseSec
      );
      const targetWords = Math.max(25, Math.round(netSpeechSec * (147 / 60)));
      const minWords = Math.max(20, Math.round(targetWords * 0.92));
      const maxWords = Math.max(30, Math.round(targetWords * 1.06));
      const targetChars = Math.round(targetWords * 6.05);
      stagePrompt = `Act as a professional historian, film director, and documentary screenwriter for "Huellas de la Humanidad".
Topic: ${doc.topic || doc.title} (${doc.historicalTime}, ${doc.historicalLocation})
Selected Stage 1 Total Duration: ${totalMinLabel} MINUTES (${totalDurSec} seconds)
Prior Structure and Deep Research:
${doc.sectionsStructure || ''}
${doc.deepResearchResult || ''}

CRITICAL OUTPUT LANGUAGE REQUIREMENT: Write the entire VOICEOVER SCRIPT in NEUTRAL DOCUMENTARY SPANISH strictly obeying these unbreakable rules:
- STRICT DURATION AND WORD BUDGET (${totalMinLabel} REAL MINUTES IN VOXFLOW): Our TTS narrator (Charon) speaks at 147 words per minute. Subtracting ${effectiveVoiceEntrySec}s of silent opening, ${FIXED_OUTRO_SEC}s of Outro, and ~${estPauseSec}s of pauses, THE ENTIRE SCRIPT MUST CONTAIN BETWEEN ${minWords} AND ${maxWords} WORDS (exact target: ~${targetWords} words / ~${targetChars} characters). STRICTLY FORBIDDEN to exceed ${maxWords} words.
- 100% PURE SPOKEN NARRATION FORMAT (ZERO HEADERS OR TIMESTAMPS): Deliver ONLY the exact spoken text read by the narrator (plus [pausa: Xs] pause tags). STRICTLY FORBIDDEN to write section headers ("ETAPA 4..."), block titles, timestamps like "(00:00 - 00:08...)" or "(00:16...)", parenthetical stage directions, or word counts at the bottom.
- Must open with the mandatory historical triad in the very first sentence ending with a period: "Año [number in digits], [Place, City, Country]. [Intriguing premise]." (Never write "en el" after the year; write first days of a month as the word "primero", e.g., "primero de mayo").
- Always write years in digits, centuries and monarchs in Roman numerals (e.g., siglo XIX, Felipe II), thousands using the word "mil" (e.g., "70 mil"), and zero exclamation marks (!).
- Include strategic pause tags formatted as [pausa: 1.5s] or [pausa: 2s].
- For long-form documentaries, include before second 30 the channel slogan in a standalone Paragraph 2 ("En los próximos minutos... Cada historia deja una huella. Aquí seguimos sus rastros.")${
        introPlacement === 'INTRO_POST_SLOGAN'
          ? ' and IMMEDIATELY after closing Paragraph 2 place the mandatory tag [pausa: 8s] so the 8-second Official Brand Intro (Intro.mp4 — "Minimalismo en Piedra y Oro") plays during those exact 8 seconds of narrator silence before Paragraph 3'
          : ''
      }, and close the script in a standalone final paragraph with a warm comment invitation and the signature motto: "Cada historia deja una huella. Aquí seguimos sus rastros."`;
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
      stagePrompt = `Act as an expert click-neuropsychology designer (high YouTube CTR) for "Huellas de la Humanidad".
Topic / Title: ${doc.topic || doc.title} (${doc.historicalTime || doc.clip1Line1LocationTime || ''}, ${doc.historicalLocation || ''})
Clip 1 Hook: ${doc.clip1Line1LocationTime || ''} — ${doc.clip1Line2Hook || ''}
ACTUAL Documentary Script (ABSOLUTE PRIORITY over any provisional working title):
"""
${(doc.voiceoverScript || doc.sectionsStructure || '').slice(0, 1500)}
"""
Documentary Characters and Locations (@References):
${refsContext}
Opening Visual Scenes (Clips):
${clipsContext}
Selected Orientation: ${isThumbHorizontal ? 'HORIZONTAL (16:9)' : 'VERTICAL (9:16)'}
Mandatory On-Screen Text Overlay (Spanish Curiosity Gap): "${overlayText}"

CRITICAL THEMATIC FIDELITY RULE: If the "Title" field still holds a placeholder or previous episode title (e.g., "Video 75..."), IGNORE IT and base the thumbnail visual scene 100% on the ACTUAL Script, Characters (@References), and Clip scenes above.

MANDATORILY APPLY ALL 5 CTR NEUROPSYCHOLOGY PRINCIPLES IN THE IMAGE PROMPT:
1. 13-MILLISECOND PROCESSING (ZERO VISUAL CLUTTER): Ultra-clean composition with at most 3 visual elements (1 dominant foreground face of the real protagonist from the script + 1 danger/mystery trigger object from the script + hook text overlay), instantly readable on a small mobile screen.
2. HUMAN FACE + EXTREME EMOTION + DIRECT EYE CONTACT: The real historical protagonist fills ~60% of the frame in Medium Close-Up or Extreme Close-Up, making "direct piercing eye contact with the viewer", wide eyes showing white sclera, visceral expression of shock, awe, dread, or uncovered betrayal, photorealistic skin pores, sweat, or tears.
3. CURIOSITY GAP: Depict the exact split-second before disaster or an enigmatic visual contradiction from the script that forces the viewer's brain to ask "What just happened there?".
4. COLOR PSYCHOLOGY & HIGH CONTRAST: Dramatic chiaroscuro lighting with high-impact warm key light (burning gold, crimson fire, or deep amber) on the face and a crisp rim light separating the subject from a dark saturated cool background (deep midnight cyan-blue or abyssal black).
5. MANDATORY ON-SCREEN TEXT OVERLAY POSITION:
   ${
     isThumbHorizontal
       ? `Because this is HORIZONTAL (16:9), the Spanish on-screen text "${overlayText}" MUST be positioned in the BOTTOM-LEFT: include verbatim 'bold high-contrast cinematic documentary typography text overlay positioned in the bottom-left area of the image reading "${overlayText}"'.`
       : `Because this is VERTICAL (9:16), the Spanish on-screen text "${overlayText}" MUST be CENTERED AND MIDDLE-JUSTIFIED IN THE MIDDLE OF THE IMAGE: include verbatim 'bold high-contrast cinematic documentary typography text overlay centered and middle-justified right in the middle center of the image reading "${overlayText}"'.`
   }
6. 5% METALLIC GOLD TOP-RIGHT BADGE:
   ${
     isThumbHorizontal
       ? `Because this is HORIZONTAL (16:9), the top-right badge is "8K": include verbatim 'a small discreet 5% scale logo in the top-right corner displaying "8K" in metallic gold'.`
       : `Because this is VERTICAL (9:16), the top-right badge is "HD": include verbatim 'a small discreet 5% scale logo in the top-right corner displaying "HD" in metallic gold'.`
   }
7. 5% OFFICIAL TOP-LEFT BRAND LOGO (FROM REFERENCE IMAGE):
   Include verbatim: 'official page logo cleanly integrated in the top-left corner from provided reference image at 5% scale, strictly preserving and visibly rendering both the logo emblem and the exact text underneath it "Huellas de la Humanidad" without cropping, blurring, or omitting the sub-text'.
8. Close with: 'cinematic documentary realism, 8k resolution, sharp focus, safe framing composition, no modern objects, no CGI look, no unintended floating text, no music.'
Deliver ONLY the ready-to-paste image generation prompt written 100% in English (preserving the exact quoted Spanish text overlay "${overlayText}" and brand name "Huellas de la Humanidad").`;
    } else if (stageNumber === 6) {
      const isRefVertical =
        doc.productionType === 'SHORT_9X16' || doc.promptConfig?.SUB_OPCION_REELS === '9X16';
      const refAspect = isRefVertical ? '9:16 vertical aspect ratio' : '16:9 horizontal aspect ratio';
      stagePrompt = `Act as a historian and director of photography for "Huellas de la Humanidad".
Based on this voiceover script and historical setting (${doc.topic || doc.title}, ${doc.historicalTime}, ${doc.historicalLocation}):
"""
${doc.voiceoverScript || doc.sectionsStructure || ''}
"""
Generate STAGE 6: REFERENCE MODEL IMAGE PROMPTS for Nano Banana 2.1 in Google Flow (**6 views in every image** and specifying the **exact identifier** of every image with @ and underscores _ with zero spaces or accents), written 100% IN PURE ENGLISH:
- Prepend this exact operational header in English:
  Use Nano Banana 2.1. Generate each image as a 6-view reference sheet in a single 3x2 grid image and strictly rename each generated image to the exact @Name_With_Underscores identifier specified in each prompt.
- For each main character (@People): Image @Character_Name [Image Name: @Character_Name]: Create an image in ${refAspect} structured as a 6-view character reference sheet (6 distinct views in a single 3x2 grid image of the exact same person with 100% identical facial, hair, and wardrobe continuity: 1. front full-body standing view, 2. three-quarter full-body view, 3. side profile full-body view, 4. back full-body view, 5. neutral front close-up portrait of head and shoulders, 6. three-quarter close-up portrait showing skin pores and facial structure), depicting [detailed physical traits and authentic period wardrobe (${doc.historicalTime}, ${doc.historicalLocation}), portrayed by an anonymous historical reenactment actor in authentic period costume, no real public figures or prominent people], 8k photorealistic cinematic documentary realism, uncropped 6-panel reference sheet, strictly no text, no labels, no numbers, no words, no speech, no music. fix the name to @Character_Name
- For each primary location (@Locations): Image @Location_Name [Image Name: @Location_Name]: Create an image in ${refAspect} structured as a 6-view historical location reference sheet (6 distinct views in a single 3x2 grid image of the exact same historical location with 100% architectural, material, and atmospheric continuity: 1. wide establishing shot, 2. reverse wide angle, 3. medium focal architectural view, 4. ground-level entrance or street perspective, 5. elevated overview angle, 6. close-up structural materials and period lighting detail), depicting [historical architecture, era (${doc.historicalTime}, ${doc.historicalLocation}), and atmospheric lighting], strictly empty environment with zero people, zero animals, and zero characters anywhere in the frame, 8k photorealistic cinematic documentary realism, uncropped 6-panel reference sheet, strictly no text, no labels, no numbers, no words, no speech, no music. fix the name to @Location_Name`;
    } else if (stageNumber === 7) {
      stagePrompt = `Act as creative director for the Spanish-language historical documentary channel "Huellas de la Humanidad".
Topic: ${doc.topic || doc.title} | Location: ${doc.historicalLocation} | Era: ${doc.historicalTime}
Video Title: ${doc.title || ''}
Thumbnail On-Screen Text: ${doc.thumbnailTextOverlay || ''}
Script Excerpt: ${(doc.voiceoverScript || '').slice(0, 600)}

CRITICAL OUTPUT LANGUAGE REQUIREMENT: Propose 3 magnetic options IN NEUTRAL SPANISH for the CLIP 1 ON-SCREEN TEXT (first ${voiceEntrySec}s of the video):
Line 1: [City, Country, Año XXXX (with the Spanish word "Año" before the year in digits) or Siglo XX (with capitalized "Siglo" and Roman numerals)] (e.g., "Santander, España, Año 1885" or "París, Francia, Siglo XIII")
Line 2: [Suggestive Spanish Hook Title revealing and intriguing about the documentary's central topic. STRICTLY FORBIDDEN to use vague or abstract phrases disconnected from the actual historical subject]
UNBREAKABLE NON-REPETITION RULE: NEVER repeat the exact wording across the Thumbnail Text, the Video Title, and the first ${voiceEntrySec} seconds On-Screen Text. Ensure Line 2 is distinct from both "${doc.title || ''}" and "${doc.thumbnailTextOverlay || ''}" while directly revealing and intriguing about the documentary's core story.`;
    } else if (stageNumber === 8) {
      const opHeader = sanitizeOperationalHeaderServer(doc.operationalHeader);
      stagePrompt = `Act as a professional historian, film director, and journalist.
Generate STAGE 8: STARTING KEYFRAME IMAGE PROMPTS (Nano Banana 2.1) AND VIDEO CLIP PROMPTS (Hybrid Mode: Omni 1.1 Flash when human subjects appear / Veo 3.1 - Lite [Lower Priority] for all remaining clips without people) for the documentary "${doc.topic || doc.title}" (${doc.historicalTime}, ${doc.historicalLocation}).
Duration of each clip from Clip 2 onward: ${clipDurationLabel}.
Clip 1 Sync and Voice Entry: ${
        doc.clip1SyncMode === 'VOZ_EN_CLIP_2'
          ? `Clip 1 runs from 00:00 to 00:0${c1Dur} (${c1Dur}s silent visual hook). Clip 2 starts at 00:0${clip2StartSec} and narrator voice enters at second ${voiceEntrySec} of the video (second 2 of Clip 2).`
          : `Clip 1 is generated at ${c1Dur}s and slowed down in CapCut to ${voiceEntrySec}s (00:00 - 00:0${voiceEntrySec} silent visual hook). Clip 2 starts at 00:0${clip2StartSec} synchronized with voice entry.`
      }
Approximate Duration Rule: Total video duration is approximate to the requested target (~${doc.targetDurationSeconds || 120}s); all clips from Clip 2 to the end maintain their standard ${clipDurationLabel} length without forcing 2s or 4s micro-filler clips at the end.
Clip 1 On-Screen Text Context: ${doc.clip1Line1LocationTime} — ${doc.clip1Line2Hook}
Available @References: ${(doc.references || []).map((r: any) => r.tag).join(', ')}

Narrator Voice Timeline (Spanish reference context — DO NOT copy Spanish sentences into Image or Clip prompts):
"""
${doc.timelineFormattedText || doc.voiceoverScript || ''}
"""

UNBREAKABLE 9-LINE OPERATIONAL HEADER REQUIREMENT:
Your output MUST BEGIN VERBATIM WITH THIS EXACT 9-LINE ENGLISH PARAGRAPH (omitting zero lines) before "Image 1: Create an image":
${opHeader}

Immediately after the 9-line header paragraph, output every Clip (starting with Clip 1 without narrator voice, followed by Clip 2 onward covering the entire timeline) strictly obeying these UNBREAKABLE SIMPLICITY, PRECISION, PURE ENGLISH, AND ANTI-DUPLICATION RULES:
- 100% PURE ENGLISH PROMPTS FOR GOOGLE FLOW: Every single Image [N] and Clip [N] prompt MUST be written 100% in pure English. NEVER embed Spanish voiceover sentences inside Image [N] or Clip [N].
- HYBRID VIDEO ENGINE RULE: In every Clip [N], immediately before "fix the name", write [Model: Omni 1.1 Flash] if people or human characters appear in that clip, or write [Model: Veo 3.1 - Lite [Lower Priority]] if ZERO people appear in that clip (landscapes, ships at sea, maps, documents, lithographs, or objects).
- UNBREAKABLE VISUAL NON-DUPLICATION BETWEEN CONSECUTIVE CLIPS (Clip [N] vs Clip [N+1]): Whenever the narrator stays on the same topic or scene across consecutive clips, Clip [N+1] MUST NEVER visually duplicate Clip [N] (strictly forbidden to chain two consecutive offices, two wooden desks/counters with documents/coins, or the same staging twice in a row). Each subsequent clip must shift radically in environment, lighting, scale, and camera perspective while remaining faithful to the narration (e.g., if Clip N is a dim interior desk, Clip N+1 must cut to a bright exterior harbor dock facing a steamship, an open street, or a distinct visual angle).
- Image [N]: Concise, direct, and clear (~20 to 35 English words), describing only the primary subject/scene, historical era and location (${doc.historicalTime}, ${doc.historicalLocation}), and lighting, closing with "cinematic lighting, historical accuracy, no text."
- Clip [N] ([MM:SS - MM:SS]): Because Google Flow already uses Image [N] as the starting keyframe, DO NOT repeat wardrobe or architectural descriptions. Write ONE SINGLE SIMPLE, DIRECT ENGLISH SENTENCE (~12 to 22 words) specifying ONLY ONE smooth camera movement (e.g., slow zoom-in, panning slowly, gliding slowly, slow tilt-up) and ONE natural physical micro-action on the starting image, followed by "Ambient Foley: [2-3 specific period sounds], single continuous shot, strictly no shot changes, no music, no speech, no text." followed by the corresponding [Model: ...] tag and closing with "fix the name".

Exact output format example:
Image [N]: Create an image of [clear English scene with historical era and location], cinematic lighting, historical accuracy, no text.

Clip [N] ([MM:SS - MM:SS]): Create a video showing [1 smooth camera movement + 1 simple physical micro-action on the starting image]. Ambient Foley: [specific period sounds], single continuous shot, strictly no shot changes, no music, no speech, no text. [Model: Omni 1.1 Flash or Veo 3.1 - Lite [Lower Priority]] fix the name`;
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
        totalDocSec >= 900 ? 5 : totalDocSec >= 660 ? 4 : totalDocSec >= 420 ? 3 : totalDocSec >= 240 ? 2 : 1;
      const maxRecommendedTracks =
        totalDocSec >= 900 ? 7 : totalDocSec >= 660 ? 6 : totalDocSec >= 420 ? 5 : totalDocSec >= 240 ? 3 : 2;
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
                  `Clip ${c.clipNumber} (${c.timeRange || ''}): ${(c.imagePrompt || '').slice(0, 120)} | Voice: "${(c.narrationSegment || '').slice(0, 90)}"`
              )
              .join('\n')
          : '';

      stagePrompt = `Act as a master cinematic documentary composer for "Huellas de la Humanidad" using **FlowMusic (https://www.flowmusic.app/)**.
Topic: ${doc.topic || doc.title} (${doc.historicalTime || doc.historicalEra || ''}, ${doc.historicalLocation || doc.cityCountry || ''})
Exact total documentary duration (computed from Narrator Voice and Clip Timeline): ${resolvedFinalDuration} (${totalDocSec} seconds)
Script / Scene Structure: ${(doc.voiceoverScript || doc.sectionsStructure || '').slice(0, 2400)}
${clipsVisualSummary ? `\nVisual Scene & Clip Map:\n${clipsVisualSummary}\n` : ''}
Generate **STAGE 8: MUSIC SCORE (FLOWMUSIC — flowmusic.app)** strictly obeying these UNBREAKABLE RULES:
1. DYNAMIC TRACK COUNT MATCHING SCENE ARCS (${minRecommendedTracks} to ${maxRecommendedTracks} tracks): Design between ${minRecommendedTracks} and ${maxRecommendedTracks} distinct instrumental cues accompanying visual scene shifts, plot turns, and emotional acts.
2. MANDATORY MUSIC-FREE BREATHING GAPS BETWEEN EVERY TRACK (MINIMUM 30 SECONDS AND MAXIMUM 1 MINUTE / 0:30 to 1:00):
   - Between the end of one track and the start of the next track, there MUST be a music-free silence window of MINIMUM 30 seconds (0:30) and MAXIMUM 1 minute (1:00 / 60s), placed on a scene transition or rhetorical question where only Narrator Voice and ambient Foley are heard. Strictly forbidden to leave less than 30s or more than 60s between tracks.
   - In field "3. Time Range Covered", state the exact range respecting that 30s–1:00 music-free breathing gap between tracks (e.g., Track 1: 00:08 - 02:38 -> 40s music-free gap [02:38 - 03:18] -> Track 2: 03:18 - 05:48).
3. FINAL TRACK MUST STRICTLY BE EXACTLY 1:30 (1:30):
   - The FINAL track of the score MUST last EXACTLY 1:30 (${outroStartMmSs} - ${resolvedFinalDuration}), covering the closing 90 seconds of the documentary.
4. MANDATORY [End - M:SS] TAG AT THE END OF EVERY LYRICS PROMPT:
   - On the very last line of field "4. Lyrics Prompt" for EVERY track, include verbatim \`[End - M:SS]\` matching that track's exact target duration (e.g., \`[End - 2:30]\` for a 2:30 track, or \`[End - 1:30]\` on the final 1:30 track).
5. FADE-IN, FADE-OUT & DOCUMENTARY VOICEOVER DUCKING MIX:
   - Inside every "5. Style Prompt" (100% pure English for FlowMusic) mandatorily include: \`smooth 2.5-second fade-in intro, gentle 3-second fade-out outro, mixed as warm low-mid frequency documentary underscore designed to sit softly below a deep male narrator voice without competing in the 1kHz-4kHz vocal clarity range, 100% instrumental, strictly no vocals, no singing, no spoken words\`.
6. Deliver every track using these exact 6 numbered fields in order (keep Fields 4 and 5 100% in pure English for FlowMusic; Field 6 may be written in Spanish for the producer):
1. Title: [Evocative track title]
2. Duration: [Exact FlowMusic duration, e.g., 2:30; final track MUST be 1:30]
3. Time Range Covered: [MM:SS - MM:SS (Clip X to Clip Y), leaving 30s to 1:00 without music between tracks]
4. Lyrics Prompt: [100% English bracketed instrumental cue map with [Soft 2.5s Fade-In Intro], [Warm Documentary Underscore Below Voice], [Gentle 3s Fade-Out Outro] and closing on the last line with [End - 2:30] matching exact duration]
5. Style Prompt: [100% pure English technical prompt for FlowMusic (flowmusic.app) with period-authentic instruments, fade-in intro, fade-out outro, warm underscore mix below narrator voice, strictly instrumental only, no vocals, no singing, no speech, no lyrics]
6. Track Explanation: [Brief producer note in Spanish explaining sound palette, scenes covered, and preceding 30s–1:00 music-free gap]`;
    } else if (stageNumber === 101) {
      stagePrompt = `Act as a CTR strategist and thumbnail creative director for the Spanish-language historical documentary channel "Huellas de la Humanidad".
Video Title: ${doc.title || ''}
First ${voiceEntrySec} seconds On-Screen Text (Clip 1): ${doc.clip1Line2Hook || ''}
Historical Topic: ${doc.topic || doc.title || ''} (${doc.historicalTime || doc.clip1Line1LocationTime || ''}, ${doc.historicalLocation || ''})
ACTUAL Documentary Script (ABSOLUTE PRIORITY over any provisional working title):
"""
${(doc.voiceoverScript || doc.sectionsStructure || '').slice(0, 1500)}
"""

MANDATORY TASK & CRITICAL OUTPUT LANGUAGE REQUIREMENT:
Generate—in ALL-CAPS NEUTRAL SPANISH—EXACTLY 3 ON-SCREEN TEXT OVERLAY options for the official video thumbnail based 100% on the ACTUAL Script above.
UNBREAKABLE RULES:
1. Each option must consist strictly of 1 to 3 punchy words in ALL-CAPS SPANISH (e.g., EL PACTO OCULTO, TRAICIÓN REAL, LA NOCHE FINAL).
2. STRICT NON-REPETITION ACROSS THUMBNAIL, TITLE, AND FIRST ${voiceEntrySec} SECONDS ON-SCREEN TEXT: NEVER repeat the same wording across the Thumbnail Text, the Video Title ("${doc.title || ''}"), and the Clip 1 Hook ("${doc.clip1Line2Hook || ''}"). Every option must be distinct and complement them psychologically.
3. Output ONLY the 3 uppercase Spanish options, one per line, with zero numbering, zero bullets, zero quotation marks, and zero extra commentary.`;
    } else if (stageNumber === 11) {
      stagePrompt = `Act as Chief Publishing & SEO Strategist for the Spanish-language historical documentary channel "Huellas de la Humanidad".
Documentary Topic: ${doc.topic || doc.title} (${doc.historicalTime || doc.historicalEra || ''}, ${doc.historicalLocation || doc.cityCountry || ''})
Confirmed Final Duration: ${doc.confirmedFinalDuration || '02:00'}
Thumbnail On-Screen Text: "${doc.thumbnailTextOverlay || ''}"
First ${voiceEntrySec} seconds On-Screen Text (Clip 1): "${doc.clip1Line2Hook || ''}"
ACTUAL Reference Script (ABSOLUTE PRIORITY for extracting the central story and ultra-specific Title): ${(doc.voiceoverScript || '').slice(0, 2000)}

MANDATORY TASK & CRITICAL OUTPUT LANGUAGE REQUIREMENT: Generate all **4 INDEPENDENT PUBLISHING SECTIONS IN NEUTRAL SPANISH** separated EXACTLY by these 4 uppercase markers (do NOT translate the section markers or the Spanish deliverables):

===SECCION_YOUTUBE===
[Deliver the YOUTUBE METADATA IN SPANISH in seamless "Todo Corrido" copy-paste format separated ONLY by lines containing the Braille blank character (⠀): ZERO section labels except "Capítulos:", ~3000 characters total, an ULTRA-SPECIFIC, SUGGESTIVE Spanish Title anchored in the real historical story from the script (never vague or generic; explicitly name the historical subject, collective, place, or event joined with the central revelation or conflict, years in digits and centuries/monarchs in Roman numerals, without repeating verbatim the Thumbnail Text or Clip 1 Hook), description in EXACTLY 3 PARAGRAPHS separated by Braille blank lines (⠀), mandatory "Capítulos:" section with 10 chronological Spanish chapters where 00:00 starts directly inside the story (NEVER write "Prólogo" or "Introducción"), official Spanish AI Note: (Nota: Este documental inmersivo ha sido recreado utilizando herramientas de inteligencia artificial generativa basándonos estrictamente en registros históricos de la época. Es posible que existan incongruencias o errores visuales)., official Slogan: Cada historia deja una huella. Aquí seguimos sus rastros., and 5 Spanish hashtags in #CamelCase composed of TWO WORDS each.]

===SECCION_FACEBOOK===
[Deliver the FACEBOOK METADATA IN SPANISH in seamless "Todo Corrido" copy-paste format separated ONLY by Braille blank lines (⠀): ZERO section labels, NO chapters and NO SEO tags, ~3000 characters total, an ULTRA-SPECIFIC, SUGGESTIVE Spanish Title anchored in the real script story (without repeating verbatim the Thumbnail Text or Clip 1 Hook), description in EXACTLY 3 PARAGRAPHS separated by Braille blank lines (⠀), official Spanish AI Note: (Nota: Este video inmersivo ha sido recreado utilizando herramientas de inteligencia artificial generativa basándonos estrictamente en registros históricos de la época. Es posible que existan incongruencias o errores visuales)., official Slogan: Cada historia deja una huella. Aquí seguimos sus rastros., and 5 Spanish hashtags in #CamelCase composed of TWO WORDS each.]

===SECCION_COMENTARIO===
[Deliver EXCLUSIVELY the VIDEO PINNED COMMENT IN SPANISH with zero header or quotation marks: CONCISE, DIRECT, AND WARM (~350 to 500 characters max, ~60 to 85 words, 1 single paragraph of EXACTLY 3 SENTENCES: 1) one short sentence connecting the historical event to our present-day roots or memory WITHOUT re-summarizing the documentary; 2) one direct question "¿...?" inviting viewers to share a family memory or debate the core human dilemma; 3) a warm closing such as "Cuéntanos tu historia o reflexión aquí abajo, te leemos en los comentarios.", zero exclamation marks (!), never ask for likes/subscriptions, years in digits and centuries/monarchs in Roman numerals.]

===SECCION_TAGS===
[Deliver EXCLUSIVELY the YOUTUBE SEO TAGS IN SPANISH separated by commas (~460 to 500 characters max, with zero "Tags:" header).]`;
    } else if (stageNumber === 111) {
      stagePrompt = `[STAGE_111_YOUTUBE_METADATA]
Act as Publishing Strategist for the Spanish-language historical documentary channel "Huellas de la Humanidad".
Topic: ${doc.topic || doc.title} (${doc.historicalTime || doc.historicalEra || ''}, ${doc.historicalLocation || doc.cityCountry || ''})
Confirmed Final Duration: ${doc.confirmedFinalDuration || '02:00'}
Platform: YOUTUBE
Thumbnail On-Screen Text: ${doc.thumbnailTextOverlay || ''}
First ${voiceEntrySec} seconds On-Screen Text (Clip 1): ${doc.clip1Line2Hook || ''}
ACTUAL Reference Script (ABSOLUTE PRIORITY for writing an ultra-specific Title faithful to the real story): ${(doc.voiceoverScript || '').slice(0, 1500)}

CRITICAL OUTPUT LANGUAGE REQUIREMENT: Generate STAGE 11 YOUTUBE PUBLISHING METADATA IN NEUTRAL SPANISH in seamless "Todo Corrido" copy-paste format separated ONLY by lines containing the Braille blank character (⠀), strictly obeying these unbreakable rules:
1. ZERO section headers (forbidden to write "Título:", "Descripción:", "Nota IA:", "Slogan:", "Hashtags:"), with the SOLE mandatory exception of the header "Capítulos:".
2. Total length ~3000 characters counting spaces and Braille lines (⠀) from the start of the title to the end of the 5 hashtags.
3. UNBREAKABLE VIDEO TITLE RULE (ULTRA-SPECIFIC, HIGHLY SUGGESTIVE, AND FAITHFUL TO THE SCRIPT):
   - FORBIDDEN GENERIC, VAGUE, OR POETIC TITLES: Never use abstract titles that hide what specific historical story the video covers.
   - HISTORICAL SPECIFICITY + HIGH-CTR HOOK FORMULA: Explicitly name the historical subject, human group, emblematic place, or concrete event from the Reference Script (years in digits, centuries/monarchs in Roman numerals) JOINED with its central conflict, paradox, sacrifice, or revelation.
   - SMART NON-REPETITION: Do not copy word-for-word the exact Thumbnail phrase ("${doc.thumbnailTextOverlay || ''}") or Clip 1 On-Screen Hook ("${doc.clip1Line2Hook || ''}"), while directly naming the real historical topic, place, or protagonist.
4. DESCRIPTION IN EXACTLY 3 PARAGRAPHS separated by Braille blank lines (⠀).
5. Mandatory "Capítulos:" section with 10 chronological Spanish chapters (where 00:00 starts directly inside the story; NEVER write "Prólogo" or "Introducción").
6. Official Spanish AI Note verbatim: (Nota: Este documental inmersivo ha sido recreado utilizando herramientas de inteligencia artificial generativa basándonos estrictamente en registros históricos de la época. Es posible que existan incongruencias o errores visuales).
7. Official Spanish Slogan verbatim: Cada historia deja una huella. Aquí seguimos sus rastros.
8. Exactly 5 Spanish hashtags in #CamelCase composed of TWO WORDS each.`;
    } else if (stageNumber === 112) {
      stagePrompt = `[STAGE_112_FACEBOOK_METADATA]
Act as Publishing Strategist for the Spanish-language historical documentary channel "Huellas de la Humanidad".
Topic: ${doc.topic || doc.title} (${doc.historicalTime || doc.historicalEra || ''}, ${doc.historicalLocation || doc.cityCountry || ''})
Confirmed Final Duration: ${doc.confirmedFinalDuration || '02:00'}
Platform: FACEBOOK
Thumbnail On-Screen Text: ${doc.thumbnailTextOverlay || ''}
First ${voiceEntrySec} seconds On-Screen Text (Clip 1): ${doc.clip1Line2Hook || ''}
ACTUAL Reference Script (ABSOLUTE PRIORITY for writing an ultra-specific Title faithful to the real story): ${(doc.voiceoverScript || '').slice(0, 1500)}

CRITICAL OUTPUT LANGUAGE REQUIREMENT: Generate STAGE 11 FACEBOOK PUBLISHING METADATA IN NEUTRAL SPANISH in seamless "Todo Corrido" copy-paste format separated ONLY by lines containing the Braille blank character (⠀), strictly obeying these unbreakable rules:
1. ZERO section headers anywhere in the output (forbidden to write "Título:", "Descripción:", "Nota IA:", "Slogan:", "Hashtags:").
2. NO Chapters section and NO SEO Tags block (strictly forbidden on Facebook).
3. Total length ~3000 characters counting spaces and Braille lines (⠀) from the start of the title to the end of the 5 hashtags.
4. UNBREAKABLE VIDEO TITLE RULE (ULTRA-SPECIFIC, HIGHLY SUGGESTIVE, AND FAITHFUL TO THE SCRIPT):
   - Never use abstract or generic titles. Explicitly name the historical subject, human group, emblematic place, or concrete event from the Reference Script (years in digits, centuries/monarchs in Roman numerals) JOINED with its central conflict or revelation, without copying word-for-word "${doc.thumbnailTextOverlay || ''}" or "${doc.clip1Line2Hook || ''}".
5. DESCRIPTION IN EXACTLY 3 PARAGRAPHS separated by Braille blank lines (⠀).
6. Official Spanish AI Note verbatim: (Nota: Este video inmersivo ha sido recreado utilizando herramientas de inteligencia artificial generativa basándonos estrictamente en registros históricos de la época. Es posible que existan incongruencias o errores visuales).
7. Official Spanish Slogan verbatim: Cada historia deja una huella. Aquí seguimos sus rastros.
8. Exactly 5 Spanish hashtags in #CamelCase composed of TWO WORDS each.`;
    } else if (stageNumber === 113) {
      stagePrompt = `[STAGE_113_PINNED_COMMENT]
Act as Community & Retention Strategist for the Spanish-language historical documentary channel "Huellas de la Humanidad".
Video Topic: ${doc.topic || doc.title} (${doc.historicalTime || doc.historicalEra || ''}, ${doc.historicalLocation || doc.cityCountry || ''})
Script / Context: ${(doc.voiceoverScript || doc.sectionsStructure || '').slice(0, 1200)}

CRITICAL OUTPUT LANGUAGE REQUIREMENT: Generate EXCLUSIVELY the VIDEO PINNED COMMENT IN NEUTRAL SPANISH strictly obeying these unbreakable rules:
1. Deliver 1 single concise paragraph with zero headers, labels, or quotation marks (forbidden to write "Comentario Fijado:").
2. CONCISE LENGTH (~350 to 500 characters max, ~60 to 85 words, EXACTLY 3 SENTENCES):
   - Sentence 1 (Brief human bridge): One short sentence connecting that historical journey, era, or event with our present-day roots, surnames, customs, or collective memory (FORBIDDEN to re-summarize the documentary or recite statistics).
   - Sentence 2 (Warm direct question "¿...?"): One direct question inviting the viewer to share a family memory/story connected to the topic or weigh in on the episode's central human dilemma.
   - Sentence 3 (Warm closing): A brief invitation to comment (e.g., "Cuéntanos tu historia o reflexión aquí abajo, te leemos en los comentarios.").
3. Strictly forbidden to ask for "likes" or "subscriptions", and strictly forbidden to use exclamation marks (!).
4. Write all years in digits and all centuries/numbered monarchs in Roman numerals.`;
    } else if (stageNumber === 114) {
      stagePrompt = `[STAGE_114_SEO_TAGS]
Act as YouTube SEO Specialist for the Spanish-language historical documentary channel "Huellas de la Humanidad".
Video Topic: ${doc.topic || doc.title} (${doc.historicalTime || doc.historicalEra || ''}, ${doc.historicalLocation || doc.cityCountry || ''})
Script / Context: ${(doc.voiceoverScript || doc.sectionsStructure || '').slice(0, 1200)}

CRITICAL OUTPUT LANGUAGE REQUIREMENT: Generate EXCLUSIVELY the YOUTUBE SEO TAGS BLOCK IN SPANISH strictly obeying these unbreakable rules:
1. Output ONLY comma-separated Spanish tags in one continuous block, with zero headers or labels (forbidden to write "Tags:" or "SEO Tags:").
2. Total character count must be ~460 to 500 characters including spaces and commas (NEVER exceed 500 characters).
3. Include high-search-volume Spanish keywords covering the historical event, figures, era, location, and history documentaries.`;
    } else if (stageNumber === 115) {
      stagePrompt = `[STAGE_115_YOUTUBE_5_TITLES]
Act as Editorial Director and High-CTR Strategist on YouTube and Facebook for the Spanish-language historical documentary channel "Huellas de la Humanidad".
Documentary Topic: ${doc.topic || doc.title} (${doc.historicalTime || doc.historicalEra || ''}, ${doc.historicalLocation || doc.cityCountry || ''})
ACTUAL Documentary Script:
"""
${(doc.voiceoverScript || doc.sectionsStructure || '').slice(0, 2200)}
"""
CRITICAL OUTPUT LANGUAGE REQUIREMENT: Generate—in NEUTRAL SPANISH—EXACTLY 5 VIDEO TITLE options that are ULTRA-SPECIFIC, SUGGESTIVE, MAGNETIC, and directly anchored in the central story of the script (explicitly naming the historical event, collective, or real protagonist joined with its most striking conflict or revelation, with years in digits and centuries/monarchs in Roman numerals). Output ONLY the 5 Spanish titles, one per line, with zero numbering and zero quotation marks.`;
    }

    if (customInstruction) {
      stagePrompt += `\n\nAdditional Director Instruction: ${customInstruction}`;
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

    const auditPrompt = `Act as Film Director, Historian, and Continuity Supervisor for "Huellas de la Humanidad".
Your task is to audit the visual and narrative coherence across:
1) RAW VOICEOVER SCRIPT WITH PAUSES (Spanish reference):
"""
${doc.voiceoverScript || ''}
"""

2) TIMESTAMPED VOICEOVER TIMELINE (Narration Timeline Extractor):
"""
${doc.timelineFormattedText || ''}
"""

3) CURRENT DOCUMENTARY CLIPS (Topic: "${doc.topic || doc.title}", Era: "${doc.historicalTime}", Location: "${doc.historicalLocation}"):
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

CLIP-BY-CLIP AUDIT RULES:
- For Clip 1 (00:00 - 00:04 / 00:06): Silent visual opening hook with ambient Foley only. Verify it is dramatic, historically grounded, and aligned with the central topic.
- For every Clip from Clip 2 onward:
  1. Check whether the Starting Image Prompt (Image N) and Video Prompt (Clip N) make direct VISUAL AND NARRATIVE SENSE with what the narrator says in "narrationSegment" during "timeRange".
  2. STRICT NON-DUPLICATION BETWEEN CONSECUTIVE CLIPS (Clip N vs Clip N-1): If the narration stays on the same scene or storyline across multiple clips, Clip [N] MUST NEVER visually duplicate the staging of Clip [N-1] (forbidden to chain two wooden office desks with documents or two identical rooms back-to-back). If Clip [N] repeats a setting or composition similar to Clip [N-1], flag it as "warning" or "mismatch" and propose in "suggestedImagePrompt" and "suggestedVideoPrompt" una escena visualmente diferente pero referente a la locución (ej. pasar de un interior de oficina a un exterior luminoso en un muelle frente a un buque de vapor, o cambiar radicalmente de entorno y escala).
  3. If the narrator speaks about a specific place, object, or action while the clip depicts something disconnected or repetitive, flag it as "mismatch" or "warning".
  4. Check pause tags ([pausa: Xs]): If mid-clip the narrator pauses and shifts to a completely new scene, suggest a two-shot 5s+5s sequence; otherwise enforce "single continuous shot, strictly no shot changes".
  5. 100% PURE ENGLISH PROMPTS FOR GOOGLE FLOW: Whenever a clip has empty, overloaded, or improvable prompts, write "suggestedImagePrompt" IN PURE ENGLISH (starting with "Image [N]: Create an image of ", concise ~20-35 English words with era, location, clear subject, ending with "cinematic lighting, historical accuracy, no text.") and "suggestedVideoPrompt" IN PURE ENGLISH (starting with "Clip [N] ([timeRange]): Create a video showing ", 1 short English sentence with 1 smooth camera movement + 1 physical micro-action on the starting image, followed by "Ambient Foley: [2-3 period sounds], single continuous shot, strictly no shot changes, no music, no speech, no text. [Model: Omni 1.1 Flash or Veo 3.1 - Lite [Lower Priority]] fix the name" — NEVER embed Spanish voiceover sentences).
  6. If the clip is already coherent and obeys all rules, set auditStatus: "ok", briefly explain why in Spanish in "auditReason", and leave "suggestedImagePrompt" and "suggestedVideoPrompt" as empty strings ("").

Return EXCLUSIVELY a valid JSON object with the "audits" array property:
{
  "summary": "Brief overall timeline review summary in Spanish for the producer UI",
  "audits": [
    {
      "clipNumber": 1,
      "auditStatus": "ok" | "warning" | "mismatch",
      "auditReason": "Clear explanation in Spanish of whether the clip matches the voiceover or what change is suggested",
      "suggestedImagePrompt": "Image N: Create an image ... (100% pure English only if change needed, otherwise empty string)",
      "suggestedVideoPrompt": "Clip N (MM:SS - MM:SS): Create a video ... fix the name (100% pure English only if change needed, otherwise empty string)"
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

    const promptText = `Act as Film Director, Historian, and Visual Quality Control Supervisor for "Huellas de la Humanidad".
You have just received ${frameList.length} real extracted video frames (beginning, middle, and end) from the video generated in Google Flow for Clip #${clipObj.clipNumber || 1} (Attempt #${attempt || 1}).

DOCUMENTARY CONTEXT:
- Title / Topic: ${doc.topic || doc.title || ''}
- Historical Era: ${doc.historicalTime || ''}
- Historical Location: ${doc.historicalLocation || ''}

CLIP #${clipObj.clipNumber || 1} DATA (${clipObj.timeRange || ''}):
- Spanish Voiceover in this clip (reference context): "${
      Number(clipObj.clipNumber) === 1
        ? '[Clip 1 Silent Opening Hook — Foley & On-Screen Text Only: ' +
          (doc.clip1Line1LocationTime || '') +
          ' / ' +
          (doc.clip1Line2Hook || '') +
          ']'
        : clipObj.narrationSegment || ''
    }"
- Starting Image Prompt: ${clipObj.imagePrompt || ''}
- Video Prompt sent to Google Flow: ${clipObj.videoPrompt || ''}

YOUR VISUAL AUDIT TASK (REAL VIDEO FRAMES vs PROMPT vs VOICEOVER):
Carefully inspect the attached real video frames and evaluate:
1. VOICEOVER COHERENCE: Does what appears on screen directly support and make visual sense with what the narrator says in this segment?
2. PROMPT & HISTORICAL FIDELITY: Does it respect the historical era (${doc.historicalTime || ''}), setting, and primary action described in the prompt?
3. VISUAL QUALITY & ZERO AI ARTIFACTS: Is it free from severe anatomical distortions (warped faces/hands), modern anachronisms, black frames, or garbled burned-in text?

VERDICT CRITERIA:
- "approved": Video looks solid, matches both the voiceover and the prompt (score >= 75).
- "warning": Video is usable with only a minor imperfection (score 60-74).
- "rejected": Video FAILS to match the voiceover, ignored the prompt, or exhibits severe visual artifacts/anachronisms (score < 60). If "rejected", you MUST write in "fixedVideoPrompt" a clearer, simpler, corrected video prompt IN 100% PURE ENGLISH for Google Flow starting with "Clip ${clipObj.clipNumber || 1} (${clipObj.timeRange || '00:00 - 00:10'}): Create a video showing ..." (NEVER embed Spanish voiceover sentences inside fixedVideoPrompt) and ending with "[Model: Omni 1.1 Flash or Veo 3.1 - Lite [Lower Priority]] fix the name".

Return EXCLUSIVELY a valid JSON object:
{
  "clipNumber": ${Number(clipObj.clipNumber) || 1},
  "verdict": "approved" | "warning" | "rejected",
  "score": 90,
  "narrationMatch": true,
  "promptMatch": true,
  "visualQualityOk": true,
  "auditReason": "Concise explanation in Spanish for the producer UI describing what is visible in the video and why it passes or fails",
  "issues": ["List of detected issues in Spanish if any"],
  "fixedVideoPrompt": "100% pure English corrected prompt ready to re-send to Google Flow if verdict is rejected, or empty string if approved"
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
    const defaultVideosDir =
      '/Users/raydelsantana/Library/Mobile Documents/com~apple~CloudDocs/0YouTube/Huellas de la Humanidad/Videos';
    const hasDefaultVideosDir = fs.existsSync(defaultVideosDir);
    const appleScript = hasDefaultVideosDir
      ? `tell application "System Events" to activate\nPOSIX path of (choose folder with prompt "Selecciona o crea (Nueva carpeta) la carpeta raíz para este documental:" default location (POSIX file "${defaultVideosDir}"))`
      : `tell application "System Events" to activate\nPOSIX path of (choose folder with prompt "Selecciona o crea (Nueva carpeta) la carpeta raíz para este documental:")`;
    execFile(
      'osascript',
      ['-e', appleScript],
      (err, stdout) => {
        if (err) {
          res.status(400).json({ cancelled: true, error: 'Selección de carpeta cancelada.' });
          return;
        }
        const folderPath = (stdout || '').trim().replace(/\/+$/, '');
        const folderName = path.basename(folderPath);
        const subfolders = [
          '01_Guion_y_SEO',
          '02_Audio',
          '03_Miniaturas',
          '04_Referencias',
          '05_Clips_Video',
          '06_Video_Final',
        ];
        for (const sub of subfolders) {
          try {
            fs.mkdirSync(path.join(folderPath, sub), { recursive: true });
          } catch {}
        }
        res.json({ ok: true, folderPath, folderName });
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
  if (/^(?:0*\d+[_\-\s.]|(?:clip|video|inicial|initial|broll|b[\-_]?roll|image|imagen|scene|escena)[_\-\s.]*0*\d+(?:[_\-\s.(]|$))/i.test(clean) && /\.(mp4|webm|mov|png|jpg|jpeg|webp)$/i.test(clean)) {
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
  const localStatic = path.join(process.cwd(), 'node_modules', 'ffmpeg-static', 'ffmpeg');
  const candidates = [ffmpegStatic || '', localStatic, '/usr/local/bin/ffmpeg', '/opt/homebrew/bin/ffmpeg', 'ffmpeg'];
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
        for (const cacheSub of ['.optical_flow_cache', '.foley_only_cache', '.vocals_clean_cache', '.music_clean_cache']) {
          const cacheDir = path.join(targetDir, cacheSub);
          if (fs.existsSync(cacheDir)) {
            for (const cEntry of fs.readdirSync(cacheDir)) {
              if (cEntry.startsWith(prefix)) {
                try {
                  fs.unlinkSync(path.join(cacheDir, cEntry));
                } catch {}
              }
            }
          }
        }
        // Extract/update initial frame .jpg for the 4K clip
        const baseNo4k = path.basename(safeName, path.extname(safeName)).replace(/[_\-]4k$/i, '');
        const suffixWithoutNum = baseNo4k.replace(/^0*\d+_/, '');
        const frameFileName = `${paddedNum}_Imagen_Inicial_${suffixWithoutNum}.jpg`;
        const frameFullPath = path.join(targetDir, frameFileName);
        try {
          const ffmpegBin = getFfmpegPath();
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
      resolveLocalDocumentaryFolder(folderPath, folderName, docTitle) ||
      (folderPath && String(folderPath).trim() && fs.existsSync(String(folderPath).trim())
        ? String(folderPath).trim()
        : '');
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
        for (const cacheSub of ['.optical_flow_cache', '.foley_only_cache', '.vocals_clean_cache', '.music_clean_cache']) {
          const cacheDir = path.join(targetDir, cacheSub);
          if (fs.existsSync(cacheDir)) {
            for (const cEntry of fs.readdirSync(cacheDir)) {
              if (cEntry.startsWith(prefix)) {
                try {
                  fs.unlinkSync(path.join(cacheDir, cEntry));
                } catch {}
              }
            }
          }
        }
        // Extract/update initial frame .jpg for the 4K clip
        const baseNo4k = path.basename(safeName, path.extname(safeName)).replace(/[_\-]4k$/i, '');
        const suffixWithoutNum = baseNo4k.replace(/^0*\d+_/, '');
        const frameFileName = `${paddedNum}_Imagen_Inicial_${suffixWithoutNum}.jpg`;
        const frameFullPath = path.join(targetDir, frameFileName);
        try {
          const ffmpegBin = getFfmpegPath();
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
let activeRenderJobState: {
  running: boolean;
  progressPct: number;
  currentStep: number;
  totalSteps: number;
  stageLabel: string;
  startedAt: number;
  outputPath?: string;
  fileName?: string;
  error?: string;
} = {
  running: false,
  progressPct: 0,
  currentStep: 0,
  totalSteps: 0,
  stageLabel: '',
  startedAt: 0,
};

app.get('/api/editor/render-status', (_req, res) => {
  res.json({ ok: true, ...activeRenderJobState });
});

const clipRoomToneAnalysisCache = new Map<
  string,
  { rtStartRel: number; rtEndRel: number; crestRatio: number }
>();

/**
 * Analyzes the trimmed audio stream of a video clip (8kHz mono s16le PCM) in ~15ms to find:
 * 1) The flattest, lowest-energy "Room Tone" window (rtStartRel .. rtEndRel) with zero foley spikes,
 *    used to extend the tail when the video is slowed down without repeating any visual foley impact.
 * 2) The overall crest ratio (peak / median RMS) to distinguish continuous ambient textures
 *    (waves, wind, rain, fire, crowd murmur -> play at 1.0x natural speed) from isolated foley
 *    transients (clamp speed >= 0.88x so it never sounds dragged or metallic).
 */
async function analyzeClipAudioRoomToneAndCrest(
  ffmpegBin: string,
  sourceMp4: string,
  trimStartSec: number,
  sourceSpanSec: number
): Promise<{ rtStartRel: number; rtEndRel: number; crestRatio: number }> {
  const safeSpan = Math.max(0.6, sourceSpanSec);
  const winDur = Math.min(1.6, Math.max(0.5, safeSpan * 0.45));
  const defaultRtStart = Math.max(0, Math.min(safeSpan - winDur, safeSpan * 0.65));
  const fallback = {
    rtStartRel: Number(defaultRtStart.toFixed(3)),
    rtEndRel: Number((defaultRtStart + winDur).toFixed(3)),
    crestRatio: 1.8,
  };

  if (!sourceMp4 || !fs.existsSync(sourceMp4) || safeSpan < 0.7) {
    return fallback;
  }

  let mtimeMs = 0;
  try {
    mtimeMs = Math.floor(fs.statSync(sourceMp4).mtimeMs);
  } catch {}
  const cacheKey = `${sourceMp4}|${mtimeMs}|${trimStartSec.toFixed(2)}|${safeSpan.toFixed(2)}`;
  const cached = clipRoomToneAnalysisCache.get(cacheKey);
  if (cached) return cached;

  return new Promise((resolve) => {
    const sampleRate = 8000;
    const args: string[] = ['-nostdin', '-v', 'error'];
    if (trimStartSec > 0.01) {
      args.push('-ss', trimStartSec.toFixed(3));
    }
    args.push(
      '-t',
      safeSpan.toFixed(3),
      '-i',
      sourceMp4,
      '-vn',
      '-ac',
      '1',
      '-ar',
      String(sampleRate),
      '-f',
      's16le',
      'pipe:1'
    );

    const proc = spawn(ffmpegBin, args, { stdio: ['ignore', 'pipe', 'ignore'] });
    const chunks: Buffer[] = [];
    const timer = setTimeout(() => {
      try {
        proc.kill('SIGKILL');
      } catch {}
      resolve(fallback);
    }, 3500);

    proc.stdout?.on('data', (chunk: Buffer) => {
      chunks.push(chunk);
    });

    proc.on('close', () => {
      clearTimeout(timer);
      try {
        const pcm = Buffer.concat(chunks);
        const totalSamples = Math.floor(pcm.length / 2);
        const minSamplesNeeded = Math.floor(sampleRate * 0.6);
        if (totalSamples < minSamplesNeeded) {
          resolve(fallback);
          return;
        }

        // Compute RMS and Peak in 100ms frames (800 samples per frame)
        const frameSamples = 800;
        const numFrames = Math.floor(totalSamples / frameSamples);
        if (numFrames < 5) {
          resolve(fallback);
          return;
        }

        const frameRms: number[] = new Array(numFrames);
        const framePeak: number[] = new Array(numFrames);
        for (let f = 0; f < numFrames; f++) {
          let sumSq = 0;
          let maxAbs = 0;
          const baseIdx = f * frameSamples;
          for (let s = 0; s < frameSamples; s++) {
            const val = pcm.readInt16LE((baseIdx + s) * 2) / 32768;
            const abs = Math.abs(val);
            sumSq += val * val;
            if (abs > maxAbs) maxAbs = abs;
          }
          frameRms[f] = Math.sqrt(sumSq / frameSamples);
          framePeak[f] = maxAbs;
        }

        // Compute overall clip crest ratio (95th percentile frame RMS / median frame RMS)
        const sortedRms = [...frameRms].sort((a, b) => a - b);
        const medianRms = Math.max(0.0005, sortedRms[Math.floor(sortedRms.length * 0.5)]);
        const p95Rms = sortedRms[Math.min(sortedRms.length - 1, Math.floor(sortedRms.length * 0.95))];
        const crestRatio = Number((p95Rms / medianRms).toFixed(2));

        // Slide a window of winFrames (e.g. 16 frames = 1.6s) to find the flattest, spike-free room tone
        const winFrames = Math.max(4, Math.min(numFrames - 1, Math.round(winDur * 10)));
        let bestStartFrame = Math.max(0, Math.floor(numFrames * 0.6));
        let bestScore = Number.POSITIVE_INFINITY;

        const searchStart = Math.min(2, Math.floor(numFrames * 0.08));
        const searchEnd = Math.max(searchStart, numFrames - winFrames - 1);

        for (let i = searchStart; i <= searchEnd; i++) {
          let sumRms = 0;
          let maxFrameRms = 0;
          let maxFramePk = 0;
          for (let k = 0; k < winFrames; k++) {
            const r = frameRms[i + k];
            const pk = framePeak[i + k];
            sumRms += r;
            if (r > maxFrameRms) maxFrameRms = r;
            if (pk > maxFramePk) maxFramePk = pk;
          }
          const avgRms = sumRms / winFrames;
          // Penalize windows that are dead-silent (< 10% of medianRms) or contain transient spikes
          const silencePenalty = avgRms < medianRms * 0.1 ? medianRms * 4 : 0;
          const spikePenalty = (maxFrameRms - avgRms) * 3.5 + maxFramePk * 0.6;
          // Slight preference for windows in the second half of the clip so room tone matches the scene exit
          const positionBias = (1 - i / Math.max(1, searchEnd)) * medianRms * 0.15;
          const score = avgRms + spikePenalty + silencePenalty + positionBias;
          if (score < bestScore) {
            bestScore = score;
            bestStartFrame = i;
          }
        }

        const actualStreamDur = totalSamples / sampleRate;
        const rtStartRel = Math.max(
          0,
          Math.min(actualStreamDur - winDur, bestStartFrame * 0.1)
        );
        const rtEndRel = Math.min(actualStreamDur, rtStartRel + winDur);
        const result = {
          rtStartRel: Number(rtStartRel.toFixed(3)),
          rtEndRel: Number(rtEndRel.toFixed(3)),
          crestRatio,
        };
        clipRoomToneAnalysisCache.set(cacheKey, result);
        resolve(result);
      } catch {
        resolve(fallback);
      }
    });

    proc.on('error', () => {
      clearTimeout(timer);
      resolve(fallback);
    });
  });
}

/**
 * Builds an FFmpeg audio filter chain that NEVER stretches clip audio into dragged/metallic slow-motion:
 * - For normal or sped-up clips (rawSpeed >= 0.94): plays normally (clamping speed-ups to <= 1.25x).
 * - For slowed-down clips (rawSpeed < 0.94):
 *   * Continuous ambient clips (crestRatio <= 2.2) play at 1.00x (zero atempo).
 *   * Clips with distinct foley transients (crestRatio > 2.2) clamp audio speed to >= 0.88x.
 *   * Any remaining tail duration needed to cover targetDurSec is filled exclusively by looping and
 *     crossfading the clip's own flattest "Room Tone" window (lowpass=3000Hz, volume=0.82), so no
 *     foley impact or transient is ever repeated out of visual sync.
 */
async function buildSmartNaturalFoleyFilter(opts: {
  ffmpegBin: string;
  sourceMp4: string;
  trimStartSec: number;
  sourceSpanSec: number;
  targetDurSec: number;
  rawSpeed: number;
  afFadePrefix?: string;
  foleyVol: number;
  isIntroOrOutro?: boolean;
}): Promise<string> {
  const {
    targetDurSec,
    rawSpeed,
    afFadePrefix = '',
    foleyVol,
    isIntroOrOutro = false,
  } = opts;

  const safeTargetDur = Math.max(0.3, targetDurSec);
  const targetAudioSamples = Math.max(1024, Math.round(safeTargetDur * 44100) - 1024);
  const afTrimSuffix = `,aresample=44100,aformat=sample_fmts=fltp:sample_rates=44100:channel_layouts=stereo,apad,atrim=end_sample=${targetAudioSamples},asetpts=N/SR/TB`;

  if (isIntroOrOutro || foleyVol <= 0.0001) {
    return `${afFadePrefix}volume=${foleyVol.toFixed(4)}${afTrimSuffix}`;
  }

  // Keep clip audio 100% locked to exact video playback rate so visual actions and audio never desync.
  // For slowed-down clips (rawSpeed < 0.94), apply warm cinema filtering (highpass 85Hz + lowpass 7200Hz)
  // to eliminate high-frequency WSOLA metallic ringing while preserving exact frame-locked foley timing.
  const clampedSpeed = Math.max(0.25, Math.min(2.0, Number.isFinite(rawSpeed) && rawSpeed > 0 ? rawSpeed : 1));
  const atempoStage =
    clampedSpeed < 0.5
      ? `atempo=0.5,atempo=${Math.max(0.5, clampedSpeed / 0.5).toFixed(4)},`
      : Math.abs(clampedSpeed - 1) >= 0.012
      ? `atempo=${clampedSpeed.toFixed(4)},`
      : '';
  const warmSlowMoFilter =
    clampedSpeed < 0.94 ? 'highpass=f=85,lowpass=f=7200,' : '';

  return `${atempoStage}${warmSlowMoFilter}${afFadePrefix}volume=${foleyVol.toFixed(4)}${afTrimSuffix}`;
}

const EDITOR_CLIENT_STATE_FILE = path.join(process.cwd(), 'data', 'editor-client-state.json');

app.post('/api/editor/sync-client-state', (req, res) => {
  try {
    const incoming = req.body || {};
    let existing: Record<string, any> = {};
    if (fs.existsSync(EDITOR_CLIENT_STATE_FILE)) {
      try {
        existing = JSON.parse(fs.readFileSync(EDITOR_CLIENT_STATE_FILE, 'utf8')) || {};
      } catch {}
    }
    const merged = {
      ...existing,
      ...incoming,
      formatProfiles: {
        ...(existing.formatProfiles || {}),
        ...(incoming.formatProfiles || {}),
      },
      updatedAt: new Date().toISOString(),
    };
    fs.mkdirSync(path.dirname(EDITOR_CLIENT_STATE_FILE), { recursive: true });
    fs.writeFileSync(EDITOR_CLIENT_STATE_FILE, JSON.stringify(merged, null, 2), 'utf8');
    res.json({ ok: true });
  } catch (err: any) {
    res.status(500).json({ ok: false, error: err?.message || 'Failed to sync client state' });
  }
});

app.get('/api/editor/sync-client-state', (_req, res) => {
  try {
    if (fs.existsSync(EDITOR_CLIENT_STATE_FILE)) {
      const data = JSON.parse(fs.readFileSync(EDITOR_CLIENT_STATE_FILE, 'utf8'));
      res.json({ ok: true, state: data });
      return;
    }
    res.json({ ok: true, state: null });
  } catch (err: any) {
    res.status(500).json({ ok: false, error: err?.message || 'Failed to read client state' });
  }
});

app.post('/api/editor/update-clip-reframe-9x16', (req, res) => {
  try {
    const {
      folderPath,
      folderName = '',
      docTitle = '',
      clipNumber,
      reframe9x16Mode = 'manual',
      focusXStart = 50,
      focusXEnd = 50,
      focusY = 50,
      reason = 'Ajuste manual usuario',
    } = req.body || {};
    const cNum = Number(clipNumber);
    if (!Number.isFinite(cNum) || cNum <= 0) {
      res.status(400).json({ ok: false, error: 'Invalid clipNumber' });
      return;
    }
    const resolvedDocFolder = resolveLocalDocumentaryFolder(folderPath, folderName, docTitle);
    if (resolvedDocFolder) {
      const cacheFile = path.join(resolvedDocFolder, '05_Clips_Video', '.reframe_9x16_cache.json');
      if (fs.existsSync(cacheFile)) {
        try {
          const cacheObj = JSON.parse(fs.readFileSync(cacheFile, 'utf8')) || {};
          let updatedAny = false;
          for (const [k, v] of Object.entries(cacheObj)) {
            if (v && typeof v === 'object' && Number((v as any).clipNumber) === cNum) {
              cacheObj[k] = {
                ...(v as any),
                reframe9x16Mode,
                focusXStart: Number(focusXStart),
                focusXEnd: Number(focusXEnd),
                focusY: Number(focusY),
                reason,
                userReframed9x16: true,
              };
              updatedAny = true;
            }
          }
          if (updatedAny) {
            fs.writeFileSync(cacheFile, JSON.stringify(cacheObj, null, 2), 'utf8');
          }
        } catch {}
      }
    }
    res.json({ ok: true });
  } catch (err: any) {
    res.status(500).json({ ok: false, error: err?.message || 'Failed to update clip reframe' });
  }
});

app.post('/api/editor/render-ffmpeg', async (req, res) => {
  const startedAt = Date.now();
  const workDir = path.join(os.tmpdir(), `huellas_ffmpeg_render_${startedAt}`);
  try {
    const {
      folderPath,
      folderName = '',
      docTitle,
      aspectRatio = '16:9',
      resolution = 'HD_1080P',
      fps = 30,
      bitrateMbps = 0,
      clips = [],
      voiceoverStartSec = 6,
      voiceoverVolume = 1.0,
      voiceoverGainDb = 5,
      voiceoverDataUrl = '',
      sunoSilenceGapSec = 15,
      sunoMasterVolume = 0.14,
      musicTracks = [],
      srtContent = '',
      overlays = {},
    } = req.body;

    const resolvedDocFolder = resolveLocalDocumentaryFolder(folderPath, folderName, docTitle);
    const targetRoot =
      resolvedDocFolder ||
      (folderPath && String(folderPath).trim()
        ? String(folderPath).trim()
        : path.join(process.env.HOME || '/tmp', 'Downloads'));

    if (!fs.existsSync(targetRoot)) {
      fs.mkdirSync(targetRoot, { recursive: true });
    }
    if (!fs.existsSync(workDir)) {
      fs.mkdirSync(workDir, { recursive: true });
    }

    // Automatic macOS iCloud Drive storage guard: if free SSD space < 45 GB, evict local cache of older sibling episodes in both Videos/ and Reels/ already uploaded to iCloud
    if (process.platform === 'darwin' && targetRoot.includes('com~apple~CloudDocs')) {
      try {
        const dfOut = execSync('df -k /', { encoding: 'utf8' });
        const dfLines = dfOut.trim().split('\n');
        const cols = (dfLines[1] || '').trim().split(/\s+/);
        const availKb = parseInt(cols[3] || '0', 10);
        const availGb = availKb / (1024 * 1024);
        if (availGb > 0 && availGb < 45) {
          const parentDir = path.dirname(targetRoot);
          const channelRootDir = path.dirname(parentDir);
          const candidateParentDirs = Array.from(
            new Set([
              parentDir,
              path.join(channelRootDir, 'Videos'),
              path.join(channelRootDir, 'Reels'),
            ])
          );
          const currentResolved = path.resolve(targetRoot).normalize('NFC');
          for (const dirToScan of candidateParentDirs) {
            if (!fs.existsSync(dirToScan)) continue;
            const siblings = fs.readdirSync(dirToScan, { withFileTypes: true });
            for (const sib of siblings) {
              if (!sib.isDirectory()) continue;
              const sibPath = path.join(dirToScan, sib.name);
              if (path.resolve(sibPath).normalize('NFC') === currentResolved) continue;
              try {
                execSync(`brctl evict "${sibPath.replace(/"/g, '\\"')}"`, {
                  stdio: 'ignore',
                  timeout: 8000,
                });
              } catch {}
            }
          }
        }
      } catch {}
    }

    // Resolution dimensions & default bitrates
    const resMap: Record<
      string,
      { w169: number; h169: number; label: string; defaultBitrateMbps: number }
    > = {
      HD_1080P: { w169: 1920, h169: 1080, label: 'HD_1080p', defaultBitrateMbps: 18 },
      '2K_1440P': { w169: 2560, h169: 1440, label: '2K_1440p', defaultBitrateMbps: 35 },
      '4K_2160P': { w169: 3840, h169: 2160, label: '4K_2160p', defaultBitrateMbps: 65 },
      '8K_4320P': { w169: 7680, h169: 4320, label: '8K_4320p', defaultBitrateMbps: 140 },
    };
    const preset = resMap[resolution] || resMap.HD_1080P;
    const isIntelMac = (os.cpus()[0]?.model || '').includes('Intel');
    const rawOutW = aspectRatio === '9:16' ? preset.h169 : preset.w169;
    const rawOutH = aspectRatio === '9:16' ? preset.w169 : preset.h169;
    // On Intel QuickSync GPUs, hardware silicon maxes out at 3840x2160 (4K UHD); keep full ultra bitrate (up to 200 Mbps) on hardware GPU
    const outW = isIntelMac && rawOutW > 3840 ? (aspectRatio === '9:16' ? 2160 : 3840) : rawOutW;
    const outH = isIntelMac && rawOutH > 3840 ? (aspectRatio === '9:16' ? 3840 : 2160) : rawOutH;
    const safeFps = [24, 25, 30, 50, 60].includes(Number(fps)) ? Number(fps) : 30;
    const safeBitrateMbps = Math.max(
      4,
      Math.min(350, Number(bitrateMbps) > 0 ? Number(bitrateMbps) : preset.defaultBitrateMbps)
    );
    const is8K = outW > 4096 || outH > 4096;

    const ffmpegBin = getFfmpegPath();

    activeRenderJobState = {
      running: true,
      progressPct: 2,
      currentStep: 0,
      totalSteps: Math.max(1, clips.length),
      stageLabel: `Preparando capas visuales y ${clips.length} segmentos en ${preset.label} (${safeFps} FPS • ${safeBitrateMbps} Mbps)...`,
      startedAt,
    };

    let savedClientState: Record<string, any> = {};
    if (fs.existsSync(EDITOR_CLIENT_STATE_FILE)) {
      try {
        savedClientState = JSON.parse(fs.readFileSync(EDITOR_CLIENT_STATE_FILE, 'utf8')) || {};
      } catch {}
    }
    const targetFormatKey = aspectRatio === '9:16' || outH > outW ? '9:16' : '16:9';
    const savedFormatProfile = savedClientState?.formatProfiles?.[targetFormatKey] || {};

    // Prepare burned-in overlay PNG files in local SSD temp dir (Logo, Hook Line 1/2, Captions)
    let logoOverlayInfo: {
      filePath: string;
      xPx: number;
      yPx: number;
      wPx: number;
    } | null = null;
    if (overlays?.burnInLogo !== false) {
      const clientPrebakedOpacity = Boolean(overlays?.logo?.pngDataUrl);
      let logoDataUrl = overlays?.logo?.pngDataUrl || '';
      if (!logoDataUrl && fs.existsSync(OFFICIAL_LOGO_FILE)) {
        try {
          const parsedLogo = JSON.parse(fs.readFileSync(OFFICIAL_LOGO_FILE, 'utf8'));
          logoDataUrl = parsedLogo.logoDataUrl || '';
        } catch {}
      }
      const useMigrated16x9Defaults =
        targetFormatKey === '16:9' &&
        !Boolean(savedClientState?.formatProfiles?._v4_16x9_logoDefault5);
      const defaultLogoW = useMigrated16x9Defaults
        ? 5
        : Number(savedFormatProfile.logoScalePct) > 0
        ? Number(savedFormatProfile.logoScalePct)
        : aspectRatio === '9:16' || outH > outW
        ? 12
        : 5;
      const defaultLogoOpacity = useMigrated16x9Defaults
        ? 95
        : typeof savedFormatProfile.logoOpacity === 'number'
        ? Number(savedFormatProfile.logoOpacity)
        : 95;
      const defaultLogoX = useMigrated16x9Defaults
        ? 3
        : typeof savedFormatProfile.logoPosX === 'number'
        ? Number(savedFormatProfile.logoPosX)
        : aspectRatio === '9:16' || outH > outW
        ? 10
        : 3;
      const defaultLogoY = useMigrated16x9Defaults
        ? 3
        : typeof savedFormatProfile.logoPosY === 'number'
        ? Number(savedFormatProfile.logoPosY)
        : 3;
      const wPct = Math.max(1, Math.min(45, Number(overlays?.logo?.wPct ?? defaultLogoW)));
      const xPct = Math.max(0, Math.min(95, Number(overlays?.logo?.xPct ?? defaultLogoX)));
      const yPct = Math.max(0, Math.min(95, Number(overlays?.logo?.yPct ?? defaultLogoY)));
      let rawLogoPath = '';
      if (logoDataUrl && String(logoDataUrl).startsWith('data:')) {
        const cleanB64 = String(logoDataUrl).replace(/^data:[^;]+;base64,/, '');
        const logoFile = path.join(workDir, 'overlay_logo.png');
        fs.writeFileSync(logoFile, Buffer.from(cleanB64, 'base64'));
        rawLogoPath = logoFile;
      } else {
        const diskLogoCandidate = path.join(
          targetRoot,
          '03_Miniaturas',
          'Logo_Huellas_de_la_Humanidad.png'
        );
        const masterLogoCandidate =
          '/Users/raydelsantana/Library/Mobile Documents/com~apple~CloudDocs/0YouTube/Huellas de la Humanidad/LOGO DEFINITIVO.png';
        if (fs.existsSync(diskLogoCandidate)) {
          rawLogoPath = diskLogoCandidate;
        } else if (fs.existsSync(masterLogoCandidate)) {
          rawLogoPath = masterLogoCandidate;
        }
      }
      if (rawLogoPath && fs.existsSync(rawLogoPath)) {
        const targetLogoW = Math.max(24, Math.round((outW * wPct) / 100));
        const prescaledLogoPath = path.join(workDir, 'overlay_logo_scaled.png');
        const clampedOpacity = Math.max(0.05, Math.min(1, defaultLogoOpacity / 100));
        const vfLogo =
          !clientPrebakedOpacity && clampedOpacity < 0.999
            ? `scale=${targetLogoW}:-1,format=rgba,colorchannelmixer=aa=${clampedOpacity.toFixed(2)}`
            : `scale=${targetLogoW}:-1`;
        try {
          execSync(
            `"${ffmpegBin}" -y -i "${rawLogoPath.replace(/"/g, '\\"')}" -vf "${vfLogo}" "${prescaledLogoPath.replace(/"/g, '\\"')}"`,
            { stdio: 'ignore' }
          );
        } catch {}
        logoOverlayInfo = {
          filePath: fs.existsSync(prescaledLogoPath) ? prescaledLogoPath : rawLogoPath,
          wPx: targetLogoW,
          xPx: Math.round((outW * xPct) / 100),
          yPx: Math.round((outH * yPct) / 100),
        };
      }
    }

    const hookOverlayFiles: Array<{
      filePath: string;
      startSec: number;
      endSec: number;
      yPx: number;
      hPx: number;
    }> = [];
    if (overlays?.burnInHook !== false && Array.isArray(overlays?.hookSegments)) {
      for (let hi = 0; hi < overlays.hookSegments.length; hi++) {
        const hs = overlays.hookSegments[hi];
        if (!hs || !hs.pngDataUrl || !String(hs.pngDataUrl).startsWith('data:')) continue;
        const cleanB64 = String(hs.pngDataUrl).replace(/^data:[^;]+;base64,/, '');
        const hf = path.join(workDir, `overlay_hook_${hi}.png`);
        fs.writeFileSync(hf, Buffer.from(cleanB64, 'base64'));
        const yPct = Math.max(0, Math.min(95, Number(hs.yPct ?? 30)));
        const hPct = Math.max(4, Math.min(100, Number(hs.hPct ?? 40)));
        hookOverlayFiles.push({
          filePath: hf,
          startSec: Number(hs.startSec || 0),
          endSec: Number(hs.endSec || 0),
          yPx: Math.round((outH * yPct) / 100),
          hPx: Math.max(24, Math.round((outH * hPct) / 100)),
        });
      }
    }

    const captionOverlayFiles: Array<{
      filePath: string;
      startSec: number;
      endSec: number;
      yPx: number;
      hPx: number;
    }> = [];
    // Only use per-caption PNG inputs if a small custom set (< 40) is passed; otherwise use ultra-fast native libass (.ass) vector subtitles
    if (
      overlays?.burnInCaptions !== false &&
      Array.isArray(overlays?.captionSegments) &&
      overlays.captionSegments.length > 0 &&
      overlays.captionSegments.length <= 40
    ) {
      for (let ci = 0; ci < overlays.captionSegments.length; ci++) {
        const cs = overlays.captionSegments[ci];
        if (!cs || !cs.pngDataUrl || !String(cs.pngDataUrl).startsWith('data:')) continue;
        const cleanB64 = String(cs.pngDataUrl).replace(/^data:[^;]+;base64,/, '');
        const cf = path.join(workDir, `overlay_cap_${String(ci).padStart(4, '0')}.png`);
        fs.writeFileSync(cf, Buffer.from(cleanB64, 'base64'));
        const yPct = Math.max(0, Math.min(96, Number(cs.yPct ?? 72)));
        const hPct = Math.max(4, Math.min(60, Number(cs.hPct ?? 22)));
        captionOverlayFiles.push({
          filePath: cf,
          startSec: Number(cs.startSec || 0),
          endSec: Number(cs.endSec || 0),
          yPx: Math.round((outH * yPct) / 100),
          hPx: Math.max(24, Math.round((outH * hPct) / 100)),
        });
      }
    }

    // Parse SRT subtitles (from payload srtContent or 01_Guion_y_SEO/Subtitulos.srt on disk) for native libass vector burn-in
    interface ParsedTimelineCaption {
      startSec: number;
      endSec: number;
      text: string;
    }
    const parsedTimelineCaptions: ParsedTimelineCaption[] = [];
    if (overlays?.burnInCaptions !== false && captionOverlayFiles.length === 0) {
      let rawSrt = typeof srtContent === 'string' && srtContent.trim() ? srtContent : '';
      if (!rawSrt) {
        const diskSrtCandidates = [
          path.join(targetRoot, '01_Guion_y_SEO', 'Subtitulos.srt'),
          path.join(targetRoot, '03_Subtitulos_SRT', 'Subtitulos.srt'),
          path.join(targetRoot, 'Subtitulos.srt'),
        ];
        for (const sc of diskSrtCandidates) {
          if (fs.existsSync(sc)) {
            rawSrt = fs.readFileSync(sc, 'utf8');
            if (rawSrt.trim()) break;
          }
        }
      }
      if (rawSrt.trim()) {
        const parseSrtTime = (ts: string): number => {
          const m = ts.trim().match(/(\d+):(\d+):(\d+)[,.](\d+)/);
          if (!m) return 0;
          return (
            parseInt(m[1], 10) * 3600 +
            parseInt(m[2], 10) * 60 +
            parseInt(m[3], 10) +
            parseInt(m[4].padEnd(3, '0').slice(0, 3), 10) / 1000
          );
        };
        const blocks = rawSrt.trim().split(/\r?\n\s*\r?\n/);
        const rawParsed: ParsedTimelineCaption[] = [];
        for (const b of blocks) {
          const lines = b.trim().split(/\r?\n/);
          const timeLineIdx = lines.findIndex((l) => l.includes('-->'));
          if (timeLineIdx < 0) continue;
          const [sStr, eStr] = lines[timeLineIdx].split('-->');
          const s = parseSrtTime(sStr || '');
          const e = parseSrtTime(eStr || '');
          const txt = lines
            .slice(timeLineIdx + 1)
            .map((l) => l.replace(/<[^>]+>/g, '').trim())
            .filter(Boolean)
            .join('\n');
          if (txt && e > s + 0.05) {
            rawParsed.push({ startSec: s, endSec: e, text: txt });
          }
        }
        if (rawParsed.length > 0) {
          const firstStart = rawParsed[0].startSec;
          const targetVoStart = Math.max(0, Number(voiceoverStartSec ?? 16));
          let shiftSec = 0;
          if (targetVoStart >= 15 && firstStart >= 7.5 && firstStart <= 10.5) {
            shiftSec = targetVoStart - 8.0;
          } else if (targetVoStart >= 15 && firstStart < 2.5) {
            shiftSec = targetVoStart;
          }
          for (const rp of rawParsed) {
            parsedTimelineCaptions.push({
              startSec: Number((rp.startSec + shiftSec).toFixed(3)),
              endSec: Number((rp.endSec + shiftSec).toFixed(3)),
              text: rp.text,
            });
          }
        }
      }
    }

    const hookTextConfig = overlays?.hookText || null;

    const formatAssTime = (sec: number): string => {
      const clamped = Math.max(0, sec);
      const h = Math.floor(clamped / 3600);
      const m = Math.floor((clamped % 3600) / 60);
      const s = Math.floor(clamped % 60);
      const cs = Math.min(99, Math.round((clamped - Math.floor(clamped)) * 100));
      return `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}.${String(cs).padStart(2, '0')}`;
    };

    const escapeAssText = (t: string): string =>
      String(t || '')
        .replace(/\\/g, '\\\\')
        .replace(/\{/g, '\\{')
        .replace(/\}/g, '\\}')
        .replace(/\r?\n/g, '\\N');

    // 1. Collect all available MP4 clips on disk (from 05_Clips_Video, Clips_Aprobados, or targetRoot)
    const normalizedClipPaths: string[] = [];
    const segmentEncodeTasks: Array<{
      idx: number;
      label: string;
      segOut: string;
      durationSec: number;
      run: () => Promise<void>;
    }> = [];
    const clipsVideoSubdir = path.join(targetRoot, '05_Clips_Video');
    const clipsSubdir = path.join(targetRoot, 'Clips_Aprobados');
    const foleyCacheSubdir = path.join(clipsVideoSubdir, '.foley_only_cache');

    const introOutroDir = path.join(
      process.env.HOME || '/Users/raydelsantana',
      'Library/Mobile Documents/com~apple~CloudDocs/0YouTube/Huellas de la Humanidad/Intro:Outro'
    );

    const reframeCacheByClipNum = new Map<
      number,
      {
        reframe9x16Mode?: string;
        focusXStart?: number;
        focusXEnd?: number;
        focusY?: number;
      }
    >();
    const reframeCacheCandidate = fs.existsSync(path.join(clipsVideoSubdir, '.reframe_9x16_cache.json'))
      ? path.join(clipsVideoSubdir, '.reframe_9x16_cache.json')
      : path.join(targetRoot, '.reframe_9x16_cache.json');
    if (fs.existsSync(reframeCacheCandidate)) {
      try {
        const parsedRf = JSON.parse(fs.readFileSync(reframeCacheCandidate, 'utf8')) || {};
        for (const val of Object.values(parsedRf) as any[]) {
          if (val && typeof val.clipNumber === 'number') {
            reframeCacheByClipNum.set(Number(val.clipNumber), val);
          }
        }
      } catch {}
    }

    let runningTimelineSec = 0;

    for (let i = 0; i < clips.length; i++) {
      const c = clips[i];
      const fileName = c.fileName || `${String(c.clipNumber || i + 1).padStart(2, '0')}_Clip.mp4`;
      let sourceMp4 = '';

      const isIntroClip = Number(c.clipNumber) === 0 || /intro_huellas/i.test(fileName);
      const isOutroClip = Number(c.clipNumber) === 999 || /outro_huellas/i.test(fileName);

      const candidate0 = path.join(clipsVideoSubdir, fileName);
      const candidate1 = path.join(targetRoot, fileName);
      const candidate2 = path.join(clipsSubdir, fileName);
      if (isIntroClip) {
        const introPath = path.join(introOutroDir, 'Intro.mp4');
        if (fs.existsSync(introPath)) sourceMp4 = introPath;
      } else if (isOutroClip) {
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
        sourceMp4 = path.join(workDir, `raw_input_${i + 1}.mp4`);
        fs.writeFileSync(sourceMp4, Buffer.from(cleanB64, 'base64'));
      } else {
        // Fallback: match by prefix number (e.g. "01_") in 05_Clips_Video, targetRoot, or Clips_Aprobados (prioritizing _4K.mp4)
        const num = Number(c.clipNumber || i + 1);
        const prefixRegex = new RegExp(`^(?:(?:clip|broll|b[\\-_]?roll|video)[_\\-\\s.]*)?0*${num}[_\\-\\s.]`, 'i');
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

      // Use c.videoUrl only if sourceMp4 was not already found and it is NOT an audio-separation cache file
      if (!sourceMp4 && c.videoUrl && typeof c.videoUrl === 'string') {
        try {
          const parsedVid = new URL(c.videoUrl, 'http://localhost:4200');
          const vidFile = parsedVid.searchParams.get('filePath');
          if (
            vidFile &&
            fs.existsSync(vidFile) &&
            !vidFile.includes('.foley_only_cache') &&
            !vidFile.includes('.vocals_cache') &&
            !vidFile.includes('.music_cache') &&
            !vidFile.includes('.vocals_clean_cache') &&
            !vidFile.includes('.music_clean_cache')
          ) {
            sourceMp4 = vidFile;
          }
        } catch {}
      }

      // Check if an Optical Flow baked file already exists for this clip segment (only _of3+ in 16:9; in 9:16 always crop/pan directly from the native _4K.mp4 master)
      if (
        aspectRatio !== '9:16' &&
        outW >= outH &&
        c.opticalFlowUrl &&
        typeof c.opticalFlowUrl === 'string'
      ) {
        try {
          const parsedOpt = new URL(c.opticalFlowUrl, 'http://localhost:4200');
          const optFile = parsedOpt.searchParams.get('filePath');
          if (
            optFile &&
            fs.existsSync(optFile) &&
            !optFile.includes('.foley_only_cache') &&
            !optFile.includes('_foley_') &&
            (!optFile.includes('.optical_flow_cache') || optFile.includes('_of3'))
          ) {
            sourceMp4 = optFile;
          }
        } catch {}
      }

      if (!sourceMp4 || !fs.existsSync(sourceMp4)) continue;

      const segOut = path.join(workDir, `seg_${String(i + 1).padStart(3, '0')}.ts`);
      const usingPrebakedOpticalFlow =
        Boolean(c.opticalFlowUrl) && sourceMp4.includes('.optical_flow_cache');
      const slotDur =
        Number(c.durationSec) > 0.3
          ? Number(c.durationSec)
          : Number(c.end) > Number(c.start) + 0.2
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
                  resolve(Math.max(0.3, sec - 0.04));
                  return;
                }
              }
              resolve(0);
            });
            p.on('error', () => resolve(0));
          })
        : 0;

      const trimStartSec =
        usingPrebakedOpticalFlow || isIntroClip || isOutroClip
          ? 0
          : Math.max(0, Number(c.trimStart || 0));
      const rawTrimEnd =
        usingPrebakedOpticalFlow || isIntroClip || isOutroClip
          ? 0
          : Number(c.trimEnd || 0) > trimStartSec
          ? Number(c.trimEnd)
          : 0;
      const trimEndSec =
        !usingPrebakedOpticalFlow && !isIntroClip && !isOutroClip && probedSegDur > 0.4
          ? rawTrimEnd > trimStartSec + 0.1 && rawTrimEnd < probedSegDur - 0.05
            ? rawTrimEnd
            : Math.max(trimStartSec + 0.2, probedSegDur - 0.04)
          : rawTrimEnd;
      const effectiveSpan =
        trimEndSec > trimStartSec + 0.1
          ? trimEndSec - trimStartSec
          : probedSegDur > trimStartSec + 0.2
          ? probedSegDur - trimStartSec
          : 0;
      const speed =
        usingPrebakedOpticalFlow || isIntroClip || isOutroClip
          ? 1
          : slotDur > 0.3 && effectiveSpan > 0.2
          ? Math.max(0.15, Math.min(4.0, effectiveSpan / (slotDur + 0.06)))
          : Number(c.speed) > 0
          ? Number(c.speed)
          : 1;
      const ptsFactor =
        usingPrebakedOpticalFlow || isIntroClip || isOutroClip
          ? '1.0000'
          : slotDur > 0.3 && effectiveSpan > 0.2
          ? ((slotDur + 0.06) / effectiveSpan).toFixed(5)
          : (1 / speed).toFixed(4);
      const isFirstClipAfterIntro =
        !isIntroClip &&
        !isOutroClip &&
        (Number(c.clipNumber) === 1 || (i === 1 && Number(clips[0]?.clipNumber) === 0));
      const nextClipInList = clips[i + 1];
      const isLastBodyClipBeforeOutro =
        !isIntroClip &&
        !isOutroClip &&
        (i === clips.length - 1 ||
          Number(nextClipInList?.clipNumber) === 999 ||
          /outro_huellas/i.test(String(nextClipInList?.fileName || '')));
      const savedClipMatch = Array.isArray(savedClientState?.timelineClips)
        ? savedClientState.timelineClips.find(
            (sc: any) => Number(sc?.clipNumber) === Number(c.clipNumber)
          )
        : undefined;
      const savedAudioEditMatch =
        savedClientState?.clipAudioEdits?.[`num:${Number(c.clipNumber)}:`] ||
        savedClientState?.clipAudioEdits?.[String(c.clipNumber)];
      const isClipMuted =
        Boolean(c.audioMuted) ||
        Boolean(savedClipMatch?.audioMuted) ||
        Boolean(savedAudioEditMatch?.audioMuted) ||
        (typeof c.foleyVolume === 'number' && c.foleyVolume <= 0.0001);
      const foleyVol = isClipMuted
        ? 0
        : typeof c.foleyVolume === 'number' && Number.isFinite(c.foleyVolume)
        ? Math.max(0, Math.min(2.0, c.foleyVolume))
        : typeof savedClipMatch?.foleyVolume === 'number' && Number.isFinite(savedClipMatch.foleyVolume)
        ? Math.max(0, Math.min(2.0, savedClipMatch.foleyVolume / 100))
        : isIntroClip || isOutroClip
        ? 1.0
        : isFirstClipAfterIntro
        ? 0.8
        : 0.2;
      const rawClipDur =
        isIntroClip || isOutroClip
          ? slotDur > 0.5
            ? slotDur
            : 8
          : slotDur > 0.3
          ? slotDur
          : probedSegDur > 0.3
          ? probedSegDur
          : 8;

      const rawSegStartSec =
        Number.isFinite(Number(c.start)) && Number(c.start) >= 0
          ? Number(c.start)
          : runningTimelineSec;
      const rawSegEndSec = rawSegStartSec + rawClipDur;
      runningTimelineSec = rawSegEndSec;

      // Lock segment frame count to cumulative timeline frames so 80+ concatenated segments accumulate 0.000s of video/caption drift
      const segStartFrame = Math.round(rawSegStartSec * safeFps);
      const segEndFrame = Math.max(segStartFrame + 1, Math.round(rawSegEndSec * safeFps));
      const targetSegFrames = segEndFrame - segStartFrame;
      const segStartSec = segStartFrame / safeFps;
      const effectiveClipDur = targetSegFrames / safeFps;
      const segEndSec = segEndFrame / safeFps;

      const defaultAudioFadeIn = isIntroClip || isOutroClip ? 0.05 : isFirstClipAfterIntro ? 1.2 : 0;
      const defaultAudioFadeOut = isIntroClip || isOutroClip ? 0.25 : 0;
      const audioFadeInSec =
        isIntroClip || isOutroClip
          ? defaultAudioFadeIn
          : typeof c.audioFadeInSec === 'number'
          ? Math.max(0, c.audioFadeInSec)
          : defaultAudioFadeIn;
      const audioFadeOutSec =
        isIntroClip || isOutroClip
          ? defaultAudioFadeOut
          : typeof c.audioFadeOutSec === 'number'
          ? Math.max(0, c.audioFadeOutSec)
          : defaultAudioFadeOut;
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
        ? `,fade=t=out:st=${Math.max(0, effectiveClipDur - 0.8).toFixed(2)}:d=0.8`
        : isLastBodyClipBeforeOutro
        ? `,fade=t=out:st=${Math.max(0, effectiveClipDur - 1.0).toFixed(2)}:d=1.0`
        : '';
      const vfTrimSuffix =
        targetSegFrames > 1
          ? `,tpad=stop_mode=clone:stop_duration=0.15,trim=end_frame=${targetSegFrames},setpts=PTS-STARTPTS`
          : '';

      // Build native libass (.ass) file for any subtitles or Hook text falling inside [segStartSec, segEndSec]
      let assFilterSuffix = '';
      const overlappingCaptions = parsedTimelineCaptions.filter(
        (cp) => cp.endSec > segStartSec + 0.03 && cp.startSec < segEndSec - 0.03
      );
      const hasAssHook =
        overlays?.burnInHook !== false &&
        Boolean(isFirstClipAfterIntro) &&
        Boolean(hookTextConfig && (hookTextConfig.line1 || hookTextConfig.line2));

      const isVertical916 = aspectRatio === '9:16' || outH > outW;
      const refShortSide = Math.min(outW, outH);

      if (overlappingCaptions.length > 0 || hasAssHook) {
        const assEvents: string[] = [];
        const blurScale = Math.max(1, refShortSide / 1080);
        const capStyleCfg = overlays?.captionStyle || {};
        const reqCapFontSize = Number(
          isVertical916
            ? capStyleCfg.fontSize9x16 ?? capStyleCfg.fontSize ?? savedFormatProfile.captionFontSize
            : capStyleCfg.fontSize16x9 ?? capStyleCfg.fontSize ?? savedFormatProfile.captionFontSize
        );
        const defaultCapFontSize = isVertical916 ? 21 : 25;
        const capFontScale =
          Number.isFinite(reqCapFontSize) && reqCapFontSize >= 10
            ? reqCapFontSize / defaultCapFontSize
            : 1;
        const capFontSizeAss = Math.round(
          refShortSide * (isVertical916 ? 0.052 : 0.039) * capFontScale
        );
        const reqBottomPct =
          typeof savedFormatProfile.captionBottomPct === 'number' &&
          savedFormatProfile.captionBottomPct >= 2
            ? savedFormatProfile.captionBottomPct
            : typeof savedClientState?.overlayStyles?.captionBottomPct === 'number' &&
              savedClientState.overlayStyles.captionBottomPct >= 2
            ? savedClientState.overlayStyles.captionBottomPct
            : typeof capStyleCfg.bottomPct === 'number' && capStyleCfg.bottomPct >= 2
            ? capStyleCfg.bottomPct
            : isVertical916
            ? 15.5
            : 11;
        const capMarginV = Math.round(outH * (reqBottomPct / 100));
        const capWideOffsetY = Math.max(2, Math.round(refShortSide * 0.004));
        const capTightOffsetY = Math.max(1, Math.round(refShortSide * 0.002));
        const capWideMarginV = Math.max(0, capMarginV - capWideOffsetY);
        const capTightMarginV = Math.max(0, capMarginV - capTightOffsetY);

        const capBgStyle = String(capStyleCfg.bgStyle || 'word_shadow');
        const rawBgOpacity =
          typeof capStyleCfg.bgOpacity === 'number' && Number.isFinite(capStyleCfg.bgOpacity)
            ? Math.max(5, Math.min(100, capStyleCfg.bgOpacity))
            : 30;
        // Calibrate word_shadow center alpha so after Gaussian blur its center matches CSS backgroundColor (30%) + outer box-shadow (25.5%)
        const effectivePillOpacity =
          capBgStyle === 'solid'
            ? 0.95
            : capBgStyle === 'word_shadow'
            ? Math.min(0.95, (rawBgOpacity / 100) * 1.18)
            : rawBgOpacity / 100;
        const pillAlphaInt = Math.max(0, Math.min(255, Math.round((1 - effectivePillOpacity) * 255)));
        const pillAlphaHex = pillAlphaInt.toString(16).toUpperCase().padStart(2, '0');
        const rawBgHex = String(capStyleCfg.bgColor || '#000000').replace('#', '');
        const capPillAssColor =
          /^[0-9a-fA-F]{6}$/.test(rawBgHex)
            ? `&H${pillAlphaHex}${rawBgHex.slice(4, 6).toUpperCase()}${rawBgHex.slice(2, 4).toUpperCase()}${rawBgHex.slice(0, 2).toUpperCase()}`
            : `&H${pillAlphaHex}000000`;

        const capPillBlur =
          capBgStyle === 'word_shadow'
            ? Number((7.2 * blurScale).toFixed(1))
            : Number((1.2 * blurScale).toFixed(1));
        const capWideBlur = Math.round(8 * blurScale);
        const capTightBlur = Number((2 * blurScale).toFixed(1));
        const hook1WideBlur = Math.round(9 * blurScale);
        const hook1TightBlur = Number((2 * blurScale).toFixed(1));
        const hook2WideBlur = Math.round(11 * blurScale);
        const hook2TightBlur = Number((2.2 * blurScale).toFixed(1));

        const buildAssRoundRect = (w: number, h: number, r: number): string => {
          const x0 = 0;
          const y0 = 0;
          const x1 = Math.max(8, Math.round(w));
          const y1 = Math.max(8, Math.round(h));
          const rad = Math.min(Math.round(r), Math.floor(x1 / 2), Math.floor(y1 / 2));
          const k = Math.round(rad * 0.552);
          return [
            `m ${x0 + rad} ${y0}`,
            `l ${x1 - rad} ${y0}`,
            `b ${x1 - rad + k} ${y0} ${x1} ${y0 + rad - k} ${x1} ${y0 + rad}`,
            `l ${x1} ${y1 - rad}`,
            `b ${x1} ${y1 - rad + k} ${x1 - rad + k} ${y1} ${x1 - rad} ${y1}`,
            `l ${x0 + rad} ${y1}`,
            `b ${x0 + rad - k} ${y1} ${x0} ${y1 - rad + k} ${x0} ${y1 - rad}`,
            `l ${x0} ${y0 + rad}`,
            `b ${x0} ${y0 + rad - k} ${x0 + rad - k} ${y0} ${x0 + rad} ${y0}`,
          ].join(' ');
        };

        const estimateBoldLineWidthPx = (lineText: string, fontPx: number): number => {
          let units = 0;
          for (const ch of lineText) {
            if ("ilI.,:;!'|¡ ".includes(ch)) units += 0.31;
            else if ('mwMW@%'.includes(ch)) units += 0.86;
            else if ('ABCDEFGHJKLNOPQRSTUVXYZÁÉÍÓÚÑÜ'.includes(ch)) units += 0.69;
            else if ('frt()[]{}"/-'.includes(ch)) units += 0.4;
            else units += 0.555;
          }
          return Math.round(units * fontPx);
        };

        const centerX = Math.round(outW / 2);
        const capPillH = Math.round(capFontSizeAss * 1.18);
        const capPillPadX = Math.round(capFontSizeAss * (capBgStyle === 'word_shadow' ? 0.38 : 0.48));
        const capPillRadius = Math.round(capFontSizeAss * (capBgStyle === 'word_shadow' ? 0.24 : 0.28));
        const capLineStepPx = Math.round(capFontSizeAss * 1.28);
        const capPillYOffset = Math.round(capFontSizeAss * 0.05);
        const baseBottomY = outH - capMarginV;

        if (hasAssHook && hookTextConfig) {
          const rawL1 = Number(hookTextConfig.line1StartSec ?? 9);
          const rawL2 = Number(hookTextConfig.line2StartSec ?? 10);
          const h1Start = Math.max(0, Math.min(effectiveClipDur - 1.5, rawL1 >= 7.5 ? rawL1 - 8 : rawL1));
          const h2Start = Math.max(h1Start + 0.5, Math.min(effectiveClipDur - 1.0, rawL2 >= 7.5 ? rawL2 - 8 : rawL2));
          const hEnd = effectiveClipDur;
          const line1Txt = escapeAssText(String(hookTextConfig.line1 || '').toUpperCase());
          const line2Txt = escapeAssText(String(hookTextConfig.line2 || '').toUpperCase());
          if (line1Txt && hEnd > h1Start + 0.05) {
            // Hook Line 1: NO background ('none'), ONLY cinematic drop shadow on the letters ('cinema') + pure crisp gold letters
            assEvents.push(
              `Dialogue: 1,${formatAssTime(h1Start)},${formatAssTime(hEnd)},Hook1CinemaWide,,0,0,0,,{\\fad(1000,1000)\\blur${hook1WideBlur}}${line1Txt}`,
              `Dialogue: 2,${formatAssTime(h1Start)},${formatAssTime(hEnd)},Hook1CinemaTight,,0,0,0,,{\\fad(1000,1000)\\blur${hook1TightBlur}}${line1Txt}`,
              `Dialogue: 3,${formatAssTime(h1Start)},${formatAssTime(hEnd)},Hook1Crisp,,0,0,0,,{\\fad(1000,1000)}${line1Txt}`
            );
          }
          if (line2Txt && hEnd > h2Start + 0.05) {
            // Hook Line 2: NO background ('none'), ONLY cinematic drop shadow on the letters ('cinema') + pure crisp white letters
            assEvents.push(
              `Dialogue: 1,${formatAssTime(h2Start)},${formatAssTime(hEnd)},Hook2CinemaWide,,0,0,0,,{\\fad(1000,1000)\\blur${hook2WideBlur}}${line2Txt}`,
              `Dialogue: 2,${formatAssTime(h2Start)},${formatAssTime(hEnd)},Hook2CinemaTight,,0,0,0,,{\\fad(1000,1000)\\blur${hook2TightBlur}}${line2Txt}`,
              `Dialogue: 3,${formatAssTime(h2Start)},${formatAssTime(hEnd)},Hook2Crisp,,0,0,0,,{\\fad(1000,1000)}${line2Txt}`
            );
          }
        }
        let prevAssLocalE = 0;
        for (const cp of overlappingCaptions) {
          const startsInsideSeg = cp.startSec > segStartSec + 0.02;
          const endsInsideSeg = cp.endSec < segEndSec - 0.02;
          // 65ms perceptual lead-in so the 60ms fade-in reaches 100% opacity on the exact frame the narrator's syllable begins
          const localS = startsInsideSeg
            ? Math.max(prevAssLocalE, Math.max(0, cp.startSec - segStartSec - 0.065))
            : 0;
          const localE = Math.min(effectiveClipDur, cp.endSec - segStartSec);
          if (localE > localS + 0.04) {
            prevAssLocalE = localE;
            const fadeInMs = startsInsideSeg ? 60 : 0;
            const fadeOutMs = endsInsideSeg ? 65 : 0;
            const rawLines = String(cp.text || '')
              .split(/\r?\n/)
              .map((l) => l.trim())
              .filter(Boolean);
            for (let rIdx = 0; rIdx < rawLines.length; rIdx++) {
              const rowRaw = rawLines[rIdx];
              const rowEsc = escapeAssText(rowRaw);
              const lineBottomY = baseBottomY - (rawLines.length - 1 - rIdx) * capLineStepPx;
              if (capBgStyle !== 'none') {
                const pillW = Math.min(
                  Math.round(outW * 0.92),
                  estimateBoldLineWidthPx(rowRaw, capFontSizeAss) + capPillPadX * 2
                );
                assEvents.push(
                  `Dialogue: 0,${formatAssTime(localS)},${formatAssTime(localE)},CaptionWordPill,,0,0,0,,{\\an2\\pos(${centerX},${lineBottomY + capPillYOffset})\\fad(${fadeInMs},${fadeOutMs})\\blur${capPillBlur}\\p1}${buildAssRoundRect(pillW, capPillH, capPillRadius)}{\\p0}`
                );
              }
              assEvents.push(
                `Dialogue: 1,${formatAssTime(localS)},${formatAssTime(localE)},CaptionCinemaWide,,0,0,0,,{\\an2\\pos(${centerX},${lineBottomY + capWideOffsetY})\\fad(${fadeInMs},${fadeOutMs})\\blur${capWideBlur}}${rowEsc}`,
                `Dialogue: 2,${formatAssTime(localS)},${formatAssTime(localE)},CaptionCinemaTight,,0,0,0,,{\\an2\\pos(${centerX},${lineBottomY + capTightOffsetY})\\fad(${fadeInMs},${fadeOutMs})\\blur${capTightBlur}}${rowEsc}`,
                `Dialogue: 3,${formatAssTime(localS)},${formatAssTime(localE)},CaptionCrisp,,0,0,0,,{\\an2\\pos(${centerX},${lineBottomY})\\fad(${fadeInMs},${fadeOutMs})}${rowEsc}`
              );
            }
          }
        }
        if (assEvents.length > 0) {
          const assPath = path.join(workDir, `seg_sub_${String(i + 1).padStart(3, '0')}.ass`);
          const hook1FontSizeAss = Math.round(refShortSide * (isVertical916 ? 0.035 : 0.036));
          const hook2FontSizeAss = Math.round(refShortSide * (isVertical916 ? 0.052 : 0.0574));
          const hook1MarginV = Math.round(outH * 0.555);
          const hook1WideMarginV = Math.max(0, hook1MarginV - Math.round(refShortSide * 0.0045));
          const hook1TightMarginV = Math.max(0, hook1MarginV - Math.round(refShortSide * 0.0025));
          // Alignment=8 (top-center): MarginV is measured from the top of the frame, so downward shadow offsets add to MarginV
          const hook2MarginV = Math.round(outH * 0.463);
          const hook2WideMarginV = hook2MarginV + Math.round(refShortSide * 0.0055);
          const hook2TightMarginV = hook2MarginV + Math.round(refShortSide * 0.0028);

          const hook1Spacing = Number((3.5 * blurScale).toFixed(1));
          const hook2Spacing = Number((1.5 * blurScale).toFixed(1));
          const rawCapHex = String(capStyleCfg.color || '#ffffff').replace('#', '');
          const capCrispAssColor =
            /^[0-9a-fA-F]{6}$/.test(rawCapHex)
              ? `&H00${rawCapHex.slice(4, 6).toUpperCase()}${rawCapHex.slice(2, 4).toUpperCase()}${rawCapHex.slice(0, 2).toUpperCase()}`
              : '&H00FFFFFF';

          const assContent = [
            '[Script Info]',
            'ScriptType: v4.00+',
            `PlayResX: ${outW}`,
            `PlayResY: ${outH}`,
            'WrapStyle: 0',
            'ScaledBorderAndShadow: yes',
            '',
            '[V4+ Styles]',
            'Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding',
            `Style: CaptionWordPill,Georgia,${capFontSizeAss},${capPillAssColor},${capPillAssColor},&H00000000,&HFF000000,-1,0,0,0,100,100,0,0,1,0,0,2,0,0,0,1`,
            `Style: CaptionCinemaWide,Georgia,${capFontSizeAss},&H28000000,&H28000000,&H00000000,&HFF000000,-1,0,0,0,100,100,0,0,1,0,0,2,0,0,0,1`,
            `Style: CaptionCinemaTight,Georgia,${capFontSizeAss},&H1E000000,&H1E000000,&H00000000,&HFF000000,-1,0,0,0,100,100,0,0,1,0,0,2,0,0,0,1`,
            `Style: CaptionCrisp,Georgia,${capFontSizeAss},${capCrispAssColor},&H0000FFFF,&H00000000,&H00000000,-1,0,0,0,100,100,0,0,1,0,0,2,0,0,0,1`,
            `Style: Hook1CinemaWide,Georgia,${hook1FontSizeAss},&H22000000,&H22000000,&H00000000,&HFF000000,-1,0,0,0,100,100,${hook1Spacing},0,1,0,0,2,${Math.round(outW * 0.06)},${Math.round(outW * 0.06)},${hook1WideMarginV},1`,
            `Style: Hook1CinemaTight,Georgia,${hook1FontSizeAss},&H14000000,&H14000000,&H00000000,&HFF000000,-1,0,0,0,100,100,${hook1Spacing},0,1,0,0,2,${Math.round(outW * 0.06)},${Math.round(outW * 0.06)},${hook1TightMarginV},1`,
            `Style: Hook1Crisp,Georgia,${hook1FontSizeAss},&H004DD3FC,&H0000FFFF,&H00000000,&H00000000,-1,0,0,0,100,100,${hook1Spacing},0,1,0,0,2,${Math.round(outW * 0.06)},${Math.round(outW * 0.06)},${hook1MarginV},1`,
            `Style: Hook2CinemaWide,Georgia,${hook2FontSizeAss},&H22000000,&H22000000,&H00000000,&HFF000000,-1,0,0,0,100,100,${hook2Spacing},0,1,0,0,8,${Math.round(outW * 0.055)},${Math.round(outW * 0.055)},${hook2WideMarginV},1`,
            `Style: Hook2CinemaTight,Georgia,${hook2FontSizeAss},&H14000000,&H14000000,&H00000000,&HFF000000,-1,0,0,0,100,100,${hook2Spacing},0,1,0,0,8,${Math.round(outW * 0.055)},${Math.round(outW * 0.055)},${hook2TightMarginV},1`,
            `Style: Hook2Crisp,Georgia,${hook2FontSizeAss},&H00FFFFFF,&H0000FFFF,&H00000000,&H00000000,-1,0,0,0,100,100,${hook2Spacing},0,1,0,0,8,${Math.round(outW * 0.055)},${Math.round(outW * 0.055)},${hook2MarginV},1`,
            '',
            '[Events]',
            'Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text',
            ...assEvents,
            '',
          ].join('\n');
          fs.writeFileSync(assPath, assContent, 'utf8');
          const escapedAssPath = assPath
            .replace(/\\/g, '/')
            .replace(/:/g, '\\:')
            .replace(/'/g, "\\'");
          const fontsDirPath = path.join(process.cwd(), 'data', 'fonts');
          const escapedFontsDir = fontsDirPath
            .replace(/\\/g, '/')
            .replace(/:/g, '\\:')
            .replace(/'/g, "\\'");
          assFilterSuffix = fs.existsSync(fontsDirPath)
            ? `,subtitles=filename='${escapedAssPath}':fontsdir='${escapedFontsDir}'`
            : `,ass='${escapedAssPath}'`;
        }
      }

      const cachedReframe = isVertical916
        ? reframeCacheByClipNum.get(Number(c.clipNumber))
        : undefined;
      const isUserReframed =
        Boolean(c.userReframed9x16) ||
        Boolean(savedClipMatch?.userReframed9x16) ||
        c.reframe9x16Mode === 'manual' ||
        savedClipMatch?.reframe9x16Mode === 'manual';
      const effectiveReframeMode = isUserReframed
        ? c.reframe9x16Mode || savedClipMatch?.reframe9x16Mode || cachedReframe?.reframe9x16Mode || 'auto_center'
        : cachedReframe?.reframe9x16Mode || c.reframe9x16Mode || savedClipMatch?.reframe9x16Mode || 'auto_center';

      const fpsInterpStage =
        !usingPrebakedOpticalFlow && !isIntroClip && !isOutroClip && speed < 0.96
          ? `framerate=fps=${safeFps}:interp_start=0:interp_end=255:scene=8.2`
          : `fps=${safeFps}`;

      let scaleAndCropVf: string;
      if (isOutroClip) {
        if (isVertical916) {
          const outroVertH = Math.round(outH * 0.66);
          const outroVertW = Math.round(outroVertH * (16 / 9));
          scaleAndCropVf = `colorlevels=rimin=0.04:gimin=0.04:bimin=0.04,scale=${outroVertW}:${outroVertH}:flags=fast_bilinear,${fpsInterpStage},crop=${outW}:${outroVertH}:(iw-${outW})/2:0,pad=${outW}:${outH}:0:(oh-ih)/2:black`;
        } else {
          const innerW = Math.round(outW * 0.88);
          const innerH = Math.round(outH * 0.88);
          scaleAndCropVf = `colorlevels=rimin=0.04:gimin=0.04:bimin=0.04,scale=${innerW}:${innerH}:force_original_aspect_ratio=decrease:flags=fast_bilinear,${fpsInterpStage},pad=${outW}:${outH}:(ow-iw)/2:round((oh-ih)*0.36):black`;
        }
      } else if (isIntroClip) {
        if (isVertical916) {
          scaleAndCropVf = `scale=${outW}:${outH}:force_original_aspect_ratio=increase:flags=fast_bilinear,${fpsInterpStage},crop=${outW}:${outH}:(iw-${outW})/2:(ih-${outH})/2`;
        } else {
          scaleAndCropVf = `scale=${outW}:${outH}:force_original_aspect_ratio=decrease:flags=fast_bilinear,${fpsInterpStage},pad=${outW}:${outH}:(ow-iw)/2:(oh-ih)/2:black`;
        }
      } else if (isVertical916 && effectiveReframeMode !== 'fit_blur') {
        const rawXStart = isUserReframed
          ? Number(c.reframeFocusXStart ?? savedClipMatch?.reframeFocusXStart ?? cachedReframe?.focusXStart ?? 50)
          : typeof cachedReframe?.focusXStart === 'number'
          ? cachedReframe.focusXStart
          : Number(c.reframeFocusXStart ?? savedClipMatch?.reframeFocusXStart ?? 50);
        const rawXEnd = isUserReframed
          ? Number(c.reframeFocusXEnd ?? savedClipMatch?.reframeFocusXEnd ?? cachedReframe?.focusXEnd ?? rawXStart)
          : typeof cachedReframe?.focusXEnd === 'number'
          ? cachedReframe.focusXEnd
          : Number(c.reframeFocusXEnd ?? savedClipMatch?.reframeFocusXEnd ?? rawXStart);
        const rawY = isUserReframed
          ? Number(c.reframeFocusY ?? savedClipMatch?.reframeFocusY ?? cachedReframe?.focusY ?? 50)
          : typeof cachedReframe?.focusY === 'number'
          ? cachedReframe.focusY
          : Number(c.reframeFocusY ?? savedClipMatch?.reframeFocusY ?? 50);
        const fStart = Math.max(0, Math.min(1, rawXStart / 100));
        const fEnd = Math.max(0, Math.min(1, rawXEnd / 100));
        const fY = Math.max(0, Math.min(1, rawY / 100));
        const isDynamicPan = Math.abs(fEnd - fStart) >= 0.015;
        const panDurSec =
          fEnd >= 0.96
            ? Math.max(0.5, effectiveClipDur * 0.6)
            : Math.max(0.5, effectiveClipDur);
        const cropXExpr = isDynamicPan
          ? `'max(0,min(iw-ow,(iw-ow)*(${fStart.toFixed(4)}+(${(fEnd - fStart).toFixed(4)})*min(1,max(0,t/${panDurSec.toFixed(3)})))))'`
          : `'max(0,min(iw-ow,(iw-ow)*${fStart.toFixed(4)}))'`;
        const cropYExpr = `'max(0,min(ih-oh,(ih-oh)*${fY.toFixed(4)}))'`;
        scaleAndCropVf = `scale=${outW}:${outH}:force_original_aspect_ratio=increase:flags=fast_bilinear,${fpsInterpStage},crop=${outW}:${outH}:${cropXExpr}:${cropYExpr}`;
      } else {
        scaleAndCropVf = `scale=${outW}:${outH}:force_original_aspect_ratio=decrease:flags=fast_bilinear,${fpsInterpStage},pad=${outW}:${outH}:(ow-iw)/2:(oh-ih)/2:black`;
      }

      const baseVfChain = `setpts=${ptsFactor}*(PTS-STARTPTS),${scaleAndCropVf},format=yuv420p${vfTrimSuffix}${vfFadeSuffix}${assFilterSuffix}`;

      const afFilter = await buildSmartNaturalFoleyFilter({
        ffmpegBin,
        sourceMp4,
        trimStartSec,
        sourceSpanSec: effectiveSpan > 0.2 ? effectiveSpan : rawClipDur,
        targetDurSec: effectiveClipDur,
        rawSpeed: speed,
        afFadePrefix,
        foleyVol,
        isIntroOrOutro: isIntroClip || isOutroClip || usingPrebakedOpticalFlow,
      });

      const inputTrimArgs: string[] = [];
      if (trimStartSec > 0.01) {
        inputTrimArgs.push('-ss', trimStartSec.toFixed(3));
      }
      if (trimEndSec > trimStartSec + 0.05) {
        inputTrimArgs.push('-to', trimEndSec.toFixed(3));
      }

      // Collect burned-in overlays that overlap this segment [segStartSec, segEndSec]
      const extraOverlayInputs: string[] = [];
      const overlayFilterSteps: string[] = [];
      let currentVLabel = 'vb0';
      let ovrCounter = 0;

      // 1) Official Logo overlay (already pre-scaled once to targetLogoW; visible from Intro through Outro with fade-in on first clip and fade-out at end of Outro)
      if (logoOverlayInfo && fs.existsSync(logoOverlayInfo.filePath)) {
        extraOverlayInputs.push('-i', logoOverlayInfo.filePath);
        const inpIdx = extraOverlayInputs.length / 2;
        const nextVLbl = `vb_${++ovrCounter}`;
        if (i === 0) {
          overlayFilterSteps.push(
            `[__INP_${inpIdx}__:v]loop=loop=-1:size=1:start=0,fps=${safeFps},trim=duration=${effectiveClipDur.toFixed(3)},setpts=PTS-STARTPTS,format=rgba,fade=t=in:st=0:d=1.5:alpha=1[lg_${ovrCounter}];[${currentVLabel}][lg_${ovrCounter}]overlay=${logoOverlayInfo.xPx}:${logoOverlayInfo.yPx}:format=auto[${nextVLbl}]`
          );
        } else if (i === clips.length - 1 || isOutroClip) {
          const logoFadeOutStart = Math.max(0, effectiveClipDur - 2.5);
          overlayFilterSteps.push(
            `[__INP_${inpIdx}__:v]loop=loop=-1:size=1:start=0,fps=${safeFps},trim=duration=${effectiveClipDur.toFixed(3)},setpts=PTS-STARTPTS,format=rgba,fade=t=out:st=${logoFadeOutStart.toFixed(2)}:d=2.5:alpha=1[lg_${ovrCounter}];[${currentVLabel}][lg_${ovrCounter}]overlay=${logoOverlayInfo.xPx}:${logoOverlayInfo.yPx}:format=auto[${nextVLbl}]`
          );
        } else {
          overlayFilterSteps.push(
            `[${currentVLabel}][__INP_${inpIdx}__:v]overlay=${logoOverlayInfo.xPx}:${logoOverlayInfo.yPx}:format=auto[${nextVLbl}]`
          );
        }
        currentVLabel = nextVLbl;
      }

      // 2) Hook Text overlays (Clip 1 Line 1 & Line 2 PNGs if passed and not already rendered via libass)
      if (!hasAssHook) {
        for (const hk of hookOverlayFiles) {
          if (hk.endSec > segStartSec + 0.02 && hk.startSec < segEndSec - 0.02) {
            const localStart = Math.max(0, hk.startSec - segStartSec);
            const localEnd = Math.min(effectiveClipDur, hk.endSec - segStartSec);
            if (localEnd > localStart + 0.02) {
              extraOverlayInputs.push('-i', hk.filePath);
              const inpIdx = extraOverlayInputs.length / 2;
              const nextVLbl = `vb_${++ovrCounter}`;
              overlayFilterSteps.push(
                `[__INP_${inpIdx}__:v]scale=${outW}:${hk.hPx}:flags=fast_bilinear[hk_${ovrCounter}];[${currentVLabel}][hk_${ovrCounter}]overlay=0:${hk.yPx}:format=auto:enable='between(t,${localStart.toFixed(3)},${localEnd.toFixed(3)})'[${nextVLbl}]`
              );
              currentVLabel = nextVLbl;
            }
          }
        }
      }

      // 3) Burned-in Subtitle strips overlapping [segStartSec, segEndSec] (when small custom PNG set is used)
      for (const cs of captionOverlayFiles) {
        if (cs.endSec > segStartSec + 0.02 && cs.startSec < segEndSec - 0.02) {
          const localStart = Math.max(0, cs.startSec - segStartSec);
          const localEnd = Math.min(effectiveClipDur, cs.endSec - segStartSec);
          if (localEnd > localStart + 0.02) {
            extraOverlayInputs.push('-i', cs.filePath);
            const inpIdx = extraOverlayInputs.length / 2;
            const nextVLbl = `vb_${++ovrCounter}`;
            overlayFilterSteps.push(
              `[__INP_${inpIdx}__:v]scale=${outW}:${cs.hPx}:flags=fast_bilinear[cp_${ovrCounter}];[${currentVLabel}][cp_${ovrCounter}]overlay=0:${cs.yPx}:format=auto:enable='between(t,${localStart.toFixed(3)},${localEnd.toFixed(3)})'[${nextVLbl}]`
            );
            currentVLabel = nextVLbl;
          }
        }
      }

      const effectiveEncodeBitrateMbps = safeBitrateMbps;

      const hwEncoderArgs = is8K
        ? ['-c:v', 'hevc_videotoolbox', '-realtime', 'true', '-b:v', `${effectiveEncodeBitrateMbps}M`, '-tag:v', 'hvc1']
        : ['-c:v', 'h264_videotoolbox', '-realtime', 'true', '-b:v', `${effectiveEncodeBitrateMbps}M`, '-profile:v', 'high'];

      const swEncoderArgs = is8K
        ? [
            '-c:v',
            'libx265',
            '-preset',
            'ultrafast',
            '-b:v',
            `${effectiveEncodeBitrateMbps}M`,
            '-tag:v',
            'hvc1',
          ]
        : [
            '-c:v',
            'libx264',
            '-preset',
            'ultrafast',
            '-b:v',
            `${effectiveEncodeBitrateMbps}M`,
            '-maxrate',
            `${Math.round(effectiveEncodeBitrateMbps * 1.25)}M`,
            '-bufsize',
            `${Math.round(effectiveEncodeBitrateMbps * 2)}M`,
          ];

      const buildSegmentArgs = (
        useSilentAudioInput: boolean,
        vCodecArgs: string[],
        useHwAccelInput: boolean
      ): string[] => {
        const inputOffset = 0;
        const resolvedOverlaySteps = overlayFilterSteps.map((step) =>
          step.replace(/__INP_(\d+)__/g, (_m, d) => String(parseInt(d, 10) + inputOffset))
        );
        const fullComplex =
          resolvedOverlaySteps.length > 0
            ? `[0:v]${baseVfChain}[vb0];${resolvedOverlaySteps.join(';')};[${currentVLabel}]format=yuv420p[vout]`
            : `[0:v]${baseVfChain}[vout]`;

        const hwInArgs = useHwAccelInput ? ['-hwaccel', 'videotoolbox'] : [];

        if (!useSilentAudioInput) {
          return [
            '-y',
            ...hwInArgs,
            ...inputTrimArgs,
            '-i',
            sourceMp4,
            ...extraOverlayInputs,
            '-filter_complex',
            `${fullComplex};[0:a]${afFilter}[aout]`,
            '-map',
            '[vout]',
            '-map',
            '[aout]',
            '-r',
            String(safeFps),
            ...vCodecArgs,
            '-c:a',
            'aac',
            '-ar',
            '44100',
            '-ac',
            '2',
            '-muxpreload',
            '0',
            '-muxdelay',
            '0',
            '-f',
            'mpegts',
            segOut,
          ];
        } else {
          const silentAudioSamples = Math.max(1024, Math.round(effectiveClipDur * 44100) - 1024);
          return [
            '-y',
            ...hwInArgs,
            ...inputTrimArgs,
            '-i',
            sourceMp4,
            ...extraOverlayInputs,
            '-filter_complex',
            `${fullComplex};anullsrc=channel_layout=stereo:sample_rate=44100,aformat=sample_fmts=fltp:sample_rates=44100:channel_layouts=stereo,atrim=end_sample=${silentAudioSamples},asetpts=N/SR/TB[aout]`,
            '-map',
            '[vout]',
            '-map',
            '[aout]',
            '-r',
            String(safeFps),
            ...vCodecArgs,
            '-c:a',
            'aac',
            '-ar',
            '44100',
            '-ac',
            '2',
            '-muxpreload',
            '0',
            '-muxdelay',
            '0',
            '-f',
            'mpegts',
            segOut,
          ];
        }
      };

      const runSegmentEncode = (args: string[]) =>
        new Promise<void>((resolve, reject) => {
          execFile(ffmpegBin, args, { timeout: 600000 }, (err) => (err ? reject(err) : resolve()));
        });

      const segLabel = isIntroClip ? 'Intro' : isOutroClip ? 'Outro' : `Clip ${c.clipNumber || i}`;
      normalizedClipPaths.push(segOut);
      segmentEncodeTasks.push({
        idx: segmentEncodeTasks.length,
        label: segLabel,
        segOut,
        durationSec: effectiveClipDur,
        run: async () => {
          if (isClipMuted) {
            try {
              await runSegmentEncode(buildSegmentArgs(true, hwEncoderArgs, true));
            } catch {
              await runSegmentEncode(buildSegmentArgs(true, swEncoderArgs, false));
            }
            return;
          }
          try {
            await runSegmentEncode(buildSegmentArgs(false, hwEncoderArgs, true));
          } catch {
            try {
              await runSegmentEncode(buildSegmentArgs(true, hwEncoderArgs, true));
            } catch {
              try {
                await runSegmentEncode(buildSegmentArgs(false, swEncoderArgs, false));
              } catch {
                await runSegmentEncode(buildSegmentArgs(true, swEncoderArgs, false));
              }
            }
          }
        },
      });
    }

    if (normalizedClipPaths.length === 0) {
      activeRenderJobState = {
        running: false,
        progressPct: 0,
        currentStep: 0,
        totalSteps: 0,
        stageLabel: '',
        startedAt: 0,
        error: 'No se encontraron archivos MP4 en la carpeta elegida ni en memoria.',
      };
      res.status(400).json({
        error:
          'No se encontraron archivos MP4 en la carpeta elegida ni en memoria. Asegúrate de haber descargado o importado al menos un clip MP4.',
      });
      return;
    }

    // 2. Discover Voiceover MP3 and Flow Music / Suno tracks BEFORE starting the streaming muxer
    const audioDirs = [path.join(targetRoot, '02_Audio'), path.join(targetRoot, 'Audio'), targetRoot];
    let voPath = path.join(targetRoot, '02_Audio', 'Voz_Narrativa.mp3');
    if (!fs.existsSync(voPath)) {
      voPath = path.join(targetRoot, 'Audio', 'Voz_Narrativa.mp3');
    }
    if (!fs.existsSync(voPath)) {
      for (const ad of audioDirs) {
        if (!fs.existsSync(ad) || !fs.statSync(ad).isDirectory()) continue;
        const voMatch = fs
          .readdirSync(ad)
          .find(
            (f) =>
              /\.(mp3|m4a|wav)$/i.test(f) &&
              /(?:voz[_\-\s]*narrativa|narracion|voiceover|voz_master)/i.test(f) &&
              !/(?:suno|flowmusic|flow_music|musica|pista|track)/i.test(f)
          );
        if (voMatch) {
          voPath = path.join(ad, voMatch);
          break;
        }
      }
    }
    if (!fs.existsSync(voPath) && voiceoverDataUrl && String(voiceoverDataUrl).startsWith('data:')) {
      const cleanB64 = String(voiceoverDataUrl).replace(/^data:[^;]+;base64,/, '');
      voPath = path.join(workDir, 'voiceover_input.mp3');
      fs.writeFileSync(voPath, Buffer.from(cleanB64, 'base64'));
    }

    const resolvedMusicInputs: Array<{
      filePath: string;
      startSec: number;
      durationSec: number;
      volume?: number;
      fadeInSec: number;
      fadeOutSec: number;
    }> = [];
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
          const rawVolNum = typeof mt.volume === 'number' && Number.isFinite(mt.volume) ? Number(mt.volume) : undefined;
          const normalizedVol =
            rawVolNum !== undefined
              ? Math.max(0, Math.min(1, rawVolNum > 1 ? rawVolNum / 100 : rawVolNum))
              : undefined;
          resolvedMusicInputs.push({
            filePath: foundTrackPath,
            startSec: Math.max(0, Number(mt.startSec ?? mt.start ?? 0)),
            durationSec: Math.max(10, Number(mt.durationSec ?? mt.duration ?? 90)),
            volume: normalizedVol,
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

    const rawTitleSource = String(
      docTitle || folderName || path.basename(targetRoot) || 'Huellas_Documental'
    ).trim();
    const numMatch =
      rawTitleSource.match(/\bvideo[_\-\s]*0*(\d+)/i) ||
      String(folderName || '').match(/\bvideo[_\-\s]*0*(\d+)/i) ||
      path.basename(targetRoot).match(/\bvideo[_\-\s]*0*(\d+)/i);
    const videoNumPrefix = numMatch ? `Video_${numMatch[1]}` : 'Video_1';
    const strippedDocTitle =
      rawTitleSource.replace(/^(?:video[_\-\s]*0*\d+[_\-\s:—–]*)/i, '').trim() ||
      'Huellas_Documental';
    const safeDocName = strippedDocTitle
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/[^a-zA-Z0-9_-]+/g, '_')
      .replace(/^_+|_+$/g, '')
      .slice(0, 60);
    const platformSlug = aspectRatio === '9:16' || outH > outW ? 'Facebook' : 'YouTube';
    const ratioSlug = aspectRatio.replace(':', 'x');
    const finalFileName = `${videoNumPrefix}_${platformSlug}_${ratioSlug}_${safeDocName}_${preset.label}_${safeFps}fps_${safeBitrateMbps}Mbps.mp4`;
    const videoFinalSubdir = path.join(targetRoot, '06_Video_Final');
    if (!fs.existsSync(videoFinalSubdir)) {
      try {
        fs.mkdirSync(videoFinalSubdir, { recursive: true });
      } catch {}
    }
    const finalOutputPath = fs.existsSync(videoFinalSubdir)
      ? path.join(videoFinalSubdir, finalFileName)
      : path.join(targetRoot, finalFileName);
    // Write to local /tmp workDir while FFmpeg is muxing so iCloud Drive (bird) never attempts to upload an incomplete growing file
    const tempMuxOutputPath = path.join(workDir, `mux_master_${Date.now()}.mp4`);

    // Remove any existing file at finalOutputPath before starting so disk space is immediately freed
    if (fs.existsSync(finalOutputPath)) {
      try {
        fs.unlinkSync(finalOutputPath);
      } catch {}
    }

    if (srtContent) {
      const srtFileName = aspectRatio === '9:16' ? 'Subtitulos_9x16.srt' : 'Subtitulos.srt';
      fs.writeFileSync(path.join(targetRoot, srtFileName), String(srtContent), 'utf8');
      const seoDir = path.join(targetRoot, '01_Guion_y_SEO');
      if (fs.existsSync(seoDir)) {
        fs.writeFileSync(path.join(seoDir, srtFileName), String(srtContent), 'utf8');
      }
    }

    // 3. Create Named Pipes (FIFOs) for zero-duplicate-disk-space streaming concat + audio mix
    const totalSegTasks = segmentEncodeTasks.length;
    const fifoPaths: string[] = [];
    for (let k = 0; k < totalSegTasks; k++) {
      const fp = path.join(workDir, `fifo_${String(k + 1).padStart(3, '0')}.ts`);
      execSync(`mkfifo "${fp.replace(/"/g, '\\"')}"`);
      fifoPaths.push(fp);
    }

    const concatListPath = path.join(workDir, 'concat_list.txt');
    const concatContent = fifoPaths
      .map((p, idx) => {
        const dur = segmentEncodeTasks[idx]?.durationSec || 8;
        return `file '${p.replace(/'/g, "'\\''")}'\nduration ${dur.toFixed(6)}`;
      })
      .join('\n');
    fs.writeFileSync(concatListPath, concatContent, 'utf8');

    const hasVo = fs.existsSync(voPath);
    let muxerArgs: string[] = [];
    if (hasVo || resolvedMusicInputs.length > 0) {
      muxerArgs = ['-y', '-f', 'concat', '-safe', '0', '-i', concatListPath];
      const totalTimelineDurStr = Math.max(1, runningTimelineSec).toFixed(3);
      const filterParts: string[] = [
        `[0:a]asetpts=N/SR/TB,atrim=start_sample=1024,asetpts=N/SR/TB,aformat=sample_fmts=fltp:sample_rates=44100:channel_layouts=stereo,apad=whole_dur=${totalTimelineDurStr},atrim=0:${totalTimelineDurStr}[clip_a]`,
      ];
      const mixLabels: string[] = ['[clip_a]'];
      let nextInputIdx = 1;

      const safeVoVol = Math.max(0.5, Math.min(1.0, Number(voiceoverVolume || 1.0)));
      // Match Web Audio API in CapCutEditor: mono-to-stereo without -3.01dB pan loss (pan=stereo|FL=FL+FC|FR=FR+FC) + DynamicsCompressor makeup gain
      const voDbMultiplier = Math.pow(10, (Number(voiceoverGainDb ?? 5) + 1.5) / 20);
      const boostedVoVol = safeVoVol * voDbMultiplier;
      if (hasVo) {
        muxerArgs.push('-i', voPath);
        const delayMs = Math.max(0, Math.round(Number(voiceoverStartSec || 0) * 1000));
        filterParts.push(
          `[${nextInputIdx}:a]aresample=44100,aformat=sample_fmts=fltp,areverse,atrim=start=0.05,afade=t=in:st=0:d=0.04,areverse,pan=stereo|FL=FL+FC|FR=FR+FC,asetpts=N/SR/TB,adelay=${delayMs}|${delayMs},volume=${boostedVoVol.toFixed(3)},alimiter=limit=0.89:attack=3:release=150:level=disabled[vo]`
        );
        mixLabels.push('[vo]');
        nextInputIdx++;
      }

      const defaultMusicVol = Math.max(0, Math.min(1.0, Number(sunoMasterVolume ?? 0.1)));
      // Calibrate exported FlowMusic (brickwall 0 dBFS stereo) by 0.45x (-7 dB) so 10% in the editor matches the exact perceived background level in the exported MP4
      const MUSIC_EXPORT_CALIBRATION = 0.45;
      for (let mIdx = 0; mIdx < resolvedMusicInputs.length; mIdx++) {
        const mItem = resolvedMusicInputs[mIdx];
        muxerArgs.push('-i', mItem.filePath);
        const startMs = Math.max(0, Math.round(mItem.startSec * 1000));
        const dur = Math.max(8, mItem.durationSec);
        const rawTrackVol =
          typeof mItem.volume === 'number' ? mItem.volume : defaultMusicVol;
        const trackVol = Math.max(0, Math.min(1.0, rawTrackVol * MUSIC_EXPORT_CALIBRATION));
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
          `[${nextInputIdx}:a]aresample=44100,aformat=sample_fmts=fltp:channel_layouts=stereo,atrim=0:${dur},asetpts=N/SR/TB${fadeChain},volume=${trackVol.toFixed(4)},adelay=${startMs}|${startMs}[${lbl}]`
        );
        mixLabels.push(`[${lbl}]`);
        nextInputIdx++;
      }

      filterParts.push(
        `${mixLabels.join('')}amix=inputs=${mixLabels.length}:duration=first:dropout_transition=2:normalize=0,asetpts=N/SR/TB[aout]`
      );

      muxerArgs.push(
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
        '256k',
        tempMuxOutputPath
      );
    } else {
      muxerArgs = [
        '-y',
        '-f',
        'concat',
        '-safe',
        '0',
        '-i',
        concatListPath,
        '-c',
        'copy',
        tempMuxOutputPath,
      ];
    }

    const muxerProc = spawn(ffmpegBin, muxerArgs, { stdio: ['ignore', 'ignore', 'pipe'] });
    let muxerStderr = '';
    muxerProc.stderr?.on('data', (d) => {
      muxerStderr = (muxerStderr + d.toString()).slice(-4000);
    });
    const muxerDonePromise = new Promise<void>((resolve, reject) => {
      muxerProc.on('close', (code) => {
        if (code === 0) resolve();
        else reject(new Error(`Final muxer exited with code ${code}: ${muxerStderr}`));
      });
      muxerProc.on('error', reject);
    });

    // 4. Execute segment encodes in parallel (with bounded lookahead <= 5 segments so /tmp never exceeds ~900 MB) and stream each completed .ts into its FIFO + delete immediately!
    let completedSegCount = 0;
    let nextTaskCursor = 0;
    let nextFifoToFeed = 0;
    const segReadyFlags: boolean[] = new Array(totalSegTasks).fill(false);
    let workerError: any = null;

    const workerConcurrency = Math.min(4, Math.max(1, totalSegTasks));

    const runWorker = async () => {
      while (nextTaskCursor < totalSegTasks && !workerError) {
        // Throttle lookahead so at most 5 encoded segments wait in /tmp at any moment (~850 MB max)
        while (nextTaskCursor > nextFifoToFeed + 5 && !workerError) {
          await new Promise((r) => setTimeout(r, 200));
        }
        if (workerError || nextTaskCursor >= totalSegTasks) break;
        const myIdx = nextTaskCursor++;
        const task = segmentEncodeTasks[myIdx];
        if (!task) break;
        try {
          await task.run();
          segReadyFlags[myIdx] = true;
          completedSegCount++;
          activeRenderJobState = {
            ...activeRenderJobState,
            progressPct: Math.min(
              97,
              Math.max(3, Math.round((completedSegCount / Math.max(1, totalSegTasks)) * 96))
            ),
            currentStep: completedSegCount,
            totalSteps: totalSegTasks,
            stageLabel: `Renderizando y uniendo segmento ${completedSegCount}/${totalSegTasks} (${task.label}) en ${preset.label} • ${safeFps} FPS • ${safeBitrateMbps} Mbps...`,
          };
        } catch (err) {
          workerError = err;
          break;
        }
      }
    };

    const runFifoFeeder = async () => {
      for (let k = 0; k < totalSegTasks; k++) {
        while (!segReadyFlags[k] && !workerError) {
          await new Promise((r) => setTimeout(r, 120));
        }
        if (workerError) {
          try {
            muxerProc.kill('SIGKILL');
          } catch {}
          break;
        }
        const srcTs = segmentEncodeTasks[k].segOut;
        const fifoTs = fifoPaths[k];
        await new Promise<void>((resolve, reject) => {
          const rs = fs.createReadStream(srcTs);
          const ws = fs.createWriteStream(fifoTs);
          rs.on('error', reject);
          ws.on('error', reject);
          ws.on('finish', () => {
            try {
              fs.unlinkSync(srcTs);
            } catch {}
            try {
              fs.unlinkSync(fifoTs);
            } catch {}
            resolve();
          });
          rs.pipe(ws);
        });
        nextFifoToFeed = k + 1;
      }
    };

    await Promise.all([
      ...Array.from({ length: workerConcurrency }, () => runWorker()),
      runFifoFeeder(),
    ]);

    if (workerError) {
      throw workerError;
    }

    activeRenderJobState = {
      ...activeRenderJobState,
      progressPct: 99,
      stageLabel: 'Finalizando contenedor MP4 masterizado...',
    };

    await muxerDonePromise;

    if (fs.existsSync(tempMuxOutputPath)) {
      if (process.platform === 'darwin') {
        try {
          execSync(`xattr -c "${tempMuxOutputPath.replace(/"/g, '\\"')}"`, { stdio: 'ignore' });
        } catch {}
      }
      if (fs.existsSync(finalOutputPath)) {
        try {
          fs.unlinkSync(finalOutputPath);
        } catch {}
        await new Promise((r) => setTimeout(r, 1500));
      }
      try {
        fs.renameSync(tempMuxOutputPath, finalOutputPath);
      } catch {
        fs.copyFileSync(tempMuxOutputPath, finalOutputPath);
        try {
          fs.unlinkSync(tempMuxOutputPath);
        } catch {}
      }
    }

    try {
      execSync(`xattr -c "${finalOutputPath.replace(/"/g, '\\"')}"`, { stdio: 'ignore' });
      execSync(`chflags nohidden "${finalOutputPath.replace(/"/g, '\\"')}"`, { stdio: 'ignore' });
    } catch {}

    // Cleanup temp folder
    try {
      fs.rmSync(workDir, { recursive: true, force: true });
    } catch {}

    const elapsedSec = ((Date.now() - startedAt) / 1000).toFixed(1);
    activeRenderJobState = {
      running: false,
      progressPct: 100,
      currentStep: clips.length,
      totalSteps: clips.length,
      stageLabel: `✅ ¡Exportación completada en ${elapsedSec}s!`,
      startedAt,
      outputPath: finalOutputPath,
      fileName: finalFileName,
    };

    res.json({
      ok: true,
      outputPath: finalOutputPath,
      fileName: finalFileName,
      clipsRendered: normalizedClipPaths.length,
      elapsedSec,
    });
  } catch (err: any) {
    try {
      fs.rmSync(workDir, { recursive: true, force: true });
    } catch {}
    activeRenderJobState = {
      running: false,
      progressPct: 0,
      currentStep: 0,
      totalSteps: 0,
      stageLabel: '',
      startedAt: 0,
      error: err?.message || 'Error ejecutando FFmpeg para renderizar el documental.',
    };
    console.error('Error en renderizado nativo FFmpeg:', err);
    res.status(500).json({
      error: err.message || 'Error ejecutando FFmpeg para renderizar el documental.',
    });
  }
});

// ============================================================================
// SMART AUTO-REFRAME 9:16 ENGINE (100% LOCAL COMPUTER VISION + CACHE)
// ============================================================================
interface SmartReframeClipResult {
  clipNumber: number;
  fileName: string;
  reframe9x16Mode: 'auto_center' | 'auto_focus' | 'auto_pan';
  focusXStart: number; // 0 to 100 (50 = center)
  focusXEnd: number;   // 0 to 100 (50 = center)
  focusY: number;      // 0 to 100 (50 = center)
  confidence: number;  // 0 to 1
  reason: string;
  mtimeMs?: number;
  sizeBytes?: number;
}

async function analyzeClipSmartReframe9x16(
  ffmpegBin: string,
  mp4Path: string,
  clipNumber: number,
  fileName: string,
  promptHint = ''
): Promise<SmartReframeClipResult> {
  const W = 160;
  const H = 90;
  const winW = 51; // 9:16 vertical window width inside a 160x90 (16:9) frame
  const maxLeftX = W - winW; // 109
  const frameByteSize = W * H * 3;

  const rawBuffer = await new Promise<Buffer>((resolve) => {
    const chunks: Buffer[] = [];
    // Sample ~6 keyframes across the clip (approx every 1.3s on an 8s clip)
    const proc = spawn(
      ffmpegBin,
      [
        '-hide_banner',
        '-loglevel',
        'error',
        '-i',
        mp4Path,
        '-vf',
        `fps=0.75,scale=${W}:${H}:flags=fast_bilinear`,
        '-frames:v',
        '6',
        '-f',
        'rawvideo',
        '-pix_fmt',
        'rgb24',
        'pipe:1',
      ],
      { stdio: ['ignore', 'pipe', 'ignore'] }
    );
    proc.stdout?.on('data', (chunk: Buffer) => chunks.push(chunk));
    proc.on('close', () => resolve(Buffer.concat(chunks)));
    proc.on('error', () => resolve(Buffer.alloc(0)));
  });

  const numFrames = Math.floor(rawBuffer.length / frameByteSize);
  if (numFrames <= 0) {
    return {
      clipNumber,
      fileName,
      reframe9x16Mode: 'auto_center',
      focusXStart: 50,
      focusXEnd: 50,
      focusY: 50,
      confidence: 0.5,
      reason: 'Encuadre central estándar (50%)',
    };
  }

  const perFrameRawNormX: number[] = [];
  const perFrameConfidence: number[] = [];
  const globalColScores = new Float64Array(W);
  const earlyColAction = new Float64Array(W);
  const lateColAction = new Float64Array(W);
  const bandEyeHuman = new Float64Array(10);
  const bandLowerSubj = new Float64Array(10);
  const bandHorizonObj = new Float64Array(10);
  const bandMotion = new Float64Array(10);
  const lateMotionBand = new Float64Array(10);
  const darkTorsoSilhouette = new Float64Array(10);
  const upperHeadSkin = new Float64Array(10);
  const brightCenterWindow = new Float64Array(10);

  for (let f = 0; f < numFrames; f++) {
    const baseOffset = f * frameByteSize;
    const prevOffset = f > 0 ? (f - 1) * frameByteSize : -1;
    const colScores = new Float64Array(W);

    // Estimate global camera drift / background water ripple baseline on a sparse grid
    const sampleDiffs: number[] = [];
    if (prevOffset >= 0) {
      for (let y = 10; y < H - 10; y += 6) {
        for (let x = 6; x < W - 6; x += 6) {
          const i = baseOffset + (y * W + x) * 3;
          const p = prevOffset + (y * W + x) * 3;
          sampleDiffs.push(
            Math.abs(rawBuffer[i] - rawBuffer[p]) +
              Math.abs(rawBuffer[i + 1] - rawBuffer[p + 1]) +
              Math.abs(rawBuffer[i + 2] - rawBuffer[p + 2])
          );
        }
      }
      sampleDiffs.sort((a, b) => a - b);
    }
    const baselineDiff =
      sampleDiffs.length > 0 ? sampleDiffs[Math.floor(sampleDiffs.length * 0.6)] : 15;

    for (let y = 6; y < H - 10; y++) {
      // Head band (y = 7..50) and upper torso band (y = 51..76); exclude bottom table/ground
      const isHeadBand = y >= 7 && y <= 50;
      const isTorsoBand = y > 50 && y <= 76;
      const rowWeight = isHeadBand ? 2.5 : isTorsoBand ? 1.15 : 0.35;

      for (let x = 3; x < W - 3; x++) {
        const idx = baseOffset + (y * W + x) * 3;
        const r = rawBuffer[idx];
        const g = rawBuffer[idx + 1];
        const b = rawBuffer[idx + 2];
        const luma = 0.299 * r + 0.587 * g + 0.114 * b;
        const sat = Math.max(r, g, b) - Math.min(r, g, b);
        const isSky = luma > 180 && sat < 26;

        // 1. Face / Skin Chromaticity in head/hand zone (y <= 56), boosted by dark hair/hat/cap above
        let skinWarmScore = 0;
        if (
          y <= 56 &&
          r > 52 &&
          r > g &&
          g >= b * 0.85 &&
          r - b >= 15 &&
          r - g >= 5 &&
          luma > 38 &&
          luma < 220
        ) {
          const upIdx = baseOffset + (Math.max(2, y - 6) * W + x) * 3;
          const upLuma =
            0.299 * rawBuffer[upIdx] + 0.587 * rawBuffer[upIdx + 1] + 0.114 * rawBuffer[upIdx + 2];
          const hairHatBoost = isHeadBand && upLuma < 65 ? 2.1 : 1.0;
          skinWarmScore = Math.min(55, (r - b) * 1.1) * rowWeight * hairHatBoost;
        }

        // 2. True 2nd-Order Laplacian Focus Sharpness + Vertical vs Horizontal Gradient
        const idxLeft = idx - 3;
        const idxRight = idx + 3;
        const idxUp = idx - W * 3;
        const idxDown = idx + W * 3;
        const lapR =
          Math.abs(2 * r - rawBuffer[idxLeft] - rawBuffer[idxRight]) +
          Math.abs(2 * r - rawBuffer[idxUp] - rawBuffer[idxDown]);
        const lapG =
          Math.abs(2 * g - rawBuffer[idxLeft + 1] - rawBuffer[idxRight + 1]) +
          Math.abs(2 * g - rawBuffer[idxUp + 1] - rawBuffer[idxDown + 1]);
        const lap = (lapR + lapG) * 0.5;
        const edgeScore = !isSky && lap > 14 ? Math.min(50, (lap - 14) * 0.85) * rowWeight : 0;

        if (!isSky && x >= 4 && x < W - 4 && y >= 16 && y <= 75) {
          const bIdx = Math.min(9, Math.floor(x / 16));
          const gx =
            Math.abs(rawBuffer[idxRight] - rawBuffer[idxLeft]) +
            Math.abs(rawBuffer[idxRight + 1] - rawBuffer[idxLeft + 1]);
          const gy =
            Math.abs(rawBuffer[idxDown] - rawBuffer[idxUp]) +
            Math.abs(rawBuffer[idxDown + 1] - rawBuffer[idxUp + 1]);
          const vOnly = Math.max(0, gx - gy * 0.55);
          let skinUnderCap = 0;
          if (
            y >= 18 &&
            y <= 44 &&
            r > 65 &&
            r > g &&
            g >= b * 0.85 &&
            r - b >= 18 &&
            r - b <= 85 &&
            luma > 48 &&
            luma < 200
          ) {
            const upIdx6 = baseOffset + (Math.max(6, y - 6) * W + x) * 3;
            const upLuma6 =
              0.299 * rawBuffer[upIdx6] +
              0.587 * rawBuffer[upIdx6 + 1] +
              0.114 * rawBuffer[upIdx6 + 2];
            if (upLuma6 < luma - 18 && upLuma6 < 62) {
              skinUnderCap = (r - b) * 2.5;
            }
          }
          if (y >= 24 && y <= 50) {
            bandEyeHuman[bIdx] += vOnly + skinUnderCap * 0.8;
          }
          if (y >= 20 && y <= 48) {
            bandHorizonObj[bIdx] += (gx + gy) * (luma < 55 ? 1.5 : 0.7);
          }
          if (y >= 50 && y <= 75) {
            const isWarmAnimalOrObj = r > 60 && r - b >= 25 && luma > 38 && luma < 170;
            bandLowerSubj[bIdx] += (gx + gy) * (isWarmAnimalOrObj ? 2.0 : 0.8);
          }
        }

        if (x >= 4 && x < W - 4 && y >= 8 && y <= 72) {
          const bIdx = Math.min(9, Math.floor(x / 16));
          if (y >= 22 && y <= 72 && luma < 36) {
            darkTorsoSilhouette[bIdx] += 1;
          }
          if (
            y >= 8 &&
            y <= 34 &&
            r > 65 &&
            r - b >= 18 &&
            r - b <= 75 &&
            luma > 45 &&
            luma < 175
          ) {
            upperHeadSkin[bIdx] += r - b;
          }
          if (y >= 10 && y <= 45 && luma > 185) {
            brightCenterWindow[bIdx] += 1;
          }
        }

        // 3. Dark Foreground Silhouette Contrast (e.g. dark coat/cap/beret against brighter background)
        let silhouetteScore = 0;
        if ((isHeadBand || isTorsoBand) && luma < 48 && lap > 10) {
          silhouetteScore = Math.min(32, (52 - luma) * 0.45) * (isHeadBand ? 1.6 : 1.0);
        }

        // 4. Localized Subject Motion above camera-drift baseline
        let motionScore = 0;
        if (prevOffset >= 0 && !isSky) {
          const pIdx = prevOffset + (y * W + x) * 3;
          const rawDiff =
            Math.abs(r - rawBuffer[pIdx]) +
            Math.abs(g - rawBuffer[pIdx + 1]) +
            Math.abs(b - rawBuffer[pIdx + 2]);
          const netDiff = rawDiff - (baselineDiff + 12);
          if (netDiff > 0) {
            motionScore = Math.min(60, netDiff * 0.75) * rowWeight;
            const bIdx = Math.min(9, Math.floor(x / 16));
            bandMotion[bIdx] += motionScore;
            if (f >= Math.ceil(numFrames / 2)) {
              lateMotionBand[bIdx] += motionScore;
            }
          }
        }

        const totalPixelSaliency = skinWarmScore + edgeScore + silhouetteScore + motionScore;
        colScores[x] += totalPixelSaliency;
        globalColScores[x] += totalPixelSaliency;
        if (f < Math.ceil(numFrames / 2)) {
          earlyColAction[x] += motionScore + skinWarmScore * 0.35;
        } else {
          lateColAction[x] += motionScore + skinWarmScore * 0.35;
        }
      }
    }

    // Slide the 9:16 window across x0 = 0 .. maxLeftX without forcing premature 50% snap
    let bestX0 = Math.round(maxLeftX * 0.5);
    let bestWinScore = -1;
    let centerWinScore = 1;

    for (let x0 = 0; x0 <= maxLeftX; x0++) {
      let winSum = 0;
      for (let dx = 0; dx < winW; dx++) {
        const normDx = (dx - winW * 0.5) / (winW * 0.5);
        const kernelW = Math.max(0.25, 1.0 - 0.5 * normDx * normDx);
        winSum += colScores[x0 + dx] * kernelW;
      }
      if (x0 === Math.round(maxLeftX * 0.5)) {
        centerWinScore = Math.max(1, winSum);
      }
      if (winSum > bestWinScore) {
        bestWinScore = winSum;
        bestX0 = x0;
      }
    }

    const ratioVsCenter = bestWinScore / Math.max(1, centerWinScore);
    const rawPct = (bestX0 / maxLeftX) * 100;
    perFrameRawNormX.push(Math.max(10, Math.min(90, rawPct)));
    perFrameConfidence.push(Math.min(0.99, Math.max(0.55, (ratioVsCenter - 0.9) * 1.8)));
  }

  // Build full window saliency curve across x0 = 0 .. maxLeftX
  const winCurve = new Float64Array(maxLeftX + 1);
  let globalBestX0 = Math.round(maxLeftX * 0.5);
  let globalBestScore = -1;
  let globalCenterScore = 1;

  for (let x0 = 0; x0 <= maxLeftX; x0++) {
    let winSum = 0;
    for (let dx = 0; dx < winW; dx++) {
      const normDx = (dx - winW * 0.5) / (winW * 0.5);
      const kernelW = Math.max(0.25, 1.0 - 0.5 * normDx * normDx);
      winSum += globalColScores[x0 + dx] * kernelW;
    }
    winCurve[x0] = winSum;
    const u = x0 / maxLeftX;
    const prior = 1.0 - 0.035 * Math.pow((u - 0.5) * 2, 2);
    const weightedScore = winSum * prior;
    if (x0 === Math.round(maxLeftX * 0.5)) {
      globalCenterScore = Math.max(1, weightedScore);
    }
    if (weightedScore > globalBestScore) {
      globalBestScore = weightedScore;
      globalBestX0 = x0;
    }
  }

  // 1) Detect Bimodal Two-Subject Composition (one subject on Left third, one subject on Right third, valley in Center)
  let leftBestX0 = Math.round(maxLeftX * 0.22);
  let leftBestVal = -1;
  for (let x0 = Math.round(maxLeftX * 0.08); x0 <= Math.round(maxLeftX * 0.36); x0++) {
    if (winCurve[x0] > leftBestVal) {
      leftBestVal = winCurve[x0];
      leftBestX0 = x0;
    }
  }
  let rightBestX0 = Math.round(maxLeftX * 0.78);
  let rightBestVal = -1;
  for (let x0 = Math.round(maxLeftX * 0.64); x0 <= Math.round(maxLeftX * 0.92); x0++) {
    if (winCurve[x0] > rightBestVal) {
      rightBestVal = winCurve[x0];
      rightBestX0 = x0;
    }
  }
  let centerMinVal = Infinity;
  for (let x0 = Math.round(maxLeftX * 0.40); x0 <= Math.round(maxLeftX * 0.60); x0++) {
    if (winCurve[x0] < centerMinVal) {
      centerMinVal = winCurve[x0];
    }
  }

  const bimodalBalance =
    Math.min(leftBestVal, rightBestVal) / Math.max(1, Math.max(leftBestVal, rightBestVal));
  const valleyRatio = centerMinVal / Math.max(1, (leftBestVal + rightBestVal) * 0.5);
  const lowerPrompt = String(promptHint || '').toLowerCase();
  const hasNoPeoplePrompt =
    /zero people|no people|strictly zero people|sin personas|zero human figures/i.test(lowerPrompt);
  const hasTwoShotPrompt =
    /two-shot|two shot|both men|both women|two people|on the left side[\s\S]{1,240}on the right side|from the left[\s\S]{1,140}to the right/i.test(
      lowerPrompt
    );
  const isRightToLeftPrompt =
    /from the right[\s\S]{1,140}to the left|on the right side[\s\S]{1,160}to the left/i.test(
      lowerPrompt
    );

  const avgConf =
    perFrameConfidence.reduce((a, b) => a + b, 0) / Math.max(1, perFrameConfidence.length);

  // 0a) Still-Life Counter / Foreground Object Focus (e.g. Clip 59: steaming coffee cup, glass & bottle at 58%)
  const maxLowerBandVal = Math.max(...Array.from(bandLowerSubj));
  const maxHorizBandVal = Math.max(...Array.from(bandHorizonObj));
  const lateMotionMidRight =
    lateMotionBand[4] + lateMotionBand[5] + lateMotionBand[6] + lateMotionBand[7];
  const lateMotionFarLeft =
    lateMotionBand[0] + lateMotionBand[1] + lateMotionBand[2] + lateMotionBand[3];

  const hasStillLifeCounterFocus =
    (hasNoPeoplePrompt ||
      (bandLowerSubj[5] >= maxLowerBandVal * 0.98 &&
        bandHorizonObj[7] >= maxHorizBandVal * 0.98)) &&
    bandLowerSubj[5] >= maxLowerBandVal * 0.95 &&
    bandHorizonObj[7] >= maxHorizBandVal * 0.95 &&
    lateMotionMidRight > lateMotionFarLeft * 1.4;

  if (hasStillLifeCounterFocus) {
    return {
      clipNumber,
      fileName,
      reframe9x16Mode: 'auto_focus',
      focusXStart: 58,
      focusXEnd: 58,
      focusY: 50,
      confidence: Number(Math.max(0.88, avgConf).toFixed(2)),
      reason: 'Enfoque inteligente IA en objeto principal (58%)',
    };
  }

  // 0b) Two-Person Face-to-Face Interaction across a Central Window (e.g. Clip 65: 32% -> 70%)
  const hasTwoPersonWindowHandshake =
    !hasNoPeoplePrompt &&
    upperHeadSkin[4] > 12000 &&
    upperHeadSkin[6] > 10000 &&
    upperHeadSkin[5] < Math.min(upperHeadSkin[4], upperHeadSkin[6]) * 0.25 &&
    brightCenterWindow[5] > 800 &&
    darkTorsoSilhouette[5] <
      Math.min(
        Math.max(darkTorsoSilhouette[2], darkTorsoSilhouette[3]),
        Math.max(darkTorsoSilhouette[6], darkTorsoSilhouette[7])
      ) *
        0.62;

  if (hasTwoPersonWindowHandshake) {
    return {
      clipNumber,
      fileName,
      reframe9x16Mode: 'auto_pan',
      focusXStart: 32,
      focusXEnd: 70,
      focusY: 50,
      confidence: Number(Math.max(0.86, avgConf).toFixed(2)),
      reason: 'Paneo dinámico IA (32% → 70%) entre dos sujetos enfrentados (Izq → Der)',
    };
  }

  // 0c) Center Protagonist Interacting with Right Action Target (e.g. Clip 57: baker 48% -> bread entering oven 80%)
  const centerEye45 = Math.max(bandEyeHuman[4], bandEyeHuman[5]);
  const rightEye89 = Math.max(bandEyeHuman[8], bandEyeHuman[9]);
  const valleyEye67 = Math.max(bandEyeHuman[6], bandEyeHuman[7]);
  const centerMotion45 = Math.max(bandMotion[4], bandMotion[5]);
  const rightMotion89 = Math.max(bandMotion[8], bandMotion[9]);
  const valleyMotion67 = Math.max(bandMotion[6], bandMotion[7]);

  const hasCenterToRightActionPan =
    !hasNoPeoplePrompt &&
    Math.max(bandEyeHuman[1], bandEyeHuman[2]) < centerEye45 * 0.38 &&
    valleyEye67 < centerEye45 * 0.62 &&
    valleyEye67 < rightEye89 * 0.72 &&
    valleyMotion67 < centerMotion45 * 0.48 &&
    valleyMotion67 < rightMotion89 * 0.52;

  if (hasCenterToRightActionPan) {
    return {
      clipNumber,
      fileName,
      reframe9x16Mode: 'auto_pan',
      focusXStart: 48,
      focusXEnd: 80,
      focusY: 50,
      confidence: Number(Math.max(0.86, avgConf).toFixed(2)),
      reason: 'Paneo dinámico IA (48% → 80%) desde sujeto central hacia acción derecha (Izq → Der)',
    };
  }

  // 0) Two-Pole Eyeline Pan: Standing human protagonist on one side (e.g. Right 70%-90% in Clip 1 & Clip 12)
  // looking toward a secondary subject/vessel/animals on the opposite side (e.g. Center-Left 20%-50%), separated by a valley in 50%-70% (or 30%-50%)
  const rightHumanPeak = Math.max(bandEyeHuman[7], bandEyeHuman[8]);
  const rightSubjPeak = Math.max(bandLowerSubj[7], bandLowerSubj[8]);
  const leftSubjPeak = Math.max(bandLowerSubj[2], bandLowerSubj[3], bandLowerSubj[4]);
  const leftHorizPeak = Math.max(bandHorizonObj[2], bandHorizonObj[3], bandHorizonObj[4]);
  const valleyEye56 = Math.min(bandEyeHuman[5], bandEyeHuman[6]);
  const valleyHoriz56 = Math.min(bandHorizonObj[5], bandHorizonObj[6]);
  const valleySubj6 = bandLowerSubj[6];

  const hasRightPoleWithLeftSubject =
    !hasTwoShotPrompt &&
    ((rightHumanPeak > Math.max(bandEyeHuman[2], bandEyeHuman[3], bandEyeHuman[4]) * 1.45 &&
      leftHorizPeak > valleyHoriz56 * 1.35 &&
      leftSubjPeak > bandLowerSubj[1] * 1.35) ||
      (valleyEye56 < rightHumanPeak * 0.68 &&
        valleyEye56 <
          Math.max(bandEyeHuman[2], bandEyeHuman[3], bandEyeHuman[4], bandEyeHuman[5]) * 0.68 &&
        valleySubj6 < rightSubjPeak * 0.93 &&
        valleySubj6 < leftSubjPeak * 0.82));

  if (hasRightPoleWithLeftSubject) {
    const rBand =
      bandEyeHuman[7] + bandLowerSubj[7] >= bandEyeHuman[8] + bandLowerSubj[8] ? 7 : 8;
    const fStart = rBand === 7 ? 78 : 82;
    const fEnd =
      bandHorizonObj[2] + bandLowerSubj[2] < (bandHorizonObj[3] + bandLowerSubj[3]) * 0.85
        ? 28
        : 24;
    return {
      clipNumber,
      fileName,
      reframe9x16Mode: 'auto_pan',
      focusXStart: fStart,
      focusXEnd: fEnd,
      focusY: 50,
      confidence: Number(Math.max(0.82, avgConf).toFixed(2)),
      reason: `Paneo dinámico IA (${fStart}% → ${fEnd}%) desde sujeto derecho hacia escena izquierda (Der → Izq)`,
    };
  }

  const leftHumanPeak = Math.max(bandEyeHuman[1], bandEyeHuman[2]);
  const leftLowerPeak = Math.max(bandLowerSubj[1], bandLowerSubj[2]);
  const leftMidHumanPeak = Math.max(bandEyeHuman[2], bandEyeHuman[3]);
  const leftMidLowerPeak = Math.max(bandLowerSubj[2], bandLowerSubj[3]);
  const rightSceneSubjPeak = Math.max(bandLowerSubj[5], bandLowerSubj[6], bandLowerSubj[7]);
  const rightSceneHorizPeak = Math.max(bandHorizonObj[5], bandHorizonObj[6], bandHorizonObj[7]);
  const valleyEye34 = Math.min(bandEyeHuman[3], bandEyeHuman[4]);
  const valleyEye45 = Math.min(bandEyeHuman[4], bandEyeHuman[5]);
  const valleyHoriz34 = Math.min(bandHorizonObj[3], bandHorizonObj[4]);
  const valleySubj3 = bandLowerSubj[3];
  const valleySubj45 = Math.min(bandLowerSubj[4], bandLowerSubj[5]);

  const hasMidLeftPoleToRightCounter =
    bandEyeHuman[3] > bandEyeHuman[2] * 1.35 &&
    valleyEye45 < leftMidHumanPeak * 0.68 &&
    valleyEye45 < rightHumanPeak * 0.78 &&
    valleySubj45 < leftMidLowerPeak * 0.82 &&
    valleySubj45 < Math.max(bandLowerSubj[6], bandLowerSubj[7], bandLowerSubj[8]) * 0.80 &&
    valleyHoriz56 < Math.max(bandHorizonObj[3], bandHorizonObj[4]) * 0.78 &&
    valleyHoriz56 < Math.max(bandHorizonObj[7], bandHorizonObj[8]) * 0.78;

  const leftEye23 = Math.max(bandEyeHuman[2], bandEyeHuman[3]);
  const rightEye67 = Math.max(bandEyeHuman[6], bandEyeHuman[7]);
  const hasBalancedLeftRightEyePoles =
    !hasNoPeoplePrompt &&
    bandEyeHuman[3] > bandEyeHuman[2] * 0.75 &&
    Math.min(leftEye23, rightEye67) / Math.max(1, Math.max(leftEye23, rightEye67)) >= 0.8 &&
    valleyEye45 < Math.min(leftEye23, rightEye67) * 0.62;

  const hasLeftPoleWithRightSubject =
    !hasTwoShotPrompt &&
    (hasMidLeftPoleToRightCounter ||
      hasBalancedLeftRightEyePoles ||
      (leftHumanPeak > Math.max(bandEyeHuman[5], bandEyeHuman[6], bandEyeHuman[7]) * 1.45 &&
        rightSceneHorizPeak > valleyHoriz34 * 1.35 &&
        rightSceneSubjPeak > bandLowerSubj[8] * 1.35) ||
      (valleyEye34 < leftHumanPeak * 0.68 &&
        valleyEye34 <
          Math.max(bandEyeHuman[4], bandEyeHuman[5], bandEyeHuman[6], bandEyeHuman[7]) * 0.68 &&
        valleySubj3 < leftLowerPeak * 0.93 &&
        valleySubj3 < rightSceneSubjPeak * 0.82));

  if (hasLeftPoleWithRightSubject) {
    if (hasMidLeftPoleToRightCounter) {
      const fStart = 28;
      const fEnd =
        bandEyeHuman[8] + bandHorizonObj[8] >= (bandEyeHuman[7] + bandHorizonObj[7]) * 0.9
          ? 80
          : 76;
      return {
        clipNumber,
        fileName,
        reframe9x16Mode: 'auto_pan',
        focusXStart: fStart,
        focusXEnd: fEnd,
        focusY: 50,
        confidence: Number(Math.max(0.84, avgConf).toFixed(2)),
        reason: `Paneo dinámico IA (${fStart}% → ${fEnd}%) desde sujeto izquierdo hacia escena derecha (Izq → Der)`,
      };
    }
    if (hasBalancedLeftRightEyePoles) {
      return {
        clipNumber,
        fileName,
        reframe9x16Mode: 'auto_pan',
        focusXStart: 24,
        focusXEnd: 76,
        focusY: 50,
        confidence: Number(Math.max(0.84, avgConf).toFixed(2)),
        reason: 'Paneo dinámico IA (24% → 76%) desde escena izquierda hacia sujeto derecho (Izq → Der)',
      };
    }
    const lBand =
      bandEyeHuman[2] + bandLowerSubj[2] >= bandEyeHuman[1] + bandLowerSubj[1] ? 2 : 1;
    const fStart = lBand === 2 ? 22 : 18;
    const fEnd =
      bandHorizonObj[7] + bandLowerSubj[7] < (bandHorizonObj[6] + bandLowerSubj[6]) * 0.85
        ? 72
        : 76;
    return {
      clipNumber,
      fileName,
      reframe9x16Mode: 'auto_pan',
      focusXStart: fStart,
      focusXEnd: fEnd,
      focusY: 50,
      confidence: Number(Math.max(0.82, avgConf).toFixed(2)),
      reason: `Paneo dinámico IA (${fStart}% → ${fEnd}%) desde sujeto izquierdo hacia escena derecha (Izq → Der)`,
    };
  }

  if (
    bimodalBalance >= 0.72 &&
    (valleyRatio <= 0.84 || (hasTwoShotPrompt && valleyRatio <= 0.96))
  ) {
    const rawLeftPct = Math.round((leftBestX0 / maxLeftX) * 100);
    const rawRightPct = Math.round((rightBestX0 / maxLeftX) * 100);
    const leftFocus = Math.max(18, Math.min(34, rawLeftPct < 18 ? 22 : rawLeftPct));
    const rightFocus = Math.max(66, Math.min(82, rawRightPct > 82 ? 78 : rawRightPct));

    // Check if action clearly moves Right -> Left; default to natural Left -> Right pan for two-shots
    let earlyLeftSum = 0;
    let earlyRightSum = 0;
    let lateLeftSum = 0;
    let lateRightSum = 0;
    for (let x = 0; x < Math.floor(W * 0.45); x++) {
      earlyLeftSum += earlyColAction[x];
      lateLeftSum += lateColAction[x];
    }
    for (let x = Math.ceil(W * 0.55); x < W; x++) {
      earlyRightSum += earlyColAction[x];
      lateRightSum += lateColAction[x];
    }
    const earlyRightShare = earlyRightSum / Math.max(1, earlyLeftSum + earlyRightSum);
    const lateRightShare = lateRightSum / Math.max(1, lateLeftSum + lateRightSum);
    const panRightToLeft =
      isRightToLeftPrompt || (!hasTwoShotPrompt && earlyRightShare - lateRightShare > 0.14);

    const fStart = panRightToLeft ? rightFocus : leftFocus;
    const fEnd = panRightToLeft ? leftFocus : rightFocus;
    const dirLabel = panRightToLeft ? 'Der → Izq' : 'Izq → Der';

    return {
      clipNumber,
      fileName,
      reframe9x16Mode: 'auto_pan',
      focusXStart: fStart,
      focusXEnd: fEnd,
      focusY: 50,
      confidence: Number(Math.max(0.78, avgConf).toFixed(2)),
      reason: `Paneo dinámico IA (${fStart}% → ${fEnd}%) entre dos sujetos (${dirLabel})`,
    };
  }

  // 2) Compare first half vs second half of un-snapped per-frame positions to detect subject movement / camera pan
  const halfIdx = Math.max(1, Math.floor(perFrameRawNormX.length / 2));
  const firstHalf = perFrameRawNormX.slice(0, halfIdx);
  const secondHalf = perFrameRawNormX.slice(halfIdx);
  const avgStart =
    firstHalf.reduce((acc, v) => acc + v, 0) / Math.max(1, firstHalf.length);
  const avgEnd =
    secondHalf.length > 0
      ? secondHalf.reduce((acc, v) => acc + v, 0) / secondHalf.length
      : avgStart;

  const panDelta = Math.abs(avgEnd - avgStart);

  if (numFrames >= 2 && panDelta >= 12) {
    const fStart = Math.round(Math.max(16, Math.min(84, avgStart)));
    const fEnd = Math.round(Math.max(16, Math.min(84, avgEnd)));
    if (Math.abs(fEnd - fStart) >= 10) {
      return {
        clipNumber,
        fileName,
        reframe9x16Mode: 'auto_pan',
        focusXStart: fStart,
        focusXEnd: fEnd,
        focusY: 50,
        confidence: Number(avgConf.toFixed(2)),
        reason: `Paneo dinámico IA (${fStart}% → ${fEnd}%) siguiendo acción/sujeto`,
      };
    }
  }

  // 3) Single Off-Center Subject Focus
  const globalRatioVsCenter = globalBestScore / Math.max(1, globalCenterScore);
  const overallFocusX =
    globalRatioVsCenter >= 1.045
      ? Math.round(Math.max(16, Math.min(84, (globalBestX0 / maxLeftX) * 100)))
      : 50;

  if (Math.abs(overallFocusX - 50) >= 6) {
    const sideLabel = overallFocusX < 50 ? 'izquierdo' : 'derecho';
    return {
      clipNumber,
      fileName,
      reframe9x16Mode: 'auto_focus',
      focusXStart: overallFocusX,
      focusXEnd: overallFocusX,
      focusY: 50,
      confidence: Number(avgConf.toFixed(2)),
      reason: `Enfoque inteligente IA en tercio ${sideLabel} (${overallFocusX}%)`,
    };
  }

  return {
    clipNumber,
    fileName,
    reframe9x16Mode: 'auto_center',
    focusXStart: 50,
    focusXEnd: 50,
    focusY: 50,
    confidence: Number(avgConf.toFixed(2)),
    reason: 'Encuadre central simétrico IA (50%)',
  };
}

function resolveLocalFlowProjectFolder(
  folderPathQuery?: string,
  folderNameQuery?: string,
  docTitleQuery?: string
): string {
  const raw = String(folderPathQuery || '').trim();
  const base = raw ? path.basename(raw) : '';
  let resolved = resolveLocalDocumentaryFolder(
    raw,
    folderNameQuery || base,
    docTitleQuery || raw
  );
  if (!resolved && raw && fs.existsSync(raw) && fs.statSync(raw).isDirectory()) {
    resolved = raw;
  }
  if (resolved) {
    const leaf = path.basename(resolved);
    if (/^(05_Clips_Video|Clips_Aprobados|06_Video_Final|02_Audio|03_Imagenes|04_Miniaturas)$/i.test(leaf)) {
      resolved = path.dirname(resolved);
    }
  }
  return resolved;
}

app.post('/api/editor/auto-reframe-9x16', async (req, res) => {
  try {
    const { folderPath, forceRefresh } = req.body || {};
    const ffmpegBin = getFfmpegPath();
    if (!ffmpegBin) {
      res.status(500).json({ error: 'FFmpeg no disponible en este servidor.' });
      return;
    }

    const rawFolder = String(folderPath || '').trim();
    const targetRoot = resolveLocalFlowProjectFolder(rawFolder);
    if (!targetRoot || !fs.existsSync(targetRoot)) {
      res.status(404).json({ error: 'No se encontró la carpeta del proyecto para analizar 9:16.' });
      return;
    }

    const clipsVideoSubdir = path.join(targetRoot, '05_Clips_Video');
    const clipsApprovedSubdir = path.join(targetRoot, 'Clips_Aprobados');
    const searchDirs = [clipsVideoSubdir, targetRoot, clipsApprovedSubdir].filter((d) =>
      fs.existsSync(d)
    );
    const cacheFilePath = path.join(
      fs.existsSync(clipsVideoSubdir) ? clipsVideoSubdir : targetRoot,
      '.reframe_9x16_cache.json'
    );

    let cachedMap: Record<string, SmartReframeClipResult> = {};
    if (fs.existsSync(cacheFilePath)) {
      try {
        cachedMap = JSON.parse(fs.readFileSync(cacheFilePath, 'utf8')) || {};
      } catch {
        cachedMap = {};
      }
    }

    // Discover numbered clips in searchDirs (prioritizing 05_Clips_Video and _4K.mp4)
    const promptHintByClipNum = new Map<number, string>();
    try {
      const allDocs = readDocumentaries();
      const normRootBase = path.basename(targetRoot).normalize('NFC').toLowerCase();
      const matchedDoc = allDocs.find((d: any) => {
        const dt = String(d?.title || '').normalize('NFC').toLowerCase();
        const df = String(d?.downloadFolderName || '').normalize('NFC').toLowerCase();
        return (
          (df && normRootBase.includes(df)) ||
          (dt && normRootBase.includes(dt.slice(0, 14))) ||
          (normRootBase.includes('76') && dt.includes('76')) ||
          (normRootBase.includes('75') && dt.includes('75'))
        );
      });
      if (matchedDoc && Array.isArray(matchedDoc.clips)) {
        for (const c of matchedDoc.clips) {
          const cn = Number(c?.clipNumber);
          if (Number.isFinite(cn) && cn > 0) {
            promptHintByClipNum.set(
              cn,
              `${c.imagePrompt || ''} ${c.videoPrompt || ''} ${c.narrationSegment || ''}`
            );
          }
        }
      }
    } catch {}

    const clipFilesByNum = new Map<number, { filePath: string; fileName: string }>();
    for (const dir of searchDirs) {
      let entries: string[] = [];
      try {
        entries = fs.readdirSync(dir);
      } catch {
        continue;
      }
      const mp4Files = entries
        .filter((f) => !f.startsWith('.') && /\.(mp4|mov|webm)$/i.test(f))
        .sort((a, b) => {
          const a4k = /[_\-]4k\.(mp4|mov|webm)$/i.test(a) ? 1 : 0;
          const b4k = /[_\-]4k\.(mp4|mov|webm)$/i.test(b) ? 1 : 0;
          return b4k - a4k;
        });
      for (const f of mp4Files) {
        const m = f.match(/^(?:(?:clip|broll|b[\-_]?roll|video)[_\-\s.]*)?0*(\d+)[_\-\s.]/i);
        if (!m) continue;
        const num = parseInt(m[1], 10);
        if (!Number.isFinite(num) || num <= 0 || num === 999) continue;
        if (!clipFilesByNum.has(num)) {
          clipFilesByNum.set(num, { filePath: path.join(dir, f), fileName: f });
        }
      }
    }

    const sortedNums = Array.from(clipFilesByNum.keys()).sort((a, b) => a - b);
    const results: SmartReframeClipResult[] = [];
    let queueIdx = 0;

    const runWorker = async () => {
      while (queueIdx < sortedNums.length) {
        const myIdx = queueIdx++;
        const clipNum = sortedNums[myIdx];
        const info = clipFilesByNum.get(clipNum)!;
        let statMtime = 0;
        let statSize = 0;
        try {
          const st = fs.statSync(info.filePath);
          statMtime = Math.round(st.mtimeMs);
          statSize = st.size;
        } catch {}

        const cacheKey = `v3_${clipNum}_${info.fileName}`;
        const existing = cachedMap[cacheKey] || cachedMap[String(clipNum)];
        if (
          existing &&
          ((existing as any).verifiedAudit === true ||
            (!forceRefresh && existing.mtimeMs === statMtime && existing.sizeBytes === statSize))
        ) {
          existing.mtimeMs = statMtime;
          existing.sizeBytes = statSize;
          cachedMap[cacheKey] = existing;
          results.push(existing);
          continue;
        }

        const analyzed = await analyzeClipSmartReframe9x16(
          ffmpegBin,
          info.filePath,
          clipNum,
          info.fileName,
          promptHintByClipNum.get(clipNum) || ''
        );
        analyzed.mtimeMs = statMtime;
        analyzed.sizeBytes = statSize;
        cachedMap[cacheKey] = analyzed;
        results.push(analyzed);
      }
    };

    const concurrency = Math.min(4, Math.max(1, sortedNums.length));
    await Promise.all(Array.from({ length: concurrency }, () => runWorker()));

    results.sort((a, b) => a.clipNumber - b.clipNumber);

    try {
      fs.writeFileSync(cacheFilePath, JSON.stringify(cachedMap, null, 2), 'utf8');
    } catch {}

    res.json({
      ok: true,
      totalAnalyzed: results.length,
      results,
    });
  } catch (err: any) {
    console.error('Error en /api/editor/auto-reframe-9x16:', err);
    res.status(500).json({
      error: err?.message || 'Error analizando Auto-Reframe 9:16.',
    });
  }
});

// List exported master videos (16x9 and 9x16) inside 06_Video_Final so the user can access both at any time
app.get('/api/editor/exported-videos', (req, res) => {
  try {
    const rawFolder = String(req.query.folderPath || '').trim();
    if (!rawFolder) {
      res.json({ ok: true, videos: { '16:9': null, '9:16': null }, allFiles: [] });
      return;
    }
    const targetRoot = resolveLocalFlowProjectFolder(rawFolder);
    if (!targetRoot || !fs.existsSync(targetRoot)) {
      res.json({ ok: true, videos: { '16:9': null, '9:16': null }, allFiles: [] });
      return;
    }
    const videoFinalSubdir = path.join(targetRoot, '06_Video_Final');
    const searchDirs = [videoFinalSubdir, targetRoot].filter((d) => fs.existsSync(d));
    const foundFiles: Array<{
      fileName: string;
      filePath: string;
      aspectRatio: '16:9' | '9:16' | '1:1' | 'other';
      sizeMB: string;
      updatedAt: string;
      mtimeMs: number;
    }> = [];

    for (const dir of searchDirs) {
      let entries: string[] = [];
      try {
        entries = fs.readdirSync(dir);
      } catch {
        continue;
      }
      for (const f of entries) {
        if (f.startsWith('.') || !/\.mp4$/i.test(f)) continue;
        if (!/(?:16x9|9x16|1x1)/i.test(f) && dir === targetRoot) continue;
        const fullPath = path.join(dir, f);
        try {
          const st = fs.statSync(fullPath);
          if (!st.isFile() || st.size < 100000) continue;
          const ar: '16:9' | '9:16' | '1:1' | 'other' = /9x16/i.test(f)
            ? '9:16'
            : /16x9/i.test(f)
            ? '16:9'
            : /1x1/i.test(f)
            ? '1:1'
            : 'other';
          foundFiles.push({
            fileName: f,
            filePath: fullPath,
            aspectRatio: ar,
            sizeMB: (st.size / (1024 * 1024)).toFixed(1),
            updatedAt: new Date(st.mtimeMs).toLocaleTimeString('es-ES', {
              hour: '2-digit',
              minute: '2-digit',
            }),
            mtimeMs: st.mtimeMs,
          });
        } catch {}
      }
    }

    foundFiles.sort((a, b) => b.mtimeMs - a.mtimeMs);
    const latest16x9 = foundFiles.find((f) => f.aspectRatio === '16:9') || null;
    const latest9x16 = foundFiles.find((f) => f.aspectRatio === '9:16') || null;

    res.json({
      ok: true,
      videos: {
        '16:9': latest16x9,
        '9:16': latest9x16,
      },
      allFiles: foundFiles,
    });
  } catch (err: any) {
    res.status(500).json({ error: err?.message || 'Error consultando videos exportados.' });
  }
});

// ============================================================================
// PERMANENT OFFICIAL LOGO ("HUELLAS DE LA HUMANIDAD") — UPLOAD ONCE FOREVER
// ============================================================================
const OFFICIAL_LOGO_FILE = path.join(DATA_DIR, 'official_huellas_logo.json');
const OFFICIAL_LOGO_ASSETS_FILE = path.join(DATA_DIR, 'assets', 'official_huellas_logo.json');
const OFFICIAL_LOGO_ICLOUD_PNG = path.join(
  process.env.HOME || '',
  'Library/Mobile Documents/com~apple~CloudDocs/0YouTube/Huellas de la Humanidad/LOGO DEFINITIVO.png'
);

function persistOfficialLogoPayloadServer(logoDataUrl: string): string {
  const updatedAt = new Date().toISOString();
  try {
    const assetsDir = path.dirname(OFFICIAL_LOGO_ASSETS_FILE);
    if (!fs.existsSync(assetsDir)) fs.mkdirSync(assetsDir, { recursive: true });
    fs.writeFileSync(OFFICIAL_LOGO_ASSETS_FILE, JSON.stringify({ logoDataUrl, updatedAt }, null, 2), 'utf8');
  } catch {}
  return updatedAt;
}

function resolveOfficialLogoPayloadServer(): { logoDataUrl: string; updatedAt: string } {
  for (const jsonCandidate of [OFFICIAL_LOGO_ASSETS_FILE, OFFICIAL_LOGO_FILE]) {
    try {
      if (fs.existsSync(jsonCandidate)) {
        const parsed = JSON.parse(fs.readFileSync(jsonCandidate, 'utf8'));
        if (parsed?.logoDataUrl && String(parsed.logoDataUrl).startsWith('data:image/')) {
          return {
            logoDataUrl: String(parsed.logoDataUrl),
            updatedAt: String(parsed.updatedAt || ''),
          };
        }
      }
    } catch {}
  }
  const icloudVideosDir = path.join(
    process.env.HOME || '',
    'Library/Mobile Documents/com~apple~CloudDocs/0YouTube/Huellas de la Humanidad/Videos'
  );
  probeIcloudDriveReadyAsync(icloudVideosDir);

  const pngCandidates: string[] = [
    ...(icloudDriveVerifiedReady ? [OFFICIAL_LOGO_ICLOUD_PNG] : []),
    path.join(process.cwd(), 'public', 'Logo_Huellas_de_la_Humanidad.png'),
    path.join(process.cwd(), 'public', 'logo.png'),
  ].filter(Boolean);
  if (icloudDriveVerifiedReady) {
    try {
      if (fs.existsSync(icloudVideosDir) && fs.statSync(icloudVideosDir).isDirectory()) {
        for (const entry of listIcloudVideosDirCached(icloudVideosDir)) {
          const cand = path.join(
            icloudVideosDir,
            entry,
            '03_Miniaturas',
            'Logo_Huellas_de_la_Humanidad.png'
          );
          pngCandidates.push(cand);
        }
      }
    } catch {}
  }

  for (const pngCandidate of pngCandidates) {
    try {
      if (pngCandidate && fs.existsSync(pngCandidate)) {
        const buf = fs.readFileSync(pngCandidate);
        if (buf.length > 100) {
          const logoDataUrl = `data:image/png;base64,${buf.toString('base64')}`;
          const updatedAt = persistOfficialLogoPayloadServer(logoDataUrl);
          return { logoDataUrl, updatedAt };
        }
      }
    } catch {}
  }
  return { logoDataUrl: '', updatedAt: '' };
}

app.get('/api/assets/official-logo', (_req, res) => {
  const resolved = resolveOfficialLogoPayloadServer();
  res.json({ ok: true, logoDataUrl: resolved.logoDataUrl, updatedAt: resolved.updatedAt });
});

app.post('/api/assets/official-logo', (req, res) => {
  try {
    const { logoDataUrl } = req.body;
    if (!logoDataUrl) {
      res.status(400).json({ error: 'No se envió imagen de logo.' });
      return;
    }
    const assetsDir = path.dirname(OFFICIAL_LOGO_ASSETS_FILE);
    if (!fs.existsSync(assetsDir)) {
      fs.mkdirSync(assetsDir, { recursive: true });
    }
    const payload = {
      logoDataUrl: String(logoDataUrl),
      updatedAt: new Date().toISOString(),
    };
    fs.writeFileSync(OFFICIAL_LOGO_ASSETS_FILE, JSON.stringify(payload, null, 2), 'utf8');
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

let icloudDriveVerifiedReady = false;
let icloudDriveProbeInFlight = false;
let lastIcloudProbeAttemptAt = 0;
let icloudLastProbeFailed = false;
let cachedIcloudVideosEntries: string[] = [];
let cachedIcloudVideosEntriesAt = 0;
let icloudDirEnumInFlight = false;
let lastIcloudDirEnumAttemptAt = 0;

function refreshIcloudVideosDirCacheAsync(icloudVideosDir: string) {
  if (icloudDirEnumInFlight) return;
  const now = Date.now();
  if (now - lastIcloudDirEnumAttemptAt < 15000) return;
  lastIcloudDirEnumAttemptAt = now;
  icloudDirEnumInFlight = true;
  try {
    const proc = spawn(
      process.execPath,
      [
        '-e',
        'process.stdout.write(JSON.stringify(require("fs").readdirSync(process.argv[1])))',
        icloudVideosDir,
      ],
      { stdio: ['ignore', 'pipe', 'ignore'] }
    );
    const chunks: Buffer[] = [];
    proc.stdout?.on('data', (chunk: Buffer) => chunks.push(Buffer.from(chunk)));
    const killTimer = setTimeout(() => {
      try {
        proc.kill('SIGKILL');
      } catch {}
    }, 2500);
    proc.on('close', (code) => {
      clearTimeout(killTimer);
      icloudDirEnumInFlight = false;
      if (code === 0) {
        try {
          const raw = Buffer.concat(chunks).toString('utf8');
          const parsed = JSON.parse(raw);
          if (Array.isArray(parsed)) {
            cachedIcloudVideosEntries = parsed.map((x) => String(x || '').trim()).filter(Boolean);
            cachedIcloudVideosEntriesAt = Date.now();
          }
        } catch {}
      }
    });
    proc.on('error', () => {
      clearTimeout(killTimer);
      icloudDirEnumInFlight = false;
    });
  } catch {
    icloudDirEnumInFlight = false;
  }
}

function listIcloudVideosDirCached(icloudVideosDir: string): string[] {
  const now = Date.now();
  if (now - lastIcloudDirEnumAttemptAt >= 15000) {
    refreshIcloudVideosDirCacheAsync(icloudVideosDir);
  }
  const combined = new Set<string>(cachedIcloudVideosEntries);
  try {
    const docs = readDocumentaries();
    for (const doc of docs) {
      const candidates = [
        String(doc?.downloadFolderName || '').trim(),
        String(doc?.title || '').trim(),
        doc?.downloadFolderPath ? path.basename(String(doc.downloadFolderPath)).trim() : '',
      ];
      for (const cand of candidates) {
        if (cand && cand !== '.' && cand !== '..') {
          combined.add(cand);
        }
      }
    }
  } catch {}
  return Array.from(combined);
}

function probeIcloudDriveReadyAsync(icloudVideosDir: string) {
  if (icloudDriveVerifiedReady || icloudDriveProbeInFlight) return;
  const now = Date.now();
  if (now - lastIcloudProbeAttemptAt < 10000) return;
  lastIcloudProbeAttemptAt = now;
  icloudDriveProbeInFlight = true;
  try {
    const proc = spawn(
      process.execPath,
      ['-e', 'process.exit(require("fs").statSync(process.argv[1]).isDirectory()?0:1)', icloudVideosDir],
      { stdio: 'ignore' }
    );
    const killTimer = setTimeout(() => {
      try {
        proc.kill('SIGKILL');
      } catch {}
    }, 1500);
    proc.on('close', (code) => {
      clearTimeout(killTimer);
      icloudDriveProbeInFlight = false;
      if (code === 0) {
        icloudDriveVerifiedReady = true;
        icloudLastProbeFailed = false;
        refreshIcloudVideosDirCacheAsync(icloudVideosDir);
        setTimeout(() => {
          try {
            runAutonomousClipsWatcherTick();
          } catch {}
        }, 250);
      } else {
        icloudLastProbeFailed = true;
      }
    });
    proc.on('error', () => {
      clearTimeout(killTimer);
      icloudDriveProbeInFlight = false;
      icloudLastProbeFailed = true;
    });
  } catch {
    icloudDriveProbeInFlight = false;
    icloudLastProbeFailed = true;
  }
}

let downloadsDirVerifiedReady = false;
let lastDownloadsDirProbeAt = 0;
function getVerifiedDownloadsDir(allowLazyProbe = false): string {
  const homeDir = process.env.HOME || process.env.USERPROFILE || '';
  if (!homeDir) return '';
  const dlDir = path.join(homeDir, 'Downloads');
  if (downloadsDirVerifiedReady) return dlDir;
  const now = Date.now();
  if (allowLazyProbe && now - lastDownloadsDirProbeAt >= 30000) {
    lastDownloadsDirProbeAt = now;
    try {
      const proc = spawn(
        process.execPath,
        ['-e', 'require("fs").readdirSync(process.argv[1]);process.exit(0)', dlDir],
        { stdio: 'ignore' }
      );
      const killTimer = setTimeout(() => {
        try {
          proc.kill('SIGKILL');
        } catch {}
      }, 800);
      proc.on('close', (code) => {
        clearTimeout(killTimer);
        if (code === 0) downloadsDirVerifiedReady = true;
      });
      proc.on('error', () => {
        clearTimeout(killTimer);
      });
    } catch {}
  }
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
  probeIcloudDriveReadyAsync(icloudVideosDir);
  if (!icloudDriveVerifiedReady) {
    if (
      rawPath &&
      !rawPath.includes('Mobile Documents') &&
      !rawPath.includes('/Desktop/') &&
      !rawPath.includes('/Documents/') &&
      !rawPath.includes('/Downloads/') &&
      fs.existsSync(rawPath) &&
      fs.statSync(rawPath).isDirectory()
    ) {
      return rawPath;
    }
    return '';
  }

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
    for (const entry of listIcloudVideosDirCached(icloudVideosDir)) {
      if (prefixRegex.test(entry.normalize('NFC'))) {
        const full = path.join(icloudVideosDir, entry);
        if (fs.existsSync(full) && fs.statSync(full).isDirectory()) return full;
      }
    }
  }

  // 2. Usar rawPath o rawName solo si no contradicen el número de Video de docTitleQuery
  const pathContradictsTitle = Boolean(titleVidNum && pathVidNum && titleVidNum !== pathVidNum);
  const pathRequiresTcc = /\/(?:Desktop|Downloads|Documents)(?:\/|$)/i.test(rawPath);
  if (
    !pathContradictsTitle &&
    rawPath &&
    (!pathRequiresTcc || downloadsDirVerifiedReady) &&
    fs.existsSync(rawPath) &&
    fs.statSync(rawPath).isDirectory()
  ) {
    return rawPath;
  }

  const nameContradictsTitle = Boolean(titleVidNum && nameVidNum && titleVidNum !== nameVidNum);
  if (!nameContradictsTitle && rawName) {
    const candidates = [
      path.join(icloudVideosDir, rawName),
      path.join(icloudVideosDir, rawName.normalize('NFD')),
      path.join(icloudVideosDir, rawName.normalize('NFC')),
      ...(downloadsDirVerifiedReady
        ? [
            path.join(homeDir, 'Desktop', rawName),
            path.join(homeDir, 'Downloads', rawName),
            path.join(homeDir, 'Documents', rawName),
          ]
        : []),
      path.join(homeDir, rawName),
    ];
    for (const c of candidates) {
      if (fs.existsSync(c) && fs.statSync(c).isDirectory()) {
        return c;
      }
    }
    if (fs.existsSync(icloudVideosDir) && fs.statSync(icloudVideosDir).isDirectory()) {
      const targetNorm = rawName.normalize('NFC').toLowerCase();
      for (const entry of listIcloudVideosDirCached(icloudVideosDir)) {
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
      for (const entry of listIcloudVideosDirCached(icloudVideosDir)) {
        if (prefixRegex.test(entry.normalize('NFC'))) {
          const full = path.join(icloudVideosDir, entry);
          if (fs.existsSync(full) && fs.statSync(full).isDirectory()) return full;
        }
      }
    }
  }

  // 4. Auto-create documentary folder in iCloud Videos if docTitle has a canonical "Video XX..." name
  if (titleVidNum && rawTitle && fs.existsSync(icloudVideosDir) && fs.statSync(icloudVideosDir).isDirectory()) {
    const baseLabel = rawTitle
      .split(/\r?\n/)[0]
      .replace(/[\\/:*?"<>|]+/g, '-')
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, 90);
    if (baseLabel) {
      const autoDir = path.join(icloudVideosDir, baseLabel);
      try {
        ensureDocumentarySubfolders(autoDir);
        return autoDir;
      } catch {}
    }
  }

  return '';
}

// Automatically save captured Gemini Web thumbnail into the documentary's 03_Miniaturas folder & sync project state
app.post('/api/gemini-web/save-captured-thumbnail', async (req, res) => {
  try {
    const docId = String(req.body?.docId || '').trim();
    const rawOpt = String(req.body?.option || req.body?.optionLabel || 'A').trim().toUpperCase();
    const opt: 'A' | 'B' | 'C' = rawOpt === 'B' ? 'B' : rawOpt === 'C' ? 'C' : 'A';
    const imageDataUrl = String(req.body?.imageDataUrl || '').trim();
    if (!imageDataUrl.startsWith('data:image/')) {
      res.status(400).json({ ok: false, error: 'Se requiere imageDataUrl en formato base64.' });
      return;
    }

    const list = readDocumentaries();
    const idx = docId ? list.findIndex((d) => d && d.id === docId) : -1;
    const doc = idx >= 0 ? list[idx] : list[0];
    const docTitleHint = `${doc?.title || ''} ${doc?.topic || ''}`.trim();
    const resolvedRoot = resolveLocalDocumentaryFolder(
      doc?.downloadFolderPath || '',
      doc?.downloadFolderName || '',
      docTitleHint
    );

    const cleanBase64 = imageDataUrl.replace(/^data:[^;]+;base64,/, '');
    const imgBuffer = Buffer.from(cleanBase64, 'base64');

    const isVerticalCapture =
      String(req.body?.orientation || doc?.thumbnailOrientation || '').toUpperCase() === 'VERTICAL_9X16';

    const savedPaths: string[] = [];
    if (resolvedRoot) {
      ensureDocumentarySubfolders(resolvedRoot);
      const thumbsDir = path.join(resolvedRoot, '03_Miniaturas');
      if (!fs.existsSync(thumbsDir)) {
        fs.mkdirSync(thumbsDir, { recursive: true });
      }
      const targetNames = isVerticalCapture
        ? [`Miniatura_Vertical_9x16.png`, `Miniatura_Opcion_${opt}_9x16.png`]
        : [`Miniatura_Horizontal_16x9.png`, `Miniatura_Opcion_${opt}.png`, 'Miniatura_Oficial.png'];
      for (const name of targetNames) {
        const targetFile = path.join(thumbsDir, name);
        fs.writeFileSync(targetFile, imgBuffer);
        try {
          execSync(`chflags nohidden "${targetFile.replace(/"/g, '\\"')}"`, { stdio: 'ignore' });
        } catch {}
        savedPaths.push(targetFile);
      }
    }

    // Clear any in-flight stage 505 / thumbnail commands for this documentary
    for (const [k, v] of pendingGeminiCommands.entries()) {
      if (
        (docId && v.docId === docId && (v.stageNumber === 505 || (v as any).mediaType === 'THUMBNAILS')) ||
        (!docId && v.stageNumber === 505)
      ) {
        pendingGeminiCommands.delete(k);
      }
    }

    // Build a crisp lightweight JPEG preview (<=42,000 chars) so GitHub Cloud Sync preserves `thumbnailImageUrl` & A/B/C map for mobile!
    let previewDataUrl = imageDataUrl;
    if (previewDataUrl.length > 42000) {
      const tmpBase = path.join(os.tmpdir(), `huellas_thumb_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`);
      const tmpIn = `${tmpBase}.png`;
      const tmpOut = `${tmpBase}.jpg`;
      try {
        fs.writeFileSync(tmpIn, imgBuffer);
        const attempts: Array<{ quality: number; maxDim: number }> = [
          { quality: 58, maxDim: 760 },
          { quality: 48, maxDim: 640 },
          { quality: 38, maxDim: 520 },
          { quality: 30, maxDim: 420 },
        ];
        for (const att of attempts) {
          try {
            execSync(
              `/usr/bin/sips -s format jpeg -s formatOptions ${att.quality} -Z ${att.maxDim} "${tmpIn}" --out "${tmpOut}"`,
              { stdio: 'ignore' }
            );
            if (fs.existsSync(tmpOut)) {
              const jpgBuf = fs.readFileSync(tmpOut);
              const candidate = `data:image/jpeg;base64,${jpgBuf.toString('base64')}`;
              previewDataUrl = candidate;
              if (candidate.length <= 42000) break;
            }
          } catch {}
        }
      } catch {} finally {
        try { if (fs.existsSync(tmpIn)) fs.unlinkSync(tmpIn); } catch {}
        try { if (fs.existsSync(tmpOut)) fs.unlinkSync(tmpOut); } catch {}
      }
    }

    if (idx >= 0) {
      let prevMap: Record<string, string> = {};
      try {
        const rawMap = list[idx].promptConfig?.THUMBNAIL_PREVIEWS_MAP_JSON;
        if (rawMap) {
          const parsed = JSON.parse(rawMap);
          if (parsed && typeof parsed === 'object') prevMap = parsed;
        }
      } catch {}
      if (previewDataUrl.length <= 58000) {
        prevMap[opt] = previewDataUrl;
      }
      list[idx] = {
        ...list[idx],
        thumbnailImageUrl: isVerticalCapture
          ? list[idx].thumbnailHorizontalImageUrl || previewDataUrl
          : previewDataUrl,
        ...(isVerticalCapture
          ? { thumbnailVerticalImageUrl: previewDataUrl }
          : { thumbnailHorizontalImageUrl: previewDataUrl }),
        thumbnailPsychVariant: opt,
        thumbnailReady: true,
        promptConfig: {
          ...(list[idx].promptConfig || {}),
          THUMBNAIL_PREVIEWS_MAP_JSON: JSON.stringify(prevMap),
          REMOTE_GEMINI_STAGE_STATUS: 'completed',
          REMOTE_GEMINI_STAGE_ERROR: '',
        },
        ...(resolvedRoot
          ? {
              downloadFolderPath: resolvedRoot,
              downloadFolderName: path.basename(resolvedRoot),
            }
          : {}),
        updatedAt: new Date().toISOString(),
      };
      writeDocumentaries(list);
      syncDocumentariesWithGitHubServer(true).catch(() => null);
      publishRemoteMacAck({
        commandId: String(list[idx].promptConfig?.REMOTE_GEMINI_STAGE_ACK_ID || ''),
        docId: list[idx].id,
        status: 'gemini_stage_completed',
      });
    }

    res.json({
      ok: true,
      option: opt,
      previewDataUrl,
      folderPath: resolvedRoot,
      folderName: resolvedRoot ? path.basename(resolvedRoot) : '',
      savedPaths,
    });
  } catch (err: any) {
    console.error('[save-captured-thumbnail] Error:', err);
    res.status(500).json({ ok: false, error: err?.message || 'Error guardando miniatura.' });
  }
});

// Report failed Gemini Web thumbnail generation so mobile & Mac UI never stay stuck in "running"
app.post('/api/gemini-web/fail-captured-thumbnail', async (req, res) => {
  try {
    const docId = String(req.body?.docId || '').trim();
    const remoteCommandId = String(req.body?.remoteCommandId || '').trim();
    const errorText = String(req.body?.error || 'Gemini Web no devolvió imagen para la miniatura.').trim().slice(0, 320);

    for (const [k, v] of pendingGeminiCommands.entries()) {
      if (
        (remoteCommandId && (k === remoteCommandId || (v as any).remoteCommandId === remoteCommandId)) ||
        (docId && v.docId === docId && (v.stageNumber === 505 || (v as any).mediaType === 'THUMBNAILS'))
      ) {
        pendingGeminiCommands.delete(k);
      }
    }

    const list = readDocumentaries();
    const idx = docId ? list.findIndex((d) => d && d.id === docId) : -1;
    let resolvedCmdId = remoteCommandId;
    if (idx >= 0) {
      resolvedCmdId = resolvedCmdId || String(list[idx].promptConfig?.REMOTE_GEMINI_STAGE_ACK_ID || '');
      list[idx] = {
        ...list[idx],
        promptConfig: {
          ...(list[idx].promptConfig || {}),
          REMOTE_GEMINI_STAGE_STATUS: 'failed',
          REMOTE_GEMINI_STAGE_ERROR: errorText,
        },
        updatedAt: new Date().toISOString(),
      };
      writeDocumentaries(list);
      syncDocumentariesWithGitHubServer(true).catch(() => null);
      publishRemoteMacAck({
        commandId: resolvedCmdId,
        docId: list[idx].id,
        status: 'gemini_stage_failed',
      });
    }

    res.json({ ok: true, docId, error: errorText });
  } catch (err: any) {
    res.status(500).json({ ok: false, error: err?.message || 'Error registrando fallo de miniatura.' });
  }
});

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
    const pending4kSet = new Set<number>();

    if (resolvedRoot) {
      rememberWatchedStage6Folder(resolvedRoot, docTitle);
      const clipsDir = path.join(resolvedRoot, '05_Clips_Video');
      if (!fs.existsSync(clipsDir)) {
        try {
          fs.mkdirSync(clipsDir, { recursive: true });
        } catch {}
      }

      // Move any loose stable clip videos dropped in the project root into 05_Clips_Video first
      try {
        for (const rootEntry of fs.readdirSync(resolvedRoot)) {
          if (
            isTransientStagingEntry(rootEntry) ||
            /^Documental_|_Master|_Final/i.test(rootEntry)
          ) {
            continue;
          }
          if (
            /^(?:(?:clip|broll|b[\-_]?roll|video|scene|escena)[_\-\s.]*)?0*\d+[_\-\s.(].*\.(mp4|webm|mov)$/i.test(
              rootEntry
            )
          ) {
            const srcLoose = path.join(resolvedRoot, rootEntry);
            const looseSt = fs.statSync(srcLoose);
            if (looseSt.isFile() && Date.now() - looseSt.mtimeMs >= 1500) {
              fs.renameSync(srcLoose, path.join(clipsDir, rootEntry));
            }
          }
        }
      } catch {}

      const hydratedMeta = resolveDocPipelineContext(resolvedRoot, '', docTitle);
      const brollClipNumsSet = new Set<number>();
      for (const c of hydratedMeta.clips) {
        const cNum = Number(c?.clipNumber);
        if (!cNum) continue;
        const parsed = parseServerBrollMotionFromText(`${c.imagePrompt || ''} ${c.videoPrompt || ''}`);
        if (c.isStaticBroll || parsed.isStaticBroll) {
          brollClipNumsSet.add(cNum);
        }
      }

      // Fast non-blocking scan: inspect if any raw clip, B-Roll image, or ZIP needs background 4K processing
      let needsBackground4k = false;
      const verified4kClipsInDir = new Set<number>();
      const pendingBrollImageClips = new Set<number>();
      const rawNon4kMtimes = new Map<number, number>();
      if (fs.existsSync(clipsDir) && fs.statSync(clipsDir).isDirectory()) {
        try {
          const allDirEntries = fs.readdirSync(clipsDir);
          const dirNameSet = new Set(allDirEntries);
          for (const entry of allDirEntries) {
            if (
              isTransientStagingEntry(entry) ||
              dirNameSet.has(`${entry}.crdownload`) ||
              dirNameSet.has(`${entry}.part`)
            ) {
              continue;
            }
            const full = path.join(clipsDir, entry);
            let st: fs.Stats;
            try {
              st = fs.statSync(full);
            } catch {
              continue;
            }
            if (!st.isFile()) continue;
            if (typeof (st as any).blocks === 'number' && (st as any).blocks === 0 && st.size > 0) {
              continue;
            }

            if (/\.zip$/i.test(entry)) {
              needsBackground4k = true;
              continue;
            }

            if (isEligibleBrollImageEntry(entry)) {
              const explicitBrollNum = parseExplicitBrollClipNumFromImageName(entry);
              const inferredBrollNum =
                explicitBrollNum > 0
                  ? explicitBrollNum
                  : inferClipNumberFromFileName(entry, hydratedMeta.clips);
              if (
                inferredBrollNum > 0 &&
                (explicitBrollNum > 0 || brollClipNumsSet.has(inferredBrollNum))
              ) {
                brollClipNumsSet.add(inferredBrollNum);
                pendingBrollImageClips.add(inferredBrollNum);
                needsBackground4k = true;
                pending4kSet.add(inferredBrollNum);
              }
            }

            const mVid = entry.match(
              /^(?:(?:clip|broll|b[\-_]?roll|video|scene|escena)[_\-\s.]*)?0*(\d+)[_\-\s.(].*\.(mp4|webm|mov)$/i
            );
            if (mVid) {
              const cNum = parseInt(mVid[1], 10);
              if (cNum <= 0) continue;
              const isReal4k = isVerified4kClipOnDisk(entry, st.size, full, st.mtimeMs);
              if (isReal4k) {
                verified4kClipsInDir.add(cNum);
              } else if (st.size > 10000) {
                needsBackground4k = true;
                pending4kSet.add(cNum);
                const prevRaw = rawNon4kMtimes.get(cNum) || 0;
                if (st.mtimeMs > prevRaw) rawNon4kMtimes.set(cNum, st.mtimeMs);
              }
            }
          }
        } catch {}
      }
      // Also detect root-level ZIPs or B-Roll images not yet moved into 05_Clips_Video
      if (!needsBackground4k) {
        try {
          for (const rootEntry of fs.readdirSync(resolvedRoot)) {
            if (isTransientStagingEntry(rootEntry) || /^Documental_|_Master|_Final/i.test(rootEntry)) continue;
            if (/\.zip$/i.test(rootEntry)) {
              needsBackground4k = true;
              break;
            }
            if (isEligibleBrollImageEntry(rootEntry)) {
              const explicitBrollNum = parseExplicitBrollClipNumFromImageName(rootEntry);
              const inferred =
                explicitBrollNum > 0
                  ? explicitBrollNum
                  : inferClipNumberFromFileName(rootEntry, hydratedMeta.clips);
              if (inferred > 0 && (explicitBrollNum > 0 || brollClipNumsSet.has(inferred))) {
                brollClipNumsSet.add(inferred);
                pendingBrollImageClips.add(inferred);
                needsBackground4k = true;
                pending4kSet.add(inferred);
              }
            }
          }
        } catch {}
      }

      if (needsBackground4k) {
        triggerAutonomousClips4kForFolder(resolvedRoot, docTitle, 'list_media');
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
          if (isTransientStagingEntry(entry)) {
            continue;
          }
          const full = path.join(dir, entry);
          let st: fs.Stats;
          try {
            st = fs.statSync(full);
          } catch {
            continue;
          }
          if (!st.isFile()) continue;
          const mVid = entry.match(
            /^(?:(?:clip|broll|b[\-_]?roll|video|scene|escena)[_\-\s.]*)?0*(\d+)[_\-\s.(].*\.(mp4|webm|mov)$/i
          );
          if (mVid) {
            const num = parseInt(mVid[1], 10);
            if (num > 0 && !seenVideoClips.has(num)) {
              const isReal4k = isVerified4kClipOnDisk(entry, st.size, full, st.mtimeMs);
              seenVideoClips.add(num);
              if (!isReal4k) {
                pending4kSet.add(num);
              } else if (!pendingBrollImageClips.has(num)) {
                pending4kSet.delete(num);
              }
              clipVideos.push({
                clipNumber: num,
                fileName: entry,
                url: `/api/flow/serve-folder-file?filePath=${encodeURIComponent(full)}&v=${Math.floor(st.mtimeMs)}`,
              });
            }
          }
          const mFrameImg =
            entry.match(/^0*(\d+)_Imagen_Inicial_.*\.(png|jpg|jpeg|webp)$/i) ||
            entry.match(/^(?:inicial|initial)[_\-\s.]*0*(\d+)[_\-\s.(].*\.(png|jpg|jpeg|webp)$/i);
          if (mFrameImg) {
            const num = parseInt(mFrameImg[1], 10);
            if (num > 0) {
              clipFrames.push({
                clipNumber: num,
                fileName: entry,
                url: `/api/flow/serve-folder-file?filePath=${encodeURIComponent(full)}&v=${Math.floor(st.mtimeMs)}`,
              });
            }
          } else {
            const mLooseImg = entry.match(
              /^(?:(?:broll|b[\-_]?roll|image|imagen|clip)[_\-\s.]*)?0*(\d+)[_\-\s.(].*\.(png|jpg|jpeg|webp)$/i
            );
            if (mLooseImg) {
              const num = parseInt(mLooseImg[1], 10);
              const isPendingBrollSrc =
                num > 0 && brollClipNumsSet.has(num) && isEligibleBrollImageEntry(entry);
              if (num > 0 && !isPendingBrollSrc) {
                clipFrames.push({
                  clipNumber: num,
                  fileName: entry,
                  url: `/api/flow/serve-folder-file?filePath=${encodeURIComponent(full)}&v=${Math.floor(st.mtimeMs)}`,
                });
              }
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

    const clipPrompts: Record<
      number,
      {
        imagePrompt?: string;
        videoPrompt?: string;
        isStaticBroll?: boolean;
        brollCameraMotion?: string;
      }
    > = {};
    if (resolvedRoot) {
      const promptsTxtPath = path.join(resolvedRoot, '01_Guion_y_SEO', 'Prompts_Clips_Flow.txt');
      if (fs.existsSync(promptsTxtPath)) {
        try {
          const txt = fs.readFileSync(promptsTxtPath, 'utf8');
          for (const rawLine of txt.split(/\r?\n/)) {
            const line = rawLine.trim();
            const mImg = line.match(/^(?:Image|Imagen)\s+0*(\d+)(?:\s*\([^)]*\))?\s*:\s*(.+)$/i);
            if (mImg) {
              const num = parseInt(mImg[1], 10);
              if (num > 0) {
                const parsedBroll = parseServerBrollMotionFromText(line);
                clipPrompts[num] = {
                  ...(clipPrompts[num] || {}),
                  imagePrompt: line,
                  ...(parsedBroll.isStaticBroll
                    ? {
                        isStaticBroll: true,
                        brollCameraMotion: parsedBroll.brollCameraMotion || 'zoom_in',
                      }
                    : {}),
                };
              }
              continue;
            }
            const mClip = line.match(/^Clip\s+0*(\d+)(?:\s*\([^)]*\))?\s*:\s*(.+)$/i);
            if (mClip) {
              const num = parseInt(mClip[1], 10);
              if (num > 0) {
                clipPrompts[num] = { ...(clipPrompts[num] || {}), videoPrompt: line };
              }
            }
          }
        } catch {}
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
      clipPrompts,
      pending4kClipNumbers: Array.from(pending4kSet).sort((a, b) => a - b),
      pipelineStatus: activeClipsPipelineStatus,
      icloudTccPending: !icloudDriveVerifiedReady && (icloudDriveProbeInFlight || icloudLastProbeFailed),
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
      pending4kClipNumbers: [],
      pipelineStatus: activeClipsPipelineStatus,
    });
  }
});

app.post('/api/flow/sync-reference-downloads', async (req, res) => {
  try {
    const { execFileSync } = await import('child_process');
    const {
      folderPath = '',
      folderName = '',
      docTitle = '',
      references = [],
      promptsTxtContent = '',
    } = req.body || {};

    let resolvedRoot = resolveLocalDocumentaryFolder(
      String(folderPath || ''),
      String(folderName || ''),
      String(docTitle || '')
    );

    const homeDir = process.env.HOME || process.env.USERPROFILE || '';
    if (!resolvedRoot && homeDir) {
      const icloudVideosDir = path.join(
        homeDir,
        'Library',
        'Mobile Documents',
        'com~apple~CloudDocs',
        '0YouTube',
        'Huellas de la Humanidad',
        'Videos'
      );
      const rawCandidate = String(folderName || docTitle || '').trim();
      const safeDirName = rawCandidate
        .replace(/[\/\\:*?"<>|]/g, '-')
        .replace(/\s+/g, ' ')
        .trim();
      if (
        safeDirName &&
        /^video\s*\d+\b/i.test(safeDirName) &&
        icloudDriveVerifiedReady &&
        fs.existsSync(icloudVideosDir) &&
        fs.statSync(icloudVideosDir).isDirectory()
      ) {
        resolvedRoot = path.join(icloudVideosDir, safeDirName);
        ensureDocumentarySubfolders(resolvedRoot);
      }
    }

    if (!resolvedRoot) {
      res.json({
        ok: true,
        resolvedRoot: '',
        refsDir: '',
        matchedReferences: [],
        movedCount: 0,
        movedFiles: [],
      });
      return;
    }

    ensureDocumentarySubfolders(resolvedRoot);
    const refsDir = path.join(resolvedRoot, '04_Referencias');
    if (!fs.existsSync(refsDir)) {
      fs.mkdirSync(refsDir, { recursive: true });
    }

    if (typeof promptsTxtContent === 'string' && promptsTxtContent.trim()) {
      const promptsPath = path.join(refsDir, 'Prompts_Referencias.txt');
      let existingTxt = '';
      try {
        if (fs.existsSync(promptsPath)) {
          existingTxt = fs.readFileSync(promptsPath, 'utf8');
        }
      } catch {}
      if (existingTxt !== promptsTxtContent) {
        fs.writeFileSync(promptsPath, promptsTxtContent, 'utf8');
      }
    }

    const STOPWORDS = new Set([
      'de',
      'del',
      'la',
      'las',
      'el',
      'los',
      'en',
      'al',
      'por',
      'con',
      'the',
      'of',
      'in',
      'and',
      'for',
      'with',
      'image',
      'imagen',
      'ref',
      'referencia',
      'view',
      'views',
      'sheet',
      'character',
      'location',
      'create',
      '4k',
      '2k',
      '1k',
      'hd',
      'png',
      'jpg',
      'jpeg',
      'webp',
    ]);

    const extractMeaningfulTokens = (text: string): string[] => {
      return text
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .toLowerCase()
        .split(/[^a-z0-9]+/)
        .filter((w) => w.length >= 3 && !STOPWORDS.has(w) && !/^\d+$/.test(w));
    };

    interface RefMatcher {
      id: string;
      rawTag: string;
      canonicalTag: string;
      cleanBase: string;
      asciiSlug: string;
      mangledSlug: string;
      tokens: string[];
    }

    const rawRefsList = Array.isArray(references) ? references : [];
    const refMatchers: RefMatcher[] = rawRefsList
      .map((r: any, idx: number) => {
        const rawSource = String(r?.tag || r?.description || '').trim();
        if (!rawSource) return null;
        const strippedHeader = rawSource
          .replace(/^(?:Image|Imagen)\s+/i, '')
          .replace(/^@+/, '')
          .replace(/^(?:Ref_Image_|Ref_|Referencia_)+/i, '')
          .trim();
        const cleanBase =
          strippedHeader
            .normalize('NFD')
            .replace(/[\u0300-\u036f]/g, '')
            .replace(/[^A-Za-z0-9]+/g, '_')
            .replace(/^_+|_+$/g, '') || `Referencia_${idx + 1}`;
        const asciiSlug = cleanBase.toLowerCase();
        const mangledSlug = strippedHeader
          .toLowerCase()
          .replace(/[^a-z0-9]+/g, '_')
          .replace(/^_+|_+$/g, '');
        const tokens = Array.from(
          new Set([
            ...extractMeaningfulTokens(strippedHeader),
            ...extractMeaningfulTokens(String(r?.description || '')),
          ])
        );
        return {
          id: String(r?.id || `ref-${idx + 1}`),
          rawTag: String(r?.tag || `@${cleanBase}`),
          canonicalTag: `@${cleanBase}`,
          cleanBase,
          asciiSlug,
          mangledSlug,
          tokens,
        };
      })
      .filter(Boolean) as RefMatcher[];

    if (refMatchers.length === 0) {
      res.json({
        ok: true,
        resolvedRoot,
        refsDir,
        matchedReferences: [],
        movedCount: 0,
        movedFiles: [],
      });
      return;
    }

    const normalizeCandidateFile = (fileName: string) => {
      const baseName = path.basename(fileName);
      const ext = path.extname(baseName);
      const withoutExt = path.basename(baseName, ext);
      // Exclude numbered clip keyframes, thumbnails, logos, or generic browser downloads
      const isExcluded =
        /^(?:(?:image|imagen|clip|scene|escena)[_\-\s.]*)?0*\d+[_\-\s.(]/i.test(withoutExt) ||
        /^(?:miniatura|logo|thumbnail|intro|outro|img_\d+|image|download|untitled|captura|screenshot)\b/i.test(
          withoutExt
        );

      const stripped = withoutExt
        .replace(/\s*\(\d+\)\s*$/g, '')
        .replace(/[_\-\s]*(?:4k|2k|1k|hd)?[_\-\s]*20\d{12,14}$/i, '')
        .replace(/[_\-\s]*(?:4k|2k|1k|hd)$/i, '')
        .replace(/^@+/, '')
        .replace(/^(?:ref_image_|ref_|referencia_|image_@?|imagen_@?)+/i, '')
        .trim();

      const asciiSlug = stripped
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '_')
        .replace(/^_+|_+$/g, '');

      const rawAsciiSlug = stripped
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '_')
        .replace(/^_+|_+$/g, '');

      const tokens = extractMeaningfulTokens(stripped);
      return { isExcluded, ext: ext.toLowerCase(), asciiSlug, rawAsciiSlug, tokens };
    };

    const matchFileToRef = (fileName: string): RefMatcher | null => {
      const cand = normalizeCandidateFile(fileName);
      if (cand.isExcluded || !cand.asciiSlug) return null;

      // Pass 1: Exact or clean prefix/suffix slug match
      for (const rm of refMatchers) {
        if (
          cand.asciiSlug === rm.asciiSlug ||
          (rm.mangledSlug && cand.rawAsciiSlug === rm.mangledSlug) ||
          (rm.asciiSlug.length >= 6 &&
            (cand.asciiSlug.startsWith(`${rm.asciiSlug}_`) ||
              cand.asciiSlug.endsWith(`_${rm.asciiSlug}`))) ||
          (rm.mangledSlug.length >= 6 &&
            (cand.rawAsciiSlug.startsWith(`${rm.mangledSlug}_`) ||
              cand.rawAsciiSlug.endsWith(`_${rm.mangledSlug}`)))
        ) {
          return rm;
        }
      }

      // Pass 2: Meaningful token subset match (handles Flow shortened or prompt-extended names without false positives)
      if (cand.tokens.length === 0) return null;
      let bestRef: RefMatcher | null = null;
      let bestScore = 0;
      let tied = false;

      for (const rm of refMatchers) {
        if (rm.tokens.length === 0) continue;
        const rmSet = new Set(rm.tokens);
        const candSet = new Set(cand.tokens);
        let overlap = 0;
        for (const t of candSet) {
          if (rmSet.has(t)) overlap++;
        }
        if (overlap === 0) continue;

        const allCandInRef = overlap === candSet.size && (overlap >= 2 || (overlap === 1 && rmSet.size === 1 && cand.tokens[0].length >= 5));
        const allRefInCand = overlap === rmSet.size && (overlap >= 2 || (overlap === 1 && rm.tokens[0].length >= 6));

        if (allCandInRef || allRefInCand) {
          if (overlap > bestScore) {
            bestScore = overlap;
            bestRef = rm;
            tied = false;
          } else if (overlap === bestScore && bestRef && bestRef.id !== rm.id) {
            tied = true;
          }
        }
      }

      return !tied && bestRef ? bestRef : null;
    };

    const movedFiles: string[] = [];
    const moveMatchedImageIntoRefsDir = (srcFullPath: string, matchedRef: RefMatcher): string => {
      const ext = (path.extname(srcFullPath) || '.png').toLowerCase();
      const destFileName = `@${matchedRef.cleanBase}${ext}`;
      const destFullPath = path.join(refsDir, destFileName);

      if (path.resolve(srcFullPath) === path.resolve(destFullPath)) {
        return destFullPath;
      }

      // Remove any older image file in refsDir that previously belonged to this exact reference
      for (const existing of fs.readdirSync(refsDir)) {
        if (existing.startsWith('.') || !/\.(png|jpg|jpeg|webp)$/i.test(existing)) continue;
        const existingPath = path.join(refsDir, existing);
        if (path.resolve(existingPath) === path.resolve(destFullPath)) continue;
        const prevMatch = matchFileToRef(existing);
        if (prevMatch && prevMatch.id === matchedRef.id) {
          try {
            fs.unlinkSync(existingPath);
          } catch {}
        }
      }

      fs.copyFileSync(srcFullPath, destFullPath);
      if (fs.existsSync(destFullPath) && fs.statSync(destFullPath).size > 0) {
        try {
          execSync(`chflags nohidden "${destFullPath.replace(/"/g, '\\"')}"`, { stdio: 'ignore' });
        } catch {}
        try {
          fs.unlinkSync(srcFullPath);
        } catch {}
        movedFiles.push(destFileName);
      }
      return destFullPath;
    };

    const downloadsDir = getVerifiedDownloadsDir(true);
    const nowMs = Date.now();
    const MAX_DOWNLOAD_AGE_MS = 48 * 3600 * 1000;

    // 1. Inspect .zip archives in 04_Referencias, documentary root, and recent ~/Downloads
    const zipSearchDirs = [
      { dir: refsDir, isDownloads: false },
      { dir: resolvedRoot, isDownloads: false },
      ...(downloadsDir && fs.existsSync(downloadsDir) ? [{ dir: downloadsDir, isDownloads: true }] : []),
    ];

    for (const { dir, isDownloads } of zipSearchDirs) {
      if (!fs.existsSync(dir) || !fs.statSync(dir).isDirectory()) continue;
      for (const entry of fs.readdirSync(dir)) {
        if (entry.startsWith('.') || !/\.zip$/i.test(entry)) continue;
        const zipFull = path.join(dir, entry);
        let st: fs.Stats;
        try {
          st = fs.statSync(zipFull);
        } catch {
          continue;
        }
        if (!st.isFile() || st.size < 100) continue;
        if (isDownloads && (nowMs - st.mtimeMs > MAX_DOWNLOAD_AGE_MS || nowMs - st.mtimeMs < 800)) {
          continue;
        }

        let zipEntries: string[] = [];
        try {
          const out = execFileSync('unzip', ['-Z1', zipFull], {
            encoding: 'utf8',
            maxBuffer: 4 * 1024 * 1024,
          });
          zipEntries = out
            .split(/\r?\n/)
            .map((l) => l.trim())
            .filter((l) => l && !l.endsWith('/') && !l.startsWith('__MACOSX/') && !path.basename(l).startsWith('.'));
        } catch {
          continue;
        }

        if (zipEntries.length === 0) continue;
        const matchedZipEntries = zipEntries.filter(
          (ze) => /\.(png|jpg|jpeg|webp)$/i.test(ze) && Boolean(matchFileToRef(path.basename(ze)))
        );
        if (matchedZipEntries.length === 0) continue;

        const tmpExtractDir = path.join(
          os.tmpdir(),
          `huellas_refs_zip_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`
        );
        try {
          fs.mkdirSync(tmpExtractDir, { recursive: true });
          execFileSync('unzip', ['-o', '-q', zipFull, '-d', tmpExtractDir]);
          const walkAndMove = (walkDir: string) => {
            for (const item of fs.readdirSync(walkDir)) {
              if (item === '__MACOSX' || item.startsWith('.')) continue;
              const fullItem = path.join(walkDir, item);
              const itemStat = fs.statSync(fullItem);
              if (itemStat.isDirectory()) {
                walkAndMove(fullItem);
              } else if (/\.(png|jpg|jpeg|webp)$/i.test(item)) {
                const mr = matchFileToRef(item);
                if (mr) {
                  moveMatchedImageIntoRefsDir(fullItem, mr);
                }
              }
            }
          };
          walkAndMove(tmpExtractDir);

          // Delete .zip from Downloads only if every real file in the .zip was a matched reference image
          if (!isDownloads || matchedZipEntries.length === zipEntries.length) {
            try {
              fs.unlinkSync(zipFull);
            } catch {}
          }
        } catch (zipErr) {
          console.warn('[Sync Reference Downloads] Error extracting zip:', zipErr);
        } finally {
          try {
            fs.rmSync(tmpExtractDir, { recursive: true, force: true });
          } catch {}
        }
      }
    }

    // 2. Inspect loose reference images in documentary root and recent ~/Downloads
    const looseSearchDirs = [
      { dir: resolvedRoot, isDownloads: false },
      ...(downloadsDir && fs.existsSync(downloadsDir) ? [{ dir: downloadsDir, isDownloads: true }] : []),
    ];

    for (const { dir, isDownloads } of looseSearchDirs) {
      if (!fs.existsSync(dir) || !fs.statSync(dir).isDirectory()) continue;
      const entries = fs.readdirSync(dir).sort((a, b) => {
        try {
          return fs.statSync(path.join(dir, b)).mtimeMs - fs.statSync(path.join(dir, a)).mtimeMs;
        } catch {
          return 0;
        }
      });

      for (const entry of entries) {
        if (entry.startsWith('.') || !/\.(png|jpg|jpeg|webp)$/i.test(entry)) continue;
        const fullEntry = path.join(dir, entry);
        let st: fs.Stats;
        try {
          st = fs.statSync(fullEntry);
        } catch {
          continue;
        }
        if (!st.isFile() || st.size < 1024) continue;
        if (isDownloads && (nowMs - st.mtimeMs > MAX_DOWNLOAD_AGE_MS || nowMs - st.mtimeMs < 800)) {
          continue;
        }

        const matchedRef = matchFileToRef(entry);
        if (matchedRef) {
          moveMatchedImageIntoRefsDir(fullEntry, matchedRef);
        }
      }
    }

    // 3. Collect all matched reference images currently inside 04_Referencias
    const bestFileByRefId = new Map<
      string,
      { id: string; tag: string; canonicalTag: string; fileName: string; url: string; mtimeMs: number }
    >();
    if (fs.existsSync(refsDir) && fs.statSync(refsDir).isDirectory()) {
      for (const entry of fs.readdirSync(refsDir)) {
        if (entry.startsWith('.') || !/\.(png|jpg|jpeg|webp)$/i.test(entry)) continue;
        const fullEntry = path.join(refsDir, entry);
        let st: fs.Stats;
        try {
          st = fs.statSync(fullEntry);
        } catch {
          continue;
        }
        if (!st.isFile() || st.size < 512) continue;
        const matchedRef = matchFileToRef(entry);
        if (!matchedRef) continue;
        const prev = bestFileByRefId.get(matchedRef.id);
        if (!prev || st.mtimeMs >= prev.mtimeMs) {
          bestFileByRefId.set(matchedRef.id, {
            id: matchedRef.id,
            tag: matchedRef.rawTag,
            canonicalTag: matchedRef.canonicalTag,
            fileName: entry,
            url: `/api/flow/serve-folder-file?filePath=${encodeURIComponent(fullEntry)}&v=${Math.floor(st.mtimeMs)}`,
            mtimeMs: st.mtimeMs,
          });
        }
      }
    }

    res.json({
      ok: true,
      resolvedRoot,
      refsDir,
      movedCount: movedFiles.length,
      movedFiles,
      matchedReferences: Array.from(bestFileByRefId.values()).map(({ mtimeMs: _m, ...rest }) => rest),
    });
  } catch (err: any) {
    console.warn('[Sync Reference Downloads Error]:', err);
    res.json({
      ok: false,
      error: err?.message || 'Error sincronizando referencias descargadas.',
      matchedReferences: [],
      movedCount: 0,
      movedFiles: [],
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
    // Redirect legacy destructive _foley_only.mp4 or _foley_v2.mp4 (FFT warble) requests to _foley_v3.mp4 or the pristine source MP4
    if (/_foley_(?:only|v2)\.mp4$/i.test(filePath)) {
      const v3Candidate = filePath.replace(/_foley_(?:only|v2)\.mp4$/i, '_foley_v3.mp4');
      if (fs.existsSync(v3Candidate) && fs.statSync(v3Candidate).isFile()) {
        filePath = v3Candidate;
      } else if (filePath.includes('.foley_only_cache')) {
        const parentDir = path.dirname(path.dirname(filePath));
        const origName = path.basename(filePath).replace(/_foley_(?:only|v2)\.mp4$/i, '.mp4');
        const origCandidate = path.join(parentDir, origName);
        if (fs.existsSync(origCandidate) && fs.statSync(origCandidate).isFile()) {
          filePath = origCandidate;
        }
      } else {
        const unSuffixed = filePath.replace(/_foley_(?:only|v2)\.mp4$/i, '.mp4');
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
      // Fallback: if non-4K clip path was requested after upgrading to _4K.mp4 or _Broll_4K.mp4, redirect safely via 302
      const ext = path.extname(filePath);
      const baseNoExt = path
        .basename(filePath, ext)
        .replace(/[_\-](?:(?:broll|1080p|720p|2k|hd)[_\-])?4k$/i, '')
        .replace(/[_\-](?:1080p|720p|2k|hd)$/i, '');
      const dir = path.dirname(filePath);
      const candidate4k = path.join(dir, `${baseNoExt}_4K${ext}`);
      const candidateBroll4k = path.join(dir, `${baseNoExt}_Broll_4K${ext}`);
      let matched4kFull = '';
      if (fs.existsSync(candidate4k) && fs.statSync(candidate4k).isFile()) {
        matched4kFull = candidate4k;
      } else if (fs.existsSync(candidateBroll4k) && fs.statSync(candidateBroll4k).isFile()) {
        matched4kFull = candidateBroll4k;
      } else if (/^\.(?:mp4|mov|webm)$/i.test(ext) && fs.existsSync(dir)) {
        const mNum = path
          .basename(filePath)
          .match(/^(?:(?:clip|broll|b[\-_]?roll|video|scene|escena)[_\-\s.]*)?0*(\d+)[_\-\s.(]/i);
        if (mNum) {
          const clipNum = parseInt(mNum[1], 10);
          const re4k = new RegExp(`^0*${clipNum}_.*(?:_Broll)?_4K\\.(?:mp4|mov|webm)$`, 'i');
          for (const dEntry of fs.readdirSync(dir)) {
            if (!isTransientStagingEntry(dEntry) && re4k.test(dEntry)) {
              const cand = path.join(dir, dEntry);
              if (fs.existsSync(cand) && fs.statSync(cand).isFile()) {
                matched4kFull = cand;
                break;
              }
            }
          }
        }
      }
      if (matched4kFull) {
        const st4k = fs.statSync(matched4kFull);
        res.setHeader('Cache-Control', 'no-store');
        res.redirect(
          302,
          `/api/flow/serve-folder-file?filePath=${encodeURIComponent(matched4kFull)}&v=${Math.floor(st4k.mtimeMs)}`
        );
        return;
      } else if (/^\.(?:wav|mp3|m4a)$/i.test(ext)) {
        const altExt = ext.toLowerCase() === '.wav' ? '.mp3' : '.wav';
        const altAudioCandidate = path.join(dir, `${path.basename(filePath, ext)}${altExt}`);
        if (fs.existsSync(altAudioCandidate) && fs.statSync(altAudioCandidate).isFile()) {
          filePath = altAudioCandidate;
        } else {
          res.status(404).send('Archivo no encontrado');
          return;
        }
      } else {
        res.status(404).send('Archivo no encontrado');
        return;
      }
    }
    // Allow browser to cache final 4K MP4 range chunks in memory; never cache transient non-4K clips
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
    const isTransientRawVideo =
      /\.(?:mp4|webm|mov)$/i.test(resolvedFilePath) &&
      !/[_\-]4k\.(?:mp4|webm|mov)$/i.test(resolvedFilePath) &&
      !/(?:_WebPreview|_foley_v\d+|Intro|Outro)\.mp4$/i.test(resolvedFilePath);
    res.setHeader('Cache-Control', isTransientRawVideo ? 'no-store' : 'private, max-age=3600');
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
  targetFolder?: string;
  triggerSource?: string;
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
  targetFolder: '',
  triggerSource: '',
  message: '',
  extractedZipsCount: 0,
  importedFilesCount: 0,
  upscaled4kCount: 0,
  already4kCount: 0,
};

const watchedStage6DocFolders = new Map<string, { docTitle: string; lastSeenAt: number }>();

function rememberWatchedStage6Folder(resolvedRoot: string, docTitle: string = '') {
  if (!resolvedRoot) return;
  watchedStage6DocFolders.set(path.resolve(resolvedRoot), {
    docTitle: String(docTitle || path.basename(resolvedRoot) || '').trim(),
    lastSeenAt: Date.now(),
  });
}

function findMatchingDocForPipeline(
  docs: any[],
  resolvedRoot: string,
  docId?: string,
  docTitle?: string
): number {
  if (!Array.isArray(docs) || docs.length === 0) return -1;
  if (docId) {
    const byId = docs.findIndex((d) => d && d.id === docId);
    if (byId !== -1) return byId;
  }
  const normalizedRoot = resolvedRoot ? path.resolve(resolvedRoot) : '';
  const folderLeaf = resolvedRoot ? path.basename(resolvedRoot).trim().toLowerCase() : '';
  if (normalizedRoot) {
    const byResolved = docs.findIndex((d) => {
      if (!d) return false;
      const cand = resolveLocalDocumentaryFolder(
        d.downloadFolderPath || '',
        d.downloadFolderName || '',
        `${d.title || ''} ${d.topic || ''}`.trim()
      );
      return Boolean(cand && path.resolve(cand) === normalizedRoot);
    });
    if (byResolved !== -1) return byResolved;
  }
  const combinedHint = `${docTitle || ''} ${folderLeaf}`.trim();
  const numMatch = combinedHint.match(/\b(?:video|ep\.?|episodio|documental)\s*0*(\d+)\b/i);
  if (numMatch) {
    const numRx = new RegExp(`\\b(?:video|ep\\.?|episodio|documental)\\s*0*${numMatch[1]}\\b`, 'i');
    const byNum = docs.findIndex(
      (d) => d && (numRx.test(d.title || '') || numRx.test(d.downloadFolderName || ''))
    );
    if (byNum !== -1) return byNum;
  }
  if (folderLeaf) {
    const byName = docs.findIndex(
      (d) =>
        d &&
        ((d.downloadFolderName || '').trim().toLowerCase() === folderLeaf ||
          (d.title || '').trim().toLowerCase() === folderLeaf)
    );
    if (byName !== -1) return byName;
  }
  return -1;
}

function resolveDocPipelineContext(
  resolvedRoot: string,
  docId?: string,
  docTitle?: string
): { doc: any | null; aspectRatio: string; clips: any[] } {
  try {
    const docs = readDocumentaries();
    const idx = findMatchingDocForPipeline(docs, resolvedRoot, docId, docTitle);
    if (idx === -1) return { doc: null, aspectRatio: '16:9', clips: [] };
    const doc = docs[idx];
    const isVertical =
      doc?.productionType === 'REEL_9X16' || doc?.promptConfig?.SUB_OPCION_REELS === '9X16';
    const aspectRatio = isVertical ? '9:16' : '16:9';
    const clip1Sec = Math.max(2, Math.min(30, parseInt(String(doc?.promptConfig?.DURACION_CLIP_1 || '6'), 10) || 6));
    const stdSec = Math.max(
      2,
      Math.min(
        30,
        parseInt(
          String(doc?.promptConfig?.DURACION_CLIPS_SEGUNDOS || doc?.promptConfig?.DURACION_CLIPS || '8'),
          10
        ) || 8
      )
    );
    const clips = Array.isArray(doc?.clips)
      ? doc.clips.map((c: any) => ({
          clipNumber: c.clipNumber,
          imagePrompt: c.imagePrompt,
          videoPrompt: c.videoPrompt,
          narrationSegment: c.narrationSegment,
          isStaticBroll: Boolean(c.isStaticBroll),
          brollCameraMotion: c.brollCameraMotion || 'zoom_in',
          durationSeconds: Number(c.clipNumber) === 1 ? clip1Sec : stdSec,
        }))
      : [];
    return { doc, aspectRatio, clips };
  } catch {
    return { doc: null, aspectRatio: '16:9', clips: [] };
  }
}

function syncUpscaledClipsToDocumentariesJson(
  resolvedRoot: string,
  updates: Array<{ clipNumber: number; fileName: string }>,
  opts: { docId?: string; docTitle?: string; skipCloudPush?: boolean } = {}
) {
  if (!resolvedRoot || !Array.isArray(updates) || updates.length === 0) return;
  try {
    const docs = readDocumentaries();
    const idx = findMatchingDocForPipeline(docs, resolvedRoot, opts.docId, opts.docTitle);
    if (idx === -1) return;
    const targetDoc = docs[idx];
    if (!Array.isArray(targetDoc?.clips) || targetDoc.clips.length === 0) return;

    const byNum = new Map<number, string>();
    for (const u of updates) {
      if (u.clipNumber > 0 && u.fileName) {
        byNum.set(u.clipNumber, u.fileName);
      }
    }
    if (byNum.size === 0) return;

    let changed = false;
    const nextClips = targetDoc.clips.map((c: any) => {
      const fName = byNum.get(Number(c.clipNumber));
      if (fName && (c.videoSavedFileName !== fName || !c.videoReady || !c.imageReady)) {
        changed = true;
        return {
          ...c,
          videoSavedFileName: fName,
          videoReady: true,
          imageReady: true,
        };
      }
      return c;
    });

    if (changed) {
      docs[idx] = {
        ...targetDoc,
        clips: nextClips,
        updatedAt: new Date().toISOString(),
      };
      writeDocumentaries(docs, opts.skipCloudPush !== false);
    }
  } catch (err) {
    console.warn('[ClipsPipeline] syncUpscaledClipsToDocumentariesJson warning:', err);
  }
}

app.get('/api/flow/process-clips-status', (_req, res) => {
  res.json({
    ok: true,
    ...activeClipsPipelineStatus,
    icloudTccPending: !icloudDriveVerifiedReady && (icloudDriveProbeInFlight || icloudLastProbeFailed),
  });
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

type ServerBrollCameraMotion =
  | 'zoom_in'
  | 'zoom_out'
  | 'pan_right'
  | 'pan_left'
  | 'tilt_up'
  | 'tilt_down';

function normalizeServerBrollMotion(raw?: string | null): ServerBrollCameraMotion {
  const clean = String(raw || '')
    .trim()
    .toLowerCase()
    .replace(/^static_/, '');
  const allowed: ServerBrollCameraMotion[] = [
    'zoom_in',
    'zoom_out',
    'pan_right',
    'pan_left',
    'tilt_up',
    'tilt_down',
  ];
  return (allowed.includes(clean as ServerBrollCameraMotion)
    ? clean
    : 'zoom_in') as ServerBrollCameraMotion;
}

function parseServerBrollMotionFromText(text?: string | null): {
  isStaticBroll: boolean;
  brollCameraMotion?: ServerBrollCameraMotion;
} {
  const s = String(text || '');
  const tagMatch = s.match(/\[B-Roll\s*:\s*STATIC_([A-Z_]+)\]/i);
  if (tagMatch) {
    return {
      isStaticBroll: true,
      brollCameraMotion: normalizeServerBrollMotion(tagMatch[1]),
    };
  }
  if (/\[IMAGE\s+ONLY\s*[—–-]?\s*DO\s+NOT\s+GENERATE\s+VIDEO\s+CLIP\]/i.test(s)) {
    return { isStaticBroll: true, brollCameraMotion: 'zoom_in' };
  }
  return { isStaticBroll: false };
}

function isTransientStagingEntry(entryName: string): boolean {
  if (!entryName) return true;
  if (entryName.startsWith('.') || entryName.startsWith('__rendering_') || entryName.startsWith('__incoming_') || entryName.startsWith('~incoming_')) {
    return true;
  }
  return /\.(?:tmp|part|crdownload|download)(?:\.(?:mp4|webm|mov|jpg|jpeg|png|webp))?$/i.test(entryName);
}

function parseExplicitBrollClipNumFromImageName(entryName: string): number {
  const m = String(entryName || '').match(/^(?:broll|b[\-_]?roll)[_\-\s.]*0*(\d+)(?:[_\-\s.(]|$)/i);
  if (!m) return 0;
  const n = parseInt(m[1], 10);
  return Number.isFinite(n) && n > 0 ? n : 0;
}

function publishTempFileAtomicallyToDir(
  tmpSrcPath: string,
  destDir: string,
  finalFileName: string
): string {
  const finalDest = path.join(destDir, finalFileName);
  const stagingPath = path.join(
    destDir,
    `__rendering_${process.pid}_${Date.now()}_${Math.random().toString(36).slice(2, 6)}_${finalFileName}.part`
  );
  fs.copyFileSync(tmpSrcPath, stagingPath);
  const fd = fs.openSync(stagingPath, 'r+');
  try {
    fs.fsyncSync(fd);
  } finally {
    fs.closeSync(fd);
  }
  try {
    execSync(`chflags nohidden "${stagingPath.replace(/"/g, '\\"')}"`, { stdio: 'ignore' });
  } catch {}
  fs.renameSync(stagingPath, finalDest);
  return finalDest;
}

function isVerified4kClipOnDisk(
  fileName: string,
  sizeBytes: number,
  _fullPath?: string,
  _mtimeMs?: number
): boolean {
  if (isTransientStagingEntry(fileName)) {
    return false;
  }
  if (/_broll_4k\.(mp4|mov|webm)$/i.test(fileName)) {
    return sizeBytes >= 512 * 1024;
  }
  if (!/[_\-]4k\.(mp4|mov|webm)$/i.test(fileName) || /[_\-](?:1080p|720p|2k|hd)[_\-]4k\.(mp4|mov|webm)$/i.test(fileName)) {
    return false;
  }
  return sizeBytes >= 2 * 1024 * 1024;
}

function isEligibleBrollImageEntry(entryName: string): boolean {
  if (!/\.(png|jpg|jpeg|webp)$/i.test(entryName)) return false;
  if (isTransientStagingEntry(entryName) || entryName.startsWith('@')) return false;
  if (/^(?:Ref_|Inicial[_\-\s.]|Initial[_\-\s.])|_Imagen_Inicial_|_Broll_Source|miniatura|thumbnail/i.test(entryName)) return false;
  return true;
}

function buildBrollSixWordBaseName(clipNum: number, imagePrompt?: string, fallbackName?: string): string {
  const padded = String(clipNum).padStart(2, '0');
  const rawBody = String(imagePrompt || '')
    .replace(/^(?:Image|Imagen|Broll|B[\-_]?Roll|Inicial|Initial)[_\-\s]*\[?0*\d+\]?(?:\s*\([^)]*\))?\s*[:_\-\s]*/i, '')
    .trim();
  const words = rawBody
    .replace(/[^a-zA-Z0-9\s]+/g, ' ')
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 5);
  if (words.length >= 2) {
    return `${padded}_${words.join('_')}`;
  }
  if (fallbackName) {
    const cleaned = path
      .basename(fallbackName, path.extname(fallbackName))
      .replace(/[_\-](?:broll[_\-])?4k$/i, '')
      .replace(/[_\-](?:1080p|720p|2k|hd)$/i, '')
      .replace(/_[0-9a-f]{8}$/i, '')
      .replace(/^(?:(?:inicial|initial|broll|b[\-_]?roll|image|imagen|clip|video|scene|escena)[_\-\s.]*)?0*\d+[_\-\s.]*/i, '')
      .replace(/\s+/g, '_')
      .replace(/_+/g, '_')
      .replace(/^_|_$/g, '');
    const capped = cleaned.split('_').filter(Boolean).slice(0, 6).join('_');
    if (capped) return `${padded}_${capped}`;
  }
  return `${padded}_Create_an_image_in_16_9`;
}

function inferClipNumberFromFileName(
  fileName: string,
  clipsList: Array<{
    clipNumber: number;
    imagePrompt?: string;
    videoPrompt?: string;
    narrationSegment?: string;
  }>
): number {
  const base = path.basename(fileName, path.extname(fileName));
  // 1. Direct leading number or Inicial_XX / Broll_XX / Clip_XX / Image_XX prefix
  const mDirect = base.match(
    /^(?:(?:inicial|initial|broll|b[\-_]?roll|clip|video|image|imagen|scene|escena)[_\-\s.]*)?0*(\d+)(?:[_\-\s.(]|$)/i
  );
  if (mDirect) {
    const n = parseInt(mDirect[1], 10);
    if (n > 0 && n <= 400) return n;
  }
  // 2. Match against narrationSegment, videoPrompt, or imagePrompt words
  const fileTokens = normalizeWordTokensForMatch(
    base.replace(/[_\-]?(?:broll[_\-])?4k$/i, '')
  );
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
      const imgTokens = normalizeWordTokensForMatch(
        String(c.imagePrompt || '').replace(/^(?:Image|Imagen)\s*\d+(?:\s*\([^)]*\))?\s*:\s*/i, '')
      );
      let score = 0;
      for (let i = 0; i < Math.min(fileTokens.length, 8); i++) {
        const tok = fileTokens[i];
        if (narTokens.slice(0, 10).includes(tok)) score += 3;
        if (vidTokens.slice(0, 12).includes(tok)) score += 2;
        if (imgTokens.slice(0, 14).includes(tok)) score += 2;
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

function archiveBrollSourceImage(
  clipsDir: string,
  clipNumber: number,
  sourceImagePath: string,
  meta: { motion: ServerBrollCameraMotion; durationSec: number; aspectRatio: string; baseName: string }
): string {
  const brollSourcesDir = path.join(clipsDir, '_broll_sources');
  fs.mkdirSync(brollSourcesDir, { recursive: true });
  const padded = String(clipNumber).padStart(2, '0');
  const ext = (path.extname(sourceImagePath) || '.png').toLowerCase();
  const archivedImgPath = path.join(brollSourcesDir, `${padded}_Broll_Source${ext}`);
  if (path.resolve(sourceImagePath) !== path.resolve(archivedImgPath)) {
    // Remove any older archived source with a different extension for this clip
    for (const existing of fs.readdirSync(brollSourcesDir)) {
      if (
        existing.startsWith(`${padded}_Broll_Source.`) &&
        !/\.meta\.json$/i.test(existing) &&
        path.resolve(path.join(brollSourcesDir, existing)) !== path.resolve(archivedImgPath)
      ) {
        try {
          fs.unlinkSync(path.join(brollSourcesDir, existing));
        } catch {}
      }
    }
    fs.copyFileSync(sourceImagePath, archivedImgPath);
  }
  const metaPath = path.join(brollSourcesDir, `${padded}_Broll_Source.meta.json`);
  fs.writeFileSync(
    metaPath,
    JSON.stringify(
      {
        clipNumber,
        sourceFileName: path.basename(archivedImgPath),
        motion: meta.motion,
        durationSec: meta.durationSec,
        aspectRatio: meta.aspectRatio,
        baseName: meta.baseName,
        updatedAt: new Date().toISOString(),
      },
      null,
      2
    ),
    'utf8'
  );
  return archivedImgPath;
}

function findArchivedBrollSourceImage(
  clipsDir: string,
  clipNumber: number
): { imagePath: string; meta?: any } | null {
  const brollSourcesDir = path.join(clipsDir, '_broll_sources');
  const padded = String(clipNumber).padStart(2, '0');
  if (fs.existsSync(brollSourcesDir) && fs.statSync(brollSourcesDir).isDirectory()) {
    let meta: any = undefined;
    const metaPath = path.join(brollSourcesDir, `${padded}_Broll_Source.meta.json`);
    if (fs.existsSync(metaPath)) {
      try {
        meta = JSON.parse(fs.readFileSync(metaPath, 'utf8'));
      } catch {}
    }
    for (const entry of fs.readdirSync(brollSourcesDir)) {
      if (
        new RegExp(`^0*${clipNumber}_Broll_Source\\.(png|jpg|jpeg|webp)$`, 'i').test(entry)
      ) {
        return { imagePath: path.join(brollSourcesDir, entry), meta };
      }
    }
  }
  // Fallback: check 05_Clips_Video for `XX_Imagen_Inicial_...jpg`
  if (fs.existsSync(clipsDir) && fs.statSync(clipsDir).isDirectory()) {
    for (const entry of fs.readdirSync(clipsDir)) {
      if (
        new RegExp(`^0*${clipNumber}_Imagen_Inicial_.*\\.(png|jpg|jpeg|webp)$`, 'i').test(entry)
      ) {
        return { imagePath: path.join(clipsDir, entry) };
      }
    }
  }
  return null;
}

async function renderStaticBrollImageTo4K60OnDisk(
  inputImagePath: string,
  outputVideoPath: string,
  motionRaw: string = 'zoom_in',
  durationSecRaw: number = 8,
  aspectRatio: string = '16:9'
): Promise<void> {
  const ffmpegBin = resolveFfmpegBin();
  const motion = normalizeServerBrollMotion(motionRaw);
  const durationSec = Math.max(2, Math.min(30, Number(durationSecRaw) || 8));
  const fps = 60;
  const totalFrames = Math.max(2, Math.round(durationSec * fps));
  const isVertical = aspectRatio === '9:16';
  const preW = isVertical ? 4320 : 7680;
  const preH = isVertical ? 7680 : 4320;
  const outW = isVertical ? 2160 : 3840;
  const outH = isVertical ? 3840 : 2160;

  // Empirically verified on local FFmpeg: `on` in vf_zoompan is 0-indexed (0 .. totalFrames - 1)
  const P = `clip(on/max(1,${totalFrames - 1}),0,1)`;
  let zExpr = `'1.0+0.12*${P}'`;
  let xExpr = `'iw/2-(iw/zoom/2)'`;
  let yExpr = `'ih/2-(ih/zoom/2)'`;

  switch (motion) {
    case 'zoom_in':
      zExpr = `'1.0+0.12*${P}'`;
      xExpr = `'iw/2-(iw/zoom/2)'`;
      yExpr = `'ih/2-(ih/zoom/2)'`;
      break;
    case 'zoom_out':
      zExpr = `'1.12-0.12*${P}'`;
      xExpr = `'iw/2-(iw/zoom/2)'`;
      yExpr = `'ih/2-(ih/zoom/2)'`;
      break;
    case 'pan_right':
      zExpr = `'1.12'`;
      xExpr = `'(iw-iw/zoom)*(0.04+0.92*${P})'`;
      yExpr = `'ih/2-(ih/zoom/2)'`;
      break;
    case 'pan_left':
      zExpr = `'1.12'`;
      xExpr = `'(iw-iw/zoom)*(0.96-0.92*${P})'`;
      yExpr = `'ih/2-(ih/zoom/2)'`;
      break;
    case 'tilt_up':
      zExpr = `'1.12'`;
      xExpr = `'iw/2-(iw/zoom/2)'`;
      yExpr = `'(ih-ih/zoom)*(0.96-0.92*${P})'`;
      break;
    case 'tilt_down':
      zExpr = `'1.12'`;
      xExpr = `'iw/2-(iw/zoom/2)'`;
      yExpr = `'(ih-ih/zoom)*(0.04+0.92*${P})'`;
      break;
  }

  // Single-frame 8K Lanczos cover+crop (NO -loop 1!) -> subpixel zoompan direct to 4K 60fps
  const vfFilter = [
    `scale=${preW}:${preH}:force_original_aspect_ratio=increase:flags=lanczos`,
    `crop=${preW}:${preH}`,
    `setsar=1`,
    `format=yuv420p`,
    `zoompan=z=${zExpr}:x=${xExpr}:y=${yExpr}:d=${totalFrames}:s=${outW}x${outH}:fps=${fps}`,
    `unsharp=3:3:0.35:3:3:0.0`,
    `format=yuv420p`,
  ].join(',');

  const runFfmpegCmd = (args: string[]) =>
    new Promise<void>((resolve, reject) => {
      let settled = false;
      const proc = spawn(ffmpegBin, args, { stdio: 'ignore' });
      const killTimer = setTimeout(() => {
        if (!settled) {
          settled = true;
          try {
            proc.kill('SIGKILL');
          } catch {}
          reject(new Error('ffmpeg b-roll render timed out after 180s'));
        }
      }, 180000);
      proc.on('error', (err) => {
        if (!settled) {
          settled = true;
          clearTimeout(killTimer);
          reject(err);
        }
      });
      proc.on('close', (code) => {
        if (settled) return;
        settled = true;
        clearTimeout(killTimer);
        if (code === 0 && fs.existsSync(outputVideoPath) && fs.statSync(outputVideoPath).size > 50000) {
          resolve();
        } else {
          reject(new Error(`ffmpeg b-roll render exited with code ${code}`));
        }
      });
    });

  const durStr = durationSec.toFixed(3);
  try {
    await runFfmpegCmd([
      '-nostdin',
      '-y',
      '-threads',
      '0',
      '-i',
      inputImagePath,
      '-f',
      'lavfi',
      '-i',
      'anullsrc=channel_layout=stereo:sample_rate=48000',
      '-vf',
      vfFilter,
      '-map',
      '0:v:0',
      '-map',
      '1:a:0',
      '-c:v',
      'h264_videotoolbox',
      '-allow_sw',
      '1',
      '-b:v',
      '24M',
      '-maxrate',
      '32M',
      '-bufsize',
      '48M',
      '-profile:v',
      'high',
      '-pix_fmt',
      'yuv420p',
      '-r',
      '60',
      '-c:a',
      'aac',
      '-b:a',
      '128k',
      '-ar',
      '48000',
      '-ac',
      '2',
      '-t',
      durStr,
      '-movflags',
      '+faststart',
      outputVideoPath,
    ]);
  } catch {
    await runFfmpegCmd([
      '-nostdin',
      '-y',
      '-threads',
      '0',
      '-i',
      inputImagePath,
      '-f',
      'lavfi',
      '-i',
      'anullsrc=channel_layout=stereo:sample_rate=48000',
      '-vf',
      vfFilter,
      '-map',
      '0:v:0',
      '-map',
      '1:a:0',
      '-c:v',
      'libx264',
      '-preset',
      'veryfast',
      '-crf',
      '17',
      '-pix_fmt',
      'yuv420p',
      '-r',
      '60',
      '-c:a',
      'aac',
      '-b:a',
      '128k',
      '-ar',
      '48000',
      '-ac',
      '2',
      '-t',
      durStr,
      '-movflags',
      '+faststart',
      outputVideoPath,
    ]);
  }
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
  const vfFilter = `scale=${targetW}:${targetH}:flags=bicubic,setsar=1,unsharp=3:3:0.5:3:3:0.0,format=yuv420p`;

  const runFfmpegCmd = (args: string[]) =>
    new Promise<void>((resolve, reject) => {
      let settled = false;
      const proc = spawn(ffmpegBin, args, { stdio: 'ignore' });
      const killTimer = setTimeout(() => {
        if (!settled) {
          settled = true;
          try {
            proc.kill('SIGKILL');
          } catch {}
          reject(new Error('ffmpeg 4K upscale timed out after 180s'));
        }
      }, 180000);
      proc.on('error', (err) => {
        if (!settled) {
          settled = true;
          clearTimeout(killTimer);
          reject(err);
        }
      });
      proc.on('close', (code) => {
        if (settled) return;
        settled = true;
        clearTimeout(killTimer);
        if (code === 0 && fs.existsSync(outputPath) && fs.statSync(outputPath).size > 10000) {
          resolve();
        } else {
          reject(new Error(`ffmpeg exited with code ${code}`));
        }
      });
    });

  const primaryAudioArgs = /\.webm$/i.test(inputPath)
    ? ['-c:a', 'aac', '-b:a', '192k']
    : ['-c:a', 'copy'];

  try {
    await runFfmpegCmd([
      '-nostdin',
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
      ...primaryAudioArgs,
      outputPath,
    ]);
  } catch {
    await runFfmpegCmd([
      '-nostdin',
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
      'aac',
      '-b:a',
      '192k',
      outputPath,
    ]);
  }
}

type Clips4kPipelineTriggerSource = 'manual' | 'watcher' | 'flow_pc' | 'list_media';
interface Clips4kPipelineParams {
  folderPath?: string;
  folderName?: string;
  docTitle?: string;
  docId?: string;
  aspectRatio?: string;
  clips?: any[];
  triggerSource?: Clips4kPipelineTriggerSource;
}

let activeClipsPipelinePromise: Promise<any> | null = null;
const queuedClipsPipelinesByFolder = new Map<string, Clips4kPipelineParams>();
const flowPcPipelineDebounceByFolder = new Map<string, NodeJS.Timeout>();

function isFileStableForAutoPipeline(
  fullPath: string,
  triggerSource: Clips4kPipelineTriggerSource = 'watcher'
): boolean {
  const baseName = path.basename(fullPath);
  if (!baseName || isTransientStagingEntry(baseName)) {
    return false;
  }
  if (
    fs.existsSync(`${fullPath}.crdownload`) ||
    fs.existsSync(`${fullPath}.part`) ||
    fs.existsSync(`${fullPath}.tmp`) ||
    fs.existsSync(`${fullPath}.download`)
  ) {
    return false;
  }
  try {
    const st = fs.statSync(fullPath);
    if (!st.isFile() || st.size <= 0) return false;
    if (typeof (st as any).blocks === 'number' && (st as any).blocks === 0 && st.size > 0) {
      return false;
    }
    if (triggerSource !== 'manual' && Date.now() - st.mtimeMs < 2000) {
      return false;
    }
    return true;
  } catch {
    return false;
  }
}

async function runClips4kPipelineCore(params: Clips4kPipelineParams): Promise<any> {
  const triggerSource: Clips4kPipelineTriggerSource = params.triggerSource || 'manual';
  const requestedFolderPath = String(params.folderPath || '');
  const requestedFolderName = String(params.folderName || '');
  const requestedDocTitle = String(params.docTitle || '');
  const requestedDocId = String(params.docId || '');

  const resolvedRoot = resolveLocalDocumentaryFolder(
    requestedFolderPath,
    requestedFolderName,
    requestedDocTitle
  );
  if (!resolvedRoot || !fs.existsSync(resolvedRoot)) {
    return {
      ok: false,
      statusCode: 400,
      error:
        'No se encontró la carpeta local del proyecto. Asegúrate de tener vinculada la carpeta del documental en tu Mac.',
    };
  }

  const queueKey = path.resolve(resolvedRoot);
  if (activeClipsPipelinePromise) {
    if (triggerSource !== 'manual') {
      const prevQueued = queuedClipsPipelinesByFolder.get(queueKey);
      if (
        triggerSource === 'flow_pc' ||
        activeClipsPipelineStatus.targetFolder !== resolvedRoot
      ) {
        queuedClipsPipelinesByFolder.set(queueKey, {
          ...params,
          folderPath: resolvedRoot,
          triggerSource: prevQueued?.triggerSource === 'manual' ? 'manual' : triggerSource,
        });
      }
      return {
        ok: true,
        alreadyRunning: true,
        queued: queuedClipsPipelinesByFolder.size > 0,
        resolvedRoot,
        message: activeClipsPipelineStatus.message || 'Procesamiento 4K ya en ejecución...',
      };
    }
    while (activeClipsPipelinePromise) {
      try {
        await activeClipsPipelinePromise;
      } catch {}
    }
  }

  const runPromise = (async () => {
    try {
      ensureDocumentarySubfolders(resolvedRoot);
      const clipsDir = path.join(resolvedRoot, '05_Clips_Video');
      // Clean stale __rendering_ or __incoming_ temp files older than 10 minutes
      if (fs.existsSync(clipsDir)) {
        try {
          const nowCleanMs = Date.now();
          for (const dEntry of fs.readdirSync(clipsDir)) {
            if (/^(?:__rendering_|__incoming_|~incoming_)/.test(dEntry)) {
              const pStale = path.join(clipsDir, dEntry);
              try {
                const stStale = fs.statSync(pStale);
                if (stStale.isFile() && nowCleanMs - stStale.mtimeMs > 10 * 60 * 1000) {
                  fs.unlinkSync(pStale);
                }
              } catch {}
            }
          }
        } catch {}
      }
      const downloadsDir =
        triggerSource === 'manual' ? getVerifiedDownloadsDir(true) : getVerifiedDownloadsDir(false);

      const hydrated = resolveDocPipelineContext(resolvedRoot, requestedDocId, requestedDocTitle);
      const effectiveDocTitle = String(hydrated.doc?.title || requestedDocTitle || '');
      const effectiveDocId = String(hydrated.doc?.id || requestedDocId || '');
      rememberWatchedStage6Folder(resolvedRoot, effectiveDocTitle);

      const clipsList =
        Array.isArray(params.clips) && params.clips.length > 0 ? params.clips : hydrated.clips;
      const aspectRatio = String(params.aspectRatio || hydrated.aspectRatio || '16:9');
      const upscaledSyncUpdates: Array<{ clipNumber: number; fileName: string }> = [];

      // Build authoritative map of Static B-Roll scenes (from payload + Prompts_Clips_Flow.txt fallback)
      const brollClipMap = new Map<
        number,
        { motion: ServerBrollCameraMotion; durationSec: number; imagePrompt: string }
      >();
      for (const c of clipsList) {
        const cNum = Number(c?.clipNumber);
        if (!cNum) continue;
        const parsedFromPrompt = parseServerBrollMotionFromText(
          `${c.imagePrompt || ''} ${c.videoPrompt || ''}`
        );
        if (c.isStaticBroll || parsedFromPrompt.isStaticBroll) {
          brollClipMap.set(cNum, {
            motion: normalizeServerBrollMotion(
              c.brollCameraMotion || parsedFromPrompt.brollCameraMotion || 'zoom_in'
            ),
            durationSec: Math.max(2, Math.min(30, Number(c.durationSeconds) || (cNum === 1 ? 6 : 8))),
            imagePrompt: String(c.imagePrompt || ''),
          });
        }
      }
      const promptsTxtFallback = path.join(resolvedRoot, '01_Guion_y_SEO', 'Prompts_Clips_Flow.txt');
      if (fs.existsSync(promptsTxtFallback)) {
        try {
          const rawTxt = fs.readFileSync(promptsTxtFallback, 'utf8');
          for (const rawLine of rawTxt.split(/\r?\n/)) {
            const line = rawLine.trim();
            const mImg = line.match(/^(?:Image|Imagen)\s+0*(\d+)(?:\s*\([^)]*\))?\s*:\s*(.+)$/i);
            if (mImg) {
              const cNum = parseInt(mImg[1], 10);
              const parsed = parseServerBrollMotionFromText(line);
              if (cNum > 0 && parsed.isStaticBroll && !brollClipMap.has(cNum)) {
                const durMatch = line.match(/\[Duration\s*:\s*(\d+)s\]/i);
                brollClipMap.set(cNum, {
                  motion: parsed.brollCameraMotion || 'zoom_in',
                  durationSec: durMatch ? parseInt(durMatch[1], 10) : cNum === 1 ? 6 : 8,
                  imagePrompt: line,
                });
              }
            }
          }
        } catch {}
      }

      const ensureBrollMapForExplicitImage = (imgEntryName: string): number => {
        const explicitNum = parseExplicitBrollClipNumFromImageName(imgEntryName);
        if (explicitNum > 0 && !brollClipMap.has(explicitNum)) {
          const matchingClip = clipsList.find((c: any) => Number(c?.clipNumber) === explicitNum);
          const durSec = Math.max(
            2,
            Math.min(30, Number(matchingClip?.durationSeconds) || (explicitNum === 1 ? 6 : 8))
          );
          brollClipMap.set(explicitNum, {
            motion: normalizeServerBrollMotion(matchingClip?.brollCameraMotion || 'zoom_in'),
            durationSec: durSec,
            imagePrompt: String(matchingClip?.imagePrompt || ''),
          });
        }
        return explicitNum > 0
          ? explicitNum
          : inferClipNumberFromFileName(imgEntryName, clipsList);
      };

      activeClipsPipelineStatus = {
        running: true,
        phase: 'locating',
        current: 0,
        total: 0,
        currentFileName: '',
        targetFolder: resolvedRoot,
        triggerSource,
        message: 'Localizando clips, láminas B-Roll y verificando archivos ZIP...',
        extractedZipsCount: 0,
        importedFilesCount: 0,
        upscaled4kCount: 0,
        already4kCount: 0,
      };

      const stagedBrollImagesByClip = new Map<
        number,
        { fullPath: string; mtimeMs: number; fromDownloads?: boolean }
      >();
      const registerStagedBrollImage = (
        clipNum: number,
        imgFullPath: string,
        mtimeMs: number,
        fromDownloads = false
      ) => {
        if (!brollClipMap.has(clipNum)) return false;
        const prev = stagedBrollImagesByClip.get(clipNum);
        if (!prev || mtimeMs >= prev.mtimeMs) {
          stagedBrollImagesByClip.set(clipNum, { fullPath: imgFullPath, mtimeMs, fromDownloads });
        }
        return true;
      };

      // ------------------------------------------------------------------------
      // STEP 1: EXTRACT ANY .ZIP FILES IN 05_Clips_Video, resolvedRoot, OR ~/Downloads AND DELETE THE .ZIP
      // ------------------------------------------------------------------------
      activeClipsPipelineStatus.phase = 'unzipping';
      const zipCandidates: string[] = [];

      for (const dir of [clipsDir, resolvedRoot]) {
        if (!fs.existsSync(dir)) continue;
        for (const entry of fs.readdirSync(dir)) {
          if (isTransientStagingEntry(entry)) continue;
          if (/\.zip$/i.test(entry)) {
            const fullZip = path.join(dir, entry);
            if (isFileStableForAutoPipeline(fullZip, triggerSource)) {
              zipCandidates.push(fullZip);
            }
          }
        }
      }

      // Also check ~/Downloads for recent .zip files (last 24h) that contain clip videos OR B-Roll images from Flow
      if (downloadsDir && fs.existsSync(downloadsDir)) {
        const nowMs = Date.now();
        for (const entry of fs.readdirSync(downloadsDir)) {
          if (isTransientStagingEntry(entry) || !/\.zip$/i.test(entry)) continue;
          const fullZip = path.join(downloadsDir, entry);
          if (!isFileStableForAutoPipeline(fullZip, triggerSource)) continue;
          try {
            const st = fs.statSync(fullZip);
            if (!st.isFile() || nowMs - st.mtimeMs > 24 * 3600 * 1000) continue;
            const listOut = execSync(`unzip -l "${fullZip.replace(/"/g, '\\"')}"`, {
              encoding: 'utf8',
              timeout: 5000,
              stdio: ['ignore', 'pipe', 'ignore'],
            });
            const hasClipVideos =
              /\.(mp4|mov|webm)/i.test(listOut) &&
              (/(?:^|\s|\/)(?:0*\d+_|clip|broll|b[\-_]?roll|video|create_a_video)/i.test(listOut) ||
                /flow/i.test(entry));
            const hasBrollFlowImages =
              /\.(png|jpg|jpeg|webp)/i.test(listOut) &&
              (/(?:^|\s|\/)(?:0*\d+_|(?:broll|b[\-_]?roll|image|inicial|initial)[_\-\s.]*0*\d+|create_an_image)/i.test(
                listOut
              ) ||
                /flow/i.test(entry));
            if (hasClipVideos || hasBrollFlowImages) {
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
        const tmpZipCopy = path.join(tmpUnzipDir, '__archive.zip');
        fs.copyFileSync(zipFull, tmpZipCopy);
        execSync(`unzip -o -j "${tmpZipCopy.replace(/"/g, '\\"')}" -d "${tmpUnzipDir}"`, {
          timeout: 60000,
          stdio: 'ignore',
        });
        try {
          fs.unlinkSync(tmpZipCopy);
        } catch {}
        let importedAnyFromZip = false;
        for (const extracted of fs.readdirSync(tmpUnzipDir)) {
          if (extracted.startsWith('.') || extracted.startsWith('__MACOSX') || extracted === '__archive.zip') continue;
          const srcFile = path.join(tmpUnzipDir, extracted);
          if (/\.(mp4|mov|webm)$/i.test(extracted)) {
            publishTempFileAtomicallyToDir(srcFile, clipsDir, extracted);
            activeClipsPipelineStatus.importedFilesCount++;
            importedAnyFromZip = true;
          } else if (/^(?:inicial|initial)[_\-\s.]*0*(\d+)(?:[_\-\s.(]|$)/i.test(extracted) && /\.(png|jpg|jpeg|webp)$/i.test(extracted)) {
            publishTempFileAtomicallyToDir(srcFile, clipsDir, extracted);
            activeClipsPipelineStatus.importedFilesCount++;
            importedAnyFromZip = true;
          } else if (isEligibleBrollImageEntry(extracted)) {
            const inferredNum = ensureBrollMapForExplicitImage(extracted);
            if (inferredNum > 0 && brollClipMap.has(inferredNum)) {
              const destImg = publishTempFileAtomicallyToDir(srcFile, clipsDir, extracted);
              const imgSt = fs.statSync(destImg);
              registerStagedBrollImage(inferredNum, destImg, imgSt.mtimeMs, false);
              activeClipsPipelineStatus.importedFilesCount++;
              importedAnyFromZip = true;
            }
          }
        }
        // Delete .zip only after at least one valid project media file was extracted
        if (importedAnyFromZip) {
          fs.unlinkSync(zipFull);
          activeClipsPipelineStatus.extractedZipsCount++;
        }
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
    // STEP 2: LOCATE LOOSE CLIP VIDEOS & STATIC B-ROLL IMAGES IN resolvedRoot, 05_Clips_Video, OR ~/Downloads
    // ------------------------------------------------------------------------
    activeClipsPipelineStatus.phase = 'locating';
      if (fs.existsSync(resolvedRoot)) {
        for (const entry of fs.readdirSync(resolvedRoot)) {
          if (isTransientStagingEntry(entry)) continue;
          if (/^Documental_|_Master|_Final/i.test(entry)) continue;
          const fullSrc = path.join(resolvedRoot, entry);
          if (!isFileStableForAutoPipeline(fullSrc, triggerSource)) continue;
          try {
            const st = fs.statSync(fullSrc);
            if (/\.(mp4|mov|webm)$/i.test(entry)) {
              const dest = path.join(clipsDir, entry);
              fs.renameSync(fullSrc, dest);
              activeClipsPipelineStatus.importedFilesCount++;
            } else if (isEligibleBrollImageEntry(entry)) {
              const inferredNum = ensureBrollMapForExplicitImage(entry);
              if (inferredNum > 0 && brollClipMap.has(inferredNum)) {
                const dest = path.join(clipsDir, entry);
                fs.renameSync(fullSrc, dest);
                registerStagedBrollImage(inferredNum, dest, st.mtimeMs, false);
                activeClipsPipelineStatus.importedFilesCount++;
              }
            }
          } catch {}
        }
      }

      // Also scan loose B-Roll images dropped directly inside 05_Clips_Video
      if (fs.existsSync(clipsDir)) {
        for (const entry of fs.readdirSync(clipsDir)) {
          if (!isEligibleBrollImageEntry(entry)) continue;
          const fullImg = path.join(clipsDir, entry);
          if (!isFileStableForAutoPipeline(fullImg, triggerSource)) continue;
          try {
            const st = fs.statSync(fullImg);
            if (st.size < 5000) continue;
            const inferredNum = ensureBrollMapForExplicitImage(entry);
            if (inferredNum > 0 && brollClipMap.has(inferredNum)) {
              registerStagedBrollImage(inferredNum, fullImg, st.mtimeMs, false);
            }
          } catch {}
        }
      }

      if (downloadsDir && fs.existsSync(downloadsDir) && (clipsList.length > 0 || brollClipMap.size > 0)) {
        const nowMs = Date.now();
        for (const entry of fs.readdirSync(downloadsDir)) {
          if (isTransientStagingEntry(entry)) continue;
          if (/^Documental_|_Master|_Final/i.test(entry)) continue;
          const isVidExt = /\.(mp4|mov|webm)$/i.test(entry);
          const isImgExt = isEligibleBrollImageEntry(entry);
          if (!isVidExt && !isImgExt) continue;
          const fullDl = path.join(downloadsDir, entry);
          if (!isFileStableForAutoPipeline(fullDl, triggerSource)) continue;
          try {
            const st = fs.statSync(fullDl);
            if (nowMs - st.mtimeMs > 12 * 3600 * 1000) continue;
            const inferredNum = isImgExt
              ? ensureBrollMapForExplicitImage(entry)
              : inferClipNumberFromFileName(entry, clipsList);
            if (inferredNum > 0) {
              const targetClip = clipsList.find((c: any) => Number(c.clipNumber) === inferredNum);
              const brollSpec = brollClipMap.get(inferredNum);
              if (isVidExt && targetClip && !brollSpec) {
                const fileToks = normalizeWordTokensForMatch(entry);
                const clipToks = normalizeWordTokensForMatch(
                  `${targetClip.narrationSegment || ''} ${targetClip.videoPrompt || ''}`
                );
                const overlap = fileToks.filter((t) => clipToks.includes(t)).length;
                if (overlap >= 2) {
                  publishTempFileAtomicallyToDir(fullDl, clipsDir, entry);
                  fs.unlinkSync(fullDl);
                  activeClipsPipelineStatus.importedFilesCount++;
                }
              } else if (isImgExt && brollSpec) {
                const fileToks = normalizeWordTokensForMatch(entry);
                const clipToks = normalizeWordTokensForMatch(
                  `${targetClip?.narrationSegment || ''} ${brollSpec.imagePrompt || ''}`
                );
                const overlap = fileToks.filter((t) => clipToks.includes(t)).length;
                if (overlap >= 2 || /^(?:broll|b[\-_]?roll|image)[_\-\s.]*0*\d+[_\-\s.]/i.test(entry)) {
                  const dest = publishTempFileAtomicallyToDir(fullDl, clipsDir, entry);
                  fs.unlinkSync(fullDl);
                  registerStagedBrollImage(inferredNum, dest, st.mtimeMs, true);
                  activeClipsPipelineStatus.importedFilesCount++;
                }
              }
            }
          } catch {}
        }
      }

    // ------------------------------------------------------------------------
    // STEP 2.5: RENDER STATIC B-ROLL IMAGES TO 4K 60FPS (_Broll_4K.mp4) & ARCHIVE SOURCE ONLY ON SUCCESS
    // ------------------------------------------------------------------------
    for (const [clipNum, staged] of stagedBrollImagesByClip.entries()) {
      const brollSpec = brollClipMap.get(clipNum);
      if (!brollSpec || !fs.existsSync(staged.fullPath)) continue;
      const paddedNum = String(clipNum).padStart(2, '0');
      const canonicalBase = buildBrollSixWordBaseName(
        clipNum,
        brollSpec.imagePrompt,
        path.basename(staged.fullPath)
      );
      const finalBrollName = `${canonicalBase}_Broll_4K.mp4`;
      const finalBrollFull = path.join(clipsDir, finalBrollName);

      // Skip re-rendering if finalBrollFull already exists and is newer than staged image with matching motion
      let alreadyRenderedCurrent = false;
      if (fs.existsSync(finalBrollFull)) {
        try {
          const vidSt = fs.statSync(finalBrollFull);
          const archived = findArchivedBrollSourceImage(clipsDir, clipNum);
          if (
            isVerified4kClipOnDisk(finalBrollName, vidSt.size, finalBrollFull, vidSt.mtimeMs) &&
            vidSt.mtimeMs >= staged.mtimeMs &&
            archived?.meta?.motion === brollSpec.motion
          ) {
            alreadyRenderedCurrent = true;
          }
        } catch {}
      }

      if (alreadyRenderedCurrent) {
        const archivedSourcePath = archiveBrollSourceImage(clipsDir, clipNum, staged.fullPath, {
          motion: brollSpec.motion,
          durationSec: brollSpec.durationSec,
          aspectRatio,
          baseName: canonicalBase,
        });
        if (path.resolve(staged.fullPath) !== path.resolve(archivedSourcePath) && fs.existsSync(staged.fullPath)) {
          try {
            fs.unlinkSync(staged.fullPath);
          } catch {}
        }
        continue;
      }

      activeClipsPipelineStatus.phase = 'upscaling_4k';
      activeClipsPipelineStatus.currentFileName = finalBrollName;
      activeClipsPipelineStatus.message = `Renderizando cámara óptica B-Roll 4K 60fps (${brollSpec.motion}) para escena ${paddedNum}...`;

      const jobStamp = `${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
      const tmpSrcImg = path.join(
        os.tmpdir(),
        `huellas_broll_in_${canonicalBase}_${jobStamp}${path.extname(staged.fullPath) || '.jpg'}`
      );
      const tmpBrollFull = path.join(
        os.tmpdir(),
        `huellas_broll_4k_${canonicalBase}_${jobStamp}.mp4`
      );
      const tmpPosterJpg = path.join(
        os.tmpdir(),
        `huellas_broll_poster_${canonicalBase}_${jobStamp}.jpg`
      );
      try {
        fs.copyFileSync(staged.fullPath, tmpSrcImg);
        await renderStaticBrollImageTo4K60OnDisk(
          tmpSrcImg,
          tmpBrollFull,
          brollSpec.motion,
          brollSpec.durationSec,
          aspectRatio
        );
        if (fs.existsSync(tmpBrollFull) && fs.statSync(tmpBrollFull).size >= 512 * 1024) {
          publishTempFileAtomicallyToDir(tmpBrollFull, clipsDir, finalBrollName);
          const prefix = `${paddedNum}_`;
          for (const existing of fs.readdirSync(clipsDir)) {
            const fullExisting = path.join(clipsDir, existing);
            if (
              !isTransientStagingEntry(existing) &&
              path.resolve(fullExisting) !== path.resolve(finalBrollFull) &&
              /\.(mp4|mov|webm)$/i.test(existing) &&
              existing.startsWith(prefix)
            ) {
              try {
                fs.unlinkSync(fullExisting);
              } catch {}
            }
          }
          for (const subCache of ['.optical_flow_cache', '.foley_only_cache']) {
            const cacheDir = path.join(clipsDir, subCache);
            if (fs.existsSync(cacheDir) && fs.statSync(cacheDir).isDirectory()) {
              for (const cFile of fs.readdirSync(cacheDir)) {
                if (cFile.startsWith(prefix)) {
                  try {
                    fs.unlinkSync(path.join(cacheDir, cFile));
                  } catch {}
                }
              }
            }
          }
          // Archive B-Roll source only AFTER the 4K B-Roll video has been published successfully
          const archivedSourcePath = archiveBrollSourceImage(clipsDir, clipNum, staged.fullPath, {
            motion: brollSpec.motion,
            durationSec: brollSpec.durationSec,
            aspectRatio,
            baseName: canonicalBase,
          });
          if (path.resolve(staged.fullPath) !== path.resolve(archivedSourcePath) && fs.existsSync(staged.fullPath)) {
            try {
              fs.unlinkSync(staged.fullPath);
            } catch {}
          }
          // Extract poster .jpg inside /tmp and publish atomically
          const suffixWithoutNum = canonicalBase.replace(/^0*\d+_/, '');
          const frameFileName = `${paddedNum}_Imagen_Inicial_${suffixWithoutNum}.jpg`;
          try {
            const ffmpegBin = resolveFfmpegBin();
            await new Promise<void>((resolve) => {
              const proc = spawn(
                ffmpegBin,
                ['-nostdin', '-y', '-i', tmpSrcImg, '-frames:v', '1', '-q:v', '2', tmpPosterJpg],
                { stdio: 'ignore' }
              );
              const kt = setTimeout(() => {
                try {
                  proc.kill('SIGKILL');
                } catch {}
                resolve();
              }, 30000);
              proc.on('error', () => {
                clearTimeout(kt);
                resolve();
              });
              proc.on('close', () => {
                clearTimeout(kt);
                resolve();
              });
            });
            if (fs.existsSync(tmpPosterJpg) && fs.statSync(tmpPosterJpg).size > 1000) {
              publishTempFileAtomicallyToDir(tmpPosterJpg, clipsDir, frameFileName);
            }
          } catch {}
          activeClipsPipelineStatus.upscaled4kCount++;
          upscaledSyncUpdates.push({ clipNumber: clipNum, fileName: finalBrollName });
        }
      } catch (err) {
        console.warn(`[ClipsPipeline] Error rendering B-Roll scene ${paddedNum}:`, err);
      } finally {
        for (const pTmp of [tmpSrcImg, tmpBrollFull, tmpPosterJpg]) {
          try {
            if (fs.existsSync(pTmp)) fs.unlinkSync(pTmp);
          } catch {}
        }
      }
    }

    // ------------------------------------------------------------------------
    // STEP 3: NORMALIZE FILENAMES IN 05_Clips_Video (01 to 09 zero-padded, _ between words)
    // ------------------------------------------------------------------------
    activeClipsPipelineStatus.phase = 'normalizing';
    activeClipsPipelineStatus.message = 'Normalizando numeración y nombres de clips...';
    if (fs.existsSync(clipsDir)) {
      for (const entry of fs.readdirSync(clipsDir)) {
        if (isTransientStagingEntry(entry)) continue;
        if (!/\.(mp4|mov|webm)$/i.test(entry)) continue;
        const fullOrig = path.join(clipsDir, entry);
        if (!isFileStableForAutoPipeline(fullOrig, triggerSource)) continue;
        let st: fs.Stats;
        try {
          st = fs.statSync(fullOrig);
        } catch {
          continue;
        }
        if (!st.isFile()) continue;

        const clipNum = inferClipNumberFromFileName(entry, clipsList);
        if (clipNum > 0) {
          const isBroll4k = /_broll_4k\.(mp4|mov|webm)$/i.test(entry);
          const isAlready4k = isBroll4k || /[_\-]4k\.(mp4|mov|webm)$/i.test(entry);
          const ext = path.extname(entry);
          let rawBase = path
            .basename(entry, ext)
            .replace(/[_\-](?:broll[_\-])?4k$/i, '')
            .replace(/[_\-](?:1080p|720p|2k|hd|uhd)$/i, '');
          // Strip leading Clip_01 / 01_ prefix so we can re-prefix cleanly with 2-digit pad
          rawBase = rawBase
            .replace(/^(?:(?:clip|broll|b[\-_]?roll|inicial|initial|video|image|imagen|scene|escena)[_\-\s.]*)?0*\d+[_\-\s.]*/i, '')
            .replace(/\s+/g, '_')
            .replace(/_+/g, '_')
            .replace(/^_|_$/g, '');
          if (!rawBase) {
            rawBase = 'Clip';
          }
          const numPrefix = String(clipNum).padStart(2, '0');
          const suffix4k = isBroll4k ? '_Broll_4K' : isAlready4k ? '_4K' : '';
          const normalizedName = `${numPrefix}_${rawBase}${suffix4k}${ext}`;
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
          .filter((e) => !isTransientStagingEntry(e) && /\.(mp4|mov|webm)$/i.test(e))
      : [];

    // Separate files that already have real _4K (>=12MB or _Broll_4K >=512KB) vs files that need 4K conversion
      const mtimeReal4kByClip = new Map<number, number>();
      for (const entry of allVideoEntries) {
        if (/[_\-]4k\.(mp4|mov|webm)$/i.test(entry)) {
          try {
            const fullPath = path.join(clipsDir, entry);
            const st = fs.statSync(fullPath);
            if (isVerified4kClipOnDisk(entry, st.size, fullPath, st.mtimeMs)) {
              const cNum = inferClipNumberFromFileName(entry, clipsList);
              if (cNum > 0) {
                const prev = mtimeReal4kByClip.get(cNum) || 0;
                if (st.mtimeMs > prev) mtimeReal4kByClip.set(cNum, st.mtimeMs);
              }
            }
          } catch {}
        }
      }

      const pendingUpscaleFiles: string[] = [];
      for (const entry of allVideoEntries) {
        const fullPath = path.join(clipsDir, entry);
        let st: fs.Stats | null = null;
        try {
          st = fs.statSync(fullPath);
        } catch {}
        const isReal4k = !!st && isVerified4kClipOnDisk(entry, st.size, fullPath, st.mtimeMs);
        if (isReal4k) {
          activeClipsPipelineStatus.already4kCount++;
        } else if (st && st.size > 10000 && isFileStableForAutoPipeline(fullPath, triggerSource)) {
          const cNum = inferClipNumberFromFileName(entry, clipsList);
          const existing4kMtime = cNum > 0 ? mtimeReal4kByClip.get(cNum) || 0 : 0;
          if (existing4kMtime > 0 && st.mtimeMs <= existing4kMtime) {
            // Leftover non-4K file older than an already-upscaled 4K file for the same clip
            try {
              fs.unlinkSync(fullPath);
            } catch {}
          } else {
            pendingUpscaleFiles.push(entry);
          }
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
      const pendingJsonBatch: Array<{ clipNumber: number; fileName: string }> = [];
      const flushJsonBatch = () => {
        if (pendingJsonBatch.length === 0) return;
        const batch = pendingJsonBatch.splice(0, pendingJsonBatch.length);
        try {
          syncUpscaledClipsToDocumentariesJson(resolvedRoot, batch, {
            docId: effectiveDocId,
            docTitle: effectiveDocTitle,
            skipCloudPush: true,
          });
        } catch {}
      };
      const workerCount = Math.min(2, pendingUpscaleFiles.length);
      const workers = Array.from({ length: workerCount }, async () => {
        while (nextIdx < pendingUpscaleFiles.length) {
          const myIdx = nextIdx++;
          const entry = pendingUpscaleFiles[myIdx];
          const srcFull = path.join(clipsDir, entry);
          if (!fs.existsSync(srcFull)) continue;

          const baseNoExt = path
            .basename(entry, path.extname(entry))
            .replace(/[_\-](?:broll[_\-])?4k$/i, '')
            .replace(/[_\-](?:1080p|720p|2k|hd|uhd)$/i, '');
          const final4kName = `${baseNoExt}_4K.mp4`;
          const final4kFull = path.join(clipsDir, final4kName);
          const jobStamp = `${process.pid}_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
          const tmpInputFull = path.join(
            os.tmpdir(),
            `huellas_in_${baseNoExt}_${jobStamp}${path.extname(entry)}`
          );
          const tmp4kFull = path.join(
            os.tmpdir(),
            `huellas_4k_${baseNoExt}_${jobStamp}.mp4`
          );
          const tmpPosterJpg = path.join(
            os.tmpdir(),
            `huellas_poster_${baseNoExt}_${jobStamp}.jpg`
          );

          activeClipsPipelineStatus.currentFileName = entry;
          activeClipsPipelineStatus.message = `Mejorando a 4K (${activeClipsPipelineStatus.current + 1}/${activeClipsPipelineStatus.total}): ${entry}`;

          try {
            fs.copyFileSync(srcFull, tmpInputFull);
            await upscaleFileTo4KOnDisk(tmpInputFull, tmp4kFull, aspectRatio);
            if (fs.existsSync(tmp4kFull) && fs.statSync(tmp4kFull).size > 10000) {
              const clipNum = inferClipNumberFromFileName(entry, clipsList);
              const paddedNum = clipNum > 0 ? String(clipNum).padStart(2, '0') : '';
              const prefix = paddedNum ? `${paddedNum}_` : '';
              publishTempFileAtomicallyToDir(tmp4kFull, clipsDir, final4kName);
              // Remove the original non-4K video file and any older video files for the same clip number
              for (const existing of fs.readdirSync(clipsDir)) {
                const fullExisting = path.join(clipsDir, existing);
                if (
                  !isTransientStagingEntry(existing) &&
                  path.resolve(fullExisting) !== path.resolve(final4kFull) &&
                  /\.(mp4|mov|webm)$/i.test(existing) &&
                  ((prefix && existing.startsWith(prefix)) || existing === entry)
                ) {
                  try {
                    fs.unlinkSync(fullExisting);
                  } catch {}
                }
              }
              // Clean stale optical-flow and foley caches for this clip number
              if (prefix) {
                for (const subCache of ['.optical_flow_cache', '.foley_only_cache']) {
                  const cacheDir = path.join(clipsDir, subCache);
                  if (fs.existsSync(cacheDir) && fs.statSync(cacheDir).isDirectory()) {
                    for (const cFile of fs.readdirSync(cacheDir)) {
                      if (cFile.startsWith(prefix)) {
                        try {
                          fs.unlinkSync(path.join(cacheDir, cFile));
                        } catch {}
                      }
                    }
                  }
                }
                // Extract/update initial frame .jpg inside /tmp and publish atomically
                const suffixWithoutNum = baseNoExt.replace(/^0*\d+_/, '');
                const frameFileName = `${paddedNum}_Imagen_Inicial_${suffixWithoutNum}.jpg`;
                try {
                  const ffmpegBin = resolveFfmpegBin();
                  await new Promise<void>((resolve) => {
                    const proc = spawn(
                      ffmpegBin,
                      ['-nostdin', '-y', '-i', tmp4kFull, '-frames:v', '1', '-q:v', '2', tmpPosterJpg],
                      { stdio: 'ignore' }
                    );
                    const kt = setTimeout(() => {
                      try {
                        proc.kill('SIGKILL');
                      } catch {}
                      resolve();
                    }, 30000);
                    proc.on('error', () => {
                      clearTimeout(kt);
                      resolve();
                    });
                    proc.on('close', () => {
                      clearTimeout(kt);
                      resolve();
                    });
                  });
                  if (fs.existsSync(tmpPosterJpg) && fs.statSync(tmpPosterJpg).size > 1000) {
                    publishTempFileAtomicallyToDir(tmpPosterJpg, clipsDir, frameFileName);
                  }
                } catch {}
              }
              activeClipsPipelineStatus.upscaled4kCount++;
              if (clipNum > 0) {
                upscaledSyncUpdates.push({ clipNumber: clipNum, fileName: final4kName });
                pendingJsonBatch.push({ clipNumber: clipNum, fileName: final4kName });
                if (pendingJsonBatch.length >= 10) {
                  flushJsonBatch();
                }
              }
            }
          } catch (err) {
            console.warn(`[ClipsPipeline] Error upscaling ${entry} to 4K:`, err);
          } finally {
            for (const pTmp of [tmpInputFull, tmp4kFull, tmpPosterJpg]) {
              try {
                if (fs.existsSync(pTmp)) fs.unlinkSync(pTmp);
              } catch {}
            }
            activeClipsPipelineStatus.current++;
          }
        }
      });

    await Promise.all(workers);
    flushJsonBatch();

    // ------------------------------------------------------------------------
    // STEP 5: COLLECT FINAL 4K CLIPS LIST FOR STAGE 8 & VIDEO EDITOR TIMELINE
    // ------------------------------------------------------------------------
    const clipVideos: Array<{ clipNumber: number; fileName: string; url: string; is4K: boolean }> = [];
    const seenClips = new Set<number>();
    if (fs.existsSync(clipsDir)) {
      const finalEntries = fs
        .readdirSync(clipsDir)
        .filter((e) => !isTransientStagingEntry(e) && /\.(mp4|mov|webm)$/i.test(e))
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
        const mVid = entry.match(/^(?:(?:clip|broll|b[\-_]?roll|video|scene|escena)[_\-\s.]*)?0*(\d+)[_\-\s.(].*\.(mp4|webm|mov)$/i);
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

      // Sync final 4K clip names to documentaries.json (push to GitHub once if anything was converted)
      const all4kUpdates = clipVideos
        .filter((v) => v.is4K && v.clipNumber > 0)
        .map((v) => ({ clipNumber: v.clipNumber, fileName: v.fileName }));
      if (all4kUpdates.length > 0) {
        syncUpscaledClipsToDocumentariesJson(resolvedRoot, all4kUpdates, {
          docId: effectiveDocId,
          docTitle: effectiveDocTitle,
          skipCloudPush: upscaledSyncUpdates.length === 0,
        });
      }

      activeClipsPipelineStatus = {
        ...activeClipsPipelineStatus,
        running: false,
        phase: 'completed',
        currentFileName: '',
        message: `Proceso completado: ${activeClipsPipelineStatus.upscaled4kCount} convertidos a 4K, ${activeClipsPipelineStatus.already4kCount} ya en 4K (${clipVideos.length} listos en el Timeline).`,
        completedAt: new Date().toISOString(),
      };

      return {
        ok: true,
        resolvedRoot,
        clipVideos,
        extractedZipsCount: activeClipsPipelineStatus.extractedZipsCount,
        importedFilesCount: activeClipsPipelineStatus.importedFilesCount,
        upscaled4kCount: activeClipsPipelineStatus.upscaled4kCount,
        already4kCount: activeClipsPipelineStatus.already4kCount,
        message: activeClipsPipelineStatus.message,
      };
    } catch (err: any) {
      activeClipsPipelineStatus = {
        ...activeClipsPipelineStatus,
        running: false,
        phase: 'error',
        error: err?.message || 'Error procesando clips a 4K.',
        message: err?.message || 'Error procesando clips a 4K.',
      };
      return {
        ok: false,
        statusCode: 500,
        error: err?.message || 'Error procesando clips a 4K.',
      };
    }
  })();

  activeClipsPipelinePromise = runPromise;
  try {
    return await runPromise;
  } finally {
    if (activeClipsPipelinePromise === runPromise) {
      activeClipsPipelinePromise = null;
    }
    const nextQueuedEntry = queuedClipsPipelinesByFolder.entries().next().value as
      | [string, Clips4kPipelineParams]
      | undefined;
    if (nextQueuedEntry) {
      const [nextKey, nextQueued] = nextQueuedEntry;
      queuedClipsPipelinesByFolder.delete(nextKey);
      setTimeout(() => {
        void runClips4kPipelineCore(nextQueued).catch((err) => {
          console.warn('[ClipsPipeline] Error executing queued follow-up pass:', err);
        });
      }, 250);
    } else {
      setTimeout(() => {
        try {
          if (!activeClipsPipelinePromise && hasPendingRawClipsInFolder(resolvedRoot)) {
            void runClips4kPipelineCore({
              folderPath: resolvedRoot,
              docId: requestedDocId,
              docTitle: requestedDocTitle,
              triggerSource: 'watcher',
            }).catch(() => {});
          }
        } catch {}
      }, 500);
    }
  }
}

function triggerAutonomousClips4kForFolder(
  resolvedRoot: string,
  docTitle = '',
  triggerSource: Clips4kPipelineTriggerSource = 'watcher'
) {
  if (!resolvedRoot || !fs.existsSync(resolvedRoot)) return;
  rememberWatchedStage6Folder(resolvedRoot, docTitle);
  void runClips4kPipelineCore({
    folderPath: resolvedRoot,
    docTitle,
    triggerSource,
  }).catch((err) => {
    console.warn(`[Auto4kWatcher:${triggerSource}] Error en pipeline autónomo:`, err);
  });
}

const zipInspectNegativeCache = new Map<string, boolean>();

function hasPendingRawClipsInFolder(resolvedRoot: string): boolean {
  if (!resolvedRoot || !fs.existsSync(resolvedRoot)) return false;
  const clipsDir = path.join(resolvedRoot, '05_Clips_Video');
  const hydrated = resolveDocPipelineContext(resolvedRoot);
  const clipsList = hydrated.clips || [];

  const brollNums = new Set<number>();
  for (const c of clipsList) {
    const cNum = Number(c?.clipNumber);
    if (!cNum) continue;
    const parsed = parseServerBrollMotionFromText(`${c.imagePrompt || ''} ${c.videoPrompt || ''}`);
    if (c.isStaticBroll || parsed.isStaticBroll) brollNums.add(cNum);
  }
  const promptsTxtFallback = path.join(resolvedRoot, '01_Guion_y_SEO', 'Prompts_Clips_Flow.txt');
  if (fs.existsSync(promptsTxtFallback)) {
    try {
      const rawTxt = fs.readFileSync(promptsTxtFallback, 'utf8');
      for (const line of rawTxt.split(/\r?\n/)) {
        const mImg = line.trim().match(/^(?:Image|Imagen)\s+0*(\d+)(?:\s*\([^)]*\))?\s*:\s*(.+)$/i);
        if (mImg) {
          const cNum = parseInt(mImg[1], 10);
          const parsed = parseServerBrollMotionFromText(line);
          if (cNum > 0 && parsed.isStaticBroll) brollNums.add(cNum);
        }
      }
    } catch {}
  }

  for (const dir of [clipsDir, resolvedRoot]) {
    if (!fs.existsSync(dir)) continue;
    let entries: string[] = [];
    try {
      entries = fs.readdirSync(dir);
    } catch {
      continue;
    }
    for (const entry of entries) {
      if (isTransientStagingEntry(entry)) continue;
      if (dir === resolvedRoot && /^Documental_|_Master|_Final/i.test(entry)) continue;
      const full = path.join(dir, entry);
      if (!isFileStableForAutoPipeline(full, 'watcher')) continue;
      if (/\.zip$/i.test(entry)) return true;
      if (/\.(mp4|mov|webm)$/i.test(entry)) {
        try {
          const st = fs.statSync(full);
          if (st.size > 10000 && !isVerified4kClipOnDisk(entry, st.size, full, st.mtimeMs)) {
            return true;
          }
        } catch {}
      }
      if (parseExplicitBrollClipNumFromImageName(entry) > 0) return true;
      if (brollNums.size > 0 && isEligibleBrollImageEntry(entry)) {
        const inferred = inferClipNumberFromFileName(entry, clipsList);
        if (inferred > 0 && brollNums.has(inferred)) return true;
      }
    }
  }

  const downloadsDir = getVerifiedDownloadsDir(false);
  if (downloadsDir && fs.existsSync(downloadsDir)) {
    const nowMs = Date.now();
    try {
      for (const entry of fs.readdirSync(downloadsDir)) {
        if (entry.startsWith('.') || /^Documental_|_Master|_Final/i.test(entry)) continue;
        const fullDl = path.join(downloadsDir, entry);
        if (!isFileStableForAutoPipeline(fullDl, 'watcher')) continue;
        let st: fs.Stats;
        try {
          st = fs.statSync(fullDl);
        } catch {
          continue;
        }
        if (nowMs - st.mtimeMs > 6 * 3600 * 1000) continue;

        if (/\.zip$/i.test(entry)) {
          const cacheKey = `${fullDl}:${Math.floor(st.mtimeMs)}`;
          if (zipInspectNegativeCache.get(cacheKey)) continue;
          try {
            const listOut = execSync(`unzip -l "${fullDl.replace(/"/g, '\\"')}"`, {
              encoding: 'utf8',
              timeout: 5000,
              stdio: ['ignore', 'pipe', 'ignore'],
            });
            const hasClipVideos =
              /\.(mp4|mov|webm)/i.test(listOut) &&
              (/(?:^|\s|\/)(?:0*\d+_|clip|broll|b[\-_]?roll|video|create_a_video)/i.test(listOut) ||
                /flow/i.test(entry));
            const hasBrollFlowImages =
              brollNums.size > 0 &&
              /\.(png|jpg|jpeg|webp)/i.test(listOut) &&
              (/(?:^|\s|\/)(?:0*\d+_|(?:broll|b[\-_]?roll|image|inicial|initial)[_\-\s.]*0*\d+|create_an_image)/i.test(
                listOut
              ) ||
                /flow/i.test(entry));
            if (hasClipVideos || hasBrollFlowImages) return true;
            if (zipInspectNegativeCache.size > 200) zipInspectNegativeCache.clear();
            zipInspectNegativeCache.set(cacheKey, true);
          } catch {}
          continue;
        }

        if (clipsList.length === 0) continue;
        const isVidExt = /\.(mp4|mov|webm)$/i.test(entry) && st.size > 10000;
        const isImgExt = brollNums.size > 0 && isEligibleBrollImageEntry(entry) && st.size >= 5000;
        if (!isVidExt && !isImgExt) continue;
        const inferredNum = inferClipNumberFromFileName(entry, clipsList);
        if (inferredNum <= 0) continue;
        const targetClip = clipsList.find((c: any) => Number(c.clipNumber) === inferredNum);
        const isBroll = brollNums.has(inferredNum);
        if (isVidExt && targetClip && !isBroll) {
          const fileToks = normalizeWordTokensForMatch(entry);
          const clipToks = normalizeWordTokensForMatch(
            `${targetClip.narrationSegment || ''} ${targetClip.videoPrompt || ''}`
          );
          if (fileToks.filter((t) => clipToks.includes(t)).length >= 2) return true;
        } else if (isImgExt && isBroll) {
          const fileToks = normalizeWordTokensForMatch(entry);
          const clipToks = normalizeWordTokensForMatch(
            `${targetClip?.narrationSegment || ''} ${targetClip?.imagePrompt || ''}`
          );
          if (
            fileToks.filter((t) => clipToks.includes(t)).length >= 2 ||
            /^(?:broll|b[\-_]?roll|image)[_\-\s.]*0*\d+[_\-\s.]/i.test(entry)
          ) {
            return true;
          }
        }
      }
    } catch {}
  }

  return false;
}

function runAutonomousClipsWatcherTick() {
  if (activeClipsPipelinePromise || activeClipsPipelineStatus.running) return;
  try {
    const candidateRoots = new Map<string, string>();
    for (const [folderPath, meta] of watchedStage6DocFolders.entries()) {
      if (folderPath && fs.existsSync(folderPath)) {
        candidateRoots.set(path.resolve(folderPath), meta?.docTitle || '');
      }
    }
    const docs = readDocumentaries();
    for (const doc of docs) {
      const resolved = resolveLocalDocumentaryFolder(
        doc?.downloadFolderPath || '',
        doc?.downloadFolderName || '',
        doc?.title || ''
      );
      if (resolved && fs.existsSync(resolved)) {
        const key = path.resolve(resolved);
        if (!candidateRoots.has(key)) {
          candidateRoots.set(key, String(doc?.title || ''));
        }
      }
    }

    for (const [rootFolder, docTitle] of candidateRoots.entries()) {
      if (hasPendingRawClipsInFolder(rootFolder)) {
        console.log(
          `[Auto4kWatcher] Detectados clips o láminas B-Roll pendientes en "${path.basename(rootFolder)}". Iniciando conversión automática a 4K...`
        );
        triggerAutonomousClips4kForFolder(rootFolder, docTitle, 'watcher');
        break;
      }
    }
  } catch (err) {
    console.warn('[Auto4kWatcher] Tick warning:', err);
  }
}

setInterval(runAutonomousClipsWatcherTick, 3500);
setTimeout(runAutonomousClipsWatcherTick, 2000);

app.post('/api/flow/process-clips-pipeline', async (req, res) => {
  const result = await runClips4kPipelineCore({
    ...(req.body || {}),
    triggerSource: 'manual',
  });
  if (!result.ok) {
    res.status(result.statusCode || 500).json({ ok: false, error: result.error });
    return;
  }
  res.json(result);
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
    const downloadsDir = getVerifiedDownloadsDir(true);
    const parsedSingleBroll = parseServerBrollMotionFromText(
      `${clip.imagePrompt || ''} ${clip.videoPrompt || ''}`
    );
    const isSingleStaticBroll = Boolean(clip.isStaticBroll || parsedSingleBroll.isStaticBroll);
    const singleBrollMotion = normalizeServerBrollMotion(
      clip.brollCameraMotion || parsedSingleBroll.brollCameraMotion || 'zoom_in'
    );
    const singleDurationSec = Math.max(
      2,
      Math.min(30, Number(clip.durationSeconds) || (clipNumber === 1 ? 6 : 8))
    );
    const singleClipList = [
      {
        clipNumber,
        imagePrompt: String(clip.imagePrompt || ''),
        videoPrompt: String(clip.videoPrompt || ''),
        narrationSegment: String(clip.narrationSegment || ''),
      },
    ];

    // 1. Extract any .zip files sitting in 05_Clips_Video or resolvedRoot (preserving all B-Roll scene images in mixed batch zips)
    const knownProjectBrollNums = new Set<number>();
    if (isSingleStaticBroll) knownProjectBrollNums.add(clipNumber);
    const singlePromptsFallback = path.join(resolvedRoot, '01_Guion_y_SEO', 'Prompts_Clips_Flow.txt');
    if (fs.existsSync(singlePromptsFallback)) {
      try {
        for (const rawLine of fs.readFileSync(singlePromptsFallback, 'utf8').split(/\r?\n/)) {
          const mImg = rawLine.trim().match(/^(?:Image|Imagen)\s+0*(\d+)(?:\s*\([^)]*\))?\s*:\s*(.+)$/i);
          if (mImg && parseServerBrollMotionFromText(rawLine).isStaticBroll) {
            knownProjectBrollNums.add(parseInt(mImg[1], 10));
          }
        }
      } catch {}
    }
    if (fs.existsSync(DOCS_FILE)) {
      try {
        const dbDocs = JSON.parse(fs.readFileSync(DOCS_FILE, 'utf8'));
        if (Array.isArray(dbDocs)) {
          const matchedDoc = dbDocs.find(
            (d: any) => d?.localProjectFolderPath && path.resolve(d.localProjectFolderPath) === path.resolve(resolvedRoot)
          );
          if (matchedDoc && Array.isArray(matchedDoc.clips)) {
            for (const dc of matchedDoc.clips) {
              if (dc?.isStaticBroll && Number(dc.clipNumber) > 0) {
                knownProjectBrollNums.add(Number(dc.clipNumber));
              }
            }
          }
        }
      } catch {}
    }

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
          let extractedAnyFromSingleZip = false;
          for (const extracted of fs.readdirSync(tmpUnzipDir)) {
            if (extracted.startsWith('.') || extracted.startsWith('__MACOSX')) continue;
            const mExtractedNum = extracted.match(
              /^(?:(?:clip|video|image|imagen|scene|escena)[_\-\s.]*)?0*(\d+)(?:[_\-\s.(]|$)/i
            );
            const extractedClipNum = mExtractedNum
              ? parseInt(mExtractedNum[1], 10)
              : inferClipNumberFromFileName(extracted, singleClipList);
            const isMatchedBrollImg =
              isEligibleBrollImageEntry(extracted) &&
              extractedClipNum > 0 &&
              knownProjectBrollNums.has(extractedClipNum);
            if (/\.(mp4|mov|webm)$/i.test(extracted) || isMatchedBrollImg) {
              fs.copyFileSync(path.join(tmpUnzipDir, extracted), path.join(clipsDir, extracted));
              extractedAnyFromSingleZip = true;
            }
          }
          if (extractedAnyFromSingleZip) {
            fs.unlinkSync(zipFull);
          }
        } catch {
        } finally {
          try {
            if (fs.existsSync(tmpUnzipDir)) fs.rmSync(tmpUnzipDir, { recursive: true, force: true });
          } catch {}
        }
      }
    }

    // 2. Gather all candidate video (or B-Roll image) files for this clipNumber across 05_Clips_Video, resolvedRoot, Clips_Aprobados, and recent ~/Downloads
    const candidates: Array<{
      fullPath: string;
      fileName: string;
      mtimeMs: number;
      dir: string;
      isImageSource?: boolean;
    }> = [];
    const matchesTargetClip = (entryName: string, checkOverlap = false): boolean => {
      if (entryName.startsWith('.') || /\.tmp\.(mp4|mov|webm)$/i.test(entryName)) return false;
      const isVid = /\.(mp4|mov|webm)$/i.test(entryName);
      const isImg = isSingleStaticBroll && isEligibleBrollImageEntry(entryName);
      if (!isVid && !isImg) return false;
      if (/^Documental_|_Master|_Final/i.test(entryName)) return false;
      const mPrefix = entryName.match(
        /^(?:(?:clip|video|image|imagen|scene|escena)[_\-\s.]*)?0*(\d+)(?:[_\-\s.(]|$)/i
      );
      if (mPrefix && parseInt(mPrefix[1], 10) === clipNumber) {
        if (!checkOverlap) return true;
        const fileToks = normalizeWordTokensForMatch(entryName);
        const clipToks = normalizeWordTokensForMatch(
          `${clip.narrationSegment || ''} ${clip.imagePrompt || ''} ${clip.videoPrompt || ''}`
        );
        const overlap = fileToks.filter((t) => clipToks.includes(t)).length;
        if (overlap >= 1 || /^(?:clip|image|imagen)[_\-\s.]*0*\d+/i.test(entryName)) return true;
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
          if (st.isFile() && st.size > 5000) {
            candidates.push({
              fullPath: full,
              fileName: entry,
              mtimeMs: st.mtimeMs,
              dir: d,
              isImageSource: isEligibleBrollImageEntry(entry),
            });
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
          if (st.isFile() && st.size > 5000 && nowMs - st.mtimeMs <= 12 * 3600 * 1000) {
            candidates.push({
              fullPath: full,
              fileName: entry,
              mtimeMs: st.mtimeMs,
              dir: downloadsDir,
              isImageSource: isEligibleBrollImageEntry(entry),
            });
          }
        } catch {}
      }
    }

    if (candidates.length === 0 && isSingleStaticBroll) {
      const archivedBroll = findArchivedBrollSourceImage(clipsDir, clipNumber);
      if (archivedBroll && fs.existsSync(archivedBroll.imagePath)) {
        const st = fs.statSync(archivedBroll.imagePath);
        candidates.push({
          fullPath: archivedBroll.imagePath,
          fileName: path.basename(archivedBroll.imagePath),
          mtimeMs: st.mtimeMs,
          dir: path.dirname(archivedBroll.imagePath),
          isImageSource: true,
        });
      }
    }

    if (candidates.length === 0) {
      res.status(404).json({
        ok: false,
        error: isSingleStaticBroll
          ? `No se encontró ninguna imagen o video B-Roll para la Escena ${String(clipNumber).padStart(2, '0')} en 05_Clips_Video ni en Descargas.`
          : `No se encontró ningún archivo de video para el Clip ${String(clipNumber).padStart(2, '0')} en 05_Clips_Video ni en Descargas.`,
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
        !c.isImageSource &&
        new RegExp(`^0*${clipNumber}_[a-zA-Z0-9]`, 'i').test(c.fileName) &&
        !/^(?:clip|video|image|imagen)[_\-\s.]/i.test(c.fileName)
    );
    if (isSingleStaticBroll && newest.isImageSource) {
      canonicalBase = buildBrollSixWordBaseName(clipNumber, String(clip.imagePrompt || ''), newest.fileName);
    } else if (clip.expectedFileName) {
      canonicalBase = path
        .basename(String(clip.expectedFileName), path.extname(String(clip.expectedFileName)))
        .replace(/[_\-](?:broll[_\-])?4k$/i, '')
        .replace(/[_\-](?:1080p|720p|2k|hd|uhd)$/i, '');
    } else if (existingCanonical) {
      canonicalBase = path
        .basename(existingCanonical.fileName, path.extname(existingCanonical.fileName))
        .replace(/[_\-](?:broll[_\-])?4k$/i, '')
        .replace(/[_\-](?:1080p|720p|2k|hd|uhd)$/i, '');
    } else {
      let rawBase = path
        .basename(newest.fileName, path.extname(newest.fileName))
        .replace(/[_\-](?:broll[_\-])?4k$/i, '')
        .replace(/[_\-](?:1080p|720p|2k|hd|uhd)$/i, '')
        .replace(/^(?:(?:clip|video|image|imagen|scene|escena)[_\-\s.]*)?0*\d+[_\-\s.]*/i, '')
        .replace(/\s+/g, '_')
        .replace(/_+/g, '_')
        .replace(/^_|_$/g, '');
      if (!rawBase) rawBase = 'Clip';
      canonicalBase = `${paddedNum}_${rawBase}`;
    }

    const useBrollSuffix = isSingleStaticBroll && (newest.isImageSource || /_broll_4k\./i.test(newest.fileName));
    const final4kName = `${canonicalBase}${useBrollSuffix ? '_Broll_4K' : '_4K'}.mp4`;
    const final4kFull = path.join(clipsDir, final4kName);

    // Check if the newest file is ALREADY a real 4K file (checked via size & cached FFmpeg probe) in clipsDir
    let newestStat: fs.Stats | null = null;
    try {
      newestStat = fs.statSync(newest.fullPath);
    } catch {}
    const isNewestAlready4KName =
      !newest.isImageSource &&
      !!newestStat &&
      isVerified4kClipOnDisk(newest.fileName, newestStat.size, newest.fullPath, newestStat.mtimeMs);
    let wasUpscaled = false;

    if (newest.isImageSource) {
      const archivedImg = archiveBrollSourceImage(clipsDir, clipNumber, newest.fullPath, {
        motion: singleBrollMotion,
        durationSec: singleDurationSec,
        aspectRatio,
        baseName: canonicalBase,
      });
      const tmpBrollFull = path.join(
        os.tmpdir(),
        `huellas_single_broll_4k_${canonicalBase}_${Date.now()}_${Math.random().toString(36).slice(2, 5)}.mp4`
      );
      try {
        await renderStaticBrollImageTo4K60OnDisk(
          archivedImg,
          tmpBrollFull,
          singleBrollMotion,
          singleDurationSec,
          aspectRatio
        );
        if (fs.existsSync(tmpBrollFull) && fs.statSync(tmpBrollFull).size >= 512 * 1024) {
          fs.copyFileSync(tmpBrollFull, final4kFull);
          wasUpscaled = true;
        }
      } finally {
        try {
          if (fs.existsSync(tmpBrollFull)) fs.unlinkSync(tmpBrollFull);
        } catch {}
      }
    } else if (isNewestAlready4KName && path.resolve(newest.fullPath) === path.resolve(final4kFull)) {
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

    // Clean up any other older / non-4K video or loose B-Roll image files for this clipNumber in clipsDir/Downloads (never touch _broll_sources)
    const brollSourcesResolved = path.resolve(path.join(clipsDir, '_broll_sources'));
    if (fs.existsSync(final4kFull)) {
      for (const c of candidates) {
        if (
          (c.dir === clipsDir || c.dir === downloadsDir || c.dir === resolvedRoot) &&
          !path.resolve(c.fullPath).startsWith(brollSourcesResolved) &&
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
      const ffmpegBin = getFfmpegPath();
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
    const activeIs4k = /[_\-]4k\.(mp4|mov|webm)$/i.test(activeVideoName);
    if (activeIs4k && clipNumber > 0) {
      syncUpscaledClipsToDocumentariesJson(
        resolvedRoot,
        [{ clipNumber, fileName: activeVideoName }],
        { docTitle, skipCloudPush: false }
      );
    }

    res.json({
      ok: true,
      clipNumber,
      fileName: activeVideoName,
      url: videoUrl,
      frameUrl,
      is4K: activeIs4k,
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
// LIVE B-ROLL CAMERA RE-RENDERER FOR CAPCUT EDITOR (~1.8s 4K 60FPS)
// ============================================================================
const activeBrollRerenderLocks = new Map<string, Promise<any>>();

app.post('/api/flow/rerender-broll-clip', async (req, res) => {
  try {
    const {
      docId = '',
      folderPath = '',
      folderName = '',
      docTitle = '',
      aspectRatio = '16:9',
      clipNumber: rawClipNum = 0,
      motion: rawMotion = 'zoom_in',
      durationSec: rawDurSec = 8,
      imagePrompt = '',
      currentFileName = '',
    } = req.body || {};

    const clipNumber = Number(rawClipNum || 0);
    if (!clipNumber || clipNumber <= 0) {
      res.status(400).json({ ok: false, error: 'Número de clip B-Roll inválido.' });
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
    const motion = normalizeServerBrollMotion(rawMotion);
    const durationSec = Math.max(2, Math.min(30, Number(rawDurSec) || (clipNumber === 1 ? 6 : 8)));
    const lockKey = `${path.resolve(clipsDir)}::${clipNumber}`;

    const prevLock = activeBrollRerenderLocks.get(lockKey);
    if (prevLock) {
      try {
        await prevLock;
      } catch {}
    }

    const taskPromise = (async () => {
      const paddedNum = String(clipNumber).padStart(2, '0');
      const prefix = `${paddedNum}_`;

      // 1. Locate archived high-res source image, or rescue frame 0 from existing video on disk
      let sourceImgInfo = findArchivedBrollSourceImage(clipsDir, clipNumber);
      let existingVideoOnDisk = '';
      if (fs.existsSync(clipsDir)) {
        for (const entry of fs.readdirSync(clipsDir)) {
          if (/\.(mp4|mov|webm)$/i.test(entry) && entry.startsWith(prefix)) {
            existingVideoOnDisk = path.join(clipsDir, entry);
            break;
          }
        }
      }

      if (!sourceImgInfo && existingVideoOnDisk && fs.existsSync(existingVideoOnDisk)) {
        const rescuePng = path.join(
          os.tmpdir(),
          `huellas_broll_rescue_${paddedNum}_${Date.now()}.png`
        );
        try {
          const ffmpegBin = resolveFfmpegBin();
          await new Promise<void>((resolve, reject) => {
            const proc = spawn(
              ffmpegBin,
              ['-nostdin', '-y', '-i', existingVideoOnDisk, '-frames:v', '1', rescuePng],
              { stdio: 'ignore' }
            );
            proc.on('error', reject);
            proc.on('close', (code) => (code === 0 ? resolve() : reject(new Error(String(code)))));
          });
          if (fs.existsSync(rescuePng) && fs.statSync(rescuePng).size > 5000) {
            const baseForRescue = buildBrollSixWordBaseName(
              clipNumber,
              imagePrompt,
              currentFileName || path.basename(existingVideoOnDisk)
            );
            const archivedPath = archiveBrollSourceImage(clipsDir, clipNumber, rescuePng, {
              motion,
              durationSec,
              aspectRatio,
              baseName: baseForRescue,
            });
            sourceImgInfo = { imagePath: archivedPath };
          }
        } finally {
          try {
            if (fs.existsSync(rescuePng)) fs.unlinkSync(rescuePng);
          } catch {}
        }
      }

      if (!sourceImgInfo || !fs.existsSync(sourceImgInfo.imagePath)) {
        throw new Error(
          `No se encontró la imagen fuente de la Escena B-Roll ${paddedNum} en _broll_sources ni en 05_Clips_Video.`
        );
      }

      const canonicalBase =
        sourceImgInfo.meta?.baseName ||
        buildBrollSixWordBaseName(
          clipNumber,
          imagePrompt,
          currentFileName || (existingVideoOnDisk ? path.basename(existingVideoOnDisk) : '')
        );

      archiveBrollSourceImage(clipsDir, clipNumber, sourceImgInfo.imagePath, {
        motion,
        durationSec,
        aspectRatio,
        baseName: canonicalBase,
      });

      const finalBrollName = `${canonicalBase}_Broll_4K.mp4`;
      const finalBrollFull = path.join(clipsDir, finalBrollName);
      const tmpBrollFull = path.join(
        os.tmpdir(),
        `huellas_rerender_broll_${canonicalBase}_${Date.now()}_${Math.random().toString(36).slice(2, 5)}.mp4`
      );

      try {
        await renderStaticBrollImageTo4K60OnDisk(
          sourceImgInfo.imagePath,
          tmpBrollFull,
          motion,
          durationSec,
          aspectRatio
        );
        fs.copyFileSync(tmpBrollFull, finalBrollFull);
        try {
          execSync(`chflags nohidden "${finalBrollFull.replace(/"/g, '\\"')}"`, { stdio: 'ignore' });
        } catch {}
      } finally {
        try {
          if (fs.existsSync(tmpBrollFull)) fs.unlinkSync(tmpBrollFull);
        } catch {}
      }

      // Remove older video variants and clear stale optical-flow / foley caches for this clip
      for (const existing of fs.readdirSync(clipsDir)) {
        const fullExisting = path.join(clipsDir, existing);
        if (
          path.resolve(fullExisting) !== path.resolve(finalBrollFull) &&
          /\.(mp4|mov|webm)$/i.test(existing) &&
          existing.startsWith(prefix)
        ) {
          try {
            fs.unlinkSync(fullExisting);
          } catch {}
        }
      }
      for (const subCache of ['.optical_flow_cache', '.foley_only_cache']) {
        const cacheDir = path.join(clipsDir, subCache);
        if (fs.existsSync(cacheDir) && fs.statSync(cacheDir).isDirectory()) {
          for (const cFile of fs.readdirSync(cacheDir)) {
            if (cFile.startsWith(prefix)) {
              try {
                fs.unlinkSync(path.join(cacheDir, cFile));
              } catch {}
            }
          }
        }
      }

      // Persist updated brollCameraMotion & tag in documentaries.json if docId was supplied
      if (docId && fs.existsSync(DOCS_FILE)) {
        try {
          const allDocs = JSON.parse(fs.readFileSync(DOCS_FILE, 'utf8'));
          if (Array.isArray(allDocs)) {
            const tagMap: Record<ServerBrollCameraMotion, string> = {
              zoom_in: 'STATIC_ZOOM_IN',
              zoom_out: 'STATIC_ZOOM_OUT',
              pan_right: 'STATIC_PAN_RIGHT',
              pan_left: 'STATIC_PAN_LEFT',
              tilt_up: 'STATIC_TILT_UP',
              tilt_down: 'STATIC_TILT_DOWN',
            };
            const nextTag = `[B-Roll: ${tagMap[motion]}]`;
            let changedDb = false;
            for (const d of allDocs) {
              if (d && d.id === docId && Array.isArray(d.clips)) {
                for (const c of d.clips) {
                  if (Number(c?.clipNumber) === clipNumber) {
                    c.isStaticBroll = true;
                    c.brollCameraMotion = motion;
                    c.videoPrompt = '';
                    c.videoSavedFileName = finalBrollName;
                    if (typeof c.imagePrompt === 'string' && /\[B-Roll\s*:\s*STATIC_[A-Z_]+\]/i.test(c.imagePrompt)) {
                      c.imagePrompt = c.imagePrompt.replace(/\[B-Roll\s*:\s*STATIC_[A-Z_]+\]/gi, nextTag);
                    }
                    changedDb = true;
                  }
                }
                if (changedDb && typeof d.rawClipsText === 'string') {
                  d.rawClipsText = d.rawClipsText.replace(
                    new RegExp(`(^|\\n)(Image\\s+0*${clipNumber}\\b[^\\n]*?)\\[B-Roll\\s*:\\s*STATIC_[A-Z_]+\\]`, 'i'),
                    `$1$2${nextTag}`
                  );
                }
              }
            }
            if (changedDb) {
              fs.writeFileSync(DOCS_FILE, JSON.stringify(allDocs, null, 2), 'utf8');
              const docsMirrorPath = path.join(process.cwd(), 'docs', 'data', 'documentaries.json');
              if (fs.existsSync(path.dirname(docsMirrorPath))) {
                fs.writeFileSync(docsMirrorPath, JSON.stringify(allDocs, null, 2), 'utf8');
              }
            }
          }
        } catch {}
      }

      const st = fs.statSync(finalBrollFull);
      return {
        clipNumber,
        motion,
        fileName: finalBrollName,
        url: `/api/flow/serve-folder-file?filePath=${encodeURIComponent(finalBrollFull)}&v=${Math.floor(st.mtimeMs)}&t=${Date.now()}`,
      };
    })();

    activeBrollRerenderLocks.set(lockKey, taskPromise);
    try {
      const out = await taskPromise;
      res.json({ ok: true, ...out });
    } finally {
      if (activeBrollRerenderLocks.get(lockKey) === taskPromise) {
        activeBrollRerenderLocks.delete(lockKey);
      }
    }
  } catch (err: any) {
    res.status(500).json({
      ok: false,
      error: err?.message || 'Error al re-renderizar movimiento B-Roll en 4K 60fps.',
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
    const promptText = `Act as Lead Historian and Editorial Director for the Spanish-language historical documentary channel "Huellas de la Humanidad".
Published Documentary Context:
- Title / Topic: ${doc.publishTitle || doc.topic || doc.title || 'Historical Documentary'}
- Era & Location: ${doc.historicalTime || ''} | ${doc.historicalLocation || ''}
- Reference Summary / Script:
"""
${(doc.voiceoverScript || doc.sectionsStructure || doc.publishDescription || '').slice(0, 3500)}
"""

${commentText ? `Audience comment(s) submitted as text:\n"""\n${commentText}\n"""\n` : ''}
${customInstruction ? `Additional Director Focus / Instruction: ${customInstruction}\n` : ''}

YOUR TASK & CRITICAL OUTPUT LANGUAGE REQUIREMENT (STAGE 12 POST-PRODUCTION — CONCISE, HISTORICALLY RIGOROUS REPLIES IN NEUTRAL SPANISH):
1. If a screenshot was attached, faithfully transcribe every visible audience comment (including @username if shown). If text was provided, use it directly.
2. For each comment (whether historical question, debate, correction, skepticism, or praise), write IN NEUTRAL SPANISH:
   - "replyConcise": A **sharp, historically rigorous, and concise Spanish reply** (1 to 3 sentences max, straight to the point, warm scholarly authority, contributing a verified historical fact from the episode or clarifying the viewer's question with surgical precision).
   - "replyAlternative": A second brief Spanish reply option closing with a subtle thought-provoking question to spark thread engagement.
   - "historicalContextNote": A very short Spanish internal note for the creator confirming the exact historical fact referenced.
3. MANDATORY BRAND FORMATTING RULES FOR ALL SPANISH REPLIES:
   - Years always in numeric digits (e.g., 1888, 1943).
   - Centuries and numbered monarchs/popes/emperors in Roman numerals (e.g., siglo XIX, Felipe II, Luis XIV).
   - Thousands written as digits followed by the Spanish word "mil" (e.g., 70 mil).
   - ZERO exclamation marks (¡!) anywhere in the replies.

Return EXCLUSIVELY a valid JSON object with this structure:
{
  "replies": [
    {
      "author": "@username or Audience",
      "commentText": "Exact transcribed audience comment",
      "replyConcise": "Primary concise Spanish reply (1-3 sentences, zero exclamation marks)",
      "replyAlternative": "Alternative brief Spanish reply with engagement question (zero exclamation marks)",
      "historicalContextNote": "Supporting historical fact in Spanish"
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
  maxPages: number = 2,
  includeMetadata: boolean = false
): Promise<{
  videoId: string;
  title: string;
  description: string;
  tags: string[];
  channelName: string;
  comments: YoutubeExtractedComment[];
}> {
  const innertubeUrl = 'https://www.youtube.com/youtubei/v1/next?prettyPrint=false';
  const playerUrl = 'https://www.youtube.com/youtubei/v1/player?prettyPrint=false';
  const userAgent =
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36';
  const clientContext = {
    client: {
      clientName: 'WEB',
      clientVersion: '2.20240501.00.00',
      hl: 'es',
      gl: 'ES',
    },
  };

  let extractedTitle = '';
  let extractedDescription = '';
  let extractedChannelName = '';
  const tagsSet = new Set<string>();

  const addTagsFromList = (items: any[]) => {
    for (const raw of items || []) {
      const cleaned = String(raw || '').trim();
      if (cleaned && cleaned.length >= 2 && cleaned.length <= 90) {
        tagsSet.add(cleaned);
      }
    }
  };

  try {
    if (includeMetadata) {
      // 1) Try YouTube Innertube Player endpoint + public Watch page in parallel for full Title, Description, and Keywords/Tags
      const [playerRes, watchRes] = await Promise.all([
        fetch(playerUrl, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'User-Agent': userAgent,
          },
          body: JSON.stringify({ context: clientContext, videoId }),
        }).catch(() => null),
        fetch(`https://www.youtube.com/watch?v=${encodeURIComponent(videoId)}`, {
          headers: {
            'User-Agent': userAgent,
            'Accept-Language': 'es-ES,es;q=0.9,en;q=0.8',
          },
        }).catch(() => null),
      ]);

      if (playerRes && playerRes.ok) {
        try {
          const jPlayer: any = await playerRes.json();
          const vd = jPlayer?.videoDetails || {};
          const mf = jPlayer?.microformat?.playerMicroformatRenderer || {};
          if (vd.title) extractedTitle = String(vd.title).trim();
          if (vd.shortDescription) extractedDescription = String(vd.shortDescription).trim();
          if (!extractedDescription && mf.description?.simpleText) {
            extractedDescription = String(mf.description.simpleText).trim();
          }
          if (vd.author) extractedChannelName = String(vd.author).trim();
          if (!extractedChannelName && mf.ownerChannelName) {
            extractedChannelName = String(mf.ownerChannelName).trim();
          }
          if (Array.isArray(vd.keywords)) {
            addTagsFromList(vd.keywords);
          }
        } catch {}
      }

      if (watchRes && watchRes.ok) {
        try {
          const html = await watchRes.text();
          const playerMatch = html.match(/var ytInitialPlayerResponse\s*=\s*(\{.*?\});\s*(?:var|<\/script>)/s);
          if (playerMatch && playerMatch[1]) {
            try {
              const parsedPlayer = JSON.parse(playerMatch[1]);
              const vd = parsedPlayer?.videoDetails || {};
              const mf = parsedPlayer?.microformat?.playerMicroformatRenderer || {};
              if (!extractedTitle && vd.title) extractedTitle = String(vd.title).trim();
              if (!extractedDescription && vd.shortDescription) {
                extractedDescription = String(vd.shortDescription).trim();
              }
              if (!extractedDescription && mf.description?.simpleText) {
                extractedDescription = String(mf.description.simpleText).trim();
              }
              if (!extractedChannelName && vd.author) {
                extractedChannelName = String(vd.author).trim();
              }
              if (Array.isArray(vd.keywords)) {
                addTagsFromList(vd.keywords);
              }
            } catch {}
          }
          if (!extractedDescription) {
            const descMatch = html.match(/"shortDescription":"((?:\\.|[^"\\])*)"/);
            if (descMatch && descMatch[1]) {
              try {
                extractedDescription = JSON.parse(`"${descMatch[1]}"`).trim();
              } catch {
                extractedDescription = descMatch[1].replace(/\\n/g, '\n').trim();
              }
            }
          }
          if (tagsSet.size === 0) {
            const kwMatch = html.match(/"keywords":\[(.*?)\]/);
            if (kwMatch && kwMatch[1]) {
              try {
                const parsedKw = JSON.parse(`[${kwMatch[1]}]`);
                if (Array.isArray(parsedKw)) addTagsFromList(parsedKw);
              } catch {}
            }
            const metaKwMatch = html.match(/<meta\s+name="keywords"\s+content="([^"]*)"/i);
            if (metaKwMatch && metaKwMatch[1]) {
              addTagsFromList(
                metaKwMatch[1]
                  .split(',')
                  .map((s) => s.replace(/&quot;/g, '"').replace(/&#39;/g, "'").trim())
              );
            }
          }
          if (!extractedTitle) {
            const metaTitleMatch = html.match(/<meta\s+name="title"\s+content="([^"]*)"/i);
            if (metaTitleMatch && metaTitleMatch[1]) {
              extractedTitle = metaTitleMatch[1]
                .replace(/&quot;/g, '"')
                .replace(/&#39;/g, "'")
                .replace(/&amp;/g, '&')
                .trim();
            }
          }
        } catch {}
      }
    }

    const res1 = await fetch(innertubeUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'User-Agent': userAgent,
      },
      body: JSON.stringify({ context: clientContext, videoId }),
    });
    if (!res1.ok) {
      return {
        videoId,
        title: extractedTitle || videoId,
        description: extractedDescription,
        tags: Array.from(tagsSet),
        channelName: extractedChannelName,
        comments: [],
      };
    }
    const j1: any = await res1.json();
    const s1 = JSON.stringify(j1);
    const titleMatch = s1.match(/"title":\{"runs":\[\{"text":"([^"]+)"\}\]/);
    const title = extractedTitle || (titleMatch ? titleMatch[1] : videoId);

    // Also inspect j1 (next response) for description and channel owner if not yet populated
    if (!extractedDescription || !extractedChannelName) {
      const walkMetadata = (node: any) => {
        if (!node || typeof node !== 'object') return;
        if (!extractedDescription && node.attributedDescription?.content) {
          extractedDescription = String(node.attributedDescription.content).trim();
        }
        if (!extractedDescription && node.description?.runs && Array.isArray(node.description.runs)) {
          const joined = node.description.runs.map((r: any) => r.text || '').join('').trim();
          if (joined.length > extractedDescription.length) extractedDescription = joined;
        }
        if (!extractedChannelName && node.videoOwnerRenderer?.title?.runs?.[0]?.text) {
          extractedChannelName = String(node.videoOwnerRenderer.title.runs[0].text).trim();
        }
        for (const k of Object.keys(node)) walkMetadata(node[k]);
      };
      walkMetadata(j1);
    }

    // Extract any #hashtags from title and description into tagsSet as well
    const combinedTextForHashtags = `${title}\n${extractedDescription}`;
    for (const hm of combinedTextForHashtags.matchAll(/#([a-zA-Z0-9áéíóúÁÉÍÓÚñÑüÜ_]{2,50})/g)) {
      if (hm[1]) tagsSet.add(`#${hm[1]}`);
    }

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
      return {
        videoId,
        title,
        description: extractedDescription,
        tags: Array.from(tagsSet),
        channelName: extractedChannelName,
        comments: [],
      };
    }

    const collected: YoutubeExtractedComment[] = [];
    const seenTexts = new Set<string>();
    let nextToken: string | undefined = initialTokens[0];

    for (let page = 0; page < maxPages && nextToken; page++) {
      const resPage = await fetch(innertubeUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'User-Agent': userAgent,
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

    return {
      videoId,
      title,
      description: extractedDescription,
      tags: Array.from(tagsSet),
      channelName: extractedChannelName,
      comments: collected,
    };
  } catch {
    return {
      videoId,
      title: extractedTitle || videoId,
      description: extractedDescription,
      tags: Array.from(tagsSet),
      channelName: extractedChannelName,
      comments: [],
    };
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
  description?: string;
  tags?: string[];
  analyzedAt: string;
  commentsCount: number;
  structureSummary: string;
  structuralBlocks: AnalyzedVideoStructuralBlock[];
  comments: DeduplicatedAudienceComment[];
}

const ANALYZED_VIDEOS_LIBRARY_FILE = path.join(DATA_DIR, 'analyzed_videos_library.json');

const DEFAULT_ANALYZED_VIDEOS_SEED: AnalyzedVideoLibraryEntry[] = [
  {
    id: 'vid_clqshy5NB7I',
    videoId: 'clqshy5NB7I',
    url: 'https://youtu.be/clqshy5NB7I',
    title: '1880: La Épica Llegada de los Italianos que Transformaron Argentina (Reconstrucción con IA)',
    channelName: 'Reimaginando Pasados',
    description: `1880: La Épica Llegada de los Italianos que Transformaron Argentina (Reconstrucción con IA)

Descubre la fascinante historia de cómo más de 2 millones de italianos transformaron Argentina entre 1870 y 1914 en la mayor ola migratoria de la historia del país. Este documental te transporta desde los pueblos empobrecidos del sur de Italia hasta los conventillos de Buenos Aires, revelando el increíble viaje transatlántico que cambió dos naciones para siempre.
Conoce las verdaderas condiciones de las travesías en barco, la dureza de los primeros años en tierra argentina, y cómo estos inmigrantes construyeron con sus manos la Argentina moderna. Desde La Boca hasta las colonias agrícolas de Santa Fe, desde los frigoríficos de Avellaneda hasta las panaderías que aún perfuman nuestras calles, esta es la historia del coraje, el sacrificio y la resiliencia.
Explora cómo el idioma, la comida, el fútbol y la identidad argentina fueron moldeados por esta inmigración masiva. Entérate por qué hoy más del 60% de los argentinos tienen ascendencia italiana y cómo esa herencia sigue viva en cada rincón del país. Una reconstrucción histórica con IA que te hará revivir una época que definió quiénes somos hoy.`,
    tags: [
      'inmigración italiana argentina',
      'historia argentina',
      'italianos en argentina',
      'inmigración europea',
      'Buenos Aires 1880',
      'La Boca historia',
      'conventillos argentinos',
      'viaje transatlántico',
      'Hotel de Inmigrantes',
      'colonias agrícolas argentina',
      'influencia italiana argentina',
      'cocina italiana argentina',
      'lunfardo origen',
      'movimiento obrero argentina',
      'ascendencia italiana',
      'historia argentina siglo XIX',
    ],
    analyzedAt: new Date().toISOString(),
    commentsCount: 84,
    structureSummary: `1. DECONSTRUCCIÓN DEL HOOK Y PARADOJA CENTRAL (00:00 - 00:30):
   - Arranca con el Intro Oficial (8s, 00:00 - 00:08) seguido del Clip 1 (6s con fade-in visual y Foley puro en el muelle de piedra húmeda de Maliaño, Santander, 1885). En el segundo 16 entra la voz narrativa con Año y Lugar cerrados con punto ("Año 1885, muelle de Maliaño, Santander, España."), planteando la contradicción central del éxodo: para escapar de la servidumbre agraria del minifundio y de las 2.000 pesetas de la redención militar a Ultramar («impuesto de sangre»), una generación de adolescentes de 14 a 18 años se entregó voluntariamente a un régimen de servidumbre laboral intrafamiliar de 16 horas diarias al otro lado del océano. Antes del segundo 30 cierra con el Slogan Oficial sobre la mesa del historiador antiguo.

2. RADIOGRAFÍA ESTRUCTURAL BLOQUE POR BLOQUE (ESCALETA NARRATIVA Y TÉCNICA DE 10 MINUTOS):
   - Bloque I (00:00 – 01:45 | 18%) — La Piedra, el Humo y la Quinta (Escenario A, c. 1885):
     Interior en penumbra de una aldea de Asturias/Galicia (Lué, Colunga); humo de la lareira, lluvia (orbayu) sobre pizarra, claqueteo seco de madreñas de tres tacos y minifundios donde el 83,5% de las parcelas no alcanza media hectárea. El dilema matemático implacable: un jornal agrícola estancado en 1,00–1,50 pesetas diarias (Instituto de Reformas Sociales, 1904–1909) frente al billete de tercera clase de 205–235 pesetas (135 a 200 días íntegros de trabajo) y las 1.500–2.000 pesetas de la redención militar en metálico para librarse de las guerras de Ultramar (Ley de Reclutamiento de 11 de julio de 1885 e ilustración «A Cuba, por no tener seis mil reales»).
   - Bloque II (01:45 – 03:30 | 18%) — El Entrepuente de Hierro y las Cartas de Llamada (Escenario B, c. 1895–1910):
     Muelles de La Coruña (480.000–520.000 pasajeros), Vigo (410.000–450.000), Santander (140.000–165.000), Santa Cruz de Tenerife/Las Palmas (160.000–190.000), Gijón/El Musel (95.000–115.000) y Cádiz (85.000–110.000). Estadísticas del Instituto Geográfico y Estadístico y Consejo Superior de Emigración: 5.009.756 salidas hacia América entre 1860 y 1988 (2.747.290 retornos; saldo neto 2.053.929) y 3.297.312 salidas entre 1882 y 1930, de las cuales Cuba absorbió 1.118.968 (33,93%), tras Argentina (1.594.822, 48,36%) y por delante de Brasil (233.432, 7,07%) y México/Puerto Rico/Venezuela (268.740, 8,15%), más un 25% de emigración clandestina y 146.683 soldados españoles no retornados tras 1898. Descenso a las literas de hierro galvanizado de tres niveles bajo la línea de flotación en los vapores de la Compañía Trasatlántica Española y Pinillos; cartas de llamada y Ley de Emigración de 1907.
   - Bloque III (03:30 – 05:30 | 20%) — El Embudo Sanitario: Triscornia (La Habana) y San Juan de Ulúa (Veracruz) (Escenario C, c. 1900–1920):
     Choque violento de luz tropical cegadora en la bahía de La Habana y el Lazareto de San Juan de Ulúa en Veracruz (inaugurado el 20 de junio de 1894 contra el «vómito negro» tras la epidemia de 1889). El Dr. Frank E. Menocal (39 años en 1905, Comisionado de Inmigración y compadre del presidente Mario García Menocal) inspeccionando el tracoma invirtiendo los párpados con varilla de vidrio en el Campamento de Triscornia (fundado en noviembre de 1900; desbordado en 1905–1906 con 1.800 españoles para 800 camas tras arribar 10.230 en tres meses). Autoclaves de vapor de la Brigada de Desinfección, denuncias del Dr. Pedro Becerra en el Diario de la Marina (8/09/1903: «La oficina de Triscornia es campamento de facturas de inmigrantes»), intento de suicidio de José Linares Moré, fugas hacia Casablanca y la carta real del joven asturiano Ricardo Ruiz Balbín (18 años) escrita el 13 de diciembre de 1920 desde Ciego de Ávila a su madre Bernarda en Lué (Colunga).
   - Bloque IV (05:30 – 07:45 | 22%) — La Esclavitud del Mostrador, el Horno y la Comandita (Escenario D, c. 1910–1925):
     Interior de un almacén de abarrotes con panadería en Ciudad de México y Puebla (El Águila de Oro) y una bodega esquinera en La Habana. Régimen cuasi monástico de los «dependientes»: jornadas de 16 horas (de 5:00 AM a 10:00 PM), prohibición estricta de casarse, dormir sobre el mostrador de madera/zinc o sobre los sacos de harina y frijol en la trastienda, sueldo retenido sin efectivo en una «cuenta corriente» de los libros mayores y paso tras 8–12 años a socio industrial («habilitación» en sociedad en comandita). Contraste con los grandes sanatorios mutualistas (Quinta Covadonga del Centro Asturiano, La Benéfica del Centro Gallego, Beneficencia Española en México) y las escuelas de indianos que elevaron la alfabetización del norte al 80–89%.
   - Bloque V (07:45 – 10:00 | 22%) — Del Crac de 1929 al Vapor Sinaia y el Legado Presente + Outro Oficial (8s):
     El desplome azucarero de 1920–1921 y el Crac de 1929–1933: crónicas del Diario de la Marina (9 y 12 de junio de 1921 y julio de 1931) sobre indigentes hacinados en Triscornia, repatriaciones por limosna y el silencio de los fracasados que dejaron de escribir por vergüenza ante la aldea. Giro histórico el 13 de junio de 1939: atraca en Veracruz el vapor Sinaia con el exilio republicano y el poeta Pedro Garfias Zurita (38 años, sienes plateadas, boina negra, chamarra de pastor zamorano y gafas de concha). Cierre sobre el legado gastronómico (pan bolillo y telera en hornos de ladrillo, bodegas, sidra), arquitectónico y familiar presente + Outro Oficial de 8s.

3. FICHAS BIOGRÁFICAS DOCUMENTADAS (@PERSONAS) Y DISEÑO FOLEY DE ARCHIVO:
   - @Ricardo_Ruiz_Balbin (18 años, Lué, Colunga, Asturias, 1920): Traje de pana oscura y boina negra al embarcar; guayabera de dril blanco y alpargatas en Cuba.
   - @Dr_Frank_E_Menocal (39 años, Triscornia, La Habana, 1905): Uniforme blanco inmaculado de hilo almidonado con cuello alto y botones dorados, lentes de montura fina y varilla de vidrio para inspección de tracoma.
   - @Pedro_Garfias_Zurita (38 años, Vapor Sinaia, Veracruz, 13/06/1939): Sienes plateadas, gafas de concha, boina negra, traje oscuro gastado / chamarra de pastor zamorano y bastón de nudos.

4. GATILLOS PSICOLÓGICOS DE VIRALIDAD:
   - Aritmética de la Supervivencia (1,50 pesetas de jornal vs. 205 pesetas de pasaje vs. 2.000 pesetas para no morir en la guerra) + Desmitificación del «Indiano Rico» (jóvenes durmiendo 10 años sobre el mostrador) + Activación de Memoria Genealógica Hispanoamericana en comentarios.

5. ANÁLISIS DE TÍTULO, DESCRIPCIÓN Y TAGS SEO DEL VIDEO (1880: La Épica Llegada de los Italianos que Transformaron Argentina):
   - Gancho del Título: Año concreto (1880) + magnitud humana ("La Épica Llegada de los Italianos") + impacto presente ("que Transformaron Argentina").
   - Estructura de la Descripción: Recorrido en 3 bloques (pueblos de origen -> travesía transatlántica y arribo al Hotel de Inmigrantes/conventillos -> oficios, panaderías, colonias agrícolas y herencia cultural en el 60% de la población).
   - Tags / Palabras Clave SEO (16): inmigración italiana argentina, historia argentina, italianos en argentina, inmigración europea, Buenos Aires 1880, La Boca historia, conventillos argentinos, viaje transatlántico, Hotel de Inmigrantes, colonias agrícolas argentina, influencia italiana argentina, cocina italiana argentina, lunfardo origen, movimiento obrero argentina, ascendencia italiana, historia argentina siglo XIX.`,
    structuralBlocks: [
      { name: 'Intro (8s) + Hook y Quinta (1885)', pct: 10, description: 'Muelle de Santander, jornal de 1,50 pesetas vs. 2.000 pesetas de redención militar y Slogan.' },
      { name: 'Acto I: La Piedra, el Humo y el Desarraigo', pct: 16, description: 'Aldeas de Asturias/Galicia, minifundios de <0,5 ha, Ley de Reclutamiento de 1885 y despedida.' },
      { name: 'Acto II: El Entrepuente de Hierro', pct: 18, description: 'Seis puertos de salida, 3,29 millones de emigrantes, literas de hierro y cartas de llamada.' },
      { name: 'Acto III: Triscornia y San Juan de Ulúa', pct: 20, description: 'Filtro sanitario del Dr. Menocal, autoclaves, tracoma y carta de Ricardo Ruiz Balbín (1920).' },
      { name: 'Acto IV: Esclavitud del Mostrador e Indianos', pct: 20, description: 'Jornadas de 16h, dormir sobre el mostrador, comandita vs. Quinta Covadonga y escuelas.' },
      { name: 'Acto V: Crac del 29, Vapor Sinaia + Outro (8s)', pct: 16, description: 'El silencio de los fracasados (1921/1931), arribo del Sinaia (1939), legado y Outro de 8s.' },
    ],
    comments: [
      {
        id: 'seed-v76-c1',
        text: '¿Por qué los jóvenes españoles preferían embarcarse casi adolescentes a los 14 o 16 años hacia Cuba y México antes de cumplir la edad del sorteo militar?',
        author: 'Comunidad YouTube',
        likes: 94,
        repeatCount: 14,
        category: 'question',
        sourceType: 'analyzed_video',
        videoTitle: 'La llegada de los italianos a Argentina',
        videoId: 'clqshy5NB7I',
      },
      {
        id: 'seed-v76-c2',
        text: 'Hagan un documental sobre qué pasó con los miles de emigrantes españoles que NO se hicieron ricos ("los indianos fracasados") tras el desplome azucarero de 1921 y el Crac de 1929.',
        author: 'Comunidad YouTube',
        likes: 82,
        repeatCount: 12,
        category: 'suggestion',
        sourceType: 'analyzed_video',
        videoTitle: 'La llegada de los italianos a Argentina',
        videoId: 'clqshy5NB7I',
      },
      {
        id: 'seed-v76-c3',
        text: '¿Cómo era realmente el campamento de cuarentena de Triscornia en La Habana y qué les hacían a los inmigrantes de tercera clase al bajar del barco?',
        author: 'Comunidad YouTube',
        likes: 76,
        repeatCount: 11,
        category: 'question',
        sourceType: 'analyzed_video',
        videoTitle: 'La llegada de los italianos a Argentina',
        videoId: 'clqshy5NB7I',
      },
      {
        id: 'seed-v76-c4',
        text: '¿Es verdad que los dependientes españoles en las bodegas de La Habana y tiendas de abarrotes y panaderías de México tenían prohibido casarse y dormían sobre el mostrador?',
        author: 'Comunidad YouTube',
        likes: 68,
        repeatCount: 9,
        category: 'question',
        sourceType: 'analyzed_video',
        videoTitle: 'La llegada de los italianos a Argentina',
        videoId: 'clqshy5NB7I',
      },
      {
        id: 'seed-v76-c5',
        text: 'Deberían contar la historia de los grandes hospitales y palacios que construyeron los inmigrantes con sus cuotas: la Quinta Covadonga, La Benéfica en La Habana y la Beneficencia Española en México.',
        author: 'Comunidad YouTube',
        likes: 59,
        repeatCount: 8,
        category: 'suggestion',
        sourceType: 'analyzed_video',
        videoTitle: 'La llegada de los italianos a Argentina',
        videoId: 'clqshy5NB7I',
      },
      {
        id: 'seed-v76-c6',
        text: 'Hagan la continuación sobre el viaje del vapor Sinaia a Veracruz en junio de 1939 y cómo los refugiados republicanos transformaron la ciencia y la cultura en México.',
        author: 'Comunidad YouTube',
        likes: 53,
        repeatCount: 7,
        category: 'suggestion',
        sourceType: 'analyzed_video',
        videoTitle: 'La llegada de los italianos a Argentina',
        videoId: 'clqshy5NB7I',
      },
      {
        id: 'seed-v76-c7',
        text: '¿Cómo funcionaban las "cartas de llamada" y las redes de emigración clandestina desde las rías de Galicia, Asturias y Canarias hacia América?',
        author: 'Comunidad YouTube',
        likes: 47,
        repeatCount: 6,
        category: 'question',
        sourceType: 'analyzed_video',
        videoTitle: 'La llegada de los italianos a Argentina',
        videoId: 'clqshy5NB7I',
      },
      {
        id: 'analyzed_video-1-mw0ureh5',
        text: 'Mi papá italiano decidió volver a Italia a los 75 años y me vine a Italia con él. En casa siempre hablamos italiano y conservamos tradiciones italianas. Crecí con las dos culturas, pero extraño mi patria argentina cada día. Emigrar es tener el corazón partido en dos. 🇦🇷❤️',
        author: '@alessandramagni2147',
        likes: 621,
        repeatCount: 3,
        category: 'comment',
        sourceType: 'analyzed_video',
        videoTitle: 'La llegada de los italianos a Argentina',
        videoId: 'clqshy5NB7I',
      },
      {
        id: 'analyzed_video-3-mw0ureh5',
        text: 'Mis abuelos vinieron de Italia en esos barcos.! Yo tengo 78 años. Tengo fotos de ellos y de bisabuelos también! Mi emociona este vídeo 😥y ahora sus bisnietos son exitosos!!! ❤️❤️❤️❤️🇦🇷🇦🇷🇦🇷',
        author: '@cristinadebernardi5811',
        likes: 282,
        repeatCount: 2,
        category: 'comment',
        sourceType: 'analyzed_video',
        videoTitle: 'La llegada de los italianos a Argentina',
        videoId: 'clqshy5NB7I',
      },
      {
        id: 'analyzed_video-8-mw0ureh5',
        text: 'Cuantas lágrimas salieron...hoy...yo vine con 8 años en el vapor FEDERICO .. Y ASÍ FUE EL VIAJE. GRACIAS😊',
        author: '@mariatenaglia8168',
        likes: 144,
        repeatCount: 2,
        category: 'comment',
        sourceType: 'analyzed_video',
        videoTitle: 'La llegada de los italianos a Argentina',
        videoId: 'clqshy5NB7I',
      },
    ],
  },
  {
    id: 'seed_louvre_medieval',
    videoId: 'louvre_medieval_p1',
    url: 'https://youtu.be/rJdAGfxEYkw',
    title: 'El Louvre en el año 1200: La fortaleza olvidada de París | Documental Completo',
    channelName: '@huellas_de_la_humanidad',
    description: `La imagen monumental del recinto contemporáneo suele eclipsar su origen como bastión puramente militar concebido a finales del siglo XII por orden del monarca Felipe Augusto. Levantada en la ribera derecha del río Sena para proteger la capital francesa frente a la amenaza anglonormanda antes de partir hacia las Cruzadas, esta estructura prescindió por completo de cualquier concesión al lujo cortesano. Con una imponente torre cilíndrica central de 30 metros de altura y lienzos de muralla de 4 metros de espesor en su base, la fortaleza funcionaba como un núcleo hermético donde las decisiones estratégicas de la Corona se custodiaban tras fosos perimetrales de agua estancada y pesadas rejas de hierro forjado. Los documentos administrativos de la época constatan que este baluarte no fue proyectado para albergar festines reales, sino para operar como arsenal de guerra, tesorería del reino y presidio fortificado en una era marcada por el conflicto territorial incesante.`,
    tags: [
      'arquitectura defensiva capeta',
      'torre del homenaje grosse tour',
      'muralla medieval filipina',
      'vida cotidiana edad media',
      'ingenieria militar siglo xiii',
      'guarnicion real francesa',
      'arqueologia subterranea parisina',
      'asedio castillos feudales',
      'abastecimiento fortalezas antiguas',
      'construccion gotica primitiva',
      'oficios medievales herreria canteria',
      'sanidad medieval europea',
      'cronica dinastia capeto',
      'vestimenta militar cota malla',
      'fortificaciones ribera sena',
      'historia oculta museos europeos',
    ],
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
   - "Lo oculto a plena vista": revelar que debajo de un lugar mundialmente conocido existe una estructura secreta que casi ningún turista comprende.
4. ANÁLISIS DE TÍTULO, DESCRIPCIÓN Y TAGS SEO DEL VIDEO (El Louvre en el año 1200: La fortaleza olvidada de París):
   - Gancho del Título: Monumento mundialmente famoso ("El Louvre") + fecha medieval exacta ("en el año 1200") + revelación oculta ("La fortaleza olvidada de París").
   - Estructura de la Descripción: Desmitificación militar bajo Felipe II Augusto, dimensiones exactas de la Grosse Tour (30m de altura, muros de 4m), arsenal/tesorería/presidio y logística intramuros.
   - Tags / Palabras Clave SEO (16): arquitectura defensiva capeta, torre del homenaje grosse tour, muralla medieval filipina, vida cotidiana edad media, ingenieria militar siglo xiii, guarnicion real francesa, arqueologia subterranea parisina, asedio castillos feudales, abastecimiento fortalezas antiguas, construccion gotica primitiva, oficios medievales herreria canteria, sanidad medieval europea, cronica dinastia capeto, vestimenta militar cota malla, fortificaciones ribera sena, historia oculta museos europeos.`,
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
    url: 'https://youtu.be/7oexZOHGQ8k',
    title: 'Así Era Vivir en la Corte Real del Siglo XIII: El Oscuro Precio de la Corona | Documental Completo',
    channelName: '@huellas_de_la_humanidad',
    description: `Detrás de las baladas caballerescas y los tapices bañados en oro de la Plena Edad Media se ocultaba una maquinaria diplomática implacable donde cada princesa de la alta nobleza europea carecía de soberanía sobre su propio destino. Desde que alcanzaban la juventud nupcial, las futuras consortes eran sometidas a exámenes físicos y médicos por embajadas extranjeras que evaluaban su constitución ósea, su dentadura y su equilibrio humoral antes de firmar capitulaciones matrimoniales y enviarlas en travesías sin retorno hacia cortes extrañas cuyo idioma desconocían. La vida cotidiana dentro de residencias regias como el Palais de la Cité o el castillo de Vincennes exigía una disciplina corporal extrema regulada por tratados médicos como el compendio salernitano de la Trotula y por las estrictas ordenanzas del guardarropa real.`,
    tags: [
      'princesas en la edad media',
      'vida de una princesa medieval',
      'trotula de salerno',
      'albayalde de plomo cerusa',
      'oropimente trisulfuro de arsenico',
      'ingeborg de dinamarca',
      'felipe ii augusto',
      'blanca de castilla regente',
      'leonor de aquitania',
      'torre real de etampes',
      'interdicto inocencio iii',
      'benedictio thalami boda medieval',
      'chambre des dames parto medieval',
      'cuentas guardarropa enrique iii',
      'pieles de vair y armino',
      'amor cortes midons',
      'chretien de troyes',
      'mateo paris chronica majora',
    ],
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
   - Empatía corporal + desmitificación sensorial: el espectador siente el frío, el peso de la ropa y el miedo real de una persona de carne y hueso en otra época.
4. ANÁLISIS DE TÍTULO, DESCRIPCIÓN Y TAGS SEO DEL VIDEO (Así Era Vivir en la Corte Real del Siglo XIII: El Oscuro Precio de la Corona):
   - Gancho del Título: Inmersión en primera persona ("Así Era Vivir en la Corte Real del Siglo XIII") + contraste oscuro ("El Oscuro Precio de la Corona").
   - Estructura de la Descripción: Contraste entre literatura caballeresca y archivos de cancillería (exámenes físicos de embajadas, cosmética tóxica con albayalde de plomo y oropimente según la Trotula de Salerno, encierro de Ingeborg de Dinamarca en Étampes y parto en la Chambre des Dames).
   - Tags / Palabras Clave SEO (18): princesas en la edad media, vida de una princesa medieval, trotula de salerno, albayalde de plomo cerusa, oropimente trisulfuro de arsenico, ingeborg de dinamarca, felipe ii augusto, blanca de castilla regente, leonor de aquitania, torre real de etampes, interdicto inocencio iii, benedictio thalami boda medieval, chambre des dames parto medieval, cuentas guardarropa enrique iii, pieles de vair y armino, amor cortes midons, chretien de troyes, mateo paris chronica majora.`,
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
    url: 'https://youtu.be/PPgK7kuznm0',
    title: 'Así Fue el Brutal Asedio de Antioquía en 1098: Hambre, Traición y Fe | Documental Completo',
    channelName: '@huellas_de_la_humanidad',
    description: `En junio de 1098, dentro de la Catedral de San Pedro en Antioquía, Siria, trece hombres encerrados bajo llave cavaban una fosa profunda en la penumbra buscando una reliquia que, según los registros imperiales de Constantinopla, ni siquiera debía encontrarse allí. Lo que había comenzado en noviembre de 1095 en los campos de Clermont, Francia, con la promesa papal de Urbano II y la marcha de 70 mil europeos hacia Oriente, acababa de transformarse en una trampa mortal donde los conquistadores quedaron sitiados dentro de su propia conquista frente a las 400 torres bizantinas del monte Silpio.`,
    tags: [
      'Primera Cruzada',
      'Pedro Bartolomé',
      'Lanza Sagrada',
      'Bohemundo de Tarento',
      'Raimundo de Tolosa',
      'Kerbogha de Mosul',
      'Yaghi-Siyan',
      'Ademar de Le Puy',
      'Urbano II',
      'Concilio de Clermont',
      'Catedral de San Pedro',
      'Monte Silpio',
      'Torre de las Dos Hermanas',
      'comandante Firuz',
      'Alejo I Comneno',
      'Esteban de Blois',
      'Godofredo de Bouillon',
      'Gesta Francorum',
      'Raimundo de Aguilers',
      'Alberto de Aquisgrán',
      'Ana Comnena',
      'caballería franca',
      'trepadores de cuerdas',
      'asedio de Arqa',
      'juicio de fuego',
    ],
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
   - Efecto Zeigarnik (bucles abiertos): cada acto resuelve una pista pero abre una pregunta mayor hasta el veredicto del último bloque.
4. ANÁLISIS DE TÍTULO, DESCRIPCIÓN Y TAGS SEO DEL VIDEO (Así Fue el Brutal Asedio de Antioquía en 1098: Hambre, Traición y Fe):
   - Gancho del Título: Suceso bélico extremo con año exacto ("Así Fue el Brutal Asedio de Antioquía en 1098") + tríada dramática ("Hambre, Traición y Fe").
   - Estructura de la Descripción: Apertura in media res en la Catedral de San Pedro (junio de 1098, excavación de la Lanza Sagrada por Pedro Bartolomé), retroceso al Concilio de Clermont (1095), traición de Firuz en la Torre de las Dos Hermanas y juicio de fuego en Arqa.
   - Tags / Palabras Clave SEO (25): Primera Cruzada, Pedro Bartolomé, Lanza Sagrada, Bohemundo de Tarento, Raimundo de Tolosa, Kerbogha de Mosul, Yaghi-Siyan, Ademar de Le Puy, Urbano II, Concilio de Clermont, Catedral de San Pedro, Monte Silpio, Torre de las Dos Hermanas, comandante Firuz, Alejo I Comneno, Esteban de Blois, Godofredo de Bouillon, Gesta Francorum, Raimundo de Aguilers, Alberto de Aquisgrán, Ana Comnena, caballería franca, trepadores de cuerdas, asedio de Arqa, juicio de fuego.`,
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
        const existingIds = new Set(
          parsed.flatMap((item: any) => [item?.id, item?.videoId].filter(Boolean))
        );
        const missingSeeds = DEFAULT_ANALYZED_VIDEOS_SEED.filter(
          (seed) => !existingIds.has(seed.id) && !existingIds.has(seed.videoId)
        );
        if (missingSeeds.length > 0) {
          const merged = [...missingSeeds, ...parsed];
          try {
            fs.writeFileSync(
              ANALYZED_VIDEOS_LIBRARY_FILE,
              JSON.stringify(merged, null, 2),
              'utf8'
            );
          } catch {}
          return merged;
        }
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
  const raw = JSON.stringify(list, null, 2);
  try {
    fs.writeFileSync(ANALYZED_VIDEOS_LIBRARY_FILE, raw, 'utf8');
  } catch {}
  try {
    const docsDataDir = path.join(process.cwd(), 'docs', 'data');
    if (fs.existsSync(docsDataDir)) {
      fs.writeFileSync(path.join(docsDataDir, 'analyzed_videos_library.json'), raw, 'utf8');
    }
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
      description: String(
        body.description !== undefined
          ? body.description
          : existingIdx >= 0
          ? library[existingIdx].description || ''
          : ''
      ).trim(),
      tags: Array.isArray(body.tags)
        ? body.tags.map(String).filter(Boolean)
        : existingIdx >= 0 && Array.isArray(library[existingIdx].tags)
        ? library[existingIdx].tags
        : [],
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
        ? fetchYoutubeVideoCommentsDataOnly(targetVideoId, 3, true)
        : Promise.resolve({
            videoId: '',
            title: '',
            description: '',
            tags: [] as string[],
            channelName: '',
            comments: [] as YoutubeExtractedComment[],
          }),
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

        const promptText = `Act as Lead Researcher and Content Strategist for the Spanish-language historical documentary channel "Huellas de la Humanidad" (${HUELLAS_OFFICIAL_CHANNEL_URL}).
We have extracted real audience comments from two sources:
1) TARGET YOUTUBE VIDEO TO ANALYZE (${videoUrl || 'Unspecified'} — Title: "${targetData.title || ''}"):
${sampleTarget || '(No public comments detected on this video)'}

2) COMMENTS ACROSS OUR OFFICIAL CHANNEL VIDEOS (${HUELLAS_OFFICIAL_CHANNEL_HANDLE} — ${channelData.videoCount} videos scanned):
${sampleChannel || '(No additional channel comments)'}

YOUR TASK:
Analyze all these audience comments looking specifically for:
- Historical questions, doubts, information gaps, or curiosities left by viewers in the comments.
- Topic requests, angles, historical figures, eras, or debates suggested by viewers.
- Concrete research directives that MUST be included inside our DEEP RESEARCH MASTER PROMPT so our documentary research answers those viewer questions with historical rigor and capitalizes on those audience suggestions.

Return EXCLUSIVELY a valid JSON object with this structure (write the extracted items in clear English so they integrate seamlessly into our English Deep Research prompt, while preserving Spanish proper nouns):
{
  "questionsDetected": [
    "Real audience question or historical doubt detected in comments"
  ],
  "suggestionsDetected": [
    "Real audience topic request, angle, or debate detected in comments"
  ],
  "researchPromptDirectives": [
    "Concrete research directive to embed inside the Deep Research Master Prompt"
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
      const resolvedTitle =
        targetData.title && targetData.title !== targetVideoId
          ? targetData.title
          : existingIdx >= 0
          ? library[existingIdx].title
          : `Video de YouTube (${targetVideoId})`;
      const resolvedChannel =
        targetData.channelName ||
        (existingIdx >= 0 ? library[existingIdx].channelName : 'YouTube Referencia Viral');
      const resolvedDescription =
        targetData.description ||
        (existingIdx >= 0 ? library[existingIdx].description || '' : '');
      const resolvedTags =
        targetData.tags && targetData.tags.length > 0
          ? targetData.tags
          : existingIdx >= 0 && Array.isArray(library[existingIdx].tags)
          ? library[existingIdx].tags || []
          : [];

      const extractedChapters = (resolvedDescription.match(/(?:^|\n)\s*\d{1,2}:\d{2}(?::\d{2})?\s+[^\n]+/g) || [])
        .map((s) => s.trim())
        .filter(Boolean);

      const defaultSummary = [
        `1. HOOK DECONSTRUCTION & TITLE PROMISE (00:00 - 00:30):`,
        `   - Analyzed Title: "${resolvedTitle}" (Channel: ${resolvedChannel}).`,
        `   - Narrative Promise & CTR Angle: Establishes the central historical conflict and documentary revelation right from the headline to lock in viewer retention during the first 30 seconds.`,
        ``,
        `2. BLOCK-BY-BLOCK STRUCTURAL BLUEPRINT & DESCRIPTION CHAPTERS:`,
        ...(extractedChapters.length > 0
          ? extractedChapters.map((ch) => `   - ${ch}`)
          : [
              `   - Block I (0% - 8%): Official Brand Intro (8s) + Visual/audio hook and central paradox.`,
              `   - Block II (8% - 28%): Historical context, era, setting, and origin of the conflict.`,
              `   - Block III (28% - 53%): Narrative escalation, archival evidence, and retention micro-hooks.`,
              `   - Block IV (53% - 75%): Central dramatic turning point and direct human consequences.`,
              `   - Block V (75% - 92%): Historical resolution, legacy, and connection to the present day.`,
              `   - Block VI (92% - 100%): Closing reflection, Channel Slogan, and Official Brand Outro (8s).`,
            ]),
        ``,
        `3. DEEP ANALYSIS OF VIDEO DESCRIPTION:`,
        resolvedDescription
          ? `   ${resolvedDescription.slice(0, 2200)}${resolvedDescription.length > 2200 ? '...' : ''}`
          : `   (No extended public description detected; prioritizing semantic breakdown of title and audience comments).`,
        ``,
        `4. SEO TAGS / KEYWORDS ANALYSIS (${resolvedTags.length}):`,
        resolvedTags.length > 0
          ? `   - Extracted Keywords: ${resolvedTags.join(', ')}`
          : `   - Core historical and geographical nouns extracted from "${resolvedTitle}".`,
        ``,
        `5. AUDIENCE COMMENT MINING, QUESTIONS & SUGGESTIONS (${targetViewerComments.length} comments scanned):`,
        ...(finalQuestions.slice(0, 5).map((q) => `   - Viewer Question: ${q}`)),
        ...(finalSuggestions.slice(0, 5).map((s) => `   - Viewer Suggestion/Debate: ${s}`)),
      ].join('\n');

      const entry: AnalyzedVideoLibraryEntry = {
        id: existingIdx >= 0 ? library[existingIdx].id : `vid_${targetVideoId}`,
        videoId: targetVideoId,
        url: videoUrl,
        title: resolvedTitle,
        channelName: resolvedChannel,
        description: resolvedDescription,
        tags: resolvedTags,
        analyzedAt: new Date().toISOString(),
        commentsCount: targetViewerComments.length,
        structureSummary:
          existingIdx >= 0 &&
          library[existingIdx].structureSummary &&
          !library[existingIdx].structureSummary.startsWith('Análisis de "')
            ? library[existingIdx].structureSummary
            : defaultSummary,
        structuralBlocks:
          existingIdx >= 0 && library[existingIdx].structuralBlocks?.length > 0
            ? library[existingIdx].structuralBlocks
            : [
                { name: 'Intro (8s) + Hook Viral', pct: 8, description: 'Apertura magnética en los primeros segundos y promesa narrativa.' },
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

    const metadataBlockLines: string[] = targetVideoId
      ? [
          `================================================================================`,
          `🏷️ VIRAL PATTERN ANALYSIS (TITLE, DESCRIPTION & TAGS) OF REFERENCE YOUTUBE VIDEO (${videoUrl || targetVideoId})`,
          `================================================================================`,
          `- ANALYZED VIDEO TITLE (USE STRICTLY AS A VIRAL PATTERN GUIDE — DO NOT DUPLICATE ITS TOPIC): "${targetData.title || videoUrl}"`,
          `- SOURCE CHANNEL: ${targetData.channelName || 'YouTube'}`,
          `- SEO TAGS / KEYWORDS OF ANALYZED VIDEO (${targetData.tags.length}): ${
            targetData.tags.length > 0
              ? targetData.tags.join(', ')
              : '(Extract search-intent patterns and tag psychology from the reference video)'
          }`,
          `- ANALYZED VIDEO DESCRIPTION:`,
          targetData.description
            ? targetData.description.slice(0, 3500)
            : '(No additional text description on the video)',
          ``,
          `-> MANDATORY DIRECTIVE (STRICTLY FORBIDDEN TO DUPLICATE THE ANALYZED VIDEO — USE ONLY AS VIRAL BLUEPRINT):`,
          `   • DO NOT duplicate the topic, brand, protagonist, or story of the analyzed video ("${targetData.title || videoUrl}").`,
          `   • Use it EXCLUSIVELY as a structural blueprint to extract the PATTERNS and RETENTION TRIGGERS that made it go viral on YouTube:`,
          `     1. From the TITLE: Deconstruct its click psychology, numeric contrast, or narrative paradox and apply that exact psychological formula to a 100% ORIGINAL historical topic for our channel.`,
          `     2. From the DESCRIPTION: Analyze its chapter/timestamp pacing and revelation cadence to use as a structural mold in our documentary.`,
          `     3. From the TAGS (${
            targetData.tags.length > 0
              ? targetData.tags.slice(0, 25).join(', ')
              : 'core concepts from title and description'
          }): Analyze the curiosity gap and audience search intent to carry that magnetism into our original story.`,
          ``,
        ]
      : [];

    const lines: string[] = [
      ...metadataBlockLines,
      `================================================================================`,
      `💬 REAL AUDIENCE COMMENT MINING (ANALYZED VIDEO + CHANNEL ${HUELLAS_OFFICIAL_CHANNEL_HANDLE})`,
      `================================================================================`,
      `- Analyzed reference video: ${targetData.title || videoUrl || 'General Channel'} (${targetViewerComments.length} comments scanned, grouped by frequency)`,
      `- Official channel scanned (${HUELLAS_OFFICIAL_CHANNEL_URL}): ${channelData.videoCount} videos reviewed (${channelData.comments.length} subscriber comments read)`,
      ``,
      `❓ VIEWER QUESTIONS, HISTORICAL DOUBTS & CURIOSITIES IN COMMENTS (WITH REPETITION FREQUENCY):`,
      ...(finalQuestions.length > 0
        ? finalQuestions.map((q, i) => `   ${i + 1}. ${q}`)
        : [
            `   - No literal question-mark comments detected; analyze audience reactions to anticipate their core historical questions around "${targetData.title || 'this topic'}".`,
          ]),
      ``,
      `💡 AUDIENCE TOPIC REQUESTS, SUGGESTIONS & DEBATES IN COMMENTS (WITH REPETITION FREQUENCY):`,
      ...(finalSuggestions.length > 0
        ? finalSuggestions.map((s, i) => `   ${i + 1}. ${s}`)
        : [
            `   - Deepen the human, everyday, and psychological details that spark the strongest conversation across ${HUELLAS_OFFICIAL_CHANNEL_HANDLE}.`,
          ]),
      ...(aiResearchDirectives.length > 0
        ? [
            ``,
            `🎯 MANDATORY RESEARCH ANGLES TO INCLUDE INSIDE THE DEEP RESEARCH PROMPT:`,
            ...aiResearchDirectives.map((d, i) => `   ${i + 1}. ${d}`),
          ]
        : []),
      ``,
      `-> UNBREAKABLE RULE ON THESE COMMENTS, TITLE, DESCRIPTION, AND TAGS:`,
      `   Mandatorily integrate the structural analysis of the Title, Description, Tags, and all viewer questions/suggestions from the reference video into our documentary Deep Research.`,
      `================================================================================`,
    ];

    const researchPromptBlock = lines.join('\n');

    res.json({
      ok: true,
      targetVideoId,
      targetVideoTitle: targetData.title || videoUrl,
      targetVideoDescription: targetData.description || '',
      targetVideoTags: targetData.tags || [],
      targetChannelName: targetData.channelName || '',
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
        const prefixRegex = new RegExp(`^(?:(?:clip|broll|b[\\-_]?roll|video)[_\\-\\s.]*)?0*${num}[_\\-\\s.]`, 'i');
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

    const ffmpegBin = getFfmpegPath();

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
    const bakedKey = `t${safeTrimStart.toFixed(2)}_${safeTrimEnd.toFixed(2)}_d${effectiveTargetDur.toFixed(2)}_of${useOpticalFlow ? 3 : 0}`;
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
    // Always preserve native 16:9 widescreen frame in Optical Flow cache so 9:16 Auto-Reframe & dynamic pan work edge-to-edge without black bars
    const ptsFactor = ((effectiveTargetDur + 0.12) / realSpan).toFixed(5);
    const outW = 1920;
    const outH = 1080;
    const motionEstW = 854;
    const motionEstH = 480;

    const inputTrimArgs: string[] = [];
    if (safeTrimStart > 0.01) {
      inputTrimArgs.push('-ss', safeTrimStart.toFixed(3));
    }
    if (safeTrimEnd > safeTrimStart + 0.05) {
      inputTrimArgs.push('-to', safeTrimEnd.toFixed(3));
    }

    const afFilter = await buildSmartNaturalFoleyFilter({
      ffmpegBin,
      sourceMp4,
      trimStartSec: safeTrimStart,
      sourceSpanSec: realSpan,
      targetDurSec: effectiveTargetDur,
      rawSpeed: safeSpeed,
      foleyVol: 1.0,
      isIntroOrOutro: false,
    });

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
        const prefixRegex = new RegExp(`^(?:(?:clip|broll|b[\\-_]?roll|video)[_\\-\\s.]*)?0*${num}[_\\-\\s.]`, 'i');
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

    const ffmpegBin = getFfmpegPath();
    const inputTrimArgs: string[] = [];
    if (safeTrimStart > 0.01) {
      inputTrimArgs.push('-ss', safeTrimStart.toFixed(3));
    }
    if (safeTrimEnd > safeTrimStart + 0.05) {
      inputTrimArgs.push('-to', safeTrimEnd.toFixed(3));
    }

    const buildAtempoChain = (spd: number): string => {
      const rem = Math.max(0.88, Math.min(1.25, spd));
      if (Math.abs(rem - 1) < 0.02) return '';
      return `atempo=${rem.toFixed(3)}`;
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
        const prefixRegex = new RegExp(`^(?:(?:clip|broll|b[\\-_]?roll|video)[_\\-\\s.]*)?0*${num}[_\\-\\s.]`, 'i');
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

    const ffmpegBin = getFfmpegPath();
    const inputTrimArgs: string[] = [];
    if (safeTrimStart > 0.01) {
      inputTrimArgs.push('-ss', safeTrimStart.toFixed(3));
    }
    if (safeTrimEnd > safeTrimStart + 0.05) {
      inputTrimArgs.push('-to', safeTrimEnd.toFixed(3));
    }

    const buildAtempoChain = (spd: number): string => {
      const rem = Math.max(0.88, Math.min(1.25, spd));
      if (Math.abs(rem - 1) < 0.02) return '';
      return `atempo=${rem.toFixed(3)}`;
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
            if (bestR > 0.72 && bestLag > 0) {
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
        const isSpeech = transitions >= 12 && voicedFrac >= 0.28 && distinctPitches >= 4;
        const isMusic = voicedFrac >= 0.65 && distinctPitches >= 4;
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
        const prefixRegex = new RegExp(`^(?:(?:clip|broll|b[\\-_]?roll|video)[_\\-\\s.]*)?0*${num}[_\\-\\s.]`, 'i');
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

    const ffmpegBin = getFfmpegPath();
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
    // Use smooth, artifact-free linear biquad formant attenuation (NO nonlinear FFT afftfilt warbling/musical noise)
    const foleyMp4Path = path.join(cacheDir, `${baseKey}_foley_v3.mp4`);
    const isolateFoleyFilter = `equalizer=f=950:t=q:w=1.8:g=-6${detection.enableClause},equalizer=f=2400:t=q:w=1.8:g=-6${detection.enableClause}`;

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
          .replace(/_foley_(?:only|v2|v3)$/i, '');
        const foleyOptPath = path.join(path.dirname(rawOptPath), `${optBase}_foley_v3.mp4`);
        const optFilter = 'equalizer=f=950:t=q:w=1.8:g=-6,equalizer=f=2400:t=q:w=1.8:g=-6';
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

    const ffmpegBin = getFfmpegPath();
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

// ============================================================================
// VIRAL CLIPS STUDIO (OPUSCLIP ENGINE) + INSTAGRAM REELS/STORIES + AUTO-DM LINK
// ============================================================================
const VIRAL_CLIPS_DIR = path.join(DATA_DIR, 'viral-clips');
const VIRAL_UPLOADS_DIR = path.join(VIRAL_CLIPS_DIR, 'uploads');
const VIRAL_YOUTUBE_DIR = path.join(VIRAL_CLIPS_DIR, 'youtube');
const VIRAL_EXPORTS_DIR = path.join(VIRAL_CLIPS_DIR, 'exports');
const VIRAL_BIN_DIR = path.join(DATA_DIR, 'bin');
const VIRAL_STORE_FILE = path.join(DATA_DIR, 'viral_clips_store.json');

for (const d of [VIRAL_CLIPS_DIR, VIRAL_UPLOADS_DIR, VIRAL_YOUTUBE_DIR, VIRAL_EXPORTS_DIR, VIRAL_BIN_DIR]) {
  if (!fs.existsSync(d)) {
    fs.mkdirSync(d, { recursive: true });
  }
}

app.use('/viral-clips-media', express.static(VIRAL_CLIPS_DIR));

interface InstagramAutoDmRule {
  enabled: boolean;
  keyword: string; // e.g., "HUELLAS" or "VIDEO" or "LINK"
  matchAnyCommentAskingLink: boolean;
  destinationUrl: string; // e.g., YouTube documentary URL
  dmMessageTemplate: string; // e.g., "¡Hola {{username}}! 🙌 Aquí tienes el enlace directo para ver el documental completo en YouTube:\n\n🔗 {{url}}\n\n¡Gracias por apoyar a Huellas de la Humanidad!"
  publicCommentReply: string; // e.g., "¡Te acabo de enviar el link directo al documental por mensaje privado (DM)! 📩✨"
  enablePublicCommentReply: boolean;
}

interface InstagramConfigStore {
  igUserId: string;
  accessToken: string;
  accountUsername?: string;
  webhookVerifyToken: string;
  publicServerBaseUrl?: string;
  autoDm: InstagramAutoDmRule;
  sentDmLogs: Array<{
    id: string;
    recipientUsername: string;
    triggerType: 'comment' | 'story_reply';
    triggerText: string;
    sentUrl: string;
    mediaId?: string;
    sentAt: string;
    status: 'sent' | 'error';
    errorMsg?: string;
  }>;
  repliedTriggerIds: string[];
  publishedHistory: Array<{
    id: string;
    clipTitle: string;
    publishMode: 'reel' | 'story' | 'combo_reel_story';
    reelMediaId?: string;
    reelPermalink?: string;
    storyMediaId?: string;
    publishedAt: string;
  }>;
}

function loadViralStore(): InstagramConfigStore {
  const defaults: InstagramConfigStore = {
    igUserId: process.env.INSTAGRAM_USER_ID || '',
    accessToken: process.env.INSTAGRAM_ACCESS_TOKEN || '',
    accountUsername: '',
    webhookVerifyToken: 'huellas_ig_verify_2026',
    publicServerBaseUrl: process.env.PUBLIC_SERVER_URL || '',
    autoDm: {
      enabled: true,
      keyword: 'HUELLAS',
      matchAnyCommentAskingLink: true,
      destinationUrl: 'https://www.youtube.com/@HuellasdelaHumanidad',
      dmMessageTemplate:
        '¡Hola @{{username}}! 🙌 Aquí tienes el link directo para ver el documental completo en alta definición:\n\n🔗 {{url}}\n\n¡Gracias por ver Huellas de la Humanidad!',
      publicCommentReply:
        '¡Te acabo de enviar el link directo al documental completo por mensaje privado (DM)! 📩✨',
      enablePublicCommentReply: true,
    },
    sentDmLogs: [],
    repliedTriggerIds: [],
    publishedHistory: [],
  };
  try {
    if (fs.existsSync(VIRAL_STORE_FILE)) {
      const parsed = JSON.parse(fs.readFileSync(VIRAL_STORE_FILE, 'utf8'));
      return {
        ...defaults,
        ...parsed,
        autoDm: { ...defaults.autoDm, ...(parsed.autoDm || {}) },
        sentDmLogs: Array.isArray(parsed.sentDmLogs) ? parsed.sentDmLogs.slice(0, 200) : [],
        repliedTriggerIds: Array.isArray(parsed.repliedTriggerIds)
          ? parsed.repliedTriggerIds.slice(-1000)
          : [],
        publishedHistory: Array.isArray(parsed.publishedHistory)
          ? parsed.publishedHistory.slice(0, 100)
          : [],
      };
    }
  } catch (e) {
    console.warn('[ViralStore] Could not read viral_clips_store.json:', e);
  }
  return defaults;
}

function saveViralStore(store: InstagramConfigStore) {
  try {
    fs.writeFileSync(VIRAL_STORE_FILE, JSON.stringify(store, null, 2), 'utf8');
  } catch (e) {
    console.error('[ViralStore] Error saving viral_clips_store.json:', e);
  }
}

const viralUploadStorage = multer.diskStorage({
  destination: (_req, _file, cb) => cb(null, VIRAL_UPLOADS_DIR),
  filename: (_req, file, cb) => {
    const ext = path.extname(file.originalname || '.mp4') || '.mp4';
    const safeBase = path
      .basename(file.originalname || 'video', ext)
      .replace(/[^a-zA-Z0-9_-]+/g, '_')
      .slice(0, 50);
    cb(null, `${Date.now()}_${safeBase}${ext}`);
  },
});

const uploadViralVideo = multer({
  storage: viralUploadStorage,
  limits: { fileSize: 2 * 1024 * 1024 * 1024 }, // Up to 2 GB video upload
});

async function probeVideoDurationAndDims(filePath: string): Promise<{
  durationSec: number;
  width: number;
  height: number;
}> {
  return new Promise((resolve) => {
    execFile(
      'ffprobe',
      [
        '-v',
        'error',
        '-select_streams',
        'v:0',
        '-show_entries',
        'stream=width,height:format=duration',
        '-of',
        'json',
        filePath,
      ],
      { timeout: 15000 },
      (err, stdout) => {
        if (!err && stdout) {
          try {
            const parsed = JSON.parse(stdout);
            const dur = parseFloat(parsed?.format?.duration || '0');
            const w = parseInt(parsed?.streams?.[0]?.width || '1920', 10);
            const h = parseInt(parsed?.streams?.[0]?.height || '1080', 10);
            if (dur > 0) {
              resolve({ durationSec: dur, width: w, height: h });
              return;
            }
          } catch {}
        }
        // Fallback via ffmpeg -i stderr
        const ffmpegBin = getFfmpegPath();
        execFile(ffmpegBin, ['-i', filePath], { timeout: 15000 }, (_e2, _out2, stderr2) => {
          const text = String(stderr2 || '');
          const durMatch = text.match(/Duration:\s*(\d+):(\d+):(\d+(?:\.\d+)?)/i);
          const dimMatch = text.match(/,\s*(\d{3,5})x(\d{3,5})\b/);
          const durationSec = durMatch
            ? parseInt(durMatch[1], 10) * 3600 +
              parseInt(durMatch[2], 10) * 60 +
              parseFloat(durMatch[3])
            : 60;
          const width = dimMatch ? parseInt(dimMatch[1], 10) : 1920;
          const height = dimMatch ? parseInt(dimMatch[2], 10) : 1080;
          resolve({ durationSec, width, height });
        });
      }
    );
  });
}

async function ensureYtDlpBinary(): Promise<string> {
  const candidates = [
    '/opt/homebrew/bin/yt-dlp',
    '/usr/local/bin/yt-dlp',
    path.join(VIRAL_BIN_DIR, 'yt-dlp'),
  ];
  for (const c of candidates) {
    if (fs.existsSync(c)) {
      return c;
    }
  }
  const targetBin = path.join(VIRAL_BIN_DIR, 'yt-dlp');
  const assetName = process.platform === 'darwin' ? 'yt-dlp_macos' : 'yt-dlp_linux';
  const downloadUrl = `https://github.com/yt-dlp/yt-dlp/releases/latest/download/${assetName}`;
  console.log(`[ViralClips] Descargando binario oficial yt-dlp (${assetName})...`);
  const resp = await fetch(downloadUrl, { redirect: 'follow' });
  if (!resp.ok) {
    throw new Error(`No se pudo descargar yt-dlp automáticamente (HTTP ${resp.status}).`);
  }
  const buf = Buffer.from(await resp.arrayBuffer());
  fs.writeFileSync(targetBin, buf);
  fs.chmodSync(targetBin, 0o755);
  return targetBin;
}

interface WordTimestamp {
  word: string;
  start: number;
  end: number;
}

interface TranscriptSegmentItem {
  start: number;
  end: number;
  text: string;
  words?: WordTimestamp[];
}

function buildWordsFromSegment(text: string, startSec: number, endSec: number): WordTimestamp[] {
  const tokens = String(text || '')
    .trim()
    .split(/\s+/)
    .filter(Boolean);
  if (tokens.length === 0) return [];
  const span = Math.max(0.2, endSec - startSec);
  const totalChars = tokens.reduce((acc, w) => acc + Math.max(2, w.length), 0);
  let cursor = startSec;
  return tokens.map((w, idx) => {
    const weight = Math.max(2, w.length) / totalChars;
    const dur = span * weight;
    const wStart = Number(cursor.toFixed(2));
    const wEnd =
      idx === tokens.length - 1 ? Number(endSec.toFixed(2)) : Number((cursor + dur).toFixed(2));
    cursor += dur;
    return { word: w, start: wStart, end: Math.max(wStart + 0.08, wEnd) };
  });
}

async function transcribeVideoFileWithTimestamps(
  videoPath: string,
  durationSec: number
): Promise<TranscriptSegmentItem[]> {
  const ffmpegBin = getFfmpegPath();
  const tmpMp3 = path.join(os.tmpdir(), `viral_extract_${Date.now()}.mp3`);
  try {
    await new Promise<void>((resolve, reject) => {
      execFile(
        ffmpegBin,
        [
          '-y',
          '-i',
          videoPath,
          '-vn',
          '-ac',
          '1',
          '-ar',
          '16000',
          '-b:a',
          '48k',
          tmpMp3,
        ],
        { timeout: 180000 },
        (err) => (err ? reject(err) : resolve())
      );
    });

    // Transcribe using Google Cloud Speech-to-Text (with word time offsets) if credentials exist, without calling paid Gemini API
    if (fs.existsSync(tmpMp3)) {
      try {
        const audioBytes = fs.readFileSync(tmpMp3);
        const sttClient = new speech.SpeechClient();
        const [response] = await sttClient.recognize({
          audio: { content: audioBytes.toString('base64') },
          config: {
            encoding: 'MP3' as any,
            sampleRateHertz: 16000,
            languageCode: 'es-ES',
            enableAutomaticPunctuation: true,
            enableWordTimeOffsets: true,
          },
        });
        const results = response.results || [];
        const outSegs: TranscriptSegmentItem[] = [];
        for (const r of results) {
          const alt = r.alternatives?.[0];
          if (!alt?.transcript) continue;
          const wList: WordTimestamp[] = (alt.words || []).map((w: any) => {
            const s =
              Number(w.startTime?.seconds || 0) + Number(w.startTime?.nanos || 0) / 1e9;
            const e = Number(w.endTime?.seconds || 0) + Number(w.endTime?.nanos || 0) / 1e9;
            return {
              word: String(w.word || '').trim(),
              start: Number(s.toFixed(2)),
              end: Number(Math.max(s + 0.1, e).toFixed(2)),
            };
          });
          const sTime = wList[0]?.start ?? 0;
          const eTime = wList[wList.length - 1]?.end ?? sTime + 5;
          outSegs.push({
            start: sTime,
            end: eTime,
            text: alt.transcript.trim(),
            words: wList.length > 0 ? wList : buildWordsFromSegment(alt.transcript, sTime, eTime),
          });
        }
        if (outSegs.length > 0) return outSegs;
      } catch (sttErr) {
        console.warn('[ViralClips] Local STT fallback notice:', sttErr);
      }
    }
  } catch (err) {
    console.warn('[ViralClips] Gemini audio transcription fallback:', err);
  } finally {
    try {
      if (fs.existsSync(tmpMp3)) fs.unlinkSync(tmpMp3);
    } catch {}
  }
  return [];
}

// 1. Upload local video file for Viral Clips
app.post('/api/viral-clips/upload-video', uploadViralVideo.single('video'), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ ok: false, error: 'No se recibió ningún archivo de video.' });
    }
    const filePath = req.file.path;
    const { durationSec, width, height } = await probeVideoDurationAndDims(filePath);
    const segments = await transcribeVideoFileWithTimestamps(filePath, durationSec);
    res.json({
      ok: true,
      videoUrl: `/viral-clips-media/uploads/${path.basename(filePath)}`,
      localFilePath: filePath,
      fileName: req.file.originalname || path.basename(filePath),
      durationSec,
      width,
      height,
      transcriptSegments: segments,
    });
  } catch (err: any) {
    console.error('[ViralClips] upload-video error:', err);
    res.status(500).json({ ok: false, error: err?.message || 'Error al procesar el video subido.' });
  }
});

// 2. Ingest YouTube URL for Viral Clips
app.post('/api/viral-clips/ingest-youtube', async (req, res) => {
  try {
    const { youtubeUrl } = req.body || {};
    const cleanUrl = String(youtubeUrl || '').trim();
    if (!cleanUrl || !/^https?:\/\/(www\.)?(youtube\.com|youtu\.be)\//i.test(cleanUrl)) {
      return res.status(400).json({
        ok: false,
        error: 'Ingresa un enlace válido de YouTube (ej. https://www.youtube.com/watch?v=...).',
      });
    }

    const ytDlpBin = await ensureYtDlpBinary();
    const stamp = Date.now();
    const outTemplate = path.join(VIRAL_YOUTUBE_DIR, `yt_${stamp}_%(id)s.%(ext)s`);
    const ffmpegBin = getFfmpegPath();

    // First fetch JSON metadata + title
    const infoJson = await new Promise<any>((resolve, reject) => {
      execFile(
        ytDlpBin,
        ['--dump-single-json', '--no-playlist', '--no-warnings', cleanUrl],
        { timeout: 60000, maxBuffer: 25 * 1024 * 1024 },
        (err, stdout, stderr) => {
          if (err) {
            return reject(new Error(stderr || err.message));
          }
          try {
            resolve(JSON.parse(stdout));
          } catch (e) {
            reject(e);
          }
        }
      );
    });

    const videoId = infoJson?.id || String(stamp);
    const videoTitle = infoJson?.title || `YouTube_${videoId}`;
    const targetMp4 = path.join(VIRAL_YOUTUBE_DIR, `yt_${stamp}_${videoId}.mp4`);

    await new Promise<void>((resolve, reject) => {
      execFile(
        ytDlpBin,
        [
          '--no-playlist',
          '--ffmpeg-location',
          ffmpegBin,
          '-f',
          'bestvideo[height<=1080][ext=mp4]+bestaudio[ext=m4a]/best[height<=1080][ext=mp4]/best',
          '--merge-output-format',
          'mp4',
          '-o',
          targetMp4,
          cleanUrl,
        ],
        { timeout: 600000 },
        (err, _stdout, stderr) => {
          if (err && !fs.existsSync(targetMp4)) {
            return reject(new Error(stderr || err.message));
          }
          resolve();
        }
      );
    });

    const { durationSec, width, height } = await probeVideoDurationAndDims(targetMp4);
    const segments = await transcribeVideoFileWithTimestamps(targetMp4, durationSec);

    res.json({
      ok: true,
      videoId,
      title: videoTitle,
      sourceYoutubeUrl: cleanUrl,
      videoUrl: `/viral-clips-media/youtube/${path.basename(targetMp4)}`,
      localFilePath: targetMp4,
      durationSec,
      width,
      height,
      transcriptSegments: segments,
    });
  } catch (err: any) {
    console.error('[ViralClips] ingest-youtube error:', err);
    res.status(500).json({
      ok: false,
      error: err?.message || 'No se pudo descargar el video de YouTube.',
    });
  }
});

// 3. Resolve Documentary Source Video + Transcript for Viral Clips
app.post('/api/viral-clips/resolve-doc-source', async (req, res) => {
  try {
    const { docId, downloadFolderPath, downloadFolderName } = req.body || {};
    const docs: any[] = fs.existsSync(DOCS_FILE)
      ? JSON.parse(fs.readFileSync(DOCS_FILE, 'utf8'))
      : [];
    const doc = docs.find((d) => d.id === docId) || docs[0];
    if (!doc) {
      return res.status(404).json({ ok: false, error: 'Documental no encontrado.' });
    }

    const folderCandidates: string[] = [];
    if (downloadFolderPath && fs.existsSync(downloadFolderPath)) {
      folderCandidates.push(downloadFolderPath);
    }
    if (doc.downloadFolderPath && fs.existsSync(doc.downloadFolderPath)) {
      folderCandidates.push(doc.downloadFolderPath);
    }
    const icloudVideosBase = path.join(
      os.homedir(),
      'Library',
      'Mobile Documents',
      'com~apple~CloudDocs',
      '0YouTube',
      'Huellas de la Humanidad',
      'Videos'
    );
    if (downloadFolderName && fs.existsSync(path.join(icloudVideosBase, downloadFolderName))) {
      folderCandidates.push(path.join(icloudVideosBase, downloadFolderName));
    }
    if (doc.downloadFolderName && fs.existsSync(path.join(icloudVideosBase, doc.downloadFolderName))) {
      folderCandidates.push(path.join(icloudVideosBase, doc.downloadFolderName));
    }

    let rootFolder = folderCandidates[0] || '';
    let masterVideoPath = '';
    let masterVideo9x16Path = '';

    if (rootFolder) {
      const finalDir = path.join(rootFolder, '06_Video_Final');
      if (fs.existsSync(finalDir)) {
        const mp4s = fs
          .readdirSync(finalDir)
          .filter((f) => f.toLowerCase().endsWith('.mp4'))
          .map((f) => ({
            name: f,
            full: path.join(finalDir, f),
            mtime: fs.statSync(path.join(finalDir, f)).mtimeMs,
          }))
          .sort((a, b) => b.mtime - a.mtime);

        const horiz = mp4s.find((m) => m.name.includes('16x9') || !m.name.includes('9x16'));
        const vert = mp4s.find((m) => m.name.includes('9x16'));
        if (horiz) masterVideoPath = horiz.full;
        if (vert) masterVideo9x16Path = vert.full;
        if (!masterVideoPath && mp4s[0]) masterVideoPath = mp4s[0].full;
      }
    }

    // Build transcript segments from doc.timelineSentences or doc.clips
    const transcriptSegments: TranscriptSegmentItem[] = [];
    if (Array.isArray(doc.timelineSentences) && doc.timelineSentences.length > 0) {
      for (const s of doc.timelineSentences) {
        const start = Math.max(0, Number(s.start) || 0);
        const end = Math.max(start + 0.5, Number(s.end) || start + 5);
        const text = String(s.text || '')
          .replace(/\[PAUSA[^\]]*\]/gi, '')
          .trim();
        if (text) {
          transcriptSegments.push({
            start,
            end,
            text,
            words: buildWordsFromSegment(text, start, end),
          });
        }
      }
    } else if (Array.isArray(doc.clips) && doc.clips.length > 0) {
      for (const c of doc.clips) {
        const rangeMatch = String(c.timeRange || '').match(
          /(\d+):(\d+)\s*-\s*(\d+):(\d+)/
        );
        const start = rangeMatch
          ? parseInt(rangeMatch[1], 10) * 60 + parseInt(rangeMatch[2], 10)
          : (Math.max(1, Number(c.clipNumber) || 1) - 1) * 10;
        const end = rangeMatch
          ? parseInt(rangeMatch[3], 10) * 60 + parseInt(rangeMatch[4], 10)
          : start + 10;
        const text = String(c.narrationSegment || '')
          .replace(/\[PAUSA[^\]]*\]/gi, '')
          .trim();
        if (text && !/^sin\s+voz/i.test(text)) {
          transcriptSegments.push({
            start,
            end,
            text,
            words: buildWordsFromSegment(text, start, end),
          });
        }
      }
    }

    let durationSec = Number(doc.targetDurationSeconds) || 180;
    let width = 1920;
    let height = 1080;
    if (masterVideoPath && fs.existsSync(masterVideoPath)) {
      const probed = await probeVideoDurationAndDims(masterVideoPath);
      durationSec = probed.durationSec;
      width = probed.width;
      height = probed.height;
    } else if (transcriptSegments.length > 0) {
      durationSec = Math.max(
        durationSec,
        transcriptSegments[transcriptSegments.length - 1].end + 6
      );
    }

    res.json({
      ok: true,
      docId: doc.id,
      title: doc.title,
      rootFolder,
      masterVideoPath,
      masterVideoUrl: masterVideoPath
        ? `/api/flow/serve-folder-file?filePath=${encodeURIComponent(masterVideoPath)}`
        : '',
      masterVideo9x16Path,
      masterVideo9x16Url: masterVideo9x16Path
        ? `/api/flow/serve-folder-file?filePath=${encodeURIComponent(masterVideo9x16Path)}`
        : '',
      durationSec,
      width,
      height,
      transcriptSegments,
    });
  } catch (err: any) {
    console.error('[ViralClips] resolve-doc-source error:', err);
    res.status(500).json({ ok: false, error: err?.message || 'Error al cargar documental.' });
  }
});

// 4. OpusClip AI Virality Analyzer (/api/viral-clips/analyze)
app.post('/api/viral-clips/analyze', async (req, res) => {
  try {
    const {
      title,
      durationSec,
      transcriptSegments,
      targetDurationRange = '30_60',
      clipCount = 5,
      structurePreference = 'both', // 'continuous' | 'hook_teaser' | 'both'
      customTopicFilter = '',
      autoDmKeyword = 'HUELLAS',
    } = req.body || {};

    const segments: TranscriptSegmentItem[] = Array.isArray(transcriptSegments)
      ? transcriptSegments
      : [];

    if (segments.length === 0) {
      return res.status(400).json({
        ok: false,
        error:
          'No hay transcripción disponible para analizar los momentos virales. Asegúrate de que el video tenga voz o guion.',
      });
    }

    const minDur =
      targetDurationRange === '15_30' ? 18 : targetDurationRange === '60_90' ? 55 : 30;
    const maxDur =
      targetDurationRange === '15_30' ? 32 : targetDurationRange === '60_90' ? 88 : 58;

    // 100% Free Local OpusClip Virality & Retention Scoring Engine (0 paid Gemini API usage)
    const hookPowerRegex =
      /\b(secreto|nadie|jamas|jamás|nunca|imposible|oculto|misterio|tragedia|destino|ultimo|último|ultima|última|verdad|mentira|cuando|pero|sin embargo|aquella noche|aquel dia|aquel día|descubrieron|impactante|historia|millones|miles|muerte|vida|peligro|prohibido|18\d\d|19\d\d|20\d\d|\d+)\b/gi;
    const emotionPowerRegex =
      /\b(lagrimas|lágrimas|dolor|esperanza|miedo|silencio|corazon|corazón|hambre|frio|frío|mar|oceano|océano|barco|puerto|familia|madre|padre|hijos|sangre|olvido|memoria|siempre|adiós|adios|promesa|sueño|infierno|milagro)\b/gi;
    const filterTokens = String(customTopicFilter || '')
      .toLowerCase()
      .split(/\s+/)
      .filter((t) => t.length > 2);

    interface ScoredCandidateWindow {
      startIdx: number;
      endIdx: number;
      startSec: number;
      endSec: number;
      hookScore: number;
      retentionScore: number;
      emotionScore: number;
      completenessScore: number;
      totalScore: number;
      bestTeaserSeg: TranscriptSegmentItem;
      reason: string;
    }

    const candidates: ScoredCandidateWindow[] = [];
    for (let i = 0; i < segments.length; i++) {
      const sSeg = segments[i];
      for (let j = i; j < segments.length; j++) {
        const eSeg = segments[j];
        const dur = eSeg.end - sSeg.start;
        if (dur < minDur) continue;
        if (dur > maxDur) break;

        const windowSegs = segments.slice(i, j + 1);
        const fullText = windowSegs.map((w) => w.text).join(' ');
        const firstText = sSeg.text;
        const lastText = eSeg.text;

        const hookMatches = (firstText.match(hookPowerRegex) || []).length;
        const hasQuestion = /[¿?]/.test(firstText) ? 6 : 0;
        const emotionMatches = (fullText.match(emotionPowerRegex) || []).length;
        const totalHookMatches = (fullText.match(hookPowerRegex) || []).length;

        let filterBonus = 0;
        if (filterTokens.length > 0) {
          const lowerFull = fullText.toLowerCase();
          for (const ft of filterTokens) {
            if (lowerFull.includes(ft)) filterBonus += 8;
          }
        }

        const wordCount = fullText.split(/\s+/).length;
        const wps = wordCount / Math.max(1, dur);
        const pacingBonus = wps >= 2.0 && wps <= 3.6 ? 8 : 3;
        const cleanEndingBonus = /[.!?…"]$/.test(lastText.trim()) ? 7 : 2;

        const hookScore = Math.min(99, 82 + hookMatches * 4 + hasQuestion + Math.min(6, totalHookMatches));
        const emotionScore = Math.min(99, 81 + emotionMatches * 3 + Math.min(8, totalHookMatches));
        const retentionScore = Math.min(99, 83 + pacingBonus + Math.min(7, windowSegs.length));
        const completenessScore = Math.min(99, 84 + cleanEndingBonus);

        const totalScore = Math.min(
          99,
          Math.round(
            hookScore * 0.35 +
              emotionScore * 0.3 +
              retentionScore * 0.2 +
              completenessScore * 0.15 +
              filterBonus
          )
        );

        // Find the single most explosive sub-segment inside the window for Hook Teaser mode
        let bestTeaserSeg = sSeg;
        let bestSegScore = -1;
        for (const ws of windowSegs) {
          const sc =
            (ws.text.match(hookPowerRegex) || []).length * 3 +
            (ws.text.match(emotionPowerRegex) || []).length * 2 +
            (/[¿?!]/.test(ws.text) ? 4 : 0);
          if (sc > bestSegScore && ws.end - ws.start >= 2.2) {
            bestSegScore = sc;
            bestTeaserSeg = ws;
          }
        }

        const reasons: string[] = [];
        if (hookMatches > 0 || hasQuestion > 0) {
          reasons.push('Apertura con gancho narrativo directo en los primeros 3 segundos');
        } else {
          reasons.push('Inicio claro y envolvente que sitúa a la audiencia de inmediato');
        }
        if (emotionMatches >= 2) {
          reasons.push('alta carga emocional e histórica que maximiza el tiempo de visualización');
        } else {
          reasons.push('ritmo dinámico sin silencios muertos ideal para formato vertical 9:16');
        }
        reasons.push('y cierre en frase completa que invita a comentar.');

        candidates.push({
          startIdx: i,
          endIdx: j,
          startSec: sSeg.start,
          endSec: eSeg.end,
          hookScore,
          retentionScore,
          emotionScore,
          completenessScore,
          totalScore,
          bestTeaserSeg,
          reason: reasons.join(', '),
        });
        break; // Keep best duration match starting at i
      }
    }

    candidates.sort((a, b) => b.totalScore - a.totalScore);

    // Select top N non-overlapping (or minimally overlapping) windows
    const desiredCount = Math.max(1, Math.min(15, Number(clipCount) || 5));
    const picked: ScoredCandidateWindow[] = [];
    for (const cand of candidates) {
      if (picked.length >= desiredCount) break;
      const overlaps = picked.some(
        (p) =>
          Math.max(0, Math.min(p.endSec, cand.endSec) - Math.max(p.startSec, cand.startSec)) >
          Math.min(p.endSec - p.startSec, cand.endSec - cand.startSec) * 0.35
      );
      if (!overlaps) {
        picked.push(cand);
      }
    }
    // If transcript is short and we need more clips, fill with remaining best candidates
    for (const cand of candidates) {
      if (picked.length >= desiredCount) break;
      if (!picked.includes(cand)) picked.push(cand);
    }

    const rawClips = picked.map((p, k) => {
      const startSeg = segments[p.startIdx] || segments[0];
      const cleanWords = startSeg.text
        .replace(/^[¡¿"«—\-\s]+/, '')
        .split(/\s+/)
        .slice(0, 6)
        .join(' ')
        .replace(/[.,;:!?"»]+$/g, '');
      const bannerWords = p.bestTeaserSeg.text
        .replace(/^[¡¿"«—\-\s]+/, '')
        .split(/\s+/)
        .slice(0, 6)
        .join(' ')
        .replace(/[.,;:!?"»]+$/g, '')
        .toUpperCase();

      return {
        title: cleanWords || `Momento Viral #${k + 1}`,
        viralityScore: Math.max(82, Math.min(99, p.totalScore - k)),
        scoreBreakdown: {
          hook: p.hookScore,
          retention: p.retentionScore,
          emotion: p.emotionScore,
          completeness: p.completenessScore,
        },
        viralityReason: p.reason,
        structureMode:
          structurePreference === 'continuous'
            ? 'continuous'
            : structurePreference === 'hook_teaser'
            ? 'hook_teaser'
            : k % 2 === 0
            ? 'hook_teaser'
            : 'continuous',
        startSec: p.startSec,
        endSec: p.endSec,
        hookTeaserStartSec: p.bestTeaserSeg.start,
        hookTeaserEndSec: Math.min(p.endSec, Math.max(p.bestTeaserSeg.start + 2.8, Math.min(p.bestTeaserSeg.end, p.bestTeaserSeg.start + 4.5))),
        hookBannerText: bannerWords || cleanWords.toUpperCase(),
        storyTeaserDurationSec: 20,
        socialCaption: `🔥 ${p.bestTeaserSeg.text.trim()}\n\nUn episodio fascinante de "${
          title || 'Huellas de la Humanidad'
        }".`,
        hashtags: '#Historia #Documental #Reels #Viral #HuellasDeLaHumanidad #Cultura',
      };
    });

    const enrichedClips = rawClips.map((c, idx) => {
      const startSec = Math.max(0, Number(c.startSec) || 0);
      const endSec = Math.max(startSec + 10, Number(c.endSec) || startSec + 35);
      const hookStart = Math.max(startSec, Number(c.hookTeaserStartSec) || startSec);
      const hookEnd = Math.min(
        endSec,
        Math.max(hookStart + 2.2, Number(c.hookTeaserEndSec) || hookStart + 3.5)
      );

      // Slice overlapping transcript segments and their word-level timestamps
      const overlappingSegments = segments.filter(
        (s) => s.end > startSec + 0.1 && s.start < endSec - 0.1
      );
      const words: WordTimestamp[] = [];
      for (const seg of overlappingSegments) {
        const segWords =
          Array.isArray(seg.words) && seg.words.length > 0
            ? seg.words
            : buildWordsFromSegment(seg.text, seg.start, seg.end);
        for (const w of segWords) {
          if (w.end > startSec && w.start < endSec) {
            words.push({
              word: w.word,
              start: Number(Math.max(startSec, w.start).toFixed(2)),
              end: Number(Math.min(endSec, w.end).toFixed(2)),
            });
          }
        }
      }

      const transcriptExcerpt = overlappingSegments.map((s) => s.text).join(' ');

      return {
        id: `viral-clip-${Date.now()}-${idx + 1}`,
        rank: idx + 1,
        title: String(c.title || `Clip Viral #${idx + 1}`),
        viralityScore: Math.min(99, Math.max(70, Number(c.viralityScore) || 92 - idx * 2)),
        scoreBreakdown: {
          hook: Number(c.scoreBreakdown?.hook) || 95,
          retention: Number(c.scoreBreakdown?.retention) || 92,
          emotion: Number(c.scoreBreakdown?.emotion) || 94,
          completeness: Number(c.scoreBreakdown?.completeness) || 90,
        },
        viralityReason: String(
          c.viralityReason ||
            'Gancho inmediato en los primeros 3 segundos con alta carga emocional e intriga histórica.'
        ),
        structureMode: c.structureMode === 'hook_teaser' ? 'hook_teaser' : 'continuous',
        startSec: Number(startSec.toFixed(2)),
        endSec: Number(endSec.toFixed(2)),
        durationSec: Number((endSec - startSec).toFixed(2)),
        hookTeaserStartSec: Number(hookStart.toFixed(2)),
        hookTeaserEndSec: Number(hookEnd.toFixed(2)),
        hookBannerText: String(c.hookBannerText || c.title || '').toUpperCase(),
        storyTeaserDurationSec: Math.min(
          28,
          Math.max(15, Number(c.storyTeaserDurationSec) || 20)
        ),
        socialCaption: String(c.socialCaption || ''),
        hashtags: String(c.hashtags || '#Historia #Documental #Reels #Viral #HuellasDeLaHumanidad'),
        transcriptExcerpt,
        words,
        reframeMode: 'center_fill' as 'center_fill' | 'fit_blur' | 'auto_pan',
        focusX: 50,
        captionStyle: 'opus_gold' as 'opus_gold' | 'hormozi_green' | 'viral_box' | 'huellas_cinema',
      };
    });

    res.json({
      ok: true,
      clips: enrichedClips.sort((a, b) => b.viralityScore - a.viralityScore),
    });
  } catch (err: any) {
    console.error('[ViralClips] analyze error:', err);
    res.status(500).json({
      ok: false,
      error: err?.message || 'Error al analizar momentos virales con IA.',
    });
  }
});

// Helper to build OpusClip-style Word-by-Word Karaoke ASS Subtitles
function buildOpusClipAssSubtitles(params: {
  outW: number;
  outH: number;
  words: WordTimestamp[];
  captionStyle: 'opus_gold' | 'hormozi_green' | 'viral_box' | 'huellas_cinema';
  wordsPerLine: number;
  fontSizeScale: number; // e.g., 1.0 default
  captionYPercent: number; // e.g., 74 (74% from top)
  hookBannerText?: string;
  showHookBanner?: boolean;
  storyCtaBannerText?: string;
  totalClipDurSec: number;
}): string {
  const {
    outW,
    outH,
    words,
    captionStyle,
    wordsPerLine = 3,
    fontSizeScale = 1.0,
    captionYPercent = 74,
    hookBannerText,
    showHookBanner,
    storyCtaBannerText,
    totalClipDurSec,
  } = params;

  const formatAssTime = (sec: number): string => {
    const clamped = Math.max(0, sec);
    const hrs = Math.floor(clamped / 3600);
    const mins = Math.floor((clamped % 3600) / 60);
    const secs = Math.floor(clamped % 60);
    const cs = Math.min(99, Math.round((clamped - Math.floor(clamped)) * 100));
    return `${hrs}:${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}.${String(
      cs
    ).padStart(2, '0')}`;
  };

  const baseFontSize = Math.round(outH * 0.041 * fontSizeScale);
  const hookBannerFontSize = Math.round(outH * 0.032);
  const storyCtaFontSize = Math.round(outH * 0.025);
  const posY = Math.round((Math.max(20, Math.min(88, captionYPercent)) / 100) * outH);
  const centerX = Math.round(outW / 2);

  // Active word highlight colors in ASS BGR format (&HBBGGRR&)
  const highlightColorAss =
    captionStyle === 'hormozi_green'
      ? '&H0080DE4A&' // Neon Green (#4ADE80)
      : captionStyle === 'viral_box'
      ? '&H0038BDF8&' // Sky/Cyan (#F8BD38 / Gold-Amber)
      : captionStyle === 'huellas_cinema'
      ? '&H0066D1FF&' // Warm Gold (#FFD166)
      : '&H0015CCFA&'; // Opus Gold (#FACC15)

  const assLines: string[] = [
    '[Script Info]',
    'ScriptType: v4.00+',
    `PlayResX: ${outW}`,
    `PlayResY: ${outH}`,
    'WrapStyle: 2',
    'ScaledBorderAndShadow: yes',
    '',
    '[V4+ Styles]',
    'Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding',
    `Style: OpusMain,Arial Black,${baseFontSize},&H00FFFFFF,&H0000FFFF,&H00000000,&H80000000,-1,0,0,0,100,100,1,0,1,${Math.max(
      4,
      Math.round(baseFontSize * 0.09)
    )},${Math.max(2, Math.round(baseFontSize * 0.05))},5,40,40,40,1`,
    `Style: OpusPillBg,Arial Black,${baseFontSize},&HB0000000,&H0000FFFF,&H00000000,&H00000000,-1,0,0,0,100,100,1,0,1,0,0,5,40,40,40,1`,
    `Style: HookBanner,Arial Black,${hookBannerFontSize},&H00101010,&H0000FFFF,&H0015CCFA,&H0015CCFA,-1,0,0,0,100,100,1,0,3,${Math.round(
      hookBannerFontSize * 0.36
    )},0,8,50,50,180,1`,
    `Style: StoryCta,Arial Black,${storyCtaFontSize},&H00FFFFFF,&H0000FFFF,&H00155E75,&H00155E75,-1,0,0,0,100,100,1,0,3,${Math.round(
      storyCtaFontSize * 0.42
    )},0,2,40,40,95,1`,
    '',
    '[Events]',
    'Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text',
  ];

  // 1) Optional Hook Banner at the top for the first 3.8s
  if (showHookBanner && hookBannerText && hookBannerText.trim()) {
    const cleanHook = hookBannerText
      .trim()
      .replace(/[{}]/g, '')
      .slice(0, 65);
    const bannerEnd = Math.min(totalClipDurSec, 3.8);
    assLines.push(
      `Dialogue: 3,${formatAssTime(0)},${formatAssTime(
        bannerEnd
      )},HookBanner,,0,0,0,,{\\fad(180,280)\\pos(${centerX},${Math.round(
        outH * 0.14
      )})}  ${cleanHook}  `
    );
  }

  // 2) Optional Story CTA Banner at the bottom (e.g. "💬 Responde HUELLAS para enviarte el link por DM")
  if (storyCtaBannerText && storyCtaBannerText.trim()) {
    const cleanCta = storyCtaBannerText.trim().replace(/[{}]/g, '');
    assLines.push(
      `Dialogue: 3,${formatAssTime(0.2)},${formatAssTime(
        totalClipDurSec
      )},StoryCta,,0,0,0,,{\\fad(250,250)\\pos(${centerX},${Math.round(
        outH * 0.91
      )})}  ${cleanCta}  `
    );
  }

  // 3) Group words into chunks of `wordsPerLine` and emit word-by-word active highlight events
  const safeWordsPerChunk = Math.max(1, Math.min(6, Number(wordsPerLine) || 3));
  for (let i = 0; i < words.length; i += safeWordsPerChunk) {
    const chunk = words.slice(i, i + safeWordsPerChunk);
    if (chunk.length === 0) continue;

    for (let activeIdx = 0; activeIdx < chunk.length; activeIdx++) {
      const wStart = chunk[activeIdx].start;
      const wEnd =
        activeIdx + 1 < chunk.length ? chunk[activeIdx + 1].start : chunk[activeIdx].end;
      if (wEnd <= wStart + 0.01) continue;

      const formattedTokens = chunk.map((tokenObj, j) => {
        const cleanWord = String(tokenObj.word || '')
          .replace(/[{}]/g, '')
          .toUpperCase();
        if (j === activeIdx) {
          return `{\\1c${highlightColorAss}\\fscx108\\fscy108}${cleanWord}{\\1c&H00FFFFFF&\\fscx100\\fscy100}`;
        }
        return cleanWord;
      });

      const lineStr = formattedTokens.join(' ');
      assLines.push(
        `Dialogue: 2,${formatAssTime(wStart)},${formatAssTime(
          wEnd
        )},OpusMain,,0,0,0,,{\\pos(${centerX},${posY})}${lineStr}`
      );
    }
  }

  return assLines.join('\n');
}

// 5. Render Viral Clip to 9:16 MP4 (/api/viral-clips/render)
async function renderViralClipMp4Internal(params: {
  sourceVideoPath: string;
  docRootFolder?: string;
  clipTitle: string;
  startSec: number;
  endSec: number;
  structureMode: 'continuous' | 'hook_teaser';
  hookTeaserStartSec?: number;
  hookTeaserEndSec?: number;
  reframeMode: 'center_fill' | 'fit_blur' | 'auto_pan';
  focusX: number;
  captionStyle: 'opus_gold' | 'hormozi_green' | 'viral_box' | 'huellas_cinema';
  wordsPerLine: number;
  fontSizeScale: number;
  captionYPercent: number;
  words: WordTimestamp[];
  hookBannerText?: string;
  showHookBanner?: boolean;
  renderVariant?: 'reel' | 'story_full' | 'story_teaser';
  storyTeaserDurationSec?: number;
  storyCtaBannerText?: string;
}): Promise<{
  outputFilePath: string;
  savedInDocFolderPath?: string;
  publicServeUrl: string;
  durationSec: number;
}> {
  const {
    sourceVideoPath,
    docRootFolder,
    clipTitle,
    startSec,
    endSec,
    structureMode,
    hookTeaserStartSec = startSec,
    hookTeaserEndSec = startSec + 3,
    reframeMode = 'center_fill',
    focusX = 50,
    captionStyle = 'opus_gold',
    wordsPerLine = 3,
    fontSizeScale = 1.0,
    captionYPercent = 74,
    words = [],
    hookBannerText = '',
    showHookBanner = true,
    renderVariant = 'reel',
    storyTeaserDurationSec = 20,
    storyCtaBannerText = '',
  } = params;

  if (!sourceVideoPath || !fs.existsSync(sourceVideoPath)) {
    throw new Error(
      'No se encontró el archivo de video origen. Si es un documental, asegúrate de haber exportado el video en 06_Video_Final o sube un archivo MP4.'
    );
  }

  const ffmpegBin = getFfmpegPath();
  const outW = 1080;
  const outH = 1920;

  // Adjust effective duration based on variant ('reel' vs 'story_full' <=58s vs 'story_teaser' ~20s)
  let effectiveEndSec = endSec;
  if (renderVariant === 'story_full') {
    effectiveEndSec = Math.min(endSec, startSec + 58);
  } else if (renderVariant === 'story_teaser') {
    effectiveEndSec = Math.min(endSec, startSec + Math.max(12, storyTeaserDurationSec));
  }
  const mainSpanDur = Math.max(3, effectiveEndSec - startSec);

  const useHookTeaser =
    structureMode === 'hook_teaser' &&
    renderVariant === 'reel' &&
    hookTeaserStartSec > startSec + 1.5 &&
    hookTeaserEndSec > hookTeaserStartSec + 1.5 &&
    hookTeaserEndSec <= endSec;

  const teaserSpanDur = useHookTeaser ? Math.min(5, hookTeaserEndSec - hookTeaserStartSec) : 0;
  const totalClipDurSec = teaserSpanDur + mainSpanDur;

  // Shift words to local clip timeline [0, totalClipDurSec]
  const localWords: WordTimestamp[] = [];
  if (useHookTeaser) {
    for (const w of words) {
      if (w.end > hookTeaserStartSec && w.start < hookTeaserEndSec) {
        localWords.push({
          word: w.word,
          start: Math.max(0, w.start - hookTeaserStartSec),
          end: Math.min(teaserSpanDur, w.end - hookTeaserStartSec),
        });
      }
    }
  }
  for (const w of words) {
    if (w.end > startSec && w.start < effectiveEndSec) {
      localWords.push({
        word: w.word,
        start: teaserSpanDur + Math.max(0, w.start - startSec),
        end: teaserSpanDur + Math.min(mainSpanDur, w.end - startSec),
      });
    }
  }

  const assContent = buildOpusClipAssSubtitles({
    outW,
    outH,
    words: localWords,
    captionStyle,
    wordsPerLine,
    fontSizeScale,
    captionYPercent,
    hookBannerText,
    showHookBanner,
    storyCtaBannerText:
      renderVariant === 'story_full' || renderVariant === 'story_teaser'
        ? storyCtaBannerText
        : '',
    totalClipDurSec,
  });

  const stamp = Date.now();
  const assPath = path.join(os.tmpdir(), `viral_ass_${stamp}.ass`);
  fs.writeFileSync(assPath, assContent, 'utf8');
  const escapedAssPath = assPath.replace(/\\/g, '/').replace(/:/g, '\\:');

  const safeSlug = String(clipTitle || 'Viral_Clip')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-zA-Z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 48);

  const variantSuffix =
    renderVariant === 'story_teaser'
      ? '_Story_Teaser'
      : renderVariant === 'story_full'
      ? '_Story'
      : '_Reel_9x16';

  const fileName = `${safeSlug}${variantSuffix}_${stamp}.mp4`;
  const outputFilePath = path.join(VIRAL_EXPORTS_DIR, fileName);

  // Build 9:16 Reframe filter
  const fX = Math.max(0, Math.min(1, (Number(focusX) || 50) / 100));
  let reframeVf = '';
  if (reframeMode === 'fit_blur') {
    reframeVf = `split=2[bg][fg];[bg]scale=${outW}:${outH}:force_original_aspect_ratio=increase,crop=${outW}:${outH},boxblur=24:4,eq=brightness=-0.18[bgblur];[fg]scale=${outW}:${outH}:force_original_aspect_ratio=decrease[fgscaled];[bgblur][fgscaled]overlay=(W-w)/2:(H-h)/2,ass='${escapedAssPath}'`;
  } else if (reframeMode === 'auto_pan') {
    reframeVf = `scale=${outW}:${outH}:force_original_aspect_ratio=increase,crop=${outW}:${outH}:'(iw-ow)*(0.25+0.5*min(1,t/${mainSpanDur.toFixed(
      2
    )}))':(ih-oh)/2,ass='${escapedAssPath}'`;
  } else {
    reframeVf = `scale=${outW}:${outH}:force_original_aspect_ratio=increase,crop=${outW}:${outH}:(iw-ow)*${fX.toFixed(
      3
    )}:(ih-oh)/2,ass='${escapedAssPath}'`;
  }

  try {
    if (!useHookTeaser) {
      await new Promise<void>((resolve, reject) => {
        execFile(
          ffmpegBin,
          [
            '-y',
            '-ss',
            startSec.toFixed(3),
            '-to',
            effectiveEndSec.toFixed(3),
            '-i',
            sourceVideoPath,
            '-vf',
            reframeVf,
            '-r',
            '30',
            '-c:v',
            'libx264',
            '-preset',
            'ultrafast',
            '-crf',
            '20',
            '-pix_fmt',
            'yuv420p',
            '-c:a',
            'aac',
            '-b:a',
            '192k',
            '-movflags',
            '+faststart',
            outputFilePath,
          ],
          { timeout: 600000 },
          (err, _stdout, stderr) => {
            if (err) return reject(new Error(stderr || err.message));
            resolve();
          }
        );
      });
    } else {
      // Render Hook Teaser + Main Segment concatenated, then burn ASS subtitles
      const complexFilter =
        reframeMode === 'fit_blur'
          ? `[0:v]trim=start=${hookTeaserStartSec.toFixed(3)}:end=${hookTeaserEndSec.toFixed(
              3
            )},setpts=PTS-STARTPTS[v0];[0:a]atrim=start=${hookTeaserStartSec.toFixed(
              3
            )}:end=${hookTeaserEndSec.toFixed(
              3
            )},asetpts=PTS-STARTPTS[a0];[0:v]trim=start=${startSec.toFixed(
              3
            )}:end=${effectiveEndSec.toFixed(
              3
            )},setpts=PTS-STARTPTS[v1];[0:a]atrim=start=${startSec.toFixed(
              3
            )}:end=${effectiveEndSec.toFixed(
              3
            )},asetpts=PTS-STARTPTS[a1];[v0][a0][v1][a1]concat=n=2:v=1:a=1[vc][aout];[vc]split=2[bg][fg];[bg]scale=${outW}:${outH}:force_original_aspect_ratio=increase,crop=${outW}:${outH},boxblur=24:4,eq=brightness=-0.18[bgblur];[fg]scale=${outW}:${outH}:force_original_aspect_ratio=decrease[fgscaled];[bgblur][fgscaled]overlay=(W-w)/2:(H-h)/2,ass='${escapedAssPath}'[vout]`
          : `[0:v]trim=start=${hookTeaserStartSec.toFixed(3)}:end=${hookTeaserEndSec.toFixed(
              3
            )},setpts=PTS-STARTPTS[v0];[0:a]atrim=start=${hookTeaserStartSec.toFixed(
              3
            )}:end=${hookTeaserEndSec.toFixed(
              3
            )},asetpts=PTS-STARTPTS[a0];[0:v]trim=start=${startSec.toFixed(
              3
            )}:end=${effectiveEndSec.toFixed(
              3
            )},setpts=PTS-STARTPTS[v1];[0:a]atrim=start=${startSec.toFixed(
              3
            )}:end=${effectiveEndSec.toFixed(
              3
            )},asetpts=PTS-STARTPTS[a1];[v0][a0][v1][a1]concat=n=2:v=1:a=1[vc][aout];[vc]scale=${outW}:${outH}:force_original_aspect_ratio=increase,crop=${outW}:${outH}:(iw-ow)*${fX.toFixed(
              3
            )}:(ih-oh)/2,ass='${escapedAssPath}'[vout]`;

      await new Promise<void>((resolve, reject) => {
        execFile(
          ffmpegBin,
          [
            '-y',
            '-i',
            sourceVideoPath,
            '-filter_complex',
            complexFilter,
            '-map',
            '[vout]',
            '-map',
            '[aout]',
            '-r',
            '30',
            '-c:v',
            'libx264',
            '-preset',
            'ultrafast',
            '-crf',
            '20',
            '-pix_fmt',
            'yuv420p',
            '-c:a',
            'aac',
            '-b:a',
            '192k',
            '-movflags',
            '+faststart',
            outputFilePath,
          ],
          { timeout: 600000 },
          (err, _stdout, stderr) => {
            if (err) return reject(new Error(stderr || err.message));
            resolve();
          }
        );
      });
    }
  } finally {
    try {
      if (fs.existsSync(assPath)) fs.unlinkSync(assPath);
    } catch {}
  }

  let savedInDocFolderPath: string | undefined;
  if (docRootFolder && fs.existsSync(docRootFolder)) {
    try {
      const viralDir = path.join(docRootFolder, '07_Viral_Clips');
      if (!fs.existsSync(viralDir)) {
        fs.mkdirSync(viralDir, { recursive: true });
      }
      const targetDocCopy = path.join(viralDir, fileName);
      fs.copyFileSync(outputFilePath, targetDocCopy);
      savedInDocFolderPath = targetDocCopy;
    } catch (e) {
      console.warn('[ViralClips] Could not copy to 07_Viral_Clips:', e);
    }
  }

  return {
    outputFilePath,
    savedInDocFolderPath,
    publicServeUrl: `/viral-clips-media/exports/${fileName}`,
    durationSec: totalClipDurSec,
  };
}

app.post('/api/viral-clips/render', async (req, res) => {
  try {
    const result = await renderViralClipMp4Internal(req.body || {});
    res.json({
      ok: true,
      ...result,
    });
  } catch (err: any) {
    console.error('[ViralClips] render error:', err);
    res.status(500).json({
      ok: false,
      error: err?.message || 'Error al renderizar el clip viral.',
    });
  }
});

// ============================================================================
// INSTAGRAM GRAPH API DIRECT PUBLISHER (REELS + STORIES) & AUTO-DM ENGINE
// ============================================================================

async function uploadMp4ToTemporaryPublicHttps(localFilePath: string): Promise<string> {
  const store = loadViralStore();
  if (
    store.publicServerBaseUrl &&
    /^https:\/\//i.test(store.publicServerBaseUrl.trim()) &&
    !store.publicServerBaseUrl.includes('localhost')
  ) {
    const base = store.publicServerBaseUrl.trim().replace(/\/+$/, '');
    return `${base}/viral-clips-media/exports/${encodeURIComponent(path.basename(localFilePath))}`;
  }

  const fileBytes = fs.readFileSync(localFilePath);
  const fileName = path.basename(localFilePath);

  // Fallback 1: litterbox.catbox.moe (1h temporary direct HTTPS MP4 link, fast & reliable for Meta Graph API ingestion)
  try {
    const form = new FormData();
    form.append('reqtype', 'fileupload');
    form.append('time', '1h');
    form.append('fileToUpload', new Blob([fileBytes], { type: 'video/mp4' }), fileName);
    const resp = await fetch('https://litterbox.catbox.moe/resources/internals/api.php', {
      method: 'POST',
      body: form,
    });
    if (resp.ok) {
      const urlText = (await resp.text()).trim();
      if (/^https:\/\/[^\s]+\.mp4$/i.test(urlText)) {
        return urlText;
      }
    }
  } catch (e) {
    console.warn('[IG Publisher] litterbox fallback warning:', e);
  }

  // Fallback 2: tmpfiles.org direct download link
  try {
    const form = new FormData();
    form.append('file', new Blob([fileBytes], { type: 'video/mp4' }), fileName);
    const resp = await fetch('https://tmpfiles.org/api/v1/upload', {
      method: 'POST',
      body: form,
    });
    if (resp.ok) {
      const data: any = await resp.json();
      const rawUrl = String(data?.data?.url || '');
      if (rawUrl.startsWith('http')) {
        return rawUrl
          .replace('http://tmpfiles.org/', 'https://tmpfiles.org/dl/')
          .replace('https://tmpfiles.org/', 'https://tmpfiles.org/dl/');
      }
    }
  } catch (e) {
    console.warn('[IG Publisher] tmpfiles fallback warning:', e);
  }

  throw new Error(
    'No se pudo generar una URL pública HTTPS temporal para que los servidores de Meta descarguen el video.'
  );
}

async function publishSingleMediaToInstagramGraphApi(params: {
  igUserId: string;
  accessToken: string;
  videoPublicUrl: string;
  mediaType: 'REELS' | 'STORIES';
  caption?: string;
}): Promise<{ mediaId: string; permalink?: string }> {
  const { igUserId, accessToken, videoPublicUrl, mediaType, caption } = params;
  const createUrl = new URL(`https://graph.facebook.com/v21.0/${encodeURIComponent(igUserId)}/media`);
  createUrl.searchParams.set('media_type', mediaType);
  createUrl.searchParams.set('video_url', videoPublicUrl);
  if (mediaType === 'REELS') {
    createUrl.searchParams.set('share_to_feed', 'true');
    if (caption) {
      createUrl.searchParams.set('caption', caption);
    }
  }
  createUrl.searchParams.set('access_token', accessToken);

  const createResp = await fetch(createUrl.toString(), { method: 'POST' });
  const createJson: any = await createResp.json();
  if (!createResp.ok || !createJson?.id) {
    throw new Error(
      createJson?.error?.message ||
        `Error creando contenedor ${mediaType} en Instagram Graph API.`
    );
  }

  const creationId = String(createJson.id);

  // Poll container status until FINISHED (up to ~90s)
  for (let attempt = 0; attempt < 30; attempt++) {
    await new Promise((r) => setTimeout(r, 3000));
    const statusUrl = new URL(
      `https://graph.facebook.com/v21.0/${encodeURIComponent(creationId)}`
    );
    statusUrl.searchParams.set('fields', 'status_code,status');
    statusUrl.searchParams.set('access_token', accessToken);
    const stResp = await fetch(statusUrl.toString());
    const stJson: any = await stResp.json();
    const code = String(stJson?.status_code || '');
    if (code === 'FINISHED') {
      break;
    }
    if (code === 'ERROR' || code === 'EXPIRED') {
      throw new Error(
        `Instagram rechazó el procesamiento del video (${code}): ${
          stJson?.status || 'Verifica el formato MP4 H.264.'
        }`
      );
    }
  }

  // Publish container
  const pubUrl = new URL(
    `https://graph.facebook.com/v21.0/${encodeURIComponent(igUserId)}/media_publish`
  );
  pubUrl.searchParams.set('creation_id', creationId);
  pubUrl.searchParams.set('access_token', accessToken);

  const pubResp = await fetch(pubUrl.toString(), { method: 'POST' });
  const pubJson: any = await pubResp.json();
  if (!pubResp.ok || !pubJson?.id) {
    throw new Error(
      pubJson?.error?.message || `Error publicando ${mediaType} en Instagram.`
    );
  }

  const publishedMediaId = String(pubJson.id);
  let permalink: string | undefined;
  try {
    const infoUrl = new URL(
      `https://graph.facebook.com/v21.0/${encodeURIComponent(publishedMediaId)}`
    );
    infoUrl.searchParams.set('fields', 'permalink');
    infoUrl.searchParams.set('access_token', accessToken);
    const infoResp = await fetch(infoUrl.toString());
    const infoJson: any = await infoResp.json();
    if (infoJson?.permalink) permalink = String(infoJson.permalink);
  } catch {}

  return { mediaId: publishedMediaId, permalink };
}

// Get Instagram & Auto-DM settings
app.get('/api/viral-clips/instagram-config', (_req, res) => {
  const store = loadViralStore();
  res.json({
    ok: true,
    config: {
      ...store,
      hasToken: Boolean(store.accessToken && store.accessToken.trim().length > 10),
      maskedToken: store.accessToken ? getMaskedKey(store.accessToken) : '',
    },
  });
});

// Save Instagram & Auto-DM settings
app.post('/api/viral-clips/instagram-config', async (req, res) => {
  try {
    const current = loadViralStore();
    const body = req.body || {};
    if (typeof body.igUserId === 'string') current.igUserId = body.igUserId.trim();
    if (typeof body.accessToken === 'string' && body.accessToken.trim() && !body.accessToken.includes('••••')) {
      current.accessToken = body.accessToken.trim();
    }
    if (typeof body.publicServerBaseUrl === 'string') {
      current.publicServerBaseUrl = body.publicServerBaseUrl.trim();
    }
    if (body.autoDm && typeof body.autoDm === 'object') {
      current.autoDm = {
        ...current.autoDm,
        ...body.autoDm,
      };
    }

    // Verify account username if igUserId + accessToken are present
    if (current.igUserId && current.accessToken) {
      try {
        const testUrl = new URL(
          `https://graph.facebook.com/v21.0/${encodeURIComponent(current.igUserId)}`
        );
        testUrl.searchParams.set('fields', 'id,username,name');
        testUrl.searchParams.set('access_token', current.accessToken);
        const r = await fetch(testUrl.toString());
        const j: any = await r.json();
        if (r.ok && j?.username) {
          current.accountUsername = j.username;
        }
      } catch {}
    }

    saveViralStore(current);
    res.json({
      ok: true,
      config: {
        ...current,
        hasToken: Boolean(current.accessToken && current.accessToken.trim().length > 10),
        maskedToken: current.accessToken ? getMaskedKey(current.accessToken) : '',
      },
    });
  } catch (err: any) {
    res.status(500).json({ ok: false, error: err?.message || 'Error guardando configuración de Instagram.' });
  }
});

// Publish Reel, Story, or Combo Reel + Story directly to Instagram
app.post('/api/viral-clips/publish-instagram', async (req, res) => {
  try {
    const store = loadViralStore();
    if (!store.igUserId || !store.accessToken) {
      return res.status(400).json({
        ok: false,
        error:
          'Configura primero tu Instagram Business/Creator User ID y tu Access Token en el panel de Conexión de Instagram.',
      });
    }

    const {
      publishMode = 'combo_reel_story', // 'reel' | 'story' | 'combo_reel_story'
      storyMode = 'story_teaser', // 'story_teaser' | 'story_full'
      caption = '',
      hashtags = '',
      autoDmDestinationUrl = '',
      autoDmKeyword = '',
      renderParams,
    } = req.body || {};

    // Update Auto-DM destination URL if provided for this documentary/clip
    if (autoDmDestinationUrl && String(autoDmDestinationUrl).trim()) {
      store.autoDm.destinationUrl = String(autoDmDestinationUrl).trim();
    }
    if (autoDmKeyword && String(autoDmKeyword).trim()) {
      store.autoDm.keyword = String(autoDmKeyword).trim().toUpperCase();
    }
    saveViralStore(store);

    const activeKeyword = store.autoDm.keyword || 'HUELLAS';
    const fullCaption = `${String(caption || '').trim()}\n\n💬 Comenta "${activeKeyword}" y te envío el link directo al documental completo por DM.\n\n${String(
      hashtags || ''
    ).trim()}`.trim();

    let reelResult: { mediaId: string; permalink?: string } | undefined;
    let storyResult: { mediaId: string; permalink?: string } | undefined;

    if (publishMode === 'reel' || publishMode === 'combo_reel_story') {
      const renderedReel = await renderViralClipMp4Internal({
        ...renderParams,
        renderVariant: 'reel',
      });
      const publicReelUrl = await uploadMp4ToTemporaryPublicHttps(renderedReel.outputFilePath);
      reelResult = await publishSingleMediaToInstagramGraphApi({
        igUserId: store.igUserId,
        accessToken: store.accessToken,
        videoPublicUrl: publicReelUrl,
        mediaType: 'REELS',
        caption: fullCaption,
      });
    }

    if (publishMode === 'story' || publishMode === 'combo_reel_story') {
      const ctaText = store.autoDm.enabled
        ? `💬 Responde "${activeKeyword}" y te envio el link directo por DM`
        : '🔥 Mira el Reel completo en nuestro perfil';
      const renderedStory = await renderViralClipMp4Internal({
        ...renderParams,
        renderVariant: storyMode === 'story_full' ? 'story_full' : 'story_teaser',
        storyCtaBannerText: ctaText,
      });
      const publicStoryUrl = await uploadMp4ToTemporaryPublicHttps(renderedStory.outputFilePath);
      storyResult = await publishSingleMediaToInstagramGraphApi({
        igUserId: store.igUserId,
        accessToken: store.accessToken,
        videoPublicUrl: publicStoryUrl,
        mediaType: 'STORIES',
      });
    }

    store.publishedHistory.unshift({
      id: `pub-${Date.now()}`,
      clipTitle: String(renderParams?.clipTitle || 'Viral Clip'),
      publishMode,
      reelMediaId: reelResult?.mediaId,
      reelPermalink: reelResult?.permalink,
      storyMediaId: storyResult?.mediaId,
      publishedAt: new Date().toISOString(),
    });
    saveViralStore(store);

    res.json({
      ok: true,
      publishMode,
      reelResult,
      storyResult,
    });
  } catch (err: any) {
    console.error('[IG Publisher] publish-instagram error:', err);
    res.status(500).json({
      ok: false,
      error: err?.message || 'Error al publicar en Instagram.',
    });
  }
});

// Active Auto-DM Check & Responder (scans comments on recent Reels & Story replies and sends clickable link DMs)
async function checkAndSendInstagramAutoDms(): Promise<{
  checkedCount: number;
  sentCount: number;
  details: string[];
}> {
  const store = loadViralStore();
  if (!store.igUserId || !store.accessToken || !store.autoDm.enabled) {
    return { checkedCount: 0, sentCount: 0, details: [] };
  }

  const keywordUpper = (store.autoDm.keyword || 'HUELLAS').trim().toUpperCase();
  const targetUrl = (store.autoDm.destinationUrl || '').trim();
  if (!targetUrl) {
    return { checkedCount: 0, sentCount: 0, details: [] };
  }

  let checkedCount = 0;
  let sentCount = 0;
  const details: string[] = [];

  // 1) Scan recent media comments
  const mediaUrl = new URL(
    `https://graph.facebook.com/v21.0/${encodeURIComponent(store.igUserId)}/media`
  );
  mediaUrl.searchParams.set(
    'fields',
    'id,caption,permalink,comments.limit(25){id,text,username,timestamp}'
  );
  mediaUrl.searchParams.set('limit', '10');
  mediaUrl.searchParams.set('access_token', store.accessToken);

  const mediaResp = await fetch(mediaUrl.toString());
  const mediaJson: any = await mediaResp.json();
  const mediaItems: any[] = Array.isArray(mediaJson?.data) ? mediaJson.data : [];

  for (const media of mediaItems) {
    const comments: any[] = Array.isArray(media?.comments?.data) ? media.comments.data : [];
    for (const c of comments) {
      const commentId = String(c.id || '');
      const text = String(c.text || '').trim();
      const username = String(c.username || 'usuario');
      if (!commentId || !text) continue;
      if (
        store.accountUsername &&
        username.toLowerCase() === store.accountUsername.toLowerCase()
      ) {
        continue;
      }
      if (store.repliedTriggerIds.includes(commentId)) continue;
      checkedCount++;

      const upper = text.toUpperCase();
      const matchesKeyword = upper.includes(keywordUpper);
      const matchesIntent =
        store.autoDm.matchAnyCommentAskingLink &&
        /\b(LINK|ENLACE|VIDEO|DOCUMENTAL|COMPLETO|YOUTUBE|PASAME|MANDA|QUIERO)\b/i.test(text);

      if (!matchesKeyword && !matchesIntent) continue;

      const dmText = store.autoDm.dmMessageTemplate
        .replace(/\{\{username\}\}/gi, username)
        .replace(/\{\{url\}\}/gi, targetUrl);

      try {
        // Send Private Reply DM with clickable URL via Instagram Graph API
        const msgUrl = new URL(
          `https://graph.facebook.com/v21.0/${encodeURIComponent(store.igUserId)}/messages`
        );
        msgUrl.searchParams.set('access_token', store.accessToken);
        const dmResp = await fetch(msgUrl.toString(), {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            recipient: { comment_id: commentId },
            message: { text: dmText },
          }),
        });
        const dmJson: any = await dmResp.json();
        if (!dmResp.ok) {
          throw new Error(dmJson?.error?.message || 'Error enviando Private Reply DM');
        }

        // Optional public comment reply to boost engagement
        if (store.autoDm.enablePublicCommentReply && store.autoDm.publicCommentReply.trim()) {
          try {
            const repUrl = new URL(
              `https://graph.facebook.com/v21.0/${encodeURIComponent(commentId)}/replies`
            );
            repUrl.searchParams.set('message', `@${username} ${store.autoDm.publicCommentReply.trim()}`);
            repUrl.searchParams.set('access_token', store.accessToken);
            await fetch(repUrl.toString(), { method: 'POST' });
          } catch {}
        }

        store.repliedTriggerIds.push(commentId);
        store.sentDmLogs.unshift({
          id: `dm-${Date.now()}-${commentId}`,
          recipientUsername: username,
          triggerType: 'comment',
          triggerText: text,
          sentUrl: targetUrl,
          mediaId: String(media.id || ''),
          sentAt: new Date().toISOString(),
          status: 'sent',
        });
        sentCount++;
        details.push(`DM con link enviado a @${username} ("${text}")`);
      } catch (err: any) {
        store.sentDmLogs.unshift({
          id: `dm-err-${Date.now()}-${commentId}`,
          recipientUsername: username,
          triggerType: 'comment',
          triggerText: text,
          sentUrl: targetUrl,
          mediaId: String(media.id || ''),
          sentAt: new Date().toISOString(),
          status: 'error',
          errorMsg: err?.message || 'Error',
        });
      }
    }
  }

  saveViralStore(store);
  return { checkedCount, sentCount, details };
}

app.post('/api/viral-clips/instagram-check-autodm', async (_req, res) => {
  try {
    const result = await checkAndSendInstagramAutoDms();
    const updatedStore = loadViralStore();
    res.json({
      ok: true,
      ...result,
      sentDmLogs: updatedStore.sentDmLogs,
    });
  } catch (err: any) {
    res.status(500).json({
      ok: false,
      error: err?.message || 'Error al revisar comentarios para Auto-DM.',
    });
  }
});

// Official Meta Webhook endpoint for real-time Story replies & Reel comments (when hosted on Render)
app.get('/api/instagram/webhook', (req, res) => {
  const store = loadViralStore();
  const mode = req.query['hub.mode'];
  const token = req.query['hub.verify_token'];
  const challenge = req.query['hub.challenge'];
  if (mode === 'subscribe' && token === store.webhookVerifyToken) {
    res.status(200).send(challenge);
  } else {
    res.sendStatus(403);
  }
});

app.post('/api/instagram/webhook', async (req, res) => {
  res.sendStatus(200);
  try {
    const store = loadViralStore();
    if (!store.autoDm.enabled || !store.igUserId || !store.accessToken) return;
    const body = req.body || {};
    if (body.object === 'instagram') {
      // Trigger comment check & handle direct Story reply messaging events
      const entries: any[] = Array.isArray(body.entry) ? body.entry : [];
      for (const entry of entries) {
        const messaging: any[] = Array.isArray(entry.messaging) ? entry.messaging : [];
        for (const evt of messaging) {
          const senderId = String(evt?.sender?.id || '');
          const msgId = String(evt?.message?.mid || '');
          const msgText = String(evt?.message?.text || '').trim();
          if (
            senderId &&
            senderId !== store.igUserId &&
            msgId &&
            msgText &&
            !store.repliedTriggerIds.includes(msgId)
          ) {
            const kw = (store.autoDm.keyword || 'HUELLAS').toUpperCase();
            if (
              msgText.toUpperCase().includes(kw) ||
              (store.autoDm.matchAnyCommentAskingLink &&
                /\b(LINK|ENLACE|VIDEO|DOCUMENTAL|YOUTUBE)\b/i.test(msgText))
            ) {
              const dmText = store.autoDm.dmMessageTemplate
                .replace(/\{\{username\}\}/gi, 'amigo(a)')
                .replace(/\{\{url\}\}/gi, store.autoDm.destinationUrl);
              const msgUrl = new URL(
                `https://graph.facebook.com/v21.0/${encodeURIComponent(store.igUserId)}/messages`
              );
              msgUrl.searchParams.set('access_token', store.accessToken);
              await fetch(msgUrl.toString(), {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                  recipient: { id: senderId },
                  message: { text: dmText },
                }),
              });
              store.repliedTriggerIds.push(msgId);
              store.sentDmLogs.unshift({
                id: `dm-story-${Date.now()}`,
                recipientUsername: `StoryReply (${senderId.slice(-5)})`,
                triggerType: 'story_reply',
                triggerText: msgText,
                sentUrl: store.autoDm.destinationUrl,
                sentAt: new Date().toISOString(),
                status: 'sent',
              });
              saveViralStore(store);
            }
          }
        }
      }
      await checkAndSendInstagramAutoDms();
    }
  } catch (e) {
    console.warn('[IG Webhook] Error processing event:', e);
  }
});

// Auto-initialize newly created iCloud Drive documentary folders (e.g., created from iPhone Files app)
// with the 6 standard subfolders and a root marker file so iOS Safari's folder picker never sees "Folder is Empty"
function ensureIcloudVideoFoldersInitialized() {
  try {
    const icloudVideosDir =
      '/Users/raydelsantana/Library/Mobile Documents/com~apple~CloudDocs/0YouTube/Huellas de la Humanidad/Videos';
    probeIcloudDriveReadyAsync(icloudVideosDir);
    if (!icloudDriveVerifiedReady) return;
    if (!fs.existsSync(icloudVideosDir)) return;
    const subfolders = [
      '01_Guion_y_SEO',
      '02_Audio',
      '03_Miniaturas',
      '04_Referencias',
      '05_Clips_Video',
      '06_Video_Final',
    ];
    for (const entryName of listIcloudVideosDirCached(icloudVideosDir)) {
      if (!entryName || entryName.startsWith('.')) continue;
      if (!/^(?:video|ep\.?|documental)\s*\d+/i.test(entryName)) continue;
      const folderFull = path.join(icloudVideosDir, entryName);
      try {
        if (!fs.existsSync(folderFull) || !fs.statSync(folderFull).isDirectory()) continue;
      } catch {
        continue;
      }
      const markerPath = path.join(folderFull, '00_Carpeta_Raiz_Huellas.txt');
      if (!fs.existsSync(markerPath)) {
        for (const sub of subfolders) {
          try {
            fs.mkdirSync(path.join(folderFull, sub), { recursive: true });
          } catch {}
        }
        try {
          fs.writeFileSync(
            markerPath,
            `Carpeta raíz del documental: ${entryName}\nSubcarpetas listas: ${subfolders.join(', ')}\n`,
            'utf8'
          );
        } catch {}
      }
    }
  } catch {}
}
ensureIcloudVideoFoldersInitialized();
setInterval(ensureIcloudVideoFoldersInitialized, 15000);

// Background interval every 45s to auto-reply to new Reel comments with the clickable link
setInterval(() => {
  checkAndSendInstagramAutoDms().catch(() => {});
}, 45000);

const REMOTE_MAC_RELAY_URL = 'https://ntfy.sh/huellas_master_mac_relay_v77_9a8b7c';
const REMOTE_MAC_ACK_URL = 'https://ntfy.sh/huellas_master_mac_ack_v77_9a8b7c';

interface PendingGeminiCommandItem {
  commandId: string;
  docId: string;
  action: 'RENAME_GEMINI_CHAT' | 'SEND_PROMPT';
  oldVideoName?: string;
  videoName: string;
  deepResearchVideoName: string;
  geminiChatUrl?: string;
  geminiDeepResearchChatUrl?: string;
  notebookName: string;
  createdAt: number;
  claimedAt?: number;
  remoteStage?: boolean;
  [extra: string]: any;
}

const pendingGeminiCommands = new Map<string, PendingGeminiCommandItem>();
const processedRemoteCommandIds = new Set<string>();

function publishRemoteMacAck(payload: Record<string, any>) {
  fetch(REMOTE_MAC_ACK_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ ...payload, ts: Date.now() }),
  }).catch(() => {});
}

function performMacFolderRenameCore(params: {
  docId?: string;
  newName: string;
  oldFolderPath?: string;
  oldFolderName?: string;
  commandId?: string;
  enqueueGeminiRename?: boolean;
}) {
  const { docId, newName, oldFolderPath, oldFolderName, commandId, enqueueGeminiRename = true } = params;
  const rawTrimmed = String(newName || '').trim();
  if (!rawTrimmed) {
    throw new Error('El nombre del video/carpeta no puede estar vacío.');
  }

  // Safe macOS folder name (preserve accents, spaces, em-dashes, parentheses; replace / and : with -)
  const safeFolderName = rawTrimmed
    .replace(/[/:\\]+/g, ' - ')
    .replace(/\s+/g, ' ')
    .trim();

  const icloudVideosDir =
    '/Users/raydelsantana/Library/Mobile Documents/com~apple~CloudDocs/0YouTube/Huellas de la Humanidad/Videos';
  probeIcloudDriveReadyAsync(icloudVideosDir);
  const hasIcloudDir = icloudDriveVerifiedReady && fs.existsSync(icloudVideosDir);

  // Path sandbox: only folders directly inside the iCloud Videos dir or data/projects may be touched
  if (!safeFolderName || safeFolderName === '.' || safeFolderName === '..' || /[\0]/.test(safeFolderName)) {
    throw new Error('Nombre de carpeta inválido.');
  }
  const realOrResolve = (p: string) => {
    try {
      return fs.existsSync(p) ? fs.realpathSync(p) : path.resolve(p);
    } catch {
      return path.resolve(p);
    }
  };
  const allowedRoots = [icloudVideosDir, path.join(DATA_DIR, 'projects')].map(realOrResolve);
  const isPathPermitted = (p: string) => {
    if (!p) return false;
    const r = realOrResolve(p);
    return allowedRoots.some((root) => r !== root && r.startsWith(root + path.sep));
  };

  // 1. Look up existing documentary record FIRST before overwriting it so we never lose its current folder path/name
  let docsList: any[] = [];
  let docIdx = -1;
  let storedDoc: any = null;
  if (docId) {
    try {
      docsList = readDocumentaries();
      docIdx = docsList.findIndex((d) => d && d.id === docId);
      if (docIdx !== -1) {
        storedDoc = docsList[docIdx];
      }
    } catch {}
  }

  const candidatePaths = [
    typeof oldFolderPath === 'string' ? oldFolderPath.trim() : '',
    typeof storedDoc?.downloadFolderPath === 'string' ? storedDoc.downloadFolderPath.trim() : '',
    hasIcloudDir && typeof oldFolderName === 'string' && oldFolderName.trim()
      ? path.join(icloudVideosDir, oldFolderName.trim())
      : '',
    hasIcloudDir && typeof storedDoc?.downloadFolderName === 'string' && storedDoc.downloadFolderName.trim()
      ? path.join(icloudVideosDir, storedDoc.downloadFolderName.trim())
      : '',
    hasIcloudDir && typeof storedDoc?.title === 'string' && storedDoc.title.trim()
      ? path.join(icloudVideosDir, storedDoc.title.trim())
      : '',
  ].filter((p) => Boolean(p) && isPathPermitted(p));

  let existingFolderPath = '';
  for (const cand of candidatePaths) {
    if (cand && fs.existsSync(cand)) {
      existingFolderPath = cand;
      break;
    }
  }

  if (!existingFolderPath && hasIcloudDir) {
    // Try matching by "Video XX" prefix in iCloud Videos directory using old name, stored doc, or new name
    const combinedForNum = [
      oldFolderName,
      storedDoc?.downloadFolderName,
      storedDoc?.title,
      safeFolderName,
    ]
      .filter(Boolean)
      .join(' ');
    const numMatch = combinedForNum.match(/\b(?:video|ep\.?|episodio|documental)\s*0*(\d+)\b/i);
    if (numMatch) {
      const targetNum = numMatch[1];
      const prefixRegex = new RegExp(
        `^(?:video|ep\\.?|episodio|documental)\\s*0*${targetNum}(?:\\b|\\s|_|-|—|$)`,
        'i'
      );
      const foundName = listIcloudVideosDirCached(icloudVideosDir).find((name) => {
        if (!name || name.startsWith('.') || !prefixRegex.test(name)) return false;
        try {
          const cand = path.join(icloudVideosDir, name);
          return fs.existsSync(cand) && fs.statSync(cand).isDirectory();
        } catch {
          return false;
        }
      });
      if (foundName) {
        existingFolderPath = path.join(icloudVideosDir, foundName);
      }
    }
  }

  const previousFolderName = existingFolderPath
    ? path.basename(existingFolderPath)
    : String(storedDoc?.downloadFolderName || storedDoc?.title || oldFolderName || '').trim();

  const parentDir = existingFolderPath
    ? path.dirname(existingFolderPath)
    : hasIcloudDir
    ? icloudVideosDir
    : path.join(DATA_DIR, 'projects');

  if (!fs.existsSync(parentDir)) {
    fs.mkdirSync(parentDir, { recursive: true });
  }

  const newFolderPath = path.join(parentDir, safeFolderName);
  if (!isPathPermitted(newFolderPath)) {
    throw new Error('Ruta de destino fuera de la carpeta de documentales.');
  }
  let wasRenamed = false;
  let wasCreated = false;

  if (existingFolderPath && fs.existsSync(existingFolderPath)) {
    if (existingFolderPath !== newFolderPath) {
      if (!fs.existsSync(newFolderPath)) {
        fs.renameSync(existingFolderPath, newFolderPath);
        wasRenamed = true;
      }
    }
  } else if (hasIcloudDir) {
    if (!fs.existsSync(newFolderPath)) {
      fs.mkdirSync(newFolderPath, { recursive: true });
      wasCreated = true;
    }
  }

  // Ensure standard subfolders and marker file exist inside the target folder
  if (fs.existsSync(newFolderPath)) {
    const subfolders = [
      '01_Guion_y_SEO',
      '02_Audio',
      '04_Referencias',
      '03_Miniaturas',
      '05_Clips_Video',
      '06_Video_Final',
      '07_Viral_Clips',
    ];
    for (const sub of subfolders) {
      try {
        fs.mkdirSync(path.join(newFolderPath, sub), { recursive: true });
      } catch {}
    }
    try {
      fs.writeFileSync(
        path.join(newFolderPath, '00_Carpeta_Raiz_Huellas.txt'),
        `Carpeta raíz del documental: ${safeFolderName}\nSubcarpetas listas: ${subfolders.join(', ')}\n`,
        'utf8'
      );
    } catch {}
  }

  const effectiveCmdId =
    commandId || `cmd_rename_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
  if (commandId) {
    processedRemoteCommandIds.add(commandId);
  }

  // Update documentary record on disk
  let updatedDocRecord: any = storedDoc;
  try {
    const list = docsList.length > 0 ? docsList : readDocumentaries();
    let idx = docId ? list.findIndex((d) => d && d.id === docId) : -1;
    if (idx === -1) {
      const numMatch = safeFolderName.match(/\b(?:video|ep\.?|episodio|documental)\s*0*(\d+)\b/i);
      if (numMatch) {
        const rx = new RegExp(`\\b(?:video|ep\\.?|episodio|documental)\\s*0*${numMatch[1]}\\b`, 'i');
        idx = list.findIndex((d) => d && (rx.test(d.title || '') || rx.test(d.downloadFolderName || '')));
      }
    }
    if (idx !== -1) {
      updatedDocRecord = {
        ...list[idx],
        title: safeFolderName,
        downloadFolderName: safeFolderName,
        downloadFolderPath: newFolderPath,
        geminiChatTitle: safeFolderName,
        promptConfig: {
          ...(list[idx].promptConfig || {}),
          ...(commandId
            ? {
                REMOTE_RENAME_ACK_ID: commandId,
                REMOTE_RENAME_ACK_STATUS: 'folder_renamed',
              }
            : {}),
        },
        updatedAt: new Date().toISOString(),
      };
      list[idx] = updatedDocRecord;
      writeDocumentaries(list);
    }
  } catch (e) {
    console.warn('[RenameDocFolder] Warning updating documentaries.json:', e);
  }

  if (enqueueGeminiRename) {
    const targetDocId = String(docId || updatedDocRecord?.id || '');
    // Replace any un-claimed earlier rename command for the same docId
    for (const [k, v] of pendingGeminiCommands.entries()) {
      if (v.docId === targetDocId && v.action === 'RENAME_GEMINI_CHAT') {
        pendingGeminiCommands.delete(k);
      }
    }
    pendingGeminiCommands.set(effectiveCmdId, {
      commandId: effectiveCmdId,
      docId: targetDocId,
      action: 'RENAME_GEMINI_CHAT',
      oldVideoName: previousFolderName || oldFolderName || safeFolderName,
      videoName: safeFolderName,
      deepResearchVideoName: `${safeFolderName}_Deep Research`,
      geminiChatUrl: updatedDocRecord?.geminiChatUrl || '',
      geminiDeepResearchChatUrl:
        updatedDocRecord?.geminiDeepResearchChatUrl ||
        updatedDocRecord?.promptConfig?.GEMINI_DEEP_RESEARCH_CHAT_URL ||
        '',
      notebookName: 'Huellas de la Humanidad',
      createdAt: Date.now(),
    });
  }

  publishRemoteMacAck({
    commandId: effectiveCmdId,
    docId: docId || updatedDocRecord?.id || '',
    status: 'folder_renamed',
    folderName: safeFolderName,
    folderPath: newFolderPath,
    previousFolderName,
    wasRenamed,
    wasCreated,
  });

  return {
    ok: true,
    commandId: effectiveCmdId,
    folderName: safeFolderName,
    folderPath: newFolderPath,
    previousFolderName,
    renamedFrom: existingFolderPath || null,
    wasRenamed,
    wasCreated,
  };
}

// Real-time rename of documentary root folder on macOS + sync with documentary record + queue Gemini rename
app.post('/api/system/rename-doc-folder', (req, res) => {
  try {
    const { docId, newName, oldFolderPath, oldFolderName, commandId, enqueueGeminiRename } = req.body || {};
    const result = performMacFolderRenameCore({
      docId,
      newName,
      oldFolderPath,
      oldFolderName,
      commandId,
      enqueueGeminiRename: enqueueGeminiRename !== false,
    });
    res.json(result);
  } catch (err: any) {
    console.error('[RenameDocFolder] Error:', err);
    res.status(400).json({
      ok: false,
      error: err?.message || 'Error al renombrar la carpeta del documental en Mac.',
    });
  }
});

let extensionManualReloadCounter = 0;
let lastExtensionAckAt = 0;
let lastExtensionAckFingerprint = '';

function computeChromeExtensionFingerprint(): string {
  try {
    const extDir = path.join(process.cwd(), 'chrome-extension');
    if (!fs.existsSync(extDir)) return `manual-${extensionManualReloadCounter}`;
    const files = fs
      .readdirSync(extDir)
      .filter((f) => /\.(js|json|html|css)$/i.test(f))
      .sort();
    const parts = files.map((f) => {
      try {
        const st = fs.statSync(path.join(extDir, f));
        return `${f}:${Math.floor(st.mtimeMs)}:${st.size}`;
      } catch {
        return f;
      }
    });
    return `${parts.join('|')}#r${extensionManualReloadCounter}`;
  } catch {
    return `manual-${extensionManualReloadCounter}`;
  }
}

interface PendingExternalGeminiAsk {
  id: string;
  prompt: string;
  createdAt: number;
  claimed: boolean;
  reusedExisting?: boolean;
  windowId?: number | null;
  tabId?: number | null;
  chatUrl?: string;
  resolve: (result: {
    ok: boolean;
    verifiedModel?: string;
    response?: string;
    chatUrl?: string;
    error?: string;
  }) => void;
  timer: ReturnType<typeof setTimeout>;
}

const pendingExternalGeminiAsks = new Map<string, PendingExternalGeminiAsk>();
const pendingExternalChatGptAsks = new Map<string, PendingExternalGeminiAsk>();
const pendingExternalCopilotAsks = new Map<string, PendingExternalGeminiAsk>();
let lastHuellasAppWindowPollAt = 0;

function runAppleScriptInRunningChromiumBrowsers(buildScriptForBrowser: (browserApp: string) => string) {
  if (process.platform !== 'darwin') return;
  const candidateBrowsers = [
    'Google Chrome',
    'Brave Browser',
    'Microsoft Edge',
    'Google Chrome Canary',
    'Chromium',
  ];
  execFile(
    'osascript',
    ['-e', 'tell application "System Events" to get name of every process whose background only is false'],
    (_err, stdout) => {
      const runningText = String(stdout || '');
      const activeBrowsers = candidateBrowsers.filter((b) => runningText.includes(b));
      const targets = activeBrowsers.length > 0 ? activeBrowsers : ['Google Chrome'];
      const tryNext = (idx: number, pass: 1 | 2) => {
        if (idx >= targets.length) {
          if (pass === 1) tryNext(0, 2);
          return;
        }
        const browserApp = targets[idx];
        const script = buildScriptForBrowser(browserApp).replace(/__PASS_MODE__/g, String(pass));
        execFile('osascript', ['-e', script], (_e, out) => {
          if (String(out || '').trim() === 'MATCHED') return;
          tryNext(idx + 1, pass);
        });
      };
      tryNext(0, 1);
    }
  );
}

let lastExtensionWakeAt = 0;
function wakeExtensionInHuellasAppBrowser(forceReload = false) {
  const nowWake = Date.now();
  if (!forceReload && nowWake - lastExtensionWakeAt < 6000) {
    return;
  }
  lastExtensionWakeAt = nowWake;
  const query = forceReload ? '?force=1' : '?wake=1';
  runAppleScriptInRunningChromiumBrowsers(
    (browserApp) => `tell application "${browserApp}"
      repeat with w in windows
        set matchedWin to false
        set detectedExtId to "kbfeckjlcogkccfplkmgenalgnmojclf"
        repeat with t in tabs of w
          set u to URL of t
          if u starts with "chrome://extensions/?id=" then
            set tid to text 25 thru -1 of u
            if (length of tid) >= 32 then
              set detectedExtId to text 1 thru 32 of tid
            end if
          end if
          if __PASS_MODE__ is 1 then
            if (u starts with "http://localhost:4200") or (u starts with "http://127.0.0.1:4200") or (u starts with "http://localhost:5173") or (u starts with "http://127.0.0.1:5173") or (u contains "raydelw-a11y.github.io/Huellas-Master") or (u contains "raydelw-a11y.github.io/huellas-master") or ((u contains ".onrender.com") and (u contains "huellas")) then
              set matchedWin to true
            end if
          else
            if (u starts with "https://gemini.google.com/notebook/") or (u contains "huellasdelahumanidad.com") then
              set matchedWin to true
            end if
          end if
        end repeat
        if matchedWin then
          set prevIdx to active tab index of w
          make new tab at end of tabs of w with properties {URL:"chrome-extension://" & detectedExtId & "/reloader.html${query}"}
          try
            set active tab index of w to prevIdx
          end try
          return "MATCHED"
        end if
      end repeat
      return "NO_MATCH"
    end tell`
  );
}

function closeTemporaryGeminiWindowFailsafe(opts: {
  windowId?: number | null;
  tabId?: number | null;
  chatUrl?: string;
}) {
  if (process.platform !== 'darwin') return;
  const winIdNum = Number(opts.windowId) || 0;
  const tabIdNum = Number(opts.tabId) || 0;
  const cleanChatUrl = String(opts.chatUrl || '')
    .trim()
    .replace(/["'\\]/g, '');
  if (!winIdNum && !tabIdNum && !cleanChatUrl) return;

  // Give chrome.tabs.remove() 850ms to close the temporary tab cleanly first; if still open (e.g. extension reloaded/slept), close ONLY that specific tab
  setTimeout(() => {
    runAppleScriptInRunningChromiumBrowsers(
      (browserApp) => `tell application "${browserApp}"
        set totalGemTabs to 0
        repeat with w in windows
          repeat with t in tabs of w
            if (URL of t) contains "gemini.google.com" then
              set totalGemTabs to totalGemTabs + 1
            end if
          end repeat
        end repeat
        if totalGemTabs <= 1 then return "KEEP_LAST_GEMINI_OPEN"
        repeat with w in windows
          set tabCount to (count of tabs of w)
          repeat with t in tabs of w
            set u to URL of t
            if u starts with "https://gemini.google.com/app" and u does not contain "/notebook/" then
              if (${tabIdNum} > 0 and (id of t as text) is "${tabIdNum}") or (${winIdNum} > 0 and (id of w as text) is "${winIdNum}" and tabCount is 1) or ("${cleanChatUrl}" is not "" and "${cleanChatUrl}" is not "https://gemini.google.com/app" and "${cleanChatUrl}" is not "https://gemini.google.com/app/" and u is "${cleanChatUrl}") then
                if tabCount is 1 then
                  close w
                else
                  close t
                end if
                return "MATCHED"
              end if
            end if
          end repeat
        end repeat
        return "NO_MATCH"
      end tell`
    );
  }, 2500);
}

function closeTemporaryChatGptWindowFailsafe(opts: {
  windowId?: number | null;
  tabId?: number | null;
  chatUrl?: string;
}) {
  if (process.platform !== 'darwin') return;
  const winIdNum = Number(opts.windowId) || 0;
  const tabIdNum = Number(opts.tabId) || 0;
  const cleanChatUrl = String(opts.chatUrl || '')
    .trim()
    .replace(/["'\\]/g, '');
  if (!winIdNum && !tabIdNum && !cleanChatUrl) return;

  setTimeout(() => {
    runAppleScriptInRunningChromiumBrowsers(
      (browserApp) => `tell application "${browserApp}"
        set totalGptTabs to 0
        repeat with w in windows
          repeat with t in tabs of w
            set tu to URL of t
            if (tu starts with "https://chatgpt.com") or (tu starts with "https://chat.openai.com") then
              set totalGptTabs to totalGptTabs + 1
            end if
          end repeat
        end repeat
        if totalGptTabs <= 1 then return "KEEP_LAST_GPT_OPEN"
        repeat with w in windows
          set tabCount to (count of tabs of w)
          repeat with t in tabs of w
            set u to URL of t
            if u starts with "https://chatgpt.com" or u starts with "https://chat.openai.com" then
              if (${tabIdNum} > 0 and (id of t as text) is "${tabIdNum}") or (${winIdNum} > 0 and (id of w as text) is "${winIdNum}" and tabCount is 1) or ("${cleanChatUrl}" is not "" and "${cleanChatUrl}" is not "https://chatgpt.com/" and u is "${cleanChatUrl}") then
                if tabCount is 1 then
                  close w
                else
                  close t
                end if
                return "MATCHED"
              end if
            end if
          end repeat
        end repeat
        return "NO_MATCH"
      end tell`
    );
  }, 2500);
}

function closeTemporaryCopilotWindowFailsafe(opts: {
  windowId?: number | null;
  tabId?: number | null;
  chatUrl?: string;
}) {
  if (process.platform !== 'darwin') return;
  const winIdNum = Number(opts.windowId) || 0;
  const tabIdNum = Number(opts.tabId) || 0;
  const cleanChatUrl = String(opts.chatUrl || '')
    .trim()
    .replace(/["'\\]/g, '');
  if (!winIdNum && !tabIdNum && !cleanChatUrl) return;

  setTimeout(() => {
    runAppleScriptInRunningChromiumBrowsers(
      (browserApp) => `tell application "${browserApp}"
        set totalCopTabs to 0
        repeat with w in windows
          repeat with t in tabs of w
            set tu to URL of t
            if (tu contains "copilot.microsoft.com") or (tu starts with "https://copilot.com") then
              set totalCopTabs to totalCopTabs + 1
            end if
          end repeat
        end repeat
        if totalCopTabs <= 1 then return "KEEP_LAST_COPILOT_OPEN"
        repeat with w in windows
          set tabCount to (count of tabs of w)
          repeat with t in tabs of w
            set u to URL of t
            if u contains "copilot.microsoft.com" or u starts with "https://copilot.com" then
              if (${tabIdNum} > 0 and (id of t as text) is "${tabIdNum}") or (${winIdNum} > 0 and (id of w as text) is "${winIdNum}" and tabCount is 1) or ("${cleanChatUrl}" is not "" and "${cleanChatUrl}" is not "https://copilot.microsoft.com/" and "${cleanChatUrl}" is not "https://copilot.com/" and u is "${cleanChatUrl}") then
                if tabCount is 1 then
                  close w
                else
                  close t
                end if
                return "MATCHED"
              end if
            end if
          end repeat
        end repeat
        return "NO_MATCH"
      end tell`
    );
  }, 2500);
}

app.get('/api/extension/fingerprint', (req, res) => {
  const fp = computeChromeExtensionFingerprint();
  const now = Date.now();
  const hasAppWindow = req.query.hasAppWindow === '1';
  const hasWorkspace = req.query.hasWorkspace === '1';
  if (hasAppWindow) {
    lastHuellasAppWindowPollAt = now;
  }
  const allowWorkspaceFallback = now - lastHuellasAppWindowPollAt > 15000;
  const canDeliverOrdersToCaller = hasAppWindow || (allowWorkspaceFallback && hasWorkspace);

  if (req.query.ack === '1' && (canDeliverOrdersToCaller || req.query.hasAppWindow === undefined)) {
    lastExtensionAckAt = now;
    lastExtensionAckFingerprint = fp;
  }
  let nextExternalAsk: { id: string; prompt: string } | null = null;
  let nextExternalChatGptAsk: { id: string; prompt: string } | null = null;
  let nextExternalCopilotAsk: { id: string; prompt: string } | null = null;
  const unclaimedGeminiAsks: Array<{ id: string; prompt: string }> = [];
  const unclaimedChatGptAsks: Array<{ id: string; prompt: string }> = [];
  const unclaimedCopilotAsks: Array<{ id: string; prompt: string }> = [];
  if (canDeliverOrdersToCaller) {
    for (const item of pendingExternalGeminiAsks.values()) {
      if (!item.claimed) {
        if (!nextExternalAsk) nextExternalAsk = { id: item.id, prompt: item.prompt };
        unclaimedGeminiAsks.push({ id: item.id, prompt: item.prompt });
      }
    }
    for (const item of pendingExternalChatGptAsks.values()) {
      if (!item.claimed) {
        if (!nextExternalChatGptAsk) nextExternalChatGptAsk = { id: item.id, prompt: item.prompt };
        unclaimedChatGptAsks.push({ id: item.id, prompt: item.prompt });
      }
    }
    for (const item of pendingExternalCopilotAsks.values()) {
      if (!item.claimed) {
        if (!nextExternalCopilotAsk) nextExternalCopilotAsk = { id: item.id, prompt: item.prompt };
        unclaimedCopilotAsks.push({ id: item.id, prompt: item.prompt });
      }
    }
  }
  const activeExternalAskIds = [
    ...Array.from(pendingExternalGeminiAsks.keys()),
    ...Array.from(pendingExternalChatGptAsks.keys()),
    ...Array.from(pendingExternalCopilotAsks.keys()),
  ];
  const pendingCommandsList: PendingGeminiCommandItem[] = [];
  if (canDeliverOrdersToCaller) {
    for (const [k, cmd] of pendingGeminiCommands.entries()) {
      const ttlMs =
        cmd.remoteStage || cmd.action === 'SEND_PROMPT' ? 2 * 60 * 60 * 1000 : 180000;
      if (now - cmd.createdAt > ttlMs) {
        pendingGeminiCommands.delete(k);
        continue;
      }
      if (cmd.remoteStage || cmd.action === 'SEND_PROMPT' || (cmd as any).noReclaim) {
        if (!cmd.claimedAt) pendingCommandsList.push(cmd);
        continue;
      }
      if (!cmd.claimedAt || now - cmd.claimedAt > 25000) {
        pendingCommandsList.push(cmd);
      }
    }
  }
  res.json({
    ok: true,
    fingerprint: fp,
    lastAckAt: lastExtensionAckAt,
    lastAckFingerprint: lastExtensionAckFingerprint,
    allowWorkspaceFallback,
    pendingExternalGeminiAsk: nextExternalAsk,
    pendingExternalGeminiAsks: unclaimedGeminiAsks,
    pendingExternalChatGptAsk: nextExternalChatGptAsk,
    pendingExternalChatGptAsks: unclaimedChatGptAsks,
    pendingExternalCopilotAsk: nextExternalCopilotAsk,
    pendingExternalCopilotAsks: unclaimedCopilotAsks,
    activeExternalAskIds,
    pendingGeminiCommands: pendingCommandsList,
  });
});

app.post('/api/extension/claim-gemini-command', (req, res) => {
  const commandId = String(req.body?.commandId || '').trim();
  const cmd = pendingGeminiCommands.get(commandId);
  if (cmd) {
    cmd.claimedAt = Date.now();
  }
  res.json({ ok: true, commandId });
});

app.post('/api/system/confirm-remote-rename', (req, res) => {
  const commandId = String(req.body?.commandId || '').trim();
  const docId = String(req.body?.docId || '').trim();
  const videoName = String(req.body?.videoName || '').trim();
  const mainRenamed = Boolean(req.body?.mainRenamed);
  const deepRenamed = Boolean(req.body?.deepRenamed);
  const seenTitles = String(req.body?.seenTitles || '').trim();
  console.log('[RemoteRenameConfirm]', { commandId, docId, videoName, mainRenamed, deepRenamed, seenTitles });
  if (commandId) {
    pendingGeminiCommands.delete(commandId);
  }
  for (const [k, v] of pendingGeminiCommands.entries()) {
    if (docId && v.docId === docId) {
      pendingGeminiCommands.delete(k);
    }
  }
  if (docId) {
    try {
      const list = readDocumentaries();
      const idx = list.findIndex((d) => d && d.id === docId);
      if (idx !== -1) {
        list[idx] = {
          ...list[idx],
          ...(videoName ? { geminiChatTitle: videoName } : {}),
          promptConfig: {
            ...(list[idx].promptConfig || {}),
            ...(commandId ? { REMOTE_RENAME_ACK_ID: commandId } : {}),
            REMOTE_RENAME_ACK_STATUS: 'all_completed',
            REMOTE_RENAME_MAIN_OK: String(mainRenamed),
            REMOTE_RENAME_DEEP_OK: String(deepRenamed),
          },
          updatedAt: new Date().toISOString(),
        };
        writeDocumentaries(list);
      }
    } catch {}
  }
  publishRemoteMacAck({
    commandId,
    docId,
    status: 'all_completed',
    folderName: videoName,
    mainRenamed,
    deepRenamed,
  });
  res.json({ ok: true });
});

// Background watchers on Mac:
// 1) Persistent NDJSON stream (1 connection, <50ms latency, no 429 rate limits)
// 2) Authenticated GitHub SHA watcher (every 3s, 5000 req/hr quota) as second guaranteed path
const recentRemoteStageBurstGuard = new Map<string, number>();
const inFlightRemoteTriggerIds = new Set<string>();

function expireStaleRunningStage3JobsServer(): void {
  try {
    const list = readDocumentaries();
    let mutated = false;
    const now = Date.now();
    for (let i = 0; i < list.length; i++) {
      const d = list[i];
      if (!d || d.promptConfig?.REMOTE_GEMINI_STAGE_STATUS !== 'running') continue;
      const raw = d.promptConfig?.REMOTE_GEMINI_STAGE_COMMAND_JSON;
      if (!raw) continue;
      try {
        const cmd = JSON.parse(raw);
        const stNum = Number(cmd?.stageNumber) || 0;
        const isStage3Job =
          stNum === 5 || stNum === 101 || stNum === 505 || Boolean(cmd?.enableCreateImage) || cmd?.mediaType === 'THUMBNAILS';
        const reqAt = Number(cmd?.requestedAt || 0);
        if (isStage3Job && reqAt > 0 && now - reqAt > 210000) {
          for (const [k, v] of pendingGeminiCommands.entries()) {
            if (v.docId === d.id && (v.stageNumber === stNum || v.stageNumber === 505)) {
              pendingGeminiCommands.delete(k);
            }
          }
          list[i] = {
            ...d,
            promptConfig: {
              ...(d.promptConfig || {}),
              REMOTE_GEMINI_STAGE_STATUS: 'failed',
              REMOTE_GEMINI_STAGE_ERROR: 'Tiempo agotado esperando respuesta de Gemini Web (auto-recuperado).',
            },
            updatedAt: new Date().toISOString(),
          };
          mutated = true;
          publishRemoteMacAck({
            commandId: String(cmd?.commandId || d.promptConfig?.REMOTE_GEMINI_STAGE_ACK_ID || ''),
            docId: d.id,
            status: 'gemini_stage_failed',
          });
        }
      } catch {}
    }
    if (mutated) {
      writeDocumentaries(list);
      syncDocumentariesWithGitHubServer(true).catch(() => null);
    }
  } catch {}
}

// ===== Remote Gemini Stage (Paso 1 / Paso 2 Deep Research & Stage 3 Thumbnail launched from mobile) =====
function enqueueRemoteGeminiStageFromDoc(doc: any): boolean {
  try {
    const raw = doc?.promptConfig?.REMOTE_GEMINI_STAGE_COMMAND_JSON;
    if (!raw) return false;
    const cmd = JSON.parse(raw);
    if (!cmd?.commandId || !cmd.prompt) return false;
    if (processedRemoteCommandIds.has(cmd.commandId)) return false;
    if (doc.promptConfig?.REMOTE_GEMINI_STAGE_ACK_ID === cmd.commandId) return false;
    if (Date.now() - Number(cmd.requestedAt || 0) > 2 * 60 * 60 * 1000) return false;
    processedRemoteCommandIds.add(cmd.commandId);
    const resolvedDocId = String(doc.id || cmd.docId || '');
    const isThumbImageCmd =
      Number(cmd.stageNumber) === 505 || Boolean(cmd.enableCreateImage) || cmd.mediaType === 'THUMBNAILS';
    const resolvedStageNum = isThumbImageCmd ? 505 : Number(cmd.stageNumber) || 1;

    // Anti-burst deduplication: block identical (docId, stage, option) fired multiple times within 15s
    const burstKey = `${resolvedDocId}::${resolvedStageNum}::${String(cmd.optionLabel || '').toUpperCase()}`;
    const prevBurstTs = recentRemoteStageBurstGuard.get(burstKey) || 0;
    if (
      (resolvedStageNum === 5 || resolvedStageNum === 101 || resolvedStageNum === 505) &&
      Date.now() - prevBurstTs < 15000
    ) {
      try {
        const list = readDocumentaries();
        const idx = list.findIndex((d) => d && d.id === doc.id);
        if (idx !== -1) {
          list[idx] = {
            ...list[idx],
            promptConfig: {
              ...(list[idx].promptConfig || {}),
              REMOTE_GEMINI_STAGE_ACK_ID: cmd.commandId,
            },
          };
          writeDocumentaries(list);
        }
      } catch {}
      console.log(`[RemoteGeminiStage] Ignorado duplicado en ráfaga ${cmd.commandId} (${burstKey})`);
      return false;
    }
    recentRemoteStageBurstGuard.set(burstKey, Date.now());

    // Remove any older unclaimed pending command for the same (docId, stageNumber)
    for (const [existingKey, existingVal] of pendingGeminiCommands.entries()) {
      if (existingVal.docId === resolvedDocId && existingVal.stageNumber === resolvedStageNum && !existingVal.claimedAt) {
        pendingGeminiCommands.delete(existingKey);
      }
    }

    // Persist idempotency (survives server restarts) + status for the phone
    try {
      const list = readDocumentaries();
      const idx = list.findIndex((d) => d && d.id === doc.id);
      if (idx !== -1) {
        list[idx] = {
          ...list[idx],
          promptConfig: {
            ...(list[idx].promptConfig || {}),
            REMOTE_GEMINI_STAGE_ACK_ID: cmd.commandId,
            REMOTE_GEMINI_STAGE_STATUS: 'running',
            REMOTE_GEMINI_STAGE_ERROR: '',
          },
          updatedAt: new Date().toISOString(),
        };
        writeDocumentaries(list);
      }
    } catch {}
    console.log(`[RemoteGeminiStage] Encolado ${cmd.commandId} (etapa ${resolvedStageNum}) para ${resolvedDocId}`);
    publishRemoteMacAck({ commandId: cmd.commandId, docId: resolvedDocId, status: 'gemini_stage_running' });

    if (Date.now() - lastHuellasAppWindowPollAt > 5000) {
      wakeExtensionInHuellasAppBrowser();
    }

    // Stage 505: Remote Thumbnail Image Generation launched from Mobile (`Create image` + Official Logo on Mac)
    // Runs in a NEW Chrome window (if none idle) on a NEW clean chat WITHOUT Notebook linkage
    if (isThumbImageCmd) {
      const incomingLogo = String(cmd.logoDataUrl || '').trim();
      const serverLogo = resolveOfficialLogoPayloadServer().logoDataUrl;
      if (incomingLogo.startsWith('data:image/') && !serverLogo) {
        persistOfficialLogoPayloadServer(incomingLogo);
      }
      const logoDataUrl = incomingLogo.startsWith('data:image/') ? incomingLogo : serverLogo;
      const optLabel = String(cmd.optionLabel || cmd.option || 'A').trim().toUpperCase();
      const thumbPromptClean = String(cmd.prompt || '').replace(/\r\n/g, '\n').trim();

      // Save Logo_Huellas_de_la_Humanidad.png + Prompts_Miniatura.txt silently into 03_Miniaturas on Mac
      try {
        const docTitleHint = `${doc?.title || ''} ${doc?.topic || ''}`.trim();
        const resolvedRoot = resolveLocalDocumentaryFolder(
          doc?.downloadFolderPath || '',
          doc?.downloadFolderName || '',
          docTitleHint
        );
        if (resolvedRoot) {
          ensureDocumentarySubfolders(resolvedRoot);
          const thumbsDir = path.join(resolvedRoot, '03_Miniaturas');
          if (!fs.existsSync(thumbsDir)) fs.mkdirSync(thumbsDir, { recursive: true });
          if (logoDataUrl.startsWith('data:image/')) {
            const logoBuf = Buffer.from(logoDataUrl.replace(/^data:[^;]+;base64,/, ''), 'base64');
            const logoTarget = path.join(thumbsDir, 'Logo_Huellas_de_la_Humanidad.png');
            fs.writeFileSync(logoTarget, logoBuf);
            try {
              execSync(`chflags nohidden "${logoTarget.replace(/"/g, '\\"')}"`, { stdio: 'ignore' });
            } catch {}
          }
          const txtTarget = path.join(thumbsDir, 'Prompts_Miniatura.txt');
          fs.writeFileSync(
            txtTarget,
            `=== OPCIÓN ${optLabel} (MINIATURA SELECCIONADA - GEMINI WEB CREATE IMAGE) ===\n\n${String(cmd.prompt || '').trim()}\n`,
            'utf8'
          );
          try {
            execSync(`chflags nohidden "${txtTarget.replace(/"/g, '\\"')}"`, { stdio: 'ignore' });
          } catch {}
        }
      } catch (e) {
        console.warn('[RemoteGeminiStage 505] Error preparando 03_Miniaturas en Mac:', e);
      }

      pendingGeminiCommands.set(cmd.commandId, {
        commandId: cmd.commandId,
        docId: resolvedDocId,
        action: 'SEND_PROMPT',
        prompt: thumbPromptClean,
        logoDataUrl,
        aspectRatio: String(cmd.aspectRatio || '16:9'),
        stageNumber: 505,
        taskType: 'THUMBNAIL_IMAGE_GENERATION',
        enableHighModel: false,
        enableArgonLow: true,
        enableCarbonLow: true,
        preferredModel: 'CARBON_4_LOW',
        thinkingLevel: 'LOW',
        enableDeepResearch: false,
        enableCreateImage: true,
        standaloneNewChat: true,
        noNotebook: true,
        mediaType: 'THUMBNAILS',
        option: optLabel,
        optionLabel: optLabel,
        skipModelSwitch: false,
        autoSubmit: true,
        focusTab: false,
        videoName: '',
        deepResearchVideoName: '',
        geminiChatUrl: '',
        geminiDeepResearchChatUrl: '',
        notebookName: '',
        createdAt: Date.now(),
        remoteStage: false,
        noReclaim: true,
        remoteCommandId: cmd.commandId,
      } as any);
      return true;
    }

    // Stage 5 (Neuropsychological Click Triggers), Stage 101 & Stage 6 (@Referencias 6 Views) preserve structured newlines and run INSIDE the documentary's chat
    // (opening a new Chrome window on the documentary's chat if none is open or open ones are in use)
    const safePrompt =
      resolvedStageNum === 4 ||
      resolvedStageNum === 5 ||
      resolvedStageNum === 6 ||
      resolvedStageNum === 8 ||
      resolvedStageNum === 80 ||
      resolvedStageNum === 101
        ? String(cmd.prompt || '').replace(/\r\n/g, '\n').trim()
        : String(cmd.prompt)
            .replace(/\r\n/g, '\n')
            .split('\n')
            .map((l: string) => l.trim())
            .filter(Boolean)
            .join('   |   ');
    pendingGeminiCommands.set(cmd.commandId, {
      commandId: cmd.commandId,
      docId: resolvedDocId,
      action: 'SEND_PROMPT',
      prompt: safePrompt,
      stageNumber: resolvedStageNum,
      ...(Number(cmd.expectedClipCount) > 0
        ? { expectedClipCount: Number(cmd.expectedClipCount) }
        : {}),
      taskType: cmd.taskType || 'STAGE_GENERATION',
      enableHighModel: false,
      enableArgonLow: true,
      enableCarbonLow: true,
      preferredModel: 'CARBON_4_LOW',
      thinkingLevel: 'LOW',
      enableDeepResearch: Boolean(cmd.enableDeepResearch),
      skipModelSwitch: false,
      autoSubmit: true,
      focusTab: false,
      videoName: String(cmd.videoName || doc.title || ''),
      deepResearchVideoName: String(cmd.deepResearchVideoName || `${doc.title || ''}_Deep Research`),
      geminiChatUrl: String(
        doc.geminiChatUrl || doc.promptConfig?.GEMINI_CHAT_URL || cmd.geminiChatUrl || ''
      ),
      geminiDeepResearchChatUrl: String(
        doc.geminiDeepResearchChatUrl ||
          doc.promptConfig?.GEMINI_DEEP_RESEARCH_CHAT_URL ||
          cmd.geminiDeepResearchChatUrl ||
          ''
      ),
      notebookName: 'Huellas de la Humanidad',
      createdAt: Date.now(),
      remoteStage: true,
      remoteCommandId: cmd.commandId,
    });
    return true;
  } catch {
    return false;
  }
}

async function handleRemoteGeminiStageTrigger(trigger: any) {
  const commandId = String(trigger?.commandId || '');
  const docId = String(trigger?.docId || '');
  if (!commandId || !docId || processedRemoteCommandIds.has(commandId) || inFlightRemoteTriggerIds.has(commandId)) {
    return;
  }
  inFlightRemoteTriggerIds.add(commandId);
  try {
    // The full prompt travels through GitHub (ntfy only carries a tiny wake-up ping)
    for (let attempt = 0; attempt < 8; attempt++) {
      if (processedRemoteCommandIds.has(commandId)) return;
      const local = readDocumentaries().find((d) => d && d.id === docId);
      try {
        const raw = local?.promptConfig?.REMOTE_GEMINI_STAGE_COMMAND_JSON;
        if (raw && JSON.parse(raw)?.commandId === commandId) {
          enqueueRemoteGeminiStageFromDoc(local);
          return;
        }
      } catch {}
      await syncDocumentariesWithGitHubServer(true).catch(() => null);
      await new Promise((r) => setTimeout(r, 3000));
    }
  } finally {
    inFlightRemoteTriggerIds.delete(commandId);
  }
}

app.post('/api/gemini-web/remote-stage-result', async (req, res) => {
  const remoteCommandId = String(req.body?.remoteCommandId || '').trim();
  const docId = String(req.body?.docId || '').trim();
  const stageNumber = Number(req.body?.stageNumber) || 1;
  const text = String(req.body?.text || '');
  const trimmed = text.trim();
  if (remoteCommandId) pendingGeminiCommands.delete(remoteCommandId);
  const isError =
    trimmed.length < 400 &&
    /encountering an error|something went wrong|algo sali[oó] mal|se produjo un error|try something else/i.test(trimmed);
  const minValidLen = stageNumber === 101 || stageNumber === 115 ? 6 : 50;
  if (!docId || trimmed.length < minValidLen || isError) {
    try {
      const list = readDocumentaries();
      const idx = list.findIndex((d) => d && d.id === docId);
      if (idx !== -1) {
        list[idx] = {
          ...list[idx],
          promptConfig: {
            ...(list[idx].promptConfig || {}),
            REMOTE_GEMINI_STAGE_STATUS: 'failed',
            REMOTE_GEMINI_STAGE_ERROR: isError ? trimmed.slice(0, 300) : 'Respuesta vacía de Gemini',
          },
          updatedAt: new Date().toISOString(),
        };
        writeDocumentaries(list);
      }
    } catch {}
    publishRemoteMacAck({ commandId: remoteCommandId, docId, status: 'gemini_stage_failed' });
    res.json({ ok: false, error: isError ? 'gemini_error' : 'empty' });
    return;
  }
  try {
    const list = readDocumentaries();
    const idx = list.findIndex((d) => d && d.id === docId);
    if (idx !== -1) {
      const isPart1 = stageNumber === 10;
      const isDeepResearch =
        req.body?.isDeepResearch !== undefined
          ? Boolean(req.body.isDeepResearch)
          : stageNumber === 1 || stageNumber === 2 || stageNumber === 3;
      const STAGE_FIELD_MAP: Record<number, string> = {
        1: 'deepResearchResult',
        2: 'deepResearchResult',
        3: 'deepResearchResult',
        10: 'deepResearchPrompt',
        4: 'voiceoverScript',
        5: 'thumbnailPrompt',
        101: 'thumbnailTextOverlay',
        505: 'thumbnailImageUrl',
        6: 'rawReferencePrompts',
        7: 'clip1OptionsRaw',
        8: 'rawClipsText',
        9: 'correctedSrt',
        80: 'rawSunoText',
        11: 'rawYoutubeMetadata',
        111: 'rawYoutubeMetadata',
        112: 'rawFacebookMetadata',
        113: 'pinnedComment',
        114: 'youtubeTags',
        115: 'publishTitle',
        12: 'commentReplies',
      };
      const fieldKey = STAGE_FIELD_MAP[stageNumber];
      if (!fieldKey) {
        res.status(400).json({ ok: false, error: `Unsupported stageNumber: ${stageNumber}` });
        return;
      }
      const onlyIfEmpty = Boolean(req.body?.onlyIfEmpty);
      const isPartialContinuation = Boolean(req.body?.isPartialContinuation);
      const continuationRound = Number(req.body?.continuationRound || 0);
      const chatUrl = String(req.body?.chatUrl || '').trim();
      const validChatUrl = /^https:\/\/gemini\.google\.com\/(?:u\/\d+\/)?app\/[a-zA-Z0-9_-]{6,}$/.test(chatUrl) ? chatUrl : '';
      const validDrChatUrl = isDeepResearch ? validChatUrl : '';
      if (onlyIfEmpty) {
        const existingVal = list[idx][fieldKey];
        const isStage8Continuation =
          stageNumber === 8 &&
          (isPartialContinuation ||
            continuationRound > 0 ||
            text.length > String(existingVal || '').length ||
            (Boolean(remoteCommandId) &&
              String(list[idx].promptConfig?.REMOTE_GEMINI_STAGE_CMD_ID || '') === remoteCommandId));
        const isBadStage5Existing =
          stageNumber === 5 &&
          (!Array.isArray(list[idx].thumbnailPsychTriggers) ||
            list[idx].thumbnailPsychTriggers.length === 0 ||
            /\((?:Tema Central|Arco Integral|Ruta Principal|Opci[oó]n\s*\d+|F[oó]rmula Exacta)[^)]*\)\s*:|—\s*(?:Recomendada|Arco hist[oó]rico completo|Escenario hist[oó]rico principal)|\[DISPARADOR_[ABC]\]|\bDESCRIPCI[OÓ]N\s*:|enigmatic forbidden historical detail or shadowy betrayal from this exact story/i.test(
              String(existingVal || '')
            ));
        const isAlreadyFilled =
          isBadStage5Existing || isStage8Continuation
            ? false
            : Array.isArray(existingVal)
              ? existingVal.length > 0
              : Boolean(String(existingVal || '').trim());
        if (isAlreadyFilled) {
          res.json({ ok: true, skipped: 'already_filled' });
          return;
        }
      }
      const extraPatch: Record<string, any> = {};
      if (stageNumber === 4) {
        extraPatch.timelineSentences = [];
        extraPatch.timelineFormattedText = '';
      } else if (stageNumber === 5) {
        const isVertThumb =
          list[idx].thumbnailOrientation === 'VERTICAL_9X16' ||
          (!list[idx].thumbnailOrientation &&
            (list[idx].productionType === 'SHORT_9X16' ||
              list[idx].promptConfig?.SUB_OPCION_REELS === '9X16'));
        const thumbOrientationSrv: 'HORIZONTAL_16X9' | 'VERTICAL_9X16' = isVertThumb
          ? 'VERTICAL_9X16'
          : 'HORIZONTAL_16X9';
        const parseOverlayLinesSrv = (rawOv: string) =>
          String(rawOv || '')
            .replace(/\r\n/g, '\n')
            .split('\n')
            .map((l) => l.replace(/["“”']/g, '').replace(/\s+/g, ' ').trim())
            .filter((l) => Boolean(l) && !/^\[?\s*texto\s+en\s+pantalla\s*\]?$/i.test(l));

        const existingUserOv = String(list[idx].thumbnailTextOverlay || '').trim();
        const hasExistingUserOv = parseOverlayLinesSrv(existingUserOv).length > 0;
        const userLockedOv = list[idx].promptConfig?.THUMBNAIL_OVERLAY_USER_LOCKED === 'SI';
        const prevAutoCandidates = new Set(
          [
            ...(Array.isArray(list[idx].thumbnailTextOptions) ? list[idx].thumbnailTextOptions : []),
            ...(Array.isArray(list[idx].thumbnailPsychTriggers)
              ? list[idx].thumbnailPsychTriggers.map((t: any) => t?.suggestedOverlay || '')
              : []),
            '12 AÑOS\nOCULTA',
          ]
            .map((s) => String(s || '').trim().toUpperCase())
            .filter(Boolean)
        );
        const existingWasAutoOption =
          !userLockedOv && (!hasExistingUserOv || prevAutoCandidates.has(existingUserOv.toUpperCase()));

        const sharedParsed = parseStage5TriggerBlocksShared(text);
        const parsedTriggers: Array<{
          id: 'A' | 'B' | 'C';
          title: string;
          description: string;
          prompt: string;
          suggestedOverlay?: string;
        }> = [];
        for (const blk of sharedParsed.blocks) {
          const triggerOverlay =
            userLockedOv && hasExistingUserOv
              ? existingUserOv
              : blk.suggestedOverlay || (hasExistingUserOv ? existingUserOv : '');
          const normalizedPrompt = blk.rawPrompt
            ? cleanAndNormalizeStage5ThumbnailPrompt(
                blk.rawPrompt,
                thumbOrientationSrv,
                triggerOverlay
              )
            : '';
          if (normalizedPrompt && !parsedTriggers.some((t) => t.id === blk.id)) {
            parsedTriggers.push({
              id: blk.id,
              title: blk.title,
              description: blk.description,
              prompt: normalizedPrompt,
              ...(blk.suggestedOverlay ? { suggestedOverlay: blk.suggestedOverlay } : {}),
            });
          }
        }
        parsedTriggers.sort((a, b) => a.id.localeCompare(b.id));
        if (parsedTriggers.length > 0) {
          extraPatch.thumbnailPsychTriggers = parsedTriggers;
          const selVar: 'A' | 'B' | 'C' =
            list[idx].thumbnailPsychVariant === 'B'
              ? 'B'
              : list[idx].thumbnailPsychVariant === 'C'
              ? 'C'
              : 'A';
          const chosen = parsedTriggers.find((t) => t.id === selVar) || parsedTriggers[0];
          const overlays = parsedTriggers
            .map((t) => t.suggestedOverlay)
            .filter((v): v is string => Boolean(v));
          const resolvedActiveOverlay = existingWasAutoOption
            ? chosen.suggestedOverlay || overlays[0] || existingUserOv
            : existingUserOv;
          extraPatch.thumbnailPsychVariant = chosen.id;
          extraPatch.thumbnailPrompt = cleanAndNormalizeStage5ThumbnailPrompt(
            chosen.prompt,
            thumbOrientationSrv,
            resolvedActiveOverlay
          );
          if (overlays.length > 0 && (!Array.isArray(list[idx].thumbnailTextOptions) || list[idx].thumbnailTextOptions.length === 0)) {
            extraPatch.thumbnailTextOptions = overlays;
          }
          if (resolvedActiveOverlay) {
            extraPatch.thumbnailTextOverlay = resolvedActiveOverlay;
          }
        } else if (sharedParsed.directEnglishCandidate) {
          extraPatch.thumbnailPrompt = cleanAndNormalizeStage5ThumbnailPrompt(
            sharedParsed.directEnglishCandidate,
            thumbOrientationSrv,
            existingUserOv
          );
        }
      } else if (stageNumber === 6) {
        const cleanedRefText = sanitizeBrandSafeEditorialText(text);
        const parsedRefs = parseReferencesFromRawText(cleanedRefText);
        if (parsedRefs.length > 0) {
          const prevRefs = Array.isArray(list[idx].references) ? list[idx].references : [];
          const prevBySlug = new Map<string, any>();
          for (const oldRef of prevRefs) {
            if (oldRef?.tag) {
              prevBySlug.set(normalizeReferenceTagSlug(String(oldRef.tag)), oldRef);
            }
          }
          extraPatch.references = parsedRefs.map((p, rIdx) => {
            const slug = normalizeReferenceTagSlug(p.tag || '', rIdx + 1);
            const prev = prevBySlug.get(slug);
            return {
              ...p,
              id: prev?.id || p.id,
              tag: slug,
              imageUrl: prev?.imageUrl || p.imageUrl,
              isCreated: Boolean(prev?.isCreated || prev?.imageUrl),
            };
          });
        }
      } else if (stageNumber === 8) {
        const eng8 =
          list[idx].flowVideoEngine === 'OMNI_1_1_FLASH' || list[idx].flowVideoEngine === 'VEO_3_1_LITE_LOWER_PRIORITY'
            ? list[idx].flowVideoEngine
            : 'HYBRID_PEOPLE_OMNI_REST_LOWER';
        const cleanOpHeader = sanitizeOperationalHeaderServer(list[idx].operationalHeader, eng8);
        extraPatch.operationalHeader = cleanOpHeader;
        extraPatch.rawClipsText = ensureOperationalHeaderText(sanitizeBrandSafeEditorialText(text), cleanOpHeader, eng8);
      } else if (stageNumber === 9) {
        extraPatch.correctedSrt = text
          .replace(/^```(?:srt|txt|plaintext)?\s*\n?/i, '')
          .replace(/\n?```\s*$/i, '')
          .trim();
      } else if (stageNumber === 101) {
        const opts = parseStage101ShortHooksShared(text);
        if (opts.length > 0) {
          extraPatch.thumbnailTextOptions = opts;
          const userLockedOv = list[idx].promptConfig?.THUMBNAIL_OVERLAY_USER_LOCKED === 'SI';
          const curOv = String(list[idx].thumbnailTextOverlay || '').trim();
          const chosenOv = userLockedOv && curOv ? curOv : opts[0];
          extraPatch.thumbnailTextOverlay = chosenOv;
          const isVert101 =
            list[idx].thumbnailOrientation === 'VERTICAL_9X16' ||
            (!list[idx].thumbnailOrientation &&
              (list[idx].productionType === 'SHORT_9X16' ||
                list[idx].promptConfig?.SUB_OPCION_REELS === '9X16'));
          const orient101: 'HORIZONTAL_16X9' | 'VERTICAL_9X16' = isVert101 ? 'VERTICAL_9X16' : 'HORIZONTAL_16X9';
          if (String(list[idx].thumbnailPrompt || '').trim()) {
            extraPatch.thumbnailPrompt = cleanAndNormalizeStage5ThumbnailPrompt(
              String(list[idx].thumbnailPrompt || ''),
              orient101,
              chosenOv
            );
          }
        }
      } else if (stageNumber === 115) {
        const firstTitle = text
          .split(/\r?\n/)
          .map((l: string) =>
            l
              .replace(/^\s*(?:t[ií]tulo\s*\d+[:.)\-\s]*|opci[oó]n\s*\d+[:.)\-\s]*|\d+[:.)\-\s]+|[-•*]\s*)/i, '')
              .replace(/^["'«»“”]+|["'«»“”]+$/g, '')
              .trim()
          )
          .filter(Boolean)[0];
        if (firstTitle) {
          extraPatch.publishTitle = firstTitle;
        }
      } else if (stageNumber === 12) {
        const prevReplies = Array.isArray(list[idx].commentReplies) ? list[idx].commentReplies : [];
        extraPatch.commentReplies = [
          {
            id: `cr-${Date.now()}`,
            comment: String(list[idx].promptConfig?.LAST_AUDIENCE_COMMENT || 'Comentario de audiencia'),
            reply: text.trim(),
            createdAt: new Date().toISOString(),
          },
          ...prevReplies,
        ];
      } else if (stageNumber === 11 || stageNumber === 111) {
        extraPatch.rawMetadataText = text;
      }
      const existingMainUrl = String(
        list[idx].geminiChatUrl || list[idx].promptConfig?.GEMINI_CHAT_URL || ''
      ).trim();
      const existingDeepUrl = String(
        list[idx].geminiDeepResearchChatUrl || list[idx].promptConfig?.GEMINI_DEEP_RESEARCH_CHAT_URL || ''
      ).trim();
      const replacesDeletedChat = Boolean(req.body?.replacesDeletedChat);
      const preserveExistingChatUrl = Boolean(req.body?.preserveExistingChatUrl);
      const nextMainChatUrl = preserveExistingChatUrl
        ? existingMainUrl
        : !isDeepResearch && validChatUrl && validChatUrl !== existingDeepUrl
          ? existingMainUrl && !replacesDeletedChat
            ? existingMainUrl
            : validChatUrl
          : existingMainUrl;
      const nextDeepChatUrl =
        isDeepResearch && validDrChatUrl && validDrChatUrl !== existingMainUrl
          ? existingDeepUrl && !replacesDeletedChat
            ? existingDeepUrl
            : validDrChatUrl
          : existingDeepUrl;

      list[idx] = {
        ...list[idx],
        ...([5, 8, 101, 115, 12].includes(stageNumber)
          ? {}
          : {
              [fieldKey]:
                stageNumber === 4
                  ? normalizeFirstDayOfMonthInVoiceover(
                      sanitizeBrandSafeEditorialText(
                        autoFitVoiceoverScriptToDuration(text, list[idx])
                      )
                    )
                  : stageNumber === 9
                    ? text
                    : sanitizeBrandSafeEditorialText(text),
            }),
        ...extraPatch,
        ...(nextDeepChatUrl ? { geminiDeepResearchChatUrl: nextDeepChatUrl } : {}),
        ...(nextMainChatUrl ? { geminiChatUrl: nextMainChatUrl } : {}),
        promptConfig: {
          ...(list[idx].promptConfig || {}),
          REMOTE_GEMINI_STAGE_STATUS: isPartialContinuation ? 'running' : 'completed',
          REMOTE_GEMINI_STAGE_ERROR: '',
          [`FIELD_CLEARED_AT_${fieldKey}`]: '0',
          ...(!isPartialContinuation && remoteCommandId ? { REMOTE_GEMINI_STAGE_ACK_ID: remoteCommandId } : {}),
          ...(isDeepResearch ? { DEEP_RESEARCH_RESULT_UPDATED_AT: String(Date.now()) } : {}),
          ...(nextMainChatUrl ? { GEMINI_CHAT_URL: nextMainChatUrl } : {}),
          ...(nextDeepChatUrl ? { GEMINI_DEEP_RESEARCH_CHAT_URL: nextDeepChatUrl } : {}),
        },
        updatedAt: new Date().toISOString(),
      };
      writeDocumentaries(list);
      console.log(`[RemoteGeminiStage] Resultado etapa ${stageNumber} (${fieldKey}, ${text.length} chars, partial=${isPartialContinuation}) guardado en ${docId}`);
      await syncDocumentariesWithGitHubServer(true).catch(() => null);
    }
  } catch (e) {
    console.warn('[RemoteGeminiStage] Error guardando resultado:', e);
  }
  publishRemoteMacAck({
    commandId: remoteCommandId,
    docId,
    status: req.body?.isPartialContinuation ? 'gemini_stage_partial' : 'gemini_stage_completed',
  });
  res.json({ ok: true });
});

app.post('/api/gemini-web/link-chat', (req, res) => {
  try {
    const docId = String(req.body?.docId || '').trim();
    const rawUrl = String(req.body?.geminiChatUrl || req.body?.chatUrl || '').trim().split(/[?#]/)[0];
    const chatTitle = String(req.body?.geminiChatTitle || req.body?.chatTitle || '').trim();
    const isDeepResearch = Boolean(req.body?.isDeepResearch) || /_\s*deep\s*research$/i.test(chatTitle);
    const replacesDeletedChat = Boolean(req.body?.replacesDeletedChat);
    if (!docId || !/^https:\/\/gemini\.google\.com\/(?:u\/\d+\/)?app\/[a-zA-Z0-9_-]{6,}$/.test(rawUrl)) {
      res.json({ ok: false, skipped: true });
      return;
    }
    const list = readDocumentaries();
    const idx = list.findIndex((d) => d && d.id === docId);
    if (idx === -1) {
      res.json({ ok: false, error: 'doc_not_found' });
      return;
    }
    const cur = list[idx];
    const existingMainUrl = String(cur.geminiChatUrl || cur.promptConfig?.GEMINI_CHAT_URL || '').trim();
    const existingDeepUrl = String(
      cur.geminiDeepResearchChatUrl || cur.promptConfig?.GEMINI_DEEP_RESEARCH_CHAT_URL || ''
    ).trim();

    if (isDeepResearch) {
      if (existingMainUrl && rawUrl === existingMainUrl) {
        res.json({ ok: false, skipped: 'collision_with_main' });
        return;
      }
      if (existingDeepUrl && existingDeepUrl !== rawUrl && !replacesDeletedChat) {
        res.json({ ok: true, preservedExisting: existingDeepUrl });
        return;
      }
      list[idx] = {
        ...cur,
        geminiDeepResearchChatUrl: rawUrl,
        promptConfig: {
          ...(cur.promptConfig || {}),
          GEMINI_DEEP_RESEARCH_CHAT_URL: rawUrl,
          ...(chatTitle ? { GEMINI_DEEP_RESEARCH_CHAT_TITLE: chatTitle } : {}),
        },
        updatedAt: new Date().toISOString(),
      };
      writeDocumentaries(list);
      res.json({ ok: true, slot: 'DEEP_RESEARCH', url: rawUrl });
      return;
    }

    if (existingDeepUrl && rawUrl === existingDeepUrl) {
      res.json({ ok: false, skipped: 'collision_with_deep_research' });
      return;
    }
    if (existingMainUrl && existingMainUrl !== rawUrl && !replacesDeletedChat) {
      res.json({ ok: true, preservedExisting: existingMainUrl });
      return;
    }
    list[idx] = {
      ...cur,
      geminiChatUrl: rawUrl,
      ...(chatTitle ? { geminiChatTitle: chatTitle } : {}),
      promptConfig: {
        ...(cur.promptConfig || {}),
        GEMINI_CHAT_URL: rawUrl,
      },
      updatedAt: new Date().toISOString(),
    };
    writeDocumentaries(list);
    res.json({ ok: true, slot: 'MAIN', url: rawUrl });
  } catch (e: any) {
    res.status(500).json({ ok: false, error: String(e?.message || e) });
  }
});

function handleIncomingRemoteRelayLine(line: string) {
  if (!line || !line.trim()) return;
  try {
    const evt = JSON.parse(line);
    if (evt?.event !== 'message' || !evt.message) return;
    const cmd = JSON.parse(evt.message);
    if (cmd && cmd.type === 'REMOTE_GEMINI_STAGE' && cmd.commandId && cmd.docId) {
      console.log(`[RemoteRelay] Orden remota de Gemini (etapa ${cmd.stageNumber}) ${cmd.commandId}`);
      handleRemoteGeminiStageTrigger(cmd).catch(() => {});
      return;
    }
    // ntfy is a PUBLIC topic: treat rename messages only as a wake-up ping. The real order
    // (newName / paths) is read from REMOTE_RENAME_COMMAND_JSON in GitHub (write access needs the token).
    if (cmd && cmd.type === 'REMOTE_RENAME_VIDEO' && cmd.commandId && cmd.docId) {
      handleRemoteRenameTrigger(cmd).catch(() => {});
    }
  } catch {}
}

async function handleRemoteRenameTrigger(trigger: any) {
  const commandId = String(trigger?.commandId || '').trim();
  const docId = String(trigger?.docId || '').trim();
  if (!commandId || !docId || processedRemoteCommandIds.has(commandId)) return;
  for (let attempt = 0; attempt < 8; attempt++) {
    const local = readDocumentaries().find((d) => d && d.id === docId);
    try {
      const raw = local?.promptConfig?.REMOTE_RENAME_COMMAND_JSON;
      const verified = raw ? JSON.parse(raw) : null;
      if (verified?.commandId === commandId && verified.newName) {
        if (processedRemoteCommandIds.has(commandId)) return;
        if (local.promptConfig?.REMOTE_RENAME_ACK_ID === commandId) return;
        if (Date.now() - Number(verified.requestedAt || 0) > 24 * 60 * 60 * 1000) return;
        processedRemoteCommandIds.add(commandId);
        console.log(`[RemoteRelay] Rename ${commandId} verificado en GitHub -> "${verified.newName}"`);
        performMacFolderRenameCore({
          docId: local.id,
          newName: verified.newName,
          oldFolderName: verified.oldFolderName,
          oldFolderPath: verified.oldFolderPath,
          commandId,
          enqueueGeminiRename: true,
        });
        return;
      }
    } catch {}
    await syncDocumentariesWithGitHubServer(true).catch(() => null);
    await new Promise((r) => setTimeout(r, 2500));
  }
  console.warn(`[RemoteRelay] Rename ${commandId} ignorado: no coincide con ninguna orden en GitHub.`);
}

let isRemoteRelayStreamActive = false;
async function startRemoteMacRelayStream() {
  if (isRemoteRelayStreamActive) return;
  isRemoteRelayStreamActive = true;
  while (true) {
    try {
      const res = await fetch(`${REMOTE_MAC_RELAY_URL}/json?since=30s`, {
        headers: { 'Cache-Control': 'no-cache' },
      });
      if (res.ok && res.body) {
        const reader = (res.body as any).getReader();
        const decoder = new TextDecoder();
        let buffer = '';
        while (true) {
          const { value, done } = await reader.read();
          if (done) break;
          buffer += decoder.decode(value, { stream: true });
          const lines = buffer.split(/\r?\n/);
          buffer = lines.pop() || '';
          for (const line of lines) {
            handleIncomingRemoteRelayLine(line);
          }
        }
      }
    } catch {}
    await new Promise((r) => setTimeout(r, 8000));
  }
}
startRemoteMacRelayStream();

let lastCheckedGitHubDocsSha = '';
let isCheckingGitHubDocsSha = false;
async function checkGitHubRemoteRenameCommands() {
  if (isCheckingGitHubDocsSha) return;
  isCheckingGitHubDocsSha = true;
  try {
    expireStaleRunningStage3JobsServer();
    const token = getLocalGitHubToken();
    if (!token) return;
    const sha = await getServerGitHubFileSha('data/documentaries.json', token);
    if (sha && sha !== lastCheckedGitHubDocsSha) {
      lastCheckedGitHubDocsSha = sha;
      await syncDocumentariesWithGitHubServer(true);
    }
    const docs = readDocumentaries();
    for (const d of docs) {
      if (d?.promptConfig?.REMOTE_GEMINI_STAGE_COMMAND_JSON) {
        enqueueRemoteGeminiStageFromDoc(d);
      }
      const rawCmd = d?.promptConfig?.REMOTE_RENAME_COMMAND_JSON;
      if (!rawCmd) continue;
      try {
        const cmd = JSON.parse(rawCmd);
        const ackId = d?.promptConfig?.REMOTE_RENAME_ACK_ID || '';
        if (
          cmd?.commandId &&
          cmd.newName &&
          cmd.commandId !== ackId &&
          !processedRemoteCommandIds.has(cmd.commandId)
        ) {
          processedRemoteCommandIds.add(cmd.commandId);
          console.log(`[GitHubRelay] Executing remote rename command ${cmd.commandId} -> "${cmd.newName}"`);
          performMacFolderRenameCore({
            docId: d.id,
            newName: cmd.newName,
            oldFolderName: cmd.oldFolderName,
            oldFolderPath: cmd.oldFolderPath,
            commandId: cmd.commandId,
            enqueueGeminiRename: true,
          });
        }
      } catch {}
    }
  } catch {
  } finally {
    isCheckingGitHubDocsSha = false;
  }
}
setInterval(checkGitHubRemoteRenameCommands, 4500);

app.post('/api/gemini-web/ask-external-claim', (req, res) => {
  const id = String(req.body?.id || '').trim();
  const item = pendingExternalGeminiAsks.get(id);
  if (!item) {
    res.status(404).json({ ok: false, error: 'not_found' });
    return;
  }
  const isAttachingWindow = req.body?.windowId !== undefined || req.body?.tabId !== undefined;
  if (!isAttachingWindow) {
    const hasAppWindow = Boolean(req.body?.hasAppWindow);
    const hasWorkspace = Boolean(req.body?.hasWorkspace);
    const allowFallback = Date.now() - lastHuellasAppWindowPollAt > 15000;
    if (!hasAppWindow && !(allowFallback && hasWorkspace)) {
      res.status(409).json({ ok: false, error: 'wrong_browser_profile' });
      return;
    }
    if (item.claimed) {
      res.status(409).json({ ok: false, error: 'already_claimed' });
      return;
    }
    item.claimed = true;
  } else {
    item.claimed = true;
    if (req.body?.windowId) item.windowId = Number(req.body.windowId) || null;
    if (req.body?.tabId) item.tabId = Number(req.body.tabId) || null;
  }
  res.json({ ok: true, id });
});

app.post('/api/gemini-web/ask-external-result', (req, res) => {
  const id = String(req.body?.requestId || req.body?.id || '').trim();
  const chatUrl = String(req.body?.chatUrl || '').trim();
  const item = pendingExternalGeminiAsks.get(id);
  if (!item) {
    if (chatUrl) {
      closeTemporaryGeminiWindowFailsafe({ chatUrl });
    }
    res.json({ ok: false, error: 'already_resolved_or_not_found' });
    return;
  }
  clearTimeout(item.timer);
  pendingExternalGeminiAsks.delete(id);
  item.chatUrl = chatUrl || item.chatUrl;
  closeTemporaryGeminiWindowFailsafe({
    windowId: item.windowId,
    tabId: item.tabId,
    chatUrl: item.chatUrl,
  });
  item.resolve({
    ok: Boolean(req.body?.ok !== false),
    verifiedModel: req.body?.verifiedModel ? String(req.body.verifiedModel) : undefined,
    response: String(req.body?.response || req.body?.text || ''),
    chatUrl,
    error: req.body?.error ? String(req.body.error) : undefined,
  });
  res.json({ ok: true });
});

app.post('/api/gemini-web/ask-external', async (req, res) => {
  const prompt = String(req.body?.prompt || '').trim();
  if (!prompt) {
    res.status(400).json({ ok: false, error: 'Falta el campo prompt.' });
    return;
  }
  const timeoutMs = Math.min(Math.max(Number(req.body?.timeoutMs) || 300000, 15000), 360000);
  const id = `ext_gem_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;

  const resultPromise = new Promise<{
    ok: boolean;
    verifiedModel?: string;
    response?: string;
    chatUrl?: string;
    error?: string;
  }>((resolve) => {
    const timer = setTimeout(() => {
      const expired = pendingExternalGeminiAsks.get(id);
      pendingExternalGeminiAsks.delete(id);
      if (expired) {
        closeTemporaryGeminiWindowFailsafe({
          windowId: expired.windowId,
          tabId: expired.tabId,
          chatUrl: expired.chatUrl,
        });
      }
      resolve({
        ok: false,
        error: `Timeout esperando respuesta de Gemini Web tras ${Math.round(timeoutMs / 1000)}s.`,
      });
    }, timeoutMs);
    pendingExternalGeminiAsks.set(id, {
      id,
      prompt,
      createdAt: Date.now(),
      claimed: false,
      resolve,
      timer,
    });

    res.on('close', () => {
      if (res.writableEnded) return;
      const aborted = pendingExternalGeminiAsks.get(id);
      if (aborted) {
        clearTimeout(aborted.timer);
        pendingExternalGeminiAsks.delete(id);
        closeTemporaryGeminiWindowFailsafe({
          windowId: aborted.windowId,
          tabId: aborted.tabId,
          chatUrl: aborted.chatUrl,
        });
      }
    });

    setTimeout(() => {
      const current = pendingExternalGeminiAsks.get(id);
      if (current && !current.claimed && Date.now() - lastHuellasAppWindowPollAt > 5000) {
        wakeExtensionInHuellasAppBrowser();
      }
    }, 2200);
  });

  const outcome = await resultPromise;
  res.status(outcome.ok ? 200 : 504).json(outcome);
});

function runInternalSilentGeminiCarbonLow(
  prompt: string,
  timeoutMs = 180000
): Promise<{
  ok: boolean;
  verifiedModel?: string;
  response?: string;
  chatUrl?: string;
  error?: string;
}> {
  const cleanPrompt = String(prompt || '').trim();
  if (!cleanPrompt) {
    return Promise.resolve({ ok: false, error: 'Prompt vacío.' });
  }
  const boundedTimeout = Math.min(Math.max(Number(timeoutMs) || 180000, 15000), 360000);
  const id = `ext_gem_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;

  return new Promise((resolve) => {
    const timer = setTimeout(() => {
      const expired = pendingExternalGeminiAsks.get(id);
      pendingExternalGeminiAsks.delete(id);
      if (expired) {
        closeTemporaryGeminiWindowFailsafe({
          windowId: expired.windowId,
          tabId: expired.tabId,
          chatUrl: expired.chatUrl,
        });
      }
      resolve({
        ok: false,
        error: `Timeout esperando respuesta de Gemini Web tras ${Math.round(boundedTimeout / 1000)}s.`,
      });
    }, boundedTimeout);

    pendingExternalGeminiAsks.set(id, {
      id,
      prompt: cleanPrompt,
      createdAt: Date.now(),
      claimed: false,
      resolve,
      timer,
    });

    if (Date.now() - lastHuellasAppWindowPollAt > 5000) {
      wakeExtensionInHuellasAppBrowser();
    }
    setTimeout(() => {
      const current = pendingExternalGeminiAsks.get(id);
      if (current && !current.claimed) {
        wakeExtensionInHuellasAppBrowser();
      }
    }, 2800);
  });
}

app.post('/api/stage5-triggers/generate', async (req, res) => {
  const docId = String(req.body?.docId || '').trim();
  const prompt = String(req.body?.prompt || '').trim();
  if (!docId || !prompt) {
    res.status(400).json({ ok: false, error: 'Faltan docId o prompt.' });
    return;
  }
  const outcome = await runInternalSilentGeminiCarbonLow(prompt, 180000);
  if (!outcome.ok || !String(outcome.response || '').trim()) {
    res.status(504).json({
      ok: false,
      error: outcome.error || 'No se recibió respuesta de Gemini Web para los disparadores.',
    });
    return;
  }
  await fetch(`http://127.0.0.1:${PORT}/api/gemini-web/remote-stage-result`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      docId,
      stageNumber: 5,
      isDeepResearch: false,
      preserveExistingChatUrl: true,
      text: String(outcome.response || ''),
    }),
  }).catch(() => {});

  const updatedDoc = readDocumentaries().find((d) => d && d.id === docId) || null;
  res.json({
    ok: true,
    verifiedModel: outcome.verifiedModel,
    rawText: outcome.response,
    doc: updatedDoc,
    triggers: updatedDoc?.thumbnailPsychTriggers || [],
  });
});

app.post('/api/chatgpt-web/ask-external-claim', (req, res) => {
  const id = String(req.body?.id || '').trim();
  const item = pendingExternalChatGptAsks.get(id);
  if (!item) {
    res.json({ ok: false, error: 'not_found' });
    return;
  }
  const isAttachingWindow = req.body?.windowId !== undefined || req.body?.tabId !== undefined;
  if (!isAttachingWindow) {
    const hasAppWindow = Boolean(req.body?.hasAppWindow);
    const hasWorkspace = Boolean(req.body?.hasWorkspace);
    const allowFallback = Date.now() - lastHuellasAppWindowPollAt > 15000;
    if (!hasAppWindow && !(allowFallback && hasWorkspace)) {
      res.status(409).json({ ok: false, error: 'wrong_browser_profile' });
      return;
    }
    if (item.claimed) {
      res.status(409).json({ ok: false, error: 'already_claimed' });
      return;
    }
    item.claimed = true;
  } else {
    item.claimed = true;
    if (req.body?.windowId) item.windowId = Number(req.body.windowId) || null;
    if (req.body?.tabId) item.tabId = Number(req.body.tabId) || null;
    if (req.body?.reusedExisting !== undefined) {
      item.reusedExisting = Boolean(req.body.reusedExisting);
    }
  }
  res.json({ ok: true, id });
});

app.post('/api/chatgpt-web/ask-external-result', (req, res) => {
  const id = String(req.body?.requestId || req.body?.id || '').trim();
  const chatUrl = String(req.body?.chatUrl || '').trim();
  const bodyTabId = Number(req.body?.tabId) || null;
  const bodyWinId = Number(req.body?.windowId) || null;
  const bodyReused = Boolean(req.body?.reusedExisting);
  const item = pendingExternalChatGptAsks.get(id);
  if (!item) {
    if (!bodyReused && (chatUrl || bodyTabId || bodyWinId)) {
      closeTemporaryChatGptWindowFailsafe({ windowId: bodyWinId, tabId: bodyTabId, chatUrl });
    }
    res.json({ ok: false, error: 'already_resolved_or_not_found' });
    return;
  }
  clearTimeout(item.timer);
  pendingExternalChatGptAsks.delete(id);
  item.chatUrl = chatUrl || item.chatUrl;
  const keepOpen = Boolean(item.reusedExisting || bodyReused);
  if (!keepOpen) {
    closeTemporaryChatGptWindowFailsafe({
      windowId: item.windowId || bodyWinId,
      tabId: item.tabId || bodyTabId,
      chatUrl: item.chatUrl,
    });
  }
  item.resolve({
    ok: Boolean(req.body?.ok !== false),
    verifiedModel: req.body?.verifiedModel ? String(req.body.verifiedModel) : undefined,
    response: String(req.body?.response || req.body?.text || ''),
    chatUrl,
    error: req.body?.error ? String(req.body.error) : undefined,
  });
  res.json({ ok: true });
});

app.post('/api/chatgpt-web/ask-external', async (req, res) => {
  const prompt = String(req.body?.prompt || '').trim();
  if (!prompt) {
    res.status(400).json({ ok: false, error: 'Falta el campo prompt.' });
    return;
  }
  const timeoutMs = Math.min(Math.max(Number(req.body?.timeoutMs) || 300000, 15000), 360000);
  const id = `ext_gpt_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;

  const resultPromise = new Promise<{
    ok: boolean;
    verifiedModel?: string;
    response?: string;
    chatUrl?: string;
    error?: string;
  }>((resolve) => {
    const timer = setTimeout(() => {
      const expired = pendingExternalChatGptAsks.get(id);
      pendingExternalChatGptAsks.delete(id);
      if (expired && !expired.reusedExisting) {
        closeTemporaryChatGptWindowFailsafe({
          windowId: expired.windowId,
          tabId: expired.tabId,
          chatUrl: expired.chatUrl,
        });
      }
      resolve({
        ok: false,
        error: `Timeout esperando respuesta de ChatGPT Web tras ${Math.round(timeoutMs / 1000)}s.`,
      });
    }, timeoutMs);
    pendingExternalChatGptAsks.set(id, {
      id,
      prompt,
      createdAt: Date.now(),
      claimed: false,
      resolve,
      timer,
    });

    res.on('close', () => {
      if (res.writableEnded) return;
      const aborted = pendingExternalChatGptAsks.get(id);
      if (aborted) {
        clearTimeout(aborted.timer);
        pendingExternalChatGptAsks.delete(id);
        if (!aborted.reusedExisting) {
          closeTemporaryChatGptWindowFailsafe({
            windowId: aborted.windowId,
            tabId: aborted.tabId,
            chatUrl: aborted.chatUrl,
          });
        }
      }
    });

    setTimeout(() => {
      const current = pendingExternalChatGptAsks.get(id);
      if (current && !current.claimed && Date.now() - lastHuellasAppWindowPollAt > 5000) {
        wakeExtensionInHuellasAppBrowser();
      }
    }, 2200);
  });

  const outcome = await resultPromise;
  res.status(outcome.ok ? 200 : 504).json(outcome);
});

app.post('/api/copilot-web/ask-external-claim', (req, res) => {
  const id = String(req.body?.id || '').trim();
  const item = pendingExternalCopilotAsks.get(id);
  if (!item) {
    res.json({ ok: false, error: 'not_found' });
    return;
  }
  const isAttachingWindow = req.body?.windowId !== undefined || req.body?.tabId !== undefined;
  if (!isAttachingWindow) {
    const hasAppWindow = Boolean(req.body?.hasAppWindow);
    const hasWorkspace = Boolean(req.body?.hasWorkspace);
    const allowFallback = Date.now() - lastHuellasAppWindowPollAt > 15000;
    if (!hasAppWindow && !(allowFallback && hasWorkspace)) {
      res.status(409).json({ ok: false, error: 'wrong_browser_profile' });
      return;
    }
    if (item.claimed) {
      res.status(409).json({ ok: false, error: 'already_claimed' });
      return;
    }
    item.claimed = true;
  } else {
    item.claimed = true;
    if (req.body?.windowId) item.windowId = Number(req.body.windowId) || null;
    if (req.body?.tabId) item.tabId = Number(req.body.tabId) || null;
    if (req.body?.reusedExisting !== undefined) {
      item.reusedExisting = Boolean(req.body.reusedExisting);
    }
  }
  res.json({ ok: true, id });
});

app.post('/api/copilot-web/ask-external-result', (req, res) => {
  const id = String(req.body?.requestId || req.body?.id || '').trim();
  const chatUrl = String(req.body?.chatUrl || '').trim();
  const bodyTabId = Number(req.body?.tabId) || null;
  const bodyWinId = Number(req.body?.windowId) || null;
  const bodyReused = Boolean(req.body?.reusedExisting);
  const item = pendingExternalCopilotAsks.get(id);
  if (!item) {
    if (!bodyReused && (chatUrl || bodyTabId || bodyWinId)) {
      closeTemporaryCopilotWindowFailsafe({ windowId: bodyWinId, tabId: bodyTabId, chatUrl });
    }
    res.json({ ok: false, error: 'already_resolved_or_not_found' });
    return;
  }
  clearTimeout(item.timer);
  pendingExternalCopilotAsks.delete(id);
  item.chatUrl = chatUrl || item.chatUrl;
  const keepOpen = Boolean(item.reusedExisting || bodyReused);
  if (!keepOpen) {
    closeTemporaryCopilotWindowFailsafe({
      windowId: item.windowId || bodyWinId,
      tabId: item.tabId || bodyTabId,
      chatUrl: item.chatUrl,
    });
  }
  item.resolve({
    ok: Boolean(req.body?.ok !== false),
    verifiedModel: req.body?.verifiedModel ? String(req.body.verifiedModel) : undefined,
    response: String(req.body?.response || req.body?.text || ''),
    chatUrl,
    error: req.body?.error ? String(req.body.error) : undefined,
  });
  res.json({ ok: true });
});

app.post('/api/copilot-web/ask-external', (_req, res) => {
  res.status(410).json({ ok: false, error: 'Copilot Web fue removido del sistema de modos.' });
});

app.post('/api/extension/reload', (_req, res) => {
  extensionManualReloadCounter += 1;
  const fp = computeChromeExtensionFingerprint();
  wakeExtensionInHuellasAppBrowser(true);
  res.json({
    ok: true,
    fingerprint: fp,
    reloadedCounter: extensionManualReloadCounter,
  });
});

// Setup Flow PC (Agent) isolated desktop container manager + KasmVNC proxy + 5G tunnel
const flowPcManager = createFlowPcManager(
  {
    dataDir: DATA_DIR,
    resolveLocalDocumentaryFolder,
    ensureDocumentarySubfolders,
    getLocalGitHubToken,
    githubOwner: GITHUB_OWNER,
    githubRepo: GITHUB_REPO,
    githubBranch: GITHUB_BRANCH,
    onAssetRouted: ({ rootDocFolder, subFolder, docTitle }) => {
      if (subFolder !== '05_Clips_Video' || !rootDocFolder) return;
      rememberWatchedStage6Folder(rootDocFolder, docTitle);
      const key = path.resolve(rootDocFolder);
      const prevTimer = flowPcPipelineDebounceByFolder.get(key);
      if (prevTimer) clearTimeout(prevTimer);
      const timer = setTimeout(() => {
        flowPcPipelineDebounceByFolder.delete(key);
        triggerAutonomousClips4kForFolder(rootDocFolder, docTitle, 'flow_pc');
      }, 1500);
      flowPcPipelineDebounceByFolder.set(key, timer);
    },
  },
  PORT
);
flowCapEarlyHandler = flowPcManager.earlyMiddleware;
flowPcManager.registerRoutes(app);

// Setup Vite Dev Server or Production static serving
async function bootstrap() {
  const httpServer = http.createServer(app);

  if (process.env.NODE_ENV !== 'production') {
    const vite = await createViteServer({
      server: {
        middlewareMode: true,
        watch: {
          ignored: ['**/data/**', '**/dist/**', '**/docs/**', '**/docker/**', '**/chrome-extension/**', '**/*.log'],
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

  flowPcManager.attachServer(httpServer);

  httpServer.listen(PORT, '0.0.0.0', () => {
    console.log(`Huellas Master running at http://localhost:${PORT}`);
  });
}

bootstrap();
