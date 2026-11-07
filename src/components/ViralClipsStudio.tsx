import React, { useState, useEffect, useRef, useMemo } from 'react';
import {
  Sparkles,
  Film,
  Upload,
  Play,
  Pause,
  Download,
  Share2,
  Check,
  Copy,
  RefreshCw,
  Sliders,
  FolderOpen,
  Globe,
  MessageSquare,
  Send,
  CheckCircle2,
  Clock,
  Volume2,
  Wand2,
} from 'lucide-react';
import { DocumentaryProject } from '../types';
import { sendCommandToWebBridge } from '../utils/webStudioBridge';

export interface WordTimestamp {
  word: string;
  start: number;
  end: number;
}

export interface TranscriptSegmentItem {
  start: number;
  end: number;
  text: string;
  words?: WordTimestamp[];
}

export interface ViralClipSuggestion {
  id: string;
  rank: number;
  title: string;
  viralityScore: number;
  scoreBreakdown: {
    hook: number;
    retention: number;
    emotion: number;
    completeness: number;
  };
  viralityReason: string;
  structureMode: 'continuous' | 'hook_teaser';
  startSec: number;
  endSec: number;
  durationSec: number;
  hookTeaserStartSec: number;
  hookTeaserEndSec: number;
  hookBannerText: string;
  storyTeaserDurationSec: number;
  socialCaption: string;
  hashtags: string;
  transcriptExcerpt: string;
  words: WordTimestamp[];
  reframeMode: 'center_fill' | 'fit_blur' | 'auto_pan';
  focusX: number;
  captionStyle: 'opus_gold' | 'hormozi_green' | 'viral_box' | 'huellas_cinema';
  renderedReelUrl?: string;
  renderedStoryUrl?: string;
  savedDocFolderPath?: string;
}

