// Viral Clips — on-screen title ("poster" style) shared by the page's preview and the Mac's render, so
// both split the title into the same lines and show each piece at the same moments and sizes.

export const VIRAL_TITLE_LOOK = {
  /** Widest line of the big title, as a fraction of the frame width */
  bigTextWFrac: 0.84,
  /** Largest ASS font size of the big title, as a fraction of the frame height */
  bigFontHFrac: 0.14,
  /** The title that stays on screen after the first seconds, relative to the big one */
  smallScale: 0.42,
  noticeTextWFrac: 0.5,
  noticeFontHFrac: 0.05,
  /** Gap between the small title and the YouTube notice, fraction of the frame height */
  noticeGapHFrac: 0.022,
  /** Distance between lines, in ASS font sizes (tight, like a film poster) */
  lineStep: 0.76,
  /** Letter spacing and the "a little bolder" outline, in ASS font sizes */
  spacing: 0.012,
  inkBord: 0.009,
  /** League Gothic: ASS font size (full line height) ÷ CSS em size */
  assHeightRatio: 1.3015,
  boneWhite: '#EFE7D6',
  gold: '#E3AA3C',
  noticeLines: ['VIDEO COMPLETO', 'EN YOUTUBE'],
  fontFamily: 'League Gothic',
} as const;

/** Title in capitals, split into balanced lines: 1 line for a couple of words, up to 4 for a long title. */
export function splitViralTitleLines(rawText: string): string[] {
  const clean = String(rawText || '')
    .replace(/[{}\\]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .toUpperCase()
    .slice(0, 90);
  if (!clean) return [];
  const words = clean.split(' ');
  const wanted = clean.length <= 9 || words.length === 1 ? 1 : clean.length <= 44 ? 2 : clean.length <= 72 ? 3 : 4;
  const lineCount = Math.min(wanted, words.length);
  if (lineCount <= 1) return [clean];
  // Choose the break points that keep the longest line as short as possible (titles are short: try them all)
  let best: string[] = [clean];
  let bestScore = Infinity;
  const walk = (startIdx: number, linesLeft: number, acc: string[]) => {
    if (linesLeft === 1) {
      const lines = [...acc, words.slice(startIdx).join(' ')];
      const lens = lines.map((l) => l.length);
      const score = Math.max(...lens) * 100 + (Math.max(...lens) - Math.min(...lens));
      if (score < bestScore) {
        bestScore = score;
        best = lines;
      }
      return;
    }
    for (let end = startIdx + 1; end <= words.length - (linesLeft - 1); end++) {
      walk(end, linesLeft - 1, [...acc, words.slice(startIdx, end).join(' ')]);
    }
  };
  walk(0, lineCount, []);
  return best;
}

export interface ViralTitleSpan {
  startSec: number;
  endSec: number;
}

/**
 * When each piece is on screen: the big title for the first 8 seconds, the small one from then to the end,
 * and the YouTube notice for up to 8 seconds around the middle (only when the clip has room for it).
 */
export function computeViralTitleTimeline(
  totalDurSec: number,
  opts: { hasTitle: boolean; showNotice: boolean }
): { big: ViralTitleSpan | null; small: ViralTitleSpan | null; notice: ViralTitleSpan | null } {
  const total = Math.max(0, Number(totalDurSec) || 0);
  const bigEnd = opts.hasTitle ? Math.min(total, 8) : 0;
  const big = opts.hasTitle && total > 0 ? { startSec: 0, endSec: bigEnd } : null;
  // Starts as the big one finishes fading out, so the two are never on screen together
  const small = opts.hasTitle && total > bigEnd + 1 ? { startSec: bigEnd - 0.05, endSec: total } : null;
  let notice: ViralTitleSpan | null = null;
  if (opts.showNotice && total >= 16) {
    const dur = Math.min(8, total - bigEnd - 2);
    if (dur >= 4) {
      const start = Math.max(bigEnd + 1, total / 2 - dur / 2);
      notice = { startSec: start, endSec: start + dur };
    }
  }
  return { big, small, notice };
}
