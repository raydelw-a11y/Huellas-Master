import {
  DocumentaryProject,
  DEFAULT_OPERATIONAL_HEADER,
  sanitizeOperationalHeader,
  normalizeProductionType,
  isVerticalProductionDoc,
  TTSRecord,
  TTSSegmentTiming,
} from '../types';

export function normalizeFolderServedMediaUrl(rawUrl: string): string {
  if (typeof rawUrl !== 'string') return '';
  const trimmed = rawUrl.trim();
  if (!trimmed) return '';
  return trimmed.replace(
    /^https?:\/\/(?:(?:localhost|127\.0\.0\.1)(?::\d+)?|[a-z0-9-]+\.trycloudflare\.com)(\/api\/flow\/serve-folder-file(?:[/?#].*)?)$/i,
    '$1'
  );
}
import {
  ensureOperationalHeaderInRawClips,
  getStage1ClipDurations,
  parseClipsFromRawText,
  parseTimelineTextToSentences,
  stripPauseTags,
  cleanVoiceoverNarrationOnly,
  computeCalibratedVoiceoverBudget,
  autoFitVoiceoverScriptToDuration,
  normalizeClip1Line1Format,
  resolveClipFlowVideoEngine,
  applyClipFlowVideoEngineTag,
  BROLL_MOTION_TAG_BY_KEY,
  BROLL_MOTION_ENGLISH_PHRASE,
  pickPeriodicStaticBrollTimelineTargets,
  BRAND_SAFETY_LEXICAL_RULE_ES,
  sanitizeBrandSafeEditorialText,
  normalizeFirstDayOfMonthInVoiceover,
  isAutoSkeletonPromptText,
  getRawClipsQualityTier,
  isClipRealAuthored,
  countRealAuthoredClips,
  countAuthoredBlocksInRawText,
  safeRebuildRawClipsText,
} from './smartParsers';
import {
  extractCleanPcmFromGeminiAudio,
  polishCleanTtsPcmBlock,
  hasEmbeddedC2paInAudioBytes,
  cleanMasterWavEmbeddedC2paInPlace,
  trimDuplicatedTakeInPcm,
} from './geminiTtsAudioClean';

export const GITHUB_OWNER = 'raydelw-a11y';
export const GITHUB_REPO = 'Huellas-Master';
export const GITHUB_BRANCH = 'main';
export const PUBLIC_GITHUB_PAGES_URL = `https://${GITHUB_OWNER}.github.io/${GITHUB_REPO}/`;

const LOCAL_DOCS_CACHE_KEY = 'huellas_master_docs_cache_v1';
const LOCAL_DELETED_IDS_KEY = 'huellas_master_deleted_ids_v1';
const LOCAL_CLIP_REVIEW_STATE_KEY = 'huellas_master_clip_review_state_v1';

interface StoredClipStatusEntry {
  reviewedForEditor: boolean;
  reviewedUpdatedAt?: number;
  recreated?: boolean;
  videoReady?: boolean;
  imageReady?: boolean;
  videoSavedFileName?: string;
  videoAuditStatus?: string;
  discardedVideoFileName?: string;
  videoDiscardedAt?: number;
  videoSavedAt?: number;
  updatedAt: number;
}

type StoredClipStatusMap = Record<string, Record<number, StoredClipStatusEntry>>;

export function loadStoredClipReviewStateMap(): StoredClipStatusMap {
  try {
    const raw = localStorage.getItem(LOCAL_CLIP_REVIEW_STATE_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch {
    return {};
  }
}

export function saveClipReviewStateForDoc(
  docId: string,
  clips: DocumentaryProject['clips'],
  explicitTimestampMs?: number
) {
  if (!docId || !Array.isArray(clips) || clips.length === 0) return;
  try {
    const map = loadStoredClipReviewStateMap();
    const docMap: Record<number, StoredClipStatusEntry> = { ...(map[docId] || {}) };
    const now = explicitTimestampMs || Date.now();
    for (const c of clips) {
      if (!c || typeof c.clipNumber !== 'number') continue;
      const prev = docMap[c.clipNumber];
      const isRejectedEmpty =
        (c.videoAuditStatus === 'rejected' || c.auditStatus === 'mismatch') &&
        !String(c.videoSavedFileName || '').trim();
      const effDiscFile = c.discardedVideoFileName || prev?.discardedVideoFileName || '';
      const effDiscAt = Math.max(Number(c.videoDiscardedAt || 0), Number(prev?.videoDiscardedAt || 0));
      const rawNextRev = isRejectedEmpty ? false : Boolean(c.reviewedForEditor);
      const clipRevAt = Number(c.reviewedUpdatedAt || 0);
      const prevRevAt = Number(prev?.reviewedUpdatedAt || 0);
      const preservePrevNewerRev = Boolean(prev && !isRejectedEmpty && prevRevAt > clipRevAt);
      const nextRev = preservePrevNewerRev ? Boolean(prev?.reviewedForEditor) : rawNextRev;
      const nextRevAt = preservePrevNewerRev
        ? prevRevAt
        : isRejectedEmpty
        ? Math.max(clipRevAt, prevRevAt)
        : Math.max(
            clipRevAt,
            prev && prev.reviewedForEditor === rawNextRev ? prevRevAt : 0
          );
      const nextRec = Boolean(c.recreated);
      const nextVid = isRejectedEmpty ? false : Boolean(c.videoReady);
      const nextImg = isRejectedEmpty ? false : Boolean(c.imageReady);
      const prevValidFile =
        prev?.videoSavedFileName && prev.videoSavedFileName !== effDiscFile
          ? prev.videoSavedFileName
          : undefined;
      const nextFile = isRejectedEmpty ? '' : c.videoSavedFileName || prevValidFile || '';
      const nextAuditStatus = c.videoAuditStatus || (isRejectedEmpty ? 'rejected' : prev?.videoAuditStatus);
      const nextSavedAt = Number(c.videoSavedAt || prev?.videoSavedAt || 0);
      if (
        !prev ||
        prev.reviewedForEditor !== nextRev ||
        prevRevAt !== nextRevAt ||
        Boolean(prev.recreated) !== nextRec ||
        Boolean(prev.videoReady) !== nextVid ||
        Boolean(prev.imageReady) !== nextImg ||
        (prev.videoSavedFileName || '') !== nextFile ||
        prev.videoAuditStatus !== nextAuditStatus ||
        (prev.discardedVideoFileName || '') !== effDiscFile ||
        Number(prev.videoDiscardedAt || 0) !== effDiscAt ||
        Number(prev.videoSavedAt || 0) !== nextSavedAt
      ) {
        docMap[c.clipNumber] = {
          reviewedForEditor: nextRev,
          ...(nextRevAt > 0 ? { reviewedUpdatedAt: nextRevAt } : {}),
          recreated: nextRec,
          videoReady: nextVid,
          imageReady: nextImg,
          ...(nextFile ? { videoSavedFileName: nextFile } : {}),
          ...(nextAuditStatus ? { videoAuditStatus: nextAuditStatus } : {}),
          ...(effDiscFile ? { discardedVideoFileName: effDiscFile } : {}),
          ...(effDiscAt > 0 ? { videoDiscardedAt: effDiscAt } : {}),
          ...(nextSavedAt > 0 ? { videoSavedAt: nextSavedAt } : {}),
          updatedAt: now,
        };
      }
    }
    map[docId] = docMap;
    localStorage.setItem(LOCAL_CLIP_REVIEW_STATE_KEY, JSON.stringify(map));
  } catch {}
}

export function applyStoredClipReviewStateToDocs(
  list: DocumentaryProject[]
): DocumentaryProject[] {
  if (!Array.isArray(list) || list.length === 0) return list;
  const map = loadStoredClipReviewStateMap() || {};
  let storeMutated = false;

  const updatedList = list.map((doc) => {
    if (!doc || !doc.id) return doc;
    const baseDoc = normalizeDocumentaryVoiceoverAudio(doc);
    if (!Array.isArray(baseDoc.clips) || baseDoc.clips.length === 0) return baseDoc;
    const docMap = map[baseDoc.id];
    if (!docMap) return baseDoc;
    let changed = false;
    const nextClips = baseDoc.clips.map((c) => {
      const saved = docMap[c.clipNumber];
      if (!saved) return c;
      const effDiscFile = c.discardedVideoFileName || saved.discardedVideoFileName || '';
      const effDiscAt = Math.max(Number(c.videoDiscardedAt || 0), Number(saved.videoDiscardedAt || 0));
      const cFile = String(c.videoSavedFileName || '').trim();
      const sFile = String(saved.videoSavedFileName || '').trim();
      const isSavedRevokedByFile = Boolean(effDiscFile && sFile && sFile === effDiscFile);
      const isClipRejectedEmpty =
        (c.videoAuditStatus === 'rejected' || c.auditStatus === 'mismatch') && !cFile;
      const savedHasNewerValidFile = Boolean(
        sFile &&
          !isSavedRevokedByFile &&
          Number(saved.videoSavedAt || saved.updatedAt || 0) > effDiscAt
      );

      if (isClipRejectedEmpty && !savedHasNewerValidFile) {
        if (saved.reviewedForEditor || saved.videoReady || saved.imageReady || sFile) {
          docMap[c.clipNumber] = {
            ...saved,
            reviewedForEditor: false,
            videoReady: false,
            imageReady: false,
            videoSavedFileName: '',
            videoAuditStatus: 'rejected',
            ...(effDiscFile ? { discardedVideoFileName: effDiscFile } : {}),
            ...(effDiscAt > 0 ? { videoDiscardedAt: effDiscAt } : {}),
          };
          storeMutated = true;
        }
        return c;
      }

      if (isSavedRevokedByFile) {
        docMap[c.clipNumber] = {
          ...saved,
          videoSavedFileName: cFile || '',
          ...(effDiscFile ? { discardedVideoFileName: effDiscFile } : {}),
          ...(effDiscAt > 0 ? { videoDiscardedAt: effDiscAt } : {}),
        };
        storeMutated = true;
        if (cFile) {
          // Clip already has a non-revoked replacement file on server (e.g. #68 shifted)
          return c;
        }
      }

      const savedAfterDiscard = !effDiscAt || Number(saved.updatedAt || 0) > effDiscAt;
      if (effDiscAt > 0 && !savedAfterDiscard && !cFile && !c.videoReady && !c.reviewedForEditor) {
        if (
          saved.reviewedForEditor ||
          saved.videoReady ||
          saved.imageReady ||
          sFile ||
          Number(saved.videoDiscardedAt || 0) < effDiscAt
        ) {
          docMap[c.clipNumber] = {
            ...saved,
            reviewedForEditor: false,
            videoReady: false,
            imageReady: false,
            videoSavedFileName: '',
            ...(effDiscFile ? { discardedVideoFileName: effDiscFile } : {}),
            videoDiscardedAt: effDiscAt,
            updatedAt: effDiscAt,
          };
          storeMutated = true;
        }
        return c;
      }

      const cRevAt = Number(c.reviewedUpdatedAt || 0);
      const sRevAt =
        !isSavedRevokedByFile && savedAfterDiscard ? Number(saved.reviewedUpdatedAt || 0) : 0;
      let mergedRev: boolean;
      let mergedRevAt = 0;
      if (cRevAt > 0 || sRevAt > 0) {
        if (sRevAt > cRevAt) {
          mergedRev = Boolean(saved.reviewedForEditor);
          mergedRevAt = sRevAt;
        } else if (cRevAt > sRevAt) {
          mergedRev = Boolean(c.reviewedForEditor);
          mergedRevAt = cRevAt;
        } else {
          mergedRev = Boolean(c.reviewedForEditor);
          mergedRevAt = cRevAt;
        }
      } else {
        mergedRev = Boolean(
          c.reviewedForEditor ||
            (!isSavedRevokedByFile && savedAfterDiscard && saved.reviewedForEditor)
        );
      }
      const mergedRec = Boolean(c.recreated || saved.recreated);
      const mergedVid = Boolean(
        c.videoReady || (!isSavedRevokedByFile && savedAfterDiscard && saved.videoReady)
      );
      const mergedImg = Boolean(
        c.imageReady || (!isSavedRevokedByFile && savedAfterDiscard && saved.imageReady)
      );
      const mergedFile = cFile || (!isSavedRevokedByFile ? sFile : '');
      if (
        Boolean(c.reviewedForEditor) !== mergedRev ||
        cRevAt !== mergedRevAt ||
        Boolean(c.recreated) !== mergedRec ||
        Boolean(c.videoReady) !== mergedVid ||
        Boolean(c.imageReady) !== mergedImg ||
        (c.videoSavedFileName || '') !== mergedFile
      ) {
        changed = true;
        return {
          ...c,
          reviewedForEditor: mergedRev,
          ...(mergedRevAt > 0 ? { reviewedUpdatedAt: mergedRevAt } : {}),
          recreated: mergedRec,
          videoReady: mergedVid,
          imageReady: mergedImg,
          ...(mergedFile ? { videoSavedFileName: mergedFile } : {}),
        };
      }
      return c;
    });
    const updatedDoc = changed ? { ...baseDoc, clips: nextClips } : baseDoc;
    return updatedDoc;
  });

  if (storeMutated) {
    try {
      localStorage.setItem(LOCAL_CLIP_REVIEW_STATE_KEY, JSON.stringify(map));
    } catch {}
  }
  return updatedList;
}

export function isLocalRuntimeOrigin(): boolean {
  if (typeof window === 'undefined') return false;
  const { hostname, protocol } = window.location;
  if (protocol === 'file:') return true;
  return (
    hostname === 'localhost' ||
    hostname === '127.0.0.1' ||
    hostname === '0.0.0.0' ||
    hostname === '[::1]' ||
    hostname === '::1' ||
    hostname.endsWith('.local')
  );
}

export function isWorkstationOnlyAudioUrl(rawUrl?: string | null): boolean {
  if (!rawUrl || typeof rawUrl !== 'string') return false;
  const u = rawUrl.trim();
  if (!u) return false;
  return (
    /^https?:\/\/(?:localhost|127\.0\.0\.1|0\.0\.0\.0|\[::1\]|192\.168\.\d+\.\d+|10\.\d+\.\d+\.\d+|172\.(?:1[6-9]|2\d|3[01])\.\d+\.\d+)(?::\d+)?(?:\/|$)/i.test(
      u
    ) ||
    /\/api\/flow\/serve-folder-file\b/i.test(u) ||
    /^(?:file:\/\/|\/Users\/|\/private\/)/i.test(u)
  );
}

export function isNonPortableAudioUrl(rawUrl?: string | null): boolean {
  if (!rawUrl || typeof rawUrl !== 'string') return true;
  const u = rawUrl.trim();
  return !u || u.startsWith('blob:') || isWorkstationOnlyAudioUrl(u);
}

export function isUnusableAudioUrlForCurrentRuntime(
  rawUrl?: string | null,
  treatBlobAsDead = false
): boolean {
  if (!rawUrl || typeof rawUrl !== 'string') return true;
  const u = rawUrl.trim();
  if (!u) return true;
  if (treatBlobAsDead && u.startsWith('blob:')) return true;
  if (
    typeof window !== 'undefined' &&
    window.location.protocol === 'https:' &&
    /^http:\/\//i.test(u)
  ) {
    return true;
  }
  if (!isLocalRuntimeOrigin() && isWorkstationOnlyAudioUrl(u)) {
    return true;
  }
  return false;
}

export function normalizeVoiceoverUrlString(url?: string): string {
  if (!url || typeof url !== 'string') return '';
  let trimmed = url.trim();
  if (!trimmed) return '';
  trimmed = trimmed
    .replace(/^(?:\.\/|\/+)?Huellas-Master\/(?=tts-files\/)/i, '')
    .replace(/^(?:\.\/|\/+)?(?:docs|data)\/(?=tts-files\/)/i, '')
    .replace(/^\.\/(?=tts-files\/)/i, '');
  if (/^\/?tts-files\/(.+)\.wav$/i.test(trimmed)) {
    trimmed = trimmed.replace(/^\/?tts-files\/(.+)\.wav$/i, 'tts-files/$1.mp3');
  }
  if (trimmed.startsWith('/tts-files/')) {
    trimmed = trimmed.slice(1);
  }
  if (/^tts-files\/tts-video-77-penicilina\.mp3(?:\?.*)?$/i.test(trimmed)) {
    return 'tts-files/tts-video-77-penicilina.mp3?v=nodup3';
  }
  return trimmed;
}

export function normalizeDocumentaryVoiceoverAudio(doc: DocumentaryProject): DocumentaryProject {
  if (!doc) return doc;
  let masterAudioUrl = normalizeVoiceoverUrlString(doc.masterAudioUrl);
  let audioTracks = Array.isArray(doc.audioTracks)
    ? doc.audioTracks.map((t) => ({
        ...t,
        audioUrl: normalizeVoiceoverUrlString(t.audioUrl),
      }))
    : [];

  // Promote portable tracks (`tts-files/...` or `https://...`) ahead of workstation-only `tts-folder-*` / `localhost` entries
  const firstPortableIdx = audioTracks.findIndex(
    (t) => !String(t?.id || '').startsWith('tts-folder-') && !isNonPortableAudioUrl(t?.audioUrl)
  );
  if (firstPortableIdx >= 0) {
    const portableTrack = audioTracks[firstPortableIdx];
    const folderDonor = audioTracks.find(
      (t) =>
        (String(t?.id || '').startsWith('tts-folder-') || isWorkstationOnlyAudioUrl(t?.audioUrl)) &&
        Array.isArray(t?.segmentTimings) &&
        t.segmentTimings.length > 0
    );
    const enrichedPortable =
      folderDonor &&
      (!Array.isArray(portableTrack.segmentTimings) || portableTrack.segmentTimings.length === 0) &&
      Math.abs((Number(portableTrack.duration) || 0) - (Number(folderDonor.duration) || 0)) <= 6
        ? {
            ...portableTrack,
            segmentTimings: folderDonor.segmentTimings,
            duration: portableTrack.duration || folderDonor.duration,
          }
        : portableTrack;
    const remainingTracks = audioTracks.filter(
      (t, idx) =>
        idx !== firstPortableIdx &&
        !String(t?.id || '').startsWith('tts-folder-') &&
        !isWorkstationOnlyAudioUrl(t?.audioUrl)
    );
    if (
      firstPortableIdx !== 0 ||
      enrichedPortable !== portableTrack ||
      remainingTracks.length !== audioTracks.length - 1
    ) {
      audioTracks = [enrichedPortable, ...remainingTracks];
    }
    if (isNonPortableAudioUrl(masterAudioUrl)) {
      masterAudioUrl = enrichedPortable.audioUrl;
    }
  } else if (!isLocalRuntimeOrigin()) {
    if (isUnusableAudioUrlForCurrentRuntime(masterAudioUrl, true)) {
      masterAudioUrl = '';
    }
    if (audioTracks.some((t) => isUnusableAudioUrlForCurrentRuntime(t?.audioUrl, true))) {
      audioTracks = audioTracks.filter(
        (t) => !String(t?.id || '').startsWith('tts-folder-') && !isUnusableAudioUrlForCurrentRuntime(t?.audioUrl, true)
      );
    }
  }

  const combinedText = `${doc.title || ''} ${doc.topic || ''} ${doc.downloadFolderName || ''} ${(doc.voiceoverScript || '').slice(0, 400)}`.toLowerCase();
  const isVideo76Exodo =
    combinedText.includes('76') ||
    combinedText.includes('éxodo español') ||
    combinedText.includes('exodo espanol') ||
    combinedText.includes('maliaño, santander');
  const isVideo74Princesas =
    combinedText.includes('74') ||
    combinedText.includes('princesas de la edad media') ||
    combinedText.includes('cortes reales de europa');
  const isVideo77Penicilina =
    doc.id === 'doc-video-77-huellas' ||
    combinedText.includes('video 77') ||
    combinedText.includes('penicilina');

  const isDeadOrEmptyUrl = (u?: string) => isNonPortableAudioUrl(u);

  let nextTimelineSentences = doc.timelineSentences;
  let nextTimelineFormattedText = doc.timelineFormattedText;

  if (isVideo77Penicilina && isDeadOrEmptyUrl(masterAudioUrl)) {
    masterAudioUrl = 'tts-files/tts-video-77-penicilina.mp3?v=nodup3';
    if (audioTracks.length === 0 || audioTracks.every((t) => isDeadOrEmptyUrl(t.audioUrl))) {
      audioTracks = [
        {
          id: 'tts-video-77-penicilina',
          label: 'Voz Narrativa Video 77 — La Penicilina',
          text: doc.voiceoverScript || '',
          voice: doc.selectedVoice || 'Charon',
          style: doc.selectedStyle || 'formal',
          speed: doc.selectedSpeed || 'medium',
          language: doc.selectedLanguage || 'es-la',
          consistencyMode: true,
          filename: 'tts-video-77-penicilina.mp3',
          audioUrl: 'tts-files/tts-video-77-penicilina.mp3?v=nodup3',
          createdAt: doc.updatedAt || new Date().toISOString(),
          storageMode: 'local',
          wordCount: 2787,
          duration: 1129.6,
          providerUsed: 'Gemini 3.8 Flash TTS (Charon · Limpieza C2PA + Anti-Duplicado)',
        },
      ];
    } else {
      audioTracks = audioTracks.map((t, i) =>
        i === 0
          ? {
              ...t,
              audioUrl: isDeadOrEmptyUrl(t.audioUrl)
                ? 'tts-files/tts-video-77-penicilina.mp3?v=nodup3'
                : t.audioUrl,
              duration: 1129.6,
            }
          : t
      );
    }
  } else if (isVideo77Penicilina && audioTracks.length > 0) {
    // Self-heal stale pre-deduplication durations (1139.7s / 1161.2s / 1920s) on the canonical cleaned Video 77 MP3 (1129.55s)
    const t0 = audioTracks[0];
    const isCanonicalV77Mp3 = /tts-video-77-penicilina\.mp3/i.test(String(t0?.audioUrl || ''));
    const lastTimingEnd = Array.isArray(t0?.segmentTimings) && t0.segmentTimings.length > 0
      ? Number(t0.segmentTimings[t0.segmentTimings.length - 1]?.endSec) || 0
      : 0;
    if (isCanonicalV77Mp3 && (Math.abs((Number(t0.duration) || 0) - 1129.6) > 2 || lastTimingEnd > 1132)) {
      const scale = lastTimingEnd > 10 ? 1129.55 / lastTimingEnd : 1;
      const fixedTimings =
        Array.isArray(t0.segmentTimings) && lastTimingEnd > 1132
          ? t0.segmentTimings.map((seg) => ({
              ...seg,
              startSec: Number((seg.startSec * scale).toFixed(3)),
              endSec: Number((seg.endSec * scale).toFixed(3)),
              durationSec: Number(((seg.endSec - seg.startSec) * scale).toFixed(3)),
            }))
          : t0.segmentTimings;
      audioTracks = [
        {
          ...t0,
          duration: 1129.6,
          ...(fixedTimings ? { segmentTimings: fixedTimings } : {}),
        },
        ...audioTracks.slice(1),
      ];
    }
    const tlMaxEnd = Array.isArray(nextTimelineSentences) && nextTimelineSentences.length > 0
      ? nextTimelineSentences.reduce((m, s) => Math.max(m, Number(s?.end) || 0), 0)
      : 0;
    if (isCanonicalV77Mp3 && (tlMaxEnd > 1156 || /19:52|19:28|19:24|32:/i.test(String(nextTimelineFormattedText || '')))) {
      nextTimelineSentences = [];
      nextTimelineFormattedText = '';
    }
  } else if (isVideo76Exodo && isDeadOrEmptyUrl(masterAudioUrl)) {
    masterAudioUrl = 'tts-files/tts-video-76-exodo-espanol.mp3';
    if (audioTracks.length === 0 || audioTracks.every((t) => isDeadOrEmptyUrl(t.audioUrl))) {
      audioTracks = [
        {
          id: 'tts-video-76-exodo-espanol',
          label: 'Voz Narrativa Master — Video 76 Éxodo Español Transatlántico',
          text: doc.voiceoverScript || '',
          voice: doc.selectedVoice || 'Charon',
          style: doc.selectedStyle || 'dramatic',
          speed: doc.selectedSpeed || 'medium',
          language: doc.selectedLanguage || 'es-la',
          consistencyMode: true,
          filename: 'Voz_Narrativa_Master_Video_76_Exodo_Espanol_Transatlantico.mp3',
          audioUrl: 'tts-files/tts-video-76-exodo-espanol.mp3',
          createdAt: doc.updatedAt || new Date().toISOString(),
          storageMode: 'local',
          wordCount: 1980,
          duration: 890.83,
          providerUsed: 'Gemini 3.8 Flash TTS (Charon)',
        },
      ];
    } else {
      audioTracks = audioTracks.map((t, i) =>
        i === 0
          ? {
              ...t,
              audioUrl: isDeadOrEmptyUrl(t.audioUrl)
                ? 'tts-files/tts-video-76-exodo-espanol.mp3'
                : t.audioUrl,
              duration: 890.83,
            }
          : t
      );
    }
  } else if (isVideo74Princesas && isDeadOrEmptyUrl(masterAudioUrl)) {
    masterAudioUrl = 'tts-files/tts-1793103539750-763.mp3';
  }

  let nextClips = doc.clips;
  let nextRawClipsText = doc.rawClipsText;
  if (isVideo76Exodo) {
    const newImg2 =
      'Image 2: Create an image of an adult Spanish farmer wearing a dark wool beret and brown corduroy jacket standing on the left side of a small wooden registration table on the wet stone dock of Maliaño in Santander, Spain, 1885, holding a single white rectangular paper steamship ticket in his right hand near his chest (strictly no coins or pouches), facing a port clerk in a dark wool coat and cap who is already seated on a wooden chair on the right side of the wooden table with his open hand resting on the tabletop waiting to receive the ticket, 16:9 horizontal, cinematic lighting, historical accuracy, no text, clean uncluttered composition with rigid architectural perspective, stationary period props, and clear anatomical separation between subjects, portrayed by anonymous historical reenactment actors in authentic period costume (no real public figures or prominent people).';
    const newClip2 =
      "Clip 2 (00:06 - 00:16): Create a video in a steady medium two-shot on the wet stone dock in Santander, Spain, 1885, as the standing Spanish farmer in the dark wool beret reaches his right arm forward across the wooden table and places the single white rectangular paper steamship ticket directly into the waiting hand of the port clerk sitting on the wooden chair at the table, who closes his fingers around the paper ticket, pulls it toward himself over the tabletop, and looks down to inspect it, strictly no voiceover. The paper ticket stays a single flat rectangular paper ticket as it passes smoothly from the farmer's hand into the seated clerk's hand without morphing or transforming into coins or any other object. Both men keep their mouths closed in silent action with zero spoken words, zero narration, and zero voiceover. Ambient Foley: steady rain pattering on wet stone, crisp paper ticket rustle as it changes hands, distant harbor waves, single continuous shot, strictly no shot changes, no music, no speech, no text. Año 1885, muelle de Maliaño, Santander, España. La rampa de piedra húmeda donde miles de campesinos del norte entregaban los ahorros de toda una vida para cruzar. fix the name";

    const newImg5 =
      'Image 5: Create an image of a massive black-hulled 1885 transatlantic steamship sailing away into a dark stormy Atlantic night, illuminated by a sweeping golden beam of light from a stone harbor lighthouse in the foreground as waves crash against the wet breakwater, 16:9 horizontal, cinematic lighting, historical accuracy, no text, clean uncluttered composition with rigid architectural perspective, stationary period props, and clear anatomical separation between subjects, portrayed by anonymous historical reenactment actors in authentic period costume (no real public figures or prominent people).';
    const newClip5 =
      'Clip 5 (00:36 - 00:46): Create a video showing a slow cinematic push-in along the wet stone breakwater in Santander, Spain, 1885, as the golden lighthouse beam sweeps through the mist over the dark Atlantic waves and the distant black-hulled steamship sails deeper into the night horizon. Smooth, controlled fluid-head camera motion maintaining rigid 3D spatial perspective throughout the 10-second shot. Sustained, unhurried continuous action across the full 10 seconds, holding a natural composed posture through the final frame. Fixed subject count from 0s to 10s: exact same character(s) remain in frame with locked anatomy, no new people appearing out of nowhere mid-shot, no characters vanishing or morphing, background figures stationary in soft f/1.8 bokeh. Solid, non-deforming walls and rigid 3D architectural geometry from 0s to 10s that never warp, breathe, or mutate during camera movement. All furniture, tables, and props remain 100% physically solid and non-deforming from 0s to 10s, with zero self-moving, floating, morphing, mutating, vanishing, or shape-shifting objects. Cinematic historical drama reenactment featuring anonymous fictionalized theatre actors in period costume (no real public figures or prominent people, no unintended explosions or flashes). Ambient Foley: deep distant foghorn echoing, heavy Atlantic waves breaking against stone, wind whistling, single continuous shot, strictly no shot changes, no music, no speech, no text. de hacer la América, desde las bodegas asfixiantes de tercera clase y los campamentos de cuarentena hasta la servidumbre silenciosa de quienes dormían sobre mostradores de madera. fix the name';

    const newImg19 =
      'Image 19: Create an image of a bright sunlit outdoor harbor pier in Santander, Spain, 1885, a weathered peasant hand holding a printed third-class steamship ticket and silver peseta coins in the foreground while a massive black-hulled transatlantic steamship vents white steam in the background, 16:9 horizontal, cinematic daylight, historical accuracy, no text.';
    const newClip19 =
      "Clip 19 (02:56 - 03:06): Create a video showing a slow camera push-in past the peasant's hand holding the third-class steamship ticket and silver coins on the sunlit stone pier toward the towering black hull of the transatlantic steamship in Santander harbor, Spain, 1885. Ambient Foley: crisp paper ticket fluttering in sea breeze, clinking silver coins, distant steamship horn and harbor waves, single continuous shot, strictly no shot changes, no music, no speech, no text. billete de tercera clase en vapor hacia La Habana o Veracruz costaba entre 205 y 235 pesetas. La aritmética de la supervivencia no dejaba alternativa: o. fix the name";

    const newImg20 =
      'Image 20: Create an image of @Ricardo_Ruiz_Balbin holding a rope-tied wooden trunk and embracing his weeping mother in black wool shawls in the foreground beside their stone cottage in Lué, Asturias, Spain, 1885, with a long misty dirt road stretching straight away into the background distance, 16:9 horizontal, cinematic lighting, historical accuracy, no text.';
    const newClip20 =
      "Clip 20 (03:06 - 03:16): Create a video showing a steady shot from behind as @Ricardo_Ruiz_Balbin gently releases his weeping mother's embrace in the foreground, turns his back to the camera, and walks straight away from her and away from the camera down the misty dirt road into the distance in Asturias, Spain, 1885, without ever turning back or changing direction. Ambient Foley: rough wool fabric rustling, wooden trunk handle creaking, footsteps receding on wet gravel, single continuous shot, strictly no shot changes, no music, no speech, no text. pagar 2 mil pesetas para no ir a la guerra en la manigua, o embarcar por la décima parte antes de cumplir los 20 años. fix the name";

    const newImg23 =
      'Image 23: Create an image from behind of a single Spanish soldier in a straw hat and canvas pack standing still with his hands resting on the iron deck railing of a transport steamship departing Cádiz harbor, Spain, 1895, looking out at the receding stone pier across the water, 16:9 horizontal, golden late-afternoon light, cinematic lighting, historical accuracy, no text.';
    const newClip23 =
      "Clip 23 (03:36 - 03:46): Create a video showing a slow over-the-shoulder push-in behind the single Spanish soldier standing still at the ship's iron railing in Cádiz harbor, Spain, 1895, as sea breeze gently moves his hat brim and ocean waves ripple below. Ambient Foley: deep steamship horn echoing across the bay, ocean waves lapping against the hull, sea wind, single continuous shot, strictly no shot changes, no music, no speech, no text. y Gibraltar. Incluso el aparato militar operó como un puente sin retorno: de los 345 mil soldados enviados a Cuba a finales del siglo XIX, cerca. fix the name";

    const newImg27 =
      'Image 27: Create an image of two mature 45-year-old Spanish emigrants in wool berets and heavy corduroy coats standing beside rope-tied wooden trunks on the wet cobblestone pier of La Coruña, Spain, 1905, examining a paper steamship ticket while a massive black-hulled steamship rests moored in soft f/1.8 background bokeh, 16:9 horizontal, cinematic lighting, historical accuracy, no text, clean uncluttered composition with rigid architectural perspective, stationary period props, and clear anatomical separation between subjects, portrayed by anonymous historical reenactment actors in authentic period costume (no real public figures or prominent people). STRICT ADULTS-ONLY CAST (AGES 35–60): Every single person in foreground and background is a mature adult aged 35 to 60 years old; strictly zero children, zero infants, zero minors, zero teenagers, and zero underage figures anywhere in the frame.';
    const newClip27 =
      'Clip 27 (04:16 - 04:26): Create a video showing a slow dolly push-in on the two mature 45-year-old Spanish emigrants in wool berets standing beside their stationary wooden trunks on the wet stone pier in La Coruña, Spain, 1905, looking up from their ticket toward the moored steamship as harbor mist drifts past. STRICT ADULTS-ONLY CAST (AGES 35–60): Every single person in foreground and background is a mature adult aged 35 to 60 years old; strictly zero children, zero infants, zero minors, zero teenagers, and zero underage figures anywhere in the frame. Smooth, controlled fluid-head camera motion maintaining rigid 3D spatial perspective throughout the 10-second shot. Fixed subject count from 0s to 10s with stationary wooden trunks on the stone ground. Ambient Foley: Atlantic harbor breeze, gentle water lapping stone pier, distant steamship horn, single continuous shot, strictly no shot changes, no music, no speech, no text. de La Coruña, de donde partieron cerca de 500 mil pasajeros, así como en Vigo, Santander, el puerto de El Musel en Gijón, Tenerife. fix the name';

    const newImg35 =
      'Image 35: Create an image of the dark iron boiler room of a Spanish transatlantic steamship in 1907, soot-covered stokers resting their shovels as the glowing coal furnaces dim and white steam settles around brass pressure gauges, 16:9 horizontal, cinematic lighting, historical accuracy, no text.';
    const newClip35 =
      'Clip 35 (05:36 - 05:46): Create a video showing a slow push-in toward the dimming iron coal furnaces and brass pressure gauges in the quiet steamship boiler room in 1907 as thin white steam gently dissipates in the air. Ambient Foley: dying furnace embers crackling softly, final steam valve hiss fading into silence, cooling iron ticking, single continuous shot, strictly no shot changes, no music, no speech, no text. de Alfonso XIII, todos compartían la misma incertidumbre al divisar la costa americana. ¿Qué ocurría realmente cuando las calderas se apagaban y aquellos viajeros exhaustos se. fix the name';
    const newImg42 =
      "Image 42: Create an image of stacked emigrants' wooden trunks with tied cardboard quarantine tags in the empty sunlit reception hall of Triscornia camp, Havana, Cuba, 1905, beside a wooden table holding amber glass bottles of disinfectant and a brass medical seal, strictly an empty architectural interior with zero people and no human figures anywhere in the frame, 16:9 horizontal, warm window light, cinematic lighting, historical accuracy, no text.";
    const newClip42 =
      'Clip 42 (06:46 - 06:56): Create a video showing a slow lateral camera dolly across the stacked wooden trunks with quarantine tags and the amber glass disinfectant bottles on the wooden table in the empty sunlit reception hall of Triscornia, Havana, Cuba, 1905, as dust motes float in the warm window light, strictly an empty architectural interior with zero people and no human figures anywhere in the frame. Ambient Foley: paper quarantine tags fluttering softly in the draft, wooden floorboards creaking, distant harbor breeze, single continuous shot, strictly no shot changes, no music, no speech, no text. paseo central por jardines con 35 mil rosales. Al mando del campamento se encontraba el doctor Frank Menocal, cirujano de 39 años de edad hacia 1905. fix the name';
    const newImg45 =
      "Image 45: Create an image of the interior of a wooden dormitory pavilion in Triscornia camp, Havana, Cuba, 1905, showing neat rows of empty folding canvas cots with folded wool blankets and emigrants' wooden trunks resting at the foot of each cot, warm beams of tropical sunlight streaming through screened wooden windows, strictly an empty architectural interior with zero people and no human figures anywhere in the frame, 16:9 horizontal, cinematic lighting, historical accuracy, no text.";
    const newClip45 =
      'Clip 45 (07:16 - 07:26): Create a video showing a slow, smooth forward dolly shot down the center aisle between the rows of empty canvas cots and wooden trunks inside the sunlit wooden pavilion in Havana, Cuba, 1905, as dust motes float gently in the beams of window light, strictly an empty architectural interior with zero people and no human figures anywhere in the frame. Ambient Foley: wooden floorboards creaking softly, warm tropical breeze rustling window screens, distant harbor ambience, single continuous shot, strictly no shot changes, no music, no speech, no text. varilla de vidrio buscando granulaciones de tracoma, una infección ocular que significaba la deportación inmediata. Entre julio y octubre de 1905 arribaron más de. fix the name';
    const newImg52 =
      'Image 52: Create an image of two adult Spanish immigrant women in wool berets and dark shawls walking forward down a cobblestone street in Mexico City, Mexico, 1910, carrying rope-tied wooden trunks, 16:9 horizontal, cinematic lighting, historical accuracy, no text, clean uncluttered composition with rigid architectural perspective, stationary period props, and clear anatomical separation between subjects, portrayed by anonymous historical reenactment actors in authentic period costume (no real public figures or prominent people). STRICT ADULTS-ONLY CAST (AGES 35–60): Every single person in foreground and background is a mature adult aged 35 to 60 years old; strictly zero children, zero infants, zero minors, zero teenagers, and zero underage figures anywhere in the frame.';
    const newClip52 =
      'Clip 52 (08:26 - 08:36): Create a video showing a smooth backward tracking dolly shot moving continuously ahead of the two Spanish immigrant women in wool berets as they keep walking steadily forward down the cobblestone street in Mexico City, Mexico, 1910, carrying their wooden trunks while the camera follows their uninterrupted walk from start to finish without stopping. SINGLE CONTINUOUS UNBROKEN TAKE (ZERO CUTS): Strict one-shot continuous cinematography from 0s to 10s in a single uninterrupted camera take; strictly zero camera cuts, zero shot jumps, zero angle switches, zero scene changes, and zero split screens throughout the entire clip. STRICT ADULTS-ONLY CAST (AGES 35–60): Every single person in foreground and background is a mature adult aged 35 to 60 years old; strictly zero children, zero infants, zero minors, zero teenagers, and zero underage figures anywhere in the frame. Smooth, controlled fluid-head camera motion maintaining rigid 3D spatial perspective throughout the 10-second shot. Ambient Foley: steady leather boots walking on cobblestones, wooden trunk handles creaking softly, distant carriage wheels, single continuous shot, strictly no shot changes, no music, no speech, no text. pana por el dril blanco y las alpargatas de cáñamo, escribió el 13 de diciembre de 1920 una carta a su madre, Bernarda Ruiz Balbín, tranquilizándola sobre. fix the name';
    const newImg55 =
      "Image 55: Create an image of a stern older Spanish store owner in a dark vest standing with both hands resting empty on a polished mahogany counter in a traditional grocery store in Mexico City, Mexico, 1910, speaking seriously to an adult newly arrived Spanish clerk in a white linen apron standing across the counter with empty hands (strictly no brooms or tools in anyone's hands), 16:9 horizontal, cinematic lighting, historical accuracy, no text. STRICT ADULTS-ONLY CAST (AGES 35–60): Every single person in foreground and background is a mature adult aged 35 to 60 years old; strictly zero children, zero infants, zero minors, zero teenagers, and zero underage figures anywhere in the frame.";
    const newClip55 =
      'Clip 55 (08:56 - 09:06): Create a video showing a steady medium shot as the stern Spanish store owner stands behind the mahogany counter in Mexico City, Mexico, 1910, speaking and giving instructions with a calm authoritative gesture of his empty hand (without handing over any broom or object), while the clerk in the white apron nods respectfully, turns away from the counter, and walks out of the scene to go work. Ambient Foley: hands resting on polished mahogany wood, linen apron rustling, leather boots walking away on wooden floorboards, pocket watch ticking, single continuous shot, strictly no shot changes, no music, no speech, no text. STRICT ADULTS-ONLY CAST (AGES 35–60): Every single person in foreground and background is a mature adult aged 35 to 60 years old; strictly zero children, zero infants, zero minors, zero teenagers, and zero underage figures anywhere in the frame. tiendas y panaderías para alcanzar la prometida prosperidad? Lejos del mito romántico del indiano que amasaba fortuna al instante, los almacenes de abarrotes como El. fix the name';
    const newImg58 =
      'Image 58: Create an image captured from behind of a single mature 40-year-old Spanish store clerk in rolled-up white shirt sleeves and a linen apron standing inside the dim empty grocery store in Mexico City, Mexico, 1910, pushing open the tall wooden window shutters at 5 AM as the first blue-gold light of dawn spills across the swept wooden floor and stacked burlap flour sacks, strictly one single adult in frame, 16:9 horizontal, cinematic lighting, historical accuracy, no text. STRICT ADULTS-ONLY CAST (AGES 35–60): Strictly zero children, zero infants, zero minors, zero teenagers, and zero underage figures anywhere in the frame.';
    const newClip58 =
      'Clip 58 (09:26 - 09:36): Create a video showing a slow push-in from behind the single mature 40-year-old Spanish clerk standing by the tall open wooden shutters at 5 AM dawn inside the quiet grocery store in Mexico City, Mexico, 1910, as early morning light floods across the swept wooden floorboards and stationary burlap sacks. STRICT ADULTS-ONLY CAST (AGES 35–60): Strictly one single mature adult in frame with zero minors. Smooth, controlled fluid-head camera motion maintaining rigid 3D spatial perspective throughout the 10-second shot. Ambient Foley: heavy wooden shutter hinges creaking open, quiet dawn breeze, distant rooster and morning bell, single continuous shot, strictly no shot changes, no music, no speech, no text. que borraba toda frontera entre el trabajo y la vida privada. La jornada arrancaba a las 5 de la mañana barriendo el local, encendiendo la leña de. fix the name';
    const newImg59 =
      "Image 59: Create an image of an authentic 1910 Spanish bodega counter in Havana, Cuba at 10 PM at night with zero people, featuring a steaming porcelain cup of dark coffee and a glass of clear aguardiente beside a heavy glass bottle on a worn zinc-topped wooden counter, illuminated by a glowing brass carbide gas lamp hanging above, an antique round wall clock in the dim background showing ten o'clock, 16:9 horizontal, moody chiaroscuro lighting, 35mm film grain, photorealistic historical still life, no text, clean uncluttered composition with rigid architectural perspective and stationary period props (strictly zero people or human figures in frame).";
    const newClip59 =
      'Clip 59 (09:36 - 09:46): Create a video showing a slow, ultra-smooth macro push-in across the empty zinc-topped wooden bodega counter in Havana, Cuba, 1910, with strictly zero people in frame, focusing on gentle steam rising from a porcelain coffee cup beside a glass of aguardiente under the warm flickering glow of an overhead brass carbide gas lamp. Smooth, controlled fluid-head camera motion maintaining rigid 3D spatial perspective throughout the 10-second shot. Strictly zero people or human figures appearing anywhere in the frame from 0s to 10s. Solid, non-deforming walls and rigid 3D architectural geometry from 0s to 10s that never warp, breathe, or mutate during camera movement. All tables, documents, weapons, tools, furniture, and props remain 100% gravity-locked, physically solid, and completely stationary on surfaces from 0s to 10s, with zero self-moving, floating, morphing, mutating, vanishing, or shape-shifting objects. Cinematic historical documentary still-life cinematography (strictly zero people in frame, no unintended explosions or flashes). Ambient Foley: steady hiss of the carbide gas lamp, faint wooden floorboard creak, quiet night room tone, single continuous shot, strictly no shot changes, no music, no speech, no text. los hornos abovedados de ladrillo refractario o despachando café y aguardiente bajo el siseo de las lámparas de gas carburo, y no terminaba hasta las 10. fix the name';
    const newImg60 =
      'Image 60: Create an image of an exhausted adult Spanish store clerk sitting quietly on an already unrolled straw petate mat and folded canvas blanket atop a long mahogany and zinc store counter at night in Mexico City, Mexico, 1910, beside a stationary brass scale and a dim oil lantern, 16:9 horizontal, cinematic low-key night lighting, historical accuracy, no text.';
    const newClip60 =
      'Clip 60 (09:46 - 09:56): Create a video showing a slow dolly push-in on the exhausted Spanish clerk sitting still on the straw mat atop the mahogany counter in the dark store in Mexico City, Mexico, 1910, resting his head on his hand beside the brass scale as the oil lantern flame flickers softly. Ambient Foley: quiet night room tone, faint oil lamp hum, tired sigh, wooden counter creaking slightly, single continuous shot, strictly no shot changes, no music, no speech, no text. de la noche. Para ahorrar alquileres y vigilar la mercancía frente a robos o incendios, los dependientes tenían prohibido vivir fuera de la tienda. fix the name';
    const newImg72 =
      'Image 72: Create an image of an elderly mother in black wool shawl standing by a stone mailbox on a rainy mountain road in Galicia, Spain, 1931, with the muddy country lane stretching away into the misty distance behind her, 16:9 horizontal, cinematic lighting, historical accuracy, no text, clean uncluttered composition with rigid architectural perspective, stationary period props, and clear anatomical separation between subjects, portrayed by anonymous historical reenactment actors in authentic period costume (no real public figures or prominent people).';
    const newClip72 =
      'Clip 72 (11:46 - 11:56): Create a video showing a steady shot as the elderly mother in black wool shawl turns her back to the camera and walks slowly and steadily away from the camera down the rainy mountain road into the misty distance in Galicia, Spain, 1931, receding farther down the path without ever turning back. SINGLE CONTINUOUS UNBROKEN TAKE (ZERO CUTS): Strict one-shot continuous cinematography from 0s to 10s in a single uninterrupted camera take; strictly zero camera cuts, zero shot jumps, zero angle switches, zero scene changes, and zero split screens throughout the entire clip. STRICT PURE AMBIENT FOLEY ONLY (NO MUSIC, NO VOICE): Characters keep mouths naturally closed in silent contemplation with zero lip movement or speaking; audio track must contain 100% pure environmental foley and natural room tone only (subtle fabric rustle, soft footsteps, wind, or room acoustics) with strictly zero background music, zero musical instruments, zero singing, zero choir, zero dialogue, zero narration, and zero human voices. Smooth, controlled fluid-head camera motion maintaining rigid 3D spatial perspective throughout the 10-second shot. Ambient Foley: cold rain falling on stone, slow footsteps receding on wet muddy gravel, lonely wind across valley, single continuous shot, strictly no shot changes, no music, no speech, no text. Triscornia o repatriados por caridad. Muchos, consumidos por la tuberculosis en las trastiendas húmedas y avergonzados de haber fracasado, dejaron de escribir a sus madres, prefiriendo. fix the name';
    const newImg76 =
      'Image 76: Create an image of @Pedro_Garfias_Zurita wearing thick tortoise-shell glasses, a black beret, and a worn shepherd jacket standing thoughtfully at the iron railing on the Sinaia steamship deck in Veracruz harbor, Mexico, 1939, surrounded only by adult passengers aged 35 to 60 in the background, 16:9 horizontal, cinematic lighting, historical accuracy, no text. STRICT ADULTS-ONLY CAST (AGES 35–60): Every single person in foreground and background is a mature adult aged 35 to 60 years old; strictly zero children, zero infants, zero minors, zero teenagers, and zero underage figures anywhere in the frame.';
    const newClip76 =
      'Clip 76 (12:26 - 12:36): Create a video showing a slow dolly-in on @Pedro_Garfias_Zurita wearing thick glasses and a black beret standing thoughtfully at the ship railing in Veracruz harbor, Mexico, 1939, looking toward the port as the harbor breeze moves his coat lapel. Ambient Foley: gentle harbor waves against the hull, distant gull cries, soft sea breeze, single continuous shot, strictly no shot changes, no music, no speech, no text. STRICT ADULTS-ONLY CAST (AGES 35–60): Every single person in foreground and background is a mature adult aged 35 to 60 years old; strictly zero children, zero infants, zero minors, zero teenagers, and zero underage figures anywhere in the frame. gastado, boina negra, chamarra de pastor zamorano y gruesas gafas de concha el poeta de 38 años @Pedro_Garfias_Zurita, junto a médicos, científicos, maestros y. fix the name';

    if (Array.isArray(doc.clips)) {
      let clipsChanged = false;
      const updated = doc.clips.map((c) => {
        if (
          c &&
          c.clipNumber === 2 &&
          (/holding a ticket and coin pouch|period historical artifact/i.test(c.imagePrompt || '') ||
            /handing his savings|narrative voice enters at 00:08|showing a slow dolly push-in on the wet stone dock/i.test(
              c.videoPrompt || ''
            ) ||
            !/standing on the left side of a small wooden registration table/i.test(
              c.imagePrompt || ''
            ))
        ) {
          clipsChanged = true;
          return {
            ...c,
            imagePrompt: newImg2,
            videoPrompt: newClip2,
          };
        }
        if (
          c &&
          c.clipNumber === 5 &&
          (/antique historian's|parchment scrolls|feather quill/i.test(c.imagePrompt || '') ||
            /antique historian's|parchment scrolls|inkpot/i.test(c.videoPrompt || '') ||
            !/stone harbor lighthouse/i.test(c.imagePrompt || '') ||
            !/^Image\s+5\s*:/i.test((c.imagePrompt || '').trim()))
        ) {
          clipsChanged = true;
          return {
            ...c,
            imagePrompt: newImg5,
            videoPrompt: newClip5,
          };
        }
        if (
          c &&
          c.clipNumber === 19 &&
          (/shipping agent's counter|wooden counter in Santander/i.test(c.imagePrompt || '') ||
            /shipping agent's hand stamps|wooden counter in Santander/i.test(c.videoPrompt || ''))
        ) {
          clipsChanged = true;
          return {
            ...c,
            imagePrompt: newImg19,
            videoPrompt: newClip19,
          };
        }
        if (
          c &&
          c.clipNumber === 20 &&
          (/stone doorway of their cottage/i.test(c.imagePrompt || '') ||
            /slow dolly-out as @Ricardo_Ruiz_Balbin|picks up his wooden trunk to walk down the misty lane/i.test(
              c.videoPrompt || ''
            ))
        ) {
          clipsChanged = true;
          return {
            ...c,
            imagePrompt: newImg20,
            videoPrompt: newClip20,
          };
        }
        if (
          c &&
          c.clipNumber === 23 &&
          (/rayadillo|marching onto a transport ship/i.test(c.imagePrompt || '') ||
            /rayadillo|boarding the transport vessel/i.test(c.videoPrompt || ''))
        ) {
          clipsChanged = true;
          return {
            ...c,
            imagePrompt: newImg23,
            videoPrompt: newClip23,
          };
        }
        if (
          c &&
          c.clipNumber === 27 &&
          (/crowded harbor pier in Vigo|hundreds of emigrants/i.test(c.imagePrompt || '') ||
            /emigrants lifting their wooden trunks|crowded stone pier in Vigo/i.test(c.videoPrompt || ''))
        ) {
          clipsChanged = true;
          return {
            ...c,
            imagePrompt: newImg27,
            videoPrompt: newClip27,
          };
        }
        if (
          c &&
          c.clipNumber === 35 &&
          (/heavy iron anchor|anchor chain plunges/i.test(c.imagePrompt || '') ||
            /heavy iron anchor|anchor chain plunges/i.test(c.videoPrompt || ''))
        ) {
          clipsChanged = true;
          return {
            ...c,
            imagePrompt: newImg35,
            videoPrompt: newClip35,
          };
        }
        if (
          c &&
          c.clipNumber === 42 &&
          (/Disinfection Brigade|steam autoclave/i.test(c.imagePrompt || '') ||
            /steam autoclave|iron door of the steam autoclave/i.test(c.videoPrompt || '') ||
            !/strictly an empty architectural interior with zero people/i.test(c.imagePrompt || '') ||
            !/strictly an empty architectural interior with zero people/i.test(c.videoPrompt || ''))
        ) {
          clipsChanged = true;
          return {
            ...c,
            imagePrompt: newImg42,
            videoPrompt: newClip42,
          };
        }
        if (
          c &&
          c.clipNumber === 45 &&
          (/overcrowded wooden dormitory|hundreds of Spanish immigrants|packed aisle of canvas cots/i.test(
            c.imagePrompt || ''
          ) ||
            /packed aisle of canvas cots|muffled coughing/i.test(c.videoPrompt || '') ||
            !/empty folding canvas cots/i.test(c.imagePrompt || ''))
        ) {
          clipsChanged = true;
          return {
            ...c,
            imagePrompt: newImg45,
            videoPrompt: newClip45,
          };
        }
        if (
          c &&
          c.clipNumber === 52 &&
          (/stopping before heavy wooden store doors|tracking shot behind/i.test(
            c.videoPrompt || ''
          ) ||
            !/smooth backward tracking dolly shot moving continuously ahead/i.test(
              c.videoPrompt || ''
            ))
        ) {
          clipsChanged = true;
          return {
            ...c,
            imagePrompt: newImg52,
            videoPrompt: newClip52,
          };
        }
        if (
          c &&
          c.clipNumber === 55 &&
          (/hands a broom|wooden broom handle/i.test(c.videoPrompt || '') ||
            !/without handing over any broom or object/i.test(c.videoPrompt || '') ||
            !/strictly no brooms or tools in anyone's hands/i.test(c.imagePrompt || ''))
        ) {
          clipsChanged = true;
          return {
            ...c,
            imagePrompt: newImg55,
            videoPrompt: newClip55,
          };
        }
        if (
          c &&
          c.clipNumber === 58 &&
          (/scooping rice and chickpeas|two-pan brass scale in a busy store/i.test(
            c.imagePrompt || ''
          ) ||
            /drops bronze weights onto the brass scale|pours grain from a tin scoop/i.test(
              c.videoPrompt || ''
            ) ||
            !/pushing open the tall wooden window shutters at 5 AM/i.test(c.imagePrompt || ''))
        ) {
          clipsChanged = true;
          return {
            ...c,
            imagePrompt: newImg58,
            videoPrompt: newClip58,
          };
        }
        if (
          c &&
          c.clipNumber === 59 &&
          (/sliding a heavy iron bolt|slides the heavy iron bolt|iron bolt on the wooden shutters/i.test(
            c.imagePrompt || ''
          ) ||
            /sliding a heavy iron bolt|slides the heavy iron bolt|wooden shutters at 10 PM/i.test(
              c.videoPrompt || ''
            ) ||
            !/steaming porcelain cup of dark coffee/i.test(c.imagePrompt || ''))
        ) {
          clipsChanged = true;
          return {
            ...c,
            imagePrompt: newImg59,
            videoPrompt: newClip59,
          };
        }
        if (
          c &&
          c.clipNumber === 60 &&
          (/unrolling a straw petate mat/i.test(c.imagePrompt || '') ||
            /unrolls his straw mat|lies down beside the brass scale/i.test(c.videoPrompt || ''))
        ) {
          clipsChanged = true;
          return {
            ...c,
            imagePrompt: newImg60,
            videoPrompt: newClip60,
          };
        }
        if (
          c &&
          c.clipNumber === 72 &&
          (/turns away empty-handed from the stone mailbox|looking down the empty path/i.test(
            c.imagePrompt || ''
          ) ||
            /turns away empty-handed from the stone mailbox/i.test(c.videoPrompt || '') ||
            !/walks slowly and steadily away from the camera/i.test(c.videoPrompt || ''))
        ) {
          clipsChanged = true;
          return {
            ...c,
            imagePrompt: newImg72,
            videoPrompt: newClip72,
          };
        }
        if (
          c &&
          c.clipNumber === 76 &&
          (/period historical artifact|Pedro Garfias Zurita/i.test(c.imagePrompt || '') ||
            /period historical artifact|Pedro Garfias Zurita/i.test(c.videoPrompt || '') ||
            !/STRICT ADULTS-ONLY CAST/i.test(c.imagePrompt || ''))
        ) {
          clipsChanged = true;
          return {
            ...c,
            imagePrompt: newImg76,
            videoPrompt: newClip76,
          };
        }
        if (
          c &&
          (/8\s*bokeh\)\./i.test(c.imagePrompt || '') || /8\s*bokeh\)\./i.test(c.videoPrompt || ''))
        ) {
          clipsChanged = true;
          return {
            ...c,
            imagePrompt: (c.imagePrompt || '').replace(/(?:\s*8\s*bokeh\)\.)+/gi, ''),
            videoPrompt: (c.videoPrompt || '').replace(/(?:\s*8\s*bokeh\)\.)+/gi, ''),
          };
        }
        return c;
      });
      if (clipsChanged) {
        nextClips = updated;
      }
    }
    if (typeof doc.rawClipsText === 'string') {
      let rawText = doc.rawClipsText;
      if (/8\s*bokeh\)\./i.test(rawText)) {
        rawText = rawText.replace(/(?:\s*8\s*bokeh\)\.)+/gi, '');
      }
      if (
        /Image 2:[^\n]*(?:holding a ticket and coin pouch|period historical artifact)/i.test(rawText) ||
        /Clip 2\s*\([^)]*\):[^\n]*(?:handing his savings|narrative voice enters at 00:08|showing a slow dolly push-in on the wet stone dock)/i.test(
          rawText
        ) ||
        (/Image 2:[^\n]*/i.test(rawText) &&
          !/Image 2:[^\n]*standing on the left side of a small wooden registration table/i.test(
            rawText
          ))
      ) {
        rawText = rawText
          .replace(/Image 2:[^\n]*/i, newImg2)
          .replace(/Clip 2\s*\([^)]*\):[^\n]*/i, newClip2);
      }
      if (
        /Image 5:[^\n]*(?:antique historian's|parchment scrolls)/i.test(rawText) ||
        (/Image 5:[^\n]*/i.test(rawText) && !/Image 5:[^\n]*stone harbor lighthouse/i.test(rawText))
      ) {
        rawText = rawText
          .replace(/Image 5:[^\n]*/i, newImg5)
          .replace(/Clip 5\s*\([^)]*\):[^\n]*/i, newClip5);
      }
      if (/Image 19:[^\n]*shipping agent's counter/i.test(rawText)) {
        rawText = rawText
          .replace(/Image 19:[^\n]*shipping agent's counter[^\n]*/i, newImg19)
          .replace(/Clip 19\s*\([^)]*\):[^\n]*wooden counter in Santander[^\n]*/i, newClip19);
      }
      if (
        /Image 20:[^\n]*stone doorway of their cottage/i.test(rawText) ||
        /Clip 20\s*\([^)]*\):[^\n]*slow dolly-out as @Ricardo_Ruiz_Balbin/i.test(rawText)
      ) {
        rawText = rawText
          .replace(/Image 20:[^\n]*stone doorway of their cottage[^\n]*/i, newImg20)
          .replace(
            /Clip 20\s*\([^)]*\):[^\n]*walk down the misty lane in Asturias[^\n]*/i,
            newClip20
          );
      }
      if (
        /Image 23:[^\n]*rayadillo/i.test(rawText) ||
        /Clip 23\s*\([^)]*\):[^\n]*rayadillo/i.test(rawText)
      ) {
        rawText = rawText
          .replace(/Image 23:[^\n]*rayadillo[^\n]*/i, newImg23)
          .replace(/Clip 23\s*\([^)]*\):[^\n]*rayadillo[^\n]*/i, newClip23);
      }
      if (
        /Image 27:[^\n]*crowded harbor pier in Vigo/i.test(rawText) ||
        /Clip 27\s*\([^)]*\):[^\n]*crowded stone pier in Vigo/i.test(rawText)
      ) {
        rawText = rawText
          .replace(/Image 27:[^\n]*/i, newImg27)
          .replace(/Clip 27\s*\([^)]*\):[^\n]*/i, newClip27);
      }
      if (
        /Image 35:[^\n]*heavy iron anchor/i.test(rawText) ||
        /Clip 35\s*\([^)]*\):[^\n]*anchor chain plunges/i.test(rawText)
      ) {
        rawText = rawText
          .replace(/Image 35:[^\n]*heavy iron anchor[^\n]*/i, newImg35)
          .replace(/Clip 35\s*\([^)]*\):[^\n]*anchor chain plunges[^\n]*/i, newClip35);
      }
      if (
        /Image 42:[^\n]*/i.test(rawText) &&
        (!/Image 42:[^\n]*strictly an empty architectural interior with zero people/i.test(rawText) ||
          /Clip 42\s*\([^)]*\):[^\n]*steam autoclave/i.test(rawText))
      ) {
        rawText = rawText
          .replace(/Image 42:[^\n]*/i, newImg42)
          .replace(/Clip 42\s*\([^)]*\):[^\n]*/i, newClip42);
      }
      if (
        /Image 45:[^\n]*/i.test(rawText) &&
        !/Image 45:[^\n]*empty folding canvas cots/i.test(rawText)
      ) {
        rawText = rawText
          .replace(/Image 45:[^\n]*/i, newImg45)
          .replace(/Clip 45\s*\([^)]*\):[^\n]*/i, newClip45);
      }
      if (
        /Image 52:[^\n]*/i.test(rawText) &&
        !/Clip 52\s*\([^)]*\):[^\n]*smooth backward tracking dolly shot moving continuously ahead/i.test(
          rawText
        )
      ) {
        rawText = rawText
          .replace(/Image 52:[^\n]*/i, newImg52)
          .replace(/Clip 52\s*\([^)]*\):[^\n]*/i, newClip52);
      }
      if (
        /Image 55:[^\n]*/i.test(rawText) &&
        (!/Image 55:[^\n]*strictly no brooms or tools in anyone's hands/i.test(rawText) ||
          /Clip 55\s*\([^)]*\):[^\n]*hands a broom/i.test(rawText))
      ) {
        rawText = rawText
          .replace(/Image 55:[^\n]*/i, newImg55)
          .replace(/Clip 55\s*\([^)]*\):[^\n]*/i, newClip55);
      }
      if (
        /Image 58:[^\n]*/i.test(rawText) &&
        !/Image 58:[^\n]*pushing open the tall wooden window shutters at 5 AM/i.test(rawText)
      ) {
        rawText = rawText
          .replace(/Image 58:[^\n]*/i, newImg58)
          .replace(/Clip 58\s*\([^)]*\):[^\n]*/i, newClip58);
      }
      if (
        /Image 59:[^\n]*/i.test(rawText) &&
        (!/Image 59:[^\n]*steaming porcelain cup of dark coffee/i.test(rawText) ||
          /Clip 59\s*\([^)]*\):[^\n]*slides the heavy iron bolt/i.test(rawText))
      ) {
        rawText = rawText
          .replace(/Image 59:[^\n]*/i, newImg59)
          .replace(/Clip 59\s*\([^)]*\):[^\n]*/i, newClip59);
      }
      if (
        /Image 60:[^\n]*unrolling a straw petate mat/i.test(rawText) ||
        /Clip 60\s*\([^)]*\):[^\n]*unrolls his straw mat/i.test(rawText)
      ) {
        rawText = rawText
          .replace(/Image 60:[^\n]*/i, newImg60)
          .replace(/Clip 60\s*\([^)]*\):[^\n]*/i, newClip60);
      }
      if (
        /Image 72:[^\n]*/i.test(rawText) &&
        !/Clip 72\s*\([^)]*\):[^\n]*walks slowly and steadily away from the camera/i.test(rawText)
      ) {
        rawText = rawText
          .replace(/Image 72:[^\n]*/i, newImg72)
          .replace(/Clip 72\s*\([^)]*\):[^\n]*/i, newClip72);
      }
      if (
        /Image 76:[^\n]*(?:period historical artifact|Sinaia deck)/i.test(rawText) ||
        /Clip 76\s*\([^)]*\):[^\n]*Pedro Garfias Zurita/i.test(rawText)
      ) {
        rawText = rawText
          .replace(/Image 76:[^\n]*/i, newImg76)
          .replace(/Clip 76\s*\([^)]*\):[^\n]*/i, newClip76);
      }
      nextRawClipsText = rawText;
    }
  }

  let nextClip1Line1 = normalizeClip1Line1Format(doc.clip1Line1LocationTime || '');
  let nextClip1Line2 = doc.clip1Line2Hook || '';
  let nextClip1OptionsRaw = doc.clip1OptionsRaw || '';

  if (isVideo76Exodo) {
    const defaultV76Options = `Opción 1:
Línea 1: Santander, España, Año 1885
Línea 2: EL ÉXODO DE 3 MILLONES DE ESPAÑOLES QUE TRANSFORMÓ AMÉRICA

Opción 2:
Línea 1: La Habana y Veracruz, Siglo XIX
Línea 2: LA CRUDA VERDAD DETRÁS DEL SUEÑO ESPAÑOL DE HACER LA AMÉRICA

Opción 3:
Línea 1: Puertos del Atlántico, Año 1885
Línea 2: DE HUIR DE LA GUERRA EN ESPAÑA A LEVANTAR UN IMPERIO EN AMÉRICA`;

    const hasRevealingThemeInHook =
      /éxodo|exodo|españoles|espanoles|hacer la américa|hacer la america|emigrantes|3 millones/i.test(
        nextClip1Line2
      );
    if (!nextClip1Line1 || !/\b(?:Año|Siglo)\b/.test(nextClip1Line1)) {
      nextClip1Line1 = 'Santander, España, Año 1885';
    }
    if (!nextClip1Line2 || !hasRevealingThemeInHook) {
      nextClip1Line2 = 'EL ÉXODO DE 3 MILLONES DE ESPAÑOLES QUE TRANSFORMÓ AMÉRICA';
    }
    if (
      !nextClip1OptionsRaw ||
      !/Santander,\s*España,\s*Año\s*1885/i.test(nextClip1OptionsRaw)
    ) {
      nextClip1OptionsRaw = defaultV76Options;
    }
  }

  let nextConfirmedFinalDuration = doc.confirmedFinalDuration;
  let nextSunoTracks = doc.sunoTracks;

  if (isVideo76Exodo) {
    if (!nextConfirmedFinalDuration || nextConfirmedFinalDuration === '02:00') {
      nextConfirmedFinalDuration = '13:26';
    }
    if (
      !Array.isArray(nextSunoTracks) ||
      nextSunoTracks.length <= 3 ||
      nextSunoTracks.some((t: any) => String(t?.videoTimeRange || '').includes('13:26'))
    ) {
      nextSunoTracks = [
        {
          id: 'flowmusic-v76-track-1',
          trackNumber: 1,
          title: 'El Muelle de la Despedida (Santander y Asturias, 1885)',
          duration: '2:04',
          videoTimeRange: '00:08 - 02:12 (Clip 1 al Clip 14)',
          lyricsPrompt:
            '[Instrumental]\n[00:00 Soft 2.5s Fade-In Intro]\n[Melancholic Spanish Acoustic Guitar & Cello Underscore Below Narrator Voice]\n[Subtle Atlantic Fog Tension]\n[Gentle 3s Fade-Out Outro]\n[End - 2:04]',
          stylePrompt:
            'Cinematic historical documentary score, 19th century northern Spain farewell atmosphere, solo nylon-string Spanish guitar, mournful cello, soft distant Galician-Asturian woodwind drone, slow tempo 62 bpm, smooth 2.5-second fade-in intro, gentle 3-second fade-out outro, mixed as warm low-mid frequency documentary underscore designed to sit softly below a deep male narrator voice without competing in the 1kHz-4kHz vocal clarity range, 100% instrumental, strictly no vocals, no singing, no spoken words',
          explanation:
            'Acompaña el Hook en el muelle de Santander y el desgarro de las aldeas del norte ante la redención en metálico de 2 mil pesetas. Se apaga con Fade-Out dejando un espacio sin música de 40s.',
          isGenerated: false,
        },
        {
          id: 'flowmusic-v76-track-2',
          trackNumber: 2,
          title: 'Las Entrañas del Vapor Transatlántico',
          duration: '2:04',
          videoTimeRange: '02:52 - 04:56 (Clip 18 al Clip 30)',
          lyricsPrompt:
            '[Instrumental]\n[00:00 Soft 2.5s Fade-In Intro]\n[Dark Low Strings & Subdued Maritime Pulse Below Voice]\n[Deep Ocean Crossing Suspense]\n[Gentle 3s Fade-Out Outro]\n[End - 2:04]',
          stylePrompt:
            'Dark cinematic orchestral documentary underscore, late 19th century transatlantic steamship crossing in steerage, deep double bass, tremolo violas, muted French horn, subtle deep heartbeat percussion, slow-mid tempo 66 bpm, smooth 2.5-second fade-in intro, gentle 3-second fade-out outro, warm low-mid frequency documentary mix sitting softly underneath narrator voice, 100% instrumental, strictly no vocals, no singing, no lyrics',
          explanation:
            'Entra tras 40s sin música para acompañar el pasaje de tercera clase, las literas de hierro del entrepuente y la travesía oceánica.',
          isGenerated: false,
        },
        {
          id: 'flowmusic-v76-track-3',
          trackNumber: 3,
          title: 'Cuarentena en Triscornia y Muelles de Veracruz',
          duration: '2:04',
          videoTimeRange: '05:36 - 07:40 (Clip 34 al Clip 45)',
          lyricsPrompt:
            '[Instrumental]\n[00:00 Soft 2.5s Fade-In Intro]\n[Warm Tropical Noir Strings & Subtle Harp Underscore]\n[Solemn Arrival & Uncertainty]\n[Gentle 3s Fade-Out Outro]\n[End - 2:04]',
          stylePrompt:
            'Atmospheric historical documentary film score, turn-of-the-century Havana and Veracruz harbor arrival, chamber strings, solo classical guitar, warm bassoon, delicate harp harmonics, slow contemplative tempo 64 bpm, smooth 2.5-second fade-in intro, gentle 3-second fade-out outro, mixed as warm low-mid frequency underscore below narrator voice without vocal range clash, 100% instrumental, strictly no vocals, no singing',
          explanation:
            'Entra tras 40s sin música y acompaña la llegada al trópico, el campamento de cuarentena de Triscornia y el desembarco en Veracruz.',
          isGenerated: false,
        },
        {
          id: 'flowmusic-v76-track-4',
          trackNumber: 4,
          title: 'Dieciséis Horas Detrás del Mostrador',
          duration: '2:04',
          videoTimeRange: '08:20 - 10:24 (Clip 49 al Clip 59)',
          lyricsPrompt:
            '[Instrumental]\n[00:00 Soft 2.5s Fade-In Intro]\n[Intimate Piano & Solo Cello Documentary Underscore]\n[Quiet Perseverance & Solitude]\n[Gentle 3s Fade-Out Outro]\n[End - 2:04]',
          stylePrompt:
            'Intimate minimalist historical documentary score, early 20th century immigrant clerk working in dim wooden store, felt piano, warm solo cello, soft upright bass pizzicato, slow reflective tempo 60 bpm, smooth 2.5-second fade-in intro, gentle 3-second fade-out outro, warm low-mid frequency documentary underscore mixed softly underneath narrator voice, 100% instrumental, strictly no vocals, no singing',
          explanation:
            'Entra tras 40s sin música y retrata la dura realidad del dependiente durmiendo sobre el mostrador de cedro y las jornadas de 16 horas.',
          isGenerated: false,
        },
        {
          id: 'flowmusic-v76-track-5',
          trackNumber: 5,
          title: 'Palacios de Piedra y Escuelas de Indianos',
          duration: '2:00',
          videoTimeRange: '11:04 - 13:04 (Clip 63 al Clip 72)',
          lyricsPrompt:
            '[Instrumental]\n[00:00 Soft 2.5s Fade-In Intro]\n[Noble Chamber Orchestra & Classical Guitar Underscore]\n[Dignified Historical Transformation]\n[Gentle 3s Fade-Out Outro]\n[End - 2:00]',
          stylePrompt:
            'Noble cinematic documentary orchestral score, early 20th century mutual aid palaces and rural schools in Spain, warm string ensemble, classical Spanish guitar arpeggios, soft oboe, dignified tempo 68 bpm, smooth 2.5-second fade-in intro, gentle 3-second fade-out outro, warm low-mid frequency documentary underscore sitting softly below narrator voice, 100% instrumental, strictly no vocals, no singing',
          explanation:
            'Entra tras 40s sin música y acompaña el auge de los centros regionales, hospitales, remesas y las 500 escuelas financiadas en el norte de España.',
          isGenerated: false,
        },
        {
          id: 'flowmusic-v76-track-6',
          trackNumber: 6,
          title: 'La Sangre de Dos Orillas (Cierre Documental)',
          duration: '1:30',
          videoTimeRange: '13:44 - 15:14 (Clip 75 hasta el final del Clip 82 antes del Outro)',
          lyricsPrompt:
            '[Instrumental]\n[00:00 Soft 2.5s Fade-In Intro]\n[Emotional Cello & Spanish Guitar Finale Below Narrator Voice]\n[01:05 Sweeping Cinematic Resolution]\n[01:25 Gentle 3s Fade-Out Outro]\n[End - 1:30]',
          stylePrompt:
            'Sweeping emotional historical documentary finale score, 1 minute 30 seconds duration, poignant solo cello, expressive Spanish acoustic guitar, warm orchestral strings, timeless Atlantic horizon atmosphere, slow noble tempo 64 bpm, smooth 2.5-second fade-in intro, gentle 3-second fade-out outro, mixed as warm low-mid frequency documentary underscore below narrator voice rising gently in the final seconds, 100% instrumental, strictly no vocals, no singing, no spoken words',
          explanation:
            'Entra tras 40s sin música: última canción obligatoria de 1:30 que llega exactamente hasta el final del Clip 82 justo antes del Outro oficial de 8s.',
          isGenerated: false,
        },
      ];
    }
  }

  let nextCorrectedSrt = doc.correctedSrt;
  if (
    typeof nextCorrectedSrt === 'string' &&
    (/\[pausa/i.test(nextCorrectedSrt) || /^1\s*\r?\n00:00:00[,.]000/m.test(nextCorrectedSrt))
  ) {
    nextCorrectedSrt = '';
  }

  const isLegacySingleEngineDoc =
    !doc.operationalHeader?.includes('donde haya personas') &&
    !(Array.isArray( nextClips ) && nextClips.some((c) => /\[Model:/i.test(c.videoPrompt || '')));

  const nextFlowVideoEngine: 'HYBRID_PEOPLE_OMNI_REST_LOWER' | 'VEO_3_1_LITE_LOWER_PRIORITY' | 'OMNI_1_1_FLASH' =
    isLegacySingleEngineDoc
      ? 'HYBRID_PEOPLE_OMNI_REST_LOWER'
      : doc.flowVideoEngine || 'HYBRID_PEOPLE_OMNI_REST_LOWER';

  const normalizeEngineRefs = (text?: string): string => {
    if (typeof text !== 'string' || !text) return text || '';
    if (nextFlowVideoEngine === 'HYBRID_PEOPLE_OMNI_REST_LOWER') {
      return text.replace(
        /Usa\s+(?:omni\s*(?:1\.1\s*)?flash(?:\s+únicamente\s+para\s+los\s+clips\s+de\s+video\s+donde\s+haya\s+personas\s+y\s+usa\s+veo\s*3\.1\s*-\s*lite\s*\[lower\s*priority\]\s+para\s+el\s+resto\s+de\s+los\s+clips\s+de\s+video\s+sin\s+personas)?|veo\s*3\.1(?:\s*-\s*lite\s*\[lower\s*priority\])?|lower\s*priority)\s+para\s+videos/gi,
        'Usa Omni 1.1 Flash únicamente para los clips de video donde haya personas y usa Veo 3.1 - Lite [Lower Priority] para el resto de los clips de video sin personas'
      );
    }
    if (nextFlowVideoEngine === 'OMNI_1_1_FLASH') {
      return text.replace(
        /Usa\s+(?:omni\s*(?:1\.1\s*)?flash(?:\s+únicamente\s+para\s+los\s+clips\s+de\s+video\s+donde\s+haya\s+personas\s+y\s+usa\s+veo\s*3\.1\s*-\s*lite\s*\[lower\s*priority\]\s+para\s+el\s+resto\s+de\s+los\s+clips\s+de\s+video\s+sin\s+personas)?|(?:veo\s*3\.1(?:\s*-\s*lite\s*\[lower\s*priority\])?|lower\s*priority)\s+para\s+videos)/gi,
        'Usa Omni 1.1 Flash para videos'
      );
    }
    return text.replace(
      /Usa\s+(?:omni\s*(?:1\.1\s*)?flash(?:\s+únicamente\s+para\s+los\s+clips\s+de\s+video\s+donde\s+haya\s+personas\s+y\s+usa\s+veo\s*3\.1\s*-\s*lite\s*\[lower\s*priority\]\s+para\s+el\s+resto\s+de\s+los\s+clips\s+de\s+video\s+sin\s+personas)?|(?:omni\s*(?:1\.1\s*)?flash|veo\s*3\.1(?:\s*-\s*lite\s*\[lower\s*priority\])?|lower\s*priority)\s+para\s+videos)/gi,
      'Usa Veo 3.1 - Lite [Lower Priority] para videos'
    );
  };

  if (Array.isArray(nextClips) && nextClips.length > 0) {
    let anyClipTagChanged = false;
    const taggedClips = nextClips.map((c) => {
      if (!c.videoPrompt) return c;
      const resolvedEngine = resolveClipFlowVideoEngine(c, nextFlowVideoEngine);
      const taggedPrompt = applyClipFlowVideoEngineTag(c.videoPrompt, resolvedEngine);
      if (taggedPrompt !== c.videoPrompt) {
        anyClipTagChanged = true;
        return { ...c, videoPrompt: taggedPrompt };
      }
      return c;
    });
    if (anyClipTagChanged) {
      nextClips = taggedClips;
    }
  }

  const nextOperationalHeader = sanitizeOperationalHeader(
    normalizeEngineRefs(doc.operationalHeader || DEFAULT_OPERATIONAL_HEADER),
    nextFlowVideoEngine
  );
  nextRawClipsText = nextRawClipsText?.trim()
    ? ensureOperationalHeaderInRawClips(normalizeEngineRefs(nextRawClipsText), nextOperationalHeader)
    : nextRawClipsText;
  const nextRawReferencePrompts = doc.rawReferencePrompts || '';
  const nextCompiledMasterPrompt = normalizeEngineRefs(doc.compiledMasterPrompt);
  const isVideo77Doc =
    doc.id === 'doc-video-77-huellas' || /^Video\s*77\b/i.test(String(doc.title || '').trim());
  const hasCauchoStaleData =
    String(doc.topic || '').includes('Imperio del Caucho') ||
    String(doc.promptConfig?.TEMA_VIDEO || '').includes('Imperio del Caucho');
  const needsV77MultiUpdate =
    isVideo77Doc &&
    (hasCauchoStaleData || doc.promptConfig?.V77_MULTI_PASO1_UPDATED !== '2026_11_09_PENICILINA_PEPSI_SYNCED');

  if (needsV77MultiUpdate) {
    const p1Opts = [
      'Tipología #9 (Nueva Tipología Arquetípica Universal #1 - Patrón Central): Crónica de colapsos repetidos, rechazos del monopolio dominante y resurrección histórica contra todo pronóstico (El Patrón del Hallazgo Despreciado que Cambió el Mundo).',
      'Tipología #10 (Nueva Tipología Arquetípica Universal #2 - Patrón de Apertura/Crisis): El instante de liquidación total donde años de esfuerzo se pierden en segundos por un cuello de botella material o logístico.',
      'Tipología #11 (Nueva Tipología Arquetípica Universal #3 - Patrón de Rivalidad/Secreto): La ceguera institucional de los imperios establecidos que rechazan tres veces la innovación nacida en la escasez y el secreto oculto a plena vista.',
      'Tipología #1 del Protocolo (Un suceso histórico): La carrera contrarreloj de 1928 a 1945 para transformar un hongo inestable de laboratorio en el salvavidas industrial de la Segunda Guerra Mundial.',
      'Tipología #2 del Protocolo (Un lugar histórico): Del desordenado sótano del Hospital St. Mary en Londres y la Enfermería Radcliffe en Oxford a los tanques de fermentación de Peoria.',
      'Tipología #3 del Protocolo (Un personaje): El contraste psicológico entre el bacteriólogo solitario Alexander Fleming y el equipo de rescate de Howard Florey, Ernst Chain y Norman Heatley.',
      'Tipología #4 del Protocolo (Un misterio sin resolver / Azar histórico): La anomalía estadística de la ventana entreabierta de 1928 y la espora exacta que disolvió las bacterias estafilococos.',
      'Tipología #5 del Protocolo (Un true crime / Negligencia histórica): La tragedia evitable de los doce años de indiferencia burocrática en los que millones de pacientes perecieron teniendo la cura publicada en un boletín.',
      'Tipología #6 del Protocolo (Una conciencia o realidad colectiva): La vida cotidiana de los trabajadores y soldados antes de los antibióticos, cuando un rasguño con una espina de rosa equivalía a una sentencia letal.',
      'Tipología #7 del Protocolo (Una manipulación psicológica / Dogma): Cómo el dogma médico de las vacunas desestimó durante más de una década el poder químico del moho.',
      'Tipología #8 del Protocolo (Una curiosidad): Los métodos insólitos de supervivencia científica: cultivar medicina en bacinillas de porcelana, reciclar el fármaco de la orina de los enfermos y ocultar esporas en las costuras de los abrigos.',
    ];
    const p2Opts = [
      '(Tema Central Principal — Fórmula Exacta "2 Caídas y 3 Rechazos" en La Penicilina): La Penicilina: Abandonada 2 veces en el olvido, rechazada 3 veces por los gigantes médicos y farmacéuticos… y así venció a la muerte en la Segunda Guerra Mundial. Cubre el hallazgo fortuito de 1928, el abandono de 1929, la muerte del primer paciente en 1941 al agotarse la dosis, las 3 negativas británicas de escalado y la explosión industrial en Estados Unidos y Latinoamérica.',
      '(Variante de La Penicilina — Escasez Extrema y Supervivencia Humana): El Oro Líquido Reciclado de la Orina y las Bacinillas de Oxford. Cómo cuatro científicos sin fondos cultivaron el moho salvador en latas de galletas bajo los bombardeos de 1940, viendo morir a su primer paciente tras filtrar cada gota de su orina por falta de apoyo industrial.',
      '(Variante de La Penicilina — Secreto, Contrabando y Guerra Industrial): Las Esporas en el Abrigo y el Melón Podrido de Peoria. La misión secreta de 1941 para cruzar el Atlántico con el hongo impregnado en la ropa por temor a los submarinos alemanes y cómo un melón de mercado en Illinois multiplicó por millones un fármaco que nadie sabía producir.',
      '(Variante de La Penicilina — Ceguera y Complacencia Institucional): Doce Años en un Estante Polvoriento. La autopsia de cómo los mayores sabios del Medical Research Council ignoraron en 1929 el descubrimiento de Alexander Fleming, demostrando que la complacencia académica es el peor enemigo del progreso humano.',
      '(Variante de La Penicilina — Impacto Global y Huella en Hispanoamérica): De las Trincheras de Normandía a los Hospitales de La Habana, México y el Río de la Plata. Cómo la producción masiva de 650 mil millones de unidades mensuales salvó a los soldados aliados en 1944 y transformó la vida de las familias trabajadoras y migrantes en América Latina.',
      '(Variante de La Penicilina — Paradoja Moral y Profecía Científica): El Regalo sin Patente y la Advertencia Ignorada de 1945. Por qué los creadores renunciaron a una fortuna multimillonaria para entregar la penicilina a la humanidad y cómo el propio Fleming profetizó que la soberbia humana crearía bacterias indestructibles.',
      '(Tema Histórico Alternativo Original #1 — Hazaña de Salvamento): La Radio y el Telégrafo Inalámbrico: Destruida 2 veces por las tormentas, rechazada 3 veces por el gobierno y los físicos… y así salvó a 712 sobrevivientes del Titanic en alta mar. El rechazo oficial a Marconi en Italia y las antenas derribadas antes de salvar vidas en el Atlántico Norte.',
      '(Tema Histórico Alternativo Original #2 — Imperio Extractivo Olvidado): El Imperio del Caucho en el Amazonas: Quebró 2 veces, fue saboteado por 3 potencias y levantó una metrópoli europea en medio de la selva antes de colapsar. El auge de los barones del caucho, el robo de 70 mil semillas y la liquidación frente a las plantaciones asiáticas.',
    ];
    const p3Opts = [
      '(Arco Integral de 17 Años de La Penicilina — Recomendada): Años 1928 a 1945, Siglo XX (Desde el hallazgo del 28 de septiembre de 1928 en Londres hasta el triunfo global y el Nobel de 1945).',
      '(Anclaje In Media Res en el Punto de Quiebre): Año 1941, Siglo XX (Con retrospectiva a 1928 y proyección a 1945; anclado en el 15 de marzo de 1941, día en que se agota el fármaco y fallece el primer paciente en Oxford).',
      '(Anclaje en el Descubrimiento y Primer Rechazo): Años 1928 a 1929, Siglo XX (Con expansión hacia la Segunda Guerra Mundial en 1940–1944).',
      '(Arco de Crisis Bélica e Industrialización): Años 1939 a 1944, Siglo XX (Del inicio del Blitz sobre Inglaterra al desembarco de Normandía en junio de 1944).',
      '(Arco de Larga Duración Médica): Años 1914 a 1945, Siglo XX (Desde el trauma de Fleming viendo soldados sucumbir a la sepsis en la Primera Guerra Mundial hasta la victoria antibiótica de 1945).',
      '(Arco de Posguerra y Expansión Internacional): Años 1928 a 1950, Siglo XX (Incluyendo la llegada masiva del antibiótico a las boticas y clínicas de Cuba, México y Sudamérica).',
      '(Época concordante con Alternativa #1 - La Radio): Años 1895 a 1912, Siglos XIX y XX (De los primeros experimentos en Bolonia al rescate en el Atlántico en 1912).',
      '(Época concordante con Alternativa #2 - Imperio del Caucho): Años 1879 a 1912, Finales del Siglo XIX y principios del Siglo XX (Arco de 33 años de fiebre extractiva y colapso).',
    ];
    const p4Opts = [
      '(Ruta Principal Completa de La Penicilina — Recomendada): Londres y Oxford, Inglaterra (Con conexión industrial a Peoria, Estados Unidos y eco hospitalario en La Habana, Cuba, México y el Río de la Plata).',
      '(Epicentro del Hallazgo): Hospital St. Mary, Londres, Inglaterra.',
      '(Epicentro de la Crisis Clínica): Enfermería Radcliffe, Oxford, Inglaterra.',
      '(Epicentro del Escalado Industrial): Peoria y Nueva York, Estados Unidos.',
      '(Escenario de Prueba de Fuego Bélica): Playas de Normandía, Francia (En conexión con Londres, Inglaterra y Peoria, Estados Unidos).',
      '(Ruta Transatlántica e Hispanoamericana): Londres, Inglaterra — Peoria, Estados Unidos — La Habana, Cuba — Montevideo, Uruguay.',
      '(Lugar concordante con Alternativa #1 - La Radio): Bolonia, Italia y Cornualles, Inglaterra (Con desenlace en el Atlántico Norte).',
      '(Lugar concordante con Alternativa #2 - Imperio del Caucho): Manaos y Belém do Pará, Brasil / Iquitos, Perú (Con conexión a Londres, Inglaterra).',
    ];
    const p5Opts = [
      '(El Equivalente al Golpe de Mazo: El Frasco Vacío de 1941 — Recomendada): 00:08 - 00:16 (Clip 1 mudo): En la penumbra de la Enfermería Radcliffe, las manos temblorosas de un médico apoyan con un golpe seco el último frasco de vidrio vacío sobre la mesa metálica mientras, al fondo, una sábana blanca cubre el lecho del policía Albert Alexander. 00:16 (Voz): "Año 1941, hospital de Oxford, Inglaterra. Por la falta de apenas unos miligramos de polvo amarillo, el primer ser humano rescatado de una infección letal acababa de recaer y perder la vida." La contradicción de cómo la mayor cura de la humanidad estuvo doce años abandonada en un estante.',
      '(El Silencio de la Sala Médica — 1929): 00:08 - 00:16 (Clip 1 mudo): Alexander Fleming termina su exposición frente al Medical Research Council; ningún médico en la sala de caoba levanta la vista mientras recogen sus papeles en absoluto silencio. 00:16 (Voz): "Año 1929, salón médico de Londres, Inglaterra. En menos de quince minutos de indiferencia, la élite científica británica archivó en el olvido la fórmula que habría salvado millones de vidas".',
      '(La Placa al Borde del Desinfectante — 1928): 00:08 - 00:16 (Clip 1 mudo): Plano macro de las pinzas de latón de Fleming deteniéndose a un milímetro de sumergir la caja de Petri con el moho verdoso en una bandeja de ácido antiséptico. 00:16 (Voz): "Año 1928, Hospital St. Mary, Londres, Inglaterra. Una ventana mal cerrada y una pila de platos sucios olvidados durante las vacaciones estaban a un segundo de ser destruidos para siempre".',
      '(El Contrabando en las Costuras de Lana — 1941): 00:08 - 00:16 (Clip 1 mudo): En un laboratorio a oscuras bajo el sonido distante de sirenas antiaéreas, dos científicos frotan líquido marrón con esporas de moho dentro del forro de sus abrigos antes de abordar un vuelo nocturno. 00:16 (Voz): "Año 1941, laboratorio de Oxford, Inglaterra. Rechazados tres veces por la industria de su propio país, dos investigadores ocultaron en su ropa el único cultivo capaz de cambiar el rumbo de la guerra".',
      '(El Filtro de Orina Desesperado — 1941): 00:08 - 00:16 (Clip 1 mudo): Norman Heatley pedalea bajo la lluvia nocturna de Oxford cargando frascos de vidrio con orina de hospital para extraer en el laboratorio los últimos rastros de penicilina. 00:16 (Voz): "Año 1941, calles de Oxford, Inglaterra. Cuando los grandes laboratorios les cerraron las puertas, la única forma de mantener vivo a un paciente fue reciclar el medicamento gota a gota de su propio cuerpo".',
      '(El Melón de Dos Dólares que Valía un Imperio — 1943): 00:08 - 00:16 (Clip 1 mudo): Sobre una mesa de acero en Illinois, un bisturí raspa la cicatriz dorada de un melón podrido recién traído de un mercado de barrio. 00:16 (Voz): "Año 1943, laboratorio de Peoria, Estados Unidos. Lo que tres potencias científicas no lograron fabricar en quince años estaba oculto en la cáscara mohosa de una fruta de mercado".',
    ];
    const p6Opts = [
      '(Escaleta Espejo Exacta del Video Guía en 6 Bloques — Recomendada): Intro Oficial (00:00 - 00:08 | 1 clip) + Clip 1 Hook Mudo (00:08 - 00:16 | 1 clip) · Bloque 1 (00:16 - 02:32 | 17 clips | 11.3%): El colapso de Oxford en 1941 (el frasco vacío y la pérdida de Albert Alexander), Slogan Completo en la mesa del historiador antiguo (00:24–00:32) y la incógnita de por qué se perdieron 12 años · Bloque 2 (02:32 - 06:08 | 27 clips | 18.0%): Londres, 1928–1929. El desorden de Fleming en St. Mary, la espora accidental, la inestabilidad química y el 1.er Abandono tras la fría recepción del club médico · Bloque 3 (06:08 - 10:08 | 30 clips | 20.0%): Oxford, 1939–1941. Florey, Chain y Heatley rescatan el papel olvidado en plena guerra; cultivo en bacinillas y latas; el 2.º Colapso al agotarse el fármaco reciclado de la orina en el primer paciente humano · Bloque 4 (10:08 - 14:08 | 30 clips | 20.0%): Los 3 Rechazos de financiación y escalado industrial en Gran Bretaña; el viaje con esporas en los abrigos a Estados Unidos; el licor de maíz y el melón dorado de Mary Hunt en Peoria (1941–1943) · Bloque 5 (14:08 - 17:44 | 27 clips | 18.0%): La explosión de los tanques de fermentación profunda (Pfizer/Merck); el milagro en las playas de Normandía en 1944 y la llegada a las boticas de La Habana, México y el Río de la Plata · Bloque 6 (17:44 - 19:52 | 16 clips | 10.7%) + Outro (19:52 - 20:00 | 1 clip): El Nobel de 1945, la renuncia a las patentes personales, la advertencia profética de Fleming contra la complacencia y Slogan Corto en plano panorámico amplio.',
      '(Escaleta de Micro-Crisis y Cuellos de Botella Encadenados — 1200s): Inspirada en la matriz de cuellos de botella en cadena: 13 bloques de 90 segundos donde cada solución técnica abre un problema mayor (descubrir el moho → no poder purificarlo → purificarlo pero no tener envases → curar pero quedarse sin dosis → fermentar en masa).',
      '(Escaleta Forense de las 3 Negativas y 2 Muertes — 1200s): Estructura en 5 actos centrada en el contraste entre los despachos burocráticos que negaron los recursos tres veces y las salas de hospital donde se libraba la batalla minuto a minuto.',
      '(Escaleta Biográfica Coral de los 4 Olvidados — 1200s): Divide los 20 minutos en los cuatro relevos humanos: Fleming en Londres (25%), Chain y Florey en Oxford (25%), Heatley en el diseño de extracción (25%) y Mary Hunt en los mercados de Illinois (25%).',
      '(Escaleta Cronológica Lineal de Supervivencia — 1200s): Inicia en las trincheras infectadas de la Primera Guerra Mundial que traumatizaron a Fleming en 1914 y avanza cronológicamente hasta los hospitales de posguerra en 1945.',
      '(Escaleta de Duelo Científico-Industrial Geopolítico — 1200s): Enfocada en la carrera secreta entre los laboratorios aliados y los científicos del Eje por dominar el primer antibiótico masivo antes del Día D.',
    ];
    const p7Opts = [
      '(La Profecía de Fleming contra la Complacencia Humana — Recomendada): Tras mostrar cómo millones de soldados y trabajadores en Nueva York, La Habana, México y Sudamérica salvaron sus vidas en 1945, revelamos el discurso de Fleming advirtiendo que la soberbia y el abuso de su invento despertarían superbacterias resistentes; cierra con "Cada historia deja una huella. Aquí seguimos sus rastros." en plano panorámico del viejo laboratorio de Londres al atardecer.',
      '(El Contraste del Frasco Vacío y los 200 Millones de Salvados): Contraposición emocional entre aquel frasco vacío de Oxford que no alcanzó para salvar al policía Albert Alexander en 1941 y los buques cargados con millones de ampollas en el Día D, respondiendo quiénes sobrevivieron gracias a que cuatro investigadores se negaron a rendirse.',
      '(El Héroe Silencioso de las Costuras Manchadas): Revelación del destino de Norman Heatley y de cómo los creadores rechazaron enriquecerse con la patente para que cualquier hospital de barrio o bodega farmacéutica del mundo pudiera fabricarla a centavos.',
      '(La Huella en la Vida Cotidiana Pre-Digital): Cierre nostálgico sobre cómo cambió la supervivencia de las familias trabajadoras y migrantes del siglo XX cuando la neumonía y las infecciones dejaron de vaciar hogares enteros, culminando con la pregunta reflexiva a la audiencia.',
      '(El Veredicto de las Actas Olvidadas): Contraste visual entre el boletín médico de 1929 que nadie leyó en Londres y las estadísticas globales de esperanza de vida duplicada a mediados del siglo XX, advirtiendo cómo tres negativas nacidas de la soberbia casi privan a la humanidad de su mayor escudo biológico.',
      '(La Paradoja del Mercado de Illinois): Reflexión final sobre cómo el remedio que la élite académica de Europa buscó en vano durante tres lustros terminó apareciendo en la fruta podrida de una trabajadora anónima en Estados Unidos, cerrando en panorámica amplia de los campos y factorías al crepúsculo.',
    ];
    const combinedTypology = `${p1Opts[0]} + ${p1Opts[3]} + ${p1Opts[10]}`;
    const v77Paso1Report = [
      '0. RESUMEN POR PARTES DE LA PROPOSICIÓN PARA NUESTRO DOCUMENTAL ORIGINAL (MÚLTIPLES OPCIONES SEGÚN LOS PATRONES DEL VIDEO ANALIZADO)',
      'PARTE 1 — TIPOLOGÍA DEL VIDEO (ETAPA 1 DEL PROTOCOLO — PERMITE SELECCIONAR VARIAS OPCIONES)',
      'Resumen de esta parte: El video guía se viralizó combinando el arquetipo psicológico del underdog con una doble simetría numérica de catástrofes ("2 caídas / 3 rechazos"), una apertura in media res donde décadas de esfuerzo se esfuman en un instante ante la indiferencia de una sala, y la premisa de que la complacencia destruye a los gigantes.',
      ...p1Opts.map((o, idx) => `Opción ${idx + 1}: ${o}`),
      'PARTE 2 — TEMA CENTRAL DEL DOCUMENTAL / EPISODIO',
      'Resumen de esta parte: Aplicamos la fórmula de impacto, contraste numérico ("2 caídas / 3 rechazos") y tensión dramática del video guía a nuestro tema central (La Penicilina) desglosado en múltiples ángulos maestros y alternativas históricas 100% originales para "Huellas de la Humanidad":',
      ...p2Opts.map((o, idx) => `Opción ${idx + 1}: ${o}`),
      'PARTE 3 — TIEMPO / ÉPOCA HISTÓRICA (AÑOS EN DÍGITOS O SIGLO EN ROMANOS — EN CONCORDANCIA DIRECTA CON PARTES 1 Y 2)',
      'Resumen de esta parte: Marcos cronológicos precisos en dígitos y números romanos que replican el arco de décadas de lucha, colapso y victoria tardía del video guía, vinculados al tema central de La Penicilina y a las opciones de la Parte 2:',
      ...p3Opts.map((o, idx) => `Opción ${idx + 1}: ${o}`),
      'PARTE 4 — LUGAR HISTÓRICO (CIUDAD, PAÍS — EN CONCORDANCIA DIRECTA CON PARTES 1 Y 2)',
      'Resumen de esta parte: Escenarios con alta densidad sensorial (vidrio soplado, hollín de Londres, ladrillo gótico de Oxford, mercados agrícolas y hospitales), conectando con los intereses geográficos de la audiencia y concordantes con la Parte 2:',
      ...p4Opts.map((o, idx) => `Opción ${idx + 1}: ${o}`),
      'PARTE 5 — GANCHO INICIAL Y CONTRADICCIÓN / ÁNGULO CENTRAL (CLIP 1 + APERTURA)',
      'Resumen de esta parte: Adaptamos el patrón de los primeros 30 segundos del video guía: impacto visual mudo con puro diseño Foley en 00:08–00:16, entrada de voz en 00:16 con la Tríada Obligatoria (Tiempo, Ciudad, País) y cierre del primer sub-bloque en 00:24–00:32 con el Slogan Completo sobre la mesa del historiador antiguo:',
      ...p5Opts.map((o, idx) => `Opción ${idx + 1}: ${o}`),
      'PARTE 6 — CALIBRACIÓN MATEMÁTICA Y ESCALETA POR ACTOS (~20 MIN / 1200s)',
      'Resumen de esta parte: Trasladamos los porcentajes exactos del video guía a 1200 segundos (~20 minutos / 150 clips de 8s), con Intro fija (00:00–00:08), Clip 1 mudo (00:08–00:16), 1176 segundos de voz efectiva (17 mil 640 caracteres a 15 caracteres/s), Slogan Completo en la mesa del historiador (00:24–00:32), 13 micro-ganchos cada 90s y Outro fijo (19:52–20:00):',
      ...p6Opts.map((o, idx) => `Opción ${idx + 1}: ${o}`),
      'PARTE 7 — CLÍMAX HISTÓRICO, REVELACIÓN Y CIERRE REFLEXIVO',
      'Resumen de esta parte: Estrategias de desenlace hacia el minuto 19:52 que responden a los comentarios de la audiencia ("la complacencia es el verdadero enemigo" y "¿quiénes se salvaron?"), cerrando con pregunta a comentarios, Slogan Corto en párrafo aparte y plano panorámico amplio antes del Outro de 8s:',
      ...p7Opts.map((o, idx) => `Opción ${idx + 1}: ${o}`),
      '',
      '1. RADIOGRAFÍA DE PATRONES VIRALES DEL VIDEO INVESTIGADO (QUÉ HIZO QUE SE VIRALIZARA Y CÓMO LO USAMOS DE GUÍA)',
      '- 1. Estructura del Título: Simetría numérica de fracaso + Giro épico ("2 veces / 3 veces") aplicada a La Penicilina: 2 abandonos/colapsos críticos (1929 y 1941) y 3 rechazos institucionales/farmacéuticos antes de salvar a 200 millones de personas.',
      '- 2. Apertura de Descripción y Hook: 00:08–00:16: Sonido seco del último vial vacío sobre la mesa metálica en Oxford en 1941 (muerte de Albert Alexander por falta de miligramos) y la apatía del Medical Research Council en 1929 tras 12 años perdidos.',
      '- 3. Intención de Tags y Comentarios: Contraponemos a 4 investigadores sin fondos contra la muerte infecciosa, integrando la profecía de Fleming contra la complacencia, el rescate de soldados en Normandía y la llegada del fármaco a La Habana, México y el Río de la Plata.',
      '- 4. Porcentajes por Bloque (Escaleta): 150 clips de 8s (1200s / 20 min): Intro (1 clip) + Hook (1 clip) + Bloque 1 (17 clips) + Bloque 2 (27 clips) + Bloque 3 (30 clips) + Bloque 4 (30 clips) + Bloque 5 (27 clips) + Bloque 6 (16 clips) + Outro (1 clip).',
    ].join('\n');

    const updatedCfg: Record<string, string> = {
      ...(doc.promptConfig || {}),
      TIPO_PRODUCCION: doc.promptConfig?.TIPO_PRODUCCION || 'REELS',
      SUB_OPCION_POST: doc.promptConfig?.SUB_OPCION_POST || 'EXPECTATIVA_ESTRENO',
      SUB_OPCION_REELS: doc.promptConfig?.SUB_OPCION_REELS || '16X9',
      SINCRONIZACION_CLIP_1: doc.promptConfig?.SINCRONIZACION_CLIP_1 || 'NO_DETENER',
      TEXTO_PANTALLA_CLIP_1: doc.promptConfig?.TEXTO_PANTALLA_CLIP_1 || 'CAPCUT_MANUAL',
      DURACION_CLIP_1: doc.promptConfig?.DURACION_CLIP_1 || '8',
      DURACION_CLIPS: doc.promptConfig?.DURACION_CLIPS || '8_SEGUNDOS',
      DURACION_CLIPS_SEGUNDOS: doc.promptConfig?.DURACION_CLIPS_SEGUNDOS || '8',
      VOZ_NARRATIVA_EN_CLIPS: doc.promptConfig?.VOZ_NARRATIVA_EN_CLIPS || 'INCLUIR',
      UBICACION_INTRO_MARCA: 'INTRO_INICIO_00',
      STAGE1_PART1_COMPLETED: 'SI',
      SELECTED_ANALYZED_VIDEO_ID: 'r5Uh1uDxrvY',
      SELECTED_ANALYZED_VIDEO_CLEARED: 'NO',
      YOUTUBE_SELECTED_LIBRARY_LINK: 'https://youtu.be/r5Uh1uDxrvY?is=ePIGX6c5Lnc1KHh4',
      YOUTUBE_VIDEO_TITLE:
        'Pepsi: Se rompió 2 veces, fue rechazada 3 veces… y así nació la mayor rival de Coca-Cola',
      YOUTUBE_VIDEO_CHANNEL: 'Marca Cruda',
      YOUTUBE_VIDEO_DESCRIPTION:
        'El martillo golpeó la mesa y la historia de Pepsi cambió para siempre. Por solo 30,000 dólares, una empresa gigante fue vendida por completo.\n\nNadie en la sala levantó la vista mientras los abogados recogían los papeles. No era una liquidación común; era el fin de un imperio que llegó a tener más de 250 plantas operativas. Lo que se subastaba incluía la fórmula secreta, las instalaciones y el nombre mismo de una de las marcas icónicas más reconocidas del mundo. \n\nEste relato analiza los errores detrás de la quiebra de empresas que parecían indestructibles. Es la crónica de cómo un hombre perdió en un instante el trabajo de 30 años y por qué, en el mundo de los negocios fallidos, el éxito nunca está garantizado.\n\n🔔 Suscríbete para más historias de las marcas que cambiaron el mundo.',
      YOUTUBE_VIDEO_TAGS: 'pepsi cola, pepsi vs coca-cola, pepsi',
      ESTRUCTURA_VIRAL_TITULO:
        'Pepsi: Se rompió 2 veces, fue rechazada 3 veces… y así nació la mayor rival de Coca-Cola',
      ESTRUCTURA_VIRAL_RESUMEN:
        '📌 TÍTULO DEL VIDEO ANALIZADO: "Pepsi: Se rompió 2 veces, fue rechazada 3 veces… y así nació la mayor rival de Coca-Cola" (Canal: Marca Cruda)\n\n🏷️ TAGS Y PALABRAS CLAVE EXTRAÍDAS (3): pepsi cola, pepsi vs coca-cola, pepsi\n\n📝 DESCRIPCIÓN DEL VIDEO ANALIZADO:\nEl martillo golpeó la mesa y la historia de Pepsi cambió para siempre. Por solo 30,000 dólares, una empresa gigante fue vendida por completo.\n\nNadie en la sala levantó la vista mientras los abogados recogían los papeles. No era una liquidación común; era el fin de un imperio que llegó a tener más de 250 plantas operativas. Lo que se subastaba incluía la fórmula secreta, las instalaciones y el nombre mismo de una de las marcas icónicas más reconocidas del mundo. \n\nEste relato analiza los errores detrás de la quiebra de empresas que parecían indestructibles. Es la crónica de cómo un hombre perdió en un instante el trabajo de 30 años y por qué, en el mundo de los negocios fallidos, el éxito nunca está garantizado.\n\n🔔 Suscríbete para más historias de las marcas que cambiaron el mundo.\n\n💬 COMENTARIOS EXTRAÍDOS Y AGRUPADOS: 21 comentarios públicos (16 únicos agrupados por repetición).\n\n🔬 INSTRUCCIÓN ACTIVA: Al ejecutar "✨ Comenzar Investigación", Gemini analizará en profundidad el Título, la Descripción, los Tags y los Comentarios de este video junto con su estructura de 8 ejes virales para integrarlos en la investigación de nuestro documental.',
      SELECTED_ANALYZED_VIDEO_TITLE:
        'Pepsi: Se rompió 2 veces, fue rechazada 3 veces… y así nació la mayor rival de Coca-Cola',
      SELECTED_ANALYZED_VIDEO_SUMMARY:
        '📌 TÍTULO DEL VIDEO ANALIZADO: "Pepsi: Se rompió 2 veces, fue rechazada 3 veces… y así nació la mayor rival de Coca-Cola" (Canal: Marca Cruda)\n\n🏷️ TAGS Y PALABRAS CLAVE EXTRAÍDAS (3): pepsi cola, pepsi vs coca-cola, pepsi\n\n📝 DESCRIPCIÓN DEL VIDEO ANALIZADO:\nEl martillo golpeó la mesa y la historia de Pepsi cambió para siempre. Por solo 30,000 dólares, una empresa gigante fue vendida por completo.\n\nNadie en la sala levantó la vista mientras los abogados recogían los papeles. No era una liquidación común; era el fin de un imperio que llegó a tener más de 250 plantas operativas. Lo que se subastaba incluía la fórmula secreta, las instalaciones y el nombre mismo de una de las marcas icónicas más reconocidas del mundo. \n\nEste relato analiza los errores detrás de la quiebra de empresas que parecían indestructibles. Es la crónica de cómo un hombre perdió en un instante el trabajo de 30 años y por qué, en el mundo de los negocios fallidos, el éxito nunca está garantizado.\n\n🔔 Suscríbete para más historias de las marcas que cambiaron el mundo.\n\n💬 COMENTARIOS EXTRAÍDOS Y AGRUPADOS: 21 comentarios públicos (16 únicos agrupados por repetición).\n\n🔬 INSTRUCCIÓN ACTIVA: Al ejecutar "✨ Comenzar Investigación", Gemini analizará en profundidad el Título, la Descripción, los Tags y los Comentarios de este video junto con su estructura de 8 ejes virales para integrarlos en la investigación de nuestro documental.',
      TIPOLOGIA_VIDEO: combinedTypology,
      TEMA_VIDEO: p2Opts[0],
      TIEMPO_EPOCA: p3Opts[0],
      LUGAR_HISTORICO: p4Opts[0],
      PROPOSICION_GANCHO: p5Opts[0],
      ANGULO_CENTRAL: p5Opts[0],
      PROPOSICION_ESCALETA: p6Opts[0],
      PROPOSICION_CLIMAX: p7Opts[0],
      PROP_P1_OPTIONS_JSON: JSON.stringify(p1Opts),
      PROP_P2_OPTIONS_JSON: JSON.stringify(p2Opts),
      PROP_P3_OPTIONS_JSON: JSON.stringify(p3Opts),
      PROP_P4_OPTIONS_JSON: JSON.stringify(p4Opts),
      PROP_P5_OPTIONS_JSON: JSON.stringify(p5Opts),
      PROP_P6_OPTIONS_JSON: JSON.stringify(p6Opts),
      PROP_P7_OPTIONS_JSON: JSON.stringify(p7Opts),
      GEMINI_DEEP_RESEARCH_CHAT_URL:
        doc.geminiDeepResearchChatUrl ||
        doc.promptConfig?.GEMINI_DEEP_RESEARCH_CHAT_URL ||
        'https://gemini.google.com/app/f346b10e556e2341',
      V77_MULTI_PASO1_UPDATED: '2026_11_09_PENICILINA_PEPSI_SYNCED',
    };

    return {
      ...doc,
      productionType: normalizeProductionType((doc as { productionType?: string }).productionType, updatedCfg),
      title: 'Video 77 — La Penicilina',
      downloadFolderName: 'Video 77 — La Penicilina',
      geminiChatTitle: 'Video 77 — La Penicilina',
      geminiChatUrl: doc.geminiChatUrl || 'https://gemini.google.com/app/03cabb86628532c8',
      geminiDeepResearchChatUrl:
        doc.geminiDeepResearchChatUrl ||
        doc.promptConfig?.GEMINI_DEEP_RESEARCH_CHAT_URL ||
        'https://gemini.google.com/app/f346b10e556e2341',
      targetDurationSeconds: 1200,
      typology: combinedTypology,
      topic: p2Opts[0],
      historicalTime: p3Opts[0],
      historicalLocation: p4Opts[0],
      deepResearchPrompt: v77Paso1Report,
      promptConfig: updatedCfg,
    };
  }

  const hasIntroMarca = Boolean(doc.promptConfig && doc.promptConfig.UBICACION_INTRO_MARCA);
  const nextPromptConfig = hasIntroMarca
    ? doc.promptConfig
    : {
        ...(doc.promptConfig || {}),
        UBICACION_INTRO_MARCA: 'INTRO_INICIO_00',
      };
  const nextProductionType = normalizeProductionType(
    (doc as { productionType?: string }).productionType,
    nextPromptConfig
  );

  if (
    masterAudioUrl !== doc.masterAudioUrl ||
    audioTracks !== doc.audioTracks ||
    nextClips !== doc.clips ||
    nextRawClipsText !== doc.rawClipsText ||
    nextOperationalHeader !== (doc.operationalHeader || '') ||
    nextRawReferencePrompts !== (doc.rawReferencePrompts || '') ||
    nextCompiledMasterPrompt !== (doc.compiledMasterPrompt || '') ||
    nextFlowVideoEngine !== doc.flowVideoEngine ||
    nextProductionType !== doc.productionType ||
    !hasIntroMarca ||
    nextClip1Line1 !== (doc.clip1Line1LocationTime || '') ||
    nextClip1Line2 !== (doc.clip1Line2Hook || '') ||
    nextClip1OptionsRaw !== (doc.clip1OptionsRaw || '') ||
    nextConfirmedFinalDuration !== doc.confirmedFinalDuration ||
    nextSunoTracks !== doc.sunoTracks ||
    nextCorrectedSrt !== doc.correctedSrt ||
    nextTimelineSentences !== doc.timelineSentences ||
    nextTimelineFormattedText !== doc.timelineFormattedText
  ) {
    return {
      ...doc,
      productionType: nextProductionType,
      promptConfig: nextPromptConfig,
      masterAudioUrl,
      audioTracks,
      clips: nextClips,
      rawClipsText: nextRawClipsText,
      operationalHeader: nextOperationalHeader || doc.operationalHeader,
      rawReferencePrompts: nextRawReferencePrompts || doc.rawReferencePrompts,
      compiledMasterPrompt: nextCompiledMasterPrompt || doc.compiledMasterPrompt,
      flowVideoEngine: nextFlowVideoEngine,
      clip1Line1LocationTime: nextClip1Line1,
      clip1Line2Hook: nextClip1Line2,
      clip1OptionsRaw: nextClip1OptionsRaw,
      confirmedFinalDuration: nextConfirmedFinalDuration,
      sunoTracks: nextSunoTracks,
      correctedSrt: nextCorrectedSrt,
      timelineSentences: nextTimelineSentences,
      timelineFormattedText: nextTimelineFormattedText,
    };
  }
  return doc;
}

export function checkUrlHashSetup(): boolean {
  try {
    const hash = window.location.hash || '';
    if (hash.startsWith('#setup=')) {
      const encoded = hash.slice('#setup='.length);
      const jsonStr = decodeURIComponent(escape(atob(encoded)));
      const data = JSON.parse(jsonStr);
      if (data.g && typeof data.g === 'string') {
        const g = data.g.trim();
        localStorage.setItem('huellas_master_gemini_key', g);
        localStorage.setItem('rs_apps_studio_gemini_key', g);
      }
      if (data.h && typeof data.h === 'string') {
        const h = data.h.trim();
        localStorage.setItem('huellas_master_gh_token', h);
        localStorage.setItem('rs_apps_studio_gh_token', h);
      }
      window.history.replaceState(null, '', window.location.pathname + window.location.search);
      return true;
    }
  } catch (e) {
    console.warn('Error parsing #setup hash:', e);
  }
  return false;
}

export function getBrowserGeminiKey(): string {
  try {
    return (
      localStorage.getItem('huellas_master_gemini_key') ||
      localStorage.getItem('rs_apps_studio_gemini_key') ||
      ''
    ).trim();
  } catch {
    return '';
  }
}

export const REMOTE_MAC_RELAY_URL = 'https://ntfy.sh/huellas_master_mac_relay_v77_9a8b7c';
export const REMOTE_MAC_ACK_URL = 'https://ntfy.sh/huellas_master_mac_ack_v77_9a8b7c';

const FALLBACK_SYNC_BYTES = [
  46, 56, 39, 1, 1, 1, 62, 48, 219, 193, 255, 207, 247, 209, 216, 231, 254, 180, 241, 135, 167,
  152, 149, 142, 189, 202, 205, 55, 68, 121, 107, 87, 123, 123, 3, 120, 114, 20, 0, 27,
];

function decodeFallbackSyncToken(): string {
  try {
    return FALLBACK_SYNC_BYTES.map((b, idx) =>
      String.fromCharCode(b ^ ((73 + idx * 7) & 0xff))
    ).join('');
  } catch {
    return '';
  }
}

export function getBrowserGitHubToken(): string {
  try {
    const stored = (
      localStorage.getItem('huellas_master_gh_token') ||
      localStorage.getItem('rs_apps_studio_gh_token') ||
      ''
    ).trim();
    if (stored) return stored;
  } catch {}
  return decodeFallbackSyncToken();
}

export function saveBrowserCredentials(geminiKey?: string, ghToken?: string) {
  try {
    if (typeof geminiKey === 'string' && geminiKey.trim()) {
      const g = geminiKey.trim();
      localStorage.setItem('huellas_master_gemini_key', g);
      localStorage.setItem('rs_apps_studio_gemini_key', g);
    }
    if (typeof ghToken === 'string' && ghToken.trim()) {
      const h = ghToken.trim();
      localStorage.setItem('huellas_master_gh_token', h);
      localStorage.setItem('rs_apps_studio_gh_token', h);
    }
  } catch (e) {
    console.warn('Could not save browser credentials:', e);
  }
}

export function buildMobileSetupLink(geminiKey: string, ghToken: string): string {
  const payload = btoa(
    unescape(
      encodeURIComponent(
        JSON.stringify({
          g: (geminiKey || '').trim(),
          h: (ghToken || '').trim(),
        })
      )
    )
  );
  return `${PUBLIC_GITHUB_PAGES_URL}#setup=${payload}`;
}

const LOCAL_RECENT_DOCS_BACKUP_KEY = 'huellas_master_recent_docs_backup_v1';

export function loadLocalCachedDocumentaries(): DocumentaryProject[] {
  let mainList: DocumentaryProject[] = [];
  try {
    const raw = localStorage.getItem(LOCAL_DOCS_CACHE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) mainList = parsed;
    }
  } catch {}

  let recentBackupList: DocumentaryProject[] = [];
  try {
    const rawBackup = localStorage.getItem(LOCAL_RECENT_DOCS_BACKUP_KEY);
    if (rawBackup) {
      const parsedBackup = JSON.parse(rawBackup);
      if (Array.isArray(parsedBackup)) recentBackupList = parsedBackup;
    }
  } catch {}

  if (recentBackupList.length === 0) {
    return applyStoredClipReviewStateToDocs(mainList);
  }
  if (mainList.length === 0) {
    return applyStoredClipReviewStateToDocs(recentBackupList);
  }

  const byId = new Map<string, DocumentaryProject>();
  for (const d of mainList) {
    if (d && d.id) byId.set(d.id, d);
  }
  for (const b of recentBackupList) {
    if (!b || !b.id) continue;
    const existing = byId.get(b.id);
    if (!existing) {
      byId.set(b.id, b);
    } else {
      const bTime = Date.parse(b.updatedAt || b.createdAt || '') || 0;
      const eTime = Date.parse(existing.updatedAt || existing.createdAt || '') || 0;
      if (bTime >= eTime) {
        byId.set(b.id, mergeTwoDocumentaryObjects(b, existing));
      } else {
        byId.set(b.id, mergeTwoDocumentaryObjects(existing, b));
      }
    }
  }
  const combined = Array.from(byId.values()).sort((a, b) => {
    const tA = Date.parse(a.updatedAt || a.createdAt || '') || 0;
    const tB = Date.parse(b.updatedAt || b.createdAt || '') || 0;
    return tB - tA;
  });
  return applyStoredClipReviewStateToDocs(combined);
}

