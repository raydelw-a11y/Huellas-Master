// Etapa 1 · Paso 1 — complete proposals.
// Gemini no longer answers with six separate lists of options (typology, topic, era, hook, outline, climax) that
// the producer had to combine by hand: it answers with a few COMPLETE proposals, each one a coherent documentary
// (topic + era and place + typology + climax) with its own hook and outline variants. The producer picks one
// proposal and, inside it, one hook and one outline; pieces of different proposals can never be mixed.
// When there is no topic yet and several videos are marked, Gemini first lists 10 one-line topics and the
// producer marks the ones to develop into complete proposals.

export interface Stage1Proposal {
  /** 1-based number as written by Gemini ("PROPUESTA 2") */
  number: number;
  title: string;
  typology: string;
  topic: string;
  /** "era | place" */
  timeAndPlace: string;
  climax: string;
  why: string;
  /** "Prueba de fuentes": the archives and chronicles that exist for this topic and how solid they are */
  sources: string;
  hooks: string[];
  /** Index (0-based) of the hook Gemini would choose */
  recommendedHook: number;
  hookReason: string;
  escaletas: string[];
  /** Index (0-based) of the outline Gemini would choose */
  recommendedEscaleta: number;
  escaletaReason: string;
}

export interface Stage1ProposalSet {
  proposals: Stage1Proposal[];
  /** Number (1-based, as written) of the proposal Gemini would choose; 0 when it named none */
  recommendedNumber: number;
  recommendedReason: string;
}

export interface Stage1TopicIdeas {
  ideas: string[];
  /** Indexes (0-based) of the ideas Gemini would develop first */
  recommended: number[];
  recommendedReason: string;
}

export type Stage1Paso1Mode = 'ANGLES' | 'DEVELOP' | 'IDEAS' | 'OPEN';

/** The 8 typologies of the protocol, written as the Etapa 1 selector lists them */
export const STAGE1_PROTOCOL_TYPOLOGIES = [
  '1. Un suceso histórico',
  '2. Un lugar histórico',
  '3. Un personaje',
  '4. Un misterio sin resolver',
  '5. Un true crime',
  '6. Una conciencia o realidad colectiva',
  '7. Una manipulación psicológica',
  '8. Una curiosidad',
];

export const STAGE1_PROPOSALS_KEY ='PROP_PROPOSALS_JSON';
export const STAGE1_PROPOSAL_SELECTED_KEY = 'PROP_PROPOSAL_SELECTED';
export const STAGE1_TOPIC_IDEAS_KEY = 'PROP_TOPIC_IDEAS_JSON';
export const STAGE1_TOPIC_IDEAS_PICKED_KEY = 'PROP_TOPIC_IDEAS_PICKED_JSON';
/** The subject the producer typed before a proposal's own topic replaced it in the Tema field */
export const STAGE1_SUBJECT_BASE_KEY = 'PROP_SUBJECT_BASE';

