import React, { useEffect, useMemo, useState } from 'react';
import leagueGothicUrl from '../assets/fonts/LeagueGothic.ttf';
import {
  DOC_GRAPHIC_COLORS,
  DOC_GRAPHIC_FONT_METRICS,
  DOC_GRAPHIC_TEXT_SHADOW,
  graphicAlpha,
  graphicEndSec,
  graphicShowsInAspect,
  layoutDateCard,
  layoutQuoteCard,
  layoutRoute,
  routeHeadAt,
  routeIconPolygons,
  type DocGraphic,
  type DocGraphicFontName,
  type DocGraphicMeasure,
  type GraphicTextRow,
} from '../utils/docGraphics';

// Viewer painter of the documentary graphics: SVG on the editor's canonical 520-px stage, drawn from the
// same layout as the exported video (server/docGraphicsAss.ts). Text widths come from the browser's own
// fonts (Georgia, League Gothic), heights from the TTF metrics libass uses.

const FONT_STYLE_ID = 'huellas-league-gothic-face';

function ensureLeagueGothicFace() {
  if (typeof document === 'undefined' || document.getElementById(FONT_STYLE_ID)) return;
  const st = document.createElement('style');
  st.id = FONT_STYLE_ID;
  st.textContent = `@font-face{font-family:'League Gothic';src:url(${leagueGothicUrl}) format('truetype');font-display:swap;}`;
  document.head.appendChild(st);
}

let measureCanvas: HTMLCanvasElement | null = null;
const cssFont = (font: DocGraphicFontName, px: number) =>
  `${DOC_GRAPHIC_FONT_METRICS[font].bold ? 'bold ' : ''}${px}px "${font}"`;

export const browserGraphicMeasure: DocGraphicMeasure = (text, font, px) => {
  if (typeof document === 'undefined') return String(text || '').length * px * 0.5;
  if (!measureCanvas) measureCanvas = document.createElement('canvas');
  const ctx = measureCanvas.getContext('2d');
  if (!ctx) return String(text || '').length * px * 0.5;
  ctx.font = cssFont(font, px);
  return ctx.measureText(String(text || '')).width;
};

/** True once League Gothic is ready to measure (widths taken before that would come from a fallback face). */
export function useDocGraphicFontsReady(): boolean {
  const [ready, setReady] = useState(false);
  useEffect(() => {
    ensureLeagueGothicFace();
    let alive = true;
    try {
      Promise.all([
        (document as any).fonts?.load(`40px "League Gothic"`),
        (document as any).fonts?.load(`bold 15px Georgia`),
      ])
        .then(() => alive && setReady(true))
        .catch(() => alive && setReady(true));
    } catch {
      setReady(true);
    }
    return () => {
      alive = false;
    };
  }, []);
  return ready;
}

const clamp01 = (v: number) => Math.max(0, Math.min(1, v));

/** Baseline of a row whose line box (libass \an5 / \an4) is centred on yCenter. */
function baselineOf(row: { font: DocGraphicFontName; fontPx: number; yCenter: number }): number {
  const m = DOC_GRAPHIC_FONT_METRICS[row.font];
  return row.yCenter - (m.heightRatio * row.fontPx) / 2 + m.ascentRatio * row.fontPx;
}

function TextRow({
  row,
  t,
  withShadow,
  opacity = 1,
}: {
  row: GraphicTextRow;
  t: number;
  withShadow: boolean;
  opacity?: number;
}) {
  const chars = Array.from(row.text);
  let cut = chars.length;
  if (row.charAppear && row.charAppear.length === chars.length) {
    cut = 0;
    for (let i = 0; i < chars.length; i++) if (row.charAppear[i] <= t) cut = i + 1;
    if (cut === 0) return null;
  }
  let rowOpacity = opacity;
  if (row.appearSec !== undefined) {
    if (t < row.appearSec) return null;
    const f = row.appearFadeSec || 0;
    rowOpacity *= f > 0 ? clamp01((t - row.appearSec) / f) : 1;
  }
  const visible = chars.slice(0, cut).join('');
  const hidden = chars.slice(cut).join('');
  const common = {
    x: row.x,
    textAnchor: row.anchor,
    fontFamily: row.font === 'League Gothic' ? '"League Gothic"' : 'Georgia, serif',
    fontWeight: DOC_GRAPHIC_FONT_METRICS[row.font].bold ? 700 : 400,
    fontSize: row.fontPx,
    letterSpacing: `${row.letterSpacingEm}em`,
    style: { whiteSpace: 'pre' as const, fontKerning: 'normal' as const },
  };
  const y = baselineOf(row);
  const body = (
    <>
      <tspan>{visible}</tspan>
      {hidden ? <tspan fillOpacity={0}>{hidden}</tspan> : null}
    </>
  );
  return (
    <g opacity={rowOpacity}>
      {withShadow &&
        DOC_GRAPHIC_TEXT_SHADOW.map((sh, i) => (
          <text
            key={`s${i}`}
            {...common}
            y={y + sh.dy}
            fill="#000"
            fillOpacity={sh.alpha}
            style={{ ...common.style, filter: `blur(${Math.max(0.5, sh.blur / 2)}px)` }}
          >
            {body}
          </text>
        ))}
      <text {...common} y={y} fill={row.color}>
        {body}
      </text>
    </g>
  );
}

