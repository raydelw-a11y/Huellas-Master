import React, { useState, useEffect, useRef, useMemo } from 'react';
import {
  computeViralClipCuts,
  buildViralLocalWords,
  viralSourceToClipTime,
  viralClipTimeToSource,
  viralCutTimes,
  normalizeViralSegments,
  viralSegmentsDurationSec,
  timelineToMasterTime,
} from '../utils/viralClipCuts';
import {
  Sparkles,
  Film,
  Upload,
  Play,
  Pause,
  Download,
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
import { ViralPosterTitle, useViralPosterFontPx, viralPosterTextHeightPx } from './ViralPosterTitle';
import {
  VIRAL_TITLE_LOOK,
  splitViralTitleLines,
  buildViralSmallTitleLines,
  computeViralTitleTimeline,
} from '../utils/viralTitle';
import { sendCommandToWebBridge } from '../utils/webStudioBridge';
import {
  getMediaBridgeSnapshot,
  getOrderedMediaBridgeBases,
  isLocalMediaRuntimeOrigin,
  withTunnelAccessParam,
} from '../utils/mediaBridge';

/** Número de "etapa" con el que viaja el pedido de Viral Clips a Gemini Web: nunca es el resultado de una etapa. */
export const VIRAL_CLIPS_GEMINI_STAGE = 970;

/** Origen del servidor de la Mac cuando la página no se sirve desde ella (iPhone / GitHub Pages); '' en la Mac. */
function getViralServerOrigin(): string {
  if (typeof window === 'undefined' || isLocalMediaRuntimeOrigin()) return '';
  const origin = String(getMediaBridgeSnapshot().activeOrigin || getOrderedMediaBridgeBases()[0] || '').replace(/\/+$/, '');
  return origin && origin !== window.location.origin ? origin : '';
}
/** Dirección de una ruta /api del servidor de la Mac, válida también desde el iPhone. */
function viralApi(pathname: string): string {
  return `${getViralServerOrigin()}${pathname}`;
}
/** Dirección de un video o archivo servido por la Mac, válida también desde el iPhone. */
function viralMedia(url: string | undefined | null): string {
  const clean = String(url || '');
  if (!clean || !clean.startsWith('/')) return clean;
  return withTunnelAccessParam(`${getViralServerOrigin()}${clean}`);
}

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
  /** Old lists may still say 'hook_teaser': the hook teaser was removed, every clip plays its pieces in order */
  structureMode?: 'continuous' | 'hook_teaser';
  /** First and last second used by the clip (bounds of its pieces) */
  startSec: number;
  endSec: number;
  /** Length of the exported clip (sum of its pieces) */
  durationSec: number;
  /** Pieces of the documentary in order (the parts in between are skipped); none = one continuous piece */
  segments?: Array<{ startSec: number; endSec: number }>;
  hookTeaserStartSec?: number;
  hookTeaserEndSec?: number;
  hookBannerText: string;
  socialCaption: string;
  hashtags: string;
  /** Comment to pin under the post: a question that invites replies about the clip's topic */
  pinnedComment?: string;
  /** Marked by hand once the clip is posted; saved with the list, so it shows on the Mac and on the iPhone */
  published?: boolean;
  publishedAt?: string;
  transcriptExcerpt: string;
  words: WordTimestamp[];
  reframeMode: 'center_fill' | 'fit_blur' | 'auto_pan';
  focusX: number;
  captionStyle: 'yellow_white' | 'opus_gold' | 'hormozi_green' | 'viral_box' | 'huellas_cinema';
  renderedReelUrl?: string;
  savedDocFolderPath?: string;
  /** Who picked this clip: Gemini Web or the local engine (lists saved before this field count as local). */
  origin?: 'gemini' | 'local';
}