const stripMarks = (s: string): string =>
  String(s || '')
    .replace(/\*\*|__/g, '')
    .replace(/^\s*#+\s*/, '')
    .replace(/^\*+\s*|\s*\*+$/g, '')
    .replace(/^\[\s*|\s*\]$/g, '')
    .replace(/\s+/g, ' ')
    .trim();

/**
 * Like stripMarks, but citations stay: "… el tribunal [6]." keeps its "[6]". Only a field written whole as a
 * placeholder ("[texto]") loses its brackets.
 */
const cleanField = (s: string): string => {
  const v = String(s || '')
    .replace(/\*\*|__/g, '')
    .replace(/^\s*#+\s*/, '')
    .replace(/^\*+\s*|\s*\*+$/g, '')
    .replace(/\s+/g, ' ')
    .trim();
  return /^\[[^\[\]]*\]$/.test(v) && !/^\[\d+\]$/.test(v) ? v.slice(1, -1).trim() : v;
};

/** The answer without markdown emphasis, so labels can be matched at the start of a line. */
const normalizeAnswer = (raw: string): string =>
  String(raw || '')
    .replace(/\r/g, '')
    .replace(/\*\*|__/g, '')
    .replace(/^[ \t]*#+[ \t]*/gm, '');

// The report's sections after the proposals: nothing below them belongs to a proposal.
const AFTER_PROPOSALS_RE =
  /\n[ \t]*(?:[-*•][ \t]*)?(?:\d+\.[ \t]*)?(?:AN[ÁA]LISIS DE LOS VIDEOS|RADIOGRAF[ÍI]A|POTENCIAL VIRAL|DURACI[ÓO]N TOTAL SUGERIDA|RECOMENDACI[ÓO]N_DURACI)/i;

const PROPOSAL_HEADER_RE = /^[ \t]*(?:[-*•][ \t]*)?PROPUESTA[ \t]+(\d+)[ \t]*(?:[—–:.\-][ \t]*(.*))?$/i;

const FIELD_RE =
  /^[ \t]*(?:[-*•][ \t]*)?(Propuesta recomendada|Gancho recomendado|Escaleta recomendada|Tipolog[ií]as?|Tema(?: central)?|Tiempo y lugar(?: hist[óo]rico)?|Cl[ií]max(?: y cierre)?|Por qu[eé] funciona|Prueba de fuentes|Gancho[ \t]*\d+|Escaleta[ \t]*\d+)[ \t]*(?:\([^)\n]*\))?[ \t]*:[ \t]*(.*)$/i;

const fieldKey = (label: string): string => {
  const l = label
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
  if (l.startsWith('propuesta recomendada')) return 'recProposal';
  if (l.startsWith('gancho recomendado')) return 'recHook';
  if (l.startsWith('escaleta recomendada')) return 'recEscaleta';
  if (l.startsWith('tipologia')) return 'typology';
  if (l.startsWith('tema')) return 'topic';
  if (l.startsWith('tiempo y lugar')) return 'timeAndPlace';
  if (l.startsWith('climax')) return 'climax';
  if (l.startsWith('por que funciona')) return 'why';
  if (l.startsWith('prueba de fuentes')) return 'sources';
  const hook = l.match(/^gancho (\d+)$/);
  if (hook) return `hook${hook[1]}`;
  const esc = l.match(/^escaleta (\d+)$/);
  if (esc) return `escaleta${esc[1]}`;
  return '';
};

/** "Gancho 2 — porque…" -> { n: 2, reason: 'porque…' } */
const splitRecommendation = (value: string): { n: number; reason: string } => {
  const v = stripMarks(value);
  const m = v.match(/(\d+)/);
  if (!m) return { n: 0, reason: '' };
  const after = v.slice((m.index || 0) + m[1].length);
  return { n: parseInt(m[1], 10), reason: after.replace(/^[\s—–:.\-,)]+/, '').trim() };
};

/** Reads the complete proposals of a Paso 1 answer. Empty when the answer has none (old six-part answers). */
export function parseStage1Proposals(rawAnswer: string): Stage1ProposalSet {
  const empty: Stage1ProposalSet = { proposals: [], recommendedNumber: 0, recommendedReason: '' };
  const text = normalizeAnswer(rawAnswer);
  if (!/PROPUESTA[ \t]+\d/i.test(text)) return empty;
  const lines = text.split('\n');
  const firstHeader = lines.findIndex((l) => PROPOSAL_HEADER_RE.test(l));
  if (firstHeader < 0) return empty;
  let region = lines.slice(firstHeader).join('\n');
  const after = region.search(AFTER_PROPOSALS_RE);
  if (after >= 0) region = region.slice(0, after);

  const proposals: Stage1Proposal[] = [];
  let recommendedNumber = 0;
  let recommendedReason = '';
  let current: { number: number; title: string; fields: Record<string, string> } | null = null;
  let currentKey = '';

  const closeCurrent = () => {
    if (!current) return;
    const f = current.fields;
    const numbered = (prefix: string): string[] => {
      const out: string[] = [];
      for (let i = 1; i <= 9; i++) {
        const v = stripMarks(f[`${prefix}${i}`] || '');
        if (v && !out.includes(v)) out.push(v);
      }
      return out;
    };
    const hooks = numbered('hook');
    const escaletas = numbered('escaleta');
    const recHook = splitRecommendation(f.recHook || '');
    const recEsc = splitRecommendation(f.recEscaleta || '');
    const topic = stripMarks(f.topic || '');
    const sources = cleanField(f.sources || '');
    const timeAndPlace = stripMarks(f.timeAndPlace || '');
    // A proposal counts only when it can stand on its own: a topic plus its sources or era and place (Paso 1 no
    // longer writes hooks: they come in Paso 3, after the research) or, in older answers, at least one hook
    if (topic && (hooks.length > 0 || sources || timeAndPlace)) {
      proposals.push({
        number: current.number,
        title: stripMarks(current.title),
        typology: stripMarks(f.typology || ''),
        topic,
        timeAndPlace,
        climax: stripMarks(f.climax || ''),
        why: stripMarks(f.why || ''),
        sources,
        hooks,
        recommendedHook: recHook.n >= 1 && recHook.n <= hooks.length ? recHook.n - 1 : 0,
        hookReason: recHook.reason,
        escaletas,
        recommendedEscaleta: recEsc.n >= 1 && recEsc.n <= escaletas.length ? recEsc.n - 1 : 0,
        escaletaReason: recEsc.reason,
      });
    }
    current = null;
    currentKey = '';
  };

  for (const line of region.split('\n')) {
    const header = line.match(PROPOSAL_HEADER_RE);
    if (header) {
      closeCurrent();
      current = { number: parseInt(header[1], 10), title: header[2] || '', fields: {} };
      currentKey = '';
      continue;
    }
    const field = line.match(FIELD_RE);
    const key = field ? fieldKey(field[1]) : '';
    if (field && key) {
      if (key === 'recProposal') {
        const rec = splitRecommendation(field[2]);
        recommendedNumber = rec.n;
        recommendedReason = rec.reason;
        currentKey = '';
        continue;
      }
      if (!current) continue;
      // A label written twice inside one proposal keeps its first text
      if (current.fields[key] === undefined) {
        current.fields[key] = field[2].trim();
        currentKey = key;
      } else {
        currentKey = '';
      }
      continue;
    }
    // Continuation of the field above (Gemini sometimes breaks a paragraph in two lines)
    if (/^[=\-_*\s]{3,}$/.test(line)) continue;
    const cont = line.replace(/^[ \t]*[-*•][ \t]*/, '').trim();
    if (current && currentKey && cont) {
      current.fields[currentKey] = `${current.fields[currentKey]} ${cont}`.trim();
    }
  }
  closeCurrent();

  if (!proposals.some((p) => p.number === recommendedNumber)) {
    recommendedNumber = 0;
    recommendedReason = '';
  }
  return { proposals, recommendedNumber, recommendedReason };
}

/** Reads the list of one-line topics ("Tema 1: …" to "Tema 10: …") of a Paso 1 answer that only proposes topics. */
export function parseStage1TopicIdeas(rawAnswer: string): Stage1TopicIdeas {
  const empty: Stage1TopicIdeas = { ideas: [], recommended: [], recommendedReason: '' };
  const text = normalizeAnswer(rawAnswer);
  if (!/Tema[ \t]+\d+[ \t]*:/i.test(text)) return empty;
  const byNumber = new Map<number, string>();
  let lastNumber = 0;
  let recLine = '';
  for (const line of text.split('\n')) {
    const rec = line.match(/^[ \t]*(?:[-*•][ \t]*)?Temas?[ \t]+recomendados?[ \t]*:[ \t]*(.*)$/i);
    if (rec) {
      recLine = rec[1];
      lastNumber = 0;
      continue;
    }
    const m = line.match(/^[ \t]*(?:[-*•][ \t]*)?Tema[ \t]+(\d+)[ \t]*:[ \t]*(.*)$/i);
    if (m) {
      const n = parseInt(m[1], 10);
      if (n >= 1 && n <= 30 && !byNumber.has(n)) {
        byNumber.set(n, m[2].trim());
        lastNumber = n;
      } else {
        lastNumber = 0;
      }
      continue;
    }
    if (AFTER_PROPOSALS_RE.test(`\n${line}`) || /^[ \t]*\d+\.[ \t]+[A-ZÁÉÍÓÚ]{3,}/.test(line)) {
      lastNumber = 0;
      continue;
    }
    if (/^[=\-_*\s]{3,}$/.test(line)) continue;
    const cont = line.replace(/^[ \t]*[-*•][ \t]*/, '').trim();
    if (lastNumber && cont) byNumber.set(lastNumber, `${byNumber.get(lastNumber)} ${cont}`.trim());
  }
  const numbers = [...byNumber.keys()].sort((a, b) => a - b);
  const ideas: string[] = [];
  const indexOfNumber = new Map<number, number>();
  for (const n of numbers) {
    const v = stripMarks(byNumber.get(n) || '');
    if (v.length > 3 && !ideas.includes(v)) {
      indexOfNumber.set(n, ideas.length);
      ideas.push(v);
    }
  }
  if (ideas.length < 3) return empty;
  const recommended: number[] = [];
  let recommendedReason = '';
  if (recLine) {
    const dash = recLine.search(/[—–]|\s-\s/);
    const numsPart = dash >= 0 ? recLine.slice(0, dash) : recLine;
    recommendedReason = dash >= 0 ? stripMarks(recLine.slice(dash).replace(/^[\s—–\-]+/, '')) : '';
    for (const m of numsPart.matchAll(/\d+/g)) {
      const idx = indexOfNumber.get(parseInt(m[0], 10));
      if (idx !== undefined && !recommended.includes(idx)) recommended.push(idx);
    }
  }
  return { ideas, recommended, recommendedReason };
}

const safeJson = (raw: unknown): any => {
  try {
    return raw ? JSON.parse(String(raw)) : null;
  } catch {
    return null;
  }
};

const cleanList = (v: unknown): string[] =>
  Array.isArray(v) ? v.map((x) => String(x || '').trim()).filter(Boolean) : [];

/** The proposals saved with the documentary when the Paso 1 answer was applied. */
export function readStoredStage1Proposals(promptConfig?: Record<string, any> | null): Stage1ProposalSet {
  const j = safeJson(promptConfig?.[STAGE1_PROPOSALS_KEY]);
  const list = Array.isArray(j?.proposals) ? j.proposals : [];
  const proposals: Stage1Proposal[] = [];
  for (const p of list) {
    const hooks = cleanList(p?.hooks);
    const topic = String(p?.topic || '').trim();
    const timeAndPlace = String(p?.timeAndPlace || '').trim();
    const sources = String(p?.sources || '').trim();
    if (!topic || (hooks.length === 0 && !timeAndPlace && !sources)) continue;
    const escaletas = cleanList(p?.escaletas);
    const clampIdx = (n: unknown, len: number) => {
      const i = Number(n);
      return Number.isInteger(i) && i >= 0 && i < len ? i : 0;
    };
    proposals.push({
      number: Number(p?.number) || proposals.length + 1,
      title: String(p?.title || '').trim(),
      typology: String(p?.typology || '').trim(),
      topic,
      timeAndPlace,
      climax: String(p?.climax || '').trim(),
      why: String(p?.why || '').trim(),
      sources,
      hooks,
      recommendedHook: clampIdx(p?.recommendedHook, hooks.length),
      hookReason: String(p?.hookReason || '').trim(),
      escaletas,
      recommendedEscaleta: clampIdx(p?.recommendedEscaleta, escaletas.length),
      escaletaReason: String(p?.escaletaReason || '').trim(),
    });
  }
  const rec = Number(j?.recommendedNumber) || 0;
  return {
    proposals,
    recommendedNumber: proposals.some((p) => p.number === rec) ? rec : 0,
    recommendedReason: String(j?.recommendedReason || '').trim(),
  };
}

export function readStoredStage1TopicIdeas(promptConfig?: Record<string, any> | null): Stage1TopicIdeas {
  const j = safeJson(promptConfig?.[STAGE1_TOPIC_IDEAS_KEY]);
  const ideas = cleanList(j?.ideas);
  return {
    ideas,
    recommended: Array.isArray(j?.recommended)
      ? j.recommended.map((n: unknown) => Number(n)).filter((n: number) => Number.isInteger(n) && n >= 0 && n < ideas.length)
      : [],
    recommendedReason: String(j?.recommendedReason || '').trim(),
  };
}

export function readPickedStage1TopicIdeas(promptConfig?: Record<string, any> | null): string[] {
  return cleanList(safeJson(promptConfig?.[STAGE1_TOPIC_IDEAS_PICKED_KEY]));
}

/** Era and place of a proposal ("Años 1930–1931 | Nueva York, Estados Unidos"). */
export function splitProposalTimeAndPlace(value: string): { time: string; place: string } {
  const v = String(value || '').trim();
  const bar = v.indexOf('|');
  if (bar >= 0) return { time: v.slice(0, bar).trim(), place: v.slice(bar + 1).trim() };
  const dash = v.search(/\s[—–]\s/);
  if (dash >= 0) return { time: v.slice(0, dash).trim(), place: v.slice(dash + 3).trim() };
  return { time: v, place: '' };
}

/**
 * What the next Paso 1 has to ask Gemini for:
 * - ANGLES: the producer typed the subject -> complete proposals that are different angles of it.
 * - DEVELOP: no typed subject, topics marked from the list of 10 -> complete proposals for exactly those topics.
 * - IDEAS: no subject and marked videos -> only the list of 10 one-line topics.
 * - OPEN: no subject and no marked videos -> complete proposals, each with its own original topic.
 * A Tema field that only holds the topic of a proposal picked earlier is not "typed": then the subject is the
 * one the producer had typed before picking it (if any), so asking again gives new angles of the same subject.
 */
export function resolveStage1Paso1Mode(
  doc: { topic?: string; promptConfig?: Record<string, any> | null },
  hasMarkedVideos: boolean
): { mode: Stage1Paso1Mode; subject: string; pickedIdeas: string[] } {
  const cfg = doc.promptConfig || {};
  const topic = String(doc.topic || '').trim();
  const stored = readStoredStage1Proposals(cfg);
  const topicCameFromProposal = Boolean(topic) && stored.proposals.some((p) => p.topic === topic);
  const subject = topicCameFromProposal ? String(cfg[STAGE1_SUBJECT_BASE_KEY] || '').trim() : topic;
  const pickedIdeas = readPickedStage1TopicIdeas(cfg);
  if (subject) return { mode: 'ANGLES', subject, pickedIdeas: [] };
  if (pickedIdeas.length > 0) return { mode: 'DEVELOP', subject: '', pickedIdeas };
  if (hasMarkedVideos) return { mode: 'IDEAS', subject: '', pickedIdeas: [] };
  return { mode: 'OPEN', subject: '', pickedIdeas: [] };
}

/** The documentary fields a proposal fills when it is chosen (with its recommended hook and outline). */
export function stage1ProposalFields(p: Stage1Proposal): {
  typology: string;
  topic: string;
  time: string;
  place: string;
  hook: string;
  escaleta: string;
  climax: string;
} {
  const tp = splitProposalTimeAndPlace(p.timeAndPlace);
  return {
    typology: p.typology,
    topic: p.topic,
    time: tp.time,
    place: tp.place,
    hook: p.hooks[p.recommendedHook] || p.hooks[0] || '',
    escaleta: p.escaletas[p.recommendedEscaleta] || p.escaletas[0] || '',
    climax: p.climax,
  };
}

export const sameStage1ProposalSet = (a: Stage1ProposalSet, b: Stage1ProposalSet): boolean =>
  JSON.stringify(a) === JSON.stringify(b);

export const sameStage1TopicIdeas = (a: Stage1TopicIdeas, b: Stage1TopicIdeas): boolean =>
  JSON.stringify(a) === JSON.stringify(b);

// ---------------------------------------------------------------------------------------------------------------
// Paso 3 · Diseño narrativo and Paso 4 · Comprobación.
// Paso 1 only chooses the topic and Paso 2 researches it without a hook or outline; Paso 3 designs the hooks,
// outlines and climax on top of that research, and Paso 4 checks the chosen design against it.
// ---------------------------------------------------------------------------------------------------------------

/** Gemini's raw answers of Pasos 3 and 4, kept with the documentary (read on the fly by the screen). */
export const STAGE1_PASO3_RESULT_KEY = 'ETAPA1_PASO3_RESULT';
export const STAGE1_PASO4_RESULT_KEY = 'ETAPA1_PASO4_RESULT';
/** What each step was built on, saved when its answer arrives: a later change marks the step as out of date. */
export const STAGE1_PASO2_SOURCE_KEY = 'ETAPA1_PASO2_SOURCE_FP';
export const STAGE1_PASO3_SOURCE_KEY = 'ETAPA1_PASO3_SOURCE_FP';
export const STAGE1_PASO4_SOURCE_KEY = 'ETAPA1_PASO4_SOURCE_FP';
/** Etapa 1 step numbers sent to Gemini: Paso 1 = 10, Paso 2 = 1 (Deep Research), Paso 3 = 13, Paso 4 = 14. */
export const STAGE1_PASO3_STAGE = 13;
export const STAGE1_PASO4_STAGE = 14;

/** Short fingerprint of some texts (spaces collapsed), to know whether what a step was built on changed. */
export function stage1Fingerprint(...parts: unknown[]): string {
  const s = parts.map((p) => String(p ?? '').replace(/\s+/g, ' ').trim()).join('␞');
  if (!s.replace(/␞/g, '')) return '';
  let h = 5381;
  for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) | 0;
  return `${s.length.toString(36)}-${(h >>> 0).toString(36)}`;
}

