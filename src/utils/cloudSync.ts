import {
  DocumentaryProject,
  DEFAULT_OPERATIONAL_HEADER,
  TTSRecord,
} from '../types';
import { ensureOperationalHeaderInRawClips, stripPauseTags } from './smartParsers';

export const GITHUB_OWNER = 'raydelw-a11y';
export const GITHUB_REPO = 'Huellas-Master';
export const GITHUB_BRANCH = 'main';
export const PUBLIC_GITHUB_PAGES_URL = `https://${GITHUB_OWNER}.github.io/${GITHUB_REPO}/`;

const LOCAL_DOCS_CACHE_KEY = 'huellas_master_docs_cache_v1';
const LOCAL_DELETED_IDS_KEY = 'huellas_master_deleted_ids_v1';

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
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

export function saveLocalCachedDocumentaries(list: DocumentaryProject[]) {
  try {
    localStorage.setItem(LOCAL_DOCS_CACHE_KEY, JSON.stringify(list));
  } catch (e) {
    console.warn('Could not cache documentaries in localStorage:', e);
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
        byId.set(l.id, normalized);
      }
    }
  }

  return Array.from(byId.values()).sort((a, b) => {
    const tA = Date.parse(a.updatedAt || a.createdAt || '') || 0;
    const tB = Date.parse(b.updatedAt || b.createdAt || '') || 0;
    return tB - tA;
  });
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
    const jsonStr = JSON.stringify(docsList, null, 2);
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
  const clipDurationLabel = doc.clipDurationMode === '8_SEGUNDOS' ? '8 segundos' : '10 segundos';
  const c1Dur = Number(doc.clip1DurationSeconds) || (doc.clip1SyncMode === 'VOZ_EN_CLIP_2' ? 6 : 4);
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
- Para cada PERSONAJE principal, escribe una sola línea con el formato:
  @Nombre_Personaje: Create an image in 16:9 of a character sheet with a head and shoulders shot showing the character's face on the left and a full body shot of the character on the right wearing the same period-accurate clothing and accessories (${doc.historicalTime}, ${doc.historicalLocation}) against a seamless white background, bright even lighting with minimal shadow, neutral forward-facing expression. Physical Characteristics & Clothing: [rasgos físicos detallados, edad, cabello, rostro y vestimenta histórica de pies a cabeza]. Visual Style: Hyper-realistic cinematic film still, ultra-high-fidelity textures, visible skin pores, uncropped full frame, textless, no lines or text/words in the image.
- Para cada LUGAR principal (sin @ al inicio), escribe una sola línea con el formato:
  Nombre_Lugar: Create an image in 16:9 with 4 different 16:9 views of this same location (${doc.historicalTime}, ${doc.historicalLocation}) with perfect continuity: one wide establishing shot of the environment well-lit for the historical atmosphere, and three shots from different angles and perspectives showing architectural details, materials, and lighting. Physical Characteristics: [arquitectura, materiales, época e iluminación]. Visual Style: Hyper-realistic cinematic film still, atmospheric lighting, no people, animals, or characters in the image, textless, no lines or text/words in the image.`;
  } else if (stageNumber === 7) {
    stagePrompt = `Actúa como director creativo de "Huellas de la Humanidad".
Tema: ${doc.topic || doc.title} | Lugar: ${doc.historicalLocation} | Tiempo: ${doc.historicalTime}
Título del video: ${doc.title || ''}
Texto en pantalla de la Miniatura: ${doc.thumbnailTextOverlay || ''}
Guion: ${(doc.voiceoverScript || '').slice(0, 600)}
Propón 3 opciones magnéticas para el TEXTO EN PANTALLA DEL CLIP 1 (Primeros ${voiceEntrySec}s del video):
Línea 1: [Ciudad, País, Año en dígitos o Siglo en romanos]
Línea 2: [Título Gancho intrigante y cinematográfico]
REGLA INQUEBRANTABLE DE NO REPETICIÓN: No repitas lo mismo que el Título del video ni el Texto de la Miniatura.`;
  } else if (stageNumber === 8) {
    const opHeader = (doc.operationalHeader || DEFAULT_OPERATIONAL_HEADER).trim();
    stagePrompt = `Actúa como un historiador, director de cine, y periodista profesional.
