import { splitScreenGraphicsBlock } from './docGraphics';
import {
  BrollCameraMotion,
  DocumentaryClip,
  ReferenceAsset,
  SunoTrack,
  Sentence,
  DEFAULT_OPERATIONAL_HEADER,
  sanitizeOperationalHeader,
  isClipDiscardOverridden,
} from '../types';
import { formatMMSS } from './formatTime';
import { isTwoShotClipText } from './shotCatalogue';

export const BROLL_MOTION_TAG_BY_KEY: Record<BrollCameraMotion, string> = {
  zoom_in: 'STATIC_ZOOM_IN',
  zoom_out: 'STATIC_ZOOM_OUT',
  pan_right: 'STATIC_PAN_RIGHT',
  pan_left: 'STATIC_PAN_LEFT',
  tilt_up: 'STATIC_TILT_UP',
  tilt_down: 'STATIC_TILT_DOWN',
};

export const BROLL_MOTION_UI_LABEL_ES: Record<BrollCameraMotion, string> = {
  zoom_in: 'Zoom In',
  zoom_out: 'Zoom Out',
  pan_right: 'Pan Derecha',
  pan_left: 'Pan Izquierda',
  tilt_up: 'Tilt Arriba',
  tilt_down: 'Tilt Abajo',
};

export const BROLL_MOTION_ENGLISH_PHRASE: Record<BrollCameraMotion, string> = {
  zoom_in: 'smooth, continuous, ultra-steady optical Ken Burns zoom-in',
  zoom_out: 'smooth, continuous, ultra-steady optical Ken Burns zoom-out',
  pan_right: 'smooth, continuous horizontal rostrum camera pan from left to right',
  pan_left: 'smooth, continuous horizontal rostrum camera pan from right to left',
  tilt_up: 'smooth, continuous vertical rostrum camera tilt upward from bottom to top',
  tilt_down: 'smooth, continuous vertical rostrum camera tilt downward from top to bottom',
};

/** Image model every thumbnail is created with (user request 2026-11-25). */
export const THUMBNAIL_IMAGE_MODEL_SENTENCE = 'Generate this image with the Nano Banana 2.1 image model.';

/** Closing sentence of every thumbnail image prompt: a real documentary photograph, never a render. */
export const THUMBNAIL_PHOTO_REALISM_CLOSING =
  'Shot as a real photograph, not a render: a genuine documentary film still captured on a full-frame cinema camera with a real 35mm lens, natural motivated light coming only from light sources inside the scene, real skin texture with pores and imperfections, real fabric weave, dust and weathered surfaces, subtle film grain, true-to-life muted colors, safe framing composition, 8k resolution, sharp focus, no modern objects. Strictly NOT a 3D render, NOT CGI, NOT a video game or Unreal Engine look, NOT digital painting or illustration, no plastic or waxy skin, no oversaturated colors, no HDR glow, no unintended floating text, no music.';

export const IMAGE_ONLY_BROLL_DIRECTIVE_TAG = '[IMAGE ONLY — DO NOT GENERATE VIDEO CLIP]';

export const FROZEN_FLOW_CLOSING_CLAUSE =
  'cinematic documentary realism, safe framing composition, 8k resolution, sharp focus, no modern objects, no CGI look, no text, no spoken voice, no human speech, no music.';

export const FLOW_TRAILING_FIX_NAME_RE =
  /\bfix\s+the\s+name(?:\s+to\s+(?:Inicial|Broll|Clip|@?[A-Za-z0-9_]+)_[A-Za-z0-9_]+|\s+to\s+@?[A-Za-z0-9_]+)?\.?\s*$/i;

export function stripAllPromptBrackets(text: string): string {
  let out = String(text || '');
  while (/\[[^\]]*\]/.test(out)) {
    out = out.replace(/\[[^\]]*\]/g, ' ');
  }
  return out.replace(/[\[\]]/g, ' ');
}

export function isImageOnlyBrollPrompt(text?: string | null): boolean {
  if (!text) return false;
  return (
    /\[IMAGE\s+ONLY\s*[—–-]?\s*DO\s+NOT\s+GENERATE\s+VIDEO\s+CLIP\]/i.test(text) ||
    /\[B-Roll\s*:\s*STATIC_[A-Z_]+\]/i.test(text) ||
    /\bfix\s+the\s+name\s+to\s+Broll_\d+/i.test(text) ||
    /\bstill\s+archival\s+documentary\s+B-roll\s+plate\b/i.test(text)
  );
}

export function extractInlineTimeRangeFromPrompt(text?: string | null): string | undefined {
  if (!text) return undefined;
  const tagMatch = text.match(/\[Time\s*:\s*(\d{1,3}:\d{2}(?:\.\d+)?\s*-\s*\d{1,3}:\d{2}(?:\.\d+)?)\]/i);
  if (tagMatch?.[1]) return tagMatch[1].replace(/\s*-\s*/, ' - ').trim();
  const headerMatch = text.match(
    /^(?:Image|Imagen|Clip)\s*\[?0*\d+\]?\s*\((\d{1,3}:\d{2}(?:\.\d+)?\s*(?:-|–|—|to)\s*\d{1,3}:\d{2}(?:\.\d+)?)\)/i
  );
  if (headerMatch?.[1]) return headerMatch[1].replace(/\s*(?:-|–|—|to)\s*/, ' - ').trim();
  return undefined;
}

export function stripBrollControlTagsFromImagePrompt(rawPrompt: string): string {
  return stripAllPromptBrackets(String(rawPrompt || ''))
    .replace(FLOW_TRAILING_FIX_NAME_RE, '')
    .replace(/\s{2,}/g, ' ')
    .trim();
}

export function normalizeBrollImagePrompt(
  rawImg: string,
  clipNumber: number,
  _timeRange?: string,
  _durationSec: number = 8,
  _motion: BrollCameraMotion = 'zoom_in'
): string {
  const inferredNum = Number.isFinite(clipNumber) && clipNumber > 0
    ? clipNumber
    : Number(
        String(rawImg || '').match(/^(?:Image|Imagen)\s*\[?0*(\d+)\]?/i)?.[1] ||
          String(rawImg || '').match(/\bfix\s+the\s+name\s+to\s+(?:Inicial|Broll|Clip)_0*(\d+)/i)?.[1] ||
          1
      );
  const numStr = inferredNum < 10 ? `0${inferredNum}` : `${inferredNum}`;
  let body = stripBrollControlTagsFromImagePrompt(rawImg)
    .replace(/^(?:(?:Image|Imagen)\s*(?:\[?0*\d+\]?|undefined|NaN)(?:\s*\([^)]*\))?\s*[:\-–]\s*)+/i, '')
    .trim();

  // Deduplicate any nested/repeated B-Roll plate phrasing from earlier passes
  body = body
    .replace(
      /^Create\s+an\s+image(?:\s+in\s+(16[-:]9\s+horizontal|16-by-9\s+horizontal|9[-:]16\s+vertical|9-by-16\s+vertical)\s+aspect\s+ratio)?\s+(?:of\s+)?/i,
      (_, ar) =>
        `Create an image in ${
          ar && /9[-:]16|9-by-16/i.test(ar) ? '9-16 vertical' : '16-9 horizontal'
        } aspect ratio `
    )
    .replace(
      /\bstructured\s+as\s+a\s+completely\s+still\s+archival\s+documentary\s+B-roll\s+plate\s+(?:showing|depicting)\s+(?:an?\s+(?:moody\s+|stark\s+|somber\s+|warm\s+|\d{4}\s+)*archival\s+still[- ]photograph\s+plate\s+(?:showing\s+|of\s+)?)?/gi,
      ''
    )
    .replace(
      /\ban?\s+archival\s+still[- ]photograph\s+plate\s+(?:on|inside|along|at|of|showing)\s+/gi,
      (m) => {
        const prep = m.match(/\b(on|inside|along|at|of|showing)\s+$/i)?.[1] || '';
        return prep.toLowerCase() === 'showing' || prep.toLowerCase() === 'of' ? '' : `${prep} `;
      }
    )
    .replace(/,?\s*designed\s+as\s+a\s+100%\s+frozen\s+documentary\s+B-roll\s+still\s+plate\b/gi, '')
    .replace(/\s{2,}/g, ' ')
    .trim();

  if (!/^Create\s+an\s+image\b/i.test(body)) {
    body = `Create an image in 16-9 horizontal aspect ratio ${body}`;
  }

  body = body.replace(
    /^(Create\s+an\s+image\s+in\s+(?:16[-:]9\s+horizontal|9[-:]16\s+vertical)\s+aspect\s+ratio)\s+(?:structured\s+as\s+a\s+completely\s+still\s+archival\s+documentary\s+B-roll\s+plate\s+)?(?:(on|inside|along|at|beneath|under|across)\b|(?:showing\s+|depicting\s+|of\s+)?)/i,
    (_, prefix, locPrep) =>
      locPrep
        ? `${prefix} structured as a completely still archival documentary B-roll plate ${locPrep.toLowerCase()}`
        : `${prefix} structured as a completely still archival documentary B-roll plate showing `
  );

  return sanitizeImagePromptForFlowSafety(`Image ${numStr}: ${body}`, undefined, undefined, {
    isStaticBroll: true,
    clipNumber: inferredNum,
  });
}

export function parseBrollMotionFromText(
  promptOrVideoText?: string,
  cameraSelection?: string,
  extraText?: string
): { isStaticBroll: boolean; brollCameraMotion?: BrollCameraMotion } {
  const combined = `${promptOrVideoText || ''} ${cameraSelection || ''} ${extraText || ''}`;
  const tagMatch = combined.match(/\[B-Roll\s*:\s*STATIC_([A-Z_]+)\]/i);
  if (tagMatch) {
    const raw = tagMatch[1].toUpperCase();
    const map: Record<string, BrollCameraMotion> = {
      ZOOM_IN: 'zoom_in',
      ZOOM_OUT: 'zoom_out',
      PAN_RIGHT: 'pan_right',
      PAN_LEFT: 'pan_left',
      PAN: 'pan_right',
      TILT_UP: 'tilt_up',
      TILT_DOWN: 'tilt_down',
      TILT: 'tilt_up',
    };
    return { isStaticBroll: true, brollCameraMotion: map[raw] || 'zoom_in' };
  }
  if (
    /STATIC\s+B-ROLL\s+PLATE\s+LOCK|IMAGE\s+ONLY\s*[—–-]?\s*DO\s+NOT\s+GENERATE\s+VIDEO\s+CLIP|Static\s+B-Roll\s+Plate|B-Roll\s+Est[áa]tico|\bfix\s+the\s+name\s+to\s+Broll_\d+|\bstill\s+archival\s+documentary\s+B-roll\s+plate\b/i.test(
      combined
    )
  ) {
    let inferred: BrollCameraMotion = 'zoom_in';
    if (/zoom[-\s]*out/i.test(combined)) inferred = 'zoom_out';
    else if (/pan[-\s]*left|izquierda/i.test(combined)) inferred = 'pan_left';
    else if (/pan[-\s]*right|lateral\s+pan|derecha/i.test(combined)) inferred = 'pan_right';
    else if (/tilt[-\s]*down|abajo/i.test(combined)) inferred = 'tilt_down';
    else if (/tilt[-\s]*up|vertical.*up|arriba/i.test(combined)) inferred = 'tilt_up';
    return { isStaticBroll: true, brollCameraMotion: inferred };
  }
  return { isStaticBroll: false };
}

export function ensureOperationalHeaderInRawClips(
  rawText: string,
  operationalHeader: string = DEFAULT_OPERATIONAL_HEADER,
  engine?: FlowProjectEngineMode
): string {
  const header = sanitizeOperationalHeader(operationalHeader, engine);
  const trimmed = (rawText || '').trim();
  if (!trimmed) return header;

  // Strip any leading operational/corrupted header(s) before the first Image N / Clip N block
  const firstPromptIdx = trimmed.search(/(?:^|\n)\s*(?:Image|Imagen|Clip)\s*\[?0*1\]?\s*[:(\-]/i);
  if (firstPromptIdx >= 0) {
    const bodyOnly = trimmed.slice(firstPromptIdx).trim();
    return bodyOnly ? `${header}\n\n${bodyOnly}` : header;
  }

  if (
    /^Act as a (?:professional |master )?historian/i.test(trimmed) &&
    /pre-generation\s+report|how\s+many\s+(?:video\s+)?clips\s+will\s+be\s+(?:made|generated)\s+with\s+(?:Omni|Lower\s+Priority)/i.test(trimmed) &&
    /Static\s+B-Roll|\[B-Roll:\s*STATIC_/i.test(trimmed) &&
    /Inicial_/i.test(trimmed) &&
    /Broll_/i.test(trimmed) &&
    /Clip_/i.test(trimmed) &&
    /(?:literal first 6 words|first 6 literal words|first 6 words)/i.test(trimmed) &&
    trimmed.includes('01 to 09')
  ) {
    return sanitizeOperationalHeader(trimmed, engine);
  }
  // If rawText only contained a legacy Spanish or corrupted/incomplete header without clips yet, return the clean English 9-line header
  if (
    /^Act[uú]a como un historiador/i.test(trimmed) ||
    /^Act as a (?:professional |master )?historian/i.test(trimmed) ||
    /Cambia\s+los\s+nombres/i.test(trimmed) ||
    /del\s+1\s+al\s+10|Cuando\s+se\s+hayan\s+generado\s+todas\s+las\s+im[áa]genes/i.test(trimmed)
  ) {
    return header;
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
  const PLACE_TITLE_EXCLUSION =
    '(?!Mary\\b|Francisco\\b|Diego\\b|Carlos\\b|Juan\\b|Jos[eé]\\b|Luis\\b|Pedro\\b|Pablo\\b|Miguel\\b|Antonio\\b|Mart[ií]n\\b|Sebasti[aá]n\\b|Salvador\\b|Lorenzo\\b|Mateo\\b|Nicol[aá]s\\b|Crist[oó]bal\\b|Fe\\b|Clara\\b|Cruz\\b|Mar[ií]a\\b|Rosa\\b|Ana\\b|Luc[ií]a\\b|B[aá]rbara\\b|Elena\\b|Teresa\\b|Domingo\\b|Tom[aá]s\\b|Sp[ií]ritus\\b)';
  p = p.replace(
    /\b(?:Queen|Princess|Empress|Duchess|Lady|Countess|Reina|Princesa|Emperatriz|Duquesa|Doña|Mrs\.?|Ms\.?|Sra\.?)\s+[A-ZÁÉÍÓÚÑ][a-záéíóúñ]+(?:\s+(?:of|de|del|von|I|II|III|IV|V|VI|VII|VIII|IX|X|[A-ZÁÉÍÓÚÑ][a-záéíóúñ]+))*/g,
    'an adult historical noblewoman in regal period attire, portrayed by an anonymous dramatic actress'
  );
  p = p.replace(
    /\b(?:King|Prince|Emperor|Duke|Lord|Count|Sultan|Tsar|Czar|Pharaoh|General|Gral\.?|Colonel|Col\.?|Captain|Capt\.?|Major|Commander|Admiral|President|Presidente|Prime\s+Minister|Chancellor|Minister|Ministro|Governor|Gobernador|Senator|Mayor|Rey|Príncipe|Emperador|Duque|Conde|Faraón|Sir|Don)\s+[A-ZÁÉÍÓÚÑ][a-záéíóúñ]+(?:\s+(?:of|de|del|von|I|II|III|IV|V|VI|VII|VIII|IX|X|XI|XII|XIII|XIV|XV|XVI|[A-ZÁÉÍÓÚÑ][a-záéíóúñ]+))*/g,
    'an adult historical figure in ceremonial period wardrobe, portrayed by an anonymous dramatic actor'
  );
  p = p.replace(
    /\b(?:Dr\.?|Doctor|Doctora|Prof\.?|Professor|Profesor|Poet|Poeta|Surgeon|Cirujano|Inventor|Industrialist|Mr\.?|Sr\.?)\s+[A-ZÁÉÍÓÚÑ][a-záéíóúñ]+(?:\s+(?:de|del|la|von|van|[A-ZÁÉÍÓÚÑ][a-záéíóúñ]+))*/g,
    'an adult historical specialist in authentic period attire, portrayed by an anonymous actor'
  );
  p = p.replace(
    new RegExp(
      `\\b(?:Pope|Bishop|Archbishop|Cardinal|Father|Friar|Papa|Obispo|Arzobispo|Cardenal|Fray|(?:Saint|San|Santa|Santo)\\s+${PLACE_TITLE_EXCLUSION})\\s+[A-ZÁÉÍÓÚÑ][a-záéíóúñ]+(?:\\s+(?:of|de|del|I|II|III|IV|V|VI|VII|VIII|IX|X|XI|XII|XIII|XIV|XV|XVI|[A-ZÁÉÍÓÚÑ][a-záéíóúñ]+))*(?!\\s+(?:Hospital|Church|Cathedral|Abbey|Fort|Fortress|Castle|Bay|Harbor|Port|Street|Avenue|Plaza|Square|Island|River|Valley))`,
      'g'
    ),
    'an elderly historical clergyman in ornate ceremonial vestments, portrayed by an anonymous actor'
  );

  // 2. Reemplazar nombres propios históricos sueltos que disparan el detector de "prominent people"
  p = p.replace(
    /\b(Ingeborg|Isambour|Blanche|Blanca|Eleanor|Leonor|Agnes|Inés|Cleopatra|Nefertiti|Boleyn|Elizabeth|Isabel|Mary Stuart|Marie Antoinette|Victoria|Catherine|Catalina|Juana|Eva Per[oó]n|Evita)\b/g,
    'the adult noblewoman in period attire'
  );
  p = p.replace(
    /\b(Philip Augustus|Felipe Augusto|Philip II|Felipe II|Alfonso XIII|Alfonso XII|Primo de Rivera|Franco|Machado|Philip|Felipe|Augustus|Augusto|Innocent III|Inocencio III|Innocent|Inocencio|Louis VIII|Louis IX|King John|Canute|Knut|Valdemar|Napoleon|Bonaparte|Caesar|Nero|Caligula|Charlemagne|Carlomagno|Henry VIII|Enrique VIII|Richard|Ricardo|Medici|Borgia|Habsburg|Romanov|Tudor|Plantagenet|Capet|Capeto|Columbus|Colón|Cortés|Pizarro|Bolívar|Juan Per[oó]n|Per[oó]n|Edison|Henry Ford|Enzo Ferrari|Churchill|Roosevelt|Lincoln|Einstein|Pasteur|Fleming|Florey|Heatley|Mazza)\b/g,
    'the adult historical figure in period attire'
  );

  // 3. Preservar intactos los identificadores @Referencia (@Character y @Location de Etapa 4)
  // para que Google Flow vincule las láminas de referencia exactas sin destruirlas ni convertir lugares en personas.

  // 4. Neutralizar únicamente edades de menores (<18 años) y términos gráficos/violencia/sangre/"muerte"/"asesino"
  p = p.replace(
    /\b((?:[1-9]|1[0-7])-year-old|child bride|young girl|teenage girl|teenage boy|little girl|little boy|adolescent|minor|underage|niña|niño|adolescente|menor)\b/gi,
    'adult in their mid-twenties'
  );
  p = p
    .replace(/\bdead\s+of\s+night\b/gi, 'deepest hour of night')
    .replace(/\bdead\s+silence\b/gi, 'utter silence')
    .replace(/\bdead\s+center\b/gi, 'exact center')
    .replace(/\b(assassin|assassins|murderer|murderers|killer|killers)\b/gi, 'cloaked historical adversary')
    .replace(
      /\b(assassination|assassinations|murder|murders|homicide|homicides|manslaughter|slaughter|massacre|massacres)\b/gi,
      'dramatic historical confrontation'
    )
    .replace(/\b(murdered|assassinated|killed|slain)\b/gi, 'fallen')
    .replace(/\b(murderous|deadly)\b/gi, 'perilous')
    .replace(/\b(killing|assassinating|murdering|dying)\b/gi, 'collapsing in dramatic shadow')
    .replace(/\bdeathbed\b/gi, 'final resting chamber')
    .replace(/\b(death|deaths)\b/gi, 'fateful end')
    .replace(/\b(dead\s+bodies|corpses|cadavers)\b/gi, 'fallen figures in shadow')
    .replace(/\b(dead\s+body|corpse|cadaver)\b/gi, 'fallen figure in shadow')
    .replace(/\bdead\b/gi, 'motionless')
    .replace(/\bdied\b/gi, 'faded away')
    .replace(/\bdies\b/gi, 'fades away')
    .replace(/\b(kill|kills|assassinate|die)\b/gi, 'fall in shadow');
  p = p.replace(
    /\b(blood|bleeding|bloody|gore|execution|beheading|decapitation|torture|suicide|suicidal|self-harm|naked|nude|undressed|sangre|cadáver|ejecución|tortura|desnuda|desnudo)\b/gi,
    'dramatic chiaroscuro shadow'
  );
  p = sanitizeBrandSafeEditorialText(p);

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
 * Regla editorial inquebrantable de monetización y seguridad de marca para próximos videos
 * (YouTube, Facebook, Miniaturas, Ganchos de Clip 1, Guion de Voz Narrativa, Prompts y Metadata).
 */
export const BRAND_SAFETY_LEXICAL_RULE_EN = `
🛡️ UNBREAKABLE YOUTUBE MONETIZATION & BRAND-SAFETY LEXICAL RULE (ZERO "MUERTE" / "DEATH", "ASESINO" / "MURDERER" OR DERIVATIVES):
- You are STRICTLY FORBIDDEN from writing anywhere in the deliverable (Spanish voiceover script, titles, thumbnail text overlays, Clip 1 hooks, descriptions, chapters, hashtags, SEO tags, pinned comments, or English visual prompts) the Spanish words **"muerte"** or **"asesino"** (or their English equivalents **"death"** / **"murderer"**) or ANY of their direct derivatives or lethal synonyms:
  • Forbidden "muerte / death" family: *muerte, muertes, muerto, muerta, muertos, muertas, morir, morirse, murió, murieron, muriendo, muere, mueren, moría, morían, morirá, muriera, mortal, mortales, mortalidad, mortandad, mortífero, mortífera, moribundo, cadáver, cadáveres* (and in English: *death, dead, deadly, die, died, dying, corpse, cadaver*).
  • Forbidden "asesino / murder" & lethal violence family: *asesino, asesina, asesinos, asesinas, asesinato, asesinatos, asesinar, asesinó, asesinaron, asesinado, asesinada, homicidio, homicida, matar, mató, mataron, matanza, masacre, suicidio, suicida, suicidarse* (and in English: *murder, murderer, murdered, killer, killing, kill, killed, assassin, assassination, homicide, suicide*).
- MANDATORY ELEGANT DOCUMENTARY SUBSTITUTION: Always use high-retention historical, journalistic, and cinematic phrasing that preserves full dramatic tension without triggering algorithmic demonetization filters:
  • In Spanish deliverables, instead of *morir / murió / muerto / muerte / mortal*, use: *"perder la vida"*, *"perdió la vida"*, *"fallecer / falleció"*, *"perecer / pereció"*, *"sucumbir"*, *"apagarse"*, *"caer sin vida"*, *"el desenlace fatal"*, *"el último aliento"*, *"bajas humanas"*, *"letal"*, *"fulminante"*, *"pena capital"*.
  • In Spanish deliverables, instead of *asesino / asesinar / asesinato / matar*, use: *"el perpetrador"*, *"el autor del crimen"*, *"el conspirador"*, *"el ejecutor en la sombra"*, *"el atacante"*, *"quitar la vida"*, *"arrebatar la vida"*, *"abatir / fue abatido"*, *"silenciar"*, *"el crimen"*, *"el atentado"*, *"la conjura"*.`;

export const BRAND_SAFETY_LEXICAL_RULE_ES = BRAND_SAFETY_LEXICAL_RULE_EN;

function matchSpanishEditorialCase(source: string, replacement: string): string {
  if (!source) return replacement;
  const lettersOnly = source.replace(/[^A-Za-zÁÉÍÓÚÜÑáéíóúüñ]/g, '');
  if (lettersOnly.length >= 2 && lettersOnly === lettersOnly.toUpperCase()) {
    return replacement.toUpperCase();
  }
  const firstChar = source.charAt(0);
  if (
    firstChar &&
    firstChar === firstChar.toUpperCase() &&
    firstChar !== firstChar.toLowerCase()
  ) {
    return replacement.charAt(0).toUpperCase() + replacement.slice(1);
  }
  return replacement;
}

const ES_WORD_PRE = '(?<![A-Za-zÁÉÍÓÚÜÑáéíóúüñ0-9_@])';
const ES_WORD_POST = '(?![A-Za-zÁÉÍÓÚÜÑáéíóúüñ0-9_])';

function buildEsBoundaryRegex(pattern: string): RegExp {
  return new RegExp(`${ES_WORD_PRE}(?:${pattern})${ES_WORD_POST}`, 'gi');
}

const BRAND_SAFE_EDITORIAL_RULES: Array<[RegExp, string]> = [
  // --- Frases compuestas de "muerte" / "muerto" / "mortal" (mayor especificidad primero) ---
  [buildEsBoundaryRegex('condenados\\s+a\\s+muerte'), 'condenados a la pena capital'],
  [buildEsBoundaryRegex('condenadas\\s+a\\s+muerte'), 'condenadas a la pena capital'],
  [buildEsBoundaryRegex('condenado\\s+a\\s+muerte'), 'condenado a la pena capital'],
  [buildEsBoundaryRegex('condenada\\s+a\\s+muerte'), 'condenada a la pena capital'],
  [buildEsBoundaryRegex('penas\\s+de\\s+muerte'), 'penas capitales'],
  [buildEsBoundaryRegex('pena\\s+de\\s+muerte'), 'pena capital'],
  [buildEsBoundaryRegex('sentencias\\s+de\\s+muerte'), 'sentencias capitales'],
  [buildEsBoundaryRegex('sentencia\\s+de\\s+muerte'), 'sentencia capital'],
  [buildEsBoundaryRegex('condenas\\s+de\\s+muerte'), 'condenas capitales'],
  [buildEsBoundaryRegex('condena\\s+de\\s+muerte'), 'condena capital'],
  [buildEsBoundaryRegex('peligro\\s+de\\s+muerte'), 'peligro letal'],
  [buildEsBoundaryRegex('amenazas\\s+de\\s+muerte'), 'amenazas letales'],
  [buildEsBoundaryRegex('amenaza\\s+de\\s+muerte'), 'amenaza letal'],
  [buildEsBoundaryRegex('causas\\s+de\\s+muerte'), 'causas de fallecimiento'],
  [buildEsBoundaryRegex('causa\\s+de\\s+muerte'), 'causa de fallecimiento'],
  [buildEsBoundaryRegex('lecho\\s+de\\s+muerte'), 'lecho final'],
  [buildEsBoundaryRegex('de\\s+vida\\s+o\\s+muerte'), 'de supervivencia extrema'],
  [buildEsBoundaryRegex('heridos\\s+de\\s+muerte'), 'heridos de gravedad extrema'],
  [buildEsBoundaryRegex('heridas\\s+de\\s+muerte'), 'heridas de gravedad extrema'],
  [buildEsBoundaryRegex('herido\\s+de\\s+muerte'), 'herido de gravedad extrema'],
  [buildEsBoundaryRegex('herida\\s+de\\s+muerte'), 'herida de gravedad extrema'],
  [buildEsBoundaryRegex('dar\\s+muerte'), 'quitar la vida'],
  [buildEsBoundaryRegex('dio\\s+muerte'), 'quitó la vida'],
  [buildEsBoundaryRegex('dieron\\s+muerte'), 'quitaron la vida'],
  [buildEsBoundaryRegex('dando\\s+muerte'), 'quitando la vida'],
  [buildEsBoundaryRegex('hasta\\s+la\\s+muerte'), 'hasta el último aliento'],
  [buildEsBoundaryRegex('hasta\\s+su\\s+muerte'), 'hasta su último día'],
  [buildEsBoundaryRegex('tras\\s+la\\s+muerte\\s+de'), 'tras el fallecimiento de'],
  [buildEsBoundaryRegex('despu[eé]s\\s+de\\s+la\\s+muerte\\s+de'), 'después del fallecimiento de'],
  [buildEsBoundaryRegex('antes\\s+de\\s+la\\s+muerte\\s+de'), 'antes del fallecimiento de'],
  [buildEsBoundaryRegex('tras\\s+su\\s+muerte'), 'tras su fallecimiento'],
  [buildEsBoundaryRegex('despu[eé]s\\s+de\\s+su\\s+muerte'), 'después de su fallecimiento'],
  [buildEsBoundaryRegex('antes\\s+de\\s+su\\s+muerte'), 'antes de su fallecimiento'],
  [buildEsBoundaryRegex('la\\s+muerte\\s+del'), 'el fallecimiento del'],
  [buildEsBoundaryRegex('la\\s+muerte\\s+de'), 'el fallecimiento de'],
  [buildEsBoundaryRegex('una\\s+muerte'), 'un desenlace fatal'],
  [buildEsBoundaryRegex('esta\\s+muerte'), 'este desenlace fatal'],
  [buildEsBoundaryRegex('esa\\s+muerte'), 'ese desenlace fatal'],
  [buildEsBoundaryRegex('aquella\\s+muerte'), 'aquel desenlace fatal'],
  [buildEsBoundaryRegex('cuya\\s+muerte'), 'cuyo fallecimiento'],
  [buildEsBoundaryRegex('su\\s+muerte'), 'su fallecimiento'],
  [buildEsBoundaryRegex('mi\\s+muerte'), 'mi final'],
  [buildEsBoundaryRegex('tu\\s+muerte'), 'tu final'],
  [buildEsBoundaryRegex('la\\s+muerte'), 'el desenlace fatal'],
  [buildEsBoundaryRegex('a\\s+muerte'), 'sin tregua'],
  [buildEsBoundaryRegex('muertes'), 'pérdidas humanas'],
  [buildEsBoundaryRegex('muerte'), 'pérdida fatal'],

  // --- Participios y sustantivos "muerto / muerta / muertos / muertas" ---
  [buildEsBoundaryRegex('hab[ií]an\\s+muerto'), 'habían fallecido'],
  [buildEsBoundaryRegex('hab[ií]a\\s+muerto'), 'había fallecido'],
  [buildEsBoundaryRegex('han\\s+muerto'), 'han fallecido'],
  [buildEsBoundaryRegex('ha\\s+muerto'), 'ha fallecido'],
  [buildEsBoundaryRegex('hubieron\\s+muerto'), 'hubieron fallecido'],
  [buildEsBoundaryRegex('hubo\\s+muerto'), 'hubo fallecido'],
  [buildEsBoundaryRegex('hubieran\\s+muerto'), 'hubieran fallecido'],
  [buildEsBoundaryRegex('hubiera\\s+muerto'), 'hubiera fallecido'],
  [buildEsBoundaryRegex('hubiesen\\s+muerto'), 'hubiesen fallecido'],
  [buildEsBoundaryRegex('hubiese\\s+muerto'), 'hubiese fallecido'],
  [buildEsBoundaryRegex('habr[ií]an\\s+muerto'), 'habrían fallecido'],
  [buildEsBoundaryRegex('habr[ií]a\\s+muerto'), 'habría fallecido'],
  [buildEsBoundaryRegex('hayan\\s+muerto'), 'hayan fallecido'],
  [buildEsBoundaryRegex('haya\\s+muerto'), 'haya fallecido'],
  [buildEsBoundaryRegex('haber\\s+muerto'), 'haber fallecido'],
  [buildEsBoundaryRegex('por\\s+muerto'), 'por fallecido'],
  [buildEsBoundaryRegex('por\\s+muerta'), 'por fallecida'],
  [buildEsBoundaryRegex('por\\s+muertos'), 'por fallecidos'],
  [buildEsBoundaryRegex('por\\s+muertas'), 'por fallecidas'],
  [buildEsBoundaryRegex('los\\s+muertos'), 'los fallecidos'],
  [buildEsBoundaryRegex('las\\s+muertas'), 'las fallecidas'],
  [buildEsBoundaryRegex('un\\s+muerto'), 'un fallecido'],
  [buildEsBoundaryRegex('una\\s+muerta'), 'una fallecida'],
  [buildEsBoundaryRegex('unos\\s+muertos'), 'unos fallecidos'],
  [buildEsBoundaryRegex('unas\\s+muertas'), 'unas fallecidas'],
  [buildEsBoundaryRegex('muchos\\s+muertos'), 'muchos fallecidos'],
  [buildEsBoundaryRegex('muchas\\s+muertas'), 'muchas fallecidas'],
  [buildEsBoundaryRegex('varios\\s+muertos'), 'varios fallecidos'],
  [buildEsBoundaryRegex('pocos\\s+muertos'), 'pocos fallecidos'],
  [buildEsBoundaryRegex('tantos\\s+muertos'), 'tantos fallecidos'],
  [buildEsBoundaryRegex('cu[aá]ntos\\s+muertos'), 'cuántos fallecidos'],
  [buildEsBoundaryRegex('otros\\s+muertos'), 'otros fallecidos'],
  [buildEsBoundaryRegex('sus\\s+muertos'), 'sus caídos'],
  [buildEsBoundaryRegex('nuestros\\s+muertos'), 'nuestros caídos'],
  [buildEsBoundaryRegex('de\\s+muertos'), 'de fallecidos'],
  [buildEsBoundaryRegex('mil\\s+muertos'), 'mil fallecidos'],
  [buildEsBoundaryRegex('millones\\s+de\\s+muertos'), 'millones de fallecidos'],
  [buildEsBoundaryRegex('peso\\s+muerto'), 'peso inerte'],
  [buildEsBoundaryRegex('punto\\s+muerto'), 'punto estancado'],
  [buildEsBoundaryRegex('letra\\s+muerta'), 'letra olvidada'],
  [buildEsBoundaryRegex('muerto'), 'sin vida'],
  [buildEsBoundaryRegex('muerta'), 'sin vida'],
  [buildEsBoundaryRegex('muertos'), 'sin vida'],
  [buildEsBoundaryRegex('muertas'), 'sin vida'],

  // --- Verbo "morir" y todas sus conjugaciones ---
  [buildEsBoundaryRegex('se\\s+murieron'), 'perdieron la vida'],
  [buildEsBoundaryRegex('se\\s+muri[oó]'), 'perdió la vida'],
  [buildEsBoundaryRegex('se\\s+mueren'), 'pierden la vida'],
  [buildEsBoundaryRegex('se\\s+muere'), 'pierde la vida'],
  [buildEsBoundaryRegex('se\\s+mor[ií]an'), 'perdían la vida'],
  [buildEsBoundaryRegex('se\\s+mor[ií]a'), 'perdía la vida'],
  [buildEsBoundaryRegex('morirse'), 'perder la vida'],
  [buildEsBoundaryRegex('muri[eé]ndose'), 'apagándose'],
  [buildEsBoundaryRegex('morir\\s+de'), 'perecer de'],
  [buildEsBoundaryRegex('muri[oó]\\s+de'), 'falleció de'],
  [buildEsBoundaryRegex('murieron\\s+de'), 'fallecieron de'],
  [buildEsBoundaryRegex('morir'), 'perder la vida'],
  [buildEsBoundaryRegex('muriendo'), 'perdiendo la vida'],
  [buildEsBoundaryRegex('murieron'), 'perdieron la vida'],
  [buildEsBoundaryRegex('muri[oó]'), 'perdió la vida'],
  [buildEsBoundaryRegex('mueren'), 'pierden la vida'],
  [buildEsBoundaryRegex('muere'), 'pierde la vida'],
  [buildEsBoundaryRegex('mueres'), 'pierdes la vida'],
  [buildEsBoundaryRegex('muero'), 'pierdo la vida'],
  [buildEsBoundaryRegex('morimos'), 'perdemos la vida'],
  [buildEsBoundaryRegex('mor[ií]an'), 'perdían la vida'],
  [buildEsBoundaryRegex('mor[ií]amos'), 'perdíamos la vida'],
  [buildEsBoundaryRegex('mor[ií]a'), 'perdía la vida'],
  [buildEsBoundaryRegex('morir[aá]n'), 'perderán la vida'],
  [buildEsBoundaryRegex('morir[aá]'), 'perderá la vida'],
  [buildEsBoundaryRegex('morir[eé]'), 'perderé la vida'],
  [buildEsBoundaryRegex('morir[ií]an'), 'perderían la vida'],
  [buildEsBoundaryRegex('morir[ií]a'), 'perdería la vida'],
  [buildEsBoundaryRegex('mueran'), 'perezcan'],
  [buildEsBoundaryRegex('muera'), 'perezca'],
  [buildEsBoundaryRegex('murieran'), 'perecieran'],
  [buildEsBoundaryRegex('muriesen'), 'perecieran'],
  [buildEsBoundaryRegex('muriera'), 'pereciera'],
  [buildEsBoundaryRegex('muriese'), 'pereciera'],

  // --- Derivados adjetivales/nominales de "muerte": mortal, mortífero, mortandad, moribundo, cadáver ---
  [buildEsBoundaryRegex('restos\\s+mortales'), 'restos humanos'],
  [buildEsBoundaryRegex('pecados\\s+mortales'), 'pecados capitales'],
  [buildEsBoundaryRegex('pecado\\s+mortal'), 'pecado capital'],
  [buildEsBoundaryRegex('enemigos\\s+mortales'), 'enemigos acérrimos'],
  [buildEsBoundaryRegex('enemigo\\s+mortal'), 'enemigo acérrimo'],
  [buildEsBoundaryRegex('simples\\s+mortales'), 'simples humanos'],
  [buildEsBoundaryRegex('los\\s+mortales'), 'los seres humanos'],
  [buildEsBoundaryRegex('mortales'), 'letales'],
  [buildEsBoundaryRegex('mortal'), 'letal'],
  [buildEsBoundaryRegex('mortalidad'), 'letalidad'],
  [buildEsBoundaryRegex('mortandad'), 'devastación humana'],
  [buildEsBoundaryRegex('mort[ií]feros'), 'fulminantes'],
  [buildEsBoundaryRegex('mort[ií]feras'), 'fulminantes'],
  [buildEsBoundaryRegex('mort[ií]fero'), 'fulminante'],
  [buildEsBoundaryRegex('mort[ií]fera'), 'fulminante'],
  [buildEsBoundaryRegex('moribundos'), 'agonizantes'],
  [buildEsBoundaryRegex('moribundas'), 'agonizantes'],
  [buildEsBoundaryRegex('moribundo'), 'agonizante'],
  [buildEsBoundaryRegex('moribunda'), 'agonizante'],
  [buildEsBoundaryRegex('cad[aá]veres'), 'cuerpos sin vida'],
  [buildEsBoundaryRegex('cad[aá]ver'), 'cuerpo sin vida'],

  // --- Familia "asesino / asesinar / asesinato" y derivados ---
  [buildEsBoundaryRegex('asesinos\\s+en\\s+serie'), 'criminales en serie'],
  [buildEsBoundaryRegex('asesinas\\s+en\\s+serie'), 'criminales en serie'],
  [buildEsBoundaryRegex('asesino\\s+en\\s+serie'), 'criminal en serie'],
  [buildEsBoundaryRegex('asesina\\s+en\\s+serie'), 'criminal en serie'],
  [buildEsBoundaryRegex('asesinos\\s+a\\s+sueldo'), 'atacantes a sueldo'],
  [buildEsBoundaryRegex('asesino\\s+a\\s+sueldo'), 'atacante a sueldo'],
  [buildEsBoundaryRegex('intentos\\s+de\\s+asesinato'), 'intentos de atentado'],
  [buildEsBoundaryRegex('intento\\s+de\\s+asesinato'), 'intento de atentado'],
  [buildEsBoundaryRegex('acusados\\s+de\\s+asesinato'), 'acusados del crimen'],
  [buildEsBoundaryRegex('acusadas\\s+de\\s+asesinato'), 'acusadas del crimen'],
  [buildEsBoundaryRegex('acusado\\s+de\\s+asesinato'), 'acusado del crimen'],
  [buildEsBoundaryRegex('acusada\\s+de\\s+asesinato'), 'acusada del crimen'],
  [buildEsBoundaryRegex('culpables\\s+de\\s+asesinato'), 'culpables del crimen'],
  [buildEsBoundaryRegex('culpable\\s+de\\s+asesinato'), 'culpable del crimen'],
  [buildEsBoundaryRegex('asesinatos'), 'crímenes'],
  [buildEsBoundaryRegex('asesinato'), 'crimen'],
  [buildEsBoundaryRegex('asesinados'), 'abatidos'],
  [buildEsBoundaryRegex('asesinadas'), 'abatidas'],
  [buildEsBoundaryRegex('asesinado'), 'abatido'],
  [buildEsBoundaryRegex('asesinada'), 'abatida'],
  [buildEsBoundaryRegex('asesinarlos'), 'quitarles la vida'],
  [buildEsBoundaryRegex('asesinarlas'), 'quitarles la vida'],
  [buildEsBoundaryRegex('asesinarlo'), 'quitarle la vida'],
  [buildEsBoundaryRegex('asesinarla'), 'quitarle la vida'],
  [buildEsBoundaryRegex('asesinarme'), 'quitarme la vida'],
  [buildEsBoundaryRegex('asesinarte'), 'quitarte la vida'],
  [buildEsBoundaryRegex('asesinarnos'), 'quitarnos la vida'],
  [buildEsBoundaryRegex('asesin[aá]ndolos'), 'quitándoles la vida'],
  [buildEsBoundaryRegex('asesin[aá]ndolas'), 'quitándoles la vida'],
  [buildEsBoundaryRegex('asesin[aá]ndolo'), 'quitándole la vida'],
  [buildEsBoundaryRegex('asesin[aá]ndola'), 'quitándole la vida'],
  [buildEsBoundaryRegex('(?:lo|la)\\s+asesinaron'), 'le quitaron la vida'],
  [buildEsBoundaryRegex('(?:los|las)\\s+asesinaron'), 'les quitaron la vida'],
  [buildEsBoundaryRegex('(?:lo|la)\\s+asesin[oó]'), 'le quitó la vida'],
  [buildEsBoundaryRegex('(?:los|las)\\s+asesin[oó]'), 'les quitó la vida'],
  [buildEsBoundaryRegex('(?:lo|la)\\s+asesinan'), 'le quitan la vida'],
  [buildEsBoundaryRegex('(?:los|las)\\s+asesinan'), 'les quitan la vida'],
  [buildEsBoundaryRegex('(?:lo|la)\\s+asesina'), 'le quita la vida'],
  [buildEsBoundaryRegex('(?:los|las)\\s+asesina'), 'les quita la vida'],
  [buildEsBoundaryRegex('(?:lo|la)\\s+asesinaran'), 'le quitaran la vida'],
  [buildEsBoundaryRegex('(?:lo|la)\\s+asesinara'), 'le quitara la vida'],
  [buildEsBoundaryRegex('(?:lo|la)\\s+asesinarán'), 'le quitarán la vida'],
  [buildEsBoundaryRegex('(?:lo|la)\\s+asesinará'), 'le quitará la vida'],
  [buildEsBoundaryRegex('(?:los|las)\\s+asesinarán'), 'les quitarán la vida'],
  [buildEsBoundaryRegex('(?:los|las)\\s+asesinará'), 'les quitará la vida'],
  [buildEsBoundaryRegex('asesinando'), 'quitando la vida'],
  [buildEsBoundaryRegex('asesinar'), 'quitar la vida'],
  [buildEsBoundaryRegex('asesinaron'), 'quitaron la vida'],
  [buildEsBoundaryRegex('asesinó'), 'quitó la vida'],
  [buildEsBoundaryRegex('asesino\\s+a\\b'), 'quitó la vida a'],
  [buildEsBoundaryRegex('asesino\\s+al\\b'), 'quitó la vida al'],
  [buildEsBoundaryRegex('asesinaban'), 'quitaban la vida'],
  [buildEsBoundaryRegex('asesinaba'), 'quitaba la vida'],
  [buildEsBoundaryRegex('asesinarán'), 'quitarán la vida'],
  [buildEsBoundaryRegex('asesinará'), 'quitará la vida'],
  [buildEsBoundaryRegex('asesinar[ií]an'), 'quitarían la vida'],
  [buildEsBoundaryRegex('asesinar[ií]a'), 'quitaría la vida'],
  [buildEsBoundaryRegex('asesinaran'), 'quitaran la vida'],
  [buildEsBoundaryRegex('asesinasen'), 'quitaran la vida'],
  [buildEsBoundaryRegex('asesinara'), 'quitara la vida'],
  [buildEsBoundaryRegex('asesinase'), 'quitara la vida'],
  [buildEsBoundaryRegex('asesinan'), 'quitan la vida'],
  [buildEsBoundaryRegex('asesinen'), 'quiten la vida'],
  [buildEsBoundaryRegex('asesine'), 'quite la vida'],
  [buildEsBoundaryRegex('asesina\\s+a\\b'), 'quita la vida a'],
  [buildEsBoundaryRegex('asesina\\s+al\\b'), 'quita la vida al'],
  [buildEsBoundaryRegex('instinto\\s+asesino'), 'instinto letal'],
  [buildEsBoundaryRegex('mano\\s+asesina'), 'mano letal'],
  [buildEsBoundaryRegex('mente\\s+asesina'), 'mente criminal'],
  [buildEsBoundaryRegex('furia\\s+asesina'), 'furia letal'],
  [buildEsBoundaryRegex('arma\\s+asesina'), 'arma letal'],
  [buildEsBoundaryRegex('armas\\s+asesinas'), 'armas letales'],
  [buildEsBoundaryRegex('manos\\s+asesinas'), 'manos letales'],
  [buildEsBoundaryRegex('olas\\s+asesinas'), 'olas letales'],
  [buildEsBoundaryRegex('ola\\s+asesina'), 'ola letal'],
  [buildEsBoundaryRegex('las\\s+asesinas'), 'las perpetradoras'],
  [buildEsBoundaryRegex('unas\\s+asesinas'), 'unas perpetradoras'],
  [buildEsBoundaryRegex('asesinos'), 'perpetradores'],
  [buildEsBoundaryRegex('asesino'), 'perpetrador'],
  [buildEsBoundaryRegex('asesinas'), 'letales'],
  [buildEsBoundaryRegex('asesina'), 'perpetradora'],

  // --- Sinónimos directos de desmonetización ("matar", "homicidio", "matanza", "suicidio") ---
  [buildEsBoundaryRegex('homicidios'), 'crímenes'],
  [buildEsBoundaryRegex('homicidio'), 'crimen'],
  [buildEsBoundaryRegex('homicidas'), 'criminales'],
  [buildEsBoundaryRegex('homicida'), 'criminal'],
  [buildEsBoundaryRegex('matanzas'), 'tragedias colectivas'],
  [buildEsBoundaryRegex('matanza'), 'tragedia colectiva'],
  [buildEsBoundaryRegex('matarlos'), 'quitarles la vida'],
  [buildEsBoundaryRegex('matarlas'), 'quitarles la vida'],
  [buildEsBoundaryRegex('matarlo'), 'quitarle la vida'],
  [buildEsBoundaryRegex('matarla'), 'quitarle la vida'],
  [buildEsBoundaryRegex('matarme'), 'quitarme la vida'],
  [buildEsBoundaryRegex('matarte'), 'quitarte la vida'],
  [buildEsBoundaryRegex('matarnos'), 'quitarnos la vida'],
  [buildEsBoundaryRegex('(?:lo|la)\\s+mataron'), 'le quitaron la vida'],
  [buildEsBoundaryRegex('(?:los|las)\\s+mataron'), 'les quitaron la vida'],
  [buildEsBoundaryRegex('(?:lo|la)\\s+mató'), 'le quitó la vida'],
  [buildEsBoundaryRegex('(?:los|las)\\s+mató'), 'les quitó la vida'],
  [buildEsBoundaryRegex('(?:lo|la)\\s+matarán'), 'le quitarán la vida'],
  [buildEsBoundaryRegex('(?:lo|la)\\s+matará'), 'le quitará la vida'],
  [buildEsBoundaryRegex('(?:lo|la)\\s+mataran'), 'le quitaran la vida'],
  [buildEsBoundaryRegex('(?:lo|la)\\s+matara'), 'le quitara la vida'],
  [buildEsBoundaryRegex('matar'), 'quitar la vida'],
  [buildEsBoundaryRegex('matando'), 'quitando la vida'],
  [buildEsBoundaryRegex('mataron'), 'quitaron la vida'],
  [buildEsBoundaryRegex('mató'), 'quitó la vida'],
  [buildEsBoundaryRegex('mato\\s+a\\b'), 'quitó la vida a'],
  [buildEsBoundaryRegex('mato\\s+al\\b'), 'quitó la vida al'],
  [buildEsBoundaryRegex('mataban'), 'quitaban la vida'],
  [buildEsBoundaryRegex('matarán'), 'quitarán la vida'],
  [buildEsBoundaryRegex('matará'), 'quitará la vida'],
  [buildEsBoundaryRegex('matar[ií]an'), 'quitarían la vida'],
  [buildEsBoundaryRegex('matar[ií]a'), 'quitaría la vida'],
  [buildEsBoundaryRegex('mataran'), 'quitaran la vida'],
  [buildEsBoundaryRegex('matasen'), 'quitaran la vida'],
  [buildEsBoundaryRegex('matara'), 'quitara la vida'],
  [buildEsBoundaryRegex('matase'), 'quitara la vida'],
  [buildEsBoundaryRegex('mata\\s+a\\b'), 'quita la vida a'],
  [buildEsBoundaryRegex('mata\\s+al\\b'), 'quita la vida al'],
  [buildEsBoundaryRegex('matan\\s+a\\b'), 'quitan la vida a'],
  [buildEsBoundaryRegex('matan\\s+al\\b'), 'quitan la vida al'],
  [buildEsBoundaryRegex('se\\s+suicidaron'), 'pusieron fin a sus días'],
  [buildEsBoundaryRegex('se\\s+suicid[oó]'), 'puso fin a sus días'],
  [buildEsBoundaryRegex('suicidarse'), 'poner fin a sus días'],
  [buildEsBoundaryRegex('suicidios'), 'finales trágicos'],
  [buildEsBoundaryRegex('suicidio'), 'final trágico'],
  [buildEsBoundaryRegex('misi[oó]n\\s+suicida'), 'misión sin retorno'],
  [buildEsBoundaryRegex('ataque\\s+suicida'), 'ataque sin retorno'],
  [buildEsBoundaryRegex('suicidas'), 'sin retorno'],
  [buildEsBoundaryRegex('suicida'), 'sin retorno'],
];

/**
 * Sanitizador léxico determinista de respaldo para próximos videos:
 * Sustituye cualquier aparición residual de "muerte", "asesino" y todos sus derivados
 * manteniendo concordancia gramatical, mayúsculas/minúsculas (ej. MINIATURAS EN MAYÚSCULAS),
 * etiquetas [pausa: Xs], identificadores @Personaje_Con_Guiones y #Hashtags en CamelCase.
 */
export function sanitizeBrandSafeEditorialText(rawText: string): string {
  if (!rawText || typeof rawText !== 'string') return rawText || '';
  let out = rawText;

  // 1. Limpiar #Hashtags en CamelCase sin romper la estructura de hashtag
  out = out.replace(/#([A-Za-zÁÉÍÓÚÜÑáéíóúüñ0-9]+)/g, (_full, body: string) => {
    const cleanedBody = body
      .replace(/Muertes?/gi, 'Tragedia')
      .replace(/Muert[oa]s?/gi, 'Caidos')
      .replace(/Morir|Murio|Murieron/gi, 'Destino')
      .replace(/Mortales?|Mortal/gi, 'Letal')
      .replace(/Asesinatos?/gi, 'Crimen')
      .replace(/Asesin[oa]s?/gi, 'Culpable')
      .replace(/Asesinar/gi, 'Conjura')
      .replace(/Homicidios?|Homicidas?/gi, 'Crimen')
      .replace(/Matanzas?/gi, 'Tragedia')
      .replace(/Suicidios?|Suicidas?/gi, 'Ocaso')
      .replace(/Cad[aá]ver(?:es)?/gi, 'Hallazgo');
    return `#${cleanedBody}`;
  });

  // 2. Aplicar reemplazos gramaticales respetando mayúsculas/minúsculas originales
  for (const [regex, replacement] of BRAND_SAFE_EDITORIAL_RULES) {
    out = out.replace(regex, (matched) => matchSpanishEditorialCase(matched, replacement));
  }

  return out;
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
  clipSec: number = 8
): string {
  if (!rawPrompt || !rawPrompt.trim()) return '';
  const shielded = applyAutomaticFlowPolicyShield(rawPrompt.trim(), false);
  if (isImagePrompt) {
    return sanitizeImagePromptForFlowSafety(shielded, undefined, undefined, {
      isStaticBroll: isImageOnlyBrollPrompt(shielded),
    });
  }
  return sanitizeVideoClipPromptForFlowSafety(shielded, undefined, undefined, {
    durationSec: clipSec,
  });
}

export interface SanitizePersonNamesOptions {
  mode?: 'image' | 'video';
  references?: ReferenceAsset[];
  docContextText?: string;
}

export interface SanitizeFlowPromptOptions {
  isStaticBroll?: boolean;
  clipNumber?: number;
  durationSec?: number;
}

export const LOCATION_DESCRIPTOR_MAP: Record<string, string> = {
  '@Escuela_Dunn_Oxford': 'a 1941 red-brick Oxford pathology laboratory',
  '@Enfermeria_Radcliffe':
    'a 1940s clinical brick ward with white enameled iron fixtures and tall sash windows',
  '@Laboratorio_Peoria':
    'a 1940s Midwestern agricultural botanical processing facility with industrial glass and steel vats',
  '@Laboratorio_St_Mary': 'a 1928 vintage London stone botanical research laboratory',
  '@Mesa_Historiador':
    'a warm 1940s mahogany archival study lined with towering oak bookshelves',
  '@Sala_Medica_Londres': 'a 1940s wood-paneled London academic lecture hall',
  '@Planta_Pfizer_Brooklyn':
    'a 1944 Brooklyn industrial processing plant with towering steel tanks',
  '@Playas_Normandia_1944':
    'a 1944 overcast Normandy coastal shore with canvas field pavilions',
  '@Boticas_Hospitales_Latam':
    'a 1940s sunlit Latin American wood-and-glass neighborhood apothecary',
  '@Salon_Nobel_Estocolmo':
    'a 1945 grand Stockholm concert hall with gilded classical architecture and velvet drapery',
};

const NORMALIZED_LOCATION_DESCRIPTOR_MAP: Record<string, string> = Object.fromEntries(
  Object.entries(LOCATION_DESCRIPTOR_MAP).map(([k, v]) => [
    k
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .toLowerCase(),
    v,
  ])
);

export function resolveLocationDescriptorFromTag(
  rawTag: string,
  ref?: ReferenceAsset
): string {
  const cleanTag = String(rawTag || '').trim();
  const atTag = cleanTag.startsWith('@') ? cleanTag : `@${cleanTag}`;
  if (LOCATION_DESCRIPTOR_MAP[atTag]) {
    return LOCATION_DESCRIPTOR_MAP[atTag];
  }
  const normKey = atTag
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase();
  if (NORMALIZED_LOCATION_DESCRIPTOR_MAP[normKey]) {
    return NORMALIZED_LOCATION_DESCRIPTOR_MAP[normKey];
  }
  const rawVisual = String(ref?.prompt || (ref as any)?.visualPrompt || '').trim();
  if (rawVisual) {
    // 6-view reference sheets ("...reference sheet (6 distinct views ... of the exact same historical location ...),
    // depicting X, ...") describe the place only after "depicting": never take the sheet template as the place
    const depictingIdx = rawVisual.search(/\),\s*depicting\s+/i);
    const visualBody =
      depictingIdx >= 0 ? rawVisual.slice(depictingIdx).replace(/^\),\s*depicting\s+/i, '') : rawVisual;
    const firstClause = visualBody
      .replace(/@[A-Za-z0-9_ÁÉÍÓÚáéíóúÜüÑñ-]+/g, '')
      .replace(/^(?:Create\s+an\s+image[^,]*?(?:of|showing|depicting)\s+)/i, '')
      .split(depictingIdx >= 0 ? /[.;,:]/ : /[.;]/)[0]
      .replace(/\bhistorian(?:'s|s)?\b/gi, 'archival')
      .replace(/\bhospital\b/gi, 'vintage stone')
      .replace(/\bfermentation\b/gi, 'botanical processing')
      .replace(/\bbacteriolog(?:y|ical)\b/gi, 'botanical')
      .replace(/\s{2,}/g, ' ')
      .trim();
    if (
      firstClause.length >= 8 &&
      firstClause.length <= 120 &&
      !/reference\s+sheet|exact\s+same|distinct\s+views|\d+%/i.test(firstClause)
    ) {
      return /^(?:a|an|the)\b/i.test(firstClause) ? firstClause : `a ${firstClause}`;
    }
  }
  // No curated description: the tag's own words are the place name ("@Gran_Salon_del_Louvre" → "the Gran Salon del
  // Louvre"); a trailing year ("@Alkaline_Lake_Texcoco_1325") is dropped because the prompt already dates the scene
  const placeWords = atTag
    .slice(1)
    .replace(/_/g, ' ')
    .replace(/(?:\s+\d{3,4}){1,2}\s*$/, '')
    .replace(/\s+/g, ' ')
    .trim();
  return placeWords ? `the ${placeWords}` : 'the historical period setting';
}

// English/Spanish nouns that make a reference tag a PLACE ("@Alkaline_Lake_Texcoco_1325", "@Cutzamala_Pumping_Station_2026")
// unless the tag also names a person's role ("@Mexica_Lake_Warrior_1325")
const AT_TAG_EXTRA_PLACE_WORD_RE =
  /(?:^@|_)(?:Lake|Lakes|Lagoon|Canal|Canals|Chinampas?|Dike|Dyke|Dam|Aqueduct|Tunnel|Drainage|City|Center|Centre|Downtown|Station|Valley|Basin|Causeway|Temple|Pyramid|Island|Islet|Swamp|Marsh|Reservoir|Desert|Forest|Jungle|Mountain|Mountains|Volcano|Coast|Beach|Bay|Port|Mine|Market|Field|Fields|Village|Town|Ruins|Road|Avenue|Canyon|Cave|Spring|Springs|Lago|Laguna|Canales|Dique|Acueducto|T[uú]nel|Desag[uü]e|Centro|Valle|Cuenca|Calzada|Templo|Pir[aá]mide|Isla|Islote|Pantano|Presa|Bosque|Selva|Monta[nñ]a|Volc[aá]n|Costa|Playa|Bah[ií]a|Mina|Pueblo|Ruinas|Camino|Avenida|Cueva|Manantial)(?:_|$)/i;
const AT_TAG_PERSON_ROLE_WORD_RE =
  /(?:^@|_)(?:Warrior|Farmer|Architect|Ruler|Emperor|King|Queen|Prince|Princess|Lord|Lady|Noble|Commander|Soldier|Captain|General|Officer|Guard|Sailor|Cosmographer|Engineer|Explorer|Naturalist|Scientist|Hydrologist|Geologist|Scout|Priest|Priestess|Monk|Nun|Merchant|Vendor|Trader|Worker|Laborer|Builder|Fisherman|Chronicler|Scribe|Doctor|Physician|Healer|Man|Woman|Boy|Girl|Child|Elder|Mother|Father|Guerrero|Campesino|Arquitecto|Gobernante|Emperador|Rey|Reina|Soldado|Capit[aá]n|Ingeniero|Explorador|Sacerdote|Comerciante|Vendedor|Obrero|Pescador|Cronista|M[eé]dico|Hombre|Mujer|Ni[nñ]o|Ni[nñ]a|Anciano|Anciana)(?:_|$)/i;

function isPlaceLikeAtTag(atTag: string): boolean {
  if (AT_TAG_PLACE_WORD_RE.test(atTag)) return true;
  return AT_TAG_EXTRA_PLACE_WORD_RE.test(atTag) && !AT_TAG_PERSON_ROLE_WORD_RE.test(atTag);
}

// A tag that contains a place noun anywhere ("@Gran_Salon_del_Louvre", "@Fortaleza_Real") names a location, not a person
const AT_TAG_PLACE_WORD_RE =
  /(?:^@|_)(?:Sal[oó]n|Sala|Torre|Fortaleza|Castillo|Jard[ií]n|Jardines|C[aá]mara|Catedral|Palacio|Plaza|Puerto|Muelle|Calle|Iglesia|Abad[ií]a|Monasterio|Museo|Teatro|Universidad|Biblioteca|Mercado|Taller|Bodega|Cocina|Patio|Capilla|Cripta|Puente|R[ií]o|Villa|Ciudad|Muralla|Foso|Hall|Tower|Castle|Fortress|Garden|Gardens|Chamber|Cathedral|Palace|Square|Harbor|Street|Church|Abbey|Kitchen|Courtyard|Chapel|Crypt|Bridge|River|Moat)(?:_|$)/i;

interface CuratedPersonProfile {
  core: string;
  role: string;
  article: 'a' | 'an' | 'the';
  videoDesc: string;
  isAnonymousRole?: boolean;
}

const CURATED_FLOW_PERSON_PROFILES: Record<string, CuratedPersonProfile> = {
  '@Charles_Fletcher': {
    core: 'young British clinical physician in a white cotton clinical coat',
    role: 'young British clinical physician',
    article: 'the',
    videoDesc: 'the young British physician in the white coat',
  },
  '@Albert_Alexander': {
    core: 'British reserve police constable in a vintage off-white linen clinical gown',
    role: 'British reserve police constable',
    article: 'the',
    videoDesc: 'the resting man in the linen shirt',
  },
  '@Alexander_Fleming': {
    core: 'silver-haired Scottish botanical research scientist in a white lab coat over a gray wool suit',
    role: 'silver-haired Scottish botanical research scientist',
    article: 'the',
    videoDesc: 'the silver-haired Scottish scientist in the white lab coat',
  },
  '@Almroth_Wright': {
    core: 'elderly silver-haired British medical institute director in a formal black wool frock coat',
    role: 'elderly silver-haired British institute director',
    article: 'the',
    videoDesc: 'the elderly silver-haired institute director in the dark frock coat',
  },
  '@Howard_Florey': {
    core: 'bespectacled Australian pathology professor in a white lab coat over a tweed waistcoat',
    role: 'bespectacled senior pathology professor',
    article: 'the',
    videoDesc: 'the bespectacled senior professor in the tweed suit',
  },
  '@Ernst_Chain': {
    core: 'dark-haired Central European biochemist with a thick dark mustache in a white lab coat',
    role: 'dark-haired Central European biochemist',
    article: 'the',
    videoDesc: 'the dark-haired biochemist in the white lab coat',
  },
  '@Norman_Heatley': {
    core: 'tall British experimental biochemist in a heather-brown sweater beneath a white lab coat',
    role: 'tall British experimental biochemist',
    article: 'the',
    videoDesc: 'the tall British researcher in the laboratory coat',
  },
  '@Ruth_Callow': {
    core: 'young British female laboratory technician in a tied white linen cap and white lab coat',
    role: 'young British female laboratory technician',
    article: 'the',
    videoDesc: 'the female laboratory researcher in the white coat',
  },
  '@Andrew_Moyer': {
    core: 'American agricultural mycologist in round metal-rimmed spectacles and a crisp white lab coat',
    role: 'American agricultural mycologist',
    article: 'the',
    videoDesc: 'the American laboratory scientist in the white coat',
  },
  '@Mary_Hunt': {
    core: 'young American female botanical research assistant with pinned wavy brown hair in a 1940s blouse',
    role: 'female botanical research assistant',
    article: 'the',
    videoDesc: 'the female research specialist in the vintage 1940s coat',
  },
  '@Salvador_Mazza': {
    core: 'Argentine clinical research scientist in round tortoiseshell glasses and a buttoned white lab coat',
    role: 'Argentine clinical research scientist',
    article: 'the',
    videoDesc: 'the Argentine research physician in the white coat',
  },
  '@Historiador_Antiguo': {
    core: 'senior documentary historian in an olive-brown tweed jacket',
    role: 'senior documentary historian',
    article: 'the',
    videoDesc: 'the senior historian in the olive-brown tweed jacket',
    isAnonymousRole: true,
  },
  '@Ricardo_Ruiz_Balbin': {
    core: 'adult Spanish Asturian farmer in a black wool beret and dark ribbed corduroy jacket',
    role: 'adult Spanish farmer',
    article: 'an',
    videoDesc: 'the adult Spanish farmer in the wool beret',
  },
  '@Frank_Menocal': {
    core: 'stern quarantine physician with a trimmed mustache and wire-rimmed glasses in a white linen uniform',
    role: 'quarantine physician',
    article: 'the',
    videoDesc: 'the stern quarantine physician in the white linen uniform',
  },
  '@Pedro_Garfias_Zurita': {
    core: '38-year-old Spanish exiled poet in thick tortoiseshell glasses, a black beret, and a worn shepherd jacket',
    role: 'Spanish exiled poet',
    article: 'the',
    videoDesc: 'the 38-year-old Spanish poet in thick glasses and a black beret',
  },
};

const CURATED_FLOW_VIDEO_TAG_DESC: Record<string, string> = {
  '@Charles_Fletcher': CURATED_FLOW_PERSON_PROFILES['@Charles_Fletcher'].videoDesc,
  '@Albert_Alexander': CURATED_FLOW_PERSON_PROFILES['@Albert_Alexander'].videoDesc,
  '@Alexander_Fleming': CURATED_FLOW_PERSON_PROFILES['@Alexander_Fleming'].videoDesc,
  '@Almroth_Wright': CURATED_FLOW_PERSON_PROFILES['@Almroth_Wright'].videoDesc,
  '@Howard_Florey': CURATED_FLOW_PERSON_PROFILES['@Howard_Florey'].videoDesc,
  '@Ernst_Chain': CURATED_FLOW_PERSON_PROFILES['@Ernst_Chain'].videoDesc,
  '@Norman_Heatley': CURATED_FLOW_PERSON_PROFILES['@Norman_Heatley'].videoDesc,
  '@Ruth_Callow': CURATED_FLOW_PERSON_PROFILES['@Ruth_Callow'].videoDesc,
  '@Andrew_Moyer': CURATED_FLOW_PERSON_PROFILES['@Andrew_Moyer'].videoDesc,
  '@Mary_Hunt': CURATED_FLOW_PERSON_PROFILES['@Mary_Hunt'].videoDesc,
  '@Salvador_Mazza': CURATED_FLOW_PERSON_PROFILES['@Salvador_Mazza'].videoDesc,
  '@Historiador_Antiguo': CURATED_FLOW_PERSON_PROFILES['@Historiador_Antiguo'].videoDesc,
  '@Enfermeria_Radcliffe': LOCATION_DESCRIPTOR_MAP['@Enfermeria_Radcliffe'],
  '@Laboratorio_St_Mary': LOCATION_DESCRIPTOR_MAP['@Laboratorio_St_Mary'],
  '@Escuela_Dunn_Oxford': LOCATION_DESCRIPTOR_MAP['@Escuela_Dunn_Oxford'],
  '@Mesa_Historiador': LOCATION_DESCRIPTOR_MAP['@Mesa_Historiador'],
  '@Sala_Medica_Londres': LOCATION_DESCRIPTOR_MAP['@Sala_Medica_Londres'],
  '@Laboratorio_Peoria': LOCATION_DESCRIPTOR_MAP['@Laboratorio_Peoria'],
  '@Planta_Pfizer_Brooklyn': LOCATION_DESCRIPTOR_MAP['@Planta_Pfizer_Brooklyn'],
  '@Playas_Normandia_1944': LOCATION_DESCRIPTOR_MAP['@Playas_Normandia_1944'],
  '@Boticas_Hospitales_Latam': LOCATION_DESCRIPTOR_MAP['@Boticas_Hospitales_Latam'],
  '@Salon_Nobel_Estocolmo': LOCATION_DESCRIPTOR_MAP['@Salon_Nobel_Estocolmo'],
};

const ANONYMOUS_ROLE_KEYWORDS = new Set([
  'actor',
  'actress',
  'adult',
  'adulto',
  'agent',
  'agricultural',
  'american',
  'ancient',
  'anonymous',
  'antiguo',
  'architect',
  'archivist',
  'argentine',
  'assistant',
  'asturian',
  'australian',
  'author',
  'bacteriological',
  'bacteriologist',
  'bacteriologo',
  'baker',
  'banker',
  'biochemist',
  'bishop',
  'blacksmith',
  'british',
  'campesino',
  'captain',
  'carpenter',
  'central',
  'character',
  'chemist',
  'chief',
  'cientifico',
  'clergyman',
  'clerk',
  'clinical',
  'clinician',
  'colonel',
  'commander',
  'commissioner',
  'composer',
  'constable',
  'contractor',
  'cuban',
  'delegate',
  'detective',
  'diplomat',
  'director',
  'doctor',
  'doctora',
  'documentary',
  'duchess',
  'duke',
  'elder',
  'elderly',
  'emigrant',
  'emigrante',
  'emperor',
  'empress',
  'engineer',
  'english',
  'entrepreneur',
  'european',
  'exile',
  'exiled',
  'experimental',
  'explorer',
  'farmer',
  'female',
  'figure',
  'fisherman',
  'founder',
  'french',
  'galician',
  'general',
  'german',
  'governor',
  'grocer',
  'guard',
  'historian',
  'historiador',
  'historical',
  'immigrant',
  'industrialist',
  'inspector',
  'institute',
  'inventor',
  'italian',
  'journalist',
  'judge',
  'king',
  'lab',
  'laboratory',
  'laborer',
  'lawyer',
  'lead',
  'leader',
  'lider',
  'male',
  'man',
  'medical',
  'medico',
  'merchant',
  'mexican',
  'microbiologist',
  'migrant',
  'minister',
  'monarch',
  'monk',
  'mother',
  'mycologist',
  'narrator',
  'narrador',
  'noble',
  'nobleman',
  'noblewoman',
  'notary',
  'nurse',
  'obrero',
  'officer',
  'old',
  'older',
  'operator',
  'oxford',
  'passenger',
  'pathologist',
  'pathology',
  'patient',
  'peasant',
  'person',
  'persona',
  'personaje',
  'pharmacist',
  'philosopher',
  'physician',
  'pilot',
  'pioneer',
  'poet',
  'poeta',
  'police',
  'politician',
  'president',
  'priest',
  'prince',
  'princess',
  'professor',
  'protagonist',
  'protagonista',
  'quarantine',
  'queen',
  'referencia',
  'refugee',
  'reporter',
  'research',
  'researcher',
  'reserve',
  'ruler',
  'rural',
  'sailor',
  'scholar',
  'scientist',
  'scottish',
  'senator',
  'senior',
  'shepherd',
  'soldier',
  'soldado',
  'sovereign',
  'spanish',
  'specialist',
  'statesman',
  'surgeon',
  'tailor',
  'technician',
  'traveler',
  'veteran',
  'villager',
  'weaver',
  'widow',
  'woman',
  'worker',
  'writer',
  'young',
]);

const ROLE_ONLY_SIGNAL_TOKENS = new Set([
  'actor',
  'actress',
  'archivist',
  'assistant',
  'author',
  'bacteriologist',
  'bacteriologo',
  'baker',
  'banker',
  'biochemist',
  'bishop',
  'blacksmith',
  'campesino',
  'captain',
  'carpenter',
  'character',
  'chemist',
  'cientifico',
  'clergyman',
  'clerk',
  'clinician',
  'colonel',
  'commander',
  'commissioner',
  'composer',
  'constable',
  'contractor',
  'delegate',
  'detective',
  'diplomat',
  'director',
  'doctor',
  'doctora',
  'duchess',
  'duke',
  'emigrant',
  'emigrante',
  'emperor',
  'empress',
  'engineer',
  'entrepreneur',
  'exile',
  'explorer',
  'farmer',
  'figure',
  'fisherman',
  'founder',
  'general',
  'governor',
  'grocer',
  'guard',
  'historian',
  'historiador',
  'immigrant',
  'industrialist',
  'inspector',
  'inventor',
  'journalist',
  'judge',
  'king',
  'laborer',
  'lawyer',
  'leader',
  'lider',
  'man',
  'medico',
  'merchant',
  'microbiologist',
  'migrant',
  'minister',
  'monarch',
  'monk',
  'mother',
  'mycologist',
  'narrador',
  'narrator',
  'nobleman',
  'noblewoman',
  'notary',
  'nurse',
  'obrero',
  'officer',
  'operator',
  'pathologist',
  'patient',
  'peasant',
  'person',
  'persona',
  'personaje',
  'pharmacist',
  'philosopher',
  'physician',
  'pilot',
  'pioneer',
  'poet',
  'poeta',
  'politician',
  'president',
  'priest',
  'prince',
  'princess',
  'professor',
  'protagonist',
  'protagonista',
  'queen',
  'referencia',
  'refugee',
  'reporter',
  'researcher',
  'ruler',
  'sailor',
  'scholar',
  'scientist',
  'senator',
  'shepherd',
  'soldier',
  'soldado',
  'sovereign',
  'specialist',
  'statesman',
  'surgeon',
  'tailor',
  'technician',
  'traveler',
  'veteran',
  'villager',
  'weaver',
  'widow',
  'woman',
  'worker',
  'writer',
]);

/**
 * Returns true ONLY when an @Reference tag is strictly an anonymous role/archetype handle
 * (e.g. @Historiador_Antiguo, @Scottish_Bacteriologist, @Young_Clinical_Physician)
 * with zero proper personal names/surnames.
 */
export function isAnonymousRoleReferenceTag(tag: string, ref?: ReferenceAsset): boolean {
  const raw = String(tag || '').trim();
  if (!raw) return false;
  if (ref?.category === 'lugar' || (ref as any)?.type === 'Lugar') return false;
  if (KNOWN_LOCATION_AT_TAG_PREFIX_RE.test(raw)) return false;

  const curated = CURATED_FLOW_PERSON_PROFILES[raw];
  if (curated && curated.isAnonymousRole !== true) return false;
  if (curated?.isAnonymousRole === true) return true;

  const clean = raw
    .replace(/^@+/, '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .trim();
  if (!clean) return false;

  const tokens = clean.split(/[_\s-]+/).filter(Boolean);
  if (tokens.length === 0) return false;

  let hasRoleWord = false;
  for (const tok of tokens) {
    if (/^\d{1,4}$/.test(tok)) continue;
    const low = tok.toLowerCase();
    if (!ANONYMOUS_ROLE_KEYWORDS.has(low)) {
      return false;
    }
    if (ROLE_ONLY_SIGNAL_TOKENS.has(low)) {
      hasRoleWord = true;
    }
  }
  return hasRoleWord;
}

const GEO_AND_CINEMA_SINGLE_WHITELIST = new Set([
  // Camera, framing, Flow & prompt boilerplate
  'create', 'image', 'clip', 'video', 'shot', 'wide', 'medium', 'close', 'closeup', 'macro',
  'extreme', 'overhead', 'angle', 'view', 'frame', 'framing', 'focus', 'shallow', 'depth', 'field',
  'golden', 'hour', 'blue', 'dawn', 'dusk', 'twilight', 'morning', 'afternoon', 'evening', 'night',
  'slow', 'smooth', 'steady', 'gentle', 'subtle', 'dolly', 'push', 'pull', 'pan', 'tilt', 'crane',
  'tracking', 'zoom', 'orbit', 'arc', 'slider', 'steadicam', 'fluid', 'head', 'motion', 'movement',
  'static', 'frozen', 'plate', 'broll', 'roll', 'cinematic', 'historical', 'documentary', 'realism',
  'photorealistic', 'lighting', 'chiaroscuro', 'grain', 'bokeh', 'ambient', 'foley', 'audio', 'sound',
  'strict', 'strictly', 'fixed', 'solid', 'sustained', 'single', 'continuous', 'unbroken', 'take',
  'adults', 'only', 'cast', 'literal', 'visual', 'logic', 'style', 'pure', 'calm', 'composed',
  'natural', 'human', 'acting', 'omni', 'flash', 'veo', 'lite', 'lower', 'priority', 'nano', 'banana',
  'model', 'duration', 'time', 'fix', 'name', 'warm', 'cold', 'cool', 'dark', 'bright', 'soft', 'hard',
  'high', 'low', 'first', 'second', 'third', 'final', 'opening', 'closing', 'inner', 'outer',
  // Calendar, eras, nationalities, institutions, eponyms
  'january', 'february', 'march', 'april', 'may', 'june', 'july', 'august', 'september', 'october',
  'november', 'december', 'christmas', 'easter', 'sunday', 'monday', 'tuesday', 'wednesday',
  'thursday', 'friday', 'saturday', 'victorian', 'georgian', 'edwardian', 'medieval', 'renaissance',
  'british', 'english', 'scottish', 'irish', 'welsh', 'spanish', 'french', 'german', 'italian',
  'american', 'mexican', 'cuban', 'argentine', 'latin', 'european', 'nordic', 'midwestern',
  'asturian', 'galician', 'andalusian', 'catalan', 'basque', 'canadian', 'australian', 'russian',
  'petri', 'bunsen', 'erlenmeyer', 'diesel', 'fahrenheit', 'celsius', 'kelvin', 'morse', 'nobel',
  'oxford', 'london', 'paddington', 'radcliffe', 'peoria', 'illinois', 'brooklyn', 'connecticut',
  'york', 'haven', 'boston', 'chicago', 'detroit', 'washington', 'philadelphia', 'california',
  'paris', 'berlin', 'vienna', 'madrid', 'barcelona', 'sevilla', 'cadiz', 'santander', 'asturias',
  'galicia', 'cantabria', 'coruna', 'vigo', 'gijon', 'tenerife', 'havana', 'habana', 'triscornia',
  'casablanca', 'cienfuegos', 'veracruz', 'mexico', 'puebla', 'buenos', 'aires', 'montevideo',
  'cuba', 'spain', 'england', 'britain', 'france', 'germany', 'italy', 'argentina', 'uruguay',
  'sweden', 'stockholm', 'normandy', 'normandia', 'atlantic', 'caribbean', 'cantabrian', 'pacific',
  'east', 'west', 'north', 'south', 'central', 'upper', 'lower', 'new', 'old', 'grand', 'royal',
  'pfizer', 'merck', 'sinaia', 'titanic', 'centro', 'asturiano', 'quinta', 'covadonga', 'benefica',
  'gallego', 'aguila', 'musel', 'ciego', 'avila', 'lue', 'colunga', 'maliano', 'hospital', 'mary',
  'church', 'cathedral', 'abbey', 'palace', 'castle', 'fortress', 'tower', 'bridge', 'harbor',
  'port', 'bay', 'river', 'sea', 'ocean', 'island', 'islands', 'street', 'avenue', 'square', 'plaza',
  'station', 'school', 'university', 'institute', 'laboratory', 'hall', 'room', 'ward', 'club',
  'company', 'compania', 'trasatlantica', 'guard', 'civil', 'rural', 'law', 'act', 'world', 'war',
  'wall', 'day', 'year', 'century', 'mr', 'mrs', 'ms', 'dr', 'st', 'san', 'santa', 'santo', 'saint',
]);

const PLACE_OR_ENTITY_SUFFIX_RE =
  /^(?:Street|Avenue|Boulevard|Road|Lane|Alley|Way|Plaza|Square|Park|Garden|Gardens|Bay|River|Sea|Ocean|Gulf|Strait|Channel|Lake|Valley|Mountain|Mountains|Hill|Hills|Island|Islands|Coast|Harbor|Harbour|Port|Dock|Pier|Bridge|Canal|Station|Terminal|Hospital|Clinic|Infirmary|Sanatorium|University|College|School|Institute|Academy|Laboratory|Lab|Hall|Chamber|Theater|Theatre|Opera|Museum|Library|Archive|Palace|Castle|Fort|Fortress|Citadel|Tower|Cathedral|Church|Chapel|Abbey|Monastery|Convent|Club|Hotel|Tavern|Cafe|Bakery|Factory|Plant|Mill|Mine|Bank|Exchange|Office|Ministry|Parliament|Senate|Court|Prison|Camp|Barracks|Guard|Law|Act|Treaty|Compa[nñ][ií]a|Centro|Quinta|War|Century|Day|Hour|Shot|Angle|View|Focus|Grain|Light|Motion|Pan|Dolly|Tilt|Crane|Zoom|Foley|Priority|Flash|Banana|Lite)$/i;

const KNOWN_HISTORICAL_NAME_PAIR_RE =
  /\b(?:Alexander\s+Fleming|Charles\s+Fletcher|Albert\s+Alexander|Howard\s+Florey|Ernst\s+Chain|Norman\s+Heatley|Almroth\s+Wright|Andrew\s+Moyer|Salvador\s+Mazza|Mary\s+Hunt|Ruth\s+Callow|Ricardo\s+Ruiz\s+Balb[ií]n|Bernarda\s+Ruiz\s+Balb[ií]n|Ruiz\s+Balb[ií]n|Frank\s+Menocal|Pedro\s+Garfias\s+Zurita|Pedro\s+Becerra|Jos[eé]\s+Linares|Indalecio\s+Rodr[ií]guez|Juan\s+(?:Domingo\s+)?Per[oó]n|Eva\s+Per[oó]n|Thomas\s+Edison|Henry\s+Ford|Enzo\s+Ferrari|Nikola\s+Tesla|Marie\s+Curie|Louis\s+Pasteur|Winston\s+Churchill|Franklin\s+Roosevelt|Abraham\s+Lincoln|Albert\s+Einstein|Guglielmo\s+Marconi)\b/gi;

function escapeRegexLiteral(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function extractAnonymousRoleFromReference(ref: ReferenceAsset): string {
  const tag = String(ref?.tag || '').trim();
  const curated = CURATED_FLOW_PERSON_PROFILES[tag] ||
    Object.entries(CURATED_FLOW_PERSON_PROFILES).find(([k]) => k.toLowerCase() === tag.toLowerCase())?.[1];
  if (curated) {
    return `${curated.article} ${curated.core}`;
  }
  const isPerson = ref.category === 'persona' || (ref as any).type === 'Persona';
  const promptText = String(ref.prompt || '');
  const depMatch = promptText.match(/,\s*depicting\s+(an?\s+[^,]{8,75}?)(?:,|\s+in\s+1\d{3}|\s+against\b)/i);
  if (depMatch?.[1]) {
    let role = depMatch[1]
      .replace(/\b(?:[1-9]\d?-year-old|aged\s+\d+)\s+/gi, '')
      .replace(/\s+/g, ' ')
      .trim();
    if (role && !/\b(?:Fleming|Florey|Heatley|Chain|Fletcher|Alexander|Moyer|Mazza|Wright|Callow|Hunt|Menocal|Garfias|Zurita|Balb[ií]n)\b/i.test(role)) {
      return /^an?\s+/i.test(role) ? `the ${role.replace(/^an?\s+/i, '')}` : role;
    }
  }
  return isPerson ? 'the adult historical figure in authentic period attire' : 'the historical period setting';
}

function extractProfileFromReference(ref: ReferenceAsset): CuratedPersonProfile {
  const tag = String(ref?.tag || '').trim();
  const atTag = tag.startsWith('@') ? tag : `@${tag}`;
  const curated =
    CURATED_FLOW_PERSON_PROFILES[atTag] ||
    Object.entries(CURATED_FLOW_PERSON_PROFILES).find(
      ([k]) => k.toLowerCase() === atTag.toLowerCase()
    )?.[1];
  if (curated) return curated;

  const isPerson = ref.category === 'persona' || (ref as any).type === 'Persona';
  if (!isPerson) {
    const placeName = atTag.replace(/^@+/, '').replace(/_/g, ' ').trim();
    return {
      core: placeName ? `${placeName} historical setting` : 'historical period setting',
      role: 'historical period setting',
      article: 'the',
      videoDesc: CURATED_FLOW_VIDEO_TAG_DESC[atTag] || 'the historical period setting',
    };
  }

  const rawPrompt = String(ref.prompt || '');
  const depMatch = rawPrompt.match(
    /(?:,\s*depicting|portrayed by an anonymous historical reenactment actor,)\s+(?:an?\s+)?([^,.]{8,110}?)(?:,|\s+against\b|\s+dressed\b|\s+8k\b)/i
  );
  let core = depMatch?.[1]
    ? depMatch[1]
        .replace(/^(?:the|an?)\s+/i, '')
        .replace(/\b(?:in\s+1\d{3}[^,]*)$/i, '')
        .replace(/\s+/g, ' ')
        .trim()
    : 'adult historical figure in authentic period attire';

  // Ensure any proper names from the reference tag itself are scrubbed from core
  const rawTagTokens = atTag
    .slice(1)
    .split(/[_\s-]+/)
    .filter((w) => w.length >= 3 && !ANONYMOUS_ROLE_KEYWORDS.has(w.toLowerCase()));
  for (const tok of rawTagTokens) {
    core = core.replace(new RegExp(`\\b${escapeRegexLiteral(tok)}\\b`, 'gi'), '');
  }
  core = core.replace(/\s{2,}/g, ' ').trim() || 'adult historical figure in authentic period attire';

  // Ensure core contains a noun recognized by humanSubjectRegex
  if (
    !/\b(man|woman|person|figure|actor|actress|physician|doctor|scientist|researcher|professor|director|poet|writer|farmer|soldier|worker|laborer|historian|specialist|constable|clerk|leader|politician)\b/i.test(
      core
    )
  ) {
    core = `adult historical figure (${core})`;
  }

  const role = core
    .replace(/\b\d{1,3}-year-old\s+/gi, '')
    .replace(/\s+(?:in|wearing|with)\s+[\s\S]*$/i, '')
    .trim() || 'adult historical figure';

  return {
    core,
    role,
    article: 'the',
    videoDesc: `the ${core.replace(/\b\d{1,3}-year-old\s+/gi, '').trim()}`,
    isAnonymousRole: isAnonymousRoleReferenceTag(atTag, ref),
  };
}

function stripLeakedSpanishNarrationTail(text: string): string {
  if (!text) return text;
  // Remove Spanish voiceover tails leaked after the final English closing clause
  return text.replace(
    /(\b(?:no\s+music,\s*no\s+speech,\s*no\s+text|no\s+speech,\s*no\s+text|no\s+text,\s*no\s+watermarks(?:,\s*no\s+speech,\s*no\s+music)?|anywhere\s+in\s+the\s+frame|through\s+the\s+final\s+frame)\.|(?:no\s+unintended\s+explosions\s+or\s+flashes|steady\s+continuous\s+lighting\s+with\s+zero\s+sudden\s+flashes)\)\.)(\s+(?:(?!\b(?:STRICT|SINGLE|Smooth|Fixed|Solid|All\s+furniture|Cinematic|Ambient\s+Foley|Audio|no\s+music,\s*no\s+speech)\b)[^[\]]){12,520})$/i,
    (full, anchor, tail) => {
      if (
        /[áéíóúñ¿¡]/i.test(tail) ||
        /\b(?:el|la|los|las|un|una|del|para|con|que|como|hacia|desde|entre|quien|mientras|despu[eé]s|hasta|se\s+encontraba|escribi[oó]|desembarc[oó]|arrib[oó]|lleg[oó]|campamento|pesetas|barco|carta|madre|padre|doctor|m[eé]dico|poeta|gastado|boina|chamarra|gafas|junto)\b/i.test(
          tail
        )
      ) {
        return anchor;
      }
      return full;
    }
  );
}

function extractContextPersonNames(docContextText?: string): string[] {
  if (!docContextText || !docContextText.trim()) return [];
  const names = new Set<string>();
  const cueRegex =
    /(?:el|la|al|del|por|con|junto\s+a|llamad[oa]|bautizad[oa]|doctor|doctora|profesor|profesora|general|presidente|presidenta|poeta|cient[ií]fic[oa]|bacteri[oó]log[oa]|investigador(?:a)?|cirujan[oa]|fundador(?:a)?|inventor(?:a)?|empresari[oa]|coronel|capit[aá]n|almirante|ministr[oa]|gobernador(?:a)?|madre|padre|hermano|hermana|esposo|esposa|don|doña|señor|señora)\s+([A-ZÁÉÍÓÚÑ][a-záéíóúñ]{2,}(?:\s+(?:de|del|la|y|[A-ZÁÉÍÓÚÑ][a-záéíóúñ]{2,})){1,2})/g;
  let m: RegExpExecArray | null;
  while ((m = cueRegex.exec(docContextText)) !== null) {
    const candidate = m[1].trim();
    const parts = candidate.split(/\s+/);
    if (parts.length < 2 || parts.length > 4) continue;
    // "Louvre y", "Museo del Louvre", "Gran Salón": a person's name has two capitalised words, does not end in a
    // connector and contains no place noun
    if (parts.filter((w) => /^[A-ZÁÉÍÓÚÑ]/.test(w)).length < 2) continue;
    if (/^(?:de|del|la|y)$/i.test(parts[parts.length - 1])) continue;
    if (parts.some((w) => AT_TAG_PLACE_WORD_RE.test(`@${w}`) || /^(?:Gran|Grande|Real|Reales|Santa|San|Nuestra|Notre|Dame)$/i.test(w))) continue;
    const allWhitelisted = parts.every((w) => {
      const clean = w.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
      return GEO_AND_CINEMA_SINGLE_WHITELIST.has(clean) || /^(de|del|la|y)$/i.test(clean);
    });
    if (!allWhitelisted && !PLACE_OR_ENTITY_SUFFIX_RE.test(parts[parts.length - 1])) {
      names.add(candidate);
    }
  }
  return Array.from(names);
}

function applyContextAwarePersonReplacement(
  text: string,
  pattern: RegExp,
  profile: CuratedPersonProfile,
  mode: 'image' | 'video'
): string {
  return text.replace(pattern, (fullMatch, ...args) => {
    const offset = args[args.length - 2] as number;
    const src = args[args.length - 1] as string;
    const hasPossessive = /['’]s$/i.test(fullMatch);
    const before = src.slice(Math.max(0, offset - 45), offset);
    const after = src.slice(offset + fullMatch.length, offset + fullMatch.length + 75);

    // If preceded by age or age+role (e.g. "28-year-old @Norman_Heatley", "60-year-old mycologist @Andrew_Moyer")
    const precededByAgeAndRole =
      /\b\d{1,3}-year-old\s+(?:assistant|mycologist|physician|doctor|scientist|professor|director|poet|historian|researcher|biochemist|technician|constable|clerk|farmer)\s+$/i.test(
        before
      );
    const precededByAgeOnly = /\b\d{1,3}-year-old\s+$/i.test(before);
    const precededByDeterminer =
      /\b(?:the|a|an|this|that|his|her|their|same|older|younger|elderly|senior)\s+$/i.test(before);
    const followedByClothingOrAge =
      /^\s*(?:at\s+age\s+\d+|in\s+(?:a|an|the|his|her|round|gold|silver|oval|dark|white|black|gray|brown|vintage|period|formal|tailored|buttoned|starched)\b|wearing\b)/i.test(
        after
      );
    const followedByApposition =
      /^(?:,\s*(?:an?|the)\s+\d{1,3}-year-old\b|\s*\(\s*\d{1,3}-year-old\b)/i.test(after);

    if (hasPossessive) {
      const base = precededByDeterminer ? profile.role : `the ${profile.role}`;
      return `${base}'s`;
    }

    if (mode === 'video') {
      if (precededByAgeOnly || precededByDeterminer) {
        return profile.role;
      }
      if (followedByApposition) {
        return precededByDeterminer ? 'adult historical subject' : 'the adult historical subject';
      }
      if (followedByClothingOrAge) {
        return `${profile.article} ${profile.role}`;
      }
      return profile.videoDesc;
    }

    if (precededByAgeAndRole) {
      // e.g. "60-year-old mycologist @Andrew_Moyer in..." -> avoid repeating the role word
      const cleaned = profile.role
        .replace(/\b(?:assistant|mycologist|physician|doctor|scientist|professor|director|poet|historian|researcher|biochemist|technician|constable|clerk|farmer)\b/gi, '')
        .replace(/\s{2,}/g, ' ')
        .trim();
      return cleaned ? `${cleaned} specialist` : 'specialist';
    }
    if (precededByAgeOnly) {
      return followedByClothingOrAge ? profile.role : profile.core;
    }
    if (followedByApposition) {
      // Next phrase already states ", a 43-year-old British reserve constable" or "(42-year-old...)"
      return precededByDeterminer ? 'adult historical subject' : 'the adult historical subject';
    }
    if (precededByDeterminer) {
      return followedByClothingOrAge ? profile.role : profile.core;
    }
    return followedByClothingOrAge
      ? `${profile.article} ${profile.role}`
      : `${profile.article} ${profile.core}`;
  });
}

/**
 * Unified, idempotent sanitizer that strips ALL proper person names, surnames, possessives,
 * @Person tags, AND @Location tags across BOTH image and video prompts (0 '@' symbols surviving).
 */
export function sanitizePromptRemovePersonNames(
  prompt: string,
  options: SanitizePersonNamesOptions = {}
): string {
  if (!prompt || !prompt.trim()) return prompt;
  const mode: 'image' | 'video' = options.mode === 'video' ? 'video' : 'image';
  const references = options.references;

  let p = prompt.trim();

  // Preserve leading "Image 01:" / "Clip 01 (00:00 - 00:08):" prefix
  let prefix = '';
  const prefixMatch = p.match(/^((?:Image|Imagen|Clip)\s+\d+(?:\s*\([^)]*\))?\s*:\s*)/i);
  if (prefixMatch) {
    prefix = prefixMatch[1];
    p = p.slice(prefix.length).trim();
  }

  // Preserve trailing control tags / fix the name if present
  let suffix = '';
  const suffixMatch = p.match(
    /((?:\s*\[(?:Time|B-Roll|Duration|Video\s+Model|Model|IMAGE\s+ONLY)(?:[^\[\]]|\[[^\]]*\])*\])+(?:\s*\(\s*100%\s*pure\s*ambient\s*foley[^)]*\)\.?)?(?:\s*fix\s+the\s+name(?:\s+to\s+@?[A-Za-z0-9_]+)?\.?)?|\s*fix\s+the\s+name(?:\s+to\s+@?[A-Za-z0-9_]+)?\.?(?:\s*\(\s*100%\s*pure\s*ambient\s*foley[^)]*\)\.?)?(?:\s*\[(?:Time|B-Roll|Duration|Video\s+Model|Model|IMAGE\s+ONLY)(?:[^\[\]]|\[[^\]]*\])*\])*)\s*$/i
  );
  if (suffixMatch) {
    suffix = ` ${suffixMatch[1].trim()}`;
    p = p.slice(0, p.length - suffixMatch[0].length).trim();
  }

  // 1. Cut any leaked Spanish narration tail in both modes
  p = stripLeakedSpanishNarrationTail(p);

  // 2. Repair legacy Video 76 regex corruption artifacts before applying clean replacements
  p = p
    .replace(
      /\bthe\s+period\s+historical\s+artifact(?=\s+(?:writing|wearing|standing|sitting|holding|walking|looking|speaking|signing|reading))/gi,
      'the adult historical figure'
    )
    .replace(
      /\b(ancient\s+coral-stone\s+fortress|blackened\s+coral-stone\s+walls)\s+of\s+an\s+elderly\s+historical\s+clergyman(?:[^,.]*,\s*portrayed\s+by\s+an\s+anonymous\s+actor)?/gi,
      '$1 of the historic coastal fortress'
    );

  // 3. Build unified person profile & location descriptor maps from references + curated catalogs
  const profileByAtTag = new Map<string, CuratedPersonProfile>();
  const locationRefByAtTag = new Map<string, ReferenceAsset>();
  const locationTagsLower = new Set<string>();

  for (const [tag, prof] of Object.entries(CURATED_FLOW_PERSON_PROFILES)) {
    profileByAtTag.set(tag.toLowerCase(), prof);
  }
  for (const tag of Object.keys(LOCATION_DESCRIPTOR_MAP)) {
    locationTagsLower.add(tag.toLowerCase());
    const escTag = escapeRegexLiteral(tag);
    p = p.replace(new RegExp(`${escTag}\\b`, 'gi'), resolveLocationDescriptorFromTag(tag));
  }
  for (const [tag, desc] of Object.entries(CURATED_FLOW_VIDEO_TAG_DESC)) {
    if (!CURATED_FLOW_PERSON_PROFILES[tag] && !LOCATION_DESCRIPTOR_MAP[tag]) {
      locationTagsLower.add(tag.toLowerCase());
      const escTag = escapeRegexLiteral(tag);
      p = p.replace(new RegExp(`${escTag}\\b`, 'gi'), desc);
    }
  }

  const nameTokensToReplace: Array<{ term: string; profile: CuratedPersonProfile }> = [];

  if (Array.isArray(references)) {
    for (const ref of references) {
      const rawTag = String(ref?.tag || '').trim();
      if (!rawTag) continue;
      const atTag = rawTag.startsWith('@') ? rawTag : `@${rawTag}`;
      const lowerAt = atTag.toLowerCase();
      const isPerson =
        ref.category === 'persona' ||
        (ref as any).type === 'Persona' ||
        (!KNOWN_LOCATION_AT_TAG_PREFIX_RE.test(atTag) &&
          !LOCATION_DESCRIPTOR_MAP[atTag] &&
          ref.category !== 'lugar' &&
          (ref as any).type !== 'Lugar' &&
          atTag.startsWith('@'));

      if (!isPerson) {
        locationTagsLower.add(lowerAt);
        locationRefByAtTag.set(lowerAt, ref);
        const escTag = escapeRegexLiteral(atTag);
        p = p.replace(
          new RegExp(`${escTag}\\b`, 'gi'),
          resolveLocationDescriptorFromTag(atTag, ref)
        );
        continue;
      }

      const prof = extractProfileFromReference(ref);
      profileByAtTag.set(lowerAt, prof);

      const humanName = atTag.slice(1).replace(/_/g, ' ').trim();
      // A descriptive role tag ("@Mexica_Lake_Warrior_1325", "@Spanish_Siege_Soldier_1521") is not a person's name:
      // its words ("Lake", "Mexica", "Spanish") are ordinary prompt words and must never be replaced
      if (humanName && !isAnonymousRoleReferenceTag(atTag, ref) && !AT_TAG_PERSON_ROLE_WORD_RE.test(atTag)) {
        nameTokensToReplace.push({ term: humanName, profile: prof });
        const parts = humanName.split(/\s+/).filter(Boolean);
        for (const part of parts) {
          const normPart = part.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
          if (
            part.length >= 4 &&
            !GEO_AND_CINEMA_SINGLE_WHITELIST.has(normPart) &&
            !ANONYMOUS_ROLE_KEYWORDS.has(normPart)
          ) {
            nameTokensToReplace.push({ term: part, profile: prof });
          }
        }
      }
    }
  }

  // Also register curated human names so standalone Video 77/76 mentions are caught even if references wasn't passed
  for (const [tag, prof] of Object.entries(CURATED_FLOW_PERSON_PROFILES)) {
    if (prof.isAnonymousRole) continue;
    const humanName = tag.slice(1).replace(/_/g, ' ').trim();
    nameTokensToReplace.push({ term: humanName, profile: prof });
    for (const part of humanName.split(/\s+/)) {
      const normPart = part.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
      if (
        part.length >= 5 &&
        !GEO_AND_CINEMA_SINGLE_WHITELIST.has(normPart) &&
        !ANONYMOUS_ROLE_KEYWORDS.has(normPart) &&
        !/^(charles|albert|andrew|frank|pedro|ernst|mary|ruth)$/i.test(normPart)
      ) {
        nameTokensToReplace.push({ term: part, profile: prof });
      }
    }
  }

  // 4-pre. A reference tag written with spaces ("@Gran Salon del Louvre") is the same tag: rejoin it so it is
  // replaced as a whole instead of treating "@Gran" as a person and leaving "Salon del Louvre" behind
  if (Array.isArray(references)) {
    for (const r of references) {
      const refTag = String(r?.tag || '').trim();
      if (!refTag || !refTag.includes('_')) continue;
      const fullTag = refTag.startsWith('@') ? refTag : `@${refTag}`;
      const spaced = fullTag.replace(/_/g, ' ');
      p = p.replace(new RegExp(`${escapeRegexLiteral(spaced)}(?![A-Za-z0-9_])`, 'gi'), fullTag);
    }
  }

  // 4. Replace ALL @Tags (both @Location and @Person, including anonymous roles) in BOTH image and video modes
  const matchedAtTags = Array.from(
    new Set(p.match(/@[A-Za-z0-9_ÁÉÍÓÚáéíóúÜüÑñ-]+/g) || [])
  ).sort((a, b) => b.length - a.length);

  for (const atTag of matchedAtTags) {
    const lowerAt = atTag.toLowerCase();
    const matchedRef = Array.isArray(references)
      ? references.find((r) => String(r?.tag || '').trim().toLowerCase() === lowerAt)
      : undefined;

    if (
      locationTagsLower.has(lowerAt) ||
      KNOWN_LOCATION_AT_TAG_PREFIX_RE.test(atTag) ||
      (matchedRef?.category !== 'persona' && isPlaceLikeAtTag(atTag)) ||
      matchedRef?.category === 'lugar' ||
      (matchedRef as any)?.type === 'Lugar'
    ) {
      const locDesc = resolveLocationDescriptorFromTag(
        atTag,
        matchedRef || locationRefByAtTag.get(lowerAt)
      );
      p = p.replace(new RegExp(`${escapeRegexLiteral(atTag)}\\b`, 'gi'), locDesc);
      continue;
    }

    const prof: CuratedPersonProfile =
      profileByAtTag.get(lowerAt) ||
      (matchedRef ? extractProfileFromReference(matchedRef) : undefined) || {
        core: 'adult historical figure in authentic period attire',
        role: 'adult historical figure',
        article: 'the',
        videoDesc: 'the adult historical figure in authentic period attire',
      };
    const tagRe = new RegExp(`${escapeRegexLiteral(atTag)}(?:['’]s)?\\b`, 'gi');
    p = applyContextAwarePersonReplacement(p, tagRe, prof, mode);
  }

  // Universal anti-'@' fallback: ensure ZERO '@' tokens remain in either image or video mode
  p = p
    .replace(/@[A-Za-z0-9_ÁÉÍÓÚáéíóúÜüÑñ-]+/g, (residualTag) =>
      KNOWN_LOCATION_AT_TAG_PREFIX_RE.test(residualTag) || isPlaceLikeAtTag(residualTag)
        ? resolveLocationDescriptorFromTag(residualTag)
        : 'the adult historical figure in authentic period attire'
    )
    .replace(/@+/g, '');

  // 5. Replace explicit full names & distinctive surnames from document lexicon (longest first)
  nameTokensToReplace.sort((a, b) => b.term.length - a.term.length);
  const seenTerms = new Set<string>();
  for (const { term, profile } of nameTokensToReplace) {
    const key = term.toLowerCase();
    if (seenTerms.has(key)) continue;
    seenTerms.add(key);
    const re = new RegExp(`(?<!@)\\b${escapeRegexLiteral(term)}(?:['’]s)?\\b`, /\s/.test(term) ? 'gi' : 'g');
    p = applyContextAwarePersonReplacement(p, re, profile, mode);
  }

  // 6. Replace Title + Proper Name patterns (EN/ES) & known historical pairs + possessives, protecting geography
  const PLACE_EXCLUSION =
    '(?!Mary\\b|Francisco\\b|Diego\\b|Carlos\\b|Juan\\b|Jos[eé]\\b|Luis\\b|Pedro\\b|Pablo\\b|Miguel\\b|Antonio\\b|Mart[ií]n\\b|Sebasti[aá]n\\b|Salvador\\b|Lorenzo\\b|Mateo\\b|Nicol[aá]s\\b|Crist[oó]bal\\b|Fe\\b|Clara\\b|Cruz\\b|Mar[ií]a\\b|Rosa\\b|Ana\\b|Luc[ií]a\\b|B[aá]rbara\\b|Elena\\b|Teresa\\b|Domingo\\b|Tom[aá]s\\b|Sp[ií]ritus\\b)';

  p = p.replace(
    /\b(?:Queen|Princess|Empress|Duchess|Lady|Countess|Reina|Princesa|Emperatriz|Duquesa|Doña|Mrs\.?|Ms\.?|Sra\.?)\s+[A-ZÁÉÍÓÚÑ][a-záéíóúñ]+(?:\s+(?:of|de|del|von|I|II|III|IV|V|VI|VII|VIII|IX|X|[A-ZÁÉÍÓÚÑ][a-záéíóúñ]+))*(?:['’]s)?/g,
    (m) => (m.endsWith("'s") || m.endsWith('’s') ? "the adult historical noblewoman's" : 'the adult historical noblewoman')
  );
  p = p.replace(
    /\b(?:King|Prince|Emperor|Duke|Lord|Count|Sultan|Tsar|Czar|Pharaoh|General|Gral\.?|Colonel|Col\.?|Captain|Capt\.?|Major|Commander|Admiral|President|Presidente|Prime\s+Minister|Chancellor|Minister|Ministro|Governor|Gobernador|Senator|Mayor|Rey|Príncipe|Emperador|Duque|Conde|Faraón|Sir|Don)\s+[A-ZÁÉÍÓÚÑ][a-záéíóúñ]+(?:\s+(?:of|de|del|von|I|II|III|IV|V|VI|VII|VIII|IX|X|XI|XII|XIII|XIV|XV|XVI|[A-ZÁÉÍÓÚÑ][a-záéíóúñ]+))*(?:['’]s)?/g,
    (m) => (m.endsWith("'s") || m.endsWith('’s') ? "the adult historical leader's" : 'the adult historical leader')
  );
  p = p.replace(
    /\b(?:Dr\.?|Doctor|Doctora|Prof\.?|Professor|Profesor|Poet|Poeta|Surgeon|Cirujano|Inventor|Industrialist|Mr\.?|Sr\.?)\s+[A-ZÁÉÍÓÚÑ][a-záéíóúñ]+(?:\s+(?:de|del|la|von|van|[A-ZÁÉÍÓÚÑ][a-záéíóúñ]+))*(?:['’]s)?/g,
    (m) => (m.endsWith("'s") || m.endsWith('’s') ? "the adult historical specialist's" : 'the adult historical specialist')
  );
  p = p.replace(
    new RegExp(
      `\\b(?:Pope|Bishop|Archbishop|Cardinal|Father|Friar|Papa|Obispo|Arzobispo|Cardenal|Fray|(?:Saint|San|Santa|Santo)\\s+${PLACE_EXCLUSION})\\s+[A-ZÁÉÍÓÚÑ][a-záéíóúñ]+(?:\\s+(?:of|de|del|I|II|III|IV|V|VI|VII|VIII|IX|X|XI|XII|XIII|XIV|XV|XVI|[A-ZÁÉÍÓÚÑ][a-záéíóúñ]+))*(?:['’]s)?(?!\\s+(?:Hospital|Church|Cathedral|Abbey|Fort|Fortress|Castle|Bay|Harbor|Port|Street|Avenue|Plaza|Square|Island|River|Valley))`,
      'g'
    ),
    (m) => (m.endsWith("'s") || m.endsWith('’s') ? "the elderly clergyman's" : 'the elderly clergyman')
  );

  // 7. Extract & scrub any document-context person names (from Spanish voiceover/research if supplied)
  for (const ctxName of extractContextPersonNames(options.docContextText)) {
    const ctxRe = new RegExp(`(?<!@)\\b${escapeRegexLiteral(ctxName)}(?:['’]s)?\\b`, 'gi');
    p = p.replace(ctxRe, (m) =>
      m.endsWith("'s") || m.endsWith('’s') ? "the adult historical figure's" : 'the adult historical figure'
    );
  }

  // 8. Scrub well-known historical person pairs & contextual First Last in human-action positions (strictly whitelist-guarded)
  p = p.replace(
    new RegExp(`${KNOWN_HISTORICAL_NAME_PAIR_RE.source}(?:['’]s)?`, 'gi'),
    (m) => (m.endsWith("'s") || m.endsWith('’s') ? "the adult historical figure's" : 'the adult historical figure')
  );

  p = p.replace(
    /\b(showing|depicting|portrait\s+of|hands\s+of|beside|behind|near|with|toward|following|while|as)\s+([A-ZÁÉÍÓÚÑ][a-záéíóúñ]{2,}\s+[A-ZÁÉÍÓÚÑ][a-záéíóúñ]{2,}(?:\s+[A-ZÁÉÍÓÚÑ][a-záéíóúñ]{2,})?)(['’]s)?\b/g,
    (full, prep, candidate, poss) => {
      const tokens = String(candidate).split(/\s+/);
      if (tokens.some((t) => GEO_AND_CINEMA_SINGLE_WHITELIST.has(t.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase()))) {
        return full;
      }
      if (PLACE_OR_ENTITY_SUFFIX_RE.test(tokens[tokens.length - 1])) {
        return full;
      }
      return `${prep} the adult historical figure${poss ? "'s" : ''}`;
    }
  );

  // 9. Clean accidental article/phrase duplications (keeps sanitization 100% idempotent)
  p = p
    .replace(/(?:\bthe)\s+(?:a|an)\s+/gi, 'the ')
    .replace(/\bthe\s+the\b/gi, 'the')
    .replace(/\ba\s+the\b/gi, 'the')
    .replace(/\ban\s+the\b/gi, 'the')
    .replace(/\ba\s+a\b/gi, 'a')
    .replace(/\ban\s+an\b/gi, 'an')
    .replace(/\b(the adult historical (?:figure|leader|specialist|noblewoman))(?:\s+of\s+\1|\s+\1)+\b/gi, '$1')
    .replace(/\s+([,.;:!?])/g, '$1')
    .replace(/\s{2,}/g, ' ')
    .trim();

  return `${prefix}${p}${suffix}`.replace(/\s{2,}/g, ' ').trim();
}

/**
 * Descending-specificity CBRN, pharmaceutical, wartime, clinical, and abrupt-physics sanitizer
 * applied identically to BOTH image and video prompts with strict \b boundaries and plural safety.
 */
export function sanitizeCbrnAndWarKeywordsForFlow(rawText: string): string {
  if (!rawText) return rawText;
  return rawText
    // 1. Compound biological / pharmaceutical / fermentation / petri / mold / spore / sulfonamide / antibiotic rules
    .replace(
      /\bpetri\s+dish(?:es)?\s+with\s+(?:(?:living|blue-green|green|fuzzy)\s+)*mold(?:\s+colon(?:y|ies))?\b/gi,
      'clear glass specimen dish with green botanical moss'
    )
    .replace(/\bpetri\s+dish(?:es)?\b/gi, 'clear glass specimen dish')
    .replace(
      /\b(?:living\s+green|blue-green|green)\s+mold(?:\s+colon(?:y|ies))?\b/gi,
      'green botanical moss'
    )
    .replace(/\bmold\s+spores?\b/gi, 'fine botanical particles')
    .replace(/\bmold(?:\s+colon(?:y|ies))?\b/gi, 'botanical moss')
    .replace(/\bspores?\b/gi, 'fine botanical particles')
    .replace(
      /\bdeep-tank\s+fermentation\s+(blueprints?|plans?|diagrams?)\b/gi,
      'deep-tank industrial processing $1'
    )
    .replace(
      /\bfermentation\s+(facility|facilities|hall|halls|room|rooms|lab|laborator(?:y|ies)|blueprints?|process(?:es)?)\b/gi,
      'botanical processing $1'
    )
    .replace(
      /\bfermentation\s+(plant|plants|tank|tanks|vat|vats|unit|units|vessel|vessels|column|columns|chamber|chambers)\b/gi,
      'industrial processing $1'
    )
    .replace(/\bfermenters\b/gi, 'processing tanks')
    .replace(/\bfermenter\b/gi, 'processing tank')
    .replace(/\bfermenting\b/gi, 'botanical processing')
    .replace(/\bfermentation\b/gi, 'botanical processing')
    .replace(/\bbacteriological\b/gi, 'botanical')
    .replace(/\bbacteriology\b/gi, 'botanical science')
    .replace(/\bbacteriologists\b/gi, 'botanical research scientists')
    .replace(/\bbacteriologist\b/gi, 'botanical research scientist')
    .replace(
      /\b(?:sulfonamide\s+(?:powder|tablets?|pills?|crystals?)|synthetic\s+tablets?|sulfonamides?|sulfa\s+(?:powder|tablets?|drugs?))\b/gi,
      'white pressed mineral discs'
    )
    .replace(
      // A rugged field / digital tablet is a device, never a pill
      /(?<!\b(?:stone|clay|bronze|wax|marble|memorial|wooden|rugged|field|digital|electronic|touchscreen|android)\s)\btablets?\b(?!\s+(?:computers?|screens?|devices?|cases?))/gi,
      'white pressed mineral discs'
    )
    .replace(/\bantibiotic\s+crystals?\b/gi, 'golden-amber grains')
    .replace(/\bantibiotic\s+powder\b/gi, 'golden-amber grains')
    .replace(/\bunprescribed\s+antibiotic\s+vials?\b|\bantibiotic\s+vials?\b/gi, 'sealed amber glass vessel')
    .replace(/\bantibiotics?\b/gi, 'amber botanical solution')
    .replace(/\bpenicillin\s+(?:mold|spores?)\b/gi, 'green botanical moss')
    .replace(/\bpenicillin\s+(?:powder|crystals?)\b/gi, 'golden-amber grains')
    .replace(/\bpenicillin\b/gi, 'amber botanical extract')
    .replace(/\bamber(?:\s+glass)?\s+vials\b/gi, 'amber glass vessels')
    .replace(/\bamber(?:\s+glass)?\s+vial\b/gi, 'amber glass vessel')
    .replace(/\bamber\s+doses\b/gi, 'amber glass vessels')
    .replace(/\bamber\s+dose\b/gi, 'amber glass vessel')
    // Whole word only ("crystalline" and "crystallizing" were becoming "golden-amber grainsline"); salt or mineral
    // crystals are geology, not a drug
    .replace(
      /(?<!\b(?:salt|mineral|ice|quartz|sugar|snow)\s)\bcrystals?\b(?!\s*[- ]\s*clear\b|\s+chandeliers?\b|\s+glassware\b)/gi,
      'golden-amber grains'
    )
    .replace(/\bbacterial\s+agar\s+plates?\b/gi, 'clear glass specimen plates')
    .replace(/\bagar\s+plates?\b/gi, 'clear glass specimen plates')
    .replace(/\bbacteri(?:a|al|um)\b/gi, 'microscopic specimens')
    .replace(/\b(?:staphylococc(?:us|i)|streptococc(?:us|i)|pathogens?|microbes?|germs?)\b/gi, 'microscopic specimens')
    .replace(/\binfections?\b|\binfected\b|\bsepsis\b|\bsepticemia\b/gi, 'severe ailment')
    // Contextual "cultures" (never corrupts "Spanish culture")
    .replace(
      /\b(ceramic|liquid|mold|botanical|bacterial|microscopic|glass|flask|broth|agar|laboratory|living|pure|surface|submerged|fermentation|shallow)\s+cultures?\b/gi,
      '$1 specimens'
    )
    .replace(
      /\bcultures?\s+(vessels?|flasks?|dishes?|plates?|tanks?|vats?|broth|liquid|solutions?|tubes?|extracts?|samples?|collections?|cases?|boxes?|racks?|bottles?|trays?|chambers?|media|medium)\b/gi,
      'specimen $1'
    )
    .replace(
      /(?<!\b(?:human|popular|local|ancient|modern|european|american|british|spanish|latin|western|folk|literary|civic|national|traditional)\s)\bcultures\b/gi,
      'specimens'
    )
    // Contextual "retorts" (never corrupts verb "he retorts")
    .replace(
      /\b(?:(?:glass|laboratory|ceramic|chemical|distillation|long-necked|curved)\s+)?retorts\b/gi,
      'clear water flasks'
    )
    .replace(
      /\b(?:glass|laboratory|ceramic|chemical|distillation|long-necked|curved)\s+retort\b/gi,
      'clear water flask'
    )
    // 2. Syringes, needles, droppers, sterile equipment, powders, clinical terms
    .replace(/\(\s*no\s+unintended\s+explosions\s+or\s+flashes\s*\)/gi, 'steady continuous lighting with zero sudden flashes')
    .replace(/\bno\s+unintended\s+explosions\s+or\s+flashes\b/gi, 'steady continuous lighting with zero sudden flashes')
    .replace(/\b(?:freshly\s+sterilized\s+|vintage\s+)?glass\s+syringe\s+plunger\b/gi, 'glass pipette bulb')
    .replace(/\bsyringe\s+plunger\b/gi, 'glass pipette bulb')
    .replace(/\b(?:freshly\s+sterilized\s+|vintage\s+|sterile\s+)?(?:glass\s+)?syringes?\b/gi, 'graduated glass laboratory pipette')
    .replace(/\binjecting\b/gi, 'dispensing')
    .replace(/\binjects\b/gi, 'dispenses')
    .replace(/\binjected\b/gi, 'dispensed')
    .replace(/\binjections?\b/gi, 'application')
    .replace(
      /\b(?:an?\s+)?(?:sterile\s+glass\s+dropper|intravenous(?:\s+drip)?)\s+glass\s+bottle\s+stand\b/gi,
      'a vintage glass dropper bottle stand'
    )
    .replace(/\bglass\s+sterile\s+glass\s+dropper\s+bottle\b/gi, 'vintage glass dropper bottle')
    .replace(/\bglass\s+intravenous\s+drip\s+chamber\b/gi, 'glass laboratory dropper vessel')
    .replace(/\bintravenous(?:\s+drip)?\b/gi, 'vintage glass water dropper')
    .replace(/\bsterile\s+glass\s+droppers?\b/gi, 'vintage glass water dropper')
    .replace(/\bsterile\s+(metal\s+trays?)\b/gi, 'stainless steel trays')
    .replace(/\bsterile\s+metal\s+tray\b|\bsterile\s+tray\b/gi, 'stainless steel tray')
    .replace(/\bsterile\s+trays\b/gi, 'stainless steel trays')
    .replace(
      /\bsterile\s+(air\s+compressors?|compressors?|steam\s+seals?|seals?|pipes?|valves?|tanks?|vats?|equipment|chambers?)\b/gi,
      'industrial $1'
    )
    .replace(/\bsterile\s+(gauze|cotton|linen|cloth|drapes?|towels?)\b/gi, 'clean white $1')
    .replace(
      /\bsterile\s+(glass\s+suction\s+tubes?|suction\s+tubes?|glass\s+tubes?|glass\s+medicine\s+bottles?|glass\s+bottles?|glass\s+vessels?|glassware|pipettes?|dropper\s+vessels?|flasks?)\b/gi,
      'clean clear $1'
    )
    .replace(/\bsterilizers?\b/gi, 'steam-cleaning cabinet')
    .replace(/\bsterilized\b/gi, 'freshly cleaned')
    .replace(/\bsterile\b/gi, 'clean')
    .replace(/\bpressure\s+gauge\s+needles\b/gi, 'pressure gauge dial pointers')
    .replace(/\bneedles\b/gi, 'dial pointers')
    .replace(/\bneedle\b/gi, 'brass pointer')
    .replace(/\bwhite\s+alumina\s+powder\b/gi, 'white mineral chromatography column')
    .replace(/\b(?:golden-brown\s+purified|yellow|amber|golden)\s+powder\b/gi, 'golden-amber grains')
    .replace(/\bwhite\s+powder\b/gi, 'fine mineral granules')
    .replace(/(?<!gun)\bpowders?\b/gi, 'crystalline granules')
    .replace(/\bdrugstores?\b/gi, 'vintage neighborhood apothecary')
    .replace(/\bcrude\s+extract\b/gi, 'amber laboratory solution')
    // 3. Wartime / artillery / blackout / rubble / blood / agony / hospital / feverish / charts triggers
    .replace(/\banti-aircraft\s+artillery\b|\banti-aircraft\b|\bartillery\b/gi, 'distant atmospheric rumble')
    .replace(
      /\b(?:heavy\s+)?(?:black\s+)?(?:1940s\s+period\s+|wartime\s+)?blackout\s+(?:curtains?|cloths?|drapes?|shades?)\b/gi,
      'shaded night ambient curtains with amber lamps'
    )
    .replace(/\bblackouts?\b/gi, 'shaded night ambient with amber lamps')
    .replace(/\bbomb-damaged\b/gi, 'weathered soot-stained')
    .replace(/\bbombs?\b|\bbombing\b|\bbombardment\b/gi, 'heavy storm')
    .replace(/\bair-raid\s+sirens?\b/gi, 'distant harbor foghorn')
    .replace(/\bair-raid\s+(?:curtains?|cloths?|drapes?|shades?)\b/gi, 'shaded night ambient curtains with amber lamps')
    .replace(/\bair-raid\b/gi, 'shaded night')
    .replace(/\banti-blast\b/gi, 'crisscrossed paper-taped')
    .replace(/\b(?:stone\s+)?rubble\b/gi, 'weathered stone fragments')
    .replace(/\bblood(?:y|stained)?\b|\bbleeding\b/gi, 'deep crimson stain')
    .replace(/\b(?:agony|deaths?|dying|deadly|lethal(?:ly)?|fatal(?:ly)?)\b/gi, 'solemn silence and quiet restraint')
    .replace(/\bwounds?\b|\bwounded\b/gi, 'bandaged limb')
    .replace(/\bwartime\s+hospital\s+room\s+tone\b/gi, '1940s quiet brick ward tone')
    .replace(/\bhospital\s+room\s+tone\b/gi, 'quiet brick ward room tone')
    .replace(/\bstarched\s+hospital\s+cotton\b/gi, 'starched white cotton')
    .replace(/\bwartime\b/gi, '1940s period')
    .replace(/\bcanvas\s+aid\s+tent\b/gi, 'canvas field pavilion')
    .replace(/\bfield\s+surgeon\b/gi, 'attending physician')
    .replace(/\bhospital\s+bedpans\b|\bbedpans\b/gi, 'white enameled ceramic vessels')
    .replace(/\b(?:white\s+)?(?:enameled\s+)?iron\s+hospital\s+bed\b|\bhospital\s+bed\b/gi, 'white-draped iron resting cot')
    .replace(/\bdim\s+hospital\s+(?:room|ward)\s+of\s+the\s+quiet\s+vintage\s+1940s\s+brick\s+ward\b/gi, 'dim room of the quiet vintage 1940s brick ward')
    .replace(/\bhospital\s+(?:room|ward)\b/gi, 'quiet 1940s brick ward')
    .replace(/\bhospital\s+courtyard\b/gi, 'sunlit stone courtyard')
    .replace(/\bhospital\s+entrance\b/gi, 'Victorian brick entrance')
    .replace(/\bhospital\s+corridor\b/gi, 'arched stone corridor')
    .replace(/\bhospital\s+cotton\b/gi, 'starched white cotton')
    .replace(/\bhospital\s+glass\b/gi, 'tall sash window glass')
    .replace(/\bhospital\b/gi, 'vintage stone building')
    .replace(/\bfeverish(?:ly)?\b/gi, 'fatigued')
    .replace(
      /\b(?:paper\s+)?(?:clinical|bedside)\s+(?:fever\s+|temperature\s+|clinical\s+)?charts?\b|\btemperature\s+charts?\b/gi,
      'handwritten observation chart'
    )
    .replace(/\bfever\b/gi, 'clinical')
    .replace(/\brecovered\s+adult\s+patients\b/gi, 'recovered adult visitors')
    .replace(/\bpatients\b/gi, 'visitors')
    .replace(/\bpatient\b/gi, 'resting person')
    // 4. Abrupt verbs & unstable camera motion -> stable smooth physics
    .replace(/\b(?:shattering|breaking|smashing|crashing|exploding|bursting)\b/gi, 'softly shifting')
    .replace(/\b(?:shatters?|breaks?|smashes?|explodes?)\b/gi, 'gently settles')
    .replace(/\b(?:violently|abruptly)\b/gi, 'calmly')
    .replace(/\b(whip\s+pan|fast\s+pan|rapid\s+pan)\b/gi, 'smooth controlled fluid-head pan')
    .replace(/\b(fast\s+tracking|rapid\s+tracking)\b/gi, 'smooth stabilized Steadicam tracking')
    .replace(/\b(fast\s+dolly|rapid\s+zoom|sudden\s+zoom)\b/gi, 'smooth controlled dolly')
    .replace(/\bsound\s+waves?\b/gi, 'gentle room acoustics')
    .replace(/\bthe\s+(young\s+British\s+physician\s+in\s+the\s+white\s+coat)\s+coat\b/gi, 'the coat of the $1')
    .replace(/\bthe\s+(tall\s+British\s+researcher\s+in\s+the\s+laboratory\s+coat)\s+coat\b/gi, 'the coat of the $1')
    .replace(/\b(the quiet vintage 1940s brick ward)\s+with\s+the\s+quiet\s+vintage\s+1940s\s+brick\s+ward/gi, '$1')
    .replace(/(?:\bthe)\s+(?:a|an)\s+/gi, 'the ')
    .replace(/\b(industrial|botanical|clean|vintage)\s+\1\b/gi, '$1')
    .replace(/\ban\s+(?=(?:vintage|stainless|handwritten|botanical|clear|clean|golden|white)\b)/gi, 'a ')
    .replace(/\s{2,}/g, ' ')
    .trim();
}

export function stripAllClosingBoilerplates(rawText: string): string {
  let out = String(rawText || '');
  let prev = '';
  while (out !== prev) {
    prev = out;
    out = out
      .replace(
        /,?\s*cinematic\s+documentary\s+realism,\s*safe\s+framing\s+composition,\s*8k\s+resolution,\s*sharp\s+focus,\s*no\s+modern\s+objects,\s*no\s+CGI\s+look(?:,\s*no\s+text,\s*no\s+spoken\s+voice,\s*no\s+human\s+speech,\s*no\s+music\.?)?/gi,
        ' '
      )
      .replace(
        /,?\s*portrayed\s+by\s+anonymous(?:\s+mature\s+adult)?\s+historical\s+reenactment\s+actors?(?:\s+in\s+authentic\s+period\s+(?:costume|attire))?(?:\s*\(no\s+real\s+public\s+figures\s+or\s+prominent\s+people\))?/gi,
        ' '
      )
      .replace(
        /,?\s*clean\s+uncluttered\s+composition\s+with\s+rigid\s+architectural\s+perspective,\s*stationary\s+period\s+props(?:,\s*clear\s+anatomical\s+separation\s+between\s+subjects)?(?:,\s*strictly\s+empty\s+environment\s+with\s+(?:no\s+people\s+present|zero\s+people(?:,\s*zero\s+human\s+hands,?\s*and\s+zero\s+characters\s+anywhere\s+in\s+the\s+frame)?))?/gi,
        ' '
      )
      .replace(
        /,?\s*8k\s+photorealistic\s+cinematic\s+lighting,\s*historical\s+accuracy,\s*sharp\s+focus[^.]*\.?/gi,
        ' '
      )
      .replace(
        /,?\s*(?:strictly\s+)?no\s+text(?:,\s*no\s+readable\s+letters)?(?:,\s*no\s+watermarks)?(?:,\s*no\s+spoken\s+voice)?(?:,\s*no\s+human\s+speech)?(?:,\s*no\s+speech)?(?:,\s*no\s+music)?(?:\s*\(no\s+real\s+public\s+figures\s+or\s+prominent\s+people\))?\.?/gi,
        ' '
      )
      .replace(/\(\s*no\s+real\s+public\s+figures\s+or\s+prominent\s+people\s*\)/gi, ' ');
  }
  return out.replace(/\s{2,}/g, ' ').trim();
}

export function stripZeroPeopleBoilerplatePhrases(rawText: string): string {
  return String(rawText || '')
    .replace(
      /,?\s*with\s+no\s+people\s+present\s+and\s+zero\s+human\s+figures\b/gi,
      ' '
    )
    .replace(
      /,?\s*with\s+no\s+people\s+present(?=\s+across\s+the\s+full\s+\d+\s+seconds\b|,|\.|\s*$)/gi,
      ' '
    )
    .replace(
      /,?\s*strictly\s+empty\s+environment\s+with\s+(?:no\s+people\s+present|zero\s+people(?:,\s*zero\s+human\s+hands,?\s*and\s+zero\s+characters\s+anywhere\s+in\s+the\s+frame)?)/gi,
      ' '
    )
    .replace(
      /Strictly\s*zero\s*people(?:\s+or\s+human\s+figures\s+appearing\s+anywhere\s+in\s+the\s+frame|\s*,\s*zero\s*human\s*silhouettes,?|\s+and\s+zero\s+(?:moving\s*characters|human\s*figures))[^.]*\.?\s*/gi,
      ' '
    )
    .replace(/,?\s*no\s+people\s+present\s+and\s+zero\s+human\s+figures\b/gi, ' ')
    // "...drifting across the peaks and no people present." must not leave a dangling "and"
    .replace(/,?\s*(?:(?:with|and)\s+)?no\s+people\s+present\b/gi, ' ')
    .replace(/,?\s*(?:with\s+)?zero\s+people\b/gi, ' ')
    .replace(/,?\s*(?:and\s+)?zero\s+human\s+figures\b/gi, ' ')
    .replace(/\s{2,}/g, ' ')
    .trim();
}

function finalizeCleanFlowPromptParagraph(
  sanitizedPrompt: string,
  mode: 'image' | 'video',
  options: SanitizeFlowPromptOptions = {}
): string {
  let raw = String(sanitizedPrompt || '').trim();
  if (!raw) return raw;

  const headerNumMatch = raw.match(/^(?:Image|Imagen|Clip)\s*\[?0*(\d+)\]?/i);
  const renameNumMatch = raw.match(/\bfix\s+the\s+name\s+to\s+(?:Inicial|Broll|Clip)_0*(\d+)/i);
  const resolvedNum =
    (typeof options.clipNumber === 'number' && options.clipNumber > 0 ? options.clipNumber : 0) ||
    (headerNumMatch ? parseInt(headerNumMatch[1], 10) : 0) ||
    (renameNumMatch ? parseInt(renameNumMatch[1], 10) : 0) ||
    1;
  const numStr = resolvedNum < 10 ? `0${resolvedNum}` : `${resolvedNum}`;

  const inlineDurMatch =
    raw.match(/\[Duration\s*:\s*(\d+)\s*s(?:ec(?:onds?)?)?\]/i) ||
    raw.match(/\bGenerate\s+a\s+video\s+in\s+16[-:]9\s+horizontal\s+aspect\s+ratio\s+across\s+(\d+)\s+seconds\b/i) ||
    raw.match(/\bCreate\s+a\s+cinematic\s+(\d+)-second\s+video\b/i) ||
    raw.match(/\bacross\s+the\s+full\s+(\d+)\s*seconds\b/i);
  const resolvedDur =
    (typeof options.durationSec === 'number' && options.durationSec > 0 ? options.durationSec : 0) ||
    (inlineDurMatch ? parseInt(inlineDurMatch[1], 10) : 0) ||
    (resolvedNum === 1 ? 6 : 8);

  const isStaticBroll =
    mode === 'image' && Boolean(options.isStaticBroll || isImageOnlyBrollPrompt(raw));

  // Two-shot clip (decided by Gemini from the narration): detected before the tags are stripped
  const isTwoShotClip = mode === 'video' && isTwoShotClipText(raw);

  // Strip leading header ("Image 01:", "Clip 01 (00:08 - 00:16):")
  let body = raw
    .replace(/^(?:Image|Imagen|Clip)\s*\[?0*\d+\]?(?:\s*\([^)]*\))?\s*[:\-–]\s*/i, '')
    .trim();

  // Strip all brackets and trailing rename
  body = stripAllPromptBrackets(body).replace(FLOW_TRAILING_FIX_NAME_RE, '').trim();

  if (mode === 'image') {
    body = stripZeroPeopleBoilerplatePhrases(stripAllClosingBoilerplates(body))
      .replace(/\b16\s*:\s*9\b|\b16-by-9\b/gi, '16-9')
      .replace(/\b9\s*:\s*16\b|\b9-by-16\b/gi, '9-16')
      .replace(/STATIC\s+B-ROLL\s+PLATE\s+LOCK\s*:?/gi, '')
      .replace(/\s*:\s*/g, ', ')
      .replace(/\s+/g, ' ')
      .replace(/[,;.\s]+$/g, '')
      .trim();

    if (!/^Create\s+an\s+image\b/i.test(body)) {
      body = `Create an image in 16-9 horizontal aspect ratio ${body}`;
    } else {
      body = body.replace(
        /^Create\s+an\s+image(?:\s+in\s+(16-9\s+horizontal|9-16\s+vertical)\s+aspect\s+ratio)?\s*(?:of\s+)?/i,
        (_, ar) => `Create an image in ${ar || '16-9 horizontal'} aspect ratio `
      );
    }

    if (
      isStaticBroll &&
      !/\bstill\s+archival\s+documentary\s+B-roll\s+plate\b/i.test(body)
    ) {
      body = body.replace(
        /^(Create\s+an\s+image\s+in\s+(?:16-9\s+horizontal|9-16\s+vertical)\s+aspect\s+ratio)\s+(?:(on|inside|along|at|beneath|under|across)\b|(?:showing\s+|depicting\s+|of\s+)?)/i,
        (_, pfx, prep) =>
          prep
            ? `${pfx} structured as a completely still archival documentary B-roll plate ${prep.toLowerCase()}`
            : `${pfx} structured as a completely still archival documentary B-roll plate showing `
      );
    }

    const hasHuman = detectPromptSceneHasHumanSubjects(body);
    const subjectClause = hasHuman
      ? ', portrayed by anonymous mature adult historical reenactment actors in authentic period costume'
      : ', with no people present';

    body = body
      .replace(/,\s*,+/g, ', ')
      .replace(/\s+([,.;])/g, '$1')
      .replace(/\s{2,}/g, ' ')
      .replace(/[,;.\s]+$/g, '')
      .trim();

    if (isStaticBroll) {
      return `Image ${numStr}: ${body}${subjectClause}, ${FROZEN_FLOW_CLOSING_CLAUSE} ${IMAGE_ONLY_BROLL_DIRECTIVE_TAG} fix the name to Broll_${numStr}_create_an_image_in_16_9`;
    }
    return `Image ${numStr}: ${body}${subjectClause}, ${FROZEN_FLOW_CLOSING_CLAUSE} fix the name to Inicial_${numStr}_create_an_image_in_16_9`;
  }

  // Video mode ("Clip XX:")
  let foleyClause = '';
  const foleyColonMatch = body.match(/\b(?:Ambient\s+Foley|Audio)\s*:\s*([\s\S]*)$/i);
  const foleyProseMatch = body.match(/,?\s*with\s+subtle\s+ambient\s+foley\s+of\s+([\s\S]*)$/i);
  if (foleyColonMatch) {
    foleyClause = foleyColonMatch[1];
    body = body.slice(0, foleyColonMatch.index).trim();
  } else if (foleyProseMatch) {
    foleyClause = foleyProseMatch[1];
    body = body.slice(0, foleyProseMatch.index).trim();
  }

  if (foleyClause) {
    foleyClause = stripAllClosingBoilerplates(stripLeakedSpanishNarrationTail(foleyClause))
      .replace(
        /,?\s*(?:single\s+continuous\s+shot|strictly\s+no\s+shot\s+changes|exactly\s+two\s+shots\s+joined|100%\s*pure\s*ambient\s*foley[^,.]*|no\s+music|no\s+spoken\s+voice|no\s+human\s+speech|no\s+speech|no\s+text|no\s+watermarks)\b[\s\S]*$/i,
        ''
      )
      .replace(/\(\s*100%\s*pure\s*ambient\s*foley[^)]*\)/gi, '')
      .replace(/\b16\s*:\s*9\b|\b16-by-9\b/gi, '16-9')
      .replace(/\s*:\s*/g, ', ')
      .replace(/\s+/g, ' ')
      .replace(/[,;.\s]+$/g, '')
      .trim();
  }
  if (!foleyClause) {
    foleyClause = 'quiet period room tone and natural atmospheric acoustics';
  }

  // Strip all legacy duplicate physics/actor/closing/zero-people sentences from video body
  body = stripZeroPeopleBoilerplatePhrases(
    stripAllClosingBoilerplates(body)
      .replace(/\b16\s*:\s*9\b|\b16-by-9\b/gi, '16-9')
      .replace(/\b9\s*:\s*16\b|\b9-by-16\b/gi, '9-16')
      .replace(
        /Smooth,\s*controlled\s*fluid-head\s*camera\s*motion\s*maintaining\s*rigid\s*3D[^.]*\.?\s*/gi,
        ' '
      )
      .replace(
        /Sustained,\s*unhurried\s*continuous\s*(?:action|motion)\s*across\s*the\s*full\s*\d+\s*seconds[^.]*\.?\s*/gi,
        ' '
      )
      .replace(
        /Fixed\s*subject\s*count\s*from\s*0s\s*to\s*\d+s[\s\S]*?(?:bokeh\)\.|geometry\.|physics\.|morphing\)\.)\s*(?:\d+\s*bokeh\)\.\s*)*/gi,
        ' '
      )
      .replace(
        /All\s*furniture,\s*tables,\s*and\s*props\s*remain\s*100%\s*physically\s*solid[^.]*\.?\s*/gi,
        ' '
      )
      .replace(
        /All\s*tables,\s*documents,\s*furniture,\s*and\s*props\s*remain\s*100%\s*gravity-locked[^.]*\.?\s*/gi,
        ' '
      )
      .replace(
        /Solid,\s*non-deforming\s*walls\s*and\s*rigid\s*3D\s*architectural\s*geometry[^.]*\.?\s*/gi,
        ' '
      )
      .replace(
        /Cinematic\s*historical\s*(?:drama\s*reenactment|documentary\s*still-life\s*cinematography)[^.]*\.?\s*/gi,
        ' '
      )
      .replace(
        /,?\s*(?:with\s+no\s+people\s+present\s+and\s+zero\s+human\s+figures,\s*)?all\s+background\s+furniture,\s+architectural\s+fixtures,\s+and\s+tabletop\s+props\s+remain\s+100%\s+gravity-locked[\s\S]*$/i,
        ' '
      )
      .replace(
        /,?\s*(?:single\s+continuous\s+shot|strictly\s+no\s+shot\s+changes|exactly\s+two\s+shots\s+joined|no\s+music|no\s+spoken\s+voice|no\s+human\s+speech|no\s+speech|no\s+text)\b[\s\S]*$/i,
        ' '
      )
      .replace(/\b(?:STRICT\s+ADULTS-ONLY\s+CAST[^:]*|SINGLE\s+CONTINUOUS\s+UNBROKEN\s+TAKE[^:]*|Visual\s+Style)\s*:\s*/gi, '')
  )
    .replace(/\s*:\s*/g, ', ')
    .replace(/\s+/g, ' ')
    .replace(/[,;.\s]+$/g, '')
    .trim();

  // Normalize video opening so first 6 tokens match "generate_a_video_in_16_9" and prose carries exact Stage 1 duration
  body = body.replace(
    /^(?:Generate\s+a\s+video(?:\s+in\s+(?:16-9|9-16)\s+(?:horizontal|vertical)\s+aspect\s+ratio)?(?:\s+across\s+\d+\s+seconds)?|Create\s+a\s+(?:cinematic\s+|smooth\s+)?(?:\d+-second\s+)?video)\s*(?:showing\s+)?/i,
    ''
  ).trim();
  body = `Generate a video in 16-9 horizontal aspect ratio across ${resolvedDur} seconds showing ${body}`;

  const hasHuman = detectPromptSceneHasHumanSubjects(body);
  // One shot by default; a two-shot clip keeps its single hard cut instead of being forced back to one take
  const shotCountClause = isTwoShotClip
    ? `fixed subject count within each shot, exactly two shots joined by one clean hard cut near second ${Math.round(
        resolvedDur / 2
      )}, each shot one continuous take`
    : `fixed subject count from 0s to ${resolvedDur}s, single continuous shot, strictly no shot changes`;
  const physicsClause = hasHuman
    ? `all background furniture, architectural fixtures, and tabletop props remain 100% gravity-locked and stationary while any held object moves smoothly under natural hand control, ${shotCountClause}`
    : `with no people present and zero human figures, all background furniture, architectural fixtures, and tabletop props remain 100% gravity-locked and stationary, ${shotCountClause}`;

  body = body
    .replace(/,\s*,+/g, ', ')
    .replace(/\s+([,.;])/g, '$1')
    .replace(/\s{2,}/g, ' ')
    .replace(/[,;.\s]+$/g, '')
    .trim();

  return `Clip ${numStr}: ${body}, ${physicsClause}, with subtle ambient foley of ${foleyClause}. ${FROZEN_FLOW_CLOSING_CLAUSE} fix the name to Clip_${numStr}_generate_a_video_in_16_9`;
}

export function sanitizeImagePromptForFlowSafety(
  rawImagePrompt: string,
  references?: ReferenceAsset[],
  docContextText?: string,
  options?: SanitizeFlowPromptOptions
): string {
  if (!rawImagePrompt || !rawImagePrompt.trim()) return rawImagePrompt;
  const isStaticBroll = Boolean(options?.isStaticBroll || isImageOnlyBrollPrompt(rawImagePrompt));
  const personAndLocClean = sanitizePromptRemovePersonNames(rawImagePrompt, {
    mode: 'image',
    references,
    docContextText,
  });
  const cbrnClean = sanitizeCbrnAndWarKeywordsForFlow(personAndLocClean);
  return finalizeCleanFlowPromptParagraph(cbrnClean, 'image', {
    ...options,
    isStaticBroll,
  });
}

/**
 * Hardens video-clip prompts (Clip XX) against Google Flow Veo/Omni anti-deepfake & CBRN filters,
 * enforcing single-paragraph syntax, stable physics, English-only Foley, frozen closing clause,
 * and clean trailing rename `fix the name to Clip_XX_generate_a_video_in_16_9`.
 */
export function sanitizeVideoClipPromptForFlowSafety(
  rawVideoPrompt: string,
  references?: ReferenceAsset[],
  docContextText?: string,
  options?: SanitizeFlowPromptOptions
): string {
  if (!rawVideoPrompt || !rawVideoPrompt.trim()) return rawVideoPrompt;
  const personAndLocClean = sanitizePromptRemovePersonNames(rawVideoPrompt, {
    mode: 'video',
    references,
    docContextText,
  });
  const cbrnClean = sanitizeCbrnAndWarKeywordsForFlow(personAndLocClean);
  return finalizeCleanFlowPromptParagraph(cbrnClean, 'video', options);
}

export function buildRawClipsTextWithHeader(
  clips: DocumentaryClip[],
  operationalHeader: string = DEFAULT_OPERATIONAL_HEADER,
  projectEngineMode: FlowProjectEngineMode = 'HYBRID_PEOPLE_OMNI_REST_LOWER',
  clip1DurationSec?: number,
  standardClipDurationSec?: number,
  references?: ReferenceAsset[]
): string {
  const header = sanitizeOperationalHeader(operationalHeader, projectEngineMode);
  const body = (clips || [])
    .map((c) => {
      const rawImg = c.imagePrompt?.trim() || '';
      const rawVid = c.videoPrompt?.trim() || '';
      const durSec =
        c.clipNumber === 1
          ? clip1DurationSec || 6
          : standardClipDurationSec || 8;
      if (c.isStaticBroll) {
        if (!rawImg) return '';
        const safeBrollImg = sanitizeImagePromptForFlowSafety(rawImg, references, undefined, {
          isStaticBroll: true,
          clipNumber: c.clipNumber,
          durationSec: durSec,
        });
        return normalizeBrollImagePrompt(
          safeBrollImg,
          c.clipNumber,
          c.timeRange,
          durSec,
          c.brollCameraMotion || 'zoom_in'
        );
      }
      const img = rawImg
        ? sanitizeImagePromptForFlowSafety(rawImg, references, undefined, {
            isStaticBroll: false,
            clipNumber: c.clipNumber,
            durationSec: durSec,
          })
        : '';
      const safeVid = rawVid
        ? sanitizeVideoClipPromptForFlowSafety(rawVid, references, undefined, {
            clipNumber: c.clipNumber,
            durationSec: durSec,
          })
        : '';
      const vid = safeVid
        ? applyClipFlowVideoEngineTag(
            safeVid,
            resolveClipFlowVideoEngine(c, projectEngineMode, references),
            durSec,
            null
          )
        : '';
      return [img, vid].filter(Boolean).join('\n\n');
    })
    .filter(Boolean)
    .join('\n\n');
  return body ? `${header}\n\n${body}` : '';
}

export const AUTO_SKELETON_PROMPT_RE =
  /\((?:Ruta Principal(?:\s+Completa)?|Arco Integral|Tema Central)[^)]*\)|Authentic historical visual scene for|Create an image of a .* shot in \(Ruta Principal|Create an image of escena cinematogr[aá]fica documental correspondiente a:|depicting the historical documentary scene with dramatic cinematic lighting, historical accuracy, photorealistic 8k film still/i;

export function isAutoSkeletonPromptText(text?: string | null): boolean {
  if (!text) return false;
  const trimmed = String(text).trim();
  if (!trimmed) return false;
  return AUTO_SKELETON_PROMPT_RE.test(trimmed);
}

export function stripOperationalHeaderOnly(raw?: string | null): string {
  const trimmed = String(raw || '').trim();
  if (!trimmed) return '';
  const firstPromptIdx = trimmed.search(
    /(?:^|\n)\s*(?:[#*\-\d.)\s]*)(?:Image|Imagen|Clip)\s*\[?0*\d+\]?\s*(?:\([^)]*\))?\s*[:(\-–]/i
  );
  if (firstPromptIdx >= 0) {
    return trimmed.slice(firstPromptIdx).trim();
  }
  if (
    /^(?:Act[uú]a como un historiador|Act as a (?:professional |master )?historian|Before generating anything)/i.test(
      trimmed
    ) ||
    /Cambia\s+los\s+nombres\s+de\s+los\s+clips/i.test(trimmed)
  ) {
    return '';
  }
  return trimmed;
}

/**
 * Clasificación semántica de calidad para rawClipsText:
 *  2 = Prompts reales de autor / Gemini (sin marcadores de auto-esqueleto)
 *  1 = Auto-esqueleto sintético ((Ruta Principal...), (Arco Integral...), (Tema Central...))
 *  0 = Vacío o únicamente el Operational Header sin bloques de prompts
 */
export function getRawClipsQualityTier(raw?: string | null): 0 | 1 | 2 {
  const body = stripOperationalHeaderOnly(raw);
  if (!body) return 0;
  if (isAutoSkeletonPromptText(body)) return 1;
  return 2;
}

export function isClipRealAuthored(clip?: Partial<DocumentaryClip> | null): boolean {
  if (!clip) return false;
  const img = String(clip.imagePrompt || '').trim();
  const vid = String(clip.videoPrompt || '').trim();
  if (!img && !vid) return false;
  if (isAutoSkeletonPromptText(img) || isAutoSkeletonPromptText(vid)) return false;
  return true;
}

export function countRealAuthoredClips(clips?: DocumentaryClip[] | null): number {
  if (!Array.isArray(clips) || clips.length === 0) return 0;
  let count = 0;
  for (const c of clips) {
    if (isClipRealAuthored(c)) count++;
  }
  return count;
}

export function countAuthoredBlocksInRawText(raw?: string | null): number {
  const body = stripOperationalHeaderOnly(raw);
  if (!body || isAutoSkeletonPromptText(body)) return 0;
  const uniqueSceneNumbers = new Set<number>();
  const blockRe =
    /(?:^|\n)\s*(?:[#*\-\d.)\s]*)(?:Clip|Image|Imagen)\s*\[?0*(\d+)\]?\s*(?:\([^)]*\))?\s*[:\-–]/gi;
  let m: RegExpExecArray | null;
  while ((m = blockRe.exec(body)) !== null) {
    const num = parseInt(m[1], 10);
    if (num > 0) uniqueSceneNumbers.add(num);
  }
  return uniqueSceneNumbers.size;
}

export interface SafeRebuildRawClipsOptions {
  clips?: DocumentaryClip[] | null;
  previousRawText?: string | null;
  fallbackRawText?: string | null;
  operationalHeader?: string;
  engineMode?: FlowProjectEngineMode;
  projectEngineMode?: FlowProjectEngineMode;
  clip1Sec?: number;
  clip1DurationSec?: number;
  standardClipSec?: number;
  standardClipDurationSec?: number;
  references?: ReferenceAsset[];
}

/**
 * Reconstruye o resuelve el texto completo de prompts (con encabezado operativo actualizado)
 * garantizando que NUNCA devuelva vacío ni ampute bloques cuando clips[] son esqueletos vacíos o parciales.
 */
export function safeRebuildRawClipsText(options: SafeRebuildRawClipsOptions): string;
export function safeRebuildRawClipsText(
  clips: DocumentaryClip[] | undefined | null,
  fallbackRawText: string | undefined | null,
  operationalHeader?: string,
  projectEngineMode?: FlowProjectEngineMode,
  clip1DurationSec?: number,
  standardClipDurationSec?: number,
  references?: ReferenceAsset[]
): string;
export function safeRebuildRawClipsText(
  clipsOrOptions: DocumentaryClip[] | SafeRebuildRawClipsOptions | undefined | null,
  fallbackRawText?: string | null,
  operationalHeader: string = DEFAULT_OPERATIONAL_HEADER,
  projectEngineMode: FlowProjectEngineMode = 'HYBRID_PEOPLE_OMNI_REST_LOWER',
  clip1DurationSec?: number,
  standardClipDurationSec?: number,
  references?: ReferenceAsset[]
): string {
  const isOptionsObj =
    Boolean(clipsOrOptions) && !Array.isArray(clipsOrOptions) && typeof clipsOrOptions === 'object';
  const clips = isOptionsObj
    ? (clipsOrOptions as SafeRebuildRawClipsOptions).clips
    : (clipsOrOptions as DocumentaryClip[] | undefined | null);
  const prevRaw = String(
    (isOptionsObj
      ? (clipsOrOptions as SafeRebuildRawClipsOptions).previousRawText ??
        (clipsOrOptions as SafeRebuildRawClipsOptions).fallbackRawText
      : fallbackRawText) || ''
  );
  const effEngineMode: FlowProjectEngineMode =
    (isOptionsObj
      ? (clipsOrOptions as SafeRebuildRawClipsOptions).engineMode ||
        (clipsOrOptions as SafeRebuildRawClipsOptions).projectEngineMode
      : projectEngineMode) || 'HYBRID_PEOPLE_OMNI_REST_LOWER';
  const effHeaderInput =
    (isOptionsObj
      ? (clipsOrOptions as SafeRebuildRawClipsOptions).operationalHeader
      : operationalHeader) || DEFAULT_OPERATIONAL_HEADER;
  const effClip1Sec = isOptionsObj
    ? (clipsOrOptions as SafeRebuildRawClipsOptions).clip1Sec ??
      (clipsOrOptions as SafeRebuildRawClipsOptions).clip1DurationSec
    : clip1DurationSec;
  const effStdSec = isOptionsObj
    ? (clipsOrOptions as SafeRebuildRawClipsOptions).standardClipSec ??
      (clipsOrOptions as SafeRebuildRawClipsOptions).standardClipDurationSec
    : standardClipDurationSec;
  const effRefs = isOptionsObj
    ? (clipsOrOptions as SafeRebuildRawClipsOptions).references
    : references;

  const cleanHeader = sanitizeOperationalHeader(effHeaderInput, effEngineMode);
  const authoredClipCount = countRealAuthoredClips(clips);
  const prevTier = getRawClipsQualityTier(prevRaw);
  const prevBlockCount = countAuthoredBlocksInRawText(prevRaw);

  const normalizeFallback = (): string => {
    if (!prevRaw.trim() || prevTier === 0) return '';
    const withHeader = ensureOperationalHeaderInRawClips(
      prevRaw,
      cleanHeader,
      effEngineMode
    );
    if (effEngineMode !== 'VEO_3_1_LITE_LOWER_PRIORITY') {
      return withHeader;
    }
    // Clean legacy [Model: Omni ...] / [Model: Veo ...] video clip tags while preserving [Model: Nano Banana 2.1]
    return withHeader
      .replace(/\s*\[Model:\s*(?!Nano\s+Banana\b)(?:[^\[\]]|\[[^\]]*\])*\]/gi, '')
      .replace(/[ \t]{2,}/g, ' ')
      .replace(/[ \t]+\n/g, '\n')
      .trim();
  };

  if (authoredClipCount === 0) {
    return normalizeFallback();
  }

  if (
    prevTier === 2 &&
    prevBlockCount > authoredClipCount &&
    authoredClipCount < Math.floor(prevBlockCount * 0.85)
  ) {
    return normalizeFallback();
  }

  const rebuilt = buildRawClipsTextWithHeader(
    clips || [],
    cleanHeader,
    effEngineMode,
    effClip1Sec,
    effStdSec,
    effRefs
  );
  if (!rebuilt.trim()) {
    return normalizeFallback();
  }
  return rebuilt;
}

// ============================================================================
// 0. HELPER DE DURACIONES SELECCIONADAS EN ETAPA 1 (Clip 1 y Clips 2+)
// ============================================================================
export function getStage1ClipDurations(doc?: any): {
  clip1Sec: number;
  standardClipSec: number;
  voiceEntrySec: number;
  effectiveVoiceEntrySec: number;
  targetDurationSec: number;
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
  let standardClipSec = 8;
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

  const voiceEntrySec = clip1Sec <= 6 ? clip1Sec + 2 : clip1Sec;
  // Seconds of the video WITHOUT narration besides the Outro: the Clip 1 hook plus the 8s Official Brand Intro.
  // The Intro takes its 8 seconds in both options — at 00:00 (Opción A) or right after the opening Slogan
  // (Opción B, where the editor pauses the voice for it) — so the word budget must reserve them either way.
  const effectiveVoiceEntrySec = voiceEntrySec + 8;
  const rawTargetDur =
    Number(doc?.targetDurationSeconds) ||
    parseInt(String(doc?.promptConfig?.DURACION_TOTAL_SEGUNDOS || ''), 10);
  const targetDurationSec =
    Number.isFinite(rawTargetDur) && rawTargetDur >= 30 ? rawTargetDur : 900;

  return {
    clip1Sec,
    standardClipSec,
    voiceEntrySec,
    effectiveVoiceEntrySec,
    targetDurationSec,
  };
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
  // The on-screen graphics block Stage 8 writes after the last clip is never part of a prompt
  rawText = splitScreenGraphicsBlock(rawText).body;

  // Normalize pipe-separated blocks if AI returned multiple prompts on a single line
  const normalizedText = rawText
    .replace(/\r\n/g, '\n')
    .replace(/\s*\|\s*(?=(?:[#*\-\d.)\s]*)(?:Image|Imagen|Clip)\s*\[?\d+)/gi, '\n');
  const lines = normalizedText.split('\n');
  const clipsMap = new Map<number, DocumentaryClip>();
  const existingByNum = new Map<number, DocumentaryClip>();
  for (const c of existingClips) {
    existingByNum.set(c.clipNumber, c);
  }

  let currentClipNum = 0;

  const ensureClip = (num: number): DocumentaryClip => {
    if (!clipsMap.has(num)) {
      const prev = existingByNum.get(num);
      clipsMap.set(
        num,
        prev
          ? { ...prev }
          : {
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
            }
      );
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
      /^(?:[#*\-\d.)\s]*)(?:Image|Imagen)\s*\[?0*(\d+)\]?\s*(?:[\(\[]([0-9:]+\s*(?:-|–|—|to)\s*[0-9:]+)[\)\]])?\s*[:\-–]\s*(.+)$/i
    );
    const clipPromptMatch = line.match(
      /^(?:[#*\-\d.)\s]*)(?:Clip)\s*\[?0*(\d+)\]?\s*(?:[\(\[]([0-9:]+\s*(?:-|–|—|to)\s*[0-9:]+)[\)\]])?\s*[:\-–]\s*(.+)$/i
    );

    if (imageLineMatch) {
      const num = parseInt(imageLineMatch[1], 10);
      const headerRangeRaw = imageLineMatch[2]
        ? imageLineMatch[2].replace(/\s*(?:-|–|—|to)\s*/, ' - ').trim()
        : '';
      const bodyRaw = imageLineMatch[3].trim();
      // Ignore template placeholder lines such as "Image [N]: Create an image of [escena..."
      if (/^\[escena/i.test(bodyRaw) || num <= 0) continue;
      currentClipNum = num;
      const clip = ensureClip(num);
      const inlineTimeRange = extractInlineTimeRangeFromPrompt(bodyRaw) || headerRangeRaw;
      if (inlineTimeRange) clip.timeRange = inlineTimeRange;
      const normalizedBody = /^Create an image/i.test(bodyRaw)
        ? bodyRaw
        : `Create an image of ${bodyRaw}`;
      const targetSec = num === 1 ? clip1Duration : standardClipDuration;
      const numStr = num < 10 ? String(num).padStart(2, '0') : String(num);
      const imgBrollMeta = parseBrollMotionFromText(normalizedBody, clip.cameraSelection, clip.visualExplanation);
      if (isImageOnlyBrollPrompt(normalizedBody) || imgBrollMeta.isStaticBroll) {
        const motion = imgBrollMeta.brollCameraMotion || clip.brollCameraMotion || 'zoom_in';
        clip.isStaticBroll = true;
        clip.brollCameraMotion = motion;
        if (clip.videoPrompt && !/STATIC\s+B-ROLL\s+PLATE\s+LOCK/i.test(clip.videoPrompt)) {
          clip.previousVideoPrompt = clip.previousVideoPrompt || clip.videoPrompt;
        }
        clip.videoPrompt = '';
        clip.imagePrompt = normalizeBrollImagePrompt(
          `Image ${numStr}: ${normalizedBody}`,
          num,
          clip.timeRange,
          targetSec,
          motion
        );
      } else {
        clip.imagePrompt = ensureAntiMutationPhysicsInPrompt(`Image ${numStr}: ${normalizedBody}`, true, targetSec);
      }
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
      const normalizedBody = /^(?:Create\s+a|Generate\s+a\s+video)/i.test(bodyRaw)
        ? bodyRaw
        : `Generate a video in 16-9 horizontal aspect ratio across ${num === 1 ? clip1Duration : standardClipDuration} seconds showing ${bodyRaw}`;
      const targetSec = num === 1 ? clip1Duration : standardClipDuration;
      const numStr = num < 10 ? String(num).padStart(2, '0') : String(num);
      const candidateVideoPrompt = ensureAntiMutationPhysicsInPrompt(
        `Clip ${numStr}: ${normalizedBody}`,
        false,
        targetSec
      );
      const brollMeta = parseBrollMotionFromText(candidateVideoPrompt, clip.cameraSelection);
      if (brollMeta.isStaticBroll) {
        const motion = brollMeta.brollCameraMotion || clip.brollCameraMotion || 'zoom_in';
        clip.isStaticBroll = true;
        clip.brollCameraMotion = motion;
        clip.previousVideoPrompt = clip.previousVideoPrompt || candidateVideoPrompt;
        clip.videoPrompt = '';
        if (clip.imagePrompt) {
          clip.imagePrompt = normalizeBrollImagePrompt(
            clip.imagePrompt,
            num,
            clip.timeRange,
            targetSec,
            motion
          );
        }
      } else {
        clip.videoPrompt = candidateVideoPrompt;
      }
      continue;
    }

    if (headerMatch && !/\b(?:create|generate)\s+a\s+video\b/i.test(line)) {
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

  if (clipsMap.size === 0) return existingClips;
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
    if (
      !line ||
      line.startsWith('===') ||
      /^(?:CANTIDAD DE PALABRAS|PALABRAS POR MINUTO|DURACI[ÓO]N|BLOQUES SIN VOZ)/i.test(line)
    ) {
      continue;
    }
    // Soportar: "1 00:06 - 00:16 Texto..." o "00:06 - 00:16 Texto..." o "[00:06 - 00:16] | Texto..."
    const m = line.match(
      /^(?:\d+(?:[\s.)\-]+))?\[?(\d{1,3}:\d{2}(?::\d{2}(?:[,.]\d{1,3})?)?)\s*(?:-|-->|–|—)\s*(\d{1,3}:\d{2}(?::\d{2}(?:[,.]\d{1,3})?)?)\]?\s*[:\-|]?\s*(.+)$/
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

/**
 * Limpia el guion de voz en off dejando EXCLUSIVAMENTE el texto narrable y las etiquetas [pausa: Xs].
 * Elimina encabezados de etapa/bloque ("ETAPA 4: GUION..."), rangos de minutos/segundos ("(00:00 - 00:08 | Intro...)"),
 * acotaciones técnicas ("(00:16 | Entrada exacta...)", "(19:52 - 20:00 | Outro...)", "[Párrafo 1]:", "Narrador:")
 * y reportes finales de conteo o despedida de la IA, para que VoxFlow jamás los pronuncie.
 */
export function cleanVoiceoverNarrationOnly(rawText: string): string {
  if (!rawText) return '';
  let s = String(rawText).replace(/\r\n/g, '\n').trim();
  s = s.replace(/^```(?:[a-zA-Z0-9_-]+)?\s*\n?/i, '').replace(/\n?```\s*$/i, '');

  // 1. Eliminar paréntesis con marcas MM:SS o acotaciones técnicas de edición/sonido
  s = s.replace(
    /\(\s*(?:\d{1,2}:\d{2}(?::\d{2})?(?:\s*[-–—a]\s*\d{1,2}:\d{2}(?::\d{2})?)?[^)]*|(?:Intro\s+Oficial|Outro\s+Oficial|Clip\s+\d+|Hook\s+Visual|Sin\s+voz|Entrada\s+(?:exacta\s+)?de\s+la\s+voz|Foley|SFX|Efecto\s+de\s+sonido|M[uú]sica\s+de\s+fondo|Sonido\s+(?:seco|ambiente)|Texto\s+en\s+pantalla|Fin\s+del\s+guion|Cierre\s+institucional)[^)]*)\s*\)/gi,
    ''
  );

  // 2. Eliminar corchetes de estructura/etiquetas técnicas (preservando intactas [pausa: Xs] / [1.5s])
  s = s.replace(
    /\[\s*(?:\d{1,2}:\d{2}(?::\d{2})?(?:\s*[-–—a]\s*\d{1,2}:\d{2}(?::\d{2})?)?\s*(?:\||[-–—:])[^[\]]*|(?:Intro\s+Oficial|Outro\s+Oficial|Clip\s+\d+|Hook\s+Visual|Sin\s+voz|Entrada\s+(?:exacta\s+)?de\s+la\s+voz|P[aá]rrafo\s+(?:\d+|final)|Slogan\s+(?:Completo|Corto)|Cierre\s+en\s+p[aá]rrafo|Foley|SFX|M[uú]sica|Texto\s+en\s+pantalla|Narrador|Voz\s+en\s+off|Locutor)[^[\]]*)\s*\]\s*:?\s*/gi,
    ''
  );

  const outLines: string[] = [];
  for (const rawLine of s.split('\n')) {
    let l = rawLine.trim();
    if (!l) continue;
    const plain = l
      .replace(/^#{1,6}\s+/, '')
      .replace(/^\*+|\*+$/g, '')
      .trim();

    // Encabezados de etapa o guion
    if (
      /^(?:[-—*]+\s*)?(?:ETAPA\s+\d+|PASO\s+\d+[A-Z]?|GUION\s+DE\s+(?:LA\s+)?VOZ\s+EN\s+OFF|GUION\s+NARRATIVO|VOZ\s+EN\s+OFF\s+COMPLETA|LOCUCI[OÓ]N\s+DOCUMENTAL)(?:\s*[:—\-|(].*)?$/i.test(
        plain
      )
    ) {
      continue;
    }
    // Títulos sueltos de bloques / secciones / capítulos / actos ("Acto I:...", pero NUNCA "Acto seguido,...")
    if (/^(?:BLOQUE|SECCI[OÓ]N|CAP[IÍ]TULO|PARTE)\s+\d+\s*(?:[:.\-—|(].*)?$/i.test(plain)) {
      continue;
    }
    if (/^ACTO\s+(?:[IVXLC]+|\d+)\s*(?:[:.\-—|(].*)?$/i.test(plain)) {
      continue;
    }
    if (/^[-—*_]{3,}$/.test(plain)) {
      continue;
    }
    // Líneas formadas únicamente por un rango o marca de tiempo
    if (
      /^\d{1,2}:\d{2}(?::\d{2})?(?:\s*[-–—a]\s*\d{1,2}:\d{2}(?::\d{2})?)?\s*(?:\|.*)?$/i.test(
        plain
      )
    ) {
      continue;
    }
    // Reportes finales de conteo / duración o preguntas de cierre de la IA
    if (
      /^(?:[-—*•]+\s*)?(?:Caracteres\s+Totales|Palabras\s+Totales|Conteo\s+de\s+(?:palabras|caracteres)|Extensi[oó]n\s+(?:total|estimada|aproximada|final)|Pausas\s+Narrativas\s*:|Duraci[oó]n\s+Total\s+Estimada|Tiempo\s+Neto\s+de\s+Voz|Reporte\s+al\s+pie|¿Deseas\s+(?:pasar|continuar|que\s+proceda|avanzar)|¿Est[aá]s\s+listo\s+para\s+(?:pasar|proceder)|Por\s+favor\s+confirma\s+si\s+el\s+guion)/i.test(
        plain
      )
    ) {
      continue;
    }

    l = l.replace(/^#{1,6}\s+/, '');
    l = l.replace(
      /^\s*(?:\*+)?(?:Narrador|Voz\s+en\s+[Oo]ff|Locutor|Audio|Voiceover)\s*(?:\*+)?\s*:\s*/i,
      ''
    );
    l = l.replace(
      /^\s*\d{1,2}:\d{2}(?::\d{2})?(?:\s*[-–—]\s*\d{1,2}:\d{2}(?::\d{2})?)?\s*(?:\||[-–—:])\s*/,
      ''
    );
    l = l
      .replace(/\*\*([^*]+)\*\*/g, '$1')
      .replace(/\*([^*]+)\*/g, '$1')
      .replace(/\s{2,}/g, ' ')
      .trim();

    if (l) outLines.push(l);
  }

  return outLines.join('\n\n');
}

// Velocidad real medida empíricamente en Gemini 3.8 Flash TTS (Charon, español neutro documental): ~147 palabras/min (2.45 palabras/seg)
export const CALIBRATED_TTS_WORDS_PER_MINUTE = 147;
export const CALIBRATED_TTS_WORDS_PER_SEC = CALIBRATED_TTS_WORDS_PER_MINUTE / 60; // 2.45

export function computeCalibratedVoiceoverBudget(
  targetDurationSeconds: number,
  effectiveVoiceEntrySec: number = 16,
  fixedOutroSec: number = 8,
  actualPauseSeconds?: number
): {
  totalDurationSec: number;
  totalMinutesLabel: string;
  effectiveVoiceEntrySec: number;
  fixedOutroSec: number;
  estPauseSec: number;
  netSpeechSec: number;
  targetWords: number;
  minWords: number;
  maxWords: number;
  targetChars: number;
} {
  const rawDur = Number(targetDurationSeconds);
  const totalDurationSec = Math.max(30, Number.isFinite(rawDur) && rawDur > 0 ? rawDur : 900);
  const safeEntrySec =
    Number.isFinite(Number(effectiveVoiceEntrySec)) && Number(effectiveVoiceEntrySec) >= 0
      ? Number(effectiveVoiceEntrySec)
      : 16;
  const safeOutroSec =
    Number.isFinite(Number(fixedOutroSec)) && Number(fixedOutroSec) >= 0
      ? Number(fixedOutroSec)
      : 8;
  const totalMin = totalDurationSec / 60;
  const totalMinutesLabel = Number.isInteger(totalMin)
    ? `${totalMin}`
    : totalMin.toFixed(1);
  const defaultPauseSec =
    totalDurationSec >= 300
      ? Math.min(45, Math.max(8, Math.round(totalMin * 1.35)))
      : Math.max(2, Math.round(totalDurationSec * 0.04));
  const estPauseSec =
    actualPauseSeconds !== undefined &&
    Number.isFinite(Number(actualPauseSeconds)) &&
    Number(actualPauseSeconds) >= 0
      ? Number(actualPauseSeconds)
      : defaultPauseSec;
  const netSpeechSec = Math.max(
    10,
    totalDurationSec - safeEntrySec - safeOutroSec - estPauseSec
  );
  const targetWords = Math.max(25, Math.round(netSpeechSec * CALIBRATED_TTS_WORDS_PER_SEC));
  const minWords = Math.max(20, Math.round(targetWords * 0.92));
  const maxWords = Math.max(30, Math.round(targetWords * 1.06));
  const targetChars = Math.round(targetWords * 6.05);
  return {
    totalDurationSec,
    totalMinutesLabel,
    effectiveVoiceEntrySec: safeEntrySec,
    fixedOutroSec: safeOutroSec,
    estPauseSec,
    netSpeechSec,
    targetWords,
    minWords,
    maxWords,
    targetChars,
  };
}

function splitParagraphIntoSentencesWithPauses(paragraph: string): string[] {
  const pauseTokens: string[] = [];
  const pauseRe = new RegExp(UNIVERSAL_PAUSE_REGEX.source, 'gi');
  let masked = paragraph.replace(pauseRe, (m) => {
    const idx = pauseTokens.length;
    pauseTokens.push(m);
    return `⟪PAUSE_${idx}⟫`;
  });

  // Protect common abbreviations ("St. Mary", "Dr. Fleming", "Sr.", "EE. UU.") so they never split mid-sentence
  masked = masked.replace(
    /\b(St|Dr|Dra|Sr|Sra|Prof|Gral|Cap|Cnel|Mons|Sto|Sta|Av|EE|UU|Jr|Inc|Ltd|vs|ej|aprox)\.\s+/gi,
    '$1\u0000 '
  );
  masked = masked.replace(/\s+(⟪PAUSE_\d+⟫)/g, ' $1');

  const rawParts = masked
    .split(/(?<=[.?!]["»”)]?(?:\s+⟪PAUSE_\d+⟫)*)\s+(?=[¿¡"«“A-ZÁÉÍÓÚÑ0-9])/g)
    .map((part) =>
      part
        .replace(/\u0000/g, '.')
        .replace(/⟪PAUSE_(\d+)⟫/g, (_, idx) => pauseTokens[Number(idx)] || '')
        .replace(/\s{2,}/g, ' ')
        .trim()
    )
    .filter(Boolean);

  return rawParts.length > 0
    ? rawParts
    : [
        paragraph
          .replace(/\s{2,}/g, ' ')
          .trim(),
      ].filter(Boolean);
}

/**
 * Ajusta automáticamente el guion narrativo a la duración elegida en Etapa 1:
 * 1) Limpia encabezados, marcas MM:SS, acotaciones técnicas y cierres de IA (`cleanVoiceoverNarrationOnly`).
 * 2) Calcula el presupuesto real de palabras según la duración objetivo del documental (147 WPM en Charon).
 * 3) Si el guion excede la duración objetivo (> maxWords), condensa proporcionalmente las oraciones secundarias
 *    a lo largo de todos los párrafos del cuerpo, preservando intactos el Gancho en Tríada, el Slogan Completo,
 *    la cronología de cada párrafo, los nombres propios, las preguntas de retención, todas las etiquetas [pausa: Xs]
 *    y el Cierre Institucional.
 */
/**
 * Opción B (Intro tras el Slogan): the editor and the exporter pause the narration for the 8s Intro by
 * themselves. A script that ALSO carries a long pause right after the opening Slogan ("[pausa: 8s]", as
 * older orders asked) would leave a double hole, so that pause is brought down to a short breath.
 */
export function normalizeOpeningSloganIntroPause(script: string): string {
  const text = String(script || '');
  const m = /seguimos\s+sus\s+rastros[.…"”»']*/i.exec(text.slice(0, 4000));
  if (!m) return text;
  const afterIdx = m.index + m[0].length;
  const rest = text.slice(afterIdx);
  const pauseRe = new RegExp(`^(\\s*)(?:${UNIVERSAL_PAUSE_REGEX.source})`, 'i');
  const pm = pauseRe.exec(rest);
  if (!pm) return text;
  const tag = pm[0].slice(pm[1].length);
  const info = extractPausesInfo(tag);
  if (!(info.totalSeconds >= 5)) return text;
  return `${text.slice(0, afterIdx)}${pm[1]}[pausa: 2s]${rest.slice(pm[0].length)}`;
}

export interface NarrationGridItem {
  kind: 'word' | 'pause';
  text: string;
  start: number;
  end: number;
  mid: number;
}

/**
 * Opción B (Intro tras el Slogan) — narration table on the video's real clock.
 * Finds where the opening Slogan ("...Aquí seguimos sus rastros.") ends in the narration, splits the clips
 * before it into equal slots that end exactly there, reserves the 8 seconds of the Official Brand Intro,
 * and restarts the regular grid after it (everything after the Slogan moves 8 seconds later).
 * Returns null when the Slogan cannot be located, so the caller keeps its plain continuous grid.
 */
export function buildPostSloganIntroGridBlocks(
  positioned: NarrationGridItem[],
  opts: { voiceStartSec: number; voiceEndSec: number; segLen: number; introSec?: number }
): {
  sentences: Array<{ text: string; start: number; end: number }>;
  srtSentences: Array<{ text: string; start: number; end: number }>;
  introStartSec: number;
} | null {
  const introSec = opts.introSec && opts.introSec > 0 ? opts.introSec : 8;
  const segLen = Math.max(2, Number(opts.segLen) || 8);
  const voiceStartSec = Number(opts.voiceStartSec) || 0;
  const norm = (t: string) =>
    String(t || '')
      .toLowerCase()
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/[^a-z0-9]/g, '');
  const wordIdxs: number[] = [];
  positioned.forEach((p, i) => {
    if (p.kind === 'word') wordIdxs.push(i);
  });
  let sloganLastWordPos = -1;
  for (let w = 2; w < wordIdxs.length; w++) {
    const cur = positioned[wordIdxs[w]];
    if (cur.start > voiceStartSec + 150) break;
    if (
      norm(cur.text) === 'rastros' &&
      norm(positioned[wordIdxs[w - 1]].text) === 'sus' &&
      norm(positioned[wordIdxs[w - 2]].text) === 'seguimos'
    ) {
      sloganLastWordPos = w;
      break;
    }
  }
  // The Slogan must be followed by more narration, and sit far enough from the start to hold at least one clip
  if (sloganLastWordPos < 0 || sloganLastWordPos >= wordIdxs.length - 1) return null;
  const sloganEndSec = positioned[wordIdxs[sloganLastWordPos]].end;
  const nextWordStartSec = positioned[wordIdxs[sloganLastWordPos + 1]].start;
  const gapSec = Math.max(0, nextWordStartSec - sloganEndSec);
  const splitSec = sloganEndSec + Math.min(gapSec / 2, 1.5);
  const introStartSec = Math.round(splitSec);
  const preSpan = introStartSec - voiceStartSec;
  if (preSpan < 3) return null;

  const preItems = positioned.filter((p) => p.start < splitSec);
  const postItems = positioned
    .filter((p) => p.start >= splitSec)
    .map((p) => ({ ...p, start: p.start + introSec, end: p.end + introSec, mid: p.mid + introSec }));

  const sentences: Array<{ text: string; start: number; end: number }> = [];
  const srtSentences: Array<{ text: string; start: number; end: number }> = [];
  const pushBlock = (inWindow: NarrationGridItem[], blockStart: number, blockEnd: number) => {
    const blockDur = Math.max(1, Math.round(blockEnd - blockStart));
    const spoken = inWindow.filter((p) => p.kind === 'word');
    if (spoken.length === 0) {
      sentences.push({
        text: `[SIN VOZ NARRATIVA — Pausa / Silencio Dramático (${blockDur}s)]`,
        start: blockStart,
        end: blockEnd,
      });
      return;
    }
    const textLine = inWindow
      .map((p) => p.text)
      .join(' ')
      .replace(/\s+/g, ' ')
      .trim();
    sentences.push({ text: textLine, start: blockStart, end: blockEnd });
    const realStart = Number(
      Math.max(blockStart, Math.min(blockEnd - 0.4, spoken[0].start)).toFixed(2)
    );
    const realEnd = Number(
      Math.min(blockEnd, Math.max(realStart + 0.5, spoken[spoken.length - 1].end)).toFixed(2)
    );
    srtSentences.push({ text: textLine, start: realStart, end: realEnd });
  };

  // 1) Clips before the Intro: equal whole-second slots (never longer than a regular clip) ending at the Slogan
  const preCount = Math.max(1, Math.ceil((preSpan - 0.15) / segLen));
  for (let b = 0; b < preCount; b++) {
    const isLast = b === preCount - 1;
    const blockStart = voiceStartSec + Math.round((b * preSpan) / preCount);
    const blockEnd = isLast ? introStartSec : voiceStartSec + Math.round(((b + 1) * preSpan) / preCount);
    pushBlock(
      preItems.filter((p) =>
        isLast ? p.mid >= blockStart : b === 0 ? p.mid < blockEnd : p.mid >= blockStart && p.mid < blockEnd
      ),
      blockStart,
      blockEnd
    );
  }

  // 2) The 8 seconds of the Official Brand Intro (the narration waits)
  const introBlock = {
    text: `[SIN VOZ NARRATIVA — Intro Oficial de Marca (${introSec}s)]`,
    start: introStartSec,
    end: introStartSec + introSec,
  };
  sentences.push(introBlock);
  srtSentences.push(introBlock);

  // 3) Regular grid for the rest of the narration, 8 seconds later on the video's clock
  const gridStart = introStartSec + introSec;
  const exactVoiceEndSec = Math.max(gridStart + 1, Math.round((Number(opts.voiceEndSec) || 0) + introSec));
  const span = Math.max(1, exactVoiceEndSec - gridStart);
  const rawBlocks = Math.max(1, Math.ceil((span - 0.15) / segLen));
  const tailRemainder = span - (rawBlocks - 1) * segLen;
  const totalBlocks = rawBlocks > 1 && tailRemainder > 0 && tailRemainder < 2 ? rawBlocks - 1 : rawBlocks;
  for (let b = 0; b < totalBlocks; b++) {
    const isLast = b === totalBlocks - 1;
    const blockStart = gridStart + b * segLen;
    const blockEnd = isLast ? exactVoiceEndSec : blockStart + segLen;
    pushBlock(
      postItems.filter((p) =>
        isLast && b === 0
          ? true
          : isLast
          ? p.mid >= blockStart
          : b === 0
          ? p.mid < blockEnd
          : p.mid >= blockStart && p.mid < blockEnd
      ),
      blockStart,
      blockEnd
    );
  }
  return { sentences, srtSentences, introStartSec };
}

export function autoFitVoiceoverScriptToDuration(
  rawText: string,
  docOrTargetSec?: any
): string {
  const cleanedRaw = cleanVoiceoverNarrationOnly(rawText);
  if (!cleanedRaw) return '';
  const cleaned =
    docOrTargetSec &&
    typeof docOrTargetSec === 'object' &&
    docOrTargetSec?.promptConfig?.UBICACION_INTRO_MARCA === 'INTRO_POST_SLOGAN'
      ? normalizeOpeningSloganIntroPause(cleanedRaw)
      : cleanedRaw;

  let targetDurationSec = 900;
  let effectiveVoiceEntrySec = 16;
  if (typeof docOrTargetSec === 'number' && Number.isFinite(docOrTargetSec) && docOrTargetSec > 0) {
    targetDurationSec = docOrTargetSec;
  } else if (docOrTargetSec && typeof docOrTargetSec === 'object') {
    const durs = getStage1ClipDurations(docOrTargetSec);
    targetDurationSec = durs.targetDurationSec;
    effectiveVoiceEntrySec = durs.effectiveVoiceEntrySec;
  }

  const countSpokenWords = (txt: string): number => {
    const plain = stripPauseTags(txt).trim();
    return plain ? plain.split(/\s+/).filter(Boolean).length : 0;
  };

  const pauseInfo = extractPausesInfo(cleaned);
  const budget = computeCalibratedVoiceoverBudget(
    targetDurationSec,
    effectiveVoiceEntrySec,
    8,
    pauseInfo.count > 0 ? pauseInfo.totalSeconds : undefined
  );

  let currentWords = countSpokenWords(cleaned);
  if (currentWords <= budget.maxWords) {
    return cleaned;
  }

  const paragraphs = cleaned
    .split(/\n+/)
    .map((p) => p.trim())
    .filter(Boolean);

  if (paragraphs.length === 0) return cleaned;

  // Single-block fallback if script had no line breaks
  if (paragraphs.length <= 2) {
    const allSents = splitParagraphIntoSentencesWithPauses(paragraphs.join(' '));
    if (allSents.length <= 3) return cleaned;
    const kept = [...allSents];
    while (kept.length > 3 && countSpokenWords(kept.join(' ')) > budget.targetWords) {
      const midIdx = Math.floor(kept.length / 2);
      kept.splice(midIdx, 1);
    }
    return kept.join(' ');
  }

  const headCount =
    paragraphs.length > 3 &&
    /En los pr[oó]ximos minutos|Cada historia deja una huella|Aqu[ií] seguimos sus rastros/i.test(
      paragraphs[1]
    )
      ? 2
      : 1;

  let tailCount = 1;
  if (
    paragraphs.length > headCount + 2 &&
    /D[eé]janos saber en los comentarios|Cada historia deja una huella/i.test(
      paragraphs[paragraphs.length - 2]
    )
  ) {
    tailCount = 2;
  }

  const headParas = paragraphs.slice(0, headCount);
  const tailParas = paragraphs.slice(paragraphs.length - tailCount);
  const bodyRaw = paragraphs.slice(headCount, paragraphs.length - tailCount);
  if (bodyRaw.length === 0) return cleaned;

  interface SentenceEntry {
    text: string;
    words: number;
    hasPause: boolean;
    pauseTags: string[];
    keepScore: number;
    dropped: boolean;
  }

  const seenProperNames = new Set<string>();
  const properNameGlobalRe =
    /\b([A-ZÁÉÍÓÚÑ][a-záéíóúñ]{2,}\s+[A-ZÁÉÍÓÚÑ][a-záéíóúñ]{2,})\b/g;
  const nonPersonTwoWords =
    /^(Segunda Guerra|Primera Guerra|Gran Bretaña|Estados Unidos|Reino Unido|Nueva York|Edad Media|Guerra Mundial|Cruz Roja|Casa Blanca|Hospital St|Enfermería Radcliffe|Año \d)/i;

  for (const hp of headParas) {
    let mName: RegExpExecArray | null;
    while ((mName = properNameGlobalRe.exec(hp)) !== null) {
      seenProperNames.add(mName[1].toLowerCase());
    }
  }

  const pauseExtractRe = new RegExp(UNIVERSAL_PAUSE_REGEX.source, 'gi');
  const bodyModels = bodyRaw.map((p) => {
    const rawSents = splitParagraphIntoSentencesWithPauses(p);
    const sentences: SentenceEntry[] = rawSents.map((s, idx) => {
      const pauseMatches = s.match(pauseExtractRe) || [];
      const hasPause = pauseMatches.length > 0;
      const w = countSpokenWords(s);
      const isFirst = idx === 0;
      const isLast = idx === rawSents.length - 1;
      const isQuestion = /\?/.test(s);
      const hasExactDateOrYear = /\b\d{4}\b/.test(s);

      let introducesNewProperName = false;
      const strippedLeadWord = s.replace(/^[A-ZÁÉÍÓÚÑ][a-záéíóúñ]+\s+/, '');
      let mName: RegExpExecArray | null;
      properNameGlobalRe.lastIndex = 0;
      while ((mName = properNameGlobalRe.exec(strippedLeadWord)) !== null) {
        const candidate = mName[1];
        if (!nonPersonTwoWords.test(candidate)) {
          const key = candidate.toLowerCase();
          if (!seenProperNames.has(key)) {
            seenProperNames.add(key);
            introducesNewProperName = true;
          }
        }
      }

      const hasPivot =
        /^(Sin embargo|Pero|No obstante|Fue entonces|El resultado|Lo que nadie|Nadie imaginaba|Al quinto|Al cabo|Contra todo|El \d{1,2} de [a-záéíóú]+)/i.test(
          s
        );
      const hasActionEnding =
        /(detuvo en seco|expiró|perdió la vida|cambió para siempre|descubrió|reveló|hundió la aguja|estalló|colapsó|sentenció|firmó|ordenó)/i.test(
          s
        );

      let keepScore = 320;
      if (isFirst) keepScore = 1000;
      else if (isQuestion) keepScore = 960;
      else if (introducesNewProperName) keepScore = 925;
      else if (isLast && hasPause) keepScore = 910;
      else if (hasPause) keepScore = 880;
      else if (isLast && (hasPivot || hasActionEnding)) keepScore = 840;
      else if (hasPivot) keepScore = 700;
      else if (idx === 1) keepScore = 610;
      else if (isLast) keepScore = 580;
      else if (hasExactDateOrYear) keepScore = 520;

      return {
        text: s,
        words: w,
        hasPause,
        pauseTags: pauseMatches,
        keepScore,
        dropped: false,
      };
    });

    return {
      sentences,
      droppedParagraph: false,
    };
  });

  const transferPauseBeforeDrop = (sents: SentenceEntry[], dropIdx: number) => {
    const target = sents[dropIdx];
    if (!target.hasPause || target.pauseTags.length === 0) return;
    for (let j = dropIdx - 1; j >= 0; j--) {
      if (!sents[j].dropped) {
        if (!sents[j].hasPause) {
          sents[j].text = `${sents[j].text} ${target.pauseTags.join(' ')}`.trim();
          sents[j].hasPause = true;
          sents[j].pauseTags = [...target.pauseTags];
        }
        return;
      }
    }
    for (let j = dropIdx + 1; j < sents.length; j++) {
      if (!sents[j].dropped) {
        if (!sents[j].hasPause) {
          sents[j].text = `${sents[j].text} ${target.pauseTags.join(' ')}`.trim();
          sents[j].hasPause = true;
          sents[j].pauseTags = [...target.pauseTags];
        }
        return;
      }
    }
  };

  // Pass 1: Uniform proportional sentence condensation across all body paragraphs (preserving >= 2 sentences per paragraph)
  while (currentWords > budget.targetWords) {
    let bestP = -1;
    let bestS = -1;
    let lowestEffScore = Infinity;

    for (let pIdx = 0; pIdx < bodyModels.length; pIdx++) {
      const pm = bodyModels[pIdx];
      const activeCount = pm.sentences.filter((s) => !s.dropped).length;
      if (activeCount <= 2) continue;
      const droppedRatio =
        pm.sentences.filter((s) => s.dropped).length / Math.max(1, pm.sentences.length);

      for (let sIdx = 1; sIdx < pm.sentences.length; sIdx++) {
        const st = pm.sentences[sIdx];
        if (st.dropped) continue;
        const effScore = st.keepScore + droppedRatio * 240;
        if (effScore < lowestEffScore) {
          lowestEffScore = effScore;
          bestP = pIdx;
          bestS = sIdx;
        }
      }
    }

    if (bestP === -1 || bestS === -1) break;
    const chosen = bodyModels[bestP].sentences[bestS];
    transferPauseBeforeDrop(bodyModels[bestP].sentences, bestS);
    chosen.dropped = true;
    currentWords -= chosen.words;
  }

  // Pass 2: Only for extreme compression ratios (e.g. 35-min draft into 5-min video), allow reducing to 1 anchor sentence per paragraph
  while (currentWords > budget.targetWords) {
    let bestP = -1;
    let bestS = -1;
    let lowestScore = Infinity;

    for (let pIdx = 0; pIdx < bodyModels.length; pIdx++) {
      const pm = bodyModels[pIdx];
      const activeCount = pm.sentences.filter((s) => !s.dropped).length;
      if (activeCount <= 1) continue;
      for (let sIdx = 1; sIdx < pm.sentences.length; sIdx++) {
        const st = pm.sentences[sIdx];
        if (st.dropped) continue;
        if (st.keepScore < lowestScore) {
          lowestScore = st.keepScore;
          bestP = pIdx;
          bestS = sIdx;
        }
      }
    }

    if (bestP === -1 || bestS === -1) break;
    const chosen = bodyModels[bestP].sentences[bestS];
    transferPauseBeforeDrop(bodyModels[bestP].sentences, bestS);
    chosen.dropped = true;
    currentWords -= chosen.words;
  }

  // Pass 3: Ultra-short target fallback (e.g. Shorts <= 3 min from a feature-length draft): drop evenly spaced non-pause middle paragraphs
  while (currentWords > budget.targetWords) {
    const activeBodyIndices = bodyModels
      .map((pm, idx) => ({ pm, idx }))
      .filter(
        ({ pm, idx }) =>
          !pm.droppedParagraph &&
          idx > 0 &&
          idx < bodyModels.length - 1 &&
          !pm.sentences.some((s) => !s.dropped && s.hasPause)
      );
    if (activeBodyIndices.length <= 2) break;
    const midPick = activeBodyIndices[Math.floor(activeBodyIndices.length / 2)];
    const paraWords = midPick.pm.sentences
      .filter((s) => !s.dropped)
      .reduce((acc, s) => acc + s.words, 0);
    midPick.pm.droppedParagraph = true;
    currentWords -= paraWords;
  }

  const rebuiltBody = bodyModels
    .filter((pm) => !pm.droppedParagraph)
    .map((pm) =>
      pm.sentences
        .filter((s) => !s.dropped)
        .map((s) => s.text)
        .join(' ')
        .replace(/\s{2,}/g, ' ')
        .trim()
    )
    .filter(Boolean);

  return [...headParas, ...rebuiltBody, ...tailParas].join('\n\n');
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
  const objArg =
    typeof arg1 === 'object' &&
    arg1 !== null &&
    !Array.isArray(arg1) &&
    !('nativeEvent' in (arg1 as Record<string, unknown>))
      ? arg1
      : null;
  const rawVoiceoverWithPauses: string = objArg
    ? typeof objArg.rawVoiceoverWithPauses === 'string'
      ? objArg.rawVoiceoverWithPauses
      : ''
    : typeof arg1 === 'string'
    ? arg1
    : '';
  const timelineText: string = objArg
    ? typeof objArg.timelineText === 'string'
      ? objArg.timelineText
      : ''
    : typeof arg2 === 'string'
    ? arg2
    : '';
  const rawClipsText: string = objArg
    ? typeof objArg.rawClipsText === 'string'
      ? objArg.rawClipsText
      : ''
    : typeof arg3 === 'string'
    ? arg3
    : '';
  const existingClips = objArg ? objArg.existingClips || [] : arg4 || [];
  const clip1Duration = objArg ? objArg.clip1Duration || 6 : 6;
  const standardClipDuration =
    objArg && Number(objArg.clipDuration) > 0 ? Number(objArg.clipDuration) : 8;
  const clip1SyncMode = (objArg ? objArg.clip1SyncMode : arg5) || 'VOZ_EN_CLIP_2';
  const docTopic = objArg && typeof objArg.topic === 'string' ? objArg.topic.trim() : '';
  const docTime = objArg && typeof objArg.historicalTime === 'string' ? objArg.historicalTime.trim() : '';
  const docLocation =
    objArg && typeof objArg.historicalLocation === 'string' ? objArg.historicalLocation.trim() : '';
  const docRefs = objArg && Array.isArray(objArg.references) ? objArg.references : [];
  const includeNarrationInClip = objArg ? Boolean(objArg.includeNarrationInClip === true) : false;

  const parsedFromPrompts = parseClipsFromRawText(
    rawClipsText,
    existingClips,
    clip1Duration,
    standardClipDuration
  );
  const rawTimelineSentences = parseTimelineTextToSentences(timelineText);
  const clip1TimelineMarker = rawTimelineSentences.find((s) =>
    /^\[SIN\s+VOZ\s+NARRATIVA[^\]]*Clip\s+1/i.test((s.text || '').trim())
  );
  let timelineSentences = rawTimelineSentences.filter(
    (s) =>
      !/^\[SIN\s+VOZ\s+NARRATIVA[^\]]*(?:Intro\s+Oficial|Outro\s+Oficial|Clip\s+1)/i.test(
        (s.text || '').trim()
      )
  );

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

  const parsedMaxClipNum =
    parsedFromPrompts.length > 0 ? Math.max(...parsedFromPrompts.map((c) => c.clipNumber)) : 0;
  const timelineExpectedClipNum = timelineSentences.length > 0 ? timelineSentences.length + 1 : 0;
  // When Timeline exists, strictly enforce its exact clip count (e.g. 143) so phantom tail clips (144-147) are never kept
  const maxClipNum =
    timelineExpectedClipNum > 0
      ? timelineExpectedClipNum
      : parsedMaxClipNum > 0
        ? parsedMaxClipNum
        : existingClips.length;

  if (maxClipNum === 0) return [];

  const parseMmSsRangeSec = (rangeStr?: string): { start: number; end: number } | null => {
    const m = String(rangeStr || '').match(/(\d{1,3}):(\d{2})\s*(?:-|–|—|to)\s*(\d{1,3}):(\d{2})/i);
    if (!m) return null;
    return {
      start: parseInt(m[1], 10) * 60 + parseInt(m[2], 10),
      end: parseInt(m[3], 10) * 60 + parseInt(m[4], 10),
    };
  };

  const isAutoSkeletonPrompt = (text?: string): boolean =>
    /\((?:Ruta Principal|Arco Integral|Tema Central)[^)]*\)|Authentic historical visual scene for|Create an image of a .* shot in \(Ruta Principal|depicting the historical documentary scene with dramatic cinematic lighting, historical accuracy, photorealistic 8k film still/i.test(
      String(text || '')
    );

  const byNum = new Map<number, DocumentaryClip>();
  for (const prev of existingClips) {
    if (prev.clipNumber >= 1 && prev.clipNumber <= maxClipNum) {
      const isGenericAutoSkeleton =
        isAutoSkeletonPrompt(prev.imagePrompt) || isAutoSkeletonPrompt(prev.videoPrompt);
      byNum.set(
        prev.clipNumber,
        isGenericAutoSkeleton
          ? {
              ...prev,
              timeRange: '',
              imagePrompt: '',
              videoPrompt: '',
              narrationSegment: '',
              auditStatus: 'warning',
              auditReason: '',
            }
          : { ...prev }
      );
    }
  }
  parsedFromPrompts.forEach((c) => {
    if (c.clipNumber >= 1 && c.clipNumber <= maxClipNum) {
      if (isAutoSkeletonPrompt(c.imagePrompt) || isAutoSkeletonPrompt(c.videoPrompt)) {
        const prev = byNum.get(c.clipNumber);
        byNum.set(c.clipNumber, {
          ...(prev || c),
          imagePrompt: '',
          videoPrompt: '',
          auditStatus: 'warning',
          auditReason: '',
        });
      } else {
        byNum.set(c.clipNumber, { ...c });
      }
    }
  });

  const finalClips: DocumentaryClip[] = [];

  for (let num = 1; num <= maxClipNum; num++) {
    const existing = byNum.get(num);
    if (num === 1) {
      const c1EndSec = clip1SyncMode === 'RALENTIZAR_CAPCUT' ? clip1Duration + 2 : clip1Duration;
      const c1Range = clip1TimelineMarker
        ? `${formatMMSS(clip1TimelineMarker.start)} - ${formatMMSS(clip1TimelineMarker.end)}`
        : existing?.timeRange || `00:00 - 00:${String(c1EndSec).padStart(2, '0')}`;
      const rawImg1 = existing?.imagePrompt?.trim() || '';
      const rawVid1 = existing?.videoPrompt?.trim() || '';
      // Stage 6 is strictly manual: NEVER fabricate synthetic prompts when empty
      const imgP = rawImg1 ? ensureAntiMutationPhysicsInPrompt(rawImg1, true, clip1Duration) : '';
      const vidP = rawVid1 ? ensureAntiMutationPhysicsInPrompt(rawVid1, false, clip1Duration) : '';

      const c1VoiceStartLabel = clip1TimelineMarker ? formatMMSS(clip1TimelineMarker.end) : `00:${String(voiceEntrySec).padStart(2, '0')}`;
      let auditStatus: 'ok' | 'warning' | 'mismatch' = 'ok';
      let auditReason = '';
      if (!imgP || !vidP) {
        auditStatus = 'warning';
        auditReason =
          'Pendiente de generar prompts de Imagen Inicial y Video en Gemini (pulsa el botón "✨ Generar Prompts en Gemini").';
      } else {
        const c1Issues: string[] = [];
        const promptHeaderRangeMatch = vidP.match(/^Clip\s+\d+\s*\(([^)]+)\)/i);
        const promptParsedSec = parseMmSsRangeSec(promptHeaderRangeMatch?.[1]);
        const expectedParsedSec = parseMmSsRangeSec(c1Range);
        if (
          promptParsedSec &&
          expectedParsedSec &&
          (Math.abs(promptParsedSec.start - expectedParsedSec.start) > 1 ||
            Math.abs(promptParsedSec.end - expectedParsedSec.end) > 1)
        ) {
          c1Issues.push(
            `Desfase de tiempo en el encabezado del Clip 1 (${promptHeaderRangeMatch?.[1]}) frente al Timeline real (${c1Range}).`
          );
        }
        if (/speech|narrat|voiceover/i.test(vidP) && !/\bno\s+(?:human\s+|spoken\s+)?speech\b/i.test(vidP)) {
          c1Issues.push('El Clip 1 no debe llevar voz hablada; debe cerrar con "no spoken voice, no human speech".');
        }
        if (/(?<!f\/1\.)\b\d+\s*bokeh\)\./i.test(imgP) || /(?<!f\/1\.)\b\d+\s*bokeh\)\./i.test(vidP)) {
          c1Issues.push('Residuo de truncamiento "bokeh)." detectado en el prompt.');
        }
        if (c1Issues.length > 0) {
          auditStatus = 'mismatch';
          auditReason = c1Issues.join(' ');
        } else if (
          existing?.videoAuditStatus === 'rejected' &&
          !existing?.videoSavedFileName &&
          existing?.auditStatus === 'mismatch'
        ) {
          auditStatus = 'mismatch';
          auditReason = existing.auditReason || 'Video rechazado en auditoría visual.';
        } else {
          auditStatus = 'ok';
          auditReason =
            clip1SyncMode === 'VOZ_EN_CLIP_2'
              ? `Clip 1 (${c1Range} sin voz en off, duración Flow ${clip1Duration}s; la voz narrativa entra en ${c1VoiceStartLabel}).`
              : `Clip 1 (${c1Range} Hook inicial sin voz en off, generado de ${clip1Duration}s en Flow y ralentizado en CapCut; la voz entra en ${c1VoiceStartLabel}).`;
        }
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
            ? `(${c1Range} Sin Voz Narrativa — La voz entra en ${c1VoiceStartLabel})`
            : `(${c1Range} Sin Voz Narrativa — Solo Audio Foley y Letrero Inicial; Flow ${clip1Duration}s ralentizado)`,
        pauseNotes: `Sin locución en el tramo inicial (${c1Range})`,
        imageReady: existing?.imageReady || false,
        videoReady: existing?.videoReady || false,
        reviewedForEditor: Boolean(existing?.reviewedForEditor),
        ...(existing?.reviewedUpdatedAt ? { reviewedUpdatedAt: existing.reviewedUpdatedAt } : {}),
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
    const rawImg = existing?.imagePrompt?.trim() || '';
    const rawVid = existing?.videoPrompt?.trim() || '';

    const parsedBroll = parseBrollMotionFromText(
      `${rawImg} ${rawVid}`,
      existing?.cameraSelection,
      existing?.visualExplanation
    );
    const resolvedIsStaticBroll =
      existing?.isStaticBroll !== undefined ? Boolean(existing.isStaticBroll) : parsedBroll.isStaticBroll;
    const resolvedBrollMotion = resolvedIsStaticBroll
      ? existing?.brollCameraMotion || parsedBroll.brollCameraMotion || 'zoom_in'
      : undefined;

    // Stage 6 is strictly manual: NEVER synthesize placeholder prompts when empty
    const imgP = rawImg
      ? resolvedIsStaticBroll
        ? normalizeBrollImagePrompt(
            rawImg,
            num,
            computedRange,
            standardClipDuration,
            resolvedBrollMotion || 'zoom_in'
          )
        : ensureAntiMutationPhysicsInPrompt(rawImg, true, standardClipDuration)
      : '';
    const vidP = resolvedIsStaticBroll
      ? ''
      : rawVid
        ? ensureAntiMutationPhysicsInPrompt(rawVid, false, standardClipDuration)
        : '';

    // Buscar si esa frase en la Voz Narrativa Raw contiene una etiqueta [pausa: Xs]
    let pauseNotes = '';
    const directPauses = narrationText.match(pauseRegex);
    if (directPauses && directPauses.length > 0) {
      pauseNotes = `Contiene ${directPauses.join(', ')} en la locución`;
    } else if (rawVoiceoverWithPauses && narrationText) {
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

    // Auditoría determinista real en cada pasada (nunca congelar estados viejos)
    let auditStatus: 'ok' | 'warning' | 'mismatch' = 'ok';
    let auditReason = '';

    if (resolvedIsStaticBroll) {
      if (!imgP) {
        auditStatus = 'warning';
        auditReason = 'Falta el prompt de Imagen B-Roll para esta escena.';
      } else {
        auditStatus = 'ok';
        auditReason = `🖼️ Escena B-Roll Solo Imagen (${BROLL_MOTION_UI_LABEL_ES[resolvedBrollMotion || 'zoom_in']}) lista — movimiento 4K 60fps local en Editor.`;
      }
    } else if (!imgP || !vidP) {
      auditStatus = 'warning';
      auditReason = !imgP && !vidP
        ? 'Pendiente de generar los prompts de Imagen Inicial y Video en Gemini (pulsa "✨ Generar Prompts en Gemini").'
        : !imgP
          ? 'Falta el prompt de Imagen Inicial para este clip.'
          : 'Falta el prompt de Video para este clip.';
    } else {
      const issues: string[] = [];
      let hasMismatch = false;

      const promptHeaderRangeMatch = vidP.match(/^Clip\s+\d+\s*\(([^)]+)\)/i);
      const promptParsedSec = parseMmSsRangeSec(promptHeaderRangeMatch?.[1]);
      const expectedParsedSec = parseMmSsRangeSec(computedRange);
      if (
        promptParsedSec &&
        expectedParsedSec &&
        (Math.abs(promptParsedSec.start - expectedParsedSec.start) > 1 ||
          Math.abs(promptParsedSec.end - expectedParsedSec.end) > 1)
      ) {
        hasMismatch = true;
        issues.push(
          `⏱️ Desfase de tiempo: el prompt indica (${promptHeaderRangeMatch?.[1]}) pero la voz narrativa suena en (${computedRange}).`
        );
      }

      const durTagMatch =
        vidP.match(/\[Duration\s*:\s*(\d+)\s*s\]/i) ||
        vidP.match(/\bacross\s+(?:the\s+full\s+)?(\d+)\s*seconds\b/i) ||
        vidP.match(/\b(\d+)-second\s+video\b/i);
      if (durTagMatch && parseInt(durTagMatch[1], 10) !== standardClipDuration) {
        issues.push(
          `La duración en el prompt (${durTagMatch[1]}s) no coincide con los ${standardClipDuration}s elegidos en Etapa 1.`
        );
      }

      if (
        /\((?:Ruta Principal|Arco Integral|Tema Central)[^)]*\)|—\s*Recomendada|(?<!f\/1\.)\b\d+\s*bokeh\)\./i.test(
          `${imgP} ${vidP}`
        )
      ) {
        hasMismatch = true;
        issues.push('El prompt contiene texto residual en español o fragmentos truncados.');
      }

      if (vidP && !/fix the name/i.test(vidP)) {
        issues.push('Falta "fix the name" al final del prompt de video.');
      }
      if (imgP && !/no text/i.test(imgP)) {
        issues.push('El prompt de imagen inicial debe incluir "no text".');
      }

      const prevClip = finalClips[finalClips.length - 1];
      if (prevClip && prevClip.clipNumber === num - 1 && prevClip.imagePrompt && imgP) {
        const deskOfficeRegex = /\b(office|desk|counter|moneylender|clerk|notary|wooden table|ledger)\b/i;
        const outdoorContrastRegex = /\b(outdoor|sunlit|harbor|pier|dock|street|plaza|courtyard|exterior|mountain|ocean|sea|corridor|ward|factory|vat|laboratory|greenhouse)\b/i;
        if (
          deskOfficeRegex.test(prevClip.imagePrompt) &&
          deskOfficeRegex.test(imgP) &&
          !outdoorContrastRegex.test(imgP) &&
          !outdoorContrastRegex.test(prevClip.imagePrompt)
        ) {
          issues.push(
            `⚠️ Posible repetición de escenario de escritorio/oficina interior respecto al Clip ${num - 1}; alterna plano o espacio visual.`
          );
        }
      }

      const isDiscardOverriddenForExisting = Boolean(
        existing &&
          isClipDiscardOverridden(existing) &&
          existing.videoReady &&
          existing.imagePrompt === imgP &&
          existing.videoPrompt === vidP
      );
      if (issues.length > 0) {
        auditStatus = hasMismatch && !isDiscardOverriddenForExisting ? 'mismatch' : 'warning';
        auditReason = issues.join(' ');
      } else if (
        existing?.videoAuditStatus === 'rejected' &&
        !isClipDiscardOverridden(existing) &&
        !existing?.videoSavedFileName &&
        existing?.auditStatus === 'mismatch'
      ) {
        auditStatus = 'mismatch';
        auditReason = existing.auditReason || 'Video rechazado o faltante — pendiente de regenerar en Flow.';
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
      previousVideoPrompt:
        existing?.previousVideoPrompt ||
        (resolvedIsStaticBroll && rawVid ? rawVid : undefined),
      narrationSegment: narrationText,
      pauseNotes,
      imageReady: existing?.imageReady || false,
      videoReady: existing?.videoReady || false,
      reviewedForEditor: Boolean(existing?.reviewedForEditor),
      ...(existing?.reviewedUpdatedAt ? { reviewedUpdatedAt: existing.reviewedUpdatedAt } : {}),
      recreated: Boolean(existing?.recreated),
      videoFrames: existing?.videoFrames,
      videoAuditStatus: existing?.videoAuditStatus,
      videoAuditScore: existing?.videoAuditScore,
      videoAuditReason: existing?.videoAuditReason,
      videoAuditIssues: existing?.videoAuditIssues,
      videoAttempts: existing?.videoAttempts,
      videoSavedFileName: existing?.videoSavedFileName,
      discardedVideoFileName: existing?.discardedVideoFileName,
      videoDiscardedAt: existing?.videoDiscardedAt,
      videoDiscardOverriddenAt: existing?.videoDiscardOverriddenAt,
      videoSavedAt: existing?.videoSavedAt,
      promptUpdatedAt: existing?.promptUpdatedAt,
      auditStatus,
      auditReason,
      suggestedImagePrompt: existing?.suggestedImagePrompt,
      suggestedVideoPrompt: existing?.suggestedVideoPrompt,
      isStaticBroll: resolvedIsStaticBroll || undefined,
      brollCameraMotion: resolvedBrollMotion,
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
// 2. AUTO-DETECTOR DE REFERENCIAS (@Personas y Lugares - ETAPA 4 / INTERNA 6)
// ============================================================================
export function normalizeReferenceTagSlug(raw: string, fallbackIndex = 1): string {
  const cleaned = String(raw || '')
    .replace(/\[(?:Image Name|Nombre de (?:la )?imagen|Nombre de archivo)\s*:[^\]]*\]/gi, '')
    .replace(/\((?:Image Name|Nombre de (?:la )?imagen|Nombre de archivo)\s*:[^)]*\)/gi, '')
    .replace(/^(?:[-*#\d.)\s]+)?(?:Image|Imagen)\s+/i, '')
    .replace(/^@+/, '')
    .replace(/^(?:Ref_Image_|Ref_|Referencia_)+/i, '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^A-Za-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');
  return `@${cleaned || `Referencia_${fallbackIndex}`}`;
}

export function parseReferencesFromRawText(rawText: string): ReferenceAsset[] {
  if (!rawText || !rawText.trim()) return [];
  const lines = rawText.replace(/\r\n/g, '\n').split('\n');
  const results: ReferenceAsset[] = [];

  let currentTag = '';
  let currentHadAt = false;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line) continue;
    if (
      /^(?:Act\s+as\s+a|Use\s+Nano\s+Banana|Generate\s+each\s+image\s+as\s+a\s+reference|Each\s+image\s+MUST|Mandatorily\s+(?:replace|rename)|Rename\s+(?:each|every|all)|Change\s+the\s+names|Deliver\s+(?:exclusively|only)|Cambia\s+(?:los\s+nombres|obligatoriamente\s+el\s+nombre)|Actúa\s+como\s+un\s+historiador|Usa\s+Nano\s+Banana|Cada\s+imagen\s+DEBE|Nombra\s+(?:obligatoriamente\s+)?cada\s+imagen|Nombres\s+exactos\s+de\s+las\s+imágenes)/i.test(
        line
      )
    ) {
      continue;
    }
    if (/^Google\s+Docs$/i.test(line) || /^\+\s*\d+$/.test(line)) continue;
    if (/^\(?->\s*ALTO\s+INQUEBRANTABLE/i.test(line)) continue;

    // Si es continuación multilínea de Frame Description (Character:, Location:, Physical Characteristics:, etc.)
    if (
      results.length > 0 &&
      /^(?:Character|Location|Time of Day|Physical Characteristics(?: & Clothing)?|Clothing and Accessories|Visual Style)\s*:/i.test(
        line
      )
    ) {
      const prev = results[results.length - 1];
      prev.prompt = `${prev.prompt}\n${line}`;
      if (/^Location\s*:/i.test(line)) {
        prev.category = 'lugar';
      } else if (/^Character\s*:/i.test(line)) {
        prev.category = 'persona';
      }
      continue;
    }

    // Si la línea tiene "Create an image" o "Frame Description:"
    const createImgIdx = line.search(/Create an image|Frame Description\s*:/i);
    if (createImgIdx !== -1) {
      const rawBefore = line.slice(0, createImgIdx).trim();
      const hadAtInHeader = /@[A-Za-z0-9_ÁÉÍÓÚáéíóúÑñ]/.test(rawBefore) || currentHadAt;
      const explicitBracketMatch = rawBefore.match(
        /\[(?:Image Name|Nombre de (?:la )?imagen|Nombre de archivo)\s*:\s*(@?[A-Za-z0-9_ÁÉÍÓÚáéíóúÑñ\s-]+)\]/i
      );
      const atInBefore = rawBefore
        .replace(/\[(?:Image Name|Nombre de (?:la )?imagen|Nombre de archivo)\s*:[^\]]*\]/gi, '')
        .match(/@([A-Za-z0-9_ÁÉÍÓÚáéíóúÑñ]+(?:\s+[A-Za-z0-9_ÁÉÍÓÚáéíóúÑñ]+)*)/);
      const beforeClean = rawBefore
        .replace(/\[(?:Image Name|Nombre de (?:la )?imagen|Nombre de archivo)\s*:[^\]]*\]/gi, '')
        .replace(/\((?:Image Name|Nombre de (?:la )?imagen|Nombre de archivo)\s*:[^)]*\)/gi, '')
        .replace(/^(?:[-*#\d.)\s]+)?(?:Image|Imagen)\s+/i, '')
        .replace(/[:\-–|]+$/g, '')
        .trim();

      const promptPart = line.slice(createImgIdx).trim();
      const rawTagSource =
        explicitBracketMatch?.[1] ||
        (atInBefore ? atInBefore[1] : '') ||
        beforeClean ||
        currentTag ||
        `Referencia_${results.length + 1}`;
      const normalizedTag = normalizeReferenceTagSlug(rawTagSource, results.length + 1);

      const combinedCheck = `${beforeClean} ${normalizedTag} ${promptPart}`
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '');

      const isExplicitPerson =
        /character reference sheet|character sheet|6-view character|full-body standing|head and shoulders|close-up portrait of (?:the )?(?:face|head)|portrayed by an anonymous|\b\d+-year-old\b/i.test(
          promptPart
        );
      const isExplicitLocation =
        !isExplicitPerson &&
        (/location reference sheet|6-view(?: historical)? location|4 different 16:9 views|6 (?:distinct|different|coherent) views.*location|zero people|no people,?\s*(?:zero\s*)?animals|empty environment|empty architectural|establishing shot of the environment/i.test(
          promptPart
        ) ||
          /\b(?:muelle|aldea|puerto|campamento|almacen|panaderia|palacio|castillo|ciudad|calle|plaza|templo|iglesia|catedral|barco|vapor|entreponte|isla|valle|montana|bosque|edificio|fortaleza|prision|hospital|estacion|mercado|dock|pier|village|harbor|camp|bakery|steerage|street|cathedral|palace|castle)\b/i.test(
            `${beforeClean} ${normalizedTag}`.normalize('NFD').replace(/[\u0300-\u036f]/g, '')
          ));

      const isPerson = isExplicitPerson
        ? true
        : isExplicitLocation
        ? false
        : hadAtInHeader || /\b(?:farmer|physician|poet|soldier|king|queen|emperor|general|captain|doctor|clerk|merchant|monk|priest)\b/i.test(combinedCheck);

      let shieldedPromptPart = isPerson ? applyAutomaticFlowPolicyShield(promptPart, true) : promptPart;
      if (isPerson && !/no real public figures/i.test(shieldedPromptPart)) {
        shieldedPromptPart = `${shieldedPromptPart.replace(/\.?\s*$/, '')}. Portrayed by an anonymous historical reenactment actor in authentic period wardrobe (no real public figures or prominent people).`;
      }

      results.push({
        id: `ref-${Date.now()}-${results.length + 1}`,
        tag: normalizedTag,
        category: isPerson ? 'persona' : 'lugar',
        description: beforeClean.replace(/^@+/, '').replace(/_/g, ' ').trim() || normalizedTag,
        prompt: shieldedPromptPart,
        isCreated: false,
      });
      currentTag = '';
      currentHadAt = false;
    } else if (line.startsWith('@') || /^[-*#\d.)]*\s*(?:Image\s+)?@[A-Za-z0-9_]+/i.test(line)) {
      currentTag = normalizeReferenceTagSlug(line, results.length + 1);
      currentHadAt = true;
    } else if (line.length < 90 && !line.endsWith('.')) {
      const cleanedHeader = line.replace(/^[-*#\d.)\s]+|[:]+$/g, '').trim();
      currentHadAt = cleanedHeader.includes('@');
      currentTag = cleanedHeader;
    }
  }

  return results;
}

// Canonical, unique @tags for a parsed list: a repeated name becomes @Name_2, @Name_3… so that two cards
// never share a tag (the file name in 04_Referencias) or an id.
function withUniqueReferenceSlugs(list: ReferenceAsset[]): { ref: ReferenceAsset; slug: string }[] {
  const used = new Set<string>();
  return list.map((ref, idx) => {
    const base = normalizeReferenceTagSlug(ref.tag || '', idx + 1);
    let slug = base;
    for (let n = 2; used.has(slug.toLowerCase()); n++) slug = `${base}_${n}`;
    used.add(slug.toLowerCase());
    return { ref, slug };
  });
}

/**
 * Rebuild the Etapa 4 cards from freshly parsed text without losing the user's work:
 * - a card keeps its id, image and "lista" state (matched by @tag);
 * - when the text block of a card did not change since `previousRawText`, the prompt, category and
 *   description edited on the card itself are kept (typing elsewhere in the box no longer resets them);
 * - cards added by hand (not coming from the previous text) are kept at the end.
 */
export function mergeParsedReferencesWithExisting(
  parsed: ReferenceAsset[],
  existing: ReferenceAsset[] = [],
  previousRawText = ''
): ReferenceAsset[] {
  const previousParsed = new Map<string, ReferenceAsset>();
  for (const { ref, slug } of withUniqueReferenceSlugs(parseReferencesFromRawText(previousRawText))) {
    previousParsed.set(slug.toLowerCase(), ref);
  }
  const existingBySlug = new Map<string, ReferenceAsset>();
  for (const old of existing) {
    const key = normalizeReferenceTagSlug(old.tag || '').toLowerCase();
    if (!existingBySlug.has(key)) existingBySlug.set(key, old);
  }

  const usedSlugs = new Set<string>();
  const usedIds = new Set<string>();
  const merged: ReferenceAsset[] = withUniqueReferenceSlugs(parsed).map(({ ref: p, slug }) => {
    const key = slug.toLowerCase();
    usedSlugs.add(key);
    const prev = existingBySlug.get(key);
    const prevParsed = previousParsed.get(key);
    const blockUnchanged = Boolean(prev && prevParsed && prevParsed.prompt === p.prompt);
    const id = prev?.id && !usedIds.has(prev.id) ? prev.id : p.id;
    usedIds.add(id);
    return {
      ...p,
      ...(blockUnchanged && prev
        ? { prompt: prev.prompt, category: prev.category, description: prev.description }
        : {}),
      id,
      tag: slug,
      imageUrl: prev?.imageUrl || p.imageUrl,
      isCreated: Boolean(prev?.isCreated || prev?.imageUrl),
    };
  });

  for (const old of existing) {
    const key = normalizeReferenceTagSlug(old.tag || '').toLowerCase();
    if (usedSlugs.has(key) || previousParsed.has(key) || usedIds.has(old.id)) continue;
    usedSlugs.add(key);
    usedIds.add(old.id);
    merged.push(old);
  }
  return merged;
}

// ============================================================================
// 3. AUTO-DETECTOR DE PISTAS DE MÚSICA (FLOWMUSIC — ETAPA 8)
// ============================================================================
export function formatDurationForLyricsEndTag(durationStr?: string): string {
  const raw = String(durationStr || '').trim();
  if (!raw) return '2:30';
  const mmSsMatch = raw.match(/(\d{1,2})\s*:\s*(\d{2})/);
  if (mmSsMatch) {
    const mins = Math.max(0, parseInt(mmSsMatch[1], 10));
    const secs = String(Math.min(59, Math.max(0, parseInt(mmSsMatch[2], 10)))).padStart(2, '0');
    return `${mins}:${secs}`;
  }
  const secOnlyMatch = raw.match(/^(\d{2,3})\s*(?:s|seg|segundos?)$/i);
  if (secOnlyMatch) {
    const totalSec = Math.max(30, parseInt(secOnlyMatch[1], 10));
    const mins = Math.floor(totalSec / 60);
    const secs = String(totalSec % 60).padStart(2, '0');
    return `${mins}:${secs}`;
  }
  return '2:30';
}

export function ensureLyricsEndDurationTag(lyricsPrompt: string, durationStr?: string): string {
  const formattedDur = formatDurationForLyricsEndTag(durationStr);
  const endTag = `[End - ${formattedDur}]`;
  const base = (lyricsPrompt || '').trim() ||
    '[Instrumental]\n[Soft 2.5s Fade-In Intro]\n[Warm Documentary Underscore Below Voice]\n[Gentle 3s Fade-Out Outro]';
  const stripped = base
    .replace(/\s*\[End(?:\s*[-–—:]\s*\d{1,2}:\d{2})?\]\s*$/i, '')
    .trim();
  return stripped ? `${stripped}\n${endTag}` : endTag;
}

export function parseSunoTracksFromRawText(rawText: string): SunoTrack[] {
  if (!rawText || !rawText.trim()) return [];
  const tracks: SunoTrack[] = [];

  // Limpiar asteriscos de negrita alrededor de etiquetas numeradas para facilitar el parseo
  const normalized = rawText.replace(/\*\*([^*]+)\*\*/g, '$1');

  // Separar si hay múltiples pistas o bloques "Track X", "Song X", "Canción X", "Pista X" o "1. Track Title / Título..."
  const blocks = normalized
    .split(
      /(?=(?:^|\n)\s*(?:[#*\-\s]*)(?:Pista\s+\d+|Canci[oó]n\s+\d+|Track\s+\d+|Song\s+\d+|1\.\s*(?:(?:Track|Song)\s+Title|Title(?:\s+of\s+the\s+(?:song|track))?|T[ií]tulo(?:\s+de\s+la\s+(?:canci[oó]n|pista))?)\s*:))/i
    )
    .filter((b) => b.trim());

  blocks.forEach((block) => {
    const titleMatch = block.match(
      /(?:1\.\s*)?(?:(?:Track|Song)\s+Title|Title(?:\s+of\s+the\s+(?:song|track))?|T[ií]tulo(?:\s+de\s+la\s+(?:canci[oó]n|pista))?)\s*:\s*([^\n]+)/i
    );
    const durationMatch = block.match(/(?:2\.\s*)?(?:Duraci[oó]n|Duration)\s*:\s*([^\n]+)/i);
    const rangeMatch = block.match(
      /(?:3\.\s*)?(?:Video\s+Time\s+Range|Time\s+Range(?:\s+Covered)?|Segment\s+Covered|De d[oó]nde a d[oó]nde cubre|Rango de tiempo|Tramo)[^:]*:\s*([^\n]+)/i
    );
    const lyricsMatch = block.match(
      /(?:4\.\s*)?(?:Prompt de Lyrics|Lyrics Prompt)\s*:\s*([\s\S]*?)(?=(?:\n\s*(?:5\.|Prompt de Style|Style Prompt))|$)/i
    );
    const styleMatch = block.match(
      /(?:5\.\s*)?(?:Prompt de Style|Style Prompt)\s*:\s*([\s\S]*?)(?=(?:\n\s*(?:6\.|Explicaci[oó]n(?:\s+de\s+la\s+Canci[oó]n)?|(?:Scene|Track|Song)\s+Explanation|Explanation))|$)/i
    );
    const expMatch = block.match(
      /(?:6\.\s*)?(?:Explicaci[oó]n(?:\s+de\s+la\s+Canci[oó]n)?|(?:Scene|Track|Song)\s+Explanation|Explanation)\s*:\s*([\s\S]*?)$/i
    );

    if (titleMatch || styleMatch || lyricsMatch) {
      const nextNum = tracks.length + 1;
      let rawStyle = styleMatch ? styleMatch[1].trim() : '';
      if (rawStyle && !/fade-in/i.test(rawStyle)) {
        rawStyle = `${rawStyle}, smooth 2.5-second fade-in intro, gentle 3-second fade-out outro, warm low-mid frequency documentary underscore mixed softly below narrator voice, 100% instrumental, strictly no vocals`;
      }
      const resolvedDuration = durationMatch ? durationMatch[1].trim() : '2:30';
      const rawLyrics = lyricsMatch
        ? lyricsMatch[1].trim()
        : '[Instrumental]\n[Soft 2.5s Fade-In Intro]\n[Warm Documentary Underscore Below Voice]\n[Gentle 3s Fade-Out Outro]';
      tracks.push({
        id: `suno-${Date.now()}-${nextNum}`,
        trackNumber: nextNum,
        title: titleMatch
          ? titleMatch[1].replace(/^["«']+|["»']+$/g, '').trim()
          : `Pista ${nextNum}`,
        duration: resolvedDuration,
        videoTimeRange: rangeMatch ? rangeMatch[1].trim() : '00:08 - Final',
        lyricsPrompt: ensureLyricsEndDurationTag(rawLyrics, resolvedDuration),
        stylePrompt: rawStyle,
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

/**
 * Regla de Locución Documental para Próximos Videos:
 * Cada vez que la voz narrativa mencione el primer día del mes ("1 de enero", "01 de septiembre",
 * "1º de mayo", "uno de noviembre", "el 1 del mes"), lo convierte a "primero" ("primero de enero",
 * "Primero de septiembre") para que el motor TTS jamás pronuncie "uno".
 */
export function normalizeFirstDayOfMonthInVoiceover(text: string): string {
  if (!text || typeof text !== 'string') return text || '';

  const MONTHS_PATTERN =
    'enero|febrero|marzo|abril|mayo|junio|julio|agosto|septiembre|setiembre|octubre|noviembre|diciembre';

  // 1. Expandir "1er día de <mes>" -> "primer día de <mes>"
  let out = text.replace(
    new RegExp(
      `(?<![0-9A-Za-zÁÉÍÓÚÜÑáéíóúüñ.,/:-])(1\\s*\\.?\\s*er)(\\s+d[ií]a\\s+de\\s+)(${MONTHS_PATTERN})(?![A-Za-zÁÉÍÓÚÜÑáéíóúüñ0-9_])`,
      'gi'
    ),
    (fullMatch, _ord, middle, month, offset, whole) => {
      const monthLetters = String(month).replace(/[^A-Za-zÁÉÍÓÚÜÑáéíóúüñ]/g, '');
      const isAllCaps = monthLetters.length >= 2 && monthLetters === monthLetters.toUpperCase();
      if (isAllCaps) return `PRIMER${middle}${month}`;
      const prefixClean = String(whole)
        .slice(0, offset)
        .replace(/(?:\[\s*(?:pausa|pause|silencio)[^\]]*\]\s*)+$/gi, '')
        .replace(/[«"“'¿¡(\[—\-\s]+$/, '');
      const isSentenceStart = prefixClean.length === 0 || /[.!?:;\n]$/.test(prefixClean);
      return `${isSentenceStart ? 'Primer' : 'primer'}${middle}${month}`;
    }
  );

  // 2. Convertir "1 / 01 / 1º / 1° / 1ro / 1ero / uno + de + <mes>" -> "primero de <mes>"
  const firstOfNamedMonthRegex = new RegExp(
    `(?<![0-9A-Za-zÁÉÍÓÚÜÑáéíóúüñ.,/:-])(0?1(?:\\s*\\.?\\s*[º°ª]|ro|ero)?|uno)(\\s+de\\s+)(${MONTHS_PATTERN})(?![A-Za-zÁÉÍÓÚÜÑáéíóúüñ0-9_])`,
    'gi'
  );

  out = out.replace(
    firstOfNamedMonthRegex,
    (fullMatch, dayToken, dePart, monthWord, offset, whole) => {
      const beforeRaw = String(whole).slice(0, offset);
      if (
        /\b(?:n[uú]mero|cap[ií]tulo|parte|acto|volumen|tomo|p[aá]gina|bloque|punto|art[ií]culo|inciso|nota)\s*$/i.test(
          beforeRaw
        )
      ) {
        return fullMatch;
      }

      const monthLetters = String(monthWord).replace(/[^A-Za-zÁÉÍÓÚÜÑáéíóúüñ]/g, '');
      const isAllCaps = monthLetters.length >= 2 && monthLetters === monthLetters.toUpperCase();
      if (isAllCaps) {
        return `PRIMERO${dePart}${monthWord}`;
      }

      const dayStr = String(dayToken);
      if (/^Uno$/.test(dayStr)) {
        return `Primero${dePart}${monthWord}`;
      }

      const prefixClean = beforeRaw
        .replace(/(?:\[\s*(?:pausa|pause|silencio)[^\]]*\]\s*)+$/gi, '')
        .replace(/[«"“'¿¡(\[—\-\s]+$/, '');
      const isSentenceStart = prefixClean.length === 0 || /[.!?:;\n]$/.test(prefixClean);
      return `${isSentenceStart ? 'Primero' : 'primero'}${dePart}${monthWord}`;
    }
  );

  // 3. Convertir "el 1 del mes" / "el uno del mes" / "día 1 del mes" / "cada 1 de mes"
  out = out.replace(
    /(?<=\b(?:el|del|al|cada|d[ií]a)\s+)(?:0?1(?:\s*\.?\s*[º°ª]|ro|ero)?|uno)(\s+(?:del|de)\s+mes\b)/gi,
    (_m, tail: string) => {
      const isCaps = tail === tail.toUpperCase() && /[A-Z]/.test(tail);
      return `${isCaps ? 'PRIMERO' : 'primero'}${tail}`;
    }
  );

  return out;
}

/**
 * Formats Stage 7 Line 1 (Location + Time) so that:
 * - "Siglo" is always capitalized ("Siglo XIX", "Siglo XIII")
 * - "Año" (capitalized) is always placed before a year in digits ("Santander, España, Año 1885")
 */
export function normalizeClip1Line1Format(rawLine1: string): string {
  if (!rawLine1 || typeof rawLine1 !== 'string') return '';
  let s = rawLine1.trim();
  if (!s) return '';

  // 1. Capitalize "Siglo" and ensure Roman numeral is uppercase
  s = s.replace(/\bsiglo\s+([ivxlcdm]+)\b/gi, (_, roman) => `Siglo ${String(roman).toUpperCase()}`);
  s = s.replace(/\bsiglo\b/gi, 'Siglo');

  // 2. Capitalize "Año" if already present
  s = s.replace(/\baño\s+(\d{1,4})\b/gi, 'Año $1');

  // 3. If neither "Año" nor "Siglo" is present, prepend "Año " before the year
  if (!/\b(?:Año|Siglo)\b/i.test(s)) {
    if (
      /(^|[,•\-–—\s])(\d{3,4}(?:\s*[-–]\s*\d{2,4})?(?:\s*(?:a\.\s*C\.|d\.\s*C\.))?)(?=$|[,•\-–—\s])/i.test(
        s
      )
    ) {
      s = s.replace(
        /(^|[,•\-–—\s])(\d{3,4}(?:\s*[-–]\s*\d{2,4})?(?:\s*(?:a\.\s*C\.|d\.\s*C\.))?)(?=$|[,•\-–—\s])/i,
        '$1Año $2'
      );
    } else if (/(^|[,•\-–—\s])(\d{1,3}\s*(?:a\.\s*C\.|d\.\s*C\.))(?=$|[,•\-–—\s])/i.test(s)) {
      s = s.replace(
        /(^|[,•\-–—\s])(\d{1,3}\s*(?:a\.\s*C\.|d\.\s*C\.))(?=$|[,•\-–—\s])/i,
        '$1Año $2'
      );
    }
  }

  return s.replace(/\s{2,}/g, ' ').trim();
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

export function splitWordsIntoShortLines(
  inputWords: string[] | string,
  maxChars: number = 32,
  maxWordsPerLine: number = 0
): string[][] {
  const words = Array.isArray(inputWords)
    ? inputWords
    : typeof inputWords === 'string'
    ? inputWords.trim().split(/\s+/).filter(Boolean)
    : [];
  if (!words || words.length === 0) return [];
  const cleanMaxWords = maxWordsPerLine > 0 ? Math.max(1, Math.round(maxWordsPerLine)) : 0;
  let effectiveMaxChars = maxChars;
  if (cleanMaxWords > 0) {
    if (effectiveMaxChars <= 0) {
      effectiveMaxChars = cleanMaxWords * 7;
    } else if (cleanMaxWords >= 7) {
      effectiveMaxChars = Math.max(effectiveMaxChars, cleanMaxWords * 6);
    } else if (cleanMaxWords <= 3) {
      effectiveMaxChars = Math.min(effectiveMaxChars, cleanMaxWords * 7);
    }
  }
  if (effectiveMaxChars <= 0 && cleanMaxWords <= 0) return [words];

  const fullText = words.join(' ');
  const hasSentenceBreakInside = words.slice(0, -1).some((w) => /[.?!:;]$/.test(w));
  if (
    (effectiveMaxChars <= 0 || fullText.length <= effectiveMaxChars) &&
    (cleanMaxWords <= 0 || words.length <= cleanMaxWords) &&
    !hasSentenceBreakInside
  ) {
    return [words];
  }

  const m = words.length;
  const minChunksByChars =
    effectiveMaxChars > 0 ? Math.ceil(fullText.length / effectiveMaxChars) : 1;
  const minChunksByWords = cleanMaxWords > 0 ? Math.ceil(m / cleanMaxWords) : 1;
  const minChunks = Math.max(
    hasSentenceBreakInside ? 2 : 1,
    minChunksByChars,
    minChunksByWords
  );
  const targetLen = fullText.length / minChunks;
  const targetWords = m / minChunks;

  const dp = new Array(m + 1).fill(Infinity);
  const parent = new Array(m + 1).fill(-1);
  dp[0] = 0;

  for (let i = 0; i < m; i++) {
    if (dp[i] === Infinity) continue;
    let lineLen = 0;
    for (let j = i + 1; j <= m; j++) {
      const wordCount = j - i;
      if (cleanMaxWords > 0 && wordCount > cleanMaxWords) break;

      const w = words[j - 1];
      lineLen += j === i + 1 ? w.length : 1 + w.length;

      if (j > i + 1 && effectiveMaxChars > 0 && lineLen > effectiveMaxChars + 5) break;

      let cost = Math.pow(lineLen - targetLen, 2) * 0.25 + 8;
      if (cleanMaxWords > 0) {
        cost += Math.pow(wordCount - targetWords, 2) * 2.5;
      }
      if (effectiveMaxChars > 0 && lineLen > effectiveMaxChars) {
        cost += Math.pow(lineLen - effectiveMaxChars, 2) * 3.0;
      }
      if (lineLen < 9 && j < m && (cleanMaxWords === 0 || cleanMaxWords >= 3)) {
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
    maxWordsPerLine?: number;
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
  const maxWordsPerLine = options?.maxWordsPerLine ?? 0;
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

    if (lineMode === 'subdivide' && (maxCharsPerLine > 0 || maxWordsPerLine > 0)) {
      const chunks = splitWordsIntoShortLines(slice, maxCharsPerLine, maxWordsPerLine);
      const subTimestamps = subdivideTimestampRange(block.timestampLine, chunks);
      for (let c = 0; c < chunks.length; c++) {
        const cleanIdx = rebuiltBlocks.length + 1;
        rebuiltBlocks.push(`${cleanIdx}\n${subTimestamps[c]}\n${chunks[c].join(' ')}`);
      }
    } else if (lineMode === 'wrap' && (maxCharsPerLine > 0 || maxWordsPerLine > 0)) {
      const chunks = splitWordsIntoShortLines(slice, maxCharsPerLine, maxWordsPerLine);
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

export type CaptionBreakFlag = 0 | 1 | 2 | 3 | 4;

export interface CaptionTimedWord {
  text: string;
  audioStartSec: number;
  audioEndSec: number;
  breakFlag?: CaptionBreakFlag;
}

export interface CaptionItemLike {
  id: string;
  index: number;
  start: number;
  end: number;
  text: string;
  audioStartSec?: number;
  audioEndSec?: number;
  words?: CaptionTimedWord[];
  alignSource?: 'vosk-v2' | 'webaudio-v2' | 'video76-srt' | 'manual';
  [key: string]: any;
}

export function computeVoiceScriptAlignHash(rawScript: string): string {
  const norm = String(rawScript || '')
    .replace(/[\[{]\s*(?:pausa|pause|silencio)\s*[:=]?\s*\d+(?:[.,]\d+)?\s*s?\s*[\]}]/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
  const bytes = new TextEncoder().encode(norm);
  let h1 = 0x811c9dc5 >>> 0;
  for (let i = 0; i < bytes.length; i++) {
    h1 ^= bytes[i];
    h1 = Math.imul(h1, 0x01000193) >>> 0;
  }
  return `${h1.toString(16).padStart(8, '0')}_${bytes.length}`;
}

export function spanishPhoneticKey(raw: string): string {
  const s0 = String(raw || '').toLowerCase().normalize('NFD');
  const outChars: string[] = [];
  for (let i = 0; i < s0.length; i++) {
    const ch = s0[i];
    if (ch === '\u0303') {
      if (outChars.length > 0 && outChars[outChars.length - 1] === 'n') {
        outChars[outChars.length - 1] = 'ñ';
      }
      continue;
    }
    if (/[\u0300-\u036f]/.test(ch)) continue;
    if (ch >= 'a' && ch <= 'z') outChars.push(ch);
  }
  let s = outChars.join('');
  if (!s) return '';

  s = s.replace(/ch/g, 'X');
  s = s.replace(/h/g, '');
  s = s.replace(/X/g, 'C');
  s = s.replace(/qu/g, 'k');
  s = s.replace(/gu/g, 'g');
  s = s.replace(/c([ei])/g, 's$1');
  s = s.replace(/c/g, 'k');
  s = s.replace(/z/g, 's');
  s = s.replace(/v/g, 'b');
  s = s.replace(/w/g, 'u');
  s = s.replace(/g([ei])/g, 'j$1');
  s = s.replace(/ll/g, 'y');
  s = s.replace(/x/g, 'ks');
  s = s.replace(/ñ/g, 'ny');

  const dedup: string[] = [];
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (dedup.length === 0 || dedup[dedup.length - 1] !== c) {
      dedup.push(c);
    }
  }
  return dedup.join('');
}

const SPANISH_ROMAN_MAP: Record<string, string> = {
  XXII: 'veintidós', XXI: 'veintiuno', XX: 'veinte', XIX: 'diecinueve', XVIII: 'dieciocho',
  XVII: 'diecisiete', XVI: 'dieciséis', XV: 'quince', XIV: 'catorce', XIII: 'trece',
  XII: 'doce', XI: 'once', X: 'diez', IX: 'nueve', VIII: 'ocho', VII: 'siete',
  VI: 'seis', V: 'cinco', IV: 'cuatro', III: 'tres', II: 'dos', I: 'uno'
};

function integerToSpanishWords(n: number): string {
  if (n < 0) return 'menos ' + integerToSpanishWords(-n);
  if (n === 0) return 'cero';
  const ones = [
    '', 'uno', 'dos', 'tres', 'cuatro', 'cinco', 'seis', 'siete', 'ocho', 'nueve',
    'diez', 'once', 'doce', 'trece', 'catorce', 'quince', 'dieciséis', 'diecisiete',
    'dieciocho', 'diecinueve', 'veinte', 'veintiuno', 'veintidós', 'veintitrés',
    'veinticuatro', 'veinticinco', 'veintiséis', 'veintisiete', 'veintiocho', 'veintinueve'
  ];
  const tens: Record<number, string> = {
    30: 'treinta', 40: 'cuarenta', 50: 'cincuenta', 60: 'sesenta',
    70: 'setenta', 80: 'ochenta', 90: 'noventa'
  };
  const hundreds: Record<number, string> = {
    100: 'ciento', 200: 'doscientos', 300: 'trescientos', 400: 'cuatrocientos',
    500: 'quinientos', 600: 'seiscientos', 700: 'setecientos', 800: 'ochocientos', 900: 'novecientos'
  };
  if (n < 30) return ones[n];
  if (n < 100) {
    const t = Math.floor(n / 10) * 10;
    const u = n % 10;
    return u === 0 ? tens[t] : `${tens[t]} y ${ones[u]}`;
  }
  if (n === 100) return 'cien';
  if (n < 1000) {
    const h = Math.floor(n / 100) * 100;
    const rem = n % 100;
    return rem === 0 ? hundreds[h] : `${hundreds[h]} ${integerToSpanishWords(rem)}`;
  }
  if (n < 1000000) {
    const th = Math.floor(n / 1000);
    const rem = n % 1000;
    const thPrefix = th === 1 ? 'mil' : `${integerToSpanishWords(th).replace(/\buno$/, 'un')} mil`;
    return rem === 0 ? thPrefix : `${thPrefix} ${integerToSpanishWords(rem)}`;
  }
  if (n < 1000000000) {
    const mill = Math.floor(n / 1000000);
    const rem = n % 1000000;
    const millPrefix = mill === 1 ? 'un millón' : `${integerToSpanishWords(mill).replace(/\buno$/, 'un')} millones`;
    return rem === 0 ? millPrefix : `${millPrefix} ${integerToSpanishWords(rem)}`;
  }
  return String(n);
}

export function spokenSpanishSyllableWeight(text: string): number {
  if (!text || typeof text !== 'string') return 0;
  let t = text.replace(/[\[{]\s*(?:pausa|pause|silencio)[^\]}]*[\]}]/gi, ' ');

  t = t.replace(/\bkm²\b/gi, 'kilómetros cuadrados');
  t = t.replace(/\bm²\b/gi, 'metros cuadrados');
  t = t.replace(/\ba\.C\.\b/gi, 'antes de cristo');
  t = t.replace(/\bd\.C\.\b/gi, 'después de cristo');
  t = t.replace(/\bEE\.UU\.\b/gi, 'estados unidos');
  t = t.replace(/\bDr\.\b/gi, 'doctor');
  t = t.replace(/\bDra\.\b/gi, 'doctora');
  t = t.replace(/\bSr\.\b/gi, 'señor');
  t = t.replace(/\bSra\.\b/gi, 'señora');

  t = t.replace(/(\d+)\s*%/g, (_, n) => `${integerToSpanishWords(parseInt(n, 10))} por ciento`);
  t = t.replace(/\b(XXII|XXI|XX|XIX|XVIII|XVII|XVI|XV|XIV|XIII|XII|XI|X|IX|VIII|VII|VI|V|IV|III|II|I)\b/g, (m) => SPANISH_ROMAN_MAP[m] || m);
  t = t.replace(/(\d+)[.,](\d+)/g, (_, a, b) => `${integerToSpanishWords(parseInt(a, 10))} punto ${integerToSpanishWords(parseInt(b, 10))}`);
  t = t.replace(/\b(\d{1,3})\.(\d{3})\b/g, (_, a, b) => integerToSpanishWords(parseInt(a + b, 10)));
  t = t.replace(/\b\d+\b/g, (m) => integerToSpanishWords(parseInt(m, 10)));

  const letters = t.replace(/[^a-zA-ZáéíóúÁÉÍÓÚñÑüÜ]/g, '').length;
  const commas = (text.match(/[,]/g) || []).length;
  const semicolons = (text.match(/[;:]/g) || []).length;
  const periods = (text.match(/[.!?…]/g) || []).length;
  const dashes = (text.match(/[—–]/g) || []).length;

  return Math.max(1, letters + commas * 2 + semicolons * 3 + periods * 4 + dashes * 3.5);
}

/**
 * Balances caption text for 16:9 widescreen format so that no line is EVER left with a single word alone.
 * - If text has multiple lines (\n): shifts words between lines or merges lines if needed so each line has >= 2 words.
 * - In each line with >= 2 words: binds the last space as a non-breaking space (\u00A0) preventing browser wrapping orphans.
 */
export function balanceCaptionsFor16x9(text: string): string {
  if (!text) return '';
  const raw = String(text);

  if (!raw.includes('\n')) {
    const words = raw.trim().split(/\s+/).filter(Boolean);
    if (words.length <= 1) return raw;
    const lastWord = words.pop()!;
    const secondLast = words.pop()!;
    return (words.length > 0 ? words.join(' ') + ' ' : '') + secondLast + '\u00A0' + lastWord;
  }

  // Multiline caption
  const lines = raw.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  if (lines.length <= 1) return balanceCaptionsFor16x9(lines[0] || '');

  // Step 1: Rebalance lines so no line has a single word alone
  for (let i = lines.length - 1; i >= 1; i--) {
    const curWords = lines[i].split(/\s+/).filter(Boolean);
    if (curWords.length === 1) {
      const prevWords = lines[i - 1].split(/\s+/).filter(Boolean);
      if (prevWords.length >= 3) {
        // Shift last word from previous line down to current line
        const shifted = prevWords.pop()!;
        lines[i - 1] = prevWords.join(' ');
        lines[i] = `${shifted} ${lines[i]}`;
      } else if (prevWords.length === 2) {
        // Total words across 2 lines is 3 (e.g. "BUSCABAN UNA" / "RESPUESTA") -> in 16:9 merge into 1 line
        lines[i - 1] = `${prevWords.join(' ')} ${curWords[0]}`;
        lines.splice(i, 1);
      } else if (prevWords.length === 1) {
        // Both lines have 1 word -> merge
        lines[i - 1] = `${prevWords[0]} ${curWords[0]}`;
        lines.splice(i, 1);
      }
    }
  }

  // Step 2: Also guard the first line if it was left with 1 word and line 2 has >= 3 words
  if (lines.length >= 2) {
    const firstWords = lines[0].split(/\s+/).filter(Boolean);
    if (firstWords.length === 1) {
      const secondWords = lines[1].split(/\s+/).filter(Boolean);
      if (secondWords.length >= 3) {
        const shifted = secondWords.shift()!;
        lines[0] = `${firstWords[0]} ${shifted}`;
        lines[1] = secondWords.join(' ');
      } else {
        lines[0] = `${firstWords[0]} ${secondWords.join(' ')}`;
        lines.splice(1, 1);
      }
    }
  }

  // Step 3: For each line, bind the last two words with a non-breaking space
  return lines
    .map((l) => {
      const words = l.trim().split(/\s+/).filter(Boolean);
      if (words.length <= 1) return l;
      const lastWord = words.pop()!;
      const secondLast = words.pop()!;
      return (words.length > 0 ? words.join(' ') + ' ' : '') + secondLast + '\u00A0' + lastWord;
    })
    .join('\n');
}

/**
 * "Original" caption mode: one complete sentence per caption. A sentence that fits in one line stays in one
 * line; a longer one is shown in two lines; only a sentence too long for two lines is split, at its commas
 * when it has them (user request 2026-11-26).
 */
export const SENTENCE_CAPTION_LINE_CHARS = 62;

/**
 * Characters that fit in ONE caption line of the "Original" mode. In 16:9 the line may take about 70% of the
 * frame width (62 characters at the default 25px size; a bigger font fits fewer, a smaller one more), so a
 * sentence that fits in one line is never broken in two. 9:16 keeps its narrow 46.
 */
export function sentenceCaptionLineChars(aspectRatio: string, fontSize16x9?: number): number {
  if (aspectRatio === '9:16') return 46;
  const size = Number(fontSize16x9) >= 10 ? Number(fontSize16x9) : 25;
  return Math.max(30, Math.min(78, Math.round((SENTENCE_CAPTION_LINE_CHARS * 25) / size)));
}

export function groupWordsIntoSentenceCaptions<W>(
  words: W[],
  read: (w: W) => { text: string; start: number; end: number; breakFlag?: number },
  lineChars: number = SENTENCE_CAPTION_LINE_CHARS
): Array<{ words: W[]; text: string }> {
  if (!Array.isArray(words) || words.length === 0) return [];
  const maxLine = Math.max(12, Math.round(lineChars));
  const txt = (w: W) => String(read(w).text || '').trim();
  const closers = `["'»”)\\]]*$`;
  const endsSentenceRe = new RegExp(`[.?!…]${closers}`);
  const endsClauseRe = new RegExp(`[,;:—–]${closers}`);
  const isSentenceEnd = (w: W) => {
    const t = txt(w);
    const flag = Number(read(w).breakFlag ?? 0);
    if (flag >= 3) return true; // paragraph or [pausa]
    if (endsSentenceRe.test(t)) return true;
    return flag === 2 && !endsClauseRe.test(t); // a colon closes a clause, not the sentence
  };
  const isClauseEnd = (w: W) => endsClauseRe.test(txt(w)) || Number(read(w).breakFlag ?? 0) >= 1;
  const lenOf = (list: W[]) => list.reduce((acc, w, i) => acc + txt(w).length + (i > 0 ? 1 : 0), 0);

  // 1. Sentences (a silence of 1.5s or more also closes one, so a caption never hangs over a long pause)
  const sentences: W[][] = [];
  let cur: W[] = [];
  for (let i = 0; i < words.length; i++) {
    cur.push(words[i]);
    const next = i + 1 < words.length ? words[i + 1] : null;
    const gapToNext = next ? Number(read(next).start) - Number(read(words[i]).end) : 0;
    if (!next || isSentenceEnd(words[i]) || gapToNext >= 1.5) {
      sentences.push(cur);
      cur = [];
    }
  }

  // 2. Best place to break a list of words in two lines (null = it does not fit in two lines)
  const twoLineSplit = (list: W[]): number | null => {
    let best: number | null = null;
    let bestScore = Infinity;
    for (let i = 1; i < list.length; i++) {
      const l1 = lenOf(list.slice(0, i));
      const l2 = lenOf(list.slice(i));
      if (l1 > maxLine || l2 > maxLine) continue;
      let score = Math.abs(l1 - l2);
      if (isClauseEnd(list[i - 1])) score -= maxLine * 0.3;
      if (list.length >= 4 && (i === 1 || i === list.length - 1)) score += maxLine; // no lone word on a line
      if (score < bestScore) {
        bestScore = score;
        best = i;
      }
    }
    return best;
  };
  const fits = (list: W[]) => lenOf(list) <= maxLine || twoLineSplit(list) !== null;

  // 3. A sentence too long for two lines is cut into even parts, at a comma when one is near the cut
  const splitLong = (list: W[]): W[][] => {
    if (list.length <= 1 || fits(list)) return [list];
    const total = lenOf(list);
    const parts = Math.max(2, Math.ceil(total / (maxLine * 2)));
    const target = total / parts;
    // First try cuts that do not force an extra part later; a comma only attracts the cut when the part
    // before it is not a tiny one
    const pickCut = (keepPartCount: boolean): number => {
      let best = -1;
      let bestScore = Infinity;
      for (let i = 1; i < list.length; i++) {
        const head = list.slice(0, i);
        if (!fits(head)) break;
        const headLen = lenOf(head);
        if (keepPartCount && total - headLen - 1 > (parts - 1) * maxLine * 2 * 0.95) continue;
        let score = Math.abs(headLen - target);
        if (isClauseEnd(list[i - 1]) && headLen >= target * 0.5) score -= maxLine * 0.6;
        if (score < bestScore) {
          bestScore = score;
          best = i;
        }
      }
      return best;
    };
    let best = pickCut(true);
    if (best <= 0) best = pickCut(false);
    if (best <= 0) best = 1; // a single word longer than a line
    return [list.slice(0, best), ...splitLong(list.slice(best))];
  };

  const out: Array<{ words: W[]; text: string }> = [];
  for (const sentence of sentences) {
    for (const chunk of splitLong(sentence)) {
      const plain = chunk.map(txt).join(' ');
      const cut = plain.length > maxLine ? twoLineSplit(chunk) : null;
      out.push({
        words: chunk,
        text:
          cut === null
            ? plain
            : balanceCaptionsFor16x9(
                `${chunk.slice(0, cut).map(txt).join(' ')}\n${chunk.slice(cut).map(txt).join(' ')}`
              ),
      });
    }
  }
  return out;
}

export function buildAudioCaptionsFromSidecarWords(
  words: Array<[string, number, number, number]>,
  options?: { maxWordsPerLine?: number; maxCharsPerLine?: number; lineMode?: 'single' | 'wrap' | 'sentence' }
): CaptionItemLike[] {
  if (!Array.isArray(words) || words.length === 0) return [];
  if (options?.lineMode === 'sentence') {
    // "Original" mode: complete sentences (see groupWordsIntoSentenceCaptions)
    const groups = groupWordsIntoSentenceCaptions(
      words,
      (w) => ({ text: w[0], start: w[1], end: w[2], breakFlag: w[3] }),
      typeof options?.maxCharsPerLine === 'number' && options.maxCharsPerLine > 0
        ? options.maxCharsPerLine
        : SENTENCE_CAPTION_LINE_CHARS
    );
    const sentenceCaps: CaptionItemLike[] = groups.map((g, idx) => {
      const startSec = Number(g.words[0][1]);
      const endSec = Math.max(startSec + 0.25, Number(g.words[g.words.length - 1][2]));
      return {
        id: `cap-vosk-${idx + 1}`,
        index: idx + 1,
        start: Number(startSec.toFixed(3)),
        end: Number(endSec.toFixed(3)),
        text: g.text,
        audioStartSec: Number(startSec.toFixed(3)),
        audioEndSec: Number(endSec.toFixed(3)),
        words: g.words.map((w) => ({
          text: w[0],
          audioStartSec: Number(Number(w[1]).toFixed(3)),
          audioEndSec: Number(Number(w[2]).toFixed(3)),
          breakFlag: (w[3] >= 0 && w[3] <= 4 ? w[3] : 0) as CaptionBreakFlag,
        })),
        alignSource: 'vosk-v2',
      };
    });
    for (let i = 0; i < sentenceCaps.length - 1; i++) {
      if (sentenceCaps[i].end > sentenceCaps[i + 1].start) {
        sentenceCaps[i].end = Number(
          Math.max(sentenceCaps[i].start + 0.2, sentenceCaps[i + 1].start - 0.01).toFixed(3)
        );
        sentenceCaps[i].audioEndSec = sentenceCaps[i].end;
      }
    }
    return sentenceCaps;
  }
  const maxWords = typeof options?.maxWordsPerLine === 'number' && options.maxWordsPerLine > 0 ? options.maxWordsPerLine : 6;
  const maxChars = typeof options?.maxCharsPerLine === 'number' && options.maxCharsPerLine > 0 ? options.maxCharsPerLine : 36;
  const lineMode = options?.lineMode || 'wrap';

  interface LineWord {
    text: string;
    audioStartSec: number;
    audioEndSec: number;
    breakFlag?: CaptionBreakFlag;
  }
  interface LineGroup {
    text: string;
    start: number;
    end: number;
    words: LineWord[];
    lastBreakFlag: CaptionBreakFlag;
    gapToNext: number;
  }

  const lines: LineGroup[] = [];
  let curLineWords: LineWord[] = [];
  let curLineChars = 0;

  for (let i = 0; i < words.length; i++) {
    const [wText, wStart, wEnd, wBreakRaw] = words[i];
    const wBreak = (wBreakRaw >= 0 && wBreakRaw <= 4 ? wBreakRaw : 0) as CaptionBreakFlag;
    const prevW = i > 0 ? words[i - 1] : null;
    const gapFromPrev = prevW ? Math.max(0, wStart - prevW[2]) : 0;
    const prevBreak = prevW ? (prevW[3] as CaptionBreakFlag) : 0;

    const mustBreakBefore =
      curLineWords.length > 0 &&
      (prevBreak >= 2 ||
        gapFromPrev >= 0.28 ||
        (prevBreak === 1 && gapFromPrev >= 0.16) ||
        curLineWords.length >= maxWords ||
        curLineChars + 1 + wText.length > maxChars);

    if (mustBreakBefore) {
      const firstW = curLineWords[0];
      const lastW = curLineWords[curLineWords.length - 1];
      lines.push({
        text: curLineWords.map((w) => w.text).join(' '),
        start: firstW.audioStartSec,
        end: lastW.audioEndSec,
        words: curLineWords,
        lastBreakFlag: (lastW.breakFlag ?? 0) as CaptionBreakFlag,
        gapToNext: gapFromPrev,
      });
      curLineWords = [];
      curLineChars = 0;
    }

    curLineWords.push({
      text: wText,
      audioStartSec: wStart,
      audioEndSec: wEnd,
      breakFlag: wBreak,
    });
    curLineChars += (curLineChars > 0 ? 1 : 0) + wText.length;
  }

  if (curLineWords.length > 0) {
    const firstW = curLineWords[0];
    const lastW = curLineWords[curLineWords.length - 1];
    lines.push({
      text: curLineWords.map((w) => w.text).join(' '),
      start: firstW.audioStartSec,
      end: lastW.audioEndSec,
      words: curLineWords,
      lastBreakFlag: (lastW.breakFlag ?? 0) as CaptionBreakFlag,
      gapToNext: 0,
    });
  }

  interface RawCaption {
    text: string;
    start: number;
    end: number;
    words: LineWord[];
  }
  const rawCaptions: RawCaption[] = [];

  if (lineMode === 'wrap') {
    let k = 0;
    while (k < lines.length) {
      const l1 = lines[k];
      const l2 = k + 1 < lines.length ? lines[k + 1] : null;
      const canPair =
        Boolean(l2) &&
        l1.lastBreakFlag < 2 &&
        l1.gapToNext < 0.28 &&
        !(l1.lastBreakFlag === 1 && l1.gapToNext >= 0.16);

      if (canPair && l2) {
        rawCaptions.push({
          text: balanceCaptionsFor16x9(`${l1.text}\n${l2.text}`),
          start: l1.start,
          end: l2.end,
          words: [...l1.words, ...l2.words],
        });
        k += 2;
      } else {
        rawCaptions.push({
          text: l1.text,
          start: l1.start,
          end: l1.end,
          words: l1.words,
        });
        k += 1;
      }
    }
  } else {
    for (const l of lines) {
      rawCaptions.push({
        text: l.text,
        start: l.start,
        end: l.end,
        words: l.words,
      });
    }
  }

  const result: CaptionItemLike[] = rawCaptions.map((c, idx) => ({
    id: `cap-vosk-${idx + 1}`,
    index: idx + 1,
    start: Number(c.start.toFixed(3)),
    end: Number(Math.max(c.start + 0.25, c.end).toFixed(3)),
    text: c.text,
    audioStartSec: Number(c.start.toFixed(3)),
    audioEndSec: Number(Math.max(c.start + 0.25, c.end).toFixed(3)),
    words: c.words.map((w) => ({
      text: w.text,
      audioStartSec: Number(w.audioStartSec.toFixed(3)),
      audioEndSec: Number(w.audioEndSec.toFixed(3)),
      breakFlag: w.breakFlag,
    })),
    alignSource: 'vosk-v2',
  }));

  for (let i = 0; i < result.length - 1; i++) {
    if (result[i].end > result[i + 1].start) {
      result[i].end = Number(Math.max(result[i].start + 0.2, result[i + 1].start - 0.01).toFixed(3));
      result[i].audioEndSec = result[i].end;
    }
  }

  return result;
}

/**
 * 16:9 safety pass over already-built caption items (one line per item): never leave a single word
 * alone on a line unless it is a one-word sentence. Mirrors the rule inside reformatCaptionItems, for
 * captions that were built or cached without it. Returns the same array when nothing changes.
 */
export function mergeOrphanSingleWordCaptions<
  T extends { start: number; end: number; text: string; audioStartSec?: number; audioEndSec?: number; words?: any[] }
>(items: T[]): T[] {
  if (!Array.isArray(items) || items.length < 2) return items;
  const wordsOf = (t: string) => String(t || '').replace(/\u00A0/g, ' ').trim().split(/\s+/).filter(Boolean);
  const endsSentence = (w: string) => /[.?!…]["'»”)\]]*$/.test(String(w || '').trim());
  const endsStrong = (w: string) => /[.?!…:]["'»”)\]]*$/.test(String(w || '').trim());
  const out: any[] = items.map((it) => ({ ...it }));
  let changed = false;
  for (let k = 0; k < out.length; k++) {
    const cur = out[k];
    if (String(cur.text || '').includes('\n')) continue;
    const curWords = wordsOf(cur.text);
    if (curWords.length !== 1) continue;
    const prev = k > 0 ? out[k - 1] : null;
    const next = k + 1 < out.length ? out[k + 1] : null;
    const prevWords = prev && !String(prev.text || '').includes('\n') ? wordsOf(prev.text) : [];
    const prevLast = prevWords.length > 0 ? prevWords[prevWords.length - 1] : '';
    // A genuine one-word sentence ("¡Silencio!") stays alone
    if (endsSentence(curWords[0]) && (!prevLast || endsStrong(prevLast))) continue;
    const gapPrev = prev ? Number(cur.start) - Number(prev.end) : 999;
    const gapNext = next ? Number(next.start) - Number(cur.end) : 999;
    if (prev && prevLast && !endsSentence(prevLast) && gapPrev < 0.6) {
      const pw = Array.isArray(prev.words) && prev.words.length === prevWords.length ? prev.words : null;
      const cw = Array.isArray(cur.words) && cur.words.length === 1 ? cur.words : null;
      if (prevWords.length >= 3 && pw && cw) {
        // Move the previous line's last word down so both lines keep at least two words
        const moved = pw[pw.length - 1];
        const keptLast = pw[pw.length - 2];
        const prevDelta = Number(prev.start) - Number(prev.audioStartSec ?? prev.start);
        const movedStartTl = Number(moved.audioStartSec) + prevDelta;
        const keptEndTl = Number(keptLast.audioEndSec) + prevDelta;
        if (Number.isFinite(movedStartTl) && Number.isFinite(keptEndTl) && movedStartTl > Number(prev.start)) {
          prev.words = pw.slice(0, -1);
          prev.text = prevWords.slice(0, -1).join(' ');
          prev.end = Number(Math.max(Number(prev.start) + 0.2, Math.min(keptEndTl, movedStartTl)).toFixed(3));
          if (typeof prev.audioEndSec === 'number') prev.audioEndSec = Number(Number(keptLast.audioEndSec).toFixed(3));
          cur.words = [moved, ...cw];
          cur.text = `${prevLast} ${curWords[0]}`;
          cur.start = Number(movedStartTl.toFixed(3));
          if (typeof cur.audioStartSec === 'number') cur.audioStartSec = Number(Number(moved.audioStartSec).toFixed(3));
          changed = true;
          continue;
        }
      }
      // Otherwise join the lone word onto the previous line
      prev.text = `${prevWords.join(' ')} ${curWords[0]}`;
      prev.end = cur.end;
      if (typeof cur.audioEndSec === 'number') prev.audioEndSec = cur.audioEndSec;
      if (Array.isArray(prev.words) && Array.isArray(cur.words)) prev.words = [...prev.words, ...cur.words];
      out.splice(k, 1);
      k--;
      changed = true;
    } else if (next && !endsSentence(curWords[0]) && !String(next.text || '').includes('\n')) {
      // A word stranded before a long silence belongs to the sentence that follows: show it there
      // (keeping the next line's start) instead of flashing it alone seconds earlier.
      const closeToNext = gapNext < 0.6;
      next.text = `${curWords[0]} ${wordsOf(next.text).join(' ')}`;
      if (closeToNext) {
        next.start = cur.start;
        if (typeof cur.audioStartSec === 'number') next.audioStartSec = cur.audioStartSec;
      }
      if (Array.isArray(next.words) && Array.isArray(cur.words)) {
        const lead = closeToNext
          ? cur.words
          : cur.words.map((w: any) => ({
              ...w,
              audioStartSec: next.words[0]?.audioStartSec ?? w.audioStartSec,
              audioEndSec: next.words[0]?.audioStartSec ?? w.audioEndSec,
            }));
        next.words = [...lead, ...next.words];
      }
      out.splice(k, 1);
      k--;
      changed = true;
    }
  }
  if (!changed) return items;
  return out.map((it, i) => ('index' in it ? { ...it, index: i + 1 } : it)) as T[];
}

export function reformatCaptionItems<
  T extends { id?: string; index?: number; start: number; end: number; text: string }
>(
  rawItems: T[],
  options?: {
    maxCharsPerLine?: number;
    maxWordsPerLine?: number;
    mode?: 'subdivide' | 'wrap' | 'original';
    /** 16:9: no dejar una palabra sola en una línea salvo que sea una oración de una sola palabra */
    avoidSingleWordLines?: boolean;
    /** "Original" mode: characters that fit in one line (see sentenceCaptionLineChars) */
    sentenceLineChars?: number;
  }
): T[] {
  if (!Array.isArray(rawItems) || rawItems.length === 0) return [];
  const lineMode = options?.mode ?? 'subdivide';
  const maxCharsPerLine = typeof options?.maxCharsPerLine === 'number' ? options.maxCharsPerLine : 32;
  const maxWordsPerLine = typeof options?.maxWordsPerLine === 'number' ? options.maxWordsPerLine : 0;

  const effChars = lineMode === 'original' ? 46 : maxCharsPerLine;
  const effWords = lineMode === 'original' && maxWordsPerLine <= 0 ? 8 : maxWordsPerLine;

  interface TimedWord {
    word: string;
    start: number;
    end: number;
    audioStartSec: number;
    audioEndSec: number;
    breakFlag?: CaptionBreakFlag;
  }

  const allTimedWords: TimedWord[] = [];

  for (let i = 0; i < rawItems.length; i++) {
    const it = rawItems[i];
    const cleanText = String(it.text || '')
      .replace(/\r?\n/g, ' ')
      .replace(/\s{2,}/g, ' ')
      .trim();
    if (!cleanText) continue;

    const words = cleanText.split(/\s+/).filter(Boolean);
    if (words.length === 0) continue;

    const bStart = Number(it.start || 0);
    const bEnd = Math.max(bStart + 0.15, Number(it.end || bStart + 0.5));
    const bAudioStart = typeof (it as any).audioStartSec === 'number' ? Number((it as any).audioStartSec) : bStart;
    const bAudioEnd = typeof (it as any).audioEndSec === 'number' ? Number((it as any).audioEndSec) : bEnd;
    const timelineDelta = bStart - bAudioStart;

    const itWords = (it as any).words;
    if (Array.isArray(itWords) && itWords.length === words.length) {
      for (let wIdx = 0; wIdx < words.length; wIdx++) {
        const tw = itWords[wIdx];
        const aS = Number(tw.audioStartSec ?? bAudioStart);
        const aE = Number(tw.audioEndSec ?? bAudioEnd);
        allTimedWords.push({
          word: words[wIdx],
          start: aS + timelineDelta,
          end: aE + timelineDelta,
          audioStartSec: aS,
          audioEndSec: aE,
          breakFlag: tw.breakFlag ?? (wIdx === words.length - 1 && /[.?!:;…]$/.test(words[wIdx]) ? 2 : 0),
        });
      }
    } else {
      const bSpan = bEnd - bStart;
      const bAudioSpan = bAudioEnd - bAudioStart;
      const weights = words.map((w) => spokenSpanishSyllableWeight(w));
      const totalW = Math.max(1, weights.reduce((a, b) => a + b, 0));
      let accW = 0;
      for (let wIdx = 0; wIdx < words.length; wIdx++) {
        const fracStart = accW / totalW;
        accW += weights[wIdx];
        const fracEnd = wIdx === words.length - 1 ? 1 : accW / totalW;
        const wS = bStart + fracStart * bSpan;
        const wE = bStart + fracEnd * bSpan;
        const aS = bAudioStart + fracStart * bAudioSpan;
        const aE = bAudioStart + fracEnd * bAudioSpan;
        const isLast = wIdx === words.length - 1;
        allTimedWords.push({
          word: words[wIdx],
          start: wS,
          end: wE,
          audioStartSec: aS,
          audioEndSec: aE,
          breakFlag: isLast && /[.?!:;…]$/.test(words[wIdx]) ? 2 : 0,
        });
      }
    }
  }

  if (allTimedWords.length === 0) return [];

  if (lineMode === 'original') {
    // "Original" mode: complete sentences (see groupWordsIntoSentenceCaptions)
    const sentenceTemplate = rawItems[0];
    const sentenceItems = groupWordsIntoSentenceCaptions(
      allTimedWords,
      (w) => ({
        text: w.word,
        start: w.start,
        end: w.end,
        breakFlag: w.breakFlag,
      }),
      Number(options?.sentenceLineChars) > 0 ? Number(options?.sentenceLineChars) : SENTENCE_CAPTION_LINE_CHARS
    ).map((g, gIdx) => {
      const fTw = g.words[0];
      const lTw = g.words[g.words.length - 1];
      const item: any = {};
      if (sentenceTemplate && typeof sentenceTemplate === 'object') {
        for (const key of Object.keys(sentenceTemplate)) item[key] = (sentenceTemplate as any)[key];
      }
      item.id = `cap-fmt-${gIdx + 1}`;
      item.index = gIdx + 1;
      item.start = Number(fTw.start.toFixed(3));
      item.end = Number(Math.max(fTw.start + 0.2, lTw.end).toFixed(3));
      item.text = g.text;
      item.audioStartSec = Number(fTw.audioStartSec.toFixed(3));
      item.audioEndSec = Number(Math.max(fTw.audioStartSec + 0.2, lTw.audioEndSec).toFixed(3));
      item.words = g.words.map((w) => ({
        text: w.word,
        audioStartSec: Number(w.audioStartSec.toFixed(3)),
        audioEndSec: Number(w.audioEndSec.toFixed(3)),
        breakFlag: w.breakFlag,
      }));
      item.alignSource = (sentenceTemplate as any)?.alignSource || 'vosk-v2';
      return item as T;
    });
    for (let i = 0; i < sentenceItems.length - 1; i++) {
      const a: any = sentenceItems[i];
      const b: any = sentenceItems[i + 1];
      if (a.end > b.start) {
        a.end = Number(Math.max(a.start + 0.15, b.start - 0.01).toFixed(3));
        if (typeof a.audioEndSec === 'number' && typeof b.audioStartSec === 'number') {
          a.audioEndSec = Number(Math.max(a.audioStartSec + 0.15, b.audioStartSec - 0.01).toFixed(3));
        }
      }
    }
    return sentenceItems;
  }

  // Group contiguous words into speech islands, breaking island strictly when:
  // - previous word had breakFlag >= 2 (.?!, \n\n, pause tag)
  // - gap from previous word >= 0.28s
  // - previous word had breakFlag === 1 AND gap from previous >= 0.16s
  // - island span > 14.0s
  const islands: TimedWord[][] = [];
  let curIsland: TimedWord[] = [];

  for (let i = 0; i < allTimedWords.length; i++) {
    const tw = allTimedWords[i];
    const prevTw = curIsland.length > 0 ? curIsland[curIsland.length - 1] : null;
    const gapFromPrev = prevTw ? Math.max(0, tw.start - prevTw.end) : 0;
    const prevBreak = prevTw ? (prevTw.breakFlag ?? 0) : 0;

    const mustBreak =
      curIsland.length > 0 &&
      (prevBreak >= 2 ||
        gapFromPrev >= 0.28 ||
        (prevBreak === 1 && gapFromPrev >= 0.16) ||
        tw.end - curIsland[0].start > 14.0);

    if (mustBreak) {
      islands.push(curIsland);
      curIsland = [];
    }
    curIsland.push(tw);
  }
  if (curIsland.length > 0) islands.push(curIsland);

  const avoidSingle = !!options?.avoidSingleWordLines && effWords !== 1;
  const endsSentence = (w: string) => /[.?!…]["'»”)\]]*$/.test(String(w || '').trim());
  const isOneWordSentence = (line: TimedWord[], prevWord: TimedWord | null) =>
    line.length === 1 && endsSentence(line[0].word) && (!prevWord || /[.?!…:]["'»”)\]]*$/.test(prevWord.word.trim()));
  if (avoidSingle) {
    // Una isla de una sola palabra (por pausa) se une a la vecina, salvo que sea una oración completa
    for (let k = 0; k < islands.length; k++) {
      const isl = islands[k];
      if (isl.length !== 1) continue;
      const prevIsl = k > 0 ? islands[k - 1] : null;
      const prevWord = prevIsl ? prevIsl[prevIsl.length - 1] : null;
      if (isOneWordSentence(isl, prevWord)) continue;
      if (prevIsl && prevWord && !endsSentence(prevWord.word)) {
        prevIsl.push(isl[0]);
        islands.splice(k, 1);
        k--;
      } else if (k + 1 < islands.length && !endsSentence(isl[0].word)) {
        islands[k + 1].unshift(isl[0]);
        islands.splice(k, 1);
        k--;
      }
    }
  }

  const rebuilt: T[] = [];
  const templateItem = rawItems[0];

  for (const isl of islands) {
    // Split island into lines
    const islLines: TimedWord[][] = [];
    let curLine: TimedWord[] = [];
    let curLineChars = 0;

    for (let i = 0; i < isl.length; i++) {
      const tw = isl[i];
      const prev = curLine.length > 0 ? curLine[curLine.length - 1] : null;
      const gap = prev ? Math.max(0, tw.start - prev.end) : 0;
      const prevBreak = prev ? (prev.breakFlag ?? 0) : 0;

      const lineBreak =
        curLine.length > 0 &&
        (prevBreak >= 2 ||
          gap >= 0.28 ||
          (prevBreak === 1 && gap >= 0.16) ||
          (effWords > 0 && curLine.length >= effWords) ||
          curLineChars + 1 + tw.word.length > effChars);

      if (lineBreak) {
        islLines.push(curLine);
        curLine = [];
        curLineChars = 0;
      }
      curLine.push(tw);
      curLineChars += (curLineChars > 0 ? 1 : 0) + tw.word.length;
    }
    if (curLine.length > 0) islLines.push(curLine);

    if (avoidSingle && islLines.length >= 2) {
      for (let k = 0; k < islLines.length; k++) {
        const line = islLines[k];
        if (line.length !== 1) continue;
        const prevLine = k > 0 ? islLines[k - 1] : null;
        const prevWord = prevLine ? prevLine[prevLine.length - 1] : null;
        if (isOneWordSentence(line, prevWord)) continue;
        if (prevLine && prevWord && !endsSentence(prevWord.word)) {
          if (prevLine.length >= 3) {
            line.unshift(prevLine.pop()!); // pasar la última palabra de la línea anterior
          } else {
            prevLine.push(line[0]);
            islLines.splice(k, 1);
            k--;
          }
        } else if (k + 1 < islLines.length) {
          islLines[k + 1].unshift(line[0]);
          islLines.splice(k, 1);
          k--;
        }
      }
    }

    if (lineMode === 'wrap') {
      let k = 0;
      while (k < islLines.length) {
        const l1 = islLines[k];
        const l2 = k + 1 < islLines.length ? islLines[k + 1] : null;
        const lastL1 = l1[l1.length - 1];
        const firstL2 = l2 ? l2[0] : null;
        const gapL1L2 = firstL2 ? Math.max(0, firstL2.start - lastL1.end) : 999;
        const lastL1Break = lastL1.breakFlag ?? 0;

        const canPair =
          Boolean(l2) &&
          lastL1Break < 2 &&
          gapL1L2 < 0.28 &&
          !(lastL1Break === 1 && gapL1L2 >= 0.16);

        const wordsToEmit = canPair && l2 ? [...l1, ...l2] : l1;
        const rawTextToEmit = canPair && l2
          ? `${l1.map((w) => w.word).join(' ')}\n${l2.map((w) => w.word).join(' ')}`
          : l1.map((w) => w.word).join(' ');
        const textToEmit = balanceCaptionsFor16x9(rawTextToEmit);

        const fTw = wordsToEmit[0];
        const lTw = wordsToEmit[wordsToEmit.length - 1];
        const idx = rebuilt.length + 1;

        const newItem: any = {
          id: `cap-fmt-${idx}`,
          index: idx,
          start: Number(fTw.start.toFixed(3)),
          end: Number(Math.max(fTw.start + 0.2, lTw.end).toFixed(3)),
          text: textToEmit,
          audioStartSec: Number(fTw.audioStartSec.toFixed(3)),
          audioEndSec: Number(Math.max(fTw.audioStartSec + 0.2, lTw.audioEndSec).toFixed(3)),
          words: wordsToEmit.map((w) => ({
            text: w.word,
            audioStartSec: Number(w.audioStartSec.toFixed(3)),
            audioEndSec: Number(w.audioEndSec.toFixed(3)),
            breakFlag: w.breakFlag,
          })),
          alignSource: (templateItem as any)?.alignSource || 'vosk-v2',
        };

        if (templateItem && typeof templateItem === 'object') {
          for (const key of Object.keys(templateItem)) {
            if (!['id', 'index', 'start', 'end', 'text', 'audioStartSec', 'audioEndSec', 'words', 'alignSource'].includes(key)) {
              newItem[key] = (templateItem as any)[key];
            }
          }
        }

        rebuilt.push(newItem as T);
        k += canPair ? 2 : 1;
      }
    } else {
      for (const line of islLines) {
        const fTw = line[0];
        const lTw = line[line.length - 1];
        const idx = rebuilt.length + 1;
        const textToEmit = line.map((w) => w.word).join(' ');

        const newItem: any = {
          id: `cap-fmt-${idx}`,
          index: idx,
          start: Number(fTw.start.toFixed(3)),
          end: Number(Math.max(fTw.start + 0.2, lTw.end).toFixed(3)),
          text: textToEmit,
          audioStartSec: Number(fTw.audioStartSec.toFixed(3)),
          audioEndSec: Number(Math.max(fTw.audioStartSec + 0.2, lTw.audioEndSec).toFixed(3)),
          words: line.map((w) => ({
            text: w.word,
            audioStartSec: Number(w.audioStartSec.toFixed(3)),
            audioEndSec: Number(w.audioEndSec.toFixed(3)),
            breakFlag: w.breakFlag,
          })),
          alignSource: (templateItem as any)?.alignSource || 'vosk-v2',
        };

        if (templateItem && typeof templateItem === 'object') {
          for (const key of Object.keys(templateItem)) {
            if (!['id', 'index', 'start', 'end', 'text', 'audioStartSec', 'audioEndSec', 'words', 'alignSource'].includes(key)) {
              newItem[key] = (templateItem as any)[key];
            }
          }
        }

        rebuilt.push(newItem as T);
      }
    }
  }

  for (let i = 0; i < rebuilt.length - 1; i++) {
    if (rebuilt[i].end > rebuilt[i + 1].start) {
      rebuilt[i].end = Number(
        Math.max(rebuilt[i].start + 0.15, rebuilt[i + 1].start - 0.01).toFixed(3)
      );
      if (typeof (rebuilt[i] as any).audioEndSec === 'number' && typeof (rebuilt[i + 1] as any).audioStartSec === 'number') {
        (rebuilt[i] as any).audioEndSec = Number(
          Math.max((rebuilt[i] as any).audioStartSec + 0.15, (rebuilt[i + 1] as any).audioStartSec - 0.01).toFixed(3)
        );
      }
    }
  }

  return rebuilt;
}

export function reformatSrtText(
  srtText: string,
  options?: {
    maxCharsPerLine?: number;
    maxWordsPerLine?: number;
    mode?: 'subdivide' | 'wrap' | 'original';
  }
): { srt: string; blocksCount: number } {
  if (!srtText || !srtText.trim()) return { srt: '', blocksCount: 0 };
  const rawBlocks = srtText.trim().split(/\r?\n\s*\r?\n+/);
  const parsed: Array<{ id: string; index: number; start: number; end: number; text: string }> = [];

  for (let i = 0; i < rawBlocks.length; i++) {
    const lines = rawBlocks[i]
      .split(/\r?\n/)
      .map((l) => l.trim())
      .filter(Boolean);
    if (lines.length < 2) continue;
    const tIdx = lines.findIndex((l) => l.includes('-->'));
    if (tIdx === -1) continue;
    const [sStr, eStr] = lines[tIdx].split('-->');
    const sMs = parseSrtSingleTimeMs(sStr || '');
    const eMs = parseSrtSingleTimeMs(eStr || '');
    if (sMs === null || eMs === null) continue;
    const txt = lines.slice(tIdx + 1).join('\n').trim();
    if (!txt) continue;
    parsed.push({
      id: `srt-${i + 1}`,
      index: parsed.length + 1,
      start: sMs / 1000,
      end: Math.max(sMs / 1000 + 0.2, eMs / 1000),
      text: txt,
    });
  }

  if (parsed.length === 0) return { srt: srtText, blocksCount: 0 };
  const reformatted = reformatCaptionItems(parsed, options);
  const outBlocks = reformatted.map((it, idx) => {
    const sLine = `${formatMsToSrtTime(it.start * 1000)} --> ${formatMsToSrtTime(it.end * 1000)}`;
    return `${idx + 1}\n${sLine}\n${it.text}`;
  });
  return {
    srt: outBlocks.join('\n\n') + '\n',
    blocksCount: outBlocks.length,
  };
}

// ============================================================================
// 5. DETECTOR INTELIGENTE DE PERSONAS POR CLIP (MODO HÍBRIDO OMNI 1.2 FLASH vs LOWER PRIORITY)
// ============================================================================
export type FlowClipEngineType = 'OMNI_1_1_FLASH' | 'VEO_3_1_LITE_LOWER_PRIORITY';
export type FlowProjectEngineMode =
  | 'HYBRID_PEOPLE_OMNI_REST_LOWER'
  | 'VEO_3_1_LITE_LOWER_PRIORITY'
  | 'OMNI_1_1_FLASH';

/**
 * Strips generic Flow policy/anti-mutation boilerplate and Ambient Foley tail so we only
 * inspect the actual visual scene description of the clip.
 */
function stripFlowPromptBoilerplateForSubjectCheck(rawPrompt: string): string {
  if (!rawPrompt) return '';
  return stripZeroPeopleBoilerplatePhrases(
    stripAllClosingBoilerplates(stripAllPromptBrackets(rawPrompt))
  )
    .replace(FLOW_TRAILING_FIX_NAME_RE, ' ')
    .replace(/\bstructured\s+as\s+a\s+completely\s+still\s+archival\s+documentary\s+B-roll\s+plate\b/gi, ' ')
    .replace(/Cinematic historical drama reenactment[^.]*\.?/gi, ' ')
    .replace(/Cinematic historical documentary still-life cinematography[^.]*\.?/gi, ' ')
    .replace(
      /Fixed\s*subject\s*count\s*from\s*0s\s*to\s*\d+s[\s\S]*?(?:bokeh\)\.|geometry\.|physics\.|morphing\)\.)/gi,
      ' '
    )
    .replace(
      /all\s+background\s+furniture,\s+architectural\s+fixtures,\s+and\s+tabletop\s+props\s+remain\s+100%\s+gravity-locked[^.]*\.?/gi,
      ' '
    )
    .replace(/Fixed subject count[^.]*\.?/gi, ' ')
    .replace(/clear anatomical separation between subjects[^.]*\.?/gi, ' ')
    .replace(/strictly no morphing[^.]*\.?/gi, ' ')
    .replace(/objects and hands maintain solid physical persistence[^.]*\.?/gi, ' ')
    .replace(/natural human anatomy[^.]*\.?/gi, ' ')
    .replace(/historian's\s+wooden\s+desk/gi, 'wooden desk')
    .replace(/,\s*with\s+subtle\s+ambient\s+foley\s+of\s+[\s\S]*$/i, ' ')
    .replace(/Ambient\s+Foley\s*:[\s\S]*$/i, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

const KNOWN_LOCATION_AT_TAG_PREFIX_RE =
  /^@(?:Enfermer[ií]a|Hospital|Laboratorio|Escuela|Sala|Mesa|Planta|Playas?|Boticas?|Sal[oó]n|Puerto|Muelle|Calle|Plaza|Palacio|Iglesia|Catedral|Castillo|Ciudad|Oficina|Banco|F[aá]brica|Estaci[oó]n|Tren|Barco|Puente|Valle|R[ií]o|Mina|Taller|Mercado|Archivo|Biblioteca|Tribunal|Parlamento|C[aá]mara|Universidad|Instituto|Cl[ií]nica|Farmacia|Almac[eé]n|Bodega|Cuartel|Trinchera|Campo| Playa| Costa| Isla| Bah[ií]a| Teatro| Museo)_/i;

const HUMAN_SUBJECT_SCENE_REGEX =
  /\b(man|men|woman|women|boy|boys|girl|girls|child|children|adult|adults|person|people|visitor|visitors|volunteer|volunteers|executive|executives|crowd|crowds|audience|listeners|spectators|delegate|delegates|passenger|passengers|peasant|peasants|worker|workers|laborer|laborers|miner|miners|sailor|sailors|soldier|soldiers|medic|medics|officer|officers|guard|guards|gendarme|gendarmes|policeman|policemen|constable|constables|contractor|contractors|official|officials|inspector|inspectors|clerk|clerks|notary|moneylender|usurer|merchant|merchants|grocer|grocers|governor|governors|captain|captains|doctor|doctors|physician|physicians|clinician|clinicians|surgeon|surgeons|nurse|nurses|patient|patients|pharmacist|pharmacists|scientist|scientists|researcher|researchers|scholar|scholars|professor|professors|director|directors|specialist|specialists|biochemist|biochemists|mycologist|mycologists|chemist|chemists|bacteriologist|bacteriologists|pathologist|pathologists|microbiologist|microbiologists|historian|historians|technician|technicians|assistant|assistants|journalist|journalists|reporter|reporters|diplomat|diplomats|priest|priests|monk|monks|bishop|bishops|clergyman|clergymen|king|kings|queen|queens|emperor|emperors|empress|empresses|prince|princes|princess|princesses|monarch|monarchs|ruler|rulers|sovereign|sovereigns|noble|nobles|nobleman|noblemen|noblewoman|noblewomen|farmer|farmers|villager|villagers|citizen|citizens|migrant|migrants|emigrant|emigrants|immigrant|immigrants|refugee|refugees|exile|exiles|traveler|travelers|pedestrian|pedestrians|couple|family|families|mother|father|parents|son|daughter|brother|sister|widow|elder|elders|veteran|veterans|blacksmith|carpenter|baker|tailor|weaver|fisherman|fishermen|shepherd|beggar|prisoner|prisoners|captive|captives|pilgrim|pilgrims|colonist|colonists|settler|settlers|actor|actors|actress|actresses|figure|figures|leader|leaders|statesman|statesmen|politician|politicians|poet|poets|writer|writers|author|authors|inventor|inventors|engineer|engineers|industrialist|industrialists|pioneer|pioneers|founder|founders|general|generals|commander|commanders|admiral|admirals|colonel|colonels|minister|ministers|mayor|mayors|judge|judges|lawyer|lawyers|philosopher|philosophers|composer|composers|architect|architects|explorer|explorers|operator|operators|courtier|courtiers|courtesan|courtesans|aristocrat|aristocrats|lord|lords|lady|ladies|duke|dukes|duchess|baron|barons|knight|knights|squire|squires|herald|heralds|jester|jesters|minstrel|minstrels|troubadour|troubadours|musician|musicians|dancer|dancers|guest|guests|diner|diners|banqueter|banqueters|cook|cooks|chef|chefs|servant|servants|maid|maids|maidservant|maidservants|handmaid|handmaids|butler|steward|stewards|cupbearer|cupbearers|attendant|attendants|apprentice|apprentices|craftsman|craftsmen|artisan|artisans|mason|masons|stonemason|stonemasons|scribe|scribes|nun|nuns|abbot|abbess|friar|friars|warrior|warriors|archer|archers|horseman|horsemen|rider|riders|hunter|hunters|falconer|falconers|executioner|healer|healers|midwife|midwives|messenger|messengers|onlooker|onlookers|bystander|bystanders|slave|slaves|serf|serfs|townsfolk|townspeople|\d+-year-old|he|she|him|his|her|seated\s+beside|in\s+his\s+hands|in\s+her\s+hands|silhouette\s+of\s+a\s+(?:man|woman|person|figure|boy|girl|doctor|scientist|soldier|officer)|figures?\s+(?:walking|standing|working|boarding|carrying|waiting|huddled|gathered|sitting|kneeling|running|looking|watching|leaning|examining)|(?:weathered|gloved|bare|trembling|steady|aged)\s+hands|hands\s+(?:holding|signing|counting|turning|resting|trembling|clutching|writing|tying|stitching|open|opening|closing|pouring|forging|hammering|placing|lifting|adjusting|sealing|labeling|examining|pipetting))\b/i;

/**
 * Pure visual-content human detector that ignores B-Roll static plate flags and strips all
 * legacy/corrupted closing or zero-people boilerplates first, ensuring zero contradictions
 * between `HUMAN_ACTION` and `EMPTY_ENVIRONMENT` even on archival B-Roll portraits (e.g. Clip 47).
 */
export function detectPromptSceneHasHumanSubjects(
  sceneText: string,
  references?: ReferenceAsset[]
): boolean {
  const combined = stripFlowPromptBoilerplateForSubjectCheck(sceneText || '');
  if (!combined) return false;

  const foundTags = combined.match(/@[A-Za-z0-9_ÁÉÍÓÚáéíóúÑñ]{2,}/g) || [];
  if (foundTags.length > 0) {
    const refCategoryBySlug = new Map<string, string>();
    if (Array.isArray(references)) {
      for (const r of references) {
        if (r?.tag) {
          refCategoryBySlug.set(r.tag.trim().toLowerCase(), r.category || '');
        }
      }
    }
    for (const tag of foundTags) {
      const lowerTag = tag.toLowerCase();
      const knownCat = refCategoryBySlug.get(lowerTag);
      if (knownCat === 'persona') return true;
      if (knownCat === 'lugar' || KNOWN_LOCATION_AT_TAG_PREFIX_RE.test(tag)) continue;
      return true;
    }
  }

  // Pure flat print/lithograph/engraving/map on desk without live human actors
  const isPurePrintOrMap =
    /\b(satirical\s+lithograph|vintage\s+\d*\s*lithograph|woodcut\s+engraving|cartographic\s+map|overhead\s+view\s+of\s+an\s+antique|macro\s+close-up\s+on\s+an\s+antique\s+(?:historian's\s+)?wooden\s+desk)\b/i.test(
      combined
    ) &&
    !/\b(hands?\s+(?:holding|signing|counting|writing|turning|resting|pointing|stamping|lifting|adjusting|placing|pouring)|man|woman|clerk|notary|official|actor|scientist|doctor|researcher|scholar)\b/i.test(
      combined
    );
  if (isPurePrintOrMap) {
    return false;
  }

  // Mask negated human phrases (e.g. "zero human hands", "without any people", "no human figures") before positive match
  const maskedNegations = combined.replace(
    /\b(?:zero|no|without(?:\s+any)?|devoid\s+of)\s+(?:live\s+|moving\s+|visible\s+|human\s+)?(?:people|persons|humans|men|women|adults|figures|characters|actors|hands|silhouettes|subjects|presence)\b/gi,
    ' '
  );

  return HUMAN_SUBJECT_SCENE_REGEX.test(maskedNegations);
}

/**
 * Automatically detects whether a clip depicts live human subjects (people, characters, @Person Ref,
 * crowds, officers, hands in action) vs. a B-roll without people (landscapes, ships at sea,
 * maps, documents, lithographs, objects, architecture, empty @Location interiors).
 */
export function detectClipHasHumanSubjects(
  clip: {
    imagePrompt?: string;
    videoPrompt?: string;
    visualExplanation?: string;
    isStaticBroll?: boolean;
  },
  references?: ReferenceAsset[]
): boolean {
  if (
    clip.isStaticBroll ||
    isImageOnlyBrollPrompt(clip.imagePrompt) ||
    /\[B-Roll\s*:\s*STATIC_[A-Z_]+\]|STATIC\s+B-ROLL\s+PLATE\s+LOCK|IMAGE\s+ONLY\s*[—–-]?\s*DO\s+NOT\s+GENERATE\s+VIDEO\s+CLIP/i.test(
      `${clip.imagePrompt || ''} ${clip.videoPrompt || ''}`
    )
  ) {
    return false;
  }
  const rawImgOrig = clip.imagePrompt || '';
  const rawVidOrig = clip.videoPrompt || '';
  const cleanExp = (clip.visualExplanation || '').trim();

  if (detectPromptSceneHasHumanSubjects(`${rawImgOrig} ${rawVidOrig}`, references)) {
    return true;
  }

  // Always check Spanish visualExplanation as well (even when English prompts exist, in case @Tag was sanitized)
  if (
    cleanExp &&
    /\b(hombre|hombres|mujer|mujeres|niño|niña|niños|persona|personas|gente|multitud|oyentes|público|pasajeros|campesinos|obreros|trabajadores|marineros|soldados|oficiales|guardias|funcionarios|escribano|prestamista|comerciantes|gobernador|capitán|médico|doctora|doctor|enfermera|paciente|científico|investigador|químico|ejecutivo|ejecutivos|policía|sacerdote|monje|rey|reina|emperador|agricultor|emigrantes|inmigrantes|viajeros|pareja|familia|madre|padre|hijo|hija|anciano)\b/i.test(
      cleanExp
    )
  ) {
    return true;
  }

  return false;
}

/**
 * Resolves which Google Flow video engine a clip should use, taking into account:
 * 1) If project mode is forced to all-Lower-Priority or all-Omni-Flash
 * 2) If the user manually toggled `clip.flowClipEngine` on that specific clip
 * 3) Otherwise, automatic human detection (`Omni 1.2 Flash` for people, `Veo 3.1 - Lite [Lower Priority]` for rest)
 */
export function resolveClipFlowVideoEngine(
  clip: {
    imagePrompt?: string;
    videoPrompt?: string;
    visualExplanation?: string;
    flowClipEngine?: FlowClipEngineType;
    isStaticBroll?: boolean;
  },
  projectEngineMode: FlowProjectEngineMode = 'HYBRID_PEOPLE_OMNI_REST_LOWER',
  references?: ReferenceAsset[]
): FlowClipEngineType {
  if (projectEngineMode === 'OMNI_1_1_FLASH') return 'OMNI_1_1_FLASH';
  if (projectEngineMode === 'VEO_3_1_LITE_LOWER_PRIORITY') return 'VEO_3_1_LITE_LOWER_PRIORITY';
  if (
    clip.flowClipEngine === 'OMNI_1_1_FLASH' ||
    clip.flowClipEngine === 'VEO_3_1_LITE_LOWER_PRIORITY'
  ) {
    return clip.flowClipEngine;
  }
  if (clip.isStaticBroll) return 'VEO_3_1_LITE_LOWER_PRIORITY';
  return detectClipHasHumanSubjects(clip, references) ? 'OMNI_1_1_FLASH' : 'VEO_3_1_LITE_LOWER_PRIORITY';
}

/**
 * Formats a `Clip XX` video prompt cleanly into a bracketless, colon-free single paragraph
 * preserving exact Stage 1 prose duration and trailing `fix the name to Clip_XX_generate_a_video_in_16_9`
 * without re-injecting legacy `[Duration: ...]` or `[Model: ...]` brackets.
 */
export function applyClipFlowVideoEngineTag(
  videoPrompt: string,
  _engine: FlowClipEngineType,
  durationSec?: number,
  _brollCameraMotion?: BrollCameraMotion | null
): string {
  if (!videoPrompt || !videoPrompt.trim()) return videoPrompt;
  return sanitizeVideoClipPromptForFlowSafety(videoPrompt, undefined, undefined, {
    durationSec: typeof durationSec === 'number' && durationSec > 0 ? durationSec : undefined,
  });
}

export function inferBestBrollMotionForNarration(
  narration: string,
  visualHint: string = '',
  slotIndex: number = 0
): BrollCameraMotion {
  const txt = `${narration} ${visualHint}`.toLowerCase();
  if (/\b(torre|vertical|altura|estanter[ií]as|columna|ascend|arriba|catedral|chimenea|tanques?\s+verticales)\b/i.test(txt)) {
    return 'tilt_up';
  }
  if (/\b(cenital|cuadr[ií]cula|diez\s+placas|overhead|ca[ií]da|desplom|descend|abajo)\b/i.test(txt)) {
    return 'tilt_down';
  }
  if (/\b(millones|miles|inmens|mundo|planeta|continente|imperio|olvido|abandono|almac[eé]n|oc[eé]ano|soledad|pausa)\b/i.test(txt)) {
    return slotIndex % 2 === 1 ? 'zoom_out' : 'zoom_in';
  }
  if (/\b(ruta|mapa|puerto|costa|r[ií]o|frontera|orilla|calle|hileras|filas|pizarra|escaparate)\b/i.test(txt)) {
    return slotIndex % 2 === 0 ? 'pan_right' : 'pan_left';
  }
  const rotation: BrollCameraMotion[] = [
    'zoom_in',
    'zoom_out',
    'pan_right',
    'zoom_in',
    'tilt_up',
    'pan_left',
    'zoom_out',
    'tilt_down',
  ];
  return rotation[slotIndex % rotation.length];
}

export function applyStaticBrollMotionToClip(
  clip: DocumentaryClip,
  enabled: boolean,
  motion: BrollCameraMotion = 'zoom_in',
  durationSec: number = 8
): DocumentaryClip {
  const numStr = clip.clipNumber < 10 ? `0${clip.clipNumber}` : `${clip.clipNumber}`;
  if (!enabled) {
    const cleanedImgBase = stripBrollControlTagsFromImagePrompt(clip.imagePrompt || '')
      .replace(
        /\bstructured\s+as\s+a\s+completely\s+still\s+archival\s+documentary\s+B-roll\s+plate\s+(?:showing|depicting)\s+/gi,
        'of '
      )
      .replace(/,?\s*designed\s+as\s+a\s+100%\s+frozen\s+documentary\s+B-roll\s+still\s+plate\b/gi, '')
      .replace(/\s{2,}/g, ' ')
      .trim();
    const cleanedImg = cleanedImgBase
      ? ensureAntiMutationPhysicsInPrompt(cleanedImgBase, true, durationSec)
      : clip.imagePrompt;

    const candidatePrevVid = [clip.previousVideoPrompt, clip.videoPrompt]
      .map((v) => String(v || '').trim())
      .find(
        (v) =>
          v.length > 20 &&
          !/STATIC\s+B-ROLL\s+PLATE\s+LOCK/i.test(v) &&
          !/\[B-Roll\s*:\s*STATIC_/i.test(v)
      );

    let restoredVid = '';
    if (candidatePrevVid) {
      restoredVid = applyClipFlowVideoEngineTag(
        ensureAntiMutationPhysicsInPrompt(candidatePrevVid, false, durationSec),
        clip.flowClipEngine || 'VEO_3_1_LITE_LOWER_PRIORITY',
        durationSec,
        null
      );
    } else {
      const cleanSubject = cleanedImgBase
        .replace(/^(?:Image|Imagen)\s*\[?0*\d+\]?(?:\s*\([^)]*\))?\s*:\s*/i, '')
        .replace(
          /^Create\s+an\s+image(?:\s+in\s+(?:16:9\s+horizontal|9:16\s+vertical)\s+aspect\s+ratio)?\s+(?:of\s+|showing\s+|depicting\s+)?/i,
          ''
        )
        .replace(/,?\s*8k\s+photorealistic[\s\S]*$/i, '')
        .replace(/\.?\s*$/, '')
        .trim();
      const synthRaw = `Clip ${numStr} (${clip.timeRange || '00:00 - 00:08'}): Create a cinematic ${durationSec}-second video showing a smooth, controlled fluid-head camera glide across ${cleanSubject || 'the historical documentary scene'}. Ambient Foley: subtle period room tone and natural atmospheric acoustics, single continuous shot, strictly no shot changes, no music, no speech, no text.`;
      restoredVid = applyClipFlowVideoEngineTag(
        ensureAntiMutationPhysicsInPrompt(synthRaw, false, durationSec),
        clip.flowClipEngine || 'VEO_3_1_LITE_LOWER_PRIORITY',
        durationSec,
        null
      );
    }

    const cleanedCam = (clip.cameraSelection || '')
      .replace(/^🖼️\s*B-Roll\s+Est[áa]tico\s*\([^)]+\)\s*—\s*/i, '')
      .replace(/^Static\s+B-Roll\s+Plate\s*[—–-]\s*/i, '')
      .trim();
    return {
      ...clip,
      isStaticBroll: undefined,
      brollCameraMotion: undefined,
      cameraSelection: cleanedCam || 'Plano Documental Cinematográfico',
      imagePrompt: cleanedImg,
      videoPrompt: restoredVid,
      previousVideoPrompt: undefined,
    };
  }

  const motionLabelEs = BROLL_MOTION_UI_LABEL_ES[motion] || 'Zoom In';
  const baseCam = (clip.cameraSelection || 'Lámina Documental de Archivo')
    .replace(/^🖼️\s*B-Roll\s+Est[áa]tico\s*\([^)]+\)\s*—\s*/i, '')
    .replace(/^Static\s+B-Roll\s+Plate\s*[—–-]\s*/i, '')
    .trim();
  const updatedCameraSelection = `🖼️ B-Roll Estático (${motionLabelEs}) — ${baseCam || 'Lámina Documental de Archivo'}`;

  const currentVid = String(clip.videoPrompt || '').trim();
  const preservedPrevVid =
    currentVid.length > 20 &&
    !/STATIC\s+B-ROLL\s+PLATE\s+LOCK/i.test(currentVid) &&
    !/\[B-Roll\s*:\s*STATIC_/i.test(currentVid)
      ? currentVid
      : clip.previousVideoPrompt;

  const updatedImg = normalizeBrollImagePrompt(
    clip.imagePrompt || '',
    clip.clipNumber,
    clip.timeRange,
    durationSec,
    motion
  );

  return {
    ...clip,
    isStaticBroll: true,
    brollCameraMotion: motion,
    cameraSelection: updatedCameraSelection,
    imagePrompt: updatedImg,
    videoPrompt: '',
    previousVideoPrompt: preservedPrevVid,
  };
}

export function pickPeriodicStaticBrollTimelineTargets(
  rows: Array<{
    clipNum: number;
    startSec: number;
    endSec: number;
    text: string;
    isNonHuman?: boolean;
    authoredBrollMotion?: BrollCameraMotion;
  }>,
  intervalMinutes: number = 2
): Map<number, BrollCameraMotion> {
  const result = new Map<number, BrollCameraMotion>();
  if (!rows.length || !Number.isFinite(intervalMinutes) || intervalMinutes <= 0) return result;
  const intervalSec = Math.max(60, Math.round(intervalMinutes * 60));
  const totalEndSec = rows[rows.length - 1]?.endSec || 0;
  if (totalEndSec < 110) return result;

  const archivalScoreRe =
    /\b(bolet[ií]n|revista|p[aá]ginas?|libro|manuscrito|decreto|peri[oó]dico|carta|patente|plano|mapa|archivo|acta|documento|cifra|unidades|costo|centavos|d[oó]lares|libras|frasco|vial|ampolla|placa|cultivo|moho|vasija|cer[aá]mica|tuber[ií]as|tanques|almac[eé]n|puerto|fachada|estante|pizarra|f[oó]rmula|estad[ií]stica)\b/gi;
  const liveHumanActionPenaltyRe =
    /\b(pedaleaba|subi[oó]\s+al\s+estrado|abri[oó]\s+la\s+puerta|viajar[ií]a|abraz|estrech[oó]|habl[oó]|grit[oó]|corri[oó]|caminaba|reclut[oó]|contrataron|dale\s+like|suscr[ií]bete|comentarios)\b/i;

  let slotIdx = 0;
  for (let targetSec = intervalSec; targetSec <= totalEndSec - 28; targetSec += intervalSec) {
    const windowRows = rows.filter(
      (r) =>
        r.clipNum >= 8 &&
        r.startSec >= 50 &&
        r.endSec <= totalEndSec - 16 &&
        Math.abs(r.startSec - targetSec) <= 28 &&
        r.isNonHuman !== false &&
        !result.has(r.clipNum)
    );
    if (windowRows.length === 0) continue;

    let bestRow: (typeof windowRows)[number] | null = null;
    let bestScore = -9999;
    for (const r of windowRows) {
      if (r.isNonHuman === false) continue;
      let score = 0;
      if (r.isNonHuman === true) score += 45;
      if (r.authoredBrollMotion) score += 120;
      const matches = r.text.match(archivalScoreRe);
      if (matches) score += matches.length * 14;
      if (/\[pausa/i.test(r.text)) score += 12;
      if (liveHumanActionPenaltyRe.test(r.text)) score -= 35;
      score -= Math.abs(r.startSec - targetSec) * 0.45;
      if (score > bestScore) {
        bestScore = score;
        bestRow = r;
      }
    }
    if (!bestRow) continue;
    const motion =
      bestRow.authoredBrollMotion || inferBestBrollMotionForNarration(bestRow.text, '', slotIdx);
    result.set(bestRow.clipNum, motion);
    slotIdx++;
  }
  return result;
}

export function autoAssignPeriodicStaticBrollClips(
  clips: DocumentaryClip[],
  intervalMinutes: number = 2,
  standardClipDurationSec: number = 8,
  references?: ReferenceAsset[]
): DocumentaryClip[] {
  if (!Array.isArray(clips) || clips.length === 0) return clips;
  const parseStartEnd = (rangeStr: string, idx: number): { startSec: number; endSec: number } => {
    const m = String(rangeStr || '').match(/(\d{1,3}):(\d{2})\s*-\s*(\d{1,3}):(\d{2})/);
    if (m) {
      return {
        startSec: parseInt(m[1], 10) * 60 + parseInt(m[2], 10),
        endSec: parseInt(m[3], 10) * 60 + parseInt(m[4], 10),
      };
    }
    return {
      startSec: idx * standardClipDurationSec,
      endSec: (idx + 1) * standardClipDurationSec,
    };
  };

  if (!Number.isFinite(intervalMinutes) || intervalMinutes <= 0) {
    return clips.map((c) =>
      c.isStaticBroll
        ? applyStaticBrollMotionToClip(
            c,
            false,
            'zoom_in',
            c.clipNumber === 1 ? 6 : standardClipDurationSec
          )
        : c
    );
  }

  const rows = clips.map((c, idx) => {
    const { startSec, endSec } = parseStartEnd(c.timeRange, idx);
    const hasHumans = detectClipHasHumanSubjects({ ...c, isStaticBroll: false }, references);
    const authoredParse = parseBrollMotionFromText(
      `${c.imagePrompt || ''} ${c.videoPrompt || ''}`,
      c.cameraSelection,
      c.visualExplanation
    );
    return {
      clipNum: c.clipNumber,
      startSec,
      endSec,
      text: `${c.narrationSegment || ''} ${c.visualExplanation || ''}`,
      isNonHuman: !hasHumans,
      authoredBrollMotion: !hasHumans && authoredParse.isStaticBroll
        ? authoredParse.brollCameraMotion || 'zoom_in'
        : undefined,
    };
  });

  const targets = pickPeriodicStaticBrollTimelineTargets(rows, intervalMinutes);
  return clips.map((c, idx) => {
    const dur = c.clipNumber === 1 ? 6 : standardClipDurationSec;
    const row = rows[idx];
    // Preserve explicit zero-human B-Roll plates authored by Gemini even if slightly outside the 28s window
    const assignedMotion = targets.get(c.clipNumber) || row?.authoredBrollMotion;
    if (assignedMotion && row?.isNonHuman !== false) {
      return applyStaticBrollMotionToClip(c, true, assignedMotion, dur);
    }
    if (c.isStaticBroll) {
      return applyStaticBrollMotionToClip(c, false, 'zoom_in', dur);
    }
    return c;
  });
}

export interface ParsedStage5TriggerRawBlock {
  id: 'A' | 'B' | 'C';
  title: string;
  description: string;
  rawPrompt: string;
  suggestedOverlay: string;
}

/**
 * Parses Stage 5 Neuropsychological Click Triggers ([DISPARADOR_A/B/C] or Opción A/B/C or 1/2/3)
 * across all real-world Gemini Markdown/plain-text variations (`**TITULO:**`, `TEXTO EN PANTALLA:`,
 * `PROMPT TÉCNICO:`, pipe-flattened lines, inline header titles, etc.) and sanitizes editorial output.
 */
export function parseStage5TriggerBlocksShared(rawText: string): {
  blocks: ParsedStage5TriggerRawBlock[];
  directEnglishCandidate: string;
} {
  const cleaned = String(rawText || '')
    .replace(/\r\n/g, '\n')
    .replace(/^```(?:text|markdown|plaintext)?\s*\n?/i, '')
    .replace(/\n?```\s*$/i, '')
    .replace(
      /\s+\|\s+(?=(?:[-•*# \t]|\d+[.)][ \t]*)*(?:\[?[ \t]*(?:DISPARADOR|OPCI[OÓ]N|OPTION|TRIGGER)[_\s\-]*(?:[ABC]|[123])\b|T[IÍ]TULO\b|TITLE\b|DESCRIPCI[OÓ]N\b|DESCRIPTION\b|EXPLICACI[OÓ]N\b|TEXTO[_\s]*(?:EN[_\s]*)?PANTALLA\b|SCREEN[_\s]*TEXT\b|OVERLAY\b|PROMPT\b))/gi,
      '\n'
    )
    // Ensure DOM-concatenated paragraphs from Gemini (`...no music.[DISPARADOR_B] TITULO: ... DESCRIPCION: ...`) always split cleanly onto new lines
    .replace(/([^\n])(\[\s*(?:DISPARADOR|OPCI[OÓ]N|OPTION|TRIGGER)[_\s\-]*[ABC123]\s*\])/gi, '$1\n$2')
    .replace(
      /([^\n])\s+((?:\*+\s*)?(?:T[IÍ]TULO|TITLE|DESCRIPCI[OÓ]N|DESCRIPTION|EXPLICACI[OÓ]N|TEXTO[_\s]*(?:EN[_\s]*)?PANTALLA|SCREEN[_\s]*TEXT|OVERLAY(?:[_\s]*TEXT)?|(?:IMAGE[ \t]+)?PROMPT(?:[ \t]+(?:T[EÉ]CNICO|EN[ \t]+INGL[EÉ]S|VISUAL))?)(?:\s*\*+)?\s*:)/gi,
      '$1\n$2'
    )
    .trim();

  if (!cleaned) {
    return { blocks: [], directEnglishCandidate: '' };
  }

  const mapTokenToId = (tok: string): 'A' | 'B' | 'C' => {
    const u = String(tok || '').trim().toUpperCase();
    if (u === 'B' || u === '2') return 'B';
    if (u === 'C' || u === '3') return 'C';
    return 'A';
  };

  const headerLineRegex =
    /(?:^|\n)[ \t]*(?:[-•*# \t]|\d+[.)][ \t]*)*\[?[ \t]*(?:DISPARADOR|OPCI[OÓ]N|OPTION|TRIGGER)(?:[ \t]+NEUROPSICOL[OÓ]GICO)?[_\s\-]*([ABC123])\b[ \t]*\]?(?:[ \t]*\*+)?(?:[ \t]*[:\-—–][ \t]*([^\n]*))?/gi;

  const headerHits: Array<{
    id: 'A' | 'B' | 'C';
    inlineTitle: string;
    startIdx: number;
    bodyStartIdx: number;
  }> = [];

  let hm: RegExpExecArray | null;
  while ((hm = headerLineRegex.exec(cleaned)) !== null) {
    const rawIdTok = hm[1] || 'A';
    const inlineTail = String(hm[2] || '').trim();
    // Skip accidental matches inside a sentence if inlineTail looks like lowercase continuation without fields nearby
    const matchStart = hm.index + (hm[0].startsWith('\n') ? 1 : 0);
    const bodyStart = hm.index + hm[0].length;
    headerHits.push({
      id: mapTokenToId(rawIdTok),
      inlineTitle: inlineTail.replace(/^\*+|\*+$/g, '').trim(),
      startIdx: matchStart,
      bodyStartIdx: bodyStart,
    });
  }

  const stripFieldMd = (val?: string) =>
    String(val || '')
      .replace(/^\s*\*+\s*|\s*\*+\s*$/g, '')
      .replace(/^["'`«»“”]+|["'`«»“”]+$/g, '')
      .trim();

  const blocks: ParsedStage5TriggerRawBlock[] = [];

  for (let i = 0; i < headerHits.length; i++) {
    const cur = headerHits[i];
    const nextStart = i + 1 < headerHits.length ? headerHits[i + 1].startIdx : cleaned.length;
    const body = cleaned.slice(cur.bodyStartIdx, nextStart);

    const titleMatch = body.match(
      /(?:^|\n)[ \t]*(?:[-•*][ \t]+)?(?:\*+[ \t]*)?(?:T[IÍ]TULO(?:[ \t]+DEL[ \t]+DISPARADOR)?|TITLE)[ \t]*(?:\*+)?[ \t]*:[ \t]*(?:\*+)?[ \t]*([^\n]+)/i
    );
    const descMatch = body.match(
      /(?:^|\n)[ \t]*(?:[-•*][ \t]+)?(?:\*+[ \t]*)?(?:DESCRIPCI[OÓ]N|DESCRIPTION|EXPLICACI[OÓ]N|JUSTIFICACI[OÓ]N)[ \t]*(?:\*+)?[ \t]*:[ \t]*(?:\*+)?[ \t]*([^\n]+(?:\n(?![ \t]*(?:[-•*][ \t]+)?(?:\*+[ \t]*)?(?:TEXTO[_\s]*(?:EN[_\s]*)?PANTALLA|SCREEN[_\s]*TEXT|OVERLAY|PROMPT|T[IÍ]TULO|TITLE)\b)[^\n]+)*)/i
    );
    const overlayMatch = body.match(
      /(?:^|\n)[ \t]*(?:[-•*][ \t]+)?(?:\*+[ \t]*)?(?:TEXTO[_\s]*(?:EN[_\s]*)?PANTALLA|SCREEN[_\s]*TEXT|OVERLAY(?:[_\s]*TEXT)?)[ \t]*(?:\*+)?[ \t]*:[ \t]*(?:\*+)?[ \t]*([^\n]+)/i
    );
    const promptMatch = body.match(
      /(?:^|\n)[ \t]*(?:[-•*][ \t]+)?(?:\*+[ \t]*)?(?:IMAGE[ \t]+)?PROMPT(?:[ \t]+(?:T[EÉ]CNICO|EN[ \t]+INGL[EÉ]S|VISUAL))?[ \t]*(?:\*+)?[ \t]*:[ \t]*(?:\*+)?[ \t]*([\s\S]+)$/i
    );

    const rawTitleCandidate = stripFieldMd(titleMatch?.[1] || cur.inlineTitle || '')
      .replace(/^(?:opci[oó]n|option|disparador|trigger)\s*[abc123]\s*[:\-—–.]?\s*/i, '')
      .trim();
    const safeTitleCore = sanitizeBrandSafeEditorialText(rawTitleCandidate);
    const cleanTitle = safeTitleCore
      ? `Opción ${cur.id}: ${safeTitleCore}`
      : `Opción ${cur.id}`;

    const cleanDesc = sanitizeBrandSafeEditorialText(
      stripFieldMd(descMatch?.[1] || '').replace(/\s+/g, ' ')
    );

    const rawOverlayStr = stripFieldMd(overlayMatch?.[1] || '');
    let suggestedOverlay = rawOverlayStr
      .split(/\s*(?:\/|\||\\n)\s*/)
      .map((s) =>
        sanitizeBrandSafeEditorialText(
          s
            .replace(/^l[ií]nea\s*\d+\s*:\s*/i, '')
            .replace(/^["'«»“”]+|["'«»“”]+$/g, '')
            .trim()
        ).toUpperCase()
      )
      .filter((s) => Boolean(s) && !/^\[?\s*texto\s+en\s+pantalla\s*\]?$/i.test(s))
      .join('\n');

    let rawPromptCandidate = (promptMatch?.[1] || '').trim();
    if (!rawPromptCandidate) {
      const fallbackImgInBody = body.match(/(?:Thumbnail:\s*)?Create an image\b[\s\S]+/i);
      if (fallbackImgInBody) {
        rawPromptCandidate = fallbackImgInBody[0];
      }
    }
    const trimmedPromptCandidate = rawPromptCandidate
      .split(/\n[ \t]*(?:#{1,5}[ \t]|\*\*(?:Nota|Explicaci|Resumen|Conclusi)|---+\s*$)/i)[0]
      .replace(/^```[a-z]*\s*/i, '')
      .replace(/```\s*$/i, '')
      .replace(/^["'`*]+|["'`*]+$/g, '')
      .replace(/\s+/g, ' ')
      // Strip any trailing Spanish conversational remarks appended after the English closing clause (e.g. "Aquí tienes la mejor opción visual...")
      .replace(/(no\s+(?:unintended\s+)?floating\s+text,\s*no\s+music\.)[\s\S]*$/i, '$1')
      .replace(
        /(?:\.\s+|\s+)(?:Aqu[ií]\s+tienes|Espero\s+que|¿Deseas|¿Quieres|Nota\s*:|Explicaci[oó]n\s*:|Resumen\s*:|Selecci[oó]n\s+recomendada|La\s+mejor\s+opci[oó]n)[\s\S]*$/i,
        '.'
      )
      .trim();

    if (!suggestedOverlay) {
      suggestedOverlay = extractOverlayFromStage5PromptText(trimmedPromptCandidate);
    }

    const rawPrompt = applyAutomaticFlowPolicyShield(trimmedPromptCandidate, false);

    if (rawPrompt && !blocks.some((b) => b.id === cur.id)) {
      blocks.push({
        id: cur.id,
        title: cleanTitle,
        description: cleanDesc,
        rawPrompt,
        suggestedOverlay,
      });
    }
  }

  blocks.sort((a, b) => a.id.localeCompare(b.id));

  let directEnglishCandidate = '';
  if (blocks.length === 0) {
    const directMatch = cleaned.match(/(?:Thumbnail:\s*)?Create an image\b[\s\S]+/i);
    if (directMatch) {
      directEnglishCandidate = applyAutomaticFlowPolicyShield(
        directMatch[0]
          .split(/\n[ \t]*(?:\[?DISPARADOR|#{1,5}|---)/i)[0]
          .replace(/(no\s+(?:unintended\s+)?floating\s+text,\s*no\s+music\.)[\s\S]*$/i, '$1')
          .replace(/\s+/g, ' ')
          .trim(),
        false
      );
    }
  }

  return { blocks, directEnglishCandidate };
}

/**
 * Resilient parser for Stage 101 (3 Short Thumbnail On-Screen Text Options of 1–4 words).
 * Handles both multi-line lists and pipe-separated single lines (`OPCIÓN 1 | OPCIÓN 2 | OPCIÓN 3`),
 * strips conversational preambles, markdown bolding, quotes, and trailing explanations.
 */
export function parseStage101ShortHooksShared(rawText: string): string[] {
  if (!rawText) return [];
  const strippedFences = String(rawText)
    .replace(/```[\w]*\n?/gi, '')
    .replace(/```/g, '')
    .replace(/\r\n/g, '\n');

  const rawItems = strippedFences
    .split(/\n+|\s+\|\s+/)
    .map((s) => s.trim())
    .filter(Boolean);

  const hooks: string[] = [];
  for (const rawLine of rawItems) {
    if (
      rawLine.endsWith(':') ||
      /^(?:aqu[ií]\s+tienes|basado\s+en|opciones\s+de|propuestas|claro|por\s+supuesto|a\s+continuaci[oó]n)/i.test(
        rawLine
      )
    ) {
      continue;
    }
    let clean = rawLine
      .replace(
        /^\s*(?:\[?\s*(?:opci[oó]n|hook|texto|propuesta)[_\s\-]*\d+\s*\]?\s*[:.)\-—–]*|\d+\s*[:.)\-—–]+|[-•*]\s+)/i,
        ''
      )
      .split(/\s+(?:—|–|\(|:\s)/)[0]
      .replace(/[*_"`«»“”'']/g, '')
      .replace(/\s+/g, ' ')
      .trim()
      .toUpperCase();

    clean = sanitizeBrandSafeEditorialText(clean).toUpperCase().trim();
    if (!clean) continue;
    const words = clean.split(/\s+/).filter(Boolean);
    if (words.length >= 1 && words.length <= 6 && clean.length <= 42) {
      const normalizedHook = words.slice(0, 5).join(' ');
      if (!hooks.includes(normalizedHook)) {
        hooks.push(normalizedHook);
      }
    }
    if (hooks.length >= 3) break;
  }
  return hooks.slice(0, 3);
}

/**
 * Extracts multi-line (`(Line 1: "..." / Line 2: "...")`) or single-line (`reads "..."` / `reading "..."`)
 * overlay text embedded inside an English Stage 5 thumbnail prompt when a separate `TEXTO EN PANTALLA:` line is omitted.
 */
export function extractOverlayFromStage5PromptText(promptText: string): string {
  const src = String(promptText || '');
  if (!src) return '';
  const multiMatch = src.match(
    /\(\s*Line\s*1\s*:\s*["“”']([^"“”']+)["“”'](?:\s*\/\s*Line\s*2\s*:\s*["“”']([^"“”']+)["“”'])?(?:\s*\/\s*Line\s*3\s*:\s*["“”']([^"“”']+)["“”'])?(?:\s*\/\s*Line\s*4\s*:\s*["“”']([^"“”']+)["“”'])?\s*\)/i
  );
  if (multiMatch) {
    const lines = [multiMatch[1], multiMatch[2], multiMatch[3], multiMatch[4]]
      .map((s) => sanitizeBrandSafeEditorialText(String(s || '').trim()).toUpperCase())
      .filter((s) => Boolean(s) && !/^\[?\s*TEXTO\s+EN\s+PANTALLA\s*\]?$/i.test(s));
    if (lines.length > 0) return lines.join('\n');
  }
  const singleMatch = src.match(
    /text\s+overlay[^.;]*?\bread(?:s|ing)\s*["“”']([^"“”'\[\]]{2,60})["“”']/i
  );
  if (singleMatch?.[1]) {
    const cleaned = sanitizeBrandSafeEditorialText(singleMatch[1].trim()).toUpperCase();
    if (cleaned && !/^TEXTO\s+EN\s+PANTALLA$/i.test(cleaned)) {
      return cleaned;
    }
  }
  return '';
}

/**
 * Cleanly normalizes a Stage 5 English thumbnail prompt without EVER splitting sentences mid-phrase
 * (`is portrayed by...`, `In the top-left corner, the...`) and guarantees ONLY the selected `overlayText`
 * appears in the prompt (eliminating any previous/first-option overlay clauses and trailing Spanish remarks).
 */
export function cleanAndNormalizeStage5ThumbnailPrompt(
  rawInputPrompt: string,
  orientation: 'HORIZONTAL_16X9' | 'VERTICAL_9X16',
  overlayText: string
): string {
  let pr = String(rawInputPrompt || '')
    .replace(/\r\n/g, '\n')
    .replace(/\s+/g, ' ')
    .trim();
  if (!pr) return '';

  const isVert = orientation === 'VERTICAL_9X16';
  const aspectPhrase = isVert ? '9:16 vertical aspect ratio' : '16:9 horizontal aspect ratio';
  const overlayLines = String(overlayText || '')
    .replace(/\r\n/g, '\n')
    .split('\n')
    .map((l) => l.replace(/["“”']/g, '').replace(/\s+/g, ' ').trim())
    .filter((l) => Boolean(l) && !/^\[?\s*texto\s+en\s+pantalla\s*\]?$/i.test(l));

  // 1. Strip any trailing Spanish conversational chatter after the English prompt closes
  pr = pr
    .replace(/(no\s+(?:unintended\s+)?floating\s+text,\s*no\s+music\.)[\s\S]*$/i, '$1')
    .replace(
      /(?:\.\s+|\s+)(?:Aqu[ií]\s+tienes|Espero\s+que|¿Deseas|¿Quieres|Nota\s*:|Explicaci[oó]n\s*:|Resumen\s*:|Selecci[oó]n\s+recomendada|La\s+mejor\s+opci[oó]n)[\s\S]*$/i,
      '.'
    )
    .trim();

  // 2. Repair any previously damaged mid-sentence logo splice (`...in his 50s is, official page logo ... sub-text, portrayed by...`)
  pr = pr.replace(
    /\b(is|are|was|were|stands|sits|appears)\s*,\s*official\s+page\s+logo\s+cleanly\s+integrated[\s\S]*?omitting\s+the\s+sub-text\s*,\s*(portrayed\s+by\b)/gi,
    '$1 $2'
  );
  pr = pr.replace(/\bIn\s+the\s+top[- ]left\s+corner,\s*the\s*,\s*/gi, '');

  // 3. Remove ALL existing text-overlay / typography sentences/clauses (including natural phrasings like `saying "..."` or `typography: "..."`)
  // The vertical (centered) sentence goes first and whole: the generic rule below would leave its "Centered and
  // middle-justified ..." opening behind, and it piled up every time the prompt was normalized again
  pr = pr.replace(
    /Centered\s+and\s+middle[- ]justified\s+right\s+in\s+the\s+middle\s+center\s+of\s+the\s+image\s*,\s*(?:a\s+)?bold[\s\S]*?(?:\(\s*Line\s*1\s*:[\s\S]*?\)|read(?:s|ing)\s*["“”'][^"“”']*["“”'])\s*[.,]?/gi,
    ' '
  );
  pr = pr.replace(
    /(?:(?:Near|In|At)\s+the\s+(?:bottom[- ]left|lower[- ]left|middle|center|top[- ]left|bottom)(?:\s+(?:area|part|corner))?(?:\s+of\s+the\s+(?:image|frame))?\s*,\s*)?(?:a\s+)?(?:bold\s*,?\s*|large\s*,?\s*|massive\s*,?\s*|high[- ]contrast\s*,?\s*|cinematic\s*,?\s*|documentary\s*,?\s*|dramatic\s*,?\s*)*(?:typography\s+|text\s+overlay|title\s+text|lettering|words?\s+on\s+screen)\b[^.]*?(?:\(\s*Line\s*1\s*:[\s\S]*?\)|(?:read(?:s|ing)|say(?:s|ing)|display(?:s|ing)|:)\s*["“”'][^"“”']*["“”'])\s*[.,]?/gi,
    ' '
  );
  pr = pr.replace(
    /\bstrictly\s+no\s+text\s+overlay\s+words\s+anywhere\s+on\s+the\s+image\s*[.,]?/gi,
    ' '
  );

  // 4. Remove ALL existing top-right 8K/HD logo sentences/clauses
  pr = pr.replace(
    /(?:In\s+the\s+top[- ]right\s+corner\s*,\s*)?a\s+small\s*,?\s*discreet\s+5%\s+scale\s+logo(?:\s+in\s+the\s+top[- ]right\s+corner)?\s+display(?:s|ing)\s*["“”']?(?:8K|HD)["“”']?\s*in\s+metallic\s+gold\s*[.,]?/gi,
    ' '
  );

  // 5. Remove ALL existing top-left official page logo sentences/clauses (`image_0.png` or `provided reference image`)
  pr = pr.replace(
    /(?:In\s+the\s+top[- ]left\s+corner\s*,\s*(?:the\s+)?)?official\s+page\s+logo(?:\s+cleanly\s+integrated|\s+from\s+[^,]+?\s+(?:is\s+)?cleanly\s+integrated)[\s\S]*?omitting\s+the\s+sub-text\s*[.,]?/gi,
    ' '
  );

  // 6. Strip trailing quality closing sentence/clause so we can append the canonical blocks cleanly in exact sentence order
  pr = pr.replace(
    /(?:The\s+scene\s+has\s+|,\s*)?cinematic\s+documentary\s+realism\s*,\s*8k\s+resolution[\s\S]*?no\s+music\.?\s*$/i,
    ''
  );
  pr = pr.replace(/(?:[.,]\s*)?Shot\s+as\s+a\s+real\s+photograph,\s+not\s+a\s+render[\s\S]*?no\s+music\.?\s*$/i, '');
  // The empty-corner sentences are added again below exactly once (a prompt is normalized again every time it is
  // used, and they used to pile up)
  pr = pr.replace(
    /\s*The\s+top[- ](?:right|left)\s+corner\s+is\s+left\s+completely\s+clean\s+and\s+empty[^.]*\.?/gi,
    ' '
  );
  // The model sentence is added again below exactly once
  pr = pr.replace(/\s*(?:Generate|Create|Use)\s+(?:this\s+image\s+)?(?:with\s+)?(?:the\s+)?Nano\s+Banana\s+[\d.]+(?:\s+image\s+model)?\s*\.?/gi, ' ');

  // Clean orphaned connectors or double punctuation left after stripping
  pr = pr
    .replace(/\b(?:In\s+the\s+top[- ](?:left|right)\s+corner|Near\s+the\s+bottom[- ]left)\s*,\s*(?:the\s*)?(?=[.,]|$)/gi, '')
    .replace(/\s+([.,])/g, '$1')
    .replace(/([.,])\s*[.,]+/g, '$1')
    .replace(/,\s*$/g, '.')
    .replace(/\s+/g, ' ')
    .trim();

  if (!/^Thumbnail:\s*Create an image/i.test(pr)) {
    pr = `Thumbnail: Create an image ${pr.replace(/^Create an image\s*/i, '')}`;
  }

  if (/(?:16:9|9:16)\s*(?:horizontal|vertical)?\s*(?:aspect ratio|format)?/i.test(pr)) {
    pr = pr.replace(
      /(?:16:9|9:16)\s*(?:horizontal|vertical)?\s*(?:aspect ratio|format)?/gi,
      aspectPhrase
    );
  } else {
    pr = pr.replace(
      /^Thumbnail:\s*Create an image\b/i,
      `Thumbnail: Create an image in ${aspectPhrase}`
    );
  }

  // Ensure anonymous historical reenactment shield is present if prompt mentions a person without it
  if (!/anonymous historical reenactment actor/i.test(pr)) {
    pr = `${pr.replace(/[.,\s]+$/, '')}, portrayed by an anonymous historical reenactment actor in authentic period attire (no real public figures or prominent people).`;
  } else if (!/[.!?]$/.test(pr)) {
    pr = `${pr}.`;
  }

  // 7. Append ONLY the exact selected text overlay, top-right 8K/HD badge, top-left Official Logo, and closing quality specs as complete sentences
  const posSentenceStart = isVert
    ? 'Centered and middle-justified right in the middle center of the image, a bold high-contrast cinematic documentary typography text overlay'
    : 'In the bottom-left area of the image, a bold high-contrast cinematic documentary typography text overlay';

  const overlaySentence =
    overlayLines.length === 0
      ? 'Strictly no text overlay words anywhere on the image.'
      : overlayLines.length === 1
      ? `${posSentenceStart} reads "${overlayLines[0]}".`
      : `${posSentenceStart} stacked across ${overlayLines.length} exact separate lines reads (${overlayLines
          .map((ln, idx) => `Line ${idx + 1}: "${ln}"`)
          .join(' / ')}).`;

  // The HD/8K badge and the official logo are stamped afterwards by the app, so the AI keeps both corners empty
  const rightLogoSentence =
    'The top-right corner is left completely clean and empty, with no text, no badge and no logo in that corner.';

  const leftLogoSentence =
    'The top-left corner is left completely clean and empty, with no text, no emblem and no logo in that corner.';

  // Photographic language (user request 2026-11-25: images looked like CGI / a video game). "Cinematic" and "8k"
  // alone pull image models toward a polished render; a real camera, natural light and an explicit list of what it
  // must NOT look like keep it a documentary photograph.
  const closingSentence =
    THUMBNAIL_PHOTO_REALISM_CLOSING;

  return [pr, THUMBNAIL_IMAGE_MODEL_SENTENCE, overlaySentence, rightLogoSentence, leftLogoSentence, closingSentence]
    .filter(Boolean)
    .join(' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Auto-calcula la duración real del documental desde el Clip 1 (después del intro)
 * hasta el último clip antes del outro oficial, combinando timestamps de clips y voz narrativa.
 */
export function computeDocumentaryContentDuration(
  clips?: DocumentaryClip[],
  audioTracks?: any[],
  fallback: string = '02:00'
): string {
  const parseSec = (timeStr: string): number | null => {
    const m = String(timeStr || '').match(/(\d{1,3}):(\d{2})/);
    return m ? parseInt(m[1], 10) * 60 + parseInt(m[2], 10) : null;
  };

  if (!Array.isArray(clips) || clips.length === 0) {
    if (Array.isArray(audioTracks) && audioTracks[0]?.duration) {
      const voiceSec = Math.round(Number(audioTracks[0].duration));
      if (voiceSec > 0) {
        const mins = Math.floor(voiceSec / 60);
        const secs = voiceSec % 60;
        return `${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
      }
    }
    return fallback || '02:00';
  }

  // Filtrar exclusivamente los clips de contenido del documental:
  // - Excluir Intro oficial (clipNumber <= 0 o clips marcados como intro)
  // - Excluir Outro oficial (clipNumber >= 999 o clips marcados como outro)
  const bodyClips = clips.filter((c) => {
    const num = Number(c.clipNumber);
    if (!Number.isFinite(num)) return false;
    if (num <= 0 || num >= 999) return false;
    const range = String(c.timeRange || '').toLowerCase();
    const prompt = String(c.imagePrompt || '').toLowerCase();
    if (
      range.includes('intro') ||
      prompt.includes('intro oficial') ||
      prompt.includes('logo oficial')
    ) {
      return false;
    }
    if (range.includes('outro') || prompt.includes('outro oficial')) {
      return false;
    }
    return true;
  });

  if (bodyClips.length === 0) {
    if (Array.isArray(audioTracks) && audioTracks[0]?.duration) {
      const voiceSec = Math.round(Number(audioTracks[0].duration));
      if (voiceSec > 0) {
        const mins = Math.floor(voiceSec / 60);
        const secs = voiceSec % 60;
        return `${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
      }
    }
    return fallback || '02:00';
  }

  const firstClip = bodyClips[0];
  const lastClip = bodyClips[bodyClips.length - 1];

  const firstParts = String(firstClip.timeRange || '').split('-');
  const firstStartSec = firstParts[0] ? parseSec(firstParts[0]) : null;

  const lastParts = String(lastClip.timeRange || '').split('-');
  const lastEndSec =
    lastParts.length > 1 && lastParts[1]
      ? parseSec(lastParts[1])
      : lastParts[0]
      ? parseSec(lastParts[0])
      : null;

  if (lastEndSec !== null && lastEndSec > 0) {
    const startOffset = firstStartSec !== null && firstStartSec >= 0 ? firstStartSec : 0;
    const durationSec = Math.max(0, lastEndSec - startOffset);
    if (durationSec > 0) {
      const mins = Math.floor(durationSec / 60);
      const secs = durationSec % 60;
      return `${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
    }
  }

  // Si los clips no tienen timestamps precisos en timeRange, acumular duraciones de clips
  let accumulatedSec = 0;
  for (const c of bodyClips) {
    const parts = String(c.timeRange || '').split('-');
    if (parts.length === 2) {
      const s = parseSec(parts[0]);
      const e = parseSec(parts[1]);
      if (s !== null && e !== null && e > s) {
        accumulatedSec += e - s;
        continue;
      }
    }
    accumulatedSec += c.clipNumber === 1 ? 6 : 8;
  }

  if (accumulatedSec > 0) {
    const mins = Math.floor(accumulatedSec / 60);
    const secs = accumulatedSec % 60;
    return `${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
  }

  if (Array.isArray(audioTracks) && audioTracks[0]?.duration) {
    const voiceSec = Math.round(Number(audioTracks[0].duration));
    if (voiceSec > 0) {
      const mins = Math.floor(voiceSec / 60);
      const secs = voiceSec % 60;
      return `${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
    }
  }

  return fallback || '02:00';
}

