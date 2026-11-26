// Etapa 1 · Paso 1 — panel of complete proposals.
// The producer picks ONE proposal (topic + era and place + typology + climax come together) and, inside it,
// one of its hooks and one of its outlines. Pieces of different proposals can never be combined, because the
// hooks and outlines shown are only those of the chosen proposal. When Gemini first listed 10 topics, the
// producer marks here the ones to develop into complete proposals.
import React, { useEffect, useMemo, useState } from 'react';
import type { Stage1Proposal, Stage1ProposalSet, Stage1TopicIdeas } from '../utils/stage1Proposals';
import { splitProposalTimeAndPlace } from '../utils/stage1Proposals';

export const STAGE1_MAX_TOPICS_TO_DEVELOP = 5;

interface Props {
  proposalSet: Stage1ProposalSet;
  /** Number of the chosen proposal (0 = none yet) */
  selectedNumber: number;
  currentHook: string;
  currentEscaleta: string;
  currentClimax: string;
  /** Tema saved in the documentary (to warn when it was edited after choosing the proposal) */
  currentTopic: string;
  topicIdeas: Stage1TopicIdeas;
  pickedIdeas: string[];
  busy: boolean;
  durationBanner?: React.ReactNode;
  onSelectProposal: (proposal: Stage1Proposal) => void;
  onSelectHook: (text: string) => void;
  onSelectEscaleta: (text: string) => void;
  onEditText: (field: 'hook' | 'escaleta' | 'climax', text: string) => void;
  onDevelopIdeas: (ideas: string[]) => void;
  onAskNewIdeas: () => void;
  onReextract: () => void;
}

const same = (a: string, b: string) => String(a || '').trim() === String(b || '').trim();

/** A text box that saves when the producer leaves it (not on every key). */
export function EditOnBlur({ label, value, onCommit }: { label: string; value: string; onCommit: (v: string) => void }) {
  const [draft, setDraft] = useState(value);
  useEffect(() => setDraft(value), [value]);
  return (
    <label className="block space-y-1 min-w-0">
      <span className="text-[11px] font-bold text-amber-200">{label}</span>
      <textarea
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={() => {
          if (!same(draft, value)) onCommit(draft.trim());
        }}
        rows={3}
        className="w-full max-w-full min-w-0 bg-slate-950 border border-slate-700 focus:border-amber-400 rounded-lg px-3 py-2 text-xs text-slate-100 leading-relaxed"
      />
    </label>
  );
}

export function VariantList({
  title,
  noun,
  variants,
  current,
  recommendedIdx,
  reason,
  onPick,
  badge = '🔗 Escritos para esta propuesta',
}: {
  title: string;
  noun: string;
  variants: string[];
  current: string;
  recommendedIdx: number;
  reason: string;
  onPick: (text: string) => void;
  /** Badge next to the title (the Paso 3 design uses its own) */
  badge?: string;
}) {
  if (variants.length === 0) return null;
  const editedByHand = Boolean(String(current || '').trim()) && !variants.some((v) => same(v, current));
  return (
    <div className="space-y-2 min-w-0">
      <div className="flex items-center justify-between flex-wrap gap-2">
        <div className="text-xs sm:text-sm font-extrabold text-amber-200 break-words">{title}</div>
        <span className="text-[10px] px-2 py-0.5 rounded-md bg-amber-500/15 border border-amber-500/40 text-amber-300 font-bold">
          {badge}
        </span>
      </div>
      {reason && (
        <p className="text-[11px] text-amber-200 break-words">
          <strong className="text-amber-300">⭐ Recomendado por Gemini:</strong> {reason}
        </p>
      )}
      {editedByHand && (
        <p className="text-[11px] text-sky-300 break-words">
          ✏️ El texto activo fue editado a mano; pulsa una variante para volver a ella.
        </p>
      )}
      <div className="grid grid-cols-1 lg:grid-cols-2 xl:grid-cols-3 gap-2.5 min-w-0">
        {variants.map((text, idx) => {
          const isSelected = same(text, current);
          return (
            <button
              key={idx}
              type="button"
              onClick={() => onPick(text)}
              className={`text-left p-3 rounded-xl border transition cursor-pointer min-w-0 max-w-full break-words space-y-1.5 ${
                isSelected
                  ? 'bg-emerald-500/15 border-emerald-400 text-slate-100 shadow-md shadow-emerald-500/10'
                  : 'bg-slate-950/90 hover:bg-slate-900 border-slate-800 text-slate-300'
              }`}
            >
              <div className="flex items-center justify-between gap-1 flex-wrap">
                <span
                  className={`text-[11px] font-black px-2 py-0.5 rounded-md ${
                    isSelected ? 'bg-emerald-400 text-slate-950' : 'bg-slate-800 text-amber-300'
                  }`}
                >
                  {noun} {idx + 1}
                </span>
                {idx === recommendedIdx && <span className="text-[10px] font-bold text-amber-300">⭐ Recomendado</span>}
                {isSelected && <span className="text-[10px] font-bold text-emerald-300">✓ Activo en Documental</span>}
              </div>
              <p className="text-xs leading-relaxed break-words whitespace-pre-line">{text}</p>
            </button>
          );
        })}
      </div>
    </div>
  );
}