/** What Paso 2 researched: the topic with its era and place. */
export const stage1Paso2SourceFingerprint = (doc: {
  topic?: string;
  historicalTime?: string;
  historicalLocation?: string;
}): string => stage1Fingerprint(doc.topic, doc.historicalTime, doc.historicalLocation);

/** What Paso 3 designed on: the research dossier. */
export const stage1Paso3SourceFingerprint = (doc: { deepResearchResult?: string }): string =>
  stage1Fingerprint(doc.deepResearchResult);

/** What Paso 4 checked: the chosen hook, outline and climax. */
export const stage1Paso4SourceFingerprint = (cfg?: Record<string, any> | null): string =>
  stage1Fingerprint(cfg?.PROPOSICION_GANCHO || cfg?.ANGULO_CENTRAL, cfg?.PROPOSICION_ESCALETA, cfg?.PROPOSICION_CLIMAX);

export interface Stage1NarrativeDesign {
  hooks: string[];
  /** Index (0-based) of the hook Gemini would choose */
  recommendedHook: number;
  hookReason: string;
  /** Each outline keeps its acts on separate lines */
  escaletas: string[];
  recommendedEscaleta: number;
  escaletaReason: string;
  climax: string;
}

const DESIGN_FIELD_RE =
  /^[ \t]*(?:[-*•][ \t]*)?(Gancho recomendado|Escaleta recomendada|Gancho[ \t]*\d+|Escaleta[ \t]*\d+|Cl[ií]max y cierre|Cl[ií]max)[ \t]*(?:\([^)\n]*\))?[ \t]*:[ \t]*(.*)$/i;

