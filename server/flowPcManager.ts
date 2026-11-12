import type { Express, Request, Response, NextFunction } from 'express';
import http from 'http';
import net from 'net';
import fs from 'fs';
import path from 'path';
import os from 'os';
import crypto from 'crypto';
import dotenv from 'dotenv';
import { execFile, spawn, ChildProcess } from 'child_process';

export interface FlowPcManagerDeps {
  dataDir: string;
  resolveLocalDocumentaryFolder: (
    folderPathQuery?: string,
    folderNameQuery?: string,
    docTitleQuery?: string
  ) => string;
  ensureDocumentarySubfolders: (rootFolderPath: string) => void;
  getLocalGitHubToken: () => string;
  githubOwner: string;
  githubRepo: string;
  githubBranch: string;
}

export type FlowRoutingMode = 'auto' | '05_Clips_Video' | '04_Referencias' | '03_Miniaturas';

export interface FlowRoutingConfig {
  targetDocId: string;
  targetDocTitle: string;
  targetFolderPath: string;
  targetFolderName: string;
  routingMode: FlowRoutingMode;
  autoImportMacPhotos: boolean;
}

export interface FlowDownloadedItem {
  id: string;
  fileName: string;
  finalPath: string;
  subFolder: string;
  docTitle: string;
  sizeBytes: number;
  mimeType: string;
  sha256: string;
  createdAt: number;
  importedToMacPhotos: boolean;
}

interface EnvSecrets {
  iter: number;
  saltBuf: Buffer;
  hashBuf: Buffer;
  kdfSaltB64: string;
  envelopeKeyBuf: Buffer;
  ntfyTopic: string;
  hmacSecretBuf: Buffer;
}

const ALLOWED_RESOLUTIONS = new Set(['1280x800', '1440x900', '1920x1080', '1024x768']);
const ALLOWED_KEYS: Record<string, string> = {
  Return: 'Return',
  Escape: 'Escape',
  BackSpace: 'BackSpace',
  Tab: 'Tab',
  'ctrl+a': 'ctrl+a',
  'ctrl+z': 'ctrl+z',
  'ctrl+v': 'ctrl+v',
};

export function normalizeFlowSecretUtf8(raw: string): Buffer {
  return Buffer.from(String(raw ?? '').trim().normalize('NFC'), 'utf8');
}

function toBase64Url(buf: Buffer): string {
  return buf.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}

function fromBase64Url(str: string): Buffer {
  const padded = str.replace(/-/g, '+').replace(/_/g, '/');
  const padLen = (4 - (padded.length % 4)) % 4;
  return Buffer.from(padded + '='.repeat(padLen), 'base64');
}

function detectLanUrl(port: number): string {
  try {
    const nets = os.networkInterfaces();
    for (const ifaceList of Object.values(nets)) {
      for (const info of ifaceList || []) {
        if (info.family === 'IPv4' && !info.internal) {
          if (/^(192\.168\.|10\.|172\.(1[6-9]|2\d|3[01])\.)/.test(info.address)) {
            return `http://${info.address}:${port}`;
          }
        }
      }
    }
  } catch {}
  return '';
}

function guessMimeType(fileName: string): string {
  const ext = path.extname(fileName).toLowerCase();
  switch (ext) {
    case '.mp4':
      return 'video/mp4';
    case '.mov':
      return 'video/quicktime';
    case '.webm':
      return 'video/webm';
    case '.png':
      return 'image/png';
    case '.jpg':
    case '.jpeg':
      return 'image/jpeg';
    case '.webp':
      return 'image/webp';
    default:
      return 'application/octet-stream';
  }
}

