import React, { useEffect, useMemo, useRef } from 'react';
import { VIRAL_TITLE_LOOK } from '../utils/viralTitle';
import {
  VIRAL_REF_CAP_ASS,
  viralFontById,
  viralTitleEntrance,
  viralTitleEntranceState,
  viralTitleLineStepFactor,
  viralTitleWordLines,
  type ViralDocStyle,
  type ViralFontDef,
  type ViralTexture,
  type ViralTitleWordDraw,
} from '../utils/viralStyle';
import {
  measureViralTextWidth100,
  useViralFontTick,
  viralFontCssFamily,
  viralFontCssWeight,
  viralFontMetrics,
  type ViralFontMetrics,
} from '../utils/viralFonts';

// Preview of the Viral Clips title when the documentary has its own design: the font, colours, outline,
// shadow, texture and entrance animation the Mac draws for the exported clip (server/viralTitleArt.ts).
// Sizes follow the height of the capitals, as in the render. The texture is a CSS mask, so its specks do not
// fall on the same spots as in the final video — the look is the same, the pattern is not.

export interface ViralStyledTitleLayout {
  fontPx: number;
  /** The size in title units: the League Gothic ASS font size whose capitals are as tall */
  unit: number;
  lineStepPx: number;
  capPx: number;
  /** First line's capitals top to the last line's baseline */
  textHeightPx: number;
  metrics: ViralFontMetrics;
}

/** Sizes the render would give these lines in a frame of this size (same rules as server/viralTitleArt.ts). */
export function viralStyledTitleLayout(
  font: ViralFontDef,
  wordLines: ViralTitleWordDraw[][],
  frameW: number,
  frameH: number,
  maxTextWFrac: number,
  maxFontHFrac: number
): ViralStyledTitleLayout {
  const L = VIRAL_TITLE_LOOK;
  const metrics = viralFontMetrics(font);
  const unitPerPx = metrics.capEm / VIRAL_REF_CAP_ASS;
  const maxFontPx = (frameH * maxFontHFrac) / unitPerPx;
  let widest = 0;
  for (const line of wordLines) {
    const w = measureViralTextWidth100(font, line.map((x) => x.text).join(' '), L.spacing * 100 * unitPerPx);
    if (w > widest) widest = w;
  }
  const fontPx =
    widest > 0 && frameW > 0 ? Math.max(4, Math.min(maxFontPx, (100 * frameW * maxTextWFrac) / widest)) : maxFontPx;
  const unit = fontPx * unitPerPx;
  const lineStepPx = L.lineStep * viralTitleLineStepFactor(font) * unit;
  const capPx = fontPx * metrics.capEm;
  return {
    fontPx,
    unit,
    lineStepPx,
    capPx,
    textHeightPx: Math.max(0, wordLines.length - 1) * lineStepPx + capPx,
    metrics,
  };
}

const svgMask = (size: number, filter: string): string =>
  `url("data:image/svg+xml,${encodeURIComponent(
    `<svg xmlns='http://www.w3.org/2000/svg' width='${size}' height='${size}'><filter id='n' x='0' y='0' width='100%' height='100%'>${filter}</filter><rect width='100%' height='100%' filter='url(#n)'/></svg>`
  )}")`;
const alphaRow = (slope: number, offset: number) =>
  `<feColorMatrix values='0 0 0 0 1 0 0 0 0 1 0 0 0 0 1 0 0 0 ${slope.toFixed(2)} ${offset.toFixed(2)}'/>`;

/** CSS mask that wears the letters like the render's texture does. `amount`: 0–1 (0.5 is the classic wear). */
function textureMaskStyle(texture: ViralTexture, amount: number, unit: number): React.CSSProperties {
  if (texture === 'none' || amount <= 0) return {};
  const a = Math.max(0, Math.min(1, amount));
  const pits = (strength: number, result: string) =>
    `<feTurbulence type='fractalNoise' baseFrequency='0.75' numOctaves='2' seed='7'/>` +
    alphaRow(-13, 9.9 + (0.5 - strength) * 2.4).replace('/>', ` result='${result}'/>`);
  let filter = '';
  let size = 260;
  let sizeUnits = 1.84;
  if (texture === 'worn') {
    filter = pits(a, 'p');
  } else if (texture === 'grain') {
    size = 200;
    sizeUnits = 1.1;
    filter = `<feTurbulence type='fractalNoise' baseFrequency='1.25' numOctaves='1' seed='4'/>` + alphaRow(-1.2 * a, 1 + 0.42 * a);
  } else if (texture === 'scratched') {
    size = 320;
    sizeUnits = 2.4;
    filter =
      `<feTurbulence type='fractalNoise' baseFrequency='0.006 0.6' numOctaves='2' seed='3'/>` +
      alphaRow(-30, 20.6 + (0.5 - a) * 2).replace('/>', ` result='h'/>`) +
      `<feTurbulence type='fractalNoise' baseFrequency='0.7 0.008' numOctaves='2' seed='9'/>` +
      alphaRow(-30, 21.4 + (0.5 - a) * 1.6).replace('/>', ` result='v'/>`) +
      `<feComposite in='h' in2='v' operator='in'/>`;
  } else if (texture === 'stone') {
    size = 320;
    sizeUnits = 2.6;
    filter =
      `<feTurbulence type='fractalNoise' baseFrequency='0.11' numOctaves='3' seed='11'/>` +
      alphaRow(-16, 11.7 + (0.5 - a) * 1.6).replace('/>', ` result='c'/>`) +
      pits(a * 0.45, 'p') +
      `<feComposite in='c' in2='p' operator='in'/>`;
  } else if (texture === 'ink') {
    size = 320;
    sizeUnits = 3;
    filter =
      `<feTurbulence type='fractalNoise' baseFrequency='0.03' numOctaves='2' seed='5'/>` +
      alphaRow(-2.2 * a, 1 + 1.1 * a).replace('/>', ` result='b'/>`) +
      pits(a * 0.25, 'p') +
      `<feComposite in='b' in2='p' operator='in'/>`;
  }
  if (!filter) return {};
  const image = svgMask(size, filter);
  const px = `${Math.max(24, unit * sizeUnits).toFixed(0)}px`;
  return { WebkitMaskImage: image, maskImage: image, WebkitMaskSize: px, maskSize: px };
}

