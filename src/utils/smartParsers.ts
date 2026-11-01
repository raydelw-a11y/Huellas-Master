import { DocumentaryClip, ReferenceAsset, SunoTrack, Sentence, DEFAULT_OPERATIONAL_HEADER } from '../types';
import { formatMMSS } from './formatTime';

export function ensureOperationalHeaderInRawClips(
  rawText: string,
  operationalHeader: string = DEFAULT_OPERATIONAL_HEADER
): string {
  const header = (operationalHeader || DEFAULT_OPERATIONAL_HEADER).trim();
  const trimmed = (rawText || '').trim();
  if (!trimmed) return header;
  if (
    /^Act[uú]a como un historiador/i.test(trimmed) ||
    trimmed.includes('Cambia los nombres de los clips a las primeras 6 palabras')
  ) {
    return trimmed;
  }
  return `${header}\n\n${trimmed}`;
}

/**
 * Blindaje automático Anti-Filtro "Prominent People", Anti-Menores y Anti-Violencia para Google Flow / Nano Banana 2.1 / Veo 3.1.
 * Se aplica automáticamente desde la construcción de cualquier prompt (Miniatura, Referencias, Imágenes y Videos).
 */
export function applyAutomaticFlowPolicyShield(
  rawPrompt: string,
  preserveLeadingAtTag: boolean = false
): string {
  if (!rawPrompt || !rawPrompt.trim()) return '';
  let p = rawPrompt.trim();

  let leadingTagPrefix = '';
  if (preserveLeadingAtTag) {
    const leadMatch = p.match(/^(@[A-Za-z0-9_ÁÉÍÓÚáéíóúÑñ]+\s*:\s*)/);
    if (leadMatch) {
      leadingTagPrefix = leadMatch[1];
      p = p.slice(leadingTagPrefix.length).trim();
    }
  }

  // 1. Reemplazar títulos reales / políticos / religiosos + Nombres Propios ("Prominent People" filter trigger)
  p = p.replace(
    /\b(?:Queen|Princess|Empress|Duchess|Lady|Countess|Reina|Princesa|Emperatriz|Duquesa)\s+[A-ZÁÉÍÓÚÑ][a-záéíóúñ]+(?:\s+(?:of|de|del|von|I|II|III|IV|V|VI|VII|VIII|IX|X|[A-ZÁÉÍÓÚÑ][a-záéíóúñ]+))*/g,
    'an adult historical noblewoman in regal period attire, portrayed by an anonymous dramatic actress'
  );
  p = p.replace(
    /\b(?:King|Prince|Emperor|Duke|Lord|Count|Sultan|Tsar|Czar|Pharaoh|General|President|Prime Minister|Chancellor|Dictator|Rey|Príncipe|Emperador|Duque|Conde|Faraón)\s+[A-ZÁÉÍÓÚÑ][a-záéíóúñ]+(?:\s+(?:of|de|del|von|I|II|III|IV|V|VI|VII|VIII|IX|X|XI|XII|XIII|XIV|XV|XVI|[A-ZÁÉÍÓÚÑ][a-záéíóúñ]+))*/g,
    'an adult historical monarch in ceremonial period wardrobe, portrayed by an anonymous dramatic actor'
  );
  p = p.replace(
    /\b(?:Pope|Bishop|Archbishop|Cardinal|Saint|Father|Friar|Papa|Obispo|Arzobispo|Cardenal|San|Santa|Santo)\s+[A-ZÁÉÍÓÚÑ][a-záéíóúñ]+(?:\s+(?:of|de|del|I|II|III|IV|V|VI|VII|VIII|IX|X|XI|XII|XIII|XIV|XV|XVI|[A-ZÁÉÍÓÚÑ][a-záéíóúñ]+))*/g,
    'an elderly historical clergyman in ornate ceremonial vestments, portrayed by an anonymous actor'
  );

  // 2. Reemplazar nombres propios históricos sueltos que disparan el detector de "prominent people"
  p = p.replace(
    /\b(Ingeborg|Isambour|Blanche|Blanca|Eleanor|Leonor|Agnes|Inés|Cleopatra|Nefertiti|Boleyn|Elizabeth|Isabel|Mary Stuart|Marie Antoinette|Victoria|Catherine|Catalina|Juana)\b/gi,
    'the adult noblewoman in period attire'
  );
  p = p.replace(
    /\b(Philip Augustus|Felipe Augusto|Philip II|Felipe II|Alfonso XIII|Alfonso XII|Primo de Rivera|Franco|Machado|Philip|Felipe|Augustus|Augusto|Innocent III|Inocencio III|Innocent|Inocencio|Louis VIII|Louis IX|King John|Canute|Knut|Valdemar|Napoleon|Bonaparte|Caesar|Nero|Caligula|Charlemagne|Carlomagno|Henry VIII|Enrique VIII|Richard|Ricardo|Medici|Borgia|Habsburg|Romanov|Tudor|Plantagenet|Capet|Capeto|Columbus|Colón|Cortés|Pizarro|Bolívar)\b/gi,
    'the adult historical figure in period attire'
  );

  // 3. Reemplazar etiquetas @Persona en el cuerpo del prompt para evitar que Flow bloquee @Nombres reales
  p = p.replace(/@([A-Za-zÁÉÍÓÚÑáéíóúñ0-9_]+)/g, (_m, tagBody) => {
    const lower = String(tagBody).toLowerCase();
    if (
      /castillo|torre|catedral|palacio|abadia|sala|camara|bosque|ciudad|puerto|muelle|cubierta|barco|trono|corona|carta|sello|espada|mapa/.test(
        lower
      )
    ) {
      return tagBody.replace(/_/g, ' ');
    }
    if (/reina|princesa|dama|mujer|ingeborg|blanca|leonor|isabel|catalina|maria|ana|elena/i.test(lower)) {
      return 'an adult historical woman in authentic period wardrobe, portrayed by an anonymous historical reenactment actress';
    }
    return 'an adult historical figure in authentic period wardrobe, portrayed by an anonymous historical reenactment actor';
  });

  // 4. Neutralizar términos de edad/menores y términos gráficos/violencia/sangre
  p = p.replace(
    /\b(\d{1,2}-year-old|child bride|young girl|teenage girl|little girl|little boy|adolescent|minor|underage|niña|adolescente|menor)\b/gi,
    'adult in their mid-twenties'
  );
  p = p.replace(
    /\b(blood|bleeding|bloody|gore|corpse|dead body|cadaver|execution|beheading|decapitation|torture|suicide|self-harm|naked|nude|undressed|sangre|cadáver|ejecución|tortura|desnuda|desnudo)\b/gi,
    'dramatic chiaroscuro shadow'
  );

  // Limpiar repeticiones accidentales
  p = p
    .replace(
      /(portrayed by an anonymous (?:historical reenactment |dramatic )?(?:actor|actress))(?:,\s*\1)+/gi,
      '$1'
    )
    .replace(
      /\b(the adult (?:noblewoman|historical figure|historical ruler|historical sovereign))(?:[\s,]+\1)+/gi,
      '$1'
    )
    .replace(/\s{2,}/g, ' ')
    .trim();

  return `${leadingTagPrefix}${p}`.trim();
}

/**
 * Inyecta automáticamente desde la construcción del prompt TODOS los blindajes:
 * 1) Blindaje Anti-Filtro "Prominent People", Menores y Violencia (Google Flow / Nano Banana 2.1 / Veo 3.1)
 * 2) Blindaje de Física Rígida y Anti-Mutación (0s a 10s en Documental / 0s a 5s en Reel), conservando todos los movimientos de cámara del Prompt Maestro de forma controlada y estabilizada
 * 3) Escudo Anti-Violencia y Alucinaciones (cero explosiones o destellos no solicitados)
 */
