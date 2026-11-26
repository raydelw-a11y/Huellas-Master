/**
 * Documentary graphics layer: date / place cards, source quote cards and animated routes over a map.
 *
 * One module, two painters. The editor viewer draws these graphics as SVG on its canonical 520-px-high
 * stage, and the exporter turns the very same layout into libass vector events (server/docGraphicsAss.ts).
 * Everything here is expressed in STAGE pixels (stage height = 520) and TIMELINE seconds, so both
 * painters agree on where every letter, highlight and dash is and on the moment it appears.
 */

export const DOC_GRAPHICS_STAGE_HEIGHT = 520;

export type DocGraphicKind = 'date_card' | 'quote_card' | 'route_map';

export interface DocGraphicBase {
  id: string;
  kind: DocGraphicKind;
  /** Timeline second at which the graphic starts (same clock as the editor playhead). */
  startSec: number;
  durationSec: number;
}

export interface DateCardGraphic extends DocGraphicBase {
  kind: 'date_card';
  /** Big line, typed letter by letter (e.g. "29 DE SEPTIEMBRE DE 1513"). */
  line1: string;
  /** Small gold line under it (e.g. "DARIÉN, PANAMÁ"). */
  line2?: string;
  position?: 'center' | 'lower_left';
}

export interface QuoteCardGraphic extends DocGraphicBase {
  kind: 'quote_card';
  /** Exact quote from a primary source. */
  quote: string;
  /** Part of the quote that gets the marker highlight (empty = the whole quote). */
  highlight?: string;
  /** Who wrote it and where: "Bartolomé de las Casas, Historia de las Indias, 1527". */
  source: string;
  side?: 'left' | 'right' | 'center';
}

export interface RoutePoint {
  xPct: number;
  yPct: number;
}

export type RouteIcon = 'ship' | 'arrow' | 'dot';

export interface RouteMapGraphic extends DocGraphicBase {
  kind: 'route_map';
  /** Points are a percentage of the frame of this format; the route is only drawn in that format. */
  aspect: '16:9' | '9:16';
  points: RoutePoint[];
  icon?: RouteIcon;
  /** Place name shown at the end of the route. */
  label?: string;
  /** Seconds the line takes to draw (default: from its length). */
  drawSec?: number;
}

export type DocGraphic = DateCardGraphic | QuoteCardGraphic | RouteMapGraphic;

export const DOC_GRAPHIC_FADE_IN_SEC = 0.35;
export const DOC_GRAPHIC_FADE_OUT_SEC = 0.45;

export const DOC_GRAPHIC_DEFAULT_DURATION: Record<DocGraphicKind, number> = {
  date_card: 3.6,
  quote_card: 7,
  route_map: 6,
};

export const DOC_GRAPHIC_KIND_LABEL: Record<DocGraphicKind, string> = {
  date_card: 'Fecha y lugar',
  quote_card: 'Cita de fuente',
  route_map: 'Ruta en el mapa',
};

/** Fonts used by the layer (CSS family name = libass font name). */
export const DOC_GRAPHIC_FONTS = {
  poster: 'League Gothic',
  serif: 'Georgia',
} as const;

export type DocGraphicFontName = (typeof DOC_GRAPHIC_FONTS)[keyof typeof DOC_GRAPHIC_FONTS];

/**
 * Vertical metrics read from the bundled TTFs (data/fonts): libass sizes a line as (winAscent + winDescent),
 * so the SVG painter needs them to put its baseline where libass puts the glyphs.
 */
export const DOC_GRAPHIC_FONT_METRICS: Record<DocGraphicFontName, { heightRatio: number; ascentRatio: number; bold: boolean }> = {
  'League Gothic': { heightRatio: 1.3015, ascentRatio: 1.0515, bold: false },
  Georgia: { heightRatio: 1.1362, ascentRatio: 0.917, bold: true },
};

/** Width in stage px of `text` set in `font` at `fontPx` (letter spacing excluded). */
export type DocGraphicMeasure = (text: string, font: DocGraphicFontName, fontPx: number) => number;

/** Text shadow under every graphic text (stage px), same for SVG and libass. */
export const DOC_GRAPHIC_TEXT_SHADOW = [
  { dy: 3, blur: 12, alpha: 0.9 },
  { dy: 1, blur: 3, alpha: 0.85 },
];