export interface ViralStyledTitleProps {
  lines: string[];
  frameW: number;
  frameH: number;
  maxTextWFrac: number;
  maxFontHFrac: number;
  /** Where the first line's capitals start, in CSS pixels from the top of the frame */
  topPx: number;
  visible: boolean;
  docStyle: ViralDocStyle;
  /** Given (the clip's current second): this title plays the design's entrance while the clip plays */
  clipSec?: number;
  /** While the clip plays, the clip's second is read every frame from here */
  playing?: boolean;
  getClipSec?: () => number;
}

export const ViralStyledTitle: React.FC<ViralStyledTitleProps> = ({
  lines,
  frameW,
  frameH,
  maxTextWFrac,
  maxFontHFrac,
  topPx,
  visible,
  docStyle,
  clipSec,
  playing,
  getClipSec,
}) => {
  const L = VIRAL_TITLE_LOOK;
  const font = viralFontById(docStyle.titleFont);
  const fontTick = useViralFontTick(font);
  const linesKey = lines.join('\n');
  const wordLines = useMemo(() => viralTitleWordLines(lines, font.titleCase), [linesKey, font.titleCase]);
  const layout = useMemo(
    () => viralStyledTitleLayout(font, wordLines, frameW, frameH, maxTextWFrac, maxFontHFrac),
    [font.id, wordLines, frameW, frameH, maxTextWFrac, maxFontHFrac, fontTick]
  );
  const wordCount = wordLines.reduce((acc, l) => acc + l.length, 0);
  const wordEls = useRef<Array<HTMLSpanElement | null>>([]);
  const anim = docStyle.titleAnimation;
  const animated = typeof clipSec === 'number';
  const { unit, fontPx } = layout;

  // How each word looks at a clip second (the same curves as the render's filters)
  const applyAt = (t: number | null) => {
    for (let k = 0; k < wordCount; k++) {
      const el = wordEls.current[k];
      if (!el) continue;
      const st = t === null ? null : viralTitleEntranceState(anim, k, wordCount, t);
      el.style.opacity = st ? String(Number(st.opacity.toFixed(3))) : '';
      el.style.transform =
        st && (st.shiftFrac !== 0 || st.scale !== 1)
          ? `translateX(${(st.shiftFrac * frameW).toFixed(1)}px) scale(${st.scale.toFixed(3)})`
          : '';
      el.style.clipPath = st && st.reveal < 1 ? `inset(-40% ${((1 - st.reveal) * 100).toFixed(1)}% -40% -40%)` : '';
      el.style.filter = st && st.blurUnits > 0 ? `blur(${(st.blurUnits * unit).toFixed(2)}px)` : '';
    }
  };
  const applyRef = useRef(applyAt);
  applyRef.current = applyAt;
  const getClipSecRef = useRef(getClipSec);
  getClipSecRef.current = getClipSec;
  const entranceEnd = useMemo(() => {
    let end = 0;
    for (let k = 0; k < wordCount; k++) {
      const e = viralTitleEntrance(anim, k, wordCount);
      end = Math.max(end, e.startSec + e.durSec);
    }
    return end;
  }, [anim, wordCount]);
  useEffect(() => {
    // The entrance is only played while the clip plays: paused, the title is shown whole (as it will be read)
    if (!animated || !playing || !getClipSecRef.current) {
      applyRef.current(null);
      return;
    }
    let raf = 0;
    let settled = false;
    let lastT = -1;
    let lastMoveAt = performance.now();
    const tick = () => {
      const t = getClipSecRef.current ? getClipSecRef.current() : 0;
      const now = performance.now();
      if (t !== lastT) {
        lastT = t;
        lastMoveAt = now;
      }
      // A video that is not advancing (still loading, or the phone has not let it start) shows the whole title
      const stalled = now - lastMoveAt > 350;
      // After the entrance nothing moves: touch the words again only if the clip goes back to its start
      if (t <= entranceEnd + 0.1 && !stalled) {
        applyRef.current(t);
        settled = false;
      } else if (!settled) {
        applyRef.current(null);
        settled = true;
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [animated, playing, entranceEnd, anim, wordCount, unit, frameW, linesKey]);

  if (wordLines.length === 0) return null;
  const m = layout.metrics;
  // Each line is a box one font size tall; this is where its capitals start inside it
  const capTopInLine = ((1 - (m.ascentEm + m.descentEm)) / 2 + m.ascentEm - m.capEm) * fontPx;
  const colorOf = (w: ViralTitleWordDraw) => (w.accent ? docStyle.titleAccentColor : docStyle.titleColor);
  const px = (units: number) => `${(units * unit).toFixed(2)}px`;
  const underStyle = (color: string): React.CSSProperties | null => {
    const shadows: string[] = [];
    let stroke = 0;
    if (docStyle.shadow === 'soft') {
      shadows.push(`0 0 ${px(0.077)} rgba(0,0,0,0.95)`, `0 0 ${px(0.169)} rgba(0,0,0,0.85)`);
      stroke = 0.092;
    } else if (docStyle.shadow === 'hard') {
      shadows.push(`${px(0.05)} ${px(0.06)} 0 rgba(0,0,0,0.88)`, `0 0 ${px(0.06)} rgba(0,0,0,0.55)`);
    } else if (docStyle.shadow === 'glow') {
      shadows.push(`0 0 ${px(0.09)} rgba(0,0,0,0.8)`, `0 0 ${px(0.14)} ${color}`, `0 0 ${px(0.26)} ${color}`);
    }
    if (docStyle.outline !== 'none') stroke = Math.max(stroke, docStyle.outline === 'thick' ? 0.13 : 0.064);
    if (shadows.length === 0 && stroke === 0) return null;
    return {
      position: 'absolute',
      left: 0,
      top: 0,
      color: 'transparent',
      ...(shadows.length ? { textShadow: shadows.join(', ') } : {}),
      ...(stroke > 0 ? { WebkitTextStroke: `${px(stroke)} rgba(0,0,0,${docStyle.outline !== 'none' ? 1 : 0.9})` } : {}),
    };
  };
  const mask = textureMaskStyle(docStyle.texture, (Number(docStyle.textureAmount) || 0) / 100, unit);
  let k = -1;
  return (
    <div
      className="absolute inset-0 z-20 pointer-events-none"
      style={{ opacity: visible ? 1 : 0, transition: 'opacity 0.25s linear' }}
      aria-hidden={!visible}
    >
      {wordLines.map((line, i) => (
        <div
          key={i}
          style={{
            position: 'absolute',
            left: 0,
            right: 0,
            top: `${(topPx + i * layout.lineStepPx - capTopInLine).toFixed(1)}px`,
            height: `${fontPx.toFixed(2)}px`,
            lineHeight: `${fontPx.toFixed(2)}px`,
            fontSize: `${fontPx.toFixed(2)}px`,
            fontFamily: viralFontCssFamily(font),
            fontWeight: viralFontCssWeight(font),
            fontSynthesis: 'none',
            letterSpacing: px(L.spacing),
            textAlign: 'center',
            whiteSpace: 'nowrap',
          }}
        >
          {line.map((w, j) => {
            k += 1;
            const idx = k;
            const color = colorOf(w);
            const under = underStyle(color);
            return (
              <React.Fragment key={j}>
                {j > 0 ? ' ' : null}
                <span
                  ref={(el) => {
                    wordEls.current[idx] = el;
                  }}
                  style={{ display: 'inline-block', position: 'relative', transformOrigin: '50% 50%' }}
                >
                  {under && (
                    <span aria-hidden style={under}>
                      {w.text}
                    </span>
                  )}
                  <span
                    style={{
                      position: 'relative',
                      display: 'inline-block',
                      // Room for accents and tails inside the masked box (the mask cuts at the box's edge)
                      padding: '0.45em 0.2em',
                      margin: '-0.45em -0.2em',
                      color,
                      WebkitTextStroke: `${px(2 * L.inkBord)} ${color}`,
                      paintOrder: 'stroke fill',
                      ...mask,
                      ...(mask.maskImage
                        ? { WebkitMaskPosition: `${idx * 37}px ${idx * 53}px`, maskPosition: `${idx * 37}px ${idx * 53}px` }
                        : {}),
                    }}
                  >
                    {w.text}
                  </span>
                </span>
              </React.Fragment>
            );
          })}
        </div>
      ))}
    </div>
  );
};
