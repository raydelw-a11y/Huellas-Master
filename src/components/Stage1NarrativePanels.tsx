// Etapa 1 shown step by step: the header of each step (status + one-line summary, folds its content) and the
// panels of Paso 3 · Diseño narrativo and Paso 4 · Comprobación.
// Paso 1 only chooses the topic, Paso 2 researches it without a hook or outline, Paso 3 writes the hooks, outlines
// and climax on top of that research and Paso 4 checks the chosen design against it.
import React, { useMemo, useState } from 'react';
import {
  STAGE1_PASO2_SOURCE_KEY,
  STAGE1_PASO3_RESULT_KEY,
  STAGE1_PASO3_SOURCE_KEY,
  STAGE1_PASO4_RESULT_KEY,
  STAGE1_PASO4_SOURCE_KEY,
  STAGE1_PROPOSAL_SELECTED_KEY,
  parseStage1Check,
  parseStage1DurationRecommendation,
  parseStage1NarrativeDesign,
  stage1DesignConfig,
  stage1Paso2SourceFingerprint,
  stage1Paso3SourceFingerprint,
  stage1Paso4SourceFingerprint,
} from '../utils/stage1Proposals';
import { EditOnBlur, VariantList } from './Stage1ProposalsPanel';

export type Stage1StepId = 'material' | 'paso1' | 'paso2' | 'paso3' | 'paso4';
export type Stage1StepStatus = 'done' | 'stale' | 'pending';

type Stage1Doc = {
  id?: string;
  topic?: string;
  historicalTime?: string;
  historicalLocation?: string;
  deepResearchPrompt?: string;
  deepResearchResult?: string;
  targetDurationSeconds?: number;
  promptConfig?: Record<string, any> | null;
};

const txt = (v: unknown) => String(v ?? '').trim();
const same = (a: string, b: string) => txt(a) === txt(b);
const short = (v: string, max = 90) => {
  const s = txt(v).replace(/\s+/g, ' ');
  return s.length > max ? `${s.slice(0, max - 1)}…` : s;
};
export const formatStage1Duration = (sec: number) => {
  const s = Math.max(0, Math.round(sec));
  const m = Math.floor(s / 60);
  const rest = s % 60;
  return rest ? `${m} min ${rest} s` : `${m} min`;
};

/** A step is out of date when what it was built on changed after its answer arrived. */
const isStale = (savedFp: unknown, currentFp: string) => Boolean(txt(savedFp)) && txt(savedFp) !== currentFp;

export interface Stage1StepState {
  status: Stage1StepStatus;
  summary: string;
}

export interface Stage1StepsView {
  paso1: Stage1StepState;
  paso2: Stage1StepState;
  paso3: Stage1StepState;
  paso4: Stage1StepState;
  /** First step not done (or out of date); null when the four are done */
  firstUnfinished: Exclude<Stage1StepId, 'material'> | null;
}

