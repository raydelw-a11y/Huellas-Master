/**
 * Documentary graphics (date cards, source quote cards, animated routes) as libass vector events.
 *
 * The layout comes from src/utils/docGraphics.ts — the same functions the editor viewer paints as SVG —
 * scaled from the 520-px stage to the export resolution. Every animation is written as a run of short
 * static events (one per typed letter, per highlight step, per route dash, per icon position), so cutting
 * the timeline into exported segments only has to clamp start and end times: nothing is interpolated by
 * libass across a segment boundary.
 */
import {
  DOC_GRAPHIC_COLORS,
  DOC_GRAPHIC_FADE_IN_SEC,
  DOC_GRAPHIC_FADE_OUT_SEC,
  DOC_GRAPHIC_TEXT_SHADOW,
  DOC_GRAPHICS_STAGE_HEIGHT,
  graphicEndSec,
  graphicShowsInAspect,
  layoutDateCard,
  layoutQuoteCard,
  layoutRoute,
  routeHeadAt,
  routeIconPolygons,
  sanitizeDocGraphics,
  type DocGraphic,
  type DocGraphicFontName,
  type GraphicTextRow,
} from '../src/utils/docGraphics';
import { escapeAssText, formatAssTime, measureTextEm, resolveExportFont } from './exportOverlayAss';

export interface GraphicAssEvent {
  /** Timeline seconds. */
  start: number;
  end: number;
  layer: number;
  /** Full event text starting with an override block "{...}" (no \fad: it is added per segment). */
  text: string;
  fadeInMs: number;
  fadeOutMs: number;
}

/** Graphics sit above captions and the Clip 1 hook (layers 0..9). */
const LAYER_BASE = 20;

function assHex(hex: string): string {
  const c = String(hex || '').replace('#', '');
  const rgb = /^[0-9a-fA-F]{6}$/.test(c) ? c : 'ffffff';
  return `&H${rgb.slice(4, 6)}${rgb.slice(2, 4)}${rgb.slice(0, 2)}&`.toUpperCase();
}
function assAlpha(opacity: number): string {
  const a = Math.max(0, Math.min(255, Math.round((1 - Math.max(0, Math.min(1, opacity))) * 255)));
  return `&H${a.toString(16).toUpperCase().padStart(2, '0')}&`;
}
const r1 = (n: number) => Math.round(n);

function polygonDrawing(pts: Array<[number, number]>): string {
  if (pts.length < 3) return '';
  const [first, ...rest] = pts;
  return `m ${r1(first[0])} ${r1(first[1])} l ${rest.map(([x, y]) => `${r1(x)} ${r1(y)}`).join(' ')}`;
}
function rectDrawing(x: number, y: number, w: number, h: number): string {
  return polygonDrawing([
    [x, y],
    [x + w, y],
    [x + w, y + h],
    [x, y + h],
  ]);
}
function circleDrawing(cx: number, cy: number, r: number): string {
  const k = r * 0.5523;
  const f = (n: number) => r1(n);
  return [
    `m ${f(cx)} ${f(cy - r)}`,
    `b ${f(cx + k)} ${f(cy - r)} ${f(cx + r)} ${f(cy - k)} ${f(cx + r)} ${f(cy)}`,
    `b ${f(cx + r)} ${f(cy + k)} ${f(cx + k)} ${f(cy + r)} ${f(cx)} ${f(cy + r)}`,
    `b ${f(cx - k)} ${f(cy + r)} ${f(cx - r)} ${f(cy + k)} ${f(cx - r)} ${f(cy)}`,
    `b ${f(cx - r)} ${f(cy - k)} ${f(cx - k)} ${f(cy - r)} ${f(cx)} ${f(cy - r)}`,
  ].join(' ');
}
/** Thick straight segment as a quad (stage → output already applied). */
function segmentQuad(x1: number, y1: number, x2: number, y2: number, w: number): Array<[number, number]> {
  const len = Math.hypot(x2 - x1, y2 - y1) || 1;
  const nx = (-(y2 - y1) / len) * (w / 2);
  const ny = ((x2 - x1) / len) * (w / 2);
  return [
    [x1 + nx, y1 + ny],
    [x2 + nx, y2 + ny],
    [x2 - nx, y2 - ny],
    [x1 - nx, y1 - ny],
  ];
}

export interface BuildDocGraphicsInput {
  graphics: unknown;
  outW: number;
  outH: number;
  aspect: '16:9' | '9:16';
  fontsDir: string;
}

