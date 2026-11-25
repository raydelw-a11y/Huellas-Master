/**
 * Shared audio mix model: the editor preview (media elements + Web Audio) and the FFmpeg export import the same
 * constants and maths from here, so what is heard in the editor is what the exported MP4 carries.
 *
 * Volumes are STORED as a linear amplitude percentage (100 = 0 dB, 20 = -14 dB), exactly as saved documentaries
 * always did, and are SHOWN and edited in dB.
 *
 * Clip audio (foley) is first levelled per clip: generated clips arrive anywhere between -20 and -60 LUFS, so a
 * plain percentage of the original left most of them inaudible. Every clip is brought to FOLEY_REFERENCE_LUFS
 * (0 dB on its slider) and then the track / clip level is applied on top.
 */

// ---------------------------------------------------------------------------------------------------------------
// dB <-> stored percentage
// ---------------------------------------------------------------------------------------------------------------

/** Bottom of every volume slider: at or below this the track is silent (stored as 0%). */
export const VOLUME_DB_FLOOR = -40;
/** Top of every volume slider: the levelled source at full level (stored as 100%). */
export const VOLUME_DB_CEIL = 0;
export const VOLUME_DB_STEP = 0.5;

export function dbToLinear(db: number): number {
  return Math.pow(10, db / 20);
}

export function linearToDb(linear: number): number {
  return linear > 0 ? 20 * Math.log10(linear) : -Infinity;
}

/** Stored percentage (0-100) -> dB. 0% is -Infinity. */
export function volumePctToDb(pct: number): number {
  const p = Number(pct);
  return Number.isFinite(p) && p > 0 ? 20 * Math.log10(p / 100) : -Infinity;
}

/** dB -> stored percentage (0-100, three decimals). At or below the slider floor it is silence (0%). */
export function volumeDbToPct(db: number): number {
  const d = Number(db);
  if (!Number.isFinite(d) || d <= VOLUME_DB_FLOOR) return 0;
  return Number((100 * dbToLinear(Math.min(VOLUME_DB_CEIL, d))).toFixed(3));
}

/** Position of a stored percentage on a dB slider (the floor stands for silence). */
export function volumePctToSliderDb(pct: number): number {
  const db = volumePctToDb(pct);
  if (!Number.isFinite(db)) return VOLUME_DB_FLOOR;
  return Math.max(VOLUME_DB_FLOOR, Math.min(VOLUME_DB_CEIL, Number(db.toFixed(1))));
}

/** "-14.0 dB", "0.0 dB", "-∞ dB" (silence). */
export function formatVolumeDb(pct: number): string {
  const db = volumePctToDb(pct);
  if (!Number.isFinite(db) || db <= VOLUME_DB_FLOOR - 20) return '-∞ dB';
  const rounded = Math.abs(db) < 0.05 ? 0 : Number(db.toFixed(1));
  return `${rounded > 0 ? '+' : ''}${rounded.toFixed(1)} dB`;
}

/** A plain gain in dB with its sign: "+5.0 dB", "-3.5 dB". */
export function formatGainDb(db: number): string {
  const d = Number(db);
  if (!Number.isFinite(d)) return '-∞ dB';
  const rounded = Math.abs(d) < 0.05 ? 0 : Number(d.toFixed(1));
  return `${rounded > 0 ? '+' : ''}${rounded.toFixed(1)} dB`;
}

// ---------------------------------------------------------------------------------------------------------------
// Default levels (stored percentages)
// ---------------------------------------------------------------------------------------------------------------

/** Music under the narration: -10 dB. */
export const DEFAULT_MUSIC_VOLUME_PCT = 31.623;
/** Earlier music defaults: a song still carrying one of them was never set by hand. */
export const LEGACY_MUSIC_DEFAULT_PCTS: readonly number[] = [10, 20, 24];
/** Clip audio while the narrator speaks: -14 dB. */
export const DEFAULT_FOLEY_DUCKED_PCT = 20;
/** Clip audio without narration (Clip 1 and pauses): -1.9 dB. */
export const DEFAULT_FOLEY_HIGH_PCT = 80;

/**
 * Value a timeline clip carries in `foleyVolume` when nobody set its volume by hand. It only marks "automatic":
 * the level actually used then comes from the two foley sliders.
 */
export function defaultClipFoleyPct(clip: { clipNumber?: number; id?: string }): number {
  const n = Number(clip?.clipNumber);
  if (n === 0 || n === 999 || clip?.id === 'fixed-doc-intro' || clip?.id === 'fixed-doc-outro') return 100;
  return n === 1 ? 80 : 20;
}

// ---------------------------------------------------------------------------------------------------------------
// Per-clip foley levelling
// ---------------------------------------------------------------------------------------------------------------

export interface ClipLoudness {
  /** Integrated loudness of the clip's audio (EBU R128), in LUFS. -70 or lower = silence. */
  lufs: number;
  /** Sample peak in dBFS. */
  peakDb: number;
}