/** A field written over several lines (an outline's acts): each line cleaned, the line breaks kept. */
const cleanMultiline = (s: string): string =>
  String(s || '')
    .split('\n')
    .map((l) => cleanField(l))
    .filter(Boolean)
    .join('\n');

/** Reads the Paso 3 answer: 3 hooks, 2 outlines and the climax, with Gemini's recommendations. */
export function parseStage1NarrativeDesign(rawAnswer: string): Stage1NarrativeDesign {
  const empty: Stage1NarrativeDesign = {
    hooks: [],
    recommendedHook: 0,
    hookReason: '',
    escaletas: [],
    recommendedEscaleta: 0,
    escaletaReason: '',
    climax: '',
  };
  const text = normalizeAnswer(rawAnswer);
  const head = text.search(/DISE[ÑN]O NARRATIVO/i);
  let region = head >= 0 ? text.slice(head) : text;
  const after = region.search(AFTER_PROPOSALS_RE);
  if (after >= 0) region = region.slice(0, after);
  const fields: Record<string, string> = {};
  let currentKey = '';
  for (const line of region.split('\n')) {
    const field = line.match(DESIGN_FIELD_RE);
    const key = field ? fieldKey(field[1]) : '';
    // An outline's act called "Clímax (85–95%): …" is part of that outline, not the climax field
    const actInsideOutline = key === 'climax' && !/y cierre/i.test(field?.[1] || '') && currentKey.startsWith('escaleta');
    if (field && key && !actInsideOutline) {
      if (fields[key] === undefined) {
        fields[key] = field[2].trim();
        currentKey = key;
      } else {
        currentKey = '';
      }
      continue;
    }
    if (/^[=\-_*\s]{3,}$/.test(line)) continue;
    const cont = line.replace(/^[ \t]*[-*•][ \t]*/, '').trim();
    if (!currentKey || !cont) continue;
    // Outlines and the climax keep their lines (one act per line); hooks are one paragraph
    const sep = currentKey.startsWith('escaleta') || currentKey === 'climax' ? '\n' : ' ';
    fields[currentKey] = fields[currentKey] ? `${fields[currentKey]}${sep}${cont}` : cont;
  }
  const numbered = (prefix: string, multiline: boolean): string[] => {
    const out: string[] = [];
    for (let i = 1; i <= 9; i++) {
      const v = multiline ? cleanMultiline(fields[`${prefix}${i}`] || '') : cleanField(fields[`${prefix}${i}`] || '');
      if (v && !out.includes(v)) out.push(v);
    }
    return out;
  };
  const hooks = numbered('hook', false);
  const escaletas = numbered('escaleta', true);
  if (hooks.length === 0 && escaletas.length === 0) return empty;
  const recHook = splitRecommendation(fields.recHook || '');
  const recEsc = splitRecommendation(fields.recEscaleta || '');
  return {
    hooks,
    recommendedHook: recHook.n >= 1 && recHook.n <= hooks.length ? recHook.n - 1 : 0,
    hookReason: recHook.reason,
    escaletas,
    recommendedEscaleta: recEsc.n >= 1 && recEsc.n <= escaletas.length ? recEsc.n - 1 : 0,
    escaletaReason: recEsc.reason,
    climax: cleanMultiline(fields.climax || ''),
  };
}

