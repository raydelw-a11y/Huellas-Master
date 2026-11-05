var __create = Object.create;
var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __getProtoOf = Object.getPrototypeOf;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __copyProps = (to, from, except, desc) => {
  if (from && typeof from === "object" || typeof from === "function") {
    for (let key of __getOwnPropNames(from))
      if (!__hasOwnProp.call(to, key) && key !== except)
        __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
  }
  return to;
};
var __toESM = (mod, isNodeMode, target) => (target = mod != null ? __create(__getProtoOf(mod)) : {}, __copyProps(
  // If the importer is in node compatibility mode or this is not an ESM
  // file that has been converted to a CommonJS file using a Babel-
  // compatible transform (i.e. "__esModule" has not been set), then set
  // "default" to the CommonJS "module.exports" for node compatibility.
  isNodeMode || !mod || !mod.__esModule ? __defProp(target, "default", { value: mod, enumerable: true }) : target,
  mod
));

// server.ts
var import_express = __toESM(require("express"), 1);
var import_path = __toESM(require("path"), 1);
var import_fs = __toESM(require("fs"), 1);
var import_os = __toESM(require("os"), 1);
var import_child_process = require("child_process");
var import_multer = __toESM(require("multer"), 1);
var import_dotenv = __toESM(require("dotenv"), 1);
var import_cors = __toESM(require("cors"), 1);
var import_genai = require("@google/genai");
var import_speech = __toESM(require("@google-cloud/speech"), 1);
var import_text_to_speech = __toESM(require("@google-cloud/text-to-speech"), 1);
var import_vite = require("vite");
var import_ffmpeg_static = __toESM(require("ffmpeg-static"), 1);
import_dotenv.default.config();
var SIBLING_VOXFLOW_DIR = import_path.default.resolve(process.cwd(), "..", "VoxFlow");
var SIBLING_EXTRACTOR_DIR = import_path.default.resolve(process.cwd(), "..", "Narration-Timeline-Extractor");
function loadSiblingEnv(envPath) {
  try {
    if (import_fs.default.existsSync(envPath)) {
      const parsed = import_dotenv.default.parse(import_fs.default.readFileSync(envPath, "utf8"));
      for (const [k, v] of Object.entries(parsed)) {
        if (!process.env[k] && v) {
          process.env[k] = v;
        }
      }
    }
  } catch (e) {
    console.warn("[Init] Warning reading sibling env:", envPath);
  }
}
loadSiblingEnv(import_path.default.join(SIBLING_VOXFLOW_DIR, ".env"));
loadSiblingEnv(import_path.default.join(SIBLING_EXTRACTOR_DIR, ".env"));
process.on("uncaughtException", (err) => {
  console.error("[Huellas Master Server] Uncaught Exception:", err);
});
process.on("unhandledRejection", (reason) => {
  console.error("[Huellas Master Server] Unhandled Rejection:", reason);
});
var app = (0, import_express.default)();
var PORT = process.env.PORT ? parseInt(process.env.PORT, 10) : 4200;
app.use((req, res, next) => {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, PUT, DELETE, OPTIONS");
  res.setHeader(
    "Access-Control-Allow-Headers",
    "Content-Type, Authorization, Range, Access-Control-Request-Private-Network"
  );
  res.setHeader(
    "Access-Control-Expose-Headers",
    "Content-Range, Accept-Ranges, Content-Length"
  );
  res.setHeader("Access-Control-Allow-Private-Network", "true");
  res.setHeader("Cross-Origin-Resource-Policy", "cross-origin");
  if (req.method === "OPTIONS") {
    res.sendStatus(204);
    return;
  }
  next();
});
app.use((0, import_cors.default)({ origin: "*", optionsSuccessStatus: 200 }));
app.use(import_express.default.json({ limit: "200mb" }));
app.use(import_express.default.urlencoded({ limit: "200mb", extended: true }));
var DATA_DIR = import_path.default.join(process.cwd(), "data");
var TTS_DIR = import_path.default.join(DATA_DIR, "tts-files");
var ASSETS_DIR = import_path.default.join(DATA_DIR, "assets");
var CHUNK_DIR = import_path.default.join(import_os.default.tmpdir(), "huellas-master-chunks");
var DOCS_FILE = import_path.default.join(DATA_DIR, "documentaries.json");
var CONFIG_FILE = import_path.default.join(DATA_DIR, "config.json");
var CUSTOM_VOICES_FILE = import_path.default.join(DATA_DIR, "custom_voices.json");
for (const dir of [DATA_DIR, TTS_DIR, ASSETS_DIR, CHUNK_DIR]) {
  if (!import_fs.default.existsSync(dir)) {
    import_fs.default.mkdirSync(dir, { recursive: true });
  }
}
try {
  const voxConfig = import_path.default.join(SIBLING_VOXFLOW_DIR, "data", "config.json");
  if (!import_fs.default.existsSync(CONFIG_FILE) && import_fs.default.existsSync(voxConfig)) {
    import_fs.default.copyFileSync(voxConfig, CONFIG_FILE);
  }
  const voxVoices = import_path.default.join(SIBLING_VOXFLOW_DIR, "data", "custom_voices.json");
  if (!import_fs.default.existsSync(CUSTOM_VOICES_FILE) && import_fs.default.existsSync(voxVoices)) {
    import_fs.default.copyFileSync(voxVoices, CUSTOM_VOICES_FILE);
  }
} catch (e) {
  console.warn("[Init] Could not seed initial config from VoxFlow:", e);
}
app.use(
  "/tts-files",
  (req, res, next) => {
    if (req.path.toLowerCase().endsWith(".wav")) {
      const wavPath = import_path.default.join(TTS_DIR, req.path);
      const mp3Path = wavPath.replace(/\.wav$/i, ".mp3");
      if (!import_fs.default.existsSync(wavPath) && import_fs.default.existsSync(mp3Path)) {
        res.sendFile(mp3Path);
        return;
      }
    }
    next();
  },
  import_express.default.static(TTS_DIR)
);
app.use("/assets", import_express.default.static(ASSETS_DIR));
var ffmpegAvailable = !!import_ffmpeg_static.default;
var ffprobeAvailable = false;
(0, import_child_process.exec)(`"${import_ffmpeg_static.default}" -version`, (err) => {
  if (!err) ffmpegAvailable = true;
});
(0, import_child_process.exec)("ffprobe -version", (err) => {
  if (!err) ffprobeAvailable = true;
});
function getFfmpegPath() {
  if (import_ffmpeg_static.default && import_fs.default.existsSync(import_ffmpeg_static.default)) return import_ffmpeg_static.default;
  return "ffmpeg";
}
function getMaskedKey(key) {
  if (!key || key.length < 8) return "";
  return `${key.slice(0, 6)}\u2022\u2022\u2022\u2022\u2022\u2022\u2022\u2022\u2022\u2022\u2022\u2022\u2022\u2022\u2022\u2022\u2022\u2022\u2022\u2022\u2022\u2022\u2022\u2022\u2022\u2022${key.slice(-4)}`;
}
function getSavedGeminiKey() {
  try {
    if (import_fs.default.existsSync(CONFIG_FILE)) {
      const cfg = JSON.parse(import_fs.default.readFileSync(CONFIG_FILE, "utf8"));
      if (cfg.geminiApiKey && typeof cfg.geminiApiKey === "string" && !cfg.geminiApiKey.startsWith("AQ.")) {
        return cfg.geminiApiKey.trim();
      }
    }
  } catch {
  }
  const candidates = [
    process.env.GEMINI_API_KEY,
    process.env.GCP_API_KEY,
    process.env.GOOGLE_CLOUD_API_KEY,
    process.env.API_KEY
  ];
  for (const c of candidates) {
    if (c && c.trim() && !c.trim().startsWith("AQ.")) {
      return c.trim();
    }
  }
  return "";
}
function saveGeminiKey(key) {
  const cleanKey = key.trim();
  process.env.GEMINI_API_KEY = cleanKey;
  let cfg = {};
  if (import_fs.default.existsSync(CONFIG_FILE)) {
    try {
      cfg = JSON.parse(import_fs.default.readFileSync(CONFIG_FILE, "utf8"));
    } catch {
    }
  }
  cfg.geminiApiKey = cleanKey;
  import_fs.default.writeFileSync(CONFIG_FILE, JSON.stringify(cfg, null, 2), "utf8");
}
function getGeminiClient() {
  const key = getSavedGeminiKey();
  if (!key) return null;
  try {
    return new import_genai.GoogleGenAI({
      apiKey: key,
      httpOptions: { headers: { "User-Agent": "aistudio-build" } }
    });
  } catch (e) {
    console.error("Error creating GoogleGenAI client:", e);
    return null;
  }
}
app.get("/api/status", (req, res) => {
  const activeKey = getSavedGeminiKey();
  const hasGeminiKey = !!activeKey;
  const maskedKey = hasGeminiKey ? getMaskedKey(activeKey) : "";
  res.json({
    hasGeminiKey,
    maskedKey,
    gcsBucket: null,
    storageMode: "local",
    authMethod: hasGeminiKey ? `Activa (${maskedKey})` : null,
    hasElevenLabsKey: !!process.env.ELEVENLABS_API_KEY,
    hasGoogleTts: true,
    ffmpegAvailable
  });
});
app.get("/api/health", (req, res) => {
  res.json({
    status: "ok",
    ffmpeg_available: ffmpegAvailable,
    ffprobe_available: ffprobeAvailable,
    model_available: !!(getSavedGeminiKey() || process.env.GOOGLE_APPLICATION_CREDENTIALS_JSON)
  });
});
app.post("/api/settings/gemini-key", async (req, res) => {
  try {
    const { key } = req.body;
    if (!key || typeof key !== "string" || !key.trim()) {
      res.status(400).json({ error: "La clave API no puede estar vac\xEDa." });
      return;
    }
    const cleanKey = key.trim();
    saveGeminiKey(cleanKey);
    res.json({
      success: true,
      maskedKey: getMaskedKey(cleanKey),
      message: "\xA1Gemini API Key guardada y activada en Huellas Master!"
    });
  } catch (err) {
    res.status(400).json({ error: err.message || "Error al guardar la clave." });
  }
});
var DEFAULT_OPERATIONAL_HEADER_SERVER = `Act\xFAa como un historiador, director de cine, y periodista profesional.
Cambia los nombres de los clips a las primeras 6 palabras literales del prompt prove\xEDdo pegado y enviado que incluyen la numeraci\xF3n.
Usa Veo 3.1 - Lite [Lower Priority] para videos y nano banana 2.1 para im\xE1genes iniciales de cada clip.
Crea las im\xE1genes primero y luego los clips usando cada imagen como fotograma inicial.
Usa las im\xE1genes de referencia de personas y lugares para generar las im\xE1genes iniciales y los clips para mantener fidelidad visual.
No hagas cambios de shot nunca en ningun clip (excepto en aquel clip espec\xEDfico donde el prompt indique expresamente hacer dos shots de 5 segundos cada uno porque la voz narrativa cambi\xF3 de escena) y aseg\xFArate de que los clips de video no hagan desapariciones ni transformaciones, la imagen inicial creada se usar\xE1 para el inicio de cada clip.
Divide la creaci\xF3n en batches de 10.
rename everything adding _ as the blank spaces between words
from 1 to 9 change them to 01 to 09`;
function ensureOperationalHeaderText(rawText, operationalHeader) {
  const header = (operationalHeader || DEFAULT_OPERATIONAL_HEADER_SERVER).trim();
  const trimmed = (rawText || "").trim();
  if (!trimmed) return "";
  if (/^Act[uú]a como un historiador/i.test(trimmed) || trimmed.includes("Cambia los nombres de los clips a las primeras 6 palabras")) {
    return trimmed;
  }
  return `${header}

${trimmed}`;
}
function readDocumentaries() {
  try {
    if (import_fs.default.existsSync(DOCS_FILE)) {
      const data = JSON.parse(import_fs.default.readFileSync(DOCS_FILE, "utf8"));
      if (Array.isArray(data)) {
        let modified = false;
        for (const doc of data) {
          if (doc && typeof doc.rawClipsText === "string" && doc.rawClipsText.trim()) {
            const fixed = ensureOperationalHeaderText(doc.rawClipsText, doc.operationalHeader);
            if (fixed !== doc.rawClipsText) {
              doc.rawClipsText = fixed;
              modified = true;
            }
          }
        }
        if (modified) {
          import_fs.default.writeFileSync(DOCS_FILE, JSON.stringify(data, null, 2), "utf8");
        }
        return data;
      }
    }
  } catch (e) {
    console.error("Error reading documentaries.json:", e);
  }
  return [];
}
var GITHUB_OWNER = "raydelw-a11y";
var GITHUB_REPO = "Huellas-Master";
var GITHUB_BRANCH = "main";
function getLocalGitHubToken() {
  try {
    if (import_fs.default.existsSync(CONFIG_FILE)) {
      const cfg = JSON.parse(import_fs.default.readFileSync(CONFIG_FILE, "utf8"));
      if (cfg.githubToken && typeof cfg.githubToken === "string" && cfg.githubToken.trim()) {
        return cfg.githubToken.trim();
      }
    }
  } catch {
  }
  if (process.env.GITHUB_TOKEN && process.env.GITHUB_TOKEN.trim()) {
    return process.env.GITHUB_TOKEN.trim();
  }
  try {
    const out = (0, import_child_process.execSync)(
      'printf "protocol=https\\nhost=github.com\\n\\n" | git credential-osxkeychain get',
      { encoding: "utf8", stdio: ["pipe", "pipe", "ignore"] }
    );
    for (const line of out.split(/\r?\n/)) {
      if (line.startsWith("password=")) {
        return line.slice("password=".length).trim();
      }
    }
  } catch {
  }
  return "";
}
var lastPushedGitHubJson = "";
function writeDocumentaries(list, skipCloudPush = false) {
  const jsonStr = JSON.stringify(list, null, 2);
  try {
    const currentDisk = import_fs.default.existsSync(DOCS_FILE) ? import_fs.default.readFileSync(DOCS_FILE, "utf8") : "";
    if (currentDisk !== jsonStr) {
      import_fs.default.writeFileSync(DOCS_FILE, jsonStr, "utf8");
    }
  } catch {
    import_fs.default.writeFileSync(DOCS_FILE, jsonStr, "utf8");
  }
  try {
    if (import_fs.default.existsSync(DOCS_FILE)) {
      lastServerWriteDocsMtimeMs = Math.floor(import_fs.default.statSync(DOCS_FILE).mtimeMs);
      serverDocsRevisionCounter = Math.max(serverDocsRevisionCounter + 1, lastServerWriteDocsMtimeMs);
    }
  } catch {
  }
  try {
    const docsDataDir = import_path.default.join(process.cwd(), "docs", "data");
    if (import_fs.default.existsSync(docsDataDir)) {
      const docsTarget = import_path.default.join(docsDataDir, "documentaries.json");
      const currentDocsDisk = import_fs.default.existsSync(docsTarget) ? import_fs.default.readFileSync(docsTarget, "utf8") : "";
      if (currentDocsDisk !== jsonStr) {
        import_fs.default.writeFileSync(docsTarget, jsonStr, "utf8");
      }
    }
  } catch {
  }
  if (!skipCloudPush) {
    scheduleGitHubPush();
  }
}
var githubPushTimer = null;
function scheduleGitHubPush() {
  if (githubPushTimer) clearTimeout(githubPushTimer);
  githubPushTimer = setTimeout(() => {
    syncDocumentariesWithGitHubServer(false).catch(
      (e) => console.warn("[CloudSync] Auto push warning:", e?.message || e)
    );
  }, 2500);
}
async function getServerGitHubFileSha(filePath, token) {
  try {
    const dirPath = filePath.includes("/") ? filePath.split("/").slice(0, -1).join("/") : "";
    const fileName = filePath.split("/").pop() || filePath;
    const url = `https://api.github.com/repos/${GITHUB_OWNER}/${GITHUB_REPO}/contents/${dirPath}?ref=${GITHUB_BRANCH}&t=${Date.now()}`;
    const headers = {
      Accept: "application/vnd.github+json",
      "User-Agent": "HuellasMaster-Studio"
    };
    if (token) headers["Authorization"] = `token ${token}`;
    const res = await fetch(url, { headers });
    if (!res.ok) return null;
    const items = await res.json();
    if (Array.isArray(items)) {
      const found = items.find((it) => it && it.name === fileName);
      return found?.sha || null;
    }
  } catch {
  }
  return null;
}
function mergeServerDocObjects(winner, other) {
  if (!winner || !other) return winner || other;
  if (!Array.isArray(winner.clips) || !Array.isArray(other.clips) || other.clips.length === 0) {
    return winner;
  }
  const otherClipByNum = /* @__PURE__ */ new Map();
  for (const c of other.clips) {
    if (c && typeof c.clipNumber === "number") {
      otherClipByNum.set(c.clipNumber, c);
    }
  }
  const mergedClips = winner.clips.map((c) => {
    const o = otherClipByNum.get(c.clipNumber);
    if (!o) return c;
    return {
      ...c,
      reviewedForEditor: c.reviewedForEditor !== void 0 ? Boolean(c.reviewedForEditor) : Boolean(o.reviewedForEditor),
      recreated: Boolean(c.recreated || o.recreated),
      videoReady: Boolean(c.videoReady || o.videoReady),
      imageReady: Boolean(c.imageReady || o.imageReady),
      videoSavedFileName: c.videoSavedFileName || o.videoSavedFileName,
      videoFrames: Array.isArray(c.videoFrames) && c.videoFrames.length > 0 ? c.videoFrames : o.videoFrames
    };
  });
  return { ...winner, clips: mergedClips };
}
function stripHeavyMediaForGitHubServer(list, stripReferenceImages = false) {
  return (list || []).map((doc) => ({
    ...doc,
    ...stripReferenceImages && typeof doc.thumbnailImageUrl === "string" && doc.thumbnailImageUrl.startsWith("data:") && doc.thumbnailImageUrl.length > 6e4 ? { thumbnailImageUrl: "" } : {},
    ...stripReferenceImages && typeof doc.masterAudioUrl === "string" && doc.masterAudioUrl.startsWith("data:") && doc.masterAudioUrl.length > 6e4 ? { masterAudioUrl: "" } : {},
    ...stripReferenceImages && Array.isArray(doc.audioTracks) ? {
      audioTracks: doc.audioTracks.map(
        (t) => typeof t?.audioUrl === "string" && t.audioUrl.startsWith("data:") && t.audioUrl.length > 6e4 ? { ...t, audioUrl: "" } : t
      )
    } : {},
    ...stripReferenceImages && Array.isArray(doc.references) ? {
      references: doc.references.map(
        (r) => typeof r?.imageUrl === "string" && r.imageUrl.startsWith("data:") && r.imageUrl.length > 6e4 ? { ...r, imageUrl: "" } : r
      )
    } : {},
    clips: Array.isArray(doc.clips) ? doc.clips.map((c) => {
      if (!c?.videoFrames || c.videoFrames.length === 0) return c;
      const { videoFrames, ...rest } = c;
      return rest;
    }) : []
  }));
}
async function syncDocumentariesWithGitHubServer(pullFirst = true) {
  const token = getLocalGitHubToken();
  const initialLocalList = readDocumentaries();
  if (!token) {
    return { synced: false, total: initialLocalList.length, error: "No GitHub token found" };
  }
  let mergedList = initialLocalList;
  if (pullFirst) {
    try {
      const sha = await getServerGitHubFileSha("data/documentaries.json", token);
      if (sha) {
        const blobRes = await fetch(
          `https://api.github.com/repos/${GITHUB_OWNER}/${GITHUB_REPO}/git/blobs/${sha}?t=${Date.now()}`,
          {
            headers: {
              Accept: "application/vnd.github.raw+json",
              Authorization: `token ${token}`,
              "User-Agent": "HuellasMaster-Studio"
            }
          }
        );
        if (blobRes.ok) {
          const remoteList = await blobRes.json();
          if (Array.isArray(remoteList)) {
            const latestLocalList = readDocumentaries();
            const byId = /* @__PURE__ */ new Map();
            for (const r of remoteList) {
              if (r && r.id) byId.set(r.id, r);
            }
            for (const l of latestLocalList) {
              if (!l || !l.id) continue;
              const existing = byId.get(l.id);
              if (!existing) {
                byId.set(l.id, l);
              } else {
                const lTime = Date.parse(l.updatedAt || l.createdAt || "") || 0;
                const rTime = Date.parse(existing.updatedAt || existing.createdAt || "") || 0;
                if (lTime >= rTime) {
                  byId.set(l.id, mergeServerDocObjects(l, existing));
                } else {
                  byId.set(l.id, mergeServerDocObjects(existing, l));
                }
              }
            }
            mergedList = Array.from(byId.values()).sort((a, b) => {
              const tA = Date.parse(a.updatedAt || a.createdAt || "") || 0;
              const tB = Date.parse(b.updatedAt || b.createdAt || "") || 0;
              return tB - tA;
            });
            if (JSON.stringify(mergedList) !== JSON.stringify(latestLocalList)) {
              writeDocumentaries(mergedList, true);
            }
          }
        }
      }
    } catch (e) {
      console.warn("[CloudSync] Pull warning:", e);
    }
    return { synced: true, total: mergedList.length };
  }
  try {
    const freshLocalList = readDocumentaries();
    let jsonStr = JSON.stringify(stripHeavyMediaForGitHubServer(freshLocalList, false), null, 2);
    if (jsonStr.length > 35e5) {
      jsonStr = JSON.stringify(stripHeavyMediaForGitHubServer(freshLocalList, true), null, 2);
    }
    if (jsonStr === lastPushedGitHubJson) {
      return { synced: true, total: freshLocalList.length };
    }
    lastPushedGitHubJson = jsonStr;
    const headers = {
      Accept: "application/vnd.github+json",
      Authorization: `token ${token}`,
      "Content-Type": "application/json",
      "User-Agent": "HuellasMaster-Studio"
    };
    try {
      const refRes = await fetch(
        `https://api.github.com/repos/${GITHUB_OWNER}/${GITHUB_REPO}/git/ref/heads/${GITHUB_BRANCH}`,
        { headers }
      );
      if (refRes.ok) {
        const refData = await refRes.json();
        const latestCommitSha = refData?.object?.sha;
        if (latestCommitSha) {
          const commitRes = await fetch(
            `https://api.github.com/repos/${GITHUB_OWNER}/${GITHUB_REPO}/git/commits/${latestCommitSha}`,
            { headers }
          );
          const commitData = await commitRes.json();
          const baseTreeSha = commitData?.tree?.sha;
          const blobRes = await fetch(
            `https://api.github.com/repos/${GITHUB_OWNER}/${GITHUB_REPO}/git/blobs`,
            {
              method: "POST",
              headers,
              body: JSON.stringify({ content: jsonStr, encoding: "utf-8" })
            }
          );
          const blobData = await blobRes.json();
          const newBlobSha = blobData?.sha;
          if (baseTreeSha && newBlobSha) {
            const treeRes = await fetch(
              `https://api.github.com/repos/${GITHUB_OWNER}/${GITHUB_REPO}/git/trees`,
              {
                method: "POST",
                headers,
                body: JSON.stringify({
                  base_tree: baseTreeSha,
                  tree: [
                    { path: "data/documentaries.json", mode: "100644", type: "blob", sha: newBlobSha },
                    { path: "docs/data/documentaries.json", mode: "100644", type: "blob", sha: newBlobSha }
                  ]
                })
              }
            );
            const treeData = await treeRes.json();
            if (treeData?.sha) {
              const newCommitRes = await fetch(
                `https://api.github.com/repos/${GITHUB_OWNER}/${GITHUB_REPO}/git/commits`,
                {
                  method: "POST",
                  headers,
                  body: JSON.stringify({
                    message: `Sync documentaries.json (${freshLocalList.length} documentales)`,
                    tree: treeData.sha,
                    parents: [latestCommitSha]
                  })
                }
              );
              const newCommitData = await newCommitRes.json();
              if (newCommitData?.sha) {
                const patchRes = await fetch(
                  `https://api.github.com/repos/${GITHUB_OWNER}/${GITHUB_REPO}/git/refs/heads/${GITHUB_BRANCH}`,
                  {
                    method: "PATCH",
                    headers,
                    body: JSON.stringify({ sha: newCommitData.sha, force: false })
                  }
                );
                if (patchRes.ok) {
                  return { synced: true, total: freshLocalList.length };
                }
              }
            }
          }
        }
      }
    } catch {
    }
    const encodedContent = Buffer.from(jsonStr, "utf8").toString("base64");
    for (const targetPath of ["data/documentaries.json", "docs/data/documentaries.json"]) {
      const existingSha = await getServerGitHubFileSha(targetPath, token);
      const bodyObj = {
        message: `Sync ${targetPath} (${freshLocalList.length} documentales)`,
        content: encodedContent,
        branch: GITHUB_BRANCH
      };
      if (existingSha) bodyObj.sha = existingSha;
      await fetch(`https://api.github.com/repos/${GITHUB_OWNER}/${GITHUB_REPO}/contents/${targetPath}`, {
        method: "PUT",
        headers,
        body: JSON.stringify(bodyObj)
      });
    }
    return { synced: true, total: freshLocalList.length };
  } catch (e) {
    return { synced: false, total: mergedList.length, error: e?.message || "Error pushing to GitHub" };
  }
}
app.get("/api/cloud/setup-link", (req, res) => {
  const g = getSavedGeminiKey();
  const h = getLocalGitHubToken();
  const payload = Buffer.from(JSON.stringify({ g, h }), "utf8").toString("base64");
  const url = `https://${GITHUB_OWNER}.github.io/${GITHUB_REPO}/#setup=${payload}`;
  res.json({
    url,
    publicUrl: `https://${GITHUB_OWNER}.github.io/${GITHUB_REPO}/`,
    hasGeminiKey: !!g,
    hasGitHubToken: !!h
  });
});
app.post("/api/cloud/sync", async (req, res) => {
  const result = await syncDocumentariesWithGitHubServer(true);
  res.json({
    ...result,
    documentaries: readDocumentaries()
  });
});
var lastServerWriteDocsMtimeMs = 0;
var serverDocsRevisionCounter = Date.now();
function getServerVersionInfo() {
  const codeCandidates = [
    import_path.default.join(process.cwd(), "src", "App.tsx"),
    import_path.default.join(process.cwd(), "src", "components", "CapCutEditor.tsx"),
    import_path.default.join(process.cwd(), "src", "components", "PromptGenerator.jsx"),
    import_path.default.join(process.cwd(), "src", "utils", "cloudSync.ts"),
    import_path.default.join(process.cwd(), "server.ts"),
    import_path.default.join(process.cwd(), "docs", "index.html")
  ];
  let codeMtimeMs = 0;
  for (const p of codeCandidates) {
    try {
      if (import_fs.default.existsSync(p)) {
        const st = import_fs.default.statSync(p);
        if (st.mtimeMs > codeMtimeMs) codeMtimeMs = Math.floor(st.mtimeMs);
      }
    } catch {
    }
  }
  let docsMtimeMs = 0;
  try {
    if (import_fs.default.existsSync(DOCS_FILE)) {
      const st = import_fs.default.statSync(DOCS_FILE);
      docsMtimeMs = Math.floor(st.mtimeMs);
      if (docsMtimeMs > lastServerWriteDocsMtimeMs + 50) {
        lastServerWriteDocsMtimeMs = docsMtimeMs;
        serverDocsRevisionCounter = Math.max(serverDocsRevisionCounter + 1, docsMtimeMs);
      }
    }
  } catch {
  }
  return {
    codeMtimeMs,
    docsMtimeMs,
    docsRevision: serverDocsRevisionCounter
  };
}
app.get("/api/version", (_req, res) => {
  res.json(getServerVersionInfo());
});
app.get("/api/documentaries", (req, res) => {
  const v = getServerVersionInfo();
  res.setHeader("X-Server-Code-Version", String(v.codeMtimeMs));
  res.setHeader("X-Server-Docs-Version", String(v.docsRevision));
  res.json(readDocumentaries());
});
app.get("/api/documentaries/:id", (req, res) => {
  const list = readDocumentaries();
  const doc = list.find((d) => d.id === req.params.id);
  if (!doc) {
    res.status(404).json({ error: "Documental no encontrado." });
    return;
  }
  const v = getServerVersionInfo();
  res.setHeader("X-Server-Code-Version", String(v.codeMtimeMs));
  res.setHeader("X-Server-Docs-Version", String(v.docsRevision));
  res.json(doc);
});
app.post("/api/documentaries", (req, res) => {
  const list = readDocumentaries();
  const now = (/* @__PURE__ */ new Date()).toISOString();
  const body = req.body || {};
  const newDoc = {
    id: `doc-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
    title: body.title || "Nuevo Documental \u2014 Huellas de la Humanidad",
    subtitle: body.subtitle || "",
    productionType: body.productionType || "DOCUMENTAL_16X9",
    status: body.status || "planificacion",
    createdAt: now,
    updatedAt: now,
    promptConfig: body.promptConfig || {
      TIPO_PRODUCCION: "REELS",
      SUB_OPCION_POST: "EXPECTATIVA_ESTRENO",
      SUB_OPCION_REELS: body.productionType === "REEL_9X16" ? "9X16" : "16X9",
      SINCRONIZACION_CLIP_1: "VOZ_EN_CLIP_2",
      TEXTO_PANTALLA_CLIP_1: "CAPCUT_MANUAL",
      DURACION_CLIP_1: "6",
      DURACION_CLIPS: "10_SEGUNDOS",
      VOZ_NARRATIVA_EN_CLIPS: "INCLUIR",
      UBICACION_INTRO_MARCA: "INTRO_INICIO_00"
    },
    compiledMasterPrompt: body.compiledMasterPrompt || "",
    topic: body.topic || "",
    typology: body.typology || "Un suceso hist\xF3rico",
    historicalTime: body.historicalTime || "",
    historicalLocation: body.historicalLocation || "",
    targetDurationSeconds: body.targetDurationSeconds || 120,
    clipDurationMode: body.clipDurationMode || "10_SEGUNDOS",
    clip1SyncMode: body.clip1SyncMode || "VOZ_EN_CLIP_2",
    clip1DurationSeconds: body.clip1DurationSeconds || 6,
    sectionsStructure: body.sectionsStructure || "",
    deepResearchPrompt: body.deepResearchPrompt || "",
    deepResearchResult: body.deepResearchResult || "",
    voiceoverScript: body.voiceoverScript || "",
    selectedVoice: body.selectedVoice || "Charon",
    selectedStyle: body.selectedStyle || "dramatic",
    selectedSpeed: body.selectedSpeed || "medium",
    selectedLanguage: body.selectedLanguage || "es-la",
    audioTracks: body.audioTracks || [],
    masterAudioUrl: body.masterAudioUrl || "",
    timelineSentences: body.timelineSentences || [],
    timelineFormattedText: body.timelineFormattedText || "",
    timelineSettings: body.timelineSettings || {
      language: "es",
      customLanguage: "",
      quality: "high",
      outputStyle: "timeline",
      timestampFormat: "MM:SS",
      sentenceMode: "split-10-seconds",
      noBlankLines: true,
      strictNarration: false,
      removeFiller: false,
      mergeShort: false,
      preservePunctuation: true,
      includeLineNumbers: true
    },
    rawReferencePrompts: body.rawReferencePrompts || "",
    references: body.references || [],
    clip1TextMode: body.clip1TextMode || "CAPCUT_MANUAL",
    clip1Line1LocationTime: body.clip1Line1LocationTime || "",
    clip1Line2Hook: body.clip1Line2Hook || "",
    clip1OptionsRaw: body.clip1OptionsRaw || "",
    operationalHeader: body.operationalHeader || "",
    rawClipsText: body.rawClipsText || "",
    clips: body.clips || [],
    capcutRawSrt: body.capcutRawSrt || "",
    correctedSrt: body.correctedSrt || "",
    srtFileName: body.srtFileName || "captions_corregidos",
    confirmedFinalDuration: body.confirmedFinalDuration || "02:00",
    rawSunoText: body.rawSunoText || "",
    sunoTracks: body.sunoTracks || [],
    thumbnailOrientation: body.thumbnailOrientation || (body.productionType === "REEL_9X16" ? "VERTICAL_9X16" : "HORIZONTAL_16X9"),
    thumbnailTextOptions: body.thumbnailTextOptions || [],
    thumbnailPrompt: body.thumbnailPrompt || "",
    thumbnailTextOverlay: body.thumbnailTextOverlay || "",
    thumbnailImageUrl: body.thumbnailImageUrl || "",
    thumbnailReady: false,
    platform: body.platform || "YOUTUBE",
    rawMetadataText: body.rawMetadataText || "",
    rawYoutubeMetadata: body.rawYoutubeMetadata || body.rawMetadataText || "",
    rawFacebookMetadata: body.rawFacebookMetadata || "",
    publishTitle: body.publishTitle || "",
    publishDescription: body.publishDescription || "",
    youtubeChapters: body.youtubeChapters || "",
    aiNote: body.aiNote || "",
    slogan: body.slogan || "Cada historia deja una huella. Aqu\xED seguimos sus rastros.",
    hashtags: body.hashtags || "",
    youtubeTags: body.youtubeTags || "",
    pinnedComment: body.pinnedComment || ""
  };
  list.unshift(newDoc);
  writeDocumentaries(list);
  res.json(newDoc);
});
app.put("/api/documentaries/:id", (req, res) => {
  const vBefore = getServerVersionInfo();
  const list = readDocumentaries();
  const idx = list.findIndex((d) => d.id === req.params.id);
  const incomingBody = { ...req.body || {} };
  const patchKeys = Array.isArray(incomingBody._patchKeys) ? incomingBody._patchKeys : void 0;
  const clientDocsVersion = Number(incomingBody._clientDocsVersion || 0);
  const clientCodeVersion = Number(incomingBody._clientCodeVersion || 0);
  const isBackgroundCacheSync = Boolean(incomingBody._isBackgroundCacheSync);
  delete incomingBody._patchKeys;
  delete incomingBody._clientDocsVersion;
  delete incomingBody._clientCodeVersion;
  delete incomingBody._isBackgroundCacheSync;
  if (idx === -1) {
    const now = (/* @__PURE__ */ new Date()).toISOString();
    const upserted = {
      ...incomingBody,
      id: req.params.id,
      createdAt: incomingBody?.createdAt || now,
      updatedAt: now
    };
    list.unshift(upserted);
    writeDocumentaries(list);
    const vAfter2 = getServerVersionInfo();
    res.setHeader("X-Server-Code-Version", String(vAfter2.codeMtimeMs));
    res.setHeader("X-Server-Docs-Version", String(vAfter2.docsRevision));
    res.json(upserted);
    return;
  }
  const currentDiskDoc = list[idx];
  if (isBackgroundCacheSync || !patchKeys && (clientDocsVersion > 0 && clientDocsVersion < vBefore.docsRevision || clientCodeVersion > 0 && clientCodeVersion < vBefore.codeMtimeMs)) {
    res.setHeader("X-Server-Code-Version", String(vBefore.codeMtimeMs));
    res.setHeader("X-Server-Docs-Version", String(vBefore.docsRevision));
    res.setHeader("X-Server-Version-Locked", "true");
    res.json(currentDiskDoc);
    return;
  }
  let updated;
  if (patchKeys && patchKeys.length > 0) {
    const surgicalPatch = {};
    for (const key of patchKeys) {
      if (key === "id" || key === "createdAt") continue;
      if (key === "promptConfig" && incomingBody.promptConfig && typeof incomingBody.promptConfig === "object") {
        surgicalPatch.promptConfig = {
          ...currentDiskDoc.promptConfig || {},
          ...incomingBody.promptConfig
        };
      } else if (key === "timelineSettings" && incomingBody.timelineSettings && typeof incomingBody.timelineSettings === "object") {
        surgicalPatch.timelineSettings = {
          ...currentDiskDoc.timelineSettings || {},
          ...incomingBody.timelineSettings
        };
      } else if (key in incomingBody) {
        surgicalPatch[key] = incomingBody[key];
      }
    }
    updated = {
      ...currentDiskDoc,
      ...surgicalPatch,
      id: currentDiskDoc.id,
      updatedAt: (/* @__PURE__ */ new Date()).toISOString()
    };
  } else {
    updated = {
      ...currentDiskDoc,
      ...incomingBody,
      promptConfig: {
        ...currentDiskDoc.promptConfig || {},
        ...incomingBody.promptConfig || {}
      },
      id: currentDiskDoc.id,
      updatedAt: (/* @__PURE__ */ new Date()).toISOString()
    };
  }
  list[idx] = updated;
  writeDocumentaries(list);
  const vAfter = getServerVersionInfo();
  res.setHeader("X-Server-Code-Version", String(vAfter.codeMtimeMs));
  res.setHeader("X-Server-Docs-Version", String(vAfter.docsRevision));
  res.json(updated);
});
app.delete("/api/documentaries/:id", (req, res) => {
  let list = readDocumentaries();
  list = list.filter((d) => d.id !== req.params.id);
  writeDocumentaries(list);
  res.json({ success: true });
});
app.post("/api/documentaries/:id/duplicate", (req, res) => {
  const list = readDocumentaries();
  const orig = list.find((d) => d.id === req.params.id);
  if (!orig) {
    res.status(404).json({ error: "Documental no encontrado." });
    return;
  }
  const now = (/* @__PURE__ */ new Date()).toISOString();
  const copy = {
    ...JSON.parse(JSON.stringify(orig)),
    id: `doc-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
    title: `${orig.title} (Copia)`,
    createdAt: now,
    updatedAt: now
  };
  list.unshift(copy);
  writeDocumentaries(list);
  res.json(copy);
});
var assetStorage = import_multer.default.diskStorage({
  destination: (req, file, cb) => cb(null, ASSETS_DIR),
  filename: (req, file, cb) => {
    const ext = import_path.default.extname(file.originalname) || ".bin";
    const safeBase = import_path.default.basename(file.originalname, ext).replace(/[^a-zA-Z0-9_-]/g, "_").slice(0, 45);
    cb(null, `asset-${Date.now()}-${safeBase}${ext}`);
  }
});
var uploadAsset = (0, import_multer.default)({ storage: assetStorage, limits: { fileSize: 150 * 1024 * 1024 } });
app.post("/api/assets/upload", uploadAsset.single("file"), (req, res) => {
  if (!req.file) {
    res.status(400).json({ error: "No se recibi\xF3 ning\xFAn archivo." });
    return;
  }
  const url = `/assets/${req.file.filename}`;
  res.json({
    filename: req.file.filename,
    originalName: req.file.originalname,
    url
  });
});
function getCustomVoices() {
  try {
    if (import_fs.default.existsSync(CUSTOM_VOICES_FILE)) {
      return JSON.parse(import_fs.default.readFileSync(CUSTOM_VOICES_FILE, "utf8"));
    }
  } catch {
  }
  return [];
}
app.get("/api/custom-voices", (req, res) => {
  res.json({ voices: getCustomVoices() });
});
app.post("/api/custom-voices", (req, res) => {
  const { name, styleDescription, baseVoice, speed, prompt } = req.body;
  const voices = getCustomVoices();
  const newVoice = {
    id: `voice_${Date.now()}`,
    name: (name || "Voz Personalizada").trim(),
    styleDescription: (styleDescription || "").trim(),
    baseVoice: baseVoice || "Charon",
    speed: speed || "medium",
    prompt: prompt || "",
    createdAt: (/* @__PURE__ */ new Date()).toISOString()
  };
  voices.unshift(newVoice);
  import_fs.default.writeFileSync(CUSTOM_VOICES_FILE, JSON.stringify(voices, null, 2), "utf8");
  res.json({ voice: newVoice, voices });
});
function pcmToWav(pcmBuffer, sampleRate = 24e3) {
  const numChannels = 1;
  const bitsPerSample = 16;
  const byteRate = sampleRate * numChannels * (bitsPerSample / 8);
  const blockAlign = numChannels * (bitsPerSample / 8);
  const wavHeader = Buffer.alloc(44);
  wavHeader.write("RIFF", 0);
  wavHeader.writeUInt32LE(36 + pcmBuffer.length, 4);
  wavHeader.write("WAVE", 8);
  wavHeader.write("fmt ", 12);
  wavHeader.writeUInt32LE(16, 16);
  wavHeader.writeUInt16LE(1, 20);
  wavHeader.writeUInt16LE(numChannels, 22);
  wavHeader.writeUInt32LE(sampleRate, 24);
  wavHeader.writeUInt32LE(byteRate, 28);
  wavHeader.writeUInt16LE(blockAlign, 32);
  wavHeader.writeUInt16LE(bitsPerSample, 34);
  wavHeader.write("data", 36);
  wavHeader.writeUInt32LE(pcmBuffer.length, 40);
  return Buffer.concat([wavHeader, pcmBuffer]);
}
function extractPcmFromWav(wavBuffer) {
  let current = wavBuffer;
  let guard = 0;
  while (current.length >= 12 && current.toString("binary", 0, 4) === "RIFF" && current.toString("binary", 8, 12) === "WAVE" && guard < 5) {
    guard++;
    let foundData = false;
    let index = 12;
    while (index < current.length - 8) {
      const chunkName = current.toString("binary", index, index + 4);
      let chunkSize = 0;
      try {
        chunkSize = current.readUInt32LE(index + 4);
      } catch {
        break;
      }
      if (chunkName === "data") {
        const dataStart = index + 8;
        const dataEnd = Math.min(dataStart + chunkSize, current.length);
        current = current.subarray(dataStart, dataEnd);
        foundData = true;
        break;
      }
      index += 8 + chunkSize + chunkSize % 2;
      if (chunkSize <= 0 || index <= 12) break;
    }
    if (!foundData) {
      if (current.length >= 44) current = current.subarray(44);
      else break;
    }
  }
  if (current.length % 2 !== 0) {
    current = current.subarray(0, current.length - 1);
  }
  return current;
}
function applyMicroFade(pcmBuffer, fadeSamples = 240) {
  const evenLen = pcmBuffer.length - pcmBuffer.length % 2;
  const numSamples = Math.floor(evenLen / 2);
  if (numSamples < fadeSamples * 2) return pcmBuffer.subarray(0, evenLen);
  const out = Buffer.from(pcmBuffer.subarray(0, evenLen));
  const winSamples = 480;
  const numWins = Math.ceil(numSamples / winSamples);
  if (numWins > 0) {
    const burstWins = new Uint8Array(numWins);
    for (let w = 0; w < numWins; w++) {
      const startSample = w * winSamples;
      const curWinSamples = Math.min(winSamples, numSamples - startSample);
      if (curWinSamples <= 1) continue;
      let sumSq = 0;
      let diffSq = 0;
      let maxAbs = 0;
      let prev = out.readInt16LE(startSample * 2);
      for (let i = 0; i < curWinSamples; i++) {
        const s = out.readInt16LE((startSample + i) * 2);
        const a = Math.abs(s);
        if (a > maxAbs) maxAbs = a;
        sumSq += s * s;
        const d = s - prev;
        diffSq += d * d;
        prev = s;
      }
      const rms = Math.sqrt(sumSq / curWinSamples) / 32768;
      const peak = maxAbs / 32768;
      const hfRms = Math.sqrt(diffSq / curWinSamples) / 65536;
      if (hfRms > 0.13 && (peak > 0.72 || rms > 0.11)) {
        burstWins[w] = 1;
      }
    }
    for (let w = 0; w < numWins; w++) {
      if (burstWins[w] === 1) {
        const s0 = Math.max(0, (w - 1) * winSamples);
        const s1 = Math.min(numSamples, (w + 2) * winSamples);
        for (let i = s0; i < s1; i++) {
          out.writeInt16LE(0, i * 2);
        }
      }
    }
  }
  for (let i = 0; i < fadeSamples; i++) {
    const factor = i / fadeSamples;
    const sample = out.readInt16LE(i * 2);
    out.writeInt16LE(Math.round(sample * factor), i * 2);
  }
  for (let i = 0; i < fadeSamples; i++) {
    const factor = (fadeSamples - i) / fadeSamples;
    const idx = (numSamples - fadeSamples + i) * 2;
    const sample = out.readInt16LE(idx);
    out.writeInt16LE(Math.round(sample * factor), idx);
  }
  return out;
}
function getAudioDurationInSeconds(buffer, defaultSampleRate = 24e3) {
  try {
    if (buffer.length >= 44 && buffer.toString("binary", 0, 4) === "RIFF" && buffer.toString("binary", 8, 12) === "WAVE") {
      const sampleRate = buffer.readUInt32LE(24) || defaultSampleRate;
      const numChannels = buffer.readUInt16LE(22) || 1;
      const bitsPerSample = buffer.readUInt16LE(34) || 16;
      const byteRate = buffer.readUInt32LE(28) || sampleRate * numChannels * (bitsPerSample / 8);
      const pcmData = extractPcmFromWav(buffer);
      if (byteRate > 0 && pcmData.length > 0) {
        return parseFloat((pcmData.length / byteRate).toFixed(2));
      }
    }
  } catch {
  }
  return parseFloat(((buffer.length > 44 ? buffer.length - 44 : buffer.length) / 48e3).toFixed(2));
}
var UNIVERSAL_PAUSE_REGEX = /[\[{]\s*(?:(?:pausa|pause|silencio)\s*:?\s*)?([0-9]{1,2}(?:[.,][0-9]+)?)\s*(s|seg|segundos|ms|milisegundos)?\s*[\]}]|[\[{]\s*(?:pausa|pause|silencio)\s*[\]}]|<break\s+time=["']?([0-9]+(?:\.[0-9]+)?)(s|ms)["']?\s*\/?>/gi;
function parseTextWithPauses(rawText) {
  if (!rawText) return [];
  const pauseRegex = new RegExp(UNIVERSAL_PAUSE_REGEX.source, "gi");
  const segments = [];
  let lastIndex = 0;
  let match;
  while ((match = pauseRegex.exec(rawText)) !== null) {
    const textBefore = rawText.slice(lastIndex, match.index);
    if (textBefore.trim()) {
      segments.push({ type: "text", text: textBefore.trim() });
    }
    let durationSec = 1.5;
    if (match[1] !== void 0) {
      const val = parseFloat(match[1].replace(",", "."));
      const unit = (match[2] || "s").toLowerCase();
      durationSec = unit.startsWith("ms") || unit.startsWith("mili") ? val / 1e3 : val;
    } else if (match[3] !== void 0) {
      const val = parseFloat(match[3].replace(",", "."));
      const unit = (match[4] || "s").toLowerCase();
      durationSec = unit === "ms" ? val / 1e3 : val;
    }
    durationSec = Math.max(0.1, Math.min(30, durationSec));
    segments.push({ type: "pause", duration: durationSec });
    lastIndex = match.index + match[0].length;
  }
  const remainingText = rawText.slice(lastIndex);
  if (remainingText.trim()) {
    segments.push({ type: "text", text: remainingText.trim() });
  }
  return segments;
}
async function synthesizeSpeechCore({
  text,
  voice = "Charon",
  style = "dramatic",
  speed = "medium",
  language = "es-la",
  consistencyMode = true,
  customStyleDescription
}) {
  const cleanText = text.replace(new RegExp(UNIVERSAL_PAUSE_REGEX.source, "gi"), "").trim();
  if (!cleanText) {
    return { buffer: pcmToWav(Buffer.alloc(4800), 24e3), providerUsed: "Silencio" };
  }
  const ai = getGeminiClient();
  const physicalVoices = {
    Kore: "Kore",
    Aoede: "Aoede",
    Puck: "Puck",
    Charon: "Charon",
    Fenrir: "Fenrir",
    Zephyr: "Zephyr",
    Adam: "Fenrir",
    Antoni: "Zephyr",
    Bella: "Aoede",
    Domi: "Kore",
    Grace: "Aoede",
    Michael: "Charon",
    Rachel: "Aoede",
    Serena: "Kore",
    Journey_F: "Aoede",
    Journey_M: "Charon",
    Wavenet_A: "Kore",
    Wavenet_B: "Fenrir",
    Neural2_F: "Kore",
    Neural2_M: "Zephyr"
  };
  const physicalVoice = physicalVoices[voice] || "Charon";
  const languageInstructions = {
    es: "Speak in Spanish with native European Spanish pronunciation.",
    "es-la": "Speak in Spanish with a neutral, solemn, warm Latin American documentary accent (Espa\xF1ol Neutro). Do NOT use European Spanish ceceo.",
    en: "Speak in English with a native accent.",
    pt: "Speak in Portuguese with a native accent.",
    fr: "Speak in French with a native accent.",
    de: "Speak in German with a native accent."
  };
  const styleDescriptions = {
    standard: "Speak clearly with a professional documentary narrator cadence.",
    dramatic: "Speak with deep cinematic documentary gravitas, emotional resonance, and deliberate pacing.",
    formal: "Speak formally with historical rigor, solemn tone, and crisp articulation.",
    whisper: "Speak in a soft, intimate, mysterious low-volume voice.",
    cheerful: "Speak with bright, engaging enthusiasm."
  };
  const speedDescriptions = {
    slow: "Speak slowly and deliberately.",
    medium: "Speak at a measured, natural documentary narration speed.",
    fast: "Speak at a brisk, dynamic pace while keeping every word clear."
  };
  const langInstr = languageInstructions[language] || languageInstructions["es-la"];
  const speedInstr = speedDescriptions[speed] || speedDescriptions.medium;
  const styleInstr = customStyleDescription || styleDescriptions[style] || styleDescriptions.dramatic;
  const elevenVoices = {
    Adam: "pNInz6obpg7ANgmeW148",
    Antoni: "ErXwobaYiN019vkySvjV",
    Bella: "EXAVITQu4vr4xnSDxMaL",
    Domi: "AZnzlk1XvdvUeBnXmlld",
    Grace: "oWA07Hg9P7m8COV6hTh7",
    Michael: "flq6f7yk4E4fJM5XTYuz",
    Rachel: "21m00Tcm4TlvDq8ikWAM",
    Serena: "pMs2g854xbocwMw7G8S4"
  };
  if (elevenVoices[voice] && process.env.ELEVENLABS_API_KEY) {
    try {
      const resEl = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${elevenVoices[voice]}`, {
        method: "POST",
        headers: {
          "xi-api-key": process.env.ELEVENLABS_API_KEY,
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          text: cleanText,
          model_id: "eleven_multilingual_v2",
          voice_settings: { stability: 0.55, similarity_boost: 0.78 }
        })
      });
      if (resEl.ok) {
        const ab = await resEl.arrayBuffer();
        return { buffer: Buffer.from(ab), providerUsed: "ElevenLabs API" };
      }
    } catch (e) {
      console.warn("ElevenLabs fallback to Gemini:", e);
    }
  }
  if (!ai) {
    throw new Error("Configura tu Gemini API Key en el bot\xF3n de llave superior para sintetizar voz.");
  }
  const fullPrompt = `[DIRECTOR_INSTRUCTION]
Vocal Character Profile: "${voice}" (Physical base "${physicalVoice}")
Mood, Emotion & Delivery: ${styleInstr} ${consistencyMode ? "Maintain strict vocal consistency and uniform documentary pitch." : ""}
Vocal Speed: ${speedInstr}
Accent & Language Vibe: ${langInstr}

ACTOR INSTRUCTION: Deliver the exact text inside [TEXT] once from beginning to end. Never repeat sentences, never read markup tags or brackets.

[TEXT]
${cleanText}`;
  const targetModel = "gemini-3.8-flash-tts";
  let generation = null;
  let lastErr = null;
  let usedModel = "";
  for (let attempt = 0; attempt < 4; attempt++) {
    try {
      generation = await ai.models.generateContent({
        model: targetModel,
        contents: [{ parts: [{ text: fullPrompt }] }],
        config: {
          responseModalities: ["AUDIO"],
          speechConfig: {
            voiceConfig: {
              prebuiltVoiceConfig: { voiceName: physicalVoice }
            }
          }
        }
      });
      if (generation?.candidates?.[0]?.content?.parts?.[0]?.inlineData?.data) {
        const rawData = generation.candidates[0].content.parts[0].inlineData.data;
        const tempBuffer = Buffer.from(rawData, "base64");
        const tempSec = tempBuffer.length / 48e3;
        const wCount = cleanText.split(/\s+/).filter(Boolean).length;
        const expectedSec = wCount / 2;
        if (wCount >= 20 && tempSec > expectedSec * 2.3 && attempt < 3) {
          console.warn(
            `[Gemini TTS] Posible duplicaci\xF3n detectada en ${targetModel} (${tempSec.toFixed(1)}s vs ~${expectedSec.toFixed(1)}s). Reintentando con ${targetModel}...`
          );
          await new Promise((r) => setTimeout(r, 800));
          continue;
        }
        usedModel = targetModel;
        break;
      }
    } catch (e) {
      lastErr = e;
      if (attempt < 3) {
        await new Promise((r) => setTimeout(r, 1500 * (attempt + 1)));
        continue;
      }
      break;
    }
  }
  const base64Audio = generation?.candidates?.[0]?.content?.parts?.[0]?.inlineData?.data;
  if (!base64Audio) {
    throw new Error(`Error al sintetizar audio con ${targetModel}: ${lastErr?.message || "Sin datos de audio"}`);
  }
  const rawPcmBuffer = Buffer.from(base64Audio, "base64");
  const buffer = rawPcmBuffer.length >= 12 && rawPcmBuffer.toString("binary", 0, 4) === "RIFF" && rawPcmBuffer.toString("binary", 8, 12) === "WAVE" ? rawPcmBuffer : pcmToWav(rawPcmBuffer, 24e3);
  return {
    buffer,
    providerUsed: "Gemini 3.8 Flash TTS"
  };
}
function convertWavToMp3(wavPath, mp3Path) {
  return new Promise((resolve) => {
    const ffmpegBin = getFfmpegPath();
    (0, import_child_process.exec)(`"${ffmpegBin}" -y -i "${wavPath}" -codec:a libmp3lame -b:a 192k "${mp3Path}"`, (err) => {
      resolve(!err && import_fs.default.existsSync(mp3Path));
    });
  });
}
app.post("/api/tts", async (req, res) => {
  try {
    const {
      text,
      voice = "Charon",
      style = "dramatic",
      speed = "medium",
      language = "es-la",
      consistencyMode = true,
      label = "",
      customStyleDescription
    } = req.body;
    if (!text || typeof text !== "string" || !text.trim()) {
      res.status(400).json({ error: "El texto del guion es requerido para generar la locuci\xF3n." });
      return;
    }
    const segments = parseTextWithPauses(text);
    const hasPauses = segments.some((s) => s.type === "pause");
    let buffer;
    let providerUsed = "Gemini TTS";
    if (!hasPauses) {
      const result = await synthesizeSpeechCore({
        text,
        voice,
        style,
        speed,
        language,
        consistencyMode,
        customStyleDescription
      });
      buffer = result.buffer;
      providerUsed = result.providerUsed;
    } else {
      const pauseCount = segments.filter((s) => s.type === "pause").length;
      const totalPauseSec = segments.filter((s) => s.type === "pause").reduce((acc, s) => acc + (s.duration || 0), 0);
      console.log(
        `[TTS Pauses] Detectadas ${pauseCount} pausas (${totalPauseSec.toFixed(1)}s totales). Sintetizando segmentos con silencios PCM exactos...`
      );
      const pcmBuffers = [];
      for (const seg of segments) {
        if (seg.type === "pause" && seg.duration) {
          const pauseSamples = Math.round(24e3 * seg.duration);
          pcmBuffers.push(Buffer.alloc(pauseSamples * 2));
        } else if (seg.type === "text" && seg.text) {
          const result = await synthesizeSpeechCore({
            text: seg.text,
            voice,
            style,
            speed,
            language,
            consistencyMode,
            customStyleDescription
          });
          providerUsed = result.providerUsed;
          const pcm = extractPcmFromWav(result.buffer);
          pcmBuffers.push(applyMicroFade(pcm, 240));
        }
      }
      buffer = pcmToWav(Buffer.concat(pcmBuffers), 24e3);
      providerUsed = `${providerUsed} (${pauseCount} Pausas \xB7 ${totalPauseSec.toFixed(1)}s)`;
    }
    const wordCount = text.replace(new RegExp(UNIVERSAL_PAUSE_REGEX.source, "gi"), "").split(/\s+/).filter(Boolean).length;
    const fileId = `tts-${Date.now()}-${Math.floor(Math.random() * 1e3)}`;
    const wavFilename = `${fileId}.wav`;
    const mp3Filename = `${fileId}.mp3`;
    const localWavPath = import_path.default.join(TTS_DIR, wavFilename);
    const localMp3Path = import_path.default.join(TTS_DIR, mp3Filename);
    import_fs.default.writeFileSync(localWavPath, buffer);
    const mp3Success = await convertWavToMp3(localWavPath, localMp3Path);
    const filename = mp3Success ? mp3Filename : wavFilename;
    const actualDuration = getAudioDurationInSeconds(buffer);
    const newRecord = {
      id: fileId,
      label: label || `Locuci\xF3n (${voice})`,
      text,
      voice,
      style,
      speed,
      language,
      consistencyMode,
      filename,
      audioUrl: `tts-files/${filename}`,
      createdAt: (/* @__PURE__ */ new Date()).toISOString(),
      storageMode: "local",
      wordCount,
      duration: actualDuration,
      providerUsed
    };
    res.json(newRecord);
  } catch (error) {
    console.error("Error en /api/tts:", error);
    res.status(500).json({ error: error.message || "Error interno al sintetizar locuci\xF3n." });
  }
});
app.post("/api/tts/merge", async (req, res) => {
  try {
    const { filenames, text, voice, style, speed, language, label } = req.body;
    if (!Array.isArray(filenames) || filenames.length === 0) {
      res.status(400).json({ error: "Selecciona al menos 2 pistas para fusionar." });
      return;
    }
    const pcmBuffers = [];
    for (const name of filenames) {
      const safeName = import_path.default.basename(name);
      const baseWithoutExt = safeName.replace(/\.(?:wav|mp3)$/i, "");
      const wavCandidate = import_path.default.join(TTS_DIR, `${baseWithoutExt}.wav`);
      const exactCandidate = import_path.default.join(TTS_DIR, safeName);
      const targetWavPath = import_fs.default.existsSync(wavCandidate) ? wavCandidate : exactCandidate;
      if (!import_fs.default.existsSync(targetWavPath)) {
        res.status(404).json({ error: `Archivo no encontrado: ${safeName}` });
        return;
      }
      pcmBuffers.push(extractPcmFromWav(import_fs.default.readFileSync(targetWavPath)));
    }
    const computeActiveRms = (buf) => {
      const n = Math.floor(buf.length / 2);
      if (n === 0) return 0;
      let sumSq = 0;
      let activeCount = 0;
      for (let i = 0; i < n; i++) {
        const s = buf.readInt16LE(i * 2) / 32768;
        if (Math.abs(s) > 0.015) {
          sumSq += s * s;
          activeCount++;
        }
      }
      return activeCount > 100 ? Math.sqrt(sumSq / activeCount) : 0;
    };
    const rmsList = pcmBuffers.map(computeActiveRms).filter((r) => r > 0.01);
    const sortedRms = [...rmsList].sort((a, b) => a - b);
    const targetRms = sortedRms.length > 0 ? sortedRms[Math.floor(sortedRms.length / 2)] : 0.11;
    const pauseSamples = Math.round(24e3 * 0.25);
    const silenceBuffer = Buffer.alloc(pauseSamples * 2);
    const combinedChunks = [];
    pcmBuffers.forEach((b, idx) => {
      const segRms = computeActiveRms(b);
      let leveledBuf = Buffer.from(b);
      if (segRms > 0.01 && targetRms > 0.01) {
        const gain = Math.max(0.35, Math.min(2.2, targetRms / segRms));
        if (Math.abs(gain - 1) > 0.05) {
          const n = Math.floor(leveledBuf.length / 2);
          for (let i = 0; i < n; i++) {
            const v = Math.round(leveledBuf.readInt16LE(i * 2) * gain);
            leveledBuf.writeInt16LE(Math.max(-32767, Math.min(32767, v)), i * 2);
          }
        }
      }
      combinedChunks.push(applyMicroFade(leveledBuf, 240));
      if (idx < pcmBuffers.length - 1) combinedChunks.push(silenceBuffer);
    });
    const combinedWav = pcmToWav(Buffer.concat(combinedChunks), 24e3);
    const fileId = `tts-master-${Date.now()}`;
    const wavFilename = `${fileId}.wav`;
    const mp3Filename = `${fileId}.mp3`;
    const localWavPath = import_path.default.join(TTS_DIR, wavFilename);
    const localMp3Path = import_path.default.join(TTS_DIR, mp3Filename);
    import_fs.default.writeFileSync(localWavPath, combinedWav);
    const mp3Success = await convertWavToMp3(localWavPath, localMp3Path);
    const filename = mp3Success ? mp3Filename : wavFilename;
    const duration = getAudioDurationInSeconds(combinedWav);
    res.json({
      id: fileId,
      label: label || "Voz Narrativa Video",
      text: text || "Audio Maestro Fusionado",
      voice: voice || "Charon",
      style: style || "dramatic",
      speed: speed || "medium",
      language: language || "es-la",
      filename,
      audioUrl: `tts-files/${filename}`,
      createdAt: (/* @__PURE__ */ new Date()).toISOString(),
      storageMode: "local",
      wordCount: (text || "").split(/\s+/).filter(Boolean).length,
      duration,
      providerUsed: "VoxFlow Master Merge"
    });
  } catch (err) {
    res.status(500).json({ error: err.message || "Error al fusionar audios." });
  }
});
app.get("/api/tts/download-mp3", async (req, res) => {
  try {
    const rawFile = String(req.query.file || "").trim();
    const rawDownloadName = String(req.query.name || "Voz Narrativa Video.mp3").trim();
    if (!rawFile) {
      res.status(400).json({ error: "Se requiere el par\xE1metro file." });
      return;
    }
    const safeBase = import_path.default.basename(rawFile).replace(/\.(?:wav|mp3)$/i, "");
    const mp3Path = import_path.default.join(TTS_DIR, `${safeBase}.mp3`);
    const wavPath = import_path.default.join(TTS_DIR, `${safeBase}.wav`);
    if (!import_fs.default.existsSync(mp3Path)) {
      if (!import_fs.default.existsSync(wavPath)) {
        res.status(404).json({ error: "El archivo de audio no existe en el servidor." });
        return;
      }
      const converted = await convertWavToMp3(wavPath, mp3Path);
      if (!converted || !import_fs.default.existsSync(mp3Path)) {
        res.status(500).json({ error: "No se pudo convertir el audio a MP3." });
        return;
      }
    }
    const finalDownloadName = rawDownloadName.toLowerCase().endsWith(".mp3") ? rawDownloadName : `${rawDownloadName.replace(/\.wav$/i, "")}.mp3`;
    res.download(mp3Path, finalDownloadName);
  } catch (err) {
    res.status(500).json({ error: err.message || "Error al descargar el audio en MP3." });
  }
});
var chunkUpload = (0, import_multer.default)({
  dest: CHUNK_DIR,
  limits: { fileSize: 150 * 1024 * 1024 }
});
app.post("/api/upload-chunk", chunkUpload.single("chunk"), (req, res) => {
  try {
    const { uploadId, chunkIndex, totalChunks } = req.body;
    if (!uploadId || !req.file) {
      res.status(400).json({ error: "Falta uploadId o archivo chunk." });
      return;
    }
    const finalFilePath = import_path.default.join(CHUNK_DIR, `${import_path.default.basename(uploadId)}`);
    const chunkData = import_fs.default.readFileSync(req.file.path);
    import_fs.default.appendFileSync(finalFilePath, chunkData);
    import_fs.default.unlinkSync(req.file.path);
    res.json({ success: true, uploadedChunk: chunkIndex, totalChunks });
  } catch (err) {
    res.status(500).json({ error: "Error al subir chunk: " + err.message });
  }
});
function convertToLinear16Raw(inputPath, outputPath) {
  return new Promise((resolve) => {
    const ffmpegBin = getFfmpegPath();
    (0, import_child_process.exec)(`"${ffmpegBin}" -y -i "${inputPath}" -ar 16000 -ac 1 -f s16le -c:a pcm_s16le "${outputPath}"`, (err) => {
      resolve(!err);
    });
  });
}
function parseTimeString(timeObj) {
  if (timeObj == null) return 0;
  if (typeof timeObj === "number") return timeObj;
  if (typeof timeObj === "string") return parseFloat(timeObj.replace("s", ""));
  let sec = 0;
  if (timeObj.seconds !== void 0 && timeObj.seconds !== null) {
    if (typeof timeObj.seconds === "number") sec = timeObj.seconds;
    else if (typeof timeObj.seconds === "string") sec = parseInt(timeObj.seconds, 10);
    else if (timeObj.seconds.low !== void 0) sec = timeObj.seconds.low;
  }
  let nanos = 0;
  if (timeObj.nanos !== void 0 && timeObj.nanos !== null) {
    if (typeof timeObj.nanos === "number") nanos = timeObj.nanos;
    else if (typeof timeObj.nanos === "string") nanos = parseInt(timeObj.nanos, 10);
    else if (timeObj.nanos.low !== void 0) nanos = timeObj.nanos.low;
  }
  const result = sec + nanos / 1e9;
  return isNaN(result) ? 0 : result;
}
function splitSegmentsIntoInterval(segments, interval) {
  if (segments.length === 0) return [];
  const wordsList = [];
  for (const seg of segments) {
    if (seg.words && seg.words.length > 0) {
      seg.words.forEach((w) => {
        wordsList.push({ text: w.word, start: w.start, end: w.end });
      });
    } else {
      const rawWords = seg.text.trim().split(/\s+/).filter(Boolean);
      if (rawWords.length === 0) continue;
      const duration = seg.end - seg.start;
      const avgDuration = duration > 0 ? duration / rawWords.length : 1 / rawWords.length;
      rawWords.forEach((wordText, idx) => {
        wordsList.push({
          text: wordText,
          start: seg.start + idx * avgDuration,
          end: seg.start + (idx + 1) * avgDuration
        });
      });
    }
  }
  if (wordsList.length === 0) return [];
  const resultChunks = [];
  let firstWordChunkIdx = Math.floor(wordsList[0].start / interval);
  if (wordsList[0].end > (firstWordChunkIdx + 1) * interval) {
    firstWordChunkIdx = Math.floor(wordsList[0].end / interval);
  }
  let chunkIndex = firstWordChunkIdx;
  let currentWords = [];
  wordsList.forEach((word) => {
    let wordChunkIdx = Math.floor(word.start / interval);
    const targetBoundary = (wordChunkIdx + 1) * interval;
    if (word.end > targetBoundary) {
      wordChunkIdx = Math.floor(word.end / interval);
    }
    if (wordChunkIdx > chunkIndex && currentWords.length > 0) {
      resultChunks.push({
        index: resultChunks.length + 1,
        start: chunkIndex * interval,
        end: (chunkIndex + 1) * interval,
        text: currentWords.join(" ")
      });
      currentWords = [];
      chunkIndex = wordChunkIdx;
    }
    if (currentWords.length === 0) {
      chunkIndex = wordChunkIdx;
    }
    currentWords.push(word.text);
  });
  if (currentWords.length > 0) {
    resultChunks.push({
      index: resultChunks.length + 1,
      start: chunkIndex * interval,
      end: (chunkIndex + 1) * interval,
      text: currentWords.join(" ")
    });
  }
  return resultChunks;
}
async function runTranscriptionOnFile(sourcePath, originalName, options) {
  const { language = "es", customLanguage = "", sentenceMode = "split-10-seconds", preservePunctuation = true } = options;
  const convertedRawPath = `${sourcePath}.raw`;
  try {
    const success = await convertToLinear16Raw(sourcePath, convertedRawPath);
    if (!success || !import_fs.default.existsSync(convertedRawPath)) {
      throw new Error("FFmpeg no pudo convertir el archivo de audio a PCM 16kHz.");
    }
    const audioBuffer = import_fs.default.readFileSync(convertedRawPath);
    const durationSeconds = audioBuffer.length / 32e3;
    let languageCode = "es-ES";
    if (language === "en") languageCode = "en-US";
    else if (language === "custom" && customLanguage) languageCode = customLanguage;
    let speechClient = null;
    try {
      const defaultJson = process.env.GOOGLE_APPLICATION_CREDENTIALS_JSON;
      if (defaultJson) {
        const credentials = JSON.parse(defaultJson);
        speechClient = new import_speech.default.SpeechClient({ credentials, fallback: "rest" });
      } else {
        const apiKey = process.env.GCP_API_KEY || process.env.GOOGLE_CLOUD_API_KEY || getSavedGeminiKey();
        speechClient = apiKey ? new import_speech.default.SpeechClient({ apiKey, fallback: "rest" }) : new import_speech.default.SpeechClient();
      }
    } catch (e) {
      console.warn("SpeechClient init warning:", e);
    }
    const audioConfig = {
      encoding: "LINEAR16",
      sampleRateHertz: 16e3,
      languageCode,
      enableWordTimeOffsets: true,
      enableAutomaticPunctuation: preservePunctuation !== false
    };
    const CHUNK_DURATION_SEC = 12;
    const OVERLAP_SEC = 2;
    const STEP_SEC = CHUNK_DURATION_SEC - OVERLAP_SEC;
    const BYTES_PER_SEC = 32e3;
    const STEP_BYTES = STEP_SEC * BYTES_PER_SEC;
    const CHUNK_SIZE_BYTES = CHUNK_DURATION_SEC * BYTES_PER_SEC;
    const chunksCount = Math.ceil(audioBuffer.length / STEP_BYTES);
    const sentences = [];
    let sentenceIndex = 1;
    for (let i = 0; i < chunksCount; i++) {
      const startByte = i * STEP_BYTES;
      const endByte = Math.min(startByte + CHUNK_SIZE_BYTES, audioBuffer.length);
      const chunkBuffer = audioBuffer.subarray(startByte, endByte);
      const audioContent = chunkBuffer.toString("base64");
      const chunkTimeOffset = i * STEP_SEC;
      let textResponse = null;
      if (speechClient) {
        const [response] = await speechClient.recognize({
          config: audioConfig,
          audio: { content: audioContent }
        });
        textResponse = response;
      }
      if (textResponse && textResponse.results) {
        for (const result of textResponse.results) {
          if (result.alternatives && result.alternatives.length > 0) {
            const alternative = result.alternatives[0];
            const words = alternative.words || [];
            let startSeconds = chunkTimeOffset;
            let endSeconds = chunkTimeOffset + 5;
            let validWords = [];
            let transcriptText = "";
            const isLastChunk = i === chunksCount - 1;
            if (words.length > 0) {
              validWords = words.filter((w) => {
                const wStart = parseTimeString(w.startTime) + chunkTimeOffset;
                return isLastChunk || wStart < chunkTimeOffset + STEP_SEC;
              });
              if (validWords.length === 0) continue;
              transcriptText = validWords.map((w) => w.word).join(" ");
              startSeconds = parseTimeString(validWords[0].startTime) + chunkTimeOffset;
              endSeconds = parseTimeString(validWords[validWords.length - 1].endTime) + chunkTimeOffset;
            } else {
              transcriptText = alternative.transcript ? alternative.transcript.trim() : "";
              if (!transcriptText) continue;
            }
            sentences.push({
              index: sentenceIndex++,
              start: Number(startSeconds),
              end: Number(endSeconds),
              text: transcriptText,
              words: validWords.map((w) => ({
                word: w.word,
                start: parseTimeString(w.startTime) + chunkTimeOffset,
                end: parseTimeString(w.endTime) + chunkTimeOffset
              }))
            });
          }
        }
      }
    }
    let finalSentences = sentences;
    if (sentenceMode === "split-10-seconds") {
      finalSentences = splitSegmentsIntoInterval(sentences, 10);
    } else if (sentenceMode === "split-8-seconds") {
      finalSentences = splitSegmentsIntoInterval(sentences, 8);
    } else if (sentenceMode === "split-4-seconds") {
      finalSentences = splitSegmentsIntoInterval(sentences, 4);
    }
    return {
      file_name: originalName,
      duration_seconds: durationSeconds,
      language: languageCode,
      sentences: finalSentences
    };
  } finally {
    if (import_fs.default.existsSync(convertedRawPath)) {
      try {
        import_fs.default.unlinkSync(convertedRawPath);
      } catch {
      }
    }
  }
}
app.post("/api/transcribe-process", async (req, res) => {
  const { uploadId, originalName, language, customLanguage, sentenceMode, preservePunctuation } = req.body;
  if (!uploadId) {
    res.status(400).json({ error: "Falta uploadId" });
    return;
  }
  const sourcePath = import_path.default.join(CHUNK_DIR, `${import_path.default.basename(uploadId)}`);
  if (!import_fs.default.existsSync(sourcePath)) {
    res.status(404).json({ error: "Archivo subido no encontrado." });
    return;
  }
  try {
    const result = await runTranscriptionOnFile(sourcePath, originalName || "audio.wav", {
      language,
      customLanguage,
      sentenceMode,
      preservePunctuation
    });
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err.message || "Error al extraer el timeline." });
  } finally {
    if (import_fs.default.existsSync(sourcePath)) {
      try {
        import_fs.default.unlinkSync(sourcePath);
      } catch {
      }
    }
  }
});
app.post("/api/transcribe-tts-file", async (req, res) => {
  const { filename, language = "es", sentenceMode = "split-10-seconds", preservePunctuation = true } = req.body;
  if (!filename) {
    res.status(400).json({ error: "Se requiere el nombre del archivo de audio de VoxFlow." });
    return;
  }
  const safeName = import_path.default.basename(filename);
  const sourcePath = import_path.default.join(TTS_DIR, safeName);
  if (!import_fs.default.existsSync(sourcePath)) {
    res.status(404).json({ error: "El archivo de audio no existe en la biblioteca local." });
    return;
  }
  try {
    const result = await runTranscriptionOnFile(sourcePath, safeName, {
      language,
      sentenceMode,
      preservePunctuation
    });
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err.message || "Error al extraer el timeline desde el audio de VoxFlow." });
  }
});
app.post("/api/ai/generate-stage", async (req, res) => {
  try {
    const { stageNumber, documentary, customInstruction } = req.body;
    const ai = getGeminiClient();
    if (!ai) {
      res.status(400).json({
        error: "No hay Gemini API Key activa. Config\xFArala en el bot\xF3n de llave superior."
      });
      return;
    }
    const doc = documentary || {};
    const clipDurationLabel = doc.clipDurationMode === "8_SEGUNDOS" ? "8 segundos" : "10 segundos";
    const is16x9 = doc.productionType === "DOCUMENTAL_16X9" || doc.productionType === "NOTEBOOKLM";
    const c1Dur = Number(doc.clip1DurationSeconds) || (doc.clip1SyncMode === "VOZ_EN_CLIP_2" ? 6 : 4);
    const voiceEntrySec = c1Dur + 2;
    const clip2StartSec = doc.clip1SyncMode === "RALENTIZAR_CAPCUT" ? c1Dur + 2 : c1Dur;
    const youtubeViralLink = (doc.promptConfig?.YOUTUBE_VIRAL_LINK || "").trim();
    const youtubeCommentsResearchBlock = (doc.promptConfig?.YOUTUBE_COMMENTS_RESEARCH_BLOCK || "").trim();
    const viralContextBlock = youtubeViralLink ? `
ENLACE DE VIDEO VIRAL DE YOUTUBE DE REFERENCIA: ${youtubeViralLink}
INSTRUCCI\xD3N OBLIGATORIA DE AN\xC1LISIS VIRAL: Analiza profunda, minuciosa, detallada, incisiva e intensamente, detalle por detalle y sin obviar nada, el video de YouTube en el enlace (${youtubeViralLink}) para entender c\xF3mo se hizo viral en la plataforma y RECREA EXACTAMENTE LA MISMA ESTRUCTURA GANADORA en este documental.
${youtubeCommentsResearchBlock ? `
${youtubeCommentsResearchBlock}
` : ""}` : youtubeCommentsResearchBlock ? `
${youtubeCommentsResearchBlock}
` : "";
    let stagePrompt = "";
    if (stageNumber === 2 || stageNumber === 3) {
      stagePrompt = `Act\xFAa como un historiador, director de cine, y periodista profesional para "Huellas de la Humanidad".${viralContextBlock}
Tema del documental: ${doc.topic || doc.title || "Por definir"}
Tipolog\xEDa: ${doc.typology || "Suceso hist\xF3rico"}
Tiempo hist\xF3rico: ${doc.historicalTime || "Por definir"}
Lugar hist\xF3rico: ${doc.historicalLocation || "Por definir"}
Duraci\xF3n aproximada objetivo: ~${doc.targetDurationSeconds || 120} segundos (la duraci\xF3n total no tiene que ser exacta al segundo, sino aproximada a la pedida).

Genera la ETAPA 3 completa:
1. Recuento estructural de secciones cronol\xF3gicas del documental.
2. Datos ins\xF3litos, curiosidades verificadas y contradicciones hist\xF3ricas centrales.
3. Prompt Maestro detallado para desarrollar Investigaci\xF3n Profunda (Deep Research / NotebookLM)${youtubeCommentsResearchBlock ? " \u2014 INCLUYENDO OBLIGATORIAMENTE DENTRO DE ESTE PROMPT DE INVESTIGACI\xD3N todas las preguntas, dudas, debates y sugerencias detectadas en los comentarios del video de referencia y del canal @huellas_de_la_humanidad para que la investigaci\xF3n profunda las responda exhaustivamente" : ""}.`;
    } else if (stageNumber === 4) {
      const introPlacement = doc.promptConfig?.UBICACION_INTRO_MARCA || "INTRO_INICIO_00";
      const FIXED_INTRO_SEC = 8;
      const FIXED_OUTRO_SEC = 8;
      const effectiveVoiceEntrySec = introPlacement === "INTRO_INICIO_00" ? voiceEntrySec + FIXED_INTRO_SEC : voiceEntrySec;
      const targetChars = Math.round(
        Math.max(10, (doc.targetDurationSeconds || 120) - FIXED_OUTRO_SEC - effectiveVoiceEntrySec) * 13.5
      );
      stagePrompt = `Act\xFAa como un historiador, director de cine, y periodista profesional para "Huellas de la Humanidad".
Tema: ${doc.topic || doc.title} (${doc.historicalTime}, ${doc.historicalLocation})
Estructura e Investigaci\xF3n previa:
${doc.sectionsStructure || ""}
${doc.deepResearchResult || ""}

Redacta la ETAPA 4: GUION DE LA VOZ EN OFF en espa\xF1ol neutro documental:
- Sincronizaci\xF3n de Entrada de Voz: ${introPlacement === "INTRO_INICIO_00" ? `El documental abre en 00:00 - 00:08 con el Intro Oficial de Marca de 8s (Intro.mp4), seguido por la ventana sin voz del Hook (${voiceEntrySec}s); por lo tanto, la voz narrativa entra obligatoriamente en el segundo ${effectiveVoiceEntrySec} del video.` : doc.clip1SyncMode === "VOZ_EN_CLIP_2" ? `El Clip 1 dura ${c1Dur}s (00:00 - 00:0${c1Dur}) sin voz y los primeros 2s del Clip 2 (00:0${c1Dur} - 00:0${voiceEntrySec}) tampoco llevan voz; por lo tanto, los primeros ${voiceEntrySec} segundos no llevan locuci\xF3n y la voz narrativa entra obligatoriamente en el segundo ${voiceEntrySec} del video (que es el segundo 2 del segundo clip).` : `El Clip 1 de ${c1Dur}s se ralentiza en edici\xF3n a ${voiceEntrySec}s (00:00 - 00:0${voiceEntrySec}) sin voz; la voz narrativa entra en el segundo ${voiceEntrySec} del video (al inicio del Clip 2).`}
- La duraci\xF3n total del guion NO tiene que ser exacta al segundo, sino APROXIMADA a la duraci\xF3n pedida (~${doc.targetDurationSeconds || 120}s).
- Comienza obligatoriamente con la tr\xEDada en la primera oraci\xF3n cerrada con punto: "A\xF1o [n\xFAmero en d\xEDgitos], [Lugar, Ciudad, Pa\xEDs]. [Premisa intrigante]." (Prohibido poner "en el" despu\xE9s del a\xF1o).
- A\xF1os siempre en d\xEDgitos, siglos y monarcas en n\xFAmeros romanos (ej. siglo XIX, Felipe II), miles con palabra "mil" (ej. "70 mil"), cero signos de exclamaci\xF3n.
- Incluye etiquetas de pausa estrat\xE9gicas como [pausa: 1.5s] o [pausa: 2s].
- Si es documental largo, incluye antes del segundo 30 el slogan en p\xE1rrafo aparte (P\xE1rrafo 2: "En los pr\xF3ximos minutos... Cada historia deja una huella. Aqu\xED seguimos sus rastros.")${introPlacement === "INTRO_POST_SLOGAN" ? ' e INMEDIATAMENTE al cerrar ese P\xE1rrafo 2 coloca OBLIGATORIAMENTE la etiqueta [pausa: 8s] para que durante esos 8 segundos exactos de silencio del narrador entre el Intro Oficial de Marca de 8s (Intro.mp4 \u2014 "Minimalismo en Piedra y Oro") antes del P\xE1rrafo 3' : ""}, y cierra el guion en p\xE1rrafo aparte con la llamada a comentarios y el lema: "Cada historia deja una huella. Aqu\xED seguimos sus rastros."
- Extensi\xF3n aproximada calibrada: ~${targetChars} caracteres.`;
    } else if (stageNumber === 5) {
      const thumbOrientation = doc.thumbnailOrientation || (doc.productionType === "REEL_9X16" ? "VERTICAL_9X16" : "HORIZONTAL_16X9");
      const isThumbHorizontal = thumbOrientation === "HORIZONTAL_16X9";
      const overlayText = (doc.thumbnailTextOverlay || "").trim() || "EL SECRETO OCULTO";
      const refsContext = Array.isArray(doc.references) ? doc.references.slice(0, 6).map((r) => `${r.tag}: ${r.prompt}`).join("\n") : "";
      const clipsContext = Array.isArray(doc.clips) ? doc.clips.slice(0, 6).map((c) => c.imagePrompt).filter(Boolean).join("\n") : "";
      stagePrompt = `Act\xFAa como dise\xF1ador experto en neuropsicolog\xEDa del clic (alto CTR en YouTube) para "Huellas de la Humanidad".
Tema / T\xEDtulo: ${doc.topic || doc.title} (${doc.historicalTime || doc.clip1Line1LocationTime || ""}, ${doc.historicalLocation || ""})
Gancho Clip 1: ${doc.clip1Line1LocationTime || ""} \u2014 ${doc.clip1Line2Hook || ""}
Guion REAL del documental (PRIORIDAD ABSOLUTA sobre cualquier t\xEDtulo provisional):
"""
${(doc.voiceoverScript || doc.sectionsStructure || "").slice(0, 1500)}
"""
Personajes y Lugares del documental (@Referencias):
${refsContext}
Primeras escenas visuales del documental (Clips):
${clipsContext}
Orientaci\xF3n seleccionada: ${isThumbHorizontal ? "HORIZONTAL (16:9)" : "VERTICAL (9:16)"}
Texto en pantalla obligatorio (Curiosity Gap): "${overlayText}"

REGLA CR\xCDTICA DE FIDELIDAD TEM\xC1TICA: Si el campo "T\xEDtulo" contiene el nombre de un video anterior o provisional (ej. "Video 75..."), IGN\xD3RALO y basa la escena visual de la miniatura 100% en el Guion REAL, los Personajes (@Referencias) y las escenas de los Clips de arriba.

APLICA OBLIGATORIAMENTE LOS 5 PRINCIPIOS NEUROPSICOL\xD3GICOS DEL CTR EN LA IMAGEN:
1. PROCESAMIENTO EN 13 MILISEGUNDOS (CERO RUIDO VISUAL): Composici\xF3n ultra-limpia de m\xE1ximo 3 elementos visuales (1 rostro dominante del protagonista real del guion en primer plano + 1 elemento detonante de peligro/misterio del guion + texto gancho), instant\xE1neamente legible en la pantalla diminuta de un tel\xE9fono m\xF3vil.
2. ROSTRO HUMANO + EMOCI\xD3N EXTREMA + CONTACTO VISUAL DIRECTO: El protagonista hist\xF3rico real del guion ocupa el 60% del encuadre en Medium Close-Up o Extreme Close-Up, mirando directamente al lente de la c\xE1mara ("direct piercing eye contact with the viewer"), con ojos muy abiertos mostrando la escler\xF3tica blanca, expresi\xF3n visceral intensa de shock, asombro, terror o traici\xF3n descubierta, textura real de poros, sudor o l\xE1grimas.
3. BRECHA DE LA CURIOSIDAD (CURIOSITY GAP): Muestra el segundo exacto antes del desastre o una contradicci\xF3n visual enigm\xE1tica del guion que obligue al cerebro del espectador a preguntarse "\xBFQu\xE9 acaba de pasar ah\xED?".
4. PSICOLOG\xCDA DEL COLOR Y ALTO CONTRASTE: Iluminaci\xF3n dram\xE1tica de claroscuro con luz clave c\xE1lida de alto impacto (oro ardiente, fuego carmes\xED o \xE1mbar intenso) sobre el rostro y luz de recorte (rim light) brillante que lo despega de un fondo oscuro saturado en tonos fr\xEDos (azul cian nocturno profundo o negro abismal).
5. POSICI\xD3N Y TEXTO EN PANTALLA OBLIGATORIO:
   ${isThumbHorizontal ? `Al ser HORIZONTAL (16:9), el texto en pantalla "${overlayText}" debe ir OBLIGATORIAMENTE ABAJO A LA IZQUIERDA: incluye textualmente 'bold high-contrast cinematic documentary typography text overlay positioned in the bottom-left area of the image reading "${overlayText}"'.` : `Al ser VERTICAL (9:16), el texto en pantalla "${overlayText}" debe ir OBLIGATORIAMENTE CENTRADO Y JUSTIFICADO EN EL MEDIO DE LA IMAGEN: incluye textualmente 'bold high-contrast cinematic documentary typography text overlay centered and middle-justified right in the middle center of the image reading "${overlayText}"'.`}
6. LOGO SUPERIOR DERECHO AL 5% EN DORADO:
   ${isThumbHorizontal ? `Al ser HORIZONTAL (16:9), el logo superior derecho es "8K": incluye textualmente 'a small discreet 5% scale logo in the top-right corner displaying "8K" in metallic gold'.` : `Al ser VERTICAL (9:16), el logo superior derecho es "HD": incluye textualmente 'a small discreet 5% scale logo in the top-right corner displaying "HD" in metallic gold'.`}
7. LOGO OFICIAL SUPERIOR IZQUIERDO AL 5% (IMAGEN DE REFERENCIA):
   Incluye textualmente: 'official page logo cleanly integrated in the top-left corner from provided reference image at 5% scale, strictly preserving and visibly rendering both the logo emblem and the exact text underneath it "Huellas de la Humanidad" without cropping, blurring, or omitting the sub-text'.
8. Cierra con: 'cinematic documentary realism, 8k resolution, sharp focus, safe framing composition, no modern objects, no CGI look, no unintended floating text, no music.'
Entrega \xFAnicamente el prompt en ingl\xE9s listo para copiar y pegar.`;
    } else if (stageNumber === 6) {
      stagePrompt = `Act\xFAa como un historiador y director de fotograf\xEDa para "Huellas de la Humanidad".
Basado en este guion de voz en off y tema (${doc.topic || doc.title}, ${doc.historicalTime}, ${doc.historicalLocation}):
"""
${doc.voiceoverScript || doc.sectionsStructure || ""}
"""
Genera la ETAPA 6: PROMPTS DE IM\xC1GENES MODELO DE REFERENCIA para Nano Banana 2.1:
- Antep\xF3n la orden: "Cambia los nombres y ponles @ seguido del nombre de la persona o lugar correspondiente."
- Lista cada personaje principal con @Nombre_Personaje y cada lugar principal (sin @ en lugares), y entrega su prompt en ingl\xE9s comenzando con "Create an image ..." incluyendo \xE9poca (${doc.historicalTime}) y lugar (${doc.historicalLocation}), fotorrealista cinematogr\xE1fico 8k, 'no text'.`;
    } else if (stageNumber === 7) {
      stagePrompt = `Act\xFAa como director creativo de "Huellas de la Humanidad".
Tema: ${doc.topic || doc.title} | Lugar: ${doc.historicalLocation} | Tiempo: ${doc.historicalTime}
T\xEDtulo del video: ${doc.title || ""}
Texto en pantalla de la Miniatura: ${doc.thumbnailTextOverlay || ""}
Guion: ${(doc.voiceoverScript || "").slice(0, 600)}
Prop\xF3n 3 opciones magn\xE9ticas para el TEXTO EN PANTALLA DEL CLIP 1 (Primeros ${voiceEntrySec}s del video):
L\xEDnea 1: [Ciudad, Pa\xEDs, A\xF1o XXXX (con la palabra "A\xF1o" delante del a\xF1o en d\xEDgitos) o Siglo XX (con "Siglo" con S may\xFAscula y n\xFAmeros romanos)] (ej. "Santander, Espa\xF1a, A\xF1o 1885" o "Par\xEDs, Francia, Siglo XIII")
L\xEDnea 2: [T\xEDtulo Gancho sugerente de lo que va a tratar el documental: intrigante a la vez que revelador del tema central. PROHIBIDO usar una frase suelta o abstracta que no sugiera directamente el tema del documental]
REGLA INQUEBRANTABLE DE NO REPETICI\xD3N: Lo que NO podemos hacer es repetir lo mismo entre la Miniatura, el T\xEDtulo del video y el Texto en pantalla en los primeros ${voiceEntrySec} segundos. Aseg\xFArate de que la L\xEDnea 2 (el gancho en pantalla de los primeros ${voiceEntrySec}s) sea distinta y NO repita lo mismo que el T\xEDtulo del video ni el Texto de la Miniatura, pero que s\xED revele e intrigue directamente sobre el tema central del documental.`;
    } else if (stageNumber === 8) {
      const opHeader = (doc.operationalHeader || DEFAULT_OPERATIONAL_HEADER_SERVER).trim();
      stagePrompt = `Act\xFAa como un historiador, director de cine, y periodista profesional.
Genera la ETAPA 8: PROMPTS DE IM\xC1GENES INICIALES (Nano Banana 2.1) Y CLIPS DE VIDEO (Veo 3.1 - Lite [Lower Priority]) para el documental "${doc.topic || doc.title}" (${doc.historicalTime}, ${doc.historicalLocation}).
Duraci\xF3n de cada clip a partir del Clip 2: ${clipDurationLabel}.
Sincronizaci\xF3n de Clip 1 y Entrada de Voz: ${doc.clip1SyncMode === "VOZ_EN_CLIP_2" ? `Clip 1 de 00:00 a 00:0${c1Dur} (${c1Dur}s sin voz). Clip 2 comienza en 00:0${clip2StartSec} y la voz narrativa entra en el segundo ${voiceEntrySec} del video (segundo 2 del Clip 2).` : `Clip 1 creado de ${c1Dur}s y ralentizado en CapCut a ${voiceEntrySec}s (00:00 - 00:0${voiceEntrySec} sin voz). Clip 2 comienza en 00:0${clip2StartSec} con la entrada de la voz.`}
Regla de Duraci\xF3n Aproximada: La duraci\xF3n total del video es aproximada a la pedida (~${doc.targetDurationSeconds || 120}s); todos los clips del 2 al final mantienen su duraci\xF3n est\xE1ndar de ${clipDurationLabel} sin forzar micro-clips de relleno de 2s o 4s al final.
Texto en pantalla Clip 1: ${doc.clip1Line1LocationTime} \u2014 ${doc.clip1Line2Hook}
Referencias creadas: ${(doc.references || []).map((r) => r.tag).join(", ")}

Timeline de la Voz Narrativa:
"""
${doc.timelineFormattedText || doc.voiceoverScript || ""}
"""

OBLIGACI\xD3N INQUEBRANTABLE DEL P\xC1RRAFO INICIAL DE 9 L\xCDNEAS:
Tu respuesta DEBE COMENZAR OBLIGATORIA Y LITERALMENTE con este p\xE1rrafo inicial de 9 l\xEDneas (sin omitir ninguna l\xEDnea) antes de "Image 1: Create an image":
${opHeader}

Inmediatamente despu\xE9s del p\xE1rrafo inicial de 9 l\xEDneas, entrega cada Clip (empezando por Clip 1 sin voz narrativa, y luego Clip 2 en adelante siguiendo el timeline) cumpliendo esta REGLA INQUEBRANTABLE DE SIMPLICIDAD, PRECISI\xD3N Y NO DUPLICACI\xD3N ENTRE CLIPS CONSECUTIVOS:
- REGLA INQUEBRANTABLE DE NO DUPLICACI\xD3N VISUAL ENTRE CLIPS CONTIGUOS (Clip [N] vs Clip [N+1]): Si la voz narrativa contin\xFAa en la misma escena, tema o hilo argumental por m\xE1s de un clip, los siguientes clips NO deben duplicarse visualmente bajo ning\xFAn concepto (queda terminantemente prohibido poner dos oficinas seguidas, dos escritorios o mostradores de madera con documentos/monedas seguidos, o la misma puesta en escena en dos clips consecutivos). Cada clip siguiente debe mostrar algo completamente diferente en entorno, iluminaci\xF3n y perspectiva pero visualmente referente a la locuci\xF3n (por ejemplo, si el Clip N es un interior oscuro en un escritorio, el Clip N+1 debe pasar a un exterior luminoso en el muelle frente al buque de vapor, una calle abierta o un plano radicalmente distinto).
- Image [N]: Concisa, directa y clara (~20 a 35 palabras), describiendo \xFAnicamente el sujeto/escena principal, \xE9poca y lugar (${doc.historicalTime}, ${doc.historicalLocation}), e iluminaci\xF3n, cerrando con "cinematic lighting, historical accuracy, no text."
- Clip [N] ([MM:SS - MM:SS]): Como la IA de video ya usa Image [N] como primer fotograma, NO repitas toda la descripci\xF3n de vestuario o arquitectura. Describe en UNA SOLA ORACI\xD3N SIMPLE Y DIRECTA (~12 a 22 palabras) \xFAnicamente UN movimiento de c\xE1mara suave (ej. slow zoom-in, panning slowly, gliding slowly, slow tilt-up) y UNA micro-acci\xF3n f\xEDsica natural sobre la imagen inicial, seguido de "Ambient Foley: [2-3 sonidos puntuales], single continuous shot, strictly no shot changes, no music, no speech, no text." ${doc.promptConfig?.VOZ_NARRATIVA_EN_CLIPS !== "EXCLUIR" ? "seguido de la oraci\xF3n de la voz narrativa correspondiente y" : "y"} cerrando con "fix the name".

Formato exacto de ejemplo:
Image [N]: Create an image of [escena clara con \xE9poca y lugar], cinematic lighting, historical accuracy, no text.

Clip [N] ([MM:SS - MM:SS]): Create a video showing [1 movimiento suave de c\xE1mara + 1 acci\xF3n f\xEDsica simple sobre la imagen inicial]. Ambient Foley: [sonidos puntuales], single continuous shot, strictly no shot changes, no music, no speech, no text. ${doc.promptConfig?.VOZ_NARRATIVA_EN_CLIPS !== "EXCLUIR" ? "[oraci\xF3n de la voz narrativa correspondiente]. " : ""}fix the name`;
    } else if (stageNumber === 10) {
      const parseMmSsToSec = (str) => {
        if (!str) return 0;
        const m = String(str).match(/(\d{1,3}):(\d{2})/);
        if (!m) return 0;
        return parseInt(m[1], 10) * 60 + parseInt(m[2], 10);
      };
      const formatSecToMmSs = (sec) => {
        const safe = Math.max(60, Math.round(sec));
        const mm = Math.floor(safe / 60);
        const ss = safe % 60;
        return `${String(mm).padStart(2, "0")}:${String(ss).padStart(2, "0")}`;
      };
      const stdClipSec = doc.clipDurationMode === "8_SEGUNDOS" ? 8 : 10;
      let lastClipEndSec = 0;
      if (Array.isArray(doc.clips) && doc.clips.length > 0) {
        for (const c of doc.clips) {
          const rangeParts = String(c.timeRange || "").split("-");
          const endPart = rangeParts[1] || rangeParts[0] || "";
          const endSec = parseMmSsToSec(endPart);
          if (endSec > lastClipEndSec) lastClipEndSec = endSec;
        }
        if (!lastClipEndSec) {
          lastClipEndSec = clip2StartSec + Math.max(0, doc.clips.length - 1) * stdClipSec;
        }
      }
      const voiceDurSec = Array.isArray(doc.audioTracks) && doc.audioTracks[0]?.duration ? Math.round(clip2StartSec + Number(doc.audioTracks[0].duration)) : 0;
      const confirmedSec = parseMmSsToSec(doc.confirmedFinalDuration);
      const totalDocSec = Math.max(
        lastClipEndSec,
        voiceDurSec,
        confirmedSec > 125 ? confirmedSec : 0,
        doc.targetDurationSeconds || 120
      );
      const resolvedFinalDuration = formatSecToMmSs(totalDocSec);
      const outroStartMmSs = formatSecToMmSs(Math.max(0, totalDocSec - 90));
      const minRecommendedTracks = totalDocSec >= 660 ? 6 : totalDocSec >= 420 ? 5 : totalDocSec >= 240 ? 4 : 3;
      const maxRecommendedTracks = totalDocSec >= 660 ? 8 : totalDocSec >= 420 ? 7 : totalDocSec >= 240 ? 5 : 4;
      const clipsVisualSummary = Array.isArray(doc.clips) && doc.clips.length > 0 ? doc.clips.filter(
        (_, idx, arr) => idx === 0 || idx === arr.length - 1 || idx % Math.max(1, Math.floor(arr.length / 18)) === 0
      ).map(
        (c) => `Clip ${c.clipNumber} (${c.timeRange || ""}): ${(c.imagePrompt || "").slice(0, 120)} | Voz: "${(c.narrationSegment || "").slice(0, 90)}"`
      ).join("\n") : "";
      stagePrompt = `Act\xFAa como compositor cinematogr\xE1fico maestro de "Huellas de la Humanidad" para **Google Flow Music (https://www.flowmusic.app/)**.
Tema: ${doc.topic || doc.title} (${doc.historicalTime || doc.historicalEra || ""}, ${doc.historicalLocation || doc.cityCountry || ""})
Duraci\xF3n total exacta del documental (calculada de la Voz Narrativa y el Timeline de Clips): ${resolvedFinalDuration} (${totalDocSec} segundos)
Guion / Estructura de escenas: ${(doc.voiceoverScript || doc.sectionsStructure || "").slice(0, 2400)}
${clipsVisualSummary ? `
Mapa de escenas visuales y clips:
${clipsVisualSummary}
` : ""}
Genera la **ETAPA 10: BANDA SONORA CINEMATOGR\xC1FICA MULTIESCENA PARA FLOW MUSIC (flowmusic.app)** cumpliendo estas REGLAS OBLIGATORIAS E INQUEBRANTABLES:
1. CANTIDAD DIN\xC1MICA DE CANCIONES SEG\xDAN LAS ESCENAS (${minRecommendedTracks} a ${maxRecommendedTracks} canciones): Dise\xF1a entre ${minRecommendedTracks} y ${maxRecommendedTracks} canciones instrumentales distintas acompa\xF1ando los cambios visuales de escena, giros de la trama y actos emocionales del documental.
2. SILENCIOS DRAM\xC1TICOS OBLIGATORIOS ENTRE CADA CANCI\xD3N (10 a 20 segundos):
   - Entre el final de una canci\xF3n y el inicio de la siguiente DEBE haber obligatoriamente un silencio musical de 10 a 20 segundos sin m\xFAsica, ubicado en un cambio de escena o pregunta ret\xF3rica donde solo se escuche la Voz Narrativa y el Foley ambiental.
   - En el campo "3. De d\xF3nde a d\xF3nde cubre en el video en tiempo", deja expl\xEDcito el rango exacto y los clips que cubre (ej. 00:00 - 02:16 (Clip 1 al Clip 15)).
3. LA \xDALTIMA CANCI\xD3N DEBE SER OBLIGATORIAMENTE DE SOLO 1:30 (01:30):
   - La \xDALTIMA canci\xF3n de la banda sonora tiene que durar OBLIGATORIA E INQUEBRANTABLEMENTE solo 1:30 (${outroStartMmSs} - ${resolvedFinalDuration}), cubriendo el \xFAltimo minuto y medio del documental.
4. FADE-IN, FADE-OUT Y VOLUMEN POR DEBAJO DE LA VOZ NARRATIVA (DUCKING DOCUMENTAL):
   - En cada "5. Prompt de Style" (en ingl\xE9s para Flow Music) incluye obligatoriamente: \`smooth 2.5-second fade-in intro, gentle 3-second fade-out outro, mixed as warm low-mid frequency documentary underscore designed to sit softly below a deep male narrator voice without competing in the 1kHz-4kHz vocal clarity range, 100% instrumental, strictly no vocals, no singing, no spoken words\`.
5. Entrega cada canci\xF3n con los 6 campos exactos en este orden:
1. T\xEDtulo: [T\xEDtulo evocador de la escena]
2. Duraci\xF3n: [Duraci\xF3n exacta en Flow Music; la \xFAltima canci\xF3n OBLIGATORIAMENTE 01:30]
3. De d\xF3nde a d\xF3nde cubre en el video en tiempo: [MM:SS - MM:SS (Clip X al Clip Y)]
4. Prompt de Lyrics: [Mapa instrumental en corchetes con [Soft 2.5s Fade-In Intro], [Warm Documentary Underscore Below Voice], [Gentle 3s Fade-Out Outro]]
5. Prompt de Style: [Prompt t\xE9cnico 100% en ingl\xE9s para Flow Music (flowmusic.app) con instrumentos aut\xE9nticos de la \xE9poca, fade-in intro, fade-out outro y mezcla c\xE1lida debajo de la voz narrativa, strictly instrumental only, no vocals, no singing, no speech, no lyrics]
6. Explicaci\xF3n de la Canci\xF3n: [Explicaci\xF3n de c\xF3mo suena, instrumentos, escenas que cubre y silencio dram\xE1tico de 10-20s previo]`;
    } else if (stageNumber === 101) {
      stagePrompt = `Act\xFAa como estratega de CTR y director creativo de miniaturas para el canal documental "Huellas de la Humanidad".
T\xEDtulo del video: ${doc.title || ""}
Texto en pantalla en los primeros ${voiceEntrySec} segundos (Clip 1): ${doc.clip1Line2Hook || ""}
Tema hist\xF3rico: ${doc.topic || doc.title || ""} (${doc.historicalTime || doc.clip1Line1LocationTime || ""}, ${doc.historicalLocation || ""})
Guion REAL del documental (PRIORIDAD ABSOLUTA sobre cualquier t\xEDtulo provisional):
"""
${(doc.voiceoverScript || doc.sectionsStructure || "").slice(0, 1500)}
"""

TAREA OBLIGATORIA:
Genera EXACTAMENTE 3 opciones de TEXTO EN PANTALLA para la miniatura oficial del video basadas 100% en el Guion REAL de arriba.
REGLAS INQUEBRANTABLES:
1. Cada opci\xF3n debe tener estrictamente de 1 a 3 palabras contundentes en ESPA\xD1OL y en MAY\xDASCULAS (ejemplo: EL PACTO OCULTO, TRAICI\xD3N REAL, LA NOCHE FINAL).
2. PROHIBICI\xD3N ESTRICTA DE REPETICI\xD3N ENTRE MINIATURA, T\xCDTULO Y TEXTO EN PANTALLA EN LOS PRIMEROS 8 SEGUNDOS: Lo que NO podemos hacer bajo ning\xFAn concepto es repetir lo mismo entre la Miniatura, el T\xEDtulo del video ("${doc.title || ""}") y el Texto en pantalla en los primeros ${voiceEntrySec} segundos ("${doc.clip1Line2Hook || ""}"). Cada opci\xF3n debe ser completamente distinta y complementarlos psicol\xF3gicamente sin repetir lo mismo.
3. Entrega \xDANICAMENTE las 3 opciones, una por l\xEDnea, sin numeraci\xF3n, sin vi\xF1etas, sin comillas y sin explicaciones adicionales.`;
    } else if (stageNumber === 11) {
      stagePrompt = `Act\xFAa como estratega jefe de publicaci\xF3n y SEO de "Huellas de la Humanidad".
Tema del documental: ${doc.topic || doc.title} (${doc.historicalTime || doc.historicalEra || ""}, ${doc.historicalLocation || doc.cityCountry || ""})
Duraci\xF3n final confirmada: ${doc.confirmedFinalDuration || "02:00"}
Texto en pantalla de la Miniatura: "${doc.thumbnailTextOverlay || ""}"
Texto en pantalla en los primeros ${voiceEntrySec} segundos (Clip 1): "${doc.clip1Line2Hook || ""}"
Guion REAL de referencia (PRIORIDAD ABSOLUTA para extraer la historia central y el T\xEDtulo espec\xEDfico): ${(doc.voiceoverScript || "").slice(0, 2e3)}

TAREA OBLIGATORIA: Genera de una sola vez las **4 SECCIONES INDEPENDIENTES DE PUBLICACI\xD3N** separadas EXACTAMENTE por estas 4 etiquetas en may\xFAsculas:

===SECCION_YOUTUBE===
[Entrega aqu\xED la METADATA DE YOUTUBE en formato "Todo Corrido" separada \xFAnicamente por l\xEDneas con car\xE1cter braille (\u2800): CERO encabezados excepto "Cap\xEDtulos:", ~3000 caracteres, T\xEDtulo directo ULTRA-ESPEC\xCDFICO, SUGERENTE y referente a la historia real narrada en el guion (prohibido t\xEDtulos vagos o gen\xE9ricos; debe nombrar expl\xEDcitamente el sujeto, colectivo, lugar o hecho hist\xF3rico concreto del guion unido a la revelaci\xF3n o drama central, con a\xF1os en d\xEDgitos y siglos/monarcas en n\xFAmeros romanos, sin repetir palabra por palabra la frase de la Miniatura ni del Hook del Clip 1), descripci\xF3n en EXACTAMENTE 3 P\xC1RRAFOS separados por l\xEDnea braille (\u2800), secci\xF3n "Cap\xEDtulos:" con 10 cap\xEDtulos cronol\xF3gicos donde 00:00 es parte de la historia, Nota IA: (Nota: Este documental inmersivo ha sido recreado utilizando herramientas de inteligencia artificial generativa bas\xE1ndonos estrictamente en registros hist\xF3ricos de la \xE9poca. Es posible que existan incongruencias o errores visuales)., Slogan: Cada historia deja una huella. Aqu\xED seguimos sus rastros., y 5 hashtags en espa\xF1ol en #CamelCase de DOS PALABRAS cada uno.]

===SECCION_FACEBOOK===
[Entrega aqu\xED la METADATA DE FACEBOOK en formato "Todo Corrido" separada \xFAnicamente por l\xEDneas con car\xE1cter braille (\u2800): CERO encabezados, SIN cap\xEDtulos y SIN tags SEO, ~3000 caracteres, T\xEDtulo directo ULTRA-ESPEC\xCDFICO, SUGERENTE y referente a la historia real narrada en el guion (sin repetir literalmente la Miniatura ni el Hook del Clip 1), descripci\xF3n en EXACTAMENTE 3 P\xC1RRAFOS separados por l\xEDnea braille (\u2800), Nota IA: (Nota: Este video inmersivo ha sido recreado utilizando herramientas de inteligencia artificial generativa bas\xE1ndonos estrictamente en registros hist\xF3ricos de la \xE9poca. Es posible que existan incongruencias o errores visuales)., Slogan: Cada historia deja una huella. Aqu\xED seguimos sus rastros., y 5 hashtags en espa\xF1ol en #CamelCase de DOS PALABRAS cada uno.]

===SECCION_COMENTARIO===
[Entrega aqu\xED EXCLUSIVAMENTE el COMENTARIO FIJADO DEL VIDEO sin encabezado ni comillas: reflexi\xF3n hist\xF3rica magn\xE9tica + pregunta/CTA natural para debatir, sin signos de exclamaci\xF3n (!), sin pedir like/suscribirse, a\xF1os en d\xEDgitos y siglos/monarcas en romanos.]

===SECCION_TAGS===
[Entrega aqu\xED EXCLUSIVAMENTE el bloque de TAGS SEO DE YOUTUBE separados por comas (~460 a 500 caracteres m\xE1ximo, sin encabezado "Tags:").]`;
    } else if (stageNumber === 111) {
      stagePrompt = `Act\xFAa como estratega de publicaci\xF3n de "Huellas de la Humanidad".
Tema: ${doc.topic || doc.title} (${doc.historicalTime || doc.historicalEra || ""}, ${doc.historicalLocation || doc.cityCountry || ""})
Duraci\xF3n final confirmada: ${doc.confirmedFinalDuration || "02:00"}
Plataforma: YOUTUBE
Texto en pantalla de la Miniatura: ${doc.thumbnailTextOverlay || ""}
Texto en pantalla en los primeros ${voiceEntrySec} segundos (Clip 1): ${doc.clip1Line2Hook || ""}
Guion REAL de referencia (PRIORIDAD ABSOLUTA para redactar un T\xEDtulo espec\xEDfico y fiel a la historia): ${(doc.voiceoverScript || "").slice(0, 1500)}

Genera la ETAPA 11: METADATA DE PUBLICACI\xD3N PARA YOUTUBE en formato "Todo Corrido" separada \xFAnicamente por l\xEDneas con car\xE1cter braille (\u2800), cumpliendo estas reglas inquebrantables:
1. CERO encabezados de secci\xF3n (prohibido "T\xEDtulo:", "Descripci\xF3n:", "Nota IA:", "Slogan:", "Hashtags:"), con la \xDANICA excepci\xF3n obligatoria del encabezado "Cap\xEDtulos:".
2. Extensi\xF3n de 3000 caracteres contando espacios y l\xEDneas braille (\u2800) desde el inicio del t\xEDtulo hasta el final de los 5 hashtags.
3. REGLA INQUEBRANTABLE DEL T\xCDTULO DEL VIDEO (ESPEC\xCDFICO, ALTAMENTE SUGERENTE Y FIEL A LA HISTORIA REAL DEL GUION):
   - PROHIBIDO T\xCDTULOS GEN\xC9RICOS, VAGOS O PO\xC9TICOS: Queda terminantemente prohibido usar frases abstractas o gen\xE9ricas que no revelen de qu\xE9 historia espec\xEDfica trata el video (ej. prohibido "El Precio del Destino", "Sombras entre Dos Orillas" o "As\xED Era Vivir en la Corte Real" sin nombrar al sujeto o suceso hist\xF3rico real).
   - F\xD3RMULA DE ESPECIFICIDAD HIST\xD3RICA + GANCHO MAGN\xC9TICO (ALTO CTR): El t\xEDtulo DEBE nombrar expl\xEDcitamente el sujeto, colectivo humano, lugar emblem\xE1tico o hecho hist\xF3rico concreto que protagoniza el Guion de referencia (con a\xF1os en d\xEDgitos y siglos/monarcas en n\xFAmeros romanos) UNIDO al conflicto, paradoja, sacrificio o revelaci\xF3n m\xE1s impactante que transmite la historia.
   - NO REPETICI\xD3N BIEN APLICADA: No copies palabra por palabra la frase exacta de la Miniatura ("${doc.thumbnailTextOverlay || ""}") ni la del Texto en pantalla en los primeros ${voiceEntrySec} segundos ("${doc.clip1Line2Hook || ""}"), pero S\xCD es obligatorio mencionar el tema, lugar o protagonista hist\xF3rico real del guion para que el espectador entienda al instante qu\xE9 historia espec\xEDfica va a descubrir.
4. LIBERTAD EN EL RESTO DE LA METADATA Y DESCRIPCI\xD3N EN 3 P\xC1RRAFOS:
   - En lo dem\xE1s de la metadata (los 3 p\xE1rrafos de la descripci\xF3n, cap\xEDtulos, etc.) NO importa que se repitan algunas palabras del guion o del tema.
   - La descripci\xF3n debe estar dividida obligatoriamente en EXACTAMENTE 3 P\xC1RRAFOS separados por l\xEDnea con car\xE1cter braille (\u2800).
5. Secci\xF3n obligatoria "Cap\xEDtulos:" con 10 cap\xEDtulos cronol\xF3gicos (donde 00:00 es parte directa de la historia, NUNCA poner "Pr\xF3logo" ni "Introducci\xF3n").
6. Nota IA oficial: (Nota: Este documental inmersivo ha sido recreado utilizando herramientas de inteligencia artificial generativa bas\xE1ndonos estrictamente en registros hist\xF3ricos de la \xE9poca. Es posible que existan incongruencias o errores visuales).
7. Slogan oficial: Cada historia deja una huella. Aqu\xED seguimos sus rastros.
8. Exactamente 5 hashtags en espa\xF1ol en #CamelCase compuestos obligatoriamente por DOS PALABRAS cada uno (concluyendo aqu\xED el bloque para copiar directo en la descripci\xF3n de YouTube, ya que los Tags y el Comentario Fijado tienen sus propias secciones dedicadas).`;
    } else if (stageNumber === 112) {
      stagePrompt = `Act\xFAa como estratega de publicaci\xF3n de "Huellas de la Humanidad".
Tema: ${doc.topic || doc.title} (${doc.historicalTime || doc.historicalEra || ""}, ${doc.historicalLocation || doc.cityCountry || ""})
Duraci\xF3n final confirmada: ${doc.confirmedFinalDuration || "02:00"}
Plataforma: FACEBOOK
Texto en pantalla de la Miniatura: ${doc.thumbnailTextOverlay || ""}
Texto en pantalla en los primeros ${voiceEntrySec} segundos (Clip 1): ${doc.clip1Line2Hook || ""}
Guion REAL de referencia (PRIORIDAD ABSOLUTA para redactar un T\xEDtulo espec\xEDfico y fiel a la historia): ${(doc.voiceoverScript || "").slice(0, 1500)}

Genera la ETAPA 11: METADATA DE PUBLICACI\xD3N PARA FACEBOOK en formato "Todo Corrido" separada \xFAnicamente por l\xEDneas con car\xE1cter braille (\u2800), cumpliendo estas reglas inquebrantables:
1. CERO encabezados de secci\xF3n en toda la entrega (prohibido "T\xEDtulo:", "Descripci\xF3n:", "Nota IA:", "Slogan:", "Hashtags:").
2. SIN secci\xF3n de Cap\xEDtulos y SIN bloque de Tags SEO (estrictamente prohibido incluir cap\xEDtulos o tags en Facebook).
3. Extensi\xF3n de 3000 caracteres contando espacios y l\xEDneas braille (\u2800) medidos desde el inicio del t\xEDtulo hasta el final de los 5 hashtags.
4. REGLA INQUEBRANTABLE DEL T\xCDTULO DEL VIDEO (ESPEC\xCDFICO, ALTAMENTE SUGERENTE Y FIEL A LA HISTORIA REAL DEL GUION):
   - PROHIBIDO T\xCDTULOS GEN\xC9RICOS, VAGOS O PO\xC9TICOS: Queda terminantemente prohibido usar frases abstractas o gen\xE9ricas que no revelen de qu\xE9 historia espec\xEDfica trata el video.
   - F\xD3RMULA DE ESPECIFICIDAD HIST\xD3RICA + GANCHO MAGN\xC9TICO: El t\xEDtulo DEBE nombrar expl\xEDcitamente el sujeto, colectivo humano, lugar emblem\xE1tico o hecho hist\xF3rico concreto que protagoniza el Guion de referencia (con a\xF1os en d\xEDgitos y siglos/monarcas en n\xFAmeros romanos) UNIDO al conflicto, paradoja, sacrificio o revelaci\xF3n m\xE1s impactante que transmite la historia.
   - NO REPETICI\xD3N BIEN APLICADA: No copies palabra por palabra la frase exacta de la Miniatura ("${doc.thumbnailTextOverlay || ""}") ni la del Texto en pantalla en los primeros ${voiceEntrySec} segundos ("${doc.clip1Line2Hook || ""}"), pero S\xCD menciona directamente el tema, lugar o protagonista hist\xF3rico real del guion.
5. LIBERTAD EN EL RESTO DE LA METADATA Y DESCRIPCI\xD3N EN 3 P\xC1RRAFOS:
   - En lo dem\xE1s de la metadata (los 3 p\xE1rrafos de la descripci\xF3n, etc.) NO importa que se repitan algunas palabras del guion o del tema.
   - La descripci\xF3n debe estar dividida obligatoriamente en EXACTAMENTE 3 P\xC1RRAFOS separados por l\xEDnea con car\xE1cter braille (\u2800).
6. Nota IA oficial: (Nota: Este video inmersivo ha sido recreado utilizando herramientas de inteligencia artificial generativa bas\xE1ndonos estrictamente en registros hist\xF3ricos de la \xE9poca. Es posible que existan incongruencias o errores visuales).
7. Slogan oficial: Cada historia deja una huella. Aqu\xED seguimos sus rastros.
8. Exactamente 5 hashtags en espa\xF1ol en #CamelCase compuestos obligatoriamente por DOS PALABRAS cada uno (concluyendo aqu\xED el bloque para copiar directo en Facebook, ya que el Comentario Fijado tiene su propia secci\xF3n dedicada).`;
    } else if (stageNumber === 113) {
      stagePrompt = `Act\xFAa como estratega de comunidad y retenci\xF3n de "Huellas de la Humanidad".
Tema del video: ${doc.topic || doc.title} (${doc.historicalTime || doc.historicalEra || ""}, ${doc.historicalLocation || doc.cityCountry || ""})
Guion / Contexto: ${(doc.voiceoverScript || doc.sectionsStructure || "").slice(0, 1200)}

Genera EXCLUSIVAMENTE el COMENTARIO FIJADO DEL VIDEO cumpliendo estas reglas inquebrantables:
1. Entrega el texto directo sin ning\xFAn encabezado ni etiqueta (prohibido poner "Comentario Fijado:" o comillas).
2. Formula una reflexi\xF3n hist\xF3rica magn\xE9tica seguida de un llamado a la acci\xF3n (CTA) natural que invite a la audiencia a debatir, opinar o compartir una experiencia/vivencia vinculada al hecho hist\xF3rico.
3. Queda terminantemente prohibido pedir gen\xE9ricamente "dale like" o "suscr\xEDbete", y prohibido usar signos de exclamaci\xF3n (!).
4. Escribe todos los a\xF1os en d\xEDgitos y los siglos/nombres con n\xFAmero en n\xFAmeros romanos.`;
    } else if (stageNumber === 114) {
      stagePrompt = `Act\xFAa como especialista en SEO de YouTube para "Huellas de la Humanidad".
Tema del video: ${doc.topic || doc.title} (${doc.historicalTime || doc.historicalEra || ""}, ${doc.historicalLocation || doc.cityCountry || ""})
Guion / Contexto: ${(doc.voiceoverScript || doc.sectionsStructure || "").slice(0, 1200)}

Genera EXCLUSIVAMENTE el bloque de TAGS SEO DE YOUTUBE cumpliendo estas reglas inquebrantables:
1. Entrega \xDANICAMENTE las etiquetas separadas por comas, en un solo bloque continuo, sin ning\xFAn encabezado (prohibido poner "Tags:" o "Tags SEO:").
2. La longitud total del bloque debe ser de aproximadamente 460 a 500 caracteres contando espacios y comas (nunca superar los 500 caracteres).
3. Incluye palabras clave de alto volumen de b\xFAsqueda en espa\xF1ol sobre el tema hist\xF3rico, personajes, \xE9poca, lugar y documentales de historia.`;
    } else if (stageNumber === 115) {
      stagePrompt = `Act\xFAa como director editorial y estratega de alto CTR en YouTube y Facebook para "Huellas de la Humanidad".
Tema del documental: ${doc.topic || doc.title} (${doc.historicalTime || doc.historicalEra || ""}, ${doc.historicalLocation || doc.cityCountry || ""})
Guion REAL del documental:
"""
${(doc.voiceoverScript || doc.sectionsStructure || "").slice(0, 2200)}
"""
Genera EXACTAMENTE 5 opciones de T\xCDTULOS PARA EL VIDEO que sean ULTRA-ESPEC\xCDFICOS, SUGERENTES, MAGN\xC9TICOS y directamente referentes a la historia central que se transmite en el guion (nombrando expl\xEDcitamente el hecho hist\xF3rico, colectivo o protagonista real unido a su conflicto o revelaci\xF3n m\xE1s impactante, con a\xF1os en d\xEDgitos y siglos/monarcas en n\xFAmeros romanos). Entrega \xFAnicamente los 5 t\xEDtulos, uno por l\xEDnea, sin numeraci\xF3n ni comillas.`;
    }
    if (customInstruction) {
      stagePrompt += `

Instrucci\xF3n adicional del director: ${customInstruction}`;
    }
    const models = [
      "gemini-3.1-pro-preview",
      "gemini-3.6-flash",
      "gemini-3-flash-preview",
      "gemini-2.5-flash",
      "gemini-2.5-flash-lite"
    ];
    let outputText = "";
    let lastError = null;
    for (const m of models) {
      try {
        const resp = await ai.models.generateContent({
          model: m,
          contents: [{ role: "user", parts: [{ text: stagePrompt }] }]
        });
        if (resp.text) {
          outputText = resp.text;
          break;
        }
      } catch (e) {
        lastError = e;
      }
    }
    if (!outputText) {
      throw new Error(lastError?.message || "No se pudo generar respuesta con Gemini.");
    }
    if (stageNumber === 8) {
      outputText = ensureOperationalHeaderText(outputText, doc.operationalHeader);
    }
    res.json({ text: outputText });
  } catch (err) {
    res.status(500).json({ error: err.message || "Error al generar etapa con IA." });
  }
});
app.post("/api/ai/generate-thumbnail-image", async (req, res) => {
  try {
    const { prompt, logoDataUrl } = req.body || {};
    const ai = getGeminiClient();
    if (!ai) {
      res.status(400).json({
        error: "No hay Gemini API Key activa en el servidor."
      });
      return;
    }
    const cleanPrompt = String(prompt || "").replace(/^Thumbnail\s*:\s*/i, "").trim();
    if (!cleanPrompt) {
      res.status(400).json({ error: "El prompt de la miniatura est\xE1 vac\xEDo." });
      return;
    }
    const parts = [];
    if (logoDataUrl && typeof logoDataUrl === "string") {
      if (logoDataUrl.startsWith("data:")) {
        const match = logoDataUrl.match(/^data:([^;]+);base64,(.+)$/);
        if (match && match[1] && match[2]) {
          parts.push({
            inlineData: {
              mimeType: match[1],
              data: match[2]
            }
          });
        }
      } else if (logoDataUrl.startsWith("/assets/")) {
        const localAssetPath = import_path.default.join(ASSETS_DIR, import_path.default.basename(logoDataUrl));
        if (import_fs.default.existsSync(localAssetPath)) {
          const buf = import_fs.default.readFileSync(localAssetPath);
          const ext = import_path.default.extname(localAssetPath).toLowerCase();
          const mime = ext === ".webp" ? "image/webp" : ext === ".jpg" || ext === ".jpeg" ? "image/jpeg" : "image/png";
          parts.push({
            inlineData: {
              mimeType: mime,
              data: buf.toString("base64")
            }
          });
        }
      }
    }
    parts.push({ text: cleanPrompt });
    const response = await ai.models.generateContent({
      model: "gemini-2.5-flash-image",
      contents: [{ role: "user", parts }],
      config: {
        responseModalities: ["TEXT", "IMAGE"]
      }
    });
    const candidateParts = response?.candidates?.[0]?.content?.parts || [];
    const imgPart = candidateParts.find((p) => p?.inlineData?.data);
    if (!imgPart || !imgPart.inlineData?.data) {
      res.status(500).json({
        error: "Nano Banana (gemini-2.5-flash-image) no devolvi\xF3 imagen en este intento."
      });
      return;
    }
    const mimeType = imgPart.inlineData.mimeType || "image/png";
    const imageDataUrl = `data:${mimeType};base64,${imgPart.inlineData.data}`;
    res.json({ ok: true, imageDataUrl });
  } catch (err) {
    console.error("[Thumbnail Image Gen Error]:", err);
    res.status(500).json({
      error: err?.message || "Error generando imagen de miniatura con Nano Banana."
    });
  }
});
app.post("/api/ai/audit-clips", async (req, res) => {
  try {
    const { documentary } = req.body;
    const ai = getGeminiClient();
    if (!ai) {
      res.status(400).json({
        error: "No hay Gemini API Key activa. Config\xFArala en el bot\xF3n de llave superior."
      });
      return;
    }
    const doc = documentary || {};
    const clipsList = Array.isArray(doc.clips) ? doc.clips : [];
    if (clipsList.length === 0) {
      res.status(400).json({ error: "No hay clips cargados para auditar." });
      return;
    }
    const includeVoiceInClips = doc.promptConfig?.VOZ_NARRATIVA_EN_CLIPS !== "EXCLUIR";
    const auditPrompt = `Act\xFAa como Director de Cine, Historiador y Supervisor de Continuidad de "Huellas de la Humanidad".
Tu tarea es auditar la coherencia entre:
1) La VOZ NARRATIVA RAW CON PAUSAS:
"""
${doc.voiceoverScript || ""}
"""

2) La VOZ NARRATIVA CON TIMESTAMPS (Narration Timeline Extractor):
"""
${doc.timelineFormattedText || ""}
"""

3) Los CLIPS ACTUALES DEL DOCUMENTAL (Tema: "${doc.topic || doc.title}", \xC9poca: "${doc.historicalTime}", Lugar: "${doc.historicalLocation}"):
${JSON.stringify(
      clipsList.map((c) => ({
        clipNumber: c.clipNumber,
        timeRange: c.timeRange,
        narrationSegment: c.narrationSegment,
        pauseNotes: c.pauseNotes,
        imagePrompt: c.imagePrompt,
        videoPrompt: c.videoPrompt
      })),
      null,
      2
    )}

REGLAS DE AUDITOR\xCDA CLIP POR CLIP:
- Para el Clip 1 (00:00 - 00:04 / 00:06): Es el Hook visual sin voz narrativa, con audio Foley. Verifica que sea impactante y acorde al tema.
- Para cada Clip del 2 en adelante:
  1. Revisa si lo que describe el Prompt de Imagen Inicial (Image N) y el Prompt de Video (Clip N) HACE SENTIDO VISUAL Y NARRATIVO con lo que dice exactamente la voz narrativa ("narrationSegment") en ese intervalo de tiempo ("timeRange").
  2. PROHIBICI\xD3N DE DUPLICACI\xD3N ENTRE CLIPS CONSECUTIVOS (Clip N vs Clip N-1): Si la voz narrativa contin\xFAa en la misma escena o hilo argumental por m\xE1s de un clip, el Clip [N] NO debe duplicar visualmente la misma puesta en escena del Clip [N-1] (ej. prohibido encadenar dos escenas seguidas de escritorio/mostrador de madera en una oficina con documentos, o dos habitaciones iguales seguidas). Si el Clip [N] repite un escenario o composici\xF3n similar al Clip [N-1], m\xE1rcalo como "warning" o "mismatch" y prop\xF3n en "suggestedImagePrompt" y "suggestedVideoPrompt" una escena visualmente diferente pero referente a la locuci\xF3n (ej. pasar de un interior de oficina a un exterior luminoso en un muelle frente a un buque de vapor, o cambiar radicalmente de entorno y escala).
  3. Si la voz narrativa habla de una cosa (ej. el interior de un laboratorio o un documento espec\xEDfico, o la mesa del historiador cuando dice el slogan inicial "En los pr\xF3ximos minutos...") pero el prompt del clip muestra otra cosa desconectada o repetitiva, m\xE1rcalo como "mismatch" o "warning".
  4. Revisa las pausas ([pausa: Xs]): Si a mitad del clip la voz narrativa hace una pausa y cambia a otra escena distinta, sugiere en "suggestedVideoPrompt" usar 2 shots de 5 segundos ("two-shot sequence of 5 seconds each: Shot 1 [0s-5s]...; Shot 2 [5s-10s]: clean cinematic cut at second 5 to..."). En caso contrario, mant\xE9n 1 solo shot continuo ("single continuous shot, strictly no shot changes").
  5. Si el clip tiene prompts vac\xEDos, sobrecargados o mejorables, redacta "suggestedImagePrompt" (iniciando con "Image [N]: Create an image of ...", conciso de ~20-35 palabras con \xE9poca, lugar, sujeto claro y cerrando con "cinematic lighting, historical accuracy, no text.") y "suggestedVideoPrompt" (iniciando con "Clip [N] ([timeRange]): Create a video showing ...", manteniendo el prompt de video MUY SIMPLE Y DIRECTO: 1 sola oraci\xF3n corta con 1 movimiento de c\xE1mara + 1 micro-acci\xF3n f\xEDsica sobre la imagen inicial para que la IA generadora de clips no cometa errores, seguido de "Ambient Foley: [2-3 sonidos], single continuous shot, strictly no shot changes, no music, no speech, no text.", ${includeVoiceInClips ? "la oraci\xF3n de la voz narrativa sin comillas ni par\xE9ntesis," : ""} y terminando con "fix the name").
  6. Si el clip ya es coherente y cumple todas las reglas, pon auditStatus: "ok", explica brevemente por qu\xE9 encaja bien en "auditReason", y deja "suggestedImagePrompt" y "suggestedVideoPrompt" vac\xEDos ("").

Devuelve EXCLUSIVAMENTE un objeto JSON v\xE1lido con la propiedad "audits" (array):
{
  "summary": "Resumen general en espa\xF1ol de la revisi\xF3n del timeline",
  "audits": [
    {
      "clipNumber": 1,
      "auditStatus": "ok" | "warning" | "mismatch",
      "auditReason": "Explicaci\xF3n clara en espa\xF1ol de si el clip hace sentido con la voz narrativa o qu\xE9 cambio se sugiere",
      "suggestedImagePrompt": "Image N: Create an image ... (solo si requiere cambio o estaba vac\xEDo, sino string vac\xEDo)",
      "suggestedVideoPrompt": "Clip N (MM:SS - MM:SS): Create a video ... fix the name (solo si requiere cambio o estaba vac\xEDo, sino string vac\xEDo)"
    }
  ]
}`;
    const models = [
      "gemini-3.1-pro-preview",
      "gemini-3.6-flash",
      "gemini-3-flash-preview",
      "gemini-2.5-flash"
    ];
    let responseText = "";
    let lastErr = null;
    for (const m of models) {
      try {
        const resp = await ai.models.generateContent({
          model: m,
          contents: [{ role: "user", parts: [{ text: auditPrompt }] }],
          config: {
            responseMimeType: "application/json"
          }
        });
        if (resp.text) {
          responseText = resp.text;
          break;
        }
      } catch (e) {
        lastErr = e;
      }
    }
    if (!responseText) {
      throw new Error(lastErr?.message || "No se recibi\xF3 respuesta del modelo al auditar los clips.");
    }
    const parsed = JSON.parse(responseText.trim());
    res.json(parsed);
  } catch (err) {
    console.error("Error en /api/ai/audit-clips:", err);
    res.status(500).json({ error: err.message || "Error al auditar coherencia de los clips." });
  }
});
app.post("/api/ai/audit-clip-video", async (req, res) => {
  try {
    const { documentary, clip, frames, attempt } = req.body;
    const ai = getGeminiClient();
    if (!ai) {
      res.status(400).json({
        error: "No hay Gemini API Key activa. Config\xFArala en el bot\xF3n de llave superior."
      });
      return;
    }
    const doc = documentary || {};
    const clipObj = clip || {};
    const frameList = Array.isArray(frames) ? frames : [];
    if (frameList.length === 0) {
      res.status(400).json({ error: "No se recibieron fotogramas del video para auditar." });
      return;
    }
    const includeVoiceInClips = doc.promptConfig?.VOZ_NARRATIVA_EN_CLIPS !== "EXCLUIR";
    const promptText = `Act\xFAa como Director de Cine, Historiador y Supervisor de Control de Calidad Visual de "Huellas de la Humanidad".
Acabas de recibir ${frameList.length} fotogramas reales (inicio, mitad y final) del video reci\xE9n generado en Google Flow para el Clip #${clipObj.clipNumber || 1} (Intento #${attempt || 1}).

CONTEXTO DEL DOCUMENTAL:
- T\xEDtulo / Tema: ${doc.topic || doc.title || ""}
- \xC9poca Hist\xF3rica: ${doc.historicalTime || ""}
- Lugar Hist\xF3rico: ${doc.historicalLocation || ""}

DATOS DEL CLIP #${clipObj.clipNumber || 1} (${clipObj.timeRange || ""}):
- Voz Narrativa en este clip: "${Number(clipObj.clipNumber) === 1 ? "[Clip 1 Hook inicial sin voz \u2014 Solo Foley y Texto en pantalla: " + (doc.clip1Line1LocationTime || "") + " / " + (doc.clip1Line2Hook || "") + "]" : clipObj.narrationSegment || ""}"
- Prompt de Imagen Inicial: ${clipObj.imagePrompt || ""}
- Prompt de Video enviado a Google Flow: ${clipObj.videoPrompt || ""}

TU TAREA DE AUDITOR\xCDA VISUAL (VIDEO REAL vs PROMPT vs VOZ NARRATIVA):
Observa detenidamente los fotogramas reales adjuntos y eval\xFAa:
1. COHERENCIA CON LA VOZ NARRATIVA: \xBFLo que se ve en el video acompa\xF1a y tiene sentido directo con lo que dice la Voz Narrativa en este segmento?
2. CUMPLIMIENTO DEL PROMPT E HISTORIA: \xBFSe respeta la \xE9poca hist\xF3rica (${doc.historicalTime || ""}), escenario y acci\xF3n principal del prompt?
3. CALIDAD VISUAL Y LIBRE DE ERRORES IA: \xBFEst\xE1 libre de deformaciones graves (caras/manos monstruosas), anacronismos modernos evidentes, pantallas en negro o texto basura quemado?

CRITERIO DE VEREDICTO:
- "approved": El video se ve bien, encaja con la voz narrativa y con el prompt (score >= 75).
- "warning": El video es utilizable pero tiene un detalle menor (score 60-74).
- "rejected": El video NO coincide con la voz narrativa, ignor\xF3 el prompt, tiene errores visuales graves o anacronismos (score < 60). Si es "rejected", redacta obligatoriamente en "fixedVideoPrompt" un prompt de video corregido, m\xE1s claro y directo para Google Flow iniciando con "Clip ${clipObj.clipNumber || 1} (${clipObj.timeRange || "00:00 - 00:10"}): Create a video showing ..." ${includeVoiceInClips && Number(clipObj.clipNumber) > 1 && clipObj.narrationSegment ? `incluyendo la oraci\xF3n narrativa "${clipObj.narrationSegment}" ` : ""}y cerrando con "fix the name".

Devuelve EXCLUSIVAMENTE un objeto JSON v\xE1lido:
{
  "clipNumber": ${Number(clipObj.clipNumber) || 1},
  "verdict": "approved" | "warning" | "rejected",
  "score": 90,
  "narrationMatch": true,
  "promptMatch": true,
  "visualQualityOk": true,
  "auditReason": "Explicaci\xF3n concisa en espa\xF1ol de lo que se ve en el video y por qu\xE9 aprueba o falla frente a la voz narrativa y el prompt",
  "issues": ["Lista de fallos si los hay"],
  "fixedVideoPrompt": "Prompt corregido listo para re-enviar a Google Flow si verdict es rejected, o string vac\xEDo si aprob\xF3"
}`;
    const parts = [{ text: promptText }];
    for (const frame of frameList.slice(0, 4)) {
      const cleanBase64 = String(frame).replace(/^data:[^;]+;base64,/, "");
      if (cleanBase64) {
        parts.push({
          inlineData: {
            data: cleanBase64,
            mimeType: "image/jpeg"
          }
        });
      }
    }
    const models = [
      "gemini-3.6-flash",
      "gemini-3-flash-preview",
      "gemini-2.5-flash",
      "gemini-3.1-pro-preview"
    ];
    let responseText = "";
    let lastErr = null;
    for (const m of models) {
      try {
        const resp = await ai.models.generateContent({
          model: m,
          contents: [{ role: "user", parts }],
          config: {
            responseMimeType: "application/json"
          }
        });
        if (resp.text) {
          responseText = resp.text;
          break;
        }
      } catch (e) {
        lastErr = e;
      }
    }
    if (!responseText) {
      throw new Error(lastErr?.message || "No se recibi\xF3 respuesta del modelo al auditar el video.");
    }
    const parsed = JSON.parse(responseText.trim());
    res.json(parsed);
  } catch (err) {
    console.error("Error en /api/ai/audit-clip-video:", err);
    res.status(500).json({ error: err.message || "Error al auditar visualmente el video del clip." });
  }
});
app.post("/api/system/pick-folder", async (_req, res) => {
  try {
    const { execFile: execFile2 } = await import("child_process");
    execFile2(
      "osascript",
      [
        "-e",
        'POSIX path of (choose folder with prompt "Selecciona la carpeta donde Huellas Master descargar\xE1 autom\xE1ticamente los videos aprobados de Google Flow:")'
      ],
      (err, stdout) => {
        if (err) {
          res.status(400).json({ cancelled: true, error: "Selecci\xF3n de carpeta cancelada." });
          return;
        }
        const folderPath = (stdout || "").trim();
        res.json({ ok: true, folderPath });
      }
    );
  } catch (err) {
    res.status(500).json({ error: err.message || "No se pudo abrir el selector de carpetas." });
  }
});
function resolveSubfolderForDocumentaryAsset(fileName, explicitSubFolder) {
  if (explicitSubFolder && explicitSubFolder.trim()) {
    return import_path.default.basename(explicitSubFolder.trim());
  }
  const clean = import_path.default.basename(fileName);
  if (/^Miniatura_|^Logo_|miniatura/i.test(clean)) return "03_Miniaturas";
  if (/\.(mp3|wav|m4a|ogg)$/i.test(clean)) return "02_Audio";
  if (/^@|^Ref_|referencia/i.test(clean)) return "04_Referencias";
  if (/^(?:0*\d+[_\-\s.]|clip[_\-\s.]*0*\d+)/i.test(clean) && /\.(mp4|webm|mov)$/i.test(clean)) {
    return "05_Clips_Video";
  }
  if (/^Documental_|_Master|_Final/i.test(clean) && /\.mp4$/i.test(clean)) {
    return "06_Video_Final";
  }
  if (/\.(mp4|webm|mov)$/i.test(clean) || /_(Inicio|Fin)\.(png|jpg|jpeg|webp)$/i.test(clean)) {
    return "05_Clips_Video";
  }
  if (/\.(srt|txt|json|md)$/i.test(clean)) return "01_Guion_y_SEO";
  return "03_Miniaturas";
}
function ensureDocumentarySubfolders(rootFolderPath) {
  const subfolders = [
    "01_Guion_y_SEO",
    "02_Audio",
    "03_Miniaturas",
    "04_Referencias",
    "05_Clips_Video",
    "06_Video_Final"
  ];
  if (!import_fs.default.existsSync(rootFolderPath)) {
    import_fs.default.mkdirSync(rootFolderPath, { recursive: true });
  }
  for (const sf of subfolders) {
    const p = import_path.default.join(rootFolderPath, sf);
    if (!import_fs.default.existsSync(p)) {
      import_fs.default.mkdirSync(p, { recursive: true });
    }
  }
}
function resolveFfmpegBin() {
  const candidates = ["/usr/local/bin/ffmpeg", "/opt/homebrew/bin/ffmpeg", import_ffmpeg_static.default || "ffmpeg"];
  for (const c of candidates) {
    try {
      if (c && (c === "ffmpeg" || import_fs.default.existsSync(c))) return c;
    } catch {
    }
  }
  return "ffmpeg";
}
async function upscaleMp4BufferTo4K(inputBuffer) {
  const tmpDir = import_os.default.tmpdir();
  const stamp = `${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  const inPath = import_path.default.join(tmpDir, `huellas_in_${stamp}.mp4`);
  const outPath = import_path.default.join(tmpDir, `huellas_4k_${stamp}.mp4`);
  const ffmpegBin = resolveFfmpegBin();
  const vfFilter = "scale=3840:2160:flags=lanczos+accurate_rnd+full_chroma_int,unsharp=5:5:0.85:3:3:0.35";
  try {
    import_fs.default.writeFileSync(inPath, inputBuffer);
    const runFfmpeg = (args) => new Promise((resolve, reject) => {
      const proc = (0, import_child_process.spawn)(ffmpegBin, args, { stdio: "ignore" });
      proc.on("error", reject);
      proc.on("close", (code) => {
        if (code === 0 && import_fs.default.existsSync(outPath) && import_fs.default.statSync(outPath).size > 1e4) {
          resolve();
        } else {
          reject(new Error(`ffmpeg exited with code ${code}`));
        }
      });
    });
    try {
      await runFfmpeg([
        "-y",
        "-i",
        inPath,
        "-t",
        "10.5",
        "-r",
        "24",
        "-vf",
        vfFilter,
        "-c:v",
        "h264_videotoolbox",
        "-b:v",
        "28M",
        "-profile:v",
        "high",
        "-pix_fmt",
        "yuv420p",
        "-movflags",
        "+faststart",
        "-c:a",
        "copy",
        outPath
      ]);
    } catch {
      await runFfmpeg([
        "-y",
        "-i",
        inPath,
        "-t",
        "10.5",
        "-r",
        "24",
        "-vf",
        vfFilter,
        "-c:v",
        "libx264",
        "-preset",
        "veryfast",
        "-crf",
        "16",
        "-pix_fmt",
        "yuv420p",
        "-movflags",
        "+faststart",
        "-c:a",
        "copy",
        outPath
      ]);
    }
    return import_fs.default.readFileSync(outPath);
  } catch (err) {
    console.warn("[4K Upscale] Usando buffer original por fallo en ffmpeg:", err);
    return inputBuffer;
  } finally {
    try {
      if (import_fs.default.existsSync(inPath)) import_fs.default.unlinkSync(inPath);
    } catch {
    }
    try {
      if (import_fs.default.existsSync(outPath)) import_fs.default.unlinkSync(outPath);
    } catch {
    }
  }
}
app.post("/api/flow/upscale-clip-4k", async (req, res) => {
  try {
    const { videoDataUrl } = req.body;
    if (!videoDataUrl || typeof videoDataUrl !== "string") {
      res.status(400).json({ error: "Falta videoDataUrl para escalar a 4K." });
      return;
    }
    const cleanBase64 = videoDataUrl.replace(/^data:[^;]+;base64,/, "");
    const rawBuffer = Buffer.from(cleanBase64, "base64");
    const upscaledBuffer = await upscaleMp4BufferTo4K(rawBuffer);
    const outDataUrl = `data:video/mp4;base64,${upscaledBuffer.toString("base64")}`;
    res.json({
      ok: true,
      videoDataUrl: outDataUrl,
      width: 3840,
      height: 2160,
      bytes: upscaledBuffer.length
    });
  } catch (err) {
    console.error("[4K Upscale Endpoint Error]:", err);
    res.status(500).json({ error: err.message || "Error al escalar clip a 4K." });
  }
});
app.post("/api/flow/save-video-to-folder", async (req, res) => {
  try {
    const { folderPath = "", folderName = "", docTitle = "", fileName, videoDataUrl, subFolder } = req.body || {};
    const resolvedRoot = (folderPath && String(folderPath).trim() && import_fs.default.existsSync(String(folderPath).trim()) ? String(folderPath).trim() : "") || resolveLocalDocumentaryFolder(folderPath, folderName, docTitle);
    if (!resolvedRoot || !fileName || !videoDataUrl) {
      res.status(400).json({ error: "Faltan par\xE1metros para guardar el video." });
      return;
    }
    let safeName = import_path.default.basename(String(fileName).replace(/[^a-zA-Z0-9._-]/g, "_"));
    ensureDocumentarySubfolders(resolvedRoot);
    const resolvedSub = resolveSubfolderForDocumentaryAsset(safeName, subFolder || "05_Clips_Video");
    const targetDir = import_path.default.join(resolvedRoot, resolvedSub);
    if (!import_fs.default.existsSync(targetDir)) {
      import_fs.default.mkdirSync(targetDir, { recursive: true });
    }
    const isClipVideo = resolvedSub === "05_Clips_Video" && /\.mp4$/i.test(safeName);
    if (isClipVideo && !/[_\-]4k\.mp4$/i.test(safeName)) {
      safeName = safeName.replace(/\.mp4$/i, "_4K.mp4");
    }
    const fullTarget = import_path.default.join(targetDir, safeName);
    const cleanBase64 = String(videoDataUrl).replace(/^data:[^;]+;base64,/, "");
    const rawBuffer = Buffer.from(cleanBase64, "base64");
    const finalBuffer = isClipVideo ? await upscaleMp4BufferTo4K(rawBuffer) : rawBuffer;
    import_fs.default.writeFileSync(fullTarget, finalBuffer);
    try {
      (0, import_child_process.execSync)(`chflags nohidden "${fullTarget.replace(/"/g, '\\"')}"`, { stdio: "ignore" });
    } catch {
    }
    if (isClipVideo) {
      const mClip = safeName.match(/^0*(\d+)_/);
      if (mClip) {
        const paddedNum = String(parseInt(mClip[1], 10)).padStart(2, "0");
        const prefix = `${paddedNum}_`;
        for (const entry of import_fs.default.readdirSync(targetDir)) {
          if (entry !== safeName && entry.startsWith(prefix) && /\.(mp4|mov|webm)$/i.test(entry) && !/^0*\d+_Imagen_Inicial/i.test(entry)) {
            try {
              import_fs.default.unlinkSync(import_path.default.join(targetDir, entry));
            } catch {
            }
          }
        }
        for (const cacheSub of [".optical_flow_cache", ".foley_only_cache", ".vocals_clean_cache", ".music_clean_cache"]) {
          const cacheDir = import_path.default.join(targetDir, cacheSub);
          if (import_fs.default.existsSync(cacheDir)) {
            for (const cEntry of import_fs.default.readdirSync(cacheDir)) {
              if (cEntry.startsWith(prefix)) {
                try {
                  import_fs.default.unlinkSync(import_path.default.join(cacheDir, cEntry));
                } catch {
                }
              }
            }
          }
        }
        const baseNo4k = import_path.default.basename(safeName, import_path.default.extname(safeName)).replace(/[_\-]4k$/i, "");
        const suffixWithoutNum = baseNo4k.replace(/^0*\d+_/, "");
        const frameFileName = `${paddedNum}_Imagen_Inicial_${suffixWithoutNum}.jpg`;
        const frameFullPath = import_path.default.join(targetDir, frameFileName);
        try {
          const ffmpegBin = getFfmpegPath();
          await new Promise((resolve) => {
            const proc = (0, import_child_process.spawn)(
              ffmpegBin,
              ["-y", "-i", fullTarget, "-frames:v", "1", "-q:v", "2", frameFullPath],
              { stdio: "ignore" }
            );
            proc.on("error", () => resolve());
            proc.on("close", () => resolve());
          });
          if (import_fs.default.existsSync(frameFullPath)) {
            (0, import_child_process.execSync)(`chflags nohidden "${frameFullPath.replace(/"/g, '\\"')}"`, { stdio: "ignore" });
          }
        } catch {
        }
      }
    }
    const savedSt = import_fs.default.statSync(fullTarget);
    res.json({
      ok: true,
      savedPath: fullTarget,
      subFolder: resolvedSub,
      fileName: safeName,
      bytes: finalBuffer.length,
      resolution: "3840x2160",
      url: `/api/flow/serve-folder-file?filePath=${encodeURIComponent(fullTarget)}&v=${Math.floor(savedSt.mtimeMs)}`
    });
  } catch (err) {
    console.error("Error guardando video en carpeta elegida:", err);
    res.status(500).json({ error: err.message || "Error guardando el archivo MP4." });
  }
});
app.post("/api/flow/save-asset-to-folder", async (req, res) => {
  try {
    const { folderPath = "", folderName = "", docTitle = "", fileName, dataUrl, subFolder } = req.body || {};
    const resolvedRoot = (folderPath && String(folderPath).trim() && import_fs.default.existsSync(String(folderPath).trim()) ? String(folderPath).trim() : "") || resolveLocalDocumentaryFolder(folderPath, folderName, docTitle);
    if (!resolvedRoot || !fileName || !dataUrl) {
      res.status(400).json({ error: "Faltan par\xE1metros para guardar el archivo." });
      return;
    }
    let safeName = import_path.default.basename(String(fileName).replace(/[^a-zA-Z0-9._@-]/g, "_"));
    if (/^suno[_\-\s]*0*\d+\.(mp3|wav|m4a|ogg)$/i.test(safeName)) {
      res.json({ ok: true, skippedLegacySuno: true, fileName: safeName });
      return;
    }
    ensureDocumentarySubfolders(resolvedRoot);
    const resolvedSub = resolveSubfolderForDocumentaryAsset(safeName, subFolder);
    const targetDir = import_path.default.join(resolvedRoot, resolvedSub);
    if (!import_fs.default.existsSync(targetDir)) {
      import_fs.default.mkdirSync(targetDir, { recursive: true });
    }
    const isClipVideo = resolvedSub === "05_Clips_Video" && /\.(mp4|mov|webm)$/i.test(safeName);
    if (isClipVideo && !/[_\-]4k\.(mp4|mov|webm)$/i.test(safeName)) {
      safeName = safeName.replace(/\.(mp4|mov|webm)$/i, "_4K.mp4");
    }
    const fullTarget = import_path.default.join(targetDir, safeName);
    const cleanBase64 = String(dataUrl).replace(/^data:[^;]+;base64,/, "");
    const rawBuffer = Buffer.from(cleanBase64, "base64");
    const finalBuffer = isClipVideo ? await upscaleMp4BufferTo4K(rawBuffer) : rawBuffer;
    import_fs.default.writeFileSync(fullTarget, finalBuffer);
    try {
      (0, import_child_process.execSync)(`chflags nohidden "${fullTarget.replace(/"/g, '\\"')}"`, { stdio: "ignore" });
    } catch {
    }
    let frameUrl = "";
    if (isClipVideo) {
      const mClip = safeName.match(/^0*(\d+)_/);
      if (mClip) {
        const paddedNum = String(parseInt(mClip[1], 10)).padStart(2, "0");
        const prefix = `${paddedNum}_`;
        for (const entry of import_fs.default.readdirSync(targetDir)) {
          if (entry !== safeName && entry.startsWith(prefix) && /\.(mp4|mov|webm)$/i.test(entry) && !/^0*\d+_Imagen_Inicial/i.test(entry)) {
            try {
              import_fs.default.unlinkSync(import_path.default.join(targetDir, entry));
            } catch {
            }
          }
        }
        for (const cacheSub of [".optical_flow_cache", ".foley_only_cache", ".vocals_clean_cache", ".music_clean_cache"]) {
          const cacheDir = import_path.default.join(targetDir, cacheSub);
          if (import_fs.default.existsSync(cacheDir)) {
            for (const cEntry of import_fs.default.readdirSync(cacheDir)) {
              if (cEntry.startsWith(prefix)) {
                try {
                  import_fs.default.unlinkSync(import_path.default.join(cacheDir, cEntry));
                } catch {
                }
              }
            }
          }
        }
        const baseNo4k = import_path.default.basename(safeName, import_path.default.extname(safeName)).replace(/[_\-]4k$/i, "");
        const suffixWithoutNum = baseNo4k.replace(/^0*\d+_/, "");
        const frameFileName = `${paddedNum}_Imagen_Inicial_${suffixWithoutNum}.jpg`;
        const frameFullPath = import_path.default.join(targetDir, frameFileName);
        try {
          const ffmpegBin = getFfmpegPath();
          await new Promise((resolve) => {
            const proc = (0, import_child_process.spawn)(
              ffmpegBin,
              ["-y", "-i", fullTarget, "-frames:v", "1", "-q:v", "2", frameFullPath],
              { stdio: "ignore" }
            );
            proc.on("error", () => resolve());
            proc.on("close", () => resolve());
          });
          if (import_fs.default.existsSync(frameFullPath)) {
            (0, import_child_process.execSync)(`chflags nohidden "${frameFullPath.replace(/"/g, '\\"')}"`, { stdio: "ignore" });
            const fst = import_fs.default.statSync(frameFullPath);
            frameUrl = `/api/flow/serve-folder-file?filePath=${encodeURIComponent(frameFullPath)}&v=${Math.floor(fst.mtimeMs)}`;
          }
        } catch {
        }
      }
    }
    const savedSt = import_fs.default.statSync(fullTarget);
    res.json({
      ok: true,
      savedPath: fullTarget,
      subFolder: resolvedSub,
      fileName: safeName,
      bytes: finalBuffer.length,
      url: `/api/flow/serve-folder-file?filePath=${encodeURIComponent(fullTarget)}&v=${Math.floor(savedSt.mtimeMs)}`,
      frameUrl
    });
  } catch (err) {
    res.status(500).json({ error: err.message || "Error guardando activo en carpeta." });
  }
});
app.post("/api/project/export-organized-package", async (req, res) => {
  try {
    const {
      folderPath,
      docTitle,
      seoText,
      scriptText,
      srtText,
      rawClipsText,
      pinnedCommentText,
      thumbnailPromptsText,
      voiceoverDataUrl,
      sunoTracks,
      thumbnails
    } = req.body;
    if (!folderPath || !String(folderPath).trim()) {
      res.status(400).json({ error: "Se requiere folderPath para exportar en servidor." });
      return;
    }
    const targetRoot = String(folderPath).trim();
    ensureDocumentarySubfolders(targetRoot);
    const seoDir = import_path.default.join(targetRoot, "01_Guion_y_SEO");
    const audioDir = import_path.default.join(targetRoot, "02_Audio");
    const thumbsDir = import_path.default.join(targetRoot, "03_Miniaturas");
    const savedFiles = [];
    if (srtText) {
      const srtPath = import_path.default.join(seoDir, "Subtitulos.srt");
      import_fs.default.writeFileSync(srtPath, String(srtText), "utf8");
      savedFiles.push("01_Guion_y_SEO/Subtitulos.srt");
    }
    if (scriptText) {
      const scriptPath = import_path.default.join(seoDir, "Guion_Master.txt");
      import_fs.default.writeFileSync(scriptPath, String(scriptText), "utf8");
      savedFiles.push("01_Guion_y_SEO/Guion_Master.txt");
    }
    if (rawClipsText) {
      const clipsTxtPath = import_path.default.join(seoDir, "Prompts_Clips_Flow.txt");
      import_fs.default.writeFileSync(clipsTxtPath, String(rawClipsText), "utf8");
      savedFiles.push("01_Guion_y_SEO/Prompts_Clips_Flow.txt");
    }
    const seoPackageContent = [
      "========================================================================",
      `HUELLAS DE LA HUMANIDAD \u2014 PAQUETE DE PUBLICACI\xD3N YOUTUBE / REELS`,
      `PROYECTO: ${docTitle || "Documental"}`,
      `FECHA: ${(/* @__PURE__ */ new Date()).toLocaleString("es-ES")}`,
      "========================================================================\n",
      "--- 1. T\xCDTULOS, DESCRIPCI\xD3N CON CAP\xCDTULOS (00:00) Y TAGS SEO (ETAPA 4) ---\n",
      seoText || "(Pendiente de generar Etapa 4)",
      "\n\n--- 2. COMENTARIO FIJADO PARA DEBATE EN YOUTUBE (ETAPA 9) ---\n",
      pinnedCommentText || "(Pendiente de generar Etapa 9)",
      "\n\n--- 3. PROMPTS DE MINIATURAS A/B TESTING (ETAPA 5) ---\n",
      thumbnailPromptsText || "(Pendiente de generar Etapa 5)",
      "\n"
    ].join("\n");
    const seoPath = import_path.default.join(seoDir, "SEO_YouTube_Copiar_Pegar.txt");
    import_fs.default.writeFileSync(seoPath, seoPackageContent, "utf8");
    savedFiles.push("01_Guion_y_SEO/SEO_YouTube_Copiar_Pegar.txt");
    if (voiceoverDataUrl && String(voiceoverDataUrl).startsWith("data:")) {
      const cleanB64 = String(voiceoverDataUrl).replace(/^data:[^;]+;base64,/, "");
      const voPath = import_path.default.join(audioDir, "Voz_Narrativa.mp3");
      import_fs.default.writeFileSync(voPath, Buffer.from(cleanB64, "base64"));
      savedFiles.push("02_Audio/Voz_Narrativa.mp3");
    }
    if (Array.isArray(sunoTracks)) {
      for (let i = 0; i < sunoTracks.length; i++) {
        const st = sunoTracks[i];
        if (st && st.audioDataUrl && String(st.audioDataUrl).startsWith("data:")) {
          const cleanB64 = String(st.audioDataUrl).replace(/^data:[^;]+;base64,/, "");
          const name = st.fileName || `FlowMusic_${String(i + 1).padStart(2, "0")}.mp3`;
          const stPath = import_path.default.join(audioDir, import_path.default.basename(name));
          import_fs.default.writeFileSync(stPath, Buffer.from(cleanB64, "base64"));
          savedFiles.push(`02_Audio/${import_path.default.basename(name)}`);
        }
      }
    }
    if (Array.isArray(thumbnails)) {
      for (const th of thumbnails) {
        if (th && th.imageDataUrl && String(th.imageDataUrl).startsWith("data:")) {
          const cleanB64 = String(th.imageDataUrl).replace(/^data:[^;]+;base64,/, "");
          const name = th.fileName || `Miniatura_Opcion_${th.option || "A"}.png`;
          const thPath = import_path.default.join(thumbsDir, import_path.default.basename(name));
          import_fs.default.writeFileSync(thPath, Buffer.from(cleanB64, "base64"));
          savedFiles.push(`03_Miniaturas/${import_path.default.basename(name)}`);
        }
      }
    }
    res.json({
      ok: true,
      folderPath: targetRoot,
      savedFiles
    });
  } catch (err) {
    console.error("Error exportando paquete organizado:", err);
    res.status(500).json({ error: err.message || "Error creando paquete organizado." });
  }
});
var activeRenderJobState = {
  running: false,
  progressPct: 0,
  currentStep: 0,
  totalSteps: 0,
  stageLabel: "",
  startedAt: 0
};
app.get("/api/editor/render-status", (_req, res) => {
  res.json({ ok: true, ...activeRenderJobState });
});
app.post("/api/editor/render-ffmpeg", async (req, res) => {
  const startedAt = Date.now();
  const workDir = import_path.default.join(import_os.default.tmpdir(), `huellas_ffmpeg_render_${startedAt}`);
  try {
    const {
      folderPath,
      folderName = "",
      docTitle,
      aspectRatio = "16:9",
      resolution = "HD_1080P",
      fps = 30,
      bitrateMbps = 0,
      clips = [],
      voiceoverStartSec = 6,
      voiceoverVolume = 1,
      voiceoverGainDb = 5,
      voiceoverDataUrl = "",
      sunoSilenceGapSec = 15,
      sunoMasterVolume = 0.14,
      musicTracks = [],
      srtContent = "",
      overlays = {}
    } = req.body;
    const resolvedDocFolder = resolveLocalDocumentaryFolder(folderPath, folderName, docTitle);
    const targetRoot = resolvedDocFolder || (folderPath && String(folderPath).trim() ? String(folderPath).trim() : import_path.default.join(process.env.HOME || "/tmp", "Downloads"));
    if (!import_fs.default.existsSync(targetRoot)) {
      import_fs.default.mkdirSync(targetRoot, { recursive: true });
    }
    if (!import_fs.default.existsSync(workDir)) {
      import_fs.default.mkdirSync(workDir, { recursive: true });
    }
    if (process.platform === "darwin" && targetRoot.includes("com~apple~CloudDocs")) {
      try {
        const dfOut = (0, import_child_process.execSync)("df -k /", { encoding: "utf8" });
        const dfLines = dfOut.trim().split("\n");
        const cols = (dfLines[1] || "").trim().split(/\s+/);
        const availKb = parseInt(cols[3] || "0", 10);
        const availGb = availKb / (1024 * 1024);
        if (availGb > 0 && availGb < 45) {
          const parentDir = import_path.default.dirname(targetRoot);
          const channelRootDir = import_path.default.dirname(parentDir);
          const candidateParentDirs = Array.from(
            /* @__PURE__ */ new Set([
              parentDir,
              import_path.default.join(channelRootDir, "Videos"),
              import_path.default.join(channelRootDir, "Reels")
            ])
          );
          const currentResolved = import_path.default.resolve(targetRoot).normalize("NFC");
          for (const dirToScan of candidateParentDirs) {
            if (!import_fs.default.existsSync(dirToScan)) continue;
            const siblings = import_fs.default.readdirSync(dirToScan, { withFileTypes: true });
            for (const sib of siblings) {
              if (!sib.isDirectory()) continue;
              const sibPath = import_path.default.join(dirToScan, sib.name);
              if (import_path.default.resolve(sibPath).normalize("NFC") === currentResolved) continue;
              try {
                (0, import_child_process.execSync)(`brctl evict "${sibPath.replace(/"/g, '\\"')}"`, {
                  stdio: "ignore",
                  timeout: 8e3
                });
              } catch {
              }
            }
          }
        }
      } catch {
      }
    }
    const resMap = {
      HD_1080P: { w169: 1920, h169: 1080, label: "HD_1080p", defaultBitrateMbps: 18 },
      "2K_1440P": { w169: 2560, h169: 1440, label: "2K_1440p", defaultBitrateMbps: 35 },
      "4K_2160P": { w169: 3840, h169: 2160, label: "4K_2160p", defaultBitrateMbps: 65 },
      "8K_4320P": { w169: 7680, h169: 4320, label: "8K_4320p", defaultBitrateMbps: 140 }
    };
    const preset = resMap[resolution] || resMap.HD_1080P;
    const isIntelMac = (import_os.default.cpus()[0]?.model || "").includes("Intel");
    const rawOutW = aspectRatio === "9:16" ? preset.h169 : preset.w169;
    const rawOutH = aspectRatio === "9:16" ? preset.w169 : preset.h169;
    const outW = isIntelMac && rawOutW > 3840 ? aspectRatio === "9:16" ? 2160 : 3840 : rawOutW;
    const outH = isIntelMac && rawOutH > 3840 ? aspectRatio === "9:16" ? 3840 : 2160 : rawOutH;
    const safeFps = [24, 25, 30, 50, 60].includes(Number(fps)) ? Number(fps) : 30;
    const safeBitrateMbps = Math.max(
      4,
      Math.min(350, Number(bitrateMbps) > 0 ? Number(bitrateMbps) : preset.defaultBitrateMbps)
    );
    const is8K = outW > 4096 || outH > 4096;
    const ffmpegBin = getFfmpegPath();
    activeRenderJobState = {
      running: true,
      progressPct: 2,
      currentStep: 0,
      totalSteps: Math.max(1, clips.length),
      stageLabel: `Preparando capas visuales y ${clips.length} segmentos en ${preset.label} (${safeFps} FPS \u2022 ${safeBitrateMbps} Mbps)...`,
      startedAt
    };
    let logoOverlayInfo = null;
    if (overlays?.burnInLogo !== false) {
      let logoDataUrl = overlays?.logo?.pngDataUrl || "";
      if (!logoDataUrl && import_fs.default.existsSync(OFFICIAL_LOGO_FILE)) {
        try {
          const parsedLogo = JSON.parse(import_fs.default.readFileSync(OFFICIAL_LOGO_FILE, "utf8"));
          logoDataUrl = parsedLogo.logoDataUrl || "";
        } catch {
        }
      }
      const defaultLogoW = aspectRatio === "9:16" || outH > outW ? 12 : 6;
      const defaultLogoX = aspectRatio === "9:16" || outH > outW ? 10 : 3;
      const wPct = Math.max(1, Math.min(45, Number(overlays?.logo?.wPct ?? defaultLogoW)));
      const xPct = Math.max(0, Math.min(95, Number(overlays?.logo?.xPct ?? defaultLogoX)));
      const yPct = Math.max(0, Math.min(95, Number(overlays?.logo?.yPct ?? 3)));
      let rawLogoPath = "";
      if (logoDataUrl && String(logoDataUrl).startsWith("data:")) {
        const cleanB64 = String(logoDataUrl).replace(/^data:[^;]+;base64,/, "");
        const logoFile = import_path.default.join(workDir, "overlay_logo.png");
        import_fs.default.writeFileSync(logoFile, Buffer.from(cleanB64, "base64"));
        rawLogoPath = logoFile;
      } else {
        const diskLogoCandidate = import_path.default.join(
          targetRoot,
          "03_Miniaturas",
          "Logo_Huellas_de_la_Humanidad.png"
        );
        const masterLogoCandidate = "/Users/raydelsantana/Library/Mobile Documents/com~apple~CloudDocs/0YouTube/Huellas de la Humanidad/LOGO DEFINITIVO.png";
        if (import_fs.default.existsSync(diskLogoCandidate)) {
          rawLogoPath = diskLogoCandidate;
        } else if (import_fs.default.existsSync(masterLogoCandidate)) {
          rawLogoPath = masterLogoCandidate;
        }
      }
      if (rawLogoPath && import_fs.default.existsSync(rawLogoPath)) {
        const targetLogoW = Math.max(24, Math.round(outW * wPct / 100));
        const prescaledLogoPath = import_path.default.join(workDir, "overlay_logo_scaled.png");
        try {
          (0, import_child_process.execSync)(
            `"${ffmpegBin}" -y -i "${rawLogoPath.replace(/"/g, '\\"')}" -vf "scale=${targetLogoW}:-1" "${prescaledLogoPath.replace(/"/g, '\\"')}"`,
            { stdio: "ignore" }
          );
        } catch {
        }
        logoOverlayInfo = {
          filePath: import_fs.default.existsSync(prescaledLogoPath) ? prescaledLogoPath : rawLogoPath,
          wPx: targetLogoW,
          xPx: Math.round(outW * xPct / 100),
          yPx: Math.round(outH * yPct / 100)
        };
      }
    }
    const hookOverlayFiles = [];
    if (overlays?.burnInHook !== false && Array.isArray(overlays?.hookSegments)) {
      for (let hi = 0; hi < overlays.hookSegments.length; hi++) {
        const hs = overlays.hookSegments[hi];
        if (!hs || !hs.pngDataUrl || !String(hs.pngDataUrl).startsWith("data:")) continue;
        const cleanB64 = String(hs.pngDataUrl).replace(/^data:[^;]+;base64,/, "");
        const hf = import_path.default.join(workDir, `overlay_hook_${hi}.png`);
        import_fs.default.writeFileSync(hf, Buffer.from(cleanB64, "base64"));
        const yPct = Math.max(0, Math.min(95, Number(hs.yPct ?? 30)));
        const hPct = Math.max(4, Math.min(100, Number(hs.hPct ?? 40)));
        hookOverlayFiles.push({
          filePath: hf,
          startSec: Number(hs.startSec || 0),
          endSec: Number(hs.endSec || 0),
          yPx: Math.round(outH * yPct / 100),
          hPx: Math.max(24, Math.round(outH * hPct / 100))
        });
      }
    }
    const captionOverlayFiles = [];
    if (overlays?.burnInCaptions !== false && Array.isArray(overlays?.captionSegments) && overlays.captionSegments.length > 0 && overlays.captionSegments.length <= 40) {
      for (let ci = 0; ci < overlays.captionSegments.length; ci++) {
        const cs = overlays.captionSegments[ci];
        if (!cs || !cs.pngDataUrl || !String(cs.pngDataUrl).startsWith("data:")) continue;
        const cleanB64 = String(cs.pngDataUrl).replace(/^data:[^;]+;base64,/, "");
        const cf = import_path.default.join(workDir, `overlay_cap_${String(ci).padStart(4, "0")}.png`);
        import_fs.default.writeFileSync(cf, Buffer.from(cleanB64, "base64"));
        const yPct = Math.max(0, Math.min(96, Number(cs.yPct ?? 72)));
        const hPct = Math.max(4, Math.min(60, Number(cs.hPct ?? 22)));
        captionOverlayFiles.push({
          filePath: cf,
          startSec: Number(cs.startSec || 0),
          endSec: Number(cs.endSec || 0),
          yPx: Math.round(outH * yPct / 100),
          hPx: Math.max(24, Math.round(outH * hPct / 100))
        });
      }
    }
    const parsedTimelineCaptions = [];
    if (overlays?.burnInCaptions !== false && captionOverlayFiles.length === 0) {
      let rawSrt = typeof srtContent === "string" && srtContent.trim() ? srtContent : "";
      if (!rawSrt) {
        const diskSrtCandidates = [
          import_path.default.join(targetRoot, "01_Guion_y_SEO", "Subtitulos.srt"),
          import_path.default.join(targetRoot, "03_Subtitulos_SRT", "Subtitulos.srt"),
          import_path.default.join(targetRoot, "Subtitulos.srt")
        ];
        for (const sc of diskSrtCandidates) {
          if (import_fs.default.existsSync(sc)) {
            rawSrt = import_fs.default.readFileSync(sc, "utf8");
            if (rawSrt.trim()) break;
          }
        }
      }
      if (rawSrt.trim()) {
        const parseSrtTime = (ts) => {
          const m = ts.trim().match(/(\d+):(\d+):(\d+)[,.](\d+)/);
          if (!m) return 0;
          return parseInt(m[1], 10) * 3600 + parseInt(m[2], 10) * 60 + parseInt(m[3], 10) + parseInt(m[4].padEnd(3, "0").slice(0, 3), 10) / 1e3;
        };
        const blocks = rawSrt.trim().split(/\r?\n\s*\r?\n/);
        const rawParsed = [];
        for (const b of blocks) {
          const lines = b.trim().split(/\r?\n/);
          const timeLineIdx = lines.findIndex((l) => l.includes("-->"));
          if (timeLineIdx < 0) continue;
          const [sStr, eStr] = lines[timeLineIdx].split("-->");
          const s = parseSrtTime(sStr || "");
          const e = parseSrtTime(eStr || "");
          const txt = lines.slice(timeLineIdx + 1).map((l) => l.replace(/<[^>]+>/g, "").trim()).filter(Boolean).join("\n");
          if (txt && e > s + 0.05) {
            rawParsed.push({ startSec: s, endSec: e, text: txt });
          }
        }
        if (rawParsed.length > 0) {
          const firstStart = rawParsed[0].startSec;
          const targetVoStart = Math.max(0, Number(voiceoverStartSec ?? 16));
          let shiftSec = 0;
          if (targetVoStart >= 15 && firstStart >= 7.5 && firstStart <= 10.5) {
            shiftSec = targetVoStart - 8;
          } else if (targetVoStart >= 15 && firstStart < 2.5) {
            shiftSec = targetVoStart;
          }
          for (const rp of rawParsed) {
            parsedTimelineCaptions.push({
              startSec: Number((rp.startSec + shiftSec).toFixed(3)),
              endSec: Number((rp.endSec + shiftSec).toFixed(3)),
              text: rp.text
            });
          }
        }
      }
    }
    const hookTextConfig = overlays?.hookText || null;
    const formatAssTime = (sec) => {
      const clamped = Math.max(0, sec);
      const h = Math.floor(clamped / 3600);
      const m = Math.floor(clamped % 3600 / 60);
      const s = Math.floor(clamped % 60);
      const cs = Math.min(99, Math.round((clamped - Math.floor(clamped)) * 100));
      return `${h}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}.${String(cs).padStart(2, "0")}`;
    };
    const escapeAssText = (t) => String(t || "").replace(/\\/g, "\\\\").replace(/\{/g, "\\{").replace(/\}/g, "\\}").replace(/\r?\n/g, "\\N");
    const normalizedClipPaths = [];
    const segmentEncodeTasks = [];
    const clipsVideoSubdir = import_path.default.join(targetRoot, "05_Clips_Video");
    const clipsSubdir = import_path.default.join(targetRoot, "Clips_Aprobados");
    const foleyCacheSubdir = import_path.default.join(clipsVideoSubdir, ".foley_only_cache");
    const introOutroDir = import_path.default.join(
      process.env.HOME || "/Users/raydelsantana",
      "Library/Mobile Documents/com~apple~CloudDocs/0YouTube/Huellas de la Humanidad/Intro:Outro"
    );
    let runningTimelineSec = 0;
    for (let i = 0; i < clips.length; i++) {
      const c = clips[i];
      const fileName = c.fileName || `${String(c.clipNumber || i + 1).padStart(2, "0")}_Clip.mp4`;
      let sourceMp4 = "";
      const isIntroClip = Number(c.clipNumber) === 0 || /intro_huellas/i.test(fileName);
      const isOutroClip = Number(c.clipNumber) === 999 || /outro_huellas/i.test(fileName);
      const candidate0 = import_path.default.join(clipsVideoSubdir, fileName);
      const candidate1 = import_path.default.join(targetRoot, fileName);
      const candidate2 = import_path.default.join(clipsSubdir, fileName);
      if (isIntroClip) {
        const introPath = import_path.default.join(introOutroDir, "Intro.mp4");
        if (import_fs.default.existsSync(introPath)) sourceMp4 = introPath;
      } else if (isOutroClip) {
        const outroPath = import_path.default.join(introOutroDir, "Outro.mp4");
        if (import_fs.default.existsSync(outroPath)) sourceMp4 = outroPath;
      }
      if (sourceMp4) {
      } else if (import_fs.default.existsSync(candidate0)) {
        sourceMp4 = candidate0;
      } else if (import_fs.default.existsSync(candidate1)) {
        sourceMp4 = candidate1;
      } else if (import_fs.default.existsSync(candidate2)) {
        sourceMp4 = candidate2;
      } else if (c.videoDataUrl && String(c.videoDataUrl).startsWith("data:")) {
        const cleanB64 = String(c.videoDataUrl).replace(/^data:[^;]+;base64,/, "");
        sourceMp4 = import_path.default.join(workDir, `raw_input_${i + 1}.mp4`);
        import_fs.default.writeFileSync(sourceMp4, Buffer.from(cleanB64, "base64"));
      } else {
        const num = Number(c.clipNumber || i + 1);
        const prefixRegex = new RegExp(`^(?:clip[_\\-\\s.]*)?0*${num}[_\\-\\s.]`, "i");
        for (const searchDir of [clipsVideoSubdir, targetRoot, clipsSubdir]) {
          if (import_fs.default.existsSync(searchDir)) {
            const matches = import_fs.default.readdirSync(searchDir).filter((f) => prefixRegex.test(f) && /\.(mp4|mov|webm)$/i.test(f)).sort((a, b) => {
              const a4k = /[_\-]4k\.(mp4|mov|webm)$/i.test(a) ? 1 : 0;
              const b4k = /[_\-]4k\.(mp4|mov|webm)$/i.test(b) ? 1 : 0;
              if (b4k !== a4k) return b4k - a4k;
              try {
                return import_fs.default.statSync(import_path.default.join(searchDir, b)).mtimeMs - import_fs.default.statSync(import_path.default.join(searchDir, a)).mtimeMs;
              } catch {
                return 0;
              }
            });
            if (matches.length > 0) {
              sourceMp4 = import_path.default.join(searchDir, matches[0]);
              break;
            }
          }
        }
      }
      if (!sourceMp4 && c.videoUrl && typeof c.videoUrl === "string") {
        try {
          const parsedVid = new URL(c.videoUrl, "http://localhost:4200");
          const vidFile = parsedVid.searchParams.get("filePath");
          if (vidFile && import_fs.default.existsSync(vidFile) && !vidFile.includes(".foley_only_cache") && !vidFile.includes(".vocals_cache") && !vidFile.includes(".music_cache") && !vidFile.includes(".vocals_clean_cache") && !vidFile.includes(".music_clean_cache")) {
            sourceMp4 = vidFile;
          }
        } catch {
        }
      }
      if (c.opticalFlowUrl && typeof c.opticalFlowUrl === "string") {
        try {
          const parsedOpt = new URL(c.opticalFlowUrl, "http://localhost:4200");
          const optFile = parsedOpt.searchParams.get("filePath");
          if (optFile && import_fs.default.existsSync(optFile) && !optFile.includes(".foley_only_cache") && !optFile.includes("_foley_")) {
            sourceMp4 = optFile;
          }
        } catch {
        }
      }
      if (!sourceMp4 || !import_fs.default.existsSync(sourceMp4)) continue;
      const segOut = import_path.default.join(workDir, `seg_${String(i + 1).padStart(3, "0")}.ts`);
      const usingPrebakedOpticalFlow = Boolean(c.opticalFlowUrl) && sourceMp4.includes(".optical_flow_cache");
      const slotDur = Number(c.durationSec) > 0.3 ? Number(c.durationSec) : Number(c.end) > Number(c.start) + 0.2 ? Math.max(0.4, Number(c.end) - Number(c.start)) : 0;
      const probedSegDur = !usingPrebakedOpticalFlow ? await new Promise((resolve) => {
        const p = (0, import_child_process.spawn)(ffmpegBin, ["-i", sourceMp4], {
          stdio: ["ignore", "ignore", "pipe"]
        });
        let se = "";
        p.stderr?.on("data", (d) => {
          se += d.toString();
        });
        p.on("close", () => {
          const m = se.match(/Duration:\s*(\d+):(\d+):(\d+(?:\.\d+)?)/);
          if (m) {
            const sec = parseInt(m[1], 10) * 3600 + parseInt(m[2], 10) * 60 + parseFloat(m[3]);
            if (Number.isFinite(sec) && sec > 0.3) {
              resolve(Math.max(0.3, sec - 0.04));
              return;
            }
          }
          resolve(0);
        });
        p.on("error", () => resolve(0));
      }) : 0;
      const trimStartSec = usingPrebakedOpticalFlow ? 0 : Math.max(0, Number(c.trimStart || 0));
      const rawTrimEnd = usingPrebakedOpticalFlow ? 0 : Number(c.trimEnd || 0) > trimStartSec ? Number(c.trimEnd) : 0;
      const trimEndSec = !usingPrebakedOpticalFlow && probedSegDur > 0.4 ? rawTrimEnd > trimStartSec + 0.1 && rawTrimEnd < probedSegDur - 0.05 ? rawTrimEnd : Math.max(trimStartSec + 0.2, probedSegDur - 0.04) : rawTrimEnd;
      const effectiveSpan = trimEndSec > trimStartSec + 0.1 ? trimEndSec - trimStartSec : probedSegDur > trimStartSec + 0.2 ? probedSegDur - trimStartSec : 0;
      const speed = usingPrebakedOpticalFlow ? 1 : slotDur > 0.3 && effectiveSpan > 0.2 ? Math.max(0.15, Math.min(4, effectiveSpan / slotDur)) : Number(c.speed) > 0 ? Number(c.speed) : 1;
      const ptsFactor = usingPrebakedOpticalFlow ? "1.0000" : slotDur > 0.3 && effectiveSpan > 0.2 ? ((slotDur + 0.06) / effectiveSpan).toFixed(5) : (1 / speed).toFixed(4);
      const isFirstClipAfterIntro = !isIntroClip && !isOutroClip && (Number(c.clipNumber) === 1 || i === 1 && Number(clips[0]?.clipNumber) === 0);
      const isClipMuted = Boolean(c.audioMuted) || typeof c.foleyVolume === "number" && c.foleyVolume <= 1e-4;
      const foleyVol = isClipMuted ? 0 : typeof c.foleyVolume === "number" && Number.isFinite(c.foleyVolume) ? Math.max(0, Math.min(2, c.foleyVolume)) : isIntroClip || isOutroClip ? 1 : isFirstClipAfterIntro ? 0.8 : 0.2;
      const rawClipDur = slotDur > 0.3 ? slotDur : probedSegDur > 0.3 ? probedSegDur : 8;
      const rawSegStartSec = Number.isFinite(Number(c.start)) && Number(c.start) >= 0 ? Number(c.start) : runningTimelineSec;
      const rawSegEndSec = rawSegStartSec + rawClipDur;
      runningTimelineSec = rawSegEndSec;
      const segStartFrame = Math.round(rawSegStartSec * safeFps);
      const segEndFrame = Math.max(segStartFrame + 1, Math.round(rawSegEndSec * safeFps));
      const targetSegFrames = segEndFrame - segStartFrame;
      const segStartSec = segStartFrame / safeFps;
      const effectiveClipDur = targetSegFrames / safeFps;
      const segEndSec = segEndFrame / safeFps;
      const defaultAudioFadeIn = isIntroClip || isOutroClip ? 1.5 : isFirstClipAfterIntro ? 1.2 : 0;
      const defaultAudioFadeOut = isIntroClip || isOutroClip ? 2.5 : 0;
      const audioFadeInSec = typeof c.audioFadeInSec === "number" ? Math.max(0, c.audioFadeInSec) : defaultAudioFadeIn;
      const audioFadeOutSec = typeof c.audioFadeOutSec === "number" ? Math.max(0, c.audioFadeOutSec) : defaultAudioFadeOut;
      const afFades = [];
      if (audioFadeInSec > 0.01) {
        afFades.push(`afade=t=in:st=0:d=${audioFadeInSec.toFixed(2)}`);
      }
      if (audioFadeOutSec > 0.01 && effectiveClipDur > 0.1) {
        const fadeOutStart = Math.max(0, effectiveClipDur - audioFadeOutSec);
        afFades.push(`afade=t=out:st=${fadeOutStart.toFixed(2)}:d=${audioFadeOutSec.toFixed(2)}`);
      }
      const afFadePrefix = afFades.length > 0 ? `${afFades.join(",")},` : "";
      const vfFadeSuffix = isFirstClipAfterIntro ? ",fade=t=in:st=0:d=1.2" : isIntroClip ? ",fade=t=in:st=0:d=0.6,fade=t=out:st=7.2:d=0.8" : isOutroClip ? ",fade=t=in:st=0:d=1.2,fade=t=out:st=5.5:d=2.5" : "";
      const vfTrimSuffix = targetSegFrames > 1 ? `,tpad=stop_mode=clone:stop_duration=0.15,trim=end_frame=${targetSegFrames},setpts=PTS-STARTPTS` : "";
      let assFilterSuffix = "";
      const overlappingCaptions = parsedTimelineCaptions.filter(
        (cp) => cp.endSec > segStartSec + 0.03 && cp.startSec < segEndSec - 0.03
      );
      const hasAssHook = overlays?.burnInHook !== false && Boolean(isFirstClipAfterIntro) && Boolean(hookTextConfig && (hookTextConfig.line1 || hookTextConfig.line2));
      const isVertical916 = aspectRatio === "9:16" || outH > outW;
      const refShortSide = Math.min(outW, outH);
      if (overlappingCaptions.length > 0 || hasAssHook) {
        const assEvents = [];
        const blurScale = Math.max(1, refShortSide / 1080);
        const capWordBlur = Math.round(14 * blurScale);
        const capWideBlur = Math.round(8 * blurScale);
        const capTightBlur = Number((2 * blurScale).toFixed(1));
        const hook1WideBlur = Math.round(9 * blurScale);
        const hook1TightBlur = Number((2 * blurScale).toFixed(1));
        const hook2WideBlur = Math.round(11 * blurScale);
        const hook2TightBlur = Number((2.2 * blurScale).toFixed(1));
        if (hasAssHook && hookTextConfig) {
          const rawL1 = Number(hookTextConfig.line1StartSec ?? 9);
          const rawL2 = Number(hookTextConfig.line2StartSec ?? 10);
          const h1Start = Math.max(0, Math.min(effectiveClipDur - 1.5, rawL1 >= 7.5 ? rawL1 - 8 : rawL1));
          const h2Start = Math.max(h1Start + 0.5, Math.min(effectiveClipDur - 1, rawL2 >= 7.5 ? rawL2 - 8 : rawL2));
          const hEnd = effectiveClipDur;
          const line1Txt = escapeAssText(String(hookTextConfig.line1 || "").toUpperCase());
          const line2Txt = escapeAssText(String(hookTextConfig.line2 || "").toUpperCase());
          if (line1Txt && hEnd > h1Start + 0.05) {
            assEvents.push(
              `Dialogue: 1,${formatAssTime(h1Start)},${formatAssTime(hEnd)},Hook1CinemaWide,,0,0,0,,{\\fad(1000,1000)\\blur${hook1WideBlur}}${line1Txt}`,
              `Dialogue: 2,${formatAssTime(h1Start)},${formatAssTime(hEnd)},Hook1CinemaTight,,0,0,0,,{\\fad(1000,1000)\\blur${hook1TightBlur}}${line1Txt}`,
              `Dialogue: 3,${formatAssTime(h1Start)},${formatAssTime(hEnd)},Hook1Crisp,,0,0,0,,{\\fad(1000,1000)}${line1Txt}`
            );
          }
          if (line2Txt && hEnd > h2Start + 0.05) {
            assEvents.push(
              `Dialogue: 1,${formatAssTime(h2Start)},${formatAssTime(hEnd)},Hook2CinemaWide,,0,0,0,,{\\fad(1000,1000)\\blur${hook2WideBlur}}${line2Txt}`,
              `Dialogue: 2,${formatAssTime(h2Start)},${formatAssTime(hEnd)},Hook2CinemaTight,,0,0,0,,{\\fad(1000,1000)\\blur${hook2TightBlur}}${line2Txt}`,
              `Dialogue: 3,${formatAssTime(h2Start)},${formatAssTime(hEnd)},Hook2Crisp,,0,0,0,,{\\fad(1000,1000)}${line2Txt}`
            );
          }
        }
        let prevAssLocalE = 0;
        for (const cp of overlappingCaptions) {
          const startsInsideSeg = cp.startSec > segStartSec + 0.02;
          const endsInsideSeg = cp.endSec < segEndSec - 0.02;
          const localS = startsInsideSeg ? Math.max(prevAssLocalE, Math.max(0, cp.startSec - segStartSec - 0.065)) : 0;
          const localE = Math.min(effectiveClipDur, cp.endSec - segStartSec);
          if (localE > localS + 0.04) {
            prevAssLocalE = localE;
            const fadeInMs = startsInsideSeg ? 60 : 0;
            const fadeOutMs = endsInsideSeg ? 65 : 0;
            const capTxt = escapeAssText(cp.text);
            assEvents.push(
              `Dialogue: 0,${formatAssTime(localS)},${formatAssTime(localE)},CaptionWordShadow,,0,0,0,,{\\fad(${fadeInMs},${fadeOutMs})\\blur${capWordBlur}}${capTxt}`,
              `Dialogue: 1,${formatAssTime(localS)},${formatAssTime(localE)},CaptionCinemaWide,,0,0,0,,{\\fad(${fadeInMs},${fadeOutMs})\\blur${capWideBlur}}${capTxt}`,
              `Dialogue: 2,${formatAssTime(localS)},${formatAssTime(localE)},CaptionCinemaTight,,0,0,0,,{\\fad(${fadeInMs},${fadeOutMs})\\blur${capTightBlur}}${capTxt}`,
              `Dialogue: 3,${formatAssTime(localS)},${formatAssTime(localE)},CaptionCrisp,,0,0,0,,{\\fad(${fadeInMs},${fadeOutMs})}${capTxt}`
            );
          }
        }
        if (assEvents.length > 0) {
          const assPath = import_path.default.join(workDir, `seg_sub_${String(i + 1).padStart(3, "0")}.ass`);
          const capStyleCfg = overlays?.captionStyle || {};
          const reqCapFontSize = Number(
            isVertical916 ? capStyleCfg.fontSize9x16 ?? capStyleCfg.fontSize : capStyleCfg.fontSize16x9 ?? capStyleCfg.fontSize
          );
          const defaultCapFontSize = isVertical916 ? 21 : 25;
          const capFontScale = Number.isFinite(reqCapFontSize) && reqCapFontSize >= 10 ? reqCapFontSize / defaultCapFontSize : 1;
          const capFontSizeAss = Math.round(
            refShortSide * (isVertical916 ? 0.043 : 0.039) * capFontScale
          );
          const reqBottomPct = typeof capStyleCfg.bottomPct === "number" && capStyleCfg.bottomPct >= 2 ? capStyleCfg.bottomPct : isVertical916 ? 15.5 : 11;
          const capMarginV = Math.round(outH * (reqBottomPct / 100));
          const capWideMarginV = Math.max(0, capMarginV - Math.round(refShortSide * 45e-4));
          const capTightMarginV = Math.max(0, capMarginV - Math.round(refShortSide * 25e-4));
          const hook1FontSizeAss = Math.round(refShortSide * (isVertical916 ? 0.035 : 0.036));
          const hook2FontSizeAss = Math.round(refShortSide * (isVertical916 ? 0.052 : 0.0574));
          const hook1MarginV = Math.round(outH * 0.555);
          const hook1WideMarginV = Math.max(0, hook1MarginV - Math.round(refShortSide * 45e-4));
          const hook1TightMarginV = Math.max(0, hook1MarginV - Math.round(refShortSide * 25e-4));
          const hook2MarginV = Math.round(outH * 0.463);
          const hook2WideMarginV = hook2MarginV + Math.round(refShortSide * 55e-4);
          const hook2TightMarginV = hook2MarginV + Math.round(refShortSide * 28e-4);
          const capWordOutline = Math.max(10, Math.round(refShortSide * 0.0185 * capFontScale));
          const capWideOutline = Math.max(1, Math.round(refShortSide * 18e-4 * capFontScale));
          const hook1WideOutline = Math.max(1, Math.round(refShortSide * 2e-3));
          const hook2WideOutline = Math.max(2, Math.round(refShortSide * 26e-4));
          const hook1Spacing = Number((3.5 * blurScale).toFixed(1));
          const hook2Spacing = Number((1.5 * blurScale).toFixed(1));
          const rawCapHex = String(capStyleCfg.color || "#ffffff").replace("#", "");
          const capCrispAssColor = /^[0-9a-fA-F]{6}$/.test(rawCapHex) ? `&H00${rawCapHex.slice(4, 6).toUpperCase()}${rawCapHex.slice(2, 4).toUpperCase()}${rawCapHex.slice(0, 2).toUpperCase()}` : "&H00FFFFFF";
          const assContent = [
            "[Script Info]",
            "ScriptType: v4.00+",
            `PlayResX: ${outW}`,
            `PlayResY: ${outH}`,
            "WrapStyle: 0",
            "ScaledBorderAndShadow: yes",
            "",
            "[V4+ Styles]",
            "Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding",
            `Style: CaptionWordShadow,Georgia,${capFontSizeAss},&HFF000000,&HFF000000,&H64000000,&HFF000000,-1,0,0,0,100,100,0,0,1,${capWordOutline},0,2,${Math.round(outW * 0.075)},${Math.round(outW * 0.075)},${capMarginV},1`,
            `Style: CaptionCinemaWide,Georgia,${capFontSizeAss},&H18000000,&H18000000,&H18000000,&HFF000000,-1,0,0,0,100,100,0,0,1,${capWideOutline},0,2,${Math.round(outW * 0.075)},${Math.round(outW * 0.075)},${capWideMarginV},1`,
            `Style: CaptionCinemaTight,Georgia,${capFontSizeAss},&H0D000000,&H0D000000,&H00000000,&HFF000000,-1,0,0,0,100,100,0,0,1,0,0,2,${Math.round(outW * 0.075)},${Math.round(outW * 0.075)},${capTightMarginV},1`,
            `Style: CaptionCrisp,Georgia,${capFontSizeAss},${capCrispAssColor},&H0000FFFF,&H00000000,&H00000000,-1,0,0,0,100,100,0,0,1,0,0,2,${Math.round(outW * 0.075)},${Math.round(outW * 0.075)},${capMarginV},1`,
            `Style: Hook1CinemaWide,Georgia,${hook1FontSizeAss},&H14000000,&H14000000,&H14000000,&HFF000000,-1,0,0,0,100,100,${hook1Spacing},0,1,${hook1WideOutline},0,2,${Math.round(outW * 0.06)},${Math.round(outW * 0.06)},${hook1WideMarginV},1`,
            `Style: Hook1CinemaTight,Georgia,${hook1FontSizeAss},&H0A000000,&H0A000000,&H00000000,&HFF000000,-1,0,0,0,100,100,${hook1Spacing},0,1,0,0,2,${Math.round(outW * 0.06)},${Math.round(outW * 0.06)},${hook1TightMarginV},1`,
            `Style: Hook1Crisp,Georgia,${hook1FontSizeAss},&H004DD3FC,&H0000FFFF,&H00000000,&H00000000,-1,0,0,0,100,100,${hook1Spacing},0,1,0,0,2,${Math.round(outW * 0.06)},${Math.round(outW * 0.06)},${hook1MarginV},1`,
            `Style: Hook2CinemaWide,Georgia,${hook2FontSizeAss},&H14000000,&H14000000,&H14000000,&HFF000000,-1,0,0,0,100,100,${hook2Spacing},0,1,${hook2WideOutline},0,8,${Math.round(outW * 0.055)},${Math.round(outW * 0.055)},${hook2WideMarginV},1`,
            `Style: Hook2CinemaTight,Georgia,${hook2FontSizeAss},&H0A000000,&H0A000000,&H00000000,&HFF000000,-1,0,0,0,100,100,${hook2Spacing},0,1,0,0,8,${Math.round(outW * 0.055)},${Math.round(outW * 0.055)},${hook2TightMarginV},1`,
            `Style: Hook2Crisp,Georgia,${hook2FontSizeAss},&H00FFFFFF,&H0000FFFF,&H00000000,&H00000000,-1,0,0,0,100,100,${hook2Spacing},0,1,0,0,8,${Math.round(outW * 0.055)},${Math.round(outW * 0.055)},${hook2MarginV},1`,
            "",
            "[Events]",
            "Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text",
            ...assEvents,
            ""
          ].join("\n");
          import_fs.default.writeFileSync(assPath, assContent, "utf8");
          const escapedAssPath = assPath.replace(/\\/g, "/").replace(/:/g, "\\:").replace(/'/g, "\\'");
          const fontsDirPath = import_path.default.join(process.cwd(), "data", "fonts");
          const escapedFontsDir = fontsDirPath.replace(/\\/g, "/").replace(/:/g, "\\:").replace(/'/g, "\\'");
          assFilterSuffix = import_fs.default.existsSync(fontsDirPath) ? `,subtitles=filename='${escapedAssPath}':fontsdir='${escapedFontsDir}'` : `,ass='${escapedAssPath}'`;
        }
      }
      let scaleAndCropVf;
      if (isVertical916 && c.reframe9x16Mode !== "fit_blur") {
        const fStart = Math.max(0, Math.min(1, Number(c.reframeFocusXStart ?? 50) / 100));
        const fEnd = Math.max(0, Math.min(1, Number(c.reframeFocusXEnd ?? c.reframeFocusXStart ?? 50) / 100));
        const fY = Math.max(0, Math.min(1, Number(c.reframeFocusY ?? 50) / 100));
        const isDynamicPan = Math.abs(fEnd - fStart) >= 0.015;
        const cropXExpr = isDynamicPan ? `'max(0,min(iw-ow,(iw-ow)*(${fStart.toFixed(4)}+(${(fEnd - fStart).toFixed(4)})*min(1,max(0,t/${Math.max(0.5, effectiveClipDur).toFixed(3)})))))'` : `'max(0,min(iw-ow,(iw-ow)*${fStart.toFixed(4)}))'`;
        const cropYExpr = `'max(0,min(ih-oh,(ih-oh)*${fY.toFixed(4)}))'`;
        scaleAndCropVf = `scale=${outW}:${outH}:force_original_aspect_ratio=increase:flags=fast_bilinear,crop=${outW}:${outH}:${cropXExpr}:${cropYExpr}`;
      } else {
        scaleAndCropVf = `scale=${outW}:${outH}:force_original_aspect_ratio=decrease:flags=fast_bilinear,pad=${outW}:${outH}:(ow-iw)/2:(oh-ih)/2:black`;
      }
      const baseVfChain = `setpts=${ptsFactor}*(PTS-STARTPTS),${scaleAndCropVf},fps=${safeFps},format=yuv420p${vfTrimSuffix}${vfFadeSuffix}${assFilterSuffix}`;
      const buildAtempoChain = (spd) => {
        if (Math.abs(spd - 1) < 3e-3) return "";
        const stages = [];
        let rem = Math.max(0.2, Math.min(4, spd));
        while (rem < 0.5) {
          stages.push("atempo=0.5");
          rem /= 0.5;
        }
        while (rem > 2) {
          stages.push("atempo=2.0");
          rem /= 2;
        }
        stages.push(`atempo=${rem.toFixed(4)}`);
        return `${stages.join(",")},`;
      };
      const atempoPrefix = buildAtempoChain(speed);
      const targetAudioSamples = Math.max(1024, Math.round(effectiveClipDur * 44100));
      const afTrimSuffix = effectiveClipDur > 0.3 ? `,aresample=44100,apad,atrim=end_sample=${targetAudioSamples},asetpts=PTS-STARTPTS` : ",aresample=44100";
      const afFilter = `${atempoPrefix}${afFadePrefix}volume=${foleyVol.toFixed(4)}${afTrimSuffix}`;
      const inputTrimArgs = [];
      if (trimStartSec > 0.01) {
        inputTrimArgs.push("-ss", trimStartSec.toFixed(3));
      }
      if (trimEndSec > trimStartSec + 0.05) {
        inputTrimArgs.push("-to", trimEndSec.toFixed(3));
      }
      const extraOverlayInputs = [];
      const overlayFilterSteps = [];
      let currentVLabel = "vb0";
      let ovrCounter = 0;
      if (logoOverlayInfo && import_fs.default.existsSync(logoOverlayInfo.filePath)) {
        extraOverlayInputs.push("-i", logoOverlayInfo.filePath);
        const inpIdx = extraOverlayInputs.length / 2;
        const nextVLbl = `vb_${++ovrCounter}`;
        overlayFilterSteps.push(
          `[${currentVLabel}][__INP_${inpIdx}__:v]overlay=${logoOverlayInfo.xPx}:${logoOverlayInfo.yPx}:format=auto[${nextVLbl}]`
        );
        currentVLabel = nextVLbl;
      }
      if (!hasAssHook) {
        for (const hk of hookOverlayFiles) {
          if (hk.endSec > segStartSec + 0.02 && hk.startSec < segEndSec - 0.02) {
            const localStart = Math.max(0, hk.startSec - segStartSec);
            const localEnd = Math.min(effectiveClipDur, hk.endSec - segStartSec);
            if (localEnd > localStart + 0.02) {
              extraOverlayInputs.push("-i", hk.filePath);
              const inpIdx = extraOverlayInputs.length / 2;
              const nextVLbl = `vb_${++ovrCounter}`;
              overlayFilterSteps.push(
                `[__INP_${inpIdx}__:v]scale=${outW}:${hk.hPx}:flags=fast_bilinear[hk_${ovrCounter}];[${currentVLabel}][hk_${ovrCounter}]overlay=0:${hk.yPx}:format=auto:enable='between(t,${localStart.toFixed(3)},${localEnd.toFixed(3)})'[${nextVLbl}]`
              );
              currentVLabel = nextVLbl;
            }
          }
        }
      }
      for (const cs of captionOverlayFiles) {
        if (cs.endSec > segStartSec + 0.02 && cs.startSec < segEndSec - 0.02) {
          const localStart = Math.max(0, cs.startSec - segStartSec);
          const localEnd = Math.min(effectiveClipDur, cs.endSec - segStartSec);
          if (localEnd > localStart + 0.02) {
            extraOverlayInputs.push("-i", cs.filePath);
            const inpIdx = extraOverlayInputs.length / 2;
            const nextVLbl = `vb_${++ovrCounter}`;
            overlayFilterSteps.push(
              `[__INP_${inpIdx}__:v]scale=${outW}:${cs.hPx}:flags=fast_bilinear[cp_${ovrCounter}];[${currentVLabel}][cp_${ovrCounter}]overlay=0:${cs.yPx}:format=auto:enable='between(t,${localStart.toFixed(3)},${localEnd.toFixed(3)})'[${nextVLbl}]`
            );
            currentVLabel = nextVLbl;
          }
        }
      }
      const effectiveEncodeBitrateMbps = safeBitrateMbps;
      const hwEncoderArgs = is8K ? ["-c:v", "hevc_videotoolbox", "-realtime", "true", "-b:v", `${effectiveEncodeBitrateMbps}M`, "-tag:v", "hvc1"] : ["-c:v", "h264_videotoolbox", "-realtime", "true", "-b:v", `${effectiveEncodeBitrateMbps}M`, "-profile:v", "high"];
      const swEncoderArgs = is8K ? [
        "-c:v",
        "libx265",
        "-preset",
        "ultrafast",
        "-b:v",
        `${effectiveEncodeBitrateMbps}M`,
        "-tag:v",
        "hvc1"
      ] : [
        "-c:v",
        "libx264",
        "-preset",
        "ultrafast",
        "-b:v",
        `${effectiveEncodeBitrateMbps}M`,
        "-maxrate",
        `${Math.round(effectiveEncodeBitrateMbps * 1.25)}M`,
        "-bufsize",
        `${Math.round(effectiveEncodeBitrateMbps * 2)}M`
      ];
      const buildSegmentArgs = (useSilentAudioInput, vCodecArgs, useHwAccelInput) => {
        const inputOffset = useSilentAudioInput ? 1 : 0;
        const resolvedOverlaySteps = overlayFilterSteps.map(
          (step) => step.replace(/__INP_(\d+)__/g, (_m, d) => String(parseInt(d, 10) + inputOffset))
        );
        const fullComplex = resolvedOverlaySteps.length > 0 ? `[0:v]${baseVfChain}[vb0];${resolvedOverlaySteps.join(";")};[${currentVLabel}]format=yuv420p[vout]` : `[0:v]${baseVfChain}[vout]`;
        const hwInArgs = useHwAccelInput ? ["-hwaccel", "videotoolbox"] : [];
        if (!useSilentAudioInput) {
          return [
            "-y",
            ...hwInArgs,
            ...inputTrimArgs,
            "-i",
            sourceMp4,
            ...extraOverlayInputs,
            "-filter_complex",
            `${fullComplex};[0:a]${afFilter}[aout]`,
            "-map",
            "[vout]",
            "-map",
            "[aout]",
            "-r",
            String(safeFps),
            ...vCodecArgs,
            "-c:a",
            "aac",
            "-ar",
            "44100",
            "-ac",
            "2",
            "-muxpreload",
            "0",
            "-muxdelay",
            "0",
            "-f",
            "mpegts",
            segOut
          ];
        } else {
          return [
            "-y",
            ...hwInArgs,
            ...inputTrimArgs,
            "-i",
            sourceMp4,
            "-f",
            "lavfi",
            "-i",
            `anullsrc=channel_layout=stereo:sample_rate=44100:d=${effectiveClipDur.toFixed(3)}`,
            ...extraOverlayInputs,
            "-filter_complex",
            fullComplex,
            "-map",
            "[vout]",
            "-map",
            "1:a",
            "-r",
            String(safeFps),
            ...vCodecArgs,
            "-c:a",
            "aac",
            "-ar",
            "44100",
            "-ac",
            "2",
            "-shortest",
            "-muxpreload",
            "0",
            "-muxdelay",
            "0",
            "-f",
            "mpegts",
            segOut
          ];
        }
      };
      const runSegmentEncode = (args) => new Promise((resolve, reject) => {
        (0, import_child_process.execFile)(ffmpegBin, args, { timeout: 6e5 }, (err) => err ? reject(err) : resolve());
      });
      const segLabel = isIntroClip ? "Intro" : isOutroClip ? "Outro" : `Clip ${c.clipNumber || i}`;
      normalizedClipPaths.push(segOut);
      segmentEncodeTasks.push({
        idx: segmentEncodeTasks.length,
        label: segLabel,
        segOut,
        durationSec: effectiveClipDur,
        run: async () => {
          if (isClipMuted) {
            try {
              await runSegmentEncode(buildSegmentArgs(true, hwEncoderArgs, true));
            } catch {
              await runSegmentEncode(buildSegmentArgs(true, swEncoderArgs, false));
            }
            return;
          }
          try {
            await runSegmentEncode(buildSegmentArgs(false, hwEncoderArgs, true));
          } catch {
            try {
              await runSegmentEncode(buildSegmentArgs(true, hwEncoderArgs, true));
            } catch {
              try {
                await runSegmentEncode(buildSegmentArgs(false, swEncoderArgs, false));
              } catch {
                await runSegmentEncode(buildSegmentArgs(true, swEncoderArgs, false));
              }
            }
          }
        }
      });
    }
    if (normalizedClipPaths.length === 0) {
      activeRenderJobState = {
        running: false,
        progressPct: 0,
        currentStep: 0,
        totalSteps: 0,
        stageLabel: "",
        startedAt: 0,
        error: "No se encontraron archivos MP4 en la carpeta elegida ni en memoria."
      };
      res.status(400).json({
        error: "No se encontraron archivos MP4 en la carpeta elegida ni en memoria. Aseg\xFArate de haber descargado o importado al menos un clip MP4."
      });
      return;
    }
    const audioDirs = [import_path.default.join(targetRoot, "02_Audio"), import_path.default.join(targetRoot, "Audio"), targetRoot];
    let voPath = import_path.default.join(targetRoot, "02_Audio", "Voz_Narrativa.mp3");
    if (!import_fs.default.existsSync(voPath)) {
      voPath = import_path.default.join(targetRoot, "Audio", "Voz_Narrativa.mp3");
    }
    if (!import_fs.default.existsSync(voPath)) {
      for (const ad of audioDirs) {
        if (!import_fs.default.existsSync(ad) || !import_fs.default.statSync(ad).isDirectory()) continue;
        const voMatch = import_fs.default.readdirSync(ad).find(
          (f) => /\.(mp3|m4a|wav)$/i.test(f) && /(?:voz[_\-\s]*narrativa|narracion|voiceover|voz_master)/i.test(f) && !/(?:suno|flowmusic|flow_music|musica|pista|track)/i.test(f)
        );
        if (voMatch) {
          voPath = import_path.default.join(ad, voMatch);
          break;
        }
      }
    }
    if (!import_fs.default.existsSync(voPath) && voiceoverDataUrl && String(voiceoverDataUrl).startsWith("data:")) {
      const cleanB64 = String(voiceoverDataUrl).replace(/^data:[^;]+;base64,/, "");
      voPath = import_path.default.join(workDir, "voiceover_input.mp3");
      import_fs.default.writeFileSync(voPath, Buffer.from(cleanB64, "base64"));
    }
    const resolvedMusicInputs = [];
    if (Array.isArray(musicTracks) && musicTracks.length > 0) {
      for (let i = 0; i < musicTracks.length; i++) {
        const mt = musicTracks[i] || {};
        const tNum = Number(mt.trackNumber || i + 1);
        let foundTrackPath = "";
        for (const ad of audioDirs) {
          if (!import_fs.default.existsSync(ad) || !import_fs.default.statSync(ad).isDirectory()) continue;
          const matchFile = import_fs.default.readdirSync(ad).find((f) => {
            const m = f.match(/(?:suno|flowmusic|flow_music|musica|pista|track)[_\-\s]*0*(\d+)/i);
            return m && parseInt(m[1], 10) === tNum && /\.(mp3|m4a|wav)$/i.test(f);
          });
          if (matchFile) {
            foundTrackPath = import_path.default.join(ad, matchFile);
            break;
          }
        }
        if (!foundTrackPath && mt.audioDataUrl && String(mt.audioDataUrl).startsWith("data:")) {
          const cleanB64 = String(mt.audioDataUrl).replace(/^data:[^;]+;base64,/, "");
          foundTrackPath = import_path.default.join(workDir, `flowmusic_${tNum}.mp3`);
          import_fs.default.writeFileSync(foundTrackPath, Buffer.from(cleanB64, "base64"));
        }
        if (foundTrackPath && import_fs.default.existsSync(foundTrackPath)) {
          resolvedMusicInputs.push({
            filePath: foundTrackPath,
            startSec: Math.max(0, Number(mt.startSec || 0)),
            durationSec: Math.max(10, Number(mt.durationSec || 90)),
            volume: typeof mt.volume === "number" && Number.isFinite(mt.volume) ? Math.max(0, Math.min(1, Number(mt.volume))) : void 0,
            fadeInSec: mt.fadeInSec !== void 0 && mt.fadeInSec !== null ? Math.max(0, Number(mt.fadeInSec)) : 5,
            fadeOutSec: mt.fadeOutSec !== void 0 && mt.fadeOutSec !== null ? Math.max(0, Number(mt.fadeOutSec)) : 5
          });
        }
      }
    }
    const safeDocName = String(docTitle || "Huellas_Documental").normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-zA-Z0-9_-]+/g, "_").replace(/^_+|_+$/g, "").slice(0, 45);
    const finalFileName = `${safeDocName}_${preset.label}_${safeFps}fps_${safeBitrateMbps}Mbps_${aspectRatio.replace(":", "x")}.mp4`;
    const videoFinalSubdir = import_path.default.join(targetRoot, "06_Video_Final");
    if (!import_fs.default.existsSync(videoFinalSubdir)) {
      try {
        import_fs.default.mkdirSync(videoFinalSubdir, { recursive: true });
      } catch {
      }
    }
    const finalOutputPath = import_fs.default.existsSync(videoFinalSubdir) ? import_path.default.join(videoFinalSubdir, finalFileName) : import_path.default.join(targetRoot, finalFileName);
    const tempMuxOutputPath = import_path.default.join(workDir, `mux_master_${Date.now()}.mp4`);
    if (import_fs.default.existsSync(finalOutputPath)) {
      try {
        import_fs.default.unlinkSync(finalOutputPath);
      } catch {
      }
    }
    if (srtContent) {
      import_fs.default.writeFileSync(import_path.default.join(targetRoot, "Subtitulos.srt"), String(srtContent), "utf8");
      const seoDir = import_path.default.join(targetRoot, "01_Guion_y_SEO");
      if (import_fs.default.existsSync(seoDir)) {
        import_fs.default.writeFileSync(import_path.default.join(seoDir, "Subtitulos.srt"), String(srtContent), "utf8");
      }
    }
    const totalSegTasks = segmentEncodeTasks.length;
    const fifoPaths = [];
    for (let k = 0; k < totalSegTasks; k++) {
      const fp = import_path.default.join(workDir, `fifo_${String(k + 1).padStart(3, "0")}.ts`);
      (0, import_child_process.execSync)(`mkfifo "${fp.replace(/"/g, '\\"')}"`);
      fifoPaths.push(fp);
    }
    const concatListPath = import_path.default.join(workDir, "concat_list.txt");
    const concatContent = fifoPaths.map((p, idx) => {
      const dur = segmentEncodeTasks[idx]?.durationSec || 8;
      return `file '${p.replace(/'/g, "'\\''")}'
duration ${dur.toFixed(6)}`;
    }).join("\n");
    import_fs.default.writeFileSync(concatListPath, concatContent, "utf8");
    const hasVo = import_fs.default.existsSync(voPath);
    let muxerArgs = [];
    if (hasVo || resolvedMusicInputs.length > 0) {
      muxerArgs = ["-y", "-f", "concat", "-safe", "0", "-i", concatListPath];
      const totalTimelineDurStr = Math.max(1, runningTimelineSec).toFixed(3);
      const filterParts = [
        `[0:a]aresample=44100,aformat=sample_fmts=fltp:channel_layouts=stereo,apad=whole_dur=${totalTimelineDurStr},atrim=0:${totalTimelineDurStr},asetpts=N/SR/TB[clip_a]`
      ];
      const mixLabels = ["[clip_a]"];
      let nextInputIdx = 1;
      const safeVoVol = Math.max(0.5, Math.min(1, Number(voiceoverVolume || 1)));
      const voDbMultiplier = Math.pow(10, (Number(voiceoverGainDb ?? 5) + 1.5) / 20);
      const boostedVoVol = safeVoVol * voDbMultiplier;
      if (hasVo) {
        muxerArgs.push("-i", voPath);
        const delayMs = Math.max(0, Math.round(Number(voiceoverStartSec || 0) * 1e3));
        filterParts.push(
          `[${nextInputIdx}:a]aresample=44100,aformat=sample_fmts=fltp,areverse,atrim=start=0.05,afade=t=in:st=0:d=0.04,areverse,pan=stereo|FL=FL+FC|FR=FR+FC,asetpts=N/SR/TB,adelay=${delayMs}|${delayMs},volume=${boostedVoVol.toFixed(3)},alimiter=limit=0.89:attack=3:release=150:level=disabled[vo]`
        );
        mixLabels.push("[vo]");
        nextInputIdx++;
      }
      const defaultMusicVol = Math.max(0, Math.min(1, Number(sunoMasterVolume ?? 0.1)));
      const MUSIC_EXPORT_CALIBRATION = 0.45;
      for (let mIdx = 0; mIdx < resolvedMusicInputs.length; mIdx++) {
        const mItem = resolvedMusicInputs[mIdx];
        muxerArgs.push("-i", mItem.filePath);
        const startMs = Math.max(0, Math.round(mItem.startSec * 1e3));
        const dur = Math.max(8, mItem.durationSec);
        const rawTrackVol = typeof mItem.volume === "number" ? mItem.volume : defaultMusicVol;
        const trackVol = Math.max(0, Math.min(1, rawTrackVol * MUSIC_EXPORT_CALIBRATION));
        const fadeFilters = [];
        if (mItem.fadeInSec > 0) {
          fadeFilters.push(`afade=t=in:st=0:d=${mItem.fadeInSec}:curve=tri`);
        }
        if (mItem.fadeOutSec > 0) {
          const fadeOutStart = Math.max(0, Number((dur - mItem.fadeOutSec).toFixed(2)));
          fadeFilters.push(`afade=t=out:st=${fadeOutStart}:d=${mItem.fadeOutSec}:curve=tri`);
        }
        const fadeChain = fadeFilters.length > 0 ? `,${fadeFilters.join(",")}` : "";
        const lbl = `mus${mIdx}`;
        filterParts.push(
          `[${nextInputIdx}:a]aresample=44100,aformat=sample_fmts=fltp:channel_layouts=stereo,atrim=0:${dur},asetpts=N/SR/TB${fadeChain},volume=${trackVol.toFixed(4)},adelay=${startMs}|${startMs}[${lbl}]`
        );
        mixLabels.push(`[${lbl}]`);
        nextInputIdx++;
      }
      filterParts.push(
        `${mixLabels.join("")}amix=inputs=${mixLabels.length}:duration=first:dropout_transition=2:normalize=0,asetpts=N/SR/TB[aout]`
      );
      muxerArgs.push(
        "-filter_complex",
        filterParts.join(";"),
        "-map",
        "0:v",
        "-map",
        "[aout]",
        "-c:v",
        "copy",
        "-c:a",
        "aac",
        "-b:a",
        "256k",
        tempMuxOutputPath
      );
    } else {
      muxerArgs = [
        "-y",
        "-f",
        "concat",
        "-safe",
        "0",
        "-i",
        concatListPath,
        "-c",
        "copy",
        tempMuxOutputPath
      ];
    }
    const muxerProc = (0, import_child_process.spawn)(ffmpegBin, muxerArgs, { stdio: ["ignore", "ignore", "pipe"] });
    let muxerStderr = "";
    muxerProc.stderr?.on("data", (d) => {
      muxerStderr = (muxerStderr + d.toString()).slice(-4e3);
    });
    const muxerDonePromise = new Promise((resolve, reject) => {
      muxerProc.on("close", (code) => {
        if (code === 0) resolve();
        else reject(new Error(`Final muxer exited with code ${code}: ${muxerStderr}`));
      });
      muxerProc.on("error", reject);
    });
    let completedSegCount = 0;
    let nextTaskCursor = 0;
    let nextFifoToFeed = 0;
    const segReadyFlags = new Array(totalSegTasks).fill(false);
    let workerError = null;
    const workerConcurrency = Math.min(4, Math.max(1, totalSegTasks));
    const runWorker = async () => {
      while (nextTaskCursor < totalSegTasks && !workerError) {
        while (nextTaskCursor > nextFifoToFeed + 5 && !workerError) {
          await new Promise((r) => setTimeout(r, 200));
        }
        if (workerError || nextTaskCursor >= totalSegTasks) break;
        const myIdx = nextTaskCursor++;
        const task = segmentEncodeTasks[myIdx];
        if (!task) break;
        try {
          await task.run();
          segReadyFlags[myIdx] = true;
          completedSegCount++;
          activeRenderJobState = {
            ...activeRenderJobState,
            progressPct: Math.min(
              97,
              Math.max(3, Math.round(completedSegCount / Math.max(1, totalSegTasks) * 96))
            ),
            currentStep: completedSegCount,
            totalSteps: totalSegTasks,
            stageLabel: `Renderizando y uniendo segmento ${completedSegCount}/${totalSegTasks} (${task.label}) en ${preset.label} \u2022 ${safeFps} FPS \u2022 ${safeBitrateMbps} Mbps...`
          };
        } catch (err) {
          workerError = err;
          break;
        }
      }
    };
    const runFifoFeeder = async () => {
      for (let k = 0; k < totalSegTasks; k++) {
        while (!segReadyFlags[k] && !workerError) {
          await new Promise((r) => setTimeout(r, 120));
        }
        if (workerError) {
          try {
            muxerProc.kill("SIGKILL");
          } catch {
          }
          break;
        }
        const srcTs = segmentEncodeTasks[k].segOut;
        const fifoTs = fifoPaths[k];
        await new Promise((resolve, reject) => {
          const rs = import_fs.default.createReadStream(srcTs);
          const ws = import_fs.default.createWriteStream(fifoTs);
          rs.on("error", reject);
          ws.on("error", reject);
          ws.on("finish", () => {
            try {
              import_fs.default.unlinkSync(srcTs);
            } catch {
            }
            try {
              import_fs.default.unlinkSync(fifoTs);
            } catch {
            }
            resolve();
          });
          rs.pipe(ws);
        });
        nextFifoToFeed = k + 1;
      }
    };
    await Promise.all([
      ...Array.from({ length: workerConcurrency }, () => runWorker()),
      runFifoFeeder()
    ]);
    if (workerError) {
      throw workerError;
    }
    activeRenderJobState = {
      ...activeRenderJobState,
      progressPct: 99,
      stageLabel: "Finalizando contenedor MP4 masterizado..."
    };
    await muxerDonePromise;
    if (import_fs.default.existsSync(tempMuxOutputPath)) {
      if (process.platform === "darwin") {
        try {
          (0, import_child_process.execSync)(`xattr -c "${tempMuxOutputPath.replace(/"/g, '\\"')}"`, { stdio: "ignore" });
        } catch {
        }
      }
      if (import_fs.default.existsSync(finalOutputPath)) {
        try {
          import_fs.default.unlinkSync(finalOutputPath);
        } catch {
        }
        await new Promise((r) => setTimeout(r, 1500));
      }
      try {
        import_fs.default.renameSync(tempMuxOutputPath, finalOutputPath);
      } catch {
        import_fs.default.copyFileSync(tempMuxOutputPath, finalOutputPath);
        try {
          import_fs.default.unlinkSync(tempMuxOutputPath);
        } catch {
        }
      }
    }
    try {
      (0, import_child_process.execSync)(`xattr -c "${finalOutputPath.replace(/"/g, '\\"')}"`, { stdio: "ignore" });
      (0, import_child_process.execSync)(`chflags nohidden "${finalOutputPath.replace(/"/g, '\\"')}"`, { stdio: "ignore" });
    } catch {
    }
    try {
      import_fs.default.rmSync(workDir, { recursive: true, force: true });
    } catch {
    }
    const elapsedSec = ((Date.now() - startedAt) / 1e3).toFixed(1);
    activeRenderJobState = {
      running: false,
      progressPct: 100,
      currentStep: clips.length,
      totalSteps: clips.length,
      stageLabel: `\u2705 \xA1Exportaci\xF3n completada en ${elapsedSec}s!`,
      startedAt,
      outputPath: finalOutputPath,
      fileName: finalFileName
    };
    res.json({
      ok: true,
      outputPath: finalOutputPath,
      fileName: finalFileName,
      clipsRendered: normalizedClipPaths.length,
      elapsedSec
    });
  } catch (err) {
    try {
      import_fs.default.rmSync(workDir, { recursive: true, force: true });
    } catch {
    }
    activeRenderJobState = {
      running: false,
      progressPct: 0,
      currentStep: 0,
      totalSteps: 0,
      stageLabel: "",
      startedAt: 0,
      error: err?.message || "Error ejecutando FFmpeg para renderizar el documental."
    };
    console.error("Error en renderizado nativo FFmpeg:", err);
    res.status(500).json({
      error: err.message || "Error ejecutando FFmpeg para renderizar el documental."
    });
  }
});
async function analyzeClipSmartReframe9x16(ffmpegBin, mp4Path, clipNumber, fileName, promptHint = "") {
  const W = 160;
  const H = 90;
  const winW = 51;
  const maxLeftX = W - winW;
  const frameByteSize = W * H * 3;
  const rawBuffer = await new Promise((resolve) => {
    const chunks = [];
    const proc = (0, import_child_process.spawn)(
      ffmpegBin,
      [
        "-hide_banner",
        "-loglevel",
        "error",
        "-i",
        mp4Path,
        "-vf",
        `fps=0.75,scale=${W}:${H}:flags=fast_bilinear`,
        "-frames:v",
        "6",
        "-f",
        "rawvideo",
        "-pix_fmt",
        "rgb24",
        "pipe:1"
      ],
      { stdio: ["ignore", "pipe", "ignore"] }
    );
    proc.stdout?.on("data", (chunk) => chunks.push(chunk));
    proc.on("close", () => resolve(Buffer.concat(chunks)));
    proc.on("error", () => resolve(Buffer.alloc(0)));
  });
  const numFrames = Math.floor(rawBuffer.length / frameByteSize);
  if (numFrames <= 0) {
    return {
      clipNumber,
      fileName,
      reframe9x16Mode: "auto_center",
      focusXStart: 50,
      focusXEnd: 50,
      focusY: 50,
      confidence: 0.5,
      reason: "Encuadre central est\xE1ndar (50%)"
    };
  }
  const perFrameRawNormX = [];
  const perFrameConfidence = [];
  const globalColScores = new Float64Array(W);
  const earlyColAction = new Float64Array(W);
  const lateColAction = new Float64Array(W);
  for (let f = 0; f < numFrames; f++) {
    const baseOffset = f * frameByteSize;
    const prevOffset = f > 0 ? (f - 1) * frameByteSize : -1;
    const colScores = new Float64Array(W);
    const sampleDiffs = [];
    if (prevOffset >= 0) {
      for (let y = 10; y < H - 10; y += 6) {
        for (let x = 6; x < W - 6; x += 6) {
          const i = baseOffset + (y * W + x) * 3;
          const p = prevOffset + (y * W + x) * 3;
          sampleDiffs.push(
            Math.abs(rawBuffer[i] - rawBuffer[p]) + Math.abs(rawBuffer[i + 1] - rawBuffer[p + 1]) + Math.abs(rawBuffer[i + 2] - rawBuffer[p + 2])
          );
        }
      }
      sampleDiffs.sort((a, b) => a - b);
    }
    const baselineDiff = sampleDiffs.length > 0 ? sampleDiffs[Math.floor(sampleDiffs.length * 0.6)] : 15;
    for (let y = 6; y < H - 10; y++) {
      const isHeadBand = y >= 7 && y <= 50;
      const isTorsoBand = y > 50 && y <= 76;
      const rowWeight = isHeadBand ? 2.5 : isTorsoBand ? 1.15 : 0.35;
      for (let x = 3; x < W - 3; x++) {
        const idx = baseOffset + (y * W + x) * 3;
        const r = rawBuffer[idx];
        const g = rawBuffer[idx + 1];
        const b = rawBuffer[idx + 2];
        const luma = 0.299 * r + 0.587 * g + 0.114 * b;
        const sat = Math.max(r, g, b) - Math.min(r, g, b);
        const isSky = luma > 180 && sat < 26;
        let skinWarmScore = 0;
        if (y <= 56 && r > 52 && r > g && g >= b * 0.85 && r - b >= 15 && r - g >= 5 && luma > 38 && luma < 220) {
          const upIdx = baseOffset + (Math.max(2, y - 6) * W + x) * 3;
          const upLuma = 0.299 * rawBuffer[upIdx] + 0.587 * rawBuffer[upIdx + 1] + 0.114 * rawBuffer[upIdx + 2];
          const hairHatBoost = isHeadBand && upLuma < 65 ? 2.1 : 1;
          skinWarmScore = Math.min(55, (r - b) * 1.1) * rowWeight * hairHatBoost;
        }
        const idxLeft = idx - 3;
        const idxRight = idx + 3;
        const idxUp = idx - W * 3;
        const idxDown = idx + W * 3;
        const lapR = Math.abs(2 * r - rawBuffer[idxLeft] - rawBuffer[idxRight]) + Math.abs(2 * r - rawBuffer[idxUp] - rawBuffer[idxDown]);
        const lapG = Math.abs(2 * g - rawBuffer[idxLeft + 1] - rawBuffer[idxRight + 1]) + Math.abs(2 * g - rawBuffer[idxUp + 1] - rawBuffer[idxDown + 1]);
        const lap = (lapR + lapG) * 0.5;
        const edgeScore = !isSky && lap > 14 ? Math.min(50, (lap - 14) * 0.85) * rowWeight : 0;
        let silhouetteScore = 0;
        if ((isHeadBand || isTorsoBand) && luma < 48 && lap > 10) {
          silhouetteScore = Math.min(32, (52 - luma) * 0.45) * (isHeadBand ? 1.6 : 1);
        }
        let motionScore = 0;
        if (prevOffset >= 0 && !isSky) {
          const pIdx = prevOffset + (y * W + x) * 3;
          const rawDiff = Math.abs(r - rawBuffer[pIdx]) + Math.abs(g - rawBuffer[pIdx + 1]) + Math.abs(b - rawBuffer[pIdx + 2]);
          const netDiff = rawDiff - (baselineDiff + 12);
          if (netDiff > 0) {
            motionScore = Math.min(60, netDiff * 0.75) * rowWeight;
          }
        }
        const totalPixelSaliency = skinWarmScore + edgeScore + silhouetteScore + motionScore;
        colScores[x] += totalPixelSaliency;
        globalColScores[x] += totalPixelSaliency;
        if (f < Math.ceil(numFrames / 2)) {
          earlyColAction[x] += motionScore + skinWarmScore * 0.35;
        } else {
          lateColAction[x] += motionScore + skinWarmScore * 0.35;
        }
      }
    }
    let bestX0 = Math.round(maxLeftX * 0.5);
    let bestWinScore = -1;
    let centerWinScore = 1;
    for (let x0 = 0; x0 <= maxLeftX; x0++) {
      let winSum = 0;
      for (let dx = 0; dx < winW; dx++) {
        const normDx = (dx - winW * 0.5) / (winW * 0.5);
        const kernelW = Math.max(0.25, 1 - 0.5 * normDx * normDx);
        winSum += colScores[x0 + dx] * kernelW;
      }
      if (x0 === Math.round(maxLeftX * 0.5)) {
        centerWinScore = Math.max(1, winSum);
      }
      if (winSum > bestWinScore) {
        bestWinScore = winSum;
        bestX0 = x0;
      }
    }
    const ratioVsCenter = bestWinScore / Math.max(1, centerWinScore);
    const rawPct = bestX0 / maxLeftX * 100;
    perFrameRawNormX.push(Math.max(10, Math.min(90, rawPct)));
    perFrameConfidence.push(Math.min(0.99, Math.max(0.55, (ratioVsCenter - 0.9) * 1.8)));
  }
  const winCurve = new Float64Array(maxLeftX + 1);
  let globalBestX0 = Math.round(maxLeftX * 0.5);
  let globalBestScore = -1;
  let globalCenterScore = 1;
  for (let x0 = 0; x0 <= maxLeftX; x0++) {
    let winSum = 0;
    for (let dx = 0; dx < winW; dx++) {
      const normDx = (dx - winW * 0.5) / (winW * 0.5);
      const kernelW = Math.max(0.25, 1 - 0.5 * normDx * normDx);
      winSum += globalColScores[x0 + dx] * kernelW;
    }
    winCurve[x0] = winSum;
    const u = x0 / maxLeftX;
    const prior = 1 - 0.035 * Math.pow((u - 0.5) * 2, 2);
    const weightedScore = winSum * prior;
    if (x0 === Math.round(maxLeftX * 0.5)) {
      globalCenterScore = Math.max(1, weightedScore);
    }
    if (weightedScore > globalBestScore) {
      globalBestScore = weightedScore;
      globalBestX0 = x0;
    }
  }
  let leftBestX0 = Math.round(maxLeftX * 0.22);
  let leftBestVal = -1;
  for (let x0 = Math.round(maxLeftX * 0.08); x0 <= Math.round(maxLeftX * 0.36); x0++) {
    if (winCurve[x0] > leftBestVal) {
      leftBestVal = winCurve[x0];
      leftBestX0 = x0;
    }
  }
  let rightBestX0 = Math.round(maxLeftX * 0.78);
  let rightBestVal = -1;
  for (let x0 = Math.round(maxLeftX * 0.64); x0 <= Math.round(maxLeftX * 0.92); x0++) {
    if (winCurve[x0] > rightBestVal) {
      rightBestVal = winCurve[x0];
      rightBestX0 = x0;
    }
  }
  let centerMinVal = Infinity;
  for (let x0 = Math.round(maxLeftX * 0.4); x0 <= Math.round(maxLeftX * 0.6); x0++) {
    if (winCurve[x0] < centerMinVal) {
      centerMinVal = winCurve[x0];
    }
  }
  const bimodalBalance = Math.min(leftBestVal, rightBestVal) / Math.max(1, Math.max(leftBestVal, rightBestVal));
  const valleyRatio = centerMinVal / Math.max(1, (leftBestVal + rightBestVal) * 0.5);
  const lowerPrompt = String(promptHint || "").toLowerCase();
  const hasTwoShotPrompt = /two-shot|two shot|both men|both women|two people|on the left side[\s\S]{1,240}on the right side|from the left[\s\S]{1,140}to the right/i.test(
    lowerPrompt
  );
  const isRightToLeftPrompt = /from the right[\s\S]{1,140}to the left|on the right side[\s\S]{1,160}to the left/i.test(
    lowerPrompt
  );
  const avgConf = perFrameConfidence.reduce((a, b) => a + b, 0) / Math.max(1, perFrameConfidence.length);
  if (bimodalBalance >= 0.72 && (valleyRatio <= 0.84 || hasTwoShotPrompt && valleyRatio <= 0.96)) {
    const rawLeftPct = Math.round(leftBestX0 / maxLeftX * 100);
    const rawRightPct = Math.round(rightBestX0 / maxLeftX * 100);
    const leftFocus = Math.max(18, Math.min(34, rawLeftPct < 18 ? 22 : rawLeftPct));
    const rightFocus = Math.max(66, Math.min(82, rawRightPct > 82 ? 78 : rawRightPct));
    let earlyLeftSum = 0;
    let earlyRightSum = 0;
    let lateLeftSum = 0;
    let lateRightSum = 0;
    for (let x = 0; x < Math.floor(W * 0.45); x++) {
      earlyLeftSum += earlyColAction[x];
      lateLeftSum += lateColAction[x];
    }
    for (let x = Math.ceil(W * 0.55); x < W; x++) {
      earlyRightSum += earlyColAction[x];
      lateRightSum += lateColAction[x];
    }
    const earlyRightShare = earlyRightSum / Math.max(1, earlyLeftSum + earlyRightSum);
    const lateRightShare = lateRightSum / Math.max(1, lateLeftSum + lateRightSum);
    const panRightToLeft = isRightToLeftPrompt || !hasTwoShotPrompt && earlyRightShare - lateRightShare > 0.14;
    const fStart = panRightToLeft ? rightFocus : leftFocus;
    const fEnd = panRightToLeft ? leftFocus : rightFocus;
    const dirLabel = panRightToLeft ? "Der \u2192 Izq" : "Izq \u2192 Der";
    return {
      clipNumber,
      fileName,
      reframe9x16Mode: "auto_pan",
      focusXStart: fStart,
      focusXEnd: fEnd,
      focusY: 50,
      confidence: Number(Math.max(0.78, avgConf).toFixed(2)),
      reason: `Paneo din\xE1mico IA (${fStart}% \u2192 ${fEnd}%) entre dos sujetos (${dirLabel})`
    };
  }
  const halfIdx = Math.max(1, Math.floor(perFrameRawNormX.length / 2));
  const firstHalf = perFrameRawNormX.slice(0, halfIdx);
  const secondHalf = perFrameRawNormX.slice(halfIdx);
  const avgStart = firstHalf.reduce((acc, v) => acc + v, 0) / Math.max(1, firstHalf.length);
  const avgEnd = secondHalf.length > 0 ? secondHalf.reduce((acc, v) => acc + v, 0) / secondHalf.length : avgStart;
  const panDelta = Math.abs(avgEnd - avgStart);
  if (numFrames >= 2 && panDelta >= 12) {
    const fStart = Math.round(Math.max(16, Math.min(84, avgStart)));
    const fEnd = Math.round(Math.max(16, Math.min(84, avgEnd)));
    if (Math.abs(fEnd - fStart) >= 10) {
      return {
        clipNumber,
        fileName,
        reframe9x16Mode: "auto_pan",
        focusXStart: fStart,
        focusXEnd: fEnd,
        focusY: 50,
        confidence: Number(avgConf.toFixed(2)),
        reason: `Paneo din\xE1mico IA (${fStart}% \u2192 ${fEnd}%) siguiendo acci\xF3n/sujeto`
      };
    }
  }
  const globalRatioVsCenter = globalBestScore / Math.max(1, globalCenterScore);
  const overallFocusX = globalRatioVsCenter >= 1.045 ? Math.round(Math.max(16, Math.min(84, globalBestX0 / maxLeftX * 100))) : 50;
  if (Math.abs(overallFocusX - 50) >= 6) {
    const sideLabel = overallFocusX < 50 ? "izquierdo" : "derecho";
    return {
      clipNumber,
      fileName,
      reframe9x16Mode: "auto_focus",
      focusXStart: overallFocusX,
      focusXEnd: overallFocusX,
      focusY: 50,
      confidence: Number(avgConf.toFixed(2)),
      reason: `Enfoque inteligente IA en tercio ${sideLabel} (${overallFocusX}%)`
    };
  }
  return {
    clipNumber,
    fileName,
    reframe9x16Mode: "auto_center",
    focusXStart: 50,
    focusXEnd: 50,
    focusY: 50,
    confidence: Number(avgConf.toFixed(2)),
    reason: "Encuadre central sim\xE9trico IA (50%)"
  };
}
function resolveLocalFlowProjectFolder(folderPathQuery, folderNameQuery, docTitleQuery) {
  const raw = String(folderPathQuery || "").trim();
  const base = raw ? import_path.default.basename(raw) : "";
  let resolved = resolveLocalDocumentaryFolder(
    raw,
    folderNameQuery || base,
    docTitleQuery || raw
  );
  if (!resolved && raw && import_fs.default.existsSync(raw) && import_fs.default.statSync(raw).isDirectory()) {
    resolved = raw;
  }
  if (resolved) {
    const leaf = import_path.default.basename(resolved);
    if (/^(05_Clips_Video|Clips_Aprobados|06_Video_Final|02_Audio|03_Imagenes|04_Miniaturas)$/i.test(leaf)) {
      resolved = import_path.default.dirname(resolved);
    }
  }
  return resolved;
}
app.post("/api/editor/auto-reframe-9x16", async (req, res) => {
  try {
    const { folderPath, forceRefresh } = req.body || {};
    const ffmpegBin = getFfmpegPath();
    if (!ffmpegBin) {
      res.status(500).json({ error: "FFmpeg no disponible en este servidor." });
      return;
    }
    const rawFolder = String(folderPath || "").trim();
    const targetRoot = resolveLocalFlowProjectFolder(rawFolder);
    if (!targetRoot || !import_fs.default.existsSync(targetRoot)) {
      res.status(404).json({ error: "No se encontr\xF3 la carpeta del proyecto para analizar 9:16." });
      return;
    }
    const clipsVideoSubdir = import_path.default.join(targetRoot, "05_Clips_Video");
    const clipsApprovedSubdir = import_path.default.join(targetRoot, "Clips_Aprobados");
    const searchDirs = [clipsVideoSubdir, targetRoot, clipsApprovedSubdir].filter(
      (d) => import_fs.default.existsSync(d)
    );
    const cacheFilePath = import_path.default.join(
      import_fs.default.existsSync(clipsVideoSubdir) ? clipsVideoSubdir : targetRoot,
      ".reframe_9x16_cache.json"
    );
    let cachedMap = {};
    if (!forceRefresh && import_fs.default.existsSync(cacheFilePath)) {
      try {
        cachedMap = JSON.parse(import_fs.default.readFileSync(cacheFilePath, "utf8")) || {};
      } catch {
        cachedMap = {};
      }
    }
    const promptHintByClipNum = /* @__PURE__ */ new Map();
    try {
      const allDocs = readDocumentaries();
      const normRootBase = import_path.default.basename(targetRoot).normalize("NFC").toLowerCase();
      const matchedDoc = allDocs.find((d) => {
        const dt = String(d?.title || "").normalize("NFC").toLowerCase();
        const df = String(d?.downloadFolderName || "").normalize("NFC").toLowerCase();
        return df && normRootBase.includes(df) || dt && normRootBase.includes(dt.slice(0, 14)) || normRootBase.includes("76") && dt.includes("76") || normRootBase.includes("75") && dt.includes("75");
      });
      if (matchedDoc && Array.isArray(matchedDoc.clips)) {
        for (const c of matchedDoc.clips) {
          const cn = Number(c?.clipNumber);
          if (Number.isFinite(cn) && cn > 0) {
            promptHintByClipNum.set(
              cn,
              `${c.imagePrompt || ""} ${c.videoPrompt || ""} ${c.narrationSegment || ""}`
            );
          }
        }
      }
    } catch {
    }
    const clipFilesByNum = /* @__PURE__ */ new Map();
    for (const dir of searchDirs) {
      let entries = [];
      try {
        entries = import_fs.default.readdirSync(dir);
      } catch {
        continue;
      }
      const mp4Files = entries.filter((f) => !f.startsWith(".") && /\.(mp4|mov|webm)$/i.test(f)).sort((a, b) => {
        const a4k = /[_\-]4k\.(mp4|mov|webm)$/i.test(a) ? 1 : 0;
        const b4k = /[_\-]4k\.(mp4|mov|webm)$/i.test(b) ? 1 : 0;
        return b4k - a4k;
      });
      for (const f of mp4Files) {
        const m = f.match(/^(?:clip[_\-\s.]*)?0*(\d+)[_\-\s.]/i);
        if (!m) continue;
        const num = parseInt(m[1], 10);
        if (!Number.isFinite(num) || num <= 0 || num === 999) continue;
        if (!clipFilesByNum.has(num)) {
          clipFilesByNum.set(num, { filePath: import_path.default.join(dir, f), fileName: f });
        }
      }
    }
    const sortedNums = Array.from(clipFilesByNum.keys()).sort((a, b) => a - b);
    const results = [];
    let queueIdx = 0;
    const runWorker = async () => {
      while (queueIdx < sortedNums.length) {
        const myIdx = queueIdx++;
        const clipNum = sortedNums[myIdx];
        const info = clipFilesByNum.get(clipNum);
        let statMtime = 0;
        let statSize = 0;
        try {
          const st = import_fs.default.statSync(info.filePath);
          statMtime = Math.round(st.mtimeMs);
          statSize = st.size;
        } catch {
        }
        const cacheKey = `v3_${clipNum}_${info.fileName}`;
        const existing = cachedMap[cacheKey];
        if (!forceRefresh && existing && existing.mtimeMs === statMtime && existing.sizeBytes === statSize) {
          results.push(existing);
          continue;
        }
        const analyzed = await analyzeClipSmartReframe9x16(
          ffmpegBin,
          info.filePath,
          clipNum,
          info.fileName,
          promptHintByClipNum.get(clipNum) || ""
        );
        analyzed.mtimeMs = statMtime;
        analyzed.sizeBytes = statSize;
        cachedMap[cacheKey] = analyzed;
        results.push(analyzed);
      }
    };
    const concurrency = Math.min(4, Math.max(1, sortedNums.length));
    await Promise.all(Array.from({ length: concurrency }, () => runWorker()));
    results.sort((a, b) => a.clipNumber - b.clipNumber);
    try {
      import_fs.default.writeFileSync(cacheFilePath, JSON.stringify(cachedMap, null, 2), "utf8");
    } catch {
    }
    res.json({
      ok: true,
      totalAnalyzed: results.length,
      results
    });
  } catch (err) {
    console.error("Error en /api/editor/auto-reframe-9x16:", err);
    res.status(500).json({
      error: err?.message || "Error analizando Auto-Reframe 9:16."
    });
  }
});
app.get("/api/editor/exported-videos", (req, res) => {
  try {
    const rawFolder = String(req.query.folderPath || "").trim();
    if (!rawFolder) {
      res.json({ ok: true, videos: { "16:9": null, "9:16": null }, allFiles: [] });
      return;
    }
    const targetRoot = resolveLocalFlowProjectFolder(rawFolder);
    if (!targetRoot || !import_fs.default.existsSync(targetRoot)) {
      res.json({ ok: true, videos: { "16:9": null, "9:16": null }, allFiles: [] });
      return;
    }
    const videoFinalSubdir = import_path.default.join(targetRoot, "06_Video_Final");
    const searchDirs = [videoFinalSubdir, targetRoot].filter((d) => import_fs.default.existsSync(d));
    const foundFiles = [];
    for (const dir of searchDirs) {
      let entries = [];
      try {
        entries = import_fs.default.readdirSync(dir);
      } catch {
        continue;
      }
      for (const f of entries) {
        if (f.startsWith(".") || !/\.mp4$/i.test(f)) continue;
        if (!/(?:16x9|9x16|1x1)/i.test(f) && dir === targetRoot) continue;
        const fullPath = import_path.default.join(dir, f);
        try {
          const st = import_fs.default.statSync(fullPath);
          if (!st.isFile() || st.size < 1e5) continue;
          const ar = /9x16/i.test(f) ? "9:16" : /16x9/i.test(f) ? "16:9" : /1x1/i.test(f) ? "1:1" : "other";
          foundFiles.push({
            fileName: f,
            filePath: fullPath,
            aspectRatio: ar,
            sizeMB: (st.size / (1024 * 1024)).toFixed(1),
            updatedAt: new Date(st.mtimeMs).toLocaleTimeString("es-ES", {
              hour: "2-digit",
              minute: "2-digit"
            }),
            mtimeMs: st.mtimeMs
          });
        } catch {
        }
      }
    }
    foundFiles.sort((a, b) => b.mtimeMs - a.mtimeMs);
    const latest16x9 = foundFiles.find((f) => f.aspectRatio === "16:9") || null;
    const latest9x16 = foundFiles.find((f) => f.aspectRatio === "9:16") || null;
    res.json({
      ok: true,
      videos: {
        "16:9": latest16x9,
        "9:16": latest9x16
      },
      allFiles: foundFiles
    });
  } catch (err) {
    res.status(500).json({ error: err?.message || "Error consultando videos exportados." });
  }
});
var OFFICIAL_LOGO_FILE = import_path.default.join(DATA_DIR, "official_huellas_logo.json");
app.get("/api/assets/official-logo", (_req, res) => {
  try {
    if (import_fs.default.existsSync(OFFICIAL_LOGO_FILE)) {
      const parsed = JSON.parse(import_fs.default.readFileSync(OFFICIAL_LOGO_FILE, "utf8"));
      res.json({ ok: true, logoDataUrl: parsed.logoDataUrl || "", updatedAt: parsed.updatedAt || "" });
      return;
    }
    res.json({ ok: true, logoDataUrl: "" });
  } catch {
    res.json({ ok: true, logoDataUrl: "" });
  }
});
app.post("/api/assets/official-logo", (req, res) => {
  try {
    const { logoDataUrl } = req.body;
    if (!logoDataUrl) {
      res.status(400).json({ error: "No se envi\xF3 imagen de logo." });
      return;
    }
    if (!import_fs.default.existsSync(DATA_DIR)) {
      import_fs.default.mkdirSync(DATA_DIR, { recursive: true });
    }
    const payload = {
      logoDataUrl: String(logoDataUrl),
      updatedAt: (/* @__PURE__ */ new Date()).toISOString()
    };
    import_fs.default.writeFileSync(OFFICIAL_LOGO_FILE, JSON.stringify(payload, null, 2), "utf8");
    res.json({ ok: true, ...payload });
  } catch (err) {
    res.status(500).json({ error: err.message || "Error guardando logo oficial." });
  }
});
var OFFICIAL_INTRO_MP4_FILE = import_path.default.join(DATA_DIR, "official_huellas_intro.mp4");
var OFFICIAL_INTRO_META_FILE = import_path.default.join(DATA_DIR, "official_huellas_intro.json");
app.get("/api/assets/official-intro", (_req, res) => {
  try {
    if (import_fs.default.existsSync(OFFICIAL_INTRO_MP4_FILE)) {
      const stat = import_fs.default.statSync(OFFICIAL_INTRO_MP4_FILE);
      let meta = {};
      if (import_fs.default.existsSync(OFFICIAL_INTRO_META_FILE)) {
        try {
          meta = JSON.parse(import_fs.default.readFileSync(OFFICIAL_INTRO_META_FILE, "utf8"));
        } catch {
        }
      }
      res.json({
        ok: true,
        hasIntro: true,
        introUrl: `/api/assets/official-intro-stream?t=${Math.floor(stat.mtimeMs)}`,
        fileName: meta.fileName || "Intro_Oficial_Huellas_4s.mp4",
        updatedAt: meta.updatedAt || new Date(stat.mtimeMs).toISOString()
      });
      return;
    }
    res.json({ ok: true, hasIntro: false, introUrl: "" });
  } catch {
    res.json({ ok: true, hasIntro: false, introUrl: "" });
  }
});
app.get("/api/assets/official-intro-stream", (_req, res) => {
  try {
    if (!import_fs.default.existsSync(OFFICIAL_INTRO_MP4_FILE)) {
      res.status(404).json({ error: "No hay video de Intro Oficial guardado." });
      return;
    }
    res.setHeader("Content-Type", "video/mp4");
    res.sendFile(OFFICIAL_INTRO_MP4_FILE);
  } catch (err) {
    res.status(500).json({ error: err.message || "Error sirviendo Intro Oficial." });
  }
});
app.post("/api/assets/official-intro", (req, res) => {
  try {
    const { videoDataUrl, fileName = "Intro_Oficial_Huellas_4s.mp4" } = req.body || {};
    if (!videoDataUrl || typeof videoDataUrl !== "string") {
      res.status(400).json({ error: "No se envi\xF3 el archivo de video del Intro Oficial." });
      return;
    }
    if (!import_fs.default.existsSync(DATA_DIR)) {
      import_fs.default.mkdirSync(DATA_DIR, { recursive: true });
    }
    const base64Clean = videoDataUrl.replace(/^data:[^;]+;base64,/, "");
    const buf = Buffer.from(base64Clean, "base64");
    import_fs.default.writeFileSync(OFFICIAL_INTRO_MP4_FILE, buf);
    const meta = {
      fileName: String(fileName),
      sizeBytes: buf.length,
      updatedAt: (/* @__PURE__ */ new Date()).toISOString()
    };
    import_fs.default.writeFileSync(OFFICIAL_INTRO_META_FILE, JSON.stringify(meta, null, 2), "utf8");
    res.json({
      ok: true,
      hasIntro: true,
      introUrl: `/api/assets/official-intro-stream?t=${Date.now()}`,
      ...meta
    });
  } catch (err) {
    res.status(500).json({ error: err.message || "Error guardando Intro Oficial." });
  }
});
function extractVideoNumberFromText(text) {
  const t = String(text || "").normalize("NFC").toLowerCase();
  const m = t.match(/\b(?:video|documental|ep\.?)\s*0*(\d+)\b/i);
  if (m) return String(parseInt(m[1], 10));
  if (t.includes("\xE9xodo espa\xF1ol") || t.includes("exodo espanol") || t.includes("malia\xF1o")) return "76";
  if (t.includes("louvre")) return "75";
  if (t.includes("princesas de la edad media")) return "74";
  return "";
}
function resolveLocalDocumentaryFolder(folderPathQuery, folderNameQuery, docTitleQuery) {
  const rawPath = String(folderPathQuery || "").trim();
  const rawName = String(folderNameQuery || "").trim();
  const rawTitle = String(docTitleQuery || "").trim();
  const homeDir = process.env.HOME || process.env.USERPROFILE || "";
  if (!homeDir) return "";
  const icloudVideosDir = import_path.default.join(
    homeDir,
    "Library",
    "Mobile Documents",
    "com~apple~CloudDocs",
    "0YouTube",
    "Huellas de la Humanidad",
    "Videos"
  );
  const titleVidNum = extractVideoNumberFromText(rawTitle);
  const pathVidNum = extractVideoNumberFromText(rawPath);
  const nameVidNum = extractVideoNumberFromText(rawName);
  if (titleVidNum && import_fs.default.existsSync(icloudVideosDir) && import_fs.default.statSync(icloudVideosDir).isDirectory()) {
    const prefixRegex = new RegExp(`^video\\s*0*${titleVidNum}\\b`, "i");
    for (const entry of import_fs.default.readdirSync(icloudVideosDir)) {
      if (prefixRegex.test(entry.normalize("NFC"))) {
        const full = import_path.default.join(icloudVideosDir, entry);
        if (import_fs.default.existsSync(full) && import_fs.default.statSync(full).isDirectory()) return full;
      }
    }
  }
  const pathContradictsTitle = Boolean(titleVidNum && pathVidNum && titleVidNum !== pathVidNum);
  if (!pathContradictsTitle && rawPath && import_fs.default.existsSync(rawPath) && import_fs.default.statSync(rawPath).isDirectory()) {
    return rawPath;
  }
  const nameContradictsTitle = Boolean(titleVidNum && nameVidNum && titleVidNum !== nameVidNum);
  if (!nameContradictsTitle && rawName) {
    const candidates = [
      import_path.default.join(icloudVideosDir, rawName),
      import_path.default.join(icloudVideosDir, rawName.normalize("NFD")),
      import_path.default.join(icloudVideosDir, rawName.normalize("NFC")),
      import_path.default.join(homeDir, "Desktop", rawName),
      import_path.default.join(homeDir, "Downloads", rawName),
      import_path.default.join(homeDir, "Documents", rawName),
      import_path.default.join(homeDir, rawName)
    ];
    for (const c of candidates) {
      if (import_fs.default.existsSync(c) && import_fs.default.statSync(c).isDirectory()) {
        return c;
      }
    }
    if (import_fs.default.existsSync(icloudVideosDir) && import_fs.default.statSync(icloudVideosDir).isDirectory()) {
      const targetNorm = rawName.normalize("NFC").toLowerCase();
      for (const entry of import_fs.default.readdirSync(icloudVideosDir)) {
        if (entry.normalize("NFC").toLowerCase() === targetNorm) {
          const full = import_path.default.join(icloudVideosDir, entry);
          if (import_fs.default.existsSync(full) && import_fs.default.statSync(full).isDirectory()) return full;
        }
      }
    }
  }
  if (!titleVidNum && import_fs.default.existsSync(icloudVideosDir) && import_fs.default.statSync(icloudVideosDir).isDirectory()) {
    const combinedVidNum = nameVidNum || pathVidNum;
    if (combinedVidNum) {
      const prefixRegex = new RegExp(`^video\\s*0*${combinedVidNum}\\b`, "i");
      for (const entry of import_fs.default.readdirSync(icloudVideosDir)) {
        if (prefixRegex.test(entry.normalize("NFC"))) {
          const full = import_path.default.join(icloudVideosDir, entry);
          if (import_fs.default.existsSync(full) && import_fs.default.statSync(full).isDirectory()) return full;
        }
      }
    }
  }
  return "";
}
app.get("/api/flow/list-folder-media", async (req, res) => {
  try {
    const folderPath = String(req.query.folderPath || "");
    const folderName = String(req.query.folderName || "");
    const docTitle = String(req.query.docTitle || "");
    const resolvedRoot = resolveLocalDocumentaryFolder(folderPath, folderName, docTitle);
    const clipVideos = [];
    const clipFrames = [];
    const voiceoverFiles = [];
    const sunoFiles = [];
    if (resolvedRoot) {
      const clipsDir = import_path.default.join(resolvedRoot, "05_Clips_Video");
      if (!import_fs.default.existsSync(clipsDir)) {
        try {
          import_fs.default.mkdirSync(clipsDir, { recursive: true });
        } catch {
        }
      }
      try {
        for (const rootEntry of import_fs.default.readdirSync(resolvedRoot)) {
          if (rootEntry.startsWith(".") || /^Documental_|_Master|_Final/i.test(rootEntry)) continue;
          if (/^(?:(?:clip|video|scene|escena)[_\-\s.]*)?0*\d+[_\-\s.(].*\.(mp4|webm|mov)$/i.test(rootEntry)) {
            const srcLoose = import_path.default.join(resolvedRoot, rootEntry);
            if (import_fs.default.statSync(srcLoose).isFile()) {
              import_fs.default.renameSync(srcLoose, import_path.default.join(clipsDir, rootEntry));
            }
          }
        }
      } catch {
      }
      if (!activeClipsPipelineStatus.running && import_fs.default.existsSync(clipsDir) && import_fs.default.statSync(clipsDir).isDirectory()) {
        try {
          const allDirEntries = import_fs.default.readdirSync(clipsDir);
          const mtime4kByClip = /* @__PURE__ */ new Map();
          const canonicalBaseByClip = /* @__PURE__ */ new Map();
          const rawNon4kVideos = [];
          for (const entry of allDirEntries) {
            if (entry.startsWith(".") || /\.tmp\.(mp4|webm|mov)$/i.test(entry)) continue;
            const full = import_path.default.join(clipsDir, entry);
            let st;
            try {
              st = import_fs.default.statSync(full);
            } catch {
              continue;
            }
            if (!st.isFile()) continue;
            const mFrame = entry.match(/^0*(\d+)_Imagen_Inicial_(.+)\.(jpg|jpeg|png|webp)$/i);
            if (mFrame) {
              const cNum = parseInt(mFrame[1], 10);
              if (cNum > 0) {
                const padded = String(cNum).padStart(2, "0");
                if (!canonicalBaseByClip.has(cNum)) {
                  canonicalBaseByClip.set(cNum, `${padded}_${mFrame[2]}`);
                }
              }
              continue;
            }
            const mVid = entry.match(
              /^(?:(?:clip|video|scene|escena)[_\-\s.]*)?0*(\d+)[_\-\s.(].*\.(mp4|webm|mov)$/i
            );
            if (mVid) {
              const cNum = parseInt(mVid[1], 10);
              if (cNum <= 0) continue;
              const is4kName = /[_\-]4k\.(mp4|webm|mov)$/i.test(entry);
              const isReal4k = is4kName && st.size >= 12 * 1024 * 1024;
              const ext = import_path.default.extname(entry);
              const cleanBase = import_path.default.basename(entry, ext).replace(/[_\-]4k$/i, "");
              if (new RegExp(`^0*${cNum}_[a-zA-Z0-9]`, "i").test(entry) && !/^(?:clip|video|scene|escena)[_\-\s.]/i.test(entry)) {
                canonicalBaseByClip.set(cNum, cleanBase);
              }
              if (isReal4k) {
                const prevMtime = mtime4kByClip.get(cNum) || 0;
                if (st.mtimeMs > prevMtime) {
                  mtime4kByClip.set(cNum, st.mtimeMs);
                }
              } else if (st.size > 1e4) {
                rawNon4kVideos.push({
                  entry,
                  full,
                  clipNum: cNum,
                  mtimeMs: st.mtimeMs,
                  size: st.size
                });
              }
            }
          }
          const non4kVideos = rawNon4kVideos.filter((v) => {
            const existing4kMtime = mtime4kByClip.get(v.clipNum) || 0;
            if (existing4kMtime > 0 && v.mtimeMs <= existing4kMtime) {
              try {
                import_fs.default.unlinkSync(v.full);
              } catch {
              }
              return false;
            }
            return true;
          });
          const toAutoUpscale = non4kVideos.sort((a, b) => b.mtimeMs - a.mtimeMs).slice(0, 4);
          for (const item of toAutoUpscale) {
            if (!import_fs.default.existsSync(item.full)) continue;
            const paddedNum = String(item.clipNum).padStart(2, "0");
            let canonicalBase = canonicalBaseByClip.get(item.clipNum) || "";
            if (!canonicalBase) {
              let rawBase = import_path.default.basename(item.entry, import_path.default.extname(item.entry)).replace(/[_\-]4k$/i, "").replace(/^(?:(?:clip|video|scene|escena)[_\-\s.]*)?0*\d+[_\-\s.]*/i, "").replace(/\s+/g, "_").replace(/_+/g, "_").replace(/^_|_$/g, "");
              if (!rawBase) rawBase = "Clip";
              canonicalBase = `${paddedNum}_${rawBase}`;
            }
            const final4kName = `${canonicalBase}_4K.mp4`;
            const final4kFull = import_path.default.join(clipsDir, final4kName);
            const tmp4kFull = import_path.default.join(
              import_os.default.tmpdir(),
              `huellas_autoload_4k_${canonicalBase}_${Date.now()}_${Math.random().toString(36).slice(2, 5)}.mp4`
            );
            try {
              await upscaleFileTo4KOnDisk(item.full, tmp4kFull, "16:9");
              if (import_fs.default.existsSync(tmp4kFull) && import_fs.default.statSync(tmp4kFull).size > 1e4) {
                import_fs.default.copyFileSync(tmp4kFull, final4kFull);
                try {
                  (0, import_child_process.execSync)(`chflags nohidden "${final4kFull.replace(/"/g, '\\"')}"`, { stdio: "ignore" });
                } catch {
                }
                const prefix = `${paddedNum}_`;
                for (const existing of import_fs.default.readdirSync(clipsDir)) {
                  const fullExisting = import_path.default.join(clipsDir, existing);
                  if (import_path.default.resolve(fullExisting) !== import_path.default.resolve(final4kFull) && /\.(mp4|mov|webm)$/i.test(existing) && (existing.startsWith(prefix) || existing === item.entry)) {
                    try {
                      import_fs.default.unlinkSync(fullExisting);
                    } catch {
                    }
                  }
                }
                for (const subCache of [".optical_flow_cache", ".foley_only_cache"]) {
                  const cacheDir = import_path.default.join(clipsDir, subCache);
                  if (import_fs.default.existsSync(cacheDir) && import_fs.default.statSync(cacheDir).isDirectory()) {
                    for (const cFile of import_fs.default.readdirSync(cacheDir)) {
                      if (cFile.startsWith(prefix)) {
                        try {
                          import_fs.default.unlinkSync(import_path.default.join(cacheDir, cFile));
                        } catch {
                        }
                      }
                    }
                  }
                }
                const suffixWithoutNum = canonicalBase.replace(/^0*\d+_/, "");
                const frameFileName = `${paddedNum}_Imagen_Inicial_${suffixWithoutNum}.jpg`;
                const frameFullPath = import_path.default.join(clipsDir, frameFileName);
                try {
                  const ffmpegBin = getFfmpegPath();
                  await new Promise((resolve) => {
                    const proc = (0, import_child_process.spawn)(
                      ffmpegBin,
                      ["-y", "-i", final4kFull, "-frames:v", "1", "-q:v", "2", frameFullPath],
                      { stdio: "ignore" }
                    );
                    proc.on("error", () => resolve());
                    proc.on("close", () => resolve());
                  });
                  if (import_fs.default.existsSync(frameFullPath)) {
                    (0, import_child_process.execSync)(`chflags nohidden "${frameFullPath.replace(/"/g, '\\"')}"`, { stdio: "ignore" });
                  }
                } catch {
                }
              }
            } catch (err) {
              console.warn(`[Auto-4K on Load] Failed to upscale ${item.entry}:`, err);
            } finally {
              try {
                if (import_fs.default.existsSync(tmp4kFull)) import_fs.default.unlinkSync(tmp4kFull);
              } catch {
              }
            }
          }
        } catch {
        }
      }
      const videoSubfolders = ["05_Clips_Video", "Clips_Aprobados", ""];
      const seenVideoClips = /* @__PURE__ */ new Set();
      for (const sub of videoSubfolders) {
        const dir = sub ? import_path.default.join(resolvedRoot, sub) : resolvedRoot;
        if (!import_fs.default.existsSync(dir) || !import_fs.default.statSync(dir).isDirectory()) continue;
        const entries = import_fs.default.readdirSync(dir).sort((a, b) => {
          const a4k = /[_\-]4k\.(mp4|webm|mov)$/i.test(a) ? 1 : 0;
          const b4k = /[_\-]4k\.(mp4|webm|mov)$/i.test(b) ? 1 : 0;
          if (b4k !== a4k) return b4k - a4k;
          try {
            return import_fs.default.statSync(import_path.default.join(dir, b)).mtimeMs - import_fs.default.statSync(import_path.default.join(dir, a)).mtimeMs;
          } catch {
            return 0;
          }
        });
        for (const entry of entries) {
          if (entry.startsWith(".") || /\.tmp\.(mp4|webm|mov)$/i.test(entry)) continue;
          const full = import_path.default.join(dir, entry);
          const st = import_fs.default.statSync(full);
          if (!st.isFile()) continue;
          if (st.mode && /[_\-]4k\.(mp4|webm|mov)$/i.test(entry)) {
            try {
              (0, import_child_process.execSync)(`chflags nohidden "${full.replace(/"/g, '\\"')}"`, { stdio: "ignore" });
            } catch {
            }
          }
          const mVid = entry.match(/^(?:(?:clip|video)[_\-\s.]*)?0*(\d+)[_\-\s.(].*\.(mp4|webm|mov)$/i);
          if (mVid) {
            const num = parseInt(mVid[1], 10);
            if (num > 0 && !seenVideoClips.has(num)) {
              seenVideoClips.add(num);
              clipVideos.push({
                clipNumber: num,
                fileName: entry,
                url: `/api/flow/serve-folder-file?filePath=${encodeURIComponent(full)}&v=${Math.floor(st.mtimeMs)}`
              });
            }
          }
          const mImg = entry.match(/^(?:(?:image|imagen|clip)[_\-\s.]*)?0*(\d+)[_\-\s.(].*\.(png|jpg|jpeg|webp)$/i);
          if (mImg) {
            const num = parseInt(mImg[1], 10);
            if (num > 0) {
              clipFrames.push({
                clipNumber: num,
                fileName: entry,
                url: `/api/flow/serve-folder-file?filePath=${encodeURIComponent(full)}&v=${Math.floor(st.mtimeMs)}`
              });
            }
          }
        }
      }
      const audioSubfolders = ["02_Audio", "Audio", ""];
      for (const sub of audioSubfolders) {
        const dir = sub ? import_path.default.join(resolvedRoot, sub) : resolvedRoot;
        if (!import_fs.default.existsSync(dir) || !import_fs.default.statSync(dir).isDirectory()) continue;
        const entries = import_fs.default.readdirSync(dir);
        const hasFlowMusicByNum = /* @__PURE__ */ new Set();
        const hasTitledFlowMusicByNum = /* @__PURE__ */ new Set();
        for (const entry of entries) {
          const fullCheck = import_path.default.join(dir, entry);
          let stCheck = null;
          try {
            stCheck = import_fs.default.statSync(fullCheck);
          } catch {
          }
          if (!stCheck || !stCheck.isFile() || stCheck.size < 1024) continue;
          const fm = entry.match(/^(?:flowmusic|flow_music)[_\-\s]*0*(\d+)/i);
          if (fm) {
            const num = parseInt(fm[1], 10) || 1;
            hasFlowMusicByNum.add(num);
            if (!/^(?:flowmusic|flow_music)[_\-\s]*0*\d+\.(mp3|wav|m4a|ogg)$/i.test(entry)) {
              hasTitledFlowMusicByNum.add(num);
            }
          }
        }
        for (const entry of entries) {
          const full = import_path.default.join(dir, entry);
          let st;
          try {
            st = import_fs.default.statSync(full);
          } catch {
            continue;
          }
          if (!st.isFile()) continue;
          if (!/\.(mp3|wav|m4a|ogg)$/i.test(entry)) continue;
          if (st.size < 1024) {
            try {
              import_fs.default.unlinkSync(full);
            } catch {
            }
            continue;
          }
          const legacySunoMatch = entry.match(/^suno[_\-\s]*0*(\d+)\.(mp3|wav|m4a|ogg)$/i);
          if (legacySunoMatch && hasFlowMusicByNum.has(parseInt(legacySunoMatch[1], 10) || 1)) {
            try {
              import_fs.default.unlinkSync(full);
              continue;
            } catch {
            }
          }
          const untitledFlowMatch = entry.match(/^(?:flowmusic|flow_music)[_\-\s]*0*(\d+)\.(mp3|wav|m4a|ogg)$/i);
          if (untitledFlowMatch && hasTitledFlowMusicByNum.has(parseInt(untitledFlowMatch[1], 10) || 1)) {
            try {
              import_fs.default.unlinkSync(full);
              continue;
            } catch {
            }
          }
          const sunoMatch = entry.match(
            /(?:flowmusic|flow_music|suno|musica|pista|track)[_\-\s]*0*(\d+)/i
          );
          if (sunoMatch) {
            sunoFiles.push({
              trackNumber: parseInt(sunoMatch[1], 10) || 1,
              fileName: entry,
              url: `/api/flow/serve-folder-file?filePath=${encodeURIComponent(full)}&v=${Math.floor(st.mtimeMs)}`
            });
          } else {
            voiceoverFiles.push({
              fileName: entry,
              url: `/api/flow/serve-folder-file?filePath=${encodeURIComponent(full)}&v=${Math.floor(st.mtimeMs)}`
            });
          }
        }
      }
    }
    const localTtsFiles = [];
    if (import_fs.default.existsSync(TTS_DIR)) {
      const ttsEntries = import_fs.default.readdirSync(TTS_DIR).filter((f) => /\.(mp3|wav)$/i.test(f)).sort((a, b) => {
        try {
          return import_fs.default.statSync(import_path.default.join(TTS_DIR, b)).mtimeMs - import_fs.default.statSync(import_path.default.join(TTS_DIR, a)).mtimeMs;
        } catch {
          return 0;
        }
      });
      for (const f of ttsEntries) {
        localTtsFiles.push({
          fileName: f,
          url: `/tts-files/${f}`
        });
      }
    }
    const clipPrompts = {};
    if (resolvedRoot) {
      const promptsTxtPath = import_path.default.join(resolvedRoot, "01_Guion_y_SEO", "Prompts_Clips_Flow.txt");
      if (import_fs.default.existsSync(promptsTxtPath)) {
        try {
          const txt = import_fs.default.readFileSync(promptsTxtPath, "utf8");
          for (const rawLine of txt.split(/\r?\n/)) {
            const line = rawLine.trim();
            const mImg = line.match(/^Image\s+(\d+)\s*:\s*(.+)$/i);
            if (mImg) {
              const num = parseInt(mImg[1], 10);
              if (num > 0) {
                clipPrompts[num] = { ...clipPrompts[num] || {}, imagePrompt: line };
              }
              continue;
            }
            const mClip = line.match(/^Clip\s+(\d+)(?:\s*\([^)]*\))?\s*:\s*(.+)$/i);
            if (mClip) {
              const num = parseInt(mClip[1], 10);
              if (num > 0) {
                clipPrompts[num] = { ...clipPrompts[num] || {}, videoPrompt: line };
              }
            }
          }
        } catch {
        }
      }
    }
    res.json({
      ok: true,
      resolvedRoot,
      clipVideos: clipVideos.sort((a, b) => a.clipNumber - b.clipNumber),
      clipFrames: clipFrames.sort((a, b) => a.clipNumber - b.clipNumber),
      voiceoverFiles,
      sunoFiles: sunoFiles.sort((a, b) => a.trackNumber - b.trackNumber),
      localTtsFiles,
      clipPrompts
    });
  } catch (err) {
    res.json({
      ok: false,
      error: err.message || "Error listando archivos de carpeta.",
      clipVideos: [],
      clipFrames: [],
      voiceoverFiles: [],
      sunoFiles: [],
      localTtsFiles: []
    });
  }
});
app.get("/api/flow/serve-folder-file", (req, res) => {
  try {
    let filePath = String(req.query.filePath || "").trim();
    if (!filePath) {
      res.status(404).send("Archivo no encontrado");
      return;
    }
    if (/_foley_(?:only|v2)\.mp4$/i.test(filePath)) {
      const v3Candidate = filePath.replace(/_foley_(?:only|v2)\.mp4$/i, "_foley_v3.mp4");
      if (import_fs.default.existsSync(v3Candidate) && import_fs.default.statSync(v3Candidate).isFile()) {
        filePath = v3Candidate;
      } else if (filePath.includes(".foley_only_cache")) {
        const parentDir = import_path.default.dirname(import_path.default.dirname(filePath));
        const origName = import_path.default.basename(filePath).replace(/_foley_(?:only|v2)\.mp4$/i, ".mp4");
        const origCandidate = import_path.default.join(parentDir, origName);
        if (import_fs.default.existsSync(origCandidate) && import_fs.default.statSync(origCandidate).isFile()) {
          filePath = origCandidate;
        }
      } else {
        const unSuffixed = filePath.replace(/_foley_(?:only|v2)\.mp4$/i, ".mp4");
        if (import_fs.default.existsSync(unSuffixed) && import_fs.default.statSync(unSuffixed).isFile()) {
          filePath = unSuffixed;
        }
      }
    }
    if (/(?:^|[\/\\])(Intro|Outro)\.mp4$/i.test(filePath)) {
      const baseName = import_path.default.basename(filePath, ".mp4");
      const webPreviewCandidate = import_path.default.join(
        import_path.default.dirname(filePath),
        `.${baseName}_WebPreview.mp4`
      );
      if (import_fs.default.existsSync(webPreviewCandidate) && import_fs.default.statSync(webPreviewCandidate).isFile()) {
        filePath = webPreviewCandidate;
      }
    }
    if (!import_fs.default.existsSync(filePath) || !import_fs.default.statSync(filePath).isFile()) {
      const ext = import_path.default.extname(filePath);
      const baseNoExt = import_path.default.basename(filePath, ext).replace(/[_\-]4k$/i, "");
      const dir = import_path.default.dirname(filePath);
      const candidate4k = import_path.default.join(dir, `${baseNoExt}_4K${ext}`);
      if (import_fs.default.existsSync(candidate4k) && import_fs.default.statSync(candidate4k).isFile()) {
        filePath = candidate4k;
      } else {
        res.status(404).send("Archivo no encontrado");
        return;
      }
    }
    const resolvedFilePath = import_path.default.resolve(filePath);
    try {
      const fileSize = import_fs.default.statSync(resolvedFilePath).size;
      const rangeHeader = req.headers.range;
      if (typeof rangeHeader === "string") {
        const m = rangeHeader.match(/bytes=(\d*)-(\d*)/);
        if (m) {
          const start = m[1] ? parseInt(m[1], 10) : 0;
          const end = m[2] ? parseInt(m[2], 10) : fileSize - 1;
          if (start >= fileSize || start < 0) {
            delete req.headers.range;
          } else if (m[2] && end >= fileSize) {
            req.headers.range = `bytes=${start}-${Math.max(start, fileSize - 1)}`;
          }
        }
      }
    } catch {
    }
    res.setHeader("Cache-Control", "private, max-age=3600");
    res.sendFile(resolvedFilePath, { dotfiles: "allow" });
  } catch (err) {
    res.status(500).send(err.message || "Error sirviendo archivo");
  }
});
var activeClipsPipelineStatus = {
  running: false,
  phase: "idle",
  current: 0,
  total: 0,
  currentFileName: "",
  message: "",
  extractedZipsCount: 0,
  importedFilesCount: 0,
  upscaled4kCount: 0,
  already4kCount: 0
};
app.get("/api/flow/process-clips-status", (_req, res) => {
  res.json({ ok: true, ...activeClipsPipelineStatus });
});
function normalizeWordTokensForMatch(str) {
  return String(str || "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim().split(/\s+/).filter((w) => w.length >= 2);
}
function inferClipNumberFromFileName(fileName, clipsList) {
  const base = import_path.default.basename(fileName, import_path.default.extname(fileName));
  const mDirect = base.match(/^(?:(?:clip|video|scene|escena)[_\-\s.]*)?0*(\d+)(?:[_\-\s.(]|$)/i);
  if (mDirect) {
    const n = parseInt(mDirect[1], 10);
    if (n > 0 && n <= 300) return n;
  }
  const fileTokens = normalizeWordTokensForMatch(base.replace(/[_\-]?4k$/i, ""));
  if (fileTokens.length >= 2 && Array.isArray(clipsList) && clipsList.length > 0) {
    let bestClipNum = 0;
    let bestScore = 0;
    for (const c of clipsList) {
      const cNum = Number(c.clipNumber);
      if (!cNum) continue;
      const narTokens = normalizeWordTokensForMatch(c.narrationSegment || "");
      const vidTokens = normalizeWordTokensForMatch(
        String(c.videoPrompt || "").replace(/^Clip\s*\d+\s*\([^)]*\)\s*:\s*/i, "")
      );
      let score = 0;
      for (let i = 0; i < Math.min(fileTokens.length, 7); i++) {
        const tok = fileTokens[i];
        if (narTokens.slice(0, 10).includes(tok)) score += 3;
        if (vidTokens.slice(0, 12).includes(tok)) score += 2;
      }
      if (score > bestScore && score >= 5) {
        bestScore = score;
        bestClipNum = cNum;
      }
    }
    if (bestClipNum > 0) return bestClipNum;
  }
  return 0;
}
async function upscaleFileTo4KOnDisk(inputPath, outputPath, aspectRatio = "16:9") {
  const ffmpegBin = resolveFfmpegBin();
  const isVertical = aspectRatio === "9:16";
  const targetW = isVertical ? 2160 : 3840;
  const targetH = isVertical ? 3840 : 2160;
  const vfFilter = `scale=${targetW}:${targetH}:flags=bicubic,unsharp=3:3:0.5:3:3:0.0,format=yuv420p`;
  const runFfmpegCmd = (args) => new Promise((resolve, reject) => {
    const proc = (0, import_child_process.spawn)(ffmpegBin, args, { stdio: "ignore" });
    proc.on("error", reject);
    proc.on("close", (code) => {
      if (code === 0 && import_fs.default.existsSync(outputPath) && import_fs.default.statSync(outputPath).size > 1e4) {
        resolve();
      } else {
        reject(new Error(`ffmpeg exited with code ${code}`));
      }
    });
  });
  try {
    await runFfmpegCmd([
      "-y",
      "-threads",
      "0",
      "-i",
      inputPath,
      "-vf",
      vfFilter,
      "-c:v",
      "h264_videotoolbox",
      "-b:v",
      "28M",
      "-profile:v",
      "high",
      "-pix_fmt",
      "yuv420p",
      "-movflags",
      "+faststart",
      "-c:a",
      "copy",
      outputPath
    ]);
  } catch {
    await runFfmpegCmd([
      "-y",
      "-threads",
      "0",
      "-i",
      inputPath,
      "-vf",
      vfFilter,
      "-c:v",
      "libx264",
      "-preset",
      "veryfast",
      "-crf",
      "17",
      "-pix_fmt",
      "yuv420p",
      "-movflags",
      "+faststart",
      "-c:a",
      "copy",
      outputPath
    ]);
  }
}
app.post("/api/flow/process-clips-pipeline", async (req, res) => {
  try {
    const {
      folderPath = "",
      folderName = "",
      docTitle = "",
      aspectRatio = "16:9",
      clips = []
    } = req.body || {};
    const resolvedRoot = resolveLocalDocumentaryFolder(folderPath, folderName, docTitle);
    if (!resolvedRoot || !import_fs.default.existsSync(resolvedRoot)) {
      res.status(400).json({
        ok: false,
        error: "No se encontr\xF3 la carpeta local del proyecto. Aseg\xFArate de tener vinculada la carpeta del documental en tu Mac."
      });
      return;
    }
    ensureDocumentarySubfolders(resolvedRoot);
    const clipsDir = import_path.default.join(resolvedRoot, "05_Clips_Video");
    const downloadsDir = import_path.default.join(process.env.HOME || "", "Downloads");
    const clipsList = Array.isArray(clips) ? clips : [];
    activeClipsPipelineStatus = {
      running: true,
      phase: "locating",
      current: 0,
      total: 0,
      currentFileName: "",
      message: "Localizando clips y verificando archivos ZIP...",
      extractedZipsCount: 0,
      importedFilesCount: 0,
      upscaled4kCount: 0,
      already4kCount: 0
    };
    activeClipsPipelineStatus.phase = "unzipping";
    const zipCandidates = [];
    for (const dir of [clipsDir, resolvedRoot]) {
      if (!import_fs.default.existsSync(dir)) continue;
      for (const entry of import_fs.default.readdirSync(dir)) {
        if (entry.startsWith(".")) continue;
        if (/\.zip$/i.test(entry)) {
          zipCandidates.push(import_path.default.join(dir, entry));
        }
      }
    }
    if (downloadsDir && import_fs.default.existsSync(downloadsDir)) {
      const nowMs = Date.now();
      for (const entry of import_fs.default.readdirSync(downloadsDir)) {
        if (entry.startsWith(".") || !/\.zip$/i.test(entry)) continue;
        const fullZip = import_path.default.join(downloadsDir, entry);
        try {
          const st = import_fs.default.statSync(fullZip);
          if (!st.isFile() || nowMs - st.mtimeMs > 24 * 3600 * 1e3) continue;
          const listOut = (0, import_child_process.execSync)(`unzip -l "${fullZip.replace(/"/g, '\\"')}"`, {
            encoding: "utf8",
            stdio: ["ignore", "pipe", "ignore"]
          });
          const hasClipVideos = /\.(mp4|mov|webm)/i.test(listOut) && (/(?:^|\s|\/)(?:0*\d+_|clip|video|create_a_video)/i.test(listOut) || /flow/i.test(entry));
          if (hasClipVideos) {
            zipCandidates.push(fullZip);
          }
        } catch {
        }
      }
    }
    for (const zipFull of zipCandidates) {
      if (!import_fs.default.existsSync(zipFull)) continue;
      const tmpUnzipDir = import_path.default.join(
        import_os.default.tmpdir(),
        `huellas_unzip_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`
      );
      try {
        activeClipsPipelineStatus.message = `Descomprimiendo ${import_path.default.basename(zipFull)}...`;
        import_fs.default.mkdirSync(tmpUnzipDir, { recursive: true });
        (0, import_child_process.execSync)(`unzip -o -j "${zipFull.replace(/"/g, '\\"')}" -d "${tmpUnzipDir}"`, {
          stdio: "ignore"
        });
        for (const extracted of import_fs.default.readdirSync(tmpUnzipDir)) {
          if (extracted.startsWith(".") || extracted.startsWith("__MACOSX")) continue;
          if (/\.(mp4|mov|webm)$/i.test(extracted)) {
            const srcFile = import_path.default.join(tmpUnzipDir, extracted);
            const destFile = import_path.default.join(clipsDir, extracted);
            import_fs.default.copyFileSync(srcFile, destFile);
            activeClipsPipelineStatus.importedFilesCount++;
          }
        }
        import_fs.default.unlinkSync(zipFull);
        activeClipsPipelineStatus.extractedZipsCount++;
      } catch (e) {
        console.warn("[ClipsPipeline] Warning extracting zip:", zipFull, e);
      } finally {
        try {
          if (import_fs.default.existsSync(tmpUnzipDir)) {
            import_fs.default.rmSync(tmpUnzipDir, { recursive: true, force: true });
          }
        } catch {
        }
      }
    }
    activeClipsPipelineStatus.phase = "locating";
    if (import_fs.default.existsSync(resolvedRoot)) {
      for (const entry of import_fs.default.readdirSync(resolvedRoot)) {
        if (entry.startsWith(".") || !/\.(mp4|mov|webm)$/i.test(entry)) continue;
        if (/^Documental_|_Master|_Final/i.test(entry)) continue;
        const fullSrc = import_path.default.join(resolvedRoot, entry);
        try {
          if (import_fs.default.statSync(fullSrc).isFile()) {
            const dest = import_path.default.join(clipsDir, entry);
            import_fs.default.renameSync(fullSrc, dest);
            activeClipsPipelineStatus.importedFilesCount++;
          }
        } catch {
        }
      }
    }
    if (downloadsDir && import_fs.default.existsSync(downloadsDir) && clipsList.length > 0) {
      const nowMs = Date.now();
      for (const entry of import_fs.default.readdirSync(downloadsDir)) {
        if (entry.startsWith(".") || !/\.(mp4|mov|webm)$/i.test(entry)) continue;
        if (/^Documental_|_Master|_Final/i.test(entry)) continue;
        const fullDl = import_path.default.join(downloadsDir, entry);
        try {
          const st = import_fs.default.statSync(fullDl);
          if (!st.isFile() || nowMs - st.mtimeMs > 12 * 3600 * 1e3) continue;
          const inferredNum = inferClipNumberFromFileName(entry, clipsList);
          if (inferredNum > 0) {
            const targetClip = clipsList.find((c) => Number(c.clipNumber) === inferredNum);
            if (targetClip) {
              const fileToks = normalizeWordTokensForMatch(entry);
              const clipToks = normalizeWordTokensForMatch(
                `${targetClip.narrationSegment || ""} ${targetClip.videoPrompt || ""}`
              );
              const overlap = fileToks.filter((t) => clipToks.includes(t)).length;
              if (overlap >= 2) {
                const dest = import_path.default.join(clipsDir, entry);
                import_fs.default.copyFileSync(fullDl, dest);
                import_fs.default.unlinkSync(fullDl);
                activeClipsPipelineStatus.importedFilesCount++;
              }
            }
          }
        } catch {
        }
      }
    }
    activeClipsPipelineStatus.phase = "normalizing";
    activeClipsPipelineStatus.message = "Normalizando numeraci\xF3n y nombres de clips...";
    if (import_fs.default.existsSync(clipsDir)) {
      for (const entry of import_fs.default.readdirSync(clipsDir)) {
        if (entry.startsWith(".") || /\.tmp\.(mp4|mov|webm)$/i.test(entry)) continue;
        if (!/\.(mp4|mov|webm)$/i.test(entry)) continue;
        const fullOrig = import_path.default.join(clipsDir, entry);
        let st;
        try {
          st = import_fs.default.statSync(fullOrig);
        } catch {
          continue;
        }
        if (!st.isFile()) continue;
        const clipNum = inferClipNumberFromFileName(entry, clipsList);
        if (clipNum > 0) {
          const isAlready4k = /[_\-]4k\.(mp4|mov|webm)$/i.test(entry);
          const ext = import_path.default.extname(entry);
          let rawBase = import_path.default.basename(entry, ext).replace(/[_\-]4k$/i, "");
          rawBase = rawBase.replace(/^(?:(?:clip|video|scene|escena)[_\-\s.]*)?0*\d+[_\-\s.]*/i, "").replace(/\s+/g, "_").replace(/_+/g, "_").replace(/^_|_$/g, "");
          if (!rawBase) {
            rawBase = "Clip";
          }
          const numPrefix = String(clipNum).padStart(2, "0");
          const normalizedName = `${numPrefix}_${rawBase}${isAlready4k ? "_4K" : ""}${ext}`;
          if (normalizedName !== entry) {
            const fullNormalized = import_path.default.join(clipsDir, normalizedName);
            if (!import_fs.default.existsSync(fullNormalized)) {
              try {
                import_fs.default.renameSync(fullOrig, fullNormalized);
              } catch {
              }
            }
          }
        }
      }
    }
    activeClipsPipelineStatus.phase = "upscaling_4k";
    const allVideoEntries = import_fs.default.existsSync(clipsDir) ? import_fs.default.readdirSync(clipsDir).filter(
      (e) => !e.startsWith(".") && !/\.tmp\.(mp4|mov|webm)$/i.test(e) && /\.(mp4|mov|webm)$/i.test(e)
    ) : [];
    const mtimeReal4kByClip = /* @__PURE__ */ new Map();
    for (const entry of allVideoEntries) {
      if (/[_\-]4k\.(mp4|mov|webm)$/i.test(entry)) {
        try {
          const st = import_fs.default.statSync(import_path.default.join(clipsDir, entry));
          if (st.size >= 12 * 1024 * 1024) {
            const cNum = inferClipNumberFromFileName(entry, clipsList);
            if (cNum > 0) {
              const prev = mtimeReal4kByClip.get(cNum) || 0;
              if (st.mtimeMs > prev) mtimeReal4kByClip.set(cNum, st.mtimeMs);
            }
          }
        } catch {
        }
      }
    }
    const pendingUpscaleFiles = [];
    for (const entry of allVideoEntries) {
      const fullPath = import_path.default.join(clipsDir, entry);
      let st = null;
      try {
        st = import_fs.default.statSync(fullPath);
      } catch {
      }
      const isReal4k = /[_\-]4k\.(mp4|mov|webm)$/i.test(entry) && !!st && st.size >= 12 * 1024 * 1024;
      if (isReal4k) {
        activeClipsPipelineStatus.already4kCount++;
      } else if (st && st.size > 1e4) {
        const cNum = inferClipNumberFromFileName(entry, clipsList);
        const existing4kMtime = cNum > 0 ? mtimeReal4kByClip.get(cNum) || 0 : 0;
        if (existing4kMtime > 0 && st.mtimeMs <= existing4kMtime) {
          try {
            import_fs.default.unlinkSync(fullPath);
          } catch {
          }
        } else {
          pendingUpscaleFiles.push(entry);
        }
      }
    }
    pendingUpscaleFiles.sort((a, b) => {
      const na = inferClipNumberFromFileName(a, clipsList) || 9999;
      const nb = inferClipNumberFromFileName(b, clipsList) || 9999;
      return na - nb;
    });
    activeClipsPipelineStatus.total = pendingUpscaleFiles.length;
    activeClipsPipelineStatus.current = 0;
    let nextIdx = 0;
    const workerCount = Math.min(2, pendingUpscaleFiles.length);
    const workers = Array.from({ length: workerCount }, async () => {
      while (nextIdx < pendingUpscaleFiles.length) {
        const myIdx = nextIdx++;
        const entry = pendingUpscaleFiles[myIdx];
        const srcFull = import_path.default.join(clipsDir, entry);
        if (!import_fs.default.existsSync(srcFull)) continue;
        const baseNoExt = import_path.default.basename(entry, import_path.default.extname(entry)).replace(/[_\-]4k$/i, "");
        const final4kName = `${baseNoExt}_4K.mp4`;
        const final4kFull = import_path.default.join(clipsDir, final4kName);
        const tmp4kFull = import_path.default.join(
          import_os.default.tmpdir(),
          `huellas_4k_${baseNoExt}_${Date.now()}_${Math.random().toString(36).slice(2, 5)}.mp4`
        );
        activeClipsPipelineStatus.currentFileName = entry;
        activeClipsPipelineStatus.message = `Mejorando a 4K (${activeClipsPipelineStatus.current + 1}/${activeClipsPipelineStatus.total}): ${entry}`;
        try {
          await upscaleFileTo4KOnDisk(srcFull, tmp4kFull, aspectRatio);
          if (import_fs.default.existsSync(tmp4kFull) && import_fs.default.statSync(tmp4kFull).size > 1e4) {
            const clipNum = inferClipNumberFromFileName(entry, clipsList);
            const paddedNum = clipNum > 0 ? String(clipNum).padStart(2, "0") : "";
            const prefix = paddedNum ? `${paddedNum}_` : "";
            import_fs.default.copyFileSync(tmp4kFull, final4kFull);
            try {
              (0, import_child_process.execSync)(`chflags nohidden "${final4kFull.replace(/"/g, '\\"')}"`, { stdio: "ignore" });
            } catch {
            }
            for (const existing of import_fs.default.readdirSync(clipsDir)) {
              const fullExisting = import_path.default.join(clipsDir, existing);
              if (import_path.default.resolve(fullExisting) !== import_path.default.resolve(final4kFull) && /\.(mp4|mov|webm)$/i.test(existing) && (prefix && existing.startsWith(prefix) || existing === entry)) {
                try {
                  import_fs.default.unlinkSync(fullExisting);
                } catch {
                }
              }
            }
            if (prefix) {
              for (const subCache of [".optical_flow_cache", ".foley_only_cache"]) {
                const cacheDir = import_path.default.join(clipsDir, subCache);
                if (import_fs.default.existsSync(cacheDir) && import_fs.default.statSync(cacheDir).isDirectory()) {
                  for (const cFile of import_fs.default.readdirSync(cacheDir)) {
                    if (cFile.startsWith(prefix)) {
                      try {
                        import_fs.default.unlinkSync(import_path.default.join(cacheDir, cFile));
                      } catch {
                      }
                    }
                  }
                }
              }
              const suffixWithoutNum = baseNoExt.replace(/^0*\d+_/, "");
              const frameFileName = `${paddedNum}_Imagen_Inicial_${suffixWithoutNum}.jpg`;
              const frameFullPath = import_path.default.join(clipsDir, frameFileName);
              try {
                const ffmpegBin = getFfmpegPath();
                await new Promise((resolve) => {
                  const proc = (0, import_child_process.spawn)(
                    ffmpegBin,
                    ["-y", "-i", final4kFull, "-frames:v", "1", "-q:v", "2", frameFullPath],
                    { stdio: "ignore" }
                  );
                  proc.on("error", () => resolve());
                  proc.on("close", () => resolve());
                });
                if (import_fs.default.existsSync(frameFullPath)) {
                  (0, import_child_process.execSync)(`chflags nohidden "${frameFullPath.replace(/"/g, '\\"')}"`, { stdio: "ignore" });
                }
              } catch {
              }
            }
            activeClipsPipelineStatus.upscaled4kCount++;
          }
        } catch (err) {
          console.warn(`[ClipsPipeline] Error upscaling ${entry} to 4K:`, err);
        } finally {
          try {
            if (import_fs.default.existsSync(tmp4kFull)) import_fs.default.unlinkSync(tmp4kFull);
          } catch {
          }
          activeClipsPipelineStatus.current++;
        }
      }
    });
    await Promise.all(workers);
    const clipVideos = [];
    const seenClips = /* @__PURE__ */ new Set();
    if (import_fs.default.existsSync(clipsDir)) {
      const finalEntries = import_fs.default.readdirSync(clipsDir).filter(
        (e) => !e.startsWith(".") && !/\.tmp\.(mp4|mov|webm)$/i.test(e) && /\.(mp4|mov|webm)$/i.test(e)
      ).sort((a, b) => {
        const a4k = /[_\-]4k\.(mp4|mov|webm)$/i.test(a) ? 1 : 0;
        const b4k = /[_\-]4k\.(mp4|mov|webm)$/i.test(b) ? 1 : 0;
        if (b4k !== a4k) return b4k - a4k;
        try {
          return import_fs.default.statSync(import_path.default.join(clipsDir, b)).mtimeMs - import_fs.default.statSync(import_path.default.join(clipsDir, a)).mtimeMs;
        } catch {
          return 0;
        }
      });
      for (const entry of finalEntries) {
        const full = import_path.default.join(clipsDir, entry);
        const st = import_fs.default.statSync(full);
        if (!st.isFile()) continue;
        const mVid = entry.match(/^(?:(?:clip|video)[_\-\s.]*)?0*(\d+)[_\-\s.(].*\.(mp4|webm|mov)$/i);
        if (mVid) {
          const num = parseInt(mVid[1], 10);
          if (num > 0 && !seenClips.has(num)) {
            seenClips.add(num);
            clipVideos.push({
              clipNumber: num,
              fileName: entry,
              url: `/api/flow/serve-folder-file?filePath=${encodeURIComponent(full)}&v=${Math.floor(st.mtimeMs)}`,
              is4K: /[_\-]4k\.(mp4|webm|mov)$/i.test(entry)
            });
          }
        }
      }
    }
    clipVideos.sort((a, b) => a.clipNumber - b.clipNumber);
    activeClipsPipelineStatus = {
      ...activeClipsPipelineStatus,
      running: false,
      phase: "completed",
      currentFileName: "",
      message: `Proceso completado: ${activeClipsPipelineStatus.upscaled4kCount} convertidos a 4K, ${activeClipsPipelineStatus.already4kCount} ya en 4K (${clipVideos.length} listos en el Timeline).`,
      completedAt: (/* @__PURE__ */ new Date()).toISOString()
    };
    res.json({
      ok: true,
      resolvedRoot,
      clipVideos,
      extractedZipsCount: activeClipsPipelineStatus.extractedZipsCount,
      importedFilesCount: activeClipsPipelineStatus.importedFilesCount,
      upscaled4kCount: activeClipsPipelineStatus.upscaled4kCount,
      already4kCount: activeClipsPipelineStatus.already4kCount,
      message: activeClipsPipelineStatus.message
    });
  } catch (err) {
    activeClipsPipelineStatus = {
      ...activeClipsPipelineStatus,
      running: false,
      phase: "error",
      error: err?.message || "Error procesando clips a 4K.",
      message: err?.message || "Error procesando clips a 4K."
    };
    res.status(500).json({
      ok: false,
      error: err?.message || "Error procesando clips a 4K."
    });
  }
});
app.post("/api/flow/load-and-upscale-single-clip", async (req, res) => {
  try {
    const {
      folderPath = "",
      folderName = "",
      docTitle = "",
      aspectRatio = "16:9",
      clip = {}
    } = req.body || {};
    const clipNumber = Number(clip.clipNumber || 0);
    if (!clipNumber || clipNumber <= 0) {
      res.status(400).json({ ok: false, error: "N\xFAmero de clip inv\xE1lido." });
      return;
    }
    const resolvedRoot = resolveLocalDocumentaryFolder(folderPath, folderName, docTitle);
    if (!resolvedRoot || !import_fs.default.existsSync(resolvedRoot)) {
      res.status(400).json({
        ok: false,
        error: "No se encontr\xF3 la carpeta local del documental en tu Mac."
      });
      return;
    }
    ensureDocumentarySubfolders(resolvedRoot);
    const clipsDir = import_path.default.join(resolvedRoot, "05_Clips_Video");
    const downloadsDir = import_path.default.join(process.env.HOME || "", "Downloads");
    const singleClipList = [
      {
        clipNumber,
        videoPrompt: String(clip.videoPrompt || ""),
        narrationSegment: String(clip.narrationSegment || "")
      }
    ];
    for (const dir of [clipsDir, resolvedRoot]) {
      if (!import_fs.default.existsSync(dir)) continue;
      for (const entry of import_fs.default.readdirSync(dir)) {
        if (entry.startsWith(".") || !/\.zip$/i.test(entry)) continue;
        const zipFull = import_path.default.join(dir, entry);
        const tmpUnzipDir = import_path.default.join(
          import_os.default.tmpdir(),
          `huellas_single_unzip_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`
        );
        try {
          import_fs.default.mkdirSync(tmpUnzipDir, { recursive: true });
          (0, import_child_process.execSync)(`unzip -o -j "${zipFull.replace(/"/g, '\\"')}" -d "${tmpUnzipDir}"`, {
            stdio: "ignore"
          });
          for (const extracted of import_fs.default.readdirSync(tmpUnzipDir)) {
            if (extracted.startsWith(".") || extracted.startsWith("__MACOSX")) continue;
            if (/\.(mp4|mov|webm)$/i.test(extracted)) {
              import_fs.default.copyFileSync(import_path.default.join(tmpUnzipDir, extracted), import_path.default.join(clipsDir, extracted));
            }
          }
          import_fs.default.unlinkSync(zipFull);
        } catch {
        } finally {
          try {
            if (import_fs.default.existsSync(tmpUnzipDir)) import_fs.default.rmSync(tmpUnzipDir, { recursive: true, force: true });
          } catch {
          }
        }
      }
    }
    const candidates = [];
    const matchesTargetClip = (entryName, checkOverlap = false) => {
      if (entryName.startsWith(".") || /\.tmp\.(mp4|mov|webm)$/i.test(entryName)) return false;
      if (!/\.(mp4|mov|webm)$/i.test(entryName)) return false;
      if (/^Documental_|_Master|_Final/i.test(entryName)) return false;
      const mPrefix = entryName.match(
        /^(?:(?:clip|video|scene|escena)[_\-\s.]*)?0*(\d+)(?:[_\-\s.(]|$)/i
      );
      if (mPrefix && parseInt(mPrefix[1], 10) === clipNumber) {
        if (!checkOverlap) return true;
        const fileToks = normalizeWordTokensForMatch(entryName);
        const clipToks = normalizeWordTokensForMatch(
          `${clip.narrationSegment || ""} ${clip.videoPrompt || ""}`
        );
        const overlap = fileToks.filter((t) => clipToks.includes(t)).length;
        if (overlap >= 1 || /^clip[_\-\s.]*0*\d+/i.test(entryName)) return true;
      }
      const inferred = inferClipNumberFromFileName(entryName, singleClipList);
      return inferred === clipNumber;
    };
    const projectDirs = [
      clipsDir,
      resolvedRoot,
      import_path.default.join(resolvedRoot, "Clips_Aprobados")
    ];
    for (const d of projectDirs) {
      if (!import_fs.default.existsSync(d) || !import_fs.default.statSync(d).isDirectory()) continue;
      for (const entry of import_fs.default.readdirSync(d)) {
        if (!matchesTargetClip(entry, false)) continue;
        const full = import_path.default.join(d, entry);
        try {
          const st = import_fs.default.statSync(full);
          if (st.isFile() && st.size > 1e4) {
            candidates.push({ fullPath: full, fileName: entry, mtimeMs: st.mtimeMs, dir: d });
          }
        } catch {
        }
      }
    }
    if (downloadsDir && import_fs.default.existsSync(downloadsDir)) {
      const nowMs = Date.now();
      for (const entry of import_fs.default.readdirSync(downloadsDir)) {
        if (!matchesTargetClip(entry, true)) continue;
        const full = import_path.default.join(downloadsDir, entry);
        try {
          const st = import_fs.default.statSync(full);
          if (st.isFile() && st.size > 1e4 && nowMs - st.mtimeMs <= 12 * 3600 * 1e3) {
            candidates.push({ fullPath: full, fileName: entry, mtimeMs: st.mtimeMs, dir: downloadsDir });
          }
        } catch {
        }
      }
    }
    if (candidates.length === 0) {
      res.status(404).json({
        ok: false,
        error: `No se encontr\xF3 ning\xFAn archivo de video para el Clip ${String(clipNumber).padStart(2, "0")} en 05_Clips_Video ni en Descargas.`
      });
      return;
    }
    candidates.sort((a, b) => b.mtimeMs - a.mtimeMs);
    const newest = candidates[0];
    const paddedNum = String(clipNumber).padStart(2, "0");
    let canonicalBase = "";
    const existingCanonical = candidates.find(
      (c) => c.dir === clipsDir && new RegExp(`^0*${clipNumber}_[a-zA-Z0-9]`, "i").test(c.fileName) && !/^(?:clip|video)[_\-\s.]/i.test(c.fileName)
    );
    if (clip.expectedFileName) {
      canonicalBase = import_path.default.basename(String(clip.expectedFileName), import_path.default.extname(String(clip.expectedFileName))).replace(/[_\-]4k$/i, "");
    } else if (existingCanonical) {
      canonicalBase = import_path.default.basename(existingCanonical.fileName, import_path.default.extname(existingCanonical.fileName)).replace(/[_\-]4k$/i, "");
    } else {
      let rawBase = import_path.default.basename(newest.fileName, import_path.default.extname(newest.fileName)).replace(/[_\-]4k$/i, "").replace(/^(?:(?:clip|video|scene|escena)[_\-\s.]*)?0*\d+[_\-\s.]*/i, "").replace(/\s+/g, "_").replace(/_+/g, "_").replace(/^_|_$/g, "");
      if (!rawBase) rawBase = "Clip";
      canonicalBase = `${paddedNum}_${rawBase}`;
    }
    const final4kName = `${canonicalBase}_4K.mp4`;
    const final4kFull = import_path.default.join(clipsDir, final4kName);
    const isNewestAlready4KName = /[_\-]4k\.(mp4|mov|webm)$/i.test(newest.fileName) && import_fs.default.existsSync(newest.fullPath) && import_fs.default.statSync(newest.fullPath).size >= 12 * 1024 * 1024;
    let wasUpscaled = false;
    if (isNewestAlready4KName && import_path.default.resolve(newest.fullPath) === import_path.default.resolve(final4kFull)) {
      const now = /* @__PURE__ */ new Date();
      try {
        import_fs.default.utimesSync(final4kFull, now, now);
      } catch {
      }
    } else if (isNewestAlready4KName) {
      import_fs.default.copyFileSync(newest.fullPath, final4kFull);
      if (import_path.default.resolve(newest.fullPath) !== import_path.default.resolve(final4kFull)) {
        try {
          import_fs.default.unlinkSync(newest.fullPath);
        } catch {
        }
      }
    } else {
      const tmp4kFull = import_path.default.join(
        import_os.default.tmpdir(),
        `huellas_single_4k_${canonicalBase}_${Date.now()}_${Math.random().toString(36).slice(2, 5)}.mp4`
      );
      try {
        await upscaleFileTo4KOnDisk(newest.fullPath, tmp4kFull, aspectRatio);
        if (import_fs.default.existsSync(tmp4kFull) && import_fs.default.statSync(tmp4kFull).size > 1e4) {
          import_fs.default.copyFileSync(tmp4kFull, final4kFull);
          wasUpscaled = true;
        }
      } finally {
        try {
          if (import_fs.default.existsSync(tmp4kFull)) import_fs.default.unlinkSync(tmp4kFull);
        } catch {
        }
      }
    }
    if (import_fs.default.existsSync(final4kFull)) {
      try {
        (0, import_child_process.execSync)(`chflags nohidden "${final4kFull.replace(/"/g, '\\"')}"`, { stdio: "ignore" });
      } catch {
      }
    }
    if (import_fs.default.existsSync(final4kFull)) {
      for (const c of candidates) {
        if ((c.dir === clipsDir || c.dir === downloadsDir) && import_path.default.resolve(c.fullPath) !== import_path.default.resolve(final4kFull) && import_fs.default.existsSync(c.fullPath)) {
          try {
            import_fs.default.unlinkSync(c.fullPath);
          } catch {
          }
        }
      }
    }
    const activeVideoFull = import_fs.default.existsSync(final4kFull) ? final4kFull : newest.fullPath;
    const activeVideoName = import_path.default.basename(activeVideoFull);
    const activeVideoStat = import_fs.default.statSync(activeVideoFull);
    const suffixWithoutNum = canonicalBase.replace(/^0*\d+_/, "");
    const frameFileName = `${paddedNum}_Imagen_Inicial_${suffixWithoutNum}.jpg`;
    const frameFullPath = import_path.default.join(clipsDir, frameFileName);
    let frameUrl = "";
    try {
      const ffmpegBin = getFfmpegPath();
      await new Promise((resolve) => {
        const proc = (0, import_child_process.spawn)(
          ffmpegBin,
          ["-y", "-i", activeVideoFull, "-frames:v", "1", "-q:v", "2", frameFullPath],
          { stdio: "ignore" }
        );
        proc.on("error", () => resolve());
        proc.on("close", () => resolve());
      });
      if (import_fs.default.existsSync(frameFullPath)) {
        try {
          (0, import_child_process.execSync)(`chflags nohidden "${frameFullPath.replace(/"/g, '\\"')}"`, { stdio: "ignore" });
        } catch {
        }
        const fst = import_fs.default.statSync(frameFullPath);
        frameUrl = `/api/flow/serve-folder-file?filePath=${encodeURIComponent(frameFullPath)}&v=${Math.floor(fst.mtimeMs)}`;
      }
    } catch {
    }
    const videoUrl = `/api/flow/serve-folder-file?filePath=${encodeURIComponent(activeVideoFull)}&v=${Math.floor(activeVideoStat.mtimeMs)}`;
    res.json({
      ok: true,
      clipNumber,
      fileName: activeVideoName,
      url: videoUrl,
      frameUrl,
      is4K: /[_\-]4k\.(mp4|mov|webm)$/i.test(activeVideoName),
      wasUpscaled
    });
  } catch (err) {
    res.status(500).json({
      ok: false,
      error: err?.message || "Error cargando y mejorando el clip a 4K."
    });
  }
});
app.post("/api/ai/reply-comments", async (req, res) => {
  try {
    const { documentary, commentText, imageBase64, mimeType, customInstruction } = req.body;
    const ai = getGeminiClient();
    if (!ai) {
      res.status(400).json({
        error: "No hay Gemini API Key activa. Config\xFArala en el bot\xF3n de llave superior."
      });
      return;
    }
    if (!commentText && !imageBase64) {
      res.status(400).json({
        error: "Env\xEDa una captura de pantalla de los comentarios o escribe el texto del comentario."
      });
      return;
    }
    const doc = documentary || {};
    const promptText = `Act\xFAa como el historiador principal y director de "Huellas de la Humanidad".
Contexto del documental publicado:
- T\xEDtulo / Tema: ${doc.publishTitle || doc.topic || doc.title || "Documental Hist\xF3rico"}
- \xC9poca y Lugar: ${doc.historicalTime || ""} | ${doc.historicalLocation || ""}
- Resumen / Guion de referencia:
"""
${(doc.voiceoverScript || doc.sectionsStructure || doc.publishDescription || "").slice(0, 3500)}
"""

${commentText ? `Comentario(s) enviado(s) en texto por el usuario:
"""
${commentText}
"""
` : ""}
${customInstruction ? `Enfoque o instrucci\xF3n adicional del director: ${customInstruction}
` : ""}

TU TAREA (ETAPA 12 POST-PRODUCCI\xD3N \u2014 RESPONDER COMENTARIOS DE LA AUDIENCIA DE FORMA CERTERA Y CONCISA):
1. Si se adjunt\xF3 una captura de pantalla, transcribe fielmente cada comentario visible de la audiencia (incluyendo el @usuario si aparece). Si se envi\xF3 texto, \xFAsalo directamente.
2. Para cada comentario (sea duda hist\xF3rica, debate, correcci\xF3n, escepticismo o elogio), redacta:
   - "replyConcise": Una respuesta **certera, hist\xF3ricamente rigurosa y concisa** (1 a 3 oraciones m\xE1ximo, directa al grano, elegante, con autoridad acad\xE9mica pero cercana, que aporte un dato hist\xF3rico verificado del episodio o aclare la duda con precisi\xF3n quir\xFArgica).
   - "replyAlternative": Una segunda opci\xF3n de respuesta breve que cierre con una pregunta sutil o reflexi\xF3n hist\xF3rica para impulsar el engagement en el hilo de comentarios.
   - "historicalContextNote": Nota interna brev\xEDsima para el creador confirmando el dato hist\xF3rico exacto utilizado.
3. REGLAS DE FORMATO OBLIGATORIAS DE LA MARCA:
   - A\xF1os siempre en d\xEDgitos num\xE9ricos (ej. 1888, 1943).
   - Siglos y nombres de monarcas/papas/emperadores con n\xFAmero en n\xFAmeros romanos (ej. siglo XIX, Felipe II, Luis XIV).
   - Cantidades en miles con d\xEDgitos seguidos de la palabra "mil" (ej. 70 mil).
   - CERO signos de exclamaci\xF3n (\xA1!) en las respuestas.

Devuelve EXCLUSIVAMENTE un objeto JSON v\xE1lido con esta estructura:
{
  "replies": [
    {
      "author": "@usuario o Audiencia",
      "commentText": "Texto exacto del comentario detectado",
      "replyConcise": "Respuesta principal certera y concisa (1-3 oraciones, sin signos de exclamaci\xF3n)",
      "replyAlternative": "Opci\xF3n alternativa breve con cierre de engagement (sin signos de exclamaci\xF3n)",
      "historicalContextNote": "Dato hist\xF3rico de respaldo"
    }
  ]
}`;
    const parts = [{ text: promptText }];
    if (imageBase64) {
      const cleanBase64 = String(imageBase64).replace(/^data:[^;]+;base64,/, "");
      parts.push({
        inlineData: {
          data: cleanBase64,
          mimeType: mimeType || "image/png"
        }
      });
    }
    const models = [
      "gemini-3.1-pro-preview",
      "gemini-3.6-flash",
      "gemini-3-flash-preview",
      "gemini-2.5-flash"
    ];
    let responseText = "";
    let lastErr = null;
    for (const m of models) {
      try {
        const resp = await ai.models.generateContent({
          model: m,
          contents: [{ role: "user", parts }],
          config: {
            responseMimeType: "application/json"
          }
        });
        if (resp.text) {
          responseText = resp.text;
          break;
        }
      } catch (e) {
        lastErr = e;
      }
    }
    if (!responseText) {
      throw new Error(lastErr?.message || "No se pudo generar respuesta para los comentarios.");
    }
    const parsed = JSON.parse(responseText.trim());
    res.json(parsed);
  } catch (err) {
    console.error("Error en /api/ai/reply-comments:", err);
    res.status(500).json({ error: err.message || "Error al procesar los comentarios de la audiencia." });
  }
});
var HUELLAS_OFFICIAL_CHANNEL_HANDLE = "@huellas_de_la_humanidad";
var HUELLAS_OFFICIAL_CHANNEL_URL = "https://www.youtube.com/@huellas_de_la_humanidad";
var HUELLAS_CHANNEL_COMMENTS_CACHE_FILE = import_path.default.join(
  DATA_DIR,
  "huellas_channel_comments_cache.json"
);
var HUELLAS_CHANNEL_CACHE_TTL_MS = 6 * 60 * 60 * 1e3;
function extractYoutubeVideoId(rawUrl) {
  const clean = String(rawUrl || "").trim();
  if (!clean) return null;
  if (/^[a-zA-Z0-9_-]{11}$/.test(clean)) return clean;
  const patterns = [
    /[?&]v=([a-zA-Z0-9_-]{11})/,
    /youtu\.be\/([a-zA-Z0-9_-]{11})/,
    /youtube\.com\/shorts\/([a-zA-Z0-9_-]{11})/,
    /youtube\.com\/embed\/([a-zA-Z0-9_-]{11})/,
    /youtube\.com\/live\/([a-zA-Z0-9_-]{11})/
  ];
  for (const rx of patterns) {
    const m = clean.match(rx);
    if (m && m[1]) return m[1];
  }
  return null;
}
async function fetchYoutubeVideoCommentsDataOnly(videoId, maxPages = 2) {
  const innertubeUrl = "https://www.youtube.com/youtubei/v1/next?prettyPrint=false";
  const clientContext = {
    client: {
      clientName: "WEB",
      clientVersion: "2.20240501.00.00",
      hl: "es",
      gl: "ES"
    }
  };
  try {
    const res1 = await fetch(innertubeUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36"
      },
      body: JSON.stringify({ context: clientContext, videoId })
    });
    if (!res1.ok) return { videoId, title: videoId, comments: [] };
    const j1 = await res1.json();
    const s1 = JSON.stringify(j1);
    const titleMatch = s1.match(/"title":\{"runs":\[\{"text":"([^"]+)"\}\]/);
    const title = titleMatch ? titleMatch[1] : videoId;
    const findContinuationTokens = (obj) => {
      const tokens = [];
      const walk = (node) => {
        if (!node || typeof node !== "object") return;
        if (node.itemSectionRenderer && node.itemSectionRenderer.sectionIdentifier === "comment-item-section" || node.engagementPanelSectionListRenderer && node.engagementPanelSectionListRenderer.panelIdentifier === "engagement-panel-comments-section") {
          const str = JSON.stringify(node);
          for (const m of str.matchAll(/"token":"([^"]+)"/g)) {
            if (m[1] && !tokens.includes(m[1])) tokens.push(m[1]);
          }
        }
        for (const k of Object.keys(node)) walk(node[k]);
      };
      walk(obj);
      return tokens;
    };
    const initialTokens = findContinuationTokens(j1);
    if (initialTokens.length === 0) {
      return { videoId, title, comments: [] };
    }
    const collected = [];
    const seenTexts = /* @__PURE__ */ new Set();
    let nextToken = initialTokens[0];
    for (let page = 0; page < maxPages && nextToken; page++) {
      const resPage = await fetch(innertubeUrl, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36"
        },
        body: JSON.stringify({ context: clientContext, continuation: nextToken })
      });
      if (!resPage.ok) break;
      const jPage = await resPage.json();
      let nextContinuation;
      const extractFromPage = (node) => {
        if (!node || typeof node !== "object") return;
        if (node.commentEntityPayload?.properties?.content?.content) {
          const text = String(node.commentEntityPayload.properties.content.content || "").trim();
          const author = String(node.commentEntityPayload.author?.displayName || "").trim();
          const likes = String(node.commentEntityPayload.toolbar?.likeCountNotliked || "0").trim();
          const key = `${author}::${text}`;
          if (text && !seenTexts.has(key)) {
            seenTexts.add(key);
            collected.push({ author, text, likes, videoTitle: title, videoId });
          }
        } else if (node.commentRenderer?.contentText?.runs) {
          const text = (node.commentRenderer.contentText.runs || []).map((r) => r.text || "").join("").trim();
          const author = String(node.commentRenderer.authorText?.simpleText || "").trim();
          const likes = String(node.commentRenderer.voteCount?.simpleText || "0").trim();
          const key = `${author}::${text}`;
          if (text && !seenTexts.has(key)) {
            seenTexts.add(key);
            collected.push({ author, text, likes, videoTitle: title, videoId });
          }
        }
        if (node.continuationItemRenderer?.continuationEndpoint?.continuationCommand?.token && !nextContinuation) {
          nextContinuation = node.continuationItemRenderer.continuationEndpoint.continuationCommand.token;
        }
        for (const k of Object.keys(node)) extractFromPage(node[k]);
      };
      extractFromPage(jPage);
      nextToken = nextContinuation;
    }
    return { videoId, title, comments: collected };
  } catch {
    return { videoId, title: videoId, comments: [] };
  }
}
async function fetchHuellasChannelCommentsCached(forceRefresh = false) {
  if (!forceRefresh && import_fs.default.existsSync(HUELLAS_CHANNEL_COMMENTS_CACHE_FILE)) {
    try {
      const cached = JSON.parse(import_fs.default.readFileSync(HUELLAS_CHANNEL_COMMENTS_CACHE_FILE, "utf8"));
      const ageMs = Date.now() - new Date(cached.updatedAt || 0).getTime();
      if (ageMs < HUELLAS_CHANNEL_CACHE_TTL_MS && Array.isArray(cached.comments)) {
        return cached;
      }
    } catch {
    }
  }
  const videoIdsSet = /* @__PURE__ */ new Set();
  const tabs = ["videos", "shorts"];
  for (const tab of tabs) {
    try {
      const res = await fetch(`${HUELLAS_OFFICIAL_CHANNEL_URL}/${tab}`, {
        headers: {
          "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
          "Accept-Language": "es-ES,es;q=0.9"
        }
      });
      if (res.ok) {
        const html = await res.text();
        const match = html.match(/var ytInitialData = (\{.*?\});<\/script>/s);
        const searchSource = match ? match[1] : html;
        for (const m of searchSource.matchAll(/"videoId":"([a-zA-Z0-9_-]{11})"/g)) {
          if (m[1]) videoIdsSet.add(m[1]);
        }
      }
    } catch {
    }
  }
  const allVideoIds = Array.from(videoIdsSet).slice(0, 35);
  const allAudienceComments = [];
  const batchSize = 5;
  for (let i = 0; i < allVideoIds.length; i += batchSize) {
    const batch = allVideoIds.slice(i, i + batchSize);
    const results = await Promise.all(
      batch.map((vid) => fetchYoutubeVideoCommentsDataOnly(vid, 1))
    );
    for (const r of results) {
      for (const c of r.comments) {
        if (c.author && c.author.toLowerCase().includes("huellas_de_la_humanidad")) {
          continue;
        }
        allAudienceComments.push(c);
      }
    }
  }
  const payload = {
    videoCount: allVideoIds.length,
    comments: allAudienceComments,
    updatedAt: (/* @__PURE__ */ new Date()).toISOString()
  };
  try {
    import_fs.default.writeFileSync(
      HUELLAS_CHANNEL_COMMENTS_CACHE_FILE,
      JSON.stringify(payload, null, 2),
      "utf8"
    );
  } catch {
  }
  return payload;
}
var ANALYZED_VIDEOS_LIBRARY_FILE = import_path.default.join(DATA_DIR, "analyzed_videos_library.json");
var DEFAULT_ANALYZED_VIDEOS_SEED = [
  {
    id: "vid_clqshy5NB7I",
    videoId: "clqshy5NB7I",
    url: "https://youtu.be/clqshy5NB7I",
    title: "La llegada de los italianos a Argentina",
    channelName: "Reimaginando Pasados",
    analyzedAt: (/* @__PURE__ */ new Date()).toISOString(),
    commentsCount: 84,
    structureSummary: `1. DECONSTRUCCI\xD3N DEL HOOK Y PARADOJA CENTRAL (00:00 - 00:30):
   - Arranca con el Intro Oficial (8s, 00:00 - 00:08) seguido del Clip 1 (6s con fade-in visual y Foley puro en el muelle de piedra h\xFAmeda de Malia\xF1o, Santander, 1885). En el segundo 16 entra la voz narrativa con A\xF1o y Lugar cerrados con punto ("A\xF1o 1885, muelle de Malia\xF1o, Santander, Espa\xF1a."), planteando la contradicci\xF3n central del \xE9xodo: para escapar de la servidumbre agraria del minifundio y de las 2.000 pesetas de la redenci\xF3n militar a Ultramar (\xABimpuesto de sangre\xBB), una generaci\xF3n de adolescentes de 14 a 18 a\xF1os se entreg\xF3 voluntariamente a un r\xE9gimen de servidumbre laboral intrafamiliar de 16 horas diarias al otro lado del oc\xE9ano. Antes del segundo 30 cierra con el Slogan Oficial sobre la mesa del historiador antiguo.

2. RADIOGRAF\xCDA ESTRUCTURAL BLOQUE POR BLOQUE (ESCALETA NARRATIVA Y T\xC9CNICA DE 10 MINUTOS):
   - Bloque I (00:00 \u2013 01:45 | 18%) \u2014 La Piedra, el Humo y la Quinta (Escenario A, c. 1885):
     Interior en penumbra de una aldea de Asturias/Galicia (Lu\xE9, Colunga); humo de la lareira, lluvia (orbayu) sobre pizarra, claqueteo seco de madre\xF1as de tres tacos y minifundios donde el 83,5% de las parcelas no alcanza media hect\xE1rea. El dilema matem\xE1tico implacable: un jornal agr\xEDcola estancado en 1,00\u20131,50 pesetas diarias (Instituto de Reformas Sociales, 1904\u20131909) frente al billete de tercera clase de 205\u2013235 pesetas (135 a 200 d\xEDas \xEDntegros de trabajo) y las 1.500\u20132.000 pesetas de la redenci\xF3n militar en met\xE1lico para librarse de las guerras de Ultramar (Ley de Reclutamiento de 11 de julio de 1885 e ilustraci\xF3n \xABA Cuba, por no tener seis mil reales\xBB).
   - Bloque II (01:45 \u2013 03:30 | 18%) \u2014 El Entrepuente de Hierro y las Cartas de Llamada (Escenario B, c. 1895\u20131910):
     Muelles de La Coru\xF1a (480.000\u2013520.000 pasajeros), Vigo (410.000\u2013450.000), Santander (140.000\u2013165.000), Santa Cruz de Tenerife/Las Palmas (160.000\u2013190.000), Gij\xF3n/El Musel (95.000\u2013115.000) y C\xE1diz (85.000\u2013110.000). Estad\xEDsticas del Instituto Geogr\xE1fico y Estad\xEDstico y Consejo Superior de Emigraci\xF3n: 5.009.756 salidas hacia Am\xE9rica entre 1860 y 1988 (2.747.290 retornos; saldo neto 2.053.929) y 3.297.312 salidas entre 1882 y 1930, de las cuales Cuba absorbi\xF3 1.118.968 (33,93%), tras Argentina (1.594.822, 48,36%) y por delante de Brasil (233.432, 7,07%) y M\xE9xico/Puerto Rico/Venezuela (268.740, 8,15%), m\xE1s un 25% de emigraci\xF3n clandestina y 146.683 soldados espa\xF1oles no retornados tras 1898. Descenso a las literas de hierro galvanizado de tres niveles bajo la l\xEDnea de flotaci\xF3n en los vapores de la Compa\xF1\xEDa Trasatl\xE1ntica Espa\xF1ola y Pinillos; cartas de llamada y Ley de Emigraci\xF3n de 1907.
   - Bloque III (03:30 \u2013 05:30 | 20%) \u2014 El Embudo Sanitario: Triscornia (La Habana) y San Juan de Ul\xFAa (Veracruz) (Escenario C, c. 1900\u20131920):
     Choque violento de luz tropical cegadora en la bah\xEDa de La Habana y el Lazareto de San Juan de Ul\xFAa en Veracruz (inaugurado el 20 de junio de 1894 contra el \xABv\xF3mito negro\xBB tras la epidemia de 1889). El Dr. Frank E. Menocal (39 a\xF1os en 1905, Comisionado de Inmigraci\xF3n y compadre del presidente Mario Garc\xEDa Menocal) inspeccionando el tracoma invirtiendo los p\xE1rpados con varilla de vidrio en el Campamento de Triscornia (fundado en noviembre de 1900; desbordado en 1905\u20131906 con 1.800 espa\xF1oles para 800 camas tras arribar 10.230 en tres meses). Autoclaves de vapor de la Brigada de Desinfecci\xF3n, denuncias del Dr. Pedro Becerra en el Diario de la Marina (8/09/1903: \xABLa oficina de Triscornia es campamento de facturas de inmigrantes\xBB), intento de suicidio de Jos\xE9 Linares Mor\xE9, fugas hacia Casablanca y la carta real del joven asturiano Ricardo Ruiz Balb\xEDn (18 a\xF1os) escrita el 13 de diciembre de 1920 desde Ciego de \xC1vila a su madre Bernarda en Lu\xE9 (Colunga).
   - Bloque IV (05:30 \u2013 07:45 | 22%) \u2014 La Esclavitud del Mostrador, el Horno y la Comandita (Escenario D, c. 1910\u20131925):
     Interior de un almac\xE9n de abarrotes con panader\xEDa en Ciudad de M\xE9xico y Puebla (El \xC1guila de Oro) y una bodega esquinera en La Habana. R\xE9gimen cuasi mon\xE1stico de los \xABdependientes\xBB: jornadas de 16 horas (de 5:00 AM a 10:00 PM), prohibici\xF3n estricta de casarse, dormir sobre el mostrador de madera/zinc o sobre los sacos de harina y frijol en la trastienda, sueldo retenido sin efectivo en una \xABcuenta corriente\xBB de los libros mayores y paso tras 8\u201312 a\xF1os a socio industrial (\xABhabilitaci\xF3n\xBB en sociedad en comandita). Contraste con los grandes sanatorios mutualistas (Quinta Covadonga del Centro Asturiano, La Ben\xE9fica del Centro Gallego, Beneficencia Espa\xF1ola en M\xE9xico) y las escuelas de indianos que elevaron la alfabetizaci\xF3n del norte al 80\u201389%.
   - Bloque V (07:45 \u2013 10:00 | 22%) \u2014 Del Crac de 1929 al Vapor Sinaia y el Legado Presente + Outro Oficial (8s):
     El desplome azucarero de 1920\u20131921 y el Crac de 1929\u20131933: cr\xF3nicas del Diario de la Marina (9 y 12 de junio de 1921 y julio de 1931) sobre indigentes hacinados en Triscornia, repatriaciones por limosna y el silencio de los fracasados que dejaron de escribir por verg\xFCenza ante la aldea. Giro hist\xF3rico el 13 de junio de 1939: atraca en Veracruz el vapor Sinaia con el exilio republicano y el poeta Pedro Garfias Zurita (38 a\xF1os, sienes plateadas, boina negra, chamarra de pastor zamorano y gafas de concha). Cierre sobre el legado gastron\xF3mico (pan bolillo y telera en hornos de ladrillo, bodegas, sidra), arquitect\xF3nico y familiar presente + Outro Oficial de 8s.

3. FICHAS BIOGR\xC1FICAS DOCUMENTADAS (@PERSONAS) Y DISE\xD1O FOLEY DE ARCHIVO:
   - @Ricardo_Ruiz_Balbin (18 a\xF1os, Lu\xE9, Colunga, Asturias, 1920): Traje de pana oscura y boina negra al embarcar; guayabera de dril blanco y alpargatas en Cuba.
   - @Dr_Frank_E_Menocal (39 a\xF1os, Triscornia, La Habana, 1905): Uniforme blanco inmaculado de hilo almidonado con cuello alto y botones dorados, lentes de montura fina y varilla de vidrio para inspecci\xF3n de tracoma.
   - @Pedro_Garfias_Zurita (38 a\xF1os, Vapor Sinaia, Veracruz, 13/06/1939): Sienes plateadas, gafas de concha, boina negra, traje oscuro gastado / chamarra de pastor zamorano y bast\xF3n de nudos.

4. GATILLOS PSICOL\xD3GICOS DE VIRALIDAD:
   - Aritm\xE9tica de la Supervivencia (1,50 pesetas de jornal vs. 205 pesetas de pasaje vs. 2.000 pesetas para no morir en la guerra) + Desmitificaci\xF3n del \xABIndiano Rico\xBB (j\xF3venes durmiendo 10 a\xF1os sobre el mostrador) + Activaci\xF3n de Memoria Geneal\xF3gica Hispanoamericana en comentarios.`,
    structuralBlocks: [
      { name: "Intro (8s) + Hook y Quinta (1885)", pct: 10, description: "Muelle de Santander, jornal de 1,50 pesetas vs. 2.000 pesetas de redenci\xF3n militar y Slogan." },
      { name: "Acto I: La Piedra, el Humo y el Desarraigo", pct: 16, description: "Aldeas de Asturias/Galicia, minifundios de <0,5 ha, Ley de Reclutamiento de 1885 y despedida." },
      { name: "Acto II: El Entrepuente de Hierro", pct: 18, description: "Seis puertos de salida, 3,29 millones de emigrantes, literas de hierro y cartas de llamada." },
      { name: "Acto III: Triscornia y San Juan de Ul\xFAa", pct: 20, description: "Filtro sanitario del Dr. Menocal, autoclaves, tracoma y carta de Ricardo Ruiz Balb\xEDn (1920)." },
      { name: "Acto IV: Esclavitud del Mostrador e Indianos", pct: 20, description: "Jornadas de 16h, dormir sobre el mostrador, comandita vs. Quinta Covadonga y escuelas." },
      { name: "Acto V: Crac del 29, Vapor Sinaia + Outro (8s)", pct: 16, description: "El silencio de los fracasados (1921/1931), arribo del Sinaia (1939), legado y Outro de 8s." }
    ],
    comments: [
      {
        id: "seed-v76-c1",
        text: "\xBFPor qu\xE9 los j\xF3venes espa\xF1oles prefer\xEDan embarcarse casi adolescentes a los 14 o 16 a\xF1os hacia Cuba y M\xE9xico antes de cumplir la edad del sorteo militar?",
        author: "Comunidad YouTube",
        likes: 94,
        repeatCount: 14,
        category: "question",
        sourceType: "analyzed_video",
        videoTitle: "La llegada de los italianos a Argentina",
        videoId: "clqshy5NB7I"
      },
      {
        id: "seed-v76-c2",
        text: 'Hagan un documental sobre qu\xE9 pas\xF3 con los miles de emigrantes espa\xF1oles que NO se hicieron ricos ("los indianos fracasados") tras el desplome azucarero de 1921 y el Crac de 1929.',
        author: "Comunidad YouTube",
        likes: 82,
        repeatCount: 12,
        category: "suggestion",
        sourceType: "analyzed_video",
        videoTitle: "La llegada de los italianos a Argentina",
        videoId: "clqshy5NB7I"
      },
      {
        id: "seed-v76-c3",
        text: "\xBFC\xF3mo era realmente el campamento de cuarentena de Triscornia en La Habana y qu\xE9 les hac\xEDan a los inmigrantes de tercera clase al bajar del barco?",
        author: "Comunidad YouTube",
        likes: 76,
        repeatCount: 11,
        category: "question",
        sourceType: "analyzed_video",
        videoTitle: "La llegada de los italianos a Argentina",
        videoId: "clqshy5NB7I"
      },
      {
        id: "seed-v76-c4",
        text: "\xBFEs verdad que los dependientes espa\xF1oles en las bodegas de La Habana y tiendas de abarrotes y panader\xEDas de M\xE9xico ten\xEDan prohibido casarse y dorm\xEDan sobre el mostrador?",
        author: "Comunidad YouTube",
        likes: 68,
        repeatCount: 9,
        category: "question",
        sourceType: "analyzed_video",
        videoTitle: "La llegada de los italianos a Argentina",
        videoId: "clqshy5NB7I"
      },
      {
        id: "seed-v76-c5",
        text: "Deber\xEDan contar la historia de los grandes hospitales y palacios que construyeron los inmigrantes con sus cuotas: la Quinta Covadonga, La Ben\xE9fica en La Habana y la Beneficencia Espa\xF1ola en M\xE9xico.",
        author: "Comunidad YouTube",
        likes: 59,
        repeatCount: 8,
        category: "suggestion",
        sourceType: "analyzed_video",
        videoTitle: "La llegada de los italianos a Argentina",
        videoId: "clqshy5NB7I"
      },
      {
        id: "seed-v76-c6",
        text: "Hagan la continuaci\xF3n sobre el viaje del vapor Sinaia a Veracruz en junio de 1939 y c\xF3mo los refugiados republicanos transformaron la ciencia y la cultura en M\xE9xico.",
        author: "Comunidad YouTube",
        likes: 53,
        repeatCount: 7,
        category: "suggestion",
        sourceType: "analyzed_video",
        videoTitle: "La llegada de los italianos a Argentina",
        videoId: "clqshy5NB7I"
      },
      {
        id: "seed-v76-c7",
        text: '\xBFC\xF3mo funcionaban las "cartas de llamada" y las redes de emigraci\xF3n clandestina desde las r\xEDas de Galicia, Asturias y Canarias hacia Am\xE9rica?',
        author: "Comunidad YouTube",
        likes: 47,
        repeatCount: 6,
        category: "question",
        sourceType: "analyzed_video",
        videoTitle: "La llegada de los italianos a Argentina",
        videoId: "clqshy5NB7I"
      },
      {
        id: "analyzed_video-1-mw0ureh5",
        text: "Mi pap\xE1 italiano decidi\xF3 volver a Italia a los 75 a\xF1os y me vine a Italia con \xE9l. En casa siempre hablamos italiano y conservamos tradiciones italianas. Crec\xED con las dos culturas, pero extra\xF1o mi patria argentina cada d\xEDa. Emigrar es tener el coraz\xF3n partido en dos. \u{1F1E6}\u{1F1F7}\u2764\uFE0F",
        author: "@alessandramagni2147",
        likes: 621,
        repeatCount: 3,
        category: "comment",
        sourceType: "analyzed_video",
        videoTitle: "La llegada de los italianos a Argentina",
        videoId: "clqshy5NB7I"
      },
      {
        id: "analyzed_video-3-mw0ureh5",
        text: "Mis abuelos vinieron de Italia en esos barcos.! Yo tengo 78 a\xF1os. Tengo fotos de ellos y de bisabuelos tambi\xE9n! Mi emociona este v\xEDdeo \u{1F625}y ahora sus bisnietos son exitosos!!! \u2764\uFE0F\u2764\uFE0F\u2764\uFE0F\u2764\uFE0F\u{1F1E6}\u{1F1F7}\u{1F1E6}\u{1F1F7}\u{1F1E6}\u{1F1F7}",
        author: "@cristinadebernardi5811",
        likes: 282,
        repeatCount: 2,
        category: "comment",
        sourceType: "analyzed_video",
        videoTitle: "La llegada de los italianos a Argentina",
        videoId: "clqshy5NB7I"
      },
      {
        id: "analyzed_video-8-mw0ureh5",
        text: "Cuantas l\xE1grimas salieron...hoy...yo vine con 8 a\xF1os en el vapor FEDERICO .. Y AS\xCD FUE EL VIAJE. GRACIAS\u{1F60A}",
        author: "@mariatenaglia8168",
        likes: 144,
        repeatCount: 2,
        category: "comment",
        sourceType: "analyzed_video",
        videoTitle: "La llegada de los italianos a Argentina",
        videoId: "clqshy5NB7I"
      }
    ]
  },
  {
    id: "seed_louvre_medieval",
    videoId: "louvre_medieval_p1",
    url: "https://www.youtube.com/@huellas_de_la_humanidad",
    title: "Castillo del Louvre Medieval (Estructura de Fortaleza Oculta bajo Monumento Famoso)",
    channelName: "@huellas_de_la_humanidad",
    analyzedAt: (/* @__PURE__ */ new Date()).toISOString(),
    commentsCount: 42,
    structureSummary: `1. DECONSTRUCCI\xD3N DEL HOOK (00:00 - 00:30):
   - Arranca con el Intro Oficial (8s) seguido del Clip 1 (8s) mostrando el monumento actual frente a su pasado subterr\xE1neo oscuro. En el segundo 16 entra la voz con A\xF1o y Lugar cerrados con punto ("A\xF1o 1190, Par\xEDs, Francia."), planteando la paradoja central: millones caminan sobre una fortaleza de guerra sin saberlo. Antes del segundo 30 cierra con el Slogan Oficial sobre la mesa del historiador.
2. RADIOGRAF\xCDA ESTRUCTURAL BLOQUE POR BLOQUE:
   - Bloque 1 (Hook + Promesa, 8%): Choque visual entre el palacio actual y la mazmorra medieval original.
   - Bloque 2 (El Miedo que dio Origen al Muro, 20%): Por qu\xE9 Felipe II Augusto orden\xF3 levantar una fortaleza inexpugnable antes de ir a las Cruzadas.
   - Bloque 3 (Ingenier\xEDa Secreta y Foso Sumergido, 24%): Dimensiones reales del torre\xF3n (Grosse Tour), muros de piedra caliza y trampas defensivas.
   - Bloque 4 (Vida Cotidiana, Prisioneros y Tesoro Real, 22%): El olor, la humedad, las b\xF3vedas acorazadas y los prisioneros de Estado.
   - Bloque 5 (Demolici\xF3n, Transformaci\xF3n y Redescubrimiento, 18%): C\xF3mo qued\xF3 sepultado bajo el Renacimiento y c\xF3mo las excavaciones del siglo XX sacaron a la luz sus cimientos intactos.
   - Bloque 6 (Reflexi\xF3n Final + Outro Oficial de 8s, 8%): Qu\xE9 nos revela esa piedra oculta hoy + cierre limpio antes del Outro de 8s.
3. GATILLOS PSICOL\xD3GICOS DE VIRALIDAD:
   - "Lo oculto a plena vista": revelar que debajo de un lugar mundialmente conocido existe una estructura secreta que casi ning\xFAn turista comprende.`,
    structuralBlocks: [
      { name: "Intro (8s) + Hook y Promesa", pct: 8, description: "Contraste monumento actual vs. fortaleza subterr\xE1nea oculta y Slogan." },
      { name: "Acto I: La Amenaza Original", pct: 20, description: "El peligro militar que oblig\xF3 a construir la fortaleza." },
      { name: "Acto II: Ingenier\xEDa y Secretos", pct: 24, description: "Anatom\xEDa arquitect\xF3nica, fosos, muros y mecanismos ocultos." },
      { name: "Acto III: Vida y Sombras Dentro", pct: 22, description: "C\xE1rceles, tesoros, traiciones y vida real tras los muros." },
      { name: "Acto IV: Sepultura y Hallazgo", pct: 18, description: "C\xF3mo desapareci\xF3 y c\xF3mo la arqueolog\xEDa lo redescubri\xF3." },
      { name: "Cl\xEDmax Reflexivo + Outro (8s)", pct: 8, description: "Legado hist\xF3rico, pregunta a la audiencia y Outro Oficial de 8s." }
    ],
    comments: [
      {
        id: "seed-c1",
        text: "\xBFQu\xE9 pas\xF3 con los t\xFAneles subterr\xE1neos que conectaban el torre\xF3n con el r\xEDo Sena?",
        author: "Suscriptor Huellas",
        likes: 34,
        repeatCount: 6,
        category: "question",
        sourceType: "channel",
        videoTitle: "Castillo del Louvre Parte I",
        videoId: "louvre_medieval_p1"
      },
      {
        id: "seed-c2",
        text: "Deber\xEDan hacer la continuaci\xF3n contando c\xF3mo Carlos V transform\xF3 la fortaleza militar en residencia real y biblioteca.",
        author: "Suscriptor Huellas",
        likes: 29,
        repeatCount: 5,
        category: "suggestion",
        sourceType: "channel",
        videoTitle: "Castillo del Louvre Parte I",
        videoId: "louvre_medieval_p1"
      }
    ]
  },
  {
    id: "seed_princesas_edad_media",
    videoId: "princesas_edad_media",
    url: "https://www.youtube.com/@huellas_de_la_humanidad",
    title: "Las Princesas de la Edad Media (Estructura de Desmitificaci\xF3n de Vida Cotidiana e Intimidad Hist\xF3rica)",
    channelName: "@huellas_de_la_humanidad",
    analyzedAt: (/* @__PURE__ */ new Date()).toISOString(),
    commentsCount: 58,
    structureSummary: `1. DECONSTRUCCI\xD3N DEL HOOK (00:00 - 00:30):
   - Desmonta en los primeros 20 segundos el cuento de hadas moderno: frente al lujo imaginado, muestra el fr\xEDo glacial de los castillos, los matrimonios pol\xEDticos en la infancia y la falta total de privacidad.
2. RADIOGRAF\xCDA ESTRUCTURAL BLOQUE POR BLOQUE:
   - Bloque 1 (Intro 8s + Hook de Desmitificaci\xF3n, 9%): El contraste brutal entre el mito rom\xE1ntico y la realidad f\xEDsica medieval.
   - Bloque 2 (Infancia como Moneda de Alianza, 21%): Educaci\xF3n r\xEDgida, despedida de su familia a los 12 a\xF1os y viaje a un reino extranjero.
   - Bloque 3 (Higiene, Vestimenta Pesada y Fr\xEDo en el Castillo, 24%): Detalles sensoriales hiperrealistas (capas de lana, par\xE1sitos, chimeneas humeantes, comida y protocolo).
   - Bloque 4 (El Peligro de la Noche de Bodas y el Parto, 23%): La presi\xF3n din\xE1stica por dar un heredero var\xF3n y la alt\xEDsima mortalidad materna.
   - Bloque 5 (Poder Oculto, Regencias y Conspiraciones, 15%): C\xF3mo las mujeres que sobreviv\xEDan lograban gobernar imperios desde la sombra.
   - Bloque 6 (Cierre Reflexivo + Outro 8s, 8%): Reflexi\xF3n humana final y entrada limpia del Outro Oficial de 8s.
3. GATILLOS PSICOL\xD3GICOS DE VIRALIDAD:
   - Empat\xEDa corporal + desmitificaci\xF3n sensorial: el espectador siente el fr\xEDo, el peso de la ropa y el miedo real de una persona de carne y hueso en otra \xE9poca.`,
    structuralBlocks: [
      { name: "Intro (8s) + Choque Mito vs Realidad", pct: 9, description: "Destruye el clich\xE9 de cuento de hadas en los primeros segundos." },
      { name: "Acto I: Peones de Alianza", pct: 21, description: "Infancia, contratos matrimoniales y destierro diplom\xE1tico." },
      { name: "Acto II: Intimidad y Supervivencia", pct: 24, description: "Fr\xEDo, higiene, banquetes, vestimenta y vida diaria real." },
      { name: "Acto III: El Precio de la Corona", pct: 23, description: "Presi\xF3n por el heredero, medicina medieval y peligros mortales." },
      { name: "Acto IV: El Poder tras el Trono", pct: 15, description: "Intriga pol\xEDtica, regencias y legado hist\xF3rico." },
      { name: "Cierre Humano + Outro (8s)", pct: 8, description: "Pregunta reflexiva a la comunidad y Outro Oficial de 8s." }
    ],
    comments: [
      {
        id: "seed-c3",
        text: "\xBFC\xF3mo era realmente la higiene y los ba\xF1os dentro de los palacios europeos antes del siglo XVIII?",
        author: "Comunidad Huellas",
        likes: 51,
        repeatCount: 8,
        category: "question",
        sourceType: "channel",
        videoTitle: "Las Princesas de la Edad Media",
        videoId: "princesas_edad_media"
      },
      {
        id: "seed-c4",
        text: "Hagan un documental sobre c\xF3mo viv\xEDan los sirvientes y guardias invisibles dentro de los grandes castillos.",
        author: "Comunidad Huellas",
        likes: 41,
        repeatCount: 4,
        category: "suggestion",
        sourceType: "channel",
        videoTitle: "Las Princesas de la Edad Media",
        videoId: "princesas_edad_media"
      }
    ]
  },
  {
    id: "seed_misterio_investigativo",
    videoId: "misterio_cronologico_viral",
    url: "https://www.youtube.com/@huellas_de_la_humanidad",
    title: "Misterio Hist\xF3rico / True Crime Antiguo (Estructura de Investigaci\xF3n Forense en 5 Pistas)",
    channelName: "Plantilla Viral Analizada",
    analyzedAt: (/* @__PURE__ */ new Date()).toISOString(),
    commentsCount: 31,
    structureSummary: `1. DECONSTRUCCI\xD3N DEL HOOK (00:00 - 00:30):
   - Abre con la escena del hallazgo o el instante exacto de la desaparici\xF3n/crimen hist\xF3rico, presentando una prueba f\xEDsica que contradice la versi\xF3n oficial de los libros.
2. RADIOGRAF\xCDA ESTRUCTURAL BLOQUE POR BLOQUE:
   - Bloque 1 (Intro 8s + Escena del Enigma, 8%): Fecha exacta, lugar y el hallazgo inexplicable que abre la investigaci\xF3n.
   - Bloque 2 (La Versi\xF3n Oficial y su Grieta, 19%): Qu\xE9 se crey\xF3 durante siglos y cu\xE1l es el documento o rastro que no encaja.
   - Bloque 3 (Reconstrucci\xF3n Minuto a Minuto, 25%): Seguimiento cronol\xF3gico de las \xFAltimas horas de los protagonistas como un thriller documental.
   - Bloque 4 (Los Sospechosos y el Motivo Oculto, 22%): Intereses pol\xEDticos, religiosos o econ\xF3micos detr\xE1s del encubrimiento.
   - Bloque 5 (La Evidencia Forense / Arqueol\xF3gica Moderna, 18%): Qu\xE9 revel\xF3 la ciencia moderna al analizar los restos o archivos secretos.
   - Bloque 6 (Veredicto Abierto + Outro 8s, 8%): Presentaci\xF3n de la conclusi\xF3n m\xE1s s\xF3lida + pregunta de debate + Outro Oficial de 8s.
3. GATILLOS PSICOL\xD3GICOS DE VIRALIDAD:
   - Efecto Zeigarnik (bucles abiertos): cada acto resuelve una pista pero abre una pregunta mayor hasta el veredicto del \xFAltimo bloque.`,
    structuralBlocks: [
      { name: "Intro (8s) + El Hallazgo Inexplicable", pct: 8, description: "Presenta el enigma central y la contradicci\xF3n hist\xF3rica." },
      { name: "Acto I: La Versi\xF3n Oficial rota", pct: 19, description: "Expone la historia oficial y la pista que la desmiente." },
      { name: "Acto II: Cronolog\xEDa del Suceso", pct: 25, description: "Reconstrucci\xF3n inmersiva hora por hora de los hechos." },
      { name: "Acto III: Conspiraci\xF3n y Motivos", pct: 22, description: "Qui\xE9n ganaba con el silencio y c\xF3mo se ocult\xF3 la verdad." },
      { name: "Acto IV: Ciencia vs. Mito", pct: 18, description: "Descubrimientos arqueol\xF3gicos o forenses recientes." },
      { name: "Veredicto + Outro (8s)", pct: 8, description: "Cierre reflexivo con la huella hist\xF3rica y Outro de 8s." }
    ],
    comments: []
  }
];
function deduplicateAndClusterComments(rawComments, sourceType, fallbackVideoTitle = "") {
  const questionRx = /\?|¿|\b(por qu[eé]|c[oó]mo|cu[aá]ndo|d[oó]nde|qui[eé]n|qu[eé] pas[oó]|es verdad|ser[aá] cierto|alguien sabe|duda|pregunta)\b/i;
  const suggestionRx = /\b(deber[ií]as|deber[ií]an|podr[ií]as|podr[ií]an|haz un video|hagan un video|habla sobre|hablen sobre|falta hablar|falt[oó] mencionar|sugiero|recomiendo|ser[ií]a bueno|me gustar[ií]a ver|para cu[aá]ndo un video|siguiente video|parte 2|parte ii|segunda parte)\b/i;
  const stopWords = /* @__PURE__ */ new Set([
    "para",
    "como",
    "este",
    "esta",
    "estos",
    "estas",
    "pero",
    "porque",
    "cuando",
    "donde",
    "quien",
    "sobre",
    "entre",
    "hasta",
    "desde",
    "todo",
    "toda",
    "todos",
    "todas",
    "muy",
    "mas",
    "tambien",
    "solo",
    "hacer",
    "hace",
    "hizo",
    "video",
    "videos",
    "canal",
    "hola",
    "saludos",
    "gracias",
    "buen",
    "bueno",
    "buena",
    "excelente",
    "encanta",
    "gustaria",
    "puedes",
    "podrias",
    "deberian",
    "deberias",
    "hablar",
    "hacerlo",
    "favor",
    "amigo"
  ]);
  const extractSignificantTokens = (text) => {
    const norm = text.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-z0-9\s]/g, " ").split(/\s+/).filter((w) => w.length >= 4 && !stopWords.has(w));
    return Array.from(new Set(norm));
  };
  const clusters = [];
  for (const c of rawComments) {
    const clean = String(c.text || "").replace(/\s+/g, " ").trim();
    if (clean.length < 8) continue;
    const category = questionRx.test(clean) ? "question" : suggestionRx.test(clean) ? "suggestion" : "comment";
    const tokensArr = extractSignificantTokens(clean);
    const normKey = tokensArr.slice(0, 8).sort().join("_");
    const tokenSet = new Set(tokensArr);
    const numericLikes = parseInt(String(c.likes || "0").replace(/[^0-9]/g, ""), 10) || 0;
    let matchedCluster = null;
    for (const cl of clusters) {
      if (cl.item.category !== category) continue;
      if (normKey && cl.normKey === normKey) {
        matchedCluster = cl;
        break;
      }
      if (tokenSet.size >= 2 && cl.tokens.size >= 2) {
        let overlap = 0;
        for (const t of tokenSet) {
          if (cl.tokens.has(t)) overlap++;
        }
        const minSize = Math.min(tokenSet.size, cl.tokens.size);
        const maxSize = Math.max(tokenSet.size, cl.tokens.size);
        if (overlap >= 2 && (overlap / minSize >= 0.65 || overlap / maxSize >= 0.5)) {
          matchedCluster = cl;
          break;
        }
      }
    }
    if (matchedCluster) {
      matchedCluster.item.repeatCount += 1;
      matchedCluster.item.likes += numericLikes;
      if (clean.length > matchedCluster.item.text.length && clean.length <= 220) {
        matchedCluster.item.text = clean;
      }
      for (const t of tokenSet) matchedCluster.tokens.add(t);
    } else {
      clusters.push({
        normKey,
        tokens: tokenSet,
        item: {
          id: `${sourceType}-${clusters.length + 1}-${Date.now().toString(36)}`,
          text: clean,
          author: c.author || "Espectador",
          likes: numericLikes,
          repeatCount: 1,
          category,
          sourceType,
          videoTitle: c.videoTitle || fallbackVideoTitle || "Video analizado",
          videoId: c.videoId || ""
        }
      });
    }
  }
  return clusters.map((c) => c.item).sort((a, b) => {
    if (b.repeatCount !== a.repeatCount) return b.repeatCount - a.repeatCount;
    if (a.category !== b.category) {
      const order = { question: 0, suggestion: 1, comment: 2 };
      return order[a.category] - order[b.category];
    }
    return b.likes - a.likes;
  });
}
function loadAnalyzedVideosLibrary() {
  try {
    if (import_fs.default.existsSync(ANALYZED_VIDEOS_LIBRARY_FILE)) {
      const parsed = JSON.parse(import_fs.default.readFileSync(ANALYZED_VIDEOS_LIBRARY_FILE, "utf8"));
      if (Array.isArray(parsed) && parsed.length > 0) {
        const existingIds = new Set(
          parsed.flatMap((item) => [item?.id, item?.videoId].filter(Boolean))
        );
        const missingSeeds = DEFAULT_ANALYZED_VIDEOS_SEED.filter(
          (seed) => !existingIds.has(seed.id) && !existingIds.has(seed.videoId)
        );
        if (missingSeeds.length > 0) {
          const merged = [...missingSeeds, ...parsed];
          try {
            import_fs.default.writeFileSync(
              ANALYZED_VIDEOS_LIBRARY_FILE,
              JSON.stringify(merged, null, 2),
              "utf8"
            );
          } catch {
          }
          return merged;
        }
        return parsed;
      }
    }
  } catch {
  }
  try {
    import_fs.default.writeFileSync(
      ANALYZED_VIDEOS_LIBRARY_FILE,
      JSON.stringify(DEFAULT_ANALYZED_VIDEOS_SEED, null, 2),
      "utf8"
    );
  } catch {
  }
  return [...DEFAULT_ANALYZED_VIDEOS_SEED];
}
function saveAnalyzedVideosLibrary(list) {
  try {
    import_fs.default.writeFileSync(ANALYZED_VIDEOS_LIBRARY_FILE, JSON.stringify(list, null, 2), "utf8");
  } catch {
  }
}
function classifyQuestionsAndSuggestionsHeuristic(comments) {
  const deduped = deduplicateAndClusterComments(comments, "analyzed_video");
  const questions = deduped.filter((c) => c.category === "question").slice(0, 15).map(
    (c) => `${c.repeatCount > 1 ? `[Repetido \xD7${c.repeatCount}] ` : ""}[${c.author}]: "${c.text}"`
  );
  const suggestions = deduped.filter((c) => c.category === "suggestion").slice(0, 15).map(
    (c) => `${c.repeatCount > 1 ? `[Repetido \xD7${c.repeatCount}] ` : ""}[${c.author}]: "${c.text}"`
  );
  const notableComments = deduped.filter((c) => c.category === "comment").slice(0, 12).map(
    (c) => `${c.repeatCount > 1 ? `[Repetido \xD7${c.repeatCount}] ` : ""}[${c.author}]: "${c.text}"`
  );
  return { questions, suggestions, notableComments };
}
app.get("/api/youtube/analyzed-videos", async (_req, res) => {
  try {
    const library = loadAnalyzedVideosLibrary();
    const channelData = await fetchHuellasChannelCommentsCached(false);
    const deduplicatedChannelComments = deduplicateAndClusterComments(
      channelData.comments,
      "channel",
      "@huellas_de_la_humanidad"
    );
    const effectiveChannelComments = deduplicatedChannelComments.length > 0 ? deduplicatedChannelComments : library.flatMap((v) => v.comments || []).filter((c) => c.sourceType === "channel");
    const analyzedVideosComments = library.flatMap(
      (v) => (v.comments || []).map((c) => ({
        ...c,
        videoTitle: c.videoTitle || v.title,
        videoId: c.videoId || v.videoId
      }))
    );
    res.json({
      ok: true,
      videos: library,
      channelComments: effectiveChannelComments,
      analyzedVideosComments,
      channelVideosScanned: channelData.videoCount,
      channelUpdatedAt: channelData.updatedAt
    });
  } catch (err) {
    res.status(500).json({ error: err?.message || "Error cargando biblioteca de videos analizados." });
  }
});
app.post("/api/youtube/analyzed-videos", (req, res) => {
  try {
    const body = req.body || {};
    const library = loadAnalyzedVideosLibrary();
    const rawUrl = String(body.url || "").trim();
    const extractedId = extractYoutubeVideoId(rawUrl) || String(body.videoId || body.id || `vid_${Date.now()}`);
    const existingIdx = library.findIndex(
      (v) => v.id === body.id || v.videoId === extractedId || rawUrl && v.url === rawUrl
    );
    const entry = {
      id: existingIdx >= 0 ? library[existingIdx].id : String(body.id || `vid_${extractedId}`),
      videoId: extractedId,
      url: rawUrl || (existingIdx >= 0 ? library[existingIdx].url : ""),
      title: String(body.title || (existingIdx >= 0 ? library[existingIdx].title : `Video Analizado (${extractedId})`)).trim(),
      channelName: String(body.channelName || (existingIdx >= 0 ? library[existingIdx].channelName : "YouTube")).trim(),
      analyzedAt: (/* @__PURE__ */ new Date()).toISOString(),
      commentsCount: Number(body.commentsCount ?? (existingIdx >= 0 ? library[existingIdx].commentsCount : 0)),
      structureSummary: String(
        body.structureSummary || (existingIdx >= 0 ? library[existingIdx].structureSummary : "")
      ).trim(),
      structuralBlocks: Array.isArray(body.structuralBlocks) && body.structuralBlocks.length > 0 ? body.structuralBlocks : existingIdx >= 0 ? library[existingIdx].structuralBlocks : [
        { name: "Intro (8s) + Hook Sensorial", pct: 8, description: "Apertura de alto impacto y promesa narrativa antes del segundo 30." },
        { name: "Acto I: Contexto y Paradoja", pct: 20, description: "Planteamiento del escenario hist\xF3rico y la contradicci\xF3n central." },
        { name: "Acto II: Escalada y Revelaciones", pct: 25, description: "Desarrollo cronol\xF3gico con micro-ganchos de retenci\xF3n." },
        { name: "Acto III: Giro Dram\xE1tico", pct: 22, description: "Punto de inflexi\xF3n hist\xF3rico y consecuencias humanas." },
        { name: "Acto IV: Desenlace y Huella", pct: 17, description: "Resoluci\xF3n del misterio y conexi\xF3n con el presente." },
        { name: "Cierre Reflexivo + Outro (8s)", pct: 8, description: "Slogan final, pregunta a la audiencia y Outro Oficial de 8s." }
      ],
      comments: Array.isArray(body.comments) && body.comments.length > 0 ? body.comments : existingIdx >= 0 ? library[existingIdx].comments : []
    };
    if (existingIdx >= 0) {
      library[existingIdx] = entry;
    } else {
      library.unshift(entry);
    }
    saveAnalyzedVideosLibrary(library);
    res.json({ ok: true, entry, videos: library });
  } catch (err) {
    res.status(500).json({ error: err?.message || "Error guardando video analizado." });
  }
});
app.post("/api/youtube/analyze-comments-research", async (req, res) => {
  try {
    const { videoUrl = "", forceRefreshChannel = false, allowPaidApi = false } = req.body || {};
    const targetVideoId = extractYoutubeVideoId(videoUrl);
    const [targetData, channelData] = await Promise.all([
      targetVideoId ? fetchYoutubeVideoCommentsDataOnly(targetVideoId, 3) : Promise.resolve({ videoId: "", title: "", comments: [] }),
      fetchHuellasChannelCommentsCached(Boolean(forceRefreshChannel))
    ]);
    const targetViewerComments = targetData.comments.filter(
      (c) => !c.author.toLowerCase().includes("huellas_de_la_humanidad")
    );
    const deduplicatedTargetComments = deduplicateAndClusterComments(
      targetViewerComments,
      "analyzed_video",
      targetData.title || videoUrl
    );
    const deduplicatedChannelComments = deduplicateAndClusterComments(
      channelData.comments,
      "channel",
      "@huellas_de_la_humanidad"
    );
    const targetClassified = classifyQuestionsAndSuggestionsHeuristic(targetViewerComments);
    const channelClassified = classifyQuestionsAndSuggestionsHeuristic(channelData.comments);
    let aiSynthesizedQuestions = [];
    let aiSynthesizedSuggestions = [];
    let aiResearchDirectives = [];
    const ai = allowPaidApi ? getGeminiClient() : null;
    if (ai && (targetViewerComments.length > 0 || channelData.comments.length > 0)) {
      try {
        const sampleTarget = targetViewerComments.slice(0, 45).map((c) => `- (${c.author}): ${c.text.replace(/\s+/g, " ").slice(0, 280)}`).join("\n");
        const sampleChannel = channelData.comments.slice(0, 55).map(
          (c) => `- [${(c.videoTitle || "").slice(0, 55)}] (${c.author}): ${c.text.replace(/\s+/g, " ").slice(0, 260)}`
        ).join("\n");
        const promptText = `Act\xFAa como Investigador Jefe y Estratega de Contenido de "Huellas de la Humanidad" (${HUELLAS_OFFICIAL_CHANNEL_URL}).
Hemos extra\xEDdo los comentarios reales de dos fuentes:
1) VIDEO DE YOUTUBE A ANALIZAR (${videoUrl || "No especificado"} \u2014 T\xEDtulo: "${targetData.title || ""}"):
${sampleTarget || "(Sin comentarios p\xFAblicos detectados en este video)"}

2) COMENTARIOS DE TODOS LOS VIDEOS DE MI CANAL OFICIAL (${HUELLAS_OFFICIAL_CHANNEL_HANDLE} \u2014 ${channelData.videoCount} videos escaneados):
${sampleChannel || "(Sin comentarios adicionales)"}

TU TAREA:
Analiza todos estos comentarios buscando espec\xEDficamente:
- Preguntas, dudas hist\xF3ricas, vac\xEDos de informaci\xF3n o inquietudes que las personas dejaron en los comentarios.
- Sugerencias de temas, enfoques, personajes, \xE9pocas o \xE1ngulos que las personas piden o debaten.
- Qu\xE9 puntos espec\xEDficos DEBE incluir el PROMPT PARA REALIZAR LA INVESTIGACI\xD3N PROFUNDA para que la investigaci\xF3n responda con rigor hist\xF3rico a esas preguntas y aproveche esas sugerencias de la audiencia.

Devuelve EXCLUSIVAMENTE un JSON v\xE1lido con esta estructura:
{
  "questionsDetected": [
    "Pregunta o duda real detectada en los comentarios"
  ],
  "suggestionsDetected": [
    "Sugerencia, petici\xF3n o debate real detectado en los comentarios"
  ],
  "researchPromptDirectives": [
    "Directriz concreta de investigaci\xF3n para incluir dentro del Prompt de Investigaci\xF3n Profunda"
  ]
}`;
        const models = ["gemini-2.5-flash", "gemini-3-flash-preview", "gemini-3.1-pro-preview"];
        for (const m of models) {
          try {
            const resp = await ai.models.generateContent({
              model: m,
              contents: [{ role: "user", parts: [{ text: promptText }] }],
              config: { responseMimeType: "application/json" }
            });
            if (resp.text) {
              const parsed = JSON.parse(resp.text.trim());
              if (Array.isArray(parsed.questionsDetected)) {
                aiSynthesizedQuestions = parsed.questionsDetected.map(String).filter(Boolean);
              }
              if (Array.isArray(parsed.suggestionsDetected)) {
                aiSynthesizedSuggestions = parsed.suggestionsDetected.map(String).filter(Boolean);
              }
              if (Array.isArray(parsed.researchPromptDirectives)) {
                aiResearchDirectives = parsed.researchPromptDirectives.map(String).filter(Boolean);
              }
              break;
            }
          } catch {
          }
        }
      } catch {
      }
    }
    const finalQuestions = aiSynthesizedQuestions.length > 0 ? aiSynthesizedQuestions : [
      ...targetClassified.questions.map((q) => `(Video analizado) ${q}`),
      ...channelClassified.questions.map((q) => `(@huellas_de_la_humanidad) ${q}`)
    ].slice(0, 15);
    const finalSuggestions = aiSynthesizedSuggestions.length > 0 ? aiSynthesizedSuggestions : [
      ...targetClassified.suggestions.map((s) => `(Video analizado) ${s}`),
      ...channelClassified.suggestions.map((s) => `(@huellas_de_la_humanidad) ${s}`),
      ...targetClassified.notableComments.slice(0, 4).map((n) => `(Reacci\xF3n en video analizado) ${n}`),
      ...channelClassified.notableComments.slice(0, 4).map((n) => `(Reacci\xF3n en @huellas_de_la_humanidad) ${n}`)
    ].slice(0, 15);
    const library = loadAnalyzedVideosLibrary();
    let matchedLibraryEntry = null;
    if (targetVideoId) {
      const existingIdx = library.findIndex((v) => v.videoId === targetVideoId || v.url === videoUrl);
      const defaultSummary = `An\xE1lisis de "${targetData.title || videoUrl}":
- Comentarios p\xFAblicos extra\xEDdos y agrupados: ${targetViewerComments.length} (${deduplicatedTargetComments.length} \xFAnicos agrupados por repetici\xF3n).
- Al ejecutar "\u2728 Comenzar Investigaci\xF3n", Gemini Web (en modo High + Deep Research) realizar\xE1 la radiograf\xEDa completa de los 8 ejes virales de este video junto con la investigaci\xF3n del documental en curso y actualizar\xE1 esta ficha autom\xE1ticamente.`;
      const entry = {
        id: existingIdx >= 0 ? library[existingIdx].id : `vid_${targetVideoId}`,
        videoId: targetVideoId,
        url: videoUrl,
        title: targetData.title && targetData.title !== targetVideoId ? targetData.title : existingIdx >= 0 ? library[existingIdx].title : `Video de YouTube (${targetVideoId})`,
        channelName: existingIdx >= 0 ? library[existingIdx].channelName : "YouTube Referencia Viral",
        analyzedAt: (/* @__PURE__ */ new Date()).toISOString(),
        commentsCount: targetViewerComments.length,
        structureSummary: existingIdx >= 0 && library[existingIdx].structureSummary ? library[existingIdx].structureSummary : defaultSummary,
        structuralBlocks: existingIdx >= 0 && library[existingIdx].structuralBlocks?.length > 0 ? library[existingIdx].structuralBlocks : [
          { name: "Intro (8s) + Hook Viral", pct: 8, description: "Apertura magn\xE9tica en los primerossegundos y promesa narrativa." },
          { name: "Acto I: Planteamiento Hist\xF3rico", pct: 20, description: "Contexto de \xE9poca, lugar y contradicci\xF3n inicial." },
          { name: "Acto II: Desarrollo y Tensi\xF3n", pct: 25, description: "Progresi\xF3n narrativa con micro-ganchos de retenci\xF3n." },
          { name: "Acto III: Revelaci\xF3n Central", pct: 22, description: "Giro dram\xE1tico y hallazgos documentales." },
          { name: "Acto IV: Impacto y Legado", pct: 17, description: "Resoluci\xF3n hist\xF3rica de las preguntas planteadas." },
          { name: "Cierre + Outro Oficial (8s)", pct: 8, description: "Reflexi\xF3n final, Slogan y Outro Oficial de 8s." }
        ],
        comments: deduplicatedTargetComments
      };
      if (existingIdx >= 0) {
        library[existingIdx] = entry;
      } else {
        library.unshift(entry);
      }
      saveAnalyzedVideosLibrary(library);
      matchedLibraryEntry = entry;
    }
    const lines = [
      `================================================================================`,
      `\u{1F4AC} MINER\xCDA REAL DE COMENTARIOS DE LA AUDIENCIA (VIDEO ANALIZADO + CANAL ${HUELLAS_OFFICIAL_CHANNEL_HANDLE})`,
      `================================================================================`,
      `- Video de referencia analizado: ${targetData.title || videoUrl || "Canal General"} (${targetViewerComments.length} comentarios le\xEDdos, agrupados por frecuencia)`,
      `- Canal propio escaneado (${HUELLAS_OFFICIAL_CHANNEL_URL}): ${channelData.videoCount} videos revisados (${channelData.comments.length} comentarios de suscriptores le\xEDdos)`,
      ``,
      `\u2753 PREGUNTAS, DUDAS E INQUIETUDES DE LAS PERSONAS EN LOS COMENTARIOS (CON FRECUENCIA DE REPETICI\xD3N):`,
      ...finalQuestions.length > 0 ? finalQuestions.map((q, i) => `   ${i + 1}. ${q}`) : [
        `   - No se detectaron preguntas literales con signo de interrogaci\xF3n; analiza las reacciones de la audiencia para anticipar sus dudas hist\xF3ricas sobre "${targetData.title || "este tema"}".`
      ],
      ``,
      `\u{1F4A1} SUGERENCIAS, PETICIONES Y DEBATES DE LA AUDIENCIA EN LOS COMENTARIOS (CON FRECUENCIA DE REPETICI\xD3N):`,
      ...finalSuggestions.length > 0 ? finalSuggestions.map((s, i) => `   ${i + 1}. ${s}`) : [
        `   - Profundizar en los detalles humanos, cotidianos y psicol\xF3gicos que m\xE1s despiertan conversaci\xF3n en la comunidad de ${HUELLAS_OFFICIAL_CHANNEL_HANDLE}.`
      ],
      ...aiResearchDirectives.length > 0 ? [
        ``,
        `\u{1F3AF} \xC1NGULOS OBLIGATORIOS A INCLUIR EN EL PROMPT PARA REALIZAR LA INVESTIGACI\xD3N:`,
        ...aiResearchDirectives.map((d, i) => `   ${i + 1}. ${d}`)
      ] : [],
      ``,
      `-> REGLA INQUEBRANTABLE SOBRE ESTOS COMENTARIOS (SOLO EN EL PROMPT DE INVESTIGACI\xD3N):`,
      `   NO insertes estas preguntas ni sugerencias directamente como texto suelto en el resultado final, SINO INCL\xDAYELAS OBLIGATORIAMENTE DENTRO DEL PROMPT PARA REALIZAR LA INVESTIGACI\xD3N PROFUNDA para que al ejecutar dicho prompt de investigaci\xF3n se investiguen y respondan a fondo todas las dudas, preguntas y sugerencias reales de la audiencia.`,
      `================================================================================`
    ];
    const researchPromptBlock = lines.join("\n");
    res.json({
      ok: true,
      targetVideoId,
      targetVideoTitle: targetData.title || videoUrl,
      targetCommentsCount: targetViewerComments.length,
      channelVideosScanned: channelData.videoCount,
      channelCommentsCount: channelData.comments.length,
      channelUpdatedAt: channelData.updatedAt,
      questionsDetected: finalQuestions,
      suggestionsDetected: finalSuggestions,
      researchDirectives: aiResearchDirectives,
      researchPromptBlock,
      deduplicatedTargetComments,
      deduplicatedChannelComments,
      analyzedVideosLibrary: library,
      matchedLibraryEntry
    });
  } catch (err) {
    console.error("Error en /api/youtube/analyze-comments-research:", err);
    res.status(500).json({
      error: err?.message || "Error al analizar comentarios de YouTube."
    });
  }
});
app.post("/api/video/optical-flow", async (req, res) => {
  try {
    const {
      folderPath = "",
      folderName = "",
      docTitle = "",
      clipId = "",
      clipNumber = 0,
      fileName = "",
      videoUrl = "",
      aspectRatio = "16:9",
      trimStart = 0,
      trimEnd = 0,
      speed = 1,
      targetDuration = 0,
      smoothSlowMo = true
    } = req.body || {};
    let sourceMp4 = "";
    if (videoUrl && typeof videoUrl === "string") {
      try {
        const parsed = new URL(videoUrl, "http://localhost:4200");
        const fp = parsed.searchParams.get("filePath");
        if (fp && !fp.includes(".optical_flow_cache") && !fp.includes(".foley_only_cache") && !fp.includes(".vocals_cache") && !fp.includes(".music_cache") && !/_foley_(?:only|v2)\.mp4$/i.test(fp) && import_fs.default.existsSync(fp)) {
          sourceMp4 = fp;
        }
      } catch {
      }
    }
    const resolvedRoot = resolveLocalDocumentaryFolder(folderPath, folderName, docTitle);
    const clipsVideoSubdir = resolvedRoot ? import_path.default.join(resolvedRoot, "05_Clips_Video") : "";
    const clipsApprovedSubdir = resolvedRoot ? import_path.default.join(resolvedRoot, "Clips_Aprobados") : "";
    if (!sourceMp4 && resolvedRoot && import_fs.default.existsSync(resolvedRoot)) {
      const searchDirs = [clipsVideoSubdir, resolvedRoot, clipsApprovedSubdir].filter(
        (d) => d && import_fs.default.existsSync(d)
      );
      if (fileName) {
        const cleanFileName = import_path.default.basename(fileName).replace(/_foley_(?:only|v2)(?=\.[^.]+$)/i, "");
        for (const d of searchDirs) {
          const cand = import_path.default.join(d, cleanFileName);
          if (import_fs.default.existsSync(cand) && import_fs.default.statSync(cand).isFile()) {
            sourceMp4 = cand;
            break;
          }
        }
      }
      if (!sourceMp4 && Number(clipNumber) > 0) {
        const num = Number(clipNumber);
        const prefixRegex = new RegExp(`^(?:clip[_\\-\\s.]*)?0*${num}[_\\-\\s.]`, "i");
        for (const d of searchDirs) {
          const matches = import_fs.default.readdirSync(d).filter(
            (f) => !f.startsWith(".") && prefixRegex.test(f) && /\.(mp4|mov|webm)$/i.test(f)
          ).sort((a, b) => {
            const a4k = /[_\-]4k\.(mp4|mov|webm)$/i.test(a) ? 1 : 0;
            const b4k = /[_\-]4k\.(mp4|mov|webm)$/i.test(b) ? 1 : 0;
            if (b4k !== a4k) return b4k - a4k;
            try {
              return import_fs.default.statSync(import_path.default.join(d, b)).mtimeMs - import_fs.default.statSync(import_path.default.join(d, a)).mtimeMs;
            } catch {
              return 0;
            }
          });
          if (matches.length > 0) {
            sourceMp4 = import_path.default.join(d, matches[0]);
            break;
          }
        }
      }
    }
    if (!sourceMp4 || !import_fs.default.existsSync(sourceMp4)) {
      res.status(404).json({
        ok: false,
        error: `No se encontr\xF3 el archivo MP4 original para el Clip ${String(clipNumber || "").padStart(2, "0")}.`
      });
      return;
    }
    const ffmpegBin = getFfmpegPath();
    const probeMediaDurationSec = (filePath) => new Promise((resolve) => {
      (0, import_child_process.exec)(
        `ffprobe -v error -select_streams v:0 -show_entries stream=duration -of default=noprint_wrappers=1:nokey=1 "${filePath.replace(/"/g, '\\"')}"`,
        { timeout: 4e3 },
        (err, stdout) => {
          const parsed = parseFloat(String(stdout || "").trim());
          if (!err && Number.isFinite(parsed) && parsed > 0.3) {
            resolve(parsed);
            return;
          }
          const proc = (0, import_child_process.spawn)(ffmpegBin, ["-i", filePath]);
          let stderr = "";
          proc.stderr.on("data", (d) => {
            stderr += d.toString();
          });
          proc.on("close", () => {
            const m = stderr.match(/Duration:\s*(\d+):(\d+):(\d+(?:\.\d+)?)/);
            if (m) {
              const sec = parseInt(m[1], 10) * 3600 + parseInt(m[2], 10) * 60 + parseFloat(m[3]);
              if (Number.isFinite(sec) && sec > 0.3) {
                resolve(Math.max(0.3, sec - 0.06));
                return;
              }
            }
            resolve(0);
          });
          proc.on("error", () => resolve(0));
        }
      );
    });
    const probedSourceDur = await probeMediaDurationSec(sourceMp4);
    const actualSourceDur = probedSourceDur > 0.4 ? probedSourceDur : Number(trimEnd) > 0.5 ? Number(trimEnd) : 8;
    const reqSpeed = Math.max(0.15, Math.min(4, Number(speed) || 1));
    const reqTrimStart = Math.max(0, Number(trimStart) || 0);
    const reqTrimEnd = Number(trimEnd) > reqTrimStart + 0.05 ? Number(trimEnd) : actualSourceDur;
    const realTrimStart = Math.max(0, Math.min(actualSourceDur - 0.35, reqTrimStart));
    const realTrimEnd = reqTrimEnd > realTrimStart + 0.1 && reqTrimEnd < actualSourceDur - 0.06 ? reqTrimEnd : Math.max(realTrimStart + 0.35, actualSourceDur - 0.06);
    const realSpan = Math.max(0.3, realTrimEnd - realTrimStart);
    const effectiveTargetDur = Number(targetDuration) > 0.4 ? Number(targetDuration) : Number((Math.max(0.3, reqTrimEnd - reqTrimStart) / reqSpeed).toFixed(3));
    const safeSpeed = Math.max(
      0.15,
      Math.min(4, Number((realSpan / effectiveTargetDur).toFixed(4)))
    );
    const safeTrimStart = realTrimStart;
    const safeTrimEnd = realTrimEnd;
    const useOpticalFlow = Boolean(smoothSlowMo) && (safeSpeed < 0.99 || reqSpeed < 0.99);
    const cacheDir = import_path.default.join(import_path.default.dirname(sourceMp4), ".optical_flow_cache");
    if (!import_fs.default.existsSync(cacheDir)) {
      import_fs.default.mkdirSync(cacheDir, { recursive: true });
    }
    const baseKey = import_path.default.basename(sourceMp4, import_path.default.extname(sourceMp4)).replace(/[^a-zA-Z0-9_-]/g, "_").slice(0, 48);
    const bakedKey = `t${safeTrimStart.toFixed(2)}_${safeTrimEnd.toFixed(2)}_d${effectiveTargetDur.toFixed(2)}_of${useOpticalFlow ? 2 : 0}`;
    const outFileName = `${baseKey}_${bakedKey}.mp4`;
    const outFullPath = import_path.default.join(cacheDir, outFileName);
    if (import_fs.default.existsSync(outFullPath) && import_fs.default.statSync(outFullPath).size > 15e3) {
      const st2 = import_fs.default.statSync(outFullPath);
      res.json({
        ok: true,
        cached: true,
        clipId,
        clipNumber,
        bakedKey,
        speed: safeSpeed,
        trimStart: safeTrimStart,
        trimEnd: safeTrimEnd,
        actualSourceDuration: Number(actualSourceDur.toFixed(3)),
        targetDuration: effectiveTargetDur,
        smoothSlowMo: useOpticalFlow,
        opticalFlowUrl: `/api/flow/serve-folder-file?filePath=${encodeURIComponent(outFullPath)}&v=${Math.floor(st2.mtimeMs)}`
      });
      return;
    }
    const ptsFactor = ((effectiveTargetDur + 0.12) / realSpan).toFixed(5);
    const isVertical = aspectRatio === "9:16";
    const outW = isVertical ? 1080 : 1920;
    const outH = isVertical ? 1920 : 1080;
    const motionEstW = isVertical ? 480 : 854;
    const motionEstH = isVertical ? 854 : 480;
    const inputTrimArgs = [];
    if (safeTrimStart > 0.01) {
      inputTrimArgs.push("-ss", safeTrimStart.toFixed(3));
    }
    if (safeTrimEnd > safeTrimStart + 0.05) {
      inputTrimArgs.push("-to", safeTrimEnd.toFixed(3));
    }
    const buildAtempoChain = (spd) => {
      const stages = [];
      let rem = Math.max(0.15, Math.min(4, spd));
      if (Math.abs(rem - 1) >= 0.02) {
        while (rem < 0.5) {
          stages.push("atempo=0.5");
          rem /= 0.5;
        }
        while (rem > 2) {
          stages.push("atempo=2.0");
          rem /= 2;
        }
        stages.push(`atempo=${rem.toFixed(3)}`);
      } else {
        stages.push("volume=1.0");
      }
      stages.push(`apad=whole_dur=${effectiveTargetDur.toFixed(3)}`);
      return stages.join(",");
    };
    const afFilter = buildAtempoChain(safeSpeed);
    const vfMci = useOpticalFlow ? `scale=${motionEstW}:${motionEstH}:force_original_aspect_ratio=decrease,pad=${motionEstW}:${motionEstH}:(ow-iw)/2:(oh-ih)/2,setpts=${ptsFactor}*(PTS-STARTPTS),minterpolate=fps=30:mi_mode=mci:mc_mode=obmc:me_mode=bilat:me=ds:mb_size=16:search_param=8:scd=none,trim=duration=${effectiveTargetDur.toFixed(3)},scale=${outW}:${outH}:flags=bicubic,unsharp=3:3:0.55:3:3:0.0,format=yuv420p` : `setpts=${ptsFactor}*(PTS-STARTPTS),trim=duration=${effectiveTargetDur.toFixed(3)},scale=${outW}:${outH}:force_original_aspect_ratio=decrease,pad=${outW}:${outH}:(ow-iw)/2:(oh-ih)/2:black,fps=30,format=yuv420p`;
    const vfBlendFallback = useOpticalFlow ? `setpts=${ptsFactor}*(PTS-STARTPTS),minterpolate=fps=60:mi_mode=blend,trim=duration=${effectiveTargetDur.toFixed(3)},scale=${outW}:${outH}:force_original_aspect_ratio=decrease,pad=${outW}:${outH}:(ow-iw)/2:(oh-ih)/2:black,format=yuv420p` : vfMci;
    const tmpOutPath = import_path.default.join(
      cacheDir,
      `.tmp_${Date.now()}_${Math.random().toString(36).slice(2, 6)}.mp4`
    );
    const runEncode = (vf, withAudio) => new Promise((resolve, reject) => {
      const args = [
        "-y",
        ...inputTrimArgs,
        "-i",
        sourceMp4,
        ...withAudio ? ["-af", afFilter] : ["-f", "lavfi", "-i", "anullsrc=channel_layout=stereo:sample_rate=44100", "-shortest"],
        "-t",
        effectiveTargetDur.toFixed(3),
        "-vf",
        vf,
        "-c:v",
        "h264_videotoolbox",
        "-b:v",
        "16M",
        "-pix_fmt",
        "yuv420p",
        "-movflags",
        "+faststart",
        "-c:a",
        "aac",
        "-ar",
        "44100",
        "-ac",
        "2",
        tmpOutPath
      ];
      const proc = (0, import_child_process.spawn)(ffmpegBin, args, { stdio: "ignore" });
      proc.on("error", reject);
      proc.on("close", (code) => {
        if (code === 0 && import_fs.default.existsSync(tmpOutPath) && import_fs.default.statSync(tmpOutPath).size > 1e4) {
          resolve();
        } else {
          reject(new Error(`ffmpeg exited with code ${code}`));
        }
      });
    });
    try {
      try {
        await runEncode(vfMci, true);
      } catch {
        try {
          await runEncode(vfMci, false);
        } catch {
          try {
            await runEncode(vfBlendFallback, true);
          } catch {
            await runEncode(vfBlendFallback, false);
          }
        }
      }
      import_fs.default.renameSync(tmpOutPath, outFullPath);
    } finally {
      try {
        if (import_fs.default.existsSync(tmpOutPath)) import_fs.default.unlinkSync(tmpOutPath);
      } catch {
      }
    }
    const st = import_fs.default.statSync(outFullPath);
    res.json({
      ok: true,
      cached: false,
      clipId,
      clipNumber,
      bakedKey,
      speed: safeSpeed,
      trimStart: safeTrimStart,
      trimEnd: safeTrimEnd,
      actualSourceDuration: Number(actualSourceDur.toFixed(3)),
      targetDuration: effectiveTargetDur,
      smoothSlowMo: useOpticalFlow,
      opticalFlowUrl: `/api/flow/serve-folder-file?filePath=${encodeURIComponent(outFullPath)}&v=${Math.floor(st.mtimeMs)}`
    });
  } catch (err) {
    console.error("Error en /api/video/optical-flow:", err);
    res.status(500).json({
      ok: false,
      error: err?.message || "Error procesando Smooth Slow Motion (Optical Flow)."
    });
  }
});
app.post("/api/flow/separate-clip-vocals", async (req, res) => {
  try {
    const {
      clipId,
      clipNumber,
      videoUrl,
      fileName,
      folderPath,
      folderName,
      docTitle,
      trimStart,
      trimEnd,
      speed
    } = req.body || {};
    let sourceMp4 = "";
    if (typeof videoUrl === "string" && videoUrl.includes("filePath=")) {
      try {
        const parsed = new URL(videoUrl, "http://localhost:4200");
        const fp = parsed.searchParams.get("filePath");
        if (fp && import_fs.default.existsSync(fp)) {
          sourceMp4 = fp;
        }
      } catch {
      }
    }
    const resolvedRoot = resolveLocalDocumentaryFolder(folderPath, folderName, docTitle);
    const clipsVideoSubdir = resolvedRoot ? import_path.default.join(resolvedRoot, "05_Clips_Video") : "";
    const clipsApprovedSubdir = resolvedRoot ? import_path.default.join(resolvedRoot, "Clips_Aprobados") : "";
    if (!sourceMp4 && resolvedRoot && import_fs.default.existsSync(resolvedRoot)) {
      const searchDirs = [clipsVideoSubdir, resolvedRoot, clipsApprovedSubdir].filter(
        (d) => d && import_fs.default.existsSync(d)
      );
      if (fileName) {
        for (const d of searchDirs) {
          const cand = import_path.default.join(d, import_path.default.basename(fileName));
          if (import_fs.default.existsSync(cand) && import_fs.default.statSync(cand).isFile()) {
            sourceMp4 = cand;
            break;
          }
        }
      }
      if (!sourceMp4 && Number(clipNumber) > 0) {
        const num = Number(clipNumber);
        const prefixRegex = new RegExp(`^(?:clip[_\\-\\s.]*)?0*${num}[_\\-\\s.]`, "i");
        for (const d of searchDirs) {
          const matches = import_fs.default.readdirSync(d).filter(
            (f) => !f.startsWith(".") && prefixRegex.test(f) && /\.(mp4|mov|webm)$/i.test(f)
          ).sort((a, b) => {
            const a4k = /[_\-]4k\.(mp4|mov|webm)$/i.test(a) ? 1 : 0;
            const b4k = /[_\-]4k\.(mp4|mov|webm)$/i.test(b) ? 1 : 0;
            if (b4k !== a4k) return b4k - a4k;
            try {
              return import_fs.default.statSync(import_path.default.join(d, b)).mtimeMs - import_fs.default.statSync(import_path.default.join(d, a)).mtimeMs;
            } catch {
              return 0;
            }
          });
          if (matches.length > 0) {
            sourceMp4 = import_path.default.join(d, matches[0]);
            break;
          }
        }
      }
    }
    if (!sourceMp4 || !import_fs.default.existsSync(sourceMp4)) {
      res.status(404).json({
        ok: false,
        error: `No se encontr\xF3 el archivo MP4 original para separar voces del Clip ${String(clipNumber || "").padStart(2, "0")}.`
      });
      return;
    }
    const safeSpeed = Math.max(0.2, Math.min(4, Number(speed) || 1));
    const safeTrimStart = Math.max(0, Number(trimStart) || 0);
    const safeTrimEnd = Number(trimEnd) > safeTrimStart + 0.05 ? Number(trimEnd) : 0;
    const cacheDir = import_path.default.join(import_path.default.dirname(sourceMp4), ".vocals_cache");
    if (!import_fs.default.existsSync(cacheDir)) {
      import_fs.default.mkdirSync(cacheDir, { recursive: true });
    }
    const baseKey = import_path.default.basename(sourceMp4, import_path.default.extname(sourceMp4)).replace(/[^a-zA-Z0-9_-]/g, "_").slice(0, 48);
    const bakedKey = `t${safeTrimStart.toFixed(2)}_${safeTrimEnd.toFixed(2)}_s${safeSpeed.toFixed(3)}`;
    const vocalsMp3Path = import_path.default.join(cacheDir, `${baseKey}_${bakedKey}_vocals.mp3`);
    const cleanMp4Path = import_path.default.join(cacheDir, `${baseKey}_${bakedKey}_novocals.mp4`);
    const ffmpegBin = getFfmpegPath();
    const inputTrimArgs = [];
    if (safeTrimStart > 0.01) {
      inputTrimArgs.push("-ss", safeTrimStart.toFixed(3));
    }
    if (safeTrimEnd > safeTrimStart + 0.05) {
      inputTrimArgs.push("-to", safeTrimEnd.toFixed(3));
    }
    const buildAtempoChain = (spd) => {
      if (Math.abs(spd - 1) < 0.02) return "";
      const stages = [];
      let rem = Math.max(0.2, Math.min(4, spd));
      while (rem < 0.5) {
        stages.push("atempo=0.5");
        rem /= 0.5;
      }
      while (rem > 2) {
        stages.push("atempo=2.0");
        rem /= 2;
      }
      stages.push(`atempo=${rem.toFixed(3)}`);
      return stages.join(",");
    };
    const atempoPart = buildAtempoChain(safeSpeed);
    if (!import_fs.default.existsSync(vocalsMp3Path) || import_fs.default.statSync(vocalsMp3Path).size < 1024) {
      const vocalFilter = [
        "highpass=f=200",
        "lowpass=f=3600",
        "afftdn=nf=-24",
        "acompressor=threshold=-20dB:ratio=3:makeup=4dB",
        atempoPart
      ].filter(Boolean).join(",");
      await new Promise((resolve) => {
        const args = [
          "-y",
          ...inputTrimArgs,
          "-i",
          sourceMp4,
          "-vn",
          "-af",
          vocalFilter,
          "-c:a",
          "libmp3lame",
          "-q:a",
          "2",
          vocalsMp3Path
        ];
        const proc = (0, import_child_process.spawn)(ffmpegBin, args, { stdio: "ignore" });
        proc.on("error", () => resolve());
        proc.on("close", () => resolve());
      });
      if (!import_fs.default.existsSync(vocalsMp3Path) || import_fs.default.statSync(vocalsMp3Path).size < 512) {
        await new Promise((resolve) => {
          const fallbackArgs = [
            "-y",
            "-f",
            "lavfi",
            "-i",
            "anullsrc=channel_layout=stereo:sample_rate=44100",
            "-t",
            "4",
            "-c:a",
            "libmp3lame",
            "-q:a",
            "4",
            vocalsMp3Path
          ];
          const proc = (0, import_child_process.spawn)(ffmpegBin, fallbackArgs, { stdio: "ignore" });
          proc.on("error", () => resolve());
          proc.on("close", () => resolve());
        });
      }
    }
    if (!import_fs.default.existsSync(cleanMp4Path) || import_fs.default.statSync(cleanMp4Path).size < 5e3) {
      const sum4V = "(hypot(real(b-10,ch),imag(b-10,ch))+hypot(real(b-6,ch),imag(b-6,ch))+hypot(real(b+6,ch),imag(b+6,ch))+hypot(real(b+10,ch),imag(b+10,ch)))";
      const magV = "max(0.000001,hypot(re,im))";
      const exprV = `if(between(b,20,290)*gt(${magV},0.58*${sum4V}),(0.27*${sum4V})/${magV},1)`;
      const suppressVocalFilter = `afftfilt=real='re*(${exprV})':imag='im*(${exprV})':win_size=4096:overlap=0.75`;
      await new Promise((resolve) => {
        const args = [
          "-y",
          "-i",
          sourceMp4,
          "-c:v",
          "copy",
          "-af",
          suppressVocalFilter,
          "-c:a",
          "aac",
          "-b:a",
          "160k",
          cleanMp4Path
        ];
        const proc = (0, import_child_process.spawn)(ffmpegBin, args, { stdio: "ignore" });
        proc.on("error", () => resolve());
        proc.on("close", () => resolve());
      });
    }
    const vocalsStat = import_fs.default.existsSync(vocalsMp3Path) ? import_fs.default.statSync(vocalsMp3Path) : null;
    const cleanStat = import_fs.default.existsSync(cleanMp4Path) && import_fs.default.statSync(cleanMp4Path).size > 5e3 ? import_fs.default.statSync(cleanMp4Path) : null;
    res.json({
      ok: true,
      clipId,
      clipNumber,
      vocalsAudioUrl: vocalsStat ? `/api/flow/serve-folder-file?filePath=${encodeURIComponent(vocalsMp3Path)}&v=${Math.floor(vocalsStat.mtimeMs)}` : "",
      cleanVideoUrl: cleanStat ? `/api/flow/serve-folder-file?filePath=${encodeURIComponent(cleanMp4Path)}&v=${Math.floor(cleanStat.mtimeMs)}` : ""
    });
  } catch (err) {
    console.error("Error en /api/flow/separate-clip-vocals:", err);
    res.status(500).json({
      ok: false,
      error: err?.message || "Error separando voces del clip."
    });
  }
});
app.post("/api/flow/separate-clip-music", async (req, res) => {
  try {
    const {
      clipId,
      clipNumber,
      videoUrl,
      fileName,
      folderPath,
      folderName,
      docTitle,
      trimStart,
      trimEnd,
      speed
    } = req.body || {};
    let sourceMp4 = "";
    if (typeof videoUrl === "string" && videoUrl.includes("filePath=")) {
      try {
        const parsed = new URL(videoUrl, "http://localhost:4200");
        const fp = parsed.searchParams.get("filePath");
        if (fp && import_fs.default.existsSync(fp)) {
          sourceMp4 = fp;
        }
      } catch {
      }
    }
    const resolvedRoot = resolveLocalDocumentaryFolder(folderPath, folderName, docTitle);
    const clipsVideoSubdir = resolvedRoot ? import_path.default.join(resolvedRoot, "05_Clips_Video") : "";
    const clipsApprovedSubdir = resolvedRoot ? import_path.default.join(resolvedRoot, "Clips_Aprobados") : "";
    if (!sourceMp4 && resolvedRoot && import_fs.default.existsSync(resolvedRoot)) {
      const searchDirs = [clipsVideoSubdir, resolvedRoot, clipsApprovedSubdir].filter(
        (d) => d && import_fs.default.existsSync(d)
      );
      if (fileName) {
        for (const d of searchDirs) {
          const cand = import_path.default.join(d, import_path.default.basename(fileName));
          if (import_fs.default.existsSync(cand) && import_fs.default.statSync(cand).isFile()) {
            sourceMp4 = cand;
            break;
          }
        }
      }
      if (!sourceMp4 && Number(clipNumber) > 0) {
        const num = Number(clipNumber);
        const prefixRegex = new RegExp(`^(?:clip[_\\-\\s.]*)?0*${num}[_\\-\\s.]`, "i");
        for (const d of searchDirs) {
          const matches = import_fs.default.readdirSync(d).filter(
            (f) => !f.startsWith(".") && prefixRegex.test(f) && /\.(mp4|mov|webm)$/i.test(f)
          ).sort((a, b) => {
            const a4k = /[_\-]4k\.(mp4|mov|webm)$/i.test(a) ? 1 : 0;
            const b4k = /[_\-]4k\.(mp4|mov|webm)$/i.test(b) ? 1 : 0;
            if (b4k !== a4k) return b4k - a4k;
            try {
              return import_fs.default.statSync(import_path.default.join(d, b)).mtimeMs - import_fs.default.statSync(import_path.default.join(d, a)).mtimeMs;
            } catch {
              return 0;
            }
          });
          if (matches.length > 0) {
            sourceMp4 = import_path.default.join(d, matches[0]);
            break;
          }
        }
      }
    }
    if (!sourceMp4 || !import_fs.default.existsSync(sourceMp4)) {
      res.status(404).json({
        ok: false,
        error: `No se encontr\xF3 el archivo MP4 original para extraer m\xFAsica del Clip ${String(clipNumber || "").padStart(2, "0")}.`
      });
      return;
    }
    const safeSpeed = Math.max(0.2, Math.min(4, Number(speed) || 1));
    const safeTrimStart = Math.max(0, Number(trimStart) || 0);
    const safeTrimEnd = Number(trimEnd) > safeTrimStart + 0.05 ? Number(trimEnd) : 0;
    const cacheDir = import_path.default.join(import_path.default.dirname(sourceMp4), ".music_cache");
    if (!import_fs.default.existsSync(cacheDir)) {
      import_fs.default.mkdirSync(cacheDir, { recursive: true });
    }
    const baseKey = import_path.default.basename(sourceMp4, import_path.default.extname(sourceMp4)).replace(/[^a-zA-Z0-9_-]/g, "_").slice(0, 48);
    const bakedKey = `t${safeTrimStart.toFixed(2)}_${safeTrimEnd.toFixed(2)}_s${safeSpeed.toFixed(3)}`;
    const musicMp3Path = import_path.default.join(cacheDir, `${baseKey}_${bakedKey}_music.mp3`);
    const cleanMp4Path = import_path.default.join(cacheDir, `${baseKey}_${bakedKey}_nomusic.mp4`);
    const ffmpegBin = getFfmpegPath();
    const inputTrimArgs = [];
    if (safeTrimStart > 0.01) {
      inputTrimArgs.push("-ss", safeTrimStart.toFixed(3));
    }
    if (safeTrimEnd > safeTrimStart + 0.05) {
      inputTrimArgs.push("-to", safeTrimEnd.toFixed(3));
    }
    const buildAtempoChain = (spd) => {
      if (Math.abs(spd - 1) < 0.02) return "";
      const stages = [];
      let rem = Math.max(0.2, Math.min(4, spd));
      while (rem < 0.5) {
        stages.push("atempo=0.5");
        rem /= 0.5;
      }
      while (rem > 2) {
        stages.push("atempo=2.0");
        rem /= 2;
      }
      stages.push(`atempo=${rem.toFixed(3)}`);
      return stages.join(",");
    };
    const atempoPart = buildAtempoChain(safeSpeed);
    if (!import_fs.default.existsSync(musicMp3Path) || import_fs.default.statSync(musicMp3Path).size < 1024) {
      const musicFilter = [
        "highpass=f=70",
        "lowpass=f=9500",
        "afftdn=nf=-28",
        "acompressor=threshold=-22dB:ratio=2.5:makeup=3dB",
        atempoPart
      ].filter(Boolean).join(",");
      await new Promise((resolve) => {
        const args = [
          "-y",
          ...inputTrimArgs,
          "-i",
          sourceMp4,
          "-vn",
          "-af",
          musicFilter,
          "-c:a",
          "libmp3lame",
          "-q:a",
          "2",
          musicMp3Path
        ];
        const proc = (0, import_child_process.spawn)(ffmpegBin, args, { stdio: "ignore" });
        proc.on("error", () => resolve());
        proc.on("close", () => resolve());
      });
      if (!import_fs.default.existsSync(musicMp3Path) || import_fs.default.statSync(musicMp3Path).size < 512) {
        await new Promise((resolve) => {
          const fallbackArgs = [
            "-y",
            "-f",
            "lavfi",
            "-i",
            "anullsrc=channel_layout=stereo:sample_rate=44100",
            "-t",
            "4",
            "-c:a",
            "libmp3lame",
            "-q:a",
            "4",
            musicMp3Path
          ];
          const proc = (0, import_child_process.spawn)(ffmpegBin, fallbackArgs, { stdio: "ignore" });
          proc.on("error", () => resolve());
          proc.on("close", () => resolve());
        });
      }
    }
    if (!import_fs.default.existsSync(cleanMp4Path) || import_fs.default.statSync(cleanMp4Path).size < 5e3) {
      const sum4M = "(hypot(real(b-10,ch),imag(b-10,ch))+hypot(real(b-6,ch),imag(b-6,ch))+hypot(real(b+6,ch),imag(b+6,ch))+hypot(real(b+10,ch),imag(b+10,ch)))";
      const magM = "max(0.000001,hypot(re,im))";
      const exprM = `if(between(b,12,320)*gt(${magM},0.58*${sum4M}),(0.27*${sum4M})/${magM},1)`;
      const suppressMusicFilter = `afftfilt=real='re*(${exprM})':imag='im*(${exprM})':win_size=4096:overlap=0.75`;
      await new Promise((resolve) => {
        const args = [
          "-y",
          "-i",
          sourceMp4,
          "-c:v",
          "copy",
          "-af",
          suppressMusicFilter,
          "-c:a",
          "aac",
          "-b:a",
          "160k",
          cleanMp4Path
        ];
        const proc = (0, import_child_process.spawn)(ffmpegBin, args, { stdio: "ignore" });
        proc.on("error", () => resolve());
        proc.on("close", () => resolve());
      });
    }
    const musicStat = import_fs.default.existsSync(musicMp3Path) ? import_fs.default.statSync(musicMp3Path) : null;
    const cleanStat = import_fs.default.existsSync(cleanMp4Path) && import_fs.default.statSync(cleanMp4Path).size > 5e3 ? import_fs.default.statSync(cleanMp4Path) : null;
    res.json({
      ok: true,
      clipId,
      clipNumber,
      musicAudioUrl: musicStat ? `/api/flow/serve-folder-file?filePath=${encodeURIComponent(musicMp3Path)}&v=${Math.floor(musicStat.mtimeMs)}` : "",
      cleanVideoUrl: cleanStat ? `/api/flow/serve-folder-file?filePath=${encodeURIComponent(cleanMp4Path)}&v=${Math.floor(cleanStat.mtimeMs)}` : ""
    });
  } catch (err) {
    console.error("Error en /api/flow/separate-clip-music:", err);
    res.status(500).json({
      ok: false,
      error: err?.message || "Error extrayendo m\xFAsica del clip."
    });
  }
});
async function detectVoiceOrMusicInClipAudio(inputMp4Path, ffmpegBin) {
  const bname = import_path.default.basename(inputMp4Path).toLowerCase();
  if (bname.includes("sin_voz")) {
    return { hasVoiceOrMusic: false, isSpeech: false, isMusic: false, enableClause: "" };
  }
  return new Promise((resolve) => {
    const chunks = [];
    const proc = (0, import_child_process.spawn)(
      ffmpegBin,
      [
        "-hide_banner",
        "-loglevel",
        "error",
        "-i",
        inputMp4Path,
        "-vn",
        "-af",
        "highpass=f=280,lowpass=f=3400",
        "-ac",
        "1",
        "-ar",
        "16000",
        "-f",
        "s16le",
        "-"
      ],
      { stdio: ["ignore", "pipe", "ignore"] }
    );
    proc.stdout.on("data", (d) => chunks.push(d));
    proc.on(
      "error",
      () => resolve({ hasVoiceOrMusic: false, isSpeech: false, isMusic: false, enableClause: "" })
    );
    proc.on("close", () => {
      try {
        const raw = Buffer.concat(chunks);
        const totalSamples = Math.floor(raw.length / 2);
        if (totalSamples < 8e3) {
          resolve({ hasVoiceOrMusic: false, isSpeech: false, isMusic: false, enableClause: "" });
          return;
        }
        const win = 1600;
        const nWins = Math.floor(totalSamples / win);
        let voicedWins = 0;
        let transitions = 0;
        let prevVoiced = false;
        const pitchClasses = /* @__PURE__ */ new Set();
        const voicedFlags = [];
        for (let w = 0; w < nWins; w++) {
          const byteOffset = w * win * 2;
          let sumSq = 0;
          let zc = 0;
          let prevSample = raw.readInt16LE(byteOffset);
          for (let i = 0; i < win; i++) {
            const s = raw.readInt16LE(byteOffset + i * 2);
            sumSq += s * s;
            if (i > 0 && s >= 0 !== prevSample >= 0) zc++;
            prevSample = s;
          }
          const meanSq = sumSq / win;
          const rms = Math.sqrt(meanSq) / 32768;
          const zcr = zc / win;
          let isVoiced = false;
          if (rms > 0.01 && zcr < 0.24 && sumSq > 0) {
            let bestR = 0;
            let bestLag = 0;
            for (let lag = 36; lag < 165; lag += 3) {
              let num = 0;
              const limit = win - lag;
              for (let k = 0; k < limit; k++) {
                const s1 = raw.readInt16LE(byteOffset + k * 2);
                const s2 = raw.readInt16LE(byteOffset + (k + lag) * 2);
                num += s1 * s2;
              }
              const r = num / (meanSq * limit + 1e-9);
              if (r > bestR) {
                bestR = r;
                bestLag = lag;
              }
            }
            if (bestR > 0.72 && bestLag > 0) {
              isVoiced = true;
              voicedWins++;
              pitchClasses.add(Math.round(Math.log(bestLag) * 8));
            }
          }
          voicedFlags.push(isVoiced);
          if (isVoiced !== prevVoiced) {
            transitions++;
            prevVoiced = isVoiced;
          }
        }
        const voicedFrac = voicedWins / Math.max(1, nWins);
        const distinctPitches = pitchClasses.size;
        const isSpeech = transitions >= 12 && voicedFrac >= 0.28 && distinctPitches >= 4;
        const isMusic = voicedFrac >= 0.65 && distinctPitches >= 4;
        const hasVoiceOrMusic = isSpeech || isMusic;
        if (!hasVoiceOrMusic) {
          resolve({ hasVoiceOrMusic: false, isSpeech: false, isMusic: false, enableClause: "" });
          return;
        }
        if (isMusic || voicedFrac >= 0.48) {
          resolve({ hasVoiceOrMusic: true, isSpeech, isMusic, enableClause: "" });
          return;
        }
        const intervals = [];
        for (let w = 0; w < nWins; w++) {
          if (!voicedFlags[w]) continue;
          const t0 = Math.max(0, w * 0.1 - 0.3);
          const t1 = (w + 1) * 0.1 + 0.35;
          if (intervals.length > 0 && t0 <= intervals[intervals.length - 1][1] + 0.45) {
            intervals[intervals.length - 1][1] = Math.max(intervals[intervals.length - 1][1], t1);
          } else {
            intervals.push([t0, t1]);
          }
        }
        const enableExpr = intervals.slice(0, 12).map(([a, b]) => `between(t,${a.toFixed(2)},${b.toFixed(2)})`).join("+");
        const enableClause = enableExpr ? `:enable='${enableExpr}'` : "";
        resolve({ hasVoiceOrMusic: true, isSpeech, isMusic, enableClause });
      } catch {
        resolve({ hasVoiceOrMusic: false, isSpeech: false, isMusic: false, enableClause: "" });
      }
    });
  });
}
app.post("/api/flow/isolate-clip-foley", async (req, res) => {
  try {
    const {
      clipId,
      clipNumber,
      videoUrl,
      opticalFlowUrl,
      fileName,
      folderPath,
      folderName,
      docTitle
    } = req.body || {};
    let sourceMp4 = "";
    if (typeof videoUrl === "string" && videoUrl.includes("filePath=")) {
      try {
        const parsed = new URL(videoUrl, "http://localhost:4200");
        const fp = parsed.searchParams.get("filePath");
        if (fp && import_fs.default.existsSync(fp)) {
          sourceMp4 = fp;
        }
      } catch {
      }
    }
    const resolvedRoot = resolveLocalDocumentaryFolder(folderPath, folderName, docTitle);
    const clipsVideoSubdir = resolvedRoot ? import_path.default.join(resolvedRoot, "05_Clips_Video") : "";
    const clipsApprovedSubdir = resolvedRoot ? import_path.default.join(resolvedRoot, "Clips_Aprobados") : "";
    if ((!sourceMp4 || sourceMp4.includes(".vocals_cache") || sourceMp4.includes(".music_cache") || sourceMp4.includes(".foley_only_cache") || /_foley_(?:only|v2)\.mp4$/i.test(sourceMp4)) && resolvedRoot && import_fs.default.existsSync(resolvedRoot)) {
      const searchDirs = [clipsVideoSubdir, resolvedRoot, clipsApprovedSubdir].filter(
        (d) => d && import_fs.default.existsSync(d)
      );
      if (fileName) {
        const cleanFileName = import_path.default.basename(fileName).replace(/_foley_(?:only|v2)(?=\.[^.]+$)/i, "");
        for (const d of searchDirs) {
          const cand = import_path.default.join(d, cleanFileName);
          if (import_fs.default.existsSync(cand) && import_fs.default.statSync(cand).isFile()) {
            sourceMp4 = cand;
            break;
          }
        }
      }
      if ((!sourceMp4 || sourceMp4.includes(".vocals_cache") || sourceMp4.includes(".music_cache") || sourceMp4.includes(".foley_only_cache") || /_foley_(?:only|v2)\.mp4$/i.test(sourceMp4)) && Number(clipNumber) > 0) {
        const num = Number(clipNumber);
        const prefixRegex = new RegExp(`^(?:clip[_\\-\\s.]*)?0*${num}[_\\-\\s.]`, "i");
        for (const d of searchDirs) {
          const matches = import_fs.default.readdirSync(d).filter(
            (f) => !f.startsWith(".") && prefixRegex.test(f) && !/foley_(?:only|v2)/i.test(f) && /\.(mp4|mov|webm)$/i.test(f)
          ).sort((a, b) => {
            const a4k = /[_\-]4k\.(mp4|mov|webm)$/i.test(a) ? 1 : 0;
            const b4k = /[_\-]4k\.(mp4|mov|webm)$/i.test(b) ? 1 : 0;
            if (b4k !== a4k) return b4k - a4k;
            try {
              return import_fs.default.statSync(import_path.default.join(d, b)).mtimeMs - import_fs.default.statSync(import_path.default.join(d, a)).mtimeMs;
            } catch {
              return 0;
            }
          });
          if (matches.length > 0) {
            sourceMp4 = import_path.default.join(d, matches[0]);
            break;
          }
        }
      }
    }
    if (!sourceMp4 || !import_fs.default.existsSync(sourceMp4)) {
      res.status(404).json({
        ok: false,
        error: `No se encontr\xF3 el archivo MP4 original para aislar el Foley del Clip ${String(clipNumber || "").padStart(2, "0")}.`
      });
      return;
    }
    const cacheDir = import_path.default.join(import_path.default.dirname(sourceMp4), ".foley_only_cache");
    if (!import_fs.default.existsSync(cacheDir)) {
      import_fs.default.mkdirSync(cacheDir, { recursive: true });
    }
    const baseKey = import_path.default.basename(sourceMp4, import_path.default.extname(sourceMp4)).replace(/_foley_(?:only|v2)$/i, "").replace(/[^a-zA-Z0-9_-]/g, "_").slice(0, 56);
    const legacyFoleyMp4Path = import_path.default.join(cacheDir, `${baseKey}_foley_only.mp4`);
    if (import_fs.default.existsSync(legacyFoleyMp4Path)) {
      try {
        import_fs.default.unlinkSync(legacyFoleyMp4Path);
      } catch {
      }
    }
    const ffmpegBin = getFfmpegPath();
    const detection = await detectVoiceOrMusicInClipAudio(sourceMp4, ffmpegBin);
    const srcStat = import_fs.default.statSync(sourceMp4);
    let rawOptPath = "";
    if (typeof opticalFlowUrl === "string" && opticalFlowUrl.includes("filePath=")) {
      try {
        const parsedOpt = new URL(opticalFlowUrl, "http://localhost:4200");
        const fp = parsedOpt.searchParams.get("filePath");
        if (fp) {
          const baseOpt = fp.replace(/_foley_(?:only|v2)\.mp4$/i, ".mp4");
          if (import_fs.default.existsSync(baseOpt)) rawOptPath = baseOpt;
          else if (import_fs.default.existsSync(fp)) rawOptPath = fp;
        }
      } catch {
      }
    }
    if (!detection.hasVoiceOrMusic) {
      let cleanOpticalFlowUrl2 = "";
      if (rawOptPath && import_fs.default.existsSync(rawOptPath)) {
        const optSt = import_fs.default.statSync(rawOptPath);
        cleanOpticalFlowUrl2 = `/api/flow/serve-folder-file?filePath=${encodeURIComponent(rawOptPath)}&v=${Math.floor(optSt.mtimeMs)}`;
      }
      res.json({
        ok: true,
        clipId,
        clipNumber,
        alreadyPureFoley: true,
        cleanFoleyVideoUrl: `/api/flow/serve-folder-file?filePath=${encodeURIComponent(sourceMp4)}&v=${Math.floor(srcStat.mtimeMs)}`,
        cleanOpticalFlowUrl: cleanOpticalFlowUrl2
      });
      return;
    }
    const foleyMp4Path = import_path.default.join(cacheDir, `${baseKey}_foley_v3.mp4`);
    const isolateFoleyFilter = `equalizer=f=950:t=q:w=1.8:g=-6${detection.enableClause},equalizer=f=2400:t=q:w=1.8:g=-6${detection.enableClause}`;
    const needsRebuild = !import_fs.default.existsSync(foleyMp4Path) || import_fs.default.statSync(foleyMp4Path).size < 5e3 || import_fs.default.statSync(foleyMp4Path).mtimeMs < srcStat.mtimeMs;
    if (needsRebuild) {
      await new Promise((resolve) => {
        const args = [
          "-y",
          "-i",
          sourceMp4,
          "-c:v",
          "copy",
          "-af",
          isolateFoleyFilter,
          "-c:a",
          "aac",
          "-b:a",
          "160k",
          foleyMp4Path
        ];
        const proc = (0, import_child_process.spawn)(ffmpegBin, args, { stdio: "ignore" });
        proc.on("error", () => resolve());
        proc.on("close", () => resolve());
      });
    }
    let cleanOpticalFlowUrl = "";
    if (rawOptPath && import_fs.default.existsSync(rawOptPath)) {
      try {
        const optBase = import_path.default.basename(rawOptPath, import_path.default.extname(rawOptPath)).replace(/_foley_(?:only|v2|v3)$/i, "");
        const foleyOptPath = import_path.default.join(import_path.default.dirname(rawOptPath), `${optBase}_foley_v3.mp4`);
        const optFilter = "equalizer=f=950:t=q:w=1.8:g=-6,equalizer=f=2400:t=q:w=1.8:g=-6";
        if (!import_fs.default.existsSync(foleyOptPath) || import_fs.default.statSync(foleyOptPath).size < 5e3) {
          await new Promise((resolve) => {
            const proc = (0, import_child_process.spawn)(
              ffmpegBin,
              [
                "-y",
                "-i",
                rawOptPath,
                "-c:v",
                "copy",
                "-af",
                optFilter,
                "-c:a",
                "aac",
                "-b:a",
                "160k",
                foleyOptPath
              ],
              { stdio: "ignore" }
            );
            proc.on("error", () => resolve());
            proc.on("close", () => resolve());
          });
        }
        if (import_fs.default.existsSync(foleyOptPath) && import_fs.default.statSync(foleyOptPath).size > 5e3) {
          const optSt = import_fs.default.statSync(foleyOptPath);
          cleanOpticalFlowUrl = `/api/flow/serve-folder-file?filePath=${encodeURIComponent(foleyOptPath)}&v=${Math.floor(optSt.mtimeMs)}`;
        }
      } catch {
      }
    }
    const cleanStat = import_fs.default.existsSync(foleyMp4Path) && import_fs.default.statSync(foleyMp4Path).size > 5e3 ? import_fs.default.statSync(foleyMp4Path) : null;
    res.json({
      ok: true,
      clipId,
      clipNumber,
      alreadyPureFoley: false,
      cleanFoleyVideoUrl: cleanStat ? `/api/flow/serve-folder-file?filePath=${encodeURIComponent(foleyMp4Path)}&v=${Math.floor(cleanStat.mtimeMs)}` : `/api/flow/serve-folder-file?filePath=${encodeURIComponent(sourceMp4)}&v=${Math.floor(srcStat.mtimeMs)}`,
      cleanOpticalFlowUrl
    });
  } catch (err) {
    console.error("Error en /api/flow/isolate-clip-foley:", err);
    res.status(500).json({
      ok: false,
      error: err?.message || "Error aislando el audio Foley del clip."
    });
  }
});
app.post("/api/flow/repair-choppy-zoom", async (req, res) => {
  try {
    const { clipId, clipNumber, videoUrl, fileName, folderPath, folderName, docTitle } = req.body || {};
    let sourceMp4 = "";
    const rawUrl = String(videoUrl || "");
    if (rawUrl.includes("filePath=")) {
      try {
        const parsed = new URL(rawUrl, "http://localhost:4200");
        const fp = parsed.searchParams.get("filePath");
        if (fp && import_fs.default.existsSync(fp)) sourceMp4 = fp;
      } catch {
      }
    }
    if (!sourceMp4) {
      const targetRoot = resolveLocalDocumentaryFolder(folderPath, folderName, docTitle);
      if (targetRoot && import_fs.default.existsSync(targetRoot)) {
        const clipsDir = import_path.default.join(targetRoot, "05_Clips_Video");
        const searchDirs = import_fs.default.existsSync(clipsDir) ? [clipsDir, targetRoot] : [targetRoot];
        const padded = String(Number(clipNumber) || 0).padStart(2, "0");
        for (const d of searchDirs) {
          if (fileName && import_fs.default.existsSync(import_path.default.join(d, fileName))) {
            sourceMp4 = import_path.default.join(d, fileName);
            break;
          }
          const files = import_fs.default.readdirSync(d).filter((f) => f.toLowerCase().endsWith(".mp4"));
          const match = files.find(
            (f) => f.startsWith(`${padded}_`) || new RegExp(`^Clip[ _-]0*${Number(clipNumber)}\\b`, "i").test(f)
          );
          if (match) {
            sourceMp4 = import_path.default.join(d, match);
            break;
          }
        }
      }
    }
    if (!sourceMp4 || !import_fs.default.existsSync(sourceMp4)) {
      return res.status(404).json({
        ok: false,
        error: "No se encontr\xF3 el archivo .MP4 local del clip para suavizar su zoom."
      });
    }
    const ffmpegBin = getFfmpegPath();
    if (!ffmpegBin) {
      return res.status(500).json({
        ok: false,
        error: "No se encontr\xF3 FFmpeg en el servidor."
      });
    }
    const tmpOut = import_path.default.join("/tmp", `smooth_zoom_${process.pid}_${Date.now()}_${import_path.default.basename(sourceMp4)}`);
    const vf = "trim=end_frame=1,fps=60,format=rgb24,tpad=stop_mode=clone:stop_duration=10,trim=duration=10,perspective=x0='W*0.06*(in/600)':y0='H*0.06*(in/600)':x1='W*(1-0.06*(in/600))':y1='H*0.06*(in/600)':x2='W*0.06*(in/600)':y2='H*(1-0.06*(in/600))':x3='W*(1-0.06*(in/600))':y3='H*(1-0.06*(in/600))':interpolation=linear:sense=source:eval=frame,format=yuv420p";
    await new Promise((resolve, reject) => {
      const proc = (0, import_child_process.spawn)(
        ffmpegBin,
        [
          "-y",
          "-i",
          sourceMp4,
          "-vf",
          vf,
          "-an",
          "-c:v",
          "h264_videotoolbox",
          "-b:v",
          "8M",
          "-movflags",
          "+faststart",
          tmpOut
        ],
        { stdio: "ignore" }
      );
      proc.on("error", reject);
      proc.on("close", (code) => {
        if (code === 0 && import_fs.default.existsSync(tmpOut) && import_fs.default.statSync(tmpOut).size > 5e4) {
          resolve();
        } else {
          reject(new Error(`FFmpeg exited with code ${code}`));
        }
      });
    });
    import_fs.default.copyFileSync(tmpOut, sourceMp4);
    try {
      import_fs.default.unlinkSync(tmpOut);
    } catch {
    }
    const st = import_fs.default.statSync(sourceMp4);
    res.json({
      ok: true,
      clipId,
      clipNumber,
      repairedVideoUrl: `/api/flow/serve-folder-file?filePath=${encodeURIComponent(sourceMp4)}&v=${Math.floor(st.mtimeMs)}`
    });
  } catch (err) {
    console.error("Error en /api/flow/repair-choppy-zoom:", err);
    res.status(500).json({
      ok: false,
      error: err?.message || "Error suavizando el slow zoom-in del clip."
    });
  }
});
async function bootstrap() {
  if (process.env.NODE_ENV !== "production") {
    const vite = await (0, import_vite.createServer)({
      server: {
        middlewareMode: true,
        watch: {
          ignored: ["**/data/**", "**/dist/**", "**/docs/**", "**/chrome-extension/**", "**/*.log"]
        }
      },
      appType: "spa"
    });
    app.use(vite.middlewares);
  } else {
    const distPath = import_path.default.join(process.cwd(), "dist");
    app.use(import_express.default.static(distPath));
    app.get("*", (req, res) => {
      res.sendFile(import_path.default.join(distPath, "index.html"));
    });
  }
  app.listen(PORT, "0.0.0.0", () => {
    console.log(`Huellas Master running at http://localhost:${PORT}`);
  });
}
bootstrap();
//# sourceMappingURL=server.cjs.map
