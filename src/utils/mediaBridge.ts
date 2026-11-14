// ============================================================================
// HUELLAS MASTER — LIVE MAC MEDIA BRIDGE UTILITIES
// Transport-decoupled media resolution, auto-discovery & origin rewriting
// ============================================================================

import {
  isLocalRuntimeOrigin,
  REMOTE_MAC_RELAY_URL,
  REMOTE_MAC_ACK_URL,
} from './cloudSync';

export interface MediaBridgeConfig {
  activeOrigin: string;
  generation: number;
  lastUpdated: number;
}

export interface MediaBridgeProbeResult {
  ok: boolean;
  origin: string;
  latencyMs: number;
}

export type MediaBridgeListener = (config: MediaBridgeConfig) => void;
export type MediaBridgeSnapshot = MediaBridgeConfig;

export interface StudioBridgeDecrypted {
  tunnelUrl: string;
  lanUrl: string;
  updatedAt: number;
}

const STORAGE_KEY_LIVE_TUNNEL = 'huellas_live_media_tunnel_v1';
const STORAGE_KEY_FLOW_PC_SESSION = 'huellas_flow_pc_session_v1';

let mediaBridgeGeneration = 0;
let cachedActiveOrigin = '';
const deadOriginsSet = new Set<string>();
let inFlightTunnelDiscovery: Promise<string> | null = null;
let lastRelayWakeAttempt = 0;
const mediaBridgeListeners = new Set<MediaBridgeListener>();

function notifyMediaBridgeListeners(): void {
  const cfg: MediaBridgeConfig = {
    activeOrigin: cachedActiveOrigin,
    generation: mediaBridgeGeneration,
    lastUpdated: Date.now(),
  };
  mediaBridgeListeners.forEach((listener) => {
    try {
      listener(cfg);
    } catch {}
  });
}

export function isLocalMediaRuntimeOrigin(): boolean {
  return isLocalRuntimeOrigin();
}

export function getMediaBridgeSnapshot(): MediaBridgeSnapshot {
  return {
    activeOrigin: cachedActiveOrigin,
    generation: mediaBridgeGeneration,
    lastUpdated: Date.now(),
  };
}

export function getMediaBridgeGeneration(): number {
  return mediaBridgeGeneration;
}

export function subscribeMediaBridge(listener: MediaBridgeListener): () => void {
  mediaBridgeListeners.add(listener);
  return () => {
    mediaBridgeListeners.delete(listener);
  };
}

export function getStoredMediaBridgeTunnel(): string {
  if (typeof window === 'undefined') return '';
  try {
    return String(localStorage.getItem(STORAGE_KEY_LIVE_TUNNEL) || '')
      .trim()
      .replace(/\/+$/, '');
  } catch {
    return '';
  }
}

export function persistDiscoveredMediaBridgeTunnel(url: string): void {
  const clean = String(url || '').trim().replace(/\/+$/, '');
  if (!clean) return;
  deadOriginsSet.delete(clean);
  cachedActiveOrigin = clean;
  mediaBridgeGeneration++;
  try {
    if (typeof window !== 'undefined') {
      localStorage.setItem(STORAGE_KEY_LIVE_TUNNEL, clean);
    }
  } catch {}
  notifyMediaBridgeListeners();
}

export const persistDiscoveredMacTunnel = persistDiscoveredMediaBridgeTunnel;

export function evictDeadMediaBridgeOrigin(origin?: string | null): void {
  const target = origin ? String(origin).trim().replace(/\/+$/, '') : (cachedActiveOrigin || getStoredMediaBridgeTunnel());
  if (!target) return;
  deadOriginsSet.add(target);
  let changed = false;
  if (cachedActiveOrigin === target) {
    cachedActiveOrigin = '';
    changed = true;
  }
  try {
    if (typeof window !== 'undefined') {
      const stored = localStorage.getItem(STORAGE_KEY_LIVE_TUNNEL);
      if (stored && stored.trim().replace(/\/+$/, '') === target) {
        localStorage.removeItem(STORAGE_KEY_LIVE_TUNNEL);
        changed = true;
      }
    }
  } catch {}
  if (changed) {
    mediaBridgeGeneration++;
    notifyMediaBridgeListeners();
  }
}

