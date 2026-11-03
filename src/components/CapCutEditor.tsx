import React, { useState, useEffect, useLayoutEffect, useRef, useMemo } from 'react';
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
  RefreshCw,
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
import { DocumentaryProject, DocumentaryClip } from '../types';
import {
  stripPauseTags,
  normalizeQuantitiesToMil,
  getStage1ClipDurations,
  normalizeClip1Line1Format,
  splitWordsIntoShortLines,
} from '../utils/smartParsers';

export type ExportResolutionPreset = 'HD_1080P' | '2K_1440P' | '4K_2160P' | '8K_4320P';
export type EditorAspectRatio = '16:9' | '9:16';
export type ClipTransitionType =
  | 'direct'
  | 'crossfade'
  | 'dip_black'
  | 'dissolve'
  | 'zoom_in'
  | 'flash_sepia';

export interface TimelineClipItem {
  id: string;
  clipNumber: number;
  fileName: string;
  narrationSegment: string;
  imagePrompt?: string;
  videoPrompt?: string;
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

export interface TimelineCaptionItem {
  id: string;
  index: number;
  start: number; // in seconds on master timeline
  end: number;
  text: string;
}

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
    const rawText = lines.slice(timeLineIdx + 1).join(' ');
    const text = normalizeQuantitiesToMil(stripPauseTags(rawText))
      .replace(/\[pausa[^\]]*\]?/gi, '')
      .replace(/\s{2,}/g, ' ')
      .trim();
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

