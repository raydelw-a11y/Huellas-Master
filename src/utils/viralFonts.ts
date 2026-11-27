// Viral Clips — fonts of the documentaries' designs in the page's preview. The files live on the Mac
// (data/fonts, the same ones the render uses) and are fetched once each; League Gothic comes with the page
// and Arial Black is a system font. Also measures each font the way the preview needs to size it like the
// render does.
import { useEffect, useState } from 'react';
import leagueGothicUrl from '../assets/fonts/LeagueGothic.ttf';
import {
  getMediaBridgeSnapshot,
  getOrderedMediaBridgeBases,
  isLocalMediaRuntimeOrigin,
  withTunnelAccessParam,
} from './mediaBridge';
import type { ViralFontDef } from './viralStyle';

/** The Mac's address when the page is not served by it (iPhone / GitHub Pages); '' on the Mac itself. */
function macOrigin(): string {
  if (typeof window === 'undefined' || isLocalMediaRuntimeOrigin()) return '';
  const origin = String(getMediaBridgeSnapshot().activeOrigin || getOrderedMediaBridgeBases()[0] || '').replace(/\/+$/, '');
  return origin && origin !== window.location.origin ? origin : '';
}

type FontState = 'loading' | 'ready' | 'failed';
const fontStates = new Map<string, FontState>();
const fontWaiters = new Map<string, Array<() => void>>();
const lastTryAt = new Map<string, number>();

function finish(id: string, state: FontState) {
  fontStates.set(id, state);
  metricsCache.delete(id);
  const waiters = fontWaiters.get(id) || [];
  fontWaiters.delete(id);
  waiters.forEach((w) => w());
}

/** Starts loading the font if needed. `onChange` is called when it becomes ready (or fails). */
export function ensureViralFont(font: ViralFontDef, onChange?: () => void): FontState {
  if (typeof document === 'undefined') return 'failed';
  // No file: the system has it (Arial Black)
  if (!font.file) {
    if (!fontStates.has(font.id)) {
      fontStates.set(font.id, 'loading');
      try {
        (document as any).fonts
          ?.load(`40px "${font.ass}"`)
          .then(() => finish(font.id, 'ready'))
          .catch(() => finish(font.id, 'ready'));
      } catch {
        finish(font.id, 'ready');
      }
    }
  } else {
    const state = fontStates.get(font.id);
    // A failed load (Mac asleep, tunnel not ready yet) is tried again after a while
    const retry = state === 'failed' && Date.now() - (lastTryAt.get(font.id) || 0) > 20000;
    if (!state || retry) {
      fontStates.set(font.id, 'loading');
      lastTryAt.set(font.id, Date.now());
      // League Gothic comes with the page; the others are read from the Mac
      const loading: Promise<FontFace> =
        font.id === 'league_gothic'
          ? new FontFace(font.ass, `url("${leagueGothicUrl}")`).load()
          : fetch(withTunnelAccessParam(`${macOrigin()}/api/viral-clips/font/${encodeURIComponent(font.file)}`))
              .then((r) => (r.ok ? r.arrayBuffer() : Promise.reject(new Error(String(r.status)))))
              .then((buf) => new FontFace(font.ass, buf).load());
      loading
        .then((face) => {
          (document as any).fonts.add(face);
          finish(font.id, 'ready');
        })
        .catch(() => finish(font.id, 'failed'));
    }
  }
  const now = fontStates.get(font.id) || 'loading';
  if (now === 'loading' && onChange) {
    fontWaiters.set(font.id, [...(fontWaiters.get(font.id) || []), onChange]);
  }
  return now;
}

/** Re-renders the caller when the font finishes loading; returns a value that changes when it does. */
export function useViralFontTick(font: ViralFontDef | null): number {
  const [tick, setTick] = useState(0);
  useEffect(() => {
    if (!font) return;
    let alive = true;
    const state = ensureViralFont(font, () => alive && setTick((t) => t + 1));
    // Failed before: ask again later (the Mac may be reachable by then)
    const timer = state === 'failed' ? window.setTimeout(() => alive && setTick((t) => t + 1), 21000) : 0;
    return () => {
      alive = false;
      if (timer) window.clearTimeout(timer);
    };
  }, [font?.id, tick]);
  return tick;
}

/** CSS font-family value for the font (with fallbacks while it loads). */
export function viralFontCssFamily(font: ViralFontDef): string {
  const fallback = font.widthFactor < 1.45 ? "Impact, 'Arial Narrow', sans-serif" : "'Arial Black', 'Helvetica Neue', sans-serif";
  return `'${font.ass}', ${fallback}`;
}
/** Weight the font is used at (loaded files carry their own weight; only Arial Black is asked for as black). */
export function viralFontCssWeight(font: ViralFontDef): number {
  return font.file ? 400 : 900;
}

export interface ViralFontMetrics {
  /** Capital height, ascent and descent of the line, in ems */
  capEm: number;
  ascentEm: number;
  descentEm: number;
}
const metricsCache = new Map<string, ViralFontMetrics>();
let measureCtx: CanvasRenderingContext2D | null = null;
function ctx2d(): CanvasRenderingContext2D | null {
  if (measureCtx) return measureCtx;
  try {
    measureCtx = document.createElement('canvas').getContext('2d');
  } catch {
    measureCtx = null;
  }
  return measureCtx;
}

/** The font's proportions as the browser draws it (measured once it is loaded; a guess until then). */
export function viralFontMetrics(font: ViralFontDef): ViralFontMetrics {
  const cached = metricsCache.get(font.id);
  if (cached) return cached;
  // Until measured: most fonts' full line is about 1.3 ems tall
  let out: ViralFontMetrics = { capEm: font.capAss * 1.3, ascentEm: 0.95, descentEm: 0.3 };
  const ctx = ctx2d();
  if (ctx) {
    try {
      ctx.font = `${viralFontCssWeight(font)} 200px ${viralFontCssFamily(font)}`;
      const m = ctx.measureText('H');
      const cap = m.actualBoundingBoxAscent / 200;
      const asc = Number((m as any).fontBoundingBoxAscent) / 200;
      const desc = Number((m as any).fontBoundingBoxDescent) / 200;
      if (cap > 0.2) {
        out = {
          capEm: cap,
          ascentEm: Number.isFinite(asc) && asc > 0 ? asc : cap * 1.3,
          descentEm: Number.isFinite(desc) && desc >= 0 ? desc : 0.3,
        };
      }
    } catch {}
  }
  if (fontStates.get(font.id) === 'ready') metricsCache.set(font.id, out);
  return out;
}

/** Width in pixels of the text at 100 px in the font, with `spacingPx` added after every character. */
export function measureViralTextWidth100(font: ViralFontDef, text: string, spacingPx: number): number {
  const ctx = ctx2d();
  if (!ctx) return 0;
  try {
    ctx.font = `${viralFontCssWeight(font)} 100px ${viralFontCssFamily(font)}`;
    return ctx.measureText(text).width + spacingPx * text.length;
  } catch {
    return 0;
  }
}
