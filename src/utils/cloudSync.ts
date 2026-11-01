import {
  DocumentaryProject,
  DEFAULT_OPERATIONAL_HEADER,
  TTSRecord,
} from '../types';
import {
  ensureOperationalHeaderInRawClips,
  getStage1ClipDurations,
  stripPauseTags,
} from './smartParsers';

export const GITHUB_OWNER = 'raydelw-a11y';
export const GITHUB_REPO = 'Huellas-Master';
export const GITHUB_BRANCH = 'main';
export const PUBLIC_GITHUB_PAGES_URL = `https://${GITHUB_OWNER}.github.io/${GITHUB_REPO}/`;

const LOCAL_DOCS_CACHE_KEY = 'huellas_master_docs_cache_v1';
const LOCAL_DELETED_IDS_KEY = 'huellas_master_deleted_ids_v1';
const LOCAL_CLIP_REVIEW_STATE_KEY = 'huellas_master_clip_review_state_v1';

interface StoredClipStatusEntry {
  reviewedForEditor: boolean;
  recreated?: boolean;
  videoReady?: boolean;
  imageReady?: boolean;
  videoSavedFileName?: string;
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
      const nextRev = Boolean(c.reviewedForEditor);
      const nextRec = Boolean(c.recreated);
      const nextVid = Boolean(c.videoReady);
      const nextImg = Boolean(c.imageReady);
      const nextFile = c.videoSavedFileName || prev?.videoSavedFileName;
      if (
        !prev ||
        prev.reviewedForEditor !== nextRev ||
        Boolean(prev.recreated) !== nextRec ||
        Boolean(prev.videoReady) !== nextVid ||
        Boolean(prev.imageReady) !== nextImg ||
        prev.videoSavedFileName !== nextFile
      ) {
        docMap[c.clipNumber] = {
          reviewedForEditor: nextRev,
          recreated: nextRec,
          videoReady: nextVid,
          imageReady: nextImg,
          ...(nextFile ? { videoSavedFileName: nextFile } : {}),
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

  return list.map((doc) => {
    if (!doc || !doc.id) return doc;
    const baseDoc = normalizeDocumentaryVoiceoverAudio(doc);
    if (!Array.isArray(baseDoc.clips) || baseDoc.clips.length === 0) return baseDoc;
    const docMap = map[baseDoc.id];
    if (!docMap) return baseDoc;
    let changed = false;
    const nextClips = baseDoc.clips.map((c) => {
      const saved = docMap[c.clipNumber];
      if (!saved) return c;
      const mergedRev = Boolean(saved.reviewedForEditor);
      const mergedRec = Boolean(c.recreated || saved.recreated);
      const mergedVid = Boolean(c.videoReady || saved.videoReady);
      const mergedImg = Boolean(c.imageReady || saved.imageReady);
      const mergedFile = c.videoSavedFileName || saved.videoSavedFileName;
      if (
        Boolean(c.reviewedForEditor) !== mergedRev ||
        Boolean(c.recreated) !== mergedRec ||
        Boolean(c.videoReady) !== mergedVid ||
        Boolean(c.imageReady) !== mergedImg ||
        c.videoSavedFileName !== mergedFile
      ) {
        changed = true;
        return {
          ...c,
          reviewedForEditor: mergedRev,
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
}

export function normalizeVoiceoverUrlString(url?: string): string {
  if (!url || typeof url !== 'string') return '';
  const trimmed = url.trim();
  if (/^\/?tts-files\/(.+)\.wav$/i.test(trimmed)) {
    return trimmed.replace(/^\/?tts-files\/(.+)\.wav$/i, 'tts-files/$1.mp3');
  }
  if (trimmed.startsWith('/tts-files/')) {
    return trimmed.slice(1);
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

  const isDeadOrEmptyUrl = (u?: string) => !u || u.startsWith('blob:');

  if (isVideo76Exodo && isDeadOrEmptyUrl(masterAudioUrl)) {
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
          duration: 909,
          providerUsed: 'Gemini 3.8 Flash TTS (Charon)',
        },
      ];
    } else {
      audioTracks = audioTracks.map((t, i) =>
        i === 0 && isDeadOrEmptyUrl(t.audioUrl)
          ? { ...t, audioUrl: 'tts-files/tts-video-76-exodo-espanol.mp3' }
          : t
      );
    }
  } else if (isVideo74Princesas && isDeadOrEmptyUrl(masterAudioUrl)) {
    masterAudioUrl = 'tts-files/tts-1793103539750-763.mp3';
  }

  let nextClips = doc.clips;
  let nextRawClipsText = doc.rawClipsText;
  if (isVideo76Exodo) {
    const newImg19 =
      'Image 19: Create an image of a bright sunlit outdoor harbor pier in Santander, Spain, 1885, a weathered peasant hand holding a printed third-class steamship ticket and silver peseta coins in the foreground while a massive black-hulled transatlantic steamship vents white steam in the background, 16:9 horizontal, cinematic daylight, historical accuracy, no text.';
    const newClip19 =
      "Clip 19 (02:56 - 03:06): Create a video showing a slow camera push-in past the peasant's hand holding the third-class steamship ticket and silver coins on the sunlit stone pier toward the towering black hull of the transatlantic steamship in Santander harbor, Spain, 1885. Ambient Foley: crisp paper ticket fluttering in sea breeze, clinking silver coins, distant steamship horn and harbor waves, single continuous shot, strictly no shot changes, no music, no speech, no text. billete de tercera clase en vapor hacia La Habana o Veracruz costaba entre 205 y 235 pesetas. La aritmética de la supervivencia no dejaba alternativa: o. fix the name";

    const newImg20 =
      'Image 20: Create an image of @Ricardo_Ruiz_Balbin holding a rope-tied wooden trunk and embracing his weeping mother in black wool shawls in the foreground beside their stone cottage in Lué, Asturias, Spain, 1885, with a long misty dirt road stretching straight away into the background distance, 16:9 horizontal, cinematic lighting, historical accuracy, no text.';
    const newClip20 =
      "Clip 20 (03:06 - 03:16): Create a video showing a steady shot from behind as @Ricardo_Ruiz_Balbin gently releases his weeping mother's embrace in the foreground, turns his back to the camera, and walks straight away from her and away from the camera down the misty dirt road into the distance in Asturias, Spain, 1885, without ever turning back or changing direction. Ambient Foley: rough wool fabric rustling, wooden trunk handle creaking, footsteps receding on wet gravel, single continuous shot, strictly no shot changes, no music, no speech, no text. pagar 2 mil pesetas para no ir a la guerra en la manigua, o embarcar por la décima parte antes de cumplir los 20 años. fix the name";

    const newImg35 =
      'Image 35: Create an image of the dark iron boiler room of a Spanish transatlantic steamship in 1907, soot-covered stokers resting their shovels as the glowing coal furnaces dim and white steam settles around brass pressure gauges, 16:9 horizontal, cinematic lighting, historical accuracy, no text.';
    const newClip35 =
      'Clip 35 (05:36 - 05:46): Create a video showing a slow push-in toward the dimming iron coal furnaces and brass pressure gauges in the quiet steamship boiler room in 1907 as thin white steam gently dissipates in the air. Ambient Foley: dying furnace embers crackling softly, final steam valve hiss fading into silence, cooling iron ticking, single continuous shot, strictly no shot changes, no music, no speech, no text. de Alfonso XIII, todos compartían la misma incertidumbre al divisar la costa americana. ¿Qué ocurría realmente cuando las calderas se apagaban y aquellos viajeros exhaustos se. fix the name';
    const newImg42 =
      "Image 42: Create an image of stacked emigrants' wooden trunks with tied cardboard quarantine tags in the reception hall of Triscornia camp, Havana, Cuba, 1905, beside a wooden table holding amber glass bottles of disinfectant and a brass medical seal, 16:9 horizontal, warm window light, cinematic lighting, historical accuracy, no text.";
    const newClip42 =
      'Clip 42 (06:46 - 06:56): Create a video showing a slow lateral camera dolly across the stacked wooden trunks with quarantine tags and the amber glass disinfectant bottles in the sunlit reception hall of Triscornia, Havana, Cuba, 1905, as dust motes float in the air. Ambient Foley: paper quarantine tags fluttering softly in the draft, wooden floorboards creaking, distant footsteps, single continuous shot, strictly no shot changes, no music, no speech, no text. paseo central por jardines con 35 mil rosales. Al mando del campamento se encontraba el doctor Frank Menocal, cirujano de 39 años de edad hacia 1905. fix the name';
    const newImg76 =
      'Image 76: Create an image of @Pedro_Garfias_Zurita wearing thick tortoise-shell glasses, a black beret, and a worn shepherd jacket standing thoughtfully at the iron railing on the Sinaia steamship deck in Veracruz harbor, Mexico, 1939, surrounded only by adult passengers aged 35 to 60 in the background, 16:9 horizontal, cinematic lighting, historical accuracy, no text. STRICT ADULTS-ONLY CAST (AGES 35–60): Every single person in foreground and background is a mature adult aged 35 to 60 years old; strictly zero children, zero infants, zero minors, zero teenagers, and zero underage figures anywhere in the frame.';
    const newClip76 =
      'Clip 76 (12:26 - 12:36): Create a video showing a slow dolly-in on @Pedro_Garfias_Zurita wearing thick glasses and a black beret standing thoughtfully at the ship railing in Veracruz harbor, Mexico, 1939, looking toward the port as the harbor breeze moves his coat lapel. Ambient Foley: gentle harbor waves against the hull, distant gull cries, soft sea breeze, single continuous shot, strictly no shot changes, no music, no speech, no text. STRICT ADULTS-ONLY CAST (AGES 35–60): Every single person in foreground and background is a mature adult aged 35 to 60 years old; strictly zero children, zero infants, zero minors, zero teenagers, and zero underage figures anywhere in the frame. gastado, boina negra, chamarra de pastor zamorano y gruesas gafas de concha el poeta de 38 años @Pedro_Garfias_Zurita, junto a médicos, científicos, maestros y. fix the name';

    if (Array.isArray(doc.clips)) {
      let clipsChanged = false;
      const updated = doc.clips.map((c) => {
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
            /steam autoclave|iron door of the steam autoclave/i.test(c.videoPrompt || ''))
        ) {
          clipsChanged = true;
          return {
            ...c,
            imagePrompt: newImg42,
            videoPrompt: newClip42,
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
        /Image 35:[^\n]*heavy iron anchor/i.test(rawText) ||
        /Clip 35\s*\([^)]*\):[^\n]*anchor chain plunges/i.test(rawText)
      ) {
        rawText = rawText
          .replace(/Image 35:[^\n]*heavy iron anchor[^\n]*/i, newImg35)
          .replace(/Clip 35\s*\([^)]*\):[^\n]*anchor chain plunges[^\n]*/i, newClip35);
      }
      if (
        /Image 42:[^\n]*Disinfection Brigade/i.test(rawText) ||
        /Clip 42\s*\([^)]*\):[^\n]*steam autoclave/i.test(rawText)
      ) {
        rawText = rawText
          .replace(/Image 42:[^\n]*Disinfection Brigade[^\n]*/i, newImg42)
          .replace(/Clip 42\s*\([^)]*\):[^\n]*steam autoclave[^\n]*/i, newClip42);
      }
      nextRawClipsText = rawText;
    }
  }

  if (
    masterAudioUrl !== doc.masterAudioUrl ||
    audioTracks !== doc.audioTracks ||
    nextClips !== doc.clips ||
    nextRawClipsText !== doc.rawClipsText
  ) {
    return {
      ...doc,
      masterAudioUrl,
      audioTracks,
      clips: nextClips,
      rawClipsText: nextRawClipsText,
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

export function getBrowserGitHubToken(): string {
  try {
    return (
      localStorage.getItem('huellas_master_gh_token') ||
      localStorage.getItem('rs_apps_studio_gh_token') ||
      ''
    ).trim();
  } catch {
    return '';
  }
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

export function loadLocalCachedDocumentaries(): DocumentaryProject[] {
  try {
    const raw = localStorage.getItem(LOCAL_DOCS_CACHE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? applyStoredClipReviewStateToDocs(parsed) : [];
  } catch {
    return [];
  }
}

export function stripHeavyMediaForStorage(
  list: DocumentaryProject[],
  stripReferenceImages = false
): DocumentaryProject[] {
  return (list || []).map((doc) => ({
    ...doc,
    ...(stripReferenceImages &&
    typeof doc.thumbnailImageUrl === 'string' &&
    doc.thumbnailImageUrl.startsWith('data:') &&
    doc.thumbnailImageUrl.length > 60000
      ? { thumbnailImageUrl: '' }
      : {}),
    ...(stripReferenceImages &&
    typeof doc.masterAudioUrl === 'string' &&
    doc.masterAudioUrl.startsWith('data:') &&
    doc.masterAudioUrl.length > 60000
      ? { masterAudioUrl: '' }
      : {}),
    ...(stripReferenceImages && Array.isArray(doc.audioTracks)
      ? {
          audioTracks: doc.audioTracks.map((t) =>
            typeof t.audioUrl === 'string' && t.audioUrl.startsWith('data:') && t.audioUrl.length > 60000
              ? { ...t, audioUrl: '' }
              : t
          ),
        }
      : {}),
    ...(stripReferenceImages && Array.isArray(doc.references)
      ? {
          references: doc.references.map((r) =>
            typeof r.imageUrl === 'string' && r.imageUrl.startsWith('data:') && r.imageUrl.length > 60000
              ? { ...r, imageUrl: '' }
              : r
          ),
        }
      : {}),
    clips: Array.isArray(doc.clips)
      ? doc.clips.map((c) => {
          if (!c.videoFrames || c.videoFrames.length === 0) return c;
          const { videoFrames, ...rest } = c;
          return rest;
        })
      : [],
  }));
}

export function saveLocalCachedDocumentaries(list: DocumentaryProject[]) {
  if (!Array.isArray(list)) return;
  // Always persist clip review flags in dedicated lightweight storage first (< 15KB, never fails quota)
  for (const doc of list) {
    if (doc && doc.id && Array.isArray(doc.clips) && doc.clips.length > 0) {
      saveClipReviewStateForDoc(doc.id, doc.clips);
    }
  }
  try {
    localStorage.setItem(LOCAL_DOCS_CACHE_KEY, JSON.stringify(list));
  } catch {
    try {
      // Fallback 1: Strip transient base64 videoFrames from clips so localStorage fits within 5MB quota
      const lightList = stripHeavyMediaForStorage(list, false);
      localStorage.setItem(LOCAL_DOCS_CACHE_KEY, JSON.stringify(lightList));
    } catch {
      try {
        // Fallback 2: Also strip heavy base64 reference/audio data URLs so documentary structure & flags always persist
        const ultraLightList = stripHeavyMediaForStorage(list, true);
        localStorage.setItem(LOCAL_DOCS_CACHE_KEY, JSON.stringify(ultraLightList));
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
    wNorm.masterAudioUrl && !wNorm.masterAudioUrl.startsWith('blob:')
      ? wNorm.masterAudioUrl
      : oNorm.masterAudioUrl || wNorm.masterAudioUrl || '';
  const mergedAudioTracks =
    Array.isArray(wNorm.audioTracks) &&
    wNorm.audioTracks.length > 0 &&
    wNorm.audioTracks.some((t) => t.audioUrl && !t.audioUrl.startsWith('blob:'))
      ? wNorm.audioTracks
      : Array.isArray(oNorm.audioTracks) && oNorm.audioTracks.length > 0
      ? oNorm.audioTracks
      : wNorm.audioTracks || [];

  const baseWinner: DocumentaryProject = {
    ...wNorm,
    masterAudioUrl: mergedMasterAudio,
    audioTracks: mergedAudioTracks,
  };

  if (!Array.isArray(baseWinner.clips) || !Array.isArray(oNorm.clips) || oNorm.clips.length === 0) {
    return baseWinner;
  }
  const otherClipByNum = new Map<number, DocumentaryProject['clips'][number]>();
  for (const c of oNorm.clips) {
    if (c && typeof c.clipNumber === 'number') {
      otherClipByNum.set(c.clipNumber, c);
    }
  }
  const mergedClips = baseWinner.clips.map((c) => {
    const o = otherClipByNum.get(c.clipNumber);
    if (!o) return c;
    return {
      ...c,
      reviewedForEditor:
        c.reviewedForEditor !== undefined
          ? Boolean(c.reviewedForEditor || o.reviewedForEditor)
          : Boolean(o.reviewedForEditor),
      recreated: Boolean(c.recreated || o.recreated),
      videoReady: Boolean(c.videoReady || o.videoReady),
      imageReady: Boolean(c.imageReady || o.imageReady),
      videoSavedFileName: c.videoSavedFileName || o.videoSavedFileName,
      videoFrames:
        Array.isArray(c.videoFrames) && c.videoFrames.length > 0
          ? c.videoFrames
          : o.videoFrames,
    };
  });
  return { ...baseWinner, clips: mergedClips };
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
      byId.set(l.id, normalized);
    } else {
      const lTime = Date.parse(normalized.updatedAt || normalized.createdAt || '') || 0;
      const rTime = Date.parse(existing.updatedAt || existing.createdAt || '') || 0;
      if (lTime >= rTime) {
        byId.set(l.id, mergeTwoDocumentaryObjects(normalized, existing));
      } else {
        byId.set(l.id, mergeTwoDocumentaryObjects(existing, normalized));
      }
    }
  }

  const sorted = Array.from(byId.values()).sort((a, b) => {
    const tA = Date.parse(a.updatedAt || a.createdAt || '') || 0;
    const tB = Date.parse(b.updatedAt || b.createdAt || '') || 0;
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

export async function pushDocumentariesToGitHub(
  docsList: DocumentaryProject[]
): Promise<{ synced: boolean; error?: string }> {
  const ghToken = getBrowserGitHubToken();
  if (!ghToken) {
    return { synced: false, error: 'Sin GitHub Token configurado en este dispositivo.' };
  }

  try {
    let jsonStr = JSON.stringify(docsList, null, 2);
    if (jsonStr.length > 900000) {
      jsonStr = JSON.stringify(stripHeavyMediaForStorage(docsList, false), null, 2);
      if (jsonStr.length > 900000) {
        jsonStr = JSON.stringify(stripHeavyMediaForStorage(docsList, true), null, 2);
      }
    }
    const encodedContent = btoa(unescape(encodeURIComponent(jsonStr)));
    const headers: Record<string, string> = {
      Accept: 'application/vnd.github+json',
      Authorization: `token ${ghToken}`,
      'Content-Type': 'application/json',
    };

    for (const targetPath of ['data/documentaries.json', 'docs/data/documentaries.json']) {
      const existingSha = await getGitHubFileSha(targetPath, ghToken);
      const bodyObj: Record<string, any> = {
        message: `Sync ${targetPath} (${docsList.length} documentales)`,
        content: encodedContent,
        branch: GITHUB_BRANCH,
      };
      if (existingSha) bodyObj.sha = existingSha;

      const putUrl = `https://api.github.com/repos/${GITHUB_OWNER}/${GITHUB_REPO}/contents/${targetPath}`;
      const putRes = await fetch(putUrl, {
        method: 'PUT',
        headers,
        body: JSON.stringify(bodyObj),
      });
      if (!putRes.ok && targetPath === 'data/documentaries.json') {
        throw new Error(`GitHub HTTP ${putRes.status}`);
      }
    }

    return { synced: true };
  } catch (e: any) {
    console.warn('Error pushing documentaries to GitHub:', e);
    return { synced: false, error: e?.message || 'Error al sincronizar con GitHub' };
  }
}

// ============================================================================
// CLIENT-SIDE GEMINI FALLBACKS FOR MOBILE / GITHUB PAGES MODE
// ============================================================================
async function callGeminiGenerateContentClientSide(
  parts: any[],
  jsonMode = false
): Promise<string> {
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
  const clipDurationLabel = `${standardClipSec} segundos`;
  const c1Dur = clip1Sec;
  const voiceEntrySec = c1Dur + 2;
  const clip2StartSec = doc.clip1SyncMode === 'RALENTIZAR_CAPCUT' ? c1Dur + 2 : c1Dur;
  const youtubeViralLink = (doc.promptConfig?.YOUTUBE_VIRAL_LINK || '').trim();
  const viralContextBlock = youtubeViralLink
    ? `\nENLACE DE VIDEO VIRAL DE YOUTUBE DE REFERENCIA: ${youtubeViralLink}\nINSTRUCCIÓN OBLIGATORIA DE ANÁLISIS VIRAL: Analiza profunda, minuciosa, detallada, incisiva e intensamente, detalle por detalle y sin obviar nada, el video de YouTube en el enlace (${youtubeViralLink}) para entender cómo se hizo viral en la plataforma y RECREA EXACTAMENTE LA MISMA ESTRUCTURA GANADORA en este documental.\n`
    : '';

  let stagePrompt = '';
  if (stageNumber === 2 || stageNumber === 3) {
    stagePrompt = `Actúa como un historiador, director de cine, y periodista profesional para "Huellas de la Humanidad".${viralContextBlock}
Tema del documental: ${doc.topic || doc.title || 'Por definir'}
Tipología: ${doc.typology || 'Suceso histórico'}
Tiempo histórico: ${doc.historicalTime || 'Por definir'}
Lugar histórico: ${doc.historicalLocation || 'Por definir'}
Duración aproximada objetivo: ~${doc.targetDurationSeconds || 120} segundos.

Genera la ETAPA 3 completa:
1. Recuento estructural de secciones cronológicas del documental.
2. Datos insólitos, curiosidades verificadas y contradicciones históricas centrales.
3. Prompt Maestro detallado para desarrollar Investigación Profunda (Deep Research / NotebookLM).`;
  } else if (stageNumber === 4) {
    const targetChars = Math.round(((doc.targetDurationSeconds || 120) - voiceEntrySec) * 13.5);
    stagePrompt = `Actúa como un historiador, director de cine, y periodista profesional para "Huellas de la Humanidad".
Tema: ${doc.topic || doc.title} (${doc.historicalTime}, ${doc.historicalLocation})
Estructura e Investigación previa:
${doc.sectionsStructure || ''}
${doc.deepResearchResult || ''}

Redacta la ETAPA 4: GUION DE LA VOZ EN OFF en español neutro documental:
- Los primeros ${voiceEntrySec} segundos no llevan locución y la voz narrativa entra obligatoriamente en el segundo ${voiceEntrySec} del video.
- Comienza obligatoriamente con la tríada en la primera oración cerrada con punto: "Año [número en dígitos], [Lugar, Ciudad, País]. [Premisa intrigante]." (Prohibido poner "en el" después del año).
- Años siempre en dígitos, siglos y monarcas en números romanos (ej. siglo XIX, Felipe II), miles con palabra "mil" (ej. "70 mil"), cero signos de exclamación.
- Incluye etiquetas de pausa estratégicas como [pausa: 1.5s] o [pausa: 2s].
- Cierra con el lema: "Cada historia deja una huella. Aquí seguimos sus rastros."
- Extensión aproximada calibrada: ~${targetChars} caracteres.`;
  } else if (stageNumber === 5) {
    const thumbOrientation =
      doc.thumbnailOrientation ||
      (doc.productionType === 'REEL_9X16' ? 'VERTICAL_9X16' : 'HORIZONTAL_16X9');
    const isThumbHorizontal = thumbOrientation === 'HORIZONTAL_16X9';
    const overlayText = (doc.thumbnailTextOverlay || '').trim() || 'EL SECRETO OCULTO';
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
    stagePrompt = `Actúa como diseñador experto en neuropsicología del clic (alto CTR en YouTube) para "Huellas de la Humanidad".
Tema / Título: ${doc.topic || doc.title} (${doc.historicalTime || doc.clip1Line1LocationTime || ''}, ${doc.historicalLocation || ''})
Gancho Clip 1: ${doc.clip1Line1LocationTime || ''} — ${doc.clip1Line2Hook || ''}
Guion REAL del documental (PRIORIDAD ABSOLUTA sobre cualquier título provisional):
"""
${(doc.voiceoverScript || doc.sectionsStructure || '').slice(0, 1400)}
"""
Personajes y Lugares del documental (@Referencias):
${refsContext}
Primeras escenas visuales del documental (Clips):
${clipsContext}
Orientación: ${isThumbHorizontal ? 'HORIZONTAL (16:9)' : 'VERTICAL (9:16)'}
Texto en pantalla obligatorio (Curiosity Gap): "${overlayText}"

REGLA CRÍTICA DE FIDELIDAD TEMÁTICA: Si el campo "Título" contiene el nombre de un video anterior o provisional (ej. "Video 75..."), IGNÓRALO y basa la escena visual de la miniatura 100% en el Guion REAL, los Personajes (@Referencias) y las escenas de los Clips de arriba.

APLICA OBLIGATORIAMENTE LOS 5 PRINCIPIOS NEUROPSICOLÓGICOS DEL CTR EN LA IMAGEN:
1. PROCESAMIENTO EN 13 MILISEGUNDOS (CERO RUIDO VISUAL): Composición ultra-limpia de máximo 3 elementos visuales (1 rostro dominante del protagonista real del guion en primer plano + 1 elemento detonante de peligro/misterio del guion + texto gancho), instantáneamente legible en la pantalla diminuta de un móvil.
2. ROSTRO HUMANO + EMOCIÓN EXTREMA + CONTACTO VISUAL DIRECTO: El protagonista histórico real del guion ocupa el 60% del encuadre en Medium Close-Up o Extreme Close-Up, mirando directamente al lente de la cámara ("direct piercing eye contact with the viewer"), con ojos muy abiertos mostrando la esclerótica blanca, expresión visceral intensa de shock, asombro, terror o traición descubierta, textura real de poros, sudor o lágrimas.
3. BRECHA DE LA CURIOSIDAD (CURIOSITY GAP): Muestra el segundo exacto antes del desastre o una contradicción visual enigmática del guion que obligue al cerebro del espectador a preguntarse "¿Qué acaba de pasar ahí?".
4. PSICOLOGÍA DEL COLOR Y ALTO CONTRASTE: Iluminación dramática de claroscuro con luz clave cálida de alto impacto (oro ardiente, fuego carmesí o ámbar intenso) sobre el rostro y luz de recorte (rim light) brillante que lo despega de un fondo oscuro saturado en tonos fríos (azul cian nocturno profundo o negro abismal).
5. ELEMENTOS DE MARCA Y TEXTO OBLIGATORIOS:
   - Inicia el prompt en inglés con: "Thumbnail: Create an image in ${
     isThumbHorizontal ? '16:9 horizontal aspect ratio' : '9:16 vertical aspect ratio'
   } "
   - ${
     isThumbHorizontal
       ? `Incluye textualmente: 'bold high-contrast cinematic documentary typography text overlay positioned in the bottom-left area of the image reading "${overlayText}"'`
       : `Incluye textualmente: 'bold high-contrast cinematic documentary typography text overlay centered and middle-justified right in the middle center of the image reading "${overlayText}"'`
   }
   - Incluye textualmente: 'a small discreet 5% scale logo in the top-right corner displaying "${
     isThumbHorizontal ? '8K' : 'HD'
   }" in metallic gold'
   - Incluye textualmente: 'official page logo cleanly integrated in the top-left corner from provided reference image at 5% scale, strictly preserving and visibly rendering both the logo emblem and the exact text underneath it "Huellas de la Humanidad" without cropping, blurring, or omitting the sub-text'
   - BLINDAJE ANTI-FILTRO FLOW: Describe siempre el rostro por sus rasgos físicos y vestimenta de época como un actor anónimo de recreación histórica ("portrayed by an anonymous historical reenactment actor in authentic period attire, no real public figures or prominent people"), evitando poner nombres propios de reyes o políticos reales en el prompt en inglés.
   - Cierra con: 'cinematic documentary realism, 8k resolution, sharp focus, safe framing composition, no modern objects, no CGI look, no unintended floating text, no music.'
Entrega únicamente el prompt en inglés listo para copiar y pegar.`;
  } else if (stageNumber === 6) {
    stagePrompt = `Actúa como un historiador y director de fotografía para "Huellas de la Humanidad".
Basado en este guion de voz en off y tema (${doc.topic || doc.title}, ${doc.historicalTime}, ${doc.historicalLocation}):
"""
${doc.voiceoverScript || doc.sectionsStructure || ''}
"""
Genera la ETAPA 6: PROMPTS DE IMÁGENES MODELO DE REFERENCIA para Nano Banana 2.1 (estándar oficial de continuidad de Google Flow):
- Antepón en la primera línea literalmente la orden: "Cambia los nombres y ponles @ seguido del nombre de la persona o lugar correspondiente."
- Para cada PERSONAJE principal, escribe una sola línea con el formato (describiendo únicamente rasgos físicos y vestimenta histórica como actor anónimo de recreación histórica para evitar el filtro "prominent people" de Google Flow):
  @Nombre_Personaje: Create an image in 16:9 of a character sheet with a head and shoulders shot showing the character's face on the left and a full body shot of the character on the right wearing the same period-accurate clothing and accessories (${doc.historicalTime}, ${doc.historicalLocation}) against a seamless white background, bright even lighting with minimal shadow, neutral forward-facing expression. Physical Characteristics & Clothing: [rasgos físicos detallados de adulto, cabello, rostro y vestimenta histórica de pies a cabeza, sin mencionar nombres propios de reyes o figuras públicas reales, portrayed by an anonymous historical reenactment actor in authentic period costume, no real public figures or prominent people]. Visual Style: Hyper-realistic cinematic film still, ultra-high-fidelity textures, visible skin pores, uncropped full frame, textless, no lines or text/words in the image.
- Para cada LUGAR principal (sin @ al inicio), escribe una sola línea con el formato:
  Nombre_Lugar: Create an image in 16:9 with 4 different 16:9 views of this same location (${doc.historicalTime}, ${doc.historicalLocation}) with perfect continuity: one wide establishing shot of the environment well-lit for the historical atmosphere, and three shots from different angles and perspectives showing architectural details, materials, and lighting. Physical Characteristics: [arquitectura, materiales, época e iluminación]. Visual Style: Hyper-realistic cinematic film still, atmospheric lighting, no people, animals, or characters in the image, textless, no lines or text/words in the image.`;
  } else if (stageNumber === 7) {
    const scriptContext = (
      doc.voiceoverScript ||
      doc.timelineFormattedText ||
      doc.sectionsStructure ||
      doc.deepResearchResult ||
      ''
    )
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, 900);
    const clip1VisualContext = (doc.clips?.[0]?.imagePrompt || '').trim();
    stagePrompt = `Actúa como director creativo de "Huellas de la Humanidad".
Tema: ${doc.topic || doc.title || ''} | Lugar: ${doc.historicalLocation || 'Por definir según el guion'} | Tiempo: ${doc.historicalTime || 'Por definir según el guion'}
Título del video: ${doc.title || doc.topic || ''}
Texto en pantalla de la Miniatura: ${doc.thumbnailTextOverlay || 'Ninguno'}
${clip1VisualContext ? `Escena visual del Clip 1: ${clip1VisualContext}\n` : ''}Guion de referencia: "${scriptContext}"
Propón EXACTAMENTE 3 opciones magnéticas para el TEXTO EN PANTALLA DEL CLIP 1 (Primeros ${voiceEntrySec}s del video, sin voz narrativa):
Opción 1:
Línea 1: [Ciudad, País, Año en dígitos o Siglo en romanos]
Línea 2: [TÍTULO GANCHO INTRIGANTE Y CINEMATOGRÁFICO EN MAYÚSCULAS]

Opción 2:
Línea 1: [Ciudad, País, Año en dígitos o Siglo en romanos]
Línea 2: [TÍTULO GANCHO INTRIGANTE Y CINEMATOGRÁFICO EN MAYÚSCULAS]

Opción 3:
Línea 1: [Ciudad, País, Año en dígitos o Siglo en romanos]
Línea 2: [TÍTULO GANCHO INTRIGANTE Y CINEMATOGRÁFICO EN MAYÚSCULAS]

REGLA INQUEBRANTABLE DE NO REPETICIÓN: No repitas lo mismo que el Título del video ni el Texto de la Miniatura.`;
  } else if (stageNumber === 8) {
    const opHeader = (doc.operationalHeader || DEFAULT_OPERATIONAL_HEADER).trim();
    const refsListText =
      Array.isArray(doc.references) && doc.references.length > 0
        ? doc.references
            .map((r) => `${r.tag} (${r.category === 'persona' ? 'Personaje' : 'Lugar'})`)
            .join(', ')
        : 'Usar personajes y lugares del guion';
    stagePrompt = `Actúa como un historiador, director de cine, y periodista profesional.
Genera la ETAPA 8: PROMPTS DE IMÁGENES INICIALES (Nano Banana 2.1) Y CLIPS DE VIDEO (Omni Flash) para el documental "${doc.topic || doc.title}" (${doc.historicalTime || ''}, ${doc.historicalLocation || ''}).
Referencias visuales obligatorias (@Personas y Lugares de Etapa 6): ${refsListText}.
Duración de cada clip a partir del Clip 2: ${clipDurationLabel}. Clip 1 (00:00 - 00:0${clip2StartSec}) es el Hook inicial sin voz narrativa. Clip 2 comienza en 00:0${clip2StartSec} con la línea 1 del Timeline.
Timeline de la Voz Narrativa:
"""
${doc.timelineFormattedText || doc.voiceoverScript || ''}
"""
Tu respuesta DEBE COMENZAR OBLIGATORIA Y LITERALMENTE con este párrafo inicial de 9 líneas:
${opHeader}

Escribe cada Image N y cada Clip N en su propia línea separada (SIN negritas ** ni viñetas) para TODOS los tramos del Timeline hasta el final, aplicando todos los blindajes (Anti-Filtro "Prominent People" con actores anónimos de recreación histórica + Física Anti-Mutación de 0s a ${standardClipSec}s + REGLA INQUEBRANTABLE DE NO DUPLICACIÓN ENTRE CLIPS CONSECUTIVOS: si la voz narrativa continúa en la misma escena o hilo argumental por más de un clip, los siguientes clips NO deben duplicarse visualmente jamás —prohibido poner dos oficinas seguidas, dos escritorios/mostradores con documentos seguidos o el mismo encuadre consecutivo—, sino mostrar algo visualmente diferente pero referente a la locución, alternando por ejemplo de un interior oscuro en un escritorio a un exterior luminoso en un muelle frente a un buque de vapor):
Image [N]: Create an image of [escena clara ~20-35 palabras en inglés con época y lugar describiendo a los personajes por sus rasgos físicos y vestimenta de época como actores anónimos de recreación histórica sin usar títulos ni nombres propios de figuras públicas reales], clean uncluttered composition with rigid architectural perspective, stationary period props, portrayed by anonymous historical reenactment actors in authentic period costume (no real public figures or prominent people), cinematic lighting, historical accuracy, no text.

Clip [N] ([MM:SS - MM:SS]): Create a video showing [movimiento cinematográfico de cámara del Prompt Maestro (pan, dolly, crane, tracking, tilt u orbit) ejecutado de forma suave y controlada sobre cabezal fluido/Steadicam + 1 acción física continua y pausada en cámara lenta sostenida durante los ${clipDurationLabel} completos (de 0s a ${standardClipSec}s) terminando en postura estable hasta el último fotograma]. Rigid non-mutating walls and 3D architecture, fixed subject count from 0s to ${standardClipSec}s (no people appearing out of nowhere, vanishing, or morphing), all background props 100% gravity-locked and stationary, portrayed by anonymous fictionalized theatre actors in period costume (no real public figures or prominent people, no unintended explosions or flashes). Ambient Foley: [sonidos puntuales en inglés], single continuous shot, strictly no shot changes, no music, no speech, no text. ${doc.promptConfig?.VOZ_NARRATIVA_EN_CLIPS !== 'EXCLUIR' ? '[oración exacta de la voz narrativa en español correspondiente a ese tramo]. ' : ''}fix the name`;
  } else if (stageNumber === 10) {
    stagePrompt = `Actúa como compositor cinematográfico de "Huellas de la Humanidad".
Tema: ${doc.topic || doc.title} (${doc.historicalTime || ''}, ${doc.historicalLocation || ''})
Duración final confirmada del video: ${doc.confirmedFinalDuration || '02:00'}
Guion: ${(doc.voiceoverScript || doc.sectionsStructure || '').slice(0, 1400)}
Genera la ETAPA 10: BANDA SONORA PARA SUNO dejando silencios de 10-20s entre cada canción y haciendo que la última canción dure obligatoriamente 1:30. Entrega cada canción con sus 6 campos exactos (1. Título, 2. Duración, 3. De dónde a dónde cubre en el video en tiempo, 4. Prompt de Lyrics, 5. Prompt de Style, 6. Explicación de la Canción).`;
  } else if (stageNumber === 101) {
    stagePrompt = `Actúa como experto en neuropsicología del clic (alto CTR en YouTube) y director creativo de miniaturas para "Huellas de la Humanidad".
Título del video: ${doc.title || ''}
Texto en pantalla en los primeros ${voiceEntrySec} segundos (Clip 1): ${doc.clip1Line2Hook || ''}
Tema histórico: ${doc.topic || doc.title || ''} (${doc.historicalTime || doc.clip1Line1LocationTime || ''}, ${doc.historicalLocation || ''})
Guion REAL del documental (PRIORIDAD ABSOLUTA sobre cualquier título provisional):
"""
${(doc.voiceoverScript || doc.sectionsStructure || '').slice(0, 1400)}
"""

Aplicando el principio psicológico de LA BRECHA DE LA CURIOSIDAD (Curiosity Gap) y procesamiento en 13 milisegundos:
Genera EXACTAMENTE 3 opciones magnéticas de TEXTO EN PANTALLA para la miniatura basadas 100% en el Guion REAL de arriba (de 2 a 4 palabras máximo en ESPAÑOL y MAYÚSCULAS) que:
1. Despierten una incógnita inmediata en el cerebro ("¿Qué pasó?", "¿Por qué hizo eso?") sin regalar la respuesta.
2. Trabajen en equipo con el título del video pero SIN REPETIR ninguna frase del título ni del Texto del Clip 1.
3. Sean legibles en 13 milisegundos en la pantalla de un teléfono móvil.
Entrega únicamente las 3 líneas, una por línea, sin numeración ni comillas.`;
  } else if (stageNumber === 11 || stageNumber === 111) {
    stagePrompt = `Actúa como estratega de publicación de "Huellas de la Humanidad".
Tema: ${doc.topic || doc.title} (${doc.historicalTime || ''}, ${doc.historicalLocation || ''})
Duración final: ${doc.confirmedFinalDuration || '02:00'}
Genera la ETAPA 11: METADATA DE PUBLICACIÓN PARA YOUTUBE en formato "Todo Corrido" separada por líneas braille (⠀), sin encabezados excepto "Capítulos:" (con 10 capítulos cronológicos), 3 párrafos de descripción, Nota IA, Slogan y 5 hashtags #CamelCase de dos palabras.`;
  } else if (stageNumber === 112) {
    stagePrompt = `Actúa como estratega de publicación de "Huellas de la Humanidad".
Tema: ${doc.topic || doc.title} (${doc.historicalTime || ''}, ${doc.historicalLocation || ''})
Genera la ETAPA 11: METADATA DE PUBLICACIÓN PARA FACEBOOK en formato "Todo Corrido" separada por líneas braille (⠀), sin encabezados, sin capítulos ni tags, con título, 3 párrafos de descripción, Nota IA, Slogan y 5 hashtags #CamelCase de dos palabras.`;
  } else if (stageNumber === 113) {
    stagePrompt = `Actúa como estratega de comunidad de "Huellas de la Humanidad" para "${doc.topic || doc.title}". Genera EXCLUSIVAMENTE el COMENTARIO FIJADO DEL VIDEO sin encabezado, sin signos de exclamación, con años en dígitos y siglos/monarcas en romanos.`;
  } else if (stageNumber === 114) {
    stagePrompt = `Actúa como especialista en SEO de YouTube para "${doc.topic || doc.title}". Genera EXCLUSIVAMENTE el bloque de TAGS SEO DE YOUTUBE separados por comas (~460-500 caracteres) sin encabezado.`;
  }

  if (customInstruction) {
    stagePrompt += `\n\nInstrucción adicional del director: ${customInstruction}`;
  }
  return stagePrompt;
}

export async function generateStageClientSide(
  stageNumber: number,
  doc: DocumentaryProject,
  customInstruction?: string
): Promise<string> {
  const stagePrompt = buildStagePromptText(stageNumber, doc, customInstruction);
  const out = await callGeminiGenerateContentClientSide([{ text: stagePrompt }], false);
  if (stageNumber === 8) {
    return ensureOperationalHeaderInRawClips(out, doc.operationalHeader);
  }
  return out;
}

export async function generateThumbnailImageClientSide(
  prompt: string,
  logoDataUrl?: string
): Promise<string> {
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
  const includeVoiceInClips = doc.promptConfig?.VOZ_NARRATIVA_EN_CLIPS !== 'EXCLUIR';
  const auditPrompt = `Actúa como Director de Cine, Historiador y Supervisor de Continuidad de "Huellas de la Humanidad".
Audita la coherencia entre la voz narrativa y los clips del documental "${doc.topic || doc.title}":
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
REGLA INQUEBRANTABLE DE NO DUPLICACIÓN ENTRE CLIPS CONSECUTIVOS (Clip N vs Clip N-1): Si la voz narrativa continúa en la misma escena o hilo argumental por más de un clip, el Clip [N] NO debe duplicar visualmente la misma puesta en escena del Clip [N-1] (ej. prohibido encadenar dos escenas seguidas de escritorio/mostrador de madera en una oficina con documentos, o dos habitaciones iguales seguidas). Si el Clip [N] repite un escenario o composición similar al Clip [N-1], márcalo como "warning" o "mismatch" y redacta en "suggestedImagePrompt" (~20-35 palabras) y "suggestedVideoPrompt" (1 sola oración física simple ~12-22 palabras) una escena visualmente diferente pero referente a la locución (ej. un exterior luminoso en un muelle frente a un buque de vapor, o un entorno/escala radicalmente distinto) ${
    includeVoiceInClips ? 'con la voz narrativa y ' : ''
  }cerrando con "fix the name".
Devuelve EXCLUSIVAMENTE un JSON válido con {"summary": "...", "audits": [{"clipNumber": 1, "auditStatus": "ok"|"warning"|"mismatch", "auditReason": "...", "suggestedImagePrompt": "", "suggestedVideoPrompt": ""}]}`;

  const raw = await callGeminiGenerateContentClientSide([{ text: auditPrompt }], true);
  return JSON.parse(raw.replace(/^```json\s*/i, '').replace(/```\s*$/i, '').trim());
}

export async function auditClipVideoClientSide(
  doc: DocumentaryProject,
  clip: any,
  frames: string[],
  attempt: number = 1
): Promise<any> {
  const includeVoiceInClips = doc.promptConfig?.VOZ_NARRATIVA_EN_CLIPS !== 'EXCLUIR';
  const promptText = `Actúa como Director de Cine, Historiador y Supervisor de Control de Calidad Visual de "Huellas de la Humanidad".
Acabas de recibir ${frames.length} fotogramas reales (inicio, mitad y final) de un video recién generado en Google Flow para el Clip #${clip.clipNumber} (Intento #${attempt}).

CONTEXTO DEL DOCUMENTAL:
- Título / Tema: ${doc.topic || doc.title || ''}
- Época Histórica: ${doc.historicalTime || ''}
- Lugar Histórico: ${doc.historicalLocation || ''}

DATOS DEL CLIP #${clip.clipNumber} (${clip.timeRange || ''}):
- Voz Narrativa en este clip: "${
    clip.clipNumber === 1
      ? '[Clip 1 Hook inicial sin voz — Solo Foley y Texto en pantalla: ' +
        (doc.clip1Line1LocationTime || '') +
        ' / ' +
        (doc.clip1Line2Hook || '') +
        ']'
      : clip.narrationSegment || ''
  }"
- Prompt de Imagen Inicial: ${clip.imagePrompt || ''}
- Prompt de Video enviado a Google Flow: ${clip.videoPrompt || ''}

TU TAREA DE AUDITORÍA VISUAL (VIDEO REAL vs PROMPT vs VOZ NARRATIVA):
Observa detenidamente los fotogramas reales adjuntos y evalúa:
1. COHERENCIA CON LA VOZ NARRATIVA: ¿Lo que se ve en el video acompaña y tiene sentido directo con lo que dice la Voz Narrativa en este segmento?
2. CUMPLIMIENTO DEL PROMPT E HISTORIA: ¿Se respeta la época histórica (${doc.historicalTime || ''}), escenario y acción principal del prompt?
3. CALIDAD VISUAL Y LIBRE DE ERRORES IA: ¿Está libre de deformaciones graves (caras/manos monstruosas), anacronismos modernos evidentes, pantallas en negro o texto basura quemado?

CRITERIO DE VEREDICTO:
- "approved": El video se ve bien, encaja con la voz narrativa y con el prompt (score >= 75).
- "warning": El video es utilizable pero tiene un detalle menor (score 60-74).
- "rejected": El video NO coincide con la voz narrativa, ignoró el prompt, tiene errores visuales graves o anacronismos (score < 60). Si es "rejected", redacta obligatoriamente en "fixedVideoPrompt" un prompt de video corregido, más claro y directo para Google Flow iniciando con "Clip ${clip.clipNumber} (${clip.timeRange || '00:00 - 00:10'}): Create a video showing ..." ${
    includeVoiceInClips && clip.clipNumber > 1 && clip.narrationSegment
      ? `incluyendo la oración narrativa "${clip.narrationSegment}" `
      : ''
  }y cerrando con "fix the name".

Devuelve EXCLUSIVAMENTE un objeto JSON válido:
{
  "clipNumber": ${clip.clipNumber},
  "verdict": "approved" | "warning" | "rejected",
  "score": 90,
  "narrationMatch": true,
  "promptMatch": true,
  "visualQualityOk": true,
  "auditReason": "Explicación concisa en español de lo que se ve en el video y por qué aprueba o falla frente a la voz narrativa y el prompt",
  "issues": ["Lista de fallos si los hay"],
  "fixedVideoPrompt": "Prompt corregido listo para re-enviar a Google Flow si verdict es rejected, o string vacío si aprobó"
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
  const promptText = `Actúa como Experto en Neuropsicología de Miniaturas de YouTube (CTR) y Director de Arte de "Huellas de la Humanidad".
Evalúa la miniatura adjunta (Opción ${optionLabel}) para el documental "${doc.title || doc.topic}" (${doc.historicalTime || ''}, ${doc.historicalLocation || ''}).
Texto esperado en pantalla: "${overlayText}"

Califica del 0 al 20 cada una de las 5 Reglas Psicológicas del Clic (Total 0 a 100):
1. rule1_13msClarity (0-20): Procesamiento ultrarrápido en 13 milisegundos. ¿Es ultra-limpia (máximo 3 elementos), sin ruido visual y legible en un móvil pequeño?
2. rule2_faceEmotionEyeContact (0-20): Rostro humano expresivo, emoción visceral intensa (asombro, shock, terror, misterio) y contacto visual directo con el espectador.
3. rule3_curiosityGap (0-20): Brecha de la curiosidad (Curiosity Gap). ¿Plantea una incógnita visual irresistible ("¿Qué acaba de pasar?") sin regalar toda la respuesta?
4. rule4_colorContrast (0-20): Psicología del color y contraste (luz cálida dorada/roja/ámbar de alto impacto contra fondo oscuro frío + legibilidad del texto).
5. rule5_titleBrandSynergy (0-20): Sincronización con el título, texto en pantalla "${overlayText}" bien escrito, logo oficial "Huellas de la Humanidad" arriba a la izquierda y sello "8K"/"HD" arriba a la derecha.

Devuelve EXCLUSIVAMENTE un JSON válido con esta estructura exacta:
{
  "optionLabel": "${optionLabel}",
  "ctrScore": 92,
  "rule1_13msClarity": 19,
  "rule2_faceEmotionEyeContact": 19,
  "rule3_curiosityGap": 18,
  "rule4_colorContrast": 18,
  "rule5_titleBrandSynergy": 18,
  "verdict": "EXCELENTE",
  "summary": "Explicación concisa en español (1-2 oraciones) del impacto psicológico de esta miniatura.",
  "improvementTip": "Sugerencia breve opcional si algún punto bajó de 17."
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
  const promptText = `Actúa como el historiador principal y director de "Huellas de la Humanidad".
Documental: ${doc.publishTitle || doc.topic || doc.title || 'Documental Histórico'} (${doc.historicalTime || ''} | ${doc.historicalLocation || ''})
Contexto: ${(doc.voiceoverScript || doc.sectionsStructure || '').slice(0, 2500)}
${commentText ? `Comentario:\n${commentText}\n` : ''}
${customInstruction ? `Instrucción adicional: ${customInstruction}\n` : ''}
Redacta respuestas certeras y concisas (1-3 oraciones, años en dígitos, siglos/monarcas en números romanos, miles con "mil", CERO signos de exclamación).
Devuelve EXCLUSIVAMENTE un JSON válido: {"replies": [{"author": "@usuario", "commentText": "...", "replyConcise": "...", "replyAlternative": "...", "historicalContextNote": "..."}]}`;

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
  const pcmLen = pcmChunks.reduce((acc, c) => acc + c.byteLength, 0);
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
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }

  const blob = new Blob([buffer], { type: 'audio/wav' });
  const duration = Math.max(1, parseFloat((pcmLen / (sampleRate * 2)).toFixed(2)));
  return { url: URL.createObjectURL(blob), blob, duration };
}

export async function synthesizeTtsClientSide(params: {
  text: string;
  voice: string;
  style: string;
  speed: string;
  language: string;
  label: string;
}): Promise<TTSRecord & { audioBlob?: Blob }> {
  const apiKey = getBrowserGeminiKey();
  if (!apiKey) {
    throw new Error('Configura primero tu Gemini API Key para generar audio TTS.');
  }
  const rawInput = (params.text || '').trim();
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
  };
  const physicalVoice = physicalVoices[params.voice] || 'Charon';

  const pauseRegex =
    /[\[{]\s*(?:(?:pausa|pause|silencio)\s*:?\s*)?([0-9]{1,2}(?:[.,][0-9]+)?)\s*(s|seg|segundos|ms|milisegundos)?\s*[\]}]|[\[{]\s*(?:pausa|pause|silencio)\s*[\]}]/gi;
  const segments: Array<{ type: 'text' | 'pause'; text?: string; duration?: number }> = [];
  let lastIdx = 0;
  let match: RegExpExecArray | null;
  while ((match = pauseRegex.exec(rawInput)) !== null) {
    const before = rawInput.slice(lastIdx, match.index).trim();
    if (before) segments.push({ type: 'text', text: before });
    const dur = match[1] ? parseFloat(match[1].replace(',', '.')) : 1.5;
    segments.push({ type: 'pause', duration: Math.max(0.2, Math.min(15, dur)) });
    lastIdx = match.index + match[0].length;
  }
  const tail = rawInput.slice(lastIdx).trim();
  if (tail) segments.push({ type: 'text', text: tail });
  if (segments.length === 0) {
    segments.push({ type: 'text', text: cleanText });
  }

  const synthOneSegment = async (segText: string): Promise<Uint8Array> => {
    const fullPrompt = `[DIRECTOR_INSTRUCTION]
Vocal Character Profile: "${params.voice}" (Physical base "${physicalVoice}")
Mood, Emotion & Delivery: Speak with deep cinematic documentary gravitas, emotional resonance, and deliberate pacing. Maintain strict vocal consistency and uniform documentary pitch.
Accent & Language Vibe: Speak in Spanish with a neutral, solemn, warm Latin American documentary accent (Español Neutro). Do NOT use European Spanish ceceo.

ACTOR INSTRUCTION: Deliver the exact text inside [TEXT] once from beginning to end. Never repeat sentences, never read markup tags or brackets.

[TEXT]
${segText}`;

    const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-3.8-flash-tts:generateContent?key=${encodeURIComponent(
      apiKey
    )}`;
    const res = await fetch(url, {
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
    const data = await res.json();
    if (!res.ok) {
      throw new Error(data?.error?.message || `Error TTS HTTP ${res.status}`);
    }
    const b64Audio = data?.candidates?.[0]?.content?.parts?.[0]?.inlineData?.data;
    if (!b64Audio) {
      throw new Error('El modelo gemini-3.8-flash-tts no devolvió audio.');
    }
    const binary = atob(b64Audio.replace(/\s/g, ''));
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) {
      bytes[i] = binary.charCodeAt(i);
    }
    // Strip WAV header if present
    if (
      bytes.byteLength > 44 &&
      bytes[0] === 0x52 &&
      bytes[1] === 0x49 &&
      bytes[2] === 0x46 &&
      bytes[3] === 0x46
    ) {
      return bytes.subarray(44);
    }
    return bytes;
  };

  const pcmResults: Uint8Array[] = new Array(segments.length);
  let cursor = 0;
  const worker = async () => {
    while (cursor < segments.length) {
      const idx = cursor++;
      const seg = segments[idx];
      if (seg.type === 'pause' && seg.duration) {
        pcmResults[idx] = new Uint8Array(Math.round(24000 * seg.duration) * 2);
      } else if (seg.type === 'text' && seg.text) {
        pcmResults[idx] = await synthOneSegment(seg.text);
      } else {
        pcmResults[idx] = new Uint8Array(0);
      }
    }
  };

  await Promise.all([worker(), worker(), worker(), worker()]);

  const { url: wavUrl, blob: wavBlob, duration } = pcmChunksToWavBlobUrl(pcmResults, 24000);
  const words = cleanText.split(/\s+/).filter(Boolean).length;
  const pauseCount = segments.filter((s) => s.type === 'pause').length;
  return {
    id: `tts-mobile-${Date.now()}`,
    text: params.text,
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
  };
}
