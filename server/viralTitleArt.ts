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

export const VIRAL_TITLE_FONT_NAME = 'League Gothic';
/** ASS colours are &HBBGGRR& */
const BONE_WHITE_ASS = '&H00D6E7EF&'; // #EFE7D6
const GOLD_ASS = '&H003CAAE3&'; // #E3AA3C

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

/** "white part|gold part" on one line; otherwise a line is white, or gold when it is the last one. */
function parseTitleLines(rawLines: string[]): TitleLine[] {
  const lines = rawLines.map((l) => String(l || '').trim()).filter(Boolean);
  return lines
    .map((line, i) => {
      const toWords = (s: string, gold: boolean) =>
        s
          .split(/\s+/)
          .filter(Boolean)
          .map((text) => ({ text, gold }));
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
}): string {
  const { canvasW, canvasH, lines, fontSize, topY, shadow, oneWordPerSecond = false } = opts;
  // Lines sit tight, like a film poster
  const lineStep = fontSize * VIRAL_TITLE_LOOK.lineStep;
  // "A little bolder": an outline in the letter's own colour thickens every stroke
  const inkBord = Math.max(1, fontSize * VIRAL_TITLE_LOOK.inkBord);
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
    `Style: T,${VIRAL_TITLE_FONT_NAME},${fontSize.toFixed(1)},&H00FFFFFF,&H00FFFFFF,&H00FFFFFF,&H00000000,0,0,0,0,100,100,${(fontSize * VIRAL_TITLE_LOOK.spacing).toFixed(2)},0,1,0,0,8,0,0,0,1`,
    '',
    '[Events]',
    'Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text',
  ];
  const cx = Math.round(canvasW / 2);
  const shown = (w: TitleWord) => {
    if (shadow) {
      return `{\\alpha&H00&\\1c&H000000&\\3c&H000000&\\bord${Math.max(4, fontSize * 0.075).toFixed(2)}\\blur${Math.max(5, fontSize * 0.085).toFixed(1)}\\1a&H12&\\3a&H12&}${w.text}`;
    }
    const color = w.gold ? GOLD_ASS : BONE_WHITE_ASS;
    return `{\\alpha&H00&\\1c${color}\\3c${color}\\bord${inkBord.toFixed(2)}}${w.text}`;
  };
  const hidden = (w: TitleWord) => `{\\alpha&HFF&\\bord0\\blur0}${w.text}`;
  const lineEvent = (lineIdx: number, text: string, startSec: number, endSec: number) =>
    `Dialogue: 0,${assTime(startSec)},${assTime(endSec)},T,,0,0,0,,{\\an8\\pos(${cx},${Math.round(topY + lineIdx * lineStep)})}${text}`;
  if (!oneWordPerSecond) {
    lines.forEach((line, i) => out.push(lineEvent(i, line.map(shown).join(' '), 0, 3600)));
    return out.join('\n');
  }
  let k = 0;
  lines.forEach((line, i) => {
    line.forEach((_w, j) => {
      const text = line.map((w, jj) => (jj === j ? shown(w) : hidden(w))).join(' ');
      out.push(lineEvent(i, text, k, k + 1));
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
 * Filter graph that draws the text ASS over its shadow ASS with the worn texture, ending in [art].
 * The texture is multiplied into the letters' opacity (the shadow underneath stays whole, so the worn spots
 * read dark, as on a printed poster): light pitting that is denser in some areas than others, a few small
 * chipped patches, and the odd thin scratch.
 * The noise is a position hash, not random(): geq runs in slices and random() repeats in each one.
 */
function texturedTitleGraph(opts: {
  canvasW: number;
  canvasH: number;
  fontSize: number;
  fontsDir: string;
  textAss: string;
  shadowAss: string;
}): string {
  const { canvasW, canvasH, fontSize, fontsDir, textAss, shadowAss } = opts;
  const hash = (seed: number) => `mod(abs(sin(X*12.9898+Y*78.233+${seed})*43758.5453),1)`;
  const src = (expr: string, w: number, h: number) =>
    `nullsrc=s=${Math.max(2, Math.round(w))}x${Math.max(2, Math.round(h))}:r=1,format=gray,geq=lum='${expr}'`;
  const up = (flags: string) => `scale=${canvasW}:${canvasH}:flags=${flags},format=gray`;
  const g = Math.max(2, fontSize / 85);
  const fontsArg = `fontsdir='${escFilterPath(fontsDir)}'`;
  return [
    `color=c=black@0.0:s=${canvasW}x${canvasH}:r=1,format=rgba,ass=filename='${escFilterPath(textAss)}':${fontsArg}:alpha=1,split[t1][t2]`,
    `[t1]alphaextract,format=gray[ta]`,
    `${src(`255*${hash(11)}`, canvasW / g, canvasH / g)},${up('bilinear')}[nfine]`,
    `${src(`255*${hash(23)}`, canvasW / (g * 34), canvasH / (g * 34))},${up('bicubic')}[nlow]`,
    `[nfine][nlow]blend=all_expr='if(gt(A,234+B*0.16),0,255)',gblur=sigma=0.7[mpit]`,
    `${src(`255*${hash(37)}`, canvasW / (g * 4.5), canvasH / (g * 4.5))},${up('bicubic')},lutyuv=y='if(gt(val,246),0,255)'[mchip]`,
    `${src(`if(gt(${hash(51)},0.998),0,255)`, canvasW / (g * 20), canvasH / (g * 0.7))},${up('bilinear')}[mscrh]`,
    `${src(`if(gt(${hash(67)},0.9992),0,255)`, canvasW / (g * 0.7), canvasH / (g * 16))},${up('bilinear')}[mscrv]`,
    `[mpit][mchip]blend=all_mode=multiply[m1]`,
    `[mscrh][mscrv]blend=all_mode=multiply[m2]`,
    `[m1][m2]blend=all_mode=multiply[mask]`,
    `[ta][mask]blend=all_mode=multiply[ta2]`,
    `[t2][ta2]alphamerge[txt]`,
    `color=c=black@0.0:s=${canvasW}x${canvasH}:r=1,format=rgba,ass=filename='${escFilterPath(shadowAss)}':${fontsArg}:alpha=1[sh]`,
    `[sh][txt]overlay=format=auto[art]`,
  ].join(';');
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
  maxFontSize: number
): number | null {
  const refSize = 200;
  const refW = 8000;
  const refH = Math.round(200 + lines.length * refSize * 1.2);
  const refAss = tmp.write(`${name}_ref.ass`, buildTitleAss({ canvasW: refW, canvasH: refH, lines, fontSize: refSize, topY: 60, shadow: false }));
  const box = measureAssBoxes(ffmpegBin, fontsDir, refAss, refW, refH, 1)[0];
  if (!box) return null;
  const refTextW = Math.max(1, box.x2 - box.x1 + 1);
  return Math.max(18, Math.min(maxFontSize, (refSize * maxTextWidthPx) / refTextW));
}

const padFor = (fontSize: number) => Math.round(Math.max(28, fontSize * 0.36));
const canvasHeightFor = (lineCount: number, fontSize: number) =>
  2 * Math.round((padFor(fontSize) * 2 + lineCount * fontSize * 1.05 + 40) / 2);

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
  maxFontSize: number;
  outPath: string;
}): ViralTitleArt | null {
  const { ffmpegBin, fontsDir, frameW, maxTextWidthPx, maxFontSize, outPath } = opts;
  const lines = parseTitleLines(opts.lines);
  if (lines.length === 0) return null;
  if (!fs.existsSync(path.join(fontsDir, 'LeagueGothic.ttf'))) return null;
  const tmp = tempFiles();
  try {
    const fontSize = fitFontSize(ffmpegBin, fontsDir, tmp, 'art', lines, maxTextWidthPx, maxFontSize);
    if (!fontSize) return null;
    const pad = padFor(fontSize);
    const canvasW = 2 * Math.round(frameW / 2);
    const canvasH = canvasHeightFor(lines.length, fontSize);
    const assArgs = { canvasW, canvasH, lines, fontSize, topY: pad };
    const textAss = tmp.write('art_text.ass', buildTitleAss({ ...assArgs, shadow: false }));
    const shadowAss = tmp.write('art_shadow.ass', buildTitleAss({ ...assArgs, shadow: true }));
    const box = measureAssBoxes(ffmpegBin, fontsDir, textAss, canvasW, canvasH, 1)[0];
    if (!box) return null;
    const cropY = Math.max(0, box.y1 - pad);
    const cropH = 2 * Math.round(Math.min(canvasH - cropY, box.y2 - box.y1 + 1 + pad * 2) / 2);
    const graph = `${texturedTitleGraph({ canvasW, canvasH, fontSize, fontsDir, textAss, shadowAss })};[art]crop=${canvasW}:${cropH}:0:${cropY}[out]`;
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
}): ViralTitleWordsArt | null {
  const { ffmpegBin, fontsDir, frameW, outPrefix } = opts;
  const bigLines = parseTitleLines(opts.bigLines);
  const smallLines = parseTitleLines(opts.smallLines);
  const wordCount = bigLines.reduce((acc, l) => acc + l.length, 0);
  if (wordCount === 0 || wordCount > 40) return null;
  if (smallLines.reduce((acc, l) => acc + l.length, 0) !== wordCount) return null;
  if (!fs.existsSync(path.join(fontsDir, 'LeagueGothic.ttf'))) return null;
  const tmp = tempFiles();
  try {
    const bigFont = fitFontSize(ffmpegBin, fontsDir, tmp, 'big', bigLines, opts.bigMaxTextWidthPx, opts.bigMaxFontSize);
    const smallFontFit = fitFontSize(ffmpegBin, fontsDir, tmp, 'small', smallLines, opts.smallMaxTextWidthPx, opts.smallMaxFontSize);
    if (!bigFont || !smallFontFit) return null;
    // The small line is never bigger than the opening title
    const smallFont = Math.min(smallFontFit, bigFont);
    const scale = smallFont / bigFont;
    const canvasW = 2 * Math.round(frameW / 2);

    // Where each word sits: one frame per word, in the big title and in the small line
    const bigPad = padFor(bigFont);
    const bigH = canvasHeightFor(bigLines.length, bigFont);
    const bigArgs = { canvasW, canvasH: bigH, lines: bigLines, fontSize: bigFont, topY: bigPad, oneWordPerSecond: true };
    const bigTextAss = tmp.write('big_text.ass', buildTitleAss({ ...bigArgs, shadow: false }));
    const bigShadowAss = tmp.write('big_shadow.ass', buildTitleAss({ ...bigArgs, shadow: true }));
    const bigBoxes = measureAssBoxes(ffmpegBin, fontsDir, bigTextAss, canvasW, bigH, wordCount);
    const smallPad = padFor(smallFont);
    const smallH = canvasHeightFor(smallLines.length, smallFont);
    const smallTextAss = tmp.write(
      'small_text.ass',
      buildTitleAss({ canvasW, canvasH: smallH, lines: smallLines, fontSize: smallFont, topY: smallPad, shadow: false, oneWordPerSecond: true })
    );
    const smallBoxes = measureAssBoxes(ffmpegBin, fontsDir, smallTextAss, canvasW, smallH, wordCount);
    if (bigBoxes.some((b) => !b) || smallBoxes.some((b) => !b)) return null;

    // Every word drawn with its shadow and texture, each on its own full-size frame
    const seqPattern = path.join(os.tmpdir(), `viral_title_seq_${Date.now()}_${Math.round(Math.random() * 1e6)}_%02d.png`);
    const seqFile = (k: number) => seqPattern.replace('%02d', String(k).padStart(2, '0'));
    const seqRun = runFfmpeg(ffmpegBin, [
      '-filter_complex',
      texturedTitleGraph({ canvasW, canvasH: bigH, fontSize: bigFont, fontsDir, textAss: bigTextAss, shadowAss: bigShadowAss }),
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
      const margin = Math.round(bigFont * 0.3);
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
      return { words, scale, smallTextBottom };
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
 * ffmpeg inputs and filter chain that lay the title's words over `inLabel`: each word sits in the big title,
 * then (with `morph`) shrinks and glides to its place in the small line, one word slightly after the other,
 * easing in and out, and stays there until the end of the clip.
 */
export function buildViralTitleWordFilters(opts: {
  art: ViralTitleWordsArt;
  firstInputIdx: number;
  inLabel: string;
  /** Frame y where the title's letters start */
  titleTopY: number;
  totalDurSec: number;
  morph: { startSec: number; durSec: number; staggerSec: number } | null;
}): { inputArgs: string[]; chain: string; outLabel: string } {
  const { art, firstInputIdx, titleTopY, totalDurSec, morph } = opts;
  const inputArgs: string[] = [];
  let chain = '';
  let last = opts.inLabel;
  const f = (n: number) => n.toFixed(3);
  art.words.forEach((w, k) => {
    inputArgs.push('-loop', '1', '-framerate', '30', '-t', f(totalDurSec + 0.5), '-i', w.path);
    const x0 = w.bigX;
    const y0 = titleTopY + w.bigY;
    let scaleFilter = '';
    let xExpr = f(x0);
    let yExpr = f(y0);
    if (morph) {
      const p = `clip((t-${f(morph.startSec + k * morph.staggerSec)})/${f(morph.durSec)},0,1)`;
      // Smoothstep: starts and lands gently
      const e = `(${p}*${p}*(3-2*${p}))`;
      const sizeExpr = (px: number) => `max(2,${px}*(1+(${f(art.scale)}-1)*${e}))`;
      scaleFilter = `,scale=w='${sizeExpr(w.width)}':h='${sizeExpr(w.height)}':eval=frame:flags=bilinear`;
      xExpr = `${f(x0)}+(${f(w.smallX)}-${f(x0)})*${e}`;
      yExpr = `${f(y0)}+(${f(titleTopY + w.smallY)}-${f(y0)})*${e}`;
    }
    const next = `vtw${k}`;
    chain += `;[${firstInputIdx + k}:v]format=rgba,fade=t=in:st=0:d=0.25:alpha=1${scaleFilter}[tword${k}];[${last}][tword${k}]overlay=x='${xExpr}':y='${yExpr}':eof_action=pass:format=auto[${next}]`;
    last = next;
  });
  return { inputArgs, chain, outLabel: last };
}
