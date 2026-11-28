// Viral Clips — on-screen title drawn as images.
// The title and the "VIDEO COMPLETO EN YOUTUBE" notice use a tall condensed poster face (League Gothic,
// slightly thickened), bone-white words with the last line in gold, a soft dark shadow so they read over any
// picture, and a lightly worn "printed poster" texture. Subtitles cannot carry a texture, so the text is
// rendered to transparent PNGs (libass draws the letters, a noise mask wears them down) and laid over the
// video. The title is drawn one image per word, so the render can shrink and move each word on its own from
// the big opening title to the small line that stays on screen.
import fs from 'fs';
import os from 'os';
import path from 'path';
import { spawnSync } from 'child_process';
import { VIRAL_TITLE_LOOK } from '../src/utils/viralTitle';
import {
  VIRAL_CLASSIC_STYLE,
  applyViralTitleCase,
  viralFontById,
  viralHexToAss,
  viralMaxFontSizeFor,
  viralTitleUnit,
  viralTitleLineStepFactor,
  viralTitleEntrance,
  VIRAL_TITLE_SLIDE_FRAC,
  VIRAL_TITLE_ZOOM_FROM,
  VIRAL_TITLE_BLUR_UNITS,
  type ViralDocStyle,
  type ViralFontDef,
  type ViralOutline,
  type ViralShadow,
  type ViralTexture,
  type ViralTitleAnim,
} from '../src/utils/viralStyle';

export const VIRAL_TITLE_FONT_NAME = 'League Gothic';

/** How the title's letters are drawn: the documentary's design, or the classic look when it has none. */
export interface ViralTitleDrawLook {
  font: ViralFontDef;
  /** ASS colours (&HBBGGRR&) of most of the title and of its last line */
  mainAss: string;
  accentAss: string;
  texture: ViralTexture;
  /** 0–1 (0.5 is the classic amount of wear) */
  textureAmount: number;
  outline: ViralOutline;
  shadow: ViralShadow;
}
export function viralTitleDrawLookFor(style?: ViralDocStyle | null): ViralTitleDrawLook {
  const st = style || VIRAL_CLASSIC_STYLE;
  return {
    font: viralFontById(st.titleFont),
    mainAss: viralHexToAss(st.titleColor),
    accentAss: viralHexToAss(st.titleAccentColor),
    texture: st.texture,
    textureAmount: Math.max(0, Math.min(1, (Number(st.textureAmount) || 0) / 100)),
    outline: st.outline,
    shadow: st.shadow,
  };
}
const CLASSIC_LOOK = viralTitleDrawLookFor(null);

export interface ViralTitleArt {
  path: string;
  width: number;
  height: number;
  /** Rows of transparent padding above the first line of text (shadow room) */
  padTop: number;
}

/** One word of the title as its own image, with where it sits in the big title and in the small line. */
export interface ViralTitleWordArt {
  path: string;
  width: number;
  height: number;
  /** Top-left of the image in the big title; x from the frame's left edge, y from the title's top */
  bigX: number;
  bigY: number;
  /** Top-left of the image once shrunk to `scale`, in the small line (same reference) */
  smallX: number;
  smallY: number;
}

export interface ViralTitleWordsArt {
  words: ViralTitleWordArt[];
  /** Size of the small line's letters relative to the big title's */
  scale: number;
  /** Bottom of the small line's letters, from the title's top (to stack the notice under it) */
  smallTextBottom: number;
  /** Height of the big title's letters, first line's top to last line's bottom */
  bigTextHeight: number;
  /** The big title's size in title units (the League Gothic font size with capitals as tall) */
  unit: number;
}

interface TitleWord {
  text: string;
  gold: boolean;
}
type TitleLine = TitleWord[];
interface Box {
  x1: number;
  x2: number;
  y1: number;
  y2: number;
}

