/**
 * Export overlay ASS builder — WYSIWYG parity with the CapCut editor viewer.
 *
 * The editor viewer lays out every overlay on a canonical stage that is 520 px tall
 * (16:9 → 924.4 × 520, 9:16 → 292.5 × 520) and scales it uniformly to the visible size.
 * This module reproduces that exact CSS geometry at export resolution:
 *   k = outH / 520  (stage px → output px)
 *
 * libass sizes text so that (OS/2 winAscent + winDescent) == Fontsize, while CSS sizes the
 * em box. We therefore read the real font metrics (and glyph advances for pill widths) from
 * the bundled TTF files in data/fonts so a CSS `font-size: Npx` maps to the identical glyph size.
 */
import fs from 'fs';
import path from 'path';

export const EDITOR_STAGE_HEIGHT = 520;

export type ExportAnimType =
  | 'none'
  | 'fade'
  | 'slide_up'
  | 'slide_down'
  | 'slide_left'
  | 'slide_right'
  | 'zoom_in'
  | 'zoom_out'
  | 'pop'
  | 'blur_fade';

export type ExportShadowStyle = 'none' | 'soft' | 'cinema' | 'outline' | 'gold_glow';
export type ExportBgStyle = 'none' | 'word_shadow' | 'semi' | 'solid' | 'pill';

export interface ExportCaptionStyle {
  fontFamily?: string;
  /** Editor font size setting for the active ratio (viewer renders max(13, size * 0.76) stage px). */
  fontSize?: number;
  color?: string;
  bgStyle?: ExportBgStyle | string;
  bgColor?: string;
  bgOpacity?: number;
  shadowStyle?: ExportShadowStyle | string;
  bottomPct?: number;
  animIn?: ExportAnimType | string;
  animOut?: ExportAnimType | string;
  animDur?: number;
}

export interface ExportHookConfig {
  line1?: string;
  line2?: string;
  /** Timeline seconds (same coordinate space as the editor playhead). */
  line1StartSec: number;
  line2StartSec: number;
  endSec: number;
  fontFamily?: string;
  line1FontSize?: number;
  line2FontSize?: number;
  line1Color?: string;
  line2Color?: string;
  leftPct?: number;
  topPct?: number;
  boxWidthPct?: number;
  bgStyle?: ExportBgStyle | string;
  bgColor?: string;
  bgOpacity?: number;
  shadowStyle?: ExportShadowStyle | string;
  line1AnimIn?: ExportAnimType | string;
  line1AnimInDur?: number;
  line1AnimOut?: ExportAnimType | string;
  line1AnimOutDur?: number;
  line2AnimIn?: ExportAnimType | string;
  line2AnimInDur?: number;
  line2AnimOut?: ExportAnimType | string;
  line2AnimOutDur?: number;
}

export interface ExportTimelineCaption {
  startSec: number;
  endSec: number;
  text: string;
}

interface FontInfo {
  assName: string;
  /** (winAscent + winDescent) / unitsPerEm */
  heightRatio: number;
  /** winAscent / unitsPerEm */
  ascentRatio: number;
  advance: (ch: string) => number; // em units
}

const FONT_TABLE: Array<{ match: RegExp; assName: string; file: string | null }> = [
  // index.css aliases 'Cinzel' to local('Georgia') → the viewer actually paints Georgia.
  { match: /^(cinzel|georgia|times new roman|serif)$/i, assName: 'Georgia', file: 'Georgia-Bold.ttf' },
  { match: /^playfair display$/i, assName: 'Playfair Display', file: 'PlayfairDisplay-Bold.ttf' },
  // Not loaded as webfonts → the browser falls back to these system faces on macOS.
  { match: /^(montserrat|helvetica neue|system-ui|-apple-system|blinkmacsystemfont|inter|arial|sans-serif)$/i, assName: 'Helvetica Neue', file: null },
  { match: /^(oswald|impact|arial black)$/i, assName: 'Impact', file: null },
  { match: /^(courier new|courier|monospace)$/i, assName: 'Courier New', file: null },
];

const fontCache = new Map<string, FontInfo>();