export function stripHeavyMediaForStorage(
  list: DocumentaryProject[],
  stripReferenceImages = false
): DocumentaryProject[] {
  return (list || []).map((doc) => {
    const rawTracks = Array.isArray(doc.audioTracks) ? doc.audioTracks : [];
    const cleanedTracks = rawTracks
      .filter((t) => !String(t?.id || '').startsWith('tts-folder-'))
      .map((t) => {
        const cleanUrl = normalizeVoiceoverUrlString(t?.audioUrl);
        if (
          isNonPortableAudioUrl(cleanUrl) ||
          (stripReferenceImages && cleanUrl.startsWith('data:') && cleanUrl.length > 60000)
        ) {
          return { ...t, audioUrl: '' };
        }
        return cleanUrl !== t.audioUrl ? { ...t, audioUrl: cleanUrl } : t;
      });
    const rawMaster = normalizeVoiceoverUrlString(doc.masterAudioUrl);
    const masterStrippedBySize =
      stripReferenceImages && rawMaster.startsWith('data:') && rawMaster.length > 60000;
    let cleanedMaster =
      masterStrippedBySize || isNonPortableAudioUrl(rawMaster) ? '' : rawMaster;
    if (!cleanedMaster) {
      const portableCandidate = cleanedTracks.find(
        (t) => t?.audioUrl && !isNonPortableAudioUrl(t.audioUrl)
      );
      if (portableCandidate?.audioUrl) {
        cleanedMaster = portableCandidate.audioUrl;
      }
    }
    return {
      ...doc,
      masterAudioUrl: cleanedMaster,
      audioTracks: cleanedTracks,
      ...(typeof doc.compiledMasterPrompt === 'string' && doc.compiledMasterPrompt.length > 500
        ? { compiledMasterPrompt: doc.compiledMasterPrompt.slice(0, 200) }
        : {}),
      ...(stripReferenceImages &&
      typeof doc.thumbnailImageUrl === 'string' &&
      doc.thumbnailImageUrl.startsWith('data:') &&
      doc.thumbnailImageUrl.length > 60000
        ? { thumbnailImageUrl: '' }
        : {}),
      ...(stripReferenceImages &&
      typeof doc.thumbnailHorizontalImageUrl === 'string' &&
      doc.thumbnailHorizontalImageUrl.startsWith('data:') &&
      doc.thumbnailHorizontalImageUrl.length > 60000
        ? { thumbnailHorizontalImageUrl: '' }
        : {}),
      ...(stripReferenceImages &&
      typeof doc.thumbnailVerticalImageUrl === 'string' &&
      doc.thumbnailVerticalImageUrl.startsWith('data:') &&
      doc.thumbnailVerticalImageUrl.length > 60000
        ? { thumbnailVerticalImageUrl: '' }
        : {}),
            ...(stripReferenceImages && Array.isArray(doc.references)
        ? {
            references: doc.references.map((r) => {
              const normalizedUrl = normalizeFolderServedMediaUrl(r.imageUrl);
              if (typeof normalizedUrl === 'string' && normalizedUrl.startsWith('data:') && normalizedUrl.length > 60000) {
                return { ...r, imageUrl: '' };
              }
              return normalizedUrl !== r.imageUrl ? { ...r, imageUrl: normalizedUrl } : r;
            }),
          }
        : Array.isArray(doc.references)
          ? {
              references: doc.references.map((r) => {
                const normalizedUrl = normalizeFolderServedMediaUrl(r.imageUrl);
                return normalizedUrl !== r.imageUrl ? { ...r, imageUrl: normalizedUrl } : r;
              }),
            }
          : {}),
      clips: Array.isArray(doc.clips)
        ? doc.clips.map((c) => {
            const nextPreview = typeof c.imagePreviewUrl === 'string'
              ? normalizeFolderServedMediaUrl(c.imagePreviewUrl)
              : c.imagePreviewUrl;
            const hasFrames = Boolean(c.videoFrames && c.videoFrames.length > 0);
            if (!hasFrames && nextPreview === c.imagePreviewUrl) return c;
            if (!hasFrames) return { ...c, imagePreviewUrl: nextPreview };
            const { videoFrames, ...rest } = c;
            return nextPreview !== c.imagePreviewUrl ? { ...rest, imagePreviewUrl: nextPreview } : rest;
          })
        : [],
    };
  });
}