/** "RECOMENDACIÓN_DURACIÓN_TOTAL: 1200" -> 1200 (one of the studio durations), 0 when the answer has none. */
export function parseStage1DurationRecommendation(rawAnswer: string): number {
  const text = String(rawAnswer || '');
  const m = text.match(/(?:RECOMENDACI[OÓ]N_DURACI[OÓ]N_TOTAL|RECOMMENDED_TOTAL_DURATION)\**\s*:\s*\**\s*(\d{3,4})/i);
  if (!m) return 0;
  const sec = parseInt(m[1], 10);
  const tiers = [600, 900, 1200, 1800, 3600, 7200];
  return tiers.reduce((best, t) => (Math.abs(t - sec) < Math.abs(best - sec) ? t : best), tiers[0]);
}

export interface Stage1Check {
  /** Claims of the design that no reference of the research backs */
  noSource: string[];
  /** Points the research marks "(incierto)" that the design tells as fact */
  uncertain: string[];
  /** Errors of the marked videos that the design repeats */
  repeatedErrors: string[];
  verdict: 'LISTO' | 'CORREGIR' | '';
  verdictReason: string;
  /** Corrected texts ('' when Gemini wrote "sin cambios") */
  correctedHook: string;
  correctedEscaleta: string;
  correctedClimax: string;
  /** Section 5: the @characters and @locations, in the format the Etapa 4 reader understands */
  references: string;
}

