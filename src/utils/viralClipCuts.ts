/**
 * Cuts of a viral clip, shared by the render (server.ts) and the Viral Clips preview so the page shows
 * exactly what gets exported.
 *
 * A clip is one or more pieces ("segments") of the documentary, in chronological order: the parts in between
 * are skipped. No hook teaser. No cut splits a word:
 *  - a piece starts before a word that was already being said;
 *  - a piece ends after the word in progress (and before the next word starts).
 * The clip's own startSec/endSec bound every piece, so trimming the clip start/end trims the first/last piece.
 */
export interface ViralCutWord {
  word: string;
  start: number;
  end: number;
}

export interface ViralClipSegment {
  startSec: number;
  endSec: number;
}

export interface ViralClipPart {
  /** Piece of the source video */
  srcStart: number;
  srcEnd: number;
  dur: number;
  /** Where the piece starts on the exported clip's timeline */
  clipStart: number;
}

export interface ViralClipCuts {
  parts: ViralClipPart[];
  totalDurSec: number;
}

const WORD_TAIL_SEC = 0.12; // air left after the last word before a cut
const WORD_LEAD_SEC = 0.06; // air left before the first word after a cut
const MIN_PIECE_SEC = 1;
const MERGE_GAP_SEC = 0.35; // pieces closer than this are played as one (no point in a cut)

/** Reads Gemini's / the saved list's pieces ([{startSec,endSec}] or [[start,end]]), in order, inside the clip range. */
export function normalizeViralSegments(clip: {
  startSec: number;
  endSec: number;
  segments?: unknown;
}): ViralClipSegment[] {
  const lo = Number(clip.startSec) || 0;
  const hi = Math.max(lo + MIN_PIECE_SEC, Number(clip.endSec) || lo + MIN_PIECE_SEC);
  const raw = Array.isArray(clip.segments) ? clip.segments : [];
  const parsed: ViralClipSegment[] = [];
  for (const r of raw as any[]) {
    const s = Array.isArray(r) ? Number(r[0]) : Number(r?.startSec ?? r?.start);
    const e = Array.isArray(r) ? Number(r[1]) : Number(r?.endSec ?? r?.end);
    if (!Number.isFinite(s) || !Number.isFinite(e)) continue;
    const cs = Math.max(lo, s);
    const ce = Math.min(hi, e);
    if (ce - cs >= MIN_PIECE_SEC) parsed.push({ startSec: cs, endSec: ce });
  }
  parsed.sort((a, b) => a.startSec - b.startSec);
  const merged: ViralClipSegment[] = [];
  for (const p of parsed) {
    const last = merged[merged.length - 1];
    if (last && p.startSec <= last.endSec + MERGE_GAP_SEC) last.endSec = Math.max(last.endSec, p.endSec);
    else merged.push({ ...p });
  }
  return merged.length > 0 ? merged : [{ startSec: lo, endSec: hi }];
}

export function computeViralClipCuts(p: {
  startSec: number;
  endSec: number;
  segments?: unknown;
  words?: ViralCutWord[];
}): ViralClipCuts {
  const words = (Array.isArray(p.words) ? p.words : [])
    .filter((w) => Number.isFinite(Number(w?.start)) && Number.isFinite(Number(w?.end)))
    .slice()
    .sort((a, b) => a.start - b.start);
  const pieces = normalizeViralSegments(p).map((seg) => {
    let s = seg.startSec;
    let e = seg.endSec;
    // Start: never in the middle of a word. Aligned words can overlap a few ms, so keep moving back while
    // the start still falls inside one; then a small lead, never reaching into the previous word.
    let moved = false;
    for (let guard = 0; guard < 8; guard++) {
      const inside = words.find((w) => w.start < s - 0.001 && w.end > s + 0.01);
      if (!inside) break;
      s = inside.start;
      moved = true;
    }
    if (moved) {
      const prevEnd = words.reduce((acc, w) => (w.end <= s + 0.001 && w.end > acc ? w.end : acc), -Infinity);
      s = Math.max(s - WORD_LEAD_SEC, Math.min(prevEnd + 0.01, s));
    }
    s = Math.max(0, s);
    // End: let the word in progress finish (same chain rule), then a small tail before the next word
    let extended = false;
    for (let guard = 0; guard < 8; guard++) {
      const inside = words.find((w) => w.start < e - 0.01 && w.end > e + 0.001);
      if (!inside) break;
      e = inside.end;
      extended = true;
    }
    if (extended) {
      const nextStart = words.reduce((acc, w) => (w.start >= e - 0.001 && w.start < acc ? w.start : acc), Infinity);
      e = Math.min(e + WORD_TAIL_SEC, Math.max(nextStart - 0.02, e));
    }
    return { s, e };
  });
  // Snapping can make neighbouring pieces touch: play them as one
  const joined: Array<{ s: number; e: number }> = [];
  for (const pc of pieces) {
    const last = joined[joined.length - 1];
    if (last && pc.s <= last.e + MERGE_GAP_SEC) last.e = Math.max(last.e, pc.e);
    else joined.push({ ...pc });
  }
  const parts: ViralClipPart[] = [];
  let cursor = 0;
  for (const pc of joined) {
    const dur = Math.max(MIN_PIECE_SEC, pc.e - pc.s);
    parts.push({
      srcStart: Number(pc.s.toFixed(3)),
      srcEnd: Number((pc.s + dur).toFixed(3)),
      dur: Number(dur.toFixed(3)),
      clipStart: Number(cursor.toFixed(3)),
    });
    cursor += dur;
  }
  return { parts, totalDurSec: Number(cursor.toFixed(3)) };
}