// Deterministically align any caption list to either Opción A (INTRO_INICIO_00: Voice starts at 16s)
// or Opción B (INTRO_POST_SLOGAN: Voice starts at 8s, with an 8s Intro pause inserted right after the Slogan Completo)
function alignCaptionsToIntroPlacement(
  rawItems: TimelineCaptionItem[],
  mode: 'INTRO_INICIO_00' | 'INTRO_POST_SLOGAN',
  baseHookSec = 8,
  introDurSec = 8,
  sloganSplitAudioSec = 68.5
): TimelineCaptionItem[] {
  if (!Array.isArray(rawItems) || rawItems.length === 0) return [];

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

  const targetInitialOffset = mode === 'INTRO_POST_SLOGAN' ? baseHookSec : baseHookSec + introDurSec;

  return rawItems.map((it, idx) => {
    const hadExtraIntroGap = existingPostSloganGapIdx >= 0 && idx > existingPostSloganGapIdx;
    const effectiveSourceOffset = sourceBaseOffset + (hadExtraIntroGap ? introDurSec : 0);
    const audioStart = Math.max(0, it.start - effectiveSourceOffset);
    const audioEnd = Math.max(audioStart + 0.25, it.end - effectiveSourceOffset);

    const needsPostSloganShift =
      mode === 'INTRO_POST_SLOGAN' && audioStart >= sloganSplitAudioSec - 0.15;
    const finalOffset = targetInitialOffset + (needsPostSloganShift ? introDurSec : 0);

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
  updateActiveDoc: (patch: Partial<DocumentaryProject>) => void;
  capturedClipVideosMap: Record<number, string>; // clipNumber -> blob/data URL of MP4
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
  isEditorActive?: boolean;
}

export const PERMANENT_LOGO_STORAGE_KEY = 'huellas_permanent_official_logo_v1';

export const CapCutEditor: React.FC<CapCutEditorProps> = ({
  activeDoc,
  documentaries = [],
  onSelectDoc,
  updateActiveDoc,
  capturedClipVideosMap,
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
  isEditorActive = true,
}) => {
  // 1. Aspect Ratio (16:9 vs 9:16) & Export Resolution (HD, 2K, 4K, 8K)
  const [aspectRatio, setAspectRatio] = useState<EditorAspectRatio>(() =>
    activeDoc?.productionType === 'REEL_9X16' ? '9:16' : '16:9'
  );
  const [exportResolution, setExportResolution] = useState<ExportResolutionPreset>('8K_4320P');
  const [defaultTransition, setDefaultTransition] = useState<ClipTransitionType>('direct');

  // Interactive Selection of Objects inside the Video Viewer ('logo' | 'hook_text' | 'captions' | null)
  const [selectedCanvasObject, setSelectedCanvasObject] = useState<
    'logo' | 'hook_text' | 'captions' | null
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

  const [logoScalePct, setLogoScalePct] = useState<number>(
    () => Number(initialOverlayStyles.logoScalePct) || 6
  );
  const [logoOpacity, setLogoOpacity] = useState<number>(
    () => Number(initialOverlayStyles.logoOpacity) || 95
  );
  const [logoPosX, setLogoPosX] = useState<number>(
    () => (typeof initialOverlayStyles.logoPosX === 'number' ? initialOverlayStyles.logoPosX : 3)
  );
  const [logoPosY, setLogoPosY] = useState<number>(
    () => (typeof initialOverlayStyles.logoPosY === 'number' ? initialOverlayStyles.logoPosY : 3)
  );
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
    const clip1HookDur = !clip1Sec || clip1Sec <= 6 ? 8 : clip1Sec;
    return 8 + clip1HookDur;
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
    () => initialOverlayStyles.captionAnimIn || 'fade'
  );
  const [captionAnimOut, setCaptionAnimOut] = useState<ElementAnimationType>(
    () => initialOverlayStyles.captionAnimOut || 'fade'
  );
  const [captionAnimDur, setCaptionAnimDur] = useState<number>(
    () => Number(initialOverlayStyles.captionAnimDur) || 0.25
  );

  const [clipAnimIn, setClipAnimIn] = useState<ElementAnimationType>('none');
  const [clipAnimOut, setClipAnimOut] = useState<ElementAnimationType>('none');
  const [clipAnimDur, setClipAnimDur] = useState<number>(0.6);

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
    () => initialOverlayStyles.hookBgStyle || 'word_shadow'
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
  const [isLeftPanelCollapsed, setIsLeftPanelCollapsed] = useState<boolean>(false);
  const [leftPanelTab, setLeftPanelTab] = useState<
    'media' | 'audio' | 'text' | 'transitions' | 'captions'
  >('media');
  const [isRightPanelCollapsed, setIsRightPanelCollapsed] = useState<boolean>(false);
  const [isTimelineDockExpanded, setIsTimelineDockExpanded] = useState<boolean>(false);
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
  const [selectedClipId, setSelectedClipId] = useState<string | null>(null);
  const [selectedClipIds, setSelectedClipIds] = useState<string[]>([]);
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
  const [selectedVocalSegmentId, setSelectedVocalSegmentId] = useState<string | null>(null);
  const [isSeparatingVocals, setIsSeparatingVocals] = useState<boolean>(false);
  const [separatedMusicSegments, setSeparatedMusicSegments] = useState<TimelineSeparatedVocalItem[]>(
    () =>
      initialDocOverlays && Array.isArray(initialDocOverlays.separatedMusicSegments)
        ? initialDocOverlays.separatedMusicSegments
        : []
  );
  const [selectedMusicSegmentId, setSelectedMusicSegmentId] = useState<string | null>(null);
  const [isSeparatingMusic, setIsSeparatingMusic] = useState<boolean>(false);
  const [isIsolatingFoley, setIsIsolatingFoley] = useState<boolean>(false);
  const [foleyIsolationProgress, setFoleyIsolationProgress] = useState<{ current: number; total: number } | null>(null);
  const [autoIsolateFoleyAllClips, setAutoIsolateFoleyAllClips] = useState<boolean>(() => {
    try {
      return localStorage.getItem('huellas_editor_auto_foley_only_v3') !== 'false';
    } catch {
      return true;
    }
  });
  const autoAttemptedFoleyClipIdsRef = useRef<Set<string>>(new Set());
  const [draggedClipIndex, setDraggedClipIndex] = useState<number | null>(null);
  const [showOnlyReviewedClips, setShowOnlyReviewedClips] = useState<boolean>(false);

  // Voiceover Track (Track 4) — Starts at 16s in Opción A (after 8s Intro + 8s Clip 1 Hook) or 8s in Opción B (Post-Slogan)
  const [voiceStartOffsetSec, setVoiceStartOffsetSec] = useState<number>(() => {
    const mode =
      activeDoc?.promptConfig?.UBICACION_INTRO_MARCA === 'INTRO_POST_SLOGAN'
        ? 'INTRO_POST_SLOGAN'
        : 'INTRO_INICIO_00';
    const { clip1Sec } = getStage1ClipDurations(activeDoc);
    const clip1HookDur = !clip1Sec || clip1Sec <= 6 ? 8 : clip1Sec;
    return mode === 'INTRO_POST_SLOGAN' ? clip1HookDur : 8 + clip1HookDur;
  });
  const [voiceDurationSec, setVoiceDurationSec] = useState<number>(0);
  const [voiceVolume, setVoiceVolume] = useState<number>(100);
  const [voiceGainDb, setVoiceGainDb] = useState<number>(5); // Always +5 dB boost for narrative voiceover
  const [autoDuckingEnabled, setAutoDuckingEnabled] = useState<boolean>(true);
  const [foleyHighVolume, setFoleyHighVolume] = useState<number>(80); // When narrator is silent
  const [foleyDuckedVolume, setFoleyDuckedVolume] = useState<number>(35); // When narrator speaks

  // Captions Track (Track 2) + Typography, Size, Shadow, Background & Position
  const [captions, setCaptions] = useState<TimelineCaptionItem[]>(() => {
    if (
      initialDocOverlays &&
      Array.isArray(initialDocOverlays.captions) &&
      initialDocOverlays.captions.length > 0
    ) {
      const mode =
        activeDoc?.promptConfig?.UBICACION_INTRO_MARCA === 'INTRO_POST_SLOGAN'
          ? 'INTRO_POST_SLOGAN'
          : 'INTRO_INICIO_00';
      const { clip1Sec } = getStage1ClipDurations(activeDoc);
      const clip1HookDur = !clip1Sec || clip1Sec <= 6 ? 8 : clip1Sec;
      return alignCaptionsToIntroPlacement(initialDocOverlays.captions, mode, clip1HookDur, 8, 68.5);
    }
    return [];
  });
  const [captionFontFamily, setCaptionFontFamily] = useState<string>(
    () => initialOverlayStyles.captionFontFamily || EDITOR_FONT_OPTIONS[0].value
  );
  const [captionFontSize, setCaptionFontSize] = useState<number>(() =>
    initialOverlayStyles.captionFontSizeV25
      ? Number(initialOverlayStyles.captionFontSize) || 25
      : activeDoc?.productionType === 'REEL_9X16'
      ? 22
      : 25
  );
  const [captionBottomPct, setCaptionBottomPct] = useState<number>(() =>
    typeof initialOverlayStyles.captionBottomPct === 'number'
      ? initialOverlayStyles.captionBottomPct
      : 11
  );
  const [captionColor, setCaptionColor] = useState<'white' | 'amber' | 'custom'>(
    () => initialOverlayStyles.captionColor || 'white'
  );
  const [captionCustomColor, setCaptionCustomColor] = useState<string>(
    () => initialOverlayStyles.captionCustomColor || '#ffffff'
  );
  const [captionShadowStyle, setCaptionShadowStyle] = useState<OverlayShadowStyle>(
    () => initialOverlayStyles.captionShadowStyle || 'cinema'
  );
  const [captionBgStyle, setCaptionBgStyle] = useState<OverlayBgStyle>(
    () => initialOverlayStyles.captionBgStyle || 'word_shadow'
  );
  const [captionBgColor, setCaptionBgColor] = useState<string>(
    () => initialOverlayStyles.captionBgColor || '#000000'
  );
  const [captionBgOpacity, setCaptionBgOpacity] = useState<number>(() =>
    typeof initialOverlayStyles.captionBgOpacity === 'number'
      ? initialOverlayStyles.captionBgOpacity
      : 25
  );
  const [captionTextCase, setCaptionTextCase] = useState<'original' | 'uppercase' | 'lowercase'>(
    () =>
      initialOverlayStyles.captionTextCase === 'uppercase' ||
      initialOverlayStyles.captionTextCase === 'lowercase'
        ? initialOverlayStyles.captionTextCase
        : 'original'
  );

  const formatCaptionTextCase = (text: string): string => {
    const raw = String(text || '');
    if (captionTextCase === 'uppercase') return raw.toLocaleUpperCase('es-ES');
    if (captionTextCase === 'lowercase') return raw.toLocaleLowerCase('es-ES');
    return raw;
  };

  // Track whether the user has edited Hook Text or Captions on the active documentary so background effects NEVER reset them
  const userEditedHookDocIdRef = useRef<string>(
    initialDocOverlays?.userEditedHook ? activeDoc?.id || 'default' : ''
  );
  const userEditedCaptionsDocIdRef = useRef<string>(
    initialDocOverlays?.userEditedCaptions ? activeDoc?.id || 'default' : ''
  );
  const lastSyncedDocIdRef = useRef<string>('');
  const lastSyncedIntroPlacementRef = useRef<string>(
    activeDoc?.promptConfig?.UBICACION_INTRO_MARCA === 'INTRO_POST_SLOGAN'
      ? 'INTRO_POST_SLOGAN'
      : 'INTRO_INICIO_00'
  );

  const persistDocOverlaysPatch = (patch: Record<string, any>, targetDocId?: string) => {
    const docKey = `huellas_editor_doc_overlays_${targetDocId || activeDoc?.id || 'default'}`;
    try {
      const existingRaw = localStorage.getItem(docKey);
      const existing = existingRaw ? JSON.parse(existingRaw) : {};
      localStorage.setItem(docKey, JSON.stringify({ ...existing, ...patch, updatedAt: Date.now() }));
    } catch {}
  };

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
          captionFontSizeV25: true,
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
    setCaptions((prev) => {
      const updated = prev.map((c) => (c.id === captionId ? { ...c, text: newText } : c));
      persistDocOverlaysPatch({ captions: updated, userEditedCaptions: true }, docId);
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

    const onMove = (moveEvt: MouseEvent) => {
      const dyPx = moveEvt.clientY - startY;
      if (Math.abs(dyPx) < 2) return;
      const nextBottom = Math.max(4, Math.min(55, initBottom - (dyPx / rect.height) * 100));
      setCaptionBottomPct(Number(nextBottom.toFixed(1)));
    };

    const onUp = () => {
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
    };

    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
  };

  // Music Track (Track 5 - Suno)
  const [musicTracks, setMusicTracks] = useState<TimelineMusicItem[]>([]);
  const [masterMusicVolume, setMasterMusicVolume] = useState<number>(10);
  const [selectedMusicTrackId, setSelectedMusicTrackId] = useState<string | null>(null);

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
  const [currentTime, setCurrentTime] = useState<number>(() => {
    try {
      const saved = Number(
        localStorage.getItem(`huellas_editor_playhead_${activeDoc?.id || 'default'}`) || 0
      );
      return Number.isFinite(saved) && saved >= 0 ? saved : 0;
    } catch {
      return 0;
    }
  });
  const [timelineZoom, setTimelineZoom] = useState<number>(20); // pixels per second
  const [isFitEntireProject, setIsFitEntireProject] = useState<boolean>(false);
  const [activeInspectorTab, setActiveInspectorTab] = useState<
    'clips' | 'audio' | 'branding' | 'captions'
  >('clips');
  const [isRenderingVideo, setIsRenderingVideo] = useState<boolean>(false);
  const [renderProgressPct, setRenderProgressPct] = useState<number>(0);
  const [statusMessage, setStatusMessage] = useState<string>('');
  const [voiceAudioError, setVoiceAudioError] = useState<boolean>(false);
  const [firstFrameByClip, setFirstFrameByClip] = useState<Record<number, string>>({});
  const [localServerClipVideosMap, setLocalServerClipVideosMap] = useState<Record<number, string>>({});
  const [localServerSunoMap, setLocalServerSunoMap] = useState<Record<number, string>>({});

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
  const timelineScrollContainerRef = useRef<HTMLDivElement | null>(null);
  const timelineRulerScrollRef = useRef<HTMLDivElement | null>(null);
  const timelineRulerLaneRef = useRef<HTMLDivElement | null>(null);
  const isScrubbingRulerRef = useRef<boolean>(false);
  const prevDocIdForPlayheadRef = useRef<string | undefined>(activeDoc?.id);
  const zoomPlayheadViewportOffsetRef = useRef<number | null>(null);

  // Persist playhead position per documentary so leaving the editor to another stage and returning keeps the video right where it was
  useEffect(() => {
    try {
      localStorage.setItem(
        `huellas_editor_playhead_${activeDoc?.id || 'default'}`,
        String(Number(currentTime.toFixed(2)))
      );
    } catch {}
  }, [currentTime, activeDoc?.id]);

  // Restore saved playhead position when switching to a different documentary
  useEffect(() => {
    if (prevDocIdForPlayheadRef.current === activeDoc?.id) return;
    prevDocIdForPlayheadRef.current = activeDoc?.id;
    try {
      const saved = Number(
        localStorage.getItem(`huellas_editor_playhead_${activeDoc?.id || 'default'}`) || 0
      );
      const nextTime = Number.isFinite(saved) && saved >= 0 ? saved : 0;
      currentTimeRef.current = nextTime;
      playTimelineStartSecRef.current = nextTime;
      lastSeekVersionRef.current += 1;
      setCurrentTime(nextTime);
    } catch {}
  }, [activeDoc?.id]);

  // Pause playback automatically if user navigates away from the Video Editor to another stage, keeping exact playhead position
  useEffect(() => {
    if (!isEditorActive && isPlaying) {
      setIsPlaying(false);
    }
  }, [isEditorActive, isPlaying]);

  const prevDocIdForMediaScanRef = useRef<string | undefined>(activeDoc?.id);

  // Reset extracted first frames when switching documentaries, and re-query local server 05_Clips_Video whenever editor becomes active
  useEffect(() => {
    if (prevDocIdForMediaScanRef.current !== activeDoc?.id) {
      prevDocIdForMediaScanRef.current = activeDoc?.id;
      setFirstFrameByClip({});
      setLocalServerClipVideosMap({});
      setLocalServerSunoMap({});
      extractedVideoUrlByClipRef.current = {};
    }

    let cancelled = false;
    const fetchFolderMedia = async () => {
      const fPath = (downloadFolderPath || activeDoc?.downloadFolderPath || '').trim();
      const fName = (downloadFolderName || activeDoc?.downloadFolderName || '').trim();
      const dTitle = (activeDoc?.title || '').trim();
      const qs = `folderPath=${encodeURIComponent(fPath)}&folderName=${encodeURIComponent(fName)}&docTitle=${encodeURIComponent(dTitle)}`;
      const isLocal =
        typeof window !== 'undefined' &&
        (window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1');
      const bases = isLocal ? [''] : ['', 'http://localhost:4200'];
      for (const base of bases) {
        if (cancelled) return;
        try {
          const res = await fetch(`${base}/api/flow/list-folder-media?${qs}`);
          if (!res.ok) continue;
          const data = await res.json();
          if (cancelled) return;
          const prefix = (u: string) => (u && u.startsWith('/') && base ? `${base}${u}` : u);
          if (Array.isArray(data.clipFrames) && data.clipFrames.length > 0) {
            const nextFrames: Record<number, string> = {};
            for (const f of data.clipFrames) {
              if (f.clipNumber > 0 && f.url && !nextFrames[f.clipNumber]) {
                nextFrames[f.clipNumber] = prefix(f.url);
              }
            }
            if (Object.keys(nextFrames).length > 0) {
              setFirstFrameByClip((prev) => {
                const changed = Object.entries(nextFrames).some(([k, v]) => prev[Number(k)] !== v);
                return changed ? { ...prev, ...nextFrames } : prev;
              });
            }
          }
          if (Array.isArray(data.clipVideos) && data.clipVideos.length > 0) {
            const nextVids: Record<number, string> = {};
            for (const item of data.clipVideos) {
              if (item.clipNumber > 0 && item.url) {
                nextVids[item.clipNumber] = prefix(item.url);
              }
            }
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
            if (Array.isArray(data.sunoFiles) && data.sunoFiles.length > 0) {
              const nextSuno: Record<number, string> = {};
              for (const s of data.sunoFiles) {
                if (s.trackNumber > 0 && s.url && !nextSuno[s.trackNumber]) {
                  nextSuno[s.trackNumber] = prefix(s.url);
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
            break;
          }
        } catch {}
      }
    };

    fetchFolderMedia();
    const onWinFocus = () => {
      if (isEditorActive) fetchFolderMedia();
    };
    window.addEventListener('focus', onWinFocus);
    const pollTimer = window.setInterval(() => {
      if (isEditorActive && !document.hidden) {
        fetchFolderMedia();
      }
    }, 6000);

    return () => {
      cancelled = true;
      window.removeEventListener('focus', onWinFocus);
      window.clearInterval(pollTimer);
    };
  }, [activeDoc?.id, activeDoc?.title, downloadFolderName, downloadFolderPath, isEditorActive]);

  // Automatically extract the exact FIRST FRAME (t = 0.08s) of each clip's .MP4 video ONLY when editor is active & paused, without saturating Chrome's 6-socket pool
  useEffect(() => {
    if (!isEditorActive || isPlaying) return;
    let cancelled = false;
    const clipsToExtract = timelineClips.filter(
      (c) =>
        c.videoUrl &&
        !c.posterUrl &&
        !firstFrameByClip[c.clipNumber] &&
        extractedVideoUrlByClipRef.current[c.clipNumber] !== c.videoUrl
    );
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
        vid.src = videoUrl;
      });

    (async () => {
      for (const item of clipsToExtract) {
        if (cancelled || !item.videoUrl) return;
        const frameDataUrl = await extractFirstFrameFromVideoUrl(item.videoUrl);
        if (cancelled) return;
        extractedVideoUrlByClipRef.current[item.clipNumber] = item.videoUrl;
        if (frameDataUrl) {
          setFirstFrameByClip((prev) => ({
            ...prev,
            [item.clipNumber]: frameDataUrl,
          }));
        }
        await new Promise((r) => setTimeout(r, 80));
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [timelineClips, isPlaying, isEditorActive]);

  // Resolve Voiceover URL across masterAudioUrl, audioTracks, folderVoiceoverUrl, or pre-bundled TTS files
  const effectiveVoiceoverUrl = useMemo(() => {
    const norm = (u?: string) => {
      if (!u || typeof u !== 'string') return '';
      const t = u.trim();
      if (/^\/?tts-files\/(.+)\.wav$/i.test(t)) {
        return t.replace(/^\/?tts-files\/(.+)\.wav$/i, 'tts-files/$1.mp3');
      }
      if (t.startsWith('/tts-files/')) return t.slice(1);
      return t;
    };

    if (folderVoiceoverUrl) return norm(folderVoiceoverUrl);
    const master = norm(activeDoc?.masterAudioUrl);
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
      return 'tts-files/tts-video-76-exodo-espanol.mp3';
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
  ]);

  useEffect(() => {
    setVoiceAudioError(false);
  }, [effectiveVoiceoverUrl]);

  // Load permanent official logo from server on mount if not already in localStorage
  useEffect(() => {
    fetch('/api/assets/official-logo')
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => {
        if (data?.logoDataUrl) {
          setOfficialLogoUrl(data.logoDataUrl);
          localStorage.setItem(PERMANENT_LOGO_STORAGE_KEY, data.logoDataUrl);
          if (onOfficialLogoChange) onOfficialLogoChange(data.logoDataUrl);
        }
      })
      .catch(() => {});

    fetch('/api/assets/official-intro')
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => {
        if (data?.hasIntro && data?.introUrl) {
          setOfficialIntroUrl(data.introUrl);
          setOfficialIntroFileName(data.fileName || 'Intro_Oficial_Huellas_4s.mp4');
        }
      })
      .catch(() => {});
  }, []);

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
        await fetch('/api/assets/official-logo', {
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
        const resp = await fetch('/api/assets/official-intro', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ videoDataUrl: dataUrl, fileName: file.name }),
        });
        const data = await resp.json();
        if (data?.ok && data.introUrl) {
          setOfficialIntroUrl(data.introUrl);
          setOfficialIntroFileName(file.name);
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
    if (isVideo76Doc) return 890.83;
    if (effectiveVoiceoverUrl.includes('tts-1793103539750-763')) return 739.76;
    const trackDur = Number(activeDoc?.audioTracks?.[0]?.duration || 0);
    if (trackDur > 1) return trackDur;
    return 0;
  }, [voiceDurationSec, activeDoc?.audioTracks, effectiveVoiceoverUrl, isVideo76Doc]);

  // Exact audio second (relative to 0.0s of Voiceover MP3) where the opening Slogan Completo ("...Aquí seguimos sus rastros.") ends
  const sloganSplitAudioSec = useMemo(() => {
    if (isVideo76Doc) {
      // In tts-video-76-exodo-espanol.mp3, "Aquí seguimos sus rastros." ends at 67.66s and "Para comprender la raíz..." starts at 69.89s
      return 68.5;
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
          const estSec = (cleanBefore.length / cleanAll.length) * effectiveVoiceDurationSec + 0.8;
          return Number(Math.max(22, Math.min(110, estSec)).toFixed(2));
        }
      }
    }
    return 68.5;
  }, [isVideo76Doc, activeDoc?.voiceoverScript, effectiveVoiceDurationSec]);

  // Build & align Track 3 clips for either Opción A (INTRO_INICIO_00: 00:00-00:08) or Opción B (INTRO_POST_SLOGAN: right after Slogan Completo without cutting any clip)
  const buildAlignedTimelineClipsForIntroMode = (
    rawClipsInput: TimelineClipItem[],
    mode: 'INTRO_POST_SLOGAN' | 'INTRO_INICIO_00',
    fixedIntroClip: TimelineClipItem,
    fixedOutroClip?: TimelineClipItem | null
  ): TimelineClipItem[] => {
    // 1. Strip existing intro, outro, and any previously split partB slogan clip; restore partA to full clip
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
      return fixedOutroClip ? [fixedIntroClip, fixedOutroClip] : [fixedIntroClip];
    }

    // 2. Locate the exact clip in the opening section (Clips 2..12) where the Slogan Completo ("Aquí seguimos sus rastros.") ends
    let sloganClipIdx = -1;
    const searchLimit = Math.min(cleanBody.length, 13);
    for (let i = 1; i < searchLimit; i++) {
      const c = cleanBody[i];
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
    if (sloganClipIdx < 1) {
      if (isVideo76Doc && cleanBody.length >= 7) {
        sloganClipIdx = 6; // Clip 7 (07_suscribete_Cada_historia_deja_una_huella_4K.mp4)
      } else {
        let cum = 0;
        let bestIdx = Math.min(6, cleanBody.length - 1);
        let bestDiff = Infinity;
        for (let i = 1; i < searchLimit; i++) {
          cum += cleanBody[i].duration || 10;
          const diff = Math.abs(cum - sloganSplitAudioSec);
          if (diff < bestDiff) {
            bestDiff = diff;
            bestIdx = i;
          }
        }
        sloganClipIdx = Math.max(1, bestIdx);
      }
    }

    // 3. Align durations of pre-slogan and post-slogan narrated clips so the Slogan clip ends at the exact second "Aquí seguimos sus rastros." finishes
    const targetVoiceDur = effectiveVoiceDurationSec > 20 ? effectiveVoiceDurationSec : 0;
    if (mode === 'INTRO_POST_SLOGAN') {
      const sloganClip = cleanBody[sloganClipIdx];
      // In Video 76, Clip 7 (7.85s MP4) has Shot 1 (0s-4.28s: Historian's Desk for Slogan) and Shot 2 (4.36s-7.85s: Asturias Mountains for Chapter 1)
      const isVid76TwoShotClip7 = Boolean(isVideo76Doc && sloganClip && sloganClip.clipNumber === 7);

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

        const preClips = [...cleanBody.slice(1, sloganClipIdx), partA];
        const postClips = [partB, ...cleanBody.slice(sloganClipIdx + 1)];

        if (targetVoiceDur > sloganSplitAudioSec + 10) {
          const preRawSum = preClips.reduce((acc, it) => acc + (it.duration || 10), 0);
          if (preRawSum > 0) {
            let runPre = 0;
            preClips.forEach((pc, idx) => {
              if (idx === preClips.length - 1) {
                pc.duration = Number(Math.max(2, sloganSplitAudioSec - runPre).toFixed(2));
              } else {
                pc.duration = Number(
                  Math.max(2, (pc.duration / preRawSum) * sloganSplitAudioSec).toFixed(2)
                );
                runPre += pc.duration;
              }
              pc.originalSlotDuration = pc.duration;
            });
          }

          const remAfterPartB = Math.max(10, targetVoiceDur - sloganSplitAudioSec - partB.duration);
          const restPost = postClips.slice(1);
          const restRawSum = restPost.reduce((acc, it) => acc + (it.duration || 10), 0);
          if (restRawSum > 0 && restPost.length > 0) {
            let runPost = 0;
            restPost.forEach((rc, idx) => {
              if (idx === restPost.length - 1) {
                rc.duration = Number(Math.max(2, remAfterPartB - runPost).toFixed(2));
              } else {
                rc.duration = Number(
                  Math.max(2, (rc.duration / restRawSum) * remAfterPartB).toFixed(2)
                );
                runPost += rc.duration;
              }
              rc.originalSlotDuration = rc.duration;
            });
          }
        }

        const assembled = [
          cleanBody[0],
          ...preClips,
          fixedIntroClip,
          ...postClips,
          ...(fixedOutroClip ? [fixedOutroClip] : []),
        ];
        return assembled;
      }

      // Standard single-shot Slogan clip in Opción B: align Clips 2..sloganClipIdx to sloganSplitAudioSec, then insert fixedIntroClip
      const preClips = cleanBody.slice(1, sloganClipIdx + 1);
      const postClips = cleanBody.slice(sloganClipIdx + 1);
      if (targetVoiceDur > sloganSplitAudioSec + 10 && preClips.length > 0) {
        const preRawSum = preClips.reduce((acc, it) => acc + (it.duration || 10), 0);
        if (preRawSum > 0) {
          let runPre = 0;
          preClips.forEach((pc, idx) => {
            if (idx === preClips.length - 1) {
              pc.duration = Number(Math.max(2, sloganSplitAudioSec - runPre).toFixed(2));
            } else {
              pc.duration = Number(
                Math.max(2, (pc.duration / preRawSum) * sloganSplitAudioSec).toFixed(2)
              );
              runPre += pc.duration;
            }
            pc.originalSlotDuration = pc.duration;
          });
        }
        const remVoiceDur = Math.max(10, targetVoiceDur - sloganSplitAudioSec);
        const postRawSum = postClips.reduce((acc, it) => acc + (it.duration || 10), 0);
        if (postRawSum > 0 && postClips.length > 0) {
          let runPost = 0;
          postClips.forEach((rc, idx) => {
            if (idx === postClips.length - 1) {
              rc.duration = Number(Math.max(2, remVoiceDur - runPost).toFixed(2));
            } else {
              rc.duration = Number(
                Math.max(2, (rc.duration / postRawSum) * remVoiceDur).toFixed(2)
              );
              runPost += rc.duration;
            }
            rc.originalSlotDuration = rc.duration;
          });
        }
      }

      return [
        cleanBody[0],
        ...preClips,
        fixedIntroClip,
        ...postClips,
        ...(fixedOutroClip ? [fixedOutroClip] : []),
      ];
    }

    // Opción A (INTRO_INICIO_00): Fixed 8s Intro at 00:00 - 00:08, Clip 1 at 00:08 - 00:16, Narrated Clips 2..N aligned to targetVoiceDur
    if (targetVoiceDur > 10 && cleanBody.length > 1) {
      if (isVideo76Doc && sloganClipIdx === 6 && cleanBody.length > 7) {
        // Lock Clips 2..7 to end at 77.30s of audio (so Clip 7's internal 4.33s shot cut lands right at 68.5s after the Slogan!)
        const preTarget = 77.3;
        const preClips = cleanBody.slice(1, 7);
        const postClips = cleanBody.slice(7);
        const preSum = preClips.reduce((acc, it) => acc + (it.duration || 10), 0);
        if (preSum > 0) {
          let runPre = 0;
          preClips.forEach((pc, idx) => {
            if (idx === preClips.length - 1) {
              pc.duration = Number(Math.max(2, preTarget - runPre).toFixed(2));
            } else {
              pc.duration = Number(Math.max(2, (pc.duration / preSum) * preTarget).toFixed(2));
              runPre += pc.duration;
            }
            pc.originalSlotDuration = pc.duration;
          });
        }
        const remTarget = Math.max(10, targetVoiceDur - preTarget);
        const postSum = postClips.reduce((acc, it) => acc + (it.duration || 10), 0);
        if (postSum > 0 && postClips.length > 0) {
          let runPost = 0;
          postClips.forEach((rc, idx) => {
            if (idx === postClips.length - 1) {
              rc.duration = Number(Math.max(2, remTarget - runPost).toFixed(2));
            } else {
              rc.duration = Number(Math.max(2, (rc.duration / postSum) * remTarget).toFixed(2));
              runPost += rc.duration;
            }
            rc.originalSlotDuration = rc.duration;
          });
        }
      } else {
        const narratedClips = cleanBody.slice(1);
        const rawNarratedSum = narratedClips.reduce((acc, item) => acc + item.duration, 0);
        if (rawNarratedSum > 0 && Math.abs(targetVoiceDur - rawNarratedSum) > 0.5) {
          let runningSec = 0;
          narratedClips.forEach((nc, idx) => {
            if (idx === narratedClips.length - 1) {
              nc.duration = Number(Math.max(2, targetVoiceDur - runningSec).toFixed(2));
            } else {
              const scaled = Number(((nc.duration / rawNarratedSum) * targetVoiceDur).toFixed(2));
              nc.duration = Math.max(2, scaled);
              runningSec += nc.duration;
            }
            nc.originalSlotDuration = nc.duration;
          });
        }
      }
    }

    return [
      fixedIntroClip,
      ...cleanBody,
      ...(fixedOutroClip ? [fixedOutroClip] : []),
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

    const isLocalHost =
      typeof window !== 'undefined' &&
      (window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1');
    const serverOrigin = isLocalHost ? '' : 'http://localhost:4200';
    const introOutroBasePath =
      '/Users/raydelsantana/Library/Mobile Documents/com~apple~CloudDocs/0YouTube/Huellas de la Humanidad/Intro:Outro';
    const defaultIntro8kUrl = `${serverOrigin}/api/flow/serve-folder-file?filePath=${encodeURIComponent(
      `${introOutroBasePath}/Intro.mp4`
    )}&v=clean_native_audio_v2`;
    const introPosterUrl = `${serverOrigin}/api/flow/serve-folder-file?filePath=${encodeURIComponent(
      `${introOutroBasePath}/.Intro_Poster.jpg`
    )}&v=clean_native_audio_v2`;
    const outroVideoUrl = `${serverOrigin}/api/flow/serve-folder-file?filePath=${encodeURIComponent(
      `${introOutroBasePath}/Outro.mp4`
    )}&v=clean_native_audio_v2`;
    const outroPosterUrl = `${serverOrigin}/api/flow/serve-folder-file?filePath=${encodeURIComponent(
      `${introOutroBasePath}/.Outro_Poster.jpg`
    )}&v=clean_native_audio_v2`;
    const effectiveIntroUrl = officialIntroUrl || defaultIntro8kUrl;

    const introClipItem: TimelineClipItem = {
      id: 'fixed-doc-intro',
      clipNumber: 0,
      fileName: '00_Intro_Huellas_de_la_Humanidad_8K.mp4',
      timeRangeLabel: mode === 'INTRO_INICIO_00' ? '00:00 - 00:08' : 'Intro Oficial Post-Slogan (8s)',
      duration: 8,
      sourceDuration: 8,
      originalDuration: 8,
      originalSlotDuration: 8,
      speed: 1,
      foleyVolume: 100,
      audioFadeInSec: 1.5,
      audioFadeOutSec: 2.5,
      transition: 'crossfade',
      videoUrl: effectiveIntroUrl,
      posterUrl: introPosterUrl || officialLogoUrl || undefined,
      narrationSegment:
        mode === 'INTRO_INICIO_00'
          ? '🎬 INTRO OFICIAL (00:00 - 00:08 • Audio Fade In 1.5s + Fade Out 2.5s) — Huellas de la Humanidad (8K)'
          : '🎬 INTRO OFICIAL POST-SLOGAN (8s tras "Aquí seguimos sus rastros." • Audio Fade In 1.5s + Fade Out 2.5s) — Huellas de la Humanidad (8K)',
      narrativeText: '🎬 Intro Oficial Huellas de la Humanidad (8s — Minimalismo en Piedra y Oro)',
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
      posterUrl: outroPosterUrl,
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

    const { clip1Sec } = getStage1ClipDurations(activeDoc);
    const baseHookSec = !clip1Sec || clip1Sec <= 6 ? 8 : clip1Sec;
    const nextVoiceOffset = mode === 'INTRO_INICIO_00' ? baseHookSec + 8 : baseHookSec;

    setVoiceStartOffsetSec(nextVoiceOffset);
    if (mode === 'INTRO_INICIO_00') {
      setHookLine1StartSec(8);
      setHookLine2StartSec(10);
      setClip1OverlayEndSec(baseHookSec + 8);
      setStatusMessage(
        '✅ Intro Oficial (8s — Intro.mp4) ubicado en 00:00 - 00:08 (Opción A) y subtítulos sincronizados al 100% desde 00:16.'
      );
    } else {
      setHookLine1StartSec(0);
      setHookLine2StartSec(2);
      setClip1OverlayEndSec(baseHookSec);
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

    const FIXED_INTRO_SEC = 8;
    const FIXED_OUTRO_SEC = 8;
    const docIntroPlacement =
      activeDoc.promptConfig?.UBICACION_INTRO_MARCA === 'INTRO_POST_SLOGAN'
        ? 'INTRO_POST_SLOGAN'
        : 'INTRO_INICIO_00';
    const isIntroPlacementSwitch = lastSyncedIntroPlacementRef.current !== docIntroPlacement;
    lastSyncedIntroPlacementRef.current = docIntroPlacement;

    const { clip1Sec: c1BaseDur, standardClipSec: standardDur } = getStage1ClipDurations(activeDoc);
    const clip1HookDur = !c1BaseDur || c1BaseDur <= 6 ? 8 : c1BaseDur;
    // Opción A (default INTRO_INICIO_00): Fixed 8s Intro (00:00 - 00:08) -> Clip 1 Hook (00:08 - 00:16) -> Voiceover at 16s
    // Opción B (INTRO_POST_SLOGAN): Clip 1 Hook (00:00 - 00:08) -> Voiceover at 8s, and 8s Intro enters Post-Slogan right after "Aquí seguimos sus rastros."
    const entrySec =
      docIntroPlacement === 'INTRO_POST_SLOGAN' ? clip1HookDur : FIXED_INTRO_SEC + clip1HookDur;

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
          : entrySec;

      setHookLine1StartSec(resolvedL1Start);
      setHookLine2StartSec(resolvedL2Start);
      setClip1OverlayEndSec(resolvedOverlayEnd);
      setVoiceStartOffsetSec(entrySec);
    }

    const isLocalHost =
      typeof window !== 'undefined' &&
      (window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1');
    const serverOrigin = isLocalHost ? '' : 'http://localhost:4200';
    const introOutroBasePath =
      '/Users/raydelsantana/Library/Mobile Documents/com~apple~CloudDocs/0YouTube/Huellas de la Humanidad/Intro:Outro';
    const introVideoUrl = `${serverOrigin}/api/flow/serve-folder-file?filePath=${encodeURIComponent(
      `${introOutroBasePath}/Intro.mp4`
    )}&v=clean_native_audio_v2`;
    const introPosterUrl = `${serverOrigin}/api/flow/serve-folder-file?filePath=${encodeURIComponent(
      `${introOutroBasePath}/.Intro_Poster.jpg`
    )}&v=clean_native_audio_v2`;
    const outroVideoUrl = `${serverOrigin}/api/flow/serve-folder-file?filePath=${encodeURIComponent(
      `${introOutroBasePath}/Outro.mp4`
    )}&v=clean_native_audio_v2`;
    const outroPosterUrl = `${serverOrigin}/api/flow/serve-folder-file?filePath=${encodeURIComponent(
      `${introOutroBasePath}/.Outro_Poster.jpg`
    )}&v=clean_native_audio_v2`;

    // 1. Build Clips Track (Track 3)
    const allDocClips = activeDoc.clips || [];
    const reviewedClips = allDocClips.filter((c) => c.reviewedForEditor);
    const docClips =
      showOnlyReviewedClips && reviewedClips.length > 0 ? reviewedClips : allDocClips;

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

    const combinedClipVideosMap: Record<number, string> = {
      ...capturedClipVideosMap,
      ...localServerClipVideosMap,
    };
    for (const [kStr, capUrl] of Object.entries(capturedClipVideosMap)) {
      const kNum = Number(kStr);
      const srvUrl = localServerClipVideosMap[kNum] || '';
      if (!capUrl) continue;
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
    const combinedSunoAudioMap: Record<number, string> = {
      ...localServerSunoMap,
      ...capturedSunoAudioMap,
    };

    const bodyClips: TimelineClipItem[] = docClips.map((c, idx) => {
      const isClip1 = c.clipNumber === 1 || idx === 0;
      const srcDur =
        Number(c.durationSeconds) > 0
          ? Number(c.durationSeconds)
          : isClip1
          ? clip1HookDur
          : standardDur;
      const existingItem = timelineClips.find(
        (tc) =>
          tc.clipNumber === c.clipNumber &&
          tc.id !== 'fixed-doc-intro' &&
          tc.id !== 'fixed-doc-outro' &&
          !tc.id.endsWith('-slogan-partB')
      );
      const videoUrl =
        combinedClipVideosMap[c.clipNumber] || existingItem?.videoUrl || '';

      // Strictly use each clip's own first frame (never repeat the documentary thumbnail or shared @Reference across clips)
      const posterUrl =
        firstFrameByClip[c.clipNumber] ||
        (c.videoFrames && c.videoFrames[0]) ||
        c.imagePreviewUrl ||
        '';

      return {
        id: c.id || `tl-clip-${c.clipNumber}`,
        clipNumber: c.clipNumber,
        fileName: c.videoSavedFileName || buildClipSixWordFileName(c, activeDoc),
        narrationSegment: c.narrationSegment || '',
        imagePrompt: c.imagePrompt || '',
        videoPrompt: c.videoPrompt || '',
        duration: isClip1 ? clip1HookDur : existingItem ? existingItem.duration : srcDur,
        sourceDuration: existingItem?.sourceDuration || srcDur,
        speed: existingItem ? existingItem.speed : 1,
        trimStart: existingItem ? existingItem.trimStart : 0,
        trimEnd: existingItem?.trimEnd ?? srcDur,
        smoothSlowMo:
          existingItem?.smoothSlowMo !== undefined
            ? existingItem.smoothSlowMo
            : Boolean(existingItem && existingItem.speed < 1),
        opticalFlowUrl: existingItem?.opticalFlowUrl,
        opticalFlowBakedKey: existingItem?.opticalFlowBakedKey,
        parentGroupId: existingItem?.parentGroupId,
        originalSlotDuration: existingItem?.originalSlotDuration || (isClip1 ? clip1HookDur : srcDur),
        partLabel: existingItem?.partLabel,
        foleyVolume: existingItem ? existingItem.foleyVolume : isClip1 ? 80 : 35,
        customVolumeSet: existingItem?.customVolumeSet,
        audioMuted: existingItem?.audioMuted,
        audioFadeInSec: existingItem?.audioFadeInSec,
        audioFadeOutSec: existingItem?.audioFadeOutSec,
        transition: isClip1 ? 'fade_black' : existingItem ? existingItem.transition : defaultTransition,
        videoUrl,
        posterUrl,
        reviewedForEditor: Boolean(c.reviewedForEditor),
      };
    });

    // If activeDoc.clips is empty but combinedClipVideosMap has .MP4 files from 05_Clips_Video, build timeline clips from those .MP4 files!
    if (bodyClips.length === 0 && Object.keys(combinedClipVideosMap).length > 0) {
      const sortedNums = Object.keys(combinedClipVideosMap)
        .map((n) => parseInt(n, 10))
        .filter((n) => n > 0)
        .sort((a, b) => a - b);
      sortedNums.forEach((num, idx) => {
        const isClip1 = num === 1 || idx === 0;
        const srcDur = isClip1 ? clip1HookDur : standardDur;
        const rawVidUrl = combinedClipVideosMap[num] || '';
        let extractedFileName = `${String(num).padStart(2, '0')}_Clip_Documental.mp4`;
        try {
          const decoded = decodeURIComponent(rawVidUrl);
          const m = decoded.match(/\/([^/?#]+\.(?:mp4|webm|mov))/i);
          if (m && m[1]) extractedFileName = m[1];
        } catch {}
        bodyClips.push({
          id: `folder-clip-${num}`,
          clipNumber: num,
          fileName: extractedFileName,
          narrationSegment: '',
          duration: srcDur,
          sourceDuration: srcDur,
          speed: 1,
          trimStart: 0,
          trimEnd: srcDur,
          smoothSlowMo: false,
          originalSlotDuration: srcDur,
          foleyVolume: isClip1 ? 80 : 35,
          transition: isClip1 ? 'fade_black' : defaultTransition,
          videoUrl: rawVidUrl,
          posterUrl: firstFrameByClip[num] || '',
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
          ? '🎬 INTRO OFICIAL POST-SLOGAN (8s tras "Aquí seguimos sus rastros." • Audio Fade In 1.5s + Fade Out 2.5s) — Huellas de la Humanidad (8K)'
          : '🎬 INTRO OFICIAL (00:00 - 00:08 • Audio Fade In 1.5s + Fade Out 2.5s) — Huellas de la Humanidad (8K)',
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
          : 2.5,
      transition: 'crossfade',
      videoUrl: introVideoUrl,
      posterUrl: introPosterUrl,
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
      posterUrl: outroPosterUrl,
      reviewedForEditor: true,
    };

    let sourceClipsForBuild: TimelineClipItem[] = bodyClips;
    if (
      savedDocOverlays?.userEditedClips &&
      Array.isArray(savedDocOverlays.customTimelineClips) &&
      savedDocOverlays.customTimelineClips.length > 0
    ) {
      let anyRegeneratedOrUpdated = false;
      sourceClipsForBuild = (savedDocOverlays.customTimelineClips as TimelineClipItem[]).map(
        (tc) => {
          const freshVideoUrl = combinedClipVideosMap[tc.clipNumber] || tc.videoUrl || '';
          const freshPosterUrl = firstFrameByClip[tc.clipNumber] || tc.posterUrl || '';
          const prevBaseVideoUrl = tc.originalVideoUrlBeforeSeparation || tc.videoUrl || '';
          const freshTs = getUrlTimestampMs(freshVideoUrl);
          const prevBaseTs = getUrlTimestampMs(prevBaseVideoUrl);
          const isNewerDiskVideo =
            freshTs > 0 &&
            prevBaseTs > 0 &&
            freshTs > prevBaseTs + 1000 &&
            !freshVideoUrl.includes('.foley_only_cache') &&
            !freshVideoUrl.includes('.optical_flow_cache');

          const foleyCacheTs = getUrlTimestampMs(tc.cleanFoleyOnlyVideoUrl);
          const vocalsCacheTs = getUrlTimestampMs(tc.cleanNoVocalsVideoUrl);
          const musicCacheTs = getUrlTimestampMs(tc.cleanNoMusicVideoUrl);
          const opticalFlowTs = getUrlTimestampMs(tc.opticalFlowUrl);

          const foleyStillValid =
            Boolean(tc.foleyOnlyIsolated && tc.cleanFoleyOnlyVideoUrl) &&
            !isNewerDiskVideo &&
            (freshTs === 0 || foleyCacheTs === 0 || foleyCacheTs >= freshTs - 1000);
          const vocalsStillValid =
            Boolean(tc.vocalsSeparated && tc.cleanNoVocalsVideoUrl) &&
            !isNewerDiskVideo &&
            (freshTs === 0 || vocalsCacheTs === 0 || vocalsCacheTs >= freshTs - 1000);
          const musicStillValid =
            Boolean(tc.musicSeparated && tc.cleanNoMusicVideoUrl) &&
            !isNewerDiskVideo &&
            (freshTs === 0 || musicCacheTs === 0 || musicCacheTs >= freshTs - 1000);
          const opticalFlowStillValid =
            Boolean(tc.opticalFlowUrl) &&
            !isNewerDiskVideo &&
            (freshTs === 0 || opticalFlowTs === 0 || opticalFlowTs >= freshTs - 1000);

          const effectiveVideoUrl = foleyStillValid
            ? tc.cleanFoleyOnlyVideoUrl!
            : vocalsStillValid
              ? tc.cleanNoVocalsVideoUrl!
              : musicStillValid
                ? tc.cleanNoMusicVideoUrl!
                : freshVideoUrl;

          const effectiveOpticalFlowUrl = opticalFlowStillValid
            ? foleyStillValid && tc.cleanOpticalFlowOnlyUrl
              ? tc.cleanOpticalFlowOnlyUrl
              : tc.opticalFlowUrl
            : undefined;

          if (
            isNewerDiskVideo ||
            effectiveVideoUrl !== tc.videoUrl ||
            freshPosterUrl !== tc.posterUrl ||
            effectiveOpticalFlowUrl !== tc.opticalFlowUrl
          ) {
            anyRegeneratedOrUpdated = true;
            if (isNewerDiskVideo) {
              delete extractedVideoUrlByClipRef.current[tc.clipNumber];
            }
          }

          const srcDur = tc.sourceDuration || standardDur;
          return {
            ...tc,
            videoUrl: effectiveVideoUrl,
            opticalFlowUrl: effectiveOpticalFlowUrl,
            opticalFlowBakedKey: opticalFlowStillValid ? tc.opticalFlowBakedKey : undefined,
            foleyOnlyIsolated: foleyStillValid ? tc.foleyOnlyIsolated : false,
            cleanFoleyOnlyVideoUrl: foleyStillValid ? tc.cleanFoleyOnlyVideoUrl : undefined,
            cleanOpticalFlowOnlyUrl:
              foleyStillValid && opticalFlowStillValid ? tc.cleanOpticalFlowOnlyUrl : undefined,
            vocalsSeparated: vocalsStillValid ? tc.vocalsSeparated : false,
            cleanNoVocalsVideoUrl: vocalsStillValid ? tc.cleanNoVocalsVideoUrl : undefined,
            musicSeparated: musicStillValid ? tc.musicSeparated : false,
            cleanNoMusicVideoUrl: musicStillValid ? tc.cleanNoMusicVideoUrl : undefined,
            originalVideoUrlBeforeSeparation: isNewerDiskVideo
              ? freshVideoUrl
              : tc.originalVideoUrlBeforeSeparation || freshVideoUrl,
            originalOpticalFlowUrlBeforeSeparation: opticalFlowStillValid
              ? tc.originalOpticalFlowUrlBeforeSeparation || tc.opticalFlowUrl
              : undefined,
            trimStart: isNewerDiskVideo ? 0 : tc.trimStart,
            trimEnd: isNewerDiskVideo ? srcDur : tc.trimEnd,
            posterUrl: freshPosterUrl,
            smoothSlowMo:
              tc.smoothSlowMo !== undefined ? tc.smoothSlowMo : Boolean(tc.speed && tc.speed < 1),
          };
        }
      );
      if (anyRegeneratedOrUpdated && activeDoc?.id) {
        persistDocOverlaysPatch(
          { customTimelineClips: sourceClipsForBuild },
          activeDoc.id
        );
      }
    }

    const builtClips = buildAlignedTimelineClipsForIntroMode(
      sourceClipsForBuild,
      docIntroPlacement,
      fixedIntroClip,
      fixedOutroClip
    );

    setTimelineClips(builtClips);
    if (builtClips.length > 0 && !selectedClipId) {
      setSelectedClipId(builtClips[0].id);
      setSelectedClipIds([builtClips[0].id]);
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
    if (
      savedDocOverlays?.userEditedCaptions &&
      Array.isArray(savedDocOverlays.captions) &&
      savedDocOverlays.captions.length > 0
    ) {
      userEditedCaptionsDocIdRef.current = docId;
      if (isDocSwitch || isIntroPlacementSwitch || captions.length === 0) {
        const alignedSaved = alignCaptionsToIntroPlacement(
          savedDocOverlays.captions,
          docIntroPlacement,
          clip1HookDur,
          FIXED_INTRO_SEC,
          sloganSplitAudioSec
        );
        setCaptions(alignedSaved);
        persistDocOverlaysPatch(
          { captions: alignedSaved, voiceStartOffsetSec: entrySec },
          docId
        );
      }
    } else if (userEditedCaptionsDocIdRef.current !== docId || isIntroPlacementSwitch) {
      if (isVideo76Doc && prealignedVideo76SrtRef.current) {
        const parsed76 = alignCaptionsToIntroPlacement(
          parseSrtToCaptionItems(prealignedVideo76SrtRef.current, entrySec),
          docIntroPlacement,
          clip1HookDur,
          FIXED_INTRO_SEC,
          sloganSplitAudioSec
        );
        setCaptions(parsed76);
        persistDocOverlaysPatch({ captions: parsed76, voiceStartOffsetSec: entrySec }, docId);
      } else if (
        activeDoc.voiceoverScript &&
        activeDoc.voiceoverScript.trim() &&
        effectiveVoiceDurationSec > 1
      ) {
        handleGenerateAutoCaptionsFromVoice(entrySec, effectiveVoiceDurationSec);
      } else if (activeDoc.correctedSrt && activeDoc.correctedSrt.trim()) {
        const alignedSrt = alignCaptionsToIntroPlacement(
          parseSrtToCaptionItems(activeDoc.correctedSrt, entrySec),
          docIntroPlacement,
          clip1HookDur,
          FIXED_INTRO_SEC,
          sloganSplitAudioSec
        );
        setCaptions(alignedSrt);
        persistDocOverlaysPatch({ captions: alignedSrt, voiceStartOffsetSec: entrySec }, docId);
      } else {
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
    const bodySpanEndSec =
      clip82EndBeforeOutroSec > FIXED_INTRO_SEC + 30
        ? clip82EndBeforeOutroSec
        : Math.max(
            FIXED_INTRO_SEC + bodyClips.reduce((acc, item) => acc + item.duration, 0),
            fullVoiceSpanSec,
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
      const silenceGapSec = 15; // Mandatory 10-20s silence between songs
      const lastSongDurSec = 90; // Mandatory 1:30 for the closing song reaching the end of Clip 82 before Outro
      const lastSongTargetStartSec = Math.max(
        FIXED_INTRO_SEC + 30,
        Number((bodySpanEndSec - lastSongDurSec).toFixed(2))
      );
      const nonLastCount = Math.max(1, sunoList.length - 1);
      const availablePreLastSpanSec = Math.max(
        nonLastCount * 60,
        lastSongTargetStartSec - FIXED_INTRO_SEC - nonLastCount * silenceGapSec
      );
      const evenPreLastDurSec = Math.min(
        156,
        Math.max(60, Math.round(availablePreLastSpanSec / nonLastCount))
      );

      const builtMusic: TimelineMusicItem[] = sunoList.map((st, idx) => {
        const trackNum = idx + 1;
        const trackId = st.id || `music-${trackNum}`;
        const savedEdit = savedMusicEdits[String(trackNum)] || savedMusicEdits[trackId] || {};
        const isLast = idx === sunoList.length - 1;

        let startSec = cursorSec;
        let durSec = isLast ? lastSongDurSec : evenPreLastDurSec;

        if (isLast) {
          // Always anchor the last song so it reaches 100% to the end of Clip 82 right before the Outro
          startSec = Math.max(cursorSec, lastSongTargetStartSec);
          durSec = Math.max(10, Number((bodySpanEndSec - startSec).toFixed(2)));
        } else {
          // Ensure earlier songs leave room for the 15s silence gap before the last song
          const maxAllowedEnd = lastSongTargetStartSec - (nonLastCount - idx) * silenceGapSec;
          if (startSec + durSec > maxAllowedEnd) {
            durSec = Math.max(30, Number((maxAllowedEnd - startSec).toFixed(2)));
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
              : 10,
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
                : prevMatch && typeof prevMatch.volume === 'number' && prevMatch.volume !== 24
                ? prevMatch.volume
                : 10,
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
    .map((c) => `${c.clipNumber}:${c.reviewedForEditor ? 1 : 0}:${c.videoReady ? 1 : 0}`)
    .join('|');

  const allKnownClipNums = Array.from(
    new Set([
      ...Object.keys(localServerClipVideosMap).map(Number),
      ...Object.keys(capturedClipVideosMap).map(Number),
      ...Object.keys(firstFrameByClip).map(Number),
    ])
  )
    .filter((n) => n > 0)
    .sort((a, b) => a - b);

  const capturedClipVideosSignature = allKnownClipNums
    .map(
      (k) =>
        `${k}:${(localServerClipVideosMap[k] || '').slice(-28)}:${(
          capturedClipVideosMap[k] || ''
        ).slice(-28)}:${(firstFrameByClip[k] || '').slice(-20)}`
    )
    .join('|');

  const sunoTracksSignature = (activeDoc?.sunoTracks || [])
    .map((t, i) => `${i + 1}:${t.title || ''}:${t.videoTimeRange || ''}:${t.duration || ''}:${(t.audioUrl || '').slice(-24)}`)
    .join('|');

  const capturedSunoSignature = Object.entries({
    ...localServerSunoMap,
    ...capturedSunoAudioMap,
  })
    .sort((a, b) => Number(a[0]) - Number(b[0]))
    .map(([k, v]) => `${k}:${v ? v.slice(-24) : ''}`)
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
  ]);

  const prealignedVideo76SrtRef = useRef<string>('');

  // Auto-Generate Captions directly from Voiceover starting at voiceStartOffsetSec (8s) using 3-Level Hierarchical Acoustic Alignment (Paragraphs -> Sentences -> Clauses & Breath Islands)
  const handleGenerateAutoCaptionsFromVoice = (
    customEntryOffset?: number,
    customVoiceDurSec?: number,
    customSilences?: Array<{ start: number; end: number; dur: number }>,
    forceOverwrite = false
  ) => {
    if (!activeDoc) return;
    const docId = activeDoc.id || 'default';
    if (!forceOverwrite) {
      const savedDocOverlays = readSavedDocOverlays(docId);
      if (
        userEditedCaptionsDocIdRef.current === docId ||
        (savedDocOverlays?.userEditedCaptions &&
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
    const maxCharsPerCaption = 34;

    const isVideo76 = isVideo76Doc;
    const effectiveMode =
      activeDoc.promptConfig?.UBICACION_INTRO_MARCA === 'INTRO_POST_SLOGAN' ||
      introPlacementMode === 'INTRO_POST_SLOGAN'
        ? 'INTRO_POST_SLOGAN'
        : 'INTRO_INICIO_00';
    const { clip1Sec: c1DurForCap } = getStage1ClipDurations(activeDoc);
    const baseHookForCap = !c1DurForCap || c1DurForCap <= 6 ? 8 : c1DurForCap;

    if (isVideo76 && prealignedVideo76SrtRef.current) {
      const parsed76 = alignCaptionsToIntroPlacement(
        parseSrtToCaptionItems(prealignedVideo76SrtRef.current, offset),
        effectiveMode,
        baseHookForCap,
        8,
        sloganSplitAudioSec
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

    // Expand numbers, years, percentages & Roman numerals to their spoken Spanish syllable length
    const spokenSpanishWeight = (str: string): number => {
      const expanded = str
        .replace(/\b1880\b/g, 'mil ochocientos ochenta')
        .replace(/\b1930\b/g, 'mil novecientos treinta')
        .replace(/\b1940\b/g, 'mil novecientos cuarenta')
        .replace(/\b18(\d\d)\b/g, 'mil ochocientos cincuenta y cinco')
        .replace(/\b19(\d\d)\b/g, 'mil novecientos cincuenta y cinco')
        .replace(/\b1\.\d{3}\b/g, 'mil trescientos treinta')
        .replace(/\b\d{4}\b/g, 'mil ochocientos')
        .replace(/\b\d{3}\b/g, 'quinientos cincuenta')
        .replace(/\b\d{2}%\b/g, 'ochenta y tres por ciento')
        .replace(/\b\d+%\b/g, 'diez por ciento')
        .replace(/\b\d{2}\b/g, 'cuarenta y cinco')
        .replace(/\b\d\b/g, 'cinco')
        .replace(/\bXIX\b/g, 'diecinueve')
        .replace(/\bXX\b/g, 'veinte')
        .replace(/\bXIII\b/g, 'trece')
        .replace(/\bIII\b/g, 'tercero')
        .replace(/\bII\b/g, 'segundo');
      const letters = expanded.replace(/[^a-zA-ZáéíóúÁÉÍÓÚñÑüÜ]/g, '').length;
      const commas = (str.match(/[,;:]/g) || []).length;
      return Math.max(2, letters + commas * 3);
    };

    const splitIntoShortChunks = (text: string): string[] => {
      const clean = normalizeQuantitiesToMil(stripPauseTags(text))
        .replace(/\[pausa[^\]]*\]?/gi, '')
        .replace(/\s{2,}/g, ' ')
        .trim();
      if (!clean) return [];
      const words = clean.split(/\s+/).filter(Boolean);
      return splitWordsIntoShortLines(words, maxCharsPerCaption)
        .map((lineWords) => (Array.isArray(lineWords) ? lineWords.join(' ') : String(lineWords)))
        .filter(Boolean);
    };

    // Align N text units (sentences or clauses) to candidate silences inside [tStart, tEnd] via Dynamic Programming
    const alignUnitsToSilences = (
      units: string[],
      tStart: number,
      tEnd: number,
      candSilences: Array<{ start: number; end: number; dur: number }>,
      minSilenceDur: number
    ): Array<{ text: string; start: number; end: number }> => {
      const N = units.length;
      if (N === 0) return [];
      if (N === 1) return [{ text: units[0], start: tStart, end: tEnd }];

      const weights = units.map((u) => spokenSpanishWeight(u));
      const totalW = Math.max(1, weights.reduce((a, b) => a + b, 0));
      const cands = candSilences.filter(
        (s) => s.start > tStart + 0.35 && s.end < tEnd - 0.35 && s.dur >= minSilenceDur
      );

      let cum = 0;
      const expectedFracs: number[] = [];
      for (let i = 0; i < N - 1; i++) {
        cum += weights[i];
        expectedFracs.push(cum / totalW);
      }

      if (cands.length >= N - 1) {
        const M = cands.length;
        const B = N - 1;
        const INF = 1e9;
        const dp: number[][] = Array.from({ length: B }, () => Array(M).fill(INF));
        const parent: number[][] = Array.from({ length: B }, () => Array(M).fill(-1));

        for (let m = 0; m < M; m++) {
          const mid = 0.5 * (cands[m].start + cands[m].end);
          const actualFrac = (mid - tStart) / Math.max(0.1, tEnd - tStart);
          const diff = Math.abs(actualFrac - expectedFracs[0]);
          if (diff < 0.28) {
            dp[0][m] = diff * 12 - Math.min(0.8, cands[m].dur) * 0.9;
          }
        }

        for (let b = 1; b < B; b++) {
          const expSpanFrac = expectedFracs[b] - expectedFracs[b - 1];
          for (let m = b; m < M; m++) {
            const midM = 0.5 * (cands[m].start + cands[m].end);
            const actualFrac = (midM - tStart) / Math.max(0.1, tEnd - tStart);
            if (Math.abs(actualFrac - expectedFracs[b]) > 0.3) continue;
            const silBonus = Math.min(0.8, cands[m].dur) * 0.9;
            for (let p = b - 1; p < m; p++) {
              if (dp[b - 1][p] >= INF / 2) continue;
              const midP = 0.5 * (cands[p].start + cands[p].end);
              const actSpanFrac = (midM - midP) / Math.max(0.1, tEnd - tStart);
              if (actSpanFrac < expSpanFrac * 0.32 || actSpanFrac > expSpanFrac * 2.4) continue;
              const cost =
                dp[b - 1][p] +
                Math.abs(actSpanFrac - expSpanFrac) * 14 +
                Math.abs(actualFrac - expectedFracs[b]) * 6 -
                silBonus;
              if (cost < dp[b][m]) {
                dp[b][m] = cost;
                parent[b][m] = p;
              }
            }
          }
        }

        let bestLast = -1;
        let bestScore = INF / 2;
        for (let m = B - 1; m < M; m++) {
          if (dp[B - 1][m] < bestScore) {
            bestScore = dp[B - 1][m];
            bestLast = m;
          }
        }

        if (bestLast !== -1) {
          const chosen: number[] = Array(B).fill(0);
          let cur = bestLast;
          for (let b = B - 1; b >= 0; b--) {
            chosen[b] = cur;
            cur = parent[b][cur];
          }
          const res: Array<{ text: string; start: number; end: number }> = [];
          let curStart = tStart;
          for (let b = 0; b < B; b++) {
            const sil = cands[chosen[b]];
            res.push({ text: units[b], start: curStart, end: sil.start });
            curStart = sil.end;
          }
          res.push({ text: units[N - 1], start: curStart, end: tEnd });
          return res;
        }
      }

      // Greedy fallback snapping each boundary to the best available silence
      const used = new Set<number>();
      const res: Array<{ text: string; start: number; end: number }> = [];
      let curStart = tStart;
      let remW = totalW;
      for (let i = 0; i < N - 1; i++) {
        const w = weights[i];
        const remTime = Math.max(0.4, tEnd - curStart);
        const idealEnd = curStart + (w / Math.max(1, remW)) * remTime;
        let bestIdx = -1;
        let bestScore = 1e9;
        for (let idx = 0; idx < cands.length; idx++) {
          if (used.has(idx)) continue;
          const s = cands[idx];
          if (s.start <= curStart + 0.35 || s.end >= tEnd - 0.35) continue;
          const diff = Math.abs(s.start - idealEnd);
          const maxWin = Math.max(1.8, (w / Math.max(1, remW)) * remTime * 0.55);
          if (diff <= maxWin) {
            const score = diff - Math.min(0.7, s.dur) * 0.8;
            if (score < bestScore) {
              bestScore = score;
              bestIdx = idx;
            }
          }
        }
        if (bestIdx !== -1) {
          used.add(bestIdx);
          const sil = cands[bestIdx];
          res.push({ text: units[i], start: curStart, end: sil.start });
          curStart = sil.end;
        } else {
          res.push({ text: units[i], start: curStart, end: idealEnd });
          curStart = idealEnd + 0.04;
        }
        remW -= w;
      }
      res.push({ text: units[N - 1], start: curStart, end: tEnd });
      return res;
    };

    // Build source script preserving explicit [pausa Xs] / [Xs] tags
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
            .join(' ');

    if (!rawVoiceScript) {
      setCaptions([]);
      return;
    }

    // Parse script into text segments and explicit pause segments
    const pauseRegex =
      /[\[{]\s*(?:(?:pausa|pause|silencio)\s*:?\s*)?([0-9]{1,2}(?:[.,][0-9]+)?)\s*(s|seg|segundos|ms|milisegundos)?\s*[\]}]|[\[{]\s*(?:pausa|pause|silencio)\s*:?\s*[\]}]/gi;
    const segments: Array<{ type: 'text'; text: string } | { type: 'pause'; duration: number }> = [];
    let lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = pauseRegex.exec(rawVoiceScript)) !== null) {
      const before = rawVoiceScript.slice(lastIndex, m.index).trim();
      if (before) segments.push({ type: 'text', text: before });
      const dur = m[1] ? parseFloat(m[1].replace(',', '.')) : 1.5;
      segments.push({ type: 'pause', duration: Math.max(0.2, Math.min(10, dur)) });
      lastIndex = m.index + m[0].length;
    }
    const remText = rawVoiceScript.slice(lastIndex).trim();
    if (remText) segments.push({ type: 'text', text: remText });

    const silences = customSilences || detectedAudioSilencesRef.current || [];

    // Exact acoustically measured segment bounds (start, end) in tts-video-76-exodo-espanol.mp3
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

    const totalPauseSec = segments.reduce(
      (acc, s) => acc + (s.type === 'pause' ? s.duration : 0),
      0
    );
    const totalSpokenWeightAll = segments.reduce(
      (acc, s) => acc + (s.type === 'text' ? spokenSpanishWeight(s.text) : 0),
      0
    );
    const netTargetSpeechDur = Math.max(
      10,
      (targetVoiceDur > 5 ? targetVoiceDur : totalSpokenWeightAll / 14.2 + totalPauseSec) -
        totalPauseSec
    );

    const segBounds: Array<{ type: 'text' | 'pause'; text?: string; start: number; end: number }> = [];
    let audioCursor = 0;
    segments.forEach((seg, idx) => {
      if (isVideo76 && seg.type === 'text' && video76ExactSegBounds[idx]) {
        const [exactS, exactE] = video76ExactSegBounds[idx];
        audioCursor = exactE;
        segBounds.push({
          type: 'text',
          text: seg.text,
          start: exactS,
          end: exactE,
        });
        return;
      }
      let dur = 1.5;
      if (seg.type === 'pause') {
        dur = seg.duration;
      } else {
        const w = spokenSpanishWeight(seg.text);
        dur = (w / Math.max(1, totalSpokenWeightAll)) * netTargetSpeechDur;
      }
      const sStart = audioCursor;
      const sEnd = audioCursor + dur;
      audioCursor = sEnd;
      segBounds.push({
        type: seg.type,
        text: seg.type === 'text' ? seg.text : undefined,
        start: sStart,
        end: sEnd,
      });
    });

    // Level 1: Align text paragraphs to explicit [pausa] silences (>= 1.45s) via DP so sentence pauses (< 1.45s) never shift paragraph bounds
    if (!isVideo76 && silences.length > 0) {
      const textSegIndices: number[] = [];
      const textSegStrings: string[] = [];
      segBounds.forEach((sb, idx) => {
        if (sb.type === 'text' && sb.text) {
          textSegIndices.push(idx);
          textSegStrings.push(sb.text);
        }
      });
      if (textSegStrings.length > 1) {
        const firstSpeechStart =
          silences[0] && silences[0].start < 0.05 ? silences[0].end : 0;
        const lastSpeechEnd =
          targetVoiceDur > 5 ? targetVoiceDur : segBounds[segBounds.length - 1].end;
        const alignedParas = alignUnitsToSilences(
          textSegStrings,
          firstSpeechStart,
          lastSpeechEnd,
          silences,
          1.45
        );
        if (alignedParas.length === textSegIndices.length) {
          alignedParas.forEach((ap, pIdx) => {
            const sbIdx = textSegIndices[pIdx];
            segBounds[sbIdx].start = ap.start;
            segBounds[sbIdx].end = ap.end;
            if (pIdx > 0) {
              const prevSbIdx = textSegIndices[pIdx - 1];
              for (let k = prevSbIdx + 1; k < sbIdx; k++) {
                segBounds[k].start = alignedParas[pIdx - 1].end;
                segBounds[k].end = ap.start;
              }
            }
          });
        }
      }
    }

    const generated: TimelineCaptionItem[] = [];

    segBounds.forEach((sb) => {
      if (sb.type !== 'text' || !sb.text) return;
      const segStart = sb.start;
      const segEnd = sb.end;

      const segSilences = silences
        .filter((s) => s.end > segStart + 0.02 && s.start < segEnd - 0.02)
        .map((s) => ({
          start: Math.max(segStart, s.start),
          end: Math.min(segEnd, s.end),
          dur: Math.min(segEnd, s.end) - Math.max(segStart, s.start),
        }))
        .filter((s) => s.dur >= 0.14);

      // Level 2: Split paragraph into sentences (. ? ! ; :) and align to sentence silences (>= 0.35s)
      const sentences = sb.text
        .split(/(?<=[.!?;:])\s+/)
        .map((s) => s.trim())
        .filter(Boolean);

      if (segSilences.length > 0) {
        const alignedSentences = alignUnitsToSilences(
          sentences,
          segStart,
          segEnd,
          segSilences,
          0.35
        );

        alignedSentences.forEach((sentItem) => {
          const sentSilences = segSilences.filter(
            (s) => s.start > sentItem.start + 0.12 && s.end < sentItem.end - 0.12
          );
          // Level 3: Split sentence into comma clauses and align to intra-sentence silences (>= 0.22s)
          const clauses = sentItem.text
            .split(/(?<=[,])\s+/)
            .map((c) => c.trim())
            .filter(Boolean);
          const alignedClauses = alignUnitsToSilences(
            clauses,
            sentItem.start,
            sentItem.end,
            sentSilences,
            0.22
          );

          alignedClauses.forEach((clItem) => {
            const chunks = splitIntoShortChunks(clItem.text);
            if (chunks.length === 0) return;

            // Respect any remaining breath silences (>= 0.16s) inside the clause
            const subSilences = sentSilences.filter(
              (s) =>
                s.start > clItem.start + 0.15 &&
                s.end < clItem.end - 0.15 &&
                s.dur >= 0.16
            );
            const islands: Array<{ start: number; end: number }> = [];
            let cur = clItem.start;
            for (const ss of subSilences) {
              if (ss.start - cur >= 0.18) {
                islands.push({ start: cur, end: ss.start });
              }
              cur = Math.max(cur, ss.end);
            }
            if (clItem.end - cur >= 0.18 || islands.length === 0) {
              islands.push({ start: cur, end: clItem.end });
            }

            const totalIslDur = Math.max(
              0.2,
              islands.reduce((acc, isl) => acc + (isl.end - isl.start), 0)
            );
            const chunkWeights = chunks.map((ch) => spokenSpanishWeight(ch));
            const chunkTotalW = Math.max(1, chunkWeights.reduce((a, b) => a + b, 0));

            const spokenTimeToAudioTime = (spokenSec: number, isStart: boolean): number => {
              let rem = Math.max(0, Math.min(totalIslDur, spokenSec));
              for (let k = 0; k < islands.length; k++) {
                const isl = islands[k];
                const d = isl.end - isl.start;
                if (isStart && Math.abs(rem - d) < 0.04 && k + 1 < islands.length) {
                  return islands[k + 1].start;
                }
                if (rem <= d + 1e-5 || k === islands.length - 1) {
                  return isl.start + Math.min(d, rem);
                }
                rem -= d;
              }
              return islands[islands.length - 1].end;
            };

            let subCursor = 0;
            chunks.forEach((ch, chIdx) => {
              const chDur = (chunkWeights[chIdx] / chunkTotalW) * totalIslDur;
              const sAudio = spokenTimeToAudioTime(subCursor, true);
              const eAudio = spokenTimeToAudioTime(subCursor + chDur, false);
              subCursor += chDur;
              generated.push({
                id: `autocap-vo-${generated.length + 1}`,
                index: generated.length + 1,
                start: Number((offset + sAudio).toFixed(2)),
                end: Number(Math.max(offset + sAudio + 0.35, offset + eAudio).toFixed(2)),
                text: ch,
              });
            });
          });
        });
      } else {
        // Phonetic Spanish weighted fallback within [segStart, segEnd] (before Web Audio finishes decoding)
        const leadIn = isVideo76 ? 0.0 : 0.42;
        const leadOut = isVideo76 ? 0.0 : 0.28;
        const effStart = segStart + leadIn;
        const effSpan = Math.max(1, segEnd - segStart - leadIn - leadOut);

        const rawClauses = sb.text
          .split(/(?<=[.!?;:,])\s+/)
          .map((c) => c.trim())
          .filter(Boolean);

        const segItems: Array<{ text: string; weight: number; gapAfter: number }> = [];
        rawClauses.forEach((clause) => {
          const endsSentence = /[.!?;:]$/.test(clause);
          const endsComma = /[,]$/.test(clause);
          const chunks = splitIntoShortChunks(clause);
          chunks.forEach((ch, idx) => {
            const isLast = idx === chunks.length - 1;
            segItems.push({
              text: ch,
              weight: spokenSpanishWeight(ch),
              gapAfter: isLast ? (endsSentence ? 0.65 : endsComma ? 0.35 : 0.08) : 0.03,
            });
          });
        });

        const rawSpeechSec = segItems.reduce((acc, it) => acc + it.weight / 13.8, 0);
        const rawGapSec = segItems.reduce((acc, it) => acc + it.gapAfter, 0);
        const scale = effSpan / Math.max(0.5, rawSpeechSec + rawGapSec);

        let cur = effStart;
        segItems.forEach((it) => {
          const d = Math.max(0.45, (it.weight / 13.8) * scale);
          const g = it.gapAfter * scale;
          generated.push({
            id: `autocap-vo-${generated.length + 1}`,
            index: generated.length + 1,
            start: Number((offset + cur).toFixed(2)),
            end: Number((offset + cur + d).toFixed(2)),
            text: it.text,
          });
          cur += d + g;
        });
      }
    });

    // Prevent any caption overlap
    for (let i = 0; i < generated.length - 1; i++) {
      if (generated[i].end > generated[i + 1].start) {
        generated[i].end = Number(
          Math.max(generated[i].start + 0.2, generated[i + 1].start - 0.01).toFixed(2)
        );
      }
    }

    const finalGenerated = alignCaptionsToIntroPlacement(
      generated,
      effectiveMode,
      baseHookForCap,
      8,
      sloganSplitAudioSec
    );
    setCaptions(finalGenerated);
    persistDocOverlaysPatch(
      { captions: finalGenerated, ...(forceOverwrite ? { userEditedCaptions: false } : {}) },
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
    const { clip1Sec: c1Dur76 } = getStage1ClipDurations(activeDoc);
    const baseHook76 = !c1Dur76 || c1Dur76 <= 6 ? 8 : c1Dur76;

    const savedDocOverlays = readSavedDocOverlays(docId);
    if (
      userEditedCaptionsDocIdRef.current === docId ||
      (savedDocOverlays?.userEditedCaptions &&
        Array.isArray(savedDocOverlays.captions) &&
        savedDocOverlays.captions.length > 0)
    ) {
      userEditedCaptionsDocIdRef.current = docId;
      setCaptions((prevCaps) => {
        const src = prevCaps.length > 0 ? prevCaps : savedDocOverlays?.captions || [];
        if (src.length === 0) return prevCaps;
        const aligned = alignCaptionsToIntroPlacement(
          src,
          effectiveMode,
          baseHook76,
          8,
          sloganSplitAudioSec
        );
        persistDocOverlaysPatch({ captions: aligned }, docId);
        return aligned;
      });
      return;
    }
    if (prealignedVideo76SrtRef.current) {
      const parsed = alignCaptionsToIntroPlacement(
        parseSrtToCaptionItems(prealignedVideo76SrtRef.current, voiceStartOffsetSec),
        effectiveMode,
        baseHook76,
        8,
        sloganSplitAudioSec
      );
      setCaptions(parsed);
      persistDocOverlaysPatch({ captions: parsed }, docId);
      return;
    }
    let cancelled = false;
    fetch('tts-files/subtitulos-video-76-exodo-espanol.srt')
      .then((r) => (r.ok ? r.text() : ''))
      .then((txt) => {
        if (cancelled || !txt || !txt.includes('-->')) return;
        prealignedVideo76SrtRef.current = txt;
        if (userEditedCaptionsDocIdRef.current === docId) return;
        const parsed = alignCaptionsToIntroPlacement(
          parseSrtToCaptionItems(txt, voiceStartOffsetSec),
          effectiveMode,
          baseHook76,
          8,
          sloganSplitAudioSec
        );
        setCaptions(parsed);
        persistDocOverlaysPatch({ captions: parsed }, docId);
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

  // Decode actual Voiceover MP3/WAV waveform via Web Audio API to extract exact acoustic silences & speech islands
  useEffect(() => {
    if (!effectiveVoiceoverUrl) return;
    if (decodedSilenceUrlRef.current === effectiveVoiceoverUrl && detectedAudioSilencesRef.current.length > 0) {
      handleGenerateAutoCaptionsFromVoice(
        voiceStartOffsetSec,
        effectiveVoiceDurationSec,
        detectedAudioSilencesRef.current
      );
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
        const threshRms = 0.0115; // approx -38.8 dB
        const rawSilences: Array<{ start: number; end: number; dur: number }> = [];
        let silStart: number | null = null;

        for (let i = 0; i < chData.length; i += winSamples) {
          const endIdx = Math.min(chData.length, i + winSamples);
          let sumSq = 0;
          for (let j = i; j < endIdx; j++) {
            const v = chData[j];
            sumSq += v * v;
          }
          const rms = Math.sqrt(sumSq / (endIdx - i));
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
        handleGenerateAutoCaptionsFromVoice(
          voiceStartOffsetSec,
          audioBuf.duration > 1 ? audioBuf.duration : effectiveVoiceDurationSec,
          silences
        );
      } catch {}
    })();

    return () => {
      cancelled = true;
    };
  }, [effectiveVoiceoverUrl, activeDoc?.id]);

  // Re-align captions automatically whenever voiceStartOffsetSec or introPlacementMode updates
  useEffect(() => {
    if (!activeDoc) return;
    const docId = activeDoc.id || 'default';
    const effectiveMode =
      activeDoc.promptConfig?.UBICACION_INTRO_MARCA === 'INTRO_POST_SLOGAN' ||
      introPlacementMode === 'INTRO_POST_SLOGAN'
        ? 'INTRO_POST_SLOGAN'
        : 'INTRO_INICIO_00';
    const { clip1Sec: c1Dur } = getStage1ClipDurations(activeDoc);
    const baseHookSec = !c1Dur || c1Dur <= 6 ? 8 : c1Dur;

    const savedDocOverlays = readSavedDocOverlays(docId);
    if (
      userEditedCaptionsDocIdRef.current === docId ||
      (savedDocOverlays?.userEditedCaptions &&
        Array.isArray(savedDocOverlays.captions) &&
        savedDocOverlays.captions.length > 0)
    ) {
      userEditedCaptionsDocIdRef.current = docId;
      setCaptions((prevCaps) => {
        const src = prevCaps.length > 0 ? prevCaps : savedDocOverlays?.captions || [];
        if (src.length === 0) return prevCaps;
        const aligned = alignCaptionsToIntroPlacement(
          src,
          effectiveMode,
          baseHookSec,
          8,
          sloganSplitAudioSec
        );
        persistDocOverlaysPatch({ captions: aligned }, docId);
        return aligned;
      });
      return;
    }
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
    } else if (activeDoc.correctedSrt && activeDoc.correctedSrt.trim()) {
      const aligned = alignCaptionsToIntroPlacement(
        parseSrtToCaptionItems(activeDoc.correctedSrt, voiceStartOffsetSec),
        effectiveMode,
        baseHookSec,
        8,
        sloganSplitAudioSec
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
    sloganSplitAudioSec,
    activeDoc?.id,
  ]);

  // Compute each clip's start & end time on the master timeline (with default audio fade-in / fade-out on Intro & Outro)
  const clipsWithTimelineBounds = useMemo(() => {
    let cursor = 0;
    return timelineClips.map((clip, index) => {
      const start = cursor;
      const end = cursor + clip.duration;
      cursor = end;
      const isIntroClip = clip.id === 'fixed-doc-intro' || clip.clipNumber === 0;
      const isOutroClip = clip.id === 'fixed-doc-outro' || clip.clipNumber === 999;
      return {
        ...clip,
        audioFadeInSec:
          typeof clip.audioFadeInSec === 'number'
            ? clip.audioFadeInSec
            : isIntroClip || isOutroClip
            ? 1.5
            : clip.clipNumber === 1
            ? 1.2
            : undefined,
        audioFadeOutSec:
          typeof clip.audioFadeOutSec === 'number'
            ? clip.audioFadeOutSec
            : isIntroClip || isOutroClip
            ? 2.5
            : undefined,
        index,
        start,
        end,
      };
    });
  }, [timelineClips]);

  const selectedClip = useMemo(
    () =>
      clipsWithTimelineBounds.find((c) => c.id === selectedClipId) ||
      clipsWithTimelineBounds[0] ||
      null,
    [clipsWithTimelineBounds, selectedClipId]
  );

  // Keep the last song anchored to the exact end of Clip 82 (right before fixed-doc-outro) whenever timeline clip bounds change
  const outroClipStartSec = useMemo(() => {
    const outroClip = clipsWithTimelineBounds.find(
      (c) => c.id === 'fixed-doc-outro' || c.clipNumber === 999
    );
    if (outroClip && outroClip.start > 20) return Number(outroClip.start.toFixed(2));
    const lastClip = clipsWithTimelineBounds[clipsWithTimelineBounds.length - 1];
    return lastClip ? Number(lastClip.end.toFixed(2)) : 0;
  }, [clipsWithTimelineBounds]);

  useEffect(() => {
    if (outroClipStartSec <= 30) return;
    setMusicTracks((prev) => {
      if (prev.length === 0) return prev;
      const lastTrack = prev[prev.length - 1];
      const currentLastEnd = Number((lastTrack.start + lastTrack.duration).toFixed(2));
      if (Math.abs(currentLastEnd - outroClipStartSec) < 0.25) return prev;

      const FIXED_INTRO_SEC = 8;
      const silenceGapSec = 15;
      const lastSongDurSec = 90;
      const lastSongTargetStartSec = Math.max(
        FIXED_INTRO_SEC + 30,
        Number((outroClipStartSec - lastSongDurSec).toFixed(2))
      );
      const nonLastCount = Math.max(1, prev.length - 1);
      const availablePreLastSpanSec = Math.max(
        nonLastCount * 60,
        lastSongTargetStartSec - FIXED_INTRO_SEC - nonLastCount * silenceGapSec
      );
      const evenPreLastDurSec = Math.min(
        156,
        Math.max(60, Math.round(availablePreLastSpanSec / nonLastCount))
      );

      let cursorSec = FIXED_INTRO_SEC;
      return prev.map((mt, idx) => {
        const isLast = idx === prev.length - 1;
        let startSec = cursorSec;
        let durSec = isLast ? lastSongDurSec : evenPreLastDurSec;
        if (isLast) {
          startSec = Math.max(cursorSec, lastSongTargetStartSec);
          durSec = Math.max(10, Number((outroClipStartSec - startSec).toFixed(2)));
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
  }, [outroClipStartSec]);

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
    const allScriptClipsEnd =
      activeDoc?.clips && activeDoc.clips.length > 0
        ? 8 + clip1Sec + Math.max(0, activeDoc.clips.length - 1) * standardClipSec + 8
        : 0;
    return Math.max(10, clipsEnd, Math.ceil(voicePlusOutroEnd), allScriptClipsEnd);
  }, [
    clipsWithTimelineBounds,
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

  const getClipEffectiveVideoUrl = (
    clip?: {
      videoUrl?: string;
      opticalFlowUrl?: string;
      smoothSlowMo?: boolean;
      speed?: number;
    } | null
  ): string => {
    if (!clip?.videoUrl) return '';
    if (clip.opticalFlowUrl && clip.smoothSlowMo !== false && Number(clip.speed ?? 1) < 0.99) {
      return clip.opticalFlowUrl;
    }
    return clip.videoUrl;
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

  const activeCaptionAtPlayhead = useMemo(() => {
    return (
      captions.find((cap) => currentTime >= cap.start && currentTime <= cap.end) || null
    );
  }, [captions, currentTime]);

  const nearestCaptionAtPlayhead = useMemo(() => {
    if (activeCaptionAtPlayhead) return activeCaptionAtPlayhead;
    if (captions.length === 0) return null;
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

  const activeMusicAtPlayhead = useMemo(() => {
    if (
      activeClipAtPlayhead?.id === 'fixed-doc-intro' ||
      activeClipAtPlayhead?.id === 'fixed-doc-outro' ||
      activeClipAtPlayhead?.clipNumber === 0 ||
      activeClipAtPlayhead?.clipNumber === 999
    ) {
      return null;
    }
    return (
      musicTracks.find(
        (m) => m.audioUrl && currentTime >= m.start && currentTime < m.start + m.duration
      ) || null
    );
  }, [musicTracks, currentTime, activeClipAtPlayhead?.id, activeClipAtPlayhead?.clipNumber]);

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

    const defaultFadeIn = isIntro
      ? 1.5
      : isOutro
      ? 1.5
      : activeClipAtPlayhead.clipNumber === 1 || activeClipAtPlayhead.index === 1
      ? 1.2
      : 0;
    const defaultFadeOut = isIntro ? 2.5 : isOutro ? 2.5 : 0;

    const fadeInSec =
      typeof activeClipAtPlayhead.audioFadeInSec === 'number'
        ? Math.max(0, activeClipAtPlayhead.audioFadeInSec)
        : defaultFadeIn;
    const fadeOutSec =
      typeof activeClipAtPlayhead.audioFadeOutSec === 'number'
        ? Math.max(0, activeClipAtPlayhead.audioFadeOutSec)
        : defaultFadeOut;

    const elapsedInClip = Math.max(0, currentTime - activeClipAtPlayhead.start);
    const remainingInClip = Math.max(
      0,
      activeClipAtPlayhead.end - currentTime - (isIntro || isOutro ? 0.12 : 0)
    );
    const fadeInFactor = fadeInSec > 0 ? Math.min(1, elapsedInClip / fadeInSec) : 1;
    const fadeOutFactor = fadeOutSec > 0 ? Math.min(1, remainingInClip / fadeOutSec) : 1;
    const fadeEnvelope = Math.max(0, Math.min(fadeInFactor, fadeOutFactor));

    return Math.round(Math.max(0, Math.min(100, baseFoleyVol * fadeEnvelope)));
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

    const targetBasePct = rawBasePct;

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
        if (ambientGainRef.current && webAudioCtxRef.current) {
          ambientGainRef.current.gain.setTargetAtTime(0, webAudioCtxRef.current.currentTime, 0.15);
        }
        return;
      }
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
        if (ctx.state === 'suspended') {
          ctx.resume().catch(() => {});
        }
        vo.volume = 1;
        gainNode.gain.value = Math.max(0, baseLinear * dbMultiplier);
        return;
      }
    } catch {}
    vo.volume = baseLinear;
  };

  // Explicit manual seek helper so user scrubbing immediately updates wall-clock anchor & media players without backward drift
  const seekToTime = (targetSec: number) => {
    const clamped = Math.max(0, Math.min(totalDurationSec, targetSec));
    currentTimeRef.current = clamped;
    playTimelineStartSecRef.current = clamped;
    playWallStartMsRef.current = performance.now();
    lastSeekVersionRef.current += 1;
    clipEndedHoldRef.current = false;
    setCurrentTime(clamped);
  };

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

    // If playing a pre-baked Optical Flow MP4, pace it across slotDur so it never freezes before the clip ends
    const usingOpticalFlowVideo = Boolean(
      clip.opticalFlowUrl && clip.smoothSlowMo !== false && clip.speed < 0.99
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
      if (
        hasKnownVidDur &&
        !vid.paused &&
        vid.readyState >= 2 &&
        remainingSlotSec > 0.25 &&
        vid.currentTime + remainingSlotSec * optRate > safeVidStreamEnd + 0.04 &&
        safeVidStreamEnd - vid.currentTime > 0.08
      ) {
        optRate = Math.max(
          0.15,
          Math.min(4.0, Number(((safeVidStreamEnd - vid.currentTime) / remainingSlotSec).toFixed(4)))
        );
      }
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

    if (
      isTrimmedOrSpeedAdjusted &&
      hasKnownVidDur &&
      !vid.paused &&
      vid.readyState >= 2 &&
      remainingSlotSec > 0.25 &&
      vid.currentTime >= trimStart &&
      vid.currentTime + remainingSlotSec * effectiveRate > trimEnd + 0.04 &&
      trimEnd - vid.currentTime > 0.08
    ) {
      effectiveRate = Math.max(
        0.15,
        Math.min(4.0, Number(((trimEnd - vid.currentTime) / remainingSlotSec).toFixed(4)))
      );
    }

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
      setIsPlaying(false);
      setCinemaAmbienceActive(false);
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

  // True Wall-Clock Playback Loop (performance.now() anchored so currentTime never lags behind hardware <video>)
  useEffect(() => {
    if (!isPlaying) {
      if (playIntervalRef.current) clearInterval(playIntervalRef.current);
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
      setCinemaAmbienceActive(false);
      if (typeof window !== 'undefined' && 'speechSynthesis' in window) {
        window.speechSynthesis.cancel();
      }
      return;
    }

    playTimelineStartSecRef.current = currentTimeRef.current;
    playWallStartMsRef.current = performance.now();

    const stepMs = 20;
    playIntervalRef.current = setInterval(() => {
      const elapsedSec = (performance.now() - playWallStartMsRef.current) / 1000;
      const next = playTimelineStartSecRef.current + elapsedSec;
      if (next >= totalDurationSec) {
        currentTimeRef.current = 0;
        playTimelineStartSecRef.current = 0;
        playWallStartMsRef.current = performance.now();
        setIsPlaying(false);
        setCurrentTime(0);
        return;
      }
      currentTimeRef.current = next;
      setCurrentTime(next);
    }, stepMs);

    return () => {
      if (playIntervalRef.current) clearInterval(playIntervalRef.current);
    };
  }, [isPlaying, totalDurationSec]);

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
      container.scrollTo({
        left: Math.max(0, playheadX - viewWidth * 0.28),
        behavior: 'smooth',
      });
    }
  }, [currentTime, isPlaying, isFitEntireProject]);

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
      return Math.max(1, Math.min(50, rawNext));
    });
  };

  // Synchronously adjust scrollLeft before browser paint whenever zoom changes so the playhead stays right where it was
  useLayoutEffect(() => {
    if (isFitEntireProject) {
      if (timelineRulerScrollRef.current) {
        timelineRulerScrollRef.current.scrollLeft = 0;
      }
      return;
    }
    const container = timelineScrollContainerRef.current;
    if (!container) return;
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
    if (timelineRulerScrollRef.current) {
      timelineRulerScrollRef.current.scrollLeft = nextScrollLeft;
    }
    zoomPlayheadViewportOffsetRef.current = null;
  }, [timelineZoom, isFitEntireProject]);

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
  const handleStartRulerScrub = (e: React.MouseEvent<HTMLDivElement>) => {
    const rulerEl = timelineRulerLaneRef.current;
    if (!rulerEl) return;
    e.preventDefault();
    e.stopPropagation();
    isScrubbingRulerRef.current = true;

    const updateFromClientX = (clientX: number) => {
      const rect = rulerEl.getBoundingClientRect();
      if (rect.width <= 0) return;
      const ratio = Math.max(0, Math.min(1, (clientX - rect.left) / rect.width));
      seekToTime(ratio * totalDurationSec);
    };

    updateFromClientX(e.clientX);

    const onMove = (moveEvt: MouseEvent) => {
      updateFromClientX(moveEvt.clientX);
    };
    const onUp = () => {
      isScrubbingRulerRef.current = false;
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
    };

    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
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

      if (
        isClipSwitch ||
        isManualSeek ||
        Math.abs((vid.playbackRate || 1) - effectiveRate) > 0.015
      ) {
        try {
          vid.defaultPlaybackRate = effectiveRate;
          vid.playbackRate = effectiveRate;
        } catch {}
      }
      const targetVol = Math.min(1, Math.max(0, effectiveFoleyVolumeAtPlayhead / 100));
      const shouldMute =
        targetVol <= 0 ||
        Boolean(activeClipAtPlayhead.audioMuted) ||
        (activeClipAtPlayhead.foleyVolume ?? 0) <= 0;
      vid.volume = shouldMute ? 0 : targetVol;
      vid.muted = shouldMute;
      vid.style.opacity = '1';

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
        const seekThreshold = isClipSwitch && !isManualSeek && isPlaying ? 0.28 : 0.08;
        if (vid.readyState >= 1 && Math.abs(vid.currentTime - clampedOffset) > seekThreshold) {
          try {
            vid.currentTime = clampedOffset;
          } catch {}
        }
        if (isPlaying && !reachedClipMediaEnd && vid.paused && vid.readyState >= 1) {
          vid.play().catch(() => {});
        }
      } else {
        // Continuous playback inside the same clip: NEVER force-seek vid.currentTime (prevents keyframe rewind jumps!)
        if (vid.ended) {
          clipEndedHoldRef.current = true;
        } else if (!clipEndedHoldRef.current && vid.paused && vid.readyState >= 2) {
          vid.play().catch(() => {});
        }
      }

      // 85ms Pre-Roll Warm Start on the Standby Deck right before the cut so the next clip is already in motion at t=0 of the cut
      if (standbyVid && standbyVid !== vid && nextClipAtPlayhead?.videoUrl) {
        const timeToCut = activeClipAtPlayhead.end - currentTime;
        const nextTrimStart = Math.max(0, Number(nextClipAtPlayhead.trimStart || 0));
        if (isPlaying && timeToCut > 0 && timeToCut <= 0.085) {
          if (standbyVid.paused && standbyVid.readyState >= 2) {
            try {
              const nextSync = computeClipVideoSyncParams(
                standbyVid,
                nextClipAtPlayhead,
                nextClipAtPlayhead.start
              );
              standbyVid.defaultPlaybackRate = nextSync.effectiveRate;
              standbyVid.playbackRate = nextSync.effectiveRate;
              standbyVid.volume = 0;
              standbyVid.muted = true;
              if (Math.abs(standbyVid.currentTime - nextTrimStart) > 0.12) {
                standbyVid.currentTime = nextTrimStart;
              }
              standbyVid.play().catch(() => {});
            } catch {}
          }
        } else if (timeToCut > 0.12 || !isPlaying) {
          try {
            standbyVid.volume = 0;
            standbyVid.muted = true;
            if (!standbyVid.paused) {
              standbyVid.pause();
            }
            if (
              standbyVid.readyState >= 1 &&
              Math.abs(standbyVid.currentTime - nextTrimStart) > 0.08
            ) {
              standbyVid.currentTime = nextTrimStart;
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
        const voTime = getVoiceAudioTimeForTimelineSec(currentTime);
        const isManualVoSeek = appliedVoiceSeekVersionRef.current !== lastSeekVersionRef.current;
        if (isManualVoSeek || !isPlaying || (vo.paused && Math.abs(vo.currentTime - voTime) > 0.35) || Math.abs(vo.currentTime - voTime) > 1.8) {
          appliedVoiceSeekVersionRef.current = lastSeekVersionRef.current;
          try {
            vo.currentTime = voTime;
          } catch {}
        }
        vo.muted = false;
        applyVoiceoverAudioGain(vo, voiceVolume, voiceGainDb);
        if (isPlaying && vo.paused && !vo.ended) {
          vo.play().catch(() => {});
        }
      } else {
        vo.pause();
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
        const musTime = Math.max(0, currentTime - activeMusicAtPlayhead.start);
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
        if (isPlaying && mus.paused && !mus.ended) {
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
    const isLocal =
      typeof window !== 'undefined' &&
      (window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1');
    const bases = isLocal ? [''] : ['', 'http://localhost:4200'];

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
    const isLocal =
      typeof window !== 'undefined' &&
      (window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1');
    const bases = isLocal ? [''] : ['', 'http://localhost:4200'];

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
    const isLocal =
      typeof window !== 'undefined' &&
      (window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1');
    const bases = isLocal ? [''] : ['', 'http://localhost:4200'];

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

  // Detect, separate, and eliminate BOTH music and voices from selected clip(s), leaving ONLY ambient Foley audio
  const handleIsolateFoleyOnlyFromClips = async (targetClipIds: string[]) => {
    setClipContextMenu(null);
    const validIds = Array.from(new Set(targetClipIds.filter(Boolean)));
    if (validIds.length === 0) return;

    const targetClips = clipsWithTimelineBounds.filter((c) => validIds.includes(c.id));
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
    const isLocal =
      typeof window !== 'undefined' &&
      (window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1');
    const bases = isLocal ? [''] : ['', 'http://localhost:4200'];

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
                        : Math.max(c.foleyVolume || 0, 80),
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
                : Math.max(c.foleyVolume || 0, 80),
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

  // When "Solo Foley en Todos los Clips (Sin Música ni Voces)" is selected, automatically process each clip
  useEffect(() => {
    if (!autoIsolateFoleyAllClips || isIsolatingFoley) return;
    const docId = activeDoc?.id || 'doc';
    const pendingClips = timelineClips.filter((c) => {
      if (c.clipNumber <= 0 || c.clipNumber === 999) return false;
      if (c.foleyOnlyDisabled) return false;
      const hasLegacyV1FoleyUrl =
        Boolean(c.videoUrl && c.videoUrl.includes('_foley_only.mp4')) ||
        Boolean(c.cleanFoleyOnlyVideoUrl && c.cleanFoleyOnlyVideoUrl.includes('_foley_only.mp4')) ||
        Boolean(c.opticalFlowUrl && c.opticalFlowUrl.includes('_foley_only.mp4'));
      if (c.foleyOnlyIsolated && !hasLegacyV1FoleyUrl) return false;
      if (!c.videoUrl) return false;
      const attemptKey = `v3_${docId}_${c.id}_${c.videoUrl || ''}_${c.fileName || ''}`;
      return !autoAttemptedFoleyClipIdsRef.current.has(attemptKey);
    });
    if (pendingClips.length === 0) return;
    pendingClips.forEach((c) => {
      const attemptKey = `v3_${docId}_${c.id}_${c.videoUrl || ''}_${c.fileName || ''}`;
      autoAttemptedFoleyClipIdsRef.current.add(attemptKey);
    });
    handleIsolateFoleyOnlyFromClips(pendingClips.map((c) => c.id));
  }, [autoIsolateFoleyAllClips, timelineClips, isIsolatingFoley, activeDoc?.id]);

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
      const next = updater(prev);
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
    applyToAllClips: boolean = false
  ) => {
    const targetIds =
      activeTargetClipIds.length > 0
        ? activeTargetClipIds
        : selectedClip?.id
        ? [selectedClip.id]
        : [];
    const targetSet = new Set(targetIds);
    const singleSelectedClipNum =
      targetIds.length <= 1 && selectedClip && !selectedClip.partLabel
        ? selectedClip.clipNumber
        : null;
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
            if (!patch.audioMuted && (next.foleyVolume ?? 0) <= 0) {
              next.foleyVolume = c.clipNumber === 0 || c.clipNumber === 999 ? 100 : c.clipNumber === 1 ? 80 : 40;
            }
          }
          if (typeof patch.customVolumeSet === 'boolean') {
            next.customVolumeSet = patch.customVolumeSet;
          }
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
    ).toFixed(2)}_of2`;

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
      const isLocal =
        typeof window !== 'undefined' &&
        (window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1');
      const base = isLocal ? '' : 'http://localhost:4200';

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

  // Automatically upgrade any existing slow-mo clip whose Optical Flow cache was generated with the old _of1 key so it never freezes at the end
  useEffect(() => {
    const staleClip = timelineClips.find(
      (c) =>
        c.clipNumber > 0 &&
        c.clipNumber !== 999 &&
        c.speed < 0.99 &&
        c.smoothSlowMo !== false &&
        !opticalFlowProcessingByClipId[c.id] &&
        (!c.opticalFlowUrl || !String(c.opticalFlowBakedKey || '').endsWith('_of2'))
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

    const isPlayheadInside =
      currentTime > targetBoundClip.start + 0.25 && currentTime < targetBoundClip.end - 0.25;
    const splitTimelineSec = isPlayheadInside
      ? currentTime
      : Number((targetBoundClip.start + targetBoundClip.duration / 2).toFixed(2));

    const durA = Number(Math.max(0.3, splitTimelineSec - targetBoundClip.start).toFixed(2));
    const durB = Number(Math.max(0.3, targetBoundClip.end - splitTimelineSec).toFixed(2));
    const ratioA = durA / Math.max(0.6, durA + durB);

    const srcDur =
      targetBoundClip.sourceDuration && targetBoundClip.sourceDuration > 0.5
        ? targetBoundClip.sourceDuration
        : 8;
    const tStart = Math.max(0, targetBoundClip.trimStart || 0);
    const tEnd =
      typeof targetBoundClip.trimEnd === 'number' && targetBoundClip.trimEnd > tStart + 0.1
        ? targetBoundClip.trimEnd
        : srcDur;
    const splitSourceSec = Number((tStart + (tEnd - tStart) * ratioA).toFixed(2));

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
      trimEnd: tEnd,
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

    const isPlayheadInside =
      currentTime > targetBoundClip.start + 0.25 && currentTime < targetBoundClip.end - 0.25;
    if (!isPlayheadInside) {
      setStatusMessage(
        '⚠️ Coloca la aguja roja dentro del clip en el punto exacto hasta donde quieres cortar el inicio.'
      );
      return;
    }

    const ratioCut =
      (currentTime - targetBoundClip.start) / Math.max(0.5, targetBoundClip.duration);
    const srcDur =
      targetBoundClip.sourceDuration && targetBoundClip.sourceDuration > 0.5
        ? targetBoundClip.sourceDuration
        : 8;
    const tStart = Math.max(0, targetBoundClip.trimStart || 0);
    const tEnd =
      typeof targetBoundClip.trimEnd === 'number' && targetBoundClip.trimEnd > tStart + 0.1
        ? targetBoundClip.trimEnd
        : srcDur;
    const newTrimStart = Number((tStart + (tEnd - tStart) * ratioCut).toFixed(2));
    const newActiveSpan = Number(Math.max(0.4, tEnd - newTrimStart).toFixed(2));
    const targetDur = Number(
      (targetBoundClip.originalSlotDuration || targetBoundClip.duration).toFixed(2)
    );
    const newSpeed = Number(Math.max(0.2, Math.min(4.0, newActiveSpan / targetDur)).toFixed(2));

    let updatedClipForFlow: TimelineClipItem | null = null;
    commitTimelineClipsUpdate((prev) =>
      prev.map((c) => {
        if (c.id !== targetBoundClip.id) return c;
        const updated: TimelineClipItem = {
          ...c,
          trimStart: newTrimStart,
          trimEnd: tEnd,
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

    const isPlayheadInside =
      currentTime > targetBoundClip.start + 0.25 && currentTime < targetBoundClip.end - 0.25;
    if (!isPlayheadInside) {
      setStatusMessage(
        '⚠️ Coloca la aguja roja dentro del clip en el punto exacto desde donde quieres borrar hasta el final.'
      );
      return;
    }

    const ratioKeep =
      (currentTime - targetBoundClip.start) / Math.max(0.5, targetBoundClip.duration);
    const srcDur =
      targetBoundClip.sourceDuration && targetBoundClip.sourceDuration > 0.5
        ? targetBoundClip.sourceDuration
        : 8;
    const tStart = Math.max(0, targetBoundClip.trimStart || 0);
    const tEnd =
      typeof targetBoundClip.trimEnd === 'number' && targetBoundClip.trimEnd > tStart + 0.1
        ? targetBoundClip.trimEnd
        : srcDur;
    const newTrimEnd = Number((tStart + (tEnd - tStart) * ratioKeep).toFixed(2));
    const newActiveSpan = Number(Math.max(0.4, newTrimEnd - tStart).toFixed(2));
    const targetDur = Number(
      (targetBoundClip.originalSlotDuration || targetBoundClip.duration).toFixed(2)
    );
    const newSpeed = Number(Math.max(0.2, Math.min(4.0, newActiveSpan / targetDur)).toFixed(2));

    let updatedClipForFlow: TimelineClipItem | null = null;
    commitTimelineClipsUpdate((prev) =>
      prev.map((c) => {
        if (c.id !== targetBoundClip.id) return c;
        const updated: TimelineClipItem = {
          ...c,
          trimStart: tStart,
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
      `🌊 Final cortado (${newTrimEnd.toFixed(1)}s → ${tEnd.toFixed(
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
    const origDur = targetClip.originalSlotDuration || srcDur;
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
  const handleExportMasterVideo = async () => {
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
    if (!downloadFolderName) {
      const picked = await onPickDownloadFolder();
      if (!picked) {
        alert(
          '📂 Primero selecciona la carpeta donde deseas guardar el video final descargado.'
        );
        return;
      }
    }

    setIsRenderingVideo(true);
    setRenderProgressPct(5);
    setStatusMessage(
      `🎬 Renderizando y preparando descarga del video en ${preset.badge} (${width}×${height}, ${aspectRatio})...`
    );

    try {
      // 3. Try Ultra-Fast Native FFmpeg Render first if local server & folderPath are available
      if (downloadFolderPath && activeDoc) {
        try {
          const srtText = captions
            .map((c, idx) => {
              const fmt = (sec: number) => {
                const h = Math.floor(sec / 3600);
                const m = Math.floor((sec % 3600) / 60);
                const s = Math.floor(sec % 60);
                const ms = Math.round((sec - Math.floor(sec)) * 1000);
                return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(
                  s
                ).padStart(2, '0')},${String(ms).padStart(3, '0')}`;
              };
              return `${idx + 1}\n${fmt(c.start)} --> ${fmt(c.end)}\n${formatCaptionTextCase(c.text)}`;
            })
            .join('\n\n');

          const resp = await fetch('/api/editor/render-ffmpeg', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              folderPath: downloadFolderPath,
              docTitle: activeDoc.title,
              aspectRatio,
              resolution: exportResolution,
              clips: timelineClips.map((c) => ({
                clipNumber: c.clipNumber,
                fileName: c.fileName,
                durationSec: c.duration,
                sourceDuration: c.sourceDuration,
                trimStart: c.trimStart || 0,
                trimEnd: c.trimEnd,
                speed: c.speed,
                smoothSlowMo:
                  c.smoothSlowMo !== undefined ? c.smoothSlowMo : Boolean(c.speed && c.speed < 1),
                opticalFlowUrl: c.opticalFlowUrl || '',
                videoUrl: c.videoUrl || '',
                foleyVolume: c.audioMuted ? 0 : c.foleyVolume / 100,
                audioMuted: Boolean(c.audioMuted),
                audioFadeInSec: c.audioFadeInSec,
                audioFadeOutSec: c.audioFadeOutSec,
                transition: c.transition,
                videoDataUrl: c.videoUrl && c.videoUrl.startsWith('data:') ? c.videoUrl : '',
              })),
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
                audioDataUrl: mt.audioUrl && mt.audioUrl.startsWith('data:') ? mt.audioUrl : '',
              })),
              srtContent: srtText,
            }),
          });
          if (resp.ok && (resp.headers.get('content-type') || '').includes('application/json')) {
            const data = await resp.json();
            if (data.ok) {
              setRenderProgressPct(100);
              setStatusMessage(
                `✅ ¡Video renderizado y descargado en ${data.elapsedSec}s! Guardado en: ${data.outputPath}`
              );
              setIsRenderingVideo(false);
              return;
            }
          }
        } catch {}
      }

      const canvas = document.createElement('canvas');
      canvas.width = width;
      canvas.height = height;
      const ctx = canvas.getContext('2d');
      if (!ctx) throw new Error('No se pudo inicializar el motor gráfico de renderizado.');

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

        if (clip?.posterUrl) {
          const frameImg = await new Promise<HTMLImageElement | null>((resolve) => {
            const im = new Image();
            im.crossOrigin = 'anonymous';
            im.onload = () => resolve(im);
            im.onerror = () => resolve(null);
            im.src = clip.posterUrl!;
          });
          if (frameImg) {
            const isSimIntro = clip.id === 'fixed-doc-intro' || clip.clipNumber === 0;
            const isSimOutro = clip.id === 'fixed-doc-outro' || clip.clipNumber === 999;
            const isSimClip1AfterIntro =
              !isSimIntro && !isSimOutro && (clip.clipNumber === 1 || clip.index === 1);
            const isSimLastBodyClip =
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
      const safeTitle = (activeDoc?.title || 'Documental_Huellas')
        .replace(/[^a-zA-Z0-9_-]/g, '_')
        .slice(0, 40);
      const ratioSlug = aspectRatio === '16:9' ? '16x9' : '9x16';
      const outFileName = `${safeTitle}_${preset.badge.replace(/\s+/g, '')}_${ratioSlug}.mp4`;

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
  const isFirstClipAfterIntro =
    Boolean(activeClipAtPlayhead) &&
    !isIntroClipActive &&
    !isOutroClipActive &&
    (activeClipAtPlayhead?.clipNumber === 1 || activeClipAtPlayhead?.index === 1);
  const isLastBodyClipBeforeOutro =
    Boolean(activeClipAtPlayhead) &&
    clipsWithTimelineBounds.length >= 3 &&
    activeClipAtPlayhead?.index === clipsWithTimelineBounds.length - 2;

  const liveClipAnim = activeClipAtPlayhead
    ? computeElementAnimationState(
        currentTime,
        activeClipAtPlayhead.start,
        activeClipAtPlayhead.end,
        isOutroClipActive || isIntroClipActive || isFirstClipAfterIntro ? 'fade' : clipAnimIn,
        isOutroClipActive
          ? 1.2
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
          ? 2.5
          : isIntroClipActive
          ? 0.8
          : isLastBodyClipBeforeOutro
          ? 1.0
          : clipAnimDur
      )
    : { visible: true, opacity: 1, translateX: 0, translateY: 0, scale: 1, blurPx: 0 };

  const liveLogoAnim = computeElementAnimationState(
    currentTime,
    0,
    totalDurationSec,
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
      setIsRightPanelCollapsed(false);
    } else if (selectedCanvasObject === 'captions') {
      setActiveInspectorTab('captions');
      setIsRightPanelCollapsed(false);
    }
  }, [selectedCanvasObject]);

  useEffect(() => {
    if (selectedClipId) {
      setActiveInspectorTab('clips');
      setIsRightPanelCollapsed(false);
    }
  }, [selectedClipId]);

  useEffect(() => {
    if (selectedMusicTrackId) {
      setActiveInspectorTab('audio');
      setIsRightPanelCollapsed(false);
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

          {/* Submenu Trigger: Separar ▸ */}
          <div
            onMouseEnter={() =>
              setClipContextMenu((prev) =>
                prev ? { ...prev, showSepararSubmenu: true } : null
              )
            }
            onMouseLeave={() =>
              setClipContextMenu((prev) =>
                prev ? { ...prev, showSepararSubmenu: false } : null
              )
            }
            onClick={(e) => {
              e.stopPropagation();
              setClipContextMenu((prev) =>
                prev ? { ...prev, showSepararSubmenu: !prev.showSepararSubmenu } : null
              );
            }}
            className="relative px-3 py-2 hover:bg-amber-500/20 text-slate-100 hover:text-amber-200 font-bold flex items-center justify-between cursor-pointer transition"
          >
            <span className="flex items-center gap-2">
              <Scissors className="w-3.5 h-3.5 text-amber-400" />
              Separar
            </span>
            <span className="text-amber-400 font-black">▸</span>

            {/* Submenu Panel: Voces / Extraer Música */}
            {clipContextMenu.showSepararSubmenu && (
              <div
                onClick={(e) => e.stopPropagation()}
                className="absolute left-full top-0 ml-1 w-60 rounded-xl bg-slate-950/95 backdrop-blur-md border border-amber-500/40 shadow-2xl shadow-black/90 py-1.5 z-[260]"
              >
                <div className="px-3 py-1 border-b border-slate-800/80 text-[10px] font-bold text-slate-400 uppercase tracking-wider">
                  Separar Audio en Pista Aparte
                </div>
                <button
                  type="button"
                  disabled={isSeparatingVocals}
                  onClick={() => handleSeparateVocalsFromClips(clipContextMenu.clipIds)}
                  className="w-full px-3 py-2 text-left hover:bg-emerald-500/20 text-emerald-300 hover:text-emerald-200 font-black flex items-center justify-between gap-2 cursor-pointer transition disabled:opacity-50"
                >
                  <span className="flex items-center gap-2">
                    <span>🗣️</span>
                    <span>Voces</span>
                  </span>
                  <span className="px-1.5 py-0.5 rounded bg-emerald-500/20 border border-emerald-500/40 text-[9px] font-mono text-emerald-200">
                    Pista 3B
                  </span>
                </button>
                <button
                  type="button"
                  disabled={isSeparatingMusic}
                  onClick={() => handleSeparateMusicFromClips(clipContextMenu.clipIds)}
                  className="w-full px-3 py-2 text-left hover:bg-purple-500/20 text-purple-300 hover:text-purple-200 font-black flex items-center justify-between gap-2 border-t border-slate-800/70 cursor-pointer transition disabled:opacity-50"
                >
                  <span className="flex items-center gap-2">
                    <span>🎵</span>
                    <span>Extraer Música</span>
                  </span>
                  <span className="px-1.5 py-0.5 rounded bg-purple-500/20 border border-purple-500/40 text-[9px] font-mono text-purple-200">
                    Pista 3C
                  </span>
                </button>
                <button
                  type="button"
                  disabled={isIsolatingFoley}
                  onClick={() => handleIsolateFoleyOnlyFromClips(clipContextMenu.clipIds)}
                  className="w-full px-3 py-2 text-left hover:bg-teal-500/20 text-teal-300 hover:text-teal-200 font-black flex items-center justify-between gap-2 border-t border-slate-800/70 cursor-pointer transition disabled:opacity-50"
                >
                  <span className="flex items-center gap-2">
                    <span>🌿</span>
                    <span>Solo Foley (Este Clip)</span>
                  </span>
                  <span className="px-1.5 py-0.5 rounded bg-teal-500/20 border border-teal-500/40 text-[9px] font-mono text-teal-200">
                    Limpio
                  </span>
                </button>
                <button
                  type="button"
                  disabled={isIsolatingFoley}
                  onClick={() => handleIsolateFoleyForAllClips()}
                  className="w-full px-3 py-2 text-left hover:bg-teal-400/25 text-teal-200 hover:text-white font-black flex items-center justify-between gap-2 border-t border-slate-800/70 cursor-pointer transition disabled:opacity-50"
                >
                  <span className="flex items-center gap-2">
                    <span>🌿⚡</span>
                    <span>Solo Foley en TODOS los Clips</span>
                  </span>
                  <span className="px-1.5 py-0.5 rounded bg-teal-400/25 border border-teal-400/50 text-[9px] font-mono text-teal-100">
                    TODOS
                  </span>
                </button>
              </div>
            )}
          </div>
          <button
            type="button"
            disabled={isIsolatingFoley}
            onClick={(e) => {
              e.stopPropagation();
              handleIsolateFoleyOnlyFromClips(clipContextMenu.clipIds);
            }}
            className="w-full px-3 py-2 text-left hover:bg-teal-500/20 text-teal-300 hover:text-teal-200 font-bold flex items-center justify-between gap-2 border-t border-slate-800/80 cursor-pointer transition disabled:opacity-50"
            title="Detecta, separa y elimina tanto la música como las voces, dejando en el clip únicamente el sonido Foley ambiente"
          >
            <span className="flex items-center gap-2">
              <span>🌿</span>
              <span>Dejar Solo Foley (Este Clip)</span>
            </span>
            <span className="px-1.5 py-0.5 rounded bg-teal-500/20 border border-teal-500/40 text-[9px] font-mono text-teal-200">
              FOLEY
            </span>
          </button>
          <button
            type="button"
            disabled={isIsolatingFoley}
            onClick={(e) => {
              e.stopPropagation();
              handleIsolateFoleyForAllClips();
            }}
            className="w-full px-3 py-2 text-left hover:bg-teal-400/25 text-teal-200 hover:text-white font-black flex items-center justify-between gap-2 border-t border-slate-800/80 cursor-pointer transition disabled:opacity-50"
            title="Detecta, separa y elimina automáticamente la música y las voces en TODOS los clips del video, dejando solo el audio de Foley ambiente en cada clip"
          >
            <span className="flex items-center gap-2">
              <span>🌿⚡</span>
              <span>Solo Foley en TODOS los Clips del Video (Automático)</span>
            </span>
            <span className="px-1.5 py-0.5 rounded bg-teal-400/25 border border-teal-400/50 text-[9px] font-mono text-teal-100">
              TODOS
            </span>
          </button>
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              handleRestoreOriginalAudioToClip(clipContextMenu.clipIds);
            }}
            className="w-full px-3 py-1.5 text-left hover:bg-slate-800 text-slate-300 hover:text-white font-semibold flex items-center justify-between gap-2 border-t border-slate-800/80 cursor-pointer transition text-[11px]"
            title="Restaurar el audio original completo del clip"
          >
            <span className="flex items-center gap-2">
              <span>↩️</span>
              <span>Restaurar Audio Original del Clip</span>
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
      <div className="bg-[#14110d] border-b border-amber-500/25 px-2.5 py-1 flex items-center justify-between gap-2 shrink-0 overflow-x-auto whitespace-nowrap">
        <div className="flex items-center gap-1.5 shrink-0">
          <div className="flex items-center gap-1.5">
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
                className="bg-slate-950 border border-amber-500/40 rounded-lg px-2 py-0.5 text-[11px] font-bold text-amber-200 max-w-[260px] cursor-pointer outline-none"
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

          <button
            type="button"
            onClick={async () => {
              if (onReloadFolderMedia) {
                const count = await onReloadFolderMedia();
                syncTracksFromDocumentary();
                setStatusMessage(
                  count > 0
                    ? `✅ ${count} clip(s) .MP4 y audio cargados automáticamente desde tu carpeta 05_Clips_Video / 02_Audio.`
                    : '🔄 Pistas sincronizadas con el documental activo.'
                );
              } else {
                syncTracksFromDocumentary();
              }
            }}
            className="px-2 py-0.5 rounded-lg bg-slate-800 hover:bg-slate-700 border border-slate-700 text-[11px] text-amber-300 font-semibold flex items-center gap-1 cursor-pointer"
            title="Sincronizar clips, voz narrativa, texto del Clip 1, captions, música de Suno y videos .MP4 desde tu carpeta"
          >
            <RefreshCw className="w-3 h-3" />
            Sincronizar
          </button>

          {/* Selectable Option (Checked by Default): Isolate Ambient Foley Across ALL Clips Automatically */}
          <label
            className={`px-2 py-0.5 rounded-lg border text-[11px] font-black flex items-center gap-1.5 cursor-pointer transition select-none ${
              autoIsolateFoleyAllClips
                ? 'bg-teal-500/20 border-teal-400 text-teal-200'
                : 'bg-slate-950 border-slate-700 text-slate-400 hover:text-slate-200'
            }`}
            title="Opción seleccionable (activa por defecto): mientras está seleccionada, detecta, separa y elimina automáticamente la música y las voces de cada clip dejando solo el audio de Foley ambiente"
          >
            <input
              type="checkbox"
              checked={autoIsolateFoleyAllClips}
              onChange={handleToggleAutoIsolateFoleyAllClips}
              className="w-3 h-3 accent-teal-400 cursor-pointer rounded"
            />
            <span>🌿</span>
            <span>
              {isIsolatingFoley
                ? `Foley (${foleyIsolationProgress?.current || 1}/${foleyIsolationProgress?.total || 1})...`
                : 'Solo Foley en Todos'}
            </span>
          </label>

          {(activeDoc?.clips || []).some((c) => c.reviewedForEditor) && (
            <div className="flex items-center bg-slate-950 border border-emerald-500/40 rounded-lg p-0.5 text-[10px]">
              <button
                type="button"
                onClick={() => setShowOnlyReviewedClips(true)}
                className={`px-2 py-0.5 rounded font-black cursor-pointer transition ${
                  showOnlyReviewedClips
                    ? 'bg-emerald-500 text-slate-950 shadow'
                    : 'text-emerald-300 hover:text-white'
                }`}
                title="Mostrar en el Editor de Video los clips marcados como Revisados en la Etapa 8"
              >
                ✅ Revisados ({(activeDoc?.clips || []).filter((c) => c.reviewedForEditor).length})
              </button>
              <button
                type="button"
                onClick={() => setShowOnlyReviewedClips(false)}
                className={`px-2 py-0.5 rounded font-bold cursor-pointer transition ${
                  !showOnlyReviewedClips
                    ? 'bg-amber-500 text-slate-950 shadow'
                    : 'text-slate-400 hover:text-white'
                }`}
                title="Mostrar todos los clips del guion en la línea de tiempo"
              >
                📋 Todos ({(activeDoc?.clips || []).length})
              </button>
            </div>
          )}
        </div>

        {/* Aspect Ratio (16:9 vs 9:16) + Export Quality (HD / 2K / 4K / 8K) + Folder & Download (with Render) */}
        <div className="flex items-center gap-1.5 shrink-0">
          {/* Aspect Ratio Selector */}
          <div className="flex items-center bg-slate-950 border border-slate-800 rounded-lg p-0.5">
            <button
              type="button"
              onClick={() => {
                setAspectRatio('16:9');
                setCaptionFontSize(40);
              }}
              className={`px-2 py-0.5 rounded text-[11px] font-bold transition cursor-pointer ${
                aspectRatio === '16:9'
                  ? 'bg-amber-500 text-slate-950'
                  : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              📺 16:9
            </button>
            <button
              type="button"
              onClick={() => {
                setAspectRatio('9:16');
                if (captionFontSize === 40) setCaptionFontSize(22);
              }}
              className={`px-2 py-0.5 rounded text-[11px] font-bold transition cursor-pointer ${
                aspectRatio === '9:16'
                  ? 'bg-amber-500 text-slate-950'
                  : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              📱 9:16
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
                    onClick={() => setExportResolution(resKey)}
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

          {/* Export Organized Final YouTube/Reels Package */}
          {onExportOrganizedFolder && (
            <button
              type="button"
              onClick={onExportOrganizedFolder}
              className="px-2.5 py-1 rounded-lg bg-purple-500/20 hover:bg-purple-500/30 border border-purple-500/40 text-purple-200 font-bold text-[11px] flex items-center gap-1 cursor-pointer"
              title="Genera en tu carpeta la estructura completa lista para YouTube: /Clips_Aprobados, /Audio, /Miniaturas, Subtitulos.srt y SEO_YouTube_Copiar_Pegar.txt"
            >
              📦 Paquete YT
            </button>
          )}

          {/* Single Unified Download / Export Video Button */}
          <button
            type="button"
            disabled={isRenderingVideo}
            onClick={handleExportMasterVideo}
            className={`px-3 py-1 rounded-lg font-black text-[11px] flex items-center gap-1.5 cursor-pointer shadow-lg transition ${
              officialLogoUrl
                ? 'bg-teal-400 hover:bg-teal-300 disabled:opacity-50 text-slate-950 shadow-teal-500/20'
                : 'bg-rose-500/20 hover:bg-rose-500/30 border border-rose-500/50 text-rose-200'
            }`}
            title={
              officialLogoUrl
                ? 'Renderiza y descarga el video final en la calidad y formato seleccionados'
                : '🔒 Obligatorio: Primero debes subir el Logo Oficial del canal antes de renderizar y descargar el video'
            }
          >
            <Download className="w-3.5 h-3.5" />
            {isRenderingVideo
              ? `Exportando ${renderProgressPct}%...`
              : !officialLogoUrl
              ? '🔒 Subir Logo'
              : `Export (${activePreset.badge.split(' ')[0]})`}
          </button>
        </div>
      </div>

      {statusMessage && (
        <div className="fixed top-10 right-3 z-[220] max-w-md bg-emerald-950/95 backdrop-blur border border-emerald-500/40 rounded-lg px-3 py-1 text-[11px] text-emerald-200 flex items-center justify-between shadow-2xl">
          <span className="truncate">{statusMessage}</span>
          <button
            type="button"
            onClick={() => setStatusMessage('')}
            className="text-emerald-400 hover:text-white cursor-pointer ml-2"
          >
            ✕
          </button>
        </div>
      )}

      {/* =====================================================================
          UPPER 3-COLUMN CAPCUT WORKSPACE:
          [1] COMPACT LEFT MEDIA SIDEBAR  |  [2] DOMINANT CENTER VIDEO PLAYER  |  [3] COMPACT RIGHT DETAILS/INSPECTOR
          Left & Right columns are strictly locked to the exact vertical height of the Center Video Player and scroll internally.
      ===================================================================== */}
      <div className="flex-1 min-h-0 w-full flex flex-row items-stretch gap-1.5 p-1 bg-[#0e0c09] overflow-hidden">
        {/* =================================================================
            COLUMN 1: COMPACT CAPCUT-STYLE LEFT MEDIA & ASSETS PANEL
        ================================================================= */}
        {isLeftPanelCollapsed ? (
          <div className="flex w-8 h-full max-h-full shrink-0 bg-[#14110d] border border-slate-800/90 rounded-xl flex-col items-center py-2 gap-3 select-none">
            <button
              type="button"
              onClick={() => setIsLeftPanelCollapsed(false)}
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
          <div className="w-[210px] lg:w-[230px] xl:w-[245px] h-full max-h-full shrink-0 bg-[#14110d] border border-slate-800/90 rounded-xl flex flex-col min-h-0 overflow-hidden">
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
                const thumb = firstFrameByClip[clip.clipNumber] || clip.posterUrl;
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
          {/* Compact CapCut-Style Player Header ("Player - Timeline 01" + Quick Overlay Selection) */}
          <div className="w-full px-3 py-1 bg-[#100d0a] border-b border-slate-800/80 flex items-center justify-between text-xs text-slate-400 flex-wrap gap-1.5 shrink-0">
            <div className="flex items-center gap-2 flex-wrap">
              <button
                type="button"
                onClick={() => setIsLeftPanelCollapsed((prev) => !prev)}
                className="hidden lg:inline-flex px-1.5 py-0.5 rounded bg-slate-900 hover:bg-slate-800 border border-slate-700/80 text-[10px] text-slate-300 cursor-pointer"
                title={isLeftPanelCollapsed ? 'Mostrar panel izquierdo Media' : 'Ocultar panel izquierdo Media para ampliar aún más el visor'}
              >
                ◧
              </button>
              <span className="font-semibold text-slate-200 text-[11px]">
                Player - Timeline 01
              </span>
              <span className="font-mono text-amber-300/90 text-[10px] font-bold">
                • {aspectRatio} •{' '}
                {aspectRatio === '16:9'
                  ? `${activePreset.width16x9}×${activePreset.height16x9}`
                  : `${activePreset.width9x16}×${activePreset.height9x16}`}
              </span>
              <div
                data-keep-canvas-selection="true"
                className="flex items-center gap-1 bg-slate-950 border border-slate-800 rounded-lg p-0.5"
              >
                <button
                  type="button"
                  onClick={() => {
                    setSelectedCanvasObject((prev) => (prev === 'logo' ? null : 'logo'));
                    setActiveInspectorTab('branding');
                  }}
                  className={`px-2 py-0.5 rounded text-[10px] font-bold cursor-pointer transition ${
                    selectedCanvasObject === 'logo'
                      ? 'bg-amber-500 text-slate-950'
                      : 'text-slate-300 hover:bg-slate-800'
                  }`}
                >
                  🏷️ Logo
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setSelectedCanvasObject((prev) => (prev === 'hook_text' ? null : 'hook_text'));
                    setActiveInspectorTab('branding');
                  }}
                  className={`px-2 py-0.5 rounded text-[10px] font-bold cursor-pointer transition ${
                    selectedCanvasObject === 'hook_text'
                      ? 'bg-amber-500 text-slate-950'
                      : 'text-slate-300 hover:bg-slate-800'
                  }`}
                >
                  🔤 Texto
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setSelectedCanvasObject((prev) => (prev === 'captions' ? null : 'captions'));
                    setActiveInspectorTab('captions');
                  }}
                  className={`px-2 py-0.5 rounded text-[10px] font-bold cursor-pointer transition ${
                    selectedCanvasObject === 'captions'
                      ? 'bg-sky-400 text-slate-950'
                      : 'text-slate-300 hover:bg-slate-800'
                  }`}
                >
                  💬 Captions
                </button>
              </div>
            </div>

            <div className="flex items-center gap-1.5">
              <span
                className={`px-2 py-0.5 rounded text-[10px] font-bold ${
                  effectiveVoiceoverUrl && !voiceAudioError
                    ? 'bg-emerald-500/15 border border-emerald-500/40 text-emerald-300'
                    : 'bg-amber-500/15 border border-amber-500/40 text-amber-300'
                }`}
              >
                {effectiveVoiceoverUrl && !voiceAudioError
                  ? `🎙️ Voz 00:${String(Math.floor(voiceStartOffsetSec)).padStart(2, '0')} (${formatTimeMMSS(totalDurationSec)})`
                  : '🔇 Sin Voz'}
              </span>
              <button
                type="button"
                onClick={() => setIsRightPanelCollapsed((prev) => !prev)}
                className="hidden lg:inline-flex px-1.5 py-0.5 rounded bg-slate-900 hover:bg-slate-800 border border-slate-700/80 text-[10px] text-slate-300 cursor-pointer"
                title={isRightPanelCollapsed ? 'Mostrar panel derecho Details/Inspector' : 'Ocultar panel derecho Details/Inspector para ampliar aún más el visor'}
              >
                ◨
              </button>
            </div>
          </div>

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
                  if (selectedCanvasObject !== null) {
                    setSelectedCanvasObject(null);
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
                style={
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
                }
              >
              {/* Layer 1: True Dual-Deck (A/B Ping-Pong) Hardware Video Engine with 85ms Pre-Roll (0ms Decoder Swap, Zero Frozen Last Frame) */}
              {activeClipAtPlayhead?.videoUrl ? (
                <div
                  className="relative w-full h-full overflow-hidden bg-black"
                  style={{
                    opacity: liveClipAnim.opacity,
                    transform: `translate3d(${liveClipAnim.translateX}px, ${liveClipAnim.translateY}px, 0) scale(${liveClipAnim.scale})`,
                    filter: liveClipAnim.blurPx > 0.1 ? `blur(${liveClipAnim.blurPx.toFixed(1)}px)` : undefined,
                  }}
                >
                  {([0, 1] as const).map((slotIdx) => {
                    const isDeckActive = activeDeckSlot === slotIdx;
                    const slotSrc = slotIdx === 0 ? deckAUrl : deckBUrl;
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
                        className="absolute inset-0 w-full h-full object-cover block bg-transparent"
                        style={{
                          opacity: isDeckActive ? 1 : 0,
                          zIndex: isDeckActive ? 20 : 10,
                          pointerEvents: isDeckActive ? 'auto' : 'none',
                        }}
                        playsInline
                        muted={
                          !isDeckActive ||
                          effectiveFoleyVolumeAtPlayhead <= 0 ||
                          Boolean(activeClipAtPlayhead?.audioMuted) ||
                          (activeClipAtPlayhead?.foleyVolume ?? 0) <= 0
                        }
                        preload={isEditorActive ? 'auto' : 'none'}
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
                        onError={() => {
                          if (deckAssignRef.current.activeSlot !== slotIdx) return;
                          const clipNum = activeClipAtPlayhead?.clipNumber;
                          const fallbackUrl = clipNum ? localServerClipVideosMap[clipNum] : '';
                          if (
                            clipNum &&
                            fallbackUrl &&
                            activeClipAtPlayhead?.videoUrl !== fallbackUrl
                          ) {
                            setTimelineClips((prev) =>
                              prev.map((tc) =>
                                tc.clipNumber === clipNum ? { ...tc, videoUrl: fallbackUrl } : tc
                              )
                            );
                          }
                        }}
                      />
                    );
                  })}
                </div>
              ) : (
                /* Animated Cinematic Storyboard Canvas when no .MP4 or image is loaded yet */
                <div className="w-full h-full relative overflow-hidden bg-gradient-to-br from-[#1b140c] via-[#0c1118] to-[#060504] flex flex-col items-center justify-center p-6 text-center">
                  <div
                    className="absolute inset-0 opacity-35 pointer-events-none transition-transform duration-150 ease-linear"
                    style={{
                      transform: `scale(${kenBurnsScale}) translateX(${kenBurnsPanX}%)`,
                      backgroundImage:
                        'radial-gradient(circle at 30% 35%, rgba(245, 158, 11, 0.35), transparent 55%), radial-gradient(circle at 75% 65%, rgba(14, 165, 233, 0.22), transparent 55%)',
                    }}
                  />
                  <div className="relative z-10 max-w-2xl space-y-2.5">
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
                  </div>
                </div>
              )}

              {/* Canonical 520p WYSIWYG Overlay Stage: guarantees 100% identical text size, line wrapping & distribution in Normal Mode, Fullscreen & Exported Video */}
              <div
                className="absolute top-0 left-0 pointer-events-none select-none overflow-hidden z-20"
                style={{
                  width: `${canonicalStageWidth}px`,
                  height: `${CANONICAL_STAGE_HEIGHT}px`,
                  transform: `scale(${viewerScaleX}, ${viewerScaleY})`,
                  transformOrigin: 'top left',
                }}
              >
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
                      captionBgStyle === 'word_shadow'
                        ? 'inline px-2.5 py-0.5 rounded-md'
                        : 'inline-block px-3.5 py-1 rounded-lg'
                    } font-extrabold transition whitespace-pre-line`}
                    style={{
                      fontFamily: captionFontFamily,
                      fontSize: `${Math.max(13, captionFontSize * 0.76)}px`,
                      color:
                        captionColor === 'amber'
                          ? '#fde047'
                          : captionColor === 'custom'
                          ? captionCustomColor
                          : '#ffffff',
                      textShadow: getTextShadowCss(captionShadowStyle),
                      boxDecorationBreak: 'clone',
                      WebkitBoxDecorationBreak: 'clone',
                      backgroundColor:
                        captionBgStyle === 'none'
                          ? 'transparent'
                          : hexToRgba(
                              captionBgColor,
                              captionBgStyle === 'solid' ? 95 : captionBgOpacity
                            ),
                      ...(captionBgStyle === 'word_shadow'
                        ? {
                            boxShadow: `0 0 12px 4px ${hexToRgba(
                              captionBgColor,
                              Math.round(captionBgOpacity * 0.85)
                            )}`,
                          }
                        : {}),
                    }}
                  >
                    {formatCaptionTextCase(
                      activeCaptionAtPlayhead?.text || nearestCaptionAtPlayhead?.text || ''
                    )}
                  </span>
                </div>
              )}
              </div>
              </div>
            </div>

            {/* CapCut-Style Compact Bottom Player Bar: Timecode (Left), Transport & Scrubber (Center), Ratio & Fullscreen (Right) */}
            <div
              className={`w-full bg-[#110e0b] border-t border-slate-800/90 px-3 py-1.5 flex items-center gap-2 transition-all duration-300 shrink-0 ${
                isViewerFullscreen
                  ? `absolute inset-x-0 bottom-0 z-30 bg-[#110e0b]/95 backdrop-blur-md ${
                      showFullscreenControls
                        ? 'opacity-100 translate-y-0 pointer-events-auto'
                        : 'opacity-0 translate-y-3 pointer-events-none'
                    }`
                  : ''
              }`}
            >
              {/* Left: CapCut Cyan/Teal Timecode */}
              <span className="font-mono tabular-nums text-[11px] text-teal-300 font-bold shrink-0">
                00:{formatTimeMMSS(currentTime)} <span className="text-slate-500">/</span> 00:{formatTimeMMSS(totalDurationSec)}
              </span>

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
                  onClick={() => seekToTime(Math.max(0, currentTime - 10))}
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
                  onClick={() => seekToTime(Math.min(totalDurationSec, currentTime + 10))}
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
              <div className="flex-1 flex items-center min-w-[80px]">
                <input
                  type="range"
                  min={0}
                  max={totalDurationSec}
                  step={0.05}
                  value={currentTime}
                  onChange={(e) => seekToTime(Number(e.target.value))}
                  className="w-full h-1.5 accent-amber-500 cursor-pointer"
                />
              </div>

              {/* Right: Aspect Ratio Badge + Fullscreen Button */}
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
          <div className="flex w-8 h-full max-h-full shrink-0 bg-[#14110d] border border-slate-800/90 rounded-xl flex-col items-center py-2 gap-3 select-none">
            <button
              type="button"
              onClick={() => setIsRightPanelCollapsed(false)}
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
              : 'w-[240px] lg:w-[255px] xl:w-[275px] h-full max-h-full shrink-0 bg-[#14110d] border border-slate-800/90 rounded-xl p-2 flex flex-col min-h-0 overflow-hidden space-y-2'
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
                          handleUpdateClipsAudio({
                            foleyVolume: selectedClip.clipNumber === 1 ? 80 : 35,
                            audioFadeInSec: undefined,
                            audioFadeOutSec: undefined,
                            audioMuted: false,
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

                      {/* FOLEY ISOLATION (REMOVE MUSIC & VOICES, KEEP ONLY AMBIENT FOLEY — SELECTABLE, ON BY DEFAULT) */}
                      <div className="pt-1.5 border-t border-slate-800/80">
                        {(() => {
                          const isClipFoleySelected =
                            !selectedClip.foleyOnlyDisabled &&
                            (Boolean(selectedClip.foleyOnlyIsolated) || autoIsolateFoleyAllClips);
                          const targetIds =
                            selectedClipIds.length > 1 && selectedClipIds.includes(selectedClip.id)
                              ? selectedClipIds
                              : [selectedClip.id];
                          return (
                            <label
                              className={`flex items-center gap-2.5 px-2.5 py-2 rounded-lg border cursor-pointer select-none transition ${
                                isClipFoleySelected
                                  ? 'bg-teal-500/20 border-teal-400/70 text-teal-100 shadow-sm'
                                  : 'bg-slate-900/90 border-slate-700 text-slate-300 hover:border-teal-500/40'
                              }`}
                              title="Opción seleccionable (activa por defecto): elimina música y voces dejando únicamente el sonido de Foley ambiente"
                            >
                              <input
                                type="checkbox"
                                checked={isClipFoleySelected}
                                disabled={isIsolatingFoley}
                                onChange={(e) =>
                                  handleToggleClipFoleyOnly(targetIds, e.target.checked)
                                }
                                className="w-4 h-4 accent-teal-400 rounded cursor-pointer shrink-0"
                              />
                              <span className="text-[11px] font-black text-teal-200 leading-snug">
                                {isIsolatingFoley
                                  ? `🌿 Limpieza de Audio (Solo Foley Ambiente) — Procesando (${foleyIsolationProgress?.current || 1}/${foleyIsolationProgress?.total || 1})...`
                                  : '🌿 Limpieza de Audio (Solo Foley Ambiente)'}
                              </span>
                            </label>
                          );
                        })()}
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

              {/* Aislar Solo Foley Ambiente en los Clips (Eliminar Música y Voces de los Clips) */}
              <div className="bg-teal-950/30 border border-teal-500/40 rounded-xl p-3 space-y-2">
                <div className="flex items-center justify-between gap-2 flex-wrap">
                  <span className="font-bold text-teal-300 text-xs flex items-center gap-1.5">
                    🌿 Aislar Solo Foley Ambiente (Eliminar Música y Voces de los Clips)
                  </span>
                  <span className="text-[10px] font-mono text-teal-200/80">
                    {timelineClips.filter((c) => c.foleyOnlyIsolated).length}/
                    {timelineClips.filter((c) => c.clipNumber > 0 && c.clipNumber !== 999).length} clips limpios
                  </span>
                </div>
                <p className="text-[11px] text-slate-300 leading-relaxed">
                  Detecta, separa y elimina tanto las voces como la música incrustada en los clips de video, dejando únicamente los efectos físicos y el ambiente Foley en cada clip.
                </p>
                <div className="pt-1">
                  <label
                    className={`w-full px-3 py-2 rounded-lg border font-black text-xs flex items-center gap-2.5 cursor-pointer transition select-none shadow ${
                      autoIsolateFoleyAllClips
                        ? 'bg-teal-500/25 border-teal-400 text-teal-100'
                        : 'bg-slate-900 border-slate-700 text-slate-300 hover:text-teal-200'
                    }`}
                    title="Mientras está seleccionada, aplica automáticamente Limpieza de Audio (Solo Foley Ambiente) a los clips"
                  >
                    <input
                      type="checkbox"
                      checked={autoIsolateFoleyAllClips}
                      onChange={handleToggleAutoIsolateFoleyAllClips}
                      className="w-4 h-4 accent-teal-400 cursor-pointer rounded shrink-0"
                    />
                    <span className="leading-snug">
                      {isIsolatingFoley
                        ? `🌿 Limpieza de Audio (Solo Foley Ambiente) — Procesando (${foleyIsolationProgress?.current || 1}/${foleyIsolationProgress?.total || 1})...`
                        : '🌿 Limpieza de Audio (Solo Foley Ambiente)'}
                    </span>
                  </label>
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
                            volume: 10,
                            fadeInSec: 5,
                            fadeOutSec: 5,
                          });
                        }}
                        className="px-2 py-1 rounded-lg bg-slate-900 hover:bg-slate-800 border border-slate-700 text-slate-300 font-semibold text-[10px] cursor-pointer"
                      >
                        🔄 Restaurar Canción (10% • 5s / 5s)
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
                        {officialIntroUrl
                          ? `✅ Guardado permanente: ${officialIntroFileName || 'Intro.mp4 (8s)'}`
                          : 'Vinculado automáticamente a Intro.mp4 (8s, 8K) con Fade In/Out de audio.'}
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
                      handleGenerateAutoCaptionsFromVoice(
                        voiceStartOffsetSec,
                        effectiveVoiceDurationSec,
                        detectedAudioSilencesRef.current,
                        true
                      );
                      setStatusMessage(
                        `💬 Subtítulos resincronizados acústicamente desde 00:${String(Math.floor(voiceStartOffsetSec)).padStart(2, '0')} hasta ${formatTimeMMSS(totalDurationSec)}.`
                      );
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
                    onChange={(e) => setCaptionFontFamily(e.target.value)}
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
                      onClick={() => setCaptionTextCase('original')}
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
                      onClick={() => setCaptionTextCase('uppercase')}
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
                      onClick={() => setCaptionTextCase('lowercase')}
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
                <div>
                  <label className="block text-[10px] text-slate-400">Tamaño ({captionFontSize}px)</label>
                  <input
                    type="range"
                    min={14}
                    max={64}
                    value={captionFontSize}
                    onChange={(e) => setCaptionFontSize(Number(e.target.value))}
                    className="w-full accent-amber-500"
                  />
                </div>
                <div>
                  <label className="block text-[10px] text-slate-400">Altura ({captionBottomPct}%)</label>
                  <input
                    type="range"
                    min={5}
                    max={45}
                    value={captionBottomPct}
                    onChange={(e) => setCaptionBottomPct(Number(e.target.value))}
                    className="w-full accent-amber-500"
                  />
                </div>
                <div>
                  <label className="block text-[10px] text-slate-400">Color de Texto</label>
                  <div className="flex items-center gap-1.5 mt-0.5">
                    <select
                      value={captionColor}
                      onChange={(e) => setCaptionColor(e.target.value as 'white' | 'amber' | 'custom')}
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
                        onChange={(e) => setCaptionCustomColor(e.target.value)}
                        className="w-6 h-6 rounded cursor-pointer border-0 bg-transparent"
                      />
                    )}
                  </div>
                </div>
                <div>
                  <label className="block text-[10px] text-slate-400">Sombra / Contorno</label>
                  <select
                    value={captionShadowStyle}
                    onChange={(e) => setCaptionShadowStyle(e.target.value as OverlayShadowStyle)}
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
                    onChange={(e) => setCaptionBgStyle(e.target.value as OverlayBgStyle)}
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
                        onChange={(e) => setCaptionBgColor(e.target.value)}
                        className="w-5 h-5 rounded cursor-pointer border-0 bg-transparent"
                      />
                      <input
                        type="range"
                        min={10}
                        max={100}
                        value={captionBgOpacity}
                        onChange={(e) => setCaptionBgOpacity(Number(e.target.value))}
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
                      onChange={(e) => setCaptionAnimIn(e.target.value as ElementAnimationType)}
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
                      onChange={(e) => setCaptionAnimOut(e.target.value as ElementAnimationType)}
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
                      onChange={(e) => setCaptionAnimDur(Math.max(0.05, Number(e.target.value)))}
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
              <span className="shrink-0 tabular-nums">
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
                {selectedClip.clipNumber !== 0 && selectedClip.clipNumber !== 999 && (() => {
                  const isClipFoleySelected =
                    !selectedClip.foleyOnlyDisabled &&
                    (Boolean(selectedClip.foleyOnlyIsolated) || autoIsolateFoleyAllClips);
                  const targetIds =
                    selectedClipIds.length > 1 && selectedClipIds.includes(selectedClip.id)
                      ? selectedClipIds
                      : [selectedClip.id];
                  return (
                    <label
                      className={`px-2 py-0.5 rounded border font-black text-[9px] flex items-center gap-1 cursor-pointer select-none transition ${
                        isClipFoleySelected
                          ? 'bg-teal-500/25 border-teal-400 text-teal-100'
                          : 'bg-slate-900 border-slate-700 text-slate-300 hover:text-teal-200'
                      }`}
                      title="Opción seleccionable (activa por defecto): deja solo el audio de Foley ambiente en este clip"
                    >
                      <input
                        type="checkbox"
                        checked={isClipFoleySelected}
                        disabled={isIsolatingFoley}
                        onChange={(e) => handleToggleClipFoleyOnly(targetIds, e.target.checked)}
                        className="w-2.5 h-2.5 accent-teal-400 rounded cursor-pointer"
                      />
                      <span>🌿</span>
                      <span>
                        {isIsolatingFoley
                          ? `Foley (${foleyIsolationProgress?.current || 1}/${foleyIsolationProgress?.total || 1})...`
                          : 'Solo Foley Ambiente'}
                      </span>
                    </label>
                  );
                })()}
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
              onClick={() => handleChangeTimelineZoom((z) => Math.max(1, z - 3), false)}
              className="px-1.5 py-0.5 rounded bg-slate-900 hover:bg-slate-800 border border-slate-700 text-slate-300 font-bold cursor-pointer"
              title="Alejar línea de tiempo (ver minutos / horas)"
            >
              −
            </button>
            <input
              type="range"
              min={1}
              max={50}
              value={isFitEntireProject ? 1 : timelineZoom}
              onChange={(e) => handleChangeTimelineZoom(Number(e.target.value), false)}
              className="w-20 accent-amber-500 cursor-pointer"
            />
            <button
              type="button"
              onClick={() => handleChangeTimelineZoom((z) => Math.min(50, z + 3), false)}
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
          className={`flex-1 min-h-0 bg-[#0e0c09] px-2 pb-1.5 overflow-y-auto ${
            isFitEntireProject ? 'overflow-x-hidden' : 'overflow-x-auto'
          }`}
        >
          <div className={`relative space-y-1 ${isFitEntireProject ? 'w-full' : 'min-w-max pr-64'}`}>
            {/* =================================================================
                SINGLE UNIFIED VERTICAL PLAYHEAD NEEDLE (RULER + ALL TRACKS)
            ================================================================= */}
            <div
              style={{
                left: isFitEntireProject
                  ? `calc(9.5rem + (100% - 9.5rem) * ${Math.min(
                      1,
                      Math.max(0, currentTime / Math.max(1, totalDurationSec))
                    ).toFixed(6)})`
                  : `calc(9.5rem + ${(currentTime * timelineZoom).toFixed(2)}px)`,
              }}
              className="pointer-events-none absolute top-0 bottom-0 z-40 w-0"
            >
              {/* Single Unbroken Vertical Playhead Line from Top of Ruler through Bottom of Track 5 */}
              <div className="absolute top-0 bottom-0 left-0 -translate-x-1/2 w-[2.5px] bg-gradient-to-b from-amber-300 via-rose-500 to-amber-400 shadow-[0_0_12px_rgba(244,63,94,0.95)]" />
              {/* Sticky Top Playhead Handle & Time Badge */}
              <div
                onMouseDown={handleStartRulerScrub}
                title="Arrastra la aguja para moverte por la línea de tiempo"
                className="sticky top-0 z-50 pointer-events-auto cursor-ew-resize w-max -translate-x-1/2 flex flex-col items-center select-none pt-0.5"
              >
                <div className="px-1.5 py-0.5 rounded bg-rose-600 border border-amber-300 text-[9px] font-mono font-black text-white shadow-md whitespace-nowrap leading-none">
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
              <div className="w-36 shrink-0 px-2 py-1 rounded bg-slate-950 border border-amber-500/30 text-[9px] font-bold text-amber-300 flex items-center justify-between">
                <span>⏱️ Regla</span>
                <span className="px-1 py-0.5 rounded bg-amber-500/15 text-[8px] font-mono text-amber-200">
                  {timelineRulerData.scaleUnitLabel}
                </span>
              </div>
              <div
                ref={timelineRulerLaneRef}
                onMouseDown={handleStartRulerScrub}
                style={
                  isFitEntireProject
                    ? undefined
                    : { width: `${Math.max(300, totalDurationSec * timelineZoom)}px` }
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
              <div className="w-36 shrink-0 px-2 py-1 rounded bg-slate-900 border border-slate-800 text-[10px] font-bold text-amber-300 truncate">
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
              <div className="w-36 shrink-0 px-2 py-1 rounded bg-slate-900 border border-slate-800 text-[10px] font-bold text-sky-300 truncate">
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
              <div className="w-36 shrink-0 px-2 py-1.5 rounded bg-amber-500/15 border border-amber-500/40 text-[10px] font-black text-amber-300 flex flex-col gap-1">
                <span className="truncate">3. 🎬 Clips ({timelineClips.length})</span>
                <label
                  className={`w-full px-1.5 py-0.5 rounded border font-black text-[9px] flex items-center gap-1 cursor-pointer transition select-none ${
                    autoIsolateFoleyAllClips
                      ? 'bg-teal-500/25 border-teal-400 text-teal-100'
                      : 'bg-slate-900/90 border-slate-700 text-slate-400 hover:text-slate-200'
                  }`}
                  title="Opción seleccionable (activa por defecto): mientras está seleccionada, aplica Solo Foley (sin música ni voces) automáticamente a cada clip"
                >
                  <input
                    type="checkbox"
                    checked={autoIsolateFoleyAllClips}
                    onChange={handleToggleAutoIsolateFoleyAllClips}
                    className="w-2.5 h-2.5 accent-teal-400 cursor-pointer rounded shrink-0"
                  />
                  <span>🌿</span>
                  <span className="truncate">
                    {isIsolatingFoley
                      ? `Foley (${foleyIsolationProgress?.current || 1}/${foleyIsolationProgress?.total || 1})`
                      : 'Solo Foley'}
                  </span>
                </label>
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
                      )} - ${formatTimeMMSS(clip.end)} • ${clip.duration}s (${clip.speed}x) • Clic derecho: Separar ▸ Voces (Cmd/Ctrl+Clic o Shift+Clic para varios clips)`}
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
                            {firstFrameByClip[clip.clipNumber] || clip.posterUrl ? (
                              <img
                                src={firstFrameByClip[clip.clipNumber] || clip.posterUrl}
                                alt={clip.fileName}
                                className="absolute inset-0 w-full h-full object-cover opacity-65 group-hover:opacity-90 transition"
                              />
                            ) : null}
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

                            {firstFrameByClip[clip.clipNumber] || clip.posterUrl ? (
                              <div className="relative z-10 h-12 w-full rounded overflow-hidden bg-black border border-slate-800">
                                <img
                                  src={firstFrameByClip[clip.clipNumber] || clip.posterUrl}
                                  alt={clip.fileName}
                                  className="w-full h-full object-cover"
                                />
                                {clip.speed < 1.0 && clip.smoothSlowMo !== false && (
                                  <span className="absolute top-1 left-1 px-1.5 py-0.5 rounded bg-sky-500/90 text-[8px] font-black text-slate-950 shadow">
                                    🌊 Optical Flow {clip.speed}x {clip.opticalFlowUrl ? '✓' : ''}
                                  </span>
                                )}
                                <div className="absolute top-1 right-1 flex flex-col items-end gap-0.5">
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
                                  {isCurrent ? '▶ En Curso' : 'Fotograma 1'}
                                </span>
                              </div>
                            ) : (
                              <div className="relative z-10 h-12 w-full rounded overflow-hidden bg-slate-950/90 border border-slate-800/80 flex flex-col items-center justify-center p-1 text-center">
                                <span className="text-[10px] font-bold text-amber-300/90">
                                  🎬 Escena {String(clip.clipNumber).padStart(2, '0')}
                                </span>
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
                            )}

                            <div className="relative z-10 flex items-center justify-between text-[9px] text-slate-400 pt-0.5 border-t border-slate-800/80">
                              <span className={clip.speed < 1.0 ? 'text-sky-300 font-bold' : ''}>
                                {clip.duration}s • {clip.speed}x
                                {clip.speed < 1.0 && clip.smoothSlowMo !== false ? ' 🌊' : ''}
                              </span>
                              <span>
                                {clip.audioMuted
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
                              </span>
                            </div>
                          </>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>

            {/* TRACK 3B: SEPARATED VOCALS FROM CLIPS (MOVABLE & DELETABLE TIMELINE SEGMENTS) */}
            <div className={`flex items-center gap-2 ${isFitEntireProject ? 'w-full' : 'min-w-max'}`}>
              <div className="w-36 shrink-0 px-2 py-1 rounded bg-teal-950/70 border border-teal-500/40 text-[10px] font-black text-teal-300 flex items-center justify-between truncate">
                <span>3B. 🗣️ Voces ({separatedVocalSegments.length})</span>
              </div>
              <div
                style={
                  isFitEntireProject
                    ? undefined
                    : { width: `${Math.max(300, totalDurationSec * timelineZoom)}px` }
                }
                className={`relative h-7 bg-slate-950/90 border border-teal-500/30 rounded overflow-hidden flex items-center ${
                  isFitEntireProject ? 'flex-1 min-w-0' : 'shrink-0'
                }`}
              >
                {separatedVocalSegments.length === 0 ? (
                  <span className="text-[10px] text-slate-500 px-2 truncate">
                    Clic derecho sobre clips de Pista 3 ▸{' '}
                    <strong className="text-amber-300">Separar ▸ 🗣️ Voces</strong>
                  </span>
                ) : (
                  separatedVocalSegments.map((seg) => {
                    const isSegSelected = selectedVocalSegmentId === seg.id;
                    const isSegPlaying = activeSeparatedVocalAtPlayhead?.id === seg.id;
                    return (
                      <div
                        key={seg.id}
                        onMouseDown={(e) =>
                          handleStartDragSeparatedVocal(
                            e,
                            seg,
                            e.currentTarget.parentElement as HTMLDivElement | null
                          )
                        }
                        onClick={(e) => {
                          e.stopPropagation();
                          setSelectedVocalSegmentId(seg.id);
                          setSelectedMusicSegmentId(null);
                        }}
                        style={
                          isFitEntireProject
                            ? {
                                left: `${(seg.start / Math.max(1, totalDurationSec)) * 100}%`,
                                width: `${(seg.duration / Math.max(1, totalDurationSec)) * 100}%`,
                              }
                            : {
                                left: `${seg.start * timelineZoom}px`,
                                width: `${Math.max(36, seg.duration * timelineZoom)}px`,
                              }
                        }
                        title={`${seg.title} (${formatTimeMMSS(seg.start)} - ${formatTimeMMSS(
                          seg.start + seg.duration
                        )}) • Arrastra horizontalmente para mover por el timeline o pulsa 🗑️ / Suprimir para borrar`}
                        className={`absolute top-1 bottom-1 rounded-md border px-2 flex items-center justify-between gap-1.5 cursor-grab active:cursor-grabbing select-none transition ${
                          seg.muted
                            ? 'bg-slate-900/90 border-slate-700 text-slate-500 opacity-60'
                            : isSegSelected
                            ? 'bg-teal-500/35 border-2 border-amber-300 text-white shadow-lg shadow-teal-500/20 z-20'
                            : isSegPlaying
                            ? 'bg-teal-500/30 border-teal-300 text-teal-100 z-10'
                            : 'bg-teal-950/85 hover:bg-teal-900/80 border-teal-500/50 text-teal-200'
                        }`}
                      >
                        <div className="flex items-center gap-1 min-w-0 truncate">
                          <span className="text-[10px] font-black truncate">
                            {seg.muted ? '🔇 ' : '🗣️ '}
                            {seg.title.replace(/^🗣️\s*/, '')}
                          </span>
                          <span className="text-[9px] font-mono text-teal-300/90 shrink-0">
                            ({formatTimeMMSS(seg.start)}-{formatTimeMMSS(seg.start + seg.duration)})
                          </span>
                        </div>
                        <div
                          onMouseDown={(e) => e.stopPropagation()}
                          className="flex items-center gap-1 shrink-0"
                        >
                          <button
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation();
                              handleToggleMuteSeparatedVocal(seg.id);
                            }}
                            className="px-1 py-0.5 rounded bg-slate-900/90 hover:bg-slate-800 text-[9px] text-teal-200 cursor-pointer"
                            title={seg.muted ? 'Activar audio de este segmento de voz' : 'Silenciar este segmento de voz'}
                          >
                            {seg.muted ? '🔇' : '🔊'}
                          </button>
                          <button
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation();
                              handleRestoreSeparatedVocalToClip(seg);
                            }}
                            className="px-1 py-0.5 rounded bg-slate-900/90 hover:bg-slate-800 text-[9px] text-amber-300 cursor-pointer"
                            title="Devolver la voz a su clip original"
                          >
                            ↩️
                          </button>
                          <button
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation();
                              handleDeleteSeparatedVocalSegment(seg.id);
                            }}
                            className="px-1 py-0.5 rounded bg-rose-600/90 hover:bg-rose-500 text-[9px] text-white font-bold cursor-pointer"
                            title="Borrar este segmento de voz de la línea de tiempo"
                          >
                            🗑️
                          </button>
                        </div>
                      </div>
                    );
                  })
                )}
              </div>
            </div>

            {/* TRACK 3C: EXTRACTED MUSIC FROM CLIPS (MOVABLE & DELETABLE TIMELINE SEGMENTS) */}
            <div className={`flex items-center gap-2 ${isFitEntireProject ? 'w-full' : 'min-w-max'}`}>
              <div className="w-36 shrink-0 px-2 py-1 rounded bg-purple-950/70 border border-purple-500/40 text-[10px] font-black text-purple-300 flex items-center justify-between truncate">
                <span>3C. 🎵 Música ({separatedMusicSegments.length})</span>
              </div>
              <div
                style={
                  isFitEntireProject
                    ? undefined
                    : { width: `${Math.max(300, totalDurationSec * timelineZoom)}px` }
                }
                className={`relative h-7 bg-slate-950/90 border border-purple-500/30 rounded overflow-hidden flex items-center ${
                  isFitEntireProject ? 'flex-1 min-w-0' : 'shrink-0'
                }`}
              >
                {separatedMusicSegments.length === 0 ? (
                  <span className="text-[10px] text-slate-500 px-2 truncate">
                    Clic derecho sobre clips de Pista 3 ▸{' '}
                    <strong className="text-purple-300">Separar ▸ 🎵 Extraer Música</strong>
                  </span>
                ) : (
                  separatedMusicSegments.map((seg) => {
                    const isSegSelected = selectedMusicSegmentId === seg.id;
                    const isSegPlaying = activeSeparatedMusicAtPlayhead?.id === seg.id;
                    return (
                      <div
                        key={seg.id}
                        onMouseDown={(e) =>
                          handleStartDragSeparatedMusic(
                            e,
                            seg,
                            e.currentTarget.parentElement as HTMLDivElement | null
                          )
                        }
                        onClick={(e) => {
                          e.stopPropagation();
                          setSelectedMusicSegmentId(seg.id);
                          setSelectedVocalSegmentId(null);
                        }}
                        style={
                          isFitEntireProject
                            ? {
                                left: `${(seg.start / Math.max(1, totalDurationSec)) * 100}%`,
                                width: `${(seg.duration / Math.max(1, totalDurationSec)) * 100}%`,
                              }
                            : {
                                left: `${seg.start * timelineZoom}px`,
                                width: `${Math.max(36, seg.duration * timelineZoom)}px`,
                              }
                        }
                        title={`${seg.title} (${formatTimeMMSS(seg.start)} - ${formatTimeMMSS(
                          seg.start + seg.duration
                        )}) • Arrastra horizontalmente para mover por el timeline o pulsa 🗑️ / Suprimir para borrar`}
                        className={`absolute top-1 bottom-1 rounded-md border px-2 flex items-center justify-between gap-1.5 cursor-grab active:cursor-grabbing select-none transition ${
                          seg.muted
                            ? 'bg-slate-900/90 border-slate-700 text-slate-500 opacity-60'
                            : isSegSelected
                            ? 'bg-purple-500/35 border-2 border-amber-300 text-white shadow-lg shadow-purple-500/20 z-20'
                            : isSegPlaying
                            ? 'bg-purple-500/30 border-purple-300 text-purple-100 z-10'
                            : 'bg-purple-950/85 hover:bg-purple-900/80 border-purple-500/50 text-purple-200'
                        }`}
                      >
                        <div className="flex items-center gap-1 min-w-0 truncate">
                          <span className="text-[10px] font-black truncate">
                            {seg.muted ? '🔇 ' : '🎵 '}
                            {seg.title.replace(/^🎵\s*/, '')}
                          </span>
                          <span className="text-[9px] font-mono text-purple-300/90 shrink-0">
                            ({formatTimeMMSS(seg.start)}-{formatTimeMMSS(seg.start + seg.duration)})
                          </span>
                        </div>
                        <div
                          onMouseDown={(e) => e.stopPropagation()}
                          className="flex items-center gap-1 shrink-0"
                        >
                          <button
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation();
                              handleToggleMuteSeparatedMusic(seg.id);
                            }}
                            className="px-1 py-0.5 rounded bg-slate-900/90 hover:bg-slate-800 text-[9px] text-purple-200 cursor-pointer"
                            title={seg.muted ? 'Activar audio de este segmento de música' : 'Silenciar este segmento de música'}
                          >
                            {seg.muted ? '🔇' : '🔊'}
                          </button>
                          <button
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation();
                              handleRestoreSeparatedMusicToClip(seg);
                            }}
                            className="px-1 py-0.5 rounded bg-slate-900/90 hover:bg-slate-800 text-[9px] text-amber-300 cursor-pointer"
                            title="Devolver la música a su clip original"
                          >
                            ↩️
                          </button>
                          <button
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation();
                              handleDeleteSeparatedMusicSegment(seg.id);
                            }}
                            className="px-1 py-0.5 rounded bg-rose-600/90 hover:bg-rose-500 text-[9px] text-white font-bold cursor-pointer"
                            title="Borrar este segmento de música de la línea de tiempo"
                          >
                            🗑️
                          </button>
                        </div>
                      </div>
                    );
                  })
                )}
              </div>
            </div>

            {/* TRACK 4: VOICEOVER NARRATION (FULL DURATION ON TIMELINE) */}
            <div className={`flex items-center gap-2 ${isFitEntireProject ? 'w-full' : 'min-w-max'}`}>
              <div className="w-36 shrink-0 px-2 py-1 rounded bg-slate-900 border border-slate-800 text-[10px] font-bold text-emerald-300 truncate">
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
                <div className="w-36 shrink-0 px-2 py-1 rounded bg-slate-900 border border-slate-800 text-[10px] font-bold text-purple-300 flex items-center justify-between truncate">
                  <span>5. 🎵 Flow Music ({musicTracks.length})</span>
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
                      Las pistas multi-escena de la Etapa 10 (Flow Music) aparecen aquí. Haz clic en cualquier canción para ajustar su volumen, Fade-In y Fade-Out.
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
                              title={`Silencio dramático de ${gapSec}s entre escenas (solo voz narrativa + Foley)`}
                            >
                              🔇 Silencio {gapSec}s
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
                                ? 'bg-purple-900/90 border-purple-300 text-white ring-2 ring-purple-400/70 shadow-lg shadow-purple-500/25 z-10'
                                : 'bg-purple-950/65 hover:bg-purple-900/75 border-purple-500/45 text-purple-200'
                            }`}
                            title={`Clic para editar volumen y fades • Doble clic para ir al inicio • ${mt.title} (${formatTimeMMSS(
                              mt.start
                            )} - ${formatTimeMMSS(
                              mt.start + mt.duration
                            )}) • Vol: ${songVol}% • Fade-In: ${songFadeIn}s • Fade-Out: ${songFadeOut}s`}
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
                            <Music className="w-3 h-3 text-purple-300 shrink-0 relative z-10" />
                            <span className="truncate relative z-10 font-semibold">
                              #{mt.trackNumber} {mt.title} ({formatTimeMMSS(mt.start)} -{' '}
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