Genera la ETAPA 8: PROMPTS DE IMÁGENES INICIALES (Nano Banana 2.1) Y CLIPS DE VIDEO (Omni Flash) para el documental "${doc.topic || doc.title}" (${doc.historicalTime}, ${doc.historicalLocation}).
Duración de cada clip a partir del Clip 2: ${clipDurationLabel}. Clip 2 comienza en 00:0${clip2StartSec}.
Timeline de la Voz Narrativa:
"""
${doc.timelineFormattedText || doc.voiceoverScript || ''}
"""
Tu respuesta DEBE COMENZAR OBLIGATORIA Y LITERALMENTE con este párrafo inicial de 9 líneas:
${opHeader}

Formato exacto simple y conciso por cada clip:
Image [N]: Create an image of [escena clara ~20-35 palabras con época y lugar], cinematic lighting, historical accuracy, no text.

Clip [N] ([MM:SS - MM:SS]): Create a video showing [1 movimiento suave de cámara + 1 acción física simple sobre la imagen inicial, ~12-22 palabras]. Ambient Foley: [sonidos puntuales], single continuous shot, strictly no shot changes, no music, no speech, no text. ${doc.promptConfig?.VOZ_NARRATIVA_EN_CLIPS !== 'EXCLUIR' ? '[oración de la voz narrativa correspondiente]. ' : ''}fix the name`;
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
Si un clip requiere mejora, redacta "suggestedImagePrompt" conciso (~20-35 palabras) y "suggestedVideoPrompt" de 1 sola oración física simple (~12-22 palabras) ${
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

function pcmBase64ToWavBlobUrl(base64Pcm: string, sampleRate = 24000): { url: string; duration: number } {
  const binary = atob(base64Pcm.replace(/\s/g, ''));
  const pcmLen = binary.length;
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
  for (let i = 0; i < pcmLen; i++) {
    bytes[i] = binary.charCodeAt(i);
  }

  const blob = new Blob([buffer], { type: 'audio/wav' });
  const duration = Math.max(1, Math.round(pcmLen / (sampleRate * 2)));
  return { url: URL.createObjectURL(blob), duration };
}

export async function synthesizeTtsClientSide(params: {
  text: string;
  voice: string;
  style: string;
  speed: string;
  language: string;
  label: string;
}): Promise<TTSRecord> {
  const apiKey = getBrowserGeminiKey();
  if (!apiKey) {
    throw new Error('Configura primero tu Gemini API Key para generar audio TTS desde el teléfono.');
  }
  const cleanText = stripPauseTags(params.text).trim();
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

  const fullPrompt = `[DIRECTOR_INSTRUCTION]
Vocal Character Profile: "${params.voice}" (Physical base "${physicalVoice}")
Mood, Emotion & Delivery: Speak with deep cinematic documentary gravitas, emotional resonance, and deliberate pacing. Maintain strict vocal consistency and uniform documentary pitch.
Accent & Language Vibe: Speak in Spanish with a neutral, solemn, warm Latin American documentary accent (Español Neutro). Do NOT use European Spanish ceceo.

ACTOR INSTRUCTION: Deliver the exact text inside [TEXT] once from beginning to end. Never repeat sentences, never read markup tags or brackets.

[TEXT]
${cleanText}`;

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

  const { url: wavUrl, duration } = pcmBase64ToWavBlobUrl(b64Audio, 24000);
  const words = cleanText.split(/\s+/).filter(Boolean).length;
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
    createdAt: new Date().toISOString(),
    storageMode: 'local',
    wordCount: words,
    duration,
    providerUsed: 'Gemini 3.8 Flash TTS (Móvil)',
    label: params.label,
  };
}