export const DOC_GRAPHIC_COLORS = {
  dateText: '#ffffff',
  dateGold: '#fcd34d',
  paper: '#f2e8d2',
  paperEdge: '#c9b48c',
  ink: '#2a1f14',
  inkSoft: '#6b5843',
  marker: '#fde047',
  route: '#f59e0b',
  routeOutline: '#1a1208',
  routeDot: '#fcd34d',
  labelText: '#ffffff',
};

export function stageWidthFor(aspect: '16:9' | '9:16'): number {
  return aspect === '9:16'
    ? (DOC_GRAPHICS_STAGE_HEIGHT * 9) / 16
    : (DOC_GRAPHICS_STAGE_HEIGHT * 16) / 9;
}

export function newDocGraphicId(kind: DocGraphicKind): string {
  return `${kind}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}`;
}

const clamp = (v: number, a: number, b: number) => Math.max(a, Math.min(b, v));

export function graphicEndSec(g: DocGraphic): number {
  return g.startSec + Math.max(0.5, Number(g.durationSec) || 0);
}

/** Overall opacity (0..1) of a graphic at timeline second `t` (fade in / hold / fade out). */
export function graphicAlpha(g: DocGraphic, t: number): number {
  const s = g.startSec;
  const e = graphicEndSec(g);
  if (t < s || t > e) return 0;
  const fin = Math.min(DOC_GRAPHIC_FADE_IN_SEC, (e - s) / 3);
  const fout = Math.min(DOC_GRAPHIC_FADE_OUT_SEC, (e - s) / 3);
  if (t < s + fin) return clamp((t - s) / fin, 0, 1);
  if (t > e - fout) return clamp((e - t) / fout, 0, 1);
  return 1;
}

/** Whether a graphic is drawn in this export / viewer format. */
export function graphicShowsInAspect(g: DocGraphic, aspect: '16:9' | '9:16'): boolean {
  return g.kind !== 'route_map' || g.aspect === aspect;
}

/** Greedy word wrap with a measure function. */
function wrapWords(text: string, maxW: number, widthOf: (s: string) => number): string[] {
  const words = String(text || '').split(/\s+/).filter(Boolean);
  const rows: string[] = [];
  let cur = '';
  for (const w of words) {
    const cand = cur ? `${cur} ${w}` : w;
    if (!cur || widthOf(cand) <= maxW + 1e-6) cur = cand;
    else {
      rows.push(cur);
      cur = w;
    }
  }
  if (cur) rows.push(cur);
  return rows;
}

const upperEs = (s: string) => String(s || '').trim().toLocaleUpperCase('es-ES');

// ---------------------------------------------------------------------------------------------------
// Date / place card
// ---------------------------------------------------------------------------------------------------

export interface GraphicTextRow {
  text: string;
  font: DocGraphicFontName;
  fontPx: number;
  letterSpacingEm: number;
  color: string;
  /** 'middle': x is the centre of the row; 'start': x is its left edge. */
  anchor: 'middle' | 'start';
  x: number;
  yCenter: number;
  /** Typewriter: timeline second at which each character of `text` appears. */
  charAppear?: number[];
  /** Whole-row fade in (seconds) starting at `appearSec`. */
  appearSec?: number;
  appearFadeSec?: number;
}

export interface DateCardLayout {
  rows: GraphicTextRow[];
  /** Gold rule drawn between the two lines, growing from `anchor` over [t0, t1]. */
  rule: { x: number; y: number; w: number; h: number; anchor: 'middle' | 'start'; t0: number; t1: number } | null;
}

