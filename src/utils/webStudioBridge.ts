// ============================================================================
// HUELLAS MASTER — WEB STUDIO BRIDGE (GEMINI WEB & GOOGLE FLOW FREE QUOTA)
// Connects the React app to the Huellas Master Chrome Extension
// ============================================================================

export type WebServiceTarget = 'GEMINI' | 'FLOW';

export interface ConnectedAiTab {
  id: number;
  windowId?: number;
  title: string;
  url: string;
}

export interface WebBridgeCommandPayload {
  action:
    | 'SEND_PROMPT'
    | 'GRAB_LAST_RESPONSE'
    | 'GRAB_LAST_MEDIA'
    | 'SCAN_FLOW_VIDEOS'
    | 'STOP_FLOW_WATCHER'
    | 'OPEN_DOCKED'
    | 'FOCUS_TAB';
  prompt?: string;
  stageNumber?: number;
  taskType?: string;
  clipNumber?: number | string;
  clipId?: string;
  attempt?: number;
  watchForVideo?: boolean;
  mediaType?: 'IMAGE' | 'VIDEO';
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
  if (typeof window !== 'undefined') {
    window.postMessage(
      {
        source: 'HUELLAS_APP',
        type: 'HUELLAS_COMMAND',
        requestId,
        targetService,
        payload,
      },
      '*'
    );
  }
  return requestId;
}

export const CHROME_EXTENSION_FOLDER_PATH =
  '/Users/raydelsantana/antigravity/Huellas Master/chrome-extension';
