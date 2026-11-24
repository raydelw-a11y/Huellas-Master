// Viral Clips — on-screen title ("poster" style) shared by the page's preview and the Mac's render, so
// both split the title into the same lines and show each piece at the same moments and sizes.

export const VIRAL_TITLE_LOOK = {
  /** Widest line of the big title, as a fraction of the frame width */
  bigTextWFrac: 0.84,
  /** Largest ASS font size of the big title, as a fraction of the frame height */
  bigFontHFrac: 0.14,
  /** The title that stays on screen after the first seconds: one line as wide as the big title
   *  (two lines for a very long title), never taller than this share of the big title's letters */
  smallTextWFrac: 0.84,
  smallFontScale: 0.6,
  /** "VIDEO COMPLETO EN YOUTUBE": one wide line */
  noticeTextWFrac: 0.78,
  noticeFontHFrac: 0.075,
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
  /** A "|" inside a line: what comes before it is bone white, what comes after is gold */
  noticeLines: ['VIDEO COMPLETO|EN YOUTUBE'],
  fontFamily: 'League Gothic',
} as const;

/** Title in capitals, split into balanced lines: 1 line for a couple of words, up to 4 for a long title. */
export function splitViralTitleLines(rawText: string): string[] {
  const clean = String(rawText || '')
    .replace(/[{}\\|]/g, '')
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

/**
 * Lines of the small title that stays on screen: the whole title on ONE line, as wide as the big title, with
 * the big title's last line still in gold (the "|" marks where the gold starts). A very long title would be
 * unreadable on one line, so it goes on two.
 */
export function buildViralSmallTitleLines(bigLines: string[]): string[] {
  const lines = bigLines.map((l) => String(l || '').trim()).filter(Boolean);
  if (lines.length <= 1) return lines;
  const whitePart = lines.slice(0, -1).join(' ');
  const goldPart = lines[lines.length - 1];
  if (whitePart.length + 1 + goldPart.length <= 52) return [`${whitePart}|${goldPart}`];
  const words = lines.join(' ').split(' ');
  let best = Math.ceil(words.length / 2);
  let bestDiff = Infinity;
  for (let i = 1; i < words.length; i++) {
    const diff = Math.abs(words.slice(0, i).join(' ').length - words.slice(i).join(' ').length);
    if (diff < bestDiff) {
      bestDiff = diff;
      best = i;
    }
  }
  return [words.slice(0, best).join(' '), words.slice(best).join(' ')];
}

export interface ViralTitleSpan {
  startSec: number;
  endSec: number;
}

/**
 * When each piece is on screen: the big title for the first 8 seconds, then every word shrinks and glides to
 * the small line that stays until the end (`morph`), and the YouTube notice for 5 seconds right after the
 * title has shrunk and again for the last 5 seconds (a short clip, where the two would run together,
 * keeps only the first one).
 */
export function computeViralTitleTimeline(
  totalDurSec: number,
  opts: { hasTitle: boolean; showNotice: boolean }
): {
  big: ViralTitleSpan | null;
  small: ViralTitleSpan | null;
  /** Big → small: each word starts `staggerSec` after the previous one and takes `durSec` */
  morph: { startSec: number; durSec: number; staggerSec: number } | null;
  notices: ViralTitleSpan[];
} {
  const total = Math.max(0, Number(totalDurSec) || 0);
  const bigEnd = opts.hasTitle ? Math.min(total, 8) : 0;
  const big = opts.hasTitle && total > 0 ? { startSec: 0, endSec: bigEnd } : null;
  const small = opts.hasTitle && total > bigEnd + 1 ? { startSec: bigEnd - 0.05, endSec: total } : null;
  const morph = small ? { startSec: bigEnd - 0.4, durSec: 0.6, staggerSec: 0.04 } : null;
  const notices: ViralTitleSpan[] = [];
  if (opts.showNotice) {
    const NOTICE_SEC = 5;
    // The first one comes in just as the title settles into its small line (with no title, mid-clip)
    const firstStart = morph ? morph.startSec + morph.durSec + 0.4 : Math.max(0, total / 2 - NOTICE_SEC / 2);
    const firstEnd = Math.min(total, firstStart + NOTICE_SEC);
    const hasFirst = firstEnd - firstStart >= 3;
    if (hasFirst) notices.push({ startSec: firstStart, endSec: firstEnd });
    // The closing one only when it leaves air after the first; a short clip keeps just the first
    const endStart = total - NOTICE_SEC;
    if (hasFirst ? endStart >= firstEnd + 2 : endStart >= bigEnd + 1) {
      notices.push({ startSec: endStart, endSec: total });
    }
  }
  return { big, small, morph, notices };
}