export function createFlowPcManager(deps: FlowPcManagerDeps, serverPort: number) {
  const flowLocalDir = path.join(deps.dataDir, 'flow-pc');
  const localStateFile = path.join(flowLocalDir, 'state.local.json');
  const photosLedgerFile = path.join(flowLocalDir, 'photos_ledger.local.json');
  const tunnelEnvelopeDataFile = path.join(deps.dataDir, 'flow_pc_tunnel.enc.json');
  const tunnelEnvelopeDocsFile = path.join(process.cwd(), 'docs', 'data', 'flow_pc_tunnel.enc.json');
  const composeDir = path.join(process.cwd(), 'docker', 'flow-pc');
  const composeFile = path.join(composeDir, 'docker-compose.yml');
  const stagingDir = path.join(os.homedir(), 'Library', 'Caches', 'huellas-flow-staging');
  const icloudVideosRoot = path.join(
    os.homedir(),
    'Library',
    'Mobile Documents',
    'com~apple~CloudDocs',
    '0YouTube',
    'Huellas de la Humanidad',
    'Videos'
  );

  for (const dir of [flowLocalDir, stagingDir]) {
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
  }

  let currentResolution = '1280x800';
  let routing: FlowRoutingConfig = {
    targetDocId: 'doc-video-77-huellas',
    targetDocTitle: 'Video 77 — La Penicilina',
    targetFolderPath: '',
    targetFolderName: '',
    routingMode: 'auto',
    autoImportMacPhotos: false,
  };
  let recentDownloads: FlowDownloadedItem[] = [];
  let importedPhotoHashes = new Set<string>();

  // Load persisted local state
  try {
    if (fs.existsSync(localStateFile)) {
      const parsed = JSON.parse(fs.readFileSync(localStateFile, 'utf8'));
      if (parsed.routing && typeof parsed.routing === 'object') {
        routing = { ...routing, ...parsed.routing };
      }
      if (typeof parsed.currentResolution === 'string' && ALLOWED_RESOLUTIONS.has(parsed.currentResolution)) {
        currentResolution = parsed.currentResolution;
      }
      if (Array.isArray(parsed.recentDownloads)) {
        recentDownloads = parsed.recentDownloads.filter((it: any) => it && it.id && it.finalPath);
      }
    }
  } catch {}

  try {
    if (fs.existsSync(photosLedgerFile)) {
      const arr = JSON.parse(fs.readFileSync(photosLedgerFile, 'utf8'));
      if (Array.isArray(arr)) {
        importedPhotoHashes = new Set(arr.map(String));
      }
    }
  } catch {}

  function saveLocalState() {
    try {
      fs.writeFileSync(
        localStateFile,
        JSON.stringify(
          {
            currentResolution,
            routing,
            recentDownloads: recentDownloads.slice(0, 40),
          },
          null,
          2
        ),
        { mode: 0o600 }
      );
    } catch {}
  }

  function savePhotosLedger() {
    try {
      fs.writeFileSync(photosLedgerFile, JSON.stringify(Array.from(importedPhotoHashes)), { mode: 0o600 });
    } catch {}
  }

  function loadSecrets(): EnvSecrets | null {
    if (!process.env.FLOW_PC_HASH_B64 || !process.env.FLOW_PC_HMAC_SECRET_B64) {
      const envPath = path.join(process.cwd(), '.env');
      if (fs.existsSync(envPath)) {
        try {
          const parsed = dotenv.parse(fs.readFileSync(envPath, 'utf8'));
          for (const [k, v] of Object.entries(parsed)) {
            if (k.startsWith('FLOW_PC_') && v) {
              process.env[k] = v;
            }
          }
        } catch {}
      }
    }
    const iter = Number(process.env.FLOW_PC_ITER || 210000) || 210000;
    const saltB64 = process.env.FLOW_PC_SALT_B64 || '';
    const hashB64 = process.env.FLOW_PC_HASH_B64 || '';
    const kdfSaltB64 = process.env.FLOW_PC_KDF_SALT_B64 || '';
    const envKeyB64 = process.env.FLOW_PC_ENVELOPE_KEY_B64 || '';
    const ntfyTopic = process.env.FLOW_PC_NTFY_TOPIC || '';
    const hmacB64 = process.env.FLOW_PC_HMAC_SECRET_B64 || '';
    if (!saltB64 || !hashB64 || !hmacB64) return null;
    return {
      iter,
      saltBuf: Buffer.from(saltB64, 'base64'),
      hashBuf: Buffer.from(hashB64, 'base64'),
      kdfSaltB64,
      envelopeKeyBuf: envKeyB64 ? Buffer.from(envKeyB64, 'base64') : Buffer.alloc(0),
      ntfyTopic,
      hmacSecretBuf: Buffer.from(hmacB64, 'base64'),
    };
  }

  function issueToken(scope: 'session' | 'vnc' | 'file', ttlMs: number, extra: Record<string, any> = {}): string {
    const secrets = loadSecrets();
    if (!secrets) throw new Error('FLOW_PC secrets not configured in .env');
    const payload = {
      s: scope,
      exp: Date.now() + ttlMs,
      n: crypto.randomBytes(6).toString('hex'),
      ...extra,
    };
    const payloadPart = toBase64Url(Buffer.from(JSON.stringify(payload), 'utf8'));
    const sigPart = toBase64Url(
      crypto.createHmac('sha256', secrets.hmacSecretBuf).update(payloadPart).digest()
    );
    return `${payloadPart}.${sigPart}`;
  }

  function verifyToken(
    rawToken: string | undefined,
    allowedScopes: Array<'session' | 'vnc' | 'file'>
  ): Record<string, any> | null {
    if (!rawToken || typeof rawToken !== 'string') return null;
    const secrets = loadSecrets();
    if (!secrets) return null;
    const parts = rawToken.trim().split('.');
    if (parts.length !== 2) return null;
    const [payloadPart, sigPart] = parts;
    try {
      const expectedSig = crypto.createHmac('sha256', secrets.hmacSecretBuf).update(payloadPart).digest();
      const providedSig = fromBase64Url(sigPart);
      if (expectedSig.length !== providedSig.length) return null;
      if (!crypto.timingSafeEqual(expectedSig, providedSig)) return null;
      const decoded = JSON.parse(fromBase64Url(payloadPart).toString('utf8'));
      if (!decoded || typeof decoded.exp !== 'number' || decoded.exp <= Date.now()) return null;
      if (!allowedScopes.includes(decoded.s)) return null;
      return decoded;
    } catch {
      return null;
    }
  }

  function extractBearerToken(req: Request): string {
    const authHeader = String(req.headers.authorization || '').trim();
    if (/^Bearer\s+/i.test(authHeader)) {
      return authHeader.replace(/^Bearer\s+/i, '').trim();
    }
    if (typeof req.query.cap === 'string') return req.query.cap;
    return '';
  }

  function requireSessionAuth(req: Request, res: Response, next: NextFunction) {
    const tok = extractBearerToken(req);
    const verified = verifyToken(tok, ['session']);
    if (!verified) {
      res.status(401).json({ ok: false, error: 'Sesión de Flow PC expirada o no autorizada.' });
      return;
    }
    next();
  }

  // Brute-force limiter for /api/flow-pc/auth
  const authFailuresByIp = new Map<string, { count: number; resetAt: number }>();

  // Resolve Docker & Cloudflared binaries on Intel Mac
  function resolveDockerBin(): string {
    const candidates = [
      '/usr/local/bin/docker',
      '/Applications/OrbStack.app/Contents/MacOS/xbin/docker',
      path.join(os.homedir(), '.orbstack', 'bin', 'docker'),
      '/opt/homebrew/bin/docker',
    ];
    for (const c of candidates) {
      if (fs.existsSync(c)) return c;
    }
    return 'docker';
  }

  function resolveCloudflaredBin(): string {
    const candidates = ['/usr/local/bin/cloudflared', '/opt/homebrew/bin/cloudflared'];
    for (const c of candidates) {
      if (fs.existsSync(c)) return c;
    }
    return 'cloudflared';
  }

  function execCmd(
    bin: string,
    args: string[],
    timeoutMs = 15000,
    extraEnv: Record<string, string> = {}
  ): Promise<{ code: number; stdout: string; stderr: string }> {
    return new Promise((resolve) => {
      execFile(
        bin,
        args,
        {
          timeout: timeoutMs,
          maxBuffer: 8 * 1024 * 1024,
          env: {
            ...process.env,
            PATH: `${path.join(os.homedir(), '.orbstack', 'bin')}:/usr/local/bin:/Applications/OrbStack.app/Contents/MacOS/xbin:/Applications/OrbStack.app/Contents/MacOS/bin:/usr/bin:/bin:/usr/sbin:/sbin:${process.env.PATH || ''}`,
            ...extraEnv,
          },
        },
        (err, stdout, stderr) => {
          resolve({
            code: err ? (typeof (err as any).code === 'number' ? (err as any).code : 1) : 0,
            stdout: String(stdout || ''),
            stderr: String(stderr || ''),
          });
        }
      );
    });
  }

  function spawnWithStdin(
    bin: string,
    args: string[],
    stdinBuf: Buffer,
    timeoutMs = 10000
  ): Promise<{ code: number; stderr: string }> {
    return new Promise((resolve) => {
      let settled = false;
      const child = spawn(bin, args, {
        stdio: ['pipe', 'ignore', 'pipe'],
        env: {
          ...process.env,
          PATH: `${path.join(os.homedir(), '.orbstack', 'bin')}:/usr/local/bin:/Applications/OrbStack.app/Contents/MacOS/xbin:/usr/bin:/bin:${process.env.PATH || ''}`,
        },
      });
      let stderr = '';
      const timer = setTimeout(() => {
        if (!settled) {
          settled = true;
          try {
            child.kill('SIGKILL');
          } catch {}
          resolve({ code: 124, stderr: 'Timeout writing stdin' });
        }
      }, timeoutMs);
      child.stderr?.on('data', (chunk) => {
        stderr += String(chunk);
      });
      child.on('error', (err) => {
        if (!settled) {
          settled = true;
          clearTimeout(timer);
          resolve({ code: 1, stderr: String(err.message || err) });
        }
      });
      child.on('close', (code) => {
        if (!settled) {
          settled = true;
          clearTimeout(timer);
          resolve({ code: code ?? 0, stderr });
        }
      });
      try {
        child.stdin?.write(stdinBuf);
        child.stdin?.end();
      } catch {}
    });
  }

  async function ensureOrbStackReady(): Promise<boolean> {
    const dockerBin = resolveDockerBin();
    const check = await execCmd(dockerBin, ['info', '--format', '{{.ServerVersion}}'], 4000);
    if (check.code === 0 && check.stdout.trim()) return true;
    await execCmd('open', ['-g', '-a', 'OrbStack'], 5000);
    for (let i = 0; i < 15; i++) {
      await new Promise((r) => setTimeout(r, 1500));
      const retry = await execCmd(dockerBin, ['info', '--format', '{{.ServerVersion}}'], 4000);
      if (retry.code === 0 && retry.stdout.trim()) return true;
    }
    return false;
  }

  async function getContainerState(): Promise<'running' | 'paused' | 'stopped' | 'missing'> {
    const dockerBin = resolveDockerBin();
    const res = await execCmd(
      dockerBin,
      ['inspect', '-f', '{{.State.Status}}', 'huellas-flow-pc'],
      3500
    );
    if (res.code !== 0) return 'missing';
    const st = res.stdout.trim().toLowerCase();
    if (st === 'running') return 'running';
    if (st === 'paused') return 'paused';
    return 'stopped';
  }

  function probeLocalVncReady(): Promise<boolean> {
    return new Promise((resolve) => {
      const req = http.get(
        {
          host: '127.0.0.1',
          port: 3090,
          path: '/',
          timeout: 1200,
        },
        (res) => {
          res.resume();
          resolve(Boolean(res.statusCode && res.statusCode < 500));
        }
      );
      req.on('error', () => resolve(false));
      req.on('timeout', () => {
        req.destroy();
        resolve(false);
      });
    });
  }

  function materializeIcloudReferencesInBackground() {
    try {
      const docRoot = deps.resolveLocalDocumentaryFolder(
        routing.targetFolderPath,
        routing.targetFolderName,
        routing.targetDocTitle
      );
      if (!docRoot || !fs.existsSync(docRoot)) return;
      const refsDir = path.join(docRoot, '04_Referencias');
      if (!fs.existsSync(refsDir)) return;
      execCmd('brctl', ['download', refsDir], 12000).catch(() => {});
    } catch {}
  }

  let isStartingContainer = false;

  async function startOrResumeContainer(): Promise<{ ok: boolean; state: string; error?: string }> {
    if (isStartingContainer) {
      for (let i = 0; i < 25 && isStartingContainer; i++) {
        await new Promise((r) => setTimeout(r, 1000));
      }
    }
    isStartingContainer = true;
    try {
      if (!fs.existsSync(stagingDir)) {
        try {
          fs.mkdirSync(stagingDir, { recursive: true });
        } catch {}
      }

      const orbReady = await ensureOrbStackReady();
      if (!orbReady) {
        return { ok: false, state: 'stopped', error: 'No se pudo iniciar el motor Docker de OrbStack.' };
      }

      const dockerBin = resolveDockerBin();
      const st = await getContainerState();
      if (st === 'paused') {
        const unp = await execCmd(dockerBin, ['unpause', 'huellas-flow-pc'], 8000);
        if (unp.code !== 0) {
          return { ok: false, state: 'paused', error: unp.stderr || 'Error reanudando contenedor.' };
        }
      } else if (st === 'stopped') {
        const strt = await execCmd(dockerBin, ['start', 'huellas-flow-pc'], 15000);
        if (strt.code !== 0) {
          const up = await execCmd(
            dockerBin,
            ['compose', '-f', composeFile, 'up', '-d'],
            180000,
            {
              HUELLAS_VIDEOS_ROOT: icloudVideosRoot,
              HUELLAS_FLOW_STAGING_DIR: stagingDir,
            }
          );
          if (up.code !== 0) {
            return { ok: false, state: 'stopped', error: up.stderr || 'Error levantando Flow PC.' };
          }
        }
      } else if (st === 'missing') {
        const up = await execCmd(
          dockerBin,
          ['compose', '-f', composeFile, 'up', '-d', '--build'],
          300000,
          {
            HUELLAS_VIDEOS_ROOT: icloudVideosRoot,
            HUELLAS_FLOW_STAGING_DIR: stagingDir,
          }
        );
        if (up.code !== 0) {
          return { ok: false, state: 'missing', error: up.stderr || 'Error construyendo imagen Flow PC.' };
        }
      }

      materializeIcloudReferencesInBackground();
      ensureCloudflaredRunning();

      for (let i = 0; i < 25; i++) {
        if (await probeLocalVncReady()) {
          return { ok: true, state: 'running' };
        }
        await new Promise((r) => setTimeout(r, 800));
      }
      return { ok: true, state: await getContainerState() };
    } finally {
      isStartingContainer = false;
    }
  }

  async function suspendContainer(): Promise<{ ok: boolean; state: string; error?: string }> {
    const dockerBin = resolveDockerBin();
    const st = await getContainerState();
    if (st === 'running') {
      const p = await execCmd(dockerBin, ['pause', 'huellas-flow-pc'], 8000);
      if (p.code !== 0) {
        return { ok: false, state: st, error: p.stderr || 'No se pudo pausar Flow PC.' };
      }
      return { ok: true, state: 'paused' };
    }
    return { ok: true, state: st };
  }

  async function stopContainerGracefully(): Promise<{ ok: boolean; state: string; error?: string }> {
    const dockerBin = resolveDockerBin();
    const st = await getContainerState();
    if (st === 'missing' || st === 'stopped') {
      return { ok: true, state: 'stopped' };
    }
    if (st === 'paused') {
      await execCmd(dockerBin, ['unpause', 'huellas-flow-pc'], 5000);
    }
    await execCmd(
      dockerBin,
      [
        'exec',
        '-u',
        'abc',
        'huellas-flow-pc',
        'sh',
        '-c',
        'touch /tmp/.huellas_stopping_chrome && pkill -TERM -x chrome 2>/dev/null || true',
      ],
      5000
    );
    await new Promise((r) => setTimeout(r, 1600));
    const stopRes = await execCmd(dockerBin, ['stop', '-t', '10', 'huellas-flow-pc'], 15000);
    if (stopRes.code !== 0) {
      return { ok: false, state: await getContainerState(), error: stopRes.stderr };
    }
    return { ok: true, state: 'stopped' };
  }

  // ==========================================================================
  // 5G CLOUDFLARED TUNNEL + AES-256-GCM ENCRYPTED SYNC + NTFY WAKE-ON-5G
  // ==========================================================================
  let cloudflaredProc: ChildProcess | null = null;
  let activeTunnelUrl = '';
  let lastEncryptedEnvelopeJson = '';

  function encryptPayloadWithEnvelopeKey(plainObj: Record<string, any>): string | null {
    const secrets = loadSecrets();
    if (!secrets || secrets.envelopeKeyBuf.length !== 32 || !secrets.kdfSaltB64) return null;
    const iv = crypto.randomBytes(12);
    const cipher = crypto.createCipheriv('aes-256-gcm', secrets.envelopeKeyBuf, iv);
    const plainBytes = Buffer.from(JSON.stringify(plainObj), 'utf8');
    const ctWithTag = Buffer.concat([cipher.update(plainBytes), cipher.final(), cipher.getAuthTag()]);
    return JSON.stringify(
      {
        v: 1,
        alg: 'AES-256-GCM-PBKDF2-SHA256',
        iter: secrets.iter,
        kdfSaltB64: secrets.kdfSaltB64,
        ivB64: iv.toString('base64'),
        ctB64: ctWithTag.toString('base64'),
        updatedAt: Date.now(),
      },
      null,
      2
    );
  }

  function decryptIncomingWakePacket(envelopeStr: string): Record<string, any> | null {
    try {
      const secrets = loadSecrets();
      if (!secrets || secrets.envelopeKeyBuf.length !== 32) return null;
      const envObj = JSON.parse(envelopeStr);
      if (!envObj || typeof envObj.ivB64 !== 'string' || typeof envObj.ctB64 !== 'string') return null;
      const iv = Buffer.from(envObj.ivB64, 'base64');
      const ctWithTag = Buffer.from(envObj.ctB64, 'base64');
      if (iv.length !== 12 || ctWithTag.length <= 16) return null;
      const tag = ctWithTag.subarray(ctWithTag.length - 16);
      const ct = ctWithTag.subarray(0, ctWithTag.length - 16);
      const decipher = crypto.createDecipheriv('aes-256-gcm', secrets.envelopeKeyBuf, iv);
      decipher.setAuthTag(tag);
      const plain = Buffer.concat([decipher.update(ct), decipher.final()]).toString('utf8');
      return JSON.parse(plain);
    } catch {
      return null;
    }
  }

  async function putGitHubEncryptedFile(repoFilePath: string, contentUtf8: string) {
    const token = deps.getLocalGitHubToken();
    if (!token) return;
    try {
      const getUrl = `https://api.github.com/repos/${deps.githubOwner}/${deps.githubRepo}/contents/${repoFilePath}?ref=${deps.githubBranch}&t=${Date.now()}`;
      let sha: string | undefined;
      const getRes = await fetch(getUrl, {
        headers: {
          Accept: 'application/vnd.github+json',
          Authorization: `token ${token}`,
          'User-Agent': 'HuellasMaster-FlowPC',
        },
      });
      if (getRes.ok) {
        const info: any = await getRes.json();
        if (info && typeof info.sha === 'string') sha = info.sha;
      }
      await fetch(
        `https://api.github.com/repos/${deps.githubOwner}/${deps.githubRepo}/contents/${repoFilePath}`,
        {
          method: 'PUT',
          headers: {
            Accept: 'application/vnd.github+json',
            Authorization: `token ${token}`,
            'Content-Type': 'application/json',
            'User-Agent': 'HuellasMaster-FlowPC',
          },
          body: JSON.stringify({
            message: 'chore(flow-pc): update AES-256-GCM encrypted tunnel envelope',
            content: Buffer.from(contentUtf8, 'utf8').toString('base64'),
            branch: deps.githubBranch,
            ...(sha ? { sha } : {}),
          }),
        }
      );
    } catch (e: any) {
      console.warn('[FlowPC] GitHub encrypted envelope push warning:', e?.message || e);
    }
  }

  async function publishEncryptedTunnelEnvelope(pushToGitHub = true) {
    if (!activeTunnelUrl) return;
    const lanUrl = detectLanUrl(serverPort);
    const encJson = encryptPayloadWithEnvelopeKey({
      tunnelUrl: activeTunnelUrl,
      lanUrl,
      updatedAt: Date.now(),
      expiresAt: Date.now() + 24 * 3600 * 1000,
    });
    if (!encJson) return;
    lastEncryptedEnvelopeJson = encJson;
    try {
      fs.writeFileSync(tunnelEnvelopeDataFile, encJson, 'utf8');
      const docsDir = path.dirname(tunnelEnvelopeDocsFile);
      if (fs.existsSync(docsDir)) {
        fs.writeFileSync(tunnelEnvelopeDocsFile, encJson, 'utf8');
      }
    } catch {}

    const secrets = loadSecrets();
    if (secrets?.ntfyTopic) {
      fetch(`https://ntfy.sh/${secrets.ntfyTopic}_ack`, {
        method: 'POST',
        headers: { 'Content-Type': 'text/plain; charset=utf-8', Title: 'FlowPC-Ack' },
        body: encJson,
      }).catch(() => {});
    }

    if (pushToGitHub) {
      await putGitHubEncryptedFile('data/flow_pc_tunnel.enc.json', encJson);
      await putGitHubEncryptedFile('docs/data/flow_pc_tunnel.enc.json', encJson);
    }
  }

  function ensureCloudflaredRunning(forceRestart = false) {
    if (forceRestart && cloudflaredProc) {
      try {
        cloudflaredProc.kill('SIGTERM');
      } catch {}
      cloudflaredProc = null;
      activeTunnelUrl = '';
    }
    if (cloudflaredProc) return;

    const cfBin = resolveCloudflaredBin();
    try {
      const proc = spawn(
        cfBin,
        ['tunnel', '--no-autoupdate', '--protocol', 'http2', '--url', `http://127.0.0.1:${serverPort}`],
        {
          stdio: ['ignore', 'pipe', 'pipe'],
        }
      );
      cloudflaredProc = proc;
      const handleChunk = (chunk: Buffer) => {
        const text = chunk.toString('utf8');
        const m = text.match(/https:\/\/[a-z0-9-]+\.trycloudflare\.com/i);
        if (m && m[0] && m[0] !== activeTunnelUrl) {
          activeTunnelUrl = m[0];
          console.log(`[FlowPC] 5G Cloudflare Tunnel ready (encrypted sync): ${activeTunnelUrl}`);
          publishEncryptedTunnelEnvelope(true).catch(() => {});
        }
      };
      proc.stdout?.on('data', handleChunk);
      proc.stderr?.on('data', handleChunk);
      proc.on('close', () => {
        if (cloudflaredProc === proc) {
          cloudflaredProc = null;
          setTimeout(() => ensureCloudflaredRunning(false), 6000);
        }
      });
      proc.on('error', () => {
        if (cloudflaredProc === proc) cloudflaredProc = null;
      });
    } catch (e: any) {
      console.warn('[FlowPC] Could not spawn cloudflared:', e?.message || e);
    }
  }

  const cleanupCloudflared = () => {
    const p = cloudflaredProc;
    cloudflaredProc = null;
    if (p) {
      try {
        p.kill('SIGTERM');
      } catch {}
    }
  };
  process.once('exit', cleanupCloudflared);
  process.once('SIGTERM', () => {
    cleanupCloudflared();
    process.exit(0);
  });
  process.once('SIGINT', () => {
    cleanupCloudflared();
    process.exit(0);
  });

  // Private ntfy Wake-on-5G listener (anti-replay protected)
  const seenWakeNonces = new Set<string>();
  let wakeStreamAbort: AbortController | null = null;

  async function startPrivateWakeRelayListener() {
    const secrets = loadSecrets();
    if (!secrets?.ntfyTopic) return;
    if (wakeStreamAbort) {
      try {
        wakeStreamAbort.abort();
      } catch {}
    }
    const controller = new AbortController();
    wakeStreamAbort = controller;
    try {
      const res = await fetch(`https://ntfy.sh/${secrets.ntfyTopic}/json`, {
        signal: controller.signal,
        headers: { Accept: 'application/x-ndjson' },
      });
      if (!res.ok || !res.body) throw new Error(`HTTP ${res.status}`);
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buf = '';
      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        buf += decoder.decode(value, { stream: true });
        let nlIdx = buf.indexOf('\n');
        while (nlIdx >= 0) {
          const line = buf.slice(0, nlIdx).trim();
          buf = buf.slice(nlIdx + 1);
          nlIdx = buf.indexOf('\n');
          if (!line) continue;
          try {
            const evt = JSON.parse(line);
            if (evt.event === 'message' && typeof evt.message === 'string') {
              const cmdPayload = decryptIncomingWakePacket(evt.message);
              if (
                cmdPayload &&
                cmdPayload.cmd === 'WAKE_FLOW_PC' &&
                typeof cmdPayload.ts === 'number' &&
                typeof cmdPayload.nonce === 'string' &&
                Math.abs(Date.now() - cmdPayload.ts) < 120_000 &&
                !seenWakeNonces.has(cmdPayload.nonce)
              ) {
                seenWakeNonces.add(cmdPayload.nonce);
                if (seenWakeNonces.size > 500) {
                  const first = seenWakeNonces.values().next().value;
                  if (first) seenWakeNonces.delete(first);
                }
                console.log('[FlowPC] Authenticated 5G Wake command received! Waking container & tunnel...');
                ensureCloudflaredRunning(false);
                await startOrResumeContainer();
                await publishEncryptedTunnelEnvelope(false);
              }
            }
          } catch {}
        }
      }
    } catch {
      // Reconnect after backoff
    }
    if (wakeStreamAbort === controller) {
      setTimeout(() => startPrivateWakeRelayListener(), 6000);
    }
  }

  // ==========================================================================
  // STAGING WATCHER, SAFE ZIP EXTRACTOR, ROUTER & MAC PHOTOS.APP IMPORTER
  // ==========================================================================
  const stabilityMap = new Map<string, { size: number; mtimeMs: number; ticks: number }>();
  let isProcessingStaging = false;

  function hasValidZipEocd(filePath: string, totalSize: number): boolean {
    let fd: number | null = null;
    try {
      if (totalSize < 22) return false;
      fd = fs.openSync(filePath, 'r');
      const readLen = Math.min(totalSize, 65557);
      const buf = Buffer.alloc(readLen);
      fs.readSync(fd, buf, 0, readLen, totalSize - readLen);
      for (let i = buf.length - 22; i >= 0; i--) {
        if (buf[i] === 0x50 && buf[i + 1] === 0x4b && buf[i + 2] === 0x05 && buf[i + 3] === 0x06) {
          return true;
        }
      }
      return false;
    } catch {
      return false;
    } finally {
      if (fd !== null) {
        try {
          fs.closeSync(fd);
        } catch {}
      }
    }
  }

  function classifySubfolder(fileName: string, mode: FlowRoutingMode): string {
    if (mode !== 'auto') return mode;
    const base = path.basename(fileName).normalize('NFC');
    const ext = path.extname(base).toLowerCase();
    if (['.mp4', '.mov', '.webm', '.mkv'].includes(ext)) {
      return '05_Clips_Video';
    }
    if (/miniatura|thumb|portada|^logo_/i.test(base)) {
      return '03_Miniaturas';
    }
    if (/^@|^ref[_\-\s]|personaje|character|escenario|referencia/i.test(base)) {
      return '04_Referencias';
    }
    if (/^(?:0*\d+[_\-\s.]|clip[_\-\s.]*0*\d+|scene[_\-\s.]*0*\d+)/i.test(base)) {
      return '05_Clips_Video';
    }
    if (['.png', '.jpg', '.jpeg', '.webp'].includes(ext)) {
      return '04_Referencias';
    }
    return '05_Clips_Video';
  }

  function computeFileSha256(filePath: string): Promise<string> {
    return new Promise((resolve, reject) => {
      const hash = crypto.createHash('sha256');
      const stream = fs.createReadStream(filePath);
      stream.on('data', (d) => hash.update(d));
      stream.on('end', () => resolve(hash.digest('hex')));
      stream.on('error', reject);
    });
  }

  async function importIntoMacPhotosApp(
    targetFilePath: string,
    albumTitle: string,
    sha256Hex?: string
  ): Promise<{ ok: boolean; skippedDuplicate?: boolean; error?: string }> {
    const cleanAlbum = String(albumTitle || 'Huellas Master').normalize('NFC').trim() || 'Huellas Master';
    const hash = sha256Hex || (await computeFileSha256(targetFilePath).catch(() => ''));
    const ledgerKey = hash ? `${hash}::${cleanAlbum}` : '';
    if (ledgerKey && importedPhotoHashes.has(ledgerKey)) {
      return { ok: true, skippedDuplicate: true };
    }

    const appleScript = [
      'on run argv',
      '  set targetPosixPath to item 1 of argv',
      '  set targetAlbumName to item 2 of argv',
      '  set mediaFile to (POSIX file targetPosixPath) as alias',
      '  tell application "Photos"',
      '    if not (exists album named targetAlbumName) then',
      '      make new album named targetAlbumName',
      '    end if',
      '    set destAlbum to album named targetAlbumName',
      '    import {mediaFile} into destAlbum skip check duplicates false',
      '  end tell',
      '  return "OK"',
      'end run',
    ].join('\n');

    return new Promise((resolve) => {
      const proc = spawn('osascript', ['-', targetFilePath, cleanAlbum], {
        stdio: ['pipe', 'pipe', 'pipe'],
      });
      let stderr = '';
      const timer = setTimeout(() => {
        try {
          proc.kill('SIGKILL');
        } catch {}
        resolve({ ok: false, error: 'Timeout importando a la app Fotos de Mac.' });
      }, 35000);
      proc.stderr?.on('data', (d) => {
        stderr += String(d);
      });
      proc.on('close', (code) => {
        clearTimeout(timer);
        if (code === 0) {
          if (ledgerKey) {
            importedPhotoHashes.add(ledgerKey);
            savePhotosLedger();
          }
          resolve({ ok: true });
        } else {
          resolve({ ok: false, error: stderr.trim() || `osascript exited ${code}` });
        }
      });
      proc.on('error', (err) => {
        clearTimeout(timer);
        resolve({ ok: false, error: String(err.message || err) });
      });
      proc.stdin?.write(appleScript);
      proc.stdin?.end();
    });
  }

  async function routeSingleReadyFile(sourceFilePath: string, originalFileName: string) {
    const cleanOrigName = path
      .basename(originalFileName)
      .normalize('NFC')
      .replace(/[<>:"/\\|?*\x00-\x1f]/g, '_')
      .trim();
    if (!cleanOrigName) return;

    let rootDocFolder = deps.resolveLocalDocumentaryFolder(
      routing.targetFolderPath,
      routing.targetFolderName,
      routing.targetDocTitle
    );
    if (!rootDocFolder) {
      const fallbackSafeTitle = (routing.targetDocTitle || 'Flow_PC_Descargas')
        .normalize('NFC')
        .replace(/[/:\\]/g, ' - ')
        .trim();
      const icloudOk = await Promise.race([
        fs.promises
          .access(icloudVideosRoot)
          .then(() => true)
          .catch(() => false),
        new Promise<boolean>((r) => setTimeout(() => r(false), 600)),
      ]);
      rootDocFolder = icloudOk
        ? path.join(icloudVideosRoot, fallbackSafeTitle)
        : path.join(deps.dataDir, 'projects', fallbackSafeTitle);
    }
    deps.ensureDocumentarySubfolders(rootDocFolder);

    const subFolder = classifySubfolder(cleanOrigName, routing.routingMode);
    const destDir = path.join(rootDocFolder, subFolder);
    if (!fs.existsSync(destDir)) {
      fs.mkdirSync(destDir, { recursive: true });
    }

    const parsed = path.parse(cleanOrigName);
    let finalFileName = cleanOrigName;
    let counter = 2;
    while (fs.existsSync(path.join(destDir, finalFileName))) {
      finalFileName = `${parsed.name}_${counter}${parsed.ext}`;
      counter += 1;
    }

    const tempDest = path.join(destDir, `.incoming_${Date.now()}_${finalFileName}`);
    const finalDest = path.join(destDir, finalFileName);

    fs.copyFileSync(sourceFilePath, tempDest);
    const fd = fs.openSync(tempDest, 'r+');
    try {
      fs.fsyncSync(fd);
    } finally {
      fs.closeSync(fd);
    }
    fs.renameSync(tempDest, finalDest);
    try {
      fs.unlinkSync(sourceFilePath);
    } catch {}

    await execCmd('xattr', ['-c', finalDest], 3000).catch(() => {});
    await execCmd('chflags', ['nohidden', finalDest], 3000).catch(() => {});

    const stat = fs.statSync(finalDest);
    const sha256 = await computeFileSha256(finalDest).catch(() => '');
    const itemId = `fpc_${Date.now()}_${crypto.randomBytes(4).toString('hex')}`;

    let importedToMacPhotos = false;
    if (routing.autoImportMacPhotos) {
      const imp = await importIntoMacPhotosApp(finalDest, routing.targetDocTitle, sha256);
      importedToMacPhotos = imp.ok;
    }

    const record: FlowDownloadedItem = {
      id: itemId,
      fileName: finalFileName,
      finalPath: finalDest,
      subFolder,
      docTitle: routing.targetDocTitle || path.basename(rootDocFolder),
      sizeBytes: stat.size,
      mimeType: guessMimeType(finalFileName),
      sha256,
      createdAt: Date.now(),
      importedToMacPhotos,
    };

    recentDownloads = [record, ...recentDownloads].slice(0, 40);
    saveLocalState();
    console.log(`[FlowPC] Routed download -> ${finalDest}`);
  }

  async function extractAndRouteZipFile(zipPath: string) {
    const listRes = await execCmd('unzip', ['-Z1', zipPath], 10000);
    if (listRes.code !== 0) return;
    const entries = listRes.stdout
      .split(/\r?\n/)
      .map((l) => l.trim())
      .filter(Boolean);

    // Anti-Zip-Slip check
    for (const entry of entries) {
      if (entry.startsWith('/') || entry.includes('..') || entry.includes('\\')) {
        console.warn('[FlowPC] Blocked unsafe zip entry:', entry);
        try {
          fs.unlinkSync(zipPath);
        } catch {}
        return;
      }
    }

    const extractDir = path.join(stagingDir, `.extract_${Date.now()}_${crypto.randomBytes(3).toString('hex')}`);
    fs.mkdirSync(extractDir, { recursive: true });
    try {
      const unz = await execCmd('unzip', ['-q', '-o', zipPath, '-d', extractDir], 60000);
      if (unz.code === 0) {
        const walk = (dir: string) => {
          const out: string[] = [];
          for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
            if (ent.name.startsWith('.') || ent.name === '__MACOSX') continue;
            const full = path.join(dir, ent.name);
            if (ent.isDirectory()) out.push(...walk(full));
            else if (ent.isFile()) out.push(full);
          }
          return out;
        };
        const extractedFiles = walk(extractDir);
        for (const f of extractedFiles) {
          const ext = path.extname(f).toLowerCase();
          if (['.mp4', '.mov', '.webm', '.png', '.jpg', '.jpeg', '.webp'].includes(ext)) {
            await routeSingleReadyFile(f, path.basename(f));
          }
        }
      }
    } finally {
      try {
        fs.rmSync(extractDir, { recursive: true, force: true });
      } catch {}
      try {
        fs.unlinkSync(zipPath);
      } catch {}
    }
  }

  async function scanStagingFolderOnce() {
    if (isProcessingStaging) return;
    isProcessingStaging = true;
    try {
      if (!fs.existsSync(stagingDir)) return;
      const names = fs.readdirSync(stagingDir);
      const nameSet = new Set(names);
      const seenNow = new Set<string>();

      for (const name of names) {
        if (
          !name ||
          name.startsWith('.') ||
          /\.(crdownload|part|tmp|download)$/i.test(name) ||
          nameSet.has(`${name}.crdownload`) ||
          nameSet.has(`${name}.part`)
        ) {
          continue;
        }
        const full = path.join(stagingDir, name);
        let st: fs.Stats;
        try {
          st = fs.statSync(full);
        } catch {
          continue;
        }
        if (!st.isFile() || st.size <= 0) continue;

        seenNow.add(full);
        const prev = stabilityMap.get(full);
        if (prev && prev.size === st.size && prev.mtimeMs === st.mtimeMs) {
          prev.ticks += 1;
        } else {
          stabilityMap.set(full, { size: st.size, mtimeMs: st.mtimeMs, ticks: 1 });
          continue;
        }

        if (prev.ticks >= 3) {
          stabilityMap.delete(full);
          if (path.extname(name).toLowerCase() === '.zip') {
            if (!hasValidZipEocd(full, st.size)) {
              // Still flushing ZIP trailer
              stabilityMap.set(full, { size: st.size, mtimeMs: st.mtimeMs, ticks: 2 });
              continue;
            }
            await extractAndRouteZipFile(full);
          } else {
            await routeSingleReadyFile(full, name);
          }
        }
      }

      for (const k of Array.from(stabilityMap.keys())) {
        if (!seenNow.has(k)) stabilityMap.delete(k);
      }
    } catch (e: any) {
      console.warn('[FlowPC] Staging scanner warning:', e?.message || e);
    } finally {
      isProcessingStaging = false;
    }
  }

  setInterval(() => {
    scanStagingFolderOnce().catch(() => {});
  }, 850);

  // ==========================================================================
  // KASMVNC CAPABILITY URL REVERSE PROXY (HTTP + WEBSOCKET UPGRADE)
  // ==========================================================================
  function earlyMiddleware(req: Request, res: Response, next: NextFunction) {
    if (!req.path.startsWith('/flow-cap/')) {
      next();
      return;
    }
    const match = req.originalUrl.match(/^\/flow-cap\/([A-Za-z0-9._-]+)(\/.*)?$/);
    if (!match) {
      res.status(403).send('Invalid Flow PC capability URL.');
      return;
    }
    const capToken = match[1];
    const verified = verifyToken(capToken, ['vnc', 'session']);
    if (!verified) {
      res.status(403).send('Flow PC session expired. Reload Flow PC inside Huellas Master.');
      return;
    }

    let upstreamPath = match[2] || '';
    if (upstreamPath === '' || upstreamPath === '/') {
      res.redirect(
        302,
        `/flow-cap/${capToken}/vnc/index.html?autoconnect=1&resize=scale&reconnect=1&reconnect_delay=1500&clipboard_up=false&clipboard_down=false&clipboard_seamless=false&show_control_bar=true&path=flow-cap/${capToken}/websockify`
      );
      return;
    }

    const fwdHeaders: Record<string, string | string[]> = {};
    for (const [k, v] of Object.entries(req.headers)) {
      if (!v) continue;
      if (/^(host|origin|cookie|referer|authorization)$/i.test(k)) continue;
      fwdHeaders[k] = v;
    }
    fwdHeaders['host'] = '127.0.0.1:3000';
    fwdHeaders['origin'] = 'http://127.0.0.1:3000';

    const proxyReq = http.request(
      {
        host: '127.0.0.1',
        port: 3090,
        method: req.method,
        path: upstreamPath,
        headers: fwdHeaders,
      },
      (proxyRes) => {
        const outHeaders: Record<string, string | string[]> = {};
        for (const [hk, hv] of Object.entries(proxyRes.headers)) {
          if (!hv) continue;
          if (
            /^(x-frame-options|content-security-policy|set-cookie|cross-origin-embedder-policy|cross-origin-opener-policy|cross-origin-resource-policy)$/i.test(
              hk
            )
          ) {
            continue;
          }
          outHeaders[hk] = hv;
        }
        outHeaders['Referrer-Policy'] = 'no-referrer';
        outHeaders['X-Robots-Tag'] = 'noindex, nofollow';
        outHeaders['Cross-Origin-Resource-Policy'] = 'cross-origin';
        outHeaders['Content-Security-Policy'] = 'frame-ancestors *';
        if (/\.(js|wasm|css|woff2?|png|svg|ico)(\?|$)/i.test(upstreamPath)) {
          outHeaders['Cache-Control'] = 'private, max-age=3600';
        } else {
          outHeaders['Cache-Control'] = 'no-store';
        }
        res.writeHead(proxyRes.statusCode || 200, outHeaders);
        proxyRes.pipe(res);
      }
    );

    proxyReq.on('error', () => {
      if (!res.headersSent) {
        res.status(200).setHeader('Content-Type', 'text/html; charset=utf-8').send(`<!doctype html>
<html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<meta http-equiv="refresh" content="2">
<style>body{margin:0;height:100vh;display:flex;align-items:center;justify-content:center;background:#0b0a09;color:#fcd34d;font-family:-apple-system,BlinkMacSystemFont,sans-serif;text-align:center;padding:24px}</style>
</head><body><div><div style="font-size:28px;margin-bottom:10px">🖥️</div><div style="font-weight:700;font-size:14px">Iniciando escritorio aislado de Flow PC...</div><div style="color:#94a3b8;font-size:12px;margin-top:6px">Conectando automáticamente en unos segundos</div></div></body></html>`);
      }
    });

    req.pipe(proxyReq);
  }

  function attachServer(httpServer: http.Server) {
    httpServer.on('upgrade', (req, clientSocket, head) => {
      const rawUrl = req.url || '';
      if (!rawUrl.startsWith('/flow-cap/')) {
        // Leave non-FlowPC upgrades (e.g. Vite HMR) completely untouched
        return;
      }
      const match = rawUrl.match(/^\/flow-cap\/([A-Za-z0-9._-]+)(\/.*)?$/);
      if (!match || !verifyToken(match[1], ['vnc', 'session'])) {
        clientSocket.write('HTTP/1.1 403 Forbidden\r\nConnection: close\r\n\r\n');
        clientSocket.destroy();
        return;
      }

      const rawRest = match[2] || '/websockify';
      const upstreamPath =
        rawRest === '/' || rawRest.startsWith('/vnc/websockify')
          ? rawRest.replace(/^\/vnc\/websockify/, '/websockify') || '/websockify'
          : rawRest;

      const upstreamSocket = net.connect(3090, '127.0.0.1', () => {
        (clientSocket as net.Socket).setNoDelay?.(true);
        upstreamSocket.setNoDelay(true);
        (clientSocket as net.Socket).setKeepAlive?.(true, 15000);
        upstreamSocket.setKeepAlive(true, 15000);

        const headerLines: string[] = [
          `GET ${upstreamPath} HTTP/1.1`,
          'Host: 127.0.0.1:3000',
          'Origin: http://127.0.0.1:3000',
        ];
        for (let i = 0; i < req.rawHeaders.length; i += 2) {
          const k = req.rawHeaders[i];
          const v = req.rawHeaders[i + 1];
          if (/^(host|origin|cookie|referer|authorization)$/i.test(k)) continue;
          headerLines.push(`${k}: ${v}`);
        }
        upstreamSocket.write(headerLines.join('\r\n') + '\r\n\r\n');
        if (head && head.length > 0) {
          upstreamSocket.write(head);
        }
        upstreamSocket.pipe(clientSocket);
        clientSocket.pipe(upstreamSocket);
      });

      const cleanup = () => {
        if (!clientSocket.destroyed) clientSocket.destroy();
        if (!upstreamSocket.destroyed) upstreamSocket.destroy();
      };
      clientSocket.on('error', cleanup);
      upstreamSocket.on('error', cleanup);
      clientSocket.on('close', cleanup);
      upstreamSocket.on('close', cleanup);
    });

    // Boot background 5G tunnel + private ntfy wake listener
    ensureCloudflaredRunning(false);
    startPrivateWakeRelayListener().catch(() => {});
  }

  async function buildStatusPayload() {
    const containerState = await getContainerState();
    const vncReady = containerState === 'running' ? await probeLocalVncReady() : false;
    const capToken = issueToken('vnc', 6 * 3600 * 1000);
    const vncEntryPath = `/flow-cap/${capToken}/vnc/index.html?autoconnect=1&resize=scale&reconnect=1&reconnect_delay=1500&clipboard_up=false&clipboard_down=false&clipboard_seamless=false&show_control_bar=true&path=flow-cap/${capToken}/websockify`;
    const resolvedRootFolder = deps.resolveLocalDocumentaryFolder(
      routing.targetFolderPath,
      routing.targetFolderName,
      routing.targetDocTitle
    );

    return {
      ok: true,
      containerState: isStartingContainer ? 'starting' : containerState,
      vncReady,
      resolution: currentResolution,
      capToken,
      vncEntryPath,
      tunnelUrl: activeTunnelUrl,
      lanUrl: detectLanUrl(serverPort),
      routing: {
        ...routing,
        resolvedRootFolder,
      },
      recentDownloads: recentDownloads.map((item) => ({
        id: item.id,
        fileName: item.fileName,
        subFolder: item.subFolder,
        docTitle: item.docTitle,
        sizeBytes: item.sizeBytes,
        mimeType: item.mimeType,
        createdAt: item.createdAt,
        importedToMacPhotos: item.importedToMacPhotos,
        existsOnDisk: fs.existsSync(item.finalPath),
        downloadToken: issueToken('file', 6 * 3600 * 1000, { fid: item.id }),
      })),
    };
  }

  function registerRoutes(app: Express) {
    app.get('/api/flow-pc/ping', (_req, res) => {
      res.json({ ok: true, service: 'huellas-flow-pc', ts: Date.now() });
    });

    app.get('/api/flow-pc/tunnel-envelope', (_req, res) => {
      try {
        if (lastEncryptedEnvelopeJson) {
          res.type('application/json').send(lastEncryptedEnvelopeJson);
          return;
        }
        if (fs.existsSync(tunnelEnvelopeDataFile)) {
          res.type('application/json').send(fs.readFileSync(tunnelEnvelopeDataFile, 'utf8'));
          return;
        }
        res.status(404).json({ ok: false, error: 'Envelope not generated yet.' });
      } catch (e: any) {
        res.status(500).json({ ok: false, error: e?.message || 'Error reading tunnel envelope.' });
      }
    });

    app.post('/api/flow-pc/auth', (req, res) => {
      const ip = String(req.ip || req.socket.remoteAddress || 'unknown');
      const now = Date.now();
      const rec = authFailuresByIp.get(ip);
      if (rec && rec.resetAt > now && rec.count >= 6) {
        const waitSec = Math.ceil((rec.resetAt - now) / 1000);
        res.status(429).json({
          ok: false,
          error: `Demasiados intentos fallidos. Espera ${waitSec}s antes de reintentar.`,
        });
        return;
      }

      const secrets = loadSecrets();
      if (!secrets) {
        res.status(500).json({ ok: false, error: 'FLOW_PC no está configurado en .env de la Mac.' });
        return;
      }

      const rawPassword = String(req.body?.password ?? '');
      const pwBuf = normalizeFlowSecretUtf8(rawPassword);

      crypto.pbkdf2(pwBuf, secrets.saltBuf, secrets.iter, 32, 'sha256', async (err, derivedKey) => {
        if (err || derivedKey.length !== secrets.hashBuf.length || !crypto.timingSafeEqual(derivedKey, secrets.hashBuf)) {
          const prev = authFailuresByIp.get(ip);
          const nextCount = prev && prev.resetAt > now ? prev.count + 1 : 1;
          authFailuresByIp.set(ip, { count: nextCount, resetAt: now + 5 * 60 * 1000 });
          res.status(401).json({ ok: false, error: 'Contraseña incorrecta.' });
          return;
        }

        authFailuresByIp.delete(ip);
        const sessionToken = issueToken('session', 30 * 24 * 3600 * 1000);
        const statusPayload = await buildStatusPayload();
        res.json({
          ...statusPayload,
          sessionToken,
        });
      });
    });

    app.get('/api/flow-pc/status', requireSessionAuth, async (_req, res) => {
      try {
        res.json(await buildStatusPayload());
      } catch (e: any) {
        res.status(500).json({ ok: false, error: e?.message || 'Error obteniendo estado.' });
      }
    });

    app.post('/api/flow-pc/start', requireSessionAuth, async (_req, res) => {
      const startRes = await startOrResumeContainer();
      const status = await buildStatusPayload();
      res.status(startRes.ok ? 200 : 500).json({
        ...status,
        ok: startRes.ok,
        error: startRes.error,
      });
    });

    app.post('/api/flow-pc/suspend', requireSessionAuth, async (_req, res) => {
      const susp = await suspendContainer();
      const status = await buildStatusPayload();
      res.status(susp.ok ? 200 : 500).json({
        ...status,
        ok: susp.ok,
        error: susp.error,
      });
    });

    app.post('/api/flow-pc/stop', requireSessionAuth, async (_req, res) => {
      const stp = await stopContainerGracefully();
      const status = await buildStatusPayload();
      res.status(stp.ok ? 200 : 500).json({
        ...status,
        ok: stp.ok,
        error: stp.error,
      });
    });

    app.post('/api/flow-pc/resolution', requireSessionAuth, async (req, res) => {
      const targetRes = String(req.body?.resolution || '').trim();
      if (!ALLOWED_RESOLUTIONS.has(targetRes)) {
        res.status(400).json({ ok: false, error: 'Resolución no soportada.' });
        return;
      }
      currentResolution = targetRes;
      saveLocalState();

      const dockerBin = resolveDockerBin();
      const st = await getContainerState();
      if (st === 'running') {
        await execCmd(
          dockerBin,
          [
            'exec',
            '-u',
            'abc',
            'huellas-flow-pc',
            'sh',
            '-c',
            `export DISPLAY=:1; xrandr -s ${targetRes} 2>/dev/null || true; sleep 0.15; WID=$(xdotool search --onlyvisible --class "google-chrome" | tail -n 1); if [ -n "$WID" ]; then xdotool windowsize "$WID" 100% 100% 2>/dev/null || true; wmctrl -i -r "$WID" -b add,maximized_vert,maximized_horz 2>/dev/null || true; fi`,
          ],
          8000
        );
      }
      res.json(await buildStatusPayload());
    });

    app.post('/api/flow-pc/paste-prompt', requireSessionAuth, async (req, res) => {
      const rawText = String(req.body?.text ?? '');
      const mode = req.body?.mode === 'clipboard_only' ? 'clipboard_only' : 'paste';
      const autoEnter = Boolean(req.body?.autoEnter);

      if (!rawText.trim()) {
        res.status(400).json({ ok: false, error: 'El prompt está vacío.' });
        return;
      }

      const st = await getContainerState();
      if (st === 'paused') {
        await startOrResumeContainer();
      } else if (st !== 'running') {
        res.status(409).json({ ok: false, error: 'Flow PC está apagado. Enciéndelo primero.' });
        return;
      }

      const dockerBin = resolveDockerBin();
      const nfcBytes = Buffer.from(rawText.normalize('NFC'), 'utf8');

      // 1. Write UTF-8 prompt bytes cleanly via stdin into container /tmp/.huellas_prompt.txt (0% shell escaping risk)
      const writeRes = await spawnWithStdin(
        dockerBin,
        [
          'exec',
          '-i',
          '-u',
          'abc',
          'huellas-flow-pc',
          'sh',
          '-c',
          'cat > /tmp/.huellas_prompt.txt && chmod 600 /tmp/.huellas_prompt.txt',
        ],
        nfcBytes,
        8000
      );
      if (writeRes.code !== 0) {
        res.status(500).json({ ok: false, error: `Error copiando prompt al contenedor: ${writeRes.stderr}` });
        return;
      }

      // 2. Launch persistent X11 CLIPBOARD + PRIMARY owner in detached mode (-d) so containerd never reaps xclip
      const clipDetachRes = await execCmd(
        dockerBin,
        [
          'exec',
          '-d',
          '-u',
          'abc',
          '-e',
          'DISPLAY=:1',
          '-e',
          'LANG=C.UTF-8',
          '-e',
          'LC_ALL=C.UTF-8',
          'huellas-flow-pc',
          'sh',
          '-c',
          'for auth in /config/.Xauthority /home/abc/.Xauthority; do [ -f "$auth" ] && export XAUTHORITY="$auth" && break; done; pkill -u abc -x xclip 2>/dev/null || true; pkill -u abc -x xsel 2>/dev/null || true; xclip -selection clipboard -i /tmp/.huellas_prompt.txt >/dev/null 2>&1; xclip -selection primary -i /tmp/.huellas_prompt.txt >/dev/null 2>&1; sleep 0.2; rm -f /tmp/.huellas_prompt.txt',
        ],
        6000
      );
      if (clipDetachRes.code !== 0) {
        res.status(500).json({ ok: false, error: clipDetachRes.stderr || 'Error iniciando xclip en X11.' });
        return;
      }

      // Give xclip 240ms to register X11 selection ownership before reading or sending Ctrl+V
      await new Promise((r) => setTimeout(r, 240));

      if (mode === 'clipboard_only') {
        res.json({ ok: true, mode, autoEnter: false });
        return;
      }

      const delayMs = 210 + Math.floor(Math.random() * 160);
      const x11Script = `
        export DISPLAY=:1
        export LANG=C.UTF-8
        export LC_ALL=C.UTF-8
        for auth in /config/.Xauthority /home/abc/.Xauthority; do
          [ -f "$auth" ] && export XAUTHORITY="$auth" && break
        done

        ACTIVE_WIN=$(xdotool getactivewindow 2>/dev/null || true)
        ACTIVE_NAME=$(xdotool getwindowname "$ACTIVE_WIN" 2>/dev/null || true)
        case "$ACTIVE_NAME" in
          *"Open Files"*|*"Abrir archivos"*|*"Save File"*)
            echo "FILE_DIALOG_OPEN"
            exit 2
            ;;
        esac

        CHROME_WIN=$(xdotool search --onlyvisible --class "google-chrome" | tail -n 1)
        if [ -n "$CHROME_WIN" ] && [ "$ACTIVE_WIN" != "$CHROME_WIN" ]; then
          xdotool windowactivate --sync "$CHROME_WIN" 2>/dev/null || true
          sleep 0.08
        fi

        xdotool keyup Shift_L Shift_R Control_L Control_R Alt_L Alt_R Super_L 2>/dev/null || true
        sleep 0.08
        xdotool key --clearmodifiers ctrl+v
        ${autoEnter ? `sleep ${(delayMs / 1000).toFixed(3)}; xdotool key --clearmodifiers Return` : ''}
        echo "PASTED_OK"
      `;

      const pasteRes = await execCmd(
        dockerBin,
        ['exec', '-u', 'abc', 'huellas-flow-pc', 'sh', '-c', x11Script],
        10000
      );

      if (pasteRes.code === 2 || pasteRes.stdout.includes('FILE_DIALOG_OPEN')) {
        res.json({
          ok: true,
          clipboardOnly: true,
          warning: 'Hay un selector de archivos abierto en Chrome; el texto quedó copiado en el portapapeles.',
        });
        return;
      }
      if (pasteRes.code !== 0) {
        res.status(500).json({ ok: false, error: pasteRes.stderr || 'Error pegando en X11.' });
        return;
      }

      res.json({ ok: true, mode, autoEnter });
    });

    app.post('/api/flow-pc/send-key', requireSessionAuth, async (req, res) => {
      const reqKey = String(req.body?.key || '').trim();
      const mapped = ALLOWED_KEYS[reqKey];
      if (!mapped) {
        res.status(400).json({ ok: false, error: 'Tecla no permitida.' });
        return;
      }
      const dockerBin = resolveDockerBin();
      const kRes = await execCmd(
        dockerBin,
        [
          'exec',
          '-u',
          'abc',
          'huellas-flow-pc',
          'sh',
          '-c',
          `export DISPLAY=:1; xdotool keyup Shift_L Shift_R Control_L Control_R Alt_L Alt_R Super_L 2>/dev/null || true; xdotool key --clearmodifiers ${mapped}`,
        ],
        5000
      );
      res.json({ ok: kRes.code === 0, error: kRes.code === 0 ? undefined : kRes.stderr });
    });

    app.post('/api/flow-pc/routing', requireSessionAuth, async (req, res) => {
      const b = req.body || {};
      if (typeof b.targetDocId === 'string') routing.targetDocId = b.targetDocId.trim();
      if (typeof b.targetDocTitle === 'string') routing.targetDocTitle = b.targetDocTitle.normalize('NFC').trim();
      if (typeof b.targetFolderPath === 'string') routing.targetFolderPath = b.targetFolderPath.trim();
      if (typeof b.targetFolderName === 'string') routing.targetFolderName = b.targetFolderName.trim();
      if (
        typeof b.routingMode === 'string' &&
        ['auto', '05_Clips_Video', '04_Referencias', '03_Miniaturas'].includes(b.routingMode)
      ) {
        routing.routingMode = b.routingMode as FlowRoutingMode;
      }
      if (typeof b.autoImportMacPhotos === 'boolean') {
        routing.autoImportMacPhotos = b.autoImportMacPhotos;
      }
      saveLocalState();
      materializeIcloudReferencesInBackground();
      res.json(await buildStatusPayload());
    });

    app.post('/api/flow-pc/import-mac-photos', requireSessionAuth, async (req, res) => {
      const id = String(req.body?.id || '').trim();
      const item = recentDownloads.find((it) => it.id === id);
      if (!item || !fs.existsSync(item.finalPath)) {
        res.status(404).json({ ok: false, error: 'El archivo ya no se encuentra en la ruta local.' });
        return;
      }
      const imp = await importIntoMacPhotosApp(item.finalPath, item.docTitle, item.sha256);
      if (imp.ok) {
        item.importedToMacPhotos = true;
        saveLocalState();
      }
      res.status(imp.ok ? 200 : 500).json({
        ok: imp.ok,
        skippedDuplicate: imp.skippedDuplicate,
        error: imp.error,
      });
    });

    app.post('/api/flow-pc/refresh-tunnel', requireSessionAuth, async (_req, res) => {
      ensureCloudflaredRunning(true);
      for (let i = 0; i < 16; i++) {
        await new Promise((r) => setTimeout(r, 500));
        if (activeTunnelUrl) break;
      }
      await publishEncryptedTunnelEnvelope(true);
      res.json(await buildStatusPayload());
    });

    app.get('/api/flow-pc/download-file/:id', (req, res) => {
      const itemId = String(req.params.id || '').trim();
      const tok = extractBearerToken(req);
      const verified = verifyToken(tok, ['session', 'file']);
      if (!verified || (verified.s === 'file' && verified.fid !== itemId)) {
        res.status(401).json({ ok: false, error: 'Token inválido para descargar archivo.' });
        return;
      }

      const item = recentDownloads.find((it) => it.id === itemId);
      if (!item || !fs.existsSync(item.finalPath)) {
        res.status(404).json({ ok: false, error: 'Archivo no encontrado.' });
        return;
      }

      const stat = fs.statSync(item.finalPath);
      const forceAttachment = req.query.disposition === 'attachment';
      const safeAsciiName = item.fileName.replace(/[^\x20-\x7E]/g, '_').replace(/"/g, '');
      const encodedName = encodeURIComponent(item.fileName);

      res.setHeader('Content-Type', forceAttachment ? 'application/octet-stream' : item.mimeType);
      res.setHeader(
        'Content-Disposition',
        `${forceAttachment ? 'attachment' : 'inline'}; filename="${safeAsciiName}"; filename*=UTF-8''${encodedName}`
      );
      res.setHeader('Accept-Ranges', 'bytes');

      const range = req.headers.range;
      if (range && !forceAttachment) {
        const m = /^bytes=(\d*)-(\d*)$/.exec(range);
        if (m) {
          const start = m[1] ? parseInt(m[1], 10) : 0;
          const end = m[2] ? parseInt(m[2], 10) : stat.size - 1;
          if (start >= 0 && start <= end && end < stat.size) {
            res.status(206);
            res.setHeader('Content-Range', `bytes ${start}-${end}/${stat.size}`);
            res.setHeader('Content-Length', String(end - start + 1));
            fs.createReadStream(item.finalPath, { start, end }).pipe(res);
            return;
          }
        }
      }

      res.setHeader('Content-Length', String(stat.size));
      fs.createReadStream(item.finalPath).pipe(res);
    });
  }

  return {
    earlyMiddleware,
    registerRoutes,
    attachServer,
  };
}