export function layoutDateCard(
  g: DateCardGraphic,
  stageW: number,
  stageH: number,
  measure: DocGraphicMeasure
): DateCardLayout {
  const isV = stageW < stageH;
  const lowerLeft = g.position === 'lower_left';
  const maxW = stageW * (isV ? 0.86 : lowerLeft ? 0.6 : 0.72);
  const line1 = upperEs(g.line1);
  const line2 = upperEs(g.line2 || '');
  const sp1 = 0.03;
  const sp2 = 0.2;
  const w1 = (s: string, px: number) => measure(s, 'League Gothic', px) + s.length * sp1 * px;
  const w2 = (s: string, px: number) => measure(s, 'Georgia', px) + s.length * sp2 * px;

  const basePx1 = isV ? 40 : 54;
  const minPx1 = isV ? 24 : 30;
  let px1 = basePx1;
  if (line1) {
    const full = w1(line1, 100) / 100;
    px1 = clamp(maxW / Math.max(0.01, full), minPx1, basePx1);
  }
  const rows1 = line1 ? wrapWords(line1, maxW, (s) => w1(s, px1)) : [];
  const px2 = isV ? 10.5 : 12.5;
  const rows2 = line2 ? wrapWords(line2, maxW, (s) => w2(s, px2)) : [];

  const rowH1 = px1 * 1.02;
  const rowH2 = px2 * 1.7;
  const gap = rows1.length && rows2.length ? 14 : 0;
  const blockH = rows1.length * rowH1 + gap + rows2.length * rowH2;
  const anchor: 'middle' | 'start' = lowerLeft ? 'start' : 'middle';
  const x = lowerLeft ? stageW * (isV ? 0.07 : 0.06) : stageW / 2;
  const top = lowerLeft
    ? stageH * (isV ? 0.7 : 0.74) - blockH
    : stageH * (isV ? 0.4 : 0.42) - blockH / 2;

  const t0 = g.startSec + 0.1;
  const typed = rows1.join(' ');
  const visibleChars = typed.replace(/\s/g, '').length || 1;
  const step = Math.min(0.055, 0.85 / visibleChars);
  let k = 0;
  const rows: GraphicTextRow[] = [];
  rows1.forEach((r, i) => {
    const appear = Array.from(r).map((ch) => {
      const at = t0 + k * step;
      if (!/\s/.test(ch)) k += 1;
      return Number(at.toFixed(3));
    });
    rows.push({
      text: r,
      font: 'League Gothic',
      fontPx: px1,
      letterSpacingEm: sp1,
      color: DOC_GRAPHIC_COLORS.dateText,
      anchor,
      x,
      yCenter: top + (i + 0.5) * rowH1,
      charAppear: appear,
    });
  });
  const typeEnd = t0 + visibleChars * step;
  rows2.forEach((r, i) => {
    rows.push({
      text: r,
      font: 'Georgia',
      fontPx: px2,
      letterSpacingEm: sp2,
      color: DOC_GRAPHIC_COLORS.dateGold,
      anchor,
      x,
      yCenter: top + rows1.length * rowH1 + gap + (i + 0.5) * rowH2,
      appearSec: Number((typeEnd + 0.15).toFixed(3)),
      appearFadeSec: 0.4,
    });
  });
  let rule: DateCardLayout['rule'] = null;
  if (rows1.length) {
    const widest = Math.max(...rows1.map((r) => w1(r, px1)));
    const rw = Math.min(maxW, Math.max(60, widest * 0.6));
    rule = {
      x,
      y: top + rows1.length * rowH1 + (gap ? gap / 2 : 6) - 1,
      w: rw,
      h: 2,
      anchor,
      t0: Number((typeEnd + 0.05).toFixed(3)),
      t1: Number((typeEnd + 0.5).toFixed(3)),
    };
  }
  return { rows, rule };
}

// ---------------------------------------------------------------------------------------------------
// Source quote card
// ---------------------------------------------------------------------------------------------------

export interface QuoteCardLayout {
  cx: number;
  cy: number;
  w: number;
  h: number;
  /** Degrees, clockwise on screen (SVG rotate). */
  angle: number;
  quoteRows: GraphicTextRow[];
  sourceRows: GraphicTextRow[];
  /** Marker highlights in unrotated stage coordinates, each growing left to right over [t0, t1]. */
  highlights: Array<{ x: number; y: number; w: number; h: number; t0: number; t1: number }>;
}