/** Loudness every clip is brought to before its level is applied (0 dB on the foley sliders). */
export const FOLEY_REFERENCE_LUFS = -22;
/** Quiet clips are raised at most this much (more would only lift the noise floor). */
export const FOLEY_NORM_MAX_GAIN_DB = 26;
export const FOLEY_NORM_MIN_GAIN_DB = -12;
/** After levelling, a clip's peak may reach this (dBFS); the limiter takes the excess down to the ceiling. */
export const FOLEY_NORM_PEAK_ALLOWANCE_DB = 6;
/** Peak ceiling of a levelled clip, before its level is applied. */
export const FOLEY_LIMITER_CEILING_DB = -2;

/** Gain (dB) that levels a clip. 0 when the clip was not measured. */
export function computeFoleyNormGainDb(loud?: Partial<ClipLoudness> | null): number {
  if (!loud) return 0;
  const lufs = Number(loud.lufs);
  if (!Number.isFinite(lufs)) return 0;
  let gain = FOLEY_REFERENCE_LUFS - Math.max(-70, lufs);
  const peak = Number(loud.peakDb);
  if (gain > 0 && Number.isFinite(peak)) {
    // A clip made of a few loud hits over near silence: do not push the hits far past the limiter
    gain = Math.min(gain, Math.max(0, FOLEY_NORM_PEAK_ALLOWANCE_DB - peak));
  }
  gain = Math.max(FOLEY_NORM_MIN_GAIN_DB, Math.min(FOLEY_NORM_MAX_GAIN_DB, gain));
  return Number(gain.toFixed(2));
}

// ---------------------------------------------------------------------------------------------------------------
// Web Audio DynamicsCompressorNode make-up gain
// ---------------------------------------------------------------------------------------------------------------

/**
 * A DynamicsCompressorNode always adds its own make-up gain, derived from threshold / knee / ratio (Web Audio
 * spec; same code in Chromium, WebKit and Gecko). The preview compensates it and the export reproduces it, so
 * both carry the same level.
 */
export function webAudioCompressorMakeupDb(thresholdDb: number, kneeDb: number, ratio: number): number {
  const lin = (db: number) => Math.pow(10, db / 20);
  const toDb = (x: number) => (x > 0 ? 20 * Math.log10(x) : -1000);
  const linearThreshold = lin(thresholdDb);
  const kneeThresholdDb = thresholdDb + kneeDb;
  const kneeThreshold = lin(kneeThresholdDb);
  const kneeCurve = (x: number, k: number) =>
    x < linearThreshold ? x : linearThreshold + (1 - Math.exp(-k * (x - linearThreshold))) / k;
  const slopeAt = (x: number, k: number) => {
    if (x < linearThreshold) return 1;
    const x2 = x * 1.001;
    return (toDb(kneeCurve(x2, k)) - toDb(kneeCurve(x, k))) / (toDb(x2) - toDb(x));
  };
  const desiredSlope = 1 / Math.max(1, ratio);
  let minK = 0.1;
  let maxK = 10000;
  let k = 5;
  for (let i = 0; i < 15; i++) {
    if (slopeAt(kneeThreshold, k) < desiredSlope) maxK = k;
    else minK = k;
    k = Math.sqrt(minK * maxK);
  }
  const yKneeThresholdDb = toDb(kneeCurve(kneeThreshold, k));
  const fullRange =
    1 < kneeThreshold ? kneeCurve(1, k) : lin(yKneeThresholdDb + desiredSlope * (0 - kneeThresholdDb));
  return Number((0.6 * -toDb(fullRange)).toFixed(3));
}

/** Narration limiter of the preview (soft knee). The export adds the same make-up to the voice gain. */
export const VOICE_PREVIEW_LIMITER = { thresholdDb: -1.5, kneeDb: 6, ratio: 12, attackSec: 0.003, releaseSec: 0.15 };
export const VOICE_PREVIEW_MAKEUP_DB = webAudioCompressorMakeupDb(
  VOICE_PREVIEW_LIMITER.thresholdDb,
  VOICE_PREVIEW_LIMITER.kneeDb,
  VOICE_PREVIEW_LIMITER.ratio
);

/** Clip-audio limiter of the preview (hard knee at the ceiling); its make-up is taken back out after it. */
export const FOLEY_PREVIEW_LIMITER = {
  thresholdDb: FOLEY_LIMITER_CEILING_DB,
  kneeDb: 0,
  ratio: 20,
  attackSec: 0.003,
  releaseSec: 0.1,
};
export const FOLEY_PREVIEW_MAKEUP_DB = webAudioCompressorMakeupDb(
  FOLEY_PREVIEW_LIMITER.thresholdDb,
  FOLEY_PREVIEW_LIMITER.kneeDb,
  FOLEY_PREVIEW_LIMITER.ratio
);

// ---------------------------------------------------------------------------------------------------------------
// Clip audio level over time (auto-ducking)
// ---------------------------------------------------------------------------------------------------------------