const escFilterPath = (p: string) => p.replace(/\\/g, '/').replace(/:/g, '\\:').replace(/'/g, "\\'");

/**
 * "white part|gold part" on one line; otherwise a line is white, or gold when it is the last one.
 * Words are written as the font wants them (all capitals, or capitals at the start of the main words).
 */
function parseTitleLines(rawLines: string[], titleCase: ViralFontDef['titleCase'] = 'upper'): TitleLine[] {
  const lines = rawLines.map((l) => String(l || '').trim()).filter(Boolean);
  let isFirstWord = true;
  let afterStop = false;
  const cased = (text: string) => {
    const out = titleCase === 'capitalized' ? applyViralTitleCase(text, titleCase, isFirstWord || afterStop) : text;
    isFirstWord = false;
    afterStop = /[:.?!]$/.test(text);
    return out;
  };
  return lines
    .map((line, i) => {
      const toWords = (s: string, gold: boolean) =>
        s
          .split(/\s+/)
          .filter(Boolean)
          .map((text) => ({ text: cased(text), gold }));
      if (line.includes('|')) {
        const [whitePart, goldPart] = line.split('|');
        return [...toWords(whitePart, false), ...toWords(goldPart || '', true)];
      }
      return toWords(line, i === lines.length - 1);
    })
    .filter((l) => l.length > 0);
}

const assTime = (sec: number) => {
  const m = Math.floor(sec / 60);
  const s = sec - m * 60;
  return `0:${String(m).padStart(2, '0')}:${s.toFixed(2).padStart(5, '0')}`;
};

/**
 * ASS that draws the title. With `oneWordPerSecond`, second k shows only word k (the others keep their
 * place but are invisible): rendering it at 1 frame per second gives one frame per word, each word exactly
 * where it sits in the full title.
 */
function buildTitleAss(opts: {
  canvasW: number;
  canvasH: number;
  lines: TitleLine[];
  fontSize: number;
  topY: number;
  shadow: boolean;
  oneWordPerSecond?: boolean;
  look?: ViralTitleDrawLook;
}): string {
  const { canvasW, canvasH, lines, fontSize, topY, shadow, oneWordPerSecond = false } = opts;
  const look = opts.look || CLASSIC_LOOK;
  // Every size of the look follows the height of the capitals, so any font gets the same proportions
  // (`u` is the League Gothic font size whose capitals are as tall as this font's)
  const u = viralTitleUnit(look.font, fontSize);
  // Lines sit tight, like a film poster
  const lineStep = u * VIRAL_TITLE_LOOK.lineStep * viralTitleLineStepFactor(look.font);
  // "A little bolder": an outline in the letter's own colour thickens every stroke
  const inkBord = Math.max(1, u * VIRAL_TITLE_LOOK.inkBord);
  const out = [
    '[Script Info]',
    'ScriptType: v4.00+',
    `PlayResX: ${canvasW}`,
    `PlayResY: ${canvasH}`,
    'WrapStyle: 2',
    'ScaledBorderAndShadow: yes',
    '',
    '[V4+ Styles]',
    'Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding',
    `Style: T,${look.font.ass},${fontSize.toFixed(1)},&H00FFFFFF,&H00FFFFFF,&H00FFFFFF,&H00000000,${look.font.bold ? -1 : 0},0,0,0,100,100,${(u * VIRAL_TITLE_LOOK.spacing).toFixed(2)},0,1,0,0,8,0,0,0,1`,
    '',
    '[Events]',
    'Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text',
  ];
  const cx = Math.round(canvasW / 2);
  const wordColor = (w: TitleWord) => (w.gold ? look.accentAss : look.mainAss);
  // What is drawn in one pass: the letters themselves, or (under them) each piece of shadow and edge
  type Pass = { dx: number; dy: number; tags: (w: TitleWord) => string };
  const passes: Pass[] = [];
  if (!shadow) {
    passes.push({
      dx: 0,
      dy: 0,
      tags: (w) => `\\alpha&H00&\\1c${wordColor(w)}\\3c${wordColor(w)}\\bord${inkBord.toFixed(2)}`,
    });
  } else {
    const black = '\\1c&H000000&\\3c&H000000&';
    if (look.shadow === 'soft') {
      passes.push({
        dx: 0,
        dy: 0,
        tags: () =>
          `\\alpha&H00&${black}\\bord${Math.max(4, u * 0.075).toFixed(2)}\\blur${Math.max(5, u * 0.085).toFixed(1)}\\1a&H12&\\3a&H12&`,
      });
    } else if (look.shadow === 'hard') {
      // A faint halo so the letters still read on a bright picture, then the offset shadow
      passes.push({
        dx: 0,
        dy: 0,
        tags: () => `\\alpha&H00&${black}\\bord${Math.max(2, u * 0.03).toFixed(2)}\\blur${Math.max(3, u * 0.05).toFixed(1)}\\1a&H70&\\3a&H70&`,
      });
      passes.push({
        dx: u * 0.05,
        dy: u * 0.06,
        tags: () => `\\alpha&H00&${black}\\bord${inkBord.toFixed(2)}\\blur0\\1a&H20&\\3a&H20&`,
      });
    } else if (look.shadow === 'glow') {
      passes.push({
        dx: 0,
        dy: 0,
        tags: () => `\\alpha&H00&${black}\\bord${Math.max(3, u * 0.05).toFixed(2)}\\blur${Math.max(4, u * 0.07).toFixed(1)}\\1a&H38&\\3a&H38&`,
      });
      passes.push({
        dx: 0,
        dy: 0,
        tags: (w) =>
          `\\alpha&H00&\\1c${wordColor(w)}\\3c${wordColor(w)}\\bord${Math.max(3, u * 0.05).toFixed(2)}\\blur${Math.max(6, u * 0.12).toFixed(1)}\\1a&H50&\\3a&H50&`,
      });
    }
    if (look.outline !== 'none') {
      const edge = Math.max(2, u * (look.outline === 'thick' ? 0.065 : 0.032));
      passes.push({ dx: 0, dy: 0, tags: () => `\\alpha&H00&${black}\\bord${edge.toFixed(2)}\\blur0.6` });
    }
  }
  const shown = (pass: Pass) => (w: TitleWord) => `{${pass.tags(w)}}${w.text}`;
  const hidden = (w: TitleWord) => `{\\alpha&HFF&\\bord0\\blur0}${w.text}`;
  const lineEvent = (layer: number, pass: Pass, lineIdx: number, text: string, startSec: number, endSec: number) =>
    `Dialogue: ${layer},${assTime(startSec)},${assTime(endSec)},T,,0,0,0,,{\\an8\\pos(${Math.round(cx + pass.dx)},${Math.round(
      topY + lineIdx * lineStep + pass.dy
    )})}${text}`;
  if (!oneWordPerSecond) {
    passes.forEach((pass, layer) =>
      lines.forEach((line, i) => out.push(lineEvent(layer, pass, i, line.map(shown(pass)).join(' '), 0, 3600)))
    );
    return out.join('\n');
  }
  let k = 0;
  lines.forEach((line, i) => {
    line.forEach((_w, j) => {
      passes.forEach((pass, layer) => {
        const text = line.map((w, jj) => (jj === j ? shown(pass)(w) : hidden(w))).join(' ');
        out.push(lineEvent(layer, pass, i, text, k, k + 1));
      });
      k++;
    });
  });
  return out.join('\n');
}

function runFfmpeg(ffmpegBin: string, args: string[]): { ok: boolean; stderr: string } {
  const r = spawnSync(ffmpegBin, ['-hide_banner', '-y', ...args], {
    encoding: 'utf8',
    timeout: 90000,
    maxBuffer: 32 * 1024 * 1024,
  });
  return { ok: r.status === 0, stderr: String(r.stderr || '') };
}

/** Bounding box of what the ASS draws on a transparent canvas, one per frame (1 frame = 1 second). */
function measureAssBoxes(
  ffmpegBin: string,
  fontsDir: string,
  assPath: string,
  canvasW: number,
  canvasH: number,
  frames: number
): Array<Box | null> {
  const r = runFfmpeg(ffmpegBin, [
    '-f',
    'lavfi',
    '-i',
    `color=c=black@0.0:s=${canvasW}x${canvasH}:r=1,format=rgba`,
    '-vf',
    `ass=filename='${escFilterPath(assPath)}':fontsdir='${escFilterPath(fontsDir)}':alpha=1,alphaextract,bbox=min_val=24`,
    '-frames:v',
    String(frames),
    '-f',
    'null',
    '-',
  ]);
  const boxes: Array<Box | null> = new Array(frames).fill(null);
  const re = /n:(\d+) pts:[^\n]*?x1:(\d+) x2:(\d+) y1:(\d+) y2:(\d+)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(r.stderr)) !== null) {
    const n = Number(m[1]);
    if (n >= 0 && n < frames) boxes[n] = { x1: Number(m[2]), x2: Number(m[3]), y1: Number(m[4]), y2: Number(m[5]) };
  }
  return boxes;
}