const CHECK_SECTION_RE =
  /^[ \t]*(?:[-*•][ \t]*)?(?:\d+[.)][ \t]*)?(SIN FUENTE|INCIERTO USADO COMO HECHO|ERRORES REPETIDOS[^:\n]*|VEREDICTO|PERSONAJES Y LUGARES[^:\n]*)[ \t]*:?[ \t]*(.*)$/i;
const CHECK_FIELD_RE =
  /^[ \t]*(?:[-*•][ \t]*)?(Gancho corregido|Escaleta corregida|Cl[ií]max corregido)[ \t]*:[ \t]*(.*)$/i;
const NOTHING_RE = /^(?:ningun[oa]s?|nada|no aplica\b.*|no hay\b|sin (?:observaciones|problemas|cambios|errores)|—|-)[\s.]*$/i;
const NO_CHANGES_RE = /^(?:sin cambios|ninguno|igual|no cambia)[\s.]*$/i;

/** Reads the Paso 4 answer (the check of the chosen design against the research). */
export function parseStage1Check(rawAnswer: string): Stage1Check {
  const out: Stage1Check = {
    noSource: [],
    uncertain: [],
    repeatedErrors: [],
    verdict: '',
    verdictReason: '',
    correctedHook: '',
    correctedEscaleta: '',
    correctedClimax: '',
    references: '',
  };
  const text = normalizeAnswer(rawAnswer);
  let section = '';
  let fieldKeyName = '';
  const fields: Record<string, string> = {};
  const refLines: string[] = [];
  const pushItem = (list: string[], line: string) => {
    const v = cleanField(line.replace(/^[ \t]*(?:[-*•]|\d+[.)])[ \t]*/, ''));
    if (v && !NOTHING_RE.test(v)) list.push(v);
  };
  for (const line of text.split('\n')) {
    const sec = line.match(CHECK_SECTION_RE);
    if (sec) {
      const name = sec[1].toUpperCase();
      section = name.startsWith('SIN FUENTE')
        ? 'noSource'
        : name.startsWith('INCIERTO')
        ? 'uncertain'
        : name.startsWith('ERRORES')
        ? 'repeatedErrors'
        : name.startsWith('VEREDICTO')
        ? 'verdict'
        : 'references';
      fieldKeyName = '';
      const rest = sec[2].trim();
      if (section === 'verdict' && rest) {
        const v = stripMarks(rest);
        if (/CORREGIR/i.test(v)) out.verdict = 'CORREGIR';
        else if (/LISTO/i.test(v)) out.verdict = 'LISTO';
        out.verdictReason = v.replace(/^(?:LISTO|CORREGIR)[\s—–:.\-]*/i, '').trim();
      } else if (rest && section !== 'references' && section !== 'verdict') {
        pushItem((out as any)[section], rest);
      }
      continue;
    }
    if (!section || /^[=\-_*\s]{3,}$/.test(line) || !line.trim()) continue;
    if (section === 'references') {
      refLines.push(line.trim());
      continue;
    }
    if (section === 'verdict') {
      const f = line.match(CHECK_FIELD_RE);
      if (f) {
        const n = f[1].toLowerCase();
        fieldKeyName = n.startsWith('gancho') ? 'hook' : n.startsWith('escaleta') ? 'escaleta' : 'climax';
        fields[fieldKeyName] = f[2].trim();
        continue;
      }
      if (fieldKeyName) {
        const cont = line.replace(/^[ \t]*[-*•][ \t]*/, '').trim();
        const sep = fieldKeyName === 'hook' ? ' ' : '\n';
        fields[fieldKeyName] = fields[fieldKeyName] ? `${fields[fieldKeyName]}${sep}${cont}` : cont;
        continue;
      }
      const v = stripMarks(line);
      if (!out.verdict) {
        if (/CORREGIR/i.test(v)) out.verdict = 'CORREGIR';
        else if (/LISTO/i.test(v)) out.verdict = 'LISTO';
        out.verdictReason = v.replace(/^(?:LISTO|CORREGIR)[\s—–:.\-]*/i, '').trim();
      } else if (!out.verdictReason) {
        out.verdictReason = v;
      }
      continue;
    }
    pushItem((out as any)[section], line);
  }
  const corrected = (key: string, multiline: boolean): string => {
    const v = multiline ? cleanMultiline(fields[key] || '') : cleanField(fields[key] || '');
    return v && !NO_CHANGES_RE.test(v) ? v : '';
  };
  out.correctedHook = corrected('hook', false);
  out.correctedEscaleta = corrected('escaleta', true);
  out.correctedClimax = corrected('climax', true);
  out.references = refLines.join('\n').trim();
  return out;
}