/** Every graphic of the export as absolute-time libass events (computed once per export). */
export function buildDocGraphicsAssEvents(input: BuildDocGraphicsInput): GraphicAssEvent[] {
  const graphics = sanitizeDocGraphics(input.graphics).filter((g) => graphicShowsInAspect(g, input.aspect));
  if (graphics.length === 0) return [];
  const { outW, outH, fontsDir } = input;
  const k = outH / DOC_GRAPHICS_STAGE_HEIGHT;
  const stageW = outW / k;
  const stageH = DOC_GRAPHICS_STAGE_HEIGHT;
  const fonts = {
    'League Gothic': resolveExportFont('League Gothic', fontsDir),
    Georgia: resolveExportFont('Georgia', fontsDir),
  } as const;
  const measure = (text: string, font: DocGraphicFontName, px: number) => measureTextEm(text, fonts[font]) * px;
  const events: GraphicAssEvent[] = [];
  const finMs = Math.round(DOC_GRAPHIC_FADE_IN_SEC * 1000);
  const foutMs = Math.round(DOC_GRAPHIC_FADE_OUT_SEC * 1000);

  graphics.forEach((g, gi) => {
    const gStart = g.startSec;
    const gEnd = graphicEndSec(g);
    const layer = LAYER_BASE + (gi % 4) * 4;
    /** Pushes an event clamped to the graphic's life; fades only where it touches the graphic's edges. */
    const push = (s: number, e: number, lay: number, text: string, fadeIn = 0) => {
      const ss = Math.max(gStart, s);
      const ee = Math.min(gEnd, e);
      if (!(ee > ss + 0.004)) return;
      events.push({
        start: ss,
        end: ee,
        layer: lay,
        text,
        fadeInMs: ss <= gStart + 0.001 ? finMs : fadeIn,
        fadeOutMs: ee >= gEnd - 0.001 ? foutMs : 0,
      });
    };

    /** A text row with its shadow layers; `hiddenFrom` hides the characters from that index on (typewriter). */
    const textRowEvents = (row: GraphicTextRow, s: number, e: number, lay: number, opts: { hiddenFrom?: number; fadeIn?: number; rot?: { cx: number; cy: number; angle: number } } = {}) => {
      const font = fonts[row.font];
      const fsAss = Math.max(4, Math.round(row.fontPx * k * font.heightRatio * 10) / 10);
      const spacing = (row.letterSpacingEm * row.fontPx * k).toFixed(2);
      const an = row.anchor === 'middle' ? 5 : 4;
      const bold = row.font === 'Georgia' ? 1 : 0;
      const rot = opts.rot ? `\\org(${r1(opts.rot.cx * k)},${r1(opts.rot.cy * k)})\\frz${(-opts.rot.angle).toFixed(2)}` : '';
      const chars = Array.from(row.text);
      const cut = opts.hiddenFrom ?? chars.length;
      const visible = escapeAssText(chars.slice(0, cut).join(''));
      const hidden = cut < chars.length ? `{\\alpha&HFF&}${escapeAssText(chars.slice(cut).join(''))}` : '';
      const base = `\\an${an}\\fn${font.assName}\\fs${fsAss}\\b${bold}\\fsp${spacing}\\bord0\\shad0${rot}`;
      const isPaper = row.color === DOC_GRAPHIC_COLORS.ink || row.color === DOC_GRAPHIC_COLORS.inkSoft;
      if (!isPaper) {
        DOC_GRAPHIC_TEXT_SHADOW.forEach((sh, si) => {
          push(
            s,
            e,
            lay + si,
            `{${base}\\pos(${(row.x * k).toFixed(1)},${((row.yCenter + sh.dy) * k).toFixed(1)})\\blur${Math.max(0.5, (sh.blur * k) / 2).toFixed(1)}\\1c&H000000&\\1a${assAlpha(sh.alpha)}}${visible}${hidden}`,
            opts.fadeIn
          );
        });
      }
      push(
        s,
        e,
        lay + 2,
        `{${base}\\pos(${(row.x * k).toFixed(1)},${(row.yCenter * k).toFixed(1)})\\blur${(0.35 * Math.max(1, k)).toFixed(2)}\\1c${assHex(row.color)}\\1a&H00&}${visible}${hidden}`,
        opts.fadeIn
      );
    };

    if (g.kind === 'date_card') {
      const lay = layoutDateCard(g, stageW, stageH, measure);
      for (const row of lay.rows) {
        if (row.charAppear && row.charAppear.length) {
          // Typewriter: one step per visible letter
          const chars = Array.from(row.text);
          const steps: number[] = [];
          chars.forEach((ch, i) => {
            if (!/\s/.test(ch)) steps.push(i);
          });
          steps.forEach((ci, si) => {
            const s = row.charAppear![ci];
            const next = si + 1 < steps.length ? row.charAppear![steps[si + 1]] : gEnd;
            textRowEvents(row, s, next, layer, { hiddenFrom: ci + 1 });
          });
        } else {
          const s = row.appearSec ?? gStart;
          textRowEvents(row, s, gEnd, layer, { fadeIn: Math.round((row.appearFadeSec ?? 0) * 1000) });
        }
      }
      if (lay.rule) {
        const R = lay.rule;
        const steps = 10;
        for (let i = 1; i <= steps; i++) {
          const s = R.t0 + ((R.t1 - R.t0) * (i - 1)) / steps;
          const e = i === steps ? gEnd : R.t0 + ((R.t1 - R.t0) * i) / steps;
          const w = (R.w * i) / steps;
          const x0 = R.anchor === 'middle' ? R.x - w / 2 : R.x;
          push(s, e, layer + 3, `{\\an7\\pos(0,0)\\bord0\\shad0\\blur${(0.5 * k).toFixed(1)}\\1c${assHex(DOC_GRAPHIC_COLORS.dateGold)}\\1a&H00&\\p1}${rectDrawing(x0 * k, R.y * k, w * k, R.h * k)}{\\p0}`);
        }
      }
    } else if (g.kind === 'quote_card') {
      const lay = layoutQuoteCard(g, stageW, stageH, measure);
      const rot = { cx: lay.cx, cy: lay.cy, angle: lay.angle };
      const rotTags = `\\org(${r1(lay.cx * k)},${r1(lay.cy * k)})\\frz${(-lay.angle).toFixed(2)}`;
      const left = lay.cx - lay.w / 2;
      const top = lay.cy - lay.h / 2;
      // Drop shadow, paper, inner frame
      push(gStart, gEnd, layer, `{\\an7\\pos(0,0)${rotTags}\\bord0\\shad0\\blur${((16 * k) / 2).toFixed(1)}\\1c&H000000&\\1a${assAlpha(0.55)}\\p1}${rectDrawing(left * k, (top + 8) * k, lay.w * k, lay.h * k)}{\\p0}`);
      push(gStart, gEnd, layer + 1, `{\\an7\\pos(0,0)${rotTags}\\bord0\\shad0\\blur${(0.6 * k).toFixed(1)}\\1c${assHex(DOC_GRAPHIC_COLORS.paper)}\\1a&H00&\\p1}${rectDrawing(left * k, top * k, lay.w * k, lay.h * k)}{\\p0}`);
      push(gStart, gEnd, layer + 1, `{\\an7\\pos(0,0)${rotTags}\\bord${(0.8 * k).toFixed(1)}\\3c${assHex(DOC_GRAPHIC_COLORS.paperEdge)}\\3a${assAlpha(0.7)}\\shad0\\1a&HFF&\\p1}${rectDrawing((left + 5) * k, (top + 5) * k, (lay.w - 10) * k, (lay.h - 10) * k)}{\\p0}`);
      // Marker highlight, drawn on in steps
      for (const hl of lay.highlights) {
        const steps = Math.max(6, Math.round((hl.t1 - hl.t0) * 30));
        for (let i = 1; i <= steps; i++) {
          const s = hl.t0 + ((hl.t1 - hl.t0) * (i - 1)) / steps;
          const e = i === steps ? gEnd : hl.t0 + ((hl.t1 - hl.t0) * i) / steps;
          const w = (hl.w * i) / steps;
          push(s, e, layer + 2, `{\\an7\\pos(0,0)${rotTags}\\bord0\\shad0\\blur${(0.8 * k).toFixed(1)}\\1c${assHex(DOC_GRAPHIC_COLORS.marker)}\\1a${assAlpha(0.62)}\\p1}${rectDrawing(hl.x * k, hl.y * k, w * k, hl.h * k)}{\\p0}`);
        }
      }
      for (const row of [...lay.quoteRows, ...lay.sourceRows]) {
        textRowEvents(row, gStart, gEnd, layer + 1, { rot });
      }
    } else if (g.kind === 'route_map') {
      const lay = layoutRoute(g, stageW, stageH);
      if (!lay) return;
      const lw = lay.lineWidth * k;
      const ow = (lay.outlineWidth * k).toFixed(1);
      for (const dash of lay.dashes) {
        const drawing = dash.pieces
          .map((p) => polygonDrawing(segmentQuad(p.x1 * k, p.y1 * k, p.x2 * k, p.y2 * k, lw)))
          .join(' ');
        push(dash.appearSec, gEnd, layer, `{\\an7\\pos(0,0)\\bord${ow}\\3c${assHex(DOC_GRAPHIC_COLORS.routeOutline)}\\3a&H30&\\shad0\\blur${(0.4 * k).toFixed(1)}\\1c${assHex(DOC_GRAPHIC_COLORS.route)}\\1a&H00&\\p1}${drawing}{\\p0}`);
      }
      const sd = lay.startDot;
      push(sd.appearSec, gEnd, layer + 1, `{\\an7\\pos(0,0)\\bord${(1.5 * k).toFixed(1)}\\3c${assHex(DOC_GRAPHIC_COLORS.routeOutline)}\\shad0\\1c${assHex(DOC_GRAPHIC_COLORS.routeDot)}\\1a&H00&\\p1}${circleDrawing(sd.x * k, sd.y * k, sd.r * k)}{\\p0}`);
      // Moving icon: one static frame every 1/30 s while the line draws, then it rests at the end
      const headEvent = (s: number, e: number, t: number) => {
        const h = routeHeadAt(lay, t);
        if (lay.icon === 'dot') {
          push(s, e, layer + 2, `{\\an7\\pos(0,0)\\bord${(1.5 * k).toFixed(1)}\\3c${assHex(DOC_GRAPHIC_COLORS.routeOutline)}\\shad0\\blur${(0.6 * k).toFixed(1)}\\1c${assHex(DOC_GRAPHIC_COLORS.route)}\\1a&H00&\\p1}${circleDrawing(h.x * k, h.y * k, 5 * k)}{\\p0}`);
          return;
        }
        const polys = routeIconPolygons(lay.icon, lay.iconSize, h.x, h.y, h.angle);
        const drawing = polys.map((poly) => polygonDrawing(poly.map(([x, y]) => [x * k, y * k] as [number, number]))).join(' ');
        push(s, e, layer + 2, `{\\an7\\pos(0,0)\\bord${(1.4 * k).toFixed(1)}\\3c${assHex(DOC_GRAPHIC_COLORS.routeOutline)}\\shad0\\blur${(0.5 * k).toFixed(1)}\\1c${assHex('#f8f1e0')}\\1a&H00&\\p1}${drawing}{\\p0}`);
      };
      const frame = 1 / 30;
      for (let t = lay.drawStart; t < lay.drawEnd - 1e-6; t += frame) {
        headEvent(t, Math.min(lay.drawEnd, t + frame), t);
      }
      headEvent(lay.drawEnd, gEnd, lay.drawEnd);
      if (lay.label) {
        const lb = lay.label;
        textRowEvents(
          {
            text: lb.text,
            font: 'Georgia',
            fontPx: lb.fontPx,
            letterSpacingEm: 0.08,
            color: DOC_GRAPHIC_COLORS.labelText,
            anchor: 'middle',
            x: lb.x,
            yCenter: lb.y,
          },
          lb.appearSec,
          gEnd,
          layer + 1,
          { fadeIn: 400 }
        );
      }
    }
  });
  return events;
}

/** Dialogue lines of the events that overlap one exported segment, in that segment's local time. */
export function sliceDocGraphicsForSegment(events: GraphicAssEvent[], segStartSec: number, segDurSec: number): string[] {
  const segEnd = segStartSec + segDurSec;
  const out: string[] = [];
  for (const ev of events) {
    if (!(ev.end > segStartSec + 0.004 && ev.start < segEnd - 0.004)) continue;
    const ls = Math.max(0, ev.start - segStartSec);
    const le = Math.min(segDurSec, ev.end - segStartSec);
    if (le <= ls + 0.004) continue;
    const fin = ev.start >= segStartSec - 0.001 ? ev.fadeInMs : 0;
    const fout = ev.end <= segEnd + 0.001 ? ev.fadeOutMs : 0;
    const fad = fin || fout ? `\\fad(${fin},${fout})` : '';
    const text = fad && ev.text.startsWith('{') ? `{${fad}${ev.text.slice(1)}` : ev.text;
    out.push(`Dialogue: ${ev.layer},${formatAssTime(ls)},${formatAssTime(le)},Overlay,,0,0,0,,${text}`);
  }
  return out;
}