export interface FoleyLevelClip {
  id?: string;
  clipNumber?: number;
  start: number;
  end: number;
  foleyVolume?: number;
  customVolumeSet?: boolean;
  audioMuted?: boolean;
  narrationSegment?: string;
}

export interface FoleyLevelSettings {
  autoDuckingEnabled: boolean;
  foleyHighPct: number;
  foleyDuckedPct: number;
  /** Timeline second the narration enters. */
  voiceStartSec: number;
  /** Caption cues on the timeline (a clip without narration text is ducked only while one is on screen). */
  captions?: ReadonlyArray<{ start: number; end: number; text?: string }>;
}

export function isBrandClip(clip: { id?: string; clipNumber?: number }): boolean {
  const n = Number(clip?.clipNumber);
  return n === 0 || n === 999 || clip?.id === 'fixed-doc-intro' || clip?.id === 'fixed-doc-outro';
}

/** true when this clip's own `foleyVolume` rules (set by hand), false when the two foley sliders do. */
export function isClipFoleyVolumeExplicit(clip: FoleyLevelClip): boolean {
  if (clip.customVolumeSet) return true;
  return typeof clip.foleyVolume === 'number' && clip.foleyVolume !== defaultClipFoleyPct(clip);
}

/** Whether the narrator counts as speaking at timeline second `t` over this clip. */
export function isNarratorSpeakingOverClip(clip: FoleyLevelClip, t: number, s: FoleyLevelSettings): boolean {
  if (t < s.voiceStartSec) return false;
  if ((Number(clip.clipNumber) <= 1 || isBrandClip(clip)) && s.voiceStartSec > 0) return false;
  if (String(clip.narrationSegment || '').trim()) return true;
  const caps = s.captions || [];
  for (let i = 0; i < caps.length; i++) {
    const cap = caps[i];
    if (t >= cap.start && t <= cap.end && String(cap.text || '').trim()) return true;
  }
  return false;
}

/**
 * Level of a clip's audio (stored percentage, before its fades) at timeline second `t`.
 * Single source of truth for the preview and for the export request.
 */
export function resolveClipFoleyLevelPct(clip: FoleyLevelClip, t: number, s: FoleyLevelSettings): number {
  if (clip.audioMuted) return 0;
  const own = typeof clip.foleyVolume === 'number' ? clip.foleyVolume : undefined;
  let pct: number;
  if (isBrandClip(clip)) {
    pct = own ?? 100;
  } else if (!s.autoDuckingEnabled || isClipFoleyVolumeExplicit(clip)) {
    pct = own ?? defaultClipFoleyPct(clip);
  } else {
    pct = isNarratorSpeakingOverClip(clip, t, s) ? s.foleyDuckedPct : s.foleyHighPct;
  }
  return Math.max(0, Math.min(100, Number(pct) || 0));
}

export interface FoleyLevelSegment {
  /** Seconds from the start of the clip on the timeline. */
  startSec: number;
  /** Linear gain 0-1 (stored percentage / 100). */
  volume: number;
}

/**
 * The clip's level as constant stretches over its own duration (seconds from the clip start), for the export.
 * One stretch for almost every clip; several only where the level changes while the clip is on screen.
 */
export function buildClipFoleyLevelSegments(clip: FoleyLevelClip, s: FoleyLevelSettings): FoleyLevelSegment[] {
  const dur = Math.max(0, clip.end - clip.start);
  const cuts = new Set<number>([0]);
  const addCut = (timelineSec: number) => {
    const local = timelineSec - clip.start;
    if (local > 0.05 && local < dur - 0.05) cuts.add(Number(local.toFixed(3)));
  };
  // The level only moves while the clip is on screen when the two foley sliders rule it
  const followsSliders =
    !clip.audioMuted && !isBrandClip(clip) && s.autoDuckingEnabled && !isClipFoleyVolumeExplicit(clip);
  if (followsSliders) {
    addCut(s.voiceStartSec);
    if (!String(clip.narrationSegment || '').trim()) {
      for (const cap of s.captions || []) {
        if (cap.end <= clip.start || cap.start >= clip.end) continue;
        addCut(cap.start);
        addCut(cap.end);
      }
    }
  }
  const sorted = Array.from(cuts).sort((a, b) => a - b);
  const out: FoleyLevelSegment[] = [];
  for (let i = 0; i < sorted.length; i++) {
    const from = sorted[i];
    const to = i + 1 < sorted.length ? sorted[i + 1] : dur;
    const mid = clip.start + (from + to) / 2;
    const volume = Number((resolveClipFoleyLevelPct(clip, mid, s) / 100).toFixed(4));
    if (out.length > 0 && Math.abs(out[out.length - 1].volume - volume) < 0.0005) continue;
    out.push({ startSec: from, volume });
  }
  return out.length > 0 ? out : [{ startSec: 0, volume: 0 }];
}
