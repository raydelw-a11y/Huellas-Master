// ============================================================================
// HUELLAS MASTER — WEB STUDIO BRIDGE (GEMINI WEB & GOOGLE FLOW FREE QUOTA)
// Connects the React app to the Huellas Master Chrome Extension
// ============================================================================

export type WebServiceTarget = 'GEMINI' | 'FLOW' | 'SUNO';

export interface ConnectedAiTab {
  id: number;
  windowId?: number;
  title: string;
  url: string;
}

export interface WebBridgeReferenceQueueItem {
  id: string;
  tag: string;
  name: string;
  category: 'persona' | 'lugar';
  prompt: string;
  formattedPrompt: string;
}

export interface WebBridgeCommandPayload {
  action:
    | 'SEND_PROMPT'
    | 'RENAME_GEMINI_CHAT'
    | 'SYNC_STAGE11_FROM_GEMINI'
    | 'LOAD_STORY_STUDIO_PROJECT'
    | 'GRAB_LAST_RESPONSE'
    | 'GRAB_LAST_MEDIA'
    | 'SCAN_FLOW_VIDEOS'
    | 'SCAN_FLOW_THUMBNAILS'
    | 'SCAN_FLOW_REFERENCES'
    | 'SCAN_SUNO_TRACKS'
    | 'STOP_FLOW_WATCHER'
    | 'OPEN_DOCKED'
    | 'FOCUS_TAB';
  docId?: string;
  videoName?: string;
  oldVideoName?: string;
  deepResearchVideoName?: string;
  geminiChatUrl?: string;
  geminiDeepResearchChatUrl?: string;
  notebookName?: string;
  prompt?: string;
  imagePrompt?: string;
  aspectRatio?: '16:9' | '9:16';
  stageNumber?: number;
  taskType?: string;
  enableHighModel?: boolean;
  enableArgonLow?: boolean;
  enableCarbonLow?: boolean;
  preferredModel?: string;
  thinkingLevel?: 'LOW' | 'MEDIUM' | 'HIGH';
  enableDeepResearch?: boolean;
  skipModelSwitch?: boolean;
  clipNumber?: number | string;
  clipId?: string;
  timeRange?: string;
  durationSeconds?: number;
  attempt?: number;
  watchForVideo?: boolean;
  mediaType?: 'IMAGE' | 'VIDEO' | 'THUMBNAILS' | 'REFERENCES';
  referenceId?: string;
  referenceTag?: string;
  referenceTags?: string[];
  referenceItems?: WebBridgeReferenceQueueItem[];
  referenceAssetsForClips?: Array<{
    id: string;
    tag: string;
    name: string;
    imageUrl?: string;
  }>;
  batchClipsData?: Array<{
    id: string;
    clipNumber: number;
    imagePrompt: string;
    videoPrompt: string;
    timeRange?: string;
  }>;
  storyStudioProjectJson?: string;
  storyStudioTargetTab?: 'assets' | 'storyboard';
  autoCreateImages?: boolean;
  batchStartClip?: number;
  batchEndClip?: number;
  expectedCount?: number;
  trackNumber?: number;
  trackTitle?: string;
  optionLabel?: string;
  logoDataUrl?: string;
  autoSubmit?: boolean;
  preferDockedWindow?: boolean;
  focusTab?: boolean;
  tabId?: number;
}

export function isHuellasExtensionDetected(): boolean {
  if (typeof document === 'undefined') return false;
  return document.documentElement.getAttribute('data-huellas-extension') === 'installed';
}

export function pingHuellasExtension(): void {
  if (typeof window === 'undefined') return;
  window.postMessage(
    {
      source: 'HUELLAS_APP',
      type: 'HUELLAS_PING_V2',
    },
    '*'
  );
  window.postMessage(
    {
      source: 'HUELLAS_APP',
      type: 'HUELLAS_PING',
    },
    '*'
  );
}

export interface ActiveGeminiDocContext {
  docId: string;
  videoName: string;
  geminiChatUrl?: string;
  geminiDeepResearchChatUrl?: string;
  notebookName?: string;
}

let activeGeminiDocContext: ActiveGeminiDocContext | null = null;