/**
 * Filter graph that draws the text ASS over its shadow ASS with the look's texture, ending in [art].
 * The texture is multiplied into the letters' opacity (the shadow underneath stays whole, so the worn spots
 * read dark, as on a printed poster). "worn" is light pitting that is denser in some areas than others, a few
 * small chipped patches and the odd thin scratch; the other textures use the same pieces in other amounts.
 * The noise is a position hash, not random(): geq runs in slices and random() repeats in each one.
 */
function texturedTitleGraph(opts: {
  canvasW: number;
  canvasH: number;
  fontSize: number;
  fontsDir: string;
  textAss: string;
  shadowAss: string;
  look?: ViralTitleDrawLook;
}): string {
  const { canvasW, canvasH, fontsDir, textAss, shadowAss } = opts;
  const look = opts.look || CLASSIC_LOOK;
  const u = viralTitleUnit(look.font, opts.fontSize);
  const hash = (seed: number) => `mod(abs(sin(X*12.9898+Y*78.233+${seed})*43758.5453),1)`;
  const src = (expr: string, w: number, h: number) =>
    `nullsrc=s=${Math.max(2, Math.round(w))}x${Math.max(2, Math.round(h))}:r=1,format=gray,geq=lum='${expr}'`;
  const up = (flags: string) => `scale=${canvasW}:${canvasH}:flags=${flags},format=gray`;
  const g = Math.max(2, u / 85);
  const fontsArg = `fontsdir='${escFilterPath(fontsDir)}'`;
  // 0.5 is the classic amount; twice that is the most a texture may eat
  const a = look.texture === 'none' ? 0 : look.textureAmount;
  const n = (v: number, digits = 4) => String(Number(v.toFixed(digits)));

  // Each piece is a grey mask (white keeps the letter, black removes it); they are multiplied together
  const chains: string[] = [];
  const masks: string[] = [];
  const pits = (amount: number) => {
    chains.push(`${src(`255*${hash(11)}`, canvasW / g, canvasH / g)},${up('bilinear')}[nfine]`);
    chains.push(`${src(`255*${hash(23)}`, canvasW / (g * 34), canvasH / (g * 34))},${up('bicubic')}[nlow]`);
    chains.push(`[nfine][nlow]blend=all_expr='if(gt(A,${n(255 - 42 * amount, 2)}+B*0.16),0,255)',gblur=sigma=0.7[mpit]`);
    masks.push('mpit');
  };
  const chips = (amount: number, size: number, seed: number, label: string) => {
    chains.push(
      `${src(`255*${hash(seed)}`, canvasW / (g * size), canvasH / (g * size))},${up('bicubic')},lutyuv=y='if(gt(val,${n(255 - 18 * amount, 2)}),0,255)'[${label}]`
    );
    masks.push(label);
  };
  const scratches = (amount: number) => {
    chains.push(`${src(`if(gt(${hash(51)},${n(1 - 0.004 * amount, 5)}),0,255)`, canvasW / (g * 20), canvasH / (g * 0.7))},${up('bilinear')}[mscrh]`);
    chains.push(`${src(`if(gt(${hash(67)},${n(1 - 0.0016 * amount, 5)}),0,255)`, canvasW / (g * 0.7), canvasH / (g * 16))},${up('bilinear')}[mscrv]`);
    masks.push('mscrh', 'mscrv');
  };
  if (a > 0) {
    if (look.texture === 'worn') {
      pits(a);
      chips(a, 4.5, 37, 'mchip');
      scratches(a);
    } else if (look.texture === 'grain') {
      // Film grain: every letter is finely speckled, no holes
      chains.push(`${src(`255*(1-${n(Math.min(0.5, a * 0.45))}*${hash(83)})`, canvasW / (g * 0.8), canvasH / (g * 0.8))},${up('bilinear')}[mgrain]`);
      masks.push('mgrain');
      pits(a * 0.2);
    } else if (look.texture === 'scratched') {
      scratches(Math.min(3, a * 2.2));
      pits(a * 0.2);
    } else if (look.texture === 'stone') {
      // Carved stone: bigger chipped patches and coarse pitting, no scratches
      chips(Math.min(2.5, a * 1.5), 4.5, 37, 'mchip');
      chips(Math.min(2, a * 0.9), 10, 41, 'mchipbig');
      pits(a * 0.55);
    } else if (look.texture === 'ink') {
      // Uneven ink: whole areas print thin, as from a badly inked stamp
      chains.push(`${src(`255*${hash(11)}`, canvasW / g, canvasH / g)},${up('bilinear')}[nfine]`);
      chains.push(`${src(`255*${hash(29)}`, canvasW / (g * 16), canvasH / (g * 16))},${up('bicubic')}[nblot]`);
      chains.push(`[nfine][nblot]blend=all_expr='if(gt(A,255-${n(Math.min(140, a * 150), 1)}*max(0,B-105)/150),0,255)',gblur=sigma=0.8[mink]`);
      masks.push('mink');
    }
  }
  const out: string[] = [
    `color=c=black@0.0:s=${canvasW}x${canvasH}:r=1,format=rgba,ass=filename='${escFilterPath(textAss)}':${fontsArg}:alpha=1${masks.length ? ',split[t1][t2]' : '[txt]'}`,
  ];
  if (masks.length) {
    out.push(`[t1]alphaextract,format=gray[ta]`);
    out.push(...chains);
    // Multiplied in pairs (pits with chips, one scratch with the other, then both), as the classic look does
    let level = masks.slice();
    let tmpIdx = 0;
    while (level.length > 1) {
      const next: string[] = [];
      for (let i = 0; i < level.length; i += 2) {
        if (i + 1 >= level.length) {
          next.push(level[i]);
          continue;
        }
        const label = level.length === 2 ? 'mask' : `m${++tmpIdx}`;
        out.push(`[${level[i]}][${level[i + 1]}]blend=all_mode=multiply[${label}]`);
        next.push(label);
      }
      level = next;
    }
    out.push(`[ta][${level[0]}]blend=all_mode=multiply[ta2]`);
    out.push(`[t2][ta2]alphamerge[txt]`);
  }
  out.push(`color=c=black@0.0:s=${canvasW}x${canvasH}:r=1,format=rgba,ass=filename='${escFilterPath(shadowAss)}':${fontsArg}:alpha=1[sh]`);
  out.push(`[sh][txt]overlay=format=auto[art]`);
  return out.join(';');
}