/** Status and summary of the four steps, read from the documentary only (the same on the Mac and the iPhone). */
export function computeStage1StepStates(doc: Stage1Doc): Stage1StepsView {
  const cfg = doc.promptConfig || {};
  const topic = txt(doc.topic);
  const research = txt(doc.deepResearchResult);

  const paso1Done =
    Boolean(topic) &&
    (Number(cfg[STAGE1_PROPOSAL_SELECTED_KEY]) > 0 || Boolean(txt(doc.deepResearchPrompt)) || Boolean(research));
  const paso1: Stage1StepState = paso1Done
    ? { status: 'done', summary: `Tema: ${short(topic)}` }
    : {
        status: 'pending',
        summary: 'Un tema escrito da 4 ángulos; sin tema, los videos marcados dan 10 temas para elegir.',
      };

  const paso2: Stage1StepState = !research
    ? { status: 'pending', summary: 'Investigación profunda y neutral del tema elegido (Deep Research).' }
    : isStale(cfg[STAGE1_PASO2_SOURCE_KEY], stage1Paso2SourceFingerprint(doc))
    ? { status: 'stale', summary: 'El tema cambió después de investigar: vuelve a investigar.' }
    : { status: 'done', summary: `Investigación lista (${Math.max(1, Math.round(research.length / 1000))} mil caracteres).` };

  const hook = txt(cfg.PROPOSICION_GANCHO || cfg.ANGULO_CENTRAL);
  const escaleta = txt(cfg.PROPOSICION_ESCALETA);
  const paso3Result = txt(cfg[STAGE1_PASO3_RESULT_KEY]);
  const dur = Number(doc.targetDurationSeconds || 0);
  const paso3: Stage1StepState = !hook || !escaleta
    ? { status: 'pending', summary: '3 ganchos, 2 escaletas y el clímax, citando la investigación; propone la duración.' }
    : paso3Result && isStale(cfg[STAGE1_PASO3_SOURCE_KEY], stage1Paso3SourceFingerprint(doc))
    ? { status: 'stale', summary: 'La investigación cambió después de este diseño: rehazlo.' }
    : {
        status: 'done',
        summary: `Gancho: ${short(hook, 70)}${dur > 0 ? ` · ${formatStage1Duration(dur)}` : ''}`,
      };

  const paso4Result = txt(cfg[STAGE1_PASO4_RESULT_KEY]);
  let paso4: Stage1StepState;
  if (!paso4Result) {
    paso4 = {
      status: 'pending',
      summary: 'Busca afirmaciones sin fuente, dudas contadas como hechos y errores repetidos de otros videos.',
    };
  } else if (isStale(cfg[STAGE1_PASO4_SOURCE_KEY], stage1Paso4SourceFingerprint(cfg))) {
    paso4 = { status: 'stale', summary: 'El diseño cambió después de comprobarlo: vuelve a comprobar.' };
  } else {
    const check = parseStage1Check(paso4Result);
    const warnings = check.noSource.length + check.uncertain.length + check.repeatedErrors.length;
    paso4 = {
      status: 'done',
      summary: `Veredicto: ${check.verdict || 'sin veredicto'} · ${
        warnings === 0 ? 'sin avisos' : `${warnings} aviso${warnings === 1 ? '' : 's'}`
      }`,
    };
  }

  const order: Array<[Exclude<Stage1StepId, 'material'>, Stage1StepState]> = [
    ['paso1', paso1],
    ['paso2', paso2],
    ['paso3', paso3],
    ['paso4', paso4],
  ];
  const firstUnfinished = order.find(([, s]) => s.status !== 'done')?.[0] || null;
  return { paso1, paso2, paso3, paso4, firstUnfinished };
}

/** Steps open on their own: the first one not done (with the material when it is Paso 1). */
export const defaultOpenStage1Steps = (first: Stage1StepsView['firstUnfinished']): Stage1StepId[] =>
  first === 'paso1' ? ['material', 'paso1'] : first ? [first] : [];

const STATUS_LOOK: Record<Stage1StepStatus, { badge: string; label: string; border: string }> = {
  done: {
    badge: 'bg-emerald-500/20 border-emerald-500/50 text-emerald-300',
    label: '✓ Hecho',
    border: 'border-emerald-500/40',
  },
  stale: {
    badge: 'bg-rose-500/20 border-rose-500/50 text-rose-200',
    label: '⚠️ Desactualizado',
    border: 'border-rose-500/50',
  },
  pending: {
    badge: 'bg-slate-800 border-slate-700 text-slate-300',
    label: 'Pendiente',
    border: 'border-slate-700',
  },
};