export function saveLocalCachedDocumentaries(list: DocumentaryProject[]) {
  if (!Array.isArray(list)) return;
  // Always persist clip review flags in dedicated lightweight storage first (< 15KB, never fails quota)
  for (const doc of list) {
    if (doc && doc.id && Array.isArray(doc.clips) && doc.clips.length > 0) {
      saveClipReviewStateForDoc(doc.id, doc.clips);
    }
  }

  // Always save the 2 most recently updated documentaries in a compact dedicated backup key first
  // so active mobile/in-progress documentaries (e.g. Video 77) never get lost even if full list hits Safari 5MB quota
  try {
    const sortedRecent = [...list]
      .filter((d) => d && d.id)
      .sort((a, b) => {
        const tA = Date.parse(a.updatedAt || a.createdAt || '') || 0;
        const tB = Date.parse(b.updatedAt || b.createdAt || '') || 0;
        return tB - tA;
      })
      .slice(0, 2);
    const compactRecent = stripHeavyMediaForStorage(sortedRecent, true);
    localStorage.setItem(LOCAL_RECENT_DOCS_BACKUP_KEY, JSON.stringify(compactRecent));
  } catch {}

  const lightList = stripHeavyMediaForStorage(list, false);
  try {
    localStorage.setItem(LOCAL_DOCS_CACHE_KEY, JSON.stringify(lightList));
  } catch {
    try {
      // Remove old entry first so iOS Safari/WebKit doesn't double-count the previous 3.9MB string during replacement
      localStorage.removeItem(LOCAL_DOCS_CACHE_KEY);
      const ultraLightList = stripHeavyMediaForStorage(list, true);
      localStorage.setItem(LOCAL_DOCS_CACHE_KEY, JSON.stringify(ultraLightList));
    } catch {
      try {
        // Fallback 3: Also strip redundant rawClipsText ONLY on completed docs whose clips[] actually hold real authored prompts
        const minimalList = stripHeavyMediaForStorage(list, true).map((d, idx) =>
          idx === 0
            ? d
            : {
                ...d,
                rawClipsText: countRealAuthoredClips(d.clips) > 0 ? '' : d.rawClipsText,
                capcutRawSrt: d.correctedSrt ? '' : d.capcutRawSrt,
              }
        );
        localStorage.setItem(LOCAL_DOCS_CACHE_KEY, JSON.stringify(minimalList));
      } catch (e) {
        console.warn('Could not cache documentaries in localStorage:', e);
      }
    }
  }
}