/** Temp-file helper: everything it makes is removed by `cleanup()`. */
function tempFiles() {
  const stamp = `${Date.now()}_${Math.round(Math.random() * 1e6)}`;
  const made: string[] = [];
  return {
    path: (name: string) => {
      const p = path.join(os.tmpdir(), `viral_title_${stamp}_${name}`);
      made.push(p);
      return p;
    },
    write: (name: string, content: string) => {
      const p = path.join(os.tmpdir(), `viral_title_${stamp}_${name}`);
      fs.writeFileSync(p, content, 'utf8');
      made.push(p);
      return p;
    },
    cleanup: () => {
      for (const p of made) {
        try {
          if (fs.existsSync(p)) fs.unlinkSync(p);
        } catch {}
      }
    },
  };
}

/** Font size at which the widest line fills `maxTextWidthPx`, never above `maxFontSize`. */
function fitFontSize(
  ffmpegBin: string,
  fontsDir: string,
  tmp: ReturnType<typeof tempFiles>,
  name: string,
  lines: TitleLine[],
  maxTextWidthPx: number,
  maxFontSize: number,
  look?: ViralTitleDrawLook
): number | null {
  const refSize = 200;
  // Wide fonts need a wider sheet to be measured on
  const refW = look && look.font.widthFactor > 1.4 ? 16000 : 8000;
  const refH = Math.round(200 + lines.length * refSize * 1.2);
  const refAss = tmp.write(`${name}_ref.ass`, buildTitleAss({ canvasW: refW, canvasH: refH, lines, fontSize: refSize, topY: 60, shadow: false, look }));
  const box = measureAssBoxes(ffmpegBin, fontsDir, refAss, refW, refH, 1)[0];
  if (!box) return null;
  const refTextW = Math.max(1, box.x2 - box.x1 + 1);
  return Math.max(18, Math.min(maxFontSize, (refSize * maxTextWidthPx) / refTextW));
}