export function ensureAntiMutationPhysicsInPrompt(
  rawPrompt: string,
  isImagePrompt: boolean = false,
  clipSec: number = 10
): string {
  if (!rawPrompt || !rawPrompt.trim()) return '';
  let p = rawPrompt.trim();

  let prefix = '';
  const prefixMatch = p.match(/^((?:Image|Clip|Imagen)\s+\d+(?:\s*\([^)]*\))?\s*:\s*)/i);
  if (prefixMatch) {
    prefix = prefixMatch[1];
    p = p.slice(prefix.length).trim();
  }

  // Aplicar primero el blindaje Anti-Filtro "Prominent People" y Políticas
  p = applyAutomaticFlowPolicyShield(p, false);

  // Limpiar cualquier cláusula previa para nunca duplicar
  p = p
    .replace(/\[ANTI-MUTATION[^\]]*\]\s*/gi, '')
    .replace(
      /Smooth,\s*controlled\s*fluid-head\s*camera\s*motion\s*maintaining\s*rigid\s*3D[^.]*\.\s*/gi,
      ''
    )
    .replace(
      /Sustained,\s*unhurried\s*continuous\s*action\s*across\s*the\s*full\s*\d+\s*seconds[^.]*\.\s*/gi,
      ''
    )
    .replace(/Fixed\s*subject\s*count\s*from\s*0s\s*to\s*\d+s[^.]*\.\s*/gi, '')
    .replace(
      /All\s*tables,\s*documents,\s*furniture,\s*and\s*props\s*remain\s*100%\s*gravity-locked[^.]*\.\s*/gi,
      ''
    )
    .replace(
      /Solid,\s*non-deforming\s*walls\s*and\s*rigid\s*3D\s*architectural\s*geometry[^.]*\.\s*/gi,
      ''
    )
    .replace(
      /Cinematic\s*historical\s*drama\s*reenactment\s*featuring\s*anonymous\s*fictionalized\s*theatre\s*actors[^.]*\.\s*/gi,
      ''
    )
    .trim();

  if (isImagePrompt) {
    const imgClause =
      'clean uncluttered composition with rigid architectural perspective, stationary period props, clear anatomical separation between subjects, portrayed by anonymous historical reenactment actors in authentic period costume (no real public figures or prominent people)';
    if (!p.toLowerCase().includes('rigid architectural perspective')) {
      if (/\bno\s+text\b/i.test(p)) {
        p = p.replace(/\b(no\s+text\.?)/i, `${imgClause}, $1`);
      } else {
        p = `${p.replace(/\.?\s*$/, '')}, ${imgClause}, no text.`;
      }
    } else if (!/no real public figures/i.test(p)) {
      p = `${p.replace(/\.?\s*$/, '')}, portrayed by anonymous historical reenactment actors in authentic period costume (no real public figures or prominent people).`;
    }
    return `${prefix}${p}`.replace(/\s{2,}/g, ' ').trim();
  }

  // Conservar todos los movimientos de cámara del Prompt Maestro (pan, dolly, crane, tracking, tilt, orbit), pero hacerlos suaves y controlados
  p = p
    .replace(/\b(whip\s+pan|fast\s+pan|rapid\s+pan)\b/gi, 'smooth controlled fluid-head pan')
    .replace(/\b(fast\s+tracking|rapid\s+tracking)\b/gi, 'smooth stabilized Steadicam tracking')
    .replace(/\b(fast\s+dolly|rapid\s+zoom|sudden\s+zoom)\b/gi, 'smooth controlled dolly');

  const shieldDirective = `Smooth, controlled fluid-head camera motion maintaining rigid 3D spatial perspective throughout the ${clipSec}-second shot. Sustained, unhurried continuous action across the full ${clipSec} seconds, holding a natural composed posture through the final frame. Fixed subject count from 0s to ${clipSec}s (no new people appearing out of nowhere, vanishing, or morphing; background figures stationary in soft f/1.8 bokeh). Solid, non-deforming walls and rigid 3D architectural geometry. All tables, documents, furniture, and props remain 100% gravity-locked and stationary with zero self-moving objects. Cinematic historical drama reenactment featuring anonymous fictionalized theatre actors in period costume (no real public figures or prominent people, no unintended explosions or flashes).`;

  if (/\b(?:Ambient\s+Foley|Audio)\s*:/i.test(p)) {
    p = p.replace(/\b((?:Ambient\s+Foley|Audio)\s*:)/i, `${shieldDirective} $1`);
  } else {
    p = `${p.replace(/\.?\s*$/, '')}. ${shieldDirective}`;
  }

  return `${prefix}${p}`.replace(/\s{2,}/g, ' ').trim();
}

export function buildRawClipsTextWithHeader(
  clips: DocumentaryClip[],
  operationalHeader: string = DEFAULT_OPERATIONAL_HEADER
): string {
  const header = (operationalHeader || DEFAULT_OPERATIONAL_HEADER).trim();
  const body = (clips || [])
    .map((c) => [c.imagePrompt?.trim(), c.videoPrompt?.trim()].filter(Boolean).join('\n\n'))
    .filter(Boolean)
    .join('\n\n');
  return body ? `${header}\n\n${body}` : header;
}

// ============================================================================
// 0. HELPER DE DURACIONES SELECCIONADAS EN ETAPA 1 (Clip 1 y Clips 2+)
// ============================================================================
export function getStage1ClipDurations(doc?: any): {
  clip1Sec: number;
  standardClipSec: number;
} {
  const rawClip1 =
    Number(doc?.clip1DurationSeconds) ||
    parseInt(String(doc?.promptConfig?.DURACION_CLIP_1 || ''), 10);
  const clip1Sec =
    Number.isFinite(rawClip1) && rawClip1 > 0
      ? rawClip1
      : doc?.clip1SyncMode === 'RALENTIZAR_CAPCUT' ||
        doc?.promptConfig?.SINCRONIZACION_CLIP_1 === 'RALENTIZAR_CAPCUT'
      ? 4
      : 6;

  const rawCustomClipsSec = parseInt(
    String(doc?.promptConfig?.DURACION_CLIPS_SEGUNDOS || ''),
    10
  );
  let standardClipSec = 10;
  if (Number.isFinite(rawCustomClipsSec) && rawCustomClipsSec > 0) {
    standardClipSec = rawCustomClipsSec;
  } else if (
    doc?.clipDurationMode === '8_SEGUNDOS' ||
    doc?.promptConfig?.DURACION_CLIPS === '8_SEGUNDOS'
  ) {
    standardClipSec = 8;
  } else if (
    doc?.clipDurationMode === '10_SEGUNDOS' ||
    doc?.promptConfig?.DURACION_CLIPS === '10_SEGUNDOS'
  ) {
    standardClipSec = 10;
  }
  return { clip1Sec, standardClipSec };
}

