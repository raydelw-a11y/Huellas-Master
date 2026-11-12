import React, { useState, useEffect, useRef, useMemo, useCallback } from 'react';
import {
  Lock,
  Play,
  Pause,
  Square,
  Maximize2,
  Minimize2,
  ExternalLink,
  Send,
  ClipboardPaste,
  FolderOpen,
  Download,
  Share2,
  RefreshCw,
  Check,
  Eye,
  EyeOff,
  ChevronDown,
  ChevronUp,
  Wifi,
  Smartphone,
  Image as ImageIcon,
  Film,
  Sparkles,
  AlertTriangle,
  ArrowLeft,
  LogOut,
} from 'lucide-react';
import type { DocumentaryProject } from '../types';

export type FlowRoutingMode = 'auto' | '05_Clips_Video' | '04_Referencias' | '03_Miniaturas';

interface FlowDownloadedAsset {
  id: string;
  fileName: string;
  subFolder: string;
  docTitle: string;
  sizeBytes: number;
  mimeType: string;
  createdAt: number;
  importedToMacPhotos: boolean;
  existsOnDisk: boolean;
  downloadToken: string;
}

interface FlowStatusResponse {
  ok: boolean;
  error?: string;
  sessionToken?: string;
  containerState: 'running' | 'paused' | 'stopped' | 'starting' | 'missing';
  vncReady: boolean;
  resolution: string;
  capToken: string;
  vncEntryPath: string;
  tunnelUrl: string;
  lanUrl: string;
  routing: {
    targetDocId: string;
    targetDocTitle: string;
    targetFolderPath: string;
    targetFolderName: string;
    resolvedRootFolder: string;
    routingMode: FlowRoutingMode;
    autoImportMacPhotos: boolean;
  };
  recentDownloads: FlowDownloadedAsset[];
}

interface FlowPcModalProps {
  lastUpdatedText: string;
  documentaries: DocumentaryProject[];
  activeDoc?: DocumentaryProject | null;
  onSelectDocId?: (docId: string) => void;
  onBackToStudio: () => void;
}

const SESSION_STORAGE_KEY = 'huellas_flow_pc_session_v1';

function normalizeSecretNfc(raw: string): string {
  return String(raw ?? '').trim().normalize('NFC');
}