/** `unit`: the font size in title units (the League Gothic size with capitals as tall), see viralTitleUnit */
const padFor = (unit: number) => Math.round(Math.max(28, unit * 0.36));
/** Tall enough for the lines at their distance plus the last line's full height in the font's own size. */
const canvasHeightFor = (lineCount: number, fontSize: number, look: ViralTitleDrawLook) => {
  const unit = viralTitleUnit(look.font, fontSize);
  const linesH = Math.max(
    lineCount * unit * 1.05,
    (lineCount - 1) * unit * VIRAL_TITLE_LOOK.lineStep * viralTitleLineStepFactor(look.font) + fontSize * 1.05
  );
  return 2 * Math.round((padFor(unit) * 2 + linesH + 40) / 2);
};
/** The font file is where the render looks for it (a font with no file is one the system has). */
const fontAvailable = (fontsDir: string, look: ViralTitleDrawLook) =>
  !look.font.file || fs.existsSync(path.join(fontsDir, look.font.file));

/**
 * Draws the lines as one transparent PNG, `frameW` wide (so it is laid at x = 0) and cropped to the text's
 * height. The font grows until the widest line fills `maxTextWidthPx`, up to `maxFontSize`.
 * Returns null when it cannot be drawn (missing font, ffmpeg error): the caller then leaves it out rather
 * than failing the whole clip.
 */
export function renderViralTitleArt(opts: {
  ffmpegBin: string;
  fontsDir: string;
  lines: string[];
  frameW: number;
  maxTextWidthPx: number;
  /** Largest size, as the ASS font size League Gothic would have (other fonts get capitals just as tall) */
  maxFontSize: number;
  outPath: string;
  /** The documentary's design; absent, the classic look */
  look?: ViralTitleDrawLook;
}): ViralTitleArt | null {
  const { ffmpegBin, fontsDir, frameW, maxTextWidthPx, outPath } = opts;
  const look = opts.look || CLASSIC_LOOK;
  const lines = parseTitleLines(opts.lines, look.font.titleCase);
  if (lines.length === 0) return null;
  if (!fontAvailable(fontsDir, look)) return null;
  const maxFontSize = viralMaxFontSizeFor(look.font, opts.maxFontSize);
  const tmp = tempFiles();
  try {
    const fontSize = fitFontSize(ffmpegBin, fontsDir, tmp, 'art', lines, maxTextWidthPx, maxFontSize, look);
    if (!fontSize) return null;
    const pad = padFor(viralTitleUnit(look.font, fontSize));
    const canvasW = 2 * Math.round(frameW / 2);
    const canvasH = canvasHeightFor(lines.length, fontSize, look);
    const assArgs = { canvasW, canvasH, lines, fontSize, topY: pad, look };
    const textAss = tmp.write('art_text.ass', buildTitleAss({ ...assArgs, shadow: false }));
    const shadowAss = tmp.write('art_shadow.ass', buildTitleAss({ ...assArgs, shadow: true }));
    const box = measureAssBoxes(ffmpegBin, fontsDir, textAss, canvasW, canvasH, 1)[0];
    if (!box) return null;
    const cropY = Math.max(0, box.y1 - pad);
    const cropH = 2 * Math.round(Math.min(canvasH - cropY, box.y2 - box.y1 + 1 + pad * 2) / 2);
    const graph = `${texturedTitleGraph({ canvasW, canvasH, fontSize, fontsDir, textAss, shadowAss, look })};[art]crop=${canvasW}:${cropH}:0:${cropY}[out]`;
    const r = runFfmpeg(ffmpegBin, ['-filter_complex', graph, '-map', '[out]', '-frames:v', '1', outPath]);
    if (!r.ok || !fs.existsSync(outPath)) {
      console.warn('[ViralClips] No se pudo dibujar el texto:', r.stderr.slice(-400));
      return null;
    }
    return { path: outPath, width: canvasW, height: cropH, padTop: box.y1 - cropY };
  } catch (e) {
    console.warn('[ViralClips] No se pudo dibujar el texto:', e);
    return null;
  } finally {
    tmp.cleanup();
  }
}