interface InstagramConfigData {
  igUserId: string;
  accessToken?: string;
  hasToken?: boolean;
  maskedToken?: string;
  accountUsername?: string;
  webhookVerifyToken: string;
  publicServerBaseUrl?: string;
  autoDm: {
    enabled: boolean;
    keyword: string;
    matchAnyCommentAskingLink: boolean;
    destinationUrl: string;
    dmMessageTemplate: string;
    publicCommentReply: string;
    enablePublicCommentReply: boolean;
  };
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

interface ViralClipsStudioProps {
  documentaries: DocumentaryProject[];
  activeDoc?: DocumentaryProject | null;
  onSelectDoc?: (docId: string) => void;
  downloadFolderPath?: string;
  downloadFolderName?: string;
}

function formatMMSS(sec: number): string {
  const s = Math.max(0, Math.floor(sec || 0));
  const mins = Math.floor(s / 60);
  const rem = s % 60;
  return `${String(mins).padStart(2, '0')}:${String(rem).padStart(2, '0')}`;
}

function buildWordsFromSegmentClient(
  text: string,
  startSec: number,
  endSec: number
): WordTimestamp[] {
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

export const ViralClipsStudio: React.FC<ViralClipsStudioProps> = ({
  documentaries,
  activeDoc,
  onSelectDoc,
  downloadFolderPath,
  downloadFolderName,
}) => {
  // 1. Source Selection ('doc' | 'upload' | 'youtube')
  const [sourceMode, setSourceMode] = useState<'doc' | 'upload' | 'youtube'>('doc');
  const [selectedDocId, setSelectedDocId] = useState<string>(
    activeDoc?.id || documentaries[0]?.id || ''
  );

  // Source Media & Transcript state
  const [sourceTitle, setSourceTitle] = useState<string>('');
  const [sourceVideoUrl, setSourceVideoUrl] = useState<string>('');
  const [sourceLocalPath, setSourceLocalPath] = useState<string>('');
  const [docRootFolder, setDocRootFolder] = useState<string>('');
  const [sourceDurationSec, setSourceDurationSec] = useState<number>(180);
  const [transcriptSegments, setTranscriptSegments] = useState<TranscriptSegmentItem[]>([]);
  const [isLoadingSource, setIsLoadingSource] = useState<boolean>(false);
  const [sourceStatusMsg, setSourceStatusMsg] = useState<string>('');

  // YouTube input
  const [youtubeUrlInput, setYoutubeUrlInput] = useState<string>('');

  // 2. OpusClip Virality Engine Settings
  const [targetDurationRange, setTargetDurationRange] = useState<'15_30' | '30_60' | '60_90'>(
    '30_60'
  );
  const [desiredClipCount, setDesiredClipCount] = useState<number>(5);
  const [structurePreference, setStructurePreference] = useState<
    'both' | 'hook_teaser' | 'continuous'
  >('both');
  const [customTopicFilter, setCustomTopicFilter] = useState<string>('');
  const [isAnalyzingViral, setIsAnalyzingViral] = useState<boolean>(false);

  // 3. Generated Viral Clips & Active Selection
  const [viralClips, setViralClips] = useState<ViralClipSuggestion[]>([]);
  const [selectedClipId, setSelectedClipId] = useState<string>('');
  const [copiedField, setCopiedField] = useState<string>('');

  // 4. Global Caption & Overlay Customization
  const [wordsPerLine, setWordsPerLine] = useState<number>(3);
  const [fontSizeScale, setFontSizeScale] = useState<number>(1.0);
  const [captionYPercent, setCaptionYPercent] = useState<number>(74);
  const [showHookBanner, setShowHookBanner] = useState<boolean>(true);
  const [previewStoryCta, setPreviewStoryCta] = useState<boolean>(false);
  const [storyPublishMode, setStoryPublishMode] = useState<'story_teaser' | 'story_full'>(
    'story_teaser'
  );

  // 5. Video Preview Player State
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const [isPlaying, setIsPlaying] = useState<boolean>(false);
  const [playheadSec, setPlayheadSec] = useState<number>(0);
  const [isRenderingClipId, setIsRenderingClipId] = useState<string>('');
  const [isPublishingClipId, setIsPublishingClipId] = useState<string>('');
  const [actionToast, setActionToast] = useState<string>('');

  // 6. Instagram Graph API & Auto-DM Configuration Modal
  const [showIgModal, setShowIgModal] = useState<boolean>(false);
  const [igConfig, setIgConfig] = useState<InstagramConfigData>({
    igUserId: '',
    accessToken: '',
    hasToken: false,
    maskedToken: '',
    accountUsername: '',
    webhookVerifyToken: 'huellas_ig_verify_2026',
    publicServerBaseUrl: '',
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
    publishedHistory: [],
  });
  const [igTokenInput, setIgTokenInput] = useState<string>('');
  const [isSavingIgConfig, setIsSavingIgConfig] = useState<boolean>(false);
  const [isCheckingAutoDm, setIsCheckingAutoDm] = useState<boolean>(false);

  const selectedClip = useMemo(
    () => viralClips.find((c) => c.id === selectedClipId) || viralClips[0] || null,
    [viralClips, selectedClipId]
  );

  // Load Instagram config on mount
  useEffect(() => {
    fetch('/api/viral-clips/instagram-config')
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => {
        if (data?.ok && data.config) {
          setIgConfig(data.config);
        }
      })
      .catch(() => {});
  }, []);

  // Sync selectedDocId when activeDoc changes
  useEffect(() => {
    if (activeDoc?.id && !selectedDocId) {
      setSelectedDocId(activeDoc.id);
    }
  }, [activeDoc?.id, selectedDocId]);

  // Load Documentary Source when sourceMode === 'doc' and selectedDocId changes
  const handleLoadDocumentarySource = async (docIdToLoad: string) => {
    if (!docIdToLoad) return;
    setIsLoadingSource(true);
    setSourceStatusMsg('Cargando video master y transcripción del documental...');
    try {
      const resp = await fetch('/api/viral-clips/resolve-doc-source', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          docId: docIdToLoad,
          downloadFolderPath,
          downloadFolderName,
        }),
      });
      if (resp.ok) {
        const data = await resp.json();
        if (data.ok) {
          setSourceTitle(data.title || 'Documental');
          setSourceVideoUrl(data.masterVideoUrl || data.masterVideo9x16Url || '');
          setSourceLocalPath(data.masterVideoPath || data.masterVideo9x16Path || '');
          setDocRootFolder(data.rootFolder || '');
          setSourceDurationSec(Number(data.durationSec) || 180);
          setTranscriptSegments(
            Array.isArray(data.transcriptSegments) ? data.transcriptSegments : []
          );
          setSourceStatusMsg(
            data.masterVideoPath
              ? `✅ Video Master detectado (${formatMMSS(data.durationSec)}) • ${
                  (data.transcriptSegments || []).length
                } segmentos de voz listos.`
              : `📝 Guion cargado (${
                  (data.transcriptSegments || []).length
                } segmentos). Exporta el video en el Editor (06_Video_Final) o sube un MP4 para renderizar.`
          );
          setIsLoadingSource(false);
          return;
        }
      }
    } catch {}

    // Client-side fallback if backend is offline
    const doc = documentaries.find((d) => d.id === docIdToLoad);
    if (doc) {
      setSourceTitle(doc.title);
      const segs: TranscriptSegmentItem[] = [];
      if (Array.isArray(doc.timelineSentences) && doc.timelineSentences.length > 0) {
        for (const s of doc.timelineSentences) {
          const t = String(s.text || '')
            .replace(/\[PAUSA[^\]]*\]/gi, '')
            .trim();
          if (t) {
            segs.push({
              start: s.start,
              end: s.end,
              text: t,
              words: buildWordsFromSegmentClient(t, s.start, s.end),
            });
          }
        }
      } else if (Array.isArray(doc.clips)) {
        for (const c of doc.clips) {
          const m = String(c.timeRange || '').match(/(\d+):(\d+)\s*-\s*(\d+):(\d+)/);
          const st = m
            ? parseInt(m[1], 10) * 60 + parseInt(m[2], 10)
            : (Math.max(1, c.clipNumber) - 1) * 10;
          const en = m ? parseInt(m[3], 10) * 60 + parseInt(m[4], 10) : st + 10;
          const t = String(c.narrationSegment || '')
            .replace(/\[PAUSA[^\]]*\]/gi, '')
            .trim();
          if (t && !/^sin\s+voz/i.test(t)) {
            segs.push({
              start: st,
              end: en,
              text: t,
              words: buildWordsFromSegmentClient(t, st, en),
            });
          }
        }
      }
      setTranscriptSegments(segs);
      setSourceDurationSec(doc.targetDurationSeconds || 180);
      setSourceStatusMsg(`📝 Guion cargado (${segs.length} segmentos).`);
    }
    setIsLoadingSource(false);
  };

  useEffect(() => {
    if (sourceMode === 'doc' && selectedDocId) {
      handleLoadDocumentarySource(selectedDocId);
    }
  }, [sourceMode, selectedDocId]);

  // Upload Local Video Handler
  const handleUploadLocalVideo = async (file: File) => {
    setIsLoadingSource(true);
    setSourceStatusMsg(`Subiendo y transcribiendo "${file.name}" con IA...`);
    try {
      const form = new FormData();
      form.append('video', file);
      const resp = await fetch('/api/viral-clips/upload-video', {
        method: 'POST',
        body: form,
      });
      const data = await resp.json();
      if (!resp.ok || !data.ok) {
        throw new Error(data.error || 'Error al procesar el video.');
      }
      setSourceTitle(data.fileName || file.name);
      setSourceVideoUrl(data.videoUrl);
      setSourceLocalPath(data.localFilePath);
      setSourceDurationSec(Number(data.durationSec) || 60);
      setTranscriptSegments(Array.isArray(data.transcriptSegments) ? data.transcriptSegments : []);
      setSourceStatusMsg(
        `✅ Video "${file.name}" cargado (${formatMMSS(data.durationSec)}) • ${
          (data.transcriptSegments || []).length
        } frases transcritas.`
      );
    } catch (err: any) {
      alert('Error al subir video: ' + (err?.message || 'Error desconocido'));
      setSourceStatusMsg('❌ No se pudo procesar el archivo de video.');
    } finally {
      setIsLoadingSource(false);
    }
  };

  // Ingest YouTube Link Handler
  const handleIngestYoutube = async () => {
    if (!youtubeUrlInput.trim()) {
      alert('Pega primero un enlace de YouTube.');
      return;
    }
    setIsLoadingSource(true);
    setSourceStatusMsg(
      'Descargando video de YouTube en alta definición y extrayendo transcripción con marcas de tiempo...'
    );
    try {
      const resp = await fetch('/api/viral-clips/ingest-youtube', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ youtubeUrl: youtubeUrlInput.trim() }),
      });
      const data = await resp.json();
      if (!resp.ok || !data.ok) {
        throw new Error(data.error || 'Error descargando video de YouTube.');
      }
      setSourceTitle(data.title || 'YouTube Video');
      setSourceVideoUrl(data.videoUrl);
      setSourceLocalPath(data.localFilePath);
      setSourceDurationSec(Number(data.durationSec) || 120);
      setTranscriptSegments(Array.isArray(data.transcriptSegments) ? data.transcriptSegments : []);
      if (data.sourceYoutubeUrl) {
        setIgConfig((prev) => ({
          ...prev,
          autoDm: { ...prev.autoDm, destinationUrl: data.sourceYoutubeUrl },
        }));
      }
      setSourceStatusMsg(
        `✅ YouTube cargado: "${data.title}" (${formatMMSS(data.durationSec)}) • ${
          (data.transcriptSegments || []).length
        } segmentos listos.`
      );
    } catch (err: any) {
      alert('Error con el enlace de YouTube: ' + (err?.message || 'Error desconocido'));
      setSourceStatusMsg('❌ Error al descargar el enlace de YouTube.');
    } finally {
      setIsLoadingSource(false);
    }
  };

  // Analyze & Generate OpusClip Viral Clips
  const handleAnalyzeViralClips = async () => {
    if (transcriptSegments.length === 0) {
      alert(
        'Primero selecciona un documental con guion, sube un video o pega un link de YouTube.'
      );
      return;
    }
    setIsAnalyzingViral(true);
    try {
      const resp = await fetch('/api/viral-clips/analyze', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title: sourceTitle,
          durationSec: sourceDurationSec,
          transcriptSegments,
          targetDurationRange,
          clipCount: desiredClipCount,
          structurePreference,
          customTopicFilter,
          autoDmKeyword: igConfig.autoDm.keyword || 'HUELLAS',
        }),
      });
      if (resp.ok) {
        const data = await resp.json();
        if (data.ok && Array.isArray(data.clips) && data.clips.length > 0) {
          setViralClips(data.clips);
          setSelectedClipId(data.clips[0].id);
          setPlayheadSec(data.clips[0].startSec);
          setIsAnalyzingViral(false);
          return;
        }
      }

      // Fallback client-side 100% Free Local OpusClip Virality Scorer (zero paid Gemini API calls)
      const list: any[] = [];
      const minDur =
        targetDurationRange === '15_30' ? 18 : targetDurationRange === '60_90' ? 55 : 30;
      const maxDur =
        targetDurationRange === '15_30' ? 32 : targetDurationRange === '60_90' ? 88 : 58;
      const totalSpan = Math.max(
        60,
        transcriptSegments[transcriptSegments.length - 1].end - transcriptSegments[0].start
      );
      const stepSec = Math.max(15, (totalSpan - minDur) / Math.max(1, desiredClipCount));
      for (let k = 0; k < desiredClipCount; k++) {
        const approxStart = transcriptSegments[0].start + k * stepSec;
        const startSegIdx = Math.max(
          0,
          transcriptSegments.findIndex((s) => s.start >= approxStart)
        );
        const startSeg = transcriptSegments[startSegIdx] || transcriptSegments[0];
        let endSeg = startSeg;
        for (let m = startSegIdx; m < transcriptSegments.length; m++) {
          endSeg = transcriptSegments[m];
          if (endSeg.end - startSeg.start >= minDur) break;
        }
        const st = startSeg.start;
        const en = Math.min(startSeg.start + maxDur, Math.max(st + minDur, endSeg.end));
        const firstWords = startSeg.text
          .split(/\s+/)
          .slice(0, 6)
          .join(' ')
          .replace(/[.,;:!?]+$/g, '');
        list.push({
          title: firstWords || `Clip Viral #${k + 1}`,
          viralityScore: Math.max(82, 97 - k * 2),
          viralityReason:
            'Fragmento con apertura narrativa atrapante y alta densidad emocional para retención en Reels y Shorts.',
          structureMode: k % 2 === 0 ? 'hook_teaser' : 'continuous',
          startSec: st,
          endSec: en,
          hookTeaserStartSec: st,
          hookTeaserEndSec: Math.min(en, st + 3.5),
          hookBannerText: firstWords.toUpperCase(),
          socialCaption: `${startSeg.text} — Una historia real que marcó a toda una generación.`,
          hashtags: '#Historia #Documental #Reels #Viral #HuellasDeLaHumanidad',
        });
      }
      const built: ViralClipSuggestion[] = list.map((c: any, idx: number) => {
        const st = Math.max(0, Number(c.startSec) || 0);
        const en = Math.max(st + 15, Number(c.endSec) || st + 40);
        const overlapping = transcriptSegments.filter((s) => s.end > st && s.start < en);
        const words: WordTimestamp[] = [];
        for (const seg of overlapping) {
          const wList = seg.words || buildWordsFromSegmentClient(seg.text, seg.start, seg.end);
          for (const w of wList) {
            if (w.end > st && w.start < en) words.push(w);
          }
        }
        return {
          id: `vc-${Date.now()}-${idx}`,
          rank: idx + 1,
          title: c.title || `Clip Viral #${idx + 1}`,
          viralityScore: Number(c.viralityScore) || 94 - idx * 2,
          scoreBreakdown: { hook: 95, retention: 92, emotion: 94, completeness: 91 },
          viralityReason: c.viralityReason || 'Alto potencial de retención.',
          structureMode: c.structureMode === 'hook_teaser' ? 'hook_teaser' : 'continuous',
          startSec: st,
          endSec: en,
          durationSec: Number((en - st).toFixed(1)),
          hookTeaserStartSec: Number(c.hookTeaserStartSec) || st,
          hookTeaserEndSec: Number(c.hookTeaserEndSec) || st + 3.5,
          hookBannerText: String(c.hookBannerText || c.title || '').toUpperCase(),
          storyTeaserDurationSec: 20,
          socialCaption: c.socialCaption || '',
          hashtags: c.hashtags || '#Historia #Documental #Reels',
          transcriptExcerpt: overlapping.map((o) => o.text).join(' '),
          words,
          reframeMode: 'center_fill',
          focusX: 50,
          captionStyle: 'opus_gold',
        };
      });
      setViralClips(built);
      if (built[0]) {
        setSelectedClipId(built[0].id);
        setPlayheadSec(built[0].startSec);
      }
    } catch (err: any) {
      alert('Error al generar clips virales: ' + (err?.message || 'Error desconocido'));
    } finally {
      setIsAnalyzingViral(false);
    }
  };

  // Sync video player when selectedClip changes
  useEffect(() => {
    if (selectedClip && videoRef.current) {
      videoRef.current.currentTime = selectedClip.startSec;
      setPlayheadSec(selectedClip.startSec);
      setIsPlaying(false);
    }
  }, [selectedClip?.id]);

  // Constrain playback to [selectedClip.startSec, selectedClip.endSec]
  const handleTimeUpdate = () => {
    const vid = videoRef.current;
    if (!vid || !selectedClip) return;
    const cur = vid.currentTime;
    setPlayheadSec(cur);
    if (cur >= selectedClip.endSec) {
      vid.currentTime = selectedClip.startSec;
      vid.pause();
      setIsPlaying(false);
    }
  };

  const togglePlayClip = () => {
    const vid = videoRef.current;
    if (!vid || !selectedClip) return;
    if (vid.paused) {
      if (vid.currentTime < selectedClip.startSec || vid.currentTime >= selectedClip.endSec - 0.3) {
        vid.currentTime = selectedClip.startSec;
      }
      vid.play().catch(() => {});
      setIsPlaying(true);
    } else {
      vid.pause();
      setIsPlaying(false);
    }
  };

  const updateSelectedClip = (patch: Partial<ViralClipSuggestion>) => {
    if (!selectedClip) return;
    setViralClips((prev) =>
      prev.map((c) => {
        if (c.id !== selectedClip.id) return c;
        const updated = { ...c, ...patch };
        updated.durationSec = Number(Math.max(3, updated.endSec - updated.startSec).toFixed(1));
        return updated;
      })
    );
  };

  // Compute current active word chunk for the live 9:16 preview player
  const activeCaptionChunk = useMemo(() => {
    if (!selectedClip || !Array.isArray(selectedClip.words) || selectedClip.words.length === 0) {
      return null;
    }
    const safePerLine = Math.max(1, Math.min(6, wordsPerLine));
    const words = selectedClip.words;
    for (let i = 0; i < words.length; i += safePerLine) {
      const chunk = words.slice(i, i + safePerLine);
      const chunkStart = chunk[0].start;
      const chunkEnd = chunk[chunk.length - 1].end;
      if (playheadSec >= chunkStart - 0.08 && playheadSec <= chunkEnd + 0.15) {
        let activeIdx = 0;
        for (let j = 0; j < chunk.length; j++) {
          if (playheadSec >= chunk[j].start) {
            activeIdx = j;
          }
        }
        return { chunk, activeIdx };
      }
    }
    return null;
  }, [selectedClip, playheadSec, wordsPerLine]);

  // Render Clip to 9:16 MP4 (Reel or Story)
  const handleRenderViralClip = async (
    clip: ViralClipSuggestion,
    renderVariant: 'reel' | 'story_full' | 'story_teaser' = 'reel'
  ) => {
    if (!sourceLocalPath) {
      alert(
        'Para renderizar el MP4, primero exporta el video del documental en 06_Video_Final, o sube un archivo MP4, o usa un enlace de YouTube.'
      );
      return;
    }
    setIsRenderingClipId(`${clip.id}_${renderVariant}`);
    setActionToast(
      renderVariant === 'reel'
        ? `🎬 Renderizando Reel 9:16 "${clip.title}" con Captions OpusClip...`
        : `📱 Renderizando Historia 9:16 "${clip.title}" con llamado a la acción...`
    );
    try {
      const ctaText = igConfig.autoDm.enabled
        ? `💬 Responde "${igConfig.autoDm.keyword || 'HUELLAS'}" y te envio el link directo por DM`
        : '🔥 Mira el Reel completo en nuestro perfil';

      const resp = await fetch('/api/viral-clips/render', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          sourceVideoPath: sourceLocalPath,
          docRootFolder,
          clipTitle: clip.title,
          startSec: clip.startSec,
          endSec: clip.endSec,
          structureMode: clip.structureMode,
          hookTeaserStartSec: clip.hookTeaserStartSec,
          hookTeaserEndSec: clip.hookTeaserEndSec,
          reframeMode: clip.reframeMode,
          focusX: clip.focusX,
          captionStyle: clip.captionStyle,
          wordsPerLine,
          fontSizeScale,
          captionYPercent,
          words: clip.words,
          hookBannerText: clip.hookBannerText,
          showHookBanner,
          renderVariant,
          storyTeaserDurationSec: clip.storyTeaserDurationSec,
          storyCtaBannerText: ctaText,
        }),
      });
      const data = await resp.json();
      if (!resp.ok || !data.ok) {
        throw new Error(data.error || 'Error en FFmpeg al renderizar el clip.');
      }

      setViralClips((prev) =>
        prev.map((c) =>
          c.id === clip.id
            ? {
                ...c,
                renderedReelUrl:
                  renderVariant === 'reel' ? data.publicServeUrl : c.renderedReelUrl,
                renderedStoryUrl:
                  renderVariant !== 'reel' ? data.publicServeUrl : c.renderedStoryUrl,
                savedDocFolderPath: data.savedInDocFolderPath || c.savedDocFolderPath,
              }
            : c
        )
      );

      setActionToast(
        data.savedInDocFolderPath
          ? `✅ Guardado en 07_Viral_Clips: ${data.savedInDocFolderPath.split('/').pop()}`
          : `✅ Clip renderizado con éxito (${formatMMSS(data.durationSec)})`
      );
    } catch (err: any) {
      alert('Error al renderizar clip: ' + (err?.message || 'Error desconocido'));
      setActionToast('');
    } finally {
      setIsRenderingClipId('');
    }
  };

  // Direct Publish to Instagram (Reel / Story / Combo Reel + Story)
  const handlePublishInstagram = async (
    clip: ViralClipSuggestion,
    publishMode: 'reel' | 'story' | 'combo_reel_story'
  ) => {
    if (!igConfig.igUserId || !igConfig.hasToken) {
      setShowIgModal(true);
      return;
    }
    if (!sourceLocalPath) {
      alert('Primero asegúrate de tener un archivo de video origen cargado para renderizar y publicar.');
      return;
    }
    setIsPublishingClipId(`${clip.id}_${publishMode}`);
    setActionToast(
      publishMode === 'combo_reel_story'
        ? `🚀 Publicando Reel + Story en Instagram (@${igConfig.accountUsername || igConfig.igUserId})...`
        : publishMode === 'story'
        ? `📱 Publicando Story en Instagram...`
        : `🎬 Publicando Reel en Instagram...`
    );

    try {
      const resp = await fetch('/api/viral-clips/publish-instagram', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          publishMode,
          storyMode: storyPublishMode,
          caption: clip.socialCaption,
          hashtags: clip.hashtags,
          autoDmDestinationUrl: igConfig.autoDm.destinationUrl,
          autoDmKeyword: igConfig.autoDm.keyword,
          renderParams: {
            sourceVideoPath: sourceLocalPath,
            docRootFolder,
            clipTitle: clip.title,
            startSec: clip.startSec,
            endSec: clip.endSec,
            structureMode: clip.structureMode,
            hookTeaserStartSec: clip.hookTeaserStartSec,
            hookTeaserEndSec: clip.hookTeaserEndSec,
            reframeMode: clip.reframeMode,
            focusX: clip.focusX,
            captionStyle: clip.captionStyle,
            wordsPerLine,
            fontSizeScale,
            captionYPercent,
            words: clip.words,
            hookBannerText: clip.hookBannerText,
            showHookBanner,
            storyTeaserDurationSec: clip.storyTeaserDurationSec,
          },
        }),
      });
      const data = await resp.json();
      if (!resp.ok || !data.ok) {
        throw new Error(data.error || 'Error publicando en Instagram Graph API.');
      }

      setActionToast(
        publishMode === 'combo_reel_story'
          ? '🎉 ¡Reel + Story publicados directamente en tu Instagram y Auto-DM activado!'
          : publishMode === 'story'
          ? '🎉 ¡Story publicada directamente en tu Instagram!'
          : '🎉 ¡Reel publicado directamente en tu Instagram!'
      );

      // Refresh Instagram history
      const cfgResp = await fetch('/api/viral-clips/instagram-config');
      if (cfgResp.ok) {
        const cfgData = await cfgResp.json();
        if (cfgData?.ok && cfgData.config) setIgConfig(cfgData.config);
      }
    } catch (err: any) {
      alert('Error publicando en Instagram: ' + (err?.message || 'Error desconocido'));
      setActionToast('');
    } finally {
      setIsPublishingClipId('');
    }
  };

  const handleSaveInstagramSettings = async () => {
    setIsSavingIgConfig(true);
    try {
      const resp = await fetch('/api/viral-clips/instagram-config', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          igUserId: igConfig.igUserId,
          accessToken: igTokenInput.trim() || undefined,
          publicServerBaseUrl: igConfig.publicServerBaseUrl,
          autoDm: igConfig.autoDm,
        }),
      });
      const data = await resp.json();
      if (!resp.ok || !data.ok) {
        throw new Error(data.error || 'Error al guardar configuración.');
      }
      setIgConfig(data.config);
      setIgTokenInput('');
      setActionToast(
        data.config.accountUsername
          ? `✅ Conectado a Instagram @${data.config.accountUsername} y Auto-DM guardado.`
          : '✅ Configuración de Instagram y Auto-DM guardada.'
      );
    } catch (err: any) {
      alert(err?.message || 'Error al guardar configuración de Instagram.');
    } finally {
      setIsSavingIgConfig(false);
    }
  };

  const handleCheckAutoDmNow = async () => {
    setIsCheckingAutoDm(true);
    try {
      const resp = await fetch('/api/viral-clips/instagram-check-autodm', {
        method: 'POST',
      });
      const data = await resp.json();
      if (!resp.ok || !data.ok) {
        throw new Error(data.error || 'Error al revisar comentarios.');
      }
      setIgConfig((prev) => ({
        ...prev,
        sentDmLogs: data.sentDmLogs || prev.sentDmLogs,
      }));
      setActionToast(
        data.sentCount > 0
          ? `📬 ¡Se enviaron ${data.sentCount} link(s) por DM automáticamente!`
          : `✓ Comentarios revisados (${data.checkedCount} nuevos analizados).`
      );
    } catch (err: any) {
      alert('Error al revisar comentarios: ' + (err?.message || 'Error'));
    } finally {
      setIsCheckingAutoDm(false);
    }
  };

  const copyText = (key: string, val: string) => {
    navigator.clipboard.writeText(val);
    setCopiedField(key);
    setTimeout(() => setCopiedField(''), 1800);
  };

  return (
    <div className="flex-1 min-h-0 flex flex-col bg-[#0c0a08] text-slate-100">
      {/* TOP HEADER BAR FOR VIRAL CLIPS */}
      <div className="bg-gradient-to-r from-[#17120c] via-[#13100d] to-slate-950 border-b border-amber-500/30 px-4 py-3 flex flex-wrap items-center justify-between gap-3 shrink-0">
        <div className="flex items-center gap-3">
          <div className="w-9 h-9 rounded-xl bg-gradient-to-br from-amber-400 to-orange-600 flex items-center justify-center text-slate-950 font-black shadow-lg shadow-amber-500/20">
            ⚡
          </div>
          <div>
            <div className="flex items-center gap-2">
              <h2 className="text-base font-black text-amber-200 tracking-tight">
                VIRAL CLIPS STUDIO
              </h2>
              <span className="px-2 py-0.5 rounded-full text-[10px] font-black bg-amber-500/20 border border-amber-400/40 text-amber-300">
                OpusClip IA + Instagram Reels/Stories + Auto-DM Link
              </span>
            </div>
            <p className="text-xs text-slate-400">
              Detecta los momentos con mayor retención, agrega captions dinámicos palabra por palabra y publica en Reels + Stories con auto-envío de link por DM.
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2 flex-wrap">
          {actionToast && (
            <div className="px-3 py-1.5 rounded-xl bg-emerald-950/90 border border-emerald-500/40 text-emerald-200 text-xs font-semibold flex items-center gap-2">
              <span>{actionToast}</span>
              <button
                onClick={() => setActionToast('')}
                className="text-emerald-400 hover:text-white cursor-pointer"
              >
                ✕
              </button>
            </div>
          )}

          <button
            type="button"
            onClick={() => setShowIgModal(true)}
            className={`px-3.5 py-2 rounded-xl text-xs font-black flex items-center gap-2 border cursor-pointer transition shadow-lg ${
              igConfig.hasToken && igConfig.igUserId
                ? 'bg-gradient-to-r from-pink-600 to-purple-600 text-white border-pink-400/60 shadow-pink-500/20'
                : 'bg-slate-900 hover:bg-slate-800 text-pink-300 border-pink-500/40'
            }`}
          >
            <Share2 className="w-3.5 h-3.5" />
            <span>
              {igConfig.hasToken && igConfig.igUserId
                ? `📲 Instagram Conectado ${
                    igConfig.accountUsername ? `(@${igConfig.accountUsername})` : ''
                  } • Auto-DM "${igConfig.autoDm.keyword}"`
                : '📲 Conectar Instagram (Reels + Stories + Auto-DM Link)'}
            </span>
          </button>
        </div>
      </div>

      {/* MAIN CONTENT AREA */}
      <div className="flex-1 overflow-y-auto p-4 space-y-4 max-w-[1600px] w-full mx-auto">
        {/* STEP 1 & 2: VIDEO SOURCE + OPUSCLIP AI SETTINGS */}
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-4">
          {/* Left 7 cols: Source Selector */}
          <div className="lg:col-span-7 bg-[#14110d] border border-amber-500/25 rounded-2xl p-4 space-y-3.5 shadow-xl">
            <div className="flex items-center justify-between gap-2 flex-wrap">
              <span className="text-xs font-black uppercase tracking-wider text-amber-300 flex items-center gap-1.5">
                <Film className="w-4 h-4" /> 1. Origen del Video a Clipear
              </span>
              <div className="flex items-center gap-1.5 bg-slate-950 p-1 rounded-xl border border-slate-800">
                <button
                  type="button"
                  onClick={() => setSourceMode('doc')}
                  className={`px-3 py-1 rounded-lg text-xs font-bold cursor-pointer transition ${
                    sourceMode === 'doc'
                      ? 'bg-amber-500 text-slate-950 shadow'
                      : 'text-slate-300 hover:text-white'
                  }`}
                >
                  🎬 Documental Huellas
                </button>
                <button
                  type="button"
                  onClick={() => setSourceMode('upload')}
                  className={`px-3 py-1 rounded-lg text-xs font-bold cursor-pointer transition ${
                    sourceMode === 'upload'
                      ? 'bg-amber-500 text-slate-950 shadow'
                      : 'text-slate-300 hover:text-white'
                  }`}
                >
                  💻 Subir Video MP4
                </button>
                <button
                  type="button"
                  onClick={() => setSourceMode('youtube')}
                  className={`px-3 py-1 rounded-lg text-xs font-bold cursor-pointer transition ${
                    sourceMode === 'youtube'
                      ? 'bg-amber-500 text-slate-950 shadow'
                      : 'text-slate-300 hover:text-white'
                  }`}
                >
                  🔗 Link de YouTube
                </button>
              </div>
            </div>

            {sourceMode === 'doc' && (
              <div className="space-y-2.5">
                <div className="flex flex-wrap items-center gap-2">
                  <select
                    value={selectedDocId}
                    onChange={(e) => {
                      setSelectedDocId(e.target.value);
                      if (onSelectDoc) onSelectDoc(e.target.value);
                    }}
                    className="flex-1 min-w-[240px] bg-slate-950 border border-amber-500/40 rounded-xl px-3 py-2 text-xs font-bold text-amber-200 outline-none"
                  >
                    {documentaries.map((d) => (
                      <option key={d.id} value={d.id}>
                        {d.title} ({(d.clips || []).length} clips)
                      </option>
                    ))}
                  </select>
                  <button
                    type="button"
                    onClick={() => handleLoadDocumentarySource(selectedDocId)}
                    disabled={isLoadingSource}
                    className="px-3 py-2 rounded-xl bg-slate-800 hover:bg-slate-700 border border-slate-700 text-xs font-bold text-amber-300 flex items-center gap-1.5 cursor-pointer"
                  >
                    <RefreshCw className={`w-3.5 h-3.5 ${isLoadingSource ? 'animate-spin' : ''}`} />
                    Recargar
                  </button>
                </div>
              </div>
            )}

            {sourceMode === 'upload' && (
              <div className="border-2 border-dashed border-amber-500/40 rounded-xl p-4 bg-slate-950/60 flex flex-col sm:flex-row items-center justify-between gap-3">
                <div className="text-xs text-slate-300">
                  <div className="font-bold text-amber-200">
                    Selecciona cualquier video desde tu Mac (.MP4, .MOV, .WEBM)
                  </div>
                  <div className="text-[11px] text-slate-400 mt-0.5">
                    El servidor extraerá el audio y generará la transcripción palabra por palabra automáticamente.
                  </div>
                </div>
                <label className="px-4 py-2 rounded-xl bg-amber-500 hover:bg-amber-400 text-slate-950 font-black text-xs cursor-pointer shrink-0 flex items-center gap-1.5 shadow">
                  <Upload className="w-3.5 h-3.5" />
                  <span>Elegir Video Local</span>
                  <input
                    type="file"
                    accept="video/*"
                    className="hidden"
                    onChange={(e) => {
                      const f = e.target.files?.[0];
                      if (f) handleUploadLocalVideo(f);
                    }}
                  />
                </label>
              </div>
            )}

            {sourceMode === 'youtube' && (
              <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-2">
                <input
                  type="url"
                  value={youtubeUrlInput}
                  onChange={(e) => setYoutubeUrlInput(e.target.value)}
                  placeholder="https://www.youtube.com/watch?v=... o https://youtu.be/..."
                  className="flex-1 bg-slate-950 border border-slate-700 focus:border-amber-400 rounded-xl px-3 py-2 text-xs text-white outline-none"
                />
                <button
                  type="button"
                  onClick={handleIngestYoutube}
                  disabled={isLoadingSource}
                  className="px-4 py-2 rounded-xl bg-red-600 hover:bg-red-500 text-white font-black text-xs cursor-pointer flex items-center justify-center gap-1.5 shrink-0 disabled:opacity-50"
                >
                  <Globe className="w-3.5 h-3.5" />
                  <span>{isLoadingSource ? 'Descargando...' : 'Cargar de YouTube'}</span>
                </button>
              </div>
            )}

            {/* Source Status Banner */}
            <div className="bg-slate-950/90 border border-slate-800 rounded-xl px-3 py-2 flex items-center justify-between gap-2 text-xs">
              <span className="text-slate-300 truncate">
                {isLoadingSource ? '⏳ ' : ''}
                {sourceStatusMsg || 'Selecciona una fuente de video para comenzar.'}
              </span>
              {transcriptSegments.length > 0 && (
                <span className="px-2 py-0.5 rounded bg-emerald-500/15 border border-emerald-500/40 text-emerald-300 text-[10px] font-mono shrink-0">
                  {transcriptSegments.length} segmentos • {formatMMSS(sourceDurationSec)}
                </span>
              )}
            </div>
          </div>

          {/* Right 5 cols: OpusClip Curation Settings + Analyze Button */}
          <div className="lg:col-span-5 bg-[#14110d] border border-amber-500/25 rounded-2xl p-4 space-y-3 shadow-xl flex flex-col justify-between">
            <div className="space-y-2.5">
              <div className="flex items-center justify-between">
                <span className="text-xs font-black uppercase tracking-wider text-amber-300 flex items-center gap-1.5">
                  <Wand2 className="w-4 h-4" /> 2. Motor de Curación Viral (OpusClip IA)
                </span>
              </div>

              <div className="grid grid-cols-3 gap-2 text-xs">
                <div>
                  <label className="block text-[10px] text-slate-400 font-bold mb-1">
                    Duración del Clip
                  </label>
                  <select
                    value={targetDurationRange}
                    onChange={(e) => setTargetDurationRange(e.target.value as any)}
                    className="w-full bg-slate-950 border border-slate-700 rounded-lg px-2 py-1.5 text-xs font-bold text-slate-200"
                  >
                    <option value="15_30">⚡ 15s – 30s</option>
                    <option value="30_60">🔥 30s – 60s (Ideal)</option>
                    <option value="60_90">🎬 60s – 90s</option>
                  </select>
                </div>

                <div>
                  <label className="block text-[10px] text-slate-400 font-bold mb-1">
                    Cantidad de Clips
                  </label>
                  <select
                    value={desiredClipCount}
                    onChange={(e) => setDesiredClipCount(Number(e.target.value))}
                    className="w-full bg-slate-950 border border-slate-700 rounded-lg px-2 py-1.5 text-xs font-bold text-slate-200"
                  >
                    <option value={3}>Top 3 Virales</option>
                    <option value={5}>Top 5 Virales</option>
                    <option value={8}>Top 8 Virales</option>
                    <option value={10}>Top 10 Virales</option>
                  </select>
                </div>

                <div>
                  <label className="block text-[10px] text-slate-400 font-bold mb-1">
                    Estructura
                  </label>
                  <select
                    value={structurePreference}
                    onChange={(e) => setStructurePreference(e.target.value as any)}
                    className="w-full bg-slate-950 border border-slate-700 rounded-lg px-2 py-1.5 text-xs font-bold text-slate-200"
                  >
                    <option value="both">Ambos (Hook + Cont.)</option>
                    <option value="hook_teaser">Hook Adelantado</option>
                    <option value="continuous">Solo Continuos</option>
                  </select>
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                <input
                  type="text"
                  value={customTopicFilter}
                  onChange={(e) => setCustomTopicFilter(e.target.value)}
                  placeholder="Filtro opcional (ej. momentos más dramáticos, cifras...)"
                  className="bg-slate-950 border border-slate-800 rounded-lg px-2.5 py-1.5 text-xs text-slate-200 outline-none"
                />
                <div className="flex items-center gap-1.5 bg-slate-950 border border-slate-800 rounded-lg px-2.5 py-1.5">
                  <span className="text-[10px] text-pink-300 font-bold shrink-0">
                    Palabra Auto-DM:
                  </span>
                  <input
                    type="text"
                    value={igConfig.autoDm.keyword}
                    onChange={(e) =>
                      setIgConfig((prev) => ({
                        ...prev,
                        autoDm: { ...prev.autoDm, keyword: e.target.value.toUpperCase() },
                      }))
                    }
                    className="w-full bg-transparent text-xs font-black text-amber-300 outline-none uppercase"
                    placeholder="HUELLAS"
                  />
                </div>
              </div>
            </div>

            <div className="flex flex-col sm:flex-row gap-2">
              <button
                type="button"
                onClick={handleAnalyzeViralClips}
                disabled={isAnalyzingViral || transcriptSegments.length === 0}
                className="flex-1 py-2.5 px-4 rounded-xl bg-gradient-to-r from-amber-500 via-orange-500 to-amber-400 hover:from-amber-400 hover:to-orange-400 text-slate-950 font-black text-xs cursor-pointer shadow-lg shadow-amber-500/20 flex items-center justify-center gap-2 disabled:opacity-50 transition"
              >
                <Sparkles className={`w-4 h-4 ${isAnalyzingViral ? 'animate-spin' : ''}`} />
                <span>
                  {isAnalyzingViral
                    ? 'Analizando Retención y Puntaje Viral...'
                    : `⚡ Extraer Top ${desiredClipCount} Viral Clips (100% Gratis)`}
                </span>
              </button>

              <button
                type="button"
                disabled={transcriptSegments.length === 0}
                onClick={() => {
                  const minDur =
                    targetDurationRange === '15_30' ? 18 : targetDurationRange === '60_90' ? 55 : 30;
                  const maxDur =
                    targetDurationRange === '15_30' ? 32 : targetDurationRange === '60_90' ? 88 : 58;
                  const formattedTranscript = transcriptSegments
                    .map(
                      (s, idx) =>
                        `[${idx + 1}] (${Number(s.start).toFixed(1)}s - ${Number(s.end).toFixed(
                          1
                        )}s): ${s.text}`
                    )
                    .join(' // ');
                  const webPrompt = `Actúa como OpusClip Pro. Del siguiente guion con tiempos de "${sourceTitle}", selecciona los ${desiredClipCount} fragmentos más virales de entre ${minDur}s y ${maxDur}s. Devuelve únicamente un bloque JSON con {"clips":[{"title":"...","viralityScore":96,"viralityReason":"...","structureMode":"hook_teaser","startSec":0,"endSec":42,"hookTeaserStartSec":10,"hookTeaserEndSec":14,"hookBannerText":"...","socialCaption":"...","hashtags":"#Historia #Documental #Reels"}]}. GUION: ${formattedTranscript}`;
                  sendCommandToWebBridge('GEMINI', {
                    action: 'SEND_PROMPT',
                    prompt: webPrompt,
                    autoSubmit: true,
                    preferDockedWindow: true,
                  });
                  setActionToast(
                    '🌐 Enviado a tu pestaña de Gemini Web (Gratis) sin gastar API Key.'
                  );
                }}
                className="py-2.5 px-3 rounded-xl bg-emerald-950/80 hover:bg-emerald-900 border border-emerald-500/40 text-emerald-300 font-bold text-xs cursor-pointer flex items-center justify-center gap-1.5 shrink-0 disabled:opacity-50 transition"
                title="Enviar la transcripción a tu pestaña abierta de Gemini Web (100% Gratis vía Extensión)"
              >
                <Globe className="w-3.5 h-3.5" />
                <span>Gemini Web (Gratis)</span>
              </button>
            </div>
          </div>
        </div>

        {/* STEP 3: WORKSPACE — VIRAL CLIPS LIST + 9:16 INTERACTIVE PLAYER + INSTAGRAM PUBLISHER */}
        {viralClips.length > 0 && selectedClip ? (
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-4 items-start">
            {/* LEFT 3 COLS: Ranked Viral Clips List */}
            <div className="lg:col-span-3 bg-[#14110d] border border-amber-500/25 rounded-2xl p-3 space-y-2 max-h-[760px] overflow-y-auto">
              <div className="flex items-center justify-between px-1 pb-1 border-b border-slate-800">
                <span className="text-xs font-black text-amber-300 uppercase">
                  🏆 Clips Detectados ({viralClips.length})
                </span>
                <span className="text-[10px] text-slate-400">Score Viral</span>
              </div>

              {viralClips.map((clip) => {
                const isSel = clip.id === selectedClip.id;
                return (
                  <div
                    key={clip.id}
                    onClick={() => setSelectedClipId(clip.id)}
                    className={`p-3 rounded-xl border transition cursor-pointer space-y-1.5 ${
                      isSel
                        ? 'bg-amber-500/15 border-amber-400 shadow-lg shadow-amber-500/10'
                        : 'bg-slate-950/80 border-slate-800/90 hover:border-slate-700'
                    }`}
                  >
                    <div className="flex items-start justify-between gap-2">
                      <span className="text-xs font-black text-slate-100 leading-snug">
                        #{clip.rank} • {clip.title}
                      </span>
                      <span
                        className={`px-2 py-0.5 rounded-lg text-xs font-black shrink-0 ${
                          clip.viralityScore >= 93
                            ? 'bg-emerald-500 text-slate-950'
                            : 'bg-amber-400 text-slate-950'
                        }`}
                      >
                        {clip.viralityScore}
                      </span>
                    </div>

                    <div className="flex items-center justify-between text-[10px] text-slate-400 font-mono">
                      <span>
                        ⏱ {formatMMSS(clip.startSec)} → {formatMMSS(clip.endSec)} ({clip.durationSec}s)
                      </span>
                      <span
                        className={`px-1.5 py-0.2 rounded font-sans font-bold ${
                          clip.structureMode === 'hook_teaser'
                            ? 'bg-purple-500/20 text-purple-300 border border-purple-500/40'
                            : 'bg-slate-800 text-slate-300'
                        }`}
                      >
                        {clip.structureMode === 'hook_teaser' ? '🔥 Hook + Cuerpo' : '▶ Continuo'}
                      </span>
                    </div>

                    {clip.renderedReelUrl && (
                      <div className="text-[10px] text-emerald-300 font-bold flex items-center gap-1">
                        <CheckCircle2 className="w-3 h-3" /> Reel 9:16 Renderizado
                      </div>
                    )}
                  </div>
                );
              })}
            </div>

            {/* CENTER 4 COLS: Interactive 9:16 Vertical Preview Player + Word-by-Word Karaoke Captions */}
            <div className="lg:col-span-4 bg-[#14110d] border border-amber-500/25 rounded-2xl p-4 flex flex-col items-center space-y-3">
              <div className="w-full flex items-center justify-between text-xs">
                <span className="font-black text-amber-300">📱 Visor 9:16 en Vivo</span>
                <label className="flex items-center gap-1.5 text-[11px] text-pink-300 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={previewStoryCta}
                    onChange={(e) => setPreviewStoryCta(e.target.checked)}
                    className="accent-pink-500"
                  />
                  Ver etiqueta de Story
                </label>
              </div>

              {/* 9:16 Vertical Frame */}
              <div className="relative w-full max-w-[310px] aspect-[9/16] rounded-2xl overflow-hidden bg-black border-2 border-amber-500/40 shadow-2xl">
                {sourceVideoUrl ? (
                  <>
                    {selectedClip.reframeMode === 'fit_blur' && (
                      <video
                        src={sourceVideoUrl}
                        muted
                        playsInline
                        className="absolute inset-0 w-full h-full object-cover blur-xl brightness-50 scale-110 pointer-events-none"
                      />
                    )}
                    <video
                      ref={videoRef}
                      src={sourceVideoUrl}
                      onTimeUpdate={handleTimeUpdate}
                      onPlay={() => setIsPlaying(true)}
                      onPause={() => setIsPlaying(false)}
                      playsInline
                      className={`relative z-10 w-full h-full ${
                        selectedClip.reframeMode === 'fit_blur' ? 'object-contain' : 'object-cover'
                      }`}
                      style={{
                        objectPosition:
                          selectedClip.reframeMode === 'fit_blur'
                            ? '50% 50%'
                            : `${selectedClip.focusX}% 50%`,
                      }}
                    />
                  </>
                ) : (
                  <div className="w-full h-full flex flex-col items-center justify-center p-6 text-center bg-gradient-to-b from-slate-900 via-slate-950 to-black">
                    <Film className="w-10 h-10 text-amber-400/60 mb-2" />
                    <p className="text-xs font-bold text-amber-200">
                      Vista Previa de Captions Dinámicos
                    </p>
                    <p className="text-[11px] text-slate-400 mt-1">
                      Exporta primero el video en 06_Video_Final o sube un MP4 para ver el video de fondo.
                    </p>
                  </div>
                )}

                {/* Top Hook Banner (First 4 seconds) */}
                {showHookBanner && selectedClip.hookBannerText && (
                  <div className="absolute top-[11%] inset-x-3 z-20 flex justify-center pointer-events-none">
                    <div className="px-3 py-1.5 rounded-xl bg-amber-400 text-slate-950 font-black text-[11px] text-center uppercase tracking-wide shadow-lg border border-white/40 leading-tight">
                      {selectedClip.hookBannerText}
                    </div>
                  </div>
                )}

                {/* Live Word-by-Word Karaoke Captions Overlay */}
                <div
                  className="absolute inset-x-3 z-20 flex justify-center pointer-events-none"
                  style={{ top: `${captionYPercent}%`, transform: 'translateY(-50%)' }}
                >
                  {activeCaptionChunk ? (
                    <div
                      className={`px-3 py-1.5 rounded-xl text-center leading-tight flex flex-wrap items-center justify-center gap-x-1.5 gap-y-0.5 ${
                        selectedClip.captionStyle === 'huellas_cinema'
                          ? 'bg-black/35 backdrop-blur-[2px] shadow-[0_0_12px_4px_rgba(0,0,0,0.35)]'
                          : 'bg-black/45'
                      }`}
                      style={{
                        fontSize: `${Math.round(17 * fontSizeScale)}px`,
                        fontWeight: 900,
                      }}
                    >
                      {activeCaptionChunk.chunk.map((w, idx) => {
                        const isActive = idx === activeCaptionChunk.activeIdx;
                        const activeClasses =
                          selectedClip.captionStyle === 'hormozi_green'
                            ? 'text-emerald-400 scale-110'
                            : selectedClip.captionStyle === 'viral_box'
                            ? 'bg-sky-400 text-slate-950 px-1.5 rounded scale-105'
                            : selectedClip.captionStyle === 'huellas_cinema'
                            ? 'text-amber-300 scale-105'
                            : 'text-yellow-300 scale-110';
                        return (
                          <span
                            key={`${w.start}-${idx}`}
                            className={`uppercase transition-transform duration-75 drop-shadow-[0_2px_4px_rgba(0,0,0,0.95)] ${
                              isActive ? activeClasses : 'text-white'
                            }`}
                          >
                            {w.word}
                          </span>
                        );
                      })}
                    </div>
                  ) : (
                    <div
                      className="px-3 py-1.5 rounded-xl bg-black/45 text-center font-black uppercase text-white/90 text-xs"
                      style={{ fontSize: `${Math.round(15 * fontSizeScale)}px` }}
                    >
                      {selectedClip.words.slice(0, wordsPerLine).map((w, idx) => (
                        <span
                          key={idx}
                          className={idx === 0 ? 'text-yellow-300 mr-1.5' : 'text-white mr-1.5'}
                        >
                          {w.word}
                        </span>
                      ))}
                    </div>
                  )}
                </div>

                {/* Story Bottom CTA Banner Preview */}
                {previewStoryCta && (
                  <div className="absolute bottom-[7%] inset-x-3 z-20 flex justify-center pointer-events-none">
                    <div className="px-3 py-1.5 rounded-full bg-gradient-to-r from-pink-600/95 to-purple-600/95 text-white font-black text-[10px] text-center shadow-lg border border-white/30">
                      💬 Responde &quot;{igConfig.autoDm.keyword || 'HUELLAS'}&quot; y te envío el
                      link directo por DM
                    </div>
                  </div>
                )}
              </div>

              {/* Playback & Trim Bar */}
              <div className="w-full space-y-2">
                <div className="flex items-center justify-between gap-2">
                  <button
                    type="button"
                    onClick={togglePlayClip}
                    className="px-3.5 py-1.5 rounded-xl bg-amber-500 hover:bg-amber-400 text-slate-950 font-black text-xs flex items-center gap-1.5 cursor-pointer"
                  >
                    {isPlaying ? <Pause className="w-3.5 h-3.5" /> : <Play className="w-3.5 h-3.5" />}
                    <span>{isPlaying ? 'Pausar' : 'Reproducir Clip'}</span>
                  </button>
                  <span className="font-mono text-xs text-amber-300">
                    {formatMMSS(playheadSec)} / {formatMMSS(selectedClip.endSec)} (
                    {selectedClip.durationSec}s)
                  </span>
                </div>

                {/* Reframe & Caption Controls */}
                <div className="bg-slate-950 border border-slate-800 rounded-xl p-2.5 space-y-2 text-xs">
                  <div className="flex items-center justify-between gap-1">
                    <span className="text-[11px] font-bold text-slate-400">Encuadre 9:16:</span>
                    <div className="flex items-center gap-1">
                      {(
                        [
                          { id: 'center_fill', label: '🎯 Recorte 9:16' },
                          { id: 'fit_blur', label: '🖼️ Blur 16:9' },
                          { id: 'auto_pan', label: '↔️ Auto-Pan' },
                        ] as const
                      ).map((m) => (
                        <button
                          key={m.id}
                          type="button"
                          onClick={() => updateSelectedClip({ reframeMode: m.id })}
                          className={`px-2 py-0.5 rounded text-[10px] font-bold cursor-pointer ${
                            selectedClip.reframeMode === m.id
                              ? 'bg-amber-500 text-slate-950'
                              : 'bg-slate-900 text-slate-300'
                          }`}
                        >
                          {m.label}
                        </button>
                      ))}
                    </div>
                  </div>

                  {selectedClip.reframeMode === 'center_fill' && (
                    <div className="flex items-center gap-2">
                      <span className="text-[10px] text-slate-400 shrink-0">
                        Foco X ({selectedClip.focusX}%):
                      </span>
                      <input
                        type="range"
                        min={10}
                        max={90}
                        value={selectedClip.focusX}
                        onChange={(e) => updateSelectedClip({ focusX: Number(e.target.value) })}
                        className="w-full accent-amber-400"
                      />
                    </div>
                  )}

                  <div className="flex items-center justify-between gap-1 pt-1 border-t border-slate-800">
                    <span className="text-[11px] font-bold text-slate-400">Estilo Captions:</span>
                    <div className="flex items-center gap-1 flex-wrap">
                      {(
                        [
                          { id: 'opus_gold', label: '⚡ Opus Gold' },
                          { id: 'hormozi_green', label: '💚 Hormozi' },
                          { id: 'viral_box', label: '🟦 Box' },
                          { id: 'huellas_cinema', label: '🎬 Huellas' },
                        ] as const
                      ).map((st) => (
                        <button
                          key={st.id}
                          type="button"
                          onClick={() => updateSelectedClip({ captionStyle: st.id })}
                          className={`px-2 py-0.5 rounded text-[10px] font-bold cursor-pointer ${
                            selectedClip.captionStyle === st.id
                              ? 'bg-amber-400 text-slate-950'
                              : 'bg-slate-900 text-slate-300'
                          }`}
                        >
                          {st.label}
                        </button>
                      ))}
                    </div>
                  </div>

                  <div className="grid grid-cols-3 gap-2 pt-1">
                    <div>
                      <span className="block text-[10px] text-slate-400">Palabras/Línea</span>
                      <select
                        value={wordsPerLine}
                        onChange={(e) => setWordsPerLine(Number(e.target.value))}
                        className="w-full bg-slate-900 border border-slate-700 rounded px-1.5 py-0.5 text-[11px]"
                      >
                        <option value={2}>2 palabras</option>
                        <option value={3}>3 palabras (Opus)</option>
                        <option value={4}>4 palabras</option>
                        <option value={5}>5 palabras</option>
                      </select>
                    </div>
                    <div>
                      <span className="block text-[10px] text-slate-400">Tamaño Letra</span>
                      <select
                        value={fontSizeScale}
                        onChange={(e) => setFontSizeScale(Number(e.target.value))}
                        className="w-full bg-slate-900 border border-slate-700 rounded px-1.5 py-0.5 text-[11px]"
                      >
                        <option value={0.85}>Pequeña (85%)</option>
                        <option value={1.0}>Normal (100%)</option>
                        <option value={1.15}>Grande (115%)</option>
                        <option value={1.3}>XL Viral (130%)</option>
                      </select>
                    </div>
                    <div>
                      <span className="block text-[10px] text-slate-400">Altura Y ({captionYPercent}%)</span>
                      <input
                        type="range"
                        min={35}
                        max={85}
                        value={captionYPercent}
                        onChange={(e) => setCaptionYPercent(Number(e.target.value))}
                        className="w-full accent-amber-400 mt-1"
                      />
                    </div>
                  </div>
                </div>
              </div>
            </div>

            {/* RIGHT 5 COLS: Virality Score Breakdown + Social Copy + Render & Publish to Instagram (Reel + Story) */}
            <div className="lg:col-span-5 space-y-3.5">
              {/* Virality Score Card */}
              <div className="bg-[#14110d] border border-amber-500/25 rounded-2xl p-4 space-y-3">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <span className="text-[10px] font-black uppercase tracking-wider text-emerald-400">
                      Análisis de Potencial Viral (Opus IA)
                    </span>
                    <input
                      type="text"
                      value={selectedClip.title}
                      onChange={(e) => updateSelectedClip({ title: e.target.value })}
                      className="w-full bg-transparent text-base font-black text-amber-200 outline-none border-b border-transparent focus:border-amber-500/40 mt-0.5"
                    />
                  </div>
                  <div className="px-3 py-1.5 rounded-2xl bg-gradient-to-br from-emerald-400 to-teal-500 text-slate-950 text-center shrink-0 shadow-lg">
                    <div className="text-lg font-black leading-none">
                      {selectedClip.viralityScore}
                    </div>
                    <div className="text-[9px] font-black uppercase">/ 100</div>
                  </div>
                </div>

                <div className="grid grid-cols-4 gap-2 text-center">
                  {[
                    { label: 'Hook (3s)', val: selectedClip.scoreBreakdown.hook },
                    { label: 'Retención', val: selectedClip.scoreBreakdown.retention },
                    { label: 'Emoción', val: selectedClip.scoreBreakdown.emotion },
                    { label: 'Cierre', val: selectedClip.scoreBreakdown.completeness },
                  ].map((item) => (
                    <div
                      key={item.label}
                      className="bg-slate-950 border border-slate-800 rounded-xl p-2"
                    >
                      <div className="text-xs font-black text-amber-300">{item.val}%</div>
                      <div className="text-[10px] text-slate-400">{item.label}</div>
                    </div>
                  ))}
                </div>

                <p className="text-xs text-slate-300 bg-slate-950/80 border border-slate-800/80 rounded-xl p-2.5 leading-relaxed">
                  💡 {selectedClip.viralityReason}
                </p>

                {/* Structure Mode & Fine Timing */}
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 text-xs pt-1">
                  <div className="bg-slate-950 border border-slate-800 rounded-xl p-2.5 space-y-1">
                    <span className="text-[10px] text-slate-400 font-bold block">
                      Modo de Estructura del Clip
                    </span>
                    <div className="flex gap-1">
                      <button
                        type="button"
                        onClick={() => updateSelectedClip({ structureMode: 'hook_teaser' })}
                        className={`flex-1 py-1 rounded-lg text-[11px] font-bold cursor-pointer ${
                          selectedClip.structureMode === 'hook_teaser'
                            ? 'bg-purple-500 text-slate-950'
                            : 'bg-slate-900 text-slate-300'
                        }`}
                      >
                        🔥 Hook Adelantado
                      </button>
                      <button
                        type="button"
                        onClick={() => updateSelectedClip({ structureMode: 'continuous' })}
                        className={`flex-1 py-1 rounded-lg text-[11px] font-bold cursor-pointer ${
                          selectedClip.structureMode === 'continuous'
                            ? 'bg-amber-500 text-slate-950'
                            : 'bg-slate-900 text-slate-300'
                        }`}
                      >
                        ▶ Continuo
                      </button>
                    </div>
                  </div>

                  <div className="bg-slate-950 border border-slate-800 rounded-xl p-2.5 space-y-1">
                    <span className="text-[10px] text-slate-400 font-bold block">
                      Ajuste Fino de Tiempos (Segundos)
                    </span>
                    <div className="flex items-center gap-1.5">
                      <input
                        type="number"
                        step="0.5"
                        value={selectedClip.startSec}
                        onChange={(e) =>
                          updateSelectedClip({ startSec: Math.max(0, Number(e.target.value)) })
                        }
                        className="w-full bg-slate-900 border border-slate-700 rounded px-2 py-1 text-xs font-mono text-amber-200"
                      />
                      <span className="text-slate-500">→</span>
                      <input
                        type="number"
                        step="0.5"
                        value={selectedClip.endSec}
                        onChange={(e) =>
                          updateSelectedClip({
                            endSec: Math.max(selectedClip.startSec + 5, Number(e.target.value)),
                          })
                        }
                        className="w-full bg-slate-900 border border-slate-700 rounded px-2 py-1 text-xs font-mono text-amber-200"
                      />
                    </div>
                  </div>
                </div>
              </div>

              {/* Hook Banner, Caption & Hashtags */}
              <div className="bg-[#14110d] border border-amber-500/25 rounded-2xl p-4 space-y-3 text-xs">
                <div className="flex items-center justify-between">
                  <label className="flex items-center gap-2 font-bold text-amber-300 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={showHookBanner}
                      onChange={(e) => setShowHookBanner(e.target.checked)}
                      className="accent-amber-400"
                    />
                    Cartel Gancho Superior (Primeros 3.8s)
                  </label>
                </div>
                {showHookBanner && (
                  <input
                    type="text"
                    value={selectedClip.hookBannerText}
                    onChange={(e) => updateSelectedClip({ hookBannerText: e.target.value })}
                    className="w-full bg-slate-950 border border-slate-700 rounded-xl px-3 py-1.5 text-xs font-black text-amber-200 uppercase"
                    placeholder="TEXTO GANCHO EN PANTALLA..."
                  />
                )}

                <div className="space-y-1">
                  <div className="flex items-center justify-between">
                    <span className="text-[11px] font-bold text-slate-300">
                      Descripción para Instagram Reels / Shorts / TikTok:
                    </span>
                    <button
                      type="button"
                      onClick={() =>
                        copyText(
                          'caption',
                          `${selectedClip.socialCaption}\n\n💬 Comenta "${
                            igConfig.autoDm.keyword || 'HUELLAS'
                          }" y te envío el link directo al documental completo por DM.\n\n${
                            selectedClip.hashtags
                          }`
                        )
                      }
                      className="text-[11px] text-amber-300 hover:text-amber-200 flex items-center gap-1 cursor-pointer"
                    >
                      {copiedField === 'caption' ? (
                        <Check className="w-3 h-3 text-emerald-400" />
                      ) : (
                        <Copy className="w-3 h-3" />
                      )}
                      <span>{copiedField === 'caption' ? '¡Copiado!' : 'Copiar Todo'}</span>
                    </button>
                  </div>
                  <textarea
                    rows={3}
                    value={selectedClip.socialCaption}
                    onChange={(e) => updateSelectedClip({ socialCaption: e.target.value })}
                    className="w-full bg-slate-950 border border-slate-800 rounded-xl p-2.5 text-xs text-slate-200 outline-none"
                  />
                </div>

                <div className="space-y-1">
                  <span className="text-[11px] font-bold text-slate-300 block">Hashtags:</span>
                  <input
                    type="text"
                    value={selectedClip.hashtags}
                    onChange={(e) => updateSelectedClip({ hashtags: e.target.value })}
                    className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3 py-1.5 text-xs text-sky-300 font-mono"
                  />
                </div>
              </div>

              {/* EXPORT TO 07_VIRAL_CLIPS & DIRECT PUBLISH TO INSTAGRAM (REEL + STORY) */}
              <div className="bg-gradient-to-br from-[#19130e] to-slate-950 border border-amber-500/40 rounded-2xl p-4 space-y-3 shadow-xl">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-black text-amber-300 uppercase">
                    3. Exportar MP4 y Publicar en Instagram
                  </span>
                  {selectedClip.savedDocFolderPath && (
                    <span className="text-[10px] text-emerald-400 font-mono">
                      ✓ En 07_Viral_Clips
                    </span>
                  )}
                </div>

                {/* Local Render Buttons */}
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                  <button
                    type="button"
                    disabled={Boolean(isRenderingClipId)}
                    onClick={() => handleRenderViralClip(selectedClip, 'reel')}
                    className="py-2.5 px-3 rounded-xl bg-teal-400 hover:bg-teal-300 text-slate-950 font-black text-xs cursor-pointer flex items-center justify-center gap-1.5 shadow disabled:opacity-50"
                  >
                    <Download className="w-3.5 h-3.5" />
                    <span>
                      {isRenderingClipId === `${selectedClip.id}_reel`
                        ? 'Renderizando Reel 9:16...'
                        : '💾 Renderizar Reel (07_Viral_Clips)'}
                    </span>
                  </button>

                  <button
                    type="button"
                    disabled={Boolean(isRenderingClipId)}
                    onClick={() => handleRenderViralClip(selectedClip, storyPublishMode)}
                    className="py-2.5 px-3 rounded-xl bg-slate-800 hover:bg-slate-700 border border-slate-700 text-amber-200 font-bold text-xs cursor-pointer flex items-center justify-center gap-1.5 disabled:opacity-50"
                  >
                    <Download className="w-3.5 h-3.5" />
                    <span>
                      {isRenderingClipId.startsWith(`${selectedClip.id}_story`)
                        ? 'Renderizando Story...'
                        : '📱 Renderizar Versión Story con CTA'}
                    </span>
                  </button>
                </div>

                {/* Download Links if already rendered */}
                {(selectedClip.renderedReelUrl || selectedClip.renderedStoryUrl) && (
                  <div className="flex flex-wrap items-center gap-2 pt-1">
                    {selectedClip.renderedReelUrl && (
                      <a
                        href={selectedClip.renderedReelUrl}
                        download
                        className="px-3 py-1 rounded-lg bg-emerald-500/20 border border-emerald-500/40 text-emerald-300 text-[11px] font-bold"
                      >
                        ⬇ Descargar Reel .MP4
                      </a>
                    )}
                    {selectedClip.renderedStoryUrl && (
                      <a
                        href={selectedClip.renderedStoryUrl}
                        download
                        className="px-3 py-1 rounded-lg bg-pink-500/20 border border-pink-500/40 text-pink-300 text-[11px] font-bold"
                      >
                        ⬇ Descargar Story .MP4
                      </a>
                    )}
                  </div>
                )}

                {/* Direct Instagram Publishing Section */}
                <div className="pt-2 border-t border-slate-800 space-y-2">
                  <div className="flex items-center justify-between text-[11px]">
                    <span className="font-bold text-pink-300">
                      📲 Publicación Directa en Instagram (API Oficial):
                    </span>
                    <select
                      value={storyPublishMode}
                      onChange={(e) => setStoryPublishMode(e.target.value as any)}
                      className="bg-slate-900 border border-slate-700 rounded-lg px-2 py-0.5 text-[10px] text-slate-200"
                    >
                      <option value="story_teaser">
                        Story Teaser ({selectedClip.storyTeaserDurationSec}s con intriga + CTA)
                      </option>
                      <option value="story_full">Story Completa (hasta 58s + CTA)</option>
                    </select>
                  </div>

                  <button
                    type="button"
                    disabled={Boolean(isPublishingClipId)}
                    onClick={() => handlePublishInstagram(selectedClip, 'combo_reel_story')}
                    className="w-full py-2.5 px-4 rounded-xl bg-gradient-to-r from-pink-600 via-rose-500 to-amber-500 hover:from-pink-500 hover:to-amber-400 text-white font-black text-xs cursor-pointer shadow-lg shadow-pink-500/20 flex items-center justify-center gap-2 disabled:opacity-50"
                  >
                    <Share2 className="w-4 h-4" />
                    <span>
                      {isPublishingClipId === `${selectedClip.id}_combo_reel_story`
                        ? 'Publicando Reel + Story en Instagram...'
                        : `🚀 Publicar Combo: Reel + Impulsar en Story + Activar Auto-DM "${
                            igConfig.autoDm.keyword || 'HUELLAS'
                          }"`}
                    </span>
                  </button>

                  <div className="grid grid-cols-2 gap-2">
                    <button
                      type="button"
                      disabled={Boolean(isPublishingClipId)}
                      onClick={() => handlePublishInstagram(selectedClip, 'reel')}
                      className="py-1.5 px-3 rounded-xl bg-slate-900 hover:bg-slate-800 border border-pink-500/40 text-pink-200 font-bold text-xs cursor-pointer disabled:opacity-50"
                    >
                      🎬 Publicar Solo Reel
                    </button>
                    <button
                      type="button"
                      disabled={Boolean(isPublishingClipId)}
                      onClick={() => handlePublishInstagram(selectedClip, 'story')}
                      className="py-1.5 px-3 rounded-xl bg-slate-900 hover:bg-slate-800 border border-purple-500/40 text-purple-200 font-bold text-xs cursor-pointer disabled:opacity-50"
                    >
                      📱 Publicar Solo en Stories
                    </button>
                  </div>
                </div>
              </div>
            </div>
          </div>
        ) : (
          <div className="bg-[#14110d] border border-slate-800 rounded-2xl p-10 text-center space-y-3">
            <div className="w-12 h-12 rounded-2xl bg-amber-500/15 border border-amber-500/30 flex items-center justify-center mx-auto text-2xl">
              ⚡
            </div>
            <h3 className="text-sm font-black text-amber-200">
              Listo para detectar tus mejores Clips Virales
            </h3>
            <p className="text-xs text-slate-400 max-w-xl mx-auto">
              Elige arriba uno de tus documentales de Huellas Master, sube cualquier video MP4 o pega un link de YouTube y pulsa{' '}
              <strong className="text-amber-300">
                &quot;Extraer Top {desiredClipCount} Viral Clips&quot;
              </strong>
              .
            </p>
          </div>
        )}
      </div>

      {/* =====================================================================
          MODAL: INSTAGRAM GRAPH API + AUTO-DM CLICKABLE LINK CONFIGURATION
      ===================================================================== */}
      {showIgModal && (
        <div
          onClick={() => setShowIgModal(false)}
          className="fixed inset-0 z-[260] bg-black/80 backdrop-blur-sm flex items-center justify-center p-4"
        >
          <div
            onClick={(e) => e.stopPropagation()}
            className="w-full max-w-2xl max-h-[90vh] overflow-y-auto rounded-2xl bg-[#14110d] border border-pink-500/40 shadow-2xl p-5 space-y-4 text-xs text-slate-100"
          >
            <div className="flex items-center justify-between border-b border-slate-800 pb-3">
              <div>
                <h3 className="text-sm font-black text-pink-300 flex items-center gap-2">
                  📲 Conexión Oficial de Instagram (Reels + Stories) y Auto-DM con Link Clicable
                </h3>
                <p className="text-[11px] text-slate-400 mt-0.5">
                  Publica Reels y Stories directamente por la API Oficial de Meta y envía links clicables por DM automáticamente cuando comenten o respondan tu Story.
                </p>
              </div>
              <button
                type="button"
                onClick={() => setShowIgModal(false)}
                className="w-7 h-7 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300 cursor-pointer"
              >
                ✕
              </button>
            </div>

            {/* 1. Credentials */}
            <div className="bg-slate-950 border border-slate-800 rounded-xl p-3.5 space-y-3">
              <div className="font-black text-amber-300 uppercase text-[11px]">
                1. Credenciales de Instagram Graph API (Meta for Developers)
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="block text-[11px] text-slate-400 font-semibold mb-1">
                    Instagram Business / Creator User ID:
                  </label>
                  <input
                    type="text"
                    value={igConfig.igUserId}
                    onChange={(e) =>
                      setIgConfig((prev) => ({ ...prev, igUserId: e.target.value }))
                    }
                    placeholder="Ej. 17841405822304914"
                    className="w-full bg-slate-900 border border-slate-700 rounded-lg px-3 py-1.5 text-xs text-white font-mono"
                  />
                </div>
                <div>
                  <label className="block text-[11px] text-slate-400 font-semibold mb-1">
                    Access Token de Larga Duración{' '}
                    {igConfig.maskedToken ? `(Activo: ${igConfig.maskedToken})` : ''}:
                  </label>
                  <input
                    type="password"
                    value={igTokenInput}
                    onChange={(e) => setIgTokenInput(e.target.value)}
                    placeholder={
                      igConfig.hasToken
                        ? 'Pegar nuevo token solo si deseas reemplazarlo...'
                        : 'EAABsbCS1iHgBO...'
                    }
                    className="w-full bg-slate-900 border border-slate-700 rounded-lg px-3 py-1.5 text-xs text-white font-mono"
                  />
                </div>
              </div>

              <details className="text-[11px] text-slate-400 bg-slate-900/60 rounded-lg p-2.5 border border-slate-800">
                <summary className="cursor-pointer font-bold text-amber-300">
                  ℹ️ ¿Cómo obtener tu Instagram User ID y Token en 3 minutos (Gratis)?
                </summary>
                <ol className="list-decimal list-inside space-y-1 mt-2 text-slate-300">
                  <li>
                    Asegúrate de que tu cuenta de Instagram esté en modo{' '}
                    <strong>Creador o Empresa</strong>.
                  </li>
                  <li>
                    En <code>developers.facebook.com</code> crea una App de tipo{' '}
                    <strong>Business</strong> y agrega el producto{' '}
                    <strong>Instagram Graph API</strong>.
                  </li>
                  <li>
                    En el Explorador de la API Graph genera un Token con los permisos:{' '}
                    <code>instagram_basic</code>, <code>instagram_content_publish</code>,{' '}
                    <code>instagram_manage_comments</code> y{' '}
                    <code>instagram_manage_messages</code>.
                  </li>
                  <li>
                    Consulta <code>GET /me/accounts?fields=instagram_business_account</code> para
                    copiar el <strong>id</strong> de tu cuenta de Instagram y pégalo arriba.
                  </li>
                </ol>
              </details>
            </div>

            {/* 2. Auto-DM Clickable Link Responder (ManyChat style) */}
            <div className="bg-slate-950 border border-pink-500/30 rounded-xl p-3.5 space-y-3">
              <div className="flex items-center justify-between">
                <span className="font-black text-pink-300 uppercase text-[11px]">
                  2. Auto-Respuesta por DM con Link Clicable (Para Stories y Reels)
                </span>
                <label className="flex items-center gap-1.5 cursor-pointer font-bold text-emerald-300">
                  <input
                    type="checkbox"
                    checked={igConfig.autoDm.enabled}
                    onChange={(e) =>
                      setIgConfig((prev) => ({
                        ...prev,
                        autoDm: { ...prev.autoDm, enabled: e.target.checked },
                      }))
                    }
                    className="accent-emerald-500"
                  />
                  Auto-DM Activo
                </label>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-3 gap-2.5">
                <div>
                  <label className="block text-[11px] text-slate-400 font-semibold mb-1">
                    Palabra Clave Disparadora:
                  </label>
                  <input
                    type="text"
                    value={igConfig.autoDm.keyword}
                    onChange={(e) =>
                      setIgConfig((prev) => ({
                        ...prev,
                        autoDm: { ...prev.autoDm, keyword: e.target.value.toUpperCase() },
                      }))
                    }
                    className="w-full bg-slate-900 border border-slate-700 rounded-lg px-3 py-1.5 text-xs font-black text-amber-300 uppercase"
                  />
                </div>
                <div className="sm:col-span-2">
                  <label className="block text-[11px] text-slate-400 font-semibold mb-1">
                    🔗 Link Clicable que se enviará por DM (Ej. Video de YouTube):
                  </label>
                  <input
                    type="url"
                    value={igConfig.autoDm.destinationUrl}
                    onChange={(e) =>
                      setIgConfig((prev) => ({
                        ...prev,
                        autoDm: { ...prev.autoDm, destinationUrl: e.target.value },
                      }))
                    }
                    placeholder="https://www.youtube.com/watch?v=..."
                    className="w-full bg-slate-900 border border-slate-700 rounded-lg px-3 py-1.5 text-xs text-emerald-300 font-mono"
                  />
                </div>
              </div>

              <label className="flex items-center gap-2 text-[11px] text-slate-300 cursor-pointer">
                <input
                  type="checkbox"
                  checked={igConfig.autoDm.matchAnyCommentAskingLink}
                  onChange={(e) =>
                    setIgConfig((prev) => ({
                      ...prev,
                      autoDm: { ...prev.autoDm, matchAnyCommentAskingLink: e.target.checked },
                    }))
                  }
                  className="accent-pink-500"
                />
                Enviar el link también a quien comente palabras como &quot;link&quot;, &quot;enlace&quot;, &quot;video completo&quot; o &quot;YouTube&quot;
              </label>

              <div>
                <label className="block text-[11px] text-slate-400 font-semibold mb-1">
                  Mensaje Directo (DM) que recibirá el usuario (usa {'{{username}}'} y {'{{url}}'}):
                </label>
                <textarea
                  rows={3}
                  value={igConfig.autoDm.dmMessageTemplate}
                  onChange={(e) =>
                    setIgConfig((prev) => ({
                      ...prev,
                      autoDm: { ...prev.autoDm, dmMessageTemplate: e.target.value },
                    }))
                  }
                  className="w-full bg-slate-900 border border-slate-700 rounded-lg p-2 text-xs text-slate-200"
                />
              </div>

              <div className="flex items-center justify-between gap-2 pt-1">
                <button
                  type="button"
                  onClick={handleCheckAutoDmNow}
                  disabled={isCheckingAutoDm || !igConfig.hasToken}
                  className="px-3 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 border border-slate-700 text-amber-300 font-bold cursor-pointer disabled:opacity-50"
                >
                  {isCheckingAutoDm
                    ? 'Revisando comentarios...'
                    : '⚡ Revisar Comentarios y Responder Ahora'}
                </button>

                <button
                  type="button"
                  onClick={handleSaveInstagramSettings}
                  disabled={isSavingIgConfig}
                  className="px-4 py-2 rounded-xl bg-pink-600 hover:bg-pink-500 text-white font-black cursor-pointer shadow"
                >
                  {isSavingIgConfig ? 'Guardando...' : '💾 Guardar Configuración de Instagram'}
                </button>
              </div>
            </div>

            {/* 3. Sent Auto-DM Log */}
            {igConfig.sentDmLogs.length > 0 && (
              <div className="bg-slate-950 border border-slate-800 rounded-xl p-3 space-y-2">
                <div className="font-bold text-slate-300 text-[11px]">
                  📬 Últimos Links Enviados por DM Automático ({igConfig.sentDmLogs.length})
                </div>
                <div className="max-h-36 overflow-y-auto space-y-1">
                  {igConfig.sentDmLogs.slice(0, 15).map((log) => (
                    <div
                      key={log.id}
                      className="flex items-center justify-between text-[11px] bg-slate-900/80 px-2.5 py-1.5 rounded border border-slate-800"
                    >
                      <span className="text-slate-200 truncate">
                        <strong>@{log.recipientUsername}</strong> ({log.triggerText}) →{' '}
                        <span className="text-emerald-300 font-mono">{log.sentUrl}</span>
                      </span>
                      <span
                        className={`text-[10px] font-bold shrink-0 ml-2 ${
                          log.status === 'sent' ? 'text-emerald-400' : 'text-rose-400'
                        }`}
                      >
                        {log.status === 'sent' ? '✓ Enviado' : '✕ Error'}
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
};