export function getMediaBridgeCandidateTimeoutMs(origin: string): number {
  const clean = String(origin || '').trim();
  if (!clean) return 3500;
  if (
    clean === 'http://localhost:4200' ||
    /^http:\/\/(localhost|127\.0\.0\.1)(:|\/|$)/i.test(clean)
  ) {
    return 2200;
  }
  return 6500;
}

export async function probeMediaBridgeOrigin(
  origin: string,
  timeoutMs?: number
): Promise<boolean> {
  const clean = String(origin || '').trim().replace(/\/+$/, '');
  if (!clean || !/^https?:\/\//i.test(clean)) return false;
  if (
    typeof window !== 'undefined' &&
    window.location.protocol === 'https:' &&
    /^http:\/\//i.test(clean) &&
    !/^http:\/\/(localhost|127\.0\.0\.1)(:|\/|$)/i.test(clean)
  ) {
    return false;
  }
  const effectiveTimeout = timeoutMs || getMediaBridgeCandidateTimeoutMs(clean);
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), effectiveTimeout);
  try {
    const res = await fetch(`${clean}/api/flow-pc/ping?t=${Date.now()}`, {
      signal: ctrl.signal,
      cache: 'no-store',
    });
    if (!res.ok) return false;
    const d = await res.json().catch(() => null);
    return Boolean(d?.ok);
  } catch {
    return false;
  } finally {
    clearTimeout(timer);
  }
}

export async function decryptStudioMediaBridgeBox(
  box: { ivB64?: string; ctB64?: string } | null | undefined
): Promise<StudioBridgeDecrypted | null> {
  try {
    if (!box?.ivB64 || !box?.ctB64) return null;
    if (typeof window === 'undefined' || !window.crypto?.subtle) return null;
    const b64ToBuf = (b64: string) => {
      const bin = atob(b64);
      const ab = new ArrayBuffer(bin.length);
      const u8 = new Uint8Array(ab);
      for (let i = 0; i < bin.length; i++) u8[i] = bin.charCodeAt(i);
      return u8;
    };
    const enc = new TextEncoder();
    const baseKey = await window.crypto.subtle.importKey(
      'raw',
      enc.encode('admin123'),
      'PBKDF2',
      false,
      ['deriveKey']
    );
    const aesKey = await window.crypto.subtle.deriveKey(
      {
        name: 'PBKDF2',
        salt: enc.encode('huellas-studio-media-bridge-v1'),
        iterations: 10000,
        hash: 'SHA-256',
      },
      baseKey,
      { name: 'AES-GCM', length: 256 },
      false,
      ['decrypt']
    );
    const plainBuf = await window.crypto.subtle.decrypt(
      { name: 'AES-GCM', iv: b64ToBuf(box.ivB64), tagLength: 128 },
      aesKey,
      b64ToBuf(box.ctB64)
    );
    const parsed = JSON.parse(new TextDecoder().decode(plainBuf));
    return {
      tunnelUrl: String(parsed?.tunnelUrl || '')
        .trim()
        .replace(/\/+$/, ''),
      lanUrl: String(parsed?.lanUrl || '')
        .trim()
        .replace(/\/+$/, ''),
      updatedAt: Number(parsed?.updatedAt || 0),
    };
  } catch {
    return null;
  }
}