function parseTtf(filePath: string, assName: string): FontInfo | null {
  try {
    const b = fs.readFileSync(filePath);
    const numTables = b.readUInt16BE(4);
    const tables: Record<string, number> = {};
    for (let i = 0; i < numTables; i++) {
      const o = 12 + i * 16;
      tables[b.toString('ascii', o, o + 4)] = b.readUInt32BE(o + 8);
    }
    if (tables.head === undefined || tables['OS/2'] === undefined) return null;
    const upem = b.readUInt16BE(tables.head + 18);
    const winA = b.readUInt16BE(tables['OS/2'] + 74);
    const winD = b.readUInt16BE(tables['OS/2'] + 76);

    // Glyph advances via cmap (format 4) + hmtx
    const glyphAdvance = new Map<number, number>();
    let defaultAdvance = 0.55;
    if (tables.cmap !== undefined && tables.hmtx !== undefined && tables.hhea !== undefined) {
      const numHMetrics = b.readUInt16BE(tables.hhea + 34);
      const advOf = (gid: number) =>
        b.readUInt16BE(tables.hmtx + 4 * Math.min(gid, numHMetrics - 1)) / upem;
      const cmap = tables.cmap;
      const nSub = b.readUInt16BE(cmap + 2);
      let sub = -1;
      for (let i = 0; i < nSub; i++) {
        const pid = b.readUInt16BE(cmap + 4 + i * 8);
        const eid = b.readUInt16BE(cmap + 6 + i * 8);
        const off = b.readUInt32BE(cmap + 8 + i * 8);
        if (pid === 3 && eid === 1 && b.readUInt16BE(cmap + off) === 4) sub = cmap + off;
      }
      if (sub >= 0) {
        const segX2 = b.readUInt16BE(sub + 6);
        const endBase = sub + 14;
        const startBase = endBase + segX2 + 2;
        const deltaBase = startBase + segX2;
        const rangeBase = deltaBase + segX2;
        const lookup = (code: number): number => {
          for (let s = 0; s < segX2 / 2; s++) {
            const end = b.readUInt16BE(endBase + s * 2);
            if (code > end) continue;
            const start = b.readUInt16BE(startBase + s * 2);
            if (code < start) return 0;
            const delta = b.readInt16BE(deltaBase + s * 2);
            const ro = b.readUInt16BE(rangeBase + s * 2);
            if (ro === 0) return (code + delta) & 0xffff;
            const gAddr = rangeBase + s * 2 + ro + (code - start) * 2;
            const g = b.readUInt16BE(gAddr);
            return g === 0 ? 0 : (g + delta) & 0xffff;
          }
          return 0;
        };
        for (let code = 0x20; code <= 0x24f; code++) {
          const gid = lookup(code);
          if (gid) glyphAdvance.set(code, advOf(gid));
        }
        glyphAdvance.set(0xa0, glyphAdvance.get(0x20) || 0.25);
        defaultAdvance = glyphAdvance.get('n'.charCodeAt(0)) || defaultAdvance;
      }
    }
    return {
      assName,
      heightRatio: (winA + winD) / upem,
      ascentRatio: winA / upem,
      advance: (ch: string) => glyphAdvance.get(ch.charCodeAt(0)) ?? defaultAdvance,
    };
  } catch {
    return null;
  }
}