function base64ToUint8(b64: string): Uint8Array {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

function uint8ToBase64(bytes: Uint8Array): string {
  let bin = '';
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
  return btoa(bin);
}

function uint8ToHex(bytes: Uint8Array): string {
  return Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

function isDirectMacHostOrigin(): boolean {
  if (typeof window === 'undefined') return false;
  const h = window.location.hostname.toLowerCase();
  return (
    h === 'localhost' ||
    h === '127.0.0.1' ||
    /^192\.168\.\d+\.\d+$/.test(h) ||
    /^10\.\d+\.\d+\.\d+$/.test(h) ||
    /^172\.(1[6-9]|2\d|3[01])\.\d+\.\d+$/.test(h) ||
    h.endsWith('.trycloudflare.com')
  );
}

async function deriveAesKeyFromPassword(
  nfcPassword: string,
  saltBytes: Uint8Array,
  iterations: number
): Promise<CryptoKey> {
  const enc = new TextEncoder();
  const baseKey = await window.crypto.subtle.importKey(
    'raw',
    enc.encode(nfcPassword),
    'PBKDF2',
    false,
    ['deriveKey']
  );
  return window.crypto.subtle.deriveKey(
    {
      name: 'PBKDF2',
      salt: saltBytes,
      iterations,
      hash: 'SHA-256',
    },
    baseKey,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt']
  );
}

async function derivePrivateNtfyTopic(nfcPassword: string, iterations = 210000): Promise<string> {
  const enc = new TextEncoder();
  const baseKey = await window.crypto.subtle.importKey(
    'raw',
    enc.encode(nfcPassword),
    'PBKDF2',
    false,
    ['deriveBits']
  );
  const bits = await window.crypto.subtle.deriveBits(
    {
      name: 'PBKDF2',
      salt: enc.encode('huellas-flow-ntfy-topic-v1'),
      iterations,
      hash: 'SHA-256',
    },
    baseKey,
    128
  );
  return 'hm_fpc_' + uint8ToHex(new Uint8Array(bits));
}

async function decryptTunnelEnvelope(
  envelope: any,
  nfcPassword: string
): Promise<{ tunnelUrl: string; lanUrl?: string; aesKey: CryptoKey; iter: number } | null> {
  if (!window.crypto?.subtle || !envelope?.kdfSaltB64 || !envelope?.ivB64 || !envelope?.ctB64) {
    return null;
  }
  const iter = Number(envelope.iter || 210000) || 210000;
  const saltBytes = base64ToUint8(envelope.kdfSaltB64);
  const ivBytes = base64ToUint8(envelope.ivB64);
  const ctWithTag = base64ToUint8(envelope.ctB64);
  const aesKey = await deriveAesKeyFromPassword(nfcPassword, saltBytes, iter);
  const plainBuf = await window.crypto.subtle.decrypt(
    { name: 'AES-GCM', iv: ivBytes, tagLength: 128 },
    aesKey,
    ctWithTag
  );
  const parsed = JSON.parse(new TextDecoder().decode(plainBuf));
  return {
    tunnelUrl: String(parsed.tunnelUrl || '').replace(/\/+$/, ''),
    lanUrl: String(parsed.lanUrl || '').replace(/\/+$/, ''),
    aesKey,
    iter,
  };
}

async function encryptWakeCommandPacket(aesKey: CryptoKey): Promise<string> {
  const iv = window.crypto.getRandomValues(new Uint8Array(12));
  const nonceBytes = window.crypto.getRandomValues(new Uint8Array(8));
  const payload = JSON.stringify({
    cmd: 'WAKE_FLOW_PC',
    ts: Date.now(),
    nonce: uint8ToHex(nonceBytes),
  });
  const ctBuf = await window.crypto.subtle.encrypt(
    { name: 'AES-GCM', iv, tagLength: 128 },
    aesKey,
    new TextEncoder().encode(payload)
  );
  return JSON.stringify({
    v: 1,
    ivB64: uint8ToBase64(iv),
    ctB64: uint8ToBase64(new Uint8Array(ctBuf)),
  });
}

async function probeFlowBackendBaseUrl(baseUrl: string, timeoutMs = 2800): Promise<boolean> {
  if (!baseUrl) return false;
  // Avoid mixed-content block on HTTPS page probing HTTP LAN
  if (window.location.protocol === 'https:' && baseUrl.startsWith('http://')) {
    return false;
  }
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(`${baseUrl}/api/flow-pc/ping?t=${Date.now()}`, {
      signal: ctrl.signal,
      cache: 'no-store',
    });
    if (!res.ok) return false;
    const data = await res.json();
    return Boolean(data?.ok);
  } catch {
    return false;
  } finally {
    clearTimeout(t);
  }
}

function formatBytes(bytes: number): string {
  if (!bytes || bytes <= 0) return '0 B';
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export const FlowPcModal: React.FC<FlowPcModalProps> = ({
  lastUpdatedText,
  documentaries,
  activeDoc,
  onSelectDocId,
  onBackToStudio,
}) => {
  const [passwordInput, setPasswordInput] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [authError, setAuthError] = useState('');
  const [authStepMsg, setAuthStepMsg] = useState('');
  const [isAuthenticating, setIsAuthenticating] = useState(false);

  const [baseUrl, setBaseUrl] = useState<string>(() =>
    isDirectMacHostOrigin() ? window.location.origin : ''
  );
  const [sessionToken, setSessionToken] = useState<string>('');
  const [status, setStatus] = useState<FlowStatusResponse | null>(null);
  const [vncSrcPath, setVncSrcPath] = useState<string>('');
  const [actionBusy, setActionBusy] = useState<string>('');
  const [toastMsg, setToastMsg] = useState<string>('');

  // Mobile bottom bar & CriOS viewport state
  const [isZenFullscreen, setIsZenFullscreen] = useState(false);
  const [isBottomBarCollapsed, setIsBottomBarCollapsed] = useState(false);
  const [bottomTab, setBottomTab] = useState<'prompt' | 'routing' | 'downloads'>('prompt');
  const [promptText, setPromptText] = useState('');
  const [autoEnterOnPaste, setAutoEnterOnPaste] = useState(false);
  const [selectedPresetKey, setSelectedPresetKey] = useState('');
  const [keyboardOffsetBottom, setKeyboardOffsetBottom] = useState(0);

  // Two-step CriOS Camera Roll cache: assetId -> File ready for synchronous navigator.share
  const [preparedShareFiles, setPreparedShareFiles] = useState<Record<string, File>>({});
  const [preparingAssetId, setPreparingAssetId] = useState<string>('');

  const vncWrapRef = useRef<HTMLDivElement | null>(null);

  const showToast = useCallback((msg: string) => {
    setToastMsg(msg);
    setTimeout(() => {
      setToastMsg((prev) => (prev === msg ? '' : prev));
    }, 3800);
  }, []);

  // Prevent accidental WebKit elastic scroll on VNC wrapper
  useEffect(() => {
    const el = vncWrapRef.current;
    if (!el) return;
    const preventTouchScroll = (e: TouchEvent) => {
      if (e.target === el) e.preventDefault();
    };
    el.addEventListener('touchmove', preventTouchScroll, { passive: false });
    return () => el.removeEventListener('touchmove', preventTouchScroll);
  }, []);

  // Track iOS visualViewport keyboard height so the prompt bar floats cleanly above keyboard
  useEffect(() => {
    const vv = window.visualViewport;
    if (!vv) return;
    const handleViewport = () => {
      const kbHeight = Math.max(0, Math.round(window.innerHeight - (vv.height + vv.offsetTop)));
      setKeyboardOffsetBottom(kbHeight);
    };
    vv.addEventListener('resize', handleViewport);
    vv.addEventListener('scroll', handleViewport);
    return () => {
      vv.removeEventListener('resize', handleViewport);
      vv.removeEventListener('scroll', handleViewport);
    };
  }, []);

  // Restore saved session token on mount
  useEffect(() => {
    try {
      const raw = localStorage.getItem(SESSION_STORAGE_KEY);
      if (!raw) return;
      const saved = JSON.parse(raw);
      const candidateBase = isDirectMacHostOrigin()
        ? window.location.origin
        : String(saved?.baseUrl || '');
      const candidateTok = String(saved?.sessionToken || '');
      if (!candidateBase || !candidateTok) return;

      (async () => {
        const ctrl = new AbortController();
        const timer = setTimeout(() => ctrl.abort(), 4500);
        try {
          const res = await fetch(`${candidateBase}/api/flow-pc/status`, {
            headers: { Authorization: `Bearer ${candidateTok}` },
            signal: ctrl.signal,
          });
          if (res.ok) {
            const data: FlowStatusResponse = await res.json();
            if (data.ok) {
              setBaseUrl(candidateBase);
              setSessionToken(candidateTok);
              setStatus(data);
              setVncSrcPath(data.vncEntryPath);
            }
          }
        } catch {
          // Tunnel rotated or Mac asleep — user will unlock / auto-wake from Acceso Privado
        } finally {
          clearTimeout(timer);
        }
      })();
    } catch {}
  }, []);

  // Poll status while authenticated
  useEffect(() => {
    if (!sessionToken || !baseUrl) return;
    let cancelled = false;

    const poll = async () => {
      try {
        const res = await fetch(`${baseUrl}/api/flow-pc/status`, {
          headers: { Authorization: `Bearer ${sessionToken}` },
        });
        if (res.status === 401) {
          if (!cancelled) {
            setSessionToken('');
            localStorage.removeItem(SESSION_STORAGE_KEY);
          }
          return;
        }
        if (res.ok) {
          const data: FlowStatusResponse = await res.json();
          if (!cancelled && data.ok) {
            setStatus(data);
            setVncSrcPath((prev) => prev || data.vncEntryPath);
          }
        }
      } catch {}
    };

    const interval = setInterval(poll, 3500);
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, [sessionToken, baseUrl]);

  // Keep backend documentary routing synced with active documentary when opened
  useEffect(() => {
    if (!sessionToken || !baseUrl || !activeDoc) return;
    if (status?.routing?.targetDocId === activeDoc.id) return;
    fetch(`${baseUrl}/api/flow-pc/routing`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${sessionToken}`,
      },
      body: JSON.stringify({
        targetDocId: activeDoc.id,
        targetDocTitle: activeDoc.title,
        targetFolderPath: activeDoc.downloadFolderPath || '',
        targetFolderName: activeDoc.downloadFolderName || '',
      }),
    })
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        if (d?.ok) setStatus(d);
      })
      .catch(() => {});
  }, [activeDoc?.id, sessionToken, baseUrl]);

  // Build 1-tap prompt presets from the active documentary
  const promptPresets = useMemo(() => {
    const items: Array<{ key: string; label: string; text: string }> = [];
    if (!activeDoc) return items;

    if (activeDoc.compiledMasterPrompt?.trim()) {
      items.push({
        key: 'master_compiled',
        label: `✨ Prompt Maestro Compilado (${activeDoc.title})`,
        text: activeDoc.compiledMasterPrompt.trim(),
      });
    }
    if (activeDoc.rawClipsText?.trim()) {
      items.push({
        key: 'raw_clips_all',
        label: `📜 Todos los Clips en Bloque (${activeDoc.title})`,
        text: activeDoc.rawClipsText.trim(),
      });
    }
    if (activeDoc.thumbnailPrompt?.trim()) {
      items.push({
        key: 'thumbnail_prompt',
        label: `🖼️ Prompt Miniatura Principal`,
        text: activeDoc.thumbnailPrompt.trim(),
      });
    }
    if (activeDoc.rawReferencePrompts?.trim()) {
      items.push({
        key: 'raw_refs_all',
        label: `🧑 Todas las @Referencias en Bloque (${activeDoc.title})`,
        text: activeDoc.rawReferencePrompts.trim(),
      });
    }
    for (const ref of activeDoc.references || []) {
      if (ref?.prompt?.trim()) {
        items.push({
          key: `ref_${ref.id}`,
          label: `🧑 Ref ${ref.tag || ref.description || ref.id}`,
          text: ref.prompt.trim(),
        });
      }
    }
    for (const clip of activeDoc.clips || []) {
      const numStr = String(clip.clipNumber || '').padStart(2, '0');
      if (clip.videoPrompt?.trim()) {
        items.push({
          key: `clip_vid_${clip.id}`,
          label: `🎬 Clip #${numStr} (Video)`,
          text: clip.videoPrompt.trim(),
        });
      }
      if (clip.imagePrompt?.trim()) {
        items.push({
          key: `clip_img_${clip.id}`,
          label: `🖼️ Clip #${numStr} (Imagen)`,
          text: clip.imagePrompt.trim(),
        });
      }
    }
    return items;
  }, [activeDoc]);

  const fetchLatestEncryptedEnvelope = async (): Promise<any | null> => {
    const urls = [
      `https://raw.githubusercontent.com/raydelw-a11y/Huellas-Master/main/data/flow_pc_tunnel.enc.json?t=${Date.now()}`,
      `./data/flow_pc_tunnel.enc.json?t=${Date.now()}`,
    ];
    for (const u of urls) {
      try {
        const res = await fetch(u, { cache: 'no-store' });
        if (res.ok) {
          const json = await res.json();
          if (json?.ctB64 && json?.ivB64) return json;
        }
      } catch {}
    }
    return null;
  };

  const resolveRemoteMacEndpointWithPassword = async (nfcPw: string): Promise<string> => {
    if (isDirectMacHostOrigin()) {
      return window.location.origin;
    }

    setAuthStepMsg('Descifrando dirección privada de tu Mac (AES-256-GCM)...');
    const envJson = await fetchLatestEncryptedEnvelope();
    let aesKey: CryptoKey | null = null;
    let iter = 210000;

    if (envJson) {
      try {
        const dec = await decryptTunnelEnvelope(envJson, nfcPw);
        if (dec) {
          aesKey = dec.aesKey;
          iter = dec.iter;
          if (dec.lanUrl && (await probeFlowBackendBaseUrl(dec.lanUrl, 1200))) {
            return dec.lanUrl;
          }
          if (dec.tunnelUrl && (await probeFlowBackendBaseUrl(dec.tunnelUrl, 3200))) {
            return dec.tunnelUrl;
          }
        }
      } catch {
        throw new Error('Contraseña incorrecta.');
      }
    }

    // Tunnel asleep or rotated -> send authenticated Wake-on-5G packet over private ntfy topic
    if (!aesKey && envJson?.kdfSaltB64) {
      aesKey = await deriveAesKeyFromPassword(
        nfcPw,
        base64ToUint8(envJson.kdfSaltB64),
        Number(envJson.iter || 210000)
      );
    }
    if (!aesKey) {
      throw new Error('No se encontró sobre cifrado del túnel 5G todavía.');
    }

    setAuthStepMsg('Despertando Flow PC en tu Mac por 5G...');
    const topic = await derivePrivateNtfyTopic(nfcPw, iter);
    const wakePacket = await encryptWakeCommandPacket(aesKey);
    const wakeStartSec = Math.floor(Date.now() / 1000) - 2;

    await fetch(`https://ntfy.sh/${topic}`, {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain; charset=utf-8' },
      body: wakePacket,
    }).catch(() => {});

    for (let attempt = 0; attempt < 9; attempt++) {
      await new Promise((r) => setTimeout(r, 2000));
      try {
        const pollRes = await fetch(
          `https://ntfy.sh/${topic}_ack/json?poll=1&since=${wakeStartSec}`,
          { cache: 'no-store' }
        );
        if (pollRes.ok) {
          const rawLines = (await pollRes.text()).split(/\r?\n/).filter(Boolean);
          for (let i = rawLines.length - 1; i >= 0; i--) {
            try {
              const evt = JSON.parse(rawLines[i]);
              if (evt.event === 'message' && evt.message) {
                const ackEnv = JSON.parse(evt.message);
                const ackDec = await decryptTunnelEnvelope(ackEnv, nfcPw);
                if (ackDec?.tunnelUrl && (await probeFlowBackendBaseUrl(ackDec.tunnelUrl, 2500))) {
                  return ackDec.tunnelUrl;
                }
              }
            } catch {}
          }
        }
      } catch {}
    }

    throw new Error(
      'No se pudo contactar con tu Mac en este momento. Verifica que la Mac esté encendida con conexión a Internet.'
    );
  };

  const performUnlock = async () => {
    const nfcPw = normalizeSecretNfc(passwordInput);
    if (!nfcPw) {
      setAuthError('Ingresa la contraseña de Flow PC.');
      return;
    }
    setIsAuthenticating(true);
    setAuthError('');
    setAuthStepMsg('Verificando credenciales...');
    try {
      const targetBase = await resolveRemoteMacEndpointWithPassword(nfcPw);
      setAuthStepMsg('Abriendo canal seguro con Flow PC...');
      const res = await fetch(`${targetBase}/api/flow-pc/auth`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ password: nfcPw }),
      });
      const data: FlowStatusResponse = await res.json();
      if (!res.ok || !data.ok || !data.sessionToken) {
        setAuthError(data?.error || 'Contraseña incorrecta.');
        return;
      }

      localStorage.setItem(
        SESSION_STORAGE_KEY,
        JSON.stringify({ baseUrl: targetBase, sessionToken: data.sessionToken })
      );
      setBaseUrl(targetBase);
      setSessionToken(data.sessionToken);
      setStatus(data);
      setVncSrcPath(data.vncEntryPath);
      setPasswordInput('');

      // Auto-start container on unlock if paused or stopped so user sees Google Flow immediately
      if (data.containerState !== 'running') {
        fetch(`${targetBase}/api/flow-pc/start`, {
          method: 'POST',
          headers: { Authorization: `Bearer ${data.sessionToken}` },
        })
          .then((r) => (r.ok ? r.json() : null))
          .then((started) => {
            if (started?.ok) {
              setStatus(started);
              setVncSrcPath(started.vncEntryPath);
            }
          })
          .catch(() => {});
      }
    } catch (err: any) {
      setAuthError(err?.message || 'Error conectando con Flow PC.');
    } finally {
      setIsAuthenticating(false);
      setAuthStepMsg('');
    }
  };

  const handleUnlockFormSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!isAuthenticating) performUnlock();
  };

  const callAuthEndpoint = async (pathUrl: string, body?: Record<string, any>, busyLabel = '') => {
    if (!baseUrl || !sessionToken) return null;
    if (busyLabel) setActionBusy(busyLabel);
    try {
      const res = await fetch(`${baseUrl}${pathUrl}`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${sessionToken}`,
        },
        body: body ? JSON.stringify(body) : undefined,
      });
      const data = await res.json();
      if (data?.containerState) {
        setStatus(data);
        if (pathUrl === '/api/flow-pc/start' && data.vncEntryPath) {
          setVncSrcPath(data.vncEntryPath);
        }
      }
      if (!res.ok || data?.ok === false) {
        showToast(`⚠️ ${data?.error || 'Operación fallida'}`);
        return null;
      }
      return data;
    } catch (e: any) {
      showToast(`⚠️ Error de red: ${e?.message || 'Sin conexión'}`);
      return null;
    } finally {
      if (busyLabel) setActionBusy('');
    }
  };

  const handlePastePrompt = async (withEnter: boolean) => {
    const clean = promptText.normalize('NFC');
    if (!clean.trim()) {
      showToast('Escribe, dicta o elige primero un prompt del documental.');
      return;
    }
    const res = await callAuthEndpoint(
      '/api/flow-pc/paste-prompt',
      { text: clean, mode: 'paste', autoEnter: withEnter },
      withEnter ? 'paste_enter' : 'paste'
    );
    if (res?.ok) {
      showToast(
        res.warning
          ? `📋 ${res.warning}`
          : withEnter
          ? '🚀 Prompt pegado y enviado en Flow PC'
          : '📋 Prompt pegado en Flow PC (Ctrl+V)'
      );
    }
  };

  const handlePrepareOrShareToIphonePhotos = async (asset: FlowDownloadedAsset) => {
    if (!baseUrl) return;
    const alreadyReady = preparedShareFiles[asset.id];

    // Step 2: Synchronous fresh gesture -> navigator.share({ files: [file] }) with NO title/text/url!
    if (alreadyReady && typeof navigator.share === 'function') {
      try {
        await navigator.share({ files: [alreadyReady] });
        showToast('📲 Abierto menú nativo para Guardar en Fotos del iPhone');
        return;
      } catch (err: any) {
        if (err?.name === 'AbortError') return;
      }
    }

    // Step 1: Fetch Blob into RAM, and if completed under 1.4s while gesture is still fresh, share directly!
    setPreparingAssetId(asset.id);
    const t0 = Date.now();
    try {
      const fileUrl = `${baseUrl}/api/flow-pc/download-file/${encodeURIComponent(asset.id)}?cap=${encodeURIComponent(asset.downloadToken)}`;
      const res = await fetch(fileUrl);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const blob = await res.blob();
      const fileObj = new File([blob], asset.fileName, {
        type: asset.mimeType || blob.type || 'video/mp4',
      });

      const canShareFiles =
        typeof navigator.share === 'function' &&
        (typeof navigator.canShare !== 'function' || navigator.canShare({ files: [fileObj] }));

      if (!canShareFiles) {
        window.open(`${fileUrl}&disposition=attachment`, '_blank', 'noopener');
        return;
      }

      setPreparedShareFiles((prev) => ({ ...prev, [asset.id]: fileObj }));

      if (Date.now() - t0 < 1400) {
        try {
          await navigator.share({ files: [fileObj] });
          return;
        } catch (err: any) {
          if (err?.name === 'AbortError') return;
          // Transient activation expired on 5G -> user taps the green ready button!
        }
      }
      showToast('✅ Video listo en memoria: toca el botón verde para Guardar en Fotos');
    } catch (e: any) {
      showToast(`⚠️ Error descargando archivo: ${e?.message || e}`);
    } finally {
      setPreparingAssetId('');
    }
  };

  // ==========================================================================
  // RENDER 1: ACCESO PRIVADO PASSWORD GATE (WITH ENTER SUPPORT + TIMESTAMP)
  // ==========================================================================
  if (!sessionToken) {
    return (
      <div className="relative flex-1 min-h-[calc(100dvh-56px)] bg-[#0b0a09] text-slate-100 flex items-center justify-center p-4">
        <div className="fixed bottom-2 left-3 z-50 text-[10px] text-amber-300/80 font-mono bg-slate-900/60 px-2 py-0.5 rounded border border-amber-500/25 pointer-events-none">
          Actualizado: {lastUpdatedText}
        </div>

        <div className="w-full max-w-md bg-[#15120f] border border-amber-500/35 rounded-2xl p-6 shadow-2xl shadow-black/70 space-y-5">
          <div className="flex items-center justify-between">
            <button
              type="button"
              onClick={onBackToStudio}
              className="text-xs text-slate-400 hover:text-amber-300 flex items-center gap-1 cursor-pointer"
            >
              <ArrowLeft className="w-3.5 h-3.5" />
              Volver
            </button>
            <span className="text-[10px] px-2.5 py-0.5 rounded-full bg-emerald-500/15 text-emerald-300 border border-emerald-500/30 font-bold">
              Wi-Fi + 5G Cifrado
            </span>
          </div>

          <div className="text-center space-y-1.5">
            <div className="w-12 h-12 mx-auto rounded-2xl bg-amber-500/15 border border-amber-500/40 flex items-center justify-center text-amber-400">
              <Lock className="w-6 h-6" />
            </div>
            <h2 className="text-lg font-black text-amber-300 tracking-wide">
              Acceso Privado — Flow PC (Agent)
            </h2>
            <p className="text-xs text-slate-400 leading-relaxed">
              Escritorio Chrome aislado en tu Mac (sin mover tu mouse físico y 0% extensiones) listo
              para operar <strong>Google Flow Agent</strong> desde iPhone.
            </p>
          </div>

          <form onSubmit={handleUnlockFormSubmit} className="space-y-3.5">
            <div className="relative">
              <input
                type={showPassword ? 'text' : 'password'}
                value={passwordInput}
                onChange={(e) => {
                  setPasswordInput(e.target.value);
                  if (authError) setAuthError('');
                }}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' || e.key === 'NumpadEnter' || e.keyCode === 13) {
                    e.preventDefault();
                    if (!isAuthenticating) performUnlock();
                  }
                }}
                autoCapitalize="none"
                autoCorrect="off"
                spellCheck={false}
                inputMode="text"
                autoComplete="current-password"
                placeholder="Contraseña privada de Flow PC..."
                className="w-full bg-slate-950 border border-amber-500/40 focus:border-amber-400 rounded-xl px-3.5 py-3 pr-10 text-sm text-slate-100 outline-none"
                autoFocus
              />
              <button
                type="button"
                onClick={() => setShowPassword((v) => !v)}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-amber-300 cursor-pointer"
                title={showPassword ? 'Ocultar contraseña' : 'Mostrar contraseña'}
              >
                {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
              </button>
            </div>

            {authError && (
              <div className="text-xs text-rose-300 bg-rose-950/50 border border-rose-500/40 rounded-xl px-3 py-2 flex items-center gap-2">
                <AlertTriangle className="w-4 h-4 shrink-0 text-rose-400" />
                <span>{authError}</span>
              </div>
            )}

            {authStepMsg && (
              <div className="text-xs text-amber-200 bg-amber-500/10 border border-amber-500/30 rounded-xl px-3 py-2 flex items-center gap-2">
                <RefreshCw className="w-3.5 h-3.5 animate-spin shrink-0 text-amber-400" />
                <span>{authStepMsg}</span>
              </div>
            )}

            <button
              type="submit"
              disabled={isAuthenticating}
              className="w-full py-3 rounded-xl bg-amber-500 hover:bg-amber-400 disabled:opacity-60 text-slate-950 font-black text-sm flex items-center justify-center gap-2 shadow-lg shadow-amber-500/20 cursor-pointer transition"
            >
              {isAuthenticating ? (
                <>
                  <RefreshCw className="w-4 h-4 animate-spin" />
                  <span>Conectando...</span>
                </>
              ) : (
                <>
                  <Lock className="w-4 h-4" />
                  <span>Entrar a Flow PC</span>
                </>
              )}
            </button>
          </form>
        </div>
      </div>
    );
  }

  // ==========================================================================
  // RENDER 2: AUTHENTICATED FLOW PC WORKSPACE (VNC + MOBILE CONTROL BAR)
  // ==========================================================================
  const containerState = status?.containerState || 'starting';
  const isRunning = containerState === 'running';
  const isPaused = containerState === 'paused';
  const fullIframeUrl = vncSrcPath ? `${baseUrl}${vncSrcPath}` : '';
  const isUsing5GTunnel = baseUrl.includes('.trycloudflare.com');
  const recentDownloads = status?.recentDownloads || [];

  return (
    <div
      className={`${
        isZenFullscreen
          ? 'fixed inset-0 z-[999999] w-screen h-[100dvh] pt-[env(safe-area-inset-top,0px)]'
          : 'relative flex-1 h-[calc(100dvh-46px)] max-h-[calc(100dvh-46px)]'
      } bg-[#090807] text-slate-100 flex flex-col overflow-hidden select-none`}
    >
      {/* Deployment Verification Timestamp Corner Label */}
      <div className="fixed top-1.5 right-2 z-[1000001] text-[9px] text-amber-300/70 font-mono bg-black/55 px-1.5 py-0.5 rounded pointer-events-none">
        Actualizado: {lastUpdatedText}
      </div>

      {/* Toast Notification */}
      {toastMsg && (
        <div className="fixed top-11 left-1/2 -translate-x-1/2 z-[1000002] max-w-[92vw] bg-slate-900/95 border border-amber-400/50 text-amber-200 text-xs font-semibold px-3.5 py-2 rounded-xl shadow-2xl">
          {toastMsg}
        </div>
      )}

      {/* Compact Top Control Bar */}
      <div className="shrink-0 bg-[#14110e] border-b border-amber-500/20 px-2.5 py-1.5 flex items-center justify-between gap-1.5 overflow-x-auto whitespace-nowrap [-webkit-overflow-scrolling:touch]">
        <div className="flex items-center gap-1.5 shrink-0">
          {!isZenFullscreen && (
            <button
              type="button"
              onClick={onBackToStudio}
              className="px-2 py-1 rounded-lg bg-slate-900 hover:bg-slate-800 text-slate-300 border border-slate-700 text-[11px] font-bold flex items-center gap-1 cursor-pointer"
            >
              <ArrowLeft className="w-3 h-3" />
              <span className="hidden sm:inline">Estudio</span>
            </button>
          )}

          <span
            className={`px-2 py-0.5 rounded-full text-[10px] font-black border flex items-center gap-1 ${
              isRunning
                ? 'bg-emerald-500/15 text-emerald-300 border-emerald-500/40'
                : isPaused
                ? 'bg-amber-500/15 text-amber-300 border-amber-500/40'
                : 'bg-slate-800 text-slate-400 border-slate-700'
            }`}
          >
            <span
              className={`w-1.5 h-1.5 rounded-full ${
                isRunning ? 'bg-emerald-400 animate-pulse' : isPaused ? 'bg-amber-400' : 'bg-slate-500'
              }`}
            />
            {isRunning
              ? 'Flow PC Activo'
              : isPaused
              ? 'Suspendido (0% CPU)'
              : containerState === 'starting'
              ? 'Iniciando...'
              : 'Apagado'}
          </span>

          <span className="px-2 py-0.5 rounded-full text-[10px] font-semibold bg-sky-500/10 text-sky-300 border border-sky-500/25 flex items-center gap-1">
            {isUsing5GTunnel ? <Smartphone className="w-3 h-3" /> : <Wifi className="w-3 h-3" />}
            {isUsing5GTunnel ? '5G Túnel' : 'Wi-Fi Directo'}
          </span>
        </div>

        <div className="flex items-center gap-1 shrink-0">
          {!isRunning ? (
            <button
              type="button"
              disabled={actionBusy === 'start'}
              onClick={() => callAuthEndpoint('/api/flow-pc/start', undefined, 'start')}
              className="px-2.5 py-1 rounded-lg bg-emerald-500 hover:bg-emerald-400 text-slate-950 font-black text-[11px] flex items-center gap-1 cursor-pointer"
            >
              <Play className="w-3 h-3 fill-current" />
              <span>{isPaused ? 'Reanudar' : 'Encender'}</span>
            </button>
          ) : (
            <button
              type="button"
              disabled={actionBusy === 'suspend'}
              onClick={() => callAuthEndpoint('/api/flow-pc/suspend', undefined, 'suspend')}
              className="px-2 py-1 rounded-lg bg-amber-500/20 hover:bg-amber-500/30 text-amber-200 border border-amber-500/40 font-bold text-[11px] flex items-center gap-1 cursor-pointer"
              title="Congela Flow PC al instante liberando 100% de CPU sin cerrar tu sesión"
            >
              <Pause className="w-3 h-3" />
              <span>Suspender</span>
            </button>
          )}

          {(isRunning || isPaused) && (
            <button
              type="button"
              disabled={actionBusy === 'stop'}
              onClick={() => callAuthEndpoint('/api/flow-pc/stop', undefined, 'stop')}
              className="p-1 rounded-lg bg-slate-900 hover:bg-rose-950/60 text-slate-400 hover:text-rose-300 border border-slate-700 cursor-pointer"
              title="Guardar cookies y apagar contenedor"
            >
              <Square className="w-3 h-3" />
            </button>
          )}

          <select
            value={status?.resolution || '1280x800'}
            onChange={(e) =>
              callAuthEndpoint('/api/flow-pc/resolution', { resolution: e.target.value }, 'res')
            }
            className="bg-slate-900 border border-slate-700 rounded-lg px-1.5 py-1 text-[11px] font-bold text-slate-200 cursor-pointer"
            title="Resolución del escritorio Flow PC"
          >
            <option value="1280x800">1280×800</option>
            <option value="1440x900">1440×900</option>
            <option value="1920x1080">1920×1080</option>
            <option value="1024x768">1024×768</option>
          </select>

          <button
            type="button"
            onClick={() => {
              if (status?.vncEntryPath) {
                setVncSrcPath(`${status.vncEntryPath}&r=${Date.now()}`);
              }
            }}
            className="p-1 rounded-lg bg-slate-900 hover:bg-slate-800 text-slate-300 border border-slate-700 cursor-pointer"
            title="Reconectar pantalla"
          >
            <RefreshCw className="w-3.5 h-3.5" />
          </button>

          <button
            type="button"
            onClick={() => setIsZenFullscreen((v) => !v)}
            className={`px-2 py-1 rounded-lg text-[11px] font-bold border flex items-center gap-1 cursor-pointer ${
              isZenFullscreen
                ? 'bg-amber-500 text-slate-950 border-amber-300'
                : 'bg-slate-900 text-amber-300 border-amber-500/35'
            }`}
            title="Modo Pantalla Completa Zen adaptado a iPhone Chrome"
          >
            {isZenFullscreen ? <Minimize2 className="w-3 h-3" /> : <Maximize2 className="w-3 h-3" />}
            <span className="hidden xs:inline">{isZenFullscreen ? 'Salir Zen' : 'Zen'}</span>
          </button>

          {fullIframeUrl && (
            <a
              href={fullIframeUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="px-2 py-1 rounded-lg bg-slate-900 hover:bg-slate-800 text-sky-300 border border-sky-500/30 text-[11px] font-bold flex items-center gap-1"
              title="Abrir escritorio Flow PC en una pestaña dedicada de Chrome"
            >
              <ExternalLink className="w-3 h-3" />
              <span className="hidden sm:inline">Pestaña</span>
            </a>
          )}

          <button
            type="button"
            onClick={() => {
              localStorage.removeItem(SESSION_STORAGE_KEY);
              setSessionToken('');
            }}
            className="p-1 rounded-lg bg-slate-900 hover:bg-slate-800 text-slate-400 border border-slate-800 cursor-pointer"
            title="Bloquear acceso privado"
          >
            <LogOut className="w-3 h-3" />
          </button>
        </div>
      </div>

      {/* Center KasmVNC Remote Desktop Viewport */}
      <div
        ref={vncWrapRef}
        className="relative flex-1 w-full bg-black overflow-hidden"
        style={{ touchAction: 'none', overscrollBehavior: 'none' }}
      >
        {isPaused ? (
          <div className="w-full h-full flex flex-col items-center justify-center p-6 text-center space-y-3 bg-[#0c0b09]">
            <Pause className="w-10 h-10 text-amber-400" />
            <div className="text-sm font-black text-amber-200">
              Flow PC está en Suspensión Instantánea (0% CPU en tu Mac)
            </div>
            <p className="text-xs text-slate-400 max-w-sm">
              Tu pestaña abierta de Google Flow sigue intacta en memoria. Toca Reanudar para volver
              en menos de 1 segundo.
            </p>
            <button
              type="button"
              onClick={() => callAuthEndpoint('/api/flow-pc/start', undefined, 'start')}
              className="px-5 py-2.5 rounded-xl bg-emerald-500 hover:bg-emerald-400 text-slate-950 font-black text-xs flex items-center gap-2 cursor-pointer shadow-lg"
            >
              <Play className="w-4 h-4 fill-current" />
              Reanudar Flow PC Ahora
            </button>
          </div>
        ) : fullIframeUrl ? (
          <iframe
            src={fullIframeUrl}
            title="Flow PC Remote Chrome"
            className="w-full h-full border-0 bg-black"
            allow="clipboard-read; clipboard-write; fullscreen"
          />
        ) : (
          <div className="w-full h-full flex items-center justify-center text-xs text-slate-400">
            Cargando visor remoto...
          </div>
        )}
      </div>

      {/* Mobile-First Bottom Control Drawer (Keyboard-Aware on iOS CriOS) */}
      <div
        style={{
          marginBottom: keyboardOffsetBottom > 0 ? `${keyboardOffsetBottom}px` : undefined,
        }}
        className="shrink-0 bg-[#14110e] border-t border-amber-500/25 pb-[env(safe-area-inset-bottom,0px)]"
      >
        {/* Drawer Header Tabs */}
        <div className="px-2.5 py-1 flex items-center justify-between gap-1 border-b border-slate-800/80">
          <div className="flex items-center gap-1 overflow-x-auto whitespace-nowrap">
            <button
              type="button"
              onClick={() => {
                setBottomTab('prompt');
                setIsBottomBarCollapsed(false);
              }}
              className={`px-2.5 py-1 rounded-lg text-[11px] font-bold flex items-center gap-1 cursor-pointer ${
                !isBottomBarCollapsed && bottomTab === 'prompt'
                  ? 'bg-amber-500 text-slate-950'
                  : 'bg-slate-900 text-slate-300'
              }`}
            >
              <ClipboardPaste className="w-3 h-3" />
              <span>Prompt / Dictado</span>
            </button>

            <button
              type="button"
              onClick={() => {
                setBottomTab('routing');
                setIsBottomBarCollapsed(false);
              }}
              className={`px-2.5 py-1 rounded-lg text-[11px] font-bold flex items-center gap-1 cursor-pointer ${
                !isBottomBarCollapsed && bottomTab === 'routing'
                  ? 'bg-amber-500 text-slate-950'
                  : 'bg-slate-900 text-slate-300'
              }`}
            >
              <FolderOpen className="w-3 h-3" />
              <span>Destino & Fotos</span>
            </button>

            <button
              type="button"
              onClick={() => {
                setBottomTab('downloads');
                setIsBottomBarCollapsed(false);
              }}
              className={`px-2.5 py-1 rounded-lg text-[11px] font-bold flex items-center gap-1 cursor-pointer ${
                !isBottomBarCollapsed && bottomTab === 'downloads'
                  ? 'bg-emerald-500 text-slate-950'
                  : 'bg-slate-900 text-emerald-300 border border-emerald-500/30'
              }`}
            >
              <Download className="w-3 h-3" />
              <span>Descargas ({recentDownloads.length})</span>
            </button>
          </div>

          <button
            type="button"
            onClick={() => setIsBottomBarCollapsed((v) => !v)}
            className="px-2 py-1 rounded-lg bg-slate-900 text-slate-400 hover:text-amber-300 text-[11px] flex items-center gap-0.5 cursor-pointer shrink-0"
            title={isBottomBarCollapsed ? 'Mostrar barra móvil' : 'Ocultar barra para agrandar pantalla'}
          >
            {isBottomBarCollapsed ? (
              <>
                <ChevronUp className="w-3.5 h-3.5" />
                <span>Abrir</span>
              </>
            ) : (
              <>
                <ChevronDown className="w-3.5 h-3.5" />
                <span>Ocultar</span>
              </>
            )}
          </button>
        </div>

        {!isBottomBarCollapsed && (
          <div className="p-2.5 max-h-[38dvh] overflow-y-auto space-y-2">
            {/* TAB 1: NATIVE IPHONE DICTATION & 1-TAP DOCUMENTARY PROMPT PASTE */}
            {bottomTab === 'prompt' && (
              <div className="space-y-2">
                <div className="flex items-center gap-1.5 flex-wrap">
                  <select
                    value={selectedPresetKey}
                    onChange={(e) => {
                      const k = e.target.value;
                      setSelectedPresetKey(k);
                      const found = promptPresets.find((p) => p.key === k);
                      if (found) setPromptText(found.text);
                    }}
                    className="flex-1 min-w-[180px] bg-slate-950 border border-amber-500/35 rounded-lg px-2.5 py-1.5 text-xs text-amber-200 font-semibold"
                  >
                    <option value="">
                      📋 Elegir prompt de {activeDoc ? activeDoc.title : 'Documental'} ({promptPresets.length})...
                    </option>
                    {promptPresets.map((p) => (
                      <option key={p.key} value={p.key}>
                        {p.label}
                      </option>
                    ))}
                  </select>

                  {/* Quick X11 hardware keys for mobile touch convenience */}
                  <div className="flex items-center gap-1">
                    {[
                      { label: 'Ctrl+A', key: 'ctrl+a' },
                      { label: '⌫', key: 'BackSpace' },
                      { label: '⏎ Enter', key: 'Return' },
                      { label: 'Esc', key: 'Escape' },
                    ].map((hk) => (
                      <button
                        key={hk.key}
                        type="button"
                        onClick={() => callAuthEndpoint('/api/flow-pc/send-key', { key: hk.key })}
                        className="px-2 py-1 rounded bg-slate-900 hover:bg-slate-800 border border-slate-700 text-[10px] font-bold text-slate-300 cursor-pointer"
                      >
                        {hk.label}
                      </button>
                    ))}
                  </div>
                </div>

                <div className="flex items-stretch gap-1.5">
                  <textarea
                    value={promptText}
                    onChange={(e) => setPromptText(e.target.value)}
                    rows={2}
                    placeholder="Dicta con el micrófono del iPhone o escribe aquí tu instrucción para el Agent de Google Flow..."
                    className="flex-1 bg-slate-950 border border-slate-700 focus:border-amber-400 rounded-xl px-3 py-2 text-xs text-slate-100 outline-none resize-none select-text"
                  />
                  <div className="flex flex-col gap-1 shrink-0">
                    <button
                      type="button"
                      disabled={Boolean(actionBusy)}
                      onClick={() => handlePastePrompt(autoEnterOnPaste)}
                      className="flex-1 px-3 py-1.5 rounded-xl bg-amber-500 hover:bg-amber-400 text-slate-950 font-black text-xs flex items-center justify-center gap-1 cursor-pointer"
                    >
                      <ClipboardPaste className="w-3.5 h-3.5" />
                      <span>Pegar</span>
                    </button>
                    <button
                      type="button"
                      disabled={Boolean(actionBusy)}
                      onClick={() => handlePastePrompt(true)}
                      className="px-2.5 py-1 rounded-xl bg-emerald-500/20 hover:bg-emerald-500/30 text-emerald-300 border border-emerald-500/40 font-bold text-[10px] flex items-center justify-center gap-1 cursor-pointer"
                    >
                      <Send className="w-3 h-3" />
                      <span>Pegar+Enter</span>
                    </button>
                  </div>
                </div>

                <div className="flex items-center justify-between text-[10px] text-slate-400">
                  <label className="flex items-center gap-1.5 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={autoEnterOnPaste}
                      onChange={(e) => setAutoEnterOnPaste(e.target.checked)}
                      className="accent-amber-500"
                    />
                    <span>Pulsar Enter automáticamente al tocar «Pegar»</span>
                  </label>
                  <span className="text-slate-500">
                    Para subir @Ref en Flow: abre «+» → barra izquierda «Documentales_Huellas»
                  </span>
                </div>
              </div>
            )}

            {/* TAB 2: DOCUMENTARY FOLDER ROUTING + APPLE PHOTOS TOGGLE */}
            {bottomTab === 'routing' && (
              <div className="space-y-2.5 text-xs">
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                  <div>
                    <label className="block text-[10px] uppercase font-bold text-slate-400 mb-1">
                      Documental Destino en tu Mac
                    </label>
                    <select
                      value={status?.routing?.targetDocId || activeDoc?.id || ''}
                      onChange={(e) => {
                        const doc = documentaries.find((d) => d.id === e.target.value);
                        if (!doc) return;
                        onSelectDocId?.(doc.id);
                        callAuthEndpoint('/api/flow-pc/routing', {
                          targetDocId: doc.id,
                          targetDocTitle: doc.title,
                          targetFolderPath: doc.downloadFolderPath || '',
                          targetFolderName: doc.downloadFolderName || '',
                        });
                      }}
                      className="w-full bg-slate-950 border border-amber-500/35 rounded-lg px-2.5 py-1.5 text-xs font-bold text-amber-200"
                    >
                      {documentaries.map((d) => (
                        <option key={d.id} value={d.id}>
                          {d.title}
                        </option>
                      ))}
                    </select>
                  </div>

                  <div>
                    <label className="block text-[10px] uppercase font-bold text-slate-400 mb-1">
                      Subcarpeta de Descarga
                    </label>
                    <div className="grid grid-cols-4 gap-1">
                      {(
                        [
                          { id: 'auto', label: '🪄 Auto' },
                          { id: '05_Clips_Video', label: '🎬 Clips' },
                          { id: '04_Referencias', label: '🧑 @Refs' },
                          { id: '03_Miniaturas', label: '🖼️ Mini' },
                        ] as const
                      ).map((opt) => {
                        const active = (status?.routing?.routingMode || 'auto') === opt.id;
                        return (
                          <button
                            key={opt.id}
                            type="button"
                            onClick={() =>
                              callAuthEndpoint('/api/flow-pc/routing', { routingMode: opt.id })
                            }
                            className={`py-1.5 px-1.5 rounded-lg text-[11px] font-bold border cursor-pointer ${
                              active
                                ? 'bg-amber-500 text-slate-950 border-amber-300'
                                : 'bg-slate-950 text-slate-300 border-slate-800'
                            }`}
                          >
                            {opt.label}
                          </button>
                        );
                      })}
                    </div>
                  </div>
                </div>

                <div className="flex items-center justify-between gap-2 bg-slate-950/90 border border-slate-800 rounded-xl px-3 py-2 flex-wrap">
                  <label className="flex items-center gap-2 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={Boolean(status?.routing?.autoImportMacPhotos)}
                      onChange={(e) =>
                        callAuthEndpoint('/api/flow-pc/routing', {
                          autoImportMacPhotos: e.target.checked,
                        })
                      }
                      className="accent-amber-500 w-4 h-4"
                    />
                    <span className="text-xs font-semibold text-slate-200">
                      📸 Enviar también automáticamente a la app <strong>Fotos</strong> de la Mac
                      (álbum del documental)
                    </span>
                  </label>
                  <span className="text-[10px] text-emerald-300 font-mono truncate max-w-full">
                    📂 {status?.routing?.resolvedRootFolder || 'Auto-detectando carpeta en iCloud...'}
                  </span>
                </div>
              </div>
            )}

            {/* TAB 3: RECENT DOWNLOADS -> IPHONE CAMERA ROLL + MAC PHOTOS */}
            {bottomTab === 'downloads' && (
              <div className="space-y-1.5">
                {recentDownloads.length === 0 ? (
                  <div className="text-xs text-slate-400 bg-slate-950 border border-slate-800 rounded-xl px-3 py-3 text-center">
                    Cualquier video, imagen o lote <code>.zip</code> que descargues dentro de Google
                    Flow aparecerá aquí automáticamente y se moverá a la subcarpeta del documental en
                    tu Mac.
                  </div>
                ) : (
                  recentDownloads.map((item) => {
                    const isReadyInRam = Boolean(preparedShareFiles[item.id]);
                    const isPreparing = preparingAssetId === item.id;
                    const directAttachUrl = `${baseUrl}/api/flow-pc/download-file/${encodeURIComponent(item.id)}?cap=${encodeURIComponent(item.downloadToken)}&disposition=attachment`;

                    return (
                      <div
                        key={item.id}
                        className="bg-slate-950 border border-slate-800 rounded-xl px-3 py-2 flex items-center justify-between gap-2 flex-wrap"
                      >
                        <div className="min-w-0 flex-1">
                          <div className="text-xs font-bold text-slate-100 truncate flex items-center gap-1.5">
                            {item.mimeType.startsWith('video/') ? (
                              <Film className="w-3.5 h-3.5 text-amber-400 shrink-0" />
                            ) : (
                              <ImageIcon className="w-3.5 h-3.5 text-sky-400 shrink-0" />
                            )}
                            <span className="truncate">{item.fileName}</span>
                          </div>
                          <div className="text-[10px] text-slate-400 flex items-center gap-2">
                            <span className="text-amber-300 font-semibold">{item.subFolder}</span>
                            <span>•</span>
                            <span>{formatBytes(item.sizeBytes)}</span>
                            <span>•</span>
                            <span className="truncate">{item.docTitle}</span>
                          </div>
                        </div>

                        <div className="flex items-center gap-1.5 shrink-0">
                          <button
                            type="button"
                            disabled={isPreparing}
                            onClick={() => handlePrepareOrShareToIphonePhotos(item)}
                            className={`px-2.5 py-1.5 rounded-lg text-[11px] font-black flex items-center gap-1 cursor-pointer ${
                              isReadyInRam
                                ? 'bg-emerald-500 text-slate-950 animate-pulse'
                                : 'bg-sky-500/20 hover:bg-sky-500/30 text-sky-200 border border-sky-500/40'
                            }`}
                          >
                            {isPreparing ? (
                              <>
                                <RefreshCw className="w-3 h-3 animate-spin" />
                                <span>Preparando...</span>
                              </>
                            ) : isReadyInRam ? (
                              <>
                                <Share2 className="w-3 h-3" />
                                <span>📲 Guardar en Fotos iPhone</span>
                              </>
                            ) : (
                              <>
                                <Share2 className="w-3 h-3" />
                                <span>📲 Fotos iPhone</span>
                              </>
                            )}
                          </button>

                          <button
                            type="button"
                            disabled={item.importedToMacPhotos}
                            onClick={async () => {
                              const r = await callAuthEndpoint(
                                '/api/flow-pc/import-mac-photos',
                                { id: item.id },
                                `photos_${item.id}`
                              );
                              if (r?.ok) showToast('📸 Importado en la app Fotos de tu Mac');
                            }}
                            className={`px-2 py-1.5 rounded-lg text-[11px] font-bold flex items-center gap-1 cursor-pointer ${
                              item.importedToMacPhotos
                                ? 'bg-emerald-950/60 text-emerald-400 border border-emerald-500/30'
                                : 'bg-slate-900 hover:bg-slate-800 text-amber-200 border border-amber-500/30'
                            }`}
                            title="Importar a la app Fotos de tu Mac"
                          >
                            {item.importedToMacPhotos ? (
                              <>
                                <Check className="w-3 h-3" />
                                <span>Fotos Mac</span>
                              </>
                            ) : (
                              <span>📸 Mac</span>
                            )}
                          </button>

                          <a
                            href={directAttachUrl}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="p-1.5 rounded-lg bg-slate-900 hover:bg-slate-800 text-slate-300 border border-slate-700"
                            title="Descarga directa de archivo"
                          >
                            <Download className="w-3.5 h-3.5" />
                          </a>
                        </div>
                      </div>
                    );
                  })
                )}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
};