export async function refreshLiveMacMediaTunnelUrl(options?: {
  force?: boolean;
  allowRelayWake?: boolean;
}): Promise<string> {
  if (inFlightTunnelDiscovery && !options?.force) {
    return inFlightTunnelDiscovery;
  }

  const task = (async () => {
    const candidates = [
      `./data/flow_pc_tunnel.enc.json?t=${Date.now()}`,
      `https://raw.githubusercontent.com/raydelw-a11y/Huellas-Master/main/data/flow_pc_tunnel.enc.json?t=${Date.now()}`,
    ];
    const tested = new Set<string>();

    for (const metaUrl of candidates) {
      try {
        const res = await fetch(metaUrl, { cache: 'no-store' });
        if (!res.ok) continue;
        const json = await res.json().catch(() => null);
        if (!json?.studioBridge) continue;
        const dec = await decryptStudioMediaBridgeBox(json.studioBridge);
        if (!dec) continue;
        for (const url of [dec.tunnelUrl, dec.lanUrl]) {
          if (!url || tested.has(url)) continue;
          tested.add(url);
          if (await probeMediaBridgeOrigin(url, 4500)) {
            persistDiscoveredMediaBridgeTunnel(url);
            return url;
          }
        }
      } catch {}
    }

    if (!options?.allowRelayWake) return '';
    const now = Date.now();
    if (now - lastRelayWakeAttempt < 20000) return '';
    lastRelayWakeAttempt = now;

    const requestId = `mb_${now}_${Math.random().toString(36).slice(2, 6)}`;
    try {
      await fetch(REMOTE_MAC_RELAY_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'text/plain;charset=utf-8' },
        body: JSON.stringify({ type: 'REQUEST_MEDIA_BRIDGE', requestId, ts: now }),
      }).catch(() => {});

      for (let attempt = 0; attempt < 3; attempt++) {
        await new Promise((r) => setTimeout(r, 2500));
        const ackRes = await fetch(`${REMOTE_MAC_ACK_URL}/json?poll=1&since=35s`, {
          cache: 'no-store',
        }).catch(() => null);
        if (!ackRes || !ackRes.ok) continue;
        const rawText = await ackRes.text();
        const lines = rawText
          .split(/\r?\n/)
          .map((l) => l.trim())
          .filter(Boolean)
          .reverse();
        for (const line of lines) {
          try {
            const ev = JSON.parse(line);
            if (ev?.event !== 'message' || !ev.message) continue;
            const ack = JSON.parse(ev.message);
            if (ack?.type === 'MEDIA_BRIDGE_ACK' && ack?.studioBridge) {
              const dec = await decryptStudioMediaBridgeBox(ack.studioBridge);
              if (dec?.tunnelUrl && (await probeMediaBridgeOrigin(dec.tunnelUrl, 4500))) {
                persistDiscoveredMediaBridgeTunnel(dec.tunnelUrl);
                return dec.tunnelUrl;
              }
            }
          } catch {}
        }
      }
    } catch {}
    return '';
  })();

  inFlightTunnelDiscovery = task;
  try {
    return await task;
  } finally {
    if (inFlightTunnelDiscovery === task) {
      inFlightTunnelDiscovery = null;
    }
  }
}

