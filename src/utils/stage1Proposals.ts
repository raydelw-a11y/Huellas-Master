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
  /^[ \t]*(?:[-*•][ \t]*)?(Propuesta recomendada|Gancho recomendado|Escaleta recomendada|Tipolog[ií]as?|Tema(?: central)?|Tiempo y lugar(?: hist[óo]rico)?|Cl[ií]max(?: y cierre)?|Por qu[eé] funciona|Gancho[ \t]*\d+|Escaleta[ \t]*\d+)[ \t]*(?:\([^)\n]*\))?[ \t]*:[ \t]*(.*)$/i;

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
    // A proposal counts only when it can stand on its own: a topic and at least one hook
    if (topic && hooks.length > 0) {
      proposals.push({
        number: current.number,
        title: stripMarks(current.title),
        typology: stripMarks(f.typology || ''),
        topic,
        timeAndPlace: stripMarks(f.timeAndPlace || ''),
        climax: stripMarks(f.climax || ''),
        why: stripMarks(f.why || ''),
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
    if (!topic || hooks.length === 0) continue;
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
      timeAndPlace: String(p?.timeAndPlace || '').trim(),
      climax: String(p?.climax || '').trim(),
      why: String(p?.why || '').trim(),
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
