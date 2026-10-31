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
import { stripPauseTags, normalizeQuantitiesToMil } from '../utils/smartParsers';

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
  duration: number; // effective duration on timeline in seconds
  sourceDuration: number;
  speed: number; // e.g., 0.75x for slowed Clip 1, 1.0x default
  trimStart: number;
  foleyVolume: number; // 0 to 100
  transition: ClipTransitionType;
  videoUrl?: string; // local blob URL or data URL of the MP4
  posterUrl?: string; // keyframe or preview image
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

function parseSrtToCaptionItems(srtText: string): TimelineCaptionItem[] {
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

  return items;
}

interface CapCutEditorProps {
  activeDoc: DocumentaryProject | null;
  updateActiveDoc: (patch: Partial<DocumentaryProject>) => void;
  capturedClipVideosMap: Record<number, string>; // clipNumber -> blob/data URL of MP4
  capturedSunoAudioMap?: Record<number, string>; // trackNumber -> data URL of MP3
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
  updateActiveDoc,
  capturedClipVideosMap,
  capturedSunoAudioMap = {},
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
  const [exportResolution, setExportResolution] = useState<ExportResolutionPreset>('4K_2160P');
  const [defaultTransition, setDefaultTransition] = useState<ClipTransitionType>('direct');

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
  const [showRightQualityBadge, setShowRightQualityBadge] = useState<boolean>(true);
  const [logoOpacity, setLogoOpacity] = useState<number>(95);

  // 3. Clip 1 Hook Overlay Text (First 6s-8s)
  const [clip1Line1, setClip1Line1] = useState<string>(activeDoc?.clip1Line1LocationTime || '');
  const [clip1Line2, setClip1Line2] = useState<string>(activeDoc?.clip1Line2Hook || '');
  const [clip1OverlayEndSec, setClip1OverlayEndSec] = useState<number>(
    activeDoc?.clip1SyncMode === 'VOZ_EN_CLIP_2' ? 8 : activeDoc?.clip1DurationSeconds || 6
  );

  // 4. Five Multi-Tracks State
  const [timelineClips, setTimelineClips] = useState<TimelineClipItem[]>([]);
  const [selectedClipId, setSelectedClipId] = useState<string | null>(null);
  const [draggedClipIndex, setDraggedClipIndex] = useState<number | null>(null);

  // Voiceover Track (Track 4)
  const [voiceStartOffsetSec, setVoiceStartOffsetSec] = useState<number>(
    activeDoc?.clip1SyncMode === 'VOZ_EN_CLIP_2' ? 8 : activeDoc?.clip1DurationSeconds || 6
  );
  const [voiceVolume, setVoiceVolume] = useState<number>(100);
  const [autoDuckingEnabled, setAutoDuckingEnabled] = useState<boolean>(true);
  const [foleyHighVolume, setFoleyHighVolume] = useState<number>(80); // When narrator is silent
  const [foleyDuckedVolume, setFoleyDuckedVolume] = useState<number>(35); // When narrator speaks

  // Captions Track (Track 2)
  const [captions, setCaptions] = useState<TimelineCaptionItem[]>([]);
  const [captionFontSize, setCaptionFontSize] = useState<number>(22);
  const [captionBottomPct, setCaptionBottomPct] = useState<number>(11);
  const [captionColor, setCaptionColor] = useState<'white' | 'amber'>('white');

  // Music Track (Track 5 - Suno)
  const [musicTracks, setMusicTracks] = useState<TimelineMusicItem[]>([]);
  const [masterMusicVolume, setMasterMusicVolume] = useState<number>(15);

  // Playback & Rendering State
  const [isPlaying, setIsPlaying] = useState<boolean>(false);
  const [currentTime, setCurrentTime] = useState<number>(0);
  const [timelineZoom, setTimelineZoom] = useState<number>(18); // pixels per second
  const [activeInspectorTab, setActiveInspectorTab] = useState<
    'clips' | 'audio' | 'branding' | 'captions'
  >('clips');
  const [isRenderingVideo, setIsRenderingVideo] = useState<boolean>(false);
  const [renderProgressPct, setRenderProgressPct] = useState<number>(0);
  const [statusMessage, setStatusMessage] = useState<string>('');

  const previewVideoRef = useRef<HTMLVideoElement | null>(null);
  const voiceAudioRef = useRef<HTMLAudioElement | null>(null);
  const playIntervalRef = useRef<any>(null);

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

