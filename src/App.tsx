import React, { useState, useEffect, useMemo } from 'react';
import {
  Film,
  Plus,
  Trash2,
  Copy,
  Check,
  Sparkles,
  Volume2,
  Clock,
  FileText,
  Image as ImageIcon,
  Music,
  Subtitles,
  Share2,
  ChevronRight,
  FolderOpen,
  Download,
  Upload,
  Key,
  Layers,
  CheckCircle2,
  Circle,
  Search,
  RefreshCw,
  Wand2,
  ArrowRight,
  BookOpen,
  Sliders,
  Globe,
} from 'lucide-react';
import PromptGenerator from './components/PromptGenerator';
import { WebStudioDrawer } from './components/WebStudioDrawer';
import {
  CapCutEditor,
  buildClipSixWordFileName,
  ExportResolutionPreset,
  EditorAspectRatio,
  RESOLUTION_PRESETS,
} from './components/CapCutEditor';
import {
  DocumentaryProject,
  AVAILABLE_VOICES,
  AVAILABLE_STYLES,
  AVAILABLE_SPEEDS,
  AVAILABLE_LANGUAGES,
  DEFAULT_OPERATIONAL_HEADER,
  ServerStatus,
  Sentence,
  DocumentaryClip,
  ReferenceAsset,
  SunoTrack,
  ProductionFormatType,
  DocumentaryStatusType,
  AudienceCommentReply,
} from './types';
import {
  generateTimelineText,
  generatePlainTranscript,
  generateSRT,
  triggerFileDownload,
} from './utils/exporters';
import {
  parseClipsFromRawText,
  buildClipsSkeletonFromTimeline,
  parseReferencesFromRawText,
  parseSunoTracksFromRawText,
  fixCapcutSrtWithVoiceover,
  normalizeQuantitiesToMil,
  syncAndAuditProductionClips,
  extractPausesInfo,
  stripPauseTags,
  parseTimelineTextToSentences,
  ensureOperationalHeaderInRawClips,
  buildRawClipsTextWithHeader,
} from './utils/smartParsers';
import {
  checkUrlHashSetup,
  getBrowserGeminiKey,
  getBrowserGitHubToken,
  saveBrowserCredentials,
  buildMobileSetupLink,
  loadLocalCachedDocumentaries,
  saveLocalCachedDocumentaries,
  getLocalDeletedDocIds,
  markLocalDeletedDocId,
  mergeDocumentariesLists,
  fetchRemoteDocumentariesFromGitHub,
  pushDocumentariesToGitHub,
  buildStagePromptText,
  generateStageClientSide,
  auditClipsClientSide,
  auditClipVideoClientSide,
  replyCommentsClientSide,
  synthesizeTtsClientSide,
  PUBLIC_GITHUB_PAGES_URL,
} from './utils/cloudSync';
import {
  ConnectedAiTab,
  isHuellasExtensionDetected,
  pingHuellasExtension,
  sendCommandToWebBridge,
} from './utils/webStudioBridge';

declare const __BUILD_TIMESTAMP__: string | undefined;
const LAST_UPDATED_TEXT =
  typeof __BUILD_TIMESTAMP__ !== 'undefined' ? __BUILD_TIMESTAMP__ : '11:45 AM - 10/31/2026';

function getVoiceoverAudioName(docTitle?: string): string {
  const raw = (docTitle || '').trim();
  const specific = raw.match(/(?:video|documental|reel|cap[ií]tulo|ep(?:isodio)?|#)\s*#?\s*(\d+)/i);
  if (specific && specific[1]) {
    return `Voz Narrativa Video ${specific[1]}`;
  }
  const anyNum = raw.match(/\b(\d+)\b/);
  if (anyNum && anyNum[1]) {
    return `Voz Narrativa Video ${anyNum[1]}`;
  }
  return 'Voz Narrativa Video';
}

function getDefaultThumbnailOrientation(
  doc?: DocumentaryProject | null
): 'HORIZONTAL_16X9' | 'VERTICAL_9X16' {
  if (
    doc?.thumbnailOrientation === 'VERTICAL_9X16' ||
    doc?.thumbnailOrientation === 'HORIZONTAL_16X9'
  ) {
    return doc.thumbnailOrientation;
  }
  return doc?.aspectRatio === '9:16' || doc?.productionFormat === 'REELS_9X16'
    ? 'VERTICAL_9X16'
    : 'HORIZONTAL_16X9';
}

function buildOrUpdateThumbnailPrompt(
  currentPrompt: string,
  orientation: 'HORIZONTAL_16X9' | 'VERTICAL_9X16',
  overlayText: string,
  doc?: DocumentaryProject | null
): string {
  const isVertical = orientation === 'VERTICAL_9X16';
  const cleanText = (overlayText || '').trim();
  const aspectPhrase = isVertical ? '9:16 vertical aspect ratio' : '16:9 horizontal aspect ratio';
  const positionOnlyPhrase = isVertical
    ? 'centered and middle-justified right in the middle center of the image'
    : 'positioned in the bottom-left area of the image';
  const textPositionClause = cleanText
    ? `bold high-contrast cinematic documentary typography text overlay ${positionOnlyPhrase} reading "${cleanText}"`
    : '';
  const rightLogoClause = isVertical
    ? 'a small discreet 5% scale logo in the top-right corner displaying "HD" in metallic gold'
    : 'a small discreet 5% scale logo in the top-right corner displaying "8K" in metallic gold';
  const leftLogoClause =
    'official page logo cleanly integrated in the top-left corner from provided reference image at 5% scale, strictly preserving and visibly rendering both the logo emblem and the exact text underneath it "Huellas de la Humanidad" without cropping, blurring, or omitting the sub-text';
  const closingClause =
    'cinematic documentary realism, safe framing composition, no modern objects, no CGI look, no music.';

  // Eliminar cualquier cláusula literal "[TEXTO EN PANTALLA]" que se haya colado antes
  let prompt = (currentPrompt || '')
    .replace(
      /,?\s*bold high-contrast cinematic documentary typography text overlay[^,.;]*reading\s*["“”']\[TEXTO EN PANTALLA\]["“”']/gi,
      ''
    )
    .trim();

  if (!prompt) {
    const subject = doc?.topic || doc?.title || 'a dramatic historical documentary scene';
    const era = [doc?.historicalEra, doc?.year, doc?.cityCountry].filter(Boolean).join(', ');
    const sceneContext = era ? `${subject} (${era})` : subject;
    const textPart = textPositionClause ? `${textPositionClause}, ` : '';
    return `Thumbnail: Create an image in ${aspectPhrase} depicting ${sceneContext}, dramatic historical period atmosphere, intense emotional expression and high-impact visual tension, ${textPart}${rightLogoClause}, ${leftLogoClause}, ${closingClause}`;
  }

  if (!/^Thumbnail:\s*Create an image/i.test(prompt)) {
    prompt = `Thumbnail: Create an image ${prompt.replace(/^Create an image\s*/i, '')}`;
  }

  // 1. Update aspect ratio (16:9 horizontal vs 9:16 vertical)
  if (/(?:16:9|9:16)\s*(?:horizontal|vertical)?\s*(?:aspect ratio|format)?/i.test(prompt)) {
    prompt = prompt.replace(
      /(?:16:9|9:16)\s*(?:horizontal|vertical)?\s*(?:aspect ratio|format)?/gi,
      aspectPhrase
    );
  } else {
    prompt = prompt.replace(
      /^Thumbnail:\s*Create an image\b/i,
      `Thumbnail: Create an image in ${aspectPhrase}`
    );
  }

  // 2. Update or insert text overlay ONLY if cleanText was explicitly typed in the field
  // If cleanText is empty, preserve whatever text is already inside the pasted prompt without adding "[TEXTO EN PANTALLA]"
  const textOverlayRegex =
    /bold high-contrast cinematic documentary typography text overlay[^,.;]*reading\s*["“”']([^"“”']*)["“”']/i;
  const genericTextOverlayRegex =
    /(?:bold\s+)?(?:high-contrast\s+)?(?:cinematic\s+)?(?:documentary\s+)?(?:typography\s+)?text(?:\s+overlay)?\s+(?:centered|positioned|placed|in the bottom-left|in the middle|in the center)[^,.;]*reading\s*["“”']([^"“”']*)["“”']/i;

  if (cleanText) {
    if (textOverlayRegex.test(prompt)) {
      prompt = prompt.replace(textOverlayRegex, textPositionClause);
    } else if (genericTextOverlayRegex.test(prompt)) {
      prompt = prompt.replace(genericTextOverlayRegex, textPositionClause);
    } else {
      const logoIdx = prompt.search(
        /a small discreet 5% scale logo|official page logo|cinematic documentary realism/i
      );
      if (logoIdx !== -1) {
        const before = prompt.slice(0, logoIdx).replace(/[,.\s]+$/, '');
        const after = prompt.slice(logoIdx);
        prompt = `${before}, ${textPositionClause}, ${after}`;
      } else {
        prompt = `${prompt.replace(/[,.\s]+$/, '')}, ${textPositionClause}.`;
      }
    }
  } else if (textOverlayRegex.test(prompt)) {
    // Si el campo está vacío pero había un bloque generado antes con texto real, solo ajusta su posición (16:9 vs 9:16) conservando su texto
    prompt = prompt.replace(
      textOverlayRegex,
      (_, existingText) =>
        `bold high-contrast cinematic documentary typography text overlay ${positionOnlyPhrase} reading "${existingText}"`
    );
  }

  // 3. Update or insert top-right 5% logo ("8K" for horizontal vs "HD" for vertical)
  const rightLogoRegex =
    /a small discreet 5% scale logo in the top[- ]right corner displaying\s*["“”']?(?:8K|HD)["“”']?\s*in metallic gold/i;
  if (rightLogoRegex.test(prompt)) {
    prompt = prompt.replace(rightLogoRegex, rightLogoClause);
  } else {
    const leftLogoIdx = prompt.search(/official page logo|cinematic documentary realism/i);
    if (leftLogoIdx !== -1) {
      const before = prompt.slice(0, leftLogoIdx).replace(/[,.\s]+$/, '');
      const after = prompt.slice(leftLogoIdx);
      prompt = `${before}, ${rightLogoClause}, ${after}`;
    } else {
      prompt = `${prompt.replace(/[,.\s]+$/, '')}, ${rightLogoClause}.`;
    }
  }

  // 4. Ensure official page logo top-left 5% is present
  if (!/official page logo cleanly integrated in the top-left corner/i.test(prompt)) {
    const closeIdx = prompt.search(/cinematic documentary realism/i);
    if (closeIdx !== -1) {
      const before = prompt.slice(0, closeIdx).replace(/[,.\s]+$/, '');
      const after = prompt.slice(closeIdx);
      prompt = `${before}, ${leftLogoClause}, ${after}`;
    } else {
      prompt = `${prompt.replace(/[,.\s]+$/, '')}, ${leftLogoClause}, ${closingClause}`;
    }
  }

  return prompt;
}

const STAGES_LIST = [
  { num: 1, title: '1. Prompt Maestro', subtitle: 'Configuración y plantilla', icon: Sliders },
  { num: 2, title: '2. Tema y Duración', subtitle: 'Tipología, época y tiempos', icon: BookOpen },
  { num: 3, title: '3. Investigación', subtitle: 'Estructura y Deep Research', icon: Search },
  { num: 4, title: '4. Guion + VoxFlow + Timeline', subtitle: 'Voz en off, TTS y timestamps', icon: Volume2 },
  { num: 5, title: '5. Miniatura Oficial', subtitle: 'Nano Banana 2.1 (8K / HD)', icon: ImageIcon },
  { num: 6, title: '6. Referencias (@)', subtitle: '@Personas y Lugares en Banana 2.1', icon: ImageIcon },
  { num: 7, title: '7. Texto Clip 1 (6s)', subtitle: 'Ciudad, País, Año y Gancho', icon: Film },
  { num: 8, title: '8. Producción', subtitle: 'Voz Raw, Timestamps, Clips y Timeline', icon: Layers },
  { num: 9, title: '9. Subtítulos .SRT', subtitle: 'Corrector automático para CapCut', icon: Subtitles },
  { num: 10, title: '10. Música (Suno)', subtitle: 'Prompts de 6 campos y pistas MP3', icon: Music },
  { num: 11, title: '11. Metadata y Subida', subtitle: 'Todo Corrido, Capítulos y Tags', icon: Share2 },
  { num: 12, title: '12. Comentarios Audiencia', subtitle: 'Capturas y respuestas certeras', icon: FileText },
];

const PRODUCTION_TYPES: { value: ProductionFormatType; label: string; badge: string }[] = [
  { value: 'DOCUMENTAL_16X9', label: 'Documental Horizontal (16:9)', badge: '16:9 YouTube' },
  { value: 'REEL_9X16', label: 'Reel / Short Historiográfico (9:16)', badge: '9:16 Vertical' },
  { value: 'INMERSIVO', label: 'Inmersivo Contemplativo (20s)', badge: 'Inmersivo' },
  { value: 'TIMELAPSE', label: 'Timelapse Constructivo Inverso', badge: 'Timelapse' },
  { value: 'NOTEBOOKLM', label: 'Video Automatizado (NotebookLM)', badge: 'Auto Reel' },
  { value: 'POST_3X4', label: 'Post con Imagen (3:4)', badge: 'Post 3:4' },
];

const STATUS_OPTIONS: { value: DocumentaryStatusType; label: string; color: string }[] = [
  { value: 'planificacion', label: 'En Planificación', color: 'bg-slate-700 text-slate-200' },
  { value: 'guion', label: 'En Guion e Investigación', color: 'bg-blue-900/70 text-blue-200 border-blue-700' },
  { value: 'locucion', label: 'En Locución y Timeline', color: 'bg-purple-900/70 text-purple-200 border-purple-700' },
  { value: 'clips', label: 'Generando Imágenes y Clips', color: 'bg-amber-900/70 text-amber-200 border-amber-700' },
  { value: 'edicion_capcut', label: 'En Edición CapCut / Suno', color: 'bg-indigo-900/70 text-indigo-200 border-indigo-700' },
  { value: 'publicado', label: 'Terminado / Publicado', color: 'bg-emerald-900/70 text-emerald-200 border-emerald-700' },
];

const TYPOLOGIES = [
  '1. Un suceso histórico',
  '2. Un lugar histórico',
  '3. Un personaje',
  '4. Un misterio sin resolver',
  '5. Un true crime',
  '6. Una conciencia o realidad colectiva',
  '7. Una manipulación psicológica',
  '8. Una curiosidad',
];

export default function App() {
  const [isAuthenticated, setIsAuthenticated] = useState<boolean>(() => {
    return localStorage.getItem('huellas_master_auth') === 'true';
  });
  const [passwordInput, setPasswordInput] = useState('');

  // Navigation: 'dashboard' | 'studio' | 'standalone_prompt' | 'capcut_editor'
  const [mainView, setMainView] = useState<
    'dashboard' | 'studio' | 'standalone_prompt' | 'capcut_editor'
  >(() => {
    const saved = localStorage.getItem('huellas_master_view');
    if (
      saved === 'studio' ||
      saved === 'standalone_prompt' ||
      saved === 'capcut_editor' ||
      saved === 'dashboard'
    )
      return saved;
    return 'dashboard';
  });
  const [documentaries, setDocumentaries] = useState<DocumentaryProject[]>([]);
  const [activeDocId, setActiveDocId] = useState<string | null>(() => {
    return localStorage.getItem('huellas_master_active_doc') || null;
  });
  const [activeStage, setActiveStage] = useState<number>(() => {
    const saved = parseInt(localStorage.getItem('huellas_master_active_stage') || '1', 10);
    return saved >= 1 && saved <= 12 ? saved : 1;
  });

  useEffect(() => {
    localStorage.setItem('huellas_master_view', mainView);
  }, [mainView]);

  useEffect(() => {
    if (activeDocId) {
      localStorage.setItem('huellas_master_active_doc', activeDocId);
    } else {
      localStorage.removeItem('huellas_master_active_doc');
    }
    setSrtStatsMsg('');
  }, [activeDocId]);

  useEffect(() => {
    localStorage.setItem('huellas_master_active_stage', String(activeStage));
  }, [activeStage]);
  const [searchQuery, setSearchQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState<string>('ALL');

  // Server & API status + Mobile/GitHub Cloud Sync
  const [serverStatus, setServerStatus] = useState<ServerStatus | null>(null);
  const [isCloudMode, setIsCloudMode] = useState<boolean>(false);
  const [cloudSyncing, setCloudSyncing] = useState<boolean>(false);
  const [cloudStatusMsg, setCloudStatusMsg] = useState<string>('');
  const [showKeyModal, setShowKeyModal] = useState(false);
  const [apiKeyInput, setApiKeyInput] = useState('');
  const [ghTokenInput, setGhTokenInput] = useState('');
  const [savingStatus, setSavingStatus] = useState<'saved' | 'saving' | 'idle'>('idle');
  const [copiedId, setCopiedId] = useState<string | null>(null);

  useEffect(() => {
    const provisioned = checkUrlHashSetup();
    if (provisioned) {
      setCloudStatusMsg('✅ Llaves de IA y GitHub configuradas automáticamente en este dispositivo.');
    }
  }, []);

  // Stage-specific transient states
  const [aiGenerating, setAiGenerating] = useState(false);
  const [thumbOptionsGenerating, setThumbOptionsGenerating] = useState(false);
  const [aiCustomInstruction, setAiCustomInstruction] = useState('');
  const [ttsGenerating, setTtsGenerating] = useState(false);
  const [ttsCustomSegmentText, setTtsCustomSegmentText] = useState('');
  const [ttsCustomLabel, setTtsCustomLabel] = useState('');
  const [timelineExtracting, setTimelineExtracting] = useState(false);
  const [clipBatchFilter, setClipBatchFilter] = useState<number>(0); // 0 = All, 1 = 1-10, 2 = 11-20...
  const [srtStatsMsg, setSrtStatsMsg] = useState<string>('');
  const [srtMaxChars, setSrtMaxChars] = useState<number>(32);
  const [srtLineMode, setSrtLineMode] = useState<'subdivide' | 'wrap' | 'original'>('subdivide');
  const [auditingClips, setAuditingClips] = useState(false);
  const [auditSummary, setAuditSummary] = useState<string>('');
  const [showOpHeaderInProd, setShowOpHeaderInProd] = useState<boolean>(false);

  // Web Studio (Embedded Gemini Web & Google Flow Free Quotas)
  const [showWebStudio, setShowWebStudio] = useState<boolean>(() => {
    return localStorage.getItem('huellas_show_web_studio') === 'true';
  });
  const [extensionInstalled, setExtensionInstalled] = useState<boolean>(() =>
    isHuellasExtensionDetected()
  );
  const [aiEngineMode, setAiEngineMode] = useState<'WEB_FREE' | 'API_KEY'>(() => {
    const saved = localStorage.getItem('huellas_ai_engine_mode');
    return saved === 'API_KEY' ? 'API_KEY' : 'WEB_FREE';
  });
  const [bridgeStatusMsg, setBridgeStatusMsg] = useState<string>('');
  const [bridgeStatusType, setBridgeStatusType] = useState<'IDLE' | 'WORKING' | 'SUCCESS' | 'ERROR'>('IDLE');
  const [geminiTabs, setGeminiTabs] = useState<ConnectedAiTab[]>([]);
  const [flowTabs, setFlowTabs] = useState<ConnectedAiTab[]>([]);
  const [selectedGeminiTabId, setSelectedGeminiTabId] = useState<number | undefined>(undefined);
  const [selectedFlowTabId, setSelectedFlowTabId] = useState<number | undefined>(undefined);
  const [lastMirroredGeminiText, setLastMirroredGeminiText] = useState<string>('');
  const [lastMirroredGeminiImages, setLastMirroredGeminiImages] = useState<string[]>([]);
  const [lastMirroredFlowVideos, setLastMirroredFlowVideos] = useState<string[]>([]);
  const [lastMirroredFlowImages, setLastMirroredFlowImages] = useState<string[]>([]);

  // Google Flow 100% Automatic Production + Visual Video Audit + Chosen Folder Auto-Download
  const flowDownloadDirHandleRef = React.useRef<any>(null);
  const [flowDownloadFolderName, setFlowDownloadFolderName] = useState<string>('');
  const [flowServerFolderPath, setFlowServerFolderPath] = useState<string>('');
  const [flowAutoPilotActive, setFlowAutoPilotActive] = useState<boolean>(false);
  const flowAutoPilotActiveRef = React.useRef<boolean>(false);
  const [flowAutoRetryEnabled, setFlowAutoRetryEnabled] = useState<boolean>(true);
  const flowAutoRetryEnabledRef = React.useRef<boolean>(true);
  const [flowAutoDownloadEnabled, setFlowAutoDownloadEnabled] = useState<boolean>(true);
  const flowAutoDownloadEnabledRef = React.useRef<boolean>(true);
  const [flowCurrentClipNum, setFlowCurrentClipNum] = useState<number | null>(null);
  const [flowStatusLog, setFlowStatusLog] = useState<string>('');
  const [flowDownloadResolution, setFlowDownloadResolution] =
    useState<ExportResolutionPreset>('4K_2160P');
  const [flowAspectRatio, setFlowAspectRatio] = useState<EditorAspectRatio>('16:9');
  const [capturedClipVideosMap, setCapturedClipVideosMap] = useState<Record<number, string>>({});
  const [capturedSunoAudioMap, setCapturedSunoAudioMap] = useState<Record<number, string>>({});
  const [capturedThumbnailsMap, setCapturedThumbnailsMap] = useState<Record<string, string>>({});
  const [flowCurrentBatchNum, setFlowCurrentBatchNum] = useState<number>(1);
  const flowCurrentBatchNumRef = React.useRef<number>(1);
  const [flowAutoChainBatches, setFlowAutoChainBatches] = useState<boolean>(true);
  const flowAutoChainBatchesRef = React.useRef<boolean>(true);
  const [isFullPreprodRunning, setIsFullPreprodRunning] = useState<boolean>(false);
  const [fullPreprodStepMsg, setFullPreprodStepMsg] = useState<string>('');
  const activeDocRef = React.useRef<DocumentaryProject | null>(null);

  useEffect(() => {
    flowCurrentBatchNumRef.current = flowCurrentBatchNum;
  }, [flowCurrentBatchNum]);

  useEffect(() => {
    flowAutoChainBatchesRef.current = flowAutoChainBatches;
  }, [flowAutoChainBatches]);

  useEffect(() => {
    flowAutoPilotActiveRef.current = flowAutoPilotActive;
  }, [flowAutoPilotActive]);

  useEffect(() => {
    flowAutoRetryEnabledRef.current = flowAutoRetryEnabled;
  }, [flowAutoRetryEnabled]);

  useEffect(() => {
    flowAutoDownloadEnabledRef.current = flowAutoDownloadEnabled;
  }, [flowAutoDownloadEnabled]);

  useEffect(() => {
    localStorage.setItem('huellas_show_web_studio', String(showWebStudio));
  }, [showWebStudio]);

  useEffect(() => {
    localStorage.setItem('huellas_ai_engine_mode', aiEngineMode);
  }, [aiEngineMode]);

  // Etapa 12: Respuestas a Comentarios de la Audiencia (Capturas / Texto)
  const [commentInputText, setCommentInputText] = useState<string>('');
  const [commentImageBase64, setCommentImageBase64] = useState<string>('');
  const [commentImageMime, setCommentImageMime] = useState<string>('image/png');
  const [commentCustomFocus, setCommentCustomFocus] = useState<string>('');
  const [commentReplying, setCommentReplying] = useState<boolean>(false);

  const activeDoc = useMemo(
    () => documentaries.find((d) => d.id === activeDocId) || null,
    [documentaries, activeDocId]
  );

  useEffect(() => {
    activeDocRef.current = activeDoc;
  }, [activeDoc]);

  const handleLogin = (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    if (passwordInput.trim() === 'admin123') {
      localStorage.setItem('huellas_master_auth', 'true');
      setIsAuthenticated(true);
    }
  };

  const cloudPushTimerRef = React.useRef<any>(null);
  const lastLocalEditAtRef = React.useRef<number>(0);

  const triggerDebouncedCloudPush = (nextDocs: DocumentaryProject[]) => {
    lastLocalEditAtRef.current = Date.now();
    saveLocalCachedDocumentaries(nextDocs);
    if (cloudPushTimerRef.current) clearTimeout(cloudPushTimerRef.current);
    cloudPushTimerRef.current = setTimeout(async () => {
      cloudPushTimerRef.current = null;
      const res = await pushDocumentariesToGitHub(nextDocs);
      if (res.synced) {
        setSavingStatus('saved');
      }
    }, 1200);
  };

  const silentRealtimeSync = async () => {
    // Do not overwrite while user is actively typing/saving within the last 3 seconds
    if (cloudPushTimerRef.current || Date.now() - lastLocalEditAtRef.current < 3000) {
      return;
    }
    try {
      if (!isCloudMode) {
        const res = await fetch('/api/cloud/sync', { method: 'POST' });
        if (res.ok && (res.headers.get('content-type') || '').includes('application/json')) {
          const data = await res.json();
          if (Array.isArray(data.documentaries) && data.documentaries.length > 0) {
            if (Date.now() - lastLocalEditAtRef.current >= 3000) {
              setDocumentaries(data.documentaries);
              saveLocalCachedDocumentaries(data.documentaries);
            }
          }
          return;
        }
      }
      const remoteDocs = await fetchRemoteDocumentariesFromGitHub();
      if (remoteDocs && remoteDocs.length > 0 && Date.now() - lastLocalEditAtRef.current >= 3000) {
        setDocumentaries((prev) => {
          const merged = mergeDocumentariesLists(prev, remoteDocs, getLocalDeletedDocIds());
          saveLocalCachedDocumentaries(merged);
          return merged;
        });
      }
    } catch {}
  };

  const fetchAllData = async () => {
    const cached = loadLocalCachedDocumentaries();
    if (cached.length > 0 && documentaries.length === 0) {
      setDocumentaries(cached);
    }

    try {
      const [docsRes, statusRes] = await Promise.all([
        fetch('/api/documentaries').catch(() => null),
        fetch('/api/status').catch(() => null),
      ]);

      const isLocalApiOk =
        statusRes &&
        statusRes.ok &&
        (statusRes.headers.get('content-type') || '').includes('application/json');

      if (isLocalApiOk && docsRes && docsRes.ok) {
        setIsCloudMode(false);
        const list: DocumentaryProject[] = await docsRes.json();
        const normalizedList = list.map((d) => {
          if (d.rawClipsText && d.rawClipsText.trim()) {
            return {
              ...d,
              rawClipsText: ensureOperationalHeaderInRawClips(d.rawClipsText, d.operationalHeader),
            };
          }
          return d;
        });
        setDocumentaries(normalizedList);
        saveLocalCachedDocumentaries(normalizedList);

        const st = await statusRes.json();
        setServerStatus(st);

        // Background pull/merge with GitHub so changes made on phone appear on laptop
        fetch('/api/cloud/sync', { method: 'POST' })
          .then((r) => (r.ok ? r.json() : null))
          .then((syncData) => {
            if (syncData && Array.isArray(syncData.documentaries) && syncData.documentaries.length > 0) {
              setDocumentaries(syncData.documentaries);
              saveLocalCachedDocumentaries(syncData.documentaries);
            }
          })
          .catch(() => {});
        return;
      }
    } catch {}

    // Cloud / Mobile GitHub Pages Mode
    setIsCloudMode(true);
    const bKey = getBrowserGeminiKey();
    setServerStatus({
      hasGeminiKey: !!bKey,
      maskedKey: bKey ? `${bKey.slice(0, 6)}••••••••••••••••${bKey.slice(-4)}` : undefined,
      gcsBucket: null,
      storageMode: 'local',
    });

    const remoteDocs = await fetchRemoteDocumentariesFromGitHub();
    if (remoteDocs && remoteDocs.length > 0) {
      const merged = mergeDocumentariesLists(
        loadLocalCachedDocumentaries(),
        remoteDocs,
        getLocalDeletedDocIds()
      );
      setDocumentaries(merged);
      saveLocalCachedDocumentaries(merged);
    }
  };

  useEffect(() => {
    if (!isAuthenticated) return;
    fetchAllData();

    const intervalId = setInterval(() => {
      silentRealtimeSync();
    }, 12000);

    const onFocusOrVisible = () => {
      if (document.visibilityState === 'visible') {
        silentRealtimeSync();
      }
    };
    window.addEventListener('focus', onFocusOrVisible);
    document.addEventListener('visibilitychange', onFocusOrVisible);

    return () => {
      clearInterval(intervalId);
      window.removeEventListener('focus', onFocusOrVisible);
      document.removeEventListener('visibilitychange', onFocusOrVisible);
    };
  }, [isAuthenticated, isCloudMode]);

  const copyText = (text: string, idLabel: string) => {
    if (!text) return;
    navigator.clipboard.writeText(text);
    setCopiedId(idLabel);
    setTimeout(() => setCopiedId(null), 1800);
  };

  // Update active documentary in state + persist to local backend OR GitHub Cloud
  const updateActiveDoc = async (patch: Partial<DocumentaryProject>) => {
    if (!activeDoc) return;
    lastLocalEditAtRef.current = Date.now();
    const updated: DocumentaryProject = {
      ...activeDoc,
      ...patch,
      updatedAt: new Date().toISOString(),
    };
    const nextList = documentaries.map((d) => (d.id === updated.id ? updated : d));
    setDocumentaries(nextList);
    saveLocalCachedDocumentaries(nextList);
    setSavingStatus('saving');

    if (isCloudMode) {
      triggerDebouncedCloudPush(nextList);
      setSavingStatus('saved');
      return;
    }

    try {
      const res = await fetch(`/api/documentaries/${updated.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(updated),
      });
      if (res.ok && (res.headers.get('content-type') || '').includes('application/json')) {
        setSavingStatus('saved');
      } else {
        triggerDebouncedCloudPush(nextList);
        setSavingStatus('saved');
      }
    } catch {
      triggerDebouncedCloudPush(nextList);
      setSavingStatus('saved');
    }
  };

  const buildNewDocumentaryObject = (): DocumentaryProject => {
    const now = new Date().toISOString();
    return {
      id: `doc-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      title: 'Nuevo Documental — Huellas de la Humanidad',
      subtitle: '',
      productionType: 'DOCUMENTAL_16X9',
      status: 'planificacion',
      createdAt: now,
      updatedAt: now,
      promptConfig: {
        TIPO_PRODUCCION: 'REELS',
        SUB_OPCION_POST: 'EXPECTATIVA_ESTRENO',
        SUB_OPCION_REELS: '16X9',
        SINCRONIZACION_CLIP_1: 'VOZ_EN_CLIP_2',
        TEXTO_PANTALLA_CLIP_1: 'CAPCUT_MANUAL',
        DURACION_CLIP_1: '6',
        DURACION_CLIPS: '10_SEGUNDOS',
        VOZ_NARRATIVA_EN_CLIPS: 'INCLUIR',
      },
      compiledMasterPrompt: '',
      topic: '',
      typology: 'Un suceso histórico',
      historicalTime: '',
      historicalLocation: '',
      targetDurationSeconds: 120,
      clipDurationMode: '10_SEGUNDOS',
      clip1SyncMode: 'VOZ_EN_CLIP_2',
      clip1DurationSeconds: 6,
      sectionsStructure: '',
      deepResearchPrompt: '',
      deepResearchResult: '',
      voiceoverScript: '',
      selectedVoice: 'Charon',
      selectedStyle: 'dramatic',
      selectedSpeed: 'medium',
      selectedLanguage: 'es-la',
      audioTracks: [],
      masterAudioUrl: '',
      timelineSentences: [],
      timelineFormattedText: '',
      timelineSettings: {
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
      rawReferencePrompts: '',
      references: [],
      clip1TextMode: 'CAPCUT_MANUAL',
      clip1Line1LocationTime: '',
      clip1Line2Hook: '',
      clip1OptionsRaw: '',
      operationalHeader: DEFAULT_OPERATIONAL_HEADER,
      rawClipsText: '',
      clips: [],
      capcutRawSrt: '',
      correctedSrt: '',
      srtFileName: 'captions_corregidos',
      confirmedFinalDuration: '02:00',
      rawSunoText: '',
      sunoTracks: [],
      thumbnailOrientation: 'HORIZONTAL_16X9',
      thumbnailTextOptions: [],
      thumbnailPrompt: '',
      thumbnailTextOverlay: '',
      thumbnailImageUrl: '',
      thumbnailReady: false,
      platform: 'YOUTUBE',
      rawMetadataText: '',
      rawYoutubeMetadata: '',
      rawFacebookMetadata: '',
      publishTitle: '',
      publishDescription: '',
      youtubeChapters: '',
      aiNote: '',
      slogan: 'Cada historia deja una huella. Aquí seguimos sus rastros.',
      hashtags: '',
      youtubeTags: '',
      pinnedComment: '',
    };
  };

  const handleCreateDocumentary = async () => {
    if (!isCloudMode) {
      try {
        const res = await fetch('/api/documentaries', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            title: 'Nuevo Documental — Huellas de la Humanidad',
            productionType: 'DOCUMENTAL_16X9',
            status: 'planificacion',
            operationalHeader: DEFAULT_OPERATIONAL_HEADER,
          }),
        });
        if (res.ok && (res.headers.get('content-type') || '').includes('application/json')) {
          const created = await res.json();
          const next = [created, ...documentaries];
          setDocumentaries(next);
          saveLocalCachedDocumentaries(next);
          setActiveDocId(created.id);
          setActiveStage(1);
          setMainView('studio');
          return;
        }
      } catch {}
    }

    const created = buildNewDocumentaryObject();
    const next = [created, ...documentaries];
    setDocumentaries(next);
    triggerDebouncedCloudPush(next);
    setActiveDocId(created.id);
    setActiveStage(1);
    setMainView('studio');
  };

  const handleDuplicateDocumentary = async (id: string, e: React.MouseEvent) => {
    e.stopPropagation();
    if (!isCloudMode) {
      try {
        const res = await fetch(`/api/documentaries/${id}/duplicate`, { method: 'POST' });
        if (res.ok && (res.headers.get('content-type') || '').includes('application/json')) {
          const copy = await res.json();
          const next = [copy, ...documentaries];
          setDocumentaries(next);
          saveLocalCachedDocumentaries(next);
          return;
        }
      } catch {}
    }

    const orig = documentaries.find((d) => d.id === id);
    if (!orig) return;
    const now = new Date().toISOString();
    const copy: DocumentaryProject = {
      ...JSON.parse(JSON.stringify(orig)),
      id: `doc-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      title: `${orig.title} (Copia)`,
      createdAt: now,
      updatedAt: now,
    };
    const next = [copy, ...documentaries];
    setDocumentaries(next);
    triggerDebouncedCloudPush(next);
  };

  const handleDeleteDocumentary = async (id: string, e: React.MouseEvent) => {
    e.stopPropagation();
    if (!window.confirm('¿Seguro que deseas eliminar este documental de la base de datos?')) return;
    markLocalDeletedDocId(id);
    const next = documentaries.filter((d) => d.id !== id);
    setDocumentaries(next);
    if (activeDocId === id) {
      setActiveDocId(null);
      setMainView('dashboard');
    }

    if (!isCloudMode) {
      try {
        await fetch(`/api/documentaries/${id}`, { method: 'DELETE' });
        saveLocalCachedDocumentaries(next);
        return;
      } catch {}
    }
    triggerDebouncedCloudPush(next);
  };

  const calculateProgress = (doc: DocumentaryProject): { completed: number; total: number; pct: number } => {
    const checks = [
      !!doc.compiledMasterPrompt,
      !!(doc.topic && doc.targetDurationSeconds > 0),
      !!(doc.sectionsStructure || doc.deepResearchResult),
      !!(doc.voiceoverScript && (doc.audioTracks?.length > 0 || doc.timelineSentences?.length > 0)),
      !!(doc.thumbnailPrompt || doc.thumbnailImageUrl),
      (doc.references?.length || 0) > 0 || !!doc.rawReferencePrompts,
      !!(doc.clip1Line1LocationTime || doc.clip1Line2Hook || doc.clip1OptionsRaw),
      (doc.clips?.length || 0) > 0,
      !!doc.correctedSrt,
      (doc.sunoTracks?.length || 0) > 0 || !!doc.rawSunoText,
      !!(doc.rawMetadataText || doc.publishDescription),
    ];
    const completed = checks.filter(Boolean).length;
    return { completed, total: 11, pct: Math.round((completed / 11) * 100) };
  };

  const isStageDone = (doc: DocumentaryProject, stageNum: number): boolean => {
    switch (stageNum) {
      case 1:
        return !!doc.compiledMasterPrompt;
      case 2:
        return !!(doc.topic && doc.targetDurationSeconds > 0);
      case 3:
        return !!(doc.sectionsStructure || doc.deepResearchResult);
      case 4:
        return !!(doc.voiceoverScript && (doc.audioTracks?.length > 0 || doc.timelineSentences?.length > 0));
      case 5:
        return !!(doc.thumbnailPrompt || doc.thumbnailImageUrl);
      case 6:
        return (doc.references?.length || 0) > 0 || !!doc.rawReferencePrompts;
      case 7:
        return !!(doc.clip1Line1LocationTime || doc.clip1Line2Hook || doc.clip1OptionsRaw);
      case 8:
        return (doc.clips?.length || 0) > 0;
      case 9:
        return !!doc.correctedSrt;
      case 10:
        return (doc.sunoTracks?.length || 0) > 0 || !!doc.rawSunoText;
      case 11:
        return !!(doc.rawMetadataText || doc.publishDescription);
      case 12:
        return (doc.commentReplies?.length || 0) > 0;
      default:
        return false;
    }
  };

  // Upload image/audio asset helper (with base64 DataURL fallback on mobile/cloud)
  const uploadAssetFile = async (file: File): Promise<string | null> => {
    if (!isCloudMode) {
      try {
        const fd = new FormData();
        fd.append('file', file);
        const res = await fetch('/api/assets/upload', { method: 'POST', body: fd });
        if (res.ok && (res.headers.get('content-type') || '').includes('application/json')) {
          const data = await res.json();
          if (data.url) return data.url;
        }
      } catch {}
    }
    return new Promise((resolve) => {
      const reader = new FileReader();
      reader.onload = () => resolve(typeof reader.result === 'string' ? reader.result : null);
      reader.onerror = () => resolve(null);
      reader.readAsDataURL(file);
    });
  };

  const applyGeneratedStageText = (
    stageNum: number,
    text: string,
    images: string[] = []
  ) => {
    if (!activeDoc) return;
    const orientationForThumb = getDefaultThumbnailOrientation(activeDoc);

    if (stageNum === 2 || stageNum === 3) {
      updateActiveDoc({ sectionsStructure: text });
    } else if (stageNum === 4) {
      const normalizedScript = normalizeQuantitiesToMil(text);
      const autoTl = buildSmartClientTimeline(normalizedScript, activeDoc);
      updateActiveDoc({
        voiceoverScript: normalizedScript,
        ...(autoTl.sentences.length > 0
          ? {
              timelineSentences: autoTl.sentences,
              timelineFormattedText: autoTl.formatted,
              correctedSrt: autoTl.srt,
            }
          : {}),
      });
    } else if (stageNum === 5) {
      const patch: Partial<DocumentaryProject> = {
        thumbnailOrientation: orientationForThumb,
      };
      if (text.trim()) {
        patch.thumbnailPrompt = buildOrUpdateThumbnailPrompt(
          text,
          orientationForThumb,
          activeDoc.thumbnailTextOverlay || '',
          activeDoc
        );
      }
      if (images.length > 0) {
        patch.thumbnailImageUrl = images[images.length - 1];
        patch.thumbnailReady = true;
      }
      updateActiveDoc(patch);
    } else if (stageNum === 101) {
      const options = text
        .split(/\r?\n/)
        .map((line: string) =>
          line
            .replace(/^\s*(?:opci[oó]n\s*\d+[:.)\-\s]*|\d+[:.)\-\s]+|[-•*]\s*)/i, '')
            .replace(/^["'«»“”]+|["'«»“”]+$/g, '')
            .trim()
            .toUpperCase()
        )
        .filter((line: string) => line.length > 0)
        .slice(0, 3);
      if (options.length > 0) {
        const chosenText = (activeDoc.thumbnailTextOverlay || '').trim() || options[0];
        updateActiveDoc({
          thumbnailTextOptions: options,
          thumbnailTextOverlay: chosenText,
        });
      }
    } else if (stageNum === 6) {
      const parsedRefs = parseReferencesFromRawText(text);
      updateActiveDoc({
        rawReferencePrompts: text,
        references: parsedRefs.length > 0 ? parsedRefs : activeDoc.references,
      });
    } else if (stageNum === 7) {
      updateActiveDoc({ clip1OptionsRaw: text });
    } else if (stageNum === 8) {
      const textWithHeader = ensureOperationalHeaderInRawClips(text, activeDoc.operationalHeader);
      const syncedClips = syncAndAuditProductionClips({
        rawVoiceoverWithPauses: activeDoc.voiceoverScript || '',
        timelineText: activeDoc.timelineFormattedText || '',
        rawClipsText: textWithHeader,
        existingClips: activeDoc.clips || [],
        clip1Duration: activeDoc.clip1DurationSeconds || 6,
        clip1SyncMode: activeDoc.clip1SyncMode || 'VOZ_EN_CLIP_2',
      });
      updateActiveDoc({
        rawClipsText: textWithHeader,
        clips: syncedClips.length > 0 ? syncedClips : activeDoc.clips,
      });
    } else if (stageNum === 9) {
      const cleanSrt = text
        .replace(/^```(?:srt|txt|plaintext)?\s*\n?/i, '')
        .replace(/\n?```\s*$/i, '')
        .trim();
      if (cleanSrt) {
        updateActiveDoc({ correctedSrt: cleanSrt });
      }
    } else if (stageNum === 10) {
      const parsedTracks = parseSunoTracksFromRawText(text);
      updateActiveDoc({
        rawSunoText: text,
        sunoTracks: parsedTracks.length > 0 ? parsedTracks : activeDoc.sunoTracks,
      });
    } else if (stageNum === 11 || stageNum === 111) {
      updateActiveDoc({ rawYoutubeMetadata: text, rawMetadataText: text });
    } else if (stageNum === 112) {
      updateActiveDoc({ rawFacebookMetadata: text });
    } else if (stageNum === 113) {
      updateActiveDoc({ pinnedComment: text.trim() });
    } else if (stageNum === 114) {
      updateActiveDoc({ youtubeTags: text.trim() });
    }
  };

  useEffect(() => {
    pingHuellasExtension();
  }, []);

  // 1. Choose Destination Folder on User's Computer from the Site (Before Auto-Download)
  const handlePickFlowDownloadFolder = async (): Promise<boolean> => {
    try {
      if (typeof (window as any).showDirectoryPicker === 'function') {
        const dirHandle = await (window as any).showDirectoryPicker({
          mode: 'readwrite',
        });
        if (dirHandle) {
          flowDownloadDirHandleRef.current = dirHandle;
          setFlowDownloadFolderName(dirHandle.name || 'Carpeta Seleccionada');
          setFlowServerFolderPath('');
          setFlowStatusLog(
            `📁 Carpeta de auto-descarga lista: "${dirHandle.name}". Todos los videos aprobados se guardarán aquí automáticamente.`
          );
          return true;
        }
      }
    } catch (err: any) {
      if (err?.name === 'AbortError') {
        return false;
      }
    }

    // Fallback to native macOS folder picker on local server if showDirectoryPicker is unavailable
    if (!isCloudMode) {
      try {
        const res = await fetch('/api/system/pick-folder', { method: 'POST' });
        if (res.ok) {
          const data = await res.json();
          if (data.folderPath) {
            flowDownloadDirHandleRef.current = null;
            setFlowServerFolderPath(data.folderPath);
            setFlowDownloadFolderName(data.folderPath);
            setFlowStatusLog(
              `📁 Carpeta de auto-descarga lista: "${data.folderPath}". Todos los videos aprobados se guardarán aquí automáticamente.`
            );
            return true;
          }
        }
      } catch {}
    }

    return false;
  };

  // Save any Blob or DataURL file into the User's Chosen Folder
  const handleSaveAnyFileToChosenFolder = async (
    fileName: string,
    blobOrDataUrl: Blob | string
  ): Promise<boolean> => {
    // A) Write directly via File System Access API (Chrome Directory Handle)
    if (flowDownloadDirHandleRef.current) {
      try {
        const fileHandle = await flowDownloadDirHandleRef.current.getFileHandle(fileName, {
          create: true,
        });
        const writable = await fileHandle.createWritable();
        if (typeof blobOrDataUrl === 'string') {
          const parts = blobOrDataUrl.split(',');
          const bstr = atob(parts[1] || '');
          const u8arr = new Uint8Array(bstr.length);
          for (let i = 0; i < bstr.length; i++) {
            u8arr[i] = bstr.charCodeAt(i);
          }
          await writable.write(u8arr);
        } else {
          await writable.write(blobOrDataUrl);
        }
        await writable.close();
        return true;
      } catch (e) {
        console.warn('Error writing via DirectoryHandle, falling back:', e);
      }
    }

    // B) Convert Blob to DataURL if needed for server/anchor fallback
    let dataUrl = '';
    if (typeof blobOrDataUrl === 'string') {
      dataUrl = blobOrDataUrl;
    } else {
      dataUrl = await new Promise<string>((resolve) => {
        const reader = new FileReader();
        reader.onload = () => resolve(typeof reader.result === 'string' ? reader.result : '');
        reader.onerror = () => resolve('');
        reader.readAsDataURL(blobOrDataUrl);
      });
    }

    if (flowServerFolderPath && !isCloudMode && dataUrl) {
      try {
        const res = await fetch('/api/flow/save-video-to-folder', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            folderPath: flowServerFolderPath,
            fileName,
            videoDataUrl: dataUrl,
          }),
        });
        if (res.ok) return true;
      } catch {}
    }

    if (dataUrl) {
      try {
        const a = document.createElement('a');
        a.href = dataUrl;
        a.download = fileName;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        return true;
      } catch {}
    }
    return false;
  };

  // 2. Save Approved Clip MP4 Directly into the User's Chosen Folder (Named 01_primeras_seis_palabras.mp4)
  const saveApprovedClipVideoToFolder = async (
    clipObj: DocumentaryClip,
    videoDataUrl?: string
  ): Promise<string> => {
    if (!videoDataUrl) return '';
    const fileName = buildClipSixWordFileName(clipObj, activeDocRef.current);
    const ok = await handleSaveAnyFileToChosenFolder(fileName, videoDataUrl);
    return ok ? fileName : '';
  };

  // 3. Send a Specific Clip to Google Flow with Automatic Video Watcher Enabled
  const sendClipToFlowWithAutoAudit = (
    clip: DocumentaryClip,
    customPrompt?: string,
    attemptNum: number = 1
  ) => {
    const promptToSend = (customPrompt || clip.videoPrompt || '').trim();
    if (!promptToSend) return;

    const currentDoc = activeDocRef.current;
    if (currentDoc) {
      const nextClips = (currentDoc.clips || []).map((c) =>
        c.id === clip.id
          ? {
              ...c,
              videoPrompt: promptToSend,
              videoAuditStatus: 'generating' as const,
              videoAttempts: attemptNum,
              videoAuditReason:
                attemptNum > 1
                  ? `🔄 Re-intentando automáticamente en Google Flow (Intento #${attemptNum})...`
                  : '🎬 Generando video en Google Flow y esperando para auditar...',
            }
          : c
      );
      updateActiveDoc({ clips: nextClips });
    }

    setFlowCurrentClipNum(clip.clipNumber);
    const padded = String(clip.clipNumber).padStart(2, '0');
    const statusText =
      attemptNum > 1
        ? `🔄 Clip #${padded} (Re-intento #${attemptNum}): Enviando prompt corregido a Google Flow...`
        : `🎬 Clip #${padded}: Enviado a Google Flow. Vigilando generación en tiempo real...`;
    setFlowStatusLog(statusText);
    setBridgeStatusType('WORKING');
    setBridgeStatusMsg(statusText);

    sendCommandToWebBridge('FLOW', {
      action: 'SEND_PROMPT',
      prompt: promptToSend,
      clipNumber: clip.clipNumber,
      clipId: clip.id,
      attempt: attemptNum,
      watchForVideo: true,
      mediaType: 'VIDEO',
      autoSubmit: true,
      focusTab: false,
      tabId: selectedFlowTabId,
    });
  };

  // 4. Multimodal AI Visual Audit when Google Flow Finishes Generating a Video
  const handleCapturedFlowVideoAudit = async (msg: any) => {
    const currentDoc = activeDocRef.current;
    if (!currentDoc || !Array.isArray(currentDoc.clips)) return;

    const clipNum = Number(msg.clipNumber) || 1;
    const targetClip =
      currentDoc.clips.find((c) => msg.clipId && c.id === msg.clipId) ||
      currentDoc.clips.find((c) => c.clipNumber === clipNum);

    if (!targetClip) return;

    const padded = String(targetClip.clipNumber).padStart(2, '0');
    const frames: string[] = Array.isArray(msg.frames) ? msg.frames : [];
    const videoDataUrl: string = msg.videoDataUrl || '';
    const attempt: number = Number(msg.attempt) || 1;
    const fromScan: boolean = Boolean(msg.fromScan);

    if (videoDataUrl) {
      setCapturedClipVideosMap((prev) => ({
        ...prev,
        [targetClip.clipNumber]: videoDataUrl,
      }));
    }

    // Immediately show the 3 extracted frames and "Auditing..." state on the clip card
    const auditingClipsList = currentDoc.clips.map((c) =>
      c.id === targetClip.id
        ? {
            ...c,
            videoAuditStatus: 'auditing' as const,
            videoFrames: frames.length > 0 ? frames : c.videoFrames,
            videoAuditReason: `🔍 Auditando los ${frames.length} fotogramas del video contra el Prompt y la Voz Narrativa...`,
          }
        : c
    );
    updateActiveDoc({ clips: auditingClipsList });
    setFlowStatusLog(
      `🔍 Clip #${padded}: Video capturado de Google Flow. Analizando si coincide con su Prompt y Voz Narrativa...`
    );

    try {
      let auditData: any = null;
      if (!isCloudMode) {
        try {
          const res = await fetch('/api/ai/audit-clip-video', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              documentary: currentDoc,
              clip: targetClip,
              frames,
              attempt,
            }),
          });
          if (res.ok && (res.headers.get('content-type') || '').includes('application/json')) {
            auditData = await res.json();
          } else {
            auditData = await auditClipVideoClientSide(currentDoc, targetClip, frames, attempt);
          }
        } catch {
          auditData = await auditClipVideoClientSide(currentDoc, targetClip, frames, attempt);
        }
      } else {
        auditData = await auditClipVideoClientSide(currentDoc, targetClip, frames, attempt);
      }

      const verdict: 'approved' | 'warning' | 'rejected' =
        auditData?.verdict === 'rejected'
          ? 'rejected'
          : auditData?.verdict === 'warning'
          ? 'warning'
          : 'approved';
      const score = Number(auditData?.score) || (verdict === 'approved' ? 90 : 50);
      const reason =
        auditData?.auditReason ||
        (verdict === 'approved'
          ? 'El video coincide con el prompt y la voz narrativa.'
          : 'El video presenta discrepancias con el prompt o la voz narrativa.');
      const issues: string[] = Array.isArray(auditData?.issues) ? auditData.issues : [];
      const fixedPrompt: string = (auditData?.fixedVideoPrompt || '').trim();

      // CASE A: REJECTED -> Auto-Retry with Fixed Prompt if enabled and attempts < 2
      if (verdict === 'rejected' && !fromScan && flowAutoRetryEnabledRef.current && attempt < 2 && fixedPrompt) {
        setFlowStatusLog(
          `🚨 Clip #${padded} rechazado (${score}/100: ${reason}). Corrigiendo prompt y re-enviando automáticamente a Google Flow (Intento #${
            attempt + 1
          })...`
        );
        sendClipToFlowWithAutoAudit(targetClip, fixedPrompt, attempt + 1);
        return;
      }

      // CASE B: APPROVED or WARNING -> Auto-Download to Chosen Folder with 6-Word Filename
      let savedFileName = targetClip.videoSavedFileName || '';
      if (verdict !== 'rejected' && flowAutoDownloadEnabledRef.current && videoDataUrl) {
        savedFileName = await saveApprovedClipVideoToFolder(targetClip, videoDataUrl);
      }

      const latestDoc = activeDocRef.current || currentDoc;
      const finalClips = (latestDoc.clips || []).map((c) =>
        c.id === targetClip.id
          ? {
              ...c,
              videoReady: verdict !== 'rejected',
              videoAuditStatus: verdict,
              videoAuditScore: score,
              videoAuditReason: reason,
              videoAuditIssues: issues,
              videoFrames: frames.length > 0 ? frames : c.videoFrames,
              videoAttempts: attempt,
              videoSavedFileName: savedFileName || c.videoSavedFileName,
              ...(verdict === 'rejected' && fixedPrompt
                ? { suggestedVideoPrompt: fixedPrompt }
                : {}),
            }
          : c
      );

      updateActiveDoc({ clips: finalClips });

      if (verdict !== 'rejected') {
        setBridgeStatusType('SUCCESS');
        const msgDone = `✅ Clip #${padded} APROBADO (${score}/100)${
          savedFileName ? ` y guardado automáticamente como ${savedFileName}` : ''
        }.`;
        setFlowStatusLog(msgDone);
        setBridgeStatusMsg(msgDone);
      } else {
        setBridgeStatusType('ERROR');
        const msgFail = `🚨 Clip #${padded} NO APROBÓ (${score}/100): ${reason}`;
        setFlowStatusLog(msgFail);
        setBridgeStatusMsg(msgFail);
      }

      // A) If Sequential Autopilot Queue is running, automatically advance to the next pending clip!
      if (flowAutoPilotActiveRef.current && !fromScan) {
        const nextPendingClip = finalClips.find(
          (c) => c.clipNumber > targetClip.clipNumber && !c.videoReady && (c.videoPrompt || '').trim()
        );
        if (nextPendingClip) {
          setTimeout(() => {
            if (!flowAutoPilotActiveRef.current) return;
            sendClipToFlowWithAutoAudit(nextPendingClip, undefined, 1);
          }, 2200);
        } else {
          setFlowAutoPilotActive(false);
          setFlowCurrentClipNum(null);
          setFlowStatusLog(
            '🎉 ¡Piloto Automático completado! Todos los clips fueron producidos, auditados y descargados en tu carpeta.'
          );
          handleExportOrganizedProjectFolder(true);
        }
      } else if (flowAutoChainBatchesRef.current && !fromScan) {
        // B) ITEM 1: Auto-Chain Batches of 10 (Lote 1 -> Lote 2 -> Lote 3... -> Final)
        const currentBatchNum = flowCurrentBatchNumRef.current || Math.ceil(targetClip.clipNumber / 10);
        const batchStartIdx = (currentBatchNum - 1) * 10;
        const currentBatchClips = finalClips.slice(batchStartIdx, batchStartIdx + 10);
        const allCurrentBatchFinished =
          currentBatchClips.length > 0 &&
          currentBatchClips.every(
            (c) => c.videoReady || (c.videoAttempts && c.videoAttempts >= 2)
          );

        if (allCurrentBatchFinished) {
          const totalBatches = Math.ceil(finalClips.length / 10);
          if (currentBatchNum < totalBatches) {
            const nextBatch = currentBatchNum + 1;
            setFlowStatusLog(
              `✅ Lote #${currentBatchNum} completado (${currentBatchClips.length}/${currentBatchClips.length}). Lanzando automáticamente Lote #${nextBatch} en 3 segundos...`
            );
            setTimeout(() => {
              handleSendBatch10ToFlow(nextBatch);
            }, 3000);
          } else {
            setFlowCurrentClipNum(null);
            setFlowStatusLog(
              `🎉 ¡Todos los ${totalBatches} Lotes (${finalClips.length} clips) fueron generados, auditados y descargados! Paquete final actualizado en tu carpeta.`
            );
            handleExportOrganizedProjectFolder(true);
          }
        }
      } else {
        setFlowCurrentClipNum(null);
      }
    } catch (err: any) {
      setFlowStatusLog(`⚠️ Error auditando el video del Clip #${padded}: ${err?.message || err}`);
      setFlowCurrentClipNum(null);
    }
  };

  // 5. Start 100% Automatic Queue (Prompt -> Flow -> Watch -> Audit -> Auto-Retry/Download -> Next Clip)
  const handleStartFlowAutoPilot = async () => {
    if (!activeDoc || !activeDoc.clips || activeDoc.clips.length === 0) {
      alert('Primero genera o sincroniza los clips en la Etapa 8.');
      return;
    }

    // Ensure user chooses the download destination folder FIRST from the site if Auto-Download is enabled
    if (
      flowAutoDownloadEnabled &&
      !flowDownloadDirHandleRef.current &&
      !flowServerFolderPath
    ) {
      const picked = await handlePickFlowDownloadFolder();
      if (!picked) {
        alert(
          '📂 Por favor elige primero la carpeta donde deseas que se descarguen automáticamente los videos aprobados.'
        );
        return;
      }
    }

    const firstPending = activeDoc.clips.find(
      (c) => !c.videoReady && (c.videoPrompt || '').trim().length > 0
    );
    if (!firstPending) {
      alert(
        '✅ Todos los clips ya están marcados como Video Listo. Desmarca la casilla "Video Listo" en los clips que quieras volver a producir.'
      );
      return;
    }

    setFlowAutoPilotActive(true);
    flowAutoPilotActiveRef.current = true;
    sendClipToFlowWithAutoAudit(firstPending, undefined, 1);
  };

  // Send a Full Batch of 10 Pairs (9-Line Operational Header + Image X & Clip X Pairs) to Google Flow
  const handleSendBatch10ToFlow = async (batchNum: number = 1) => {
    const doc = activeDocRef.current || activeDoc;
    if (!doc || !doc.clips || doc.clips.length === 0) {
      alert('Primero genera o sincroniza los clips en la Etapa 8.');
      return;
    }

    // Support both 0-indexed and 1-indexed calls gracefully
    const normalizedBatchNum = batchNum <= 0 ? 1 : batchNum;

    if (
      flowAutoDownloadEnabled &&
      !flowDownloadDirHandleRef.current &&
      !flowServerFolderPath
    ) {
      const picked = await handlePickFlowDownloadFolder();
      if (!picked) {
        alert(
          '📂 Por favor elige primero la carpeta donde deseas que se descarguen automáticamente los videos aprobados.'
        );
        return;
      }
    }

    const startIdx = (normalizedBatchNum - 1) * 10;
    const batchClips = doc.clips.slice(startIdx, startIdx + 10);
    if (batchClips.length === 0) {
      alert('No hay clips en ese lote.');
      return;
    }

    const opHeader = (doc.operationalHeader || DEFAULT_OPERATIONAL_HEADER).trim();
    const pairsBlock = batchClips
      .map((c) => {
        const imgLine = (c.imagePrompt || '').trim();
        const vidLine = (c.videoPrompt || '').trim();
        return [imgLine, vidLine].filter(Boolean).join('\n\n');
      })
      .join('\n\n');

    const fullBatchPrompt = `${opHeader}\n\n${pairsBlock}`;
    navigator.clipboard.writeText(fullBatchPrompt).catch(() => {});

    setFlowCurrentBatchNum(normalizedBatchNum);
    flowCurrentBatchNumRef.current = normalizedBatchNum;
    setFlowCurrentClipNum(batchClips[0].clipNumber);
    const rangeLabel = `${String(batchClips[0].clipNumber).padStart(2, '0')}-${String(
      batchClips[batchClips.length - 1].clipNumber
    ).padStart(2, '0')}`;

    setFlowStatusLog(
      `📦 Lote #${normalizedBatchNum} (Clips ${rangeLabel}) enviado a Google Flow con Orden Operativa de 9 líneas + ${batchClips.length} pares Image/Clip. Vigilando los ${batchClips.length} videos...`
    );

    sendCommandToWebBridge('FLOW', {
      action: 'SEND_PROMPT',
      prompt: fullBatchPrompt,
      clipNumber: batchClips[0].clipNumber,
      clipId: batchClips[0].id,
      batchStartClip: batchClips[0].clipNumber,
      batchEndClip: batchClips[batchClips.length - 1].clipNumber,
      expectedCount: batchClips.length,
      attempt: 1,
      watchForVideo: true,
      mediaType: 'VIDEO',
      autoSubmit: true,
      focusTab: true,
      tabId: selectedFlowTabId,
    });
  };

  // Send Stage 6 @References Block to Google Flow
  const handleSendReferencesBlockToFlow = () => {
    if (!activeDoc) return;
    const rawRefs = (activeDoc.rawReferencePrompts || '').trim();
    const builtFromList = (activeDoc.references || [])
      .map((r) => `${r.tag}: ${r.prompt}`)
      .join('\n\n');
    const body = rawRefs || builtFromList;
    if (!body) {
      alert('Primero genera o escribe las @Referencias en la Etapa 6.');
      return;
    }
    const header =
      'Cambia los nombres y ponles @ seguido del nombre de la persona o lugar correspondiente.';
    const fullText = body.includes('Cambia los nombres') ? body : `${header}\n\n${body}`;
    navigator.clipboard.writeText(fullText).catch(() => {});
    setFlowStatusLog('🚀 Enviando bloque de @Referencias (@Personas y Lugares) a Google Flow...');
    sendCommandToWebBridge('FLOW', {
      action: 'SEND_PROMPT',
      prompt: fullText,
      mediaType: 'IMAGE',
      autoSubmit: true,
      focusTab: true,
      tabId: selectedFlowTabId,
    });
  };

  // ITEM 5: Send Stage 5 Thumbnails A/B to Google Flow & Auto-Download Miniatura_Opcion_A.png & B.png
  const handleSendThumbnailsToFlowAndCapture = async (optionLabel: 'A' | 'B' = 'A') => {
    if (!activeDoc) return;
    const promptText = (activeDoc.thumbnailPrompt || '').trim();
    if (!promptText) {
      alert('Primero genera el prompt de Miniatura en la Etapa 5.');
      return;
    }
    if (
      flowAutoDownloadEnabled &&
      !flowDownloadDirHandleRef.current &&
      !flowServerFolderPath
    ) {
      await handlePickFlowDownloadFolder();
    }
    navigator.clipboard.writeText(promptText).catch(() => {});
    setBridgeStatusType('WORKING');
    setBridgeStatusMsg(
      `🖼️ Enviando Miniatura Opción ${optionLabel} a Google Flow (Nano Banana 2.1) y vigilando para auto-descargar Miniatura_Opcion_${optionLabel}.png...`
    );
    sendCommandToWebBridge('FLOW', {
      action: 'SEND_PROMPT',
      prompt: promptText,
      mediaType: 'THUMBNAILS',
      optionLabel,
      autoSubmit: true,
      focusTab: true,
      tabId: selectedFlowTabId,
    });
  };

  // ITEM 2: Send Stage 7 Suno Track to Suno.com & Auto-Download MP3 into /Audio & CapCut Track 5
  const handleSendSunoTrackAndCapture = async (trackNumber: number, promptText: string, title?: string) => {
    if (!promptText.trim()) return;
    if (
      flowAutoDownloadEnabled &&
      !flowDownloadDirHandleRef.current &&
      !flowServerFolderPath
    ) {
      await handlePickFlowDownloadFolder();
    }
    navigator.clipboard.writeText(promptText).catch(() => {});
    setBridgeStatusType('WORKING');
    setBridgeStatusMsg(
      `🎵 Enviando Pista #${trackNumber} (${title || 'Instrumental'}) a Suno.com y vigilando para auto-descargar Suno_0${trackNumber}.mp3 e inyectarla en la Pista 5 del Editor CapCut...`
    );
    sendCommandToWebBridge('SUNO', {
      action: 'SEND_PROMPT',
      prompt: promptText,
      trackNumber,
      trackTitle: title || `Suno_${String(trackNumber).padStart(2, '0')}`,
      autoSubmit: true,
      focusTab: true,
    });
  };

  // ITEM 6: Export Organized Final Project Folder (/Clips_Aprobados, /Audio, /Miniaturas, Subtitulos.srt, SEO_YouTube_Copiar_Pegar.txt)
  const handleExportOrganizedProjectFolder = async (silent: boolean = false) => {
    const doc = activeDocRef.current || activeDoc;
    if (!doc) return;

    if (!silent && !flowServerFolderPath && !flowDownloadDirHandleRef.current) {
      await handlePickFlowDownloadFolder();
    }

    try {
      const srtText =
        doc.correctedSrt ||
        (doc.timelineSentences && doc.timelineSentences.length > 0
          ? generateSRT(doc.timelineSentences)
          : '');

      if (!isCloudMode) {
        const sunoTracksPayload = Object.entries(capturedSunoAudioMap).map(([num, dataUrl]) => ({
          fileName: `Suno_${String(num).padStart(2, '0')}.mp3`,
          audioDataUrl: dataUrl,
        }));
        const thumbsPayload = Object.entries(capturedThumbnailsMap).map(([opt, dataUrl]) => ({
          option: opt,
          fileName: `Miniatura_Opcion_${opt}.png`,
          imageDataUrl: dataUrl,
        }));

        const resp = await fetch('/api/project/export-organized-package', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            folderPath: flowServerFolderPath,
            docTitle: doc.title,
            seoText: doc.rawYoutubeMetadata || doc.rawMetadataText || '',
            scriptText: doc.voiceoverScript || '',
            srtText,
            rawClipsText: doc.rawClipsText || '',
            pinnedCommentText: doc.pinnedComment || '',
            thumbnailPromptsText: doc.thumbnailPrompt || '',
            voiceoverDataUrl:
              doc.masterAudioUrl && doc.masterAudioUrl.startsWith('data:')
                ? doc.masterAudioUrl
                : '',
            sunoTracks: sunoTracksPayload,
            thumbnails: thumbsPayload,
          }),
        });
        const data = await resp.json();
        if (resp.ok && data.ok) {
          const msg = `📦 Paquete Final YouTube listo en "${data.folderPath}" (${
            (data.savedFiles || []).length
          } archivos organizados: /Clips_Aprobados, /Audio, /Miniaturas, Subtitulos.srt y SEO_YouTube_Copiar_Pegar.txt).`;
          setFlowStatusLog(msg);
          setBridgeStatusMsg(msg);
          if (!silent) {
            alert(msg);
          }
          return;
        }
      }

      // Fallback via File System Access API if in browser-only mode
      if (srtText) {
        await handleSaveAnyFileToChosenFolder('Subtitulos.srt', new Blob([srtText], { type: 'text/plain' }));
      }
      const seoBlob = new Blob(
        [
          `PROYECTO: ${doc.title}\n\n--- SEO YOUTUBE ---\n${
            doc.rawYoutubeMetadata || doc.rawMetadataText || ''
          }\n\n--- COMENTARIO FIJADO ---\n${doc.pinnedComment || ''}\n`,
        ],
        { type: 'text/plain' }
      );
      await handleSaveAnyFileToChosenFolder('SEO_YouTube_Copiar_Pegar.txt', seoBlob);
      if (!silent) {
        alert('✅ Archivos Subtitulos.srt y SEO_YouTube_Copiar_Pegar.txt guardados en tu carpeta.');
      }
    } catch (err: any) {
      if (!silent) {
        alert('Error creando carpeta organizada: ' + (err?.message || err));
      }
    }
  };

  // ITEM 4: 1-Click Full Pre-Production Autopilot (Runs Stages 1 -> 2 -> 3 -> 4 -> 5 -> 6 -> 7 -> 8 -> 9 Automatically)
  const handleRunFullPreproduction1To8 = async () => {
    if (!activeDoc) return;
    if (isFullPreprodRunning) return;

    setIsFullPreprodRunning(true);
    let workingDoc: DocumentaryProject = { ...activeDoc };

    const generateStageDirect = async (
      stageNum: number,
      docState: DocumentaryProject
    ): Promise<string> => {
      if (!isCloudMode) {
        try {
          const res = await fetch('/api/ai/generate-stage', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              stageNumber: stageNum,
              documentary: docState,
            }),
          });
          if (res.ok && (res.headers.get('content-type') || '').includes('application/json')) {
            const data = await res.json();
            if (data.text) return String(data.text);
          }
        } catch {}
      }
      return await generateStageClientSide(stageNum, docState);
    };

    try {
      // 1. Etapa 2/3: Estructura e Investigación si está vacía
      if (!(workingDoc.sectionsStructure || '').trim()) {
        setFullPreprodStepMsg('⏳ Paso 1/7: Generando Estructura Documental e Investigación...');
        const structText = await generateStageDirect(2, workingDoc);
        if (structText.trim()) {
          workingDoc = { ...workingDoc, sectionsStructure: structText };
          updateActiveDoc({ sectionsStructure: structText });
        }
      }

      // 2. Etapa 4 (Guion de Voz Narrativa con números en letras y pausas)
      if (!(workingDoc.voiceoverScript || '').trim()) {
        setFullPreprodStepMsg('⏳ Paso 2/7: Escribiendo Guion de Voz Narrativa (Reglas Huellas)...');
        const scriptText = normalizeQuantitiesToMil(await generateStageDirect(4, workingDoc));
        if (scriptText.trim()) {
          const parsedSentences = parseTimelineTextToSentences(
            scriptText,
            workingDoc.clip1DurationSeconds || 6
          );
          const formattedTl = generateTimelineText(parsedSentences);
          const autoSrt = generateSRT(parsedSentences);
          workingDoc = {
            ...workingDoc,
            voiceoverScript: scriptText,
            timelineSentences: parsedSentences,
            timelineFormattedText: formattedTl,
            correctedSrt: autoSrt,
          };
          updateActiveDoc({
            voiceoverScript: scriptText,
            timelineSentences: parsedSentences,
            timelineFormattedText: formattedTl,
            correctedSrt: autoSrt,
          });
        }
      }

      // 3. Etapa 5 (Opciones de Texto + Prompts de Miniatura A/B)
      setFullPreprodStepMsg('⏳ Paso 3/7: Diseñando Miniaturas A/B de Alto CTR...');
      if (!(workingDoc.thumbnailTextOverlay || '').trim()) {
        const optsRaw = await generateStageDirect(101, workingDoc);
        const firstOpt = optsRaw
          .split(/\r?\n/)
          .map((l) => l.replace(/^\s*[\d•*-]+[.):\s]*/, '').replace(/["“”']/g, '').trim().toUpperCase())
          .filter(Boolean)[0];
        if (firstOpt) {
          workingDoc = { ...workingDoc, thumbnailTextOverlay: firstOpt };
          updateActiveDoc({ thumbnailTextOverlay: firstOpt });
        }
      }
      if (!(workingDoc.thumbnailPrompt || '').trim()) {
        const thumbText = await generateStageDirect(5, workingDoc);
        if (thumbText.trim()) {
          workingDoc = { ...workingDoc, thumbnailPrompt: thumbText };
          updateActiveDoc({ thumbnailPrompt: thumbText });
        }
      }

      // 4. Etapa 6 (@Referencias de Personajes y Lugares)
      if (!(workingDoc.rawReferencePrompts || '').trim()) {
        setFullPreprodStepMsg('⏳ Paso 4/7: Creando @Referencias de Personajes y Lugares...');
        const refsText = await generateStageDirect(6, workingDoc);
        if (refsText.trim()) {
          const parsedRefs = parseReferencesFromRawText(refsText);
          workingDoc = {
            ...workingDoc,
            rawReferencePrompts: refsText,
            references: parsedRefs,
          };
          updateActiveDoc({ rawReferencePrompts: refsText, references: parsedRefs });
        }
      }

      // 5. Etapa 7 (Prompts Musicales Suno con regla de 15s de silencio y 1:30 final)
      if (!(workingDoc.rawSunoText || '').trim()) {
        setFullPreprodStepMsg('⏳ Paso 5/7: Componiendo Prompts Musicales para Suno...');
        const sunoText = await generateStageDirect(10, workingDoc);
        if (sunoText.trim()) {
          const parsedTracks = parseSunoTracksFromRawText(sunoText);
          workingDoc = {
            ...workingDoc,
            rawSunoText: sunoText,
            sunoTracks: parsedTracks,
          };
          updateActiveDoc({ rawSunoText: sunoText, sunoTracks: parsedTracks });
        }
      }

      // 6. Etapa 8 (Todos los Pares Image X + Clip X con Orden Operativa de 9 líneas)
      setFullPreprodStepMsg('⏳ Paso 6/7: Generando todos los Pares Image + Clip para Google Flow...');
      const clipsRaw = await generateStageDirect(8, workingDoc);
      if (clipsRaw.trim()) {
        const textWithHeader = ensureOperationalHeaderInRawClips(
          clipsRaw,
          workingDoc.operationalHeader
        );
        const syncedClips = syncAndAuditProductionClips({
          rawVoiceoverWithPauses: workingDoc.voiceoverScript || '',
          timelineText: workingDoc.timelineFormattedText || '',
          rawClipsText: textWithHeader,
          existingClips: workingDoc.clips || [],
          clip1Duration: workingDoc.clip1DurationSeconds || 6,
          clip1SyncMode: workingDoc.clip1SyncMode || 'VOZ_EN_CLIP_2',
        });
        workingDoc = {
          ...workingDoc,
          rawClipsText: textWithHeader,
          clips: syncedClips,
        };
        updateActiveDoc({
          rawClipsText: textWithHeader,
          clips: syncedClips,
        });
      }

      // 7. Etapa 4/9 SEO YouTube + Comentario Fijado
      setFullPreprodStepMsg('⏳ Paso 7/7: Generando SEO de YouTube, Capítulos y Comentario Fijado...');
      const seoText = await generateStageDirect(111, workingDoc);
      const pinnedText = await generateStageDirect(113, workingDoc);
      updateActiveDoc({
        ...(seoText.trim() ? { rawYoutubeMetadata: seoText, rawMetadataText: seoText } : {}),
        ...(pinnedText.trim() ? { pinnedComment: pinnedText.trim() } : {}),
      });

      setFullPreprodStepMsg('✅ ¡Pre-producción completa (Etapas 1 a 9) terminada automáticamente!');
      setActiveStage(8);
      if (flowServerFolderPath || flowDownloadDirHandleRef.current) {
        await handleExportOrganizedProjectFolder(true);
      }
    } catch (err: any) {
      setFullPreprodStepMsg(`⚠️ Error en pre-producción automática: ${err?.message || err}`);
    } finally {
      setIsFullPreprodRunning(false);
    }
  };

  const handleStopFlowAutoPilot = () => {
    setFlowAutoPilotActive(false);
    flowAutoPilotActiveRef.current = false;
    setFlowCurrentClipNum(null);
    setFlowStatusLog('⏹️ Piloto Automático detenido por el usuario.');
    sendCommandToWebBridge('FLOW', {
      action: 'STOP_FLOW_WATCHER',
      tabId: selectedFlowTabId,
    });
  };

  const handleScanExistingFlowVideosInTab = async () => {
    if (
      flowAutoDownloadEnabled &&
      !flowDownloadDirHandleRef.current &&
      !flowServerFolderPath
    ) {
      await handlePickFlowDownloadFolder();
    }
    setFlowStatusLog(
      '🔍 Escaneando videos ya creados en la pestaña de Google Flow para auditarlos automáticamente...'
    );
    sendCommandToWebBridge('FLOW', {
      action: 'SCAN_FLOW_VIDEOS',
      tabId: selectedFlowTabId,
    });
  };

  // Listen for Chrome Extension Web Bridge messages (Gemini Web, Google Flow & Suno)
  useEffect(() => {
    const handleBridgeMessage = async (event: MessageEvent) => {
      if (!event.data || event.data.source !== 'HUELLAS_EXTENSION') return;
      const msg = event.data;

      if (msg.type === 'EXTENSION_READY' || msg.type === 'HUELLAS_CONNECTED_TABS_UPDATE') {
        setExtensionInstalled(true);
        if (Array.isArray(msg.geminiTabs)) {
          setGeminiTabs(msg.geminiTabs);
        }
        if (Array.isArray(msg.flowTabs)) {
          setFlowTabs(msg.flowTabs);
        }
      } else if (msg.type === 'BRIDGE_STATUS') {
        setExtensionInstalled(true);
        setBridgeStatusMsg(msg.message || '');
        if ((msg.service === 'FLOW' || msg.service === 'SUNO') && msg.message) {
          setFlowStatusLog(msg.message);
        }
        if (msg.previewText) {
          setLastMirroredGeminiText(String(msg.previewText));
        }
        if (msg.status === 'ERROR') {
          setBridgeStatusType('ERROR');
          setAiGenerating(false);
        } else if (msg.status === 'COMPLETED') {
          setBridgeStatusType('SUCCESS');
          setAiGenerating(false);
        } else {
          setBridgeStatusType('WORKING');
        }
      } else if (msg.type === 'GEMINI_RESPONSE_READY') {
        setExtensionInstalled(true);
        setAiGenerating(false);
        setThumbOptionsGenerating(false);
        const targetStage = Number(msg.stageNumber) || activeStage;
        const text = String(msg.text || '');
        const images = Array.isArray(msg.images) ? msg.images : [];
        if (text) setLastMirroredGeminiText(text);
        if (images.length > 0) setLastMirroredGeminiImages(images);
        if (text || images.length > 0) {
          applyGeneratedStageText(targetStage, text, images);
          setBridgeStatusType('SUCCESS');
          setBridgeStatusMsg(
            `✅ Respuesta de Gemini Web recibida y guardada en Etapa ${
              targetStage === 101 ? 5 : targetStage > 100 ? Math.floor(targetStage / 10) : targetStage
            } (${text.length} caract.)`
          );
        }
      } else if (msg.type === 'FLOW_MEDIA_READY') {
        setExtensionInstalled(true);
        if (Array.isArray(msg.videos)) setLastMirroredFlowVideos(msg.videos);
        if (Array.isArray(msg.images)) setLastMirroredFlowImages(msg.images);
        setBridgeStatusType('SUCCESS');
        setBridgeStatusMsg('✅ Media capturada desde Google Flow.');
      } else if (msg.type === 'FLOW_VIDEO_CAPTURED') {
        setExtensionInstalled(true);
        handleCapturedFlowVideoAudit(msg);
      } else if (msg.type === 'FLOW_THUMBNAIL_CAPTURED') {
        // ITEM 5: Auto-save captured Thumbnail A/B into /Miniaturas and state
        setExtensionInstalled(true);
        const opt = msg.option === 'B' ? 'B' : 'A';
        const dataUrl = msg.imageDataUrl || msg.imageUrl || '';
        if (dataUrl) {
          setCapturedThumbnailsMap((prev) => ({ ...prev, [opt]: dataUrl }));
          updateActiveDoc({ thumbnailImageUrl: dataUrl, thumbnailReady: true });
          const thumbFileName = `Miniatura_Opcion_${opt}.png`;
          if (flowServerFolderPath && !isCloudMode && dataUrl.startsWith('data:')) {
            fetch('/api/flow/save-asset-to-folder', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                folderPath: flowServerFolderPath,
                subFolder: 'Miniaturas',
                fileName: thumbFileName,
                dataUrl,
              }),
            }).catch(() => {});
          } else if (dataUrl.startsWith('data:')) {
            handleSaveAnyFileToChosenFolder(thumbFileName, dataUrl);
          }
          setBridgeStatusType('SUCCESS');
          setBridgeStatusMsg(
            `🖼️ ¡Miniatura Opción ${opt} capturada de Google Flow y guardada automáticamente como ${thumbFileName}!`
          );
        }
      } else if (msg.type === 'SUNO_AUDIO_CAPTURED') {
        // ITEM 2: Auto-save captured Suno MP3 into /Audio and inject into CapCut Editor Track 5
        setExtensionInstalled(true);
        const trackNum = Number(msg.trackNumber) || 1;
        const dataUrl = msg.audioDataUrl || msg.audioUrl || '';
        if (dataUrl) {
          setCapturedSunoAudioMap((prev) => ({ ...prev, [trackNum]: dataUrl }));
          const currentDoc = activeDocRef.current;
          if (currentDoc && Array.isArray(currentDoc.sunoTracks)) {
            const nextTracks = currentDoc.sunoTracks.map((st, idx) =>
              idx + 1 === trackNum ? { ...st, audioUrl: dataUrl, ready: true } : st
            );
            updateActiveDoc({ sunoTracks: nextTracks });
          }
          const sunoFileName = `Suno_${String(trackNum).padStart(2, '0')}.mp3`;
          if (flowServerFolderPath && !isCloudMode && dataUrl.startsWith('data:')) {
            fetch('/api/flow/save-asset-to-folder', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                folderPath: flowServerFolderPath,
                subFolder: 'Audio',
                fileName: sunoFileName,
                dataUrl,
              }),
            }).catch(() => {});
          } else if (dataUrl.startsWith('data:')) {
            handleSaveAnyFileToChosenFolder(sunoFileName, dataUrl);
          }
          setBridgeStatusType('SUCCESS');
          setBridgeStatusMsg(
            `🎵 ¡Pista #${trackNum} capturada de Suno, guardada en /Audio/${sunoFileName} e inyectada en la Pista 5 del Editor CapCut!`
          );
        }
      }
    };

    window.addEventListener('message', handleBridgeMessage);
    return () => window.removeEventListener('message', handleBridgeMessage);
  }, [activeDoc, activeStage, flowServerFolderPath]);

  const handleSendStageToGeminiWeb = (stageNum: number, preferredTabId?: number) => {
    if (!activeDoc) return;
    if (stageNum === 5 && !(activeDoc.thumbnailTextOverlay || '').trim()) {
      alert(
        '⚠️ Obligatorio: Primero debes escribir el Texto en Pantalla en la Imagen antes de generar el prompt de la miniatura.'
      );
      const inputEl = document.getElementById('thumbnail-text-overlay-input');
      if (inputEl) inputEl.focus();
      return;
    }
    const orientationForThumb = getDefaultThumbnailOrientation(activeDoc);
    const docForPayload =
      stageNum === 5
        ? { ...activeDoc, thumbnailOrientation: orientationForThumb }
        : activeDoc;

    const promptText = buildStagePromptText(stageNum, docForPayload, aiCustomInstruction);
    navigator.clipboard.writeText(promptText).catch(() => {});

    if (!showWebStudio) {
      setShowWebStudio(true);
    }

    if (!extensionInstalled && !isHuellasExtensionDetected()) {
      setBridgeStatusType('WORKING');
      setBridgeStatusMsg(
        '📋 Prompt copiado al portapapeles. Activa la Extensión Puente en la pestaña ⚙️ para envío 100% automático.'
      );
      return;
    }

    setAiGenerating(true);
    setBridgeStatusType('WORKING');
    setBridgeStatusMsg(`🚀 Enviando prompt de Etapa ${stageNum === 101 ? 5 : stageNum} a tu chat de Gemini Web...`);
    sendCommandToWebBridge('GEMINI', {
      action: 'SEND_PROMPT',
      prompt: promptText,
      stageNumber: stageNum,
      taskType: 'STAGE_GENERATION',
      autoSubmit: true,
      tabId: preferredTabId || selectedGeminiTabId,
    });
  };

  const handleSendPromptToFlow = async (
    promptText: string,
    mediaType: 'IMAGE' | 'VIDEO' = 'VIDEO',
    clipIdentifier?: string | number,
    preferredTabId?: number
  ) => {
    if (!promptText.trim()) return;
    navigator.clipboard.writeText(promptText).catch(() => {});

    // If sending a VIDEO clip from Stage 8 and Auto-Download is enabled, make sure folder is chosen first
    if (
      mediaType === 'VIDEO' &&
      clipIdentifier &&
      flowAutoDownloadEnabled &&
      !flowDownloadDirHandleRef.current &&
      !flowServerFolderPath
    ) {
      const picked = await handlePickFlowDownloadFolder();
      if (!picked) {
        return;
      }
    }

    const matchedClip =
      activeDoc?.clips?.find((c) => c.id === clipIdentifier || c.clipNumber === Number(clipIdentifier)) ||
      null;

    if (matchedClip && mediaType === 'VIDEO') {
      sendClipToFlowWithAutoAudit(matchedClip, promptText, 1);
      return;
    }

    if (!showWebStudio) {
      setShowWebStudio(true);
    }
    setBridgeStatusType('WORKING');
    setBridgeStatusMsg(
      `🎬 Enviando prompt a Google Flow (también copiado al portapapeles)...`
    );
    sendCommandToWebBridge('FLOW', {
      action: 'SEND_PROMPT',
      prompt: promptText,
      clipNumber: matchedClip ? matchedClip.clipNumber : clipIdentifier,
      clipId: matchedClip ? matchedClip.id : undefined,
      watchForVideo: mediaType === 'VIDEO',
      mediaType,
      autoSubmit: true,
      focusTab: true,
      tabId: preferredTabId || selectedFlowTabId,
    });
  };

  // Hybrid AI Generator handler (Web Free Mode + Local Server + Mobile Client-Side Fallback)
  const handleGenerateWithGemini = async (stageNum: number) => {
    if (!activeDoc) return;
    if (stageNum === 5 && !(activeDoc.thumbnailTextOverlay || '').trim()) {
      alert(
        '⚠️ Obligatorio: Primero debes escribir el Texto en Pantalla en la Imagen antes de generar el prompt de la miniatura.'
      );
      const inputEl = document.getElementById('thumbnail-text-overlay-input');
      if (inputEl) inputEl.focus();
      return;
    }

    // If user selected Web Free Mode (or has no API Key and Extension is installed), route via Gemini Web Free!
    if (aiEngineMode === 'WEB_FREE') {
      handleSendStageToGeminiWeb(stageNum);
      return;
    }

    const orientationForThumb = getDefaultThumbnailOrientation(activeDoc);
    const docForPayload =
      stageNum === 5
        ? { ...activeDoc, thumbnailOrientation: orientationForThumb }
        : activeDoc;

    setAiGenerating(true);
    try {
      let text = '';
      if (!isCloudMode) {
        try {
          const res = await fetch('/api/ai/generate-stage', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              stageNumber: stageNum,
              documentary: docForPayload,
              customInstruction: aiCustomInstruction,
            }),
          });
          if ((res.headers.get('content-type') || '').includes('application/json')) {
            const data = await res.json();
            if (!res.ok) {
              alert(data.error || 'Error al generar con Gemini.');
              return;
            }
            text = data.text || '';
          } else {
            text = await generateStageClientSide(stageNum, docForPayload, aiCustomInstruction);
          }
        } catch {
          text = await generateStageClientSide(stageNum, docForPayload, aiCustomInstruction);
        }
      } else {
        text = await generateStageClientSide(stageNum, docForPayload, aiCustomInstruction);
      }
      applyGeneratedStageText(stageNum, text);
      setAiCustomInstruction('');
    } catch (err: any) {
      alert('Error de conexión con Gemini: ' + err.message);
    } finally {
      setAiGenerating(false);
    }
  };

  // Stage 5: Generate 3 Thumbnail Text Overlay Options with Gemini
  const handleGenerateThumbnailTextOptions = async () => {
    if (!activeDoc) return;
    if (aiEngineMode === 'WEB_FREE') {
      handleSendStageToGeminiWeb(101);
      return;
    }
    setThumbOptionsGenerating(true);
    try {
      let rawText = '';
      if (!isCloudMode) {
        try {
          const res = await fetch('/api/ai/generate-stage', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              stageNumber: 101,
              documentary: activeDoc,
            }),
          });
          if ((res.headers.get('content-type') || '').includes('application/json')) {
            const data = await res.json();
            if (!res.ok) {
              alert(data.error || 'Error al generar las 3 opciones de texto con Gemini.');
              return;
            }
            rawText = data.text || '';
          } else {
            rawText = await generateStageClientSide(101, activeDoc);
          }
        } catch {
          rawText = await generateStageClientSide(101, activeDoc);
        }
      } else {
        rawText = await generateStageClientSide(101, activeDoc);
      }
      const parsedOptions = rawText
        .split(/\r?\n/)
        .map((line) =>
          line
            .replace(/^\s*(?:opci[oó]n\s*\d+\s*[:.-]?|\d+\s*[.):-]|[-•*])\s*/i, '')
            .replace(/^["“”'«»]+|["“”'«»]+$/g, '')
            .trim()
            .toUpperCase()
        )
        .filter((line) => line.length > 0)
        .slice(0, 3);

      if (parsedOptions.length > 0) {
        const selectedOverlay = (activeDoc.thumbnailTextOverlay || '').trim()
          ? activeDoc.thumbnailTextOverlay
          : parsedOptions[0];
        const currentOrientation = getDefaultThumbnailOrientation(activeDoc);
        const updatedPrompt = (activeDoc.thumbnailPrompt || '').trim()
          ? buildOrUpdateThumbnailPrompt(
              activeDoc.thumbnailPrompt,
              currentOrientation,
              selectedOverlay,
              activeDoc
            )
          : activeDoc.thumbnailPrompt;

        updateActiveDoc({
          thumbnailTextOptions: parsedOptions,
          thumbnailTextOverlay: selectedOverlay,
          thumbnailOrientation: currentOrientation,
          thumbnailPrompt: updatedPrompt,
        });
      }
    } catch (err: any) {
      alert('Error de conexión con Gemini: ' + err.message);
    } finally {
      setThumbOptionsGenerating(false);
    }
  };

  // Stage 7 (Producción): Sync Raw Voiceover + Timestamps + Clip Prompts into Unified Timeline
  const handleSyncProductionTimeline = (): DocumentaryClip[] => {
    if (!activeDoc) return [];
    const normalizedRaw = activeDoc.rawClipsText?.trim()
      ? ensureOperationalHeaderInRawClips(activeDoc.rawClipsText, activeDoc.operationalHeader)
      : '';
    const synced = syncAndAuditProductionClips({
      rawVoiceoverWithPauses: activeDoc.voiceoverScript || '',
      timelineText: activeDoc.timelineFormattedText || '',
      rawClipsText: normalizedRaw,
      existingClips: activeDoc.clips || [],
      clip1Duration: activeDoc.clip1DurationSeconds || 6,
      clip1SyncMode: activeDoc.clip1SyncMode || 'VOZ_EN_CLIP_2',
    });
    const finalRaw =
      normalizedRaw || (synced.length > 0 ? buildRawClipsTextWithHeader(synced, activeDoc.operationalHeader) : '');
    updateActiveDoc({
      clips: synced,
      ...(finalRaw ? { rawClipsText: finalRaw } : {}),
    });
    return synced;
  };

  // Stage 7 (Producción): AI Deep Coherence Audit + Suggested Prompt Fixes
  const handleAuditProductionClipsWithAI = async () => {
    if (!activeDoc) return;
    setAuditingClips(true);
    try {
      // First make sure clips are synced with the latest text boxes
      const baseClips = syncAndAuditProductionClips({
        rawVoiceoverWithPauses: activeDoc.voiceoverScript || '',
        timelineText: activeDoc.timelineFormattedText || '',
        rawClipsText: activeDoc.rawClipsText || '',
        existingClips: activeDoc.clips || [],
        clip1Duration: activeDoc.clip1DurationSeconds || 6,
        clip1SyncMode: activeDoc.clip1SyncMode || 'VOZ_EN_CLIP_2',
      });

      if (baseClips.length === 0) {
        alert(
          'Primero pega o genera la Voz con Timestamps o los Prompts de Clips para poder armar y revisar el timeline.'
        );
        return;
      }

      let data: any = null;
      if (!isCloudMode) {
        try {
          const res = await fetch('/api/ai/audit-clips', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              documentary: { ...activeDoc, clips: baseClips },
              clips: baseClips,
              voiceoverScript: activeDoc.voiceoverScript || '',
              timelineFormattedText: activeDoc.timelineFormattedText || '',
            }),
          });
          if ((res.headers.get('content-type') || '').includes('application/json')) {
            data = await res.json();
            if (!res.ok) {
              alert(data.error || 'Error al revisar los clips con IA.');
              updateActiveDoc({ clips: baseClips });
              return;
            }
          } else {
            data = await auditClipsClientSide(activeDoc, baseClips);
          }
        } catch {
          data = await auditClipsClientSide(activeDoc, baseClips);
        }
      } else {
        data = await auditClipsClientSide(activeDoc, baseClips);
      }

      const audits: Array<{
        clipNumber: number;
        auditStatus: 'ok' | 'warning' | 'mismatch';
        auditReason: string;
        suggestedImagePrompt?: string;
        suggestedVideoPrompt?: string;
      }> = Array.isArray(data.audits) ? data.audits : [];

      const merged = baseClips.map((c) => {
        const found = audits.find((a) => Number(a.clipNumber) === c.clipNumber);
        if (!found) return c;
        return {
          ...c,
          auditStatus: found.auditStatus || c.auditStatus || 'ok',
          auditReason: found.auditReason || c.auditReason || '',
          suggestedImagePrompt:
            found.suggestedImagePrompt && found.suggestedImagePrompt.trim()
              ? found.suggestedImagePrompt.trim()
              : undefined,
          suggestedVideoPrompt:
            found.suggestedVideoPrompt && found.suggestedVideoPrompt.trim()
              ? found.suggestedVideoPrompt.trim()
              : undefined,
        };
      });

      if (data.summary) {
        setAuditSummary(data.summary);
      }
      updateActiveDoc({ clips: merged });
    } catch (e: any) {
      alert('Error en la auditoría de producción: ' + e.message);
    } finally {
      setAuditingClips(false);
    }
  };

  // Apply suggested prompt change to a single clip and sync rawClipsText (keeping the 9-line initial paragraph)
  const handleApplyClipSuggestion = (clipId: string) => {
    if (!activeDoc) return;
    const updatedClips = (activeDoc.clips || []).map((c) => {
      if (c.id !== clipId) return c;
      return {
        ...c,
        imagePrompt: c.suggestedImagePrompt ? c.suggestedImagePrompt : c.imagePrompt,
        videoPrompt: c.suggestedVideoPrompt ? c.suggestedVideoPrompt : c.videoPrompt,
        auditStatus: 'ok' as const,
        auditReason: '✅ Cambio sugerido aplicado y sincronizado con la voz narrativa.',
        suggestedImagePrompt: undefined,
        suggestedVideoPrompt: undefined,
      };
    });
    const rebuiltRaw = buildRawClipsTextWithHeader(updatedClips, activeDoc.operationalHeader);
    updateActiveDoc({
      clips: updatedClips,
      rawClipsText: rebuiltRaw,
    });
  };

  // Apply all suggested prompt changes across all clips at once (keeping the 9-line initial paragraph)
  const handleApplyAllClipSuggestions = () => {
    if (!activeDoc) return;
    const updatedClips = (activeDoc.clips || []).map((c) => {
      if (!c.suggestedImagePrompt && !c.suggestedVideoPrompt) return c;
      return {
        ...c,
        imagePrompt: c.suggestedImagePrompt ? c.suggestedImagePrompt : c.imagePrompt,
        videoPrompt: c.suggestedVideoPrompt ? c.suggestedVideoPrompt : c.videoPrompt,
        auditStatus: 'ok' as const,
        auditReason: '✅ Cambio sugerido aplicado y sincronizado con la voz narrativa.',
        suggestedImagePrompt: undefined,
        suggestedVideoPrompt: undefined,
      };
    });
    const rebuiltRaw = buildRawClipsTextWithHeader(updatedClips, activeDoc.operationalHeader);
    updateActiveDoc({
      clips: updatedClips,
      rawClipsText: rebuiltRaw,
    });
  };

  // Measure real duration of any audio URL or File in the browser (works 100% on GitHub Pages & locally)
  const measureAudioDurationInBrowser = (srcOrFile: string | File): Promise<number> => {
    return new Promise((resolve) => {
      try {
        const audio = new Audio();
        let objectUrl = '';
        if (typeof srcOrFile === 'string') {
          audio.src = srcOrFile;
        } else {
          objectUrl = URL.createObjectURL(srcOrFile);
          audio.src = objectUrl;
        }
        const cleanup = () => {
          if (objectUrl) {
            try {
              URL.revokeObjectURL(objectUrl);
            } catch {}
          }
        };
        const timer = setTimeout(() => {
          cleanup();
          resolve(0);
        }, 4500);
        audio.onloadedmetadata = () => {
          clearTimeout(timer);
          const dur = Number.isFinite(audio.duration) && audio.duration > 0 ? audio.duration : 0;
          cleanup();
          resolve(dur);
        };
        audio.onerror = () => {
          clearTimeout(timer);
          cleanup();
          resolve(0);
        };
      } catch {
        resolve(0);
      }
    });
  };

  // 100% Client-Side & Pause-Aware Smart Timeline Extractor (Never fails on GitHub Pages)
  const buildSmartClientTimeline = (
    rawScript: string,
    doc: DocumentaryProject,
    audioDurationSec?: number,
    overrideSentenceMode?: string
  ): { sentences: Sentence[]; formatted: string; srt: string } => {
    const settings = doc.timelineSettings || {
      language: 'es',
      customLanguage: '',
      quality: 'high',
      outputStyle: 'timeline',
      timestampFormat: 'MM:SS',
      sentenceMode:
        doc.clipDurationMode === '8_SEGUNDOS' ? 'split-8-seconds' : 'split-10-seconds',
      noBlankLines: true,
      strictNarration: false,
      removeFiller: false,
      mergeShort: false,
      preservePunctuation: true,
      includeLineNumbers: true,
    };

    const mode = overrideSentenceMode || settings.sentenceMode || 'split-10-seconds';
    const segLen =
      mode === 'split-8-seconds' ? 8 : mode === 'split-4-seconds' ? 4 : 10;

    const cleanRaw = (rawScript || '').trim();
    if (!cleanRaw) {
      return { sentences: [], formatted: '', srt: '' };
    }

    // Tokenize words & pause tags ([pausa de X segundos] / (pausa de X segundos))
    const pauseRegex = /(?:\[|\()\s*pausa(?:\s+de)?\s+(\d+(?:[.,]\d+)?)\s*(?:s|seg|segundos?)?\s*(?:\]|\))/gi;
    interface TimedWordToken {
      word: string;
      pauseAfterSec: number;
    }

    const tokens: TimedWordToken[] = [];
    let lastIndex = 0;
    let match: RegExpExecArray | null;

    const pushWordsChunk = (chunk: string) => {
      const words = chunk
        .replace(/\r?\n+/g, ' ')
        .trim()
        .split(/\s+/)
        .filter(Boolean);
      for (const w of words) {
        tokens.push({ word: w, pauseAfterSec: 0 });
      }
    };

    while ((match = pauseRegex.exec(cleanRaw)) !== null) {
      if (match.index > lastIndex) {
        pushWordsChunk(cleanRaw.slice(lastIndex, match.index));
      }
      const pSec = parseFloat(String(match[1]).replace(',', '.')) || 0;
      if (tokens.length > 0 && pSec > 0) {
        tokens[tokens.length - 1].pauseAfterSec += pSec;
      }
      lastIndex = pauseRegex.lastIndex;
    }
    if (lastIndex < cleanRaw.length) {
      pushWordsChunk(cleanRaw.slice(lastIndex));
    }

    if (tokens.length === 0) {
      return { sentences: [], formatted: '', srt: '' };
    }

    const totalPauseSec = tokens.reduce((acc, t) => acc + t.pauseAfterSec, 0);
    const baseWordSec = 0.38; // ~158 words/min documentary narration speed
    const estimatedSpeechSec = tokens.length * baseWordSec;
    const targetTotalSec =
      audioDurationSec && audioDurationSec > 2
        ? audioDurationSec
        : estimatedSpeechSec + totalPauseSec;

    const speechBudgetSec = Math.max(tokens.length * 0.18, targetTotalSec - totalPauseSec);
    const secPerWord = speechBudgetSec / tokens.length;

    const sentences: Sentence[] = [];

    if (mode === 'one-sentence-per-line' || mode === 'combine-short') {
      let currentWords: string[] = [];
      let blockStart = 0;
      let cursor = 0;

      tokens.forEach((tok, idx) => {
        currentWords.push(tok.word);
        cursor += secPerWord + tok.pauseAfterSec;
        const endsSentence = /[.!?…]$/.test(tok.word);
        const minWords = mode === 'combine-short' ? 12 : 4;
        if ((endsSentence && currentWords.length >= minWords) || idx === tokens.length - 1) {
          sentences.push({
            text: currentWords.join(' '),
            start: Number(blockStart.toFixed(2)),
            end: Number(Math.max(blockStart + 1, cursor).toFixed(2)),
          });
          currentWords = [];
          blockStart = cursor;
        }
      });
    } else {
      // Exact 10-second / 8-second / 4-second blocks
      const totalBlocks = Math.max(1, Math.ceil(targetTotalSec / segLen));
      let tokenIdx = 0;
      let cursorSec = 0;

      for (let b = 0; b < totalBlocks; b++) {
        const blockStart = b * segLen;
        const blockEnd = b === totalBlocks - 1 ? Math.max((b + 1) * segLen, Math.ceil(targetTotalSec)) : (b + 1) * segLen;
        const blockWords: string[] = [];

        while (tokenIdx < tokens.length) {
          const tok = tokens[tokenIdx];
          blockWords.push(tok.word);
          cursorSec += secPerWord + tok.pauseAfterSec;
          tokenIdx++;
          if (cursorSec >= blockEnd && b < totalBlocks - 1) {
            break;
          }
        }

        if (blockWords.length > 0) {
          sentences.push({
            text: blockWords.join(' '),
            start: blockStart,
            end: b === totalBlocks - 1 ? ( b + 1 ) * segLen : blockEnd,
          });
        }
      }
    }

    const formatted = generateTimelineText(
      sentences,
      settings.timestampFormat || 'MM:SS',
      settings.noBlankLines !== false,
      settings.includeLineNumbers !== false
    );
    const srt = generateSRT(sentences);
    return { sentences, formatted, srt };
  };

  // Automatically extract & keep Timeline updated whenever voiceoverScript or audioTracks exist and timeline is empty
  useEffect(() => {
    if (!activeDoc) return;
    const hasScript = Boolean((activeDoc.voiceoverScript || '').trim());
    const hasAudio = (activeDoc.audioTracks?.length || 0) > 0;
    const hasTimeline =
      (activeDoc.timelineSentences?.length || 0) > 0 &&
      Boolean((activeDoc.timelineFormattedText || '').trim());

    if ((hasScript || hasAudio) && !hasTimeline) {
      const sourceText =
        (activeDoc.voiceoverScript || '').trim() ||
        (activeDoc.audioTracks?.[0]?.text || '').trim();
      if (!sourceText) return;

      const firstTrackUrl = activeDoc.masterAudioUrl || activeDoc.audioTracks?.[0]?.audioUrl || '';
      if (firstTrackUrl) {
        measureAudioDurationInBrowser(firstTrackUrl).then((dur) => {
          const res = buildSmartClientTimeline(sourceText, activeDoc, dur > 2 ? dur : undefined);
          if (res.sentences.length > 0) {
            updateActiveDoc({
              timelineSentences: res.sentences,
              timelineFormattedText: res.formatted,
              ...(activeDoc.correctedSrt ? {} : { correctedSrt: res.srt }),
            });
          }
        });
      } else {
        const res = buildSmartClientTimeline(sourceText, activeDoc);
        if (res.sentences.length > 0) {
          updateActiveDoc({
            timelineSentences: res.sentences,
            timelineFormattedText: res.formatted,
            ...(activeDoc.correctedSrt ? {} : { correctedSrt: res.srt }),
          });
        }
      }
    }
  }, [activeDoc?.id, activeDoc?.voiceoverScript, activeDoc?.audioTracks?.length]);

  // VoxFlow TTS Generation inside Stage 4 (Local Server + Mobile Client-Side Fallback + Auto-Timeline)
  const handleSynthesizeVoxFlow = async (textToSpeak: string, labelTitle: string) => {
    if (!activeDoc || !textToSpeak.trim()) {
      alert('Escribe o pega primero el texto del guion para generar la voz.');
      return;
    }
    setTtsGenerating(true);
    try {
      let data: TTSRecord | null = null;
      if (!isCloudMode) {
        try {
          const res = await fetch('/api/tts', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              text: textToSpeak,
              voice: activeDoc.selectedVoice || 'Charon',
              style: activeDoc.selectedStyle || 'dramatic',
              speed: activeDoc.selectedSpeed || 'medium',
              language: activeDoc.selectedLanguage || 'es-la',
              consistencyMode: true,
              label: labelTitle || getVoiceoverAudioName(activeDoc.title),
            }),
          });
          if ((res.headers.get('content-type') || '').includes('application/json')) {
            const respJson = await res.json();
            if (!res.ok) {
              alert(respJson.error || 'Error al generar audio en VoxFlow.');
              return;
            }
            data = respJson;
          }
        } catch {}
      }

      if (!data) {
        data = await synthesizeTtsClientSide({
          text: textToSpeak,
          voice: activeDoc.selectedVoice || 'Charon',
          style: activeDoc.selectedStyle || 'dramatic',
          speed: activeDoc.selectedSpeed || 'medium',
          language: activeDoc.selectedLanguage || 'es-la',
          label: labelTitle || getVoiceoverAudioName(activeDoc.title),
        });
      }

      const updatedTracks = [data, ...(activeDoc.audioTracks || [])];

      // AUTOMATICALLY extract timeline right when VoxFlow audio is created!
      const measuredDur = data.audioUrl ? await measureAudioDurationInBrowser(data.audioUrl) : 0;
      const scriptSource = (activeDoc.voiceoverScript || textToSpeak).trim();
      const autoTl = buildSmartClientTimeline(
        scriptSource,
        activeDoc,
        measuredDur > 2 ? measuredDur : undefined
      );

      updateActiveDoc({
        audioTracks: updatedTracks,
        masterAudioUrl: data.audioUrl,
        ...(autoTl.sentences.length > 0
          ? {
              timelineSentences: autoTl.sentences,
              timelineFormattedText: autoTl.formatted,
              correctedSrt: autoTl.srt,
            }
          : {}),
      });
      setTtsCustomSegmentText('');
      setTtsCustomLabel('');
    } catch (e: any) {
      alert('Error en VoxFlow: ' + e.message);
    } finally {
      setTtsGenerating(false);
    }
  };

  // 1-Click / Automatic Timeline Extraction from a VoxFlow audio track (Works on GitHub Pages & Local Server)
  const handleExtractTimelineFromVoxFlow = async (filename: string, trackObj?: TTSRecord) => {
    if (!activeDoc) return;
    setTimelineExtracting(true);
    try {
      const settings = activeDoc.timelineSettings || {
        language: 'es',
        customLanguage: '',
        quality: 'high',
        outputStyle: 'timeline',
        timestampFormat: 'MM:SS',
        sentenceMode:
          activeDoc.clipDurationMode === '8_SEGUNDOS' ? 'split-8-seconds' : 'split-10-seconds',
        noBlankLines: true,
        strictNarration: false,
        removeFiller: false,
        mergeShort: false,
        preservePunctuation: true,
        includeLineNumbers: true,
      };

      // 1. Try local server endpoint ONLY if not in Cloud Mode and response is valid JSON
      if (!isCloudMode && filename && !filename.startsWith('data:')) {
        try {
          const res = await fetch('/api/transcribe-tts-file', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              filename,
              language: settings.language,
              sentenceMode: settings.sentenceMode,
              preservePunctuation: settings.preservePunctuation,
            }),
          });
          if (res.ok && (res.headers.get('content-type') || '').includes('application/json')) {
            const data = await res.json();
            if (Array.isArray(data.sentences) && data.sentences.length > 0) {
              const sentences: Sentence[] = data.sentences;
              const formatted = generateTimelineText(
                sentences,
                settings.timestampFormat || 'MM:SS',
                settings.noBlankLines !== false,
                settings.includeLineNumbers !== false
              );
              const autoSrt = generateSRT(sentences);
              updateActiveDoc({
                timelineSentences: sentences,
                timelineFormattedText: formatted,
                correctedSrt: autoSrt,
              });
              return;
            }
          }
        } catch {}
      }

      // 2. Client-Side Automatic Fallback (Works 100% on GitHub Pages without backend)
      const matchedTrack =
        trackObj ||
        (activeDoc.audioTracks || []).find(
          (t) => t.filename === filename || t.id === filename
        ) ||
        activeDoc.audioTracks?.[0];

      const audioSrc = matchedTrack?.audioUrl || activeDoc.masterAudioUrl || '';
      const audioDur = audioSrc ? await measureAudioDurationInBrowser(audioSrc) : 0;
      const scriptText =
        (activeDoc.voiceoverScript || '').trim() || (matchedTrack?.text || '').trim();

      if (!scriptText) {
        alert('Escribe o genera primero el Guion de Voz Narrativa en el Paso 4A.');
        return;
      }

      const clientResult = buildSmartClientTimeline(
        scriptText,
        activeDoc,
        audioDur > 2 ? audioDur : undefined,
        settings.sentenceMode
      );

      updateActiveDoc({
        timelineSentences: clientResult.sentences,
        timelineFormattedText: clientResult.formatted,
        correctedSrt: clientResult.srt,
      });
    } catch (e: any) {
      alert('Error extrayendo timeline: ' + e.message);
    } finally {
      setTimelineExtracting(false);
    }
  };

  // Upload external audio file (e.g. from CapCut) to extract timeline automatically
  const handleUploadAudioForTimeline = async (file: File) => {
    if (!activeDoc) return;
    setTimelineExtracting(true);
    try {
      const settings = activeDoc.timelineSettings || {
        language: 'es',
        customLanguage: '',
        quality: 'high',
        outputStyle: 'timeline',
        timestampFormat: 'MM:SS',
        sentenceMode:
          activeDoc.clipDurationMode === '8_SEGUNDOS' ? 'split-8-seconds' : 'split-10-seconds',
        noBlankLines: true,
        strictNarration: false,
        removeFiller: false,
        mergeShort: false,
        preservePunctuation: true,
        includeLineNumbers: true,
      };

      // Also store uploaded audio as masterAudioUrl for CapCut Editor playback
      const uploadedDataUrl = await uploadAssetFile(file);
      const realDurationSec = await measureAudioDurationInBrowser(file);

      // 1. Try local server chunked transcription if local backend is running
      if (!isCloudMode) {
        try {
          const CHUNK_SIZE = 512 * 1024;
          const totalChunks = Math.ceil(file.size / CHUNK_SIZE);
          const uploadId = `upload-${Date.now()}-${Math.floor(Math.random() * 1000)}`;
          let chunksOk = true;

          for (let i = 0; i < totalChunks; i++) {
            const chunk = file.slice(i * CHUNK_SIZE, Math.min((i + 1) * CHUNK_SIZE, file.size));
            const fd = new FormData();
            fd.append('uploadId', uploadId);
            fd.append('chunkIndex', String(i));
            fd.append('totalChunks', String(totalChunks));
            fd.append('originalName', file.name);
            fd.append('chunk', chunk, 'chunk.bin');
            const upRes = await fetch('/api/upload-chunk', { method: 'POST', body: fd });
            if (
              !upRes.ok ||
              !(upRes.headers.get('content-type') || '').includes('application/json')
            ) {
              chunksOk = false;
              break;
            }
          }

          if (chunksOk) {
            const procRes = await fetch('/api/transcribe-process', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                uploadId,
                originalName: file.name,
                ...settings,
              }),
            });
            if (
              procRes.ok &&
              (procRes.headers.get('content-type') || '').includes('application/json')
            ) {
              const data = await procRes.json();
              if (Array.isArray(data.sentences) && data.sentences.length > 0) {
                const sentences: Sentence[] = data.sentences;
                const formatted = generateTimelineText(
                  sentences,
                  settings.timestampFormat || 'MM:SS',
                  settings.noBlankLines !== false,
                  settings.includeLineNumbers !== false
                );
                updateActiveDoc({
                  timelineSentences: sentences,
                  timelineFormattedText: formatted,
                  correctedSrt: generateSRT(sentences),
                  ...(uploadedDataUrl ? { masterAudioUrl: uploadedDataUrl } : {}),
                });
                return;
              }
            }
          }
        } catch {}
      }

      // 2. Client-Side Automatic Alignment to the exact duration of the uploaded audio file!
      const scriptText =
        (activeDoc.voiceoverScript || '').trim() ||
        (activeDoc.audioTracks?.[0]?.text || '').trim();

      if (scriptText) {
        const clientResult = buildSmartClientTimeline(
          scriptText,
          activeDoc,
          realDurationSec > 2 ? realDurationSec : undefined,
          settings.sentenceMode
        );
        updateActiveDoc({
          timelineSentences: clientResult.sentences,
          timelineFormattedText: clientResult.formatted,
          correctedSrt: clientResult.srt,
          ...(uploadedDataUrl ? { masterAudioUrl: uploadedDataUrl } : {}),
        });
        return;
      }

      alert(
        'Audio cargado con éxito. Escribe o genera el Guion en el Paso 4A para alinear los tiempos automáticamente.'
      );
    } catch (e: any) {
      alert('Error al extraer timeline del archivo: ' + e.message);
    } finally {
      setTimelineExtracting(false);
    }
  };

  // Export complete documentary dossier as JSON or Markdown/TXT summary
  const handleExportDocumentaryDossier = (doc: DocumentaryProject) => {
    const lines: string[] = [];
    lines.push(`====================================================================`);
    lines.push(`EXPEDIENTE DE PRODUCCIÓN — HUELLAS DE LA HUMANIDAD`);
    lines.push(`Título: ${doc.title}`);
    lines.push(`Formato: ${doc.productionType} | Estado: ${doc.status}`);
    lines.push(`Tema: ${doc.topic} | Época: ${doc.historicalTime} | Lugar: ${doc.historicalLocation}`);
    lines.push(`====================================================================\n`);

    if (doc.sectionsStructure || doc.deepResearchResult) {
      lines.push(`--- ETAPA 3: ESTRUCTURA E INVESTIGACIÓN ---`);
      lines.push(doc.sectionsStructure || '');
      lines.push(doc.deepResearchResult || '');
      lines.push('');
    }
    if (doc.voiceoverScript) {
      lines.push(`--- ETAPA 4: GUION DE VOZ EN OFF ---`);
      lines.push(doc.voiceoverScript);
      lines.push('');
    }
    if (doc.timelineFormattedText) {
      lines.push(`--- ETAPA 4B: TIMELINE EXACTO DE LA NARRACIÓN ---`);
      lines.push(doc.timelineFormattedText);
      lines.push('');
    }
    if (doc.thumbnailPrompt) {
      lines.push(`--- ETAPA 5: PROMPT DE MINIATURA ---`);
      lines.push(doc.thumbnailPrompt);
      lines.push('');
    }
    if (doc.references?.length > 0) {
      lines.push(`--- ETAPA 6: REFERENCIAS (@PERSONAS Y LUGARES) ---`);
      doc.references.forEach((r) => {
        lines.push(`${r.tag} (${r.category}): ${r.prompt}`);
      });
      lines.push('');
    }
    if (doc.clip1Line1LocationTime || doc.clip1Line2Hook) {
      lines.push(`--- ETAPA 7: TEXTO EN PANTALLA CLIP 1 (PRIMEROS 6s) ---`);
      lines.push(`${doc.clip1Line1LocationTime}\n${doc.clip1Line2Hook}\n`);
    }
    if (doc.clips?.length > 0) {
      lines.push(`--- ETAPA 8: PROMPTS DE IMÁGENES INICIALES Y CLIPS ---`);
      lines.push(doc.operationalHeader || DEFAULT_OPERATIONAL_HEADER);
      lines.push('');
      doc.clips.forEach((c) => {
        lines.push(`[Clip ${String(c.clipNumber).padStart(2, '0')} | ${c.timeRange}]`);
        if (c.imagePrompt) lines.push(c.imagePrompt);
        if (c.videoPrompt) lines.push(c.videoPrompt);
        lines.push('');
      });
    }
    if (doc.sunoTracks?.length > 0 || doc.rawSunoText) {
      lines.push(`--- ETAPA 10: BANDA SONORA (SUNO) ---`);
      if (doc.sunoTracks?.length > 0) {
        doc.sunoTracks.forEach((t) => {
          lines.push(`1. Título: ${t.title}`);
          lines.push(`2. Duración: ${t.duration}`);
          lines.push(`3. De dónde a dónde cubre: ${t.videoTimeRange}`);
          lines.push(`4. Prompt de Lyrics: ${t.lyricsPrompt}`);
          lines.push(`5. Prompt de Style: ${t.stylePrompt}`);
          lines.push(`6. Explicación: ${t.explanation}\n`);
        });
      } else {
        lines.push(doc.rawSunoText);
      }
      lines.push('');
    }
    if (
      doc.rawYoutubeMetadata ||
      doc.rawFacebookMetadata ||
      doc.rawMetadataText ||
      doc.publishDescription ||
      doc.pinnedComment ||
      doc.youtubeTags
    ) {
      lines.push(`--- ETAPA 11: METADATA DE PUBLICACIÓN ---`);
      if (doc.rawYoutubeMetadata || doc.rawMetadataText) {
        lines.push(`[1. METADATA YOUTUBE]`);
        lines.push(doc.rawYoutubeMetadata || doc.rawMetadataText);
        lines.push('');
      }
      if (doc.rawFacebookMetadata) {
        lines.push(`[2. METADATA FACEBOOK]`);
        lines.push(doc.rawFacebookMetadata);
        lines.push('');
      }
      if (doc.pinnedComment) {
        lines.push(`[3. COMENTARIO FIJADO DEL VIDEO]`);
        lines.push(doc.pinnedComment);
        lines.push('');
      }
      if (doc.youtubeTags) {
        lines.push(`[4. TAGS DE YOUTUBE]`);
        lines.push(doc.youtubeTags);
        lines.push('');
      }
    }

    const safeTitle = (doc.title || 'Documental').replace(/[^a-zA-Z0-9_-]/g, '_');
    triggerFileDownload(lines.join('\n'), `${safeTitle}_Expediente_Completo.txt`, 'text/plain;charset=utf-8');
  };

  // Voiceover metrics calculation for Stage 4 (recognizes [1s], [2s], [2], [2}, [pausa: 2s], etc.)
  const voiceoverMetrics = useMemo(() => {
    const raw = activeDoc?.voiceoverScript || '';
    if (!raw.trim())
      return { cleanChars: 0, words: 0, pauseCount: 0, pauseSeconds: 0, spokenSeconds: 0, totalSeconds: 0 };
    const pauseInfo = extractPausesInfo(raw);
    const cleanText = stripPauseTags(raw).trim();
    const cleanChars = cleanText.length;
    const words = cleanText ? cleanText.split(/\s+/).filter(Boolean).length : 0;
    const spokenSeconds = Math.round(cleanChars / 15); // 15 chars/sec standard
    return {
      cleanChars,
      words,
      pauseCount: pauseInfo.count,
      pauseSeconds: pauseInfo.totalSeconds,
      spokenSeconds,
      totalSeconds: Math.round(spokenSeconds + pauseInfo.totalSeconds),
    };
  }, [activeDoc?.voiceoverScript]);

  // ============================================================================
  // PASSWORD SCREEN (ACCESO PRIVADO)
  // ============================================================================
  if (!isAuthenticated) {
    return (
      <div className="min-h-screen bg-slate-950 flex items-center justify-center text-slate-100 relative p-4">
        <div className="fixed bottom-2 right-3 text-[11px] text-amber-300/90 font-mono bg-slate-900/95 px-2.5 py-0.5 rounded border border-amber-500/30 z-50 pointer-events-none">
          Actualizado: {LAST_UPDATED_TEXT}
        </div>
        <form
          onSubmit={handleLogin}
          className="bg-slate-900/90 p-8 rounded-2xl border border-amber-500/30 shadow-2xl flex flex-col items-center gap-4 max-w-sm w-full"
        >
          <div className="w-12 h-12 rounded-xl bg-amber-500/15 border border-amber-500/40 flex items-center justify-center text-amber-400">
            <Film className="w-6 h-6" />
          </div>
          <div className="text-center">
            <h1 className="text-xl font-bold tracking-wide text-amber-300 uppercase">Huellas Master</h1>
            <p className="text-xs text-slate-400 mt-0.5">Acceso Privado — Estudio Integral Documental</p>
          </div>
          <input
            type="password"
            name="password"
            placeholder="Contraseña"
            autoFocus
            value={passwordInput}
            onChange={(e) => setPasswordInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' || e.key === 'NumpadEnter' || e.keyCode === 13) {
                e.preventDefault();
                if (e.currentTarget.value.trim() === 'admin123' || passwordInput.trim() === 'admin123') {
                  localStorage.setItem('huellas_master_auth', 'true');
                  setIsAuthenticated(true);
                }
              }
            }}
            className="w-full bg-slate-950 border border-slate-700 focus:border-amber-500 rounded-lg px-4 py-2.5 text-slate-100 outline-none"
          />
          <button
            type="submit"
            onClick={() => handleLogin()}
            className="w-full bg-amber-500 hover:bg-amber-400 text-slate-950 font-bold py-2.5 rounded-lg transition cursor-pointer"
          >
            Entrar al Estudio
          </button>
          <span className="text-[11px] text-slate-500 font-mono">Actualizado: {LAST_UPDATED_TEXT}</span>
        </form>
      </div>
    );
  }

  const filteredDocs = documentaries.filter((d) => {
    const matchesSearch =
      !searchQuery.trim() ||
      d.title.toLowerCase().includes(searchQuery.toLowerCase()) ||
      (d.topic || '').toLowerCase().includes(searchQuery.toLowerCase()) ||
      (d.historicalLocation || '').toLowerCase().includes(searchQuery.toLowerCase());
    const matchesStatus = statusFilter === 'ALL' || d.status === statusFilter;
    return matchesSearch && matchesStatus;
  });

  return (
    <div className="min-h-screen bg-[#0b0a09] text-slate-100 flex flex-col">
      {/* Global Deployment Verification Timestamp Badge */}
      <div className="fixed bottom-2 right-3 text-[11px] text-amber-300/90 font-mono bg-slate-900/95 px-2.5 py-0.5 rounded border border-amber-500/30 z-50 pointer-events-none">
        Actualizado: {LAST_UPDATED_TEXT}
      </div>

      {/* TOP NAVIGATION BAR */}
      <header className="sticky top-0 z-40 bg-[#12100e]/95 backdrop-blur border-b border-amber-500/20 px-3 sm:px-5 py-2.5 sm:py-3 flex items-center justify-between gap-3 flex-wrap">
        <div className="flex items-center gap-3">
          <button
            onClick={() => setMainView('dashboard')}
            className="flex items-center gap-2.5 text-left group cursor-pointer"
          >
            <div className="w-9 h-9 rounded-lg bg-amber-500/15 border border-amber-500/40 flex items-center justify-center text-amber-400 group-hover:bg-amber-500 group-hover:text-slate-950 transition shrink-0">
              <Film className="w-5 h-5" />
            </div>
            <div>
              <div className="flex items-center gap-2 flex-wrap">
                <span className="font-bold tracking-wider text-amber-300 uppercase text-sm">
                  Huellas Master
                </span>
                <span className="text-[10px] bg-amber-500/20 text-amber-300 px-2 py-0.5 rounded-full border border-amber-500/30 font-semibold">
                  {isCloudMode ? '📱 Nube Móvil + GitHub' : '💻 Laptop + Nube GitHub'}
                </span>
              </div>
              <p className="text-[11px] text-slate-400 hidden sm:block">
                Prompt Maestro + VoxFlow + Narration Timeline Extractor + Corrector .SRT
              </p>
            </div>
          </button>
        </div>

        {/* Navigation Pills */}
        <div className="flex items-center gap-1.5 sm:gap-2 flex-wrap">
          <button
            onClick={() => setMainView('dashboard')}
            className={`px-2.5 sm:px-3.5 py-1.5 rounded-lg text-xs font-semibold flex items-center gap-1.5 transition cursor-pointer ${
              mainView === 'dashboard'
                ? 'bg-amber-500 text-slate-950 shadow'
                : 'bg-slate-900 text-slate-300 hover:bg-slate-800 border border-slate-800'
            }`}
          >
            <FolderOpen className="w-3.5 h-3.5" />
            <span>Documentales ({documentaries.length})</span>
          </button>

          {activeDoc && (
            <button
              onClick={() => setMainView('studio')}
              className={`px-2.5 sm:px-3.5 py-1.5 rounded-lg text-xs font-semibold flex items-center gap-1.5 transition cursor-pointer ${
                mainView === 'studio'
                  ? 'bg-amber-500 text-slate-950 shadow'
                  : 'bg-slate-900 text-amber-300 hover:bg-slate-800 border border-amber-500/30'
              }`}
            >
              <Sparkles className="w-3.5 h-3.5" />
              <span className="truncate max-w-[140px] sm:max-w-[220px]">
                Estudio: {activeDoc.title}
              </span>
            </button>
          )}

          <button
            onClick={() => setMainView('standalone_prompt')}
            className={`px-2.5 sm:px-3.5 py-1.5 rounded-lg text-xs font-semibold flex items-center gap-1.5 transition cursor-pointer ${
              mainView === 'standalone_prompt'
                ? 'bg-amber-500 text-slate-950 shadow'
                : 'bg-slate-900 text-slate-300 hover:bg-slate-800 border border-slate-800'
            }`}
          >
            <Sliders className="w-3.5 h-3.5" />
            <span>Prompt Maestro</span>
          </button>

          <button
            onClick={() => setMainView('capcut_editor')}
            className={`px-2.5 sm:px-3.5 py-1.5 rounded-lg text-xs font-black flex items-center gap-1.5 transition cursor-pointer border ${
              mainView === 'capcut_editor'
                ? 'bg-amber-500 text-slate-950 border-amber-400 shadow-lg shadow-amber-500/20'
                : 'bg-amber-500/15 text-amber-300 hover:bg-amber-500/25 border-amber-500/40'
            }`}
            title="Abrir el Estudio de Montaje Multipista estilo CapCut (Clips, Voz, Logo Oficial, Música Suno, Captions, Transiciones y Exportación HD/2K/4K/8K en 16:9 y 9:16)"
          >
            <Film className="w-3.5 h-3.5" />
            <span>🎬 Editor CapCut</span>
          </button>

          {activeDoc && (
            <button
              onClick={() => {
                if (mainView !== 'studio') setMainView('studio');
                setShowWebStudio((prev) => !prev);
              }}
              className={`px-2.5 sm:px-3.5 py-1.5 rounded-lg text-xs font-semibold flex items-center gap-1.5 border transition cursor-pointer ${
                showWebStudio
                  ? 'bg-emerald-500 text-slate-950 border-emerald-400 shadow-lg shadow-emerald-500/20'
                  : 'bg-emerald-950/60 border-emerald-700/60 text-emerald-300 hover:bg-emerald-900/60'
              }`}
              title="Abrir panel incrustado de Gemini Web y Google Flow para generar texto, imágenes y clips usando tu cuota web gratis (sin gastar API Key)"
            >
              <Globe className="w-3.5 h-3.5" />
              <span>Estudio Web (Gratis)</span>
              <span
                className={`w-2 h-2 rounded-full ${
                  extensionInstalled
                    ? showWebStudio
                      ? 'bg-slate-950'
                      : 'bg-emerald-400'
                    : 'bg-amber-400 animate-pulse'
                }`}
              />
            </button>
          )}

          <button
            onClick={() => setShowKeyModal(true)}
            className={`px-2.5 sm:px-3 py-1.5 rounded-lg text-xs font-medium flex items-center gap-1.5 border transition cursor-pointer ${
              serverStatus?.hasGeminiKey
                ? 'bg-emerald-950/50 border-emerald-700/50 text-emerald-300'
                : 'bg-rose-950/60 border-rose-700/60 text-rose-300'
            }`}
            title="Configurar API Key de Gemini y Enlace Mágico para Teléfono"
          >
            <Key className="w-3.5 h-3.5" />
            <span>{serverStatus?.hasGeminiKey ? 'IA / Móvil' : 'Configurar IA'}</span>
          </button>
        </div>
      </header>

      {cloudStatusMsg && (
        <div className="bg-sky-950/80 border-b border-sky-500/30 px-4 py-1.5 text-xs text-sky-200 flex items-center justify-between">
          <span>{cloudStatusMsg}</span>
          <button
            onClick={() => setCloudStatusMsg('')}
            className="text-sky-400 hover:text-white ml-4 cursor-pointer"
          >
            ✕
          </button>
        </div>
      )}

      {/* API KEY & MOBILE CLOUD SYNC MODAL */}
      {showKeyModal && (
        <div className="fixed inset-0 z-50 bg-black/75 flex items-center justify-center p-4">
          <div className="bg-slate-900 border border-amber-500/30 rounded-2xl max-w-lg w-full p-6 space-y-4 shadow-2xl max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between">
              <h3 className="font-bold text-amber-300 flex items-center gap-2">
                <Key className="w-4 h-4" /> Conexión de IA y Acceso en Teléfono (GitHub)
              </h3>
              <button
                onClick={() => setShowKeyModal(false)}
                className="text-slate-400 hover:text-white text-sm cursor-pointer"
              >
                ✕
              </button>
            </div>

            <div className="bg-amber-500/10 border border-amber-500/30 rounded-xl p-3.5 space-y-2">
              <div className="text-xs font-bold text-amber-300">
                📱 Enlace Público para tu Teléfono (GitHub Pages):
              </div>
              <div className="text-[11px] font-mono text-slate-200 break-all bg-slate-950 px-2.5 py-1.5 rounded border border-slate-800">
                {PUBLIC_GITHUB_PAGES_URL}
              </div>
              <button
                onClick={async () => {
                  try {
                    if (!isCloudMode) {
                      const res = await fetch('/api/cloud/setup-link');
                      if (res.ok) {
                        const data = await res.json();
                        if (data.url) {
                          await navigator.clipboard.writeText(data.url);
                          alert(
                            '✅ ¡Enlace Mágico copiado al portapapeles!\n\nEnvíatelo por WhatsApp/iMessage y ábrelo una sola vez en tu teléfono: configurará automáticamente tu Gemini API Key y tu sincronización con GitHub.'
                          );
                          return;
                        }
                      }
                    }
                    const g = apiKeyInput.trim() || getBrowserGeminiKey();
                    const h = ghTokenInput.trim() || getBrowserGitHubToken();
                    if (!g && !h) {
                      alert('Ingresa primero tu Gemini API Key o GitHub Token abajo.');
                      return;
                    }
                    const link = buildMobileSetupLink(g, h);
                    await navigator.clipboard.writeText(link);
                    alert('✅ ¡Enlace Mágico copiado al portapapeles!');
                  } catch (e: any) {
                    alert('No se pudo copiar el enlace: ' + e.message);
                  }
                }}
                className="w-full py-2 px-3 rounded-lg bg-amber-500 hover:bg-amber-400 text-slate-950 font-bold text-xs cursor-pointer transition"
              >
                📲 Copiar Enlace Mágico para mi Teléfono (1-Clic con Llaves Incluidas)
              </button>
            </div>

            <p className="text-xs text-slate-300 leading-relaxed">
              Si estás en tu teléfono o deseas actualizar manualmente tus llaves en este navegador, ingrésalas aquí:
            </p>
            {serverStatus?.maskedKey && (
              <div className="text-xs bg-emerald-950/40 border border-emerald-700/40 text-emerald-300 px-3 py-2 rounded-lg font-mono">
                Gemini Key activa: {serverStatus.maskedKey}
              </div>
            )}
            <div className="space-y-2">
              <label className="block text-[11px] text-slate-400 font-semibold">
                Gemini API Key (para generar guiones, clips, respuestas y voz TTS):
              </label>
              <input
                type="password"
                placeholder="AIzaSy..."
                value={apiKeyInput}
                onChange={(e) => setApiKeyInput(e.target.value)}
                className="w-full bg-slate-950 border border-slate-700 rounded-lg px-3 py-2 text-sm text-white"
              />
            </div>
            <div className="space-y-2">
              <label className="block text-[11px] text-slate-400 font-semibold">
                GitHub Personal Access Token (Opcional en móvil — para guardar cambios desde el teléfono a GitHub):
              </label>
              <input
                type="password"
                placeholder="ghp_... (Ya configurado si usaste el Enlace Mágico)"
                value={ghTokenInput}
                onChange={(e) => setGhTokenInput(e.target.value)}
                className="w-full bg-slate-950 border border-slate-700 rounded-lg px-3 py-2 text-sm text-white"
              />
            </div>
            <div className="flex justify-end gap-2 pt-2">
              <button
                onClick={() => setShowKeyModal(false)}
                className="px-4 py-2 rounded-lg text-xs bg-slate-800 text-slate-300 cursor-pointer"
              >
                Cerrar
              </button>
              <button
                onClick={async () => {
                  const g = apiKeyInput.trim();
                  const h = ghTokenInput.trim();
                  saveBrowserCredentials(g, h);
                  if (g && !isCloudMode) {
                    try {
                      await fetch('/api/settings/gemini-key', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ key: g }),
                      });
                    } catch {}
                  }
                  setApiKeyInput('');
                  setGhTokenInput('');
                  await fetchAllData();
                  setShowKeyModal(false);
                }}
                className="px-4 py-2 rounded-lg text-xs font-bold bg-amber-500 text-slate-950 cursor-pointer"
              >
                Guardar Configuración
              </button>
            </div>
          </div>
        </div>
      )}

      {/* =====================================================================
          VIEW 1: DASHBOARD DE DOCUMENTALES
      ===================================================================== */}
      {(mainView === 'dashboard' || (mainView === 'studio' && !activeDoc)) && (
        <main className="max-w-7xl w-full mx-auto px-6 py-8 flex-1 space-y-6">
          {/* Hero Banner */}
          <div className="bg-gradient-to-r from-[#191510] via-[#211b13] to-[#16130f] border border-amber-500/30 rounded-2xl p-6 flex flex-col md:flex-row items-start md:items-center justify-between gap-4 shadow-xl">
            <div className="space-y-1.5">
              <h2 className="text-2xl font-bold text-amber-300 tracking-wide">
                Biblioteca de Producción — Huellas de la Humanidad
              </h2>
              <p className="text-sm text-slate-300 max-w-2xl">
                Organiza cada documental de principio a fin: genera el Prompt Maestro, escribe el guion, crea
                la locución en <strong className="text-amber-300">VoxFlow</strong>, extrae los tiempos exactos
                con <strong className="text-amber-300">Timeline Extractor</strong>, controla tus lotes de clips,
                corrige el <strong className="text-amber-300">.SRT de CapCut</strong> y guarda las pistas de
                Suno y Metadata.
              </p>
            </div>
            <button
              onClick={handleCreateDocumentary}
              className="px-5 py-3 rounded-xl bg-amber-500 hover:bg-amber-400 text-slate-950 font-bold text-sm flex items-center gap-2 shadow-lg shrink-0 transition cursor-pointer"
            >
              <Plus className="w-5 h-5" />
              Nuevo Documental
            </button>
          </div>

          {/* Search & Filters */}
          <div className="flex flex-col sm:flex-row gap-3 items-stretch sm:items-center justify-between">
            <div className="relative flex-1 max-w-md">
              <Search className="w-4 h-4 text-slate-400 absolute left-3.5 top-1/2 -translate-y-1/2" />
              <input
                type="text"
                placeholder="Buscar documental por título, tema, época o lugar..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="w-full bg-slate-900/90 border border-slate-800 focus:border-amber-500/60 rounded-xl pl-10 pr-4 py-2 text-sm text-slate-100 outline-none"
              />
            </div>
            <div className="flex items-center gap-2 flex-wrap">
              <button
                onClick={() => setStatusFilter('ALL')}
                className={`px-3 py-1.5 rounded-lg text-xs font-medium cursor-pointer ${
                  statusFilter === 'ALL'
                    ? 'bg-amber-500/20 text-amber-300 border border-amber-500/40'
                    : 'bg-slate-900 text-slate-400 border border-slate-800'
                }`}
              >
                Todos ({documentaries.length})
              </button>
              {STATUS_OPTIONS.map((st) => (
                <button
                  key={st.value}
                  onClick={() => setStatusFilter(st.value)}
                  className={`px-3 py-1.5 rounded-lg text-xs font-medium cursor-pointer ${
                    statusFilter === st.value
                      ? 'bg-amber-500/20 text-amber-300 border border-amber-500/40'
                      : 'bg-slate-900 text-slate-400 border border-slate-800'
                  }`}
                >
                  {st.label}
                </button>
              ))}
            </div>
          </div>

          {/* Documentary Cards Grid */}
          {filteredDocs.length === 0 ? (
            <div className="bg-[#14120f] border border-dashed border-amber-500/30 rounded-2xl p-12 text-center space-y-4">
              <Film className="w-12 h-12 text-amber-400/60 mx-auto" />
              <div className="space-y-1">
                <h3 className="text-lg font-bold text-slate-200">
                  Aún no hay documentales en esta vista
                </h3>
                <p className="text-xs text-slate-400 max-w-md mx-auto">
                  Crea tu primer expediente documental para tener guion, locución VoxFlow, Timeline, referencias,
                  clips, SRT, Suno y metadata organizados en un solo lugar.
                </p>
              </div>
              <button
                onClick={handleCreateDocumentary}
                className="px-5 py-2.5 rounded-xl bg-amber-500 hover:bg-amber-400 text-slate-950 font-bold text-xs inline-flex items-center gap-2 cursor-pointer"
              >
                <Plus className="w-4 h-4" /> Crear Primer Documental
              </button>
            </div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5">
              {filteredDocs.map((doc) => {
                const prog = calculateProgress(doc);
                const statusObj =
                  STATUS_OPTIONS.find((s) => s.value === doc.status) || STATUS_OPTIONS[0];
                const formatObj =
                  PRODUCTION_TYPES.find((p) => p.value === doc.productionType) ||
                  PRODUCTION_TYPES[0];

                return (
                  <div
                    key={doc.id}
                    onClick={() => {
                      setActiveDocId(doc.id);
                      setMainView('studio');
                    }}
                    className="group bg-[#14120f] hover:bg-[#1a1713] border border-slate-800 hover:border-amber-500/50 rounded-2xl overflow-hidden flex flex-col justify-between transition shadow-lg cursor-pointer"
                  >
                    <div>
                      {/* Thumbnail / Cover Header */}
                      <div className="h-36 bg-gradient-to-br from-slate-900 via-[#1d1812] to-slate-950 relative overflow-hidden border-b border-slate-800/80 flex items-center justify-center">
                        {doc.thumbnailImageUrl ? (
                          <img
                            src={doc.thumbnailImageUrl}
                            alt={doc.title}
                            className="w-full h-full object-cover"
                          />
                        ) : (
                          <div className="text-center px-4">
                            <p className="text-[11px] uppercase tracking-widest text-amber-400/80 font-mono">
                              {doc.historicalTime || 'Época por definir'} •{' '}
                              {doc.historicalLocation || 'Lugar por definir'}
                            </p>
                            <p className="text-sm font-semibold text-slate-300 mt-1 line-clamp-2">
                              {doc.clip1Line2Hook || doc.topic || doc.title}
                            </p>
                          </div>
                        )}
                        <div className="absolute top-2.5 left-2.5 flex items-center gap-1.5">
                          <span className="text-[10px] font-bold px-2.5 py-0.5 rounded-full bg-black/80 text-amber-300 border border-amber-500/40">
                            {formatObj.badge}
                          </span>
                        </div>
                        <div className="absolute top-2.5 right-2.5">
                          <span
                            className={`text-[10px] font-semibold px-2.5 py-0.5 rounded-full border ${statusObj.color}`}
                          >
                            {statusObj.label}
                          </span>
                        </div>
                      </div>

                      {/* Body */}
                      <div className="p-5 space-y-3">
                        <div>
                          <h3 className="font-bold text-base text-slate-100 group-hover:text-amber-300 transition line-clamp-1">
                            {doc.title}
                          </h3>
                          <p className="text-xs text-slate-400 line-clamp-1 mt-0.5">
                            {doc.topic || 'Sin tema específico aún'}
                          </p>
                        </div>

                        {/* Quick counters */}
                        <div className="grid grid-cols-4 gap-1.5 pt-1 text-center">
                          <div className="bg-slate-900/90 rounded-lg py-1.5 px-1 border border-slate-800/80">
                            <div className="text-xs font-bold text-amber-300">
                              {doc.audioTracks?.length || 0}
                            </div>
                            <div className="text-[10px] text-slate-400">Audios</div>
                          </div>
                          <div className="bg-slate-900/90 rounded-lg py-1.5 px-1 border border-slate-800/80">
                            <div className="text-xs font-bold text-amber-300">
                              {doc.references?.length || 0}
                            </div>
                            <div className="text-[10px] text-slate-400">Refs @</div>
                          </div>
                          <div className="bg-slate-900/90 rounded-lg py-1.5 px-1 border border-slate-800/80">
                            <div className="text-xs font-bold text-amber-300">
                              {doc.clips?.filter((c) => c.videoReady).length || 0}/
                              {doc.clips?.length || 0}
                            </div>
                            <div className="text-[10px] text-slate-400">Clips</div>
                          </div>
                          <div className="bg-slate-900/90 rounded-lg py-1.5 px-1 border border-slate-800/80">
                            <div className="text-xs font-bold text-amber-300">
                              {doc.sunoTracks?.length || 0}
                            </div>
                            <div className="text-[10px] text-slate-400">Suno</div>
                          </div>
                        </div>

                        {/* Progress bar */}
                        <div className="space-y-1 pt-1">
                          <div className="flex justify-between text-[11px] text-slate-400">
                            <span>
                              Avance: {prog.completed}/{prog.total} etapas
                            </span>
                            <span className="text-amber-300 font-bold">{prog.pct}%</span>
                          </div>
                          <div className="w-full h-1.5 bg-slate-800 rounded-full overflow-hidden">
                            <div
                              className="h-full bg-amber-500 transition-all"
                              style={{ width: `${prog.pct}%` }}
                            />
                          </div>
                        </div>
                      </div>
                    </div>

                    {/* Card Footer */}
                    <div className="px-5 py-3 bg-slate-950/60 border-t border-slate-800/80 flex items-center justify-between text-xs">
                      <span className="text-[11px] text-slate-500">
                        {new Date(doc.updatedAt).toLocaleDateString('es-ES', {
                          day: '2-digit',
                          month: 'short',
                          hour: '2-digit',
                          minute: '2-digit',
                        })}
                      </span>
                      <div className="flex items-center gap-1.5">
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            handleExportDocumentaryDossier(doc);
                          }}
                          className="p-1.5 rounded-lg hover:bg-slate-800 text-slate-400 hover:text-amber-300"
                          title="Descargar Expediente Completo (.txt)"
                        >
                          <Download className="w-3.5 h-3.5" />
                        </button>
                        <button
                          onClick={(e) => handleDuplicateDocumentary(doc.id, e)}
                          className="p-1.5 rounded-lg hover:bg-slate-800 text-slate-400 hover:text-slate-200"
                          title="Duplicar Documental"
                        >
                          <Copy className="w-3.5 h-3.5" />
                        </button>
                        <button
                          onClick={(e) => handleDeleteDocumentary(doc.id, e)}
                          className="p-1.5 rounded-lg hover:bg-rose-950 text-slate-400 hover:text-rose-400"
                          title="Eliminar Documental"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </main>
      )}

      {/* =====================================================================
          VIEW 2: STANDALONE PROMPT MAESTRO VIEW
      ===================================================================== */}
      {mainView === 'standalone_prompt' && (
        <div className="flex-1 py-4">
          <PromptGenerator />
        </div>
      )}

      {/* =====================================================================
          VIEW 2B: CAPCUT MULTI-TRACK EDITOR (CLIPS, VOICE, LOGO, SUNO, CAPTIONS)
      ===================================================================== */}
      {mainView === 'capcut_editor' && (
        <CapCutEditor
          activeDoc={activeDoc}
          updateActiveDoc={updateActiveDoc}
          capturedClipVideosMap={capturedClipVideosMap}
          capturedSunoAudioMap={capturedSunoAudioMap}
          onPickDownloadFolder={handlePickFlowDownloadFolder}
          downloadFolderName={flowDownloadFolderName}
          downloadFolderPath={flowServerFolderPath}
          onSaveFileToChosenFolder={handleSaveAnyFileToChosenFolder}
          onExportOrganizedFolder={() => handleExportOrganizedProjectFolder(false)}
        />
      )}

      {/* =====================================================================
          VIEW 3: DOCUMENTARY STUDIO (MENÚ SUPERIOR HORIZONTAL + ÁREA COMPLETA)
      ===================================================================== */}
      {mainView === 'studio' && activeDoc && (
        <div className="flex-1 flex flex-col min-h-0">
          {/* TOP HORIZONTAL BAR: PROJECT CONTROLS + 12 STAGES MENU */}
          <div className="w-full bg-[#12100d] border-b border-amber-500/20 px-4 py-2.5 flex flex-col gap-2.5 shrink-0">
            {/* Row 1: Documentary Title, Type, Status, Save Indicator & Export */}
            <div className="flex flex-wrap items-center justify-between gap-2.5 bg-slate-900/90 border border-slate-800 rounded-xl px-3.5 py-2">
              <div className="flex items-center gap-2.5 flex-1 min-w-[240px]">
                <span className="text-[10px] uppercase tracking-wider text-amber-400 font-bold whitespace-nowrap px-2 py-0.5 rounded bg-amber-500/10 border border-amber-500/30">
                  Expediente Activo
                </span>
                <input
                  type="text"
                  value={activeDoc.title}
                  onChange={(e) => updateActiveDoc({ title: e.target.value })}
                  className="flex-1 min-w-[180px] max-w-md bg-slate-950 border border-slate-700 focus:border-amber-500 rounded-lg px-2.5 py-1 text-sm font-bold text-amber-200 outline-none"
                  placeholder="Título del Documental..."
                />
                <span className="hidden sm:inline-block text-[10px] text-emerald-400 font-mono whitespace-nowrap">
                  {savingStatus === 'saving' ? 'Guardando...' : '✓ Guardado'}
                </span>
              </div>

              <div className="flex flex-wrap items-center gap-2">
                {/* ITEM 4: 1-Click Full Pre-Production (Stages 1 to 9) */}
                <button
                  type="button"
                  disabled={isFullPreprodRunning}
                  onClick={handleRunFullPreproduction1To8}
                  className="py-1 px-3 rounded-lg bg-gradient-to-r from-emerald-500 to-teal-400 hover:from-emerald-400 hover:to-teal-300 disabled:opacity-60 text-slate-950 text-xs font-black flex items-center gap-1.5 transition cursor-pointer whitespace-nowrap shadow"
                  title="Genera de corrido Guion, Timeline, Subtítulos .SRT, Miniaturas A/B, @Referencias, Música Suno, todos los Pares Image/Clip y SEO YouTube en 1 clic"
                >
                  ⚡{' '}
                  {isFullPreprodRunning
                    ? fullPreprodStepMsg || 'Auto-Generando Etapas 1-9...'
                    : 'Auto-Generar Etapas 1 a 9 (1 Clic)'}
                </button>

                {/* ITEM 6: Organized Final Project Folder */}
                <button
                  type="button"
                  onClick={() => handleExportOrganizedProjectFolder(false)}
                  className="py-1 px-2.5 rounded-lg bg-purple-500/20 hover:bg-purple-500/30 border border-purple-500/40 text-purple-200 text-xs font-bold flex items-center gap-1.5 transition cursor-pointer whitespace-nowrap"
                  title="Crea en tu carpeta: /Clips_Aprobados, /Audio, /Miniaturas, Subtitulos.srt y SEO_YouTube_Copiar_Pegar.txt"
                >
                  📦 Carpeta Final YouTube
                </button>

                <select
                  value={activeDoc.productionType}
                  onChange={(e) =>
                    updateActiveDoc({ productionType: e.target.value as ProductionFormatType })
                  }
                  className="bg-slate-950 border border-slate-800 rounded-lg px-2.5 py-1 text-xs text-slate-200"
                >
                  {PRODUCTION_TYPES.map((t) => (
                    <option key={t.value} value={t.value}>
                      {t.badge}
                    </option>
                  ))}
                </select>
                <select
                  value={activeDoc.status}
                  onChange={(e) =>
                    updateActiveDoc({ status: e.target.value as DocumentaryStatusType })
                  }
                  className="bg-slate-950 border border-slate-800 rounded-lg px-2.5 py-1 text-xs text-slate-200"
                >
                  {STATUS_OPTIONS.map((s) => (
                    <option key={s.value} value={s.value}>
                      {s.label}
                    </option>
                  ))}
                </select>
                <button
                  onClick={() => handleExportDocumentaryDossier(activeDoc)}
                  className="py-1 px-3 rounded-lg bg-slate-800 hover:bg-slate-700 text-amber-300 text-xs font-semibold flex items-center gap-1.5 transition cursor-pointer whitespace-nowrap"
                >
                  <Download className="w-3.5 h-3.5" /> Exportar (.txt)
                </button>
              </div>
            </div>

            {/* Mobile Stage Selector (Compact Dropdown on Phone) */}
            <div className="md:hidden">
              <select
                value={activeStage}
                onChange={(e) => setActiveStage(Number(e.target.value))}
                className="w-full bg-slate-950 border border-amber-500/40 rounded-xl px-3 py-2 text-xs font-bold text-amber-200 outline-none"
              >
                {STAGES_LIST.map((st) => {
                  const done = isStageDone(activeDoc, st.num);
                  return (
                    <option key={st.num} value={st.num}>
                      {done ? '✓ ' : '○ '}
                      {st.title} — {st.subtitle}
                    </option>
                  );
                })}
              </select>
            </div>

            {/* Row 2: 12 Stages Horizontal Navigation Bar (Desktop & Tablet) */}
            <nav className="hidden md:grid md:grid-cols-6 xl:grid-cols-12 gap-1.5">
              {STAGES_LIST.map((st) => {
                const IconComp = st.icon;
                const done = isStageDone(activeDoc, st.num);
                const isCurrent = activeStage === st.num;
                return (
                  <button
                    key={st.num}
                    onClick={() => setActiveStage(st.num)}
                    title={`${st.title} — ${st.subtitle}`}
                    className={`px-2.5 py-2 rounded-xl flex flex-col justify-between gap-1 text-left transition cursor-pointer border ${
                      isCurrent
                        ? 'bg-amber-500 text-slate-950 border-amber-400 font-bold shadow-md shadow-amber-500/15'
                        : done
                        ? 'bg-slate-900/90 hover:bg-slate-800/90 text-slate-200 border-emerald-500/30'
                        : 'bg-slate-900/60 hover:bg-slate-900 text-slate-300 border-slate-800/80'
                    }`}
                  >
                    <div className="flex items-center justify-between gap-1 w-full">
                      <IconComp
                        className={`w-3.5 h-3.5 shrink-0 ${
                          isCurrent
                            ? 'text-slate-950'
                            : done
                            ? 'text-emerald-400'
                            : 'text-amber-400/80'
                        }`}
                      />
                      {done ? (
                        <CheckCircle2
                          className={`w-3.5 h-3.5 shrink-0 ${
                            isCurrent ? 'text-slate-950' : 'text-emerald-400'
                          }`}
                        />
                      ) : (
                        <Circle
                          className={`w-3 h-3 shrink-0 ${
                            isCurrent ? 'text-slate-900/50' : 'text-slate-700'
                          }`}
                        />
                      )}
                    </div>
                    <div className="min-w-0 w-full">
                      <div className="text-[11px] leading-tight truncate">{st.title}</div>
                      <div
                        className={`text-[9px] leading-tight truncate ${
                          isCurrent ? 'text-slate-900/80' : 'text-slate-500'
                        }`}
                      >
                        {st.subtitle}
                      </div>
                    </div>
                  </button>
                );
              })}
            </nav>
          </div>

          {/* FULL-WIDTH MAIN WORKSPACE FOR THE SELECTED STAGE */}
          <section className="flex-1 p-4 sm:p-6 overflow-y-auto space-y-5">
            {/* Stage Header Banner */}
            <div className="bg-[#16130f] border border-amber-500/25 rounded-2xl px-4 py-3 flex flex-wrap items-center justify-between gap-4">
              <div>
                <span className="text-[11px] uppercase tracking-widest text-amber-400 font-bold">
                  Etapa {activeStage} de 12 — {activeDoc.title}
                </span>
                <h2 className="text-lg sm:text-xl font-bold text-slate-100 mt-0.5">
                  {STAGES_LIST[activeStage - 1]?.title} — {STAGES_LIST[activeStage - 1]?.subtitle}
                </h2>
              </div>
              <div className="flex items-center gap-2">
                {activeStage > 1 && (
                  <button
                    onClick={() => setActiveStage((s) => s - 1)}
                    className="px-3 py-1.5 rounded-lg bg-slate-900 hover:bg-slate-800 border border-slate-700 text-xs text-slate-200 cursor-pointer"
                  >
                    ← Etapa Anterior
                  </button>
                )}
                {activeStage < 12 && (
                  <button
                    onClick={() => setActiveStage((s) => s + 1)}
                    className="px-3.5 py-1.5 rounded-lg bg-amber-500 hover:bg-amber-400 text-slate-950 font-bold text-xs flex items-center gap-1 cursor-pointer"
                  >
                    Siguiente Etapa <ChevronRight className="w-3.5 h-3.5" />
                  </button>
                )}
              </div>
            </div>

            {/* ===============================================================
                ETAPA 1: CONFIGURACIÓN Y PROMPT MAESTRO INTEGRADO
            =============================================================== */}
            {activeStage === 1 && (
              <div className="space-y-4">
                <div className="bg-amber-500/10 border border-amber-500/30 rounded-xl p-4 flex items-center justify-between gap-4 flex-wrap">
                  <p className="text-xs text-amber-200">
                    💡 Configura las opciones de tu episodio abajo y presiona{' '}
                    <strong>"📌 Guardar Prompt Maestro y Configuración en este Documental"</strong> en el
                    panel derecho para dejarlo vinculado a este expediente, o cópialo para tu chat externo.
                  </p>
                  {activeDoc.compiledMasterPrompt && (
                    <span className="text-xs bg-emerald-950/80 text-emerald-300 border border-emerald-700/50 px-3 py-1 rounded-full font-semibold">
                      ✓ Prompt Maestro guardado ({activeDoc.compiledMasterPrompt.length} car.)
                    </span>
                  )}
                </div>

                <PromptGenerator
                  key={activeDoc.id}
                  initialFormData={activeDoc.promptConfig}
                  initialVoiceover={activeDoc.voiceoverScript}
                  embedded={true}
                  onSaveToProject={(compiledPrompt: string, formDataObj: any) => {
                    updateActiveDoc({
                      compiledMasterPrompt: compiledPrompt,
                      promptConfig: formDataObj,
                      clipDurationMode:
                        formDataObj.DURACION_CLIPS === '8_SEGUNDOS' ? '8_SEGUNDOS' : '10_SEGUNDOS',
                      clip1SyncMode:
                        formDataObj.SINCRONIZACION_CLIP_1 === 'RALENTIZAR_CAPCUT'
                          ? 'RALENTIZAR_CAPCUT'
                          : 'VOZ_EN_CLIP_2',
                      clip1DurationSeconds: parseInt(formDataObj.DURACION_CLIP_1 || '6', 10) || 6,
                      clip1TextMode:
                        formDataObj.TEXTO_PANTALLA_CLIP_1 === 'IA_CLIP_1'
                          ? 'IA_CLIP_1'
                          : 'CAPCUT_MANUAL',
                    });
                    alert('✅ Prompt Maestro y configuración guardados en la ficha de este documental.');
                  }}
                  onSrtFixed={({ rawSrt, fixedSrt }: any) => {
                    updateActiveDoc({
                      capcutRawSrt: rawSrt,
                      correctedSrt: fixedSrt,
                    });
                  }}
                />
              </div>
            )}

            {/* ===============================================================
                ETAPA 2: SELECCIÓN DEL TEMA, TIPOLOGÍA Y DURACIÓN
            =============================================================== */}
            {activeStage === 2 && (
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                <div className="bg-[#14120f] border border-slate-800 rounded-2xl p-6 space-y-4">
                  <h3 className="font-bold text-amber-300 text-base">
                    Definición Histórica del Episodio
                  </h3>

                  <div>
                    <label className="block text-xs font-semibold text-slate-300 mb-1">
                      Tipología del Video (Etapa 1 del Protocolo)
                    </label>
                    <select
                      value={activeDoc.typology}
                      onChange={(e) => updateActiveDoc({ typology: e.target.value })}
                      className="w-full bg-slate-950 border border-slate-800 rounded-lg px-3 py-2 text-sm text-slate-100"
                    >
                      {TYPOLOGIES.map((t) => (
                        <option key={t} value={t}>
                          {t}
                        </option>
                      ))}
                    </select>
                  </div>

                  <div>
                    <label className="block text-xs font-semibold text-slate-300 mb-1">
                      Tema Central del Documental / Episodio
                    </label>
                    <textarea
                      rows={3}
                      value={activeDoc.topic}
                      onChange={(e) => updateActiveDoc({ topic: e.target.value })}
                      placeholder="Ej. El misterio de la Biblioteca de Alejandría y los rollos sobrevivientes..."
                      className="w-full bg-slate-950 border border-slate-800 rounded-lg p-3 text-sm text-slate-100"
                    />
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    <div>
                      <label className="block text-xs font-semibold text-slate-300 mb-1">
                        Tiempo / Época (Años en dígitos o Siglo en romanos)
                      </label>
                      <input
                        type="text"
                        value={activeDoc.historicalTime}
                        onChange={(e) => updateActiveDoc({ historicalTime: e.target.value })}
                        placeholder="Ej. Año 1888 / Siglo XII"
                        className="w-full bg-slate-950 border border-slate-800 rounded-lg px-3 py-2 text-sm text-slate-100"
                      />
                    </div>
                    <div>
                      <label className="block text-xs font-semibold text-slate-300 mb-1">
                        Lugar Histórico (Ciudad, País)
                      </label>
                      <input
                        type="text"
                        value={activeDoc.historicalLocation}
                        onChange={(e) => updateActiveDoc({ historicalLocation: e.target.value })}
                        placeholder="Ej. Whitechapel, Londres, Inglaterra"
                        className="w-full bg-slate-950 border border-slate-800 rounded-lg px-3 py-2 text-sm text-slate-100"
                      />
                    </div>
                  </div>
                </div>

                <div className="bg-[#14120f] border border-slate-800 rounded-2xl p-6 space-y-4">
                  <h3 className="font-bold text-amber-300 text-base">
                    Calibración Matemática de Duración y Clips
                  </h3>

                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className="block text-xs font-semibold text-slate-300 mb-1">
                        Duración Total Aproximada (Segundos)
                      </label>
                      <input
                        type="number"
                        min={20}
                        max={7200}
                        value={activeDoc.targetDurationSeconds}
                        onChange={(e) =>
                          updateActiveDoc({
                            targetDurationSeconds: parseInt(e.target.value || '120', 10),
                          })
                        }
                        className="w-full bg-slate-950 border border-slate-800 rounded-lg px-3 py-2 text-sm font-bold text-amber-300"
                      />
                      <span className="text-[11px] text-slate-500">
                        ~{(activeDoc.targetDurationSeconds / 60).toFixed(1)} min (duración aproximada, no rígida al segundo)
                      </span>
                    </div>

                    <div>
                      <label className="block text-xs font-semibold text-slate-300 mb-1">
                        Duración de cada Clip (desde Clip 2)
                      </label>
                      <select
                        value={activeDoc.clipDurationMode}
                        onChange={(e) =>
                          updateActiveDoc({
                            clipDurationMode: e.target.value as '10_SEGUNDOS' | '8_SEGUNDOS',
                          })
                        }
                        className="w-full bg-slate-950 border border-slate-800 rounded-lg px-3 py-2 text-sm text-slate-100"
                      >
                        <option value="10_SEGUNDOS">10 segundos por clip (1 shot de 10s)</option>
                        <option value="8_SEGUNDOS">8 segundos por clip (1 shot de 8s)</option>
                      </select>
                    </div>
                  </div>

                  {/* Clip 1 Sync & Voiceover Entry Configuration */}
                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 pt-1">
                    <div>
                      <label className="block text-xs font-semibold text-slate-300 mb-1">
                        Duración del Clip 1 (Segundos)
                      </label>
                      <input
                        type="number"
                        min={1}
                        max={30}
                        value={activeDoc.clip1DurationSeconds || (activeDoc.clip1SyncMode === 'RALENTIZAR_CAPCUT' ? 4 : 6)}
                        onChange={(e) =>
                          updateActiveDoc({
                            clip1DurationSeconds: Math.max(1, parseInt(e.target.value || '6', 10) || 6),
                          })
                        }
                        className="w-full bg-slate-950 border border-slate-800 rounded-lg px-3 py-2 text-sm font-bold text-amber-300"
                      />
                    </div>
                    <div className="sm:col-span-2">
                      <label className="block text-xs font-semibold text-slate-300 mb-1">
                        Sincronización de Clip 1 y Comienzo de Voz Narrativa
                      </label>
                      <select
                        value={activeDoc.clip1SyncMode || 'VOZ_EN_CLIP_2'}
                        onChange={(e) => {
                          const mode = e.target.value as 'RALENTIZAR_CAPCUT' | 'VOZ_EN_CLIP_2';
                          const currentC1 = activeDoc.clip1DurationSeconds || 6;
                          const nextC1 =
                            mode === 'VOZ_EN_CLIP_2' && currentC1 === 4
                              ? 6
                              : mode === 'RALENTIZAR_CAPCUT' && currentC1 === 6
                              ? 4
                              : currentC1;
                          updateActiveDoc({
                            clip1SyncMode: mode,
                            clip1DurationSeconds: nextC1,
                          });
                        }}
                        className="w-full bg-slate-950 border border-slate-800 rounded-lg px-3 py-2 text-xs text-slate-100"
                      >
                        <option value="VOZ_EN_CLIP_2">
                          El primer clip sin voz narrativa se creará de {activeDoc.clip1DurationSeconds || 6} segundos y la voz narrativa comenzará a partir de los primeros 2 segundos del segundo clip (entra en el segundo {(activeDoc.clip1DurationSeconds || 6) + 2} del video)
                        </option>
                        <option value="RALENTIZAR_CAPCUT">
                          El primer clip sin voz narrativa se creará de {activeDoc.clip1DurationSeconds || 4} segundos pero en ediciones CapCut yo le bajaré la velocidad y lo llevaré a {(activeDoc.clip1DurationSeconds || 4) + 2} segundos
                        </option>
                      </select>
                    </div>
                  </div>

                  {/* Automatic Clip Math Preview */}
                  <div className="bg-slate-950 border border-amber-500/30 rounded-xl p-4 space-y-2">
                    <div className="text-xs font-bold text-amber-300">
                      📐 Cuadre Aproximado de Clips y Entrada de Voz:
                    </div>
                    {(() => {
                      const totalSec = activeDoc.targetDurationSeconds || 120;
                      const c1Dur =
                        activeDoc.clip1DurationSeconds ||
                        (activeDoc.clip1SyncMode === 'VOZ_EN_CLIP_2' ? 6 : 4);
                      const voiceEntrySec = c1Dur + 2;
                      const clip1TimelineSec =
                        activeDoc.clip1SyncMode === 'RALENTIZAR_CAPCUT' ? c1Dur + 2 : c1Dur;
                      const step = activeDoc.clipDurationMode === '8_SEGUNDOS' ? 8 : 10;
                      const rem = Math.max(step, totalSec - clip1TimelineSec);
                      const devClipsCount = Math.max(1, Math.round(rem / step));
                      const totalClipsCount = 1 + devClipsCount;
                      const approxFinalDuration = clip1TimelineSec + devClipsCount * step;
                      const spokenTargetSec = Math.max(10, totalSec - voiceEntrySec);
                      const estChars = Math.round(spokenTargetSec * 13.5);
                      return (
                        <ul className="text-xs text-slate-300 space-y-1">
                          <li>
                            • <strong>Clip 1 (Hook sin voz):</strong> 00:00 - 00:
                            {String(clip1TimelineSec).padStart(2, '0')} (
                            {activeDoc.clip1SyncMode === 'VOZ_EN_CLIP_2'
                              ? `${c1Dur}s sin ralentizar`
                              : `${c1Dur}s ralentizado a ${clip1TimelineSec}s en CapCut`}
                            )
                          </li>
                          <li>
                            • <strong>Entrada de la Voz Narrativa:</strong>{' '}
                            <span className="text-emerald-400 font-semibold">
                              Segundo {voiceEntrySec} (00:{String(voiceEntrySec).padStart(2, '0')})
                            </span>{' '}
                            {activeDoc.clip1SyncMode === 'VOZ_EN_CLIP_2'
                              ? `(a los 2 segundos de iniciar el Clip 2 [00:${String(c1Dur).padStart(2, '0')} - 00:${String(c1Dur + step).padStart(2, '0')}])`
                              : `(justo al iniciar el Clip 2 [00:${String(clip1TimelineSec).padStart(2, '0')} - 00:${String(clip1TimelineSec + step).padStart(2, '0')}])`}
                          </li>
                          <li>
                            • <strong>Clips de desarrollo ({step}s c/u):</strong> ~{devClipsCount} clips completos de {step}s (sin forzar micro-clips de relleno)
                          </li>
                          <li>
                            • <strong>Total aproximado:</strong>{' '}
                            <span className="text-amber-300 font-bold">
                              ~{totalClipsCount} clips (~{approxFinalDuration}s — aproximado a los {totalSec}s pedidos)
                            </span>
                          </li>
                          <li>
                            • <strong>Extensión sugerida de Guion (Voz en Off):</strong> ~{estChars}{' '}
                            caracteres (a 900 car/min + pausas)
                          </li>
                        </ul>
                      );
                    })()}
                  </div>
                </div>
              </div>
            )}

            {/* ===============================================================
                ETAPA 3: ESTRUCTURA DE SECCIONES E INVESTIGACIÓN PROFUNDA
            =============================================================== */}
            {activeStage === 3 && (
              <div className="space-y-5">
                <div className="bg-[#14120f] border border-slate-800 rounded-2xl p-5 space-y-3">
                  <div className="flex items-center justify-between flex-wrap gap-2">
                    <div>
                      <h3 className="font-bold text-amber-300 text-base">
                        Copiloto IA Híbrido (Opcional) o Pegado de tu Chat Externo
                      </h3>
                      <p className="text-xs text-slate-400">
                        Puedes pegar directamente lo que te dio tu chat externo abajo, o pedirle a Gemini que
                        genere la estructura y el Prompt de Investigación Profunda ahora mismo.
                      </p>
                    </div>
                    <button
                      disabled={aiGenerating}
                      onClick={() => handleGenerateWithGemini(3)}
                      className="px-4 py-2 rounded-xl bg-amber-500 hover:bg-amber-400 disabled:opacity-50 text-slate-950 font-bold text-xs flex items-center gap-2 cursor-pointer"
                    >
                      <Wand2 className="w-4 h-4" />
                      {aiGenerating
                        ? 'Generando Etapa 3 con Gemini...'
                        : '✨ Generar Estructura e Investigación con Gemini'}
                    </button>
                  </div>
                </div>

                <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                  <div className="bg-[#14120f] border border-slate-800 rounded-2xl p-5 space-y-3">
                    <div className="flex items-center justify-between">
                      <label className="text-sm font-bold text-amber-300">
                        1. Recuento Estructural, Curiosidades y Contradicciones
                      </label>
                      <button
                        onClick={() => copyText(activeDoc.sectionsStructure, 'stage3-struct')}
                        className="text-xs text-slate-400 hover:text-amber-300 flex items-center gap-1 cursor-pointer"
                      >
                        {copiedId === 'stage3-struct' ? (
                          <Check className="w-3.5 h-3.5 text-emerald-400" />
                        ) : (
                          <Copy className="w-3.5 h-3.5" />
                        )}
                        Copiar
                      </button>
                    </div>
                    <textarea
                      rows={14}
                      value={activeDoc.sectionsStructure}
                      onChange={(e) => updateActiveDoc({ sectionsStructure: e.target.value })}
                      placeholder="Pega o genera aquí las secciones del documental, datos insólitos, contradicciones históricas y el Prompt Maestro para NotebookLM / Deep Research..."
                      className="w-full bg-slate-950 border border-slate-800 rounded-xl p-3.5 text-xs text-slate-200 font-mono leading-relaxed"
                    />
                  </div>

                  <div className="bg-[#14120f] border border-slate-800 rounded-2xl p-5 space-y-3">
                    <div className="flex items-center justify-between">
                      <label className="text-sm font-bold text-amber-300">
                        2. Resultado de la Investigación Profunda Externa (Deep Research / NotebookLM)
                      </label>
                      <button
                        onClick={() => copyText(activeDoc.deepResearchResult, 'stage3-research')}
                        className="text-xs text-slate-400 hover:text-amber-300 flex items-center gap-1 cursor-pointer"
                      >
                        {copiedId === 'stage3-research' ? (
                          <Check className="w-3.5 h-3.5 text-emerald-400" />
                        ) : (
                          <Copy className="w-3.5 h-3.5" />
                        )}
                        Copiar
                      </button>
                    </div>
                    <textarea
                      rows={14}
                      value={activeDoc.deepResearchResult}
                      onChange={(e) => updateActiveDoc({ deepResearchResult: e.target.value })}
                      placeholder="Guarda aquí toda la investigación profunda recolectada por fuera para nutrir el Guion de la Voz en Off en la Etapa 4..."
                      className="w-full bg-slate-950 border border-slate-800 rounded-xl p-3.5 text-xs text-slate-200 font-mono leading-relaxed"
                    />
                  </div>
                </div>
              </div>
            )}

            {/* ===============================================================
                ETAPA 4: GUION DE VOZ EN OFF + VOXFLOW + TIMELINE EXTRACTOR
            =============================================================== */}
            {activeStage === 4 && (
              <div className="space-y-6">
                {/* STEP 4A: VOICEOVER SCRIPT EDITOR */}
                <div className="bg-[#14120f] border border-slate-800 rounded-2xl p-6 space-y-4">
                  <div className="flex items-center justify-between flex-wrap gap-3">
                    <div>
                      <h3 className="text-base font-bold text-amber-300 flex items-center gap-2">
                        <FileText className="w-4 h-4" /> Paso 4A — Guion de la Voz en Off
                      </h3>
                      <p className="text-xs text-slate-400">
                        Escribe, pega o genera el guion con etiquetas de pausa{' '}
                        <code className="text-amber-300">[pausa: 1.5s]</code>. Este guion alimenta
                        automáticamente a <strong>VoxFlow</strong> y al <strong>Corrector .SRT</strong> de la
                        Etapa 8.
                      </p>
                    </div>
                    <div className="flex items-center gap-2 flex-wrap">
                      <button
                        disabled={aiGenerating}
                        onClick={() => handleGenerateWithGemini(4)}
                        className="px-3.5 py-2 rounded-xl bg-amber-500 hover:bg-amber-400 disabled:opacity-50 text-slate-950 font-bold text-xs flex items-center gap-1.5 cursor-pointer"
                      >
                        <Wand2 className="w-3.5 h-3.5" />
                        {aiGenerating ? 'Redactando Guion...' : '✨ Redactar Guion con Gemini'}
                      </button>
                      <button
                        onClick={() =>
                          updateActiveDoc({
                            voiceoverScript: normalizeQuantitiesToMil(activeDoc.voiceoverScript),
                          })
                        }
                        className="px-3 py-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-amber-300 text-xs font-semibold cursor-pointer"
                        title="Convierte 'setenta mil' o '70,000' a '70 mil'"
                      >
                        🔢 Normalizar a "70 mil"
                      </button>
                      <button
                        onClick={() => copyText(activeDoc.voiceoverScript, 'copy-vo')}
                        className="px-3 py-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs flex items-center gap-1 cursor-pointer"
                      >
                        {copiedId === 'copy-vo' ? (
                          <Check className="w-3.5 h-3.5 text-emerald-400" />
                        ) : (
                          <Copy className="w-3.5 h-3.5" />
                        )}
                        Copiar Guion
                      </button>
                    </div>
                  </div>

                  {/* Quick Insert Pause Bar */}
                  <div className="flex items-center justify-between flex-wrap gap-2 bg-slate-950 px-3.5 py-2 rounded-xl border border-slate-800 text-xs">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="text-slate-400">Insertar etiqueta de pausa:</span>
                      {['[pausa: 1s]', '[pausa: 1.5s]', '[pausa: 2s]', '[pausa: 3s]'].map((tag) => (
                        <button
                          key={tag}
                          onClick={() =>
                            updateActiveDoc({
                              voiceoverScript: `${activeDoc.voiceoverScript}${
                                activeDoc.voiceoverScript.endsWith(' ') ? '' : ' '
                              }${tag} `,
                            })
                          }
                          className="px-2 py-0.5 rounded bg-amber-500/15 hover:bg-amber-500/30 text-amber-300 border border-amber-500/30 font-mono text-[11px] cursor-pointer"
                        >
                          + {tag}
                        </button>
                      ))}
                    </div>
                    <div className="flex items-center gap-4 text-[11px] font-mono text-slate-300">
                      <span>
                        Palabras: <strong className="text-amber-300">{voiceoverMetrics.words}</strong>
                      </span>
                      <span>
                        Caracteres: <strong className="text-amber-300">{voiceoverMetrics.cleanChars}</strong>
                      </span>
                      <span>
                        Pausas:{' '}
                        <strong className="text-amber-300">
                          {voiceoverMetrics.pauseCount} ({voiceoverMetrics.pauseSeconds}s)
                        </strong>
                      </span>
                      <span>
                        Duración Est.:{' '}
                        <strong className="text-emerald-400">{voiceoverMetrics.totalSeconds}s</strong>
                      </span>
                    </div>
                  </div>

                  <textarea
                    rows={10}
                    value={activeDoc.voiceoverScript}
                    onChange={(e) => updateActiveDoc({ voiceoverScript: e.target.value })}
                    placeholder="Año 1888, callejón de Whitechapel, Londres, Inglaterra. [pausa: 1.5s] El laberinto donde operaba..."
                    className="w-full bg-slate-950 border border-slate-800 focus:border-amber-500/60 rounded-xl p-4 text-sm text-slate-100 leading-relaxed outline-none"
                  />
                </div>

                {/* STEP 4B & 4C SIDE BY SIDE: VOXFLOW + TIMELINE EXTRACTOR */}
                <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                  {/* STEP 4B: VOXFLOW STUDIO INTEGRATED */}
                  <div className="bg-[#14120f] border border-amber-500/30 rounded-2xl p-6 space-y-4">
                    <div className="flex items-center justify-between">
                      <div>
                        <span className="text-[10px] uppercase tracking-wider text-amber-400 font-bold">
                          App Integrada #2
                        </span>
                        <h3 className="text-base font-bold text-slate-100 flex items-center gap-2">
                          <Volume2 className="w-4 h-4 text-amber-400" /> Paso 4B — Estudio VoxFlow (Locución)
                        </h3>
                      </div>
                    </div>

                    {/* Voice & Style Selectors */}
                    <div className="grid grid-cols-2 gap-3">
                      <div>
                        <label className="block text-[11px] font-semibold text-slate-400 mb-1">
                          Voz Narrativa
                        </label>
                        <select
                          value={activeDoc.selectedVoice || 'Charon'}
                          onChange={(e) =>
                            updateActiveDoc({ selectedVoice: e.target.value as any })
                          }
                          className="w-full bg-slate-950 border border-slate-800 rounded-lg px-2.5 py-2 text-xs text-slate-100"
                        >
                          {AVAILABLE_VOICES.map((v) => (
                            <option key={v.value} value={v.value}>
                              {v.label} ({v.provider} - {v.gender})
                            </option>
                          ))}
                        </select>
                      </div>

                      <div>
                        <label className="block text-[11px] font-semibold text-slate-400 mb-1">
                          Estilo de Interpretación
                        </label>
                        <select
                          value={activeDoc.selectedStyle || 'dramatic'}
                          onChange={(e) => updateActiveDoc({ selectedStyle: e.target.value })}
                          className="w-full bg-slate-950 border border-slate-800 rounded-lg px-2.5 py-2 text-xs text-slate-100"
                        >
                          {AVAILABLE_STYLES.map((st) => (
                            <option key={st.value} value={st.value}>
                              {st.emoji} {st.label}
                            </option>
                          ))}
                        </select>
                      </div>

                      <div>
                        <label className="block text-[11px] font-semibold text-slate-400 mb-1">
                          Velocidad
                        </label>
                        <select
                          value={activeDoc.selectedSpeed || 'medium'}
                          onChange={(e) =>
                            updateActiveDoc({ selectedSpeed: e.target.value as any })
                          }
                          className="w-full bg-slate-950 border border-slate-800 rounded-lg px-2.5 py-2 text-xs text-slate-100"
                        >
                          {AVAILABLE_SPEEDS.map((sp) => (
                            <option key={sp.value} value={sp.value}>
                              {sp.label} ({sp.description})
                            </option>
                          ))}
                        </select>
                      </div>

                      <div>
                        <label className="block text-[11px] font-semibold text-slate-400 mb-1">
                          Acento / Idioma
                        </label>
                        <select
                          value={activeDoc.selectedLanguage || 'es-la'}
                          onChange={(e) => updateActiveDoc({ selectedLanguage: e.target.value })}
                          className="w-full bg-slate-950 border border-slate-800 rounded-lg px-2.5 py-2 text-xs text-slate-100"
                        >
                          {AVAILABLE_LANGUAGES.map((l) => (
                            <option key={l.value} value={l.value}>
                              {l.flag} {l.label}
                            </option>
                          ))}
                        </select>
                      </div>
                    </div>

                    {/* Generate Full Voiceover Button */}
                    <button
                      disabled={ttsGenerating}
                      onClick={() =>
                        handleSynthesizeVoxFlow(
                          activeDoc.voiceoverScript,
                          getVoiceoverAudioName(activeDoc.title)
                        )
                      }
                      className="w-full py-3 rounded-xl bg-amber-500 hover:bg-amber-400 disabled:opacity-50 text-slate-950 font-bold text-xs flex items-center justify-center gap-2 shadow cursor-pointer"
                    >
                      <Volume2 className="w-4 h-4" />
                      {ttsGenerating
                        ? `Sintetizando "${getVoiceoverAudioName(activeDoc.title)}" en VoxFlow...`
                        : `🎙️ Generar "${getVoiceoverAudioName(activeDoc.title)}" en VoxFlow`}
                    </button>

                    {/* Optional Fragment Generator */}
                    <details className="bg-slate-950/80 border border-slate-800 rounded-xl p-3">
                      <summary className="text-xs font-semibold text-slate-300 cursor-pointer">
                        ➕ ¿Generar un párrafo o fragmento individual por separado?
                      </summary>
                      <div className="mt-3 space-y-2">
                        <input
                          type="text"
                          value={ttsCustomLabel}
                          onChange={(e) => setTtsCustomLabel(e.target.value)}
                          placeholder="Etiqueta del bloque (ej. Parte 1: Introducción)"
                          className="w-full bg-slate-900 border border-slate-800 rounded-lg px-2.5 py-1.5 text-xs text-slate-100"
                        />
                        <textarea
                          rows={3}
                          value={ttsCustomSegmentText}
                          onChange={(e) => setTtsCustomSegmentText(e.target.value)}
                          placeholder="Pega aquí el fragmento específico..."
                          className="w-full bg-slate-900 border border-slate-800 rounded-lg p-2.5 text-xs text-slate-100"
                        />
                        <button
                          disabled={ttsGenerating}
                          onClick={() =>
                            handleSynthesizeVoxFlow(
                              ttsCustomSegmentText,
                              ttsCustomLabel || `Fragmento #${(activeDoc.audioTracks?.length || 0) + 1}`
                            )
                          }
                          className="w-full py-2 rounded-lg bg-slate-800 hover:bg-slate-700 text-amber-300 font-semibold text-xs cursor-pointer"
                        >
                          Sintetizar este Fragmento
                        </button>
                      </div>
                    </details>

                    {/* Generated Audio Tracks List */}
                    <div className="space-y-2.5 pt-2">
                      <div className="flex items-center justify-between">
                        <span className="text-xs font-bold text-slate-300">
                          Audios del Documental ({activeDoc.audioTracks?.length || 0})
                        </span>
                        {(activeDoc.audioTracks?.length || 0) >= 2 && (
                          <button
                            onClick={async () => {
                              const filenames = (activeDoc.audioTracks || [])
                                .slice()
                                .reverse()
                                .map((t) => t.filename);
                              const res = await fetch('/api/tts/merge', {
                                method: 'POST',
                                headers: { 'Content-Type': 'application/json' },
                                body: JSON.stringify({
                                  filenames,
                                  text: activeDoc.voiceoverScript,
                                  voice: activeDoc.selectedVoice,
                                }),
                              });
                              if (res.ok) {
                                const merged = await res.json();
                                updateActiveDoc({
                                  audioTracks: [merged, ...(activeDoc.audioTracks || [])],
                                  masterAudioUrl: merged.audioUrl,
                                });
                              }
                            }}
                            className="text-[11px] bg-amber-500/20 hover:bg-amber-500/30 text-amber-300 px-2.5 py-1 rounded-lg border border-amber-500/40 font-semibold cursor-pointer"
                          >
                            🔗 Fusionar todas las pistas en 1 Audio Maestro
                          </button>
                        )}
                      </div>

                      {(activeDoc.audioTracks || []).length === 0 ? (
                        <div className="text-center py-6 border border-dashed border-slate-800 rounded-xl text-xs text-slate-500">
                          Aún no has generado audios para este documental.
                        </div>
                      ) : (
                        <div className="space-y-2 max-h-72 overflow-y-auto pr-1">
                          {(activeDoc.audioTracks || []).map((track) => {
                            const displayName =
                              !track.label || track.label.startsWith('Guion Completo')
                                ? getVoiceoverAudioName(activeDoc.title)
                                : track.label;
                            const cleanBaseName = displayName.replace(/\.(?:wav|mp3)$/i, '').trim();
                            const downloadName = `${cleanBaseName}.mp3`;
                            const downloadHref =
                              isCloudMode || (track.audioUrl && track.audioUrl.startsWith('data:'))
                                ? track.audioUrl
                                : `/api/tts/download-mp3?file=${encodeURIComponent(
                                    track.filename || track.audioUrl || ''
                                  )}&name=${encodeURIComponent(downloadName)}`;
                            return (
                            <div
                              key={track.id}
                              className="bg-slate-950 border border-slate-800 rounded-xl p-3 space-y-2"
                            >
                              <div className="flex items-center justify-between gap-2">
                                <div>
                                  <span className="text-xs font-bold text-amber-300">
                                    {displayName}
                                  </span>
                                  <span className="text-[11px] text-slate-400 ml-2">
                                    ({track.duration}s • {track.wordCount} palabras • {track.voice}
                                    {track.providerUsed ? ` • ${track.providerUsed}` : ''})
                                  </span>
                                </div>
                                <div className="flex items-center gap-1.5">
                                  <button
                                    disabled={timelineExtracting}
                                    onClick={() =>
                                      handleExtractTimelineFromVoxFlow(track.filename, track)
                                    }
                                    className="px-2.5 py-1 rounded-lg bg-emerald-500/20 hover:bg-emerald-500/30 text-emerald-300 border border-emerald-500/40 text-[11px] font-semibold flex items-center gap-1 cursor-pointer"
                                    title="Recalcular el timeline alineado a la duración de este audio"
                                  >
                                    <Clock className="w-3 h-3" /> ✓ Timeline Sincronizado (Recalcular)
                                  </button>
                                  <a
                                    href={downloadHref}
                                    download={downloadName}
                                    className="px-2.5 py-1 rounded-lg bg-slate-900 hover:bg-slate-800 text-amber-300 border border-amber-500/30 text-[11px] font-semibold flex items-center gap-1"
                                    title={`Descargar ${downloadName} (MP3)`}
                                  >
                                    <Download className="w-3.5 h-3.5" /> .MP3
                                  </a>
                                  <button
                                    onClick={() =>
                                      updateActiveDoc({
                                        audioTracks: activeDoc.audioTracks.filter(
                                          (t) => t.id !== track.id
                                        ),
                                      })
                                    }
                                    className="p-1.5 rounded-lg bg-slate-900 hover:bg-rose-950 text-slate-400 hover:text-rose-400 cursor-pointer"
                                  >
                                    <Trash2 className="w-3.5 h-3.5" />
                                  </button>
                                </div>
                              </div>
                              <audio controls src={track.audioUrl} className="w-full h-8" />
                            </div>
                            );
                          })}
                        </div>
                      )}
                    </div>
                  </div>

                  {/* STEP 4C: NARRATION TIMELINE EXTRACTOR INTEGRATED */}
                  <div className="bg-[#14120f] border border-amber-500/30 rounded-2xl p-6 space-y-4">
                    <div className="flex items-center justify-between flex-wrap gap-2">
                      <div>
                        <span className="text-[10px] uppercase tracking-wider text-amber-400 font-bold">
                          App Integrada #3
                        </span>
                        <h3 className="text-base font-bold text-slate-100 flex items-center gap-2">
                          <Clock className="w-4 h-4 text-amber-400" /> Paso 4C — Narration Timeline Extractor
                        </h3>
                      </div>
                      <span className="px-2.5 py-1 rounded-lg bg-emerald-500/15 border border-emerald-500/30 text-[11px] font-bold text-emerald-300">
                        ⚡ Extracción 100% Automática Activa
                      </span>
                    </div>

                    <p className="text-xs text-slate-400">
                      El Timeline y los subtítulos <code className="text-emerald-300">.SRT</code> se{' '}
                      <strong className="text-emerald-300">extraen automáticamente</strong> apenas se crea el
                      Guion o el Audio en VoxFlow (también puedes subir aquí un audio externo con silencios):
                    </p>

                    {/* Timeline Segmentation Settings */}
                    <div className="grid grid-cols-2 gap-3">
                      <div>
                        <label className="block text-[11px] font-semibold text-slate-400 mb-1">
                          Modo de Segmentación de Clips
                        </label>
                        <select
                          value={activeDoc.timelineSettings?.sentenceMode || 'split-10-seconds'}
                          onChange={async (e) => {
                            const newMode = e.target.value as any;
                            const nextSettings = {
                              ...(activeDoc.timelineSettings || {}),
                              sentenceMode: newMode,
                            } as any;
                            const audioSrc =
                              activeDoc.masterAudioUrl || activeDoc.audioTracks?.[0]?.audioUrl || '';
                            const dur = audioSrc ? await measureAudioDurationInBrowser(audioSrc) : 0;
                            const scriptText =
                              (activeDoc.voiceoverScript || '').trim() ||
                              (activeDoc.audioTracks?.[0]?.text || '').trim();
                            const autoTl = scriptText
                              ? buildSmartClientTimeline(
                                  scriptText,
                                  { ...activeDoc, timelineSettings: nextSettings },
                                  dur > 2 ? dur : undefined,
                                  newMode
                                )
                              : { sentences: [], formatted: '', srt: '' };
                            updateActiveDoc({
                              timelineSettings: nextSettings,
                              ...(autoTl.sentences.length > 0
                                ? {
                                    timelineSentences: autoTl.sentences,
                                    timelineFormattedText: autoTl.formatted,
                                    correctedSrt: autoTl.srt,
                                  }
                                : {}),
                            });
                          }}
                          className="w-full bg-slate-950 border border-slate-800 rounded-lg px-2.5 py-2 text-xs text-slate-100"
                        >
                          <option value="split-10-seconds">Cortes exactos de 10 segundos</option>
                          <option value="split-8-seconds">Cortes exactos de 8 segundos</option>
                          <option value="split-4-seconds">Cortes exactos de 4 segundos</option>
                          <option value="one-sentence-per-line">Una oración por línea</option>
                          <option value="combine-short">Combinar frases cortas</option>
                        </select>
                      </div>

                      <div>
                        <label className="block text-[11px] font-semibold text-slate-400 mb-1">
                          Subir Audio Externo (ej. con silencios de CapCut)
                        </label>
                        <label className="w-full py-2 px-3 rounded-lg bg-slate-900 hover:bg-slate-800 border border-slate-700 text-xs text-amber-300 font-semibold flex items-center justify-center gap-2 cursor-pointer">
                          <Upload className="w-3.5 h-3.5" />
                          {timelineExtracting ? 'Extrayendo Timeline...' : 'Subir Audio (.wav/.mp3/.m4a)'}
                          <input
                            type="file"
                            accept="audio/*,video/*"
                            className="hidden"
                            onChange={(e) => {
                              const f = e.target.files?.[0];
                              if (f) handleUploadAudioForTimeline(f);
                            }}
                          />
                        </label>
                      </div>
                    </div>

                    {/* Timeline Output Box */}
                    <div className="space-y-2">
                      <div className="flex items-center justify-between flex-wrap gap-2">
                        <span className="text-xs font-bold text-slate-300">
                          Timeline Extraído ({activeDoc.timelineSentences?.length || 0} bloques)
                        </span>
                        <div className="flex items-center gap-1.5 flex-wrap">
                          <button
                            onClick={() =>
                              copyText(activeDoc.timelineFormattedText, 'copy-timeline')
                            }
                            className="px-2.5 py-1 rounded-lg bg-slate-800 hover:bg-slate-700 text-xs text-slate-200 flex items-center gap-1 cursor-pointer"
                          >
                            {copiedId === 'copy-timeline' ? (
                              <Check className="w-3.5 h-3.5 text-emerald-400" />
                            ) : (
                              <Copy className="w-3.5 h-3.5" />
                            )}
                            Copiar Timeline
                          </button>
                          <button
                            onClick={() => {
                              const txtContent = (activeDoc.timelineFormattedText || '').trim();
                              if (!txtContent) {
                                alert('Primero extrae o pega el timeline para descargarlo en .TXT.');
                                return;
                              }
                              const baseName = getVoiceoverAudioName(activeDoc.title);
                              triggerFileDownload(
                                txtContent,
                                `${baseName} - Timeline.txt`,
                                'text/plain;charset=utf-8'
                              );
                            }}
                            className="px-2.5 py-1 rounded-lg bg-slate-800 hover:bg-slate-700 text-xs text-amber-300 border border-amber-500/30 flex items-center gap-1 cursor-pointer"
                            title="Descargar Timeline en archivo .TXT"
                          >
                            <Download className="w-3.5 h-3.5" /> Descargar .TXT
                          </button>
                          <button
                            onClick={() => {
                              const sentences =
                                activeDoc.timelineSentences && activeDoc.timelineSentences.length > 0
                                  ? activeDoc.timelineSentences
                                  : parseTimelineTextToSentences(activeDoc.timelineFormattedText || '');
                              if (!sentences || sentences.length === 0) {
                                alert('Primero extrae o pega un timeline con tiempos válidos para descargarlo en .SRT.');
                                return;
                              }
                              const srtContent = generateSRT(sentences);
                              const baseName = getVoiceoverAudioName(activeDoc.title);
                              triggerFileDownload(
                                srtContent,
                                `${baseName}.srt`,
                                'text/plain;charset=utf-8'
                              );
                            }}
                            className="px-2.5 py-1 rounded-lg bg-slate-800 hover:bg-slate-700 text-xs text-emerald-300 border border-emerald-500/30 flex items-center gap-1 cursor-pointer"
                            title="Descargar subtítulos del Timeline en formato .SRT"
                          >
                            <Download className="w-3.5 h-3.5" /> Descargar .SRT
                          </button>
                          {((activeDoc.timelineSentences?.length || 0) > 0 ||
                            !!activeDoc.timelineFormattedText?.trim()) && (
                            <button
                              onClick={() => {
                                const synced = syncAndAuditProductionClips({
                                  rawVoiceoverWithPauses: activeDoc.voiceoverScript || '',
                                  timelineText: activeDoc.timelineFormattedText || '',
                                  rawClipsText: activeDoc.rawClipsText || '',
                                  existingClips: activeDoc.clips || [],
                                  clip1Duration:
                                    activeDoc.clip1DurationSeconds ||
                                    (activeDoc.clip1SyncMode === 'VOZ_EN_CLIP_2' ? 6 : 4),
                                  clip1SyncMode: activeDoc.clip1SyncMode || 'RALENTIZAR_CAPCUT',
                                });
                                updateActiveDoc({ clips: synced });
                                setActiveStage(8);
                              }}
                              className="px-2.5 py-1 rounded-lg bg-amber-500 hover:bg-amber-400 text-slate-950 font-bold text-xs flex items-center gap-1 cursor-pointer"
                            >
                              Ir a 8. Producción y Armar Timeline <ArrowRight className="w-3 h-3" />
                            </button>
                          )}
                        </div>
                      </div>

                      <textarea
                        rows={10}
                        value={activeDoc.timelineFormattedText}
                        onChange={(e) =>
                          updateActiveDoc({ timelineFormattedText: e.target.value })
                        }
                        placeholder="Aquí aparecerá el timeline con timestamps (ej. 1 00:06 - 00:16 Año 1888, callejón de Whitechapel...) o puedes pegarlo directamente."
                        className="w-full bg-slate-950 border border-slate-800 rounded-xl p-3 text-xs font-mono text-emerald-300"
                      />
                    </div>
                  </div>
                </div>
              </div>
            )}

            {/* ===============================================================
                ETAPA 5: MINIATURA OFICIAL (NANO BANANA 2.1)
            =============================================================== */}
            {activeStage === 5 && (() => {
              const currentOrientation = getDefaultThumbnailOrientation(activeDoc);
              const hasOverlayText = Boolean((activeDoc.thumbnailTextOverlay || '').trim());

              const handleSelectThumbnailOrientation = (
                newOrientation: 'HORIZONTAL_16X9' | 'VERTICAL_9X16'
              ) => {
                const updatedPrompt = buildOrUpdateThumbnailPrompt(
                  activeDoc.thumbnailPrompt || '',
                  newOrientation,
                  activeDoc.thumbnailTextOverlay || '',
                  activeDoc
                );
                updateActiveDoc({
                  thumbnailOrientation: newOrientation,
                  thumbnailPrompt: updatedPrompt,
                });
              };

              const handleChangeThumbnailTextOverlay = (newText: string) => {
                if ((activeDoc.thumbnailPrompt || '').trim()) {
                  const updatedPrompt = buildOrUpdateThumbnailPrompt(
                    activeDoc.thumbnailPrompt,
                    currentOrientation,
                    newText,
                    activeDoc
                  );
                  updateActiveDoc({
                    thumbnailTextOverlay: newText,
                    thumbnailOrientation: currentOrientation,
                    thumbnailPrompt: updatedPrompt,
                  });
                } else {
                  updateActiveDoc({
                    thumbnailTextOverlay: newText,
                    thumbnailOrientation: currentOrientation,
                  });
                }
              };

              return (
                <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                  <div className="bg-[#14120f] border border-slate-800 rounded-2xl p-6 space-y-5">
                    <div className="flex items-center justify-between flex-wrap gap-3">
                      <div>
                        <h3 className="text-base font-bold text-amber-300">
                          Prompt Técnico de la Miniatura (Nano Banana 2.1)
                        </h3>
                        <p className="text-[11px] text-slate-400 mt-0.5">
                          1) Genera o escribe el texto en pantalla obligatorio y 2) selecciona Horizontal o Vertical para insertar sus características automáticamente.
                        </p>
                      </div>
                      <div className="flex items-center flex-wrap gap-2">
                        <button
                          type="button"
                          disabled={thumbOptionsGenerating}
                          onClick={handleGenerateThumbnailTextOptions}
                          className="px-3.5 py-2 rounded-xl bg-indigo-500/20 hover:bg-indigo-500/30 text-indigo-200 border border-indigo-500/40 font-bold text-xs flex items-center gap-1.5 cursor-pointer transition-all"
                          title="Generar 3 opciones de texto en pantalla (1 a 3 palabras) para la miniatura"
                        >
                          <Sparkles className="w-3.5 h-3.5 text-indigo-300" />
                          {thumbOptionsGenerating
                            ? 'Generando 3 Opciones...'
                            : '3 Opciones de Texto en Pantalla'}
                        </button>
                        <button
                          type="button"
                          disabled={aiGenerating}
                          onClick={() => handleGenerateWithGemini(5)}
                          className={`px-3.5 py-2 rounded-xl font-bold text-xs flex items-center gap-1.5 cursor-pointer transition-all ${
                            hasOverlayText
                              ? 'bg-amber-500 hover:bg-amber-400 text-slate-950 shadow-lg shadow-amber-500/20'
                              : 'bg-slate-800 hover:bg-slate-700 text-amber-300 border border-amber-500/40'
                          }`}
                          title={
                            hasOverlayText
                              ? 'Generar prompt técnico en inglés con Gemini'
                              : 'Primero debes ingresar el Texto en Pantalla en la Imagen (Obligatorio)'
                          }
                        >
                          <Wand2 className="w-3.5 h-3.5" />
                          {aiGenerating ? 'Generando Miniatura...' : 'Generar Prompt con Gemini'}
                        </button>
                      </div>
                    </div>

                    {/* PASO 1 OBLIGATORIO: TEXTO EN PANTALLA EN LA IMAGEN */}
                    <div
                      className={`p-4 rounded-xl border transition-all ${
                        hasOverlayText
                          ? 'bg-slate-950/80 border-emerald-500/40'
                          : 'bg-amber-500/5 border-amber-500/50'
                      }`}
                    >
                      <div className="flex items-center justify-between gap-2 mb-1.5">
                        <label
                          htmlFor="thumbnail-text-overlay-input"
                          className="text-xs font-bold text-amber-300 flex items-center gap-2"
                        >
                          <span>1. Texto en Pantalla en la Imagen</span>
                          <span
                            className={`text-[10px] px-2 py-0.5 rounded-full font-extrabold uppercase tracking-wider ${
                              hasOverlayText
                                ? 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/30'
                                : 'bg-rose-500/20 text-rose-300 border border-rose-500/40 animate-pulse'
                            }`}
                          >
                            {hasOverlayText ? '✓ Listo' : 'Obligatorio antes de generar'}
                          </span>
                        </label>
                        <span className="text-[11px] text-slate-400">
                          1 a 3 palabras contundentes (sin repetir Título ni Texto de los primeros 8s)
                        </span>
                      </div>
                      <input
                        id="thumbnail-text-overlay-input"
                        type="text"
                        value={activeDoc.thumbnailTextOverlay || ''}
                        onChange={(e) => handleChangeThumbnailTextOverlay(e.target.value)}
                        placeholder="Ej. EL SECRETO PROHIBIDO"
                        className="w-full bg-slate-950 border border-slate-700 focus:border-amber-400 rounded-lg px-3.5 py-2.5 text-sm font-bold text-amber-300 outline-none"
                      />
                      {(activeDoc.thumbnailTextOptions || []).length > 0 && (
                        <div className="mt-2.5 space-y-1.5">
                          <span className="block text-[11px] text-indigo-300 font-semibold">
                            Opciones sugeridas (haz clic en una para usarla en la miniatura):
                          </span>
                          <div className="flex flex-wrap gap-2">
                            {(activeDoc.thumbnailTextOptions || []).map((opt, idx) => {
                              const isSelected =
                                (activeDoc.thumbnailTextOverlay || '').trim().toUpperCase() ===
                                opt.trim().toUpperCase();
                              return (
                                <button
                                  key={idx}
                                  type="button"
                                  onClick={() => handleChangeThumbnailTextOverlay(opt)}
                                  className={`px-3 py-1.5 rounded-lg text-xs font-extrabold transition-all cursor-pointer border ${
                                    isSelected
                                      ? 'bg-amber-500 text-slate-950 border-amber-400 shadow-sm'
                                      : 'bg-slate-900 hover:bg-slate-800 text-amber-200 border-slate-700'
                                  }`}
                                >
                                  {idx + 1}. {opt}
                                </button>
                              );
                            })}
                          </div>
                        </div>
                      )}
                      {!hasOverlayText && (
                        <p className="text-[11px] text-amber-300/90 mt-1.5 font-medium">
                          ⚠️ Obligatorio: Debes proveer el texto en pantalla en la imagen (o generar las 3 opciones arriba) antes de generar el prompt de la miniatura.
                        </p>
                      )}
                    </div>

                    {/* PASO 2: DOS OPCIONES SELECCIONABLES (HORIZONTAL 16:9 VS VERTICAL 9:16) */}
                    <div className="space-y-2">
                      <div className="flex items-center justify-between">
                        <label className="text-xs font-bold text-slate-200">
                          2. Orientación de Miniatura (Inserta automáticamente sus características en el prompt):
                        </label>
                        <span className="text-[11px] text-amber-400 font-semibold">
                          Click para insertar en el prompt
                        </span>
                      </div>

                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                        {/* OPCIÓN HORIZONTAL 16:9 */}
                        <button
                          type="button"
                          onClick={() => handleSelectThumbnailOrientation('HORIZONTAL_16X9')}
                          className={`text-left p-3.5 rounded-xl border transition-all cursor-pointer flex flex-col justify-between gap-2 ${
                            currentOrientation === 'HORIZONTAL_16X9'
                              ? 'bg-amber-500/15 border-amber-400 shadow-md shadow-amber-500/10'
                              : 'bg-slate-950/80 border-slate-800 hover:border-slate-700'
                          }`}
                        >
                          <div className="flex items-center justify-between gap-2">
                            <span className="text-xs font-extrabold text-amber-300 flex items-center gap-1.5">
                              <span
                                className={`w-2.5 h-2.5 rounded-full ${
                                  currentOrientation === 'HORIZONTAL_16X9'
                                    ? 'bg-amber-400'
                                    : 'bg-slate-600'
                                }`}
                              />
                              Horizontal (16:9)
                            </span>
                            <span className="text-[10px] font-black px-2 py-0.5 rounded bg-amber-500/20 text-amber-300 border border-amber-500/30">
                              Logo Der: 8K
                            </span>
                          </div>
                          <ul className="text-[11px] text-slate-300 space-y-1 leading-snug">
                            <li>• <strong className="text-amber-200">Texto:</strong> Abajo a la izquierda</li>
                            <li>• <strong className="text-amber-200">Logo Sup. Derecho (5%):</strong> &quot;8K&quot; en dorado metálico</li>
                            <li>• <strong className="text-amber-200">Logo Sup. Izquierdo (5%):</strong> Oficial &quot;Huellas de la Humanidad&quot;</li>
                          </ul>
                        </button>

                        {/* OPCIÓN VERTICAL 9:16 */}
                        <button
                          type="button"
                          onClick={() => handleSelectThumbnailOrientation('VERTICAL_9X16')}
                          className={`text-left p-3.5 rounded-xl border transition-all cursor-pointer flex flex-col justify-between gap-2 ${
                            currentOrientation === 'VERTICAL_9X16'
                              ? 'bg-amber-500/15 border-amber-400 shadow-md shadow-amber-500/10'
                              : 'bg-slate-950/80 border-slate-800 hover:border-slate-700'
                          }`}
                        >
                          <div className="flex items-center justify-between gap-2">
                            <span className="text-xs font-extrabold text-amber-300 flex items-center gap-1.5">
                              <span
                                className={`w-2.5 h-2.5 rounded-full ${
                                  currentOrientation === 'VERTICAL_9X16'
                                    ? 'bg-amber-400'
                                    : 'bg-slate-600'
                                }`}
                              />
                              Vertical (9:16)
                            </span>
                            <span className="text-[10px] font-black px-2 py-0.5 rounded bg-amber-500/20 text-amber-300 border border-amber-500/30">
                              Logo Der: HD
                            </span>
                          </div>
                          <ul className="text-[11px] text-slate-300 space-y-1 leading-snug">
                            <li>• <strong className="text-amber-200">Texto:</strong> Centrado y justificado en el medio de la imagen</li>
                            <li>• <strong className="text-amber-200">Logo Sup. Derecho (5%):</strong> &quot;HD&quot; en dorado metálico</li>
                            <li>• <strong className="text-amber-200">Logo Sup. Izquierdo (5%):</strong> Oficial &quot;Huellas de la Humanidad&quot;</li>
                          </ul>
                        </button>
                      </div>
                    </div>

                    <div className="space-y-1.5">
                      <div className="flex justify-between items-center flex-wrap gap-2">
                        <label className="text-xs font-semibold text-slate-300">
                          Prompt en Inglés ({currentOrientation === 'VERTICAL_9X16' ? 'Vertical 9:16: Texto Centrado en el Medio + Logo HD Der' : 'Horizontal 16:9: Texto Abajo Izq + Logo 8K Der'} + Logo Oficial 5% Izq):
                        </label>
                        <div className="flex items-center gap-1.5 flex-wrap">
                          <button
                            type="button"
                            onClick={() => handleSendThumbnailsToFlowAndCapture('A')}
                            className="text-xs bg-emerald-500 hover:bg-emerald-400 text-slate-950 px-2.5 py-1 rounded font-black cursor-pointer shadow"
                            title="Envía el prompt a Google Flow (Nano Banana 2.1) y descarga automáticamente Miniatura_Opcion_A.png en tu carpeta"
                          >
                            🖼️ Auto-Crear & Descargar Miniatura A
                          </button>
                          <button
                            type="button"
                            onClick={() => handleSendThumbnailsToFlowAndCapture('B')}
                            className="text-xs bg-emerald-500/20 hover:bg-emerald-500/30 border border-emerald-500/40 text-emerald-300 px-2.5 py-1 rounded font-bold cursor-pointer"
                            title="Envía el prompt a Google Flow y descarga automáticamente Miniatura_Opcion_B.png en tu carpeta"
                          >
                            🖼️ Auto-Crear & Descargar Miniatura B
                          </button>
                          <button
                            type="button"
                            onClick={() =>
                              sendCommandToWebBridge('FLOW', {
                                action: 'SCAN_FLOW_THUMBNAILS',
                                tabId: selectedFlowTabId,
                              })
                            }
                            className="text-xs bg-slate-900 hover:bg-slate-800 border border-slate-700 text-amber-300 px-2.5 py-1 rounded font-semibold cursor-pointer"
                            title="Captura las últimas 2 imágenes de la pestaña abierta de Google Flow como Miniatura_Opcion_A.png y B.png"
                          >
                            🔍 Capturar Miniaturas de Flow
                          </button>
                          <button
                            onClick={() => copyText(activeDoc.thumbnailPrompt, 'copy-thumb')}
                            className="text-xs bg-amber-500/20 text-amber-300 px-2.5 py-1 rounded cursor-pointer"
                          >
                            {copiedId === 'copy-thumb' ? '✓ Copiado' : '📋 Copiar Prompt'}
                          </button>
                        </div>
                      </div>
                      <textarea
                        rows={8}
                        value={activeDoc.thumbnailPrompt}
                        onChange={(e) => updateActiveDoc({ thumbnailPrompt: e.target.value })}
                        placeholder="Thumbnail: Create an image ..."
                        className="w-full bg-slate-950 border border-slate-800 rounded-xl p-3 text-xs font-mono text-slate-200"
                      />
                    </div>
                  </div>

                  {/* Upload & Preview Official Thumbnail */}
                  <div className="bg-[#14120f] border border-slate-800 rounded-2xl p-6 flex flex-col justify-between gap-4">
                    <div className="flex items-center justify-between">
                      <h3 className="text-base font-bold text-amber-300">
                        Miniatura Final Guardada en el Expediente
                      </h3>
                      <span className="text-[11px] text-slate-400 font-semibold">
                        Formato activo: {currentOrientation === 'VERTICAL_9X16' ? 'Vertical 9:16 (HD)' : 'Horizontal 16:9 (8K)'}
                      </span>
                    </div>
                    <div
                      className={`${
                        currentOrientation === 'VERTICAL_9X16'
                          ? 'aspect-[9/16] max-h-[420px] mx-auto'
                          : 'aspect-video w-full'
                      } bg-slate-950 border border-dashed border-amber-500/40 rounded-xl overflow-hidden flex items-center justify-center relative`}
                    >
                      {activeDoc.thumbnailImageUrl ? (
                        <img
                          src={activeDoc.thumbnailImageUrl}
                          alt="Miniatura Oficial"
                          className="w-full h-full object-cover"
                        />
                      ) : (
                        <span className="text-xs text-slate-500 px-4 text-center">
                          Sube aquí la miniatura generada con Nano Banana 2.1
                        </span>
                      )}
                    </div>
                    <label className="w-full py-2.5 rounded-xl bg-amber-500 hover:bg-amber-400 text-slate-950 font-bold text-xs flex items-center justify-center gap-2 cursor-pointer">
                      <Upload className="w-4 h-4" /> Subir Imagen de Miniatura Oficial
                      <input
                        type="file"
                        accept="image/*"
                        className="hidden"
                        onChange={async (e) => {
                          const file = e.target.files?.[0];
                          if (!file) return;
                          const url = await uploadAssetFile(file);
                          if (url) {
                            updateActiveDoc({ thumbnailImageUrl: url, thumbnailReady: true });
                          }
                        }}
                      />
                    </label>
                  </div>
                </div>
              );
            })()}

            {/* ===============================================================
                ETAPA 6: IMÁGENES MODELO DE REFERENCIA (@PERSONAS Y LUGARES)
            =============================================================== */}
            {activeStage === 6 && (
              <div className="space-y-6">
                <div className="bg-[#14120f] border border-slate-800 rounded-2xl p-5 space-y-4">
                  <div className="flex items-center justify-between flex-wrap gap-3">
                    <div>
                      <h3 className="text-base font-bold text-amber-300">
                        Prompts de Referencia para Nano Banana 2.1 (@Personas y Lugares)
                      </h3>
                      <p className="text-xs text-slate-400">
                        Pega la respuesta de tu chat externo y presiona{' '}
                        <strong className="text-amber-300">"🔍 Auto-Detectar Tarjetas"</strong>, o genéralas
                        directamente con Gemini.
                      </p>
                    </div>
                    <div className="flex items-center gap-2 flex-wrap">
                      <button
                        disabled={aiGenerating}
                        onClick={() => handleGenerateWithGemini(6)}
                        className="px-3.5 py-2 rounded-xl bg-amber-500 hover:bg-amber-400 text-slate-950 font-bold text-xs flex items-center gap-1.5 cursor-pointer"
                      >
                        <Wand2 className="w-3.5 h-3.5" />
                        {aiGenerating ? 'Generando Referencias...' : '✨ Generar @Referencias con Gemini'}
                      </button>
                      <button
                        onClick={() => {
                          const parsed = parseReferencesFromRawText(activeDoc.rawReferencePrompts);
                          if (parsed.length === 0) {
                            alert(
                              'No se detectaron líneas con "Create an image". Asegúrate de pegar los prompts en inglés.'
                            );
                            return;
                          }
                          updateActiveDoc({ references: parsed });
                        }}
                        className="px-3.5 py-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-amber-300 font-semibold text-xs cursor-pointer"
                      >
                        🔍 Auto-Detectar Tarjetas del Texto
                      </button>
                      <button
                        onClick={() => {
                          const newRef: ReferenceAsset = {
                            id: `ref-${Date.now()}`,
                            tag: `@Personaje_${(activeDoc.references?.length || 0) + 1}`,
                            category: 'persona',
                            description: 'Nueva referencia visual',
                            prompt: `Create an image of ... (${activeDoc.historicalTime}, ${activeDoc.historicalLocation}), photorealistic 8k cinematic, no text.`,
                            isCreated: false,
                          };
                          updateActiveDoc({
                            references: [...(activeDoc.references || []), newRef],
                          });
                        }}
                        className="px-3 py-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs flex items-center gap-1 cursor-pointer"
                      >
                        <Plus className="w-3.5 h-3.5" /> Añadir Tarjeta Manual
                      </button>
                    </div>
                  </div>

                  {/* Mandatory Single-Sentence Order Box */}
                  <div className="bg-slate-950 border border-amber-500/30 rounded-xl p-3 flex items-center justify-between gap-3">
                    <code className="text-xs text-amber-300">
                      Cambia los nombres y ponles @ seguido del nombre de la persona o lugar correspondiente.
                    </code>
                    <button
                      onClick={() =>
                        copyText(
                          `Cambia los nombres y ponles @ seguido del nombre de la persona o lugar correspondiente.\n\n${activeDoc.rawReferencePrompts}`,
                          'copy-all-refs'
                        )
                      }
                      className="px-3 py-1.5 rounded-lg bg-amber-500/20 text-amber-300 text-xs font-semibold shrink-0 cursor-pointer"
                    >
                      {copiedId === 'copy-all-refs' ? '✓ Copiado' : '📋 Copiar Orden + Todos los Prompts'}
                    </button>
                  </div>

                  <textarea
                    rows={5}
                    value={activeDoc.rawReferencePrompts}
                    onChange={(e) => updateActiveDoc({ rawReferencePrompts: e.target.value })}
                    placeholder="Pega aquí los prompts de @Personas y Lugares principales..."
                    className="w-full bg-slate-950 border border-slate-800 rounded-xl p-3 text-xs font-mono text-slate-200"
                  />
                </div>

                {/* Reference Asset Cards Grid */}
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                  {(activeDoc.references || []).map((ref, idx) => (
                    <div
                      key={ref.id}
                      className={`bg-[#14120f] border rounded-2xl p-4 flex flex-col justify-between gap-3 ${
                        ref.isCreated ? 'border-emerald-500/50' : 'border-slate-800'
                      }`}
                    >
                      <div className="space-y-2.5">
                        <div className="flex items-center justify-between gap-2">
                          <input
                            type="text"
                            value={ref.tag}
                            onChange={(e) => {
                              const next = [...activeDoc.references];
                              next[idx] = { ...ref, tag: e.target.value };
                              updateActiveDoc({ references: next });
                            }}
                            className="bg-slate-950 border border-slate-800 rounded-lg px-2.5 py-1 text-xs font-bold text-amber-300 w-full"
                          />
                          <select
                            value={ref.category}
                            onChange={(e) => {
                              const next = [...activeDoc.references];
                              next[idx] = { ...ref, category: e.target.value as any };
                              updateActiveDoc({ references: next });
                            }}
                            className="bg-slate-950 border border-slate-800 rounded-lg px-2 py-1 text-[11px] text-slate-300"
                          >
                            <option value="persona">@Persona</option>
                            <option value="lugar">Lugar</option>
                          </select>
                        </div>

                        {/* Image Preview or Upload */}
                        <div className="h-36 bg-slate-950 border border-dashed border-slate-800 rounded-xl overflow-hidden flex items-center justify-center relative">
                          {ref.imageUrl ? (
                            <img
                              src={ref.imageUrl}
                              alt={ref.tag}
                              className="w-full h-full object-cover"
                            />
                          ) : (
                            <span className="text-[11px] text-slate-500">
                              Sube la imagen generada en Nano Banana 2.1
                            </span>
                          )}
                          <label className="absolute bottom-2 right-2 px-2.5 py-1 rounded-lg bg-black/80 hover:bg-black text-amber-300 text-[11px] font-semibold border border-amber-500/30 cursor-pointer flex items-center gap-1">
                            <Upload className="w-3 h-3" /> Subir Imagen
                            <input
                              type="file"
                              accept="image/*"
                              className="hidden"
                              onChange={async (e) => {
                                const file = e.target.files?.[0];
                                if (!file) return;
                                const url = await uploadAssetFile(file);
                                if (url) {
                                  const next = [...activeDoc.references];
                                  next[idx] = { ...ref, imageUrl: url, isCreated: true };
                                  updateActiveDoc({ references: next });
                                }
                              }}
                            />
                          </label>
                        </div>

                        <textarea
                          rows={4}
                          value={ref.prompt}
                          onChange={(e) => {
                            const next = [...activeDoc.references];
                            next[idx] = { ...ref, prompt: e.target.value };
                            updateActiveDoc({ references: next });
                          }}
                          className="w-full bg-slate-950 border border-slate-800 rounded-lg p-2 text-xs font-mono text-slate-300"
                        />
                      </div>

                      <div className="flex items-center justify-between pt-2 border-t border-slate-800/80">
                        <label className="flex items-center gap-1.5 text-xs text-slate-300 cursor-pointer">
                          <input
                            type="checkbox"
                            checked={ref.isCreated}
                            onChange={(e) => {
                              const next = [...activeDoc.references];
                              next[idx] = { ...ref, isCreated: e.target.checked };
                              updateActiveDoc({ references: next });
                            }}
                            className="accent-emerald-500"
                          />
                          Imagen Lista
                        </label>
                        <div className="flex items-center gap-1.5">
                          <button
                            type="button"
                            onClick={() => handleSendPromptToFlow(ref.prompt, 'IMAGE', ref.id)}
                            className="px-2.5 py-1 rounded-lg bg-emerald-500/20 hover:bg-emerald-500/30 border border-emerald-500/40 text-emerald-300 text-xs font-semibold cursor-pointer"
                            title="Enviar a Google Flow para crear imagen de referencia gratis"
                          >
                            🚀 Flow
                          </button>
                          <button
                            onClick={() => copyText(ref.prompt, `ref-${ref.id}`)}
                            className="px-2.5 py-1 rounded-lg bg-amber-500/20 text-amber-300 text-xs font-semibold cursor-pointer"
                          >
                            {copiedId === `ref-${ref.id}` ? '✓ Copiado' : 'Copiar Prompt'}
                          </button>
                          <button
                            onClick={() =>
                              updateActiveDoc({
                                references: activeDoc.references.filter((r) => r.id !== ref.id),
                              })
                            }
                            className="p-1 text-slate-500 hover:text-rose-400 cursor-pointer"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* ===============================================================
                ETAPA 7: TEXTO EN PANTALLA DEL CLIP 1 (PRIMEROS 6 SEGUNDOS)
            =============================================================== */}
            {activeStage === 7 && (
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                <div className="bg-[#14120f] border border-slate-800 rounded-2xl p-6 space-y-4">
                  <div className="flex items-center justify-between">
                    <h3 className="text-base font-bold text-amber-300">
                      Letrero Cinematográfico del Clip 1 (Primeros 6s)
                    </h3>
                    <button
                      disabled={aiGenerating}
                      onClick={() => handleGenerateWithGemini(7)}
                      className="px-3 py-1.5 rounded-lg bg-amber-500 hover:bg-amber-400 text-slate-950 font-bold text-xs flex items-center gap-1.5 cursor-pointer"
                    >
                      <Wand2 className="w-3.5 h-3.5" /> Proponer 3 Opciones con IA
                    </button>
                  </div>

                  <div>
                    <label className="block text-xs font-semibold text-slate-300 mb-1">
                      Línea 1: Ciudad, País, Tiempo (Año en dígitos o Siglo en romanos)
                    </label>
                    <input
                      type="text"
                      value={activeDoc.clip1Line1LocationTime}
                      onChange={(e) =>
                        updateActiveDoc({ clip1Line1LocationTime: e.target.value })
                      }
                      placeholder="Ej. Londres, Inglaterra, 1888"
                      className="w-full bg-slate-950 border border-slate-800 rounded-lg px-3 py-2 text-sm text-amber-200 font-semibold"
                    />
                  </div>

                  <div>
                    <label className="block text-xs font-semibold text-slate-300 mb-1">
                      Línea 2: Título Gancho Intrigante
                    </label>
                    <input
                      type="text"
                      value={activeDoc.clip1Line2Hook}
                      onChange={(e) => updateActiveDoc({ clip1Line2Hook: e.target.value })}
                      placeholder="Ej. LA SOMBRA QUE DESAFIÓ A SCOTLAND YARD"
                      className="w-full bg-slate-950 border border-slate-800 rounded-lg px-3 py-2 text-sm text-white font-bold"
                    />
                  </div>

                  <div>
                    <label className="block text-xs font-semibold text-slate-400 mb-1">
                      Propuestas / Notas de Texto en Pantalla
                    </label>
                    <textarea
                      rows={5}
                      value={activeDoc.clip1OptionsRaw}
                      onChange={(e) => updateActiveDoc({ clip1OptionsRaw: e.target.value })}
                      placeholder="Opciones propuestas por la IA..."
                      className="w-full bg-slate-950 border border-slate-800 rounded-xl p-3 text-xs text-slate-300"
                    />
                  </div>
                </div>

                {/* Visual Cinema Preview */}
                <div className="bg-[#14120f] border border-slate-800 rounded-2xl p-6 flex flex-col justify-between gap-4">
                  <h3 className="text-base font-bold text-amber-300">
                    Vista Previa del Letrero en los Primeros 6 Segundos
                  </h3>
                  <div className="aspect-video bg-gradient-to-b from-slate-900 via-black to-slate-950 rounded-xl border border-amber-500/40 flex flex-col items-center justify-center p-8 text-center shadow-2xl relative overflow-hidden">
                    <div className="text-xs uppercase tracking-[0.25em] text-amber-300/90 font-semibold mb-2">
                      {activeDoc.clip1Line1LocationTime || 'CIUDAD, PAÍS, AÑO'}
                    </div>
                    <div className="text-xl md:text-2xl font-bold text-white tracking-wide max-w-md leading-snug drop-shadow">
                      {activeDoc.clip1Line2Hook || 'TÍTULO GANCHO DEL DOCUMENTAL'}
                    </div>
                    <div className="absolute bottom-2.5 right-3 text-[10px] font-mono text-slate-500">
                      00:00 - 00:06 (Sin Voz Narrativa • Solo Foley)
                    </div>
                  </div>
                  <button
                    onClick={() =>
                      copyText(
                        `${activeDoc.clip1Line1LocationTime}\n${activeDoc.clip1Line2Hook}`,
                        'copy-clip1-text'
                      )
                    }
                    className="w-full py-2.5 rounded-xl bg-slate-800 hover:bg-slate-700 text-amber-300 font-semibold text-xs cursor-pointer"
                  >
                    {copiedId === 'copy-clip1-text' ? '✓ Texto Copiado' : '📋 Copiar Texto de Apertura'}
                  </button>
                </div>
              </div>
            )}

            {/* ===============================================================
                ETAPA 8: PRODUCCIÓN (VOZ RAW CON PAUSAS + TIMESTAMPS + CLIPS + AUDITORÍA)
            =============================================================== */}
            {activeStage === 8 && (
              <div className="space-y-6">
                {/* Header & Operational 9-Line Order Collapsible Bar */}
                <div className="bg-[#14120f] border border-amber-500/30 rounded-2xl p-5 space-y-3">
                  <div className="flex items-center justify-between flex-wrap gap-3">
                    <div>
                      <h3 className="text-base font-bold text-amber-300 flex items-center gap-2">
                        🎬 8. Centro de Producción: Voz Raw con Pausas + Timestamps + Prompts de Clips
                      </h3>
                      <p className="text-xs text-slate-400">
                        Pega o edita las 3 fuentes de tu documental, arma el Timeline Visual de todo el video y
                        revisa con IA si los prompts de cada clip hacen sentido con la voz narrativa y sus pausas.
                      </p>
                    </div>
                    <div className="flex items-center gap-2 flex-wrap">
                      <button
                        onClick={() => setShowOpHeaderInProd((v) => !v)}
                        className="px-3 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs font-semibold cursor-pointer"
                      >
                        {showOpHeaderInProd ? '▲ Ocultar Orden Operativa' : '▼ Ver Orden Operativa (9 Líneas)'}
                      </button>
                      <button
                        onClick={() =>
                          copyText(
                            activeDoc.operationalHeader || DEFAULT_OPERATIONAL_HEADER,
                            'copy-op-header'
                          )
                        }
                        className="px-3.5 py-1.5 rounded-lg bg-amber-500 text-slate-950 font-bold text-xs cursor-pointer"
                      >
                        {copiedId === 'copy-op-header'
                          ? '✓ Orden Copiada'
                          : '📋 Copiar Orden Operativa (9 Líneas)'}
                      </button>
                    </div>
                  </div>
                  {showOpHeaderInProd && (
                    <pre className="bg-slate-950 border border-slate-800 rounded-xl p-3 text-[11px] font-mono text-amber-200/90 whitespace-pre-wrap">
                      {activeDoc.operationalHeader || DEFAULT_OPERATIONAL_HEADER}
                    </pre>
                  )}
                </div>

                {/* 3-PANEL SYNCHRONIZED PRODUCTION INPUTS */}
                <div className="grid grid-cols-1 xl:grid-cols-3 gap-4">
                  {/* Panel 1: Voz Narrativa Raw con Pausas */}
                  <div className="bg-[#14120f] border border-slate-800 rounded-2xl p-4 flex flex-col justify-between space-y-3">
                    <div className="space-y-2">
                      <div className="flex items-center justify-between gap-2">
                        <div>
                          <span className="text-xs font-black uppercase tracking-wider text-amber-400">
                            1. Voz Narrativa Raw (Con Pausas)
                          </span>
                          <p className="text-[11px] text-slate-400">
                            Reconoce <code className="text-amber-300">[1s]</code>,{' '}
                            <code className="text-amber-300">[2]</code>,{' '}
                            <code className="text-amber-300">[2&#125;</code> y{' '}
                            <code className="text-amber-300">[pausa: 2s]</code>.
                          </p>
                        </div>
                        <span className="px-2 py-0.5 rounded-md bg-amber-500/15 border border-amber-500/30 text-[11px] font-bold text-amber-300 shrink-0">
                          {voiceoverMetrics.pauseCount} pausas ({voiceoverMetrics.pauseSeconds}s)
                        </span>
                      </div>
                      <textarea
                        rows={9}
                        value={activeDoc.voiceoverScript}
                        onChange={(e) => updateActiveDoc({ voiceoverScript: e.target.value })}
                        placeholder="Pega aquí la voz narrativa raw con sus [pausa: 2s], [pausa: 3s]..."
                        className="w-full bg-slate-950 border border-slate-800 rounded-xl p-3 text-xs text-slate-200 leading-relaxed font-sans"
                      />
                    </div>
                    <div className="flex items-center justify-between gap-2 pt-1">
                      <button
                        onClick={() =>
                          updateActiveDoc({
                            voiceoverScript: normalizeQuantitiesToMil(activeDoc.voiceoverScript || ''),
                          })
                        }
                        className="px-2.5 py-1 rounded-lg bg-slate-800 hover:bg-slate-700 text-[11px] text-amber-300 font-semibold cursor-pointer"
                      >
                        🔧 Normalizar &quot;mil&quot;
                      </button>
                      <button
                        onClick={() => copyText(activeDoc.voiceoverScript, 'copy-prod-raw-voice')}
                        className="px-2.5 py-1 rounded-lg bg-slate-800 hover:bg-slate-700 text-[11px] text-slate-300 cursor-pointer"
                      >
                        {copiedId === 'copy-prod-raw-voice' ? '✓ Copiado' : '📋 Copiar Voz Raw'}
                      </button>
                    </div>
                  </div>

                  {/* Panel 2: Voz Narrativa con Timestamps (Narration Timeline Extractor) */}
                  <div className="bg-[#14120f] border border-slate-800 rounded-2xl p-4 flex flex-col justify-between space-y-3">
                    <div className="space-y-2">
                      <div className="flex items-center justify-between gap-2">
                        <div>
                          <span className="text-xs font-black uppercase tracking-wider text-emerald-400">
                            2. Voz con Timestamps (Timeline Extractor)
                          </span>
                          <p className="text-[11px] text-slate-400">
                            Texto con tiempos (<code className="text-emerald-300">00:06 - 00:16</code>) extraído del audio.
                          </p>
                        </div>
                        <span className="px-2 py-0.5 rounded-md bg-emerald-500/15 border border-emerald-500/30 text-[11px] font-bold text-emerald-300 shrink-0">
                          {
                            (activeDoc.timelineFormattedText || '')
                              .split('\n')
                              .filter((l) => l.trim().length > 0).length
                          }{' '}
                          líneas
                        </span>
                      </div>
                      <textarea
                        rows={9}
                        value={activeDoc.timelineFormattedText}
                        onChange={(e) => updateActiveDoc({ timelineFormattedText: e.target.value })}
                        placeholder={
                          'Pega aquí los timestamps de Narration Timeline Extractor:\n1 00:00 - 00:10 En el año mil trescientos cuarenta y siete...\n2 00:10 - 00:20 Las galeras genovesas...'
                        }
                        className="w-full bg-slate-950 border border-slate-800 rounded-xl p-3 text-xs font-mono text-emerald-300 leading-relaxed"
                      />
                    </div>
                    <div className="flex items-center justify-between gap-2 pt-1">
                      <span className="text-[11px] text-slate-400">
                        Clip 1 (00:00-00:04) sin voz se calcula automático
                      </span>
                      <button
                        onClick={() => copyText(activeDoc.timelineFormattedText, 'copy-prod-timeline')}
                        className="px-2.5 py-1 rounded-lg bg-slate-800 hover:bg-slate-700 text-[11px] text-slate-300 cursor-pointer"
                      >
                        {copiedId === 'copy-prod-timeline' ? '✓ Copiado' : '📋 Copiar Timestamps'}
                      </button>
                    </div>
                  </div>

                  {/* Panel 3: Prompts de Imágenes Iniciales y Clips */}
                  <div className="bg-[#14120f] border border-slate-800 rounded-2xl p-4 flex flex-col justify-between space-y-3">
                    <div className="space-y-2">
                      <div className="flex items-center justify-between gap-2">
                        <div>
                          <span className="text-xs font-black uppercase tracking-wider text-purple-400">
                            3. Prompts de Imágenes Iniciales y Clips
                          </span>
                          <p className="text-[11px] text-slate-400">
                            Pega tus bloques <code className="text-purple-300">Image N:</code> y{' '}
                            <code className="text-purple-300">Clip N:</code> o créalos con IA.
                          </p>
                        </div>
                        <button
                          disabled={aiGenerating}
                          onClick={() => handleGenerateWithGemini(8)}
                          className="px-2.5 py-1 rounded-lg bg-amber-500 hover:bg-amber-400 text-slate-950 font-bold text-[11px] flex items-center gap-1 cursor-pointer shrink-0"
                        >
                          <Wand2 className="w-3 h-3" />
                          {aiGenerating ? 'Creando...' : '✨ Crear Prompts con IA'}
                        </button>
                      </div>
                      <textarea
                        rows={9}
                        value={activeDoc.rawClipsText}
                        onChange={(e) => {
                          const val = e.target.value;
                          if (/^\s*(?:Image|Imagen|Clip)\s+0*1\b/i.test(val)) {
                            updateActiveDoc({
                              rawClipsText: ensureOperationalHeaderInRawClips(val, activeDoc.operationalHeader),
                            });
                          } else {
                            updateActiveDoc({ rawClipsText: val });
                          }
                        }}
                        placeholder={
                          'Actúa como un historiador, director de cine, y periodista profesional...\n\nImage 1: Create an image...\nClip 1 (00:00 - 00:06): Create a video...\n\nImage 2: Create an image...\nClip 2 (00:06 - 00:16): Create a video...'
                        }
                        className="w-full bg-slate-950 border border-slate-800 rounded-xl p-3 text-xs font-mono text-slate-200 leading-relaxed"
                      />
                    </div>
                    <div className="flex items-center justify-between gap-2 pt-1 flex-wrap">
                      <div className="flex items-center gap-1.5">
                        <button
                          onClick={() => {
                            const withHeader = ensureOperationalHeaderInRawClips(
                              activeDoc.rawClipsText || '',
                              activeDoc.operationalHeader
                            );
                            updateActiveDoc({ rawClipsText: withHeader });
                          }}
                          className="px-2.5 py-1 rounded-lg bg-amber-500/15 border border-amber-500/30 hover:bg-amber-500/25 text-[11px] text-amber-300 font-semibold cursor-pointer"
                          title="Garantiza que el Párrafo Inicial de 9 Líneas esté al principio de los prompts"
                        >
                          {/Act[uú]a como un historiador/i.test(activeDoc.rawClipsText || '')
                            ? '✓ Párrafo Inicial (9 Líneas)'
                            : '➕ Poner Párrafo Inicial (9 Líneas)'}
                        </button>
                        <button
                          onClick={() => {
                            const nextNum = (activeDoc.clips?.length || 0) + 1;
                            const newClip: DocumentaryClip = {
                              id: `clip-${nextNum}-${Date.now()}`,
                              clipNumber: nextNum,
                              timeRange: nextNum === 1 ? '00:00 - 00:06' : '',
                              cameraSelection: '',
                              visualExplanation: '',
                              imagePrompt: `Image ${nextNum}: Create an image `,
                              videoPrompt: `Clip ${nextNum} (00:06 - 00:16): Create a video `,
                              narrationSegment: '',
                              imageReady: false,
                              videoReady: false,
                            };
                            updateActiveDoc({ clips: [...(activeDoc.clips || []), newClip] });
                          }}
                          className="px-2.5 py-1 rounded-lg bg-slate-800 hover:bg-slate-700 text-[11px] text-slate-200 flex items-center gap-1 cursor-pointer"
                        >
                          <Plus className="w-3 h-3" /> Añadir Clip
                        </button>
                      </div>
                      <button
                        onClick={() => {
                          const textToCopy = ensureOperationalHeaderInRawClips(
                            activeDoc.rawClipsText || '',
                            activeDoc.operationalHeader
                          );
                          if (textToCopy !== activeDoc.rawClipsText) {
                            updateActiveDoc({ rawClipsText: textToCopy });
                          }
                          copyText(textToCopy, 'copy-prod-raw-clips');
                        }}
                        className="px-2.5 py-1 rounded-lg bg-slate-800 hover:bg-slate-700 text-[11px] text-slate-300 cursor-pointer"
                      >
                        {copiedId === 'copy-prod-raw-clips' ? '✓ Copiado' : '📋 Copiar Prompts'}
                      </button>
                    </div>
                  </div>
                </div>

                {/* PRODUCTION SYNC & AI COHERENCE AUDIT ACTION BAR */}
                <div className="bg-gradient-to-r from-amber-500/15 via-purple-500/10 to-emerald-500/15 border border-amber-500/40 rounded-2xl p-4 flex items-center justify-between flex-wrap gap-3">
                  <div className="space-y-0.5">
                    <h4 className="text-sm font-bold text-slate-100 flex items-center gap-2">
                      ⚡ Sincronizador de Timeline y Auditor de Sentido Narrativo
                    </h4>
                    <p className="text-xs text-slate-300">
                      Cruza la Voz Raw (y sus pausas) + los Timestamps + los Prompts de cada Clip para armar el
                      timeline del video y verificar si cada imagen/video hace sentido con lo que dice el narrador.
                    </p>
                  </div>
                  <div className="flex items-center gap-2.5 flex-wrap">
                    <button
                      onClick={handleSyncProductionTimeline}
                      className="px-4 py-2.5 rounded-xl bg-emerald-500 hover:bg-emerald-400 text-slate-950 font-black text-xs flex items-center gap-1.5 cursor-pointer shadow-lg shadow-emerald-500/10"
                    >
                      <RefreshCw className="w-3.5 h-3.5" />
                      🔄 Armar / Actualizar Timeline del Video
                    </button>
                    <button
                      disabled={auditingClips}
                      onClick={handleAuditProductionClipsWithAI}
                      className="px-4 py-2.5 rounded-xl bg-amber-500 hover:bg-amber-400 disabled:opacity-50 text-slate-950 font-black text-xs flex items-center gap-1.5 cursor-pointer shadow-lg shadow-amber-500/10"
                    >
                      <Sparkles className="w-3.5 h-3.5" />
                      {auditingClips
                        ? 'Analizando Coherencia Voz vs. Clips...'
                        : '🧠 Revisar Sentido de Clips y Sugerir Cambios (IA)'}
                    </button>
                  </div>
                </div>

                {/* ===============================================================
                    PILOTO AUTOMÁTICO GOOGLE FLOW + LOTES DE 10 + CARPETA ELEGIDA + AUDITOR VISUAL
                =============================================================== */}
                <div className="bg-gradient-to-r from-emerald-950/60 via-[#14120f] to-amber-950/40 border border-emerald-500/40 rounded-2xl p-4 space-y-3.5 shadow-lg">
                  <div className="flex items-center justify-between flex-wrap gap-3">
                    <div className="space-y-0.5 max-w-3xl">
                      <h4 className="text-sm font-black text-emerald-300 flex items-center gap-2">
                        🤖 Piloto Automático Google Flow: Lotes de 10 + Auditoría Visual IA + Auto-Descarga (6 Palabras)
                      </h4>
                      <p className="text-xs text-slate-300 leading-relaxed">
                        1️⃣ Elige primero tu carpeta de descarga. 2️⃣ Envía tus{' '}
                        <strong className="text-amber-300">@Referencias</strong> y los{' '}
                        <strong className="text-amber-300">Lotes de 10 en 10</strong> (con la Orden Operativa de 9
                        líneas + Pares Image/Clip). 3️⃣ El sistema vigila Google Flow, audita cada video contra su{' '}
                        <strong>Prompt</strong> y su <strong>Voz Narrativa</strong>, y descarga los aprobados como{' '}
                        <code className="text-amber-300">01_primeras_seis_palabras.mp4</code>.
                      </p>
                    </div>

                    <div className="flex items-center gap-2 flex-wrap">
                      {/* Aspect Ratio Selector (16:9 / 9:16) */}
                      <div className="flex items-center bg-slate-950/90 border border-slate-700 rounded-xl p-0.5">
                        {(['16:9', '9:16'] as EditorAspectRatio[]).map((ratio) => (
                          <button
                            key={ratio}
                            type="button"
                            onClick={() => setFlowAspectRatio(ratio)}
                            className={`px-2.5 py-1 rounded-lg text-[11px] font-black transition cursor-pointer ${
                              flowAspectRatio === ratio
                                ? 'bg-amber-500 text-slate-950 shadow'
                                : 'text-slate-400 hover:text-white'
                            }`}
                          >
                            {ratio === '16:9' ? '🖥️ 16:9' : '📱 9:16'}
                          </button>
                        ))}
                      </div>

                      {/* Resolution Selector (HD / 2K / 4K / 8K) */}
                      <select
                        value={flowDownloadResolution}
                        onChange={(e) =>
                          setFlowDownloadResolution(e.target.value as ExportResolutionPreset)
                        }
                        className="bg-slate-950/90 border border-amber-500/40 rounded-xl px-2.5 py-1.5 text-[11px] font-black text-amber-300 focus:outline-none cursor-pointer"
                        title="Calidad de descarga y exportación (HD, 2K, 4K, 8K)"
                      >
                        <option value="HD_1080P">Calidad: HD (1080p)</option>
                        <option value="2K_1440P">Calidad: 2K (1440p)</option>
                        <option value="4K_2160P">Calidad: 4K (2160p)</option>
                        <option value="8K_4320P">Calidad: 8K Ultra (4320p)</option>
                      </select>

                      {/* Step 1: Choose Destination Folder on Computer */}
                      <button
                        type="button"
                        onClick={handlePickFlowDownloadFolder}
                        className={`px-3.5 py-2 rounded-xl text-xs font-bold flex items-center gap-1.5 border transition cursor-pointer ${
                          flowDownloadFolderName
                            ? 'bg-emerald-500/20 border-emerald-500/50 text-emerald-200 hover:bg-emerald-500/30'
                            : 'bg-amber-500 hover:bg-amber-400 text-slate-950 border-amber-400 shadow'
                        }`}
                      >
                        <FolderOpen className="w-4 h-4" />
                        {flowDownloadFolderName
                          ? `📁 Carpeta: ${flowDownloadFolderName} (Cambiar)`
                          : '📂 1. Elegir Carpeta de Descarga'}
                      </button>

                      {/* Step 2: Start / Stop Full Autopilot Queue */}
                      {!flowAutoPilotActive ? (
                        <button
                          type="button"
                          onClick={handleStartFlowAutoPilot}
                          className="px-4 py-2 rounded-xl bg-emerald-500 hover:bg-emerald-400 text-slate-950 font-black text-xs flex items-center gap-1.5 cursor-pointer shadow-lg shadow-emerald-500/20"
                        >
                          <Film className="w-4 h-4" />
                          🚀 2. Piloto Automático Secuencial
                        </button>
                      ) : (
                        <button
                          type="button"
                          onClick={handleStopFlowAutoPilot}
                          className="px-4 py-2 rounded-xl bg-rose-500 hover:bg-rose-400 text-white font-black text-xs flex items-center gap-1.5 cursor-pointer animate-pulse"
                        >
                          ⏹️ Detener Piloto (Clip #{String(flowCurrentClipNum || 1).padStart(2, '0')})
                        </button>
                      )}

                      {/* Scan & Audit Already Generated Videos in Open Flow Tab */}
                      <button
                        type="button"
                        onClick={handleScanExistingFlowVideosInTab}
                        className="px-3 py-2 rounded-xl bg-slate-900 hover:bg-slate-800 border border-slate-700 text-xs font-semibold text-amber-300 flex items-center gap-1.5 cursor-pointer"
                        title="Si ya tienes videos creados en la pestaña abierta de Google Flow, los captura, audita contra sus prompts y voz narrativa, y descarga los aprobados"
                      >
                        🔍 Auditar Videos Actuales en Flow
                      </button>

                      {/* Open CapCut Multi-Track Editor */}
                      <button
                        type="button"
                        onClick={() => setMainView('capcut_editor')}
                        className="px-3.5 py-2 rounded-xl bg-gradient-to-r from-amber-500 to-orange-500 hover:from-amber-400 hover:to-orange-400 text-slate-950 font-black text-xs flex items-center gap-1.5 cursor-pointer shadow-md shadow-amber-500/20"
                      >
                        🎬 Abrir en Editor CapCut
                      </button>
                    </div>
                  </div>

                  {/* BATCHES OF 10 EXECUTION BAR (Orden Operativa 9 líneas + 10 Pares Image/Clip) */}
                  {(activeDoc.clips?.length || 0) > 0 && (
                    <div className="pt-2.5 border-t border-slate-800/80 flex items-center justify-between flex-wrap gap-2">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="text-[11px] font-black uppercase tracking-wider text-amber-300">
                          📦 Envío por Lotes a Google Flow (Orden Operativa + 10 Pares Image/Clip):
                        </span>
                        {(activeDoc.references?.length || 0) > 0 && (
                          <button
                            type="button"
                            onClick={handleSendReferencesBlockToFlow}
                            className="px-2.5 py-1 rounded-lg bg-purple-500/20 hover:bg-purple-500/30 border border-purple-500/40 text-purple-200 text-[11px] font-bold cursor-pointer transition"
                            title="Envía el bloque de @Personas y @Lugares para fijar consistencia antes de los lotes"
                          >
                            🧬 0. Enviar @{activeDoc.references.length} Referencias
                          </button>
                        )}
                        {Array.from(
                          { length: Math.ceil((activeDoc.clips?.length || 0) / 10) },
                          (_, batchIdx) => {
                            const startClipNum = batchIdx * 10 + 1;
                            const endClipNum = Math.min(
                              (batchIdx + 1) * 10,
                              activeDoc.clips?.length || 0
                            );
                            const isActiveBatch = flowCurrentBatchNum === batchIdx + 1;
                            return (
                              <button
                                key={batchIdx}
                                type="button"
                                onClick={() => handleSendBatch10ToFlow(batchIdx + 1)}
                                className={`px-2.5 py-1 rounded-lg text-[11px] font-bold border transition cursor-pointer ${
                                  isActiveBatch
                                    ? 'bg-emerald-500 text-slate-950 border-emerald-300 shadow'
                                    : 'bg-slate-900/90 hover:bg-slate-800 text-emerald-300 border-emerald-500/30'
                                }`}
                                title={`Envía la Orden Operativa de 9 líneas + Pares Image/Clip del ${String(
                                  startClipNum
                                ).padStart(2, '0')} al ${String(endClipNum).padStart(2, '0')} a Google Flow`}
                              >
                                🚀 Lote {batchIdx + 1} ({String(startClipNum).padStart(2, '0')}-
                                {String(endClipNum).padStart(2, '0')})
                              </button>
                            );
                          }
                        )}
                      </div>
                    </div>
                  )}

                  {/* Toggles & Live Status Bar */}
                  <div className="flex items-center justify-between flex-wrap gap-3 pt-2 border-t border-slate-800/80 text-xs">
                    <div className="flex items-center gap-4 flex-wrap">
                      <label className="flex items-center gap-1.5 text-slate-300 cursor-pointer">
                        <input
                          type="checkbox"
                          checked={flowAutoDownloadEnabled}
                          onChange={(e) => setFlowAutoDownloadEnabled(e.target.checked)}
                          className="accent-emerald-500"
                        />
                        <span>
                          Auto-descargar aprobados (✅) como{' '}
                          <code className="text-amber-300">01_primeras_seis_palabras.mp4</code>
                        </span>
                      </label>
                      <label className="flex items-center gap-1.5 text-slate-300 cursor-pointer">
                        <input
                          type="checkbox"
                          checked={flowAutoRetryEnabled}
                          onChange={(e) => setFlowAutoRetryEnabled(e.target.checked)}
                          className="accent-amber-500"
                        />
                        <span>Auto-corregir prompt y re-hacer en Flow si un video falla (🚨 máx. 2 intentos)</span>
                      </label>
                      <label className="flex items-center gap-1.5 text-emerald-300 font-semibold cursor-pointer">
                        <input
                          type="checkbox"
                          checked={flowAutoChainBatches}
                          onChange={(e) => setFlowAutoChainBatches(e.target.checked)}
                          className="accent-emerald-400"
                        />
                        <span>
                          🌙 Auto-encadenar Lotes (Al terminar el Lote 1 dispara solo el Lote 2, 3...)
                        </span>
                      </label>
                    </div>

                    {flowStatusLog && (
                      <div className="text-xs font-mono text-emerald-300 bg-slate-950/90 border border-emerald-500/30 rounded-lg px-3 py-1">
                        {flowStatusLog}
                      </div>
                    )}
                  </div>
                </div>

                {/* AUDIT SUMMARY & 1-CLICK APPLY ALL SUGGESTIONS */}
                {(activeDoc.clips?.length || 0) > 0 &&
                  (() => {
                    const clipsList = activeDoc.clips || [];
                    const okCount = clipsList.filter((c) => c.auditStatus === 'ok').length;
                    const warnCount = clipsList.filter((c) => c.auditStatus === 'warning').length;
                    const mismatchCount = clipsList.filter((c) => c.auditStatus === 'mismatch').length;
                    const suggestionsCount = clipsList.filter(
                      (c) => c.suggestedImagePrompt || c.suggestedVideoPrompt
                    ).length;

                    if (okCount === 0 && warnCount === 0 && mismatchCount === 0 && !auditSummary) {
                      return null;
                    }

                    return (
                      <div className="bg-[#14120f] border border-slate-800 rounded-2xl p-4 space-y-3">
                        <div className="flex items-center justify-between flex-wrap gap-3">
                          <div className="flex items-center gap-3 flex-wrap">
                            <span className="text-xs font-bold text-slate-200">
                              Resultado de Revisión del Timeline:
                            </span>
                            <span className="px-2.5 py-1 rounded-lg bg-emerald-500/15 border border-emerald-500/30 text-emerald-300 text-xs font-bold">
                              ✅ {okCount} Coherentes
                            </span>
                            <span className="px-2.5 py-1 rounded-lg bg-amber-500/15 border border-amber-500/30 text-amber-300 text-xs font-bold">
                              ⚠️ {warnCount} Con Observación
                            </span>
                            <span className="px-2.5 py-1 rounded-lg bg-rose-500/15 border border-rose-500/30 text-rose-300 text-xs font-bold">
                              🚨 {mismatchCount} No coinciden / Incompletos
                            </span>
                          </div>
                          {suggestionsCount > 0 && (
                            <button
                              onClick={handleApplyAllClipSuggestions}
                              className="px-4 py-2 rounded-xl bg-emerald-500 hover:bg-emerald-400 text-slate-950 font-black text-xs flex items-center gap-1.5 cursor-pointer"
                            >
                              <Check className="w-4 h-4" />
                              Aplicar Todos los Cambios Sugeridos ({suggestionsCount} clips)
                            </button>
                          )}
                        </div>
                        {auditSummary && (
                          <p className="text-xs text-slate-300 bg-slate-950/80 border border-slate-800 rounded-xl p-3">
                            <strong className="text-amber-300">Diagnóstico General IA:</strong> {auditSummary}
                          </p>
                        )}
                      </div>
                    );
                  })()}

                {/* VISUAL VIDEO TIMELINE STRIP OF ALL CLIPS */}
                {(activeDoc.clips?.length || 0) > 0 && (
                  <div className="bg-[#14120f] border border-slate-800 rounded-2xl p-4 space-y-3">
                    <div className="flex items-center justify-between flex-wrap gap-2">
                      <div>
                        <h4 className="text-xs font-black uppercase tracking-wider text-amber-300 flex items-center gap-2">
                          <Clock className="w-3.5 h-3.5" /> Línea de Tiempo Visual del Video ({activeDoc.clips.length}{' '}
                          Clips en total)
                        </h4>
                        <p className="text-[11px] text-slate-400">
                          Haz clic en cualquier bloque del timeline para saltar directamente a ese clip. Los colores
                          indican si el clip hace sentido con la voz narrativa.
                        </p>
                      </div>
                      <div className="flex items-center gap-3 text-[11px] text-slate-400">
                        <span className="flex items-center gap-1">
                          <span className="w-2.5 h-2.5 rounded-full bg-emerald-500 inline-block" /> Coherente
                        </span>
                        <span className="flex items-center gap-1">
                          <span className="w-2.5 h-2.5 rounded-full bg-amber-500 inline-block" /> Revisar / Pausa
                        </span>
                        <span className="flex items-center gap-1">
                          <span className="w-2.5 h-2.5 rounded-full bg-rose-500 inline-block" /> Sugerencia de cambio
                        </span>
                      </div>
                    </div>

                    {/* Horizontal Scrollable / Grid Timeline Track */}
                    <div className="flex items-stretch gap-2 overflow-x-auto pb-2 pt-1">
                      {activeDoc.clips.map((clip) => {
                        const padded = String(clip.clipNumber).padStart(2, '0');
                        const statusColor =
                          clip.auditStatus === 'mismatch'
                            ? 'border-rose-500/70 bg-rose-950/30 hover:bg-rose-950/50'
                            : clip.auditStatus === 'warning'
                            ? 'border-amber-500/60 bg-amber-950/25 hover:bg-amber-950/40'
                            : clip.auditStatus === 'ok'
                            ? 'border-emerald-500/50 bg-emerald-950/20 hover:bg-emerald-950/35'
                            : 'border-slate-800 bg-slate-950 hover:bg-slate-900';

                        const dotColor =
                          clip.auditStatus === 'mismatch'
                            ? 'bg-rose-500'
                            : clip.auditStatus === 'warning'
                            ? 'bg-amber-400'
                            : clip.auditStatus === 'ok'
                            ? 'bg-emerald-400'
                            : 'bg-slate-600';

                        return (
                          <button
                            key={`tl-${clip.id}`}
                            onClick={() => {
                              setClipBatchFilter(0);
                              setTimeout(() => {
                                const el = document.getElementById(`prod-clip-card-${clip.clipNumber}`);
                                if (el) el.scrollIntoView({ behavior: 'smooth', block: 'center' });
                              }, 50);
                            }}
                            className={`min-w-[165px] max-w-[190px] shrink-0 text-left rounded-xl border p-2.5 transition cursor-pointer flex flex-col justify-between gap-1.5 ${statusColor}`}
                          >
                            <div className="flex items-center justify-between gap-1">
                              <span className="text-[11px] font-black text-amber-300 flex items-center gap-1.5">
                                <span className={`w-2 h-2 rounded-full ${dotColor}`} />
                                CLIP {padded}
                              </span>
                              <span className="text-[10px] font-mono text-slate-300 bg-slate-900/90 px-1.5 py-0.5 rounded">
                                {clip.timeRange || 'S/T'}
                              </span>
                            </div>
                            <p className="text-[11px] text-slate-200 line-clamp-2 leading-snug">
                              {clip.clipNumber === 1
                                ? '🔇 [0s Voz — Solo Foley y Texto Clip 1]'
                                : clip.narrationSegment || '⚠️ Sin fragmento de voz asignado'}
                            </p>
                            <div className="flex items-center justify-between gap-1 pt-1 border-t border-slate-800/80">
                              <span className="text-[10px] text-slate-400 truncate">
                                {clip.pauseNotes ? `⏸ ${clip.pauseNotes}` : '🎙️ Fluido'}
                              </span>
                              {(clip.suggestedImagePrompt || clip.suggestedVideoPrompt) && (
                                <span className="text-[10px] font-bold text-amber-300 shrink-0">✨ Sugerencia</span>
                              )}
                            </div>
                          </button>
                        );
                      })}
                    </div>
                  </div>
                )}

                {/* Batch Filter Tabs (Batches of 10) */}
                {(activeDoc.clips?.length || 0) > 0 && (
                  <div className="flex items-center justify-between flex-wrap gap-3 bg-[#14120f] border border-slate-800 rounded-xl p-3">
                    <div className="flex items-center gap-1.5 flex-wrap">
                      <button
                        onClick={() => setClipBatchFilter(0)}
                        className={`px-3 py-1.5 rounded-lg text-xs font-bold cursor-pointer ${
                          clipBatchFilter === 0
                            ? 'bg-amber-500 text-slate-950'
                            : 'bg-slate-900 text-slate-300'
                        }`}
                      >
                        Todos ({activeDoc.clips.length})
                      </button>
                      {Array.from(
                        { length: Math.ceil(activeDoc.clips.length / 10) },
                        (_, bIdx) => bIdx + 1
                      ).map((batchNum) => {
                        const startClip = (batchNum - 1) * 10 + 1;
                        const endClip = Math.min(batchNum * 10, activeDoc.clips.length);
                        return (
                          <button
                            key={batchNum}
                            onClick={() => setClipBatchFilter(batchNum)}
                            className={`px-3 py-1.5 rounded-lg text-xs font-semibold cursor-pointer ${
                              clipBatchFilter === batchNum
                                ? 'bg-amber-500 text-slate-950'
                                : 'bg-slate-900 text-slate-300 hover:bg-slate-800'
                            }`}
                          >
                            Lote {batchNum} (Clips {String(startClip).padStart(2, '0')}-
                            {String(endClip).padStart(2, '0')})
                          </button>
                        );
                      })}
                    </div>

                    <button
                      onClick={() => {
                        const visible = activeDoc.clips.filter((_, idx) =>
                          clipBatchFilter === 0
                            ? true
                            : idx >= (clipBatchFilter - 1) * 10 && idx < clipBatchFilter * 10
                        );
                        const headerPrefix =
                          clipBatchFilter <= 1
                            ? `${activeDoc.operationalHeader || DEFAULT_OPERATIONAL_HEADER}\n\n`
                            : '';
                        const body = visible
                          .map((c) => `${c.imagePrompt}\n${c.videoPrompt}`)
                          .join('\n\n');
                        copyText(headerPrefix + body, 'copy-batch-clips');
                      }}
                      className="px-3.5 py-1.5 rounded-lg bg-amber-500/20 border border-amber-500/40 text-amber-300 text-xs font-bold cursor-pointer"
                    >
                      {copiedId === 'copy-batch-clips'
                        ? '✓ Lote Copiado al Portapapeles'
                        : '📋 Copiar Prompts de este Lote'}
                    </button>
                  </div>
                )}

                {/* Individual Clip Cards with Voiceover Alignment, Audit Status & 1-Click Suggestions */}
                <div className="space-y-4">
                  {(activeDoc.clips || [])
                    .filter((_, idx) =>
                      clipBatchFilter === 0
                        ? true
                        : idx >= (clipBatchFilter - 1) * 10 && idx < clipBatchFilter * 10
                    )
                    .map((clip) => {
                      const realIdx = activeDoc.clips.findIndex((c) => c.id === clip.id);
                      const paddedNum = String(clip.clipNumber).padStart(2, '0');
                      const hasSuggestion = !!(clip.suggestedImagePrompt || clip.suggestedVideoPrompt);

                      const borderClass =
                        clip.auditStatus === 'mismatch'
                          ? 'border-rose-500/60 bg-rose-950/10'
                          : clip.auditStatus === 'warning'
                          ? 'border-amber-500/50 bg-amber-950/10'
                          : clip.imageReady && clip.videoReady
                          ? 'border-emerald-500/50 bg-emerald-950/10'
                          : 'border-slate-800';

                      return (
                        <div
                          id={`prod-clip-card-${clip.clipNumber}`}
                          key={clip.id}
                          className={`bg-[#14120f] border rounded-2xl p-5 space-y-4 transition ${borderClass}`}
                        >
                          {/* Top Row: Clip Badge, Time Range, Audit Badge, Ready Checkboxes */}
                          <div className="flex items-center justify-between flex-wrap gap-2">
                            <div className="flex items-center gap-2.5 flex-wrap">
                              <span className="px-3 py-1 rounded-lg bg-amber-500 text-slate-950 font-black text-xs">
                                CLIP {paddedNum}
                              </span>
                              <input
                                type="text"
                                value={clip.timeRange}
                                onChange={(e) => {
                                  const next = [...activeDoc.clips];
                                  next[realIdx] = { ...clip, timeRange: e.target.value };
                                  updateActiveDoc({ clips: next });
                                }}
                                placeholder="00:06 - 00:16"
                                className="bg-slate-950 border border-slate-800 rounded-lg px-2.5 py-1 text-xs font-mono text-amber-300 w-32"
                              />
                              {clip.auditStatus === 'ok' && (
                                <span className="px-2.5 py-1 rounded-lg bg-emerald-500/15 border border-emerald-500/30 text-emerald-300 text-xs font-bold">
                                  ✅ Hace sentido con la voz
                                </span>
                              )}
                              {clip.auditStatus === 'warning' && (
                                <span className="px-2.5 py-1 rounded-lg bg-amber-500/15 border border-amber-500/30 text-amber-300 text-xs font-bold">
                                  ⚠️ Revisar detalle / pausa
                                </span>
                              )}
                              {clip.auditStatus === 'mismatch' && (
                                <span className="px-2.5 py-1 rounded-lg bg-rose-500/20 border border-rose-500/40 text-rose-300 text-xs font-bold">
                                  🚨 No coincide con la voz / Sugerencia lista
                                </span>
                              )}
                              {clip.pauseNotes && (
                                <span className="px-2.5 py-1 rounded-lg bg-purple-500/15 border border-purple-500/30 text-purple-300 text-xs font-mono">
                                  ⏸ {clip.pauseNotes}
                                </span>
                              )}
                              {clip.videoAuditStatus === 'generating' && (
                                <span className="px-2.5 py-1 rounded-lg bg-sky-500/20 border border-sky-500/40 text-sky-300 text-xs font-bold animate-pulse">
                                  🎬 Generando video en Flow...
                                </span>
                              )}
                              {clip.videoAuditStatus === 'auditing' && (
                                <span className="px-2.5 py-1 rounded-lg bg-amber-500/20 border border-amber-500/40 text-amber-300 text-xs font-bold animate-pulse">
                                  🔍 Auditando video real...
                                </span>
                              )}
                              {clip.videoAuditStatus === 'approved' && (
                                <span className="px-2.5 py-1 rounded-lg bg-emerald-500/20 border border-emerald-500/40 text-emerald-300 text-xs font-bold">
                                  🎥 ✅ Video Flow Aprobado ({clip.videoAuditScore ?? 92}/100)
                                </span>
                              )}
                              {clip.videoAuditStatus === 'warning' && (
                                <span className="px-2.5 py-1 rounded-lg bg-amber-500/20 border border-amber-500/40 text-amber-300 text-xs font-bold">
                                  🎥 ⚠️ Video Flow con Observación ({clip.videoAuditScore ?? 70}/100)
                                </span>
                              )}
                              {clip.videoAuditStatus === 'rejected' && (
                                <span className="px-2.5 py-1 rounded-lg bg-rose-500/25 border border-rose-500/50 text-rose-300 text-xs font-bold">
                                  🎥 🚨 Video Flow Rechazado ({clip.videoAuditScore ?? 40}/100)
                                </span>
                              )}
                              {clip.videoSavedFileName && (
                                <span className="px-2.5 py-1 rounded-lg bg-emerald-950 border border-emerald-500/40 text-emerald-300 text-[11px] font-mono">
                                  💾 {clip.videoSavedFileName}
                                </span>
                              )}
                            </div>

                            <div className="flex items-center gap-3">
                              <label className="flex items-center gap-1.5 text-xs text-slate-300 cursor-pointer">
                                <input
                                  type="checkbox"
                                  checked={clip.imageReady}
                                  onChange={(e) => {
                                    const next = [...activeDoc.clips];
                                    next[realIdx] = { ...clip, imageReady: e.target.checked };
                                    updateActiveDoc({ clips: next });
                                  }}
                                  className="accent-emerald-500"
                                />
                                Imagen {paddedNum} Lista
                              </label>
                              <label className="flex items-center gap-1.5 text-xs text-slate-300 cursor-pointer">
                                <input
                                  type="checkbox"
                                  checked={clip.videoReady}
                                  onChange={(e) => {
                                    const next = [...activeDoc.clips];
                                    next[realIdx] = { ...clip, videoReady: e.target.checked };
                                    updateActiveDoc({ clips: next });
                                  }}
                                  className="accent-emerald-500"
                                />
                                Video {paddedNum} Listo
                              </label>
                              <button
                                onClick={() =>
                                  updateActiveDoc({
                                    clips: activeDoc.clips.filter((c) => c.id !== clip.id),
                                  })
                                }
                                className="p-1 text-slate-500 hover:text-rose-400 cursor-pointer"
                              >
                                <Trash2 className="w-4 h-4" />
                              </button>
                            </div>
                          </div>

                          {/* Voiceover Narration Segment Aligned to this Clip */}
                          <div className="bg-slate-950/90 border border-slate-800/90 rounded-xl p-3 space-y-1.5">
                            <div className="flex items-center justify-between gap-2">
                              <span className="text-[11px] font-bold uppercase tracking-wider text-slate-400">
                                🎙️ Voz Narrativa durante este Clip ({clip.timeRange || 'Sin tiempo'})
                              </span>
                              {clip.auditReason && (
                                <span className="text-xs text-amber-200/90 font-medium">
                                  {clip.auditReason}
                                </span>
                              )}
                            </div>
                            <input
                              type="text"
                              value={clip.narrationSegment}
                              onChange={(e) => {
                                const next = [...activeDoc.clips];
                                next[realIdx] = { ...clip, narrationSegment: e.target.value };
                                updateActiveDoc({ clips: next });
                              }}
                              placeholder="Fragmento de voz en off correspondiente a este rango de tiempo..."
                              className="w-full bg-transparent text-xs text-emerald-300 font-medium focus:outline-none"
                            />
                          </div>

                          {/* Current Image & Video Prompts */}
                          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
                            {/* Image Prompt */}
                            <div className="space-y-1.5">
                              <div className="flex items-center justify-between flex-wrap gap-1.5">
                                <span className="text-xs font-semibold text-amber-300">
                                  🖼️ Prompt de Imagen Inicial (Nano Banana 2.1)
                                </span>
                                <div className="flex items-center gap-1.5">
                                  <button
                                    type="button"
                                    onClick={() =>
                                      handleSendPromptToFlow(clip.imagePrompt, 'IMAGE', clip.id)
                                    }
                                    className="px-2.5 py-0.5 rounded bg-emerald-500/20 hover:bg-emerald-500/30 border border-emerald-500/40 text-[11px] text-emerald-300 font-semibold cursor-pointer"
                                    title="Enviar prompt de imagen a Google Flow (Gratis)"
                                  >
                                    🚀 Flow Imagen
                                  </button>
                                  <button
                                    onClick={() => copyText(clip.imagePrompt, `img-${clip.id}`)}
                                    className="px-2.5 py-0.5 rounded bg-slate-800 hover:bg-slate-700 text-[11px] text-amber-300 cursor-pointer"
                                  >
                                    {copiedId === `img-${clip.id}` ? '✓ Copiado' : '📋 Copiar Image'}
                                  </button>
                                </div>
                              </div>
                              <textarea
                                rows={3}
                                value={clip.imagePrompt}
                                onChange={(e) => {
                                  const next = [...activeDoc.clips];
                                  next[realIdx] = { ...clip, imagePrompt: e.target.value };
                                  updateActiveDoc({ clips: next });
                                }}
                                className="w-full bg-slate-950 border border-slate-800 rounded-xl p-2.5 text-xs font-mono text-slate-200"
                              />
                            </div>

                            {/* Video Prompt */}
                            <div className="space-y-1.5">
                              <div className="flex items-center justify-between flex-wrap gap-1.5">
                                <span className="text-xs font-semibold text-emerald-300">
                                  🎬 Prompt de Video (Omni Flash + Foley)
                                </span>
                                <div className="flex items-center gap-1.5">
                                  <button
                                    type="button"
                                    onClick={() =>
                                      handleSendPromptToFlow(clip.videoPrompt, 'VIDEO', clip.id)
                                    }
                                    className="px-2.5 py-0.5 rounded bg-emerald-500/20 hover:bg-emerald-500/30 border border-emerald-500/40 text-[11px] text-emerald-300 font-semibold cursor-pointer"
                                    title="Enviar prompt de video a Google Flow (Gratis)"
                                  >
                                    🎬 Flow Video
                                  </button>
                                  <button
                                    onClick={() => copyText(clip.videoPrompt, `vid-${clip.id}`)}
                                    className="px-2.5 py-0.5 rounded bg-slate-800 hover:bg-slate-700 text-[11px] text-emerald-300 cursor-pointer"
                                  >
                                    {copiedId === `vid-${clip.id}` ? '✓ Copiado' : '📋 Copiar Clip'}
                                  </button>
                                </div>
                              </div>
                              <textarea
                                rows={3}
                                value={clip.videoPrompt}
                                onChange={(e) => {
                                  const next = [...activeDoc.clips];
                                  next[realIdx] = { ...clip, videoPrompt: e.target.value };
                                  updateActiveDoc({ clips: next });
                                }}
                                className="w-full bg-slate-950 border border-slate-800 rounded-xl p-2.5 text-xs font-mono text-slate-200"
                              />
                            </div>
                          </div>

                          {/* GOOGLE FLOW REAL VIDEO AUDIT RESULT & 3-KEYFRAME STRIP */}
                          {(clip.videoAuditReason || (clip.videoFrames && clip.videoFrames.length > 0)) && (
                            <div
                              className={`rounded-xl border p-3.5 space-y-2.5 ${
                                clip.videoAuditStatus === 'rejected'
                                  ? 'bg-rose-950/25 border-rose-500/40'
                                  : clip.videoAuditStatus === 'approved'
                                  ? 'bg-emerald-950/20 border-emerald-500/35'
                                  : 'bg-slate-950/90 border-slate-800'
                              }`}
                            >
                              <div className="flex items-center justify-between flex-wrap gap-2">
                                <span className="text-xs font-bold text-amber-300 flex items-center gap-1.5">
                                  🎞️ Auditoría Visual del Video Creado en Google Flow (vs. Prompt y Voz Narrativa)
                                  {clip.videoAttempts && clip.videoAttempts > 1
                                    ? ` • Intento #${clip.videoAttempts}`
                                    : ''}
                                </span>
                                {clip.videoSavedFileName && (
                                  <span className="text-[11px] font-mono text-emerald-300">
                                    ✓ Descargado automáticamente: {clip.videoSavedFileName}
                                  </span>
                                )}
                              </div>

                              {clip.videoAuditReason && (
                                <p className="text-xs text-slate-200 leading-relaxed">
                                  {clip.videoAuditReason}
                                </p>
                              )}

                              {clip.videoAuditIssues && clip.videoAuditIssues.length > 0 && (
                                <ul className="list-disc list-inside text-xs text-rose-300 space-y-0.5">
                                  {clip.videoAuditIssues.map((iss, iIdx) => (
                                    <li key={iIdx}>{iss}</li>
                                  ))}
                                </ul>
                              )}

                              {clip.videoFrames && clip.videoFrames.length > 0 && (
                                <div className="grid grid-cols-3 gap-2.5 pt-1">
                                  {clip.videoFrames.slice(0, 3).map((frameSrc, fIdx) => (
                                    <div
                                      key={fIdx}
                                      className="relative rounded-lg overflow-hidden border border-slate-800 bg-black aspect-video"
                                    >
                                      <img
                                        src={frameSrc}
                                        alt={`Clip ${paddedNum} Frame ${fIdx + 1}`}
                                        className="w-full h-full object-cover"
                                      />
                                      <span className="absolute bottom-1 left-1.5 px-1.5 py-0.5 rounded bg-black/80 text-[10px] font-mono text-amber-300">
                                        {fIdx === 0 ? 'Inicio' : fIdx === 1 ? 'Mitad' : 'Final'}
                                      </span>
                                    </div>
                                  ))}
                                </div>
                              )}
                            </div>
                          )}

                          {/* AI Suggested Replacement Prompts Box (if any) */}
                          {hasSuggestion && (
                            <div className="bg-amber-500/10 border border-amber-500/40 rounded-xl p-4 space-y-3">
                              <div className="flex items-center justify-between flex-wrap gap-2">
                                <div>
                                  <h5 className="text-xs font-black uppercase tracking-wider text-amber-300">
                                    💡 Sugerencia de Cambio para Alinear el Clip {paddedNum} con la Voz Narrativa
                                  </h5>
                                  {clip.auditReason && (
                                    <p className="text-xs text-slate-300 mt-0.5">{clip.auditReason}</p>
                                  )}
                                </div>
                                <div className="flex items-center gap-2">
                                  <button
                                    onClick={() => handleApplyClipSuggestion(clip.id)}
                                    className="px-3.5 py-1.5 rounded-lg bg-emerald-500 hover:bg-emerald-400 text-slate-950 font-black text-xs cursor-pointer flex items-center gap-1"
                                  >
                                    <Check className="w-3.5 h-3.5" /> Aplicar Cambio Sugerido
                                  </button>
                                  <button
                                    onClick={() => {
                                      const next = [...activeDoc.clips];
                                      next[realIdx] = {
                                        ...clip,
                                        suggestedImagePrompt: undefined,
                                        suggestedVideoPrompt: undefined,
                                      };
                                      updateActiveDoc({ clips: next });
                                    }}
                                    className="px-2.5 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300 text-xs cursor-pointer"
                                  >
                                    Descartar
                                  </button>
                                </div>
                              </div>

                              <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
                                {clip.suggestedImagePrompt && (
                                  <div className="bg-slate-950/90 border border-amber-500/30 rounded-lg p-2.5 space-y-1">
                                    <span className="text-[11px] font-bold text-amber-300">
                                      🖼️ Image {clip.clipNumber} Sugerido:
                                    </span>
                                    <p className="text-xs font-mono text-slate-200 whitespace-pre-wrap">
                                      {clip.suggestedImagePrompt}
                                    </p>
                                  </div>
                                )}
                                {clip.suggestedVideoPrompt && (
                                  <div className="bg-slate-950/90 border border-emerald-500/30 rounded-lg p-2.5 space-y-1">
                                    <span className="text-[11px] font-bold text-emerald-300">
                                      🎬 Clip {clip.clipNumber} Sugerido:
                                    </span>
                                    <p className="text-xs font-mono text-slate-200 whitespace-pre-wrap">
                                      {clip.suggestedVideoPrompt}
                                    </p>
                                  </div>
                                )}
                              </div>
                            </div>
                          )}
                        </div>
                      );
                    })}
                </div>
              </div>
            )}

            {/* ===============================================================
                ETAPA 9: CORRECTOR AUTOMÁTICO DE CAPTIONS .SRT DE CAPCUT
            =============================================================== */}
            {activeStage === 9 && (
              <div className="space-y-6">
                <div className="bg-[#14120f] border border-amber-500/30 rounded-2xl p-6 space-y-4">
                  <div className="flex items-center justify-between flex-wrap gap-3">
                    <div>
                      <h3 className="text-base font-bold text-amber-300">
                        Corrector Automático de Subtítulos .SRT de CapCut (Conectado a tu Guion de Etapa 4)
                      </h3>
                      <p className="text-xs text-slate-400">
                        Cruza los subtítulos exportados de CapCut con tu Guion de Voz en Off, corrigiendo
                        ortografía, nombres históricos, siglos en romanos y cantidades a{' '}
                        <strong className="text-amber-300">"70 mil"</strong> sin mover ni un milisegundo los
                        timestamps de CapCut.
                      </p>
                    </div>
                    <div className="flex items-center gap-2 flex-wrap">
                      {(activeDoc.capcutRawSrt || activeDoc.correctedSrt) && (
                        <button
                          type="button"
                          onClick={() => {
                            updateActiveDoc({
                              capcutRawSrt: '',
                              correctedSrt: '',
                              srtFileName: 'captions_corregidos',
                            });
                            setSrtStatsMsg('');
                          }}
                          className="px-3 py-2 rounded-xl bg-rose-950/60 hover:bg-rose-900/70 text-rose-300 font-bold text-xs cursor-pointer flex items-center gap-1.5 border border-rose-500/30"
                          title="Vaciar cajas .SRT para evitar mezclar con videos anteriores"
                        >
                          <Trash2 className="w-3.5 h-3.5" /> Limpiar .SRT
                        </button>
                      )}
                      <label className="px-4 py-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-amber-300 font-bold text-xs cursor-pointer flex items-center gap-2 border border-amber-500/30">
                        <Upload className="w-4 h-4" /> Cargar archivo .SRT de CapCut
                        <input
                          type="file"
                          accept=".srt,.txt"
                          className="hidden"
                          onChange={(e) => {
                            const file = e.target.files?.[0];
                            if (!file) return;
                            const base = file.name.replace(/\.srt$|\.txt$/i, '');
                            const reader = new FileReader();
                            reader.onload = (ev) => {
                              const content = String(ev.target?.result || '');
                              updateActiveDoc({
                                capcutRawSrt: content,
                                correctedSrt: '',
                                srtFileName: `${base}_corregido`,
                              });
                              setSrtStatsMsg('');
                            };
                            reader.readAsText(file, 'utf-8');
                            e.target.value = '';
                          }}
                        />
                      </label>
                    </div>
                  </div>

                  {/* Controles de Largo de Línea de Captions */}
                  <div className="bg-slate-950/80 border border-slate-800 rounded-xl p-3.5 flex flex-wrap items-center justify-between gap-4">
                    <div className="space-y-1.5">
                      <span className="block text-[11px] font-bold text-amber-300 uppercase tracking-wider">
                        📏 Largo Máximo de Línea en Pantalla (Caracteres por Caption):
                      </span>
                      <div className="flex flex-wrap gap-1.5">
                        {[
                          { val: 22, label: '⚡ Muy Corto (22 caract. / 3-4 pal.)' },
                          { val: 32, label: '🎯 Corto Ideal (32 caract. / 4-6 pal.)' },
                          { val: 42, label: '📐 Medio (42 caract. / 6-7 pal.)' },
                          { val: 0, label: '📄 Original CapCut (Sin acortar)' },
                        ].map((opt) => {
                          const isSelected =
                            (opt.val === 0 && srtLineMode === 'original') ||
                            (opt.val > 0 && srtLineMode !== 'original' && srtMaxChars === opt.val);
                          return (
                            <button
                              key={opt.val}
                              type="button"
                              onClick={() => {
                                const nextMode = opt.val === 0 ? 'original' : srtLineMode === 'original' ? 'subdivide' : srtLineMode;
                                const nextMax = opt.val === 0 ? srtMaxChars : opt.val;
                                setSrtMaxChars(nextMax);
                                setSrtLineMode(nextMode);
                                if (activeDoc.capcutRawSrt?.trim() && activeDoc.voiceoverScript?.trim()) {
                                  try {
                                    const res = fixCapcutSrtWithVoiceover(
                                      activeDoc.voiceoverScript,
                                      activeDoc.capcutRawSrt,
                                      { maxCharsPerLine: nextMax, mode: nextMode }
                                    );
                                    updateActiveDoc({ correctedSrt: res.fixedSrt });
                                    const baseMsg = `✅ ¡SRT Procesado con éxito! ${res.blocksCount} bloques generados (máx. ${opt.val === 0 ? 'original' : `${nextMax} caract.`}) • ${res.capcutWordsCount} palabras de CapCut alineadas con las ${res.originalWordsCount} palabras de tu Guion de Etapa 4 (Coincidencia: ${res.similarityPct ?? 100}%).`;
                                    setSrtStatsMsg(res.warningMsg ? `${baseMsg} ${res.warningMsg}` : baseMsg);
                                  } catch {}
                                }
                              }}
                              className={`px-3 py-1.5 rounded-lg text-xs font-bold transition cursor-pointer border ${
                                isSelected
                                  ? 'bg-amber-500 text-slate-950 border-amber-400 shadow'
                                  : 'bg-slate-900 hover:bg-slate-800 text-slate-300 border-slate-700'
                              }`}
                            >
                              {opt.label}
                            </button>
                          );
                        })}
                      </div>
                    </div>

                    {srtLineMode !== 'original' && (
                      <div className="space-y-1.5">
                        <span className="block text-[11px] font-bold text-emerald-300 uppercase tracking-wider">
                          ✂️ Cómo Acortar Bloques Largos:
                        </span>
                        <div className="flex flex-wrap gap-1.5">
                          {[
                            {
                              id: 'subdivide' as const,
                              label: '1 Línea Corta Dinámica (Subdividir tiempos)',
                              desc: 'Divide frases largas en captions cortos consecutivos con tiempos proporcionales al milisegundo',
                            },
                            {
                              id: 'wrap' as const,
                              label: '2 Renglones por Bloque (Salto de línea)',
                              desc: 'Mantiene el mismo bloque de tiempo y parte la frase en 2 renglones cortos',
                            },
                          ].map((m) => (
                            <button
                              key={m.id}
                              type="button"
                              title={m.desc}
                              onClick={() => {
                                setSrtLineMode(m.id);
                                if (activeDoc.capcutRawSrt?.trim() && activeDoc.voiceoverScript?.trim()) {
                                  try {
                                    const res = fixCapcutSrtWithVoiceover(
                                      activeDoc.voiceoverScript,
                                      activeDoc.capcutRawSrt,
                                      { maxCharsPerLine: srtMaxChars, mode: m.id }
                                    );
                                    updateActiveDoc({ correctedSrt: res.fixedSrt });
                                    const baseMsg = `✅ ¡SRT Procesado con éxito! ${res.blocksCount} bloques generados (máx. ${srtMaxChars} caract.) • ${res.capcutWordsCount} palabras de CapCut alineadas con las ${res.originalWordsCount} palabras de tu Guion de Etapa 4 (Coincidencia: ${res.similarityPct ?? 100}%).`;
                                    setSrtStatsMsg(res.warningMsg ? `${baseMsg} ${res.warningMsg}` : baseMsg);
                                  } catch {}
                                }
                              }}
                              className={`px-3 py-1.5 rounded-lg text-xs font-bold transition cursor-pointer border ${
                                srtLineMode === m.id
                                  ? 'bg-emerald-500 text-slate-950 border-emerald-400 shadow'
                                  : 'bg-slate-900 hover:bg-slate-800 text-slate-300 border-slate-700'
                              }`}
                            >
                              {m.label}
                            </button>
                          ))}
                        </div>
                      </div>
                    )}
                  </div>

                  {srtStatsMsg && (
                    <div
                      className={`px-4 py-2.5 rounded-xl text-xs font-semibold border ${
                        srtStatsMsg.includes('⚠️')
                          ? 'bg-amber-950/70 border-amber-500/60 text-amber-200'
                          : 'bg-emerald-950/60 border-emerald-600/50 text-emerald-300'
                      }`}
                    >
                      {srtStatsMsg}
                    </div>
                  )}

                  <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                    {/* Input CapCut Raw SRT */}
                    <div className="space-y-2">
                      <label className="block text-xs font-bold text-slate-300">
                        1. Archivo .SRT de CapCut (Con errores de transcripción):
                      </label>
                      <textarea
                        rows={12}
                        value={activeDoc.capcutRawSrt}
                        onChange={(e) => {
                          updateActiveDoc({ capcutRawSrt: e.target.value, correctedSrt: '' });
                          setSrtStatsMsg('');
                        }}
                        placeholder={`Pega o sube aquí el archivo .srt exportado de CapCut...\n\n1\n00:00:06,000 --> 00:00:09,500\naño 1888 callejon de guaitchapel...`}
                        className="w-full bg-slate-950 border border-slate-800 rounded-xl p-3 text-xs font-mono text-slate-300"
                      />
                    </div>

                    {/* Output Corrected SRT */}
                    <div className="space-y-2">
                      <div className="flex items-center justify-between">
                        <label className="block text-xs font-bold text-emerald-300">
                          2. Resultado .SRT Corregido (Timestamps 100% Intactos):
                        </label>
                        <div className="flex items-center gap-2">
                          <button
                            onClick={() => copyText(activeDoc.correctedSrt, 'copy-srt')}
                            className="px-2.5 py-1 rounded bg-slate-800 text-xs text-slate-200 cursor-pointer"
                          >
                            {copiedId === 'copy-srt' ? '✓ Copiado' : '📋 Copiar .SRT'}
                          </button>
                          <button
                            onClick={() => {
                              if (!activeDoc.correctedSrt.trim()) return;
                              triggerFileDownload(
                                activeDoc.correctedSrt,
                                `${activeDoc.srtFileName || 'captions_corregidos'}.srt`,
                                'text/srt;charset=utf-8'
                              );
                            }}
                            className="px-3 py-1 rounded bg-emerald-500 text-slate-950 font-bold text-xs cursor-pointer"
                          >
                            ⬇️ Descargar .SRT
                          </button>
                        </div>
                      </div>
                      <textarea
                        rows={12}
                        value={activeDoc.correctedSrt}
                        onChange={(e) => updateActiveDoc({ correctedSrt: e.target.value })}
                        placeholder="Aquí aparecerá tu archivo .SRT corregido..."
                        className="w-full bg-slate-950 border border-emerald-500/30 rounded-xl p-3 text-xs font-mono text-emerald-200"
                      />
                    </div>
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 pt-2">
                    <button
                      type="button"
                      onClick={() => {
                        try {
                          const res = fixCapcutSrtWithVoiceover(
                            activeDoc.voiceoverScript,
                            activeDoc.capcutRawSrt,
                            { maxCharsPerLine: srtMaxChars, mode: srtLineMode }
                          );
                          updateActiveDoc({ correctedSrt: res.fixedSrt });
                          const baseMsg = `✅ ¡SRT Procesado con éxito! ${res.blocksCount} bloques generados (${srtLineMode === 'original' ? 'largo original' : `máx. ${srtMaxChars} caract.`}) • ${res.capcutWordsCount} palabras de CapCut alineadas con las ${res.originalWordsCount} palabras de tu Guion de Etapa 4 (Coincidencia: ${res.similarityPct ?? 100}%).`;
                          setSrtStatsMsg(
                            res.warningMsg ? `${baseMsg} ${res.warningMsg}` : baseMsg
                          );
                        } catch (err: any) {
                          alert(err.message);
                        }
                      }}
                      className="py-3 rounded-xl bg-amber-500 hover:bg-amber-400 text-slate-950 font-bold text-xs cursor-pointer shadow flex items-center justify-center gap-2"
                    >
                      ⚙️ Procesar .SRT con Guion de Etapa 4
                    </button>

                    <button
                      type="button"
                      disabled={!activeDoc.correctedSrt?.trim()}
                      onClick={() => {
                        if (!activeDoc.correctedSrt?.trim()) {
                          alert('Primero procesa el archivo .SRT para poder descargarlo.');
                          return;
                        }
                        triggerFileDownload(
                          activeDoc.correctedSrt,
                          `${activeDoc.srtFileName || 'captions_corregidos'}.srt`,
                          'text/srt;charset=utf-8'
                        );
                      }}
                      className={`py-3 rounded-xl font-bold text-xs flex items-center justify-center gap-2 shadow transition ${
                        activeDoc.correctedSrt?.trim()
                          ? 'bg-emerald-500 hover:bg-emerald-400 text-slate-950 cursor-pointer'
                          : 'bg-slate-800 text-slate-500 border border-slate-700 cursor-not-allowed'
                      }`}
                    >
                      <Download className="w-4 h-4" />
                      ⬇️ Descargar .SRT Corregido
                    </button>
                  </div>
                </div>
              </div>
            )}

            {/* ===============================================================
                ETAPA 10: BANDA SONORA (SUNO - 6 CAMPOS OBLIGATORIOS)
            =============================================================== */}
            {activeStage === 10 && (
              <div className="space-y-6">
                <div className="bg-[#14120f] border border-slate-800 rounded-2xl p-5 space-y-4">
                  <div className="flex items-center justify-between flex-wrap gap-3">
                    <div className="flex items-center gap-3">
                      <label className="text-xs font-bold text-amber-300">
                        Duración Exacta Final del Video en CapCut:
                      </label>
                      <input
                        type="text"
                        value={activeDoc.confirmedFinalDuration}
                        onChange={(e) =>
                          updateActiveDoc({ confirmedFinalDuration: e.target.value })
                        }
                        placeholder="Ej. 02:00 o 14:30"
                        className="bg-slate-950 border border-amber-500/40 rounded-lg px-3 py-1.5 text-xs font-mono text-white w-28"
                      />
                    </div>
                    <div className="flex items-center gap-2 flex-wrap">
                      <button
                        disabled={aiGenerating}
                        onClick={() => handleGenerateWithGemini(10)}
                        className="px-3.5 py-2 rounded-xl bg-amber-500 hover:bg-amber-400 text-slate-950 font-bold text-xs flex items-center gap-1.5 cursor-pointer"
                      >
                        <Wand2 className="w-3.5 h-3.5" />
                        {aiGenerating ? 'Componiendo Prompts Suno...' : '✨ Generar Prompts Suno con Gemini'}
                      </button>
                      <button
                        type="button"
                        onClick={() =>
                          sendCommandToWebBridge('SUNO', {
                            action: 'SCAN_SUNO_TRACKS',
                          })
                        }
                        className="px-3 py-2 rounded-xl bg-emerald-500/20 hover:bg-emerald-500/30 border border-emerald-500/40 text-emerald-300 text-xs font-bold cursor-pointer"
                        title="Captura automáticamente las pistas MP3 generadas en la pestaña abierta de Suno.com, las guarda en /Audio y las inyecta en la Pista 5 del Editor CapCut"
                      >
                        🔍 Auto-Capturar MP3s de Suno
                      </button>
                      <button
                        onClick={() => {
                          const tracks = parseSunoTracksFromRawText(activeDoc.rawSunoText);
                          if (tracks.length > 0) updateActiveDoc({ sunoTracks: tracks });
                        }}
                        className="px-3 py-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-amber-300 text-xs font-semibold cursor-pointer"
                      >
                        🔍 Separar Pistas del Texto
                      </button>
                      <button
                        onClick={() => {
                          const nextNum = (activeDoc.sunoTracks?.length || 0) + 1;
                          const newTrack: SunoTrack = {
                            id: `suno-${Date.now()}`,
                            trackNumber: nextNum,
                            title: `Pista ${nextNum}: "Ecos del Tiempo"`,
                            duration: '1:30 min',
                            videoTimeRange: '00:00 - 01:30',
                            lyricsPrompt:
                              '[Instrumental]\n[Dark Contemplative Historical Intro]\n[Period Strings and Bone Flute]\n[Fading Outro]',
                            stylePrompt:
                              'Ambient cinematic documentary soundtrack, historical period instrumental, slow tempo 62 bpm, strictly instrumental only, no vocals, no singing, no speech, no lyrics',
                            explanation: '',
                            isGenerated: false,
                          };
                          updateActiveDoc({
                            sunoTracks: [...(activeDoc.sunoTracks || []), newTrack],
                          });
                        }}
                        className="px-3 py-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs cursor-pointer"
                      >
                        + Añadir Pista Suno (1:30)
                      </button>
                    </div>
                  </div>

                  <div className="p-3 rounded-xl bg-amber-500/10 border border-amber-500/30 text-xs text-amber-200 flex flex-wrap items-center justify-between gap-2">
                    <div>
                      <strong className="text-amber-300">🎵 Reglas Activas de Banda Sonora (Suno):</strong>{' '}
                      1) <span className="underline decoration-amber-400/60">Silencios obligatorios entre cada canción</span> (10s–20s de solo voz y Foley entre pista y pista) • 2) <span className="underline decoration-amber-400/60">La última canción es obligatoriamente de solo <strong>1:30</strong></span>.
                    </div>
                  </div>

                  <textarea
                    rows={4}
                    value={activeDoc.rawSunoText}
                    onChange={(e) => updateActiveDoc({ rawSunoText: e.target.value })}
                    placeholder="Pega aquí la entrega de la Etapa 10 (con sus 6 campos por pista) para separarla en tarjetas..."
                    className="w-full bg-slate-950 border border-slate-800 rounded-xl p-3 text-xs font-mono text-slate-300"
                  />
                </div>

                {/* Suno Track Cards */}
                <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
                  {(activeDoc.sunoTracks || []).map((track, idx) => (
                    <div
                      key={track.id}
                      className="bg-[#14120f] border border-slate-800 rounded-2xl p-5 space-y-3"
                    >
                      <div className="flex items-center justify-between gap-2">
                        <input
                          type="text"
                          value={track.title}
                          onChange={(e) => {
                            const next = [...activeDoc.sunoTracks];
                            next[idx] = { ...track, title: e.target.value };
                            updateActiveDoc({ sunoTracks: next });
                          }}
                          className="bg-slate-950 border border-slate-800 rounded-lg px-3 py-1.5 text-sm font-bold text-amber-300 flex-1"
                        />
                        <span className="text-xs font-mono text-slate-400 bg-slate-900 px-2.5 py-1 rounded">
                          {track.videoTimeRange} ({track.duration})
                        </span>
                      </div>

                      <div className="space-y-1">
                        <div className="flex justify-between items-center">
                          <span className="text-xs font-semibold text-slate-300">
                            4. Prompt de Lyrics (Metatags Instrumentales):
                          </span>
                          <button
                            onClick={() => copyText(track.lyricsPrompt, `suno-lyr-${track.id}`)}
                            className="text-[11px] bg-amber-500/20 text-amber-300 px-2 py-0.5 rounded cursor-pointer"
                          >
                            {copiedId === `suno-lyr-${track.id}` ? '✓ Copiado' : '📋 Copiar Lyrics'}
                          </button>
                        </div>
                        <textarea
                          rows={3}
                          value={track.lyricsPrompt}
                          onChange={(e) => {
                            const next = [...activeDoc.sunoTracks];
                            next[idx] = { ...track, lyricsPrompt: e.target.value };
                            updateActiveDoc({ sunoTracks: next });
                          }}
                          className="w-full bg-slate-950 border border-slate-800 rounded-lg p-2.5 text-xs font-mono text-slate-200"
                        />
                      </div>

                      <div className="space-y-1">
                        <div className="flex justify-between items-center">
                          <span className="text-xs font-semibold text-slate-300">
                            5. Prompt de Style (100% Inglés para Suno):
                          </span>
                          <button
                            onClick={() => copyText(track.stylePrompt, `suno-sty-${track.id}`)}
                            className="text-[11px] bg-emerald-500/20 text-emerald-300 px-2 py-0.5 rounded cursor-pointer"
                          >
                            {copiedId === `suno-sty-${track.id}` ? '✓ Copiado' : '📋 Copiar Style'}
                          </button>
                        </div>
                        <textarea
                          rows={3}
                          value={track.stylePrompt}
                          onChange={(e) => {
                            const next = [...activeDoc.sunoTracks];
                            next[idx] = { ...track, stylePrompt: e.target.value };
                            updateActiveDoc({ sunoTracks: next });
                          }}
                          className="w-full bg-slate-950 border border-slate-800 rounded-lg p-2.5 text-xs font-mono text-slate-200"
                        />
                      </div>

                      {/* Auto-Create in Suno or Attach MP3 */}
                      <div className="pt-2 border-t border-slate-800 flex items-center justify-between gap-2 flex-wrap">
                        <div className="flex items-center gap-2 flex-wrap">
                          <button
                            type="button"
                            onClick={() =>
                              handleSendSunoTrackAndCapture(
                                idx + 1,
                                track.stylePrompt || track.lyricsPrompt,
                                track.title
                              )
                            }
                            className="px-3 py-1.5 rounded-lg bg-emerald-500 hover:bg-emerald-400 text-slate-950 font-black text-xs cursor-pointer flex items-center gap-1.5 shadow"
                            title="Envía la pista a Suno.com, vigila cuando termina, descarga Suno_0X.mp3 en /Audio y la coloca en la Pista 5 del Editor CapCut"
                          >
                            🎵 Auto-Crear & Descargar en Suno (Pista 5)
                          </button>
                          <label className="px-3 py-1.5 rounded-lg bg-slate-900 hover:bg-slate-800 text-xs text-amber-300 cursor-pointer flex items-center gap-1.5 border border-slate-700">
                            <Upload className="w-3.5 h-3.5" /> Adjuntar MP3 Manual
                            <input
                              type="file"
                              accept="audio/*"
                              className="hidden"
                              onChange={async (e) => {
                                const f = e.target.files?.[0];
                                if (!f) return;
                                const url = await uploadAssetFile(f);
                                if (url) {
                                  const next = [...activeDoc.sunoTracks];
                                  next[idx] = { ...track, audioUrl: url, isGenerated: true };
                                  updateActiveDoc({ sunoTracks: next });
                                  setCapturedSunoAudioMap((prev) => ({
                                    ...prev,
                                    [idx + 1]: url,
                                  }));
                                }
                              }}
                            />
                          </label>
                        </div>
                        {(capturedSunoAudioMap[idx + 1] || track.audioUrl) && (
                          <audio
                            controls
                            src={capturedSunoAudioMap[idx + 1] || track.audioUrl}
                            className="h-8 flex-1 min-w-[180px]"
                          />
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* ===============================================================
                ETAPA 11: METADATA DE PUBLICACIÓN (4 SECCIONES: YOUTUBE, FACEBOOK, COMENTARIO FIJADO Y TAGS YOUTUBE)
            =============================================================== */}
            {activeStage === 11 && (() => {
              const youtubeMeta = activeDoc.rawYoutubeMetadata ?? activeDoc.rawMetadataText ?? '';
              const facebookMeta = activeDoc.rawFacebookMetadata ?? '';
              const pinnedCommentVal = activeDoc.pinnedComment ?? '';
              const youtubeTagsVal = activeDoc.youtubeTags ?? '';

              const handleExtractTagsAndPinned = () => {
                const sourceText = (youtubeMeta || facebookMeta || '').trim();
                if (!sourceText) {
                  alert('Primero pega o genera la metadata en YouTube o Facebook.');
                  return;
                }
                const lines = sourceText.split(/\r?\n/);
                let hashtagLineIdx = -1;
                for (let i = 0; i < lines.length; i++) {
                  const hashMatches = lines[i].match(/#[A-Za-zÁÉÍÓÚÜÑáéíóúüñ0-9_]+/g);
                  if (hashMatches && hashMatches.length >= 3) {
                    hashtagLineIdx = i;
                  }
                }
                if (hashtagLineIdx === -1 || hashtagLineIdx >= lines.length - 1) {
                  alert('No se detectaron bloques adicionales después de la línea de los 5 hashtags.');
                  return;
                }
                const cleanMain = lines.slice(0, hashtagLineIdx + 1).join('\n').trim();
                const trailingBlocks = lines
                  .slice(hashtagLineIdx + 1)
                  .join('\n')
                  .split(/\n\s*[⠀\s]*\n/)
                  .map((b) => b.replace(/^[⠀\s]+|[⠀\s]+$/g, '').trim())
                  .filter(Boolean);

                let extractedTags = youtubeTagsVal;
                let extractedPinned = pinnedCommentVal;

                for (const block of trailingBlocks) {
                  const commaCount = (block.match(/,/g) || []).length;
                  if (commaCount >= 4 && !block.includes('¿')) {
                    extractedTags = block.replace(/^(?:Tags(?:\s+SEO)?\s*:\s*)/i, '').trim();
                  } else {
                    extractedPinned = block.replace(/^(?:Comentario\s+Fijado\s*:\s*)/i, '').trim();
                  }
                }

                updateActiveDoc({
                  ...(youtubeMeta
                    ? { rawYoutubeMetadata: cleanMain, rawMetadataText: cleanMain }
                    : { rawFacebookMetadata: cleanMain }),
                  youtubeTags: extractedTags,
                  pinnedComment: extractedPinned,
                });
              };

              return (
                <div className="space-y-6">
                  <div className="bg-[#14120f] border border-slate-800 rounded-2xl p-5 flex items-center justify-between flex-wrap gap-3">
                    <div>
                      <h3 className="text-base font-bold text-amber-300">
                        Metadata de Publicación — 4 Secciones Independientes (YouTube, Facebook, Comentario Fijado y Tags)
                      </h3>
                      <p className="text-xs text-slate-400 mt-0.5">
                        <strong className="text-red-300">1) Metadata YouTube</strong> •{' '}
                        <strong className="text-blue-300">2) Metadata Facebook</strong> •{' '}
                        <strong className="text-amber-300">3) Comentario Fijado del Video</strong> •{' '}
                        <strong className="text-emerald-300">4) Tags de YouTube</strong>.{' '}
                        <strong className="text-amber-200">Regla:</strong> No repetir lo mismo entre Miniatura, Título y Texto en pantalla de los primeros 8s (en el resto de la metadata no importa que repita algunas palabras).
                      </p>
                    </div>
                    <div className="flex items-center gap-2 flex-wrap">
                      <button
                        type="button"
                        onClick={handleExtractTagsAndPinned}
                        className="px-3.5 py-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-amber-300 border border-amber-500/30 font-semibold text-xs cursor-pointer"
                        title="Si pegaste un Todo Corrido completo con Tags y Comentario Fijado al final, los separa automáticamente en las secciones 3 y 4"
                      >
                        ✂️ Separar Comentario y Tags del Texto
                      </button>
                      <button
                        type="button"
                        disabled={aiGenerating}
                        onClick={async () => {
                          await handleGenerateWithGemini(111);
                          await handleGenerateWithGemini(112);
                          await handleGenerateWithGemini(113);
                          await handleGenerateWithGemini(114);
                        }}
                        className="px-4 py-2 rounded-xl bg-amber-500 hover:bg-amber-400 text-slate-950 font-bold text-xs flex items-center gap-1.5 cursor-pointer shadow-lg shadow-amber-500/20"
                      >
                        <Wand2 className="w-3.5 h-3.5" />
                        {aiGenerating
                          ? 'Generando las 4 Secciones...'
                          : '✨ Generar Todo (YouTube + Facebook + Comentario + Tags)'}
                      </button>
                    </div>
                  </div>

                  {/* FILA 1: 1. METADATA YOUTUBE Y 2. METADATA FACEBOOK */}
                  <div className="grid grid-cols-1 xl:grid-cols-2 gap-6">
                    {/* ESPACIO 1: METADATA YOUTUBE */}
                    <div className="bg-[#14120f] border border-red-500/30 rounded-2xl p-5 space-y-4 flex flex-col">
                      <div className="flex items-center justify-between flex-wrap gap-2">
                        <div>
                          <div className="flex items-center gap-2">
                            <span className="px-2.5 py-0.5 rounded-full text-[11px] font-extrabold bg-red-500/20 text-red-300 border border-red-500/40">
                              YOUTUBE
                            </span>
                            <h4 className="text-sm font-bold text-amber-300">
                              1. Metadata YouTube
                            </h4>
                          </div>
                          <p className="text-[11px] text-slate-400 mt-1">
                            3000 chars • Título + 3 Párrafos + 10 Capítulos: + Nota IA + Slogan + 5 Hashtags
                          </p>
                        </div>

                        <div className="flex items-center gap-2 flex-wrap">
                          <span className="text-[11px] font-mono px-2.5 py-1 rounded-lg bg-slate-950 border border-slate-800 text-slate-300">
                            {youtubeMeta.length} chars
                          </span>
                          <button
                            type="button"
                            disabled={aiGenerating}
                            onClick={() => handleGenerateWithGemini(111)}
                            className="px-3 py-1.5 rounded-xl bg-red-500/20 hover:bg-red-500/30 text-red-200 border border-red-500/40 font-bold text-xs flex items-center gap-1.5 cursor-pointer"
                          >
                            <Wand2 className="w-3.5 h-3.5" />
                            {aiGenerating ? 'Generando...' : '✨ Generar YouTube'}
                          </button>
                          <button
                            type="button"
                            onClick={() => copyText(youtubeMeta, 'copy-meta-yt')}
                            className="px-3 py-1.5 rounded-xl bg-emerald-500 hover:bg-emerald-400 text-slate-950 font-bold text-xs cursor-pointer"
                          >
                            {copiedId === 'copy-meta-yt' ? '✓ Copiado' : '📋 Copiar YouTube'}
                          </button>
                        </div>
                      </div>

                      <textarea
                        rows={16}
                        value={youtubeMeta}
                        onChange={(e) =>
                          updateActiveDoc({
                            rawYoutubeMetadata: e.target.value,
                            rawMetadataText: e.target.value,
                          })
                        }
                        placeholder="Pega o genera aquí la Metadata de YouTube en formato Todo Corrido con líneas braille (⠀): Título, 3 párrafos, sección 'Capítulos:' con 10 capítulos (00:00 como parte de la historia), Nota IA, Slogan y 5 Hashtags de dos palabras..."
                        className="w-full bg-slate-950 border border-slate-800 focus:border-red-400/60 rounded-xl p-4 text-xs font-mono text-slate-100 leading-relaxed outline-none"
                      />
                    </div>

                    {/* ESPACIO 2: METADATA FACEBOOK */}
                    <div className="bg-[#14120f] border border-blue-500/30 rounded-2xl p-5 space-y-4 flex flex-col">
                      <div className="flex items-center justify-between flex-wrap gap-2">
                        <div>
                          <div className="flex items-center gap-2">
                            <span className="px-2.5 py-0.5 rounded-full text-[11px] font-extrabold bg-blue-500/20 text-blue-300 border border-blue-500/40">
                              FACEBOOK
                            </span>
                            <h4 className="text-sm font-bold text-amber-300">
                              2. Metadata Facebook
                            </h4>
                          </div>
                          <p className="text-[11px] text-slate-400 mt-1">
                            3000 chars • Título + 3 Párrafos + Nota IA + Slogan + 5 Hashtags (Sin Capítulos • Sin Tags)
                          </p>
                        </div>

                        <div className="flex items-center gap-2 flex-wrap">
                          <span className="text-[11px] font-mono px-2.5 py-1 rounded-lg bg-slate-950 border border-slate-800 text-slate-300">
                            {facebookMeta.length} chars
                          </span>
                          <button
                            type="button"
                            disabled={aiGenerating}
                            onClick={() => handleGenerateWithGemini(112)}
                            className="px-3 py-1.5 rounded-xl bg-blue-500/20 hover:bg-blue-500/30 text-blue-200 border border-blue-500/40 font-bold text-xs flex items-center gap-1.5 cursor-pointer"
                          >
                            <Wand2 className="w-3.5 h-3.5" />
                            {aiGenerating ? 'Generando...' : '✨ Generar Facebook'}
                          </button>
                          <button
                            type="button"
                            onClick={() => copyText(facebookMeta, 'copy-meta-fb')}
                            className="px-3 py-1.5 rounded-xl bg-emerald-500 hover:bg-emerald-400 text-slate-950 font-bold text-xs cursor-pointer"
                          >
                            {copiedId === 'copy-meta-fb' ? '✓ Copiado' : '📋 Copiar Facebook'}
                          </button>
                        </div>
                      </div>

                      <textarea
                        rows={16}
                        value={facebookMeta}
                        onChange={(e) =>
                          updateActiveDoc({
                            rawFacebookMetadata: e.target.value,
                          })
                        }
                        placeholder="Pega o genera aquí la Metadata de Facebook en formato Todo Corrido con líneas braille (⠀): Título, 3 párrafos, Nota IA, Slogan y 5 Hashtags de dos palabras (sin capítulos ni bloque de tags)..."
                        className="w-full bg-slate-950 border border-slate-800 focus:border-blue-400/60 rounded-xl p-4 text-xs font-mono text-slate-100 leading-relaxed outline-none"
                      />
                    </div>
                  </div>

                  {/* FILA 2: 3. COMENTARIO FIJADO DEL VIDEO Y 4. TAGS DE YOUTUBE */}
                  <div className="grid grid-cols-1 xl:grid-cols-2 gap-6">
                    {/* ESPACIO 3: COMENTARIO FIJADO DEL VIDEO */}
                    <div className="bg-[#14120f] border border-amber-500/30 rounded-2xl p-5 space-y-4 flex flex-col">
                      <div className="flex items-center justify-between flex-wrap gap-2">
                        <div>
                          <div className="flex items-center gap-2">
                            <span className="px-2.5 py-0.5 rounded-full text-[11px] font-extrabold bg-amber-500/20 text-amber-300 border border-amber-500/40">
                              COMENTARIO FIJADO
                            </span>
                            <h4 className="text-sm font-bold text-amber-300">
                              3. Comentario Fijado del Video
                            </h4>
                          </div>
                          <p className="text-[11px] text-slate-400 mt-1">
                            CTA natural invitando a la audiencia a debatir o contar una experiencia propia (sin etiqueta &quot;Comentario Fijado:&quot;)
                          </p>
                        </div>

                        <div className="flex items-center gap-2 flex-wrap">
                          <span className="text-[11px] font-mono px-2.5 py-1 rounded-lg bg-slate-950 border border-slate-800 text-slate-300">
                            {pinnedCommentVal.length} chars
                          </span>
                          <button
                            type="button"
                            disabled={aiGenerating}
                            onClick={() => handleGenerateWithGemini(113)}
                            className="px-3 py-1.5 rounded-xl bg-amber-500/20 hover:bg-amber-500/30 text-amber-200 border border-amber-500/40 font-bold text-xs flex items-center gap-1.5 cursor-pointer"
                          >
                            <Wand2 className="w-3.5 h-3.5" />
                            {aiGenerating ? 'Generando...' : '✨ Generar Comentario'}
                          </button>
                          <button
                            type="button"
                            onClick={() => copyText(pinnedCommentVal, 'copy-pinned-comment')}
                            className="px-3 py-1.5 rounded-xl bg-emerald-500 hover:bg-emerald-400 text-slate-950 font-bold text-xs cursor-pointer"
                          >
                            {copiedId === 'copy-pinned-comment' ? '✓ Copiado' : '📋 Copiar Comentario'}
                          </button>
                        </div>
                      </div>

                      <textarea
                        rows={6}
                        value={pinnedCommentVal}
                        onChange={(e) =>
                          updateActiveDoc({
                            pinnedComment: e.target.value,
                          })
                        }
                        placeholder="Pega o genera aquí el Comentario Fijado del video (pregunta o llamado a la acción natural que invite a los espectadores a opinar sobre el hecho histórico)..."
                        className="w-full bg-slate-950 border border-slate-800 focus:border-amber-400/60 rounded-xl p-4 text-xs font-mono text-slate-100 leading-relaxed outline-none"
                      />
                    </div>

                    {/* ESPACIO 4: TAGS DE YOUTUBE */}
                    <div className="bg-[#14120f] border border-emerald-500/30 rounded-2xl p-5 space-y-4 flex flex-col">
                      <div className="flex items-center justify-between flex-wrap gap-2">
                        <div>
                          <div className="flex items-center gap-2">
                            <span className="px-2.5 py-0.5 rounded-full text-[11px] font-extrabold bg-emerald-500/20 text-emerald-300 border border-emerald-500/40">
                              TAGS SEO YOUTUBE
                            </span>
                            <h4 className="text-sm font-bold text-amber-300">
                              4. Tags de YouTube
                            </h4>
                          </div>
                          <p className="text-[11px] text-slate-400 mt-1">
                            Bloque de 500 caracteres de etiquetas SEO separadas por comas (sin etiqueta &quot;Tags:&quot;)
                          </p>
                        </div>

                        <div className="flex items-center gap-2 flex-wrap">
                          <span
                            className={`text-[11px] font-mono px-2.5 py-1 rounded-lg border ${
                              youtubeTagsVal.length > 500
                                ? 'bg-rose-950/60 border-rose-500/50 text-rose-300 font-bold'
                                : 'bg-slate-950 border-slate-800 text-slate-300'
                            }`}
                          >
                            {youtubeTagsVal.length} / 500 chars
                          </span>
                          <button
                            type="button"
                            disabled={aiGenerating}
                            onClick={() => handleGenerateWithGemini(114)}
                            className="px-3 py-1.5 rounded-xl bg-emerald-500/20 hover:bg-emerald-500/30 text-emerald-200 border border-emerald-500/40 font-bold text-xs flex items-center gap-1.5 cursor-pointer"
                          >
                            <Wand2 className="w-3.5 h-3.5" />
                            {aiGenerating ? 'Generando...' : '✨ Generar Tags'}
                          </button>
                          <button
                            type="button"
                            onClick={() => copyText(youtubeTagsVal, 'copy-yt-tags')}
                            className="px-3 py-1.5 rounded-xl bg-emerald-500 hover:bg-emerald-400 text-slate-950 font-bold text-xs cursor-pointer"
                          >
                            {copiedId === 'copy-yt-tags' ? '✓ Copiado' : '📋 Copiar Tags'}
                          </button>
                        </div>
                      </div>

                      <textarea
                        rows={6}
                        value={youtubeTagsVal}
                        onChange={(e) =>
                          updateActiveDoc({
                            youtubeTags: e.target.value,
                          })
                        }
                        placeholder="Pega o genera aquí los Tags de YouTube separados por comas (máximo 500 caracteres contando espacios y comas)..."
                        className="w-full bg-slate-950 border border-slate-800 focus:border-emerald-400/60 rounded-xl p-4 text-xs font-mono text-slate-100 leading-relaxed outline-none"
                      />
                    </div>
                  </div>
                </div>
              );
            })()}

            {/* ===============================================================
                ETAPA 12: ASISTENCIA POST-PRODUCCIÓN PARA RESPONDER COMENTARIOS DE LA AUDIENCIA
            =============================================================== */}
            {activeStage === 12 && (
              <div className="space-y-6">
                <div
                  className="bg-[#14120f] border border-amber-500/30 rounded-2xl p-6 space-y-4"
                  onPaste={(e) => {
                    const items = e.clipboardData?.items;
                    if (!items) return;
                    for (let i = 0; i < items.length; i++) {
                      const item = items[i];
                      if (item.type.startsWith('image/')) {
                        const file = item.getAsFile();
                        if (!file) continue;
                        const reader = new FileReader();
                        reader.onload = () => {
                          if (typeof reader.result === 'string') {
                            setCommentImageBase64(reader.result);
                            setCommentImageMime(file.type || 'image/png');
                          }
                        };
                        reader.readAsDataURL(file);
                        break;
                      }
                    }
                  }}
                >
                  <div className="flex items-start justify-between flex-wrap gap-3">
                    <div>
                      <span className="text-[10px] uppercase tracking-wider text-amber-400 font-bold">
                        Etapa 12 Post-Producción • Comunidad e Interacción
                      </span>
                      <h3 className="text-base font-bold text-amber-300 mt-0.5">
                        Respuestas Certeras y Concisas a Comentarios de la Audiencia (Capturas o Texto)
                      </h3>
                      <p className="text-xs text-slate-400 mt-1 max-w-3xl">
                        Sube o pega con <kbd className="px-1.5 py-0.5 bg-slate-800 rounded text-amber-300 font-mono">Cmd+V / Ctrl+V</kbd> capturas de pantalla de los comentarios de tus espectadores en el video (o pega el texto del comentario). La IA leerá las capturas y te redactará respuestas <strong>certeras, históricamente rigurosas y concisas</strong> (1 a 3 oraciones, años en dígitos, siglos y monarcas en números romanos, y cero signos de exclamación).
                      </p>
                    </div>
                  </div>

                  <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
                    {/* Left: Screenshot Upload / Paste Zone */}
                    <div className="space-y-3">
                      <label className="block text-xs font-semibold text-slate-300">
                        1. Captura de Pantalla del Comentario (Sube o pega con Cmd+V)
                      </label>
                      <div className="min-h-[190px] bg-slate-950 border-2 border-dashed border-amber-500/30 hover:border-amber-500/60 rounded-xl p-4 flex flex-col items-center justify-center gap-3 relative transition">
                        {commentImageBase64 ? (
                          <div className="w-full space-y-2 text-center">
                            <img
                              src={commentImageBase64}
                              alt="Captura de comentarios"
                              className="max-h-56 mx-auto rounded-lg border border-slate-800 object-contain"
                            />
                            <button
                              type="button"
                              onClick={() => setCommentImageBase64('')}
                              className="px-3 py-1 rounded-lg bg-rose-950/70 hover:bg-rose-900 text-rose-200 text-xs cursor-pointer"
                            >
                              ✕ Quitar Captura
                            </button>
                          </div>
                        ) : (
                          <>
                            <ImageIcon className="w-8 h-8 text-amber-400/60" />
                            <div className="text-center space-y-1">
                              <p className="text-xs text-slate-300 font-medium">
                                Pega aquí tu captura de pantalla (<code className="text-amber-300">Cmd+V</code>) o selecciona una imagen
                              </p>
                              <p className="text-[11px] text-slate-500">
                                Soporta capturas de YouTube, Instagram, TikTok o Facebook con uno o varios comentarios
                              </p>
                            </div>
                            <label className="px-3.5 py-1.5 rounded-lg bg-slate-900 hover:bg-slate-800 border border-amber-500/30 text-amber-300 text-xs font-semibold cursor-pointer flex items-center gap-1.5">
                              <Upload className="w-3.5 h-3.5" /> Subir Captura de Comentarios
                              <input
                                type="file"
                                accept="image/*"
                                className="hidden"
                                onChange={(e) => {
                                  const f = e.target.files?.[0];
                                  if (!f) return;
                                  const reader = new FileReader();
                                  reader.onload = () => {
                                    if (typeof reader.result === 'string') {
                                      setCommentImageBase64(reader.result);
                                      setCommentImageMime(f.type || 'image/png');
                                    }
                                  };
                                  reader.readAsDataURL(f);
                                }}
                              />
                            </label>
                          </>
                        )}
                      </div>
                    </div>

                    {/* Right: Optional Text Comment & Focus */}
                    <div className="space-y-3 flex flex-col justify-between">
                      <div className="space-y-3">
                        <div>
                          <label className="block text-xs font-semibold text-slate-300 mb-1">
                            2. O escribe / pega el comentario en texto (Opcional si subiste captura)
                          </label>
                          <textarea
                            rows={4}
                            value={commentInputText}
                            onChange={(e) => setCommentInputText(e.target.value)}
                            placeholder="Ej. @usuario: ¿Pero acaso no fue en el siglo XV cuando ocurrió realmente ese tratado?..."
                            className="w-full bg-slate-950 border border-slate-800 rounded-xl p-3 text-xs text-slate-100"
                          />
                        </div>

                        <div>
                          <label className="block text-xs font-semibold text-slate-400 mb-1">
                            Enfoque o instrucción adicional (Opcional)
                          </label>
                          <input
                            type="text"
                            value={commentCustomFocus}
                            onChange={(e) => setCommentCustomFocus(e.target.value)}
                            placeholder="Ej. Agradecerle el aporte y aclararle la fecha exacta según nuestra investigación..."
                            className="w-full bg-slate-950 border border-slate-800 rounded-lg px-3 py-2 text-xs text-slate-200"
                          />
                        </div>
                      </div>

                      <button
                        disabled={commentReplying || (!commentImageBase64 && !commentInputText.trim())}
                        onClick={async () => {
                          if (!commentImageBase64 && !commentInputText.trim()) return;
                          setCommentReplying(true);
                          try {
                            let data: any = null;
                            if (!isCloudMode) {
                              try {
                                const res = await fetch('/api/ai/reply-comments', {
                                  method: 'POST',
                                  headers: { 'Content-Type': 'application/json' },
                                  body: JSON.stringify({
                                    documentary: activeDoc,
                                    commentText: commentInputText,
                                    imageBase64: commentImageBase64,
                                    mimeType: commentImageMime,
                                    customInstruction: commentCustomFocus,
                                  }),
                                });
                                if ((res.headers.get('content-type') || '').includes('application/json')) {
                                  data = await res.json();
                                  if (!res.ok) {
                                    alert(data.error || 'Error al generar respuesta para los comentarios.');
                                    return;
                                  }
                                }
                              } catch {}
                            }
                            if (!data) {
                              data = await replyCommentsClientSide(
                                activeDoc,
                                commentInputText,
                                commentImageBase64,
                                commentImageMime,
                                commentCustomFocus
                              );
                            }
                            const newItems: AudienceCommentReply[] = (data.replies || []).map(
                              (r: any, idx: number) => ({
                                id: `reply-${Date.now()}-${idx}`,
                                author: r.author || 'Audiencia',
                                commentText: r.commentText || commentInputText || 'Comentario en captura',
                                replyConcise: r.replyConcise || '',
                                replyAlternative: r.replyAlternative || '',
                                historicalContextNote: r.historicalContextNote || '',
                                imagePreviewUrl: idx === 0 && commentImageBase64 ? commentImageBase64 : undefined,
                                createdAt: new Date().toISOString(),
                              })
                            );
                            if (newItems.length > 0) {
                              updateActiveDoc({
                                commentReplies: [...newItems, ...(activeDoc.commentReplies || [])],
                              });
                              setCommentInputText('');
                              setCommentCustomFocus('');
                            }
                          } catch (err: any) {
                            alert('Error al conectar con la IA: ' + err.message);
                          } finally {
                            setCommentReplying(false);
                          }
                        }}
                        className="w-full py-3 rounded-xl bg-amber-500 hover:bg-amber-400 disabled:opacity-50 text-slate-950 font-bold text-xs flex items-center justify-center gap-2 shadow-lg cursor-pointer"
                      >
                        <Wand2 className="w-4 h-4" />
                        {commentReplying
                          ? 'Analizando comentario y redactando respuesta certera...'
                          : '✨ Generar Respuesta Certera y Concisa con Gemini'}
                      </button>
                    </div>
                  </div>
                </div>

                {/* Saved Replies History for this Documentary */}
                <div className="space-y-3">
                  <div className="flex items-center justify-between">
                    <h4 className="text-sm font-bold text-amber-300">
                      Respuestas Generadas para este Documental ({(activeDoc.commentReplies || []).length})
                    </h4>
                  </div>

                  {(activeDoc.commentReplies || []).length === 0 ? (
                    <div className="bg-[#14120f] border border-dashed border-slate-800 rounded-2xl p-8 text-center text-xs text-slate-400">
                      Aún no has procesado comentarios para este episodio. Sube o pega una captura arriba después de publicar el video para recibir respuestas listas para copiar y pegar.
                    </div>
                  ) : (
                    <div className="space-y-4">
                      {(activeDoc.commentReplies || []).map((item) => (
                        <div
                          key={item.id}
                          className="bg-[#14120f] border border-slate-800 rounded-2xl p-5 space-y-3"
                        >
                          <div className="flex items-start justify-between gap-3">
                            <div className="space-y-1">
                              <span className="text-xs font-bold text-amber-300">
                                💬 {item.author || 'Comentario de la Audiencia'}
                              </span>
                              <p className="text-xs text-slate-300 bg-slate-950 border border-slate-800/80 rounded-lg px-3 py-2">
                                "{item.commentText}"
                              </p>
                            </div>
                            <button
                              onClick={() =>
                                updateActiveDoc({
                                  commentReplies: (activeDoc.commentReplies || []).filter(
                                    (r) => r.id !== item.id
                                  ),
                                })
                              }
                              className="text-slate-500 hover:text-rose-400 p-1 cursor-pointer"
                              title="Eliminar respuesta"
                            >
                              <Trash2 className="w-4 h-4" />
                            </button>
                          </div>

                          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                            <div className="bg-slate-950 border border-emerald-500/30 rounded-xl p-3.5 space-y-2">
                              <div className="flex items-center justify-between">
                                <span className="text-[11px] font-bold text-emerald-400 uppercase tracking-wide">
                                  ✅ Opción 1: Respuesta Certera y Concisa
                                </span>
                                <button
                                  onClick={() => copyText(item.replyConcise, `rep-1-${item.id}`)}
                                  className="px-2.5 py-1 rounded bg-emerald-500/20 text-emerald-300 text-[11px] font-semibold cursor-pointer"
                                >
                                  {copiedId === `rep-1-${item.id}` ? '✓ Copiada' : '📋 Copiar Respuesta'}
                                </button>
                              </div>
                              <p className="text-xs text-slate-100 leading-relaxed">
                                {item.replyConcise}
                              </p>
                            </div>

                            {item.replyAlternative && (
                              <div className="bg-slate-950 border border-amber-500/30 rounded-xl p-3.5 space-y-2">
                                <div className="flex items-center justify-between">
                                  <span className="text-[11px] font-bold text-amber-300 uppercase tracking-wide">
                                    🔥 Opción 2: Con Cierre de Debate / Engagement
                                  </span>
                                  <button
                                    onClick={() =>
                                      copyText(item.replyAlternative || '', `rep-2-${item.id}`)
                                    }
                                    className="px-2.5 py-1 rounded bg-amber-500/20 text-amber-300 text-[11px] font-semibold cursor-pointer"
                                  >
                                    {copiedId === `rep-2-${item.id}` ? '✓ Copiada' : '📋 Copiar Opción 2'}
                                  </button>
                                </div>
                                <p className="text-xs text-slate-100 leading-relaxed">
                                  {item.replyAlternative}
                                </p>
                              </div>
                            )}
                          </div>

                          {item.historicalContextNote && (
                            <div className="text-[11px] text-slate-400 font-mono bg-slate-900/70 px-3 py-1.5 rounded-lg">
                              📚 Respaldo histórico: {item.historicalContextNote}
                            </div>
                          )}
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            )}
          </section>

          <WebStudioDrawer
            isOpen={showWebStudio}
            onClose={() => setShowWebStudio(false)}
            activeStage={activeStage}
            stageTitle={
              STAGES_LIST.find((s) => s.num === activeStage)?.title || `Etapa ${activeStage}`
            }
            extensionInstalled={extensionInstalled}
            aiEngineMode={aiEngineMode}
            onChangeAiEngineMode={setAiEngineMode}
            onSendCurrentStageToGemini={(tabId) => handleSendStageToGeminiWeb(activeStage, tabId)}
            onGrabLastGeminiResponse={(tabId) => {
              sendCommandToWebBridge('GEMINI', {
                action: 'GRAB_LAST_RESPONSE',
                stageNumber: activeStage,
                tabId: tabId || selectedGeminiTabId,
              });
            }}
            onSendCustomPromptToFlow={(prompt, tabId) =>
              handleSendPromptToFlow(prompt, 'VIDEO', 'custom', tabId)
            }
            bridgeStatusMsg={bridgeStatusMsg}
            bridgeStatusType={bridgeStatusType}
            geminiTabs={geminiTabs}
            flowTabs={flowTabs}
            selectedGeminiTabId={selectedGeminiTabId}
            onSelectGeminiTabId={setSelectedGeminiTabId}
            selectedFlowTabId={selectedFlowTabId}
            onSelectFlowTabId={setSelectedFlowTabId}
            lastMirroredGeminiText={lastMirroredGeminiText}
            lastMirroredGeminiImages={lastMirroredGeminiImages}
            lastMirroredFlowVideos={lastMirroredFlowVideos}
            lastMirroredFlowImages={lastMirroredFlowImages}
          />
        </div>
      )}
    </div>
  );
}