export function getOrderedMediaBridgeBases(): string[] {
  if (typeof window === 'undefined') return [''];
  const host = window.location.hostname || '';
  if (isLocalRuntimeOrigin() || host.endsWith('.trycloudflare.com')) {
    return [''];
  }

  let savedBase = '';
  try {
    const rawSession = localStorage.getItem(STORAGE_KEY_FLOW_PC_SESSION);
    if (rawSession) {
      const parsed = JSON.parse(rawSession);
      const rawUrl = String(parsed?.baseUrl || '').trim().replace(/\/+$/, '');
      if (rawUrl && /^https?:\/\//i.test(rawUrl)) {
        savedBase = rawUrl;
      }
    }
  } catch {}

  const liveTunnel = cachedActiveOrigin || getStoredMediaBridgeTunnel();
  const isHttpsPage = window.location.protocol === 'https:';
  const isUsableRemoteOrigin = (u: string) => {
    if (!u) return false;
    if (
      isHttpsPage &&
      /^http:\/\//i.test(u) &&
      !/^http:\/\/(localhost|127\.0\.0\.1)(:|\/|$)/i.test(u)
    ) {
      return false;
    }
    return true;
  };

  const isRealMobileDevice =
    typeof navigator !== 'undefined' &&
    /iPhone|iPad|iPod|Android/i.test(navigator.userAgent || '') &&
    !/^Mac/i.test(navigator.platform || '');

  const verifiedRemoteCandidates = [liveTunnel, savedBase]
    .filter(isUsableRemoteOrigin)
    .filter((u) => !deadOriginsSet.has(u));

  if (isRealMobileDevice) {
    return Array.from(new Set([...verifiedRemoteCandidates, '']));
  }

  // On remote desktop HTTPS, put verified remote tunnels FIRST to prevent PNA preflight stalls
  if (isHttpsPage) {
    return Array.from(
      new Set([
        ...verifiedRemoteCandidates,
        'http://localhost:4200',
        '',
      ])
    );
  }

  return Array.from(
    new Set([
      'http://localhost:4200',
      ...verifiedRemoteCandidates,
      '',
    ])
  );
}

export function stripEphemeralMediaBridgeOrigin(
  rawUrl: string | undefined | null
): string {
  const clean = String(rawUrl || '').trim();
  if (!clean) return '';
  if (clean.startsWith('data:') || clean.startsWith('blob:')) return clean;
  const apiIdx = clean.indexOf('/api/flow/');
  if (apiIdx >= 0) {
    return clean.slice(apiIdx);
  }
  const capIdx = clean.indexOf('/flow-cap/');
  if (capIdx >= 0) {
    return clean.slice(capIdx);
  }
  return clean.replace(
    /^https?:\/\/(?:(?:localhost|127\.0\.0\.1)(?::\d+)?|[a-z0-9-]+\.trycloudflare\.com)/i,
    ''
  );
}

export function rewriteMediaBridgeUrl(
  rawUrl: string | undefined | null,
  activeOrigin?: string
): string {
  const clean = String(rawUrl || '').trim();
  if (!clean) return '';
  if (clean.startsWith('data:') || clean.startsWith('blob:')) return clean;

  const isFlowMedia =
    clean.includes('/api/flow/serve-folder-file') ||
    clean.includes('/api/flow/') ||
    clean.includes('/flow-cap/');

  if (!isFlowMedia) {
    return clean;
  }

  const relativePath = stripEphemeralMediaBridgeOrigin(clean);
  if (!relativePath.startsWith('/')) {
    return clean;
  }

  if (typeof window !== 'undefined') {
    const host = window.location.hostname || '';
    if (isLocalRuntimeOrigin() || host.endsWith('.trycloudflare.com')) {
      return relativePath;
    }
  }

  const targetOrigin = (
    activeOrigin ||
    cachedActiveOrigin ||
    getStoredMediaBridgeTunnel()
  )
    .trim()
    .replace(/\/+$/, '');

  if (targetOrigin) {
    return `${targetOrigin}${relativePath}`;
  }

  // When remote HTTPS and bridge tunnel is not yet discovered:
  // For Mac-only folder files, return empty string to prevent hitting onrender.com 404 HTML
  if (
    typeof window !== 'undefined' &&
    window.location.protocol === 'https:' &&
    (relativePath.startsWith('/api/flow/serve-folder-file') || relativePath.startsWith('/flow-cap/'))
  ) {
    return '';
  }

  return relativePath;
}

export function appendMediaFrameProbeParam(
  rawUrl: string | undefined | null
): string {
  const clean = String(rawUrl || '').trim();
  if (!clean) return '';
  if (clean.includes('frameProbe=1')) return clean;
  const sep = clean.includes('?') ? '&' : '?';
  return `${clean}${sep}frameProbe=1`;
}
