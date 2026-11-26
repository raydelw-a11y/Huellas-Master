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
  isGraphicDrawable,
  layoutDateCard,
  layoutQuoteCard,
  layoutRoute,
  layoutCircleMark,
  circleProgress,
  layoutNameTag,
  layoutThesisCard,
  layoutStamp,
  stampPose,
  stampPoseTimes,
  routeHeadAt,
  routeIconPolygons,
  sanitizeDocGraphics,
  type DocGraphic,
  type DocGraphicFontName,
  type GraphicTextRow,
} from '../src/utils/docGraphics';
import { escapeAssText, formatAssTime, measureTextEm, resolveExportFont } from './exportOverlayAss';
import fs from 'fs';
import {
  DEFAULT_GRAPHICS_SFX_VOLUME_PCT,
  docGraphicSfxEvents,
  renderGraphicSfxTrack,
  type DocGraphicMeasure,
} from '../src/utils/docGraphics';

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
  const graphics = sanitizeDocGraphics(input.graphics).filter(
    (g) => graphicShowsInAspect(g, input.aspect) && isGraphicDrawable(g)
  );
  if (graphics.length === 0) return [];
  const { outW, outH, fontsDir } = input;
  const k = outH / DOC_GRAPHICS_STAGE_HEIGHT;
  const stageW = outW / k;
  const stageH = DOC_GRAPHICS_STAGE_HEIGHT;
  const fonts = {
    'League Gothic': resolveExportFont('League Gothic', fontsDir),
    Georgia: resolveExportFont('Georgia', fontsDir),
    'Courier New': resolveExportFont('Courier New', fontsDir),
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
    const textRowEvents = (row: GraphicTextRow, s: number, e: number, lay: number, opts: { hiddenFrom?: number; fadeIn?: number; rot?: { cx: number; cy: number; angle: number }; noShadow?: boolean } = {}) => {
      const font = fonts[row.font];
      const fsAss = Math.max(4, Math.round(row.fontPx * k * font.heightRatio * 10) / 10);
      const spacing = (row.letterSpacingEm * row.fontPx * k).toFixed(2);
      const an = row.anchor === 'middle' ? 5 : 4;
      const bold = row.font === 'League Gothic' ? 0 : 1;
      const rot = opts.rot ? `\\org(${r1(opts.rot.cx * k)},${r1(opts.rot.cy * k)})\\frz${(-opts.rot.angle).toFixed(2)}` : '';
      const chars = Array.from(row.text);
      const cut = opts.hiddenFrom ?? chars.length;
      const visible = escapeAssText(chars.slice(0, cut).join(''));
      const hidden = cut < chars.length ? `{\\alpha&HFF&}${escapeAssText(chars.slice(cut).join(''))}` : '';
      const base = `\\an${an}\\fn${font.assName}\\fs${fsAss}\\b${bold}\\fsp${spacing}\\bord0\\shad0${rot}`;
      const isPaper = opts.noShadow || row.color === DOC_GRAPHIC_COLORS.ink || row.color === DOC_GRAPHIC_COLORS.inkSoft;
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

    /** A row that is typed letter by letter (charAppear) or fades in whole (appearSec). */
    const rowEvents = (row: GraphicTextRow, lay: number, opts: { rot?: { cx: number; cy: number; angle: number }; noShadow?: boolean } = {}) => {
      if (row.charAppear && row.charAppear.length) {
        const chars = Array.from(row.text);
        const steps: number[] = [];
        chars.forEach((ch, i) => {
          if (!/\s/.test(ch)) steps.push(i);
        });
        steps.forEach((ci, si) => {
          const st = row.charAppear![ci];
          const next = si + 1 < steps.length ? row.charAppear![steps[si + 1]] : gEnd;
          textRowEvents(row, st, next, lay, { ...opts, hiddenFrom: ci + 1 });
        });
      } else {
        textRowEvents(row, row.appearSec ?? gStart, gEnd, lay, { ...opts, fadeIn: Math.round((row.appearFadeSec ?? 0) * 1000) });
      }
    };
    /** Thick polyline as one drawing of slightly overlapping quads (output px). */
    const polylineDrawing = (pts: Array<{ x: number; y: number }>, w: number) => {
      const parts: string[] = [];
      for (let i = 1; i < pts.length; i++) {
        const a = pts[i - 1];
        const b = pts[i];
        const len = Math.hypot(b.x - a.x, b.y - a.y) || 1;
        const ex = ((b.x - a.x) / len) * (w / 2);
        const ey = ((b.y - a.y) / len) * (w / 2);
        parts.push(polygonDrawing(segmentQuad((a.x - ex) * k, (a.y - ey) * k, (b.x + ex) * k, (b.y + ey) * k, w * k)));
      }
      return parts.join(' ');
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
    } else if (g.kind === 'circle_mark') {
      const C = layoutCircleMark(g, stageW, stageH);
      const steps = 14;
      for (let i = 1; i <= steps; i++) {
        const st = C.t0 + ((C.t1 - C.t0) * (i - 1)) / steps;
        const en = i === steps ? gEnd : C.t0 + ((C.t1 - C.t0) * i) / steps;
        const prog = circleProgress(C, C.t0 + ((C.t1 - C.t0) * i) / steps);
        const count = Math.max(2, Math.ceil(prog * (C.pts.length - 1)) + 1);
        const d = polylineDrawing(C.pts.slice(0, count), C.width);
        push(st, en, layer, `{\\an7\\pos(0,0)\\bord0\\shad0\\blur${(0.6 * k).toFixed(1)}\\1c${assHex(DOC_GRAPHIC_COLORS.redInk)}\\1a&H08&\\p1}${d}{\\p0}`);
      }
    } else if (g.kind === 'name_tag') {
      const N = layoutNameTag(g, stageW, stageH, measure, input.aspect);
      const bx = N.box;
      const rot = { cx: bx.x + bx.w / 2, cy: bx.y + bx.h / 2, angle: bx.angle };
      const rotTags = `\\org(${r1(rot.cx * k)},${r1(rot.cy * k)})\\frz${(-bx.angle).toFixed(2)}`;
      if (N.line) {
        const Ln = N.line;
        const steps = 8;
        for (let i = 1; i <= steps; i++) {
          const st = Ln.t0 + ((Ln.t1 - Ln.t0) * (i - 1)) / steps;
          const en = i === steps ? gEnd : Ln.t0 + ((Ln.t1 - Ln.t0) * i) / steps;
          const f = i / steps;
          const d = polygonDrawing(segmentQuad(Ln.x1 * k, Ln.y1 * k, (Ln.x1 + (Ln.x2 - Ln.x1) * f) * k, (Ln.y1 + (Ln.y2 - Ln.y1) * f) * k, 2.2 * k));
          push(st, en, layer, `{\\an7\\pos(0,0)\\bord0\\shad0\\blur${(0.4 * k).toFixed(1)}\\1c${assHex(DOC_GRAPHIC_COLORS.redInk)}\\1a&H00&\\p1}${d}{\\p0}`);
        }
        push(Ln.t1, gEnd, layer, `{\\an7\\pos(0,0)\\bord0\\shad0\\1c${assHex(DOC_GRAPHIC_COLORS.redInk)}\\1a&H00&\\p1}${circleDrawing(Ln.x2 * k, Ln.y2 * k, 3.5 * k)}{\\p0}`);
      }
      push(gStart, gEnd, layer, `{\\an7\\pos(0,0)${rotTags}\\bord0\\shad0\\blur${(5 * k).toFixed(1)}\\1c&H000000&\\1a${assAlpha(0.45)}\\p1}${rectDrawing(bx.x * k, (bx.y + 3) * k, bx.w * k, bx.h * k)}{\\p0}`);
      push(gStart, gEnd, layer + 1, `{\\an7\\pos(0,0)${rotTags}\\bord0\\shad0\\blur${(0.5 * k).toFixed(1)}\\1c${assHex(DOC_GRAPHIC_COLORS.tape)}\\1a${assAlpha(0.92)}\\p1}${rectDrawing(bx.x * k, bx.y * k, bx.w * k, bx.h * k)}{\\p0}`);
      for (const row of N.rows) rowEvents(row, layer + 1, { rot, noShadow: true });
    } else if (g.kind === 'thesis_card') {
      const T = layoutThesisCard(g, stageW, stageH, measure);
      const P = T.panel;
      push(gStart, gEnd, layer, `{\\an7\\pos(0,0)\\bord0\\shad0\\blur${(0.6 * k).toFixed(1)}\\1c${assHex(DOC_GRAPHIC_COLORS.thesisPanel)}\\1a${assAlpha(0.72)}\\p1}${rectDrawing(P.x * k, P.y * k, P.w * k, P.h * k)}{\\p0}`);
      push(gStart, gEnd, layer, `{\\an7\\pos(0,0)\\bord${(0.8 * k).toFixed(1)}\\3c${assHex(DOC_GRAPHIC_COLORS.dateGold)}\\3a${assAlpha(0.6)}\\shad0\\1a&HFF&\\p1}${rectDrawing((P.x + 4) * k, (P.y + 4) * k, (P.w - 8) * k, (P.h - 8) * k)}{\\p0}`);
      for (const row of T.oldRows) rowEvents(row, layer + 1, { noShadow: true });
      for (const sk of T.strikes) {
        const steps = 8;
        for (let i = 1; i <= steps; i++) {
          const st = sk.t0 + ((sk.t1 - sk.t0) * (i - 1)) / steps;
          const en = i === steps ? gEnd : sk.t0 + ((sk.t1 - sk.t0) * i) / steps;
          push(st, en, layer + 3, `{\\an7\\pos(0,0)\\bord0\\shad0\\blur${(0.4 * k).toFixed(1)}\\1c${assHex(DOC_GRAPHIC_COLORS.redInk)}\\1a&H00&\\p1}${rectDrawing(sk.x * k, (sk.y - 1.5) * k, ((sk.w * i) / steps) * k, 3 * k)}{\\p0}`);
        }
      }
      for (const row of T.newRows) rowEvents(row, layer + 1, { noShadow: true });
    } else if (g.kind === 'stamp') {
      const S = layoutStamp(g, stageW, stageH, measure);
      const times = stampPoseTimes(S);
      const font = fonts['League Gothic'];
      times.forEach((tt, i) => {
        const en = i + 1 < times.length ? times[i + 1] : gEnd;
        const pose = stampPose(S, tt + 0.001);
        const cx = S.cx + pose.dx;
        const cy = S.cy + pose.dy;
        const w = S.w * pose.scale;
        const h = S.h * pose.scale;
        const rot = `\\org(${r1(cx * k)},${r1(cy * k)})\\frz${(-S.angle).toFixed(2)}`;
        const a = assAlpha(pose.alpha);
        push(tt, en, layer, `{\\an7\\pos(0,0)${rot}\\bord${(3 * pose.scale * k).toFixed(1)}\\3c${assHex(DOC_GRAPHIC_COLORS.stampInk)}\\3a${a}\\shad0\\blur${(0.6 * k).toFixed(1)}\\1a&HFF&\\p1}${rectDrawing((cx - w / 2) * k, (cy - h / 2) * k, w * k, h * k)}{\\p0}`);
        push(tt, en, layer, `{\\an7\\pos(0,0)${rot}\\bord${(1.4 * pose.scale * k).toFixed(1)}\\3c${assHex(DOC_GRAPHIC_COLORS.stampInk)}\\3a${a}\\shad0\\blur${(0.5 * k).toFixed(1)}\\1a&HFF&\\p1}${rectDrawing((cx - w / 2 + 6 * pose.scale) * k, (cy - h / 2 + 6 * pose.scale) * k, (w - 12 * pose.scale) * k, (h - 12 * pose.scale) * k)}{\\p0}`);
        const fsAss = Math.max(4, Math.round(S.fontPx * pose.scale * k * font.heightRatio * 10) / 10);
        push(tt, en, layer + 1, `{\\an5\\pos(${(cx * k).toFixed(1)},${(cy * k).toFixed(1)})${rot}\\fn${font.assName}\\fs${fsAss}\\b0\\fsp${(0.06 * S.fontPx * pose.scale * k).toFixed(2)}\\bord0\\shad0\\blur${(0.6 * k).toFixed(1)}\\1c${assHex(DOC_GRAPHIC_COLORS.stampInk)}\\1a${a}}${escapeAssText(S.text)}`);
      });
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

/** Text widths from the real TTF files (the same ones libass draws with). */
export function makeServerGraphicMeasure(fontsDir: string): DocGraphicMeasure {
  const fonts = {
    'League Gothic': resolveExportFont('League Gothic', fontsDir),
    Georgia: resolveExportFont('Georgia', fontsDir),
    'Courier New': resolveExportFont('Courier New', fontsDir),
  } as const;
  return (text, font, px) => measureTextEm(text, fonts[font]) * px;
}

/**
 * Writes the graphics' sound effects (typing, thuds, whooshes, pen strokes, stamps) as one mono 16-bit WAV that
 * starts at timeline 0, or returns false when there is nothing to play.
 */
export function writeGraphicSfxWav(input: {
  graphics: unknown;
  aspect: '16:9' | '9:16';
  fontsDir: string;
  volumePct?: number;
  outPath: string;
  sampleRate?: number;
}): boolean {
  const vol = Number.isFinite(Number(input.volumePct)) ? Number(input.volumePct) : DEFAULT_GRAPHICS_SFX_VOLUME_PCT;
  if (!(vol > 0)) return false;
  const graphics = sanitizeDocGraphics(input.graphics);
  if (!graphics.length) return false;
  const events = docGraphicSfxEvents(graphics, input.aspect, makeServerGraphicMeasure(input.fontsDir));
  if (!events.length) return false;
  const sr = input.sampleRate || 32000;
  const pcm = renderGraphicSfxTrack(events, sr, vol);
  const buf = Buffer.alloc(44 + pcm.length * 2);
  buf.write('RIFF', 0);
  buf.writeUInt32LE(36 + pcm.length * 2, 4);
  buf.write('WAVE', 8);
  buf.write('fmt ', 12);
  buf.writeUInt32LE(16, 16);
  buf.writeUInt16LE(1, 20);
  buf.writeUInt16LE(1, 22);
  buf.writeUInt32LE(sr, 24);
  buf.writeUInt32LE(sr * 2, 28);
  buf.writeUInt16LE(2, 32);
  buf.writeUInt16LE(16, 34);
  buf.write('data', 36);
  buf.writeUInt32LE(pcm.length * 2, 40);
  for (let i = 0; i < pcm.length; i++) buf.writeInt16LE(Math.round(pcm[i] * 32767), 44 + i * 2);
  fs.writeFileSync(input.outPath, buf);
  return true;
}
