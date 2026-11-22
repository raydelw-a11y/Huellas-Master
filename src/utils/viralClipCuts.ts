/**
 * Cuts of a viral clip, shared by the render (server.ts) and the Viral Clips preview so the page shows
 * exactly what gets exported.
 *
 * A clip is [optional hook teaser] + [main part]. No cut splits a word:
 *  - the teaser ends right after the last word that fits (max 7 s, or Gemini's hook end if earlier);
 *  - the main part starts before a word that was already being said and ends after the word in progress.
 */
export interface ViralCutWord {
  word: string;
  start: number;
  end: number;
}

export interface ViralClipCuts {
  useHookTeaser: boolean;
  teaserStartSec: number;
  teaserDurSec: number;
  mainStartSec: number;
  mainEndSec: number;
  mainDurSec: number;
  totalDurSec: number;
}

const TEASER_MAX_SEC = 7;
const WORD_TAIL_SEC = 0.12; // air left after the last word before a cut
const WORD_LEAD_SEC = 0.06; // air left before the first word after a cut

export function computeViralClipCuts(p: {
  startSec: number;
  endSec: number;
  structureMode?: string;
  hookTeaserStartSec?: number;
  hookTeaserEndSec?: number;
  words?: ViralCutWord[];
}): ViralClipCuts {
  const words = (Array.isArray(p.words) ? p.words : [])
    .filter((w) => Number.isFinite(Number(w?.start)) && Number.isFinite(Number(w?.end)))
    .slice()
    .sort((a, b) => a.start - b.start);
  let mainStart = Number(p.startSec) || 0;
  let mainEnd = Math.max(mainStart + 3, Number(p.endSec) || mainStart + 3);

  // Main start: never in the middle of a word
  const straddleStart = words.find((w) => w.start < mainStart && w.end > mainStart + 0.03);
  if (straddleStart) mainStart = Math.max(0, straddleStart.start - WORD_LEAD_SEC);
  // Main end: let the word in progress finish (and stop before the next one)
  const straddleEnd = words.find((w) => w.start < mainEnd - 0.03 && w.end > mainEnd);
  if (straddleEnd) {
    const next = words.find((w) => w.start >= straddleEnd.end);
    mainEnd = straddleEnd.end + WORD_TAIL_SEC;
    if (next) mainEnd = Math.min(mainEnd, Math.max(straddleEnd.end + 0.02, next.start - 0.02));
  }

  const hs = Number(p.hookTeaserStartSec);
  const he = Number(p.hookTeaserEndSec);
  let useHookTeaser =
    p.structureMode === 'hook_teaser' &&
    Number.isFinite(hs) &&
    Number.isFinite(he) &&
    hs > mainStart + 1.5 &&
    he > hs + 1.5 &&
    he <= mainEnd + 0.01;
  let teaserStart = useHookTeaser ? hs : 0;
  let teaserDur = 0;
  if (useHookTeaser) {
    // Teaser start: before a word already in progress
    const straddleTeaser = words.find((w) => w.start < teaserStart && w.end > teaserStart + 0.03);
    if (straddleTeaser) teaserStart = Math.max(0, straddleTeaser.start - WORD_LEAD_SEC);
    const limit = Math.min(he, teaserStart + TEASER_MAX_SEC);
    // Teaser end: right after the last word that fits completely before the limit
    const inside = words.filter((w) => w.start >= teaserStart - 0.01 && w.end <= limit + 0.05);
    // Prefer ending on a full stop, then on a comma, as long as the teaser keeps at least 2.5 s
    const longEnough = (w: ViralCutWord) => w.end - teaserStart >= 2.5;
    const sentenceEnd = [...inside].reverse().find((w) => /[.?!…]["'»”)]*$/.test(w.word) && longEnough(w));
    const pauseEnd = [...inside].reverse().find((w) => /[,;:]["'»”)]*$/.test(w.word) && longEnough(w));
    const last = sentenceEnd || pauseEnd || inside[inside.length - 1];
    let teaserEnd = limit;
    if (last) {
      teaserEnd = last.end + WORD_TAIL_SEC;
      const next = words.find((w) => w.start >= last.end);
      if (next) teaserEnd = Math.min(teaserEnd, Math.max(last.end + 0.02, next.start - 0.02));
    } else {
      // no word fits: stop before the first word that would be cut
      const cutWord = words.find((w) => w.start < limit && w.end > limit);
      if (cutWord) teaserEnd = cutWord.start - 0.02;
    }
    teaserDur = teaserEnd - teaserStart;
    if (teaserDur < 1.5) {
      useHookTeaser = false;
      teaserStart = 0;
      teaserDur = 0;
    }
  }
  const mainDur = Math.max(3, mainEnd - mainStart);
  return {
    useHookTeaser,
    teaserStartSec: Number(teaserStart.toFixed(3)),
    teaserDurSec: Number(teaserDur.toFixed(3)),
    mainStartSec: Number(mainStart.toFixed(3)),
    mainEndSec: Number((mainStart + mainDur).toFixed(3)),
    mainDurSec: Number(mainDur.toFixed(3)),
    totalDurSec: Number((teaserDur + mainDur).toFixed(3)),
  };
}

/** Words on the exported clip's own timeline (0 = first frame): teaser words first, then the main part. */
export function buildViralLocalWords(cuts: ViralClipCuts, words: ViralCutWord[]): ViralCutWord[] {
  const out: ViralCutWord[] = [];
  if (cuts.useHookTeaser) {
    const tEnd = cuts.teaserStartSec + cuts.teaserDurSec;
    for (const w of words) {
      if (w.end > cuts.teaserStartSec && w.start < tEnd - 0.05) {
        out.push({
          word: w.word,
          start: Math.max(0, w.start - cuts.teaserStartSec),
          end: Math.min(cuts.teaserDurSec, w.end - cuts.teaserStartSec),
        });
      }
    }
  }
  for (const w of words) {
    if (w.end > cuts.mainStartSec && w.start < cuts.mainEndSec) {
      out.push({
        word: w.word,
        start: cuts.teaserDurSec + Math.max(0, w.start - cuts.mainStartSec),
        end: cuts.teaserDurSec + Math.min(cuts.mainDurSec, w.end - cuts.mainStartSec),
      });
    }
  }
  return out;
}

/** Position on the exported clip's timeline for a source-video time and the part being played. */
export function viralSourceToClipTime(cuts: ViralClipCuts, sourceSec: number, inTeaser: boolean): number {
  if (inTeaser && cuts.useHookTeaser) return Math.max(0, Math.min(cuts.teaserDurSec, sourceSec - cuts.teaserStartSec));
  return cuts.teaserDurSec + Math.max(0, Math.min(cuts.mainDurSec, sourceSec - cuts.mainStartSec));
}