/** Where each cut falls on the exported clip (a caption line never spans a cut). */
export function viralCutTimes(cuts: ViralClipCuts): number[] {
  return cuts.parts.slice(1).map((p) => p.clipStart);
}

/** Words on the exported clip's own timeline (0 = first frame), piece after piece. */
export function buildViralLocalWords(cuts: ViralClipCuts, words: ViralCutWord[]): ViralCutWord[] {
  const out: ViralCutWord[] = [];
  for (const part of cuts.parts) {
    for (const w of words) {
      // only words said inside this piece (its cuts never split a word)
      if (w.end > part.srcStart + 0.02 && w.start < part.srcEnd - 0.05) {
        out.push({
          word: w.word,
          start: part.clipStart + Math.max(0, w.start - part.srcStart),
          end: part.clipStart + Math.min(part.dur, w.end - part.srcStart),
        });
      }
    }
  }
  return out;
}

/** Position on the exported clip's timeline for a source-video time inside piece `partIndex`. */
export function viralSourceToClipTime(cuts: ViralClipCuts, sourceSec: number, partIndex: number): number {
  const part = cuts.parts[Math.max(0, Math.min(cuts.parts.length - 1, partIndex))];
  if (!part) return 0;
  return part.clipStart + Math.max(0, Math.min(part.dur, sourceSec - part.srcStart));
}

/** Source-video time (and its piece) for a point of the exported clip. */
export function viralClipTimeToSource(
  cuts: ViralClipCuts,
  clipSec: number
): { partIndex: number; sourceSec: number } {
  const t = Math.max(0, Math.min(cuts.totalDurSec, clipSec));
  let idx = 0;
  for (let i = 0; i < cuts.parts.length; i++) {
    if (cuts.parts[i].clipStart <= t + 1e-6) idx = i;
  }
  const part = cuts.parts[idx];
  if (!part) return { partIndex: 0, sourceSec: 0 };
  return { partIndex: idx, sourceSec: part.srcStart + Math.min(part.dur, t - part.clipStart) };
}

/** Total length of a clip made of these pieces (before snapping to words), for lists and labels. */
export function viralSegmentsDurationSec(segments: ViralClipSegment[]): number {
  return segments.reduce((acc, s) => acc + Math.max(0, s.endSec - s.startSec), 0);
}

/**
 * The clean 9:16 master is the 9:16 export, which leaves out the intro/outro ranges of the timeline
 * (skipRanges916). Viral clips keep their times on the documentary's timeline (the 16:9 one, with intro), so a
 * timeline second is moved back by every skipped range before it (a second inside a skipped range lands where
 * that range was cut).
 */
export function timelineToMasterTime(t: number, skipRanges: Array<{ start: number; end: number }> = []): number {
  let shift = 0;
  for (const r of [...skipRanges].sort((a, b) => a.start - b.start)) {
    if (!(r.end > r.start)) continue;
    if (t >= r.end) shift += r.end - r.start;
    else if (t > r.start) return Math.max(0, r.start - shift);
  }
  return Math.max(0, t - shift);
}

/** Inverse of timelineToMasterTime (a master second back on the documentary's timeline). */
export function masterToTimelineTime(m: number, skipRanges: Array<{ start: number; end: number }> = []): number {
  let t = m;
  for (const r of [...skipRanges].sort((a, b) => a.start - b.start)) {
    if (!(r.end > r.start)) continue;
    if (t >= r.start) t += r.end - r.start;
  }
  return t;
}
