import {
  DocumentaryClip,
  ReferenceAsset,
  SunoTrack,
  Sentence,
  DEFAULT_OPERATIONAL_HEADER,
  sanitizeOperationalHeader,
} from '../types';
import { formatMMSS } from './formatTime';

export function ensureOperationalHeaderInRawClips(
  rawText: string,
  operationalHeader: string = DEFAULT_OPERATIONAL_HEADER
): string {
  const header = sanitizeOperationalHeader(operationalHeader);
  const trimmed = (rawText || '').trim();
  if (!trimmed) return header;

  // Strip any leading operational/corrupted header(s) before the first Image N / Clip N block
  const firstPromptIdx = trimmed.search(/(?:^|\n)\s*(?:Image|Imagen|Clip)\s*\[?0*1\]?\s*[:(\-]/i);
  if (firstPromptIdx >= 0) {
    const bodyOnly = trimmed.slice(firstPromptIdx).trim();
    return bodyOnly ? `${header}\n\n${bodyOnly}` : header;
  }

  if (
    /^Act[uú]a como un historiador/i.test(trimmed) &&
    trimmed.includes('primeras 6 palabras') &&
    trimmed.includes('01 to 09')
  ) {
    return trimmed;
  }
  // If rawText only contained a corrupted/incomplete header without clips yet, return the clean 9-line header
  if (/del\s+1\s+al\s+10|Cuando\s+se\s+hayan\s+generado\s+todas\s+las\s+im[áa]genes/i.test(trimmed)) {
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

  // 4. Neutralizar términos de edad/menores y términos gráficos/violencia/sangre/"muerte"/"asesino" y derivados en inglés y español
  p = p.replace(
    /\b(\d{1,2}-year-old|child bride|young girl|teenage girl|little girl|little boy|adolescent|minor|underage|niña|adolescente|menor)\b/gi,
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
export const BRAND_SAFETY_LEXICAL_RULE_ES = `
🛡️ REGLA EDITORIAL INQUEBRANTABLE DE MONETIZACIÓN (CERO "MUERTE", "ASESINO" Y DERIVADOS):
- Queda TERMINANTEMENTE PROHIBIDO escribir en cualquier parte del entregable (guion de voz narrativa, títulos, textos de miniatura, ganchos del Clip 1, descripciones, capítulos, hashtags, tags SEO, comentarios fijados o prompts visuales en español/inglés) las palabras **"muerte"** y **"asesino"** ni NINGUNO de sus derivados o sinónimos letales directos:
  • Prohibidos familia "muerte": *muerte, muertes, muerto, muerta, muertos, muertas, morir, morirse, murió, murieron, muriendo, muere, mueren, moría, morían, morirá, muriera, mortal, mortales, mortalidad, mortandad, mortífero, mortífera, moribundo, cadáver, cadáveres* (y en inglés: *death, dead, deadly, die, died, dying, corpse, cadaver*).
  • Prohibidos familia "asesino" y violencia letal: *asesino, asesina, asesinos, asesinas, asesinato, asesinatos, asesinar, asesinó, asesinaron, asesinado, asesinada, homicidio, homicida, matar, mató, mataron, matanza, masacre, suicidio, suicida, suicidarse* (y en inglés: *murder, murderer, murdered, killer, killing, kill, killed, assassin, assassination, homicide, suicide*).
- SUSTITUCIÓN DOCUMENTAL ELEGANTE OBLIGATORIA: Usa siempre lenguaje histórico, periodístico y cinematográfico de alta retención que mantenga toda la tensión dramática sin activar filtros algorítmicos:
  • En lugar de *morir / murió / muerto / muerte / mortal*: usa *"perder la vida"*, *"perdió la vida"*, *"fallecer / falleció"*, *"perecer / pereció"*, *"sucumbir"*, *"apagarse"*, *"caer sin vida"*, *"el desenlace fatal"*, *"el último aliento"*, *"bajas humanas"*, *"letal"*, *"fulminante"*, *"pena capital"*.
  • En lugar de *asesino / asesinar / asesinato / matar*: usa *"el perpetrador"*, *"el autor del crimen"*, *"el conspirador"*, *"el ejecutor en la sombra"*, *"el atacante"*, *"quitar la vida"*, *"arrebatar la vida"*, *"abatir / fue abatido"*, *"silenciar"*, *"el crimen"*, *"el atentado"*, *"la conjura"*.`;

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
  operationalHeader: string = DEFAULT_OPERATIONAL_HEADER,
  projectEngineMode: FlowProjectEngineMode = 'HYBRID_PEOPLE_OMNI_REST_LOWER'
): string {
  const header = sanitizeOperationalHeader(operationalHeader, projectEngineMode);
  const body = (clips || [])
    .map((c) => {
      const img = c.imagePrompt?.trim();
      const rawVid = c.videoPrompt?.trim();
      const vid = rawVid
        ? applyClipFlowVideoEngineTag(rawVid, resolveClipFlowVideoEngine(c, projectEngineMode))
        : '';
      return [img, vid].filter(Boolean).join('\n\n');
    })
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
  const introPlacement = doc?.promptConfig?.UBICACION_INTRO_MARCA || 'INTRO_INICIO_00';
  const effectiveVoiceEntrySec =
    introPlacement === 'INTRO_INICIO_00' ? voiceEntrySec + 8 : voiceEntrySec;
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
export function autoFitVoiceoverScriptToDuration(
  rawText: string,
  docOrTargetSec?: any
): string {
  const cleaned = cleanVoiceoverNarrationOnly(rawText);
  if (!cleaned) return '';

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
  const isObj = typeof arg1 === 'object' && arg1 !== null;
  const rawVoiceoverWithPauses = isObj ? arg1.rawVoiceoverWithPauses || '' : arg1 || '';
  const timelineText = isObj ? arg1.timelineText || '' : arg2 || '';
  const rawClipsText = isObj ? arg1.rawClipsText || '' : arg3 || '';
  const existingClips = isObj ? arg1.existingClips || [] : arg4 || [];
  const clip1Duration = isObj ? arg1.clip1Duration || 6 : 6;
  const standardClipDuration = isObj && Number(arg1.clipDuration) > 0 ? Number(arg1.clipDuration) : 8;
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
  // Never inflate maxClipNum with stale skeleton existingClips beyond the real Timeline / parsed prompts
  const maxClipNum =
    timelineExpectedClipNum > 0 || parsedMaxClipNum > 0
      ? Math.max(timelineExpectedClipNum, parsedMaxClipNum)
      : existingClips.length;

  if (maxClipNum === 0) return [];

  const byNum = new Map<number, DocumentaryClip>();
  for (const prev of existingClips) {
    if (prev.clipNumber >= 1 && prev.clipNumber <= maxClipNum) {
      // Only carry over non-skeleton prompts or media state from existingClips when missing from parsedFromPrompts
      const isGenericAutoSkeleton =
        /Create an image of a .* shot in \(Ruta Principal|depicting the historical scene \(/i.test(
          prev.imagePrompt || ''
        );
      byNum.set(
        prev.clipNumber,
        isGenericAutoSkeleton
          ? {
              ...prev,
              timeRange: '',
              imagePrompt: '',
              videoPrompt: '',
              narrationSegment: '',
            }
          : { ...prev }
      );
    }
  }
  parsedFromPrompts.forEach((c) => {
    if (c.clipNumber >= 1 && c.clipNumber <= maxClipNum) {
      byNum.set(c.clipNumber, { ...c });
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
    const isSilentPauseSlot = /^\[SIN\s+VOZ\s+NARRATIVA/i.test(narrationText.trim());
    const cleanNarration = isSilentPauseSlot
      ? ''
      : stripPauseTags(narrationText).replace(/\s+/g, ' ').trim();
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
      const prevClip = finalClips[finalClips.length - 1];
      if (prevClip && prevClip.clipNumber === num - 1 && prevClip.imagePrompt && imgP) {
        const deskOfficeRegex = /\b(office|desk|counter|moneylender|clerk|notary|wooden table|ledger)\b/i;
        const outdoorContrastRegex = /\b(outdoor|sunlit|harbor|pier|dock|street|plaza|courtyard|exterior|mountain|ocean|sea)\b/i;
        if (
          deskOfficeRegex.test(prevClip.imagePrompt) &&
          deskOfficeRegex.test(imgP) &&
          !outdoorContrastRegex.test(imgP) &&
          !outdoorContrastRegex.test(prevClip.imagePrompt)
        ) {
          issues.push(
            `⚠️ Posible duplicación visual con el Clip ${num - 1} (ambos describen escritorio/mostrador en oficina interior). Según el Prompt Maestro, cuando la voz narrativa continúa en la misma escena o hilo, el siguiente clip debe mostrar un entorno o plano diferente pero visualmente referente (ej. exterior luminoso).`
          );
        }
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
      /^(?:Cambia\s+(?:los\s+nombres|obligatoriamente\s+el\s+nombre)|Actúa\s+como\s+un\s+historiador|Usa\s+Nano\s+Banana|Cada\s+imagen\s+DEBE|Nombra\s+(?:obligatoriamente\s+)?cada\s+imagen|Nombres\s+exactos\s+de\s+las\s+imágenes)/i.test(
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

  // Separar si hay múltiples pistas o bloques "Canción X", "Pista X" o "1. Título..."
  const blocks = normalized
    .split(
      /(?=(?:^|\n)\s*(?:[#*\-\s]*)(?:Pista\s+\d+|Canci[oó]n\s+\d+|Track\s+\d+|1\.\s*T[ií]tulo(?:\s+de\s+la\s+(?:canci[oó]n|pista))?\s*:))/i
    )
    .filter((b) => b.trim());

  blocks.forEach((block) => {
    const titleMatch = block.match(
      /(?:1\.\s*)?T[ií]tulo(?:\s+de\s+la\s+(?:canci[oó]n|pista))?\s*:\s*([^\n]+)/i
    );
    const durationMatch = block.match(/(?:2\.\s*)?Duraci[oó]n\s*:\s*([^\n]+)/i);
    const rangeMatch = block.match(
      /(?:3\.\s*)?(?:De d[oó]nde a d[oó]nde cubre|Rango de tiempo|Tramo)[^:]*:\s*([^\n]+)/i
    );
    const lyricsMatch = block.match(
      /(?:4\.\s*)?Prompt de Lyrics\s*:\s*([\s\S]*?)(?=(?:\n\s*(?:5\.|Prompt de Style))|$)/i
    );
    const styleMatch = block.match(
      /(?:5\.\s*)?Prompt de Style\s*:\s*([\s\S]*?)(?=(?:\n\s*(?:6\.|Explicaci[oó]n(?:\s+de\s+la\s+Canci[oó]n)?))|$)/i
    );
    const expMatch = block.match(
      /(?:6\.\s*)?Explicaci[oó]n(?:\s+de\s+la\s+Canci[oó]n)?\s*:\s*([\s\S]*?)$/i
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

export function reformatCaptionItems<
  T extends { id?: string; index?: number; start: number; end: number; text: string }
>(
  rawItems: T[],
  options?: {
    maxCharsPerLine?: number;
    maxWordsPerLine?: number;
    mode?: 'subdivide' | 'wrap' | 'original';
  }
): T[] {
  if (!Array.isArray(rawItems) || rawItems.length === 0) return [];
  const lineMode = options?.mode ?? 'subdivide';
  const maxCharsPerLine = typeof options?.maxCharsPerLine === 'number' ? options.maxCharsPerLine : 32;
  const maxWordsPerLine = typeof options?.maxWordsPerLine === 'number' ? options.maxWordsPerLine : 0;

  const effChars = lineMode === 'original' ? 46 : maxCharsPerLine;
  const effWords = lineMode === 'original' && maxWordsPerLine <= 0 ? 8 : maxWordsPerLine;

  const wordWeight = (w: string): number => {
    const expanded = w
      .replace(/\b1880\b/g, 'milochocientosochenta')
      .replace(/\b1930\b/g, 'milnovecientostreinta')
      .replace(/\b1940\b/g, 'milnovecientoscuarenta')
      .replace(/\b1[89]\d\d\b/g, 'milochocientoscincuenta')
      .replace(/\b\d{4}\b/g, 'milochocientos')
      .replace(/\b\d{3}\b/g, 'quinientos')
      .replace(/\b\d{2}\b/g, 'cuarenta')
      .replace(/\b\d\b/g, 'cinco');
    const chars = expanded.replace(/[^a-zA-ZáéíóúÁÉÍÓÚñÑüÜ]/g, '').length;
    const punctBonus = /[.?!:;…]$/.test(w) ? 4 : /[,]$/.test(w) ? 2 : 0;
    return Math.max(1, chars + punctBonus);
  };

  interface TimedWord {
    word: string;
    start: number;
    end: number;
  }

  // Group contiguous caption blocks (gap <= 0.08s and not ending a sentence) into speech islands,
  // while anchoring every word's exact [start, end] inside the original block it came from.
  const islands: TimedWord[][] = [];
  let currentIsland: TimedWord[] = [];
  let prevBlockEnd = -1;
  let prevEndedSentence = false;

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
    const bSpan = bEnd - bStart;

    const weights = words.map((w) => wordWeight(w));
    const totalW = Math.max(1, weights.reduce((a, b) => a + b, 0));
    let accW = 0;
    const blockTimedWords: TimedWord[] = words.map((w, wIdx) => {
      const wS = bStart + (accW / totalW) * bSpan;
      accW += weights[wIdx];
      const wE = wIdx === words.length - 1 ? bEnd : bStart + (accW / totalW) * bSpan;
      return { word: w, start: wS, end: wE };
    });

    const gapFromPrev = prevBlockEnd >= 0 ? bStart - prevBlockEnd : 999;
    const islandStart = currentIsland.length > 0 ? currentIsland[0].start : bStart;
    const canMergeIntoIsland =
      currentIsland.length > 0 &&
      gapFromPrev <= 0.08 &&
      !prevEndedSentence &&
      bEnd - islandStart <= 14.0;

    if (canMergeIntoIsland) {
      currentIsland.push(...blockTimedWords);
    } else {
      if (currentIsland.length > 0) {
        islands.push(currentIsland);
      }
      currentIsland = [...blockTimedWords];
    }

    prevBlockEnd = bEnd;
    prevEndedSentence = /[.?!:;…]["'»”)]*$/.test(cleanText);
  }
  if (currentIsland.length > 0) {
    islands.push(currentIsland);
  }

  const rebuilt: T[] = [];
  const templateItem = rawItems[0];

  for (const isl of islands) {
    const islWords = isl.map((tw) => tw.word);
    const chunks = splitWordsIntoShortLines(islWords, effChars, effWords);
    let wordCursor = 0;
    const chunkItems: Array<{ text: string; start: number; end: number }> = [];

    for (const ch of chunks) {
      if (ch.length === 0) continue;
      const firstTw = isl[wordCursor] || isl[0];
      const lastTw = isl[Math.min(isl.length - 1, wordCursor + ch.length - 1)] || isl[isl.length - 1];
      wordCursor += ch.length;
      const cStart = firstTw.start;
      const cEnd = Math.max(cStart + 0.2, lastTw.end);
      chunkItems.push({
        text: ch.join(' '),
        start: cStart,
        end: cEnd,
      });
    }

    if (lineMode === 'wrap') {
      for (let k = 0; k < chunkItems.length; k += 2) {
        const line1 = chunkItems[k];
        const line2 = k + 1 < chunkItems.length ? chunkItems[k + 1] : null;
        const idx = rebuilt.length + 1;
        rebuilt.push({
          ...templateItem,
          id: `cap-fmt-${idx}`,
          index: idx,
          start: Number(line1.start.toFixed(2)),
          end: Number((line2 ? line2.end : line1.end).toFixed(2)),
          text: line2 ? `${line1.text}\n${line2.text}` : line1.text,
        });
      }
    } else {
      for (const ci of chunkItems) {
        const idx = rebuilt.length + 1;
        rebuilt.push({
          ...templateItem,
          id: `cap-fmt-${idx}`,
          index: idx,
          start: Number(ci.start.toFixed(2)),
          end: Number(ci.end.toFixed(2)),
          text: ci.text,
        });
      }
    }
  }

  for (let i = 0; i < rebuilt.length - 1; i++) {
    if (rebuilt[i].end > rebuilt[i + 1].start) {
      rebuilt[i].end = Number(
        Math.max(rebuilt[i].start + 0.15, rebuilt[i + 1].start - 0.01).toFixed(2)
      );
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
// 5. DETECTOR INTELIGENTE DE PERSONAS POR CLIP (MODO HÍBRIDO OMNI 1.1 FLASH vs LOWER PRIORITY)
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
  return rawPrompt
    .replace(/\[(?:Video\s+)?Model\s*:[^\]]+\]/gi, ' ')
    .replace(/Cinematic historical drama reenactment[^.]*\.?/gi, ' ')
    .replace(/portrayed by anonymous historical reenactment actors[^.]*\.?/gi, ' ')
    .replace(/no real public figures or prominent people/gi, ' ')
    .replace(/Fixed subject count[^.]*\.?/gi, ' ')
    .replace(/clear anatomical separation between subjects[^.]*\.?/gi, ' ')
    .replace(/strictly no morphing[^.]*\.?/gi, ' ')
    .replace(/objects and hands maintain solid physical persistence[^.]*\.?/gi, ' ')
    .replace(/natural human anatomy[^.]*\.?/gi, ' ')
    .replace(/historian's\s+wooden\s+desk/gi, 'wooden desk')
    .replace(/Ambient\s+Foley\s*:[\s\S]*$/i, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Automatically detects whether a clip depicts live human subjects (people, characters, @Ref,
 * crowds, officers, hands in action) vs. a B-roll without people (landscapes, ships at sea,
 * maps, documents, lithographs, objects, architecture).
 */
export function detectClipHasHumanSubjects(clip: {
  imagePrompt?: string;
  videoPrompt?: string;
  visualExplanation?: string;
}): boolean {
  const cleanImg = stripFlowPromptBoilerplateForSubjectCheck(clip.imagePrompt || '');
  const cleanVid = stripFlowPromptBoilerplateForSubjectCheck(clip.videoPrompt || '');
  const combined = `${cleanImg} ${cleanVid}`.trim();
  if (!combined) return false;

  // 1. If it mentions a @Person reference tag, it definitely has a person
  if (/@[A-Za-z0-9_ÁÉÍÓÚáéíóúÑñ]{2,}/.test(combined)) {
    return true;
  }

  // 2. If it's explicitly a flat print/lithograph/engraving/map/document on a desk without live hands/actors interacting
  const isPurePrintOrMap =
    /\b(satirical\s+lithograph|vintage\s+\d*\s*lithograph|woodcut\s+engraving|cartographic\s+map|overhead\s+view\s+of\s+an\s+antique|macro\s+close-up\s+on\s+an\s+antique\s+(?:historian's\s+)?wooden\s+desk)\b/i.test(
      combined
    ) &&
    !/\b(hands?\s+(?:holding|signing|counting|writing|turning|resting|pointing|stamping)|man|woman|clerk|notary|official|actor)\b/i.test(
      combined
    );
  if (isPurePrintOrMap) {
    return false;
  }

  // 3. Check for human subjects, roles, crowds, or visible human anatomy in action
  const humanSubjectRegex =
    /\b(man|men|woman|women|boy|girl|child|children|person|people|crowd|passengers|peasants|workers|laborers|miners|sailors|soldiers|officers|guards|gendarmes|policemen|officials|inspectors|clerks|notary|moneylender|usurer|merchants|governor|captain|doctor|physician|surgeon|nurse|priest|monk|bishop|king|queen|emperor|prince|princess|noble|nobleman|noblewoman|farmer|farmers|villagers|citizens|migrants|emigrants|immigrants|travelers|pedestrians|couple|family|families|mother|father|parents|son|daughter|brother|sister|widow|elder|elders|veteran|blacksmith|carpenter|baker|tailor|weaver|fisherman|fishermen|shepherd|beggar|prisoner|captive|pilgrim|pilgrims|colonists|settlers|silhouette\s+of\s+a\s+(?:man|woman|person|figure|boy|girl)|figures?\s+(?:walking|standing|working|boarding|carrying|waiting|huddled|gathered|sitting|kneeling|running|looking|watching)|weathered\s+hands|hands\s+(?:holding|signing|counting|turning|resting|trembling|clutching|writing|tying|stitching|open|opening|closing|pouring|forging|hammering))\b/i;

  if (humanSubjectRegex.test(combined)) {
    return true;
  }

  // 4. Fallback check in Spanish visualExplanation if prompts are still in Spanish/skeleton state
  const cleanExp = (clip.visualExplanation || '').trim();
  if (
    cleanExp &&
    !cleanImg &&
    /\b(hombre|hombres|mujer|mujeres|niño|niña|niños|persona|personas|gente|multitud|pasajeros|campesinos|obreros|trabajadores|marineros|soldados|oficiales|guardias|funcionarios|escribano|prestamista|comerciantes|gobernador|capitán|médico|sacerdote|monje|rey|reina|emperador|agricultor|emigrantes|inmigrantes|viajeros|pareja|familia|madre|padre|hijo|hija|anciano)\b/i.test(
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
 * 3) Otherwise, automatic human detection (`Omni 1.1 Flash` for people, `Veo 3.1 - Lite [Lower Priority]` for rest)
 */
export function resolveClipFlowVideoEngine(
  clip: {
    imagePrompt?: string;
    videoPrompt?: string;
    visualExplanation?: string;
    flowClipEngine?: FlowClipEngineType;
  },
  projectEngineMode: FlowProjectEngineMode = 'HYBRID_PEOPLE_OMNI_REST_LOWER'
): FlowClipEngineType {
  if (projectEngineMode === 'OMNI_1_1_FLASH') return 'OMNI_1_1_FLASH';
  if (projectEngineMode === 'VEO_3_1_LITE_LOWER_PRIORITY') return 'VEO_3_1_LITE_LOWER_PRIORITY';
  if (
    clip.flowClipEngine === 'OMNI_1_1_FLASH' ||
    clip.flowClipEngine === 'VEO_3_1_LITE_LOWER_PRIORITY'
  ) {
    return clip.flowClipEngine;
  }
  return detectClipHasHumanSubjects(clip) ? 'OMNI_1_1_FLASH' : 'VEO_3_1_LITE_LOWER_PRIORITY';
}

/**
 * Injects or updates the explicit `[Model: ...]` instruction at the end of a `Clip X` prompt
 * (right before `fix the name` if present) so the first 6 words of `Clip X (MM:SS - MM:SS): Create`
 * remain 100% intact for Google Flow's file-renaming rule.
 */
export function applyClipFlowVideoEngineTag(
  videoPrompt: string,
  engine: FlowClipEngineType
): string {
  if (!videoPrompt || !videoPrompt.trim()) return videoPrompt;
  const modelLabel =
    engine === 'OMNI_1_1_FLASH' ? 'Omni 1.1 Flash' : 'Veo 3.1 - Lite [Lower Priority]';
  const tagText = `[Model: ${modelLabel}]`;

  // Remove any existing [Model: ...] or [Video Model: ...] tag first
  const cleaned = videoPrompt
    .replace(/\s*\[(?:Video\s+)?Model\s*:[^\]]*\]\s*(?:\])?/gi, ' ')
    .replace(/\s{2,}/g, ' ')
    .trim();

  if (/fix the name\s*\.?\s*$/i.test(cleaned)) {
    return cleaned.replace(/\s*(fix the name\s*\.?\s*)$/i, ` ${tagText} $1`);
  }
  return `${cleaned} ${tagText}`;
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
      /\s+\|\s+(?=(?:[-•*# \t]|\d+[.)][ \t]*)*(?:\[?[ \t]*(?:DISPARADOR|OPCI[OÓ]N|TRIGGER)[_\s\-]*(?:[ABC]|[123])\b|T[IÍ]TULO\b|DESCRIPCI[OÓ]N\b|EXPLICACI[OÓ]N\b|TEXTO[_\s]*(?:EN[_\s]*)?PANTALLA\b|OVERLAY\b|PROMPT\b))/gi,
      '\n'
    )
    // Ensure DOM-concatenated paragraphs from Gemini (`...no music.[DISPARADOR_B] TITULO: ... DESCRIPCION: ...`) always split cleanly onto new lines
    .replace(/([^\n])(\[\s*(?:DISPARADOR|OPCI[OÓ]N|TRIGGER)[_\s\-]*[ABC123]\s*\])/gi, '$1\n$2')
    .replace(
      /([^\n])\s+((?:\*+\s*)?(?:T[IÍ]TULO|DESCRIPCI[OÓ]N|EXPLICACI[OÓ]N|TEXTO[_\s]*(?:EN[_\s]*)?PANTALLA|OVERLAY(?:[_\s]*TEXT)?|(?:IMAGE[ \t]+)?PROMPT(?:[ \t]+(?:T[EÉ]CNICO|EN[ \t]+INGL[EÉ]S|VISUAL))?)(?:\s*\*+)?\s*:)/gi,
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
    /(?:^|\n)[ \t]*(?:[-•*# \t]|\d+[.)][ \t]*)*\[?[ \t]*(?:DISPARADOR|OPCI[OÓ]N|TRIGGER)(?:[ \t]+NEUROPSICOL[OÓ]GICO)?[_\s\-]*([ABC123])\b[ \t]*\]?(?:[ \t]*\*+)?(?:[ \t]*[:\-—–][ \t]*([^\n]*))?/gi;

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
      /(?:^|\n)[ \t]*(?:[-•*][ \t]+)?(?:\*+[ \t]*)?T[IÍ]TULO(?:[ \t]+DEL[ \t]+DISPARADOR)?[ \t]*(?:\*+)?[ \t]*:[ \t]*(?:\*+)?[ \t]*([^\n]+)/i
    );
    const descMatch = body.match(
      /(?:^|\n)[ \t]*(?:[-•*][ \t]+)?(?:\*+[ \t]*)?(?:DESCRIPCI[OÓ]N|EXPLICACI[OÓ]N|JUSTIFICACI[OÓ]N)[ \t]*(?:\*+)?[ \t]*:[ \t]*(?:\*+)?[ \t]*([^\n]+(?:\n(?![ \t]*(?:[-•*][ \t]+)?(?:\*+[ \t]*)?(?:TEXTO[_\s]*(?:EN[_\s]*)?PANTALLA|OVERLAY|PROMPT|T[IÍ]TULO)\b)[^\n]+)*)/i
    );
    const overlayMatch = body.match(
      /(?:^|\n)[ \t]*(?:[-•*][ \t]+)?(?:\*+[ \t]*)?(?:TEXTO[_\s]*(?:EN[_\s]*)?PANTALLA|OVERLAY(?:[_\s]*TEXT)?)[ \t]*(?:\*+)?[ \t]*:[ \t]*(?:\*+)?[ \t]*([^\n]+)/i
    );
    const promptMatch = body.match(
      /(?:^|\n)[ \t]*(?:[-•*][ \t]+)?(?:\*+[ \t]*)?(?:IMAGE[ \t]+)?PROMPT(?:[ \t]+(?:T[EÉ]CNICO|EN[ \t]+INGL[EÉ]S|VISUAL))?[ \t]*(?:\*+)?[ \t]*:[ \t]*(?:\*+)?[ \t]*([\s\S]+)$/i
    );

    const rawTitleCandidate = stripFieldMd(titleMatch?.[1] || cur.inlineTitle || '')
      .replace(/^(?:opci[oó]n|disparador)\s*[abc123]\s*[:\-—–.]?\s*/i, '')
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
  pr = pr.replace(
    /(?:(?:Near|In|At)\s+the\s+(?:bottom[- ]left|lower[- ]left|middle|center|top[- ]left|bottom)(?:\s+(?:area|part|corner))?(?:\s+of\s+the\s+(?:image|frame))?\s*,\s*)?(?:a\s+)?(?:bold\s*,?\s*|large\s*,?\s*|massive\s*,?\s*|high[- ]contrast\s*,?\s*|cinematic\s*,?\s*|documentary\s*,?\s*|dramatic\s*,?\s*)*(?:typography\s+|text\s+overlay|title\s+text|lettering|words?\s+on\s+screen)\b[^.]*?(?:\(\s*Line\s*1\s*:[\s\S]*?\)|(?:read(?:s|ing)|say(?:s|ing)|display(?:s|ing)|:)\s*["“”'][^"“”']*["“”'])\s*[.,]?/gi,
    ' '
  );
  pr = pr.replace(
    /Centered\s+and\s+middle[- ]justified\s+right\s+in\s+the\s+middle\s+center\s+of\s+the\s+image\s*,\s*(?:a\s+)?bold[\s\S]*?(?:\(\s*Line\s*1\s*:[\s\S]*?\)|read(?:s|ing)\s*["“”'][^"“”']*["“”'])\s*[.,]?/gi,
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

  const rightLogoSentence = isVert
    ? 'In the top-right corner, a small discreet 5% scale logo displays "HD" in metallic gold.'
    : 'In the top-right corner, a small discreet 5% scale logo displays "8K" in metallic gold.';

  const leftLogoSentence =
    'In the top-left corner, the official page logo from the provided reference image is cleanly integrated at 5% scale, strictly preserving and visibly rendering both the logo emblem and the exact text underneath it "Huellas de la Humanidad" without cropping, blurring, or omitting the sub-text.';

  const closingSentence =
    'The scene has cinematic documentary realism, 8k resolution, sharp focus, safe framing composition, no modern objects, no CGI look, no unintended floating text, no music.';

  return [pr, overlaySentence, rightLogoSentence, leftLogoSentence, closingSentence]
    .filter(Boolean)
    .join(' ')
    .replace(/\s+/g, ' ')
    .trim();
}