/** Captions (preview and render) show words without periods, commas or other punctuation. */
const stripCaptionPunctuation = (w: string) =>
  String(w || '')
    .replace(/[.,;:!?¡¿"“”‘’'«»…()\[\]{}—–]/g, '')
    .replace(/^-+|-+$/g, '')
    .trim();

/** True when the page is not running on the Mac itself (iPhone / GitHub Pages through the tunnel). */
const isRemoteViralDevice =
  typeof window !== 'undefined' && !/^(localhost|127\.0\.0\.1|\[::1\])$/i.test(window.location.hostname);

/** Closing paragraph of every clip description (its own paragraph, after the description). */
// Where the link to the full documentary is, which depends on the network the clip is posted on:
// TikTok and Instagram only allow a link in the profile; on Facebook it goes in the pinned comment.
type ViralLinkPlace = 'bio' | 'comments';
const VIRAL_DESCRIPTION_CTA: Record<ViralLinkPlace, string> = {
  bio: '¡Para ver el documental completo, visita nuestro canal de YouTube, el enlace está en la biografía!',
  comments: '¡Para ver el documental completo, visita nuestro canal de YouTube, el enlace está en los comentarios!',
};

/** The pinned comment without any line about YouTube or the link (older lists carry "…(enlace en la bio)"). */
function viralCommentQuestionOnly(comment: string): string {
  const sentences = String(comment || '')
    .trim()
    .split(/(?<=[.!?…])\s+/)
    .filter((s) => s && !/youtube|enlace|\bbio\b|biograf[ií]a|documental completo|video completo/i.test(s));
  return sentences.join(' ').trim();
}

/** Pinned comment as it is copied: the question alone, plus the link line on Facebook. */
function buildViralPinnedComment(comment: string, place: ViralLinkPlace, youtubeUrl: string): string {
  const question = viralCommentQuestionOnly(comment) || String(comment || '').trim();
  if (place !== 'comments') return question;
  const link = String(youtubeUrl || '').trim();
  return [question, link ? `👉 Documental completo en YouTube: ${link}` : '👉 El documental completo está en nuestro canal de YouTube.']
    .filter(Boolean)
    .join('\n\n');
}

/** Each clip's description carries exactly 5 hashtags (extra ones are dropped, duplicates removed). */
function limitToFiveHashtags(raw: string): string {
  const tags = String(raw || '')
    .split(/[\s,]+/)
    .map((t) => t.trim())
    .filter(Boolean)
    .map((t) => (t.startsWith('#') ? t : `#${t}`));
  const seen = new Set<string>();
  const out: string[] = [];
  for (const t of tags) {
    const k = t.toLowerCase();
    if (seen.has(k)) continue;
    seen.add(k);
    out.push(t);
    if (out.length >= 5) break;
  }
  return out.join(' ');
}

/** Where a clip list came from: Gemini Web, or the local engine (ids `viral-clip-…` come from the Mac's engine). */
function viralClipsOrigin(clips: ViralClipSuggestion[]): 'gemini' | 'local' | '' {
  if (clips.length === 0) return '';
  if (clips[0].origin) return clips[0].origin;
  return 'local';
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
  // Video maestro que está solo en iCloud (sin descargar en la Mac): no se puede ver ni renderizar hasta bajarlo
  // Clean 9:16 master of the documentary (made by the editor's exporter on its own, without captions): the viral
  // clips of a documentary are cut from it and the preview plays it, so the page shows the editor's framing
  const [viralMaster, setViralMaster] = useState<{
    state: 'ready' | 'building' | 'stale' | 'missing' | 'no_recipe';
    reasons: string[];
    building: boolean;
    progressPct: number;
    exists: boolean;
    fresh: boolean;
    lastError: string;
    path: string;
    url: string;
    skipRanges916: Array<{ start: number; end: number }>;
    builtAt: number;
  } | null>(null);
  // Documentary clips changed after the final 16:9 video was exported (viral clips are cut from that file)
  const [staleMasterClips, setStaleMasterClips] = useState<number[]>([]);
  const [masterExportedAt, setMasterExportedAt] = useState<number>(0);
  const [cloudOnlyMaster, setCloudOnlyMaster] = useState<{ path: string; sizeMB: number } | null>(null);
  const [isRequestingCloudMaster, setIsRequestingCloudMaster] = useState<boolean>(false);
  // After asking iCloud for the master video the source reloads by itself until the file is on the Mac
  const [cloudMasterRequested, setCloudMasterRequested] = useState<boolean>(false);
  const [isWaitingGeminiClips, setIsWaitingGeminiClips] = useState<boolean>(false);

  // YouTube input
  const [youtubeUrlInput, setYoutubeUrlInput] = useState<string>('');

  // 2. OpusClip Virality Engine Settings
  const [targetDurationRange, setTargetDurationRange] = useState<'15_30' | '30_60' | '60_90'>(
    '30_60'
  );
  // 0 = Auto: the analysis decides how many clips the video supports
  const [desiredClipCount, setDesiredClipCount] = useState<number>(0);
  // Hook teaser removed: clips are pieces of the documentary in order (cuts allowed)
  const structurePreference = 'continuous' as const;
  const [customTopicFilter, setCustomTopicFilter] = useState<string>('');
  const [isAnalyzingViral, setIsAnalyzingViral] = useState<boolean>(false);

  // 3. Generated Viral Clips & Active Selection
  const [viralClips, setViralClips] = useState<ViralClipSuggestion[]>([]);
  const [selectedClipId, setSelectedClipId] = useState<string>('');
  const [copiedField, setCopiedField] = useState<string>('');

  // 4. Global Caption & Overlay Customization
  // Viral Clips: como máximo 2 palabras por línea de caption
  const [wordsPerLine, setWordsPerLine] = useState<number>(2);
  const [fontSizeScale, setFontSizeScale] = useState<number>(1.0);
  const [captionYPercent, setCaptionYPercent] = useState<number>(75);
  // The documentary's 9:16 look (logo + captions), mirrored by the preview and used by the render
  const [look916, setLook916] = useState<{
    logoWPct: number;
    logoXPct: number;
    logoYPct: number;
    /** Top of the on-screen title text (below the logo), % of the frame height */
    hookBannerTopPct?: number;
    logoOpacity: number;
    captionBottomPct: number;
    captionEmOfHeight: number;
  } | null>(null);
  const [officialLogoDataUrl, setOfficialLogoDataUrl] = useState<string>('');
  const previewFrameRef = useRef<HTMLDivElement | null>(null);
  const [previewFrameH, setPreviewFrameH] = useState<number>(551);
  const [showHookBanner, setShowHookBanner] = useState<boolean>(true);
  // Title look: 'poster_gold' = condensed poster letters (bone white + gold, worn), big for 8 s and then
  // small until the end; 'yellow_box' = the earlier yellow banner (first 8 s only)
  const [titleStyle, setTitleStyle] = useState<'poster_gold' | 'yellow_box'>(() => {
    try {
      return localStorage.getItem('huellas_viral_title_style') === 'yellow_box' ? 'yellow_box' : 'poster_gold';
    } catch {
      return 'poster_gold';
    }
  });
  // Where the link to the full documentary is for the network being posted to, and the link itself
  const [linkPlace, setLinkPlace] = useState<ViralLinkPlace>(() => {
    try {
      return localStorage.getItem('huellas_viral_link_place') === 'comments' ? 'comments' : 'bio';
    } catch {
      return 'bio';
    }
  });
  useEffect(() => {
    try {
      localStorage.setItem('huellas_viral_link_place', linkPlace);
    } catch {}
  }, [linkPlace]);
  const [docYoutubeUrl, setDocYoutubeUrl] = useState<string>('');
  // "VIDEO COMPLETO EN YOUTUBE" for 8 s in the middle of the clip
  const [showYoutubeNotice, setShowYoutubeNotice] = useState<boolean>(() => {
    try {
      return localStorage.getItem('huellas_viral_youtube_notice') !== 'off';
    } catch {
      return true;
    }
  });
  useEffect(() => {
    try {
      localStorage.setItem('huellas_viral_title_style', titleStyle);
      localStorage.setItem('huellas_viral_youtube_notice', showYoutubeNotice ? 'on' : 'off');
    } catch {}
  }, [titleStyle, showYoutubeNotice]);

  // 5. Video Preview Player State
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const [isPlaying, setIsPlaying] = useState<boolean>(false);
  const [playheadSec, setPlayheadSec] = useState<number>(0);
  const [actionToast, setActionToast] = useState<string>('');

  // 6. Instagram settings kept only for the analyze request (no Instagram UI: clips are published by hand)
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

  const selectedClip = useMemo(
    () => viralClips.find((c) => c.id === selectedClipId) || viralClips[0] || null,
    [viralClips, selectedClipId]
  );

  // Each clip's caption words always come from the transcript loaded now (the final video's Subtitulos.srt),
  // never from the copy saved with the clip: lists saved from an older, estimated script had words ~2 s off
  // and missing the first phrase. Also follows start/end edits.
  useEffect(() => {
    if (isLoadingSource || transcriptSegments.length === 0 || viralClips.length === 0) return;
    const sig = (ws: WordTimestamp[] = []) => ws.map((w) => `${w.word}@${Number(w.start).toFixed(2)}`).join(' ');
    let changed = false;
    const next = viralClips.map((c) => {
      const st = Number(c.startSec) || 0;
      const en = Number(c.endSec) || st;
      const words: WordTimestamp[] = [];
      for (const seg of transcriptSegments) {
        if (!(seg.end > st && seg.start < en)) continue;
        const wList = seg.words || buildWordsFromSegmentClient(seg.text, seg.start, seg.end);
        for (const w of wList) if (w.end > st && w.start < en) words.push(w);
      }
      if (words.length === 0 || sig(words) === sig(c.words)) return c;
      changed = true;
      return { ...c, words, transcriptExcerpt: words.map((w) => w.word).join(' ') };
    });
    if (changed) setViralClips(next);
  }, [transcriptSegments, viralClips, isLoadingSource]);

  // Load Instagram config on mount
  useEffect(() => {
    fetch(viralApi('/api/viral-clips/instagram-config'))
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
      const resp = await fetch(viralApi('/api/viral-clips/resolve-doc-source'), {
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
          setStaleMasterClips(
            Array.isArray(data.clipsNewerThanMaster) ? data.clipsNewerThanMaster.map(Number) : []
          );
          setViralMaster(data.viralMaster && typeof data.viralMaster === 'object' ? data.viralMaster : null);
          setMasterExportedAt(Number(data.masterExportedAt) || 0);
          setCloudOnlyMaster(
            data.masterVideoCloudOnly && data.masterVideoPath
              ? { path: String(data.masterVideoPath), sizeMB: Number(data.masterVideoSizeMB) || 0 }
              : null
          );
          setSourceStatusMsg(
            data.masterVideoCloudOnly
              ? `☁️ El video maestro está solo en iCloud (no descargado en la Mac) • ${
                  (data.transcriptSegments || []).length
                } segmentos de voz listos. Puedes elegir clips; para verlos y renderizar, descárgalo.`
              : data.masterVideoPath
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
    setCloudOnlyMaster(null);
    setStaleMasterClips([]);
    setViralMaster(null);
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
    if (sourceMode !== 'doc') setCloudOnlyMaster(null);
    setCloudMasterRequested(false);
    if (sourceMode === 'doc' && selectedDocId) {
      handleLoadDocumentarySource(selectedDocId);
    }
  }, [sourceMode, selectedDocId]);

  // Automatic reload (no button): while iCloud downloads the requested master, check again every 20 s
  const loadDocSourceRef = useRef(handleLoadDocumentarySource);
  loadDocSourceRef.current = handleLoadDocumentarySource;
  useEffect(() => {
    if (!cloudMasterRequested || !cloudOnlyMaster || sourceMode !== 'doc' || !selectedDocId) {
      if (cloudMasterRequested && !cloudOnlyMaster) setCloudMasterRequested(false);
      return;
    }
    const timer = window.setInterval(() => {
      void loadDocSourceRef.current(selectedDocId);
    }, 20000);
    return () => window.clearInterval(timer);
  }, [cloudMasterRequested, cloudOnlyMaster, sourceMode, selectedDocId]);

  // Detected clips are kept per documentary on the Mac: they come back after a reload or a restart.
  // `viralClipsDocIdRef` is the documentary the list on screen belongs to (never saved under another one).
  const viralClipsDocIdRef = useRef<string>('');
  const viralSaveTimerRef = useRef<number | null>(null);
  useEffect(() => {
    if (sourceMode !== 'doc' || !selectedDocId) return;
    let cancelled = false;
    if (viralClipsDocIdRef.current && viralClipsDocIdRef.current !== selectedDocId) {
      setViralClips([]);
      setSelectedClipId('');
    }
    viralClipsDocIdRef.current = '';
    (async () => {
      // The page reloads itself right after a server update, while the server may still be starting:
      // keep asking for a while instead of showing an empty list (the clips are still saved on the Mac).
      for (let attempt = 0; attempt < 40 && !cancelled; attempt++) {
        try {
          const resp = await fetch(viralApi(`/api/viral-clips/saved?docId=${encodeURIComponent(selectedDocId)}`), {
            cache: 'no-store',
          });
          const data = resp.ok ? await resp.json() : null;
          if (cancelled) return;
          if (!data?.ok) throw new Error('not ready');
          const saved = Array.isArray(data.clips) ? data.clips : [];
          viralClipsDocIdRef.current = selectedDocId;
          setDocYoutubeUrl(String(data.youtubeUrl || ''));
          if (data.pendingGeminiAnswer?.text && Number(data.pendingGeminiAnswer.at) > appliedGeminiAnswerAtRef.current) {
            pendingGeminiAnswerRef.current = {
              docId: selectedDocId,
              text: String(data.pendingGeminiAnswer.text),
              at: Number(data.pendingGeminiAnswer.at),
            };
            setPendingGeminiTick((t) => t + 1);
          }
          if (saved.length > 0) {
            // Lists saved before the 5-hashtag rule can carry 6 or more: keep exactly 5
            setViralClips(saved.map((c: any) => ({ ...c, hashtags: limitToFiveHashtags(c?.hashtags || '') })));
            const sel = saved.find((c: any) => c.id === data.selectedClipId) || saved[0];
            setSelectedClipId(sel.id);
            setPlayheadSec(Number(sel.startSec) || 0);
          }
          return;
        } catch {
          await new Promise((r) => window.setTimeout(r, 3000));
        }
      }
      // Never saves over the Mac's list unless it was read (the ref stays empty)
    })();
    return () => {
      cancelled = true;
    };
  }, [sourceMode, selectedDocId]);
  useEffect(() => {
    const docId = viralClipsDocIdRef.current;
    if (sourceMode !== 'doc' || !docId || docId !== selectedDocId) return;
    if (viralSaveTimerRef.current) window.clearTimeout(viralSaveTimerRef.current);
    viralSaveTimerRef.current = window.setTimeout(() => {
      fetch(viralApi('/api/viral-clips/saved'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          docId,
          clips: viralClips,
          selectedClipId,
          youtubeUrl: docYoutubeUrl,
          clearPendingGeminiAt: appliedGeminiAnswerAtRef.current || undefined,
        }),
      }).catch(() => {});
    }, 800);
  }, [viralClips, selectedClipId, docYoutubeUrl]);

  // Upload Local Video Handler
  const handleUploadLocalVideo = async (file: File) => {
    setIsLoadingSource(true);
    setSourceStatusMsg(`Subiendo y transcribiendo "${file.name}" con IA...`);
    try {
      const form = new FormData();
      form.append('video', file);
      const resp = await fetch(viralApi('/api/viral-clips/upload-video'), {
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
      const resp = await fetch(viralApi('/api/viral-clips/ingest-youtube'), {
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

  const buildViralClipsFromList = (list: any[], origin: 'gemini' | 'local'): ViralClipSuggestion[] =>
    list.map((c: any, idx: number) => {
      // Gemini may give the clip as several pieces in order (cuts allowed): the clip spans from the first to the last
      const rawPieces: Array<{ startSec: number; endSec: number }> = (Array.isArray(c.segments) ? c.segments : [])
        .map((r: any) =>
          Array.isArray(r)
            ? { startSec: Number(r[0]), endSec: Number(r[1]) }
            : { startSec: Number(r?.startSec ?? r?.start), endSec: Number(r?.endSec ?? r?.end) }
        )
        .filter((r: any) => Number.isFinite(r.startSec) && Number.isFinite(r.endSec) && r.endSec > r.startSec);
      const st = Math.max(
        0,
        rawPieces.length > 0 ? Math.min(...rawPieces.map((r) => r.startSec)) : Number(c.startSec) || 0
      );
      const en = Math.max(
        st + 15,
        rawPieces.length > 0 ? Math.max(...rawPieces.map((r) => r.endSec)) : Number(c.endSec) || st + 40
      );
      const pieces = normalizeViralSegments({ startSec: st, endSec: en, segments: rawPieces });
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
        structureMode: 'continuous',
        startSec: st,
        endSec: en,
        durationSec: Number(viralSegmentsDurationSec(pieces).toFixed(1)),
        segments: pieces.length > 1 ? pieces : undefined,
        hookBannerText: String(c.hookBannerText || c.title || '').toUpperCase(),
        socialCaption: c.socialCaption || '',
        hashtags: limitToFiveHashtags(c.hashtags || '#HistoriaMedieval #DatosCuriosos #CulturaGeneral #EdadMedia #HistoriaUniversal'),
        pinnedComment: String(c.pinnedComment || '').trim(),
        transcriptExcerpt: overlapping.map((o) => o.text).join(' '),
        words,
        reframeMode: 'center_fill',
        focusX: 50,
        captionStyle: 'yellow_white',
        origin,
      };
    });

  // Respuesta de Gemini Web al botón "Gemini Web (Gratis)": se convierte en la lista de clips, igual que
  // el análisis local. Llega marcada con VIRAL_CLIPS_GEMINI_STAGE y nunca se guarda como resultado de una etapa.
  const transcriptSegmentsRef = useRef<TranscriptSegmentItem[]>([]);
  transcriptSegmentsRef.current = transcriptSegments;
  const geminiViralOrderRef = useRef<{ payload: any; attempts: number } | null>(null);
  const applyGeminiViralResponseRef = useRef<(text: string) => boolean>(() => false);
  // Instant of the stored Gemini answer turned into the list on screen (the next save clears it on the Mac)
  const appliedGeminiAnswerAtRef = useRef<number>(0);
  applyGeminiViralResponseRef.current = (text: string): boolean => {
    setIsWaitingGeminiClips(false);
    if (sourceMode === 'doc' && selectedDocId) viralClipsDocIdRef.current = selectedDocId;
    let parsedList: any[] = [];
    try {
      const raw = String(text || '');
      const startIdx = raw.indexOf('{');
      const endIdx = raw.lastIndexOf('}');
      const parsed = startIdx >= 0 && endIdx > startIdx ? JSON.parse(raw.slice(startIdx, endIdx + 1)) : null;
      parsedList = Array.isArray(parsed?.clips) ? parsed.clips : [];
    } catch {
      parsedList = [];
    }
    const segs = transcriptSegmentsRef.current;
    const spanEnd = segs.length > 0 ? segs[segs.length - 1].end : 0;
    // A clip may come as pieces only ("segments"): its range runs from the first piece to the last
    const pieceBounds = (c: any): { st: number; en: number } => {
      const ps = (Array.isArray(c?.segments) ? c.segments : [])
        .map((r: any) => (Array.isArray(r) ? [Number(r[0]), Number(r[1])] : [Number(r?.startSec ?? r?.start), Number(r?.endSec ?? r?.end)]))
        .filter((r: number[]) => Number.isFinite(r[0]) && Number.isFinite(r[1]) && r[1] > r[0]);
      if (ps.length > 0) return { st: Math.min(...ps.map((r: number[]) => r[0])), en: Math.max(...ps.map((r: number[]) => r[1])) };
      return { st: Number(c?.startSec), en: Number(c?.endSec) };
    };
    const valid = parsedList.filter((c) => {
      const { st, en } = pieceBounds(c);
      return Number.isFinite(st) && Number.isFinite(en) && en > st + 5 && st >= 0 && st < spanEnd;
    });
    if (valid.length === 0) {
      // A veces la extensión captura la respuesta antes de que Gemini termine: se reenvía una vez sola
      const pending = geminiViralOrderRef.current;
      if (pending && pending.attempts < 2) {
        pending.attempts += 1;
        sendCommandToWebBridge('GEMINI', pending.payload);
        setIsWaitingGeminiClips(true);
        setActionToast('🔁 La respuesta de Gemini llegó incompleta; la pido otra vez...');
        return false;
      }
      setActionToast('⚠️ Gemini respondió, pero sin una lista de clips que se pueda leer. Vuelve a pulsar "Gemini Web (Gratis)".');
      return false;
    }
    geminiViralOrderRef.current = null;
    const built = buildViralClipsFromList(
      valid.sort((a, b) => (Number(b.viralityScore) || 0) - (Number(a.viralityScore) || 0)),
      'gemini'
    );
    setViralClips(built);
    setSelectedClipId(built[0].id);
    setPlayheadSec(built[0].startSec);
    setActionToast(`✅ Gemini eligió ${built.length} clips. Ya están en la lista.`);
    return true;
  };

  // Gemini's answer is stored on the Mac by the page as soon as it arrives (even if this screen was closed).
  // Here it is turned into the clip list: right away if this documentary is open, or the next time it is.
  const pendingGeminiAnswerRef = useRef<{ docId: string; text: string; at: number } | null>(null);
  const [pendingGeminiTick, setPendingGeminiTick] = useState<number>(0);
  const fetchPendingGeminiAnswer = async (docId: string) => {
    try {
      const resp = await fetch(viralApi(`/api/viral-clips/saved?docId=${encodeURIComponent(docId)}`), {
        cache: 'no-store',
      });
      const data = resp.ok ? await resp.json() : null;
      const p = data?.pendingGeminiAnswer;
      if (p?.text && Number(p.at) > appliedGeminiAnswerAtRef.current) {
        pendingGeminiAnswerRef.current = { docId, text: String(p.text), at: Number(p.at) };
        setPendingGeminiTick((t) => t + 1);
      }
    } catch {}
  };
  useEffect(() => {
    const p = pendingGeminiAnswerRef.current;
    if (!p || sourceMode !== 'doc' || p.docId !== selectedDocId) return;
    // The answer can only be checked against the narration once it is loaded
    if (transcriptSegments.length === 0) return;
    pendingGeminiAnswerRef.current = null;
    viralClipsDocIdRef.current = selectedDocId;
    if (applyGeminiViralResponseRef.current(p.text)) {
      appliedGeminiAnswerAtRef.current = p.at;
    }
  }, [pendingGeminiTick, transcriptSegments, selectedDocId, sourceMode]);
  useEffect(() => {
    const onAnswer = (ev: Event) => {
      const docId = String((ev as CustomEvent).detail?.docId || '');
      if (docId && docId === selectedDocId) void fetchPendingGeminiAnswer(docId);
    };
    window.addEventListener('huellas-viral-gemini-answer', onAnswer);
    return () => window.removeEventListener('huellas-viral-gemini-answer', onAnswer);
  }, [selectedDocId]);
  useEffect(() => {
    const onExtensionMessage = (event: MessageEvent) => {
      const msg = event.data;
      if (!msg || msg.source !== 'HUELLAS_EXTENSION') return;
      if (Number(msg.stageNumber) !== VIRAL_CLIPS_GEMINI_STAGE) return;
      // The answer itself is stored on the Mac by the page and arrives through 'huellas-viral-gemini-answer'
      if (msg.status === 'ERROR') {
        setIsWaitingGeminiClips(false);
        setActionToast(`⚠️ ${msg.message || 'Gemini Web no pudo completar el pedido.'}`);
      }
    };
    window.addEventListener('message', onExtensionMessage);
    return () => window.removeEventListener('message', onExtensionMessage);
  }, []);

  const handleRequestCloudMaster = async () => {
    if (!cloudOnlyMaster) return;
    setIsRequestingCloudMaster(true);
    try {
      const resp = await fetch(viralApi('/api/viral-clips/download-master'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ filePath: cloudOnlyMaster.path }),
      });
      const data = await resp.json().catch(() => ({}));
      if (resp.ok && data.ok) {
        setCloudMasterRequested(true);
        if (data.alreadyLocal) void handleLoadDocumentarySource(selectedDocId);
        setActionToast(
          data.alreadyLocal
            ? '✅ El video maestro ya está en la Mac. Cargándolo...'
            : `☁️ Descarga pedida a iCloud (${(cloudOnlyMaster.sizeMB / 1024).toFixed(1)} GB). Tarda varios minutos; se cargará solo cuando termine.`
        );
      } else {
        setActionToast(`⚠️ ${data.error || 'No se pudo pedir la descarga a iCloud.'}`);
      }
    } catch {
      setActionToast('⚠️ No se pudo conectar con la Mac para pedir la descarga.');
    } finally {
      setIsRequestingCloudMaster(false);
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
    // Gemini's list is the good one: never replace it with the local engine by accident
    if (
      viralClipsOrigin(viralClips) === 'gemini' &&
      !window.confirm(
        'Los clips de la lista los eligió Gemini Web. ¿Reemplazarlos por el análisis local (títulos con las primeras palabras de la narración)?'
      )
    ) {
      return;
    }
    setIsAnalyzingViral(true);
    // A new analysis belongs to the documentary selected now (it is saved under it)
    if (sourceMode === 'doc' && selectedDocId) viralClipsDocIdRef.current = selectedDocId;
    try {
      const resp = await fetch(viralApi('/api/viral-clips/analyze'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title: sourceTitle,
          durationSec: sourceDurationSec,
          transcriptSegments,
          targetDurationRange,
          clipCount: desiredClipCount > 0 ? desiredClipCount : 'auto',
          structurePreference,
          customTopicFilter,
          autoDmKeyword: igConfig.autoDm.keyword || 'HUELLAS',
        }),
      });
      if (resp.ok) {
        const data = await resp.json();
        if (data.ok && Array.isArray(data.clips) && data.clips.length > 0) {
          setViralClips(
            data.clips.map((c: ViralClipSuggestion) => ({
              ...c,
              hashtags: limitToFiveHashtags(c.hashtags || ''),
              origin: 'local' as const,
            }))
          );
          setSelectedClipId(data.clips[0].id);
          setPlayheadSec(data.clips[0].startSec);
          if (data.autoCountReason) setActionToast(`🤖 Auto: ${data.autoCountReason}`);
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
      const fallbackCount =
        desiredClipCount > 0 ? desiredClipCount : Math.max(3, Math.floor(totalSpan / 75));
      const stepSec = Math.max(15, (totalSpan - minDur) / Math.max(1, fallbackCount));
      for (let k = 0; k < fallbackCount; k++) {
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
          structureMode: 'continuous',
          startSec: st,
          endSec: en,
          hookBannerText: firstWords.toUpperCase(),
          socialCaption: `${startSeg.text} — Una historia real que marcó a toda una generación.`,
          hashtags: '#HistoriaUniversal #DatosCuriosos #CulturaGeneral #DocumentalHistorico #ViajeEnElTiempo',
        });
      }
      const built = buildViralClipsFromList(list, 'local');
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


  // Light 720p preview of the final video (the 8K original stutters in the browser). The player switches to
  // it as soon as it is ready; renders keep using the original file.
  const [previewProxyUrl, setPreviewProxyUrl] = useState<string>('');
  const [previewProxyPct, setPreviewProxyPct] = useState<number | null>(null);
  // A documentary plays its clean 9:16 master as soon as one exists (the clips wait for an up-to-date one)
  const useMasterSource = sourceMode === 'doc' && Boolean(viralMaster?.exists && viralMaster?.path);
  const previewSourcePath = useMasterSource ? String(viralMaster?.path || '') : sourceLocalPath;
  useEffect(() => {
    setPreviewProxyUrl('');
    setPreviewProxyPct(null);
    if (!previewSourcePath || (!useMasterSource && cloudOnlyMaster)) return;
    let cancelled = false;
    let timer: number | null = null;
    const poll = async () => {
      try {
        const resp = await fetch(viralApi('/api/viral-clips/preview-proxy'), {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ filePath: previewSourcePath }),
        });
        const data = resp.ok ? await resp.json() : null;
        if (cancelled || !data?.ok) return;
        if (data.ready) {
          if (data.url) setPreviewProxyUrl(String(data.url));
          setPreviewProxyPct(null);
          return;
        }
        if (data.failed || data.cloudOnly) {
          setPreviewProxyPct(null);
          return;
        }
        setPreviewProxyPct(Number(data.progressPct) || 0);
        timer = window.setTimeout(poll, 5000);
      } catch {
        if (!cancelled) timer = window.setTimeout(poll, 8000);
      }
    };
    void poll();
    return () => {
      cancelled = true;
      if (timer) window.clearTimeout(timer);
    };
  }, [previewSourcePath, useMasterSource, cloudOnlyMaster, viralMaster?.builtAt]);
  const playerVideoUrl = previewProxyUrl || (useMasterSource ? String(viralMaster?.url || '') : sourceVideoUrl);

  // While the master is missing, being made or out of date, ask the Mac every few seconds how it goes
  useEffect(() => {
    if (sourceMode !== 'doc' || !selectedDocId) return;
    let cancelled = false;
    let timer: number | null = null;
    const poll = async () => {
      try {
        const r = await fetch(viralApi(`/api/viral-clips/master-status?docId=${encodeURIComponent(selectedDocId)}`), {
          cache: 'no-store',
        });
        const data = r.ok ? await r.json() : null;
        if (!cancelled && data?.ok && data.master) {
          setViralMaster((prev) =>
            prev && prev.builtAt === data.master.builtAt && prev.state === data.master.state && prev.progressPct === data.master.progressPct
              ? prev
              : data.master
          );
        }
      } catch {}
      if (!cancelled) timer = window.setTimeout(poll, viralMaster?.state === 'ready' ? 30000 : 5000);
    };
    timer = window.setTimeout(poll, 3000);
    return () => {
      cancelled = true;
      if (timer) window.clearTimeout(timer);
    };
  }, [sourceMode, selectedDocId, viralMaster?.state]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const lr = await fetch(
          viralApi(`/api/viral-clips/look-916?docId=${encodeURIComponent(sourceMode === 'doc' ? selectedDocId : '')}`)
        );
        const look = lr.ok ? await lr.json() : null;
        if (!cancelled && look?.ok) {
          setLook916(look);
          // Captions sit where the documentary's 9:16 captions sit (their bottom edge)
          setCaptionYPercent(Math.round(100 - Number(look.captionBottomPct || 25)));
        }
      } catch {}
      try {
        if (!officialLogoDataUrl) {
          const gr = await fetch(viralApi('/api/assets/official-logo'));
          const g = gr.ok ? await gr.json() : null;
          if (!cancelled && g?.logoDataUrl) setOfficialLogoDataUrl(String(g.logoDataUrl));
        }
      } catch {}
    })();
    return () => {
      cancelled = true;
    };
  }, [sourceMode, selectedDocId]);
  useEffect(() => {
    const el = previewFrameRef.current;
    if (!el || typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver(() => setPreviewFrameH(el.clientHeight || 551));
    ro.observe(el);
    return () => ro.disconnect();
  });

  // Constrain playback to [selectedClip.startSec, selectedClip.endSec]
  const handleTimeUpdate = () => {
    const vid = videoRef.current;
    if (!vid || !selectedClip) return;
    if (applyClipCutsAt(vid)) return;
    setPlayheadSec(vid.currentTime);
  };

  const togglePlayClip = () => {
    const vid = videoRef.current;
    if (!vid || !selectedClip) return;
    if (vid.paused) {
      if (clipCuts && toClipTime(vid.currentTime) >= clipCuts.totalDurSec - 0.3) seekClipTime(0);
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
        updated.durationSec = Number(Math.max(3, viralSegmentsDurationSec(normalizeViralSegments(updated))).toFixed(1));
        return updated;
      })
    );
  };

  // The documentary's final video (06_Video_Final) already has 16:9 subtitles burned in at the bottom;
  // the render cuts that strip away, and the preview does the same.
  const hasBurnedDocCaptions = /[\\/]06_Video_Final[\\/]/i.test(String(sourceLocalPath || ''));

  // Compute current active word chunk for the live 9:16 preview player
  // The preview plays exactly what gets exported (src/utils/viralClipCuts.ts, same as the render): the clip's
  // pieces one after another, cut between whole words. captionSec is the CLIP time (0 = first frame of the
  // exported Reel); partRef says which piece of the source video is playing.
  const clipCuts = useMemo(
    () =>
      selectedClip
        ? computeViralClipCuts({
            startSec: selectedClip.startSec,
            endSec: selectedClip.endSec,
            segments: selectedClip.segments,
            words: selectedClip.words || [],
          })
        : null,
    [selectedClip?.id, selectedClip?.startSec, selectedClip?.endSec, selectedClip?.segments, selectedClip?.words]
  );
  // The player's pieces: on the 9:16 master the times move back by the intro/outro the master leaves out
  // (captions keep using clipCuts, on the documentary's timeline like the words)
  const playCuts = useMemo(() => {
    if (!clipCuts || !useMasterSource) return clipCuts;
    const skip = viralMaster?.skipRanges916 || [];
    return {
      ...clipCuts,
      parts: clipCuts.parts.map((p) => {
        const srcStart = timelineToMasterTime(p.srcStart, skip);
        return { ...p, srcStart, srcEnd: srcStart + p.dur };
      }),
    };
  }, [clipCuts, useMasterSource, viralMaster?.builtAt]);
  const partRef = useRef<number>(0);
  const toClipTime = (sourceSec: number) => (playCuts ? viralSourceToClipTime(playCuts, sourceSec, partRef.current) : 0);
  /** Moves the player to a point of the exported clip (0 … total) */
  const seekClipTime = (clipSec: number) => {
    if (!playCuts) return;
    const ct = Math.max(0, Math.min(playCuts.totalDurSec, clipSec));
    const { partIndex, sourceSec } = viralClipTimeToSource(playCuts, ct);
    partRef.current = partIndex;
    if (videoRef.current) videoRef.current.currentTime = sourceSec;
    setPlayheadSec(sourceSec);
    setCaptionSec(ct);
  };
  /** Jump to the next piece and end of clip, checked every frame while playing (exact cuts, no half words) */
  const applyClipCutsAt = (vid: HTMLVideoElement): boolean => {
    if (!playCuts || playCuts.parts.length === 0) return false;
    const idx = Math.max(0, Math.min(playCuts.parts.length - 1, partRef.current));
    const part = playCuts.parts[idx];
    if (vid.currentTime >= part.srcEnd - 0.01) {
      const next = playCuts.parts[idx + 1];
      if (next) {
        partRef.current = idx + 1;
        vid.currentTime = next.srcStart;
      } else {
        vid.pause();
        setIsPlaying(false);
        seekClipTime(0);
      }
      return true;
    }
    return false;
  };

  // Sync video player when the selected clip (or its cuts) changes: back to the first frame of the export
  useEffect(() => {
    if (selectedClip && videoRef.current) {
      videoRef.current.pause();
      setIsPlaying(false);
      seekClipTime(0);
    }
  }, [selectedClip?.id, playCuts]);

  // Caption clock: 'timeupdate' only fires ~4 times a second, so captions changed up to 0.25 s late.
  // While playing, a frame loop reads the video time and re-renders only when it crosses a word start/end
  // (same precision as the 9:16 editor, without re-rendering the studio every frame).
  const [captionSec, setCaptionSec] = useState<number>(0);
  // Words on the exported clip's timeline, without punctuation (same as the render)
  const clipLocalWords = useMemo(() => {
    if (!clipCuts || !selectedClip) return [] as WordTimestamp[];
    return buildViralLocalWords(clipCuts, selectedClip.words || [])
      .map((w) => ({ ...w, word: stripCaptionPunctuation(w.word) }))
      .filter((w) => w.word);
  }, [clipCuts, selectedClip?.words]);
  const captionBoundaries = useMemo(() => {
    const out: number[] = [8]; // the on-screen title disappears at 8 s
    for (const w of clipLocalWords) {
      out.push(w.start - 0.08, w.start, w.end, w.end + 0.15);
    }
    return out.sort((a, b) => a - b);
  }, [clipLocalWords]);
  useEffect(() => {
    setCaptionSec(toClipTime(playheadSec));
  }, [playheadSec]);
  useEffect(() => {
    if (!isPlaying) return;
    let raf = 0;
    let lastBucket = -2;
    const tick = () => {
      const vid = videoRef.current;
      if (vid) {
        if (applyClipCutsAt(vid)) lastBucket = -2;
        const ct = toClipTime(vid.currentTime);
        // index of the last boundary already passed
        let lo = 0;
        let hi = captionBoundaries.length;
        while (lo < hi) {
          const mid = (lo + hi) >> 1;
          if (captionBoundaries[mid] <= ct) lo = mid + 1;
          else hi = mid;
        }
        if (lo !== lastBucket) {
          lastBucket = lo;
          setCaptionSec(ct);
        }
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [isPlaying, captionBoundaries, playCuts]);

  const activeCaptionChunk = useMemo(() => {
    if (!clipCuts || clipLocalWords.length === 0) return null;
    const safePerLine = Math.max(1, Math.min(2, wordsPerLine));
    const words = clipLocalWords;
    // Igual que la exportación: cada línea se corta también a los 16 caracteres y nunca cruza el paso
    // del gancho al cuerpo del clip
    const VIRAL_CAPTION_MAX_CHARS = 16;
    const cutTimes = viralCutTimes(clipCuts);
    const chunks: (typeof words)[] = [];
    let cur: typeof words = [];
    let curLen = 0;
    for (const w of words) {
      const wl = String(w.word || '').length;
      const prevStart = cur.length > 0 ? cur[cur.length - 1].start : 0;
      const crossesBreak = cur.length > 0 && cutTimes.some((b) => prevStart < b && w.start >= b);
      if (
        cur.length > 0 &&
        (crossesBreak || cur.length >= safePerLine || curLen + 1 + wl > VIRAL_CAPTION_MAX_CHARS)
      ) {
        chunks.push(cur);
        cur = [];
        curLen = 0;
      }
      cur.push(w);
      curLen += (cur.length > 1 ? 1 : 0) + wl;
    }
    if (cur.length > 0) chunks.push(cur);
    // The line that already started wins (latest start <= time). The 0.08 s lead and 0.15 s tail only fill
    // silences: before, the previous line's tail covered the next one and short words ("de", "y", "la")
    // were never highlighted during playback.
    const t = captionSec;
    let idx = -1;
    for (let i = 0; i < chunks.length; i++) {
      if (chunks[i][0].start <= t) idx = i;
      else break;
    }
    let pick = -1;
    if (idx >= 0) {
      const c = chunks[idx];
      const cEnd = c[c.length - 1].end;
      const nx = chunks[idx + 1];
      if (t <= cEnd + 0.15 && !(nx && t > cEnd && t >= nx[0].start - 0.08)) pick = idx;
    }
    if (pick < 0 && chunks[idx + 1] && t >= chunks[idx + 1][0].start - 0.08) pick = idx + 1;
    if (pick >= 0) {
      const chunk = chunks[pick];
      let activeIdx = 0;
      for (let j = 0; j < chunk.length; j++) {
        if (t >= chunk[j].start) activeIdx = j;
      }
      return { chunk, activeIdx };
    }
    return null;
  }, [clipCuts, clipLocalWords, captionSec, wordsPerLine]);

  // Poster title in the preview: the same lines, moments and places as the render
  const posterTitleLines = useMemo(
    () => (showHookBanner ? splitViralTitleLines(selectedClip?.hookBannerText || '') : []),
    [showHookBanner, selectedClip?.hookBannerText]
  );
  const previewFrameW = (previewFrameH * 9) / 16;
  const posterSmallLines = useMemo(() => buildViralSmallTitleLines(posterTitleLines), [posterTitleLines]);
  const posterSmallFontPx = useViralPosterFontPx(
    posterSmallLines,
    previewFrameW,
    previewFrameH,
    VIRAL_TITLE_LOOK.smallTextWFrac,
    VIRAL_TITLE_LOOK.bigFontHFrac * VIRAL_TITLE_LOOK.smallFontScale
  );
  const posterTitle = useMemo(() => {
    const timeline = computeViralTitleTimeline(clipCuts ? clipCuts.totalDurSec : 0, {
      hasTitle: posterTitleLines.length > 0,
      showNotice: showYoutubeNotice,
    });
    const topPx = (previewFrameH * (look916?.hookBannerTopPct ?? 13.5)) / 100;
    // The notice sits under the small title (under the logo when the yellow banner is used instead)
    const smallTextH =
      titleStyle === 'poster_gold' && timeline.small
        ? viralPosterTextHeightPx(posterSmallLines.length, posterSmallFontPx)
        : 0;
    return {
      lines: posterTitleLines,
      smallLines: posterSmallLines,
      timeline,
      frameW: previewFrameW,
      topPx,
      noticeTopPx: topPx + smallTextH + previewFrameH * VIRAL_TITLE_LOOK.noticeGapHFrac,
    };
  }, [
    clipCuts,
    posterTitleLines,
    posterSmallLines,
    showYoutubeNotice,
    previewFrameH,
    previewFrameW,
    look916?.hookBannerTopPct,
    titleStyle,
    posterSmallFontPx,
  ]);

  // Exports ("Guardar Clip ##"): each click queues a render on the Mac; several can run at once (the Mac
  // encodes two at a time, the rest wait). The list under the button comes from the Mac, so it survives a
  // reload and is the same from the iPhone.
  type ViralRenderJobRow = {
    jobId: string;
    docId: string;
    clipId: string;
    clipNumber: number;
    title: string;
    status: 'waiting_master' | 'queued' | 'running' | 'done' | 'error';
    progressPct: number;
    elapsedSec: number;
    masterState?: string;
    masterProgressPct?: number;
    masterError?: string;
    finishedAt: number;
    fileName: string;
    publicServeUrl: string;
    savedInDocFolderPath: string;
    durationSec: number;
    error: string;
  };
  const [renderJobs, setRenderJobs] = useState<ViralRenderJobRow[]>([]);
  const renderJobsDocId = sourceMode === 'doc' ? selectedDocId : '';
  const seenFinishedJobsRef = useRef<Set<string>>(new Set());
  const firstJobsLoadRef = useRef<boolean>(true);
  const [renderJobsTick, setRenderJobsTick] = useState<number>(0);
  const hasActiveRenderJobs = renderJobs.some(
    (j) => j.status === 'queued' || j.status === 'running' || j.status === 'waiting_master'
  );
  useEffect(() => {
    firstJobsLoadRef.current = true;
    seenFinishedJobsRef.current = new Set();
    setRenderJobs([]);
  }, [renderJobsDocId]);
  useEffect(() => {
    let cancelled = false;
    let timer: number | null = null;
    const load = async () => {
      try {
        const r = await fetch(viralApi(`/api/viral-clips/render-jobs?docId=${encodeURIComponent(renderJobsDocId)}`), {
          cache: 'no-store',
        });
        const data = r.ok ? await r.json() : null;
        if (cancelled || !data?.ok || !Array.isArray(data.jobs)) return;
        const jobs: ViralRenderJobRow[] = data.jobs;
        setRenderJobs(jobs);
        const justFinished = jobs.filter(
          (j) => (j.status === 'done' || j.status === 'error') && !seenFinishedJobsRef.current.has(j.jobId)
        );
        justFinished.forEach((j) => seenFinishedJobsRef.current.add(j.jobId));
        // On the first load only remember what was already finished (no toasts / downloads again)
        if (firstJobsLoadRef.current) {
          firstJobsLoadRef.current = false;
          const done = jobs.filter((j) => j.status === 'done' && j.clipId);
          if (done.length > 0) {
            setViralClips((prev) =>
              prev.map((c) => {
                const d = done.find((j) => j.clipId === c.id);
                return d && !c.renderedReelUrl ? { ...c, renderedReelUrl: d.publicServeUrl } : c;
              })
            );
          }
          return;
        }
        for (const j of justFinished) {
          if (j.status === 'done') {
            setViralClips((prev) =>
              prev.map((c) =>
                c.id === j.clipId
                  ? {
                      ...c,
                      renderedReelUrl: j.publicServeUrl,
                      savedDocFolderPath: j.savedInDocFolderPath || c.savedDocFolderPath,
                    }
                  : c
              )
            );
            // Without a documentary folder (uploaded MP4 / YouTube link) the file is downloaded on the Mac
            if (!j.savedInDocFolderPath && j.publicServeUrl && !isRemoteViralDevice) {
              const a = document.createElement('a');
              a.href = viralMedia(j.publicServeUrl);
              a.download = j.fileName || 'Reel_9x16.mp4';
              document.body.appendChild(a);
              a.click();
              a.remove();
            }
            setActionToast(`✅ Clip ${String(j.clipNumber).padStart(2, '0')} guardado: ${j.fileName}`);
          } else {
            setActionToast(`⚠️ El Clip ${String(j.clipNumber).padStart(2, '0')} no se pudo guardar.`);
          }
        }
      } catch {}
    };
    const loop = async () => {
      await load();
      if (!cancelled) timer = window.setTimeout(loop, hasActiveRenderJobs ? 3000 : 20000);
    };
    void loop();
    return () => {
      cancelled = true;
      if (timer) window.clearTimeout(timer);
    };
  }, [renderJobsDocId, hasActiveRenderJobs, renderJobsTick]);

  const handleRenderViralClip = async (clip: ViralClipSuggestion) => {
    if (!sourceLocalPath) {
      alert(
        'Para guardar el clip, primero exporta el video del documental en 06_Video_Final, o sube un archivo MP4, o usa un enlace de YouTube.'
      );
      return;
    }
    const clipNumber = Math.max(1, viralClips.findIndex((c) => c.id === clip.id) + 1);
    try {
      const resp = await fetch(viralApi('/api/viral-clips/render'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          sourceVideoPath: sourceLocalPath,
          docId: renderJobsDocId,
          clipId: clip.id,
          docRootFolder,
          clipTitle: clip.title,
          // Its place in the list (#1, #2…): the file is named Video_##_Viral_Clip_##_<title>
          clipNumber,
          startSec: clip.startSec,
          endSec: clip.endSec,
          segments: clip.segments,
          reframeMode: clip.reframeMode,
          focusX: clip.focusX,
          captionStyle: clip.captionStyle,
          wordsPerLine,
          fontSizeScale,
          captionYPercent,
          words: clip.words,
          hookBannerText: clip.hookBannerText,
          showHookBanner,
          titleStyle,
          showYoutubeNotice,
          // Background job in the Mac's queue (through the tunnel a request open more than 100 s is cut)
          async: true,
        }),
      });
      const started = await resp.json().catch(() => ({}));
      if (!resp.ok || !started.ok || !started.jobId) {
        throw new Error(started.error || 'No se pudo poner el clip en la cola.');
      }
      setActionToast(
        started.alreadyQueued
          ? `⏳ El Clip ${String(clipNumber).padStart(2, '0')} ya se está guardando.`
          : `⏳ Clip ${String(clipNumber).padStart(2, '0')} en la cola de exportación.`
      );
      setRenderJobsTick((t) => t + 1);
    } catch (err: any) {
      alert('Error al guardar el clip: ' + (err?.message || 'Error desconocido'));
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
                OpusClip IA + Reels 9:16
              </span>
            </div>
            <p className="text-xs text-slate-400">
              Detecta los momentos con mayor retención, agrega captions dinámicos palabra por palabra y exporta Reels 9:16 listos para publicar.
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
                  {isLoadingSource && (
                    <RefreshCw className="w-3.5 h-3.5 animate-spin text-amber-300 self-center" />
                  )}
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

            {sourceMode === 'doc' && viralMaster && (
              <div
                className={`mt-2 px-3 py-2 rounded-xl text-xs leading-relaxed border ${
                  viralMaster.state === 'ready'
                    ? 'bg-emerald-950/50 border-emerald-500/40 text-emerald-100'
                    : viralMaster.lastError
                    ? 'bg-rose-950/60 border-rose-500/50 text-rose-100'
                    : 'bg-amber-950/50 border-amber-500/40 text-amber-100'
                }`}
              >
                {viralMaster.state === 'ready' ? (
                  <>🎞 Master 9:16 limpio listo: los clips salen con el encuadre del editor y los clips vigentes.</>
                ) : viralMaster.state === 'building' ? (
                  <>
                    ⚙️ Preparando el master 9:16 limpio{viralMaster.progressPct ? ` (${viralMaster.progressPct}%)` : ''}. Se hace
                    solo, en segundo plano; si exportas algo en el editor, se pausa y sigue después. Los clips que guardes
                    esperan a que esté.
                  </>
                ) : viralMaster.state === 'no_recipe' ? (
                  <>⏳ Preparando la receta del master 9:16 desde el editor (unos segundos con el documental abierto en la Mac).</>
                ) : viralMaster.lastError ? (
                  <>⚠️ No se pudo preparar el master 9:16: {viralMaster.lastError.split('\n').filter(Boolean).slice(-1)[0]}</>
                ) : (
                  <>
                    ⏳ {viralMaster.exists ? 'El master 9:16 está desactualizado' : 'Todavía no hay master 9:16'}
                    {viralMaster.reasons.includes('clips_nuevos') ? ' (hay clips más nuevos)' : ''}. Se prepara solo
                    {viralMaster.exists ? ' cuando dejes de editar unos minutos' : ''}; si guardas un clip, empieza enseguida.
                  </>
                )}
              </div>
            )}

            {cloudOnlyMaster && (
              <button
                type="button"
                onClick={handleRequestCloudMaster}
                disabled={isRequestingCloudMaster}
                className="w-full py-2 px-3 rounded-xl bg-sky-950/80 hover:bg-sky-900 border border-sky-500/40 text-sky-200 font-bold text-xs cursor-pointer disabled:opacity-50"
                title="Pide a iCloud que descargue el video maestro en la Mac. Sin él no se puede ver ni renderizar el clip."
              >
                {isRequestingCloudMaster
                  ? 'Pidiendo la descarga…'
                  : `☁️ Descargar de iCloud el video maestro (${(cloudOnlyMaster.sizeMB / 1024).toFixed(1)} GB)`}
              </button>
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
                    <option value={0}>Auto (recomendado)</option>
                    <option value={3}>Top 3 Virales</option>
                    <option value={5}>Top 5 Virales</option>
                    <option value={8}>Top 8 Virales</option>
                    <option value={10}>Top 10 Virales</option>
                  </select>
                </div>

              </div>

              <div className="grid grid-cols-1 gap-2">
                <input
                  type="text"
                  value={customTopicFilter}
                  onChange={(e) => setCustomTopicFilter(e.target.value)}
                  placeholder="Filtro opcional (ej. momentos más dramáticos, cifras...)"
                  className="bg-slate-950 border border-slate-800 rounded-lg px-2.5 py-1.5 text-xs text-slate-200 outline-none"
                />
              </div>
            </div>

            <div className="flex flex-col sm:flex-row gap-2">
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
                  // What the full documentary is (the viral clips exist to make people want to watch it)
                  const ctxDoc: any =
                    sourceMode === 'doc' ? documentaries.find((d) => d.id === selectedDocId) || null : null;
                  const ctxLines = [
                    ctxDoc?.publishTitle ? `YouTube title of the full documentary: "${ctxDoc.publishTitle}"` : '',
                    ctxDoc?.clip1Line2Hook ? `What the documentary reveals: "${ctxDoc.clip1Line2Hook}"` : '',
                    ctxDoc?.historicalTime ? `Era: ${ctxDoc.historicalTime}` : '',
                    ctxDoc?.historicalLocation ? `Place: ${ctxDoc.historicalLocation}` : '',
                    ctxDoc?.clip1Line1LocationTime ? `Setting: ${ctxDoc.clip1Line1LocationTime}` : '',
                  ].filter(Boolean);
                  const docContextBlock = ctxLines.length
                    ? ` DOCUMENTARY CONTEXT (the full video these clips promote): ${ctxLines.join('; ')}.`
                    : '';
                  const webPrompt = `Act as OpusClip Pro and an expert viral short-form video editor. From the following timestamped Spanish transcript of "${
                    (ctxDoc?.publishTitle as string) || sourceTitle
                  }",${docContextBlock} ${desiredClipCount > 0 ? `select the ${desiredClipCount} most viral standalone clips` : 'decide yourself how many standalone clips this transcript genuinely supports with strong viral potential (at most about one per 75 seconds of narration, so a longer documentary can give more, never fewer than 3, and never a weak one just to reach a number), and select them'}, each lasting between ${minDur}s and ${maxDur}s IN TOTAL. CLIP STRUCTURE: a clip is built from 1 to 4 pieces ("segments") of the transcript, ALWAYS in chronological order (never a flash-forward, hook teaser or any later moment placed before an earlier one). Use several pieces only when cutting out filler, a tangent or a slow passage makes the clip stronger: skip what is in between and keep the best lines. Every piece starts at the beginning of a phrase and ends at the end of a phrase (never in the middle of a sentence), is at least 4 seconds long, and the pieces together must read as one clear, self-contained story. The first piece opens with the strongest possible line, because the first 3 seconds decide whether people keep watching. If the moment already works as one continuous stretch, use a single piece. The clip length is the SUM of its pieces. CRITICAL OUTPUT LANGUAGE REQUIREMENT: Return ONLY a valid JSON object (no markdown commentary) where all audience-facing text fields ("title", "viralityReason", "hookBannerText", "socialCaption", "hashtags", "pinnedComment") are written in Neutral Spanish: {"clips":[{"title":"...","viralityScore":96,"viralityReason":"...","segments":[{"startSec":120.5,"endSec":138.2},{"startSec":146.0,"endSec":171.4}],"hookBannerText":"...","socialCaption":"...","hashtags":"#Uno #Dos #Tres #Cuatro #Cinco","pinnedComment":"..."}]}. EVERY clip has its OWN publication text, written for that clip only, for a COLD VIEWER who has never seen the channel or the documentary and scrolls past in 2 seconds: every text must say WHERE and WHEN (or WHO) it happens and why it matters, never vague abstractions like "El lujo mortal" or "La gran paradoja", never pronouns or references that only make sense inside the documentary ("él", "esto", "la fortaleza" without naming it). "hookBannerText" is the on-screen title shown during the first 8 seconds (UPPERCASE, max 55 characters): it names the concrete place/era or protagonist AND the intrigue, e.g. "PARÍS, AÑO 1200: EL LUJO QUE ENVENENABA A LOS REYES". "title" is a clear headline for that clip (max 70 characters), also with place/era or protagonist, used only as the clip name and NEVER repeated inside the description. "socialCaption" is 2 or 3 short sentences in this order: (1) the context in one line (where, when, who, e.g. "En el París del año 1200, dentro de la fortaleza del Louvre…"), (2) the specific fact or revelation this clip shows, (3) an open question or curiosity gap about what the full documentary explains, so the viewer wants to watch it; it must not start with or contain the title, and it must NOT include links or invitations like "mira el video completo" or "enlace en la bio" (a fixed closing paragraph with that invitation is added automatically). "hashtags" holds EXACTLY 5 hashtags specific to that clip (no generic repeats across all clips, never more than 5, never fewer), and EVERY hashtag is made of EXACTLY TWO Spanish words joined in CamelCase with no spaces or accents (e.g. #HistoriaMedieval #EdadMedia #DatosCuriosos), never a single-word hashtag like #Historia or #Reels. "pinnedComment" is the comment the channel pins under that clip: 1 or 2 short sentences starting with one emoji, with a concrete, easy question about the clip's topic that makes people want to answer (an opinion, a choice, or "¿sabías que…?"), and nothing else: it must NOT mention YouTube, the channel, the full documentary or any link (the page adds that where it belongs); no hashtags, different for every clip. TIMESTAMPED TRANSCRIPT: ${formattedTranscript}`;
                  // A documentary's order goes to ITS Gemini chat (same conversation as its stages, so Gemini
                  // knows the documentary); other sources (MP4, YouTube link) use a new chat. The answer comes back
                  // to this screen (VIRAL_CLIPS_GEMINI_STAGE), never into a stage.
                  const docChatUrl = String(ctxDoc?.geminiChatUrl || ctxDoc?.promptConfig?.GEMINI_CHAT_URL || '').trim();
                  const useDocChat = Boolean(ctxDoc && docChatUrl);
                  const geminiViralPayload = {
                    action: 'SEND_PROMPT',
                    prompt: webPrompt,
                    stageNumber: VIRAL_CLIPS_GEMINI_STAGE,
                    taskType: 'VIRAL_CLIPS',
                    // The answer comes back tagged with it and is stored under this documentary
                    docId: sourceMode === 'doc' ? selectedDocId : '',
                    videoName: useDocChat ? String(ctxDoc?.geminiChatTitle || ctxDoc?.title || '') : '',
                    deepResearchVideoName: '',
                    geminiChatUrl: useDocChat ? docChatUrl : '',
                    geminiDeepResearchChatUrl: '',
                    notebookName: useDocChat ? 'Huellas de la Humanidad' : '',
                    standaloneNewChat: !useDocChat,
                    noNotebook: !useDocChat,
                    enableHighModel: false,
                    enableArgonLow: true,
                    enableCarbonLow: true,
                    preferredModel: 'CARBON_4_LOW',
                    thinkingLevel: 'LOW',
                    enableDeepResearch: false,
                    enableCreateImage: false,
                    autoSubmit: true,
                    focusTab: false,
                  } as any;
                  geminiViralOrderRef.current = { payload: geminiViralPayload, attempts: 1 };
                  sendCommandToWebBridge('GEMINI', geminiViralPayload);
                  setIsWaitingGeminiClips(true);
                  setActionToast(
                    '🌐 Enviado a Gemini Web. Cuando responda, los clips aparecerán aquí solos.'
                  );
                }}
                className="flex-1 py-2.5 px-3 rounded-xl bg-emerald-950/80 hover:bg-emerald-900 border border-emerald-500/40 text-emerald-300 font-bold text-xs cursor-pointer flex items-center justify-center gap-1.5 shrink-0 disabled:opacity-50 transition"
                title="Enviar la transcripción a tu pestaña abierta de Gemini Web (100% Gratis vía Extensión)"
              >
                <Globe className={`w-3.5 h-3.5 ${isWaitingGeminiClips ? 'animate-spin' : ''}`} />
                <span>{isWaitingGeminiClips ? 'Esperando a Gemini…' : 'Gemini Web (Gratis)'}</span>
              </button>
            </div>

          </div>
        </div>

        {/* STEP 3: WORKSPACE — VIRAL CLIPS LIST + 9:16 INTERACTIVE PLAYER + INSTAGRAM PUBLISHER */}
        {viralClips.length > 0 && selectedClip ? (
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-4 items-start">
            {/* LEFT 3 COLS: Ranked Viral Clips List */}
            {/* On a phone the list shows about three clips and scrolls for the rest */}
            <div className="lg:col-span-3 bg-[#14110d] border border-amber-500/25 rounded-2xl p-3 space-y-2 max-h-[372px] lg:max-h-[760px] overflow-y-auto overscroll-contain">
              <div className="sticky -top-3 z-10 -mx-3 -mt-3 px-4 pt-3 pb-1 bg-[#14110d] flex items-center justify-between border-b border-slate-800">
                <span className="text-xs font-black text-amber-300 uppercase">
                  🏆 Clips Detectados ({viralClips.length})
                </span>
                {viralClipsOrigin(viralClips) === 'gemini' ? (
                  <span className="text-[10px] font-bold px-1.5 py-0.5 rounded bg-emerald-900/70 text-emerald-300">Gemini</span>
                ) : (
                  <span className="text-[10px] font-bold px-1.5 py-0.5 rounded bg-slate-800 text-slate-300">Análisis local</span>
                )}
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
                        {clip.published && (
                          <span className="ml-1.5 px-1.5 py-0.5 rounded bg-emerald-500/20 border border-emerald-500/50 text-[10px] font-bold text-emerald-300 whitespace-nowrap">
                            ✓ Publicado
                          </span>
                        )}
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
                      {(() => {
                        const cutCount = normalizeViralSegments(clip).length - 1;
                        return (
                          <span
                            className={`px-1.5 py-0.2 rounded font-sans font-bold ${
                              cutCount > 0
                                ? 'bg-sky-500/20 text-sky-300 border border-sky-500/40'
                                : 'bg-slate-800 text-slate-300'
                            }`}
                          >
                            {cutCount > 0 ? `✂ ${cutCount} ${cutCount === 1 ? 'corte' : 'cortes'}` : '▶ Continuo'}
                          </span>
                        );
                      })()}
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
              </div>

              {/* 9:16 Vertical Frame */}
              <div
                ref={previewFrameRef}
                className="relative w-full max-w-[310px] aspect-[9/16] rounded-2xl overflow-hidden bg-black border-2 border-amber-500/40 shadow-2xl"
              >
                {/* Official logo: same size and place as in the documentary's 9:16 Reel */}
                {officialLogoDataUrl && look916 && !useMasterSource && (
                  <img
                    src={officialLogoDataUrl}
                    alt=""
                    className="absolute z-20 pointer-events-none h-auto"
                    style={{
                      left: `${look916.logoXPct}%`,
                      top: `${look916.logoYPct}%`,
                      width: `${look916.logoWPct}%`,
                      opacity: look916.logoOpacity,
                    }}
                  />
                )}
                {sourceVideoUrl || useMasterSource ? (
                  <>
                    {previewProxyPct !== null && (
                      <div className="absolute top-2 inset-x-2 z-30 px-2 py-1 rounded-lg bg-black/75 text-[10px] font-bold text-amber-200 text-center pointer-events-none">
                        ⚡ Preparando vista previa ligera (720p) {previewProxyPct}% — puede ir lenta hasta entonces
                      </div>
                    )}
                    {selectedClip.reframeMode === 'fit_blur' && !useMasterSource && (
                      <video
                        src={viralMedia(playerVideoUrl)}
                        muted
                        playsInline
                        className="absolute inset-0 w-full h-full object-cover blur-xl brightness-50 scale-110 pointer-events-none"
                      />
                    )}
                    <video
                      ref={videoRef}
                      src={viralMedia(playerVideoUrl)}
                      onTimeUpdate={handleTimeUpdate}
                      onLoadedMetadata={() => {
                        // Keep the place (on the clip's own timeline) when the player switches source or preview
                        seekClipTime(captionSec);
                      }}
                      onPlay={() => setIsPlaying(true)}
                      onPause={() => setIsPlaying(false)}
                      playsInline
                      className={`absolute top-0 left-0 z-10 w-full ${
                        useMasterSource
                          ? 'h-full object-cover'
                          : selectedClip.reframeMode === 'fit_blur'
                          ? 'h-full object-contain'
                          : 'object-cover'
                      }`}
                      style={
                        useMasterSource
                          ? // The clean 9:16 master is already framed by the editor (and carries the logo)
                            { objectPosition: '50% 50%' }
                          : selectedClip.reframeMode === 'fit_blur'
                          ? {
                              objectPosition: '50% 50%',
                              // Same as the render: the documentary's own 16:9 subtitles (bottom 22% of the
                              // final video) are cut away, so they never show twice
                              clipPath: hasBurnedDocCaptions ? 'inset(0 0 41.1% 0)' : undefined,
                            }
                          : {
                              // Cover mode: the frame shows the top 78% of the picture when the final video
                              // carries burned-in 16:9 subtitles (exactly what the render keeps)
                              height: hasBurnedDocCaptions ? `${(100 / 0.78).toFixed(2)}%` : '100%',
                              objectPosition: `${selectedClip.focusX}% ${hasBurnedDocCaptions ? '0%' : '50%'}`,
                            }
                      }
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

                {/* Poster title (big for 8 s, then small to the end) and the YouTube notice, as in the render.
                    The render moves and shrinks each word on its own; here the two sizes simply cross-fade. */}
                {titleStyle === 'poster_gold' && posterTitle.timeline.big && (
                  <ViralPosterTitle
                    lines={posterTitle.lines}
                    frameW={posterTitle.frameW}
                    frameH={previewFrameH}
                    maxTextWFrac={VIRAL_TITLE_LOOK.bigTextWFrac}
                    maxFontHFrac={VIRAL_TITLE_LOOK.bigFontHFrac}
                    topPx={posterTitle.topPx}
                    visible={captionSec < posterTitle.timeline.big.endSec - 0.15}
                  />
                )}
                {titleStyle === 'poster_gold' && posterTitle.timeline.small && (
                  <ViralPosterTitle
                    lines={posterTitle.smallLines}
                    frameW={posterTitle.frameW}
                    frameH={previewFrameH}
                    maxTextWFrac={VIRAL_TITLE_LOOK.smallTextWFrac}
                    maxFontHFrac={VIRAL_TITLE_LOOK.bigFontHFrac * VIRAL_TITLE_LOOK.smallFontScale}
                    topPx={posterTitle.topPx}
                    visible={captionSec >= posterTitle.timeline.small.startSec}
                  />
                )}
                {posterTitle.timeline.notices.length > 0 && (
                  <ViralPosterTitle
                    lines={[...VIRAL_TITLE_LOOK.noticeLines]}
                    frameW={posterTitle.frameW}
                    frameH={previewFrameH}
                    maxTextWFrac={VIRAL_TITLE_LOOK.noticeTextWFrac}
                    maxFontHFrac={VIRAL_TITLE_LOOK.noticeFontHFrac}
                    topPx={posterTitle.noticeTopPx}
                    visible={posterTitle.timeline.notices.some(
                      (span) => captionSec >= span.startSec && captionSec < span.endSec + 0.05
                    )}
                  />
                )}

                {/* Yellow banner (first 8 seconds of the clip, same as the render) */}
                {titleStyle === 'yellow_box' &&
                  showHookBanner &&
                  selectedClip.hookBannerText &&
                  captionSec < 8 && (
                  <div
                    className="absolute inset-x-[13%] z-20 flex justify-center pointer-events-none"
                    // Same place as the render: under the logo (the box starts ~1.5% above the text)
                    style={{ top: `${Math.max(12, (look916?.hookBannerTopPct ?? 13.5) - 1.5)}%` }}
                  >
                    <div
                      className="px-3 py-1.5 rounded-xl bg-amber-400 text-slate-950 font-black text-[14px] leading-tight text-center uppercase tracking-wide shadow-lg border border-white/40"
                      style={{
                        fontFamily: "'Arial Black', Impact, 'Helvetica Neue', sans-serif",
                        // Extra-heavy title: a stroke in the text color thickens Arial Black (same as the render)
                        WebkitTextStroke: '0.9px #101010',
                        paintOrder: 'stroke fill',
                      }}
                    >
                      {selectedClip.hookBannerText}
                    </div>
                  </div>
                )}

                {/* Live Word-by-Word Karaoke Captions Overlay */}
                <div
                  className="absolute inset-x-3 z-20 flex justify-center pointer-events-none"
                  style={{ top: `${captionYPercent}%`, transform: 'translateY(-100%)' }}
                >
                  {activeCaptionChunk ? (
                    <div
                      className="px-3 py-1.5 text-center leading-tight flex flex-wrap items-center justify-center gap-x-1.5 gap-y-0.5"
                      style={{
                        fontSize: `${(
                          (look916 ? look916.captionEmOfHeight * previewFrameH : 17) * fontSizeScale
                        ).toFixed(1)}px`,
                        fontWeight: 900,
                        fontFamily: "'Arial Black', Impact, 'Helvetica Neue', sans-serif",
                      }}
                    >
                      {activeCaptionChunk.chunk.map((w, idx) => {
                        const isActive = idx === activeCaptionChunk.activeIdx;
                        const activeClasses =
                          selectedClip.captionStyle === 'yellow_white'
                            ? 'text-white scale-110'
                            : selectedClip.captionStyle === 'hormozi_green'
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
                              isActive
                                ? activeClasses
                                : selectedClip.captionStyle === 'yellow_white'
                                ? 'text-[#ffe600]'
                                : 'text-white'
                            }`}
                          >
                            {w.word}
                          </span>
                        );
                      })}
                    </div>
                  ) : null /* Pausa de la voz: sin caption, igual que el render (antes volvían a salir las primeras palabras) */}
                </div>

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
                    {formatMMSS(Math.max(0, captionSec))} /{' '}
                    {formatMMSS(clipCuts ? clipCuts.totalDurSec : selectedClip.endSec - selectedClip.startSec)}
                  </span>
                </div>
                {/* Time bar: move through the clip */}
                <input
                  type="range"
                  min={0}
                  max={clipCuts ? clipCuts.totalDurSec : 0}
                  step={0.1}
                  value={Math.max(0, Math.min(clipCuts ? clipCuts.totalDurSec : 0, captionSec))}
                  onChange={(e) => seekClipTime(Number(e.target.value))}
                  className="w-full accent-amber-400 cursor-pointer"
                  aria-label="Posición dentro del clip"
                />

                {/* Reframe & Caption Controls */}
                <div className="bg-slate-950 border border-slate-800 rounded-xl p-2.5 space-y-2 text-xs">
                  {sourceMode === 'doc' ? (
                    // A documentary's viral clips come from its clean 9:16 master: the framing is the editor's
                    <div className="text-[11px] text-slate-400">
                      <span className="font-bold text-slate-300">Encuadre 9:16:</span> el del Editor de Video (escena por
                      escena), tomado del master 9:16 limpio.
                    </div>
                  ) : (
                  <>
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
                  </>
                  )}

                  <div className="flex items-center justify-between gap-1 pt-1 border-t border-slate-800">
                    <span className="text-[11px] font-bold text-slate-400">Estilo Captions:</span>
                    <div className="flex items-center gap-1 flex-wrap">
                      {(
                        [
                          { id: 'yellow_white', label: '🟡 Amarillo' },
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
                        <option value={1}>1 palabra</option>
                        <option value={2}>2 palabras (máximo)</option>
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

            {/* RIGHT 5 COLS: Virality Score Breakdown + Social Copy + Render & Publish to Instagram (Reel) */}
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
                      Tramos del Documental (en orden)
                    </span>
                    <div className="flex flex-wrap gap-1">
                      {normalizeViralSegments(selectedClip).map((seg, i) => (
                        <span
                          key={i}
                          className="px-1.5 py-0.5 rounded bg-slate-900 border border-slate-700 font-mono text-[11px] text-amber-200"
                        >
                          {i > 0 ? '✂ ' : ''}
                          {formatMMSS(seg.startSec)}→{formatMMSS(seg.endSec)}
                        </span>
                      ))}
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
                    Título en pantalla
                  </label>
                  <select
                    value={titleStyle}
                    onChange={(e) => setTitleStyle(e.target.value === 'yellow_box' ? 'yellow_box' : 'poster_gold')}
                    className="bg-slate-950 border border-slate-700 rounded-lg px-2 py-1 text-[11px] font-semibold text-amber-100"
                    title="Estilo del título en pantalla"
                  >
                    <option value="poster_gold">Póster dorado (grande 8 s y luego se encoge)</option>
                    <option value="yellow_box">Cartel amarillo (solo primeros 8 s)</option>
                  </select>
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
                <label className="flex items-center gap-2 font-bold text-amber-300 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={showYoutubeNotice}
                    onChange={(e) => setShowYoutubeNotice(e.target.checked)}
                    className="accent-amber-400"
                  />
                  Aviso "VIDEO COMPLETO EN YOUTUBE" (5 s a la mitad y 5 s al final)
                </label>

                <div className="space-y-1">
                  {/* Network being posted to: it decides where the text says the link is */}
                  <div className="flex items-center justify-between gap-2 pb-1">
                    <span className="text-[11px] font-bold text-slate-300">🔗 Red donde lo publicas:</span>
                    <select
                      value={linkPlace}
                      onChange={(e) => setLinkPlace(e.target.value === 'comments' ? 'comments' : 'bio')}
                      className="bg-slate-950 border border-slate-700 rounded-lg px-2 py-1 text-[11px] font-semibold text-amber-100"
                      title="Cambia el texto final de la descripción y lo que se copia como comentario"
                    >
                      <option value="bio">TikTok / Instagram (enlace en la biografía)</option>
                      <option value="comments">Facebook (enlace en los comentarios)</option>
                    </select>
                  </div>
                  {linkPlace === 'comments' && (
                    <input
                      type="url"
                      value={docYoutubeUrl}
                      onChange={(e) => setDocYoutubeUrl(e.target.value)}
                      placeholder="Enlace del documental en YouTube (va en el comentario)"
                      className="w-full bg-slate-950 border border-slate-700 rounded-xl px-3 py-1.5 text-xs text-sky-300"
                    />
                  )}
                  <div className="flex items-center justify-between">
                    <span className="text-[11px] font-bold text-slate-300">
                      Descripción para Reels / Shorts / TikTok / Facebook:
                    </span>
                    <button
                      type="button"
                      onClick={() =>
                        copyText(
                          'caption',
                          // The title is not part of the description: only the description and its 5 hashtags
                          [String(selectedClip.socialCaption || '').trim(), VIRAL_DESCRIPTION_CTA[linkPlace], limitToFiveHashtags(selectedClip.hashtags)]
                            .filter(Boolean)
                            .join('\n\n')
                        )
                      }
                      className="text-[11px] text-amber-300 hover:text-amber-200 flex items-center gap-1 cursor-pointer"
                    >
                      {copiedField === 'caption' ? (
                        <Check className="w-3 h-3 text-emerald-400" />
                      ) : (
                        <Copy className="w-3 h-3" />
                      )}
                      <span>{copiedField === 'caption' ? '¡Copiado!' : 'Copiar descripción + hashtags'}</span>
                    </button>
                  </div>
                  <textarea
                    rows={3}
                    value={selectedClip.socialCaption}
                    onChange={(e) => updateSelectedClip({ socialCaption: e.target.value })}
                    className="w-full bg-slate-950 border border-slate-800 rounded-xl p-2.5 text-xs text-slate-200 outline-none"
                  />
                  <p className="text-[11px] text-slate-400 italic px-1">
                    + párrafo final fijo: {VIRAL_DESCRIPTION_CTA[linkPlace]}
                  </p>
                </div>

                <div className="space-y-1">
                  <span className="text-[11px] font-bold text-slate-300 block">
                    Hashtags (5): {limitToFiveHashtags(selectedClip.hashtags).split(' ').filter(Boolean).length}/5
                  </span>
                  <input
                    type="text"
                    value={selectedClip.hashtags}
                    onChange={(e) => updateSelectedClip({ hashtags: e.target.value })}
                    onBlur={(e) => updateSelectedClip({ hashtags: limitToFiveHashtags(e.target.value) })}
                    className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3 py-1.5 text-xs text-sky-300 font-mono"
                  />
                </div>

                {/* Comment to pin under the post (copied on its own) */}
                <div className="space-y-1">
                  <div className="flex items-center justify-between">
                    <span className="text-[11px] font-bold text-slate-300">📌 Comentario fijado:</span>
                    <button
                      type="button"
                      onClick={() =>
                        copyText(
                          'pinned',
                          buildViralPinnedComment(String(selectedClip.pinnedComment || ''), linkPlace, docYoutubeUrl)
                        )
                      }
                      disabled={!selectedClip.pinnedComment}
                      className="text-[11px] text-amber-300 hover:text-amber-200 flex items-center gap-1 cursor-pointer disabled:opacity-40"
                    >
                      {copiedField === 'pinned' ? <Check className="w-3 h-3 text-emerald-400" /> : <Copy className="w-3 h-3" />}
                      <span>{copiedField === 'pinned' ? '¡Copiado!' : 'Copiar comentario'}</span>
                    </button>
                  </div>
                  <textarea
                    rows={2}
                    value={selectedClip.pinnedComment || ''}
                    onChange={(e) => updateSelectedClip({ pinnedComment: e.target.value })}
                    placeholder="Pregunta para fijar como primer comentario"
                    className="w-full bg-slate-950 border border-slate-800 rounded-xl p-2.5 text-xs text-slate-200 outline-none"
                  />
                  <p className="text-[11px] text-slate-400 italic px-1">
                    {linkPlace === 'comments'
                      ? 'Al copiar: solo la pregunta + el enlace del documental en YouTube.'
                      : 'Al copiar: solo la pregunta, sin mencionar YouTube (ya va en el video y en la descripción).'}
                  </p>
                </div>

                {/* Posted or not: marked by hand after publishing the clip */}
                <div className="flex items-center justify-between gap-2 pt-1">
                  <span className="text-[11px] font-bold text-slate-300">📣 Estado de este clip:</span>
                  <div className="flex items-center gap-2">
                    {selectedClip.published && selectedClip.publishedAt && (
                      <span className="text-[10px] text-emerald-400 font-mono">
                        {new Date(selectedClip.publishedAt).toLocaleDateString('es', {
                          day: '2-digit',
                          month: '2-digit',
                          year: 'numeric',
                        })}
                      </span>
                    )}
                    <select
                      value={selectedClip.published ? 'published' : 'pending'}
                      onChange={(e) => {
                        const isPublished = e.target.value === 'published';
                        updateSelectedClip({
                          published: isPublished,
                          publishedAt: isPublished ? selectedClip.publishedAt || new Date().toISOString() : undefined,
                        });
                      }}
                      className={`rounded-lg px-2 py-1 text-[11px] font-bold border outline-none ${
                        selectedClip.published
                          ? 'bg-emerald-500/15 border-emerald-500/60 text-emerald-300'
                          : 'bg-slate-950 border-slate-700 text-slate-200'
                      }`}
                      title="Marca este clip como publicado"
                    >
                      <option value="pending">Sin publicar</option>
                      <option value="published">✓ Publicado</option>
                    </select>
                  </div>
                </div>
              </div>

              {/* EXPORT TO 07_VIRAL_CLIPS */}
              <div className="bg-gradient-to-br from-[#19130e] to-slate-950 border border-amber-500/40 rounded-2xl p-4 space-y-3 shadow-xl">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-black text-amber-300 uppercase">
                    3. Exportar MP4
                  </span>
                  {selectedClip.savedDocFolderPath && (
                    <span className="text-[10px] text-emerald-400 font-mono">
                      ✓ En 07_Viral_Clips
                    </span>
                  )}
                </div>

                {/* Local Render Buttons */}
                <div className="grid grid-cols-1 gap-2">
                  {(() => {
                    const clipNo = String(Math.max(1, viralClips.findIndex((c) => c.id === selectedClip.id) + 1)).padStart(2, '0');
                    const myJob = renderJobs.find(
                      (j) =>
                        j.clipId === selectedClip.id &&
                        (j.status === 'queued' || j.status === 'running' || j.status === 'waiting_master')
                    );
                    return (
                      <button
                        type="button"
                        disabled={Boolean(myJob)}
                        onClick={() => handleRenderViralClip(selectedClip)}
                        className="py-2.5 px-3 rounded-xl bg-teal-400 hover:bg-teal-300 text-slate-950 font-black text-xs cursor-pointer flex items-center justify-center gap-1.5 shadow disabled:opacity-50"
                      >
                        <Download className="w-3.5 h-3.5" />
                        <span>
                          {myJob
                            ? myJob.status === 'waiting_master'
                              ? `⏳ Clip ${clipNo} esperando el master 9:16...`
                              : myJob.status === 'queued'
                              ? `⏳ Clip ${clipNo} en cola...`
                              : `Guardando Clip ${clipNo}... ${myJob.progressPct}%`
                            : `💾 Guardar Clip ${clipNo}`}
                        </span>
                      </button>
                    );
                  })()}

                  {/* Export status: every clip sent to the Mac's queue for this documentary */}
                  {renderJobs.length > 0 && (
                    <div className="bg-slate-950/80 border border-slate-800 rounded-xl p-2 space-y-1.5">
                      <div className="text-[10px] font-black uppercase text-slate-400">Estado de las exportaciones</div>
                      {renderJobs.map((j) => (
                        <div key={j.jobId} className="text-[11px] space-y-0.5">
                          <div className="flex items-center justify-between gap-2">
                            <span className="font-bold text-slate-200 truncate">
                              Clip {String(j.clipNumber).padStart(2, '0')}
                              {j.title ? ` · ${j.title}` : ''}
                            </span>
                            <span
                              className={`shrink-0 font-bold ${
                                j.status === 'done'
                                  ? 'text-emerald-400'
                                  : j.status === 'error'
                                  ? 'text-rose-400'
                                  : j.status === 'running'
                                  ? 'text-amber-300'
                                  : 'text-slate-400'
                              }`}
                            >
                              {j.status === 'waiting_master'
                                ? `⏳ Esperando master 9:16${j.masterProgressPct ? ` (${j.masterProgressPct}%)` : ''}`
                                : j.status === 'queued'
                                ? '⏳ En cola'
                                : j.status === 'running'
                                ? `⚙️ ${j.progressPct}% · ${formatMMSS(j.elapsedSec)}`
                                : j.status === 'done'
                                ? `✅ Guardado · ${formatMMSS(j.elapsedSec)}`
                                : '⚠️ Error'}
                            </span>
                          </div>
                          {j.status === 'running' && (
                            <div className="h-1 rounded bg-slate-800 overflow-hidden">
                              <div className="h-full bg-amber-400 transition-all" style={{ width: `${j.progressPct}%` }} />
                            </div>
                          )}
                          {j.status === 'done' && j.fileName && (
                            <div className="text-[10px] text-slate-500 font-mono truncate" title={j.savedInDocFolderPath || j.fileName}>
                              {j.savedInDocFolderPath ? '07_Viral_Clips/' : ''}
                              {j.fileName}
                            </div>
                          )}
                          {j.status === 'error' && (
                            <div className="text-[10px] text-rose-300/80 truncate" title={j.error}>
                              {j.error.split('\n').filter(Boolean).slice(-1)[0] || 'Error al guardar el clip'}
                            </div>
                          )}
                        </div>
                      ))}
                    </div>
                  )}
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
                &quot;Gemini Web (Gratis)&quot;
              </strong>
              .
            </p>
          </div>
        )}
      </div>
    </div>
  );
};
