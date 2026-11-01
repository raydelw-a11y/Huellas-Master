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
export type OverlayBgStyle = 'none' | 'semi' | 'solid' | 'pill';

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
    const text = lines.slice(timeLineIdx + 1).join(' ');
    if (text) {
      items.push({
        id: `cap-${idx}-${Date.now()}`,
        index: idx + 1,
        start: parseTime(startStr),
        end: Math.max(parseTime(startStr) + 1.2, parseTime(endStr)),
        text,
      });
    }
  });

  if (items.length > 0 && typeof alignStartSec === 'number') {
    const delta = alignStartSec - items[0].start;
    if (Math.abs(delta) > 0.2) {
      return items.map((it) => ({
        ...it,
        start: Number(Math.max(0, it.start + delta).toFixed(2)),
        end: Number(Math.max(0.5, it.end + delta).toFixed(2)),
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

  // 3. Clip 1 Hook Overlay Text (First 8s) + Typography, Size, Shadow, Background & Position
  const [clip1Line1, setClip1Line1] = useState<string>(
    normalizeClip1Line1Format(activeDoc?.clip1Line1LocationTime || '')
  );
  const [clip1Line2, setClip1Line2] = useState<string>(activeDoc?.clip1Line2Hook || '');
  const [clip1OverlayEndSec, setClip1OverlayEndSec] = useState<number>(() => {
    const { clip1Sec } = getStage1ClipDurations(activeDoc);
    return clip1Sec || 8;
  });
  const [hookFontFamily, setHookFontFamily] = useState<string>(EDITOR_FONT_OPTIONS[0].value);
  const [hookLine1FontSize, setHookLine1FontSize] = useState<number>(15);
  const [hookLine2FontSize, setHookLine2FontSize] = useState<number>(24);
  const [hookLine1Color, setHookLine1Color] = useState<string>('#fcd34d');
  const [hookLine2Color, setHookLine2Color] = useState<string>('#ffffff');
  const [hookShadowStyle, setHookShadowStyle] = useState<OverlayShadowStyle>('cinema');
  const [hookBgStyle, setHookBgStyle] = useState<OverlayBgStyle>('semi');
  const [hookBgColor, setHookBgColor] = useState<string>('#000000');
  const [hookBgOpacity, setHookBgOpacity] = useState<number>(55);
  const [hookTopPct, setHookTopPct] = useState<number>(35);

  // 4. Five Multi-Tracks State
  const [timelineClips, setTimelineClips] = useState<TimelineClipItem[]>([]);
  const [selectedClipId, setSelectedClipId] = useState<string | null>(null);
  const [draggedClipIndex, setDraggedClipIndex] = useState<number | null>(null);
  const [showOnlyReviewedClips, setShowOnlyReviewedClips] = useState<boolean>(true);

  // Voiceover Track (Track 4) — Always starts at Stage 1 clip1Sec (8s)
  const [voiceStartOffsetSec, setVoiceStartOffsetSec] = useState<number>(() => {
    const { clip1Sec } = getStage1ClipDurations(activeDoc);
    return clip1Sec || 8;
  });
  const [voiceDurationSec, setVoiceDurationSec] = useState<number>(0);
  const [voiceVolume, setVoiceVolume] = useState<number>(100);
  const [autoDuckingEnabled, setAutoDuckingEnabled] = useState<boolean>(true);
  const [foleyHighVolume, setFoleyHighVolume] = useState<number>(80); // When narrator is silent
  const [foleyDuckedVolume, setFoleyDuckedVolume] = useState<number>(35); // When narrator speaks

  // Captions Track (Track 2) + Typography, Size, Shadow, Background & Position
  const [captions, setCaptions] = useState<TimelineCaptionItem[]>([]);
  const [captionFontFamily, setCaptionFontFamily] = useState<string>(EDITOR_FONT_OPTIONS[2].value);
  const [captionFontSize, setCaptionFontSize] = useState<number>(22);
  const [captionBottomPct, setCaptionBottomPct] = useState<number>(11);
  const [captionColor, setCaptionColor] = useState<'white' | 'amber' | 'custom'>('white');
  const [captionCustomColor, setCaptionCustomColor] = useState<string>('#ffffff');
  const [captionShadowStyle, setCaptionShadowStyle] = useState<OverlayShadowStyle>('outline');
  const [captionBgStyle, setCaptionBgStyle] = useState<OverlayBgStyle>('semi');
  const [captionBgColor, setCaptionBgColor] = useState<string>('#000000');
  const [captionBgOpacity, setCaptionBgOpacity] = useState<number>(78);

  // Music Track (Track 5 - Suno)
  const [musicTracks, setMusicTracks] = useState<TimelineMusicItem[]>([]);
  const [masterMusicVolume, setMasterMusicVolume] = useState<number>(15);

  // Playback & Rendering State
  const [isPlaying, setIsPlaying] = useState<boolean>(false);
  const [currentTime, setCurrentTime] = useState<number>(0);
  const [timelineZoom, setTimelineZoom] = useState<number>(18); // pixels per second
  const [isFitEntireProject, setIsFitEntireProject] = useState<boolean>(false);
  const [activeInspectorTab, setActiveInspectorTab] = useState<
    'clips' | 'audio' | 'branding' | 'captions'
  >('clips');
  const [isRenderingVideo, setIsRenderingVideo] = useState<boolean>(false);
  const [renderProgressPct, setRenderProgressPct] = useState<number>(0);
  const [statusMessage, setStatusMessage] = useState<string>('');
  const [voiceAudioError, setVoiceAudioError] = useState<boolean>(false);
  const [firstFrameByClip, setFirstFrameByClip] = useState<Record<number, string>>({});

  const previewVideoRef = useRef<HTMLVideoElement | null>(null);
  const voiceAudioRef = useRef<HTMLAudioElement | null>(null);
  const musicAudioRef = useRef<HTMLAudioElement | null>(null);
  const playIntervalRef = useRef<any>(null);
  const webAudioCtxRef = useRef<AudioContext | null>(null);
  const ambientGainRef = useRef<GainNode | null>(null);
  const lastSpokenClipIdRef = useRef<string>('');
  const extractedVideoUrlByClipRef = useRef<Record<number, string>>({});

  // Reset extracted first frames when switching documentaries
  useEffect(() => {
    setFirstFrameByClip({});
    extractedVideoUrlByClipRef.current = {};
  }, [activeDoc?.id]);

  // Automatically extract the exact FIRST FRAME (t = 0.08s) of each clip's .MP4 video
  useEffect(() => {
    let cancelled = false;
    const clipsToExtract = timelineClips.filter(
      (c) =>
        c.videoUrl &&
        extractedVideoUrlByClipRef.current[c.clipNumber] !== c.videoUrl
    );
    if (clipsToExtract.length === 0) return;

    const extractFirstFrameFromVideoUrl = (videoUrl: string): Promise<string> =>
      new Promise((resolve) => {
        const vid = document.createElement('video');
        vid.crossOrigin = 'anonymous';
        vid.muted = true;
        vid.playsInline = true;
        vid.preload = 'auto';

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

        const timer = setTimeout(() => finish(''), 4500);

        const captureFrame = () => {
          try {
            const w = vid.videoWidth || 640;
            const h = vid.videoHeight || 360;
            const canvas = document.createElement('canvas');
            canvas.width = w;
            canvas.height = h;
            const ctx = canvas.getContext('2d');
            if (ctx) {
              ctx.drawImage(vid, 0, 0, w, h);
              const out = canvas.toDataURL('image/jpeg', 0.84);
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
  }, [timelineClips]);

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

  const effectiveVoiceDurationSec = useMemo(() => {
    if (voiceDurationSec > 1) return voiceDurationSec;
    const trackDur = Number(activeDoc?.audioTracks?.[0]?.duration || 0);
    if (trackDur > 1) return trackDur;
    if (effectiveVoiceoverUrl.includes('tts-video-76-exodo-espanol')) return 909.22;
    if (effectiveVoiceoverUrl.includes('tts-1793103539750-763')) return 739.76;
    return 0;
  }, [voiceDurationSec, activeDoc?.audioTracks, effectiveVoiceoverUrl]);

  // Sync tracks from activeDoc whenever documentary changes or user clicks "Sincronizar"
  const syncTracksFromDocumentary = () => {
    if (!activeDoc) return;

    const { clip1Sec: c1BaseDur, standardClipSec: standardDur } = getStage1ClipDurations(activeDoc);
    // Voiceover and Captions ALWAYS start right after Clip 1 (8s when 8s is selected in Stage 1)
    const entrySec = c1BaseDur || 8;

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

    const builtClips: TimelineClipItem[] = docClips.map((c, idx) => {
      const isClip1 = c.clipNumber === 1 || idx === 0;
      const srcDur =
        Number(c.durationSeconds) > 0 ? Number(c.durationSeconds) : isClip1 ? c1BaseDur : standardDur;
      const existingItem = timelineClips.find((tc) => tc.clipNumber === c.clipNumber);
      const videoUrl =
        capturedClipVideosMap[c.clipNumber] || existingItem?.videoUrl || '';

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

    // If activeDoc.clips is empty but capturedClipVideosMap has .MP4 files from 05_Clips_Video, build timeline clips from those .MP4 files!
    if (builtClips.length === 0 && Object.keys(capturedClipVideosMap).length > 0) {
      const sortedNums = Object.keys(capturedClipVideosMap)
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
          videoUrl: capturedClipVideosMap[num],
          posterUrl: firstFrameByClip[num] || '',
          reviewedForEditor: true,
        });
      });
    }

    setTimelineClips(builtClips);
    if (builtClips.length > 0 && !selectedClipId) {
      setSelectedClipId(builtClips[0].id);
    }

    // 2. Build Captions Track (Track 2) aligned to entrySec (8s)
    if (activeDoc.correctedSrt && activeDoc.correctedSrt.trim()) {
      setCaptions(parseSrtToCaptionItems(activeDoc.correctedSrt, entrySec));
    } else {
      handleGenerateAutoCaptionsFromVoice(entrySec, effectiveVoiceDurationSec);
    }

    // 3. Build Suno Music Track (Track 5) with 15s mandatory silence gaps & 1:30 final track
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
        if (isLast) {
          durSec = 90; // Mandatory 1:30 for last song
        }
        const startSec = isLast
          ? Math.max(cursorSec, totalTimelineSec - 90)
          : cursorSec;
        cursorSec = startSec + durSec + silenceGapSec;
        return {
          id: st.id || `music-${idx + 1}`,
          trackNumber: idx + 1,
          title: st.title || `Canción ${idx + 1}`,
          start: startSec,
          duration: durSec,
          volume: masterMusicVolume,
          audioUrl: capturedSunoAudioMap[idx + 1] || st.audioUrl,
          isLast90Sec: isLast,
        };
      });
      setMusicTracks(builtMusic);
    }
  };

  const reviewedClipsSignature = (activeDoc?.clips || [])
    .map((c) => `${c.clipNumber}:${c.reviewedForEditor ? 1 : 0}:${c.videoReady ? 1 : 0}`)
    .join('|');

  useEffect(() => {
    syncTracksFromDocumentary();
  }, [
    activeDoc?.id,
    reviewedClipsSignature,
    showOnlyReviewedClips,
    Object.keys(capturedClipVideosMap).length,
    Object.keys(capturedSunoAudioMap).length,
    folderVoiceoverUrl,
  ]);

  // Auto-Generate Captions directly from Voiceover starting at voiceStartOffsetSec (8s) and calibrated to exact voice duration
  const handleGenerateAutoCaptionsFromVoice = (
    customEntryOffset?: number,
    customVoiceDurSec?: number
  ) => {
    if (!activeDoc) return;
    const offset =
      typeof customEntryOffset === 'number' ? customEntryOffset : voiceStartOffsetSec;
    const targetVoiceDur =
      typeof customVoiceDurSec === 'number' && customVoiceDurSec > 1
        ? customVoiceDurSec
        : effectiveVoiceDurationSec;
    const maxCharsPerCaption = 34;

    const splitIntoShortChunks = (text: string): string[] => {
      const clean = normalizeQuantitiesToMil(stripPauseTags(text)).trim();
      if (!clean) return [];
      const words = clean.split(/\s+/);
      const chunks: string[] = [];
      let current = '';
      for (const w of words) {
        if (!current) {
          current = w;
        } else if ((current + ' ' + w).length <= maxCharsPerCaption) {
          current += ' ' + w;
        } else {
          chunks.push(current);
          current = w;
        }
      }
      if (current) chunks.push(current);
      return chunks;
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

    // Tokenize into speech chunks and explicit pause gaps
    type RawToken =
      | { kind: 'speech'; text: string; rawSec: number; postGapSec: number }
      | { kind: 'pause'; rawSec: number };

    const tokens: RawToken[] = [];
    const parts = rawVoiceScript.split(
      /(\[\s*(?:pausa\s*:?\s*)?\d+(?:[.,]\d+)?\s*s(?:egundos?)?\s*\])/gi
    );

    for (const part of parts) {
      if (!part || !part.trim()) continue;
      const pauseMatch = part.match(
        /^\[\s*(?:pausa\s*:?\s*)?(\d+(?:[.,]\d+)?)\s*s(?:egundos?)?\s*\]$/i
      );
      if (pauseMatch) {
        const pSec = Math.min(4.0, Math.max(0.25, parseFloat(pauseMatch[1].replace(',', '.')) || 1.0));
        tokens.push({ kind: 'pause', rawSec: pSec });
        continue;
      }

      const chunks = splitIntoShortChunks(part);
      chunks.forEach((ch) => {
        const endsSentence = /[.!?;:]$/.test(ch);
        const endsComma = /[,]$/.test(ch);
        const charCount = ch.replace(/[^a-zA-ZáéíóúÁÉÍÓÚñÑüÜ0-9]/g, '').length || ch.length;
        const rawSec = Math.max(0.85, charCount / 13.8);
        const postGapSec = endsSentence ? 0.32 : endsComma ? 0.14 : 0.05;
        tokens.push({
          kind: 'speech',
          text: ch,
          rawSec,
          postGapSec,
        });
      });
    }

    const totalRawSec = tokens.reduce(
      (acc, tk) => acc + tk.rawSec + (tk.kind === 'speech' ? tk.postGapSec : 0),
      0
    );
    const scaleFactor =
      targetVoiceDur > 5 && totalRawSec > 1 ? targetVoiceDur / totalRawSec : 1;

    const generated: TimelineCaptionItem[] = [];
    let cursor = offset;
    tokens.forEach((tk) => {
      if (tk.kind === 'pause') {
        cursor += tk.rawSec * scaleFactor;
      } else {
        const dur = Math.max(0.65, tk.rawSec * scaleFactor);
        const gap = tk.postGapSec * scaleFactor;
        generated.push({
          id: `autocap-vo-${generated.length + 1}`,
          index: generated.length + 1,
          start: Number(cursor.toFixed(2)),
          end: Number((cursor + dur).toFixed(2)),
          text: tk.text,
        });
        cursor += dur + gap;
      }
    });

    setCaptions(generated);
  };

  // Re-align captions automatically whenever voiceStartOffsetSec or effectiveVoiceDurationSec updates
  useEffect(() => {
    if (!activeDoc) return;
    if (activeDoc.correctedSrt && activeDoc.correctedSrt.trim()) {
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
    if (startSec !== currentTime) {
      setCurrentTime(startSec);
    }

    // 1. Unlock & play preview <video> if active clip has videoUrl
    const vid = previewVideoRef.current;
    if (vid && activeClipAtPlayhead?.videoUrl) {
      const offsetInClip =
        (startSec - activeClipAtPlayhead.start) * activeClipAtPlayhead.speed +
        activeClipAtPlayhead.trimStart;
      try {
        vid.currentTime = Math.max(0, offsetInClip);
        vid.muted = false;
        vid.volume = Math.min(1, Math.max(0, effectiveFoleyVolumeAtPlayhead / 100));
        vid.play().catch(() => {});
      } catch {}
    }

    // 2. Unlock & play Voiceover <audio> on the synchronous user click
    const vo = voiceAudioRef.current;
    if (vo && effectiveVoiceoverUrl) {
      try {
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

    // 3. Unlock & play Track 5 Suno Music <audio> if present
    const mus = musicAudioRef.current;
    if (mus && activeMusicAtPlayhead?.audioUrl) {
      try {
        mus.src = activeMusicAtPlayhead.audioUrl;
        mus.currentTime = Math.max(0, startSec - activeMusicAtPlayhead.start);
        mus.volume = Math.min(1, Math.max(0, (activeMusicAtPlayhead.volume || masterMusicVolume) / 100));
        mus.play().catch(() => {});
      } catch {}
    }

    // 4. Start subtle Web Audio cinema drone if active clip has no .MP4 video loaded yet
    if (!activeClipAtPlayhead?.videoUrl) {
      setCinemaAmbienceActive(true, effectiveFoleyVolumeAtPlayhead);
    }

    lastSpokenClipIdRef.current = '';
    setIsPlaying(true);
  };

  // Playback Loop
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

    const stepMs = 100;
    playIntervalRef.current = setInterval(() => {
      setCurrentTime((prev) => {
        const next = prev + stepMs / 1000;
        if (next >= totalDurationSec) {
          setIsPlaying(false);
          return 0;
        }
        return next;
      });
    }, stepMs);

    return () => {
      if (playIntervalRef.current) clearInterval(playIntervalRef.current);
    };
  }, [isPlaying, totalDurationSec]);

  // Sync preview <video>, voice <audio>, Suno music <audio>, and Web Speech / Ambience fallback when currentTime changes
  useEffect(() => {
    const vid = previewVideoRef.current;
    if (vid && activeClipAtPlayhead?.videoUrl) {
      const offsetInClip =
        (currentTime - activeClipAtPlayhead.start) * activeClipAtPlayhead.speed +
        activeClipAtPlayhead.trimStart;
      if (Math.abs(vid.currentTime - offsetInClip) > 0.55) {
        try {
          vid.currentTime = Math.max(0, offsetInClip);
        } catch {}
      }
      vid.playbackRate = activeClipAtPlayhead.speed || 1;
      vid.muted = false;
      vid.volume = Math.min(1, Math.max(0, effectiveFoleyVolumeAtPlayhead / 100));
      if (isPlaying && vid.paused) {
        vid.play().catch(() => {});
      }
      setCinemaAmbienceActive(false);
    } else if (isPlaying) {
      setCinemaAmbienceActive(true, effectiveFoleyVolumeAtPlayhead);
    }

    const vo = voiceAudioRef.current;
    const hasWorkingVoiceFile = Boolean(vo && effectiveVoiceoverUrl && !voiceAudioError);
    if (hasWorkingVoiceFile && vo) {
      if (currentTime >= voiceStartOffsetSec) {
        const voTime = currentTime - voiceStartOffsetSec;
        if (Math.abs(vo.currentTime - voTime) > 0.55) {
          try {
            vo.currentTime = Math.max(0, voTime);
          } catch {}
        }
        vo.muted = false;
        vo.volume = Math.min(1, Math.max(0, voiceVolume / 100));
        if (isPlaying && vo.paused) {
          vo.play().catch(() => {});
        }
      } else {
        vo.pause();
      }
    }

    const mus = musicAudioRef.current;
    if (mus) {
      if (activeMusicAtPlayhead?.audioUrl) {
        if (!mus.src.endsWith(activeMusicAtPlayhead.audioUrl) && mus.src !== activeMusicAtPlayhead.audioUrl) {
          mus.src = activeMusicAtPlayhead.audioUrl;
        }
        const musTime = Math.max(0, currentTime - activeMusicAtPlayhead.start);
        if (Math.abs(mus.currentTime - musTime) > 0.65) {
          try {
            mus.currentTime = musTime;
          } catch {}
        }
        mus.volume = Math.min(
          1,
          Math.max(0, (activeMusicAtPlayhead.volume || masterMusicVolume) / 100)
        );
        if (isPlaying && mus.paused) {
          mus.play().catch(() => {});
        }
      } else if (!mus.paused) {
        mus.pause();
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
              sunoMasterVolume: masterMusicVolume / 100,
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

        // 2. Active Clip Poster / Frame
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
            ctx.drawImage(frameImg, 0, 0, width, height);
          }
        }

        // 3. Official Logo Top-Left
        if (logoImg) {
          const logoW = Math.round(width * (logoScalePct / 100));
          const logoH = Math.round((logoImg.height / Math.max(1, logoImg.width)) * logoW);
          ctx.save();
          ctx.globalAlpha = logoOpacity / 100;
          ctx.drawImage(
            logoImg,
            Math.round(width * (logoPosX / 100)),
            Math.round(height * (logoPosY / 100)),
            logoW,
            logoH
          );
          ctx.restore();
        }

        // 4. Clip 1 Hook Text (First 8s) with Custom Font, Size, Color, Shadow & Background
        if (simTime <= clip1OverlayEndSec && (clip1Line1 || clip1Line2)) {
          ctx.save();
          ctx.textAlign = 'center';
          const scaleRatio = height / 520;
          const f1 = Math.round(hookLine1FontSize * scaleRatio);
          const f2 = Math.round(hookLine2FontSize * scaleRatio);
          const yCenter = Math.round(height * (hookTopPct / 100));

          if (hookBgStyle !== 'none') {
            ctx.fillStyle = hexToRgba(
              hookBgColor,
              hookBgStyle === 'solid' ? 95 : hookBgOpacity
            );
            const boxW = Math.round(width * 0.76);
            const boxH = Math.round((f1 + f2) * 1.9);
            ctx.fillRect(
              Math.round((width - boxW) / 2),
              Math.round(yCenter - f1 * 1.3),
              boxW,
              boxH
            );
          }

          if (hookShadowStyle !== 'none') {
            ctx.shadowColor =
              hookShadowStyle === 'gold_glow' ? 'rgba(245,158,11,0.85)' : 'rgba(0,0,0,0.95)';
            ctx.shadowBlur = hookShadowStyle === 'soft' ? 8 : 18;
            ctx.shadowOffsetY = 4;
          }

          if (clip1Line1) {
            ctx.font = `700 ${f1}px ${hookFontFamily}`;
            if (hookShadowStyle === 'outline') {
              ctx.lineWidth = Math.max(3, Math.round(f1 * 0.16));
              ctx.strokeStyle = '#000000';
              ctx.strokeText(clip1Line1, width / 2, yCenter);
            }
            ctx.fillStyle = hookLine1Color;
            ctx.fillText(clip1Line1, width / 2, yCenter);
          }
          if (clip1Line2) {
            const y2 = yCenter + Math.round(f2 * 1.25);
            ctx.font = `900 ${f2}px ${hookFontFamily}`;
            if (hookShadowStyle === 'outline') {
              ctx.lineWidth = Math.max(4, Math.round(f2 * 0.16));
              ctx.strokeStyle = '#000000';
              ctx.strokeText(clip1Line2, width / 2, y2);
            }
            ctx.fillStyle = hookLine2Color;
            ctx.fillText(clip1Line2, width / 2, y2);
          }
          ctx.restore();
        }

        // 5. Active Caption (.SRT) with Custom Font, Size, Color, Shadow & Background
        const cap = captions.find((c) => simTime >= c.start && simTime <= c.end);
        if (cap) {
          ctx.save();
          const scaleRatio = height / 520;
          const capFontPx = Math.round(captionFontSize * scaleRatio);
          ctx.font = `800 ${capFontPx}px ${captionFontFamily}`;
          ctx.textAlign = 'center';
          const yPos = Math.round(height * (1 - captionBottomPct / 100));

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
      <audio ref={musicAudioRef} preload="auto" />

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
              onClick={() => {
                setSelectedCanvasObject(null);
                handleTogglePlay();
              }}
              className={`relative w-full bg-black overflow-hidden flex items-center justify-center cursor-pointer select-none ${
                aspectRatio === '16:9' ? 'aspect-video' : 'aspect-[9/16]'
              }`}
              title="Haz clic en el video para Reproducir / Pausar, o haz clic sobre el Logo, el Texto en Pantalla o los Captions para seleccionarlos y editarlos"
            >
              {/* Layer 1: Active Clip Video, Animated Ken Burns Poster, or Cinematic Storyboard */}
              {activeClipAtPlayhead?.videoUrl ? (
                <video
                  key={activeClipAtPlayhead.videoUrl}
                  ref={previewVideoRef}
                  src={activeClipAtPlayhead.videoUrl}
                  className="w-full h-full object-cover block bg-black"
                  playsInline
                  preload="auto"
                  onLoadedMetadata={(e) => {
                    const vid = e.currentTarget;
                    const offsetInClip =
                      (currentTime - activeClipAtPlayhead.start) * activeClipAtPlayhead.speed +
                      activeClipAtPlayhead.trimStart;
                    try {
                      vid.currentTime = Math.max(0, offsetInClip);
                      vid.playbackRate = activeClipAtPlayhead.speed || 1;
                      vid.muted = false;
                      vid.volume = Math.min(1, Math.max(0, effectiveFoleyVolumeAtPlayhead / 100));
                      if (isPlaying) {
                        vid.play().catch(() => {});
                      }
                    } catch {}
                  }}
                />
              ) : activeClipAtPlayhead?.posterUrl ? (
                <div className="w-full h-full overflow-hidden relative bg-black">
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

              {/* Layer 2: Permanent Official Logo (Selectable directly on the Video Viewer) */}
              <div
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
                  opacity: logoOpacity / 100,
                }}
                title="Haz clic para seleccionar y ajustar el Logo Oficial"
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

              {/* Layer 3: Clip 1 Hook Text Overlay (Selectable & Editable directly inside the Video Viewer!) */}
              {(currentTime <= clip1OverlayEndSec || selectedCanvasObject === 'hook_text') &&
                (clip1Line1 || clip1Line2 || selectedCanvasObject === 'hook_text') && (
                  <div
                    onClick={(e) => {
                      e.stopPropagation();
                      setSelectedCanvasObject('hook_text');
                      setActiveInspectorTab('branding');
                    }}
                    className={`absolute inset-x-6 z-20 text-center cursor-pointer transition rounded-xl p-2 mx-auto max-w-[88%] ${
                      selectedCanvasObject === 'hook_text'
                        ? 'ring-2 ring-amber-400 shadow-2xl'
                        : 'hover:ring-1 hover:ring-amber-300/60'
                    }`}
                    style={{
                      top: `${hookTopPct}%`,
                      fontFamily: hookFontFamily,
                      textShadow: getTextShadowCss(hookShadowStyle),
                      backgroundColor:
                        hookBgStyle === 'none'
                          ? 'transparent'
                          : hexToRgba(hookBgColor, hookBgStyle === 'solid' ? 95 : hookBgOpacity),
                    }}
                    title="Haz clic para seleccionar y editar el Texto en Pantalla directamente aquí"
                  >
                    {selectedCanvasObject === 'hook_text' ? (
                      <div
                        className="space-y-1.5"
                        onClick={(e) => e.stopPropagation()}
                      >
                        <div className="flex items-center justify-center gap-1.5 text-[10px] font-sans font-black text-amber-300 mb-1">
                          <span className="px-2 py-0.5 rounded bg-amber-500 text-slate-950">
                            🔤 Editando Texto en Pantalla (00:00 - 00:0{clip1OverlayEndSec})
                          </span>
                        </div>
                        <input
                          type="text"
                          value={clip1Line1}
                          onChange={(e) => setClip1Line1(e.target.value)}
                          placeholder="Línea 1: Lugar y Año..."
                          className="w-full text-center bg-black/65 border border-amber-400/60 rounded-lg px-2.5 py-1 font-bold uppercase tracking-widest outline-none focus:border-amber-300"
                          style={{
                            fontFamily: hookFontFamily,
                            fontSize: `${hookLine1FontSize}px`,
                            color: hookLine1Color,
                            textShadow: getTextShadowCss(hookShadowStyle),
                          }}
                        />
                        <input
                          type="text"
                          value={clip1Line2}
                          onChange={(e) => setClip1Line2(e.target.value)}
                          placeholder="Línea 2: Título Gancho en Pantalla..."
                          className="w-full text-center bg-black/65 border border-amber-400/60 rounded-lg px-2.5 py-1 font-black uppercase tracking-wide outline-none focus:border-amber-300"
                          style={{
                            fontFamily: hookFontFamily,
                            fontSize: `${hookLine2FontSize}px`,
                            color: hookLine2Color,
                            textShadow: getTextShadowCss(hookShadowStyle),
                          }}
                        />
                      </div>
                    ) : (
                      <div className="space-y-1">
                        {clip1Line1 && (
                          <div
                            className="font-bold uppercase tracking-widest px-2.5 py-0.5 rounded inline-block"
                            style={{
                              fontFamily: hookFontFamily,
                              fontSize: `${hookLine1FontSize}px`,
                              color: hookLine1Color,
                              textShadow: getTextShadowCss(hookShadowStyle),
                            }}
                          >
                            {clip1Line1}
                          </div>
                        )}
                        {clip1Line2 && (
                          <div
                            className="font-black uppercase tracking-wide"
                            style={{
                              fontFamily: hookFontFamily,
                              fontSize: `${hookLine2FontSize}px`,
                              color: hookLine2Color,
                              textShadow: getTextShadowCss(hookShadowStyle),
                            }}
                          >
                            {clip1Line2}
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                )}

              {/* Layer 4: Dynamic Captions (.SRT) — Selectable & Editable directly inside the Video Viewer! */}
              {(activeCaptionAtPlayhead || selectedCanvasObject === 'captions') && (
                <div
                  onClick={(e) => {
                    e.stopPropagation();
                    setSelectedCanvasObject('captions');
                    setActiveInspectorTab('captions');
                  }}
                  className="absolute inset-x-4 z-20 text-center cursor-pointer"
                  style={{ bottom: `${captionBottomPct}%` }}
                  title="Haz clic para seleccionar y editar los Captions directamente aquí"
                >
                  {selectedCanvasObject === 'captions' && activeCaptionAtPlayhead ? (
                    <div
                      onClick={(e) => e.stopPropagation()}
                      className="inline-flex flex-col items-center gap-1 bg-black/85 border-2 border-sky-400 rounded-xl p-2 shadow-2xl min-w-[280px] max-w-[90%]"
                    >
                      <span className="px-2 py-0.5 rounded bg-sky-400 text-slate-950 font-sans font-black text-[9px]">
                        💬 Editando Caption #{activeCaptionAtPlayhead.index} ({formatTimeMMSS(activeCaptionAtPlayhead.start)} - {formatTimeMMSS(activeCaptionAtPlayhead.end)})
                      </span>
                      <input
                        type="text"
                        value={activeCaptionAtPlayhead.text}
                        onChange={(e) => {
                          const newText = e.target.value;
                          setCaptions((prev) =>
                            prev.map((c) =>
                              c.id === activeCaptionAtPlayhead.id ? { ...c, text: newText } : c
                            )
                          );
                        }}
                        className="w-full text-center bg-slate-950/90 border border-sky-400/50 rounded-lg px-3 py-1 font-extrabold outline-none"
                        style={{
                          fontFamily: captionFontFamily,
                          fontSize: `${Math.max(13, captionFontSize * 0.78)}px`,
                          color:
                            captionColor === 'amber'
                              ? '#fde047'
                              : captionColor === 'custom'
                              ? captionCustomColor
                              : '#ffffff',
                          textShadow: getTextShadowCss(captionShadowStyle),
                        }}
                      />
                    </div>
                  ) : (
                    <span
                      className={`inline-block px-3.5 py-1 rounded-lg font-extrabold transition ${
                        selectedCanvasObject === 'captions'
                          ? 'ring-2 ring-sky-400'
                          : 'hover:ring-1 hover:ring-sky-400/60'
                      }`}
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
                        backgroundColor:
                          captionBgStyle === 'none'
                            ? 'transparent'
                            : hexToRgba(
                                captionBgColor,
                                captionBgStyle === 'solid' ? 95 : captionBgOpacity
                              ),
                      }}
                    >
                      {activeCaptionAtPlayhead?.text ||
                        (currentTime < voiceStartOffsetSec
                          ? `🎙️ Subtítulos inician en 00:${String(Math.floor(voiceStartOffsetSec)).padStart(2, '0')}`
                          : '💬 Subtítulos activos')}
                    </span>
                  )}
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
                onClick={() => setCurrentTime(0)}
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
                onClick={() => setCurrentTime(voiceStartOffsetSec)}
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
                  onChange={(e) => setCurrentTime(Number(e.target.value))}
                  className="w-full h-2 accent-amber-500 cursor-pointer"
                />
              </div>

              <span className="font-mono text-xs text-emerald-300 font-bold shrink-0">
                {formatTimeMMSS(currentTime)} / {formatTimeMMSS(totalDurationSec)}
              </span>

              <button
                type="button"
                onClick={() => setCurrentTime(Math.max(0, totalDurationSec - 1))}
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
                <option value="semi">Fondo: Semitransparente</option>
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
            </div>
          )}

          {selectedCanvasObject === 'captions' && (
            <div className="w-full bg-slate-950/95 border border-sky-500/40 rounded-xl p-2.5 flex flex-wrap items-center gap-2.5 text-xs">
              <span className="font-black text-sky-300 text-[11px]">
                💬 Estilo Captions:
              </span>
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
              🎙️ Voz / Foley / Suno
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

              {/* Global Transition Selector */}
              <div className="bg-slate-950/90 border border-slate-800 rounded-xl p-3 space-y-2">
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
                <div className="flex items-center justify-between">
                  <span className="font-bold text-purple-300">
                    🎵 Pista 5: Música Suno (Con Silencios de 15s y Cierre de 1:30)
                  </span>
                  <span className="font-mono text-purple-200">Volumen: {masterMusicVolume}%</span>
                </div>
                <input
                  type="range"
                  min={0}
                  max={50}
                  value={masterMusicVolume}
                  onChange={(e) => setMasterMusicVolume(Number(e.target.value))}
                  className="w-full accent-purple-500"
                />
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
                <input
                  type="text"
                  value={clip1Line1}
                  onChange={(e) => setClip1Line1(e.target.value)}
                  placeholder="Línea 1: Ciudad, País, Año o Siglo en romanos..."
                  className="w-full bg-slate-900 border border-slate-700 rounded-lg px-2.5 py-1.5 text-xs text-amber-200"
                />
                <input
                  type="text"
                  value={clip1Line2}
                  onChange={(e) => setClip1Line2(e.target.value)}
                  placeholder="Línea 2: Título Gancho intrigante..."
                  className="w-full bg-slate-900 border border-slate-700 rounded-lg px-2.5 py-1.5 text-xs text-white font-bold"
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
                    Sincronizados con la duración completa de la Voz Narrativa ({formatTimeMMSS(effectiveVoiceDurationSec)}).
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => {
                    handleGenerateAutoCaptionsFromVoice(voiceStartOffsetSec, effectiveVoiceDurationSec);
                    setStatusMessage(
                      `💬 Subtítulos resincronizados desde 00:${String(Math.floor(voiceStartOffsetSec)).padStart(2, '0')} hasta ${formatTimeMMSS(totalDurationSec)}.`
                    );
                  }}
                  className="px-3 py-1.5 rounded-lg bg-emerald-500 hover:bg-emerald-400 text-slate-950 font-black text-xs cursor-pointer shrink-0"
                >
                  ✨ Resincronizar Captions
                </button>
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
                    <option value="none">Transparente</option>
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
          <div className="flex items-center gap-2">
            <span className="text-xs font-black uppercase tracking-wider text-amber-300 flex items-center gap-1.5">
              <Layers className="w-4 h-4" /> Línea de Tiempo Multipista (Arrastra los Clips para Cambiar el Orden)
            </span>
          </div>
          <div className="flex items-center gap-2 text-xs text-slate-400">
            <span>Zoom de Pistas:</span>
            <button
              type="button"
              onClick={() => {
                setIsFitEntireProject(false);
                setTimelineZoom((z) => Math.max(2, z - 4));
              }}
              className="px-2 py-0.5 rounded bg-slate-900 hover:bg-slate-800 border border-slate-700 text-slate-300 font-bold cursor-pointer"
              title="Alejar línea de tiempo"
            >
              −
            </button>
            <input
              type="range"
              min={2}
              max={40}
              value={isFitEntireProject ? 2 : timelineZoom}
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
                setTimelineZoom((z) => Math.min(40, z + 4));
              }}
              className="px-2 py-0.5 rounded bg-slate-900 hover:bg-slate-800 border border-slate-700 text-slate-300 font-bold cursor-pointer"
              title="Acercar línea de tiempo"
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
          className={`bg-[#120f0c] border border-slate-800 rounded-2xl p-3 space-y-2 ${
            isFitEntireProject ? 'overflow-x-hidden' : 'overflow-x-auto'
          }`}
        >
          {/* TRACK 1: BRANDING OVERLAYS (LOGO + CLIP 1 HOOK TEXT) */}
          <div className={`flex items-center gap-2 ${isFitEntireProject ? 'w-full' : 'min-w-max'}`}>
            <div className="w-44 shrink-0 px-2.5 py-2 rounded-lg bg-slate-900 border border-slate-800 text-[11px] font-bold text-amber-300">
              1. 🏷️ Logo + Texto Clip 1
            </div>
            <div
              className={`flex items-center gap-2 bg-slate-950/80 border border-slate-800/80 rounded-lg p-1.5 ${
                isFitEntireProject ? 'flex-1 min-w-0' : ''
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
                        flex: `${Math.max(1, clip1OverlayEndSec)} 0 0%`,
                        minWidth: '80px',
                      }
                    : undefined
                }
                className="px-3 py-1.5 rounded bg-amber-500/20 hover:bg-amber-500/30 border border-amber-500/40 text-[11px] text-amber-200 font-semibold truncate cursor-pointer"
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
                        flex: `${Math.max(1, totalDurationSec - clip1OverlayEndSec)} 1 0%`,
                        minWidth: 0,
                      }
                    : undefined
                }
                className="px-4 py-1.5 rounded bg-emerald-500/15 hover:bg-emerald-500/25 border border-emerald-500/30 text-[11px] text-emerald-300 font-semibold truncate cursor-pointer"
              >
                🖼️ Logo Oficial "Huellas de la Humanidad" ({logoScalePct}% • Todo el Video: 00:00 - {formatTimeMMSS(totalDurationSec)})
              </button>
            </div>
          </div>

          {/* TRACK 2: CAPTIONS (.SRT) */}
          <div className={`flex items-center gap-2 ${isFitEntireProject ? 'w-full' : 'min-w-max'}`}>
            <div className="w-44 shrink-0 px-2.5 py-2 rounded-lg bg-slate-900 border border-slate-800 text-[11px] font-bold text-sky-300">
              2. 💬 Captions ({captions.length})
            </div>
            <div
              className={`flex items-center gap-1 bg-slate-950/80 border border-slate-800/80 rounded-lg p-1.5 ${
                isFitEntireProject ? 'flex-1 min-w-0 overflow-hidden' : ' gap-1.5'
              }`}
            >
              {captions.length === 0 ? (
                <span className="text-[11px] text-slate-500 px-3 py-1">
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
                              flex: `${Math.max(1, voiceStartOffsetSec)} 0 0%`,
                              minWidth: '48px',
                            }
                          : { width: `${Math.max(64, voiceStartOffsetSec * timelineZoom)}px` }
                      }
                      className="px-2 py-1 rounded bg-slate-900 border border-dashed border-slate-700 text-[9px] text-slate-400 text-center truncate shrink-0"
                    >
                      00:00-00:0{voiceStartOffsetSec} (Hook)
                    </div>
                  )}
                  {(isFitEntireProject ? captions : captions.slice(0, 80)).map((cap) => (
                    <button
                      key={cap.id}
                      type="button"
                      onClick={() => {
                        setCurrentTime(cap.start);
                        setSelectedCanvasObject('captions');
                      }}
                      style={
                        isFitEntireProject
                          ? {
                              flex: `${Math.max(1, cap.end - cap.start)} 1 0%`,
                              minWidth: 0,
                            }
                          : undefined
                      }
                      className={`rounded bg-sky-950/60 hover:bg-sky-900/70 border border-sky-500/30 text-sky-200 truncate cursor-pointer ${
                        isFitEntireProject
                          ? 'px-1 py-1 text-[9px]'
                          : 'px-2.5 py-1 text-[10px] max-w-[160px]'
                      }`}
                      title={`${formatTimeMMSS(cap.start)} - ${formatTimeMMSS(cap.end)}: ${cap.text}`}
                    >
                      {!isFitEntireProject && (
                        <span className="font-mono text-sky-400 mr-1">{formatTimeMMSS(cap.start)}</span>
                      )}
                      {cap.text}
                    </button>
                  ))}
                </>
              )}
            </div>
          </div>

          {/* TRACK 3: VIDEO CLIPS + FOLEY (DRAG & DROP REORDERING) */}
          <div className={`flex items-center gap-2 ${isFitEntireProject ? 'w-full' : 'min-w-max'}`}>
            <div className="w-44 shrink-0 px-2.5 py-4 rounded-lg bg-amber-500/15 border border-amber-500/40 text-xs font-black text-amber-300">
              3. 🎬 Clips + Foley ({timelineClips.length})
            </div>
            <div
              className={`flex items-stretch bg-slate-950 border border-slate-800 rounded-xl ${
                isFitEntireProject ? 'flex-1 min-w-0 gap-[2px] p-1.5' : 'gap-2 p-2.5'
              }`}
            >
              {clipsWithTimelineBounds.map((clip, idx) => {
                const isSelected = selectedClip?.id === clip.id;
                const isCurrent =
                  currentTime >= clip.start && currentTime < clip.end;
                const cardWidth = Math.max(
                  timelineZoom < 12 ? Math.max(48, timelineZoom * 10) : 195,
                  Math.round(clip.duration * timelineZoom)
                );

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
                      setCurrentTime(clip.start);
                    }}
                    title={`#${String(idx + 1).padStart(2, '0')} (Clip ${String(
                      clip.clipNumber
                    ).padStart(2, '0')}) • ${formatTimeMMSS(clip.start)} - ${formatTimeMMSS(
                      clip.end
                    )} • ${clip.fileName}`}
                    style={
                      isFitEntireProject
                        ? {
                            flex: `${Math.max(1, clip.duration)} 1 0%`,
                            minWidth: 0,
                          }
                        : { width: `${cardWidth}px` }
                    }
                    className={`group relative rounded-lg border flex flex-col justify-between cursor-grab active:cursor-grabbing transition select-none overflow-hidden ${
                      isFitEntireProject ? 'p-0.5 min-h-[76px]' : 'rounded-xl p-2.5 gap-2'
                    } ${
                      isSelected
                        ? 'border-amber-400 bg-amber-500/20 shadow-lg shadow-amber-500/10 z-10'
                        : isCurrent
                        ? 'border-emerald-400 bg-emerald-950/40 z-10'
                        : 'border-slate-800 bg-[#16130f] hover:border-amber-500/50'
                    }`}
                  >
                    {isFitEntireProject ? (
                      <>
                        {firstFrameByClip[clip.clipNumber] || clip.posterUrl ? (
                          <img
                            src={firstFrameByClip[clip.clipNumber] || clip.posterUrl}
                            alt={clip.fileName}
                            className="absolute inset-0 w-full h-full object-cover opacity-65 group-hover:opacity-90 transition"
                          />
                        ) : clip.videoUrl ? (
                          <video
                            src={clip.videoUrl}
                            muted
                            playsInline
                            preload="metadata"
                            onLoadedMetadata={(e) => {
                              try {
                                e.currentTarget.currentTime = 0.08;
                              } catch {}
                            }}
                            className="absolute inset-0 w-full h-full object-cover opacity-65 group-hover:opacity-90 transition pointer-events-none"
                          />
                        ) : null}
                        <div className="relative z-10 flex flex-col items-center justify-between h-full w-full text-center pointer-events-none">
                          <span className="px-1 py-0.5 rounded bg-black/80 text-amber-300 font-black text-[9px] leading-none truncate max-w-full">
                            {String(clip.clipNumber).padStart(2, '0')}
                          </span>
                          <span className="px-0.5 py-0.5 rounded bg-black/75 text-[8px] font-mono text-slate-200 leading-none truncate max-w-full">
                            {formatTimeMMSS(clip.start)}
                          </span>
                        </div>
                      </>
                    ) : (
                      <>
                        <div className="flex items-center justify-between gap-1">
                          <span className="px-2 py-0.5 rounded bg-amber-500 text-slate-950 font-black text-[11px] flex items-center gap-1">
                            #{String(idx + 1).padStart(2, '0')} (Clip {String(clip.clipNumber).padStart(2, '0')})
                            {clip.reviewedForEditor && (
                              <span title="Revisado y enviado desde Etapa 8">✅</span>
                            )}
                          </span>
                          <span className="text-[11px] font-mono text-slate-300">
                            {formatTimeMMSS(clip.start)}-{formatTimeMMSS(clip.end)}
                          </span>
                        </div>

                        {firstFrameByClip[clip.clipNumber] || clip.posterUrl ? (
                          <div className="h-24 w-full rounded-lg overflow-hidden bg-black border border-slate-800 relative">
                            <img
                              src={firstFrameByClip[clip.clipNumber] || clip.posterUrl}
                              alt={clip.fileName}
                              className="w-full h-full object-cover"
                            />
                            <span className="absolute bottom-1 right-1 px-1.5 py-0.5 rounded bg-black/75 text-[9px] font-mono text-amber-300">
                              Fotograma 1
                            </span>
                          </div>
                        ) : clip.videoUrl ? (
                          <div className="h-24 w-full rounded-lg overflow-hidden bg-black border border-slate-800 relative">
                            <video
                              src={clip.videoUrl}
                              muted
                              playsInline
                              preload="metadata"
                              onLoadedMetadata={(e) => {
                                try {
                                  e.currentTarget.currentTime = 0.08;
                                } catch {}
                              }}
                              className="w-full h-full object-cover pointer-events-none"
                            />
                            <span className="absolute bottom-1 right-1 px-1.5 py-0.5 rounded bg-black/75 text-[9px] font-mono text-amber-300">
                              Fotograma 1
                            </span>
                          </div>
                        ) : (
                          <div className="h-24 w-full rounded-lg overflow-hidden bg-slate-950/90 border border-slate-800/80 flex flex-col items-center justify-center p-2 text-center">
                            <span className="text-[10px] font-bold text-amber-300/90">
                              🎬 Escena {String(clip.clipNumber).padStart(2, '0')}
                            </span>
                            <span className="text-[9px] text-slate-400 line-clamp-2 mt-0.5">
                              {stripPauseTags(clip.narrationSegment || clip.videoPrompt || 'Sin .MP4 aún')}
                            </span>
                          </div>
                        )}

                        <div className="text-[11px] font-mono text-emerald-300 truncate" title={clip.fileName}>
                          {clip.fileName}
                        </div>

                        <div className="flex items-center justify-between text-[10px] text-slate-400 pt-1 border-t border-slate-800/80">
                          <span>
                            {clip.duration}s • {clip.speed}x
                          </span>
                          <span>Foley {clip.foleyVolume}%</span>
                        </div>
                      </>
                    )}
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
              className={`flex items-center gap-2 bg-slate-950/80 border border-slate-800/80 rounded-lg p-1.5 ${
                isFitEntireProject ? 'flex-1 min-w-0' : ''
              }`}
            >
              {/* Initial Silence Block for Clip 1 Hook (8s) */}
              <div
                style={
                  isFitEntireProject
                    ? {
                        flex: `${Math.max(1, voiceStartOffsetSec)} 0 0%`,
                        minWidth: '54px',
                      }
                    : { width: `${Math.max(70, voiceStartOffsetSec * timelineZoom)}px` }
                }
                className="px-2 py-1.5 rounded bg-slate-900 border border-dashed border-slate-700 text-[10px] text-slate-400 text-center truncate shrink-0"
              >
                🔇 {voiceStartOffsetSec}s Hook Sin Voz
              </div>
              {/* Main Voiceover Bar — Always spans the full voiceover duration */}
              <div
                style={
                  isFitEntireProject
                    ? {
                        flex: `${Math.max(1, totalDurationSec - voiceStartOffsetSec)} 1 0%`,
                        minWidth: 0,
                      }
                    : {
                        width: `${Math.max(
                          320,
                          Math.round(
                            Math.max(
                              effectiveVoiceDurationSec,
                              totalDurationSec - voiceStartOffsetSec
                            ) * timelineZoom
                          )
                        )}px`,
                      }
                }
                className="px-4 py-1.5 rounded bg-emerald-500/20 border border-emerald-500/40 text-[11px] text-emerald-200 font-bold flex items-center justify-between gap-3 truncate"
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

          {/* TRACK 5: SUNO BACKGROUND MUSIC (WITH MANDATORY SILENCE GAPS & 1:30 FINAL SONG) */}
          <div className={`flex items-center gap-2 ${isFitEntireProject ? 'w-full' : 'min-w-max'}`}>
            <div className="w-44 shrink-0 px-2.5 py-2 rounded-lg bg-slate-900 border border-slate-800 text-[11px] font-bold text-purple-300">
              5. 🎵 Música Suno ({musicTracks.length})
            </div>
            <div
              className={`flex items-center gap-2 bg-slate-950/80 border border-slate-800/80 rounded-lg p-1.5 ${
                isFitEntireProject ? 'flex-1 min-w-0' : ''
              }`}
            >
              {musicTracks.length === 0 ? (
                <span className="text-[11px] text-slate-500 px-3 py-1">
                  Las pistas instrumentales de la Etapa 10 (Suno) aparecen aquí respetando los silencios de 15s y el cierre de 1:30.
                </span>
              ) : (
                musicTracks.map((mt, mIdx) => (
                  <React.Fragment key={mt.id}>
                    {mIdx > 0 && (
                      <div
                        style={
                          isFitEntireProject
                            ? { flex: '15 0 0%', minWidth: '36px' }
                            : undefined
                        }
                        className="px-2 py-1 rounded bg-slate-900 border border-dashed border-slate-700 text-[10px] text-slate-400 truncate text-center"
                      >
                        🔇 Silencio 15s
                      </div>
                    )}
                    <div
                      style={
                        isFitEntireProject
                          ? { flex: `${Math.max(1, mt.duration)} 1 0%`, minWidth: 0 }
                          : undefined
                      }
                      className="px-3 py-1.5 rounded bg-purple-950/60 border border-purple-500/40 text-[11px] text-purple-200 flex items-center gap-2 truncate"
                    >
                      <Music className="w-3 h-3 text-purple-400 shrink-0" />
                      <span className="truncate">
                        {mt.title} ({formatTimeMMSS(mt.start)} -{' '}
                        {formatTimeMMSS(mt.start + mt.duration)})
                        {mt.isLast90Sec ? ' • Cierre 1:30' : ''}
                      </span>
                    </div>
                  </React.Fragment>
                ))
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