export function setActiveGeminiDocContext(ctx: ActiveGeminiDocContext | null): void {
  activeGeminiDocContext = ctx;
  if (typeof window !== 'undefined') {
    (window as any).__HUELLAS_ACTIVE_DOC_GEMINI_CTX__ = ctx;
  }
}

export function sendCommandToWebBridge(
  targetService: WebServiceTarget,
  payload: WebBridgeCommandPayload
): string {
  const requestId = `req-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
  const ctx =
    activeGeminiDocContext ||
    (typeof window !== 'undefined' ? (window as any).__HUELLAS_ACTIVE_DOC_GEMINI_CTX__ : null);

  const rawBaseName = String(payload.videoName || ctx?.videoName || '')
    .replace(/_\s*Deep\s*Research$/i, '')
    .trim();
  const deepResearchName = rawBaseName ? `${rawBaseName}_Deep Research` : '';

  const enrichedPayload: WebBridgeCommandPayload =
    targetService === 'GEMINI' && ctx
      ? {
          docId: ctx.docId,
          videoName: rawBaseName || ctx.videoName,
          deepResearchVideoName: deepResearchName,
          geminiChatUrl: ctx.geminiChatUrl || '',
          geminiDeepResearchChatUrl: ctx.geminiDeepResearchChatUrl || '',
          notebookName: ctx.notebookName || 'Huellas de la Humanidad',
          ...payload,
        }
      : {
          ...payload,
          ...(rawBaseName ? { videoName: rawBaseName, deepResearchVideoName: deepResearchName } : {}),
        };

  // Prevent Quill/Rich-Textarea in Gemini Web from treating '\n' in execCommand('insertText') as an Enter key press that submits after line 1
  const safePayload: WebBridgeCommandPayload =
    targetService === 'GEMINI' &&
    enrichedPayload.action === 'SEND_PROMPT' &&
    typeof enrichedPayload.prompt === 'string'
      ? {
          ...enrichedPayload,
          prompt: enrichedPayload.prompt
            .replace(/\r\n/g, '\n')
            .split('\n')
            .map((line) => line.trim())
            .filter(Boolean)
            .join('   |   '),
        }
      : enrichedPayload;

  if (typeof window !== 'undefined') {
    window.postMessage(
      {
        source: 'HUELLAS_APP',
        type: 'HUELLAS_COMMAND',
        requestId,
        targetService,
        payload: safePayload,
      },
      '*'
    );
  }
  return requestId;
}

export interface LocalApiProxyResult {
  ok: boolean;
  status: number;
  data?: any;
  error?: string;
}

// Llama al servidor local (http://localhost:4200) a través de la extensión cuando el fetch directo
// desde la página pública está bloqueado (Local Network Access / Private Network Access)
export function callLocalApiViaExtension(
  path: string,
  method: 'GET' | 'POST',
  body?: unknown,
  timeoutMs = 20000
): Promise<LocalApiProxyResult> {
  return new Promise((resolve) => {
    if (typeof window === 'undefined' || !isHuellasExtensionDetected()) {
      resolve({ ok: false, status: 0, error: 'extensión Huellas no detectada' });
      return;
    }
    const requestId = `api-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
    const onMsg = (ev: MessageEvent) => {
      const d = ev.data;
      if (ev.source !== window || !d || d.source !== 'HUELLAS_EXTENSION') return;
      if (d.type !== 'HUELLAS_LOCAL_API_RESULT' || d.requestId !== requestId) return;
      window.removeEventListener('message', onMsg);
      clearTimeout(timer);
      resolve({ ok: Boolean(d.ok), status: Number(d.status) || 0, data: d.data, error: d.error });
    };
    const timer = setTimeout(() => {
      window.removeEventListener('message', onMsg);
      resolve({ ok: false, status: 0, error: 'timeout esperando a la extensión' });
    }, timeoutMs);
    window.addEventListener('message', onMsg);
    window.postMessage(
      { source: 'HUELLAS_APP', type: 'HUELLAS_LOCAL_API', requestId, path, method, body },
      '*'
    );
  });
}

export const CHROME_EXTENSION_FOLDER_PATH =
  '/Users/raydelsantana/antigravity/Huellas Master/chrome-extension';