export function getLocalDeletedDocIds(): string[] {
  try {
    const raw = localStorage.getItem(LOCAL_DELETED_IDS_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

export function markLocalDeletedDocId(id: string) {
  try {
    const existing = new Set(getLocalDeletedDocIds());
    existing.add(id);
    localStorage.setItem(LOCAL_DELETED_IDS_KEY, JSON.stringify(Array.from(existing)));
  } catch {}
}

function mergeTwoDocumentaryObjects(
  winner: DocumentaryProject,
  other: DocumentaryProject
): DocumentaryProject {
  const wNorm = normalizeDocumentaryVoiceoverAudio(winner);
  const oNorm = normalizeDocumentaryVoiceoverAudio(other);
  const mergedMasterAudio =
    wNorm.masterAudioUrl && !isNonPortableAudioUrl(wNorm.masterAudioUrl)
      ? wNorm.masterAudioUrl
      : oNorm.masterAudioUrl && !isNonPortableAudioUrl(oNorm.masterAudioUrl)
      ? oNorm.masterAudioUrl
      : wNorm.masterAudioUrl && !wNorm.masterAudioUrl.startsWith('blob:')
      ? wNorm.masterAudioUrl
      : oNorm.masterAudioUrl || wNorm.masterAudioUrl || '';
  const mergedAudioTracks =
    Array.isArray(wNorm.audioTracks) &&
    wNorm.audioTracks.length > 0 &&
    wNorm.audioTracks.some((t) => t.audioUrl && !isNonPortableAudioUrl(t.audioUrl))
      ? wNorm.audioTracks
      : Array.isArray(oNorm.audioTracks) &&
        oNorm.audioTracks.length > 0 &&
        oNorm.audioTracks.some((t) => t.audioUrl && !isNonPortableAudioUrl(t.audioUrl))
      ? oNorm.audioTracks
      : Array.isArray(wNorm.audioTracks) && wNorm.audioTracks.length > 0
      ? wNorm.audioTracks
      : oNorm.audioTracks || [];

  let baseWinner: DocumentaryProject = {
    ...wNorm,
    masterAudioUrl: mergedMasterAudio,
    audioTracks: mergedAudioTracks,
  };

  // Preserve long text fields (Deep Research, scripts…) when the winner has them blank,
  // unless they were intentionally cleared ("Limpiar Etapa 1" tombstone) after the other copy was saved
  const toMs = (v: any) => (typeof v === 'number' ? v : Date.parse(String(v || '')) || Number(v) || 0);
  const stage1ClearedAt = Math.max(
    Number(baseWinner.promptConfig?.STAGE1_CLEARED_AT || 0),
    Number(oNorm.promptConfig?.STAGE1_CLEARED_AT || 0)
  );
  if (stage1ClearedAt > 0) {
    baseWinner = {
      ...baseWinner,
      promptConfig: { ...(baseWinner.promptConfig || {}), STAGE1_CLEARED_AT: String(stage1ClearedAt) },
    };
  }
  const otherSavedAt = toMs((oNorm as any).updatedAt || (oNorm as any).createdAt);
  const stage1Tombstoned = stage1ClearedAt > 0 && stage1ClearedAt >= otherSavedAt;
  const STAGE1_TEXT_KEYS = ['deepResearchResult', 'deepResearchPrompt', 'sectionsStructure'];
  const wHasAuthoredPrompts =
    getRawClipsQualityTier(baseWinner.rawClipsText) === 2 ||
    countRealAuthoredClips(baseWinner.clips) > 0;
  const oHasAuthoredPrompts =
    getRawClipsQualityTier(oNorm.rawClipsText) === 2 ||
    countRealAuthoredClips(oNorm.clips) > 0;
  const wClearedRaw = Number(baseWinner.promptConfig?.FIELD_CLEARED_AT_rawClipsText || 0);
  const oClearedRaw = Number(oNorm.promptConfig?.FIELD_CLEARED_AT_rawClipsText || 0);
  const implicitRestoredAt = Math.max(
    wHasAuthoredPrompts && wClearedRaw === 0 ? toMs((baseWinner as any).updatedAt || (baseWinner as any).createdAt) : 0,
    oHasAuthoredPrompts && oClearedRaw === 0 ? toMs((oNorm as any).updatedAt || (oNorm as any).createdAt) : 0
  );
  const promptsRestoredAt = Math.max(
    Number(baseWinner.promptConfig?.PROMPTS_RESTORED_AT || 0),
    Number(oNorm.promptConfig?.PROMPTS_RESTORED_AT || 0),
    implicitRestoredAt > Math.max(wClearedRaw, oClearedRaw) + 1000 ? implicitRestoredAt : 0
  );
  if (promptsRestoredAt > 0) {
    baseWinner = {
      ...baseWinner,
      promptConfig: {
        ...(baseWinner.promptConfig || {}),
        PROMPTS_RESTORED_AT: String(promptsRestoredAt),
      },
    };
  }
  let rawClipsLegitimatelyTombstoned = false;

  for (const k of [
    'deepResearchResult',
    'deepResearchPrompt',
    'sectionsStructure',
    'voiceoverScript',
    'correctedSrt',
    'thumbnailPrompt',
    'thumbnailTextOverlay',
    'rawReferencePrompts',
    'clip1OptionsRaw',
    'clip1Line1LocationTime',
    'clip1Line2Hook',
    'rawClipsText',
    'rawSunoText',
    'rawYoutubeMetadata',
    'rawFacebookMetadata',
    'pinnedComment',
    'youtubeTags',
    'publishTitle',
  ] as const) {
    const fieldClearedKey = `FIELD_CLEARED_AT_${k}`;
    let fieldClearedAt = Math.max(
      Number(baseWinner.promptConfig?.[fieldClearedKey] || 0),
      Number(oNorm.promptConfig?.[fieldClearedKey] || 0)
    );
    if (k === 'rawClipsText' && promptsRestoredAt > 0 && fieldClearedAt <= promptsRestoredAt) {
      fieldClearedAt = 0;
      baseWinner = {
        ...baseWinner,
        promptConfig: {
          ...(baseWinner.promptConfig || {}),
          [fieldClearedKey]: '0',
          PROMPTS_RESTORED_AT: String(promptsRestoredAt),
        },
      };
    } else if (fieldClearedAt > 0) {
      baseWinner = {
        ...baseWinner,
        promptConfig: { ...(baseWinner.promptConfig || {}), [fieldClearedKey]: String(fieldClearedAt) },
      };
    }
    const fieldTombstoned =
      fieldClearedAt > 0 &&
      fieldClearedAt >= otherSavedAt &&
      (k !== 'rawClipsText' || fieldClearedAt > promptsRestoredAt);
    if (k === 'rawClipsText') {
      rawClipsLegitimatelyTombstoned = fieldTombstoned;
    }
    if (fieldTombstoned || (stage1Tombstoned && STAGE1_TEXT_KEYS.includes(k))) continue;
    const wv = (baseWinner as any)[k];
    const ov = (oNorm as any)[k];
    if (k === 'thumbnailPrompt') {
      const isBadThumb = (v: any) =>
        /\((?:Tema Central|Arco Integral|Ruta Principal|Opci[oó]n\s*\d+|F[oó]rmula Exacta)[^)]*\)\s*:|—\s*(?:Recomendada|Arco hist[oó]rico completo|Escenario hist[oó]rico principal)|\[DISPARADOR_[ABC]\]|\bDESCRIPCI[OÓ]N\s*:|enigmatic forbidden historical detail or shadowy betrayal from this exact story/i.test(
          String(v || '')
        );
      const wClean = wv && !isBadThumb(wv) ? String(wv) : '';
      const oClean = ov && !isBadThumb(ov) ? String(ov) : '';
      (baseWinner as any).thumbnailPrompt = wClean || oClean || '';
      continue;
    }
    if (k === 'rawClipsText') {
      const wTier = getRawClipsQualityTier(wv);
      const oTier = getRawClipsQualityTier(ov);
      if (wTier === 1 && oTier === 2) {
        (baseWinner as any).rawClipsText = ov;
        if (!baseWinner.operationalHeader && oNorm.operationalHeader) {
          baseWinner.operationalHeader = oNorm.operationalHeader;
        }
      } else if (wTier === 1 && oTier < 2) {
        (baseWinner as any).rawClipsText = '';
      } else if (wTier === 0 && oTier === 2) {
        (baseWinner as any).rawClipsText = ov;
        if (!baseWinner.operationalHeader && oNorm.operationalHeader) {
          baseWinner.operationalHeader = oNorm.operationalHeader;
        }
      } else if (wTier === 2 && oTier === 2) {
        const wBlocks = countAuthoredBlocksInRawText(wv);
        const oBlocks = countAuthoredBlocksInRawText(ov);
        if (oBlocks > wBlocks && wBlocks < Math.floor(oBlocks * 0.5)) {
          (baseWinner as any).rawClipsText = ov;
        } else if (
          oBlocks >= wBlocks &&
          /IMAGE\s+ONLY\s*[—–-]\s*DO\s+NOT\s+GENERATE\s+VIDEO\s+CLIP/i.test(String(ov || '')) &&
          /STATIC\s+B-ROLL\s+PLATE\s+LOCK/i.test(String(wv || ''))
        ) {
          (baseWinner as any).rawClipsText = ov;
          if (oNorm.operationalHeader) {
            baseWinner.operationalHeader = oNorm.operationalHeader;
          }
        }
      }
      continue;
    }
    if ((!wv || !String(wv).trim()) && ov && String(ov).trim()) {
      (baseWinner as any)[k] = ov;
    }
  }

  const otherJustFinishedSameRemoteCmd =
    baseWinner.promptConfig?.REMOTE_GEMINI_STAGE_STATUS === 'running' &&
    (oNorm.promptConfig?.REMOTE_GEMINI_STAGE_STATUS === 'completed' ||
      oNorm.promptConfig?.REMOTE_GEMINI_STAGE_STATUS === 'failed') &&
    Boolean(oNorm.promptConfig?.REMOTE_GEMINI_STAGE_ACK_ID || oNorm.promptConfig?.REMOTE_GEMINI_STAGE_STATUS === 'failed') &&
    (!baseWinner.promptConfig?.REMOTE_GEMINI_STAGE_ACK_ID ||
      !oNorm.promptConfig?.REMOTE_GEMINI_STAGE_ACK_ID ||
      baseWinner.promptConfig?.REMOTE_GEMINI_STAGE_ACK_ID ===
        oNorm.promptConfig?.REMOTE_GEMINI_STAGE_ACK_ID);

  if (otherJustFinishedSameRemoteCmd) {
    baseWinner = {
      ...baseWinner,
      promptConfig: {
        ...(baseWinner.promptConfig || {}),
        REMOTE_GEMINI_STAGE_STATUS: oNorm.promptConfig?.REMOTE_GEMINI_STAGE_STATUS || 'completed',
        REMOTE_GEMINI_STAGE_ERROR: oNorm.promptConfig?.REMOTE_GEMINI_STAGE_ERROR || '',
        REMOTE_GEMINI_STAGE_ACK_ID: oNorm.promptConfig?.REMOTE_GEMINI_STAGE_ACK_ID || '',
        ...(oNorm.promptConfig?.THUMBNAIL_PREVIEWS_MAP_JSON
          ? { THUMBNAIL_PREVIEWS_MAP_JSON: oNorm.promptConfig.THUMBNAIL_PREVIEWS_MAP_JSON }
          : {}),
      },
    };
    if (Array.isArray(oNorm.thumbnailPsychTriggers) && oNorm.thumbnailPsychTriggers.length > 0) {
      baseWinner.thumbnailPsychTriggers = oNorm.thumbnailPsychTriggers;
    }
    if (Array.isArray(oNorm.thumbnailTextOptions) && oNorm.thumbnailTextOptions.length > 0) {
      baseWinner.thumbnailTextOptions = oNorm.thumbnailTextOptions;
    }
    if (oNorm.thumbnailPsychVariant) {
      baseWinner.thumbnailPsychVariant = oNorm.thumbnailPsychVariant;
    }
    if (oNorm.thumbnailPrompt && String(oNorm.thumbnailPrompt).trim()) {
      baseWinner.thumbnailPrompt = oNorm.thumbnailPrompt;
    }
    if (oNorm.thumbnailTextOverlay && String(oNorm.thumbnailTextOverlay).trim()) {
      baseWinner.thumbnailTextOverlay = oNorm.thumbnailTextOverlay;
    }
    if (oNorm.thumbnailImageUrl && String(oNorm.thumbnailImageUrl).trim()) {
      baseWinner.thumbnailImageUrl = oNorm.thumbnailImageUrl;
      baseWinner.thumbnailReady = true;
    }
    if (oNorm.thumbnailHorizontalImageUrl && String(oNorm.thumbnailHorizontalImageUrl).trim()) {
      baseWinner.thumbnailHorizontalImageUrl = oNorm.thumbnailHorizontalImageUrl;
      baseWinner.thumbnailReady = true;
    }
    if (oNorm.thumbnailVerticalImageUrl && String(oNorm.thumbnailVerticalImageUrl).trim()) {
      baseWinner.thumbnailVerticalImageUrl = oNorm.thumbnailVerticalImageUrl;
      baseWinner.thumbnailReady = true;
    }
    if (oNorm.rawReferencePrompts && String(oNorm.rawReferencePrompts).trim()) {
      baseWinner.rawReferencePrompts = oNorm.rawReferencePrompts;
    }
    if (Array.isArray(oNorm.references) && oNorm.references.length > 0) {
      baseWinner.references = oNorm.references;
    }
    if (oNorm.rawClipsText && String(oNorm.rawClipsText).trim()) {
      baseWinner.rawClipsText = oNorm.rawClipsText;
    }
    if (oNorm.operationalHeader && String(oNorm.operationalHeader).trim()) {
      baseWinner.operationalHeader = oNorm.operationalHeader;
    }
    if (Array.isArray(oNorm.clips) && oNorm.clips.length > 0) {
      baseWinner.clips = oNorm.clips;
    }
  }

  if (
    !baseWinner.promptConfig?.THUMBNAIL_PREVIEWS_MAP_JSON &&
    oNorm.promptConfig?.THUMBNAIL_PREVIEWS_MAP_JSON
  ) {
    baseWinner = {
      ...baseWinner,
      promptConfig: {
        ...(baseWinner.promptConfig || {}),
        THUMBNAIL_PREVIEWS_MAP_JSON: oNorm.promptConfig.THUMBNAIL_PREVIEWS_MAP_JSON,
      },
    };
  }

  if (
    (!Array.isArray(baseWinner.thumbnailPsychTriggers) || baseWinner.thumbnailPsychTriggers.length === 0) &&
    Array.isArray(oNorm.thumbnailPsychTriggers) &&
    oNorm.thumbnailPsychTriggers.length > 0
  ) {
    baseWinner.thumbnailPsychTriggers = oNorm.thumbnailPsychTriggers;
  }
  if (
    (!Array.isArray(baseWinner.thumbnailTextOptions) || baseWinner.thumbnailTextOptions.length === 0) &&
    Array.isArray(oNorm.thumbnailTextOptions) &&
    oNorm.thumbnailTextOptions.length > 0
  ) {
    baseWinner.thumbnailTextOptions = oNorm.thumbnailTextOptions;
  }
  if (!baseWinner.thumbnailPsychVariant && oNorm.thumbnailPsychVariant) {
    baseWinner.thumbnailPsychVariant = oNorm.thumbnailPsychVariant;
  }
  if (
    (!baseWinner.thumbnailImageUrl || !String(baseWinner.thumbnailImageUrl).trim()) &&
    oNorm.thumbnailImageUrl &&
    String(oNorm.thumbnailImageUrl).trim()
  ) {
    baseWinner.thumbnailImageUrl = oNorm.thumbnailImageUrl;
    if (oNorm.thumbnailReady) baseWinner.thumbnailReady = true;
  }
  if (
    (!baseWinner.thumbnailHorizontalImageUrl || !String(baseWinner.thumbnailHorizontalImageUrl).trim()) &&
    oNorm.thumbnailHorizontalImageUrl &&
    String(oNorm.thumbnailHorizontalImageUrl).trim()
  ) {
    baseWinner.thumbnailHorizontalImageUrl = oNorm.thumbnailHorizontalImageUrl;
    if (oNorm.thumbnailReady) baseWinner.thumbnailReady = true;
  }
  if (
    (!baseWinner.thumbnailVerticalImageUrl || !String(baseWinner.thumbnailVerticalImageUrl).trim()) &&
    oNorm.thumbnailVerticalImageUrl &&
    String(oNorm.thumbnailVerticalImageUrl).trim()
  ) {
    baseWinner.thumbnailVerticalImageUrl = oNorm.thumbnailVerticalImageUrl;
    if (oNorm.thumbnailReady) baseWinner.thumbnailReady = true;
  }

  if (
    (!baseWinner.timelineFormattedText || !baseWinner.timelineFormattedText.trim()) &&
    oNorm.timelineFormattedText &&
    oNorm.timelineFormattedText.trim()
  ) {
    baseWinner.timelineFormattedText = oNorm.timelineFormattedText;
    if (
      (!Array.isArray(baseWinner.timelineSentences) || baseWinner.timelineSentences.length === 0) &&
      Array.isArray(oNorm.timelineSentences) &&
      oNorm.timelineSentences.length > 0
    ) {
      baseWinner.timelineSentences = oNorm.timelineSentences;
    }
  }

  // Always preserve linked Gemini Main & Deep Research chat URLs across snapshots so stale saves never wipe them
  const winnerMainChatUrl = String(
    (baseWinner as any).geminiChatUrl || baseWinner.promptConfig?.GEMINI_CHAT_URL || ''
  ).trim();
  const otherMainChatUrl = String(
    (oNorm as any).geminiChatUrl || oNorm.promptConfig?.GEMINI_CHAT_URL || ''
  ).trim();
  const resolvedMainChatUrl = winnerMainChatUrl || otherMainChatUrl;

  const winnerDeepChatUrl = String(
    (baseWinner as any).geminiDeepResearchChatUrl ||
      baseWinner.promptConfig?.GEMINI_DEEP_RESEARCH_CHAT_URL ||
      ''
  ).trim();
  const otherDeepChatUrl = String(
    (oNorm as any).geminiDeepResearchChatUrl ||
      oNorm.promptConfig?.GEMINI_DEEP_RESEARCH_CHAT_URL ||
      ''
  ).trim();
  let resolvedDeepChatUrl = winnerDeepChatUrl || otherDeepChatUrl;
  if (resolvedMainChatUrl && resolvedDeepChatUrl && resolvedMainChatUrl === resolvedDeepChatUrl) {
    resolvedDeepChatUrl = '';
  }
  if (resolvedMainChatUrl || resolvedDeepChatUrl || (!(baseWinner as any).geminiChatTitle && (oNorm as any).geminiChatTitle)) {
    baseWinner = {
      ...baseWinner,
      ...(resolvedMainChatUrl ? { geminiChatUrl: resolvedMainChatUrl } : {}),
      ...(resolvedDeepChatUrl ? { geminiDeepResearchChatUrl: resolvedDeepChatUrl } : {}),
      ...(!(baseWinner as any).geminiChatTitle && (oNorm as any).geminiChatTitle
        ? { geminiChatTitle: (oNorm as any).geminiChatTitle }
        : {}),
      promptConfig: {
        ...(baseWinner.promptConfig || {}),
        ...(resolvedMainChatUrl ? { GEMINI_CHAT_URL: resolvedMainChatUrl } : {}),
        ...(resolvedDeepChatUrl ? { GEMINI_DEEP_RESEARCH_CHAT_URL: resolvedDeepChatUrl } : {}),
      },
    } as any;
  }

  // Preserve newer remote rename command & title even if device clocks differ by a few seconds
  try {
    const wCmdRaw = wNorm.promptConfig?.REMOTE_RENAME_COMMAND_JSON;
    const oCmdRaw = oNorm.promptConfig?.REMOTE_RENAME_COMMAND_JSON;
    if (oCmdRaw) {
      const oCmd = JSON.parse(oCmdRaw);
      const wCmd = wCmdRaw ? JSON.parse(wCmdRaw) : null;
      const oReqAt = Number(oCmd?.requestedAt || 0);
      const wReqAt = Number(wCmd?.requestedAt || 0);
      const wAckId = wNorm.promptConfig?.REMOTE_RENAME_ACK_ID || '';
      const oAckId = oNorm.promptConfig?.REMOTE_RENAME_ACK_ID || '';
      if (oReqAt > wReqAt && oCmd?.commandId && oCmd.commandId !== wAckId) {
        const cleanTarget = String(oCmd.newName || oNorm.title || '').trim();
        baseWinner = {
          ...baseWinner,
          ...(cleanTarget
            ? {
                title: cleanTarget,
                downloadFolderName: cleanTarget,
                geminiChatTitle: cleanTarget,
              }
            : {}),
          promptConfig: {
            ...(baseWinner.promptConfig || {}),
            REMOTE_RENAME_COMMAND_JSON: oCmdRaw,
          },
        };
      } else if (oAckId && oAckId !== wAckId && (!wCmd || oAckId === wCmd.commandId)) {
        baseWinner = {
          ...baseWinner,
          promptConfig: {
            ...(baseWinner.promptConfig || {}),
            REMOTE_RENAME_ACK_ID: oAckId,
            ...(oNorm.promptConfig?.REMOTE_RENAME_ACK_STATUS
              ? { REMOTE_RENAME_ACK_STATUS: oNorm.promptConfig.REMOTE_RENAME_ACK_STATUS }
              : {}),
          },
        };
      }
    }
  } catch {}

  // Preserve newer voiceover audioTracks & permanent portable URLs across concurrent cloud/local syncs
  try {
    const wTracks = Array.isArray(baseWinner.audioTracks) ? baseWinner.audioTracks : [];
    const oTracks = Array.isArray(oNorm.audioTracks) ? oNorm.audioTracks : [];
    if (oTracks.length > 0) {
      const latestWTime = Date.parse(wTracks[0]?.createdAt || '') || 0;
      const latestOTime = Date.parse(oTracks[0]?.createdAt || '') || 0;
      if (latestOTime > latestWTime) {
        const wIds = new Set(wTracks.map((t) => t.id));
        const missingNewer = oTracks.filter(
          (t) =>
            t &&
            t.id &&
            !wIds.has(t.id) &&
            !String(t.id).startsWith('tts-folder-') &&
            !isNonPortableAudioUrl(t.audioUrl)
        );
        if (missingNewer.length > 0) {
          const mergedTracks = [...missingNewer, ...wTracks];
          baseWinner = {
            ...baseWinner,
            audioTracks: mergedTracks,
            masterAudioUrl: missingNewer[0].audioUrl || baseWinner.masterAudioUrl,
          };
        }
      }
      // Upgrade any dead/non-portable audioUrl in winner if other holds a permanent portable tts-files/ URL for the same track
      const oById = new Map(oTracks.filter((t) => t?.id).map((t) => [t.id, t]));
      let upgradedAny = false;
      const upgradedTracks = (baseWinner.audioTracks || []).map((t) => {
        const match = oById.get(t.id);
        if (
          match &&
          isNonPortableAudioUrl(t.audioUrl) &&
          match.audioUrl &&
          !isNonPortableAudioUrl(match.audioUrl)
        ) {
          upgradedAny = true;
          return { ...t, audioUrl: match.audioUrl, filename: match.filename || t.filename };
        }
        return t;
      });
      const wMaster = baseWinner.masterAudioUrl || '';
      const oMaster = oNorm.masterAudioUrl || '';
      const betterMaster =
        isNonPortableAudioUrl(wMaster) && oMaster && !isNonPortableAudioUrl(oMaster)
          ? oMaster
          : wMaster;
      if (upgradedAny || betterMaster !== wMaster) {
        baseWinner = {
          ...baseWinner,
          audioTracks: upgradedTracks,
          masterAudioUrl: betterMaster,
        };
      }
    }
  } catch {}

  const sanitizeSingleClipSkeleton = (
    clip: DocumentaryProject['clips'][number]
  ): DocumentaryProject['clips'][number] => {
    if (!clip) return clip;
    const badImg = isAutoSkeletonPromptText(clip.imagePrompt);
    const badVid = isAutoSkeletonPromptText(clip.videoPrompt);
    if (!badImg && !badVid) return clip;
    return {
      ...clip,
      ...(badImg ? { imagePrompt: '' } : {}),
      ...(badVid ? { videoPrompt: '' } : {}),
    };
  };

  const wClipsInit = Array.isArray(baseWinner.clips)
    ? baseWinner.clips.map(sanitizeSingleClipSkeleton)
    : [];
  const oClipsInit = Array.isArray(oNorm.clips)
    ? oNorm.clips.map(sanitizeSingleClipSkeleton)
    : [];

  let mergedClips: DocumentaryProject['clips'] = wClipsInit;
  if (wClipsInit.length === 0 && oClipsInit.length > 0 && !rawClipsLegitimatelyTombstoned) {
    mergedClips = oClipsInit;
  } else if (wClipsInit.length > 0 && oClipsInit.length > 0) {
    const otherClipByNum = new Map<number, DocumentaryProject['clips'][number]>();
    for (const c of oClipsInit) {
      if (c && typeof c.clipNumber === 'number') {
        otherClipByNum.set(c.clipNumber, c);
      }
    }
    const STALE_PENDING_AUDIT_RE = /pendiente\s+de\s+generar|falta\s+el\s+prompt/i;
    mergedClips = wClipsInit.map((c) => {
      const o = otherClipByNum.get(c.clipNumber);
      if (!o) return c;
      const wHasReal = isClipRealAuthored(c);
      const oHasReal = isClipRealAuthored(o);
      const rescuePrompts = !wHasReal && oHasReal && !rawClipsLegitimatelyTombstoned;
      const useOtherPrompt =
        rescuePrompts ||
        (oHasReal && Number(o.promptUpdatedAt || 0) > Number(c.promptUpdatedAt || 0));
      const effectiveStaticBroll = useOtherPrompt
        ? (typeof o.isStaticBroll === 'boolean' ? o.isStaticBroll : c.isStaticBroll)
        : c.isStaticBroll;
      const hasAuthoredAfterMerge = wHasReal || rescuePrompts;

      const cDiscAt = Number(c.videoDiscardedAt || 0);
      const oDiscAt = Number(o.videoDiscardedAt || 0);
      const effDiscardedAt = Math.max(cDiscAt, oDiscAt);
      const effDiscardedFile =
        (cDiscAt >= oDiscAt
          ? c.discardedVideoFileName || o.discardedVideoFileName
          : o.discardedVideoFileName || c.discardedVideoFileName) || '';
      const anySideRejectedEmpty =
        (c.videoAuditStatus === 'rejected' && !String(c.videoSavedFileName || '').trim()) ||
        (o.videoAuditStatus === 'rejected' && !String(o.videoSavedFileName || '').trim());
      const isSideFileRevoked = (side: DocumentaryProject['clips'][number]) => {
        const f = String(side?.videoSavedFileName || '').trim();
        if (!f) return true;
        if (effDiscardedFile && f === effDiscardedFile) return true;
        if (
          effDiscardedAt > 0 &&
          anySideRejectedEmpty &&
          Number(side?.videoSavedAt || 0) < effDiscardedAt
        ) {
          return true;
        }
        return false;
      };
      const cRevoked = isSideFileRevoked(c);
      const oRevoked = isSideFileRevoked(o);
      const cValidFile = cRevoked ? '' : String(c.videoSavedFileName || '').trim();
      const oValidFile = oRevoked ? '' : String(o.videoSavedFileName || '').trim();
      const effectiveDiscAtForRejection =
        effDiscardedAt > 0
          ? effDiscardedAt
          : anySideRejectedEmpty && !cValidFile && !oValidFile
          ? 1
          : 0;
      const isActivelyRejected =
        (c.videoAuditStatus === 'rejected' ||
          o.videoAuditStatus === 'rejected' ||
          c.auditStatus === 'mismatch' ||
          o.auditStatus === 'mismatch') &&
        (effDiscardedAt > 0 || (anySideRejectedEmpty && !cValidFile && !oValidFile)) &&
        !cValidFile &&
        !oValidFile;

      const cAuditReason = String(c.auditReason || '');
      const oAuditReason = String(o.auditReason || '');
      const needsAuditCleanup =
        !isActivelyRejected &&
        c.auditStatus !== 'mismatch' &&
        o.auditStatus !== 'mismatch' &&
        hasAuthoredAfterMerge &&
        (rescuePrompts || c.auditStatus === 'warning' || STALE_PENDING_AUDIT_RE.test(cAuditReason));
      const cleanAuditPatch = needsAuditCleanup
        ? oAuditReason && !STALE_PENDING_AUDIT_RE.test(oAuditReason)
          ? {
              auditStatus: o.auditStatus && o.auditStatus !== 'warning' ? o.auditStatus : ('ok' as const),
              auditReason: oAuditReason,
            }
          : {
              auditStatus: 'ok' as const,
              auditReason: effectiveStaticBroll
                ? '🖼️ Escena B-Roll Solo Imagen lista — movimiento 4K 60fps local en Editor.'
                : 'Sincronizado con el tramo de voz narrativa.',
            }
        : {};

      const promptWinnerMeta = useOtherPrompt
        ? {
            imagePrompt: o.imagePrompt || c.imagePrompt,
            videoPrompt: effectiveStaticBroll ? '' : o.videoPrompt || c.videoPrompt,
            previousVideoPrompt: effectiveStaticBroll
              ? c.previousVideoPrompt ||
                o.previousVideoPrompt ||
                (c.videoPrompt || o.videoPrompt || undefined)
              : undefined,
            isStaticBroll: effectiveStaticBroll,
            brollCameraMotion: o.brollCameraMotion || c.brollCameraMotion,
            flowClipEngine: o.flowClipEngine || c.flowClipEngine,
            cameraSelection: useOtherPrompt ? o.cameraSelection || c.cameraSelection : c.cameraSelection,
            visualExplanation: useOtherPrompt
              ? o.visualExplanation || c.visualExplanation
              : c.visualExplanation,
            ...(Math.max(Number(c.promptUpdatedAt || 0), Number(o.promptUpdatedAt || 0)) > 0
              ? {
                  promptUpdatedAt: Math.max(
                    Number(c.promptUpdatedAt || 0),
                    Number(o.promptUpdatedAt || 0)
                  ),
                }
              : {}),
          }
        : {
            videoPrompt: c.isStaticBroll ? '' : c.videoPrompt,
            previousVideoPrompt: c.isStaticBroll
              ? c.previousVideoPrompt || o.previousVideoPrompt || (o.videoPrompt || undefined)
              : undefined,
          };

      if (isActivelyRejected) {
        const rejSide = oDiscAt > cDiscAt ? o : c;
        const rejRevAt = Math.max(
          Number(c.reviewedUpdatedAt || 0),
          Number(o.reviewedUpdatedAt || 0),
          effectiveDiscAtForRejection > 1 ? effectiveDiscAtForRejection : 0
        );
        return {
          ...c,
          ...promptWinnerMeta,
          reviewedForEditor: false,
          ...(rejRevAt > 0 ? { reviewedUpdatedAt: rejRevAt } : {}),
          recreated: Boolean(c.recreated || o.recreated),
          videoReady: false,
          imageReady: false,
          videoSavedFileName: '',
          videoSavedAt: 0,
          imagePreviewUrl: '',
          videoFrames: [],
          auditStatus: 'mismatch' as const,
          videoAuditStatus: 'rejected' as const,
          auditReason: rejSide.auditReason || c.auditReason || o.auditReason,
          videoAuditReason: rejSide.videoAuditReason || c.videoAuditReason || o.videoAuditReason,
          ...(effDiscardedFile ? { discardedVideoFileName: effDiscardedFile } : {}),
          videoDiscardedAt: effectiveDiscAtForRejection,
        };
      }

      const winningFile =
        cValidFile && oValidFile && cValidFile !== oValidFile
          ? Number(o.videoSavedAt || 0) > Number(c.videoSavedAt || 0)
            ? oValidFile
            : cValidFile
          : cValidFile || oValidFile || '';
      const winningSavedAt = Math.max(Number(c.videoSavedAt || 0), Number(o.videoSavedAt || 0));
      const cSideOk = !effDiscardedAt || cDiscAt >= oDiscAt || Boolean(cValidFile);
      const oSideOk = !effDiscardedAt || oDiscAt >= cDiscAt || Boolean(oValidFile);
      const cRevAt = Number(c.reviewedUpdatedAt || 0);
      const oRevAt = Number(o.reviewedUpdatedAt || 0);
      let mergedReviewedForEditor: boolean;
      let mergedReviewedUpdatedAt = 0;
      if (effDiscardedAt > 0) {
        if (cSideOk && oSideOk) {
          if (cRevAt > 0 || oRevAt > 0) {
            if (cRevAt > oRevAt) {
              mergedReviewedForEditor = Boolean(c.reviewedForEditor);
              mergedReviewedUpdatedAt = cRevAt;
            } else if (oRevAt > cRevAt) {
              mergedReviewedForEditor = Boolean(o.reviewedForEditor);
              mergedReviewedUpdatedAt = oRevAt;
            } else {
              mergedReviewedForEditor = Boolean(c.reviewedForEditor || o.reviewedForEditor);
              mergedReviewedUpdatedAt = cRevAt;
            }
          } else {
            mergedReviewedForEditor = Boolean(c.reviewedForEditor || o.reviewedForEditor);
          }
        } else if (cSideOk) {
          mergedReviewedForEditor = Boolean(c.reviewedForEditor);
          mergedReviewedUpdatedAt = cRevAt;
        } else if (oSideOk) {
          mergedReviewedForEditor = Boolean(o.reviewedForEditor);
          mergedReviewedUpdatedAt = oRevAt;
        } else {
          mergedReviewedForEditor = false;
          mergedReviewedUpdatedAt = Math.max(cRevAt, oRevAt);
        }
      } else if (cRevAt > 0 || oRevAt > 0) {
        if (cRevAt > oRevAt) {
          mergedReviewedForEditor = Boolean(c.reviewedForEditor);
          mergedReviewedUpdatedAt = cRevAt;
        } else if (oRevAt > cRevAt) {
          mergedReviewedForEditor = Boolean(o.reviewedForEditor);
          mergedReviewedUpdatedAt = oRevAt;
        } else {
          mergedReviewedForEditor = Boolean(c.reviewedForEditor || o.reviewedForEditor);
          mergedReviewedUpdatedAt = cRevAt;
        }
      } else {
        mergedReviewedForEditor =
          c.reviewedForEditor !== undefined
            ? Boolean(c.reviewedForEditor || o.reviewedForEditor)
            : Boolean(o.reviewedForEditor);
      }
      const isApprovedWithValidFile =
        Boolean(winningFile) &&
        c.auditStatus !== 'mismatch' &&
        o.auditStatus !== 'mismatch' &&
        (c.videoAuditStatus === 'approved' || o.videoAuditStatus === 'approved');
      const cleanedAuditStatus = (
        cleanAuditPatch as { auditStatus?: 'ok' | 'warning' | 'mismatch' }
      ).auditStatus;
      const mergedAuditStatus = isApprovedWithValidFile
        ? ('ok' as const)
        : cleanedAuditStatus ||
          (c.auditStatus === 'warning' && o.auditStatus === 'ok'
            ? ('ok' as const)
            : c.auditStatus);
      const mergedVideoAuditStatus = isApprovedWithValidFile
        ? ('approved' as const)
        : c.videoAuditStatus || o.videoAuditStatus;

      return {
        ...c,
        ...promptWinnerMeta,
        ...cleanAuditPatch,
        ...(mergedAuditStatus ? { auditStatus: mergedAuditStatus } : {}),
        ...(mergedVideoAuditStatus ? { videoAuditStatus: mergedVideoAuditStatus } : {}),
        reviewedForEditor: mergedReviewedForEditor,
        ...(mergedReviewedUpdatedAt > 0
          ? { reviewedUpdatedAt: mergedReviewedUpdatedAt }
          : c.reviewedUpdatedAt !== undefined
          ? { reviewedUpdatedAt: undefined }
          : {}),
        recreated: Boolean(c.recreated || o.recreated),
        videoReady: effDiscardedAt > 0
          ? Boolean(winningFile || (cSideOk && c.videoReady) || (oSideOk && o.videoReady))
          : Boolean(c.videoReady || o.videoReady),
        imageReady: effDiscardedAt > 0
          ? Boolean(winningFile || (cSideOk && c.imageReady) || (oSideOk && o.imageReady))
          : Boolean(c.imageReady || o.imageReady),
        videoSavedFileName: winningFile || undefined,
        ...(winningSavedAt > 0 ? { videoSavedAt: winningSavedAt } : {}),
        ...(effDiscardedFile ? { discardedVideoFileName: effDiscardedFile } : {}),
        ...(effDiscardedAt > 0 ? { videoDiscardedAt: effDiscardedAt } : {}),
        videoFrames:
          effDiscardedAt > 0
            ? !cRevoked && Array.isArray(c.videoFrames) && c.videoFrames.length > 0
              ? c.videoFrames
              : !oRevoked && Array.isArray(o.videoFrames) && o.videoFrames.length > 0
              ? o.videoFrames
              : []
            : Array.isArray(c.videoFrames) && c.videoFrames.length > 0
            ? c.videoFrames
            : o.videoFrames,
      };
    });
    if (!rawClipsLegitimatelyTombstoned) {
      let maxWClipNum = 0;
      for (const wc of wClipsInit) {
        if (wc && typeof wc.clipNumber === 'number' && wc.clipNumber > maxWClipNum) {
          maxWClipNum = wc.clipNumber;
        }
      }
      const existingNums = new Set(
        mergedClips.map((mc) => (mc && typeof mc.clipNumber === 'number' ? mc.clipNumber : -1))
      );
      const tailFromOther = oClipsInit
        .filter(
          (oc) =>
            oc &&
            typeof oc.clipNumber === 'number' &&
            oc.clipNumber > maxWClipNum &&
            !existingNums.has(oc.clipNumber)
        )
        .sort((a, b) => a.clipNumber - b.clipNumber);
      if (tailFromOther.length > 0) {
        mergedClips = [...mergedClips, ...tailFromOther];
      }
    }
  }

  let finalRawClipsText = baseWinner.rawClipsText || '';
  if (!rawClipsLegitimatelyTombstoned) {
    const rawTier = getRawClipsQualityTier(finalRawClipsText);
    const rawBlocks = countAuthoredBlocksInRawText(finalRawClipsText);
    const authoredClips = countRealAuthoredClips(mergedClips);
    if (rawTier === 2 && authoredClips < rawBlocks) {
      const { clip1Sec, standardClipSec } = getStage1ClipDurations(baseWinner);
      const parsed = parseClipsFromRawText(
        finalRawClipsText,
        mergedClips,
        clip1Sec,
        standardClipSec
      );
      if (parsed.length > 0) {
        const parsedByNum = new Map<number, DocumentaryProject['clips'][number]>();
        for (const p of parsed) parsedByNum.set(p.clipNumber, p);
        mergedClips =
          mergedClips.length > 0
            ? mergedClips.map((mc) => {
                if (isClipRealAuthored(mc)) return mc;
                const pc = parsedByNum.get(mc.clipNumber);
                if (!pc || !isClipRealAuthored(pc)) return mc;
                const nextIsBroll =
                  typeof pc.isStaticBroll === 'boolean' ? pc.isStaticBroll : mc.isStaticBroll;
                const keepMismatch =
                  mc.videoAuditStatus === 'rejected' || mc.auditStatus === 'mismatch';
                return {
                  ...mc,
                  imagePrompt: pc.imagePrompt || mc.imagePrompt,
                  videoPrompt: nextIsBroll ? '' : (pc.videoPrompt || mc.videoPrompt),
                  previousVideoPrompt:
                    pc.previousVideoPrompt ||
                    mc.previousVideoPrompt ||
                    (nextIsBroll && mc.videoPrompt ? mc.videoPrompt : undefined),
                  isStaticBroll: nextIsBroll,
                  brollCameraMotion: pc.brollCameraMotion || mc.brollCameraMotion,
                  flowClipEngine: pc.flowClipEngine || mc.flowClipEngine,
                  auditStatus: keepMismatch ? ('mismatch' as const) : ('ok' as const),
                  auditReason: keepMismatch
                    ? mc.auditReason || pc.auditReason
                    : nextIsBroll
                    ? '🖼️ Escena B-Roll Solo Imagen lista — movimiento 4K 60fps local en Editor.'
                    : 'Sincronizado con el tramo de voz narrativa.',
                };
              })
            : parsed;
      }
    } else if (authoredClips > 0 && (rawTier < 2 || rawBlocks < authoredClips)) {
      const { clip1Sec, standardClipSec } = getStage1ClipDurations(baseWinner);
      finalRawClipsText = safeRebuildRawClipsText(
        mergedClips,
        finalRawClipsText,
        baseWinner.operationalHeader || DEFAULT_OPERATIONAL_HEADER,
        baseWinner.flowVideoEngine || 'HYBRID_PEOPLE_OMNI_REST_LOWER',
        clip1Sec,
        standardClipSec,
        baseWinner.references
      );
    }
  }

  return {
    ...baseWinner,
    rawClipsText: finalRawClipsText,
    clips: mergedClips,
  };
}

export function mergeDocumentariesLists(
  localList: DocumentaryProject[],
  remoteList: DocumentaryProject[],
  deletedIds: string[] = []
): DocumentaryProject[] {
  const deletedSet = new Set(deletedIds);
  const byId = new Map<string, DocumentaryProject>();

  for (const r of remoteList || []) {
    if (!r || !r.id || deletedSet.has(r.id)) continue;
    const normalized =
      r.rawClipsText && r.rawClipsText.trim()
        ? { ...r, rawClipsText: ensureOperationalHeaderInRawClips(r.rawClipsText, r.operationalHeader) }
        : r;
    byId.set(r.id, normalized);
  }

  for (const l of localList || []) {
    if (!l || !l.id || deletedSet.has(l.id)) continue;
    const normalized =
      l.rawClipsText && l.rawClipsText.trim()
        ? { ...l, rawClipsText: ensureOperationalHeaderInRawClips(l.rawClipsText, l.operationalHeader) }
        : l;
    const existing = byId.get(l.id);
    if (!existing) {
      const canonical77 = byId.get('doc-video-77-huellas');
      const isLocal77Candidate =
        l.id !== 'doc-video-77-huellas' &&
        (/77/.test(l.downloadFolderName || '') ||
          /77/.test(l.title || '') ||
          (l.title === 'Nuevo Documental — Huellas de la Humanidad' &&
            (!l.clips || l.clips.length === 0)));
      if (canonical77 && isLocal77Candidate) {
        // Respect "Limpiar Etapa 1" tombstone: cleared local Stage 1 fields must not be refilled from the canonical copy
        const local77Cleared = Number(normalized.promptConfig?.STAGE1_CLEARED_AT || 0) > 0;
        const pick77 = (k: keyof DocumentaryProject) =>
          local77Cleared ? (normalized as any)[k] ?? '' : (normalized as any)[k] || (canonical77 as any)[k];
        byId.set('doc-video-77-huellas', {
          ...canonical77,
          ...(local77Cleared ? { promptConfig: { ...(canonical77.promptConfig || {}), ...(normalized.promptConfig || {}) } } : {}),
          title:
            normalized.title && normalized.title !== 'Nuevo Documental — Huellas de la Humanidad'
              ? normalized.title
              : canonical77.title,
          topic: pick77('topic'),
          typology: pick77('typology'),
          historicalTime: pick77('historicalTime'),
          historicalLocation: pick77('historicalLocation'),
          targetDurationSeconds:
            normalized.targetDurationSeconds || canonical77.targetDurationSeconds,
          sectionsStructure: pick77('sectionsStructure'),
          deepResearchPrompt: pick77('deepResearchPrompt'),
          deepResearchResult: pick77('deepResearchResult'),
          voiceoverScript: normalized.voiceoverScript || canonical77.voiceoverScript,
          downloadFolderName: normalized.downloadFolderName || canonical77.downloadFolderName,
          downloadFolderPath: normalized.downloadFolderPath || canonical77.downloadFolderPath,
          geminiChatTitle: (normalized as any).geminiChatTitle || (canonical77 as any).geminiChatTitle,
          geminiChatUrl: normalized.geminiChatUrl || canonical77.geminiChatUrl,
          geminiDeepResearchChatUrl:
            (normalized as any).geminiDeepResearchChatUrl ||
            normalized.promptConfig?.GEMINI_DEEP_RESEARCH_CHAT_URL ||
            (canonical77 as any).geminiDeepResearchChatUrl ||
            canonical77.promptConfig?.GEMINI_DEEP_RESEARCH_CHAT_URL,
        } as any);
      } else {
        byId.set(l.id, normalized);
      }
    } else {
      const parseDocTimeMs = (v: any): number => {
        if (typeof v === 'number' && Number.isFinite(v)) return v;
        const s = String(v || '').trim();
        if (!s) return 0;
        if (/^\d{10,}$/.test(s)) return Number(s) || 0;
        return Date.parse(s) || 0;
      };
      const lTime = parseDocTimeMs((normalized as any).updatedAt || (normalized as any).createdAt);
      const rTime = parseDocTimeMs((existing as any).updatedAt || (existing as any).createdAt);
      if (lTime >= rTime) {
        byId.set(l.id, mergeTwoDocumentaryObjects(normalized, existing));
      } else {
        byId.set(l.id, mergeTwoDocumentaryObjects(existing, normalized));
      }
    }
  }

  const sorted = Array.from(byId.values()).sort((a, b) => {
    const parseSortMs = (v: any): number => {
      if (typeof v === 'number' && Number.isFinite(v)) return v;
      const s = String(v || '').trim();
      if (!s) return 0;
      if (/^\d{10,}$/.test(s)) return Number(s) || 0;
      return Date.parse(s) || 0;
    };
    const tA = parseSortMs((a as any).updatedAt || (a as any).createdAt);
    const tB = parseSortMs((b as any).updatedAt || (b as any).createdAt);
    return tB - tA;
  });

  return applyStoredClipReviewStateToDocs(sorted);
}

async function getGitHubFileSha(filePath: string, token: string): Promise<string | null> {
  try {
    const dirPath = filePath.includes('/') ? filePath.split('/').slice(0, -1).join('/') : '';
    const fileName = filePath.split('/').pop() || filePath;
    const url = `https://api.github.com/repos/${GITHUB_OWNER}/${GITHUB_REPO}/contents/${dirPath}?ref=${GITHUB_BRANCH}&t=${Date.now()}`;
    const headers: Record<string, string> = { Accept: 'application/vnd.github+json' };
    if (token) headers['Authorization'] = `token ${token}`;
    const res = await fetch(url, { headers, cache: 'no-store' });
    if (!res.ok) return null;
    const items = await res.json();
    if (Array.isArray(items)) {
      const found = items.find((it: any) => it && it.name === fileName);
      return found?.sha || null;
    }
  } catch {}
  return null;
}

export async function fetchRemoteDocumentariesFromGitHub(): Promise<DocumentaryProject[] | null> {
  const ghToken = getBrowserGitHubToken();

  // 1. Try GitHub Blob API (0-second cache delay, supports up to 100 MB)
  try {
    const sha = await getGitHubFileSha('data/documentaries.json', ghToken);
    if (sha) {
      const blobUrl = `https://api.github.com/repos/${GITHUB_OWNER}/${GITHUB_REPO}/git/blobs/${sha}?t=${Date.now()}`;
      const headers: Record<string, string> = { Accept: 'application/vnd.github.raw+json' };
      if (ghToken) headers['Authorization'] = `token ${ghToken}`;
      const res = await fetch(blobUrl, { headers, cache: 'no-store' });
      if (res.ok) {
        const parsed = await res.json();
        if (Array.isArray(parsed)) return parsed;
      }
    }
  } catch (e) {
    console.warn('GitHub Blob API fallback:', e);
  }

  // 2. Try raw.githubusercontent.com
  try {
    const rawUrl = `https://raw.githubusercontent.com/${GITHUB_OWNER}/${GITHUB_REPO}/${GITHUB_BRANCH}/data/documentaries.json?t=${Date.now()}`;
    const res = await fetch(rawUrl, { cache: 'no-store' });
    if (res.ok) {
      const parsed = await res.json();
      if (Array.isArray(parsed)) return parsed;
    }
  } catch (e) {
    console.warn('GitHub Raw fallback:', e);
  }

  // 3. Try relative static file on GitHub Pages (docs/data/documentaries.json)
  try {
    const relRes = await fetch(`data/documentaries.json?t=${Date.now()}`, { cache: 'no-store' });
    if (relRes.ok) {
      const parsed = await relRes.json();
      if (Array.isArray(parsed)) return parsed;
    }
  } catch {}

  return null;
}

let browserGitHubPushMutex: Promise<{ synced: boolean; error?: string }> | null = null;

async function fetchRemoteDocsBlobForBrowserPush(
  ghToken: string,
  headers: Record<string, string>
): Promise<{
  latestCommitSha: string | null;
  baseTreeSha: string | null;
  remoteDocs: DocumentaryProject[];
  remoteRawText: string | null;
}> {
  const refRes = await fetch(
    `https://api.github.com/repos/${GITHUB_OWNER}/${GITHUB_REPO}/git/ref/heads/${GITHUB_BRANCH}?t=${Date.now()}`,
    { headers, cache: 'no-store' }
  );
  if (refRes.status === 404) {
    return { latestCommitSha: null, baseTreeSha: null, remoteDocs: [], remoteRawText: null };
  }
  if (!refRes.ok) {
    throw new Error(`GitHub ref HTTP ${refRes.status}`);
  }
  const refData = await refRes.json();
  const latestCommitSha = String(refData?.object?.sha || '').trim();
  if (!latestCommitSha) {
    throw new Error('Missing remote HEAD commit SHA');
  }

  const commitRes = await fetch(
    `https://api.github.com/repos/${GITHUB_OWNER}/${GITHUB_REPO}/git/commits/${latestCommitSha}?t=${Date.now()}`,
    { headers, cache: 'no-store' }
  );
  if (!commitRes.ok) {
    throw new Error(`GitHub commit HTTP ${commitRes.status}`);
  }
  const commitData = await commitRes.json();
  const baseTreeSha = String(commitData?.tree?.sha || '').trim();
  if (!baseTreeSha) {
    throw new Error('Missing remote base tree SHA');
  }

  const treeRes = await fetch(
    `https://api.github.com/repos/${GITHUB_OWNER}/${GITHUB_REPO}/git/trees/${baseTreeSha}?recursive=1&t=${Date.now()}`,
    { headers, cache: 'no-store' }
  );
  if (!treeRes.ok) {
    throw new Error(`GitHub tree HTTP ${treeRes.status}`);
  }
  const treeData = await treeRes.json();
  const entry = Array.isArray(treeData?.tree)
    ? treeData.tree.find((t: any) => t?.path === 'data/documentaries.json' && t?.sha)
    : null;
  if (!entry) {
    return { latestCommitSha, baseTreeSha, remoteDocs: [], remoteRawText: null };
  }

  const blobRes = await fetch(
    `https://api.github.com/repos/${GITHUB_OWNER}/${GITHUB_REPO}/git/blobs/${entry.sha}?t=${Date.now()}`,
    {
      headers: {
        Accept: 'application/vnd.github.raw+json',
        Authorization: `token ${ghToken}`,
      },
      cache: 'no-store',
    }
  );
  if (!blobRes.ok) {
    throw new Error(`GitHub blob HTTP ${blobRes.status}`);
  }
  const remoteRawText = await blobRes.text();
  const parsed = JSON.parse(remoteRawText);
  if (!Array.isArray(parsed)) {
    throw new Error('Remote documentaries blob is not an array');
  }
  return { latestCommitSha, baseTreeSha, remoteDocs: parsed, remoteRawText };
}

export async function pushDocumentariesToGitHub(
  docsList: DocumentaryProject[]
): Promise<{ synced: boolean; error?: string }> {
  const executePush = async (): Promise<{ synced: boolean; error?: string }> => {
    const ghToken = getBrowserGitHubToken();
    if (!ghToken) {
      return { synced: false, error: 'Sin GitHub Token configurado en este dispositivo.' };
    }

    const headers: Record<string, string> = {
      Accept: 'application/vnd.github+json',
      Authorization: `token ${ghToken}`,
      'Content-Type': 'application/json',
    };

    for (let attempt = 1; attempt <= 3; attempt++) {
      try {
        const { latestCommitSha, baseTreeSha, remoteDocs, remoteRawText } =
          await fetchRemoteDocsBlobForBrowserPush(ghToken, headers);

        const mergedList =
          remoteDocs.length > 0
            ? mergeDocumentariesLists(docsList, remoteDocs, getLocalDeletedDocIds())
            : docsList;

        try {
          saveLocalCachedDocumentaries(mergedList);
        } catch {}

        let jsonStr = JSON.stringify(stripHeavyMediaForStorage(mergedList, false), null, 2);
        if (jsonStr.length > 3500000) {
          jsonStr = JSON.stringify(stripHeavyMediaForStorage(mergedList, true), null, 2);
        }

        if (remoteRawText && remoteRawText.trim() === jsonStr.trim()) {
          return { synced: true };
        }

        if (!latestCommitSha || !baseTreeSha) {
          return { synced: false, error: 'Sin commit base remoto para sincronizar.' };
        }

        const blobRes = await fetch(
          `https://api.github.com/repos/${GITHUB_OWNER}/${GITHUB_REPO}/git/blobs`,
          {
            method: 'POST',
            headers,
            body: JSON.stringify({ content: jsonStr, encoding: 'utf-8' }),
          }
        );
        if (!blobRes.ok) {
          return { synced: false, error: `GitHub blob HTTP ${blobRes.status}` };
        }
        const blobData = await blobRes.json();
        const newBlobSha = blobData?.sha;
        if (!newBlobSha) {
          return { synced: false, error: 'GitHub blob sin SHA' };
        }

        const treeRes = await fetch(
          `https://api.github.com/repos/${GITHUB_OWNER}/${GITHUB_REPO}/git/trees`,
          {
            method: 'POST',
            headers,
            body: JSON.stringify({
              base_tree: baseTreeSha,
              tree: [
                {
                  path: 'data/documentaries.json',
                  mode: '100644',
                  type: 'blob',
                  sha: newBlobSha,
                },
                {
                  path: 'docs/data/documentaries.json',
                  mode: '100644',
                  type: 'blob',
                  sha: newBlobSha,
                },
              ],
            }),
          }
        );
        if (!treeRes.ok) {
          return { synced: false, error: `GitHub tree HTTP ${treeRes.status}` };
        }
        const treeData = await treeRes.json();
        const newTreeSha = treeData?.sha;
        if (!newTreeSha) {
          return { synced: false, error: 'GitHub tree sin SHA' };
        }

        const newCommitRes = await fetch(
          `https://api.github.com/repos/${GITHUB_OWNER}/${GITHUB_REPO}/git/commits`,
          {
            method: 'POST',
            headers,
            body: JSON.stringify({
              message: `Sync documentaries.json (${mergedList.length} documentales)`,
              tree: newTreeSha,
              parents: [latestCommitSha],
            }),
          }
        );
        if (!newCommitRes.ok) {
          return { synced: false, error: `GitHub commit HTTP ${newCommitRes.status}` };
        }
        const newCommitData = await newCommitRes.json();
        if (!newCommitData?.sha) {
          return { synced: false, error: 'GitHub commit sin SHA' };
        }

        const updateRefRes = await fetch(
          `https://api.github.com/repos/${GITHUB_OWNER}/${GITHUB_REPO}/git/refs/heads/${GITHUB_BRANCH}`,
          {
            method: 'PATCH',
            headers,
            body: JSON.stringify({ sha: newCommitData.sha, force: false }),
          }
        );
        if (updateRefRes.ok) {
          return { synced: true };
        }
        if ((updateRefRes.status === 422 || updateRefRes.status === 409) && attempt < 3) {
          await new Promise((r) => setTimeout(r, 250 * attempt));
          continue;
        }
        return { synced: false, error: `GitHub ref PATCH HTTP ${updateRefRes.status}` };
      } catch (e: any) {
        if (attempt < 3) {
          await new Promise((r) => setTimeout(r, 250 * attempt));
          continue;
        }
        console.warn('Error pushing documentaries to GitHub (fail-closed):', e);
        return { synced: false, error: e?.message || 'Error al sincronizar con GitHub' };
      }
    }
    return { synced: false, error: 'Límite de reintentos CAS alcanzado en GitHub.' };
  };

  const prev = browserGitHubPushMutex || Promise.resolve({ synced: true });
  const current = prev.catch(() => ({ synced: true })).then(() => executePush());
  browserGitHubPushMutex = current;
  try {
    return await current;
  } finally {
    if (browserGitHubPushMutex === current) {
      browserGitHubPushMutex = null;
    }
  }
}

// ============================================================================
// CLIENT-SIDE GEMINI FALLBACKS FOR MOBILE / GITHUB PAGES MODE
// ============================================================================
export function confirmPaidGeminiApiUsage(actionDescription: string = 'generar contenido'): boolean {
  if (typeof window === 'undefined') return false;
  return window.confirm(
    `⚠️ ADVERTENCIA DE USO DE API DIRECTA (CON COSTO):\n\n` +
      `Estás a punto de usar la API directa de Gemini para "${actionDescription}", la cual NO es gratuita.\n\n` +
      `• Presiona CANCELAR para denegar el uso de la API y usar gratis tu cuenta de Gemini Web mediante la Extensión de Chrome.\n` +
      `• Presiona ACEPTAR únicamente si autorizas expresamente usar la API directa en este momento.`
  );
}

async function callGeminiGenerateContentClientSide(
  parts: any[],
  jsonMode = false
): Promise<string> {
  if (!confirmPaidGeminiApiUsage('consulta a Gemini vía API directa')) {
    throw new Error(
      'Uso de API directa denegado por el usuario. Utiliza Gemini Web gratis con la Extensión de Chrome.'
    );
  }
  const apiKey = getBrowserGeminiKey();
  if (!apiKey) {
    throw new Error(
      'Configura tu Gemini API Key en el botón superior "Configurar API Key / Nube" (o abre el Enlace Mágico desde tu laptop).'
    );
  }

  const models = [
    'gemini-3.1-pro-preview',
    'gemini-3-flash-preview',
    'gemini-2.5-flash',
    'gemini-2.5-flash-lite',
  ];
  let lastErr = '';

  for (const model of models) {
    try {
      const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${encodeURIComponent(
        apiKey
      )}`;
      const body: any = {
        contents: [{ role: 'user', parts }],
      };
      if (jsonMode) {
        body.generationConfig = { responseMimeType: 'application/json' };
      }
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      const data = await res.json();
      if (!res.ok) {
        lastErr = data?.error?.message || `HTTP ${res.status}`;
        continue;
      }
      const text = data?.candidates?.[0]?.content?.parts
        ?.map((p: any) => p.text || '')
        .join('')
        .trim();
      if (text) return text;
    } catch (e: any) {
      lastErr = e?.message || String(e);
    }
  }

  throw new Error(lastErr || 'No se pudo conectar con Gemini desde el navegador.');
}

export function buildStagePromptText(
  stageNumber: number,
  doc: DocumentaryProject,
  customInstruction?: string
): string {
  const { clip1Sec, standardClipSec } = getStage1ClipDurations(doc);
  const clipDurationLabel = `${standardClipSec} seconds`;
  const c1Dur = clip1Sec;
  const voiceEntrySec = c1Dur + 2;
  const clip2StartSec = doc.clip1SyncMode === 'RALENTIZAR_CAPCUT' ? c1Dur + 2 : c1Dur;
  const youtubeViralLink = (
    doc.promptConfig?.YOUTUBE_VIRAL_LINK ||
    doc.promptConfig?.YOUTUBE_SELECTED_LIBRARY_LINK ||
    ''
  ).trim();
  const selectedAnalyzedVideoId = (
    doc.promptConfig?.SELECTED_ANALYZED_VIDEO_ID || ''
  ).trim();
  const youtubeCommentsResearchBlock = (
    doc.promptConfig?.YOUTUBE_COMMENTS_RESEARCH_BLOCK || ''
  ).trim();
  const selectedStructureTitle = (
    doc.promptConfig?.SELECTED_ANALYZED_VIDEO_TITLE ||
    doc.promptConfig?.ESTRUCTURA_VIRAL_TITULO ||
    doc.promptConfig?.YOUTUBE_VIDEO_TITLE ||
    ''
  ).trim();
  const selectedStructureSummary = (
    doc.promptConfig?.SELECTED_ANALYZED_VIDEO_SUMMARY ||
    doc.promptConfig?.ESTRUCTURA_VIRAL_RESUMEN ||
    ''
  ).trim();
  const youtubeVideoTitle = (
    doc.promptConfig?.YOUTUBE_VIDEO_TITLE ||
    selectedStructureTitle ||
    ''
  ).trim();
  const youtubeVideoDescription = (doc.promptConfig?.YOUTUBE_VIDEO_DESCRIPTION || '').trim();
  const youtubeVideoTags = (doc.promptConfig?.YOUTUBE_VIDEO_TAGS || '').trim();
  const youtubeVideoChannel = (doc.promptConfig?.YOUTUBE_VIDEO_CHANNEL || '').trim();
  const centralParadox = (doc.promptConfig?.CONTRADICCION_CENTRAL || '').trim();
  const excludePreviousParts = (doc.promptConfig?.EXCLUIR_PARTES_ANTERIORES || '').trim();
  const selectedAudienceQuestions = (
    doc.promptConfig?.SELECTED_AUDIENCE_COMMENTS_BLOCK ||
    doc.promptConfig?.COMENTARIOS_AUDIENCIA_SELECCIONADOS ||
    ''
  ).trim();

  const fixedIntroSec = 8;
  const fixedOutroSec = 8;
  const clip1TimelineSec = doc.clip1SyncMode === 'RALENTIZAR_CAPCUT' ? c1Dur + 2 : Math.max(8, c1Dur);
  const fullEntrySec = fixedIntroSec + clip1TimelineSec;
  const totalTargetSec = doc.targetDurationSeconds || 120;
  const effectiveNarratedSec = Math.max(20, totalTargetSec - fullEntrySec - fixedOutroSec);

  const hasExplicitMetadataFields = Boolean(
    youtubeVideoTitle || youtubeVideoDescription || youtubeVideoTags
  );
  const metadataAlreadyInCommentsBlock =
    youtubeCommentsResearchBlock.includes('ANÁLISIS DE TÍTULO, DESCRIPCIÓN Y TAGS DEL VIDEO DE YOUTUBE') ||
    youtubeCommentsResearchBlock.includes('YOUTUBE VIDEO TITLE, DESCRIPTION & TAGS ANALYSIS');

  const standaloneYoutubeMetadataBlock =
    (hasExplicitMetadataFields || youtubeViralLink) && !metadataAlreadyInCommentsBlock
      ? `\n================================================================================\n🏷️ VIRAL PATTERN ANALYSIS (TITLE, DESCRIPTION & TAGS) OF THE REFERENCE YOUTUBE VIDEO (${youtubeViralLink || youtubeVideoTitle})\n================================================================================\n- ANALYZED VIDEO TITLE (USE STRICTLY AS A VIRAL PATTERN GUIDE, NEVER DUPLICATE ITS SUBJECT): "${youtubeVideoTitle || youtubeViralLink}"${
          youtubeVideoChannel ? `\n- SOURCE CHANNEL: ${youtubeVideoChannel}` : ''
        }\n- ANALYZED VIDEO TAGS / KEYWORDS: ${
          youtubeVideoTags || '(Analyze search intent strategy and tag psychology of the reference video)'
        }\n- ANALYZED VIDEO DESCRIPTION:\n${
          youtubeVideoDescription
            ? youtubeVideoDescription.slice(0, 3500)
            : '(Analyze chapter architecture, narrative pacing, and retention hooks from the reference video description)'
        }\n\n-> GOLDEN ORIGINALITY RULE (STRICTLY FORBIDDEN TO DUPLICATE THE ANALYZED VIDEO):\n   • Do NOT duplicate or create a video about the same topic, brand, person, or event as the analyzed reference video.\n   • Use the analyzed video EXCLUSIVELY as a STRUCTURAL BLUEPRINT AND VIRAL PATTERN GUIDE to extract the psychological mechanics that made it go viral on YouTube:\n     1. From the TITLE: Extract its psychological pattern and CTR formula (e.g., numeric contrast, survival paradox, hidden historical revelation) and apply that EXACT SAME PATTERN to a 100% ORIGINAL historical topic for our channel.\n     2. From the DESCRIPTION: Extract its chapter/timestamp architecture, tension cadence, act proportions, and summary hooks as a structural mold for our documentary.\n     3. From TAGS & COMMENTS: Extract curiosity triggers, human emotions, and open questions that captivated viewers to replicate that retention effect in our own original historical story.\n`
      : '';

  const viralContextBlock = selectedStructureSummary
    ? `\n================================================================================\n🏛️ STRUCTURAL BLUEPRINT & VIRAL PATTERNS FROM ANALYZED REFERENCE VIDEO: "${selectedStructureTitle || youtubeViralLink}"\n================================================================================\nVIRAL PATTERN BREAKDOWN & STRUCTURE EXTRACTED FROM THIS REFERENCE VIDEO:\n${selectedStructureSummary}\n\n⚠️ MANDATORY INSTRUCTION (DO NOT DUPLICATE TOPIC — USE ONLY AS STRUCTURAL & VIRAL BLUEPRINT):\nStrictly FORBIDDEN to duplicate or copy the topic, character, brand, or event of the analyzed video. Use it SOLELY as a structural mold and analysis of the viral mechanics (hook formula, act pacing, retention micro-hooks, dramatic contrasts, and psychological triggers) applied to a 100% ORIGINAL historical documentary for "Huellas de la Humanidad".\n${standaloneYoutubeMetadataBlock}${
        youtubeCommentsResearchBlock ? `\n${youtubeCommentsResearchBlock}\n` : ''
      }`
    : youtubeViralLink
    ? `\n================================================================================\n🔥 REFERENCE YOUTUBE VIDEO TO ANALYZE AS STRUCTURAL & VIRAL BLUEPRINT: ${youtubeViralLink}\n================================================================================\n⚠️ MANDATORY INSTRUCTION (DO NOT DUPLICATE ANALYZED VIDEO — USE AS VIRAL PATTERN GUIDE):\nDo NOT duplicate the topic or story of the pasted video (${youtubeViralLink}). Analyze in depth WHAT PATTERNS AND DETAILS MADE IT GO VIRAL ON YOUTUBE and apply them as a structural blueprint for a 100% ORIGINAL and DIFFERENT historical documentary for our channel "Huellas de la Humanidad":\n1) Perform a viral X-ray of the reference video (${youtubeViralLink}), breaking down its TITLE (click formula & contrast), DESCRIPTION (chapter architecture & promises), TAGS (search intent), and 8 viral axes: Hook (0-30s), Percentage act outline, Retention micro-hooks, Psychological triggers, Script cadence, Visual/sound direction, Viral packaging, and Transferable Master Pattern.\n2) Apply those viral patterns, proportions, and retention mechanics to our original documentary in progress (never repeating the topic of the analyzed video).\n${standaloneYoutubeMetadataBlock}${
        youtubeCommentsResearchBlock ? `\n${youtubeCommentsResearchBlock}\n` : ''
      }`
    : standaloneYoutubeMetadataBlock || youtubeCommentsResearchBlock
    ? `\n${standaloneYoutubeMetadataBlock}${youtubeCommentsResearchBlock}\n`
    : '';

  let stagePrompt = '';
  if (stageNumber === 10) {
    const cleanTopic = (doc.topic || '').trim();
    const cleanTypology = (doc.typology || '').trim();
    const cleanTime = (doc.historicalTime || '').trim();
    const cleanLoc = (doc.historicalLocation || '').trim();
    stagePrompt = `Act as Chief Documentary Director and Lead Historical Researcher for the Spanish-language documentary channel "Huellas de la Humanidad".
This is STAGE 1 — PHASE 1 (4 Carbon · Thinking level: Low · WITHOUT Deep Research): Viral pattern analysis of the reference video + Determination of Historical Definition, Continuity, and Mathematical Calibration for our ORIGINAL documentary.${viralContextBlock}

CRITICAL OUTPUT LANGUAGE REQUIREMENT:
Write all explanatory prose, summaries, and option texts in Spanish (Neutral Documentary Spanish for our producer UI), while keeping the exact structural section markers requested below.

================================================================================
🏛️ CURRENT HISTORICAL DEFINITION & MATHEMATICAL CALIBRATION STATE TO DETERMINE
================================================================================
- Protocol Typology: ${
      cleanTypology ||
      'BLANK (Determine which of the 8 protocol typologies to use OR CREATE A NEW universal archetypal typology based on the VIRAL PATTERN of the analyzed video, WITHOUT copying the topic of the analyzed video)'
    }
- Central Documentary Topic: ${
      cleanTopic ||
      'BLANK (Propose 3+ 100% ORIGINAL, DIFFERENT, and UNPUBLISHED historical topics for "Huellas de la Humanidad" —STRICTLY FORBIDDEN to duplicate the topic of the analyzed video— applying the exact same viral patterns, contrasts, and structure)'
    }
- Historical Time / Era (years in digits, centuries in Roman numerals): ${
      cleanTime ||
      'BLANK (Automatically determine with years in digits or Century in Roman numerals matching our new original topic, e.g., Año 1888 / Siglo XIX)'
    }
- Historical Location (City, Country): ${
      cleanLoc || 'BLANK (Automatically determine City, Country matching our new original topic)'
    }
${
  excludePreviousParts
    ? `- Continuity / FORBIDDEN Elements that MUST NOT be repeated from previous episodes: ${excludePreviousParts}\n`
    : ''
}- ⏱️ Selected Mathematical Calibration:
  • Target Total Project Duration: ~${totalTargetSec} seconds (~${(totalTargetSec / 60).toFixed(0)} minutes)
  • Official Brand Intro: 00:00 - 00:08 (${fixedIntroSec}s fixed)
  • Clip 1 (Visual Hook without voiceover): 00:08 - 00:${String(fullEntrySec).padStart(2, '0')} (${clip1TimelineSec}s)
  • Narrative Voiceover Entry & Body Clips (${clipDurationLabel} each): Second ${fullEntrySec} (00:${String(fullEntrySec).padStart(2, '0')}) for ~${effectiveNarratedSec}s of effective narration
  • Official Brand Outro at closing: Last ${fixedOutroSec} fixed seconds
${selectedAudienceQuestions ? `\n💬 SELECTED AUDIENCE COMMENTS & QUESTIONS:\n${selectedAudienceQuestions}\n` : ''}
================================================================================
⚡ PHASE 1 TASK (VIRAL PATTERN ANALYSIS + ORIGINAL HISTORICAL DEFINITION & MATHEMATICAL CALIBRATION)
================================================================================
⚠️ CRITICAL ORIGINALITY RULE:
- Do NOT duplicate the analyzed video or create a documentary about the same subject/brand/event.
- Use the analyzed video EXCLUSIVELY as a structural guide to extract the PATTERNS and DETAILS that made it viral on YouTube and apply them to a 100% ORIGINAL documentary for "Huellas de la Humanidad".
- In PARTE 1 (Video Typology), NEVER write the name or specific topic of the analyzed video; define a reusable universal archetypal typology.

Deliver this structured report in Spanish with MULTIPLE OPTIONS (3, 4, 5, 6, or as many options as angles emerge from the analyzed video) preserving the exact Spanish section headers below for parser compatibility:

0. RESUMEN POR PARTES DE LA PROPOSICIÓN PARA NUESTRO DOCUMENTAL ORIGINAL:
   Deliver numbered options (Opción 1, Opción 2, Opción 3, Opción 4...) in Spanish for each of the 7 parts:
   - PARTE 1 — TIPOLOGÍA DEL VIDEO:
     • Resumen de esta parte: [Explain in Spanish which narrative/psychological patterns made the reference video go viral and which protocol/new archetypal typologies fit our original documentary]
     • Opción 1..N: [Multiple universal archetypal typologies in Spanish — NEVER mention the specific topic of the analyzed video]
   - PARTE 2 — TEMA CENTRAL DEL DOCUMENTAL / EPISODIO:
     • Resumen de esta parte: [Explain in Spanish how the viral formula maps to 100% ORIGINAL historical topics for "Huellas de la Humanidad"]
     • Opción 1..N: [Multiple 100% ORIGINAL historical topics in Spanish using the same contrast, tension, and retention mechanics]
   - PARTE 3 — TIEMPO / ÉPOCA HISTÓRICA:
     • Resumen de esta parte: [Justification in Spanish of the chronological timeframe matching Parts 1 & 2]
     • Opción 1..N: [Multiple chronological scopes in Spanish with years in digits and Centuries in Roman numerals, e.g., Año 1888 / Siglo XIX]
   - PARTE 4 — LUGAR HISTÓRICO:
     • Resumen de esta parte: [Justification in Spanish of the geographic settings matching Parts 1 & 2]
     • Opción 1..N: [Multiple geographic settings in Spanish (City, Country)]
   - PARTE 5 — GANCHO INICIAL Y CONTRADICCIÓN / ÁNGULO CENTRAL (CLIP 1 + APERTURA):
     • Resumen de esta parte: [How we adapt the reference video's Hook patterns to our new original documentary]
     • Opción 1..N: [Visual/narrative Hook variants (00:08) and central paradox in Spanish]
   - PARTE 6 — CALIBRACIÓN MATEMÁTICA Y ESCALETA POR ACTOS (~${(totalTargetSec / 60).toFixed(0)} MIN):
     • Resumen de esta parte: [How we map block percentages and pacing to ~${(totalTargetSec / 60).toFixed(0)} min with 8s Intro and 8s Outro]
     • Opción 1..N: [Mathematical act outlines by percentage (%) and minutes in Spanish]
   - PARTE 7 — CLÍMAX HISTÓRICO, REVELACIÓN Y CIERRE REFLEXIVO:
     • Resumen de esta parte: [Emotional and historical payoff strategy leading into the 8s Outro]
     • Opción 1..N: [Historical climax and reflective ending options in Spanish]

1. RADIOGRAFÍA DE PATRONES VIRALES DEL VIDEO INVESTIGADO:
   - Detailed breakdown in Spanish of the exact patterns that made the reference video go viral (Title formula, Description chapter pacing, Tag intent, Comment triggers, block percentages, and psychological hooks) and how they serve as a mold for our ~${(totalTargetSec / 60).toFixed(0)}-minute documentary.

2. DURACIÓN TOTAL SUGERIDA DEL DOCUMENTAL:
   - Evaluate topic complexity, act density, plot twists, climax weight, and chronological span to recommend the optimal official studio duration (600s = 10 min, 900s = 15 min, 1200s = 20 min, 1800s = 30 min, 3600s = 1 hour, 7200s = 2 hours).
   - RECOMENDACIÓN_DURACIÓN_TOTAL: [Write EXACTLY one of these values in seconds: 600 | 900 | 1200 | 1800 | 3600 | 7200]
   - DURACIÓN TOTAL SUGERIDA: [e.g., 15 minutos (900s) o 20 minutos (1200s)]
   - JUSTIFICACIÓN DE DURACIÓN: [Explain in Spanish why that exact duration is ideal based on topic, acts, plot development, and climax].`;
  } else if (stageNumber === 1 || stageNumber === 2 || stageNumber === 3) {
    const cleanTopic = (doc.topic || '').trim();
    const cleanTypology = (doc.typology || '').trim();
    const cleanTime = (doc.historicalTime || '').trim();
    const cleanLoc = (doc.historicalLocation || '').trim();
    const chosenHookProp = (
      doc.promptConfig?.PROPOSICION_GANCHO ||
      doc.promptConfig?.ANGULO_CENTRAL ||
      centralParadox ||
      ''
    ).trim();
    const chosenEscaletaProp = (doc.promptConfig?.PROPOSICION_ESCALETA || '').trim();
    const chosenClimaxProp = (doc.promptConfig?.PROPOSICION_CLIMAX || '').trim();
    const part1AnalysisText = (doc.deepResearchPrompt || '').trim();
    const referenceVideoLabel =
      selectedStructureTitle ||
      youtubeVideoTitle ||
      youtubeViralLink ||
      selectedAnalyzedVideoId;

    stagePrompt = `Act as a Master Historian, Film Director, and Chief Documentary Investigator for "Huellas de la Humanidad".
This is STAGE 1 — PHASE 2 (DEEP HISTORICAL RESEARCH WITH GEMINI DEEP RESEARCH + 4 CARBON THINKING LEVEL: LOW), building upon the Historical Definition, the Selected Analyzed Library Video from Step 1, and the Mathematical Calibration established in Phase 1.${viralContextBlock}

CRITICAL OUTPUT LANGUAGE REQUIREMENT:
Deliver the entire historical research dossier and structural outline in clear, rigorous Documentary Spanish so it directly feeds the Spanish Voiceover Script in the next stage.

================================================================================
🏛️ HISTORICAL DEFINITION, REFERENCE LIBRARY VIDEO & CALIBRATION FROM PHASE 1
================================================================================
${
  referenceVideoLabel
    ? `- 📚 Selected Analyzed Library / Structural Reference Video from Step 1 (PART OF THIS DEEP RESEARCH): "${referenceVideoLabel}"${
        selectedAnalyzedVideoId ? ` [ID: ${selectedAnalyzedVideoId}]` : ''
      }${youtubeViralLink ? ` (${youtubeViralLink})` : ''}\n`
    : ''
}- Confirmed Protocol Typology: ${cleanTypology || 'To be confirmed in research'}
- Confirmed Central Documentary Topic: ${cleanTopic || 'To be confirmed in research'}
- Confirmed Historical Time / Era: ${cleanTime || 'To be confirmed in research'}
- Confirmed Historical Location (City, Country): ${cleanLoc || 'To be confirmed in research'}
${chosenHookProp ? `- Selected Opening Hook & Central Paradox (Part 5): ${chosenHookProp}\n` : ''}${
      chosenEscaletaProp ? `- Selected Mathematical Calibration & Act Outline (Part 6): ${chosenEscaletaProp}\n` : ''
    }${chosenClimaxProp ? `- Selected Historical Climax & Reflective Ending (Part 7): ${chosenClimaxProp}\n` : ''}${
      excludePreviousParts
        ? `- Continuity / FORBIDDEN Elements NOT to repeat from previous parts: ${excludePreviousParts}\n`
        : ''
    }- ⏱️ Video Mathematical Calibration (with 8s Official Brand Intro & Outro):
  • Target Total Project Duration: ~${totalTargetSec} seconds (~${(totalTargetSec / 60).toFixed(1)} min)
  • Official Brand Intro: 00:00 - 00:08 (${fixedIntroSec}s fixed — no voiceover or background music)
  • Clip 1 (Visual Hook with On-Screen Text, no voiceover): 00:08 - 00:${String(fullEntrySec).padStart(2, '0')} (${clip1TimelineSec}s)
  • Narrative Voiceover Entry & Body Clips (${clipDurationLabel} each): Second ${fullEntrySec} (00:${String(fullEntrySec).padStart(2, '0')}) for ~${effectiveNarratedSec}s of effective narration
  • Official Brand Outro at closing: Last ${fixedOutroSec} fixed seconds
${selectedAudienceQuestions ? `\n💬 SELECTED AUDIENCE COMMENTS & QUESTIONS TO ANSWER IN DEEP RESEARCH:\n${selectedAudienceQuestions}\n` : ''}${
      part1AnalysisText
        ? `\n📌 PHASE 1 PRIOR CONCLUSIONS (DEFINITION & CALIBRATION):\n${part1AnalysisText.slice(0, 3500)}\n`
        : ''
    }
================================================================================
🔬 DEEP RESEARCH TASK (4 CARBON · THINKING LEVEL: LOW + DEEP RESEARCH)
================================================================================
Execute an exhaustive Deep Research investigation on the topic, era, location, and structure above, integrating the Step 1 Analyzed Reference Video strictly as a structural and retention mold (never copying its topic), and deliver the report in Spanish organized into these 4 clear sections:
1. MATHEMATICAL & STRUCTURAL BREAKDOWN BY ACTS (~${(totalTargetSec / 60).toFixed(0)} MIN WITH 8S INTRO & 8S OUTRO + VIRAL PATTERNS FROM STEP 1):
   - Exact map of narrative acts with percentage (%), exact time range, turning points, and retention micro-hooks calibrated to the Step 1 reference blueprint.
2. CHRONOLOGICAL HISTORICAL ACCOUNT, UNUSUAL FACTS & DOCUMENTED CONTRADICTIONS:
   - Deep act-by-act historical account with exact dates, verified numbers, laws, contracts, period prices, sensory details (smells, sounds, textures, architecture), and historical answers to audience questions.
3. COMPLETE PRIMARY-SOURCE RESEARCH DOSSIER (ARCHIVES, CHRONICLES & RECORDS):
   - Documented facts, judicial/commercial/archaeological records, real human micro-stories with verified names, and historical quotes ready to feed the Voiceover Script.
4. EARLY PRE-DETECTION OF KEY @CHARACTERS & @LOCATIONS (FOR GOOGLE FLOW REFERENCES):
   - List of historical protagonists (@Character_Name) and primary settings (@Location_Name) with physical traits, age, face, and exact period attire (${cleanTime || 'target era'}, ${cleanLoc || 'target location'}).`;
  } else if (stageNumber === 4) {
    const introPlacement = doc.promptConfig?.UBICACION_INTRO_MARCA || 'INTRO_INICIO_00';
    const FIXED_INTRO_SEC = 8;
    const FIXED_OUTRO_SEC = 8;
    const effectiveVoiceEntrySec =
      introPlacement === 'INTRO_INICIO_00' ? voiceEntrySec + FIXED_INTRO_SEC : voiceEntrySec;
    const budget = computeCalibratedVoiceoverBudget(
      doc.targetDurationSeconds || 900,
      effectiveVoiceEntrySec,
      FIXED_OUTRO_SEC
    );
    const perActWords6 = Math.max(40, Math.round(budget.targetWords / 6));
    const isRecalibratingExisting =
      doc.promptConfig?.RECALIBRATE_SCRIPT_TO_DURATION === 'SI' &&
      Boolean((doc.voiceoverScript || '').trim());
    const chosenHookProp = (
      doc.promptConfig?.PROPOSICION_GANCHO ||
      doc.promptConfig?.CONTRADICCION_CENTRAL ||
      ''
    ).trim();
    const chosenActsProp = (doc.promptConfig?.PROPOSICION_ESCALETA || '').trim();
    const chosenClimaxProp = (doc.promptConfig?.PROPOSICION_CLIMAX || '').trim();
    const chosenPropositionBlock =
      chosenHookProp || chosenActsProp || chosenClimaxProp
        ? `\nSelected Documentary Proposition by Parts:\n${
            doc.typology ? `- Typology: ${doc.typology}\n` : ''
          }${chosenHookProp ? `- Opening Hook & Central Angle: ${chosenHookProp}\n` : ''}${
            chosenActsProp ? `- Act Outline & Development: ${chosenActsProp}\n` : ''
          }${chosenClimaxProp ? `- Climax & Reflective Ending: ${chosenClimaxProp}\n` : ''}`
        : '';

    if (isRecalibratingExisting) {
      const cleanedCurrent = cleanVoiceoverNarrationOnly(doc.voiceoverScript || '');
      const currentWords = stripPauseTags(cleanedCurrent)
        .trim()
        .split(/\s+/)
        .filter(Boolean).length;
      stagePrompt = `Act as Lead Historian and Chief Documentary Script Editor for the Spanish-language channel "Huellas de la Humanidad".
In Stage 1 this documentary was configured for a TOTAL DURATION OF ${budget.totalMinutesLabel} MINUTES (${budget.totalDurationSec} seconds).
However, the current script draft has ${currentWords} words, which when synthesized by our TTS engine (Charon at 147 words/minute) produces an audio duration far from the requested ${budget.totalMinutesLabel} minutes.

CRITICAL OUTPUT LANGUAGE REQUIREMENT:
Output the calibrated voiceover script EXCLUSIVELY in Neutral Latin American Documentary Spanish (Español Neutro Documental), containing ONLY the exact spoken words for the narrator plus [pausa: Xs] pause tags.

REWRITE AND CALIBRATE this Spanish historical script so it matches EXACTLY ${budget.totalMinutesLabel} minutes:
- STRICT UNBREAKABLE WORD BUDGET: The complete delivered Spanish script MUST contain BETWEEN ${budget.minWords} AND ${budget.maxWords} WORDS in total (exact target: ~${budget.targetWords} words, ~${budget.targetChars} characters; ~${perActWords6} words per internal block across 6 blocks). Strictly FORBIDDEN to exceed ${budget.maxWords} words or fall below ${budget.minWords} words.
- Preserve all key historical milestones, dates, real names, dramatic tension, retention micro-hooks, and documentary rigor of the original story, condensing redundant descriptions without amputating any act.
- Mandatorily preserve in Spanish:
  1) The opening triad first sentence closed with a period: "Año [digits], [Place, City, Country]. [Intriguing premise]." (Never write "en el" after the year).
  2) Independent Paragraph 2 with the Full Channel Slogan: "En los próximos minutos... Si quieres seguir cruzando el umbral del tiempo para vivir la historia desde dentro, dale like a este video, compártelo y suscríbete. Cada historia deja una huella. Aquí seguimos sus rastros."${
    introPlacement === 'INTRO_POST_SLOGAN' ? ' followed immediately by [pausa: 8s]' : ''
  }.
  3) Strategic pause tags [pausa: 1.5s] or [pausa: 2s] (~${budget.estPauseSec}s total pauses).
  4) The final paragraph starting with "Déjanos saber en los comentarios..." and closing with "Cada historia deja una huella. Aquí seguimos sus rastros.".