// ============================================================================
// 1. AUTO-DETECTOR DE CLIPS (ETAPA 7: Image N + Clip N)
// ============================================================================
export function parseClipsFromRawText(
  rawText: string,
  existingClips: DocumentaryClip[] = [],
  clip1Duration: number = 6,
  standardClipDuration: number = 10
): DocumentaryClip[] {
  if (!rawText || !rawText.trim()) return existingClips;

  // Normalize pipe-separated blocks if AI returned multiple prompts on a single line
  const normalizedText = rawText
    .replace(/\r\n/g, '\n')
    .replace(/\s*\|\s*(?=(?:[#*\-\d.)\s]*)(?:Image|Imagen|Clip)\s*\[?\d+)/gi, '\n');
  const lines = normalizedText.split('\n');
  const clipsMap = new Map<number, DocumentaryClip>();

  // Inicializar con los existentes si los hay
  for (const c of existingClips) {
    clipsMap.set(c.clipNumber, { ...c });
  }

  let currentClipNum = 0;

  const ensureClip = (num: number): DocumentaryClip => {
    if (!clipsMap.has(num)) {
      clipsMap.set(num, {
        id: `clip-${num}-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
        clipNumber: num,
        timeRange: num === 1 ? `00:00 - 00:${String(clip1Duration).padStart(2, '0')}` : '',
        cameraSelection: '',
        visualExplanation: '',
        imagePrompt: '',
        videoPrompt: '',
        narrationSegment: '',
        imageReady: false,
        videoReady: false,
      });
    }
    return clipsMap.get(num)!;
  };

  for (let i = 0; i < lines.length; i++) {
    const rawLine = lines[i].trim();
    if (!rawLine) continue;
    // Strip markdown bold/backticks around headers for reliable matching
    const line = rawLine.replace(/^\s*[-*•]\s+/, '').replace(/\*\*/g, '').trim();

    // Detectar encabezado de Clip ej. "--- CLIP 1 ---" o "Clip 1 (00:00 - 00:06)"
    const headerMatch = line.match(
      /^(?:[#*\-\s]*)(?:CLIP|Clip)\s*\[?0*(\d+)\]?\b(?:\s*[\(\[]([0-9:]+\s*(?:-|–|—|to)\s*[0-9:]+)[\)\]])?$/i
    );
    const imageLineMatch = line.match(
      /^(?:[#*\-\d.)\s]*)(?:Image|Imagen)\s*\[?0*(\d+)\]?\s*[:\-–]\s*(.+)$/i
    );
    const clipPromptMatch = line.match(
      /^(?:[#*\-\d.)\s]*)(?:Clip)\s*\[?0*(\d+)\]?\s*(?:[\(\[]([0-9:]+\s*(?:-|–|—|to)\s*[0-9:]+)[\)\]])?\s*[:\-–]\s*(.+)$/i
    );

    if (imageLineMatch) {
      const num = parseInt(imageLineMatch[1], 10);
      const bodyRaw = imageLineMatch[2].trim();
      // Ignore template placeholder lines such as "Image [N]: Create an image of [escena..."
      if (/^\[escena/i.test(bodyRaw) || num <= 0) continue;
      currentClipNum = num;
      const clip = ensureClip(num);
      const normalizedBody = /^Create an image/i.test(bodyRaw)
        ? bodyRaw
        : `Create an image of ${bodyRaw}`;
      const targetSec = num === 1 ? clip1Duration : standardClipDuration;
      clip.imagePrompt = ensureAntiMutationPhysicsInPrompt(`Image ${num}: ${normalizedBody}`, true, targetSec);
      continue;
    }

    if (clipPromptMatch) {
      const num = parseInt(clipPromptMatch[1], 10);
      const bodyRaw = clipPromptMatch[3].trim();
      if (/^\[1 movimiento/i.test(bodyRaw) || num <= 0) continue;
      currentClipNum = num;
      const clip = ensureClip(num);
      const timeRange = clipPromptMatch[2]
        ? clipPromptMatch[2].replace(/\s*(?:-|–|—|to)\s*/, ' - ').trim()
        : clip.timeRange;
      if (timeRange) clip.timeRange = timeRange;
      const normalizedBody = /^Create a/i.test(bodyRaw)
        ? bodyRaw
        : `Create a video showing ${bodyRaw}`;
      const targetSec = num === 1 ? clip1Duration : standardClipDuration;
      clip.videoPrompt = ensureAntiMutationPhysicsInPrompt(
        `Clip ${num}${timeRange ? ` (${timeRange})` : ''}: ${normalizedBody}`,
        false,
        targetSec
      );
      continue;
    }

    if (headerMatch && !line.toLowerCase().includes('create a video')) {
      const num = parseInt(headerMatch[1], 10);
      currentClipNum = num;
      const clip = ensureClip(num);
      if (headerMatch[2]) {
        clip.timeRange = headerMatch[2].replace(/\s*(?:-|–|—|to)\s*/, ' - ').trim();
      }
      continue;
    }

    if (currentClipNum > 0) {
      const clip = ensureClip(currentClipNum);
      if (/^(?:1\.|[-*]\s*)?(?:Identificaci[oó]n|Selecci[oó]n de C[aá]mara|C[aá]mara|Plano)/i.test(line)) {
        clip.cameraSelection = line.replace(/^(?:1\.|[-*]\s*)?(?:Identificaci[oó]n[^:]*:|Selecci[oó]n de C[aá]mara[^:]*:|C[aá]mara:)/i, '').trim();
      } else if (/^(?:2\.|[-*]\s*)?(?:Explicaci[oó]n Visual|Contexto)/i.test(line)) {
        clip.visualExplanation = line.replace(/^(?:2\.|[-*]\s*)?(?:Explicaci[oó]n Visual[^:]*:|Contexto[^:]*:)/i, '').trim();
      }
    }
  }

  return Array.from(clipsMap.values()).sort((a, b) => a.clipNumber - b.clipNumber);
}

// Parsear texto con timestamps (ej. de Narration Timeline Extractor: "1 00:06 - 00:16 Texto..." o "00:00 - 00:10 Texto...")
export function parseTimelineTextToSentences(timelineText: string): Sentence[] {
  if (!timelineText || !timelineText.trim()) return [];
  const lines = timelineText.replace(/\r\n/g, '\n').split('\n');
  const results: Sentence[] = [];

  const toSeconds = (timeStr: string): number => {
    const clean = timeStr.replace(',', '.').trim();
    const parts = clean.split(':').map((p) => parseFloat(p));
    if (parts.length === 3) {
      return parts[0] * 3600 + parts[1] * 60 + parts[2];
    }
    if (parts.length === 2) {
      return parts[0] * 60 + parts[1];
    }
    return parts[0] || 0;
  };

  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (!line || line.startsWith('===') || /^CANTIDAD DE PALABRAS/i.test(line) || /^PALABRAS POR MINUTO/i.test(line)) {
      continue;
    }
    // Soportar: "1 00:06 - 00:16 Texto..." o "00:06 - 00:16 Texto..." o "[00:06 - 00:16] Texto..."
    const m = line.match(
      /^(?:\d+[\s.)\-]*)?\[?(\d{1,2}:\d{2}(?::\d{2}(?:[,.]\d{1,3})?)?)\s*(?:-|-->|–)\s*(\d{1,2}:\d{2}(?::\d{2}(?:[,.]\d{1,3})?)?)\]?\s*[:\-]?\s*(.+)$/
    );
    if (m) {
      const start = toSeconds(m[1]);
      const end = toSeconds(m[2]);
      const text = m[3].trim();
      results.push({
        index: results.length + 1,
        start,
        end,
        text,
      });
    }
  }
  return results;
}

// Reconoce todos los formatos de pausa usados en los guiones:
// [1s], [2s], [3s], [1.5s], [1], [2], [3], [1}, [2}, {2s], [pausa: 2s], [pausa 2], [silencio: 2s], <break time="2s"/>
export const UNIVERSAL_PAUSE_REGEX =
  /[\[{]\s*(?:(?:pausa|pause|silencio)\s*:?\s*)?([0-9]{1,2}(?:[.,][0-9]+)?)\s*(s|seg|segundos|ms|milisegundos)?\s*[\]}]|[\[{]\s*(?:pausa|pause|silencio)\s*[\]}]|<break\s+time=["']?([0-9]+(?:\.[0-9]+)?)(s|ms)["']?\s*\/?>/gi;

export function extractPausesInfo(rawText: string): {
  count: number;
  totalSeconds: number;
  matches: string[];
} {
  if (!rawText) return { count: 0, totalSeconds: 0, matches: [] };
  const re = new RegExp(UNIVERSAL_PAUSE_REGEX.source, 'gi');
  const matches: string[] = [];
  let totalSeconds = 0;
  let m: RegExpExecArray | null;
  while ((m = re.exec(rawText)) !== null) {
    matches.push(m[0]);
    let sec = 1.5;
    if (m[1] !== undefined) {
      const val = parseFloat(m[1].replace(',', '.'));
      const unit = (m[2] || 's').toLowerCase();
      sec = unit.startsWith('ms') || unit.startsWith('mili') ? val / 1000 : val;
    } else if (m[3] !== undefined) {
      const val = parseFloat(m[3].replace(',', '.'));
      const unit = (m[4] || 's').toLowerCase();
      sec = unit === 'ms' ? val / 1000 : val;
    }
    if (!isNaN(sec)) {
      totalSeconds += Math.max(0.1, Math.min(30, sec));
    }
  }
  return {
    count: matches.length,
    totalSeconds: Number(totalSeconds.toFixed(1)),
    matches,
  };
}

export function stripPauseTags(rawText: string): string {
  if (!rawText) return '';
  const re = new RegExp(UNIVERSAL_PAUSE_REGEX.source, 'gi');
  return rawText.replace(re, '');
}

// Sincronizar los 3 insumos de la Sección 8 (Producción):
// 1) Voz Narrativa Raw con Pausas, 2) Voz con Timestamps, 3) Prompts de Imágenes y Clips
export function syncAndAuditProductionClips(
  arg1:
    | string
    | {
        rawClipsText: string;
        timelineText: string;
        rawVoiceoverWithPauses: string;
        existingClips?: DocumentaryClip[];
        clip1Duration?: number;
        clipDuration?: number;
        clip1SyncMode?: 'RALENTIZAR_CAPCUT' | 'VOZ_EN_CLIP_2';
        topic?: string;
        historicalTime?: string;
        historicalLocation?: string;
        references?: ReferenceAsset[];
        includeNarrationInClip?: boolean;
      },
  arg2?: string,
  arg3?: string,
  arg4?: DocumentaryClip[],
  arg5?: string
): DocumentaryClip[] {
  const isObj = typeof arg1 === 'object' && arg1 !== null;
  const rawVoiceoverWithPauses = isObj ? arg1.rawVoiceoverWithPauses || '' : arg1 || '';
  const timelineText = isObj ? arg1.timelineText || '' : arg2 || '';
  const rawClipsText = isObj ? arg1.rawClipsText || '' : arg3 || '';
  const existingClips = isObj ? arg1.existingClips || [] : arg4 || [];
  const clip1Duration = isObj ? arg1.clip1Duration || 6 : 6;
  const standardClipDuration = isObj && Number(arg1.clipDuration) > 0 ? Number(arg1.clipDuration) : 10;
  const clip1SyncMode = (isObj ? arg1.clip1SyncMode : arg5) || 'VOZ_EN_CLIP_2';
  const docTopic = isObj ? (arg1.topic || '').trim() : '';
  const docTime = isObj ? (arg1.historicalTime || '').trim() : '';
  const docLocation = isObj ? (arg1.historicalLocation || '').trim() : '';
  const docRefs = isObj && Array.isArray(arg1.references) ? arg1.references : [];
  const includeNarrationInClip = isObj ? arg1.includeNarrationInClip !== false : true;

  const parsedFromPrompts = parseClipsFromRawText(
    rawClipsText,
    existingClips,
    clip1Duration,
    standardClipDuration
  );
  let timelineSentences = parseTimelineTextToSentences(timelineText);

  // Fallback: if timelineSentences is empty but rawVoiceoverWithPauses has text, split into Stage 1 standardClipDuration blocks
  if (timelineSentences.length === 0 && rawVoiceoverWithPauses.trim()) {
    const cleanScript = stripPauseTags(rawVoiceoverWithPauses).replace(/\s+/g, ' ').trim();
    const words = cleanScript.split(/\s+/).filter(Boolean);
    const wordsPerBlock = Math.max(8, Math.round(standardClipDuration * 2.4));
    let cursorSec = 0;
    for (let i = 0; i < words.length; i += wordsPerBlock) {
      const chunk = words.slice(i, i + wordsPerBlock).join(' ');
      if (chunk) {
        timelineSentences.push({
          index: timelineSentences.length + 1,
          start: cursorSec,
          end: cursorSec + standardClipDuration,
          text: chunk,
        });
        cursorSec += standardClipDuration;
      }
    }
  }

  const clipStartOffset = clip1SyncMode === 'RALENTIZAR_CAPCUT' ? clip1Duration + 2 : clip1Duration;
  const voiceEntrySec = clip1Duration + 2;
  const needsOffset = timelineSentences.length > 0 && timelineSentences[0].start < 2.0;

  const eraSetting =
    [docLocation, docTime].filter(Boolean).join(', ') ||
    docTopic ||
    'historical documentary setting';
  const personRefs = docRefs.filter((r) => r.category === 'persona' || (r.tag || '').startsWith('@'));
  const placeRefs = docRefs.filter((r) => r.category === 'lugar' && !(r.tag || '').startsWith('@'));
  const primaryPersonTag = personRefs[0]?.tag
    ? personRefs[0].tag.startsWith('@')
      ? personRefs[0].tag
      : `@${personRefs[0].tag}`
    : '';
  const primaryPlaceTag = placeRefs[0]?.tag || docLocation || '';

  const findMatchingRefTags = (narration: string): string => {
    const lowerNarr = (narration || '').toLowerCase();
    const matched: string[] = [];
    for (const r of docRefs) {
      const rawTag = (r.tag || '').trim();
      if (!rawTag) continue;
      const cleanName = rawTag.replace(/^@+/, '').replace(/_/g, ' ').toLowerCase();
      const tokens = cleanName.split(/\s+/).filter((t) => t.length >= 4);
      if (
        (cleanName && lowerNarr.includes(cleanName)) ||
        tokens.some((tok) => lowerNarr.includes(tok))
      ) {
        const formattedTag =
          r.category === 'persona' || rawTag.startsWith('@')
            ? rawTag.startsWith('@')
              ? rawTag
              : `@${rawTag}`
            : rawTag;
        if (!matched.includes(formattedTag)) matched.push(formattedTag);
      }
    }
    if (matched.length === 0 && primaryPersonTag) {
      matched.push(primaryPersonTag);
    }
    if (matched.length < 2 && primaryPlaceTag && !matched.includes(primaryPlaceTag)) {
      matched.push(primaryPlaceTag);
    }
    return matched.join(' in ');
  };

  const SHOT_ANGLES = [
    'cinematic medium shot',
    'dramatic low-angle shot',
    'atmospheric wide establishing shot',
    'intimate over-the-shoulder shot',
    'detailed close-up tracking shot',
  ];
  const CAMERA_MOVES = [
    'a slow dolly-in camera movement',
    'a smooth lateral tracking camera movement',
    'a subtle crane-up camera movement',
    'a steady slow push-in camera movement',
    'a gentle panning camera movement',
  ];

  // Extraer fragmentos con sus pausas desde la Voz Narrativa Raw
  const pauseRegex = new RegExp(UNIVERSAL_PAUSE_REGEX.source, 'gi');

  const maxClipNum = Math.max(
    parsedFromPrompts.length > 0 ? Math.max(...parsedFromPrompts.map((c) => c.clipNumber)) : 0,
    timelineSentences.length > 0 ? timelineSentences.length + 1 : 0,
    existingClips.length
  );

  if (maxClipNum === 0) return [];

  const byNum = new Map<number, DocumentaryClip>();
  parsedFromPrompts.forEach((c) => byNum.set(c.clipNumber, { ...c }));

  const finalClips: DocumentaryClip[] = [];

  for (let num = 1; num <= maxClipNum; num++) {
    const existing = byNum.get(num);
    if (num === 1) {
      const c1EndSec = clip1SyncMode === 'RALENTIZAR_CAPCUT' ? clip1Duration + 2 : clip1Duration;
      const c1Range = existing?.timeRange || `00:00 - 00:${String(c1EndSec).padStart(2, '0')}`;
      const hookRefs = [primaryPersonTag, primaryPlaceTag].filter(Boolean).join(' at ');
      const imgP = ensureAntiMutationPhysicsInPrompt(
        existing?.imagePrompt?.trim() ||
          `Image 1: Create an image of a dramatic cinematic wide establishing shot of ${
            hookRefs ? `${hookRefs} in ` : ''
          }${eraSetting}, volumetric chiaroscuro lighting, hyper-realistic historical accuracy, 8k documentary cinematography, no text.`,
        true,
        clip1Duration
      );
      const vidP = ensureAntiMutationPhysicsInPrompt(
        existing?.videoPrompt?.trim() ||
          `Clip 1 (${c1Range}): Create a video showing a slow, tense cinematic camera push-in across ${
            primaryPlaceTag || eraSetting
          }${
            primaryPersonTag ? ` while ${primaryPersonTag} stands in solemn dramatic stillness` : ''
          }, subtle drifting atmospheric mist and flickering warm torchlight. Ambient Foley: deep atmospheric wind, distant historical environment sounds, footsteps on stone, single continuous shot, strictly no shot changes, no music, no speech, no text. fix the name`,
        false,
        clip1Duration
      );
      let auditStatus: 'ok' | 'warning' | 'mismatch' = 'ok';
      let auditReason =
        clip1SyncMode === 'VOZ_EN_CLIP_2'
          ? `Clip 1 (00:00 - 00:${String(clip1Duration).padStart(2, '0')} sin voz en off; la voz narrativa entra en el segundo ${voiceEntrySec}, a los 2s de iniciar el Clip 2).`
          : `Clip 1 (Hook inicial de ${clip1Duration}s ralentizado a ${voiceEntrySec}s sin voz en off; la voz entra en el segundo ${voiceEntrySec} al iniciar el Clip 2).`;
      if (/speech|narrat|voiceover/i.test(vidP) && !/no speech/i.test(vidP)) {
        auditStatus = 'mismatch';
        auditReason = 'El Clip 1 no debe llevar voz hablada; debe cerrar con "no music, no speech".';
      }

      finalClips.push({
        ...existing,
        id: existing?.id || `clip-1-${Date.now()}`,
        clipNumber: 1,
        timeRange: c1Range,
        cameraSelection: existing?.cameraSelection || 'Hook Cinematográfico Inicial',
        visualExplanation:
          existing?.visualExplanation ||
          'Primeros segundos sin voz narrativa (impacto visual + Foley ambiental).',
        imagePrompt: imgP,
        videoPrompt: vidP,
        narrationSegment:
          clip1SyncMode === 'VOZ_EN_CLIP_2'
            ? `(00:00 - 00:${String(clip1Duration).padStart(2, '0')} Sin Voz Narrativa — La voz entra en el seg ${voiceEntrySec}, a los 2s del Clip 2)`
            : `(00:00 - 00:${String(voiceEntrySec).padStart(2, '0')} Sin Voz Narrativa — Solo Audio Foley y Letrero Inicial)`,
        pauseNotes: `Sin locución en los primeros ${voiceEntrySec} segundos del video`,
        imageReady: existing?.imageReady || false,
        videoReady: existing?.videoReady || false,
        reviewedForEditor: Boolean(existing?.reviewedForEditor),
        recreated: Boolean(existing?.recreated),
        videoFrames: existing?.videoFrames,
        videoAuditStatus: existing?.videoAuditStatus,
        videoAuditScore: existing?.videoAuditScore,
        videoAuditReason: existing?.videoAuditReason,
        videoAuditIssues: existing?.videoAuditIssues,
        videoAttempts: existing?.videoAttempts,
        videoSavedFileName: existing?.videoSavedFileName,
        auditStatus,
        auditReason,
        suggestedImagePrompt: existing?.suggestedImagePrompt,
        suggestedVideoPrompt: existing?.suggestedVideoPrompt,
      });
      continue;
    }

    const tIdx = num - 2;
    const tSeg = timelineSentences[tIdx];
    let computedRange = existing?.timeRange || '';
    if (tSeg) {
      const sSec = needsOffset ? tSeg.start + clipStartOffset : tSeg.start;
      const eSec = needsOffset ? tSeg.end + clipStartOffset : tSeg.end;
      computedRange = `${formatMMSS(sSec)} - ${formatMMSS(eSec)}`;
    } else if (!computedRange) {
      const fallbackStart = clipStartOffset + tIdx * standardClipDuration;
      computedRange = `${formatMMSS(fallbackStart)} - ${formatMMSS(fallbackStart + standardClipDuration)}`;
    }

    const narrationText = tSeg?.text || existing?.narrationSegment || '';
    const cleanNarration = stripPauseTags(narrationText).replace(/\s+/g, ' ').trim();
    const matchedRefs = findMatchingRefTags(cleanNarration);
    const shotAngle = SHOT_ANGLES[tIdx % SHOT_ANGLES.length];
    const camMove = CAMERA_MOVES[tIdx % CAMERA_MOVES.length];

    const imgP = ensureAntiMutationPhysicsInPrompt(
      existing?.imagePrompt?.trim() ||
        `Image ${num}: Create an image of a ${shotAngle} in ${eraSetting}${
          matchedRefs ? ` featuring ${matchedRefs}` : ''
        }, depicting the historical scene (${cleanNarration.slice(0, 130)}), dramatic cinematic lighting, historical accuracy, photorealistic 8k film still, no text.`,
      true,
      standardClipDuration
    );

    const vidP = ensureAntiMutationPhysicsInPrompt(
      existing?.videoPrompt?.trim() ||
        `Clip ${num} (${computedRange}): Create a video showing ${camMove} over the historical scene in ${eraSetting}${
          matchedRefs ? ` with ${matchedRefs} performing subtle period-accurate physical movement` : ''
        }. Ambient Foley: realistic historical environment sounds, subtle cloth movement, and footsteps, single continuous shot, strictly no shot changes, no music, no speech, no text. ${
          includeNarrationInClip && cleanNarration ? `${cleanNarration} ` : ''
        }fix the name`,
      false,
      standardClipDuration
    );

    // Buscar si esa frase en la Voz Narrativa Raw contiene una etiqueta [pausa: Xs]
    let pauseNotes = existing?.pauseNotes || '';
    if (rawVoiceoverWithPauses && narrationText) {
      const words = narrationText
        .replace(/[^a-zA-ZáéíóúÁÉÍÓÚñÑ0-9\s]/g, '')
        .trim()
        .split(/\s+/)
        .filter(Boolean);
      if (words.length >= 3) {
        const firstAnchor = words.slice(0, 2).join('\\s+[^\\n]{0,40}?');
        const lastAnchor = words.slice(-2).join('\\s+');
        try {
          const spanRegex = new RegExp(`(${firstAnchor}[\\s\\S]{0,260}?${lastAnchor})`, 'i');
          const matchSpan = rawVoiceoverWithPauses.match(spanRegex);
          if (matchSpan) {
            const pausesFound = matchSpan[1].match(pauseRegex);
            if (pausesFound && pausesFound.length > 0) {
              pauseNotes = `Contiene ${pausesFound.join(', ')} en la locución`;
            }
          }
        } catch {}
      }
    }

    // Auditoría rápida local de sentido y reglas
    let auditStatus: 'ok' | 'warning' | 'mismatch' = existing?.auditStatus || 'ok';
    let auditReason = existing?.auditReason || '';

    if (!imgP && !vidP) {
      auditStatus = 'warning';
      auditReason = 'Pendiente de prompt de Imagen Inicial y Video para este tramo de voz.';
    } else if (!auditReason) {
      const issues: string[] = [];
      if (pauseNotes && !/two-shot|5 seconds each|Shot 1|Shot 2/i.test(vidP)) {
        issues.push(
          `Hay una pausa narrativa (${pauseNotes}) dentro de este clip: verifica si la voz cambia de escena a mitad del clip para usar 2 shots de 5s.`
        );
      }
      if (vidP && !/fix the name/i.test(vidP)) {
        issues.push('Falta "fix the name" al final del prompt de video.');
      }
      if (imgP && !/no text/i.test(imgP)) {
        issues.push('El prompt de imagen inicial debe incluir "no text".');
      }
      if (issues.length > 0) {
        auditStatus = 'warning';
        auditReason = issues.join(' ');
      } else {
        auditStatus = 'ok';
        auditReason = 'Sincronizado con el tramo de voz narrativa.';
      }
    }

    finalClips.push({
      ...existing,
      id: existing?.id || `clip-${num}-${Date.now()}-${num}`,
      clipNumber: num,
      timeRange: computedRange,
      cameraSelection: existing?.cameraSelection || '',
      visualExplanation: existing?.visualExplanation || '',
      imagePrompt: imgP,
      videoPrompt: vidP,
      narrationSegment: narrationText,
      pauseNotes,
      imageReady: existing?.imageReady || false,
      videoReady: existing?.videoReady || false,
      reviewedForEditor: Boolean(existing?.reviewedForEditor),
      recreated: Boolean(existing?.recreated),
      videoFrames: existing?.videoFrames,
      videoAuditStatus: existing?.videoAuditStatus,
      videoAuditScore: existing?.videoAuditScore,
      videoAuditReason: existing?.videoAuditReason,
      videoAuditIssues: existing?.videoAuditIssues,
      videoAttempts: existing?.videoAttempts,
      videoSavedFileName: existing?.videoSavedFileName,
      auditStatus,
      auditReason,
      suggestedImagePrompt: existing?.suggestedImagePrompt,
      suggestedVideoPrompt: existing?.suggestedVideoPrompt,
    });
  }

  return finalClips;
}

// Crear estructura de Clips base a partir del Timeline extraído en Etapa 4
export function buildClipsSkeletonFromTimeline(
  sentences: Sentence[],
  clip1Duration: number = 4,
  clip1SyncMode: 'RALENTIZAR_CAPCUT' | 'VOZ_EN_CLIP_2' = 'RALENTIZAR_CAPCUT'
): DocumentaryClip[] {
  const clips: DocumentaryClip[] = [];
  const clipStartOffset = clip1SyncMode === 'RALENTIZAR_CAPCUT' ? clip1Duration + 2 : clip1Duration;
  const voiceEntrySec = clip1Duration + 2;

  // Clip 1 (Hook inicial sin voz narrativa)
  clips.push({
    id: `clip-1-${Date.now()}`,
    clipNumber: 1,
    timeRange: `00:00 - 00:${String(clipStartOffset).padStart(2, '0')}`,
    cameraSelection: 'Hook Cinematográfico Inicial',
    visualExplanation: 'Primeros segundos de impacto visual con Foley ambiental (sin voz narrativa).',
    imagePrompt: '',
    videoPrompt: '',
    narrationSegment:
      clip1SyncMode === 'VOZ_EN_CLIP_2'
        ? `(Sin voz en off — Hook de ${clip1Duration}s; la voz entra en el seg ${voiceEntrySec}, segundo 2 del Clip 2)`
        : `(Sin voz en off — Hook de ${clip1Duration}s ralentizado a ${voiceEntrySec}s)`,
    imageReady: false,
    videoReady: false,
  });

  sentences.forEach((s, idx) => {
    const clipNum = idx + 2;
    // Si el audio ya tenía el silencio al inicio, mantenemos su tiempo; si empieza en <2s, sumamos clipStartOffset
    const needsOffset = sentences[0] && sentences[0].start < 2.0;
    const startSec = needsOffset ? s.start + clipStartOffset : s.start;
    const endSec = needsOffset ? s.end + clipStartOffset : s.end;
    const rangeStr = `${formatMMSS(startSec)} - ${formatMMSS(endSec)}`;

    clips.push({
      id: `clip-${clipNum}-${Date.now()}-${idx}`,
      clipNumber: clipNum,
      timeRange: rangeStr,
      cameraSelection: '',
      visualExplanation: '',
      imagePrompt: '',
      videoPrompt: '',
      narrationSegment: s.text,
      imageReady: false,
      videoReady: false,
    });
  });

  return clips;
}

// ============================================================================
// 2. AUTO-DETECTOR DE REFERENCIAS (@Personas y Lugares - ETAPA 5)
// ============================================================================
export function parseReferencesFromRawText(rawText: string): ReferenceAsset[] {
  if (!rawText || !rawText.trim()) return [];
  const lines = rawText.replace(/\r\n/g, '\n').split('\n');
  const results: ReferenceAsset[] = [];

  let currentTag = '';
  let currentCategory: 'persona' | 'lugar' = 'persona';

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line) continue;
    if (/^Cambia los nombres y ponles @/i.test(line)) continue;

    // Si la línea tiene "Create an image" o "Frame Description:"
    const createImgIdx = line.search(/Create an image|Frame Description\s*:/i);
    if (createImgIdx !== -1) {
      const before = line.slice(0, createImgIdx).replace(/[:\-–*#\d.)]/g, '').trim();
      const promptPart = line.slice(createImgIdx).trim();
      const atMatch = line.match(/@([A-Za-z0-9_ÁÉÍÓÚáéíóúÑñ]+)/);
      const tag = atMatch
        ? `@${atMatch[1]}`
        : before || currentTag || `Referencia_${results.length + 1}`;
      const isPerson =
        tag.startsWith('@') ||
        /character sheet|portrait|person|character|man|woman|emperor|king|queen/i.test(promptPart);

      let shieldedPromptPart = applyAutomaticFlowPolicyShield(promptPart, true);
      if (isPerson && !/no real public figures/i.test(shieldedPromptPart)) {
        shieldedPromptPart = `${shieldedPromptPart.replace(/\.?\s*$/, '')}. Portrayed by an anonymous historical reenactment actor in authentic period wardrobe (no real public figures or prominent people).`;
      }

      results.push({
        id: `ref-${Date.now()}-${results.length + 1}`,
        tag,
        category: isPerson ? 'persona' : 'lugar',
        description: before || tag,
        prompt: shieldedPromptPart,
        isCreated: false,
      });
      currentTag = '';
    } else if (line.startsWith('@') || /^[-*#\d.)]*\s*@[A-Za-z0-9_]+/.test(line)) {
      const m = line.match(/@([A-Za-z0-9_ÁÉÍÓÚáéíóúÑñ]+)/);
      if (m) {
        currentTag = `@${m[1]}`;
        currentCategory = 'persona';
      }
    } else if (line.length < 90 && !line.endsWith('.')) {
      currentTag = line.replace(/^[-*#\d.)\s]+|[:]+$/g, '').trim();
      currentCategory = currentTag.startsWith('@') ? 'persona' : 'lugar';
    }
  }

  return results;
}

// ============================================================================
// 3. AUTO-DETECTOR DE PISTAS DE SUNO (ETAPA 9)
// ============================================================================
export function parseSunoTracksFromRawText(rawText: string): SunoTrack[] {
  if (!rawText || !rawText.trim()) return [];
  const tracks: SunoTrack[] = [];

  // Separar si hay múltiples pistas o bloques "1. Título:"
  const blocks = rawText.split(/(?=(?:^|\n)\s*(?:[#*\-\s]*)(?:Pista\s+\d+|Canción\s+\d+|1\.\s*T[ií]tulo\s*:))/i).filter((b) => b.trim());

  blocks.forEach((block, idx) => {
    const titleMatch = block.match(/(?:1\.\s*)?T[ií]tulo\s*:\s*([^\n]+)/i);
    const durationMatch = block.match(/(?:2\.\s*)?Duraci[oó]n\s*:\s*([^\n]+)/i);
    const rangeMatch = block.match(/(?:3\.\s*)?De d[oó]nde a d[oó]nde cubre[^:]*:\s*([^\n]+)/i);
    const lyricsMatch = block.match(/(?:4\.\s*)?Prompt de Lyrics\s*:\s*([\s\S]*?)(?=(?:\n\s*(?:5\.|Prompt de Style))|$)/i);
    const styleMatch = block.match(/(?:5\.\s*)?Prompt de Style\s*:\s*([\s\S]*?)(?=(?:\n\s*(?:6\.|Explicaci[oó]n de la Canci[oó]n))|$)/i);
    const expMatch = block.match(/(?:6\.\s*)?Explicaci[oó]n de la Canci[oó]n\s*:\s*([\s\S]*?)$/i);

    if (titleMatch || styleMatch || lyricsMatch) {
      tracks.push({
        id: `suno-${Date.now()}-${idx + 1}`,
        trackNumber: idx + 1,
        title: titleMatch ? titleMatch[1].trim() : `Pista ${idx + 1}`,
        duration: durationMatch ? durationMatch[1].trim() : '3:00 min',
        videoTimeRange: rangeMatch ? rangeMatch[1].trim() : '00:00 - Final',
        lyricsPrompt: lyricsMatch ? lyricsMatch[1].trim() : '[Instrumental]\n[Dark Contemplative Intro]\n[Fading Outro]',
        stylePrompt: styleMatch ? styleMatch[1].trim() : '',
        explanation: expMatch ? expMatch[1].trim() : '',
        isGenerated: false,
      });
    }
  });

  return tracks;
}

// ============================================================================
// 4. CORRECTOR FONÉTICO Y MATEMÁTICO DE .SRT DE CAPCUT (ETAPA 8)
// ============================================================================
const SPANISH_HUNDREDS_VAL: Record<string, number> = {
  cien: 100, ciento: 100,
  doscientos: 200, doscientas: 200,
  trescientos: 300, trescientas: 300,
  cuatrocientos: 400, cuatrocientas: 400,
  quinientos: 500, quinientas: 500,
  seiscientos: 600, seiscientas: 600,
  setecientos: 700, setecientas: 700,
  ochocientos: 800, ochocientas: 800,
  novecientos: 900, novecientas: 900,
};

const SPANISH_TENS_VAL: Record<string, number> = {
  treinta: 30, cuarenta: 40, cincuenta: 50,
  sesenta: 60, setenta: 70, ochenta: 80, noventa: 90,
};

const SPANISH_UNDER_30_VAL: Record<string, number> = {
  un: 1, uno: 1, una: 1,
  dos: 2, tres: 3, cuatro: 4, cinco: 5, seis: 6, siete: 7, ocho: 8, nueve: 9,
  diez: 10, once: 11, doce: 12, trece: 13, catorce: 14, quince: 15,
  dieciseis: 16, dieciséis: 16, diecisiete: 17, dieciocho: 18, diecinueve: 19,
  veinte: 20, veintiun: 21, veintiún: 21, veintiuno: 21, veintiuna: 21,
  veintidos: 22, veintidós: 22, veintitres: 23, veintitrés: 23, veinticuatro: 24,
  veinticinco: 25, veintiseis: 26, veintiséis: 26, veintisiete: 27, veintiocho: 28, veintinueve: 29,
};

const ROMAN_EQUIVALENTS: Record<string, string[]> = {
  I: ['1', 'uno', 'primero', 'primera', 'primer'],
  II: ['2', 'dos', 'segundo', 'segunda'],
  III: ['3', 'tres', 'tercero', 'tercera', 'tercer'],
  IV: ['4', 'cuatro', 'cuarto', 'cuarta'],
  V: ['5', 'cinco', 'quinto', 'quinta'],
  VI: ['6', 'seis', 'sexto', 'sexta'],
  VII: ['7', 'siete', 'septimo', 'septima'],
  VIII: ['8', 'ocho', 'octavo', 'octava'],
  IX: ['9', 'nueve', 'noveno', 'novena'],
  X: ['10', 'diez', 'decimo', 'decima'],
  XI: ['11', 'once'],
  XII: ['12', 'doce'],
  XIII: ['13', 'trece'],
  XIV: ['14', 'catorce'],
  XV: ['15', 'quince'],
  XVI: ['16', 'dieciseis'],
  XVII: ['17', 'diecisiete'],
  XVIII: ['18', 'dieciocho'],
  XIX: ['19', 'diecinueve'],
  XX: ['20', 'veinte'],
  XXI: ['21', 'veintiuno', 'veintiun'],
};

function parseSpanishPhraseUnder1000(phrase: string): number | null {
  if (!phrase) return null;
  const words = phrase.toLowerCase().trim().split(/\s+/).filter((w) => w && w !== 'y');
  if (words.length === 0) return null;
  let total = 0;
  for (const w of words) {
    if (SPANISH_HUNDREDS_VAL[w] !== undefined) total += SPANISH_HUNDREDS_VAL[w];
    else if (SPANISH_TENS_VAL[w] !== undefined) total += SPANISH_TENS_VAL[w];
    else if (SPANISH_UNDER_30_VAL[w] !== undefined) total += SPANISH_UNDER_30_VAL[w];
    else return null;
  }
  return total > 0 ? total : null;
}

export function normalizeQuantitiesToMil(text: string): string {
  if (!text) return '';
  let result = text;
  const numWordRegex = /\b((?:(?:cien|ciento|doscient[oa]s|trescient[oa]s|cuatrocient[oa]s|quinient[oa]s|seiscient[oa]s|setecient[oa]s|ochocient[oa]s|novecient[oa]s)\s+)?(?:(?:treinta|cuarenta|cincuenta|sesenta|setenta|ochenta|noventa)(?:\s+y\s+(?:un|uno|una|dos|tres|cuatro|cinco|seis|siete|ocho|nueve))?|un|uno|una|dos|tres|cuatro|cinco|seis|siete|ocho|nueve|diez|once|doce|trece|catorce|quince|diecis[eé]is|diecisiete|dieciocho|diecinueve|veinte|veinti[uú]n[oa]?|veintid[oó]s|veintitr[eé]s|veinticuatro|veinticinco|veintis[eé]is|veintisiete|veintiocho|veintinueve)|(?:cien|ciento|doscient[oa]s|trescient[oa]s|cuatrocient[oa]s|quinient[oa]s|seiscient[oa]s|setecient[oa]s|ochocient[oa]s|novecient[oa]s))\s+(mil|mill[oó]n|millones)\b/gi;

  result = result.replace(numWordRegex, (fullMatch, numPhrase, scaleWord) => {
    const val = parseSpanishPhraseUnder1000(numPhrase);
    if (!val) return fullMatch;
    const lowerScale = scaleWord.toLowerCase();
    if (lowerScale === 'mil' && val === 1 && numPhrase.trim().toLowerCase() === 'un') {
      return fullMatch;
    }
    return `${val} ${lowerScale}`;
  });

  result = result.replace(/(?<![:\d])\b([1-9]\d{0,2})[.,]000\b(?!\s*(?:mil|-->))/gi, '$1 mil');
  result = result.replace(/(?<![:\d])\b([1-9]\d{1,2})000\b(?!\s*mil\b)/gi, '$1 mil');
  return result;
}

function normalizeToken(str: string): string {
  if (!str) return '';
  return str
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]/g, '');
}

function phoneticSpanish(str: string): string {
  let s = normalizeToken(str);
  if (!s) return '';
  s = s
    .replace(/ch/g, 'x')
    .replace(/h/g, '')
    .replace(/v/g, 'b')
    .replace(/z/g, 's')
    .replace(/ce/g, 'se')
    .replace(/ci/g, 'si')
    .replace(/ll/g, 'y')
    .replace(/qu/g, 'k')
    .replace(/ca/g, 'ka')
    .replace(/co/g, 'ko')
    .replace(/cu/g, 'ku')
    .replace(/ge/g, 'je')
    .replace(/gi/g, 'ji')
    .replace(/gu/g, 'g')
    .replace(/w/g, 'g')
    .replace(/ph/g, 'f')
    .replace(/sh/g, 'x')
    .replace(/th/g, 't')
    .replace(/([a-z])\1+/g, '$1');
  return s;
}

function numberToSpanishText(n: string | number): string {
  const num = parseInt(String(n).replace(/[.,]/g, ''), 10);
  if (isNaN(num) || num < 0 || num > 999999999) return '';
  const units = ['cero','uno','dos','tres','cuatro','cinco','seis','siete','ocho','nueve','diez','once','doce','trece','catorce','quince','dieciseis','diecisiete','dieciocho','diecinueve','veinte','veintiuno','veintidos','veintitres','veinticuatro','veinticinco','veintiseis','veintisiete','veintiocho','veintinueve'];
  const tens = ['','','veinte','treinta','cuarenta','cincuenta','sesenta','setenta','ochenta','noventa'];
  const hundreds = ['','ciento','doscientos','trescientos','cuatrocientos','quinientos','seiscientos','setecientos','ochocientos','novecientos'];
  const convertUnder100 = (x: number): string => {
    if (x < 30) return units[x];
    const t = Math.floor(x / 10);
    const u = x % 10;
    return u === 0 ? tens[t] : `${tens[t]} y ${units[u]}`;
  };
  const convertUnder1000 = (x: number): string => {
    if (x === 0) return '';
    if (x === 100) return 'cien';
    if (x < 100) return convertUnder100(x);
    const h = Math.floor(x / 100);
    const rem = x % 100;
    return rem === 0 ? hundreds[h] : `${hundreds[h]} ${convertUnder100(rem)}`;
  };
  const convertUnderMillion = (x: number): string => {
    if (x < 1000) return convertUnder1000(x);
    const th = Math.floor(x / 1000);
    const rem = x % 1000;
    const thText = th === 1 ? 'mil' : `${convertUnder1000(th)} mil`;
    return rem === 0 ? thText : `${thText} ${convertUnder1000(rem)}`;
  };
  if (num < 1000000) return convertUnderMillion(num);
  const mil = Math.floor(num / 1000000);
  const rem = num % 1000000;
  const milText = mil === 1 ? 'un millon' : `${convertUnder1000(mil)} millones`;
  return rem === 0 ? milText : `${milText} ${convertUnderMillion(rem)}`;
}

function tokenToPhonetic(str: string): string {
  if (!str) return '';
  const cleanUpper = str.replace(/[^A-Za-z0-9]/g, '').toUpperCase();
  const lettersOnly = str.replace(/[^A-Za-z]/g, '');
  if (ROMAN_EQUIVALENTS[cleanUpper] && lettersOnly === cleanUpper) {
    const spokenForm = ROMAN_EQUIVALENTS[cleanUpper][2] || ROMAN_EQUIVALENTS[cleanUpper][1] || cleanUpper;
    return phoneticSpanish(spokenForm);
  }
  if (/^\d{1,9}$/.test(cleanUpper)) {
    const sp = numberToSpanishText(cleanUpper);
    if (sp) return phoneticSpanish(sp);
  }
  return phoneticSpanish(str);
}

function editDistance(a: string, b: string): number {
  if (a === b) return 0;
  const la = a.length;
  const lb = b.length;
  if (la === 0) return lb;
  if (lb === 0) return la;
  let prev = new Array(lb + 1);
  let curr = new Array(lb + 1);
  for (let j = 0; j <= lb; j++) prev[j] = j;
  for (let i = 1; i <= la; i++) {
    curr[0] = i;
    const ca = a.charCodeAt(i - 1);
    for (let j = 1; j <= lb; j++) {
      const cost = ca === b.charCodeAt(j - 1) ? 0 : 1;
      curr[j] = Math.min(prev[j] + 1, curr[j - 1] + 1, prev[j - 1] + cost);
    }
    const tmp = prev;
    prev = curr;
    curr = tmp;
  }
  return prev[lb];
}

function singleWordSim(capW: string, origW: string): number {
  const cP = tokenToPhonetic(capW);
  const oP = tokenToPhonetic(origW);
  if (!cP || !oP) return 0;
  if (cP === oP) return 1.0;
  const cleanUpper = (origW || '').replace(/[^A-Za-z0-9]/g, '').toUpperCase();
  const lettersOnly = (origW || '').replace(/[^A-Za-z]/g, '');
  let best = 1 - editDistance(cP, oP) / Math.max(cP.length, oP.length, 1);
  if (ROMAN_EQUIVALENTS[cleanUpper] && lettersOnly === cleanUpper) {
    for (const eq of ROMAN_EQUIVALENTS[cleanUpper]) {
      const eqP = phoneticSpanish(eq);
      if (eqP) {
        const s = 1 - editDistance(cP, eqP) / Math.max(cP.length, eqP.length, 1);
        if (s > best) best = s;
      }
    }
  }
  return Math.max(0, best);
}

const WEAK_END_WORDS = new Set([
  'el','la','los','las','un','una','unos','unas','al','del','de','en','a','con',
  'por','para','sin','sobre','entre','hacia','hasta','desde','tras','ante','bajo',
  'según','segun','contra','mi','mis','tu','tus','su','sus','nuestro','nuestra',
  'nuestros','nuestras','se','le','les','lo','me','te','nos','no','mas','más',
  'muy','tan','ya','y','e','o','u','ni','que','quien','cuyo','cuya','cuyos','cuyas',
  'san','santa','santo','don','doña','dona','siglo','año','ano','rey','reina','princesa',
  'príncipe','principe','duque','conde','papa','obispo','tratado','castillo',
]);

const CLAUSE_STARTERS = new Set([
  'y','e','o','u','ni','pero','sino','aunque','donde','cuando','como','mientras',
  'hasta','desde','para','por','según','segun','hacia','contra','sobre','entre',
  'sin','tras','ante','bajo','que','quien','cuyo','cuya',
]);

function cleanWordLower(w: string): string {
  return (w || '').toLowerCase().replace(/^[^a-záéíóúüñ0-9]+|[^a-záéíóúüñ0-9]+$/gi, '');
}

export function splitWordsIntoShortLines(words: string[], maxChars: number = 32): string[][] {
  if (!words || words.length === 0) return [];
  if (maxChars <= 0) return [words];
  const fullText = words.join(' ');
  const hasSentenceBreakInside = words.slice(0, -1).some((w) => /[.?!:;]$/.test(w));
  if (fullText.length <= maxChars && !hasSentenceBreakInside) {
    return [words];
  }

  const m = words.length;
  const minChunks = Math.max(
    hasSentenceBreakInside ? 2 : 1,
    Math.ceil(fullText.length / maxChars)
  );
  const targetLen = fullText.length / minChunks;

  const dp = new Array(m + 1).fill(Infinity);
  const parent = new Array(m + 1).fill(-1);
  dp[0] = 0;

  for (let i = 0; i < m; i++) {
    if (dp[i] === Infinity) continue;
    let lineLen = 0;
    for (let j = i + 1; j <= m; j++) {
      const w = words[j - 1];
      lineLen += j === i + 1 ? w.length : 1 + w.length;

      if (j > i + 1 && lineLen > maxChars + 5) break;

      let cost = Math.pow(lineLen - targetLen, 2) * 0.25 + 8;
      if (lineLen > maxChars) {
        cost += Math.pow(lineLen - maxChars, 2) * 3.0;
      }
      if (lineLen < 9 && j < m) {
        cost += (9 - lineLen) * 2.5;
      }

      if (j < m) {
        const lastW = words[j - 1];
        const nextW = words[j];
        const cleanLast = cleanWordLower(lastW);
        const cleanNext = cleanWordLower(nextW);

        if (/[.?!:;…]$/.test(lastW)) {
          cost -= 22;
        } else if (/[,]$/.test(lastW)) {
          cost -= 12;
        } else {
          if (CLAUSE_STARTERS.has(cleanNext)) {
            cost -= 6;
          }
          if (WEAK_END_WORDS.has(cleanLast)) {
            cost += 28;
          }
          if (/^[IVXLCDM]+$/i.test(nextW.replace(/[^A-Za-z]/g, ''))) {
            cost += 35;
          }
          if (/^\d+$/.test(cleanLast)) {
            cost += 25;
          }
        }
      }

      if (dp[i] + cost < dp[j]) {
        dp[j] = dp[i] + cost;
        parent[j] = i;
      }
    }
  }

  const chunks: string[][] = [];
  let curr = m;
  while (curr > 0) {
    const prev = parent[curr] >= 0 ? parent[curr] : 0;
    chunks.push(words.slice(prev, curr));
    curr = prev;
  }
  chunks.reverse();
  return chunks;
}

function parseSrtSingleTimeMs(str: string): number | null {
  const m = str.trim().match(/^(\d{1,2}):(\d{2}):(\d{2})[,.](\d{1,3})$/);
  if (!m) return null;
  const hh = parseInt(m[1], 10);
  const mm = parseInt(m[2], 10);
  const ss = parseInt(m[3], 10);
  const ms = parseInt(m[4].padEnd(3, '0'), 10);
  return ((hh * 3600 + mm * 60 + ss) * 1000) + ms;
}

function formatMsToSrtTime(totalMs: number): string {
  const clamped = Math.max(0, Math.round(totalMs));
  const hh = Math.floor(clamped / 3600000);
  const rem1 = clamped % 3600000;
  const mm = Math.floor(rem1 / 60000);
  const rem2 = rem1 % 60000;
  const ss = Math.floor(rem2 / 1000);
  const ms = rem2 % 1000;
  return `${String(hh).padStart(2, '0')}:${String(mm).padStart(2, '0')}:${String(ss).padStart(2, '0')},${String(ms).padStart(3, '0')}`;
}

function subdivideTimestampRange(timestampLine: string, chunks: string[][]): string[] {
  if (chunks.length <= 1) return [timestampLine];
  const parts = timestampLine.split('-->');
  if (parts.length !== 2) return chunks.map(() => timestampLine);
  const startMs = parseSrtSingleTimeMs(parts[0]);
  const endMs = parseSrtSingleTimeMs(parts[1]);
  if (startMs === null || endMs === null || endMs <= startMs) {
    return chunks.map(() => timestampLine);
  }
  const totalDur = endMs - startMs;
  const weights = chunks.map((chunk) => {
    const text = chunk.join(' ');
    const lastW = chunk[chunk.length - 1] || '';
    const punctBonus = /[.?!:;…]$/.test(lastW) ? 5 : /[,]$/.test(lastW) ? 2 : 0;
    return Math.max(1, text.length + punctBonus);
  });
  const totalWeight = weights.reduce((a, b) => a + b, 0);
  const result: string[] = [];
  let accWeight = 0;
  let prevMs = startMs;
  for (let i = 0; i < chunks.length; i++) {
    accWeight += weights[i];
    const nextMs = i === chunks.length - 1 ? endMs : startMs + Math.round((accWeight / totalWeight) * totalDur);
    const safeNextMs = Math.max(prevMs + 10, Math.min(endMs, nextMs));
    result.push(`${formatMsToSrtTime(prevMs)} --> ${formatMsToSrtTime(safeNextMs)}`);
    prevMs = safeNextMs;
  }
  return result;
}

export function fixCapcutSrtWithVoiceover(
  voiceoverInput: string,
  capcutSrtRaw: string,
  options?: {
    maxCharsPerLine?: number;
    mode?: 'subdivide' | 'wrap' | 'original';
  }
): {
  fixedSrt: string;
  blocksCount: number;
  originalWordsCount: number;
  capcutWordsCount: number;
  similarityPct?: number;
  warningMsg?: string;
} {
  const lines = capcutSrtRaw.replace(/\r\n/g, '\n').replace(/\r/g, '\n').split('\n');
  const timeRegex = /^\s*\d{1,2}:\d{2}:\d{2}[,.]\d{1,3}\s*-->\s*\d{1,2}:\d{2}:\d{2}[,.]\d{1,3}/;
  let blocks: { id: string; timestampLine: string; textLines: string[]; lineCount: number; words: string[] }[] = [];
  let i = 0;
  while (i < lines.length) {
    if (timeRegex.test(lines[i])) {
      const timestampLine = lines[i].trim();
      let id = String(blocks.length + 1);
      if (i > 0 && /^\s*\d+\s*$/.test(lines[i - 1])) {
        id = lines[i - 1].trim();
      }
      i++;
      const textLines: string[] = [];
      while (i < lines.length && lines[i].trim() !== '') {
        if (i + 1 < lines.length && /^\s*\d+\s*$/.test(lines[i]) && timeRegex.test(lines[i + 1])) break;
        if (timeRegex.test(lines[i])) break;
        textLines.push(lines[i].trim());
        i++;
      }
      const words = textLines.join(' ').split(/\s+/).filter(Boolean);
      blocks.push({
        id,
        timestampLine,
        textLines,
        lineCount: Math.max(1, textLines.length),
        words,
      });
    } else {
      i++;
    }
  }

  if (blocks.length === 0) {
    throw new Error('No se detectaron bloques con timestamps válidos (00:00:XX,XXX --> 00:00:XX,XXX) en el archivo .SRT.');
  }

  const cleanedVoiceover = normalizeQuantitiesToMil(
    stripPauseTags(voiceoverInput)
      .replace(/Caracteres\s+Totales[^:\n]*:.*$/gim, '')
      .replace(/Pausas\s+Narrativas\s*:.*$/gim, '')
      .replace(/Duraci[oó]n\s+Total\s+Estimada\s*:.*$/gim, '')
      .trim()
  );
  const origTokens = cleanedVoiceover.split(/\s+/).filter(Boolean);
  if (origTokens.length === 0) {
    throw new Error('El Guion de la Voz en Off está vacío.');
  }

  const N = origTokens.length;
  const origPhons = origTokens.map((t) => tokenToPhonetic(t));

  // Detectar si al final del .SRT quedaron bloques sobrantes de un video anterior en el timeline de CapCut
  let removedTailBlocks = 0;
  const rawTotalCapWords = blocks.reduce((acc, b) => acc + b.words.length, 0);
  if (blocks.length > 10 && rawTotalCapWords > N * 1.05 && N >= 20) {
    const tailOrigPhon = origPhons.slice(Math.max(0, N - 5)).join('');
    let cumWords = 0;
    for (let b = 0; b < blocks.length - 1; b++) {
      cumWords += blocks[b].words.length;
      if (b >= Math.floor(blocks.length * 0.45) && cumWords >= N * 0.85 && cumWords <= N * 1.15) {
        const windowWords = [
          ...(b > 0 ? blocks[b - 1].words : []),
          ...blocks[b].words,
        ];
        const tailCapWords = windowWords.slice(Math.max(0, windowWords.length - 5));
        const tailCapPhon = tailCapWords.map((w) => tokenToPhonetic(w)).join('');
        const distTail = editDistance(tailCapPhon, tailOrigPhon);
        const simTail = 1 - distTail / Math.max(tailCapPhon.length, tailOrigPhon.length, 1);
        const lastBlockPhon = blocks[blocks.length - 1].words.map((w) => tokenToPhonetic(w)).join('');
        const simVeryLast = 1 - editDistance(lastBlockPhon.slice(-tailOrigPhon.length), tailOrigPhon) / Math.max(tailOrigPhon.length, 1);

        if (simTail >= 0.78 && simVeryLast < 0.6) {
          removedTailBlocks = blocks.length - (b + 1);
          blocks = blocks.slice(0, b + 1);
          break;
        }
      }
    }
  }

  const B = blocks.length;
  const totalCapWords = blocks.reduce((acc, b) => acc + b.words.length, 0);

  const blockPhons = blocks.map((b) => b.words.map((w) => tokenToPhonetic(w)).join(''));
  const cumCapPhonLen = new Int32Array(B + 1);
  for (let b = 0; b < B; b++) {
    cumCapPhonLen[b + 1] = cumCapPhonLen[b] + blockPhons[b].length;
  }
  const totalCapPhonLen = Math.max(1, cumCapPhonLen[B]);

  const cols = N + 1;
  const dp = new Float32Array((B + 1) * cols);
  const parentJ = new Int32Array((B + 1) * cols);
  const NEG_INF = -1e9;
  dp.fill(NEG_INF);
  parentJ.fill(-1);
  dp[0] = 0;

  const avgWordRatio = N / Math.max(totalCapWords, 1);
  const maxGlobalSlack = Math.max(3, Math.ceil(Math.abs(N - totalCapWords) / Math.max(B, 1)) + 2);

  for (let b = 0; b < B; b++) {
    const bRow = b * cols;
    const nextRow = (b + 1) * cols;
    const w_b = blocks[b].words.length;
    const capPhon = blockPhons[b];
    const L_b = capPhon.length;
    const firstCapW = blocks[b].words[0] || '';
    const lastCapW = blocks[b].words[w_b - 1] || '';

    if (w_b === 0) {
      for (let j = 0; j <= N; j++) {
        if (dp[bRow + j] > NEG_INF / 2) {
          dp[nextRow + j] = dp[bRow + j];
          parentJ[nextRow + j] = j;
        }
      }
      continue;
    }

    const expW = Math.max(1, Math.round(w_b * avgWordRatio));
    const minK = N >= B ? 1 : 0;
    const maxK = Math.max(w_b, expW) + maxGlobalSlack;
    const expectedCumJ = Math.round((cumCapPhonLen[b + 1] / totalCapPhonLen) * N);

    for (let jPrev = 0; jPrev <= N; jPrev++) {
      const prevScore = dp[bRow + jPrev];
      if (prevScore <= NEG_INF / 2) continue;

      const maxJCurr = Math.min(N, jPrev + maxK);
      let concatOrigPhon = '';

      for (let jCurr = jPrev + minK; jCurr <= maxJCurr; jCurr++) {
        if (jCurr > jPrev) {
          if (concatOrigPhon === '' && jCurr > jPrev + 1) {
            for (let t = jPrev; t < jCurr; t++) concatOrigPhon += origPhons[t];
          } else {
            concatOrigPhon += origPhons[jCurr - 1];
          }
        }

        const k = jCurr - jPrev;
        const origLen = concatOrigPhon.length;
        const distBlock = editDistance(capPhon, concatOrigPhon);
        const simBlock = 1 - distBlock / Math.max(L_b, origLen, 1);
        const simFirst = k > 0 ? singleWordSim(firstCapW, origTokens[jPrev]) : 0;
        const simLast = k > 0 ? singleWordSim(lastCapW, origTokens[jCurr - 1]) : 0;
        const pLen = Math.min(6, L_b, origLen);
        const simPrefix = pLen > 0 ? 1 - editDistance(capPhon.slice(0, pLen), concatOrigPhon.slice(0, pLen)) / pLen : 0;
        const simSuffix = pLen > 0 ? 1 - editDistance(capPhon.slice(-pLen), concatOrigPhon.slice(-pLen)) / pLen : 0;
        const charDiffRatio = Math.abs(origLen - L_b) / Math.max(L_b, 6);
        const wordDiff = Math.abs(k - expW);
        const lenPenalty = charDiffRatio * 2.4 + charDiffRatio * charDiffRatio * 2.0 + wordDiff * 0.35 + (wordDiff > 2 ? (wordDiff - 2) * 0.9 : 0);
        const driftPenalty = Math.abs(jCurr - expectedCumJ) * 0.03;

        const stepScore =
          simBlock * 6.5 +
          simFirst * 1.8 +
          simLast * 1.8 +
          simPrefix * 1.0 +
          simSuffix * 1.0 -
          lenPenalty -
          driftPenalty;

        const cand = prevScore + stepScore;
        if (cand > dp[nextRow + jCurr]) {
          dp[nextRow + jCurr] = cand;
          parentJ[nextRow + jCurr] = jPrev;
        }
      }
    }
  }

  const splits = new Array(B + 1);
  let endJ = N;
  if (dp[B * cols + N] <= NEG_INF / 2) {
    let bestFinalScore = NEG_INF;
    for (let j = N; j >= 0; j--) {
      if (dp[B * cols + j] > bestFinalScore) {
        bestFinalScore = dp[B * cols + j];
        endJ = j;
      }
    }
  }
  splits[B] = endJ;
  for (let b = B; b >= 1; b--) {
    const p = parentJ[b * cols + splits[b]];
    splits[b - 1] = p >= 0 ? p : Math.max(0, splits[b] - blocks[b - 1].words.length);
  }
  splits[0] = 0;

  let totalMatchedChars = 0;
  let totalCompChars = 0;
  const rebuiltBlocks: string[] = [];
  const maxCharsPerLine = options?.maxCharsPerLine ?? 32;
  const lineMode = options?.mode ?? 'subdivide';

  for (let b = 0; b < B; b++) {
    const block = blocks[b];
    const slice = origTokens.slice(splits[b], splits[b + 1]);
    // Nunca hacer fallback a block.textLines para evitar colar captions de otro video si sobran bloques
    if (slice.length === 0) continue;

    const origSlicePhon = origPhons.slice(splits[b], splits[b + 1]).join('');
    const capPhon = blockPhons[b];
    const maxLen = Math.max(origSlicePhon.length, capPhon.length, 1);
    const dist = editDistance(capPhon, origSlicePhon);
    totalMatchedChars += Math.max(0, maxLen - dist);
    totalCompChars += maxLen;

    if (lineMode === 'subdivide' && maxCharsPerLine > 0) {
      const chunks = splitWordsIntoShortLines(slice, maxCharsPerLine);
      const subTimestamps = subdivideTimestampRange(block.timestampLine, chunks);
      for (let c = 0; c < chunks.length; c++) {
        const cleanIdx = rebuiltBlocks.length + 1;
        rebuiltBlocks.push(`${cleanIdx}\n${subTimestamps[c]}\n${chunks[c].join(' ')}`);
      }
    } else if (lineMode === 'wrap' && maxCharsPerLine > 0) {
      const chunks = splitWordsIntoShortLines(slice, maxCharsPerLine);
      const formattedText = chunks.map((c) => c.join(' ')).join('\n');
      const cleanIdx = rebuiltBlocks.length + 1;
      rebuiltBlocks.push(`${cleanIdx}\n${block.timestampLine}\n${formattedText}`);
    } else {
      let formattedText = '';
      if (block.lineCount >= 2 && slice.length >= 4) {
        const mid = Math.ceil(slice.length / 2);
        formattedText = `${slice.slice(0, mid).join(' ')}\n${slice.slice(mid).join(' ')}`;
      } else {
        formattedText = slice.join(' ');
      }
      const cleanIdx = rebuiltBlocks.length + 1;
      rebuiltBlocks.push(`${cleanIdx}\n${block.timestampLine}\n${formattedText}`);
    }
  }

  const similarityPct = totalCompChars > 0 ? Math.round((totalMatchedChars / totalCompChars) * 100) : 100;
  const warnings: string[] = [];
  if (removedTailBlocks > 0) {
    warnings.push(
      `🛡️ Se detectaron y eliminaron automáticamente ${removedTailBlocks} bloques sobrantes al final del .SRT que pertenecían a un video anterior en la línea de tiempo de CapCut.`
    );
  }
  if (similarityPct < 45) {
    warnings.push(
      `⚠️ ¡ATENCIÓN! Coincidencia fonética muy baja (${similarityPct}%) entre el archivo .SRT y el Guion de Voz Narrativa. Verifica que no hayas subido el .SRT o el Guion de un video anterior.`
    );
  }

  return {
    fixedSrt: rebuiltBlocks.join('\n\n') + '\n',
    blocksCount: rebuiltBlocks.length,
    originalWordsCount: N,
    capcutWordsCount: totalCapWords,
    similarityPct,
    warningMsg: warnings.join(' '),
  };
}