/** The bar of one step: number, title, status and summary; a click folds or unfolds its content. */
export function Stage1StepHeader({
  number,
  title,
  model,
  status,
  summary,
  open,
  running,
  onToggle,
}: {
  number: string;
  title: string;
  model?: string;
  status?: Stage1StepStatus;
  summary: string;
  open: boolean;
  running?: boolean;
  onToggle: () => void;
}) {
  const look = status ? STATUS_LOOK[status] : null;
  return (
    <button
      type="button"
      onClick={onToggle}
      aria-expanded={open}
      className={`w-full max-w-full min-w-0 text-left rounded-2xl border-2 px-3 sm:px-4 py-2.5 sm:py-3 bg-[#14120f] hover:bg-slate-900/80 transition cursor-pointer flex items-start gap-3 ${
        open ? 'border-amber-500/60' : look ? look.border : 'border-slate-700'
      }`}
    >
      <span className="shrink-0 w-7 h-7 sm:w-8 sm:h-8 rounded-full bg-amber-500 text-slate-950 font-black text-sm sm:text-base flex items-center justify-center">
        {number}
      </span>
      <span className="flex-1 min-w-0 space-y-0.5">
        <span className="flex items-center gap-2 flex-wrap">
          <span className="font-black text-amber-300 text-sm sm:text-base break-words">{title}</span>
          {model && (
            <span className="px-2 py-0.5 rounded-md bg-slate-900 border border-slate-700 text-emerald-300 text-[10px] font-bold">
              {model}
            </span>
          )}
          {running ? (
            <span className="px-2 py-0.5 rounded-md border bg-amber-500/20 border-amber-400/60 text-amber-200 text-[10px] font-black">
              ⏳ En Gemini…
            </span>
          ) : (
            look && (
              <span className={`px-2 py-0.5 rounded-md border text-[10px] font-black ${look.badge}`}>{look.label}</span>
            )
          )}
        </span>
        <span className="block text-[11px] sm:text-xs text-slate-400 break-words">{summary}</span>
      </span>
      <span className="shrink-0 text-amber-300 text-sm font-black pt-1">{open ? '▾' : '▸'}</span>
    </button>
  );
}

// ---------------------------------------------------------------------------------------------------------------
// Paso 3 · Diseño narrativo
// ---------------------------------------------------------------------------------------------------------------