  // Sync tracks from activeDoc whenever documentary changes or user clicks "Sincronizar"
  const syncTracksFromDocumentary = () => {
    if (!activeDoc) return;

    const standardDur = activeDoc.clipDurationMode === '8_SEGUNDOS' ? 8 : 10;
    const c1BaseDur = activeDoc.clip1DurationSeconds || 6;
    const entrySec = activeDoc.clip1SyncMode === 'VOZ_EN_CLIP_2' ? c1BaseDur + 2 : c1BaseDur;

    setClip1Line1(activeDoc.clip1Line1LocationTime || `${activeDoc.historicalLocation || ''} • ${activeDoc.historicalTime || ''}`);
    setClip1Line2(activeDoc.clip1Line2Hook || activeDoc.title || '');
    setClip1OverlayEndSec(entrySec);
    setVoiceStartOffsetSec(entrySec);

    // 1. Build Clips Track (Track 3)
    const docClips = activeDoc.clips || [];
    const builtClips: TimelineClipItem[] = docClips.map((c, idx) => {
      const isClip1 = c.clipNumber === 1 || idx === 0;
      const srcDur = isClip1 ? c1BaseDur : standardDur;
      const existingItem = timelineClips.find((tc) => tc.clipNumber === c.clipNumber);
      const videoUrl =
        capturedClipVideosMap[c.clipNumber] || existingItem?.videoUrl || '';
      const posterUrl =
        (c.videoFrames && c.videoFrames[0]) ||
        c.imagePreviewUrl ||
        existingItem?.posterUrl ||
        '';

      return {
        id: c.id || `tl-clip-${c.clipNumber}`,
        clipNumber: c.clipNumber,
        fileName: buildClipSixWordFileName(c, activeDoc),
        narrationSegment: c.narrationSegment || '',
        duration: existingItem ? existingItem.duration : srcDur,
        sourceDuration: srcDur,
        speed: existingItem ? existingItem.speed : 1,
        trimStart: existingItem ? existingItem.trimStart : 0,
        foleyVolume: existingItem ? existingItem.foleyVolume : isClip1 ? 80 : 35,
        transition: existingItem ? existingItem.transition : defaultTransition,
        videoUrl,
        posterUrl,
      };
    });
    setTimelineClips(builtClips);
    if (builtClips.length > 0 && !selectedClipId) {
      setSelectedClipId(builtClips[0].id);
    }

    // 2. Build Captions Track (Track 2)
    if (activeDoc.correctedSrt && activeDoc.correctedSrt.trim()) {
      setCaptions(parseSrtToCaptionItems(activeDoc.correctedSrt));
    } else {
      handleGenerateAutoCaptionsFromVoice(entrySec);
    }

    // 3. Build Suno Music Track (Track 5) with 15s mandatory silence gaps & 1:30 final track
    const totalTimelineSec =
      builtClips.reduce((acc, item) => acc + item.duration, 0) ||
      activeDoc.targetDurationSeconds ||
      120;
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

  useEffect(() => {
    syncTracksFromDocumentary();
  }, [
    activeDoc?.id,
    Object.keys(capturedClipVideosMap).length,
    Object.keys(capturedSunoAudioMap).length,
  ]);

  // Auto-Generate Captions directly from Voiceover + Timeline Sentences (No external CapCut needed!)
  const handleGenerateAutoCaptionsFromVoice = (customEntryOffset?: number) => {
    if (!activeDoc) return;
    const offset =
      typeof customEntryOffset === 'number' ? customEntryOffset : voiceStartOffsetSec;
    const maxCharsPerCaption = 32;
    const generated: TimelineCaptionItem[] = [];

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

    if (activeDoc.clips && activeDoc.clips.length > 1) {
      let runningSec = 0;
      activeDoc.clips.forEach((clip, idx) => {
        const clipDur =
          idx === 0
            ? activeDoc.clip1DurationSeconds || 6
            : activeDoc.clipDurationMode === '8_SEGUNDOS'
            ? 8
            : 10;
        if (idx > 0 && clip.narrationSegment && clip.narrationSegment.trim()) {
          const chunks = splitIntoShortChunks(clip.narrationSegment);
          const subDur = clipDur / Math.max(1, chunks.length);
          chunks.forEach((ch, cIdx) => {
            generated.push({
              id: `autocap-${clip.clipNumber}-${cIdx}`,
              index: generated.length + 1,
              start: Number((runningSec + cIdx * subDur).toFixed(2)),
              end: Number((runningSec + (cIdx + 1) * subDur - 0.08).toFixed(2)),
              text: ch,
            });
          });
        }
        runningSec += clipDur;
      });
    } else if (activeDoc.voiceoverScript) {
      const allChunks = splitIntoShortChunks(activeDoc.voiceoverScript);
      let cursor = offset;
      allChunks.forEach((ch, idx) => {
        const dur = Math.max(1.4, Math.min(3.2, ch.length / 13));
        generated.push({
          id: `autocap-vo-${idx}`,
          index: idx + 1,
          start: Number(cursor.toFixed(2)),
          end: Number((cursor + dur).toFixed(2)),
          text: ch,
        });
        cursor += dur + 0.05;
      });
    }

    setCaptions(generated);
    setStatusMessage(
      `💬 ${generated.length} subtítulos generados y sincronizados automáticamente desde tu Voz Narrativa (sin usar CapCut externo).`
    );
  };

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

  const totalDurationSec = useMemo(() => {
    const clipsEnd =
      clipsWithTimelineBounds.length > 0
        ? clipsWithTimelineBounds[clipsWithTimelineBounds.length - 1].end
        : 60;
    return Math.max(10, clipsEnd);
  }, [clipsWithTimelineBounds]);

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

  const isNarratorSpeakingAtPlayhead = useMemo(() => {
    if (currentTime < voiceStartOffsetSec) return false;
    if (activeClipAtPlayhead && activeClipAtPlayhead.clipNumber === 1) return false;
    return Boolean(activeClipAtPlayhead?.narrationSegment?.trim());
  }, [currentTime, voiceStartOffsetSec, activeClipAtPlayhead]);

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

  // Sync preview <video> and voice <audio> when currentTime changes
  useEffect(() => {
    const vid = previewVideoRef.current;
    if (vid && activeClipAtPlayhead?.videoUrl) {
      const offsetInClip =
        (currentTime - activeClipAtPlayhead.start) * activeClipAtPlayhead.speed +
        activeClipAtPlayhead.trimStart;
      if (Math.abs(vid.currentTime - offsetInClip) > 0.45) {
        try {
          vid.currentTime = Math.max(0, offsetInClip);
        } catch {}
      }
      vid.playbackRate = activeClipAtPlayhead.speed || 1;
      vid.volume = Math.min(1, Math.max(0, effectiveFoleyVolumeAtPlayhead / 100));
      if (isPlaying && vid.paused) {
        vid.play().catch(() => {});
      }
    }

    const vo = voiceAudioRef.current;
    if (vo && activeDoc?.masterAudioUrl) {
      if (currentTime >= voiceStartOffsetSec) {
        const voTime = currentTime - voiceStartOffsetSec;
        if (Math.abs(vo.currentTime - voTime) > 0.45) {
          try {
            vo.currentTime = Math.max(0, voTime);
          } catch {}
        }
        vo.volume = Math.min(1, Math.max(0, voiceVolume / 100));
        if (isPlaying && vo.paused) {
          vo.play().catch(() => {});
        }
      } else {
        vo.pause();
      }
    }
  }, [
    currentTime,
    activeClipAtPlayhead?.id,
    isPlaying,
    effectiveFoleyVolumeAtPlayhead,
    voiceStartOffsetSec,
    voiceVolume,
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

        // 3. Official Logo Top-Left (5% scale)
        if (logoImg) {
          const logoW = Math.round(width * (logoScalePct / 100));
          const logoH = Math.round((logoImg.height / Math.max(1, logoImg.width)) * logoW);
          ctx.save();
          ctx.globalAlpha = logoOpacity / 100;
          ctx.drawImage(logoImg, Math.round(width * 0.03), Math.round(height * 0.03), logoW, logoH);
          ctx.restore();
        }

        // 4. Top-Right 5% Metallic Gold Badge ("8K" for 16:9, "HD" for 9:16)
        if (showRightQualityBadge) {
          const badgeText = aspectRatio === '16:9' ? '8K' : 'HD';
          const fontSize = Math.round(height * 0.028);
          ctx.save();
          ctx.font = `900 ${fontSize}px sans-serif`;
          ctx.fillStyle = '#f59e0b';
          ctx.textAlign = 'right';
          ctx.fillText(badgeText, Math.round(width * 0.97), Math.round(height * 0.055));
          ctx.restore();
        }

        // 5. Clip 1 Hook Text (First 6s-8s)
        if (simTime <= clip1OverlayEndSec && (clip1Line1 || clip1Line2)) {
          ctx.save();
          ctx.textAlign = 'center';
          const f1 = Math.round(height * 0.028);
          const f2 = Math.round(height * 0.048);
          ctx.fillStyle = '#fcd34d';
          ctx.font = `700 ${f1}px serif`;
          ctx.fillText(clip1Line1, width / 2, Math.round(height * 0.45));
          ctx.fillStyle = '#ffffff';
          ctx.font = `900 ${f2}px serif`;
          ctx.fillText(clip1Line2, width / 2, Math.round(height * 0.52));
          ctx.restore();
        }

        // 6. Active Caption (.SRT)
        const cap = captions.find((c) => simTime >= c.start && simTime <= c.end);
        if (cap) {
          ctx.save();
          const capFontPx = Math.round(height * 0.036);
          ctx.font = `800 ${capFontPx}px sans-serif`;
          ctx.textAlign = 'center';
          const yPos = Math.round(height * (1 - captionBottomPct / 100));
          ctx.lineWidth = Math.max(4, Math.round(capFontPx * 0.18));
          ctx.strokeStyle = '#000000';
          ctx.strokeText(cap.text, width / 2, yPos);
          ctx.fillStyle = captionColor === 'amber' ? '#fde047' : '#ffffff';
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

  return (
    <div className="flex-1 flex flex-col bg-[#0c0a08] text-slate-100 min-h-0">
      {/* Hidden audio element for Voiceover playback */}
      {activeDoc?.masterAudioUrl && (
        <audio ref={voiceAudioRef} src={activeDoc.masterAudioUrl} preload="auto" />
      )}

      {/* =====================================================================
          TOP BAR: PROJECT TITLE, ASPECT RATIO (16:9 / 9:16), QUALITY (HD/2K/4K/8K) & EXPORT
      ===================================================================== */}
      <div className="bg-[#14110d] border-b border-amber-500/25 px-4 py-2.5 flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3 flex-wrap">
          <div className="flex items-center gap-2">
            <span className="px-2.5 py-1 rounded-lg bg-amber-500 text-slate-950 font-black text-xs flex items-center gap-1.5">
              <Film className="w-3.5 h-3.5" />
              HUELLAS CAPCUT STUDIO
            </span>
            <span className="text-sm font-bold text-amber-200 truncate max-w-[260px]">
              {activeDoc?.title || 'Sin Documental Seleccionado'}
            </span>
          </div>

          <button
            type="button"
            onClick={syncTracksFromDocumentary}
            className="px-2.5 py-1 rounded-lg bg-slate-800 hover:bg-slate-700 border border-slate-700 text-xs text-amber-300 font-semibold flex items-center gap-1.5 cursor-pointer"
            title="Traer clips, voz narrativa, texto del Clip 1, captions y música de Suno del documental activo"
          >
            <RefreshCw className="w-3.5 h-3.5" />
            Sincronizar Todo del Documental
          </button>
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
            <div className="px-3 py-1.5 rounded-xl text-xs font-bold flex items-center gap-1.5 border bg-emerald-950/60 border-emerald-500/40 text-emerald-300">
              <FolderOpen className="w-3.5 h-3.5 text-emerald-400" />
              ✓ Carpeta: {downloadFolderName}
            </div>
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
          UPPER WORKSPACE: REAL-TIME PREVIEW MONITOR (LEFT/CENTER) + INSPECTOR (RIGHT)
      ===================================================================== */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-4 p-4 bg-[#100d0a] border-b border-slate-800/90">
        {/* PREVIEW MONITOR (7 COLS) */}
        <div className="lg:col-span-7 flex flex-col items-center justify-between bg-[#080705] border border-slate-800 rounded-2xl p-4 space-y-3">
          <div className="w-full flex items-center justify-between text-xs text-slate-400">
            <span className="font-mono text-amber-300 font-bold">
              Monitor en Tiempo Real • {aspectRatio} • Salida:{' '}
              {aspectRatio === '16:9'
                ? `${activePreset.width16x9}×${activePreset.height16x9}`
                : `${activePreset.width9x16}×${activePreset.height9x16}`}{' '}
              ({activePreset.badge})
            </span>
            <span className="font-mono text-emerald-300">
              {formatTimeMMSS(currentTime)} / {formatTimeMMSS(totalDurationSec)}
            </span>
          </div>

          {/* Aspect-Ratio Locked Screen */}
          <div
            className={`relative bg-black rounded-xl overflow-hidden border border-amber-500/30 shadow-2xl flex items-center justify-center ${
              aspectRatio === '16:9'
                ? 'w-full max-w-[680px] aspect-video'
                : 'h-[360px] aspect-[9/16]'
            }`}
          >
            {/* Layer 1: Active Clip Video or Poster */}
            {activeClipAtPlayhead?.videoUrl ? (
              <video
                ref={previewVideoRef}
                src={activeClipAtPlayhead.videoUrl}
                className="w-full h-full object-cover"
                playsInline
              />
            ) : activeClipAtPlayhead?.posterUrl ? (
              <img
                src={activeClipAtPlayhead.posterUrl}
                alt={activeClipAtPlayhead.fileName}
                className="w-full h-full object-cover"
              />
            ) : (
              <div className="text-center p-6 space-y-2">
                <p className="text-xs font-mono text-amber-400">
                  CLIP {String(activeClipAtPlayhead?.clipNumber || 1).padStart(2, '0')} •{' '}
                  {activeClipAtPlayhead?.fileName || '01_Clip.mp4'}
                </p>
                <p className="text-xs text-slate-400 max-w-md">
                  {activeClipAtPlayhead?.narrationSegment ||
                    'Los videos aprobados en Google Flow (o importados desde tu carpeta) se reproducen aquí automáticamente.'}
                </p>
              </div>
            )}

            {/* Layer 2: Permanent Official Logo (Top-Left at 5% scale) */}
            <div
              className="absolute top-3 left-3 pointer-events-none flex flex-col items-start"
              style={{
                width: `${logoScalePct}%`,
                minWidth: '42px',
                opacity: logoOpacity / 100,
              }}
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
            </div>

            {/* Layer 3: Metallic Gold 8K (16:9) or HD (9:16) Top-Right Badge */}
            {showRightQualityBadge && (
              <div className="absolute top-3 right-3 pointer-events-none">
                <span className="px-2 py-0.5 rounded bg-black/75 border border-amber-400/60 text-[10px] font-black tracking-wider text-amber-300 shadow">
                  {aspectRatio === '16:9' ? '8K' : 'HD'}
                </span>
              </div>
            )}

            {/* Layer 4: Clip 1 Hook Text Overlay (First 6s-8s) */}
            {currentTime <= clip1OverlayEndSec && (clip1Line1 || clip1Line2) && (
              <div className="absolute inset-x-6 top-1/3 text-center pointer-events-none space-y-1 drop-shadow-[0_4px_12px_rgba(0,0,0,0.95)]">
                {clip1Line1 && (
                  <div className="text-xs sm:text-sm font-bold uppercase tracking-widest text-amber-300 bg-black/50 inline-block px-3 py-0.5 rounded">
                    {clip1Line1}
                  </div>
                )}
                {clip1Line2 && (
                  <div className="text-base sm:text-xl font-black text-white uppercase tracking-wide">
                    {clip1Line2}
                  </div>
                )}
              </div>
            )}

            {/* Layer 5: Dynamic Captions (.SRT) */}
            {activeCaptionAtPlayhead && (
              <div
                className="absolute inset-x-4 text-center pointer-events-none"
                style={{ bottom: `${captionBottomPct}%` }}
              >
                <span
                  className={`inline-block px-3 py-1 rounded-lg bg-black/80 font-extrabold shadow-xl border border-white/10 ${
                    captionColor === 'amber' ? 'text-amber-300' : 'text-white'
                  }`}
                  style={{ fontSize: `${Math.max(13, captionFontSize * 0.72)}px` }}
                >
                  {activeCaptionAtPlayhead.text}
                </span>
              </div>
            )}

            {/* Bottom-Left Live Audio Ducking & Transition Indicator */}
            <div className="absolute bottom-2 left-2.5 flex items-center gap-1.5 pointer-events-none">
              <span className="px-2 py-0.5 rounded bg-black/75 text-[10px] font-mono text-slate-300">
                Foley: {effectiveFoleyVolumeAtPlayhead}%{' '}
                {isNarratorSpeakingAtPlayhead ? '(Auto-Ducking Voz 🎙️)' : '(Ambiente Alto 🔊)'}
              </span>
              {activeClipAtPlayhead && (
                <span className="px-2 py-0.5 rounded bg-black/75 text-[10px] font-mono text-amber-300">
                  Transición:{' '}
                  {TRANSITION_OPTIONS.find((t) => t.value === activeClipAtPlayhead.transition)?.label.split(
                    ' ('
                  )[0] || 'Corte Directo'}
                </span>
              )}
            </div>
          </div>

          {/* Playback Transport Controls */}
          <div className="w-full flex items-center justify-center gap-3 pt-1">
            <button
              type="button"
              onClick={() => setCurrentTime(0)}
              className="p-2 rounded-lg bg-slate-900 hover:bg-slate-800 text-slate-300 cursor-pointer"
              title="Ir al inicio (00:00)"
            >
              <SkipBack className="w-4 h-4" />
            </button>
            <button
              type="button"
              onClick={() => setIsPlaying((p) => !p)}
              className="px-5 py-2 rounded-xl bg-amber-500 hover:bg-amber-400 text-slate-950 font-black text-xs flex items-center gap-1.5 cursor-pointer shadow"
            >
              {isPlaying ? <Pause className="w-4 h-4" /> : <Play className="w-4 h-4" />}
              {isPlaying ? 'Pausar' : 'Reproducir Timeline'}
            </button>
            <button
              type="button"
              onClick={() => setCurrentTime(Math.max(0, totalDurationSec - 1))}
              className="p-2 rounded-lg bg-slate-900 hover:bg-slate-800 text-slate-300 cursor-pointer"
              title="Ir al final"
            >
              <SkipForward className="w-4 h-4" />
            </button>
            <input
              type="range"
              min={0}
              max={totalDurationSec}
              step={0.1}
              value={currentTime}
              onChange={(e) => setCurrentTime(Number(e.target.value))}
              className="w-48 sm:w-64 accent-amber-500 cursor-pointer"
            />
          </div>
        </div>

        {/* INSPECTOR & CONTROLS PANEL (5 COLS) */}
        <div className="lg:col-span-5 bg-[#14110d] border border-slate-800 rounded-2xl p-4 flex flex-col justify-between space-y-3">
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
              <div className="bg-slate-950/90 border border-slate-800 rounded-xl p-3 space-y-2">
                <div className="flex items-center justify-between">
                  <span className="font-bold text-emerald-300">
                    🎙️ Pista 4: Voz Narrativa (Entrada después del Clip 1)
                  </span>
                  <span className="font-mono text-amber-300">
                    Entra en: 00:0{voiceStartOffsetSec}s
                  </span>
                </div>
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

          {/* TAB 3: PERMANENT OFFICIAL LOGO, 8K/HD BADGE & CLIP 1 HOOK TEXT */}
          {activeInspectorTab === 'branding' && (
            <div className="space-y-3 text-xs flex-1 overflow-y-auto pr-1">
              <div className="bg-slate-950/90 border border-amber-500/40 rounded-xl p-3 space-y-2.5">
                <div className="flex items-center justify-between gap-2">
                  <div>
                    <div className="font-bold text-amber-300">
                      🖼️ Logo Oficial "Huellas de la Humanidad" (Subir 1 Sola Vez)
                    </div>
                    <div className="text-[11px] text-slate-400">
                      Queda guardado permanentemente para todos tus documentales en la esquina superior izquierda.
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
                      Tamaño del Logo: {logoScalePct}% (Estándar: 5%)
                    </label>
                    <input
                      type="range"
                      min={3}
                      max={15}
                      value={logoScalePct}
                      onChange={(e) => setLogoScalePct(Number(e.target.value))}
                      className="w-full accent-amber-500"
                    />
                  </div>
                  <div className="flex items-center pt-3">
                    <label className="flex items-center gap-2 text-slate-200 cursor-pointer">
                      <input
                        type="checkbox"
                        checked={showRightQualityBadge}
                        onChange={(e) => setShowRightQualityBadge(e.target.checked)}
                        className="accent-amber-500"
                      />
                      <span>
                        Mostrar Sello Dorado <strong>{aspectRatio === '16:9' ? '8K' : 'HD'}</strong>{' '}
                        (Arriba Derecha)
                      </span>
                    </label>
                  </div>
                </div>
              </div>

              <div className="bg-slate-950/90 border border-slate-800 rounded-xl p-3 space-y-2">
                <div className="font-bold text-slate-200">
                  Texto Gancho en Pantalla (Primeros {clip1OverlayEndSec}s sobre el Clip 1)
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
              </div>
            </div>
          )}

          {/* TAB 4: AUTO-CAPTIONS (.SRT) WITHOUT EXTERNAL CAPCUT */}
          {activeInspectorTab === 'captions' && (
            <div className="space-y-3 text-xs flex-1 overflow-y-auto pr-1">
              <div className="flex items-center justify-between gap-2 bg-slate-950/90 border border-slate-800 rounded-xl p-3">
                <div>
                  <div className="font-bold text-emerald-300">
                    💬 Subtítulos Sincronizados ({captions.length} bloques)
                  </div>
                  <div className="text-[11px] text-slate-400">
                    Genera los captions directo desde tu Voz Narrativa sin tener que ir a CapCut externo.
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => handleGenerateAutoCaptionsFromVoice()}
                  className="px-3 py-1.5 rounded-lg bg-emerald-500 hover:bg-emerald-400 text-slate-950 font-black text-xs cursor-pointer shrink-0"
                >
                  ✨ Auto-Generar Captions
                </button>
              </div>

              <div className="grid grid-cols-3 gap-2 bg-slate-950/90 border border-slate-800 rounded-xl p-2.5">
                <div>
                  <label className="block text-[10px] text-slate-400">Tamaño ({captionFontSize}px)</label>
                  <input
                    type="range"
                    min={16}
                    max={36}
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
                  <label className="block text-[10px] text-slate-400">Color</label>
                  <select
                    value={captionColor}
                    onChange={(e) => setCaptionColor(e.target.value as 'white' | 'amber')}
                    className="w-full bg-slate-900 border border-slate-700 rounded px-2 py-1 text-xs text-white"
                  >
                    <option value="white">Blanco Clásico</option>
                    <option value="amber">Ámbar Documental</option>
                  </select>
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
          <div className="flex items-center gap-2">
            <span className="text-xs font-black uppercase tracking-wider text-amber-300 flex items-center gap-1.5">
              <Layers className="w-4 h-4" /> Línea de Tiempo Multipista (Arrastra los Clips para Cambiar el Orden)
            </span>
          </div>
          <div className="flex items-center gap-2 text-xs text-slate-400">
            <span>Zoom de Pistas:</span>
            <input
              type="range"
              min={10}
              max={40}
              value={timelineZoom}
              onChange={(e) => setTimelineZoom(Number(e.target.value))}
              className="w-28 accent-amber-500"
            />
          </div>
        </div>

        {/* Scrollable Multi-Track Container */}
        <div className="bg-[#120f0c] border border-slate-800 rounded-2xl p-3 overflow-x-auto space-y-2">
          {/* TRACK 1: BRANDING OVERLAYS (LOGO + CLIP 1 HOOK TEXT) */}
          <div className="flex items-center gap-2 min-w-max">
            <div className="w-44 shrink-0 px-2.5 py-2 rounded-lg bg-slate-900 border border-slate-800 text-[11px] font-bold text-amber-300">
              1. 🏷️ Logo + Texto Clip 1
            </div>
            <div className="flex items-center gap-2 bg-slate-950/80 border border-slate-800/80 rounded-lg p-1.5">
              <div className="px-3 py-1.5 rounded bg-amber-500/20 border border-amber-500/40 text-[11px] text-amber-200 font-semibold">
                 Texto Gancho Clip 1 (00:00 - 00:0{clip1OverlayEndSec})
              </div>
              <div className="px-4 py-1.5 rounded bg-emerald-500/15 border border-emerald-500/30 text-[11px] text-emerald-300 font-semibold">
                🖼️ Logo Oficial "Huellas de la Humanidad" (5%) + Sello {aspectRatio === '16:9' ? '8K' : 'HD'} (Todo el Video: 00:00 - {formatTimeMMSS(totalDurationSec)})
              </div>
            </div>
          </div>

          {/* TRACK 2: CAPTIONS (.SRT) */}
          <div className="flex items-center gap-2 min-w-max">
            <div className="w-44 shrink-0 px-2.5 py-2 rounded-lg bg-slate-900 border border-slate-800 text-[11px] font-bold text-sky-300">
              2. 💬 Captions ({captions.length})
            </div>
            <div className="flex items-center gap-1.5 bg-slate-950/80 border border-slate-800/80 rounded-lg p-1.5">
              {captions.length === 0 ? (
                <span className="text-[11px] text-slate-500 px-3 py-1">
                  Haz clic en "✨ Auto-Generar Captions" en la pestaña 💬 Captions para crear los subtítulos desde la voz.
                </span>
              ) : (
                captions.slice(0, 40).map((cap) => (
                  <button
                    key={cap.id}
                    type="button"
                    onClick={() => setCurrentTime(cap.start)}
                    className="px-2.5 py-1 rounded bg-sky-950/60 hover:bg-sky-900/70 border border-sky-500/30 text-[10px] text-sky-200 max-w-[160px] truncate cursor-pointer"
                    title={`${formatTimeMMSS(cap.start)} - ${formatTimeMMSS(cap.end)}: ${cap.text}`}
                  >
                    <span className="font-mono text-sky-400 mr-1">{formatTimeMMSS(cap.start)}</span>
                    {cap.text}
                  </button>
                ))
              )}
            </div>
          </div>

          {/* TRACK 3: VIDEO CLIPS + FOLEY (DRAG & DROP REORDERING) */}
          <div className="flex items-center gap-2 min-w-max">
            <div className="w-44 shrink-0 px-2.5 py-3 rounded-lg bg-amber-500/15 border border-amber-500/40 text-[11px] font-black text-amber-300">
              3. 🎬 Clips + Foley ({timelineClips.length})
            </div>
            <div className="flex items-stretch gap-1.5 bg-slate-950 border border-slate-800 rounded-xl p-2">
              {clipsWithTimelineBounds.map((clip, idx) => {
                const isSelected = selectedClip?.id === clip.id;
                const isCurrent =
                  currentTime >= clip.start && currentTime < clip.end;
                const cardWidth = Math.max(135, Math.round(clip.duration * timelineZoom));

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
                    style={{ width: `${cardWidth}px` }}
                    className={`group relative rounded-xl border p-2 flex flex-col justify-between gap-1.5 cursor-grab active:cursor-grabbing transition select-none ${
                      isSelected
                        ? 'border-amber-400 bg-amber-500/15 shadow-lg shadow-amber-500/10'
                        : isCurrent
                        ? 'border-emerald-400 bg-emerald-950/30'
                        : 'border-slate-800 bg-[#16130f] hover:border-slate-700'
                    }`}
                  >
                    <div className="flex items-center justify-between gap-1">
                      <span className="px-1.5 py-0.5 rounded bg-amber-500 text-slate-950 font-black text-[10px]">
                        #{String(idx + 1).padStart(2, '0')} (Clip {String(clip.clipNumber).padStart(2, '0')})
                      </span>
                      <span className="text-[10px] font-mono text-slate-400">
                        {formatTimeMMSS(clip.start)}-{formatTimeMMSS(clip.end)}
                      </span>
                    </div>

                    {clip.posterUrl && (
                      <div className="h-12 w-full rounded overflow-hidden bg-black border border-slate-800">
                        <img
                          src={clip.posterUrl}
                          alt={clip.fileName}
                          className="w-full h-full object-cover"
                        />
                      </div>
                    )}

                    <div className="text-[10px] font-mono text-emerald-300 truncate" title={clip.fileName}>
                      {clip.fileName}
                    </div>

                    <div className="flex items-center justify-between text-[9px] text-slate-400 pt-0.5 border-t border-slate-800/80">
                      <span>
                        {clip.duration}s • {clip.speed}x
                      </span>
                      <span>Foley {clip.foleyVolume}%</span>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

          {/* TRACK 4: VOICEOVER NARRATION (VOXFLOW) */}
          <div className="flex items-center gap-2 min-w-max">
            <div className="w-44 shrink-0 px-2.5 py-2 rounded-lg bg-slate-900 border border-slate-800 text-[11px] font-bold text-emerald-300">
              4. 🎙️ Voz Narrativa
            </div>
            <div className="flex items-center gap-2 bg-slate-950/80 border border-slate-800/80 rounded-lg p-1.5">
              {/* Initial Silence Block for Clip 1 Hook */}
              <div
                style={{ width: `${Math.max(70, voiceStartOffsetSec * timelineZoom)}px` }}
                className="px-2 py-1.5 rounded bg-slate-900 border border-dashed border-slate-700 text-[10px] text-slate-400 text-center truncate"
              >
                🔇 {voiceStartOffsetSec}s Hook Sin Voz
              </div>
              {/* Main Voiceover Bar */}
              <div className="px-4 py-1.5 rounded bg-emerald-500/20 border border-emerald-500/40 text-[11px] text-emerald-200 font-bold flex items-center gap-3">
                <span>
                  🎙️ Pista Maestra de Voz Narrativa ({formatTimeMMSS(voiceStartOffsetSec)} →{' '}
                  {formatTimeMMSS(totalDurationSec)}) • Vol: {voiceVolume}%
                </span>
                <div className="flex items-center gap-1">
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
          <div className="flex items-center gap-2 min-w-max">
            <div className="w-44 shrink-0 px-2.5 py-2 rounded-lg bg-slate-900 border border-slate-800 text-[11px] font-bold text-purple-300">
              5. 🎵 Música Suno ({musicTracks.length})
            </div>
            <div className="flex items-center gap-2 bg-slate-950/80 border border-slate-800/80 rounded-lg p-1.5">
              {musicTracks.length === 0 ? (
                <span className="text-[11px] text-slate-500 px-3 py-1">
                  Las pistas instrumentales de la Etapa 10 (Suno) aparecen aquí respetando los silencios de 15s y el cierre de 1:30.
                </span>
              ) : (
                musicTracks.map((mt, mIdx) => (
                  <React.Fragment key={mt.id}>
                    {mIdx > 0 && (
                      <div className="px-2 py-1 rounded bg-slate-900 border border-dashed border-slate-700 text-[10px] text-slate-400">
                        🔇 Silencio 15s
                      </div>
                    )}
                    <div className="px-3 py-1.5 rounded bg-purple-950/60 border border-purple-500/40 text-[11px] text-purple-200 flex items-center gap-2">
                      <Music className="w-3 h-3 text-purple-400" />
                      <span>
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