/** The keys Etapas 2 and 4 read as the chosen design (hook, outline and climax). */
export function stage1DesignConfig(hook: string, escaleta: string, climax: string): Record<string, string> {
  return {
    PROPOSICION_GANCHO: hook,
    ANGULO_CENTRAL: hook,
    PROPOSICION_ESCALETA: escaleta,
    PROPOSICION_CLIMAX: climax,
  };
}

type Stage1DocLike = {
  topic?: string;
  historicalTime?: string;
  historicalLocation?: string;
  deepResearchResult?: string;
  promptConfig?: Record<string, any> | null;
};

/**
 * What Paso 3's answer changes, the same on the Mac and from the iPhone: the answer is kept, its recommended hook,
 * outline and climax become the chosen design, and its recommended duration becomes the documentary's unless the
 * producer fixed it. Null when the answer holds no design (an error message from Gemini).
 */
export function stage1Paso3AnswerPatch(
  doc: Stage1DocLike,
  answer: string
): { promptConfig: Record<string, string>; targetDurationSeconds?: number } | null {
  const design = parseStage1NarrativeDesign(answer);
  if (design.hooks.length === 0 && design.escaletas.length === 0) return null;
  const cfg = doc.promptConfig || {};
  const hook = design.hooks[design.recommendedHook] || design.hooks[0] || '';
  const escaleta = design.escaletas[design.recommendedEscaleta] || design.escaletas[0] || '';
  const sec = parseStage1DurationRecommendation(answer);
  const reason = (String(answer || '').match(/JUSTIFICACI[OÓ]N\s+DE\s+DURACI[OÓ]N\**\s*:\s*\**\s*([^\n]+)/i)?.[1] || '')
    .replace(/\*+/g, '')
    .replace(/^\[|\]\.?$/g, '')
    .trim();
  const applyDuration = sec > 0 && cfg.DURACION_MANUAL_CONFIRMADA !== 'SI';
  return {
    ...(applyDuration ? { targetDurationSeconds: sec } : {}),
    promptConfig: {
      [STAGE1_PASO3_RESULT_KEY]: answer,
      [STAGE1_PASO3_SOURCE_KEY]: stage1Paso3SourceFingerprint(doc),
      ...stage1DesignConfig(hook, escaleta, design.climax),
      ...(applyDuration ? { DURACION_TOTAL_SEGUNDOS: String(sec) } : {}),
      ...(sec > 0 ? { SUGGESTED_DURATION_SECONDS: String(sec) } : {}),
      ...(sec > 0 && reason ? { SUGGESTED_DURATION_REASON: reason } : {}),
    },
  };
}

/** What Paso 4's answer changes: the answer is kept with the design it checked. Null when it holds no check. */
export function stage1Paso4AnswerPatch(
  doc: Stage1DocLike,
  answer: string
): { promptConfig: Record<string, string>; check: Stage1Check } | null {
  const check = parseStage1Check(answer);
  const hasCheck =
    Boolean(check.verdict) ||
    Boolean(check.references) ||
    check.noSource.length + check.uncertain.length + check.repeatedErrors.length > 0;
  if (!hasCheck) return null;
  return {
    check,
    promptConfig: {
      [STAGE1_PASO4_RESULT_KEY]: answer,
      [STAGE1_PASO4_SOURCE_KEY]: stage1Paso4SourceFingerprint(doc.promptConfig),
    },
  };
}