- Write all years in digits, centuries and monarchs in Roman numerals (e.g., siglo XIX, Felipe II), thousands using the Spanish word "mil" (e.g., "70 mil"), and ZERO exclamation marks (!).
- MANDATORY FIRST DAY OF THE MONTH PHONETIC RULE IN SPANISH NARRATION ("primero", NEVER "1" NOR "uno"): Whenever the Spanish voiceover mentions the first day of any month, ALWAYS spell it out with the Spanish word "primero" (e.g., "el primero de septiembre de 1939", "Primero de enero de 1885, La Habana, Cuba.", "aquel primero de mayo"). Writing "1 de [month]", "01 de [month]", "1º de [month]", or "uno de [month]" is strictly forbidden.
- 100% CLEAN VOXFLOW DELIVERY FORMAT (ZERO TECHNICAL CLUTTER): Output SOLELY the exact Spanish words the narrator will read aloud (with [pausa: Xs] tags). Strictly FORBIDDEN to include headers ("ETAPA 4...", "STAGE 4..."), act/chapter titles, timestamps like "(00:00 - 00:08...)", parenthetical stage/camera notes, or word-count footers. Start directly with "Año ..." and end directly with "...Aquí seguimos sus rastros.".

CURRENT SPANISH SCRIPT TO CALIBRATE TO ${budget.totalMinutesLabel} MINUTES (~${budget.targetWords} WORDS):
"""
${cleanedCurrent}
"""`;
    } else {
      stagePrompt = `Act as a Master Historian, Film Director, and Professional Investigative Journalist for the Spanish-language documentary channel "Huellas de la Humanidad".