export function normalizeQuoteText(q: string): string {
  const t = String(q || '').trim().replace(/^[«"“'‘]+|[»"”'’]+$/g, '').trim();
  return t ? `«${t}»` : '';
}

export function layoutQuoteCard(
  g: QuoteCardGraphic,
  stageW: number,
  stageH: number,
  measure: DocGraphicMeasure
): QuoteCardLayout {
  const isV = stageW < stageH;
  const side = isV ? 'center' : g.side || 'right';
  const w = isV ? stageW * 0.86 : stageW * 0.44;
  const pad = isV ? 14 : 18;
  const fontPx = isV ? 12.5 : 15;
  const lineH = fontPx * 1.38;
  const srcPx = isV ? 8.5 : 9.5;
  const srcLineH = srcPx * 1.45;
  const quote = normalizeQuoteText(g.quote);
  const textW = w - 2 * pad;
  const qRows = wrapWords(quote, textW, (s) => measure(s, 'Georgia', fontPx));
  const srcText = g.source ? `Fuente: ${String(g.source).trim()}` : '';
  const sRows = srcText ? wrapWords(srcText, textW, (s) => measure(s, 'Georgia', srcPx)) : [];
  const srcGap = sRows.length ? 10 : 0;
  const h = pad + qRows.length * lineH + srcGap + sRows.length * srcLineH + pad;
  const cx = side === 'left' ? stageW * 0.27 : side === 'right' ? stageW * 0.73 : stageW / 2;
  const cy = stageH * (isV ? 0.42 : 0.45);
  const angle = side === 'left' ? -1.6 : side === 'right' ? 1.6 : -1;
  const left = cx - w / 2;
  const top = cy - h / 2;

  const quoteRows: GraphicTextRow[] = qRows.map((r, i) => ({
    text: r,
    font: 'Georgia',
    fontPx,
    letterSpacingEm: 0,
    color: DOC_GRAPHIC_COLORS.ink,
    anchor: 'start',
    x: left + pad,
    yCenter: top + pad + (i + 0.5) * lineH,
  }));
  const sourceRows: GraphicTextRow[] = sRows.map((r, i) => ({
    text: r,
    font: 'Georgia',
    fontPx: srcPx,
    letterSpacingEm: 0,
    color: DOC_GRAPHIC_COLORS.inkSoft,
    anchor: 'start',
    x: left + pad,
    yCenter: top + pad + qRows.length * lineH + srcGap + (i + 0.5) * srcLineH,
  }));

  // Highlight: the chosen phrase (or the whole quote) found in the wrapped rows
  const fold = (s: string) =>
    s
      .toLocaleLowerCase('es-ES')
      .normalize('NFD')
      .replace(/[̀-ͯ]/g, '');
  const joined = qRows.join(' ');
  const want = String(g.highlight || '').trim().replace(/^[«"“]+|[»"”]+$/g, '');
  let hs = 0;
  let he = 0;
  if (want) {
    const at = fold(joined).indexOf(fold(want));
    if (at >= 0) {
      hs = at;
      he = at + want.length;
    }
  }
  if (he <= hs) {
    hs = joined.startsWith('«') ? 1 : 0;
    he = joined.endsWith('»') ? joined.length - 1 : joined.length;
  }
  const pieces: Array<{ x: number; y: number; w: number; h: number }> = [];
  let offset = 0;
  qRows.forEach((r, i) => {
    const rs = offset;
    const re = offset + r.length;
    offset = re + 1;
    const a = Math.max(hs, rs);
    const b = Math.min(he, re);
    if (b <= a) return;
    const pre = r.slice(0, a - rs);
    const seg = r.slice(a - rs, b - rs);
    const x0 = left + pad + measure(pre, 'Georgia', fontPx) - 2;
    const sw = measure(seg, 'Georgia', fontPx) + 4;
    pieces.push({ x: x0, y: top + pad + (i + 0.5) * lineH - fontPx * 0.5, w: sw, h: fontPx * 1.08 });
  });
  const totalW = pieces.reduce((s, p) => s + p.w, 0) || 1;
  const h0 = g.startSec + 0.8;
  const hDur = 1.2 * clamp(totalW / 260, 0.6, 2.2);
  let acc = 0;
  const highlights = pieces.map((p) => {
    const t0 = h0 + (acc / totalW) * hDur;
    acc += p.w;
    const t1 = h0 + (acc / totalW) * hDur;
    return { ...p, t0: Number(t0.toFixed(3)), t1: Number(t1.toFixed(3)) };
  });
  return { cx, cy, w, h, angle, quoteRows, sourceRows, highlights };
}

// ---------------------------------------------------------------------------------------------------
// Animated route over a map
// ---------------------------------------------------------------------------------------------------

export interface RouteDash {
  /** Straight pieces of the dash (a dash bends where the route bends). */
  pieces: Array<{ x1: number; y1: number; x2: number; y2: number }>;
  appearSec: number;
}

export interface RouteLayout {
  pts: Array<{ x: number; y: number }>;
  length: number;
  drawStart: number;
  drawEnd: number;
  dashes: RouteDash[];
  lineWidth: number;
  outlineWidth: number;
  startDot: { x: number; y: number; r: number; appearSec: number };
  label: { text: string; x: number; y: number; fontPx: number; appearSec: number } | null;
  icon: RouteIcon;
  iconSize: number;
}

const easeInOut = (p: number) => 0.5 - 0.5 * Math.cos(Math.PI * clamp(p, 0, 1));
const easeInOutInv = (y: number) => Math.acos(1 - 2 * clamp(y, 0, 1)) / Math.PI;

export function layoutRoute(g: RouteMapGraphic, stageW: number, stageH: number): RouteLayout | null {
  const pts = (Array.isArray(g.points) ? g.points : [])
    .filter((p) => Number.isFinite(Number(p?.xPct)) && Number.isFinite(Number(p?.yPct)))
    .map((p) => ({ x: (clamp(Number(p.xPct), 0, 100) / 100) * stageW, y: (clamp(Number(p.yPct), 0, 100) / 100) * stageH }));
  if (pts.length < 2) return null;
  const cum = [0];
  for (let i = 1; i < pts.length; i++) {
    cum.push(cum[i - 1] + Math.hypot(pts[i].x - pts[i - 1].x, pts[i].y - pts[i - 1].y));
  }
  const length = cum[cum.length - 1];
  if (length < 4) return null;
  const end = graphicEndSec(g);
  const drawStart = g.startSec + 0.4;
  const maxDraw = Math.max(0.8, end - drawStart - 1.2);
  const drawSec = clamp(Number(g.drawSec) > 0 ? Number(g.drawSec) : length / 170, 1.4, 4.5);
  const drawDur = Math.min(drawSec, maxDraw);
  const drawEnd = drawStart + drawDur;
  const pointAtDist = (d: number) => {
    const dd = clamp(d, 0, length);
    let i = 1;
    while (i < cum.length - 1 && cum[i] < dd) i++;
    const segLen = cum[i] - cum[i - 1] || 1;
    const f = (dd - cum[i - 1]) / segLen;
    return { x: pts[i - 1].x + (pts[i].x - pts[i - 1].x) * f, y: pts[i - 1].y + (pts[i].y - pts[i - 1].y) * f, seg: i };
  };
  const timeAtDist = (d: number) => drawStart + drawDur * easeInOutInv(d / length);
  const period = 14;
  const dashLen = 8;
  const dashes: RouteDash[] = [];
  for (let d = 0; d < length - 0.5; d += period) {
    const d2 = Math.min(length, d + dashLen);
    const a = pointAtDist(d);
    const b = pointAtDist(d2);
    const pieces: RouteDash['pieces'] = [];
    let cur = { x: a.x, y: a.y };
    for (let v = a.seg; v < b.seg; v++) {
      pieces.push({ x1: cur.x, y1: cur.y, x2: pts[v].x, y2: pts[v].y });
      cur = { x: pts[v].x, y: pts[v].y };
    }
    pieces.push({ x1: cur.x, y1: cur.y, x2: b.x, y2: b.y });
    dashes.push({ pieces, appearSec: Number(timeAtDist((d + d2) / 2).toFixed(3)) });
  }
  const last = pts[pts.length - 1];
  const isV = stageW < stageH;
  const labelPx = isV ? 11 : 13;
  const label = String(g.label || '').trim()
    ? {
        text: upperEs(g.label || ''),
        x: clamp(last.x, stageW * 0.12, stageW * 0.88),
        y: last.y < stageH * 0.18 ? last.y + 28 : last.y - 28,
        fontPx: labelPx,
        appearSec: Number((drawEnd + 0.1).toFixed(3)),
      }
    : null;
  return {
    pts,
    length,
    drawStart,
    drawEnd,
    dashes,
    lineWidth: 3.2,
    outlineWidth: 1.3,
    startDot: { x: pts[0].x, y: pts[0].y, r: 5.5, appearSec: g.startSec + 0.05 },
    label,
    icon: g.icon || 'ship',
    iconSize: isV ? 22 : 26,
  };
}

/** Head of the route at timeline second `t`: position and heading (radians, screen y down). */
export function routeHeadAt(r: RouteLayout, t: number): { x: number; y: number; angle: number } {
  const p = r.drawEnd > r.drawStart ? (t - r.drawStart) / (r.drawEnd - r.drawStart) : 1;
  const d = r.length * easeInOut(p);
  const at = (dist: number) => {
    let acc = 0;
    for (let i = 1; i < r.pts.length; i++) {
      const sl = Math.hypot(r.pts[i].x - r.pts[i - 1].x, r.pts[i].y - r.pts[i - 1].y);
      if (acc + sl >= dist || i === r.pts.length - 1) {
        const f = sl > 0 ? clamp((dist - acc) / sl, 0, 1) : 0;
        return { x: r.pts[i - 1].x + (r.pts[i].x - r.pts[i - 1].x) * f, y: r.pts[i - 1].y + (r.pts[i].y - r.pts[i - 1].y) * f };
      }
      acc += sl;
    }
    return r.pts[r.pts.length - 1];
  };
  const here = at(d);
  const back = at(Math.max(0, d - 6));
  const ahead = at(Math.min(r.length, d + 6));
  const angle = Math.atan2(ahead.y - back.y, ahead.x - back.x);
  return { x: here.x, y: here.y, angle: Number.isFinite(angle) ? angle : 0 };
}

/**
 * Icon outlines (closed polygons, nose pointing +x, centred on 0,0, 1 unit = icon size). A ship heading left
 * is mirrored instead of turned upside down.
 */
const ICON_SHAPES: Record<Exclude<RouteIcon, 'dot'>, Array<Array<[number, number]>>> = {
  ship: [
    // hull
    [
      [-0.5, 0.12],
      [0.5, 0.12],
      [0.36, 0.34],
      [-0.4, 0.34],
    ],
    // main sail
    [
      [-0.06, 0.06],
      [-0.06, -0.5],
      [0.3, 0.06],
    ],
    // rear sail
    [
      [-0.12, 0.06],
      [-0.12, -0.38],
      [-0.42, 0.06],
    ],
  ],
  arrow: [
    [
      [0.5, 0],
      [-0.4, -0.36],
      [-0.18, 0],
      [-0.4, 0.36],
    ],
  ],
};

/** Icon polygons placed at (x, y) with heading `angle`, in stage px. */
export function routeIconPolygons(
  icon: RouteIcon,
  size: number,
  x: number,
  y: number,
  angle: number
): Array<Array<[number, number]>> {
  if (icon === 'dot') return [];
  const shape = ICON_SHAPES[icon] || ICON_SHAPES.ship;
  // A ship stays upright: it faces left or right and only leans a little with the route
  const isShip = icon === 'ship';
  const mirror = isShip && Math.cos(angle) < 0;
  let rot = angle;
  if (isShip) {
    let base = mirror ? angle - Math.PI : angle;
    while (base > Math.PI) base -= 2 * Math.PI;
    while (base < -Math.PI) base += 2 * Math.PI;
    rot = clamp(base, -0.35, 0.35);
  }
  const c = Math.cos(rot);
  const s = Math.sin(rot);
  return shape.map((poly) =>
    poly.map(([px, py]) => {
      const lx = (mirror ? -px : px) * size;
      const ly = py * size;
      return [x + lx * c - ly * s, y + lx * s + ly * c] as [number, number];
    })
  );
}

// ---------------------------------------------------------------------------------------------------
// Finding graphics in the narration and the research
// ---------------------------------------------------------------------------------------------------

export interface TimedCaptionLike {
  start: number;
  end: number;
  text: string;
  /** Timeline second at which each word of `text` starts. */
  wordStarts?: number[];
}

interface TimedToken {
  word: string;
  at: number;
  end: number;
  offset: number;
}

function buildTokenStream(captions: TimedCaptionLike[]): { text: string; tokens: TimedToken[] } {
  const tokens: TimedToken[] = [];
  let text = '';
  const sorted = [...captions].filter((c) => c && String(c.text || '').trim()).sort((a, b) => a.start - b.start);
  for (const c of sorted) {
    const words = String(c.text).split(/\s+/).filter(Boolean);
    const starts =
      Array.isArray(c.wordStarts) && c.wordStarts.length === words.length
        ? c.wordStarts
        : words.map((_, i) => c.start + ((c.end - c.start) * i) / Math.max(1, words.length));
    words.forEach((w, i) => {
      if (text) text += ' ';
      tokens.push({
        word: w,
        at: Number(starts[i]),
        end: i + 1 < words.length ? Number(starts[i + 1]) : c.end,
        offset: text.length,
      });
      text += w;
    });
  }
  return { text, tokens };
}

function tokenAtOffset(tokens: TimedToken[], offset: number): TimedToken | null {
  let found: TimedToken | null = null;
  for (const t of tokens) {
    if (t.offset <= offset) found = t;
    else break;
  }
  return found;
}

const MONTHS = 'enero|febrero|marzo|abril|mayo|junio|julio|agosto|septiembre|setiembre|octubre|noviembre|diciembre';

export interface DateCardSuggestion {
  startSec: number;
  line1: string;
  line2: string;
  spoken: string;
}

/**
 * Dates and places spoken in the narration, as date card suggestions: the opening triad
 * ("Año 1513, Darién, Panamá."), full dates ("29 de septiembre de 1513") and years that open a
 * sentence ("En 1520, ..."). Cards are kept at least `minGapSec` apart.
 */
export function detectDateCardSuggestions(
  captions: TimedCaptionLike[],
  opts: { skipBeforeSec?: number; minGapSec?: number; max?: number } = {}
): DateCardSuggestion[] {
  const { text, tokens } = buildTokenStream(captions);
  if (!text) return [];
  const found: Array<DateCardSuggestion & { prio: number }> = [];
  const bc = (s?: string) => (s && /antes/i.test(s) ? ' A. C.' : '');
  const push = (index: number, line1: string, line2: string, spoken: string, prio: number) => {
    const tk = tokenAtOffset(tokens, index);
    if (!tk) return;
    found.push({ startSec: Math.max(0, Number((tk.at - 0.1).toFixed(2))), line1, line2, spoken, prio });
  };
  // 1) "Año 1513, Darién, Panamá."
  const triad = /\bA[ñn]o\s+(\d{1,4})(\s+(?:antes|despu[eé]s)\s+de\s+Cristo)?\s*,\s*([^.;:?!]{3,70})[.;]/gi;
  for (const m of text.matchAll(triad)) {
    // A short place list ("Darién, Panamá"), not the start of a long sentence
    const place = m[3].trim();
    push(m.index || 0, `${m[1]}${bc(m[2])}`, place.split(/\s+/).length <= 6 ? place : '', m[0], 3);
  }
  // 2) "29 de septiembre de 1513" / "primero de mayo de 1520"
  const full = new RegExp(
    `\\b(primero|\\d{1,2})\\s+de\\s+(${MONTHS})(?:\\s+(?:de|del\\s+a[ñn]o)\\s+(\\d{3,4})(\\s+(?:antes|despu[eé]s)\\s+de\\s+Cristo)?)?`,
    'gi'
  );
  for (const m of text.matchAll(full)) {
    const day = /primero/i.test(m[1]) ? '1' : m[1];
    const line1 = `${day} de ${m[2]}${m[3] ? ` de ${m[3]}${bc(m[4])}` : ''}`;
    push(m.index || 0, line1, '', m[0], m[3] ? 2 : 1);
  }
  // 3) "En 1520," at the start of a sentence
  const yearLead = /(?:^|[.?!]\s+)((?:En|Hacia|Para|Desde)\s+(?:el\s+a[ñn]o\s+)?(\d{3,4})(\s+(?:antes|despu[eé]s)\s+de\s+Cristo)?)\b/g;
  for (const m of text.matchAll(yearLead)) {
    const idx = (m.index || 0) + m[0].indexOf(m[1]);
    push(idx, `${m[2]}${bc(m[3])}`, '', m[1], 0);
  }
  const skipBefore = Number(opts.skipBeforeSec) || 0;
  const gap = Number(opts.minGapSec) > 0 ? Number(opts.minGapSec) : 25;
  const max = Number(opts.max) > 0 ? Number(opts.max) : 10;
  // Same moment matched twice (triad + full date): keep the richer match
  const byTime = found
    .filter((f) => f.startSec >= skipBefore)
    .sort((a, b) => a.startSec - b.startSec || b.prio - a.prio);
  const out: DateCardSuggestion[] = [];
  let lastAt = -Infinity;
  for (const f of byTime) {
    if (f.startSec - lastAt < gap) {
      const prev = out[out.length - 1];
      if (prev && Math.abs(prev.startSec - f.startSec) < 2 && f.prio > (prev as any).prio) {
        out[out.length - 1] = f;
      }
      continue;
    }
    out.push(f);
    lastAt = f.startSec;
    if (out.length >= max) break;
  }
  return out.map(({ startSec, line1, line2, spoken }) => ({ startSec, line1, line2, spoken }));
}

const foldForMatch = (s: string) =>
  String(s || '')
    .toLocaleLowerCase('es-ES')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9ñ\s]/g, ' ')
    .split(/\s+/)
    .filter(Boolean);

