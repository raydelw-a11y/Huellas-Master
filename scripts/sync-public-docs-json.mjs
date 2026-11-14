#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';

const ROOT = process.cwd();
const DATA_DOCS_PATH = path.join(ROOT, 'data', 'documentaries.json');
const PUBLIC_DOCS_PATH = path.join(ROOT, 'docs', 'data', 'documentaries.json');

let atomicCounter = 0;
function writeFileAtomicUtf8(targetPath, content) {
  const dir = path.dirname(targetPath);
  fs.mkdirSync(dir, { recursive: true });
  const tmpPath = path.join(
    dir,
    `${path.basename(targetPath)}.tmp.${process.pid}.${Date.now()}.${++atomicCounter}`
  );
  fs.writeFileSync(tmpPath, content, 'utf8');
  fs.renameSync(tmpPath, targetPath);
}

function normalizeProductionType(raw, promptConfig) {
  const v = typeof raw === 'string' ? raw.trim().toUpperCase() : '';
  if (v === 'REEL_9X16' || v === 'REELS_9X16' || v === 'SHORT_9X16') return 'REEL_9X16';
  if (
    v === 'DOCUMENTAL_16X9' ||
    v === 'INMERSIVO' ||
    v === 'TIMELAPSE' ||
    v === 'NOTEBOOKLM' ||
    v === 'POST_3X4'
  ) {
    return v;
  }
  if (promptConfig && promptConfig.SUB_OPCION_REELS === '9X16') return 'REEL_9X16';
  return 'DOCUMENTAL_16X9';
}

function normalizeFolderServedMediaUrl(rawUrl) {
  if (typeof rawUrl !== 'string') return rawUrl;
  const trimmed = rawUrl.trim();
  if (!trimmed) return rawUrl;
  return trimmed.replace(
    /^https?:\/\/(?:(?:localhost|127\.0\.0\.1)(?::\d+)?|[a-z0-9-]+\.trycloudflare\.com)(\/api\/flow\/serve-folder-file(?:[/?#].*)?)$/i,
    '$1'
  );
}

function normalizeNanoBananaCasing(text) {
  if (typeof text !== 'string') return text;
  return text.replace(/\buse nano banana 2\.1\b/g, 'use Nano Banana 2.1');
}

function sanitizeDoc(doc, { stripHeavyMedia }) {
  if (!doc || typeof doc !== 'object') return doc;
  const next = { ...doc };
  next.productionType = normalizeProductionType(doc.productionType, doc.promptConfig);
  if (typeof doc.operationalHeader === 'string') {
    next.operationalHeader = normalizeNanoBananaCasing(doc.operationalHeader);
  }
  if (typeof doc.rawClipsText === 'string') {
    next.rawClipsText = normalizeNanoBananaCasing(doc.rawClipsText);
  }
  if (Array.isArray(doc.references)) {
    next.references = doc.references.map((r) => {
      if (!r || typeof r !== 'object') return r;
      let url = normalizeFolderServedMediaUrl(r.imageUrl);
      if (stripHeavyMedia && typeof url === 'string' && url.startsWith('data:') && url.length > 60000) {
        url = '';
      }
      return url !== r.imageUrl ? { ...r, imageUrl: url } : r;
    });
  }
  if (Array.isArray(doc.clips)) {
    next.clips = doc.clips.map((c) => {
      if (!c || typeof c !== 'object') return c;
      let previewUrl = normalizeFolderServedMediaUrl(c.imagePreviewUrl);
      if (
        stripHeavyMedia &&
        typeof previewUrl === 'string' &&
        previewUrl.startsWith('data:') &&
        previewUrl.length > 60000
      ) {
        previewUrl = '';
      }
      if (stripHeavyMedia && 'videoFrames' in c) {
        const { videoFrames: _dropped, ...rest } = c;
        return previewUrl !== c.imagePreviewUrl ? { ...rest, imagePreviewUrl: previewUrl } : rest;
      }
      return previewUrl !== c.imagePreviewUrl ? { ...c, imagePreviewUrl: previewUrl } : c;
    });
  }
  return next;
}

if (!fs.existsSync(DATA_DOCS_PATH)) {
  console.error(`[sync-public-docs] ERROR: Missing ${DATA_DOCS_PATH}`);
  process.exit(1);
}

const rawDataText = fs.readFileSync(DATA_DOCS_PATH, 'utf8');
let docs;
try {
  docs = JSON.parse(rawDataText);
} catch (err) {
  console.error(`[sync-public-docs] ERROR: Invalid JSON in ${DATA_DOCS_PATH}: ${err.message}`);
  process.exit(1);
}

if (!Array.isArray(docs) || docs.length === 0) {
  console.error(`[sync-public-docs] ERROR: ${DATA_DOCS_PATH} must be a non-empty array.`);
  process.exit(1);
}

const cleanedDataDocs = docs.map((d) => sanitizeDoc(d, { stripHeavyMedia: false }));
const cleanedDataJson = JSON.stringify(cleanedDataDocs, null, 2);
if (rawDataText.trim() !== cleanedDataJson.trim()) {
  writeFileAtomicUtf8(DATA_DOCS_PATH, cleanedDataJson + '\n');
  console.log(`[sync-public-docs] Normalized URLs/productionType/casing in data/documentaries.json`);
}

const publicDocs = cleanedDataDocs.map((d) => sanitizeDoc(d, { stripHeavyMedia: true }));
const publicJson = JSON.stringify(publicDocs, null, 2) + '\n';
const existingPublic = fs.existsSync(PUBLIC_DOCS_PATH) ? fs.readFileSync(PUBLIC_DOCS_PATH, 'utf8') : '';
if (existingPublic !== publicJson) {
  writeFileAtomicUtf8(PUBLIC_DOCS_PATH, publicJson);
  console.log(
    `[sync-public-docs] Updated docs/data/documentaries.json (${publicDocs.length} projects, stripped heavy media).`
  );
} else {
  console.log(`[sync-public-docs] docs/data/documentaries.json already in sync (${publicDocs.length} projects).`);
}