/**
 * Draws the title one image per word, each with its place in the big opening title and in the small line
 * that stays on screen, so the render can move and shrink every word on its own between the two.
 * `bigLines` and `smallLines` hold the same words in the same order, only broken into lines differently.
 * Returns null when it cannot be drawn; `outPrefix` + "_NN.png" are the files it leaves (the caller deletes them).
 */
export function renderViralTitleWords(opts: {
  ffmpegBin: string;
  fontsDir: string;
  bigLines: string[];
  smallLines: string[];
  frameW: number;
  bigMaxTextWidthPx: number;
  bigMaxFontSize: number;
  smallMaxTextWidthPx: number;
  smallMaxFontSize: number;
  outPrefix: string;
  /** The documentary's design; absent, the classic look. Font sizes are given as League Gothic's. */
  look?: ViralTitleDrawLook;
}): ViralTitleWordsArt | null {
  const { ffmpegBin, fontsDir, frameW, outPrefix } = opts;
  const look = opts.look || CLASSIC_LOOK;
  const bigLines = parseTitleLines(opts.bigLines, look.font.titleCase);
  const smallLines = parseTitleLines(opts.smallLines, look.font.titleCase);
  const wordCount = bigLines.reduce((acc, l) => acc + l.length, 0);
  if (wordCount === 0 || wordCount > 40) return null;
  if (smallLines.reduce((acc, l) => acc + l.length, 0) !== wordCount) return null;
  if (!fontAvailable(fontsDir, look)) return null;
  const tmp = tempFiles();
  try {
    const bigFont = fitFontSize(ffmpegBin, fontsDir, tmp, 'big', bigLines, opts.bigMaxTextWidthPx, viralMaxFontSizeFor(look.font, opts.bigMaxFontSize), look);
    const smallFontFit = fitFontSize(
      ffmpegBin,
      fontsDir,
      tmp,
      'small',
      smallLines,
      opts.smallMaxTextWidthPx,
      viralMaxFontSizeFor(look.font, opts.smallMaxFontSize),
      look
    );
    if (!bigFont || !smallFontFit) return null;
    // The small line is never bigger than the opening title
    const smallFont = Math.min(smallFontFit, bigFont);
    const scale = smallFont / bigFont;
    const canvasW = 2 * Math.round(frameW / 2);

    // Where each word sits: one frame per word, in the big title and in the small line
    const bigUnit = viralTitleUnit(look.font, bigFont);
    const bigPad = padFor(bigUnit);
    const bigH = canvasHeightFor(bigLines.length, bigFont, look);
    const bigArgs = { canvasW, canvasH: bigH, lines: bigLines, fontSize: bigFont, topY: bigPad, oneWordPerSecond: true, look };
    const bigTextAss = tmp.write('big_text.ass', buildTitleAss({ ...bigArgs, shadow: false }));
    const bigShadowAss = tmp.write('big_shadow.ass', buildTitleAss({ ...bigArgs, shadow: true }));
    const bigBoxes = measureAssBoxes(ffmpegBin, fontsDir, bigTextAss, canvasW, bigH, wordCount);
    const smallPad = padFor(viralTitleUnit(look.font, smallFont));
    const smallH = canvasHeightFor(smallLines.length, smallFont, look);
    const smallTextAss = tmp.write(
      'small_text.ass',
      buildTitleAss({ canvasW, canvasH: smallH, lines: smallLines, fontSize: smallFont, topY: smallPad, shadow: false, oneWordPerSecond: true, look })
    );
    const smallBoxes = measureAssBoxes(ffmpegBin, fontsDir, smallTextAss, canvasW, smallH, wordCount);
    if (bigBoxes.some((b) => !b) || smallBoxes.some((b) => !b)) return null;

    // Every word drawn with its shadow and texture, each on its own full-size frame
    const seqPattern = path.join(os.tmpdir(), `viral_title_seq_${Date.now()}_${Math.round(Math.random() * 1e6)}_%02d.png`);
    const seqFile = (k: number) => seqPattern.replace('%02d', String(k).padStart(2, '0'));
    const seqRun = runFfmpeg(ffmpegBin, [
      '-filter_complex',
      texturedTitleGraph({ canvasW, canvasH: bigH, fontSize: bigFont, fontsDir, textAss: bigTextAss, shadowAss: bigShadowAss, look }),
      '-map',
      '[art]',
      '-frames:v',
      String(wordCount),
      '-start_number',
      '0',
      seqPattern,
    ]);
    const seqFiles = Array.from({ length: wordCount }, (_v, k) => seqFile(k));
    try {
      if (!seqRun.ok || seqFiles.some((f) => !fs.existsSync(f))) {
        console.warn('[ViralClips] No se pudieron dibujar las palabras del título:', seqRun.stderr.slice(-400));
        return null;
      }
      // Cut each word out of its frame, with room for its shadow
      const margin = Math.round(bigUnit * 0.3);
      const crops = (bigBoxes as Box[]).map((b) => {
        const x = Math.max(0, b.x1 - margin);
        const y = Math.max(0, b.y1 - margin);
        const w = 2 * Math.ceil((Math.min(canvasW, b.x2 + 1 + margin) - x) / 2);
        const h = 2 * Math.ceil((Math.min(bigH, b.y2 + 1 + margin) - y) / 2);
        return { x, y, w: Math.min(w, canvasW - x), h: Math.min(h, bigH - y) };
      });
      const cropArgs: string[] = [];
      seqFiles.forEach((f) => cropArgs.push('-i', f));
      cropArgs.push('-filter_complex', crops.map((c, k) => `[${k}:v]crop=${c.w}:${c.h}:${c.x}:${c.y}[o${k}]`).join(';'));
      const outFiles = crops.map((_c, k) => `${outPrefix}_${String(k).padStart(2, '0')}.png`);
      outFiles.forEach((f, k) => cropArgs.push('-map', `[o${k}]`, '-frames:v', '1', f));
      const cropRun = runFfmpeg(ffmpegBin, cropArgs);
      if (!cropRun.ok || outFiles.some((f) => !fs.existsSync(f))) {
        console.warn('[ViralClips] No se pudieron recortar las palabras del título:', cropRun.stderr.slice(-400));
        for (const f of outFiles) {
          try {
            if (fs.existsSync(f)) fs.unlinkSync(f);
          } catch {}
        }
        return null;
      }
      // Heights are measured from the top of the letters (the title's top is where its first letters start)
      const bigInkTop = Math.min(...(bigBoxes as Box[]).map((b) => b.y1));
      const smallInkTop = Math.min(...(smallBoxes as Box[]).map((b) => b.y1));
      const words: ViralTitleWordArt[] = crops.map((c, k) => {
        const big = (bigBoxes as Box[])[k];
        const small = (smallBoxes as Box[])[k];
        return {
          path: outFiles[k],
          width: c.w,
          height: c.h,
          bigX: c.x,
          bigY: c.y - bigInkTop,
          // The word's ink starts (big.x1 - c.x) pixels into the image; shrunk, that offset shrinks too
          smallX: small.x1 - (big.x1 - c.x) * scale,
          smallY: small.y1 - smallInkTop - (big.y1 - c.y) * scale,
        };
      });
      const smallTextBottom = Math.max(...(smallBoxes as Box[]).map((b) => b.y2)) - smallInkTop;
      const bigTextHeight = Math.max(...(bigBoxes as Box[]).map((b) => b.y2)) - bigInkTop;
      return { words, scale, smallTextBottom, bigTextHeight, unit: bigUnit };
    } finally {
      for (const f of seqFiles) {
        try {
          if (fs.existsSync(f)) fs.unlinkSync(f);
        } catch {}
      }
    }
  } catch (e) {
    console.warn('[ViralClips] No se pudieron dibujar las palabras del título:', e);
    return null;
  } finally {
    tmp.cleanup();
  }
}

