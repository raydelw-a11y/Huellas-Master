import React, { useState, useEffect, useRef, useMemo } from 'react';
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
  foleyVolume: number; // 0 to 100
  transition: ClipTransitionType;
  videoUrl?: string; // local blob URL or data URL of the MP4
  posterUrl?: string; // keyframe or preview image
  reviewedForEditor?: boolean;
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
    // If SRT starts near 0.0s (e.g. 0.0s - 2.0s), shift by +alignStartSec.
    // If SRT is already offset to ~8.0s (e.g. 8.55s with 0.55s acoustic lead-in), preserve the acoustic lead-in
    // and only shift by (alignStartSec - 8.0) when alignStartSec differs from 8.0s!
    let delta = 0;
    if (firstStart < 2.2) {
      delta = alignStartSec - (firstStart < 0.25 ? firstStart : 0);
    } else if (firstStart >= 7.8 && firstStart <= 9.8) {
      delta = alignStartSec - 8.0;
    } else if (Math.abs(alignStartSec - firstStart) > 1.8) {
      delta = alignStartSec - firstStart;
    }
    if (Math.abs(delta) > 0.05) {
      return items.map((it) => ({
        ...it,
        start: Number(Math.max(0, it.start + delta).toFixed(2)),
        end: Number(Math.max(0.3, it.end + delta).toFixed(2)),
      }));
    }
  }

  return items;
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
  const [logoScalePct, setLogoScalePct] = useState<number>(6);
  const [logoOpacity, setLogoOpacity] = useState<number>(95);
  const [logoPosX, setLogoPosX] = useState<number>(3);
  const [logoPosY, setLogoPosY] = useState<number>(3);
  // Default Logo animations for ALL documentaries: Fade Out 1s at the end of the documentary
  const [logoAnimIn, setLogoAnimIn] = useState<ElementAnimationType>('none');
  const [logoAnimInDur, setLogoAnimInDur] = useState<number>(1);
  const [logoAnimOut, setLogoAnimOut] = useState<ElementAnimationType>('fade');
  const [logoAnimOutDur, setLogoAnimOutDur] = useState<number>(1);

  // 3. Clip 1 Hook Overlay Text (First 8s) + Typography, Size, Shadow, Background, Position & Animations
  const [clip1Line1, setClip1Line1] = useState<string>(
    normalizeClip1Line1Format(activeDoc?.clip1Line1LocationTime || '')
  );
  const [clip1Line2, setClip1Line2] = useState<string>(activeDoc?.clip1Line2Hook || '');
  const [clip1OverlayEndSec, setClip1OverlayEndSec] = useState<number>(() => {
    const { clip1Sec } = getStage1ClipDurations(activeDoc);
    return !clip1Sec || clip1Sec <= 6 ? 8 : clip1Sec;
  });
  // Default Hook Text animations for ALL documentaries:
  // Line 1: starts at 0s, Fade In 1s (0s->1s), Fade Out 1s toward 8s (7s->8s)
  // Line 2: appears at 2s, Fade In 1s (2s->3s), Fade Out 1s toward 8s (7s->8s)
  const [hookLine1StartSec, setHookLine1StartSec] = useState<number>(0);
  const [hookLine1AnimIn, setHookLine1AnimIn] = useState<ElementAnimationType>('fade');
  const [hookLine1AnimInDur, setHookLine1AnimInDur] = useState<number>(1);
  const [hookLine1AnimOut, setHookLine1AnimOut] = useState<ElementAnimationType>('fade');
  const [hookLine1AnimOutDur, setHookLine1AnimOutDur] = useState<number>(1);

  const [hookLine2StartSec, setHookLine2StartSec] = useState<number>(2);
  const [hookLine2AnimIn, setHookLine2AnimIn] = useState<ElementAnimationType>('fade');
  const [hookLine2AnimInDur, setHookLine2AnimInDur] = useState<number>(1);
  const [hookLine2AnimOut, setHookLine2AnimOut] = useState<ElementAnimationType>('fade');
  const [hookLine2AnimOutDur, setHookLine2AnimOutDur] = useState<number>(1);

  // Animations for Captions & Video Clips / Images
  const [captionAnimIn, setCaptionAnimIn] = useState<ElementAnimationType>('fade');
  const [captionAnimOut, setCaptionAnimOut] = useState<ElementAnimationType>('fade');
  const [captionAnimDur, setCaptionAnimDur] = useState<number>(0.25);

  const [clipAnimIn, setClipAnimIn] = useState<ElementAnimationType>('none');
  const [clipAnimOut, setClipAnimOut] = useState<ElementAnimationType>('none');
  const [clipAnimDur, setClipAnimDur] = useState<number>(0.6);

  const [hookFontFamily, setHookFontFamily] = useState<string>(EDITOR_FONT_OPTIONS[0].value);
  const [hookLine1FontSize, setHookLine1FontSize] = useState<number>(15);
  const [hookLine2FontSize, setHookLine2FontSize] = useState<number>(24);
  const [hookLine1Color, setHookLine1Color] = useState<string>('#fcd34d');
  const [hookLine2Color, setHookLine2Color] = useState<string>('#ffffff');
  const [hookShadowStyle, setHookShadowStyle] = useState<OverlayShadowStyle>('cinema');
  const [hookBgStyle, setHookBgStyle] = useState<OverlayBgStyle>('word_shadow');
  const [hookBgColor, setHookBgColor] = useState<string>('#000000');
  const [hookBgOpacity, setHookBgOpacity] = useState<number>(55);
  const [hookLeftPct, setHookLeftPct] = useState<number>(50);
  const [hookTopPct, setHookTopPct] = useState<number>(50);
  const [hookBoxWidthPct, setHookBoxWidthPct] = useState<number>(82);
  const [isDraggingOrResizingHook, setIsDraggingOrResizingHook] = useState<boolean>(false);
  const viewerCanvasRef = useRef<HTMLDivElement | null>(null);

  const handleStartHookBoxDrag = (e: React.MouseEvent) => {
    if (e.button !== 0) return;
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
    if (e.button !== 0) return;
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
  const [draggedClipIndex, setDraggedClipIndex] = useState<number | null>(null);
  const [showOnlyReviewedClips, setShowOnlyReviewedClips] = useState<boolean>(true);

  // Voiceover Track (Track 4) — Always starts at 8s (when Hook Text fades out at 00:08)
  const [voiceStartOffsetSec, setVoiceStartOffsetSec] = useState<number>(() => {
    const { clip1Sec } = getStage1ClipDurations(activeDoc);
    return !clip1Sec || clip1Sec <= 6 ? 8 : clip1Sec;
  });
  const [voiceDurationSec, setVoiceDurationSec] = useState<number>(0);
  const [voiceVolume, setVoiceVolume] = useState<number>(100);
  const [autoDuckingEnabled, setAutoDuckingEnabled] = useState<boolean>(true);
  const [foleyHighVolume, setFoleyHighVolume] = useState<number>(80); // When narrator is silent
  const [foleyDuckedVolume, setFoleyDuckedVolume] = useState<number>(35); // When narrator speaks

  // Captions Track (Track 2) + Typography, Size, Shadow, Background & Position
  const [captions, setCaptions] = useState<TimelineCaptionItem[]>([]);
  const [captionFontFamily, setCaptionFontFamily] = useState<string>(EDITOR_FONT_OPTIONS[7].value);
  const [captionFontSize, setCaptionFontSize] = useState<number>(22);
  const [captionBottomPct, setCaptionBottomPct] = useState<number>(11);
  const [captionColor, setCaptionColor] = useState<'white' | 'amber' | 'custom'>('white');
  const [captionCustomColor, setCaptionCustomColor] = useState<string>('#ffffff');
  const [captionShadowStyle, setCaptionShadowStyle] = useState<OverlayShadowStyle>('cinema');
  const [captionBgStyle, setCaptionBgStyle] = useState<OverlayBgStyle>('word_shadow');
  const [captionBgColor, setCaptionBgColor] = useState<string>('#000000');
  const [captionBgOpacity, setCaptionBgOpacity] = useState<number>(25);

  // Music Track (Track 5 - Suno)
  const [musicTracks, setMusicTracks] = useState<TimelineMusicItem[]>([]);
  const [masterMusicVolume, setMasterMusicVolume] = useState<number>(24);

  // Playback & Rendering State
  const [isPlaying, setIsPlaying] = useState<boolean>(false);
  const [currentTime, setCurrentTime] = useState<number>(0);
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
  const voiceAudioRef = useRef<HTMLAudioElement | null>(null);
  const musicAudioRef = useRef<HTMLAudioElement | null>(null);
  const playIntervalRef = useRef<any>(null);
  const webAudioCtxRef = useRef<AudioContext | null>(null);
  const ambientGainRef = useRef<GainNode | null>(null);
  const lastSpokenClipIdRef = useRef<string>('');
  const extractedVideoUrlByClipRef = useRef<Record<number, string>>({});
  const playWallStartMsRef = useRef<number>(0);
  const playTimelineStartSecRef = useRef<number>(0);
  const currentTimeRef = useRef<number>(0);
  const lastSeekVersionRef = useRef<number>(0);
  const appliedVideoSeekVersionRef = useRef<number>(-1);
  const appliedVoiceSeekVersionRef = useRef<number>(-1);
  const appliedMusicSeekVersionRef = useRef<number>(-1);
  const activePlayingClipIdRef = useRef<string | null>(null);
  const activePlayingMusicIdRef = useRef<string | null>(null);
  const clipEndedHoldRef = useRef<boolean>(false);
  const timelineScrollContainerRef = useRef<HTMLDivElement | null>(null);
  const timelineRulerLaneRef = useRef<HTMLDivElement | null>(null);
  const isScrubbingRulerRef = useRef<boolean>(false);

  // Reset extracted first frames and auto-query local server 05_Clips_Video when switching documentaries
  useEffect(() => {
    setFirstFrameByClip({});
    setLocalServerClipVideosMap({});
    setLocalServerSunoMap({});
    extractedVideoUrlByClipRef.current = {};

    let cancelled = false;
    (async () => {
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
          if (Array.isArray(data.clipVideos) && data.clipVideos.length > 0) {
            const nextVids: Record<number, string> = {};
            for (const item of data.clipVideos) {
              if (item.clipNumber > 0 && item.url) {
                nextVids[item.clipNumber] = prefix(item.url);
              }
            }
            setLocalServerClipVideosMap(nextVids);
            if (Array.isArray(data.sunoFiles) && data.sunoFiles.length > 0) {
              const nextSuno: Record<number, string> = {};
              for (const s of data.sunoFiles) {
                if (s.trackNumber > 0 && s.url && !nextSuno[s.trackNumber]) {
                  nextSuno[s.trackNumber] = prefix(s.url);
                }
              }
              setLocalServerSunoMap(nextSuno);
            }
            break;
          }
        } catch {}
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [activeDoc?.id, activeDoc?.title, downloadFolderName, downloadFolderPath]);

  // Automatically extract the exact FIRST FRAME (t = 0.08s) of each clip's .MP4 video when paused and no posterUrl exists
  useEffect(() => {
    if (isPlaying) return;
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

        const timer = setTimeout(() => finish(''), 3500);

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
        extractedVideoUrlByClipRef.current[item.clipNumber] = item.videoUrl;
        const frameDataUrl = await extractFirstFrameFromVideoUrl(item.videoUrl);
        if (!cancelled && frameDataUrl) {
          setFirstFrameByClip((prev) => ({
            ...prev,
            [item.clipNumber]: frameDataUrl,
          }));
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [timelineClips, isPlaying]);

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

  // Detected acoustic silences from the real Voiceover MP3/WAV waveform
  const detectedAudioSilencesRef = useRef<Array<{ start: number; end: number; dur: number }>>([]);
  const decodedSilenceUrlRef = useRef<string>('');

  // Sync tracks from activeDoc whenever documentary changes or user clicks "Sincronizar"
  const syncTracksFromDocumentary = () => {
    if (!activeDoc) return;

    const { clip1Sec: c1BaseDur, standardClipSec: standardDur } = getStage1ClipDurations(activeDoc);
    // Voiceover and Captions ALWAYS start at 8s (when Hook Text fades out at 00:08), or c1BaseDur if > 6s
    const entrySec = !c1BaseDur || c1BaseDur <= 6 ? 8 : c1BaseDur;

    setClip1Line1(
      normalizeClip1Line1Format(
        activeDoc.clip1Line1LocationTime ||
          [activeDoc.historicalLocation, activeDoc.historicalTime].filter(Boolean).join(', ')
      )
    );
    setClip1Line2(activeDoc.clip1Line2Hook || activeDoc.title || '');
    setClip1OverlayEndSec(entrySec);
    setVoiceStartOffsetSec(entrySec);

    // 1. Build Clips Track (Track 3)
    const allDocClips = activeDoc.clips || [];
    const reviewedClips = allDocClips.filter((c) => c.reviewedForEditor);
    const docClips =
      showOnlyReviewedClips && reviewedClips.length > 0 ? reviewedClips : allDocClips;

    const combinedClipVideosMap: Record<number, string> = {
      ...localServerClipVideosMap,
      ...capturedClipVideosMap,
    };
    const combinedSunoAudioMap: Record<number, string> = {
      ...localServerSunoMap,
      ...capturedSunoAudioMap,
    };

    const builtClips: TimelineClipItem[] = docClips.map((c, idx) => {
      const isClip1 = c.clipNumber === 1 || idx === 0;
      const srcDur =
        Number(c.durationSeconds) > 0 ? Number(c.durationSeconds) : isClip1 ? c1BaseDur : standardDur;
      const existingItem = timelineClips.find((tc) => tc.clipNumber === c.clipNumber);
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
        fileName: buildClipSixWordFileName(c, activeDoc),
        narrationSegment: c.narrationSegment || '',
        imagePrompt: c.imagePrompt || '',
        videoPrompt: c.videoPrompt || '',
        duration: existingItem ? existingItem.duration : srcDur,
        sourceDuration: srcDur,
        speed: existingItem ? existingItem.speed : 1,
        trimStart: existingItem ? existingItem.trimStart : 0,
        foleyVolume: existingItem ? existingItem.foleyVolume : isClip1 ? 80 : 35,
        transition: existingItem ? existingItem.transition : defaultTransition,
        videoUrl,
        posterUrl,
        reviewedForEditor: Boolean(c.reviewedForEditor),
      };
    });

    // If activeDoc.clips is empty but combinedClipVideosMap has .MP4 files from 05_Clips_Video, build timeline clips from those .MP4 files!
    if (builtClips.length === 0 && Object.keys(combinedClipVideosMap).length > 0) {
      const sortedNums = Object.keys(combinedClipVideosMap)
        .map((n) => parseInt(n, 10))
        .filter((n) => n > 0)
        .sort((a, b) => a - b);
      sortedNums.forEach((num, idx) => {
        const isClip1 = num === 1 || idx === 0;
        const srcDur = isClip1 ? c1BaseDur : standardDur;
        builtClips.push({
          id: `folder-clip-${num}`,
          clipNumber: num,
          fileName: `${String(num).padStart(2, '0')}_Clip_Documental.mp4`,
          narrationSegment: '',
          duration: srcDur,
          sourceDuration: srcDur,
          speed: 1,
          trimStart: 0,
          foleyVolume: isClip1 ? 80 : 35,
          transition: defaultTransition,
          videoUrl: combinedClipVideosMap[num],
          posterUrl: firstFrameByClip[num] || '',
          reviewedForEditor: true,
        });
      });
    }

    setTimelineClips(builtClips);
    if (builtClips.length > 0 && !selectedClipId) {
      setSelectedClipId(builtClips[0].id);
    }

    // 2. Build Captions Track (Track 2) aligned to entrySec (8s) and real Voiceover audio
    if (
      activeDoc.voiceoverScript &&
      activeDoc.voiceoverScript.trim() &&
      effectiveVoiceDurationSec > 1
    ) {
      handleGenerateAutoCaptionsFromVoice(entrySec, effectiveVoiceDurationSec);
    } else if (activeDoc.correctedSrt && activeDoc.correctedSrt.trim()) {
      setCaptions(parseSrtToCaptionItems(activeDoc.correctedSrt, entrySec));
    } else {
      handleGenerateAutoCaptionsFromVoice(entrySec, effectiveVoiceDurationSec);
    }

    // 3. Build Flow Music / Suno Multi-Scene Track (Track 5) with exact scene timestamps, 10-20s dramatic silences, 1:30 final track, Fade-In (2.5s) & Fade-Out (3.0s)
    const fullVoiceSpanSec =
      effectiveVoiceDurationSec > 0 ? entrySec + effectiveVoiceDurationSec : 0;
    const totalTimelineSec = Math.max(
      builtClips.reduce((acc, item) => acc + item.duration, 0),
      fullVoiceSpanSec,
      activeDoc.targetDurationSeconds || 120
    );
    const sunoList = activeDoc.sunoTracks || [];
    if (sunoList.length > 0) {
      let cursorSec = 0;
      const silenceGapSec = 15; // Mandatory 10-20s silence between songs
      const builtMusic: TimelineMusicItem[] = sunoList.map((st, idx) => {
        const isLast = idx === sunoList.length - 1;
        const parsedMinsMatch = (st.duration || '').match(/(\d+):(\d{2})/);
        let durSec = parsedMinsMatch
          ? parseInt(parsedMinsMatch[1], 10) * 60 + parseInt(parsedMinsMatch[2], 10)
          : isLast
          ? 90
          : 150;

        // Parse exact scene range MM:SS - MM:SS from st.videoTimeRange when present
        const rangeMatch = (st.videoTimeRange || '').match(
          /(\d{1,3}):(\d{2})\s*[-–—a]+\s*(\d{1,3}):(\d{2})/
        );
        let startSec = cursorSec;
        if (rangeMatch) {
          const parsedStart =
            parseInt(rangeMatch[1], 10) * 60 + parseInt(rangeMatch[2], 10);
          const parsedEnd =
            parseInt(rangeMatch[3], 10) * 60 + parseInt(rangeMatch[4], 10);
          if (parsedEnd > parsedStart) {
            startSec = parsedStart;
            durSec = isLast ? 90 : parsedEnd - parsedStart;
          }
        } else {
          if (isLast) {
            durSec = 90; // Mandatory 1:30 for last song
          }
          startSec = isLast
            ? Math.max(cursorSec, totalTimelineSec - 90)
            : cursorSec;
        }

        cursorSec = startSec + durSec + silenceGapSec;
        return {
          id: st.id || `music-${idx + 1}`,
          trackNumber: idx + 1,
          title: st.title || `Canción ${idx + 1}`,
          start: startSec,
          duration: durSec,
          volume: masterMusicVolume,
          audioUrl: combinedSunoAudioMap[idx + 1] || st.audioUrl,
          isLast90Sec: isLast,
          fadeInSec: 2.5,
          fadeOutSec: 3.0,
          videoTimeRange: st.videoTimeRange,
        };
      });
      setMusicTracks(builtMusic);
    }
  };

  const reviewedClipsSignature = (activeDoc?.clips || [])
    .map((c) => `${c.clipNumber}:${c.reviewedForEditor ? 1 : 0}:${c.videoReady ? 1 : 0}`)
    .join('|');

  const capturedClipVideosSignature = Object.entries({
    ...localServerClipVideosMap,
    ...capturedClipVideosMap,
  })
    .sort((a, b) => Number(a[0]) - Number(b[0]))
    .map(([k, v]) => `${k}:${v ? v.slice(-32) : ''}`)
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
    reviewedClipsSignature,
    showOnlyReviewedClips,
    capturedClipVideosSignature,
    sunoTracksSignature,
    capturedSunoSignature,
    folderVoiceoverUrl,
  ]);

  const prealignedVideo76SrtRef = useRef<string>('');

  // Auto-Generate Captions directly from Voiceover starting at voiceStartOffsetSec (8s) using 3-Level Hierarchical Acoustic Alignment (Paragraphs -> Sentences -> Clauses & Breath Islands)
  const handleGenerateAutoCaptionsFromVoice = (
    customEntryOffset?: number,
    customVoiceDurSec?: number,
    customSilences?: Array<{ start: number; end: number; dur: number }>
  ) => {
    if (!activeDoc) return;
    const offset =
      typeof customEntryOffset === 'number' ? customEntryOffset : voiceStartOffsetSec;
    const targetVoiceDur =
      typeof customVoiceDurSec === 'number' && customVoiceDurSec > 1
        ? customVoiceDurSec
        : effectiveVoiceDurationSec;
    const maxCharsPerCaption = 34;

    const isVideo76 = isVideo76Doc;
    if (isVideo76 && prealignedVideo76SrtRef.current) {
      const parsed76 = parseSrtToCaptionItems(prealignedVideo76SrtRef.current, offset);
      if (parsed76.length > 0) {
        setCaptions(parsed76);
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

    setCaptions(generated);
  };

  // Pre-load verified 3-Level Acoustically Locked SRT for Video 76 so playback captions match 100% immediately
  useEffect(() => {
    if (!isVideo76Doc) return;
    if (prealignedVideo76SrtRef.current) {
      setCaptions(parseSrtToCaptionItems(prealignedVideo76SrtRef.current, voiceStartOffsetSec));
      return;
    }
    let cancelled = false;
    fetch('tts-files/subtitulos-video-76-exodo-espanol.srt')
      .then((r) => (r.ok ? r.text() : ''))
      .then((txt) => {
        if (cancelled || !txt || !txt.includes('-->')) return;
        prealignedVideo76SrtRef.current = txt;
        setCaptions(parseSrtToCaptionItems(txt, voiceStartOffsetSec));
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [isVideo76Doc, voiceStartOffsetSec]);

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

  // Re-align captions automatically whenever voiceStartOffsetSec or effectiveVoiceDurationSec updates
  useEffect(() => {
    if (!activeDoc) return;
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
      setCaptions(parseSrtToCaptionItems(activeDoc.correctedSrt, voiceStartOffsetSec));
    } else {
      handleGenerateAutoCaptionsFromVoice(voiceStartOffsetSec, effectiveVoiceDurationSec);
    }
  }, [voiceStartOffsetSec, effectiveVoiceDurationSec, activeDoc?.id]);

  // Compute each clip's start & end time on the master timeline
  const clipsWithTimelineBounds = useMemo(() => {
    let cursor = 0;
    return timelineClips.map((clip, index) => {
      const start = cursor;
      const end = cursor + clip.duration;
      cursor = end;
      return {
        ...clip,
        index,
        start,
        end,
      };
    });
  }, [timelineClips]);

  // Total timeline duration ALWAYS spans the entire Voiceover Narration (00:08 -> 15:17) as well as all clips
  const totalDurationSec = useMemo(() => {
    const clipsEnd =
      clipsWithTimelineBounds.length > 0
        ? clipsWithTimelineBounds[clipsWithTimelineBounds.length - 1].end
        : 60;
    const voiceEnd =
      effectiveVoiceDurationSec > 0 ? voiceStartOffsetSec + effectiveVoiceDurationSec : 0;
    const { clip1Sec, standardClipSec } = getStage1ClipDurations(activeDoc);
    const allScriptClipsEnd =
      activeDoc?.clips && activeDoc.clips.length > 0
        ? clip1Sec + Math.max(0, activeDoc.clips.length - 1) * standardClipSec
        : 0;
    return Math.max(10, clipsEnd, Math.ceil(voiceEnd), allScriptClipsEnd);
  }, [
    clipsWithTimelineBounds,
    effectiveVoiceDurationSec,
    voiceStartOffsetSec,
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
    return (
      musicTracks.find(
        (m) => m.audioUrl && currentTime >= m.start && currentTime < m.start + m.duration
      ) || null
    );
  }, [musicTracks, currentTime]);

  const isNarratorSpeakingAtPlayhead = useMemo(() => {
    if (currentTime < voiceStartOffsetSec) return false;
    if (activeClipAtPlayhead && activeClipAtPlayhead.clipNumber === 1 && voiceStartOffsetSec > 0)
      return false;
    return Boolean(
      activeClipAtPlayhead?.narrationSegment?.trim() || activeCaptionAtPlayhead?.text?.trim()
    );
  }, [currentTime, voiceStartOffsetSec, activeClipAtPlayhead, activeCaptionAtPlayhead]);

  const effectiveFoleyVolumeAtPlayhead = useMemo(() => {
    if (!activeClipAtPlayhead) return 0;
    if (!autoDuckingEnabled) return activeClipAtPlayhead.foleyVolume;
    return isNarratorSpeakingAtPlayhead ? foleyDuckedVolume : foleyHighVolume;
  }, [
    activeClipAtPlayhead,
    autoDuckingEnabled,
    isNarratorSpeakingAtPlayhead,
    foleyDuckedVolume,
    foleyHighVolume,
  ]);

  // Automatic Fade-In (2.5s), Fade-Out (3.0s) & Voice-Priority Ducking (Music NEVER louder than Narrator Voice)
  const effectiveMusicVolumeAtPlayhead = useMemo(() => {
    if (!activeMusicAtPlayhead) return 0;
    const rawBasePct = activeMusicAtPlayhead.volume || masterMusicVolume || 24;
    // Strict ceiling: music can never exceed 42% of narrator's voiceVolume
    const maxAllowedByVoice = Math.max(12, Math.min(45, Math.round(voiceVolume * 0.42)));
    const duckedPct = Math.min(Math.max(rawBasePct, 20), 24, Math.round(voiceVolume * 0.25));
    const pausePct = Math.min(Math.max(rawBasePct, 30), maxAllowedByVoice);
    const targetBasePct = autoDuckingEnabled
      ? isNarratorSpeakingAtPlayhead
        ? duckedPct
        : pausePct
      : Math.min(rawBasePct, maxAllowedByVoice);

    const fadeInSec = activeMusicAtPlayhead.fadeInSec ?? 2.5;
    const fadeOutSec = activeMusicAtPlayhead.fadeOutSec ?? 3.0;
    const elapsedInTrack = Math.max(0, currentTime - activeMusicAtPlayhead.start);
    const remainingInTrack = Math.max(
      0,
      activeMusicAtPlayhead.start + activeMusicAtPlayhead.duration - currentTime
    );
    const fadeInFactor =
      fadeInSec > 0 ? 0.28 + 0.72 * Math.min(1, elapsedInTrack / fadeInSec) : 1;
    const fadeOutFactor = fadeOutSec > 0 ? Math.min(1, remainingInTrack / fadeOutSec) : 1;
    const fadeEnvelope = Math.max(0, Math.min(fadeInFactor, fadeOutFactor));

    return Number(Math.min(maxAllowedByVoice, targetBasePct * fadeEnvelope).toFixed(2));
  }, [
    activeMusicAtPlayhead,
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

  // Compute safe playback rate and clamped offset for a clip's <video> so shorter MP4 clips fit their slot smoothly and never hit vid.ended -> restart at 00:00
  const computeClipVideoSyncParams = (
    vid: HTMLVideoElement,
    clip: { start: number; duration: number; speed: number; trimStart: number },
    timelineSec: number
  ) => {
    const trimStart = clip.trimStart || 0;
    const slotDur = Math.max(0.5, clip.duration || 8);
    const hasKnownVidDur =
      typeof vid.duration === 'number' && Number.isFinite(vid.duration) && vid.duration > 0.25;
    const playableMediaDur = hasKnownVidDur ? Math.max(0.2, vid.duration - trimStart) : slotDur;

    // If user kept default speed (1x) and the MP4 file is slightly shorter than the timeline slot (e.g. 6s in 8s slot, or 7.2s-9.8s in 10s slot),
    // automatically adjust playbackRate so the video plays smoothly across the entire timeline slot without ending early or restarting
    const effectiveRate =
      clip.speed && clip.speed !== 1
        ? clip.speed
        : hasKnownVidDur && playableMediaDur < slotDur - 0.12
        ? Math.max(0.35, Math.min(1.0, Number((playableMediaDur / slotDur).toFixed(3))))
        : 1;

    const rawOffset = Math.max(0, timelineSec - clip.start) * effectiveRate + trimStart;
    const maxSafeOffset = hasKnownVidDur
      ? Math.max(0, vid.duration - 0.08)
      : Math.max(0, rawOffset);
    const clampedOffset = Math.max(0, Math.min(maxSafeOffset, rawOffset));
    const reachedClipMediaEnd = Boolean(hasKnownVidDur && rawOffset >= vid.duration - 0.08);

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

    // 1. Unlock & play preview <video> if active clip has videoUrl
    const vid = previewVideoRef.current;
    if (vid && activeClipAtPlayhead?.videoUrl) {
      try {
        const { effectiveRate, clampedOffset, reachedClipMediaEnd } = computeClipVideoSyncParams(
          vid,
          activeClipAtPlayhead,
          startSec
        );
        activePlayingClipIdRef.current = activeClipAtPlayhead.id;
        appliedVideoSeekVersionRef.current = lastSeekVersionRef.current;
        clipEndedHoldRef.current = reachedClipMediaEnd;
        vid.playbackRate = effectiveRate;
        vid.currentTime = clampedOffset;
        vid.muted = false;
        vid.volume = Math.min(1, Math.max(0, effectiveFoleyVolumeAtPlayhead / 100));
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
        vo.volume = Math.min(1, Math.max(0, voiceVolume / 100));
        if (startSec >= voiceStartOffsetSec) {
          vo.muted = false;
          vo.currentTime = Math.max(0, startSec - voiceStartOffsetSec);
          vo.play().catch(() => {});
        } else {
          // Unlock autoplay permission now so deferred play at voiceStartOffsetSec never gets blocked
          vo.muted = true;
          vo.play()
            .then(() => {
              vo.pause();
              vo.muted = false;
              vo.currentTime = 0;
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
          if (activePlayingMusicIdRef.current !== activeMusicAtPlayhead.id) {
            activePlayingMusicIdRef.current = activeMusicAtPlayhead.id;
            mus.src = activeMusicAtPlayhead.audioUrl;
          }
          mus.muted = false;
          mus.currentTime = Math.max(0, startSec - activeMusicAtPlayhead.start);
          mus.volume = Math.min(1, Math.max(0.05, effectiveMusicVolumeAtPlayhead / 100));
          mus.play().catch(() => {});
        } else if (musicTracks[0]?.audioUrl) {
          // Unlock autoplay permission now so deferred play when the next music track starts is never blocked
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

    // 4. Start subtle Web Audio cinema drone if active clip has no .MP4 video loaded yet
    if (!activeClipAtPlayhead?.videoUrl) {
      setCinemaAmbienceActive(true, effectiveFoleyVolumeAtPlayhead);
    }

    lastSpokenClipIdRef.current = '';
    setIsPlaying(true);
  };

  // True Wall-Clock Playback Loop (performance.now() anchored so currentTime never lags behind hardware <video>)
  useEffect(() => {
    if (!isPlaying) {
      if (playIntervalRef.current) clearInterval(playIntervalRef.current);
      if (previewVideoRef.current) {
        try {
          previewVideoRef.current.pause();
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

    const stepMs = 45;
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

  // Keep the selected clip automatically synchronized with the clip at the real-time playhead
  useEffect(() => {
    if (activeClipAtPlayhead?.id && selectedClipId !== activeClipAtPlayhead.id) {
      setSelectedClipId(activeClipAtPlayhead.id);
    }
  }, [activeClipAtPlayhead?.id, selectedClipId]);

  // Auto-scroll the multitrack timeline horizontally as playback advances so the vertical playhead & active clip stay in view
  useEffect(() => {
    if (!isPlaying || isFitEntireProject || isScrubbingRulerRef.current) return;
    const container = timelineScrollContainerRef.current;
    if (!container) return;
    const trackHeaderOffsetPx = 184; // w-44 (176px) + gap-2 (8px)
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
  }, [currentTime, isPlaying, isFitEntireProject, timelineZoom]);

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

  // Sync preview <video>, voice <audio>, Suno music <audio>, and Ambience fallback WITHOUT seeking backwards during continuous playback
  useEffect(() => {
    currentTimeRef.current = currentTime;
    const vid = previewVideoRef.current;
    if (vid && activeClipAtPlayhead?.videoUrl) {
      const { effectiveRate, clampedOffset, reachedClipMediaEnd } = computeClipVideoSyncParams(
        vid,
        activeClipAtPlayhead,
        currentTime
      );
      const isClipSwitch = activeClipAtPlayhead.id !== activePlayingClipIdRef.current;
      const isManualSeek = appliedVideoSeekVersionRef.current !== lastSeekVersionRef.current;

      if (Math.abs((vid.playbackRate || 1) - effectiveRate) > 0.02) {
        try {
          vid.playbackRate = effectiveRate;
        } catch {}
      }
      vid.muted = false;
      vid.volume = Math.min(1, Math.max(0, effectiveFoleyVolumeAtPlayhead / 100));

      if (isClipSwitch || isManualSeek || !isPlaying) {
        activePlayingClipIdRef.current = activeClipAtPlayhead.id;
        appliedVideoSeekVersionRef.current = lastSeekVersionRef.current;
        clipEndedHoldRef.current = reachedClipMediaEnd;
        if (Math.abs(vid.currentTime - clampedOffset) > 0.08) {
          try {
            vid.currentTime = clampedOffset;
          } catch {}
        }
        if (isPlaying && !reachedClipMediaEnd && vid.paused) {
          vid.play().catch(() => {});
        }
      } else {
        // Continuous playback inside the same clip: NEVER force-seek vid.currentTime (prevents keyframe rewind jumps!)
        const vidDur = vid.duration;
        const isAtEndOfMedia =
          vid.ended ||
          reachedClipMediaEnd ||
          (typeof vidDur === 'number' && Number.isFinite(vidDur) && vidDur > 0.25 && vid.currentTime >= vidDur - 0.08);

        if (isAtEndOfMedia) {
          clipEndedHoldRef.current = true;
          if (!vid.paused) {
            try {
              vid.pause();
            } catch {}
          }
        } else if (!clipEndedHoldRef.current && vid.paused && vid.readyState >= 2) {
          vid.play().catch(() => {});
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
      if (currentTime >= voiceStartOffsetSec) {
        const voTime = Math.max(0, currentTime - voiceStartOffsetSec);
        const isManualVoSeek = appliedVoiceSeekVersionRef.current !== lastSeekVersionRef.current;
        if (isManualVoSeek || !isPlaying || (vo.paused && Math.abs(vo.currentTime - voTime) > 0.35) || Math.abs(vo.currentTime - voTime) > 1.8) {
          appliedVoiceSeekVersionRef.current = lastSeekVersionRef.current;
          try {
            vo.currentTime = voTime;
          } catch {}
        }
        vo.muted = false;
        vo.volume = Math.min(1, Math.max(0, voiceVolume / 100));
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
        const isTrackSwitch = activePlayingMusicIdRef.current !== activeMusicAtPlayhead.id;
        if (isTrackSwitch) {
          activePlayingMusicIdRef.current = activeMusicAtPlayhead.id;
          mus.src = activeMusicAtPlayhead.audioUrl;
        }
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
        }
      } else {
        activePlayingMusicIdRef.current = null;
        if (!mus.paused) {
          mus.pause();
        }
      }
    }
  }, [
    currentTime,
    activeClipAtPlayhead?.id,
    activeClipAtPlayhead?.videoUrl,
    activeMusicAtPlayhead?.id,
    activeMusicAtPlayhead?.audioUrl,
    isPlaying,
    effectiveFoleyVolumeAtPlayhead,
    effectiveMusicVolumeAtPlayhead,
    voiceStartOffsetSec,
    voiceVolume,
    effectiveVoiceoverUrl,
    voiceAudioError,
    masterMusicVolume,
  ]);

  // Drag & Drop Reordering of Clips on Track 3
  const handleMoveClipOrder = (fromIdx: number, toIdx: number) => {
    if (fromIdx < 0 || toIdx < 0 || fromIdx >= timelineClips.length || toIdx >= timelineClips.length)
      return;
    if (fromIdx === toIdx) return;
    const copy = [...timelineClips];
    const [moved] = copy.splice(fromIdx, 1);
    copy.splice(toIdx, 0, moved);
    setTimelineClips(copy);
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
              return `${idx + 1}\n${fmt(c.start)} --> ${fmt(c.end)}\n${c.text}`;
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
                speed: c.speed,
                foleyVolume: c.foleyVolume / 100,
                transition: c.transition,
                videoDataUrl: c.videoUrl && c.videoUrl.startsWith('data:') ? c.videoUrl : '',
              })),
              voiceoverStartSec: voiceStartOffsetSec,
              voiceoverVolume: voiceVolume / 100,
              voiceoverDataUrl:
                activeDoc.masterAudioUrl && activeDoc.masterAudioUrl.startsWith('data:')
                  ? activeDoc.masterAudioUrl
                  : '',
              sunoSilenceGapSec: 15,
              sunoMasterVolume: Math.min(masterMusicVolume, Math.round(voiceVolume * 0.16)) / 100,
              musicTracks: musicTracks.map((mt) => ({
                trackNumber: mt.trackNumber,
                title: mt.title,
                startSec: mt.start,
                durationSec: mt.duration,
                fadeInSec: mt.fadeInSec ?? 2.5,
                fadeOutSec: mt.fadeOutSec ?? 3.0,
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
            const cAnim = computeElementAnimationState(
              simTime,
              clip.start,
              clip.end,
              clipAnimIn,
              clipAnimDur,
              clipAnimOut,
              clipAnimDur
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

        // 4. Clip 1 Hook Text (First 8s) with Independent Line 1 (0s-8s) & Line 2 (2s-8s) Animations
        if (simTime <= clip1OverlayEndSec && (clip1Line1 || clip1Line2)) {
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

          const line1Rows = (clip1Line1 || '').split('\n');
          const line2Rows = (clip1Line2 || '').split('\n');
          const totalH1 = clip1Line1 ? line1Rows.length * Math.round(f1 * 1.25) : 0;
          const totalH2 = clip1Line2 ? line2Rows.length * Math.round(f2 * 1.25) : 0;

          if ((hookBgStyle === 'semi' || hookBgStyle === 'solid') && (l1Anim.visible || l2Anim.visible)) {
            ctx.save();
            ctx.globalAlpha = Math.max(l1Anim.opacity, l2Anim.opacity);
            ctx.fillStyle = hexToRgba(
              hookBgColor,
              hookBgStyle === 'solid' ? 95 : hookBgOpacity
            );
            const boxW = Math.round(width * (hookBoxWidthPct / 100));
            const boxH = Math.round(totalH1 + totalH2 + f1 * 0.9);
            ctx.fillRect(
              Math.round(xCenter - boxW / 2),
              Math.round(yCenter - (totalH1 + totalH2) / 2 - f1 * 0.4),
              boxW,
              boxH
            );
            ctx.restore();
          }

          let cursorY = Math.round(yCenter - (totalH1 + totalH2) / 2 + f1 * 0.65);
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
              let rowY1 = cursorY;
              for (const rowText of line1Rows) {
                if (hookBgStyle === 'word_shadow' && rowText.trim()) {
                  ctx.save();
                  const m1 = ctx.measureText(rowText);
                  const padX1 = Math.round(f1 * 0.45);
                  const padY1 = Math.round(f1 * 0.22);
                  const w1 = Math.min(width * 0.94, m1.width + padX1 * 2);
                  const h1 = f1 + padY1 * 2;
                  ctx.fillStyle = hexToRgba(hookBgColor, hookBgOpacity);
                  ctx.shadowColor = hexToRgba(hookBgColor, Math.min(95, hookBgOpacity + 20));
                  ctx.shadowBlur = Math.round(f1 * 0.55);
                  ctx.beginPath();
                  ctx.roundRect(
                    Math.round(xCenter - w1 / 2),
                    Math.round(rowY1 - f1 * 0.88 - padY1),
                    Math.round(w1),
                    Math.round(h1),
                    Math.round(f1 * 0.25)
                  );
                  ctx.fill();
                  ctx.restore();
                }
                if (hookShadowStyle !== 'none') {
                  ctx.shadowColor =
                    hookShadowStyle === 'gold_glow' ? 'rgba(245,158,11,0.85)' : 'rgba(0,0,0,0.95)';
                  ctx.shadowBlur = hookShadowStyle === 'soft' ? 8 : 18;
                  ctx.shadowOffsetY = 4;
                }
                if (hookShadowStyle === 'outline') {
                  ctx.lineWidth = Math.max(3, Math.round(f1 * 0.16));
                  ctx.strokeStyle = '#000000';
                  ctx.strokeText(rowText, xCenter, rowY1);
                }
                ctx.fillStyle = hookLine1Color;
                ctx.fillText(rowText, xCenter, rowY1);
                rowY1 += Math.round(f1 * 1.25);
              }
              ctx.restore();
            }
            cursorY += line1Rows.length * Math.round(f1 * 1.25);
          }
          if (clip1Line2 && l2Anim.visible) {
            if (!clip1Line1) {
              cursorY = Math.round(yCenter - totalH2 / 2 + f2 * 0.75);
            } else {
              cursorY += Math.round(f2 * 0.25);
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
            for (const rowText of line2Rows) {
              if (hookBgStyle === 'word_shadow' && rowText.trim()) {
                ctx.save();
                const m2 = ctx.measureText(rowText);
                const padX2 = Math.round(f2 * 0.45);
                const padY2 = Math.round(f2 * 0.22);
                const w2 = Math.min(width * 0.94, m2.width + padX2 * 2);
                const h2 = f2 + padY2 * 2;
                ctx.fillStyle = hexToRgba(hookBgColor, hookBgOpacity);
                ctx.shadowColor = hexToRgba(hookBgColor, Math.min(95, hookBgOpacity + 20));
                ctx.shadowBlur = Math.round(f2 * 0.55);
                ctx.beginPath();
                ctx.roundRect(
                  Math.round(xCenter - w2 / 2),
                  Math.round(cursorY - f2 * 0.88 - padY2),
                  Math.round(w2),
                  Math.round(h2),
                  Math.round(f2 * 0.25)
                );
                ctx.fill();
                ctx.restore();
              }
              if (hookShadowStyle !== 'none') {
                ctx.shadowColor =
                  hookShadowStyle === 'gold_glow' ? 'rgba(245,158,11,0.85)' : 'rgba(0,0,0,0.95)';
                ctx.shadowBlur = hookShadowStyle === 'soft' ? 8 : 18;
                ctx.shadowOffsetY = 4;
              }
              if (hookShadowStyle === 'outline') {
                ctx.lineWidth = Math.max(4, Math.round(f2 * 0.16));
                ctx.strokeStyle = '#000000';
                ctx.strokeText(rowText, xCenter, cursorY);
              }
              ctx.fillStyle = hookLine2Color;
              ctx.fillText(rowText, xCenter, cursorY);
              cursorY += Math.round(f2 * 1.25);
            }
            ctx.restore();
          }
          ctx.restore();
        }

        // 5. Active Caption (.SRT) with Custom Font, Size, Color, Shadow, Background & Animation
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
            const capFontPx = Math.round(captionFontSize * scaleRatio);
            ctx.font = `800 ${capFontPx}px ${captionFontFamily}`;
            ctx.textAlign = 'center';
            const yPos = Math.round(height * (1 - captionBottomPct / 100));
            ctx.globalAlpha = capAnim.opacity;
            if (capAnim.blurPx > 0.1) ctx.filter = `blur(${capAnim.blurPx.toFixed(1)}px)`;
            ctx.translate(
              width / 2 + capAnim.translateX * scaleRatio,
              yPos + capAnim.translateY * scaleRatio
            );
            ctx.scale(capAnim.scale, capAnim.scale);
            ctx.translate(-width / 2, -yPos);

            if (captionBgStyle !== 'none') {
              const textMetrics = ctx.measureText(cap.text);
              const padX = Math.round(capFontPx * 0.8);
              const padY = Math.round(capFontPx * 0.45);
              const boxW = Math.min(width * 0.9, textMetrics.width + padX * 2);
              const boxH = capFontPx + padY * 2;
              ctx.fillStyle = hexToRgba(
                captionBgColor,
                captionBgStyle === 'solid' ? 95 : captionBgOpacity
              );
              ctx.fillRect(
                Math.round((width - boxW) / 2),
                Math.round(yPos - capFontPx - padY * 0.5),
                Math.round(boxW),
                Math.round(boxH)
              );
            }

            if (captionShadowStyle === 'outline') {
              ctx.lineWidth = Math.max(4, Math.round(capFontPx * 0.18));
              ctx.strokeStyle = '#000000';
              ctx.strokeText(cap.text, width / 2, yPos);
            } else if (captionShadowStyle !== 'none') {
              ctx.shadowColor =
                captionShadowStyle === 'gold_glow' ? 'rgba(245,158,11,0.85)' : 'rgba(0,0,0,0.95)';
              ctx.shadowBlur = captionShadowStyle === 'soft' ? 6 : 14;
              ctx.shadowOffsetY = 3;
            }

            ctx.fillStyle =
              captionColor === 'amber'
                ? '#fde047'
                : captionColor === 'custom'
                ? captionCustomColor
                : '#ffffff';
            ctx.fillText(cap.text, width / 2, yPos);
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

  const selectedClip = timelineClips.find((c) => c.id === selectedClipId) || timelineClips[0] || null;
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
  const liveClipAnim = activeClipAtPlayhead
    ? computeElementAnimationState(
        currentTime,
        activeClipAtPlayhead.start,
        activeClipAtPlayhead.end,
        clipAnimIn,
        clipAnimDur,
        clipAnimOut,
        clipAnimDur
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

  return (
    <div className="flex-1 flex flex-col bg-[#0c0a08] text-slate-100 min-h-0">
      {/* Hidden audio elements for Voiceover (Track 4) and Suno Music (Track 5) */}
      {effectiveVoiceoverUrl && (
        <audio
          ref={voiceAudioRef}
          src={effectiveVoiceoverUrl}
          preload="auto"
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
        src={activeMusicAtPlayhead?.audioUrl || musicTracks[0]?.audioUrl || undefined}
        preload="auto"
      />

      {/* =====================================================================
          TOP BAR: PROJECT SELECTOR, ASPECT RATIO (16:9 / 9:16), QUALITY (HD/2K/4K/8K) & EXPORT
      ===================================================================== */}
      <div className="bg-[#14110d] border-b border-amber-500/25 px-4 py-2.5 flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3 flex-wrap">
          <div className="flex items-center gap-2">
            <span className="px-2.5 py-1 rounded-lg bg-amber-500 text-slate-950 font-black text-xs flex items-center gap-1.5">
              <Film className="w-3.5 h-3.5" />
              EDITOR DE VIDEO
            </span>
            {documentaries.length > 0 && onSelectDoc ? (
              <select
                value={activeDoc?.id || ''}
                onChange={(e) => {
                  setIsPlaying(false);
                  setCurrentTime(0);
                  onSelectDoc(e.target.value);
                }}
                className="bg-slate-950 border border-amber-500/40 rounded-lg px-2.5 py-1 text-xs font-bold text-amber-200 max-w-[300px] cursor-pointer outline-none"
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
              <span className="text-sm font-bold text-amber-200 truncate max-w-[260px]">
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
            className="px-2.5 py-1 rounded-lg bg-slate-800 hover:bg-slate-700 border border-slate-700 text-xs text-amber-300 font-semibold flex items-center gap-1.5 cursor-pointer"
            title="Sincronizar clips, voz narrativa, texto del Clip 1, captions, música de Suno y videos .MP4 desde tu carpeta"
          >
            <RefreshCw className="w-3.5 h-3.5" />
            Sincronizar Todo + Carpeta
          </button>

          {(activeDoc?.clips || []).some((c) => c.reviewedForEditor) && (
            <div className="flex items-center bg-slate-950 border border-emerald-500/40 rounded-xl p-0.5 text-xs">
              <button
                type="button"
                onClick={() => setShowOnlyReviewedClips(true)}
                className={`px-2.5 py-1 rounded-lg font-black cursor-pointer transition ${
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
                className={`px-2.5 py-1 rounded-lg font-bold cursor-pointer transition ${
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
        <div className="flex items-center gap-2 flex-wrap">
          {/* Aspect Ratio Selector */}
          <div className="flex items-center bg-slate-950 border border-slate-800 rounded-xl p-0.5">
            <button
              type="button"
              onClick={() => setAspectRatio('16:9')}
              className={`px-2.5 py-1 rounded-lg text-xs font-bold transition cursor-pointer ${
                aspectRatio === '16:9'
                  ? 'bg-amber-500 text-slate-950'
                  : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              📺 16:9 (Horizontal)
            </button>
            <button
              type="button"
              onClick={() => setAspectRatio('9:16')}
              className={`px-2.5 py-1 rounded-lg text-xs font-bold transition cursor-pointer ${
                aspectRatio === '9:16'
                  ? 'bg-amber-500 text-slate-950'
                  : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              📱 9:16 (Vertical)
            </button>
          </div>

          {/* Quality / Resolution Selector: HD, 2K, 4K, 8K */}
          <div className="flex items-center bg-slate-950 border border-slate-800 rounded-xl p-0.5">
            {(['HD_1080P', '2K_1440P', '4K_2160P', '8K_4320P'] as ExportResolutionPreset[]).map(
              (resKey) => {
                const p = RESOLUTION_PRESETS[resKey];
                const isSel = exportResolution === resKey;
                return (
                  <button
                    key={resKey}
                    type="button"
                    onClick={() => setExportResolution(resKey)}
                    className={`px-2.5 py-1 rounded-lg text-xs font-black transition cursor-pointer ${
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
              className="px-3 py-1.5 rounded-xl text-xs font-bold flex items-center gap-1.5 border bg-emerald-950/60 hover:bg-emerald-900/70 border-emerald-500/40 text-emerald-300 cursor-pointer"
              title="Haz clic para recargar los videos .MP4 de 05_Clips_Video y audios de 02_Audio"
            >
              <FolderOpen className="w-3.5 h-3.5 text-emerald-400" />
              ✓ Carpeta: {downloadFolderName}
            </button>
          ) : (
            <button
              type="button"
              onClick={onPickDownloadFolder}
              className="px-3 py-1.5 rounded-xl text-xs font-bold flex items-center gap-1.5 border cursor-pointer bg-slate-900 border-amber-500/40 text-amber-300 hover:bg-slate-800"
            >
              <FolderOpen className="w-3.5 h-3.5" />
              📂 Elegir Carpeta
            </button>
          )}

          {/* Export Organized Final YouTube/Reels Package */}
          {onExportOrganizedFolder && (
            <button
              type="button"
              onClick={onExportOrganizedFolder}
              className="px-3 py-1.5 rounded-xl bg-purple-500/20 hover:bg-purple-500/30 border border-purple-500/40 text-purple-200 font-bold text-xs flex items-center gap-1.5 cursor-pointer"
              title="Genera en tu carpeta la estructura completa lista para YouTube: /Clips_Aprobados, /Audio, /Miniaturas, Subtitulos.srt y SEO_YouTube_Copiar_Pegar.txt"
            >
              📦 Carpeta Final YouTube
            </button>
          )}

          {/* Single Unified Download Video Button (Includes Rendering + Requires Official Logo) */}
          <button
            type="button"
            disabled={isRenderingVideo}
            onClick={handleExportMasterVideo}
            className={`px-4 py-1.5 rounded-xl font-black text-xs flex items-center gap-1.5 cursor-pointer shadow-lg transition ${
              officialLogoUrl
                ? 'bg-amber-500 hover:bg-amber-400 disabled:opacity-50 text-slate-950 shadow-amber-500/20'
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
              ? `Renderizando y Descargando ${renderProgressPct}%...`
              : !officialLogoUrl
              ? '🔒 Subir Logo Oficial para Descargar Video'
              : `🎬 Descargar Video ${activePreset.badge} (${aspectRatio})`}
          </button>
        </div>
      </div>

      {statusMessage && (
        <div className="bg-emerald-950/70 border-b border-emerald-500/30 px-4 py-1.5 text-xs text-emerald-200 flex items-center justify-between">
          <span>{statusMessage}</span>
          <button
            type="button"
            onClick={() => setStatusMessage('')}
            className="text-emerald-400 hover:text-white cursor-pointer"
          >
            ✕
          </button>
        </div>
      )}

      {/* =====================================================================
          UPPER WORKSPACE: STAGE-8 STYLE VIDEO VIEWER (LEFT/CENTER) + INSPECTOR (RIGHT)
      ===================================================================== */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-4 p-3 bg-[#100d0a] border-b border-slate-800/90">
        {/* PREVIEW MONITOR (8 COLS — STAGE-8 STYLE FULL-WIDTH HORIZONTAL VIEWER) */}
        <div className="lg:col-span-8 flex flex-col justify-between bg-[#080705] border border-slate-800 rounded-2xl p-3 space-y-2.5">
          {/* Top Viewer Bar + Quick Object Selection Pills */}
          <div className="w-full flex items-center justify-between text-xs text-slate-400 flex-wrap gap-2">
            <div className="flex items-center gap-2 flex-wrap">
              <span className="font-mono text-amber-300 font-bold">
                Visor • {aspectRatio} •{' '}
                {aspectRatio === '16:9'
                  ? `${activePreset.width16x9}×${activePreset.height16x9}`
                  : `${activePreset.width9x16}×${activePreset.height9x16}`}
              </span>
              <div className="flex items-center gap-1 bg-slate-950 border border-slate-800 rounded-lg p-0.5">
                <span className="text-[10px] text-slate-400 px-1.5">Seleccionar en pantalla:</span>
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
                  🔤 Texto en Pantalla
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

            <div className="flex items-center gap-2">
              <span
                className={`px-2 py-0.5 rounded text-[10px] font-bold ${
                  effectiveVoiceoverUrl && !voiceAudioError
                    ? 'bg-emerald-500/15 border border-emerald-500/40 text-emerald-300'
                    : 'bg-amber-500/15 border border-amber-500/40 text-amber-300'
                }`}
              >
                {effectiveVoiceoverUrl && !voiceAudioError
                  ? `🎙️ Voz + Captions sincronizados desde 00:${String(Math.floor(voiceStartOffsetSec)).padStart(2, '0')} (${formatTimeMMSS(totalDurationSec)})`
                  : '🔇 Sin Audio de Voz'}
              </span>
            </div>
          </div>

          {/* Aspect-Ratio Locked Video Container (Zero Side Black Bars) + Bottom Scrubber & Play/Pause Controls */}
          <div
            className={`${
              aspectRatio === '16:9' ? 'w-full' : 'w-full max-w-[380px] mx-auto'
            } rounded-xl overflow-hidden bg-black border border-slate-800 shadow-2xl flex flex-col`}
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
                  return;
                }
                handleTogglePlay();
              }}
              className={`relative w-full bg-black overflow-hidden flex items-center justify-center cursor-pointer select-none ${
                aspectRatio === '16:9' ? 'aspect-video' : 'aspect-[9/16]'
              }`}
              title="Haz clic fuera del elemento seleccionado para deseleccionarlo, o haz clic en el video para Reproducir / Pausar"
            >
              {/* Layer 1: Active Clip Video, Animated Ken Burns Poster, or Cinematic Storyboard */}
              {activeClipAtPlayhead?.videoUrl ? (
                <video
                  ref={previewVideoRef}
                  src={activeClipAtPlayhead.videoUrl}
                  className="w-full h-full object-cover block bg-black"
                  style={{
                    opacity: liveClipAnim.opacity,
                    transform: `translate3d(${liveClipAnim.translateX}px, ${liveClipAnim.translateY}px, 0) scale(${liveClipAnim.scale})`,
                    filter: liveClipAnim.blurPx > 0.1 ? `blur(${liveClipAnim.blurPx.toFixed(1)}px)` : undefined,
                  }}
                  playsInline
                  preload="auto"
                  onLoadedMetadata={(e) => {
                    const vid = e.currentTarget;
                    try {
                      const { effectiveRate, clampedOffset, reachedClipMediaEnd } =
                        computeClipVideoSyncParams(
                          vid,
                          activeClipAtPlayhead,
                          currentTimeRef.current
                        );
                      activePlayingClipIdRef.current = activeClipAtPlayhead.id;
                      appliedVideoSeekVersionRef.current = lastSeekVersionRef.current;
                      clipEndedHoldRef.current = reachedClipMediaEnd;
                      vid.playbackRate = effectiveRate;
                      vid.currentTime = clampedOffset;
                      vid.muted = false;
                      vid.volume = Math.min(1, Math.max(0, effectiveFoleyVolumeAtPlayhead / 100));
                      if (isPlaying && !reachedClipMediaEnd) {
                        vid.play().catch(() => {});
                      }
                    } catch {}
                  }}
                  onEnded={(e) => {
                    clipEndedHoldRef.current = true;
                    try {
                      e.currentTarget.pause();
                    } catch {}
                  }}
                  onError={() => {
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
              ) : activeClipAtPlayhead?.posterUrl ? (
                <div
                  className="w-full h-full overflow-hidden relative bg-black"
                  style={{
                    opacity: liveClipAnim.opacity,
                    transform: `translate3d(${liveClipAnim.translateX}px, ${liveClipAnim.translateY}px, 0) scale(${liveClipAnim.scale})`,
                    filter: liveClipAnim.blurPx > 0.1 ? `blur(${liveClipAnim.blurPx.toFixed(1)}px)` : undefined,
                  }}
                >
                  <img
                    src={activeClipAtPlayhead.posterUrl}
                    alt={activeClipAtPlayhead.fileName}
                    className="w-full h-full object-cover block transition-transform duration-150 ease-linear"
                    style={{
                      transform: `scale(${kenBurnsScale}) translateX(${kenBurnsPanX}%)`,
                    }}
                  />
                  <div className="absolute inset-0 bg-gradient-to-t from-black/75 via-transparent to-black/35 pointer-events-none" />
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

              {/* Layer 2: Permanent Official Logo (Selectable directly on the Video Viewer, with End Fade-Out) */}
              <div
                onMouseDown={(e) => e.stopPropagation()}
                onClick={(e) => {
                  e.stopPropagation();
                  setSelectedCanvasObject('logo');
                  setActiveInspectorTab('branding');
                }}
                className={`absolute z-20 flex flex-col items-start cursor-pointer transition rounded-lg p-1 ${
                  selectedCanvasObject === 'logo'
                    ? 'ring-2 ring-amber-400 bg-amber-500/15 shadow-lg'
                    : 'hover:ring-1 hover:ring-amber-400/60'
                }`}
                style={{
                  top: `${logoPosY}%`,
                  left: `${logoPosX}%`,
                  width: `${logoScalePct}%`,
                  minWidth: '46px',
                  opacity:
                    selectedCanvasObject === 'logo' && !isPlaying
                      ? logoOpacity / 100
                      : (logoOpacity / 100) * liveLogoAnim.opacity,
                  transform: `translate3d(${liveLogoAnim.translateX}px, ${liveLogoAnim.translateY}px, 0) scale(${liveLogoAnim.scale})`,
                  filter: liveLogoAnim.blurPx > 0.1 ? `blur(${liveLogoAnim.blurPx.toFixed(1)}px)` : undefined,
                }}
                title="Haz clic para seleccionar y ajustar el Logo Oficial (Por defecto: Fade Out 1s al final del documental)"
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
                {selectedCanvasObject === 'logo' && (
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

              {/* Layer 3: Clip 1 Hook Text Overlay (100% Real-Time WYSIWYG — never changes appearance when selected!) */}
              {(currentTime <= clip1OverlayEndSec || selectedCanvasObject === 'hook_text') &&
                (clip1Line1 || clip1Line2 || selectedCanvasObject === 'hook_text') && (
                  <div
                    onMouseDown={handleStartHookBoxDrag}
                    onClick={(e) => {
                      e.stopPropagation();
                      setSelectedCanvasObject('hook_text');
                      setActiveInspectorTab('branding');
                    }}
                    className="group absolute z-20 text-center cursor-move rounded-xl p-2.5"
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
                    title="Mantén presionado y arrastra para mover por todo el video, o jala de las esquinas para alargar/achicar la caja de texto"
                  >
                    {/* Subtle Corner & Side Resize Handles (only visible when hovering directly over the text box) */}
                    {selectedCanvasObject === 'hook_text' && (
                      <div className="opacity-0 group-hover:opacity-100 transition-opacity">
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
                            !isPlaying && (selectedCanvasObject === 'hook_text' || currentTime === 0)
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
                            !isPlaying && (selectedCanvasObject === 'hook_text' || currentTime === 0)
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

              {/* Layer 4: Dynamic Captions (.SRT) — 100% Real-Time WYSIWYG (never changes appearance when selected!) */}
              {(activeCaptionAtPlayhead ||
                (!isPlaying && selectedCanvasObject === 'captions' && nearestCaptionAtPlayhead)) && (
                <div
                  className="absolute inset-x-4 z-20 text-center pointer-events-none"
                  style={{
                    bottom: `${captionBottomPct}%`,
                    opacity:
                      selectedCanvasObject === 'captions' && !isPlaying ? 1 : liveCaptionAnim.opacity,
                    transform:
                      selectedCanvasObject === 'captions' && !isPlaying
                        ? undefined
                        : `translate3d(${liveCaptionAnim.translateX}px, ${liveCaptionAnim.translateY}px, 0) scale(${liveCaptionAnim.scale})`,
                    filter:
                      selectedCanvasObject === 'captions' && !isPlaying
                        ? undefined
                        : liveCaptionAnim.blurPx > 0.1
                        ? `blur(${liveCaptionAnim.blurPx.toFixed(1)}px)`
                        : undefined,
                  }}
                >
                  <span
                    onMouseDown={(e) => e.stopPropagation()}
                    onClick={(e) => {
                      e.stopPropagation();
                      setSelectedCanvasObject('captions');
                      setActiveInspectorTab('captions');
                    }}
                    title="Haz clic para seleccionar los Captions y ver tus cambios de estilo en tiempo real"
                    className={`pointer-events-auto cursor-pointer ${
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
                    {activeCaptionAtPlayhead?.text || nearestCaptionAtPlayhead?.text || ''}
                  </span>
                </div>
              )}

              {/* Bottom-Left Live Audio Ducking Indicator */}
              <div className="absolute bottom-2 left-2.5 flex items-center gap-1.5 pointer-events-none">
                <span className="px-2 py-0.5 rounded bg-black/75 text-[10px] font-mono text-slate-300">
                  Foley: {effectiveFoleyVolumeAtPlayhead}%{' '}
                  {isNarratorSpeakingAtPlayhead ? '(Auto-Ducking Voz 🎙️)' : '(Ambiente Alto 🔊)'}
                </span>
              </div>
            </div>

            {/* Stage-8 Style Integrated Bottom Player Bar: Play/Pause, Scrubber Timeline & Timecode */}
            <div className="w-full bg-[#110e0b] border-t border-slate-800 px-3.5 py-2.5 flex items-center gap-3">
              <button
                type="button"
                onClick={() => seekToTime(0)}
                className="p-1.5 rounded-lg bg-slate-900 hover:bg-slate-800 text-slate-300 cursor-pointer shrink-0"
                title="Ir al inicio (00:00)"
              >
                <SkipBack className="w-4 h-4" />
              </button>
              <button
                type="button"
                onClick={handleTogglePlay}
                className="px-3.5 py-1.5 rounded-lg bg-amber-500 hover:bg-amber-400 text-slate-950 font-black text-xs flex items-center gap-1.5 cursor-pointer shadow shrink-0"
                title={isPlaying ? 'Pausar reproducción' : 'Reproducir video y voz narrativa'}
              >
                {isPlaying ? <Pause className="w-4 h-4" /> : <Play className="w-4 h-4" />}
                <span>{isPlaying ? 'Pausa' : 'Play'}</span>
              </button>
              <button
                type="button"
                onClick={() => seekToTime(voiceStartOffsetSec)}
                className="px-2 py-1 rounded-lg bg-emerald-950/80 hover:bg-emerald-900/80 border border-emerald-500/40 text-emerald-300 font-mono text-[10px] font-bold cursor-pointer shrink-0"
                title={`Ir al segundo ${voiceStartOffsetSec}s donde entra la Voz Narrativa`}
              >
                🎙️ 00:{String(Math.floor(voiceStartOffsetSec)).padStart(2, '0')}
              </button>

              {/* Full-Width Stage-8 Style Timeline Scrubber */}
              <div className="flex-1 flex items-center gap-2 min-w-0">
                <input
                  type="range"
                  min={0}
                  max={totalDurationSec}
                  step={0.05}
                  value={currentTime}
                  onChange={(e) => seekToTime(Number(e.target.value))}
                  className="w-full h-2 accent-amber-500 cursor-pointer"
                />
              </div>

              <span className="font-mono text-xs text-emerald-300 font-bold shrink-0">
                {formatTimeMMSS(currentTime)} / {formatTimeMMSS(totalDurationSec)}
              </span>

              <button
                type="button"
                onClick={() => seekToTime(Math.max(0, totalDurationSec - 1))}
                className="p-1.5 rounded-lg bg-slate-900 hover:bg-slate-800 text-slate-300 cursor-pointer shrink-0"
                title="Ir al final"
              >
                <SkipForward className="w-4 h-4" />
              </button>
            </div>
          </div>

          {/* Contextual Quick-Edit Toolbar when an Overlay Object (Logo, Hook Text, or Captions) is Selected */}
          {selectedCanvasObject === 'hook_text' && (
            <div className="w-full bg-slate-950/95 border border-amber-500/40 rounded-xl p-2.5 flex flex-wrap items-center gap-2.5 text-xs">
              <span className="font-black text-amber-300 text-[11px]">
                🔤 Estilo Texto en Pantalla:
              </span>
              <input
                type="text"
                value={clip1Line1}
                onChange={(e) => setClip1Line1(e.target.value)}
                placeholder="Línea 1: Lugar y Año..."
                className="w-44 bg-slate-900 border border-slate-700 rounded-lg px-2 py-1 text-[11px] text-amber-200 outline-none focus:border-amber-400"
                title="Texto Línea 1 (en vivo en el visor)"
              />
              <input
                type="text"
                value={clip1Line2}
                onChange={(e) => setClip1Line2(e.target.value)}
                placeholder="Línea 2: Título Gancho..."
                className="w-48 bg-slate-900 border border-slate-700 rounded-lg px-2 py-1 text-[11px] text-white outline-none focus:border-amber-400"
                title="Texto Línea 2 (en vivo en el visor)"
              />
              {(hookLeftPct !== 50 || hookTopPct !== 50) && (
                <button
                  type="button"
                  onClick={() => {
                    setHookLeftPct(50);
                    setHookTopPct(50);
                  }}
                  className="px-2 py-1 rounded-lg bg-slate-900 hover:bg-slate-800 text-amber-300 border border-amber-400/60 text-[11px] font-bold cursor-pointer"
                  title="Centrar exactamente en la cruz central (50% X, 50% Y)"
                >
                  🎯 Centrar
                </button>
              )}
              <select
                value={hookFontFamily}
                onChange={(e) => setHookFontFamily(e.target.value)}
                className="bg-slate-900 border border-slate-700 rounded-lg px-2 py-1 text-[11px] text-amber-200 cursor-pointer"
                title="Fuente tipográfica"
              >
                {EDITOR_FONT_OPTIONS.map((f) => (
                  <option key={f.value} value={f.value}>
                    {f.label}
                  </option>
                ))}
              </select>
              <label className="flex items-center gap-1 text-[11px] text-slate-300">
                L1:
                <input
                  type="number"
                  min={10}
                  max={42}
                  value={hookLine1FontSize}
                  onChange={(e) => setHookLine1FontSize(Number(e.target.value))}
                  className="w-12 bg-slate-900 border border-slate-700 rounded px-1.5 py-0.5 text-[11px] text-white"
                />
                <input
                  type="color"
                  value={hookLine1Color}
                  onChange={(e) => setHookLine1Color(e.target.value)}
                  className="w-5 h-5 rounded cursor-pointer border-0 bg-transparent"
                  title="Color Línea 1"
                />
              </label>
              <label className="flex items-center gap-1 text-[11px] text-slate-300">
                L2:
                <input
                  type="number"
                  min={14}
                  max={56}
                  value={hookLine2FontSize}
                  onChange={(e) => setHookLine2FontSize(Number(e.target.value))}
                  className="w-12 bg-slate-900 border border-slate-700 rounded px-1.5 py-0.5 text-[11px] text-white"
                />
                <input
                  type="color"
                  value={hookLine2Color}
                  onChange={(e) => setHookLine2Color(e.target.value)}
                  className="w-5 h-5 rounded cursor-pointer border-0 bg-transparent"
                  title="Color Línea 2"
                />
              </label>
              <select
                value={hookShadowStyle}
                onChange={(e) => setHookShadowStyle(e.target.value as OverlayShadowStyle)}
                className="bg-slate-900 border border-slate-700 rounded-lg px-2 py-1 text-[11px] text-slate-200 cursor-pointer"
                title="Sombra del texto"
              >
                {EDITOR_SHADOW_OPTIONS.map((s) => (
                  <option key={s.value} value={s.value}>
                    {s.label}
                  </option>
                ))}
              </select>
              <select
                value={hookBgStyle}
                onChange={(e) => setHookBgStyle(e.target.value as OverlayBgStyle)}
                className="bg-slate-900 border border-slate-700 rounded-lg px-2 py-1 text-[11px] text-slate-200 cursor-pointer"
                title="Fondo del texto"
              >
                <option value="none">Fondo: Transparente</option>
                <option value="word_shadow">Fondo: Sombra Ceñida a las Palabras</option>
                <option value="semi">Fondo: Caja Semitransparente</option>
                <option value="solid">Fondo: Caja Sólida</option>
              </select>
              {hookBgStyle !== 'none' && (
                <label className="flex items-center gap-1 text-[11px] text-slate-300">
                  <input
                    type="color"
                    value={hookBgColor}
                    onChange={(e) => setHookBgColor(e.target.value)}
                    className="w-5 h-5 rounded cursor-pointer border-0 bg-transparent"
                    title="Color de fondo"
                  />
                  <span>{hookBgOpacity}%</span>
                  <input
                    type="range"
                    min={10}
                    max={100}
                    value={hookBgOpacity}
                    onChange={(e) => setHookBgOpacity(Number(e.target.value))}
                    className="w-16 accent-amber-500"
                  />
                </label>
              )}
              <label className="flex items-center gap-1 text-[11px] text-slate-300">
                Posición Y:
                <input
                  type="range"
                  min={8}
                  max={82}
                  value={hookTopPct}
                  onChange={(e) => setHookTopPct(Number(e.target.value))}
                  className="w-16 accent-amber-500"
                />
              </label>
              <label className="flex items-center gap-1 text-[11px] text-amber-200 font-semibold">
                ✨ Animación L1 ({hookLine1StartSec}s):
                <select
                  value={hookLine1AnimIn}
                  onChange={(e) => setHookLine1AnimIn(e.target.value as ElementAnimationType)}
                  className="bg-slate-900 border border-slate-700 rounded px-1.5 py-0.5 text-[11px] text-amber-200"
                  title="Animación de entrada Línea 1 (Por defecto: Fade 1s en 0s)"
                >
                  {ELEMENT_ANIMATION_OPTIONS.map((a) => (
                    <option key={a.value} value={a.value}>
                      In: {a.label}
                    </option>
                  ))}
                </select>
              </label>
              <label className="flex items-center gap-1 text-[11px] text-amber-200 font-semibold">
                ✨ Animación L2 ({hookLine2StartSec}s):
                <select
                  value={hookLine2AnimIn}
                  onChange={(e) => setHookLine2AnimIn(e.target.value as ElementAnimationType)}
                  className="bg-slate-900 border border-slate-700 rounded px-1.5 py-0.5 text-[11px] text-amber-200"
                  title="Animación de entrada Línea 2 (Por defecto: aparece en 2s con Fade 1s)"
                >
                  {ELEMENT_ANIMATION_OPTIONS.map((a) => (
                    <option key={a.value} value={a.value}>
                      In: {a.label}
                    </option>
                  ))}
                </select>
              </label>
              <label className="flex items-center gap-1 text-[11px] text-amber-200 font-semibold">
                Salida (→{clip1OverlayEndSec}s):
                <select
                  value={hookLine1AnimOut}
                  onChange={(e) => {
                    const val = e.target.value as ElementAnimationType;
                    setHookLine1AnimOut(val);
                    setHookLine2AnimOut(val);
                  }}
                  className="bg-slate-900 border border-slate-700 rounded px-1.5 py-0.5 text-[11px] text-amber-200"
                  title="Animación de salida de ambas líneas hacia el segundo 8 (Por defecto: Fade Out 1s)"
                >
                  {ELEMENT_ANIMATION_OPTIONS.map((a) => (
                    <option key={a.value} value={a.value}>
                      Out: {a.label}
                    </option>
                  ))}
                </select>
              </label>
            </div>
          )}

          {selectedCanvasObject === 'captions' && (
            <div className="w-full bg-slate-950/95 border border-sky-500/40 rounded-xl p-2.5 flex flex-wrap items-center gap-2.5 text-xs">
              <span className="font-black text-sky-300 text-[11px]">
                💬 Estilo Captions:
              </span>
              {(activeCaptionAtPlayhead || nearestCaptionAtPlayhead) && (
                <input
                  type="text"
                  value={(activeCaptionAtPlayhead || nearestCaptionAtPlayhead)!.text}
                  onChange={(e) => {
                    const targetCap = activeCaptionAtPlayhead || nearestCaptionAtPlayhead;
                    if (!targetCap) return;
                    const newText = e.target.value;
                    setCaptions((prev) =>
                      prev.map((c) => (c.id === targetCap.id ? { ...c, text: newText } : c))
                    );
                  }}
                  placeholder="Texto del caption actual..."
                  className="w-56 bg-slate-900 border border-slate-700 rounded-lg px-2 py-1 text-[11px] text-white outline-none focus:border-sky-400"
                  title="Editar texto del caption actual (en vivo en el visor)"
                />
              )}
              <select
                value={captionFontFamily}
                onChange={(e) => setCaptionFontFamily(e.target.value)}
                className="bg-slate-900 border border-slate-700 rounded-lg px-2 py-1 text-[11px] text-sky-200 cursor-pointer"
              >
                {EDITOR_FONT_OPTIONS.map((f) => (
                  <option key={f.value} value={f.value}>
                    {f.label}
                  </option>
                ))}
              </select>
              <label className="flex items-center gap-1 text-[11px] text-slate-300">
                Tamaño ({captionFontSize}px):
                <input
                  type="range"
                  min={14}
                  max={40}
                  value={captionFontSize}
                  onChange={(e) => setCaptionFontSize(Number(e.target.value))}
                  className="w-16 accent-sky-400"
                />
              </label>
              <select
                value={captionColor}
                onChange={(e) => setCaptionColor(e.target.value as 'white' | 'amber' | 'custom')}
                className="bg-slate-900 border border-slate-700 rounded-lg px-2 py-1 text-[11px] text-white cursor-pointer"
              >
                <option value="white">Texto Blanco</option>
                <option value="amber">Texto Ámbar</option>
                <option value="custom">Color Personalizado</option>
              </select>
              {captionColor === 'custom' && (
                <input
                  type="color"
                  value={captionCustomColor}
                  onChange={(e) => setCaptionCustomColor(e.target.value)}
                  className="w-5 h-5 rounded cursor-pointer border-0 bg-transparent"
                />
              )}
              <select
                value={captionShadowStyle}
                onChange={(e) => setCaptionShadowStyle(e.target.value as OverlayShadowStyle)}
                className="bg-slate-900 border border-slate-700 rounded-lg px-2 py-1 text-[11px] text-slate-200 cursor-pointer"
              >
                {EDITOR_SHADOW_OPTIONS.map((s) => (
                  <option key={s.value} value={s.value}>
                    {s.label}
                  </option>
                ))}
              </select>
              <select
                value={captionBgStyle}
                onChange={(e) => setCaptionBgStyle(e.target.value as OverlayBgStyle)}
                className="bg-slate-900 border border-slate-700 rounded-lg px-2 py-1 text-[11px] text-slate-200 cursor-pointer"
              >
                <option value="none">Fondo: Transparente</option>
                <option value="word_shadow">Fondo: Sombra Ceñida a las Palabras</option>
                <option value="semi">Fondo: Caja Semitransparente</option>
                <option value="solid">Fondo: Caja Sólida</option>
              </select>
              {captionBgStyle !== 'none' && (
                <label className="flex items-center gap-1 text-[11px] text-slate-300">
                  <input
                    type="color"
                    value={captionBgColor}
                    onChange={(e) => setCaptionBgColor(e.target.value)}
                    className="w-5 h-5 rounded cursor-pointer border-0 bg-transparent"
                  />
                  <span>{captionBgOpacity}%</span>
                  <input
                    type="range"
                    min={10}
                    max={100}
                    value={captionBgOpacity}
                    onChange={(e) => setCaptionBgOpacity(Number(e.target.value))}
                    className="w-14 accent-sky-400"
                  />
                </label>
              )}
              <label className="flex items-center gap-1 text-[11px] text-slate-300">
                Altura ({captionBottomPct}%):
                <input
                  type="range"
                  min={4}
                  max={50}
                  value={captionBottomPct}
                  onChange={(e) => setCaptionBottomPct(Number(e.target.value))}
                  className="w-16 accent-sky-400"
                />
              </label>
              <label className="flex items-center gap-1 text-[11px] text-sky-200 font-semibold">
                ✨ Animación:
                <select
                  value={captionAnimIn}
                  onChange={(e) => {
                    const val = e.target.value as ElementAnimationType;
                    setCaptionAnimIn(val);
                    setCaptionAnimOut(val);
                  }}
                  className="bg-slate-900 border border-slate-700 rounded px-1.5 py-0.5 text-[11px] text-sky-200"
                >
                  {ELEMENT_ANIMATION_OPTIONS.map((a) => (
                    <option key={a.value} value={a.value}>
                      {a.label}
                    </option>
                  ))}
                </select>
              </label>
            </div>
          )}

          {selectedCanvasObject === 'logo' && (
            <div className="w-full bg-slate-950/95 border border-amber-500/40 rounded-xl p-2.5 flex flex-wrap items-center gap-3 text-xs">
              <span className="font-black text-amber-300 text-[11px]">
                🏷️ Ajuste Rápido del Logo:
              </span>
              <label className="flex items-center gap-1.5 text-[11px] text-slate-300">
                Tamaño ({logoScalePct}%):
                <input
                  type="range"
                  min={3}
                  max={18}
                  value={logoScalePct}
                  onChange={(e) => setLogoScalePct(Number(e.target.value))}
                  className="w-20 accent-amber-500"
                />
              </label>
              <label className="flex items-center gap-1.5 text-[11px] text-slate-300">
                Opacidad ({logoOpacity}%):
                <input
                  type="range"
                  min={20}
                  max={100}
                  value={logoOpacity}
                  onChange={(e) => setLogoOpacity(Number(e.target.value))}
                  className="w-20 accent-amber-500"
                />
              </label>
              <label className="flex items-center gap-1.5 text-[11px] text-slate-300">
                X ({logoPosX}%):
                <input
                  type="range"
                  min={1}
                  max={85}
                  value={logoPosX}
                  onChange={(e) => setLogoPosX(Number(e.target.value))}
                  className="w-16 accent-amber-500"
                />
              </label>
              <label className="flex items-center gap-1.5 text-[11px] text-slate-300">
                Y ({logoPosY}%):
                <input
                  type="range"
                  min={1}
                  max={85}
                  value={logoPosY}
                  onChange={(e) => setLogoPosY(Number(e.target.value))}
                  className="w-16 accent-amber-500"
                />
              </label>
              <label className="flex items-center gap-1 text-[11px] text-amber-200 font-semibold">
                ✨ Entrada:
                <select
                  value={logoAnimIn}
                  onChange={(e) => setLogoAnimIn(e.target.value as ElementAnimationType)}
                  className="bg-slate-900 border border-slate-700 rounded px-1.5 py-0.5 text-[11px] text-amber-200"
                >
                  {ELEMENT_ANIMATION_OPTIONS.map((a) => (
                    <option key={a.value} value={a.value}>
                      {a.label}
                    </option>
                  ))}
                </select>
              </label>
              <label className="flex items-center gap-1 text-[11px] text-amber-200 font-semibold">
                ✨ Salida Final ({logoAnimOutDur}s):
                <select
                  value={logoAnimOut}
                  onChange={(e) => setLogoAnimOut(e.target.value as ElementAnimationType)}
                  className="bg-slate-900 border border-slate-700 rounded px-1.5 py-0.5 text-[11px] text-amber-200"
                  title="Por defecto: Fade Out 1 segundo al final del documental"
                >
                  {ELEMENT_ANIMATION_OPTIONS.map((a) => (
                    <option key={a.value} value={a.value}>
                      {a.label}
                    </option>
                  ))}
                </select>
              </label>
            </div>
          )}
        </div>

        {/* INSPECTOR & CONTROLS PANEL (4 COLS) */}
        <div className="lg:col-span-4 bg-[#14110d] border border-slate-800 rounded-2xl p-4 flex flex-col justify-between space-y-3">
          {/* Inspector Tabs */}
          <div className="grid grid-cols-4 gap-1 bg-slate-950 p-1 rounded-xl border border-slate-800">
            <button
              type="button"
              onClick={() => setActiveInspectorTab('clips')}
              className={`py-1.5 px-2 rounded-lg text-[11px] font-bold cursor-pointer ${
                activeInspectorTab === 'clips'
                  ? 'bg-amber-500 text-slate-950'
                  : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              🎬 Clips / Orden
            </button>
            <button
              type="button"
              onClick={() => setActiveInspectorTab('audio')}
              className={`py-1.5 px-2 rounded-lg text-[11px] font-bold cursor-pointer ${
                activeInspectorTab === 'audio'
                  ? 'bg-amber-500 text-slate-950'
                  : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              🎙️ Voz / Foley / Flow Music
            </button>
            <button
              type="button"
              onClick={() => setActiveInspectorTab('branding')}
              className={`py-1.5 px-2 rounded-lg text-[11px] font-bold cursor-pointer ${
                activeInspectorTab === 'branding'
                  ? 'bg-amber-500 text-slate-950'
                  : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              🏷️ Logo / Clip 1
            </button>
            <button
              type="button"
              onClick={() => setActiveInspectorTab('captions')}
              className={`py-1.5 px-2 rounded-lg text-[11px] font-bold cursor-pointer ${
                activeInspectorTab === 'captions'
                  ? 'bg-amber-500 text-slate-950'
                  : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              💬 Captions .SRT
            </button>
          </div>

          {/* TAB 1: CLIPS, ORDER, SPEED, FOLEY & TRANSITIONS */}
          {activeInspectorTab === 'clips' && (
            <div className="space-y-3 text-xs flex-1 overflow-y-auto pr-1">
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

              {/* Selected Clip Detailed Controls */}
              {selectedClip && (
                <div className="bg-slate-950/90 border border-amber-500/30 rounded-xl p-3 space-y-2.5">
                  <div className="flex items-center justify-between gap-2">
                    <span className="font-black text-amber-300">
                      Editando: CLIP {String(selectedClip.clipNumber).padStart(2, '0')} (
                      {selectedClip.fileName})
                    </span>
                    <div className="flex items-center gap-1">
                      <button
                        type="button"
                        onClick={() => {
                          const idx = timelineClips.findIndex((c) => c.id === selectedClip.id);
                          handleMoveClipOrder(idx, idx - 1);
                        }}
                        className="px-2 py-1 rounded bg-slate-800 hover:bg-slate-700 text-slate-200 text-[11px] cursor-pointer"
                        title="Mover este clip una posición antes"
                      >
                        ⬅️ Mover Antes
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          const idx = timelineClips.findIndex((c) => c.id === selectedClip.id);
                          handleMoveClipOrder(idx, idx + 1);
                        }}
                        className="px-2 py-1 rounded bg-slate-800 hover:bg-slate-700 text-slate-200 text-[11px] cursor-pointer"
                        title="Mover este clip una posición después"
                      >
                        Mover Después ➡️
                      </button>
                    </div>
                  </div>

                  <div className="grid grid-cols-3 gap-2">
                    <div>
                      <label className="block text-[10px] text-slate-400">Duración (s)</label>
                      <input
                        type="number"
                        step={0.5}
                        min={1}
                        max={30}
                        value={selectedClip.duration}
                        onChange={(e) => {
                          const val = Math.max(1, Number(e.target.value));
                          setTimelineClips((prev) =>
                            prev.map((c) =>
                              c.id === selectedClip.id ? { ...c, duration: val } : c
                            )
                          );
                        }}
                        className="w-full bg-slate-900 border border-slate-700 rounded px-2 py-1 text-xs text-white"
                      />
                    </div>
                    <div>
                      <label className="block text-[10px] text-slate-400">Velocidad (x)</label>
                      <input
                        type="number"
                        step={0.05}
                        min={0.25}
                        max={2}
                        value={selectedClip.speed}
                        onChange={(e) => {
                          const val = Math.max(0.25, Number(e.target.value));
                          setTimelineClips((prev) =>
                            prev.map((c) =>
                              c.id === selectedClip.id ? { ...c, speed: val } : c
                            )
                          );
                        }}
                        className="w-full bg-slate-900 border border-slate-700 rounded px-2 py-1 text-xs text-white"
                      />
                    </div>
                    <div>
                      <label className="block text-[10px] text-slate-400">Volumen Foley (%)</label>
                      <input
                        type="number"
                        min={0}
                        max={100}
                        value={selectedClip.foleyVolume}
                        onChange={(e) => {
                          const val = Math.min(100, Math.max(0, Number(e.target.value)));
                          setTimelineClips((prev) =>
                            prev.map((c) =>
                              c.id === selectedClip.id ? { ...c, foleyVolume: val } : c
                            )
                          );
                        }}
                        className="w-full bg-slate-900 border border-slate-700 rounded px-2 py-1 text-xs text-white"
                      />
                    </div>
                  </div>

                  <div className="flex items-center justify-between gap-2 pt-1">
                    <select
                      value={selectedClip.transition}
                      onChange={(e) => {
                        const val = e.target.value as ClipTransitionType;
                        setTimelineClips((prev) =>
                          prev.map((c) =>
                            c.id === selectedClip.id ? { ...c, transition: val } : c
                          )
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
                          setTimelineClips((prev) =>
                            prev.map((c) =>
                              c.id === selectedClip.id
                                ? { ...c, videoUrl: url, fileName: f.name }
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
            <div className="space-y-3 text-xs flex-1 overflow-y-auto pr-1">
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
                  <label className="text-[11px] text-slate-400">Volumen Voz: {voiceVolume}%</label>
                  <input
                    type="range"
                    min={50}
                    max={100}
                    value={voiceVolume}
                    onChange={(e) => setVoiceVolume(Number(e.target.value))}
                    className="flex-1 accent-emerald-500"
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

              <div className="bg-slate-950/90 border border-slate-800 rounded-xl p-3 space-y-2">
                <div className="flex items-center justify-between gap-2">
                  <span className="font-bold text-purple-300">
                    🎵 Pista 5: Música Flow Music (Fade-In 2.5s • Fade-Out 3.0s • Bajo Voz)
                  </span>
                  <span className="font-mono text-purple-200">
                    Base: {masterMusicVolume}% • Actual: {effectiveMusicVolumeAtPlayhead}%
                  </span>
                </div>
                <input
                  type="range"
                  min={0}
                  max={Math.max(15, Math.min(35, Math.round(voiceVolume * 0.3)))}
                  value={Math.min(masterMusicVolume, Math.round(voiceVolume * 0.3))}
                  onChange={(e) =>
                    setMasterMusicVolume(
                      Math.min(Number(e.target.value), Math.round(voiceVolume * 0.3))
                    )
                  }
                  className="w-full accent-purple-500"
                />
                <div className="flex flex-wrap items-center justify-between gap-1 text-[10px] text-purple-300/90">
                  <span>✨ Fade-In 2.5s y Fade-Out 3.0s automáticos en cada pista</span>
                  <span>
                    🎙️ Ducking activo: {isNarratorSpeakingAtPlayhead ? '~14% (Narrador hablando)' : '~22% (Pausa/Intro/Cierre)'} (Voz: {voiceVolume}%)
                  </span>
                </div>
              </div>
            </div>
          )}

          {/* TAB 3: PERMANENT OFFICIAL LOGO & CLIP 1 ON-SCREEN TEXT (FONT, SIZE, SHADOW, BACKGROUND) */}
          {activeInspectorTab === 'branding' && (
            <div className="space-y-3 text-xs flex-1 overflow-y-auto pr-1">
              <div className="bg-slate-950/90 border border-amber-500/40 rounded-xl p-3 space-y-2.5">
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
                </div>

                {/* Logo Animations (Default: Fade Out 1s at the end of the documentary) */}
                <div className="pt-2 border-t border-amber-500/20 space-y-1.5">
                  <div className="flex items-center justify-between">
                    <span className="font-bold text-amber-300 text-[11px]">
                      ✨ Animación del Logo (Por defecto: Fade Out 1s al final)
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

              <div className="bg-slate-950/90 border border-slate-800 rounded-xl p-3 space-y-2.5">
                <div className="flex items-center justify-between gap-2">
                  <div className="font-bold text-amber-300">
                    🔤 Texto Gancho en Pantalla (00:00 - 00:0{clip1OverlayEndSec})
                  </div>
                  <button
                    type="button"
                    onClick={() => setSelectedCanvasObject('hook_text')}
                    className="px-2 py-0.5 rounded bg-amber-500/20 border border-amber-500/40 text-amber-300 text-[10px] font-bold cursor-pointer"
                  >
                    ✏️ Editar en Visor
                  </button>
                </div>
                <textarea
                  rows={Math.max(1, (clip1Line1 || '').split('\n').length)}
                  value={clip1Line1}
                  onChange={(e) => setClip1Line1(e.target.value)}
                  onKeyDown={(e) => e.stopPropagation()}
                  placeholder="Línea 1: Ciudad, País, Año o Siglo en romanos... (Enter para saltar de línea)"
                  className="w-full bg-slate-900 border border-slate-700 rounded-lg px-2.5 py-1.5 text-xs text-amber-200 resize-y leading-tight"
                />
                <textarea
                  rows={Math.max(1, (clip1Line2 || '').split('\n').length)}
                  value={clip1Line2}
                  onChange={(e) => setClip1Line2(e.target.value)}
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
                  <div className="col-span-2">
                    <label className="block text-[10px] text-slate-400">
                      Posición Vertical en Pantalla ({hookTopPct}%)
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
                </div>

                {/* Independent Animations for Hook Line 1 (0s->8s) & Hook Line 2 (2s->8s) */}
                <div className="pt-2 border-t border-slate-800 space-y-2">
                  <div className="flex items-center justify-between gap-2">
                    <span className="font-bold text-amber-300 text-[11px]">
                      ✨ Animaciones del Texto Inicial (Por defecto: L1 en 0s, L2 en 2s, Fade 1s)
                    </span>
                    <button
                      type="button"
                      onClick={() => {
                        setHookLine1StartSec(0);
                        setHookLine1AnimIn('fade');
                        setHookLine1AnimInDur(1);
                        setHookLine1AnimOut('fade');
                        setHookLine1AnimOutDur(1);
                        setHookLine2StartSec(2);
                        setHookLine2AnimIn('fade');
                        setHookLine2AnimInDur(1);
                        setHookLine2AnimOut('fade');
                        setHookLine2AnimOutDur(1);
                        setClip1OverlayEndSec(8);
                      }}
                      className="px-2 py-0.5 rounded bg-slate-900 hover:bg-slate-800 border border-amber-500/40 text-amber-300 text-[10px] font-bold cursor-pointer shrink-0"
                      title="Restaurar configuración por defecto: Fade In 1s (L1 en 0s, L2 en 2s) y Fade Out 1s hacia el segundo 8"
                    >
                      🔄 Por Defecto
                    </button>
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
                          step={0.5}
                          min={0}
                          max={6}
                          value={hookLine1StartSec}
                          onChange={(e) => setHookLine1StartSec(Math.max(0, Number(e.target.value)))}
                          className="w-12 bg-slate-950 border border-slate-700 rounded px-1 py-0.5 text-[10px] text-white"
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
                          step={0.5}
                          min={0}
                          max={6}
                          value={hookLine2StartSec}
                          onChange={(e) => setHookLine2StartSec(Math.max(0, Number(e.target.value)))}
                          className="w-12 bg-slate-950 border border-slate-700 rounded px-1 py-0.5 text-[10px] text-white"
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
            <div className="space-y-3 text-xs flex-1 overflow-y-auto pr-1">
              <div className="flex items-center justify-between gap-2 bg-slate-950/90 border border-slate-800 rounded-xl p-3">
                <div>
                  <div className="font-bold text-emerald-300">
                    💬 Subtítulos Sincronizados ({captions.length} bloques desde 00:{String(Math.floor(voiceStartOffsetSec)).padStart(2, '0')})
                  </div>
                  <div className="text-[11px] text-slate-400">
                    Sincronizados acústicamente con la Voz Narrativa ({formatTimeMMSS(effectiveVoiceDurationSec)}) y sus pausas reales.
                  </div>
                </div>
                <div className="flex items-center gap-1.5 shrink-0">
                  <button
                    type="button"
                    onClick={() => {
                      handleGenerateAutoCaptionsFromVoice(
                        voiceStartOffsetSec,
                        effectiveVoiceDurationSec,
                        detectedAudioSilencesRef.current
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
                      const fmtSrtTime = (sec: number) => {
                        const s = Math.max(0, sec);
                        const h = Math.floor(s / 3600);
                        const m = Math.floor((s % 3600) / 60);
                        const whole = Math.floor(s % 60);
                        const ms = Math.round((s - Math.floor(s)) * 1000);
                        return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(
                          whole
                        ).padStart(2, '0')},${String(Math.min(999, ms)).padStart(3, '0')}`;
                      };
                      const srtOut = captions
                        .map(
                          (c, idx) =>
                            `${idx + 1}\n${fmtSrtTime(c.start)} --> ${fmtSrtTime(c.end)}\n${c.text}`
                        )
                        .join('\n\n');
                      updateActiveDoc({ correctedSrt: srtOut });
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
                <div>
                  <label className="block text-[10px] text-slate-400">Tamaño ({captionFontSize}px)</label>
                  <input
                    type="range"
                    min={14}
                    max={40}
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
          LOWER WORKSPACE: 5-TRACK INTERACTIVE TIMELINE (DRAG & DROP REORDERING)
      ===================================================================== */}
      <div className="flex-1 bg-[#0b0907] p-4 overflow-y-auto space-y-2.5">
        <div className="flex items-center justify-between flex-wrap gap-2">
          <div className="flex items-center gap-2.5 flex-wrap">
            <span className="text-xs font-black uppercase tracking-wider text-amber-300 flex items-center gap-1.5">
              <Layers className="w-4 h-4" /> Línea de Tiempo Multipista (Arrastra los Clips para Cambiar el Orden)
            </span>
            {activeClipAtPlayhead && (
              <span className="px-2.5 py-0.5 rounded-full bg-amber-500/20 border border-amber-400/50 text-[11px] font-bold text-amber-200 flex items-center gap-1.5">
                <span className="w-2 h-2 rounded-full bg-rose-500 animate-pulse" />
                Seleccionado en Tiempo Real: #{String((activeClipAtPlayhead.index ?? 0) + 1).padStart(2, '0')} (Clip{' '}
                {String(activeClipAtPlayhead.clipNumber).padStart(2, '0')}) • {formatTimeMMSS(currentTime)}.
                {Math.floor((currentTime % 1) * 10)}
              </span>
            )}
          </div>
          <div className="flex items-center gap-2 text-xs text-slate-400">
            <span>Zoom de Pistas ({timelineRulerData.scaleUnitLabel}):</span>
            <button
              type="button"
              onClick={() => {
                setIsFitEntireProject(false);
                setTimelineZoom((z) => Math.max(1, z - 3));
              }}
              className="px-2 py-0.5 rounded bg-slate-900 hover:bg-slate-800 border border-slate-700 text-slate-300 font-bold cursor-pointer"
              title="Alejar línea de tiempo (ver minutos / horas)"
            >
              −
            </button>
            <input
              type="range"
              min={1}
              max={50}
              value={isFitEntireProject ? 1 : timelineZoom}
              onChange={(e) => {
                setIsFitEntireProject(false);
                setTimelineZoom(Number(e.target.value));
              }}
              className="w-28 accent-amber-500 cursor-pointer"
            />
            <button
              type="button"
              onClick={() => {
                setIsFitEntireProject(false);
                setTimelineZoom((z) => Math.min(50, z + 3));
              }}
              className="px-2 py-0.5 rounded bg-slate-900 hover:bg-slate-800 border border-slate-700 text-slate-300 font-bold cursor-pointer"
              title="Acercar línea de tiempo (ver segundos detallados)"
            >
              +
            </button>
            <button
              type="button"
              onClick={() => setIsFitEntireProject((prev) => !prev)}
              className={`px-3 py-1 rounded-lg border text-xs font-bold flex items-center gap-1.5 transition cursor-pointer ${
                isFitEntireProject
                  ? 'bg-amber-500 text-slate-950 border-amber-400 shadow-lg shadow-amber-500/20'
                  : 'bg-slate-900 hover:bg-slate-800 text-amber-300 border-amber-500/40'
              }`}
              title="Ajusta automáticamente toda la línea de tiempo (00:00 hasta el final) al ancho de la pantalla para ver todo el proyecto entero de un vistazo"
            >
              📐 {isFitEntireProject ? 'Viendo Proyecto Entero (Volver a Zoom)' : 'Ver Todo el Proyecto'}
            </button>
          </div>
        </div>

        {/* Scrollable Multi-Track Container */}
        <div
          ref={timelineScrollContainerRef}
          className={`bg-[#120f0c] border border-slate-800 rounded-2xl p-3 ${
            isFitEntireProject ? 'overflow-x-hidden' : 'overflow-x-auto'
          }`}
        >
          <div className={`relative space-y-2 ${isFitEntireProject ? 'w-full' : 'min-w-max'}`}>
            {/* =================================================================
                GLOBAL VERTICAL PLAYHEAD LINE ("GUION VERTICAL" CORRIENDO EN TIEMPO REAL)
            ================================================================= */}
            <div
              style={{
                left: isFitEntireProject
                  ? `calc(11.5rem + (100% - 11.5rem) * ${Math.min(
                      1,
                      Math.max(0, currentTime / Math.max(1, totalDurationSec))
                    ).toFixed(6)})`
                  : `calc(11.5rem + ${(currentTime * timelineZoom).toFixed(2)}px)`,
              }}
              className="pointer-events-none absolute top-0 bottom-0 z-30"
            >
              {/* Playhead Top Handle / Time Badge on Ruler */}
              <div
                onMouseDown={handleStartRulerScrub}
                title="Arrastra el guion vertical para moverte por la línea de tiempo"
                className="pointer-events-auto cursor-ew-resize -translate-x-1/2 flex flex-col items-center select-none"
              >
                <div className="px-1.5 py-0.5 rounded bg-rose-600 border border-amber-300 text-[9px] font-mono font-black text-white shadow-md whitespace-nowrap leading-none">
                  {formatTimeMMSS(currentTime)}.{Math.floor((currentTime % 1) * 10)}
                </div>
                <div className="w-0 h-0 border-l-[5px] border-l-transparent border-r-[5px] border-r-transparent border-t-[6px] border-t-amber-300" />
              </div>
              {/* Continuous Vertical Playhead Line across all tracks */}
              <div className="w-[2.5px] -translate-x-1/2 h-full bg-gradient-to-b from-amber-300 via-rose-500 to-amber-400 shadow-[0_0_12px_rgba(244,63,94,0.95)]" />
            </div>

            {/* =================================================================
                TOP TIME RULER (SEGUNDOS, MINUTOS U HORAS SEGÚN EL ZOOM)
            ================================================================= */}
            <div className={`flex items-center gap-2 ${isFitEntireProject ? 'w-full' : 'min-w-max'}`}>
              <div className="w-44 shrink-0 px-2.5 py-1.5 rounded-lg bg-slate-950 border border-amber-500/30 text-[10px] font-bold text-amber-300 flex items-center justify-between">
                <span>⏱️ Regla de Tiempo</span>
                <span className="px-1.5 py-0.5 rounded bg-amber-500/15 text-[9px] font-mono text-amber-200">
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
                className={`relative h-9 bg-[#090806] border border-slate-800 rounded-lg cursor-ew-resize select-none overflow-hidden ${
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
              <div className="w-44 shrink-0 px-2.5 py-2 rounded-lg bg-slate-900 border border-slate-800 text-[11px] font-bold text-amber-300">
                1. 🏷️ Logo + Texto Clip 1
              </div>
              <div
                style={
                  isFitEntireProject
                    ? undefined
                    : { width: `${Math.max(300, totalDurationSec * timelineZoom)}px` }
                }
                className={`flex items-center bg-slate-950/80 border border-slate-800/80 rounded-lg py-1 px-0 overflow-hidden ${
                  isFitEntireProject ? 'flex-1 min-w-0' : 'shrink-0'
                }`}
              >
                <button
                  type="button"
                  onClick={() => {
                    setSelectedCanvasObject('hook_text');
                    setActiveInspectorTab('branding');
                  }}
                  style={
                    isFitEntireProject
                      ? {
                          width: `${(clip1OverlayEndSec / Math.max(1, totalDurationSec)) * 100}%`,
                        }
                      : { width: `${clip1OverlayEndSec * timelineZoom}px` }
                  }
                  className="px-2 py-1.5 rounded-l bg-amber-500/20 hover:bg-amber-500/30 border-r border-amber-500/40 text-[11px] text-amber-200 font-semibold truncate cursor-pointer shrink-0"
                >
                  🔤 Texto Gancho Clip 1 (00:00 - 00:0{clip1OverlayEndSec})
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
                  className="px-3 py-1.5 rounded-r bg-emerald-500/15 hover:bg-emerald-500/25 text-[11px] text-emerald-300 font-semibold truncate cursor-pointer shrink-0 text-left"
                >
                  🖼️ Logo Oficial "Huellas de la Humanidad" ({logoScalePct}% • Todo el Video: 00:00 -{' '}
                  {formatTimeMMSS(totalDurationSec)})
                </button>
              </div>
            </div>

            {/* TRACK 2: CAPTIONS (.SRT) */}
            <div className={`flex items-center gap-2 ${isFitEntireProject ? 'w-full' : 'min-w-max'}`}>
              <div className="w-44 shrink-0 px-2.5 py-2 rounded-lg bg-slate-900 border border-slate-800 text-[11px] font-bold text-sky-300">
                2. 💬 Captions ({captions.length})
              </div>
              <div
                style={
                  isFitEntireProject
                    ? undefined
                    : { width: `${Math.max(300, totalDurationSec * timelineZoom)}px` }
                }
                className={`relative h-9 bg-slate-950/80 border border-slate-800/80 rounded-lg overflow-hidden ${
                  isFitEntireProject ? 'flex-1 min-w-0' : 'shrink-0'
                }`}
              >
                {captions.length === 0 ? (
                  <span className="text-[11px] text-slate-500 px-3 leading-9">
                    Haz clic en "✨ Resincronizar Captions" en la pestaña 💬 Captions para crear los subtítulos desde la voz.
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
                        className="absolute top-1 bottom-1 px-1.5 rounded bg-slate-900 border border-dashed border-slate-700 text-[9px] text-slate-400 flex items-center justify-center truncate"
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
                          className={`absolute top-1 bottom-1 rounded border truncate cursor-pointer transition ${
                            isCapActive
                              ? 'bg-sky-500/35 border-amber-300 text-white font-bold z-10'
                              : 'bg-sky-950/60 hover:bg-sky-900/70 border-sky-500/30 text-sky-200'
                          } ${isFitEntireProject ? 'px-0.5 text-[8px]' : 'px-1.5 text-[10px]'}`}
                          title={`${formatTimeMMSS(cap.start)} - ${formatTimeMMSS(cap.end)}: ${cap.text}`}
                        >
                          {!isFitEntireProject && timelineZoom >= 12 && (
                            <span className="font-mono text-sky-300 mr-1">{formatTimeMMSS(cap.start)}</span>
                          )}
                          {cap.text}
                        </button>
                      );
                    })}
                  </>
                )}
              </div>
            </div>

            {/* TRACK 3: VIDEO CLIPS + FOLEY (DRAG & DROP REORDERING + REAL-TIME PLAYHEAD SELECTION) */}
            <div className={`flex items-center gap-2 ${isFitEntireProject ? 'w-full' : 'min-w-max'}`}>
              <div className="w-44 shrink-0 px-2.5 py-4 rounded-lg bg-amber-500/15 border border-amber-500/40 text-xs font-black text-amber-300">
                3. 🎬 Clips + Foley ({timelineClips.length})
              </div>
              <div
                style={
                  isFitEntireProject
                    ? undefined
                    : { width: `${Math.max(300, totalDurationSec * timelineZoom)}px` }
                }
                className={`flex items-stretch bg-slate-950 border border-slate-800 rounded-xl py-1.5 px-0 overflow-hidden ${
                  isFitEntireProject ? 'flex-1 min-w-0' : 'shrink-0'
                }`}
              >
                {clipsWithTimelineBounds.map((clip, idx) => {
                  const isCurrent = currentTime >= clip.start && currentTime < clip.end;
                  const isSelected = selectedClip?.id === clip.id || isCurrent;
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
                      onClick={() => {
                        setSelectedClipId(clip.id);
                        seekToTime(clip.start);
                      }}
                      title={`#${String(idx + 1).padStart(2, '0')} (Clip ${String(
                        clip.clipNumber
                      ).padStart(2, '0')}) • ${formatTimeMMSS(clip.start)} - ${formatTimeMMSS(
                        clip.end
                      )} • ${clip.fileName}`}
                      style={
                        isFitEntireProject
                          ? {
                              width: `${(clip.duration / Math.max(1, totalDurationSec)) * 100}%`,
                            }
                          : { width: `${slotWidthPx}px` }
                      }
                      className="shrink-0 px-[1.5px] select-none"
                    >
                      <div
                        className={`group relative h-full rounded-lg border flex flex-col justify-between cursor-grab active:cursor-grabbing transition overflow-hidden ${
                          useCompactCard ? 'p-1 min-h-[82px]' : 'rounded-xl p-2 gap-1.5'
                        } ${
                          isCurrent
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
                                {String(clip.clipNumber).padStart(2, '0')}
                              </span>
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
                                {isCurrent ? '▶ ' : ''}#{String(idx + 1).padStart(2, '0')} (C
                                {String(clip.clipNumber).padStart(2, '0')})
                                {clip.reviewedForEditor && (
                                  <span title="Revisado y enviado desde Etapa 8">✅</span>
                                )}
                              </span>
                              <span className="text-[10px] font-mono text-slate-200 shrink-0">
                                {formatTimeMMSS(clip.start)}-{formatTimeMMSS(clip.end)}
                              </span>
                            </div>

                            {firstFrameByClip[clip.clipNumber] || clip.posterUrl ? (
                              <div className="relative z-10 h-20 w-full rounded-lg overflow-hidden bg-black border border-slate-800">
                                <img
                                  src={firstFrameByClip[clip.clipNumber] || clip.posterUrl}
                                  alt={clip.fileName}
                                  className="w-full h-full object-cover"
                                />
                                <span className="absolute bottom-1 right-1 px-1.5 py-0.5 rounded bg-black/75 text-[9px] font-mono text-amber-300">
                                  {isCurrent ? '▶ En Curso' : 'Fotograma 1'}
                                </span>
                              </div>
                            ) : (
                              <div className="relative z-10 h-20 w-full rounded-lg overflow-hidden bg-slate-950/90 border border-slate-800/80 flex flex-col items-center justify-center p-2 text-center">
                                <span className="text-[10px] font-bold text-amber-300/90">
                                  🎬 Escena {String(clip.clipNumber).padStart(2, '0')}
                                </span>
                                <span className="text-[9px] text-slate-400 line-clamp-2 mt-0.5">
                                  {stripPauseTags(clip.narrationSegment || clip.videoPrompt || 'Sin .MP4 aún')}
                                </span>
                              </div>
                            )}

                            <div
                              className="relative z-10 text-[10px] font-mono text-emerald-300 truncate"
                              title={clip.fileName}
                            >
                              {clip.fileName}
                            </div>

                            <div className="relative z-10 flex items-center justify-between text-[10px] text-slate-400 pt-1 border-t border-slate-800/80">
                              <span>
                                {clip.duration}s • {clip.speed}x
                              </span>
                              <span>Foley {clip.foleyVolume}%</span>
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
              <div className="w-44 shrink-0 px-2.5 py-2 rounded-lg bg-slate-900 border border-slate-800 text-[11px] font-bold text-emerald-300">
                4. 🎙️ Voz Narrativa
              </div>
              <div
                style={
                  isFitEntireProject
                    ? undefined
                    : { width: `${Math.max(300, totalDurationSec * timelineZoom)}px` }
                }
                className={`flex items-center bg-slate-950/80 border border-slate-800/80 rounded-lg py-1 px-0 overflow-hidden ${
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
                  className="px-1.5 py-1.5 rounded-l bg-slate-900 border-r border-dashed border-slate-700 text-[10px] text-slate-400 text-center truncate shrink-0"
                >
                  🔇 {voiceStartOffsetSec}s Hook
                </div>
                {/* Main Voiceover Bar — Always spans the full voiceover duration */}
                <div
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
                  className="px-3 py-1.5 rounded-r bg-emerald-500/20 border border-emerald-500/40 text-[11px] text-emerald-200 font-bold flex items-center justify-between gap-3 truncate shrink-0"
                >
                  <span className="truncate">
                    🎙️ Voz Narrativa Completa ({formatTimeMMSS(voiceStartOffsetSec)} →{' '}
                    {formatTimeMMSS(
                      voiceStartOffsetSec +
                        Math.max(effectiveVoiceDurationSec, totalDurationSec - voiceStartOffsetSec)
                    )}{' '}
                    • Duración Voz: {formatTimeMMSS(effectiveVoiceDurationSec)}) • Vol: {voiceVolume}%
                  </span>
                  <div className="flex items-center gap-1.5 shrink-0">
                    {effectiveVoiceoverUrl && (
                      <a
                        href={effectiveVoiceoverUrl}
                        download={`Voz_Narrativa_${(activeDoc?.title || 'Documental').replace(/[^a-zA-Z0-9_-]/g, '_')}.mp3`}
                        className="px-2 py-0.5 rounded bg-emerald-500 text-slate-950 hover:bg-emerald-400 text-[10px] font-black cursor-pointer"
                        title="Descargar Audio Maestro de Voz Narrativa (.MP3)"
                      >
                        ⬇️ Descargar Voz (.MP3)
                      </a>
                    )}
                    <label
                      className="px-2 py-0.5 rounded bg-slate-900 hover:bg-slate-800 border border-slate-700 text-[10px] text-emerald-300 font-bold cursor-pointer"
                      title="Subir archivo de Voz Narrativa (.MP3 o .WAV)"
                    >
                      📤 Subir Voz
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
                      className="px-1.5 py-0.5 rounded bg-slate-900 hover:bg-slate-800 text-[10px] text-amber-300 cursor-pointer"
                    >
                      -0.5s
                    </button>
                    <button
                      type="button"
                      onClick={() => setVoiceStartOffsetSec((s) => s + 0.5)}
                      className="px-1.5 py-0.5 rounded bg-slate-900 hover:bg-slate-800 text-[10px] text-amber-300 cursor-pointer"
                    >
                      +0.5s
                    </button>
                  </div>
                </div>
              </div>
            </div>

            {/* TRACK 5: FLOW MUSIC MULTI-SCENE SOUNDTRACK (WITH FADE-IN/OUT, DUCKING & SILENCE GAPS) */}
            <div className={`flex items-center gap-2 ${isFitEntireProject ? 'w-full' : 'min-w-max'}`}>
              <div className="w-44 shrink-0 px-2.5 py-2 rounded-lg bg-slate-900 border border-slate-800 text-[11px] font-bold text-purple-300">
                5. 🎵 Flow Music ({musicTracks.length})
              </div>
              <div
                style={
                  isFitEntireProject
                    ? undefined
                    : { width: `${Math.max(300, totalDurationSec * timelineZoom)}px` }
                }
                className={`relative h-9 bg-slate-950/80 border border-slate-800/80 rounded-lg overflow-hidden flex items-center ${
                  isFitEntireProject ? 'flex-1 min-w-0' : 'shrink-0'
                }`}
              >
                {musicTracks.length === 0 ? (
                  <span className="text-[11px] text-slate-500 px-3 py-1">
                    Las pistas multi-escena de la Etapa 10 (Flow Music) aparecen aquí con Fade-In (2.5s), Fade-Out (3.0s), Auto-Ducking bajo la voz, silencios de 10-20s y cierre de 1:30.
                  </span>
                ) : (
                  musicTracks.map((mt, mIdx) => {
                    const prevEnd =
                      mIdx > 0
                        ? musicTracks[mIdx - 1].start + musicTracks[mIdx - 1].duration
                        : 0;
                    const gapSec =
                      mIdx > 0 ? Math.max(0, Math.round(mt.start - prevEnd)) : Math.max(0, mt.start);
                    return (
                      <React.Fragment key={mt.id}>
                        {gapSec > 0 && (
                          <div
                            style={
                              isFitEntireProject
                                ? { width: `${(gapSec / Math.max(1, totalDurationSec)) * 100}%` }
                                : { width: `${gapSec * timelineZoom}px` }
                            }
                            className="px-1.5 py-1 rounded bg-slate-900/90 border-x border-dashed border-slate-700 text-[10px] text-slate-400 truncate text-center shrink-0"
                            title={`Silencio dramático de ${gapSec}s entre escenas (solo voz narrativa + Foley)`}
                          >
                            🔇 Silencio {gapSec}s
                          </div>
                        )}
                        <div
                          style={
                            isFitEntireProject
                              ? { width: `${(mt.duration / Math.max(1, totalDurationSec)) * 100}%` }
                              : { width: `${mt.duration * timelineZoom}px` }
                          }
                          className="px-2.5 py-1 rounded bg-purple-950/60 border border-purple-500/40 text-[11px] text-purple-200 flex items-center gap-1.5 truncate shrink-0"
                          title={`${mt.title} (${formatTimeMMSS(mt.start)} - ${formatTimeMMSS(
                            mt.start + mt.duration
                          )}) • Fade-In ${mt.fadeInSec ?? 2.5}s / Fade-Out ${
                            mt.fadeOutSec ?? 3.0
                          }s • Auto-Ducking Bajo Voz`}
                        >
                          <Music className="w-3 h-3 text-purple-400 shrink-0" />
                          <span className="truncate">
                            #{mt.trackNumber} {mt.title} ({formatTimeMMSS(mt.start)} -{' '}
                            {formatTimeMMSS(mt.start + mt.duration)}) • 🎚️ Fade In/Out
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
  );
};