/** Where the narration says a quote: start and end timeline seconds, or null when it is not spoken. */
export function findQuoteInCaptions(
  quote: string,
  captions: TimedCaptionLike[]
): { startSec: number; endSec: number } | null {
  const qWords = foldForMatch(quote);
  if (qWords.length < 3) return null;
  const { tokens } = buildTokenStream(captions);
  const tWords = tokens.map((t) => foldForMatch(t.word).join(''));
  const probe = qWords.slice(0, Math.min(5, qWords.length));
  for (let i = 0; i + probe.length <= tWords.length; i++) {
    let ok = true;
    for (let j = 0; j < probe.length; j++) {
      if (tWords[i + j] !== probe[j]) {
        ok = false;
        break;
      }
    }
    if (!ok) continue;
    const lastIdx = Math.min(tokens.length - 1, i + qWords.length - 1);
    return { startSec: tokens[i].at, endSec: tokens[lastIdx].end };
  }
  return null;
}

export interface ResearchScreenQuote {
  quote: string;
  source: string;
}

/**
 * The "CITAS PARA PANTALLA" list of the Deep Research dossier: one quote per line,
 * «cita» — autor, obra, año [n].
 */
export function parseResearchScreenQuotes(research: string): ResearchScreenQuote[] {
  const text = String(research || '').replace(/\r\n/g, '\n');
  const head = /CITAS\s+PARA\s+PANTALLA/i.exec(text);
  if (!head) return [];
  const rest = text.slice(head.index + head[0].length);
  const lines = rest.split('\n');
  const out: ResearchScreenQuote[] = [];
  let started = false;
  for (const raw of lines) {
    const line = raw.replace(/\*\*/g, '').replace(/^\s*[-*•]\s*/, '').trim();
    if (!line) {
      continue;
    }
    // Next sub-section or section: stop
    if (started && /^(?:#+\s*)?(?:REFERENCIAS|CIFRAS\s+EN\s+CONFLICTO|\d+\.\s+[A-ZÁÉÍÓÚ]{4,}|[A-ZÁÉÍÓÚÑ ]{8,}:?$)/.test(line)) break;
    const m = /^(?:\d+[.)]\s*)?[«"“](.+?)[»"”]\s*[—–-]+\s*(.+?)\s*$/.exec(line);
    if (!m) {
      if (started && /^(?:#|[A-ZÁÉÍÓÚÑ]{4,})/.test(line) && !/[«"“]/.test(line)) break;
      continue;
    }
    started = true;
    const source = m[2].replace(/(?:\s*\[\d+\])+\s*\.?\s*$/, '').replace(/[.\s]+$/, '').trim();
    out.push({ quote: m[1].trim(), source });
    if (out.length >= 12) break;
  }
  return out;
}

/** Keeps only well-formed graphics (data saved by older or newer versions of the page). */
export function sanitizeDocGraphics(raw: unknown): DocGraphic[] {
  if (!Array.isArray(raw)) return [];
  const out: DocGraphic[] = [];
  for (const it of raw as any[]) {
    if (!it || typeof it !== 'object') continue;
    const startSec = Number(it.startSec);
    const durationSec = Number(it.durationSec);
    if (!Number.isFinite(startSec) || !Number.isFinite(durationSec) || durationSec <= 0) continue;
    const base = { id: String(it.id || newDocGraphicId(it.kind)), startSec: Math.max(0, startSec), durationSec: clamp(durationSec, 0.5, 60) };
    if (it.kind === 'date_card' && String(it.line1 || '').trim()) {
      out.push({ ...base, kind: 'date_card', line1: String(it.line1), line2: String(it.line2 || ''), position: it.position === 'lower_left' ? 'lower_left' : 'center' });
    } else if (it.kind === 'quote_card' && String(it.quote || '').trim()) {
      out.push({
        ...base,
        kind: 'quote_card',
        quote: String(it.quote),
        highlight: String(it.highlight || ''),
        source: String(it.source || ''),
        side: it.side === 'left' || it.side === 'center' ? it.side : 'right',
      });
    } else if (it.kind === 'route_map' && Array.isArray(it.points)) {
      out.push({
        ...base,
        kind: 'route_map',
        aspect: it.aspect === '9:16' ? '9:16' : '16:9',
        points: it.points
          .filter((p: any) => Number.isFinite(Number(p?.xPct)) && Number.isFinite(Number(p?.yPct)))
          .map((p: any) => ({ xPct: clamp(Number(p.xPct), 0, 100), yPct: clamp(Number(p.yPct), 0, 100) })),
        icon: it.icon === 'arrow' || it.icon === 'dot' ? it.icon : 'ship',
        label: String(it.label || ''),
        ...(Number(it.drawSec) > 0 ? { drawSec: Number(it.drawSec) } : {}),
      });
    }
  }
  return out.sort((a, b) => a.startSec - b.startSec);
}