/**
 * ffmpeg inputs and filter chain that lay the title's words over `inLabel`: each word comes in (the design's
 * animation; the classic one is a short fade of the whole title), sits in the big title, then (with `morph`)
 * shrinks and glides to its place in the small line, one word slightly after the other, easing in and out,
 * and stays there until the end of the clip.
 */
export function buildViralTitleWordFilters(opts: {
  art: ViralTitleWordsArt;
  firstInputIdx: number;
  inLabel: string;
  /** Frame y where the small line's letters start (the title's usual place under the logo) */
  titleTopY: number;
  /** Frame y where the big title's letters start; lower than `titleTopY` when it has to clear a face */
  bigTopY?: number;
  totalDurSec: number;
  morph: { startSec: number; durSec: number; staggerSec: number } | null;
  /** How the words come in (the design's); absent, the classic fade */
  anim?: ViralTitleAnim;
  /** Frame width, for the animations that move the words */
  frameW?: number;
}): { inputArgs: string[]; chain: string; outLabel: string } {
  const { art, firstInputIdx, titleTopY, totalDurSec, morph } = opts;
  const anim: ViralTitleAnim = opts.anim || 'fade';
  const frameW = opts.frameW || 1440;
  const inputArgs: string[] = [];
  let chain = '';
  let last = opts.inLabel;
  const f = (n: number) => n.toFixed(3);
  const count = art.words.length;
  art.words.forEach((w, k) => {
    inputArgs.push('-loop', '1', '-framerate', '30', '-t', f(totalDurSec + 0.5), '-i', w.path);
    const x0 = w.bigX;
    const y0 = (opts.bigTopY ?? titleTopY) + w.bigY;
    const { startSec: inAt, durSec: inDur } = viralTitleEntrance(anim, k, count);
    // 0 → 1 while the word comes in
    const pin = `clip((t-${f(inAt)})/${f(inDur)},0,1)`;
    let pre = `format=rgba`;
    let sizeMul = '';
    let xAdd = '';
    let yAdd = '';
    let blurChain = '';
    if (anim === 'slide') {
      pre += `,fade=t=in:st=${f(inAt)}:d=0.2:alpha=1`;
      xAdd = `-${f(frameW * VIRAL_TITLE_SLIDE_FRAC)}*pow(1-${pin},3)`;
    } else if (anim === 'zoom') {
      pre += `,fade=t=in:st=${f(inAt)}:d=0.1:alpha=1`;
      // Starts bigger and lands on its place, growing from its centre
      const extra = `(${f(VIRAL_TITLE_ZOOM_FROM - 1)}*(1-${pin}*${pin}))`;
      sizeMul = `*(1+${extra})`;
      xAdd = `-${f(w.width / 2)}*${extra}`;
      yAdd = `-${f(w.height / 2)}*${extra}`;
    } else if (anim === 'wipe') {
      // A transparent strip as wide as the word to its left; the window slides from the strip onto the word
      pre += `,fade=t=in:st=${f(inAt)}:d=0.03:alpha=1,pad=w=${w.width * 2}:h=${w.height}:x=${w.width}:y=0:color=black@0.0,crop=w=${w.width}:h=${w.height}:x='${w.width}*${pin}':y=0:exact=1`;
      xAdd = `-${f(w.width)}*(1-${pin})`;
    } else if (anim === 'blur') {
      // A blurred copy comes first and gives way to the sharp word
      const sigma = Math.max(2, art.unit * VIRAL_TITLE_BLUR_UNITS);
      const fadeOutAt = inAt + inDur * 0.45;
      blurChain =
        `;[${firstInputIdx + k}:v]split[twa${k}][twb${k}]` +
        `;[twb${k}]format=rgba,trim=duration=${f(inAt + inDur + 0.1)},gblur=sigma=${f(sigma)},fade=t=in:st=${f(inAt)}:d=0.2:alpha=1,fade=t=out:st=${f(fadeOutAt)}:d=${f(inDur * 0.55)}:alpha=1[twblur${k}]`;
      pre += `,fade=t=in:st=${f(inAt + inDur * 0.3)}:d=${f(inDur * 0.7)}:alpha=1`;
    } else {
      // fade (the whole title), words and typewriter (one after another, soft or sharp)
      pre += `,fade=t=in:st=${f(inAt)}:d=${f(inDur)}:alpha=1`;
    }
    let scaleFilter = '';
    let xExpr = f(x0);
    let yExpr = f(y0);
    if (morph) {
      const p = `clip((t-${f(morph.startSec + k * morph.staggerSec)})/${f(morph.durSec)},0,1)`;
      // Smoothstep: starts and lands gently
      const e = `(${p}*${p}*(3-2*${p}))`;
      const sizeExpr = (px: number) => `max(2,${px}*(1+(${f(art.scale)}-1)*${e})${sizeMul})`;
      scaleFilter = `,scale=w='${sizeExpr(w.width)}':h='${sizeExpr(w.height)}':eval=frame:flags=bilinear`;
      xExpr = `${f(x0)}+(${f(w.smallX)}-${f(x0)})*${e}`;
      yExpr = `${f(y0)}+(${f(titleTopY + w.smallY)}-${f(y0)})*${e}`;
    } else if (sizeMul) {
      scaleFilter = `,scale=w='max(2,${w.width}${sizeMul})':h='max(2,${w.height}${sizeMul})':eval=frame:flags=bilinear`;
    }
    xExpr += xAdd;
    yExpr += yAdd;
    const next = `vtw${k}`;
    if (blurChain) {
      chain += blurChain;
      chain += `;[${last}][twblur${k}]overlay=x='${f(x0)}':y='${f(y0)}':eof_action=pass:format=auto[vtwb${k}]`;
      last = `vtwb${k}`;
      chain += `;[twa${k}]${pre}${scaleFilter}[tword${k}];[${last}][tword${k}]overlay=x='${xExpr}':y='${yExpr}':eof_action=pass:format=auto[${next}]`;
    } else {
      chain += `;[${firstInputIdx + k}:v]${pre}${scaleFilter}[tword${k}];[${last}][tword${k}]overlay=x='${xExpr}':y='${yExpr}':eof_action=pass:format=auto[${next}]`;
    }
    last = next;
  });
  return { inputArgs, chain, outLabel: last };
}
