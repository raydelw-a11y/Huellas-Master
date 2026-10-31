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
  prompt?: string;
  imagePrompt?: string;
  aspectRatio?: '16:9' | '9:16';
  stageNumber?: number;
  taskType?: string;
  clipNumber?: number | string;
  clipId?: string;
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

export function sendCommandToWebBridge(
  targetService: WebServiceTarget,
  payload: WebBridgeCommandPayload
): string {
  const requestId = `req-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
  // Prevent Quill/Rich-Textarea in Gemini Web from treating '\n' in execCommand('insertText') as an Enter key press that submits after line 1
  const safePayload: WebBridgeCommandPayload =
    targetService === 'GEMINI' &&
    payload.action === 'SEND_PROMPT' &&
    typeof payload.prompt === 'string'
      ? {
          ...payload,
          prompt: payload.prompt
            .replace(/\r\n/g, '\n')
            .split('\n')
            .map((line) => line.trim())
            .filter(Boolean)
            .join('   |   '),
        }
      : payload;

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

export const CHROME_EXTENSION_FOLDER_PATH =
  '/Users/raydelsantana/antigravity/Huellas Master/chrome-extension';