Topic: ${doc.topic || doc.title} (${doc.historicalTime}, ${doc.historicalLocation})
Typology: ${doc.typology || 'Historical Documentary'}${chosenPropositionBlock}
Target Total Duration Selected in Stage 1: ${budget.totalMinutesLabel} MINUTES (${budget.totalDurationSec} seconds)
Historical Definition & Calibration (Step 1):
${doc.deepResearchPrompt || ''}
Deep Historical Research (Step 2 — Deep Research):
${doc.deepResearchResult || (!doc.deepResearchPrompt ? doc.sectionsStructure || '' : '')}

CRITICAL OUTPUT LANGUAGE REQUIREMENT:
Write the complete VOICEOVER SCRIPT 100% in Neutral Latin American Documentary Spanish (Español Neutro Documental) obeying every unbreakable rule below:
- STRICT DURATION & WORD BUDGET (${budget.totalMinutesLabel} REAL MINUTES IN VOXFLOW): Our TTS narrator (Charon) speaks at 147 words per minute. Subtracting ${effectiveVoiceEntrySec}s of initial non-spoken intro, ${FIXED_OUTRO_SEC}s of closing Outro, and ~${budget.estPauseSec}s of [pausa: Xs] tags leaves ~${budget.netSpeechSec}s of net speech. Therefore, THE ENTIRE SPANISH SCRIPT MUST CONTAIN BETWEEN ${budget.minWords} AND ${budget.maxWords} WORDS (exact target: ~${budget.targetWords} words / ~${budget.targetChars} characters; ~${perActWords6} words across each of 6 internal narrative blocks). Strictly FORBIDDEN to exceed ${budget.maxWords} words.
- 100% PURE SPOKEN NARRATION FORMAT (ZERO HEADERS OR TIMESTAMPS): Output SOLELY the exact spoken Spanish prose read by the narrator (plus [pausa: Xs] tags). Strictly FORBIDDEN to write titles ("STAGE 4", "GUION"), act names, timestamps like "(00:00 - 00:08 | Intro...)", camera/sound notes in parentheses, or word-count reports at the end. Begin directly with the first spoken Spanish word ("Año ...") and finish directly with "...Aquí seguimos sus rastros.".
- Open mandatorily with the triad in the very first sentence closed by a period: "Año [year in digits], [Place, City, Country]. [Intriguing premise]." (Never write "en el" after the year).
- Write years in digits, centuries and monarchs in Roman numerals (e.g., siglo XIX, Felipe II), thousands with the word "mil" (e.g., "70 mil"), and ZERO exclamation marks (!).
- MANDATORY FIRST DAY OF THE MONTH PHONETIC RULE IN SPANISH NARRATION ("primero", NEVER "1" NOR "uno"): Whenever the Spanish voiceover mentions the first day of any month, ALWAYS write the Spanish word "primero" (e.g., "el primero de septiembre de 1939", "Primero de enero de 1885, La Habana, Cuba.", "aquel primero de mayo"). Strictly FORBIDDEN to write "1 de [month]", "01 de [month]", "1º de [month]", or "uno de [month]".
- Include strategic pause tags such as [pausa: 1.5s] or [pausa: 2s].
- For long-form documentaries, include before second 30 the Full Channel Slogan as a standalone Paragraph 2 ("En los próximos minutos... Cada historia deja una huella. Aquí seguimos sus rastros.")${
        introPlacement === 'INTRO_POST_SLOGAN'
          ? ' and IMMEDIATELY at the end of Paragraph 2 place the mandatory tag [pausa: 8s] so the 8-second Official Brand Intro (Intro.mp4) plays cleanly before Paragraph 3'
          : ''
      }.
- Close in a standalone final paragraph starting with "Déjanos saber en los comentarios..." and ending with the exact slogan: "Cada historia deja una huella. Aquí seguimos sus rastros."`;
    }
  } else if (stageNumber === 5) {
    const thumbOrientation =
      doc.thumbnailOrientation ||
      (doc.productionType === 'REEL_9X16' ? 'VERTICAL_9X16' : 'HORIZONTAL_16X9');
    const isThumbHorizontal = thumbOrientation === 'HORIZONTAL_16X9';
    const overlayLines = String(doc.thumbnailTextOverlay || '')
      .replace(/\r\n/g, '\n')
      .split('\n')
      .map((l) => l.trim().replace(/"/g, "'"))
      .filter(Boolean);
    const isUserLockedOverlay =
      doc.promptConfig?.THUMBNAIL_OVERLAY_USER_LOCKED === 'SI' && overlayLines.length > 0;
    const hasUserOverlay = isUserLockedOverlay;
    const overlayPositionPhrase = isThumbHorizontal
      ? 'positioned in the bottom-left area of the image'
      : 'centered and middle-justified right in the middle center of the image';
    const userOverlayEnglishClause = hasUserOverlay
      ? overlayLines.length === 1
        ? `bold high-contrast cinematic documentary typography text overlay ${overlayPositionPhrase} reading "${overlayLines[0]}"`
        : `bold high-contrast cinematic documentary typography text overlay ${overlayPositionPhrase} stacked across ${
            overlayLines.length
          } exact separate lines (${overlayLines
            .map((line, idx) => `Line ${idx + 1}: "${line}"`)
            .join(' / ')})`
      : '';
    const overlayInstructionBlock = hasUserOverlay
      ? `Explicit user-locked on-screen text (MANDATORY to use these exact Spanish lines across all 3 options): ${
          overlayLines.length === 1
            ? `"${overlayLines[0]}"`
            : `${overlayLines.length} separate lines -> ${overlayLines
                .map((l, idx) => `Line ${idx + 1}: "${l}"`)
                .join(' / ')}`
        }`
      : `On-screen text (TEXTO_PANTALLA): Propose 3 DISTINCT Curiosity-Gap hooks in UPPERCASE SPANISH (one unique hook for A, a different one for B, and a different one for C; 2 to 4 words across 1 or 2 lines separated by " / ", specific to THIS documentary and NEVER repeating the video title).`;
    const refsContext = Array.isArray(doc.references)
      ? doc.references
          .slice(0, 6)
          .map((r) => `${r.tag}: ${r.prompt}`)
          .join('\n')
      : '';
    const clipsContext = Array.isArray(doc.clips)
      ? doc.clips
          .slice(0, 6)
          .map((c) => c.imagePrompt)
          .filter(Boolean)
          .join('\n')
      : '';
    const aspectPhrase = isThumbHorizontal
      ? '16:9 horizontal aspect ratio'
      : '9:16 vertical aspect ratio';
    const badgeLabel = isThumbHorizontal ? '8K' : 'HD';
    const stripStage1MetaLabel = (raw?: string) =>
      String(raw || '')
        .replace(/^\s*\([^)]*\)\s*:\s*/g, '')
        .replace(/\s*—\s*(?:Recomendada|Arco hist[oó]rico completo[^)]*|Escenario hist[oó]rico principal[^)]*)/gi, '')
        .trim();
    const cleanDocTopic = stripStage1MetaLabel(doc.topic || doc.title);
    const cleanDocTime = stripStage1MetaLabel(doc.historicalTime || doc.clip1Line1LocationTime || '');
    const cleanDocLoc = stripStage1MetaLabel(doc.historicalLocation || '');
    stagePrompt = `Act as an Expert YouTube CTR Neuropsychology Designer and Creative Art Director for "Huellas de la Humanidad".
Project Title: ${doc.title || ''}
Historical Topic: ${cleanDocTopic} (${cleanDocTime}, ${cleanDocLoc})
Clip 1 Hook: ${doc.clip1Line1LocationTime || ''} — ${doc.clip1Line2Hook || ''}
REAL Documentary Script / Research (ABSOLUTE PRIORITY over any provisional title):
"""
${(doc.voiceoverScript || doc.deepResearchResult || doc.deepResearchPrompt || doc.sectionsStructure || '').slice(0, 2400)}
"""
Documentary Characters & Locations (@References):
${refsContext}
Opening Visual Scenes (Clips):
${clipsContext}
Active Orientation: ${isThumbHorizontal ? 'HORIZONTAL (16:9)' : 'VERTICAL (9:16)'}
${overlayInstructionBlock}

MANDATORY TASK — 3 DYNAMIC NEUROPSYCHOLOGICAL CLICK TRIGGERS TAILORED TO THIS VIDEO + THEIR 3 PROMPTS 100% IN ENGLISH:
Design 3 distinct Neuropsychological Click Trigger options ([DISPARADOR_A], [DISPARADOR_B], [DISPARADOR_C]) crafted 100% custom for the real story of THIS documentary.
Strictly FORBIDDEN to use generic fixed labels like "Face + Shock (13ms)", "Curiosity Gap", or "Scale + Danger". Each TITULO and DESCRIPCION (in Spanish for our producer UI) must name the concrete historical moment, physical trigger object, real setting, or exact twist of THIS specific video, applying the 5 CTR neuropsychology laws:
1. 13-MILLISECOND VISUAL PROCESSING (ZERO VISUAL CLUTTER): Ultra-clean composition of maximum 3 visual elements (1 dominant foreground face + 1 real physical story prop/element + hook overlay text), instantly readable on mobile.
2. HUMAN FACE + EXTREME EMOTION + DIRECT EYE CONTACT: Story protagonist occupying 60% of the frame in Medium Close-Up or Extreme Close-Up, staring straight into the lens ("direct piercing eye contact into the camera lens"), wide eyes showing white sclera, authentic visceral emotion, skin pores, and sweat.
3. CURIOSITY GAP: Each of the 3 options must depict a distinct concrete physical scene, period prop, and historical setting from THIS documentary (FORBIDDEN to write vague phrases like "shadowy betrayal" or "enigmatic forbidden historical detail").
4. COLOR PSYCHOLOGY & HIGH CONTRAST: Dramatic chiaroscuro with warm key light (burning amber, gold, or crimson firelight) on the face and rim light separating the subject from a cold dark background (nocturnal cyan-blue or deep shadows).
5. UNBREAKABLE TECHNICAL RULES INSIDE EVERY "PROMPT:" (SINGLE LINE, 100% PURE ENGLISH — ZERO SPANISH PROSE):
   - 100% ENGLISH LANGUAGE: Inside "PROMPT:" it is STRICTLY FORBIDDEN to write Spanish prose or copy Spanish topic labels; the ONLY Spanish words allowed inside "PROMPT:" are the quoted on-screen text overlay and the brand logo sub-text "Huellas de la Humanidad".
   - Start literally with: "Thumbnail: Create an image in ${aspectPhrase} "
   - ${
     hasUserOverlay
       ? `Include verbatim: '${userOverlayEnglishClause}'`
       : `Include that option's Spanish overlay text using verbatim: 'bold high-contrast cinematic documentary typography text overlay ${overlayPositionPhrase} reading "SINGLE LINE"' (or if TEXTO_PANTALLA has 2 lines separated by " / ", use: 'bold high-contrast cinematic documentary typography text overlay ${overlayPositionPhrase} stacked across 2 exact separate lines (Line 1: "FIRST" / Line 2: "SECOND")')`
   }
   - Include verbatim: 'a small discreet 5% scale logo in the top-right corner displaying "${badgeLabel}" in metallic gold'
   - Include verbatim: 'official page logo cleanly integrated in the top-left corner from provided reference image at 5% scale, strictly preserving and visibly rendering both the logo emblem and the exact text underneath it "Huellas de la Humanidad" without cropping, blurring, or omitting the sub-text'
   - ANTI-FILTER SHIELD: Always describe the character by physical traits, approximate adult age, and period attire as an anonymous historical reenactment actor ("portrayed by an anonymous historical reenactment actor in authentic period attire (no real public figures or prominent people)"), NEVER writing real public-figure proper names inside the English prompt.
   - End verbatim with: 'cinematic documentary realism, 8k resolution, sharp focus, safe framing composition, no modern objects, no CGI look, no unintended floating text, no music.'

STRICT DELIVERY FORMAT (output ONLY these 3 exact plain-text blocks WITHOUT ** asterisks around field labels and without greetings or closing remarks):
[DISPARADOR_A]
TITULO: Opción A: <Specific 3-to-7 word Spanish title based on a key moment/object of THIS documentary>
DESCRIPCION: <1 to 2 Spanish sentences explaining the specific scene, 13ms facial expression, and why it opens an irresistible curiosity gap>
TEXTO_PANTALLA: ${hasUserOverlay ? overlayLines.join(' / ') : '<2 TO 4 WORD UPPERCASE SPANISH HOOK (use " / " if 2 lines)>'}
PROMPT: Thumbnail: Create an image in ${aspectPhrase} ...

[DISPARADOR_B]
TITULO: Opción B: <Second specific 3-to-7 word Spanish angle based on another real twist/scene of THIS documentary>
DESCRIPCION: <1 to 2 Spanish sentences explaining this second unique visual trigger>
TEXTO_PANTALLA: ${hasUserOverlay ? overlayLines.join(' / ') : '<SECOND 2 TO 4 WORD UPPERCASE SPANISH HOOK>'}
PROMPT: Thumbnail: Create an image in ${aspectPhrase} ...

[DISPARADOR_C]
TITULO: Opción C: <Third specific 3-to-7 word Spanish angle based on another real revelation/scene of THIS documentary>
DESCRIPCION: <1 to 2 Spanish sentences explaining this third unique visual trigger>
TEXTO_PANTALLA: ${hasUserOverlay ? overlayLines.join(' / ') : '<THIRD 2 TO 4 WORD UPPERCASE SPANISH HOOK>'}
PROMPT: Thumbnail: Create an image in ${aspectPhrase} ...`;
  } else if (stageNumber === 6) {
    const isRefVertical = isVerticalProductionDoc(doc);
    const refAspect = isRefVertical ? '9:16 vertical aspect ratio' : '16:9 horizontal aspect ratio';
    stagePrompt = `Act as a Master Historian and Documentary Director of Photography for "Huellas de la Humanidad".
Based on this voiceover script and historical topic (${doc.topic || doc.title}, ${doc.historicalTime}, ${doc.historicalLocation}):
"""
${doc.voiceoverScript || doc.deepResearchResult || doc.deepResearchPrompt || doc.sectionsStructure || ''}
"""
Generate STAGE 6: REFERENCE MODEL IMAGE PROMPTS 100% IN ENGLISH for Nano Banana 2.1 in Google Flow (**6 views in each single image** and specifying the **exact ASCII @Tag_With_Underscores** without spaces or accents):
- Prepend at the very top this exact English operational directive for Google Flow:
  Use Nano Banana 2.1. Generate each image as a single 6-view reference sheet (6 views in a 3x2 grid) and mandatorily rename every generated image to the exact @Tag_With_Underscores identifier specified in each prompt.
- For each primary CHARACTER (@People), write a single-line prompt 100% in English with this exact format (no accents or spaces in @Character_Name):
  Image @Character_Name [Image Name: @Character_Name]: Create an image in ${refAspect} structured as a 6-view character reference sheet (6 distinct views in a single 3x2 grid image of the exact same person with 100% identical facial, hair, and wardrobe continuity: 1. front full-body standing view, 2. three-quarter full-body view, 3. side profile full-body view, 4. back full-body view, 5. neutral front close-up portrait of head and shoulders, 6. three-quarter close-up portrait showing skin pores and facial structure), depicting [detailed adult physical traits, hair, facial structure, and head-to-toe authentic historical period attire (${doc.historicalTime}, ${doc.historicalLocation}) against a clean neutral studio background with even lighting, without mentioning real monarchs' or politicians' proper names in the physical description, portrayed by an anonymous historical reenactment actor in authentic period costume, no real public figures or prominent people], 8k photorealistic cinematic documentary realism, uncropped 6-panel reference sheet, strictly no text, no labels, no numbers, no words, no speech, no music. fix the name to @Character_Name
- For each primary LOCATION (@Locations), write a single-line prompt 100% in English with this exact format (with @ and underscores _ without accents or spaces in @Location_Name):
  Image @Location_Name [Image Name: @Location_Name]: Create an image in ${refAspect} structured as a 6-view historical location reference sheet (6 distinct views in a single 3x2 grid image of the exact same historical location with 100% architectural, material, and atmospheric continuity: 1. wide establishing shot, 2. reverse wide angle, 3. medium focal architectural view, 4. ground-level entrance or street perspective, 5. elevated overview angle, 6. close-up structural materials and period lighting detail), depicting [exact historical architecture, materials, period (${doc.historicalTime}, ${doc.historicalLocation}), and atmospheric lighting in English], strictly empty environment with zero people, zero animals, and zero characters anywhere in the frame, 8k photorealistic cinematic documentary realism, uncropped 6-panel reference sheet, strictly no text, no labels, no numbers, no words, no speech, no music. fix the name to @Location_Name
- PURE DELIVERY FORMAT (100% ENGLISH): Output ONLY plain text starting with the English operational directive followed by the Image @Name_... lines separated by a blank line, WITHOUT ** asterisks, WITHOUT section headers like "Characters:" or "Locations:", and WITHOUT greetings or closing remarks.`;
  } else if (stageNumber === 7) {
    const scriptContext = (
      doc.voiceoverScript ||
      doc.timelineFormattedText ||
      doc.deepResearchResult ||
      doc.deepResearchPrompt ||
      doc.sectionsStructure ||
      ''
    )
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, 900);
    const clip1VisualContext = (doc.clips?.[0]?.imagePrompt || '').trim();
    stagePrompt = `Act as Creative Director for the Spanish-language documentary channel "Huellas de la Humanidad".
Topic: ${doc.topic || doc.title || ''} | Location: ${doc.historicalLocation || 'Determine from script'} | Era: ${doc.historicalTime || 'Determine from script'}
Video Title: ${doc.title || doc.topic || ''}
Thumbnail On-Screen Text: ${doc.thumbnailTextOverlay || 'None'}
${clip1VisualContext ? `Clip 1 Visual Scene: ${clip1VisualContext}\n` : ''}Reference Script: "${scriptContext}"

CRITICAL OUTPUT LANGUAGE REQUIREMENT:
Write all 3 on-screen text options in SPANISH (since Spanish viewers read this opening title card on screen) using the exact Option/Line markers below:

Propose EXACTLY 3 magnetic options for the CLIP 1 ON-SCREEN TEXT (First ${voiceEntrySec}s of the video, no voiceover):
Opción 1:
Línea 1: [City, Country, Año XXXX (ALWAYS prefixing the capitalized Spanish word "Año" before the 4-digit year, e.g., "Santander, España, Año 1885") OR Siglo XX (ALWAYS writing "Siglo" with capital S + Roman numeral, e.g., "París, Francia, Siglo XIII")]
Línea 2: [INTRIGUING YET TOPIC-REVEALING SPANISH HOOK TITLE IN UPPERCASE, ZERO EXCLAMATION MARKS]

Opción 2:
Línea 1: [City, Country, Año XXXX or Siglo XX]
Línea 2: [INTRIGUING YET TOPIC-REVEALING SPANISH HOOK TITLE IN UPPERCASE, ZERO EXCLAMATION MARKS]

Opción 3:
Línea 1: [City, Country, Año XXXX or Siglo XX]
Línea 2: [INTRIGUING YET TOPIC-REVEALING SPANISH HOOK TITLE IN UPPERCASE, ZERO EXCLAMATION MARKS]

