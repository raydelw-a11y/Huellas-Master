import React, { useMemo, useState } from 'react';
import {
  DOC_GRAPHIC_DEFAULT_DURATION,
  DOC_GRAPHIC_KIND_LABEL,
  detectDateCardSuggestions,
  findQuoteInCaptions,
  graphicEndSec,
  newDocGraphicId,
  parseResearchScreenQuotes,
  type DateCardGraphic,
  type DocGraphic,
  type QuoteCardGraphic,
  type RouteMapGraphic,
  type TimedCaptionLike,
} from '../utils/docGraphics';

// Inspector tab "Gráficos" of the editor: date / place cards, source quote cards and routes over maps.

export interface DocGraphicsPanelProps {
  graphics: DocGraphic[];
  onChange: (next: DocGraphic[]) => void;
  currentTime: number;
  onSeek: (t: number) => void;
  aspect: '16:9' | '9:16';
  captions: TimedCaptionLike[];
  researchText: string;
  /** Dates spoken before this second are already on screen in the Clip 1 hook. */
  skipBeforeSec: number;
  selectedId: string | null;
  onSelect: (id: string | null) => void;
  routeCaptureId: string | null;
  onRouteCaptureChange: (id: string | null) => void;
  /** Ask Gemini Web (free, through the extension) to place the route on its map clip. */
  onLocateRoute?: (route: RouteMapGraphic) => void;
}

const fmt = (sec: number) => {
  const s = Math.max(0, sec);
  const m = Math.floor(s / 60);
  const r = s - m * 60;
  return `${String(m).padStart(2, '0')}:${r.toFixed(1).padStart(4, '0')}`;
};

const KIND_ICON: Record<DocGraphic['kind'], string> = {
  date_card: '📅',
  quote_card: '📜',
  route_map: '🗺️',
};

const summaryOf = (g: DocGraphic) =>
  g.kind === 'date_card'
    ? [g.line1, g.line2].filter(Boolean).join(' · ')
    : g.kind === 'quote_card'
    ? `«${g.quote.slice(0, 60)}${g.quote.length > 60 ? '…' : ''}»`
    : `${g.points.length} punto${g.points.length === 1 ? '' : 's'}${g.label ? ` → ${g.label}` : ''} (solo ${g.aspect})`;

const inputCls =
  'w-full bg-slate-950 border border-slate-700 rounded-md px-2 py-1 text-[11px] text-slate-100 focus:outline-none focus:border-amber-500';
const btnCls =
  'px-2 py-1 rounded-md text-[10px] font-bold cursor-pointer border border-slate-700 bg-slate-900 text-slate-200 hover:border-amber-500 hover:text-amber-300 disabled:opacity-40 disabled:cursor-not-allowed';