export default function Stage1ProposalsPanel({
  proposalSet,
  selectedNumber,
  currentHook,
  currentEscaleta,
  currentClimax,
  currentTopic,
  topicIdeas,
  pickedIdeas,
  busy,
  durationBanner,
  onSelectProposal,
  onSelectHook,
  onSelectEscaleta,
  onEditText,
  onDevelopIdeas,
  onAskNewIdeas,
  onReextract,
}: Props) {
  const proposals = proposalSet.proposals;
  const hasProposals = proposals.length > 0;
  const hasIdeas = topicIdeas.ideas.length > 0;
  const selected = proposals.find((p) => p.number === selectedNumber) || null;
  // Since the restructure, Paso 1 only proposes the topic; hooks, outline and climax are written in Paso 3
  // with the research done. Older documentaries keep their hooks and outlines inside each proposal.
  const proposalsCarryDesign = proposals.some((p) => p.hooks.length > 0 || p.escaletas.length > 0);
  const selectedCarriesDesign = Boolean(selected && (selected.hooks.length > 0 || selected.escaletas.length > 0));

  const pickedKey = pickedIdeas.join('\u0001');
  const ideasKey = topicIdeas.ideas.join('\u0001');
  const [marked, setMarked] = useState<string[]>(pickedIdeas);
  useEffect(() => {
    setMarked(pickedIdeas.filter((t) => topicIdeas.ideas.includes(t)));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pickedKey, ideasKey]);
  const [ideasOpen, setIdeasOpen] = useState(!hasProposals);
  useEffect(() => {
    if (!hasProposals) setIdeasOpen(true);
  }, [hasProposals]);
  const [editOpen, setEditOpen] = useState(false);

  const recommendedIdeaSet = useMemo(() => new Set(topicIdeas.recommended), [topicIdeas.recommended]);
  const toggleIdea = (idea: string) =>
    setMarked((prev) =>
      prev.includes(idea)
        ? prev.filter((t) => t !== idea)
        : prev.length >= STAGE1_MAX_TOPICS_TO_DEVELOP
        ? prev
        : [...prev, idea]
    );
  // Sent in the order of Gemini's list, not in the order they were clicked
  const markedInOrder = topicIdeas.ideas.filter((t) => marked.includes(t));
  const developLabel =
    markedInOrder.length === 0
      ? 'Marca los temas que quieres desarrollar'
      : markedInOrder.length === 1
      ? '⚡ Desarrollar este tema en 4 ángulos'
      : markedInOrder.length === 2
      ? '⚡ Desarrollar estos 2 temas (2 propuestas de cada uno)'
      : `⚡ Desarrollar estos ${markedInOrder.length} temas en propuestas completas`;

  return (
    <div className="bg-gradient-to-b from-emerald-950/25 via-slate-950/95 to-slate-950/95 border-2 border-emerald-500/40 rounded-2xl p-3 sm:p-5 space-y-4 shadow-xl w-full max-w-full min-w-0 overflow-hidden">
      <div className="flex items-start justify-between flex-wrap gap-3 border-b border-slate-800/90 pb-3 min-w-0">
        <div className="space-y-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="px-2.5 py-0.5 rounded-full bg-emerald-500/20 border border-emerald-500/40 text-emerald-300 text-[11px] font-black">
              {hasProposals ? '✓ Paso 1 Determinado · Propuesta Aplicada' : '① Paso 1 · Elige los temas a desarrollar'}
            </span>
            <h4 className="text-sm sm:text-base font-black text-amber-300 break-words">
              {hasProposals ? '📋 Propuestas Completas para Nuestro Documental' : '📋 Temas Propuestos para Nuestro Documental'}
            </h4>
          </div>
          <p className="text-xs text-slate-300 break-words">
            {hasProposals ? (
              <>
                {proposalsCarryDesign ? (
                  <>
                    Cada propuesta es un documental entero: <strong>tema, tiempo y lugar, tipología y clímax</strong>{' '}
                    van juntos. Elige <strong>una propuesta</strong> y, dentro de ella, su <strong>gancho</strong> y su{' '}
                    <strong>escaleta</strong>; así nunca se mezclan piezas que no encajan. Gemini deja marcada con ⭐ la
                    que recomienda.
                  </>
                ) : (
                  <>
                    Cada propuesta trae <strong>tema, tiempo y lugar, tipología</strong> y su{' '}
                    <strong>prueba de fuentes</strong>. Elige <strong>una</strong> para investigarla en el Paso 2; el
                    gancho, la escaleta y el clímax se escriben en el Paso 3, ya con la investigación hecha. Gemini deja
                    marcada con ⭐ la que recomienda.
                  </>
                )}
              </>
            ) : (
              <>
                Gemini propuso estos temas a partir de los videos marcados. Marca los que te interesen (hasta{' '}
                {STAGE1_MAX_TOPICS_TO_DEVELOP}) y pídele que los desarrolle en propuestas completas.
              </>
            )}
          </p>
        </div>
        {hasProposals && (
          <button
            type="button"
            onClick={onReextract}
            className="px-3 py-1.5 rounded-xl bg-slate-900 hover:bg-slate-800 border border-emerald-500/40 text-emerald-300 text-xs font-bold cursor-pointer shrink-0"
          >
            🔄 Re-Extraer Propuestas del Paso 1
          </button>
        )}
      </div>

      {hasProposals && durationBanner}

      {hasIdeas && (
        <div className="bg-slate-900/80 border border-slate-800 rounded-xl p-3 sm:p-4 space-y-3 min-w-0">
          <button
            type="button"
            onClick={() => setIdeasOpen((v) => !v)}
            className="w-full flex items-center justify-between gap-2 text-left cursor-pointer min-w-0"
          >
            <span className="text-xs sm:text-sm font-extrabold text-amber-200 break-words">
              {ideasOpen ? '▾' : '▸'} Temas propuestos por Gemini ({topicIdeas.ideas.length})
              {hasProposals ? ' · desarrollar otros' : ''}
            </span>
            <span className="text-[10px] px-2 py-0.5 rounded-md bg-slate-950 border border-slate-700 text-emerald-300 font-semibold shrink-0">
              {marked.length} marcados
            </span>
          </button>
          {ideasOpen && (
            <>
              {topicIdeas.recommended.length > 0 && topicIdeas.recommendedReason && (
                <p className="text-[11px] text-amber-200 break-words">
                  <strong className="text-amber-300">⭐ Recomendados por Gemini:</strong> {topicIdeas.recommendedReason}
                </p>
              )}
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-2 min-w-0">
                {topicIdeas.ideas.map((idea, idx) => {
                  const isMarked = marked.includes(idea);
                  const isFull = !isMarked && marked.length >= STAGE1_MAX_TOPICS_TO_DEVELOP;
                  return (
                    <button
                      key={idx}
                      type="button"
                      disabled={isFull}
                      onClick={() => toggleIdea(idea)}
                      className={`text-left p-2.5 rounded-xl border transition min-w-0 max-w-full break-words flex items-start gap-2 ${
                        isMarked
                          ? 'bg-emerald-500/15 border-emerald-400 text-slate-100 cursor-pointer'
                          : isFull
                          ? 'bg-slate-950/60 border-slate-800 text-slate-500 cursor-not-allowed'
                          : 'bg-slate-950/90 hover:bg-slate-900 border-slate-800 text-slate-300 cursor-pointer'
                      }`}
                    >
                      <span
                        className={`mt-0.5 w-4 h-4 shrink-0 rounded border flex items-center justify-center text-[10px] font-black ${
                          isMarked ? 'bg-emerald-400 border-emerald-400 text-slate-950' : 'border-slate-600 text-transparent'
                        }`}
                      >
                        ✓
                      </span>
                      <span className="min-w-0 space-y-0.5">
                        <span className="flex items-center gap-1.5 flex-wrap">
                          <span className="text-[11px] font-black text-amber-300">Tema {idx + 1}</span>
                          {recommendedIdeaSet.has(idx) && (
                            <span className="text-[10px] font-bold text-amber-300">⭐ Recomendado</span>
                          )}
                        </span>
                        <span className="block text-xs leading-relaxed break-words">{idea}</span>
                      </span>
                    </button>
                  );
                })}
              </div>
              <div className="flex items-center gap-2 flex-wrap">
                <button
                  type="button"
                  disabled={busy || markedInOrder.length === 0}
                  onClick={() => onDevelopIdeas(markedInOrder)}
                  className="w-full sm:w-auto px-3.5 py-2 rounded-xl text-xs font-black bg-gradient-to-r from-amber-500 to-yellow-400 hover:from-amber-400 hover:to-yellow-300 disabled:opacity-50 disabled:cursor-not-allowed text-slate-950 cursor-pointer whitespace-normal text-left sm:text-center"
                >
                  {busy ? 'Procesando en Gemini...' : developLabel}
                </button>
                <button
                  type="button"
                  disabled={busy}
                  onClick={onAskNewIdeas}
                  className="w-full sm:w-auto px-3 py-2 rounded-xl text-xs font-bold bg-slate-900 hover:bg-slate-800 border border-slate-700 text-slate-200 disabled:opacity-50 cursor-pointer"
                >
                  🔁 Pedir otros 10 temas
                </button>
              </div>
            </>
          )}
        </div>
      )}

      {hasProposals && (
        <>
          {proposalSet.recommendedNumber > 0 && proposalSet.recommendedReason && (
            <div className="bg-slate-950/70 border border-slate-800/80 rounded-lg px-3 py-2 text-xs text-amber-200 leading-relaxed break-words">
              <strong className="text-amber-300">⭐ Gemini recomienda la Propuesta {proposalSet.recommendedNumber}:</strong>{' '}
              {proposalSet.recommendedReason}
            </div>
          )}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-3 min-w-0 max-w-full">
            {proposals.map((p) => {
              const isSelected = p.number === selectedNumber;
              const tp = splitProposalTimeAndPlace(p.timeAndPlace);
              return (
                <div
                  key={p.number}
                  className={`rounded-xl border p-3 sm:p-4 space-y-2.5 min-w-0 max-w-full break-words flex flex-col ${
                    isSelected
                      ? 'bg-emerald-500/10 border-emerald-400 shadow-md shadow-emerald-500/10'
                      : 'bg-slate-900/80 border-slate-800'
                  }`}
                >
                  <div className="flex items-center justify-between gap-1.5 flex-wrap">
                    <span
                      className={`text-[11px] font-black px-2 py-0.5 rounded-md ${
                        isSelected ? 'bg-emerald-400 text-slate-950' : 'bg-slate-800 text-amber-300'
                      }`}
                    >
                      Propuesta {p.number}
                    </span>
                    <span className="flex items-center gap-2 flex-wrap">
                      {p.number === proposalSet.recommendedNumber && (
                        <span className="text-[10px] font-bold text-amber-300">⭐ Recomendada</span>
                      )}
                      {isSelected && <span className="text-[10px] font-bold text-emerald-300">✓ Elegida</span>}
                    </span>
                  </div>
                  {p.title && <div className="text-sm font-extrabold text-amber-200 break-words">{p.title}</div>}
                  <dl className="space-y-1.5 text-xs leading-relaxed text-slate-300 min-w-0 flex-1">
                    <div>
                      <dt className="inline font-bold text-emerald-300">Tema: </dt>
                      <dd className="inline break-words">{p.topic}</dd>
                    </div>
                    {(tp.time || tp.place) && (
                      <div>
                        <dt className="inline font-bold text-emerald-300">Tiempo y lugar: </dt>
                        <dd className="inline break-words">{[tp.time, tp.place].filter(Boolean).join(' · ')}</dd>
                      </div>
                    )}
                    {p.typology && (
                      <div>
                        <dt className="inline font-bold text-emerald-300">Tipología: </dt>
                        <dd className="inline break-words">{p.typology}</dd>
                      </div>
                    )}
                    {p.climax && (
                      <div>
                        <dt className="inline font-bold text-emerald-300">Clímax y cierre: </dt>
                        <dd className="inline break-words">{p.climax}</dd>
                      </div>
                    )}
                    {p.why && (
                      <div className="text-amber-200">
                        <dt className="inline font-bold text-amber-300">Por qué funciona: </dt>
                        <dd className="inline break-words">{p.why}</dd>
                      </div>
                    )}
                    {p.sources && (
                      <div className="text-sky-200">
                        <dt className="inline font-bold text-sky-300">📚 Prueba de fuentes: </dt>
                        <dd className="inline break-words">{p.sources}</dd>
                      </div>
                    )}
                  </dl>
                  <div className="flex items-center justify-between gap-2 flex-wrap pt-1">
                    <span className="text-[10px] text-slate-400">
                      {p.hooks.length > 0 || p.escaletas.length > 0
                        ? `${p.hooks.length} ganchos · ${p.escaletas.length} escaletas`
                        : 'Gancho y escaleta: en el Paso 3'}
                    </span>
                    <button
                      type="button"
                      disabled={isSelected}
                      onClick={() => onSelectProposal(p)}
                      className={`px-3 py-1.5 rounded-xl text-xs font-black transition ${
                        isSelected
                          ? 'bg-emerald-500 text-slate-950 cursor-default'
                          : 'bg-amber-500 hover:bg-amber-400 text-slate-950 cursor-pointer'
                      }`}
                    >
                      {isSelected ? '✓ Activa en Documental' : 'Elegir esta propuesta'}
                    </button>
                  </div>
                </div>
              );
            })}
          </div>

          {selected && !selectedCarriesDesign ? (
            <div className="bg-slate-900/80 border border-emerald-500/40 rounded-xl p-3 sm:p-4 space-y-2 min-w-0 max-w-full">
              <div className="text-xs sm:text-sm font-black text-emerald-300 break-words">
                ✓ Propuesta {selected.number}
                {selected.title ? ` — ${selected.title}` : ''} aplicada al documental
              </div>
              {Boolean(currentTopic.trim()) && !same(currentTopic, selected.topic) && (
                <p className="text-[11px] text-sky-300 break-words">
                  ✏️ El Tema del documental fue editado a mano después de elegir esta propuesta.
                </p>
              )}
              <p className="text-[11px] text-slate-300 break-words">
                Siguiente: el <strong>Paso 2</strong> investiga este tema a fondo. El gancho, la escaleta y el clímax
                se escriben después, en el <strong>Paso 3</strong>, con lo que la investigación encuentre.
              </p>
            </div>
          ) : selected ? (
            <div className="bg-slate-900/80 border border-emerald-500/40 rounded-xl p-3 sm:p-4 space-y-4 min-w-0 max-w-full overflow-hidden">
              <div className="text-xs sm:text-sm font-black text-emerald-300 break-words">
                Propuesta {selected.number}
                {selected.title ? ` — ${selected.title}` : ''}: elige su gancho y su escaleta
              </div>
              {Boolean(currentTopic.trim()) && !same(currentTopic, selected.topic) && (
                <p className="text-[11px] text-sky-300 break-words">
                  ✏️ El Tema del documental fue editado a mano después de elegir esta propuesta.
                </p>
              )}
              <VariantList
                title={`Apertura y gancho (Clip 1) · ${selected.hooks.length} variantes`}
                noun="Gancho"
                variants={selected.hooks}
                current={currentHook}
                recommendedIdx={selected.recommendedHook}
                reason={selected.hookReason}
                onPick={onSelectHook}
              />
              <VariantList
                title={`Escaleta por actos · ${selected.escaletas.length} variantes`}
                noun="Escaleta"
                variants={selected.escaletas}
                current={currentEscaleta}
                recommendedIdx={selected.recommendedEscaleta}
                reason={selected.escaletaReason}
                onPick={onSelectEscaleta}
              />
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
                    <p className="text-[11px] text-slate-400 break-words">
                      El Tema, el Tiempo, el Lugar y la Tipología se editan arriba, en 🏛️ Definición Histórica y
                      Continuidad. Los cambios se guardan al salir de cada caja.
                    </p>
                    <EditOnBlur label="Gancho activo" value={currentHook} onCommit={(v) => onEditText('hook', v)} />
                    <EditOnBlur
                      label="Escaleta activa"
                      value={currentEscaleta}
                      onCommit={(v) => onEditText('escaleta', v)}
                    />
                    <EditOnBlur
                      label="Clímax y cierre activo"
                      value={currentClimax}
                      onCommit={(v) => onEditText('climax', v)}
                    />
                  </div>
                )}
              </div>
            </div>
          ) : (
            <div className="bg-slate-900/70 border border-amber-500/40 rounded-xl p-3 text-xs text-amber-200">
              {proposalsCarryDesign
                ? 'Elige una propuesta para ver sus ganchos y sus escaletas.'
                : 'Elige una propuesta para investigarla en el Paso 2.'}
            </div>
          )}
        </>
      )}
    </div>
  );
}
