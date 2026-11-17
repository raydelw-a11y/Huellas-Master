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
const LOCAL_DESKTOP_BRIDGE_ORIGINS = [
  'http://localhost:4200',
] as const;

let mediaBridgeGeneration = 0;
let cachedActiveOrigin = '';
let emergencyLocalHttpOrigin = '';
const deadOriginsSet = new Set<string>();
let inFlightTunnelDiscovery: Promise<string> | null = null;
let tunnelDiscoveryEpoch = 0;
let lastRelayWakeAttempt = 0;
let inFlightHealthVerify: Promise<string> | null = null;
let inFlightHealthVerifyKey = '';
let lastHealthVerifyAt = 0;
let lastHealthVerifyOrigin = '';
let lastHealthVerifyResult = '';
const mediaBridgeListeners = new Set<MediaBridgeListener>();

function isRealMobileClient(): boolean {
  return (
    typeof navigator !== 'undefined' &&
    /iPhone|iPad|iPod|Android/i.test(navigator.userAgent || '') &&
    !/^Mac/i.test(navigator.platform || '')
  );
}

function getEffectiveActiveOrigin(): string {
  return cachedActiveOrigin || emergencyLocalHttpOrigin;
}

function notifyMediaBridgeListeners(): void {
  const cfg: MediaBridgeConfig = {
    activeOrigin: getEffectiveActiveOrigin(),
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
    activeOrigin: getEffectiveActiveOrigin(),
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
    const val = String(localStorage.getItem(STORAGE_KEY_LIVE_TUNNEL) || '')
      .trim()
      .replace(/\/+$/, '');
    if (!val || !/^https?:\/\//i.test(val)) return '';
    // Never load non-HTTPS cached origins while running on an HTTPS page
    if (window.location.protocol === 'https:' && !/^https:\/\//i.test(val)) {
      return '';
    }
    return val;
  } catch {
    return '';
  }
}

export function persistDiscoveredMediaBridgeTunnel(url: string): void {
  const clean = String(url || '').trim().replace(/\/+$/, '');
  if (!clean || !/^https?:\/\//i.test(clean)) return;

  const isHttpsPage =
    typeof window !== 'undefined' && window.location.protocol === 'https:';
  const isHttpsOrigin = /^https:\/\//i.test(clean);

  // Never persist http:// (including http://localhost:4200) to localStorage on HTTPS pages
  if (isHttpsPage && !isHttpsOrigin) {
    if (
      !isRealMobileClient() &&
      /^http:\/\/(?:localhost|127\.0\.0\.1)(?::\d+)?$/i.test(clean)
    ) {
      const wasDead = deadOriginsSet.delete(clean);
      if (emergencyLocalHttpOrigin === clean && !wasDead) return;
      emergencyLocalHttpOrigin = clean;
      if (!cachedActiveOrigin && !getStoredMediaBridgeTunnel()) {
        mediaBridgeGeneration++;
        notifyMediaBridgeListeners();
      }
    }
    return;
  }

  const wasDead = deadOriginsSet.delete(clean);
  let stored = '';
  try {
    if (typeof window !== 'undefined') {
      stored = String(localStorage.getItem(STORAGE_KEY_LIVE_TUNNEL) || '')
        .trim()
        .replace(/\/+$/, '');
    }
  } catch {}

  const hadEmergency = Boolean(isHttpsOrigin && emergencyLocalHttpOrigin);
  if (
    cachedActiveOrigin === clean &&
    stored === clean &&
    !wasDead &&
    !hadEmergency
  ) {
    return;
  }

  if (isHttpsOrigin) {
    emergencyLocalHttpOrigin = '';
  }
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
  let target = origin
    ? String(origin).trim().replace(/\/+$/, '')
    : cachedActiveOrigin || getStoredMediaBridgeTunnel() || emergencyLocalHttpOrigin;
  if (!target) return;
  if (/^https?:\/\//i.test(target)) {
    try {
      target = new URL(target).origin;
    } catch {}
  }
  deadOriginsSet.add(target);
  let changed = false;
  if (cachedActiveOrigin === target) {
    cachedActiveOrigin = '';
    changed = true;
  }
  if (emergencyLocalHttpOrigin === target) {
    emergencyLocalHttpOrigin = '';
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

// ---- Acceso Privado: verificación sin contraseña en texto plano ----
const STUDIO_ACCESS_KEY_STORAGE = 'huellas_master_access_key_v2';
// SHA-256 de la clave PBKDF2 (10.000 iteraciones, sal del puente de medios) derivada de la contraseña
const STUDIO_ACCESS_KEY_CHECK = '132e4e54b2e889dd88a1f2d536e6285be2e1fbc75e18791742ce3b655198033c';

function bufToB64(buf: ArrayBuffer): string {
  const u8 = new Uint8Array(buf);
  let bin = '';
  for (let i = 0; i < u8.length; i++) bin += String.fromCharCode(u8[i]);
  return btoa(bin);
}

async function sha256Hex(buf: ArrayBuffer): Promise<string> {
  const h = await window.crypto.subtle.digest('SHA-256', buf);
  return Array.from(new Uint8Array(h)).map((b) => b.toString(16).padStart(2, '0')).join('');
}

export function getStoredStudioAccessKeyB64(): string {
  try {
    return localStorage.getItem(STUDIO_ACCESS_KEY_STORAGE) || '';
  } catch {
    return '';
  }
}

/** Comprueba la contraseña; si es correcta guarda la clave derivada y devuelve true. */
export async function verifyAndStoreStudioAccessPassword(password: string): Promise<boolean> {
  try {
    if (!password || !window.crypto?.subtle) return false;
    const enc = new TextEncoder();
    const baseKey = await window.crypto.subtle.importKey('raw', enc.encode(password), 'PBKDF2', false, ['deriveBits']);
    const bits = await window.crypto.subtle.deriveBits(
      { name: 'PBKDF2', salt: enc.encode('huellas-studio-media-bridge-v1'), iterations: 10000, hash: 'SHA-256' },
      baseKey,
      256
    );
    if ((await sha256Hex(bits)) !== STUDIO_ACCESS_KEY_CHECK) return false;
    try {
      localStorage.setItem(STUDIO_ACCESS_KEY_STORAGE, bufToB64(bits));
    } catch {}
    return true;
  } catch {
    return false;
  }
}

/** true si este navegador ya guardó una clave válida en un acceso anterior. */
export async function hasValidStoredStudioAccessKey(): Promise<boolean> {
  try {
    const b64 = getStoredStudioAccessKeyB64();
    if (!b64 || !window.crypto?.subtle) return false;
    const bin = atob(b64);
    const u8 = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) u8[i] = bin.charCodeAt(i);
    return (await sha256Hex(u8.buffer)) === STUDIO_ACCESS_KEY_CHECK;
  } catch {
    return false;
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
    // La clave se deriva de la contraseña al entrar (Acceso Privado) y se guarda solo en este navegador;
    // la contraseña ya no viaja dentro del código de la página.
    const rawKeyB64 = getStoredStudioAccessKeyB64();
    if (!rawKeyB64) return null;
    const aesKey = await window.crypto.subtle.importKey(
      'raw',
      b64ToBuf(rawKeyB64),
      { name: 'AES-GCM' },
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

async function fetchEnvelopeBoxWithTimeout(
  url: string,
  timeoutMs: number,
  extraHeaders?: Record<string, string>
): Promise<{ ivB64?: string; ctB64?: string } | null> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      signal: ctrl.signal,
      cache: 'no-store',
      headers: extraHeaders,
    });
    if (!res.ok) return null;
    const rawText = await res.text().catch(() => '');
    const trimmed = rawText.trim();
    // Protect against SPA fallback returning HTML index.html with 200 OK
    if (!trimmed || trimmed.startsWith('<')) return null;
    const json = JSON.parse(trimmed);
    if (json?.studioBridge) {
      return json.studioBridge;
    }
    if (typeof json?.content === 'string') {
      const decoded = JSON.parse(atob(json.content.replace(/\s+/g, '')));
      if (decoded?.studioBridge) {
        return decoded.studioBridge;
      }
    }
    return null;
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

export async function refreshLiveMacMediaTunnelUrl(options?: {
  force?: boolean;
  allowRelayWake?: boolean;
}): Promise<string> {
  if (inFlightTunnelDiscovery) {
    const entryEpoch = tunnelDiscoveryEpoch;
    const existing = await inFlightTunnelDiscovery;
    if (existing || !options?.force) {
      return existing;
    }
    if (inFlightTunnelDiscovery) {
      return inFlightTunnelDiscovery;
    }
    // Allow at most 1 chained retry when force was requested against an older in-flight discovery
    if (tunnelDiscoveryEpoch > entryEpoch) {
      return existing;
    }
  }

  tunnelDiscoveryEpoch += 1;
  const task = (async () => {
    const now = Date.now();
    const isMobile = isRealMobileClient();
    const isLocalPage = isLocalRuntimeOrigin();
    const isHttpsPage =
      typeof window !== 'undefined' && window.location.protocol === 'https:';
    const tested = new Set<string>();

    const envelopeSteps: Array<{
      url: string;
      timeoutMs: number;
      headers?: Record<string, string>;
    }> = [];

    if (!isMobile && !isLocalPage && typeof window !== 'undefined') {
      envelopeSteps.push({
        url: `${LOCAL_DESKTOP_BRIDGE_ORIGINS[0]}/api/flow-pc/tunnel-envelope?ensure=1&t=${now}`,
        timeoutMs: 1200,
      });
    }

    envelopeSteps.push(
      {
        url: `/api/flow-pc/tunnel-envelope?t=${now}`,
        timeoutMs: 4500,
      },
      {
        url: `./data/flow_pc_tunnel.enc.json?t=${now}`,
        timeoutMs: 4500,
      },
      {
        url: `https://api.github.com/repos/raydelw-a11y/Huellas-Master/contents/data/flow_pc_tunnel.enc.json?ref=main&t=${now}`,
        timeoutMs: 5000,
        headers: { Accept: 'application/vnd.github.raw' },
      },
      {
        url: `https://raw.githubusercontent.com/raydelw-a11y/Huellas-Master/main/data/flow_pc_tunnel.enc.json?t=${now}`,
        timeoutMs: 4500,
      }
    );

    for (const step of envelopeSteps) {
      const box = await fetchEnvelopeBoxWithTimeout(
        step.url,
        step.timeoutMs,
        step.headers
      );
      if (!box) continue;
      const dec = await decryptStudioMediaBridgeBox(box);
      if (!dec) continue;
      for (const url of [dec.tunnelUrl, dec.lanUrl]) {
        if (!url || tested.has(url)) continue;
        if (isHttpsPage && !/^https:\/\//i.test(url)) continue;
        tested.add(url);
        if (await probeMediaBridgeOrigin(url, 4500)) {
          persistDiscoveredMediaBridgeTunnel(url);
          return url;
        }
      }
    }

    if (options?.allowRelayWake) {
      const relayNow = Date.now();
      if (relayNow - lastRelayWakeAttempt >= 20000) {
        lastRelayWakeAttempt = relayNow;
        const requestId = `mb_${relayNow}_${Math.random().toString(36).slice(2, 6)}`;
        try {
          await fetch(REMOTE_MAC_RELAY_URL, {
            method: 'POST',
            headers: { 'Content-Type': 'text/plain;charset=utf-8' },
            body: JSON.stringify({ type: 'REQUEST_MEDIA_BRIDGE', requestId, ts: relayNow }),
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
      }
    }

    // RAM-only emergency fallback #2 for local Mac desktop if entire HTTPS cascade returned ''
    if (!isMobile && !isLocalPage && typeof window !== 'undefined') {
      const localOrigin = LOCAL_DESKTOP_BRIDGE_ORIGINS[0];
      if (await probeMediaBridgeOrigin(localOrigin, 900)) {
        const prevEmergency = emergencyLocalHttpOrigin;
        emergencyLocalHttpOrigin = localOrigin;
        deadOriginsSet.delete(localOrigin);
        if (prevEmergency !== localOrigin) {
          mediaBridgeGeneration++;
          notifyMediaBridgeListeners();
        }
        return localOrigin;
      }
      if (emergencyLocalHttpOrigin) {
        emergencyLocalHttpOrigin = '';
        mediaBridgeGeneration++;
        notifyMediaBridgeListeners();
      }
    }

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
    if (isHttpsPage) {
      return /^https:\/\//i.test(u);
    }
    return /^https?:\/\//i.test(u);
  };

  const isRealMobileDevice = isRealMobileClient();

  const verifiedRemoteCandidates = [liveTunnel, savedBase]
    .filter(isUsableRemoteOrigin)
    .filter((u) => !deadOriginsSet.has(u));

  if (isRealMobileDevice) {
    return Array.from(new Set([...verifiedRemoteCandidates, '']));
  }

  if (isHttpsPage) {
    return Array.from(
      new Set([
        ...verifiedRemoteCandidates,
        ...(emergencyLocalHttpOrigin && !deadOriginsSet.has(emergencyLocalHttpOrigin)
          ? [emergencyLocalHttpOrigin]
          : []),
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

export function isOfficialAssetMedia(rawUrl: string | undefined | null): boolean {
  const clean = String(rawUrl || '').trim();
  if (!clean) return false;
  return clean.includes('/api/assets/');
}

function extractBridgePathFromOriginUrl(clean: string): string | null {
  const withoutOrigin = clean.replace(/^https?:\/\/[^/?#]+/i, '');
  if (
    withoutOrigin.startsWith('/api/flow/') ||
    withoutOrigin.startsWith('/flow-cap/') ||
    withoutOrigin.startsWith('/api/assets/')
  ) {
    return withoutOrigin;
  }
  return null;
}

export function stripEphemeralMediaBridgeOrigin(
  rawUrl: string | undefined | null
): string {
  const clean = String(rawUrl || '').trim();
  if (!clean) return '';
  if (clean.startsWith('data:') || clean.startsWith('blob:')) return clean;

  const extracted = extractBridgePathFromOriginUrl(clean);
  if (extracted) {
    return extracted;
  }

  const qIdx = clean.search(/[?#]/);
  const pathHead = qIdx >= 0 ? clean.slice(0, qIdx) : clean;
  const assetIdx = pathHead.indexOf('/api/assets/');
  if (assetIdx >= 0) {
    return clean.slice(assetIdx);
  }
  const apiIdx = pathHead.indexOf('/api/flow/');
  if (apiIdx >= 0) {
    return clean.slice(apiIdx);
  }
  const capIdx = pathHead.indexOf('/flow-cap/');
  if (capIdx >= 0) {
    return clean.slice(capIdx);
  }
  return clean.replace(
    /^https?:\/\/(?:(?:localhost|127\.0\.0\.1)(?::\d+)?|[a-z0-9-]+\.trycloudflare\.com)/i,
    ''
  );
}

export function toCanonicalMediaBridgePath(
  rawUrl: string | undefined | null
): string {
  const clean = String(rawUrl || '').trim();
  if (!clean) return '';
  if (clean.startsWith('data:') || clean.startsWith('blob:')) return clean;
  const stripped = stripEphemeralMediaBridgeOrigin(clean);
  if (
    stripped.startsWith('/api/flow/') ||
    stripped.startsWith('/flow-cap/') ||
    stripped.startsWith('/api/assets/')
  ) {
    return stripped;
  }
  return clean;
}

function extractMediaBridgeTargetOrigin(suspectUrlOrOrigin?: string | null): {
  origin: string;
  isUnrelatedExternal: boolean;
} {
  const clean = String(suspectUrlOrOrigin || '').trim();
  const fallbackOrigin = () => {
    const active =
      cachedActiveOrigin ||
      getStoredMediaBridgeTunnel() ||
      emergencyLocalHttpOrigin;
    if (active) return active;
    if (
      typeof window !== 'undefined' &&
      (isLocalRuntimeOrigin() ||
        (window.location.hostname || '').endsWith('.trycloudflare.com'))
    ) {
      return window.location.origin;
    }
    return '';
  };

  if (!clean || clean.startsWith('/')) {
    return { origin: fallbackOrigin(), isUnrelatedExternal: false };
  }
  if (clean.startsWith('data:') || clean.startsWith('blob:')) {
    return { origin: '', isUnrelatedExternal: true };
  }
  const cfMatch = clean.match(/^https:\/\/[a-z0-9-]+\.trycloudflare\.com/i);
  if (cfMatch) {
    return { origin: cfMatch[0], isUnrelatedExternal: false };
  }
  const localMatch = clean.match(/^http:\/\/(?:localhost|127\.0\.0\.1)(?::\d+)?/i);
  if (localMatch) {
    return { origin: localMatch[0], isUnrelatedExternal: false };
  }
  if (
    clean.includes('/api/flow/') ||
    clean.includes('/flow-cap/') ||
    clean.includes('/api/assets/')
  ) {
    return { origin: fallbackOrigin(), isUnrelatedExternal: false };
  }
  return { origin: '', isUnrelatedExternal: true };
}

export async function verifyMediaBridgeHealthOrRefresh(
  suspectUrlOrOrigin?: string | null
): Promise<string> {
  const { origin, isUnrelatedExternal } =
    extractMediaBridgeTargetOrigin(suspectUrlOrOrigin);
  if (isUnrelatedExternal) {
    return (
      cachedActiveOrigin ||
      getStoredMediaBridgeTunnel() ||
      emergencyLocalHttpOrigin
    );
  }

  const targetOrigin = origin;
  const cacheKey = targetOrigin || '__NO_ORIGIN__';
  const now = Date.now();

  if (
    lastHealthVerifyAt > 0 &&
    now - lastHealthVerifyAt < 3000 &&
    lastHealthVerifyOrigin === cacheKey
  ) {
    return lastHealthVerifyResult;
  }

  if (inFlightHealthVerify && inFlightHealthVerifyKey === cacheKey) {
    return inFlightHealthVerify;
  }

  const task = (async () => {
    let result = '';
    if (targetOrigin) {
      if (deadOriginsSet.has(targetOrigin)) {
        const currentLive =
          cachedActiveOrigin ||
          getStoredMediaBridgeTunnel() ||
          emergencyLocalHttpOrigin;
        if (
          currentLive &&
          currentLive !== targetOrigin &&
          !deadOriginsSet.has(currentLive)
        ) {
          lastHealthVerifyAt = Date.now();
          lastHealthVerifyOrigin = cacheKey;
          lastHealthVerifyResult = currentLive;
          return currentLive;
        }
      }

      const firstOk = await probeMediaBridgeOrigin(targetOrigin, 2500);
      if (firstOk) {
        result = targetOrigin;
      } else {
        await new Promise((r) => setTimeout(r, 500));
        const secondOk = await probeMediaBridgeOrigin(targetOrigin, 2500);
        if (secondOk) {
          result = targetOrigin;
        } else {
          evictDeadMediaBridgeOrigin(targetOrigin);
          result = await refreshLiveMacMediaTunnelUrl({
            force: true,
            allowRelayWake: true,
          });
        }
      }
    } else {
      result = await refreshLiveMacMediaTunnelUrl({
        force: true,
        allowRelayWake: true,
      });
    }

    lastHealthVerifyAt = Date.now();
    lastHealthVerifyOrigin = cacheKey;
    lastHealthVerifyResult = result;
    return result;
  })();

  inFlightHealthVerifyKey = cacheKey;
  inFlightHealthVerify = task;
  try {
    return await task;
  } finally {
    if (inFlightHealthVerify === task) {
      inFlightHealthVerify = null;
      inFlightHealthVerifyKey = '';
    }
  }
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
    clean.includes('/flow-cap/') ||
    clean.includes('/api/assets/');

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
    getStoredMediaBridgeTunnel() ||
    emergencyLocalHttpOrigin
  )
    .trim()
    .replace(/\/+$/, '');

  if (targetOrigin) {
    return `${targetOrigin}${relativePath}`;
  }

  // When remote HTTPS and bridge tunnel is not yet discovered:
  // For Mac-only folder files and official assets, return empty string to prevent hitting onrender.com 404 HTML
  if (
    typeof window !== 'undefined' &&
    window.location.protocol === 'https:' &&
    (relativePath.startsWith('/api/flow/serve-folder-file') ||
      relativePath.startsWith('/flow-cap/') ||
      relativePath.startsWith('/api/assets/'))
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