export function resolveExportFont(cssFamily: string | undefined, fontsDir: string): FontInfo {
  const first = String(cssFamily || "'Cinzel', Georgia, serif")
    .split(',')[0]
    .replace(/['"]/g, '')
    .trim();
  const entry = FONT_TABLE.find((f) => f.match.test(first)) || FONT_TABLE[0];
  const cacheKey = `${entry.assName}|${fontsDir}`;
  const cached = fontCache.get(cacheKey);
  if (cached) return cached;
  let info: FontInfo | null = null;
  if (entry.file) info = parseTtf(path.join(fontsDir, entry.file), entry.assName);
  if (!info) {
    info = {
      assName: entry.assName,
      heightRatio: 1.15,
      ascentRatio: 0.92,
      advance: (ch: string) => (ch === ' ' || ch === ' ' ? 0.28 : /[A-ZÁÉÍÓÚÑÜ]/.test(ch) ? 0.68 : 0.56),
    };
  }
  fontCache.set(cacheKey, info);
  return info;
}

export function measureTextEm(text: string, font: FontInfo, letterSpacingEm = 0): number {
  let w = 0;
  for (const ch of text) w += font.advance(ch) + letterSpacingEm;
  return w;
}

/** Greedy word wrap identical to the browser for white-space: pre-line (NBSP never breaks). */
export function wrapToWidthEm(text: string, maxEm: number, font: FontInfo, letterSpacingEm = 0): string[] {
  if (/\r?\n/.test(String(text || ''))) {
    return String(text)
      .split(/\r?\n/)
      .map((l) => l.trim())
      .filter(Boolean)
      .flatMap((l) => wrapToWidthEm(l, maxEm, font, letterSpacingEm));
  }
  const words = String(text || '').split(' ').filter((w) => w.length > 0);
  if (words.length === 0) return [];
  const rows: string[] = [];
  let cur = '';
  for (const w of words) {
    const cand = cur ? `${cur} ${w}` : w;
    if (!cur || measureTextEm(cand, font, letterSpacingEm) <= maxEm + 1e-6) cur = cand;
    else {
      rows.push(cur);
      cur = w;
    }
  }
  if (cur) rows.push(cur);
  return rows;
}

// ---------- ASS primitives ----------

export function formatAssTime(sec: number): string {
  const clamped = Math.max(0, sec);
  const totalCs = Math.round(clamped * 100);
  const h = Math.floor(totalCs / 360000);
  const m = Math.floor((totalCs % 360000) / 6000);
  const s = Math.floor((totalCs % 6000) / 100);
  const cs = totalCs % 100;
  return `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}.${String(cs).padStart(2, '0')}`;
}

export function escapeAssText(t: string): string {
  return String(t || '')
    .replace(/\\/g, '\\\\')
    .replace(/\{/g, '\\{')
    .replace(/\}/g, '\\}')
    .replace(/\r?\n/g, '\\N');
}

/** '#rrggbb' + opacity (0..1) → ASS &HAABBGGRR */
function assColor(hex: string | undefined, opacity: number, fallback = 'ffffff'): string {
  const clean = String(hex || '').replace('#', '');
  const rgb = /^[0-9a-fA-F]{6}$/.test(clean) ? clean : fallback;
  const a = Math.max(0, Math.min(255, Math.round((1 - Math.max(0, Math.min(1, opacity))) * 255)));
  const hx = (n: number) => n.toString(16).toUpperCase().padStart(2, '0');
  return `&H${hx(a)}${rgb.slice(4, 6).toUpperCase()}${rgb.slice(2, 4).toUpperCase()}${rgb.slice(0, 2).toUpperCase()}`;
}

function roundRectDrawing(w: number, h: number, r: number): string {
  const x1 = Math.max(2, Math.round(w));
  const y1 = Math.max(2, Math.round(h));
  const rad = Math.max(0, Math.min(Math.round(r), Math.floor(x1 / 2), Math.floor(y1 / 2)));
  const k = Math.round(rad * 0.552);
  return [
    `m ${rad} 0`,
    `l ${x1 - rad} 0`,
    `b ${x1 - rad + k} 0 ${x1} ${rad - k} ${x1} ${rad}`,
    `l ${x1} ${y1 - rad}`,
    `b ${x1} ${y1 - rad + k} ${x1 - rad + k} ${y1} ${x1 - rad} ${y1}`,
    `l ${rad} ${y1}`,
    `b ${rad - k} ${y1} 0 ${y1 - rad + k} 0 ${y1 - rad}`,
    `l 0 ${rad}`,
    `b 0 ${rad - k} ${rad - k} 0 ${rad} 0`,
  ].join(' ');
}

/** CSS text-shadow presets from CapCutEditor getTextShadowCss() expressed in stage px. */
function textShadowLayers(style: string | undefined): {
  outlinePx: number;
  layers: Array<{ dx: number; dy: number; blur: number; color: string; alpha: number }>;
} {
  switch (style) {
    case 'none':
      return { outlinePx: 0, layers: [] };
    case 'soft':
      return { outlinePx: 0, layers: [{ dx: 0, dy: 2, blur: 6, color: '000000', alpha: 0.85 }] };
    case 'outline':
      return { outlinePx: 2, layers: [{ dx: 0, dy: 4, blur: 10, color: '000000', alpha: 0.95 }] };
    case 'gold_glow':
      return {
        outlinePx: 0,
        layers: [
          { dx: 0, dy: 0, blur: 14, color: 'f59e0b', alpha: 0.75 },
          { dx: 0, dy: 3, blur: 10, color: '000000', alpha: 0.95 },
        ],
      };
    case 'cinema':
    default:
      return {
        outlinePx: 0,
        layers: [
          { dx: 0, dy: 4, blur: 16, color: '000000', alpha: 0.98 },
          { dx: 0, dy: 2, blur: 4, color: '000000', alpha: 0.95 },
        ],
      };
  }
}

function fadeMs(anim: string | undefined, dur: number | undefined, fallback: number): number {
  if (anim === 'none') return 0;
  const d = Number.isFinite(Number(dur)) && Number(dur) > 0 ? Number(dur) : fallback;
  return Math.round(Math.max(0.05, d) * 1000);
}

interface TextEventSpec {
  startSec: number;
  endSec: number;
  fadeInMs: number;
  fadeOutMs: number;
  x: number;
  yCenter: number;
  text: string;
  font: FontInfo;
  cssPx: number; // output px em size
  bold: boolean;
  colorHex: string;
  letterSpacingEm: number;
  shadowStyle: string | undefined;
  k: number;
  layerBase: number;
}

function pushTextEvents(events: string[], s: TextEventSpec): void {
  const fs = Math.max(4, Math.round(s.cssPx * s.font.heightRatio * 10) / 10);
  const spacing = (s.letterSpacingEm * s.cssPx).toFixed(2);
  const t0 = formatAssTime(s.startSec);
  const t1 = formatAssTime(s.endSec);
  const fad = `\\fad(${s.fadeInMs},${s.fadeOutMs})`;
  const base = `\\an5\\fn${s.font.assName}\\fs${fs}\\b${s.bold ? 1 : 0}\\fsp${spacing}\\shad0`;
  const txt = escapeAssText(s.text);
  const { outlinePx, layers } = textShadowLayers(s.shadowStyle);
  layers.forEach((ly, idx) => {
    const sigma = Math.max(0.5, (ly.blur * s.k) / 2);
    events.push(
      `Dialogue: ${s.layerBase + idx},${t0},${t1},Overlay,,0,0,0,,{${base}\\bord0\\pos(${(s.x + ly.dx * s.k).toFixed(1)},${(s.yCenter + ly.dy * s.k).toFixed(1)})${fad}\\blur${sigma.toFixed(1)}\\1c${assColor(ly.color, 1).replace(/^&H00/, '&H')}&\\1a&H${Math.round((1 - ly.alpha) * 255).toString(16).toUpperCase().padStart(2, '0')}&}${txt}`
    );
  });
  const bordTags = outlinePx > 0 ? `\\bord${(outlinePx * s.k).toFixed(1)}\\3c&H000000&\\3a&H00&` : '\\bord0';
  events.push(
    `Dialogue: ${s.layerBase + 5},${t0},${t1},Overlay,,0,0,0,,{${base}${bordTags}\\pos(${s.x.toFixed(1)},${s.yCenter.toFixed(1)})${fad}\\1c${assColor(s.colorHex, 1).replace(/^&H00/, '&H')}&\\1a&H00&}${txt}`
  );
}

interface PillSpec {
  startSec: number;
  endSec: number;
  fadeInMs: number;
  fadeOutMs: number;
  cx: number;
  cy: number;
  w: number;
  h: number;
  radius: number;
  colorHex: string;
  opacity: number;
  /** CSS box-shadow `0 0 blur spread` drawn only outside the pill (CSS clips outer shadows). */
  shadowBlur: number;
  shadowSpread: number;
  shadowOpacity: number;
  layer: number;
}

function pushPillEvents(events: string[], p: PillSpec): void {
  const t0 = formatAssTime(p.startSec);
  const t1 = formatAssTime(p.endSec);
  const fad = `\\fad(${p.fadeInMs},${p.fadeOutMs})`;
  const x0 = p.cx - p.w / 2;
  const y0 = p.cy - p.h / 2;
  if (p.shadowOpacity > 0.001 && p.shadowBlur > 0) {
    const sw = p.w + p.shadowSpread * 2;
    const sh = p.h + p.shadowSpread * 2;
    const iclip = `\\iclip(${Math.round(x0)},${Math.round(y0)},${Math.round(x0 + p.w)},${Math.round(y0 + p.h)})`;
    events.push(
      `Dialogue: ${p.layer},${t0},${t1},Overlay,,0,0,0,,{\\an7\\pos(${(x0 - p.shadowSpread).toFixed(1)},${(y0 - p.shadowSpread).toFixed(1)})${fad}${iclip}\\bord0\\shad0\\blur${(p.shadowBlur / 2).toFixed(1)}\\1c${assColor(p.colorHex, 1).replace(/^&H00/, '&H')}&\\1a&H${Math.round((1 - p.shadowOpacity) * 255).toString(16).toUpperCase().padStart(2, '0')}&\\p1}${roundRectDrawing(sw, sh, p.radius + p.shadowSpread)}{\\p0}`
    );
  }
  events.push(
    `Dialogue: ${p.layer + 1},${t0},${t1},Overlay,,0,0,0,,{\\an7\\pos(${x0.toFixed(1)},${y0.toFixed(1)})${fad}\\bord0\\shad0\\blur0.6\\1c${assColor(p.colorHex, 1).replace(/^&H00/, '&H')}&\\1a&H${Math.round((1 - p.opacity) * 255).toString(16).toUpperCase().padStart(2, '0')}&\\p1}${roundRectDrawing(p.w, p.h, p.radius)}{\\p0}`
  );
}

export interface BuildSegmentAssInput {
  outW: number;
  outH: number;
  fontsDir: string;
  segStartSec: number;
  segDurSec: number;
  captions: ExportTimelineCaption[];
  captionStyle: ExportCaptionStyle | null;
  hook: ExportHookConfig | null;
}

/** Returns full .ass file content for one exported segment, or null when nothing overlaps it. */
export function buildSegmentAss(input: BuildSegmentAssInput): string | null {
  const { outW, outH, fontsDir, segStartSec, segDurSec } = input;
  const segEndSec = segStartSec + segDurSec;
  const k = outH / EDITOR_STAGE_HEIGHT;
  const events: string[] = [];

  // ---------------- Hook (Clip 1) ----------------
  const hook = input.hook;
  if (hook && (hook.line1 || hook.line2)) {
    const font = resolveExportFont(hook.fontFamily, fontsDir);
    const fs1 = Math.max(6, Number(hook.line1FontSize) || 15);
    const fs2 = Math.max(6, Number(hook.line2FontSize) || 24);
    // Parent strut is 16 px; leading-snug = 1.375
    const cx = (Math.max(0, Math.min(100, Number(hook.leftPct ?? 50))) / 100) * outW;
    const cy = (Math.max(0, Math.min(100, Number(hook.topPct ?? 50))) / 100) * outH;
    const boxW = (Math.max(5, Math.min(100, Number(hook.boxWidthPct ?? 82))) / 100) * outW;
    // Available text width in stage px: box minus p-2.5 padding (matches Chromium wrap in the flex column)
    const textMaxStage = boxW / k - 20;
    const rows1 = hook.line1
      ? wrapToWidthEm(String(hook.line1).toLocaleUpperCase('es-ES'), textMaxStage / fs1, font, 0.1)
      : [];
    const rows2 = hook.line2
      ? wrapToWidthEm(String(hook.line2).toLocaleUpperCase('es-ES'), textMaxStage / fs2, font, 0.025)
      : [];
    const rowH1 = 1.375 * Math.max(16, fs1);
    const rowH2 = 1.375 * Math.max(16, fs2);
    const lh1 = rows1.length * rowH1;
    const lh2 = rows2.length * rowH2;
    const gap = rows1.length && rows2.length ? 6 : 0; // space-y-1.5
    const blockH = lh1 + gap + lh2;
    const blockTop = cy - (blockH / 2) * k;
    const lines = [
      ...rows1.map((row, ri) => ({
            text: row,
            fs: fs1,
            yc: blockTop + (ri + 0.5) * rowH1 * k,
            color: hook.line1Color || '#fcd34d',
            tracking: 0.1, // tracking-widest
            start: Number(hook.line1StartSec),
            animIn: hook.line1AnimIn,
            inDur: hook.line1AnimInDur,
            animOut: hook.line1AnimOut,
            outDur: hook.line1AnimOutDur,
            glow: { blur: 12, spread: 4 },
          })),
      ...rows2.map((row, ri) => ({
            text: row,
            fs: fs2,
            yc: blockTop + (lh1 + gap + (ri + 0.5) * rowH2) * k,
            color: hook.line2Color || '#ffffff',
            tracking: 0.025, // tracking-wide
            start: Number(hook.line2StartSec),
            animIn: hook.line2AnimIn,
            inDur: hook.line2AnimInDur,
            animOut: hook.line2AnimOut,
            outDur: hook.line2AnimOutDur,
            glow: { blur: 14, spread: 5 },
          })),
    ] as Array<{
      text: string;
      fs: number;
      yc: number;
      color: string;
      tracking: number;
      start: number;
      animIn?: string;
      inDur?: number;
      animOut?: string;
      outDur?: number;
      glow: { blur: number; spread: number };
    }>;

    const hookEnd = Number(hook.endSec);
    const bgStyle = String(hook.bgStyle || 'none');
    if ((bgStyle === 'semi' || bgStyle === 'solid') && lines.length > 0) {
      const boxStart = Math.min(...lines.map((l) => l.start));
      const ls = Math.max(0, boxStart - segStartSec);
      const le = Math.min(segDurSec, hookEnd - segStartSec);
      if (le > ls + 0.02) {
        pushPillEvents(events, {
          startSec: ls,
          endSec: le,
          fadeInMs: 0,
          fadeOutMs: 0,
          cx,
          cy,
          w: boxW,
          h: (blockH + 20) * k,
          radius: 12 * k,
          colorHex: hook.bgColor || '#000000',
          opacity: (bgStyle === 'solid' ? 95 : Number(hook.bgOpacity ?? 55)) / 100,
          shadowBlur: 0,
          shadowSpread: 0,
          shadowOpacity: 0,
          layer: 0,
        });
      }
    }
    for (const ln of lines) {
      if (!Number.isFinite(ln.start) || !(hookEnd > ln.start)) continue;
      if (hookEnd <= segStartSec + 0.02 || ln.start >= segEndSec - 0.02) continue;
      const startsInside = ln.start >= segStartSec - 0.001;
      const endsInside = hookEnd <= segEndSec + 0.001;
      const ls = Math.max(0, ln.start - segStartSec);
      const le = Math.min(segDurSec, hookEnd - segStartSec);
      if (le <= ls + 0.02) continue;
      const fin = startsInside ? fadeMs(ln.animIn, ln.inDur, 1) : 0;
      const fout = endsInside ? fadeMs(ln.animOut, ln.outDur, 1) : 0;
      const cssPx = ln.fs * k;
      if (bgStyle === 'word_shadow') {
        const textW = measureTextEm(ln.text, font, ln.tracking) * cssPx;
        pushPillEvents(events, {
          startSec: ls,
          endSec: le,
          fadeInMs: fin,
          fadeOutMs: fout,
          cx,
          cy: ln.yc,
          w: textW + 20 * k,
          h: cssPx * font.heightRatio + 4 * k,
          radius: 6 * k,
          colorHex: hook.bgColor || '#000000',
          opacity: Number(hook.bgOpacity ?? 55) / 100,
          shadowBlur: ln.glow.blur * k,
          shadowSpread: ln.glow.spread * k,
          shadowOpacity: (Number(hook.bgOpacity ?? 55) * 0.85) / 100,
          layer: 1,
        });
      }
      pushTextEvents(events, {
        startSec: ls,
        endSec: le,
        fadeInMs: fin,
        fadeOutMs: fout,
        x: cx,
        yCenter: ln.yc,
        text: ln.text,
        font,
        cssPx,
        bold: true,
        colorHex: ln.color,
        letterSpacingEm: ln.tracking,
        shadowStyle: hook.shadowStyle || 'cinema',
        k,
        layerBase: 4,
      });
    }
  }

  // ---------------- Captions ----------------
  const cs = input.captionStyle;
  if (cs && input.captions.length > 0) {
    const font = resolveExportFont(cs.fontFamily, fontsDir);
    const cssPx = Math.max(13, (Number(cs.fontSize) || 25) * 0.76) * k;
    const lineBox = 1.5 * cssPx; // inherited preflight line-height
    const bottomPct = Number.isFinite(Number(cs.bottomPct)) ? Number(cs.bottomPct) : 10;
    const wrapperBottomY = outH * (1 - bottomPct / 100);
    const cx = outW / 2;
    const bgStyle = String(cs.bgStyle || 'word_shadow');
    const bgOpacityPct = bgStyle === 'solid' ? 95 : Math.max(0, Math.min(100, Number(cs.bgOpacity ?? 30)));
    const isWordShadow = bgStyle === 'word_shadow';
    const padX = (isWordShadow ? 10 : 14) * k; // px-2.5 vs px-3.5
    const padY = (isWordShadow ? 2 : 4) * k; // py-0.5 vs py-1
    const animDur = Number(cs.animDur) > 0 ? Number(cs.animDur) : 0.25;
    for (const cp of input.captions) {
      if (!(cp.endSec > segStartSec + 0.005 && cp.startSec < segEndSec - 0.005)) continue;
      const startsInside = cp.startSec >= segStartSec - 0.001;
      const endsInside = cp.endSec <= segEndSec + 0.001;
      const ls = Math.max(0, cp.startSec - segStartSec);
      const le = Math.min(segDurSec, cp.endSec - segStartSec);
      if (le <= ls + 0.02) continue;
      const fin = startsInside ? fadeMs(cs.animIn, animDur, 0.25) : 0;
      const fout = endsInside ? fadeMs(cs.animOut, animDur, 0.25) : 0;
      // Wrapper is inset-x-4 (16 px each side); inline span adds px padding on every wrapped fragment
      const capMaxEm = (outW / k - 32 - 2 * (padX / k)) / (cssPx / k);
      const rows = String(cp.text || '')
        .split(/\r?\n/)
        .map((l) => l.trim())
        .filter(Boolean)
        .flatMap((l) => wrapToWidthEm(l, capMaxEm, font));
      if (rows.length === 0) continue;
      if (!isWordShadow && bgStyle !== 'none') {
        // inline-block box around the whole caption (px-3.5 py-1 rounded-lg)
        const maxW = Math.max(...rows.map((r) => measureTextEm(r, font) * cssPx));
        const boxH = rows.length * lineBox + 2 * padY;
        pushPillEvents(events, {
          startSec: ls,
          endSec: le,
          fadeInMs: fin,
          fadeOutMs: fout,
          cx,
          cy: wrapperBottomY - boxH / 2,
          w: maxW + 2 * padX,
          h: boxH,
          radius: 8 * k,
          colorHex: cs.bgColor || '#000000',
          opacity: bgOpacityPct / 100,
          shadowBlur: 0,
          shadowSpread: 0,
          shadowOpacity: 0,
          layer: 0,
        });
      }
      const extraBottom = !isWordShadow && bgStyle !== 'none' ? padY : 0;
      rows.forEach((row, r) => {
        const yc = wrapperBottomY - extraBottom - (rows.length - 1 - r) * lineBox - lineBox / 2;
        if (isWordShadow) {
          const textW = measureTextEm(row, font) * cssPx;
          pushPillEvents(events, {
            startSec: ls,
            endSec: le,
            fadeInMs: fin,
            fadeOutMs: fout,
            cx,
            cy: yc,
            w: Math.min(outW - 32 * k, textW + 2 * padX),
            h: cssPx * font.heightRatio + 2 * padY,
            radius: 6 * k,
            colorHex: cs.bgColor || '#000000',
            opacity: bgOpacityPct / 100,
            shadowBlur: 12 * k,
            shadowSpread: 4 * k,
            shadowOpacity: (bgOpacityPct * 0.85) / 100,
            layer: 0,
          });
        }
        pushTextEvents(events, {
          startSec: ls,
          endSec: le,
          fadeInMs: fin,
          fadeOutMs: fout,
          x: cx,
          yCenter: yc,
          text: row,
          font,
          cssPx,
          bold: true,
          colorHex: cs.color || '#ffffff',
          letterSpacingEm: 0,
          shadowStyle: cs.shadowStyle || 'cinema',
          k,
          layerBase: 2,
        });
      });
    }
  }

  if (events.length === 0) return null;
  return [
    '[Script Info]',
    'ScriptType: v4.00+',
    `PlayResX: ${outW}`,
    `PlayResY: ${outH}`,
    'WrapStyle: 2',
    'ScaledBorderAndShadow: yes',
    '',
    '[V4+ Styles]',
    'Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding',
    'Style: Overlay,Georgia,40,&H00FFFFFF,&H00FFFFFF,&H00000000,&HFF000000,-1,0,0,0,100,100,0,0,1,0,0,5,0,0,0,1',
    '',
    '[Events]',
    'Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text',
    ...events,
    '',
  ].join('\n');
}