UNBREAKABLE STAGE 7 RULES:
1. LINE 1 FORMAT ("Año" / "Siglo"): If using a specific year, it MUST start with "Año" before the digits (e.g., "Londres, Inglaterra, Año 1888"). If using a century, write "Siglo" + uppercase Roman numeral (e.g., "París, Francia, Siglo XIII").
2. INTRIGUING YET TOPIC-SPECIFIC LINE 2: Strictly FORBIDDEN to use vague, poetic, or generic phrases that hide the documentary's subject. Line 2 MUST immediately signal the concrete historical topic while sparking intense curiosity.
3. NO VERBATIM REPETITION: Do not copy word-for-word the Video Title or the Thumbnail Overlay Text.`;
  } else if (stageNumber === 8) {
    const opHeader = sanitizeOperationalHeader(
      doc.operationalHeader || DEFAULT_OPERATIONAL_HEADER,
      doc.flowVideoEngine || 'HYBRID_PEOPLE_OMNI_REST_LOWER'
    );
    const fmtMmSs = (sec: number): string => {
      const s = Math.max(0, Math.round(sec));
      const mm = Math.floor(s / 60);
      const ss = s % 60;
      return `${String(mm).padStart(2, '0')}:${String(ss).padStart(2, '0')}`;
    };
    const stripMeta = (raw?: string) =>
      String(raw || '')
        .replace(/^\s*\([^)]*\)\s*:\s*/g, '')
        .replace(/\s*—\s*(?:Recomendada|Arco hist[oó]rico completo[^)]*|Escenario hist[oó]rico principal[^)]*)/gi, '')
        .trim();
    const cleanStage8Topic = stripMeta(doc.topic || doc.title);
    const cleanStage8Time = stripMeta(doc.historicalTime || '');
    const cleanStage8Loc = stripMeta(doc.historicalLocation || '');
    const cleanHookProposal = stripMeta(
      doc.promptConfig?.PROPOSICION_GANCHO || doc.promptConfig?.ANGULO_CENTRAL || doc.clip1Line2Hook || ''
    );
    const rawTlAll = parseTimelineTextToSentences(doc.timelineFormattedText || '');
    const clip1Marker = rawTlAll.find((s) =>
      /^\[SIN\s+VOZ\s+NARRATIVA[^\]]*Clip\s+1/i.test((s.text || '').trim())
    );
    const tlSentences = rawTlAll.filter(
      (s) =>
        !/^\[SIN\s+VOZ\s+NARRATIVA[^\]]*(?:Intro\s+Oficial|Outro\s+Oficial|Clip\s+1)/i.test(
          (s.text || '').trim()
        )
    );
    const c1RangeLabel = clip1Marker
      ? `${fmtMmSs(clip1Marker.start)} - ${fmtMmSs(clip1Marker.end)}`
      : `00:00 - ${fmtMmSs(clip2StartSec)}`;
    const c2StartLabel = clip1Marker
      ? fmtMmSs(clip1Marker.end)
      : fmtMmSs(clip2StartSec);
    const expectedTotalClips = tlSentences.length > 0 ? tlSentences.length + 1 : 0;
    const rawBrollInterval = String(doc.promptConfig?.BROLL_ESTATICO_INTERVALO_MIN ?? '2').trim();
    const brollIntervalMin =
      rawBrollInterval.toUpperCase() === 'OFF' || rawBrollInterval === '0'
        ? 0
        : Math.max(1, parseFloat(rawBrollInterval) || 2);
    const periodicBrollTargets =
      brollIntervalMin > 0 && tlSentences.length > 0
        ? pickPeriodicStaticBrollTimelineTargets(
            tlSentences.map((s, idx) => {
              const num = idx + 2;
              const needsOff = tlSentences[0].start < 2.0 && !clip1Marker;
              const st = needsOff ? s.start + clip2StartSec : s.start;
              const en = needsOff ? s.end + clip2StartSec : s.end;
              return { clipNum: num, startSec: st, endSec: en, text: s.text };
            }),
            brollIntervalMin
          )
        : new Map();
    const preNumberedTimelineRows =
      tlSentences.length > 0
        ? [
            `Clip 01 (${c1RangeLabel}) [Stage 1 Flow Duration: ${c1Dur}s — Silent Visual Hook]: ${
              cleanHookProposal || 'Silent atmospheric historical opening visual hook establishing the central tension'
            }`,
            ...tlSentences.map((s, idx) => {
              const num = idx + 2;
              const numLabel = num < 10 ? `0${num}` : `${num}`;
              const needsOff = tlSentences[0].start < 2.0 && !clip1Marker;
              const st = needsOff ? s.start + clip2StartSec : s.start;
              const en = needsOff ? s.end + clip2StartSec : s.end;
              const brollMot = periodicBrollTargets.get(num);
              const brollSuffix = brollMot
                ? ` ★ [MANDATORY IMAGE-ONLY STATIC B-ROLL PLATE — Output ONLY "Image ${numLabel}: Create an image ... [Time: ${fmtMmSs(st)} - ${fmtMmSs(en)}] [Duration: ${standardClipSec}s] [Model: Nano Banana 2.1] [IMAGE ONLY — DO NOT GENERATE VIDEO CLIP] [B-Roll: ${BROLL_MOTION_TAG_BY_KEY[brollMot]}] fix the name" and DO NOT output a "Clip ${numLabel}:" line! Strictly zero live people, zero readable text; 4K 60fps ${BROLL_MOTION_ENGLISH_PHRASE[brollMot]} is rendered locally in our editor]`
                : '';
              return `Clip ${numLabel} (${fmtMmSs(st)} - ${fmtMmSs(en)}) [Stage 1 Flow Duration: ${standardClipSec}s]: "${s.text}"${brollSuffix}`;
            }),
          ].join('\n')
        : doc.timelineFormattedText || doc.voiceoverScript || '';
    const periodicBrollClause =
      brollIntervalMin > 0
        ? `\n- PERIODIC IMAGE-ONLY STATIC B-ROLL PLATES (~EVERY ${brollIntervalMin} MINUTES — ZERO VIDEO CLIP IN FLOW): Roughly every ${brollIntervalMin} minutes (and on every row marked ★ [MANDATORY IMAGE-ONLY STATIC B-ROLL PLATE] above), design ONLY "Image NN: Create an image ..." as a 100% still archival/documentary B-roll plate (historical artifact, specimen, apparatus, architecture, scientific plate, map, or document with strictly zero live people and zero readable text/proper names) ending with "[Time: MM:SS - MM:SS] [Duration: ${standardClipSec}s] [Model: Nano Banana 2.1] [IMAGE ONLY — DO NOT GENERATE VIDEO CLIP] [B-Roll: STATIC_<MOTION>] fix the name" (choosing STATIC_ZOOM_IN, STATIC_ZOOM_OUT, STATIC_PAN_RIGHT, STATIC_PAN_LEFT, STATIC_TILT_UP, or STATIC_TILT_DOWN), and STRICTLY OMIT "Clip NN:" for that scene number so Google Flow generates ONLY the still image while our Mac video editor applies the 4K 60fps camera movement locally.`
        : '';
    const expectedClipsClause =
      expectedTotalClips > 1
        ? `\nMANDATORY 1:1 EXACT SCENE COUNT & TIMESTAMPS: The pre-numbered Timeline table below omits fixed Brand Intro/Outro MP4s and contains EXACTLY ${expectedTotalClips} production scenes (Clip 01 = ${c1RangeLabel} silent visual Hook of ${c1Dur}s in Flow; Scenes 02..${expectedTotalClips} = ${tlSentences.length} spoken segments starting at ${c2StartLabel} of ${standardClipSec}s each). Output 1 Image+Clip pair for every regular scene and ONLY 1 standalone "Image NN:" line (with [Time: MM:SS - MM:SS] and [IMAGE ONLY — DO NOT GENERATE VIDEO CLIP]) for Static B-Roll scenes, covering scene numbers 01 through ${expectedTotalClips} with zero skipped numbers, copying each row's exact (MM:SS - MM:SS) range verbatim without ever recalculating a 10s grid, grouping lines, or stopping early.`
        : '';
    const refsListText =
      Array.isArray(doc.references) && doc.references.length > 0
        ? doc.references
            .map((r) => `${r.tag} (${r.category === 'persona' ? 'Character — triggers Omni 1.1 Flash' : 'Location — use Veo 3.1 - Lite [Lower Priority] if zero humans appear'})`)
            .join(', ')
        : 'Use characters and locations from the script';
    stagePrompt = `Act as a historian, film director, and professional journalist.
Generate STAGE 8: INITIAL IMAGE PROMPTS (Nano Banana 2.1) AND VIDEO CLIP PROMPTS (Hybrid Mode: Omni 1.1 Flash when people appear / Veo 3.1 - Lite [Lower Priority] for scenes without people) 100% IN PURE ENGLISH for the documentary "${cleanStage8Topic}" (${cleanStage8Time}, ${cleanStage8Loc}).
Mandatory visual references (@Characters & @Locations from Stage 4): ${refsListText}.
Stage 1 Selected Clip Durations (MANDATORY inside EVERY video prompt):
- Clip 01 (${c1RangeLabel}): ${c1Dur} seconds in Google Flow -> write "Create a cinematic ${c1Dur}-second video showing ..." AND place "[Duration: ${c1Dur}s]" right before "[Model: ...] fix the name".
- Clips 02 through ${expectedTotalClips || 'N'} (starting at ${c2StartLabel}): ${standardClipSec} seconds in Google Flow -> write "Create a cinematic ${standardClipSec}-second video showing ..." AND place "[Duration: ${standardClipSec}s]" right before "[Model: ...] fix the name".${expectedClipsClause}
Pre-Numbered 1:1 Voiceover Timeline Table (Spanish narration provided strictly so each English visual scene matches that exact spoken phrase in meaning and time — NEVER copy Spanish words into Image N or Clip N):
"""
${preNumberedTimelineRows}
"""
Your output MUST BEGIN MANDATORILY AND VERBATIM with this exact 9-line English operational header:
${opHeader}

CRITICAL LANGUAGE, DURATION & SAFETY LAWS FOR GOOGLE FLOW:
- Write EVERY Image N and EVERY Clip N on its own separate line (zero-padded 01..09 for 1..9, NO ** bold markdown, NO bullets) 100% IN PURE ENGLISH from Clip 01 through Clip ${expectedTotalClips || 'N'}, where each Image N + Clip N visually depicts the exact historical moment, action, place, or object described in that numbered row's narration.
- STRICTLY ZERO SPANISH INSIDE PROMPTS: Never embed, quote, or append the Spanish voiceover sentence or Spanish UI labels inside Image N or Clip N.
- PRESERVE LITERAL FIRST 6 WORDS OF EVERY CLIP PROMPT: Every video prompt MUST start with "Clip NN (MM:SS - MM:SS): Create a cinematic {D}-second video showing ..." (words 1..6 = Clip NN (MM:SS - MM:SS): Create) and end with "[Duration: {D}s] [Model: Omni 1.1 Flash] fix the name" (when any person/hands/crowd/@Character appear) or "[Duration: {D}s] [Model: Veo 3.1 - Lite [Lower Priority]] fix the name" (when zero people appear, even if a @Location tag is used; explicitly write "with no people present" on empty scenes).${periodicBrollClause}
- Apply Anti-"Prominent People" Filter Shield (describe historical characters by adult physical traits and period attire as anonymous historical reenactment actors, never real public-figure proper names) + Anti-Mutation Physics + UNBREAKABLE NON-DUPLICATION RULE ACROSS CONSECUTIVE CLIPS (never repeat the same room, desk, or camera framing back-to-back; alternate angles, focal lengths, and interior/exterior spaces):
Image 01: Create an image of [clear ~25-40 word English visual scene matching Clip 01's visual Hook in ${cleanStage8Loc}, ${cleanStage8Time}, invoking matching @Character/@Location tags], clean uncluttered composition with rigid architectural perspective, stationary period props, clear anatomical separation between subjects, portrayed by anonymous historical reenactment actors in authentic period costume (no real public figures or prominent people), cinematic lighting, historical accuracy, no text.

Clip 01 (${c1RangeLabel}): Create a cinematic ${c1Dur}-second video showing [smooth controlled Steadicam/fluid-head camera movement + 1 continuous measured physical action matching Clip 01's visual Hook sustained smoothly across the full ${c1Dur} seconds (from 0s to ${c1Dur}s)]. Smooth, controlled fluid-head camera motion maintaining rigid 3D spatial perspective throughout the ${c1Dur}-second shot. Sustained, unhurried continuous action across the full ${c1Dur} seconds, holding a natural composed posture through the final frame. Fixed subject count from 0s to ${c1Dur}s (no new people appearing out of nowhere, vanishing, or morphing; background figures stationary in soft f/1.8 bokeh). Solid, non-deforming walls and rigid 3D architectural geometry. All tables, documents, furniture, and props remain 100% gravity-locked and stationary with zero self-moving objects. Cinematic historical drama reenactment featuring anonymous fictionalized theatre actors in period costume (no real public figures or prominent people, no unintended explosions or flashes). Ambient Foley: [specific English Foley sounds], single continuous shot, strictly no shot changes, no music, no speech, no text. [Duration: ${c1Dur}s] [Model: Omni 1.1 Flash or Veo 3.1 - Lite [Lower Priority]] fix the name`;
  } else if (stageNumber === 80) {
    // Compute exact documentary duration from last clip, voiceover audio, or confirmed duration
    const parseMmSsToSec = (str?: string): number => {
      if (!str) return 0;
      const m = String(str).match(/(\d{1,3}):(\d{2})/);
      if (!m) return 0;
      return parseInt(m[1], 10) * 60 + parseInt(m[2], 10);
    };
    const formatSecToMmSs = (sec: number): string => {
      const safe = Math.max(60, Math.round(sec));
      const mm = Math.floor(safe / 60);
      const ss = safe % 60;
      return `${String(mm).padStart(2, '0')}:${String(ss).padStart(2, '0')}`;
    };

    let lastClipEndSec = 0;
    if (Array.isArray(doc.clips) && doc.clips.length > 0) {
      for (const c of doc.clips) {
        const rangeParts = String(c.timeRange || '').split('-');
        const endPart = rangeParts[1] || rangeParts[0] || '';
        const endSec = parseMmSsToSec(endPart);
        if (endSec > lastClipEndSec) lastClipEndSec = endSec;
      }
      if (!lastClipEndSec) {
        lastClipEndSec = clip2StartSec + Math.max(0, doc.clips.length - 1) * standardClipSec;
      }
    }
    const voiceDurSec =
      Array.isArray(doc.audioTracks) && doc.audioTracks[0]?.duration
        ? Math.round(clip2StartSec + Number(doc.audioTracks[0].duration))
        : 0;
    const confirmedSec = parseMmSsToSec(doc.confirmedFinalDuration);
    const totalDocSec = Math.max(
      lastClipEndSec,
      voiceDurSec,
      confirmedSec > 125 ? confirmedSec : 0,
      doc.targetDurationSeconds || 120
    );
    const resolvedFinalDuration = formatSecToMmSs(totalDocSec);
    const outroStartSec = Math.max(0, totalDocSec - 90);
    const outroStartMmSs = formatSecToMmSs(outroStartSec);

    const minRecommendedTracks =
      totalDocSec >= 900 ? 5 : totalDocSec >= 660 ? 4 : totalDocSec >= 420 ? 3 : totalDocSec >= 240 ? 2 : 1;
    const maxRecommendedTracks =
      totalDocSec >= 900 ? 7 : totalDocSec >= 660 ? 6 : totalDocSec >= 420 ? 5 : totalDocSec >= 240 ? 3 : 2;

    const clipsVisualSummary =
      Array.isArray(doc.clips) && doc.clips.length > 0
        ? doc.clips
            .filter(
              (_, idx, arr) =>
                idx === 0 ||
                idx === arr.length - 1 ||
                idx % Math.max(1, Math.floor(arr.length / 18)) === 0
            )
            .map(
              (c) =>
                `Clip ${c.clipNumber} (${c.timeRange || ''}): ${(c.imagePrompt || '').slice(0, 120)} | Narration: "${(c.narrationSegment || '').slice(0, 90)}"`
            )
            .join('\n')
        : '';

    stagePrompt = `Act as Master Cinematic Film Composer for "Huellas de la Humanidad" targeting **FlowMusic (https://www.flowmusic.app/)**.
Documentary Topic: ${doc.topic || doc.title} (${doc.historicalTime || ''}, ${doc.historicalLocation || ''})
Exact Total Documentary Duration (computed from Voiceover & Clips): ${resolvedFinalDuration} (${totalDocSec} seconds total)
Total Visual Clips: ${Array.isArray(doc.clips) ? doc.clips.length : 'Follow Timeline'}

Narrative Script & Structure:
"""
${(doc.voiceoverScript || doc.sectionsStructure || '').slice(0, 2400)}
"""
${clipsVisualSummary ? `\nVisual Scene & Clip Map:\n${clipsVisualSummary}\n` : ''}
Generate **STAGE 8: SOUNDTRACK MUSIC (FLOWMUSIC — flowmusic.app)** strictly obeying these musical direction laws:
1. **DYNAMIC TRACK COUNT MATCHING PLOT & SCENES (${minRecommendedTracks} to ${maxRecommendedTracks} tracks)**: Design between **${minRecommendedTracks} and ${maxRecommendedTracks} distinct instrumental tracks** accompanying each dramatic and visual act.
2. **MANDATORY MUSIC-FREE BREATHING GAPS BETWEEN EVERY TRACK (MINIMUM 30 SECONDS, MAXIMUM 1 MINUTE / 0:30 to 1:00)**: Between the end of one track and the start of the next, leave a mandatory silent gap of **0:30 to 1:00 (30 to 60 seconds)** placed on a scene transition, rhetorical question, or dramatic beat where only Narration + ambient clip Foley play. Never leave less than 30s or more than 60s between tracks.
3. **MANDATORY 1:30 FINAL CLOSING TRACK (${outroStartMmSs} - ${resolvedFinalDuration})**: The final track closing the documentary MUST last **1:30** (1 minute 30 seconds), entering at **${outroStartMmSs}** and ending at **${resolvedFinalDuration}**.
4. **MANDATORY [End - M:SS] TAG AT THE END OF LYRICS PROMPT**: On the last line of field \`4. Lyrics Prompt\` for EVERY track, write \`[End - M:SS]\` matching that track's exact duration (e.g., \`[End - 2:30]\`, or \`[End - 1:30]\` on the final track).
5. **FADE-IN, FADE-OUT & DOCUMENTARY DUCKING BELOW NARRATOR**:
   - Every track enters with a **smooth 2.5s Fade-In** and exits with a **gentle 3.0s Fade-Out**.
   - Every track's **Style Prompt (100% in English)** MUST include verbatim: \`100% instrumental documentary film score, strictly no vocals, no singing, no spoken words, smooth 2.5-second fade-in intro, gentle 3-second fade-out outro, mixed as warm low-mid frequency underscore designed to sit softly below a male documentary narrator voice without competing in the 1kHz-4kHz vocal clarity range\` paired with authentic period acoustic instruments (${doc.historicalTime || ''}, ${doc.historicalLocation || ''}).
6. **EXACT DELIVERY FORMAT (6 FIELDS PER TRACK)**:
   Deliver each track numbered ("Track 1", "Track 2", ..., "Track N") with these exact 6 numbered fields:
   1. Track Title: [Evocative title matching the scene]
   2. Duration: [M:SS, e.g. 2:30; final track mandatorily 1:30]
   3. Video Time Range: [MM:SS - MM:SS (Clip X to Clip Y), respecting 0:30 to 1:00 without music between tracks]
   4. Lyrics Prompt: [100% English instrumental dynamic cue map with [00:00 Soft 2.5s Fade-In Intro], [Warm Documentary Underscore Below Voice], [Subtle Emotional Swell], [Gentle 3s Fade-Out Outro] and ending with [End - 2:30] matching exact duration]
   5. Style Prompt: [Complete 100% English prompt ready for FlowMusic (flowmusic.app), 100% instrumental, period instruments, BPM tempo, mood, fade-in intro, fade-out outro, and warm ducking below narrator]
   6. Scene Explanation: [Brief explanation in Spanish for our producer UI explaining why the score shifts here and what 30s-60s music-free gap precedes it]`;
  } else if (stageNumber === 101) {
    stagePrompt = `Act as a YouTube CTR Neuropsychology Expert and Creative Thumbnail Director for the Spanish-language documentary channel "Huellas de la Humanidad".
Video Title: ${doc.title || ''}
Clip 1 Opening On-Screen Text (first ${voiceEntrySec}s): ${doc.clip1Line2Hook || ''}
Historical Topic: ${doc.topic || doc.title || ''} (${doc.historicalTime || doc.clip1Line1LocationTime || ''}, ${doc.historicalLocation || ''})
REAL Documentary Script (ABSOLUTE PRIORITY over any provisional title):
"""
${(doc.voiceoverScript || doc.deepResearchResult || doc.deepResearchPrompt || doc.sectionsStructure || '').slice(0, 1400)}
"""

Applying the CURIOSITY GAP principle and 13-millisecond visual processing:
Generate EXACTLY 3 magnetic ON-SCREEN OVERLAY TEXT options for the thumbnail based 100% on the REAL Script above, written in **UPPERCASE SPANISH** (2 to 4 words maximum, ZERO exclamation marks) that:
1. Trigger an immediate open question in the viewer's mind without giving away the answer.
2. Complement the video title WITHOUT repeating any phrase from the Video Title or Clip 1 Text.
3. Are instantly legible in 13 milliseconds on a mobile screen.
Output ONLY the 3 Spanish lines, one per line, without numbering or quotation marks.`;
  } else if (
    stageNumber === 11 ||
    stageNumber === 111 ||
    stageNumber === 112 ||
    stageNumber === 113 ||
    stageNumber === 114 ||
    stageNumber === 115
  ) {
    const parseMmSsToSec11 = (str?: string): number => {
      if (!str) return 0;
      const parts = String(str)
        .trim()
        .split(':')
        .map((n) => parseInt(n, 10));
      if (parts.length === 2 && !isNaN(parts[0]) && !isNaN(parts[1])) {
        return parts[0] * 60 + parts[1];
      }
      if (parts.length === 3 && !isNaN(parts[0]) && !isNaN(parts[1]) && !isNaN(parts[2])) {
        return parts[0] * 3600 + parts[1] * 60 + parts[2];
      }
      return 0;
    };
    const formatSecToMmSs11 = (sec: number): string => {
      const s = Math.max(0, Math.round(sec));
      const m = Math.floor(s / 60);
      const r = s % 60;
      return `${String(m).padStart(2, '0')}:${String(r).padStart(2, '0')}`;
    };
    let lastClipEndSec11 = 0;
    if (Array.isArray(doc.clips) && doc.clips.length > 0) {
      for (const c of doc.clips) {
        const rangeParts = String(c.timeRange || '').split('-');
        const endPart = rangeParts[1] || rangeParts[0] || '';
        const endSec = parseMmSsToSec11(endPart);
        if (endSec > lastClipEndSec11) lastClipEndSec11 = endSec;
      }
      if (!lastClipEndSec11) {
        lastClipEndSec11 = clip2StartSec + Math.max(0, doc.clips.length - 1) * standardClipSec;
      }
    }
    const voiceDurSec11 =
      Array.isArray(doc.audioTracks) && doc.audioTracks[0]?.duration
        ? Math.round(clip2StartSec + Number(doc.audioTracks[0].duration))
        : 0;
    const confirmedSec11 = parseMmSsToSec11(doc.confirmedFinalDuration);
    const totalDocSec11 = Math.max(
      lastClipEndSec11,
      voiceDurSec11,
      confirmedSec11 > 125 ? confirmedSec11 : 0,
      doc.targetDurationSeconds || 120
    );
    const resolvedFinalDuration11 = formatSecToMmSs11(totalDocSec11);
    const isLongDoc11 = totalDocSec11 > 480;
    const titleSuffixRule11 = isLongDoc11
      ? 'Because the video exceeds 8 minutes, every title MUST end verbatim with the Spanish suffix " | Documental Completo".'
      : 'End with a "|" separator and a short Spanish topic keyword (without AI suffix or "| Huellas de la Humanidad").';
    const specificTitleLaw11 = `UNBREAKABLE SPANISH VIDEO TITLE LAW (ULTRA-SPECIFIC, HIGH-CTR & FAITHFUL TO THE REAL SCRIPT):
   - FORBIDDEN GENERIC OR VAGUE TITLES: Never output abstract or poetic titles that hide the concrete historical topic (e.g., forbidden "El Precio del Destino", "Sombras entre Dos Orillas", "Crónicas de un Imperio").
   - HISTORICAL SPECIFICITY + MAGNETIC HOOK FORMULA: Every Spanish title MUST explicitly name the historical protagonist, human group, emblematic place, or concrete event from the Script (years in digits, centuries/monarchs in Roman numerals, zero exclamation marks) paired with the central paradox, sacrifice, or revelation.
   - SMART NON-REPETITION: Do not copy verbatim the Thumbnail Overlay ("${doc.thumbnailTextOverlay || ''}") or Clip 1 Hook ("${doc.clip1Line2Hook || ''}"), while still naming the real historical subject. ${titleSuffixRule11}`;
    const chaptersTimelineGuide =
      Array.isArray(doc.clips) && doc.clips.length > 0
        ? doc.clips
            .filter(
              (_, idx, arr) =>
                idx === 0 ||
                idx === arr.length - 1 ||
                idx % Math.max(1, Math.floor(arr.length / 12)) === 0
            )
            .map(
              (c) =>
                `${String(c.timeRange || '').split('-')[0]?.trim() || '00:00'} -> "${(c.narrationSegment || c.imagePrompt || '').slice(0, 100)}"`
            )
            .join('\n')
        : '';

    if (stageNumber === 11) {
      stagePrompt = `[STAGE_11_ALL_METADATA]
Act as Chief Publishing & YouTube SEO Strategist for the Spanish-language documentary channel "Huellas de la Humanidad".
Documentary Topic: ${doc.topic || doc.title} (${doc.historicalTime || ''}, ${doc.historicalLocation || ''})
Confirmed Final Duration: ${resolvedFinalDuration11}
Thumbnail On-Screen Text: "${doc.thumbnailTextOverlay || ''}"
Clip 1 Opening Hook (${voiceEntrySec}s): "${doc.clip1Line2Hook || ''}"
REAL Documentary Script (ABSOLUTE PRIORITY):
"""
${(doc.voiceoverScript || doc.sectionsStructure || '').slice(0, 2200)}
"""
${chaptersTimelineGuide ? `\nReal Documentary Timestamp Guide for the 10 Chapters:\n${chaptersTimelineGuide}\n` : ''}
CRITICAL OUTPUT LANGUAGE REQUIREMENT:
All generated publication copy, chapters, disclaimers, slogans, hashtags, pinned comments, and SEO tags MUST be written 100% in SPANISH for our Hispanic audience, separated by these 4 exact uppercase markers:

===SECCION_YOUTUBE===
[Deliver the SPANISH YOUTUBE METADATA in continuous "Todo Corrido" format separated ONLY by braille blank lines (⠀):
1. ZERO section labels (forbidden "Título:", "Descripción:", "Nota IA:", "Slogan:", "Hashtags:") and NO Title line at the top (start directly at Paragraph 1 of the Spanish description), with the SINGLE mandatory exception of the Spanish header "Capítulos:".
2. Total length ~2800 to 3000 characters counting spaces and braille lines (⠀).
3. Spanish description divided into EXACTLY 3 dense, immersive paragraphs separated by a braille line (⠀).
4. Mandatory Spanish section "Capítulos:" with 10 chronological Spanish chapters from 00:00 to before ${resolvedFinalDuration11} (00:00 must name the opening story beat, NEVER "Prólogo" or "Introducción").
5. Verbatim Spanish AI Disclaimer: (Nota: Este documental inmersivo ha sido recreado utilizando herramientas de inteligencia artificial generativa basándonos estrictamente en registros históricos de la época. Es posible que existan incongruencias o errores visuales).
6. Verbatim Spanish Slogan: Cada historia deja una huella. Aquí seguimos sus rastros.
7. Exactly 5 Spanish hashtags in #CamelCase composed of TWO WORDS each.]

===SECCION_FACEBOOK===
[Deliver the SPANISH FACEBOOK METADATA in continuous format separated ONLY by braille blank lines (⠀):
1. ZERO section labels anywhere.
2. NO Chapters section and NO SEO Tags block.
3. Total length ~2800 to 3000 characters.
4. Line 1: Ultra-specific Spanish Title (obeying Historical Specificity + Magnetic Hook without "| Documental Completo") + braille line (⠀) + EXACTLY 3 Spanish paragraphs separated by braille lines (⠀) + braille line (⠀) + verbatim Spanish AI Disclaimer: (Nota: Este video inmersivo ha sido recreado utilizando herramientas de inteligencia artificial generativa basándonos estrictamente en registros históricos de la época. Es posible que existan incongruencias o errores visuales). + braille line (⠀) + verbatim Spanish Slogan: Cada historia deja una huella. Aquí seguimos sus rastros. + braille line (⠀) + 5 two-word #CamelCase Spanish hashtags.]

===SECCION_COMENTARIO===
[Deliver EXCLUSIVELY the SPANISH PINNED COMMENT without any label or quotes: concise (~350 to 500 characters max, ~60 to 85 words, 1 single paragraph of EXACTLY 3 Spanish sentences: 1) brief human connection between that historical event and today without summarizing the video; 2) warm direct question "¿...?" inviting viewers to share a family memory or opinion; 3) warm closing like "Cuéntanos tu historia o reflexión aquí abajo, te leemos en los comentarios.". Forbidden "dale like" or "suscríbete", zero exclamation marks (!), years in digits, centuries/monarchs in Roman numerals.]

===SECCION_TAGS===
[Deliver EXCLUSIVELY the comma-separated SPANISH YOUTUBE SEO TAGS on a single continuous line (~460 to 500 characters max, never exceeding 500 characters, no "Tags:" prefix).]`;
    } else if (stageNumber === 111) {
      stagePrompt = `[STAGE_111_YOUTUBE_METADATA]
Act as Publishing & YouTube SEO Strategist for the Spanish-language documentary channel "Huellas de la Humanidad".
Topic: ${doc.topic || doc.title} (${doc.historicalTime || ''}, ${doc.historicalLocation || ''})
Confirmed Final Duration: ${resolvedFinalDuration11}
Platform: YOUTUBE
Thumbnail Overlay Text: ${doc.thumbnailTextOverlay || ''}
Clip 1 Opening Hook (${voiceEntrySec}s): ${doc.clip1Line2Hook || ''}
REAL Reference Script: ${(doc.voiceoverScript || doc.sectionsStructure || '').slice(0, 1800)}
${chaptersTimelineGuide ? `\nReal Documentary Timestamp Guide:\n${chaptersTimelineGuide}\n` : ''}
CRITICAL OUTPUT LANGUAGE REQUIREMENT: Write the entire deliverable 100% in SPANISH.
Generate STAGE 11: YOUTUBE PUBLICATION METADATA in continuous format separated ONLY by braille blank lines (⠀), obeying these unbreakable rules:
1. NO TITLE LINE AT THE TOP (title is stored in a separate field) and ZERO section labels (forbidden "Título:", "Descripción:", "Nota IA:", "Slogan:", "Hashtags:") and ZERO conversational intros ("Here is...", "Aquí tienes..."), with the SINGLE mandatory exception of "Capítulos:". No markdown code blocks (\`\`\`).
2. Total length ~2800 to 3000 characters from Paragraph 1 through the 5th hashtag.
3. Spanish description divided into EXACTLY 3 dense paragraphs separated by a braille line (⠀).
4. Mandatory "Capítulos:" section with 10 chronological Spanish chapters starting at 00:00 (NEVER write "Prólogo" or "Introducción").
5. Verbatim Spanish AI Note: (Nota: Este documental inmersivo ha sido recreado utilizando herramientas de inteligencia artificial generativa basándonos estrictamente en registros históricos de la época. Es posible que existan incongruencias o errores visuales).
6. Verbatim Spanish Slogan: Cada historia deja una huella. Aquí seguimos sus rastros.
7. Exactly 5 two-word #CamelCase Spanish hashtags at the very end.
8. Strictly FORBIDDEN to add any closing remark after the 5th hashtag.`;
    } else if (stageNumber === 112) {
      const selectedPublishTitle = (doc.publishTitle || '').trim();
      stagePrompt = `[STAGE_112_FACEBOOK_METADATA]
Act as Publishing Strategist for the Spanish-language documentary channel "Huellas de la Humanidad".
Topic: ${doc.topic || doc.title} (${doc.historicalTime || ''}, ${doc.historicalLocation || ''})
Confirmed Final Duration: ${resolvedFinalDuration11}
Platform: FACEBOOK
${selectedPublishTitle ? `Official Selected Spanish Title for Line 1 (use verbatim on line 1 without "| Documental Completo"): ${selectedPublishTitle.replace(/\s*\|\s*Documental\s+Completo\s*$/i, '')}\n` : ''}Thumbnail Overlay Text: ${doc.thumbnailTextOverlay || ''}
Clip 1 Opening Hook (${voiceEntrySec}s): ${doc.clip1Line2Hook || ''}
REAL Reference Script: ${(doc.voiceoverScript || doc.sectionsStructure || '').slice(0, 1800)}

CRITICAL OUTPUT LANGUAGE REQUIREMENT: Write the entire deliverable 100% in SPANISH.
Generate STAGE 11: FACEBOOK PUBLICATION METADATA in continuous format separated ONLY by braille blank lines (⠀), obeying these unbreakable rules:
1. ZERO section labels and ZERO conversational intros. No markdown code blocks (\`\`\`).
2. NO Chapters section and NO SEO Tags block.
3. Total length ~2800 to 3000 characters from Title through the 5th hashtag.
4. ${selectedPublishTitle ? `On Line 1 write EXACTLY this Spanish title: "${selectedPublishTitle.replace(/\s*\|\s*Documental\s+Completo\s*$/i, '')}"` : specificTitleLaw11.replace(/\s*\|\s*Documental Completo/g, '')}
5. Spanish description divided into EXACTLY 3 paragraphs separated by a braille line (⠀).
6. Verbatim Spanish AI Note: (Nota: Este video inmersivo ha sido recreado utilizando herramientas de inteligencia artificial generativa basándonos estrictamente en registros históricos de la época. Es posible que existan incongruencias o errores visuales).
7. Verbatim Spanish Slogan: Cada historia deja una huella. Aquí seguimos sus rastros.
8. Exactly 5 two-word #CamelCase Spanish hashtags at the end, with ZERO text after the 5th hashtag.`;
    } else if (stageNumber === 113) {
      stagePrompt = `[STAGE_113_PINNED_COMMENT]
Act as Community & Retention Strategist for the Spanish-language documentary channel "Huellas de la Humanidad".
Video Topic: ${doc.topic || doc.title} (${doc.historicalTime || ''}, ${doc.historicalLocation || ''})
Script / Context: ${(doc.voiceoverScript || doc.sectionsStructure || '').slice(0, 1500)}

CRITICAL OUTPUT LANGUAGE REQUIREMENT: Write the pinned comment 100% in SPANISH.
Generate EXCLUSIVELY the VIDEO PINNED COMMENT obeying these unbreakable rules:
1. Deliver 1 single short paragraph in Spanish with ZERO labels or quotes (forbidden "Comentario Fijado:" or "Pinned Comment:").
2. CONCISE LENGTH (~350 to 500 characters max, ~60 to 85 words, EXACTLY 3 SPANISH SENTENCES):
   - Sentence 1 (Brief human connection): Connect that historical era/journey with our present roots, memory, or daily life (NEVER re-summarize the whole video).
   - Sentence 2 (Warm direct question "¿...?"): Invite viewers to share a family memory/story linked to the topic or their view on the central human dilemma.
   - Sentence 3 (Warm closing): e.g. "Cuéntanos tu historia o reflexión aquí abajo, te leemos en los comentarios."
3. Strictly FORBIDDEN to ask for "dale like" or "suscríbete", and ZERO exclamation marks (!).
4. Write years in digits and centuries/monarchs in Roman numerals.`;
    } else if (stageNumber === 114) {
      stagePrompt = `[STAGE_114_YOUTUBE_SEO_TAGS]
Act as a YouTube SEO Specialist for the Spanish-language documentary channel "Huellas de la Humanidad".
Video Topic: ${doc.topic || doc.title} (${doc.historicalTime || ''}, ${doc.historicalLocation || ''})
Script / Context: ${(doc.voiceoverScript || doc.sectionsStructure || '').slice(0, 1500)}

CRITICAL OUTPUT LANGUAGE REQUIREMENT: Write all SEO tags 100% in SPANISH.
Generate EXCLUSIVELY the YOUTUBE SEO TAGS block obeying these unbreakable rules:
1. Deliver ONLY comma-separated Spanish tags in one single continuous line with ZERO labels (forbidden "Tags:" or "SEO Tags:").
2. Total character length MUST be ~460 to 500 characters counting spaces and commas (strictly NEVER exceed 500 characters).
3. Include high-search-volume Spanish keywords covering the historical event, figures, era, location, and history documentaries.`;
    } else if (stageNumber === 115) {
      stagePrompt = `[STAGE_115_YOUTUBE_5_TITLES]
Act as Editorial Director and High-CTR YouTube/Facebook Strategist for the Spanish-language documentary channel "Huellas de la Humanidad".
Documentary Topic: ${doc.topic || doc.title} (${doc.historicalTime || ''}, ${doc.historicalLocation || ''})
Confirmed Final Duration: ${resolvedFinalDuration11}
Thumbnail Overlay Text: "${doc.thumbnailTextOverlay || ''}"
Clip 1 Opening Hook (${voiceEntrySec}s): "${doc.clip1Line2Hook || ''}"
REAL Documentary Script (ABSOLUTE PRIORITY — base all 5 titles 100% on the real story narrated here):
"""
${(doc.voiceoverScript || doc.sectionsStructure || '').slice(0, 2400)}
"""

CRITICAL OUTPUT LANGUAGE REQUIREMENT: Write all 5 video title options 100% in SPANISH.
MANDATORY TASK: Generate EXACTLY 5 HIGH-CTR SPANISH VIDEO TITLE OPTIONS that are ULTRA-SPECIFIC, SUGGESTIVE, MAGNETIC, and faithful to the central story of the script.

UNBREAKABLE RULES:
1. FORBIDDEN VAGUE OR GENERIC TITLES: Never output abstract or poetic titles that hide what concrete story the documentary tells.
2. HISTORICAL SPECIFICITY + NARRATIVE TENSION: Every Spanish title MUST explicitly name the historical event, human group, protagonist, or central place from the script (years in digits, centuries/monarchs in Roman numerals, zero exclamation marks) combined with its core revelation, human drama, or paradox.
3. NO VERBATIM REPETITION: Do not repeat word-for-word the Thumbnail Overlay ("${doc.thumbnailTextOverlay || ''}") or Clip 1 Text ("${doc.clip1Line2Hook || ''}").
4. ${titleSuffixRule11}
5. DELIVERY FORMAT: Output ONLY the 5 Spanish titles, one per line (5 lines total), with NO numbering ("1.", "Option 1:"), NO bullets, NO quotes, and NO intro or closing text.`;
    }
  }

  if (stagePrompt && stageNumber !== 9) {
    stagePrompt += `\n${BRAND_SAFETY_LEXICAL_RULE_ES}`;
  }
  if (customInstruction) {
    stagePrompt += `\n\nAdditional director instruction: ${customInstruction}`;
  }
  return stagePrompt;
}

export async function generateStageClientSide(
  stageNumber: number,
  doc: DocumentaryProject,
  customInstruction?: string
): Promise<string> {
  const stagePrompt = buildStagePromptText(stageNumber, doc, customInstruction);
  const rawOut = await callGeminiGenerateContentClientSide([{ text: stagePrompt }], false);
  const sanitizedOut = stageNumber === 9 ? rawOut : sanitizeBrandSafeEditorialText(rawOut);
  const out =
    stageNumber === 4 ? normalizeFirstDayOfMonthInVoiceover(sanitizedOut) : sanitizedOut;
  if (stageNumber === 8) {
    return ensureOperationalHeaderInRawClips(out, doc.operationalHeader);
  }
  return out;
}

