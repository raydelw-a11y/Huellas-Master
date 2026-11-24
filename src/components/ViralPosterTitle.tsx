import React, { useEffect, useMemo, useState } from 'react';
import leagueGothicUrl from '../assets/fonts/LeagueGothic.ttf';
import { VIRAL_TITLE_LOOK } from '../utils/viralTitle';

// Preview of the Viral Clips "poster" title: the same letters, colours, sizes and position as the image the
// Mac draws for the exported clip (server/viralTitleArt.ts). The worn texture here is a CSS mask, so its
// specks do not fall on the same spots as in the final video — the look is the same, the pattern is not.

const FONT_STYLE_ID = 'huellas-league-gothic-face';

function ensureLeagueGothicFace() {
  if (typeof document === 'undefined' || document.getElementById(FONT_STYLE_ID)) return;
  const st = document.createElement('style');
  st.id = FONT_STYLE_ID;
  st.textContent = `@font-face{font-family:'${VIRAL_TITLE_LOOK.fontFamily}';src:url(${leagueGothicUrl}) format('truetype');font-display:swap;}`;
  document.head.appendChild(st);
}

const WORN_MASK_URL =
  "url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='260' height='260'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.75' numOctaves='2' seed='7'/%3E%3CfeColorMatrix values='0 0 0 0 1 0 0 0 0 1 0 0 0 0 1 0 0 0 -13 8.9'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23n)'/%3E%3C/svg%3E\")";

export interface ViralPosterTitleProps {
  lines: string[];
  /** Preview frame size in CSS pixels */
  frameW: number;
  frameH: number;
  /** Widest line as a fraction of the frame width, and largest ASS font size as a fraction of its height */
  maxTextWFrac: number;
  maxFontHFrac: number;
  /** Top of the text box, in CSS pixels from the top of the frame (what the render calls the title's top) */
  topPx: number;
  visible: boolean;
}

/** CSS font size (px) that the render would use for these lines in a frame of this size. */
export function useViralPosterFontPx(
  lines: string[],
  frameW: number,
  frameH: number,
  maxTextWFrac: number,
  maxFontHFrac: number
): number {
  const [fontReady, setFontReady] = useState(false);
  useEffect(() => {
    ensureLeagueGothicFace();
    let alive = true;
    try {
      (document as any).fonts
        ?.load(`40px "${VIRAL_TITLE_LOOK.fontFamily}"`)
        .then(() => alive && setFontReady(true))
        .catch(() => alive && setFontReady(true));
    } catch {
      setFontReady(true);
    }
    return () => {
      alive = false;
    };
  }, []);
  return useMemo(() => {
    const L = VIRAL_TITLE_LOOK;
    const emCap = (frameH * maxFontHFrac) / L.assHeightRatio;
    if (lines.length === 0 || frameW <= 0) return emCap;
    let widest = 0;
    try {
      const ctx = document.createElement('canvas').getContext('2d');
      if (ctx) {
        ctx.font = `100px "${L.fontFamily}", Impact, sans-serif`;
        for (const line of lines) {
          const w = ctx.measureText(line).width + L.spacing * L.assHeightRatio * 100 * line.length;
          if (w > widest) widest = w;
        }
      }
    } catch {}
    if (widest <= 0) return emCap;
    return Math.max(6, Math.min(emCap, (100 * frameW * maxTextWFrac) / widest));
    // fontReady: measure again once the real font is in
  }, [lines.join('\n'), frameW, frameH, maxTextWFrac, maxFontHFrac, fontReady]);
}

/** Height of the drawn text (first cap line to the last baseline), for stacking the notice under the title. */
export function viralPosterTextHeightPx(lineCount: number, fontPx: number): number {
  const L = VIRAL_TITLE_LOOK;
  const assSize = fontPx * L.assHeightRatio;
  return Math.max(0, lineCount - 1) * L.lineStep * assSize + 0.565 * assSize;
}

export const ViralPosterTitle: React.FC<ViralPosterTitleProps> = ({
  lines,
  frameW,
  frameH,
  maxTextWFrac,
  maxFontHFrac,
  topPx,
  visible,
}) => {
  const L = VIRAL_TITLE_LOOK;
  const fontPx = useViralPosterFontPx(lines, frameW, frameH, maxTextWFrac, maxFontHFrac);
  if (lines.length === 0) return null;
  const base: React.CSSProperties = {
    gridArea: '1 / 1',
    fontFamily: `'${L.fontFamily}', Impact, 'Arial Narrow', sans-serif`,
    fontSize: `${fontPx.toFixed(2)}px`,
    lineHeight: L.lineStep * L.assHeightRatio,
    letterSpacing: `${(L.spacing * L.assHeightRatio).toFixed(4)}em`,
    textAlign: 'center',
    whiteSpace: 'nowrap',
  };
  const strokeEm = (2 * L.inkBord * L.assHeightRatio).toFixed(4);
  return (
    <div
      className="absolute inset-x-0 z-20 pointer-events-none"
      style={{
        // The render's top is the font's line-box top; the browser's line box sits 0.19 em higher
        top: `${(topPx + 0.189 * fontPx).toFixed(1)}px`,
        display: 'grid',
        justifyContent: 'center',
        opacity: visible ? 1 : 0,
        transition: 'opacity 0.25s linear',
      }}
      aria-hidden={!visible}
    >
      {/* Soft dark shadow under the letters (whole, so the worn spots read dark) */}
      <div style={{ ...base, color: 'transparent', textShadow: '0 0 0.1em rgba(0,0,0,0.95), 0 0 0.22em rgba(0,0,0,0.85)' }}>
        {lines.map((line, i) => (
          <div key={i} style={{ WebkitTextStroke: '0.12em rgba(0,0,0,0.9)' }}>
            {line}
          </div>
        ))}
      </div>
      <div
        style={{
          ...base,
          WebkitMaskImage: WORN_MASK_URL,
          maskImage: WORN_MASK_URL,
          WebkitMaskSize: `${(fontPx * 2.4).toFixed(0)}px`,
          maskSize: `${(fontPx * 2.4).toFixed(0)}px`,
        }}
      >
        {lines.map((line, i) => {
          const color = i === lines.length - 1 ? L.gold : L.boneWhite;
          return (
            <div key={i} style={{ color, WebkitTextStroke: `${strokeEm}em ${color}`, paintOrder: 'stroke fill' }}>
              {line}
            </div>
          );
        })}
      </div>
    </div>
  );
};