export function Stage1DesignPanel({
  doc,
  busy,
  running,
  onGenerate,
  onCheck,
  onSetDesign,
  onApplyDuration,
}: {
  doc: Stage1Doc;
  busy: boolean;
  running: boolean;
  onGenerate: () => void;
  onCheck: () => void;
  onSetDesign: (patch: Record<string, string>) => void;
  onApplyDuration: (seconds: number) => void;
}) {
  const cfg = doc.promptConfig || {};
  const result = String(cfg[STAGE1_PASO3_RESULT_KEY] || '');
  const design = useMemo(() => parseStage1NarrativeDesign(result), [result]);
  const hasDossier = Boolean(txt(doc.deepResearchResult));
  const stale = Boolean(txt(result)) && isStale(cfg[STAGE1_PASO3_SOURCE_KEY], stage1Paso3SourceFingerprint(doc));
  const hasDesign = design.hooks.length > 0 || design.escaletas.length > 0;
  const currentHook = String(cfg.PROPOSICION_GANCHO || cfg.ANGULO_CENTRAL || '');
  const currentEscaleta = String(cfg.PROPOSICION_ESCALETA || '');
  const currentClimax = String(cfg.PROPOSICION_CLIMAX || '');
  const designChosen = Boolean(txt(currentHook)) && Boolean(txt(currentEscaleta));
  const suggestedSec = txt(result) ? parseStage1DurationRecommendation(result) : 0;
  const suggestedReason = suggestedSec > 0 ? txt(cfg.SUGGESTED_DURATION_REASON) : '';
  const currentSec = Number(doc.targetDurationSeconds || 0);
  const manualDuration = cfg.DURACION_MANUAL_CONFIRMADA === 'SI';
  const [editOpen, setEditOpen] = useState(false);

  return (
    <div className="bg-slate-950/90 border-2 border-sky-500/40 rounded-2xl p-3 sm:p-5 space-y-4 w-full max-w-full min-w-0 overflow-hidden">
      <div className="flex items-start justify-between flex-wrap gap-3 min-w-0">
        <div className="space-y-1 max-w-3xl min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="px-2.5 py-0.5 rounded-md bg-sky-500/20 border border-sky-400/50 text-sky-200 text-xs font-black">
              PASO 3 DE ETAPA 1
            </span>
            <span className="px-2.5 py-0.5 rounded-md bg-slate-900 border border-slate-700 text-emerald-300 text-[11px] font-bold">
              ⚡ modelo Neon · SIN Deep Research
            </span>
          </div>
          <h4 className="font-extrabold text-slate-100 text-sm sm:text-base break-words">
            3º Diseño narrativo: gancho, escaleta y clímax
          </h4>
          <p className="text-xs text-slate-300 leading-relaxed break-words">
            Con la investigación del Paso 2 ya hecha, Gemini escribe <strong>3 ganchos</strong>,{' '}
            <strong>2 escaletas</strong> y <strong>el clímax</strong>, citando con <code className="text-amber-300">[n]</code>{' '}
            las fuentes de la investigación, y propone la duración según el material encontrado. Antes de pulsar,
            revisa arriba la <strong>⏱️ Calibración</strong> (Intro, Clip 1 y duración).
          </p>
        </div>
        <button
          type="button"
          disabled={busy || !hasDossier}
          onClick={onGenerate}
          className="w-full sm:w-auto max-w-full px-3.5 sm:px-5 py-2.5 sm:py-3 rounded-xl font-black text-xs sm:text-sm shadow-lg transition whitespace-normal text-left sm:text-center bg-gradient-to-r from-sky-500 to-amber-400 hover:from-sky-400 hover:to-amber-300 disabled:opacity-50 disabled:cursor-not-allowed text-slate-950 cursor-pointer"
        >
          {running
            ? 'Diseñando en Gemini...'
            : txt(result)
            ? '🔁 Rehacer el diseño (Neon)'
            : '🎬 Paso 3: Diseñar gancho, escaleta y clímax (Neon)'}
        </button>
      </div>

      {!hasDossier && (
        <div className="bg-slate-900/70 border border-amber-500/40 rounded-xl p-3 text-xs text-amber-200 break-words">
          Primero termina el <strong>Paso 2</strong>: el diseño se escribe sobre la investigación.
        </div>
      )}
      {stale && (
        <div className="bg-rose-950/40 border border-rose-500/50 rounded-xl p-3 text-xs text-rose-200 break-words">
          ⚠️ La investigación del Paso 2 cambió después de este diseño. Rehaz el diseño para que se apoye en la
          investigación nueva.
        </div>
      )}
      {txt(result) && !hasDesign && (
        <div className="bg-rose-950/40 border border-rose-500/50 rounded-xl p-3 text-xs text-rose-200 break-words">
          La respuesta guardada de Gemini no trae ganchos ni escaletas. Vuelve a pulsar el botón del Paso 3.
        </div>
      )}
      {!txt(result) && designChosen && (
        <div className="bg-slate-900/70 border border-slate-700 rounded-xl p-3 text-xs text-slate-300 break-words">
          Este documental ya trae el gancho y la escaleta de su Paso 1 anterior. Puedes dejarlos o rehacer el diseño
          con la investigación.
        </div>
      )}

      {hasDesign && (
        <div className="space-y-4 min-w-0">
          <VariantList
            title={`Apertura y gancho (Clip 1) · ${design.hooks.length} variantes`}
            noun="Gancho"
            variants={design.hooks}
            current={currentHook}
            recommendedIdx={design.recommendedHook}
            reason={design.hookReason}
            badge="🔬 Apoyados en la investigación"
            onPick={(text) => onSetDesign({ PROPOSICION_GANCHO: text, ANGULO_CENTRAL: text })}
          />
          <VariantList
            title={`Escaleta por actos · ${design.escaletas.length} variantes`}
            noun="Escaleta"
            variants={design.escaletas}
            current={currentEscaleta}
            recommendedIdx={design.recommendedEscaleta}
            reason={design.escaletaReason}
            badge="🔬 Apoyadas en la investigación"
            onPick={(text) => onSetDesign({ PROPOSICION_ESCALETA: text })}
          />
          {design.climax && (
            <button
              type="button"
              onClick={() => onSetDesign({ PROPOSICION_CLIMAX: design.climax })}
              className={`w-full text-left p-3 rounded-xl border transition cursor-pointer min-w-0 max-w-full break-words space-y-1.5 ${
                same(design.climax, currentClimax)
                  ? 'bg-emerald-500/15 border-emerald-400 text-slate-100'
                  : 'bg-slate-950/90 hover:bg-slate-900 border-slate-800 text-slate-300'
              }`}
            >
              <span className="flex items-center justify-between gap-2 flex-wrap">
                <span className="text-xs sm:text-sm font-extrabold text-amber-200">🏁 Clímax y cierre</span>
                {same(design.climax, currentClimax) ? (
                  <span className="text-[10px] font-bold text-emerald-300">✓ Activo en Documental</span>
                ) : (
                  <span className="text-[10px] font-bold text-amber-300">Pulsa para usarlo</span>
                )}
              </span>
              <span className="block text-xs leading-relaxed break-words whitespace-pre-line">{design.climax}</span>
            </button>
          )}
        </div>
      )}

      {(hasDesign || designChosen) && (
        <div className="border-t border-slate-800 pt-3 space-y-2.5 min-w-0">
          <button
            type="button"
            onClick={() => setEditOpen((v) => !v)}
            className="text-xs font-bold text-amber-300 hover:text-amber-200 cursor-pointer"
          >
            {editOpen ? '▾' : '▸'} Editar a mano el gancho, la escaleta o el clímax
          </button>
          {editOpen && (
            <div className="space-y-2.5 min-w-0">
              <p className="text-[11px] text-slate-400 break-words">Los cambios se guardan al salir de cada caja.</p>
              <EditOnBlur
                label="Gancho activo"
                value={currentHook}
                onCommit={(v) => onSetDesign({ PROPOSICION_GANCHO: v, ANGULO_CENTRAL: v })}
              />
              <EditOnBlur
                label="Escaleta activa"
                value={currentEscaleta}
                onCommit={(v) => onSetDesign({ PROPOSICION_ESCALETA: v })}
              />
              <EditOnBlur
                label="Clímax y cierre activo"
                value={currentClimax}
                onCommit={(v) => onSetDesign({ PROPOSICION_CLIMAX: v })}
              />
            </div>
          )}
        </div>
      )}

      {suggestedSec > 0 && (
        <div className="bg-slate-900/90 border border-amber-500/40 rounded-xl p-3 flex items-center justify-between flex-wrap gap-3 min-w-0">
          <div className="space-y-1 max-w-3xl min-w-0">
            <span className="inline-block px-2 py-0.5 rounded bg-amber-500 text-slate-950 text-[10px] font-black uppercase">
              ⏱️ Duración sugerida por el diseño: {formatStage1Duration(suggestedSec)}
            </span>
            {suggestedReason && (
              <p className="text-xs text-slate-300 leading-relaxed break-words">{suggestedReason}</p>
            )}
            {manualDuration && currentSec !== suggestedSec && (
              <p className="text-[11px] text-sky-300 break-words">
                La duración está fijada a mano en {formatStage1Duration(currentSec)}; el diseño no la cambió.
              </p>
            )}
          </div>
          <button
            type="button"
            disabled={currentSec === suggestedSec}
            onClick={() => onApplyDuration(suggestedSec)}
            className={`px-3.5 py-2 rounded-xl text-xs font-black shrink-0 transition ${
              currentSec === suggestedSec
                ? 'bg-emerald-500 text-slate-950 cursor-default'
                : 'bg-amber-500 hover:bg-amber-400 text-slate-950 cursor-pointer'
            }`}
          >
            {currentSec === suggestedSec
              ? `✓ Duración activa: ${formatStage1Duration(suggestedSec)}`
              : `⚡ Aplicar ${formatStage1Duration(suggestedSec)}`}
          </button>
        </div>
      )}

      <div className="flex items-center justify-between flex-wrap gap-3 border-t border-slate-800 pt-3 min-w-0">
        <p className="text-[11px] text-slate-400 break-words max-w-2xl">
          Cuando el gancho, la escaleta y el clímax activos te gusten, pásalos a la comprobación: Gemini los revisa contra
          la investigación antes de escribir el guion.
        </p>
        <button
          type="button"
          disabled={busy || !designChosen || !hasDossier}
          onClick={onCheck}
          className="w-full sm:w-auto px-4 py-2.5 rounded-xl text-xs sm:text-sm font-black bg-emerald-500 hover:bg-emerald-400 disabled:opacity-50 disabled:cursor-not-allowed text-slate-950 cursor-pointer whitespace-normal"
        >
          ✅ Usar este diseño y comprobar
        </button>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------------------------------------------
// Paso 4 · Comprobación
// ---------------------------------------------------------------------------------------------------------------

function CheckList({ title, items, tone }: { title: string; items: string[]; tone: 'rose' | 'amber' | 'violet' }) {
  const toneClass =
    tone === 'rose'
      ? 'border-rose-500/40 text-rose-200'
      : tone === 'amber'
      ? 'border-amber-500/40 text-amber-200'
      : 'border-violet-500/40 text-violet-200';
  return (
    <div className={`bg-slate-900/80 border rounded-xl p-3 space-y-2 min-w-0 ${toneClass}`}>
      <div className="text-xs font-extrabold break-words">
        {title} ({items.length})
      </div>
      {items.length === 0 ? (
        <p className="text-[11px] text-emerald-300">✓ Nada que señalar</p>
      ) : (
        <ul className="space-y-1.5 list-disc pl-4">
          {items.map((it, idx) => (
            <li key={idx} className="text-[11px] leading-relaxed text-slate-200 break-words">
              {it}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

export function Stage1CheckPanel({
  doc,
  busy,
  running,
  onCheck,
  onSetDesign,
  referenceCount = 0,
}: {
  doc: Stage1Doc;
  busy: boolean;
  running: boolean;
  onCheck: () => void;
  onSetDesign: (patch: Record<string, string>) => void;
  /** @characters and places read from the check (section 5) */
  referenceCount?: number;
}) {
  const cfg = doc.promptConfig || {};
  const result = String(cfg[STAGE1_PASO4_RESULT_KEY] || '');
  const check = useMemo(() => parseStage1Check(result), [result]);
  const hasDossier = Boolean(txt(doc.deepResearchResult));
  const currentHook = String(cfg.PROPOSICION_GANCHO || cfg.ANGULO_CENTRAL || '');
  const currentEscaleta = String(cfg.PROPOSICION_ESCALETA || '');
  const currentClimax = String(cfg.PROPOSICION_CLIMAX || '');
  const designChosen = Boolean(txt(currentHook)) && Boolean(txt(currentEscaleta));
  const stale = Boolean(txt(result)) && isStale(cfg[STAGE1_PASO4_SOURCE_KEY], stage1Paso4SourceFingerprint(cfg));
  const corrections = [
    { label: 'Gancho corregido', value: check.correctedHook, current: currentHook },
    { label: 'Escaleta corregida', value: check.correctedEscaleta, current: currentEscaleta },
    { label: 'Clímax corregido', value: check.correctedClimax, current: currentClimax },
  ].filter((c) => txt(c.value));
  const correctionsApplied = corrections.length > 0 && corrections.every((c) => same(c.value, c.current));

  const applyCorrections = () => {
    const next = stage1DesignConfig(
      txt(check.correctedHook) ? check.correctedHook : currentHook,
      txt(check.correctedEscaleta) ? check.correctedEscaleta : currentEscaleta,
      txt(check.correctedClimax) ? check.correctedClimax : currentClimax
    );
    // The corrected design is the one this check asked for: it does not leave the check out of date
    onSetDesign({ ...next, [STAGE1_PASO4_SOURCE_KEY]: stage1Paso4SourceFingerprint({ ...cfg, ...next }) });
  };

  return (
    <div className="bg-slate-950/90 border-2 border-emerald-500/40 rounded-2xl p-3 sm:p-5 space-y-4 w-full max-w-full min-w-0 overflow-hidden">
      <div className="flex items-start justify-between flex-wrap gap-3 min-w-0">
        <div className="space-y-1 max-w-3xl min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="px-2.5 py-0.5 rounded-md bg-emerald-500/20 border border-emerald-400/50 text-emerald-200 text-xs font-black">
              PASO 4 DE ETAPA 1
            </span>
            <span className="px-2.5 py-0.5 rounded-md bg-slate-900 border border-slate-700 text-emerald-300 text-[11px] font-bold">
              ⚡ modelo Neon · SIN Deep Research
            </span>
          </div>
          <h4 className="font-extrabold text-slate-100 text-sm sm:text-base break-words">
            4º Comprobación del diseño contra la investigación
          </h4>
          <p className="text-xs text-slate-300 leading-relaxed break-words">
            Gemini señala lo que el diseño afirma <strong>sin fuente</strong>, lo que la investigación marca como{' '}
            <strong>(incierto)</strong> y el diseño cuenta como hecho, y los <strong>errores de otros videos</strong>{' '}
            que se repiten. Da un veredicto con los textos corregidos y la lista de <strong>@personajes y lugares</strong>.
          </p>
        </div>
        <button
          type="button"
          disabled={busy || !designChosen || !hasDossier}
          onClick={onCheck}
          className="w-full sm:w-auto max-w-full px-3.5 sm:px-5 py-2.5 sm:py-3 rounded-xl font-black text-xs sm:text-sm shadow-lg transition whitespace-normal text-left sm:text-center bg-gradient-to-r from-emerald-500 to-amber-400 hover:from-emerald-400 hover:to-amber-300 disabled:opacity-50 disabled:cursor-not-allowed text-slate-950 cursor-pointer"
        >
          {running ? 'Comprobando en Gemini...' : txt(result) ? '🔁 Volver a comprobar (Neon)' : '✅ Comprobar el diseño (Neon)'}
        </button>
      </div>

      {!txt(result) && (
        <div className="bg-slate-900/70 border border-slate-700 rounded-xl p-3 text-xs text-slate-300 break-words">
          {designChosen
            ? 'Pulsa "✅ Usar este diseño y comprobar" en el Paso 3 (o el botón de arriba) para revisar el diseño activo.'
            : 'Primero elige en el Paso 3 el gancho, la escaleta y el clímax.'}
        </div>
      )}
      {stale && (
        <div className="bg-rose-950/40 border border-rose-500/50 rounded-xl p-3 text-xs text-rose-200 break-words">
          ⚠️ El gancho, la escaleta o el clímax cambiaron después de esta comprobación. Vuelve a comprobar el diseño
          activo.
        </div>
      )}

      {txt(result) && (
        <div className="space-y-4 min-w-0">
          <div
            className={`rounded-xl border p-3 space-y-1 min-w-0 ${
              check.verdict === 'LISTO'
                ? 'bg-emerald-950/40 border-emerald-500/50'
                : check.verdict === 'CORREGIR'
                ? 'bg-amber-950/40 border-amber-500/50'
                : 'bg-slate-900/80 border-slate-700'
            }`}
          >
            <div className="text-sm font-black break-words">
              {check.verdict === 'LISTO' ? (
                <span className="text-emerald-300">✓ Veredicto: LISTO para el guion</span>
              ) : check.verdict === 'CORREGIR' ? (
                <span className="text-amber-300">✏️ Veredicto: CORREGIR antes del guion</span>
              ) : (
                <span className="text-slate-300">Veredicto: no se pudo leer</span>
              )}
            </div>
            {check.verdictReason && (
              <p className="text-xs text-slate-300 leading-relaxed break-words">{check.verdictReason}</p>
            )}
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-3 gap-3 min-w-0">
            <CheckList title="Afirmaciones sin fuente" items={check.noSource} tone="rose" />
            <CheckList title="Dudas contadas como hechos" items={check.uncertain} tone="amber" />
            <CheckList title="Errores repetidos de otros videos" items={check.repeatedErrors} tone="violet" />
          </div>

          {corrections.length > 0 && (
            <div className="bg-slate-900/80 border border-amber-500/40 rounded-xl p-3 sm:p-4 space-y-3 min-w-0">
              <div className="flex items-center justify-between flex-wrap gap-2">
                <div className="text-xs sm:text-sm font-extrabold text-amber-200">✏️ Textos corregidos por la comprobación</div>
                <button
                  type="button"
                  disabled={correctionsApplied}
                  onClick={applyCorrections}
                  className={`px-3.5 py-2 rounded-xl text-xs font-black transition ${
                    correctionsApplied
                      ? 'bg-emerald-500 text-slate-950 cursor-default'
                      : 'bg-amber-500 hover:bg-amber-400 text-slate-950 cursor-pointer'
                  }`}
                >
                  {correctionsApplied ? '✓ Correcciones aplicadas' : 'Aplicar las correcciones'}
                </button>
              </div>
              {corrections.map((c) => (
                <div key={c.label} className="space-y-1 min-w-0">
                  <div className="text-[11px] font-bold text-amber-300 flex items-center gap-2 flex-wrap">
                    {c.label}
                    {same(c.value, c.current) && <span className="text-emerald-300">✓ activo</span>}
                  </div>
                  <p className="text-xs text-slate-200 leading-relaxed break-words whitespace-pre-line">{c.value}</p>
                </div>
              ))}
            </div>
          )}

          {referenceCount > 0 && (
            <p className="text-[11px] text-emerald-300 break-words">
              🎭 {referenceCount} @personajes y lugares listos: se envían a la Etapa 4 con el botón de abajo.
            </p>
          )}
        </div>
      )}
    </div>
  );
}