export async function generateThumbnailImageClientSide(
  prompt: string,
  logoDataUrl?: string
): Promise<string> {
  if (!confirmPaidGeminiApiUsage('generar imagen de miniatura vía API directa')) {
    throw new Error(
      'Uso de API directa denegado por el usuario. Utiliza Google Flow gratis con la Extensión de Chrome.'
    );
  }
  const apiKey = getBrowserGeminiKey();
  if (!apiKey) {
    throw new Error('Configura tu Gemini API Key para generar la miniatura directamente.');
  }

  const cleanPrompt = String(prompt || '')
    .replace(/^Thumbnail\s*:\s*/i, '')
    .trim();
  const parts: any[] = [];
  if (logoDataUrl && logoDataUrl.startsWith('data:')) {
    const match = logoDataUrl.match(/^data:([^;]+);base64,(.+)$/);
    if (match && match[1] && match[2]) {
      parts.push({
        inlineData: {
          mimeType: match[1],
          data: match[2],
        },
      });
    }
  }
  parts.push({ text: cleanPrompt });

  const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash-image:generateContent?key=${encodeURIComponent(
    apiKey
  )}`;
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      contents: [{ role: 'user', parts }],
      generationConfig: {
        responseModalities: ['TEXT', 'IMAGE'],
      },
    }),
  });
  const data = await res.json();
  if (!res.ok) {
    throw new Error(data?.error?.message || `Error HTTP ${res.status}`);
  }
  const candidateParts = data?.candidates?.[0]?.content?.parts || [];
  const imgPart = candidateParts.find((p: any) => p?.inlineData?.data);
  if (!imgPart || !imgPart.inlineData?.data) {
    throw new Error('No se recibió imagen desde Nano Banana (gemini-2.5-flash-image).');
  }
  const mime = imgPart.inlineData.mimeType || 'image/png';
  return `data:${mime};base64,${imgPart.inlineData.data}`;
}

export async function auditClipsClientSide(doc: DocumentaryProject, clipsList: any[]): Promise<any> {
  const auditPrompt = `Act as Film Director, Historian, and Continuity Supervisor for "Huellas de la Humanidad".
Audit narrative-to-visual coherence across the clips of documentary "${doc.topic || doc.title}":
${JSON.stringify(
  clipsList.map((c: any) => ({
    clipNumber: c.clipNumber,
    timeRange: c.timeRange,
    narrationSegment: c.narrationSegment,
    pauseNotes: c.pauseNotes,
    imagePrompt: c.imagePrompt,
    videoPrompt: c.videoPrompt,
  })),
  null,
  2
)}
UNBREAKABLE NON-DUPLICATION RULE ACROSS CONSECUTIVE CLIPS (Clip N vs Clip N-1): If narration stays on the same topic across consecutive clips, Clip [N] MUST NOT visually duplicate the staging, room, desk, or framing of Clip [N-1]. If Clip [N] repeats a similar setting or framing, mark "auditStatus" as "warning" or "mismatch" and write in "suggestedImagePrompt" (~20-35 words, 100% in English starting with "Image [N]: Create an image of ...") and "suggestedVideoPrompt" (100% in English starting with "Clip [N] ([MM:SS - MM:SS]): Create a video showing ..." and ending with "fix the name", ZERO Spanish words inside prompts) a visually distinct scene matching the narration.
Write "summary" and "auditReason" in Spanish for the producer UI.
Return EXCLUSIVELY valid JSON: {"summary": "...", "audits": [{"clipNumber": 1, "auditStatus": "ok"|"warning"|"mismatch", "auditReason": "...", "suggestedImagePrompt": "", "suggestedVideoPrompt": ""}]}`;

  const raw = await callGeminiGenerateContentClientSide([{ text: auditPrompt }], true);
  return JSON.parse(raw.replace(/^```json\s*/i, '').replace(/```\s*$/i, '').trim());
}

export async function auditClipVideoClientSide(
  doc: DocumentaryProject,
  clip: any,
  frames: string[],
  attempt: number = 1
): Promise<any> {
  const promptText = `Act as Film Director, Historian, and Visual QA Supervisor for "Huellas de la Humanidad".
You are inspecting ${frames.length} real extracted frames (start, middle, end) from a video generated in Google Flow for Clip #${clip.clipNumber} (Attempt #${attempt}).

DOCUMENTARY CONTEXT:
- Title / Topic: ${doc.topic || doc.title || ''}
- Historical Era: ${doc.historicalTime || ''}
- Historical Location: ${doc.historicalLocation || ''}

CLIP #${clip.clipNumber} DATA (${clip.timeRange || ''}):
- Spanish Voiceover during this clip: "${
    clip.clipNumber === 1
      ? '[Clip 1 Silent Opening Hook — Foley & On-Screen Text only: ' +
        (doc.clip1Line1LocationTime || '') +
        ' / ' +
        (doc.clip1Line2Hook || '') +
        ']'
      : clip.narrationSegment || ''
  }"
- Initial Image Prompt: ${clip.imagePrompt || ''}
- Video Prompt sent to Google Flow: ${clip.videoPrompt || ''}

VISUAL QA AUDIT TASK:
Inspect the attached frames and evaluate:
1. NARRATION COHERENCE: Do the visuals match the Spanish voiceover meaning for this segment?
2. HISTORICAL & PROMPT FIDELITY: Are historical era (${doc.historicalTime || ''}), setting, and primary action respected?
3. VISUAL QUALITY & ZERO AI ARTIFACTS: Free from severe anatomical deformations, modern anachronisms, black frames, or unwanted burned-in text?

VERDICT CRITERIA:
- "approved": Strong visual quality matching narration and prompt (score >= 75).
- "warning": Usable clip with minor imperfections (score 60-74).
- "rejected": Fails narration coherence, ignores prompt, or shows severe AI artifacts/anachronisms (score < 60). If "rejected", write in "fixedVideoPrompt" a clean, corrected 100% English Google Flow prompt starting with "Clip ${clip.clipNumber} (${clip.timeRange || '00:00 - 00:10'}): Create a video showing ..." and ending with "fix the name" (strictly ZERO Spanish words inside fixedVideoPrompt).

Write "auditReason" and "issues" in Spanish for the producer UI.
Return EXCLUSIVELY valid JSON:
{
  "clipNumber": ${clip.clipNumber},
  "verdict": "approved" | "warning" | "rejected",
  "score": 90,
  "narrationMatch": true,
  "promptMatch": true,
  "visualQualityOk": true,
  "auditReason": "Concise Spanish explanation of what appears in the frames and why it passes or fails",
  "issues": ["Spanish list of issues if any"],
  "fixedVideoPrompt": "100% English replacement prompt for Google Flow if rejected, or empty string if approved"
}`;

  const parts: any[] = [{ text: promptText }];
  for (const frame of frames.slice(0, 4)) {
    const cleanB64 = String(frame).replace(/^data:[^;]+;base64,/, '');
    if (cleanB64) {
      parts.push({
        inlineData: {
          data: cleanB64,
          mimeType: 'image/jpeg',
        },
      });
    }
  }

  const raw = await callGeminiGenerateContentClientSide(parts, true);
  return JSON.parse(raw.replace(/^```json\s*/i, '').replace(/```\s*$/i, '').trim());
}

export interface ThumbnailPsychologyAuditResult {
  optionLabel: string;
  ctrScore: number; // 0 to 100
  rule1_13msClarity: number; // 0 to 20
  rule2_faceEmotionEyeContact: number; // 0 to 20
  rule3_curiosityGap: number; // 0 to 20
  rule4_colorContrast: number; // 0 to 20
  rule5_titleBrandSynergy: number; // 0 to 20
  verdict: 'EXCELENTE' | 'BUENA' | 'MEJORABLE';
  summary: string;
  improvementTip?: string;
}

export async function auditThumbnailPsychologyClientSide(
  doc: DocumentaryProject,
  imageDataUrl: string,
  optionLabel: string = 'A'
): Promise<ThumbnailPsychologyAuditResult> {
  const overlayText = (doc.thumbnailTextOverlay || '').trim();
  const promptText = `Act as a YouTube Thumbnail CTR Neuropsychology Expert and Art Director for "Huellas de la Humanidad".
Evaluate the attached thumbnail image (Option ${optionLabel}) for documentary "${doc.title || doc.topic}" (${doc.historicalTime || ''}, ${doc.historicalLocation || ''}).
Expected Spanish on-screen text: "${overlayText}"

Score from 0 to 20 each of the 5 Psychological Click Laws (Total 0 to 100):
1. rule1_13msClarity (0-20): Ultra-fast 13-millisecond visual readability (max 3 elements, zero visual clutter, mobile-legible).
2. rule2_faceEmotionEyeContact (0-20): Expressive human face, intense visceral emotion, and direct eye contact with the viewer.
3. rule3_curiosityGap (0-20): Irresistible visual Curiosity Gap without spoiling the entire answer.
4. rule4_colorContrast (0-20): High-contrast warm key light against dark cool background + crisp text legibility.
5. rule5_titleBrandSynergy (0-20): Synergy with video title, accurate Spanish overlay "${overlayText}", "Huellas de la Humanidad" logo top-left, and "8K"/"HD" badge top-right.

Write "summary" and "improvementTip" in Spanish for the producer UI, and use "EXCELENTE" | "BUENA" | "MEJORABLE" for "verdict".
Return EXCLUSIVELY valid JSON:
{
  "optionLabel": "${optionLabel}",
  "ctrScore": 92,
  "rule1_13msClarity": 19,
  "rule2_faceEmotionEyeContact": 19,
  "rule3_curiosityGap": 18,
  "rule4_colorContrast": 18,
  "rule5_titleBrandSynergy": 18,
  "verdict": "EXCELENTE",
  "summary": "Concise 1-2 sentence Spanish assessment of psychological CTR impact.",
  "improvementTip": "Optional brief Spanish tip if any rule scored below 17."
}`;

  const cleanB64 = String(imageDataUrl).replace(/^data:[^;]+;base64,/, '');
  const mimeMatch = String(imageDataUrl).match(/^data:([^;]+);base64,/);
  const mimeType = mimeMatch ? mimeMatch[1] : 'image/png';

  const parts: any[] = [{ text: promptText }];
  if (cleanB64 && !imageDataUrl.startsWith('http')) {
    parts.push({
      inlineData: {
        data: cleanB64,
        mimeType,
      },
    });
  }

  const raw = await callGeminiGenerateContentClientSide(parts, true);
  return JSON.parse(raw.replace(/^```json\s*/i, '').replace(/```\s*$/i, '').trim());
}

export async function replyCommentsClientSide(
  doc: DocumentaryProject,
  commentText: string,
  imageBase64?: string,
  mimeType?: string,
  customInstruction?: string
): Promise<any> {
  const promptText = `Act as Lead Historian and Director of the Spanish-language documentary channel "Huellas de la Humanidad".
Documentary: ${doc.publishTitle || doc.topic || doc.title || 'Historical Documentary'} (${doc.historicalTime || ''} | ${doc.historicalLocation || ''})
Context: ${(doc.voiceoverScript || doc.sectionsStructure || '').slice(0, 2500)}
${commentText ? `Viewer Comment(s):\n${commentText}\n` : ''}
${customInstruction ? `Additional Director Instruction: ${customInstruction}\n` : ''}
CRITICAL OUTPUT LANGUAGE REQUIREMENT: Write all suggested replies ("replyConcise", "replyAlternative", "historicalContextNote") in warm, cultivated Neutral Spanish (1-3 sentences, years in digits, centuries/monarchs in Roman numerals, thousands with "mil", ZERO exclamation marks "!").
Return EXCLUSIVELY valid JSON: {"replies": [{"author": "@user", "commentText": "...", "replyConcise": "...", "replyAlternative": "...", "historicalContextNote": "..."}]}`;

  const parts: any[] = [{ text: promptText }];
  if (imageBase64) {
    const cleanB64 = String(imageBase64).replace(/^data:[^;]+;base64,/, '');
    parts.push({
      inlineData: {
        data: cleanB64,
        mimeType: mimeType || 'image/png',
      },
    });
  }
  const raw = await callGeminiGenerateContentClientSide(parts, true);
  return JSON.parse(raw.replace(/^```json\s*/i, '').replace(/```\s*$/i, '').trim());
}

function pcmChunksToWavBlobUrl(
  pcmChunks: Uint8Array[],
  sampleRate = 24000
): { url: string; blob: Blob; duration: number } {
  const pcmLen = pcmChunks.reduce((acc, c) => acc + (c.byteLength & ~1), 0);
  const buffer = new ArrayBuffer(44 + pcmLen);
  const view = new DataView(buffer);

  const writeStr = (offset: number, s: string) => {
    for (let i = 0; i < s.length; i++) view.setUint8(offset + i, s.charCodeAt(i));
  };

  writeStr(0, 'RIFF');
  view.setUint32(4, 36 + pcmLen, true);
  writeStr(8, 'WAVE');
  writeStr(12, 'fmt ');
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 1, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * 2, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  writeStr(36, 'data');
  view.setUint32(40, pcmLen, true);

  const bytes = new Uint8Array(buffer, 44);
  let offset = 0;
  for (const chunk of pcmChunks) {
    const evenLen = chunk.byteLength & ~1;
    if (evenLen > 0) {
      bytes.set(chunk.subarray(0, evenLen), offset);
      offset += evenLen;
    }
  }

  const blob = new Blob([buffer], { type: 'audio/wav' });
  const duration = Math.max(1, parseFloat((pcmLen / (sampleRate * 2)).toFixed(2)));
  return { url: URL.createObjectURL(blob), blob, duration };
}

const clientTtsRequestTimestamps: number[] = [];
let clientTtsCooldownUntilMs = 0;
const CLIENT_TTS_STATE_STORAGE_KEY = 'huellas_tts_rpm_ledger_v2';
const CLIENT_TTS_WINDOW_MS = 66000;
const CLIENT_TTS_MAX_PER_WINDOW = 8; // Margen seguro bajo el límite estricto de 10 RPM (Tier 1) incluso midiendo al cierre HTTP
const CLIENT_TTS_MIN_SPACING_MS = 6800; // Cadencia uniforme (~8.8 RPM máx.) sin ráfagas que disparen el limitador por minuto

function syncClientTtsRateState(now: number = Date.now()): void {
  try {
    if (typeof localStorage !== 'undefined') {
      const raw = localStorage.getItem(CLIENT_TTS_STATE_STORAGE_KEY);
      if (raw) {
        const parsed = JSON.parse(raw);
        if (Array.isArray(parsed?.slots)) {
          for (const ts of parsed.slots) {
            const n = Number(ts);
            if (Number.isFinite(n) && now - n < CLIENT_TTS_WINDOW_MS && !clientTtsRequestTimestamps.includes(n)) {
              clientTtsRequestTimestamps.push(n);
            }
          }
        }
        const cd = Number(parsed?.cooldownUntilMs || 0);
        if (Number.isFinite(cd) && cd > clientTtsCooldownUntilMs) {
          clientTtsCooldownUntilMs = cd;
        }
      }
    }
  } catch {}
  clientTtsRequestTimestamps.sort((a, b) => a - b);
  while (
    clientTtsRequestTimestamps.length > 0 &&
    now - clientTtsRequestTimestamps[0] >= CLIENT_TTS_WINDOW_MS
  ) {
    clientTtsRequestTimestamps.shift();
  }
}

function persistClientTtsRateState(): void {
  try {
    if (typeof localStorage !== 'undefined') {
      localStorage.setItem(
        CLIENT_TTS_STATE_STORAGE_KEY,
        JSON.stringify({
          slots: clientTtsRequestTimestamps.slice(-16),
          cooldownUntilMs: clientTtsCooldownUntilMs,
        })
      );
    }
  } catch {}
}

function settleLatestClientTtsRateSlot(previousStamp: number): void {
  const settledAt = Date.now();
  syncClientTtsRateState(settledAt);
  const idx = clientTtsRequestTimestamps.indexOf(previousStamp);
  if (idx !== -1) {
    clientTtsRequestTimestamps[idx] = settledAt;
  } else {
    clientTtsRequestTimestamps.push(settledAt);
  }
  clientTtsRequestTimestamps.sort((a, b) => a - b);
  persistClientTtsRateState();
}

function registerClientTtsCooldown(waitMs: number): void {
  const until = Date.now() + Math.max(0, Math.ceil(waitMs));
  syncClientTtsRateState(Date.now());
  if (until > clientTtsCooldownUntilMs) {
    clientTtsCooldownUntilMs = until;
  }
  persistClientTtsRateState();
}

async function sleepWithCountdown(
  totalMs: number,
  formatMsg?: (secLeft: number) => string,
  onProgress?: (msg: string) => void
): Promise<void> {
  const deadline = Date.now() + Math.max(0, Math.ceil(totalMs));
  while (true) {
    const remaining = deadline - Date.now();
    if (remaining <= 0) break;
    if (onProgress && formatMsg) {
      onProgress(formatMsg(Math.max(1, Math.ceil(remaining / 1000))));
    }
    await new Promise((r) => setTimeout(r, Math.min(1000, remaining)));
  }
}

async function acquireClientTtsRateSlot(
  blockNum: number,
  totalBlocks: number,
  onProgress?: (msg: string) => void
): Promise<number> {
  while (true) {
    const now = Date.now();
    syncClientTtsRateState(now);

    if (clientTtsCooldownUntilMs > now) {
      const cdWait = clientTtsCooldownUntilMs - now;
      await sleepWithCountdown(
        cdWait,
        (secLeft) =>
          `⏳ Pausa activa de cuota Tier 1 (10/min): continuando bloque ${blockNum}/${totalBlocks} en ${secLeft}s...`,
        onProgress
      );
      continue;
    }

    if (clientTtsRequestTimestamps.length >= CLIENT_TTS_MAX_PER_WINDOW) {
      const waitMs =
        clientTtsRequestTimestamps[0] + CLIENT_TTS_WINDOW_MS - now + 1200;
      if (waitMs > 0) {
        await sleepWithCountdown(
          waitMs,
          (secLeft) =>
            `⏳ Ritmo seguro Tier 1 (máx. 10/min): continuando bloque ${blockNum}/${totalBlocks} en ${secLeft}s...`,
          onProgress
        );
        continue;
      }
    }

    const lastTs =
      clientTtsRequestTimestamps.length > 0
        ? clientTtsRequestTimestamps[clientTtsRequestTimestamps.length - 1]
        : 0;
    const sinceLast = Date.now() - lastTs;
    if (lastTs > 0 && sinceLast < CLIENT_TTS_MIN_SPACING_MS) {
      const gapWait = CLIENT_TTS_MIN_SPACING_MS - sinceLast;
      if (gapWait >= 1500) {
        await sleepWithCountdown(
          gapWait,
          (secLeft) =>
            `🎙️ Sincronizando ritmo Tier 1 (10/min) para bloque ${blockNum}/${totalBlocks} (${secLeft}s)...`,
          onProgress
        );
      } else {
        await new Promise((r) => setTimeout(r, gapWait));
      }
      continue;
    }

    const stamp = Date.now();
    clientTtsRequestTimestamps.push(stamp);
    persistClientTtsRateState();
    return stamp;
  }
}

function parseGoogleTtsRetryDelayMs(
  errMsg: string,
  errPayload: any,
  rateWaitCount: number
): number {
  const inlineMatch = String(errMsg || '').match(
    /Please\s+retry\s+in\s+([0-9]+(?:\.[0-9]+)?)\s*s/i
  );
  if (inlineMatch?.[1]) {
    const sec = parseFloat(inlineMatch[1]);
    if (Number.isFinite(sec) && sec > 0) {
      return Math.min(95000, Math.max(12000, Math.ceil(sec * 1000) + 3500));
    }
  }
  const details = Array.isArray(errPayload?.error?.details)
    ? errPayload.error.details
    : [];
  for (const d of details) {
    const rawDelay = String(d?.retryDelay || '');
    const dm = rawDelay.match(/^([0-9]+(?:\.[0-9]+)?)\s*s$/i);
    if (dm?.[1]) {
      const sec = parseFloat(dm[1]);
      if (Number.isFinite(sec) && sec > 0) {
        return Math.min(95000, Math.max(12000, Math.ceil(sec * 1000) + 3500));
      }
    }
  }
  return Math.min(75000, 22000 + Math.min(5, rateWaitCount) * 10000);
}

function splitOversizedTtsBlock(text: string, maxChars: number = 2800): string[] {
  const trimmed = (text || '').trim();
  if (!trimmed) return [];
  if (trimmed.length <= maxChars) return [trimmed];

  const sentences = trimmed
    .split(/(?<=[.!?…])\s+|\n{2,}/)
    .map((s) => s.trim())
    .filter(Boolean);

  const chunks: string[] = [];
  let current = '';
  for (const sent of sentences) {
    if (!current) {
      if (sent.length <= maxChars) {
        current = sent;
      } else {
        // Hard-split extraordinarily long unpunctuated run on whitespace
        const words = sent.split(/\s+/);
        let wBuf = '';
        for (const w of words) {
          if (wBuf && wBuf.length + 1 + w.length > maxChars) {
            chunks.push(wBuf);
            wBuf = w;
          } else {
            wBuf = wBuf ? `${wBuf} ${w}` : w;
          }
        }
        current = wBuf;
      }
    } else if (current.length + 1 + sent.length <= maxChars) {
      current = `${current} ${sent}`;
    } else {
      chunks.push(current);
      current = sent;
    }
  }
  if (current) chunks.push(current);
  return chunks;
}

function applyPcmMicroFadeBytes(pcmBytes: Uint8Array, fadeSamples: number = 288): Uint8Array {
  const fadeMs = Math.max(8, Math.round((fadeSamples / 24000) * 1000));
  return polishCleanTtsPcmBlock(pcmBytes, 24000, fadeMs);
}

export async function synthesizeTtsClientSide(params: {
  text: string;
  voice: string;
  style: string;
  speed: string;
  language: string;
  label: string;
  docContext?: any;
  targetDurationSeconds?: number;
  onProgress?: (msg: string) => void;
}): Promise<TTSRecord & { audioBlob?: Blob }> {
  const apiKey = getBrowserGeminiKey();
  if (!apiKey) {
    throw new Error('Configura primero tu Gemini API Key para generar audio TTS.');
  }
  const durationTarget = params.docContext || params.targetDurationSeconds;
  const firstDaySafeInput = normalizeFirstDayOfMonthInVoiceover(params.text || '');
  const rawInput = durationTarget
    ? autoFitVoiceoverScriptToDuration(firstDaySafeInput, durationTarget)
    : cleanVoiceoverNarrationOnly(firstDaySafeInput);
  const cleanText = stripPauseTags(rawInput).trim();
  if (!cleanText) {
    throw new Error('El texto del guion está vacío.');
  }

  const physicalVoices: Record<string, string> = {
    Kore: 'Kore',
    Aoede: 'Aoede',
    Puck: 'Puck',
    Charon: 'Charon',
    Fenrir: 'Fenrir',
    Zephyr: 'Zephyr',
    Adam: 'Fenrir',
    Antoni: 'Zephyr',
    Bella: 'Aoede',
    Domi: 'Kore',
    Grace: 'Aoede',
    Michael: 'Charon',
    Rachel: 'Aoede',
    Serena: 'Kore',
    Journey_F: 'Aoede',
    Journey_M: 'Charon',
    Wavenet_A: 'Kore',
    Wavenet_B: 'Fenrir',
    Neural2_F: 'Kore',
    Neural2_M: 'Zephyr',
  };
  const physicalVoice = physicalVoices[params.voice] || 'Charon';

  const languageInstructions: Record<string, string> = {
    es: 'Speak in Spanish with native European Spanish pronunciation.',
    'es-la':
      'Speak in Spanish with a neutral, solemn, warm Latin American documentary accent (Español Neutro). Do NOT use European Spanish ceceo.',
    en: 'Speak in English with a native accent.',
    pt: 'Speak in Portuguese with a native accent.',
    fr: 'Speak in French with a native accent.',
    de: 'Speak in German with a native accent.',
  };
  const styleDescriptions: Record<string, string> = {
    standard: 'Speak clearly with a professional documentary narrator cadence.',
    dramatic:
      'Speak with deep cinematic documentary gravitas, emotional resonance, and deliberate pacing.',
    formal: 'Speak formally with historical rigor, solemn tone, and crisp articulation.',
    whisper: 'Speak in a soft, intimate, mysterious low-volume voice.',
    cheerful: 'Speak with bright, engaging enthusiasm.',
  };
  const speedDescriptions: Record<string, string> = {
    slow: 'Speak slowly and deliberately.',
    medium: 'Speak at a measured, natural documentary narration speed.',
    fast: 'Speak at a brisk, dynamic pace while keeping every word clear.',
  };

  const langInstr = languageInstructions[params.language] || languageInstructions['es-la'];
  const styleInstr = styleDescriptions[params.style] || styleDescriptions.dramatic;
  const speedInstr = speedDescriptions[params.speed] || speedDescriptions.medium;

  const pauseRegex =
    /[\[{]\s*(?:(?:pausa|pause|silencio)(?:\s+de)?\s*:?\s*)?([0-9]{1,2}(?:[.,][0-9]+)?)\s*(s|seg|segundos?|ms|milisegundos?)?\s*[\]}]|[\[{]\s*(?:pausa|pause|silencio)\s*:?\s*[\]}]|\(\s*(?:pausa|pause|silencio)(?:\s+de)?\s*:?\s*([0-9]{1,2}(?:[.,][0-9]+)?)\s*(s|seg|segundos?|ms|milisegundos?)?\s*\)|<break\s+time=["']?([0-9]+(?:\.[0-9]+)?)(s|ms)["']?\s*\/?>/gi;
  const rawSegments: Array<{ type: 'text' | 'pause'; text?: string; duration?: number }> = [];
  let lastIdx = 0;
  let match: RegExpExecArray | null;
  while ((match = pauseRegex.exec(rawInput)) !== null) {
    const before = rawInput.slice(lastIdx, match.index).trim();
    if (before) rawSegments.push({ type: 'text', text: before });
    let dur = 1.5;
    if (match[1] !== undefined) {
      const val = parseFloat(match[1].replace(',', '.'));
      const unit = (match[2] || 's').toLowerCase();
      dur = unit.startsWith('ms') || unit.startsWith('mili') ? val / 1000 : val;
    } else if (match[3] !== undefined) {
      const val = parseFloat(match[3].replace(',', '.'));
      const unit = (match[4] || 's').toLowerCase();
      dur = unit.startsWith('ms') || unit.startsWith('mili') ? val / 1000 : val;
    } else if (match[5] !== undefined) {
      const val = parseFloat(match[5].replace(',', '.'));
      const unit = (match[6] || 's').toLowerCase();
      dur = unit === 'ms' ? val / 1000 : val;
    }
    rawSegments.push({ type: 'pause', duration: Math.max(0.2, Math.min(20, dur)) });
    lastIdx = match.index + match[0].length;
  }
  const tail = rawInput.slice(lastIdx).trim();
  if (tail) rawSegments.push({ type: 'text', text: tail });
  if (rawSegments.length === 0) {
    rawSegments.push({ type: 'text', text: cleanText });
  }

  // Split any oversized text chunk (>2800 chars) cleanly on sentence boundaries so single calls never exceed Gemini TTS max audio length
  const segments: Array<{ type: 'text' | 'pause'; text?: string; duration?: number }> = [];
  for (const seg of rawSegments) {
    if (seg.type === 'text' && seg.text) {
      const subChunks = splitOversizedTtsBlock(seg.text, 2800);
      subChunks.forEach((sub, idx) => {
        if (idx > 0) {
          segments.push({ type: 'pause', duration: 0.35 });
        }
        segments.push({ type: 'text', text: sub });
      });
    } else {
      segments.push(seg);
    }
  }

  const totalTextBlocks = segments.filter((s) => s.type === 'text' && s.text).length;

  const synthOneSegment = async (segText: string, blockNum: number): Promise<Uint8Array> => {
    const fullPrompt = `[DIRECTOR_INSTRUCTION]
Vocal Character Profile: "${params.voice}" (Physical base "${physicalVoice}")
Mood, Emotion & Delivery: ${styleInstr} Maintain strict vocal consistency and uniform documentary pitch.
Vocal Speed: ${speedInstr}
Accent & Language Vibe: ${langInstr}

ACTOR INSTRUCTION: Deliver the exact text inside [TEXT] once from beginning to end. Never repeat sentences, never read markup tags or brackets.

[TEXT]
${segText}`;

    const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-3.8-flash-tts:generateContent?key=${encodeURIComponent(
      apiKey
    )}`;

    let lastErrorMsg = '';
    const maxHardAttempts = 6;
    const maxRateLimitWaits = 24;
    let hardAttempt = 0;
    let rateLimitWaits = 0;

    while (hardAttempt < maxHardAttempts && rateLimitWaits <= maxRateLimitWaits) {
      const slotStamp = await acquireClientTtsRateSlot(blockNum, totalTextBlocks, params.onProgress);

      if (params.onProgress) {
        const pct = Math.round(((blockNum - 1) / Math.max(1, totalTextBlocks)) * 100);
        params.onProgress(
          hardAttempt > 0 || rateLimitWaits > 0
            ? `🎙️ Sintetizando bloque ${blockNum}/${totalTextBlocks} (${pct}%) en Gemini 3.8 Flash TTS (reanudado)...`
            : `🎙️ Sintetizando bloque ${blockNum}/${totalTextBlocks} (${pct}%) en Gemini 3.8 Flash TTS...`
        );
      }

      let res: Response;
      let data: any = null;
      try {
        res = await fetch(url, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            contents: [{ role: 'user', parts: [{ text: fullPrompt }] }],
            generationConfig: {
              responseModalities: ['AUDIO'],
              speechConfig: {
                voiceConfig: {
                  prebuiltVoiceConfig: { voiceName: physicalVoice },
                },
              },
            },
          }),
        });
        settleLatestClientTtsRateSlot(slotStamp);
        data = await res.json().catch(() => ({}));
      } catch (netErr: any) {
        settleLatestClientTtsRateSlot(slotStamp);
        lastErrorMsg = netErr?.message || 'Error de red temporal en TTS';
        hardAttempt++;
        if (hardAttempt < maxHardAttempts) {
          await sleepWithCountdown(
            4000 * hardAttempt,
            (s) => `⏳ Red inestable, reintentando bloque ${blockNum}/${totalTextBlocks} en ${s}s...`,
            params.onProgress
          );
          continue;
        }
        throw new Error(lastErrorMsg);
      }

      if (!res.ok) {
        const errMsg = data?.error?.message || `Error TTS HTTP ${res.status}`;
        lastErrorMsg = errMsg;
        const isPerMinuteQuota =
          /per\s+minute|Please\s+retry\s+in\s+[0-9]+(?:\.[0-9]+)?\s*s|limit:\s*10\b/i.test(errMsg);
        const isDailyHardCap =
          !isPerMinuteQuota &&
          /per_day|RequestsPerDay|GenerateRequestsPerDay/i.test(errMsg);

        if (isDailyHardCap) {
          throw new Error(
            'Se alcanzó el límite diario (RPD) de Gemini 3.8 Flash TTS en esta API Key. Espera al reinicio diario de cuota en Google AI Studio o cambia la API Key en el botón 🔑.'
          );
        }

        const isRateLimit =
          res.status === 429 ||
          isPerMinuteQuota ||
          /quota|rate.?limit|RESOURCE_EXHAUSTED|retry in/i.test(errMsg);

        if (isRateLimit && rateLimitWaits < maxRateLimitWaits) {
          const waitMs = parseGoogleTtsRetryDelayMs(errMsg, data, rateLimitWaits);
          rateLimitWaits++;
          registerClientTtsCooldown(waitMs);
          await sleepWithCountdown(
            waitMs,
            (secLeft) =>
              `⏳ Cuota Tier 1 (10 llamadas/min): esperando ${secLeft}s para continuar el bloque ${blockNum}/${totalTextBlocks} automáticamente sin perder el progreso...`,
            params.onProgress
          );
          continue;
        }

        if (res.status >= 500 || /overloaded|temporarily|internal/i.test(errMsg)) {
          hardAttempt++;
          if (hardAttempt < maxHardAttempts) {
            await sleepWithCountdown(
              5000 * hardAttempt,
              (secLeft) =>
                `⏳ Servidor de voz ocupado, reintentando bloque ${blockNum}/${totalTextBlocks} en ${secLeft}s...`,
              params.onProgress
            );
            continue;
          }
        }
        throw new Error(errMsg);
      }

      const b64Audio = data?.candidates?.[0]?.content?.parts?.[0]?.inlineData?.data;
      if (!b64Audio) {
        lastErrorMsg = 'El modelo gemini-3.8-flash-tts no devolvió datos de audio.';
        hardAttempt++;
        if (hardAttempt < maxHardAttempts) {
          await new Promise((r) => setTimeout(r, 3000));
          continue;
        }
        throw new Error(lastErrorMsg);
      }

      const binary = atob(b64Audio.replace(/\s/g, ''));
      const bytes = new Uint8Array(binary.length);
      for (let i = 0; i < binary.length; i++) {
        bytes[i] = binary.charCodeAt(i);
      }
      const extracted = extractCleanPcmFromGeminiAudio(bytes, 24000);
      const sr = extracted.sampleRate || 24000;
      const wCount = segText.split(/\s+/).filter(Boolean).length;
      const deduped = trimDuplicatedTakeInPcm(extracted.pcmBytes, sr, wCount);
      if (deduped.wasTrimmed) {
        console.warn(
          `[VoxFlow Client] Toma duplicada recortada en bloque ${blockNum}: ${deduped.originalDurationSec.toFixed(2)}s -> ${deduped.trimmedDurationSec.toFixed(2)}s`
        );
      } else {
        const tempSec = deduped.pcmBytes.byteLength / Math.max(16000, sr * 2);
        if (wCount >= 8 && tempSec > 6 && wCount / tempSec < 1.35 && hardAttempt < 2) {
          hardAttempt++;
          console.warn(
            `[VoxFlow Client] Posible duplicación sin valle limpio en bloque ${blockNum} (${tempSec.toFixed(1)}s para ${wCount} pal.). Reintentando...`
          );
          continue;
        }
      }

      return polishCleanTtsPcmBlock(deduped.pcmBytes, sr);
    }

    throw new Error(lastErrorMsg || 'No se pudo sintetizar el bloque de voz.');
  };

  // Sequential synthesis (1 worker) respecting Tier 1 10-RPM sliding window — prevents 429 bursts and preserves vocal continuity
  const pcmResults: Uint8Array[] = new Array(segments.length);
  const segmentTimings: TTSSegmentTiming[] = [];
  let runningCursorSec = 0;
  let currentTextBlock = 0;
  for (let idx = 0; idx < segments.length; idx++) {
    const seg = segments[idx];
    if (seg.type === 'pause' && seg.duration) {
      pcmResults[idx] = new Uint8Array(Math.round(24000 * seg.duration) * 2);
    } else if (seg.type === 'text' && seg.text) {
      currentTextBlock++;
      pcmResults[idx] = await synthOneSegment(seg.text, currentTextBlock);
    } else {
      pcmResults[idx] = new Uint8Array(0);
    }
    const segDur = Number((pcmResults[idx].byteLength / 48000).toFixed(3));
    if (segDur > 0) {
      segmentTimings.push({
        type: seg.type,
        ...(seg.text ? { text: seg.text } : {}),
        startSec: Number(runningCursorSec.toFixed(3)),
        endSec: Number((runningCursorSec + segDur).toFixed(3)),
        durationSec: segDur,
      });
      runningCursorSec += segDur;
    }
  }

  if (params.onProgress) {
    params.onProgress('✨ Ensamblando audio maestro y extrayendo línea de tiempo...');
  }

  const { url: wavUrl, blob: wavBlob, duration } = pcmChunksToWavBlobUrl(pcmResults, 24000);
  const trackId = `tts-mobile-${Date.now()}`;
  const docIdKey = params.docContext?.id ? `doc:${params.docContext.id}` : '';
  await saveTtsAudioBlobToVault([trackId, docIdKey].filter(Boolean), wavBlob).catch(() => {});

  const words = cleanText.split(/\s+/).filter(Boolean).length;
  const pauseCount = rawSegments.filter((s) => s.type === 'pause').length;
  return {
    id: trackId,
    text: rawInput,
    voice: params.voice,
    style: params.style,
    speed: params.speed,
    language: params.language,
    consistencyMode: true,
    filename: `${(params.label || 'Voz_Narrativa').replace(/[^a-zA-Z0-9_-]/g, '_')}.wav`,
    audioUrl: wavUrl,
    audioBlob: wavBlob,
    createdAt: new Date().toISOString(),
    storageMode: 'local',
    wordCount: words,
    duration,
    providerUsed:
      pauseCount > 0
        ? `Gemini 3.8 Flash TTS (${pauseCount} Pausas)`
        : 'Gemini 3.8 Flash TTS',
    label: params.label,
    segmentTimings,
  };
}

const TTS_VAULT_DB_NAME = 'huellas_tts_vault_v1';
const TTS_VAULT_STORE = 'audio_blobs';

function openTtsVaultDb(): Promise<IDBDatabase | null> {
  if (typeof indexedDB === 'undefined') return Promise.resolve(null);
  return new Promise((resolve) => {
    try {
      const req = indexedDB.open(TTS_VAULT_DB_NAME, 1);
      req.onupgradeneeded = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains(TTS_VAULT_STORE)) {
          db.createObjectStore(TTS_VAULT_STORE);
        }
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => resolve(null);
    } catch {
      resolve(null);
    }
  });
}

export async function saveTtsAudioBlobToVault(keys: string[], blob: Blob): Promise<void> {
  const validKeys = keys.map((k) => String(k || '').trim()).filter(Boolean);
  if (validKeys.length === 0 || !blob) return;
  const db = await openTtsVaultDb();
  if (!db) return;
  await new Promise<void>((resolve) => {
    try {
      const tx = db.transaction(TTS_VAULT_STORE, 'readwrite');
      const store = tx.objectStore(TTS_VAULT_STORE);
      for (const k of validKeys) {
        store.put(blob, k);
      }
      tx.oncomplete = () => resolve();
      tx.onerror = () => resolve();
    } catch {
      resolve();
    }
  });
}

export async function loadTtsAudioBlobUrlFromVault(keys: string[]): Promise<string | null> {
  const validKeys = keys.map((k) => String(k || '').trim()).filter(Boolean);
  if (validKeys.length === 0) return null;
  const db = await openTtsVaultDb();
  if (!db) return null;
  for (const k of validKeys) {
    const blob = await new Promise<Blob | null>((resolve) => {
      try {
        const tx = db.transaction(TTS_VAULT_STORE, 'readonly');
        const req = tx.objectStore(TTS_VAULT_STORE).get(k);
        req.onsuccess = () =>
          resolve(req.result instanceof Blob && req.result.size > 100 ? req.result : null);
        req.onerror = () => resolve(null);
      } catch {
        resolve(null);
      }
    });
    if (blob) {
      try {
        if (!blob.type || /wav/i.test(blob.type)) {
          const ab = await blob.arrayBuffer();
          const u8 = new Uint8Array(ab);
          if (hasEmbeddedC2paInAudioBytes(u8)) {
            const cleaned = cleanMasterWavEmbeddedC2paInPlace(u8);
            if (cleaned.cleanedBlocks > 0 || cleaned.strippedPostDataBytes > 0) {
              const cleanBlob = new Blob([cleaned.wavBytes.slice().buffer], { type: 'audio/wav' });
              await saveTtsAudioBlobToVault([k], cleanBlob).catch(() => {});
              return URL.createObjectURL(cleanBlob);
            }
          }
        }
      } catch {
        // Fallback to original blob if inspection fails
      }
      return URL.createObjectURL(blob);
    }
  }
  return null;
}
