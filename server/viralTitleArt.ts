// Viral Clips — on-screen title drawn as an image.
// The title and the "VIDEO COMPLETO EN YOUTUBE" notice use a tall condensed poster face (League Gothic,
// slightly thickened), bone-white lines with the last one in gold, a soft dark shadow so they read over any
// picture, and a worn "printed poster" texture. Subtitles cannot carry a texture, so each text is rendered once
// to a transparent PNG (libass draws the letters, a noise mask wears them down) and laid over the video.
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

const escFilterPath = (p: string) => p.replace(/\\/g, '/').replace(/:/g, '\\:').replace(/'/g, "\\'");

function buildTitleAss(opts: {
  canvasW: number;
  canvasH: number;
  lines: string[];
  fontSize: number;
  topY: number;
  shadow: boolean;
}): string {
  const { canvasW, canvasH, lines, fontSize, topY, shadow } = opts;
  // Lines sit tight, like a film poster
  const lineStep = fontSize * VIRAL_TITLE_LOOK.lineStep;
  // "A little bolder": an outline in the letter's own colour thickens every stroke
  const inkBord = Math.max(1, fontSize * VIRAL_TITLE_LOOK.inkBord);
  const head = [
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
  lines.forEach((line, i) => {
    const y = Math.round(topY + i * lineStep);
    const isGold = i === lines.length - 1;
    const tags = shadow
      ? `\\1c&H000000&\\3c&H000000&\\bord${Math.max(4, fontSize * 0.075).toFixed(2)}\\blur${Math.max(5, fontSize * 0.085).toFixed(1)}\\1a&H12&\\3a&H12&`
      : `\\1c${isGold ? GOLD_ASS : BONE_WHITE_ASS}\\3c${isGold ? GOLD_ASS : BONE_WHITE_ASS}\\bord${inkBord.toFixed(2)}`;
    head.push(`Dialogue: 0,0:00:00.00,0:00:10.00,T,,0,0,0,,{\\an8\\pos(${cx},${y})${tags}}${line}`);
  });
  return head.join('\n');
}

function runFfmpeg(ffmpegBin: string, args: string[]): { ok: boolean; stderr: string } {
  const r = spawnSync(ffmpegBin, ['-hide_banner', '-y', ...args], { encoding: 'utf8', timeout: 60000 });
  return { ok: r.status === 0, stderr: String(r.stderr || '') };
}

/** Bounding box of whatever the ASS draws on a transparent canvas (null when nothing was drawn). */
function measureAssBox(
  ffmpegBin: string,
  fontsDir: string,
  assPath: string,
  canvasW: number,
  canvasH: number
): { x1: number; x2: number; y1: number; y2: number } | null {
  const r = runFfmpeg(ffmpegBin, [
    '-f',
    'lavfi',
    '-i',
    `color=c=black@0.0:s=${canvasW}x${canvasH}:r=1,format=rgba`,
    '-vf',
    `ass=filename='${escFilterPath(assPath)}':fontsdir='${escFilterPath(fontsDir)}':alpha=1,alphaextract,bbox=min_val=24`,
    '-frames:v',
    '1',
    '-f',
    'null',
    '-',
  ]);
  const m = r.stderr.match(/x1:(\d+) x2:(\d+) y1:(\d+) y2:(\d+)/);
  if (!m) return null;
  return { x1: Number(m[1]), x2: Number(m[2]), y1: Number(m[3]), y2: Number(m[4]) };
}

/**
 * Draws the lines as one transparent PNG, `frameW` wide (so it is laid at x = 0) and cropped to the text's
 * height. The font grows until the widest line fills `maxTextWidthPx`, up to `maxFontSize`.
 * Returns null when it cannot be drawn (missing font, ffmpeg error): the caller then leaves the title out
 * rather than failing the whole clip.
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
  const lines = opts.lines.map((l) => String(l || '').trim()).filter(Boolean);
  if (lines.length === 0) return null;
  if (!fs.existsSync(path.join(fontsDir, 'LeagueGothic.ttf'))) return null;
  const stamp = `${Date.now()}_${Math.round(Math.random() * 1e6)}`;
  const tmp = (name: string) => path.join(os.tmpdir(), `viral_title_${stamp}_${name}`);
  const made: string[] = [];
  const writeAss = (name: string, content: string) => {
    const p = tmp(name);
    fs.writeFileSync(p, content, 'utf8');
    made.push(p);
    return p;
  };
  try {
    // 1) Measure at a reference size on a roomy canvas, then scale the font to the wanted width
    const refSize = 200;
    const refW = 6000;
    const refH = Math.round(200 + lines.length * refSize * 1.2);
    const refAss = writeAss('ref.ass', buildTitleAss({ canvasW: refW, canvasH: refH, lines, fontSize: refSize, topY: 60, shadow: false }));
    const refBox = measureAssBox(ffmpegBin, fontsDir, refAss, refW, refH);
    if (!refBox) return null;
    const refTextW = Math.max(1, refBox.x2 - refBox.x1 + 1);
    const fontSize = Math.max(18, Math.min(maxFontSize, (refSize * maxTextWidthPx) / refTextW));

    // 2) Final size: measure again to crop exactly
    const pad = Math.round(Math.max(28, fontSize * 0.36));
    const canvasW = 2 * Math.round(frameW / 2);
    const canvasH = 2 * Math.round((pad * 2 + lines.length * fontSize * 1.05 + 40) / 2);
    const assArgs = { canvasW, canvasH, lines, fontSize, topY: pad };
    const textAss = writeAss('text.ass', buildTitleAss({ ...assArgs, shadow: false }));
    const shadowAss = writeAss('shadow.ass', buildTitleAss({ ...assArgs, shadow: true }));
    const box = measureAssBox(ffmpegBin, fontsDir, textAss, canvasW, canvasH);
    if (!box) return null;
    const cropY = Math.max(0, box.y1 - pad);
    const cropH = 2 * Math.round(Math.min(canvasH - cropY, box.y2 - box.y1 + 1 + pad * 2) / 2);

    // 3) Worn texture, multiplied into the letters' opacity (the shadow underneath stays whole, so the worn
    //    spots read dark, as on a printed poster): fine pitting that is denser in some areas than others,
    //    small chipped patches, and thin horizontal and vertical scratches.
    //    The noise is a position hash, not random(): geq runs in slices and random() repeats in each one.
    const hash = (seed: number) => `mod(abs(sin(X*12.9898+Y*78.233+${seed})*43758.5453),1)`;
    const src = (expr: string, w: number, h: number) =>
      `nullsrc=s=${Math.max(2, Math.round(w))}x${Math.max(2, Math.round(h))}:r=1,format=gray,geq=lum='${expr}'`;
    const up = (flags: string) => `scale=${canvasW}:${canvasH}:flags=${flags},format=gray`;
    const g = Math.max(2, fontSize / 85);
    const fontsArg = `fontsdir='${escFilterPath(fontsDir)}'`;
    const graph = [
      `color=c=black@0.0:s=${canvasW}x${canvasH}:r=1,format=rgba,ass=filename='${escFilterPath(textAss)}':${fontsArg}:alpha=1,split[t1][t2]`,
      `[t1]alphaextract,format=gray[ta]`,
      `${src(`255*${hash(11)}`, canvasW / g, canvasH / g)},${up('bilinear')}[nfine]`,
      `${src(`255*${hash(23)}`, canvasW / (g * 34), canvasH / (g * 34))},${up('bicubic')}[nlow]`,
      `[nfine][nlow]blend=all_expr='if(gt(A,192+B*0.27),0,255)',gblur=sigma=0.7[mpit]`,
      `${src(`255*${hash(37)}`, canvasW / (g * 4.5), canvasH / (g * 4.5))},${up('bicubic')},lutyuv=y='if(gt(val,220),0,255)'[mchip]`,
      `${src(`if(gt(${hash(51)},0.99),0,255)`, canvasW / (g * 20), canvasH / (g * 0.7))},${up('bilinear')}[mscrh]`,
      `${src(`if(gt(${hash(67)},0.995),0,255)`, canvasW / (g * 0.7), canvasH / (g * 16))},${up('bilinear')}[mscrv]`,
      `[mpit][mchip]blend=all_mode=multiply[m1]`,
      `[mscrh][mscrv]blend=all_mode=multiply[m2]`,
      `[m1][m2]blend=all_mode=multiply[mask]`,
      `[ta][mask]blend=all_mode=multiply[ta2]`,
      `[t2][ta2]alphamerge[txt]`,
      `color=c=black@0.0:s=${canvasW}x${canvasH}:r=1,format=rgba,ass=filename='${escFilterPath(shadowAss)}':${fontsArg}:alpha=1[sh]`,
      `[sh][txt]overlay=format=auto,crop=${canvasW}:${cropH}:0:${cropY}[out]`,
    ].join(';');
    const r = runFfmpeg(ffmpegBin, ['-filter_complex', graph, '-map', '[out]', '-frames:v', '1', outPath]);
    if (!r.ok || !fs.existsSync(outPath)) {
      console.warn('[ViralClips] No se pudo dibujar el título:', r.stderr.slice(-400));
      return null;
    }
    return { path: outPath, width: canvasW, height: cropH, padTop: box.y1 - cropY };
  } catch (e) {
    console.warn('[ViralClips] No se pudo dibujar el título:', e);
    return null;
  } finally {
    for (const p of made) {
      try {
        fs.unlinkSync(p);
      } catch {}
    }
  }
}