export default function DocGraphicsPanel(props: DocGraphicsPanelProps) {
  const {
    graphics,
    onChange,
    currentTime,
    onSeek,
    aspect,
    captions,
    researchText,
    skipBeforeSec,
    selectedId,
    onSelect,
    routeCaptureId,
    onRouteCaptureChange,
    onLocateRoute,
  } = props;
  const [notice, setNotice] = useState('');
  const sorted = useMemo(() => [...graphics].sort((a, b) => a.startSec - b.startSec), [graphics]);
  const selected = graphics.find((g) => g.id === selectedId) || null;
  const researchQuotes = useMemo(() => parseResearchScreenQuotes(researchText), [researchText]);

  // A time set by hand frees the graphic from what it followed (its map clip or the words of the narration)
  const unanchor = (g: DocGraphic): Partial<DocGraphic> =>
    g.kind === 'route_map' ? { anchorClip: false } : ({ anchorSpoken: undefined } as Partial<DocGraphic>);

  const replace = (id: string, patch: Partial<DocGraphic>) =>
    onChange(graphics.map((g) => (g.id === id ? ({ ...g, ...patch } as DocGraphic) : g)));

  const add = (g: DocGraphic) => {
    onChange([...graphics, g]);
    onSelect(g.id);
  };

  const at = Math.max(0, Number(currentTime.toFixed(2)));

  const addDate = () =>
    add({
      id: newDocGraphicId('date_card'),
      kind: 'date_card',
      startSec: at,
      durationSec: DOC_GRAPHIC_DEFAULT_DURATION.date_card,
      line1: '',
      line2: '',
      position: 'center',
    });
  const addQuote = (quote = '', source = '', startSec = at, durationSec = DOC_GRAPHIC_DEFAULT_DURATION.quote_card) =>
    add({
      id: newDocGraphicId('quote_card'),
      kind: 'quote_card',
      startSec,
      durationSec,
      quote,
      highlight: '',
      source,
      side: 'right',
    });
  const addRoute = () => {
    const g: RouteMapGraphic = {
      id: newDocGraphicId('route_map'),
      kind: 'route_map',
      startSec: at,
      durationSec: DOC_GRAPHIC_DEFAULT_DURATION.route_map,
      aspect,
      points: [],
      icon: 'ship',
      label: '',
    };
    add(g);
    onRouteCaptureChange(g.id);
  };

  const detectDates = () => {
    const found = detectDateCardSuggestions(captions, { skipBeforeSec });
    const existing = graphics.filter((g) => g.kind === 'date_card');
    const fresh = found.filter((f) => !existing.some((g) => Math.abs(g.startSec - f.startSec) < 3));
    if (fresh.length === 0) {
      setNotice(
        captions.length === 0
          ? 'No hay subtítulos con tiempos todavía: genera o alinea los subtítulos y vuelve a buscar.'
          : found.length === 0
          ? 'No encontré fechas ni años dichos en la narración.'
          : 'Las fechas encontradas ya tienen su tarjeta.'
      );
      return;
    }
    const cards: DateCardGraphic[] = fresh.map((f) => ({
      id: newDocGraphicId('date_card'),
      kind: 'date_card',
      startSec: f.startSec,
      durationSec: DOC_GRAPHIC_DEFAULT_DURATION.date_card,
      line1: f.line1,
      line2: f.line2,
      position: 'center',
    }));
    onChange([...graphics, ...cards]);
    setNotice(`Añadí ${cards.length} tarjeta${cards.length === 1 ? '' : 's'} de fecha. Revísalas en la lista: puedes editarlas o borrarlas.`);
  };

  const quoteRows = researchQuotes.map((q) => {
    const hit = findQuoteInCaptions(q.quote, captions);
    const added = graphics.some((g) => g.kind === 'quote_card' && g.quote.trim() === q.quote.trim());
    return { ...q, hit, added };
  });

  return (
    <div className="flex flex-col gap-3 text-xs flex-1 min-h-0 overflow-y-auto pr-1">
      <div className="bg-slate-950/90 border border-slate-800 rounded-xl p-3 flex flex-col gap-2">
        <div className="text-[11px] font-bold text-amber-300">🗺️ Gráficos del documental</div>
        <div className="text-[10px] text-slate-400 leading-snug">
          Se crean solas: las fechas que dice el narrador, las citas de la investigación que se narran y la ruta del mapa
          de la Etapa 8 (en cuanto su clip llega de Flow). Lo que borres no vuelve. También puedes añadirlas a mano.
        </div>
        <div className="grid grid-cols-3 gap-1 whitespace-nowrap">
          <button type="button" className={btnCls} onClick={addDate} title="Tarjeta de fecha y lugar en el cursor">
            ＋ Fecha
          </button>
          <button type="button" className={btnCls} onClick={() => addQuote()} title="Cita de una fuente en el cursor">
            ＋ Cita
          </button>
          <button
            type="button"
            className={btnCls}
            onClick={addRoute}
            title="Ruta animada en el cursor: luego marca los puntos haciendo clic sobre el mapa en el visor"
          >
            ＋ Ruta
          </button>
        </div>
        <button type="button" className={btnCls} onClick={detectDates} title="Busca en los subtítulos fechas y años dichos por el narrador">
          🔎 Buscar fechas en la narración
        </button>
        {notice && <div className="text-[10px] text-emerald-300 leading-snug">{notice}</div>}
      </div>

      <div className="bg-slate-950/90 border border-slate-800 rounded-xl p-3 flex flex-col gap-2">
        <div className="text-[11px] font-bold text-slate-200">📜 Citas de la investigación</div>
        {quoteRows.length === 0 ? (
          <div className="text-[10px] text-slate-500 leading-snug">
            La investigación de este documental no trae la lista «CITAS PARA PANTALLA» (la piden las investigaciones nuevas).
            Puedes añadir una cita a mano con ＋ Cita.
          </div>
        ) : (
          quoteRows.map((q, i) => (
            <div key={i} className="border border-slate-800 rounded-lg p-2 flex flex-col gap-1">
              <div className="text-[10px] text-slate-200 leading-snug">«{q.quote}»</div>
              <div className="text-[9px] text-slate-500">— {q.source}</div>
              <div className="flex items-center justify-between gap-2">
                <span className="text-[9px] text-slate-400">
                  {q.hit ? `Se narra en ${fmt(q.hit.startSec)}` : 'No se narra: irá en el cursor'}
                </span>
                <button
                  type="button"
                  className={btnCls}
                  disabled={q.added}
                  onClick={() => {
                    const start = q.hit ? Math.max(0, q.hit.startSec - 0.2) : at;
                    const dur = q.hit
                      ? Math.min(12, Math.max(5, q.hit.endSec - q.hit.startSec + 1.8))
                      : DOC_GRAPHIC_DEFAULT_DURATION.quote_card;
                    addQuote(q.quote, q.source, Number(start.toFixed(2)), Number(dur.toFixed(1)));
                    if (q.hit) onSeek(start + 1.5);
                  }}
                >
                  {q.added ? 'Añadida' : 'Añadir'}
                </button>
              </div>
            </div>
          ))
        )}
      </div>

      <div className="bg-slate-950/90 border border-slate-800 rounded-xl p-3 flex flex-col gap-1">
        <div className="text-[11px] font-bold text-slate-200">Lista ({sorted.length})</div>
        {sorted.length === 0 && <div className="text-[10px] text-slate-500">Todavía no hay gráficos.</div>}
        {sorted.map((g) => (
          <div
            key={g.id}
            className={`flex items-center gap-2 rounded-md px-2 py-1 cursor-pointer border ${
              g.id === selectedId ? 'border-amber-500 bg-amber-500/10' : 'border-transparent hover:bg-slate-800/60'
            }`}
            onClick={() => {
              onSelect(g.id);
              onSeek(g.kind === 'route_map' ? g.startSec + 0.5 : g.startSec + Math.min(1.5, g.durationSec / 2));
            }}
          >
            <span className="text-[10px] font-mono text-slate-400 shrink-0">{fmt(g.startSec)}</span>
            <span className="shrink-0">{KIND_ICON[g.kind]}</span>
            <span className={`text-[10px] truncate flex-1 ${g.kind === 'route_map' && g.aspect !== aspect ? 'text-slate-500' : 'text-slate-200'}`}>
              {summaryOf(g) || DOC_GRAPHIC_KIND_LABEL[g.kind]}
            </span>
            <button
              type="button"
              className="text-slate-500 hover:text-red-400 text-[11px] px-1 cursor-pointer"
              title="Borrar este gráfico"
              onClick={(e) => {
                e.stopPropagation();
                if (routeCaptureId === g.id) onRouteCaptureChange(null);
                if (selectedId === g.id) onSelect(null);
                onChange(graphics.filter((x) => x.id !== g.id));
              }}
            >
              ✕
            </button>
          </div>
        ))}
      </div>

      {selected && (
        <div className="bg-slate-950/90 border border-amber-700/60 rounded-xl p-3 flex flex-col gap-2">
          <div className="text-[11px] font-bold text-amber-300">
            {KIND_ICON[selected.kind]} {DOC_GRAPHIC_KIND_LABEL[selected.kind]}
          </div>
          <div className="grid grid-cols-2 gap-2">
            <label className="flex flex-col gap-0.5 text-[10px] text-slate-400">
              Empieza (s)
              <input
                type="number"
                step={0.1}
                min={0}
                className={inputCls}
                value={Number(selected.startSec.toFixed(2))}
                onChange={(e) =>
                  replace(selected.id, { startSec: Math.max(0, Number(e.target.value) || 0), ...unanchor(selected) })
                }
              />
            </label>
            <label className="flex flex-col gap-0.5 text-[10px] text-slate-400">
              Dura (s)
              <input
                type="number"
                step={0.1}
                min={1}
                max={60}
                className={inputCls}
                value={Number(selected.durationSec.toFixed(2))}
                onChange={(e) =>
                  replace(selected.id, {
                    durationSec: Math.max(1, Math.min(60, Number(e.target.value) || 1)),
                    ...unanchor(selected),
                  })
                }
              />
            </label>
          </div>
          <div className="flex gap-1">
            <button
              type="button"
              className={btnCls}
              onClick={() => replace(selected.id, { startSec: at, ...unanchor(selected) })}
            >
              ⏱ Empezar en el cursor ({fmt(at)})
            </button>
            <button type="button" className={btnCls} onClick={() => onSeek(selected.startSec)}>
              ▶ Ir al inicio
            </button>
          </div>
          <div className="text-[9px] text-slate-500">Termina en {fmt(graphicEndSec(selected))}</div>

          {selected.kind === 'date_card' && (
            <>
              <label className="flex flex-col gap-0.5 text-[10px] text-slate-400">
                Línea grande (fecha)
                <input
                  className={inputCls}
                  value={selected.line1}
                  placeholder="29 de septiembre de 1513"
                  onChange={(e) => replace(selected.id, { line1: e.target.value })}
                />
              </label>
              <label className="flex flex-col gap-0.5 text-[10px] text-slate-400">
                Línea pequeña (lugar, opcional)
                <input
                  className={inputCls}
                  value={selected.line2 || ''}
                  placeholder="Darién, Panamá"
                  onChange={(e) => replace(selected.id, { line2: e.target.value })}
                />
              </label>
              <label className="flex flex-col gap-0.5 text-[10px] text-slate-400">
                Posición
                <select
                  className={inputCls}
                  value={selected.position || 'center'}
                  onChange={(e) => replace(selected.id, { position: e.target.value as DateCardGraphic['position'] })}
                >
                  <option value="center">Centro</option>
                  <option value="lower_left">Abajo a la izquierda</option>
                </select>
              </label>
            </>
          )}

          {selected.kind === 'quote_card' && (
            <>
              <label className="flex flex-col gap-0.5 text-[10px] text-slate-400">
                Cita exacta
                <textarea
                  className={`${inputCls} min-h-[70px]`}
                  value={selected.quote}
                  placeholder="Copiada palabra por palabra de la fuente"
                  onChange={(e) => replace(selected.id, { quote: e.target.value })}
                />
              </label>
              <label className="flex flex-col gap-0.5 text-[10px] text-slate-400">
                Frase subrayada (vacío = toda la cita)
                <input
                  className={inputCls}
                  value={selected.highlight || ''}
                  onChange={(e) => replace(selected.id, { highlight: e.target.value })}
                />
              </label>
              {selected.highlight &&
                !selected.quote
                  .toLocaleLowerCase('es-ES')
                  .includes(String(selected.highlight).toLocaleLowerCase('es-ES').trim()) && (
                  <div className="text-[9px] text-amber-400">
                    Esa frase no está dentro de la cita: se subrayará la cita entera.
                  </div>
                )}
              <label className="flex flex-col gap-0.5 text-[10px] text-slate-400">
                Fuente (autor, obra, año)
                <input
                  className={inputCls}
                  value={selected.source}
                  placeholder="Gonzalo Fernández de Oviedo, Historia general de las Indias, 1535"
                  onChange={(e) => replace(selected.id, { source: e.target.value })}
                />
              </label>
              {aspect === '16:9' && (
                <label className="flex flex-col gap-0.5 text-[10px] text-slate-400">
                  Lado de la pantalla
                  <select
                    className={inputCls}
                    value={selected.side || 'right'}
                    onChange={(e) => replace(selected.id, { side: e.target.value as QuoteCardGraphic['side'] })}
                  >
                    <option value="right">Derecha</option>
                    <option value="left">Izquierda</option>
                    <option value="center">Centro</option>
                  </select>
                </label>
              )}
            </>
          )}

          {selected.kind === 'route_map' && (
            <>
              {selected.aspect !== aspect && (
                <div className="text-[10px] text-amber-400 leading-snug">
                  Esta ruta se marcó en formato {selected.aspect} y solo aparece en ese formato.
                </div>
              )}
              {selected.places && selected.places.length >= 2 && (
                <div className="flex flex-col gap-1 border border-slate-800 rounded-lg p-2">
                  <div className="text-[10px] text-slate-300 leading-snug">
                    Viaje de la Etapa 8 (clip {selected.clipNumber}): {selected.places.join(' → ')}
                    {selected.anchorClip ? ' · sigue a su clip del mapa' : ''}
                  </div>
                  {onLocateRoute && (
                    <button type="button" className={btnCls} onClick={() => onLocateRoute(selected)}>
                      🔁 Volver a ubicar con Gemini Web (gratis)
                    </button>
                  )}
                </div>
              )}
              <div className="text-[10px] text-slate-400 leading-snug">
                Pon el cursor sobre la toma del mapa y marca los puntos en orden haciendo clic en el visor (mínimo 2).
              </div>
              <div className="flex flex-wrap gap-1">
                <button
                  type="button"
                  className={`${btnCls} ${routeCaptureId === selected.id ? '!bg-amber-500 !text-slate-950 !border-amber-400' : ''}`}
                  disabled={selected.aspect !== aspect}
                  onClick={() => onRouteCaptureChange(routeCaptureId === selected.id ? null : selected.id)}
                >
                  {routeCaptureId === selected.id ? '✅ Terminar de marcar' : '📍 Marcar puntos en el visor'}
                </button>
                <button
                  type="button"
                  className={btnCls}
                  disabled={selected.points.length === 0}
                  onClick={() => replace(selected.id, { points: selected.points.slice(0, -1) })}
                >
                  ↶ Quitar último
                </button>
                <button
                  type="button"
                  className={btnCls}
                  disabled={selected.points.length === 0}
                  onClick={() => replace(selected.id, { points: [] })}
                >
                  Borrar puntos
                </button>
              </div>
              <div className="text-[9px] text-slate-500">
                {selected.points.length} punto{selected.points.length === 1 ? '' : 's'} marcado{selected.points.length === 1 ? '' : 's'}
              </div>
              <div className="grid grid-cols-2 gap-2">
                <label className="flex flex-col gap-0.5 text-[10px] text-slate-400">
                  Icono
                  <select
                    className={inputCls}
                    value={selected.icon || 'ship'}
                    onChange={(e) => replace(selected.id, { icon: e.target.value as RouteMapGraphic['icon'] })}
                  >
                    <option value="ship">Barco</option>
                    <option value="arrow">Flecha</option>
                    <option value="dot">Punto</option>
                  </select>
                </label>
                <label className="flex flex-col gap-0.5 text-[10px] text-slate-400">
                  Se dibuja en (s, vacío = auto)
                  <input
                    type="number"
                    step={0.1}
                    min={0}
                    className={inputCls}
                    value={selected.drawSec ?? ''}
                    onChange={(e) => {
                      const v = Number(e.target.value);
                      replace(selected.id, { drawSec: e.target.value === '' || !(v > 0) ? undefined : v });
                    }}
                  />
                </label>
              </div>
              <label className="flex flex-col gap-0.5 text-[10px] text-slate-400">
                Nombre del destino (opcional)
                <input
                  className={inputCls}
                  value={selected.label || ''}
                  placeholder="Mar del Sur"
                  onChange={(e) => replace(selected.id, { label: e.target.value })}
                />
              </label>
            </>
          )}
        </div>
      )}
    </div>
  );
}
