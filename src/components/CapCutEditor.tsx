import React, { useState, useEffect, useLayoutEffect, useRef, useMemo, useCallback } from 'react';
import {
  Film,
  Play,
  Pause,
  SkipBack,
  SkipForward,
  Volume2,
  Music,
  Subtitles,
  Image as ImageIcon,
  Download,
  FolderOpen,
  Upload,
  ArrowLeft,
  ArrowRight,
  Sliders,
  Sparkles,
  Trash2,
  Plus,
  Check,
  Clock,
  Layers,
  Maximize2,
  Minimize2,
  RotateCcw,
  RotateCw,
  Scissors,
} from 'lucide-react';
import {
  DocumentaryProject,
  DocumentaryClip,
  BrollCameraMotion,
  isClipDiscardOverridden,
  getEffectiveClipDiscardedFileName,
  getEffectiveClipDiscardedAt,
} from '../types';
import {
  stripPauseTags,
  normalizeQuantitiesToMil,
  getStage1ClipDurations,
  normalizeClip1Line1Format,
  splitWordsIntoShortLines,
  reformatCaptionItems,
  mergeOrphanSingleWordCaptions,
  CaptionTimedWord,
  computeVoiceScriptAlignHash,
  spokenSpanishSyllableWeight,
  buildAudioCaptionsFromSidecarWords,
  balanceCaptionsFor16x9,
  BROLL_MOTION_UI_LABEL_ES,
  normalizeBrollImagePrompt,
} from '../utils/smartParsers';
import {
  getMediaBridgeSnapshot,
  subscribeMediaBridge,
  getOrderedMediaBridgeBases,
  getMediaBridgeCandidateTimeoutMs,
  evictDeadMediaBridgeOrigin,
  probeMediaBridgeOrigin,
  refreshLiveMacMediaTunnelUrl,
  stripEphemeralMediaBridgeOrigin,
  rewriteMediaBridgeUrl,
  appendMediaFrameProbeParam,
  persistDiscoveredMacTunnel,
  isOfficialAssetMedia,
  verifyMediaBridgeHealthOrRefresh,
  toCanonicalMediaBridgePath,
} from '../utils/mediaBridge';
import { useNoticeStack } from '../utils/noticeStack';

export type ExportResolutionPreset = 'HD_1080P' | '2K_1440P' | '4K_2160P' | '8K_4320P';
export type EditorAspectRatio = '16:9' | '9:16';
export type ClipTransitionType =
  | 'direct'
  | 'crossfade'
  | 'dip_black'
  | 'dissolve'
  | 'zoom_in'
  | 'flash_sepia';

function getEditorMediaBridgeBases(): string[] {
  return getOrderedMediaBridgeBases();
}

function getEditorPrimaryServerOrigin(): string {
  const snap = getMediaBridgeSnapshot();
  if (snap.activeOrigin) return snap.activeOrigin;
  const bases = getOrderedMediaBridgeBases();
  return bases[0] || '';
}

function normalizeEditorClipTransition(raw: unknown): ClipTransitionType {
  const t = String(raw || '').trim();
  if (t === 'fade_black' || t === 'fade') return 'dip_black';
  if (
    t === 'direct' ||
    t === 'crossfade' ||
    t === 'dip_black' ||
    t === 'dissolve' ||
    t === 'zoom_in' ||
    t === 'flash_sepia'
  ) {
    return t;
  }
  return 'direct';
}

// A media URL served from another documentary's folder (".../Videos/Video NN .../") never belongs to this one.
// At the instant of switching documentary the editor still holds the previous documentary's frame and video
// maps (they are cleared one render later), and saved timelines may carry such URLs from older builds.
function getDocVideoNumberFromText(text?: string): string {
  const m = String(text || '').match(/\bVideo\s+0*(\d{1,3})\b/i);
  return m ? m[1] : '';
}
function isMediaUrlFromOtherDocumentary(
  urlRaw: string | undefined | null,
  doc?: { title?: string; downloadFolderName?: string; downloadFolderPath?: string } | null
): boolean {
  const url = String(urlRaw || '');
  if (!url || !doc) return false;
  let decoded = url;
  try {
    decoded = decodeURIComponent(url);
  } catch {}
  const m = decoded.match(/\/(?:Videos|Reels)\/([^/?&#]+)\//);
  if (!m) return false;
  const urlNum = getDocVideoNumberFromText(m[1]);
  const docNum =
    getDocVideoNumberFromText(doc.downloadFolderName) ||
    getDocVideoNumberFromText(doc.title) ||
    getDocVideoNumberFromText(doc.downloadFolderPath);
  return Boolean(urlNum && docNum && urlNum !== docNum);
}

const IS_APPLE_TOUCH_DEVICE: boolean = (() => {
  try {
    const ua = navigator.userAgent || '';
    return /iPad|iPhone|iPod/.test(ua) || (/Macintosh/.test(ua) && (navigator.maxTouchPoints || 0) > 1);
  } catch {
    return false;
  }
})();

function extractEditorMediaUrlMeta(urlRaw?: string): { fileName: string; mtimeMs: number } {
  const url = String(urlRaw || '').trim();
  if (!url) return { fileName: '', mtimeMs: 0 };
  let fileName = '';
  let mtimeMs = 0;
  try {
    const parsed = new URL(url, 'http://localhost');
    const fp = parsed.searchParams.get('filePath') || parsed.pathname || '';
    const cleanFp = decodeURIComponent(fp).split(/[\\/]/).pop() || '';
    fileName = cleanFp.trim();
    const vParam = Number(parsed.searchParams.get('v') || 0);
    if (Number.isFinite(vParam) && vParam > 0) mtimeMs = vParam;
  } catch {
    const fpMatch = url.match(/[?&]filePath=([^&#]+)/i);
    if (fpMatch && fpMatch[1]) {
      try {
        fileName = decodeURIComponent(fpMatch[1]).split(/[\\/]/).pop()?.trim() || '';
      } catch {}
    }
    const vMatch = url.match(/[?&]v=(\d{10,})/i);
    if (vMatch && vMatch[1]) {
      const vNum = Number(vMatch[1]);
      if (Number.isFinite(vNum) && vNum > 0) mtimeMs = vNum;
    }
  }
  return { fileName, mtimeMs };
}

function isEditorClipRejectedOrQuarantined(docClip?: DocumentaryClip | null): boolean {
  if (!docClip) return false;
  if (isClipDiscardOverridden(docClip)) return false;
  if (docClip.videoAuditStatus === 'rejected' || docClip.auditStatus === 'mismatch') {
    return true;
  }
  const effDiscName = getEffectiveClipDiscardedFileName(docClip);
  const savedName = String(docClip.videoSavedFileName || '').trim();
  return Boolean(effDiscName && savedName === effDiscName);
}

function isEditorFolderItemDiscarded(
  docClip?: DocumentaryClip | null,
  fileNameRaw?: unknown,
  mtimeRaw?: unknown,
  urlRaw?: string
): boolean {
  if (urlRaw && /_Descartados_Auditoria/i.test(urlRaw)) return true;
  if (!docClip) return false;
  if (isClipDiscardOverridden(docClip)) return false;
  const fName = String(fileNameRaw || '').trim();
  const effDiscName = getEffectiveClipDiscardedFileName(docClip);
  if (effDiscName && fName === effDiscName) return true;
  const savedName = String(docClip.videoSavedFileName || '').trim();
  if (effDiscName && savedName === effDiscName && (!fName || fName === effDiscName)) return true;
  const isRej = docClip.videoAuditStatus === 'rejected' || docClip.auditStatus === 'mismatch';
  if (!isRej) return false;
  const effDiscAt = getEffectiveClipDiscardedAt(docClip);
  const itemMtime = Number(mtimeRaw || 0);
  if (itemMtime > 0 && effDiscAt > 0) {
    return itemMtime <= effDiscAt;
  }
  if (!savedName || savedName === effDiscName) return true;
  if (fName && savedName === fName) return true;
  return false;
}

function appendOfficialAssetVersion(rawUrl: string, version?: number): string {
  const clean = String(rawUrl || '').trim();
  if (!clean) return '';
  const ver =
    typeof version === 'number' && Number.isFinite(version) && version > 0
      ? Math.floor(version)
      : 0;
  if (!ver || clean.startsWith('blob:') || clean.startsWith('data:')) return clean;
  if (!isOfficialAssetMedia(clean)) return clean;
  if (/([?&])v=[^&]*/i.test(clean)) {
    return clean.replace(/([?&])v=[^&]*/i, `$1v=${ver}`);
  }
  const sep = clean.includes('?') ? '&' : '?';
  return `${clean}${sep}v=${ver}`;
}

function buildOfficialIntroOutroUrls(version?: number) {
  const introVideoUrl = rewriteMediaBridgeUrl(
    appendOfficialAssetVersion('/api/assets/official-intro-stream', version)
  );
  const introPosterUrl = rewriteMediaBridgeUrl(
    appendOfficialAssetVersion('/api/assets/official-intro-poster', version)
  );
  const outroVideoUrl = rewriteMediaBridgeUrl(
    appendOfficialAssetVersion('/api/assets/official-outro-stream', version)
  );
  const outroPosterUrl = rewriteMediaBridgeUrl(
    appendOfficialAssetVersion('/api/assets/official-outro-poster', version)
  );
  return { introVideoUrl, introPosterUrl, outroVideoUrl, outroPosterUrl };
}

export const FRAME_ZOOM_MIN_PCT = 50;
const FRAME_ZOOM_MAX_PCT = 300;

/** Clip size inside the frame for the given format, percent (100 = normal). */
function getClipFrameZoomPct(
  clip: { frameZoom16x9?: number; frameZoom9x16?: number } | null | undefined,
  ratio: string
): number {
  const raw = Number(ratio === '9:16' ? clip?.frameZoom9x16 : clip?.frameZoom16x9);
  if (!Number.isFinite(raw) || raw <= 0) return 100;
  return Math.max(FRAME_ZOOM_MIN_PCT, Math.min(FRAME_ZOOM_MAX_PCT, Math.round(raw)));
}

/** Clip position inside the frame for the given format, percent of the frame (0 = centred). */
function getClipFrameOffsetPct(
  clip:
    | { frameOffsetX16x9?: number; frameOffsetY16x9?: number; frameOffsetX9x16?: number; frameOffsetY9x16?: number }
    | null
    | undefined,
  ratio: string
): { x: number; y: number } {
  const rawX = Number(ratio === '9:16' ? clip?.frameOffsetX9x16 : clip?.frameOffsetX16x9);
  const rawY = Number(ratio === '9:16' ? clip?.frameOffsetY9x16 : clip?.frameOffsetY16x9);
  const lim = (v: number) => (Number.isFinite(v) ? Math.max(-195, Math.min(195, Math.round(v * 10) / 10)) : 0);
  return { x: lim(rawX), y: lim(rawY) };
}

/** Seconds the clip takes to go from normal size (100%, centred) to its set size/position. 0 = no gradual zoom. */
function getClipFrameZoomInSec(
  clip: { frameZoomInSec16x9?: number; frameZoomInSec9x16?: number } | null | undefined,
  ratio: string
): number {
  const raw = Number(ratio === '9:16' ? clip?.frameZoomInSec9x16 : clip?.frameZoomInSec16x9);
  return Number.isFinite(raw) && raw > 0 ? Math.min(20, Math.round(raw * 10) / 10) : 0;
}
/** Smooth 0..1 progress of the gradual zoom at `elapsedSec` into the clip. */
function getFrameZoomInProgress(elapsedSec: number, zoomInSec: number): number {
  if (!(zoomInSec > 0)) return 1;
  const p = Math.max(0, Math.min(1, elapsedSec / zoomInSec));
  return p * p * (3 - 2 * p);
}

/** A framing point: at `t` seconds into the clip it has size `z` (percent) and position `x`,`y` (percent of the frame). */
export interface ClipFrameKey {
  t: number;
  z: number;
  x: number;
  y: number;
}
const MAX_CLIP_FRAME_KEYS = 8;
type ClipFrameSource = {
  frameZoom16x9?: number;
  frameZoom9x16?: number;
  frameOffsetX16x9?: number;
  frameOffsetY16x9?: number;
  frameOffsetX9x16?: number;
  frameOffsetY9x16?: number;
  frameZoomInSec16x9?: number;
  frameZoomInSec9x16?: number;
  frameKeys16x9?: ClipFrameKey[];
  frameKeys9x16?: ClipFrameKey[];
} | null | undefined;
/** Framing points of the clip for the given format, sorted by time. An old "gradual zoom" counts as two points. */
function getClipFrameKeys(clip: ClipFrameSource, ratio: string): ClipFrameKey[] {
  if (!clip) return [];
  const rawKeys = ratio === '9:16' ? clip.frameKeys9x16 : clip.frameKeys16x9;
  const raw = Array.isArray(rawKeys) ? rawKeys : [];
  const clean = raw
    .map((k) => ({ t: Number(k?.t), z: Number(k?.z), x: Number(k?.x), y: Number(k?.y) }))
    .filter((k) => [k.t, k.z, k.x, k.y].every((v) => Number.isFinite(v)) && k.t >= 0 && k.z > 0)
    .sort((a, b) => a.t - b.t)
    .slice(0, MAX_CLIP_FRAME_KEYS);
  if (clean.length > 0) return clean;
  const zoomInSec = getClipFrameZoomInSec(clip, ratio);
  if (zoomInSec > 0) {
    const off = getClipFrameOffsetPct(clip, ratio);
    return [
      { t: 0, z: 100, x: 0, y: 0 },
      { t: zoomInSec, z: getClipFrameZoomPct(clip, ratio), x: off.x, y: off.y },
    ];
  }
  return [];
}
/** Framing at `elapsedSec` between points: holds the first point before it and the last point after it. */
function interpolateClipFrameKeys(keys: ClipFrameKey[], elapsedSec: number): { z: number; x: number; y: number } {
  if (elapsedSec <= keys[0].t) return keys[0];
  const last = keys[keys.length - 1];
  if (elapsedSec >= last.t) return last;
  for (let i = 0; i < keys.length - 1; i++) {
    const a = keys[i];
    const b = keys[i + 1];
    if (elapsedSec >= a.t && elapsedSec <= b.t) {
      const e = getFrameZoomInProgress(elapsedSec - a.t, b.t - a.t);
      return { z: a.z + (b.z - a.z) * e, x: a.x + (b.x - a.x) * e, y: a.y + (b.y - a.y) * e };
    }
  }
  return last;
}
/** Size (percent) and position of the clip at `elapsedSec` seconds into it. */
function getClipFrameAt(clip: ClipFrameSource, ratio: string, elapsedSec: number): { z: number; x: number; y: number } {
  const keys = getClipFrameKeys(clip, ratio);
  if (keys.length > 0) return interpolateClipFrameKeys(keys, elapsedSec);
  const off = getClipFrameOffsetPct(clip, ratio);
  return { z: getClipFrameZoomPct(clip, ratio), x: off.x, y: off.y };
}

interface TimelineClipItem {
  id: string;
  clipNumber: number;
  fileName: string;
  narrationSegment: string;
  imagePrompt?: string;
  videoPrompt?: string;
  isStaticBroll?: boolean;
  brollCameraMotion?: BrollCameraMotion;
  duration: number; // effective duration on timeline in seconds
  sourceDuration: number;
  speed: number; // e.g., 0.75x for slowed Clip 1, 1.0x default
  trimStart: number;
  trimEnd?: number; // end offset in source video in seconds (defaults to sourceDuration)
  smoothSlowMo?: boolean; // CapCut-style Smooth Slow Motion (Optical Flow), auto-enabled when speed < 1.0x
  opticalFlowUrl?: string; // server-rendered 60fps Optical Flow MP4 URL
  opticalFlowBakedKey?: string;
  parentGroupId?: string; // links split parts of the same original clip so deleting a piece stretches the sibling
  originalSlotDuration?: number; // original timeline duration (e.g. 8s) before splitting/trimming
  partLabel?: string; // e.g., "Parte A", "Parte B"
  foleyVolume: number; // 0 to 100
  customVolumeSet?: boolean; // true when user explicitly edited this clip's volume
  audioMuted?: boolean; // true when clip audio is muted
  audioFadeInSec?: number; // per-clip audio fade-in duration in seconds (0 to 15s)
  audioFadeOutSec?: number; // per-clip audio fade-out duration in seconds (0 to 15s)
  transition: ClipTransitionType;
  videoUrl?: string; // local blob URL or data URL of the MP4
  posterUrl?: string; // keyframe or preview image
  reviewedForEditor?: boolean;
  vocalsSeparated?: boolean; // true when vocal stem has been extracted to the Voces Separadas track
  cleanNoVocalsVideoUrl?: string; // MP4 URL with vocal speech band suppressed
  musicSeparated?: boolean; // true when music stem has been extracted to the Música Extraída track
  cleanNoMusicVideoUrl?: string; // MP4 URL with harmonic music band suppressed
  foleyOnlyIsolated?: boolean; // true when both music and vocals were detected and removed leaving only ambient Foley
  foleyOnlyDisabled?: boolean; // true when user explicitly unchecked Solo Foley Ambiente for this clip
  cleanFoleyOnlyVideoUrl?: string; // MP4 URL with only ambient Foley preserved
  cleanOpticalFlowOnlyUrl?: string; // 60fps Optical Flow MP4 URL with only ambient Foley preserved
  originalVideoUrlBeforeSeparation?: string;
  originalOpticalFlowUrlBeforeSeparation?: string;
  // Smart Auto-Reframe 9:16 (Vertical Dual Format)
  reframe9x16Mode?: 'auto_center' | 'auto_focus' | 'auto_pan' | 'manual' | 'fit_blur';
  reframeFocusXStart?: number; // 0 to 100 (50 = center)
  reframeFocusXEnd?: number;   // 0 to 100 (50 = center)
  reframeUpdatedAt?: number;   // ms epoch of the last manual reframe (newest wins between doc and timeline)
  reframeFocusY?: number;      // 0 to 100 (50 = center)
  frameZoom16x9?: number;      // clip size in the 16:9 frame, percent (100 = normal)
  frameZoom9x16?: number;      // clip size in the 9:16 frame, percent (100 = normal)
  frameOffsetX16x9?: number;   // clip position in the 16:9 frame, percent of the frame (0 = centred)
  frameOffsetY16x9?: number;
  frameOffsetX9x16?: number;   // clip position in the 9:16 frame, percent of the frame
  frameOffsetY9x16?: number;
  frameTransformAt?: number;   // when the size/position was last saved (ms)
  frameZoomInSec16x9?: number; // gradual zoom: seconds from 100% to the set size/position (0 = off)
  frameZoomInSec9x16?: number;
  frameKeys16x9?: ClipFrameKey[]; // framing points (16:9): the clip pans/zooms from one to the next
  frameKeys9x16?: ClipFrameKey[]; // framing points (9:16)
  reframeConfidence?: number;
  reframeReason?: string;
  userReframed9x16?: boolean;  // true when user manually set or adjusted reframe in the editor
}

export interface TimelineSeparatedVocalItem {
  id: string;
  sourceClipId: string;
  clipNumber: number;
  title: string;
  start: number; // in seconds on master timeline (movable horizontally)
  duration: number; // in seconds on master timeline
  audioUrl?: string; // separated vocal or music stem audio URL (or fallback clip videoUrl)
  sourceTrimStart?: number;
  speed?: number;
  volume: number; // default 100
  muted?: boolean;
  stemType?: 'vocals' | 'music';
}

export const CAPTIONS_ALIGN_VERSION = 4;

export interface VoiceAlignmentSidecarV2 {
  version: 2;
  engine: 'vosk-es-0.42-nw-v2';
  audioFile: string;
  audioDurationSec: number;
  scriptHash: string;
  anchorHitRate: number;
  sloganSplitAudioSec: number;
  sloganSilenceEndAudioSec: number;
  words: Array<[string, number, number, 0 | 1 | 2 | 3 | 4]>;
}

export interface TimelineCaptionItem {
  id: string;
  index: number;
  start: number; // in seconds on master timeline
  end: number;
  text: string;
  audioStartSec?: number;
  audioEndSec?: number;
  words?: CaptionTimedWord[];
  alignSource?: 'vosk-v2' | 'webaudio-v2' | 'video76-srt' | 'manual';
}

// Volumen por defecto de cada canción (%). Un volumen que el usuario fijó a mano se respeta siempre.
const DEFAULT_MUSIC_TRACK_VOLUME_PCT = 20;

// Canción 1 a 50% durante el Clip 1, con rampa suave hacia su volumen normal
export const CLIP1_SONG_BOOST_PCT = 50;
export const CLIP1_BOOST_RAMP_BEFORE_SEC = 1;
export const CLIP1_BOOST_RAMP_AFTER_SEC = 2;

export interface TimelineMusicItem {
  id: string;
  trackNumber: number;
  title: string;
  start: number; // in seconds on master timeline
  duration: number; // in seconds
  volume: number; // default 15%
  audioUrl?: string;
  isLast90Sec?: boolean;
  fadeInSec?: number; // default 2.5s
  fadeOutSec?: number; // default 3.0s
  videoTimeRange?: string;
}

export const RESOLUTION_PRESETS: Record<
  ExportResolutionPreset,
  {
    label: string;
    badge: string;
    width16x9: number;
    height16x9: number;
    width9x16: number;
    height9x16: number;
    bitrateMbps: number;
  }
> = {
  HD_1080P: {
    label: 'Full HD (1080p)',
    badge: 'HD 1080p',
    width16x9: 1920,
    height16x9: 1080,
    width9x16: 1080,
    height9x16: 1920,
    bitrateMbps: 16,
  },
  '2K_1440P': {
    label: '2K QHD (1440p)',
    badge: '2K 1440p',
    width16x9: 2560,
    height16x9: 1440,
    width9x16: 1440,
    height9x16: 2560,
    bitrateMbps: 28,
  },
  '4K_2160P': {
    label: '4K Ultra HD (2160p)',
    badge: '4K 2160p',
    width16x9: 3840,
    height16x9: 2160,
    width9x16: 2160,
    height9x16: 3840,
    bitrateMbps: 55,
  },
  '8K_4320P': {
    label: '8K Master Cinema (4320p)',
    badge: '8K 4320p',
    width16x9: 7680,
    height16x9: 4320,
    width9x16: 4320,
    height9x16: 7680,
    bitrateMbps: 100,
  },
};

export const TRANSITION_OPTIONS: { value: ClipTransitionType; label: string }[] = [
  { value: 'direct', label: 'Corte Directo (Default)' },
  { value: 'crossfade', label: 'Fundido Suave (Crossfade 0.35s)' },
  { value: 'dip_black', label: 'Fundido a Negro (Dip to Black 0.5s)' },
  { value: 'dissolve', label: 'Disolvencia Cinematográfica (0.6s)' },
  { value: 'zoom_in', label: 'Zoom Suave Documental' },
  { value: 'flash_sepia', label: 'Flash Histórico Sutil' },
];

export type OverlayShadowStyle = 'none' | 'soft' | 'cinema' | 'outline' | 'gold_glow';
export type OverlayBgStyle = 'none' | 'word_shadow' | 'semi' | 'solid' | 'pill';

export const EDITOR_FONT_OPTIONS: { value: string; label: string }[] = [
  { value: "'Cinzel', Georgia, 'Times New Roman', serif", label: 'Cinzel / Romano Clásico' },
  { value: "'Playfair Display', Georgia, serif", label: 'Playfair / Editorial Histórico' },
  { value: "'Montserrat', 'Helvetica Neue', Arial, sans-serif", label: 'Montserrat / Sans Moderna' },
  { value: "'Oswald', Impact, 'Arial Narrow', sans-serif", label: 'Oswald / Documental Épico' },
  { value: "Impact, 'Arial Black', sans-serif", label: 'Impact / Titular Cine' },
  { value: "'Courier New', Courier, monospace", label: 'Courier / Archivo Confidencial' },
  { value: "Georgia, 'Times New Roman', serif", label: 'Georgia / Crónica Literaria' },
  { value: "system-ui, -apple-system, BlinkMacSystemFont, sans-serif", label: 'Inter / Sans Limpia' },
];

export const EDITOR_SHADOW_OPTIONS: { value: OverlayShadowStyle; label: string }[] = [
  { value: 'cinema', label: 'Sombra Profunda Cine' },
  { value: 'outline', label: 'Borde Negro Fuerte (Contorno)' },
  { value: 'soft', label: 'Sombra Suave' },
  { value: 'gold_glow', label: 'Resplandor Dorado' },
  { value: 'none', label: 'Sin Sombra' },
];

export const EDITOR_BG_STYLE_OPTIONS: { value: OverlayBgStyle; label: string }[] = [
  { value: 'none', label: 'Sin Fondo (Transparente)' },
  { value: 'word_shadow', label: 'Sombra Ceñida a las Palabras' },
  { value: 'semi', label: 'Caja Semitransparente' },
  { value: 'solid', label: 'Caja Sólida' },
];

export function getTextShadowCss(style: OverlayShadowStyle): string {
  switch (style) {
    case 'none':
      return 'none';
    case 'soft':
      return '0 2px 6px rgba(0,0,0,0.85)';
    case 'cinema':
      return '0 4px 16px rgba(0,0,0,0.98), 0 2px 4px rgba(0,0,0,0.95)';
    case 'outline':
      return '-2px -2px 0 #000, 2px -2px 0 #000, -2px 2px 0 #000, 2px 2px 0 #000, 0 4px 10px rgba(0,0,0,0.95)';
    case 'gold_glow':
      return '0 0 14px rgba(245,158,11,0.75), 0 3px 10px rgba(0,0,0,0.95)';
    default:
      return '0 4px 14px rgba(0,0,0,0.95)';
  }
}

/** Captions del formato 9:16: mayúsculas en amarillo de alto contraste, sombra negra y la palabra que se dice en blanco. */
export const KARAOKE_9X16_CAPTION = {
  color: '#ffe600',
  activeWordColor: '#ffffff',
  shadowStyle: 'karaoke' as const,
  bgStyle: 'none' as const,
  fontFamily: "'Arial Black', Impact, 'Helvetica Neue', sans-serif",
  /**
   * Contorno redondeado hecho con un anillo de sombras en 16 direcciones + sombra corta.
   * (El trazo de texto del navegador deja una punta en los vértices agudos, como el de la A.)
   */
  viewerCss: {
    textShadow: [
      ...Array.from({ length: 16 }, (_, i) => {
        const a = (i / 16) * Math.PI * 2;
        return `${(Math.cos(a) * 2).toFixed(2)}px ${(Math.sin(a) * 2).toFixed(2)}px 0 #000`;
      }),
      ...Array.from({ length: 8 }, (_, i) => {
        const a = (i / 8) * Math.PI * 2;
        return `${Math.cos(a).toFixed(2)}px ${Math.sin(a).toFixed(2)}px 0 #000`;
      }),
      '0 3px 3px rgba(0,0,0,0.9)',
    ].join(', '),
  } as React.CSSProperties,
};

/** Segundo de la línea de tiempo en que empieza cada palabra del texto mostrado de un caption. */
export function getCaptionWordStarts(
  cap: { start: number; end: number; text: string; audioStartSec?: number; audioEndSec?: number; words?: Array<{ audioStartSec: number }> },
  displayText?: string
): number[] {
  const tokens = String(displayText ?? cap.text ?? '').split(/\s+/).filter(Boolean);
  const dur = Math.max(0.01, cap.end - cap.start);
  const timed = Array.isArray(cap.words) ? cap.words : [];
  let out: number[];
  if (timed.length === tokens.length && timed.length > 0 && timed.every((w) => Number.isFinite(Number(w?.audioStartSec)))) {
    const a0 = Number.isFinite(Number(cap.audioStartSec)) ? Number(cap.audioStartSec) : Number(timed[0].audioStartSec);
    const a1 = Number(cap.audioEndSec);
    const scale = Number.isFinite(a1) && a1 > a0 + 0.05 ? dur / (a1 - a0) : 1;
    out = timed.map((w) => cap.start + (Number(w.audioStartSec) - a0) * scale);
  } else {
    const weights = tokens.map((t) => t.length + 1);
    const total = weights.reduce((a, b) => a + b, 0) || 1;
    let acc = 0;
    out = weights.map((w) => {
      const t = cap.start + (acc / total) * dur;
      acc += w;
      return t;
    });
  }
  let prev = cap.start;
  return out.map((t, i) => {
    const v = i === 0 ? cap.start : Math.max(prev, Math.min(cap.end, t));
    prev = v;
    return Number(v.toFixed(3));
  });
}

export function hexToRgba(hex: string, opacityPct: number): string {
  const clean = (hex || '#000000').replace('#', '');
  const r = parseInt(clean.substring(0, 2) || '00', 16) || 0;
  const g = parseInt(clean.substring(2, 4) || '00', 16) || 0;
  const b = parseInt(clean.substring(4, 6) || '00', 16) || 0;
  const a = Math.min(1, Math.max(0, opacityPct / 100));
  return `rgba(${r}, ${g}, ${b}, ${a.toFixed(2)})`;
}

export type ElementAnimationType =
  | 'none'
  | 'fade'
  | 'slide_up'
  | 'slide_down'
  | 'slide_left'
  | 'slide_right'
  | 'zoom_in'
  | 'zoom_out'
  | 'pop'
  | 'blur_fade';

export const ELEMENT_ANIMATION_OPTIONS: { value: ElementAnimationType; label: string }[] = [
  { value: 'none', label: 'Sin Animación (Directo)' },
  { value: 'fade', label: 'Fade (Fundido Suave)' },
  { value: 'slide_up', label: 'Deslizar hacia Arriba (Slide Up)' },
  { value: 'slide_down', label: 'Deslizar hacia Abajo (Slide Down)' },
  { value: 'slide_left', label: 'Deslizar desde Derecha (Slide Left)' },
  { value: 'slide_right', label: 'Deslizar desde Izquierda (Slide Right)' },
  { value: 'zoom_in', label: 'Zoom In Cinematográfico' },
  { value: 'zoom_out', label: 'Zoom Out Suave' },
  { value: 'pop', label: 'Pop / Rebote Dinámico' },
  { value: 'blur_fade', label: 'Desenfoque Suave (Blur Fade)' },
];

export interface ComputedAnimationState {
  visible: boolean;
  opacity: number;
  translateX: number; // px
  translateY: number; // px
  scale: number;
  blurPx: number;
}

export function computeElementAnimationState(
  timeSec: number,
  startSec: number,
  endSec: number,
  animIn: ElementAnimationType,
  animInDur: number,
  animOut: ElementAnimationType,
  animOutDur: number
): ComputedAnimationState {
  if (timeSec < startSec || timeSec > endSec) {
    return {
      visible: false,
      opacity: 0,
      translateX: 0,
      translateY: 0,
      scale: 1,
      blurPx: 0,
    };
  }

  let opacity = 1;
  let translateX = 0;
  let translateY = 0;
  let scale = 1;
  let blurPx = 0;

  // Entrance phase: [startSec, startSec + animInDur]
  const safeInDur = Math.max(0.05, animInDur);
  if (animIn !== 'none' && timeSec < startSec + safeInDur) {
    const rawP = Math.min(1, Math.max(0, (timeSec - startSec) / safeInDur));
    // Smooth ease-out cubic
    const p = 1 - Math.pow(1 - rawP, 3);
    const inv = 1 - p;
    opacity *= rawP;
    if (animIn === 'slide_up') translateY += 28 * inv;
    else if (animIn === 'slide_down') translateY -= 28 * inv;
    else if (animIn === 'slide_left') translateX += 38 * inv;
    else if (animIn === 'slide_right') translateX -= 38 * inv;
    else if (animIn === 'zoom_in') scale *= 0.78 + 0.22 * p;
    else if (animIn === 'zoom_out') scale *= 1.24 - 0.24 * p;
    else if (animIn === 'pop') {
      const overshoot = rawP < 0.75 ? (rawP / 0.75) * 1.1 : 1.1 - ((rawP - 0.75) / 0.25) * 0.1;
      scale *= Math.max(0.2, overshoot);
    } else if (animIn === 'blur_fade') {
      blurPx += 10 * inv;
    }
  }

  // Exit phase: [endSec - animOutDur, endSec]
  const safeOutDur = Math.max(0.05, animOutDur);
  if (animOut !== 'none' && timeSec > endSec - safeOutDur) {
    const rawRem = Math.min(1, Math.max(0, (endSec - timeSec) / safeOutDur));
    // Smooth ease-in-out
    const p = 1 - Math.pow(1 - rawRem, 2);
    const outProgress = 1 - p; // 0 -> 1 as it exits
    opacity *= rawRem;
    if (animOut === 'slide_up') translateY -= 26 * outProgress;
    else if (animOut === 'slide_down') translateY += 26 * outProgress;
    else if (animOut === 'slide_left') translateX -= 36 * outProgress;
    else if (animOut === 'slide_right') translateX += 36 * outProgress;
    else if (animOut === 'zoom_in') scale *= 1 + 0.2 * outProgress;
    else if (animOut === 'zoom_out') scale *= 1 - 0.22 * outProgress;
    else if (animOut === 'pop') scale *= 1 - 0.35 * outProgress;
    else if (animOut === 'blur_fade') blurPx += 10 * outProgress;
  }

  return {
    visible: opacity > 0.005,
    opacity: Math.min(1, Math.max(0, opacity)),
    translateX,
    translateY,
    scale,
    blurPx,
  };
}

export function buildClipSixWordFileName(
  clip: DocumentaryClip,
  doc?: DocumentaryProject | null,
  resolutionBadge?: string
): string {
  const padded = String(clip.clipNumber).padStart(2, '0');
  if (clip.isStaticBroll) {
    const imgBody = String(clip.imagePrompt || '')
      .replace(/^(?:Image|Imagen)\s*\[?0*\d+\]?(?:\s*\([^)]*\))?\s*:\s*/i, '')
      .replace(/[^a-zA-Z0-9\s]+/g, ' ')
      .trim()
      .split(/\s+/)
      .filter(Boolean)
      .slice(0, 5);
    const brollSlug = imgBody.length >= 2 ? imgBody.join('_') : 'Create_an_image_in_16_9';
    return `${padded}_${brollSlug}_Broll_4K.mp4`;
  }
  const rawSource =
    clip.clipNumber === 1 && !(clip.narrationSegment || '').trim()
      ? doc?.clip1Line2Hook || doc?.topic || clip.videoPrompt || 'Intro_Documental'
      : clip.narrationSegment || clip.videoPrompt || `Clip_${padded}`;

  const cleanWords = stripPauseTags(rawSource)
    .replace(/["'«»“”.,;:!?()[\]{}—–-]/g, ' ')
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 6)
    .map((w) =>
      w
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .replace(/[^a-zA-Z0-9]/g, '')
    )
    .filter(Boolean);

  const sixWordsSlug = cleanWords.length > 0 ? cleanWords.join('_') : `Clip_${padded}`;
  const resSuffix = resolutionBadge ? `_${resolutionBadge.replace(/\s+/g, '')}` : '';
  return `${padded}_${sixWordsSlug}${resSuffix}.mp4`;
}

function formatTimeMMSS(sec: number): string {
  const s = Math.max(0, Math.floor(sec));
  const mins = Math.floor(s / 60);
  const rem = s % 60;
  return `${String(mins).padStart(2, '0')}:${String(rem).padStart(2, '0')}`;
}

function formatViewerTimecode(sec: number): string {
  const s = Math.max(0, Math.floor(sec));
  const hrs = Math.floor(s / 3600);
  const mins = Math.floor((s % 3600) / 60);
  const rem = s % 60;
  return `${String(hrs).padStart(2, '0')}:${String(mins).padStart(2, '0')}:${String(rem).padStart(2, '0')}`;
}

function parseSrtToCaptionItems(
  srtText: string,
  alignStartSec?: number
): TimelineCaptionItem[] {
  if (!srtText || !srtText.trim()) return [];
  const blocks = srtText.trim().split(/\r?\n\r?\n+/);
  const items: TimelineCaptionItem[] = [];

  const parseTime = (t: string): number => {
    const m = t.trim().match(/(\d{1,2}):(\d{2}):(\d{2})[,.](\d{1,3})/);
    if (m) {
      return (
        parseInt(m[1], 10) * 3600 +
        parseInt(m[2], 10) * 60 +
        parseInt(m[3], 10) +
        parseInt(m[4].padEnd(3, '0'), 10) / 1000
      );
    }
    const m2 = t.trim().match(/(\d{1,2}):(\d{2})[,.]?(\d{0,3})/);
    if (m2) {
      return (
        parseInt(m2[1], 10) * 60 +
        parseInt(m2[2], 10) +
        (m2[3] ? parseInt(m2[3].padEnd(3, '0'), 10) / 1000 : 0)
      );
    }
    return 0;
  };

  blocks.forEach((b, idx) => {
    const lines = b.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
    if (lines.length < 2) return;
    const timeLineIdx = lines.findIndex((l) => l.includes('-->'));
    if (timeLineIdx === -1) return;
    const [startStr, endStr] = lines[timeLineIdx].split('-->');
    const text = lines
      .slice(timeLineIdx + 1)
      .map((line) =>
        normalizeQuantitiesToMil(stripPauseTags(line))
          .replace(/\[pausa[^\]]*\]?/gi, '')
          .replace(/\s{2,}/g, ' ')
          .trim()
      )
      .filter(Boolean)
      .join('\n');
    if (text) {
      const s = parseTime(startStr);
      const e = parseTime(endStr);
      items.push({
        id: `cap-${idx}-${Date.now()}`,
        index: items.length + 1,
        start: Number(s.toFixed(2)),
        end: Number(Math.max(s + 0.3, e).toFixed(2)),
        text,
      });
    }
  });

  // Prevent any overlapping caption blocks
  for (let i = 0; i < items.length - 1; i++) {
    if (items[i].end > items[i + 1].start) {
      items[i].end = Number(Math.max(items[i].start + 0.15, items[i + 1].start - 0.01).toFixed(2));
    }
  }

  if (items.length > 0 && typeof alignStartSec === 'number') {
    const firstStart = items[0].start;
    // Detect base offset (0s, 6s, 8s, or 16s) while preserving exact sub-second acoustic lead-in (e.g. 0.55s in Video 76)
    let sourceBaseOffset = 0;
    if (firstStart >= 15.5 && firstStart <= 18.5) {
      sourceBaseOffset = 16.0;
    } else if (firstStart >= 7.5 && firstStart <= 10.5) {
      sourceBaseOffset = 8.0;
    } else if (firstStart >= 5.5 && firstStart < 7.5) {
      sourceBaseOffset = 6.0;
    } else if (firstStart < 2.5) {
      sourceBaseOffset = 0.0;
    } else {
      sourceBaseOffset = Math.max(0, firstStart - 0.55);
    }
    const delta = alignStartSec - sourceBaseOffset;
    if (Math.abs(delta) > 0.03) {
      return items.map((it) => ({
        ...it,
        start: Number(Math.max(0, it.start + delta).toFixed(2)),
        end: Number(Math.max(0.3, it.end + delta).toFixed(2)),
      }));
    }
  }

  return items;
}

function resolveTtsAlignSidecarStem(...urls: Array<string | null | undefined>): string | null {
  for (const raw of urls) {
    const clean = String(raw || '')
      .trim()
      .split(/[?#]/)[0];
    if (!clean) continue;
    const match = clean.match(/(?:^|\/)tts-files\/([^/]+?)\.(?:mp3|wav|m4a|ogg)$/i);
    if (match && match[1]) {
      try {
        return decodeURIComponent(match[1]);
      } catch {
        return match[1];
      }
    }
  }
  return null;
}

interface ProjectAudioCaptionsOptions {
  introPlacement: 'INTRO_INICIO_00' | 'INTRO_POST_SLOGAN';
  voiceStartOffsetSec: number;
  postSloganIntroBounds?: { start: number; end: number; duration: number } | null;
  sloganSplitAudioSec?: number;
  introDurSec?: number;
}

// Pure deterministic Audio Time (0.0s..) -> Master Timeline Time projection.
// Eliminates heuristic sourceBaseOffset guessing and cleanly splits any caption straddling Opción B's 8s Intro gap.
function projectAudioCaptionsToTimeline(
  items: TimelineCaptionItem[],
  opts: ProjectAudioCaptionsOptions
): TimelineCaptionItem[] {
  if (!Array.isArray(items) || items.length === 0) return [];
  const {
    introPlacement,
    voiceStartOffsetSec,
    postSloganIntroBounds = null,
    sloganSplitAudioSec = 68.5,
    introDurSec = 8,
  } = opts;

  const hasCanonicalAudioTimes = items.every(
    (it) =>
      typeof it.audioStartSec === 'number' &&
      Number.isFinite(it.audioStartSec) &&
      typeof it.audioEndSec === 'number' &&
      Number.isFinite(it.audioEndSec)
  );
  if (!hasCanonicalAudioTimes) {
    const baseHookSec =
      introPlacement === 'INTRO_POST_SLOGAN'
        ? voiceStartOffsetSec
        : Math.max(0, voiceStartOffsetSec - introDurSec);
    const effSplit = postSloganIntroBounds
      ? Math.max(0, postSloganIntroBounds.start - voiceStartOffsetSec)
      : sloganSplitAudioSec;
    const effIntroDur = postSloganIntroBounds
      ? Math.max(0, postSloganIntroBounds.duration)
      : introDurSec;
    return alignCaptionsToIntroPlacement(
      items,
      introPlacement,
      baseHookSec,
      effIntroDur,
      effSplit
    );
  }

  const splitAudioSec =
    introPlacement === 'INTRO_POST_SLOGAN'
      ? postSloganIntroBounds
        ? Math.max(0, postSloganIntroBounds.start - voiceStartOffsetSec)
        : Math.max(0, Number.isFinite(sloganSplitAudioSec) ? sloganSplitAudioSec : 68.5)
      : Infinity;
  const introGapSec =
    introPlacement === 'INTRO_POST_SLOGAN'
      ? postSloganIntroBounds
        ? Math.max(0, postSloganIntroBounds.duration)
        : Math.max(0, introDurSec)
      : 0;

  const projected: TimelineCaptionItem[] = [];

  for (let i = 0; i < items.length; i++) {
    const it = items[i];
    const aStart = Math.max(0, Number(it.audioStartSec || 0));
    const aEnd = Math.max(aStart + 0.12, Number(it.audioEndSec || aStart + 0.25));

    if (introPlacement !== 'INTRO_POST_SLOGAN' || introGapSec <= 0.01) {
      const idx = projected.length + 1;
      projected.push({
        ...it,
        id: it.id || `cap-proj-${idx}`,
        index: idx,
        audioStartSec: Number(aStart.toFixed(3)),
        audioEndSec: Number(aEnd.toFixed(3)),
        start: Number((voiceStartOffsetSec + aStart).toFixed(3)),
        end: Number((voiceStartOffsetSec + aEnd).toFixed(3)),
      });
      continue;
    }

    // Opción B: completely before Intro split (with 45ms acoustic guard)
    if (aEnd <= splitAudioSec + 0.045) {
      const clampedEnd = Math.max(aStart + 0.1, Math.min(aEnd, splitAudioSec));
      const idx = projected.length + 1;
      projected.push({
        ...it,
        id: it.id || `cap-proj-${idx}`,
        index: idx,
        audioStartSec: Number(aStart.toFixed(3)),
        audioEndSec: Number(clampedEnd.toFixed(3)),
        start: Number((voiceStartOffsetSec + aStart).toFixed(3)),
        end: Number((voiceStartOffsetSec + clampedEnd).toFixed(3)),
      });
      continue;
    }

    // Opción B: completely after Intro split (with 45ms acoustic guard)
    if (aStart >= splitAudioSec - 0.045) {
      const clampedStart = Math.max(splitAudioSec, aStart);
      const clampedEnd = Math.max(clampedStart + 0.12, aEnd);
      const idx = projected.length + 1;
      projected.push({
        ...it,
        id: it.id || `cap-proj-${idx}`,
        index: idx,
        audioStartSec: Number(clampedStart.toFixed(3)),
        audioEndSec: Number(clampedEnd.toFixed(3)),
        start: Number((voiceStartOffsetSec + clampedStart + introGapSec).toFixed(3)),
        end: Number((voiceStartOffsetSec + clampedEnd + introGapSec).toFixed(3)),
      });
      continue;
    }

    // Opción B: caption straddles splitAudioSec -> split cleanly into pre-Intro and post-Intro blocks
    const timedWords = Array.isArray(it.words) ? it.words : [];
    if (timedWords.length >= 2) {
      const preWords = timedWords.filter(
        (w) => (Number(w.audioStartSec || 0) + Number(w.audioEndSec || 0)) * 0.5 <= splitAudioSec
      );
      const postWords = timedWords.slice(preWords.length);
      if (preWords.length > 0 && postWords.length > 0) {
        const preAStart = Math.max(0, Number(preWords[0].audioStartSec || aStart));
        const preAEnd = Math.max(
          preAStart + 0.1,
          Math.min(splitAudioSec, Number(preWords[preWords.length - 1].audioEndSec || splitAudioSec))
        );
        const postAStart = Math.max(splitAudioSec, Number(postWords[0].audioStartSec || splitAudioSec));
        const postAEnd = Math.max(
          postAStart + 0.12,
          Number(postWords[postWords.length - 1].audioEndSec || aEnd)
        );
        const idx1 = projected.length + 1;
        projected.push({
          ...it,
          id: `${it.id || `cap-${i + 1}`}-pre`,
          index: idx1,
          text: preWords.map((w) => w.text).join(' '),
          words: preWords,
          audioStartSec: Number(preAStart.toFixed(3)),
          audioEndSec: Number(preAEnd.toFixed(3)),
          start: Number((voiceStartOffsetSec + preAStart).toFixed(3)),
          end: Number((voiceStartOffsetSec + preAEnd).toFixed(3)),
        });
        const idx2 = projected.length + 1;
        projected.push({
          ...it,
          id: `${it.id || `cap-${i + 1}`}-post`,
          index: idx2,
          text: postWords.map((w) => w.text).join(' '),
          words: postWords,
          audioStartSec: Number(postAStart.toFixed(3)),
          audioEndSec: Number(postAEnd.toFixed(3)),
          start: Number((voiceStartOffsetSec + postAStart + introGapSec).toFixed(3)),
          end: Number((voiceStartOffsetSec + postAEnd + introGapSec).toFixed(3)),
        });
        continue;
      }
    }

    // Phonetic fallback split when word-level array is absent
    const cleanTokens = String(it.text || '')
      .replace(/\s+/g, ' ')
      .trim()
      .split(' ')
      .filter(Boolean);
    if (cleanTokens.length >= 2) {
      const weights = cleanTokens.map((tok) => Math.max(1, spokenSpanishSyllableWeight(tok)));
      const totalW = weights.reduce((acc, v) => acc + v, 0);
      const targetRatio = Math.max(0.08, Math.min(0.92, (splitAudioSec - aStart) / Math.max(0.1, aEnd - aStart)));
      let accW = 0;
      let splitTokIdx = 1;
      let bestDiff = Infinity;
      for (let k = 1; k < cleanTokens.length; k++) {
        accW += weights[k - 1];
        const diff = Math.abs(accW / totalW - targetRatio);
        if (diff < bestDiff) {
          bestDiff = diff;
          splitTokIdx = k;
        }
      }
      const preText = cleanTokens.slice(0, splitTokIdx).join(' ');
      const postText = cleanTokens.slice(splitTokIdx).join(' ');
      const preEnd = Math.max(aStart + 0.1, splitAudioSec);
      const postStart = splitAudioSec;
      const postEnd = Math.max(postStart + 0.12, aEnd);
      const idx1 = projected.length + 1;
      projected.push({
        ...it,
        id: `${it.id || `cap-${i + 1}`}-pre`,
        index: idx1,
        text: preText,
        words: undefined,
        audioStartSec: Number(aStart.toFixed(3)),
        audioEndSec: Number(preEnd.toFixed(3)),
        start: Number((voiceStartOffsetSec + aStart).toFixed(3)),
        end: Number((voiceStartOffsetSec + preEnd).toFixed(3)),
      });
      const idx2 = projected.length + 1;
      projected.push({
        ...it,
        id: `${it.id || `cap-${i + 1}`}-post`,
        index: idx2,
        text: postText,
        words: undefined,
        audioStartSec: Number(postStart.toFixed(3)),
        audioEndSec: Number(postEnd.toFixed(3)),
        start: Number((voiceStartOffsetSec + postStart + introGapSec).toFixed(3)),
        end: Number((voiceStartOffsetSec + postEnd + introGapSec).toFixed(3)),
      });
      continue;
    }

    // Single-word straddle fallback: place on whichever side holds >50% of its duration
    const midAudio = (aStart + aEnd) * 0.5;
    const idx = projected.length + 1;
    if (midAudio <= splitAudioSec) {
      const clampedEnd = Math.max(aStart + 0.1, splitAudioSec);
      projected.push({
        ...it,
        id: it.id || `cap-proj-${idx}`,
        index: idx,
        audioStartSec: Number(aStart.toFixed(3)),
        audioEndSec: Number(clampedEnd.toFixed(3)),
        start: Number((voiceStartOffsetSec + aStart).toFixed(3)),
        end: Number((voiceStartOffsetSec + clampedEnd).toFixed(3)),
      });
    } else {
      const clampedStart = splitAudioSec;
      const clampedEnd = Math.max(clampedStart + 0.12, aEnd);
      projected.push({
        ...it,
        id: it.id || `cap-proj-${idx}`,
        index: idx,
        audioStartSec: Number(clampedStart.toFixed(3)),
        audioEndSec: Number(clampedEnd.toFixed(3)),
        start: Number((voiceStartOffsetSec + clampedStart + introGapSec).toFixed(3)),
        end: Number((voiceStartOffsetSec + clampedEnd + introGapSec).toFixed(3)),
      });
    }
  }

  for (let i = 0; i < projected.length - 1; i++) {
    if (projected[i].end > projected[i + 1].start) {
      projected[i].end = Number(
        Math.max(projected[i].start + 0.1, projected[i + 1].start - 0.005).toFixed(3)
      );
    }
  }

  return projected;
}

// Deterministically align any caption list to either Opción A (INTRO_INICIO_00: Voice starts at 16s)
// or Opción B (INTRO_POST_SLOGAN: Voice starts at 8s, with an 8s Intro pause inserted right after the Slogan Completo)
function alignCaptionsToIntroPlacement(
  rawItems: TimelineCaptionItem[],
  mode: 'INTRO_INICIO_00' | 'INTRO_POST_SLOGAN',
  baseHookSec = 8,
  introDurSec = 8,
  sloganSplitAudioSec = 68.5,
  postSloganIntroBounds: { start: number; end: number; duration: number } | null = null
): TimelineCaptionItem[] {
  if (!Array.isArray(rawItems) || rawItems.length === 0) return [];

  const targetInitialOffset = mode === 'INTRO_POST_SLOGAN' ? baseHookSec : baseHookSec + introDurSec;
  if (
    rawItems.every(
      (it) =>
        typeof it.audioStartSec === 'number' &&
        Number.isFinite(it.audioStartSec) &&
        typeof it.audioEndSec === 'number' &&
        Number.isFinite(it.audioEndSec)
    )
  ) {
    return projectAudioCaptionsToTimeline(rawItems, {
      introPlacement: mode,
      voiceStartOffsetSec: targetInitialOffset,
      postSloganIntroBounds,
      sloganSplitAudioSec,
      introDurSec,
    });
  }

  const firstStart = Number(rawItems[0].start || 0);
  let sourceBaseOffset = 0;
  if (firstStart >= 15.5 && firstStart <= 18.5) {
    sourceBaseOffset = 16.0;
  } else if (firstStart >= 7.5 && firstStart <= 10.5) {
    sourceBaseOffset = 8.0;
  } else if (firstStart >= 5.5 && firstStart < 7.5) {
    sourceBaseOffset = 6.0;
  } else if (firstStart < 2.5) {
    sourceBaseOffset = 0.0;
  } else {
    sourceBaseOffset = Math.max(0, firstStart - 0.55);
  }

  // Detect if rawItems already has an 8s Post-Slogan gap baked in after "Aquí seguimos sus rastros" (~50s-90s of audio)
  let existingPostSloganGapIdx = -1;
  for (let i = 0; i < Math.min(rawItems.length - 1, 65); i++) {
    const approxAudioEnd = rawItems[i].end - sourceBaseOffset;
    if (approxAudioEnd >= 45 && approxAudioEnd <= 90) {
      const gap = rawItems[i + 1].start - rawItems[i].end;
      const combinedTxt = `${rawItems[Math.max(0, i - 1)].text || ''} ${rawItems[i].text || ''}`
        .toLowerCase()
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '');
      if (
        gap >= 7.2 &&
        (combinedTxt.includes('rastros') ||
          combinedTxt.includes('huella') ||
          Math.abs(approxAudioEnd - sloganSplitAudioSec) <= 4.5)
      ) {
        existingPostSloganGapIdx = i;
        break;
      }
    }
  }

  const effectiveSplitSec =
    mode === 'INTRO_POST_SLOGAN' && postSloganIntroBounds
      ? Math.max(0, postSloganIntroBounds.start - targetInitialOffset)
      : sloganSplitAudioSec;
  const effectiveIntroGapSec =
    mode === 'INTRO_POST_SLOGAN' && postSloganIntroBounds
      ? postSloganIntroBounds.duration
      : introDurSec;

  return rawItems.map((it, idx) => {
    const hadExtraIntroGap = existingPostSloganGapIdx >= 0 && idx > existingPostSloganGapIdx;
    const effectiveSourceOffset = sourceBaseOffset + (hadExtraIntroGap ? introDurSec : 0);
    const audioStart = Math.max(0, it.start - effectiveSourceOffset);
    const audioEnd = Math.max(audioStart + 0.25, it.end - effectiveSourceOffset);

    const needsPostSloganShift =
      mode === 'INTRO_POST_SLOGAN' && audioStart >= effectiveSplitSec - 0.15;
    const finalOffset = targetInitialOffset + (needsPostSloganShift ? effectiveIntroGapSec : 0);

    return {
      ...it,
      start: Number((audioStart + finalOffset).toFixed(2)),
      end: Number((audioEnd + finalOffset).toFixed(2)),
    };
  });
}

interface CapCutEditorProps {
  activeDoc: DocumentaryProject | null;
  documentaries?: DocumentaryProject[];
  onSelectDoc?: (docId: string) => void;
  updateActiveDoc: (patch: Partial<DocumentaryProject>, options?: { docId?: string }) => void;
  /** Brings the editor view to the front (used when the user clicks a browser notification). */
  onRequestEditorView?: () => void;
  capturedClipVideosMap: Record<number, string>; // clipNumber -> blob/data URL of MP4
  capturedClipFramesMap?: Record<number, string>; // clipNumber -> initial image / frame preview URL
  capturedSunoAudioMap?: Record<number, string>; // trackNumber -> data URL of MP3
  folderVoiceoverUrl?: string;
  onReloadFolderMedia?: () => Promise<number>;
  onPickDownloadFolder: () => Promise<boolean>;
  downloadFolderName: string;
  downloadFolderPath?: string;
  onSaveFileToChosenFolder: (fileName: string, blobOrDataUrl: Blob | string) => Promise<boolean>;
  onExportOrganizedFolder?: () => Promise<void>;
  officialLogoUrl?: string;
  onOfficialLogoChange?: (dataUrl: string) => void;
  onOpenStage6Review?: () => void;
  isEditorActive?: boolean;
  focusClipRequest?: { clipNumber: number; nonce: number } | null;
}

export const PERMANENT_LOGO_STORAGE_KEY = 'huellas_permanent_official_logo_v1';

export const CapCutEditor: React.FC<CapCutEditorProps> = ({
  activeDoc,
  documentaries = [],
  onSelectDoc,
  updateActiveDoc: updateActiveDocProp,
  onRequestEditorView,
  capturedClipVideosMap,
  capturedClipFramesMap = {},
  capturedSunoAudioMap = {},
  folderVoiceoverUrl = '',
  onReloadFolderMedia,
  onPickDownloadFolder,
  downloadFolderName,
  downloadFolderPath = '',
  onSaveFileToChosenFolder,
  onExportOrganizedFolder,
  officialLogoUrl: propOfficialLogoUrl,
  onOfficialLogoChange,
  onOpenStage6Review,
  isEditorActive = true,
  focusClipRequest = null,
}) => {
  // Every save made by this editor is bound to the documentary that was active when the calling code
  // was created. A slow task (auto-reframe, folder scan, B-roll render) that finishes after the user
  // switched documentary is then dropped by the app instead of landing in the newly opened one.
  const updateActiveDoc = (patch: Partial<DocumentaryProject>) =>
    updateActiveDocProp(patch, { docId: activeDoc?.id || undefined });
  const liveActiveDocIdRef = useRef<string>('');
  liveActiveDocIdRef.current = activeDoc?.id || '';
  const EDITOR_SESSION_STORAGE_KEY = 'huellas_editor_session_state_v1';
  const initialSessionState = useMemo(() => {
    try {
      const raw = localStorage.getItem(EDITOR_SESSION_STORAGE_KEY);
      return raw ? JSON.parse(raw) : {};
    } catch {
      return {};
    }
  }, []);

  const initialDocStateForInit = useMemo(() => {
    try {
      const targetId = activeDoc?.id || initialSessionState?.lastDocId || 'default';
      const raw = localStorage.getItem(`huellas_editor_doc_overlays_${targetId}`);
      return raw ? JSON.parse(raw) : null;
    } catch {
      return null;
    }
  }, []);

  // 1. Aspect Ratio (16:9 vs 9:16) & Export Resolution (HD, 2K, 4K, 8K), FPS, Bitrate & Burn-in Options
  const [aspectRatio, setAspectRatio] = useState<EditorAspectRatio>(() => {
    if (
      initialDocStateForInit?.aspectRatio === '16:9' ||
      initialDocStateForInit?.aspectRatio === '9:16'
    ) {
      return initialDocStateForInit.aspectRatio;
    }
    if (
      initialSessionState?.aspectRatio === '16:9' ||
      initialSessionState?.aspectRatio === '9:16'
    ) {
      return initialSessionState.aspectRatio;
    }
    return activeDoc?.productionType === 'REEL_9X16' ? '9:16' : '16:9';
  });
  const [exportResolution, setExportResolution] = useState<ExportResolutionPreset>(() => {
    const validRes = (v: any): v is ExportResolutionPreset =>
      v === 'HD_1080P' || v === '2K_1440P' || v === '4K_2160P' || v === '8K_4320P';
    if (validRes(initialDocStateForInit?.exportResolution)) {
      return initialDocStateForInit.exportResolution;
    }
    if (validRes(initialSessionState?.exportResolution)) {
      return initialSessionState.exportResolution;
    }
    const initRatio: EditorAspectRatio =
      initialDocStateForInit?.aspectRatio === '9:16' ||
      initialDocStateForInit?.aspectRatio === '16:9'
        ? initialDocStateForInit.aspectRatio
        : initialSessionState?.aspectRatio === '9:16' ||
          initialSessionState?.aspectRatio === '16:9'
        ? initialSessionState.aspectRatio
        : activeDoc?.productionType === 'REEL_9X16'
        ? '9:16'
        : '16:9';
    try {
      const raw = localStorage.getItem('huellas_editor_format_profiles_v1');
      if (raw) {
        const parsed = JSON.parse(raw);
        if (parsed?._v3_res_by_ratio && validRes(parsed?.[initRatio]?.exportResolution)) {
          return parsed[initRatio].exportResolution;
        }
      }
    } catch {}
    return initRatio === '9:16' ? '2K_1440P' : '8K_4320P';
  });
  const [previewQuality, setPreviewQuality] = useState<'low' | 'medium' | 'high'>(() => {
    try {
      const saved = localStorage.getItem('huellas_editor_preview_quality');
      if (saved === 'low' || saved === 'medium' || saved === 'high') {
        return saved;
      }
    } catch {}
    return 'medium';
  });
  const [showExportModal, setShowExportModal] = useState<boolean>(false);
  const [exportFps, setExportFps] = useState<24 | 30 | 60>(() => {
    if (aspectRatio === '9:16') {
      const saved916Fps = Number(
        initialDocStateForInit?.exportFps9x16 ?? initialSessionState?.exportFps9x16
      );
      return saved916Fps === 24 || saved916Fps === 30 || saved916Fps === 60 ? saved916Fps : 30;
    }
    const fps = Number(initialDocStateForInit?.exportFps ?? initialSessionState?.exportFps);
    return fps === 24 || fps === 30 || fps === 60 ? fps : 30;
  });
  const [exportBitrateTier, setExportBitrateTier] = useState<
    'standard' | 'recommended' | 'ultra' | 'custom'
  >(() => {
    const t = initialDocStateForInit?.exportBitrateTier ?? initialSessionState?.exportBitrateTier;
    return t === 'standard' || t === 'recommended' || t === 'ultra' || t === 'custom'
      ? t
      : 'recommended';
  });
  const [exportBitrateMbps, setExportBitrateMbps] = useState<number>(() => {
    const savedBr = Number(
      initialDocStateForInit?.exportBitrateMbps ?? initialSessionState?.exportBitrateMbps
    );
    if (Number.isFinite(savedBr) && savedBr >= 4 && savedBr <= 400) {
      return savedBr;
    }
    const initRatio: EditorAspectRatio =
      initialDocStateForInit?.aspectRatio === '9:16' ||
      initialSessionState?.aspectRatio === '9:16' ||
      activeDoc?.productionType === 'REEL_9X16'
        ? '9:16'
        : '16:9';
    let initRes: ExportResolutionPreset = initRatio === '9:16' ? '2K_1440P' : '8K_4320P';
    try {
      const raw = localStorage.getItem('huellas_editor_format_profiles_v1');
      if (raw) {
        const parsed = JSON.parse(raw);
        if (parsed?._v3_res_by_ratio && parsed?.[initRatio]?.exportResolution) {
          initRes = parsed[initRatio].exportResolution as ExportResolutionPreset;
        }
      }
    } catch {}
    if (initRes === 'HD_1080P') return 18;
    if (initRes === '2K_1440P') return 35;
    if (initRes === '4K_2160P') return 65;
    return 140;
  });
  const [burnInLogo, setBurnInLogo] = useState<boolean>(() =>
    typeof initialDocStateForInit?.burnInLogo === 'boolean'
      ? initialDocStateForInit.burnInLogo
      : typeof initialSessionState?.burnInLogo === 'boolean'
      ? initialSessionState.burnInLogo
      : true
  );
  const [burnInHook, setBurnInHook] = useState<boolean>(() =>
    typeof initialDocStateForInit?.burnInHook === 'boolean'
      ? initialDocStateForInit.burnInHook
      : typeof initialSessionState?.burnInHook === 'boolean'
      ? initialSessionState.burnInHook
      : true
  );
  const [burnInCaptions, setBurnInCaptions] = useState<boolean>(() =>
    typeof initialDocStateForInit?.burnInCaptions === 'boolean'
      ? initialDocStateForInit.burnInCaptions
      : typeof initialSessionState?.burnInCaptions === 'boolean'
      ? initialSessionState.burnInCaptions
      : true
  );
  const [renderStageLabel, setRenderStageLabel] = useState<string>('');
  const [renderStartedAtMs, setRenderStartedAtMs] = useState<number>(0);
  const [renderElapsedSec, setRenderElapsedSec] = useState<number>(0);
  const [renderRemainingSec, setRenderRemainingSec] = useState<number>(0);
  const [renderStepInfo, setRenderStepInfo] = useState<{ current: number; total: number }>({
    current: 0,
    total: 0,
  });
  const [lastExportedOutputPath, setLastExportedOutputPath] = useState<string>('');
  const [isRenderingVideo, setIsRenderingVideo] = useState<boolean>(false);
  const [isCancellingRender, setIsCancellingRender] = useState<boolean>(false);
  const lastSeenRenderCancelledAtRef = useRef<number>(0);
  const [renderProgressPct, setRenderProgressPct] = useState<number>(0);
  const [statusMessage, setStatusMessage] = useState<string>('');
  const [defaultTransition, setDefaultTransition] = useState<ClipTransitionType>(
    () =>
      initialDocStateForInit?.defaultTransition ||
      initialSessionState?.defaultTransition ||
      'direct'
  );

  const getRecommendedBitratesForRes = (res: ExportResolutionPreset) => {
    switch (res) {
      case 'HD_1080P':
        return { standard: 12, recommended: 18, ultra: 28 };
      case '2K_1440P':
        return { standard: 24, recommended: 35, ultra: 50 };
      case '4K_2160P':
        return { standard: 45, recommended: 65, ultra: 95 };
      case '8K_4320P':
      default:
        return { standard: 100, recommended: 140, ultra: 200 };
    }
  };

  const handleSelectExportResolution = (resKey: ExportResolutionPreset) => {
    setExportResolution(resKey);
    const tiers = getRecommendedBitratesForRes(resKey);
    if (exportBitrateTier === 'standard') setExportBitrateMbps(tiers.standard);
    else if (exportBitrateTier === 'ultra') setExportBitrateMbps(tiers.ultra);
    else setExportBitrateMbps(tiers.recommended);
  };

  // Export choices made by the user are stored inside the documentary, per format, so they follow it
  // to every device and never spill into other documentaries. Saved a moment after the last change
  // (the bitrate slider fires continuously).
  const latestActiveDocForExportRef = useRef<DocumentaryProject | null>(null);
  latestActiveDocForExportRef.current = activeDoc || null;
  const pendingDocExportChoiceRef = useRef<{ docId: string; timer: any; patch: Record<string, any> } | null>(null);
  const saveDocExportChoice = (choice: {
    res?: ExportResolutionPreset;
    fps?: 24 | 30 | 60;
    tier?: 'standard' | 'recommended' | 'ultra' | 'custom';
    mbps?: number;
  }) => {
    const docId = activeDoc?.id;
    if (!docId) return;
    const sfx = aspectRatio === '9:16' ? '9X16' : '16X9';
    const patch: Record<string, any> = {};
    if (choice.res) patch[`EXPORT_RESOLUTION_${sfx}`] = choice.res;
    if (choice.fps) patch[`EXPORT_FPS_${sfx}`] = choice.fps;
    if (choice.tier) patch[`EXPORT_BITRATE_TIER_${sfx}`] = choice.tier;
    if (typeof choice.mbps === 'number' && Number.isFinite(choice.mbps)) {
      patch[`EXPORT_BITRATE_MBPS_${sfx}`] = choice.mbps;
    }
    const pending = pendingDocExportChoiceRef.current;
    if (pending) clearTimeout(pending.timer);
    const mergedPatch = pending && pending.docId === docId ? { ...pending.patch, ...patch } : patch;
    const timer = setTimeout(() => {
      pendingDocExportChoiceRef.current = null;
      const liveDoc = latestActiveDocForExportRef.current;
      if (!liveDoc || liveDoc.id !== docId) return;
      updateActiveDocProp(
        { promptConfig: { ...(liveDoc.promptConfig || {}), ...mergedPatch } } as Partial<DocumentaryProject>,
        { docId }
      );
    }, 600);
    pendingDocExportChoiceRef.current = { docId, timer, patch: mergedPatch };
  };
  const handleUserSelectExportResolution = (resKey: ExportResolutionPreset) => {
    handleSelectExportResolution(resKey);
    const tiers = getRecommendedBitratesForRes(resKey);
    if (exportBitrateTier === 'custom') {
      saveDocExportChoice({ res: resKey, tier: 'recommended', mbps: tiers.recommended });
    } else {
      saveDocExportChoice({ res: resKey });
    }
  };

  // Sync with any active server-side FFmpeg render job (e.g. if page reloaded during render)
  useEffect(() => {
    const serverOrigin = getEditorPrimaryServerOrigin();
    let timer: number | null = null;

    const checkServerRenderStatus = async () => {
      try {
        const r = await fetch(`${serverOrigin}/api/editor/render-status`);
        if (!r.ok) return;
        const st = await r.json();
        if (st && st.running) {
          setIsRenderingVideo(true);
          if (typeof st.progressPct === 'number' && st.progressPct > 0) {
            setRenderProgressPct(st.progressPct);
          }
          if (st.stageLabel) {
            setRenderStageLabel(st.stageLabel);
          }
          if (typeof st.startedAt === 'number' && st.startedAt > 0) {
            const elapsed = Math.max(1, Math.floor((Date.now() - st.startedAt) / 1000));
            setRenderElapsedSec(elapsed);
            const cur = Number(st.currentStep || 1);
            const tot = Number(st.totalSteps || 84);
            setRenderStepInfo({ current: cur, total: tot });
            if (cur >= 2) {
              const secPerSeg = elapsed / Math.max(1, cur - 1);
              const remSegs = Math.max(0, tot - (cur - 1));
              setRenderRemainingSec(Math.max(2, Math.round(remSegs * secPerSeg + 10)));
            }
          }
        } else if (st && st.progressPct === 100 && st.outputPath) {
          setIsRenderingVideo(false);
          setRenderProgressPct(100);
          setRenderRemainingSec(0);
          setLastExportedOutputPath(st.outputPath);
          if (st.stageLabel) setRenderStageLabel(st.stageLabel);
        } else if (st && Number(st.cancelledAt) > Date.now() - 60 * 1000) {
          // The export was cancelled (from this or another open editor): stop showing it as running everywhere.
          setIsRenderingVideo(false);
          setIsCancellingRender(false);
          if (lastSeenRenderCancelledAtRef.current !== Number(st.cancelledAt)) {
            lastSeenRenderCancelledAtRef.current = Number(st.cancelledAt);
            setRenderProgressPct(0);
            setRenderStageLabel('🛑 Exportación cancelada');
            setStatusMessage('🛑 Exportación cancelada.');
          }
        } else if (st && st.error && st.error8K && Number(st.errorAt) > Date.now() - 30 * 60 * 1000) {
          // A failed 8K export alerts every open editor (PC or phone), once per failure.
          const seenKey = 'huellas_editor_render_error_seen_at';
          let alreadySeen = false;
          try {
            alreadySeen = localStorage.getItem(seenKey) === String(st.errorAt);
            if (!alreadySeen) localStorage.setItem(seenKey, String(st.errorAt));
          } catch {}
          if (!alreadySeen) {
            setIsRenderingVideo(false);
            setRenderStageLabel(`⚠️ ${st.error}`);
            setStatusMessage(`⚠️ Error en renderizado FFmpeg: ${st.error}`);
            try {
              if (typeof Notification !== 'undefined' && Notification.permission === 'granted') {
                const exportNotice = new Notification('Huellas Master — Exportación 8K detenida', {
                  body: String(st.error),
                });
                exportNotice.onclick = () => {
                  // Take the user to where the problem is: the editor's export window
                  try {
                    window.focus();
                  } catch {}
                  onRequestEditorView?.();
                  setShowExportModal(true);
                  exportNotice.close();
                };
              }
            } catch {}
          }
        }
      } catch {}
    };

    checkServerRenderStatus();
    timer = window.setInterval(checkServerRenderStatus, 2000);
    return () => {
      if (timer) window.clearInterval(timer);
    };
  }, []);

  // Interactive Selection of Objects inside the Video Viewer ('logo' | 'hook_text' | 'captions' | null)
  const [selectedCanvasObject, setSelectedCanvasObject] = useState<
    'logo' | 'hook_text' | 'captions' | 'clip' | null
  >(null);

  // 2. Permanent Official Logo (Uploaded ONCE, stored forever across all documentaries)
  const [officialLogoUrl, setOfficialLogoUrl] = useState<string>(() => {
    return propOfficialLogoUrl || localStorage.getItem(PERMANENT_LOGO_STORAGE_KEY) || '';
  });

  useEffect(() => {
    if (propOfficialLogoUrl && propOfficialLogoUrl !== officialLogoUrl) {
      setOfficialLogoUrl(propOfficialLogoUrl);
    }
  }, [propOfficialLogoUrl]);
  // Load saved global overlay styles (Logo, Hook Text, Captions) so visual adjustments never reset
  const initialOverlayStyles = useMemo(() => {
    try {
      const raw = localStorage.getItem('huellas_editor_overlay_styles_v1');
      return raw ? JSON.parse(raw) : {};
    } catch {
      return {};
    }
  }, []);

  const readSavedDocOverlays = (docId: string | undefined) => {
    try {
      const raw = localStorage.getItem(`huellas_editor_doc_overlays_${docId || 'default'}`);
      return raw ? JSON.parse(raw) : null;
    } catch {
      return null;
    }
  };

  const initialDocOverlays = useMemo(() => readSavedDocOverlays(activeDoc?.id), [activeDoc?.id]);

  const initialFormatProfileForRatio = useMemo(() => {
    try {
      const raw = localStorage.getItem('huellas_editor_format_profiles_v1');
      if (raw) {
        const parsed = JSON.parse(raw);
        if (!parsed._v4_16x9_logoDefault5 && parsed?.['16:9']) {
          parsed['16:9'] = {
            ...parsed['16:9'],
            logoScalePct: 5,
            logoOpacity: 95,
            logoPosX: 3,
            logoPosY: 3,
          };
        }
        if (!parsed._v5_16x9_captionBottom10 && parsed?.['16:9']) {
          parsed['16:9'] = {
            ...parsed['16:9'],
            captionBottomPct: 10,
          };
        }
        if (!parsed._v6_16x9_captionOriginalDefault && parsed?.['16:9']) {
          parsed['16:9'] = {
            ...parsed['16:9'],
            captionLineMode: 'original',
            captionWordsPerLine: 0,
          };
        }
        if (!parsed._v8_9x16_captions16_bottom25 && parsed?.['9:16']) {
          parsed['9:16'] = {
            ...parsed['9:16'],
            captionMaxChars: 16,
            captionBottomPct: 25,
          };
        }
        if (!parsed._v9_9x16_logo_x10_y3 && parsed?.['9:16']) {
          parsed['9:16'] = { ...parsed['9:16'], logoPosX: 10, logoPosY: 3 };
        }
        if (!parsed._v10_9x16_captionBottom20 && parsed?.['9:16']) {
          parsed['9:16'] = { ...parsed['9:16'], captionBottomPct: 20 };
        }
        return parsed?.[aspectRatio] || null;
      }
    } catch {}
    return null;
  }, []);

  const [logoScalePct, setLogoScalePct] = useState<number>(() => {
    if (aspectRatio === '16:9' && !initialOverlayStyles.logoDefault16x9V4) {
      return 5;
    }
    return (
      Number(initialFormatProfileForRatio?.logoScalePct) ||
      Number(initialOverlayStyles.logoScalePct) ||
      (aspectRatio === '9:16' ? 12 : 5)
    );
  });
  const [logoOpacity, setLogoOpacity] = useState<number>(() => {
    if (aspectRatio === '16:9' && !initialOverlayStyles.logoDefault16x9V4) {
      return 95;
    }
    return typeof initialFormatProfileForRatio?.logoOpacity === 'number'
      ? initialFormatProfileForRatio.logoOpacity
      : Number(initialOverlayStyles.logoOpacity) || 95;
  });
  const [logoPosX, setLogoPosX] = useState<number>(() => {
    if (aspectRatio === '16:9' && !initialOverlayStyles.logoDefault16x9V4) {
      return 3;
    }
    return typeof initialFormatProfileForRatio?.logoPosX === 'number'
      ? initialFormatProfileForRatio.logoPosX
      : typeof initialOverlayStyles.logoPosX === 'number'
      ? initialOverlayStyles.logoPosX
      : aspectRatio === '9:16'
      ? 10
      : 3;
  });
  const [logoPosY, setLogoPosY] = useState<number>(() => {
    if (aspectRatio === '16:9' && !initialOverlayStyles.logoDefault16x9V4) {
      return 3;
    }
    return typeof initialFormatProfileForRatio?.logoPosY === 'number'
      ? initialFormatProfileForRatio.logoPosY
      : typeof initialOverlayStyles.logoPosY === 'number'
      ? initialOverlayStyles.logoPosY
      : 3;
  });
  // Default Logo animations for ALL documentaries: Fade In 1.5s at the start and Fade Out 2.5s at the end of the documentary
  const [logoAnimIn, setLogoAnimIn] = useState<ElementAnimationType>(() =>
    initialOverlayStyles.logoAnimInFadeV1 && initialOverlayStyles.logoAnimIn
      ? initialOverlayStyles.logoAnimIn
      : 'fade'
  );
  const [logoAnimInDur, setLogoAnimInDur] = useState<number>(() =>
    initialOverlayStyles.logoAnimInFadeV1 && Number(initialOverlayStyles.logoAnimInDur) > 0
      ? Number(initialOverlayStyles.logoAnimInDur)
      : 1.5
  );
  const [logoAnimOut, setLogoAnimOut] = useState<ElementAnimationType>(
    () => initialOverlayStyles.logoAnimOut || 'fade'
  );
  const [logoAnimOutDur, setLogoAnimOutDur] = useState<number>(
    () => Number(initialOverlayStyles.logoAnimOutDur) || 2.5
  );

  // 2B. Permanent Official Intro Stinger Video (8s — Fixed across all documentaries)
  const [officialIntroUrl, setOfficialIntroUrl] = useState<string>('');
  const [officialIntroFileName, setOfficialIntroFileName] = useState<string>('');
  const [officialOutroFileName, setOfficialOutroFileName] = useState<string>('');
  const [officialAssetsVersion, setOfficialAssetsVersion] = useState<number>(0);
  const [officialIntroTier, setOfficialIntroTier] = useState<
    'icloud_hydrated' | 'custom_uploaded' | 'fallback'
  >('fallback');
  const [officialOutroTier, setOfficialOutroTier] = useState<
    'icloud_hydrated' | 'custom_uploaded' | 'fallback'
  >('fallback');
  const [introPlacementMode, setIntroPlacementMode] = useState<'INTRO_POST_SLOGAN' | 'INTRO_INICIO_00'>(() => {
    return activeDoc?.promptConfig?.UBICACION_INTRO_MARCA === 'INTRO_POST_SLOGAN'
      ? 'INTRO_POST_SLOGAN'
      : 'INTRO_INICIO_00';
  });

  // 3. Clip 1 Hook Overlay Text (00:08 - 00:16, right after the 8s Intro) + Typography, Size, Shadow, Background, Position & Animations
  const [clip1Line1, setClip1Line1] = useState<string>(() => {
    if (initialDocOverlays && typeof initialDocOverlays.clip1Line1 === 'string') {
      return initialDocOverlays.clip1Line1;
    }
    return normalizeClip1Line1Format(activeDoc?.clip1Line1LocationTime || '');
  });
  const [clip1Line2, setClip1Line2] = useState<string>(() => {
    if (initialDocOverlays && typeof initialDocOverlays.clip1Line2 === 'string') {
      return initialDocOverlays.clip1Line2;
    }
    return activeDoc?.clip1Line2Hook || '';
  });
  const [clip1OverlayEndSec, setClip1OverlayEndSec] = useState<number>(() => {
    if (initialDocOverlays && typeof initialDocOverlays.clip1OverlayEndSec === 'number' && initialDocOverlays.clip1OverlayEndSec > 0) {
      return Number(initialDocOverlays.clip1OverlayEndSec);
    }
    if (typeof initialOverlayStyles.clip1OverlayEndSec === 'number' && initialOverlayStyles.clip1OverlayEndSec > 0) {
      return Number(initialOverlayStyles.clip1OverlayEndSec);
    }
    const { clip1Sec } = getStage1ClipDurations(activeDoc);
    const clip1VisualDur = !clip1Sec || clip1Sec <= 0 ? 6 : clip1Sec;
    return 8 + clip1VisualDur;
  });
  // Default Hook Text animations for ALL documentaries (after 8s Intro at 00:00 - 00:08):
  // Line 1: starts at 8s (Clip 1), Fade In 1s (8s->9s), Fade Out 1s toward 16s (15s->16s)
  // Line 2: appears at 10s (2s into Clip 1), Fade In 1s (10s->11s), Fade Out 1s toward 16s (15s->16s)
  const [hookLine1StartSec, setHookLine1StartSec] = useState<number>(() =>
    typeof initialDocOverlays?.hookLine1StartSec === 'number'
      ? initialDocOverlays.hookLine1StartSec
      : typeof initialOverlayStyles.hookLine1StartSec === 'number'
      ? initialOverlayStyles.hookLine1StartSec
      : 8
  );
  const [hookLine1AnimIn, setHookLine1AnimIn] = useState<ElementAnimationType>(
    () => initialDocOverlays?.hookLine1AnimIn || initialOverlayStyles.hookLine1AnimIn || 'fade'
  );
  const [hookLine1AnimInDur, setHookLine1AnimInDur] = useState<number>(
    () => Number(initialDocOverlays?.hookLine1AnimInDur ?? initialOverlayStyles.hookLine1AnimInDur) || 1
  );
  const [hookLine1AnimOut, setHookLine1AnimOut] = useState<ElementAnimationType>(
    () => initialDocOverlays?.hookLine1AnimOut || initialOverlayStyles.hookLine1AnimOut || 'fade'
  );
  const [hookLine1AnimOutDur, setHookLine1AnimOutDur] = useState<number>(
    () => Number(initialDocOverlays?.hookLine1AnimOutDur ?? initialOverlayStyles.hookLine1AnimOutDur) || 1
  );

  const [hookLine2StartSec, setHookLine2StartSec] = useState<number>(() =>
    typeof initialDocOverlays?.hookLine2StartSec === 'number'
      ? initialDocOverlays.hookLine2StartSec
      : typeof initialOverlayStyles.hookLine2StartSec === 'number'
      ? initialOverlayStyles.hookLine2StartSec
      : 10
  );
  const [hookLine2AnimIn, setHookLine2AnimIn] = useState<ElementAnimationType>(
    () => initialDocOverlays?.hookLine2AnimIn || initialOverlayStyles.hookLine2AnimIn || 'fade'
  );
  const [hookLine2AnimInDur, setHookLine2AnimInDur] = useState<number>(
    () => Number(initialDocOverlays?.hookLine2AnimInDur ?? initialOverlayStyles.hookLine2AnimInDur) || 1
  );
  const [hookLine2AnimOut, setHookLine2AnimOut] = useState<ElementAnimationType>(
    () => initialDocOverlays?.hookLine2AnimOut || initialOverlayStyles.hookLine2AnimOut || 'fade'
  );
  const [hookLine2AnimOutDur, setHookLine2AnimOutDur] = useState<number>(
    () => Number(initialDocOverlays?.hookLine2AnimOutDur ?? initialOverlayStyles.hookLine2AnimOutDur) || 1
  );

  // Animations for Captions & Video Clips / Images
  const [captionAnimIn, setCaptionAnimIn] = useState<ElementAnimationType>(
    () => activeDoc?.promptConfig?.CAPTION_ANIM_IN || initialOverlayStyles.captionAnimIn || 'fade'
  );
  const [captionAnimOut, setCaptionAnimOut] = useState<ElementAnimationType>(
    () => activeDoc?.promptConfig?.CAPTION_ANIM_OUT || initialOverlayStyles.captionAnimOut || 'fade'
  );
  const [captionAnimDur, setCaptionAnimDur] = useState<number>(() => {
    const fromDoc = Number(activeDoc?.promptConfig?.CAPTION_ANIM_DUR);
    if (Number.isFinite(fromDoc) && fromDoc >= 0.05 && fromDoc <= 3.0) return fromDoc;
    return Number(initialOverlayStyles.captionAnimDur) || 0.25;
  });

  const [clipAnimIn, setClipAnimIn] = useState<ElementAnimationType>(
    () => initialSessionState?.clipAnimIn || 'none'
  );
  const [clipAnimOut, setClipAnimOut] = useState<ElementAnimationType>(
    () => initialSessionState?.clipAnimOut || 'none'
  );
  const [clipAnimDur, setClipAnimDur] = useState<number>(
    () => Number(initialSessionState?.clipAnimDur) || 0.6
  );

  const [hookFontFamily, setHookFontFamily] = useState<string>(
    () => initialOverlayStyles.hookFontFamily || EDITOR_FONT_OPTIONS[0].value
  );
  const [hookLine1FontSize, setHookLine1FontSize] = useState<number>(
    () => Number(initialOverlayStyles.hookLine1FontSize) || 15
  );
  const [hookLine2FontSize, setHookLine2FontSize] = useState<number>(
    () => Number(initialOverlayStyles.hookLine2FontSize) || 24
  );
  const [hookLine1Color, setHookLine1Color] = useState<string>(
    () => initialOverlayStyles.hookLine1Color || '#fcd34d'
  );
  const [hookLine2Color, setHookLine2Color] = useState<string>(
    () => initialOverlayStyles.hookLine2Color || '#ffffff'
  );
  const [hookShadowStyle, setHookShadowStyle] = useState<OverlayShadowStyle>(
    () => initialOverlayStyles.hookShadowStyle || 'cinema'
  );
  const [hookBgStyle, setHookBgStyle] = useState<OverlayBgStyle>(
    () => (initialOverlayStyles.hookBgStyle === 'semi' || initialOverlayStyles.hookBgStyle === 'solid' ? initialOverlayStyles.hookBgStyle : 'none')
  );
  const [hookBgColor, setHookBgColor] = useState<string>(
    () => initialOverlayStyles.hookBgColor || '#000000'
  );
  const [hookBgOpacity, setHookBgOpacity] = useState<number>(() =>
    typeof initialOverlayStyles.hookBgOpacity === 'number' ? initialOverlayStyles.hookBgOpacity : 55
  );
  const [hookLeftPct, setHookLeftPct] = useState<number>(() =>
    typeof initialOverlayStyles.hookLeftPct === 'number' ? initialOverlayStyles.hookLeftPct : 50
  );
  const [hookTopPct, setHookTopPct] = useState<number>(() =>
    typeof initialOverlayStyles.hookTopPct === 'number' ? initialOverlayStyles.hookTopPct : 50
  );
  const [hookBoxWidthPct, setHookBoxWidthPct] = useState<number>(
    () => Number(initialOverlayStyles.hookBoxWidthPct) || 82
  );
  const [isDraggingOrResizingHook, setIsDraggingOrResizingHook] = useState<boolean>(false);
  const [isLeftPanelCollapsed, setIsLeftPanelCollapsed] = useState<boolean>(() =>
    typeof initialSessionState?.isLeftPanelCollapsed === 'boolean'
      ? initialSessionState.isLeftPanelCollapsed
      : typeof window !== 'undefined' && window.innerWidth < 1024
  );
  const [leftPanelTab, setLeftPanelTab] = useState<
    'media' | 'audio' | 'text' | 'transitions' | 'captions'
  >(() => {
    const t = initialSessionState?.leftPanelTab;
    return t === 'media' ||
      t === 'audio' ||
      t === 'text' ||
      t === 'transitions' ||
      t === 'captions'
      ? t
      : 'media';
  });
  const [isRightPanelCollapsed, setIsRightPanelCollapsed] = useState<boolean>(() =>
    typeof initialSessionState?.isRightPanelCollapsed === 'boolean'
      ? initialSessionState.isRightPanelCollapsed
      : typeof window !== 'undefined' && window.innerWidth < 1024
  );
  const [isTimelineDockExpanded, setIsTimelineDockExpanded] = useState<boolean>(() =>
    typeof initialSessionState?.isTimelineDockExpanded === 'boolean'
      ? initialSessionState.isTimelineDockExpanded
      : false
  );
  const viewerStageRef = useRef<HTMLDivElement | null>(null);
  const [viewerStageSize, setViewerStageSize] = useState<{ width: number; height: number }>({
    width: 0,
    height: 0,
  });
  const viewerCanvasRef = useRef<HTMLDivElement | null>(null);
  const viewerContainerRef = useRef<HTMLDivElement | null>(null);
  const [isViewerFullscreen, setIsViewerFullscreen] = useState<boolean>(false);
  const [showFullscreenControls, setShowFullscreenControls] = useState<boolean>(true);
  const fsInactivityTimerRef = useRef<any>(null);
  const CANONICAL_STAGE_HEIGHT = 520;
  const canonicalStageWidth =
    aspectRatio === '16:9' ? (CANONICAL_STAGE_HEIGHT * 16) / 9 : (CANONICAL_STAGE_HEIGHT * 9) / 16;
  const [viewerCanvasSize, setViewerCanvasSize] = useState<{ width: number; height: number }>({
    width: canonicalStageWidth,
    height: CANONICAL_STAGE_HEIGHT,
  });
  const viewerScaleX =
    viewerCanvasSize.width > 0 ? viewerCanvasSize.width / canonicalStageWidth : 1;
  const viewerScaleY =
    viewerCanvasSize.height > 0 ? viewerCanvasSize.height / CANONICAL_STAGE_HEIGHT : 1;

  useEffect(() => {
    const stageEl = viewerStageRef.current;
    if (!stageEl) return;
    const syncStageSize = () => {
      const rect = stageEl.getBoundingClientRect();
      const availW = Math.max(0, rect.width - 8);
      const availH = Math.max(0, rect.height - 8);
      if (availW > 0 && availH > 0) {
        setViewerStageSize((prev) =>
          Math.abs(prev.width - availW) < 0.5 && Math.abs(prev.height - availH) < 0.5
            ? prev
            : { width: availW, height: availH }
        );
      }
    };
    syncStageSize();
    const ro =
      typeof ResizeObserver !== 'undefined' ? new ResizeObserver(() => syncStageSize()) : null;
    if (ro) ro.observe(stageEl);
    window.addEventListener('resize', syncStageSize);
    return () => {
      if (ro) ro.disconnect();
      window.removeEventListener('resize', syncStageSize);
    };
  }, [
    isViewerFullscreen,
    aspectRatio,
    isEditorActive,
    isLeftPanelCollapsed,
    isRightPanelCollapsed,
    isTimelineDockExpanded,
    selectedCanvasObject,
  ]);

  useEffect(() => {
    const el = viewerCanvasRef.current;
    if (!el) return;
    const syncViewerSize = () => {
      const rect = el.getBoundingClientRect();
      if (rect.width > 0 && rect.height > 0) {
        setViewerCanvasSize((prev) =>
          Math.abs(prev.width - rect.width) < 0.5 && Math.abs(prev.height - rect.height) < 0.5
            ? prev
            : { width: rect.width, height: rect.height }
        );
      }
    };
    syncViewerSize();
    const ro =
      typeof ResizeObserver !== 'undefined' ? new ResizeObserver(() => syncViewerSize()) : null;
    if (ro) ro.observe(el);
    window.addEventListener('resize', syncViewerSize);
    return () => {
      if (ro) ro.disconnect();
      window.removeEventListener('resize', syncViewerSize);
    };
  }, [isViewerFullscreen, aspectRatio, isEditorActive, viewerStageSize]);

  useEffect(() => {
    const onFsChange = () => {
      const fsEl =
        document.fullscreenElement || (document as any).webkitFullscreenElement || null;
      const isFs = Boolean(fsEl);
      setIsViewerFullscreen(isFs);
      setShowFullscreenControls(true);
      if (isFs) {
        setSelectedCanvasObject(null);
        setIsDraggingOrResizingHook(false);
      }
    };
    document.addEventListener('fullscreenchange', onFsChange);
    document.addEventListener('webkitfullscreenchange', onFsChange);
    return () => {
      document.removeEventListener('fullscreenchange', onFsChange);
      document.removeEventListener('webkitfullscreenchange', onFsChange);
    };
  }, []);

  // Auto-hide bottom player controls in Fullscreen after 5 seconds of inactivity; wake up on any mouse or keyboard activity
  useEffect(() => {
    if (!isViewerFullscreen) {
      setShowFullscreenControls(true);
      if (fsInactivityTimerRef.current) {
        clearTimeout(fsInactivityTimerRef.current);
        fsInactivityTimerRef.current = null;
      }
      return;
    }

    const wakeControlsAndResetTimer = () => {
      setShowFullscreenControls(true);
      if (fsInactivityTimerRef.current) {
        clearTimeout(fsInactivityTimerRef.current);
      }
      fsInactivityTimerRef.current = setTimeout(() => {
        setShowFullscreenControls(false);
      }, 5000);
    };

    wakeControlsAndResetTimer();

    window.addEventListener('mousemove', wakeControlsAndResetTimer, { passive: true });
    window.addEventListener('mousedown', wakeControlsAndResetTimer, { passive: true });
    window.addEventListener('keydown', wakeControlsAndResetTimer);
    window.addEventListener('wheel', wakeControlsAndResetTimer, { passive: true });
    window.addEventListener('touchstart', wakeControlsAndResetTimer, { passive: true });

    return () => {
      if (fsInactivityTimerRef.current) {
        clearTimeout(fsInactivityTimerRef.current);
        fsInactivityTimerRef.current = null;
      }
      window.removeEventListener('mousemove', wakeControlsAndResetTimer);
      window.removeEventListener('mousedown', wakeControlsAndResetTimer);
      window.removeEventListener('keydown', wakeControlsAndResetTimer);
      window.removeEventListener('wheel', wakeControlsAndResetTimer);
      window.removeEventListener('touchstart', wakeControlsAndResetTimer);
    };
  }, [isViewerFullscreen]);

  useEffect(() => {
    if (!selectedCanvasObject) return;
    const handleOutsideVisorMouseDown = (e: MouseEvent) => {
      const target = e.target as HTMLElement | null;
      if (!target) return;
      if (viewerCanvasRef.current && viewerCanvasRef.current.contains(target)) {
        return;
      }
      if (
        target.closest('[data-keep-canvas-selection="true"]') ||
        target.closest('input, select, textarea, option')
      ) {
        return;
      }
      // Moving the playhead (timeline or player bar) keeps the clip selected, so framing points can be
      // fixed one after another without re-selecting the clip each time.
      if (selectedCanvasObject === 'clip' && target.closest('[data-keep-clip-selection="true"]')) {
        return;
      }
      setSelectedCanvasObject(null);
      setIsDraggingOrResizingHook(false);
    };
    document.addEventListener('mousedown', handleOutsideVisorMouseDown);
    return () => {
      document.removeEventListener('mousedown', handleOutsideVisorMouseDown);
    };
  }, [selectedCanvasObject]);

  const handleToggleViewerFullscreen = async () => {
    const el = viewerContainerRef.current;
    if (!el) return;
    try {
      const fsEl =
        document.fullscreenElement || (document as any).webkitFullscreenElement || null;
      if (fsEl) {
        if (document.exitFullscreen) {
          await document.exitFullscreen();
        } else if ((document as any).webkitExitFullscreen) {
          (document as any).webkitExitFullscreen();
        }
      } else {
        if (el.requestFullscreen) {
          await el.requestFullscreen();
        } else if ((el as any).webkitRequestFullscreen) {
          (el as any).webkitRequestFullscreen();
        }
      }
    } catch {}
  };

  const handleStartHookBoxDrag = (e: React.MouseEvent) => {
    if (e.button !== 0 || isViewerFullscreen) return;
    e.stopPropagation();
    setSelectedCanvasObject('hook_text');
    setActiveInspectorTab('branding');
    const canvasEl = viewerCanvasRef.current;
    if (!canvasEl) return;
    const rect = canvasEl.getBoundingClientRect();
    if (!rect.width || !rect.height) return;

    const startX = e.clientX;
    const startY = e.clientY;
    const initLeft = hookLeftPct;
    const initTop = hookTopPct;
    let moved = false;

    const onMove = (moveEvt: MouseEvent) => {
      const dxPx = moveEvt.clientX - startX;
      const dyPx = moveEvt.clientY - startY;
      if (!moved && Math.hypot(dxPx, dyPx) < 3) return;
      moved = true;
      setIsDraggingOrResizingHook(true);

      let nextLeft = Math.max(8, Math.min(92, initLeft + (dxPx / rect.width) * 100));
      let nextTop = Math.max(8, Math.min(92, initTop + (dyPx / rect.height) * 100));

      // Magnetic snap to center lines (50% horizontal & 50% vertical)
      if (Math.abs(nextLeft - 50) <= 2.2) nextLeft = 50;
      if (Math.abs(nextTop - 50) <= 2.2) nextTop = 50;

      setHookLeftPct(Number(nextLeft.toFixed(1)));
      setHookTopPct(Number(nextTop.toFixed(1)));
    };

    const onUp = () => {
      setIsDraggingOrResizingHook(false);
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
    };

    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
  };

  const handleStartHookBoxResize = (
    e: React.MouseEvent,
    handle: 'nw' | 'ne' | 'sw' | 'se' | 'w' | 'e'
  ) => {
    if (e.button !== 0 || isViewerFullscreen) return;
    e.stopPropagation();
    e.preventDefault();
    setSelectedCanvasObject('hook_text');
    setActiveInspectorTab('branding');
    const canvasEl = viewerCanvasRef.current;
    if (!canvasEl) return;
    const rect = canvasEl.getBoundingClientRect();
    if (!rect.width || !rect.height) return;

    const startX = e.clientX;
    const startY = e.clientY;
    const initWidth = hookBoxWidthPct;
    const initF1 = hookLine1FontSize;
    const initF2 = hookLine2FontSize;
    setIsDraggingOrResizingHook(true);

    const onMove = (moveEvt: MouseEvent) => {
      const dxPx = moveEvt.clientX - startX;
      const dyPx = moveEvt.clientY - startY;
      const dirX = handle.includes('w') ? -1 : 1;
      const deltaWidthPct = ((dxPx * dirX * 2) / rect.width) * 100;
      const nextWidth = Math.max(22, Math.min(96, initWidth + deltaWidthPct));
      setHookBoxWidthPct(Math.round(nextWidth));

      // If pulling a corner handle vertically, also scale font sizes proportionally
      if (handle === 'nw' || handle === 'ne' || handle === 'sw' || handle === 'se') {
        const dirY = handle.includes('n') ? -1 : 1;
        const scaleDelta = (dyPx * dirY) / 140;
        if (Math.abs(dyPx) > 6) {
          const factor = Math.max(0.55, Math.min(2.2, 1 + scaleDelta));
          setHookLine1FontSize(Math.max(10, Math.min(44, Math.round(initF1 * factor))));
          setHookLine2FontSize(Math.max(14, Math.min(60, Math.round(initF2 * factor))));
        }
      }
    };

    const onUp = () => {
      setIsDraggingOrResizingHook(false);
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
    };

    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
  };

  // 4. Five Multi-Tracks State
  const [timelineClips, setTimelineClips] = useState<TimelineClipItem[]>([]);
  const [selectedClipId, setSelectedClipId] = useState<string | null>(
    () =>
      initialDocStateForInit?.selectedClipId ||
      initialSessionState?.selectedClipId ||
      null
  );
  const [selectedClipIds, setSelectedClipIds] = useState<string[]>(() => {
    if (
      Array.isArray(initialDocStateForInit?.selectedClipIds) &&
      initialDocStateForInit.selectedClipIds.length > 0
    ) {
      return initialDocStateForInit.selectedClipIds;
    }
    if (
      Array.isArray(initialSessionState?.selectedClipIds) &&
      initialSessionState.selectedClipIds.length > 0
    ) {
      return initialSessionState.selectedClipIds;
    }
    const single =
      initialDocStateForInit?.selectedClipId || initialSessionState?.selectedClipId;
    return single ? [single] : [];
  });
  const [clipContextMenu, setClipContextMenu] = useState<{
    x: number;
    y: number;
    clipIds: string[];
    showSepararSubmenu: boolean;
  } | null>(null);
  const [separatedVocalSegments, setSeparatedVocalSegments] = useState<TimelineSeparatedVocalItem[]>(
    () =>
      initialDocOverlays && Array.isArray(initialDocOverlays.separatedVocalSegments)
        ? initialDocOverlays.separatedVocalSegments
        : []
  );
  const [selectedVocalSegmentId, setSelectedVocalSegmentId] = useState<string | null>(
    () => initialSessionState?.selectedVocalSegmentId || null
  );
  const [isSeparatingVocals, setIsSeparatingVocals] = useState<boolean>(false);
  const [separatedMusicSegments, setSeparatedMusicSegments] = useState<TimelineSeparatedVocalItem[]>(
    () =>
      initialDocOverlays && Array.isArray(initialDocOverlays.separatedMusicSegments)
        ? initialDocOverlays.separatedMusicSegments
        : []
  );
  const [selectedMusicSegmentId, setSelectedMusicSegmentId] = useState<string | null>(
    () => initialSessionState?.selectedMusicSegmentId || null
  );
  const [isSeparatingMusic, setIsSeparatingMusic] = useState<boolean>(false);
  const [isIsolatingFoley, setIsIsolatingFoley] = useState<boolean>(false);
  const [foleyIsolationProgress, setFoleyIsolationProgress] = useState<{ current: number; total: number } | null>(null);
  const [autoIsolateFoleyAllClips, setAutoIsolateFoleyAllClips] = useState<boolean>(() =>
    typeof initialSessionState?.autoIsolateFoleyAllClips === 'boolean'
      ? initialSessionState.autoIsolateFoleyAllClips
      : false
  );

  interface PreviewProxyStatusState {
    quality: 'low' | 'medium';
    total: number;
    ready: number;
    building: number;
    queued: number;
    missing: number;
    percent: number;
    activeWorkers: number;
    items: Record<string, { status: 'ready' | 'building' | 'queued' | 'missing'; size?: number }>;
    isWarmingAll: boolean;
  }

  const [previewProxyStatus, setPreviewProxyStatus] = useState<PreviewProxyStatusState>({
    quality: 'medium',
    total: 0,
    ready: 0,
    building: 0,
    queued: 0,
    missing: 0,
    percent: 0,
    activeWorkers: 0,
    items: {},
    isWarmingAll: false,
  });

  const fetchPreviewProxyStatus = useCallback(
    async (autoWarm = false) => {
      if (previewQuality === 'high') return;
      const targetQuality = previewQuality === 'low' ? 'low' : 'medium';
      const fileUrls: string[] = [];
      for (const c of timelineClips) {
        if (c.videoUrl) fileUrls.push(c.videoUrl);
      }
      if (officialIntroUrl) fileUrls.push(officialIntroUrl);
      if (fileUrls.length === 0) return;

      try {
        // Origen del servidor del Mac (igual que el resto del editor): con ruta relativa fallaba fuera de :4200 y quedaba en 0/0
        const res = await fetch(`${getEditorPrimaryServerOrigin()}/api/flow/preview-proxy-status`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            quality: targetQuality,
            urls: fileUrls,
            autoWarm,
          }),
        });
        if (!res.ok) return;
        const data = await res.json();
        if (data && data.ok) {
          const nextWarming = Boolean(data.building || data.queued);
          setPreviewProxyStatus((prev) =>
            // Sin cambios → mismo objeto: evita re-pintar todo el editor cada 3.5s durante la reproducción
            prev.quality === targetQuality &&
            prev.total === (data.total || 0) &&
            prev.ready === (data.ready || 0) &&
            prev.building === (data.building || 0) &&
            prev.queued === (data.queued || 0) &&
            prev.missing === (data.missing || 0) &&
            prev.isWarmingAll === nextWarming
              ? prev
              : {
            quality: targetQuality,
            total: data.total || 0,
            ready: data.ready || 0,
            building: data.building || 0,
            queued: data.queued || 0,
            missing: data.missing || 0,
            percent: data.percent ?? 0,
            activeWorkers: data.activeWorkers || 0,
            items: data.items || {},
            isWarmingAll: nextWarming,
          });
        }
      } catch {}
    },
    [previewQuality, timelineClips, officialIntroUrl]
  );

  useEffect(() => {
    if (previewQuality === 'high') return;
    // Auto-generate missing proxies silently in background:
    void fetchPreviewProxyStatus(true);
    const interval = setInterval(() => {
      // Durante la reproducción no se sondea: cada respuesta repinta el editor y traba la aguja
      if (isPlayingRef.current) return;
      void fetchPreviewProxyStatus(true);
    }, 3500);
    return () => clearInterval(interval);
  }, [fetchPreviewProxyStatus, previewQuality]);
  const autoAttemptedFoleyClipIdsRef = useRef<Set<string>>(new Set());
  const [draggedClipIndex, setDraggedClipIndex] = useState<number | null>(null);
  const [showOnlyReviewedClips, setShowOnlyReviewedClips] = useState<boolean>(true);

  // Voiceover Track (Track 4) — Starts at 16s in Opción A (after 8s Intro + 8s Clip 1 Hook) or 8s in Opción B (Post-Slogan)
  const [voiceStartOffsetSec, setVoiceStartOffsetSec] = useState<number>(() => {
    const mode =
      activeDoc?.promptConfig?.UBICACION_INTRO_MARCA === 'INTRO_POST_SLOGAN'
        ? 'INTRO_POST_SLOGAN'
        : 'INTRO_INICIO_00';
    const { voiceEntrySec } = getStage1ClipDurations(activeDoc);
    const clip1HookDur = voiceEntrySec;
    return mode === 'INTRO_POST_SLOGAN' ? clip1HookDur : 8 + clip1HookDur;
  });
  const [voiceDurationSec, setVoiceDurationSec] = useState<number>(0);
  const [voiceVolume, setVoiceVolume] = useState<number>(() => {
    const v = Number(initialDocStateForInit?.voiceVolume ?? initialSessionState?.voiceVolume);
    return Number.isFinite(v) && v >= 0 && v <= 200 ? v : 100;
  });
  const [voiceGainDb, setVoiceGainDb] = useState<number>(() => {
    const g = Number(initialDocStateForInit?.voiceGainDb ?? initialSessionState?.voiceGainDb);
    return Number.isFinite(g) && g >= -12 && g <= 18 ? g : 5;
  }); // Always +5 dB boost for narrative voiceover
  const [autoDuckingEnabled, setAutoDuckingEnabled] = useState<boolean>(() =>
    typeof initialDocStateForInit?.autoDuckingEnabled === 'boolean'
      ? initialDocStateForInit.autoDuckingEnabled
      : typeof initialSessionState?.autoDuckingEnabled === 'boolean'
      ? initialSessionState.autoDuckingEnabled
      : true
  );
  const [foleyHighVolume, setFoleyHighVolume] = useState<number>(() => {
    const v = Number(
      initialDocStateForInit?.foleyHighVolume ?? initialSessionState?.foleyHighVolume
    );
    return Number.isFinite(v) && v >= 0 && v <= 100 ? v : 80;
  }); // When narrator is silent
  const [foleyDuckedVolume, setFoleyDuckedVolume] = useState<number>(() => {
    const v = Number(
      initialDocStateForInit?.foleyDuckedVolume ?? initialSessionState?.foleyDuckedVolume
    );
    return Number.isFinite(v) && v >= 0 && v <= 100 ? v : 20;
  }); // When narrator speaks

  // Captions Track (Track 2) + Typography, Size, Shadow, Background & Position
  const [captions, setCaptions] = useState<TimelineCaptionItem[]>(() => {
    if (
      initialDocOverlays &&
      Array.isArray(initialDocOverlays.captions) &&
      initialDocOverlays.captions.length > 0
    ) {
      const combinedInit = `${activeDoc?.masterAudioUrl || ''} ${activeDoc?.title || ''} ${activeDoc?.topic || ''} ${activeDoc?.downloadFolderName || ''}`.toLowerCase();
      const isInitVideo76 =
        combinedInit.includes('tts-video-76-exodo-espanol') ||
        combinedInit.includes('video_76') ||
        combinedInit.includes('video 76') ||
        combinedInit.includes('éxodo español') ||
        combinedInit.includes('exodo espanol');
      if (
        !isInitVideo76 &&
        initialDocOverlays.captionsAlignVersion !== CAPTIONS_ALIGN_VERSION &&
        !initialDocOverlays.userEditedCaptions
      ) {
        return [];
      }
      const mode =
        activeDoc?.promptConfig?.UBICACION_INTRO_MARCA === 'INTRO_POST_SLOGAN'
          ? 'INTRO_POST_SLOGAN'
          : 'INTRO_INICIO_00';
      const { voiceEntrySec } = getStage1ClipDurations(activeDoc);
      const clip1HookDur = voiceEntrySec;
      const initVoStart = mode === 'INTRO_POST_SLOGAN' ? clip1HookDur : 8 + clip1HookDur;
      return projectAudioCaptionsToTimeline(initialDocOverlays.captions, {
        introPlacement: mode,
        voiceStartOffsetSec: initVoStart,
        postSloganIntroBounds: null,
        sloganSplitAudioSec: 68.5,
        introDurSec: 8,
      });
    }
    return [];
  });
  const [captionFontFamily, setCaptionFontFamily] = useState<string>(
    () =>
      activeDoc?.promptConfig?.CAPTION_FONT_FAMILY ||
      initialOverlayStyles.captionFontFamily ||
      EDITOR_FONT_OPTIONS[0].value
  );
  const [captionMaxChars, setCaptionMaxChars] = useState<number>(() => {
    if (aspectRatio === '9:16') {
      const fromDoc916 = Number(activeDoc?.promptConfig?.CAPTION_MAX_CHARS_9X16);
      return Number.isFinite(fromDoc916) && fromDoc916 > 0 ? fromDoc916 : 16;
    }
    const fromDoc = Number(activeDoc?.promptConfig?.CAPTION_MAX_CHARS);
    if (Number.isFinite(fromDoc) && fromDoc >= 0) return fromDoc;
    const fromProfile = Number(initialFormatProfileForRatio?.captionMaxChars);
    if (Number.isFinite(fromProfile) && fromProfile >= 0) return fromProfile;
    const fromSaved = Number(initialOverlayStyles.captionMaxChars);
    if (Number.isFinite(fromSaved) && fromSaved >= 0) return fromSaved;
    return 32;
  });
  const [captionLineMode, setCaptionLineMode] = useState<'subdivide' | 'wrap' | 'original'>(() => {
    const fromDoc = activeDoc?.promptConfig?.CAPTION_LINE_MODE;
    if (fromDoc === 'subdivide' || fromDoc === 'wrap' || fromDoc === 'original') return fromDoc;
    if (aspectRatio === '16:9' && !initialOverlayStyles.captionOriginal16x9V1) {
      return 'original';
    }
    const fromProfile = initialFormatProfileForRatio?.captionLineMode;
    if (fromProfile === 'subdivide' || fromProfile === 'wrap' || fromProfile === 'original') return fromProfile;
    const fromSaved = initialOverlayStyles.captionLineMode;
    if (fromSaved === 'subdivide' || fromSaved === 'wrap' || fromSaved === 'original') return fromSaved;
    return aspectRatio === '16:9' ? 'original' : 'subdivide';
  });
  const [captionFontSize16x9, setCaptionFontSize16x9] = useState<number>(() => {
    const fromDoc = Number(activeDoc?.promptConfig?.CAPTION_FONT_SIZE_16X9);
    if (Number.isFinite(fromDoc) && fromDoc >= 12) return fromDoc;
    try {
      const raw = localStorage.getItem('huellas_editor_format_profiles_v1');
      if (raw) {
        const parsed = JSON.parse(raw);
        if (Number(parsed?.['16:9']?.captionFontSize) >= 12) {
          return Number(parsed['16:9'].captionFontSize);
        }
      }
    } catch {}
    return initialOverlayStyles.captionFontSizeV25
      ? Number(initialOverlayStyles.captionFontSize) || 25
      : 25;
  });
  const [captionFontSize9x16, setCaptionFontSize9x16] = useState<number>(() => {
    const fromDoc = Number(activeDoc?.promptConfig?.CAPTION_FONT_SIZE_9X16);
    if (Number.isFinite(fromDoc) && fromDoc >= 12) return fromDoc;
    try {
      const raw = localStorage.getItem('huellas_editor_format_profiles_v1');
      if (raw) {
        const parsed = JSON.parse(raw);
        if (Number(parsed?.['9:16']?.captionFontSize) >= 12) {
          return Number(parsed['9:16'].captionFontSize);
        }
      }
    } catch {}
    return 21;
  });
  const [captionWordsPerLine16x9, setCaptionWordsPerLine16x9] = useState<number>(() => {
    const fromDoc = Number(activeDoc?.promptConfig?.CAPTION_WORDS_PER_LINE_16X9);
    if (Number.isFinite(fromDoc) && fromDoc >= 0) return fromDoc;
    try {
      const raw = localStorage.getItem('huellas_editor_format_profiles_v1');
      if (raw) {
        const parsed = JSON.parse(raw);
        if (!parsed._v6_16x9_captionOriginalDefault) {
          return 0;
        }
        if (typeof parsed?.['16:9']?.captionWordsPerLine === 'number') {
          return parsed['16:9'].captionWordsPerLine;
        }
      }
    } catch {}
    return 0;
  });
  const [captionWordsPerLine9x16, setCaptionWordsPerLine9x16] = useState<number>(() => {
    const fromDoc = Number(activeDoc?.promptConfig?.CAPTION_WORDS_PER_LINE_9X16);
    if (Number.isFinite(fromDoc) && fromDoc >= 0) return fromDoc;
    try {
      const raw = localStorage.getItem('huellas_editor_format_profiles_v1');
      if (raw) {
        const parsed = JSON.parse(raw);
        if (typeof parsed?.['9:16']?.captionWordsPerLine === 'number') {
          return parsed['9:16'].captionWordsPerLine;
        }
      }
    } catch {}
    return 4;
  });
  const [captionFontSize, setCaptionFontSize] = useState<number>(() =>
    aspectRatio === '9:16' || activeDoc?.productionType === 'REEL_9X16'
      ? Number(initialFormatProfileForRatio?.captionFontSize) ||
        Number(activeDoc?.promptConfig?.CAPTION_FONT_SIZE_9X16) ||
        21
      : Number(initialFormatProfileForRatio?.captionFontSize) ||
        Number(activeDoc?.promptConfig?.CAPTION_FONT_SIZE_16X9) ||
        (initialOverlayStyles.captionFontSizeV25
          ? Number(initialOverlayStyles.captionFontSize) || 25
          : 25)
  );
  const [captionBottomPct, setCaptionBottomPct] = useState<number>(() => {
    const fromDoc =
      aspectRatio === '9:16'
        ? Number(activeDoc?.promptConfig?.CAPTION_BOTTOM_PCT_9X16)
        : Number(activeDoc?.promptConfig?.CAPTION_BOTTOM_PCT_16X9);
    if (Number.isFinite(fromDoc) && fromDoc >= 2 && fromDoc <= 85) {
      return fromDoc;
    }
    if (aspectRatio === '16:9' && !initialOverlayStyles.captionBottom16x9V10) {
      return 10;
    }
    return typeof initialFormatProfileForRatio?.captionBottomPct === 'number'
      ? initialFormatProfileForRatio.captionBottomPct
      : typeof initialOverlayStyles.captionBottomPct === 'number'
      ? initialOverlayStyles.captionBottomPct
      : aspectRatio === '9:16'
      ? 20
      : 10;
  });
  const [captionColor, setCaptionColor] = useState<'white' | 'amber' | 'custom'>(() => {
    const fromDoc = activeDoc?.promptConfig?.CAPTION_COLOR;
    if (fromDoc === 'white' || fromDoc === 'amber' || fromDoc === 'custom') return fromDoc;
    return initialOverlayStyles.captionColor || 'white';
  });
  const [captionCustomColor, setCaptionCustomColor] = useState<string>(
    () => activeDoc?.promptConfig?.CAPTION_CUSTOM_COLOR || initialOverlayStyles.captionCustomColor || '#ffffff'
  );
  const [captionShadowStyle, setCaptionShadowStyle] = useState<OverlayShadowStyle>(() => {
    const fromDoc = activeDoc?.promptConfig?.CAPTION_SHADOW_STYLE;
    if (
      fromDoc === 'none' ||
      fromDoc === 'soft' ||
      fromDoc === 'cinema' ||
      fromDoc === 'outline' ||
      fromDoc === 'gold_glow'
    ) {
      return fromDoc;
    }
    return initialOverlayStyles.captionShadowStyle || 'cinema';
  });
  const [captionBgStyle, setCaptionBgStyle] = useState<OverlayBgStyle>(() => {
    const fromDoc = activeDoc?.promptConfig?.CAPTION_BG_STYLE;
    if (
      fromDoc === 'none' ||
      fromDoc === 'word_shadow' ||
      fromDoc === 'semi' ||
      fromDoc === 'solid' ||
      fromDoc === 'pill'
    ) {
      return fromDoc;
    }
    return initialOverlayStyles.captionBgStyle || 'word_shadow';
  });
  const [captionBgColor, setCaptionBgColor] = useState<string>(
    () => activeDoc?.promptConfig?.CAPTION_BG_COLOR || initialOverlayStyles.captionBgColor || '#000000'
  );
  const [captionBgOpacity, setCaptionBgOpacity] = useState<number>(() => {
    const fromDoc = Number(activeDoc?.promptConfig?.CAPTION_BG_OPACITY);
    if (Number.isFinite(fromDoc) && fromDoc >= 5 && fromDoc <= 100) return fromDoc;
    return initialOverlayStyles.captionBgOpacityV30 &&
      typeof initialOverlayStyles.captionBgOpacity === 'number'
      ? initialOverlayStyles.captionBgOpacity
      : 30;
  });
  const [captionTextCase, setCaptionTextCase] = useState<'original' | 'uppercase' | 'lowercase'>(() => {
    const fromDoc = activeDoc?.promptConfig?.CAPTION_TEXT_CASE;
    if (fromDoc === 'original' || fromDoc === 'uppercase' || fromDoc === 'lowercase') return fromDoc;
    return initialOverlayStyles.captionTextCase === 'uppercase' ||
      initialOverlayStyles.captionTextCase === 'lowercase'
      ? initialOverlayStyles.captionTextCase
      : 'original';
  });

  const formatCaptionTextCase = (text: string): string => {
    let raw = String(text || '');
    if (aspectRatio === '16:9') {
      raw = balanceCaptionsFor16x9(raw);
    }
    if (aspectRatio === '9:16') return raw.toLocaleUpperCase('es-ES');
    if (captionTextCase === 'uppercase') return raw.toLocaleUpperCase('es-ES');
    if (captionTextCase === 'lowercase') return raw.toLocaleLowerCase('es-ES');
    return raw;
  };
  // 9:16: estilo fijo amarillo en mayúsculas con sombra negra y palabra activa en blanco
  const karaokeCaptions = aspectRatio === '9:16';
  const effCaptionColorHex = karaokeCaptions
    ? KARAOKE_9X16_CAPTION.color
    : captionColor === 'amber'
    ? '#fde047'
    : captionColor === 'custom'
    ? captionCustomColor
    : '#ffffff';
  const effCaptionBgStyle: OverlayBgStyle = karaokeCaptions ? KARAOKE_9X16_CAPTION.bgStyle : captionBgStyle;
  const effCaptionShadowStyle: OverlayShadowStyle | 'karaoke' = karaokeCaptions
    ? KARAOKE_9X16_CAPTION.shadowStyle
    : captionShadowStyle;
  const effCaptionFontFamily = karaokeCaptions ? KARAOKE_9X16_CAPTION.fontFamily : captionFontFamily;
  const viewerCaptionSpanRef = useRef<HTMLSpanElement | null>(null);
  // Barras de Tamaño del clip y Encuadre 9:16 encima del visor: cerradas por defecto para dar altura al visor
  const [showFramingBars, setShowFramingBars] = useState<boolean>(() => {
    try {
      return localStorage.getItem('huellas_editor_show_framing_bars') === '1';
    } catch {
      return false;
    }
  });

  // Track whether the user has edited Hook Text or Captions on the active documentary so background effects NEVER reset them
  const userEditedHookDocIdRef = useRef<string>(
    initialDocOverlays?.userEditedHook ? activeDoc?.id || 'default' : ''
  );
  const userEditedCaptionsDocIdRef = useRef<string>(
    initialDocOverlays?.userEditedCaptions ? activeDoc?.id || 'default' : ''
  );
  const [detectedSloganSplitSec, setDetectedSloganSplitSec] = useState<number | null>(null);
  const sidecarAlignmentByStemRef = useRef<Record<string, VoiceAlignmentSidecarV2>>({});
  const activeAlignSourceByDocRef = useRef<
    Record<string, 'vosk-v2' | 'webaudio-v2' | 'video76-srt' | 'manual'>
  >({});
  const latestCaptionProjectionOptsRef = useRef<ProjectAudioCaptionsOptions>({
    introPlacement:
      activeDoc?.promptConfig?.UBICACION_INTRO_MARCA === 'INTRO_POST_SLOGAN'
        ? 'INTRO_POST_SLOGAN'
        : 'INTRO_INICIO_00',
    voiceStartOffsetSec,
    postSloganIntroBounds: null,
    sloganSplitAudioSec: 68.5,
    introDurSec: 8,
  });
  const voiceRmsActivityRef = useRef<{ url: string; frameSec: number; voiced: Uint8Array } | null>(
    null
  );
  const voPlayStartedAtMsRef = useRef<number>(0);
  const voPrepositionedSplitRef = useRef<boolean>(false);
  const lastSyncedDocIdRef = useRef<string>('');
  const lastSyncedIntroPlacementRef = useRef<string>(
    activeDoc?.promptConfig?.UBICACION_INTRO_MARCA === 'INTRO_POST_SLOGAN'
      ? 'INTRO_POST_SLOGAN'
      : 'INTRO_INICIO_00'
  );

  type SavedClipAudioEdit = {
    foleyVolume?: number;
    audioMuted?: boolean;
    customVolumeSet?: boolean;
    audioFadeInSec?: number;
    audioFadeOutSec?: number;
  };
  const clipAudioEditsRef = useRef<Record<string, SavedClipAudioEdit>>({});

  const readSavedClipAudioEdits = (targetDocId?: string): Record<string, SavedClipAudioEdit> => {
    const docId = targetDocId || activeDoc?.id || 'default';
    try {
      const raw = localStorage.getItem(`huellas_clip_audio_edits_${docId}`);
      const parsed = raw ? JSON.parse(raw) : {};
      if (parsed && typeof parsed === 'object') {
        clipAudioEditsRef.current = { ...parsed, ...clipAudioEditsRef.current };
        return clipAudioEditsRef.current;
      }
    } catch {}
    return clipAudioEditsRef.current;
  };

  const recordClipAudioEdit = (
    clip: Pick<
      TimelineClipItem,
      | 'id'
      | 'clipNumber'
      | 'partLabel'
      | 'foleyVolume'
      | 'audioMuted'
      | 'customVolumeSet'
      | 'audioFadeInSec'
      | 'audioFadeOutSec'
    >,
    targetDocId?: string
  ) => {
    const docId = targetDocId || activeDoc?.id || 'default';
    const currentMap = { ...readSavedClipAudioEdits(docId) };
    const entry: SavedClipAudioEdit = {
      foleyVolume: clip.foleyVolume,
      audioMuted: Boolean(clip.audioMuted),
      customVolumeSet: Boolean(clip.customVolumeSet),
      audioFadeInSec: clip.audioFadeInSec,
      audioFadeOutSec: clip.audioFadeOutSec,
    };
    if (clip.id) currentMap[clip.id] = entry;
    currentMap[`num_${clip.clipNumber}_${clip.partLabel || 'full'}`] = entry;
    if (!clip.partLabel) {
      currentMap[`num_${clip.clipNumber}`] = entry;
    }
    clipAudioEditsRef.current = currentMap;
    try {
      localStorage.setItem(`huellas_clip_audio_edits_${docId}`, JSON.stringify(currentMap));
    } catch {}
  };

  const getSavedAudioEditForClip = (
    clip: { id?: string; clipNumber: number; partLabel?: string },
    editsMap: Record<string, SavedClipAudioEdit>
  ): SavedClipAudioEdit | undefined => {
    if (clip.id && editsMap[clip.id]) return editsMap[clip.id];
    const partKey = `num_${clip.clipNumber}_${clip.partLabel || 'full'}`;
    if (editsMap[partKey]) return editsMap[partKey];
    if (!clip.partLabel && editsMap[`num_${clip.clipNumber}`]) {
      return editsMap[`num_${clip.clipNumber}`];
    }
    return undefined;
  };

  const stripHeavyDataUrlsFromClips = (clips?: TimelineClipItem[]): TimelineClipItem[] | undefined => {
    if (!Array.isArray(clips)) return clips;
    return clips.map((c) => ({
      ...c,
      posterUrl:
        c.posterUrl && c.posterUrl.startsWith('data:')
          ? ''
          : stripEphemeralMediaBridgeOrigin(c.posterUrl),
      videoUrl:
        c.videoUrl && c.videoUrl.startsWith('data:')
          ? ''
          : stripEphemeralMediaBridgeOrigin(c.videoUrl),
      ...(c.originalVideoUrlBeforeSeparation
        ? {
            originalVideoUrlBeforeSeparation: stripEphemeralMediaBridgeOrigin(
              c.originalVideoUrlBeforeSeparation
            ),
          }
        : {}),
      ...(c.opticalFlowUrl
        ? { opticalFlowUrl: stripEphemeralMediaBridgeOrigin(c.opticalFlowUrl) }
        : {}),
      ...(c.originalOpticalFlowUrlBeforeSeparation
        ? {
            originalOpticalFlowUrlBeforeSeparation: stripEphemeralMediaBridgeOrigin(
              c.originalOpticalFlowUrlBeforeSeparation
            ),
          }
        : {}),
    }));
  };

  const persistDocOverlaysPatch = (patch: Record<string, any>, targetDocId?: string) => {
    const docKey = `huellas_editor_doc_overlays_${targetDocId || activeDoc?.id || 'default'}`;
    try {
      const existingRaw = localStorage.getItem(docKey);
      const existing = existingRaw ? JSON.parse(existingRaw) : {};
      const nextPayload: Record<string, any> = {
        ...existing,
        ...patch,
        updatedAt: Date.now(),
      };
      if ('customTimelineClips' in patch && Array.isArray(nextPayload.customTimelineClips)) {
        // Never save one documentary's timeline under another documentary's settings
        const persistTargetId = targetDocId || activeDoc?.id;
        const persistTargetDoc =
          activeDoc?.id === persistTargetId
            ? activeDoc
            : documentaries.find((d) => d.id === persistTargetId) || null;
        const foreignMediaCount = (nextPayload.customTimelineClips as TimelineClipItem[]).filter(
          (c) =>
            isMediaUrlFromOtherDocumentary(c?.videoUrl, persistTargetDoc) ||
            isMediaUrlFromOtherDocumentary(c?.posterUrl, persistTargetDoc)
        ).length;
        if (foreignMediaCount > 0) {
          console.warn(
            `[DocGuard] Skipped saving a timeline with ${foreignMediaCount} clip(s) from another documentary into ${persistTargetId}`
          );
          if ('customTimelineClips' in existing) nextPayload.customTimelineClips = existing.customTimelineClips;
          else delete nextPayload.customTimelineClips;
          if (!('userEditedClips' in existing)) delete nextPayload.userEditedClips;
          else nextPayload.userEditedClips = existing.userEditedClips;
        }
      }
      if ('customTimelineClips' in nextPayload && Array.isArray(nextPayload.customTimelineClips)) {
        nextPayload.customTimelineClips = stripHeavyDataUrlsFromClips(
          nextPayload.customTimelineClips
        );
      }
      if (
        'parkedTimelineClipsByNumber' in patch &&
        nextPayload.parkedTimelineClipsByNumber &&
        typeof nextPayload.parkedTimelineClipsByNumber === 'object'
      ) {
        const cleanedParked: Record<string, TimelineClipItem[]> = {};
        for (const [k, arr] of Object.entries(nextPayload.parkedTimelineClipsByNumber)) {
          if (Array.isArray(arr) && arr.length > 0) {
            cleanedParked[k] = stripHeavyDataUrlsFromClips(arr as TimelineClipItem[]);
          }
        }
        nextPayload.parkedTimelineClipsByNumber = cleanedParked;
      }
      localStorage.setItem(docKey, JSON.stringify(nextPayload));
    } catch {}
  };

  // 16:9 safety net: captions built or cached without the anti-orphan rule (e.g. while another
  // format was active) are repaired here, so no line is ever left with a single word.
  useEffect(() => {
    if (aspectRatio !== '16:9' || captions.length < 2) return;
    const orphanDocId = activeDoc?.id || 'default';
    if (userEditedCaptionsDocIdRef.current === orphanDocId) return;
    const repaired = mergeOrphanSingleWordCaptions(captions);
    if (repaired === captions) return;
    setCaptions(repaired);
    persistDocOverlaysPatch({ captions: repaired }, orphanDocId);
  }, [captions, aspectRatio, activeDoc?.id]);

  // Real-time persistence for all Hook Text, Captions, and Logo styles/positions/animations
  useEffect(() => {
    try {
      localStorage.setItem(
        'huellas_editor_overlay_styles_v1',
        JSON.stringify({
          logoScalePct,
          logoOpacity,
          logoPosX,
          logoPosY,
          logoDefault16x9V4: true,
          logoAnimIn,
          logoAnimInDur,
          logoAnimInFadeV1: true,
          logoAnimOut,
          logoAnimOutDur,
          hookFontFamily,
          hookLine1FontSize,
          hookLine2FontSize,
          hookLine1Color,
          hookLine2Color,
          hookShadowStyle,
          hookBgStyle,
          hookBgColor,
          hookBgOpacity,
          hookLeftPct,
          hookTopPct,
          hookBoxWidthPct,
          hookLine1StartSec,
          hookLine1AnimIn,
          hookLine1AnimInDur,
          hookLine1AnimOut,
          hookLine1AnimOutDur,
          hookLine2StartSec,
          hookLine2AnimIn,
          hookLine2AnimInDur,
          hookLine2AnimOut,
          hookLine2AnimOutDur,
          clip1OverlayEndSec,
          captionFontFamily,
          captionFontSize,
          captionFontSize16x9,
          captionFontSize9x16,
          captionWordsPerLine16x9,
          captionWordsPerLine9x16,
          captionMaxChars,
          captionLineMode,
          captionOriginal16x9V1: true,
          captionFontSizeV25: true,
          captionBottomPct,
          captionBottom16x9V10: true,
          captionColor,
          captionCustomColor,
          captionShadowStyle,
          captionBgStyle,
          captionBgColor,
          captionBgOpacity,
          captionBgOpacityV30: true,
          captionTextCase,
          captionAnimIn,
          captionAnimOut,
          captionAnimDur,
        })
      );
      persistDocOverlaysPatch({
        hookLine1StartSec,
        hookLine1AnimIn,
        hookLine1AnimInDur,
        hookLine1AnimOut,
        hookLine1AnimOutDur,
        hookLine2StartSec,
        hookLine2AnimIn,
        hookLine2AnimInDur,
        hookLine2AnimOut,
        hookLine2AnimOutDur,
        clip1OverlayEndSec,
      });
    } catch {}
  }, [
    logoScalePct,
    logoOpacity,
    logoPosX,
    logoPosY,
    logoAnimIn,
    logoAnimInDur,
    logoAnimOut,
    logoAnimOutDur,
    hookFontFamily,
    hookLine1FontSize,
    hookLine2FontSize,
    hookLine1Color,
    hookLine2Color,
    hookShadowStyle,
    hookBgStyle,
    hookBgColor,
    hookBgOpacity,
    hookLeftPct,
    hookTopPct,
    hookBoxWidthPct,
    hookLine1StartSec,
    hookLine1AnimIn,
    hookLine1AnimInDur,
    hookLine1AnimOut,
    hookLine1AnimOutDur,
    hookLine2StartSec,
    hookLine2AnimIn,
    hookLine2AnimInDur,
    hookLine2AnimOut,
    hookLine2AnimOutDur,
    clip1OverlayEndSec,
    captionFontFamily,
    captionFontSize,
    captionFontSize16x9,
    captionFontSize9x16,
    captionWordsPerLine16x9,
    captionWordsPerLine9x16,
    captionMaxChars,
    captionLineMode,
    captionBottomPct,
    captionColor,
    captionCustomColor,
    captionShadowStyle,
    captionBgStyle,
    captionBgColor,
    captionBgOpacity,
    captionTextCase,
    captionAnimIn,
    captionAnimOut,
    captionAnimDur,
  ]);

  // ============================================================================
  // DUAL-FORMAT (16:9 ⇄ 9:16) PERSISTENT OVERLAY PROFILES & SMART AUTO-REFRAME
  // ============================================================================
  interface FormatOverlayProfile {
    exportResolution: ExportResolutionPreset;
    logoScalePct: number;
    logoOpacity?: number;
    logoPosX: number;
    logoPosY: number;
    hookLine1FontSize: number;
    hookLine2FontSize: number;
    hookLeftPct: number;
    hookTopPct: number;
    hookBoxWidthPct: number;
    captionFontSize: number;
    captionWordsPerLine?: number;
    captionBottomPct: number;
    captionLineMode?: 'subdivide' | 'wrap' | 'original';
    captionMaxChars?: number;
  }

  const formatProfilesRef = useRef<Record<'16:9' | '9:16', FormatOverlayProfile>>((() => {
    const default16x9: FormatOverlayProfile = {
      exportResolution: '8K_4320P',
      logoScalePct: 5,
      logoOpacity: 95,
      logoPosX: 3,
      logoPosY: 3,
      hookLine1FontSize: 15,
      hookLine2FontSize: 24,
      hookLeftPct: 50,
      hookTopPct: 50,
      hookBoxWidthPct: 82,
      captionFontSize: 25,
      captionWordsPerLine: 0,
      captionBottomPct: 10,
      captionLineMode: 'original',
      captionMaxChars: 32,
    };
    const default9x16: FormatOverlayProfile = {
      exportResolution: '2K_1440P',
      logoScalePct: 12,
      logoOpacity: 95,
      logoPosX: 10,
      logoPosY: 3,
      hookLine1FontSize: 13,
      hookLine2FontSize: 20,
      hookLeftPct: 50,
      hookTopPct: 48,
      hookBoxWidthPct: 88,
      captionFontSize: 21,
      captionWordsPerLine: 3,
      captionBottomPct: 20,
      captionLineMode: 'subdivide',
      captionMaxChars: 16,
    };
    try {
      const raw = localStorage.getItem('huellas_editor_format_profiles_v1');
      if (raw) {
        const parsed = JSON.parse(raw);
        const saved16x9 = parsed['16:9'] || {};
        const saved9x16 = parsed['9:16'] || {};
        if (!parsed._v2_9x16_logoPosX10 && (saved9x16.logoPosX === 4 || saved9x16.logoPosX === 3)) {
          saved9x16.logoPosX = 10;
        }
        if (!parsed._v3_res_by_ratio) {
          saved16x9.exportResolution = '8K_4320P';
          saved9x16.exportResolution = '2K_1440P';
        }
        if (!parsed._v4_16x9_logoDefault5) {
          saved16x9.logoScalePct = 5;
          saved16x9.logoOpacity = 95;
          saved16x9.logoPosX = 3;
          saved16x9.logoPosY = 3;
        }
        if (!parsed._v5_16x9_captionBottom10) {
          saved16x9.captionBottomPct = 10;
        }
        if (!parsed._v6_16x9_captionOriginalDefault) {
          saved16x9.captionLineMode = 'original';
          saved16x9.captionWordsPerLine = 0;
        }
        if (!parsed._v7_9x16_captions22) {
          saved9x16.captionLineMode = 'subdivide';
          saved9x16.captionWordsPerLine = 3;
        }
        if (!parsed._v8_9x16_captions16_bottom25) {
          saved9x16.captionMaxChars = 16;
          saved9x16.captionBottomPct = 25;
        }
        if (!parsed._v9_9x16_logo_x10_y3) {
          saved9x16.logoPosX = 10;
          saved9x16.logoPosY = 3;
        }
        if (!parsed._v10_9x16_captionBottom20) {
          saved9x16.captionBottomPct = 20;
        }
        return {
          '16:9': { ...default16x9, ...saved16x9 },
          '9:16': { ...default9x16, ...saved9x16 },
        };
      }
    } catch {}
    return { '16:9': default16x9, '9:16': default9x16 };
  })());

  // Keep current aspectRatio's profile updated in real time whenever overlay sliders or exportResolution change
  useEffect(() => {
    formatProfilesRef.current['16:9'] = {
      ...formatProfilesRef.current['16:9'],
      ...(aspectRatio === '16:9'
        ? {
            exportResolution,
            logoScalePct,
            logoOpacity,
            logoPosX,
            logoPosY,
            hookLine1FontSize,
            hookLine2FontSize,
            hookLeftPct,
            hookTopPct,
            hookBoxWidthPct,
            captionBottomPct,
            captionLineMode,
            captionMaxChars,
          }
        : {}),
      captionFontSize: captionFontSize16x9,
      captionWordsPerLine: captionWordsPerLine16x9,
    };
    formatProfilesRef.current['9:16'] = {
      ...formatProfilesRef.current['9:16'],
      ...(aspectRatio === '9:16'
        ? {
            exportResolution,
            logoScalePct,
            logoOpacity,
            logoPosX,
            logoPosY,
            hookLine1FontSize,
            hookLine2FontSize,
            hookLeftPct,
            hookTopPct,
            hookBoxWidthPct,
            captionBottomPct,
            captionLineMode,
            captionMaxChars,
          }
        : {}),
      captionFontSize: captionFontSize9x16,
      captionWordsPerLine: captionWordsPerLine9x16,
    };
    try {
      localStorage.setItem(
        'huellas_editor_format_profiles_v1',
        JSON.stringify({
          ...formatProfilesRef.current,
          _v2_9x16_logoPosX10: true,
          _v3_res_by_ratio: true,
          _v4_16x9_logoDefault5: true,
          _v5_16x9_captionBottom10: true,
          _v6_16x9_captionOriginalDefault: true,
          _v7_9x16_captions22: true,
          _v8_9x16_captions16_bottom25: true,
          _v9_9x16_logo_x10_y3: true,
          _v10_9x16_captionBottom20: true,
        })
      );
      const serverOrigin = getEditorPrimaryServerOrigin();
      fetch(`${serverOrigin}/api/editor/sync-client-state`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          docId: activeDoc?.id,
          aspectRatio,
          exportResolution,
          exportFps,
          formatProfiles: {
            ...formatProfilesRef.current,
            _v4_16x9_logoDefault5: true,
          },
          clipAudioEdits: readSavedClipAudioEdits(activeDoc?.id),
          timelineClips: timelineClips.map((c) => ({
            id: c.id,
            clipNumber: c.clipNumber,
            duration: c.duration,
            trimStart: c.trimStart,
            trimEnd: c.trimEnd,
            speed: c.speed,
            smoothSlowMo: c.smoothSlowMo,
            foleyVolume: c.foleyVolume,
            customVolumeSet: c.customVolumeSet,
            audioMuted: c.audioMuted,
            reframe9x16Mode: c.reframe9x16Mode,
            reframeFocusXStart: c.reframeFocusXStart,
            reframeFocusXEnd: c.reframeFocusXEnd,
            reframeFocusY: c.reframeFocusY,
            userReframed9x16: c.userReframed9x16,
          })),
        }),
      }).catch(() => {});
    } catch {}
  }, [
    activeDoc?.id,
    aspectRatio,
    exportResolution,
    exportFps,
    logoScalePct,
    logoOpacity,
    logoPosX,
    logoPosY,
    hookLine1FontSize,
    hookLine2FontSize,
    hookLeftPct,
    hookTopPct,
    hookBoxWidthPct,
    captionFontSize,
    captionFontSize16x9,
    captionFontSize9x16,
    captionWordsPerLine16x9,
    captionWordsPerLine9x16,
    captionBottomPct,
    timelineClips,
  ]);

  const [isAnalyzingReframe9x16, setIsAnalyzingReframe9x16] = useState<boolean>(false);

  // Editor notifications auto-hide after 10 s. Messages shown while a long job is running
  // (export render / 9:16 reframe analysis) stay visible until the job ends.
  // Every notice stays 30 s in a stack (a failed export stays until it is closed)
  const editorNotices = useNoticeStack(statusMessage, 30000, {
    isSticky: (t) => t.startsWith('⚠️ Error en renderizado'),
  });
  useEffect(() => {
    if (!statusMessage || isRenderingVideo || isAnalyzingReframe9x16) return;
    // A failed export must stay on screen until the user closes it.
    if (statusMessage.startsWith('⚠️ Error en renderizado')) return;
    const hideTimer = window.setTimeout(() => setStatusMessage(''), 10000);
    return () => window.clearTimeout(hideTimer);
  }, [statusMessage, isRenderingVideo, isAnalyzingReframe9x16]);
  const [reframeSummary9x16, setReframeSummary9x16] = useState<string>(
    () =>
      initialDocStateForInit?.reframeSummary9x16 ||
      initialSessionState?.reframeSummary9x16 ||
      ''
  );
  const autoReframedDocIdsRef = useRef<Set<string>>(new Set());
  const [exportedMasterVideos, setExportedMasterVideos] = useState<{
    '16:9': { fileName: string; filePath: string; sizeMB: string; updatedAt: string } | null;
    '9:16': { fileName: string; filePath: string; sizeMB: string; updatedAt: string } | null;
  }>({ '16:9': null, '9:16': null });

  const refreshExportedMasterVideos = async () => {
    const fPath = (
      downloadFolderPath ||
      activeDoc?.downloadFolderPath ||
      downloadFolderName ||
      activeDoc?.downloadFolderName ||
      activeDoc?.title ||
      ''
    ).trim();
    if (!fPath) return;
    const serverOrigin = getEditorPrimaryServerOrigin();
    try {
      const r = await fetch(
        `${serverOrigin}/api/editor/exported-videos?folderPath=${encodeURIComponent(fPath)}`
      );
      if (!r.ok) return;
      const data = await r.json();
      if (data && data.videos) {
        setExportedMasterVideos({
          '16:9': data.videos['16:9'] || null,
          '9:16': data.videos['9:16'] || null,
        });
      }
    } catch {}
  };

  useEffect(() => {
    refreshExportedMasterVideos();
  }, [
    activeDoc?.id,
    activeDoc?.title,
    downloadFolderPath,
    downloadFolderName,
    lastExportedOutputPath,
    isRenderingVideo,
  ]);

  const handleRunSmartAutoReframe9x16 = async (forceRefresh = false) => {
    if (isAnalyzingReframe9x16) return;
    const fPath = (
      downloadFolderPath ||
      activeDoc?.downloadFolderPath ||
      downloadFolderName ||
      activeDoc?.downloadFolderName ||
      activeDoc?.title ||
      ''
    ).trim();
    if (!fPath) {
      setStatusMessage('⚠️ Selecciona o conecta primero la carpeta del documental para analizar Auto-Reframe 9:16.');
      return;
    }
    setIsAnalyzingReframe9x16(true);
    setStatusMessage('🤖 Analizando cada clip en 05_Clips_Video (rostros, luz, nitidez y movimiento) para Auto-Reframe 9:16...');
    // The analysis belongs to the documentary open right now; it takes seconds and the user may switch meanwhile.
    const runDocId = activeDoc?.id || '';
    const runDocKey = activeDoc?.id || activeDoc?.title || 'default';

    const serverOrigin = getEditorPrimaryServerOrigin();

    try {
      const resp = await fetch(`${serverOrigin}/api/editor/auto-reframe-9x16`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          folderPath: fPath,
          forceRefresh,
        }),
      });
      const data = await resp.json();
      if (!resp.ok || !data?.ok || !Array.isArray(data.results)) {
        throw new Error(data?.error || 'No se pudo completar el análisis Auto-Reframe 9:16.');
      }
      if (runDocId !== liveActiveDocIdRef.current) {
        // Another documentary is open now: these results are not for it. Let the analysis run again later.
        autoReframedDocIdsRef.current.delete(runDocKey);
        setStatusMessage('');
        return;
      }

      const resultByClipNum = new Map<
        number,
        {
          reframe9x16Mode: 'auto_center' | 'auto_focus' | 'auto_pan';
          focusXStart: number;
          focusXEnd: number;
          focusY: number;
          confidence: number;
          reason: string;
        }
      >();
      let countCenter = 0;
      let countFocus = 0;
      let countPan = 0;
      for (const item of data.results) {
        const cNum = Number(item.clipNumber);
        if (!Number.isFinite(cNum) || cNum <= 0) continue;
        // Clip file not readable (only in iCloud): its result is a placeholder, never apply it
        if (item.unreadable) continue;
        resultByClipNum.set(cNum, item);
        if (item.reframe9x16Mode === 'auto_pan') countPan++;
        else if (item.reframe9x16Mode === 'auto_focus') countFocus++;
        else countCenter++;
      }

      if (resultByClipNum.size === 0) {
        autoReframedDocIdsRef.current.delete(runDocKey);
        setStatusMessage(
          '⚠️ Auto-Reframe 9:16: no se pudo leer ningún clip (¿archivos solo en iCloud?). No se cambió ningún encuadre.'
        );
        return;
      }

      const docId = activeDoc?.id || 'default';
      setTimelineClips((prev) => {
        const updated = prev.map((tc) => {
          const res = resultByClipNum.get(tc.clipNumber);
          if (!res) return tc;
          // NEVER overwrite a clip that was manually reframed by the user!
          if (tc.userReframed9x16 || tc.reframe9x16Mode === 'manual') return tc;
          return {
            ...tc,
            reframe9x16Mode: res.reframe9x16Mode,
            reframeFocusXStart: res.focusXStart,
            reframeFocusXEnd: res.focusXEnd,
            reframeFocusY: res.focusY ?? 50,
            reframeConfidence: res.confidence,
            reframeReason: res.reason,
          };
        });
        const summaryTxt = `🎯 IA 9:16: ${countFocus} Foco Lateral • ${countPan} Paneo Dinámico • ${countCenter} Centro`;
        persistDocOverlaysPatch(
          { customTimelineClips: updated, userEditedClips: true, reframeSummary9x16: summaryTxt },
          docId
        );
        return updated;
      });

      if (activeDoc && Array.isArray(activeDoc.clips) && activeDoc.clips.length > 0) {
        updateActiveDoc({
          clips: activeDoc.clips.map((c) => {
            const res = resultByClipNum.get(c.clipNumber);
            if (!res) return c;
            if ((c as any).userReframed9x16 || c.reframe9x16Mode === 'manual') return c;
            return {
              ...c,
              reframe9x16Mode: res.reframe9x16Mode,
              reframeFocusXStart: res.focusXStart,
              reframeFocusXEnd: res.focusXEnd,
              reframeFocusY: res.focusY ?? 50,
              reframeConfidence: res.confidence,
              reframeReason: res.reason,
            };
          }),
        });
      }

      const summaryTxt = `🎯 IA 9:16: ${countFocus} Foco Lateral • ${countPan} Paneo Dinámico • ${countCenter} Centro`;
      setReframeSummary9x16(summaryTxt);
      setStatusMessage(
        `✅ Auto-Reframe 9:16 completado en ${data.results.length} clips (${countFocus} con enfoque lateral de sujeto, ${countPan} con paneo dinámico y ${countCenter} centrados).`
      );
    } catch (err: any) {
      setStatusMessage(`⚠️ Auto-Reframe 9:16: ${err?.message || 'Error al analizar clips.'}`);
    } finally {
      setIsAnalyzingReframe9x16(false);
    }
  };

  const isAutoReframe9x16Activated =
    Boolean(reframeSummary9x16) ||
    timelineClips.some(
      (c) =>
        c.clipNumber > 0 &&
        c.clipNumber !== 999 &&
        Boolean(c.reframe9x16Mode || c.reframeReason)
    ) ||
    Boolean(activeDoc?.clips?.some((c) => Boolean(c.reframe9x16Mode || c.reframeReason)));

  const handleUpdateClipReframe9x16 = (
    clipId: string,
    patch: {
      reframe9x16Mode?: 'auto_center' | 'auto_focus' | 'auto_pan' | 'manual' | 'fit_blur';
      reframeFocusXStart?: number;
      reframeFocusXEnd?: number;
      reframeFocusY?: number;
      reframeReason?: string;
    }
  ) => {
    const docId = activeDoc?.id || 'default';
    const matchedClip = timelineClips.find((tc) => tc.id === clipId);
    const targetClipNum = matchedClip ? matchedClip.clipNumber : -1;
    const lockedPatch = {
      ...patch,
      userReframed9x16: true,
      reframeUpdatedAt: Date.now(),
    };
    setTimelineClips((prev) => {
      const updated = prev.map((tc) => {
        if (tc.id !== clipId) return tc;
        return {
          ...tc,
          ...lockedPatch,
        };
      });
      persistDocOverlaysPatch({ customTimelineClips: updated, userEditedClips: true }, docId);
      return updated;
    });
    if (targetClipNum > 0 && activeDoc && Array.isArray(activeDoc.clips)) {
      updateActiveDoc({
        clips: activeDoc.clips.map((c) =>
          c.clipNumber === targetClipNum ? ({ ...c, ...lockedPatch } as any) : c
        ),
      });
    }
    if (targetClipNum > 0) {
      try {
        const serverOrigin = getEditorPrimaryServerOrigin();
        const folderPath = (downloadFolderPath || activeDoc?.downloadFolderPath || '').trim();
        const folderName = (downloadFolderName || activeDoc?.downloadFolderName || '').trim();
        const docTitle = (activeDoc?.title || '').trim();
        fetch(`${serverOrigin}/api/editor/update-clip-reframe-9x16`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            folderPath,
            folderName,
            docTitle,
            clipNumber: targetClipNum,
            reframe9x16Mode: lockedPatch.reframe9x16Mode ?? matchedClip?.reframe9x16Mode ?? 'manual',
            focusXStart: lockedPatch.reframeFocusXStart ?? matchedClip?.reframeFocusXStart ?? 50,
            focusXEnd:
              lockedPatch.reframeFocusXEnd ??
              lockedPatch.reframeFocusXStart ??
              matchedClip?.reframeFocusXEnd ??
              matchedClip?.reframeFocusXStart ??
              50,
            focusY: lockedPatch.reframeFocusY ?? matchedClip?.reframeFocusY ?? 50,
            reason: lockedPatch.reframeReason ?? matchedClip?.reframeReason ?? 'Ajuste manual usuario',
            userReframed9x16: true,
          }),
        }).catch(() => {});
      } catch {}
    }
  };

  // Clip size inside the frame (per format). `commit: false` only updates the live preview while dragging the
  // slider; `commit: true` (on release / buttons) also saves it to the timeline overlays and the documentary.
  const handleUpdateClipFrameZoom = (clipId: string, zoomPct: number, commit: boolean) =>
    handleUpdateClipFrameTransform(clipId, { zoomPct }, commit);

  // Seconds into the clip at the playhead (0 when the playhead is outside the clip)
  const getClipElapsedAtPlayhead = (clip: TimelineClipItem) => {
    const bounded = clipsWithTimelineBounds.find((c) => c.id === clip.id);
    const clipStart = bounded ? bounded.start : currentTime;
    return Math.max(0, Math.min(Math.max(0, clip.duration), Math.round((currentTime - clipStart) * 100) / 100));
  };
  const FRAME_KEY_SNAP_SEC = 0.15;

  // Saves a patch of framing fields for one clip (timeline copy in this browser + the documentary)
  const saveClipFramePatch = (clip: TimelineClipItem, patch: Record<string, any>, commit: boolean) => {
    const docId = activeDoc?.id || 'default';
    const fullPatch = commit ? { ...patch, frameTransformAt: Date.now() } : patch;
    setTimelineClips((prev) => {
      const updated = prev.map((tc) => (tc.id === clip.id ? { ...tc, ...fullPatch } : tc));
      if (commit) {
        persistDocOverlaysPatch({ customTimelineClips: updated, userEditedClips: true }, docId);
      }
      return updated;
    });
    if (commit && clip.clipNumber > 0 && clip.clipNumber < 999 && activeDoc && Array.isArray(activeDoc.clips)) {
      updateActiveDoc({
        clips: activeDoc.clips.map((c) => (c.clipNumber === clip.clipNumber ? ({ ...c, ...fullPatch } as any) : c)),
      });
    }
  };

  // Clip size and position inside the frame, set with the slider, by dragging the clip or its corner handles.
  // `commit: false` only updates the live preview while dragging; `commit: true` (on release) also saves.
  // A clip without framing points keeps one fixed framing. A clip with points gets the change written to the
  // point at the playhead (a new point is created there if none is close).
  const handleUpdateClipFrameTransform = (
    clipId: string,
    next: { zoomPct?: number; offsetX?: number; offsetY?: number },
    commit: boolean
  ) => {
    const is916 = aspectRatio === '9:16';
    const matchedClip = timelineClips.find((tc) => tc.id === clipId);
    if (!matchedClip) return;
    const elapsed = getClipElapsedAtPlayhead(matchedClip);
    const current = getClipFrameAt(matchedClip, aspectRatio, elapsed);
    const zoomPct = Math.max(
      FRAME_ZOOM_MIN_PCT,
      Math.min(FRAME_ZOOM_MAX_PCT, Math.round(typeof next.zoomPct === 'number' ? next.zoomPct : current.z))
    );
    // Keep at least a strip of the clip inside the frame so it can always be grabbed again
    const maxOffset = 50 + zoomPct / 2 - 6;
    const lim = (v: number) => Math.max(-maxOffset, Math.min(maxOffset, Math.round(v * 10) / 10));
    const x = lim(typeof next.offsetX === 'number' ? next.offsetX : current.x);
    const y = lim(typeof next.offsetY === 'number' ? next.offsetY : current.y);
    const keys = getClipFrameKeys(matchedClip, aspectRatio);
    if (keys.length > 0) {
      const nearIdx = keys.findIndex((k) => Math.abs(k.t - elapsed) <= FRAME_KEY_SNAP_SEC);
      const nextKeys =
        nearIdx >= 0
          ? keys.map((k, i) => (i === nearIdx ? { ...k, z: zoomPct, x, y } : k))
          : [...keys, { t: elapsed, z: zoomPct, x, y }].sort((a, b) => a.t - b.t).slice(0, MAX_CLIP_FRAME_KEYS);
      saveClipFramePatch(
        matchedClip,
        is916 ? { frameKeys9x16: nextKeys, frameZoomInSec9x16: 0 } : { frameKeys16x9: nextKeys, frameZoomInSec16x9: 0 },
        commit
      );
      return;
    }
    saveClipFramePatch(
      matchedClip,
      {
        [is916 ? 'frameZoom9x16' : 'frameZoom16x9']: zoomPct,
        [is916 ? 'frameOffsetX9x16' : 'frameOffsetX16x9']: x,
        [is916 ? 'frameOffsetY9x16' : 'frameOffsetY16x9']: y,
      },
      commit
    );
  };
  // Fixes a framing point at the playhead with the framing currently shown
  const handleAddClipFrameKey = (clip: TimelineClipItem) => {
    const elapsed = getClipElapsedAtPlayhead(clip);
    const cur = getClipFrameAt(clip, aspectRatio, elapsed);
    const keys = getClipFrameKeys(clip, aspectRatio);
    const point = { t: elapsed, z: Math.round(cur.z), x: Math.round(cur.x * 10) / 10, y: Math.round(cur.y * 10) / 10 };
    const nearIdx = keys.findIndex((k) => Math.abs(k.t - elapsed) <= FRAME_KEY_SNAP_SEC);
    const nextKeys =
      nearIdx >= 0
        ? keys.map((k, i) => (i === nearIdx ? point : k))
        : [...keys, point].sort((a, b) => a.t - b.t).slice(0, MAX_CLIP_FRAME_KEYS);
    saveClipFramePatch(
      clip,
      aspectRatio === '9:16'
        ? { frameKeys9x16: nextKeys, frameZoomInSec9x16: 0 }
        : { frameKeys16x9: nextKeys, frameZoomInSec16x9: 0 },
      true
    );
  };
  // Removes one framing point; removing the last one leaves the clip fixed at that point's framing
  const handleRemoveClipFrameKey = (clip: TimelineClipItem, keyIndex: number) => {
    const keys = getClipFrameKeys(clip, aspectRatio);
    const removed = keys[keyIndex];
    if (!removed) return;
    const nextKeys = keys.filter((_, i) => i !== keyIndex);
    saveClipFramePatch(
      clip,
      aspectRatio === '9:16'
        ? nextKeys.length > 0
          ? { frameKeys9x16: nextKeys, frameZoomInSec9x16: 0 }
          : {
              frameKeys9x16: [],
              frameZoomInSec9x16: 0,
              frameZoom9x16: Math.round(removed.z),
              frameOffsetX9x16: removed.x,
              frameOffsetY9x16: removed.y,
            }
        : nextKeys.length > 0
        ? { frameKeys16x9: nextKeys, frameZoomInSec16x9: 0 }
        : {
            frameKeys16x9: [],
            frameZoomInSec16x9: 0,
            frameZoom16x9: Math.round(removed.z),
            frameOffsetX16x9: removed.x,
            frameOffsetY16x9: removed.y,
          },
      true
    );
  };
  // Back to normal size, centred, with no framing points
  const handleResetClipFrame = (clip: TimelineClipItem) => {
    const is916 = aspectRatio === '9:16';
    saveClipFramePatch(
      clip,
      {
        [is916 ? 'frameZoom9x16' : 'frameZoom16x9']: 100,
        [is916 ? 'frameOffsetX9x16' : 'frameOffsetX16x9']: 0,
        [is916 ? 'frameOffsetY9x16' : 'frameOffsetY16x9']: 0,
        ...(is916 ? { frameKeys9x16: [], frameZoomInSec9x16: 0 } : { frameKeys16x9: [], frameZoomInSec16x9: 0 }),
      },
      true
    );
  };
  const clipTransformDragRef = useRef<{
    mode: 'move' | 'resize';
    clipId: string;
    startX: number;
    startY: number;
    startZoom: number;
    startOffX: number;
    startOffY: number;
    centerX: number;
    centerY: number;
    startDist: number;
    last: { zoomPct?: number; offsetX?: number; offsetY?: number };
  } | null>(null);
  const beginClipTransformDrag = (
    e: React.PointerEvent<HTMLElement>,
    mode: 'move' | 'resize',
    clip: TimelineClipItem,
    boxCenterPct: { x: number; y: number }
  ) => {
    const canvasEl = viewerCanvasRef.current;
    if (!canvasEl) return;
    e.preventDefault();
    e.stopPropagation();
    const rect = canvasEl.getBoundingClientRect();
    const centerX = rect.left + (rect.width * boxCenterPct.x) / 100;
    const centerY = rect.top + (rect.height * boxCenterPct.y) / 100;
    const frameNow = getClipFrameAt(clip, aspectRatio, getClipElapsedAtPlayhead(clip));
    const off = { x: frameNow.x, y: frameNow.y };
    clipTransformDragRef.current = {
      mode,
      clipId: clip.id,
      startX: e.clientX,
      startY: e.clientY,
      startZoom: frameNow.z,
      startOffX: off.x,
      startOffY: off.y,
      centerX,
      centerY,
      startDist: Math.max(8, Math.hypot(e.clientX - centerX, e.clientY - centerY)),
      last: {},
    };
    setIsClipTransformDragging(true);
    try {
      e.currentTarget.setPointerCapture(e.pointerId);
    } catch {}
  };
  const moveClipTransformDrag = (e: React.PointerEvent<HTMLElement>) => {
    const drag = clipTransformDragRef.current;
    const canvasEl = viewerCanvasRef.current;
    if (!drag || !canvasEl) return;
    e.preventDefault();
    e.stopPropagation();
    const rect = canvasEl.getBoundingClientRect();
    if (drag.mode === 'move') {
      drag.last = {
        offsetX: drag.startOffX + ((e.clientX - drag.startX) / Math.max(1, rect.width)) * 100,
        offsetY: drag.startOffY + ((e.clientY - drag.startY) / Math.max(1, rect.height)) * 100,
      };
    } else {
      const dist = Math.hypot(e.clientX - drag.centerX, e.clientY - drag.centerY);
      drag.last = { zoomPct: drag.startZoom * (dist / drag.startDist) };
    }
    handleUpdateClipFrameTransform(drag.clipId, drag.last, false);
  };
  const endClipTransformDrag = (e: React.PointerEvent<HTMLElement>) => {
    const drag = clipTransformDragRef.current;
    if (!drag) return;
    e.preventDefault();
    e.stopPropagation();
    clipTransformDragRef.current = null;
    setIsClipTransformDragging(false);
    try {
      e.currentTarget.releasePointerCapture(e.pointerId);
    } catch {}
    // A plain click (no movement) changes nothing and must not save anything
    if (Object.keys(drag.last).length === 0) return;
    handleUpdateClipFrameTransform(drag.clipId, drag.last, true);
  };

  const handleSwitchAspectRatio = (nextRatio: EditorAspectRatio) => {
    if (nextRatio === aspectRatio) return;
    // Save current format's overlay and quality settings
    formatProfilesRef.current[aspectRatio] = {
      exportResolution,
      logoScalePct,
      logoOpacity,
      logoPosX,
      logoPosY,
      hookLine1FontSize,
      hookLine2FontSize,
      hookLeftPct,
      hookTopPct,
      hookBoxWidthPct,
      captionFontSize: aspectRatio === '9:16' ? captionFontSize9x16 : captionFontSize16x9,
      captionWordsPerLine: aspectRatio === '9:16' ? captionWordsPerLine9x16 : captionWordsPerLine16x9,
      captionBottomPct,
      captionLineMode,
      captionMaxChars,
    };
    if (activeDoc) {
      updateActiveDoc({
        promptConfig: {
          ...(activeDoc.promptConfig || {}),
          [aspectRatio === '9:16' ? 'CAPTION_BOTTOM_PCT_9X16' : 'CAPTION_BOTTOM_PCT_16X9']: captionBottomPct,
        },
      });
    }
    const targetProfile = formatProfilesRef.current[nextRatio];
    setAspectRatio(nextRatio);
    setExportFps(30);
    const nextRes: ExportResolutionPreset =
      targetProfile?.exportResolution || (nextRatio === '9:16' ? '2K_1440P' : '8K_4320P');
    handleSelectExportResolution(nextRes);
    if (targetProfile) {
      setLogoScalePct(targetProfile.logoScalePct);
      if (typeof targetProfile.logoOpacity === 'number') {
        setLogoOpacity(targetProfile.logoOpacity);
      }
      setLogoPosX(targetProfile.logoPosX);
      setLogoPosY(targetProfile.logoPosY);
      setHookLine1FontSize(targetProfile.hookLine1FontSize);
      setHookLine2FontSize(targetProfile.hookLine2FontSize);
      setHookLeftPct(targetProfile.hookLeftPct);
      setHookTopPct(targetProfile.hookTopPct);
      setHookBoxWidthPct(targetProfile.hookBoxWidthPct);
      const docBottom =
        nextRatio === '9:16'
          ? Number(activeDoc?.promptConfig?.CAPTION_BOTTOM_PCT_9X16)
          : Number(activeDoc?.promptConfig?.CAPTION_BOTTOM_PCT_16X9);
      if (Number.isFinite(docBottom) && docBottom >= 2 && docBottom <= 85) {
        setCaptionBottomPct(docBottom);
      } else if (typeof targetProfile.captionBottomPct === 'number') {
        setCaptionBottomPct(targetProfile.captionBottomPct);
      }
      if (nextRatio === '9:16') {
        const doc916Max = Number(activeDoc?.promptConfig?.CAPTION_MAX_CHARS_9X16);
        const doc916Mode = activeDoc?.promptConfig?.CAPTION_LINE_MODE_9X16;
        setCaptionMaxChars(Number.isFinite(doc916Max) && doc916Max > 0 ? doc916Max : 16);
        setCaptionLineMode(
          doc916Mode === 'subdivide' || doc916Mode === 'wrap' || doc916Mode === 'original' ? doc916Mode : 'subdivide'
        );
      } else {
        if (targetProfile.captionLineMode) {
          setCaptionLineMode(targetProfile.captionLineMode);
        }
        if (typeof targetProfile.captionMaxChars === 'number') {
          setCaptionMaxChars(targetProfile.captionMaxChars);
        }
      }
    }
    setCaptionFontSize(nextRatio === '9:16' ? captionFontSize9x16 : captionFontSize16x9);
    if (nextRatio === '9:16') {
      const docKey = activeDoc?.id || activeDoc?.title || 'default';
      if (
        !autoReframedDocIdsRef.current.has(docKey) &&
        !isAutoReframe9x16Activated &&
        activeDoc?.promptConfig?.PRODUCTION_LOCKED !== 'YES'
      ) {
        autoReframedDocIdsRef.current.add(docKey);
        setTimeout(() => {
          handleRunSmartAutoReframe9x16(false);
        }, 120);
      }
    }
  };

  useEffect(() => {
    const docKey = activeDoc?.id || activeDoc?.title || '';
    if (!docKey || autoReframedDocIdsRef.current.has(docKey)) return;
    // A locked (finished) documentary keeps its reframes: the analysis only runs when the user asks for it
    if (activeDoc?.promptConfig?.PRODUCTION_LOCKED === 'YES') return;
    if (timelineClips.length === 0) return;
    autoReframedDocIdsRef.current.add(docKey);
    const allHaveReframe = timelineClips
      .filter((c) => c.clipNumber > 0 && c.clipNumber !== 999)
      .every((c) => Boolean(c.reframe9x16Mode));
    if (allHaveReframe) return;
    const t = window.setTimeout(() => {
      handleRunSmartAutoReframe9x16(false);
    }, 250);
    return () => window.clearTimeout(t);
  }, [activeDoc?.id, timelineClips.length]);

  // Sync caption settings from Etapa 7 (activeDoc.promptConfig) into CapCutEditor in real time
  useEffect(() => {
    const cfg = activeDoc?.promptConfig;
    if (!cfg) return;
    // 9:16 keeps its own caption length / mode (default 22 chars, subdivide); 16:9 uses the shared keys
    const docMaxForRatio =
      aspectRatio === '9:16'
        ? typeof cfg.CAPTION_MAX_CHARS_9X16 === 'number'
          ? cfg.CAPTION_MAX_CHARS_9X16
          : 16
        : cfg.CAPTION_MAX_CHARS;
    if (typeof docMaxForRatio === 'number' && docMaxForRatio !== captionMaxChars) {
      setCaptionMaxChars(docMaxForRatio);
    }
    const docModeForRatio =
      aspectRatio === '9:16' ? cfg.CAPTION_LINE_MODE_9X16 || 'subdivide' : cfg.CAPTION_LINE_MODE;
    if (
      (docModeForRatio === 'subdivide' ||
        docModeForRatio === 'wrap' ||
        docModeForRatio === 'original') &&
      docModeForRatio !== captionLineMode
    ) {
      setCaptionLineMode(docModeForRatio);
    }
    if (
      typeof cfg.CAPTION_FONT_SIZE_16X9 === 'number' &&
      cfg.CAPTION_FONT_SIZE_16X9 >= 12 &&
      cfg.CAPTION_FONT_SIZE_16X9 !== captionFontSize16x9
    ) {
      setCaptionFontSize16x9(cfg.CAPTION_FONT_SIZE_16X9);
      if (aspectRatio === '16:9') setCaptionFontSize(cfg.CAPTION_FONT_SIZE_16X9);
    }
    if (
      typeof cfg.CAPTION_FONT_SIZE_9X16 === 'number' &&
      cfg.CAPTION_FONT_SIZE_9X16 >= 12 &&
      cfg.CAPTION_FONT_SIZE_9X16 !== captionFontSize9x16
    ) {
      setCaptionFontSize9x16(cfg.CAPTION_FONT_SIZE_9X16);
      if (aspectRatio === '9:16') setCaptionFontSize(cfg.CAPTION_FONT_SIZE_9X16);
    }
    if (
      typeof cfg.CAPTION_WORDS_PER_LINE_16X9 === 'number' &&
      cfg.CAPTION_WORDS_PER_LINE_16X9 !== captionWordsPerLine16x9
    ) {
      setCaptionWordsPerLine16x9(cfg.CAPTION_WORDS_PER_LINE_16X9);
    }
    if (
      typeof cfg.CAPTION_WORDS_PER_LINE_9X16 === 'number' &&
      cfg.CAPTION_WORDS_PER_LINE_9X16 !== captionWordsPerLine9x16
    ) {
      setCaptionWordsPerLine9x16(cfg.CAPTION_WORDS_PER_LINE_9X16);
    }
    if (cfg.CAPTION_FONT_FAMILY && cfg.CAPTION_FONT_FAMILY !== captionFontFamily) {
      setCaptionFontFamily(cfg.CAPTION_FONT_FAMILY);
    }
    const ratioBottom =
      aspectRatio === '9:16'
        ? Number(cfg.CAPTION_BOTTOM_PCT_9X16)
        : Number(cfg.CAPTION_BOTTOM_PCT_16X9);
    if (
      Number.isFinite(ratioBottom) &&
      ratioBottom >= 2 &&
      ratioBottom <= 85 &&
      ratioBottom !== captionBottomPct
    ) {
      setCaptionBottomPct(ratioBottom);
      if (formatProfilesRef.current[aspectRatio]) {
        formatProfilesRef.current[aspectRatio].captionBottomPct = ratioBottom;
      }
    }
    if (
      (cfg.CAPTION_COLOR === 'white' ||
        cfg.CAPTION_COLOR === 'amber' ||
        cfg.CAPTION_COLOR === 'custom') &&
      cfg.CAPTION_COLOR !== captionColor
    ) {
      setCaptionColor(cfg.CAPTION_COLOR);
    }
    if (cfg.CAPTION_CUSTOM_COLOR && cfg.CAPTION_CUSTOM_COLOR !== captionCustomColor) {
      setCaptionCustomColor(cfg.CAPTION_CUSTOM_COLOR);
    }
    if (
      (cfg.CAPTION_TEXT_CASE === 'original' ||
        cfg.CAPTION_TEXT_CASE === 'uppercase' ||
        cfg.CAPTION_TEXT_CASE === 'lowercase') &&
      cfg.CAPTION_TEXT_CASE !== captionTextCase
    ) {
      setCaptionTextCase(cfg.CAPTION_TEXT_CASE);
    }
    if (
      (cfg.CAPTION_SHADOW_STYLE === 'none' ||
        cfg.CAPTION_SHADOW_STYLE === 'soft' ||
        cfg.CAPTION_SHADOW_STYLE === 'cinema' ||
        cfg.CAPTION_SHADOW_STYLE === 'outline' ||
        cfg.CAPTION_SHADOW_STYLE === 'gold_glow') &&
      cfg.CAPTION_SHADOW_STYLE !== captionShadowStyle
    ) {
      setCaptionShadowStyle(cfg.CAPTION_SHADOW_STYLE);
    }
    if (
      (cfg.CAPTION_BG_STYLE === 'none' ||
        cfg.CAPTION_BG_STYLE === 'word_shadow' ||
        cfg.CAPTION_BG_STYLE === 'semi' ||
        cfg.CAPTION_BG_STYLE === 'solid' ||
        cfg.CAPTION_BG_STYLE === 'pill') &&
      cfg.CAPTION_BG_STYLE !== captionBgStyle
    ) {
      setCaptionBgStyle(cfg.CAPTION_BG_STYLE);
    }
    if (cfg.CAPTION_BG_COLOR && cfg.CAPTION_BG_COLOR !== captionBgColor) {
      setCaptionBgColor(cfg.CAPTION_BG_COLOR);
    }
    if (
      typeof cfg.CAPTION_BG_OPACITY === 'number' &&
      Number.isFinite(cfg.CAPTION_BG_OPACITY) &&
      cfg.CAPTION_BG_OPACITY !== captionBgOpacity
    ) {
      setCaptionBgOpacity(cfg.CAPTION_BG_OPACITY);
    }
    if (cfg.CAPTION_ANIM_IN && cfg.CAPTION_ANIM_IN !== captionAnimIn) {
      setCaptionAnimIn(cfg.CAPTION_ANIM_IN);
    }
    if (cfg.CAPTION_ANIM_OUT && cfg.CAPTION_ANIM_OUT !== captionAnimOut) {
      setCaptionAnimOut(cfg.CAPTION_ANIM_OUT);
    }
    if (
      typeof cfg.CAPTION_ANIM_DUR === 'number' &&
      Number.isFinite(cfg.CAPTION_ANIM_DUR) &&
      cfg.CAPTION_ANIM_DUR !== captionAnimDur
    ) {
      setCaptionAnimDur(cfg.CAPTION_ANIM_DUR);
    }
  }, [
    activeDoc?.id,
    aspectRatio,
    activeDoc?.promptConfig?.CAPTION_MAX_CHARS,
    activeDoc?.promptConfig?.CAPTION_MAX_CHARS_9X16,
    activeDoc?.promptConfig?.CAPTION_LINE_MODE,
    activeDoc?.promptConfig?.CAPTION_LINE_MODE_9X16,
    activeDoc?.promptConfig?.CAPTION_FONT_SIZE_16X9,
    activeDoc?.promptConfig?.CAPTION_FONT_SIZE_9X16,
    activeDoc?.promptConfig?.CAPTION_WORDS_PER_LINE_16X9,
    activeDoc?.promptConfig?.CAPTION_WORDS_PER_LINE_9X16,
    activeDoc?.promptConfig?.CAPTION_FONT_FAMILY,
    activeDoc?.promptConfig?.CAPTION_BOTTOM_PCT_16X9,
    activeDoc?.promptConfig?.CAPTION_BOTTOM_PCT_9X16,
    activeDoc?.promptConfig?.CAPTION_COLOR,
    activeDoc?.promptConfig?.CAPTION_CUSTOM_COLOR,
    activeDoc?.promptConfig?.CAPTION_TEXT_CASE,
    activeDoc?.promptConfig?.CAPTION_SHADOW_STYLE,
    activeDoc?.promptConfig?.CAPTION_BG_STYLE,
    activeDoc?.promptConfig?.CAPTION_BG_COLOR,
    activeDoc?.promptConfig?.CAPTION_BG_OPACITY,
    activeDoc?.promptConfig?.CAPTION_ANIM_IN,
    activeDoc?.promptConfig?.CAPTION_ANIM_OUT,
    activeDoc?.promptConfig?.CAPTION_ANIM_DUR,
    aspectRatio,
  ]);

  // Reformat timeline captions dynamically whenever aspectRatio, maxChars, wordsPerLine (16:9 / 9:16), or lineMode changes
  useEffect(() => {
    const activeWordsLimit =
      aspectRatio === '9:16' ? captionWordsPerLine9x16 : captionWordsPerLine16x9;
    setCaptions((prevCaps) => {
      if (!prevCaps || prevCaps.length === 0) return prevCaps;
      const hasAudioCoords = prevCaps.every(
        (c) =>
          typeof c.audioStartSec === 'number' &&
          Number.isFinite(c.audioStartSec) &&
          typeof c.audioEndSec === 'number' &&
          Number.isFinite(c.audioEndSec)
      );
      let reformatted: TimelineCaptionItem[];
      if (hasAudioCoords) {
        const audioDomainInput = prevCaps.map((c) => ({
          ...c,
          start: Number(c.audioStartSec),
          end: Number(c.audioEndSec),
        }));
        const reformattedAudio = reformatCaptionItems(audioDomainInput, {
          maxCharsPerLine: captionMaxChars,
          maxWordsPerLine: activeWordsLimit,
          avoidSingleWordLines: aspectRatio === '16:9',
          mode: captionLineMode,
          lineMode: captionLineMode === 'wrap' ? 'wrap' : 'single',
        } as any).map((rc) => ({
          ...rc,
          audioStartSec:
            typeof rc.audioStartSec === 'number' && Number.isFinite(rc.audioStartSec)
              ? rc.audioStartSec
              : rc.start,
          audioEndSec:
            typeof rc.audioEndSec === 'number' && Number.isFinite(rc.audioEndSec)
              ? rc.audioEndSec
              : rc.end,
        }));
        reformatted = projectAudioCaptionsToTimeline(
          reformattedAudio,
          latestCaptionProjectionOptsRef.current
        );
      } else {
        reformatted = reformatCaptionItems(prevCaps, {
          maxCharsPerLine: captionMaxChars,
          maxWordsPerLine: activeWordsLimit,
          avoidSingleWordLines: aspectRatio === '16:9',
          mode: captionLineMode,
          lineMode: captionLineMode === 'wrap' ? 'wrap' : 'single',
        } as any);
      }
      if (reformatted.length === 0) return prevCaps;
      const sameLength = reformatted.length === prevCaps.length;
      const isIdentical =
        sameLength &&
        reformatted.every(
          (rc, idx) =>
            rc.text === prevCaps[idx].text &&
            Math.abs(rc.start - prevCaps[idx].start) < 0.015 &&
            Math.abs(rc.end - prevCaps[idx].end) < 0.015
        );
      if (isIdentical) return prevCaps;
      const docId = activeDoc?.id || 'default';
      const saved = readSavedDocOverlays(docId);
      if (
        hasAudioCoords ||
        saved?.captionsAlignVersion === CAPTIONS_ALIGN_VERSION ||
        saved?.userEditedCaptions ||
        saved?.captionsSyncV3
      ) {
        persistDocOverlaysPatch({ captions: reformatted }, docId);
      }
      return reformatted;
    });
  }, [
    aspectRatio,
    captionMaxChars,
    captionLineMode,
    captionWordsPerLine16x9,
    captionWordsPerLine9x16,
  ]);

  const handleSetCaptionFontSizeForFormat = (targetRatio: '16:9' | '9:16', newSize: number) => {
    const clamped = Math.max(14, Math.min(64, Math.round(newSize)));
    if (targetRatio === '16:9') {
      setCaptionFontSize16x9(clamped);
      formatProfilesRef.current['16:9'].captionFontSize = clamped;
      if (aspectRatio === '16:9') setCaptionFontSize(clamped);
      if (activeDoc) {
        updateActiveDoc({
          promptConfig: {
            ...(activeDoc.promptConfig || {}),
            CAPTION_FONT_SIZE_16X9: clamped,
          },
        });
      }
    } else {
      setCaptionFontSize9x16(clamped);
      formatProfilesRef.current['9:16'].captionFontSize = clamped;
      if (aspectRatio === '9:16') setCaptionFontSize(clamped);
      if (activeDoc) {
        updateActiveDoc({
          promptConfig: {
            ...(activeDoc.promptConfig || {}),
            CAPTION_FONT_SIZE_9X16: clamped,
          },
        });
      }
    }
  };

  const handleSetCaptionWordsForFormat = (targetRatio: '16:9' | '9:16', newWords: number) => {
    const clamped = Math.max(0, Math.min(12, Math.round(newWords)));
    const nextMode =
      clamped > 0 && captionLineMode === 'original' ? 'subdivide' : captionLineMode;
    if (nextMode !== captionLineMode) {
      setCaptionLineMode(nextMode);
    }
    if (targetRatio === '16:9') {
      setCaptionWordsPerLine16x9(clamped);
      formatProfilesRef.current['16:9'].captionWordsPerLine = clamped;
      if (activeDoc) {
        updateActiveDoc({
          promptConfig: {
            ...(activeDoc.promptConfig || {}),
            CAPTION_WORDS_PER_LINE_16X9: clamped,
            CAPTION_LINE_MODE: nextMode,
          },
        });
      }
    } else {
      setCaptionWordsPerLine9x16(clamped);
      formatProfilesRef.current['9:16'].captionWordsPerLine = clamped;
      if (activeDoc) {
        updateActiveDoc({
          promptConfig: {
            ...(activeDoc.promptConfig || {}),
            CAPTION_WORDS_PER_LINE_9X16: clamped,
            CAPTION_LINE_MODE: nextMode,
          },
        });
      }
    }
  };

  const handleSetCaptionLengthPreset = (
    val: number,
    explicitMode?: 'subdivide' | 'wrap' | 'original'
  ) => {
    const nextMode =
      explicitMode ||
      (val === 0 ? 'original' : captionLineMode === 'original' ? 'subdivide' : captionLineMode);
    const nextMax = val === 0 ? captionMaxChars : val;
    const nextWords16x9 =
      val === 0
        ? 0
        : val <= 24
        ? 4
        : val <= 34
        ? 6
        : val >= 40
        ? 7
        : captionWordsPerLine16x9;
    const nextWords9x16 =
      val === 0
        ? 0
        : val <= 24
        ? 3
        : val <= 34
        ? 4
        : val >= 40
        ? 5
        : captionWordsPerLine9x16;

    setCaptionMaxChars(nextMax);
    setCaptionLineMode(nextMode);
    setCaptionWordsPerLine16x9(nextWords16x9);
    setCaptionWordsPerLine9x16(nextWords9x16);
    formatProfilesRef.current[aspectRatio].captionLineMode = nextMode;
    formatProfilesRef.current[aspectRatio].captionMaxChars = nextMax;

    if (activeDoc) {
      updateActiveDoc({
        promptConfig: {
          ...(activeDoc.promptConfig || {}),
          ...(aspectRatio === '9:16'
            ? { CAPTION_MAX_CHARS_9X16: nextMax, CAPTION_LINE_MODE_9X16: nextMode }
            : { CAPTION_MAX_CHARS: nextMax, CAPTION_LINE_MODE: nextMode }),
          CAPTION_WORDS_PER_LINE_16X9: nextWords16x9,
          CAPTION_WORDS_PER_LINE_9X16: nextWords9x16,
        },
      });
    }
  };

  const handleSetCaptionLineMode = (nextMode: 'subdivide' | 'wrap' | 'original') => {
    setCaptionLineMode(nextMode);
    formatProfilesRef.current[aspectRatio].captionLineMode = nextMode;
    if (activeDoc) {
      updateActiveDoc({
        promptConfig: {
          ...(activeDoc.promptConfig || {}),
          CAPTION_LINE_MODE: nextMode,
        },
      });
    }
  };

  const handleSetCaptionFontFamily = (val: string) => {
    setCaptionFontFamily(val);
    if (activeDoc) {
      updateActiveDoc({
        promptConfig: {
          ...(activeDoc.promptConfig || {}),
          CAPTION_FONT_FAMILY: val,
        },
      });
    }
  };

  const handleSetCaptionTextCase = (val: 'original' | 'uppercase' | 'lowercase') => {
    setCaptionTextCase(val);
    if (activeDoc) {
      updateActiveDoc({
        promptConfig: {
          ...(activeDoc.promptConfig || {}),
          CAPTION_TEXT_CASE: val,
        },
      });
    }
  };

  const handleSetCaptionBottomPct = (val: number, targetRatio?: EditorAspectRatio) => {
    const r = targetRatio || aspectRatio;
    const clamped = Math.max(4, Math.min(80, Number(val.toFixed(1))));
    if (r === aspectRatio) {
      setCaptionBottomPct(clamped);
    }
    if (formatProfilesRef.current[r]) {
      formatProfilesRef.current[r].captionBottomPct = clamped;
    }
    if (activeDoc) {
      updateActiveDoc({
        promptConfig: {
          ...(activeDoc.promptConfig || {}),
          [r === '9:16' ? 'CAPTION_BOTTOM_PCT_9X16' : 'CAPTION_BOTTOM_PCT_16X9']: clamped,
        },
      });
    }
  };

  const handleSetCaptionColor = (val: 'white' | 'amber' | 'custom') => {
    setCaptionColor(val);
    if (activeDoc) {
      updateActiveDoc({
        promptConfig: {
          ...(activeDoc.promptConfig || {}),
          CAPTION_COLOR: val,
        },
      });
    }
  };

  const handleSetCaptionCustomColor = (val: string) => {
    setCaptionCustomColor(val);
    if (activeDoc) {
      updateActiveDoc({
        promptConfig: {
          ...(activeDoc.promptConfig || {}),
          CAPTION_CUSTOM_COLOR: val,
        },
      });
    }
  };

  const handleSetCaptionShadowStyle = (val: OverlayShadowStyle) => {
    setCaptionShadowStyle(val);
    if (activeDoc) {
      updateActiveDoc({
        promptConfig: {
          ...(activeDoc.promptConfig || {}),
          CAPTION_SHADOW_STYLE: val,
        },
      });
    }
  };

  const handleSetCaptionBgStyle = (val: OverlayBgStyle) => {
    setCaptionBgStyle(val);
    if (activeDoc) {
      updateActiveDoc({
        promptConfig: {
          ...(activeDoc.promptConfig || {}),
          CAPTION_BG_STYLE: val,
        },
      });
    }
  };

  const handleSetCaptionBgColor = (val: string) => {
    setCaptionBgColor(val);
    if (activeDoc) {
      updateActiveDoc({
        promptConfig: {
          ...(activeDoc.promptConfig || {}),
          CAPTION_BG_COLOR: val,
        },
      });
    }
  };

  const handleSetCaptionBgOpacity = (val: number) => {
    const clamped = Math.max(5, Math.min(100, Math.round(val)));
    setCaptionBgOpacity(clamped);
    if (activeDoc) {
      updateActiveDoc({
        promptConfig: {
          ...(activeDoc.promptConfig || {}),
          CAPTION_BG_OPACITY: clamped,
        },
      });
    }
  };

  const handleSetCaptionAnimIn = (val: ElementAnimationType) => {
    setCaptionAnimIn(val);
    if (activeDoc) {
      updateActiveDoc({
        promptConfig: {
          ...(activeDoc.promptConfig || {}),
          CAPTION_ANIM_IN: val,
        },
      });
    }
  };

  const handleSetCaptionAnimOut = (val: ElementAnimationType) => {
    setCaptionAnimOut(val);
    if (activeDoc) {
      updateActiveDoc({
        promptConfig: {
          ...(activeDoc.promptConfig || {}),
          CAPTION_ANIM_OUT: val,
        },
      });
    }
  };

  const handleSetCaptionAnimDur = (val: number) => {
    const clamped = Math.max(0.05, Math.min(3.0, Number(val.toFixed(2))));
    setCaptionAnimDur(clamped);
    if (activeDoc) {
      updateActiveDoc({
        promptConfig: {
          ...(activeDoc.promptConfig || {}),
          CAPTION_ANIM_DUR: clamped,
        },
      });
    }
  };

  const handleUpdateClip1Line1 = (newVal: string) => {
    const docId = activeDoc?.id || 'default';
    userEditedHookDocIdRef.current = docId;
    setClip1Line1(newVal);
    persistDocOverlaysPatch({ clip1Line1: newVal, userEditedHook: true }, docId);
    updateActiveDoc({ clip1Line1LocationTime: newVal });
  };

  const handleUpdateClip1Line2 = (newVal: string) => {
    const docId = activeDoc?.id || 'default';
    userEditedHookDocIdRef.current = docId;
    setClip1Line2(newVal);
    persistDocOverlaysPatch({ clip1Line2: newVal, userEditedHook: true }, docId);
    updateActiveDoc({ clip1Line2Hook: newVal });
  };

  const serializeCaptionsToSrt = (items: TimelineCaptionItem[]): string => {
    const fmtSrtTime = (sec: number) => {
      const s = Math.max(0, sec);
      const h = Math.floor(s / 3600);
      const m = Math.floor((s % 3600) / 60);
      const whole = Math.floor(s % 60);
      const ms = Math.round((s - Math.floor(s)) * 1000);
      return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(whole).padStart(
        2,
        '0'
      )},${String(Math.min(999, ms)).padStart(3, '0')}`;
    };
    return items
      .map((c, idx) => `${idx + 1}\n${fmtSrtTime(c.start)} --> ${fmtSrtTime(c.end)}\n${c.text}`)
      .join('\n\n');
  };

  const handleUpdateCaptionText = (captionId: string, newText: string) => {
    const docId = activeDoc?.id || 'default';
    userEditedCaptionsDocIdRef.current = docId;
    activeAlignSourceByDocRef.current[docId] = 'manual';
    setCaptions((prev) => {
      const updated = prev.map((c) =>
        c.id === captionId ? { ...c, text: newText, alignSource: 'manual' as const } : c
      );
      persistDocOverlaysPatch(
        {
          captions: updated,
          userEditedCaptions: true,
          captionsAlignVersion: CAPTIONS_ALIGN_VERSION,
        },
        docId
      );
      updateActiveDoc({ correctedSrt: serializeCaptionsToSrt(updated) });
      return updated;
    });
  };

  const handleStartCaptionDrag = (e: React.MouseEvent) => {
    if (e.button !== 0 || isViewerFullscreen) return;
    e.stopPropagation();
    setSelectedCanvasObject('captions');
    setActiveInspectorTab('captions');
    const canvasEl = viewerCanvasRef.current;
    if (!canvasEl) return;
    const rect = canvasEl.getBoundingClientRect();
    if (!rect.height) return;

    const startY = e.clientY;
    const initBottom = captionBottomPct;
    let finalBottom = initBottom;

    const onMove = (moveEvt: MouseEvent) => {
      const dyPx = moveEvt.clientY - startY;
      if (Math.abs(dyPx) < 2) return;
      const nextBottom = Math.max(4, Math.min(80, initBottom - (dyPx / rect.height) * 100));
      finalBottom = Number(nextBottom.toFixed(1));
      setCaptionBottomPct(finalBottom);
    };

    const onUp = () => {
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
      if (formatProfilesRef.current[aspectRatio]) {
        formatProfilesRef.current[aspectRatio].captionBottomPct = finalBottom;
      }
      if (activeDoc) {
        updateActiveDoc({
          promptConfig: {
            ...(activeDoc.promptConfig || {}),
            [aspectRatio === '9:16' ? 'CAPTION_BOTTOM_PCT_9X16' : 'CAPTION_BOTTOM_PCT_16X9']: finalBottom,
          },
        });
      }
    };

    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
  };

  // Music Track (Track 5 - Suno)
  const [musicTracks, setMusicTracks] = useState<TimelineMusicItem[]>([]);
  const [masterMusicVolume, setMasterMusicVolume] = useState<number>(() => {
    const v = Number(
      initialDocStateForInit?.masterMusicVolume ?? initialSessionState?.masterMusicVolume
    );
    return Number.isFinite(v) && v >= 0 && v <= 100 ? v : 20;
  });
  const [selectedMusicTrackId, setSelectedMusicTrackId] = useState<string | null>(
    () =>
      initialDocStateForInit?.selectedMusicTrackId ||
      initialSessionState?.selectedMusicTrackId ||
      null
  );

  const handleUpdateMusicTrack = (
    trackId: string,
    patch: Partial<Pick<TimelineMusicItem, 'volume' | 'fadeInSec' | 'fadeOutSec'>>,
    applyToAll: boolean = false
  ) => {
    const docId = activeDoc?.id || 'default';
    setMusicTracks((prev) => {
      const updated = prev.map((mt) =>
        applyToAll || mt.id === trackId ? { ...mt, ...patch } : mt
      );
      try {
        const docKey = `huellas_editor_doc_overlays_${docId}`;
        const existingRaw = localStorage.getItem(docKey);
        const existing = existingRaw ? JSON.parse(existingRaw) : {};
        const prevEdits =
          existing && typeof existing.musicTrackEdits === 'object'
            ? { ...existing.musicTrackEdits }
            : {};
        for (const item of updated) {
          if (applyToAll || item.id === trackId) {
            const cur = prevEdits[String(item.trackNumber)] || {};
            prevEdits[String(item.trackNumber)] = {
              ...cur,
              volume: item.volume,
              userSetVolumeV10: true,
              userSetFadesV5: true,
              fadeInSec: item.fadeInSec ?? 5,
              fadeOutSec: item.fadeOutSec ?? 5,
            };
          }
        }
        persistDocOverlaysPatch({ musicTrackEdits: prevEdits }, docId);
      } catch {}
      return updated;
    });
    if (applyToAll && typeof patch.volume === 'number') {
      setMasterMusicVolume(patch.volume);
    }
  };

  // Playback & Rendering State
  const [isPlaying, setIsPlaying] = useState<boolean>(false);
  // Starting playback leaves the move / resize mode so the picture is seen clean
  useEffect(() => {
    if (isPlaying && selectedCanvasObject === 'clip') setSelectedCanvasObject(null);
  }, [isPlaying]);
  const [currentTime, setCurrentTime] = useState<number>(() => {
    try {
      const targetId = activeDoc?.id || initialSessionState?.lastDocId || 'default';
      const rawPlayhead = localStorage.getItem(`huellas_editor_playhead_${targetId}`);
      if (rawPlayhead !== null) {
        const saved = Number(rawPlayhead);
        if (Number.isFinite(saved) && saved >= 0) return saved;
      }
      const fallbackSaved = Number(
        initialDocStateForInit?.currentTime ?? initialSessionState?.currentTime ?? 0
      );
      return Number.isFinite(fallbackSaved) && fallbackSaved >= 0 ? fallbackSaved : 0;
    } catch {
      return 0;
    }
  });
  const [timelineZoom, setTimelineZoom] = useState<number>(() => {
    const z = Number(initialDocStateForInit?.timelineZoom ?? initialSessionState?.timelineZoom);
    return Number.isFinite(z) && z >= 1 && z <= 240 ? z : 20;
  }); // pixels per second (máx. 240 = 10 px por fotograma a 24 fps)
  const [isFitEntireProject, setIsFitEntireProject] = useState<boolean>(() =>
    typeof initialDocStateForInit?.isFitEntireProject === 'boolean'
      ? initialDocStateForInit.isFitEntireProject
      : typeof initialSessionState?.isFitEntireProject === 'boolean'
      ? initialSessionState.isFitEntireProject
      : false
  );
  const [activeInspectorTab, setActiveInspectorTab] = useState<
    'clips' | 'audio' | 'branding' | 'captions'
  >(() => {
    const tab = initialSessionState?.activeInspectorTab;
    return tab === 'clips' || tab === 'audio' || tab === 'branding' || tab === 'captions'
      ? tab
      : 'clips';
  });
  const [voiceAudioError, setVoiceAudioError] = useState<boolean>(false);
  const [firstFrameByClip, setFirstFrameByClip] = useState<Record<number, string>>({});
  // Clips whose file in 05_Clips_Video is still being upscaled to 4K (reported by the folder scan)
  const [pending4kClipNums, setPending4kClipNums] = useState<number[]>([]);
  const [localServerClipVideosMap, setLocalServerClipVideosMap] = useState<Record<number, string>>({});
  const [localServerSunoMap, setLocalServerSunoMap] = useState<Record<number, string>>({});
  const [mediaBridgeGen, setMediaBridgeGen] = useState<number>(
    () => getMediaBridgeSnapshot().generation
  );

  useEffect(() => {
    return subscribeMediaBridge(() => {
      setMediaBridgeGen(getMediaBridgeSnapshot().generation);
    });
  }, []);

  const deckErrorRetryRef = useRef<Record<string, number>>({});
  const triggerEditorFolderMediaRescanRef = useRef<() => void>(() => {});
  const pendingOfficialAssetsVersionRef = useRef<number>(0);
  const officialVideoRetryTimersRef = useRef<Set<number>>(new Set());
  const fetchOfficialAssetsStatusRef = useRef<() => Promise<void>>(async () => {});
  const appliedOfficialAssetsVersionRef = useRef<number>(officialAssetsVersion);
  appliedOfficialAssetsVersionRef.current = officialAssetsVersion;
  const activeClipBoundsRef = useRef<{ id: string; clipNumber: number; end: number } | null>(null);
  const nextClipIdentityRef = useRef<{ id: string; clipNumber: number } | null>(null);
  const lastOfficialRehydrateAtRef = useRef<number>(0);
  const lastOfficialStatusPollAtRef = useRef<number>(0);
  const latestOfficialAssetsStatusRef = useRef<{
    loaded: boolean;
    hydrating: boolean;
    introTier: string;
    outroTier: string;
  }>({
    loaded: false,
    hydrating: false,
    introTier: 'fallback',
    outroTier: 'fallback',
  });
  const isPlayingRef = useRef<boolean>(false);
  isPlayingRef.current = isPlaying;
  // Señal global para que App.tsx pause su sincronización periódica (bloquea ~4s la página) mientras se reproduce
  useEffect(() => {
    (window as any).__huellasEditorIsPlaying = isPlaying;
    return () => {
      (window as any).__huellasEditorIsPlaying = false;
    };
  }, [isPlaying]);

  const previewVideoRef = useRef<HTMLVideoElement | null>(null);
  const deckAVideoRef = useRef<HTMLVideoElement | null>(null);
  const deckBVideoRef = useRef<HTMLVideoElement | null>(null);
  const deckAssignRef = useRef<{
    activeSlot: 0 | 1;
    slotClipIds: [string | null, string | null];
    slotUrls: [string, string];
  }>({
    activeSlot: 0,
    slotClipIds: [null, null],
    slotUrls: ['', ''],
  });
  const seamlessBridgeCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const preloadNextVideoRef = useRef<HTMLVideoElement | null>(null);
  const voiceAudioRef = useRef<HTMLAudioElement | null>(null);
  const musicAudioRef = useRef<HTMLAudioElement | null>(null);
  const separatedVocalsAudioRef = useRef<HTMLAudioElement | null>(null);
  const separatedMusicAudioRef = useRef<HTMLAudioElement | null>(null);
  const naturalClipFoleyAudioRef = useRef<HTMLAudioElement | null>(null);
  const playIntervalRef = useRef<any>(null);
  const webAudioCtxRef = useRef<AudioContext | null>(null);
  const ambientGainRef = useRef<GainNode | null>(null);
  const voiceWebAudioRef = useRef<{
    el: HTMLAudioElement;
    ctx: AudioContext;
    source: MediaElementAudioSourceNode;
    gainNode: GainNode;
  } | null>(null);
  const lastSpokenClipIdRef = useRef<string>('');
  const extractedVideoUrlByClipRef = useRef<Record<number, string>>({});
  const playWallStartMsRef = useRef<number>(0);
  const playTimelineStartSecRef = useRef<number>(currentTime);
  const currentTimeRef = useRef<number>(currentTime);
  const lastSeekVersionRef = useRef<number>(0);
  const appliedVideoSeekVersionRef = useRef<number>(-1);
  const appliedVoiceSeekVersionRef = useRef<number>(-1);
  const appliedMusicSeekVersionRef = useRef<number>(-1);
  const appliedSeparatedVocalSeekVersionRef = useRef<number>(-1);
  const appliedSeparatedMusicSeekVersionRef = useRef<number>(-1);
  const activePlayingClipIdRef = useRef<string | null>(null);
  const activePlayingMusicIdRef = useRef<string | null>(null);
  const activePlayingSeparatedVocalIdRef = useRef<string | null>(null);
  const activePlayingSeparatedMusicIdRef = useRef<string | null>(null);
  const clipEndedHoldRef = useRef<boolean>(false);

  // Decoupled 60fps GPU Playhead & Imperative DOM Refs (Silky Smooth Playback Engine)
  const playheadNeedleRef = useRef<HTMLDivElement | null>(null);
  const playheadBadgeTextRef = useRef<HTMLDivElement | null>(null);
  const timelineToolbarTimeRef = useRef<HTMLSpanElement | null>(null);
  const viewerTimecodeRef = useRef<HTMLSpanElement | null>(null);
  const viewerTotalDurationRef = useRef<HTMLSpanElement | null>(null);
  const viewerRangeInputRef = useRef<HTMLInputElement | null>(null);
  const playheadRafIdRef = useRef<number | null>(null);
  const lastFlushedClipIdRef = useRef<string | null>(null);
  const lastFlushedCaptionIdRef = useRef<string | null>(null);
  const lastReactCommitMsRef = useRef<number>(0);
  const lastDecimaRef = useRef<number>(-1);
  const lastSecIntRef = useRef<number>(-1);
  const lastRateNudgeMsRef = useRef<number>(0);
  const timelineScrollContainerRef = useRef<HTMLDivElement | null>(null);
  const timelineRulerScrollRef = useRef<HTMLDivElement | null>(null);
  const timelineRulerLaneRef = useRef<HTMLDivElement | null>(null);
  const isScrubbingRulerRef = useRef<boolean>(false);
  const prevDocIdForPlayheadRef = useRef<string | undefined>(activeDoc?.id);
  const isRestoringDocStateRef = useRef<boolean>(false);
  const zoomPlayheadViewportOffsetRef = useRef<number | null>(null);
  const hasExplicitTimelineScrollRef = useRef<boolean>(
    Boolean(
      initialDocStateForInit?.hasExplicitTimelineScroll ||
        Number(initialDocStateForInit?.timelineScrollLeft) > 0
    )
  );
  const savedTimelineScrollRef = useRef<{ left: number; top: number }>((() => {
    const savedLeft = Number(
      initialDocStateForInit?.timelineScrollLeft ??
        initialSessionState?.timelineScrollLeft
    );
    const savedTop =
      Number(
        initialDocStateForInit?.timelineScrollTop ??
          initialSessionState?.timelineScrollTop
      ) || 0;
    if (
      Number.isFinite(savedLeft) &&
      (initialDocStateForInit?.hasExplicitTimelineScroll || savedLeft > 0)
    ) {
      return { left: Math.max(0, Math.round(savedLeft)), top: Math.max(0, Math.round(savedTop)) };
    }
    if (currentTime > 12) {
      return {
        left: Math.max(0, Math.round(152 + currentTime * timelineZoom - 320)),
        top: Math.max(0, Math.round(savedTop)),
      };
    }
    return { left: 0, top: Math.max(0, Math.round(savedTop)) };
  })());
  const standbyArmedRef = useRef<{
    key: string;
    armed: boolean;
    prerolled: boolean;
  }>({ key: '', armed: false, prerolled: false });
  const lastPrimaryDriftSeekMsRef = useRef<number>(0);
  const cinemaAmbienceActiveRef = useRef<boolean>(false);
  const lastAutoScrollMsRef = useRef<number>(0);
  const lastPersistedPlayheadMsRef = useRef<number>(0);
  const timelineScrollPersistTimerRef = useRef<any>(null);

  // 1) Restore saved per-documentary playhead, format, quality, zoom, scroll & selection when activeDoc?.id loads or switches
  // Each documentary stores and restores its own independent Video Editor state.
  useEffect(() => {
    if (!activeDoc?.id) return;
    if (prevDocIdForPlayheadRef.current === activeDoc.id) return;
    const wasUnset = !prevDocIdForPlayheadRef.current;
    prevDocIdForPlayheadRef.current = activeDoc.id;

    const isSameAsInitialBootDoc =
      wasUnset &&
      (!initialSessionState?.lastDocId || initialSessionState.lastDocId === activeDoc.id);

    if (!isSameAsInitialBootDoc) {
      isRestoringDocStateRef.current = true;
    }

    try {
      const savedDoc = readSavedDocOverlays(activeDoc.id);
      const rawPlayhead = localStorage.getItem(`huellas_editor_playhead_${activeDoc.id}`);
      const parsedPlayhead =
        rawPlayhead !== null
          ? Number(rawPlayhead)
          : typeof savedDoc?.currentTime === 'number'
          ? Number(savedDoc.currentTime)
          : isSameAsInitialBootDoc
          ? currentTimeRef.current
          : 0;
      const nextTime =
        Number.isFinite(parsedPlayhead) && parsedPlayhead >= 0 ? parsedPlayhead : 0;
      currentTimeRef.current = nextTime;
      playTimelineStartSecRef.current = nextTime;
      lastSeekVersionRef.current += 1;
      setCurrentTime(nextTime);

      const nextZoom =
        typeof savedDoc?.timelineZoom === 'number' && savedDoc.timelineZoom >= 1
          ? savedDoc.timelineZoom
          : isSameAsInitialBootDoc
          ? timelineZoom
          : 20;
      const nextFit =
        typeof savedDoc?.isFitEntireProject === 'boolean'
          ? savedDoc.isFitEntireProject
          : isSameAsInitialBootDoc
          ? isFitEntireProject
          : false;

      if (
        typeof savedDoc?.timelineScrollLeft === 'number' &&
        (savedDoc.hasExplicitTimelineScroll || savedDoc.timelineScrollLeft > 0)
      ) {
        savedTimelineScrollRef.current = {
          left: Math.max(0, Math.round(savedDoc.timelineScrollLeft)),
          top: Math.max(0, Math.round(Number(savedDoc.timelineScrollTop) || 0)),
        };
        hasExplicitTimelineScrollRef.current = true;
      } else if (nextTime > 12) {
        savedTimelineScrollRef.current = {
          left: Math.max(0, Math.round(152 + nextTime * nextZoom - 320)),
          top: Math.max(0, Math.round(Number(savedDoc?.timelineScrollTop) || 0)),
        };
        hasExplicitTimelineScrollRef.current = false;
      } else if (!isSameAsInitialBootDoc) {
        savedTimelineScrollRef.current = {
          left: 0,
          top: Math.max(0, Math.round(Number(savedDoc?.timelineScrollTop) || 0)),
        };
        hasExplicitTimelineScrollRef.current = false;
      }

      if (!isSameAsInitialBootDoc) {
        const nextRatio: EditorAspectRatio =
          savedDoc?.aspectRatio === '16:9' || savedDoc?.aspectRatio === '9:16'
            ? savedDoc.aspectRatio
            : activeDoc.productionType === 'REEL_9X16'
            ? '9:16'
            : '16:9';
        setAspectRatio(nextRatio);

        const nextRes: ExportResolutionPreset =
          savedDoc?.exportResolution === 'HD_1080P' ||
          savedDoc?.exportResolution === '2K_1440P' ||
          savedDoc?.exportResolution === '4K_2160P' ||
          savedDoc?.exportResolution === '8K_4320P'
            ? savedDoc.exportResolution
            : formatProfilesRef.current?.[nextRatio]?.exportResolution ||
              (nextRatio === '9:16' ? '2K_1440P' : '8K_4320P');
        setExportResolution(nextRes);

        const nextFps =
          savedDoc?.exportFps === 24 ||
          savedDoc?.exportFps === 30 ||
          savedDoc?.exportFps === 60
            ? savedDoc.exportFps
            : nextRatio === '9:16'
            ? 30
            : 30;
        setExportFps(nextFps);

        const nextTier =
          savedDoc?.exportBitrateTier === 'standard' ||
          savedDoc?.exportBitrateTier === 'recommended' ||
          savedDoc?.exportBitrateTier === 'ultra' ||
          savedDoc?.exportBitrateTier === 'custom'
            ? savedDoc.exportBitrateTier
            : 'recommended';
        setExportBitrateTier(nextTier);

        const defaultBitrates = getRecommendedBitratesForRes(nextRes);
        const nextBitrate =
          typeof savedDoc?.exportBitrateMbps === 'number' &&
          savedDoc.exportBitrateMbps >= 4
            ? savedDoc.exportBitrateMbps
            : nextTier === 'standard'
            ? defaultBitrates.standard
            : nextTier === 'ultra'
            ? defaultBitrates.ultra
            : defaultBitrates.recommended;
        setExportBitrateMbps(nextBitrate);

        setBurnInLogo(
          typeof savedDoc?.burnInLogo === 'boolean' ? savedDoc.burnInLogo : true
        );
        setBurnInHook(
          typeof savedDoc?.burnInHook === 'boolean' ? savedDoc.burnInHook : true
        );
        setBurnInCaptions(
          typeof savedDoc?.burnInCaptions === 'boolean' ? savedDoc.burnInCaptions : true
        );
        setDefaultTransition(savedDoc?.defaultTransition || 'direct');

        setTimelineZoom(nextZoom);
        setIsFitEntireProject(nextFit);
        if (typeof savedDoc?.isTimelineDockExpanded === 'boolean') {
          setIsTimelineDockExpanded(savedDoc.isTimelineDockExpanded);
        }
        if (
          savedDoc?.leftPanelTab === 'media' ||
          savedDoc?.leftPanelTab === 'audio' ||
          savedDoc?.leftPanelTab === 'text' ||
          savedDoc?.leftPanelTab === 'transitions' ||
          savedDoc?.leftPanelTab === 'captions'
        ) {
          setLeftPanelTab(savedDoc.leftPanelTab);
        }
        if (
          savedDoc?.activeInspectorTab === 'clips' ||
          savedDoc?.activeInspectorTab === 'audio' ||
          savedDoc?.activeInspectorTab === 'branding' ||
          savedDoc?.activeInspectorTab === 'captions'
        ) {
          setActiveInspectorTab(savedDoc.activeInspectorTab);
        }
        if (typeof savedDoc?.isLeftPanelCollapsed === 'boolean') {
          setIsLeftPanelCollapsed(savedDoc.isLeftPanelCollapsed);
        }
        if (typeof savedDoc?.isRightPanelCollapsed === 'boolean') {
          setIsRightPanelCollapsed(savedDoc.isRightPanelCollapsed);
        }

        const restoredClipId =
          typeof savedDoc?.selectedClipId === 'string' && savedDoc.selectedClipId
            ? savedDoc.selectedClipId
            : null;
        setSelectedClipId(restoredClipId);
        setSelectedClipIds(
          Array.isArray(savedDoc?.selectedClipIds) && savedDoc.selectedClipIds.length > 0
            ? savedDoc.selectedClipIds
            : restoredClipId
            ? [restoredClipId]
            : []
        );
        setSelectedMusicTrackId(
          typeof savedDoc?.selectedMusicTrackId === 'string'
            ? savedDoc.selectedMusicTrackId
            : null
        );
        setVoiceVolume(
          typeof savedDoc?.voiceVolume === 'number' ? savedDoc.voiceVolume : 100
        );
        setVoiceGainDb(
          typeof savedDoc?.voiceGainDb === 'number' ? savedDoc.voiceGainDb : 5
        );
        setAutoDuckingEnabled(
          typeof savedDoc?.autoDuckingEnabled === 'boolean'
            ? savedDoc.autoDuckingEnabled
            : true
        );
        setFoleyHighVolume(
          typeof savedDoc?.foleyHighVolume === 'number' ? savedDoc.foleyHighVolume : 80
        );
        setFoleyDuckedVolume(
          typeof savedDoc?.foleyDuckedVolume === 'number' ? savedDoc.foleyDuckedVolume : 20
        );
        setMasterMusicVolume(
          typeof savedDoc?.masterMusicVolume === 'number' ? savedDoc.masterMusicVolume : 20
        );
        setShowOnlyReviewedClips(true);
        setReframeSummary9x16(
          typeof savedDoc?.reframeSummary9x16 === 'string'
            ? savedDoc.reframeSummary9x16
            : ''
        );
      }

      window.requestAnimationFrame(() => {
        const el = timelineScrollContainerRef.current;
        if (el && el.clientWidth > 0 && !nextFit) {
          el.scrollLeft = savedTimelineScrollRef.current.left;
          el.scrollTop = savedTimelineScrollRef.current.top;
        }
        if (timelineRulerScrollRef.current && !nextFit) {
          timelineRulerScrollRef.current.scrollLeft = savedTimelineScrollRef.current.left;
        }
      });
    } catch {}
  }, [activeDoc?.id]);

  // 1b) Export quality (resolution, FPS, bitrate) belongs to each documentary and format. Whenever the
  // documentary or the format changes, apply what that documentary has stored for that format; a
  // documentary with nothing stored gets the standard defaults, never another documentary's choice.
  useEffect(() => {
    if (!activeDoc?.id) return;
    const cfg: Record<string, any> = activeDoc.promptConfig || {};
    const sfx = aspectRatio === '9:16' ? '9X16' : '16X9';
    let local: any = null;
    try {
      local = JSON.parse(localStorage.getItem(`huellas_editor_doc_overlays_${activeDoc.id}`) || 'null');
    } catch {}
    // Values this browser saved for this documentary before export choices were stored in it
    const legacy = local && local.aspectRatio === aspectRatio ? local : null;
    const isRes = (v: any): v is ExportResolutionPreset =>
      v === 'HD_1080P' || v === '2K_1440P' || v === '4K_2160P' || v === '8K_4320P';
    const isFps = (v: any): v is 24 | 30 | 60 => v === 24 || v === 30 || v === 60;
    const isTier = (v: any): v is 'standard' | 'recommended' | 'ultra' | 'custom' =>
      v === 'standard' || v === 'recommended' || v === 'ultra' || v === 'custom';
    const res: ExportResolutionPreset = isRes(cfg[`EXPORT_RESOLUTION_${sfx}`])
      ? cfg[`EXPORT_RESOLUTION_${sfx}`]
      : isRes(legacy?.exportResolution)
      ? legacy.exportResolution
      : aspectRatio === '9:16'
      ? '2K_1440P'
      : '8K_4320P';
    const storedFps = Number(cfg[`EXPORT_FPS_${sfx}`]);
    const fps: 24 | 30 | 60 = isFps(storedFps)
      ? storedFps
      : aspectRatio === '16:9' && isFps(legacy?.exportFps)
      ? legacy.exportFps
      : 30;
    const hasStoredTier = isTier(cfg[`EXPORT_BITRATE_TIER_${sfx}`]);
    const tier = hasStoredTier
      ? cfg[`EXPORT_BITRATE_TIER_${sfx}`]
      : isTier(legacy?.exportBitrateTier)
      ? legacy.exportBitrateTier
      : 'recommended';
    const tiers = getRecommendedBitratesForRes(res);
    const customMbps = Number(hasStoredTier ? cfg[`EXPORT_BITRATE_MBPS_${sfx}`] : legacy?.exportBitrateMbps);
    const mbps =
      tier === 'custom' && Number.isFinite(customMbps) && customMbps >= 4 && customMbps <= 400
        ? customMbps
        : tier === 'standard'
        ? tiers.standard
        : tier === 'ultra'
        ? tiers.ultra
        : tiers.recommended;
    setExportResolution(res);
    setExportFps(fps);
    setExportBitrateTier(tier === 'custom' && mbps !== customMbps ? 'recommended' : tier);
    setExportBitrateMbps(mbps);
  }, [activeDoc?.id, aspectRatio]);

  // 2) Persist playhead position & full editor state per documentary in real time
  useEffect(() => {
    if (isRestoringDocStateRef.current) {
      isRestoringDocStateRef.current = false;
      return;
    }
    const roundedTime = Number(currentTime.toFixed(2));
    // While playing, avoid synchronous localStorage & deep JSON serialization on every tick
    // Only persist the lightweight playhead position throttled (>= 1500ms)
    if (isPlaying) {
      const now = performance.now();
      if (now - lastPersistedPlayheadMsRef.current >= 1500) {
        lastPersistedPlayheadMsRef.current = now;
        try {
          if (activeDoc?.id) {
            localStorage.setItem(`huellas_editor_playhead_${activeDoc.id}`, String(roundedTime));
          }
        } catch {}
      }
      return;
    }
    try {
      if (activeDoc?.id) {
        localStorage.setItem(`huellas_editor_playhead_${activeDoc.id}`, String(roundedTime));
      }
      const sessionPayload = {
        lastDocId: activeDoc?.id || initialSessionState?.lastDocId || 'default',
        aspectRatio,
        exportResolution,
        exportFps,
        exportBitrateTier,
        exportBitrateMbps,
        burnInLogo,
        burnInHook,
        burnInCaptions,
        defaultTransition,
        clipAnimIn,
        clipAnimOut,
        clipAnimDur,
        isLeftPanelCollapsed,
        leftPanelTab,
        isRightPanelCollapsed,
        activeInspectorTab,
        isTimelineDockExpanded,
        selectedClipId,
        selectedClipIds,
        selectedMusicTrackId,
        selectedVocalSegmentId,
        selectedMusicSegmentId,
        selectedCanvasObject,
        voiceVolume,
        voiceGainDb,
        autoDuckingEnabled,
        foleyHighVolume,
        foleyDuckedVolume,
        masterMusicVolume,
        showOnlyReviewedClips,
        autoIsolateFoleyAllClips,
        timelineZoom,
        isFitEntireProject,
        currentTime: roundedTime,
        timelineScrollLeft: savedTimelineScrollRef.current.left,
        timelineScrollTop: savedTimelineScrollRef.current.top,
        hasExplicitTimelineScroll: hasExplicitTimelineScrollRef.current,
        reframeSummary9x16,
        updatedAt: Date.now(),
      };
      localStorage.setItem(EDITOR_SESSION_STORAGE_KEY, JSON.stringify(sessionPayload));
      if (activeDoc?.id) {
        persistDocOverlaysPatch(
          {
            aspectRatio,
            exportResolution,
            exportFps,
            exportBitrateTier,
            exportBitrateMbps,
            burnInLogo,
            burnInHook,
            burnInCaptions,
            defaultTransition,
            isLeftPanelCollapsed,
            leftPanelTab,
            isRightPanelCollapsed,
            activeInspectorTab,
            isTimelineDockExpanded,
            selectedClipId,
            selectedClipIds,
            selectedMusicTrackId,
            voiceVolume,
            voiceGainDb,
            autoDuckingEnabled,
            foleyHighVolume,
            foleyDuckedVolume,
            masterMusicVolume,
            showOnlyReviewedClips,
            timelineZoom,
            isFitEntireProject,
            currentTime: roundedTime,
            timelineScrollLeft: savedTimelineScrollRef.current.left,
            timelineScrollTop: savedTimelineScrollRef.current.top,
            hasExplicitTimelineScroll: hasExplicitTimelineScrollRef.current,
            reframeSummary9x16,
          },
          activeDoc.id
        );
      }
    } catch {}
  }, [
    activeDoc?.id,
    isPlaying,
    aspectRatio,
    exportResolution,
    exportFps,
    exportBitrateTier,
    exportBitrateMbps,
    burnInLogo,
    burnInHook,
    burnInCaptions,
    defaultTransition,
    clipAnimIn,
    clipAnimOut,
    clipAnimDur,
    isLeftPanelCollapsed,
    leftPanelTab,
    isRightPanelCollapsed,
    activeInspectorTab,
    isTimelineDockExpanded,
    selectedClipId,
    selectedClipIds,
    selectedMusicTrackId,
    selectedVocalSegmentId,
    selectedMusicSegmentId,
    selectedCanvasObject,
    voiceVolume,
    voiceGainDb,
    autoDuckingEnabled,
    foleyHighVolume,
    foleyDuckedVolume,
    masterMusicVolume,
    showOnlyReviewedClips,
    autoIsolateFoleyAllClips,
    timelineZoom,
    isFitEntireProject,
    currentTime,
    reframeSummary9x16,
  ]);

  // Pause playback automatically if user navigates away from the Video Editor to another stage, keeping exact playhead position;
  // when re-entering the Video Editor, restore exact timeline scroll & sync the preview frame at currentTime
  useLayoutEffect(() => {
    if (!isEditorActive) {
      if (isPlaying) {
        setIsPlaying(false);
      }
      return;
    }
    lastSeekVersionRef.current += 1;
    const restoreScroll = () => {
      const container = timelineScrollContainerRef.current;
      if (container && !isFitEntireProject && container.clientWidth > 0) {
        container.scrollLeft = savedTimelineScrollRef.current.left;
        container.scrollTop = savedTimelineScrollRef.current.top;
      }
      if (timelineRulerScrollRef.current && !isFitEntireProject) {
        timelineRulerScrollRef.current.scrollLeft = savedTimelineScrollRef.current.left;
      }
    };
    restoreScroll();
    const rafId = window.requestAnimationFrame(restoreScroll);
    const timerId = window.setTimeout(restoreScroll, 60);
    return () => {
      window.cancelAnimationFrame(rafId);
      window.clearTimeout(timerId);
    };
  }, [isEditorActive]);

  const prevDocIdForMediaScanRef = useRef<string | undefined>(activeDoc?.id);
  const activeDocRef = useRef(activeDoc);
  activeDocRef.current = activeDoc;

  // Reset extracted first frames when switching documentaries, and re-query local server 05_Clips_Video whenever editor becomes active
  useEffect(() => {
    if (prevDocIdForMediaScanRef.current !== activeDoc?.id) {
      prevDocIdForMediaScanRef.current = activeDoc?.id;
      setFirstFrameByClip({});
      setPending4kClipNums([]);
      setLocalServerClipVideosMap({});
      setLocalServerSunoMap({});
      extractedVideoUrlByClipRef.current = {};
    }

    let cancelled = false;
    let activeCtrl: AbortController | null = null;
    let retryTimer: number | null = null;
    let coldStartRetryIdx = 0;

    const fetchFolderMedia = async (allowTunnelRefresh = true): Promise<void> => {
      const fPath = (downloadFolderPath || activeDoc?.downloadFolderPath || '').trim();
      const fName = (downloadFolderName || activeDoc?.downloadFolderName || '').trim();
      const dTitle = (activeDoc?.title || '').trim();
      const qs = `docId=${encodeURIComponent(activeDoc?.id || '')}&folderPath=${encodeURIComponent(fPath)}&folderName=${encodeURIComponent(fName)}&docTitle=${encodeURIComponent(dTitle)}&includePrompts=0`;
      const bases = getEditorMediaBridgeBases();
      let resolvedAny = false;
      let needsColdStartBackoff = false;

      for (const base of bases) {
        if (cancelled) return;
        const ctrl = new AbortController();
        activeCtrl = ctrl;
        const timeoutMs = getMediaBridgeCandidateTimeoutMs(base);
        const timer = window.setTimeout(() => ctrl.abort(), timeoutMs);
        try {
          const res = await fetch(`${base}/api/flow/list-folder-media?${qs}`, {
            signal: ctrl.signal,
            cache: 'no-store',
          });
          if (!res.ok) {
            if (
              base &&
              /^https?:\/\//i.test(base) &&
              (res.status === 502 || res.status === 503 || res.status === 504 || res.status === 530)
            ) {
              void verifyMediaBridgeHealthOrRefresh(base);
            }
            continue;
          }
          const data = await res.json();
          if (cancelled) return;
          if (
            base &&
            /^https:\/\//i.test(base) &&
            (data?.resolvedRoot || (Array.isArray(data?.clipVideos) && data.clipVideos.length > 0))
          ) {
            persistDiscoveredMacTunnel(base);
          }
          const prefix = (u: string) =>
            rewriteMediaBridgeUrl(u && u.startsWith('/') && base ? `${base}${u}` : u, base);
          const latestDocClips = activeDocRef.current?.clips || activeDoc?.clips || [];
          const docClipByNum = new Map<number, DocumentaryClip>();
          for (const dc of latestDocClips) {
            if (dc && typeof dc.clipNumber === 'number') {
              docClipByNum.set(dc.clipNumber, dc);
            }
          }
          {
            const nextPending = Array.isArray(data.pending4kClipNumbers)
              ? (data.pending4kClipNumbers as any[]).map(Number).filter((n) => n > 0)
              : [];
            setPending4kClipNums((prev) =>
              prev.length === nextPending.length && prev.every((n, i) => n === nextPending[i]) ? prev : nextPending
            );
          }
          const nextVids: Record<number, string> = {};
          if (Array.isArray(data.clipVideos)) {
            for (const item of data.clipVideos) {
              const cNum = Number(item?.clipNumber || 0);
              if (cNum <= 0 || !item?.url) continue;
              if (
                isEditorFolderItemDiscarded(
                  docClipByNum.get(cNum),
                  item?.fileName,
                  item?.mtimeMs ?? item?.lastModified,
                  item?.url
                )
              ) {
                continue;
              }
              const resolvedVidUrl =
                toCanonicalMediaBridgePath(String(item.url || '')) || prefix(String(item.url));
              if (resolvedVidUrl) {
                nextVids[cNum] = resolvedVidUrl;
              }
            }
            if (data.resolvedRoot || data.clipVideos.length > 0) {
              setLocalServerClipVideosMap((prev) => {
                const prevKeys = Object.keys(prev);
                const nextKeys = Object.keys(nextVids);
                if (
                  prevKeys.length === nextKeys.length &&
                  nextKeys.every((k) => prev[Number(k)] === nextVids[Number(k)])
                ) {
                  return prev;
                }
                return nextVids;
              });
            }
          }
          if (Array.isArray(data.clipFrames) && data.clipFrames.length > 0) {
            const nextFrames: Record<number, string> = {};
            for (const f of data.clipFrames) {
              const fNum = Number(f?.clipNumber || 0);
              if (fNum <= 0 || !f?.url || nextFrames[fNum]) continue;
              const docClip = docClipByNum.get(fNum);
              const isFromDiscardedDir = /_Descartados_Auditoria/i.test(String(f.url || ''));
              if (
                isFromDiscardedDir &&
                isEditorClipRejectedOrQuarantined(docClip) &&
                !nextVids[fNum]
              ) {
                continue;
              }
              const resolvedFrameUrl = prefix(String(f.url));
              if (resolvedFrameUrl) {
                nextFrames[fNum] = resolvedFrameUrl;
              }
            }
            if (Object.keys(nextFrames).length > 0) {
              setFirstFrameByClip((prev) => {
                const changed = Object.entries(nextFrames).some(([k, v]) => prev[Number(k)] !== v);
                return changed ? { ...prev, ...nextFrames } : prev;
              });
            }
          }
          if (Array.isArray(data.sunoFiles) && data.sunoFiles.length > 0) {
            const nextSuno: Record<number, string> = {};
            for (const s of data.sunoFiles) {
              if (s.trackNumber > 0 && s.url && !nextSuno[s.trackNumber]) {
                const resolvedSunoUrl = prefix(s.url);
                if (resolvedSunoUrl) {
                  nextSuno[s.trackNumber] = resolvedSunoUrl;
                }
              }
            }
            setLocalServerSunoMap((prev) => {
              const changed = Object.entries(nextSuno).some(([k, v]) => prev[Number(k)] !== v);
              return changed ? { ...prev, ...nextSuno } : prev;
            });
          }
          if (
            data.clipPrompts &&
            typeof data.clipPrompts === 'object' &&
            Array.isArray(activeDoc?.clips) &&
            activeDoc.clips.length > 0
          ) {
            const p5 = data.clipPrompts[5] || data.clipPrompts['5'];
            if (p5 && (p5.imagePrompt || p5.videoPrompt)) {
              const cur5 = activeDoc.clips.find((c) => c.clipNumber === 5);
              if (
                cur5 &&
                ((p5.imagePrompt && cur5.imagePrompt !== p5.imagePrompt) ||
                  (p5.videoPrompt && cur5.videoPrompt !== p5.videoPrompt))
              ) {
                updateActiveDoc({
                  clips: activeDoc.clips.map((c) =>
                    c.clipNumber === 5
                      ? {
                          ...c,
                          imagePrompt: p5.imagePrompt || c.imagePrompt,
                          videoPrompt: p5.videoPrompt || c.videoPrompt,
                        }
                      : c
                  ),
                });
                commitTimelineClipsUpdate((prev) =>
                  prev.map((tc) =>
                    tc.clipNumber === 5
                      ? {
                          ...tc,
                          imagePrompt: p5.imagePrompt || tc.imagePrompt,
                          videoPrompt: p5.videoPrompt || tc.videoPrompt,
                        }
                      : tc
                  )
                );
              }
            }
          }
          if (data?.resolvedRoot || (Array.isArray(data.clipVideos) && data.clipVideos.length > 0)) {
            resolvedAny = true;
            coldStartRetryIdx = 0;
            break;
          }
          if (
            data?.icloudTccPending ||
            (!data?.resolvedRoot && (!Array.isArray(data?.clipVideos) || data.clipVideos.length === 0))
          ) {
            needsColdStartBackoff = true;
          }
        } catch {
          if (!cancelled && base && /^https?:\/\//i.test(base)) {
            void verifyMediaBridgeHealthOrRefresh(base);
          }
        } finally {
          window.clearTimeout(timer);
          if (activeCtrl === ctrl) {
            activeCtrl = null;
          }
        }
      }

      if (!cancelled && !resolvedAny && allowTunnelRefresh) {
        const freshTunnel = await refreshLiveMacMediaTunnelUrl({
          force: true,
          allowRelayWake: true,
        });
        if (!cancelled && freshTunnel) {
          await fetchFolderMedia(false);
          return;
        }
      }

      if (!cancelled && !resolvedAny && needsColdStartBackoff && coldStartRetryIdx < 3) {
        const retryDelays = [1800, 3500, 7000];
        const delayMs = retryDelays[coldStartRetryIdx] || 7000;
        coldStartRetryIdx += 1;
        if (retryTimer) window.clearTimeout(retryTimer);
        retryTimer = window.setTimeout(() => {
          if (!cancelled && isEditorActive) {
            void fetchFolderMedia(false);
          }
        }, delayMs);
      }
    };

    triggerEditorFolderMediaRescanRef.current = () => {
      if (!cancelled) {
        void fetchFolderMedia(true);
      }
    };

    void fetchFolderMedia(true);
    const onWinFocus = () => {
      if (isEditorActive) void fetchFolderMedia(true);
    };
    window.addEventListener('focus', onWinFocus);
    const pollTimer = window.setInterval(() => {
      // Durante la reproducción no se reescanea la carpeta (evita congelar la aguja al procesar la respuesta)
      if (isEditorActive && !document.hidden && !isPlayingRef.current) {
        void fetchFolderMedia(true);
      }
    }, 6000);

    return () => {
      cancelled = true;
      activeCtrl?.abort();
      if (retryTimer) window.clearTimeout(retryTimer);
      window.removeEventListener('focus', onWinFocus);
      window.clearInterval(pollTimer);
    };
  }, [
    activeDoc?.id,
    activeDoc?.title,
    downloadFolderName,
    downloadFolderPath,
    isEditorActive,
    mediaBridgeGen,
  ]);

  const missingFrameTargetsSignature = useMemo(() => {
    if (!isEditorActive || isPlaying) return '';
    const seen = new Set<number>();
    const entries: string[] = [];
    for (const c of timelineClips) {
      if (!c || c.clipNumber <= 0 || c.clipNumber === 999 || seen.has(c.clipNumber)) continue;
      const resolvedUrl = rewriteMediaBridgeUrl(c.videoUrl);
      if (!resolvedUrl || firstFrameByClip[c.clipNumber]) continue;
      if (extractedVideoUrlByClipRef.current[c.clipNumber] === resolvedUrl) continue;
      seen.add(c.clipNumber);
      entries.push(`${c.clipNumber}\t${resolvedUrl}`);
    }
    return entries.join('\n');
  }, [timelineClips, firstFrameByClip, isEditorActive, isPlaying, mediaBridgeGen]);

  // Automatically extract the exact FIRST FRAME (t = 0.08s) of each clip's .MP4 video ONLY when editor is active & paused, without saturating Chrome's 6-socket pool
  useEffect(() => {
    if (!isEditorActive || isPlaying || !missingFrameTargetsSignature) return;
    let cancelled = false;
    const clipsToExtract = missingFrameTargetsSignature
      .split('\n')
      .map((row) => {
        const tabIdx = row.indexOf('\t');
        if (tabIdx <= 0) return null;
        const clipNumber = Number(row.slice(0, tabIdx));
        const videoUrl = row.slice(tabIdx + 1);
        return clipNumber > 0 && videoUrl ? { clipNumber, videoUrl } : null;
      })
      .filter((x): x is { clipNumber: number; videoUrl: string } => Boolean(x));
    if (clipsToExtract.length === 0) return;

    const extractFirstFrameFromVideoUrl = (videoUrl: string): Promise<string> =>
      new Promise((resolve) => {
        const vid = document.createElement('video');
        vid.crossOrigin = 'anonymous';
        vid.muted = true;
        vid.playsInline = true;
        vid.preload = 'metadata';

        let resolved = false;
        const finish = (dataUrl: string) => {
          if (resolved) return;
          resolved = true;
          try {
            vid.pause();
            vid.removeAttribute('src');
            vid.load();
          } catch {}
          resolve(dataUrl);
        };

        const timer = setTimeout(() => finish(''), 2500);

        const captureFrame = () => {
          try {
            const w = 320;
            const h = 180;
            const canvas = document.createElement('canvas');
            canvas.width = w;
            canvas.height = h;
            const ctx = canvas.getContext('2d');
            if (ctx) {
              ctx.drawImage(vid, 0, 0, w, h);
              const out = canvas.toDataURL('image/jpeg', 0.78);
              clearTimeout(timer);
              finish(out && out.length > 200 ? out : '');
              return;
            }
          } catch {}
          clearTimeout(timer);
          finish('');
        };

        vid.onloadedmetadata = () => {
          try {
            vid.currentTime = Math.min(0.08, Math.max(0, (vid.duration || 1) * 0.02));
          } catch {
            captureFrame();
          }
        };
        vid.onseeked = () => captureFrame();
        vid.onerror = () => {
          clearTimeout(timer);
          finish('');
        };
        vid.src = appendMediaFrameProbeParam(videoUrl);
      });

    let cursor = 0;
    const runWorker = async () => {
      while (!cancelled && cursor < clipsToExtract.length) {
        const idx = cursor++;
        const item = clipsToExtract[idx];
        if (!item || !item.videoUrl) continue;
        const frameDataUrl = await extractFirstFrameFromVideoUrl(item.videoUrl);
        if (cancelled) return;
        if (frameDataUrl) {
          extractedVideoUrlByClipRef.current[item.clipNumber] = item.videoUrl;
          setFirstFrameByClip((prev) =>
            prev[item.clipNumber] === frameDataUrl
              ? prev
              : {
                  ...prev,
                  [item.clipNumber]: frameDataUrl,
                }
          );
        }
        await new Promise((r) => setTimeout(r, 80));
      }
    };

    const workerCount = Math.min(2, clipsToExtract.length);
    for (let i = 0; i < workerCount; i++) {
      void runWorker();
    }

    return () => {
      cancelled = true;
    };
  }, [missingFrameTargetsSignature, isPlaying, isEditorActive]);

  // Resolve Voiceover URL across masterAudioUrl, audioTracks, folderVoiceoverUrl, or pre-bundled TTS files
  const effectiveVoiceoverUrl = useMemo(() => {
    const norm = (u?: string) => {
      if (!u || typeof u !== 'string') return '';
      let t = rewriteMediaBridgeUrl(u.trim());
      if (/^\/?tts-files\/(.+)\.wav$/i.test(t)) {
        t = t.replace(/^\/?tts-files\/(.+)\.wav$/i, 'tts-files/$1.mp3');
      }
      if (t.startsWith('/tts-files/')) t = t.slice(1);
      if (
        (t.includes('tts-video-76-exodo-espanol') ||
          t.includes('Voz_Narrativa_Master_Video_76_Exodo_Espanol_Transatlantico')) &&
        !t.includes('v=leveled_v1')
      ) {
        t += (t.includes('?') ? '&' : '?') + 'v=leveled_v1';
      }
      return t;
    };

    const master = norm(activeDoc?.masterAudioUrl);
    if (folderVoiceoverUrl) {
      const folderUrl = norm(folderVoiceoverUrl);
      // A raw .wav in 02_Audio is several times heavier than the documentary's portable MP3 of the same voice and
      // has to travel through the tunnel on a phone, where it may never start. Prefer the registered MP3 then.
      let folderDecoded = folderUrl;
      try {
        folderDecoded = decodeURIComponent(folderUrl);
      } catch {}
      const folderIsRawWav = /\.wav(?:[?&#]|$)/i.test(folderDecoded);
      const masterIsPortableMp3 = /^(?:https?:\/\/[^/]+\/)?(?:[^?#]*\/)?tts-files\/[^?#]+\.mp3/i.test(master);
      if (!(folderIsRawWav && masterIsPortableMp3)) return folderUrl;
    }
    if (master && !master.startsWith('blob:')) return master;
    const firstNonBlobTrack = activeDoc?.audioTracks?.find(
      (t) => t.audioUrl && !t.audioUrl.startsWith('blob:')
    )?.audioUrl;
    if (firstNonBlobTrack) return norm(firstNonBlobTrack);

    const combinedText = `${activeDoc?.title || ''} ${activeDoc?.topic || ''} ${activeDoc?.downloadFolderName || ''} ${(activeDoc?.voiceoverScript || '').slice(0, 400)}`.toLowerCase();
    if (
      combinedText.includes('76') ||
      combinedText.includes('éxodo español') ||
      combinedText.includes('exodo espanol') ||
      combinedText.includes('maliaño, santander')
    ) {
      return 'tts-files/tts-video-76-exodo-espanol.mp3?v=leveled_v1';
    }
    if (
      combinedText.includes('74') ||
      combinedText.includes('princesas de la edad media') ||
      combinedText.includes('cortes reales de europa')
    ) {
      return 'tts-files/tts-1793103539750-763.mp3';
    }

    if (master) return master;
    const anyTrack = activeDoc?.audioTracks?.find((t) => t.audioUrl)?.audioUrl;
    if (anyTrack) return norm(anyTrack);
    return '';
  }, [
    activeDoc?.masterAudioUrl,
    activeDoc?.audioTracks,
    activeDoc?.title,
    activeDoc?.topic,
    activeDoc?.downloadFolderName,
    activeDoc?.voiceoverScript,
    folderVoiceoverUrl,
    mediaBridgeGen,
  ]);

  useEffect(() => {
    setVoiceAudioError(false);
  }, [effectiveVoiceoverUrl]);

  const fetchOfficialAssetsJson = async (
    endpointPath: string,
    init?: RequestInit,
    signal?: AbortSignal
  ): Promise<any | null> => {
    const bases = getOrderedMediaBridgeBases();
    for (const base of bases) {
      if (signal?.aborted) return null;
      const ctrl = new AbortController();
      const timeoutMs = getMediaBridgeCandidateTimeoutMs(base);
      const timer = window.setTimeout(() => ctrl.abort(), timeoutMs);
      const onParentAbort = () => ctrl.abort();
      signal?.addEventListener('abort', onParentAbort, { once: true });
      try {
        const res = await fetch(`${base}${endpointPath}`, {
          ...init,
          cache: 'no-store',
          signal: ctrl.signal,
        });
        if (!res.ok) {
          if (
            base &&
            /^https?:\/\//i.test(base) &&
            (res.status === 502 || res.status === 503 || res.status === 504 || res.status === 530)
          ) {
            const alive = await probeMediaBridgeOrigin(base, 3500).catch(() => false);
            if (!alive) {
              evictDeadMediaBridgeOrigin(base);
            }
          }
          continue;
        }
        const ctype = res.headers.get('content-type') || '';
        if (!ctype.includes('application/json')) continue;
        const data = await res.json().catch(() => null);
        if (!data) continue;
        if (base && /^https:\/\//i.test(base)) {
          persistDiscoveredMacTunnel(base);
        }
        return data;
      } catch {
        continue;
      } finally {
        window.clearTimeout(timer);
        signal?.removeEventListener('abort', onParentAbort);
      }
    }
    return null;
  };

  const isOfficialClipIdentity = (
    clip?: { id?: string | null; clipNumber?: number | null } | null
  ): boolean =>
    Boolean(
      clip &&
        (clip.id === 'fixed-doc-intro' ||
          clip.id === 'fixed-doc-outro' ||
          clip.clipNumber === 0 ||
          clip.clipNumber === 999)
    );

  const clearOfficialDeckErrorRetries = () => {
    const retryMap = deckErrorRetryRef.current;
    for (const key of Object.keys(retryMap)) {
      if (
        key.startsWith('0:') ||
        key.startsWith('999:') ||
        isOfficialAssetMedia(key) ||
        key.includes('official-intro') ||
        key.includes('official-outro')
      ) {
        delete retryMap[key];
      }
    }
    officialVideoRetryTimersRef.current.forEach((tid) => window.clearTimeout(tid));
    officialVideoRetryTimersRef.current.clear();
  };

  const applyOrDeferOfficialAssetsVersion = (nextVerRaw: unknown) => {
    const nextVer = Math.floor(Number(nextVerRaw) || 0);
    if (nextVer <= 0) return;
    const curClip = activeClipBoundsRef.current;
    const nxtClip = nextClipIdentityRef.current;
    const playingCurOfficial =
      isOfficialClipIdentity(curClip) ||
      activePlayingClipIdRef.current === 'fixed-doc-intro' ||
      activePlayingClipIdRef.current === 'fixed-doc-outro';
    const aboutToEnterOfficial =
      isOfficialClipIdentity(nxtClip) &&
      curClip !== null &&
      curClip.end - currentTimeRef.current <= 1.5;
    if (isPlayingRef.current && (playingCurOfficial || aboutToEnterOfficial)) {
      pendingOfficialAssetsVersionRef.current = nextVer;
      return;
    }
    pendingOfficialAssetsVersionRef.current = 0;
    if (nextVer !== appliedOfficialAssetsVersionRef.current) {
      if (nextVer > appliedOfficialAssetsVersionRef.current) {
        clearOfficialDeckErrorRetries();
      }
      appliedOfficialAssetsVersionRef.current = nextVer;
      setOfficialAssetsVersion((prev) => (prev === nextVer ? prev : nextVer));
    }
  };

  // Cleanup any pending asset retry timers on unmount
  useEffect(() => {
    return () => {
      officialVideoRetryTimersRef.current.forEach((tid) => window.clearTimeout(tid));
      officialVideoRetryTimersRef.current.clear();
    };
  }, []);

  // Load permanent official logo, intro, and asset hydration status reactively when Media Bridge updates
  useEffect(() => {
    let cancelled = false;
    const ac = new AbortController();
    let pollTimer: number | null = null;
    let pollTicks = 0;
    let lastCheckedTier = '';
    let statusRequestSeq = 0;
    let latestAppliedStatusSeq = 0;
    let rehydrateInFlight = false;
    let mountRehydrateAttempted = false;

    latestOfficialAssetsStatusRef.current = {
      loaded: false,
      hydrating: false,
      introTier: 'fallback',
      outroTier: 'fallback',
    };

    const normalizeOfficialTier = (
      rawTier: unknown
    ): 'icloud_hydrated' | 'custom_uploaded' | 'fallback' => {
      const val = String(rawTier || '');
      if (val === 'icloud_hydrated' || val === 'custom_uploaded') return val;
      return 'fallback';
    };

    const isOfficialTierReady = (tier: string): boolean =>
      tier === 'icloud_hydrated' || tier === 'custom_uploaded';

    const needsMorePolling = (): boolean => {
      const st = latestOfficialAssetsStatusRef.current;
      return (
        !st.loaded ||
        st.hydrating ||
        !isOfficialTierReady(st.introTier) ||
        !isOfficialTierReady(st.outroTier)
      );
    };

    const clearPollTimer = () => {
      if (pollTimer !== null) {
        window.clearTimeout(pollTimer);
        pollTimer = null;
      }
    };

    const loadStatusOnce = async (): Promise<boolean> => {
      const reqSeq = ++statusRequestSeq;
      const statusData = await fetchOfficialAssetsJson(
        '/api/assets/official-assets-status',
        undefined,
        ac.signal
      );
      if (cancelled) return false;
      if (!statusData) {
        return needsMorePolling();
      }
      if (reqSeq < latestAppliedStatusSeq) {
        return needsMorePolling();
      }
      latestAppliedStatusSeq = reqSeq;

      const introTier = normalizeOfficialTier(statusData.intro?.tier);
      const outroTier = normalizeOfficialTier(statusData.outro?.tier);
      const hydrating = Boolean(statusData.intro?.hydrating || statusData.outro?.hydrating);
      latestOfficialAssetsStatusRef.current = {
        loaded: true,
        hydrating,
        introTier,
        outroTier,
      };
      setOfficialIntroTier((prev) => (prev === introTier ? prev : introTier));
      setOfficialOutroTier((prev) => (prev === outroTier ? prev : outroTier));
      applyOrDeferOfficialAssetsVersion(statusData.version);

      const combinedTier = `${introTier}:${outroTier}`;
      if (combinedTier !== lastCheckedTier) {
        lastCheckedTier = combinedTier;
        const introMeta = await fetchOfficialAssetsJson(
          '/api/assets/official-intro',
          undefined,
          ac.signal
        );
        if (!cancelled && introMeta?.hasIntro && introMeta?.introUrl) {
          setOfficialIntroUrl(introMeta.introUrl);
          setOfficialIntroFileName(introMeta.fileName || 'Intro_Oficial_Huellas_8s.mp4');
        }
      }
      return needsMorePolling();
    };

    const maybeTriggerRehydrate = async () => {
      if (cancelled || rehydrateInFlight) return;
      if (typeof document !== 'undefined' && document.visibilityState !== 'visible') return;
      const st = latestOfficialAssetsStatusRef.current;
      if (st.loaded && isOfficialTierReady(st.introTier) && isOfficialTierReady(st.outroTier)) {
        return;
      }
      if (st.introTier !== 'fallback' && st.outroTier !== 'fallback') return;
      const now = Date.now();
      if (now - lastOfficialRehydrateAtRef.current < 15_000) return;
      lastOfficialRehydrateAtRef.current = now;
      rehydrateInFlight = true;
      try {
        await fetchOfficialAssetsJson(
          '/api/assets/official-assets-rehydrate',
          { method: 'POST' },
          ac.signal
        );
        if (!cancelled) {
          await loadStatusOnce();
        }
      } finally {
        rehydrateInFlight = false;
      }
    };

    const scheduleNextPoll = () => {
      clearPollTimer();
      if (cancelled || !needsMorePolling()) return;
      if (typeof document !== 'undefined' && document.visibilityState !== 'visible') return;
      const delayMs = pollTicks < 12 ? 4_000 : 12_000;
      pollTimer = window.setTimeout(async () => {
        pollTimer = null;
        if (cancelled) return;
        if (typeof document !== 'undefined' && document.visibilityState !== 'visible') return;
        pollTicks += 1;
        let stillNeedsPoll = await loadStatusOnce();
        if (
          !cancelled &&
          !mountRehydrateAttempted &&
          latestOfficialAssetsStatusRef.current.loaded
        ) {
          mountRehydrateAttempted = true;
          const st = latestOfficialAssetsStatusRef.current;
          if (st.introTier === 'fallback' || st.outroTier === 'fallback') {
            await maybeTriggerRehydrate();
            stillNeedsPoll = needsMorePolling();
          }
        }
        if (!cancelled && stillNeedsPoll) {
          scheduleNextPoll();
        }
      }, delayMs);
    };

    const handleVisibilityOrFocus = () => {
      if (cancelled) return;
      if (typeof document !== 'undefined' && document.visibilityState !== 'visible') return;
      if (!needsMorePolling()) return;
      const now = Date.now();
      if (now - lastOfficialStatusPollAtRef.current >= 1_500) {
        lastOfficialStatusPollAtRef.current = now;
        void (async () => {
          await loadStatusOnce();
          if (!cancelled) {
            await maybeTriggerRehydrate();
          }
          if (!cancelled && needsMorePolling()) {
            scheduleNextPoll();
          }
        })();
      } else if (pollTimer === null) {
        scheduleNextPoll();
      }
    };

    fetchOfficialAssetsStatusRef.current = async () => {
      await loadStatusOnce();
      if (!cancelled && needsMorePolling() && pollTimer === null) {
        scheduleNextPoll();
      }
    };

    window.addEventListener('focus', handleVisibilityOrFocus);
    document.addEventListener('visibilitychange', handleVisibilityOrFocus);

    void fetchOfficialAssetsJson('/api/assets/official-logo', undefined, ac.signal).then((data) => {
      if (cancelled || !data?.logoDataUrl) return;
      setOfficialLogoUrl(data.logoDataUrl);
      try {
        localStorage.setItem(PERMANENT_LOGO_STORAGE_KEY, data.logoDataUrl);
      } catch {}
      if (onOfficialLogoChange) onOfficialLogoChange(data.logoDataUrl);
    });

    void fetchOfficialAssetsJson('/api/assets/official-intro', undefined, ac.signal).then((data) => {
      if (cancelled || !data?.hasIntro || !data?.introUrl) return;
      setOfficialIntroUrl(data.introUrl);
      setOfficialIntroFileName(data.fileName || 'Intro_Oficial_Huellas_8s.mp4');
    });

    void (async () => {
      lastOfficialStatusPollAtRef.current = Date.now();
      await loadStatusOnce();
      if (!cancelled && latestOfficialAssetsStatusRef.current.loaded) {
        mountRehydrateAttempted = true;
        const st = latestOfficialAssetsStatusRef.current;
        if (st.introTier === 'fallback' || st.outroTier === 'fallback') {
          await maybeTriggerRehydrate();
        }
      }
      if (!cancelled && needsMorePolling()) {
        scheduleNextPoll();
      }
    })();

    return () => {
      cancelled = true;
      ac.abort();
      clearPollTimer();
      window.removeEventListener('focus', handleVisibilityOrFocus);
      document.removeEventListener('visibilitychange', handleVisibilityOrFocus);
    };
  }, [mediaBridgeGen]);

  // Save permanent official logo (One-time upload for all documentaries)
  const handleUploadPermanentLogo = (file: File) => {
    const reader = new FileReader();
    reader.onload = async () => {
      const dataUrl = typeof reader.result === 'string' ? reader.result : '';
      if (!dataUrl) return;
      setOfficialLogoUrl(dataUrl);
      localStorage.setItem(PERMANENT_LOGO_STORAGE_KEY, dataUrl);
      if (onOfficialLogoChange) onOfficialLogoChange(dataUrl);
      try {
        await fetchOfficialAssetsJson('/api/assets/official-logo', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ logoDataUrl: dataUrl }),
        });
      } catch {}
      setStatusMessage(
        '✅ Logo oficial de "Huellas de la Humanidad" guardado permanentemente para todos tus documentales.'
      );
    };
    reader.readAsDataURL(file);
  };

  // Save permanent official 4-second Intro Stinger video (One-time upload for all documentaries)
  const handleUploadPermanentIntro = (file: File) => {
    const reader = new FileReader();
    reader.onload = async () => {
      const dataUrl = typeof reader.result === 'string' ? reader.result : '';
      if (!dataUrl) return;
      try {
        const data = await fetchOfficialAssetsJson('/api/assets/official-intro', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ videoDataUrl: dataUrl, fileName: file.name }),
        });
        if (data?.ok && data.introUrl) {
          setOfficialIntroUrl(data.introUrl);
          setOfficialIntroFileName(file.name);
          setOfficialIntroTier('custom_uploaded');
          latestOfficialAssetsStatusRef.current = {
            ...latestOfficialAssetsStatusRef.current,
            loaded: true,
            introTier: 'custom_uploaded',
          };
          const nextVer = Math.floor(Number(data.version) || Date.now());
          pendingOfficialAssetsVersionRef.current = 0;
          clearOfficialDeckErrorRetries();
          appliedOfficialAssetsVersionRef.current = nextVer;
          setOfficialAssetsVersion(nextVer);
          setStatusMessage(
            `✅ Video de Intro Oficial "${file.name}" (4s) guardado permanentemente para todos tus documentales.`
          );
          return;
        }
      } catch {}
      const blobUrl = URL.createObjectURL(file);
      setOfficialIntroUrl(blobUrl);
      setOfficialIntroFileName(file.name);
      setStatusMessage(`✅ Video de Intro Oficial "${file.name}" cargado.`);
    };
    reader.readAsDataURL(file);
  };

  // Save permanent official Outro video (One-time upload for all documentaries)
  const handleUploadPermanentOutro = (file: File) => {
    const reader = new FileReader();
    reader.onload = async () => {
      const dataUrl = typeof reader.result === 'string' ? reader.result : '';
      if (!dataUrl) return;
      try {
        const data = await fetchOfficialAssetsJson('/api/assets/official-outro', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ videoDataUrl: dataUrl, fileName: file.name }),
        });
        if (data?.ok) {
          setOfficialOutroFileName(file.name);
          setOfficialOutroTier('custom_uploaded');
          latestOfficialAssetsStatusRef.current = {
            ...latestOfficialAssetsStatusRef.current,
            loaded: true,
            outroTier: 'custom_uploaded',
          };
          const nextVer = Math.floor(Number(data.version) || Date.now());
          pendingOfficialAssetsVersionRef.current = 0;
          clearOfficialDeckErrorRetries();
          appliedOfficialAssetsVersionRef.current = nextVer;
          setOfficialAssetsVersion(nextVer);
          setStatusMessage(
            `✅ Video de Outro Oficial "${file.name}" guardado permanentemente para todos tus documentales.`
          );
          return;
        }
      } catch {}
      setStatusMessage(`❌ No se pudo guardar el Outro Oficial "${file.name}". Verifica la conexión local.`);
    };
    reader.readAsDataURL(file);
  };

  const isVideo76Doc = useMemo(() => {
    const combined = `${effectiveVoiceoverUrl || ''} ${activeDoc?.title || ''} ${activeDoc?.topic || ''} ${activeDoc?.downloadFolderName || ''} ${(activeDoc?.voiceoverScript || '').slice(0, 400)}`.toLowerCase();
    return (
      combined.includes('tts-video-76-exodo-espanol') ||
      combined.includes('video_76') ||
      combined.includes('video 76') ||
      combined.includes('éxodo español') ||
      combined.includes('exodo espanol') ||
      combined.includes('maliaño, santander')
    );
  }, [
    effectiveVoiceoverUrl,
    activeDoc?.title,
    activeDoc?.topic,
    activeDoc?.downloadFolderName,
    activeDoc?.voiceoverScript,
  ]);

  const effectiveVoiceDurationSec = useMemo(() => {
    if (voiceDurationSec > 1) return voiceDurationSec;
    if (isVideo76Doc) return 890.88;
    if (effectiveVoiceoverUrl.includes('tts-1793103539750-763')) return 739.76;
    const trackDur = Number(activeDoc?.audioTracks?.[0]?.duration || 0);
    if (trackDur > 1) return trackDur;
    return 0;
  }, [voiceDurationSec, activeDoc?.audioTracks, effectiveVoiceoverUrl, isVideo76Doc]);

  useEffect(() => {
    setDetectedSloganSplitSec(null);
  }, [activeDoc?.id, effectiveVoiceoverUrl]);

  // Exact audio second (relative to 0.0s of Voiceover MP3) where the opening Slogan Completo ("...Aquí seguimos sus rastros.") ends
  const sloganSplitAudioSec = useMemo(() => {
    if (isVideo76Doc) {
      // In tts-video-76-exodo-espanol.mp3, "Aquí seguimos sus rastros." ends at 67.66s and "Para comprender la raíz..." starts at 69.89s
      return 68.5;
    }
    if (
      typeof detectedSloganSplitSec === 'number' &&
      Number.isFinite(detectedSloganSplitSec) &&
      detectedSloganSplitSec > 5
    ) {
      return detectedSloganSplitSec;
    }
    const rawScript = (activeDoc?.voiceoverScript || '').trim();
    if (rawScript && effectiveVoiceDurationSec > 20) {
      const norm = rawScript
        .toLowerCase()
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '');
      const idxRastros = norm.indexOf('seguimos sus rastros');
      const idxHuella = norm.indexOf('deja una huella');
      const matchIdx =
        idxRastros > 0 && idxRastros < 1800
          ? idxRastros + 'seguimos sus rastros.'.length
          : idxHuella > 0 && idxHuella < 1800
          ? idxHuella + 'deja una huella.'.length
          : -1;
      if (matchIdx > 0) {
        const cleanBefore = stripPauseTags(rawScript.slice(0, matchIdx)).trim();
        const cleanAll = stripPauseTags(rawScript).trim();
        if (cleanAll.length > 50) {
          const wBefore = Math.max(1, spokenSpanishSyllableWeight(cleanBefore));
          const wAll = Math.max(1, spokenSpanishSyllableWeight(cleanAll));
          const estSec = (wBefore / wAll) * effectiveVoiceDurationSec + 0.6;
          return Number(Math.max(18, Math.min(110, estSec)).toFixed(3));
        }
      }
    }
    return 68.5;
  }, [
    isVideo76Doc,
    detectedSloganSplitSec,
    activeDoc?.voiceoverScript,
    effectiveVoiceDurationSec,
  ]);

  // Helper: scale a list of timeline clips to an exact target span (in seconds) using cumulative boundary rounding so zero rounding drift ever crushes or bloats the final clip (Clip 82)
  const scaleClipsToExactSpan = (items: TimelineClipItem[], targetSpanSec: number, protectClosingClip = false) => {
    if (items.length === 0 || targetSpanSec <= 0) return;
    const { standardClipSec: stdDur } = getStage1ClipDurations(activeDoc);
    const avgTarget = targetSpanSec / items.length;
    const weights = items.map((it, idx) => {
      const d = Number(it.duration) || stdDur;
      const srcDur = Number(it.sourceDuration) || stdDur;
      const tStart = Number(it.trimStart) || 0;
      const tEnd = typeof it.trimEnd === 'number' && it.trimEnd > tStart + 0.1 ? it.trimEnd : srcDur;
      const hasCustomShortTrim = tStart > 0.05 || tEnd < srcDur - 0.15;
      // Heal closing clip or any untrimmed clip that was previously crushed (< 9.5s) or bloated (> 13.5s) so Voz Narrativa stays 100% aligned
      if (
        protectClosingClip &&
        (d > Math.max(13.5, avgTarget * 1.25) ||
          (!hasCustomShortTrim && d < Math.min(9.5, avgTarget * 0.88)) ||
          (idx === items.length - 1 && d < Math.min(9.5, avgTarget * 0.88)))
      ) {
        return Math.max(stdDur, avgTarget);
      }
      return Math.max(2, d);
    });
    const totalWeight = weights.reduce((a, b) => a + b, 0);
    if (totalWeight <= 0) return;

    let cumWeight = 0;
    let prevRoundedSec = 0;
    items.forEach((it, idx) => {
      cumWeight += weights[idx];
      const exactCumSec =
        idx === items.length - 1 ? targetSpanSec : (cumWeight / totalWeight) * targetSpanSec;
      const roundedCumSec = Number(exactCumSec.toFixed(2));
      const clipDur = Number(Math.max(1.5, roundedCumSec - prevRoundedSec).toFixed(2));
      prevRoundedSec = Number((prevRoundedSec + clipDur).toFixed(2));
      it.duration = clipDur;
      it.originalSlotDuration = clipDur;
    });
  };

  // Build & align Track 3 clips for either Opción A (INTRO_INICIO_00: 00:00-00:08) or Opción B (INTRO_POST_SLOGAN: right after Slogan Completo without cutting any clip)
  const buildAlignedTimelineClipsForIntroMode = (
    rawClipsInput: TimelineClipItem[],
    mode: 'INTRO_POST_SLOGAN' | 'INTRO_INICIO_00',
    fixedIntroClip: TimelineClipItem,
    fixedOutroClip?: TimelineClipItem | null
  ): TimelineClipItem[] => {
    const allScriptClips = activeDoc?.clips || [];
    const hasStage6ScriptClips = allScriptClips.length > 0;
    const validScriptClipNums = new Set(
      allScriptClips
        .filter(
          (sc, idx) =>
            sc &&
            typeof sc.clipNumber === 'number' &&
            sc.clipNumber > 0 &&
            !(
              idx === allScriptClips.length - 1 &&
              !sc.videoReady &&
              !sc.reviewedForEditor &&
              (Boolean(sc.videoDiscardedAt) ||
                /^(?:sus\s+)?rastros\.?$/i.test(String(sc.narrationSegment || '').trim()))
            )
        )
        .map((sc) => sc.clipNumber)
    );

    // 1. Strip existing intro, outro, phantom clips outside validScriptClipNums, and any previously split partB slogan clip; restore partA to full clip
    const cleanBody: TimelineClipItem[] = [];
    for (const c of rawClipsInput) {
      if (
        c.id === 'fixed-doc-intro' ||
        c.id.startsWith('official_intro_') ||
        c.clipNumber === 0 ||
        c.id === 'fixed-doc-outro' ||
        c.clipNumber === 999 ||
        c.id.endsWith('-slogan-partB')
      ) {
        continue;
      }
      if (
        hasStage6ScriptClips &&
        c.clipNumber > 0 &&
        !validScriptClipNums.has(c.clipNumber)
      ) {
        continue;
      }
      if (c.id.endsWith('-slogan-partA')) {
        const fullSrcDur = c.sourceDuration && c.sourceDuration > 6 ? c.sourceDuration : 7.85;
        cleanBody.push({
          ...c,
          id: c.id.replace(/-slogan-partA$/, ''),
          trimStart: 0,
          trimEnd: fullSrcDur,
          partLabel: undefined,
        });
      } else {
        cleanBody.push({ ...c });
      }
    }

    if (cleanBody.length === 0) {
      if (hasStage6ScriptClips) {
        return [];
      }
      return fixedOutroClip ? [fixedIntroClip, fixedOutroClip] : [fixedIntroClip];
    }

    const uniqueReviewedBodyNums = new Set(
      cleanBody
        .filter((c) => c.clipNumber > 0 && c.clipNumber < 999)
        .map((c) => c.clipNumber)
    );
    const expectedBodySlotCount = hasStage6ScriptClips ? validScriptClipNums.size : 0;
    const isFullScheduleReviewed =
      !hasStage6ScriptClips || uniqueReviewedBodyNums.size >= expectedBodySlotCount;
    const effectiveOutroClip = fixedOutroClip ?? null;

    // Ensure Clip 1 (all parts with clipNumber === 1) covers its exact Stage 1 visual duration (e.g. 6s in VOZ_EN_CLIP_2)
    // Never kidnap Clip 2+ into the silent Hook slot when Clip 1 has not been marked reviewed yet
    const {
      clip1Sec: c1Base,
      standardClipSec: stdDur,
      voiceEntrySec,
    } = getStage1ClipDurations(activeDoc);
    const targetHookSec = !c1Base || c1Base <= 0 ? 6 : c1Base;
    const hasClip1 = cleanBody.some((c) => c.clipNumber === 1);
    let firstNarratedIdx = hasClip1 ? cleanBody.findIndex((c) => c.clipNumber > 1) : 0;
    if (hasClip1 && firstNarratedIdx < 0) {
      firstNarratedIdx = cleanBody.length;
    }
    const clip1Slice = cleanBody.slice(0, firstNarratedIdx);
    if (clip1Slice.length > 0) {
      const clip1Sum = clip1Slice.reduce((acc, c) => acc + (c.duration || targetHookSec), 0);
      if (Math.abs(clip1Sum - targetHookSec) > 0.05) {
        scaleClipsToExactSpan(clip1Slice, targetHookSec, false);
      }
    }
    const actualClip1SpanSec = clip1Slice.reduce(
      (acc, c) => acc + (Number(c.duration) || targetHookSec),
      0
    );

    // 2. Locate the exact clip in the opening section (Clips 2..15) where the Slogan Completo ("Aquí seguimos sus rastros.") ends
    let sloganClipIdx = -1;
    const searchLimit = Math.min(cleanBody.length, firstNarratedIdx + 14);
    for (let i = firstNarratedIdx; i < searchLimit; i++) {
      const c = cleanBody[i];
      if (hasStage6ScriptClips && c.clipNumber > 15) break;
      let decodedUrl = '';
      try {
        decodedUrl = decodeURIComponent(c.videoUrl || '');
      } catch {
        decodedUrl = c.videoUrl || '';
      }
      const haystack = `${c.narrationSegment || ''} ${c.videoPrompt || ''} ${c.fileName || ''} ${decodedUrl}`
        .toLowerCase()
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '');
      if (
        c.clipNumber === 7 ||
        haystack.includes('seguimos sus rastros') ||
        haystack.includes('seguimos_sus_rastros') ||
        haystack.includes('historia deja una huella') ||
        haystack.includes('historia_deja_una_huella') ||
        haystack.includes('suscribete_cada_historia')
      ) {
        sloganClipIdx = i;
        break;
      }
    }
    if (sloganClipIdx < firstNarratedIdx && isFullScheduleReviewed) {
      if (isVideo76Doc && cleanBody.length > firstNarratedIdx + 5) {
        sloganClipIdx = firstNarratedIdx + 5; // Clip 7
      } else if (cleanBody.length > firstNarratedIdx) {
        let cum = 0;
        let bestIdx = Math.min(firstNarratedIdx + 5, cleanBody.length - 1);
        let bestDiff = Infinity;
        for (let i = firstNarratedIdx; i < searchLimit; i++) {
          cum += cleanBody[i].duration || 10;
          const diff = Math.abs(cum - sloganSplitAudioSec);
          if (diff < bestDiff) {
            bestDiff = diff;
            bestIdx = i;
          }
        }
        sloganClipIdx = Math.max(firstNarratedIdx, bestIdx);
      }
    }

    // 3. Align durations of pre-slogan and post-slogan narrated clips so the closing clip (e.g. Clip 142) and final slogan finish together right before the Outro.
    // Only execute scaleClipsToExactSpan when 100% of script slots are present (isFullScheduleReviewed), keeping partial schedules at natural clip durations.
    const targetVoiceDur =
      effectiveVoiceDurationSec > 20
        ? Number((effectiveVoiceDurationSec + (isVideo76Doc ? 1.2 : 0)).toFixed(2))
        : 0;
    if (mode === 'INTRO_POST_SLOGAN') {
      if (sloganClipIdx < firstNarratedIdx) {
        // Partial review where the Slogan clip is not reviewed yet: place Intro after any opening clips (<= 7), or at start if only clips > 7 exist
        const preOpening = cleanBody
          .slice(firstNarratedIdx)
          .filter((c) => c.clipNumber > 1 && c.clipNumber <= 7);
        const postOpening = cleanBody
          .slice(firstNarratedIdx)
          .filter((c) => !(c.clipNumber > 1 && c.clipNumber <= 7));
        if (clip1Slice.length === 0 && preOpening.length === 0) {
          return [
            fixedIntroClip,
            ...postOpening,
            ...(effectiveOutroClip ? [effectiveOutroClip] : []),
          ];
        }
        return [
          ...clip1Slice,
          ...preOpening,
          fixedIntroClip,
          ...postOpening,
          ...(effectiveOutroClip ? [effectiveOutroClip] : []),
        ];
      }

      const sloganClip = cleanBody[sloganClipIdx];
      // In Video 76, Clip 7 (7.85s MP4) has Shot 1 (0s-4.28s: Historian's Desk for Slogan) and Shot 2 (4.36s-7.85s: Asturias Mountains for Chapter 1)
      const isVid76TwoShotClip7 = Boolean(
        isVideo76Doc && sloganClip && sloganClip.clipNumber === 7 && !sloganClip.parentGroupId
      );

      if (isVid76TwoShotClip7 && sloganClip) {
        const partA: TimelineClipItem = {
          ...sloganClip,
          id: `${sloganClip.id}-slogan-partA`,
          sourceDuration: 7.85,
          trimStart: 0,
          trimEnd: 4.28,
          speed: 1,
          partLabel: 'Slogan (Mesa)',
          narrationSegment:
            'suscríbete. Cada historia deja una huella. Aquí seguimos sus rastros.',
        };
        const partB: TimelineClipItem = {
          ...sloganClip,
          id: `${sloganClip.id}-slogan-partB`,
          sourceDuration: 7.85,
          trimStart: 4.36,
          trimEnd: 7.85,
          duration: 8.8,
          originalSlotDuration: 8.8,
          speed: 1,
          partLabel: 'Cap. 1 (Asturias)',
          narrationSegment:
            'Para comprender la raíz de esta marea humana es necesario adentrarse en las montañas',
        };

        const preClips = [...cleanBody.slice(firstNarratedIdx, sloganClipIdx), partA];
        const postClips = [partB, ...cleanBody.slice(sloganClipIdx + 1)];

        if (isFullScheduleReviewed && targetVoiceDur > sloganSplitAudioSec + 10) {
          scaleClipsToExactSpan(preClips, sloganSplitAudioSec, false);
          const remAfterPartB = Math.max(10, targetVoiceDur - sloganSplitAudioSec - partB.duration);
          const restPost = postClips.slice(1);
          scaleClipsToExactSpan(restPost, remAfterPartB, true);
        }

        const assembled = [
          ...clip1Slice,
          ...preClips,
          fixedIntroClip,
          ...postClips,
          ...(effectiveOutroClip ? [effectiveOutroClip] : []),
        ];
        return assembled;
      }

      // Standard single-shot Slogan clip in Opción B: align Clips 2..sloganClipIdx to sloganSplitAudioSec when schedule is complete, then insert fixedIntroClip
      const preClips = cleanBody.slice(firstNarratedIdx, sloganClipIdx + 1);
      const postClips = cleanBody.slice(sloganClipIdx + 1);
      if (isVideo76Doc && isFullScheduleReviewed && targetVoiceDur > sloganSplitAudioSec + 10 && preClips.length > 0) {
        scaleClipsToExactSpan(preClips, sloganSplitAudioSec, false);
        const remVoiceDur = Math.max(10, targetVoiceDur - sloganSplitAudioSec);
        scaleClipsToExactSpan(postClips, remVoiceDur, true);
      } else if (!isVideo76Doc) {
        [...preClips, ...postClips].forEach((it) => {
          const hasManualEdit = (it.trimStart && it.trimStart > 0.05) || (it.speed && it.speed !== 1) || it.partLabel;
          const isPollutedDur =
            it.duration === 5.65 ||
            (typeof it.duration === 'number' &&
              (Math.abs(it.duration - 5.58) < 0.08 ||
                Math.abs(it.duration - 5.66) < 0.05 ||
                Math.abs(it.duration - 10.45) < 0.05));
          if (!hasManualEdit || isPollutedDur) {
            it.duration = stdDur;
            it.originalSlotDuration = stdDur;
          }
        });
        if (
          isFullScheduleReviewed &&
          effectiveVoiceDurationSec > sloganSplitAudioSec + 10 &&
          postClips.length > 0
        ) {
          const preNaturalSpan = preClips.reduce(
            (acc, it) => acc + (Number(it.duration) || stdDur),
            0
          );
          const postTargetSpan = Number(
            Math.max(
              postClips.length * 2,
              voiceEntrySec + effectiveVoiceDurationSec - actualClip1SpanSec - preNaturalSpan
            ).toFixed(2)
          );
          scaleClipsToExactSpan(postClips, postTargetSpan, false);
        }
      }

      return [
        ...clip1Slice,
        ...preClips,
        fixedIntroClip,
        ...postClips,
        ...(effectiveOutroClip ? [effectiveOutroClip] : []),
      ];
    }

    // Opción A (INTRO_INICIO_00): Fixed 8s Intro at 00:00 - 00:08, Clip 1 at 00:08 - 00:14, Narrated Clips 2..N aligned so final clip ends right with the voiceover slogan before Outro
    if (!isVideo76Doc) {
      const narratedClips = cleanBody.slice(firstNarratedIdx);
      narratedClips.forEach((it) => {
        const hasManualEdit = (it.trimStart && it.trimStart > 0.05) || (it.speed && it.speed !== 1) || it.partLabel;
        const isPollutedDur =
          it.duration === 5.65 ||
          (typeof it.duration === 'number' &&
            (Math.abs(it.duration - 5.58) < 0.08 ||
              Math.abs(it.duration - 5.66) < 0.05 ||
              Math.abs(it.duration - 10.45) < 0.05));
        if (!hasManualEdit || isPollutedDur) {
          it.duration = stdDur;
          it.originalSlotDuration = stdDur;
        }
      });
      if (isFullScheduleReviewed && effectiveVoiceDurationSec > 20 && narratedClips.length > 0) {
        const introDurSec = Number(fixedIntroClip.duration) || 8;
        const voiceTimelineEndSec = introDurSec + voiceEntrySec + effectiveVoiceDurationSec;
        const exactNarratedSpanSec = Number(
          Math.max(
            narratedClips.length * 2,
            voiceTimelineEndSec - (introDurSec + actualClip1SpanSec)
          ).toFixed(2)
        );
        scaleClipsToExactSpan(narratedClips, exactNarratedSpanSec, false);
      }
    } else if (isFullScheduleReviewed && targetVoiceDur > 10 && cleanBody.length > firstNarratedIdx) {
      if (
        sloganClipIdx >= firstNarratedIdx &&
        cleanBody[sloganClipIdx]?.clipNumber === 7 &&
        cleanBody.length > sloganClipIdx + 1
      ) {
        // Lock Clips 2..7 to end at 77.30s of audio (so Clip 7's internal 4.33s shot cut lands right at 68.5s after the Slogan!)
        const preTarget = 77.3;
        const preClips = cleanBody.slice(firstNarratedIdx, sloganClipIdx + 1);
        const postClips = cleanBody.slice(sloganClipIdx + 1);
        scaleClipsToExactSpan(preClips, preTarget, false);
        const remTarget = Math.max(10, targetVoiceDur - preTarget);
        scaleClipsToExactSpan(postClips, remTarget, true);
      } else {
        const narratedClips = cleanBody.slice(firstNarratedIdx);
        scaleClipsToExactSpan(narratedClips, targetVoiceDur, true);
      }
    }

    return [
      fixedIntroClip,
      ...cleanBody,
      ...(effectiveOutroClip ? [effectiveOutroClip] : []),
    ];
  };

  // Insert the 8-second Official Intro (Intro.mp4) into Track 3 (either at 00:00 - 00:08 by default, or Post-Slogan right after "Aquí seguimos sus rastros.")
  const handleInsertOfficialIntroInTimeline = (
    mode: 'INTRO_POST_SLOGAN' | 'INTRO_INICIO_00' = introPlacementMode
  ) => {
    const docId = activeDoc?.id || 'default';
    setIntroPlacementMode(mode);
    lastSyncedIntroPlacementRef.current = mode;
    if (activeDoc && activeDoc.promptConfig?.UBICACION_INTRO_MARCA !== mode) {
      updateActiveDoc({
        promptConfig: {
          ...(activeDoc.promptConfig || {}),
          UBICACION_INTRO_MARCA: mode,
        },
      });
    }

    const {
      introVideoUrl: defaultIntro8kUrl,
      introPosterUrl,
      outroVideoUrl,
      outroPosterUrl,
    } = buildOfficialIntroOutroUrls(officialAssetsVersion);
    const effectiveIntroUrl =
      (officialIntroUrl
        ? rewriteMediaBridgeUrl(appendOfficialAssetVersion(officialIntroUrl, officialAssetsVersion))
        : '') || defaultIntro8kUrl;

    const introClipItem: TimelineClipItem = {
      id: 'fixed-doc-intro',
      clipNumber: 0,
      fileName: '00_Intro_Huellas_de_la_Humanidad_8K.mp4',
      duration: 8,
      sourceDuration: 8,
      originalSlotDuration: 8,
      speed: 1,
      foleyVolume: 100,
      audioFadeInSec: 1.5,
      audioFadeOutSec: 5,
      transition: 'crossfade',
      videoUrl: effectiveIntroUrl,
      posterUrl: introPosterUrl || officialLogoUrl || undefined,
      narrationSegment:
        mode === 'INTRO_INICIO_00'
          ? '🎬 INTRO OFICIAL (00:00 - 00:08 • Audio Fade In 1.5s + Fade Out 5s) — Huellas de la Humanidad (8K)'
          : '🎬 INTRO OFICIAL POST-SLOGAN (8s tras "Aquí seguimos sus rastros." • Audio Fade In 1.5s + Fade Out 5s) — Huellas de la Humanidad (8K)',
      trimStart: 0,
      trimEnd: 8,
      smoothSlowMo: false,
      reviewedForEditor: true,
    };

    const outroClipItem: TimelineClipItem = {
      id: 'fixed-doc-outro',
      clipNumber: 999,
      fileName: 'Outro_Huellas_de_la_Humanidad_8K_FadeOut.mp4',
      narrationSegment:
        '🎬 OUTRO OFICIAL (8s • Crossfade + Audio Fade In 1.5s + Fade Out 2.5s) — Huellas de la Humanidad (8K)',
      duration: 8,
      sourceDuration: 8,
      speed: 1,
      trimStart: 0,
      trimEnd: 8,
      smoothSlowMo: false,
      originalSlotDuration: 8,
      foleyVolume: 100,
      audioFadeInSec: 1.5,
      audioFadeOutSec: 2.5,
      transition: 'crossfade',
      videoUrl: outroVideoUrl,
      posterUrl: outroPosterUrl || officialLogoUrl || undefined,
      reviewedForEditor: true,
    };

    setTimelineClips((prev) => {
      const nextClips = buildAlignedTimelineClipsForIntroMode(
        prev,
        mode,
        introClipItem,
        outroClipItem
      );
      persistDocOverlaysPatch({ customTimelineClips: nextClips }, docId);
      return nextClips;
    });

    const { clip1Sec, voiceEntrySec } = getStage1ClipDurations(activeDoc);
    const clip1VisualDur = !clip1Sec || clip1Sec <= 0 ? 6 : clip1Sec;
    const baseHookSec = voiceEntrySec;
    const nextVoiceOffset = mode === 'INTRO_INICIO_00' ? baseHookSec + 8 : baseHookSec;

    setVoiceStartOffsetSec(nextVoiceOffset);
    if (mode === 'INTRO_INICIO_00') {
      setHookLine1StartSec(8);
      setHookLine2StartSec(10);
      setClip1OverlayEndSec(clip1VisualDur + 8);
      setStatusMessage(
        '✅ Intro Oficial (8s — Intro.mp4) ubicado en 00:00 - 00:08 (Opción A) y subtítulos sincronizados al 100% desde 00:16.'
      );
    } else {
      setHookLine1StartSec(0);
      setHookLine2StartSec(2);
      setClip1OverlayEndSec(clip1VisualDur);
      setStatusMessage(
        '✅ Intro Oficial (8s — Intro.mp4) ubicado exactamente después del Slogan Completo ("Aquí seguimos sus rastros.") sin cortar ningún clip.'
      );
    }

    setCaptions((prevCaps) => {
      if (!prevCaps || prevCaps.length === 0) return prevCaps;
      const aligned = alignCaptionsToIntroPlacement(
        prevCaps,
        mode,
        baseHookSec,
        8,
        sloganSplitAudioSec
      );
      persistDocOverlaysPatch(
        { captions: aligned, voiceStartOffsetSec: nextVoiceOffset },
        docId
      );
      return aligned;
    });
  };

  // Detected acoustic silences from the real Voiceover MP3/WAV waveform
  const detectedAudioSilencesRef = useRef<Array<{ start: number; end: number; dur: number }>>([]);
  const decodedSilenceUrlRef = useRef<string>('');

  // Sync tracks from activeDoc whenever documentary changes or user clicks "Sincronizar"
  const syncTracksFromDocumentary = () => {
    if (!activeDoc) return;

    const docId = activeDoc.id || 'default';
    const isDocSwitch = lastSyncedDocIdRef.current !== docId;
    lastSyncedDocIdRef.current = docId;
    const savedDocOverlays = readSavedDocOverlays(docId);
    // Media of this documentary only: drops URLs that point into another documentary's folder
    const ownMedia = (u?: string | null | false): string =>
      u && !isMediaUrlFromOtherDocumentary(u, activeDoc) ? u : '';

    const FIXED_INTRO_SEC = 8;
    const FIXED_OUTRO_SEC = 8;
    const docIntroPlacement =
      activeDoc.promptConfig?.UBICACION_INTRO_MARCA === 'INTRO_POST_SLOGAN'
        ? 'INTRO_POST_SLOGAN'
        : 'INTRO_INICIO_00';
    const isIntroPlacementSwitch = lastSyncedIntroPlacementRef.current !== docIntroPlacement;
    lastSyncedIntroPlacementRef.current = docIntroPlacement;

    const { clip1Sec: c1BaseDur, standardClipSec: standardDur, voiceEntrySec } = getStage1ClipDurations(activeDoc);
    const clip1VisualDur = !c1BaseDur || c1BaseDur <= 0 ? 6 : c1BaseDur;
    const clip1HookDur = voiceEntrySec;
    // Opción A (default INTRO_INICIO_00): Fixed 8s Intro (00:00 - 00:08) -> Clip 1 Hook (00:08 - 00:14) -> Voiceover at 16s
    // Opción B (INTRO_POST_SLOGAN): Clip 1 Hook (00:00 - 00:08) -> Voiceover at 8s, and 8s Intro enters Post-Slogan right after "Aquí seguimos sus rastros."
    const entrySec =
      docIntroPlacement === 'INTRO_POST_SLOGAN' ? clip1HookDur : FIXED_INTRO_SEC + clip1HookDur;
    const defaultOverlayEnd =
      docIntroPlacement === 'INTRO_POST_SLOGAN' ? clip1VisualDur : FIXED_INTRO_SEC + clip1VisualDur;

    if (savedDocOverlays?.userEditedHook) {
      userEditedHookDocIdRef.current = docId;
      if (isDocSwitch) {
        if (typeof savedDocOverlays.clip1Line1 === 'string') {
          setClip1Line1(savedDocOverlays.clip1Line1);
        }
        if (typeof savedDocOverlays.clip1Line2 === 'string') {
          setClip1Line2(savedDocOverlays.clip1Line2);
        }
      }
    } else if (isDocSwitch || userEditedHookDocIdRef.current !== docId) {
      const defaultLine1 = normalizeClip1Line1Format(
        activeDoc.clip1Line1LocationTime ||
          [activeDoc.historicalLocation, activeDoc.historicalTime].filter(Boolean).join(', ')
      );
      const defaultLine2 = activeDoc.clip1Line2Hook || activeDoc.title || '';
      setClip1Line1((prev) => (isDocSwitch || !prev ? defaultLine1 : prev));
      setClip1Line2((prev) => (isDocSwitch || !prev ? defaultLine2 : prev));
    }

    if (isDocSwitch || isIntroPlacementSwitch) {
      setIntroPlacementMode(docIntroPlacement);
      let savedGlobalStyles: Record<string, any> = {};
      try {
        const rawGlobal = localStorage.getItem('huellas_editor_overlay_styles_v1');
        if (rawGlobal) savedGlobalStyles = JSON.parse(rawGlobal);
      } catch {}

      const defaultL1Start = docIntroPlacement === 'INTRO_POST_SLOGAN' ? 0 : FIXED_INTRO_SEC;
      const defaultL2Start = docIntroPlacement === 'INTRO_POST_SLOGAN' ? 2 : FIXED_INTRO_SEC + 2;

      const resolvedL1Start =
        typeof savedDocOverlays?.hookLine1StartSec === 'number'
          ? savedDocOverlays.hookLine1StartSec
          : !isIntroPlacementSwitch && typeof savedGlobalStyles.hookLine1StartSec === 'number'
          ? savedGlobalStyles.hookLine1StartSec
          : defaultL1Start;

      const resolvedL2Start =
        typeof savedDocOverlays?.hookLine2StartSec === 'number'
          ? savedDocOverlays.hookLine2StartSec
          : !isIntroPlacementSwitch && typeof savedGlobalStyles.hookLine2StartSec === 'number'
          ? savedGlobalStyles.hookLine2StartSec
          : defaultL2Start;

      const resolvedOverlayEnd =
        typeof savedDocOverlays?.clip1OverlayEndSec === 'number' &&
        savedDocOverlays.clip1OverlayEndSec > 0
          ? savedDocOverlays.clip1OverlayEndSec
          : !isIntroPlacementSwitch &&
            typeof savedGlobalStyles.clip1OverlayEndSec === 'number' &&
            savedGlobalStyles.clip1OverlayEndSec > 0
          ? savedGlobalStyles.clip1OverlayEndSec
          : defaultOverlayEnd;

      setHookLine1StartSec(resolvedL1Start);
      setHookLine2StartSec(resolvedL2Start);
      setClip1OverlayEndSec(resolvedOverlayEnd);
      setVoiceStartOffsetSec(entrySec);
    }

    const { introVideoUrl, introPosterUrl, outroVideoUrl, outroPosterUrl } =
      buildOfficialIntroOutroUrls(officialAssetsVersion);
    const resolvedIntroVideoUrl =
      (officialIntroUrl
        ? rewriteMediaBridgeUrl(appendOfficialAssetVersion(officialIntroUrl, officialAssetsVersion))
        : '') || introVideoUrl;
    const resolvedIntroPosterUrl =
      (officialIntroTier !== 'fallback'
        ? introPosterUrl || rewriteMediaBridgeUrl(firstFrameByClip[0] || '')
        : rewriteMediaBridgeUrl(firstFrameByClip[0] || '') || introPosterUrl) ||
      officialLogoUrl ||
      undefined;
    const resolvedOutroPosterUrl =
      (officialOutroTier !== 'fallback'
        ? outroPosterUrl || rewriteMediaBridgeUrl(firstFrameByClip[999] || '')
        : rewriteMediaBridgeUrl(firstFrameByClip[999] || '') || outroPosterUrl) ||
      officialLogoUrl ||
      undefined;

    // 1. Build Clips Track (Track 3) — El timeline conserva la cuadrícula completa de TODOS los clips del guion (1..N).
    // Los clips no revisados conservan su ranura de tiempo (8s/10s) y se quedan vacíos, sin colapsar hacia la izquierda
    // ni rellenar el espacio de otros clips, preservando la sincronía 1:1 absoluta con la voz narrativa.
    const rawAllDocClips = activeDoc.clips || [];
    const allDocClips = rawAllDocClips.filter(
      (sc, idx) =>
        sc &&
        typeof sc.clipNumber === 'number' &&
        sc.clipNumber > 0 &&
        !(
          idx === rawAllDocClips.length - 1 &&
          !sc.videoReady &&
          !sc.reviewedForEditor &&
          (Boolean(sc.videoDiscardedAt) ||
            /^(?:sus\s+)?rastros\.?$/i.test(String(sc.narrationSegment || '').trim()))
        )
    );
    const hasStage6ScriptClips = allDocClips.length > 0;
    const reviewedClips = allDocClips
      .filter((c) => Boolean(c.reviewedForEditor))
      .sort((a, b) => a.clipNumber - b.clipNumber);
    const docClips = allDocClips.slice().sort((a, b) => a.clipNumber - b.clipNumber);
    const allStage6Nums = new Set(allDocClips.map((c) => c.clipNumber));
    const reviewedSet = new Set(reviewedClips.map((c) => c.clipNumber));
    const isSyncFullScheduleReviewed =
      !hasStage6ScriptClips || reviewedSet.size >= allDocClips.length;

    const getUrlTimestampMs = (u?: string): number => {
      if (!u) return 0;
      let maxTs = 0;
      const matches = u.matchAll(/[?&](?:v|r|t)=(\d{10,})/g);
      for (const m of matches) {
        const val = Number(m[1]);
        if (Number.isFinite(val) && val > maxTs) maxTs = val;
      }
      return maxTs;
    };

    const docClipByNumForSync = new Map<number, DocumentaryClip>();
    for (const c of allDocClips) {
      if (c && typeof c.clipNumber === 'number') {
        docClipByNumForSync.set(c.clipNumber, c);
      }
    }

    const combinedClipVideosMap: Record<number, string> = {};
    for (const [kStr, rawSrvUrl] of Object.entries(localServerClipVideosMap)) {
      const kNum = Number(kStr);
      const srvUrl = rewriteMediaBridgeUrl(rawSrvUrl);
      if (!srvUrl || isMediaUrlFromOtherDocumentary(srvUrl, activeDoc)) continue;
      const srvMeta = extractEditorMediaUrlMeta(srvUrl);
      if (isEditorFolderItemDiscarded(docClipByNumForSync.get(kNum), srvMeta.fileName, srvMeta.mtimeMs, srvUrl)) {
        continue;
      }
      combinedClipVideosMap[kNum] = srvUrl;
    }
    for (const [kStr, rawCapUrl] of Object.entries(capturedClipVideosMap)) {
      const kNum = Number(kStr);
      const capUrl = rewriteMediaBridgeUrl(rawCapUrl);
      if (!capUrl || isMediaUrlFromOtherDocumentary(capUrl, activeDoc)) continue;
      const capMeta = extractEditorMediaUrlMeta(capUrl);
      if (isEditorFolderItemDiscarded(docClipByNumForSync.get(kNum), capMeta.fileName, capMeta.mtimeMs, capUrl)) {
        continue;
      }
      const srvUrl = combinedClipVideosMap[kNum] || '';
      if (!srvUrl) {
        combinedClipVideosMap[kNum] = capUrl;
        continue;
      }
      const capTs = getUrlTimestampMs(capUrl);
      const srvTs = getUrlTimestampMs(srvUrl);
      const capIs4k = /(_4k|%5f4k)/i.test(capUrl);
      const srvIs4k = /(_4k|%5f4k)/i.test(srvUrl);
      if (srvTs > 0 && capTs > 0 && srvTs > capTs + 500) {
        combinedClipVideosMap[kNum] = srvUrl;
      } else if (capTs > 0 && srvTs > 0 && capTs > srvTs + 500) {
        combinedClipVideosMap[kNum] = capUrl;
      } else if ((capIs4k && !srvIs4k) || capUrl.includes('&r=')) {
        combinedClipVideosMap[kNum] = capUrl;
      }
    }
    const combinedSunoAudioMap: Record<number, string> = {};
    for (const [kStr, rawAudioUrl] of Object.entries({
      ...localServerSunoMap,
      ...capturedSunoAudioMap,
    })) {
      const kNum = Number(kStr);
      const rewrittenAudio = rewriteMediaBridgeUrl(rawAudioUrl);
      if (rewrittenAudio) combinedSunoAudioMap[kNum] = rewrittenAudio;
    }

    const bodyClips: TimelineClipItem[] = docClips.map((c, idx) => {
      const isClip1 = hasStage6ScriptClips ? c.clipNumber === 1 : c.clipNumber === 1 || idx === 0;
      const srcDur =
        Number(c.durationSeconds) > 0
          ? Number(c.durationSeconds)
          : isClip1
          ? clip1VisualDur
          : standardDur;
      // On a documentary switch the live timeline still belongs to the previous documentary: never inherit from it
      const existingItem = isDocSwitch
        ? undefined
        : timelineClips.find(
            (tc) =>
              tc.clipNumber === c.clipNumber &&
              tc.id !== 'fixed-doc-intro' &&
              tc.id !== 'fixed-doc-outro' &&
              !tc.id.endsWith('-slogan-partB')
          );
      const isClipReviewed = Boolean(c.reviewedForEditor);
      const activeCombinedUrl = isClipReviewed ? combinedClipVideosMap[c.clipNumber] || '' : '';
      const existingRewrittenUrl = isClipReviewed ? ownMedia(rewriteMediaBridgeUrl(existingItem?.videoUrl)) : '';
      const existingMeta = extractEditorMediaUrlMeta(existingRewrittenUrl);
      const canReuseExistingUrl =
        isClipReviewed &&
        Boolean(existingRewrittenUrl) &&
        !isEditorClipRejectedOrQuarantined(c) &&
        !isEditorFolderItemDiscarded(
          c,
          existingMeta.fileName,
          existingMeta.mtimeMs,
          existingRewrittenUrl
        );
      const videoUrl = isClipReviewed ? (activeCombinedUrl || (canReuseExistingUrl ? existingRewrittenUrl : '')) : '';

      // Strictly use each clip's own first frame or initial image fallback (never repeat documentary thumbnail or shared @Reference across clips)
      const rawPosterCandidate =
        ownMedia(firstFrameByClip[c.clipNumber]) ||
        ownMedia(capturedClipFramesMap?.[c.clipNumber]) ||
        ownMedia(c.videoFrames && c.videoFrames[0]) ||
        ownMedia(c.imagePreviewUrl) ||
        '';
      const safePosterCandidate =
        videoUrl && /_Descartados_Auditoria/i.test(String(rawPosterCandidate))
          ? ''
          : rawPosterCandidate;
      const posterUrl = safePosterCandidate
        ? rewriteMediaBridgeUrl(safePosterCandidate) || undefined
        : undefined;

      const computedFileName = c.videoSavedFileName || buildClipSixWordFileName(c, activeDoc);
      const isBrollClip = Boolean(
        isClipReviewed &&
          (c.isStaticBroll || /_broll_4k/i.test(computedFileName) || /_broll_4k/i.test(videoUrl))
      );
      const nextVideoTs = getUrlTimestampMs(videoUrl);
      const prevVideoTs = getUrlTimestampMs(existingRewrittenUrl);
      const nextVideoMeta = extractEditorMediaUrlMeta(videoUrl);
      const isNewerBodyVideo =
        Boolean(videoUrl) &&
        ((nextVideoTs > 0 && prevVideoTs > 0 && nextVideoTs > prevVideoTs + 1000) ||
          (Boolean(existingRewrittenUrl) &&
            Boolean(nextVideoMeta.fileName) &&
            Boolean(existingMeta.fileName) &&
            nextVideoMeta.fileName !== existingMeta.fileName));
      const becameBrollClip = isBrollClip && !existingItem?.isStaticBroll;
      if (isNewerBodyVideo || becameBrollClip) {
        delete extractedVideoUrlByClipRef.current[c.clipNumber];
      }
      const existingOpticalFlowUrl = isClipReviewed && existingItem?.opticalFlowUrl
        ? rewriteMediaBridgeUrl(existingItem.opticalFlowUrl)
        : undefined;
      const existingOpticalFlowTs = getUrlTimestampMs(existingOpticalFlowUrl);
      const keepExistingOpticalFlow =
        isClipReviewed &&
        Boolean(existingOpticalFlowUrl) &&
        !becameBrollClip &&
        !isNewerBodyVideo &&
        (nextVideoTs === 0 || existingOpticalFlowTs === 0 || existingOpticalFlowTs >= nextVideoTs - 1000);

      const existingDur = existingItem?.duration;
      const existingSlot = existingItem?.originalSlotDuration;
      const hasManualEdit = Boolean(
        existingItem &&
        ((existingItem.trimStart && existingItem.trimStart > 0.05) ||
          (existingItem.speed && existingItem.speed !== 1) ||
          existingItem.partLabel)
      );
      const isAlignedSlotDur =
        typeof existingDur === 'number' &&
        typeof existingSlot === 'number' &&
        Math.abs(existingDur - existingSlot) <= 0.03 &&
        existingDur >= standardDur * 0.85 &&
        existingDur <= standardDur * 1.3;
      const isPolluted =
        !hasManualEdit &&
        (existingDur === 5.65 ||
          (typeof existingDur === 'number' &&
            (Math.abs(existingDur - 5.58) < 0.08 ||
              Math.abs(existingDur - 5.66) < 0.05 ||
              Math.abs(existingDur - 10.45) < 0.05 ||
              (!isVideo76Doc &&
                !isAlignedSlotDur &&
                Math.abs(existingDur - standardDur) > 0.05 &&
                Math.abs((existingItem.trimEnd ?? standardDur) - standardDur) < 0.15 &&
                (!existingItem.speed || Math.abs(existingItem.speed - 1) <= 0.02)))));

      const safeDuration =
        isClip1
          ? clip1VisualDur
          : existingItem && !isPolluted
          ? existingItem.duration
          : srcDur;

      const safeSlotDuration =
        isClip1
          ? clip1VisualDur
          : existingItem && !isPolluted && existingSlot && existingSlot > 0.5
          ? existingSlot
          : srcDur;

      return {
        id: c.id || `tl-clip-${c.clipNumber}`,
        clipNumber: c.clipNumber,
        fileName: computedFileName,
        narrationSegment: c.narrationSegment || '',
        imagePrompt: c.imagePrompt || '',
        videoPrompt: c.videoPrompt || '',
        isStaticBroll: isBrollClip || undefined,
        brollCameraMotion: isBrollClip ? c.brollCameraMotion || 'zoom_in' : undefined,
        duration: safeDuration,
        sourceDuration: existingItem?.sourceDuration || srcDur,
        speed: existingItem ? existingItem.speed : 1,
        trimStart: existingItem ? existingItem.trimStart : 0,
        trimEnd: existingItem?.trimEnd ?? srcDur,
        smoothSlowMo:
          existingItem?.smoothSlowMo !== undefined
            ? existingItem.smoothSlowMo
            : Boolean(existingItem && existingItem.speed < 1),
        opticalFlowUrl: keepExistingOpticalFlow ? existingOpticalFlowUrl : undefined,
        opticalFlowBakedKey: keepExistingOpticalFlow ? existingItem?.opticalFlowBakedKey : undefined,
        parentGroupId: existingItem?.parentGroupId,
        originalSlotDuration: safeSlotDuration,
        partLabel: existingItem?.partLabel,
        foleyVolume:
          isBrollClip && !existingItem?.customVolumeSet
            ? 0
            : existingItem
              ? existingItem.foleyVolume
              : isClip1
                ? 80
                : 20,
        customVolumeSet: existingItem?.customVolumeSet,
        audioMuted:
          isBrollClip && !existingItem?.customVolumeSet
            ? true
            : existingItem?.audioMuted !== undefined
              ? existingItem.audioMuted
              : isBrollClip,
        audioFadeInSec: existingItem?.audioFadeInSec,
        audioFadeOutSec: existingItem?.audioFadeOutSec,
        transition: existingItem
          ? normalizeEditorClipTransition(existingItem.transition)
          : isClip1
            ? 'dip_black'
            : defaultTransition,
        videoUrl,
        posterUrl,
        reviewedForEditor: Boolean(c.reviewedForEditor),
        reframe9x16Mode: existingItem?.reframe9x16Mode || c.reframe9x16Mode,
        reframeFocusXStart: existingItem?.reframeFocusXStart ?? c.reframeFocusXStart,
        reframeFocusXEnd: existingItem?.reframeFocusXEnd ?? c.reframeFocusXEnd,
        reframeFocusY: existingItem?.reframeFocusY ?? c.reframeFocusY,
        frameZoom16x9: Number((c as any).frameTransformAt || 0) > Number((existingItem as any)?.frameTransformAt || 0) ? c.frameZoom16x9 : existingItem?.frameZoom16x9 ?? c.frameZoom16x9,
        frameZoom9x16: Number((c as any).frameTransformAt || 0) > Number((existingItem as any)?.frameTransformAt || 0) ? c.frameZoom9x16 : existingItem?.frameZoom9x16 ?? c.frameZoom9x16,
        frameOffsetX16x9: Number((c as any).frameTransformAt || 0) > Number((existingItem as any)?.frameTransformAt || 0) ? c.frameOffsetX16x9 : existingItem?.frameOffsetX16x9 ?? c.frameOffsetX16x9,
        frameOffsetY16x9: Number((c as any).frameTransformAt || 0) > Number((existingItem as any)?.frameTransformAt || 0) ? c.frameOffsetY16x9 : existingItem?.frameOffsetY16x9 ?? c.frameOffsetY16x9,
        frameOffsetX9x16: Number((c as any).frameTransformAt || 0) > Number((existingItem as any)?.frameTransformAt || 0) ? c.frameOffsetX9x16 : existingItem?.frameOffsetX9x16 ?? c.frameOffsetX9x16,
        frameOffsetY9x16: Number((c as any).frameTransformAt || 0) > Number((existingItem as any)?.frameTransformAt || 0) ? c.frameOffsetY9x16 : existingItem?.frameOffsetY9x16 ?? c.frameOffsetY9x16,
        frameZoomInSec16x9: Number((c as any).frameTransformAt || 0) > Number((existingItem as any)?.frameTransformAt || 0) ? c.frameZoomInSec16x9 : existingItem?.frameZoomInSec16x9 ?? c.frameZoomInSec16x9,
        frameZoomInSec9x16: Number((c as any).frameTransformAt || 0) > Number((existingItem as any)?.frameTransformAt || 0) ? c.frameZoomInSec9x16 : existingItem?.frameZoomInSec9x16 ?? c.frameZoomInSec9x16,
        frameKeys16x9: Number((c as any).frameTransformAt || 0) > Number((existingItem as any)?.frameTransformAt || 0) ? c.frameKeys16x9 : existingItem?.frameKeys16x9 ?? c.frameKeys16x9,
        frameKeys9x16: Number((c as any).frameTransformAt || 0) > Number((existingItem as any)?.frameTransformAt || 0) ? c.frameKeys9x16 : existingItem?.frameKeys9x16 ?? c.frameKeys9x16,
        // A size/position saved in the documentary later than this browser's copy wins (set on another device)
        frameTransformAt: Math.max(Number((c as any).frameTransformAt || 0), Number((existingItem as any)?.frameTransformAt || 0)) || undefined,
        reframeConfidence: existingItem?.reframeConfidence ?? c.reframeConfidence,
        reframeReason: existingItem?.reframeReason || c.reframeReason,
      };
    });

    // If activeDoc.clips is empty (no Stage 6 script clips) and combinedClipVideosMap has .MP4 files from 05_Clips_Video, build timeline clips from those .MP4 files
    if (
      !hasStage6ScriptClips &&
      bodyClips.length === 0 &&
      Object.keys(combinedClipVideosMap).length > 0
    ) {
      const sortedNums = Object.keys(combinedClipVideosMap)
        .map((n) => parseInt(n, 10))
        .filter((n) => n > 0)
        .sort((a, b) => a - b);
      sortedNums.forEach((num, idx) => {
        const isClip1 = num === 1 || idx === 0;
        const srcDur = isClip1 ? clip1HookDur : standardDur;
        const rawVidUrl = rewriteMediaBridgeUrl(combinedClipVideosMap[num] || '');
        let extractedFileName = `${String(num).padStart(2, '0')}_Clip_Documental.mp4`;
        try {
          const decoded = decodeURIComponent(rawVidUrl);
          const m = decoded.match(/\/([^/?#]+\.(?:mp4|webm|mov))/i);
          if (m && m[1]) extractedFileName = m[1];
        } catch {}
        const isFolderBroll = /_broll_4k/i.test(extractedFileName) || /_broll_4k/i.test(rawVidUrl);
        bodyClips.push({
          id: `folder-clip-${num}`,
          clipNumber: num,
          fileName: extractedFileName,
          narrationSegment: '',
          isStaticBroll: isFolderBroll || undefined,
          brollCameraMotion: isFolderBroll ? 'zoom_in' : undefined,
          duration: srcDur,
          sourceDuration: srcDur,
          speed: 1,
          trimStart: 0,
          trimEnd: srcDur,
          smoothSlowMo: false,
          originalSlotDuration: srcDur,
          foleyVolume: isFolderBroll ? 0 : isClip1 ? 80 : 20,
          audioMuted: isFolderBroll || undefined,
          transition: isClip1 ? 'dip_black' : defaultTransition,
          videoUrl: rawVidUrl,
          posterUrl: rewriteMediaBridgeUrl(ownMedia(firstFrameByClip[num])),
          reviewedForEditor: true,
        });
      });
    }

    const savedCustomClipsList: TimelineClipItem[] = Array.isArray(
      savedDocOverlays?.customTimelineClips
    )
      ? savedDocOverlays.customTimelineClips
      : [];
    const savedOrExistingIntro =
      savedCustomClipsList.find((c) => c.id === 'fixed-doc-intro' || c.clipNumber === 0) ||
      (!isDocSwitch
        ? timelineClips.find((c) => c.id === 'fixed-doc-intro' || c.clipNumber === 0)
        : undefined);
    const savedOrExistingOutro =
      savedCustomClipsList.find((c) => c.id === 'fixed-doc-outro' || c.clipNumber === 999) ||
      (!isDocSwitch
        ? timelineClips.find((c) => c.id === 'fixed-doc-outro' || c.clipNumber === 999)
        : undefined);

    const fixedIntroClip: TimelineClipItem = {
      id: 'fixed-doc-intro',
      clipNumber: 0,
      fileName: '00_Intro_Huellas_de_la_Humanidad_8K.mp4',
      narrationSegment:
        docIntroPlacement === 'INTRO_POST_SLOGAN'
          ? '🎬 INTRO OFICIAL POST-SLOGAN (8s tras "Aquí seguimos sus rastros." • Audio Fade In 1.5s + Fade Out 5s) — Huellas de la Humanidad (8K)'
          : '🎬 INTRO OFICIAL (00:00 - 00:08 • Audio Fade In 1.5s + Fade Out 5s) — Huellas de la Humanidad (8K)',
      duration: FIXED_INTRO_SEC,
      sourceDuration: FIXED_INTRO_SEC,
      speed: 1,
      trimStart: 0,
      trimEnd: FIXED_INTRO_SEC,
      smoothSlowMo: false,
      originalSlotDuration: FIXED_INTRO_SEC,
      foleyVolume:
        typeof savedOrExistingIntro?.foleyVolume === 'number'
          ? savedOrExistingIntro.foleyVolume
          : 100,
      customVolumeSet: savedOrExistingIntro?.customVolumeSet,
      audioMuted: savedOrExistingIntro?.audioMuted,
      audioFadeInSec:
        typeof savedOrExistingIntro?.audioFadeInSec === 'number'
          ? savedOrExistingIntro.audioFadeInSec
          : 1.5,
      audioFadeOutSec:
        typeof savedOrExistingIntro?.audioFadeOutSec === 'number'
          ? savedOrExistingIntro.audioFadeOutSec
          : 5,
      transition: 'crossfade',
      videoUrl: resolvedIntroVideoUrl,
      posterUrl: resolvedIntroPosterUrl,
      reviewedForEditor: true,
    };

    const fixedOutroClip: TimelineClipItem = {
      id: 'fixed-doc-outro',
      clipNumber: 999,
      fileName: 'Outro_Huellas_de_la_Humanidad_8K_FadeOut.mp4',
      narrationSegment:
        '🎬 OUTRO OFICIAL (8s • Crossfade + Audio Fade In 1.5s + Fade Out 2.5s) — Huellas de la Humanidad (8K)',
      duration: FIXED_OUTRO_SEC,
      sourceDuration: FIXED_OUTRO_SEC,
      speed: 1,
      trimStart: 0,
      trimEnd: FIXED_OUTRO_SEC,
      smoothSlowMo: false,
      originalSlotDuration: FIXED_OUTRO_SEC,
      foleyVolume:
        typeof savedOrExistingOutro?.foleyVolume === 'number'
          ? savedOrExistingOutro.foleyVolume
          : 100,
      customVolumeSet: savedOrExistingOutro?.customVolumeSet,
      audioMuted: savedOrExistingOutro?.audioMuted,
      audioFadeInSec:
        typeof savedOrExistingOutro?.audioFadeInSec === 'number'
          ? savedOrExistingOutro.audioFadeInSec
          : 1.5,
      audioFadeOutSec:
        typeof savedOrExistingOutro?.audioFadeOutSec === 'number'
          ? savedOrExistingOutro.audioFadeOutSec
          : 2.5,
      transition: 'crossfade',
      videoUrl: outroVideoUrl,
      posterUrl: resolvedOutroPosterUrl,
      reviewedForEditor: true,
    };

    let sourceClipsForBuild: TimelineClipItem[] = bodyClips;
    let reconciledCustomStructureChanged = false;
    let parkedMapChanged = false;
    const nextParkedMap: Record<string, TimelineClipItem[]> =
      savedDocOverlays?.parkedTimelineClipsByNumber &&
      typeof savedDocOverlays.parkedTimelineClipsByNumber === 'object'
        ? { ...savedDocOverlays.parkedTimelineClipsByNumber }
        : {};

    if (
      savedDocOverlays?.userEditedClips &&
      (Array.isArray(savedDocOverlays.customTimelineClips) ||
        Object.keys(nextParkedMap).length > 0)
    ) {
      const rawCustomList: TimelineClipItem[] = Array.isArray(
        savedDocOverlays.customTimelineClips
      )
        ? (savedDocOverlays.customTimelineClips as TimelineClipItem[])
        : [];
      const survivingCustom: TimelineClipItem[] = [];
      const newlyParkedByNum: Record<number, TimelineClipItem[]> = {};

      if (hasStage6ScriptClips) {
        for (const numKey of Object.keys(nextParkedMap)) {
          const parsedNum = Number(numKey);
          if (Number.isFinite(parsedNum) && parsedNum > 0 && !allStage6Nums.has(parsedNum)) {
            delete nextParkedMap[numKey];
            parkedMapChanged = true;
          }
        }
      }

      for (const tc of rawCustomList) {
        const isIntroOrOutroTc =
          tc.id === 'fixed-doc-intro' ||
          tc.id === 'fixed-doc-outro' ||
          tc.clipNumber === 0 ||
          tc.clipNumber === 999;
        if (
          hasStage6ScriptClips &&
          !isIntroOrOutroTc &&
          tc.clipNumber > 0 &&
          !allStage6Nums.has(tc.clipNumber)
        ) {
          reconciledCustomStructureChanged = true;
          continue;
        }
        // En documentales estándar, los clips no revisados permanecen en survivingCustom como ranuras reservadas (vacías)
        // para garantizar la sincronía temporal 1:1 con la locución y evitar que los clips revisados se compacten hacia la izquierda.
        survivingCustom.push(tc);
      }

      for (const [numStr, items] of Object.entries(newlyParkedByNum)) {
        if (items.length > 0) {
          nextParkedMap[numStr] = stripHeavyDataUrlsFromClips(items);
          parkedMapChanged = true;
        }
      }

      if (hasStage6ScriptClips && docClips.length === 0) {
        sourceClipsForBuild = [];
      } else {
        const presentCustomNums = new Set(
          survivingCustom
            .filter((tc) => tc.clipNumber > 0 && tc.clipNumber !== 999)
            .map((tc) => tc.clipNumber)
        );
        for (const bc of bodyClips) {
          if (!presentCustomNums.has(bc.clipNumber)) {
            reconciledCustomStructureChanged = true;
            const parkedKey = String(bc.clipNumber);
            const parkedItems = Array.isArray(nextParkedMap[parkedKey])
              ? nextParkedMap[parkedKey]
              : null;
            const itemsToInsert: TimelineClipItem[] =
              parkedItems && parkedItems.length > 0 ? parkedItems : [bc];
            if (parkedItems) {
              delete nextParkedMap[parkedKey];
              parkedMapChanged = true;
            }
            const insIdx = survivingCustom.findIndex(
              (item) =>
                item.id === 'fixed-doc-outro' ||
                item.clipNumber === 999 ||
                (item.clipNumber > bc.clipNumber && item.clipNumber > 0)
            );
            if (insIdx >= 0) {
              survivingCustom.splice(insIdx, 0, ...itemsToInsert);
            } else {
              survivingCustom.push(...itemsToInsert);
            }
            presentCustomNums.add(bc.clipNumber);
          }
        }

        let anyRegeneratedOrUpdated = false;
        sourceClipsForBuild = survivingCustom.map(
          (tc) => {
          const isIntroOrOutroRestored =
            tc.id === 'fixed-doc-intro' ||
            tc.id === 'fixed-doc-outro' ||
            tc.clipNumber === 0 ||
            tc.clipNumber === 999;
          if (isIntroOrOutroRestored) {
            const isIntroItem = tc.id === 'fixed-doc-intro' || tc.clipNumber === 0;
            const cleanVideoUrl = isIntroItem ? resolvedIntroVideoUrl : outroVideoUrl;
            const cleanPosterUrl =
              (isIntroItem ? resolvedIntroPosterUrl : resolvedOutroPosterUrl) || '';
            const hasPoisonedLegacyUrl =
              !tc.videoUrl ||
              tc.videoUrl.includes('Intro%3AOutro') ||
              tc.videoUrl.includes('Intro:Outro') ||
              tc.videoUrl.includes('/api/flow/serve-folder-file');
            if (
              hasPoisonedLegacyUrl ||
              cleanVideoUrl !== (tc.videoUrl || '') ||
              cleanPosterUrl !== (tc.posterUrl || '')
            ) {
              anyRegeneratedOrUpdated = true;
            }
            return {
              ...tc,
              transition: normalizeEditorClipTransition(tc.transition),
              videoUrl: cleanVideoUrl,
              posterUrl: cleanPosterUrl || undefined,
              reviewedForEditor: true,
            };
          }
          const docClipMatch = activeDoc?.clips?.find((dc) => dc.clipNumber === tc.clipNumber);
          const activeCombinedUrl = combinedClipVideosMap[tc.clipNumber] || '';
          const rewrittenTcVideoUrl = ownMedia(rewriteMediaBridgeUrl(tc.videoUrl));
          const rewrittenOrigVideoUrl = ownMedia(rewriteMediaBridgeUrl(tc.originalVideoUrlBeforeSeparation));
          const rewrittenOpticalFlowUrl = ownMedia(rewriteMediaBridgeUrl(tc.opticalFlowUrl));
          const rewrittenOrigOpticalFlowUrl = ownMedia(
            rewriteMediaBridgeUrl(tc.originalOpticalFlowUrlBeforeSeparation)
          );
          const tcMeta = extractEditorMediaUrlMeta(rewrittenTcVideoUrl);
          const canReuseSavedTcUrl =
            Boolean(rewrittenTcVideoUrl) &&
            !isEditorClipRejectedOrQuarantined(docClipMatch) &&
            !isEditorFolderItemDiscarded(
              docClipMatch,
              tcMeta.fileName,
              tcMeta.mtimeMs,
              rewrittenTcVideoUrl
            );
          const freshVideoUrl =
            activeCombinedUrl || (canReuseSavedTcUrl ? rewrittenTcVideoUrl : '');
          const rawFreshPoster =
            ownMedia(firstFrameByClip[tc.clipNumber]) ||
            ownMedia(capturedClipFramesMap?.[tc.clipNumber]) ||
            ownMedia(tc.posterUrl) ||
            ownMedia(docClipMatch?.videoFrames && docClipMatch.videoFrames[0]) ||
            ownMedia(docClipMatch?.imagePreviewUrl) ||
            '';
          const freshPosterUrl = rewriteMediaBridgeUrl(
            freshVideoUrl && /_Descartados_Auditoria/i.test(String(rawFreshPoster))
              ? ''
              : rawFreshPoster
          );
          const prevBaseVideoUrl = rewrittenOrigVideoUrl || rewrittenTcVideoUrl || '';
          const freshTs = getUrlTimestampMs(freshVideoUrl);
          const prevBaseTs = getUrlTimestampMs(prevBaseVideoUrl);
          const isNewerDiskVideo =
            freshTs > 0 &&
            prevBaseTs > 0 &&
            freshTs > prevBaseTs + 1000 &&
            !freshVideoUrl.includes('.foley_only_cache') &&
            !freshVideoUrl.includes('.optical_flow_cache');

          const opticalFlowTs = getUrlTimestampMs(rewrittenOpticalFlowUrl);
          const opticalFlowStillValid =
            Boolean(rewrittenOpticalFlowUrl) &&
            !isNewerDiskVideo &&
            (freshTs === 0 || opticalFlowTs === 0 || opticalFlowTs >= freshTs - 1000);

          const origMeta = extractEditorMediaUrlMeta(rewrittenOrigVideoUrl);
          const canReuseOrigUrl =
            Boolean(rewrittenOrigVideoUrl) &&
            !rewrittenOrigVideoUrl.includes('.foley_only_cache') &&
            !rewrittenOrigVideoUrl.includes('.vocals_clean_cache') &&
            !rewrittenOrigVideoUrl.includes('.music_clean_cache') &&
            !isEditorClipRejectedOrQuarantined(docClipMatch) &&
            !isEditorFolderItemDiscarded(
              docClipMatch,
              origMeta.fileName,
              origMeta.mtimeMs,
              rewrittenOrigVideoUrl
            );
          const cleanBaseVideoUrl =
            activeCombinedUrl ||
            (canReuseOrigUrl
              ? rewrittenOrigVideoUrl
              : canReuseSavedTcUrl
                ? rewrittenTcVideoUrl
                : '');

          const isClipReviewed = Boolean(
            docClipMatch?.reviewedForEditor ??
              (tc.id === 'fixed-doc-intro' || tc.clipNumber === 0 || tc.id === 'fixed-doc-outro' || tc.clipNumber === 999
                ? true
                : tc.reviewedForEditor)
          );
          const effectiveVideoUrl = isClipReviewed ? rewriteMediaBridgeUrl(cleanBaseVideoUrl || freshVideoUrl) : '';
          const baseOpticalFlowUrl = rewrittenOrigOpticalFlowUrl || rewrittenOpticalFlowUrl;
          const effectiveOpticalFlowUrl =
            opticalFlowStillValid &&
            baseOpticalFlowUrl &&
            !baseOpticalFlowUrl.includes('.foley_only_cache') &&
            !baseOpticalFlowUrl.includes('_foley_')
              ? rewriteMediaBridgeUrl(baseOpticalFlowUrl)
              : undefined;

          const isRestoredBroll = Boolean(
            docClipMatch?.isStaticBroll ||
              tc.isStaticBroll ||
              /_broll_4k/i.test(tc.fileName || '') ||
              /_broll_4k/i.test(effectiveVideoUrl || '')
          );
          const isClip1Restored = tc.clipNumber === 1;
          const hasExplicitAudioVolume =
            Boolean(tc.customVolumeSet) ||
            Boolean(tc.audioMuted) ||
            (typeof tc.foleyVolume === 'number' && tc.foleyVolume !== 40);
          const repairedFoleyVolume = isRestoredBroll && !tc.customVolumeSet
            ? 0
            : isIntroOrOutroRestored || isClip1Restored || hasExplicitAudioVolume
              ? tc.foleyVolume
              : 20;

          if (
            isNewerDiskVideo ||
            effectiveVideoUrl !== tc.videoUrl ||
            freshPosterUrl !== tc.posterUrl ||
            effectiveOpticalFlowUrl !== tc.opticalFlowUrl ||
            repairedFoleyVolume !== tc.foleyVolume ||
            tc.foleyOnlyIsolated ||
            tc.vocalsSeparated ||
            tc.musicSeparated
          ) {
            anyRegeneratedOrUpdated = true;
            if (isNewerDiskVideo) {
              delete extractedVideoUrlByClipRef.current[tc.clipNumber];
            }
          }

          const srcDur = tc.sourceDuration || standardDur;
          let repairedDur = tc.duration;
          let repairedSrcDur = tc.sourceDuration;
          let repairedTrimEnd = tc.trimEnd;
          let repairedSlotDur = tc.originalSlotDuration;

          if (isClip1Restored && !tc.partLabel && (!tc.trimStart || tc.trimStart < 0.05)) {
            if (repairedDur !== clip1VisualDur || repairedSlotDur !== clip1VisualDur) {
              repairedDur = clip1VisualDur;
              repairedSlotDur = clip1VisualDur;
              repairedTrimEnd = clip1VisualDur;
              repairedSrcDur = clip1VisualDur;
              anyRegeneratedOrUpdated = true;
            }
          } else if (!isIntroOrOutroRestored && !isClip1Restored && !tc.partLabel && (!tc.trimStart || tc.trimStart < 0.05)) {
            const isAlignedTcSlotDur =
              typeof tc.duration === 'number' &&
              typeof tc.originalSlotDuration === 'number' &&
              Math.abs(tc.duration - tc.originalSlotDuration) <= 0.03 &&
              tc.duration >= standardDur * 0.85 &&
              tc.duration <= standardDur * 1.3;
            const isPolluted =
              typeof tc.duration === 'number' &&
              (Math.abs(tc.duration - 5.58) < 0.08 ||
                Math.abs(tc.duration - 5.66) < 0.05 ||
                Math.abs(tc.duration - 10.45) < 0.05 ||
                (!isVideo76Doc &&
                  !isAlignedTcSlotDur &&
                  Math.abs(tc.duration - standardDur) > 0.05 &&
                  Math.abs((tc.trimEnd ?? standardDur) - standardDur) < 0.15 &&
                  (!tc.speed || Math.abs(tc.speed - 1) <= 0.02)));
            if (isPolluted) {
              repairedDur = standardDur;
              repairedSlotDur = standardDur;
              repairedTrimEnd = standardDur;
              repairedSrcDur = standardDur;
              anyRegeneratedOrUpdated = true;
            }
          }

          // A clip size/position saved in the documentary later than this browser's timeline copy wins
          // (it was set on another device or tab)
          const docFrameAt = Number((docClipMatch as any)?.frameTransformAt || 0);
          const docFrameTransformPatch: Partial<TimelineClipItem> =
            docClipMatch && docFrameAt > Number(tc.frameTransformAt || 0)
              ? {
                  frameZoom16x9: docClipMatch.frameZoom16x9,
                  frameZoom9x16: docClipMatch.frameZoom9x16,
                  frameOffsetX16x9: docClipMatch.frameOffsetX16x9,
                  frameOffsetY16x9: docClipMatch.frameOffsetY16x9,
                  frameOffsetX9x16: docClipMatch.frameOffsetX9x16,
                  frameOffsetY9x16: docClipMatch.frameOffsetY9x16,
                  frameZoomInSec16x9: docClipMatch.frameZoomInSec16x9,
                  frameZoomInSec9x16: docClipMatch.frameZoomInSec9x16,
                  frameKeys16x9: docClipMatch.frameKeys16x9,
                  frameKeys9x16: docClipMatch.frameKeys9x16,
                  frameTransformAt: docFrameAt,
                }
              : {};
          if (docFrameTransformPatch.frameTransformAt) anyRegeneratedOrUpdated = true;

          let repairedReframeMode = tc.reframe9x16Mode;
          let repairedFocusXStart = tc.reframeFocusXStart;
          let repairedFocusXEnd = tc.reframeFocusXEnd;
          let repairedFocusY = tc.reframeFocusY;
          let repairedReframeReason = tc.reframeReason;
          let repairedUserReframed = tc.userReframed9x16;
          if (isVideo76Doc) {
            if (tc.clipNumber === 17 && tc.reframe9x16Mode === 'fit_blur') {
              repairedReframeMode = 'auto_pan';
              repairedFocusXStart = 66;
              repairedFocusXEnd = 52;
              repairedFocusY = 50;
              repairedReframeReason =
                'Paneo vertical sobre el grabado de las 2.000 pesetas hacia el campesino reclutado y el guardia';
              repairedUserReframed = true;
              anyRegeneratedOrUpdated = true;
            } else if (
              tc.clipNumber === 35 &&
              !tc.userReframed9x16 &&
              (tc.reframeFocusXEnd ?? 0) < 95
            ) {
              repairedReframeMode = 'auto_pan';
              repairedFocusXStart = 35;
              repairedFocusXEnd = 100;
              repairedFocusY = 50;
              repairedReframeReason =
                'Paneo desde el fogonero izquierdo hasta enfocar completamente a los dos hombres de la derecha';
              repairedUserReframed = true;
              anyRegeneratedOrUpdated = true;
            } else if (
              tc.clipNumber === 74 &&
              !tc.userReframed9x16 &&
              tc.reframe9x16Mode === 'auto_pan' &&
              tc.reframeFocusXEnd === 76
            ) {
              repairedReframeMode = 'auto_focus';
              repairedFocusXStart = 25;
              repairedFocusXEnd = 25;
              repairedFocusY = 50;
              repairedReframeReason =
                'Enfoque en el vapor Sinaia atracado y los estibadores en el muelle izquierdo (25%)';
              repairedUserReframed = true;
              anyRegeneratedOrUpdated = true;
            }
          }
          return {
            ...tc,
            duration: repairedDur,
            sourceDuration: isNewerDiskVideo ? srcDur : repairedSrcDur || srcDur,
            originalSlotDuration: repairedSlotDur || (isClip1Restored ? clip1VisualDur : standardDur),
            transition: normalizeEditorClipTransition(tc.transition),
            isStaticBroll: isRestoredBroll || undefined,
            brollCameraMotion: isRestoredBroll
              ? docClipMatch?.brollCameraMotion || tc.brollCameraMotion || 'zoom_in'
              : undefined,
            audioMuted: isRestoredBroll && !tc.customVolumeSet ? true : tc.audioMuted,
            foleyVolume: repairedFoleyVolume,
            customVolumeSet: isRestoredBroll
              ? Boolean(tc.customVolumeSet)
              : Boolean(tc.customVolumeSet) ||
                Boolean(tc.audioMuted) ||
                repairedFoleyVolume !== (isIntroOrOutroRestored ? 100 : isClip1Restored ? 80 : 20),
            videoUrl: effectiveVideoUrl,
            opticalFlowUrl: effectiveOpticalFlowUrl,
            opticalFlowBakedKey: effectiveOpticalFlowUrl ? tc.opticalFlowBakedKey : undefined,
            foleyOnlyIsolated: false,
            cleanFoleyOnlyVideoUrl: undefined,
            cleanOpticalFlowOnlyUrl: undefined,
            vocalsSeparated: false,
            cleanNoVocalsVideoUrl: undefined,
            musicSeparated: false,
            cleanNoMusicVideoUrl: undefined,
            originalVideoUrlBeforeSeparation: effectiveVideoUrl,
            originalOpticalFlowUrlBeforeSeparation: effectiveOpticalFlowUrl,
            trimStart: isNewerDiskVideo ? 0 : tc.trimStart,
            trimEnd: isNewerDiskVideo ? srcDur : repairedTrimEnd ?? tc.trimEnd,
            posterUrl: freshPosterUrl,
            smoothSlowMo:
              tc.smoothSlowMo !== undefined ? tc.smoothSlowMo : Boolean(tc.speed && tc.speed < 1),
            reframe9x16Mode: repairedReframeMode,
            reframeFocusXStart: repairedFocusXStart,
            reframeFocusXEnd: repairedFocusXEnd,
            reframeFocusY: repairedFocusY,
            ...docFrameTransformPatch,
            reframeReason: repairedReframeReason,
            userReframed9x16: repairedUserReframed,
            reviewedForEditor: isClipReviewed,
          };
        }
        );
        if (anyRegeneratedOrUpdated) {
          reconciledCustomStructureChanged = true;
        }
      }
    }

    const savedClipAudioEdits = readSavedClipAudioEdits(docId);
    const alignedBuiltClips = buildAlignedTimelineClipsForIntroMode(
      sourceClipsForBuild,
      docIntroPlacement,
      fixedIntroClip,
      fixedOutroClip
    );

    // A manual reframe saved on the documentary (doc.clips) newer than the one cached in this
    // browser's timeline must win, so edits made from another device/session are not ignored.
    const docManualReframeByNum = new Map<number, any>();
    for (const dc of (Array.isArray(activeDoc?.clips) ? activeDoc!.clips : []) as any[]) {
      if (dc?.userReframed9x16 && Number(dc.reframeUpdatedAt) > 0) {
        docManualReframeByNum.set(Number(dc.clipNumber), dc);
      }
    }
    const builtClips = alignedBuiltClips.map((bc) => {
      const liveMatch = !isDocSwitch
        ? timelineClips.find(
            (lc) =>
              lc.id === bc.id ||
              (lc.clipNumber === bc.clipNumber && (lc.partLabel || '') === (bc.partLabel || ''))
          )
        : undefined;
      const savedAudio = getSavedAudioEditForClip(bc, savedClipAudioEdits);
      const useLiveAudio =
        liveMatch &&
        (Boolean(liveMatch.audioMuted) ||
          Boolean(liveMatch.customVolumeSet) ||
          typeof liveMatch.audioFadeInSec === 'number' ||
          typeof liveMatch.audioFadeOutSec === 'number');
      const mergedMuted =
        savedAudio?.audioMuted !== undefined
          ? Boolean(savedAudio.audioMuted)
          : useLiveAudio
          ? Boolean(liveMatch?.audioMuted)
          : Boolean(bc.audioMuted);
      const mergedCustomVol =
        savedAudio?.customVolumeSet !== undefined
          ? Boolean(savedAudio.customVolumeSet)
          : useLiveAudio
          ? Boolean(liveMatch?.customVolumeSet)
          : Boolean(bc.customVolumeSet);
      const mergedFoleyVol =
        typeof savedAudio?.foleyVolume === 'number'
          ? savedAudio.foleyVolume
          : useLiveAudio && typeof liveMatch?.foleyVolume === 'number'
          ? liveMatch.foleyVolume
          : bc.foleyVolume;
      const mergedFadeIn =
        typeof savedAudio?.audioFadeInSec === 'number'
          ? savedAudio.audioFadeInSec
          : useLiveAudio && typeof liveMatch?.audioFadeInSec === 'number'
          ? liveMatch.audioFadeInSec
          : bc.audioFadeInSec;
      const mergedFadeOut =
        typeof savedAudio?.audioFadeOutSec === 'number'
          ? savedAudio.audioFadeOutSec
          : useLiveAudio && typeof liveMatch?.audioFadeOutSec === 'number'
          ? liveMatch.audioFadeOutSec
          : bc.audioFadeOutSec;

      return {
        ...bc,
        audioMuted: mergedMuted,
        customVolumeSet: mergedCustomVol || mergedMuted,
        foleyVolume: mergedFoleyVol,
        audioFadeInSec: mergedFadeIn,
        audioFadeOutSec: mergedFadeOut,
        reframe9x16Mode: liveMatch?.reframe9x16Mode || bc.reframe9x16Mode,
        reframeFocusXStart: liveMatch?.reframeFocusXStart ?? bc.reframeFocusXStart,
        reframeFocusXEnd: liveMatch?.reframeFocusXEnd ?? bc.reframeFocusXEnd,
        reframeFocusY: liveMatch?.reframeFocusY ?? bc.reframeFocusY,
        frameZoom16x9: Number((bc as any).frameTransformAt || 0) > Number((liveMatch as any)?.frameTransformAt || 0) ? bc.frameZoom16x9 : liveMatch?.frameZoom16x9 ?? bc.frameZoom16x9,
        frameZoom9x16: Number((bc as any).frameTransformAt || 0) > Number((liveMatch as any)?.frameTransformAt || 0) ? bc.frameZoom9x16 : liveMatch?.frameZoom9x16 ?? bc.frameZoom9x16,
        frameOffsetX16x9: Number((bc as any).frameTransformAt || 0) > Number((liveMatch as any)?.frameTransformAt || 0) ? bc.frameOffsetX16x9 : liveMatch?.frameOffsetX16x9 ?? bc.frameOffsetX16x9,
        frameOffsetY16x9: Number((bc as any).frameTransformAt || 0) > Number((liveMatch as any)?.frameTransformAt || 0) ? bc.frameOffsetY16x9 : liveMatch?.frameOffsetY16x9 ?? bc.frameOffsetY16x9,
        frameOffsetX9x16: Number((bc as any).frameTransformAt || 0) > Number((liveMatch as any)?.frameTransformAt || 0) ? bc.frameOffsetX9x16 : liveMatch?.frameOffsetX9x16 ?? bc.frameOffsetX9x16,
        frameOffsetY9x16: Number((bc as any).frameTransformAt || 0) > Number((liveMatch as any)?.frameTransformAt || 0) ? bc.frameOffsetY9x16 : liveMatch?.frameOffsetY9x16 ?? bc.frameOffsetY9x16,
        frameZoomInSec16x9: Number((bc as any).frameTransformAt || 0) > Number((liveMatch as any)?.frameTransformAt || 0) ? bc.frameZoomInSec16x9 : liveMatch?.frameZoomInSec16x9 ?? bc.frameZoomInSec16x9,
        frameZoomInSec9x16: Number((bc as any).frameTransformAt || 0) > Number((liveMatch as any)?.frameTransformAt || 0) ? bc.frameZoomInSec9x16 : liveMatch?.frameZoomInSec9x16 ?? bc.frameZoomInSec9x16,
        frameKeys16x9: Number((bc as any).frameTransformAt || 0) > Number((liveMatch as any)?.frameTransformAt || 0) ? bc.frameKeys16x9 : liveMatch?.frameKeys16x9 ?? bc.frameKeys16x9,
        frameKeys9x16: Number((bc as any).frameTransformAt || 0) > Number((liveMatch as any)?.frameTransformAt || 0) ? bc.frameKeys9x16 : liveMatch?.frameKeys9x16 ?? bc.frameKeys9x16,
        // A size/position saved in the documentary later than this browser's copy wins (set on another device)
        frameTransformAt: Math.max(Number((bc as any).frameTransformAt || 0), Number((liveMatch as any)?.frameTransformAt || 0)) || undefined,
        reframeConfidence: liveMatch?.reframeConfidence ?? bc.reframeConfidence,
        reframeReason: liveMatch?.reframeReason || bc.reframeReason,
        ...(() => {
          const dc = docManualReframeByNum.get(Number(bc.clipNumber));
          const localAt = Number((liveMatch as any)?.reframeUpdatedAt ?? (bc as any).reframeUpdatedAt ?? 0);
          if (!dc || Number(dc.reframeUpdatedAt) <= localAt) return {};
          return {
            reframe9x16Mode: dc.reframe9x16Mode,
            reframeFocusXStart: dc.reframeFocusXStart,
            reframeFocusXEnd: dc.reframeFocusXEnd ?? dc.reframeFocusXStart,
            reframeFocusY: dc.reframeFocusY ?? 50,
            reframeReason: dc.reframeReason,
            userReframed9x16: true,
            reframeUpdatedAt: Number(dc.reframeUpdatedAt),
          };
        })(),
        userReframed9x16: liveMatch?.userReframed9x16 ?? bc.userReframed9x16,
      };
    });

    if (
      activeDoc?.id &&
      savedDocOverlays?.userEditedClips &&
      (Array.isArray(savedDocOverlays.customTimelineClips) || parkedMapChanged)
    ) {
      const prevCustomArr: TimelineClipItem[] = Array.isArray(
        savedDocOverlays.customTimelineClips
      )
        ? (savedDocOverlays.customTimelineClips as TimelineClipItem[])
        : [];
      const prevSum = prevCustomArr
        .filter((c) => c.id !== 'fixed-doc-outro' && c.clipNumber !== 999)
        .reduce((acc, c) => acc + (Number(c.duration) || 0), 0);
      const nextSum = builtClips
        .filter((c) => c.id !== 'fixed-doc-outro' && c.clipNumber !== 999)
        .reduce((acc, c) => acc + (Number(c.duration) || 0), 0);
      const prevClosingClip = [...prevCustomArr]
        .reverse()
        .find((c) => c.id !== 'fixed-doc-outro' && c.clipNumber !== 999 && c.clipNumber > 0);
      const nextClosingClip = [...builtClips]
        .reverse()
        .find((c) => c.id !== 'fixed-doc-outro' && c.clipNumber !== 999 && c.clipNumber > 0);
      const durationRepaired =
        Math.abs(nextSum - prevSum) > 0.15 ||
        (prevClosingClip &&
          nextClosingClip &&
          Math.abs((nextClosingClip.duration || 0) - (prevClosingClip.duration || 0)) > 0.15);
      if (
        reconciledCustomStructureChanged ||
        parkedMapChanged ||
        durationRepaired ||
        sourceClipsForBuild !== bodyClips
      ) {
        persistDocOverlaysPatch(
          {
            customTimelineClips: builtClips,
            ...(parkedMapChanged ? { parkedTimelineClipsByNumber: nextParkedMap } : {}),
          },
          activeDoc.id
        );
      }
    }

    setTimelineClips(builtClips);
    if (builtClips.length > 0) {
      const savedClipIdForDoc =
        typeof savedDocOverlays?.selectedClipId === 'string' &&
        builtClips.some((c) => c.id === savedDocOverlays.selectedClipId)
          ? savedDocOverlays.selectedClipId
          : null;
      const liveClipId =
        !isDocSwitch && selectedClipId && builtClips.some((c) => c.id === selectedClipId)
          ? selectedClipId
          : null;
      const preferredId =
        (isDocSwitch ? savedClipIdForDoc || liveClipId : liveClipId || savedClipIdForDoc) ||
        builtClips[0].id;
      if (preferredId !== selectedClipId) {
        setSelectedClipId(preferredId);
        setSelectedClipIds([preferredId]);
      }
      if (!isPlaying && !isFitEntireProject) {
        window.requestAnimationFrame(() => {
          const el = timelineScrollContainerRef.current;
          if (el && el.clientWidth > 0) {
            el.scrollLeft = savedTimelineScrollRef.current.left;
            el.scrollTop = savedTimelineScrollRef.current.top;
          }
          if (timelineRulerScrollRef.current) {
            timelineRulerScrollRef.current.scrollLeft = savedTimelineScrollRef.current.left;
          }
        });
      }
    } else if (selectedClipId !== null || selectedClipIds.length > 0) {
      setSelectedClipId(null);
      setSelectedClipIds([]);
    }
    if (isDocSwitch) {
      setSeparatedVocalSegments(
        Array.isArray(savedDocOverlays?.separatedVocalSegments)
          ? savedDocOverlays.separatedVocalSegments
          : []
      );
      setSelectedVocalSegmentId(null);
      setSeparatedMusicSegments(
        Array.isArray(savedDocOverlays?.separatedMusicSegments)
          ? savedDocOverlays.separatedMusicSegments
          : []
      );
      setSelectedMusicSegmentId(null);
    }

    // 2. Build Captions Track (Track 2) aligned to docIntroPlacement and real Voiceover audio
    const activeWordsLimit =
      aspectRatio === '9:16' ? captionWordsPerLine9x16 : captionWordsPerLine16x9;
    const formatCapList = (list: TimelineCaptionItem[]) =>
      reformatCaptionItems(list, {
        maxCharsPerLine: captionMaxChars,
        maxWordsPerLine: activeWordsLimit,
          avoidSingleWordLines: aspectRatio === '16:9',
        mode: captionLineMode,
        lineMode: captionLineMode === 'wrap' ? 'wrap' : 'single',
      } as any);

    let syncRunningSec = 0;
    let syncPostSloganBounds: { start: number; end: number; duration: number } | null = null;
    for (const bc of builtClips) {
      const bStart = syncRunningSec;
      const bEnd = syncRunningSec + bc.duration;
      syncRunningSec = bEnd;
      if ((bc.id === 'fixed-doc-intro' || bc.clipNumber === 0) && bStart > 2) {
        syncPostSloganBounds = { start: bStart, end: bEnd, duration: bc.duration };
        break;
      }
    }
    const syncProjOpts: ProjectAudioCaptionsOptions = {
      introPlacement: docIntroPlacement,
      voiceStartOffsetSec: entrySec,
      postSloganIntroBounds: syncPostSloganBounds,
      sloganSplitAudioSec,
      introDurSec: FIXED_INTRO_SEC,
    };
    const hasScriptOrTtsAudio =
      Boolean(activeDoc.voiceoverScript && activeDoc.voiceoverScript.trim()) ||
      Boolean(resolveTtsAlignSidecarStem(effectiveVoiceoverUrl, activeDoc.masterAudioUrl));
    const currentCaptionsSig = `${String(effectiveVoiceoverUrl || activeDoc.masterAudioUrl || '').split(/[?#]/)[0]}|${computeVoiceScriptAlignHash(activeDoc.voiceoverScript || '')}`;

    if (
      savedDocOverlays?.userEditedCaptions &&
      Array.isArray(savedDocOverlays.captions) &&
      savedDocOverlays.captions.length > 0
    ) {
      userEditedCaptionsDocIdRef.current = docId;
      if (isDocSwitch || isIntroPlacementSwitch || captions.length === 0) {
        const projectedSaved = projectAudioCaptionsToTimeline(
          savedDocOverlays.captions,
          syncProjOpts
        );
        const alignedSaved = projectedSaved.every(
          (c) => typeof c.audioStartSec === 'number' && Number.isFinite(c.audioStartSec)
        )
          ? projectedSaved
          : formatCapList(projectedSaved);
        setCaptions(alignedSaved);
        persistDocOverlaysPatch(
          { captions: alignedSaved, voiceStartOffsetSec: entrySec },
          docId
        );
      }
    } else if (userEditedCaptionsDocIdRef.current !== docId || isIntroPlacementSwitch) {
      if (isVideo76Doc && prealignedVideo76SrtRef.current) {
        const parsed76 = formatCapList(
          alignCaptionsToIntroPlacement(
            parseSrtToCaptionItems(prealignedVideo76SrtRef.current, entrySec),
            docIntroPlacement,
            clip1HookDur,
            FIXED_INTRO_SEC,
            sloganSplitAudioSec
          )
        );
        setCaptions(parsed76);
        persistDocOverlaysPatch({ captions: parsed76, voiceStartOffsetSec: entrySec }, docId);
      } else if (
        !isVideo76Doc &&
        !isDocSwitch &&
        activeAlignSourceByDocRef.current[docId] === 'vosk-v2' &&
        captions.length > 0
      ) {
        setCaptions((prevCaps) => {
          if (prevCaps.length === 0) return prevCaps;
          const reproj = projectAudioCaptionsToTimeline(prevCaps, syncProjOpts);
          persistDocOverlaysPatch(
            {
              captions: reproj,
              voiceStartOffsetSec: entrySec,
              captionsAlignVersion: CAPTIONS_ALIGN_VERSION,
              captionsSourceSignature: currentCaptionsSig,
            },
            docId
          );
          return reproj;
        });
      } else if (
        !isVideo76Doc &&
        savedDocOverlays?.captionsAlignVersion === CAPTIONS_ALIGN_VERSION &&
        savedDocOverlays?.captionsSourceSignature === currentCaptionsSig &&
        Array.isArray(savedDocOverlays.captions) &&
        savedDocOverlays.captions.length > 0
      ) {
        const hydratedV4 = projectAudioCaptionsToTimeline(
          savedDocOverlays.captions,
          syncProjOpts
        );
        setCaptions(hydratedV4);
        persistDocOverlaysPatch(
          { captions: hydratedV4, voiceStartOffsetSec: entrySec },
          docId
        );
      } else if (
        activeDoc.voiceoverScript &&
        activeDoc.voiceoverScript.trim() &&
        effectiveVoiceDurationSec > 1
      ) {
        handleGenerateAutoCaptionsFromVoice(
          entrySec,
          effectiveVoiceDurationSec,
          detectedAudioSilencesRef.current
        );
      } else if (!hasScriptOrTtsAudio && activeDoc.correctedSrt && activeDoc.correctedSrt.trim()) {
        const alignedSrt = formatCapList(
          alignCaptionsToIntroPlacement(
            parseSrtToCaptionItems(activeDoc.correctedSrt, entrySec),
            docIntroPlacement,
            clip1HookDur,
            FIXED_INTRO_SEC,
            sloganSplitAudioSec
          )
        );
        setCaptions(alignedSrt);
        persistDocOverlaysPatch({ captions: alignedSrt, voiceStartOffsetSec: entrySec }, docId);
      } else if (!hasScriptOrTtsAudio) {
        handleGenerateAutoCaptionsFromVoice(entrySec, effectiveVoiceDurationSec);
      }
    }

    // 3. Build Flow Music / Suno Multi-Scene Track (Track 5) — OFF during 8s Intro and OFF during 8s Outro at the end
    const fullVoiceSpanSec =
      effectiveVoiceDurationSec > 0 ? FIXED_INTRO_SEC + clip1HookDur + effectiveVoiceDurationSec : 0;
    const builtClipsWithoutOutro = builtClips.filter(
      (c) => c.id !== 'fixed-doc-outro' && c.clipNumber !== 999
    );
    const clip82EndBeforeOutroSec = builtClipsWithoutOutro.reduce(
      (acc, item) => acc + item.duration,
      0
    );
    const allScriptEstimatedEndSec = hasStage6ScriptClips
      ? FIXED_INTRO_SEC + clip1HookDur + Math.max(0, allDocClips.length - 1) * standardDur
      : 0;
    const uniqueBuiltBodyNums = new Set(
      builtClipsWithoutOutro
        .filter((c) => c.id !== 'fixed-doc-intro' && c.clipNumber > 0 && c.clipNumber < 999)
        .map((c) => c.clipNumber)
    );
    const hasFullBuiltBodyGrid =
      !hasStage6ScriptClips || uniqueBuiltBodyNums.size >= allDocClips.length;
    const bodySpanEndSec =
      (isSyncFullScheduleReviewed || hasFullBuiltBodyGrid) &&
      clip82EndBeforeOutroSec > FIXED_INTRO_SEC + 30
        ? clip82EndBeforeOutroSec
        : Math.max(
            FIXED_INTRO_SEC + bodyClips.reduce((acc, item) => acc + item.duration, 0),
            fullVoiceSpanSec,
            allScriptEstimatedEndSec,
            activeDoc.targetDurationSeconds || 120
          );
    const sunoList = activeDoc.sunoTracks || [];
    if (sunoList.length > 0) {
      const savedMusicEdits: Record<
        string,
        {
          volume?: number;
          userSetVolumeV10?: boolean;
          userSetFadesV5?: boolean;
          fadeInSec?: number;
          fadeOutSec?: number;
        }
      > =
        savedDocOverlays && typeof savedDocOverlays.musicTrackEdits === 'object'
          ? savedDocOverlays.musicTrackEdits
          : {};
      let cursorSec = FIXED_INTRO_SEC; // Music starts at 00:08 (after 8s Intro)
      const lastSongDurSec = 90; // Mandatory 1:30 for the closing song reaching the end of Clip 82 before Outro
      const nonLastCount = Math.max(1, sunoList.length - 1);
      const lastSongTargetStartSec = Math.max(
        FIXED_INTRO_SEC + (sunoList.length > 1 ? nonLastCount * 60 : 0),
        Number((bodySpanEndSec - lastSongDurSec).toFixed(2))
      );
      const preLastSpanSec = Math.max(0, lastSongTargetStartSec - FIXED_INTRO_SEC);
      // Mandatory space without music between each song: minimum 30s (0:30) and maximum 60s (1:00)
      const idealGapSec =
        sunoList.length > 1 ? (preLastSpanSec - nonLastCount * 150) / nonLastCount : 0;
      const silenceGapSec =
        sunoList.length > 1
          ? Math.min(60, Math.max(30, Number.isFinite(idealGapSec) ? Math.round(idealGapSec) || 45 : 45))
          : 0;
      const availablePreLastSpanSec = Math.max(
        nonLastCount * 30,
        preLastSpanSec - nonLastCount * silenceGapSec
      );
      const evenPreLastDurSec = Number((availablePreLastSpanSec / nonLastCount).toFixed(2));

      // Etapa 8: si la tarjeta trae el rango de Gemini ("00:08 - 02:38 ...") y su duración ("2:30"),
      // la canción se coloca exactamente ahí. Sin datos válidos se usa el reparto automático de abajo.
      const parseClockSec = (s: string): number | null => {
        const p = String(s || '').trim().match(/^(?:(\d{1,2}):)?(\d{1,2}):(\d{2})$/);
        if (!p) return null;
        return (Number(p[1] || 0) * 3600) + Number(p[2]) * 60 + Number(p[3]);
      };
      const geminiPlacementFor = (st: { videoTimeRange?: string; duration?: string }) => {
        const range = String(st.videoTimeRange || '').match(
          /(\d{1,2}:\d{2}(?::\d{2})?)\s*[-–—]\s*(\d{1,2}:\d{2}(?::\d{2})?)/
        );
        if (!range) return null;
        const rStart = parseClockSec(range[1]);
        const rEnd = parseClockSec(range[2]);
        if (rStart === null || rEnd === null || rEnd <= rStart) return null;
        const cardDur = parseClockSec((String(st.duration || '').match(/\d{1,2}:\d{2}/) || [''])[0]);
        const start = Math.max(FIXED_INTRO_SEC, rStart);
        const dur = cardDur && cardDur > 0 ? cardDur : rEnd - rStart;
        const end = Math.min(bodySpanEndSec, start + dur);
        if (end - start < 5) return null;
        return { start: Number(start.toFixed(2)), duration: Number((end - start).toFixed(2)) };
      };

      const builtMusic: TimelineMusicItem[] = sunoList.map((st, idx) => {
        const trackNum = idx + 1;
        const trackId = st.id || `music-${trackNum}`;
        const savedEdit = savedMusicEdits[String(trackNum)] || savedMusicEdits[trackId] || {};
        const isLast = idx === sunoList.length - 1;

        let startSec = cursorSec;
        let durSec = isLast ? lastSongDurSec : evenPreLastDurSec;
        const geminiPlacement = geminiPlacementFor(st);

        if (geminiPlacement) {
          // Posición y duración que propone Gemini en la tarjeta de la Etapa 8
          startSec = geminiPlacement.start;
          durSec = geminiPlacement.duration;
          // La última canción SIEMPRE termina con el último clip antes del Outro: si el rango de Gemini
          // acaba antes, se corre entera hacia el final (misma duración, sin pisar la canción anterior).
          if (isLast && sunoList.length > 1 && startSec + durSec < bodySpanEndSec - 0.25) {
            const prevSongEndSec = Math.max(FIXED_INTRO_SEC, cursorSec - silenceGapSec);
            startSec = Number(Math.max(prevSongEndSec, bodySpanEndSec - durSec).toFixed(2));
          }
        } else if (isLast) {
          // Always anchor the last song so it reaches 100% to the end of Clip 82 right before the Outro
          startSec = sunoList.length > 1 ? lastSongTargetStartSec : Math.max(FIXED_INTRO_SEC, lastSongTargetStartSec);
          durSec = Math.max(10, Number((bodySpanEndSec - startSec).toFixed(2)));
        } else if (idx === sunoList.length - 2) {
          // Guarantee exact [30s, 60s] space without music right before the closing song
          durSec = Math.max(30, Number((lastSongTargetStartSec - silenceGapSec - startSec).toFixed(2)));
        } else {
          // Ensure earlier songs leave exact room for the 30s–60s spaces without music
          const maxAllowedEnd = lastSongTargetStartSec - (nonLastCount - idx) * silenceGapSec;
          if (startSec + durSec > maxAllowedEnd) {
            durSec = Math.max(30, Number((maxAllowedEnd - startSec).toFixed(2)));
          }
        }

        // La primera canción SIEMPRE arranca con el Clip 1 (no con el Clip 2 que suele proponer Gemini),
        // conservando el mismo punto final.
        if (idx === 0) {
          const clip1StartSec = docIntroPlacement === 'INTRO_POST_SLOGAN' ? 0 : FIXED_INTRO_SEC;
          const firstSongEndSec = startSec + durSec;
          if (startSec > clip1StartSec && firstSongEndSec - clip1StartSec >= 5) {
            startSec = clip1StartSec;
            durSec = Number((firstSongEndSec - clip1StartSec).toFixed(2));
          }
        }

        cursorSec = Number((startSec + durSec + silenceGapSec).toFixed(2));
        return {
          id: trackId,
          trackNumber: trackNum,
          title: st.title || `Canción ${trackNum}`,
          start: startSec,
          duration: durSec,
          volume:
            savedEdit.userSetVolumeV10 && typeof savedEdit.volume === 'number'
              ? savedEdit.volume
              : DEFAULT_MUSIC_TRACK_VOLUME_PCT,
          audioUrl: combinedSunoAudioMap[trackNum] || st.audioUrl,
          isLast90Sec: isLast,
          fadeInSec:
            savedEdit.userSetFadesV5 && typeof savedEdit.fadeInSec === 'number'
              ? savedEdit.fadeInSec
              : 5,
          fadeOutSec:
            savedEdit.userSetFadesV5 && typeof savedEdit.fadeOutSec === 'number'
              ? savedEdit.fadeOutSec
              : 5,
          videoTimeRange: st.videoTimeRange,
        };
      });
      setMusicTracks((prev) =>
        builtMusic.map((bm) => {
          const prevMatch =
            !isDocSwitch &&
            prev.find((p) => p.trackNumber === bm.trackNumber || p.id === bm.id);
          const savedEdit =
            savedMusicEdits[String(bm.trackNumber)] || savedMusicEdits[bm.id] || {};
          return {
            ...bm,
            volume:
              savedEdit.userSetVolumeV10 && typeof savedEdit.volume === 'number'
                ? savedEdit.volume
                : prevMatch &&
                  typeof prevMatch.volume === 'number' &&
                  prevMatch.volume !== 24 &&
                  prevMatch.volume !== 10
                ? prevMatch.volume
                : DEFAULT_MUSIC_TRACK_VOLUME_PCT,
            fadeInSec:
              savedEdit.userSetFadesV5 && typeof savedEdit.fadeInSec === 'number'
                ? savedEdit.fadeInSec
                : prevMatch &&
                  typeof prevMatch.fadeInSec === 'number' &&
                  prevMatch.fadeInSec !== 2.5
                ? prevMatch.fadeInSec
                : 5,
            fadeOutSec:
              savedEdit.userSetFadesV5 && typeof savedEdit.fadeOutSec === 'number'
                ? savedEdit.fadeOutSec
                : prevMatch &&
                  typeof prevMatch.fadeOutSec === 'number' &&
                  prevMatch.fadeOutSec !== 3.0
                ? prevMatch.fadeOutSec
                : 5,
          };
        })
      );
    }
  };

  const reviewedClipsSignature = (activeDoc?.clips || [])
    .map(
      (c) =>
        `${c.clipNumber}:${c.reviewedForEditor ? 1 : 0}:${c.videoReady ? 1 : 0}:${c.videoAuditStatus || ''}:${c.auditStatus || ''}:${c.discardedVideoFileName || ''}:${c.videoDiscardOverriddenAt || 0}:${c.isStaticBroll ? 1 : 0}:${c.brollCameraMotion || ''}:${c.videoSavedFileName || ''}:${(c as any).reframeUpdatedAt || 0}`
    )
    .join('|');

  useEffect(() => {
    const clipsList = activeDoc?.clips || [];
    if (clipsList.length === 0) return;
    const byNum = new Map<number, DocumentaryClip>();
    for (const c of clipsList) {
      if (c && typeof c.clipNumber === 'number') byNum.set(c.clipNumber, c);
    }
    setLocalServerClipVideosMap((prev) => {
      let changed = false;
      const next: Record<number, string> = {};
      for (const [kStr, url] of Object.entries(prev)) {
        const kNum = Number(kStr);
        const meta = extractEditorMediaUrlMeta(url);
        if (isEditorFolderItemDiscarded(byNum.get(kNum), meta.fileName, meta.mtimeMs, url)) {
          changed = true;
          continue;
        }
        next[kNum] = url;
      }
      return changed ? next : prev;
    });
  }, [activeDoc?.id, reviewedClipsSignature]);

  const allKnownClipNums = Array.from(
    new Set([
      ...Object.keys(localServerClipVideosMap).map(Number),
      ...Object.keys(capturedClipVideosMap).map(Number),
      ...Object.keys(firstFrameByClip).map(Number),
    ])
  )
    .filter((n) => n >= 0)
    .sort((a, b) => a - b);

  const capturedClipVideosSignature = `${mediaBridgeGen}:${getMediaBridgeSnapshot().activeOrigin}|` + allKnownClipNums
    .map(
      (k) =>
        `${k}:${rewriteMediaBridgeUrl(localServerClipVideosMap[k] || '').slice(-36)}:${rewriteMediaBridgeUrl(
          capturedClipVideosMap[k] || ''
        ).slice(-36)}:${rewriteMediaBridgeUrl(firstFrameByClip[k] || '').slice(-24)}`
    )
    .join('|');

  const sunoTracksSignature = (activeDoc?.sunoTracks || [])
    .map((t, i) => `${i + 1}:${t.title || ''}:${t.videoTimeRange || ''}:${t.duration || ''}:${rewriteMediaBridgeUrl(t.audioUrl || '').slice(-28)}`)
    .join('|');

  const capturedSunoSignature = `${mediaBridgeGen}|` + Object.entries({
    ...localServerSunoMap,
    ...capturedSunoAudioMap,
  })
    .sort((a, b) => Number(a[0]) - Number(b[0]))
    .map(([k, v]) => `${k}:${v ? rewriteMediaBridgeUrl(v).slice(-28) : ''}`)
    .join('|');

  useEffect(() => {
    syncTracksFromDocumentary();
  }, [
    activeDoc?.id,
    activeDoc?.promptConfig?.UBICACION_INTRO_MARCA,
    reviewedClipsSignature,
    showOnlyReviewedClips,
    capturedClipVideosSignature,
    sunoTracksSignature,
    capturedSunoSignature,
    folderVoiceoverUrl,
    effectiveVoiceDurationSec,
    sloganSplitAudioSec,
    officialIntroUrl,
    officialAssetsVersion,
    officialIntroTier,
    officialOutroTier,
    mediaBridgeGen,
  ]);

  const prealignedVideo76SrtRef = useRef<string>('');

  const getPostSloganBoundsFromClips = (
    clipsList: TimelineClipItem[]
  ): { start: number; end: number; duration: number } | null => {
    let cur = 0;
    for (const c of clipsList) {
      const s = cur;
      const e = cur + c.duration;
      cur = e;
      if ((c.id === 'fixed-doc-intro' || c.clipNumber === 0) && s > 2) {
        return { start: s, end: e, duration: c.duration };
      }
    }
    return null;
  };

  const buildCurrentCaptionsSignature = (): string => {
    const cleanVoice = String(effectiveVoiceoverUrl || activeDoc?.masterAudioUrl || '').split(
      /[?#]/
    )[0];
    const sHash = computeVoiceScriptAlignHash(activeDoc?.voiceoverScript || '');
    return `${cleanVoice}|${sHash}`;
  };

  // Preserve 100% of user's manually edited caption texts from legacy < v4 overlays while upgrading timestamps to exact V4 audio coordinates
  const reanchorLegacyManualCaptions = (
    legacyCaps: TimelineCaptionItem[],
    freshAudioCaps: TimelineCaptionItem[]
  ): TimelineCaptionItem[] => {
    if (legacyCaps.length === 0 || freshAudioCaps.length === 0) return freshAudioCaps;
    const acousticWords: CaptionTimedWord[] = [];
    for (const fc of freshAudioCaps) {
      if (Array.isArray(fc.words) && fc.words.length > 0) {
        acousticWords.push(...fc.words);
      } else {
        const toks = String(fc.text || '')
          .replace(/\s+/g, ' ')
          .trim()
          .split(' ')
          .filter(Boolean);
        if (toks.length === 0) continue;
        const aS = Number(fc.audioStartSec ?? fc.start ?? 0);
        const aE = Math.max(aS + 0.15, Number(fc.audioEndSec ?? fc.end ?? aS + 0.4));
        const ws = toks.map((t) => Math.max(1, spokenSpanishSyllableWeight(t)));
        const totW = Math.max(1, ws.reduce((a, b) => a + b, 0));
        let acc = 0;
        toks.forEach((t, idx) => {
          const wS = aS + (acc / totW) * (aE - aS);
          acc += ws[idx];
          const wE = idx === toks.length - 1 ? aE : aS + (acc / totW) * (aE - aS);
          acousticWords.push({ text: t, audioStartSec: wS, audioEndSec: wE, breakFlag: 0 });
        });
      }
    }
    if (acousticWords.length === 0) return freshAudioCaps;

    const legacyWeights = legacyCaps.map((lc) =>
      Math.max(1, spokenSpanishSyllableWeight(lc.text || ''))
    );
    const totalLegW = Math.max(1, legacyWeights.reduce((a, b) => a + b, 0));
    const acWeights = acousticWords.map((aw) =>
      Math.max(1, spokenSpanishSyllableWeight(aw.text || ''))
    );
    const totalAcW = Math.max(1, acWeights.reduce((a, b) => a + b, 0));
    const acCum: number[] = [0];
    for (let i = 0; i < acWeights.length; i++) {
      acCum.push(acCum[i] + acWeights[i]);
    }

    const findWordIdxForRatio = (ratio: number): number => {
      const target = Math.max(0, Math.min(totalAcW, ratio * totalAcW));
      let lo = 0;
      let hi = acWeights.length - 1;
      while (lo < hi) {
        const mid = (lo + hi) >> 1;
        if (acCum[mid + 1] < target) lo = mid + 1;
        else hi = mid;
      }
      return lo;
    };

    let legAcc = 0;
    return legacyCaps.map((lc, idx) => {
      const r0 = legAcc / totalLegW;
      legAcc += legacyWeights[idx];
      const r1 = idx === legacyCaps.length - 1 ? 1 : legAcc / totalLegW;
      const wIdx0 = findWordIdxForRatio(r0);
      const wIdx1 = Math.max(wIdx0, findWordIdxForRatio(Math.max(r0, r1 - 1e-6)));
      const aStart = acousticWords[wIdx0].audioStartSec;
      const aEnd = Math.max(aStart + 0.15, acousticWords[wIdx1].audioEndSec);
      const cleanToks = String(lc.text || '')
        .replace(/\s+/g, ' ')
        .trim()
        .split(' ')
        .filter(Boolean);
      const sliceWords = acousticWords.slice(wIdx0, wIdx1 + 1);
      const mappedWords =
        sliceWords.length === cleanToks.length
          ? sliceWords.map((sw, k) => ({ ...sw, text: cleanToks[k] }))
          : undefined;
      return {
        ...lc,
        index: idx + 1,
        audioStartSec: Number(aStart.toFixed(3)),
        audioEndSec: Number(aEnd.toFixed(3)),
        start: Number(aStart.toFixed(3)),
        end: Number(aEnd.toFixed(3)),
        words: mappedWords,
        alignSource: 'manual' as const,
      };
    });
  };

  const applySidecarAlignmentToEditor = (
    alignment: VoiceAlignmentSidecarV2,
    targetDocId: string,
    forceOverwrite = false
  ): boolean => {
    if (!alignment || !Array.isArray(alignment.words) || alignment.words.length === 0) {
      return false;
    }
    const stemKey =
      resolveTtsAlignSidecarStem(effectiveVoiceoverUrl, activeDoc?.masterAudioUrl) || targetDocId;
    sidecarAlignmentByStemRef.current[stemKey] = alignment;

    let resolvedSplitSec = sloganSplitAudioSec;
    if (typeof alignment.sloganSplitAudioSec === 'number' && alignment.sloganSplitAudioSec > 5) {
      resolvedSplitSec =
        typeof alignment.sloganSilenceEndAudioSec === 'number' &&
        alignment.sloganSilenceEndAudioSec > alignment.sloganSplitAudioSec
          ? Number(
              ((alignment.sloganSplitAudioSec + alignment.sloganSilenceEndAudioSec) * 0.5).toFixed(
                3
              )
            )
          : Number(alignment.sloganSplitAudioSec.toFixed(3));
      setDetectedSloganSplitSec(resolvedSplitSec);
    }
    if (typeof alignment.audioDurationSec === 'number' && alignment.audioDurationSec > 1) {
      setVoiceDurationSec((prev) => (prev > 1 ? prev : alignment.audioDurationSec));
    }

    const activeWordsLimit =
      aspectRatio === '9:16' ? captionWordsPerLine9x16 : captionWordsPerLine16x9;
    const rawBuilt = buildAudioCaptionsFromSidecarWords(alignment.words, {
      maxWordsPerLine:
        captionLineMode === 'original' ? 9 : activeWordsLimit > 0 ? activeWordsLimit : 6,
      maxCharsPerLine:
        captionLineMode === 'original' ? 46 : captionMaxChars > 0 ? captionMaxChars : 32,
      lineMode: captionLineMode === 'wrap' ? 'wrap' : 'single',
    });
    if (!Array.isArray(rawBuilt) || rawBuilt.length === 0) return false;

    const canonicalAudioCaps: TimelineCaptionItem[] = rawBuilt.map((it, idx) => {
      const aS = Number(it.audioStartSec ?? it.start ?? 0);
      const aE = Math.max(aS + 0.12, Number(it.audioEndSec ?? it.end ?? aS + 0.25));
      return {
        id: it.id || `vosk-cap-${idx + 1}`,
        index: idx + 1,
        text: String(it.text || ''),
        audioStartSec: Number(aS.toFixed(3)),
        audioEndSec: Number(aE.toFixed(3)),
        start: Number(aS.toFixed(3)),
        end: Number(aE.toFixed(3)),
        words: Array.isArray(it.words) ? it.words : undefined,
        alignSource: 'vosk-v2',
      };
    });

    const effectiveMode =
      activeDoc?.promptConfig?.UBICACION_INTRO_MARCA === 'INTRO_POST_SLOGAN' ||
      introPlacementMode === 'INTRO_POST_SLOGAN'
        ? 'INTRO_POST_SLOGAN'
        : 'INTRO_INICIO_00';
    const livePsBounds = getPostSloganBoundsFromClips(timelineClips);
    const projOpts: ProjectAudioCaptionsOptions = {
      introPlacement: effectiveMode,
      voiceStartOffsetSec,
      postSloganIntroBounds: livePsBounds,
      sloganSplitAudioSec: resolvedSplitSec,
      introDurSec: 8,
    };

    const savedOverlays = readSavedDocOverlays(targetDocId);
    const sig = buildCurrentCaptionsSignature();

    if (
      !forceOverwrite &&
      savedOverlays?.userEditedCaptions &&
      Array.isArray(savedOverlays.captions) &&
      savedOverlays.captions.length > 0
    ) {
      userEditedCaptionsDocIdRef.current = targetDocId;
      if (savedOverlays.captionsAlignVersion === CAPTIONS_ALIGN_VERSION) {
        const projectedManual = projectAudioCaptionsToTimeline(savedOverlays.captions, projOpts);
        activeAlignSourceByDocRef.current[targetDocId] = 'manual';
        setCaptions(projectedManual);
        persistDocOverlaysPatch(
          {
            captions: projectedManual,
            captionsAlignVersion: CAPTIONS_ALIGN_VERSION,
            captionsSourceSignature: sig,
          },
          targetDocId
        );
        return true;
      }
      const migratedManual = reanchorLegacyManualCaptions(
        savedOverlays.captions,
        canonicalAudioCaps
      );
      const projectedMigrated = projectAudioCaptionsToTimeline(migratedManual, projOpts);
      activeAlignSourceByDocRef.current[targetDocId] = 'manual';
      setCaptions(projectedMigrated);
      persistDocOverlaysPatch(
        {
          captions: projectedMigrated,
          userEditedCaptions: true,
          captionsAlignVersion: CAPTIONS_ALIGN_VERSION,
          captionsSourceSignature: sig,
        },
        targetDocId
      );
      return true;
    }

    if (forceOverwrite) {
      userEditedCaptionsDocIdRef.current = '';
    }
    const projectedVosk = projectAudioCaptionsToTimeline(canonicalAudioCaps, projOpts);
    activeAlignSourceByDocRef.current[targetDocId] = 'vosk-v2';
    setCaptions(projectedVosk);
    persistDocOverlaysPatch(
      {
        captions: projectedVosk,
        captionsAlignVersion: CAPTIONS_ALIGN_VERSION,
        captionsSourceSignature: sig,
        ...(forceOverwrite ? { userEditedCaptions: false } : {}),
      },
      targetDocId
    );
    return true;
  };

  const loadOrGenerateSidecarAlignment = async (
    forceBackend = false,
    signal?: { cancelled: boolean }
  ): Promise<boolean> => {
    if (!activeDoc || isVideo76Doc) return false;
    const docId = activeDoc.id || 'default';
    const stem = resolveTtsAlignSidecarStem(effectiveVoiceoverUrl, activeDoc.masterAudioUrl);
    const expectedHash = computeVoiceScriptAlignHash(activeDoc.voiceoverScript || '');
    const hasScript = Boolean(activeDoc.voiceoverScript && activeDoc.voiceoverScript.trim());

    if (!forceBackend && stem && sidecarAlignmentByStemRef.current[stem]) {
      const cachedMem = sidecarAlignmentByStemRef.current[stem];
      if (!hasScript || !cachedMem.scriptHash || cachedMem.scriptHash === expectedHash) {
        return applySidecarAlignmentToEditor(cachedMem, docId, false);
      }
    }

    // 1. Try portable static sidecar (<stem>.align.json) across BASE_URL, relative path, and media bridges
    if (!forceBackend && stem) {
      const baseEnv = String((import.meta as any).env?.BASE_URL || '/').replace(/\/?$/, '/');
      const bridgeBases = getEditorMediaBridgeBases();
      const candidateUrls = Array.from(
        new Set(
          [
            `${baseEnv}tts-files/${encodeURIComponent(stem)}.align.json`,
            `tts-files/${encodeURIComponent(stem)}.align.json`,
            ...bridgeBases
              .filter(Boolean)
              .map((b) => `${b}/tts-files/${encodeURIComponent(stem)}.align.json`),
          ].filter(Boolean)
        )
      );

      for (const url of candidateUrls) {
        if (signal?.cancelled) return false;
        try {
          const resp = await fetch(url, { cache: 'no-cache' });
          if (!resp.ok) continue;
          const ct = String(resp.headers.get('content-type') || '').toLowerCase();
          if (ct.includes('text/html')) continue;
          const parsed = (await resp.json()) as VoiceAlignmentSidecarV2;
          if (
            parsed &&
            parsed.version === 2 &&
            Array.isArray(parsed.words) &&
            parsed.words.length > 0
          ) {
            if (!hasScript || !parsed.scriptHash || parsed.scriptHash === expectedHash) {
              if (signal?.cancelled) return false;
              return applySidecarAlignmentToEditor(parsed, docId, false);
            }
          }
        } catch {}
      }
    }

    // 2. If sidecar is missing, scriptHash changed, or forceBackend requested -> call POST /api/editor/align-captions on reachable Mac server
    if (!stem && !effectiveVoiceoverUrl && !activeDoc.masterAudioUrl) return false;
    const candidateOrigins = Array.from(new Set(['', ...getEditorMediaBridgeBases()]));
    for (const origin of candidateOrigins) {
      if (signal?.cancelled) return false;
      try {
        const resp = await fetch(`${origin}/api/editor/align-captions`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            docId: activeDoc.id,
            audioUrl: effectiveVoiceoverUrl || activeDoc.masterAudioUrl || '',
            voiceoverScript: activeDoc.voiceoverScript || '',
            force: Boolean(forceBackend),
          }),
        });
        if (!resp.ok) continue;
        const data = await resp.json();
        if (
          data?.ok &&
          data?.alignment &&
          data.alignment.version === 2 &&
          Array.isArray(data.alignment.words) &&
          data.alignment.words.length > 0
        ) {
          if (signal?.cancelled) return false;
          return applySidecarAlignmentToEditor(
            data.alignment as VoiceAlignmentSidecarV2,
            docId,
            forceBackend
          );
        }
      } catch {}
    }

    return false;
  };

  const handleForceResyncCaptions = async () => {
    if (!activeDoc) return;
    setStatusMessage(
      '⏳ Sincronizando subtítulos acústicamente palabra por palabra con la Voz Narrativa...'
    );
    const appliedVosk = await loadOrGenerateSidecarAlignment(true);
    if (appliedVosk) {
      setStatusMessage(
        `✅ Subtítulos sincronizados palabra por palabra (Vosk Forced Alignment) desde 00:${String(
          Math.floor(voiceStartOffsetSec)
        ).padStart(2, '0')} hasta ${formatTimeMMSS(totalDurationSec)}.`
      );
      return;
    }
    handleGenerateAutoCaptionsFromVoice(
      voiceStartOffsetSec,
      effectiveVoiceDurationSec,
      detectedAudioSilencesRef.current,
      true
    );
    setStatusMessage(
      `💬 Subtítulos resincronizados acústicamente (WebAudio 3-Tier V2) desde 00:${String(
        Math.floor(voiceStartOffsetSec)
      ).padStart(2, '0')} hasta ${formatTimeMMSS(totalDurationSec)}.`
    );
  };

  // Automatically load <stem>.align.json (or generate on Mac if missing/outdated) for every documentary with TTS master audio
  useEffect(() => {
    if (!activeDoc || isVideo76Doc) return;
    const signal = { cancelled: false };
    loadOrGenerateSidecarAlignment(false, signal);
    return () => {
      signal.cancelled = true;
    };
  }, [
    isVideo76Doc,
    activeDoc?.id,
    effectiveVoiceoverUrl,
    activeDoc?.masterAudioUrl,
    activeDoc?.voiceoverScript,
  ]);

  // Auto-Generate Captions directly from Voiceover using WebAudio 3-Tier V2 Acoustic Alignment (Paragraphs & [pausa] -> Sentences & Clauses -> 20ms Voiced-Frame Integral)
  const handleGenerateAutoCaptionsFromVoice = (
    customEntryOffset?: number,
    customVoiceDurSec?: number,
    customSilences?: Array<{ start: number; end: number; dur: number }>,
    forceOverwrite = false
  ) => {
    if (!activeDoc) return;
    const docId = activeDoc.id || 'default';
    const stem = resolveTtsAlignSidecarStem(effectiveVoiceoverUrl, activeDoc.masterAudioUrl);
    const expectedHash = computeVoiceScriptAlignHash(activeDoc.voiceoverScript || '');

    if (!isVideo76Doc && stem && sidecarAlignmentByStemRef.current[stem]) {
      const memAlign = sidecarAlignmentByStemRef.current[stem];
      if (
        !activeDoc.voiceoverScript?.trim() ||
        !memAlign.scriptHash ||
        memAlign.scriptHash === expectedHash
      ) {
        applySidecarAlignmentToEditor(memAlign, docId, forceOverwrite);
        return;
      }
    }

    if (!forceOverwrite && !isVideo76Doc && activeAlignSourceByDocRef.current[docId] === 'vosk-v2') {
      return;
    }

    const savedDocOverlays = readSavedDocOverlays(docId);
    if (!forceOverwrite) {
      if (
        userEditedCaptionsDocIdRef.current === docId ||
        (savedDocOverlays?.userEditedCaptions &&
          savedDocOverlays?.captionsAlignVersion === CAPTIONS_ALIGN_VERSION &&
          Array.isArray(savedDocOverlays.captions) &&
          savedDocOverlays.captions.length > 0)
      ) {
        userEditedCaptionsDocIdRef.current = docId;
        return;
      }
    } else {
      userEditedCaptionsDocIdRef.current = '';
    }

    const offset =
      typeof customEntryOffset === 'number' ? customEntryOffset : voiceStartOffsetSec;
    const targetVoiceDur =
      typeof customVoiceDurSec === 'number' && customVoiceDurSec > 1
        ? customVoiceDurSec
        : effectiveVoiceDurationSec;
    const activeWordsLimit =
      aspectRatio === '9:16' ? captionWordsPerLine9x16 : captionWordsPerLine16x9;
    const maxCharsPerCaption =
      captionLineMode === 'original' ? 46 : captionMaxChars > 0 ? captionMaxChars : 32;

    const isVideo76 = isVideo76Doc;
    const effectiveMode =
      activeDoc.promptConfig?.UBICACION_INTRO_MARCA === 'INTRO_POST_SLOGAN' ||
      introPlacementMode === 'INTRO_POST_SLOGAN'
        ? 'INTRO_POST_SLOGAN'
        : 'INTRO_INICIO_00';
    const { voiceEntrySec: baseHookForCap } = getStage1ClipDurations(activeDoc);

    if (isVideo76 && prealignedVideo76SrtRef.current) {
      const parsed76 = reformatCaptionItems(
        alignCaptionsToIntroPlacement(
          parseSrtToCaptionItems(prealignedVideo76SrtRef.current, offset),
          effectiveMode,
          baseHookForCap,
          8,
          sloganSplitAudioSec
        ),
        {
          maxCharsPerLine: captionMaxChars,
          maxWordsPerLine: activeWordsLimit,
          avoidSingleWordLines: aspectRatio === '16:9',
          mode: captionLineMode,
        }
      );
      if (parsed76.length > 0) {
        setCaptions(parsed76);
        persistDocOverlaysPatch(
          { captions: parsed76, ...(forceOverwrite ? { userEditedCaptions: false } : {}) },
          docId
        );
        return;
      }
    }

    // Build source script preserving explicit [pausa Xs] tags and \n\n paragraph breaks
    const rawVoiceScript =
      activeDoc.voiceoverScript && activeDoc.voiceoverScript.trim()
        ? activeDoc.voiceoverScript.trim()
        : (activeDoc.clips || [])
            .filter(
              (c, idx) =>
                idx > 0 &&
                c.clipNumber > 1 &&
                c.narrationSegment &&
                !c.narrationSegment.includes('Sin Voz Narrativa')
            )
            .map((c) => c.narrationSegment)
            .join('\n\n');

    if (!rawVoiceScript) {
      setCaptions([]);
      return;
    }

    const silences = customSilences || detectedAudioSilencesRef.current || [];

    // Preserve Video 76 exact segment path 100% untouched
    if (isVideo76) {
      const video76ExactSegBounds: Record<number, [number, number]> = {
        0: [0.55, 34.01],
        2: [36.18, 67.66],
        4: [69.89, 131.48],
        6: [133.33, 181.12],
        8: [183.48, 217.65],
        10: [220.46, 284.05],
        12: [286.46, 352.0],
        14: [354.2, 384.15],
        16: [386.46, 430.7],
        18: [432.43, 481.72],
        20: [484.0, 531.95],
        22: [534.07, 591.86],
        24: [594.05, 642.22],
        26: [644.04, 718.21],
        28: [721.12, 790.35],
        30: [792.77, 838.19],
        32: [840.46, 871.93],
        34: [874.65, 890.41],
      };
      const pauseRegex76 =
        /[\[{]\s*(?:(?:pausa|pause|silencio)\s*:?\s*)?([0-9]{1,2}(?:[.,][0-9]+)?)\s*(s|seg|segundos|ms|milisegundos)?\s*[\]}]|[\[{]\s*(?:pausa|pause|silencio)\s*:?\s*[\]}]/gi;
      const segs76: Array<{ type: 'text'; text: string } | { type: 'pause'; duration: number }> = [];
      let lastIdx76 = 0;
      let m76: RegExpExecArray | null;
      while ((m76 = pauseRegex76.exec(rawVoiceScript)) !== null) {
        const bTxt = rawVoiceScript.slice(lastIdx76, m76.index).trim();
        if (bTxt) segs76.push({ type: 'text', text: bTxt });
        const d76 = m76[1] ? parseFloat(m76[1].replace(',', '.')) : 1.5;
        segs76.push({ type: 'pause', duration: Math.max(0.2, Math.min(10, d76)) });
        lastIdx76 = m76.index + m76[0].length;
      }
      const rem76 = rawVoiceScript.slice(lastIdx76).trim();
      if (rem76) segs76.push({ type: 'text', text: rem76 });

      const gen76: TimelineCaptionItem[] = [];
      let cur76 = 0;
      segs76.forEach((seg, idx) => {
        if (seg.type !== 'text') {
          cur76 += seg.duration;
          return;
        }
        const bounds = video76ExactSegBounds[idx];
        const sStart = bounds ? bounds[0] : cur76;
        const sEnd = bounds
          ? bounds[1]
          : sStart + Math.max(1.5, spokenSpanishSyllableWeight(seg.text) / 5.2);
        cur76 = sEnd;
        const clean76 = normalizeQuantitiesToMil(stripPauseTags(seg.text))
          .replace(/\s+/g, ' ')
          .trim();
        const words76 = clean76.split(' ').filter(Boolean);
        const chunks76 = splitWordsIntoShortLines(words76, maxCharsPerCaption, activeWordsLimit).map(
          (lw) => (Array.isArray(lw) ? lw.join(' ') : String(lw))
        );
        const ws76 = chunks76.map((ch) => Math.max(1, spokenSpanishSyllableWeight(ch)));
        const totW76 = Math.max(1, ws76.reduce((a, b) => a + b, 0));
        let acc76 = 0;
        chunks76.forEach((ch, cIdx) => {
          const cS = sStart + (acc76 / totW76) * (sEnd - sStart);
          acc76 += ws76[cIdx];
          const cE = cIdx === chunks76.length - 1 ? sEnd : sStart + (acc76 / totW76) * (sEnd - sStart);
          gen76.push({
            id: `autocap-vo-${gen76.length + 1}`,
            index: gen76.length + 1,
            start: Number((offset + cS).toFixed(2)),
            end: Number(Math.max(offset + cS + 0.3, offset + cE).toFixed(2)),
            text: ch,
          });
        });
      });
      const final76 = reformatCaptionItems(
        alignCaptionsToIntroPlacement(gen76, effectiveMode, baseHookForCap, 8, sloganSplitAudioSec),
        { maxCharsPerLine: captionMaxChars, maxWordsPerLine: activeWordsLimit,
          avoidSingleWordLines: aspectRatio === '16:9', mode: captionLineMode }
      );
      setCaptions(final76);
      persistDocOverlaysPatch(
        { captions: final76, ...(forceOverwrite ? { userEditedCaptions: false } : {}) },
        docId
      );
      return;
    }

    // =========================================================================
    // WEBAUDIO 3-TIER V2 ALIGNER (Tier 1: [pausa] + \n\n -> Tier 2: Sentences/Clauses -> Tier 3: 20ms Voiced-Frame Integral)
    // =========================================================================
    type MacroUnit = {
      text: string;
      weight: number;
      breakKind: 'pause_tag' | 'para' | 'end';
      pauseHintSec: number;
    };
    const pauseTagRegex =
      /[\[{]\s*(?:(?:pausa|pause|silencio)\s*[:=]?\s*)?([0-9]{1,2}(?:[.,][0-9]+)?)\s*(s|seg|segundos|ms|milisegundos)?\s*[\]}]|[\[{]\s*(?:pausa|pause|silencio)\s*[:=]?\s*[\]}]/gi;
    const rawPauseBlocks: Array<{ text: string; pauseAfterSec: number; hasPauseTag: boolean }> = [];
    let pLast = 0;
    let pm: RegExpExecArray | null;
    while ((pm = pauseTagRegex.exec(rawVoiceScript)) !== null) {
      const chunkBefore = rawVoiceScript.slice(pLast, pm.index);
      let pDur = pm[1] ? parseFloat(pm[1].replace(',', '.')) : 1.5;
      if (pm[2] && /ms|milisegundos/i.test(pm[2])) pDur /= 1000;
      pDur = Math.max(0.25, Math.min(10, pDur));
      if (chunkBefore.trim()) {
        rawPauseBlocks.push({ text: chunkBefore, pauseAfterSec: pDur, hasPauseTag: true });
      } else if (rawPauseBlocks.length > 0) {
        rawPauseBlocks[rawPauseBlocks.length - 1].pauseAfterSec += pDur;
        rawPauseBlocks[rawPauseBlocks.length - 1].hasPauseTag = true;
      }
      pLast = pm.index + pm[0].length;
    }
    const tailScript = rawVoiceScript.slice(pLast);
    if (tailScript.trim()) {
      rawPauseBlocks.push({ text: tailScript, pauseAfterSec: 0, hasPauseTag: false });
    }

    const macroUnits: MacroUnit[] = [];
    rawPauseBlocks.forEach((blk, bIdx) => {
      const paras = blk.text
        .split(/\r?\n\s*\r?\n+/)
        .map((p) => p.replace(/\s+/g, ' ').trim())
        .filter(Boolean);
      paras.forEach((pText, pIdx) => {
        const isLastParaInBlk = pIdx === paras.length - 1;
        const isVeryLast = bIdx === rawPauseBlocks.length - 1 && isLastParaInBlk;
        const breakKind: MacroUnit['breakKind'] = isVeryLast
          ? 'end'
          : isLastParaInBlk && blk.hasPauseTag
          ? 'pause_tag'
          : 'para';
        const pauseHintSec = isVeryLast
          ? 0
          : isLastParaInBlk && blk.hasPauseTag
          ? Math.max(1.2, blk.pauseAfterSec)
          : 1.05;
        macroUnits.push({
          text: pText,
          weight: Math.max(2, spokenSpanishSyllableWeight(pText)),
          breakKind,
          pauseHintSec,
        });
      });
    });

    if (macroUnits.length === 0) {
      setCaptions([]);
      return;
    }

    // Bounded DP solver with Virtual Local Fallback Nodes so merged paragraphs/clauses never jump 15-30s
    const solveBoundedSilenceDP = (
      unitWeights: number[],
      boundaryExpectedGaps: number[],
      boundaryMinPrimarySil: number[],
      tStart: number,
      tEnd: number,
      candSilences: Array<{ start: number; end: number; dur: number }>,
      searchRadiusSec: number,
      localFallbackRadiusSec: number,
      localFallbackMinSil: number
    ): Array<{ start: number; end: number }> => {
      const N = unitWeights.length;
      if (N === 0) return [];
      if (N === 1) return [{ start: tStart, end: tEnd }];

      const totalW = Math.max(1, unitWeights.reduce((a, b) => a + b, 0));
      const totalHintGaps = boundaryExpectedGaps.reduce((a, b) => a + b, 0);
      const span = Math.max(0.4, tEnd - tStart);
      const effGapScale =
        totalHintGaps > span * 0.38 ? (span * 0.38) / Math.max(0.1, totalHintGaps) : 1.0;
      const netSpeech = Math.max(0.2, span - totalHintGaps * effGapScale);

      const tExpEnd: number[] = [];
      const tExpNextStart: number[] = [];
      let curExp = tStart;
      for (let i = 0; i < N - 1; i++) {
        const uDur = (unitWeights[i] / totalW) * netSpeech;
        const gDur = (boundaryExpectedGaps[i] || 0) * effGapScale;
        tExpEnd.push(curExp + uDur);
        tExpNextStart.push(curExp + uDur + gDur);
        curExp += uDur + gDur;
      }

      if (candSilences.length === 0) {
        const out: Array<{ start: number; end: number }> = [];
        let cS = tStart;
        for (let i = 0; i < N - 1; i++) {
          out.push({ start: cS, end: tExpEnd[i] });
          cS = tExpNextStart[i];
        }
        out.push({ start: cS, end: tEnd });
        return out;
      }

      type CandNode = { start: number; end: number; dur: number; penalty: number };
      const B = N - 1;
      const candsPerBoundary: CandNode[][] = [];

      for (let b = 0; b < B; b++) {
        const expMid = 0.5 * (tExpEnd[b] + tExpNextStart[b]);
        const minPrim = boundaryMinPrimarySil[b] || 0.3;
        const bCands: CandNode[] = [];

        for (const s of candSilences) {
          if (s.start <= tStart + 0.16 || s.end >= tEnd - 0.16) continue;
          const sMid = 0.5 * (s.start + s.end);
          if (Math.abs(sMid - expMid) <= searchRadiusSec && s.dur >= minPrim) {
            bCands.push({ start: s.start, end: s.end, dur: s.dur, penalty: 0 });
          }
        }

        // Virtual Local Fallback 1: best shorter breath pause in tight local window
        if (localFallbackMinSil > 0 && localFallbackRadiusSec > 0) {
          let bestLocal: { start: number; end: number; dur: number } | null = null;
          let bestLocalScore = 1e9;
          for (const s of candSilences) {
            if (s.start <= tStart + 0.14 || s.end >= tEnd - 0.14) continue;
            if (s.dur < localFallbackMinSil || s.dur >= minPrim) continue;
            const sMid = 0.5 * (s.start + s.end);
            const dist = Math.abs(sMid - expMid);
            if (dist <= localFallbackRadiusSec) {
              const sc = dist - s.dur * 1.2;
              if (sc < bestLocalScore) {
                bestLocalScore = sc;
                bestLocal = s;
              }
            }
          }
          if (bestLocal) {
            bCands.push({
              start: bestLocal.start,
              end: bestLocal.end,
              dur: bestLocal.dur,
              penalty: 3.5,
            });
          }
        }

        // Virtual Local Fallback 2: proportional split point so DP never breaks chain
        const vHalf = Math.min(0.03, Math.max(0.01, (tExpNextStart[b] - tExpEnd[b]) * 0.25));
        const vStart = Math.max(tStart + 0.12 * (b + 1), Math.min(tEnd - 0.12 * (B - b), expMid - vHalf));
        const vEnd = Math.min(tEnd - 0.08, vStart + vHalf * 2);
        bCands.push({ start: vStart, end: vEnd, dur: vEnd - vStart, penalty: 9.0 });

        bCands.sort((a, c) => a.start - c.start);
        candsPerBoundary.push(bCands);
      }

      const INF = 1e12;
      const dp: number[][] = candsPerBoundary.map((arr) => Array(arr.length).fill(INF));
      const parent: number[][] = candsPerBoundary.map((arr) => Array(arr.length).fill(-1));

      const expSpan0 = Math.max(0.25, tExpEnd[0] - tStart);
      for (let m = 0; m < candsPerBoundary[0].length; m++) {
        const cm = candsPerBoundary[0][m];
        const midM = 0.5 * (cm.start + cm.end);
        const expMid0 = 0.5 * (tExpEnd[0] + tExpNextStart[0]);
        const actSpan = cm.start - tStart;
        if (actSpan < Math.min(0.18, expSpan0 * 0.35)) continue;
        if (actSpan > Math.max(expSpan0 * 1.9, expSpan0 + searchRadiusSec)) continue;
        const posCost = 4.0 * Math.pow(Math.abs(midM - expMid0) / Math.max(1.0, searchRadiusSec), 2);
        const spanCost = 10.0 * (Math.abs(actSpan - expSpan0) / Math.max(2.5, expSpan0));
        const silBonus = 1.6 * Math.min(1.8, cm.dur);
        dp[0][m] = posCost + spanCost - silBonus + cm.penalty;
      }

      for (let b = 1; b < B; b++) {
        const expSpan = Math.max(0.25, tExpEnd[b] - tExpNextStart[b - 1]);
        const expMid = 0.5 * (tExpEnd[b] + tExpNextStart[b]);
        const prevArr = candsPerBoundary[b - 1];
        const curArr = candsPerBoundary[b];

        for (let m = 0; m < curArr.length; m++) {
          const cm = curArr[m];
          const midM = 0.5 * (cm.start + cm.end);
          const posCost = 4.0 * Math.pow(Math.abs(midM - expMid) / Math.max(1.0, searchRadiusSec), 2);
          const silBonus = 1.6 * Math.min(1.8, cm.dur);

          for (let p = 0; p < prevArr.length; p++) {
            if (dp[b - 1][p] >= INF * 0.5) continue;
            const cp = prevArr[p];
            if (cm.start < cp.end + 0.14) continue;
            const actSpan = cm.start - cp.end;
            if (
              cm.penalty < 8 &&
              cp.penalty < 8 &&
              (actSpan < expSpan * 0.38 || actSpan > Math.max(expSpan * 1.9, expSpan + 10.0))
            ) {
              continue;
            }
            const spanCost = 10.0 * (Math.abs(actSpan - expSpan) / Math.max(2.5, expSpan));
            const cost = dp[b - 1][p] + posCost + spanCost - silBonus + cm.penalty;
            if (cost < dp[b][m]) {
              dp[b][m] = cost;
              parent[b][m] = p;
            }
          }
        }
      }

      const expLastSpan = Math.max(0.25, tEnd - tExpNextStart[B - 1]);
      let bestLast = -1;
      let bestTotal = INF * 0.5;
      const lastArr = candsPerBoundary[B - 1];
      for (let m = 0; m < lastArr.length; m++) {
        if (dp[B - 1][m] >= INF * 0.5) continue;
        const tailSpan = Math.max(0.05, tEnd - lastArr[m].end);
        const tailCost = 8.0 * (Math.abs(tailSpan - expLastSpan) / Math.max(2.5, expLastSpan));
        const tot = dp[B - 1][m] + tailCost;
        if (tot < bestTotal) {
          bestTotal = tot;
          bestLast = m;
        }
      }

      if (bestLast !== -1) {
        const chosen: CandNode[] = Array(B);
        let cur = bestLast;
        for (let b = B - 1; b >= 0; b--) {
          chosen[b] = candsPerBoundary[b][cur];
          cur = parent[b][cur];
        }
        const res: Array<{ start: number; end: number }> = [];
        let segS = tStart;
        for (let b = 0; b < B; b++) {
          res.push({ start: segS, end: Math.max(segS + 0.1, chosen[b].start) });
          segS = Math.max(chosen[b].end, res[b].end + 0.01);
        }
        res.push({ start: segS, end: Math.max(segS + 0.12, tEnd) });
        return res;
      }

      const fallbackRes: Array<{ start: number; end: number }> = [];
      let fS = tStart;
      for (let i = 0; i < N - 1; i++) {
        fallbackRes.push({ start: fS, end: tExpEnd[i] });
        fS = tExpNextStart[i];
      }
      fallbackRes.push({ start: fS, end: tEnd });
      return fallbackRes;
    };

    const totalMacroW = macroUnits.reduce((acc, u) => acc + u.weight, 0);
    const totalMacroPause = macroUnits.reduce((acc, u) => acc + u.pauseHintSec, 0);
    const fallbackTotalDur =
      targetVoiceDur > 5 ? targetVoiceDur : totalMacroW / 4.8 + totalMacroPause;
    const firstSpeechStart =
      silences.length > 0 && silences[0].start < 0.06 ? silences[0].end : 0.05;
    const lastSil = silences.length > 0 ? silences[silences.length - 1] : null;
    const lastSpeechEnd =
      lastSil && lastSil.end >= fallbackTotalDur - 0.15 && lastSil.start > fallbackTotalDur - 9
        ? lastSil.start
        : fallbackTotalDur;

    // Tier 1: Macro alignment ([pausa: Xs] >= 1.15s, \n\n >= 0.80s, radius min(26, max(10, 0.035*T)), virtual local >= 0.30s in ±4.5s)
    const radiusL1 = Math.min(26.0, Math.max(10.0, 0.035 * fallbackTotalDur));
    const macroBounds = solveBoundedSilenceDP(
      macroUnits.map((u) => u.weight),
      macroUnits.slice(0, -1).map((u) => u.pauseHintSec),
      macroUnits.slice(0, -1).map((u) => (u.breakKind === 'pause_tag' ? 1.15 : 0.8)),
      firstSpeechStart,
      Math.max(firstSpeechStart + 1.0, lastSpeechEnd),
      silences,
      radiusL1,
      4.5,
      0.3
    );

    // Acoustically lock sloganSplitAudioSec when "seguimos sus rastros" / "deja una huella" ends inside first 105s
    let resolvedWebAudioSplitSec = sloganSplitAudioSec;
    for (let uIdx = 0; uIdx < macroUnits.length - 1; uIdx++) {
      const b = macroBounds[uIdx];
      if (!b || b.end > 105) break;
      const normTxt = macroUnits[uIdx].text
        .toLowerCase()
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '');
      if (normTxt.includes('seguimos sus rastros') || normTxt.includes('deja una huella')) {
        const nextB = macroBounds[uIdx + 1];
        if (nextB && nextB.start >= b.end) {
          resolvedWebAudioSplitSec = Number(((b.end + nextB.start) * 0.5).toFixed(3));
          setDetectedSloganSplitSec(resolvedWebAudioSplitSec);
        }
        break;
      }
    }

    const rmsData =
      voiceRmsActivityRef.current && voiceRmsActivityRef.current.url === effectiveVoiceoverUrl
        ? voiceRmsActivityRef.current
        : null;

    // Collect all timed words in pure Audio Time (0.0s..) across Tier 2 & Tier 3
    const allTimedWords: Array<[string, number, number, 0 | 1 | 2 | 3 | 4]> = [];

    macroUnits.forEach((mUnit, mIdx) => {
      const mBound = macroBounds[mIdx];
      if (!mBound) return;
      const pStart = mBound.start;
      const pEnd = mBound.end;
      const paraDur = Math.max(0.25, pEnd - pStart);
      const paraSilences = silences.filter(
        (s) => s.end > pStart + 0.05 && s.start < pEnd - 0.05 && s.dur >= 0.14
      );

      // Tier 2A: Sentences (. ! ? … : ;)
      const sentences = mUnit.text
        .split(/(?<=[.!?…:;]["'»”)]*)\s+/)
        .map((s) => s.trim())
        .filter(Boolean);
      const radiusL2 = Math.min(6.0, Math.max(2.0, 0.22 * paraDur));
      const sentBounds = solveBoundedSilenceDP(
        sentences.map((s) => Math.max(1, spokenSpanishSyllableWeight(s))),
        sentences.slice(0, -1).map(() => 0.42),
        sentences.slice(0, -1).map(() => 0.28),
        pStart,
        pEnd,
        paraSilences,
        radiusL2,
        1.8,
        0.14
      );

      sentences.forEach((sentTxt, sIdx) => {
        const sBound = sentBounds[sIdx];
        if (!sBound) return;
        const sentDur = Math.max(0.2, sBound.end - sBound.start);
        const sentSilences = paraSilences.filter(
          (s) => s.end > sBound.start + 0.05 && s.start < sBound.end - 0.05
        );

        // Tier 2B: Clauses (, — –)
        const clauses = sentTxt
          .split(/(?<=[,;—–])\s+/)
          .map((c) => c.trim())
          .filter(Boolean);
        const radiusL3 = Math.min(2.8, Math.max(1.1, 0.25 * sentDur));
        const clauseBounds = solveBoundedSilenceDP(
          clauses.map((c) => Math.max(1, spokenSpanishSyllableWeight(c))),
          clauses.slice(0, -1).map(() => 0.22),
          clauses.slice(0, -1).map(() => 0.15),
          sBound.start,
          sBound.end,
          sentSilences,
          radiusL3,
          0.9,
          0.12
        );

        clauses.forEach((clTxt, cIdx) => {
          const cBound = clauseBounds[cIdx];
          if (!cBound) return;
          const cleanCl = normalizeQuantitiesToMil(stripPauseTags(clTxt))
            .replace(/\[pausa[^\]]*\]?/gi, '')
            .replace(/\s+/g, ' ')
            .trim();
          const clWords = cleanCl.split(' ').filter(Boolean);
          if (clWords.length === 0) return;

          const isLastClauseInSent = cIdx === clauses.length - 1;
          const isLastSentInPara = sIdx === sentences.length - 1;

          // Tier 3: Distribute words over active voiced 20ms RMS frames (skipping internal breath silences)
          const wWeights = clWords.map((w, wIdx) => {
            const baseW = Math.max(1, spokenSpanishSyllableWeight(w));
            return wIdx === clWords.length - 1 && clWords.length > 1 ? baseW * 1.12 : baseW;
          });
          const totW = Math.max(1, wWeights.reduce((a, b) => a + b, 0));

          const cStart = cBound.start;
          const cEnd = Math.max(cStart + 0.12, cBound.end);

          if (rmsData && rmsData.voiced.length > 0) {
            const dt = rmsData.frameSec;
            const f0 = Math.max(0, Math.floor(cStart / dt));
            const f1 = Math.min(rmsData.voiced.length - 1, Math.ceil(cEnd / dt));
            const nFrames = Math.max(1, f1 - f0 + 1);
            const cumVoice = new Float64Array(nFrames + 1);
            for (let k = 0; k < nFrames; k++) {
              const fIdx = Math.min(rmsData.voiced.length - 1, f0 + k);
              const tMid = (f0 + k + 0.5) * dt;
              const inDetectedSil = sentSilences.some(
                (s) => s.dur >= 0.15 && tMid >= s.start && tMid <= s.end
              );
              const density = inDetectedSil ? 0 : rmsData.voiced[fIdx] ? 1.0 : 0.05;
              cumVoice[k + 1] = cumVoice[k] + density;
            }
            const totalVoiceMass = cumVoice[nFrames];

            const mapFracToTime = (frac: number): number => {
              if (totalVoiceMass <= 0.05) {
                return cStart + frac * (cEnd - cStart);
              }
              const targetMass = Math.max(0, Math.min(totalVoiceMass, frac * totalVoiceMass));
              let lo = 0;
              let hi = nFrames;
              while (lo < hi) {
                const mid = (lo + hi) >> 1;
                if (cumVoice[mid] < targetMass) lo = mid + 1;
                else hi = mid;
              }
              const idx = Math.max(1, Math.min(nFrames, lo));
              const prevM = cumVoice[idx - 1];
              const curM = cumVoice[idx];
              const subFrac = curM > prevM ? (targetMass - prevM) / (curM - prevM) : 0;
              const rawT = (f0 + idx - 1 + subFrac) * dt;
              return Math.max(cStart, Math.min(cEnd, rawT));
            };

            let wAcc = 0;
            clWords.forEach((wordText, wIdx) => {
              const fS = wAcc / totW;
              wAcc += wWeights[wIdx];
              const fE = wIdx === clWords.length - 1 ? 1.0 : wAcc / totW;
              const wS = mapFracToTime(fS);
              const wE = Math.max(wS + 0.04, mapFracToTime(fE));
              const isLastWord = wIdx === clWords.length - 1;
              const bFlag: 0 | 1 | 2 | 3 | 4 = !isLastWord
                ? 0
                : isLastClauseInSent && isLastSentInPara
                ? mUnit.breakKind === 'pause_tag'
                  ? 4
                  : 3
                : isLastClauseInSent
                ? 2
                : 1;
              allTimedWords.push([
                wordText,
                Number(wS.toFixed(3)),
                Number(wE.toFixed(3)),
                bFlag,
              ]);
            });
          } else {
            // Pre-decode silence-subtracted fallback
            let wAcc = 0;
            clWords.forEach((wordText, wIdx) => {
              const wS = cStart + (wAcc / totW) * (cEnd - cStart);
              wAcc += wWeights[wIdx];
              const wE =
                wIdx === clWords.length - 1 ? cEnd : cStart + (wAcc / totW) * (cEnd - cStart);
              const isLastWord = wIdx === clWords.length - 1;
              const bFlag: 0 | 1 | 2 | 3 | 4 = !isLastWord
                ? 0
                : isLastClauseInSent && isLastSentInPara
                ? mUnit.breakKind === 'pause_tag'
                  ? 4
                  : 3
                : isLastClauseInSent
                ? 2
                : 1;
              allTimedWords.push([
                wordText,
                Number(wS.toFixed(3)),
                Number(Math.max(wS + 0.04, wE).toFixed(3)),
                bFlag,
              ]);
            });
          }
        });
      });
    });

    if (allTimedWords.length === 0) {
      setCaptions([]);
      return;
    }

    const builtWebAudioCaps = buildAudioCaptionsFromSidecarWords(allTimedWords, {
      maxWordsPerLine:
        captionLineMode === 'original' ? 9 : activeWordsLimit > 0 ? activeWordsLimit : 6,
      maxCharsPerLine: maxCharsPerCaption,
      lineMode: captionLineMode === 'wrap' ? 'wrap' : 'single',
    }).map((it, idx) => {
      const aS = Number(it.audioStartSec ?? it.start ?? 0);
      const aE = Math.max(aS + 0.12, Number(it.audioEndSec ?? it.end ?? aS + 0.25));
      return {
        id: `autocap-vo-${idx + 1}`,
        index: idx + 1,
        text: String(it.text || ''),
        audioStartSec: Number(aS.toFixed(3)),
        audioEndSec: Number(aE.toFixed(3)),
        start: Number(aS.toFixed(3)),
        end: Number(aE.toFixed(3)),
        words: Array.isArray(it.words) ? it.words : undefined,
        alignSource: 'webaudio-v2' as const,
      };
    });

    const livePsBounds = getPostSloganBoundsFromClips(timelineClips);
    const projOpts: ProjectAudioCaptionsOptions = {
      introPlacement: effectiveMode,
      voiceStartOffsetSec: offset,
      postSloganIntroBounds: livePsBounds,
      sloganSplitAudioSec: resolvedWebAudioSplitSec,
      introDurSec: 8,
    };
    const sig = buildCurrentCaptionsSignature();

    if (
      !forceOverwrite &&
      savedDocOverlays?.userEditedCaptions &&
      savedDocOverlays?.captionsAlignVersion !== CAPTIONS_ALIGN_VERSION &&
      Array.isArray(savedDocOverlays.captions) &&
      savedDocOverlays.captions.length > 0
    ) {
      const migrated = reanchorLegacyManualCaptions(savedDocOverlays.captions, builtWebAudioCaps);
      const projectedMigrated = projectAudioCaptionsToTimeline(migrated, projOpts);
      userEditedCaptionsDocIdRef.current = docId;
      activeAlignSourceByDocRef.current[docId] = 'manual';
      setCaptions(projectedMigrated);
      persistDocOverlaysPatch(
        {
          captions: projectedMigrated,
          userEditedCaptions: true,
          captionsAlignVersion: CAPTIONS_ALIGN_VERSION,
          captionsSourceSignature: sig,
        },
        docId
      );
      return;
    }

    const finalProjected = projectAudioCaptionsToTimeline(builtWebAudioCaps, projOpts);
    activeAlignSourceByDocRef.current[docId] = 'webaudio-v2';
    setCaptions(finalProjected);
    persistDocOverlaysPatch(
      {
        captions: finalProjected,
        captionsAlignVersion: CAPTIONS_ALIGN_VERSION,
        captionsSourceSignature: sig,
        ...(forceOverwrite ? { userEditedCaptions: false } : {}),
      },
      docId
    );
  };

  // Pre-load verified 3-Level Acoustically Locked SRT for Video 76 so playback captions match 100% immediately
  useEffect(() => {
    if (!isVideo76Doc) return;
    const docId = activeDoc?.id || 'default';
    const effectiveMode =
      activeDoc?.promptConfig?.UBICACION_INTRO_MARCA === 'INTRO_POST_SLOGAN' ||
      introPlacementMode === 'INTRO_POST_SLOGAN'
        ? 'INTRO_POST_SLOGAN'
        : 'INTRO_INICIO_00';
    const { voiceEntrySec: baseHook76 } = getStage1ClipDurations(activeDoc);
    const activeWordsLimit =
      aspectRatio === '9:16' ? captionWordsPerLine9x16 : captionWordsPerLine16x9;

    const savedDocOverlays = readSavedDocOverlays(docId);
    const hasSyncedV3 = Boolean(savedDocOverlays?.captionsSyncV3);
    if (
      hasSyncedV3 &&
      (userEditedCaptionsDocIdRef.current === docId ||
        (savedDocOverlays?.userEditedCaptions &&
          Array.isArray(savedDocOverlays.captions) &&
          savedDocOverlays.captions.length > 0))
    ) {
      userEditedCaptionsDocIdRef.current = docId;
      setCaptions((prevCaps) => {
        const src = prevCaps.length > 0 ? prevCaps : savedDocOverlays?.captions || [];
        if (src.length === 0) return prevCaps;
        const aligned = reformatCaptionItems(
          alignCaptionsToIntroPlacement(
            src,
            effectiveMode,
            baseHook76,
            8,
            sloganSplitAudioSec
          ),
          {
            maxCharsPerLine: captionMaxChars,
            maxWordsPerLine: activeWordsLimit,
          avoidSingleWordLines: aspectRatio === '16:9',
            mode: captionLineMode,
          }
        );
        persistDocOverlaysPatch({ captions: aligned, captionsSyncV3: true }, docId);
        return aligned;
      });
      return;
    }
    const applyPrealignedSrt76 = (srtText: string) => {
      const freshParsed = alignCaptionsToIntroPlacement(
        parseSrtToCaptionItems(srtText, voiceStartOffsetSec),
        effectiveMode,
        baseHook76,
        8,
        sloganSplitAudioSec
      );
      const existingCaps: TimelineCaptionItem[] = Array.isArray(savedDocOverlays?.captions)
        ? savedDocOverlays.captions
        : [];
      const rawMerged =
        savedDocOverlays?.userEditedCaptions && existingCaps.length === freshParsed.length
          ? freshParsed.map((fp, idx) => ({
              ...fp,
              text: existingCaps[idx]?.text || fp.text,
            }))
          : freshParsed;
      const merged = reformatCaptionItems(rawMerged, {
        maxCharsPerLine: captionMaxChars,
        maxWordsPerLine: activeWordsLimit,
          avoidSingleWordLines: aspectRatio === '16:9',
        mode: captionLineMode,
      });
      setCaptions(merged);
      persistDocOverlaysPatch({ captions: merged, captionsSyncV3: true }, docId);
    };
    if (prealignedVideo76SrtRef.current) {
      applyPrealignedSrt76(prealignedVideo76SrtRef.current);
      return;
    }
    let cancelled = false;
    fetch('tts-files/subtitulos-video-76-exodo-espanol.srt?v=sync_v3')
      .then((r) => (r.ok ? r.text() : ''))
      .then((txt) => {
        if (cancelled || !txt || !txt.includes('-->')) return;
        prealignedVideo76SrtRef.current = txt;
        applyPrealignedSrt76(txt);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [
    isVideo76Doc,
    voiceStartOffsetSec,
    introPlacementMode,
    activeDoc?.promptConfig?.UBICACION_INTRO_MARCA,
    sloganSplitAudioSec,
    activeDoc?.id,
  ]);

  // Decode actual Voiceover MP3/WAV waveform via Web Audio API to extract exact acoustic silences & 20ms voiced RMS activity
  useEffect(() => {
    if (!effectiveVoiceoverUrl) return;
    const currentDocId = activeDoc?.id || 'default';
    if (
      decodedSilenceUrlRef.current === effectiveVoiceoverUrl &&
      detectedAudioSilencesRef.current.length > 0 &&
      voiceRmsActivityRef.current?.url === effectiveVoiceoverUrl
    ) {
      if (activeAlignSourceByDocRef.current[currentDocId] !== 'vosk-v2') {
        handleGenerateAutoCaptionsFromVoice(
          voiceStartOffsetSec,
          effectiveVoiceDurationSec,
          detectedAudioSilencesRef.current
        );
      }
      return;
    }

    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(effectiveVoiceoverUrl);
        if (!res.ok || cancelled) return;
        const arrayBuf = await res.arrayBuffer();
        if (cancelled) return;
        const AudioCtx = window.AudioContext || (window as any).webkitAudioContext;
        if (!AudioCtx) return;
        const ctx = new AudioCtx();
        const audioBuf = await ctx.decodeAudioData(arrayBuf);
        try {
          await ctx.close();
        } catch {}
        if (cancelled) return;

        const sr = audioBuf.sampleRate;
        const chData = audioBuf.getChannelData(0);
        const winSamples = Math.max(1, Math.floor(sr * 0.01)); // 10ms window for high-precision pause & breath detection
        const numFrames10ms = Math.max(1, Math.ceil(chData.length / winSamples));
        const rms10ms = new Float32Array(numFrames10ms);
        const threshRms = 0.0115; // approx -38.8 dB
        const rawSilences: Array<{ start: number; end: number; dur: number }> = [];
        let silStart: number | null = null;

        let frameIdx = 0;
        for (let i = 0; i < chData.length; i += winSamples) {
          const endIdx = Math.min(chData.length, i + winSamples);
          let sumSq = 0;
          for (let j = i; j < endIdx; j++) {
            const v = chData[j];
            sumSq += v * v;
          }
          const rms = Math.sqrt(sumSq / (endIdx - i));
          if (frameIdx < numFrames10ms) {
            rms10ms[frameIdx++] = rms;
          }
          const tSec = i / sr;
          if (rms < threshRms) {
            if (silStart === null) silStart = tSec;
          } else if (silStart !== null) {
            const dur = tSec - silStart;
            if (dur >= 0.12) {
              rawSilences.push({ start: silStart, end: tSec, dur });
            }
            silStart = null;
          }
        }
        if (silStart !== null) {
          const endT = chData.length / sr;
          const dur = endT - silStart;
          if (dur >= 0.12) {
            rawSilences.push({ start: silStart, end: endT, dur });
          }
        }

        // Compute adaptive noise floor (15th percentile RMS) & 20ms voiced frame activity for Tier 3 distribution
        const sampleStep = Math.max(1, Math.floor(numFrames10ms / 4000));
        const rmsSample: number[] = [];
        for (let f = 0; f < numFrames10ms; f += sampleStep) {
          rmsSample.push(rms10ms[f]);
        }
        rmsSample.sort((a, b) => a - b);
        const p15Rms =
          rmsSample.length > 0
            ? rmsSample[Math.min(rmsSample.length - 1, Math.floor(rmsSample.length * 0.15))]
            : 0.004;
        const voiceFloor = Math.max(0.0115, Math.min(0.032, p15Rms * 2.8));
        const numFrames20ms = Math.max(1, Math.ceil(numFrames10ms / 2));
        const voiced20ms = new Uint8Array(numFrames20ms);
        for (let k = 0; k < numFrames20ms; k++) {
          const r0 = rms10ms[k * 2] || 0;
          const r1 = k * 2 + 1 < numFrames10ms ? rms10ms[k * 2 + 1] : r0;
          voiced20ms[k] = Math.max(r0, r1) >= voiceFloor ? 1 : 0;
        }
        voiceRmsActivityRef.current = {
          url: effectiveVoiceoverUrl,
          frameSec: 0.02,
          voiced: voiced20ms,
        };

        // Merge silences separated by tiny <0.05s noise blips so pauses are never fragmented
        const silences: Array<{ start: number; end: number; dur: number }> = [];
        for (const s of rawSilences) {
          if (silences.length > 0 && s.start - silences[silences.length - 1].end < 0.05) {
            silences[silences.length - 1].end = s.end;
            silences[silences.length - 1].dur =
              silences[silences.length - 1].end - silences[silences.length - 1].start;
          } else if (s.dur >= 0.14) {
            silences.push({ ...s });
          }
        }

        decodedSilenceUrlRef.current = effectiveVoiceoverUrl;
        detectedAudioSilencesRef.current = silences;
        if (audioBuf.duration > 1) {
          setVoiceDurationSec(audioBuf.duration);
        }
        const latestDocId = activeDoc?.id || 'default';
        if (activeAlignSourceByDocRef.current[latestDocId] !== 'vosk-v2') {
          handleGenerateAutoCaptionsFromVoice(
            voiceStartOffsetSec,
            audioBuf.duration > 1 ? audioBuf.duration : effectiveVoiceDurationSec,
            silences
          );
        }
      } catch {}
    })();

    return () => {
      cancelled = true;
    };
  }, [effectiveVoiceoverUrl, activeDoc?.id]);

  // Compute each clip's start & end time on the master timeline (with default audio fade-in / fade-out on Intro & Outro)
  const clipsWithTimelineBounds = useMemo(() => {
    let cursor = 0;
    const savedAudioMap = readSavedClipAudioEdits(activeDoc?.id);
    return timelineClips.map((clip, index) => {
      const start = cursor;
      const end = cursor + clip.duration;
      cursor = end;
      const isIntroClip = clip.id === 'fixed-doc-intro' || clip.clipNumber === 0;
      const isOutroClip = clip.id === 'fixed-doc-outro' || clip.clipNumber === 999;
      const savedAudio = getSavedAudioEditForClip(clip, savedAudioMap);
      const effectiveMuted =
        savedAudio?.audioMuted !== undefined
          ? Boolean(savedAudio.audioMuted)
          : Boolean(clip.audioMuted);
      const effectiveCustomVol =
        savedAudio?.customVolumeSet !== undefined
          ? Boolean(savedAudio.customVolumeSet)
          : Boolean(clip.customVolumeSet);
      const effectiveFoleyVol =
        typeof savedAudio?.foleyVolume === 'number'
          ? savedAudio.foleyVolume
          : clip.foleyVolume;
      return {
        ...clip,
        audioMuted: effectiveMuted,
        customVolumeSet: effectiveCustomVol || effectiveMuted,
        foleyVolume: effectiveFoleyVol,
        audioFadeInSec:
          typeof savedAudio?.audioFadeInSec === 'number'
            ? savedAudio.audioFadeInSec
            : typeof clip.audioFadeInSec === 'number'
            ? clip.audioFadeInSec
            : isIntroClip || isOutroClip
            ? 1.5
            : clip.clipNumber === 1
            ? 1.2
            : undefined,
        audioFadeOutSec:
          typeof savedAudio?.audioFadeOutSec === 'number'
            ? savedAudio.audioFadeOutSec
            : typeof clip.audioFadeOutSec === 'number'
            ? clip.audioFadeOutSec
            : isIntroClip || isOutroClip
            ? 2.5
            : undefined,
        index,
        start,
        end,
      };
    });
  }, [timelineClips, activeDoc?.id]);

  const selectedClip = useMemo(
    () =>
      clipsWithTimelineBounds.find((c) => c.id === selectedClipId) ||
      clipsWithTimelineBounds[0] ||
      null,
    [clipsWithTimelineBounds, selectedClipId]
  );

  const isEditorFullScheduleReviewed = useMemo(() => {
    const allScriptLen = activeDoc?.clips?.length || 0;
    if (allScriptLen === 0) return true;
    const uniqueBodyCount = new Set(
      clipsWithTimelineBounds
        .filter(
          (c) =>
            c.id !== 'fixed-doc-intro' &&
            c.clipNumber > 0 &&
            c.id !== 'fixed-doc-outro' &&
            c.clipNumber < 999
        )
        .map((c) => c.clipNumber)
    ).size;
    return uniqueBodyCount >= allScriptLen;
  }, [activeDoc?.clips?.length, clipsWithTimelineBounds]);

  // Keep the last song anchored to the exact end of Clip 82 (right before fixed-doc-outro) whenever timeline clip bounds change
  const outroClipStartSec = useMemo(() => {
    const outroClip = clipsWithTimelineBounds.find(
      (c) => c.id === 'fixed-doc-outro' || c.clipNumber === 999
    );
    if (outroClip && outroClip.start > 20) return Number(outroClip.start.toFixed(2));
    if (!isEditorFullScheduleReviewed) return 0;
    const lastClip = clipsWithTimelineBounds[clipsWithTimelineBounds.length - 1];
    return lastClip ? Number(lastClip.end.toFixed(2)) : 0;
  }, [clipsWithTimelineBounds, isEditorFullScheduleReviewed]);

  useEffect(() => {
    if (!isEditorFullScheduleReviewed || outroClipStartSec <= 30) return;
    setMusicTracks((prev) => {
      if (prev.length === 0) return prev;
      const lastTrack = prev[prev.length - 1];
      const currentLastEnd = Number((lastTrack.start + lastTrack.duration).toFixed(2));
      if (Math.abs(currentLastEnd - outroClipStartSec) < 0.25) return prev;

      const FIXED_INTRO_SEC = 8;
      const lastSongDurSec = 90;
      const nonLastCount = Math.max(1, prev.length - 1);
      const lastSongTargetStartSec = Math.max(
        FIXED_INTRO_SEC + (prev.length > 1 ? nonLastCount * 60 : 0),
        Number((outroClipStartSec - lastSongDurSec).toFixed(2))
      );
      const preLastSpanSec = Math.max(0, lastSongTargetStartSec - FIXED_INTRO_SEC);
      const idealGapSec =
        prev.length > 1 ? (preLastSpanSec - nonLastCount * 150) / nonLastCount : 0;
      const silenceGapSec =
        prev.length > 1
          ? Math.min(60, Math.max(30, Number.isFinite(idealGapSec) ? Math.round(idealGapSec) || 45 : 45))
          : 0;
      const availablePreLastSpanSec = Math.max(
        nonLastCount * 30,
        preLastSpanSec - nonLastCount * silenceGapSec
      );
      const evenPreLastDurSec = Number((availablePreLastSpanSec / nonLastCount).toFixed(2));


      // Etapa 8: las canciones colocadas según el rango de Gemini conservan su posición;
      // solo se recortan para no pasar del Outro. Las demás siguen el reparto automático.
      const hasGeminiRange = (mt: { videoTimeRange?: string }) =>
        /(\d{1,2}:\d{2}(?::\d{2})?)\s*[-–—]\s*(\d{1,2}:\d{2}(?::\d{2})?)/.test(String(mt.videoTimeRange || ''));
      if (prev.every((mt) => hasGeminiRange(mt))) {
        return prev.map((mt, idx) => {
          const maxDur = Number((outroClipStartSec - mt.start).toFixed(2));
          if (maxDur > 5 && mt.duration > maxDur) return { ...mt, duration: maxDur };
          // La última canción SIEMPRE termina con el último clip antes del Outro: si se queda corta,
          // se corre entera hacia el final (misma duración, sin pisar la canción anterior).
          if (idx === prev.length - 1 && prev.length > 1 && mt.start + mt.duration < outroClipStartSec - 0.25) {
            const prevTrack = prev[idx - 1];
            const prevEnd = prevTrack ? prevTrack.start + prevTrack.duration : FIXED_INTRO_SEC;
            const shiftedStart = Number(Math.max(prevEnd, outroClipStartSec - mt.duration).toFixed(2));
            return shiftedStart > mt.start ? { ...mt, start: shiftedStart } : mt;
          }
          return mt;
        });
      }

      let cursorSec = FIXED_INTRO_SEC;
      return prev.map((mt, idx) => {
        const isLast = idx === prev.length - 1;
        let startSec = cursorSec;
        let durSec = isLast ? lastSongDurSec : evenPreLastDurSec;
        if (isLast) {
          startSec = prev.length > 1 ? lastSongTargetStartSec : Math.max(FIXED_INTRO_SEC, lastSongTargetStartSec);
          durSec = Math.max(10, Number((outroClipStartSec - startSec).toFixed(2)));
        } else if (idx === prev.length - 2) {
          durSec = Math.max(30, Number((lastSongTargetStartSec - silenceGapSec - startSec).toFixed(2)));
        } else {
          const maxAllowedEnd = lastSongTargetStartSec - (nonLastCount - idx) * silenceGapSec;
          if (startSec + durSec > maxAllowedEnd) {
            durSec = Math.max(30, Number((maxAllowedEnd - startSec).toFixed(2)));
          }
        }
        cursorSec = Number((startSec + durSec + silenceGapSec).toFixed(2));
        return {
          ...mt,
          start: startSec,
          duration: durSec,
        };
      });
    });
  }, [outroClipStartSec, isEditorFullScheduleReviewed]);

  // Detect if the 8s Official Intro (fixed-doc-intro) is placed Post-Slogan in the middle of the timeline (Opción B)
  const postSloganIntroBounds = useMemo(() => {
    const introClip = clipsWithTimelineBounds.find(
      (c) => (c.id === 'fixed-doc-intro' || c.clipNumber === 0) && c.start > 2
    );
    if (!introClip) return null;
    return {
      start: introClip.start,
      end: introClip.end,
      duration: introClip.duration,
    };
  }, [clipsWithTimelineBounds]);

  // Keep latest caption projection options synchronized for async Vosk/WebAudio callbacks
  const effectiveIntroModeForCaptions: 'INTRO_INICIO_00' | 'INTRO_POST_SLOGAN' =
    activeDoc?.promptConfig?.UBICACION_INTRO_MARCA === 'INTRO_POST_SLOGAN' ||
    introPlacementMode === 'INTRO_POST_SLOGAN'
      ? 'INTRO_POST_SLOGAN'
      : 'INTRO_INICIO_00';
  latestCaptionProjectionOptsRef.current = {
    introPlacement: effectiveIntroModeForCaptions,
    voiceStartOffsetSec,
    postSloganIntroBounds,
    sloganSplitAudioSec,
    introDurSec: 8,
  };

  // Re-project or re-align captions deterministically whenever intro placement, postSloganIntroBounds, or voiceStartOffsetSec updates
  useEffect(() => {
    if (!activeDoc) return;
    const docId = activeDoc.id || 'default';
    if (isVideo76Doc && prealignedVideo76SrtRef.current) return;

    const effectiveMode = effectiveIntroModeForCaptions;
    const { voiceEntrySec: baseHookSec } = getStage1ClipDurations(activeDoc);
    const projOpts = {
      introPlacement: effectiveMode,
      voiceStartOffsetSec,
      postSloganIntroBounds,
      sloganSplitAudioSec,
      introDurSec: 8,
    };

    const savedDocOverlays = readSavedDocOverlays(docId);
    if (
      userEditedCaptionsDocIdRef.current === docId ||
      (savedDocOverlays?.userEditedCaptions &&
        Array.isArray(savedDocOverlays.captions) &&
        savedDocOverlays.captions.length > 0)
    ) {
      userEditedCaptionsDocIdRef.current = docId;
      setCaptions((prevCaps) => {
        const savedCaps = Array.isArray(savedDocOverlays?.captions)
          ? savedDocOverlays.captions
          : [];
        const prevMatchesSaved =
          prevCaps.length > 0 &&
          savedCaps.length > 0 &&
          prevCaps[0]?.text === savedCaps[0]?.text;
        const src = prevMatchesSaved
          ? prevCaps
          : savedCaps.length > 0
          ? savedCaps
          : prevCaps;
        if (src.length === 0) return prevCaps;
        const hasCanonicalAudio = src.some(
          (c) => typeof c.audioStartSec === 'number' && typeof c.audioEndSec === 'number'
        );
        const aligned = hasCanonicalAudio
          ? projectAudioCaptionsToTimeline(src, projOpts)
          : alignCaptionsToIntroPlacement(
              src,
              effectiveMode,
              baseHookSec,
              8,
              sloganSplitAudioSec,
              postSloganIntroBounds
            );
        persistDocOverlaysPatch({ captions: aligned }, docId);
        return aligned;
      });
      return;
    }

    if (activeAlignSourceByDocRef.current[docId] === 'vosk-v2') {
      const stem = resolveTtsAlignSidecarStem(effectiveVoiceoverUrl);
      const cachedSidecar = stem ? sidecarAlignmentByStemRef.current[stem] : undefined;
      const currentHash = activeDoc.voiceoverScript
        ? computeVoiceScriptAlignHash(activeDoc.voiceoverScript)
        : '';
      if (
        cachedSidecar &&
        (!currentHash || !cachedSidecar.scriptHash || cachedSidecar.scriptHash === currentHash)
      ) {
        applySidecarAlignmentToEditor(cachedSidecar, docId);
        return;
      }
      if (
        savedDocOverlays?.captionsAlignVersion === CAPTIONS_ALIGN_VERSION &&
        Array.isArray(savedDocOverlays.captions) &&
        savedDocOverlays.captions.some(
          (c: TimelineCaptionItem) =>
            typeof c.audioStartSec === 'number' && typeof c.audioEndSec === 'number'
        )
      ) {
        const reprojected = projectAudioCaptionsToTimeline(savedDocOverlays.captions, projOpts);
        setCaptions(reprojected);
        persistDocOverlaysPatch(
          { captions: reprojected, captionsAlignVersion: CAPTIONS_ALIGN_VERSION },
          docId
        );
        return;
      }
    }

    const hasScriptOrTtsAudio = Boolean(
      (activeDoc.voiceoverScript && activeDoc.voiceoverScript.trim()) ||
        resolveTtsAlignSidecarStem(effectiveVoiceoverUrl)
    );

    if (hasScriptOrTtsAudio) {
      if (
        activeDoc.voiceoverScript &&
        activeDoc.voiceoverScript.trim() &&
        effectiveVoiceDurationSec > 1
      ) {
        handleGenerateAutoCaptionsFromVoice(
          voiceStartOffsetSec,
          effectiveVoiceDurationSec,
          detectedAudioSilencesRef.current
        );
      }
      return;
    }

    if (activeDoc.correctedSrt && activeDoc.correctedSrt.trim()) {
      const aligned = alignCaptionsToIntroPlacement(
        parseSrtToCaptionItems(activeDoc.correctedSrt, voiceStartOffsetSec),
        effectiveMode,
        baseHookSec,
        8,
        sloganSplitAudioSec,
        postSloganIntroBounds
      );
      setCaptions(aligned);
      persistDocOverlaysPatch({ captions: aligned }, docId);
    } else {
      handleGenerateAutoCaptionsFromVoice(voiceStartOffsetSec, effectiveVoiceDurationSec);
    }
  }, [
    voiceStartOffsetSec,
    effectiveVoiceDurationSec,
    introPlacementMode,
    activeDoc?.promptConfig?.UBICACION_INTRO_MARCA,
    postSloganIntroBounds?.start,
    postSloganIntroBounds?.duration,
    sloganSplitAudioSec,
    activeDoc?.id,
  ]);

  // Map any master timeline second to the corresponding second inside the Voiceover MP3 (accounting for the 8s Post-Slogan Intro pause in Opción B)
  const getVoiceAudioTimeForTimelineSec = (timelineSec: number): number => {
    if (!postSloganIntroBounds) {
      return Math.max(0, timelineSec - voiceStartOffsetSec);
    }
    if (timelineSec >= postSloganIntroBounds.end) {
      return Math.max(
        0,
        timelineSec - voiceStartOffsetSec - postSloganIntroBounds.duration
      );
    }
    if (timelineSec >= postSloganIntroBounds.start) {
      return Math.max(0, postSloganIntroBounds.start - voiceStartOffsetSec);
    }
    return Math.max(0, timelineSec - voiceStartOffsetSec);
  };

  // Total timeline duration ALWAYS spans 8s Intro + 8s Clip 1 + Voiceover Narration + 8s Outro
  const totalDurationSec = useMemo(() => {
    const clipsEnd =
      clipsWithTimelineBounds.length > 0
        ? clipsWithTimelineBounds[clipsWithTimelineBounds.length - 1].end
        : 60;
    const postSloganExtraSec = postSloganIntroBounds ? postSloganIntroBounds.duration : 0;
    const voicePlusOutroEnd =
      effectiveVoiceDurationSec > 0
        ? voiceStartOffsetSec + effectiveVoiceDurationSec + postSloganExtraSec + 8
        : 0;
    const { clip1Sec, standardClipSec } = getStage1ClipDurations(activeDoc);
    const clip1VisualDur = !clip1Sec || clip1Sec <= 0 ? 6 : clip1Sec;
    const allScriptClipsEnd =
      activeDoc?.clips && activeDoc.clips.length > 0
        ? 8 + clip1VisualDur + Math.max(0, activeDoc.clips.length - 1) * standardClipSec + 8
        : 0;
    const lastBoundClip =
      clipsWithTimelineBounds.length > 0
        ? clipsWithTimelineBounds[clipsWithTimelineBounds.length - 1]
        : null;
    const hasOutroAtTimelineEnd = Boolean(
      lastBoundClip &&
        (lastBoundClip.id === 'fixed-doc-outro' || lastBoundClip.clipNumber === 999)
    );
    if (hasOutroAtTimelineEnd && isEditorFullScheduleReviewed && clipsEnd > 30) {
      return Number(Math.max(10, clipsEnd, voicePlusOutroEnd).toFixed(2));
    }
    return Math.max(10, clipsEnd, Math.ceil(voicePlusOutroEnd), allScriptClipsEnd);
  }, [
    clipsWithTimelineBounds,
    isEditorFullScheduleReviewed,
    effectiveVoiceDurationSec,
    voiceStartOffsetSec,
    postSloganIntroBounds,
    activeDoc?.clips?.length,
    activeDoc?.clipDurationMode,
  ]);

  const activeClipAtPlayhead = useMemo(() => {
    return (
      clipsWithTimelineBounds.find(
        (c) => currentTime >= c.start && currentTime < c.end
      ) ||
      clipsWithTimelineBounds[clipsWithTimelineBounds.length - 1] ||
      null
    );
  }, [clipsWithTimelineBounds, currentTime]);

  const nextClipAtPlayhead = useMemo(() => {
    if (!activeClipAtPlayhead) return null;
    const idx = clipsWithTimelineBounds.findIndex((c) => c.id === activeClipAtPlayhead.id);
    if (idx >= 0 && idx < clipsWithTimelineBounds.length - 1) {
      return clipsWithTimelineBounds[idx + 1];
    }
    return null;
  }, [clipsWithTimelineBounds, activeClipAtPlayhead?.id]);

  activeClipBoundsRef.current = activeClipAtPlayhead
    ? {
        id: activeClipAtPlayhead.id,
        clipNumber: activeClipAtPlayhead.clipNumber,
        end: activeClipAtPlayhead.end,
      }
    : null;
  nextClipIdentityRef.current = nextClipAtPlayhead
    ? {
        id: nextClipAtPlayhead.id,
        clipNumber: nextClipAtPlayhead.clipNumber,
      }
    : null;


  const decoratePlaybackPreviewUrl = (
    rewrittenUrl: string,
    quality: 'low' | 'medium' | 'high'
  ): string => {
    if (
      !rewrittenUrl ||
      quality === 'high' ||
      rewrittenUrl.startsWith('blob:') ||
      rewrittenUrl.startsWith('data:')
    ) {
      return rewrittenUrl;
    }
    const isPreviewableStream =
      rewrittenUrl.includes('/api/flow/serve-folder-file') ||
      rewrittenUrl.includes('/api/assets/official-intro-stream') ||
      rewrittenUrl.includes('/api/assets/official-outro-stream');
    if (!isPreviewableStream) return rewrittenUrl;
    const cleaned = rewrittenUrl
      .replace(/([?&])previewQuality=[^&#]*(&?)/gi, (_m, p1, p2) =>
        p1 === '?' && p2 === '&' ? '?' : p2 ? p1 : ''
      )
      .replace(/[?&]$/, '');
    const sep = cleaned.includes('?') ? '&' : '?';
    return `${cleaned}${sep}previewQuality=${quality}`;
  };

  const getClipEffectiveVideoUrl = (
    clip?: {
      videoUrl?: string;
      opticalFlowUrl?: string;
      smoothSlowMo?: boolean;
      speed?: number;
    } | null
  ): string => {
    if (!clip?.videoUrl) return '';
    if (
      clip.opticalFlowUrl &&
      (clip.opticalFlowUrl.includes('_of3') || clip.opticalFlowUrl.includes('_of2')) &&
      clip.smoothSlowMo !== false &&
      Number(clip.speed ?? 1) < 0.99
    ) {
      return decoratePlaybackPreviewUrl(rewriteMediaBridgeUrl(clip.opticalFlowUrl), previewQuality);
    }
    return decoratePlaybackPreviewUrl(rewriteMediaBridgeUrl(clip.videoUrl), previewQuality);
  };

  // Synchronous Dual-Deck (A/B Ping-Pong) assignment: when activeClipAtPlayhead advances to nextClipAtPlayhead,
  // flip activeSlot to the already-decoded standby deck without mutating its src attribute (0ms decoder swap, 0 freeze)
  const activeClipEffectiveUrl = getClipEffectiveVideoUrl(activeClipAtPlayhead);
  const nextClipEffectiveUrl = getClipEffectiveVideoUrl(nextClipAtPlayhead);
  {
    const da = deckAssignRef.current;
    const curSlot = da.activeSlot;
    const otherSlot: 0 | 1 = curSlot === 0 ? 1 : 0;
    const activeId = activeClipAtPlayhead?.id || null;
    const nextId = nextClipAtPlayhead?.id || null;

    if (da.slotClipIds[curSlot] === activeId && da.slotUrls[curSlot] === activeClipEffectiveUrl) {
      // Same clip remains on curSlot
    } else if (
      activeClipEffectiveUrl &&
      activeId !== da.slotClipIds[curSlot] &&
      (da.slotClipIds[otherSlot] === activeId || da.slotUrls[otherSlot] === activeClipEffectiveUrl)
    ) {
      // Instant A/B flip to the preloaded standby deck!
      da.activeSlot = otherSlot;
      da.slotClipIds[otherSlot] = activeId;
      da.slotUrls[otherSlot] = activeClipEffectiveUrl;
    } else {
      da.slotClipIds[curSlot] = activeId;
      da.slotUrls[curSlot] = activeClipEffectiveUrl;
    }

    const standbySlot: 0 | 1 = da.activeSlot === 0 ? 1 : 0;
    da.slotClipIds[standbySlot] = nextId;
    da.slotUrls[standbySlot] = nextClipEffectiveUrl;

    previewVideoRef.current =
      da.activeSlot === 0 ? deckAVideoRef.current : deckBVideoRef.current;
    preloadNextVideoRef.current =
      da.activeSlot === 0 ? deckBVideoRef.current : deckAVideoRef.current;

    if (preloadNextVideoRef.current) {
      try {
        preloadNextVideoRef.current.volume = 0;
        preloadNextVideoRef.current.muted = true;
      } catch {}
    }
    if (
      previewVideoRef.current &&
      (activeClipAtPlayhead?.audioMuted || (activeClipAtPlayhead?.foleyVolume ?? 0) <= 0)
    ) {
      try {
        previewVideoRef.current.volume = 0;
        previewVideoRef.current.muted = true;
      } catch {}
    }
  }
  const activeDeckSlot = deckAssignRef.current.activeSlot;
  const deckAUrl = deckAssignRef.current.slotUrls[0];
  const deckBUrl = deckAssignRef.current.slotUrls[1];

  useEffect(() => {
    const pendingVer = pendingOfficialAssetsVersionRef.current;
    if (!pendingVer || pendingVer === officialAssetsVersion) return;
    const isCurrentIntroOrOutro = activeClipAtPlayhead
      ? isOfficialClipIdentity(activeClipAtPlayhead)
      : activePlayingClipIdRef.current === 'fixed-doc-intro' ||
        activePlayingClipIdRef.current === 'fixed-doc-outro';
    const isAboutToEnterIntroOrOutro =
      isOfficialClipIdentity(nextClipAtPlayhead) &&
      activeClipAtPlayhead !== null &&
      activeClipAtPlayhead.end - currentTimeRef.current <= 1.5;
    if (!isPlaying || (!isCurrentIntroOrOutro && !isAboutToEnterIntroOrOutro)) {
      pendingOfficialAssetsVersionRef.current = 0;
      clearOfficialDeckErrorRetries();
      appliedOfficialAssetsVersionRef.current = pendingVer;
      setOfficialAssetsVersion(pendingVer);
    }
  }, [
    isPlaying,
    activeClipAtPlayhead?.id,
    activeClipAtPlayhead?.clipNumber,
    nextClipAtPlayhead?.id,
    nextClipAtPlayhead?.clipNumber,
    officialAssetsVersion,
  ]);

  const verifyOriginAndMaybeEvict = async (failedUrl: string): Promise<boolean> => {
    const refreshed = await verifyMediaBridgeHealthOrRefresh(failedUrl);
    return Boolean(refreshed);
  };

  const docClipByNumberMap = useMemo(() => {
    const map = new Map<number, DocumentaryClip>();
    for (const c of activeDoc?.clips || []) {
      if (c && typeof c.clipNumber === 'number') {
        map.set(c.clipNumber, c);
      }
    }
    return map;
  }, [activeDoc?.clips]);

  const resolvePosterThumbSrc = (
    clip?: {
      id?: string;
      clipNumber?: number;
      posterUrl?: string;
      videoUrl?: string;
    } | null
  ): string => {
    if (!clip) return '';
    const isIntroOrOutro =
      clip.id === 'fixed-doc-intro' ||
      clip.id === 'fixed-doc-outro' ||
      clip.clipNumber === 0 ||
      clip.clipNumber === 999;
    const num = typeof clip.clipNumber === 'number' ? clip.clipNumber : -1;
    const docClip = num > 0 && num !== 999 ? docClipByNumberMap.get(num) : undefined;
    const hasActiveVideo = Boolean(clip.videoUrl);
    const allowCandidate = (u?: string): string => {
      if (!u) return '';
      if (hasActiveVideo && /_Descartados_Auditoria/i.test(u)) return '';
      return u;
    };
    const raw =
      (num >= 0 ? allowCandidate(firstFrameByClip[num]) : '') ||
      (hasActiveVideo ? allowCandidate(clip.posterUrl) : '') ||
      (num > 0 ? allowCandidate(capturedClipFramesMap?.[num]) : '') ||
      allowCandidate(clip.posterUrl) ||
      allowCandidate(docClip?.videoFrames?.[0]) ||
      allowCandidate(docClip?.imagePreviewUrl) ||
      (isIntroOrOutro ? officialLogoUrl : '') ||
      '';
    if (!raw) return '';
    if (raw.startsWith('data:') || raw.startsWith('blob:')) return raw;
    const rewritten = rewriteMediaBridgeUrl(raw);
    if (rewritten) return rewritten;
    return isIntroOrOutro && officialLogoUrl ? officialLogoUrl : '';
  };

  const activeCaptionAtPlayhead = useMemo(() => {
    return (
      captions.find((cap, idx) => {
        const prevEnd = idx > 0 ? captions[idx - 1].end : 0;
        const nextStart = idx + 1 < captions.length ? captions[idx + 1].start : Infinity;
        // 60ms perceptual lead-in after pauses so live preview matches exact first-syllable onset
        const leadInStart = Math.max(prevEnd, cap.start - 0.06);
        const effEnd = Math.min(cap.end, nextStart);
        return currentTime >= leadInStart && currentTime <= effEnd;
      }) || null
    );
  }, [captions, currentTime]);

  const nearestCaptionAtPlayhead = useMemo(() => {
    if (activeCaptionAtPlayhead) return activeCaptionAtPlayhead;
    if (captions.length === 0) return null;
    if (isPlaying && (isRightPanelCollapsed || activeInspectorTab !== 'captions')) {
      return null;
    }
    return captions.reduce((best, cap) => {
      const distBest =
        currentTime < best.start
          ? best.start - currentTime
          : currentTime > best.end
          ? currentTime - best.end
          : 0;
      const distCap =
        currentTime < cap.start
          ? cap.start - currentTime
          : currentTime > cap.end
          ? currentTime - cap.end
          : 0;
      return distCap < distBest ? cap : best;
    }, captions[0]);
  }, [activeCaptionAtPlayhead, captions, currentTime]);

  // ---- Clip move / resize in the viewer (CapCut style) ----
  // The box IS the clip: it grows and shrinks with it, also beyond the frame. While a clip is selected the
  // viewer is zoomed out just enough to keep the whole clip (and its four corners) in view.
  const clipTransformOn =
    !isViewerFullscreen &&
    selectedCanvasObject === 'clip' &&
    Boolean(activeClipAtPlayhead) &&
    activeClipAtPlayhead!.clipNumber !== 0 &&
    activeClipAtPlayhead!.clipNumber !== 999;
  /** Box of the clip in percent of the frame (0..100 = the frame itself). */
  const getClipTransformBoxPct = (clip: TimelineClipItem) => {
    const f = getClipFrameAt(clip, aspectRatio, getClipElapsedAtPlayhead(clip));
    const z = f.z / 100;
    const usesFocus = aspectRatio === '9:16' && clip.reframe9x16Mode !== 'fit_blur';
    const originX = usesFocus ? (typeof clip.reframeFocusXStart === 'number' ? clip.reframeFocusXStart : 50) : 50;
    const originY = usesFocus && z > 1 ? (typeof clip.reframeFocusY === 'number' ? clip.reframeFocusY : 50) : 50;
    // An enlarged AND moved 9:16 crop is trimmed to the frame first (same as the export): its box is the frame, moved
    const trimmed = usesFocus && z > 1.004 && (Math.abs(f.x) > 0.05 || Math.abs(f.y) > 0.05);
    const size = trimmed ? 100 : z * 100;
    const left = (trimmed ? 0 : originX * (1 - z)) + f.x;
    const top = (trimmed ? 0 : originY * (1 - z)) + f.y;
    return { left, top, size, z, x: f.x, y: f.y };
  };
  const [isClipTransformDragging, setIsClipTransformDragging] = useState<boolean>(false);
  const [clipViewScale, setClipViewScale] = useState<number>(1);
  useEffect(() => {
    if (!clipTransformOn || !activeClipAtPlayhead) {
      if (clipViewScale !== 1) setClipViewScale(1);
      return;
    }
    // Frozen while dragging: changing the zoom under the pointer would distort the drag
    if (isClipTransformDragging) return;
    const b = getClipTransformBoxPct(activeClipAtPlayhead);
    const extent = Math.max(
      1,
      Math.abs(b.left - 50) / 50,
      Math.abs(b.left + b.size - 50) / 50,
      Math.abs(b.top - 50) / 50,
      Math.abs(b.top + b.size - 50) / 50
    );
    // A fixed zoom-out leaves working room around the frame, so the frame keeps its size on screen while the
    // clip grows or shrinks around it; only a clip larger than that room zooms the viewer out further.
    const next = Math.max(0.22, Math.min(0.66, 0.9 / extent));
    if (Math.abs(next - clipViewScale) > 0.004) setClipViewScale(next);
  });

  const activeMusicAtPlayhead = useMemo(() => {
    if (
      activeClipAtPlayhead?.id === 'fixed-doc-intro' ||
      activeClipAtPlayhead?.id === 'fixed-doc-outro' ||
      activeClipAtPlayhead?.clipNumber === 0 ||
      activeClipAtPlayhead?.clipNumber === 999
    ) {
      return null;
    }
    const directMatch = musicTracks.find(
      (m) => m.audioUrl && currentTime >= m.start && currentTime < m.start + m.duration
    );
    if (directMatch) return directMatch;

    // Fallback: If playhead is in a music slot without audio file (e.g. tracks 6-7),
    // extend/loop the last available playable track (Track 5) until Outro so the finale is never silent
    const playable = musicTracks.filter((m) => Boolean(m.audioUrl));
    if (playable.length > 0 && currentTime >= playable[0].start) {
      const lastPlayable = playable[playable.length - 1];
      if (currentTime >= lastPlayable.start + lastPlayable.duration && currentTime < totalDurationSec - 8) {
        return {
          ...lastPlayable,
          duration: Math.max(10, totalDurationSec - lastPlayable.start - 8),
        };
      }
    }
    return null;
  }, [musicTracks, currentTime, activeClipAtPlayhead?.id, activeClipAtPlayhead?.clipNumber, totalDurationSec]);

  const activeSeparatedVocalAtPlayhead = useMemo(() => {
    return (
      separatedVocalSegments.find(
        (seg) =>
          !seg.muted &&
          Boolean(seg.audioUrl) &&
          currentTime >= seg.start &&
          currentTime < seg.start + seg.duration
      ) || null
    );
  }, [separatedVocalSegments, currentTime]);

  const activeSeparatedMusicAtPlayhead = useMemo(() => {
    return (
      separatedMusicSegments.find(
        (seg) =>
          !seg.muted &&
          Boolean(seg.audioUrl) &&
          currentTime >= seg.start &&
          currentTime < seg.start + seg.duration
      ) || null
    );
  }, [separatedMusicSegments, currentTime]);

  const isNarratorSpeakingAtPlayhead = useMemo(() => {
    if (currentTime < voiceStartOffsetSec) return false;
    if (
      activeClipAtPlayhead &&
      (activeClipAtPlayhead.clipNumber <= 1 ||
        activeClipAtPlayhead.clipNumber === 999 ||
        activeClipAtPlayhead.id === 'fixed-doc-intro' ||
        activeClipAtPlayhead.id === 'fixed-doc-outro') &&
      voiceStartOffsetSec > 0
    ) {
      return false;
    }
    return Boolean(
      activeClipAtPlayhead?.narrationSegment?.trim() || activeCaptionAtPlayhead?.text?.trim()
    );
  }, [currentTime, voiceStartOffsetSec, activeClipAtPlayhead, activeCaptionAtPlayhead]);

  const effectiveFoleyVolumeAtPlayhead = useMemo(() => {
    if (!activeClipAtPlayhead) return 0;
    if (activeClipAtPlayhead.audioMuted) return 0;
    if (activeClipAtPlayhead.vocalsSeparated && !activeClipAtPlayhead.cleanNoVocalsVideoUrl) {
      return 0;
    }
    const isIntro =
      activeClipAtPlayhead.id === 'fixed-doc-intro' ||
      activeClipAtPlayhead.clipNumber === 0;
    const isOutro =
      activeClipAtPlayhead.id === 'fixed-doc-outro' ||
      activeClipAtPlayhead.clipNumber === 999;

    let baseFoleyVol = 0;
    if (isIntro || isOutro) {
      baseFoleyVol =
        typeof activeClipAtPlayhead.foleyVolume === 'number'
          ? activeClipAtPlayhead.foleyVolume
          : 100;
    } else if (activeClipAtPlayhead.customVolumeSet || !autoDuckingEnabled) {
      baseFoleyVol =
        typeof activeClipAtPlayhead.foleyVolume === 'number'
          ? activeClipAtPlayhead.foleyVolume
          : 40;
    } else {
      baseFoleyVol = isNarratorSpeakingAtPlayhead ? foleyDuckedVolume : foleyHighVolume;
    }

    if (baseFoleyVol <= 0) return 0;

    const defaultFadeIn =
      isIntro || isOutro
        ? 0
        : activeClipAtPlayhead.clipNumber === 1 || activeClipAtPlayhead.index === 1
        ? 1.2
        : 0;
    const defaultFadeOut = isIntro ? 5 : isOutro ? 0.15 : 0;

    const fadeInSec =
      isIntro || isOutro
        ? defaultFadeIn
        : typeof activeClipAtPlayhead.audioFadeInSec === 'number'
        ? Math.max(0, activeClipAtPlayhead.audioFadeInSec)
        : defaultFadeIn;
    const fadeOutSec =
      isIntro
        ? Math.max(5, Number(activeClipAtPlayhead.audioFadeOutSec) || 0)
        : isOutro
        ? defaultFadeOut
        : typeof activeClipAtPlayhead.audioFadeOutSec === 'number'
        ? Math.max(0, activeClipAtPlayhead.audioFadeOutSec)
        : defaultFadeOut;

    const elapsedInClip = Math.max(0, currentTime - activeClipAtPlayhead.start);
    const remainingInClip = Math.max(
      0,
      activeClipAtPlayhead.end - currentTime - (isIntro || isOutro ? 0.05 : 0)
    );
    const fadeInFactor = fadeInSec > 0 ? Math.min(1, elapsedInClip / fadeInSec) : 1;
    const fadeOutFactor = fadeOutSec > 0 ? Math.min(1, remainingInClip / fadeOutSec) : 1;
    const fadeEnvelope = Math.max(0, Math.min(fadeInFactor, fadeOutFactor));

    return Number(Math.max(0, Math.min(100, baseFoleyVol * fadeEnvelope)).toFixed(2));
  }, [
    activeClipAtPlayhead,
    autoDuckingEnabled,
    isNarratorSpeakingAtPlayhead,
    foleyDuckedVolume,
    foleyHighVolume,
    currentTime,
  ]);

  const selectedMusicTrack = useMemo(() => {
    if (selectedMusicTrackId) {
      const match = musicTracks.find((mt) => mt.id === selectedMusicTrackId);
      if (match) return match;
    }
    return activeMusicAtPlayhead || musicTracks[0] || null;
  }, [musicTracks, selectedMusicTrackId, activeMusicAtPlayhead]);

  // Automatic & Custom Per-Song Fade-In, Fade-Out & Volume (OFF during Intro & Outro)
  const effectiveMusicVolumeAtPlayhead = useMemo(() => {
    if (
      !activeMusicAtPlayhead ||
      activeClipAtPlayhead?.id === 'fixed-doc-intro' ||
      activeClipAtPlayhead?.id === 'fixed-doc-outro' ||
      activeClipAtPlayhead?.clipNumber === 0 ||
      activeClipAtPlayhead?.clipNumber === 999
    ) {
      return 0;
    }
    const rawBasePct =
      typeof activeMusicAtPlayhead.volume === 'number'
        ? activeMusicAtPlayhead.volume
        : masterMusicVolume;
    if (rawBasePct <= 0) return 0;

    // Canción 1 durante el Clip 1 (sin voz): sube hasta 50% y baja suavemente al volumen normal
    // en una rampa de 3s (desde 1s antes del final del Clip 1 hasta 2s dentro del Clip 2, antes de la voz).
    let targetBasePct = rawBasePct;
    const clip1Bounds = clipsWithTimelineBounds.find((c) => c.clipNumber === 1);
    if (activeMusicAtPlayhead.trackNumber === 1 && clip1Bounds && rawBasePct < CLIP1_SONG_BOOST_PCT) {
      const rampStart = clip1Bounds.end - CLIP1_BOOST_RAMP_BEFORE_SEC;
      const rampEnd = clip1Bounds.end + CLIP1_BOOST_RAMP_AFTER_SEC;
      if (currentTime < rampStart) {
        targetBasePct = CLIP1_SONG_BOOST_PCT;
      } else if (currentTime < rampEnd) {
        const p = (currentTime - rampStart) / (rampEnd - rampStart);
        const smooth = p * p * (3 - 2 * p);
        targetBasePct = CLIP1_SONG_BOOST_PCT + (rawBasePct - CLIP1_SONG_BOOST_PCT) * smooth;
      }
    }

    const fadeInSec = Math.max(0, activeMusicAtPlayhead.fadeInSec ?? 5);
    const fadeOutSec = Math.max(0, activeMusicAtPlayhead.fadeOutSec ?? 5);
    const elapsedInTrack = Math.max(0, currentTime - activeMusicAtPlayhead.start);
    const remainingInTrack = Math.max(
      0,
      activeMusicAtPlayhead.start + activeMusicAtPlayhead.duration - currentTime
    );
    const fadeInFactor = fadeInSec > 0 ? Math.min(1, elapsedInTrack / fadeInSec) : 1;
    const fadeOutFactor = fadeOutSec > 0 ? Math.min(1, remainingInTrack / fadeOutSec) : 1;
    const fadeEnvelope = Math.max(0, Math.min(fadeInFactor, fadeOutFactor));

    return Number(Math.max(0, Math.min(100, targetBasePct * fadeEnvelope)).toFixed(2));
  }, [
    activeMusicAtPlayhead,
    activeClipAtPlayhead?.id,
    activeClipAtPlayhead?.clipNumber,
    clipsWithTimelineBounds,
    masterMusicVolume,
    voiceVolume,
    autoDuckingEnabled,
    isNarratorSpeakingAtPlayhead,
    currentTime,
  ]);

  // Subtle Web Audio API Cinematic Ambience & Foley Synthesizer when a clip has no .MP4 audio yet
  const setCinemaAmbienceActive = (shouldPlay: boolean, volumePct: number = 25) => {
    try {
      if (!shouldPlay) {
        if (!cinemaAmbienceActiveRef.current) return;
        cinemaAmbienceActiveRef.current = false;
        if (ambientGainRef.current && webAudioCtxRef.current) {
          ambientGainRef.current.gain.setTargetAtTime(0, webAudioCtxRef.current.currentTime, 0.15);
        }
        return;
      }
      cinemaAmbienceActiveRef.current = true;
      const AudioCtx = window.AudioContext || (window as any).webkitAudioContext;
      if (!AudioCtx) return;
      if (!webAudioCtxRef.current) {
        const ctx = new AudioCtx();
        const osc1 = ctx.createOscillator();
        const osc2 = ctx.createOscillator();
        const filter = ctx.createBiquadFilter();
        const gain = ctx.createGain();

        osc1.type = 'sine';
        osc1.frequency.value = 65.41; // C2 deep cinema cello drone
        osc2.type = 'triangle';
        osc2.frequency.value = 98.0; // G2 fifth harmony
        filter.type = 'lowpass';
        filter.frequency.value = 180;
        gain.gain.value = 0.001;

        osc1.connect(filter);
        osc2.connect(filter);
        filter.connect(gain);
        gain.connect(ctx.destination);

        osc1.start();
        osc2.start();
        webAudioCtxRef.current = ctx;
        ambientGainRef.current = gain;
      }
      if (webAudioCtxRef.current.state === 'suspended') {
        webAudioCtxRef.current.resume().catch(() => {});
      }
      if (ambientGainRef.current && webAudioCtxRef.current) {
        const targetGain = Math.min(0.08, Math.max(0.01, (volumePct / 100) * 0.06));
        ambientGainRef.current.gain.setTargetAtTime(
          targetGain,
          webAudioCtxRef.current.currentTime,
          0.2
        );
      }
    } catch {}
  };

  // Apply +5 dB Web Audio gain boost (with soft peak limiter) to narrative voiceover <audio> element
  const applyVoiceoverAudioGain = (
    vo: HTMLAudioElement | null,
    volPct: number = voiceVolume,
    gainDb: number = voiceGainDb
  ) => {
    if (!vo) return;
    const baseLinear = Math.min(1, Math.max(0, volPct / 100));
    const dbMultiplier = Math.pow(10, gainDb / 20); // +5 dB => ~1.778x
    // iPhone / iPad: an <audio> routed through Web Audio goes silent whenever the AudioContext is not running
    // (created outside the Play tap, "interrupted" after switching apps, or muted by the ringer switch), while
    // plain elements such as the music and the clips keep sounding. There the voice plays directly, like the
    // music; the +5 dB boost is preview-only and the export applies it on the server anyway.
    if (IS_APPLE_TOUCH_DEVICE) {
      try {
        vo.volume = 1;
      } catch {}
      return;
    }
    try {
      const AudioCtx = window.AudioContext || (window as any).webkitAudioContext;
      if (AudioCtx) {
        if (!voiceWebAudioRef.current || voiceWebAudioRef.current.el !== vo) {
          const ctx = new AudioCtx();
          const source = ctx.createMediaElementSource(vo);
          const gainNode = ctx.createGain();
          const limiter = ctx.createDynamicsCompressor();
          limiter.threshold.value = -1.5;
          limiter.knee.value = 6;
          limiter.ratio.value = 12;
          limiter.attack.value = 0.003;
          limiter.release.value = 0.15;
          source.connect(gainNode);
          gainNode.connect(limiter);
          limiter.connect(ctx.destination);
          voiceWebAudioRef.current = { el: vo, ctx, source, gainNode };
        }
        const { ctx, gainNode } = voiceWebAudioRef.current;
        // 'interrupted' (Safari after a call or an app switch) needs resuming just like 'suspended'
        if (ctx.state !== 'running') {
          ctx.resume().catch(() => {});
        }
        if (vo.volume !== 1) vo.volume = 1;
        const nextGain = Math.max(0, baseLinear * dbMultiplier);
        if (Math.abs(gainNode.gain.value - nextGain) > 0.001) {
          gainNode.gain.value = nextGain;
        }
        return;
      }
    } catch {}
    vo.volume = baseLinear;
  };

  // VOICE DIAGNOSTIC: the phone cannot be inspected from the Mac, so a few seconds into the narrated part the
  // editor reports once (per page load and documentary) what the voice element is actually doing.
  const voiceDiagSentRef = useRef<Record<string, boolean>>({});
  useEffect(() => {
    if (!isPlaying || !isEditorActive) return;
    const docKey = activeDoc?.id || 'default';
    if (voiceDiagSentRef.current[docKey]) return;
    const timer = window.setInterval(() => {
      const t = currentTimeRef.current;
      if (t < voiceStartOffsetSec + 4 || voiceDiagSentRef.current[docKey]) return;
      voiceDiagSentRef.current[docKey] = true;
      window.clearInterval(timer);
      const vo = voiceAudioRef.current;
      const t0 = vo ? vo.currentTime : -1;
      window.setTimeout(() => {
        const mus = musicAudioRef.current;
        const snapshot = {
          docId: docKey,
          title: activeDoc?.title || '',
          appleTouch: IS_APPLE_TOUCH_DEVICE,
          ua: (navigator.userAgent || '').slice(0, 160),
          origin: window.location.origin,
          timelineSec: Number(currentTimeRef.current.toFixed(1)),
          voiceStartOffsetSec,
          voiceVolume,
          voiceGainDb,
          voice: vo
            ? {
                src: String(vo.currentSrc || vo.src || '').split('?')[0].slice(-90),
                paused: vo.paused,
                muted: vo.muted,
                volume: vo.volume,
                readyState: vo.readyState,
                networkState: vo.networkState,
                error: vo.error ? vo.error.code : 0,
                currentTime: Number(vo.currentTime.toFixed(2)),
                advancedIn1s: Number((vo.currentTime - t0).toFixed(2)),
                duration: Number.isFinite(vo.duration) ? Math.round(vo.duration) : -1,
              }
            : null,
          webAudio: voiceWebAudioRef.current ? String(voiceWebAudioRef.current.ctx.state) : 'no usado',
          music: mus ? { paused: mus.paused, muted: mus.muted, volume: mus.volume } : null,
          voiceAudioError,
        };
        try {
          void fetch(`${getEditorPrimaryServerOrigin()}/api/editor/voice-diagnostic`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(snapshot),
          }).catch(() => {});
        } catch {}
      }, 1000);
    }, 500);
    return () => window.clearInterval(timer);
  }, [isPlaying, isEditorActive, activeDoc?.id, voiceStartOffsetSec]);

  // Imperative DOM playhead synchronization: updates GPU transform on needle and time displays without React re-render
  const syncPlayheadDomImperatively = useCallback((t: number) => {
    const safeT = Math.max(0, Math.min(totalDurationSecRef.current, t));
    const needleEl = playheadNeedleRef.current;
    if (needleEl) {
      let offsetX = 0;
      if (isFitEntireProjectRef.current) {
        const laneEl = timelineRulerLaneRef.current;
        const totalW = laneEl && laneEl.clientWidth > 0 ? laneEl.clientWidth : 1000;
        const progress = Math.min(1, Math.max(0, safeT / Math.max(1, totalDurationSecRef.current)));
        offsetX = totalW * progress;
      } else {
        offsetX = safeT * timelineZoomRef.current;
      }
      needleEl.style.transform = `translate3d(${offsetX.toFixed(2)}px, 0, 0)`;
    }

    if (!isScrubbingRulerRef.current && viewerRangeInputRef.current) {
      viewerRangeInputRef.current.value = String(safeT);
    }

    const decima = Math.floor(safeT * 10);
    if (decima !== lastDecimaRef.current) {
      lastDecimaRef.current = decima;
      const mmss = formatTimeMMSS(safeT);
      const d = Math.floor((safeT % 1) * 10);
      if (playheadBadgeTextRef.current) {
        playheadBadgeTextRef.current.textContent = `${mmss}.${d}`;
      }
      if (timelineToolbarTimeRef.current) {
        timelineToolbarTimeRef.current.textContent = `• ${mmss}.${d}`;
      }
    }

    // Captions 9:16: la palabra que se está diciendo se pinta en blanco cuadro a cuadro
    const capSpan = viewerCaptionSpanRef.current;
    if (capSpan && capSpan.firstElementChild) {
      const wordEls = capSpan.querySelectorAll<HTMLElement>('span[data-ws]');
      for (let i = 0; i < wordEls.length; i++) {
        const el = wordEls[i];
        const ws = Number(el.dataset.ws);
        const we = el.dataset.we ? Number(el.dataset.we) : Infinity;
        const want = safeT >= ws && safeT < we ? KARAOKE_9X16_CAPTION.activeWordColor : '';
        if ((el.style.color !== '') !== (want !== '')) el.style.color = want;
      }
    }

    const secInt = Math.floor(safeT);
    if (secInt !== lastSecIntRef.current) {
      lastSecIntRef.current = secInt;
      if (viewerTimecodeRef.current) {
        viewerTimecodeRef.current.textContent = formatViewerTimecode(safeT);
      }
      if (viewerTotalDurationRef.current) {
        viewerTotalDurationRef.current.textContent = formatViewerTimecode(totalDurationSecRef.current);
      }
    }
  }, []);

  // Explicit manual seek helper so user scrubbing immediately updates wall-clock anchor & media players without backward drift
  const seekToTime = (targetSec: number) => {
    const clamped = Math.max(0, Math.min(totalDurationSec, targetSec));
    currentTimeRef.current = clamped;
    playTimelineStartSecRef.current = clamped;
    playWallStartMsRef.current = performance.now();
    lastSeekVersionRef.current += 1;
    clipEndedHoldRef.current = false;
    syncPlayheadDomImperatively(clamped);
    setCurrentTime(clamped);
    const clipAtTarget = clipsWithTimelineBounds.find(
      (c) => clamped >= c.start && clamped < c.end
    );
    if (clipAtTarget && selectedClipIds.length <= 1 && selectedClipId !== clipAtTarget.id) {
      setSelectedClipId(clipAtTarget.id);
      setSelectedClipIds([clipAtTarget.id]);
    }
  };

  // Focus, select, seek and scroll to a specific Stage 6 clip when jumping directly via a clip's "Editor" button
  const lastHandledFocusNonceRef = useRef<number>(0);
  useEffect(() => {
    if (
      !focusClipRequest ||
      !focusClipRequest.nonce ||
      focusClipRequest.nonce === lastHandledFocusNonceRef.current
    ) {
      return;
    }
    lastHandledFocusNonceRef.current = focusClipRequest.nonce;
    const target = clipsWithTimelineBounds.find(
      (c) => c.clipNumber === focusClipRequest.clipNumber
    );
    if (!target) return;

    setIsPlaying(false);
    setSelectedClipId(target.id);
    setSelectedClipIds([target.id]);
    seekToTime(target.start);

    const applyFocusScroll = () => {
      if (isFitEntireProject) return;
      const container = timelineScrollContainerRef.current;
      const viewWidth = container && container.clientWidth > 240 ? container.clientWidth : 960;
      const trackHeaderOffsetPx = 152;
      const playheadX = trackHeaderOffsetPx + target.start * timelineZoom;
      const targetLeft = Math.max(0, Math.round(playheadX - viewWidth * 0.3));
      savedTimelineScrollRef.current.left = targetLeft;
      if (container) {
        container.scrollLeft = targetLeft;
      }
      if (timelineRulerScrollRef.current) {
        timelineRulerScrollRef.current.scrollLeft = targetLeft;
      }
    };

    applyFocusScroll();
    const rafId = window.requestAnimationFrame(applyFocusScroll);
    const timerId = window.setTimeout(applyFocusScroll, 75);
    return () => {
      window.cancelAnimationFrame(rafId);
      window.clearTimeout(timerId);
    };
  }, [focusClipRequest?.nonce]);

  // Compute safe playback rate and clamped offset for a clip's <video> so shorter MP4 clips (e.g. 7.83s Flow clips) and trimmed/slow-mo clips fit their slot smoothly without ever freezing at the end
  const computeClipVideoSyncParams = (
    vid: HTMLVideoElement,
    clip: {
      id?: string;
      clipNumber?: number;
      start: number;
      duration: number;
      speed: number;
      trimStart: number;
      trimEnd?: number;
      sourceDuration?: number;
      smoothSlowMo?: boolean;
      opticalFlowUrl?: string;
    },
    timelineSec: number
  ) => {
    const slotDur = Math.max(0.4, clip.duration || 8);
    const hasKnownVidDur =
      typeof vid.duration === 'number' && Number.isFinite(vid.duration) && vid.duration > 0.25;
    // Flow 24fps MP4s often have audio container duration 7.85s while last video frame is at ~7.79s; reserve 0.14s cushion so video frames never hit EOF before the cut to the next clip
    const safeVidStreamEnd = hasKnownVidDur
      ? Math.max(0.25, vid.duration - 0.14)
      : Math.max(0.4, (clip.sourceDuration || 8) - 0.14);
    const elapsedInSlot = Math.max(0, timelineSec - clip.start);
    const remainingSlotSec = Math.max(0.03, slotDur - elapsedInSlot);

    // Official Intro (0) and Outro (999) always play at exact 1.0x native speed so Chrome WSOLA time-stretching never warbles or distorts their sound design
    const isFixedIntroOrOutro =
      clip.id === 'fixed-doc-intro' ||
      clip.id === 'fixed-doc-outro' ||
      clip.clipNumber === 0 ||
      clip.clipNumber === 999;
    if (isFixedIntroOrOutro) {
      const maxIntroOffset = hasKnownVidDur
        ? Math.max(0, vid.duration - 0.03)
        : Math.max(0, slotDur - 0.03);
      return {
        effectiveRate: 1,
        clampedOffset: Math.max(0, Math.min(maxIntroOffset, elapsedInSlot)),
        reachedClipMediaEnd: Boolean(elapsedInSlot >= slotDur),
      };
    }

    // If playing a pre-baked Optical Flow MP4 (_of2 / _of3), pace it across slotDur so it never freezes before the clip ends
    const usingOpticalFlowVideo = Boolean(
      clip.opticalFlowUrl &&
        (clip.opticalFlowUrl.includes('_of3') || clip.opticalFlowUrl.includes('_of2')) &&
        clip.smoothSlowMo !== false &&
        clip.speed < 0.99
    );
    if (usingOpticalFlowVideo) {
      const rawOptRatio = hasKnownVidDur ? safeVidStreamEnd / slotDur : 1;
      let optRate =
        Math.abs(rawOptRatio - 1) <= 0.04
          ? 1
          : Math.max(0.15, Math.min(4.0, Number(rawOptRatio.toFixed(4))));
      const rawOffset = elapsedInSlot * optRate;
      const maxSafeOffset = hasKnownVidDur
        ? Math.max(0, safeVidStreamEnd - 0.02)
        : Math.max(0, slotDur - 0.04);
      const clampedOffset = Math.max(0, Math.min(maxSafeOffset, rawOffset));
      const reachedClipMediaEnd = Boolean(elapsedInSlot >= slotDur);
      return {
        effectiveRate: optRate,
        clampedOffset,
        reachedClipMediaEnd,
      };
    }

    const trimStart = Math.max(0, clip.trimStart || 0);
    const trimEnd =
      typeof clip.trimEnd === 'number' && clip.trimEnd > trimStart + 0.05
        ? hasKnownVidDur
          ? Math.min(safeVidStreamEnd, clip.trimEnd)
          : clip.trimEnd
        : safeVidStreamEnd;
    const playableMediaDur = Math.max(0.2, trimEnd - trimStart);

    // Keep effectiveRate at exact 1.0x for untrimmed clips whose duration matches slotDur within 0.30s (avoids unnecessary WSOLA audio time-stretching)
    const isTrimmedOrSpeedAdjusted =
      trimStart > 0.04 ||
      Math.abs((clip.speed || 1) - 1) > 0.02 ||
      Math.abs(playableMediaDur - slotDur) > 0.3;

    let effectiveRate = !isTrimmedOrSpeedAdjusted
      ? 1
      : hasKnownVidDur
      ? Math.max(0.15, Math.min(4.0, Number((playableMediaDur / slotDur).toFixed(4))))
      : clip.speed && Math.abs(clip.speed - 1) > 0.01
      ? Math.max(0.2, Math.min(4.0, clip.speed))
      : 1;

    const rawOffset = elapsedInSlot * effectiveRate + trimStart;
    const maxSafeOffset = Math.max(trimStart, trimEnd - 0.02);
    const clampedOffset = Math.max(trimStart, Math.min(maxSafeOffset, rawOffset));
    const reachedClipMediaEnd = Boolean(elapsedInSlot >= slotDur);

    return {
      effectiveRate,
      clampedOffset,
      reachedClipMediaEnd,
    };
  };

  // Synchronous Play/Pause handler to unlock all browser audio/video elements on user click gesture
  const handleTogglePlay = () => {
    const nextPlaying = !isPlaying;
    if (!nextPlaying) {
      if (playheadRafIdRef.current) {
        cancelAnimationFrame(playheadRafIdRef.current);
        playheadRafIdRef.current = null;
      }
      setIsPlaying(false);
      setCinemaAmbienceActive(false);
      const pausedSec = currentTimeRef.current;
      setCurrentTime(pausedSec);
      syncPlayheadDomImperatively(pausedSec);
      if (deckAVideoRef.current) {
        try {
          deckAVideoRef.current.pause();
        } catch {}
      }
      if (deckBVideoRef.current) {
        try {
          deckBVideoRef.current.pause();
        } catch {}
      }
      if (voiceAudioRef.current) {
        try {
          voiceAudioRef.current.pause();
        } catch {}
      }
      if (musicAudioRef.current) {
        try {
          musicAudioRef.current.pause();
        } catch {}
      }
      if (naturalClipFoleyAudioRef.current) {
        try {
          naturalClipFoleyAudioRef.current.pause();
        } catch {}
      }
      if (typeof window !== 'undefined' && 'speechSynthesis' in window) {
        window.speechSynthesis.cancel();
      }
      return;
    }

    // If playhead is at the end, restart from 0
    const startSec = currentTime >= totalDurationSec - 0.3 ? 0 : currentTime;
    currentTimeRef.current = startSec;
    playTimelineStartSecRef.current = startSec;
    playWallStartMsRef.current = performance.now();
    lastSeekVersionRef.current += 1;
    clipEndedHoldRef.current = false;
    if (startSec !== currentTime) {
      setCurrentTime(startSec);
    }

    // 1. Unlock & play active deck <video> and unlock standby deck <video> on user gesture
    const vid = previewVideoRef.current;
    const standbyVid = preloadNextVideoRef.current;
    if (standbyVid) {
      try {
        standbyVid.volume = 0;
        standbyVid.muted = true;
        standbyVid.pause();
      } catch {}
    }
    if (vid && activeClipAtPlayhead?.videoUrl) {
      try {
        if (vid.readyState === 0 || vid.error) {
          vid.load();
        }
        const { effectiveRate, clampedOffset, reachedClipMediaEnd } = computeClipVideoSyncParams(
          vid,
          activeClipAtPlayhead,
          startSec
        );
        activePlayingClipIdRef.current = activeClipAtPlayhead.id;
        appliedVideoSeekVersionRef.current = lastSeekVersionRef.current;
        clipEndedHoldRef.current = reachedClipMediaEnd;
        vid.defaultPlaybackRate = effectiveRate;
        vid.playbackRate = effectiveRate;
        try {
          (vid as any).preservesPitch = true;
          (vid as any).webkitPreservesPitch = true;
        } catch {}
        if (vid.readyState >= 1) {
          vid.currentTime = clampedOffset;
        }
        const targetVol = Math.min(1, Math.max(0, effectiveFoleyVolumeAtPlayhead / 100));
        const shouldMute =
          targetVol <= 0 ||
          Boolean(activeClipAtPlayhead.audioMuted) ||
          (activeClipAtPlayhead.foleyVolume ?? 0) <= 0;
        vid.volume = shouldMute ? 0 : targetVol;
        vid.muted = shouldMute;
        if (!reachedClipMediaEnd) {
          vid.play().catch(() => {});
        }
        const natFoley = naturalClipFoleyAudioRef.current;
        if (natFoley) {
          natFoley.volume = 0;
          natFoley.muted = true;
          if (!natFoley.paused) natFoley.pause();
        }
      } catch {}
    }

    // 2. Unlock & play Voiceover <audio> on the synchronous user click
    const vo = voiceAudioRef.current;
    if (vo && effectiveVoiceoverUrl) {
      try {
        appliedVoiceSeekVersionRef.current = lastSeekVersionRef.current;
        applyVoiceoverAudioGain(vo, voiceVolume, voiceGainDb);
        const startClip = clipsWithTimelineBounds.find(
          (c) => startSec >= c.start && startSec < c.end
        );
        const isStartOnIntroOrOutro =
          startClip?.id === 'fixed-doc-intro' ||
          startClip?.id === 'fixed-doc-outro' ||
          startClip?.clipNumber === 0 ||
          startClip?.clipNumber === 999;
        if (!isStartOnIntroOrOutro && startSec >= voiceStartOffsetSec) {
          vo.muted = false;
          vo.currentTime = getVoiceAudioTimeForTimelineSec(startSec);
          voPlayStartedAtMsRef.current = performance.now();
          voPrepositionedSplitRef.current = false;
          vo.play().catch(() => {});
        } else {
          // Unlock autoplay permission now so deferred play at voiceStartOffsetSec never gets blocked
          vo.muted = true;
          vo.play()
            .then(() => {
              vo.pause();
              vo.muted = false;
              vo.currentTime = getVoiceAudioTimeForTimelineSec(startSec);
            })
            .catch(() => {});
        }
      } catch {}
    }

    // 3. Unlock & play Track 5 Flow Music <audio> if present (with Fade-In / Fade-Out & Voice-Priority Ducking)
    const mus = musicAudioRef.current;
    if (mus) {
      try {
        appliedMusicSeekVersionRef.current = lastSeekVersionRef.current;
        if (activeMusicAtPlayhead?.audioUrl) {
          if (
            activePlayingMusicIdRef.current !== activeMusicAtPlayhead.id ||
            mus.getAttribute('data-loaded-src') !== activeMusicAtPlayhead.audioUrl
          ) {
            activePlayingMusicIdRef.current = activeMusicAtPlayhead.id;
            mus.setAttribute('data-loaded-src', activeMusicAtPlayhead.audioUrl);
            mus.src = activeMusicAtPlayhead.audioUrl;
          }
          mus.defaultPlaybackRate = 1;
          mus.playbackRate = 1;
          (mus as any).preservesPitch = true;
          mus.muted = false;
          mus.currentTime = Math.max(0, startSec - activeMusicAtPlayhead.start);
          mus.volume = Math.min(1, Math.max(0.05, effectiveMusicVolumeAtPlayhead / 100));
          mus.play().catch(() => {});
        } else if (musicTracks[0]?.audioUrl) {
          // Unlock autoplay permission now so deferred play when the next music track starts is never blocked
          if (mus.getAttribute('data-loaded-src') !== musicTracks[0].audioUrl) {
            mus.setAttribute('data-loaded-src', musicTracks[0].audioUrl);
            mus.src = musicTracks[0].audioUrl;
          }
          mus.muted = true;
          mus.play()
            .then(() => {
              mus.pause();
              mus.muted = false;
              mus.currentTime = 0;
            })
            .catch(() => {});
        }
      } catch {}
    }

    // 3B. Unlock & play Separated Vocal Segment <audio> if present on Track 3B
    const sepVo = separatedVocalsAudioRef.current;
    if (sepVo) {
      try {
        appliedSeparatedVocalSeekVersionRef.current = lastSeekVersionRef.current;
        if (activeSeparatedVocalAtPlayhead?.audioUrl) {
          if (activePlayingSeparatedVocalIdRef.current !== activeSeparatedVocalAtPlayhead.id) {
            activePlayingSeparatedVocalIdRef.current = activeSeparatedVocalAtPlayhead.id;
            sepVo.src = activeSeparatedVocalAtPlayhead.audioUrl;
          }
          sepVo.muted = false;
          sepVo.currentTime = Math.max(0, startSec - activeSeparatedVocalAtPlayhead.start);
          sepVo.volume = Math.min(1, Math.max(0.05, (activeSeparatedVocalAtPlayhead.volume ?? 100) / 100));
          sepVo.play().catch(() => {});
        } else if (separatedVocalSegments[0]?.audioUrl) {
          sepVo.muted = true;
          sepVo.play()
            .then(() => {
              sepVo.pause();
              sepVo.muted = false;
              sepVo.currentTime = 0;
            })
            .catch(() => {});
        }
      } catch {}
    }

    // 3C. Unlock & play Separated Music Segment <audio> if present on Track 3C
    const sepMus = separatedMusicAudioRef.current;
    if (sepMus) {
      try {
        appliedSeparatedMusicSeekVersionRef.current = lastSeekVersionRef.current;
        if (activeSeparatedMusicAtPlayhead?.audioUrl) {
          if (activePlayingSeparatedMusicIdRef.current !== activeSeparatedMusicAtPlayhead.id) {
            activePlayingSeparatedMusicIdRef.current = activeSeparatedMusicAtPlayhead.id;
            sepMus.src = activeSeparatedMusicAtPlayhead.audioUrl;
          }
          sepMus.muted = false;
          sepMus.currentTime = Math.max(0, startSec - activeSeparatedMusicAtPlayhead.start);
          sepMus.volume = Math.min(1, Math.max(0.05, (activeSeparatedMusicAtPlayhead.volume ?? 100) / 100));
          sepMus.play().catch(() => {});
        } else if (separatedMusicSegments[0]?.audioUrl) {
          sepMus.muted = true;
          sepMus.play()
            .then(() => {
              sepMus.pause();
              sepMus.muted = false;
              sepMus.currentTime = 0;
            })
            .catch(() => {});
        }
      } catch {}
    }

    // 4. Start subtle Web Audio cinema drone if active clip has no .MP4 video loaded yet
    if (!activeClipAtPlayhead?.videoUrl) {
      setCinemaAmbienceActive(true, effectiveFoleyVolumeAtPlayhead);
    }

    lastSpokenClipIdRef.current = '';
    setIsPlaying(true);
  };

  const handleTogglePlayRef = useRef(handleTogglePlay);
  handleTogglePlayRef.current = handleTogglePlay;
  const isEditorActiveRef = useRef(isEditorActive);
  isEditorActiveRef.current = isEditorActive;
  const seekToTimeRef = useRef(seekToTime);
  seekToTimeRef.current = seekToTime;
  const isViewerFullscreenRef = useRef(isViewerFullscreen);
  isViewerFullscreenRef.current = isViewerFullscreen;
  const totalDurationSecRef = useRef(totalDurationSec);
  totalDurationSecRef.current = totalDurationSec;
  // 9:16: intro/outro opcionales por documental (promptConfig.MOSTRAR_INTRO_OUTRO_9X16, por defecto visibles).
  // No afecta a 16:9: los rangos solo se omiten en vista previa y exportación cuando el formato es 9:16.
  const showIntroOutro916 = activeDoc?.promptConfig?.MOSTRAR_INTRO_OUTRO_9X16 !== false;
  const hiddenIntroOutroRanges916 = useMemo(() => {
    if (aspectRatio !== '9:16' || showIntroOutro916) return [] as { start: number; end: number }[];
    return clipsWithTimelineBounds
      .filter(
        (c) =>
          c.id === 'fixed-doc-intro' ||
          c.id === 'fixed-doc-outro' ||
          c.clipNumber === 0 ||
          c.clipNumber === 999
      )
      .map((c) => ({ start: c.start, end: c.end }))
      .filter((r) => r.end > r.start + 0.05)
      .sort((x, y) => x.start - y.start);
  }, [aspectRatio, showIntroOutro916, clipsWithTimelineBounds]);
  const hiddenIntroOutroRanges916Ref = useRef(hiddenIntroOutroRanges916);
  hiddenIntroOutroRanges916Ref.current = hiddenIntroOutroRanges916;

  useEffect(() => {
    if (viewerTotalDurationRef.current) {
      viewerTotalDurationRef.current.textContent = formatViewerTimecode(totalDurationSec);
    }
  }, [totalDurationSec]);
  const clipsWithTimelineBoundsRef = useRef(clipsWithTimelineBounds);
  clipsWithTimelineBoundsRef.current = clipsWithTimelineBounds;
  const captionsRef = useRef(captions);
  captionsRef.current = captions;
  const timelineZoomRef = useRef(timelineZoom);
  timelineZoomRef.current = timelineZoom;
  const isFitEntireProjectRef = useRef(isFitEntireProject);
  isFitEntireProjectRef.current = isFitEntireProject;

  // Global keyboard shortcuts for the Video Editor viewer:
  // - Space: Play / Pause (when Video Editor is active)
  // - ArrowLeft / ArrowRight: Rewind / Advance 10 seconds (-10s / +10s) when Viewer is in Fullscreen
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (!isEditorActiveRef.current) return;
      if (e.ctrlKey || e.metaKey || e.altKey) return;

      const isFsActive =
        isViewerFullscreenRef.current ||
        Boolean(document.fullscreenElement || (document as any).webkitFullscreenElement);

      if (isFsActive && (e.key === 'ArrowLeft' || e.code === 'ArrowLeft')) {
        e.preventDefault();
        e.stopPropagation();
        seekToTimeRef.current(Math.max(0, currentTimeRef.current - 10));
        return;
      }

      if (isFsActive && (e.key === 'ArrowRight' || e.code === 'ArrowRight')) {
        e.preventDefault();
        e.stopPropagation();
        seekToTimeRef.current(
          Math.min(totalDurationSecRef.current, currentTimeRef.current + 10)
        );
        return;
      }

      if (e.code !== 'Space' && e.key !== ' ') return;
      const target = e.target as HTMLElement | null;
      if (target) {
        const tag = target.tagName;
        if (tag === 'TEXTAREA' || tag === 'SELECT' || target.isContentEditable) return;
        if (tag === 'INPUT') {
          const inputType = ((target as HTMLInputElement).type || 'text').toLowerCase();
          if (inputType !== 'range' && inputType !== 'checkbox' && inputType !== 'button') {
            return;
          }
        }
      }
      e.preventDefault();
      e.stopPropagation();
      handleTogglePlayRef.current();
    };
    window.addEventListener('keydown', onKeyDown, true);
    return () => window.removeEventListener('keydown', onKeyDown, true);
  }, []);

  const voiceClockBoundsRef = useRef({
    voiceStartOffsetSec,
    postSloganIntroBounds,
  });
  voiceClockBoundsRef.current = {
    voiceStartOffsetSec,
    postSloganIntroBounds,
  };

  // True Wall-Clock Playback Loop with 60fps GPU Playhead & Damped Audio-Master PLL
  useEffect(() => {
    if (!isPlaying) {
      if (playheadRafIdRef.current) {
        cancelAnimationFrame(playheadRafIdRef.current);
        playheadRafIdRef.current = null;
      }
      if (deckAVideoRef.current) {
        try {
          deckAVideoRef.current.pause();
        } catch {}
      }
      if (deckBVideoRef.current) {
        try {
          deckBVideoRef.current.pause();
        } catch {}
      }
      if (voiceAudioRef.current) {
        try {
          voiceAudioRef.current.pause();
        } catch {}
      }
      if (musicAudioRef.current) {
        try {
          musicAudioRef.current.pause();
        } catch {}
      }
      if (naturalClipFoleyAudioRef.current) {
        try {
          naturalClipFoleyAudioRef.current.pause();
        } catch {}
      }
      setCinemaAmbienceActive(false);
      if (typeof window !== 'undefined' && 'speechSynthesis' in window) {
        window.speechSynthesis.cancel();
      }
      return;
    }

    playTimelineStartSecRef.current = currentTimeRef.current;
    playWallStartMsRef.current = performance.now();
    lastReactCommitMsRef.current = performance.now();
    lastFlushedClipIdRef.current = activeClipAtPlayhead?.id || null;
    lastFlushedCaptionIdRef.current = activeCaptionAtPlayhead?.id || null;

    let isLoopRunning = true;

    const tick = () => {
      if (!isLoopRunning) return;

      const nowMs = performance.now();
      const elapsedSec = (nowMs - playWallStartMsRef.current) / 1000;
      let next = playTimelineStartSecRef.current + elapsedSec;

      if (next >= totalDurationSecRef.current) {
        currentTimeRef.current = 0;
        playTimelineStartSecRef.current = 0;
        playWallStartMsRef.current = nowMs;
        syncPlayheadDomImperatively(0);
        setIsPlaying(false);
        setCurrentTime(0);
        return;
      }

      // 9:16 sin intro/outro: saltar por encima de esos rangos en la reproducción
      const hiddenRange = hiddenIntroOutroRanges916Ref.current.find(
        (r) => next >= r.start && next < r.end - 0.02
      );
      if (hiddenRange) {
        if (hiddenRange.end >= totalDurationSecRef.current - 0.1) {
          syncPlayheadDomImperatively(hiddenRange.start);
          currentTimeRef.current = hiddenRange.start;
          setIsPlaying(false);
          setCurrentTime(hiddenRange.start);
          return;
        }
        seekToTimeRef.current(hiddenRange.end);
        playheadRafIdRef.current = requestAnimationFrame(tick);
        return;
      }

      // Voiceover audio phase-lock (if voiceover audio is active)
      const vo = voiceAudioRef.current;
      const { voiceStartOffsetSec: vStart, postSloganIntroBounds: psBounds } =
        voiceClockBoundsRef.current;
      if (
        vo &&
        !vo.paused &&
        !vo.ended &&
        !vo.seeking &&
        vo.readyState >= 3 &&
        nowMs - voPlayStartedAtMsRef.current >= 180
      ) {
        const nearVoiceStart = Math.abs(next - vStart) < 0.15;
        const inOrNearPostSloganIntro = psBounds
          ? next >= psBounds.start - 0.15 && next <= psBounds.end + 0.15
          : false;
        if (next > vStart + 0.15 && !nearVoiceStart && !inOrNearPostSloganIntro) {
          const audioTimelineSec =
            psBounds && next >= psBounds.end
              ? vo.currentTime + vStart + psBounds.duration
              : vo.currentTime + vStart;
          const drift = audioTimelineSec - next;
          // STRICTLY MONOTONIC: If audio is ahead, gently pull timeline forward.
          // NEVER pull master clock backward on negative drift, which caused backwards jumping and stutter!
          if (drift > 0.040 && drift <= 0.35) {
            next = next + drift * 0.20;
            playTimelineStartSecRef.current = next;
            playWallStartMsRef.current = nowMs;
          }
          // Audio BEHIND the wall clock (mobile: output latency / slow buffering). Instead of letting the
          // render effect hard-seek the voice (which replayed the same word twice on iPhone), hold the
          // timeline until the voice catches up. Monotonic: the master clock never moves backward.
          else if (drift < -0.06 && drift >= -1.2) {
            next = Math.max(currentTimeRef.current, audioTimelineSec);
            playTimelineStartSecRef.current = next;
            playWallStartMsRef.current = nowMs;
          }
        }
      }

      // Hard Monotonicity Guard: during continuous playback, timeline time NEVER decreases
      next = Math.max(currentTimeRef.current, next);
      currentTimeRef.current = next;

      // 1. Butter-smooth 60fps GPU Playhead Movement
      syncPlayheadDomImperatively(next);

      // 2. Timeline auto-scroll check (with internal 180ms throttle)
      const container = timelineScrollContainerRef.current;
      if (container && !isFitEntireProjectRef.current && !isScrubbingRulerRef.current) {
        const trackHeaderOffsetPx = 152;
        const playheadX = trackHeaderOffsetPx + next * timelineZoomRef.current;
        const viewLeft = container.scrollLeft;
        const viewWidth = container.clientWidth;
        if (viewWidth > 240) {
          const rightThreshold = viewLeft + viewWidth * 0.84;
          const leftThreshold = viewLeft + trackHeaderOffsetPx * 0.5;
          if (playheadX > rightThreshold || playheadX < leftThreshold) {
            if (nowMs - lastAutoScrollMsRef.current >= 180) {
              lastAutoScrollMsRef.current = nowMs;
              const targetLeft = Math.max(0, Math.round(playheadX - viewWidth * 0.24));
              if (Math.abs(container.scrollLeft - targetLeft) > 6) {
                container.scrollLeft = targetLeft;
                savedTimelineScrollRef.current.left = targetLeft;
              }
            }
          }
        }
      }

      // 3. Smooth PLL video playbackRate synchronization & Dual-deck pre-roll
      const vid = previewVideoRef.current;
      const standbyVid = preloadNextVideoRef.current;
      const currentBoundsClips = clipsWithTimelineBoundsRef.current;
      const curClip = currentBoundsClips.find((c) => next >= c.start && next < c.end);
      const curClipId = curClip?.id || null;

      // En el fotograma del corte React aún no ha girado los decks: `vid` sigue cargado con el clip anterior.
      // Nunca corregir deriva ni hacer seek sobre un deck que no contiene el clip actual (evita el destello del primer fotograma del clip saliente).
      const deckAssignNow = deckAssignRef.current;
      const activeDeckHoldsCurClip =
        Boolean(curClipId) && deckAssignNow.slotClipIds[deckAssignNow.activeSlot] === curClipId;
      if (vid && curClip?.videoUrl && activeDeckHoldsCurClip) {
        const { effectiveRate, clampedOffset } = computeClipVideoSyncParams(
          vid,
          curClip,
          next
        );
        const drift = clampedOffset - vid.currentTime; // + = video behind master clock, - = ahead
        const isOfficial =
          curClip.clipNumber === 0 ||
          curClip.clipNumber === 999 ||
          curClip.id === 'fixed-doc-intro' ||
          curClip.id === 'fixed-doc-outro';

        // Proportional PLL drift control without flushing hardware decode pipeline
        if (!isOfficial) {
          if (Math.abs(drift) <= 0.040) {
            // Deadband: within ~1 frame, restore nominal effectiveRate if drifted
            if (Math.abs((vid.playbackRate || 1) - effectiveRate) > 0.008) {
              vid.defaultPlaybackRate = effectiveRate;
              vid.playbackRate = effectiveRate;
            }
          } else if (Math.abs(drift) <= 0.40 && nowMs - lastRateNudgeMsRef.current >= 150) {
            lastRateNudgeMsRef.current = nowMs;
            // Gentle proportional rate adjustment (0.97x to 1.03x) that hardware decoders handle smoothly
            const rateFactor = Math.max(0.97, Math.min(1.03, 1 + drift * 0.25));
            const targetRate = Math.max(0.2, Math.min(3.0, effectiveRate * rateFactor));
            if (Math.abs((vid.playbackRate || 1) - targetRate) > 0.01) {
              vid.defaultPlaybackRate = targetRate;
              vid.playbackRate = targetRate;
            }
          } else if (
            Math.abs(drift) > 0.85 &&
            curClip.end - next > 0.40 &&
            nowMs - lastPrimaryDriftSeekMsRef.current >= 1500
          ) {
            // Hard seek ONLY on catastrophic drift (> 850ms)
            lastPrimaryDriftSeekMsRef.current = nowMs;
            try {
              vid.currentTime = clampedOffset;
              vid.defaultPlaybackRate = effectiveRate;
              vid.playbackRate = effectiveRate;
            } catch {}
          }
        }

        // Standby deck warm start / pre-roll in the 110ms window before cut
        const nextClipIdx = currentBoundsClips.findIndex((c) => c.id === curClipId);
        const nextClip =
          nextClipIdx >= 0 && nextClipIdx + 1 < currentBoundsClips.length
            ? currentBoundsClips[nextClipIdx + 1]
            : null;
        if (standbyVid && standbyVid !== vid && nextClip?.videoUrl) {
          const timeToCut = curClip.end - next;
          if (timeToCut > 0 && timeToCut <= 0.11) {
            if (!standbyArmedRef.current.prerolled && standbyVid.paused && standbyVid.readyState >= 2 && !standbyVid.seeking) {
              try {
                standbyArmedRef.current.prerolled = true;
                const nextSync = computeClipVideoSyncParams(standbyVid, nextClip, nextClip.start);
                standbyVid.defaultPlaybackRate = nextSync.effectiveRate;
                standbyVid.playbackRate = nextSync.effectiveRate;
                standbyVid.volume = 0;
                standbyVid.muted = true;
                const nextTrimStart = Math.max(0, Number(nextClip.trimStart || 0));
                if (Math.abs(standbyVid.currentTime - nextTrimStart) > 0.12) {
                  standbyVid.currentTime = nextTrimStart;
                }
                standbyVid.play().catch(() => {});
              } catch {}
            }
          }
        }
      }

      // Framing points: advance the clip size/position every animation frame
      try {
        const zoomVid = previewVideoRef.current;
        const zoomAnim = zoomVid?.dataset?.zoomAnim;
        if (zoomVid && zoomAnim) {
          const [startStr, keysStr] = zoomAnim.split('#');
          const animKeys = keysStr.split(';').map((part) => {
            const [t, z, x, y] = part.split(',').map(Number);
            return { t, z, x, y };
          });
          const f = interpolateClipFrameKeys(animKeys, next - Number(startStr));
          zoomVid.style.transform = `translate(${f.x.toFixed(3)}%, ${f.y.toFixed(3)}%) scale(${(f.z / 100).toFixed(4)})`;
        }
      } catch {}

      // 9:16 auto-pan: move the crop every animation frame (React only re-renders ~5 times/s, which made
      // the pan advance in visible jumps)
      try {
        const panVid = previewVideoRef.current;
        const panData = panVid?.dataset?.pan;
        if (panVid && panData) {
          const [pS, pE, pY, cS, cD] = panData.split('|').map(Number);
          if (cD > 0.1) {
            const prog = Math.max(0, Math.min(1, (next - cS) / cD));
            const panProg = pE >= 96 ? Math.min(1, prog / 0.6) : prog;
            const panX = (pS + (pE - pS) * panProg).toFixed(2);
            panVid.style.objectPosition = `${panX}% ${pY.toFixed(1)}%`;
            const zoomOriginY = panVid.dataset.zoomOriginY;
            if (zoomOriginY) panVid.style.transformOrigin = `${panX}% ${zoomOriginY}%`;
            const trimK = Number(panVid.dataset.trimK);
            if (zoomOriginY && trimK > 0) {
              const oy = Number(zoomOriginY);
              const px = Number(panX);
              panVid.style.clipPath = `inset(${(oy * trimK).toFixed(2)}% ${((100 - px) * trimK).toFixed(2)}% ${(
                (100 - oy) *
                trimK
              ).toFixed(2)}% ${(px * trimK).toFixed(2)}%)`;
            }
          }
        }
      } catch {}

      // 4. Boundary-Driven Hybrid React Throttling
      // Check if clip boundary crossed
      const isClipBoundary = curClipId !== lastFlushedClipIdRef.current;
      // Check if caption boundary crossed (lead-in -60ms)
      const currentCaptions = captionsRef.current;
      const curCaption = currentCaptions.find((cap, idx) => {
        const prevEnd = idx > 0 ? currentCaptions[idx - 1].end : 0;
        const leadInStart = Math.max(prevEnd, cap.start - 0.06);
        const effEnd = Math.max(cap.end, leadInStart + 0.1);
        return next >= leadInStart && next <= effEnd;
      });
      const curCaptionId = curCaption?.id || null;
      const isCaptionBoundary = curCaptionId !== lastFlushedCaptionIdRef.current;

      const isPeriodicCommit = nowMs - lastReactCommitMsRef.current >= 180; // ~5.5 Hz heartbeat

      if (isClipBoundary || isCaptionBoundary || isPeriodicCommit) {
        lastReactCommitMsRef.current = nowMs;
        lastFlushedClipIdRef.current = curClipId;
        lastFlushedCaptionIdRef.current = curCaptionId;
        setCurrentTime(next);
      }

      playheadRafIdRef.current = requestAnimationFrame(tick);
    };

    playheadRafIdRef.current = requestAnimationFrame(tick);

    return () => {
      isLoopRunning = false;
      if (playheadRafIdRef.current) {
        cancelAnimationFrame(playheadRafIdRef.current);
        playheadRafIdRef.current = null;
      }
    };
  }, [isPlaying]);

  // Keep the selected clip automatically synchronized with the clip at the real-time playhead while playing
  useEffect(() => {
    if (isPlaying && activeClipAtPlayhead?.id && selectedClipId !== activeClipAtPlayhead.id) {
      setSelectedClipId(activeClipAtPlayhead.id);
      setSelectedClipIds((prev) => (prev.length > 1 ? prev : [activeClipAtPlayhead.id]));
    }
  }, [activeClipAtPlayhead?.id, isPlaying]);

  // Auto-scroll the multitrack timeline horizontally as playback advances so the vertical playhead & active clip stay in view
  useEffect(() => {
    if (!isPlaying || isFitEntireProject || isScrubbingRulerRef.current) return;
    const container = timelineScrollContainerRef.current;
    if (!container) return;
    const trackHeaderOffsetPx = 152; // w-36 (144px) + gap-2 (8px) = 9.5rem
    const playheadX = trackHeaderOffsetPx + currentTime * timelineZoom;
    const viewLeft = container.scrollLeft;
    const viewWidth = container.clientWidth;
    if (viewWidth <= 240) return;
    const rightThreshold = viewLeft + viewWidth * 0.84;
    const leftThreshold = viewLeft + trackHeaderOffsetPx * 0.5;
    if (playheadX > rightThreshold || playheadX < leftThreshold) {
      const nowMs = performance.now();
      if (nowMs - lastAutoScrollMsRef.current >= 180) {
        lastAutoScrollMsRef.current = nowMs;
        // Instant page-flip placement creating a ~60% deadband to eliminate continuous compositor thrashing
        const targetLeft = Math.max(0, Math.round(playheadX - viewWidth * 0.24));
        if (Math.abs(container.scrollLeft - targetLeft) > 6) {
          container.scrollLeft = targetLeft;
          savedTimelineScrollRef.current.left = targetLeft;
        }
      }
    }
  }, [currentTime, isPlaying, isFitEntireProject, timelineZoom]);

  // Helper to change timeline zoom while recording the playhead's exact screen offset so it never jumps out of view
  const handleChangeTimelineZoom = (
    nextZoomOrUpdater: number | ((prevZoom: number) => number),
    nextFitEntireProject: boolean = false
  ) => {
    const container = timelineScrollContainerRef.current;
    if (container && !nextFitEntireProject) {
      const trackHeaderOffsetPx = 152; // w-36 (144px) + gap-2 (8px) = 9.5rem
      const viewWidth = container.clientWidth;
      if (isFitEntireProject) {
        const fitTrackWidth = Math.max(100, viewWidth - trackHeaderOffsetPx - 16);
        const progress = Math.min(
          1,
          Math.max(0, currentTimeRef.current / Math.max(1, totalDurationSec))
        );
        zoomPlayheadViewportOffsetRef.current = trackHeaderOffsetPx + fitTrackWidth * progress;
      } else {
        const oldPlayheadX = trackHeaderOffsetPx + currentTimeRef.current * timelineZoom;
        const currentViewportOffset = oldPlayheadX - container.scrollLeft;
        // Keep the playhead locked at its exact current visual offset on screen if visible;
        // otherwise bring it into a comfortable visible position.
        if (currentViewportOffset >= 40 && currentViewportOffset <= Math.max(240, viewWidth - 28)) {
          zoomPlayheadViewportOffsetRef.current = currentViewportOffset;
        } else {
          zoomPlayheadViewportOffsetRef.current = Math.min(
            Math.max(trackHeaderOffsetPx + 96, viewWidth * 0.42),
            Math.max(trackHeaderOffsetPx + 96, viewWidth - 64)
          );
        }
      }
    }
    setIsFitEntireProject(nextFitEntireProject);
    setTimelineZoom((prev) => {
      const rawNext =
        typeof nextZoomOrUpdater === 'function' ? nextZoomOrUpdater(prev) : nextZoomOrUpdater;
      return Math.max(1, Math.min(240, rawNext));
    });
  };

  // Synchronously adjust scrollLeft before browser paint whenever zoom, doc, or timeline width changes so the timeline stays right where it was left
  useLayoutEffect(() => {
    if (isFitEntireProject) {
      if (timelineRulerScrollRef.current) {
        timelineRulerScrollRef.current.scrollLeft = 0;
      }
      return;
    }
    const container = timelineScrollContainerRef.current;
    if (!container) return;
    if (zoomPlayheadViewportOffsetRef.current === null) {
      if (!isPlaying && container.clientWidth > 0) {
        container.scrollLeft = savedTimelineScrollRef.current.left;
        container.scrollTop = savedTimelineScrollRef.current.top;
      }
      if (!isPlaying && timelineRulerScrollRef.current) {
        timelineRulerScrollRef.current.scrollLeft = savedTimelineScrollRef.current.left;
      }
      return;
    }
    const trackHeaderOffsetPx = 152; // w-36 (144px) + gap-2 (8px) = 9.5rem
    const viewWidth = container.clientWidth;
    const newPlayheadX = trackHeaderOffsetPx + currentTimeRef.current * timelineZoom;
    const targetViewportOffset =
      zoomPlayheadViewportOffsetRef.current !== null
        ? zoomPlayheadViewportOffsetRef.current
        : Math.min(
            Math.max(trackHeaderOffsetPx + 96, viewWidth * 0.42),
            Math.max(trackHeaderOffsetPx + 96, viewWidth - 64)
          );
    const nextScrollLeft = Math.max(0, newPlayheadX - targetViewportOffset);
    container.scrollLeft = nextScrollLeft;
    savedTimelineScrollRef.current.left = nextScrollLeft;
    hasExplicitTimelineScrollRef.current = true;
    if (timelineRulerScrollRef.current) {
      timelineRulerScrollRef.current.scrollLeft = nextScrollLeft;
    }
    zoomPlayheadViewportOffsetRef.current = null;
    syncPlayheadDomImperatively(currentTimeRef.current);
  }, [
    timelineZoom,
    isFitEntireProject,
    isEditorActive,
    activeDoc?.id,
    timelineClips.length,
    totalDurationSec,
  ]);

  // Dynamic top time ruler configuration (seconds, minutes, or hours depending on zoom level)
  const timelineRulerData = useMemo(() => {
    const safeTotalSec = Math.max(10, totalDurationSec);
    const effectivePxPerSec = isFitEntireProject
      ? Math.max(960, (timelineScrollContainerRef.current?.clientWidth || 1200) - 210) / safeTotalSec
      : timelineZoom;

    let majorStepSec = 5;
    let minorStepSec = 1;
    let scaleUnitLabel = 'Segundos';

    if (effectivePxPerSec >= 35) {
      majorStepSec = 1;
      minorStepSec = 0.25;
      scaleUnitLabel = 'Segundos (1s)';
    } else if (effectivePxPerSec >= 22) {
      majorStepSec = 2;
      minorStepSec = 0.5;
      scaleUnitLabel = 'Segundos (2s)';
    } else if (effectivePxPerSec >= 10) {
      majorStepSec = 5;
      minorStepSec = 1;
      scaleUnitLabel = 'Segundos (5s)';
    } else if (effectivePxPerSec >= 5) {
      majorStepSec = 10;
      minorStepSec = 2;
      scaleUnitLabel = 'Seg / Min (10s)';
    } else if (effectivePxPerSec >= 2.2) {
      majorStepSec = 30;
      minorStepSec = 5;
      scaleUnitLabel = 'Minutos / 30s';
    } else if (effectivePxPerSec >= 0.75) {
      majorStepSec = 60;
      minorStepSec = 10;
      scaleUnitLabel = 'Minutos (1m)';
    } else if (effectivePxPerSec >= 0.25) {
      majorStepSec = 300;
      minorStepSec = 60;
      scaleUnitLabel = 'Minutos (5m)';
    } else if (effectivePxPerSec >= 0.08) {
      majorStepSec = 900;
      minorStepSec = 300;
      scaleUnitLabel = 'Horas / 15m';
    } else {
      majorStepSec = 3600;
      minorStepSec = 600;
      scaleUnitLabel = 'Horas (1h)';
    }

    const formatTickLabel = (sec: number): { text: string; isHour: boolean; isMinute: boolean } => {
      const rounded = Math.round(sec);
      const hrs = Math.floor(rounded / 3600);
      const mins = Math.floor((rounded % 3600) / 60);
      const secs = rounded % 60;

      if (rounded === 0) {
        return { text: '00:00', isHour: false, isMinute: false };
      }
      if (hrs > 0 || safeTotalSec >= 3600 || majorStepSec >= 900) {
        if (mins === 0 && secs === 0 && hrs > 0) {
          return {
            text: `${hrs}:00:00 (${hrs}h)`,
            isHour: true,
            isMinute: false,
          };
        }
        return {
          text: `${hrs}:${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`,
          isHour: mins === 0 && secs === 0,
          isMinute: secs === 0,
        };
      }
      if (mins > 0 && secs === 0) {
        return {
          text: `${String(mins).padStart(2, '0')}:00 (${mins}m)`,
          isHour: false,
          isMinute: true,
        };
      }
      if (mins === 0) {
        return {
          text:
            effectivePxPerSec >= 15
              ? `00:${String(secs).padStart(2, '0')} (${secs}s)`
              : `00:${String(secs).padStart(2, '0')}s`,
          isHour: false,
          isMinute: false,
        };
      }
      return {
        text: `${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`,
        isHour: false,
        isMinute: false,
      };
    };

    const majorTicks: Array<{
      sec: number;
      label: string;
      isHour: boolean;
      isMinute: boolean;
    }> = [];
    for (let t = 0; t <= safeTotalSec; t += majorStepSec) {
      const info = formatTickLabel(t);
      majorTicks.push({
        sec: t,
        label: info.text,
        isHour: info.isHour,
        isMinute: info.isMinute,
      });
    }

    const subdivisionsPerMajor = Math.max(1, Math.min(10, Math.round(majorStepSec / minorStepSec)));

    return {
      safeTotalSec,
      majorStepSec,
      minorStepSec,
      scaleUnitLabel,
      majorTicks,
      subdivisionsPerMajor,
    };
  }, [totalDurationSec, timelineZoom, isFitEntireProject]);

  // Click & drag on the Top Time Ruler or Playhead handle to scrub the vertical playhead in real time
  const handleStartRulerScrub = (e: React.PointerEvent<HTMLDivElement>) => {
    const rulerEl = timelineRulerLaneRef.current;
    if (!rulerEl) return;
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    e.preventDefault();
    e.stopPropagation();
    isScrubbingRulerRef.current = true;
    const pointerId = e.pointerId;

    const updateFromClientX = (clientX: number) => {
      const rect = rulerEl.getBoundingClientRect();
      if (rect.width <= 0) return;
      const ratio = Math.max(0, Math.min(1, (clientX - rect.left) / rect.width));
      seekToTime(ratio * totalDurationSec);
    };

    updateFromClientX(e.clientX);

    // Pointer events (mouse + touch + pen): continuous scrubbing while held. touch-action:none on the
    // ruler/handle keeps touch drags from scrolling the timeline horizontally.
    const onMove = (moveEvt: PointerEvent) => {
      if (moveEvt.pointerId !== pointerId) return;
      if (moveEvt.cancelable) moveEvt.preventDefault();
      updateFromClientX(moveEvt.clientX);
    };
    const onUp = (upEvt: PointerEvent) => {
      if (upEvt.pointerId !== pointerId) return;
      isScrubbingRulerRef.current = false;
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      window.removeEventListener('pointercancel', onUp);
    };

    window.addEventListener('pointermove', onMove, { passive: false });
    window.addEventListener('pointerup', onUp);
    window.addEventListener('pointercancel', onUp);
  };

  // Sync Dual-Deck (A/B Ping-Pong) preview <video>, voice <audio>, Suno music <audio>, and Ambience fallback with 85ms Pre-Roll for 0ms seamless cuts
  useEffect(() => {
    currentTimeRef.current = currentTime;
    const vid = previewVideoRef.current;
    const standbyVid = preloadNextVideoRef.current;
    if (vid && activeClipAtPlayhead?.videoUrl) {
      const { effectiveRate, clampedOffset, reachedClipMediaEnd } = computeClipVideoSyncParams(
        vid,
        activeClipAtPlayhead,
        currentTime
      );
      const isClipSwitch = activeClipAtPlayhead.id !== activePlayingClipIdRef.current;
      const isManualSeek = appliedVideoSeekVersionRef.current !== lastSeekVersionRef.current;

      const targetRateDiff = isClipSwitch || isManualSeek ? 0.015 : 0.05;
      if (
        isClipSwitch ||
        isManualSeek ||
        Math.abs((vid.playbackRate || 1) - effectiveRate) > targetRateDiff
      ) {
        try {
          vid.defaultPlaybackRate = effectiveRate;
          vid.playbackRate = effectiveRate;
          (vid as any).preservesPitch = true;
          (vid as any).webkitPreservesPitch = true;
        } catch {}
      }
      const targetVol = Math.min(1, Math.max(0, effectiveFoleyVolumeAtPlayhead / 100));
      const shouldMute =
        targetVol <= 0 ||
        Boolean(activeClipAtPlayhead.audioMuted) ||
        (activeClipAtPlayhead.foleyVolume ?? 0) <= 0;
      const expectedVol = shouldMute ? 0 : targetVol;
      if (Math.abs(vid.volume - expectedVol) > 0.005) {
        vid.volume = expectedVol;
      }
      if (vid.muted !== shouldMute) {
        vid.muted = shouldMute;
      }
      if (vid.style.opacity !== '1') {
        vid.style.opacity = '1';
      }

      const natFoley = naturalClipFoleyAudioRef.current;
      if (natFoley) {
        natFoley.volume = 0;
        natFoley.muted = true;
        if (!natFoley.paused) {
          try {
            natFoley.pause();
          } catch {}
        }
      }

      if (isClipSwitch || isManualSeek || !isPlaying) {
        activePlayingClipIdRef.current = activeClipAtPlayhead.id;
        appliedVideoSeekVersionRef.current = lastSeekVersionRef.current;
        clipEndedHoldRef.current = reachedClipMediaEnd;
        if (isClipSwitch && standbyVid && standbyVid !== vid) {
          try {
            standbyVid.style.opacity = '0';
            standbyVid.volume = 0;
            standbyVid.muted = true;
            if (!standbyVid.paused) {
              standbyVid.pause();
            }
          } catch {}
        }
        const seekThreshold = isClipSwitch && !isManualSeek && isPlaying ? 0.35 : 0.08;
        if (
          (!isPlaying || isManualSeek || isClipSwitch) &&
          vid.readyState >= 1 &&
          Math.abs(vid.currentTime - clampedOffset) > seekThreshold
        ) {
          try {
            vid.currentTime = clampedOffset;
          } catch {}
        }
        if (isPlaying && !reachedClipMediaEnd && vid.paused && vid.readyState >= 1) {
          vid.play().catch(() => {});
        }
      } else {
        // Continuous playback inside the same clip: let hardware video clock run untouched at effectiveRate
        // NEVER hard seek on minor drift (< 850ms) while playing: hard seeks cause 4K video decoders to stall and jump backward!
        const driftSec = Math.abs(vid.currentTime - clampedOffset);
        const nowMs = performance.now();
        const timeToClipEnd = activeClipAtPlayhead.end - currentTime;
        if (
          vid.readyState >= 2 &&
          !vid.seeking &&
          !vid.ended &&
          !clipEndedHoldRef.current &&
          timeToClipEnd > 0.40 &&
          driftSec > 0.85 &&
          nowMs - lastPrimaryDriftSeekMsRef.current >= 1500
        ) {
          lastPrimaryDriftSeekMsRef.current = nowMs;
          try {
            vid.currentTime = clampedOffset;
          } catch {}
        }
        if (vid.ended) {
          clipEndedHoldRef.current = true;
        } else if (!clipEndedHoldRef.current && vid.paused && vid.readyState >= 2) {
          vid.play().catch(() => {});
        }
      }

      // Standby Deck Armed State Machine: Arm once per transition boundary, eliminating 50 Hz seek thrashing
      if (standbyVid && standbyVid !== vid && nextClipAtPlayhead?.videoUrl) {
        const timeToCut = activeClipAtPlayhead.end - currentTime;
        const nextTrimStart = Math.max(0, Number(nextClipAtPlayhead.trimStart || 0));
        const nextEffectiveUrl = String(nextClipAtPlayhead.videoUrl || '');
        const armKey = `${nextClipAtPlayhead.id}|${nextEffectiveUrl}|${nextTrimStart.toFixed(3)}|${lastSeekVersionRef.current}`;

        // 110ms Pre-Roll Window: warm start right before cut so Deck B is already moving at t=0
        if (isPlaying && timeToCut > 0 && timeToCut <= 0.11) {
          if (!standbyArmedRef.current.prerolled && standbyVid.paused && standbyVid.readyState >= 2 && !standbyVid.seeking) {
            try {
              standbyArmedRef.current.prerolled = true;
              const nextSync = computeClipVideoSyncParams(
                standbyVid,
                nextClipAtPlayhead,
                nextClipAtPlayhead.start
              );
              if (Math.abs((standbyVid.playbackRate || 1) - nextSync.effectiveRate) > 0.02) {
                standbyVid.defaultPlaybackRate = nextSync.effectiveRate;
                standbyVid.playbackRate = nextSync.effectiveRate;
              }
              if (standbyVid.volume !== 0) standbyVid.volume = 0;
              if (!standbyVid.muted) standbyVid.muted = true;
              if (Math.abs(standbyVid.currentTime - nextTrimStart) > 0.12) {
                standbyVid.currentTime = nextTrimStart;
              }
              standbyVid.play().catch(() => {});
            } catch {}
          }
        } else if (timeToCut > 0.14 || !isPlaying) {
          try {
            if (standbyVid.volume !== 0) standbyVid.volume = 0;
            if (!standbyVid.muted) standbyVid.muted = true;
            if (!standbyVid.paused) {
              standbyVid.pause();
              // Reset prerolled flag if paused outside cut window
              standbyArmedRef.current.prerolled = false;
            }
            // Arm exactly ONCE per unique clip transition / seek version
            if (
              standbyArmedRef.current.key !== armKey &&
              standbyVid.readyState >= 1 &&
              !standbyVid.seeking
            ) {
              standbyArmedRef.current = { key: armKey, armed: true, prerolled: false };
              if (Math.abs(standbyVid.currentTime - nextTrimStart) > 0.08) {
                standbyVid.currentTime = nextTrimStart;
              }
            }
          } catch {}
        }
      }

      setCinemaAmbienceActive(false);
    } else if (isPlaying) {
      activePlayingClipIdRef.current = activeClipAtPlayhead?.id || null;
      setCinemaAmbienceActive(true, effectiveFoleyVolumeAtPlayhead);
    }

    const vo = voiceAudioRef.current;
    const hasWorkingVoiceFile = Boolean(vo && effectiveVoiceoverUrl && !voiceAudioError);
    if (hasWorkingVoiceFile && vo) {
      const voiceEndSec =
        effectiveVoiceDurationSec > 0
          ? voiceStartOffsetSec +
            effectiveVoiceDurationSec +
            (postSloganIntroBounds ? postSloganIntroBounds.duration : 0)
          : Infinity;
      const isIntroOrOutro =
        activeClipAtPlayhead?.id === 'fixed-doc-intro' ||
        activeClipAtPlayhead?.id === 'fixed-doc-outro' ||
        activeClipAtPlayhead?.clipNumber === 0 ||
        activeClipAtPlayhead?.clipNumber === 999;
      if (!isIntroOrOutro && currentTime >= voiceStartOffsetSec && currentTime < voiceEndSec - 0.05) {
        voPrepositionedSplitRef.current = false;
        const voTime = getVoiceAudioTimeForTimelineSec(currentTime);
        const mediaDur =
          Number.isFinite(vo.duration) && vo.duration > 1 ? vo.duration : effectiveVoiceDurationSec;
        const withinPlayableVoiceMedia =
          !(mediaDur > 1) || voTime < Math.max(0.1, mediaDur - 0.08);
        const isManualVoSeek = appliedVoiceSeekVersionRef.current !== lastSeekVersionRef.current;
        if (
          isManualVoSeek ||
          (!isPlaying && withinPlayableVoiceMedia) ||
          (!vo.ended &&
            withinPlayableVoiceMedia &&
            ((vo.paused && Math.abs(vo.currentTime - voTime) > 0.12) ||
              // During playback the rAF clock phase-locks to the voice; only re-seek on gross desync
              // (> 1.5 s). The old 0.38 s threshold fired on mobile latency and replayed words.
              (!vo.seeking && Math.abs(vo.currentTime - voTime) > 1.5)))
        ) {
          appliedVoiceSeekVersionRef.current = lastSeekVersionRef.current;
          if (isPlaying) {
            voPlayStartedAtMsRef.current = performance.now();
          }
          try {
            vo.currentTime = voTime;
          } catch {}
        }
        vo.muted = false;
        applyVoiceoverAudioGain(vo, voiceVolume, voiceGainDb);
        if (isPlaying && vo.paused && !vo.ended && withinPlayableVoiceMedia) {
          voPlayStartedAtMsRef.current = performance.now();
          vo.play().catch(() => {});
        }
      } else {
        if (!vo.paused) {
          vo.pause();
        }
        if (
          postSloganIntroBounds &&
          currentTime >= postSloganIntroBounds.start &&
          currentTime < postSloganIntroBounds.end
        ) {
          if (!voPrepositionedSplitRef.current && vo.readyState >= 1) {
            const splitAudioTarget = Math.max(
              0,
              postSloganIntroBounds.start - voiceStartOffsetSec
            );
            try {
              if (Math.abs(vo.currentTime - splitAudioTarget) > 0.03) {
                vo.currentTime = splitAudioTarget;
              }
              voPrepositionedSplitRef.current = true;
            } catch {}
          }
        } else {
          voPrepositionedSplitRef.current = false;
        }
      }
    }

    const mus = musicAudioRef.current;
    if (mus) {
      if (activeMusicAtPlayhead?.audioUrl) {
        const isTrackSwitch =
          activePlayingMusicIdRef.current !== activeMusicAtPlayhead.id ||
          mus.getAttribute('data-loaded-src') !== activeMusicAtPlayhead.audioUrl;
        if (isTrackSwitch) {
          activePlayingMusicIdRef.current = activeMusicAtPlayhead.id;
          mus.setAttribute('data-loaded-src', activeMusicAtPlayhead.audioUrl);
          mus.src = activeMusicAtPlayhead.audioUrl;
        }
        if (mus.playbackRate !== 1) {
          mus.defaultPlaybackRate = 1;
          mus.playbackRate = 1;
        }
        (mus as any).preservesPitch = true;
        const rawMusDur =
          Number.isFinite(mus.duration) && mus.duration > 1
            ? mus.duration
            : Number.isFinite(activeMusicAtPlayhead.duration) && activeMusicAtPlayhead.duration > 1
            ? activeMusicAtPlayhead.duration
            : 240;
        const rawMusTime = Math.max(0, currentTime - activeMusicAtPlayhead.start);
        const musTime = rawMusDur > 0 && rawMusTime >= rawMusDur ? rawMusTime % rawMusDur : rawMusTime;
        const isManualMusSeek = appliedMusicSeekVersionRef.current !== lastSeekVersionRef.current;
        if (
          isTrackSwitch ||
          isManualMusSeek ||
          !isPlaying ||
          Math.abs(mus.currentTime - musTime) > 1.8
        ) {
          appliedMusicSeekVersionRef.current = lastSeekVersionRef.current;
          try {
            mus.currentTime = musTime;
          } catch {}
        }
        mus.muted = false;
        mus.volume = Math.min(
          1,
          Math.max(0, effectiveMusicVolumeAtPlayhead / 100)
        );
        if (isPlaying && (mus.paused || mus.ended)) {
          if (mus.ended) {
            try {
              mus.currentTime = musTime;
            } catch {}
          }
          mus.play().catch(() => {});
        } else if (!isPlaying && !mus.paused) {
          mus.pause();
        }
      } else {
        activePlayingMusicIdRef.current = null;
        if (!mus.paused) {
          mus.pause();
        }
      }
    }

    const sepVo = separatedVocalsAudioRef.current;
    if (sepVo) {
      if (activeSeparatedVocalAtPlayhead?.audioUrl) {
        const isSegSwitch =
          activePlayingSeparatedVocalIdRef.current !== activeSeparatedVocalAtPlayhead.id;
        if (isSegSwitch) {
          activePlayingSeparatedVocalIdRef.current = activeSeparatedVocalAtPlayhead.id;
          sepVo.src = activeSeparatedVocalAtPlayhead.audioUrl;
        }
        const segTime = Math.max(0, currentTime - activeSeparatedVocalAtPlayhead.start);
        const isManualSegSeek =
          appliedSeparatedVocalSeekVersionRef.current !== lastSeekVersionRef.current;
        if (
          isSegSwitch ||
          isManualSegSeek ||
          !isPlaying ||
          Math.abs(sepVo.currentTime - segTime) > 1.2
        ) {
          appliedSeparatedVocalSeekVersionRef.current = lastSeekVersionRef.current;
          try {
            sepVo.currentTime = segTime;
          } catch {}
        }
        sepVo.muted = Boolean(activeSeparatedVocalAtPlayhead.muted);
        sepVo.volume = Math.min(
          1,
          Math.max(0, (activeSeparatedVocalAtPlayhead.volume ?? 100) / 100)
        );
        if (isPlaying && sepVo.paused && !sepVo.ended) {
          sepVo.play().catch(() => {});
        } else if (!isPlaying && !sepVo.paused) {
          sepVo.pause();
        }
      } else {
        activePlayingSeparatedVocalIdRef.current = null;
        if (!sepVo.paused) {
          sepVo.pause();
        }
      }
    }

    const sepMus = separatedMusicAudioRef.current;
    if (sepMus) {
      if (activeSeparatedMusicAtPlayhead?.audioUrl) {
        const isSegSwitch =
          activePlayingSeparatedMusicIdRef.current !== activeSeparatedMusicAtPlayhead.id;
        if (isSegSwitch) {
          activePlayingSeparatedMusicIdRef.current = activeSeparatedMusicAtPlayhead.id;
          sepMus.src = activeSeparatedMusicAtPlayhead.audioUrl;
        }
        const segTime = Math.max(0, currentTime - activeSeparatedMusicAtPlayhead.start);
        const isManualSegSeek =
          appliedSeparatedMusicSeekVersionRef.current !== lastSeekVersionRef.current;
        if (
          isSegSwitch ||
          isManualSegSeek ||
          !isPlaying ||
          Math.abs(sepMus.currentTime - segTime) > 1.2
        ) {
          appliedSeparatedMusicSeekVersionRef.current = lastSeekVersionRef.current;
          try {
            sepMus.currentTime = segTime;
          } catch {}
        }
        sepMus.muted = Boolean(activeSeparatedMusicAtPlayhead.muted);
        sepMus.volume = Math.min(
          1,
          Math.max(0, (activeSeparatedMusicAtPlayhead.volume ?? 100) / 100)
        );
        if (isPlaying && sepMus.paused && !sepMus.ended) {
          sepMus.play().catch(() => {});
        } else if (!isPlaying && !sepMus.paused) {
          sepMus.pause();
        }
      } else {
        activePlayingSeparatedMusicIdRef.current = null;
        if (!sepMus.paused) {
          sepMus.pause();
        }
      }
    }
  }, [
    currentTime,
    activeClipAtPlayhead?.id,
    activeClipAtPlayhead?.videoUrl,
    activeClipAtPlayhead?.opticalFlowUrl,
    activeClipAtPlayhead?.speed,
    activeClipAtPlayhead?.trimStart,
    activeClipAtPlayhead?.trimEnd,
    activeClipAtPlayhead?.smoothSlowMo,
    activeMusicAtPlayhead?.id,
    activeMusicAtPlayhead?.audioUrl,
    activeSeparatedVocalAtPlayhead?.id,
    activeSeparatedVocalAtPlayhead?.audioUrl,
    activeSeparatedVocalAtPlayhead?.start,
    activeSeparatedVocalAtPlayhead?.muted,
    activeSeparatedVocalAtPlayhead?.volume,
    activeSeparatedMusicAtPlayhead?.id,
    activeSeparatedMusicAtPlayhead?.audioUrl,
    activeSeparatedMusicAtPlayhead?.start,
    activeSeparatedMusicAtPlayhead?.muted,
    activeSeparatedMusicAtPlayhead?.volume,
    isPlaying,
    effectiveFoleyVolumeAtPlayhead,
    effectiveMusicVolumeAtPlayhead,
    voiceStartOffsetSec,
    voiceVolume,
    voiceGainDb,
    effectiveVoiceoverUrl,
    voiceAudioError,
    masterMusicVolume,
  ]);

  // Close clip right-click context menu on outside click or Escape, and allow deleting selected vocal or music segment with Delete/Backspace
  useEffect(() => {
    const onGlobalClick = () => {
      setClipContextMenu(null);
    };
    const onGlobalKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setClipContextMenu(null);
      }
      if (
        (e.key === 'Delete' || e.key === 'Backspace') &&
        (selectedVocalSegmentId || selectedMusicSegmentId) &&
        !(
          document.activeElement instanceof HTMLInputElement ||
          document.activeElement instanceof HTMLTextAreaElement ||
          document.activeElement instanceof HTMLSelectElement
        )
      ) {
        e.preventDefault();
        if (selectedVocalSegmentId) {
          setSeparatedVocalSegments((prev) => {
            const target = prev.find((s) => s.id === selectedVocalSegmentId);
            const next = prev.filter((s) => s.id !== selectedVocalSegmentId);
            persistDocOverlaysPatch(
              { separatedVocalSegments: next },
              activeDoc?.id || 'default'
            );
            if (target) {
              setStatusMessage(
                `🗑️ Segmento de voz "${target.title}" eliminado de la línea de tiempo.`
              );
            }
            return next;
          });
          setSelectedVocalSegmentId(null);
        }
        if (selectedMusicSegmentId) {
          setSeparatedMusicSegments((prev) => {
            const target = prev.find((s) => s.id === selectedMusicSegmentId);
            const next = prev.filter((s) => s.id !== selectedMusicSegmentId);
            persistDocOverlaysPatch(
              { separatedMusicSegments: next },
              activeDoc?.id || 'default'
            );
            if (target) {
              setStatusMessage(
                `🗑️ Segmento de música "${target.title}" eliminado de la línea de tiempo.`
              );
            }
            return next;
          });
          setSelectedMusicSegmentId(null);
        }
      }
    };
    window.addEventListener('click', onGlobalClick);
    window.addEventListener('keydown', onGlobalKeyDown);
    return () => {
      window.removeEventListener('click', onGlobalClick);
      window.removeEventListener('keydown', onGlobalKeyDown);
    };
  }, [selectedVocalSegmentId, selectedMusicSegmentId, activeDoc?.id]);

  const handleSeparateVocalsFromClips = async (targetClipIds: string[]) => {
    setClipContextMenu(null);
    const targetClips = clipsWithTimelineBounds.filter((c) => targetClipIds.includes(c.id));
    if (targetClips.length === 0) return;

    setIsSeparatingVocals(true);
    setStatusMessage(
      `🗣️ Detectando y separando el audio de las voces en ${targetClips.length} clip(s) seleccionado(s)...`
    );

    const docId = activeDoc?.id || 'default';
    const fPath = (downloadFolderPath || activeDoc?.downloadFolderPath || '').trim();
    const fName = (downloadFolderName || activeDoc?.downloadFolderName || '').trim();
    const dTitle = (activeDoc?.title || '').trim();
    const bases = getEditorMediaBridgeBases();

    const newVocalSegments: TimelineSeparatedVocalItem[] = [];
    const clipPatchById: Record<
      string,
      {
        vocalsSeparated: boolean;
        cleanNoVocalsVideoUrl?: string;
        originalVideoUrlBeforeSeparation?: string;
        videoUrl?: string;
      }
    > = {};

    for (const clip of targetClips) {
      const origVideoUrl = clip.originalVideoUrlBeforeSeparation || clip.videoUrl || '';
      let vocalsAudioUrl = '';
      let cleanVideoUrl = '';

      for (const base of bases) {
        try {
          const res = await fetch(`${base}/api/flow/separate-clip-vocals`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              clipId: clip.id,
              clipNumber: clip.clipNumber,
              videoUrl: origVideoUrl,
              fileName: clip.fileName,
              folderPath: fPath,
              folderName: fName,
              docTitle: dTitle,
              trimStart: clip.trimStart || 0,
              trimEnd: clip.trimEnd || clip.sourceDuration || clip.duration,
              speed: clip.speed || 1,
            }),
          });
          if (res.ok) {
            const data = await res.json();
            if (data.ok) {
              const prefix = (u: string) => (u && u.startsWith('/') && base ? `${base}${u}` : u);
              vocalsAudioUrl = prefix(data.vocalsAudioUrl || '');
              cleanVideoUrl = prefix(data.cleanVideoUrl || '');
              break;
            }
          }
        } catch {}
      }

      const segId = `sep-vocal-${clip.id}-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
      newVocalSegments.push({
        id: segId,
        sourceClipId: clip.id,
        clipNumber: clip.clipNumber,
        title:
          clip.clipNumber === 0
            ? '🗣️ Voz Intro'
            : clip.clipNumber === 999
            ? '🗣️ Voz Outro'
            : `🗣️ Voz Clip ${String(clip.clipNumber).padStart(2, '0')}${
                clip.partLabel ? ` (${clip.partLabel})` : ''
              }`,
        start: Number(clip.start.toFixed(2)),
        duration: Number(clip.duration.toFixed(2)),
        audioUrl: vocalsAudioUrl || origVideoUrl,
        sourceTrimStart: clip.trimStart || 0,
        speed: clip.speed || 1,
        volume: 100,
        muted: false,
      });

      clipPatchById[clip.id] = {
        vocalsSeparated: true,
        originalVideoUrlBeforeSeparation: origVideoUrl,
        cleanNoVocalsVideoUrl: cleanVideoUrl || undefined,
        ...(cleanVideoUrl ? { videoUrl: cleanVideoUrl } : {}),
      };
    }

    commitTimelineClipsUpdate((prev) =>
      prev.map((tc) => (clipPatchById[tc.id] ? { ...tc, ...clipPatchById[tc.id] } : tc))
    );

    setSeparatedVocalSegments((prev) => {
      const filtered = prev.filter((s) => !targetClipIds.includes(s.sourceClipId));
      const next = [...filtered, ...newVocalSegments].sort((a, b) => a.start - b.start);
      persistDocOverlaysPatch({ separatedVocalSegments: next }, docId);
      return next;
    });

    if (newVocalSegments.length > 0) {
      setSelectedVocalSegmentId(newVocalSegments[0].id);
    }
    setIsSeparatingVocals(false);
    setStatusMessage(
      `✅ Voces detectadas y separadas de ${targetClips.length} clip(s) en la pista "3B. 🗣️ Voces Separadas". Puedes arrastrarlas por el timeline o borrarlas con 🗑️ / Suprimir.`
    );
  };

  const handleRepairChoppyZoomForClips = async (targetClipIds: string[]) => {
    setClipContextMenu(null);
    const targetClips = clipsWithTimelineBounds.filter((c) => targetClipIds.includes(c.id));
    if (targetClips.length === 0) return;

    setStatusMessage(
      `✨ Suavizando slow zoom-in entrecortado a 60 FPS sub-píxel en ${targetClips.length} clip(s)...`
    );

    const fPath = (downloadFolderPath || activeDoc?.downloadFolderPath || '').trim();
    const fName = (downloadFolderName || activeDoc?.downloadFolderName || '').trim();
    const dTitle = (activeDoc?.title || '').trim();
    const bases = getEditorMediaBridgeBases();

    const repairedUrlById: Record<string, string> = {};
    let repairedCount = 0;

    for (const clip of targetClips) {
      const origVideoUrl = clip.originalVideoUrlBeforeSeparation || clip.videoUrl || '';
      for (const base of bases) {
        try {
          const res = await fetch(`${base}/api/flow/repair-choppy-zoom`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              clipId: clip.id,
              clipNumber: clip.clipNumber,
              videoUrl: origVideoUrl,
              fileName: clip.fileName,
              folderPath: fPath,
              folderName: fName,
              docTitle: dTitle,
            }),
          });
          if (res.ok) {
            const data = await res.json();
            if (data.ok && data.repairedVideoUrl) {
              const prefix = (u: string) => (u && u.startsWith('/') && base ? `${base}${u}` : u);
              repairedUrlById[clip.id] = prefix(data.repairedVideoUrl);
              repairedCount++;
              break;
            }
          }
        } catch {}
      }
    }

    if (repairedCount > 0) {
      commitTimelineClipsUpdate((prev) =>
        prev.map((tc) =>
          repairedUrlById[tc.id]
            ? {
                ...tc,
                videoUrl: repairedUrlById[tc.id],
                originalVideoUrlBeforeSeparation: repairedUrlById[tc.id],
                opticalFlowUrl: undefined,
                opticalFlowBakedKey: undefined,
              }
            : tc
        )
      );
      setStatusMessage(
        `✅ ${repairedCount} clip(s) con slow zoom-in reconstruidos a 60 FPS sub-píxel totalmente fluidos.`
      );
    } else {
      setStatusMessage('⚠️ No se pudo reconstruir el slow zoom-in de los clips seleccionados.');
    }
  };

  const handleDeleteSeparatedVocalSegment = (segId: string) => {
    const docId = activeDoc?.id || 'default';
    setSeparatedVocalSegments((prev) => {
      const target = prev.find((s) => s.id === segId);
      const next = prev.filter((s) => s.id !== segId);
      persistDocOverlaysPatch({ separatedVocalSegments: next }, docId);
      if (target) {
        setStatusMessage(
          `🗑️ Segmento "${target.title}" eliminado de la pista de Voces Separadas (el clip mantiene su video sin esa voz).`
        );
      }
      return next;
    });
    if (selectedVocalSegmentId === segId) {
      setSelectedVocalSegmentId(null);
    }
  };

  const handleRestoreSeparatedVocalToClip = (seg: TimelineSeparatedVocalItem) => {
    const docId = activeDoc?.id || 'default';
    commitTimelineClipsUpdate((prev) =>
      prev.map((tc) =>
        tc.id === seg.sourceClipId
          ? {
              ...tc,
              vocalsSeparated: false,
              cleanNoVocalsVideoUrl: undefined,
              videoUrl: tc.musicSeparated
                ? tc.cleanNoMusicVideoUrl || tc.originalVideoUrlBeforeSeparation || tc.videoUrl
                : tc.originalVideoUrlBeforeSeparation || tc.videoUrl,
            }
          : tc
      )
    );
    setSeparatedVocalSegments((prev) => {
      const next = prev.filter((s) => s.id !== seg.id);
      persistDocOverlaysPatch({ separatedVocalSegments: next }, docId);
      return next;
    });
    if (selectedVocalSegmentId === seg.id) {
      setSelectedVocalSegmentId(null);
    }
    setStatusMessage(`↩️ Audio de voz restaurado al Clip ${String(seg.clipNumber).padStart(2, '0')}.`);
  };

  const handleToggleMuteSeparatedVocal = (segId: string) => {
    const docId = activeDoc?.id || 'default';
    setSeparatedVocalSegments((prev) => {
      const next = prev.map((s) => (s.id === segId ? { ...s, muted: !s.muted } : s));
      persistDocOverlaysPatch({ separatedVocalSegments: next }, docId);
      return next;
    });
  };

  const handleStartDragSeparatedVocal = (
    e: React.MouseEvent,
    seg: TimelineSeparatedVocalItem,
    laneEl: HTMLDivElement | null
  ) => {
    if (e.button !== 0 || !laneEl) return;
    e.stopPropagation();
    setSelectedVocalSegmentId(seg.id);
    setSelectedMusicSegmentId(null);
    const startClientX = e.clientX;
    const initialStartSec = seg.start;
    const laneRect = laneEl.getBoundingClientRect();
    const maxStartSec = Math.max(0, totalDurationSec - seg.duration);
    let latestStartSec = initialStartSec;

    const onMove = (moveEvt: MouseEvent) => {
      const dxPx = moveEvt.clientX - startClientX;
      const deltaSec = isFitEntireProject
        ? (dxPx / Math.max(1, laneRect.width)) * totalDurationSec
        : dxPx / Math.max(1, timelineZoom);
      latestStartSec = Number(
        Math.max(0, Math.min(maxStartSec, initialStartSec + deltaSec)).toFixed(2)
      );
      setSeparatedVocalSegments((prev) =>
        prev.map((s) => (s.id === seg.id ? { ...s, start: latestStartSec } : s))
      );
    };

    const onUp = () => {
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
      const docId = activeDoc?.id || 'default';
      setSeparatedVocalSegments((prev) => {
        const sorted = [...prev].sort((a, b) => a.start - b.start);
        persistDocOverlaysPatch({ separatedVocalSegments: sorted }, docId);
        return sorted;
      });
    };

    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
  };

  const handleSeparateMusicFromClips = async (targetClipIds: string[]) => {
    setClipContextMenu(null);
    const targetClips = clipsWithTimelineBounds.filter((c) => targetClipIds.includes(c.id));
    if (targetClips.length === 0) return;

    setIsSeparatingMusic(true);
    setStatusMessage(
      `🎵 Detectando y extrayendo la música de ${targetClips.length} clip(s) seleccionado(s) en la pista 3C...`
    );

    const docId = activeDoc?.id || 'default';
    const fPath = (downloadFolderPath || activeDoc?.downloadFolderPath || '').trim();
    const fName = (downloadFolderName || activeDoc?.downloadFolderName || '').trim();
    const dTitle = (activeDoc?.title || '').trim();
    const bases = getEditorMediaBridgeBases();

    const newMusicSegments: TimelineSeparatedVocalItem[] = [];
    const clipPatchById: Record<
      string,
      {
        musicSeparated: boolean;
        cleanNoMusicVideoUrl?: string;
        originalVideoUrlBeforeSeparation?: string;
        videoUrl?: string;
      }
    > = {};

    for (const clip of targetClips) {
      const origVideoUrl = clip.originalVideoUrlBeforeSeparation || clip.videoUrl || '';
      let musicAudioUrl = '';
      let cleanVideoUrl = '';

      for (const base of bases) {
        try {
          const res = await fetch(`${base}/api/flow/separate-clip-music`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              clipId: clip.id,
              clipNumber: clip.clipNumber,
              videoUrl: origVideoUrl,
              fileName: clip.fileName,
              folderPath: fPath,
              folderName: fName,
              docTitle: dTitle,
              trimStart: clip.trimStart || 0,
              trimEnd: clip.trimEnd || clip.sourceDuration || clip.duration,
              speed: clip.speed || 1,
            }),
          });
          if (res.ok) {
            const data = await res.json();
            if (data.ok) {
              const prefix = (u: string) => (u && u.startsWith('/') && base ? `${base}${u}` : u);
              musicAudioUrl = prefix(data.musicAudioUrl || '');
              cleanVideoUrl = prefix(data.cleanVideoUrl || '');
              break;
            }
          }
        } catch {}
      }

      const segId = `sep-music-${clip.id}-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
      newMusicSegments.push({
        id: segId,
        sourceClipId: clip.id,
        clipNumber: clip.clipNumber,
        title:
          clip.clipNumber === 0
            ? '🎵 Música Intro'
            : clip.clipNumber === 999
            ? '🎵 Música Outro'
            : `🎵 Música Clip ${String(clip.clipNumber).padStart(2, '0')}${
                clip.partLabel ? ` (${clip.partLabel})` : ''
              }`,
        start: Number(clip.start.toFixed(2)),
        duration: Number(clip.duration.toFixed(2)),
        audioUrl: musicAudioUrl || origVideoUrl,
        sourceTrimStart: clip.trimStart || 0,
        speed: clip.speed || 1,
        volume: 100,
        muted: false,
        stemType: 'music',
      });

      clipPatchById[clip.id] = {
        musicSeparated: true,
        originalVideoUrlBeforeSeparation: origVideoUrl,
        cleanNoMusicVideoUrl: cleanVideoUrl || undefined,
        ...(cleanVideoUrl ? { videoUrl: cleanVideoUrl } : {}),
      };
    }

    commitTimelineClipsUpdate((prev) =>
      prev.map((tc) => (clipPatchById[tc.id] ? { ...tc, ...clipPatchById[tc.id] } : tc))
    );

    setSeparatedMusicSegments((prev) => {
      const filtered = prev.filter((s) => !targetClipIds.includes(s.sourceClipId));
      const next = [...filtered, ...newMusicSegments].sort((a, b) => a.start - b.start);
      persistDocOverlaysPatch({ separatedMusicSegments: next }, docId);
      return next;
    });

    if (newMusicSegments.length > 0) {
      setSelectedMusicSegmentId(newMusicSegments[0].id);
      setSelectedVocalSegmentId(null);
    }
    setIsSeparatingMusic(false);
    setStatusMessage(
      `✅ Música extraída de ${targetClips.length} clip(s) en la pista "3C. 🎵 Música Clips". Puedes arrastrarla por el timeline o borrarla con 🗑️ / Suprimir.`
    );
  };

  const handleDeleteSeparatedMusicSegment = (segId: string) => {
    const docId = activeDoc?.id || 'default';
    setSeparatedMusicSegments((prev) => {
      const target = prev.find((s) => s.id === segId);
      const next = prev.filter((s) => s.id !== segId);
      persistDocOverlaysPatch({ separatedMusicSegments: next }, docId);
      if (target) {
        setStatusMessage(
          `🗑️ Segmento "${target.title}" eliminado de la pista de Música Extraída (el clip conserva su video y Foley sin esa música).`
        );
      }
      return next;
    });
    if (selectedMusicSegmentId === segId) {
      setSelectedMusicSegmentId(null);
    }
  };

  const handleRestoreSeparatedMusicToClip = (seg: TimelineSeparatedVocalItem) => {
    const docId = activeDoc?.id || 'default';
    commitTimelineClipsUpdate((prev) =>
      prev.map((tc) =>
        tc.id === seg.sourceClipId
          ? {
              ...tc,
              musicSeparated: false,
              cleanNoMusicVideoUrl: undefined,
              videoUrl: tc.vocalsSeparated
                ? tc.cleanNoVocalsVideoUrl || tc.originalVideoUrlBeforeSeparation || tc.videoUrl
                : tc.originalVideoUrlBeforeSeparation || tc.videoUrl,
            }
          : tc
      )
    );
    setSeparatedMusicSegments((prev) => {
      const next = prev.filter((s) => s.id !== seg.id);
      persistDocOverlaysPatch({ separatedMusicSegments: next }, docId);
      return next;
    });
    if (selectedMusicSegmentId === seg.id) {
      setSelectedMusicSegmentId(null);
    }
    setStatusMessage(
      `↩️ Audio de música restaurado al Clip ${String(seg.clipNumber).padStart(2, '0')}.`
    );
  };

  const handleToggleMuteSeparatedMusic = (segId: string) => {
    const docId = activeDoc?.id || 'default';
    setSeparatedMusicSegments((prev) => {
      const next = prev.map((s) => (s.id === segId ? { ...s, muted: !s.muted } : s));
      persistDocOverlaysPatch({ separatedMusicSegments: next }, docId);
      return next;
    });
  };

  const handleStartDragSeparatedMusic = (
    e: React.MouseEvent,
    seg: TimelineSeparatedVocalItem,
    laneEl: HTMLDivElement | null
  ) => {
    if (e.button !== 0 || !laneEl) return;
    e.stopPropagation();
    setSelectedMusicSegmentId(seg.id);
    setSelectedVocalSegmentId(null);
    const startClientX = e.clientX;
    const initialStartSec = seg.start;
    const laneRect = laneEl.getBoundingClientRect();
    const maxStartSec = Math.max(0, totalDurationSec - seg.duration);
    let latestStartSec = initialStartSec;

    const onMove = (moveEvt: MouseEvent) => {
      const dxPx = moveEvt.clientX - startClientX;
      const deltaSec = isFitEntireProject
        ? (dxPx / Math.max(1, laneRect.width)) * totalDurationSec
        : dxPx / Math.max(1, timelineZoom);
      latestStartSec = Number(
        Math.max(0, Math.min(maxStartSec, initialStartSec + deltaSec)).toFixed(2)
      );
      setSeparatedMusicSegments((prev) =>
        prev.map((s) => (s.id === seg.id ? { ...s, start: latestStartSec } : s))
      );
    };

    const onUp = () => {
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
      const docId = activeDoc?.id || 'default';
      setSeparatedMusicSegments((prev) => {
        const sorted = [...prev].sort((a, b) => a.start - b.start);
        persistDocOverlaysPatch({ separatedMusicSegments: sorted }, docId);
        return sorted;
      });
    };

    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
  };

  const [rerenderingBrollClipNum, setRerenderingBrollClipNum] = useState<number | null>(null);

  const handleRerenderBrollCameraMotion = async (
    targetClip: TimelineClipItem,
    nextMotion: BrollCameraMotion
  ) => {
    if (!targetClip || targetClip.clipNumber <= 0) return;
    const clipNum = targetClip.clipNumber;
    const padded = String(clipNum).padStart(2, '0');
    const motionLabel = BROLL_MOTION_UI_LABEL_ES[nextMotion] || nextMotion;
    setRerenderingBrollClipNum(clipNum);
    setStatusMessage(
      `🎥 Re-renderizando cámara óptica B-Roll (${motionLabel}) en 4K · 60fps para la Escena ${padded}...`
    );

    const fPath = (downloadFolderPath || activeDoc?.downloadFolderPath || '').trim();
    const fName = (downloadFolderName || activeDoc?.downloadFolderName || '').trim();
    const dTitle = (activeDoc?.title || '').trim();
    const docClip = activeDoc?.clips?.find((dc) => dc.clipNumber === clipNum);
    const durSec = Math.max(2, Math.round(targetClip.sourceDuration || targetClip.duration || 8));
    const bases = getEditorMediaBridgeBases();

    try {
      let renderedData: any = null;
      let chosenBase = '';
      let lastErr = '';
      for (const base of bases) {
        try {
          const resp = await fetch(`${base}/api/flow/rerender-broll-clip`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              docId: activeDoc?.id || '',
              folderPath: fPath,
              folderName: fName,
              docTitle: dTitle,
              aspectRatio,
              clipNumber: clipNum,
              motion: nextMotion,
              durationSec: durSec,
              imagePrompt: docClip?.imagePrompt || targetClip.imagePrompt || '',
              currentFileName: targetClip.fileName || '',
            }),
          });
          const data = await resp.json().catch(() => null);
          if (resp.ok && data?.ok && data.url) {
            renderedData = data;
            chosenBase = base;
            break;
          }
          if (data?.error) lastErr = data.error;
        } catch (e: any) {
          lastErr = e?.message || lastErr;
        }
      }

      if (!renderedData?.url) {
        throw new Error(
          lastErr ||
            `No se pudo re-renderizar la Escena B-Roll ${padded}. Verifica que la imagen fuente esté en la carpeta del proyecto.`
        );
      }

      const canonicalFreshUrl = toCanonicalMediaBridgePath(renderedData.url);
      const freshUrl =
        renderedData.url.startsWith('/') && chosenBase
          ? `${chosenBase}${renderedData.url}`
          : renderedData.url;
      const freshFileName = renderedData.fileName || targetClip.fileName;

      setLocalServerClipVideosMap((prev) => ({
        ...prev,
        [clipNum]: canonicalFreshUrl || freshUrl,
      }));
      delete extractedVideoUrlByClipRef.current[clipNum];

      const docId = activeDoc?.id || 'default';
      setTimelineClips((prev) => {
        const updated = prev.map((c) =>
          c.clipNumber === clipNum
            ? {
                ...c,
                isStaticBroll: true,
                brollCameraMotion: nextMotion,
                fileName: freshFileName,
                videoUrl: freshUrl,
                opticalFlowUrl: undefined,
                opticalFlowBakedKey: undefined,
                cleanFoleyOnlyVideoUrl: undefined,
                cleanOpticalFlowOnlyUrl: undefined,
                originalVideoUrlBeforeSeparation: freshUrl,
                originalOpticalFlowUrlBeforeSeparation: undefined,
              }
            : c
        );
        persistDocOverlaysPatch({ customTimelineClips: updated }, docId);
        return updated;
      });

      if (activeDoc && Array.isArray(activeDoc.clips)) {
        const nextDocClips = activeDoc.clips.map((dc) =>
          dc.clipNumber === clipNum
            ? {
                ...dc,
                isStaticBroll: true,
                brollCameraMotion: nextMotion,
                videoPrompt: '',
                videoSavedFileName: freshFileName,
                imagePrompt: dc.imagePrompt
                  ? normalizeBrollImagePrompt(
                      dc.imagePrompt,
                      dc.clipNumber,
                      dc.timeRange,
                      durSec,
                      nextMotion
                    )
                  : dc.imagePrompt,
              }
            : dc
        );
        updateActiveDoc({ clips: nextDocClips });
      }

      setStatusMessage(
        `✅ Escena B-Roll ${padded} actualizada en vivo a "${motionLabel}" (4K UHD · 60fps).`
      );
    } catch (err: any) {
      setStatusMessage(`⚠️ ${err?.message || 'Error al cambiar el movimiento B-Roll.'}`);
    } finally {
      setRerenderingBrollClipNum(null);
    }
  };

  // Detect, separate, and eliminate BOTH music and voices from selected clip(s), leaving ONLY ambient Foley audio
  const handleIsolateFoleyOnlyFromClips = async (targetClipIds: string[]) => {
    setClipContextMenu(null);
    const validIds = Array.from(new Set(targetClipIds.filter(Boolean)));
    if (validIds.length === 0) return;

    const targetClips = clipsWithTimelineBounds.filter(
      (c) => validIds.includes(c.id) && !c.isStaticBroll && !/_broll_4k/i.test(c.fileName || '')
    );
    if (targetClips.length === 0) return;

    setIsIsolatingFoley(true);
    setFoleyIsolationProgress({ current: 0, total: targetClips.length });
    setStatusMessage(
      `🌿 Detectando, separando y eliminando música y voces en ${targetClips.length} clip(s) para dejar solo el Foley ambiente...`
    );

    const docId = activeDoc?.id || 'default';
    const fPath = (downloadFolderPath || activeDoc?.downloadFolderPath || '').trim();
    const fName = (downloadFolderName || activeDoc?.downloadFolderName || '').trim();
    const dTitle = (activeDoc?.title || '').trim();
    const bases = getEditorMediaBridgeBases();

    try {
      const isolatedMap: Record<
        string,
        {
          cleanFoleyVideoUrl?: string;
          cleanOpticalFlowUrl?: string;
          origVideoUrl: string;
          origOpticalFlowUrl?: string;
        }
      > = {};

      let pureFoleyUntouchedCount = 0;
      let surgicalCleanedCount = 0;

      for (let i = 0; i < targetClips.length; i++) {
        const clip = targetClips[i];
        setFoleyIsolationProgress({ current: i + 1, total: targetClips.length });
        setStatusMessage(
          `🌿 (${i + 1}/${targetClips.length}) Analizando audio de Clip ${String(clip.clipNumber).padStart(2, '0')} (conservando 100% del Foley y eliminando solo voces/música)...`
        );

        const rawOrigVideoUrl = clip.originalVideoUrlBeforeSeparation || clip.videoUrl || '';
        const origVideoUrl = rawOrigVideoUrl.includes('_foley_only.mp4')
          ? clip.videoUrl || rawOrigVideoUrl
          : rawOrigVideoUrl;
        const rawOrigOpticalFlowUrl =
          clip.originalOpticalFlowUrlBeforeSeparation || clip.opticalFlowUrl || '';
        const origOpticalFlowUrl = rawOrigOpticalFlowUrl.includes('_foley_only.mp4')
          ? rawOrigOpticalFlowUrl.replace(/_foley_only\.mp4/gi, '.mp4')
          : rawOrigOpticalFlowUrl;
        let cleanFoleyVideoUrl: string | undefined;
        let cleanOpticalFlowUrl: string | undefined;
        let alreadyPureFoley = false;

        for (const base of bases) {
          try {
            const resp = await fetch(`${base}/api/flow/isolate-clip-foley`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                clipId: clip.id,
                clipNumber: clip.clipNumber,
                videoUrl: origVideoUrl,
                opticalFlowUrl: origOpticalFlowUrl,
                fileName: clip.fileName,
                folderPath: fPath,
                folderName: fName,
                docTitle: dTitle,
              }),
            });
            if (resp.ok) {
              const data = await resp.json();
              if (data.ok) {
                const prefix = (u: string) => (u && u.startsWith('/') && base ? `${base}${u}` : u);
                if (data.cleanFoleyVideoUrl) cleanFoleyVideoUrl = prefix(data.cleanFoleyVideoUrl);
                if (data.cleanOpticalFlowUrl) cleanOpticalFlowUrl = prefix(data.cleanOpticalFlowUrl);
                alreadyPureFoley = Boolean(data.alreadyPureFoley);
                break;
              }
            }
          } catch {}
        }

        if (alreadyPureFoley) {
          pureFoleyUntouchedCount++;
        } else if (cleanFoleyVideoUrl || cleanOpticalFlowUrl) {
          surgicalCleanedCount++;
        }

        const safePristineOrigUrl =
          alreadyPureFoley && cleanFoleyVideoUrl ? cleanFoleyVideoUrl : origVideoUrl;

        isolatedMap[clip.id] = {
          cleanFoleyVideoUrl,
          cleanOpticalFlowUrl,
          origVideoUrl: safePristineOrigUrl,
          origOpticalFlowUrl,
        };

        // Update this clip immediately on the timeline so user sees live progress clip by clip
        if (cleanFoleyVideoUrl || cleanOpticalFlowUrl) {
          const cid = clip.id;
          setTimelineClips((prev) =>
            prev.map((c) =>
              c.id === cid
                ? {
                    ...c,
                    foleyOnlyIsolated: true,
                    foleyOnlyDisabled: false,
                    vocalsSeparated: false,
                    musicSeparated: false,
                    originalVideoUrlBeforeSeparation: safePristineOrigUrl || c.videoUrl,
                    originalOpticalFlowUrlBeforeSeparation:
                      origOpticalFlowUrl || c.opticalFlowUrl,
                    cleanFoleyOnlyVideoUrl: cleanFoleyVideoUrl || c.cleanFoleyOnlyVideoUrl,
                    cleanOpticalFlowOnlyUrl: cleanOpticalFlowUrl || c.cleanOpticalFlowOnlyUrl,
                    videoUrl: cleanFoleyVideoUrl || c.videoUrl,
                    opticalFlowUrl: cleanOpticalFlowUrl || c.opticalFlowUrl,
                    foleyVolume:
                      c.audioMuted || c.customVolumeSet
                        ? c.foleyVolume
                        : c.clipNumber === 1
                        ? 80
                        : 20,
                  }
                : c
            )
          );
        }
      }

      // Remove any separated vocal or music stems for these clips so they are completely eliminated
      setSeparatedVocalSegments((prev) => {
        const next = prev.filter((s) => !validIds.includes(s.sourceClipId));
        persistDocOverlaysPatch({ separatedVocalSegments: next }, docId);
        return next;
      });
      setSeparatedMusicSegments((prev) => {
        const next = prev.filter((s) => !validIds.includes(s.sourceClipId));
        persistDocOverlaysPatch({ separatedMusicSegments: next }, docId);
        return next;
      });

      commitTimelineClipsUpdate((prev) =>
        prev.map((c) => {
          const info = isolatedMap[c.id];
          if (!info) return c;
          const hasClean = Boolean(
            info.cleanFoleyVideoUrl || info.cleanOpticalFlowUrl || c.cleanFoleyOnlyVideoUrl
          );
          if (!hasClean) return c;
          return {
            ...c,
            foleyOnlyIsolated: true,
            foleyOnlyDisabled: false,
            vocalsSeparated: false,
            musicSeparated: false,
            originalVideoUrlBeforeSeparation: info.origVideoUrl || c.videoUrl,
            originalOpticalFlowUrlBeforeSeparation:
              info.origOpticalFlowUrl || c.opticalFlowUrl,
            cleanFoleyOnlyVideoUrl: info.cleanFoleyVideoUrl || c.cleanFoleyOnlyVideoUrl,
            cleanOpticalFlowOnlyUrl: info.cleanOpticalFlowUrl || c.cleanOpticalFlowOnlyUrl,
            videoUrl: info.cleanFoleyVideoUrl || c.videoUrl,
            opticalFlowUrl: info.cleanOpticalFlowUrl || c.opticalFlowUrl,
            foleyVolume:
              c.audioMuted || c.customVolumeSet
                ? c.foleyVolume
                : c.clipNumber === 1
                ? 80
                : 20,
          };
        })
      );

      setStatusMessage(
        `✅ Foley listo en ${targetClips.length} clip(s): ${pureFoleyUntouchedCount} clip(s) con Foley puro intacto al 100% y ${surgicalCleanedCount} clip(s) con voces/música limpiadas quirúrgicamente.`
      );
    } finally {
      setIsIsolatingFoley(false);
      setFoleyIsolationProgress(null);
    }
  };

  // Batch helper: Isolate Foley Only across all body clips in the timeline (excluding Intro 0 and Outro 999)
  const handleIsolateFoleyForAllClips = async () => {
    const bodyClipIds = timelineClips
      .filter((c) => c.clipNumber > 0 && c.clipNumber !== 999)
      .map((c) => c.id);
    if (bodyClipIds.length === 0) return;
    await handleIsolateFoleyOnlyFromClips(bodyClipIds);
  };

  const handleToggleAutoIsolateFoleyAllClips = async () => {
    const next = !autoIsolateFoleyAllClips;
    setAutoIsolateFoleyAllClips(next);
    try {
      localStorage.setItem('huellas_editor_auto_foley_only_v3', next ? 'true' : 'false');
    } catch {}
    if (next) {
      autoAttemptedFoleyClipIdsRef.current.clear();
      commitTimelineClipsUpdate((prev) =>
        prev.map((c) =>
          c.clipNumber > 0 && c.clipNumber !== 999 ? { ...c, foleyOnlyDisabled: false } : c
        )
      );
      await handleIsolateFoleyForAllClips();
    } else {
      const allBodyIds = timelineClips
        .filter((c) => c.clipNumber > 0 && c.clipNumber !== 999)
        .map((c) => c.id);
      commitTimelineClipsUpdate((prev) =>
        prev.map((c) => {
          if (!allBodyIds.includes(c.id)) return c;
          return {
            ...c,
            foleyOnlyIsolated: false,
            foleyOnlyDisabled: true,
            videoUrl: c.originalVideoUrlBeforeSeparation || c.videoUrl,
            opticalFlowUrl: c.originalOpticalFlowUrlBeforeSeparation || c.opticalFlowUrl,
          };
        })
      );
      setStatusMessage('ℹ️ Opción "Solo Foley en Todos los Clips" desmarcada: audio original restaurado.');
    }
  };

  // Automatically restore any clip that previously pointed to a foley/vocals/music separation cache back to its original untouched audio
  useEffect(() => {
    const hasModifiedClipAudio = timelineClips.some(
      (c) =>
        c.foleyOnlyIsolated ||
        c.vocalsSeparated ||
        c.musicSeparated ||
        Boolean(c.videoUrl && c.videoUrl.includes('.foley_only_cache')) ||
        Boolean(c.videoUrl && c.videoUrl.includes('.vocals_clean_cache')) ||
        Boolean(c.videoUrl && c.videoUrl.includes('.music_clean_cache')) ||
        Boolean(c.opticalFlowUrl && c.opticalFlowUrl.includes('.foley_only_cache'))
    );
    if (!hasModifiedClipAudio) return;
    commitTimelineClipsUpdate((prev) =>
      prev.map((c) => {
        const docClip = activeDoc?.clips?.find((dc) => dc.clipNumber === c.clipNumber);
        const rawSrvUrl = localServerClipVideosMap[c.clipNumber] || '';
        const srvMeta = extractEditorMediaUrlMeta(rawSrvUrl);
        const validSrvUrl =
          rawSrvUrl &&
          !isEditorFolderItemDiscarded(docClip, srvMeta.fileName, srvMeta.mtimeMs, rawSrvUrl)
            ? rawSrvUrl
            : '';
        const cleanVid =
          validSrvUrl ||
          capturedClipVideosMap[c.clipNumber] ||
          (isEditorClipRejectedOrQuarantined(docClip)
            ? ''
            : c.originalVideoUrlBeforeSeparation || c.videoUrl);
        const cleanOpt =
          c.originalOpticalFlowUrlBeforeSeparation &&
          !c.originalOpticalFlowUrlBeforeSeparation.includes('.foley_only_cache')
            ? c.originalOpticalFlowUrlBeforeSeparation
            : c.opticalFlowUrl && !c.opticalFlowUrl.includes('.foley_only_cache')
            ? c.opticalFlowUrl
            : undefined;
        return {
          ...c,
          foleyOnlyIsolated: false,
          cleanFoleyOnlyVideoUrl: undefined,
          cleanOpticalFlowOnlyUrl: undefined,
          vocalsSeparated: false,
          cleanNoVocalsVideoUrl: undefined,
          musicSeparated: false,
          cleanNoMusicVideoUrl: undefined,
          videoUrl: cleanVid,
          opticalFlowUrl: cleanOpt,
        };
      }),
      false
    );
  }, [timelineClips, localServerClipVideosMap, capturedClipVideosMap]);

  // Restore original uncleaned audio to clip(s)
  const handleRestoreOriginalAudioToClip = (targetClipIds: string[]) => {
    const validIds = Array.from(new Set(targetClipIds.filter(Boolean)));
    if (validIds.length === 0) return;
    setClipContextMenu(null);
    const allBodyCount = timelineClips.filter((c) => c.clipNumber > 0 && c.clipNumber !== 999).length;
    if (autoIsolateFoleyAllClips && allBodyCount > 0 && validIds.length >= allBodyCount) {
      setAutoIsolateFoleyAllClips(false);
      try {
        localStorage.setItem('huellas_editor_auto_foley_only_v3', 'false');
      } catch {}
    }
    commitTimelineClipsUpdate((prev) =>
      prev.map((c) => {
        if (!validIds.includes(c.id)) return c;
        return {
          ...c,
          foleyOnlyIsolated: false,
          foleyOnlyDisabled: true,
          vocalsSeparated: false,
          musicSeparated: false,
          videoUrl: c.originalVideoUrlBeforeSeparation || c.videoUrl,
          opticalFlowUrl: c.originalOpticalFlowUrlBeforeSeparation || c.opticalFlowUrl,
        };
      })
    );
    setStatusMessage(
      `↩️ Audio original restaurado en ${validIds.length} clip(s).`
    );
  };

  // Toggle Solo Foley Ambiente on/off for selected clip(s) (selectable, checked by default)
  const handleToggleClipFoleyOnly = async (targetClipIds: string[], enable: boolean) => {
    const validIds = Array.from(new Set(targetClipIds.filter(Boolean)));
    if (validIds.length === 0) return;
    if (enable) {
      commitTimelineClipsUpdate((prev) =>
        prev.map((c) =>
          validIds.includes(c.id)
            ? {
                ...c,
                foleyOnlyDisabled: false,
                foleyOnlyIsolated: Boolean(c.cleanFoleyOnlyVideoUrl) || true,
                videoUrl: c.cleanFoleyOnlyVideoUrl || c.videoUrl,
                opticalFlowUrl: c.cleanOpticalFlowOnlyUrl || c.opticalFlowUrl,
              }
            : c
        )
      );
      await handleIsolateFoleyOnlyFromClips(validIds);
    } else {
      handleRestoreOriginalAudioToClip(validIds);
    }
  };

  // Undo stack and Optical Flow processing state for Track 3 Clips
  const [clipUndoStack, setClipUndoStack] = useState<TimelineClipItem[][]>([]);
  const [opticalFlowProcessingByClipId, setOpticalFlowProcessingByClipId] = useState<
    Record<string, boolean>
  >({});
  const [autoStretchOnTrim, setAutoStretchOnTrim] = useState<boolean>(true);
  const opticalFlowDebounceTimerRef = useRef<Record<string, any>>({});

  const getClipActiveSourceSpan = (clip: TimelineClipItem): number => {
    const srcDur = clip.sourceDuration && clip.sourceDuration > 0.2 ? clip.sourceDuration : 8;
    const tStart = Math.max(0, Number(clip.trimStart || 0));
    const tEnd =
      typeof clip.trimEnd === 'number' && clip.trimEnd > tStart + 0.05 ? clip.trimEnd : srcDur;
    return Math.max(0.2, Number((tEnd - tStart).toFixed(2)));
  };

  const commitTimelineClipsUpdate = (
    updater: (prev: TimelineClipItem[]) => TimelineClipItem[],
    recordUndo = true
  ) => {
    setTimelineClips((prev) => {
      if (recordUndo) {
        setClipUndoStack((stack) => [...stack.slice(-24), prev]);
      }
      let next = updater(prev);
      if (isVideo76Doc && effectiveVoiceDurationSec > 20 && next.length >= 3) {
        const outroIdx = next.findIndex(
          (c) => c.id === 'fixed-doc-outro' || c.clipNumber === 999
        );
        if (outroIdx > 0) {
          const { voiceEntrySec: hookSec } = getStage1ClipDurations(activeDoc);
          const requiredBeforeOutroSec = Number(
            (8 + hookSec + effectiveVoiceDurationSec + 1.2).toFixed(2)
          );
          const preOutroSum = next
            .slice(0, outroIdx)
            .reduce((acc, c) => acc + (Number(c.duration) || 0), 0);
          const deficit = Number((requiredBeforeOutroSec - preOutroSum).toFixed(2));
          if (Math.abs(deficit) > 0.15) {
            const candidateIndices = next
              .map((c, idx) => ({ c, idx }))
              .filter(({ c, idx }) => {
                if (idx >= outroIdx || c.clipNumber < 8 || c.clipNumber === 999) return false;
                const srcDur = Number(c.sourceDuration) || 10;
                const tStart = Number(c.trimStart) || 0;
                const tEnd = typeof c.trimEnd === 'number' && c.trimEnd > tStart + 0.1 ? c.trimEnd : srcDur;
                return !(tStart > 0.05 || tEnd < srcDur - 0.15);
              })
              .map((x) => x.idx);
            if (candidateIndices.length > 0) {
              const deltaPerClip = deficit / candidateIndices.length;
              const candSet = new Set(candidateIndices);
              next = next.map((c, idx) => {
                if (!candSet.has(idx)) return c;
                const newDur = Number(Math.max(4, (Number(c.duration) || 10) + deltaPerClip).toFixed(2));
                return {
                  ...c,
                  duration: newDur,
                  originalSlotDuration: newDur,
                };
              });
            }
          }
        }
      }
      const docId = activeDoc?.id || 'default';
      persistDocOverlaysPatch(
        {
          userEditedClips: true,
          customTimelineClips: next,
        },
        docId
      );
      return next;
    });
  };

  const handleUndoClipEdit = () => {
    setClipUndoStack((stack) => {
      if (stack.length === 0) {
        setStatusMessage('ℹ️ No hay cortes ni eliminaciones pendientes por deshacer.');
        return stack;
      }
      const previousClips = stack[stack.length - 1];
      const nextStack = stack.slice(0, -1);
      setTimelineClips(previousClips);
      const docId = activeDoc?.id || 'default';
      persistDocOverlaysPatch(
        {
          userEditedClips: true,
          customTimelineClips: previousClips,
        },
        docId
      );
      setStatusMessage('↩️ Último cambio en los clips deshecho.');
      return nextStack;
    });
  };

  // Active target clip IDs for editing 1 selected clip or multiple selected clips simultaneously
  const activeTargetClipIds = useMemo(() => {
    if (
      selectedClipIds.length > 1 &&
      (!selectedClipId || selectedClipIds.includes(selectedClipId))
    ) {
      return selectedClipIds;
    }
    if (selectedClipId) return [selectedClipId];
    if (selectedClipIds.length > 0) return selectedClipIds;
    return timelineClips[0]?.id ? [timelineClips[0].id] : [];
  }, [selectedClipIds, selectedClipId, timelineClips]);

  // Update Audio Volume, Fade In, Fade Out, or Mute across 1 selected clip, multiple selected clips, or all clips
  const handleUpdateClipsAudio = (
    patch: {
      foleyVolume?: number;
      audioFadeInSec?: number | undefined;
      audioFadeOutSec?: number | undefined;
      audioMuted?: boolean;
      customVolumeSet?: boolean;
    },
    applyToAllClips: boolean = false,
    explicitTargetIds?: string[]
  ) => {
    const targetIds =
      Array.isArray(explicitTargetIds) && explicitTargetIds.length > 0
        ? explicitTargetIds
        : activeTargetClipIds.length > 0
        ? activeTargetClipIds
        : selectedClip?.id
        ? [selectedClip.id]
        : activeClipAtPlayhead?.id
        ? [activeClipAtPlayhead.id]
        : [];
    const targetSet = new Set(targetIds);
    const singleSelectedClip =
      targetIds.length === 1
        ? timelineClips.find((tc) => tc.id === targetIds[0]) || selectedClip
        : selectedClip;
    const singleSelectedClipNum =
      targetIds.length <= 1 && singleSelectedClip && !singleSelectedClip.partLabel
        ? singleSelectedClip.clipNumber
        : null;
    const docId = activeDoc?.id || 'default';
    commitTimelineClipsUpdate(
      (prev) =>
        prev.map((c) => {
          const isMatched =
            applyToAllClips ||
            targetSet.has(c.id) ||
            (singleSelectedClipNum !== null &&
              c.clipNumber === singleSelectedClipNum &&
              !c.partLabel);
          if (!isMatched) return c;
          const next: TimelineClipItem = { ...c };
          if (typeof patch.foleyVolume === 'number') {
            next.foleyVolume = Math.max(0, Math.min(100, Math.round(patch.foleyVolume)));
            next.customVolumeSet = patch.customVolumeSet ?? true;
            next.audioMuted = next.foleyVolume <= 0;
          }
          if ('audioFadeInSec' in patch) {
            next.audioFadeInSec =
              typeof patch.audioFadeInSec === 'number'
                ? Math.max(0, Math.min(15, Number(patch.audioFadeInSec.toFixed(1))))
                : undefined;
          }
          if ('audioFadeOutSec' in patch) {
            next.audioFadeOutSec =
              typeof patch.audioFadeOutSec === 'number'
                ? Math.max(0, Math.min(15, Number(patch.audioFadeOutSec.toFixed(1))))
                : undefined;
          }
          if (typeof patch.audioMuted === 'boolean') {
            next.audioMuted = patch.audioMuted;
            next.customVolumeSet = patch.customVolumeSet ?? true;
            if (!patch.audioMuted && (next.foleyVolume ?? 0) <= 0) {
              next.foleyVolume =
                c.clipNumber === 0 || c.clipNumber === 999
                  ? 100
                  : c.clipNumber === 1
                  ? 80
                  : 20;
            }
          }
          if (typeof patch.customVolumeSet === 'boolean') {
            next.customVolumeSet = patch.customVolumeSet;
          }
          recordClipAudioEdit(next, docId);
          return next;
        }),
      false
    );
  };

  // Trigger server-side FFmpeg Optical Flow (minterpolate MCI) for a slowed/trimmed clip
  const triggerOpticalFlowForClip = async (clip: TimelineClipItem, silent = false) => {
    if (!clip || clip.clipNumber === 0 || clip.clipNumber === 999) return;
    if (clip.speed >= 0.99 || clip.smoothSlowMo === false) return;

    const safeTrimStart = Math.max(0, Number(clip.trimStart || 0));
    const safeTrimEnd =
      typeof clip.trimEnd === 'number' && clip.trimEnd > safeTrimStart + 0.05
        ? Number(clip.trimEnd)
        : Number(clip.sourceDuration || 8);
    const expectedKey = `t${safeTrimStart.toFixed(2)}_${safeTrimEnd.toFixed(2)}_d${Number(
      clip.duration || 8
    ).toFixed(2)}_of3`;

    if (clip.opticalFlowUrl && clip.opticalFlowBakedKey === expectedKey) {
      if (!silent) {
        setStatusMessage(
          `✅ Smooth Slow Motion (Optical Flow) ya está activo en el Clip ${String(
            clip.clipNumber
          ).padStart(2, '0')} (${clip.speed}x • ${clip.duration}s).`
        );
      }
      return;
    }

    setOpticalFlowProcessingByClipId((prev) => ({ ...prev, [clip.id]: true }));
    if (!silent) {
      setStatusMessage(
        `🌊 Generando Smooth Slow Motion (Optical Flow) para Clip ${String(
          clip.clipNumber
        ).padStart(2, '0')} (${clip.speed}x → ${clip.duration}s)...`
      );
    }

    try {
      const fPath = (downloadFolderPath || activeDoc?.downloadFolderPath || '').trim();
      const fName = (downloadFolderName || activeDoc?.downloadFolderName || '').trim();
      const dTitle = (activeDoc?.title || '').trim();
      const base = getEditorPrimaryServerOrigin();

      const resp = await fetch(`${base}/api/video/optical-flow`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          folderPath: fPath,
          folderName: fName,
          docTitle: dTitle,
          clipId: clip.id,
          clipNumber: clip.clipNumber,
          fileName: clip.fileName,
          videoUrl: clip.videoUrl || '',
          aspectRatio,
          trimStart: safeTrimStart,
          trimEnd: safeTrimEnd,
          speed: clip.speed,
          targetDuration: clip.duration,
          smoothSlowMo: true,
        }),
      });
      const data = await resp.json();
      if (resp.ok && data?.ok && data.opticalFlowUrl) {
        const finalUrl =
          data.opticalFlowUrl.startsWith('/') && base
            ? `${base}${data.opticalFlowUrl}`
            : data.opticalFlowUrl;
        commitTimelineClipsUpdate(
          (prev) =>
            prev.map((c) =>
              c.id === clip.id
                ? {
                    ...c,
                    opticalFlowUrl: finalUrl,
                    opticalFlowBakedKey: data.bakedKey || expectedKey,
                    smoothSlowMo: true,
                    ...(Number(data.actualSourceDuration) > 0.4
                      ? { sourceDuration: Number(data.actualSourceDuration) }
                      : {}),
                    ...(Number(data.trimEnd) > 0.4 ? { trimEnd: Number(data.trimEnd) } : {}),
                    ...(Number(data.speed) > 0.1
                      ? { speed: Number(Number(data.speed).toFixed(2)) }
                      : {}),
                  }
                : c
            ),
          false
        );
        if (!silent) {
          setStatusMessage(
            `✅ Smooth Slow Motion (Optical Flow) aplicado al Clip ${String(
              clip.clipNumber
            ).padStart(2, '0')} (${clip.speed}x • ${clip.duration}s).`
          );
        }
      } else if (!silent) {
        setStatusMessage(
          `⚠️ Optical Flow en visor activo (${clip.speed}x • ${clip.duration}s). ${
            data?.error || ''
          }`
        );
      }
    } catch {
      if (!silent) {
        setStatusMessage(
          `🌊 Smooth Slow Motion (${clip.speed}x • ${clip.duration}s) activo en la línea de tiempo.`
        );
      }
    } finally {
      setOpticalFlowProcessingByClipId((prev) => ({ ...prev, [clip.id]: false }));
    }
  };

  // Automatically upgrade any existing slow-mo clip whose Optical Flow cache was generated with an older key (_of1 / _of2) so it uses _of3 non-dragging natural foley
  useEffect(() => {
    const staleClip = timelineClips.find(
      (c) =>
        c.clipNumber > 0 &&
        c.clipNumber !== 999 &&
        c.speed < 0.99 &&
        c.smoothSlowMo !== false &&
        !opticalFlowProcessingByClipId[c.id] &&
        (!c.opticalFlowUrl || !String(c.opticalFlowBakedKey || '').endsWith('_of3'))
    );
    if (staleClip) {
      triggerOpticalFlowForClip(staleClip, true);
    }
  }, [timelineClips, activeDoc?.id]);

  const scheduleAutoOpticalFlow = (clip: TimelineClipItem) => {
    if (!clip || clip.clipNumber === 0 || clip.clipNumber === 999) return;
    if (opticalFlowDebounceTimerRef.current[clip.id]) {
      clearTimeout(opticalFlowDebounceTimerRef.current[clip.id]);
    }
    if (clip.speed < 0.99 && clip.smoothSlowMo !== false) {
      opticalFlowDebounceTimerRef.current[clip.id] = setTimeout(() => {
        triggerOpticalFlowForClip(clip, true);
      }, 750);
    }
  };

  // Bidirectional Speed (x, where 1x = normal) -> automatically updates Duration (s) & auto-enables Smooth Slow Motion when speed < 1.00x
  const handleUpdateClipSpeed = (clipId: string, rawSpeed: number) => {
    const newSpeed = Math.max(0.2, Math.min(4.0, Number(rawSpeed.toFixed(3))));
    let updatedClipForFlow: TimelineClipItem | null = null;
    commitTimelineClipsUpdate((prev) =>
      prev.map((c) => {
        if (c.id !== clipId) return c;
        const activeSpan = getClipActiveSourceSpan(c);
        const newDuration = Number(Math.max(0.5, activeSpan / newSpeed).toFixed(2));
        const autoSlowMo = newSpeed < 1.0 ? true : false;
        const updated: TimelineClipItem = {
          ...c,
          speed: Number(newSpeed.toFixed(2)),
          duration: newDuration,
          smoothSlowMo: autoSlowMo,
          opticalFlowUrl: undefined,
          opticalFlowBakedKey: undefined,
        };
        updatedClipForFlow = updated;
        return updated;
      })
    );
    if (updatedClipForFlow) {
      scheduleAutoOpticalFlow(updatedClipForFlow);
    }
  };

  // Bidirectional Duration (s) -> automatically updates Speed (x, where 1x = normal) & auto-enables Smooth Slow Motion when speed < 1.00x
  const handleUpdateClipDurationSeconds = (clipId: string, rawDurationSec: number) => {
    const newDuration = Math.max(0.5, Math.min(60, Number(rawDurationSec.toFixed(2))));
    let updatedClipForFlow: TimelineClipItem | null = null;
    commitTimelineClipsUpdate((prev) =>
      prev.map((c) => {
        if (c.id !== clipId) return c;
        const activeSpan = getClipActiveSourceSpan(c);
        const newSpeed = Number(Math.max(0.2, Math.min(4.0, activeSpan / newDuration)).toFixed(2));
        const autoSlowMo = newSpeed < 1.0 ? true : false;
        const updated: TimelineClipItem = {
          ...c,
          duration: newDuration,
          speed: newSpeed,
          smoothSlowMo: autoSlowMo,
          opticalFlowUrl: undefined,
          opticalFlowBakedKey: undefined,
        };
        updatedClipForFlow = updated;
        return updated;
      })
    );
    if (updatedClipForFlow) {
      scheduleAutoOpticalFlow(updatedClipForFlow);
    }
  };

  // Update Trim Start / Trim End on a clip (with automatic Smooth Slow Motion stretching when autoStretchOnTrim is enabled)
  const handleUpdateClipTrimBounds = (
    clipId: string,
    nextTrimStart: number,
    nextTrimEnd: number,
    stretchToOriginalSlot = autoStretchOnTrim
  ) => {
    let updatedClipForFlow: TimelineClipItem | null = null;
    commitTimelineClipsUpdate((prev) =>
      prev.map((c) => {
        if (c.id !== clipId) return c;
        const srcDur = c.sourceDuration && c.sourceDuration > 0.5 ? c.sourceDuration : 8;
        const safeStart = Math.max(0, Math.min(srcDur - 0.4, Number(nextTrimStart.toFixed(2))));
        const safeEnd = Math.max(
          safeStart + 0.4,
          Math.min(srcDur, Number(nextTrimEnd.toFixed(2)))
        );
        const activeSpan = Number((safeEnd - safeStart).toFixed(2));
        const targetDur = stretchToOriginalSlot
          ? Number((c.originalSlotDuration || c.duration || srcDur).toFixed(2))
          : Number((activeSpan / (c.speed || 1)).toFixed(2));
        const newSpeed = Number(Math.max(0.2, Math.min(4.0, activeSpan / targetDur)).toFixed(2));
        const autoSlowMo = newSpeed < 1.0 ? true : Boolean(c.smoothSlowMo);
        const updated: TimelineClipItem = {
          ...c,
          trimStart: safeStart,
          trimEnd: safeEnd,
          duration: targetDur,
          speed: newSpeed,
          smoothSlowMo: autoSlowMo,
          opticalFlowUrl: undefined,
          opticalFlowBakedKey: undefined,
        };
        updatedClipForFlow = updated;
        return updated;
      })
    );
    if (updatedClipForFlow) {
      scheduleAutoOpticalFlow(updatedClipForFlow);
    }
  };

  // Split (Cortar / Dividir ✂️) the clip at the current Playhead position (or midpoint if playhead is outside the clip) into Parte A & Parte B
  const handleSplitClipAtPlayhead = (targetClipId?: string) => {
    const targetBoundClip =
      (targetClipId
        ? clipsWithTimelineBounds.find((c) => c.id === targetClipId)
        : activeClipAtPlayhead) ||
      clipsWithTimelineBounds.find((c) => c.id === selectedClipId) ||
      null;

    if (!targetBoundClip) return;
    if (targetBoundClip.clipNumber === 0 || targetBoundClip.clipNumber === 999) {
      setStatusMessage('ℹ️ El Intro y el Outro oficiales son bloques fijos.');
      return;
    }
    if (targetBoundClip.duration < 0.8) {
      setStatusMessage('⚠️ Este fragmento ya es demasiado corto para dividirlo más.');
      return;
    }

    const liveT = currentTimeRef.current;
    const isPlayheadInside =
      liveT > targetBoundClip.start + 0.25 && liveT < targetBoundClip.end - 0.25;
    const splitTimelineSec = isPlayheadInside
      ? liveT
      : Number((targetBoundClip.start + targetBoundClip.duration / 2).toFixed(2));

    const durA = Number(Math.max(0.3, splitTimelineSec - targetBoundClip.start).toFixed(2));
    const durB = Number(Math.max(0.3, targetBoundClip.end - splitTimelineSec).toFixed(2));

    const curSpeed = Math.max(0.15, Math.min(4.0, targetBoundClip.speed || 1));
    const srcDur =
      targetBoundClip.sourceDuration && targetBoundClip.sourceDuration > 0.5
        ? targetBoundClip.sourceDuration
        : 8;
    const tStart = Math.max(0, targetBoundClip.trimStart || 0);
    const visibleMediaEnd =
      typeof targetBoundClip.trimEnd === 'number' &&
      targetBoundClip.trimEnd > tStart + 0.1 &&
      targetBoundClip.trimEnd < srcDur - 0.05
        ? targetBoundClip.trimEnd
        : Math.min(srcDur, Number((tStart + targetBoundClip.duration * curSpeed).toFixed(2)));

    // Split point in source video corresponds to durA * curSpeed from tStart
    const splitSourceSec = Number((tStart + durA * curSpeed).toFixed(2));
    const splitSourceEnd = Math.max(splitSourceSec + 0.3, visibleMediaEnd);

    const groupId =
      targetBoundClip.parentGroupId ||
      `clip-group-${targetBoundClip.clipNumber}-${targetBoundClip.id}`;
    const origSlotDur =
      targetBoundClip.originalSlotDuration || Number((durA + durB).toFixed(2));

    const stamp = Date.now();
    const partA: TimelineClipItem = {
      ...targetBoundClip,
      id: `${targetBoundClip.id}-partA-${stamp}`,
      duration: durA,
      trimStart: tStart,
      trimEnd: splitSourceSec,
      parentGroupId: groupId,
      originalSlotDuration: origSlotDur,
      partLabel: 'Parte A',
      opticalFlowUrl: undefined,
      opticalFlowBakedKey: undefined,
    };

    const partB: TimelineClipItem = {
      ...targetBoundClip,
      id: `${targetBoundClip.id}-partB-${stamp}`,
      duration: durB,
      trimStart: splitSourceSec,
      trimEnd: splitSourceEnd,
      parentGroupId: groupId,
      originalSlotDuration: origSlotDur,
      partLabel: 'Parte B',
      opticalFlowUrl: undefined,
      opticalFlowBakedKey: undefined,
    };

    commitTimelineClipsUpdate((prev) => {
      const idx = prev.findIndex((c) => c.id === targetBoundClip.id);
      if (idx === -1) return prev;
      const next = [...prev];
      next.splice(idx, 1, partA, partB);
      return next;
    });

    setSelectedClipId(partB.id);
    if (!isPlayheadInside) {
      seekToTime(splitTimelineSec);
    }
    setStatusMessage(
      `✂️ Clip ${String(targetBoundClip.clipNumber).padStart(
        2,
        '0'
      )} dividido en 2 partes (${durA}s y ${durB}s). Selecciona la parte que quieras borrar y pulsa 🗑️ Eliminar para que el resto se estire automáticamente con Smooth Slow Motion.`
    );
  };

  // One-click: Delete from clip Start up to Playhead & automatically stretch the remaining part with Smooth Slow Motion to cover the original seconds
  const handleCutFromStartToPlayhead = (targetClipId?: string) => {
    const targetBoundClip =
      (targetClipId
        ? clipsWithTimelineBounds.find((c) => c.id === targetClipId)
        : activeClipAtPlayhead) ||
      clipsWithTimelineBounds.find((c) => c.id === selectedClipId) ||
      null;
    if (!targetBoundClip || targetBoundClip.clipNumber === 0 || targetBoundClip.clipNumber === 999)
      return;

    const liveT = currentTimeRef.current;
    const isPlayheadInside =
      liveT > targetBoundClip.start + 0.25 && liveT < targetBoundClip.end - 0.25;
    if (!isPlayheadInside) {
      setStatusMessage(
        '⚠️ Coloca la aguja roja dentro del clip en el punto exacto hasta donde quieres cortar el inicio.'
      );
      return;
    }

    const elapsedOnTimeline = liveT - targetBoundClip.start;
    const curSpeed = Math.max(0.15, Math.min(4.0, targetBoundClip.speed || 1));
    const srcDur =
      targetBoundClip.sourceDuration && targetBoundClip.sourceDuration > 0.5
        ? targetBoundClip.sourceDuration
        : 8;
    const tStart = Math.max(0, targetBoundClip.trimStart || 0);

    // If trimEnd was explicitly set and strictly less than source video duration, use it;
    // otherwise the media that was displayed in this slot ended at tStart + targetBoundClip.duration * curSpeed
    const visibleMediaEnd =
      typeof targetBoundClip.trimEnd === 'number' &&
      targetBoundClip.trimEnd > tStart + 0.1 &&
      targetBoundClip.trimEnd < srcDur - 0.05
        ? targetBoundClip.trimEnd
        : Math.min(srcDur, Number((tStart + targetBoundClip.duration * curSpeed).toFixed(2)));

    // New start point in source media corresponding to the playhead position
    const newTrimStart = Number((tStart + elapsedOnTimeline * curSpeed).toFixed(2));
    const newTrimEnd = Math.max(newTrimStart + 0.35, visibleMediaEnd);
    const newActiveSpan = Number(Math.max(0.3, newTrimEnd - newTrimStart).toFixed(2));
    const { standardClipSec: stdDur } = getStage1ClipDurations(activeDoc);
    const isSlotPolluted = (d?: number) =>
      !d || d <= 0.5 || Math.abs(d - 5.58) < 0.08 || Math.abs(d - 5.66) < 0.05 || Math.abs(d - 10.45) < 0.05;
    const rawTargetDur =
      !isSlotPolluted(targetBoundClip.originalSlotDuration)
        ? targetBoundClip.originalSlotDuration!
        : !isSlotPolluted(targetBoundClip.duration)
        ? targetBoundClip.duration!
        : stdDur;
    const targetDur = Number(rawTargetDur.toFixed(2));
    // Speed required for the remaining media to cover the full target duration (always < 1.0 = Slow Motion!)
    const newSpeed = Number(Math.max(0.15, Math.min(4.0, newActiveSpan / targetDur)).toFixed(2));

    let updatedClipForFlow: TimelineClipItem | null = null;
    commitTimelineClipsUpdate((prev) =>
      prev.map((c) => {
        if (c.id !== targetBoundClip.id) return c;
        const updated: TimelineClipItem = {
          ...c,
          trimStart: newTrimStart,
          trimEnd: newTrimEnd,
          duration: targetDur,
          speed: newSpeed,
          smoothSlowMo: true,
          opticalFlowUrl: undefined,
          opticalFlowBakedKey: undefined,
        };
        updatedClipForFlow = updated;
        return updated;
      })
    );
    seekToTime(targetBoundClip.start);
    if (updatedClipForFlow) {
      scheduleAutoOpticalFlow(updatedClipForFlow);
    }
    setStatusMessage(
      `🌊 Inicio cortado (${tStart.toFixed(1)}s → ${newTrimStart.toFixed(
        1
      )}s): el resto del Clip ${String(targetBoundClip.clipNumber).padStart(
        2,
        '0'
      )} (${newActiveSpan}s) se estiró a ${targetDur}s (${newSpeed}x) con Smooth Slow Motion (Optical Flow).`
    );
  };

  // One-click: Delete from Playhead to clip End & automatically stretch the remaining first part with Smooth Slow Motion to cover the original seconds
  const handleCutFromPlayheadToEnd = (targetClipId?: string) => {
    const targetBoundClip =
      (targetClipId
        ? clipsWithTimelineBounds.find((c) => c.id === targetClipId)
        : activeClipAtPlayhead) ||
      clipsWithTimelineBounds.find((c) => c.id === selectedClipId) ||
      null;
    if (!targetBoundClip || targetBoundClip.clipNumber === 0 || targetBoundClip.clipNumber === 999)
      return;

    const liveT = currentTimeRef.current;
    const isPlayheadInside =
      liveT > targetBoundClip.start + 0.25 && liveT < targetBoundClip.end - 0.25;
    if (!isPlayheadInside) {
      setStatusMessage(
        '⚠️ Coloca la aguja roja dentro del clip en el punto exacto desde donde quieres borrar hasta el final.'
      );
      return;
    }

    const elapsedOnTimeline = liveT - targetBoundClip.start;
    const curSpeed = Math.max(0.15, Math.min(4.0, targetBoundClip.speed || 1));
    const srcDur =
      targetBoundClip.sourceDuration && targetBoundClip.sourceDuration > 0.5
        ? targetBoundClip.sourceDuration
        : 8;
    const tStart = Math.max(0, targetBoundClip.trimStart || 0);

    // Keep the first part of the media from tStart up to the playhead
    const newTrimStart = tStart;
    const newTrimEnd = Number(Math.min(srcDur, tStart + elapsedOnTimeline * curSpeed).toFixed(2));
    const newActiveSpan = Number(Math.max(0.3, newTrimEnd - newTrimStart).toFixed(2));
    const { standardClipSec: stdDur } = getStage1ClipDurations(activeDoc);
    const isSlotPolluted = (d?: number) =>
      !d || d <= 0.5 || Math.abs(d - 5.58) < 0.08 || Math.abs(d - 5.66) < 0.05 || Math.abs(d - 10.45) < 0.05;
    const rawTargetDur =
      !isSlotPolluted(targetBoundClip.originalSlotDuration)
        ? targetBoundClip.originalSlotDuration!
        : !isSlotPolluted(targetBoundClip.duration)
        ? targetBoundClip.duration!
        : stdDur;
    const targetDur = Number(rawTargetDur.toFixed(2));
    const newSpeed = Number(Math.max(0.15, Math.min(4.0, newActiveSpan / targetDur)).toFixed(2));

    let updatedClipForFlow: TimelineClipItem | null = null;
    commitTimelineClipsUpdate((prev) =>
      prev.map((c) => {
        if (c.id !== targetBoundClip.id) return c;
        const updated: TimelineClipItem = {
          ...c,
          trimStart: newTrimStart,
          trimEnd: newTrimEnd,
          duration: targetDur,
          speed: newSpeed,
          smoothSlowMo: true,
          opticalFlowUrl: undefined,
          opticalFlowBakedKey: undefined,
        };
        updatedClipForFlow = updated;
        return updated;
      })
    );
    seekToTime(targetBoundClip.start);
    if (updatedClipForFlow) {
      scheduleAutoOpticalFlow(updatedClipForFlow);
    }
    setStatusMessage(
      `🌊 Final cortado (${newTrimEnd.toFixed(1)}s → ${((targetBoundClip.trimEnd || srcDur)).toFixed(
        1
      )}s): el resto del Clip ${String(targetBoundClip.clipNumber).padStart(
        2,
        '0'
      )} (${newActiveSpan}s) se estiró a ${targetDur}s (${newSpeed}x) con Smooth Slow Motion (Optical Flow).`
    );
  };

  // Delete a clip piece (and automatically stretch the remaining part of that same clip with Smooth Slow Motion to cover its original seconds!) or delete the whole clip
  const handleDeleteClipOrStretchSibling = (clipId: string, forceDeleteWholeClip = false) => {
    const targetClip = timelineClips.find((c) => c.id === clipId);
    if (!targetClip) return;
    if (targetClip.clipNumber === 0 || targetClip.clipNumber === 999) {
      setStatusMessage('ℹ️ El Intro y el Outro oficiales no se pueden eliminar.');
      return;
    }

    const siblings = timelineClips.filter(
      (c) =>
        c.id !== clipId &&
        ((targetClip.parentGroupId && c.parentGroupId === targetClip.parentGroupId) ||
          c.clipNumber === targetClip.clipNumber)
    );

    if (!forceDeleteWholeClip && siblings.length > 0) {
      const siblingIds = new Set(siblings.map((s) => s.id));
      const totalSiblingsDur = siblings.reduce((acc, s) => acc + s.duration, 0);
      let primaryUpdatedSibling: TimelineClipItem | null = null;

      commitTimelineClipsUpdate((prev) => {
        const filtered = prev.filter((c) => c.id !== clipId);
        return filtered.map((c) => {
          if (!siblingIds.has(c.id)) return c;
          const shareRatio =
            totalSiblingsDur > 0 ? c.duration / totalSiblingsDur : 1 / siblings.length;
          const newDur =
            siblings.length === 1 && (c.originalSlotDuration || targetClip.originalSlotDuration)
              ? Number((c.originalSlotDuration || targetClip.originalSlotDuration || c.duration + targetClip.duration).toFixed(2))
              : Number((c.duration + targetClip.duration * shareRatio).toFixed(2));
          const activeSpan = getClipActiveSourceSpan(c);
          const newSpeed = Number(Math.max(0.2, Math.min(4.0, activeSpan / newDur)).toFixed(2));
          const updated: TimelineClipItem = {
            ...c,
            duration: newDur,
            speed: newSpeed,
            smoothSlowMo: newSpeed < 1.0 ? true : Boolean(c.smoothSlowMo),
            partLabel: siblings.length === 1 ? undefined : c.partLabel,
            opticalFlowUrl: undefined,
            opticalFlowBakedKey: undefined,
          };
          primaryUpdatedSibling = updated;
          return updated;
        });
      });

      if (primaryUpdatedSibling) {
        const chosen = primaryUpdatedSibling as TimelineClipItem;
        setSelectedClipId(chosen.id);
        scheduleAutoOpticalFlow(chosen);
        setStatusMessage(
          `🌊 Fragmento eliminado: el resto del Clip ${String(targetClip.clipNumber).padStart(
            2,
            '0'
          )} se estiró automáticamente a ${chosen.duration}s (${
            chosen.speed
          }x) con Smooth Slow Motion (Optical Flow).`
        );
      }
      return;
    }

    // Delete the entire clip (or all parts of this clip if forceDeleteWholeClip)
    const idx = timelineClips.findIndex((c) => c.id === clipId);
    const nextFallbackClip =
      timelineClips[idx + 1] || timelineClips[idx - 1] || timelineClips[0] || null;
    commitTimelineClipsUpdate((prev) =>
      forceDeleteWholeClip && targetClip.parentGroupId
        ? prev.filter((c) => c.parentGroupId !== targetClip.parentGroupId && c.id !== clipId)
        : prev.filter((c) => c.id !== clipId)
    );
    if (nextFallbackClip) {
      setSelectedClipId(nextFallbackClip.id);
    }
    setStatusMessage(
      `🗑️ Clip ${String(targetClip.clipNumber).padStart(
        2,
        '0'
      )} eliminado de la línea de tiempo. (Puedes pulsar "↩️ Deshacer" para restaurarlo).`
    );
  };

  // Restore a cut/slowed clip back to its full 1.0x un-trimmed original state
  const handleResetClipToOriginal = (clipId: string) => {
    const targetClip = timelineClips.find((c) => c.id === clipId);
    if (!targetClip) return;
    const srcDur =
      targetClip.sourceDuration && targetClip.sourceDuration > 0.5
        ? targetClip.sourceDuration
        : 8;
    const { standardClipSec: stdDur } = getStage1ClipDurations(activeDoc);
    const isSlotPolluted =
      !targetClip.originalSlotDuration ||
      targetClip.originalSlotDuration <= 0.5 ||
      targetClip.originalSlotDuration === 5.65 ||
      Math.abs(targetClip.originalSlotDuration - 5.58) < 0.08 ||
      Math.abs(targetClip.originalSlotDuration - 5.66) < 0.05 ||
      Math.abs(targetClip.originalSlotDuration - 10.45) < 0.05;
    const origDur = isSlotPolluted ? stdDur : targetClip.originalSlotDuration;
    const restored: TimelineClipItem = {
      ...targetClip,
      id: `tl-clip-${targetClip.clipNumber}`,
      trimStart: 0,
      trimEnd: srcDur,
      duration: origDur,
      speed: 1,
      smoothSlowMo: false,
      opticalFlowUrl: undefined,
      opticalFlowBakedKey: undefined,
      parentGroupId: undefined,
      partLabel: undefined,
    };

    commitTimelineClipsUpdate((prev) => {
      const result: TimelineClipItem[] = [];
      let inserted = false;
      for (const c of prev) {
        const isSameGroup =
          c.id === clipId ||
          (targetClip.parentGroupId && c.parentGroupId === targetClip.parentGroupId) ||
          c.clipNumber === targetClip.clipNumber;
        if (isSameGroup) {
          if (!inserted) {
            result.push(restored);
            inserted = true;
          }
        } else {
          result.push(c);
        }
      }
      return result;
    });
    setSelectedClipId(restored.id);
    setStatusMessage(
      `🔄 Clip ${String(targetClip.clipNumber).padStart(
        2,
        '0'
      )} restaurado completo sin cortes (${origDur}s • 1.00x).`
    );
  };

  // Drag & Drop Reordering of Clips on Track 3
  const handleMoveClipOrder = (fromIdx: number, toIdx: number) => {
    if (fromIdx < 0 || toIdx < 0 || fromIdx >= timelineClips.length || toIdx >= timelineClips.length)
      return;
    if (fromIdx === toIdx) return;
    commitTimelineClipsUpdate((prev) => {
      const copy = [...prev];
      const [moved] = copy.splice(fromIdx, 1);
      copy.splice(toIdx, 0, moved);
      return copy;
    });
  };

  // Slow down Clip 1 automatically so a 4s or 6s clip covers 8s smoothly
  const handleAutoSlowClip1 = (targetSeconds: number = 8) => {
    if (timelineClips.length === 0) return;
    const copy = [...timelineClips];
    const c1 = copy[0];
    const srcDur = c1.sourceDuration || 6;
    const calculatedSpeed = Number((srcDur / targetSeconds).toFixed(2));
    copy[0] = {
      ...c1,
      duration: targetSeconds,
      speed: calculatedSpeed,
      smoothSlowMo: calculatedSpeed < 1,
      foleyVolume: 80,
    };
    setTimelineClips(copy);
    setClip1OverlayEndSec(targetSeconds);
    setVoiceStartOffsetSec(targetSeconds);
    setStatusMessage(
      `🐢 Clip 1 ralentizado automáticamente a ${calculatedSpeed}x para cubrir los primeros ${targetSeconds}s antes de que entre la Voz Narrativa.`
    );
  };

  // Batch Import MP4 Files from User's Folder into Track 3
  const handleImportMp4FilesToTimeline = (files: FileList | null) => {
    if (!files || files.length === 0) return;
    const fileArr = Array.from(files).filter((f) => f.type.startsWith('video/') || f.name.endsWith('.mp4'));
    if (fileArr.length === 0) return;

    const updated = [...timelineClips];
    fileArr.forEach((file) => {
      const blobUrl = URL.createObjectURL(file);
      const numMatch = file.name.match(/^0*(\d{1,3})\b/) || file.name.match(/Clip[_-\s]*0*(\d{1,3})\b/i);
      const matchedNum = numMatch ? parseInt(numMatch[1], 10) : null;

      const existingIdx = matchedNum
        ? updated.findIndex((c) => c.clipNumber === matchedNum)
        : -1;

      if (existingIdx !== -1) {
        updated[existingIdx] = {
          ...updated[existingIdx],
          videoUrl: blobUrl,
          fileName: file.name,
        };
      } else {
        const nextNum = updated.length + 1;
        updated.push({
          id: `imported-clip-${nextNum}-${Date.now()}`,
          clipNumber: matchedNum || nextNum,
          fileName: file.name,
          narrationSegment: '',
          duration: activeDoc?.clipDurationMode === '8_SEGUNDOS' ? 8 : 10,
          sourceDuration: activeDoc?.clipDurationMode === '8_SEGUNDOS' ? 8 : 10,
          speed: 1,
          trimStart: 0,
          foleyVolume: 40,
          transition: defaultTransition,
          videoUrl: blobUrl,
        });
      }
    });

    setTimelineClips(updated);
    setStatusMessage(`🎬 ${fileArr.length} archivo(s) .MP4 cargados y ordenados en la Pista 3.`);
  };

  // Apply transition to all clips
  const handleApplyTransitionToAll = (trans: ClipTransitionType) => {
    setDefaultTransition(trans);
    setTimelineClips((prev) => prev.map((c) => ({ ...c, transition: trans })));
    setStatusMessage(
      `✨ Transición "${TRANSITION_OPTIONS.find((t) => t.value === trans)?.label}" aplicada a todos los clips.`
    );
  };

  // Render & Download Final Master Video in HD / 2K / 4K / 8K and 16:9 or 9:16 (Single Unified Action)
  const handleCancelExport = async () => {
    if (!isRenderingVideo || isCancellingRender) return;
    const sure = window.confirm(
      '¿Seguro que quieres cancelar la exportación?\n\nSe perderá todo el progreso y tendrás que exportar de nuevo desde el principio.'
    );
    if (!sure) return;
    setIsCancellingRender(true);
    setRenderStageLabel('Cancelando exportación...');
    try {
      const resp = await fetch(`${getEditorPrimaryServerOrigin()}/api/editor/render-cancel`, { method: 'POST' });
      const data = await resp.json().catch(() => null);
      if (!resp.ok || !data?.ok) {
        throw new Error(data?.error || `HTTP ${resp.status}`);
      }
      if (!data.wasRunning) {
        // Nothing was running on the server any more.
        setIsRenderingVideo(false);
        setIsCancellingRender(false);
      }
    } catch (cancelErr: any) {
      setIsCancellingRender(false);
      setStatusMessage(`⚠️ No se pudo cancelar la exportación: ${cancelErr?.message || cancelErr}`);
    }
  };

  const handleExportMasterVideo = async () => {
    // Ask once (needs a user gesture) for permission to show the "8K export stopped" browser notification.
    try {
      if (typeof Notification !== 'undefined' && Notification.permission === 'default') {
        void Notification.requestPermission();
      }
    } catch {}
    // Clips still being upscaled would go into the export at their original (lower) quality
    const pendingInTimeline = Array.from(
      new Set(
        clipsWithTimelineBounds
          .filter((c) => c.clipNumber > 0 && c.clipNumber !== 999 && pending4kClipNums.includes(c.clipNumber))
          .map((c) => c.clipNumber)
      )
    ).sort((a, b) => a - b);
    if (pendingInTimeline.length > 0) {
      const proceed = window.confirm(
        `⚠️ ${pendingInTimeline.length} clip(s) del timeline todavía se están mejorando a 4K: ${pendingInTimeline.join(', ')}.\n\n` +
          'Si exportas ahora entrarán con su calidad original (1080p). Lo recomendable es esperar a que terminen.\n\n' +
          '¿Exportar de todos modos?'
      );
      if (!proceed) return;
    }
    const reviewedBodyInTimeline = clipsWithTimelineBounds.filter(
      (c) =>
        c.id !== 'fixed-doc-intro' &&
        c.clipNumber !== 0 &&
        c.id !== 'fixed-doc-outro' &&
        c.clipNumber !== 999
    );
    if (reviewedBodyInTimeline.length === 0) {
      const emptyMsg =
        '🔒 No hay clips revisados en el Timeline para exportar. Marca al menos un clip como "✅ Revisado" en la Etapa 6 antes de renderizar.';
      setStatusMessage(emptyMsg);
      alert(emptyMsg);
      return;
    }

    // 1. Mandatory Global Official Logo Check before rendering/downloading
    if (!officialLogoUrl || !officialLogoUrl.trim()) {
      setActiveInspectorTab('branding');
      alert(
        '🔒 Obligatorio: Primero debes subir el Logo Oficial de "Huellas de la Humanidad" (es el mismo para todos los documentales) en la pestaña "Logo y Textos" o en la Etapa 5 antes de renderizar y descargar el video.'
      );
      return;
    }

    const preset = RESOLUTION_PRESETS[exportResolution];
    const width = aspectRatio === '16:9' ? preset.width16x9 : preset.width9x16;
    const height = aspectRatio === '16:9' ? preset.height16x9 : preset.height9x16;

    // 2. Ask user where to save first if no folder is selected yet
    const effectiveFolderPath = downloadFolderPath || activeDoc?.downloadFolderPath || '';
    const effectiveFolderName = downloadFolderName || activeDoc?.downloadFolderName || '';
    if (!effectiveFolderName && !effectiveFolderPath) {
      const picked = await onPickDownloadFolder();
      if (!picked) {
        alert(
          '📂 Primero selecciona la carpeta donde deseas guardar el video final descargado.'
        );
        return;
      }
    }

    const totalSegs = Math.max(1, clipsWithTimelineBounds.length);
    const baseSecPerSeg =
      exportResolution === '8K_4320P'
        ? 4.2
        : exportResolution === '4K_2160P'
        ? 2.2
        : exportResolution === '2K_1440P'
        ? 1.5
        : 1.0;
    const fpsFactor = exportFps === 60 ? 1.45 : exportFps === 24 ? 0.9 : 1.0;
    const initialEtaSec = Math.max(15, Math.round(totalSegs * baseSecPerSeg * fpsFactor + 12));
    const localStartMs = Date.now();

    setIsRenderingVideo(true);
    setRenderProgressPct(2);
    setRenderStartedAtMs(localStartMs);
    setRenderElapsedSec(0);
    setRenderRemainingSec(initialEtaSec);
    setRenderStepInfo({ current: 0, total: totalSegs });
    setLastExportedOutputPath('');
    setRenderStageLabel(
      `Preparando capas visuales (Logo, Gancho y Subtítulos) en ${preset.badge} • ${exportFps} FPS • ${exportBitrateMbps} Mbps...`
    );
    setStatusMessage(
      `🎬 Renderizando y preparando descarga del video en ${preset.badge} (${width}×${height}, ${exportFps} FPS, ${exportBitrateMbps} Mbps)...`
    );

    try {
      // Load permanent official logo image if available
      let logoImg: HTMLImageElement | null = null;
      if (officialLogoUrl) {
        logoImg = await new Promise<HTMLImageElement | null>((resolve) => {
          const img = new Image();
          img.crossOrigin = 'anonymous';
          img.onload = () => resolve(img);
          img.onerror = () => resolve(null);
          img.src = officialLogoUrl;
        });
      }

      // Helper to word-wrap text identically to the 520p canonical WYSIWYG visor stage
      const wrapOverlayTextLines = (
        context: CanvasRenderingContext2D,
        rawText: string,
        maxLineWidth: number
      ): string[] => {
        const paragraphs = String(rawText || '').split('\n');
        const wrapped: string[] = [];
        for (const para of paragraphs) {
          const words = para.trim().split(/\s+/).filter(Boolean);
          if (words.length === 0) {
            wrapped.push('');
            continue;
          }
          let currentLine = words[0];
          for (let wi = 1; wi < words.length; wi++) {
            const candidate = `${currentLine} ${words[wi]}`;
            if (context.measureText(candidate).width <= maxLineWidth) {
              currentLine = candidate;
            } else {
              wrapped.push(currentLine);
              currentLine = words[wi];
            }
          }
          wrapped.push(currentLine);
        }
        // Anti-orphan guard for 16:9: never leave a single word alone on any line
        if (aspectRatio === '16:9' && wrapped.length >= 2) {
          for (let i = wrapped.length - 1; i >= 1; i--) {
            const lineWords = wrapped[i].trim().split(/\s+/).filter(Boolean);
            if (lineWords.length === 1) {
              const prevLineWords = wrapped[i - 1].trim().split(/\s+/).filter(Boolean);
              if (prevLineWords.length >= 3) {
                const shifted = prevLineWords.pop()!;
                wrapped[i - 1] = prevLineWords.join(' ');
                wrapped[i] = `${shifted} ${wrapped[i]}`;
              } else if (prevLineWords.length === 2) {
                const candidateCombined = `${wrapped[i - 1]} ${wrapped[i]}`;
                if (context.measureText(candidateCombined).width <= maxLineWidth * 1.08) {
                  wrapped[i - 1] = candidateCombined;
                  wrapped.splice(i, 1);
                }
              }
            }
          }
        }
        return wrapped;
      };

      // 3. Try Ultra-Fast Native FFmpeg Render first if activeDoc is available
      if (activeDoc) {
        let pollTimer: number | null = null;
        let secTimer: number | null = null;
        try {
          // A) Generate Logo PNG with opacity baked in
          let logoPngDataUrl = '';
          if (burnInLogo && logoImg) {
            // Keep the logo's real aspect ratio when capping the prebake width at 800 px (previously the height
            // was not scaled down, which stretched wide logos vertically in the exported video)
            const natW = logoImg.naturalWidth || logoImg.width || 300;
            const natH = logoImg.naturalHeight || logoImg.height || 300;
            const lw = Math.max(64, Math.min(800, natW));
            const lh = Math.max(1, Math.round((natH / natW) * lw));
            const lCanvas = document.createElement('canvas');
            lCanvas.width = lw;
            lCanvas.height = lh;
            const lCtx = lCanvas.getContext('2d');
            if (lCtx) {
              lCtx.globalAlpha = Math.max(0.05, Math.min(1, logoOpacity / 100));
              lCtx.drawImage(logoImg, 0, 0, lw, lh);
              logoPngDataUrl = lCanvas.toDataURL('image/png');
            }
          }

          // B) Generate Hook Text transparent overlay PNGs (Line 1 phase & Line 1+2 phase)
          const refW = aspectRatio === '16:9' ? 1920 : 1080;
          const refH = aspectRatio === '16:9' ? 1080 : 1920;
          const refScaleRatio = refH / 520;
          const hookSegmentsPayload: Array<{
            pngDataUrl: string;
            startSec: number;
            endSec: number;
            yPct: number;
            hPct: number;
          }> = [];

          const renderHookOverlayFrame = (showLine1: boolean, showLine2: boolean): string => {
            const hCanvas = document.createElement('canvas');
            hCanvas.width = refW;
            hCanvas.height = refH;
            const hCtx = hCanvas.getContext('2d');
            if (!hCtx) return '';

            hCtx.textAlign = 'center';
            const f1 = Math.round(hookLine1FontSize * refScaleRatio);
            const f2 = Math.round(hookLine2FontSize * refScaleRatio);
            const xCenter = Math.round(refW * (hookLeftPct / 100));
            const yCenter = Math.round(refH * (hookTopPct / 100));
            const boxW = Math.round(refW * (hookBoxWidthPct / 100));
            const maxHookTextWidth = Math.max(80, boxW - Math.round(40 * refScaleRatio));

            hCtx.font = `700 ${f1}px ${hookFontFamily}`;
            if ('letterSpacing' in hCtx) {
              (hCtx as any).letterSpacing = `${(f1 * 0.1).toFixed(2)}px`;
            }
            const line1Rows =
              showLine1 && clip1Line1
                ? wrapOverlayTextLines(hCtx, clip1Line1.toUpperCase(), maxHookTextWidth)
                : [];

            hCtx.font = `900 ${f2}px ${hookFontFamily}`;
            if ('letterSpacing' in hCtx) {
              (hCtx as any).letterSpacing = `${(f2 * 0.025).toFixed(2)}px`;
            }
            const line2Rows =
              showLine2 && clip1Line2
                ? wrapOverlayTextLines(hCtx, clip1Line2.toUpperCase(), maxHookTextWidth)
                : [];
            if ('letterSpacing' in hCtx) {
              (hCtx as any).letterSpacing = '0px';
            }

            const line1RowH = Math.round(f1 * 1.375);
            const line2RowH = Math.round(f2 * 1.375);
            const interBlockGap =
              line1Rows.length > 0 && line2Rows.length > 0 ? Math.round(6 * refScaleRatio) : 0;
            const totalH1 = line1Rows.length * line1RowH;
            const totalH2 = line2Rows.length * line2RowH;
            const totalContentH = totalH1 + interBlockGap + totalH2;

            if (
              (hookBgStyle === 'semi' || hookBgStyle === 'solid') &&
              (line1Rows.length > 0 || line2Rows.length > 0)
            ) {
              hCtx.save();
              hCtx.fillStyle = hexToRgba(
                hookBgColor,
                hookBgStyle === 'solid' ? 95 : hookBgOpacity
              );
              const padBox = Math.round(10 * refScaleRatio);
              const boxH = Math.round(totalContentH + padBox * 2);
              hCtx.beginPath();
              hCtx.roundRect(
                Math.round(xCenter - boxW / 2),
                Math.round(yCenter - boxH / 2),
                boxW,
                boxH,
                Math.round(12 * refScaleRatio)
              );
              hCtx.fill();
              hCtx.restore();
            }

            let cursorY = Math.round(yCenter - totalContentH / 2 + f1 * 0.85);
            if (line1Rows.length > 0) {
              hCtx.save();
              hCtx.font = `700 ${f1}px ${hookFontFamily}`;
              if ('letterSpacing' in hCtx) {
                (hCtx as any).letterSpacing = `${(f1 * 0.1).toFixed(2)}px`;
              }
              let rowY1 = cursorY;
              for (const rowText of line1Rows) {
                if (hookBgStyle === 'word_shadow' && rowText.trim()) {
                  hCtx.save();
                  const m1 = hCtx.measureText(rowText);
                  const padX1 = Math.round(10 * refScaleRatio);
                  const padY1 = Math.round(2 * refScaleRatio);
                  const w1 = Math.min(boxW, m1.width + padX1 * 2);
                  const h1 = Math.round(f1 * 1.22) + padY1 * 2;
                  hCtx.fillStyle = hexToRgba(hookBgColor, hookBgOpacity);
                  hCtx.shadowColor = hexToRgba(hookBgColor, Math.round(hookBgOpacity * 0.85));
                  hCtx.shadowBlur = Math.round(12 * refScaleRatio);
                  hCtx.beginPath();
                  hCtx.roundRect(
                    Math.round(xCenter - w1 / 2),
                    Math.round(rowY1 - f1 * 0.88 - padY1),
                    Math.round(w1),
                    Math.round(h1),
                    Math.round(6 * refScaleRatio)
                  );
                  hCtx.fill();
                  hCtx.restore();
                }
                if (hookShadowStyle !== 'none') {
                  hCtx.shadowColor =
                    hookShadowStyle === 'gold_glow' ? 'rgba(245,158,11,0.85)' : 'rgba(0,0,0,0.95)';
                  hCtx.shadowBlur = (hookShadowStyle === 'soft' ? 8 : 18) * refScaleRatio;
                  hCtx.shadowOffsetY = 3 * refScaleRatio;
                }
                if (hookShadowStyle === 'outline') {
                  hCtx.lineWidth = Math.max(3, Math.round(f1 * 0.16));
                  hCtx.strokeStyle = '#000000';
                  hCtx.strokeText(rowText, xCenter, rowY1);
                }
                hCtx.fillStyle = hookLine1Color;
                hCtx.fillText(rowText, xCenter, rowY1);
                rowY1 += line1RowH;
              }
              hCtx.restore();
              cursorY += totalH1 + interBlockGap + Math.round((f2 - f1) * 0.85);
            }
            if (line2Rows.length > 0) {
              if (line1Rows.length === 0) {
                cursorY = Math.round(yCenter - totalH2 / 2 + f2 * 0.85);
              }
              hCtx.save();
              hCtx.font = `900 ${f2}px ${hookFontFamily}`;
              if ('letterSpacing' in hCtx) {
                (hCtx as any).letterSpacing = `${(f2 * 0.025).toFixed(2)}px`;
              }
              for (const rowText of line2Rows) {
                if (hookBgStyle === 'word_shadow' && rowText.trim()) {
                  hCtx.save();
                  const m2 = hCtx.measureText(rowText);
                  const padX2 = Math.round(10 * refScaleRatio);
                  const padY2 = Math.round(2 * refScaleRatio);
                  const w2 = Math.min(boxW, m2.width + padX2 * 2);
                  const h2 = Math.round(f2 * 1.22) + padY2 * 2;
                  hCtx.fillStyle = hexToRgba(hookBgColor, hookBgOpacity);
                  hCtx.shadowColor = hexToRgba(hookBgColor, Math.round(hookBgOpacity * 0.85));
                  hCtx.shadowBlur = Math.round(14 * refScaleRatio);
                  hCtx.beginPath();
                  hCtx.roundRect(
                    Math.round(xCenter - w2 / 2),
                    Math.round(cursorY - f2 * 0.88 - padY2),
                    Math.round(w2),
                    Math.round(h2),
                    Math.round(6 * refScaleRatio)
                  );
                  hCtx.fill();
                  hCtx.restore();
                }
                if (hookShadowStyle !== 'none') {
                  hCtx.shadowColor =
                    hookShadowStyle === 'gold_glow' ? 'rgba(245,158,11,0.85)' : 'rgba(0,0,0,0.95)';
                  hCtx.shadowBlur = (hookShadowStyle === 'soft' ? 8 : 18) * refScaleRatio;
                  hCtx.shadowOffsetY = 3 * refScaleRatio;
                }
                if (hookShadowStyle === 'outline') {
                  hCtx.lineWidth = Math.max(4, Math.round(f2 * 0.16));
                  hCtx.strokeStyle = '#000000';
                  hCtx.strokeText(rowText, xCenter, cursorY);
                }
                hCtx.fillStyle = hookLine2Color;
                hCtx.fillText(rowText, xCenter, cursorY);
                cursorY += line2RowH;
              }
              hCtx.restore();
            }

            return hCanvas.toDataURL('image/png');
          };

          if (burnInHook && (clip1Line1 || clip1Line2)) {
            const s1 = Math.max(0, Number(hookLine1StartSec || 8));
            const s2 = Math.max(s1, Number(hookLine2StartSec || 10));
            const endHook = Math.max(s2 + 0.5, Number(clip1OverlayEndSec || 16));
            if (clip1Line1 && s2 > s1 + 0.05) {
              const png1 = renderHookOverlayFrame(true, false);
              if (png1) {
                hookSegmentsPayload.push({
                  pngDataUrl: png1,
                  startSec: s1,
                  endSec: Math.min(s2, endHook),
                  yPct: 0,
                  hPct: 100,
                });
              }
            }
            if (endHook > s2 + 0.05) {
              const png12 = renderHookOverlayFrame(Boolean(clip1Line1), Boolean(clip1Line2));
              if (png12) {
                hookSegmentsPayload.push({
                  pngDataUrl: png12,
                  startSec: s2,
                  endSec: endHook,
                  yPct: 0,
                  hPct: 100,
                });
              }
            }
          }

          // C) Generate Burned-In Subtitle strips (cropped to bottom caption band for ultra-fast encoding)
          const captionSegmentsPayload: Array<{
            pngDataUrl: string;
            startSec: number;
            endSec: number;
            yPct: number;
            hPct: number;
          }> = [];

          if (burnInCaptions && captions.length > 0 && captions.length <= 40) {
            const stripH = Math.round(refH * 0.24);
            const yBottomRef = Math.round(refH * (1 - captionBottomPct / 100));
            const stripTopPx = Math.max(
              0,
              Math.min(refH - stripH, yBottomRef - Math.round(stripH * 0.82))
            );
            const stripYPct = Number(((stripTopPx / refH) * 100).toFixed(3));
            const stripHPct = Number(((stripH / refH) * 100).toFixed(3));

            const cCanvas = document.createElement('canvas');
            cCanvas.width = refW;
            cCanvas.height = stripH;
            const cCtx = cCanvas.getContext('2d');

            if (cCtx) {
              const effectiveCapPx = Math.max(13, captionFontSize * 0.76);
              const capFontPx = Math.round(effectiveCapPx * refScaleRatio);
              const capLineH = Math.round(capFontPx * 1.35);
              const maxCapTextW = Math.max(100, refW - Math.round(52 * refScaleRatio));

              for (const cap of captions) {
                if (!cap.text || !cap.text.trim() || cap.end <= cap.start + 0.04) continue;
                cCtx.clearRect(0, 0, refW, stripH);
                cCtx.save();
                cCtx.translate(0, -stripTopPx);
                cCtx.font = `800 ${capFontPx}px ${captionFontFamily}`;
                cCtx.textAlign = 'center';

                const capRows = wrapOverlayTextLines(
                  cCtx,
                  formatCaptionTextCase(cap.text),
                  maxCapTextW
                );

                if (captionBgStyle === 'semi' || captionBgStyle === 'solid') {
                  let maxRowW = 0;
                  for (const r of capRows) {
                    maxRowW = Math.max(maxRowW, cCtx.measureText(r).width);
                  }
                  const padX = Math.round(14 * refScaleRatio);
                  const padY = Math.round(4 * refScaleRatio);
                  const boxW = Math.min(refW - Math.round(32 * refScaleRatio), maxRowW + padX * 2);
                  const boxH = capRows.length * capLineH + padY * 2;
                  cCtx.fillStyle = hexToRgba(
                    captionBgColor,
                    captionBgStyle === 'solid' ? 95 : captionBgOpacity
                  );
                  cCtx.beginPath();
                  cCtx.roundRect(
                    Math.round((refW - boxW) / 2),
                    Math.round(yBottomRef - boxH),
                    Math.round(boxW),
                    Math.round(boxH),
                    Math.round(8 * refScaleRatio)
                  );
                  cCtx.fill();
                }

                for (let ri = 0; ri < capRows.length; ri++) {
                  const rowText = capRows[ri];
                  const rowY =
                    yBottomRef -
                    (capRows.length - 1 - ri) * capLineH -
                    Math.round(capFontPx * 0.28);

                  if (captionBgStyle === 'word_shadow' && rowText.trim()) {
                    cCtx.save();
                    const mCap = cCtx.measureText(rowText);
                    const padX = Math.round(10 * refScaleRatio);
                    const padY = Math.round(2 * refScaleRatio);
                    const wCap = Math.min(
                      refW - Math.round(32 * refScaleRatio),
                      mCap.width + padX * 2
                    );
                    const hCap = Math.round(capFontPx * 1.22) + padY * 2;
                    cCtx.fillStyle = hexToRgba(captionBgColor, captionBgOpacity);
                    cCtx.shadowColor = hexToRgba(captionBgColor, Math.round(captionBgOpacity * 0.85));
                    cCtx.shadowBlur = Math.round(12 * refScaleRatio);
                    cCtx.beginPath();
                    cCtx.roundRect(
                      Math.round((refW - wCap) / 2),
                      Math.round(rowY - capFontPx * 0.88 - padY),
                      Math.round(wCap),
                      Math.round(hCap),
                      Math.round(6 * refScaleRatio)
                    );
                    cCtx.fill();
                    cCtx.restore();
                  }

                  if (captionShadowStyle === 'outline') {
                    cCtx.lineWidth = Math.max(4, Math.round(capFontPx * 0.18));
                    cCtx.strokeStyle = '#000000';
                    cCtx.strokeText(rowText, refW / 2, rowY);
                  } else if (captionShadowStyle !== 'none') {
                    cCtx.shadowColor =
                      captionShadowStyle === 'gold_glow'
                        ? 'rgba(245,158,11,0.85)'
                        : 'rgba(0,0,0,0.95)';
                    cCtx.shadowBlur = (captionShadowStyle === 'soft' ? 6 : 14) * refScaleRatio;
                    cCtx.shadowOffsetY = 3 * refScaleRatio;
                  }

                  cCtx.fillStyle =
                    captionColor === 'amber'
                      ? '#fde047'
                      : captionColor === 'custom'
                      ? captionCustomColor
                      : '#ffffff';
                  cCtx.fillText(rowText, refW / 2, rowY);
                }

                cCtx.restore();
                captionSegmentsPayload.push({
                  pngDataUrl: cCanvas.toDataURL('image/png'),
                  startSec: cap.start,
                  endSec: cap.end,
                  yPct: stripYPct,
                  hPct: stripHPct,
                });
              }
            }
          }

          const srtText = captions
            .map((c, idx) => {
              const fmt = (sec: number) => {
                // Redondear a milisegundos enteros primero para no producir ",1000"
                const totalMs = Math.max(0, Math.round(sec * 1000));
                const h = Math.floor(totalMs / 3600000);
                const m = Math.floor((totalMs % 3600000) / 60000);
                const s = Math.floor((totalMs % 60000) / 1000);
                const ms = totalMs % 1000;
                return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(
                  s
                ).padStart(2, '0')},${String(ms).padStart(3, '0')}`;
              };
              return `${idx + 1}\n${fmt(c.start)} --> ${fmt(c.end)}\n${formatCaptionTextCase(c.text)}`;
            })
            .join('\n\n');

          const serverOrigin = getEditorPrimaryServerOrigin();

          // 1-second smooth countdown & elapsed timer
          let effectiveStartMs = localStartMs;
          secTimer = window.setInterval(() => {
            const elapsed = Math.max(0, Math.floor((Date.now() - effectiveStartMs) / 1000));
            setRenderElapsedSec(elapsed);
            setRenderRemainingSec((prev) => (prev > 2 ? prev - 1 : prev));
          }, 1000);

          // Poll live render progress from server & calibrate remaining time
          pollTimer = window.setInterval(async () => {
            try {
              const stResp = await fetch(`${serverOrigin}/api/editor/render-status`);
              if (stResp.ok) {
                const stData = await stResp.json();
                if (stData && stData.running) {
                  if (typeof stData.startedAt === 'number' && stData.startedAt > 0) {
                    effectiveStartMs = stData.startedAt;
                    setRenderStartedAtMs(stData.startedAt);
                  }
                  const curStep = Number(stData.currentStep || 0);
                  const totSteps = Number(stData.totalSteps || totalSegs);
                  setRenderStepInfo({ current: curStep, total: totSteps });

                  if (typeof stData.progressPct === 'number' && stData.progressPct > 0) {
                    const pct = Math.min(99, Math.max(2, stData.progressPct));
                    setRenderProgressPct(pct);

                    const elapsedSecNow = Math.max(
                      1,
                      (Date.now() - effectiveStartMs) / 1000
                    );
                    if (curStep >= 2 && pct >= 5) {
                      const completedSegments = Math.max(1, curStep - 1);
                      const measuredSecPerSeg = elapsedSecNow / completedSegments;
                      const remSegments = Math.max(0, totSteps - completedSegments);
                      const postMixOverheadSec = pct >= 90 ? 6 : 12;
                      const measuredEta = Math.round(
                        remSegments * measuredSecPerSeg + postMixOverheadSec
                      );
                      setRenderRemainingSec((prev) =>
                        prev > 0
                          ? Math.max(2, Math.round(prev * 0.35 + measuredEta * 0.65))
                          : Math.max(2, measuredEta)
                      );
                    }
                  }
                  if (stData.stageLabel) {
                    setRenderStageLabel(stData.stageLabel);
                    setStatusMessage(`🎬 ${stData.stageLabel}`);
                  }
                }
              }
            } catch {}
          }, 1200);

          const resp = await fetch(`${serverOrigin}/api/editor/render-ffmpeg`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              docId: activeDoc.id,
              folderPath: effectiveFolderPath,
              folderName: effectiveFolderName,
              docTitle: activeDoc.title,
              aspectRatio,
              resolution: exportResolution,
              fps: exportFps,
              bitrateMbps: exportBitrateMbps,
              clips: clipsWithTimelineBounds.map((c) => {
                const savedAudio = getSavedAudioEditForClip(
                  c,
                  readSavedClipAudioEdits(activeDoc.id)
                );
                const clipAudioMuted =
                  savedAudio?.audioMuted !== undefined
                    ? Boolean(savedAudio.audioMuted)
                    : Boolean(c.audioMuted);
                const clipCustomVolSet =
                  savedAudio?.customVolumeSet !== undefined
                    ? Boolean(savedAudio.customVolumeSet)
                    : Boolean(c.customVolumeSet);
                const clipFoleyVolume =
                  typeof savedAudio?.foleyVolume === 'number'
                    ? savedAudio.foleyVolume
                    : c.foleyVolume;
                const isIntroOrOutroClip =
                  c.id === 'fixed-doc-intro' ||
                  c.id === 'fixed-doc-outro' ||
                  c.clipNumber === 0 ||
                  c.clipNumber === 999;
                const isNarratedClip =
                  !isIntroOrOutroClip &&
                  c.clipNumber !== 1 &&
                  c.end > voiceStartOffsetSec + 0.5;
                const rawClipVolPct =
                  typeof clipFoleyVolume === 'number'
                    ? clipFoleyVolume
                    : isIntroOrOutroClip
                    ? 100
                    : isNarratedClip
                    ? foleyDuckedVolume
                    : foleyHighVolume;
                const isExplicitClipVol =
                  clipCustomVolSet ||
                  (typeof clipFoleyVolume === 'number' &&
                    clipFoleyVolume !== (isIntroOrOutroClip ? 100 : c.clipNumber === 1 ? 80 : 20));
                const effectiveClipFoleyPct =
                  clipAudioMuted || rawClipVolPct <= 0
                    ? 0
                    : isIntroOrOutroClip
                    ? rawClipVolPct
                    : isExplicitClipVol || !autoDuckingEnabled
                    ? rawClipVolPct
                    : isNarratedClip
                    ? Math.min(rawClipVolPct, foleyDuckedVolume)
                    : rawClipVolPct;
                return {
                  clipNumber: c.clipNumber,
                  fileName: c.fileName,
                  start: c.start,
                  end: c.end,
                  durationSec: c.duration,
                  sourceDuration: c.sourceDuration,
                  trimStart: c.trimStart || 0,
                  trimEnd: c.trimEnd,
                  speed: c.speed,
                  smoothSlowMo:
                    c.smoothSlowMo !== undefined ? c.smoothSlowMo : Boolean(c.speed && c.speed < 1),
                  opticalFlowUrl: c.opticalFlowUrl || '',
                  videoUrl: c.videoUrl || '',
                  foleyOnlyIsolated: Boolean(c.foleyOnlyIsolated),
                  foleyOnlyDisabled: Boolean(c.foleyOnlyDisabled),
                  vocalsSeparated: Boolean(c.vocalsSeparated),
                  musicSeparated: Boolean(c.musicSeparated),
                  foleyVolume: Math.max(0, Math.min(1, effectiveClipFoleyPct / 100)),
                  customVolumeSet: Boolean(isExplicitClipVol || clipAudioMuted),
                  audioMuted: Boolean(clipAudioMuted || effectiveClipFoleyPct <= 0),
                  audioFadeInSec: savedAudio?.audioFadeInSec ?? c.audioFadeInSec,
                  audioFadeOutSec: savedAudio?.audioFadeOutSec ?? c.audioFadeOutSec,
                  transition: c.transition,
                  reframe9x16Mode: c.reframe9x16Mode || 'auto_center',
                  reframeFocusXStart: typeof c.reframeFocusXStart === 'number' ? c.reframeFocusXStart : 50,
                  reframeFocusXEnd:
                    typeof c.reframeFocusXEnd === 'number'
                      ? c.reframeFocusXEnd
                      : typeof c.reframeFocusXStart === 'number'
                      ? c.reframeFocusXStart
                      : 50,
                  reframeFocusY: typeof c.reframeFocusY === 'number' ? c.reframeFocusY : 50,
                  userReframed9x16: Boolean(c.userReframed9x16),
                  // With framing points the fixed framing sent is the last point (used if the export cannot animate)
                  frameZoom: getClipFrameAt(c, aspectRatio, Number.MAX_SAFE_INTEGER).z,
                  frameOffsetX: getClipFrameAt(c, aspectRatio, Number.MAX_SAFE_INTEGER).x,
                  frameOffsetY: getClipFrameAt(c, aspectRatio, Number.MAX_SAFE_INTEGER).y,
                  frameKeys: getClipFrameKeys(c, aspectRatio),
                  videoDataUrl: c.videoUrl && c.videoUrl.startsWith('data:') ? c.videoUrl : '',
                };
              }),
              voiceoverStartSec: voiceStartOffsetSec,
              voiceoverVolume: voiceVolume / 100,
              voiceoverGainDb: voiceGainDb,
              voiceoverDataUrl:
                activeDoc.masterAudioUrl && activeDoc.masterAudioUrl.startsWith('data:')
                  ? activeDoc.masterAudioUrl
                  : '',
              sunoSilenceGapSec: 15,
              sunoMasterVolume: masterMusicVolume / 100,
              musicTracks: musicTracks.map((mt) => ({
                trackNumber: mt.trackNumber,
                title: mt.title,
                startSec: mt.start,
                durationSec: mt.duration,
                volume: (typeof mt.volume === 'number' ? mt.volume : masterMusicVolume) / 100,
                fadeInSec: mt.fadeInSec ?? 5,
                fadeOutSec: mt.fadeOutSec ?? 5,
                ...(mt.trackNumber === 1 && (clipsWithTimelineBounds.find((c) => c.clipNumber === 1)?.end ?? 0) > 0
                  ? {
                      clip1BoostVolume: CLIP1_SONG_BOOST_PCT / 100,
                      clip1BoostRampStartSec: (clipsWithTimelineBounds.find((c) => c.clipNumber === 1)?.end ?? 0) - CLIP1_BOOST_RAMP_BEFORE_SEC,
                      clip1BoostRampEndSec: (clipsWithTimelineBounds.find((c) => c.clipNumber === 1)?.end ?? 0) + CLIP1_BOOST_RAMP_AFTER_SEC,
                    }
                  : {}),
                audioDataUrl: mt.audioUrl && mt.audioUrl.startsWith('data:') ? mt.audioUrl : '',
              })),
              skipRanges916: aspectRatio === '9:16' ? hiddenIntroOutroRanges916 : [],
              srtContent: srtText,
              srtCoordinateSpace: 'timeline',
              overlays: {
                // Exact viewer parity: server/exportOverlayAss.ts reproduces this viewer's geometry & timing
                parityV2: true,
                clipAnim: { animIn: clipAnimIn, animOut: clipAnimOut, dur: clipAnimDur },
                burnInLogo,
                logo: {
                  pngDataUrl: logoPngDataUrl,
                  xPct: logoPosX,
                  yPct: logoPosY,
                  wPct: logoScalePct,
                  opacity: logoOpacity,
                  animIn: logoAnimIn,
                  animInDur: logoAnimInDur,
                  animOut: logoAnimOut,
                  animOutDur: logoAnimOutDur,
                },
                burnInHook,
                hookSegments: [],
                hookText: {
                  line1: clip1Line1,
                  line2: clip1Line2,
                  line1StartSec: hookLine1StartSec,
                  line2StartSec: hookLine2StartSec,
                  endSec: clip1OverlayEndSec,
                  bgStyle: hookBgStyle,
                  shadowStyle: hookShadowStyle,
                  line1Color: hookLine1Color,
                  line2Color: hookLine2Color,
                  fontFamily: hookFontFamily,
                  line1FontSize: hookLine1FontSize,
                  line2FontSize: hookLine2FontSize,
                  leftPct: hookLeftPct,
                  topPct: hookTopPct,
                  boxWidthPct: hookBoxWidthPct,
                  bgColor: hookBgColor,
                  bgOpacity: hookBgOpacity,
                  line1AnimIn: hookLine1AnimIn,
                  line1AnimInDur: hookLine1AnimInDur,
                  line1AnimOut: hookLine1AnimOut,
                  line1AnimOutDur: hookLine1AnimOutDur,
                  line2AnimIn: hookLine2AnimIn,
                  line2AnimInDur: hookLine2AnimInDur,
                  line2AnimOut: hookLine2AnimOut,
                  line2AnimOutDur: hookLine2AnimOutDur,
                },
                burnInCaptions,
                ...(karaokeCaptions
                  ? {
                      captionWordStarts: captions.map((c) => ({
                        s: Number((Math.max(0, Math.round(c.start * 1000)) / 1000).toFixed(3)),
                        w: getCaptionWordStarts(c, formatCaptionTextCase(c.text)),
                      })),
                    }
                  : {}),
                captionSegments: [],
                captionStyle: {
                  fontFamily: effCaptionFontFamily,
                  fontSize: aspectRatio === '9:16' ? captionFontSize9x16 : captionFontSize16x9,
                  fontSize16x9: captionFontSize16x9,
                  fontSize9x16: captionFontSize9x16,
                  wordsPerLine:
                    aspectRatio === '9:16' ? captionWordsPerLine9x16 : captionWordsPerLine16x9,
                  maxCharsPerLine: captionMaxChars,
                  lineMode: captionLineMode,
                  color: effCaptionColorHex,
                  ...(karaokeCaptions ? { activeWordColor: KARAOKE_9X16_CAPTION.activeWordColor } : {}),
                  bgStyle: effCaptionBgStyle,
                  shadowStyle: effCaptionShadowStyle,
                  bgColor: captionBgColor,
                  bgOpacity: captionBgOpacity,
                  bottomPct: captionBottomPct,
                  animIn: captionAnimIn,
                  animOut: captionAnimOut,
                  animDur: captionAnimDur,
                },
              },
            }),
          });
          if (pollTimer) {
            window.clearInterval(pollTimer);
            pollTimer = null;
          }
          if (secTimer) {
            window.clearInterval(secTimer);
            secTimer = null;
          }
          if (resp.ok && (resp.headers.get('content-type') || '').includes('application/json')) {
            const data = await resp.json();
            if (data.ok) {
              setRenderProgressPct(100);
              setRenderRemainingSec(0);
              setLastExportedOutputPath(data.outputPath || '');
              setRenderStageLabel(
                `✅ ¡Exportado en ${data.elapsedSec}s! Archivo: ${data.fileName}`
              );
              setStatusMessage(
                `✅ ¡Video renderizado y exportado en ${data.elapsedSec}s! Guardado en: ${data.outputPath}`
              );
              setIsRenderingVideo(false);
              return;
            }
          } else {
            const errJson = await resp.json().catch(() => null);
            if (errJson?.error) {
              const renderErr: any = new Error(errJson.error);
              renderErr.cancelled = Boolean(errJson.cancelled);
              throw renderErr;
            }
          }
        } catch (ffErr: any) {
          if (pollTimer) {
            window.clearInterval(pollTimer);
            pollTimer = null;
          }
          if (secTimer) {
            window.clearInterval(secTimer);
            secTimer = null;
          }
          if (ffErr?.cancelled) {
            // Cancelled by the user: not an error.
            setRenderProgressPct(0);
            setRenderStageLabel('🛑 Exportación cancelada');
            setStatusMessage('🛑 Exportación cancelada.');
            setIsRenderingVideo(false);
            setIsCancellingRender(false);
            return;
          }
          console.error('Error en renderizado nativo FFmpeg:', ffErr);
          setRenderStageLabel(`⚠️ ${ffErr?.message || 'Error en FFmpeg'}`);
          setStatusMessage(`⚠️ Error en renderizado FFmpeg: ${ffErr?.message || ffErr}`);
          setIsRenderingVideo(false);
          return;
        }
      }

      const canvas = document.createElement('canvas');
      canvas.width = width;
      canvas.height = height;
      const ctx = canvas.getContext('2d');
      if (!ctx) throw new Error('No se pudo inicializar el motor gráfico de renderizado.');

      const stream = canvas.captureStream(30);
      const mimeType = MediaRecorder.isTypeSupported('video/mp4;codecs=avc1')
        ? 'video/mp4;codecs=avc1'
        : MediaRecorder.isTypeSupported('video/mp4')
        ? 'video/mp4'
        : 'video/webm;codecs=vp9';

      const recorder = new MediaRecorder(stream, {
        mimeType,
        videoBitsPerSecond: preset.bitrateMbps * 1_000_000,
      });

      const chunks: BlobPart[] = [];
      recorder.ondataavailable = (e) => {
        if (e.data && e.data.size > 0) chunks.push(e.data);
      };

      recorder.start(250);

      // Render composite timeline frames
      const totalSteps = Math.max(20, Math.min(120, Math.round(totalDurationSec * 2)));
      for (let step = 0; step <= totalSteps; step++) {
        const simTime = (step / totalSteps) * totalDurationSec;
        setRenderProgressPct(Math.min(95, Math.round((step / totalSteps) * 90) + 5));

        // 1. Background
        ctx.fillStyle = '#080705';
        ctx.fillRect(0, 0, width, height);

        // 2. Active Clip Poster / Frame (with Clip Entrance/Exit Animation)
        const clip =
          clipsWithTimelineBounds.find((c) => simTime >= c.start && simTime < c.end) ||
          clipsWithTimelineBounds[0];

        const simPosterSrc = resolvePosterThumbSrc(clip);
        if (simPosterSrc) {
          const frameImg = await new Promise<HTMLImageElement | null>((resolve) => {
            const im = new Image();
            im.crossOrigin = 'anonymous';
            im.onload = () => resolve(im);
            im.onerror = () => resolve(null);
            im.src = simPosterSrc;
          });
          if (frameImg) {
            const isSimIntro = clip.id === 'fixed-doc-intro' || clip.clipNumber === 0;
            const isSimOutro = clip.id === 'fixed-doc-outro' || clip.clipNumber === 999;
            const hasSimIntro = clipsWithTimelineBounds.some(
              (c) => c.id === 'fixed-doc-intro' || c.clipNumber === 0
            );
            const hasSimOutro = clipsWithTimelineBounds.some(
              (c) => c.id === 'fixed-doc-outro' || c.clipNumber === 999
            );
            const firstSimBodyClip = clipsWithTimelineBounds.find(
              (c) =>
                c.id !== 'fixed-doc-intro' &&
                c.clipNumber !== 0 &&
                c.id !== 'fixed-doc-outro' &&
                c.clipNumber !== 999
            );
            const isSimClip1AfterIntro =
              !isSimIntro &&
              !isSimOutro &&
              hasSimIntro &&
              Boolean(firstSimBodyClip) &&
              clip.id === firstSimBodyClip?.id &&
              clip.transition !== 'direct';
            const isSimLastBodyClip =
              hasSimOutro &&
              clipsWithTimelineBounds.length >= 3 &&
              clip.index === clipsWithTimelineBounds.length - 2;

            const cAnim = computeElementAnimationState(
              simTime,
              clip.start,
              clip.end,
              isSimOutro || isSimIntro || isSimClip1AfterIntro ? 'fade' : clipAnimIn,
              isSimOutro ? 1.2 : isSimClip1AfterIntro ? 1.2 : isSimIntro ? 0.5 : clipAnimDur,
              isSimOutro || isSimIntro || isSimLastBodyClip ? 'fade' : clipAnimOut,
              isSimOutro ? 2.5 : isSimIntro ? 0.8 : isSimLastBodyClip ? 1.0 : clipAnimDur
            );
            ctx.save();
            ctx.globalAlpha = cAnim.opacity;
            if (cAnim.blurPx > 0.1) ctx.filter = `blur(${cAnim.blurPx.toFixed(1)}px)`;
            ctx.translate(width / 2 + cAnim.translateX, height / 2 + cAnim.translateY);
            ctx.scale(cAnim.scale, cAnim.scale);
            ctx.drawImage(frameImg, -width / 2, -height / 2, width, height);
            ctx.restore();
          }
        }

        // 3. Official Logo Top-Left (with Entrance & End-of-Documentary Fade-Out Animation)
        if (logoImg) {
          const lAnim = computeElementAnimationState(
            simTime,
            0,
            totalDurationSec,
            logoAnimIn,
            logoAnimInDur,
            logoAnimOut,
            logoAnimOutDur
          );
          if (lAnim.visible) {
            const logoW = Math.round(width * (logoScalePct / 100));
            const logoH = Math.round((logoImg.height / Math.max(1, logoImg.width)) * logoW);
            const lx = Math.round(width * (logoPosX / 100));
            const ly = Math.round(height * (logoPosY / 100));
            ctx.save();
            ctx.globalAlpha = (logoOpacity / 100) * lAnim.opacity;
            if (lAnim.blurPx > 0.1) ctx.filter = `blur(${lAnim.blurPx.toFixed(1)}px)`;
            ctx.translate(lx + logoW / 2 + lAnim.translateX, ly + logoH / 2 + lAnim.translateY);
            ctx.scale(lAnim.scale, lAnim.scale);
            ctx.drawImage(logoImg, -logoW / 2, -logoH / 2, logoW, logoH);
            ctx.restore();
          }
        }

        // Helper to word-wrap text identically to the 520p canonical WYSIWYG visor stage
        const wrapCanvasTextLines = (
          context: CanvasRenderingContext2D,
          rawText: string,
          maxLineWidth: number
        ): string[] => {
          const paragraphs = String(rawText || '').split('\n');
          const wrapped: string[] = [];
          for (const para of paragraphs) {
            const words = para.trim().split(/\s+/).filter(Boolean);
            if (words.length === 0) {
              wrapped.push('');
              continue;
            }
            let currentLine = words[0];
            for (let wi = 1; wi < words.length; wi++) {
              const candidate = `${currentLine} ${words[wi]}`;
              if (context.measureText(candidate).width <= maxLineWidth) {
                currentLine = candidate;
              } else {
                wrapped.push(currentLine);
                currentLine = words[wi];
              }
            }
            wrapped.push(currentLine);
          }
          // Anti-orphan guard for 16:9: never leave a single word alone on any line
          if (aspectRatio === '16:9' && wrapped.length >= 2) {
            for (let i = wrapped.length - 1; i >= 1; i--) {
              const lineWords = wrapped[i].trim().split(/\s+/).filter(Boolean);
              if (lineWords.length === 1) {
                const prevLineWords = wrapped[i - 1].trim().split(/\s+/).filter(Boolean);
                if (prevLineWords.length >= 3) {
                  const shifted = prevLineWords.pop()!;
                  wrapped[i - 1] = prevLineWords.join(' ');
                  wrapped[i] = `${shifted} ${wrapped[i]}`;
                } else if (prevLineWords.length === 2) {
                  const candidateCombined = `${wrapped[i - 1]} ${wrapped[i]}`;
                  if (context.measureText(candidateCombined).width <= maxLineWidth * 1.08) {
                    wrapped[i - 1] = candidateCombined;
                    wrapped.splice(i, 1);
                  }
                }
              }
            }
          }
          return wrapped;
        };

        // 4. Clip 1 Hook Text (00:08 - clip1OverlayEndSec) — 100% identical to Canonical Visor
        if (
          simTime >= Math.min(hookLine1StartSec, hookLine2StartSec) &&
          simTime <= clip1OverlayEndSec &&
          (clip1Line1 || clip1Line2)
        ) {
          const l1Anim = computeElementAnimationState(
            simTime,
            hookLine1StartSec,
            clip1OverlayEndSec,
            hookLine1AnimIn,
            hookLine1AnimInDur,
            hookLine1AnimOut,
            hookLine1AnimOutDur
          );
          const l2Anim = computeElementAnimationState(
            simTime,
            hookLine2StartSec,
            clip1OverlayEndSec,
            hookLine2AnimIn,
            hookLine2AnimInDur,
            hookLine2AnimOut,
            hookLine2AnimOutDur
          );

          ctx.save();
          ctx.textAlign = 'center';
          const scaleRatio = height / 520;
          const f1 = Math.round(hookLine1FontSize * scaleRatio);
          const f2 = Math.round(hookLine2FontSize * scaleRatio);
          const xCenter = Math.round(width * (hookLeftPct / 100));
          const yCenter = Math.round(height * (hookTopPct / 100));
          const boxW = Math.round(width * (hookBoxWidthPct / 100));
          const maxHookTextWidth = Math.max(80, boxW - Math.round(40 * scaleRatio));

          ctx.font = `700 ${f1}px ${hookFontFamily}`;
          if ('letterSpacing' in ctx) {
            (ctx as any).letterSpacing = `${(f1 * 0.1).toFixed(2)}px`;
          }
          const line1Rows = clip1Line1
            ? wrapCanvasTextLines(ctx, clip1Line1.toUpperCase(), maxHookTextWidth)
            : [];

          ctx.font = `900 ${f2}px ${hookFontFamily}`;
          if ('letterSpacing' in ctx) {
            (ctx as any).letterSpacing = `${(f2 * 0.025).toFixed(2)}px`;
          }
          const line2Rows = clip1Line2
            ? wrapCanvasTextLines(ctx, clip1Line2.toUpperCase(), maxHookTextWidth)
            : [];
          if ('letterSpacing' in ctx) {
            (ctx as any).letterSpacing = '0px';
          }

          const line1RowH = Math.round(f1 * 1.375);
          const line2RowH = Math.round(f2 * 1.375);
          const interBlockGap = clip1Line1 && clip1Line2 ? Math.round(6 * scaleRatio) : 0;
          const totalH1 = line1Rows.length * line1RowH;
          const totalH2 = line2Rows.length * line2RowH;
          const totalContentH = totalH1 + interBlockGap + totalH2;

          if ((hookBgStyle === 'semi' || hookBgStyle === 'solid') && (l1Anim.visible || l2Anim.visible)) {
            ctx.save();
            ctx.globalAlpha = Math.max(l1Anim.opacity, l2Anim.opacity);
            ctx.fillStyle = hexToRgba(
              hookBgColor,
              hookBgStyle === 'solid' ? 95 : hookBgOpacity
            );
            const padBox = Math.round(10 * scaleRatio);
            const boxH = Math.round(totalContentH + padBox * 2);
            ctx.beginPath();
            ctx.roundRect(
              Math.round(xCenter - boxW / 2),
              Math.round(yCenter - boxH / 2),
              boxW,
              boxH,
              Math.round(12 * scaleRatio)
            );
            ctx.fill();
            ctx.restore();
          }

          let cursorY = Math.round(yCenter - totalContentH / 2 + f1 * 0.85);
          if (clip1Line1) {
            if (l1Anim.visible) {
              ctx.save();
              ctx.globalAlpha = l1Anim.opacity;
              if (l1Anim.blurPx > 0.1) ctx.filter = `blur(${l1Anim.blurPx.toFixed(1)}px)`;
              ctx.translate(
                xCenter + l1Anim.translateX * scaleRatio,
                cursorY + l1Anim.translateY * scaleRatio
              );
              ctx.scale(l1Anim.scale, l1Anim.scale);
              ctx.translate(-xCenter, -cursorY);
              ctx.font = `700 ${f1}px ${hookFontFamily}`;
              if ('letterSpacing' in ctx) {
                (ctx as any).letterSpacing = `${(f1 * 0.1).toFixed(2)}px`;
              }
              let rowY1 = cursorY;
              for (const rowText of line1Rows) {
                if (hookBgStyle === 'word_shadow' && rowText.trim()) {
                  ctx.save();
                  const m1 = ctx.measureText(rowText);
                  const padX1 = Math.round(10 * scaleRatio);
                  const padY1 = Math.round(2 * scaleRatio);
                  const w1 = Math.min(boxW, m1.width + padX1 * 2);
                  const h1 = Math.round(f1 * 1.22) + padY1 * 2;
                  ctx.fillStyle = hexToRgba(hookBgColor, hookBgOpacity);
                  ctx.shadowColor = hexToRgba(hookBgColor, Math.round(hookBgOpacity * 0.85));
                  ctx.shadowBlur = Math.round(12 * scaleRatio);
                  ctx.beginPath();
                  ctx.roundRect(
                    Math.round(xCenter - w1 / 2),
                    Math.round(rowY1 - f1 * 0.88 - padY1),
                    Math.round(w1),
                    Math.round(h1),
                    Math.round(6 * scaleRatio)
                  );
                  ctx.fill();
                  ctx.restore();
                }
                if (hookShadowStyle !== 'none') {
                  ctx.shadowColor =
                    hookShadowStyle === 'gold_glow' ? 'rgba(245,158,11,0.85)' : 'rgba(0,0,0,0.95)';
                  ctx.shadowBlur = (hookShadowStyle === 'soft' ? 8 : 18) * scaleRatio;
                  ctx.shadowOffsetY = 3 * scaleRatio;
                }
                if (hookShadowStyle === 'outline') {
                  ctx.lineWidth = Math.max(3, Math.round(f1 * 0.16));
                  ctx.strokeStyle = '#000000';
                  ctx.strokeText(rowText, xCenter, rowY1);
                }
                ctx.fillStyle = hookLine1Color;
                ctx.fillText(rowText, xCenter, rowY1);
                rowY1 += line1RowH;
              }
              ctx.restore();
            }
            cursorY += totalH1 + interBlockGap + Math.round((f2 - f1) * 0.85);
          }
          if (clip1Line2 && l2Anim.visible) {
            if (!clip1Line1) {
              cursorY = Math.round(yCenter - totalH2 / 2 + f2 * 0.85);
            }
            ctx.save();
            ctx.globalAlpha = l2Anim.opacity;
            if (l2Anim.blurPx > 0.1) ctx.filter = `blur(${l2Anim.blurPx.toFixed(1)}px)`;
            ctx.translate(
              xCenter + l2Anim.translateX * scaleRatio,
              cursorY + l2Anim.translateY * scaleRatio
            );
            ctx.scale(l2Anim.scale, l2Anim.scale);
            ctx.translate(-xCenter, -cursorY);
            ctx.font = `900 ${f2}px ${hookFontFamily}`;
            if ('letterSpacing' in ctx) {
              (ctx as any).letterSpacing = `${(f2 * 0.025).toFixed(2)}px`;
            }
            for (const rowText of line2Rows) {
              if (hookBgStyle === 'word_shadow' && rowText.trim()) {
                ctx.save();
                const m2 = ctx.measureText(rowText);
                const padX2 = Math.round(10 * scaleRatio);
                const padY2 = Math.round(2 * scaleRatio);
                const w2 = Math.min(boxW, m2.width + padX2 * 2);
                const h2 = Math.round(f2 * 1.22) + padY2 * 2;
                ctx.fillStyle = hexToRgba(hookBgColor, hookBgOpacity);
                ctx.shadowColor = hexToRgba(hookBgColor, Math.round(hookBgOpacity * 0.85));
                ctx.shadowBlur = Math.round(14 * scaleRatio);
                ctx.beginPath();
                ctx.roundRect(
                  Math.round(xCenter - w2 / 2),
                  Math.round(cursorY - f2 * 0.88 - padY2),
                  Math.round(w2),
                  Math.round(h2),
                  Math.round(6 * scaleRatio)
                );
                ctx.fill();
                ctx.restore();
              }
              if (hookShadowStyle !== 'none') {
                ctx.shadowColor =
                  hookShadowStyle === 'gold_glow' ? 'rgba(245,158,11,0.85)' : 'rgba(0,0,0,0.95)';
                ctx.shadowBlur = (hookShadowStyle === 'soft' ? 8 : 18) * scaleRatio;
                ctx.shadowOffsetY = 3 * scaleRatio;
              }
              if (hookShadowStyle === 'outline') {
                ctx.lineWidth = Math.max(4, Math.round(f2 * 0.16));
                ctx.strokeStyle = '#000000';
                ctx.strokeText(rowText, xCenter, cursorY);
              }
              ctx.fillStyle = hookLine2Color;
              ctx.fillText(rowText, xCenter, cursorY);
              cursorY += line2RowH;
            }
            ctx.restore();
          }
          ctx.restore();
        }

        // 5. Active Caption (.SRT) — 100% identical to Canonical Visor
        const cap = captions.find((c) => simTime >= c.start && simTime <= c.end);
        if (cap) {
          const capAnim = computeElementAnimationState(
            simTime,
            cap.start,
            cap.end,
            captionAnimIn,
            captionAnimDur,
            captionAnimOut,
            captionAnimDur
          );
          if (capAnim.visible) {
            ctx.save();
            const scaleRatio = height / 520;
            const effectiveCapPx = Math.max(13, captionFontSize * 0.76);
            const capFontPx = Math.round(effectiveCapPx * scaleRatio);
            ctx.font = `800 ${capFontPx}px ${captionFontFamily}`;
            ctx.textAlign = 'center';
            const maxCapTextW = Math.max(100, width - Math.round(52 * scaleRatio));
            const capRows = wrapCanvasTextLines(ctx, formatCaptionTextCase(cap.text), maxCapTextW);
            const capLineH = Math.round(capFontPx * 1.35);
            const yBottom = Math.round(height * (1 - captionBottomPct / 100));
            ctx.globalAlpha = capAnim.opacity;
            if (capAnim.blurPx > 0.1) ctx.filter = `blur(${capAnim.blurPx.toFixed(1)}px)`;
            ctx.translate(
              width / 2 + capAnim.translateX * scaleRatio,
              yBottom + capAnim.translateY * scaleRatio
            );
            ctx.scale(capAnim.scale, capAnim.scale);
            ctx.translate(-width / 2, -yBottom);

            if (captionBgStyle === 'semi' || captionBgStyle === 'solid') {
              let maxRowW = 0;
              for (const r of capRows) {
                maxRowW = Math.max(maxRowW, ctx.measureText(r).width);
              }
              const padX = Math.round(14 * scaleRatio);
              const padY = Math.round(4 * scaleRatio);
              const boxW = Math.min(width - Math.round(32 * scaleRatio), maxRowW + padX * 2);
              const boxH = capRows.length * capLineH + padY * 2;
              ctx.fillStyle = hexToRgba(
                captionBgColor,
                captionBgStyle === 'solid' ? 95 : captionBgOpacity
              );
              ctx.beginPath();
              ctx.roundRect(
                Math.round((width - boxW) / 2),
                Math.round(yBottom - boxH),
                Math.round(boxW),
                Math.round(boxH),
                Math.round(8 * scaleRatio)
              );
              ctx.fill();
            }

            for (let ri = 0; ri < capRows.length; ri++) {
              const rowText = capRows[ri];
              const rowY =
                yBottom -
                (capRows.length - 1 - ri) * capLineH -
                Math.round(capFontPx * 0.28);

              if (captionBgStyle === 'word_shadow' && rowText.trim()) {
                ctx.save();
                const mCap = ctx.measureText(rowText);
                const padX = Math.round(10 * scaleRatio);
                const padY = Math.round(2 * scaleRatio);
                const wCap = Math.min(
                  width - Math.round(32 * scaleRatio),
                  mCap.width + padX * 2
                );
                const hCap = Math.round(capFontPx * 1.22) + padY * 2;
                ctx.fillStyle = hexToRgba(captionBgColor, captionBgOpacity);
                ctx.shadowColor = hexToRgba(captionBgColor, Math.round(captionBgOpacity * 0.85));
                ctx.shadowBlur = Math.round(12 * scaleRatio);
                ctx.beginPath();
                ctx.roundRect(
                  Math.round((width - wCap) / 2),
                  Math.round(rowY - capFontPx * 0.88 - padY),
                  Math.round(wCap),
                  Math.round(hCap),
                  Math.round(6 * scaleRatio)
                );
                ctx.fill();
                ctx.restore();
              }

              if (captionShadowStyle === 'outline') {
                ctx.lineWidth = Math.max(4, Math.round(capFontPx * 0.18));
                ctx.strokeStyle = '#000000';
                ctx.strokeText(rowText, width / 2, rowY);
              } else if (captionShadowStyle !== 'none') {
                ctx.shadowColor =
                  captionShadowStyle === 'gold_glow' ? 'rgba(245,158,11,0.85)' : 'rgba(0,0,0,0.95)';
                ctx.shadowBlur = (captionShadowStyle === 'soft' ? 6 : 14) * scaleRatio;
                ctx.shadowOffsetY = 3 * scaleRatio;
              }

              ctx.fillStyle =
                captionColor === 'amber'
                  ? '#fde047'
                  : captionColor === 'custom'
                  ? captionCustomColor
                  : '#ffffff';
              ctx.fillText(rowText, width / 2, rowY);
            }
            ctx.restore();
          }
        }

        await new Promise((r) => setTimeout(r, 35));
      }

      await new Promise<void>((resolve) => {
        recorder.onstop = () => resolve();
        recorder.stop();
      });

      const finalBlob = new Blob(chunks, { type: 'video/mp4' });
      const rawDocTitle = String(
        activeDoc?.title || activeDoc?.downloadFolderName || 'Documental_Huellas'
      ).trim();
      const numMatch =
        rawDocTitle.match(/\bvideo[_\-\s]*0*(\d+)/i) ||
        String(activeDoc?.downloadFolderName || '').match(/\bvideo[_\-\s]*0*(\d+)/i);
      const videoNumPrefix = numMatch ? `Video_${numMatch[1]}` : 'Video_1';
      const strippedTitle =
        rawDocTitle.replace(/^(?:video[_\-\s]*0*\d+[_\-\s:—–]*)/i, '').trim() ||
        'Documental_Huellas';
      const safeTitle = strippedTitle
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .replace(/[^a-zA-Z0-9_-]+/g, '_')
        .replace(/^_+|_+$/g, '')
        .slice(0, 60);
      const platformSlug = aspectRatio === '9:16' ? 'Facebook' : 'YouTube';
      const ratioSlug = aspectRatio === '16:9' ? '16x9' : '9x16';
      const resLabel =
        exportResolution === '8K_4320P'
          ? '8K_4320p'
          : exportResolution === '4K_2160P'
          ? '4K_2160p'
          : exportResolution === '2K_1440P'
          ? '2K_1440p'
          : '1080p';
      const outFileName = `${videoNumPrefix}_${platformSlug}_${ratioSlug}_${safeTitle}_${resLabel}_${exportFps}fps_${exportBitrateMbps}Mbps.mp4`;

      await onSaveFileToChosenFolder(outFileName, finalBlob);
      setRenderProgressPct(100);
      setStatusMessage(
        `✅ ¡Documental renderizado y descargado en ${preset.badge} (${aspectRatio}) como "${outFileName}"!`
      );
    } catch (err: any) {
      setStatusMessage(`⚠️ Error renderizando y descargando video: ${err?.message || err}`);
    } finally {
      setIsRenderingVideo(false);
    }
  };

  const activePreset = RESOLUTION_PRESETS[exportResolution];
  const clipProgressRatio = activeClipAtPlayhead
    ? Math.min(
        1,
        Math.max(
          0,
          (currentTime - activeClipAtPlayhead.start) / Math.max(0.5, activeClipAtPlayhead.duration)
        )
      )
    : 0;
  const kenBurnsScale = (1.02 + clipProgressRatio * 0.14).toFixed(3);
  const kenBurnsPanX = (
    ((activeClipAtPlayhead?.clipNumber || 1) % 2 === 0 ? -1 : 1) *
    clipProgressRatio *
    2.4
  ).toFixed(2);

  // Real-time viewer animation states for Clip/Image, Official Logo, Hook Line 1, Hook Line 2 & Captions
  const isIntroClipActive =
    activeClipAtPlayhead?.id === 'fixed-doc-intro' || activeClipAtPlayhead?.clipNumber === 0;
  const isOutroClipActive =
    activeClipAtPlayhead?.id === 'fixed-doc-outro' || activeClipAtPlayhead?.clipNumber === 999;
  const hasTimelineIntro = clipsWithTimelineBounds.some(
    (c) => c.id === 'fixed-doc-intro' || c.clipNumber === 0
  );
  const hasTimelineOutro = clipsWithTimelineBounds.some(
    (c) => c.id === 'fixed-doc-outro' || c.clipNumber === 999
  );
  const firstTimelineBodyClip = clipsWithTimelineBounds.find(
    (c) =>
      c.id !== 'fixed-doc-intro' &&
      c.clipNumber !== 0 &&
      c.id !== 'fixed-doc-outro' &&
      c.clipNumber !== 999
  );
  const isFirstClipAfterIntro =
    Boolean(activeClipAtPlayhead) &&
    !isIntroClipActive &&
    !isOutroClipActive &&
    hasTimelineIntro &&
    Boolean(firstTimelineBodyClip) &&
    activeClipAtPlayhead?.id === firstTimelineBodyClip?.id &&
    activeClipAtPlayhead?.transition !== 'direct';
  const isLastBodyClipBeforeOutro =
    Boolean(activeClipAtPlayhead) &&
    hasTimelineOutro &&
    clipsWithTimelineBounds.length >= 3 &&
    activeClipAtPlayhead?.index === clipsWithTimelineBounds.length - 2;

  const liveClipAnim = activeClipAtPlayhead
    ? computeElementAnimationState(
        currentTime,
        activeClipAtPlayhead.start,
        activeClipAtPlayhead.end,
        isOutroClipActive || isIntroClipActive || isFirstClipAfterIntro ? 'fade' : clipAnimIn,
        isOutroClipActive
          ? 0.3
          : isFirstClipAfterIntro
          ? 1.2
          : isIntroClipActive
          ? 0.5
          : clipAnimDur,
        isOutroClipActive
          ? 'fade'
          : isIntroClipActive || isLastBodyClipBeforeOutro
          ? 'fade'
          : clipAnimOut,
        isOutroClipActive
          ? 0.5
          : isIntroClipActive
          ? 0.8
          : isLastBodyClipBeforeOutro
          ? 1.0
          : clipAnimDur
      )
    : { visible: true, opacity: 1, translateX: 0, translateY: 0, scale: 1, blurPx: 0 };

  const logoOverlayEndSec = totalDurationSec;

  const liveLogoAnim = computeElementAnimationState(
    currentTime,
    0,
    logoOverlayEndSec,
    logoAnimIn,
    logoAnimInDur,
    logoAnimOut,
    logoAnimOutDur
  );

  const liveHookLine1Anim = computeElementAnimationState(
    currentTime,
    hookLine1StartSec,
    clip1OverlayEndSec,
    hookLine1AnimIn,
    hookLine1AnimInDur,
    hookLine1AnimOut,
    hookLine1AnimOutDur
  );

  const liveHookLine2Anim = computeElementAnimationState(
    currentTime,
    hookLine2StartSec,
    clip1OverlayEndSec,
    hookLine2AnimIn,
    hookLine2AnimInDur,
    hookLine2AnimOut,
    hookLine2AnimOutDur
  );

  const liveCaptionAnim = activeCaptionAtPlayhead
    ? computeElementAnimationState(
        currentTime,
        activeCaptionAtPlayhead.start,
        activeCaptionAtPlayhead.end,
        captionAnimIn,
        captionAnimDur,
        captionAnimOut,
        captionAnimDur
      )
    : { visible: true, opacity: 1, translateX: 0, translateY: 0, scale: 1, blurPx: 0 };

  // Whenever any element is selected (on canvas, left media list, or timeline), open the Right Column Inspector to that element's settings
  useEffect(() => {
    if (selectedCanvasObject === 'logo' || selectedCanvasObject === 'hook_text') {
      setActiveInspectorTab('branding');
      if (typeof window === 'undefined' || window.innerWidth >= 1024) {
        setIsRightPanelCollapsed(false);
      }
    } else if (selectedCanvasObject === 'captions') {
      setActiveInspectorTab('captions');
      if (typeof window === 'undefined' || window.innerWidth >= 1024) {
        setIsRightPanelCollapsed(false);
      }
    }
  }, [selectedCanvasObject]);

  useEffect(() => {
    if (selectedClipId) {
      setActiveInspectorTab('clips');
      if (typeof window === 'undefined' || window.innerWidth >= 1024) {
        setIsRightPanelCollapsed(false);
      }
    }
  }, [selectedClipId]);

  useEffect(() => {
    if (selectedMusicTrackId) {
      setActiveInspectorTab('audio');
      if (typeof window === 'undefined' || window.innerWidth >= 1024) {
        setIsRightPanelCollapsed(false);
      }
    }
  }, [selectedMusicTrackId]);

  return (
    <div className="w-full h-full flex-1 min-h-0 flex flex-col bg-[#0c0a08] text-slate-100 overflow-hidden">
      {/* Hidden audio elements for Voiceover (Track 4) and Suno Music (Track 5) */}
      {effectiveVoiceoverUrl && (
        <audio
          ref={voiceAudioRef}
          src={effectiveVoiceoverUrl}
          preload={isEditorActive ? 'auto' : 'metadata'}
          onError={() => setVoiceAudioError(true)}
          onLoadedMetadata={(e) => {
            setVoiceAudioError(false);
            const dur = e.currentTarget.duration;
            if (dur && Number.isFinite(dur) && dur > 1) {
              setVoiceDurationSec(dur);
            }
          }}
          onDurationChange={(e) => {
            const dur = e.currentTarget.duration;
            if (dur && Number.isFinite(dur) && dur > 1) {
              setVoiceDurationSec(dur);
            }
          }}
        />
      )}
      <audio
        ref={musicAudioRef}
        preload={isEditorActive ? 'auto' : 'none'}
      />
      <audio
        ref={separatedVocalsAudioRef}
        src={
          activeSeparatedVocalAtPlayhead?.audioUrl ||
          separatedVocalSegments[0]?.audioUrl ||
          undefined
        }
        preload={isEditorActive ? 'auto' : 'none'}
      />
      <audio
        ref={separatedMusicAudioRef}
        src={
          activeSeparatedMusicAtPlayhead?.audioUrl ||
          separatedMusicSegments[0]?.audioUrl ||
          undefined
        }
        preload={isEditorActive ? 'auto' : 'none'}
      />
      <audio
        ref={naturalClipFoleyAudioRef}
        preload={isEditorActive ? 'auto' : 'none'}
      />

      {/* FLOATING RIGHT-CLICK CONTEXT MENU FOR SELECTED TIMELINE CLIPS (Separar ▸ Voces / Extraer Música) */}
      {clipContextMenu && (
        <div
          onClick={(e) => e.stopPropagation()}
          onContextMenu={(e) => {
            e.preventDefault();
            e.stopPropagation();
          }}
          style={{
            left: `${Math.min(
              typeof window !== 'undefined' ? window.innerWidth - 260 : 900,
              Math.max(12, clipContextMenu.x)
            )}px`,
            top: `${Math.min(
              typeof window !== 'undefined' ? window.innerHeight - 180 : 600,
              Math.max(12, clipContextMenu.y)
            )}px`,
          }}
          className="fixed z-[250] w-56 rounded-xl bg-slate-950/95 backdrop-blur-md border border-amber-500/40 shadow-2xl shadow-black/80 py-1.5 text-xs select-none"
        >
          <div className="px-3 py-1.5 border-b border-slate-800/90 flex items-center justify-between gap-2">
            <span className="font-black text-amber-300 text-[11px] truncate">
              🎬 {clipContextMenu.clipIds.length} clip
              {clipContextMenu.clipIds.length === 1 ? ' seleccionado' : 's seleccionados'}
            </span>
            <span className="text-[9px] text-slate-400 font-mono">Clic derecho</span>
          </div>

          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              setSelectedClipIds(clipContextMenu.clipIds);
              if (clipContextMenu.clipIds[0]) {
                setSelectedClipId(clipContextMenu.clipIds[0]);
              }
              setActiveInspectorTab('clips');
              setIsRightPanelCollapsed(false);
              setClipContextMenu(null);
            }}
            className="w-full px-3 py-2 text-left hover:bg-emerald-500/20 text-emerald-300 hover:text-emerald-200 font-black flex items-center justify-between gap-2 border-b border-slate-800/80 cursor-pointer transition"
          >
            <span className="flex items-center gap-2">
              <Volume2 className="w-3.5 h-3.5 text-emerald-400" />
              <span>Editar Audio, Volumen y Fades</span>
            </span>
            <span className="px-1.5 py-0.5 rounded bg-emerald-500/20 border border-emerald-500/40 text-[9px] font-mono text-emerald-200">
              {clipContextMenu.clipIds.length} clip{clipContextMenu.clipIds.length > 1 ? 's' : ''}
            </span>
          </button>

          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              handleRepairChoppyZoomForClips(clipContextMenu.clipIds);
            }}
            className="w-full px-3 py-2 text-left hover:bg-sky-500/20 text-sky-300 hover:text-sky-200 font-bold flex items-center justify-between gap-2 border-t border-slate-800/80 cursor-pointer transition"
            title="Reconstruir el slow zoom-in entrecortado de imagen estática a 60 FPS sub-píxel totalmente fluido"
          >
            <span className="flex items-center gap-2">
              <Sparkles className="w-3.5 h-3.5 text-sky-400" />
              <span>Suavizar Zoom Entrecortado</span>
            </span>
            <span className="px-1.5 py-0.5 rounded bg-sky-500/20 border border-sky-500/40 text-[9px] font-mono text-sky-200">
              60 FPS
            </span>
          </button>
        </div>
      )}

      {/* =====================================================================
          TOP BAR: CAPCUT-STYLE ULTRA-COMPACT PROJECT BAR, RATIO, QUALITY & EXPORT
      ===================================================================== */}
      <div className="bg-[#14110d] border-b border-amber-500/25 px-2.5 py-1 flex flex-wrap md:flex-nowrap items-center justify-between gap-x-2 gap-y-1 shrink-0 whitespace-nowrap">
        <div className="flex flex-wrap md:flex-nowrap items-center gap-1.5 min-w-0 max-w-full md:flex-1 md:overflow-hidden">
          <div className="flex items-center gap-1.5 min-w-0 max-w-full">
            <span className="px-2 py-0.5 rounded-md bg-amber-500 text-slate-950 font-black text-[11px] flex items-center gap-1">
              <Film className="w-3 h-3" />
              EDITOR
            </span>
            {documentaries.length > 0 && onSelectDoc ? (
              <select
                value={activeDoc?.id || ''}
                onChange={(e) => {
                  setIsPlaying(false);
                  setCurrentTime(0);
                  onSelectDoc(e.target.value);
                }}
                className="bg-slate-950 border border-amber-500/40 rounded-lg px-2 py-0.5 text-[11px] font-bold text-amber-200 max-w-[220px] min-w-0 shrink cursor-pointer outline-none"
                title="Cambiar de documental directamente desde el Editor de Video"
              >
                {documentaries.map((d) => (
                  <option key={d.id} value={d.id}>
                    {d.title} ({(d.clips || []).length} clips
                    {d.masterAudioUrl ? ' • 🎙️ Voz' : ''})
                  </option>
                ))}
              </select>
            ) : (
              <span className="text-xs font-bold text-amber-200 truncate max-w-[240px]">
                {activeDoc?.title || 'Sin Documental Seleccionado'}
              </span>
            )}
          </div>

          {(activeDoc?.clips?.length || 0) > 0 && (() => {
            const totalScriptCount = activeDoc!.clips.length;
            const reviewedCount = activeDoc!.clips.filter((c) => c.reviewedForEditor).length;
            const isAllReviewed = reviewedCount >= totalScriptCount;
            return (
              <div className="flex items-center bg-slate-950 border border-emerald-500/40 rounded-lg p-0.5 text-[10px] min-w-0 shrink">
                <button
                  type="button"
                  onClick={() => {
                    if (!isAllReviewed && onOpenStage6Review) {
                      onOpenStage6Review();
                    }
                  }}
                  className={`px-2 py-0.5 rounded font-black transition flex items-center gap-1 min-w-0 ${
                    isAllReviewed
                      ? 'bg-emerald-500 text-slate-950 shadow cursor-default'
                      : reviewedCount === 0
                      ? 'bg-amber-500/20 text-amber-300 hover:bg-amber-500/30 cursor-pointer'
                      : 'bg-emerald-500/20 text-emerald-300 hover:bg-emerald-500/30 cursor-pointer'
                  }`}
                  title={
                    isAllReviewed
                      ? `Los ${totalScriptCount} clips de Etapa 6 están revisados y activos en el Timeline`
                      : `Solo los clips marcados como Revisados en Etapa 6 (${reviewedCount}/${totalScriptCount}) pasan al Timeline. Haz clic para ir a Etapa 6.`
                  }
                >
                  <span className="truncate">
                    {reviewedCount === 0 ? '🔒' : '✅'} Revisados ({reviewedCount}/{totalScriptCount})
                  </span>
                  {!isAllReviewed && onOpenStage6Review && (
                    <span className="underline opacity-90">• Etapa 6</span>
                  )}
                </button>
              </div>
            );
          })()}
        </div>

        {/* Panel toggles + quick overlay selection + framing bars toggle (formerly a second bar above the viewer) */}
        <div className="flex items-center gap-1.5 shrink-0 text-[10px]">
          <button
            type="button"
            onClick={() => {
              setIsLeftPanelCollapsed((prev) => {
                const next = !prev;
                if (!next && typeof window !== 'undefined' && window.innerWidth < 1024) {
                  setIsRightPanelCollapsed(true);
                }
                return next;
              });
            }}
            className="shrink-0 inline-flex items-center px-1.5 py-0.5 rounded bg-slate-900 hover:bg-slate-800 border border-slate-700/80 font-bold text-slate-200 cursor-pointer"
            title={isLeftPanelCollapsed ? 'Mostrar panel izquierdo Media' : 'Ocultar panel izquierdo Media para ampliar el visor'}
          >
            ◧
          </button>
          <div
            data-keep-canvas-selection="true"
            className="shrink-0 flex items-center gap-0.5 bg-slate-950 border border-slate-800 rounded-lg p-0.5"
          >
            {(
              [
                { id: 'logo', label: '🏷️ Logo', tab: 'branding', on: 'bg-amber-500 text-slate-950' },
                { id: 'hook_text', label: '🔤 Texto', tab: 'branding', on: 'bg-amber-500 text-slate-950' },
                { id: 'captions', label: '💬 Captions', tab: 'captions', on: 'bg-sky-400 text-slate-950' },
              ] as const
            ).map((o) => (
              <button
                key={o.id}
                type="button"
                onClick={() => {
                  setSelectedCanvasObject((prev) => (prev === o.id ? null : o.id));
                  setActiveInspectorTab(o.tab);
                }}
                className={`px-1.5 py-0.5 rounded font-bold cursor-pointer transition ${
                  selectedCanvasObject === o.id ? o.on : 'text-slate-300 hover:bg-slate-800'
                }`}
              >
                {o.label}
              </button>
            ))}
          </div>
          <button
            type="button"
            onClick={() => {
              setShowFramingBars((prev) => {
                const next = !prev;
                try {
                  localStorage.setItem('huellas_editor_show_framing_bars', next ? '1' : '0');
                } catch {
                  /* almacenamiento no disponible */
                }
                return next;
              });
            }}
            aria-pressed={showFramingBars}
            className={`shrink-0 px-1.5 py-0.5 rounded border font-bold cursor-pointer transition ${
              showFramingBars
                ? 'bg-amber-500 border-amber-400 text-slate-950'
                : 'bg-slate-900 hover:bg-slate-800 border-slate-700/80 text-slate-200'
            }`}
            title="Mostrar u ocultar las barras de Tamaño del clip y Encuadre 9:16 encima del visor (al hacer clic en el clip del visor, la de Tamaño aparece sola)"
          >
            🎯 Encuadre
          </button>
          {!(effectiveVoiceoverUrl && !voiceAudioError) && (
            <span className="shrink-0 px-1.5 py-0.5 rounded font-bold bg-amber-500/15 border border-amber-500/40 text-amber-300">
              🔇 Sin Voz
            </span>
          )}
          <button
            type="button"
            onClick={() => {
              setIsRightPanelCollapsed((prev) => {
                const next = !prev;
                if (!next && typeof window !== 'undefined' && window.innerWidth < 1024) {
                  setIsLeftPanelCollapsed(true);
                }
                return next;
              });
            }}
            className="shrink-0 inline-flex items-center px-1.5 py-0.5 rounded bg-slate-900 hover:bg-slate-800 border border-slate-700/80 font-bold text-slate-200 cursor-pointer"
            title={isRightPanelCollapsed ? 'Mostrar panel derecho Details/Inspector' : 'Ocultar panel derecho Details/Inspector para ampliar el visor'}
          >
            ◨
          </button>
        </div>

        {/* Aspect Ratio (16:9 vs 9:16) + Export Quality (HD / 2K / 4K / 8K) + Folder & Download (with Render) */}
        <div className="flex flex-wrap md:flex-nowrap items-center justify-end gap-1.5 min-w-0 max-w-full md:shrink-0">
          {/* Aspect Ratio Selector (Dual-Format 16:9 ⇄ 9:16 Persistent Memory) */}
          <div className="flex items-center bg-slate-950 border border-slate-800 rounded-lg p-0.5 gap-0.5">
            <button
              type="button"
              onClick={() => handleSwitchAspectRatio('16:9')}
              className={`px-2 py-0.5 rounded text-[11px] font-bold transition cursor-pointer flex items-center gap-1 ${
                aspectRatio === '16:9'
                  ? 'bg-amber-500 text-slate-950 shadow'
                  : 'text-slate-400 hover:text-slate-200'
              }`}
              title={
                exportedMasterVideos['16:9']
                  ? `Versión 16:9 Horizontal (${exportedMasterVideos['16:9'].fileName} • ${exportedMasterVideos['16:9'].sizeMB} MB lista en 06_Video_Final)`
                  : 'Cambiar a vista y edición 16:9 Horizontal (conservando su diseño y textos)'
              }
            >
              <span>📺 16:9</span>
              {exportedMasterVideos['16:9'] && (
                <span className="text-[9px] px-1 rounded bg-emerald-500/30 text-emerald-200 font-black">
                  ✓
                </span>
              )}
            </button>
            <button
              type="button"
              onClick={() => handleSwitchAspectRatio('9:16')}
              className={`px-2 py-0.5 rounded text-[11px] font-bold transition cursor-pointer flex items-center gap-1 ${
                aspectRatio === '9:16'
                  ? 'bg-amber-500 text-slate-950 shadow'
                  : 'text-slate-400 hover:text-slate-200'
              }`}
              title={
                exportedMasterVideos['9:16']
                  ? `Versión 9:16 Vertical (${exportedMasterVideos['9:16'].fileName} • ${exportedMasterVideos['9:16'].sizeMB} MB lista en 06_Video_Final)`
                  : 'Cambiar a vista y edición 9:16 Vertical con Smart Auto-Reframe IA por clip'
              }
            >
              <span>📱 9:16</span>
              {exportedMasterVideos['9:16'] && (
                <span className="text-[9px] px-1 rounded bg-emerald-500/30 text-emerald-200 font-black">
                  ✓
                </span>
              )}
            </button>
          </div>

          {/* Quality / Resolution Selector: HD, 2K, 4K, 8K */}
          <div className="flex items-center bg-slate-950 border border-slate-800 rounded-lg p-0.5">
            {(['HD_1080P', '2K_1440P', '4K_2160P', '8K_4320P'] as ExportResolutionPreset[]).map(
              (resKey) => {
                const p = RESOLUTION_PRESETS[resKey];
                const isSel = exportResolution === resKey;
                return (
                  <button
                    key={resKey}
                    type="button"
                    onClick={() => handleUserSelectExportResolution(resKey)}
                    className={`px-2 py-0.5 rounded text-[11px] font-black transition cursor-pointer ${
                      isSel
                        ? 'bg-emerald-500 text-slate-950 shadow'
                        : 'text-slate-400 hover:text-slate-200'
                    }`}
                    title={p.label}
                  >
                    {p.badge.split(' ')[0]}
                  </button>
                );
              }
            )}
          </div>

          {/* Confirmed Folder from Stage 1 */}
          {downloadFolderName ? (
            <button
              type="button"
              onClick={async () => {
                if (onReloadFolderMedia) {
                  await onReloadFolderMedia();
                } else {
                  await onPickDownloadFolder();
                }
              }}
              className="px-2.5 py-1 rounded-lg text-[11px] font-bold flex items-center gap-1 border bg-emerald-950/60 hover:bg-emerald-900/70 border-emerald-500/40 text-emerald-300 cursor-pointer max-w-[190px] truncate"
              title={`Carpeta activa: ${downloadFolderName} (clic para recargar)`}
            >
              <FolderOpen className="w-3 h-3 text-emerald-400 shrink-0" />
              <span className="truncate">✓ {downloadFolderName}</span>
            </button>
          ) : (
            <button
              type="button"
              onClick={onPickDownloadFolder}
              className="px-2.5 py-1 rounded-lg text-[11px] font-bold flex items-center gap-1 border cursor-pointer bg-slate-900 border-amber-500/40 text-amber-300 hover:bg-slate-800"
            >
              <FolderOpen className="w-3 h-3" />
              📂 Carpeta
            </button>
          )}

          {/* Single Unified Download / Export Video Button -> Opens Export Settings Modal */}
          <button
            type="button"
            onClick={() => {
              if (!officialLogoUrl || !officialLogoUrl.trim()) {
                setActiveInspectorTab('branding');
                alert(
                  '🔒 Obligatorio: Primero debes subir el Logo Oficial de "Huellas de la Humanidad" en la pestaña "Logo y Textos" o en la Etapa 5 antes de renderizar y exportar el video.'
                );
                return;
              }
              setShowExportModal(true);
            }}
            className={`px-3 py-1 rounded-lg font-black text-[11px] flex items-center gap-1.5 cursor-pointer shadow-lg transition ${
              officialLogoUrl
                ? 'bg-teal-400 hover:bg-teal-300 text-slate-950 shadow-teal-500/20'
                : 'bg-rose-500/20 hover:bg-rose-500/30 border border-rose-500/50 text-rose-200'
            }`}
            title={
              officialLogoUrl
                ? 'Abrir ventana de configuración de calidad, FPS, bitrate y capas incrustadas para exportar el video'
                : '🔒 Obligatorio: Primero debes subir el Logo Oficial del canal antes de renderizar y descargar el video'
            }
          >
            <Download className="w-3.5 h-3.5" />
            {isRenderingVideo
              ? `Exportando ${renderProgressPct}% (~${formatTimeMMSS(renderRemainingSec)})...`
              : !officialLogoUrl
              ? '🔒 Subir Logo'
              : `Export (${activePreset.badge.split(' ')[0]} • ${exportFps}fps)`}
          </button>
        </div>
      </div>

      {/* =====================================================================
          EXPORT CONFIGURATION MODAL (QUALITY, FPS, BITRATE & BURNED-IN OVERLAYS)
      ===================================================================== */}
      {showExportModal && (
        <div
          onClick={() => setShowExportModal(false)}
          className="fixed inset-0 z-[280] bg-black/75 backdrop-blur-sm flex items-center justify-center p-4"
        >
          <div
            onClick={(e) => e.stopPropagation()}
            className="w-full max-w-md rounded-2xl bg-[#14110d] border border-amber-500/40 shadow-2xl shadow-black/90 overflow-hidden text-slate-100"
          >
            {/* Header */}
            <div className="px-4 py-3 bg-gradient-to-r from-amber-500/20 via-teal-500/15 to-slate-900 border-b border-amber-500/30 flex items-center justify-between">
              <div className="flex items-center gap-2">
                <span className="p-1.5 rounded-lg bg-teal-400 text-slate-950 font-black">
                  <Download className="w-4 h-4" />
                </span>
                <div>
                  <h3 className="text-sm font-black text-amber-200 leading-tight">
                    Configuración de Exportación Master
                  </h3>
                  <p className="text-[10px] text-slate-400">
                    {clipsWithTimelineBounds.length} segmentos • Duración total:{' '}
                    {formatTimeMMSS(totalDurationSec)}
                  </p>
                </div>
              </div>
              {/* The export runs on the server: the window can be minimized while it renders. */}
              <button
                type="button"
                onClick={() => setShowExportModal(false)}
                title={isRenderingVideo ? 'Minimizar: la exportación sigue en segundo plano' : 'Cerrar'}
                className="w-6 h-6 rounded-lg bg-slate-800/80 hover:bg-slate-700 text-slate-300 hover:text-white text-xs font-bold cursor-pointer flex items-center justify-center"
              >
                {isRenderingVideo ? '—' : '✕'}
              </button>
            </div>

            {/* Body */}
            <div className="p-4 space-y-3.5 text-xs">
              {/* 0. Formato Dual (16:9 Horizontal ⇄ 9:16 Vertical Auto-Reframe) */}
              <div>
                <div className="flex items-center justify-between mb-1.5">
                  <span className="text-[11px] font-black text-amber-300 uppercase tracking-wider">
                    Formato de Exportación (Ambos disponibles en 06_Video_Final)
                  </span>
                </div>
                <div className="grid grid-cols-2 gap-1.5">
                  <button
                    type="button"
                    disabled={isRenderingVideo}
                    onClick={() => handleSwitchAspectRatio('16:9')}
                    className={`py-2 px-2.5 rounded-xl border text-left transition cursor-pointer disabled:opacity-50 ${
                      aspectRatio === '16:9'
                        ? 'bg-amber-500/20 border-amber-400 text-amber-100 shadow-lg shadow-amber-500/10'
                        : 'bg-slate-950 border-slate-800 text-slate-400 hover:border-slate-700 hover:text-slate-200'
                    }`}
                  >
                    <div className="flex items-center justify-between">
                      <span className="font-black text-xs text-white">📺 16:9 Horizontal</span>
                      {exportedMasterVideos['16:9'] && (
                        <span className="text-[9px] px-1.5 py-0.5 rounded bg-emerald-500/25 border border-emerald-400/40 text-emerald-300 font-bold">
                          ✓ Exportado
                        </span>
                      )}
                    </div>
                    <div className="text-[9px] font-mono opacity-80 mt-0.5 truncate">
                      {exportedMasterVideos['16:9']
                        ? `${exportedMasterVideos['16:9'].fileName} (${exportedMasterVideos['16:9'].sizeMB} MB)`
                        : 'YouTube / Facebook Panorámico'}
                    </div>
                  </button>
                  <button
                    type="button"
                    disabled={isRenderingVideo}
                    onClick={() => handleSwitchAspectRatio('9:16')}
                    className={`py-2 px-2.5 rounded-xl border text-left transition cursor-pointer disabled:opacity-50 ${
                      aspectRatio === '9:16'
                        ? 'bg-amber-500/20 border-amber-400 text-amber-100 shadow-lg shadow-amber-500/10'
                        : 'bg-slate-950 border-slate-800 text-slate-400 hover:border-slate-700 hover:text-slate-200'
                    }`}
                  >
                    <div className="flex items-center justify-between">
                      <span className="font-black text-xs text-white">📱 9:16 Vertical IA</span>
                      {exportedMasterVideos['9:16'] && (
                        <span className="text-[9px] px-1.5 py-0.5 rounded bg-emerald-500/25 border border-emerald-400/40 text-emerald-300 font-bold">
                          ✓ Exportado
                        </span>
                      )}
                    </div>
                    <div className="text-[9px] font-mono opacity-80 mt-0.5 truncate">
                      {exportedMasterVideos['9:16']
                        ? `${exportedMasterVideos['9:16'].fileName} (${exportedMasterVideos['9:16'].sizeMB} MB)`
                        : 'Reels / TikTok / Shorts con Auto-Reframe'}
                    </div>
                  </button>
                </div>
              </div>

              {/* 1. Calidad / Resolución */}
              <div>
                <div className="flex items-center justify-between mb-1.5">
                  <span className="text-[11px] font-black text-amber-300 uppercase tracking-wider">
                    1. Calidad / Resolución ({aspectRatio})
                  </span>
                  <span className="text-[10px] font-mono text-emerald-300">
                    {aspectRatio === '16:9'
                      ? `${activePreset.width16x9} × ${activePreset.height16x9}`
                      : `${activePreset.width9x16} × ${activePreset.height9x16}`}{' '}
                    px
                  </span>
                </div>
                <div className="grid grid-cols-4 gap-1.5">
                  {(
                    ['HD_1080P', '2K_1440P', '4K_2160P', '8K_4320P'] as ExportResolutionPreset[]
                  ).map((resKey) => {
                    const p = RESOLUTION_PRESETS[resKey];
                    const isSel = exportResolution === resKey;
                    const dimLabel =
                      aspectRatio === '16:9'
                        ? `${p.width16x9}×${p.height16x9}`
                        : `${p.width9x16}×${p.height9x16}`;
                    return (
                      <button
                        key={resKey}
                        type="button"
                        disabled={isRenderingVideo}
                        onClick={() => handleUserSelectExportResolution(resKey)}
                        className={`py-2 px-1.5 rounded-xl border text-center transition cursor-pointer disabled:opacity-50 ${
                          isSel
                            ? 'bg-emerald-500/20 border-emerald-400 text-emerald-200 shadow-lg shadow-emerald-500/10'
                            : 'bg-slate-950 border-slate-800 text-slate-400 hover:border-slate-700 hover:text-slate-200'
                        }`}
                      >
                        <div className="font-black text-xs text-white">
                          {p.badge.split(' ')[0]}
                        </div>
                        <div className="text-[9px] font-mono opacity-80 mt-0.5">{dimLabel}</div>
                      </button>
                    );
                  })}
                </div>
              </div>

              {/* 2. Fotogramas por segundo (FPS) */}
              <div>
                <div className="flex items-center justify-between mb-1.5">
                  <span className="text-[11px] font-black text-amber-300 uppercase tracking-wider">
                    2. Fotogramas por Segundo (FPS)
                  </span>
                  <span className="text-[10px] font-mono text-slate-400">
                    {exportFps === 24
                      ? 'Look Cinematográfico'
                      : exportFps === 30
                      ? 'Estándar YouTube'
                      : 'Ultra Fluido 60Hz'}
                  </span>
                </div>
                <div className="grid grid-cols-3 gap-1.5">
                  {(
                    [
                      { fps: 24 as const, label: '24 FPS', sub: 'Cine Clásico' },
                      { fps: 30 as const, label: '30 FPS', sub: 'Recomendado YT' },
                      { fps: 60 as const, label: '60 FPS', sub: 'Ultra Fluido' },
                    ]
                  ).map((item) => {
                    const isSel = exportFps === item.fps;
                    return (
                      <button
                        key={item.fps}
                        type="button"
                        disabled={isRenderingVideo}
                        onClick={() => {
                          setExportFps(item.fps);
                          saveDocExportChoice({ fps: item.fps });
                        }}
                        className={`py-1.5 px-2 rounded-xl border text-center transition cursor-pointer disabled:opacity-50 ${
                          isSel
                            ? 'bg-amber-500/20 border-amber-400 text-amber-200 shadow'
                            : 'bg-slate-950 border-slate-800 text-slate-400 hover:border-slate-700 hover:text-slate-200'
                        }`}
                      >
                        <div className="font-black text-xs text-white">{item.label}</div>
                        <div className="text-[9px] opacity-80">{item.sub}</div>
                      </button>
                    );
                  })}
                </div>
              </div>

              {/* 3. Bitrate (Tasa de Bits en Mbps) */}
              <div>
                <div className="flex items-center justify-between mb-1.5">
                  <span className="text-[11px] font-black text-amber-300 uppercase tracking-wider">
                    3. Bitrate de Video (Mbps)
                  </span>
                  <span className="text-[10px] font-mono text-teal-300 font-bold">
                    {exportBitrateMbps} Mbps • Peso est.: ~
                    {(((exportBitrateMbps + 0.25) * Math.max(60, totalDurationSec)) / 8 / 1024).toFixed(
                      2
                    )}{' '}
                    GB
                  </span>
                </div>
                {(() => {
                  const tiers = getRecommendedBitratesForRes(exportResolution);
                  return (
                    <div className="grid grid-cols-3 gap-1.5 mb-2">
                      {(
                        [
                          { key: 'standard' as const, label: 'Estándar', val: tiers.standard },
                          {
                            key: 'recommended' as const,
                            label: 'Recomendado',
                            val: tiers.recommended,
                          },
                          { key: 'ultra' as const, label: 'Máxima Calidad', val: tiers.ultra },
                        ]
                      ).map((t) => {
                        const isSel =
                          exportBitrateTier === t.key && exportBitrateMbps === t.val;
                        return (
                          <button
                            key={t.key}
                            type="button"
                            disabled={isRenderingVideo}
                            onClick={() => {
                              setExportBitrateTier(t.key);
                              setExportBitrateMbps(t.val);
                              saveDocExportChoice({ tier: t.key, mbps: t.val });
                            }}
                            className={`py-1 px-2 rounded-lg border text-center transition cursor-pointer disabled:opacity-50 ${
                              isSel
                                ? 'bg-teal-500/20 border-teal-400 text-teal-200 font-black'
                                : 'bg-slate-950 border-slate-800 text-slate-400 hover:text-slate-200'
                            }`}
                          >
                            <div className="text-[10px] font-bold">{t.label}</div>
                            <div className="text-[9px] font-mono text-slate-300">{t.val} Mbps</div>
                          </button>
                        );
                      })}
                    </div>
                  );
                })()}
                <div className="flex items-center gap-2 bg-slate-950 border border-slate-800 rounded-xl px-3 py-1.5">
                  <input
                    type="range"
                    min={6}
                    max={240}
                    step={1}
                    disabled={isRenderingVideo}
                    value={exportBitrateMbps}
                    onChange={(e) => {
                      setExportBitrateTier('custom');
                      setExportBitrateMbps(Number(e.target.value));
                      saveDocExportChoice({ tier: 'custom', mbps: Number(e.target.value) });
                    }}
                    className="flex-1 accent-teal-400 cursor-pointer"
                  />
                  <div className="flex items-center gap-1">
                    <input
                      type="number"
                      min={4}
                      max={300}
                      disabled={isRenderingVideo}
                      value={exportBitrateMbps}
                      onChange={(e) => {
                        const typedMbps = Math.max(4, Math.min(300, Number(e.target.value) || 18));
                        setExportBitrateTier('custom');
                        setExportBitrateMbps(typedMbps);
                        saveDocExportChoice({ tier: 'custom', mbps: typedMbps });
                      }}
                      className="w-14 bg-slate-900 border border-slate-700 rounded px-1.5 py-0.5 text-right font-mono text-xs font-bold text-teal-300 outline-none"
                    />
                    <span className="text-[10px] font-mono text-slate-400">Mbps</span>
                  </div>
                </div>
              </div>

              {/* Live Render Progress Bar & Remaining Time Countdown Timer */}
              {(isRenderingVideo || renderStageLabel) && (
                <div className="bg-slate-950 border border-teal-500/40 rounded-xl p-2.5 space-y-2">
                  <div className="flex items-center justify-between text-[11px]">
                    <span className="font-bold text-teal-200 truncate pr-2">
                      {renderStageLabel || 'Procesando video...'}
                    </span>
                    <span className="font-mono font-black text-teal-300 shrink-0">
                      {renderProgressPct}%
                    </span>
                  </div>
                  <div className="w-full h-2 rounded-full bg-slate-900 overflow-hidden">
                    <div
                      style={{ width: `${Math.max(2, Math.min(100, renderProgressPct))}%` }}
                      className="h-full bg-gradient-to-r from-amber-400 via-emerald-400 to-teal-400 transition-all duration-300"
                    />
                  </div>
                  {isRenderingVideo && (
                    <div className="flex items-center justify-between gap-2 pt-0.5 text-[10px] font-mono">
                      <span className="px-2 py-0.5 rounded-md bg-slate-900 border border-slate-800 text-slate-300 flex items-center gap-1">
                        <Clock className="w-3 h-3 text-teal-400" />
                        <span>Transcurrido: {formatTimeMMSS(renderElapsedSec)}</span>
                      </span>
                      <span className="px-2 py-0.5 rounded-md bg-amber-500/15 border border-amber-500/40 text-amber-300 font-black flex items-center gap-1">
                        <span>⏳ Tiempo restante: ~{formatTimeMMSS(renderRemainingSec)}</span>
                      </span>
                    </div>
                  )}
                  {lastExportedOutputPath && !isRenderingVideo && (
                    <div className="text-[10px] font-mono text-emerald-300 break-all pt-1">
                      📂 Guardado en: {lastExportedOutputPath}
                    </div>
                  )}
                </div>
              )}
            </div>

            {/* Footer Actions */}
            <div className="px-4 py-3 bg-slate-950/90 border-t border-slate-800 flex flex-wrap items-center justify-end gap-2">
              <button
                type="button"
                onClick={() => setShowExportModal(false)}
                className="px-3.5 py-1.5 rounded-xl bg-slate-800 hover:bg-slate-700 disabled:opacity-50 text-slate-300 font-bold text-xs cursor-pointer transition"
              >
                {isRenderingVideo
                  ? 'Minimizar y seguir trabajando'
                  : lastExportedOutputPath
                  ? 'Cerrar'
                  : 'Cancelar'}
              </button>
              {isRenderingVideo && (
                <button
                  type="button"
                  disabled={isCancellingRender}
                  onClick={handleCancelExport}
                  className="px-3.5 py-1.5 rounded-xl bg-rose-600 hover:bg-rose-500 disabled:opacity-50 text-white font-black text-xs cursor-pointer transition"
                  title="Detener la exportación en curso (pide confirmación)"
                >
                  {isCancellingRender ? 'Cancelando...' : '🛑 Cancelar exportación'}
                </button>
              )}
              <button
                type="button"
                disabled={isRenderingVideo}
                onClick={handleExportMasterVideo}
                className="px-4 py-1.5 rounded-xl bg-gradient-to-r from-teal-400 to-emerald-400 hover:from-teal-300 hover:to-emerald-300 disabled:opacity-50 text-slate-950 font-black text-xs flex items-center gap-1.5 shadow-lg shadow-teal-500/20 cursor-pointer transition"
              >
                <Download className="w-3.5 h-3.5" />
                {isRenderingVideo
                  ? `Renderizando ${renderProgressPct}% • Restante ~${formatTimeMMSS(renderRemainingSec)}`
                  : `🚀 Renderizar y Exportar (${activePreset.badge.split(' ')[0]} • ${exportFps} FPS)`}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Editor notices: stacked one under another, 30 s each, clickable when they name a clip or the export */}
      {editorNotices.items.length > 0 && (
        <div className="fixed top-10 right-3 z-[220] w-[min(28rem,calc(100vw-1.5rem))] flex flex-col gap-1.5 pointer-events-none">
          {editorNotices.items.map((notice) => {
            const clipMatch = notice.text.match(/\b(?:Clip|B-Roll)\s*#?\s*0*(\d{1,3})\b/i);
            const clipTarget = clipMatch
              ? clipsWithTimelineBounds.find((c) => c.clipNumber === Number(clipMatch[1]) && c.clipNumber !== 999)
              : undefined;
            const isExportNotice = /export|renderiz/i.test(notice.text);
            const isError = notice.text.startsWith('⚠️');
            return (
              <div
                key={notice.id}
                className={`pointer-events-auto backdrop-blur border rounded-lg px-3 py-1.5 text-[11px] flex items-start justify-between gap-2 shadow-2xl ${
                  isError
                    ? 'bg-rose-950/95 border-rose-500/50 text-rose-100'
                    : 'bg-emerald-950/95 border-emerald-500/40 text-emerald-200'
                }`}
              >
                {clipTarget || isExportNotice ? (
                  <button
                    type="button"
                    title={
                      clipTarget
                        ? `Ir al Clip ${clipTarget.clipNumber} en el timeline`
                        : 'Abrir la ventana de exportación'
                    }
                    onClick={() => {
                      if (clipTarget) {
                        setSelectedClipId(clipTarget.id);
                        seekToTime(clipTarget.start || 0);
                      } else {
                        setShowExportModal(true);
                      }
                    }}
                    className="flex-1 min-w-0 text-left leading-snug underline decoration-dotted underline-offset-2 hover:text-white cursor-pointer"
                  >
                    {notice.text} →
                  </button>
                ) : (
                  <span className="flex-1 min-w-0 leading-snug">{notice.text}</span>
                )}
                <button
                  type="button"
                  onClick={() => {
                    editorNotices.dismiss(notice.id);
                    if (statusMessage === notice.text) setStatusMessage('');
                  }}
                  title="Cerrar aviso"
                  className="shrink-0 opacity-70 hover:opacity-100 hover:text-white cursor-pointer"
                >
                  ✕
                </button>
              </div>
            );
          })}
        </div>
      )}

      {/* =====================================================================
          UPPER 3-COLUMN CAPCUT WORKSPACE:
          [1] COMPACT LEFT MEDIA SIDEBAR  |  [2] DOMINANT CENTER VIDEO PLAYER  |  [3] COMPACT RIGHT DETAILS/INSPECTOR
          Left & Right columns are strictly locked to the exact vertical height of the Center Video Player and scroll internally.
      ===================================================================== */}
      <div className="relative flex-1 min-h-0 w-full flex flex-row items-stretch gap-1.5 p-1 bg-[#0e0c09] overflow-hidden">
        {/* =================================================================
            COLUMN 1: COMPACT CAPCUT-STYLE LEFT MEDIA & ASSETS PANEL
        ================================================================= */}
        {isLeftPanelCollapsed ? (
          <div className="hidden sm:flex w-8 h-full max-h-full shrink-0 bg-[#14110d] border border-slate-800/90 rounded-xl flex-col items-center py-2 gap-3 select-none">
            <button
              type="button"
              onClick={() => {
                setIsLeftPanelCollapsed(false);
                if (typeof window !== 'undefined' && window.innerWidth < 1024) {
                  setIsRightPanelCollapsed(true);
                }
              }}
              className="p-1 rounded-lg bg-slate-900 hover:bg-amber-500 text-amber-300 hover:text-slate-950 text-[10px] font-black cursor-pointer transition"
              title="Mostrar panel izquierdo de Media / Audio / Text"
            >
              ▶
            </button>
            <span className="[writing-mode:vertical-rl] rotate-180 text-[10px] font-bold tracking-widest text-slate-400 uppercase">
              Media • Audio • Text
            </span>
          </div>
        ) : (
          <div className="max-md:absolute max-md:inset-y-1 max-md:left-1 max-md:z-[140] max-md:w-[min(86vw,255px)] max-md:shadow-2xl w-[210px] lg:w-[230px] xl:w-[245px] h-full max-h-full shrink-0 bg-[#14110d] border border-slate-800/90 rounded-xl flex flex-col min-h-0 overflow-hidden">
            {/* CapCut Top Category Icon Strip (Media, Audio, Text, Transitions, Captions) */}
            <div className="px-1.5 py-1 bg-[#100d0a] border-b border-slate-800/90 flex items-center justify-between gap-0.5 shrink-0">
              {(
                [
                  { id: 'media', icon: '🎬', label: 'Media', inspector: 'clips' },
                  { id: 'audio', icon: '🎵', label: 'Audio', inspector: 'audio' },
                  { id: 'text', icon: '🔤', label: 'Text', inspector: 'branding' },
                  { id: 'transitions', icon: '🔀', label: 'Trans.', inspector: 'clips' },
                  { id: 'captions', icon: '💬', label: 'Captions', inspector: 'captions' },
                ] as const
              ).map((item) => {
                const isActive = leftPanelTab === item.id;
                return (
                  <button
                    key={item.id}
                    type="button"
                    onClick={() => {
                      setLeftPanelTab(item.id);
                      setActiveInspectorTab(item.inspector);
                    }}
                    className={`px-1.5 py-1 rounded-lg flex flex-col items-center justify-center gap-0.5 text-[9px] font-bold cursor-pointer transition ${
                      isActive
                        ? 'text-teal-300 bg-teal-500/15 border border-teal-500/40'
                        : 'text-slate-400 hover:text-slate-200'
                    }`}
                    title={item.label}
                  >
                    <span className="text-xs leading-none">{item.icon}</span>
                    <span className="leading-none">{item.label}</span>
                  </button>
                );
              })}
              <button
                type="button"
                onClick={() => setIsLeftPanelCollapsed(true)}
                className="p-1 rounded hover:bg-slate-800 text-slate-400 hover:text-amber-300 text-[10px] cursor-pointer"
                title="Ocultar panel izquierdo para dar aún más espacio al Visor de Video"
              >
                ◀
              </button>
            </div>

            {/* Sub-bar: + Import & Reload Folder */}
            <div className="px-2.5 py-1.5 border-b border-slate-800/70 flex items-center justify-between gap-1.5 shrink-0">
              <label className="px-2.5 py-1 rounded-md bg-teal-400 hover:bg-teal-300 text-slate-950 font-black text-[11px] cursor-pointer flex items-center gap-1 shadow">
                <span>＋</span>
                <span>Import</span>
                <input
                  type="file"
                  accept="video/mp4,video/*,audio/*"
                  multiple
                  onChange={(e) => handleImportMp4FilesToTimeline(e.target.files)}
                  className="hidden"
                />
              </label>
              <span className="text-[11px] text-slate-300 font-bold truncate">
                All ({timelineClips.length + musicTracks.length + (effectiveVoiceoverUrl ? 2 : 1)})
              </span>
            </div>

            {/* Large CapCut Media Library Vertical Scroll List */}
            <div className="flex-1 min-h-0 overflow-y-auto overflow-x-hidden p-2 space-y-2.5">
              {/* Asset 1: Official Channel Logo */}
              <div
                onClick={() => {
                  setSelectedCanvasObject('logo');
                  setActiveInspectorTab('branding');
                }}
                className={`w-full shrink-0 group relative rounded-xl border overflow-hidden cursor-pointer bg-[#0b0907] transition ${
                  selectedCanvasObject === 'logo'
                    ? 'border-amber-400 ring-1 ring-amber-400'
                    : 'border-slate-800 hover:border-amber-500/60'
                }`}
                title="Seleccionar Logo Oficial en el Visor"
              >
                <div className="h-24 lg:h-28 w-full flex items-center justify-center p-2.5 bg-gradient-to-b from-amber-950/30 to-black relative">
                  <span className="absolute top-1.5 left-1.5 px-1.5 py-0.5 rounded bg-black/85 text-[10px] font-bold text-slate-100 shadow">
                    Added
                  </span>
                  {officialLogoUrl ? (
                    <img
                      src={officialLogoUrl}
                      alt="Logo Oficial"
                      className="max-h-full max-w-full object-contain"
                    />
                  ) : (
                    <span className="text-xs text-amber-300 font-bold text-center">
                      🏷️ LOGO OFICIAL
                    </span>
                  )}
                </div>
                <div className="px-2.5 py-1.5 text-[11px] font-semibold text-slate-200 truncate bg-[#120f0c]">
                  LOGO DEFINITIVO.png
                </div>
              </div>

              {/* Asset 2: Master Voiceover Audio Card (CapCut Blue Waveform Style) */}
              {effectiveVoiceoverUrl && (
                <div
                  onClick={() => {
                    seekToTime(voiceStartOffsetSec);
                    setActiveInspectorTab('audio');
                  }}
                  className="w-full shrink-0 group relative rounded-xl border border-slate-800 hover:border-sky-400/70 overflow-hidden cursor-pointer bg-[#0b0907] transition"
                  title="Ir a la Voz Narrativa Maestro"
                >
                  <div className="h-24 lg:h-28 w-full bg-[#101824] relative flex items-end px-2 pt-7 pb-1.5 gap-[2px] overflow-hidden">
                    <span className="absolute top-1.5 left-1.5 px-1.5 py-0.5 rounded bg-black/85 text-[10px] font-bold text-slate-100 z-10 shadow">
                      Added
                    </span>
                    <span className="absolute top-1.5 right-1.5 px-1.5 py-0.5 rounded bg-black/80 text-[10px] font-mono font-bold text-sky-200 z-10 shadow">
                      {formatTimeMMSS(effectiveVoiceDurationSec)}
                    </span>
                    {[55, 80, 65, 92, 74, 88, 60, 95, 78, 85, 70, 90, 62, 84, 72, 91, 66, 83, 77, 89].map((h, i) => (
                      <div
                        key={i}
                        style={{ height: `${h}%` }}
                        className="flex-1 bg-sky-400/85 rounded-t-[2px]"
                      />
                    ))}
                  </div>
                  <div className="px-2.5 py-1.5 text-[11px] font-semibold text-slate-200 truncate bg-[#120f0c]">
                    🎙️ Voz_Narrativa.mp3
                  </div>
                </div>
              )}

              {/* Assets 3+: Flow Music Tracks (CapCut Blue Waveform Style) */}
              {musicTracks.map((mt) => (
                <div
                  key={`left-mt-${mt.id}`}
                  onClick={() => {
                    seekToTime(mt.start);
                    setActiveInspectorTab('audio');
                  }}
                  className="w-full shrink-0 group relative rounded-xl border border-slate-800 hover:border-purple-400/70 overflow-hidden cursor-pointer bg-[#0b0907] transition"
                  title={`${mt.title} (${formatTimeMMSS(mt.start)} - ${formatTimeMMSS(mt.start + mt.duration)})`}
                >
                  <div className="h-24 lg:h-28 w-full bg-[#131c2b] relative flex items-end px-2 pt-7 pb-1.5 gap-[2px] overflow-hidden">
                    <span className="absolute top-1.5 left-1.5 px-1.5 py-0.5 rounded bg-black/85 text-[10px] font-bold text-slate-100 z-10 shadow">
                      Added
                    </span>
                    <span className="absolute top-1.5 right-1.5 px-1.5 py-0.5 rounded bg-black/80 text-[10px] font-mono font-bold text-sky-200 z-10 shadow">
                      {formatTimeMMSS(mt.duration)}
                    </span>
                    {[45, 70, 88, 62, 75, 94, 82, 58, 72, 90, 68, 52, 78, 64, 85, 73, 91, 60, 79, 86].map((h, i) => (
                      <div
                        key={i}
                        style={{ height: `${h}%` }}
                        className="flex-1 bg-sky-500/80 rounded-t-[2px]"
                      />
                    ))}
                  </div>
                  <div className="px-2.5 py-1.5 text-[11px] font-semibold text-slate-200 truncate bg-[#120f0c]">
                    Pista {mt.trackNumber} {mt.title}
                  </div>
                </div>
              ))}

              {/* Assets: Timeline Video Clips (Large 16:9 Preview Cards with Vertical Scroll & Multi-Select) */}
              {clipsWithTimelineBounds.map((clip, clipIdx) => {
                const isCurr = currentTime >= clip.start && currentTime < clip.end;
                const isMultiSel = selectedClipIds.includes(clip.id);
                const isSelected = isMultiSel || selectedClipId === clip.id;
                const thumb = resolvePosterThumbSrc(clip);
                const isCardIntroOrOutro =
                  clip.id === 'fixed-doc-intro' ||
                  clip.id === 'fixed-doc-outro' ||
                  clip.clipNumber === 0 ||
                  clip.clipNumber === 999;
                return (
                  <div
                    key={`left-clip-${clip.id}`}
                    onClick={(e) => {
                      if (e.metaKey || e.ctrlKey) {
                        setSelectedClipIds((prev) => {
                          const base = prev.length > 0 ? prev : selectedClipId ? [selectedClipId] : [];
                          const exists = base.includes(clip.id);
                          const next = exists
                            ? base.filter((id) => id !== clip.id)
                            : [...base, clip.id];
                          return next.length > 0 ? next : [clip.id];
                        });
                        setSelectedClipId(clip.id);
                      } else if (e.shiftKey && selectedClipId) {
                        const anchorIdx = clipsWithTimelineBounds.findIndex(
                          (c) => c.id === selectedClipId
                        );
                        if (anchorIdx >= 0) {
                          const sIdx = Math.min(anchorIdx, clipIdx);
                          const eIdx = Math.max(anchorIdx, clipIdx);
                          setSelectedClipIds(
                            clipsWithTimelineBounds.slice(sIdx, eIdx + 1).map((c) => c.id)
                          );
                        } else {
                          setSelectedClipIds([clip.id]);
                        }
                        setSelectedClipId(clip.id);
                      } else {
                        setSelectedClipId(clip.id);
                        setSelectedClipIds([clip.id]);
                        seekToTime(clip.start);
                      }
                    }}
                    onContextMenu={(e) => {
                      e.preventDefault();
                      e.stopPropagation();
                      const targetIds =
                        selectedClipIds.length > 0 && selectedClipIds.includes(clip.id)
                          ? selectedClipIds
                          : [clip.id];
                      if (!selectedClipIds.includes(clip.id)) {
                        setSelectedClipId(clip.id);
                        setSelectedClipIds([clip.id]);
                      }
                      setClipContextMenu({
                        x: e.clientX,
                        y: e.clientY,
                        clipIds: targetIds,
                        showSepararSubmenu: true,
                      });
                    }}
                    className={`w-full shrink-0 group relative rounded-xl border overflow-hidden cursor-pointer bg-[#0b0907] transition ${
                      isMultiSel && selectedClipIds.length > 1
                        ? 'border-emerald-400 ring-2 ring-emerald-400/70 shadow-lg shadow-emerald-500/20'
                        : isCurr || isSelected
                        ? 'border-amber-400 ring-1 ring-amber-400 shadow-lg shadow-amber-500/15'
                        : 'border-slate-800 hover:border-amber-500/60'
                    }`}
                    title={`Clip ${String(clip.clipNumber).padStart(2, '0')} (${formatTimeMMSS(clip.start)} - ${formatTimeMMSS(clip.end)}) • Cmd/Ctrl+Clic o Shift+Clic para seleccionar varios clips`}
                  >
                    <div className="h-24 lg:h-28 w-full bg-black relative overflow-hidden flex items-center justify-center">
                      {thumb ? (
                        <img
                          src={thumb}
                          alt={clip.fileName}
                          className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-300"
                          onError={(e) => {
                            const imgEl = e.currentTarget;
                            const failedSrc = imgEl.currentSrc || thumb || '';
                            if (
                              isCardIntroOrOutro &&
                              officialLogoUrl &&
                              !imgEl.dataset.fbApplied
                            ) {
                              imgEl.dataset.fbApplied = '1';
                              imgEl.src = officialLogoUrl;
                            }
                            if (/^https?:\/\//i.test(failedSrc)) {
                              void verifyMediaBridgeHealthOrRefresh(failedSrc);
                            }
                          }}
                        />
                      ) : (
                        <span className="text-xs text-amber-300/90 font-bold">
                          🎬 CLIP {String(clip.clipNumber).padStart(2, '0')}
                        </span>
                      )}
                      <span className="absolute top-1.5 left-1.5 px-1.5 py-0.5 rounded bg-black/85 text-[10px] font-bold text-slate-100 shadow">
                        Added
                      </span>
                      <span className="absolute top-1.5 right-1.5 px-1.5 py-0.5 rounded bg-black/85 text-[10px] font-mono font-bold text-amber-200 shadow">
                        {formatTimeMMSS(clip.duration)}
                      </span>
                      <span className="absolute bottom-1.5 left-1.5 px-1.5 py-0.5 rounded bg-amber-500/90 text-slate-950 text-[10px] font-black shadow">
                        {clip.clipNumber === 0
                          ? 'INTRO'
                          : clip.clipNumber === 999
                          ? 'OUTRO'
                          : `#${String(clip.clipNumber).padStart(2, '0')}`}
                      </span>
                    </div>
                    <div className="px-2.5 py-1.5 text-[11px] font-semibold text-slate-200 truncate bg-[#120f0c]">
                      {clip.clipNumber === 0
                        ? 'INTRO 8K.mp4'
                        : clip.clipNumber === 999
                        ? 'OUTRO 8K.mp4'
                        : `Clip ${String(clip.clipNumber).padStart(2, '0')}${clip.partLabel ? ` (${clip.partLabel})` : ''} • ${clip.fileName}`}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {/* =================================================================
            COLUMN 2: DOMINANT CENTER VIDEO PLAYER (MAXIMIZED VIEWPORT AREA)
        ================================================================= */}
        <div className="flex-1 min-w-0 min-h-0 h-full max-h-full flex flex-col bg-[#080705] border border-slate-800/90 rounded-xl overflow-hidden">
          {/* Clip size bar: enlarge / shrink the clip under the playhead inside the frame (saved per format) */}
          {(showFramingBars || selectedCanvasObject === 'clip') &&
            activeClipAtPlayhead &&
            activeClipAtPlayhead.clipNumber !== 0 &&
            activeClipAtPlayhead.clipNumber !== 999 &&
            activeClipAtPlayhead.id !== 'fixed-doc-intro' &&
            activeClipAtPlayhead.id !== 'fixed-doc-outro' &&
            (() => {
              const zoomClip = activeClipAtPlayhead;
              const zoomElapsed = getClipElapsedAtPlayhead(zoomClip);
              const zoomFrameNow = getClipFrameAt(zoomClip, aspectRatio, zoomElapsed);
              const zoomPct = Math.round(zoomFrameNow.z);
              const zoomKeys = getClipFrameKeys(zoomClip, aspectRatio);
              return (
                <div
                  // Using this bar must not deselect the clip in the viewer: when the bar is shown only because
                  // the clip is selected, deselecting on mouse-down removed the bar before the click landed.
                  data-keep-canvas-selection="true"
                  className="w-full px-3 py-1 bg-[#100e0b] border-b border-slate-800 flex items-center gap-2 flex-wrap shrink-0 text-[10px]"
                >
                  <span
                    className="px-2 py-0.5 rounded bg-slate-900 border border-slate-700 text-slate-200 font-black"
                    title="Agranda el clip para mostrar menos (más cerca) o achícalo para mostrar más. Se guarda por clip y por formato (16:9 / 9:16) y se aplica al exportar."
                  >
                    🔍 Tamaño • Clip {String(zoomClip.clipNumber).padStart(2, '0')}
                  </span>
                  <button
                    type="button"
                    onClick={() => handleUpdateClipFrameZoom(zoomClip.id, zoomPct - 5, true)}
                    disabled={zoomPct <= FRAME_ZOOM_MIN_PCT}
                    className="w-6 h-5 rounded bg-slate-900 hover:bg-slate-800 border border-slate-700 text-slate-200 font-black cursor-pointer disabled:opacity-40"
                    title="Achicar el clip (muestra más)"
                  >
                    −
                  </button>
                  <input
                    type="range"
                    min={FRAME_ZOOM_MIN_PCT}
                    max={FRAME_ZOOM_MAX_PCT}
                    step={1}
                    value={zoomPct}
                    onChange={(e) => handleUpdateClipFrameZoom(zoomClip.id, Number(e.target.value), false)}
                    onMouseUp={(e) => handleUpdateClipFrameZoom(zoomClip.id, Number((e.target as HTMLInputElement).value), true)}
                    onTouchEnd={(e) => handleUpdateClipFrameZoom(zoomClip.id, Number((e.target as HTMLInputElement).value), true)}
                    onKeyUp={(e) => handleUpdateClipFrameZoom(zoomClip.id, Number((e.target as HTMLInputElement).value), true)}
                    className="flex-1 min-w-[90px] max-w-[260px] accent-amber-400 cursor-pointer"
                    aria-label="Tamaño del clip en el cuadro"
                  />
                  <button
                    type="button"
                    onClick={() => handleUpdateClipFrameZoom(zoomClip.id, zoomPct + 5, true)}
                    disabled={zoomPct >= FRAME_ZOOM_MAX_PCT}
                    className="w-6 h-5 rounded bg-slate-900 hover:bg-slate-800 border border-slate-700 text-slate-200 font-black cursor-pointer disabled:opacity-40"
                    title="Agrandar el clip (muestra menos)"
                  >
                    +
                  </button>
                  <span className="w-10 text-right font-mono font-bold text-amber-200">{zoomPct}%</span>
                  <button
                    type="button"
                    onClick={() => handleResetClipFrame(zoomClip)}
                    disabled={
                      zoomKeys.length === 0 && zoomPct === 100 && zoomFrameNow.x === 0 && zoomFrameNow.y === 0
                    }
                    className="px-2 py-0.5 rounded bg-slate-900 hover:bg-slate-800 border border-slate-700 text-slate-300 font-bold cursor-pointer disabled:opacity-40"
                    title="Volver al tamaño normal (100%), al centro y sin puntos"
                  >
                    Restablecer
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      if (isPlaying) handleTogglePlay();
                      setSelectedCanvasObject(selectedCanvasObject === 'clip' ? null : 'clip');
                    }}
                    className={`px-2 py-0.5 rounded border font-bold cursor-pointer ${
                      selectedCanvasObject === 'clip'
                        ? 'bg-amber-500 text-slate-950 border-amber-400'
                        : 'bg-slate-900 hover:bg-slate-800 border-slate-700 text-slate-300'
                    }`}
                    title="Selecciona el clip en el visor para moverlo y cambiarle el tamaño con las esquinas (también con un clic sobre el visor)"
                  >
                    ✥ Mover en el visor
                  </button>
                  {(aspectRatio === '16:9' || aspectRatio === '9:16') && (
                    <>
                      <button
                        type="button"
                        onClick={() => handleAddClipFrameKey(zoomClip)}
                        disabled={
                          zoomKeys.length >= MAX_CLIP_FRAME_KEYS &&
                          !zoomKeys.some((k) => Math.abs(k.t - zoomElapsed) <= FRAME_KEY_SNAP_SEC)
                        }
                        className="px-2 py-0.5 rounded bg-slate-900 hover:bg-slate-800 border border-amber-500/50 text-amber-200 font-bold cursor-pointer disabled:opacity-40"
                        title="Fija un punto en este instante del clip con el tamaño y la posición que se ven ahora. Con dos o más puntos, el clip hace el paneo o el zoom de un punto al siguiente; el último punto es el encuadre final."
                      >
                        ◆ Fijar punto
                      </button>
                      {zoomKeys.map((k, keyIdx) => {
                        const isAtKey = Math.abs(k.t - zoomElapsed) <= FRAME_KEY_SNAP_SEC;
                        return (
                          <span
                            key={`${k.t}-${keyIdx}`}
                            className={`inline-flex items-center rounded border font-mono font-bold ${
                              isAtKey
                                ? 'bg-amber-500 text-slate-950 border-amber-400'
                                : 'bg-slate-900 text-amber-200 border-slate-700'
                            }`}
                          >
                            <button
                              type="button"
                              onClick={() => {
                                if (isPlaying) handleTogglePlay();
                                seekToTime(zoomClip.start + k.t + 0.001);
                              }}
                              className="px-1.5 py-0.5 cursor-pointer"
                              title={`Punto ${keyIdx + 1}: segundo ${k.t.toFixed(1)} del clip • ${Math.round(k.z)}% • X ${k.x.toFixed(0)} Y ${k.y.toFixed(0)}. Clic para ir a este punto y ajustarlo.`}
                            >
                              ◆ {k.t.toFixed(1)}s
                            </button>
                            <button
                              type="button"
                              onClick={() => handleRemoveClipFrameKey(zoomClip, keyIdx)}
                              className="px-1 py-0.5 cursor-pointer opacity-70 hover:opacity-100"
                              title="Quitar este punto"
                              aria-label={`Quitar el punto ${keyIdx + 1}`}
                            >
                              ✕
                            </button>
                          </span>
                        );
                      })}
                    </>
                  )}
                </div>
              );
            })()}

          {/* Smart Auto-Reframe 9:16 Control Bar (Visible when editing in 9:16 Vertical mode) */}
          {aspectRatio === '9:16' && showFramingBars && (
            <div
              data-keep-canvas-selection="true"
              className="w-full px-3 py-1 bg-[#14100b] border-b border-amber-500/30 flex items-center justify-between gap-2 flex-wrap shrink-0 text-[10px]"
            >
              <div className="flex items-center gap-1.5 flex-wrap">
                <button
                  type="button"
                  onClick={() => {
                    if (!activeDoc) return;
                    const next = !showIntroOutro916;
                    updateActiveDoc({
                      promptConfig: {
                        ...(activeDoc.promptConfig || {}),
                        MOSTRAR_INTRO_OUTRO_9X16: next,
                      } as any,
                    });
                    setStatusMessage(
                      next
                        ? '🎬 Reel 9:16: intro y outro activados (vista previa y exportación).'
                        : '✂️ Reel 9:16: intro y outro quitados (vista previa y exportación). El 16:9 no cambia.'
                    );
                  }}
                  aria-pressed={showIntroOutro916}
                  className={`px-2 py-0.5 rounded border font-black cursor-pointer transition ${
                    showIntroOutro916
                      ? 'bg-emerald-950/80 border-emerald-500/60 text-emerald-300 hover:bg-emerald-900/80'
                      : 'bg-rose-950/80 border-rose-500/60 text-rose-300 hover:bg-rose-900/80'
                  }`}
                  title="Poner o quitar el intro y el outro oficiales solo en el Reel 9:16 (se guarda en este documental)"
                >
                  {showIntroOutro916 ? '🎬 Intro/Outro: Sí' : '✂️ Intro/Outro: No'}
                </button>
                <span className="px-2 py-0.5 rounded bg-amber-500/20 border border-amber-500/40 text-amber-200 font-black">
                  📱 Encuadre 9:16{' '}
                  {activeClipAtPlayhead
                    ? activeClipAtPlayhead.clipNumber === 0
                      ? '• Intro'
                      : activeClipAtPlayhead.clipNumber === 999
                      ? '• Outro'
                      : `• Clip ${String(activeClipAtPlayhead.clipNumber).padStart(2, '0')}`
                    : ''}
                </span>
                {activeClipAtPlayhead && (
                  <span
                    className="px-2 py-0.5 rounded bg-slate-900 border border-slate-700 text-teal-300 font-mono font-bold"
                    title={
                      activeClipAtPlayhead.reframeReason ||
                      'Posición horizontal del recorte vertical 9:16 sobre el clip 16:9 original'
                    }
                  >
                    {activeClipAtPlayhead.reframe9x16Mode === 'fit_blur'
                      ? '🖼️ Encajar 16:9 Completo'
                      : activeClipAtPlayhead.reframe9x16Mode === 'auto_pan'
                      ? `↔️ Auto-Pan IA (${Math.round(activeClipAtPlayhead.reframeFocusXStart ?? 50)}% → ${Math.round(activeClipAtPlayhead.reframeFocusXEnd ?? 50)}%)`
                      : activeClipAtPlayhead.reframe9x16Mode === 'auto_focus'
                      ? `🎯 Auto-Foco IA (${Math.round(activeClipAtPlayhead.reframeFocusXStart ?? 50)}%)`
                      : activeClipAtPlayhead.reframe9x16Mode === 'manual'
                      ? `✋ Manual (${Math.round(activeClipAtPlayhead.reframeFocusXStart ?? 50)}%)`
                      : `🎯 Centro (${Math.round(activeClipAtPlayhead.reframeFocusXStart ?? 50)}%)`}
                  </span>
                )}
                {activeClipAtPlayhead && (
                  <div className="flex items-center gap-1 bg-slate-950 border border-slate-800 rounded-lg p-0.5">
                    <button
                      type="button"
                      onClick={() =>
                        handleUpdateClipReframe9x16(activeClipAtPlayhead.id, {
                          reframe9x16Mode: 'manual',
                          reframeFocusXStart: 25,
                          reframeFocusXEnd: 25,
                          reframeReason: 'Enfoque manual tercio izquierdo (25%)',
                        })
                      }
                      className={`px-1.5 py-0.5 rounded font-bold cursor-pointer transition ${
                        activeClipAtPlayhead.reframe9x16Mode !== 'fit_blur' &&
                        Math.abs((activeClipAtPlayhead.reframeFocusXStart ?? 50) - 25) <= 6 &&
                        Math.abs(
                          (activeClipAtPlayhead.reframeFocusXEnd ??
                            activeClipAtPlayhead.reframeFocusXStart ??
                            50) - 25
                        ) <= 6
                          ? 'bg-amber-500 text-slate-950'
                          : 'text-slate-300 hover:bg-slate-800'
                      }`}
                      title="Enfocar tercio izquierdo (25%) en este clip"
                    >
                      ⬅️ Izq
                    </button>
                    <button
                      type="button"
                      onClick={() =>
                        handleUpdateClipReframe9x16(activeClipAtPlayhead.id, {
                          reframe9x16Mode: 'auto_center',
                          reframeFocusXStart: 50,
                          reframeFocusXEnd: 50,
                          reframeReason: 'Encuadre central (50%)',
                        })
                      }
                      className={`px-1.5 py-0.5 rounded font-bold cursor-pointer transition ${
                        activeClipAtPlayhead.reframe9x16Mode !== 'fit_blur' &&
                        Math.abs((activeClipAtPlayhead.reframeFocusXStart ?? 50) - 50) <= 5 &&
                        Math.abs(
                          (activeClipAtPlayhead.reframeFocusXEnd ??
                            activeClipAtPlayhead.reframeFocusXStart ??
                            50) - 50
                        ) <= 5
                          ? 'bg-amber-500 text-slate-950'
                          : 'text-slate-300 hover:bg-slate-800'
                      }`}
                      title="Centrar recorte vertical al 50% en este clip"
                    >
                      🎯 Centro
                    </button>
                    <button
                      type="button"
                      onClick={() =>
                        handleUpdateClipReframe9x16(activeClipAtPlayhead.id, {
                          reframe9x16Mode: 'manual',
                          reframeFocusXStart: 75,
                          reframeFocusXEnd: 75,
                          reframeReason: 'Enfoque manual tercio derecho (75%)',
                        })
                      }
                      className={`px-1.5 py-0.5 rounded font-bold cursor-pointer transition ${
                        activeClipAtPlayhead.reframe9x16Mode !== 'fit_blur' &&
                        Math.abs((activeClipAtPlayhead.reframeFocusXStart ?? 50) - 75) <= 6 &&
                        Math.abs(
                          (activeClipAtPlayhead.reframeFocusXEnd ??
                            activeClipAtPlayhead.reframeFocusXStart ??
                            50) - 75
                        ) <= 6
                          ? 'bg-amber-500 text-slate-950'
                          : 'text-slate-300 hover:bg-slate-800'
                      }`}
                      title="Enfocar tercio derecho (75%) en este clip"
                    >
                      Der ➡️
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        const curS = activeClipAtPlayhead.reframeFocusXStart ?? 50;
                        const curE = activeClipAtPlayhead.reframeFocusXEnd ?? curS;
                        const isLeftToRight = curS < 40 && curE > 60;
                        handleUpdateClipReframe9x16(activeClipAtPlayhead.id, {
                          reframe9x16Mode: 'auto_pan',
                          reframeFocusXStart: isLeftToRight ? 72 : 28,
                          reframeFocusXEnd: isLeftToRight ? 28 : 72,
                          reframeReason: isLeftToRight
                            ? 'Paneo dinámico Derecha → Izquierda (72% → 28%)'
                            : 'Paneo dinámico Izquierda → Derecha (28% → 72%)',
                        });
                      }}
                      className={`px-1.5 py-0.5 rounded font-bold cursor-pointer transition ${
                        activeClipAtPlayhead.reframe9x16Mode === 'auto_pan'
                          ? 'bg-teal-400 text-slate-950'
                          : 'text-slate-300 hover:bg-slate-800'
                      }`}
                      title="Aplicar paneo horizontal suave durante este clip (clic de nuevo para invertir dirección)"
                    >
                      ↔️ Paneo
                    </button>
                    <button
                      type="button"
                      onClick={() =>
                        handleUpdateClipReframe9x16(activeClipAtPlayhead.id, {
                          reframe9x16Mode:
                            activeClipAtPlayhead.reframe9x16Mode === 'fit_blur'
                              ? 'auto_center'
                              : 'fit_blur',
                          reframeReason:
                            activeClipAtPlayhead.reframe9x16Mode === 'fit_blur'
                              ? 'Encuadre central (50%)'
                              : 'Mostrar ancho 16:9 completo sin recortar',
                        })
                      }
                      className={`px-1.5 py-0.5 rounded font-bold cursor-pointer transition ${
                        activeClipAtPlayhead.reframe9x16Mode === 'fit_blur'
                          ? 'bg-purple-400 text-slate-950'
                          : 'text-slate-300 hover:bg-slate-800'
                      }`}
                      title="Mostrar el clip 16:9 completo dentro del marco vertical (ideal para títulos anchos)"
                    >
                      🖼️ Encajar
                    </button>
                  </div>
                )}
                {activeClipAtPlayhead && activeClipAtPlayhead.reframe9x16Mode !== 'fit_blur' && (
                  <div className="flex items-center gap-1 bg-slate-950 border border-slate-800 rounded-lg px-2 py-0.5">
                    <span className="text-slate-400">Foco X:</span>
                    <input
                      type="range"
                      min={10}
                      max={90}
                      step={1}
                      value={Math.round(activeClipAtPlayhead.reframeFocusXStart ?? 50)}
                      onChange={(e) => {
                        const val = Number(e.target.value);
                        handleUpdateClipReframe9x16(activeClipAtPlayhead.id, {
                          reframe9x16Mode: 'manual',
                          reframeFocusXStart: val,
                          reframeFocusXEnd: val,
                          reframeReason: `Enfoque manual (${val}%)`,
                        });
                      }}
                      className="w-20 accent-amber-400 cursor-pointer"
                      title="Desliza para mover el enfoque horizontal del clip actual en 9:16"
                    />
                    <span className="font-mono text-amber-300 w-7 text-right">
                      {Math.round(activeClipAtPlayhead.reframeFocusXStart ?? 50)}%
                    </span>
                  </div>
                )}
              </div>

              <div className="flex items-center gap-1.5">
                {reframeSummary9x16 && (
                  <span className="text-[10px] text-emerald-300 font-semibold hidden xl:inline">
                    {reframeSummary9x16}
                  </span>
                )}
                <button
                  type="button"
                  disabled={isAnalyzingReframe9x16}
                  onClick={() => handleRunSmartAutoReframe9x16(true)}
                  className={`px-2.5 py-0.5 rounded-lg border font-black cursor-pointer shadow transition flex items-center gap-1 disabled:opacity-60 ${
                    isAnalyzingReframe9x16
                      ? 'bg-sky-500 border-sky-300 text-slate-950 animate-pulse'
                      : isAutoReframe9x16Activated
                      ? 'bg-emerald-500 hover:bg-emerald-400 border-emerald-300 text-slate-950 shadow-emerald-500/30 ring-1 ring-emerald-300/60'
                      : 'bg-amber-500 hover:bg-amber-400 border-amber-300 text-slate-950 shadow-amber-500/20'
                  }`}
                  title={
                    isAutoReframe9x16Activated
                      ? '✅ Auto-Reframe 9:16 ya está activo en los clips de este documental (haz clic si deseas volver a analizar todos los clips con IA)'
                      : 'Analizar automáticamente todos los clips del documental con Visión IA Local para encontrar el mejor enfoque o paneo 9:16 en cada escena'
                  }
                >
                  <Sparkles className="w-3 h-3" />
                  <span>
                    {isAnalyzingReframe9x16
                      ? 'Analizando Clips IA...'
                      : isAutoReframe9x16Activated
                      ? '✅ Auto-Reframe IA Activo'
                      : '✨ Auto-Reframe IA (Todos)'}
                  </span>
                </button>
              </div>
            </div>
          )}

          {/* Aspect-Ratio Locked Video Container (Maximized to fill available center stage height & width) */}
          <div
            ref={viewerContainerRef}
            className={`${
              isViewerFullscreen
                ? 'relative w-screen h-screen bg-black flex flex-col justify-center'
                : 'flex-1 min-h-0 w-full flex flex-col'
            } overflow-hidden bg-black`}
          >
            {/* Dynamic Stage Wrapper that measures exact available width/height so the 16:9 or 9:16 video is as large as possible */}
            <div
              ref={viewerStageRef}
              className={
                isViewerFullscreen
                  ? 'w-full h-full flex items-center justify-center'
                  : 'flex-1 min-h-0 w-full flex items-center justify-center p-1 bg-[#050403] overflow-hidden relative'
              }
            >
              <div
                ref={viewerCanvasRef}
                onMouseDown={() => {
                  if (selectedCanvasObject !== null) {
                    if (document.activeElement instanceof HTMLElement) {
                      document.activeElement.blur();
                    }
                  }
                }}
                onClick={() => {
                  if (selectedCanvasObject === 'clip') {
                    // Clicking outside the clip box only leaves the move/resize mode
                    setSelectedCanvasObject(null);
                    return;
                  }
                  if (selectedCanvasObject !== null) {
                    setSelectedCanvasObject(null);
                    handleTogglePlay();
                    return;
                  }
                  // One click on the picture selects the clip to move / resize it (it pauses if playing).
                  // Intro, outro and fullscreen keep the plain play / pause click.
                  const clickedClip = activeClipAtPlayhead;
                  if (
                    !isViewerFullscreen &&
                    clickedClip &&
                    clickedClip.clipNumber !== 0 &&
                    clickedClip.clipNumber !== 999
                  ) {
                    if (isPlaying) handleTogglePlay();
                    setSelectedCanvasObject('clip');
                    return;
                  }
                  handleTogglePlay();
                }}
                className={`relative bg-black overflow-hidden flex items-center justify-center select-none shadow-2xl border border-slate-800/80 ${
                  isViewerFullscreen && !showFullscreenControls ? 'cursor-none' : 'cursor-pointer'
                } ${
                  isViewerFullscreen
                    ? 'mx-auto'
                    : viewerStageSize.width > 0 && viewerStageSize.height > 0
                    ? 'rounded-lg'
                    : aspectRatio === '16:9'
                    ? 'w-full max-h-full aspect-video rounded-lg'
                    : 'h-full max-w-full aspect-[9/16] rounded-lg'
                }`}
                style={{
                  ...((
                  isViewerFullscreen
                    ? {
                        width:
                          aspectRatio === '16:9'
                            ? 'min(100vw, calc(100vh * 16 / 9))'
                            : 'min(100vw, calc(100vh * 9 / 16))',
                        height:
                          aspectRatio === '16:9'
                            ? 'min(100vh, calc(100vw * 9 / 16))'
                            : 'min(100vh, calc(100vw * 16 / 9))',
                      }
                    : viewerStageSize.width > 0 && viewerStageSize.height > 0
                    ? (() => {
                        const targetRatio = aspectRatio === '16:9' ? 16 / 9 : 9 / 16;
                        const fitW = Math.min(
                          viewerStageSize.width,
                          viewerStageSize.height * targetRatio
                        );
                        const fitH = fitW / targetRatio;
                        return {
                          width: `${Math.max(180, Math.floor(fitW))}px`,
                          height: `${Math.max(120, Math.floor(fitH))}px`,
                        };
                      })()
                    : undefined
                  ) || {}),
                  // Clip selected: zoom the viewer out and let the clip show beyond the frame
                  ...(clipTransformOn
                    ? {
                        overflow: 'visible',
                        transform: `scale(${clipViewScale.toFixed(4)})`,
                        transformOrigin: 'center center',
                        transition: isClipTransformDragging ? undefined : 'transform 140ms ease-out',
                      }
                    : {}),
                }}
              >
              {/* Layer 1: True Dual-Deck (A/B Ping-Pong) Hardware Video Engine with 85ms Pre-Roll (0ms Decoder Swap, Zero Frozen Last Frame) */}
              {activeClipEffectiveUrl ? (
                <div
                  className="relative w-full h-full overflow-hidden bg-black"
                  style={{
                    overflow: clipTransformOn ? 'visible' : undefined,
                    contain: clipTransformOn
                      ? undefined
                      : previewQuality === 'low'
                        ? 'strict'
                        : previewQuality === 'medium'
                        ? 'layout paint'
                        : undefined,
                    willChange: previewQuality === 'low' ? 'transform' : undefined,
                    opacity: liveClipAnim.opacity,
                    transform: `translate3d(${liveClipAnim.translateX}px, ${liveClipAnim.translateY}px, 0) scale(${liveClipAnim.scale})`,
                    filter:
                      previewQuality === 'low'
                        ? undefined
                        : liveClipAnim.blurPx > 0.1
                        ? `blur(${Math.min(
                            previewQuality === 'medium' ? 6 : 24,
                            liveClipAnim.blurPx
                          ).toFixed(1)}px)`
                        : undefined,
                  }}
                >
                  {([0, 1] as const).map((slotIdx) => {
                    const isDeckActive = activeDeckSlot === slotIdx;
                    const slotSrc = slotIdx === 0 ? deckAUrl : deckBUrl;
                    const slotClip = isDeckActive ? activeClipAtPlayhead : nextClipAtPlayhead;
                    const isSlotIntro =
                      slotClip?.id === 'fixed-doc-intro' || slotClip?.clipNumber === 0;
                    const isSlotOutro =
                      slotClip?.id === 'fixed-doc-outro' || slotClip?.clipNumber === 999;
                    const isFitBlur =
                      isSlotOutro ||
                      (aspectRatio === '9:16' && slotClip?.reframe9x16Mode === 'fit_blur' && !isSlotIntro);
                    const fStart =
                      isSlotIntro
                        ? 50
                        : typeof slotClip?.reframeFocusXStart === 'number'
                        ? slotClip.reframeFocusXStart
                        : 50;
                    const fEnd =
                      isSlotIntro
                        ? 50
                        : typeof slotClip?.reframeFocusXEnd === 'number'
                        ? slotClip.reframeFocusXEnd
                        : fStart;
                    const fY =
                      typeof slotClip?.reframeFocusY === 'number' ? slotClip.reframeFocusY : 50;
                    const clipProg =
                      isDeckActive && slotClip && slotClip.duration > 0.1
                        ? Math.max(
                            0,
                            Math.min(1, (currentTime - slotClip.start) / slotClip.duration)
                          )
                        : 0;
                    const panProg = fEnd >= 96 ? Math.min(1, clipProg / 0.6) : clipProg;
                    const liveFocusX = fStart + (fEnd - fStart) * panProg;
                    const videoObjPos =
                      aspectRatio === '9:16' && !isFitBlur
                        ? `${liveFocusX.toFixed(2)}% ${fY.toFixed(1)}%`
                        : '50% 50%';
                    // Clip size (matches the export crop: enlarging keeps the 9:16 focus point, shrinking centers vertically)
                    // Framing points: size and position follow the points over the clip's time
                    const slotFrameKeys =
                      isSlotIntro || isSlotOutro ? [] : getClipFrameKeys(slotClip, aspectRatio);
                    const slotFrame =
                      isSlotIntro || isSlotOutro || !slotClip
                        ? { z: 100, x: 0, y: 0 }
                        : getClipFrameAt(slotClip, aspectRatio, isDeckActive ? currentTime - slotClip.start : 0);
                    const slotZoom = slotFrame.z / 100;
                    const hasSlotZoom = Math.abs(slotZoom - 1) > 0.004;
                    const zoomUsesFocus = aspectRatio === '9:16' && !isFitBlur;
                    const zoomOriginY = zoomUsesFocus && slotZoom > 1 ? fY : 50;
                    const zoomOrigin = zoomUsesFocus
                      ? `${liveFocusX.toFixed(2)}% ${zoomOriginY.toFixed(1)}%`
                      : '50% 50%';
                    // Clip position (dragged in the viewer). In 9:16 crop mode the picture that moves is the
                    // cropped frame, so an enlarged clip is first trimmed to the frame (same as the export).
                    const slotOffset = { x: slotFrame.x, y: slotFrame.y };
                    const hasSlotOffset = Math.abs(slotOffset.x) > 0.05 || Math.abs(slotOffset.y) > 0.05;
                    const slotZoomAnimData =
                      slotFrameKeys.length > 1 && isDeckActive && slotClip
                        ? `${slotClip.start}#${slotFrameKeys.map((k) => [k.t, k.z, k.x, k.y].join(',')).join(';')}`
                        : undefined;
                    const slotTrimToFrame = hasSlotOffset && zoomUsesFocus && slotZoom > 1.004;
                    const slotTrimK = slotTrimToFrame ? 1 - 1 / slotZoom : 0;
                    const slotClipPath = slotTrimToFrame
                      ? `inset(${(zoomOriginY * slotTrimK).toFixed(2)}% ${((100 - liveFocusX) * slotTrimK).toFixed(2)}% ${(
                          (100 - zoomOriginY) *
                          slotTrimK
                        ).toFixed(2)}% ${(liveFocusX * slotTrimK).toFixed(2)}%)`
                      : undefined;
                    return (
                      <video
                        key={`dual-deck-${slotIdx}`}
                        ref={(el) => {
                          if (slotIdx === 0) {
                            deckAVideoRef.current = el;
                          } else {
                            deckBVideoRef.current = el;
                          }
                          if (isDeckActive) {
                            previewVideoRef.current = el;
                          } else {
                            preloadNextVideoRef.current = el;
                          }
                        }}
                        src={slotSrc || undefined}
                        data-pan={
                          aspectRatio === '9:16' && !isFitBlur && isDeckActive && slotClip && Math.abs(fEnd - fStart) > 0.01
                            ? `${fStart}|${fEnd}|${fY}|${slotClip.start}|${slotClip.duration}`
                            : undefined
                        }
                        data-zoom-origin-y={hasSlotZoom && zoomUsesFocus ? zoomOriginY.toFixed(1) : undefined}
                        data-trim-k={slotTrimToFrame ? slotTrimK.toFixed(4) : undefined}
                        data-zoom-anim={slotZoomAnimData}
                        className={`absolute inset-0 w-full h-full ${
                          isFitBlur ? 'object-contain' : 'object-cover'
                        } block bg-transparent`}
                        style={{
                          opacity: isDeckActive ? 1 : 0,
                          zIndex: isDeckActive ? 20 : 10,
                          pointerEvents: isDeckActive ? 'auto' : 'none',
                          objectPosition: videoObjPos,
                          transform: isSlotOutro
                            ? aspectRatio === '9:16'
                              ? 'scale(2.085)'
                              : 'scale(0.88) translateY(-2.5%)'
                            : hasSlotZoom || hasSlotOffset || slotZoomAnimData
                            ? `translate(${slotOffset.x.toFixed(2)}%, ${slotOffset.y.toFixed(2)}%) scale(${slotZoom.toFixed(3)})`
                            : undefined,
                          transformOrigin: hasSlotZoom || slotZoomAnimData ? zoomOrigin : undefined,
                          clipPath: slotClipPath,
                          filter:
                            isSlotOutro && previewQuality !== 'low'
                              ? 'contrast(1.12) brightness(0.92)'
                              : undefined,
                        }}
                        playsInline
                        muted={
                          !isDeckActive ||
                          effectiveFoleyVolumeAtPlayhead <= 0 ||
                          Boolean(activeClipAtPlayhead?.audioMuted) ||
                          (activeClipAtPlayhead?.foleyVolume ?? 0) <= 0
                        }
                        preload={
                          !isEditorActive
                            ? 'none'
                            : previewQuality === 'low' &&
                              !isDeckActive &&
                              (!activeClipAtPlayhead || activeClipAtPlayhead.end - currentTime > 1.6)
                            ? 'metadata'
                            : 'auto'
                        }
                        onLoadedMetadata={(e) => {
                          const vid = e.currentTarget;
                          try {
                            if (deckAssignRef.current.activeSlot === slotIdx && activeClipAtPlayhead) {
                              const { effectiveRate, clampedOffset, reachedClipMediaEnd } =
                                computeClipVideoSyncParams(
                                  vid,
                                  activeClipAtPlayhead,
                                  currentTimeRef.current
                                );
                              activePlayingClipIdRef.current = activeClipAtPlayhead.id;
                              appliedVideoSeekVersionRef.current = lastSeekVersionRef.current;
                              clipEndedHoldRef.current = reachedClipMediaEnd;
                              vid.defaultPlaybackRate = effectiveRate;
                              vid.playbackRate = effectiveRate;
                              if (
                                Math.abs(vid.currentTime - clampedOffset) >
                                (isPlaying && clampedOffset < 0.2 ? 0.28 : 0.08)
                              ) {
                                vid.currentTime = clampedOffset;
                              }
                              const targetVol = Math.min(
                                1,
                                Math.max(0, effectiveFoleyVolumeAtPlayhead / 100)
                              );
                              const shouldMute =
                                targetVol <= 0 ||
                                Boolean(activeClipAtPlayhead.audioMuted) ||
                                (activeClipAtPlayhead.foleyVolume ?? 0) <= 0;
                              try {
                                (vid as any).preservesPitch = true;
                                (vid as any).webkitPreservesPitch = true;
                              } catch {}
                              vid.volume = shouldMute ? 0 : targetVol;
                              vid.muted = shouldMute;
                              if (isPlaying && !reachedClipMediaEnd) {
                                vid.play().catch(() => {});
                              }
                            } else if (nextClipAtPlayhead) {
                              const { effectiveRate } = computeClipVideoSyncParams(
                                vid,
                                nextClipAtPlayhead,
                                nextClipAtPlayhead.start
                              );
                              vid.defaultPlaybackRate = effectiveRate;
                              vid.playbackRate = effectiveRate;
                              vid.volume = 0;
                              vid.muted = true;
                              const tStart = Math.max(0, Number(nextClipAtPlayhead.trimStart || 0));
                              const nextEffectiveUrl = String(nextClipAtPlayhead.videoUrl || '');
                              const armKey = `${nextClipAtPlayhead.id}|${nextEffectiveUrl}|${tStart.toFixed(3)}|${lastSeekVersionRef.current}`;
                              standbyArmedRef.current = { key: armKey, armed: true, prerolled: false };
                              if (Math.abs(vid.currentTime - tStart) > 0.05) {
                                vid.currentTime = tStart;
                              }
                              if (!vid.paused) {
                                vid.pause();
                              }
                            } else {
                              vid.volume = 0;
                              vid.muted = true;
                            }
                          } catch {}
                        }}
                        onLoadedData={(e) => {
                          const vid = e.currentTarget;
                          if (deckAssignRef.current.activeSlot === slotIdx) {
                            vid.style.opacity = '1';
                          } else {
                            vid.style.opacity = '0';
                          }
                        }}
                        onCanPlay={(e) => {
                          const vid = e.currentTarget;
                          if (deckAssignRef.current.activeSlot === slotIdx) {
                            vid.style.opacity = '1';
                          }
                        }}
                        onEnded={(e) => {
                          if (deckAssignRef.current.activeSlot === slotIdx) {
                            clipEndedHoldRef.current = true;
                          }
                          try {
                            e.currentTarget.pause();
                          } catch {}
                        }}
                        onError={(e) => {
                          const vidEl = e.currentTarget;
                          const isActiveSlotErr = deckAssignRef.current.activeSlot === slotIdx;
                          const targetClip = isActiveSlotErr
                            ? activeClipAtPlayhead
                            : nextClipAtPlayhead;
                          const clipNum = targetClip?.clipNumber;
                          const failedSrc = slotSrc || targetClip?.videoUrl || '';
                          const isOfficialUrl =
                            isOfficialAssetMedia(failedSrc) ||
                            clipNum === 0 ||
                            clipNum === 999;
                          const retryKey = `${clipNum ?? slotIdx}:${failedSrc.slice(-64)}`;
                          const attempts = (deckErrorRetryRef.current[retryKey] || 0) + 1;
                          deckErrorRetryRef.current[retryKey] = attempts;
                          const maxAttempts = isOfficialUrl ? 4 : 3;
                          if (attempts > maxAttempts) return;

                          if (/^https?:\/\//i.test(failedSrc)) {
                            void verifyMediaBridgeHealthOrRefresh(failedSrc).then((evicted) => {
                              if (evicted && !isOfficialUrl) {
                                triggerEditorFolderMediaRescanRef.current();
                              }
                            });
                          }

                          if (isOfficialUrl) {
                            const tid = window.setTimeout(() => {
                              officialVideoRetryTimersRef.current.delete(tid);
                              void fetchOfficialAssetsStatusRef.current();
                              if (vidEl.isConnected && vidEl.getAttribute('src')) {
                                try {
                                  vidEl.load();
                                } catch {}
                              }
                            }, 2500);
                            officialVideoRetryTimersRef.current.add(tid);
                            return;
                          }

                          const docClip = clipNum
                            ? activeDoc?.clips?.find((dc) => dc.clipNumber === clipNum)
                            : undefined;
                          const rawFallbackUrl = clipNum
                            ? rewriteMediaBridgeUrl(localServerClipVideosMap[clipNum] || '')
                            : '';
                          const fbMeta = extractEditorMediaUrlMeta(rawFallbackUrl);
                          const fallbackUrl =
                            rawFallbackUrl &&
                            !isEditorFolderItemDiscarded(
                              docClip,
                              fbMeta.fileName,
                              fbMeta.mtimeMs,
                              rawFallbackUrl
                            )
                              ? rawFallbackUrl
                              : '';
                          if (
                            clipNum &&
                            fallbackUrl &&
                            targetClip?.videoUrl !== fallbackUrl
                          ) {
                            setTimelineClips((prev) =>
                              prev.map((tc) =>
                                tc.clipNumber === clipNum ? { ...tc, videoUrl: fallbackUrl } : tc
                              )
                            );
                          } else {
                            triggerEditorFolderMediaRescanRef.current();
                            try {
                              vidEl.load();
                            } catch {}
                          }
                        }}
                      />
                    );
                  })}
                </div>
              ) : (() => {
                const storyboardPosterSrc = resolvePosterThumbSrc(activeClipAtPlayhead);
                const isStoryboardIntroOrOutro =
                  activeClipAtPlayhead?.id === 'fixed-doc-intro' ||
                  activeClipAtPlayhead?.id === 'fixed-doc-outro' ||
                  activeClipAtPlayhead?.clipNumber === 0 ||
                  activeClipAtPlayhead?.clipNumber === 999;
                return (
                /* Animated Cinematic Storyboard Canvas (with Poster / Static B-Roll image fallback) when no .MP4 is loaded yet */
                <div className="w-full h-full relative overflow-hidden bg-gradient-to-br from-[#1b140c] via-[#0c1118] to-[#060504] flex flex-col items-center justify-center p-6 text-center">
                  {storyboardPosterSrc && (
                    <img
                      src={storyboardPosterSrc}
                      alt={activeClipAtPlayhead?.fileName || `Escena ${activeClipAtPlayhead?.clipNumber}`}
                      className="absolute inset-0 w-full h-full object-cover pointer-events-none select-none opacity-85 transition-transform duration-150 ease-linear"
                      style={{
                        transform: `scale(${kenBurnsScale}) translateX(${kenBurnsPanX}%)`,
                      }}
                      onError={(e) => {
                        const imgEl = e.currentTarget;
                        const failedImgSrc =
                          imgEl.currentSrc || storyboardPosterSrc || activeClipAtPlayhead?.posterUrl || '';
                        if (
                          isStoryboardIntroOrOutro &&
                          officialLogoUrl &&
                          !imgEl.dataset.fbApplied
                        ) {
                          imgEl.dataset.fbApplied = '1';
                          imgEl.src = officialLogoUrl;
                        }
                        if (/^https?:\/\//i.test(failedImgSrc)) {
                          void verifyMediaBridgeHealthOrRefresh(failedImgSrc);
                        }
                      }}
                    />
                  )}
                  <div
                    className={`absolute inset-0 ${
                      storyboardPosterSrc ? 'bg-black/35 opacity-60' : 'opacity-35'
                    } pointer-events-none transition-transform duration-150 ease-linear`}
                    style={{
                      transform: `scale(${kenBurnsScale}) translateX(${kenBurnsPanX}%)`,
                      backgroundImage:
                        'radial-gradient(circle at 30% 35%, rgba(245, 158, 11, 0.35), transparent 55%), radial-gradient(circle at 75% 65%, rgba(14, 165, 233, 0.22), transparent 55%)',
                    }}
                  />
                  <div className="relative z-10 max-w-2xl space-y-2.5">
                    {(activeDoc?.clips?.length || 0) > 0 && timelineClips.length === 0 ? (
                      <>
                        <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-amber-500/20 border border-amber-500/50 text-amber-300 text-xs font-black tracking-wide">
                          <span>🔒 0 DE {activeDoc!.clips.length} CLIPS REVISADOS EN ETAPA 6</span>
                        </div>
                        <p className="text-sm sm:text-base font-bold text-amber-100 leading-relaxed drop-shadow">
                          En Etapa 6 los videos solo pasan al Timeline del Editor cuando son marcados como &ldquo;✅ Revisado&rdquo;.
                        </p>
                        {onOpenStage6Review && (
                          <div
                            className="pt-1 flex items-center justify-center"
                            onClick={(e) => e.stopPropagation()}
                          >
                            <button
                              type="button"
                              onClick={onOpenStage6Review}
                              className="px-4 py-1.5 rounded-lg bg-emerald-500 hover:bg-emerald-400 text-slate-950 text-xs font-black cursor-pointer transition shadow-lg"
                            >
                              ✅ Ir a Etapa 6 a revisar clips
                            </button>
                          </div>
                        )}
                      </>
                    ) : (
                      <>
                        <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-amber-500/20 border border-amber-500/40 text-amber-300 text-xs font-black tracking-wide">
                          <span>
                            🎬 ESCENA {String(activeClipAtPlayhead?.clipNumber || 1).padStart(2, '0')} DE{' '}
                            {timelineClips.length || 1}
                          </span>
                          <span>•</span>
                          <span className="font-mono">
                            {activeClipAtPlayhead
                              ? `${Math.max(0, currentTime - activeClipAtPlayhead.start).toFixed(1)}s / ${activeClipAtPlayhead.duration}s`
                              : '0.0s'}
                          </span>
                        </div>

                        <p className="text-sm sm:text-base font-bold text-amber-100 leading-relaxed drop-shadow">
                          {stripPauseTags(
                            activeClipAtPlayhead?.narrationSegment ||
                              activeCaptionAtPlayhead?.text ||
                              clip1Line2 ||
                              activeDoc?.title ||
                              'Documental Histórico — Huellas de la Humanidad'
                          )}
                        </p>

                        {onReloadFolderMedia && (
                          <div
                            className="pt-1 flex items-center justify-center"
                            onClick={(e) => e.stopPropagation()}
                          >
                            <button
                              type="button"
                              onClick={async () => {
                                const loaded = await onReloadFolderMedia();
                                setStatusMessage(
                                  loaded > 0
                                    ? `✅ ¡${loaded} video(s) .MP4 cargados desde 05_Clips_Video!`
                                    : '📂 Selecciona tu carpeta con la subcarpeta 05_Clips_Video o importa tus .MP4.'
                                );
                              }}
                              className="px-3 py-1 rounded-lg bg-amber-500/20 hover:bg-amber-500/30 border border-amber-500/50 text-amber-200 text-[11px] font-bold cursor-pointer"
                            >
                              📂 Conectar Clips .MP4 de 05_Clips_Video
                            </button>
                          </div>
                        )}
                      </>
                    )}
                  </div>
                </div>
                );
              })()}

              {/* Canonical 520p WYSIWYG Overlay Stage: guarantees 100% identical text size, line wrapping & distribution in Normal Mode, Fullscreen & Exported Video */}
              {/* Clip selected: everything outside the frame is dimmed, so it is clear what will be exported */}
              {clipTransformOn && (
                <div
                  className="absolute inset-0 pointer-events-none z-[19]"
                  style={{
                    boxShadow: '0 0 0 4000px rgba(5,4,3,0.72)',
                    outline: '1px dashed rgba(255,255,255,0.55)',
                  }}
                />
              )}
              <div
                className="absolute top-0 left-0 pointer-events-none select-none overflow-hidden z-20"
                style={{
                  width: `${canonicalStageWidth}px`,
                  height: `${CANONICAL_STAGE_HEIGHT}px`,
                  transform: `scale(${viewerScaleX}, ${viewerScaleY})`,
                  transformOrigin: 'top left',
                  overflow: clipTransformOn ? 'visible' : undefined,
                }}
              >
              {/* Clip move / resize box: drag inside to move the clip, drag a corner to enlarge or shrink it */}
              {clipTransformOn &&
                activeClipAtPlayhead &&
                (() => {
                  const tClip = activeClipAtPlayhead;
                  const tBox = getClipTransformBoxPct(tClip);
                  const z = tBox.z;
                  const off = { x: tBox.x, y: tBox.y };
                  // The box is the whole clip, not clamped to the frame
                  const left = tBox.left;
                  const top = tBox.top;
                  const right = tBox.left + tBox.size;
                  const bottom = tBox.top + tBox.size;
                  const centerPct = { x: tBox.left + tBox.size / 2, y: tBox.top + tBox.size / 2 };
                  const corners: Array<{ key: string; style: React.CSSProperties; cursor: string }> = [
                    // Inset so the handles stay whole inside the frame (the viewer clips anything outside it)
                    { key: 'tl', style: { left: 3, top: 3 }, cursor: 'nwse-resize' },
                    { key: 'tr', style: { right: 3, top: 3 }, cursor: 'nesw-resize' },
                    { key: 'bl', style: { left: 3, bottom: 3 }, cursor: 'nesw-resize' },
                    { key: 'br', style: { right: 3, bottom: 3 }, cursor: 'nwse-resize' },
                  ];
                  return (
                    <div
                      className="absolute z-40 border-2 border-amber-400 cursor-move pointer-events-auto"
                      style={{
                        left: `${left}%`,
                        top: `${top}%`,
                        width: `${Math.max(4, right - left)}%`,
                        height: `${Math.max(4, bottom - top)}%`,
                        touchAction: 'none',
                        borderWidth: Math.min(8, 2 / clipViewScale),
                        boxShadow: '0 0 0 1px rgba(0,0,0,0.6)',
                      }}
                      title="Arrastra para mover el clip. Arrastra una esquina para agrandarlo o achicarlo."
                      onClick={(e) => e.stopPropagation()}
                      onMouseDown={(e) => e.stopPropagation()}
                      onPointerDown={(e) => beginClipTransformDrag(e, 'move', tClip, centerPct)}
                      onPointerMove={moveClipTransformDrag}
                      onPointerUp={endClipTransformDrag}
                      onPointerCancel={endClipTransformDrag}
                    >
                      {corners.map((corner) => (
                        <span
                          key={corner.key}
                          className="absolute rounded-full bg-amber-400 border-2 border-slate-950 shadow pointer-events-auto"
                          style={{
                            ...corner.style,
                            // Same size on screen however far the viewer is zoomed out
                            width: Math.min(80, 26 / clipViewScale),
                            height: Math.min(80, 26 / clipViewScale),
                            cursor: corner.cursor,
                            touchAction: 'none',
                          }}
                          onPointerDown={(e) => beginClipTransformDrag(e, 'resize', tClip, centerPct)}
                          onPointerMove={moveClipTransformDrag}
                          onPointerUp={endClipTransformDrag}
                          onPointerCancel={endClipTransformDrag}
                        />
                      ))}
                      <span
                        className="absolute left-1/2 top-1 px-1.5 py-0.5 rounded bg-amber-500 text-slate-950 font-black text-[11px] whitespace-nowrap shadow pointer-events-none"
                        style={{
                          transform: `translateX(-50%) scale(${Math.min(3, 1 / clipViewScale).toFixed(3)})`,
                          transformOrigin: 'top center',
                        }}
                      >
                        Clip {String(tClip.clipNumber).padStart(2, '0')} • {Math.round(z * 100)}% • X {off.x.toFixed(0)} Y{' '}
                        {off.y.toFixed(0)}
                      </span>
                    </div>
                  );
                })()}
              {/* Layer 2: Permanent Official Logo (Selectable directly on the Video Viewer, with End Fade-Out; non-selectable in fullscreen) */}
              <div
                onMouseDown={(e) => {
                  if (isViewerFullscreen) return;
                  e.stopPropagation();
                }}
                onClick={(e) => {
                  if (isViewerFullscreen) return;
                  e.stopPropagation();
                  setSelectedCanvasObject('logo');
                  setActiveInspectorTab('branding');
                }}
                className={`absolute z-20 flex flex-col items-start transition rounded-lg p-1 ${
                  isViewerFullscreen
                    ? 'pointer-events-none select-none'
                    : selectedCanvasObject === 'logo'
                    ? 'pointer-events-auto cursor-pointer ring-2 ring-amber-400 bg-amber-500/15 shadow-lg'
                    : 'pointer-events-auto cursor-pointer hover:ring-1 hover:ring-amber-400/60'
                }`}
                style={{
                  top: `${logoPosY}%`,
                  left: `${logoPosX}%`,
                  width: `${logoScalePct}%`,
                  minWidth: '46px',
                  opacity:
                    !isViewerFullscreen && selectedCanvasObject === 'logo' && !isPlaying
                      ? logoOpacity / 100
                      : (logoOpacity / 100) * liveLogoAnim.opacity,
                  transform: `translate3d(${liveLogoAnim.translateX}px, ${liveLogoAnim.translateY}px, 0) scale(${liveLogoAnim.scale})`,
                  filter: liveLogoAnim.blurPx > 0.1 ? `blur(${liveLogoAnim.blurPx.toFixed(1)}px)` : undefined,
                }}
                title={
                  isViewerFullscreen
                    ? undefined
                    : 'Haz clic para seleccionar y ajustar el Logo Oficial (Por defecto: Fade In 1.5s al inicio y Fade Out 2.5s al final)'
                }
              >
                {officialLogoUrl ? (
                  <img
                    src={officialLogoUrl}
                    alt="Huellas de la Humanidad"
                    className="w-full h-auto object-contain drop-shadow-lg"
                  />
                ) : (
                  <div className="px-1.5 py-0.5 rounded bg-black/70 border border-amber-500/40 text-[8px] font-bold text-amber-300 text-center leading-tight">
                    Huellas de la Humanidad
                  </div>
                )}
                {!isViewerFullscreen && selectedCanvasObject === 'logo' && (
                  <span className="mt-0.5 px-1.5 py-0.2 rounded bg-amber-500 text-slate-950 font-black text-[9px] whitespace-nowrap shadow">
                    🏷️ Logo ({logoScalePct}%)
                  </span>
                )}
              </div>

              {/* Center Alignment Guide Lines (Horizontal + Vertical Crosshair only while actively dragging/resizing) */}
              {isDraggingOrResizingHook && (
                <div className="absolute inset-0 pointer-events-none z-10">
                  {/* Vertical Center Guide Line (X = 50%) */}
                  <div
                    className={`absolute inset-y-0 left-1/2 -translate-x-1/2 transition-all ${
                      Math.abs(hookLeftPct - 50) <= 0.6
                        ? 'w-[2px] bg-amber-400 shadow-[0_0_10px_#fbbf24]'
                        : 'w-0 border-l border-dashed border-amber-300/65'
                    }`}
                  />
                  {/* Horizontal Center Guide Line (Y = 50%) */}
                  <div
                    className={`absolute inset-x-0 top-1/2 -translate-y-1/2 transition-all ${
                      Math.abs(hookTopPct - 50) <= 0.6
                        ? 'h-[2px] bg-amber-400 shadow-[0_0_10px_#fbbf24]'
                        : 'h-0 border-t border-dashed border-amber-300/65'
                    }`}
                  />
                  {/* Center Crosshair Dot */}
                  <div
                    className={`absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 w-2.5 h-2.5 rounded-full border transition-all ${
                      Math.abs(hookLeftPct - 50) <= 0.6 && Math.abs(hookTopPct - 50) <= 0.6
                        ? 'bg-amber-400 border-white scale-125 shadow-[0_0_12px_#fbbf24]'
                        : 'bg-amber-400/40 border-amber-300/80'
                    }`}
                  />
                </div>
              )}

              {/* Layer 3: Clip 1 Hook Text Overlay (00:08 - 00:16 in Opción A, or 00:00 - 00:08 in Opción B — 100% Real-Time WYSIWYG; non-selectable in fullscreen) */}
              {((currentTime >= Math.min(hookLine1StartSec, hookLine2StartSec) &&
                currentTime <= clip1OverlayEndSec) ||
                (!isViewerFullscreen && selectedCanvasObject === 'hook_text')) &&
                (clip1Line1 ||
                  clip1Line2 ||
                  (!isViewerFullscreen && selectedCanvasObject === 'hook_text')) && (
                  <div
                    onMouseDown={isViewerFullscreen ? undefined : handleStartHookBoxDrag}
                    onClick={(e) => {
                      if (isViewerFullscreen) return;
                      e.stopPropagation();
                      setSelectedCanvasObject('hook_text');
                      setActiveInspectorTab('branding');
                    }}
                    className={`group absolute z-20 text-center rounded-xl p-2.5 ${
                      isViewerFullscreen
                        ? 'pointer-events-none select-none'
                        : selectedCanvasObject === 'hook_text'
                        ? 'pointer-events-auto cursor-move ring-1 ring-dashed ring-amber-400/80'
                        : 'pointer-events-auto cursor-move'
                    }`}
                    style={{
                      left: `${hookLeftPct}%`,
                      top: `${hookTopPct}%`,
                      width: `${hookBoxWidthPct}%`,
                      transform: 'translate(-50%, -50%)',
                      fontFamily: hookFontFamily,
                      textShadow: getTextShadowCss(hookShadowStyle),
                      backgroundColor:
                        hookBgStyle === 'none' || hookBgStyle === 'word_shadow'
                          ? undefined
                          : hexToRgba(hookBgColor, hookBgStyle === 'solid' ? 95 : hookBgOpacity),
                    }}
                    title={
                      isViewerFullscreen
                        ? undefined
                        : 'Mantén presionado y arrastra para mover por todo el video, o jala de las esquinas para alargar/achicar la caja de texto'
                    }
                  >
                    {/* Corner & Side Resize Handles (always visible while hook_text is selected outside fullscreen) */}
                    {!isViewerFullscreen && selectedCanvasObject === 'hook_text' && (
                      <div className="opacity-100 transition-opacity">
                        {/* Top-Left Corner (NW) */}
                        <div
                          onMouseDown={(e) => handleStartHookBoxResize(e, 'nw')}
                          className="
                            absolute -top-2 -left-2 w-3.5 h-3.5 rounded-full bg-amber-400 border border-slate-950
                            cursor-nwse-resize shadow-md hover:scale-125 transition z-30
                          "
                          title="Jalar esquina para alargar/achicar caja y tamaño de texto"
                        />
                        {/* Top-Right Corner (NE) */}
                        <div
                          onMouseDown={(e) => handleStartHookBoxResize(e, 'ne')}
                          className="
                            absolute -top-2 -right-2 w-3.5 h-3.5 rounded-full bg-amber-400 border border-slate-950
                            cursor-nesw-resize shadow-md hover:scale-125 transition z-30
                          "
                          title="Jalar esquina para alargar/achicar caja y tamaño de texto"
                        />
                        {/* Bottom-Left Corner (SW) */}
                        <div
                          onMouseDown={(e) => handleStartHookBoxResize(e, 'sw')}
                          className="
                            absolute -bottom-2 -left-2 w-3.5 h-3.5 rounded-full bg-amber-400 border border-slate-950
                            cursor-nesw-resize shadow-md hover:scale-125 transition z-30
                          "
                          title="Jalar esquina para alargar/achicar caja y tamaño de texto"
                        />
                        {/* Bottom-Right Corner (SE) */}
                        <div
                          onMouseDown={(e) => handleStartHookBoxResize(e, 'se')}
                          className="
                            absolute -bottom-2 -right-2 w-3.5 h-3.5 rounded-full bg-amber-400 border border-slate-950
                            cursor-nwse-resize shadow-md hover:scale-125 transition z-30
                          "
                          title="Jalar esquina para alargar/achicar caja y tamaño de texto"
                        />
                        {/* Left Edge Handle (W) */}
                        <div
                          onMouseDown={(e) => handleStartHookBoxResize(e, 'w')}
                          className="
                            absolute top-1/2 -left-2 -translate-y-1/2 w-2 h-5 rounded-full bg-amber-300 border border-slate-950
                            cursor-ew-resize shadow hover:scale-110 transition z-30
                          "
                          title="Jalar lado izquierdo para alargar o achicar el ancho de la caja"
                        />
                        {/* Right Edge Handle (E) */}
                        <div
                          onMouseDown={(e) => handleStartHookBoxResize(e, 'e')}
                          className="
                            absolute top-1/2 -right-2 -translate-y-1/2 w-2 h-5 rounded-full bg-amber-300 border border-slate-950
                            cursor-ew-resize shadow hover:scale-110 transition z-30
                          "
                          title="Jalar lado derecho para alargar o achicar el ancho de la caja"
                        />
                      </div>
                    )}

                    <div className="space-y-1.5 flex flex-col items-center">
                      {clip1Line1 && (
                        <div
                          className="leading-snug"
                          style={
                            !isPlaying &&
                            (selectedCanvasObject === 'hook_text' || currentTime === hookLine1StartSec)
                              ? { opacity: 1, visibility: 'visible' }
                              : {
                                  opacity: liveHookLine1Anim.visible ? liveHookLine1Anim.opacity : 0,
                                  visibility: liveHookLine1Anim.visible ? 'visible' : 'hidden',
                                  transform: `translate3d(${liveHookLine1Anim.translateX}px, ${liveHookLine1Anim.translateY}px, 0) scale(${liveHookLine1Anim.scale})`,
                                  filter:
                                    liveHookLine1Anim.blurPx > 0.1
                                      ? `blur(${liveHookLine1Anim.blurPx.toFixed(1)}px)`
                                      : undefined,
                                }
                          }
                        >
                          <span
                            className="font-bold uppercase tracking-widest px-2.5 py-0.5 rounded-md inline whitespace-pre-line"
                            style={{
                              fontFamily: hookFontFamily,
                              fontSize: `${hookLine1FontSize}px`,
                              color: hookLine1Color,
                              textShadow: getTextShadowCss(hookShadowStyle),
                              boxDecorationBreak: 'clone',
                              WebkitBoxDecorationBreak: 'clone',
                              ...(hookBgStyle === 'word_shadow'
                                ? {
                                    backgroundColor: hexToRgba(hookBgColor, hookBgOpacity),
                                    boxShadow: `0 0 12px 4px ${hexToRgba(
                                      hookBgColor,
                                      Math.round(hookBgOpacity * 0.85)
                                    )}`,
                                  }
                                : {}),
                            }}
                          >
                            {clip1Line1}
                          </span>
                        </div>
                      )}
                      {clip1Line2 && (
                        <div
                          className="leading-snug"
                          style={
                            !isPlaying &&
                            (selectedCanvasObject === 'hook_text' || currentTime === hookLine1StartSec)
                              ? { opacity: 1, visibility: 'visible' }
                              : {
                                  opacity: liveHookLine2Anim.visible ? liveHookLine2Anim.opacity : 0,
                                  visibility: liveHookLine2Anim.visible ? 'visible' : 'hidden',
                                  transform: `translate3d(${liveHookLine2Anim.translateX}px, ${liveHookLine2Anim.translateY}px, 0) scale(${liveHookLine2Anim.scale})`,
                                  filter:
                                    liveHookLine2Anim.blurPx > 0.1
                                      ? `blur(${liveHookLine2Anim.blurPx.toFixed(1)}px)`
                                      : undefined,
                                }
                          }
                        >
                          <span
                            className="font-black uppercase tracking-wide px-2.5 py-0.5 rounded-md inline whitespace-pre-line"
                            style={{
                              fontFamily: hookFontFamily,
                              fontSize: `${hookLine2FontSize}px`,
                              color: hookLine2Color,
                              textShadow: getTextShadowCss(hookShadowStyle),
                              boxDecorationBreak: 'clone',
                              WebkitBoxDecorationBreak: 'clone',
                              ...(hookBgStyle === 'word_shadow'
                                ? {
                                    backgroundColor: hexToRgba(hookBgColor, hookBgOpacity),
                                    boxShadow: `0 0 14px 5px ${hexToRgba(
                                      hookBgColor,
                                      Math.round(hookBgOpacity * 0.85)
                                    )}`,
                                  }
                                : {}),
                            }}
                          >
                            {clip1Line2}
                          </span>
                        </div>
                      )}
                    </div>
                  </div>
                )}

              {/* Layer 4: Dynamic Captions (.SRT) — 100% Real-Time WYSIWYG (never changes appearance when selected; non-selectable in fullscreen) */}
              {(activeCaptionAtPlayhead ||
                (!isViewerFullscreen &&
                  !isPlaying &&
                  selectedCanvasObject === 'captions' &&
                  nearestCaptionAtPlayhead)) && (
                <div
                  className="absolute inset-x-4 z-20 text-center pointer-events-none"
                  style={{
                    bottom: `${captionBottomPct}%`,
                    opacity:
                      !isViewerFullscreen && selectedCanvasObject === 'captions' && !isPlaying
                        ? 1
                        : liveCaptionAnim.opacity,
                    transform:
                      !isViewerFullscreen && selectedCanvasObject === 'captions' && !isPlaying
                        ? undefined
                        : `translate3d(${liveCaptionAnim.translateX}px, ${liveCaptionAnim.translateY}px, 0) scale(${liveCaptionAnim.scale})`,
                    filter:
                      !isViewerFullscreen && selectedCanvasObject === 'captions' && !isPlaying
                        ? undefined
                        : liveCaptionAnim.blurPx > 0.1
                        ? `blur(${liveCaptionAnim.blurPx.toFixed(1)}px)`
                        : undefined,
                  }}
                >
                  <span
                    onMouseDown={isViewerFullscreen ? undefined : handleStartCaptionDrag}
                    onClick={(e) => {
                      if (isViewerFullscreen) return;
                      e.stopPropagation();
                      setSelectedCanvasObject('captions');
                      setActiveInspectorTab('captions');
                    }}
                    title={
                      isViewerFullscreen
                        ? undefined
                        : 'Haz clic o arrastra verticalmente para ajustar los Captions en tiempo real'
                    }
                    className={`${
                      isViewerFullscreen
                        ? 'pointer-events-none select-none'
                        : 'pointer-events-auto cursor-ns-resize'
                    } ${
                      effCaptionBgStyle === 'word_shadow'
                        ? 'inline px-2.5 py-0.5 rounded-md'
                        : 'inline-block px-3.5 py-1 rounded-lg'
                    } font-extrabold transition whitespace-pre-line`}
                    ref={viewerCaptionSpanRef}
                    style={{
                      fontFamily: effCaptionFontFamily,
                      fontSize: `${Math.max(13, captionFontSize * 0.76)}px`,
                      textWrap: (aspectRatio === '16:9' ? 'pretty' : undefined) as any,
                      color: effCaptionColorHex,
                      ...(karaokeCaptions
                        ? KARAOKE_9X16_CAPTION.viewerCss
                        : { textShadow: getTextShadowCss(captionShadowStyle) }),
                      boxDecorationBreak: 'clone',
                      WebkitBoxDecorationBreak: 'clone',
                      backgroundColor:
                        effCaptionBgStyle === 'none'
                          ? 'transparent'
                          : hexToRgba(
                              captionBgColor,
                              effCaptionBgStyle === 'solid' ? 95 : captionBgOpacity
                            ),
                      ...(effCaptionBgStyle === 'word_shadow'
                        ? {
                            boxShadow: `0 0 12px 4px ${hexToRgba(
                              captionBgColor,
                              Math.round(captionBgOpacity * 0.85)
                            )}`,
                          }
                        : {}),
                    }}
                  >
                    {(() => {
                      const shownCap = activeCaptionAtPlayhead || nearestCaptionAtPlayhead;
                      const shownText = formatCaptionTextCase(shownCap?.text || '');
                      if (!karaokeCaptions || !shownCap) return shownText;
                      // Palabra por palabra: la que se está diciendo va en blanco (el bucle de reproducción la afina cuadro a cuadro)
                      const starts = getCaptionWordStarts(shownCap, shownText);
                      let wi = -1;
                      return shownText.split(/(\s+)/).map((piece, pi) => {
                        if (!piece.trim()) return piece;
                        wi += 1;
                        const ws = starts[wi] ?? shownCap.start;
                        const we = starts[wi + 1] ?? Infinity;
                        const isActive = currentTime >= ws && currentTime < we;
                        return (
                          <span
                            key={`${shownCap.id}-${pi}`}
                            data-ws={ws}
                            data-we={Number.isFinite(we) ? we : ''}
                            style={{ color: isActive ? KARAOKE_9X16_CAPTION.activeWordColor : undefined }}
                          >
                            {piece}
                          </span>
                        );
                      });
                    })()}
                  </span>
                </div>
              )}
              </div>
              </div>
            </div>

            {/* CapCut-Style Compact Bottom Player Bar: Timecode (Left), Transport & Scrubber (Center), Ratio & Fullscreen (Right) */}
            <div
              data-keep-clip-selection="true"
              className={`w-full bg-[#110e0b] border-t border-slate-800/90 px-3 py-1.5 flex flex-wrap sm:flex-nowrap items-center gap-x-2 gap-y-1 transition-all duration-300 shrink-0 ${
                isViewerFullscreen
                  ? `absolute inset-x-0 bottom-0 z-30 bg-[#110e0b]/95 backdrop-blur-md ${
                      showFullscreenControls
                        ? 'opacity-100 translate-y-0 pointer-events-auto'
                        : 'opacity-0 translate-y-3 pointer-events-none'
                    }`
                  : ''
              }`}
            >
              {/* Left: CapCut Cyan/Teal Timecode (Current / Total Duration) */}
              <div className="flex items-center gap-1 font-mono tabular-nums text-[11px] shrink-0 select-none">
                <span ref={viewerTimecodeRef} className="text-teal-300 font-bold">
                  {formatViewerTimecode(currentTime)}
                </span>
                <span className="text-slate-500 font-normal">/</span>
                <span
                  ref={viewerTotalDurationRef}
                  className="text-slate-400 font-semibold"
                  title={`Duración total del video: ${formatViewerTimecode(totalDurationSec)} (${Math.round(totalDurationSec)}s)`}
                >
                  {formatViewerTimecode(totalDurationSec)}
                </span>
              </div>

              {/* Center-Left: Compact Transport Controls */}
              <div className="flex items-center gap-1 shrink-0">
                <button
                  type="button"
                  onClick={() => seekToTime(0)}
                  className="p-1 rounded bg-slate-900 hover:bg-slate-800 text-slate-300 cursor-pointer shrink-0"
                  title="Ir al inicio (00:00)"
                >
                  <SkipBack className="w-3.5 h-3.5" />
                </button>
                <button
                  type="button"
                  onClick={() => seekToTime(Math.max(0, currentTimeRef.current - 10))}
                  className="px-1.5 py-0.5 rounded bg-slate-900 hover:bg-slate-800 border border-slate-700/80 text-slate-200 hover:text-amber-300 font-bold text-[10px] flex items-center gap-0.5 cursor-pointer shrink-0 transition"
                  title="Retroceder 10 segundos (-10s • Flecha Izquierda ⬅️)"
                >
                  <RotateCcw className="w-3 h-3" />
                  <span>-10s</span>
                </button>
                <button
                  type="button"
                  onClick={handleTogglePlay}
                  className="px-2.5 py-1 rounded-md bg-amber-500 hover:bg-amber-400 text-slate-950 font-black text-[11px] flex items-center gap-1 cursor-pointer shadow shrink-0"
                  title={isPlaying ? 'Pausar reproducción (Espacio)' : 'Reproducir video y voz narrativa (Espacio)'}
                >
                  {isPlaying ? <Pause className="w-3.5 h-3.5" /> : <Play className="w-3.5 h-3.5" />}
                  <span>{isPlaying ? 'Pausa' : 'Play'}</span>
                </button>
                <button
                  type="button"
                  onClick={() => seekToTime(Math.min(totalDurationSec, currentTimeRef.current + 10))}
                  className="px-1.5 py-0.5 rounded bg-slate-900 hover:bg-slate-800 border border-slate-700/80 text-slate-200 hover:text-amber-300 font-bold text-[10px] flex items-center gap-0.5 cursor-pointer shrink-0 transition"
                  title="Adelantar 10 segundos (+10s • Flecha Derecha ➡️)"
                >
                  <span>+10s</span>
                  <RotateCw className="w-3 h-3" />
                </button>
                <button
                  type="button"
                  onClick={() => seekToTime(Math.max(0, totalDurationSec - 1))}
                  className="p-1 rounded bg-slate-900 hover:bg-slate-800 text-slate-300 cursor-pointer shrink-0"
                  title="Ir al final"
                >
                  <SkipForward className="w-3.5 h-3.5" />
                </button>
                <button
                  type="button"
                  onClick={() => seekToTime(voiceStartOffsetSec)}
                  className="px-1.5 py-0.5 rounded bg-emerald-950/80 hover:bg-emerald-900/80 border border-emerald-500/40 text-emerald-300 font-mono text-[10px] font-bold cursor-pointer shrink-0"
                  title={`Ir al segundo ${voiceStartOffsetSec}s donde entra la Voz Narrativa`}
                >
                  🎙️ 00:{String(Math.floor(voiceStartOffsetSec)).padStart(2, '0')}
                </button>
              </div>

              {/* Scrubber Timeline */}
              <div className="order-last sm:order-none basis-full sm:basis-auto flex-1 flex items-center min-w-[80px]">
                <input
                  ref={viewerRangeInputRef}
                  type="range"
                  min={0}
                  max={totalDurationSec}
                  step={0.05}
                  value={currentTime}
                  title={`Progreso: ${formatViewerTimecode(currentTime)} / ${formatViewerTimecode(totalDurationSec)}`}
                  onPointerDown={() => {
                    isScrubbingRulerRef.current = true;
                  }}
                  onPointerUp={() => {
                    isScrubbingRulerRef.current = false;
                  }}
                  onChange={(e) => seekToTime(Number(e.target.value))}
                  className="w-full h-1.5 accent-amber-500 cursor-pointer"
                />
              </div>

              {/* Right: Preview Quality Selector + Aspect Ratio Badge + Fullscreen Button */}
              <div
                onClick={(e) => e.stopPropagation()}
                className="flex items-center gap-1 bg-slate-900 border border-slate-700/80 rounded px-1.5 py-0.5 text-[10px] font-mono shrink-0"
                title="Calidad de reproducción en el editor (solo afecta la vista previa para evitar lentitud; la exportación final siempre usa la máxima calidad 4K/8K original)"
              >
                <span className="text-amber-400">⚡</span>
                <select
                  aria-label="Calidad de reproducción del visor"
                  value={previewQuality}
                  onChange={(e) => {
                    const next =
                      e.target.value === 'low' ||
                      e.target.value === 'medium' ||
                      e.target.value === 'high'
                        ? e.target.value
                        : 'medium';
                    setPreviewQuality(next);
                    try {
                      localStorage.setItem('huellas_editor_preview_quality', next);
                    } catch {}
                    const labelMap = {
                      low: 'Baja (540p rápida)',
                      medium: 'Media (720p balanceada)',
                      high: 'Alta (Nativa 4K)',
                    } as const;
                    setStatusMessage(
                      `⚡ Calidad de vista previa: ${labelMap[next]} (la exportación final conserva 100% su resolución maestra ${RESOLUTION_PRESETS[exportResolution].badge}).`
                    );
                  }}
                  className="bg-transparent text-amber-300 font-bold outline-none cursor-pointer text-[10px]"
                >
                  <option value="low" className="bg-slate-900 text-slate-200">
                    Baja (540p)
                  </option>
                  <option value="medium" className="bg-slate-900 text-slate-200">
                    Media (720p)
                  </option>
                  <option value="high" className="bg-slate-900 text-slate-200">
                    Alta (Nativa)
                  </option>
                </select>
              </div>

              {/* Global Video Proxy Status Text (Pure Informational Indicator - Auto Generation) */}
              {previewQuality !== 'high' ? (
                <div
                  className={`hidden sm:flex items-center gap-1.5 px-2 py-0.5 rounded text-[10px] font-mono border select-none shrink-0 ${
                    previewProxyStatus.ready === previewProxyStatus.total && previewProxyStatus.total > 0
                      ? 'bg-emerald-950/80 border-emerald-500/60 text-emerald-300'
                      : previewProxyStatus.building > 0 || previewProxyStatus.queued > 0
                      ? 'bg-amber-950/90 border-amber-400 text-amber-200 animate-pulse'
                      : 'bg-slate-900 border-slate-700/80 text-slate-400'
                  }`}
                  title={`Estado global de proxies (${previewQuality === 'low' ? '540p' : '720p'}) para todo el documental: ${previewProxyStatus.ready} creados de ${previewProxyStatus.total} clips (${previewProxyStatus.percent}%). Generación automática en segundo plano.`}
                >
                  {previewProxyStatus.ready === previewProxyStatus.total && previewProxyStatus.total > 0 ? (
                    <>
                      <span className="text-emerald-400">✅</span>
                      <span className="font-semibold">
                        Proxies {previewQuality === 'low' ? '540p' : '720p'}: {previewProxyStatus.ready}/{previewProxyStatus.total} Listos (100%)
                      </span>
                    </>
                  ) : previewProxyStatus.building > 0 || previewProxyStatus.queued > 0 ? (
                    <>
                      <span className="inline-block animate-spin text-amber-400">⏳</span>
                      <span className="font-semibold">
                        Proxies {previewQuality === 'low' ? '540p' : '720p'}: Creándose ({previewProxyStatus.ready}/{previewProxyStatus.total} • {previewProxyStatus.percent}%)
                      </span>
                    </>
                  ) : (
                    <>
                      <span className="text-slate-400">⏳</span>
                      <span className="font-semibold">
                        Proxies {previewQuality === 'low' ? '540p' : '720p'}: {previewProxyStatus.ready}/{previewProxyStatus.total} ({previewProxyStatus.percent}%)
                      </span>
                    </>
                  )}
                </div>
              ) : (
                <div
                  className="hidden sm:flex items-center gap-1 px-1.5 py-0.5 rounded bg-slate-900 border border-slate-700/80 text-[10px] font-mono text-slate-400 shrink-0 select-none"
                  title="En calidad Alta (4K Nativa), los proxies están apagados y se reproduce el video maestro original."
                >
                  <span>⚡ Proxies: 4K Original (Nativa)</span>
                </div>
              )}
              <span className="hidden sm:inline-block px-1.5 py-0.5 rounded bg-slate-900 border border-slate-700 text-[10px] font-mono text-slate-300 shrink-0">
                {aspectRatio}
              </span>
              <button
                type="button"
                onClick={handleToggleViewerFullscreen}
                className="p-1 rounded bg-slate-900 hover:bg-amber-500 text-slate-300 hover:text-slate-950 cursor-pointer shrink-0 transition"
                title={isViewerFullscreen ? 'Salir de pantalla completa (Esc)' : 'Pantalla completa'}
              >
                {isViewerFullscreen ? (
                  <Minimize2 className="w-3.5 h-3.5" />
                ) : (
                  <Maximize2 className="w-3.5 h-3.5" />
                )}
              </button>
            </div>
          </div>
        </div>

        {/* =================================================================
            COLUMN 3: COMPACT RIGHT DETAILS & INSPECTOR PANEL
        ================================================================= */}
        {isRightPanelCollapsed && (
          <div className="hidden sm:flex w-8 h-full max-h-full shrink-0 bg-[#14110d] border border-slate-800/90 rounded-xl flex-col items-center py-2 gap-3 select-none">
            <button
              type="button"
              onClick={() => {
                setIsRightPanelCollapsed(false);
                if (typeof window !== 'undefined' && window.innerWidth < 1024) {
                  setIsLeftPanelCollapsed(true);
                }
              }}
              className="p-1 rounded-lg bg-slate-900 hover:bg-amber-500 text-amber-300 hover:text-slate-950 text-[10px] font-black cursor-pointer transition"
              title="Mostrar panel derecho Details / Inspector"
            >
              ◀
            </button>
            <span className="[writing-mode:vertical-rl] rotate-180 text-[10px] font-bold tracking-widest text-slate-400 uppercase">
              Details • Inspector
            </span>
          </div>
        )}

        <div
          className={
            isRightPanelCollapsed
              ? 'hidden'
              : 'max-md:absolute max-md:inset-y-1 max-md:right-1 max-md:z-[140] max-md:w-[min(90vw,295px)] max-md:shadow-2xl w-[240px] lg:w-[255px] xl:w-[275px] h-full max-h-full shrink-0 bg-[#14110d] border border-slate-800/90 rounded-xl p-2 flex flex-col min-h-0 overflow-hidden space-y-2'
          }
        >
          {/* CapCut-Style "Details" Header + Collapse Button */}
          <div className="flex items-center justify-between px-1 pb-1 border-b border-slate-800/80 shrink-0">
            <span className="text-[11px] font-black text-teal-300 tracking-wide">
              Details
            </span>
            <span className="text-[9px] font-mono text-slate-400 truncate max-w-[140px]">
              {aspectRatio === '16:9'
                ? `${activePreset.width16x9}×${activePreset.height16x9}`
                : `${activePreset.width9x16}×${activePreset.height9x16}`}{' '}
              • 60fps
            </span>
            <button
              type="button"
              onClick={() => setIsRightPanelCollapsed(true)}
              className="p-0.5 rounded hover:bg-slate-800 text-slate-400 hover:text-amber-300 text-[10px] cursor-pointer"
              title="Ocultar panel derecho para ampliar aún más el Visor de Video"
            >
              ▶
            </button>
          </div>

          {/* Compact 4-Column Inspector Tabs */}
          <div className="grid grid-cols-4 gap-1 bg-slate-950 p-0.5 rounded-lg border border-slate-800 shrink-0">
            <button
              type="button"
              onClick={() => setActiveInspectorTab('clips')}
              className={`py-1 px-1 rounded-md text-[10px] font-bold cursor-pointer truncate ${
                activeInspectorTab === 'clips'
                  ? 'bg-amber-500 text-slate-950'
                  : 'text-slate-400 hover:text-slate-200'
              }`}
              title="Clips, Orden, Velocidad y Transiciones"
            >
              🎬 Clips
            </button>
            <button
              type="button"
              onClick={() => setActiveInspectorTab('audio')}
              className={`py-1 px-1 rounded-md text-[10px] font-bold cursor-pointer truncate ${
                activeInspectorTab === 'audio'
                  ? 'bg-amber-500 text-slate-950'
                  : 'text-slate-400 hover:text-slate-200'
              }`}
              title="Voz Narrativa, Foley y Flow Music"
            >
              🎙️ Audio
            </button>
            <button
              type="button"
              onClick={() => setActiveInspectorTab('branding')}
              className={`py-1 px-1 rounded-md text-[10px] font-bold cursor-pointer truncate ${
                activeInspectorTab === 'branding'
                  ? 'bg-amber-500 text-slate-950'
                  : 'text-slate-400 hover:text-slate-200'
              }`}
              title="Logo Oficial y Texto del Clip 1"
            >
              🏷️ Logo
            </button>
            <button
              type="button"
              onClick={() => setActiveInspectorTab('captions')}
              className={`py-1 px-1 rounded-md text-[10px] font-bold cursor-pointer truncate ${
                activeInspectorTab === 'captions'
                  ? 'bg-amber-500 text-slate-950'
                  : 'text-slate-400 hover:text-slate-200'
              }`}
              title="Subtítulos dinámicos .SRT"
            >
              💬 SRT
            </button>
          </div>

          {/* TAB 1: CLIPS, ORDER, SPEED, FOLEY & TRANSITIONS */}
          {activeInspectorTab === 'clips' && (
            <div className="flex flex-col gap-3 text-xs flex-1 min-h-0 overflow-y-auto pr-1">
              <div className="flex items-center justify-between gap-2 flex-wrap bg-slate-950/90 border border-slate-800 rounded-xl p-3">
                <div>
                  <div className="font-bold text-amber-300">
                    Importar / Insertar Videos (.MP4) en la Pista 3
                  </div>
                  <div className="text-[11px] text-slate-400">
                    Selecciona tus clips <code className="text-emerald-300">01_...mp4</code> al{' '}
                    <code className="text-emerald-300">80_...mp4</code> y se acomodan solos por número.
                  </div>
                </div>
                <label className="px-3 py-1.5 rounded-lg bg-emerald-500 hover:bg-emerald-400 text-slate-950 font-black text-xs cursor-pointer flex items-center gap-1.5">
                  <Upload className="w-3.5 h-3.5" />
                  Cargar Clips .MP4
                  <input
                    type="file"
                    accept="video/mp4,video/*"
                    multiple
                    onChange={(e) => handleImportMp4FilesToTimeline(e.target.files)}
                    className="hidden"
                  />
                </label>
              </div>

              {/* Global Transition Selector & Clip/Image Animations */}
              <div className="bg-slate-950/90 border border-slate-800 rounded-xl p-3 space-y-2.5">
                <label className="block font-bold text-slate-200">
                  Transición entre Clips (Por defecto: Corte Directo):
                </label>
                <div className="flex items-center gap-2">
                  <select
                    value={defaultTransition}
                    onChange={(e) =>
                      handleApplyTransitionToAll(e.target.value as ClipTransitionType)
                    }
                    className="flex-1 bg-slate-900 border border-slate-700 rounded-lg px-2.5 py-1.5 text-xs text-amber-200"
                  >
                    {TRANSITION_OPTIONS.map((t) => (
                      <option key={t.value} value={t.value}>
                        {t.label}
                      </option>
                    ))}
                  </select>
                  <button
                    type="button"
                    onClick={() => handleAutoSlowClip1(8)}
                    className="px-2.5 py-1.5 rounded-lg bg-amber-500/20 border border-amber-500/40 text-amber-300 font-bold text-[11px] cursor-pointer whitespace-nowrap"
                    title="Ralentiza automáticamente el Clip 1 para que cubra 8 segundos sin voz"
                  >
                    🐢 Ralentizar Clip 1 (8s)
                  </button>
                </div>

                {/* Animations for Video Clips & Images */}
                <div className="pt-2 border-t border-slate-800 space-y-1.5">
                  <div className="flex items-center justify-between">
                    <span className="font-bold text-amber-300 text-[11px]">
                      ✨ Animaciones para Clips de Video e Imágenes:
                    </span>
                    <span className="text-[10px] text-slate-400">Duración: {clipAnimDur}s</span>
                  </div>
                  <div className="grid grid-cols-3 gap-2">
                    <div>
                      <label className="block text-[10px] text-slate-400">Entrada (In):</label>
                      <select
                        value={clipAnimIn}
                        onChange={(e) => setClipAnimIn(e.target.value as ElementAnimationType)}
                        className="w-full bg-slate-900 border border-slate-700 rounded px-2 py-1 text-[11px] text-amber-200 mt-0.5"
                      >
                        {ELEMENT_ANIMATION_OPTIONS.map((a) => (
                          <option key={a.value} value={a.value}>
                            {a.label}
                          </option>
                        ))}
                      </select>
                    </div>
                    <div>
                      <label className="block text-[10px] text-slate-400">Salida (Out):</label>
                      <select
                        value={clipAnimOut}
                        onChange={(e) => setClipAnimOut(e.target.value as ElementAnimationType)}
                        className="w-full bg-slate-900 border border-slate-700 rounded px-2 py-1 text-[11px] text-amber-200 mt-0.5"
                      >
                        {ELEMENT_ANIMATION_OPTIONS.map((a) => (
                          <option key={a.value} value={a.value}>
                            {a.label}
                          </option>
                        ))}
                      </select>
                    </div>
                    <div>
                      <label className="block text-[10px] text-slate-400">Segundos:</label>
                      <input
                        type="number"
                        step={0.1}
                        min={0.1}
                        max={3}
                        value={clipAnimDur}
                        onChange={(e) => setClipAnimDur(Math.max(0.1, Number(e.target.value)))}
                        className="w-full bg-slate-900 border border-slate-700 rounded px-2 py-1 text-[11px] text-white mt-0.5"
                      />
                    </div>
                  </div>
                </div>
              </div>

              {/* Selected Clip Detailed Controls — Displayed at the top of the Right Column when a clip is selected */}
              {selectedClip && (
                <div className="order-first bg-slate-950/90 border border-amber-500/40 ring-1 ring-amber-400/50 rounded-xl p-3 space-y-2.5">
                  <div className="flex items-center justify-between gap-2 flex-wrap">
                    <span className="font-black text-amber-300 flex items-center gap-1.5 flex-wrap">
                      <span>
                        Editando: CLIP {String(selectedClip.clipNumber).padStart(2, '0')}
                        {selectedClip.partLabel ? ` (${selectedClip.partLabel})` : ''}
                      </span>
                      {activeTargetClipIds.length > 1 && (
                        <span className="px-2 py-0.5 rounded-full bg-emerald-500 text-slate-950 text-[10px] font-black">
                          +{activeTargetClipIds.length - 1} más ({activeTargetClipIds.length} seleccionados)
                        </span>
                      )}
                      <span className="text-[10px] font-mono text-slate-400 truncate max-w-[160px]">
                        ({selectedClip.fileName})
                      </span>
                    </span>
                    <div className="flex items-center gap-1 flex-wrap">
                      {clipUndoStack.length > 0 && (
                        <button
                          type="button"
                          onClick={handleUndoClipEdit}
                          className="px-2 py-1 rounded bg-amber-500/20 hover:bg-amber-500/30 border border-amber-400/50 text-amber-200 font-bold text-[10px] cursor-pointer"
                          title="Deshacer último corte, eliminación o cambio de velocidad"
                        >
                          ↩️ Deshacer ({clipUndoStack.length})
                        </button>
                      )}
                      <button
                        type="button"
                        onClick={() => {
                          const idx = timelineClips.findIndex((c) => c.id === selectedClip.id);
                          handleMoveClipOrder(idx, idx - 1);
                        }}
                        className="px-2 py-1 rounded bg-slate-800 hover:bg-slate-700 text-slate-200 text-[10px] cursor-pointer"
                        title="Mover este clip una posición antes"
                      >
                        ⬅️ Antes
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          const idx = timelineClips.findIndex((c) => c.id === selectedClip.id);
                          handleMoveClipOrder(idx, idx + 1);
                        }}
                        className="px-2 py-1 rounded bg-slate-800 hover:bg-slate-700 text-slate-200 text-[10px] cursor-pointer"
                        title="Mover este clip una posición después"
                      >
                        Después ➡️
                      </button>
                    </div>
                  </div>

                  {/* LIVE B-ROLL OPTICAL CAMERA SELECTOR (4K · 60FPS) */}
                  {(() => {
                    const selectedDocClip = activeDoc?.clips?.find(
                      (dc) => dc.clipNumber === selectedClip.clipNumber
                    );
                    const isSelectedBroll = Boolean(
                      selectedDocClip?.isStaticBroll ||
                        selectedClip.isStaticBroll ||
                        /_broll_4k/i.test(selectedClip.fileName || '')
                    );
                    if (!isSelectedBroll || selectedClip.clipNumber <= 0 || selectedClip.clipNumber === 999) {
                      return null;
                    }
                    const activeMotion: BrollCameraMotion =
                      selectedDocClip?.brollCameraMotion ||
                      selectedClip.brollCameraMotion ||
                      'zoom_in';
                    const isBusyBroll = rerenderingBrollClipNum === selectedClip.clipNumber;
                    const motionButtons: Array<{ key: BrollCameraMotion; label: string }> = [
                      { key: 'zoom_in', label: '🔍 Zoom In' },
                      { key: 'zoom_out', label: '🔎 Zoom Out' },
                      { key: 'pan_right', label: '➡️ Pan Der.' },
                      { key: 'pan_left', label: '⬅️ Pan Izq.' },
                      { key: 'tilt_up', label: '⬆️ Tilt Arriba' },
                      { key: 'tilt_down', label: '⬇️ Tilt Abajo' },
                    ];
                    return (
                      <div className="bg-sky-950/35 border border-sky-400/50 rounded-lg p-2.5 space-y-2">
                        <div className="flex items-center justify-between gap-2 flex-wrap">
                          <span className="text-[11px] font-black text-sky-300 flex items-center gap-1.5">
                            🖼️ Cámara Óptica B-Roll (4K · 60fps)
                          </span>
                          <span className="px-2 py-0.5 rounded bg-sky-500/20 border border-sky-400/40 text-[10px] font-bold text-sky-200">
                            {isBusyBroll
                              ? '⏳ Renderizando 4K 60fps...'
                              : `Activo: ${BROLL_MOTION_UI_LABEL_ES[activeMotion]}`}
                          </span>
                        </div>
                        <div className="grid grid-cols-3 gap-1.5">
                          {motionButtons.map((opt) => {
                            const isActiveOpt = activeMotion === opt.key;
                            return (
                              <button
                                key={opt.key}
                                type="button"
                                disabled={isBusyBroll}
                                onClick={() => handleRerenderBrollCameraMotion(selectedClip, opt.key)}
                                className={`px-2 py-1.5 rounded-lg border text-[10px] font-black transition cursor-pointer ${
                                  isActiveOpt
                                    ? 'bg-sky-400 text-slate-950 border-sky-300 shadow'
                                    : 'bg-slate-900 hover:bg-slate-800 text-sky-200 border-slate-700'
                                } ${isBusyBroll ? 'opacity-60 cursor-wait' : ''}`}
                              >
                                {opt.label}
                              </button>
                            );
                          })}
                        </div>
                      </div>
                    );
                  })()}

                  {/* AUDIO DE CLIP(S) SELECCIONADO(S): VOLUMEN + FADE IN + FADE OUT (INDIVIDUAL O MÚLTIPLES CLIPS) */}
                  <div className="bg-emerald-950/30 border border-emerald-500/40 rounded-lg p-2.5 space-y-2">
                    <div className="flex items-center justify-between gap-2 flex-wrap">
                      <span className="text-[11px] font-black text-emerald-300 flex items-center gap-1.5">
                        <Volume2 className="w-3.5 h-3.5 text-emerald-400" />
                        {activeTargetClipIds.length > 1
                          ? `🔊 Audio de ${activeTargetClipIds.length} Clips Seleccionados`
                          : `🔊 Audio del Clip ${
                              selectedClip.clipNumber === 0
                                ? 'INTRO'
                                : selectedClip.clipNumber === 999
                                ? 'OUTRO'
                                : String(selectedClip.clipNumber).padStart(2, '0')
                            }`}
                      </span>
                      <div className="flex items-center gap-1">
                        <button
                          type="button"
                          onClick={() => {
                            const allIds = timelineClips.map((c) => c.id);
                            if (selectedClipIds.length === allIds.length) {
                              setSelectedClipIds([selectedClip.id]);
                            } else {
                              setSelectedClipIds(allIds);
                            }
                          }}
                          className="px-2 py-0.5 rounded bg-slate-900 hover:bg-slate-800 border border-emerald-500/40 text-emerald-200 text-[10px] font-bold cursor-pointer"
                          title="Seleccionar todos los clips para editar su volumen y fades al mismo tiempo (o usa Cmd/Ctrl+Clic y Shift+Clic en el timeline)"
                        >
                          {selectedClipIds.length === timelineClips.length
                            ? '✓ Todos Seleccionados (1 solo)'
                            : `☑ Seleccionar Todos (${timelineClips.length})`}
                        </button>
                        <button
                          type="button"
                          onClick={() =>
                            handleUpdateClipsAudio({
                              audioMuted: !selectedClip.audioMuted,
                            })
                          }
                          className={`px-2 py-0.5 rounded border text-[10px] font-black cursor-pointer ${
                            selectedClip.audioMuted
                              ? 'bg-rose-500 text-white border-rose-400'
                              : 'bg-slate-900 hover:bg-slate-800 text-emerald-300 border-slate-700'
                          }`}
                          title="Silenciar o activar el audio de los clips seleccionados"
                        >
                          {selectedClip.audioMuted ? '🔇 Silenciado' : '🔊 Activo'}
                        </button>
                      </div>
                    </div>

                    {/* Volume Slider + Numeric Input (0% - 100%) */}
                    <div className="space-y-1">
                      <div className="flex items-center justify-between gap-2">
                        <label className="text-[10px] text-slate-300 font-semibold">
                          Volumen del Audio:
                        </label>
                        <div className="flex items-center gap-1">
                          <input
                            type="number"
                            min={0}
                            max={100}
                            step={1}
                            value={selectedClip.audioMuted ? 0 : selectedClip.foleyVolume}
                            onChange={(e) =>
                              handleUpdateClipsAudio({
                                foleyVolume: Number(e.target.value),
                                customVolumeSet: true,
                              })
                            }
                            onKeyDown={(e) => e.stopPropagation()}
                            className="w-14 bg-slate-950 border border-emerald-500/40 rounded px-1.5 py-0.5 text-[11px] font-mono text-emerald-200 text-right"
                          />
                          <span className="text-[10px] text-emerald-300 font-bold">%</span>
                        </div>
                      </div>
                      <input
                        type="range"
                        min={0}
                        max={100}
                        step={1}
                        value={selectedClip.audioMuted ? 0 : selectedClip.foleyVolume}
                        onChange={(e) =>
                          handleUpdateClipsAudio({
                            foleyVolume: Number(e.target.value),
                            customVolumeSet: true,
                          })
                        }
                        className="w-full accent-emerald-400 cursor-pointer"
                      />
                    </div>

                    {/* Both Fades: Fade In (s) & Fade Out (s) */}
                    {(() => {
                      const isIntroClip =
                        selectedClip.id === 'fixed-doc-intro' || selectedClip.clipNumber === 0;
                      const isOutroClip =
                        selectedClip.id === 'fixed-doc-outro' || selectedClip.clipNumber === 999;
                      const effFadeIn =
                        typeof selectedClip.audioFadeInSec === 'number'
                          ? selectedClip.audioFadeInSec
                          : isIntroClip || isOutroClip
                          ? 1.5
                          : selectedClip.clipNumber === 1
                          ? 1.2
                          : 0;
                      const effFadeOut =
                        typeof selectedClip.audioFadeOutSec === 'number'
                          ? selectedClip.audioFadeOutSec
                          : isIntroClip || isOutroClip
                          ? 2.5
                          : 0;
                      const maxFadeSec = Math.max(2, Math.min(15, Number((selectedClip.duration || 8).toFixed(1))));
                      return (
                        <div className="grid grid-cols-2 gap-2.5 pt-1 border-t border-emerald-500/20">
                          <div>
                            <div className="flex items-center justify-between text-[10px] text-emerald-200 mb-0.5">
                              <span className="font-semibold">📈 Fade In:</span>
                              <div className="flex items-center gap-0.5">
                                <input
                                  type="number"
                                  min={0}
                                  max={15}
                                  step={0.1}
                                  value={effFadeIn}
                                  onChange={(e) =>
                                    handleUpdateClipsAudio({
                                      audioFadeInSec: Math.max(0, Number(e.target.value || 0)),
                                    })
                                  }
                                  onKeyDown={(e) => e.stopPropagation()}
                                  className="w-12 bg-slate-950 border border-emerald-500/40 rounded px-1 py-0.5 text-[10px] text-white font-mono text-right"
                                />
                                <span>s</span>
                              </div>
                            </div>
                            <input
                              type="range"
                              min={0}
                              max={maxFadeSec}
                              step={0.1}
                              value={Math.min(maxFadeSec, effFadeIn)}
                              onChange={(e) =>
                                handleUpdateClipsAudio({
                                  audioFadeInSec: Number(e.target.value),
                                })
                              }
                              className="w-full accent-emerald-400 cursor-pointer"
                            />
                          </div>

                          <div>
                            <div className="flex items-center justify-between text-[10px] text-emerald-200 mb-0.5">
                              <span className="font-semibold">📉 Fade Out:</span>
                              <div className="flex items-center gap-0.5">
                                <input
                                  type="number"
                                  min={0}
                                  max={15}
                                  step={0.1}
                                  value={effFadeOut}
                                  onChange={(e) =>
                                    handleUpdateClipsAudio({
                                      audioFadeOutSec: Math.max(0, Number(e.target.value || 0)),
                                    })
                                  }
                                  onKeyDown={(e) => e.stopPropagation()}
                                  className="w-12 bg-slate-950 border border-emerald-500/40 rounded px-1 py-0.5 text-[10px] text-white font-mono text-right"
                                />
                                <span>s</span>
                              </div>
                            </div>
                            <input
                              type="range"
                              min={0}
                              max={maxFadeSec}
                              step={0.1}
                              value={Math.min(maxFadeSec, effFadeOut)}
                              onChange={(e) =>
                                handleUpdateClipsAudio({
                                  audioFadeOutSec: Number(e.target.value),
                                })
                              }
                              className="w-full accent-emerald-400 cursor-pointer"
                            />
                          </div>
                        </div>
                      );
                    })()}

                    <div className="flex items-center justify-between gap-1.5 pt-1 border-t border-emerald-500/20 flex-wrap">
                      <button
                        type="button"
                        onClick={() => {
                          const fi = selectedClip.audioFadeInSec ?? 0;
                          const fo = selectedClip.audioFadeOutSec ?? 0;
                          handleUpdateClipsAudio(
                            {
                              foleyVolume: selectedClip.foleyVolume,
                              audioFadeInSec: fi,
                              audioFadeOutSec: fo,
                              audioMuted: Boolean(selectedClip.audioMuted),
                              customVolumeSet: true,
                            },
                            true
                          );
                          setStatusMessage(
                            `🔊 Volumen (${selectedClip.foleyVolume}%), Fade-In (${fi}s) y Fade-Out (${fo}s) aplicados a los ${timelineClips.length} clips.`
                          );
                        }}
                        className="px-2 py-1 rounded-lg bg-emerald-500 hover:bg-emerald-400 text-slate-950 font-black text-[10px] cursor-pointer"
                        title="Aplicar este mismo Volumen, Fade-In y Fade-Out a todos los clips del timeline"
                      >
                        ✨ Aplicar Audio y Fades a Todos los Clips
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          const isSelBroll = Boolean(
                            selectedClip.isStaticBroll ||
                              /_broll_4k/i.test(selectedClip.fileName || '') ||
                              activeDoc?.clips?.some(
                                (dc) => dc.clipNumber === selectedClip.clipNumber && dc.isStaticBroll
                              )
                          );
                          handleUpdateClipsAudio({
                            foleyVolume: isSelBroll ? 0 : selectedClip.clipNumber === 1 ? 80 : 20,
                            audioFadeInSec: undefined,
                            audioFadeOutSec: undefined,
                            audioMuted: isSelBroll,
                            customVolumeSet: false,
                          });
                          setStatusMessage('🔄 Volumen y Fades del clip restaurados.');
                        }}
                        className="px-2 py-1 rounded-lg bg-slate-900 hover:bg-slate-800 border border-slate-700 text-slate-300 font-semibold text-[10px] cursor-pointer"
                      >
                        🔄 Restaurar
                      </button>
                    </div>
                  </div>

                  {/* 1. CUT / SPLIT / DELETE TOOLS (WITH AUTO-STRETCH SMOOTH SLOW MOTION) */}
                  {selectedClip.clipNumber !== 0 && selectedClip.clipNumber !== 999 && (
                    <div className="bg-slate-900/90 border border-slate-800 rounded-lg p-2.5 space-y-2">
                      <div className="flex items-center justify-between gap-1">
                        <span className="text-[11px] font-bold text-amber-200 flex items-center gap-1">
                          <Scissors className="w-3.5 h-3.5 text-amber-400" />
                          Cortar y Eliminar (Estira el resto con Smooth Slow Motion)
                        </span>
                        <span className="text-[10px] font-mono text-slate-400">
                          Fuente activa: {(selectedClip.trimStart || 0).toFixed(1)}s -{' '}
                          {(
                            selectedClip.trimEnd ??
                            selectedClip.sourceDuration ??
                            8
                          ).toFixed(1)}
                          s ({getClipActiveSourceSpan(selectedClip).toFixed(2)}s)
                        </span>
                      </div>

                      <div className="grid grid-cols-2 gap-1.5">
                        <button
                          type="button"
                          onClick={() => handleSplitClipAtPlayhead(selectedClip.id)}
                          className="px-2.5 py-1.5 rounded-lg bg-amber-500 hover:bg-amber-400 text-slate-950 font-black text-[11px] flex items-center justify-center gap-1.5 cursor-pointer shadow"
                          title="Divide el clip en 2 partes exactas donde está la aguja roja. Al borrar una de las partes, la otra se estira automáticamente con Smooth Slow Motion para cubrir los segundos originales."
                        >
                          <Scissors className="w-3.5 h-3.5" />
                          ✂️ Dividir en Aguja
                        </button>

                        <button
                          type="button"
                          onClick={() => handleDeleteClipOrStretchSibling(selectedClip.id, false)}
                          className="px-2.5 py-1.5 rounded-lg bg-rose-600/90 hover:bg-rose-500 text-white font-black text-[11px] flex items-center justify-center gap-1 cursor-pointer shadow"
                          title={
                            selectedClip.partLabel || selectedClip.parentGroupId
                              ? 'Elimina este pedazo cortado y estira automáticamente el resto del mismo clip con Smooth Slow Motion (Optical Flow) para cubrir sus segundos originales'
                              : 'Eliminar este clip de la línea de tiempo'
                          }
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                          {selectedClip.partLabel || selectedClip.parentGroupId
                            ? 'Eliminar Pedazo (Auto Slow-Mo)'
                            : 'Eliminar Clip'}
                        </button>
                      </div>

                      <div className="grid grid-cols-2 gap-1.5">
                        <button
                          type="button"
                          onClick={() => handleCutFromStartToPlayhead(selectedClip.id)}
                          className="px-2 py-1 rounded bg-slate-800 hover:bg-slate-700 border border-slate-700 text-sky-200 font-semibold text-[10px] cursor-pointer text-center"
                          title="Borra desde el inicio del clip hasta la aguja roja y estira automáticamente el resto con Smooth Slow Motion para seguir cubriendo sus segundos originales"
                        >
                          ⏪ Borrar Inicio → Aguja (Slow-Mo)
                        </button>
                        <button
                          type="button"
                          onClick={() => handleCutFromPlayheadToEnd(selectedClip.id)}
                          className="px-2 py-1 rounded bg-slate-800 hover:bg-slate-700 border border-slate-700 text-sky-200 font-semibold text-[10px] cursor-pointer text-center"
                          title="Borra desde la aguja roja hasta el final del clip y estira automáticamente el inicio con Smooth Slow Motion para seguir cubriendo sus segundos originales"
                        >
                          ⏩ Borrar Aguja → Final (Slow-Mo)
                        </button>
                      </div>

                      {/* Numeric Trim Start / Trim End Controls */}
                      <div className="grid grid-cols-2 gap-2 pt-1 border-t border-slate-800/80">
                        <div>
                          <label className="block text-[10px] text-slate-400">
                            Recorte Inicio Fuente (s):
                          </label>
                          <input
                            type="number"
                            step={0.1}
                            min={0}
                            max={Math.max(
                              0,
                              (selectedClip.trimEnd ?? selectedClip.sourceDuration ?? 8) - 0.5
                            )}
                            value={Number((selectedClip.trimStart || 0).toFixed(2))}
                            onChange={(e) => {
                              const nextStart = Math.max(0, Number(e.target.value));
                              const curEnd =
                                selectedClip.trimEnd ?? selectedClip.sourceDuration ?? 8;
                              handleUpdateClipTrimBounds(
                                selectedClip.id,
                                nextStart,
                                curEnd,
                                autoStretchOnTrim
                              );
                            }}
                            className="w-full bg-slate-950 border border-slate-700 rounded px-2 py-1 text-xs text-white mt-0.5"
                          />
                        </div>
                        <div>
                          <label className="block text-[10px] text-slate-400">
                            Recorte Fin Fuente (s):
                          </label>
                          <input
                            type="number"
                            step={0.1}
                            min={(selectedClip.trimStart || 0) + 0.5}
                            max={selectedClip.sourceDuration || 12}
                            value={Number(
                              (
                                selectedClip.trimEnd ??
                                selectedClip.sourceDuration ??
                                8
                              ).toFixed(2)
                            )}
                            onChange={(e) => {
                              const nextEnd = Math.max(0.5, Number(e.target.value));
                              const curStart = selectedClip.trimStart || 0;
                              handleUpdateClipTrimBounds(
                                selectedClip.id,
                                curStart,
                                nextEnd,
                                autoStretchOnTrim
                              );
                            }}
                            className="w-full bg-slate-950 border border-slate-700 rounded px-2 py-1 text-xs text-white mt-0.5"
                          />
                        </div>
                      </div>

                      <div className="flex items-center justify-between gap-2 pt-0.5">
                        <label className="flex items-center gap-1.5 text-[10px] text-emerald-300 cursor-pointer">
                          <input
                            type="checkbox"
                            checked={autoStretchOnTrim}
                            onChange={(e) => setAutoStretchOnTrim(e.target.checked)}
                            className="accent-emerald-500 rounded cursor-pointer"
                          />
                          <span>
                            Al recortar un pedazo, estirar el resto con Smooth Slow Motion para cubrir sus{' '}
                            {selectedClip.originalSlotDuration || selectedClip.duration}s originales
                          </span>
                        </label>

                        {(selectedClip.trimStart > 0.05 ||
                          (selectedClip.trimEnd &&
                            selectedClip.trimEnd < (selectedClip.sourceDuration || 8) - 0.05) ||
                          selectedClip.partLabel ||
                          selectedClip.speed !== 1) && (
                          <button
                            type="button"
                            onClick={() => handleResetClipToOriginal(selectedClip.id)}
                            className="px-2 py-0.5 rounded bg-slate-800 hover:bg-slate-700 border border-slate-600 text-[10px] text-amber-300 font-semibold whitespace-nowrap cursor-pointer"
                            title="Restaurar este clip a su estado original completo (1.00x sin recortes)"
                          >
                            🔄 Restaurar Original
                          </button>
                        )}
                      </div>
                    </div>
                  )}

                  {/* 2. BIDIRECTIONAL SPEED (x, 1x = NORMAL) <-> TIME IN SECONDS (s) */}
                  <div className="bg-slate-900/90 border border-slate-800 rounded-lg p-2.5 space-y-2">
                    <div className="flex items-center justify-between">
                      <span className="text-[11px] font-bold text-sky-300">
                        ⚡ Velocidad (1x = Normal) ↔ Tiempo en Segundos
                      </span>
                      <span className="text-[10px] font-mono text-amber-300 font-bold">
                        {selectedClip.speed}x = {selectedClip.duration}s
                      </span>
                    </div>

                    <div className="grid grid-cols-3 gap-2">
                      <div>
                        <label className="block text-[10px] text-slate-300 font-semibold">
                          Velocidad (x)
                        </label>
                        <input
                          type="number"
                          step={0.05}
                          min={0.2}
                          max={4}
                          value={selectedClip.speed}
                          onChange={(e) => {
                            const val = Math.max(0.2, Number(e.target.value));
                            handleUpdateClipSpeed(selectedClip.id, val);
                          }}
                          className="w-full bg-slate-950 border border-sky-500/40 rounded px-2 py-1 text-xs font-mono text-sky-200 mt-0.5"
                          title="Ajusta la velocidad en multiplicador x (1x es la velocidad normal; < 1x activa Smooth Slow Motion)"
                        />
                      </div>
                      <div>
                        <label className="block text-[10px] text-slate-300 font-semibold">
                          Tiempo (Segundos)
                        </label>
                        <input
                          type="number"
                          step={0.1}
                          min={0.5}
                          max={60}
                          value={selectedClip.duration}
                          onChange={(e) => {
                            const val = Math.max(0.5, Number(e.target.value));
                            handleUpdateClipDurationSeconds(selectedClip.id, val);
                          }}
                          className="w-full bg-slate-950 border border-amber-500/40 rounded px-2 py-1 text-xs font-mono text-amber-200 mt-0.5"
                          title="Ajusta el tiempo en segundos que dura este clip y recalcula la velocidad (x) automáticamente"
                        />
                      </div>
                      <div>
                        <label className="block text-[10px] text-slate-400">Volumen Foley (%)</label>
                        <input
                          type="number"
                          min={0}
                          max={100}
                          value={selectedClip.audioMuted ? 0 : selectedClip.foleyVolume}
                          onChange={(e) => {
                            const val = Math.min(100, Math.max(0, Number(e.target.value)));
                            handleUpdateClipsAudio({
                              foleyVolume: val,
                              customVolumeSet: true,
                            });
                          }}
                          onKeyDown={(e) => e.stopPropagation()}
                          className="w-full bg-slate-950 border border-slate-700 rounded px-2 py-1 text-xs text-white mt-0.5"
                        />
                      </div>
                    </div>

                    {/* Speed Slider + Quick Presets (0.5x, 0.75x, 0.8x, 1x Normal, 1.25x, 1.5x, 2x) */}
                    <div className="space-y-1.5">
                      <input
                        type="range"
                        min={0.25}
                        max={2.0}
                        step={0.01}
                        value={Math.max(0.25, Math.min(2.0, selectedClip.speed))}
                        onChange={(e) =>
                          handleUpdateClipSpeed(selectedClip.id, Number(e.target.value))
                        }
                        className="w-full accent-sky-400 cursor-pointer"
                      />
                      <div className="flex items-center justify-between gap-1 flex-wrap">
                        {[
                          { label: '0.5x', spd: 0.5 },
                          { label: '0.75x', spd: 0.75 },
                          { label: '0.8x', spd: 0.8 },
                          { label: '1x (Normal)', spd: 1.0 },
                          { label: '1.25x', spd: 1.25 },
                          { label: '1.5x', spd: 1.5 },
                          { label: '2x', spd: 2.0 },
                        ].map((p) => {
                          const isAct = Math.abs(selectedClip.speed - p.spd) < 0.02;
                          return (
                            <button
                              key={p.label}
                              type="button"
                              onClick={() => handleUpdateClipSpeed(selectedClip.id, p.spd)}
                              className={`px-1.5 py-0.5 rounded text-[10px] font-bold cursor-pointer transition ${
                                isAct
                                  ? 'bg-sky-500 text-slate-950 shadow'
                                  : 'bg-slate-800 hover:bg-slate-700 text-slate-300'
                              }`}
                            >
                              {p.label}
                            </button>
                          );
                        })}
                        {selectedClip.originalSlotDuration &&
                          Math.abs(selectedClip.duration - selectedClip.originalSlotDuration) >
                            0.1 && (
                            <button
                              type="button"
                              onClick={() =>
                                handleUpdateClipDurationSeconds(
                                  selectedClip.id,
                                  selectedClip.originalSlotDuration!
                                )
                              }
                              className="px-2 py-0.5 rounded bg-amber-500/20 hover:bg-amber-500/30 border border-amber-500/40 text-amber-300 text-[10px] font-bold cursor-pointer"
                              title="Ajustar velocidad automáticamente para que el clip cubra sus segundos originales"
                            >
                              ⏱️ Cubrir {selectedClip.originalSlotDuration}s orig.
                            </button>
                          )}
                      </div>
                    </div>

                    {/* 3. CAPCUT-STYLE SMOOTH SLOW MOTION (OPTICAL FLOW) SWITCH — ACTIVE BY DEFAULT WHEN SPEED < 1.00x */}
                    <div
                      className={`rounded-lg p-2 border transition ${
                        selectedClip.speed < 1.0 && selectedClip.smoothSlowMo !== false
                          ? 'bg-sky-950/45 border-sky-500/50'
                          : 'bg-slate-950/70 border-slate-800'
                      }`}
                    >
                      <div className="flex items-center justify-between gap-2 flex-wrap">
                        <label className="flex items-center gap-2 cursor-pointer select-none">
                          <input
                            type="checkbox"
                            checked={
                              selectedClip.smoothSlowMo !== undefined
                                ? selectedClip.smoothSlowMo
                                : selectedClip.speed < 1.0
                            }
                            onChange={(e) => {
                              const checked = e.target.checked;
                              let targetForFlow: TimelineClipItem | null = null;
                              commitTimelineClipsUpdate(
                                (prev) =>
                                  prev.map((c) => {
                                    if (c.id !== selectedClip.id) return c;
                                    const nextClip = { ...c, smoothSlowMo: checked };
                                    targetForFlow = nextClip;
                                    return nextClip;
                                  }),
                                false
                              );
                              if (checked && targetForFlow && selectedClip.speed < 1.0) {
                                triggerOpticalFlowForClip(targetForFlow, false);
                              }
                            }}
                            className="w-3.5 h-3.5 accent-sky-400 rounded cursor-pointer"
                          />
                          <span className="text-[11px] font-black text-sky-200">
                            🌊 Smooth Slow Motion (Optical Flow — Estilo CapCut)
                          </span>
                        </label>

                        {selectedClip.speed < 1.0 && (
                          <button
                            type="button"
                            disabled={Boolean(opticalFlowProcessingByClipId[selectedClip.id])}
                            onClick={() => triggerOpticalFlowForClip(selectedClip, false)}
                            className={`px-2 py-0.5 rounded text-[10px] font-bold cursor-pointer flex items-center gap-1 ${
                              opticalFlowProcessingByClipId[selectedClip.id]
                                ? 'bg-sky-500/20 text-sky-300 animate-pulse'
                                : selectedClip.opticalFlowUrl
                                ? 'bg-emerald-500/20 border border-emerald-500/40 text-emerald-300 hover:bg-emerald-500/30'
                                : 'bg-sky-500 hover:bg-sky-400 text-slate-950'
                            }`}
                          >
                            {opticalFlowProcessingByClipId[selectedClip.id]
                              ? '🌊 Interpolando Optical Flow...'
                              : selectedClip.opticalFlowUrl
                              ? '✅ Optical Flow Listo (Re-aplicar)'
                              : '🌊 Generar Optical Flow'}
                          </button>
                        )}
                      </div>
                      <div className="text-[10px] text-slate-400 mt-1">
                        {selectedClip.speed < 1.0
                          ? '✨ Activo por defecto (< 1.00x): sintetiza fotogramas intermedios por flujo óptico (FFmpeg minterpolate MCI) para una cámara lenta sedosa sin saltos.'
                          : 'Se marca activo automáticamente en cuanto la velocidad baja de 1.00x.'}
                      </div>
                    </div>
                  </div>

                  <div className="flex items-center justify-between gap-2 pt-1">
                    <select
                      value={selectedClip.transition}
                      onChange={(e) => {
                        const val = e.target.value as ClipTransitionType;
                        commitTimelineClipsUpdate(
                          (prev) =>
                            prev.map((c) =>
                              c.id === selectedClip.id ? { ...c, transition: val } : c
                            ),
                          false
                        );
                      }}
                      className="bg-slate-900 border border-slate-700 rounded px-2 py-1 text-xs text-slate-200"
                    >
                      {TRANSITION_OPTIONS.map((t) => (
                        <option key={t.value} value={t.value}>
                          Transición de este clip: {t.label}
                        </option>
                      ))}
                    </select>

                    <label className="px-2.5 py-1 rounded bg-slate-800 hover:bg-slate-700 text-amber-300 text-[11px] font-semibold cursor-pointer">
                      🔄 Reemplazar .MP4
                      <input
                        type="file"
                        accept="video/mp4,video/*"
                        onChange={(e) => {
                          const f = e.target.files?.[0];
                          if (!f) return;
                          const url = URL.createObjectURL(f);
                          commitTimelineClipsUpdate((prev) =>
                            prev.map((c) =>
                              c.id === selectedClip.id
                                ? {
                                    ...c,
                                    videoUrl: url,
                                    fileName: f.name,
                                    opticalFlowUrl: undefined,
                                    opticalFlowBakedKey: undefined,
                                  }
                                : c
                            )
                          );
                        }}
                        className="hidden"
                      />
                    </label>
                  </div>
                </div>
              )}
            </div>
          )}

          {/* TAB 2: AUDIO MIXING, VOICE OFFSET, AUTO-DUCKING & SUNO */}
          {activeInspectorTab === 'audio' && (
            <div className="flex flex-col gap-3 text-xs flex-1 min-h-0 overflow-y-auto pr-1">
              {selectedClip && (
                <div className="bg-emerald-950/35 border border-emerald-500/50 rounded-xl p-3 space-y-2">
                  <div className="flex items-center justify-between gap-2 flex-wrap">
                    <span className="font-black text-emerald-300 text-xs flex items-center gap-1.5">
                      <Volume2 className="w-3.5 h-3.5 text-emerald-400" />
                      {activeTargetClipIds.length > 1
                        ? `🎬 Audio de ${activeTargetClipIds.length} Clips Seleccionados`
                        : `🎬 Audio de Clip ${
                            selectedClip.clipNumber === 0
                              ? 'INTRO'
                              : selectedClip.clipNumber === 999
                              ? 'OUTRO'
                              : String(selectedClip.clipNumber).padStart(2, '0')
                          }`}
                    </span>
                    <button
                      type="button"
                      onClick={() => {
                        const allIds = timelineClips.map((c) => c.id);
                        setSelectedClipIds(
                          selectedClipIds.length === allIds.length ? [selectedClip.id] : allIds
                        );
                      }}
                      className="px-2 py-0.5 rounded bg-slate-900 hover:bg-slate-800 border border-emerald-500/40 text-emerald-200 text-[10px] font-bold cursor-pointer"
                    >
                      {selectedClipIds.length === timelineClips.length
                        ? '✓ Todos Seleccionados'
                        : `☑ Seleccionar Todos (${timelineClips.length})`}
                    </button>
                  </div>
                  <div className="grid grid-cols-3 gap-2">
                    <div>
                      <div className="flex items-center justify-between text-[10px] text-slate-300 font-semibold mb-0.5">
                        <span>🔊 Vol:</span>
                        <div className="flex items-center gap-0.5">
                          <input
                            type="number"
                            min={0}
                            max={100}
                            step={1}
                            value={selectedClip.audioMuted ? 0 : selectedClip.foleyVolume}
                            onChange={(e) =>
                              handleUpdateClipsAudio({
                                foleyVolume: Number(e.target.value),
                                customVolumeSet: true,
                              })
                            }
                            onKeyDown={(e) => e.stopPropagation()}
                            className="w-11 bg-slate-950 border border-emerald-500/40 rounded px-1 py-0.5 text-[10px] text-emerald-200 font-mono text-right"
                          />
                          <span>%</span>
                        </div>
                      </div>
                      <input
                        type="range"
                        min={0}
                        max={100}
                        step={1}
                        value={selectedClip.audioMuted ? 0 : selectedClip.foleyVolume}
                        onChange={(e) =>
                          handleUpdateClipsAudio({
                            foleyVolume: Number(e.target.value),
                            customVolumeSet: true,
                          })
                        }
                        className="w-full accent-emerald-400 cursor-pointer mt-1"
                      />
                    </div>
                    <div>
                      <div className="flex items-center justify-between text-[10px] text-slate-300 font-semibold mb-0.5">
                        <span>📈 In:</span>
                        <div className="flex items-center gap-0.5">
                          <input
                            type="number"
                            min={0}
                            max={15}
                            step={0.1}
                            value={selectedClip.audioFadeInSec ?? 0}
                            onChange={(e) =>
                              handleUpdateClipsAudio({
                                audioFadeInSec: Math.max(0, Number(e.target.value || 0)),
                              })
                            }
                            onKeyDown={(e) => e.stopPropagation()}
                            className="w-11 bg-slate-950 border border-emerald-500/40 rounded px-1 py-0.5 text-[10px] text-white font-mono text-right"
                          />
                          <span>s</span>
                        </div>
                      </div>
                      <input
                        type="range"
                        min={0}
                        max={10}
                        step={0.1}
                        value={Math.min(10, selectedClip.audioFadeInSec ?? 0)}
                        onChange={(e) =>
                          handleUpdateClipsAudio({
                            audioFadeInSec: Number(e.target.value),
                          })
                        }
                        className="w-full accent-emerald-400 cursor-pointer mt-1"
                      />
                    </div>
                    <div>
                      <div className="flex items-center justify-between text-[10px] text-slate-300 font-semibold mb-0.5">
                        <span>📉 Out:</span>
                        <div className="flex items-center gap-0.5">
                          <input
                            type="number"
                            min={0}
                            max={15}
                            step={0.1}
                            value={selectedClip.audioFadeOutSec ?? 0}
                            onChange={(e) =>
                              handleUpdateClipsAudio({
                                audioFadeOutSec: Math.max(0, Number(e.target.value || 0)),
                              })
                            }
                            onKeyDown={(e) => e.stopPropagation()}
                            className="w-11 bg-slate-950 border border-emerald-500/40 rounded px-1 py-0.5 text-[10px] text-white font-mono text-right"
                          />
                          <span>s</span>
                        </div>
                      </div>
                      <input
                        type="range"
                        min={0}
                        max={10}
                        step={0.1}
                        value={Math.min(10, selectedClip.audioFadeOutSec ?? 0)}
                        onChange={(e) =>
                          handleUpdateClipsAudio({
                            audioFadeOutSec: Number(e.target.value),
                          })
                        }
                        className="w-full accent-emerald-400 cursor-pointer mt-1"
                      />
                    </div>
                  </div>
                </div>
              )}

              <div className="bg-slate-950/90 border border-slate-800 rounded-xl p-3 space-y-2.5">
                <div className="flex items-center justify-between">
                  <span className="font-bold text-emerald-300">
                    🎙️ Pista 4: Voz Narrativa (Entrada después del Clip 1)
                  </span>
                  <span className="font-mono text-amber-300">
                    Entra en: 00:0{voiceStartOffsetSec}s
                  </span>
                </div>
                {effectiveVoiceoverUrl ? (
                  <div className="space-y-1.5">
                    <audio
                      controls
                      src={effectiveVoiceoverUrl}
                      className="w-full h-8 rounded"
                    />
                    <div className="flex items-center gap-2 flex-wrap">
                      <a
                        href={effectiveVoiceoverUrl}
                        download={`Voz_Narrativa_${(activeDoc?.title || 'Documental').replace(/[^a-zA-Z0-9_-]/g, '_')}.mp3`}
                        className="px-2.5 py-1 rounded-lg bg-emerald-500/20 hover:bg-emerald-500/30 border border-emerald-500/40 text-emerald-200 font-bold text-[11px]"
                      >
                        ⬇️ Descargar Audio de Voz (.MP3)
                      </a>
                      <label className="px-2.5 py-1 rounded-lg bg-slate-800 hover:bg-slate-700 border border-slate-700 text-amber-300 font-bold text-[11px] cursor-pointer">
                        📤 Cambiar Audio de Voz (.MP3/.WAV)
                        <input
                          type="file"
                          accept="audio/*,.mp3,.wav,.m4a"
                          className="hidden"
                          onChange={(e) => {
                            const f = e.target.files?.[0];
                            if (!f) return;
                            const url = URL.createObjectURL(f);
                            setVoiceAudioError(false);
                            updateActiveDoc({ masterAudioUrl: url });
                            setStatusMessage(`✅ Audio de voz narrativa "${f.name}" cargado en Pista 4.`);
                            e.target.value = '';
                          }}
                        />
                      </label>
                    </div>
                  </div>
                ) : (
                  <div className="flex items-center justify-between gap-2 bg-amber-500/10 border border-amber-500/30 rounded-lg p-2">
                    <span className="text-[11px] text-amber-200">
                      ⚠️ No hay archivo de voz cargado todavía.
                    </span>
                    <label className="px-2.5 py-1 rounded-lg bg-amber-500 hover:bg-amber-400 text-slate-950 font-black text-[11px] cursor-pointer shrink-0">
                      📤 Subir Audio de Voz (.MP3/.WAV)
                      <input
                        type="file"
                        accept="audio/*,.mp3,.wav,.m4a"
                        className="hidden"
                        onChange={(e) => {
                          const f = e.target.files?.[0];
                          if (!f) return;
                          const url = URL.createObjectURL(f);
                          setVoiceAudioError(false);
                          updateActiveDoc({ masterAudioUrl: url });
                          setStatusMessage(`✅ Audio de voz narrativa "${f.name}" cargado en Pista 4.`);
                          e.target.value = '';
                        }}
                      />
                    </label>
                  </div>
                )}
                <div className="flex items-center gap-3">
                  <label className="text-[11px] text-slate-400">Segundo de entrada:</label>
                  <input
                    type="number"
                    min={0}
                    max={20}
                    step={0.5}
                    value={voiceStartOffsetSec}
                    onChange={(e) => setVoiceStartOffsetSec(Math.max(0, Number(e.target.value)))}
                    className="w-20 bg-slate-900 border border-slate-700 rounded px-2 py-1 text-xs text-white"
                  />
                  <label className="text-[11px] text-slate-400">
                    Volumen Voz: {voiceVolume}%{' '}
                    <span className="text-emerald-400 font-bold">
                      ({voiceGainDb >= 0 ? `+${voiceGainDb}` : voiceGainDb} dB)
                    </span>
                  </label>
                  <input
                    type="range"
                    min={50}
                    max={100}
                    value={voiceVolume}
                    onChange={(e) => setVoiceVolume(Number(e.target.value))}
                    className="flex-1 accent-emerald-500"
                  />
                  <label className="text-[11px] text-emerald-300 font-bold shrink-0">Ganancia dB:</label>
                  <input
                    type="number"
                    min={0}
                    max={12}
                    step={0.5}
                    value={voiceGainDb}
                    onChange={(e) => setVoiceGainDb(Number(e.target.value))}
                    className="w-16 bg-slate-900 border border-emerald-500/40 rounded px-2 py-1 text-xs text-emerald-300 font-bold"
                  />
                </div>
              </div>

              <div className="bg-slate-950/90 border border-slate-800 rounded-xl p-3 space-y-2">
                <label className="flex items-center gap-2 font-bold text-amber-300 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={autoDuckingEnabled}
                    onChange={(e) => setAutoDuckingEnabled(e.target.checked)}
                    className="accent-amber-500"
                  />
                  <span>🔊 Auto-Ducking Inteligente del Sonido Foley</span>
                </label>
                <div className="grid grid-cols-2 gap-3 pt-1">
                  <div>
                    <label className="block text-[11px] text-slate-400">
                      Foley sin Voz (Clip 1 y pausas): {foleyHighVolume}%
                    </label>
                    <input
                      type="range"
                      min={20}
                      max={100}
                      value={foleyHighVolume}
                      onChange={(e) => setFoleyHighVolume(Number(e.target.value))}
                      className="w-full accent-amber-500"
                    />
                  </div>
                  <div>
                    <label className="block text-[11px] text-slate-400">
                      Foley cuando habla el Narrador: {foleyDuckedVolume}%
                    </label>
                    <input
                      type="range"
                      min={5}
                      max={70}
                      value={foleyDuckedVolume}
                      onChange={(e) => setFoleyDuckedVolume(Number(e.target.value))}
                      className="w-full accent-emerald-500"
                    />
                  </div>
                </div>
              </div>

              <div
                className={`bg-slate-950/90 border border-purple-500/40 rounded-xl p-3 space-y-2.5 ${
                  selectedMusicTrack ? 'order-first ring-1 ring-purple-400' : ''
                }`}
              >
                <div className="flex items-center justify-between gap-2 flex-wrap">
                  <span className="font-bold text-purple-300">
                    🎵 Pista 5: Música Flow Music (Selecciona una canción en el timeline o aquí)
                  </span>
                  <span className="font-mono text-purple-200 text-[11px]">
                    Actual en Aguja: {effectiveMusicVolumeAtPlayhead}%
                  </span>
                </div>

                {musicTracks.length > 0 && (
                  <div className="flex items-center gap-1.5 flex-wrap">
                    {musicTracks.map((mt) => {
                      const isSel = selectedMusicTrack?.id === mt.id;
                      return (
                        <button
                          key={mt.id}
                          type="button"
                          onClick={() => setSelectedMusicTrackId(mt.id)}
                          className={`px-2 py-1 rounded-lg border text-[10px] font-bold transition cursor-pointer flex items-center gap-1 ${
                            isSel
                              ? 'bg-purple-500 text-slate-950 border-purple-300 shadow shadow-purple-500/30'
                              : 'bg-slate-900 hover:bg-slate-800 text-purple-200 border-slate-700'
                          }`}
                          title={`${mt.title} (${formatTimeMMSS(mt.start)} - ${formatTimeMMSS(
                            mt.start + mt.duration
                          )})`}
                        >
                          <span>#{mt.trackNumber}</span>
                          <span className="max-w-[110px] truncate">{mt.title}</span>
                          <span className="opacity-80">({mt.volume ?? masterMusicVolume}%)</span>
                        </button>
                      );
                    })}
                  </div>
                )}

                {selectedMusicTrack ? (
                  <div className="bg-purple-950/35 border border-purple-500/40 rounded-lg p-2.5 space-y-2">
                    <div className="flex items-center justify-between gap-2 flex-wrap">
                      <div className="text-[11px] font-bold text-purple-200 truncate">
                        🎶 #{selectedMusicTrack.trackNumber} {selectedMusicTrack.title}{' '}
                        <span className="text-purple-300/80 font-mono text-[10px]">
                          ({formatTimeMMSS(selectedMusicTrack.start)} -{' '}
                          {formatTimeMMSS(selectedMusicTrack.start + selectedMusicTrack.duration)})
                        </span>
                      </div>
                      <div className="flex items-center gap-1 shrink-0">
                        <button
                          type="button"
                          onClick={() => seekToTime(selectedMusicTrack.start + 0.05)}
                          className="px-2 py-0.5 rounded bg-purple-500/25 hover:bg-purple-500/40 border border-purple-400/40 text-purple-200 text-[10px] font-bold cursor-pointer"
                          title="Mover la aguja al inicio de esta canción para escuchar el Fade-In"
                        >
                          ▶ Probar Fade In
                        </button>
                        <button
                          type="button"
                          onClick={() =>
                            seekToTime(
                              Math.max(
                                selectedMusicTrack.start,
                                selectedMusicTrack.start +
                                  selectedMusicTrack.duration -
                                  Math.max(3, (selectedMusicTrack.fadeOutSec ?? 5) + 1)
                              )
                            )
                          }
                          className="px-2 py-0.5 rounded bg-purple-500/25 hover:bg-purple-500/40 border border-purple-400/40 text-purple-200 text-[10px] font-bold cursor-pointer"
                          title="Mover la aguja al final de esta canción para escuchar el Fade-Out"
                        >
                          🔉 Probar Fade Out
                        </button>
                      </div>
                    </div>

                    <div className="grid grid-cols-3 gap-2.5">
                      <div>
                        <div className="flex items-center justify-between text-[10px] text-purple-200 mb-0.5">
                          <span>🔊 Volumen:</span>
                          <div className="flex items-center gap-0.5">
                            <input
                              type="number"
                              min={0}
                              max={100}
                              step={1}
                              value={selectedMusicTrack.volume ?? masterMusicVolume}
                              onChange={(e) => {
                                const v = Math.max(0, Math.min(100, Number(e.target.value) || 0));
                                handleUpdateMusicTrack(selectedMusicTrack.id, { volume: v });
                              }}
                              onKeyDown={(e) => e.stopPropagation()}
                              className="w-11 bg-slate-900 border border-purple-500/40 rounded px-1 py-0.5 text-[10px] text-white font-mono text-right"
                            />
                            <span>%</span>
                          </div>
                        </div>
                        <input
                          type="range"
                          min={0}
                          max={100}
                          step={1}
                          value={selectedMusicTrack.volume ?? masterMusicVolume}
                          onChange={(e) =>
                            handleUpdateMusicTrack(selectedMusicTrack.id, {
                              volume: Number(e.target.value),
                            })
                          }
                          className="w-full accent-purple-400 cursor-pointer"
                        />
                      </div>

                      <div>
                        <div className="flex items-center justify-between text-[10px] text-purple-200 mb-0.5">
                          <span>📈 Fade In:</span>
                          <div className="flex items-center gap-0.5">
                            <input
                              type="number"
                              min={0}
                              max={15}
                              step={0.5}
                              value={selectedMusicTrack.fadeInSec ?? 5}
                              onChange={(e) => {
                                const fi = Math.max(
                                  0,
                                  Math.min(15, Number(Number(e.target.value || 0).toFixed(1)))
                                );
                                handleUpdateMusicTrack(selectedMusicTrack.id, { fadeInSec: fi });
                              }}
                              onKeyDown={(e) => e.stopPropagation()}
                              className="w-11 bg-slate-900 border border-purple-500/40 rounded px-1 py-0.5 text-[10px] text-white font-mono text-right"
                            />
                            <span>s</span>
                          </div>
                        </div>
                        <input
                          type="range"
                          min={0}
                          max={15}
                          step={0.5}
                          value={selectedMusicTrack.fadeInSec ?? 5}
                          onChange={(e) =>
                            handleUpdateMusicTrack(selectedMusicTrack.id, {
                              fadeInSec: Number(e.target.value),
                            })
                          }
                          className="w-full accent-purple-400 cursor-pointer"
                        />
                      </div>

                      <div>
                        <div className="flex items-center justify-between text-[10px] text-purple-200 mb-0.5">
                          <span>📉 Fade Out:</span>
                          <div className="flex items-center gap-0.5">
                            <input
                              type="number"
                              min={0}
                              max={15}
                              step={0.5}
                              value={selectedMusicTrack.fadeOutSec ?? 5}
                              onChange={(e) => {
                                const fo = Math.max(
                                  0,
                                  Math.min(15, Number(Number(e.target.value || 0).toFixed(1)))
                                );
                                handleUpdateMusicTrack(selectedMusicTrack.id, { fadeOutSec: fo });
                              }}
                              onKeyDown={(e) => e.stopPropagation()}
                              className="w-11 bg-slate-900 border border-purple-500/40 rounded px-1 py-0.5 text-[10px] text-white font-mono text-right"
                            />
                            <span>s</span>
                          </div>
                        </div>
                        <input
                          type="range"
                          min={0}
                          max={15}
                          step={0.5}
                          value={selectedMusicTrack.fadeOutSec ?? 5}
                          onChange={(e) =>
                            handleUpdateMusicTrack(selectedMusicTrack.id, {
                              fadeOutSec: Number(e.target.value),
                            })
                          }
                          className="w-full accent-purple-400 cursor-pointer"
                        />
                      </div>
                    </div>

                    <div className="flex items-center justify-between gap-2 pt-1 border-t border-purple-500/20 flex-wrap">
                      <button
                        type="button"
                        onClick={() => {
                          handleUpdateMusicTrack(
                            selectedMusicTrack.id,
                            {
                              volume: selectedMusicTrack.volume ?? masterMusicVolume,
                              fadeInSec: selectedMusicTrack.fadeInSec ?? 5,
                              fadeOutSec: selectedMusicTrack.fadeOutSec ?? 5,
                            },
                            true
                          );
                          setStatusMessage(
                            `🎵 Volumen (${selectedMusicTrack.volume ?? masterMusicVolume}%), Fade-In (${selectedMusicTrack.fadeInSec ?? 5}s) y Fade-Out (${selectedMusicTrack.fadeOutSec ?? 5}s) aplicados a las ${musicTracks.length} canciones.`
                          );
                        }}
                        className="px-2.5 py-1 rounded-lg bg-purple-500 hover:bg-purple-400 text-slate-950 font-black text-[10px] cursor-pointer"
                      >
                        ✨ Aplicar Volumen y Fades a Todas las Canciones ({musicTracks.length})
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          handleUpdateMusicTrack(selectedMusicTrack.id, {
                            volume: DEFAULT_MUSIC_TRACK_VOLUME_PCT,
                            fadeInSec: 5,
                            fadeOutSec: 5,
                          });
                        }}
                        className="px-2 py-1 rounded-lg bg-slate-900 hover:bg-slate-800 border border-slate-700 text-slate-300 font-semibold text-[10px] cursor-pointer"
                      >
                        🔄 Restaurar Canción (20% • 5s / 5s)
                      </button>
                    </div>
                  </div>
                ) : (
                  <div className="text-[11px] text-slate-400">
                    Haz clic en cualquier canción de la Pista 5 en el timeline para ajustar su volumen, Fade-In y Fade-Out.
                  </div>
                )}
              </div>
            </div>
          )}

          {/* TAB 3: PERMANENT OFFICIAL LOGO & CLIP 1 ON-SCREEN TEXT (FONT, SIZE, SHADOW, BACKGROUND) */}
          {activeInspectorTab === 'branding' && (
            <div
              data-keep-canvas-selection="true"
              className="flex flex-col gap-3 text-xs flex-1 min-h-0 overflow-y-auto pr-1"
            >
              <div
                className={`bg-slate-950/90 border rounded-xl p-3 space-y-2.5 ${
                  selectedCanvasObject === 'logo'
                    ? 'border-amber-400 ring-1 ring-amber-400'
                    : 'border-amber-500/40'
                }`}
              >
                <div className="flex items-center justify-between gap-2">
                  <div>
                    <div className="font-bold text-amber-300">
                      🖼️ Logo Oficial "Huellas de la Humanidad" (Subir 1 Sola Vez)
                    </div>
                    <div className="text-[11px] text-slate-400">
                      Esquina superior izquierda (también seleccionable en el visor de video).
                    </div>
                  </div>
                  <label className="px-3 py-1.5 rounded-lg bg-amber-500 hover:bg-amber-400 text-slate-950 font-black text-xs cursor-pointer shrink-0">
                    {officialLogoUrl ? '🔄 Cambiar Logo' : '📤 Subir Logo Oficial'}
                    <input
                      type="file"
                      accept="image/png,image/webp,image/jpeg,image/*"
                      onChange={(e) => {
                        const file = e.target.files?.[0];
                        if (file) handleUploadPermanentLogo(file);
                      }}
                      className="hidden"
                    />
                  </label>
                </div>

                {/* PERMANENT OFFICIAL 8-SECOND INTRO ("MINIMALISMO EN PIEDRA Y ORO" — Intro.mp4) */}
                <div className="bg-slate-900/90 border border-amber-500/30 rounded-lg p-2.5 space-y-2 mt-2">
                  <div className="flex items-center justify-between gap-2 flex-wrap">
                    <div>
                      <div className="font-bold text-amber-300 text-[11px]">
                        🎬 Intro Oficial de Marca (8s — Intro.mp4 • Minimalismo en Piedra y Oro)
                      </div>
                      <div className="text-[10px] text-slate-400">
                        {officialIntroTier === 'icloud_hydrated' || officialIntroTier === 'custom_uploaded'
                          ? `✅ Hidratado desde iCloud / Guardado en SSD: ${officialIntroFileName || 'Intro.mp4 (8s)'}`
                          : '⏳ En espera de permiso iCloud de macOS (usando fallback) — o súbelo 1 vez aquí'}
                      </div>
                    </div>
                    <label className="px-2.5 py-1 rounded-lg bg-amber-500 hover:bg-amber-400 text-slate-950 font-black text-[11px] cursor-pointer shrink-0">
                      {officialIntroUrl ? '🔄 Cambiar Intro (.MP4)' : '📤 Subir Intro Oficial (.MP4 8s)'}
                      <input
                        type="file"
                        accept="video/mp4,video/webm,video/quicktime,video/*"
                        onChange={(e) => {
                          const file = e.target.files?.[0];
                          if (file) handleUploadPermanentIntro(file);
                          e.target.value = '';
                        }}
                        className="hidden"
                      />
                    </label>
                  </div>

                  <div className="flex items-center gap-2 flex-wrap">
                    <select
                      value={introPlacementMode}
                      onChange={(e) => {
                        const nextMode =
                          e.target.value === 'INTRO_POST_SLOGAN'
                            ? 'INTRO_POST_SLOGAN'
                            : 'INTRO_INICIO_00';
                        handleInsertOfficialIntroInTimeline(nextMode);
                      }}
                      className="flex-1 bg-slate-950 border border-slate-700 rounded px-2 py-1 text-[11px] text-slate-200 font-semibold"
                    >
                      <option value="INTRO_INICIO_00">
                        Opción A (Por defecto): Intro 8s Inicial (00:00 - 00:08 • Intro.mp4)
                      </option>
                      <option value="INTRO_POST_SLOGAN">
                        Opción B: Intro 8s Post-Slogan (Tras Slogan Completo "Aquí seguimos sus rastros." • Intro.mp4)
                      </option>
                    </select>
                    <button
                      type="button"
                      onClick={() => handleInsertOfficialIntroInTimeline(introPlacementMode)}
                      className="px-2.5 py-1 rounded-lg bg-emerald-500 hover:bg-emerald-400 text-slate-950 font-black text-[11px] cursor-pointer shrink-0"
                    >
                      ➕ Ubicar Intro (8s) en Línea de Tiempo
                    </button>
                  </div>

                  <div className="flex items-center gap-2 flex-wrap pt-0.5">
                    <button
                      type="button"
                      onClick={() => {
                        navigator.clipboard.writeText(
                          "Image Intro: Create an image 16:9 horizontal, studio minimal dark aesthetic, ancient weathered limestone wall in pitch-black darkness, a subtle warm torchlight glow from off-camera left grazing the rough damp stone surface to reveal the official 3D aged gold emblem and text 'HUELLAS DE LA HUMANIDAD' deeply carved into the center of the rock and dusted with fine ancient gold powder, chiaroscuro lighting, 35mm film grain, center-weighted safe framing for 2.35:1, cinematic documentary realism, no modern objects, no CGI look, no speech, no music."
                        );
                        setStatusMessage('📋 Prompt de Imagen Inicial del Intro Oficial (Nano Banana 2.1) copiado.');
                      }}
                      className="px-2 py-0.5 rounded bg-slate-800 hover:bg-slate-700 border border-slate-700 text-[10px] text-amber-200 font-semibold cursor-pointer"
                    >
                      📋 Copiar Prompt Image Intro
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        navigator.clipboard.writeText(
                          "Clip Intro (00:00 - 00:08): Create a video 16:9 horizontal cinematic documentary sequence, 8 seconds, single continuous shot, in pitch-black darkness, a warm volumetric torchlight beam sweeps slowly across a damp ancient limestone wall, revealing the carved 3D aged gold logo 'HUELLAS DE LA HUMANIDAD' gleaming subtly in the center frame before the light fades to absolute black at the final second, synchronized foley of a low atmospheric sub-bass drone, crackling torch fire movement, and a deep resonant stone and metallic sub-bass slam echoing into complete dead silence, strictly no music, strictly no speech, cinematic documentary realism, safe framing for 2.35:1, no modern objects, no CGI look except the carved logo reveal, no speech, no music."
                        );
                        setStatusMessage('📋 Prompt de Video del Intro Oficial 8s (Veo 3.1 - Lite [Lower Priority]) copiado.');
                      }}
                      className="px-2 py-0.5 rounded bg-slate-800 hover:bg-slate-700 border border-slate-700 text-[10px] text-amber-200 font-semibold cursor-pointer"
                    >
                      📋 Copiar Prompt Clip Intro (8s)
                    </button>
                  </div>

                  {/* PERMANENT OFFICIAL OUTRO ("Outro.mp4") */}
                  <div className="mt-2 pt-2 border-t border-slate-800/90 flex items-center justify-between gap-2 flex-wrap">
                    <div>
                      <div className="font-bold text-amber-300 text-[11px]">
                        🎬 Outro Oficial de Marca (Outro.mp4)
                      </div>
                      <div className="text-[10px] text-slate-400">
                        {officialOutroTier === 'icloud_hydrated' || officialOutroTier === 'custom_uploaded'
                          ? `✅ Hidratado desde iCloud / Guardado en SSD: ${officialOutroFileName || 'Outro.mp4'}`
                          : '⏳ En espera de permiso iCloud de macOS (usando fallback) — o súbelo 1 vez aquí'}
                      </div>
                    </div>
                    <label className="px-2.5 py-1 rounded-lg bg-amber-500 hover:bg-amber-400 text-slate-950 font-black text-[11px] cursor-pointer shrink-0">
                      {officialOutroTier === 'icloud_hydrated' || officialOutroTier === 'custom_uploaded'
                        ? '🔄 Cambiar Outro (.MP4)'
                        : '📤 Subir Outro Oficial (.MP4)'}
                      <input
                        type="file"
                        accept="video/mp4,video/webm,video/quicktime,video/*"
                        onChange={(e) => {
                          const file = e.target.files?.[0];
                          if (file) handleUploadPermanentOutro(file);
                          e.target.value = '';
                        }}
                        className="hidden"
                      />
                    </label>
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-3 pt-1">
                  <div>
                    <label className="block text-[11px] text-slate-400">
                      Tamaño del Logo: {logoScalePct}%
                    </label>
                    <input
                      type="range"
                      min={3}
                      max={18}
                      value={logoScalePct}
                      onChange={(e) => setLogoScalePct(Number(e.target.value))}
                      className="w-full accent-amber-500"
                    />
                  </div>
                  <div>
                    <label className="block text-[11px] text-slate-400">
                      Opacidad del Logo: {logoOpacity}%
                    </label>
                    <input
                      type="range"
                      min={20}
                      max={100}
                      value={logoOpacity}
                      onChange={(e) => setLogoOpacity(Number(e.target.value))}
                      className="w-full accent-amber-500"
                    />
                  </div>
                  <div>
                    <label className="block text-[11px] text-slate-400">
                      Posición X: {logoPosX}%
                    </label>
                    <input
                      type="range"
                      min={1}
                      max={85}
                      value={logoPosX}
                      onChange={(e) => setLogoPosX(Number(e.target.value))}
                      className="w-full accent-amber-500"
                    />
                  </div>
                  <div>
                    <label className="block text-[11px] text-slate-400">
                      Posición Y: {logoPosY}%
                    </label>
                    <input
                      type="range"
                      min={1}
                      max={85}
                      value={logoPosY}
                      onChange={(e) => setLogoPosY(Number(e.target.value))}
                      className="w-full accent-amber-500"
                    />
                  </div>
                </div>

                {/* Logo Animations (Default: Fade In 1.5s at start and Fade Out 2.5s at the end of the documentary) */}
                <div className="pt-2 border-t border-amber-500/20 space-y-1.5">
                  <div className="flex items-center justify-between">
                    <span className="font-bold text-amber-300 text-[11px]">
                      ✨ Animación del Logo (Por defecto: Fade In 1.5s al inicio • Fade Out 2.5s al final)
                    </span>
                  </div>
                  <div className="grid grid-cols-2 gap-2">
                    <div>
                      <label className="block text-[10px] text-slate-400">
                        Entrada ({logoAnimInDur}s):
                      </label>
                      <div className="flex items-center gap-1 mt-0.5">
                        <select
                          value={logoAnimIn}
                          onChange={(e) => setLogoAnimIn(e.target.value as ElementAnimationType)}
                          className="flex-1 bg-slate-900 border border-slate-700 rounded px-1.5 py-1 text-[11px] text-amber-200"
                        >
                          {ELEMENT_ANIMATION_OPTIONS.map((a) => (
                            <option key={a.value} value={a.value}>
                              {a.label}
                            </option>
                          ))}
                        </select>
                        <input
                          type="number"
                          step={0.5}
                          min={0.2}
                          max={5}
                          value={logoAnimInDur}
                          onChange={(e) => setLogoAnimInDur(Math.max(0.2, Number(e.target.value)))}
                          className="w-12 bg-slate-900 border border-slate-700 rounded px-1.5 py-1 text-[11px] text-white"
                          title="Segundos de animación de entrada"
                        />
                      </div>
                    </div>
                    <div>
                      <label className="block text-[10px] text-slate-400">
                        Salida Final ({logoAnimOutDur}s):
                      </label>
                      <div className="flex items-center gap-1 mt-0.5">
                        <select
                          value={logoAnimOut}
                          onChange={(e) => setLogoAnimOut(e.target.value as ElementAnimationType)}
                          className="flex-1 bg-slate-900 border border-slate-700 rounded px-1.5 py-1 text-[11px] text-amber-200"
                        >
                          {ELEMENT_ANIMATION_OPTIONS.map((a) => (
                            <option key={a.value} value={a.value}>
                              {a.label}
                            </option>
                          ))}
                        </select>
                        <input
                          type="number"
                          step={0.5}
                          min={0.2}
                          max={5}
                          value={logoAnimOutDur}
                          onChange={(e) => setLogoAnimOutDur(Math.max(0.2, Number(e.target.value)))}
                          className="w-12 bg-slate-900 border border-slate-700 rounded px-1.5 py-1 text-[11px] text-white"
                          title="Segundos de animación de salida al final del documental"
                        />
                      </div>
                    </div>
                  </div>
                </div>
              </div>

              <div
                className={`bg-slate-950/90 border rounded-xl p-3 space-y-2.5 ${
                  selectedCanvasObject === 'hook_text'
                    ? 'order-first border-amber-400 ring-1 ring-amber-400'
                    : 'border-slate-800'
                }`}
              >
                <div className="flex items-center justify-between gap-2">
                  <div className="font-bold text-amber-300">
                    🔤 Texto Gancho en Pantalla ({hookLine1StartSec}s - {clip1OverlayEndSec}s)
                  </div>
                  <div className="flex items-center gap-1.5">
                    <span className="text-[10px] text-emerald-400 font-semibold">
                      💾 Guardado en tiempo real
                    </span>
                    <button
                      type="button"
                      onClick={() => setSelectedCanvasObject('hook_text')}
                      className="px-2 py-0.5 rounded bg-amber-500/20 border border-amber-500/40 text-amber-300 text-[10px] font-bold cursor-pointer"
                    >
                      ✏️ Editar en Visor
                    </button>
                  </div>
                </div>
                <textarea
                  rows={Math.max(1, (clip1Line1 || '').split('\n').length)}
                  value={clip1Line1}
                  onChange={(e) => handleUpdateClip1Line1(e.target.value)}
                  onKeyDown={(e) => e.stopPropagation()}
                  placeholder="Línea 1: Ciudad, País, Año o Siglo en romanos... (Enter para saltar de línea)"
                  className="w-full bg-slate-900 border border-slate-700 rounded-lg px-2.5 py-1.5 text-xs text-amber-200 resize-y leading-tight"
                />
                <textarea
                  rows={Math.max(1, (clip1Line2 || '').split('\n').length)}
                  value={clip1Line2}
                  onChange={(e) => handleUpdateClip1Line2(e.target.value)}
                  onKeyDown={(e) => e.stopPropagation()}
                  placeholder="Línea 2: Título Gancho intrigante... (Enter para saltar de línea)"
                  className="w-full bg-slate-900 border border-slate-700 rounded-lg px-2.5 py-1.5 text-xs text-white font-bold resize-y leading-tight"
                />

                {/* Typography, Size, Color, Shadow & Background Controls */}
                <div className="grid grid-cols-2 gap-2 pt-1">
                  <div className="col-span-2">
                    <label className="block text-[10px] text-slate-400 mb-0.5">Fuente (Font):</label>
                    <select
                      value={hookFontFamily}
                      onChange={(e) => setHookFontFamily(e.target.value)}
                      className="w-full bg-slate-900 border border-slate-700 rounded-lg px-2 py-1 text-xs text-amber-200"
                    >
                      {EDITOR_FONT_OPTIONS.map((f) => (
                        <option key={f.value} value={f.value}>
                          {f.label}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <label className="block text-[10px] text-slate-400">
                      Tamaño Línea 1 ({hookLine1FontSize}px) + Color
                    </label>
                    <div className="flex items-center gap-1.5 mt-0.5">
                      <input
                        type="range"
                        min={10}
                        max={38}
                        value={hookLine1FontSize}
                        onChange={(e) => setHookLine1FontSize(Number(e.target.value))}
                        className="flex-1 accent-amber-500"
                      />
                      <input
                        type="color"
                        value={hookLine1Color}
                        onChange={(e) => setHookLine1Color(e.target.value)}
                        className="w-6 h-6 rounded cursor-pointer border-0 bg-transparent"
                      />
                    </div>
                  </div>
                  <div>
                    <label className="block text-[10px] text-slate-400">
                      Tamaño Línea 2 ({hookLine2FontSize}px) + Color
                    </label>
                    <div className="flex items-center gap-1.5 mt-0.5">
                      <input
                        type="range"
                        min={14}
                        max={52}
                        value={hookLine2FontSize}
                        onChange={(e) => setHookLine2FontSize(Number(e.target.value))}
                        className="flex-1 accent-amber-500"
                      />
                      <input
                        type="color"
                        value={hookLine2Color}
                        onChange={(e) => setHookLine2Color(e.target.value)}
                        className="w-6 h-6 rounded cursor-pointer border-0 bg-transparent"
                      />
                    </div>
                  </div>
                  <div>
                    <label className="block text-[10px] text-slate-400">Sombra (Shadow):</label>
                    <select
                      value={hookShadowStyle}
                      onChange={(e) => setHookShadowStyle(e.target.value as OverlayShadowStyle)}
                      className="w-full bg-slate-900 border border-slate-700 rounded-lg px-2 py-1 text-xs text-slate-200 mt-0.5"
                    >
                      {EDITOR_SHADOW_OPTIONS.map((s) => (
                        <option key={s.value} value={s.value}>
                          {s.label}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <label className="block text-[10px] text-slate-400">Fondo (Background):</label>
                    <select
                      value={hookBgStyle}
                      onChange={(e) => setHookBgStyle(e.target.value as OverlayBgStyle)}
                      className="w-full bg-slate-900 border border-slate-700 rounded-lg px-2 py-1 text-xs text-slate-200 mt-0.5"
                    >
                      <option value="none">Sin Fondo (Transparente)</option>
                      <option value="word_shadow">Sombra Ceñida a las Palabras</option>
                      <option value="semi">Caja Semitransparente</option>
                      <option value="solid">Caja Sólida</option>
                    </select>
                  </div>
                  {hookBgStyle !== 'none' && (
                    <div className="col-span-2 flex items-center gap-2 pt-0.5">
                      <label className="text-[10px] text-slate-400">Color / Opacidad Fondo ({hookBgOpacity}%):</label>
                      <input
                        type="color"
                        value={hookBgColor}
                        onChange={(e) => setHookBgColor(e.target.value)}
                        className="w-6 h-6 rounded cursor-pointer border-0 bg-transparent"
                      />
                      <input
                        type="range"
                        min={10}
                        max={100}
                        value={hookBgOpacity}
                        onChange={(e) => setHookBgOpacity(Number(e.target.value))}
                        className="flex-1 accent-amber-500"
                      />
                    </div>
                  )}
                  <div>
                    <label className="block text-[10px] text-slate-400">
                      Posición Horizontal X ({hookLeftPct}%)
                    </label>
                    <input
                      type="range"
                      min={10}
                      max={90}
                      value={hookLeftPct}
                      onChange={(e) => setHookLeftPct(Number(e.target.value))}
                      className="w-full accent-amber-500"
                    />
                  </div>
                  <div>
                    <label className="block text-[10px] text-slate-400">
                      Posición Vertical Y ({hookTopPct}%)
                    </label>
                    <input
                      type="range"
                      min={8}
                      max={82}
                      value={hookTopPct}
                      onChange={(e) => setHookTopPct(Number(e.target.value))}
                      className="w-full accent-amber-500"
                    />
                  </div>
                  {(hookLeftPct !== 50 || hookTopPct !== 50) && (
                    <div className="col-span-2">
                      <button
                        type="button"
                        onClick={() => {
                          setHookLeftPct(50);
                          setHookTopPct(50);
                        }}
                        className="w-full px-2.5 py-1 rounded-lg bg-slate-900 hover:bg-slate-800 text-amber-300 border border-amber-400/60 text-[11px] font-bold cursor-pointer"
                      >
                        🎯 Centrar Texto Exactamente en el Centro (50% X, 50% Y)
                      </button>
                    </div>
                  )}
                </div>

                {/* Independent Animations for Hook Line 1 (8s->16s) & Hook Line 2 (10s->16s) */}
                <div className="pt-2 border-t border-slate-800 space-y-2">
                  <div className="flex items-center justify-between gap-2">
                    <span className="font-bold text-amber-300 text-[11px]">
                      ✨ Tiempos y Animaciones del Texto Inicial
                    </span>
                    <div className="flex items-center gap-1.5">
                      <label className="flex items-center gap-1 text-[10px] text-slate-400">
                        Salida (s):
                        <input
                          type="number"
                          step={0.5}
                          min={2}
                          max={40}
                          value={clip1OverlayEndSec}
                          onChange={(e) => {
                            const nextEnd = Math.max(2, Number(e.target.value));
                            setClip1OverlayEndSec(nextEnd);
                            persistDocOverlaysPatch({ clip1OverlayEndSec: nextEnd, userEditedHook: true });
                          }}
                          className="w-12 bg-slate-950 border border-slate-700 rounded px-1 py-0.5 text-[10px] text-white"
                          title="Segundo en el que termina de mostrarse el Texto Inicial"
                        />
                      </label>
                      <button
                        type="button"
                        onClick={() => {
                          setHookLine1StartSec(8);
                          setHookLine1AnimIn('fade');
                          setHookLine1AnimInDur(1);
                          setHookLine1AnimOut('fade');
                          setHookLine1AnimOutDur(1);
                          setHookLine2StartSec(10);
                          setHookLine2AnimIn('fade');
                          setHookLine2AnimInDur(1);
                          setHookLine2AnimOut('fade');
                          setHookLine2AnimOutDur(1);
                          setClip1OverlayEndSec(16);
                          persistDocOverlaysPatch({
                            hookLine1StartSec: 8,
                            hookLine2StartSec: 10,
                            clip1OverlayEndSec: 16,
                          });
                        }}
                        className="px-2 py-0.5 rounded bg-slate-900 hover:bg-slate-800 border border-amber-500/40 text-amber-300 text-[10px] font-bold cursor-pointer shrink-0"
                        title="Restaurar configuración por defecto: Fade In 1s (L1 en 8s, L2 en 10s) y Fade Out 1s hacia el segundo 16"
                      >
                        🔄 Por Defecto
                      </button>
                    </div>
                  </div>

                  {/* Line 1 Animation Row */}
                  <div className="bg-slate-900/70 border border-slate-800 rounded-lg p-2 space-y-1.5">
                    <div className="flex items-center justify-between text-[10px]">
                      <span className="font-bold text-amber-200">
                        Línea 1 (Aparece en seg {hookLine1StartSec}s → sale en {clip1OverlayEndSec}s):
                      </span>
                      <label className="flex items-center gap-1 text-slate-400">
                        Inicio (s):
                        <input
                          type="number"
                          step={0.1}
                          min={0}
                          max={30}
                          value={hookLine1StartSec}
                          onChange={(e) => {
                            const nextVal = Math.max(0, Number(e.target.value));
                            setHookLine1StartSec(nextVal);
                            persistDocOverlaysPatch({ hookLine1StartSec: nextVal, userEditedHook: true });
                          }}
                          className="w-14 bg-slate-950 border border-slate-700 rounded px-1 py-0.5 text-[10px] text-white"
                        />
                      </label>
                    </div>
                    <div className="grid grid-cols-2 gap-1.5">
                      <div>
                        <label className="block text-[9px] text-slate-400">
                          Entrada L1 ({hookLine1AnimInDur}s):
                        </label>
                        <div className="flex items-center gap-1 mt-0.5">
                          <select
                            value={hookLine1AnimIn}
                            onChange={(e) => setHookLine1AnimIn(e.target.value as ElementAnimationType)}
                            className="flex-1 bg-slate-950 border border-slate-700 rounded px-1.5 py-0.5 text-[10px] text-amber-200"
                          >
                            {ELEMENT_ANIMATION_OPTIONS.map((a) => (
                              <option key={a.value} value={a.value}>
                                {a.label}
                              </option>
                            ))}
                          </select>
                          <input
                            type="number"
                            step={0.25}
                            min={0.2}
                            max={4}
                            value={hookLine1AnimInDur}
                            onChange={(e) => setHookLine1AnimInDur(Math.max(0.2, Number(e.target.value)))}
                            className="w-11 bg-slate-950 border border-slate-700 rounded px-1 py-0.5 text-[10px] text-white"
                          />
                        </div>
                      </div>
                      <div>
                        <label className="block text-[9px] text-slate-400">
                          Salida L1 ({hookLine1AnimOutDur}s → seg {clip1OverlayEndSec}):
                        </label>
                        <div className="flex items-center gap-1 mt-0.5">
                          <select
                            value={hookLine1AnimOut}
                            onChange={(e) => setHookLine1AnimOut(e.target.value as ElementAnimationType)}
                            className="flex-1 bg-slate-950 border border-slate-700 rounded px-1.5 py-0.5 text-[10px] text-amber-200"
                          >
                            {ELEMENT_ANIMATION_OPTIONS.map((a) => (
                              <option key={a.value} value={a.value}>
                                {a.label}
                              </option>
                            ))}
                          </select>
                          <input
                            type="number"
                            step={0.25}
                            min={0.2}
                            max={4}
                            value={hookLine1AnimOutDur}
                            onChange={(e) => setHookLine1AnimOutDur(Math.max(0.2, Number(e.target.value)))}
                            className="w-11 bg-slate-950 border border-slate-700 rounded px-1 py-0.5 text-[10px] text-white"
                          />
                        </div>
                      </div>
                    </div>
                  </div>

                  {/* Line 2 Animation Row */}
                  <div className="bg-slate-900/70 border border-slate-800 rounded-lg p-2 space-y-1.5">
                    <div className="flex items-center justify-between text-[10px]">
                      <span className="font-bold text-white">
                        Línea 2 (Aparece en seg {hookLine2StartSec}s → sale en {clip1OverlayEndSec}s):
                      </span>
                      <label className="flex items-center gap-1 text-slate-400">
                        Inicio (s):
                        <input
                          type="number"
                          step={0.1}
                          min={0}
                          max={30}
                          value={hookLine2StartSec}
                          onChange={(e) => {
                            const nextVal = Math.max(0, Number(e.target.value));
                            setHookLine2StartSec(nextVal);
                            persistDocOverlaysPatch({ hookLine2StartSec: nextVal, userEditedHook: true });
                          }}
                          className="w-14 bg-slate-950 border border-slate-700 rounded px-1 py-0.5 text-[10px] text-white"
                        />
                      </label>
                    </div>
                    <div className="grid grid-cols-2 gap-1.5">
                      <div>
                        <label className="block text-[9px] text-slate-400">
                          Entrada L2 ({hookLine2AnimInDur}s):
                        </label>
                        <div className="flex items-center gap-1 mt-0.5">
                          <select
                            value={hookLine2AnimIn}
                            onChange={(e) => setHookLine2AnimIn(e.target.value as ElementAnimationType)}
                            className="flex-1 bg-slate-950 border border-slate-700 rounded px-1.5 py-0.5 text-[10px] text-amber-200"
                          >
                            {ELEMENT_ANIMATION_OPTIONS.map((a) => (
                              <option key={a.value} value={a.value}>
                                {a.label}
                              </option>
                            ))}
                          </select>
                          <input
                            type="number"
                            step={0.25}
                            min={0.2}
                            max={4}
                            value={hookLine2AnimInDur}
                            onChange={(e) => setHookLine2AnimInDur(Math.max(0.2, Number(e.target.value)))}
                            className="w-11 bg-slate-950 border border-slate-700 rounded px-1 py-0.5 text-[10px] text-white"
                          />
                        </div>
                      </div>
                      <div>
                        <label className="block text-[9px] text-slate-400">
                          Salida L2 ({hookLine2AnimOutDur}s → seg {clip1OverlayEndSec}):
                        </label>
                        <div className="flex items-center gap-1 mt-0.5">
                          <select
                            value={hookLine2AnimOut}
                            onChange={(e) => setHookLine2AnimOut(e.target.value as ElementAnimationType)}
                            className="flex-1 bg-slate-950 border border-slate-700 rounded px-1.5 py-0.5 text-[10px] text-amber-200"
                          >
                            {ELEMENT_ANIMATION_OPTIONS.map((a) => (
                              <option key={a.value} value={a.value}>
                                {a.label}
                              </option>
                            ))}
                          </select>
                          <input
                            type="number"
                            step={0.25}
                            min={0.2}
                            max={4}
                            value={hookLine2AnimOutDur}
                            onChange={(e) => setHookLine2AnimOutDur(Math.max(0.2, Number(e.target.value)))}
                            className="w-11 bg-slate-950 border border-slate-700 rounded px-1 py-0.5 text-[10px] text-white"
                          />
                        </div>
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* TAB 4: AUTO-CAPTIONS (.SRT) + FONT, SIZE, SHADOW & BACKGROUND */}
          {activeInspectorTab === 'captions' && (
            <div className="space-y-3 text-xs flex-1 min-h-0 overflow-y-auto pr-1">
              <div className="flex items-center justify-between gap-2 bg-slate-950/90 border border-slate-800 rounded-xl p-3">
                <div>
                  <div className="font-bold text-emerald-300">
                    💬 Subtítulos Sincronizados ({captions.length} bloques desde 00:{String(Math.floor(voiceStartOffsetSec)).padStart(2, '0')})
                  </div>
                  <div className="text-[11px] text-slate-400">
                    💾 Guardado automático en tiempo real • Voz Narrativa ({formatTimeMMSS(effectiveVoiceDurationSec)})
                  </div>
                </div>
                <div className="flex items-center gap-1.5 shrink-0">
                  <button
                    type="button"
                    onClick={() => {
                      void handleForceResyncCaptions();
                    }}
                    className="px-3 py-1.5 rounded-lg bg-emerald-500 hover:bg-emerald-400 text-slate-950 font-black text-xs cursor-pointer shrink-0"
                  >
                    ✨ Resincronizar Captions
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      if (captions.length === 0) return;
                      const rawSrtOut = serializeCaptionsToSrt(captions);
                      const srtOut = serializeCaptionsToSrt(
                        captions.map((c) => ({ ...c, text: formatCaptionTextCase(c.text) }))
                      );
                      updateActiveDoc({ correctedSrt: rawSrtOut });
                      const blob = new Blob([srtOut + '\n'], { type: 'text/plain;charset=utf-8' });
                      const url = URL.createObjectURL(blob);
                      const a = document.createElement('a');
                      a.href = url;
                      a.download = 'Subtitulos_CapCut_Corregidos.srt';
                      document.body.appendChild(a);
                      a.click();
                      document.body.removeChild(a);
                      setTimeout(() => URL.revokeObjectURL(url), 2000);
                      setStatusMessage(
                        `📥 Archivo Subtitulos_CapCut_Corregidos.srt (${captions.length} bloques) descargado y guardado.`
                      );
                    }}
                    className="px-2.5 py-1.5 rounded-lg bg-sky-500 hover:bg-sky-400 text-slate-950 font-black text-xs cursor-pointer shrink-0"
                    title="Descargar archivo .SRT corregido con timestamps exactos"
                  >
                    📥 .SRT
                  </button>
                </div>
              </div>

              {(activeCaptionAtPlayhead || nearestCaptionAtPlayhead) && (
                <div className="bg-slate-950/90 border border-sky-500/40 rounded-xl p-3 space-y-2">
                  <div className="flex items-center justify-between gap-2">
                    <span className="font-bold text-sky-300 text-[11px]">
                      ✏️ Texto del Caption en Pantalla (#{(activeCaptionAtPlayhead || nearestCaptionAtPlayhead)!.index} •{' '}
                      {formatTimeMMSS((activeCaptionAtPlayhead || nearestCaptionAtPlayhead)!.start)} -{' '}
                      {formatTimeMMSS((activeCaptionAtPlayhead || nearestCaptionAtPlayhead)!.end)})
                    </span>
                    <div className="flex items-center gap-1">
                      <button
                        type="button"
                        onClick={() => {
                          const target = activeCaptionAtPlayhead || nearestCaptionAtPlayhead;
                          if (!target) return;
                          const idx = captions.findIndex((c) => c.id === target.id);
                          if (idx > 0) {
                            seekToTime(captions[idx - 1].start + 0.05);
                            setSelectedCanvasObject('captions');
                          }
                        }}
                        className="px-2 py-0.5 rounded bg-slate-900 hover:bg-slate-800 border border-slate-700 text-[10px] text-slate-300 cursor-pointer"
                        title="Ir al caption anterior"
                      >
                        ◀ Ant
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          const target = activeCaptionAtPlayhead || nearestCaptionAtPlayhead;
                          if (!target) return;
                          const idx = captions.findIndex((c) => c.id === target.id);
                          if (idx >= 0 && idx < captions.length - 1) {
                            seekToTime(captions[idx + 1].start + 0.05);
                            setSelectedCanvasObject('captions');
                          }
                        }}
                        className="px-2 py-0.5 rounded bg-slate-900 hover:bg-slate-800 border border-slate-700 text-[10px] text-slate-300 cursor-pointer"
                        title="Ir al siguiente caption"
                      >
                        Sig ▶
                      </button>
                    </div>
                  </div>
                  <input
                    type="text"
                    value={(activeCaptionAtPlayhead || nearestCaptionAtPlayhead)!.text}
                    onChange={(e) => {
                      const target = activeCaptionAtPlayhead || nearestCaptionAtPlayhead;
                      if (!target) return;
                      handleUpdateCaptionText(target.id, e.target.value);
                    }}
                    onKeyDown={(e) => e.stopPropagation()}
                    placeholder="Escribe o corrige el texto del caption actual..."
                    className="w-full bg-slate-900 border border-slate-700 focus:border-sky-400 rounded-lg px-2.5 py-1.5 text-xs text-white font-semibold outline-none"
                  />
                </div>
              )}

              <div className="grid grid-cols-2 gap-2 bg-slate-950/90 border border-slate-800 rounded-xl p-3">
                <div className="col-span-2">
                  <label className="block text-[10px] text-slate-400 mb-0.5">Fuente de Subtítulos:</label>
                  <select
                    value={captionFontFamily}
                    onChange={(e) => handleSetCaptionFontFamily(e.target.value)}
                    className="w-full bg-slate-900 border border-slate-700 rounded-lg px-2 py-1 text-xs text-sky-200"
                  >
                    {EDITOR_FONT_OPTIONS.map((f) => (
                      <option key={f.value} value={f.value}>
                        {f.label}
                      </option>
                    ))}
                  </select>
                </div>
                <div className="col-span-2">
                  <label className="block text-[10px] text-slate-400 mb-1">Capitalización de Subtítulos:</label>
                  <div className="grid grid-cols-3 gap-1.5">
                    <button
                      type="button"
                      onClick={() => handleSetCaptionTextCase('original')}
                      className={`px-2 py-1 rounded-lg border text-[11px] font-bold transition cursor-pointer ${
                        captionTextCase === 'original'
                          ? 'bg-sky-500 text-slate-950 border-sky-400 shadow'
                          : 'bg-slate-900 hover:bg-slate-800 text-slate-300 border-slate-700'
                      }`}
                    >
                      Aa Original (Por defecto)
                    </button>
                    <button
                      type="button"
                      onClick={() => handleSetCaptionTextCase('uppercase')}
                      className={`px-2 py-1 rounded-lg border text-[11px] font-bold transition cursor-pointer ${
                        captionTextCase === 'uppercase'
                          ? 'bg-sky-500 text-slate-950 border-sky-400 shadow'
                          : 'bg-slate-900 hover:bg-slate-800 text-slate-300 border-slate-700'
                      }`}
                    >
                      AA TODO MAYÚSCULAS
                    </button>
                    <button
                      type="button"
                      onClick={() => handleSetCaptionTextCase('lowercase')}
                      className={`px-2 py-1 rounded-lg border text-[11px] font-bold transition cursor-pointer ${
                        captionTextCase === 'lowercase'
                          ? 'bg-sky-500 text-slate-950 border-sky-400 shadow'
                          : 'bg-slate-900 hover:bg-slate-800 text-slate-300 border-slate-700'
                      }`}
                    >
                      aa todo minúsculas
                    </button>
                  </div>
                </div>
                {/* Largo Máximo de Línea en Pantalla (Caracteres por Caption) + Modo de Línea */}
                <div className="col-span-2 bg-slate-900/80 border border-amber-500/30 rounded-xl p-2.5 space-y-2">
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-[10px] font-bold text-amber-300 uppercase tracking-wider">
                      📏 Largo Máximo de Línea en Pantalla (Caracteres por Caption):
                    </span>
                    <span className="text-[10px] font-bold text-amber-200">
                      {captionLineMode === 'original' ? 'Original' : `${captionMaxChars} caract.`}
                    </span>
                  </div>
                  <div className="grid grid-cols-2 gap-1.5">
                    {[
                      { val: 22, label: '⚡ Muy Corto (22 caract. / 3-4 pal.)' },
                      { val: 32, label: '🎯 Corto Ideal (32 caract. / 4-6 pal.)' },
                      { val: 42, label: '📐 Medio (42 caract. / 6-7 pal.)' },
                      { val: 0, label: '📄 Original CapCut (Sin acortar)' },
                    ].map((opt) => {
                      const isSel =
                        (opt.val === 0 && captionLineMode === 'original') ||
                        (opt.val > 0 && captionLineMode !== 'original' && captionMaxChars === opt.val);
                      return (
                        <button
                          key={opt.val}
                          type="button"
                          onClick={() => handleSetCaptionLengthPreset(opt.val)}
                          className={`px-2 py-1.5 rounded-lg text-[10px] font-bold transition cursor-pointer border text-left ${
                            isSel
                              ? 'bg-amber-500 text-slate-950 border-amber-400 shadow'
                              : 'bg-slate-950 hover:bg-slate-800 text-slate-300 border-slate-700'
                          }`}
                        >
                          {opt.label}
                        </button>
                      );
                    })}
                  </div>
                  {captionLineMode !== 'original' && (
                    <div className="space-y-1.5 pt-1 border-t border-slate-800/80">
                      <div className="flex items-center justify-between text-[10px] text-slate-400">
                        <span>Ajuste fino de caracteres por línea:</span>
                        <span className="font-bold text-amber-300">{captionMaxChars} caract.</span>
                      </div>
                      <input
                        type="range"
                        min={16}
                        max={56}
                        value={captionMaxChars || 32}
                        onChange={(e) => {
                          const nextVal = Number(e.target.value);
                          setCaptionMaxChars(nextVal);
                          if (activeDoc) {
                            updateActiveDoc({
                              promptConfig: {
                                ...(activeDoc.promptConfig || {}),
                                ...(aspectRatio === '9:16'
                                  ? { CAPTION_MAX_CHARS_9X16: nextVal }
                                  : { CAPTION_MAX_CHARS: nextVal }),
                              },
                            });
                          }
                        }}
                        className="w-full accent-amber-500"
                      />
                      <span className="block text-[10px] font-bold text-emerald-300 uppercase tracking-wider pt-0.5">
                        ✂️ Cómo Acortar Bloques Largos:
                      </span>
                      <div className="grid grid-cols-2 gap-1.5">
                        {[
                          {
                            id: 'subdivide' as const,
                            label: '1 Línea Corta Dinámica',
                          },
                          {
                            id: 'wrap' as const,
                            label: '2 Renglones por Bloque',
                          },
                        ].map((m) => (
                          <button
                            key={m.id}
                            type="button"
                            onClick={() => handleSetCaptionLineMode(m.id)}
                            className={`px-2 py-1 rounded-lg text-[10px] font-bold transition cursor-pointer border ${
                              captionLineMode === m.id
                                ? 'bg-emerald-500 text-slate-950 border-emerald-400 shadow'
                                : 'bg-slate-950 hover:bg-slate-800 text-slate-300 border-slate-700'
                            }`}
                          >
                            {m.label}
                          </button>
                        ))}
                      </div>
                    </div>
                  )}
                </div>

                {/* Tamaño de Font y Palabras por Línea por separado para 16:9 y 9:16 */}
                <div className="col-span-2 grid grid-cols-1 sm:grid-cols-2 gap-2">
                  {/* Panel 16:9 Horizontal */}
                  <div
                    className={`rounded-xl p-2.5 border space-y-2 transition ${
                      aspectRatio === '16:9'
                        ? 'bg-sky-950/35 border-sky-500/60'
                        : 'bg-slate-900/70 border-slate-800'
                    }`}
                  >
                    <div className="flex items-center justify-between gap-1">
                      <span className="text-[10px] font-black text-sky-300 uppercase">
                        🖥️ 16:9 Horizontal
                      </span>
                      {aspectRatio === '16:9' ? (
                        <span className="px-1.5 py-0.5 rounded bg-sky-500/20 text-sky-300 text-[9px] font-bold border border-sky-500/40">
                          Activo
                        </span>
                      ) : (
                        <button
                          type="button"
                          onClick={() => handleSwitchAspectRatio('16:9')}
                          className="px-1.5 py-0.5 rounded bg-slate-800 hover:bg-slate-700 text-slate-300 text-[9px] cursor-pointer"
                        >
                          Ver 16:9
                        </button>
                      )}
                    </div>
                    <div>
                      <div className="flex items-center justify-between text-[10px] text-slate-300 mb-0.5">
                        <span>Tamaño Font (16:9):</span>
                        <span className="font-bold text-sky-300">{captionFontSize16x9}px</span>
                      </div>
                      <input
                        type="range"
                        min={14}
                        max={64}
                        value={captionFontSize16x9}
                        onChange={(e) =>
                          handleSetCaptionFontSizeForFormat('16:9', Number(e.target.value))
                        }
                        className="w-full accent-sky-400"
                      />
                      <div className="flex flex-wrap gap-1 mt-1">
                        {[20, 25, 30, 36].map((sz) => (
                          <button
                            key={sz}
                            type="button"
                            onClick={() => handleSetCaptionFontSizeForFormat('16:9', sz)}
                            className={`px-1.5 py-0.5 rounded text-[9px] font-bold border cursor-pointer ${
                              captionFontSize16x9 === sz
                                ? 'bg-sky-500 text-slate-950 border-sky-400'
                                : 'bg-slate-950 text-slate-400 border-slate-700 hover:bg-slate-800'
                            }`}
                          >
                            {sz}px
                          </button>
                        ))}
                      </div>
                    </div>
                    <div>
                      <div className="flex items-center justify-between text-[10px] text-slate-300 mb-1">
                        <span>Palabras / Línea (16:9):</span>
                        <span className="font-bold text-sky-300">
                          {captionWordsPerLine16x9 > 0
                            ? `${captionWordsPerLine16x9} pal.`
                            : 'Auto'}
                        </span>
                      </div>
                      <div className="flex flex-wrap gap-1">
                        {[
                          { w: 3, lbl: '3' },
                          { w: 4, lbl: '4' },
                          { w: 5, lbl: '5' },
                          { w: 6, lbl: '6' },
                          { w: 7, lbl: '7' },
                          { w: 8, lbl: '8' },
                          { w: 0, lbl: 'Auto' },
                        ].map((opt) => (
                          <button
                            key={opt.w}
                            type="button"
                            onClick={() => handleSetCaptionWordsForFormat('16:9', opt.w)}
                            className={`px-1.5 py-0.5 rounded text-[9px] font-bold border cursor-pointer ${
                              captionWordsPerLine16x9 === opt.w
                                ? 'bg-sky-500 text-slate-950 border-sky-400'
                                : 'bg-slate-950 text-slate-300 border-slate-700 hover:bg-slate-800'
                            }`}
                          >
                            {opt.lbl}
                          </button>
                        ))}
                      </div>
                    </div>
                  </div>

                  {/* Panel 9:16 Vertical */}
                  <div
                    className={`rounded-xl p-2.5 border space-y-2 transition ${
                      aspectRatio === '9:16'
                        ? 'bg-amber-950/35 border-amber-500/60'
                        : 'bg-slate-900/70 border-slate-800'
                    }`}
                  >
                    <div className="flex items-center justify-between gap-1">
                      <span className="text-[10px] font-black text-amber-300 uppercase">
                        📱 9:16 Vertical
                      </span>
                      {aspectRatio === '9:16' ? (
                        <span className="px-1.5 py-0.5 rounded bg-amber-500/20 text-amber-300 text-[9px] font-bold border border-amber-500/40">
                          Activo
                        </span>
                      ) : (
                        <button
                          type="button"
                          onClick={() => handleSwitchAspectRatio('9:16')}
                          className="px-1.5 py-0.5 rounded bg-slate-800 hover:bg-slate-700 text-slate-300 text-[9px] cursor-pointer"
                        >
                          Ver 9:16
                        </button>
                      )}
                    </div>
                    <div>
                      <div className="flex items-center justify-between text-[10px] text-slate-300 mb-0.5">
                        <span>Tamaño Font (9:16):</span>
                        <span className="font-bold text-amber-300">{captionFontSize9x16}px</span>
                      </div>
                      <input
                        type="range"
                        min={14}
                        max={64}
                        value={captionFontSize9x16}
                        onChange={(e) =>
                          handleSetCaptionFontSizeForFormat('9:16', Number(e.target.value))
                        }
                        className="w-full accent-amber-500"
                      />
                      <div className="flex flex-wrap gap-1 mt-1">
                        {[18, 21, 25, 30].map((sz) => (
                          <button
                            key={sz}
                            type="button"
                            onClick={() => handleSetCaptionFontSizeForFormat('9:16', sz)}
                            className={`px-1.5 py-0.5 rounded text-[9px] font-bold border cursor-pointer ${
                              captionFontSize9x16 === sz
                                ? 'bg-amber-500 text-slate-950 border-amber-400'
                                : 'bg-slate-950 text-slate-400 border-slate-700 hover:bg-slate-800'
                            }`}
                          >
                            {sz}px
                          </button>
                        ))}
                      </div>
                    </div>
                    <div>
                      <div className="flex items-center justify-between text-[10px] text-slate-300 mb-1">
                        <span>Palabras / Línea (9:16):</span>
                        <span className="font-bold text-amber-300">
                          {captionWordsPerLine9x16 > 0
                            ? `${captionWordsPerLine9x16} pal.`
                            : 'Auto'}
                        </span>
                      </div>
                      <div className="flex flex-wrap gap-1">
                        {[
                          { w: 2, lbl: '2' },
                          { w: 3, lbl: '3' },
                          { w: 4, lbl: '4' },
                          { w: 5, lbl: '5' },
                          { w: 6, lbl: '6' },
                          { w: 0, lbl: 'Auto' },
                        ].map((opt) => (
                          <button
                            key={opt.w}
                            type="button"
                            onClick={() => handleSetCaptionWordsForFormat('9:16', opt.w)}
                            className={`px-1.5 py-0.5 rounded text-[9px] font-bold border cursor-pointer ${
                              captionWordsPerLine9x16 === opt.w
                                ? 'bg-amber-500 text-slate-950 border-amber-400'
                                : 'bg-slate-950 text-slate-300 border-slate-700 hover:bg-slate-800'
                            }`}
                          >
                            {opt.lbl}
                          </button>
                        ))}
                      </div>
                    </div>
                  </div>
                </div>

                <div>
                  <label className="block text-[10px] text-slate-400">
                    Tamaño Activo ({aspectRatio}: {captionFontSize}px)
                  </label>
                  <input
                    type="range"
                    min={14}
                    max={64}
                    value={captionFontSize}
                    onChange={(e) =>
                      handleSetCaptionFontSizeForFormat(aspectRatio, Number(e.target.value))
                    }
                    className="w-full accent-amber-500"
                  />
                </div>
                <div>
                  <label className="block text-[10px] text-slate-400">Altura ({captionBottomPct}%)</label>
                  <input
                    type="range"
                    min={4}
                    max={80}
                    value={captionBottomPct}
                    onChange={(e) => handleSetCaptionBottomPct(Number(e.target.value))}
                    className="w-full accent-amber-500"
                  />
                </div>
                <div>
                  <label className="block text-[10px] text-slate-400">Color de Texto</label>
                  <div className="flex items-center gap-1.5 mt-0.5">
                    <select
                      value={captionColor}
                      onChange={(e) => handleSetCaptionColor(e.target.value as 'white' | 'amber' | 'custom')}
                      className="flex-1 bg-slate-900 border border-slate-700 rounded px-2 py-1 text-xs text-white"
                    >
                      <option value="white">Blanco Clásico</option>
                      <option value="amber">Ámbar Documental</option>
                      <option value="custom">Personalizado</option>
                    </select>
                    {captionColor === 'custom' && (
                      <input
                        type="color"
                        value={captionCustomColor}
                        onChange={(e) => handleSetCaptionCustomColor(e.target.value)}
                        className="w-6 h-6 rounded cursor-pointer border-0 bg-transparent"
                      />
                    )}
                  </div>
                </div>
                <div>
                  <label className="block text-[10px] text-slate-400">Sombra / Contorno</label>
                  <select
                    value={captionShadowStyle}
                    onChange={(e) => handleSetCaptionShadowStyle(e.target.value as OverlayShadowStyle)}
                    className="w-full bg-slate-900 border border-slate-700 rounded px-2 py-1 text-xs text-slate-200 mt-0.5"
                  >
                    {EDITOR_SHADOW_OPTIONS.map((s) => (
                      <option key={s.value} value={s.value}>
                        {s.label}
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="block text-[10px] text-slate-400">Fondo de Subtítulos</label>
                  <select
                    value={captionBgStyle}
                    onChange={(e) => handleSetCaptionBgStyle(e.target.value as OverlayBgStyle)}
                    className="w-full bg-slate-900 border border-slate-700 rounded px-2 py-1 text-xs text-slate-200 mt-0.5"
                  >
                    <option value="none">Sin Fondo (Transparente)</option>
                    <option value="word_shadow">Sombra Ceñida a las Palabras</option>
                    <option value="semi">Caja Semitransparente</option>
                    <option value="solid">Caja Sólida</option>
                  </select>
                </div>
                {captionBgStyle !== 'none' && (
                  <div>
                    <label className="block text-[10px] text-slate-400">
                      Opacidad Fondo ({captionBgOpacity}%)
                    </label>
                    <div className="flex items-center gap-1.5 mt-0.5">
                      <input
                        type="color"
                        value={captionBgColor}
                        onChange={(e) => handleSetCaptionBgColor(e.target.value)}
                        className="w-5 h-5 rounded cursor-pointer border-0 bg-transparent"
                      />
                      <input
                        type="range"
                        min={10}
                        max={100}
                        value={captionBgOpacity}
                        onChange={(e) => handleSetCaptionBgOpacity(Number(e.target.value))}
                        className="flex-1 accent-sky-400"
                      />
                    </div>
                  </div>
                )}
                <div className="col-span-2 pt-1.5 border-t border-slate-800 grid grid-cols-3 gap-2">
                  <div>
                    <label className="block text-[10px] text-slate-400">✨ Animación Entrada:</label>
                    <select
                      value={captionAnimIn}
                      onChange={(e) => handleSetCaptionAnimIn(e.target.value as ElementAnimationType)}
                      className="w-full bg-slate-900 border border-slate-700 rounded px-1.5 py-1 text-[11px] text-sky-200 mt-0.5"
                    >
                      {ELEMENT_ANIMATION_OPTIONS.map((a) => (
                        <option key={a.value} value={a.value}>
                          {a.label}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <label className="block text-[10px] text-slate-400">✨ Animación Salida:</label>
                    <select
                      value={captionAnimOut}
                      onChange={(e) => handleSetCaptionAnimOut(e.target.value as ElementAnimationType)}
                      className="w-full bg-slate-900 border border-slate-700 rounded px-1.5 py-1 text-[11px] text-sky-200 mt-0.5"
                    >
                      {ELEMENT_ANIMATION_OPTIONS.map((a) => (
                        <option key={a.value} value={a.value}>
                          {a.label}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <label className="block text-[10px] text-slate-400">Duración (s):</label>
                    <input
                      type="number"
                      step={0.05}
                      min={0.05}
                      max={1.5}
                      value={captionAnimDur}
                      onChange={(e) => handleSetCaptionAnimDur(Number(e.target.value))}
                      className="w-full bg-slate-900 border border-slate-700 rounded px-1.5 py-1 text-[11px] text-white mt-0.5"
                    />
                  </div>
                </div>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* =====================================================================
          LOWER WORKSPACE: FULL-WIDTH MULTI-TRACK TIMELINE DOCK (LEFT TO RIGHT)
      ===================================================================== */}
      <div
        data-keep-clip-selection="true"
        className={`w-full shrink-0 bg-[#0b0907] border-t border-slate-800/90 flex flex-col overflow-hidden transition-all ${
          isTimelineDockExpanded ? 'h-[280px]' : 'h-[195px] xl:h-[210px]'
        }`}
      >
        {/* CapCut Slim Middle Action Toolbar */}
        <div className="px-2 py-1 bg-[#120f0c] border-b border-slate-800/90 flex items-center justify-between gap-1.5 shrink-0 overflow-x-auto whitespace-nowrap">
          <div className="flex items-center gap-1.5 shrink-0">
            <span className="text-[10px] font-black uppercase tracking-wider text-amber-300 flex items-center gap-1">
              <Layers className="w-3.5 h-3.5" /> Timeline
            </span>
            <span className="w-[228px] shrink-0 px-2 py-0.5 rounded-full bg-amber-500/20 border border-amber-400/50 text-[10px] font-mono tabular-nums font-bold text-amber-200 flex items-center justify-between gap-1 whitespace-nowrap overflow-hidden">
              <span className="flex items-center gap-1 truncate">
                <span className="w-1.5 h-1.5 rounded-full bg-rose-500 animate-pulse shrink-0" />
                {activeClipAtPlayhead ? (
                  <span className="truncate">
                    #{String((activeClipAtPlayhead.index ?? 0) + 1).padStart(2, '0')} (Clip{' '}
                    {String(activeClipAtPlayhead.clipNumber).padStart(2, '0')}
                    {activeClipAtPlayhead.partLabel ? ` • ${activeClipAtPlayhead.partLabel}` : ''})
                  </span>
                ) : (
                  <span className="truncate">#-- (Clip --)</span>
                )}
              </span>
              <span ref={timelineToolbarTimeRef} className="shrink-0 tabular-nums">
                • {formatTimeMMSS(currentTime)}.{Math.floor((currentTime % 1) * 10)}
              </span>
            </span>
            {/* Quick Timeline Cut / Split / Delete Toolbar */}
            {selectedClip && (
              <div className="flex items-center gap-1 flex-wrap pl-1 border-l border-slate-800">
                <button
                  type="button"
                  onClick={() => handleSplitClipAtPlayhead(selectedClip.id)}
                  className="px-2 py-0.5 rounded bg-amber-500 hover:bg-amber-400 text-slate-950 font-black text-[10px] flex items-center gap-1 shadow shadow-amber-500/20 cursor-pointer transition"
                  title="Divide el clip actual en 2 partes (Parte A y Parte B) exactamente donde está la aguja roja"
                >
                  <Scissors className="w-3 h-3" /> Dividir en Aguja
                </button>
                <button
                  type="button"
                  onClick={() => handleCutFromStartToPlayhead(selectedClip.id)}
                  className="px-1.5 py-0.5 rounded bg-slate-900 hover:bg-slate-800 border border-amber-500/40 text-amber-200 font-bold text-[9px] cursor-pointer transition"
                  title="Corta desde el inicio del clip hasta la aguja y estira el resto con Smooth Slow Motion (Optical Flow)"
                >
                  ⏪ Inicio→Aguja
                </button>
                <button
                  type="button"
                  onClick={() => handleCutFromPlayheadToEnd(selectedClip.id)}
                  className="px-1.5 py-0.5 rounded bg-slate-900 hover:bg-slate-800 border border-amber-500/40 text-amber-200 font-bold text-[9px] cursor-pointer transition"
                  title="Corta desde la aguja hasta el final del clip y estira el inicio con Smooth Slow Motion (Optical Flow)"
                >
                  ⏩ Aguja→Fin
                </button>
                <button
                  type="button"
                  onClick={() => handleDeleteClipOrStretchSibling(selectedClip.id, false)}
                  className="px-2 py-0.5 rounded bg-rose-600/25 hover:bg-rose-600/40 border border-rose-500/50 text-rose-200 font-bold text-[9px] flex items-center gap-1 cursor-pointer transition"
                  title="Elimina el pedazo seleccionado; si pertenece a un clip dividido, la otra parte se estira automáticamente con Smooth Slow Motion (Optical Flow) para cubrir sus segundos originales"
                >
                  <Trash2 className="w-3 h-3" />{' '}
                  {selectedClip.parentGroupId ? 'Borrar Pedazo' : 'Eliminar'}
                </button>
                {clipUndoStack.length > 0 && (
                  <button
                    type="button"
                    onClick={handleUndoClipEdit}
                    className="px-1.5 py-0.5 rounded bg-slate-900 hover:bg-slate-800 border border-slate-700 text-slate-300 font-bold text-[9px] cursor-pointer transition"
                    title="Deshacer último corte, eliminación o cambio de velocidad"
                  >
                    ↩️ ({clipUndoStack.length})
                  </button>
                )}
              </div>
            )}
          </div>
          <div className="flex items-center gap-1.5 text-[10px] text-slate-400">
            <button
              type="button"
              onClick={() => setIsTimelineDockExpanded((v) => !v)}
              className="px-2 py-0.5 rounded bg-slate-900 hover:bg-slate-800 border border-slate-700 text-slate-300 font-bold cursor-pointer"
              title="Alternar altura de la línea de tiempo (Compacta para dar máximo espacio al Visor vs Ampliada)"
            >
              {isTimelineDockExpanded ? '⬇️ Compactar Pistas' : '⬆️ Ampliar Pistas'}
            </button>
            <span className="hidden sm:inline">Zoom ({timelineRulerData.scaleUnitLabel}):</span>
            <button
              type="button"
              onClick={() => handleChangeTimelineZoom((z) => Math.max(1, z - Math.max(3, Math.round(z * 0.2))), false)}
              className="px-1.5 py-0.5 rounded bg-slate-900 hover:bg-slate-800 border border-slate-700 text-slate-300 font-bold cursor-pointer"
              title="Alejar línea de tiempo (ver minutos / horas)"
            >
              −
            </button>
            <input
              type="range"
              min={1}
              max={240}
              value={isFitEntireProject ? 1 : timelineZoom}
              onChange={(e) => handleChangeTimelineZoom(Number(e.target.value), false)}
              className="w-20 accent-amber-500 cursor-pointer"
            />
            <button
              type="button"
              onClick={() => handleChangeTimelineZoom((z) => Math.min(240, z + Math.max(3, Math.round(z * 0.25))), false)}
              className="px-1.5 py-0.5 rounded bg-slate-900 hover:bg-slate-800 border border-slate-700 text-slate-300 font-bold cursor-pointer"
              title="Acercar línea de tiempo (ver segundos detallados)"
            >
              +
            </button>
            <button
              type="button"
              onClick={() => handleChangeTimelineZoom(timelineZoom, !isFitEntireProject)}
              className={`px-2 py-0.5 rounded border text-[10px] font-bold flex items-center gap-1 transition cursor-pointer ${
                isFitEntireProject
                  ? 'bg-amber-500 text-slate-950 border-amber-400 shadow shadow-amber-500/20'
                  : 'bg-slate-900 hover:bg-slate-800 text-amber-300 border-amber-500/40'
              }`}
              title="Ajusta automáticamente toda la línea de tiempo (00:00 hasta el final) al ancho de la pantalla"
            >
              📐 {isFitEntireProject ? 'Proyecto Entero' : 'Ver Todo'}
            </button>
          </div>
        </div>

        {/* Unified Scrollable Multi-Track + Sticky Ruler Container (Single Unbroken Playhead Needle) */}
        <div
          ref={timelineScrollContainerRef}
          onScroll={(e) => {
            if (!isEditorActive) return;
            const el = e.currentTarget;
            if (el.clientWidth <= 0) return;
            const nextLeft = Math.round(el.scrollLeft);
            const nextTop = Math.round(el.scrollTop);
            // Ignore transient browser clamping while timeline clips/duration are still expanding on mount or doc switch
            if (
              nextLeft < savedTimelineScrollRef.current.left - 4 &&
              (timelineClips.length === 0 ||
                el.scrollWidth < savedTimelineScrollRef.current.left + el.clientWidth)
            ) {
              return;
            }
            if (
              nextLeft === savedTimelineScrollRef.current.left &&
              nextTop === savedTimelineScrollRef.current.top
            ) {
              return;
            }
            savedTimelineScrollRef.current = { left: nextLeft, top: nextTop };
            hasExplicitTimelineScrollRef.current = true;
            // While playing, skip synchronous localStorage & doc patch writes during scroll events completely
            if (isPlaying) {
              return;
            }
            if (timelineScrollPersistTimerRef.current) {
              clearTimeout(timelineScrollPersistTimerRef.current);
            }
            timelineScrollPersistTimerRef.current = setTimeout(() => {
              try {
                const rawSession = localStorage.getItem(EDITOR_SESSION_STORAGE_KEY);
                const parsedSession = rawSession ? JSON.parse(rawSession) : {};
                localStorage.setItem(
                  EDITOR_SESSION_STORAGE_KEY,
                  JSON.stringify({
                    ...parsedSession,
                    timelineScrollLeft: nextLeft,
                    timelineScrollTop: nextTop,
                    hasExplicitTimelineScroll: true,
                  })
                );
                if (activeDoc?.id) {
                  persistDocOverlaysPatch(
                    {
                      timelineScrollLeft: nextLeft,
                      timelineScrollTop: nextTop,
                      hasExplicitTimelineScroll: true,
                    },
                    activeDoc.id
                  );
                }
              } catch {}
            }, 300);
          }}
          className={`flex-1 min-h-0 bg-[#0e0c09] px-2 pb-1.5 overflow-y-auto ${
            isFitEntireProject ? 'overflow-x-hidden' : 'overflow-x-auto'
          }`}
        >
          <div className={`relative space-y-1 ${isFitEntireProject ? 'w-full' : 'min-w-max pr-64'}`}>
            {/* =================================================================
                SINGLE UNIFIED VERTICAL PLAYHEAD NEEDLE (RULER + ALL TRACKS)
            ================================================================= */}
            <div
              ref={playheadNeedleRef}
              style={{
                left: 'var(--tl-header-offset, 9.5rem)',
                transform: isFitEntireProject
                  ? `translate3d(calc((100% - var(--tl-header-offset, 9.5rem)) * ${Math.min(
                      1,
                      Math.max(0, currentTime / Math.max(1, totalDurationSec))
                    ).toFixed(6)}), 0, 0)`
                  : `translate3d(${(currentTime * timelineZoom).toFixed(2)}px, 0, 0)`,
                willChange: 'transform',
              }}
              className="pointer-events-none absolute top-0 bottom-0 z-40 w-0"
            >
              {/* Single Unbroken Vertical Playhead Line from Top of Ruler through Bottom of Track 5 */}
              <div className="absolute top-0 bottom-0 left-0 -translate-x-1/2 w-[2.5px] bg-gradient-to-b from-amber-300 via-rose-500 to-amber-400 shadow-[0_0_12px_rgba(244,63,94,0.95)]" />
              {/* Sticky Top Playhead Handle & Time Badge */}
              <div
                onPointerDown={handleStartRulerScrub}
                title="Arrastra la aguja para moverte por la línea de tiempo"
                style={{ touchAction: 'none' }}
                className="sticky top-0 z-50 pointer-events-auto cursor-ew-resize w-max -translate-x-1/2 flex flex-col items-center select-none pt-0.5"
              >
                <div
                  ref={playheadBadgeTextRef}
                  className="px-1.5 py-0.5 rounded bg-rose-600 border border-amber-300 text-[9px] font-mono font-black text-white shadow-md whitespace-nowrap leading-none"
                >
                  {formatTimeMMSS(currentTime)}.{Math.floor((currentTime % 1) * 10)}
                </div>
                <div className="w-0 h-0 border-l-[5px] border-l-transparent border-r-[5px] border-r-transparent border-t-[6px] border-t-amber-300" />
              </div>
            </div>

            {/* STICKY TOP TIME RULER (SEGUNDOS, MINUTOS U HORAS SEGÚN EL ZOOM) */}
            <div
              ref={timelineRulerScrollRef}
              className={`sticky top-0 z-30 bg-[#0b0907] py-1 border-b border-slate-800/90 flex items-center gap-2 ${
                isFitEntireProject ? 'w-full' : 'min-w-max'
              }`}
            >
              <div className="w-24 sm:w-36 shrink-0 sticky left-0 z-[35] self-stretch shadow-[0_0_0_4px_#0e0c09,-8px_0_0_4px_#0e0c09,4px_0_6px_-2px_rgba(0,0,0,0.7)] px-1.5 sm:px-2 py-1 rounded bg-slate-950 border border-amber-500/30 text-[9px] font-bold text-amber-300 flex items-center justify-between truncate">
                <span className="truncate">⏱️ Regla</span>
                <span className="hidden sm:inline px-1 py-0.5 rounded bg-amber-500/15 text-[8px] font-mono text-amber-200">
                  {timelineRulerData.scaleUnitLabel}
                </span>
              </div>
              <div
                ref={timelineRulerLaneRef}
                onPointerDown={handleStartRulerScrub}
                style={
                  isFitEntireProject
                    ? { touchAction: 'none' }
                    : { width: `${Math.max(300, totalDurationSec * timelineZoom)}px`, touchAction: 'none' }
                }
                title="Haz clic o arrastra sobre la regla para mover el guion vertical al segundo exacto"
                className={`relative h-6 bg-[#090806] border border-slate-800 rounded cursor-ew-resize select-none overflow-hidden ${
                  isFitEntireProject ? 'flex-1 min-w-0' : 'shrink-0'
                }`}
              >
                {/* Minor Subdivision Ticks (Seconds / Sub-seconds / Minutes depending on zoom) */}
                <div
                  style={{
                    backgroundImage: isFitEntireProject
                      ? `repeating-linear-gradient(to right, rgba(148,163,184,0.28) 0px, rgba(148,163,184,0.28) 1px, transparent 1px, transparent ${Math.max(
                          0.25,
                          (timelineRulerData.minorStepSec / Math.max(1, totalDurationSec)) * 100
                        )}%)`
                      : `repeating-linear-gradient(to right, rgba(148,163,184,0.28) 0px, rgba(148,163,184,0.28) 1px, transparent 1px, transparent ${Math.max(
                          4,
                          timelineRulerData.minorStepSec * timelineZoom
                        )}px)`,
                  }}
                  className="absolute inset-x-0 bottom-0 h-2.5 pointer-events-none"
                />

                {/* Clip Boundary Markers along the bottom edge of the ruler */}
                {clipsWithTimelineBounds.map((clip) => (
                  <div
                    key={`ruler-clip-${clip.id}`}
                    style={{
                      left: isFitEntireProject
                        ? `${(clip.start / Math.max(1, totalDurationSec)) * 100}%`
                        : `${clip.start * timelineZoom}px`,
                    }}
                    className="absolute bottom-0 h-1.5 w-[1px] bg-amber-500/45 pointer-events-none"
                  />
                ))}

                {/* Major Labeled Ticks (Seconds, Minutes, or Hours) */}
                {timelineRulerData.majorTicks.map((tick) => {
                  const leftPos = isFitEntireProject
                    ? `${(tick.sec / Math.max(1, totalDurationSec)) * 100}%`
                    : `${tick.sec * timelineZoom}px`;
                  return (
                    <div
                      key={`tick-${tick.sec}`}
                      style={{ left: leftPos }}
                      className="absolute top-0 bottom-0 flex flex-col justify-between pointer-events-none"
                    >
                      <span
                        className={`pl-1 pt-0.5 text-[9px] font-mono whitespace-nowrap leading-none ${
                          tick.isHour
                            ? 'text-rose-300 font-black'
                            : tick.isMinute
                            ? 'text-amber-300 font-bold'
                            : 'text-slate-300'
                        }`}
                      >
                        {tick.label}
                      </span>
                      <div
                        className={`w-[1.5px] ${
                          tick.isHour
                            ? 'h-4 bg-rose-400'
                            : tick.isMinute
                            ? 'h-3.5 bg-amber-400'
                            : 'h-3 bg-slate-400/80'
                        }`}
                      />
                    </div>
                  );
                })}
              </div>
            </div>

            {/* TRACK 1: BRANDING OVERLAYS (LOGO + CLIP 1 HOOK TEXT) */}
            <div className={`flex items-center gap-2 ${isFitEntireProject ? 'w-full' : 'min-w-max'}`}>
              <div className="w-24 sm:w-36 shrink-0 sticky left-0 z-[35] self-stretch shadow-[0_0_0_4px_#0e0c09,-8px_0_0_4px_#0e0c09,4px_0_6px_-2px_rgba(0,0,0,0.7)] px-1.5 sm:px-2 py-1 rounded bg-slate-900 border border-slate-800 text-[9px] sm:text-[10px] font-bold text-amber-300 truncate flex items-center">
                1. 🏷️ Logo + Texto
              </div>
              <div
                style={
                  isFitEntireProject
                    ? undefined
                    : { width: `${Math.max(300, totalDurationSec * timelineZoom)}px` }
                }
                className={`flex items-center bg-slate-950/80 border border-slate-800/80 rounded py-0.5 px-0 overflow-hidden ${
                  isFitEntireProject ? 'flex-1 min-w-0' : 'shrink-0'
                }`}
              >
                {postSloganIntroBounds ? (
                  <>
                    <button
                      type="button"
                      onClick={() => {
                        seekToTime(0);
                        setSelectedCanvasObject('hook_text');
                        setActiveInspectorTab('branding');
                      }}
                      style={
                        isFitEntireProject
                          ? {
                              width: `${(Math.max(1, clip1OverlayEndSec) / Math.max(1, totalDurationSec)) * 100}%`,
                            }
                          : { width: `${Math.max(1, clip1OverlayEndSec) * timelineZoom}px` }
                      }
                      className="px-2 py-0.5 rounded-l bg-amber-500/20 hover:bg-amber-500/30 border-r border-amber-500/40 text-[10px] text-amber-200 font-semibold truncate cursor-pointer shrink-0"
                    >
                      🔤 Texto Gancho Clip 1 (00:00 - 00:{String(Math.floor(clip1OverlayEndSec)).padStart(2, '0')})
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        setSelectedCanvasObject('logo');
                        setActiveInspectorTab('branding');
                      }}
                      style={
                        isFitEntireProject
                          ? {
                              width: `${
                                (Math.max(0, postSloganIntroBounds.start - clip1OverlayEndSec) /
                                  Math.max(1, totalDurationSec)) *
                                100
                              }%`,
                            }
                          : {
                              width: `${Math.max(0, postSloganIntroBounds.start - clip1OverlayEndSec) * timelineZoom}px`,
                            }
                      }
                      className="px-2 py-0.5 bg-emerald-500/15 hover:bg-emerald-500/25 border-r border-amber-500/40 text-[10px] text-emerald-300 font-semibold truncate cursor-pointer shrink-0 text-left"
                    >
                      🖼️ Logo ({formatTimeMMSS(clip1OverlayEndSec)} - {formatTimeMMSS(postSloganIntroBounds.start)})
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        seekToTime(postSloganIntroBounds.start);
                        setSelectedClipId('fixed-doc-intro');
                      }}
                      style={
                        isFitEntireProject
                          ? {
                              width: `${(postSloganIntroBounds.duration / Math.max(1, totalDurationSec)) * 100}%`,
                            }
                          : { width: `${postSloganIntroBounds.duration * timelineZoom}px` }
                      }
                      className="px-2 py-0.5 bg-amber-600/25 hover:bg-amber-600/35 border-r border-amber-500/40 text-[10px] text-amber-300 font-black truncate cursor-pointer shrink-0"
                      title={`Ir al Intro Oficial Post-Slogan (${formatTimeMMSS(postSloganIntroBounds.start)} - ${formatTimeMMSS(postSloganIntroBounds.end)})`}
                    >
                      🎬 Intro 8K Post-Slogan ({formatTimeMMSS(postSloganIntroBounds.start)} - {formatTimeMMSS(postSloganIntroBounds.end)})
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        setSelectedCanvasObject('logo');
                        setActiveInspectorTab('branding');
                      }}
                      style={
                        isFitEntireProject
                          ? {
                              width: `${
                                (Math.max(0, totalDurationSec - postSloganIntroBounds.end) /
                                  Math.max(1, totalDurationSec)) *
                                100
                              }%`,
                            }
                          : {
                              width: `${Math.max(0, totalDurationSec - postSloganIntroBounds.end) * timelineZoom}px`,
                            }
                      }
                      className="px-2.5 py-0.5 rounded-r bg-emerald-500/15 hover:bg-emerald-500/25 text-[10px] text-emerald-300 font-semibold truncate cursor-pointer shrink-0 text-left"
                    >
                      🖼️ Logo Oficial "Huellas de la Humanidad" ({logoScalePct}% • {formatTimeMMSS(postSloganIntroBounds.end)} -{' '}
                      {formatTimeMMSS(totalDurationSec)})
                    </button>
                  </>
                ) : (
                  <>
                    <button
                      type="button"
                      onClick={() => {
                        seekToTime(0);
                        setSelectedClipId('fixed-doc-intro');
                      }}
                      style={
                        isFitEntireProject
                          ? {
                              width: `${(8 / Math.max(1, totalDurationSec)) * 100}%`,
                            }
                          : { width: `${8 * timelineZoom}px` }
                      }
                      className="px-2 py-0.5 rounded-l bg-amber-600/25 hover:bg-amber-600/35 border-r border-amber-500/40 text-[10px] text-amber-300 font-black truncate cursor-pointer shrink-0"
                      title="Ir al Intro Oficial de Huellas de la Humanidad (00:00 - 00:08)"
                    >
                      🎬 Intro 8K (00:00 - 00:08)
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        seekToTime(hookLine1StartSec);
                        setSelectedCanvasObject('hook_text');
                        setActiveInspectorTab('branding');
                      }}
                      style={
                        isFitEntireProject
                          ? {
                              width: `${(Math.max(1, clip1OverlayEndSec - 8) / Math.max(1, totalDurationSec)) * 100}%`,
                            }
                          : { width: `${Math.max(1, clip1OverlayEndSec - 8) * timelineZoom}px` }
                      }
                      className="px-2 py-0.5 bg-amber-500/20 hover:bg-amber-500/30 border-r border-amber-500/40 text-[10px] text-amber-200 font-semibold truncate cursor-pointer shrink-0"
                    >
                      🔤 Texto Gancho Clip 1 ({hookLine1StartSec}s - {clip1OverlayEndSec}s)
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        setSelectedCanvasObject('logo');
                        setActiveInspectorTab('branding');
                      }}
                      style={
                        isFitEntireProject
                          ? {
                              width: `${
                                (Math.max(0, totalDurationSec - clip1OverlayEndSec) /
                                  Math.max(1, totalDurationSec)) *
                                100
                              }%`,
                            }
                          : {
                              width: `${Math.max(0, totalDurationSec - clip1OverlayEndSec) * timelineZoom}px`,
                            }
                      }
                      className="px-2.5 py-0.5 rounded-r bg-emerald-500/15 hover:bg-emerald-500/25 text-[10px] text-emerald-300 font-semibold truncate cursor-pointer shrink-0 text-left"
                    >
                      🖼️ Logo Oficial "Huellas de la Humanidad" ({logoScalePct}% • Todo el Video: 00:00 -{' '}
                      {formatTimeMMSS(totalDurationSec)})
                    </button>
                  </>
                )}
              </div>
            </div>

            {/* TRACK 2: CAPTIONS (.SRT) */}
            <div className={`flex items-center gap-2 ${isFitEntireProject ? 'w-full' : 'min-w-max'}`}>
              <div className="w-24 sm:w-36 shrink-0 sticky left-0 z-[35] self-stretch shadow-[0_0_0_4px_#0e0c09,-8px_0_0_4px_#0e0c09,4px_0_6px_-2px_rgba(0,0,0,0.7)] px-1.5 sm:px-2 py-1 rounded bg-slate-900 border border-slate-800 text-[9px] sm:text-[10px] font-bold text-sky-300 truncate flex items-center">
                2. 💬 Captions ({captions.length})
              </div>
              <div
                style={
                  isFitEntireProject
                    ? undefined
                    : { width: `${Math.max(300, totalDurationSec * timelineZoom)}px` }
                }
                className={`relative h-6 bg-slate-950/80 border border-slate-800/80 rounded overflow-hidden ${
                  isFitEntireProject ? 'flex-1 min-w-0' : 'shrink-0'
                }`}
              >
                {captions.length === 0 ? (
                  <span className="text-[10px] text-slate-500 px-2 leading-6">
                    Haz clic en "✨ Resincronizar Captions" en la pestaña 💬 SRT.
                  </span>
                ) : (
                  <>
                    {/* Initial 8s Hook silence before captions start */}
                    {voiceStartOffsetSec > 0 && (
                      <div
                        style={
                          isFitEntireProject
                            ? {
                                left: '0%',
                                width: `${(voiceStartOffsetSec / Math.max(1, totalDurationSec)) * 100}%`,
                              }
                            : {
                                left: '0px',
                                width: `${voiceStartOffsetSec * timelineZoom}px`,
                              }
                        }
                        className="absolute top-0.5 bottom-0.5 px-1 rounded bg-slate-900 border border-dashed border-slate-700 text-[8px] text-slate-400 flex items-center justify-center truncate"
                      >
                        00:00-00:0{voiceStartOffsetSec} (Hook)
                      </div>
                    )}
                    {captions.map((cap) => {
                      const isCapActive = activeCaptionAtPlayhead?.id === cap.id;
                      const capDur = Math.max(0.4, cap.end - cap.start);
                      return (
                        <button
                          key={cap.id}
                          type="button"
                          onClick={() => {
                            seekToTime(cap.start);
                            setSelectedCanvasObject('captions');
                            setActiveInspectorTab('captions');
                          }}
                          style={
                            isFitEntireProject
                              ? {
                                  left: `${(cap.start / Math.max(1, totalDurationSec)) * 100}%`,
                                  width: `${(capDur / Math.max(1, totalDurationSec)) * 100}%`,
                                }
                              : {
                                  left: `${cap.start * timelineZoom}px`,
                                  width: `${Math.max(18, capDur * timelineZoom)}px`,
                                }
                          }
                          className={`absolute top-0.5 bottom-0.5 rounded border truncate cursor-pointer transition ${
                            isCapActive
                              ? 'bg-sky-500/35 border-amber-300 text-white font-bold z-10'
                              : 'bg-sky-950/60 hover:bg-sky-900/70 border-sky-500/30 text-sky-200'
                          } ${isFitEntireProject ? 'px-0.5 text-[8px]' : 'px-1 text-[9px]'}`}
                          title={`${formatTimeMMSS(cap.start)} - ${formatTimeMMSS(cap.end)}: ${formatCaptionTextCase(cap.text)}`}
                        >
                          {!isFitEntireProject && timelineZoom >= 12 && (
                            <span className="font-mono text-sky-300 mr-1">{formatTimeMMSS(cap.start)}</span>
                          )}
                          {formatCaptionTextCase(cap.text)}
                        </button>
                      );
                    })}
                  </>
                )}
              </div>
            </div>

            {/* TRACK 3: VIDEO CLIPS + FOLEY (DRAG & DROP REORDERING + REAL-TIME PLAYHEAD SELECTION) */}
            <div className={`flex items-center gap-2 ${isFitEntireProject ? 'w-full' : 'min-w-max'}`}>
              <div className="w-24 sm:w-36 shrink-0 sticky left-0 z-[35] self-stretch shadow-[0_0_0_4px_#0e0c09,-8px_0_0_4px_#0e0c09,4px_0_6px_-2px_rgba(0,0,0,0.7)] px-1.5 sm:px-2 py-1.5 rounded bg-[#2a1f0c] border border-amber-500/40 text-[9px] sm:text-[10px] font-black text-amber-300 flex flex-col gap-1">
                <span className="truncate">3. 🎬 Clips ({timelineClips.length})</span>
              </div>
              <div
                style={
                  isFitEntireProject
                    ? undefined
                    : { width: `${Math.max(300, totalDurationSec * timelineZoom)}px` }
                }
                className={`flex items-stretch bg-slate-950 border border-slate-800 rounded-lg py-1 px-0 overflow-hidden ${
                  isFitEntireProject ? 'flex-1 min-w-0' : 'shrink-0'
                }`}
              >
                {clipsWithTimelineBounds.length === 0 && (activeDoc?.clips?.length || 0) > 0 && (
                  <div className="flex items-center justify-between gap-3 px-3 py-2 w-full bg-amber-500/5 border border-dashed border-amber-500/30 rounded mx-1">
                    <span className="text-[11px] font-bold text-amber-200 truncate">
                      🔒 0/{activeDoc!.clips.length} clips revisados en Etapa 6 — Marca &ldquo;✅ Revisado&rdquo; en Etapa 6 para enviarlos al Timeline
                    </span>
                    {onOpenStage6Review && (
                      <button
                        type="button"
                        onClick={onOpenStage6Review}
                        className="shrink-0 px-2.5 py-1 rounded bg-emerald-500 hover:bg-emerald-400 text-slate-950 text-[10px] font-black cursor-pointer transition shadow"
                      >
                        Ir a Etapa 6 →
                      </button>
                    )}
                  </div>
                )}
                {clipsWithTimelineBounds.map((clip, idx) => {
                  const isCurrent = currentTime >= clip.start && currentTime < clip.end;
                  const isMultiSelected = selectedClipIds.includes(clip.id);
                  const isSelected =
                    selectedClip?.id === clip.id || isMultiSelected || isCurrent;
                  const slotWidthPx = clip.duration * timelineZoom;
                  const useCompactCard = isFitEntireProject || slotWidthPx < 135;
                  const clipPlayProgressPct = isCurrent
                    ? Math.min(
                        100,
                        Math.max(0, ((currentTime - clip.start) / Math.max(0.1, clip.duration)) * 100)
                      )
                    : 0;
                  const isOfficialBookend =
                    clip.id === 'fixed-doc-intro' ||
                    clip.id === 'fixed-doc-outro' ||
                    clip.clipNumber === 0 ||
                    clip.clipNumber === 999;
                  const isUnreviewedClip = !isOfficialBookend && !clip.reviewedForEditor;
                  const timelineThumbSrc = resolvePosterThumbSrc(clip);
                  const hasTimelineThumb = Boolean(timelineThumbSrc);

                  return (
                    <div
                      key={clip.id}
                      draggable
                      onDragStart={() => setDraggedClipIndex(idx)}
                      onDragOver={(e) => e.preventDefault()}
                      onDrop={() => {
                        if (draggedClipIndex !== null && draggedClipIndex !== idx) {
                          handleMoveClipOrder(draggedClipIndex, idx);
                        }
                        setDraggedClipIndex(null);
                      }}
                      onClick={(e) => {
                        if (e.metaKey || e.ctrlKey) {
                          setSelectedClipIds((prev) => {
                            const base = prev.length > 0 ? prev : selectedClipId ? [selectedClipId] : [];
                            const exists = base.includes(clip.id);
                            const next = exists
                              ? base.filter((id) => id !== clip.id)
                              : [...base, clip.id];
                            return next.length > 0 ? next : [clip.id];
                          });
                          setSelectedClipId(clip.id);
                        } else if (e.shiftKey && selectedClipId) {
                          const anchorIdx = clipsWithTimelineBounds.findIndex(
                            (c) => c.id === selectedClipId
                          );
                          if (anchorIdx >= 0) {
                            const startIdx = Math.min(anchorIdx, idx);
                            const endIdx = Math.max(anchorIdx, idx);
                            const rangeIds = clipsWithTimelineBounds
                              .slice(startIdx, endIdx + 1)
                              .map((c) => c.id);
                            setSelectedClipIds(rangeIds);
                          } else {
                            setSelectedClipIds([clip.id]);
                          }
                          setSelectedClipId(clip.id);
                        } else {
                          setSelectedClipId(clip.id);
                          setSelectedClipIds([clip.id]);
                        }
                        const rect = e.currentTarget.getBoundingClientRect();
                        if (rect.width > 12) {
                          const ratio = Math.max(0, Math.min(0.98, (e.clientX - rect.left) / rect.width));
                          const clickedTime = Number((clip.start + ratio * clip.duration).toFixed(2));
                          seekToTime(clickedTime);
                        } else {
                          seekToTime(clip.start);
                        }
                      }}
                      onContextMenu={(e) => {
                        e.preventDefault();
                        e.stopPropagation();
                        let targetIds =
                          selectedClipIds.length > 0 && selectedClipIds.includes(clip.id)
                            ? selectedClipIds
                            : [clip.id];
                        if (!selectedClipIds.includes(clip.id)) {
                          setSelectedClipId(clip.id);
                          setSelectedClipIds([clip.id]);
                        }
                        setClipContextMenu({
                          x: e.clientX,
                          y: e.clientY,
                          clipIds: targetIds,
                          showSepararSubmenu: true,
                        });
                      }}
                      title={`#${String(idx + 1).padStart(2, '0')} (Clip ${String(
                        clip.clipNumber
                      ).padStart(2, '0')}${clip.partLabel ? ` • ${clip.partLabel}` : ''}) • ${formatTimeMMSS(
                        clip.start
                      )} - ${formatTimeMMSS(clip.end)} • ${clip.duration}s (${clip.speed}x) • Clic derecho para opciones del clip`}
                      style={
                        isFitEntireProject
                          ? {
                              width: `${(clip.duration / Math.max(1, totalDurationSec)) * 100}%`,
                            }
                          : { width: `${slotWidthPx}px` }
                      }
                      className="shrink-0 px-[1px] select-none"
                    >
                      <div
                        className={`group relative h-full rounded border flex flex-col justify-between cursor-grab active:cursor-grabbing transition overflow-hidden ${
                          useCompactCard ? 'p-0.5 min-h-[54px]' : 'rounded-lg p-1.5 gap-1'
                        } ${
                          isMultiSelected && selectedClipIds.length > 1
                            ? 'border-2 border-emerald-400 bg-emerald-500/20 shadow-lg shadow-emerald-500/20 ring-2 ring-emerald-400/50 z-10'
                            : isCurrent
                            ? 'border-2 border-amber-400 bg-amber-500/25 shadow-lg shadow-amber-500/25 ring-2 ring-rose-500/50 z-10'
                            : isSelected
                            ? 'border-amber-400 bg-amber-500/20 shadow-lg shadow-amber-500/10 z-10'
                            : 'border-slate-800 bg-[#16130f] hover:border-amber-500/50'
                        } ${
                          isUnreviewedClip && !isCurrent && !isSelected
                            ? hasTimelineThumb
                              ? 'opacity-75 hover:opacity-95'
                              : 'opacity-25 hover:opacity-60'
                            : isUnreviewedClip
                            ? hasTimelineThumb
                              ? 'opacity-90'
                              : 'opacity-60'
                            : ''
                        }`}
                      >
                        {/* Real-Time Progress Fill inside the active clip as the playhead sweeps across it */}
                        {isCurrent && (
                          <div
                            style={{ width: `${clipPlayProgressPct}%` }}
                            className="pointer-events-none absolute inset-y-0 left-0 bg-gradient-to-r from-amber-500/20 via-amber-400/25 to-rose-500/35 border-r-2 border-rose-400 z-20"
                          />
                        )}

                        {useCompactCard ? (
                          <>
                            {(() => {
                              const compactThumbSrc = timelineThumbSrc;
                              const isCompactIntroOrOutro =
                                clip.id === 'fixed-doc-intro' ||
                                clip.id === 'fixed-doc-outro' ||
                                clip.clipNumber === 0 ||
                                clip.clipNumber === 999;
                              return compactThumbSrc ? (
                                <img
                                  src={compactThumbSrc}
                                  alt={clip.fileName}
                                  className="absolute inset-0 w-full h-full object-cover opacity-65 group-hover:opacity-90 transition"
                                  onError={(e) => {
                                    const imgEl = e.currentTarget;
                                    const failedThumb = imgEl.currentSrc || compactThumbSrc || '';
                                    if (
                                      isCompactIntroOrOutro &&
                                      officialLogoUrl &&
                                      !imgEl.dataset.fbApplied
                                    ) {
                                      imgEl.dataset.fbApplied = '1';
                                      imgEl.src = officialLogoUrl;
                                    }
                                    if (/^https?:\/\//i.test(failedThumb)) {
                                      void verifyMediaBridgeHealthOrRefresh(failedThumb);
                                    }
                                  }}
                                />
                              ) : null;
                            })()}
                            <div className="relative z-10 flex flex-col items-center justify-between h-full w-full text-center pointer-events-none">
                              <span
                                className={`px-1 py-0.5 rounded font-black text-[9px] leading-none truncate max-w-full ${
                                  isCurrent
                                    ? 'bg-amber-400 text-slate-950'
                                    : 'bg-black/80 text-amber-300'
                                }`}
                              >
                                {clip.clipNumber === 0
                                  ? 'INTRO'
                                  : clip.clipNumber === 999
                                  ? 'OUTRO'
                                  : `${String(clip.clipNumber).padStart(2, '0')}${
                                      clip.partLabel ? (clip.partLabel.includes('A') ? 'A' : 'B') : ''
                                    }`}
                              </span>
                              {activeDoc?.clips?.some(
                                (dc) => dc.clipNumber === clip.clipNumber && dc.isStaticBroll
                              ) && (
                                <span className="px-0.5 py-0.2 rounded bg-sky-400/95 text-[7px] font-black text-slate-950 leading-none">
                                  🖼️ B-Roll
                                </span>
                              )}
                              {clip.foleyOnlyIsolated && (
                                <span className="px-0.5 py-0.2 rounded bg-teal-400/95 text-[7px] font-black text-slate-950 leading-none">
                                  🌿 Foley
                                </span>
                              )}
                              {clip.vocalsSeparated && (
                                <span className="px-0.5 py-0.2 rounded bg-emerald-500/90 text-[7px] font-black text-slate-950 leading-none">
                                  🗣️ Sep
                                </span>
                              )}
                              {clip.musicSeparated && (
                                <span className="px-0.5 py-0.2 rounded bg-purple-500/90 text-[7px] font-black text-slate-950 leading-none">
                                  🎵 Sep
                                </span>
                              )}
                              {clip.speed < 1.0 && clip.smoothSlowMo !== false && (
                                <span className="px-0.5 py-0.2 rounded bg-sky-500/80 text-[7px] font-black text-slate-950 leading-none">
                                  🌊 {clip.speed}x
                                </span>
                              )}
                              {clip.audioMuted || (clip.foleyVolume ?? 20) <= 0 ? (
                                <span className="px-0.5 py-0.2 rounded bg-rose-600/95 text-[7px] font-black text-white leading-none">
                                  🔇 0%
                                </span>
                              ) : clip.customVolumeSet ? (
                                <span className="px-0.5 py-0.2 rounded bg-amber-500/90 text-[7px] font-black text-slate-950 leading-none">
                                  🔊 {clip.foleyVolume}%
                                </span>
                              ) : null}
                              <span className="px-0.5 py-0.5 rounded bg-black/75 text-[8px] font-mono text-slate-200 leading-none truncate max-w-full">
                                {formatTimeMMSS(clip.start)}
                              </span>
                            </div>
                          </>
                        ) : (
                          <>
                            <div className="relative z-10 flex items-center justify-between gap-1">
                              <span
                                className={`px-1.5 py-0.5 rounded font-black text-[10px] flex items-center gap-1 truncate ${
                                  isCurrent
                                    ? 'bg-rose-500 text-white'
                                    : 'bg-amber-500 text-slate-950'
                                }`}
                              >
                                {isCurrent ? '▶ ' : ''}
                                {clip.clipNumber === 0
                                  ? '🎬 INTRO 8K (Fade In/Out)'
                                  : clip.clipNumber === 999
                                  ? '🎬 OUTRO 8K (Fade In/Out)'
                                  : `#${String(idx + 1).padStart(2, '0')} (C${String(clip.clipNumber).padStart(2, '0')}${
                                      clip.partLabel ? ` • ${clip.partLabel}` : ''
                                    })`}
                                {clip.reviewedForEditor && (
                                  <span title="Revisado y enviado desde Etapa 8">✅</span>
                                )}

                              </span>
                              <span className="text-[10px] font-mono text-slate-200 shrink-0">
                                {formatTimeMMSS(clip.start)}-{formatTimeMMSS(clip.end)}
                              </span>
                            </div>

                            {(() => {
                              const expandedThumbSrc = timelineThumbSrc;
                              const isExpandedIntroOrOutro =
                                clip.id === 'fixed-doc-intro' ||
                                clip.id === 'fixed-doc-outro' ||
                                clip.clipNumber === 0 ||
                                clip.clipNumber === 999;
                              return expandedThumbSrc ? (
                                <div className="relative z-10 h-12 w-full rounded overflow-hidden bg-black border border-slate-800">
                                  <img
                                    src={expandedThumbSrc}
                                    alt={clip.fileName}
                                    className="w-full h-full object-cover"
                                    onError={(e) => {
                                      const imgEl = e.currentTarget;
                                      const failedThumb = imgEl.currentSrc || expandedThumbSrc || '';
                                      if (
                                        isExpandedIntroOrOutro &&
                                        officialLogoUrl &&
                                        !imgEl.dataset.fbApplied
                                      ) {
                                        imgEl.dataset.fbApplied = '1';
                                        imgEl.src = officialLogoUrl;
                                      }
                                      if (/^https?:\/\//i.test(failedThumb)) {
                                        void verifyMediaBridgeHealthOrRefresh(failedThumb);
                                      }
                                    }}
                                  />
                                {clip.speed < 1.0 && clip.smoothSlowMo !== false && (
                                  <span className="absolute top-1 left-1 px-1.5 py-0.5 rounded bg-sky-500/90 text-[8px] font-black text-slate-950 shadow">
                                    🌊 Optical Flow {clip.speed}x {clip.opticalFlowUrl ? '✓' : ''}
                                  </span>
                                )}
                                <div className="absolute top-1 right-1 flex flex-col items-end gap-0.5">
                                  {(() => {
                                    const brollDocClip = activeDoc?.clips?.find(
                                      (dc) => dc.clipNumber === clip.clipNumber && dc.isStaticBroll
                                    );
                                    const isCardBroll = Boolean(
                                      brollDocClip ||
                                        clip.isStaticBroll ||
                                        /_broll_4k/i.test(clip.fileName || '')
                                    );
                                    if (!isCardBroll) return null;
                                    const mKey: BrollCameraMotion =
                                      brollDocClip?.brollCameraMotion ||
                                      clip.brollCameraMotion ||
                                      'zoom_in';
                                    return (
                                      <span className="px-1 py-0.5 rounded bg-sky-400/95 text-[7px] font-black text-slate-950 leading-none shadow">
                                        🖼️ B-Roll · {BROLL_MOTION_UI_LABEL_ES[mKey]}
                                      </span>
                                    );
                                  })()}
                              {clip.foleyOnlyIsolated && (
                                    <span className="px-1.5 py-0.5 rounded bg-teal-400/95 text-[8px] font-black text-slate-950 shadow">
                                      🌿 Solo Foley
                                    </span>
                                  )}
                                  {clip.vocalsSeparated && (
                                    <span className="px-1.5 py-0.5 rounded bg-emerald-500/95 text-[8px] font-black text-slate-950 shadow">
                                      🗣️ Voz Separada
                                    </span>
                                  )}
                                  {clip.musicSeparated && (
                                    <span className="px-1.5 py-0.5 rounded bg-purple-500/95 text-[8px] font-black text-white shadow">
                                      🎵 Música Extraída
                                    </span>
                                  )}
                                </div>
                                <span className="absolute bottom-1 right-1 px-1.5 py-0.5 rounded bg-black/75 text-[9px] font-mono text-amber-300">
                                  {isCurrent ? '▶ En Curso' : !clip.videoUrl ? '🖼️ Img Inicial' : 'Fotograma 1'}
                                </span>
                              </div>
                            ) : (
                              <div className="relative z-10 h-12 w-full rounded overflow-hidden bg-slate-950/90 border border-slate-800/80 flex flex-col items-center justify-center p-1 text-center">
                                <div className="flex items-center gap-1">
                                  <span className="text-[10px] font-bold text-amber-300/90">
                                    🎬 Escena {String(clip.clipNumber).padStart(2, '0')}
                                  </span>
                                  {!clip.reviewedForEditor && (
                                    <span className="px-1 py-0.2 rounded bg-amber-500/15 border border-amber-400/30 text-[7px] font-bold text-amber-300">
                                      ⏳ Reservado
                                    </span>
                                  )}
                                </div>
                                {activeDoc?.clips?.some(
                                (dc) => dc.clipNumber === clip.clipNumber && dc.isStaticBroll
                              ) && (
                                <span className="px-0.5 py-0.2 rounded bg-sky-400/95 text-[7px] font-black text-slate-950 leading-none">
                                  🖼️ B-Roll
                                </span>
                              )}
                              {clip.foleyOnlyIsolated && (
                                  <span className="mt-0.5 px-1.5 py-0.5 rounded bg-teal-500/25 border border-teal-400/50 text-[8px] font-black text-teal-200">
                                    🌿 Solo Foley (Sin Voz ni Música)
                                  </span>
                                )}
                                {clip.vocalsSeparated && (
                                  <span className="mt-0.5 px-1.5 py-0.5 rounded bg-emerald-500/25 border border-emerald-500/50 text-[8px] font-black text-emerald-300">
                                    🗣️ Voz Separada en Pista 3B
                                  </span>
                                )}
                                {clip.musicSeparated && (
                                  <span className="mt-0.5 px-1.5 py-0.5 rounded bg-purple-500/25 border border-purple-500/50 text-[8px] font-black text-purple-300">
                                    🎵 Música Extraída en Pista 3C
                                  </span>
                                )}
                                <span className="text-[9px] text-slate-400 line-clamp-2 mt-0.5">
                                  {stripPauseTags(clip.narrationSegment || clip.videoPrompt || 'Sin .MP4 aún')}
                                </span>
                              </div>
                            );
                          })()}

                            <div className="relative z-10 flex items-center justify-between text-[9px] text-slate-400 pt-0.5 border-t border-slate-800/80">
                              <span className={clip.speed < 1.0 ? 'text-sky-300 font-bold' : ''}>
                                {clip.duration}s • {clip.speed}x
                                {clip.speed < 1.0 && clip.smoothSlowMo !== false ? ' 🌊' : ''}
                              </span>
                              <button
                                type="button"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  const nextMuted = !(clip.audioMuted || (clip.foleyVolume ?? 20) <= 0);
                                  handleUpdateClipsAudio({ audioMuted: nextMuted }, false, [clip.id]);
                                  setStatusMessage(
                                    nextMuted
                                      ? `🔇 Clip ${String(clip.clipNumber).padStart(2, '0')} silenciado (0%) para reproducción y exportación.`
                                      : `🔊 Audio restaurado en Clip ${String(clip.clipNumber).padStart(2, '0')}.`
                                  );
                                }}
                                title="Haz clic para silenciar o activar el audio de este clip"
                                className={`px-1 py-0.2 rounded font-bold transition cursor-pointer ${
                                  clip.audioMuted || (clip.foleyVolume ?? 20) <= 0
                                    ? 'bg-rose-500/30 border border-rose-500/60 text-rose-200'
                                    : clip.customVolumeSet
                                    ? 'bg-amber-500/25 border border-amber-500/50 text-amber-200'
                                    : 'hover:bg-slate-800 text-slate-300'
                                }`}
                              >
                                {clip.audioMuted || (clip.foleyVolume ?? 20) <= 0
                                  ? '🔇 Silenciado (0%)'
                                  : clip.foleyOnlyIsolated
                                  ? `🌿 Solo Foley • ${clip.foleyVolume}%`
                                  : clip.vocalsSeparated && clip.musicSeparated
                                  ? '🔇 Voz y Música Extraídas'
                                  : clip.vocalsSeparated
                                  ? '🔇 Voz Extraída'
                                  : clip.musicSeparated
                                  ? '🔇 Música Extraída'
                                  : clip.clipNumber === 0 || clip.clipNumber === 999
                                  ? `Audio Fade In/Out • ${clip.foleyVolume}%`
                                  : `🔊 ${clip.foleyVolume}%`}
                                {(clip.audioFadeInSec || clip.audioFadeOutSec)
                                  ? ` • 📈${clip.audioFadeInSec || 0}s 📉${clip.audioFadeOutSec || 0}s`
                                  : ''}
                              </button>
                            </div>
                          </>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>

            {/* TRACK 4: VOICEOVER NARRATION (FULL DURATION ON TIMELINE) */}
            <div className={`flex items-center gap-2 ${isFitEntireProject ? 'w-full' : 'min-w-max'}`}>
              <div className="w-24 sm:w-36 shrink-0 sticky left-0 z-[35] self-stretch shadow-[0_0_0_4px_#0e0c09,-8px_0_0_4px_#0e0c09,4px_0_6px_-2px_rgba(0,0,0,0.7)] px-1.5 sm:px-2 py-1 rounded bg-slate-900 border border-slate-800 text-[9px] sm:text-[10px] font-bold text-emerald-300 truncate flex items-center">
                4. 🎙️ Voz Narrativa
              </div>
              <div
                style={
                  isFitEntireProject
                    ? undefined
                    : { width: `${Math.max(300, totalDurationSec * timelineZoom)}px` }
                }
                className={`flex items-center bg-slate-950/80 border border-slate-800/80 rounded py-0.5 px-0 overflow-hidden ${
                  isFitEntireProject ? 'flex-1 min-w-0' : 'shrink-0'
                }`}
              >
                {/* Initial Silence Block for Clip 1 Hook (8s) */}
                <div
                  style={
                    isFitEntireProject
                      ? {
                          width: `${(voiceStartOffsetSec / Math.max(1, totalDurationSec)) * 100}%`,
                        }
                      : { width: `${voiceStartOffsetSec * timelineZoom}px` }
                  }
                  className="px-1 py-0.5 rounded-l bg-slate-900 border-r border-dashed border-slate-700 text-[9px] text-slate-400 text-center truncate shrink-0"
                >
                  🔇 {voiceStartOffsetSec}s Hook
                </div>
                {/* Main Voiceover Bar — Always spans the full voiceover duration */}
                <div
                  onClick={() => {
                    setSelectedMusicTrackId(null);
                    setActiveInspectorTab('audio');
                    setIsRightPanelCollapsed(false);
                  }}
                  style={
                    isFitEntireProject
                      ? {
                          width: `${
                            (Math.max(0, totalDurationSec - voiceStartOffsetSec) /
                              Math.max(1, totalDurationSec)) *
                            100
                          }%`,
                        }
                      : {
                          width: `${Math.max(0, totalDurationSec - voiceStartOffsetSec) * timelineZoom}px`,
                        }
                  }
                  className="px-2 py-0.5 rounded-r bg-emerald-500/20 hover:bg-emerald-500/30 border border-emerald-500/40 text-[10px] text-emerald-200 font-bold flex items-center justify-between gap-2 truncate shrink-0 cursor-pointer"
                >
                  <span className="truncate">
                    🎙️ Voz Narrativa ({formatTimeMMSS(voiceStartOffsetSec)} →{' '}
                    {formatTimeMMSS(
                      voiceStartOffsetSec +
                        Math.max(effectiveVoiceDurationSec, totalDurationSec - voiceStartOffsetSec)
                    )}{' '}
                    • Vol: {voiceVolume}% / {voiceGainDb >= 0 ? `+${voiceGainDb}` : voiceGainDb}dB)
                  </span>
                  <div className="flex items-center gap-1 shrink-0">
                    {effectiveVoiceoverUrl && (
                      <a
                        href={effectiveVoiceoverUrl}
                        download={`Voz_Narrativa_${(activeDoc?.title || 'Documental').replace(/[^a-zA-Z0-9_-]/g, '_')}.mp3`}
                        className="px-1.5 py-0.5 rounded bg-emerald-500 text-slate-950 hover:bg-emerald-400 text-[9px] font-black cursor-pointer"
                        title="Descargar Audio Maestro de Voz Narrativa (.MP3)"
                      >
                        ⬇️ MP3
                      </a>
                    )}
                    <label
                      className="px-1.5 py-0.5 rounded bg-slate-900 hover:bg-slate-800 border border-slate-700 text-[9px] text-emerald-300 font-bold cursor-pointer"
                      title="Subir archivo de Voz Narrativa (.MP3 o .WAV)"
                    >
                      📤 Subir
                      <input
                        type="file"
                        accept="audio/*,.mp3,.wav,.m4a"
                        className="hidden"
                        onChange={(e) => {
                          const f = e.target.files?.[0];
                          if (!f) return;
                          const url = URL.createObjectURL(f);
                          setVoiceAudioError(false);
                          updateActiveDoc({ masterAudioUrl: url });
                          setStatusMessage(`✅ Audio de voz narrativa "${f.name}" cargado en Pista 4.`);
                          e.target.value = '';
                        }}
                      />
                    </label>
                    <button
                      type="button"
                      onClick={() => setVoiceStartOffsetSec((s) => Math.max(0, s - 0.5))}
                      className="px-1 py-0.5 rounded bg-slate-900 hover:bg-slate-800 text-[9px] text-amber-300 cursor-pointer"
                    >
                      -0.5s
                    </button>
                    <button
                      type="button"
                      onClick={() => setVoiceStartOffsetSec((s) => s + 0.5)}
                      className="px-1 py-0.5 rounded bg-slate-900 hover:bg-slate-800 text-[9px] text-amber-300 cursor-pointer"
                    >
                      +0.5s
                    </button>
                  </div>
                </div>
              </div>
            </div>

            {/* TRACK 5: FLOW MUSIC MULTI-SCENE SOUNDTRACK (CLICKABLE SONGS WITH VOLUME, FADE-IN & FADE-OUT) */}
            <div className={`flex flex-col gap-1 ${isFitEntireProject ? 'w-full' : 'min-w-max'}`}>
              <div className={`flex items-center gap-2 ${isFitEntireProject ? 'w-full' : 'min-w-max'}`}>
                <div className="w-24 sm:w-36 shrink-0 sticky left-0 z-[35] self-stretch shadow-[0_0_0_4px_#0e0c09,-8px_0_0_4px_#0e0c09,4px_0_6px_-2px_rgba(0,0,0,0.7)] px-1.5 sm:px-2 py-1 rounded bg-slate-900 border border-slate-800 text-[9px] sm:text-[10px] font-bold text-purple-300 flex items-center justify-between truncate">
                  <span className="truncate">5. 🎵 FlowMusic ({musicTracks.length})</span>
                </div>
                <div
                  style={
                    isFitEntireProject
                      ? undefined
                      : { width: `${Math.max(300, totalDurationSec * timelineZoom)}px` }
                }
                  className={`relative h-7 bg-slate-950/80 border border-slate-800/80 rounded overflow-hidden flex items-center ${
                    isFitEntireProject ? 'flex-1 min-w-0' : 'shrink-0'
                  }`}
                >
                  {musicTracks.length === 0 ? (
                    <span className="text-[10px] text-slate-500 px-2 py-0.5">
                      Las pistas multi-escena de la Etapa 8 — Música (FlowMusic) aparecen aquí. Haz clic en cualquier canción para ajustar su volumen, Fade-In y Fade-Out.
                    </span>
                  ) : (
                    musicTracks.map((mt, mIdx) => {
                      const prevEnd =
                        mIdx > 0
                          ? musicTracks[mIdx - 1].start + musicTracks[mIdx - 1].duration
                          : 0;
                      const gapSec =
                        mIdx > 0 ? Math.max(0, Math.round(mt.start - prevEnd)) : Math.max(0, mt.start);
                      const isSongSelected = selectedMusicTrackId === mt.id;
                      const songVol = mt.volume ?? masterMusicVolume;
                      const songFadeIn = mt.fadeInSec ?? 5;
                      const songFadeOut = mt.fadeOutSec ?? 5;
                      const fadeInWidthPct = Math.min(
                        45,
                        Math.max(0, (songFadeIn / Math.max(1, mt.duration)) * 100)
                      );
                      const fadeOutWidthPct = Math.min(
                        45,
                        Math.max(0, (songFadeOut / Math.max(1, mt.duration)) * 100)
                      );
                      return (
                        <React.Fragment key={mt.id}>
                          {gapSec > 0 && (
                            <div
                              style={
                                isFitEntireProject
                                  ? { width: `${(gapSec / Math.max(1, totalDurationSec)) * 100}%` }
                                  : { width: `${gapSec * timelineZoom}px` }
                              }
                              className="px-1.5 py-0.5 rounded bg-slate-900/90 border-x border-dashed border-slate-700 text-[9px] text-slate-400 truncate text-center shrink-0"
                              title={`Espacio sin música de ${gapSec}s entre canciones (mínimo 30s y máximo 1:00 — solo voz narrativa + Foley)`}
                            >
                              🔇 Sin música {gapSec}s
                            </div>
                          )}
                          <div
                            onClick={(e) => {
                              e.stopPropagation();
                              setSelectedMusicTrackId(mt.id);
                              setActiveInspectorTab('audio');
                            }}
                            onDoubleClick={(e) => {
                              e.stopPropagation();
                              setSelectedMusicTrackId(mt.id);
                              setActiveInspectorTab('audio');
                              seekToTime(mt.start + 0.05);
                            }}
                            style={
                              isFitEntireProject
                                ? { width: `${(mt.duration / Math.max(1, totalDurationSec)) * 100}%` }
                                : { width: `${mt.duration * timelineZoom}px` }
                            }
                            className={`relative px-2 py-0.5 h-full rounded border text-[10px] flex items-center gap-1.5 truncate shrink-0 cursor-pointer select-none transition ${
                              isSongSelected
                                ? Boolean(mt.audioUrl)
                                  ? 'bg-purple-900/90 border-purple-300 text-white ring-2 ring-purple-400/70 shadow-lg shadow-purple-500/25 z-10'
                                  : 'bg-amber-950/90 border-amber-300 text-white ring-2 ring-amber-400/70 shadow-lg shadow-amber-500/25 z-10'
                                : Boolean(mt.audioUrl)
                                ? 'bg-purple-950/65 hover:bg-purple-900/75 border-purple-500/45 text-purple-200'
                                : 'bg-amber-950/50 hover:bg-amber-900/65 border-amber-500/50 border-dashed text-amber-200'
                            }`}
                            title={
                              Boolean(mt.audioUrl)
                                ? `Clic para editar volumen y fades • Doble clic para ir al inicio • ${mt.title} (${formatTimeMMSS(
                                    mt.start
                                  )} - ${formatTimeMMSS(
                                    mt.start + mt.duration
                                  )}) • Vol: ${songVol}% • Fade-In: ${songFadeIn}s • Fade-Out: ${songFadeOut}s`
                                : `⚠️ Pista ${mt.trackNumber} sin archivo local en 02_Audio/ (${mt.title}). Generar en flowmusic.app o suno.com con el prompt de Etapa 8. El reproductor extenderá la Pista 5 automáticamente.`
                            }
                          >
                            {/* Visual Fade-In Ramp Indicator */}
                            {songFadeIn > 0 && (
                              <div
                                style={{
                                  width: `${fadeInWidthPct}%`,
                                  clipPath: 'polygon(0 100%, 100% 0, 100% 100%)',
                                }}
                                className="pointer-events-none absolute inset-y-0 left-0 bg-purple-400/25 border-l-2 border-purple-300/60"
                              />
                            )}
                            {/* Visual Fade-Out Ramp Indicator */}
                            {songFadeOut > 0 && (
                              <div
                                style={{
                                  width: `${fadeOutWidthPct}%`,
                                  clipPath: 'polygon(0 0, 100% 100%, 0 100%)',
                                }}
                                className="pointer-events-none absolute inset-y-0 right-0 bg-purple-400/25 border-r-2 border-purple-300/60"
                              />
                            )}
                            <Music className={`w-3 h-3 ${Boolean(mt.audioUrl) ? 'text-purple-300' : 'text-amber-400'} shrink-0 relative z-10`} />
                            <span className="truncate relative z-10 font-semibold">
                              #{mt.trackNumber} {mt.title}{' '}
                              {!mt.audioUrl && (
                                <span className="text-amber-400 font-bold ml-1">
                                  ⚠️(Sin audio local — Loop P5)
                                </span>
                              )}{' '}
                              ({formatTimeMMSS(mt.start)} -{' '}
                              {formatTimeMMSS(mt.start + mt.duration)}) • 🔊 {songVol}% • 🎚️ In{' '}
                              {songFadeIn}s / Out {songFadeOut}s
                              {mt.isLast90Sec ? ' • Cierre 1:30' : ''}
                            </span>
                          </div>
                        </React.Fragment>
                      );
                    })
                  )}
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