export interface DocGraphicsLayerProps {
  graphics: DocGraphic[];
  /** Timeline second of the playhead. */
  t: number;
  aspect: '16:9' | '9:16';
  stageW: number;
  stageH: number;
  /** Route whose points are being placed: drawn complete with its point handles. */
  editingRouteId?: string | null;
}

export default function DocGraphicsLayer({ graphics, t, aspect, stageW, stageH, editingRouteId }: DocGraphicsLayerProps) {
  const fontsReady = useDocGraphicFontsReady();
  const shown = useMemo(
    () => (Array.isArray(graphics) ? graphics : []).filter((g) => graphicShowsInAspect(g, aspect)),
    [graphics, aspect]
  );
  const layouts = useMemo(() => {
    const m = new Map<string, any>();
    for (const g of shown) {
      if (g.kind === 'date_card') m.set(g.id, layoutDateCard(g, stageW, stageH, browserGraphicMeasure));
      else if (g.kind === 'quote_card') m.set(g.id, layoutQuoteCard(g, stageW, stageH, browserGraphicMeasure));
      else m.set(g.id, layoutRoute(g, stageW, stageH));
    }
    return m;
    // fontsReady: re-measure once League Gothic has loaded
  }, [shown, stageW, stageH, fontsReady]);

  const live = shown.filter(
    (g) => (t >= g.startSec && t <= graphicEndSec(g)) || (g.kind === 'route_map' && g.id === editingRouteId)
  );
  if (live.length === 0) return null;

  return (
    <svg
      className="absolute inset-0 pointer-events-none"
      width={stageW}
      height={stageH}
      viewBox={`0 0 ${stageW} ${stageH}`}
      style={{ overflow: 'visible' }}
    >
      {live.map((g) => {
        const editing = g.kind === 'route_map' && g.id === editingRouteId;
        const alpha = editing ? 1 : graphicAlpha(g, t);
        const lay = layouts.get(g.id);
        if (g.kind === 'date_card' && lay) {
          const L = lay as ReturnType<typeof layoutDateCard>;
          const R = L.rule;
          const ruleP = R ? clamp01((t - R.t0) / Math.max(0.01, R.t1 - R.t0)) : 0;
          const ruleW = R ? R.w * ruleP : 0;
          return (
            <g key={g.id} opacity={alpha}>
              {R && ruleW > 0.5 && (
                <rect
                  x={R.anchor === 'middle' ? R.x - ruleW / 2 : R.x}
                  y={R.y}
                  width={ruleW}
                  height={R.h}
                  fill={DOC_GRAPHIC_COLORS.dateGold}
                />
              )}
              {L.rows.map((row, i) => (
                <TextRow key={i} row={row} t={t} withShadow />
              ))}
            </g>
          );
        }
        if (g.kind === 'quote_card' && lay) {
          const L = lay as ReturnType<typeof layoutQuoteCard>;
          const left = L.cx - L.w / 2;
          const top = L.cy - L.h / 2;
          return (
            <g key={g.id} opacity={alpha} transform={`rotate(${L.angle} ${L.cx} ${L.cy})`}>
              <rect
                x={left}
                y={top + 8}
                width={L.w}
                height={L.h}
                fill="#000"
                fillOpacity={0.55}
                style={{ filter: 'blur(8px)' }}
              />
              <rect x={left} y={top} width={L.w} height={L.h} fill={DOC_GRAPHIC_COLORS.paper} />
              <rect
                x={left + 5}
                y={top + 5}
                width={L.w - 10}
                height={L.h - 10}
                fill="none"
                stroke={DOC_GRAPHIC_COLORS.paperEdge}
                strokeOpacity={0.7}
                strokeWidth={1.6}
              />
              {L.highlights.map((h, i) => {
                const p = clamp01((t - h.t0) / Math.max(0.01, h.t1 - h.t0));
                if (p <= 0) return null;
                return (
                  <rect
                    key={i}
                    x={h.x}
                    y={h.y}
                    width={h.w * p}
                    height={h.h}
                    fill={DOC_GRAPHIC_COLORS.marker}
                    fillOpacity={0.62}
                  />
                );
              })}
              {[...L.quoteRows, ...L.sourceRows].map((row, i) => (
                <TextRow key={i} row={row} t={t} withShadow={false} />
              ))}
            </g>
          );
        }
        if (g.kind === 'route_map') {
          const L = lay as ReturnType<typeof layoutRoute>;
          if (!L) {
            // Fewer than two points: show the ones placed so far while editing
            return editing ? (
              <g key={g.id}>
                {g.points.map((p, i) => (
                  <circle
                    key={i}
                    cx={(p.xPct / 100) * stageW}
                    cy={(p.yPct / 100) * stageH}
                    r={5}
                    fill={DOC_GRAPHIC_COLORS.routeDot}
                    stroke={DOC_GRAPHIC_COLORS.routeOutline}
                    strokeWidth={1.5}
                  />
                ))}
              </g>
            ) : null;
          }
          const tt = editing ? L.drawEnd + 0.01 : t;
          const head = routeHeadAt(L, Math.min(tt, L.drawEnd));
          const polys = tt >= L.drawStart ? routeIconPolygons(L.icon, L.iconSize, head.x, head.y, head.angle) : [];
          const sw = L.outlineWidth * 2;
          const labelRow: GraphicTextRow | null = L.label
            ? {
                text: L.label.text,
                font: 'Georgia',
                fontPx: L.label.fontPx,
                letterSpacingEm: 0.08,
                color: DOC_GRAPHIC_COLORS.labelText,
                anchor: 'middle',
                x: L.label.x,
                yCenter: L.label.y,
                appearSec: L.label.appearSec,
                appearFadeSec: 0.4,
              }
            : null;
          return (
            <g key={g.id} opacity={alpha}>
              {L.dashes
                .filter((d) => d.appearSec <= tt)
                .map((d, i) => (
                  <g key={i}>
                    {d.pieces.map((p, j) => {
                      const len = Math.hypot(p.x2 - p.x1, p.y2 - p.y1) || 1;
                      const nx = (-(p.y2 - p.y1) / len) * (L.lineWidth / 2);
                      const ny = ((p.x2 - p.x1) / len) * (L.lineWidth / 2);
                      const pts = `${p.x1 + nx},${p.y1 + ny} ${p.x2 + nx},${p.y2 + ny} ${p.x2 - nx},${p.y2 - ny} ${p.x1 - nx},${p.y1 - ny}`;
                      return (
                        <polygon
                          key={j}
                          points={pts}
                          fill={DOC_GRAPHIC_COLORS.route}
                          stroke={DOC_GRAPHIC_COLORS.routeOutline}
                          strokeOpacity={0.81}
                          strokeWidth={sw}
                          strokeLinejoin="round"
                          style={{ paintOrder: 'stroke' }}
                        />
                      );
                    })}
                  </g>
                ))}
              {tt >= L.startDot.appearSec && (
                <circle
                  cx={L.startDot.x}
                  cy={L.startDot.y}
                  r={L.startDot.r}
                  fill={DOC_GRAPHIC_COLORS.routeDot}
                  stroke={DOC_GRAPHIC_COLORS.routeOutline}
                  strokeWidth={3}
                  style={{ paintOrder: 'stroke' }}
                />
              )}
              {tt >= L.drawStart && L.icon === 'dot' && (
                <circle
                  cx={head.x}
                  cy={head.y}
                  r={5}
                  fill={DOC_GRAPHIC_COLORS.route}
                  stroke={DOC_GRAPHIC_COLORS.routeOutline}
                  strokeWidth={3}
                  style={{ paintOrder: 'stroke' }}
                />
              )}
              {polys.map((poly, i) => (
                <polygon
                  key={`ic${i}`}
                  points={poly.map(([x, y]) => `${x},${y}`).join(' ')}
                  fill="#f8f1e0"
                  stroke={DOC_GRAPHIC_COLORS.routeOutline}
                  strokeWidth={2.8}
                  strokeLinejoin="round"
                  style={{ paintOrder: 'stroke' }}
                />
              ))}
              {labelRow && <TextRow row={labelRow} t={editing ? Number.MAX_SAFE_INTEGER : t} withShadow />}
              {editing &&
                L.pts.map((p, i) => (
                  <g key={`h${i}`}>
                    <circle cx={p.x} cy={p.y} r={6} fill="none" stroke="#fff" strokeWidth={1.5} />
                    <text x={p.x + 8} y={p.y - 6} fontSize={10} fill="#fff" fontWeight={700} style={{ paintOrder: 'stroke' }} stroke="#000" strokeWidth={2}>
                      {i + 1}
                    </text>
                  </g>
                ))}
            </g>
          );
        }
        return null;
      })}
    </svg>
  );
}
