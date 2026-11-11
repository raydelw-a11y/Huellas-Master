/**
 * Unified RIFF/WAVE + C2PA/JUMBF binary sanitizer and phase-preserving DSP edge polisher
 * for Gemini TTS (`gemini-3.8-flash-tts`, 24kHz 16-bit mono Little-Endian PCM).
 *
 * Works identically in Browser (`Uint8Array`) and Node (`Buffer`, which extends `Uint8Array`)
 * with zero Node-specific dependencies.
 */

export const DEFAULT_GEMINI_TTS_SAMPLE_RATE = 24000;
export const EDGE_HALF_HANN_FADE_MS = 12; // 288 samples @ 24kHz (C1-continuous raised cosine)
export const GLITCH_SOFT_RAMP_MS = 8; // 192 samples @ 24kHz
const WAV_STREAMING_SIZE_SENTINEL = 0xffffffff;

const KNOWN_RIFF_META_FOURCCS = new Set([
  'C2PA',
  'LIST',
  'JUNK',
  'PAD ',
  'id3 ',
  'ID3 ',
  'fact',
  'bext',
  'cue ',
  'plst',
  'smpl',
  'inst',
]);

function readAsciiFourCC(bytes: Uint8Array, offset: number): string {
  if (offset < 0 || offset + 4 > bytes.byteLength) return '';
  return String.fromCharCode(
    bytes[offset],
    bytes[offset + 1],
    bytes[offset + 2],
    bytes[offset + 3]
  );
}

function hasJumbOrC2paSignatureNear(bytes: Uint8Array, start: number, end: number): boolean {
  const safeEnd = Math.min(bytes.byteLength - 4, end);
  for (let i = Math.max(0, start); i <= safeEnd; i++) {
    const b0 = bytes[i];
    const b1 = bytes[i + 1];
    const b2 = bytes[i + 2];
    const b3 = bytes[i + 3];
    // 'jumb' (0x6a 0x75 0x6d 0x62) or 'jumd' (0x6a 0x75 0x6d 0x64)
    if (b0 === 0x6a && b1 === 0x75 && b2 === 0x6d && (b3 === 0x62 || b3 === 0x64)) {
      return true;
    }
    // 'c2pa' (0x63 0x32 0x70 0x61)
    if (b0 === 0x63 && b1 === 0x32 && b2 === 0x70 && b3 === 0x61) {
      return true;
    }
  }
  return false;
}

export function isC2paRiffChunkAt(
  bytes: Uint8Array,
  pos: number,
  limit: number = bytes.byteLength
): { valid: boolean; chunkSize: number; totalPaddedBytes: number } {
  const cappedLimit = Math.min(bytes.byteLength, limit);
  if (pos < 0 || pos + 16 > cappedLimit) {
    return { valid: false, chunkSize: 0, totalPaddedBytes: 0 };
  }
  if (
    bytes[pos] !== 0x43 || // 'C'
    bytes[pos + 1] !== 0x32 || // '2'
    bytes[pos + 2] !== 0x50 || // 'P'
    bytes[pos + 3] !== 0x41 // 'A'
  ) {
    return { valid: false, chunkSize: 0, totalPaddedBytes: 0 };
  }

  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const c2paSize = view.getUint32(pos + 4, true);
  // Note: allow up to 64 bytes tolerance if an old client fade truncated or padded, though exact RIFF fits <= cappedLimit
  if (c2paSize < 32 || pos + 8 + c2paSize > cappedLimit) {
    return { valid: false, chunkSize: 0, totalPaddedBytes: 0 };
  }
  if (!hasJumbOrC2paSignatureNear(bytes, pos + 8, pos + 80)) {
    return { valid: false, chunkSize: 0, totalPaddedBytes: 0 };
  }

  const padded = c2paSize + (c2paSize & 1);
  const totalPaddedBytes = Math.min(cappedLimit - pos, 8 + padded);
  return { valid: true, chunkSize: c2paSize, totalPaddedBytes };
}

function expandContiguousRiffMetadataBounds(
  bytes: Uint8Array,
  lowerBound: number,
  upperBound: number,
  rawStart: number,
  rawEnd: number
): { start: number; end: number } {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let start = rawStart;
  let end = rawEnd;

  // Backward exact-pointer check: if a known RIFF metadata subchunk immediately precedes `start`
  let improved = true;
  let guard = 0;
  while (improved && guard++ < 6) {
    improved = false;
    const scanFrom = Math.max(lowerBound, start - 8192);
    for (let cand = scanFrom; cand <= start - 8; cand++) {
      const fourcc = readAsciiFourCC(bytes, cand);
      if (!KNOWN_RIFF_META_FOURCCS.has(fourcc)) continue;
      const candSize = view.getUint32(cand + 4, true);
      const candPadded = candSize + (candSize & 1);
      if (cand + 8 + candPadded === start) {
        start = cand;
        improved = true;
        break;
      }
    }
  }

  // Forward exact-pointer check: if another known RIFF metadata subchunk immediately follows `end`
  guard = 0;
  while (end + 8 <= upperBound && guard++ < 8) {
    const fourcc = readAsciiFourCC(bytes, end);
    if (!KNOWN_RIFF_META_FOURCCS.has(fourcc)) break;
    const nextSize = view.getUint32(end + 4, true);
    const nextPadded = nextSize + (nextSize & 1);
    if (end + 8 + nextPadded > upperBound) break;
    end = end + 8 + nextPadded;
  }

  return { start, end };
}

/**
 * Strips any trailing C2PA RIFF subchunk or raw ISO BMFF JUMBF superbox from a single TTS segment slice.
 */
export function stripTrailingRawJumbOrC2pa(pcmSlice: Uint8Array): {
  cleanSlice: Uint8Array;
  strippedBytes: number;
  strippedCount: number;
} {
  const len = pcmSlice.byteLength;
  if (len < 32) {
    return { cleanSlice: pcmSlice, strippedBytes: 0, strippedCount: 0 };
  }

  const view = new DataView(pcmSlice.buffer, pcmSlice.byteOffset, pcmSlice.byteLength);
  let cutAt = len;
  let strippedCount = 0;

  for (let pos = 0; pos <= cutAt - 16; pos++) {
    // Pattern A: RIFF 'C2PA' chunk
    if (pcmSlice[pos] === 0x43 && pcmSlice[pos + 1] === 0x32 && pcmSlice[pos + 2] === 0x50 && pcmSlice[pos + 3] === 0x41) {
      const check = isC2paRiffChunkAt(pcmSlice, pos, cutAt);
      if (check.valid) {
        const expanded = expandContiguousRiffMetadataBounds(
          pcmSlice,
          0,
          cutAt,
          pos,
          pos + check.totalPaddedBytes
        );
        // If this metadata block reaches the end of the segment (within 8 pad bytes), truncate cleanly here
        if (expanded.end >= cutAt - 8) {
          cutAt = expanded.start;
          strippedCount += 1;
          break;
        }
        pos = expanded.end - 1;
        continue;
      }
    }

    // Pattern B: Raw ISO BMFF JUMBF box ([uint32BE boxLen]['jumb']...['jumd']) without RIFF wrapper
    if (
      pos >= 4 &&
      pcmSlice[pos] === 0x6a &&
      pcmSlice[pos + 1] === 0x75 &&
      pcmSlice[pos + 2] === 0x6d &&
      pcmSlice[pos + 3] === 0x62
    ) {
      const boxStart = pos - 4;
      const boxLenBE = view.getUint32(boxStart, false);
      if (
        boxLenBE >= 32 &&
        boxStart + boxLenBE <= cutAt &&
        boxStart + boxLenBE >= cutAt - 8 &&
        hasJumbOrC2paSignatureNear(pcmSlice, pos + 4, pos + 64)
      ) {
        cutAt = boxStart;
        strippedCount += 1;
        break;
      }
    }
  }

  if (cutAt === len) {
    return { cleanSlice: pcmSlice, strippedBytes: 0, strippedCount: 0 };
  }
  return {
    cleanSlice: pcmSlice.subarray(0, cutAt),
    strippedBytes: len - cutAt,
    strippedCount,
  };
}

function applyHalfHannFadeOutInPlace(
  view: DataView,
  startByteOffset: number,
  endByteOffset: number
): void {
  const byteSpan = endByteOffset - startByteOffset;
  const nSamples = Math.floor(byteSpan / 2);
  if (nSamples <= 1) return;
  for (let i = 0; i < nSamples; i++) {
    const sampleByte = startByteOffset + i * 2;
    const cur = view.getInt16(sampleByte, true);
    // C1 Half-Hann from 1.0 down to 0.0
    const gain = 0.5 * (1 + Math.cos((Math.PI * i) / (nSamples - 1)));
    view.setInt16(sampleByte, Math.round(cur * gain), true);
  }
}

function applyHalfHannFadeInInPlace(
  view: DataView,
  startByteOffset: number,
  endByteOffset: number
): void {
  const byteSpan = endByteOffset - startByteOffset;
  const nSamples = Math.floor(byteSpan / 2);
  if (nSamples <= 1) return;
  for (let i = 0; i < nSamples; i++) {
    const sampleByte = startByteOffset + i * 2;
    const cur = view.getInt16(sampleByte, true);
    // C1 Half-Hann from 0.0 up to 1.0
    const gain = 0.5 * (1 - Math.cos((Math.PI * i) / (nSamples - 1)));
    view.setInt16(sampleByte, Math.round(cur * gain), true);
  }
}

/**
 * Extracts pure, sample-aligned 16-bit Little-Endian PCM bytes from a Gemini TTS response
 * (whether wrapped in RIFF/WAVE with trailing C2PA/LIST/JUNK subchunks or raw PCM).
 */
export function extractCleanPcmFromGeminiAudio(
  rawBytes: Uint8Array,
  fallbackSampleRate: number = DEFAULT_GEMINI_TTS_SAMPLE_RATE
): {
  pcmBytes: Uint8Array;
  sampleRate: number;
  channels: number;
  bitsPerSample: number;
  strippedC2paBytes: number;
} {
  let current = rawBytes;
  let sampleRate = fallbackSampleRate;
  let channels = 1;
  let bitsPerSample = 16;
  let strippedC2paBytes = 0;

  let unwrapGuard = 0;
  while (
    unwrapGuard++ < 5 &&
    current.byteLength >= 12 &&
    readAsciiFourCC(current, 0) === 'RIFF' &&
    readAsciiFourCC(current, 8) === 'WAVE'
  ) {
    const view = new DataView(current.buffer, current.byteOffset, current.byteLength);
    let offset = 12;
    let foundData = false;

    while (offset <= current.byteLength - 8) {
      const chunkId = readAsciiFourCC(current, offset);
      const chunkSize = view.getUint32(offset + 4, true);

      if (chunkId === 'fmt ' && chunkSize >= 16 && offset + 8 + 16 <= current.byteLength) {
        const ch = view.getUint16(offset + 10, true);
        const sr = view.getUint32(offset + 12, true);
        const bps = view.getUint16(offset + 22, true);
        if (ch >= 1 && ch <= 8) channels = ch;
        if (sr >= 8000 && sr <= 192000) sampleRate = sr;
        if (bps === 8 || bps === 16 || bps === 24 || bps === 32) bitsPerSample = bps;
      } else if (chunkId === 'data') {
        const dataStart = offset + 8;
        const isStreamingSentinel =
          chunkSize === WAV_STREAMING_SIZE_SENTINEL || dataStart + chunkSize > current.byteLength;
        if (isStreamingSentinel) {
          const tailRes = stripTrailingRawJumbOrC2pa(current.subarray(dataStart));
          strippedC2paBytes += tailRes.strippedBytes;
          current = tailRes.cleanSlice;
        } else {
          const postDataBytes = current.byteLength - (dataStart + chunkSize);
          if (postDataBytes > 0) strippedC2paBytes += postDataBytes;
          current = current.subarray(dataStart, dataStart + chunkSize);
        }
        foundData = true;
        break;
      }

      // Advance cleanly across any valid pre-data subchunk (including 0-size JUNK/PAD chunks)
      const padded = chunkSize + (chunkSize & 1);
      const nextOffset = offset + 8 + padded;
      if (nextOffset <= offset || nextOffset > current.byteLength) {
        break;
      }
      offset = nextOffset;
    }

    if (!foundData) {
      // Defensive scan in the first 512 bytes for 'data' if a preceding chunk had malformed size
      let rescued = false;
      const maxHeaderScan = Math.min(current.byteLength - 8, 512);
      for (let p = 12; p <= maxHeaderScan; p++) {
        if (readAsciiFourCC(current, p) === 'data') {
          const dSize = view.getUint32(p + 4, true);
          const dStart = p + 8;
          if (dSize > 0 && dSize < WAV_STREAMING_SIZE_SENTINEL && dStart + dSize <= current.byteLength) {
            strippedC2paBytes += current.byteLength - (dStart + dSize);
            current = current.subarray(dStart, dStart + dSize);
          } else {
            const tailRes = stripTrailingRawJumbOrC2pa(current.subarray(dStart));
            strippedC2paBytes += tailRes.strippedBytes;
            current = tailRes.cleanSlice;
          }
          rescued = true;
          break;
        }
      }
      if (!rescued) {
        const fallbackSlice = current.byteLength > 44 ? current.subarray(44) : current;
        const tailRes = stripTrailingRawJumbOrC2pa(fallbackSlice);
        strippedC2paBytes += tailRes.strippedBytes;
        current = tailRes.cleanSlice;
      }
      break;
    }
  }

  // Always run defensive trailing C2PA/JUMBF check even for raw non-RIFF streams
  const finalTailCheck = stripTrailingRawJumbOrC2pa(current);
  if (finalTailCheck.strippedBytes > 0) {
    strippedC2paBytes += finalTailCheck.strippedBytes;
    current = finalTailCheck.cleanSlice;
  }

  const evenByteLen = current.byteLength & ~1;
  const out = new Uint8Array(evenByteLen);
  if (evenByteLen > 0) {
    out.set(current.subarray(0, evenByteLen));
  }

  return {
    pcmBytes: out,
    sampleRate,
    channels,
    bitsPerSample,
    strippedC2paBytes,
  };
}

/**
 * Applies phase-preserving static DC offset removal, ultra-conservative non-vocal digital screech
 * soft-envelope suppression (never clipping Spanish word-final -s/-z/-d/-f/-j/plosives), and
 * C1-continuous 12ms Half-Hann micro-fades at segment boundaries.
 */
export function polishCleanTtsPcmBlock(
  pcmBytes: Uint8Array,
  sampleRate: number = DEFAULT_GEMINI_TTS_SAMPLE_RATE,
  fadeMs: number = EDGE_HALF_HANN_FADE_MS
): Uint8Array {
  const evenByteLen = pcmBytes.byteLength & ~1;
  const totalSamples = evenByteLen >> 1;
  if (totalSamples < 8) {
    const tiny = new Uint8Array(evenByteLen);
    if (evenByteLen > 0) tiny.set(pcmBytes.subarray(0, evenByteLen));
    return tiny;
  }

  const out = new Uint8Array(evenByteLen);
  out.set(pcmBytes.subarray(0, evenByteLen));
  const view = new DataView(out.buffer, out.byteOffset, out.byteLength);

  // 1. Phase-linear static integer DC offset removal (only if |mean| >= 1 LSB)
  let sum = 0;
  for (let i = 0; i < totalSamples; i++) {
    sum += view.getInt16(i * 2, true);
  }
  const dcMean = Math.round(sum / totalSamples);
  if (Math.abs(dcMean) >= 1) {
    for (let i = 0; i < totalSamples; i++) {
      const centered = view.getInt16(i * 2, true) - dcMean;
      const clamped = centered > 32767 ? 32767 : centered < -32768 ? -32768 : centered;
      view.setInt16(i * 2, clamped, true);
    }
  }

  // 2. Ultra-conservative non-vocal digital screech soft-attenuator (never hard-zeros, never touches speech fricatives)
  const winSamples = Math.max(120, Math.round((sampleRate * 20) / 1000)); // 20ms
  const rampSamples = Math.max(64, Math.round((sampleRate * GLITCH_SOFT_RAMP_MS) / 1000)); // 8ms
  const numWins = Math.floor(totalSamples / winSamples);
  if (numWins >= 3) {
    let anyGlitch = false;
    const glitchFlags = new Uint8Array(numWins);
    for (let w = 0; w < numWins; w++) {
      const start = w * winSamples;
      let energy = 0;
      let hfEnergy = 0;
      let peak = 0;
      let zc = 0;
      let prev = view.getInt16(start * 2, true) / 32768;
      // Simple 4-sample moving average proxy for LF (<3kHz) energy
      let lfEnergy = 0;
      let ma0 = prev,
        ma1 = prev,
        ma2 = prev;

      for (let i = 0; i < winSamples; i++) {
        const s = view.getInt16((start + i) * 2, true) / 32768;
        const abs = Math.abs(s);
        if (abs > peak) peak = abs;
        energy += s * s;
        if (i > 0) {
          const d = (s - prev) * 0.5;
          hfEnergy += d * d;
          if (s >= 0 !== prev >= 0) zc++;
        }
        const lf = (ma0 + ma1 + ma2 + s) * 0.25;
        lfEnergy += lf * lf;
        ma0 = ma1;
        ma1 = ma2;
        ma2 = s;
        prev = s;
      }

      const rms = Math.sqrt(energy / winSamples);
      const hfRms = Math.sqrt(hfEnergy / Math.max(1, winSamples - 1));
      const lfRms = Math.sqrt(lfEnergy / winSamples);
      const zcr = zc / Math.max(1, winSamples - 1);
      const hfRatio = hfRms / (rms + 1e-7);

      // Only triggers on extreme full-scale digital Nyquist oscillation, impossible in human /s/, /f/, /z/, /t/
      if (hfRms > 0.18 && hfRatio > 0.8 && zcr > 0.58 && lfRms < 0.015 && peak > 0.85) {
        glitchFlags[w] = 1;
        anyGlitch = true;
      }
    }

    if (anyGlitch) {
      for (let w = 0; w < numWins; w++) {
        if (!glitchFlags[w]) continue;
        let wEnd = w;
        while (wEnd + 1 < numWins && glitchFlags[wEnd + 1]) wEnd++;
        const s0 = w * winSamples;
        const s1 = Math.min(totalSamples, (wEnd + 1) * winSamples);
        const floorGain = 0.02;

        // Smooth C1 ramp-down before [s0, s1)
        const rInStart = Math.max(0, s0 - rampSamples);
        const rInLen = s0 - rInStart;
        for (let i = 0; i < rInLen; i++) {
          const g = floorGain + (1 - floorGain) * 0.5 * (1 + Math.cos((Math.PI * (i + 1)) / (rInLen + 1)));
          const idx = (rInStart + i) * 2;
          view.setInt16(idx, Math.round(view.getInt16(idx, true) * g), true);
        }
        for (let i = s0; i < s1; i++) {
          const idx = i * 2;
          view.setInt16(idx, Math.round(view.getInt16(idx, true) * floorGain), true);
        }
        const rOutEnd = Math.min(totalSamples, s1 + rampSamples);
        const rOutLen = rOutEnd - s1;
        for (let i = 0; i < rOutLen; i++) {
          const g = floorGain + (1 - floorGain) * 0.5 * (1 - Math.cos((Math.PI * (i + 1)) / (rOutLen + 1)));
          const idx = (s1 + i) * 2;
          view.setInt16(idx, Math.round(view.getInt16(idx, true) * g), true);
        }

        w = wEnd;
      }
    }
  }

  // 3. C1-continuous Half-Hann fade-in & fade-out (default 12ms = 288 samples @ 24kHz)
  const targetFadeSamples = Math.max(32, Math.round((sampleRate * fadeMs) / 1000));
  const fadeSamples = Math.min(targetFadeSamples, Math.floor(totalSamples / 2));
  if (fadeSamples > 1) {
    applyHalfHannFadeInInPlace(view, 0, fadeSamples * 2);
    applyHalfHannFadeOutInPlace(view, (totalSamples - fadeSamples) * 2, totalSamples * 2);
  }

  return out;
}

/**
 * Convenience pipeline for a single newly synthesized Gemini TTS audio payload.
 */
export function sanitizeGeminiTtsSegment(
  rawAudioBytes: Uint8Array,
  fallbackSampleRate: number = DEFAULT_GEMINI_TTS_SAMPLE_RATE
): {
  pcmBytes: Uint8Array;
  sampleRate: number;
  strippedC2paBytes: number;
} {
  const extracted = extractCleanPcmFromGeminiAudio(rawAudioBytes, fallbackSampleRate);
  const polished = polishCleanTtsPcmBlock(extracted.pcmBytes, extracted.sampleRate);
  return {
    pcmBytes: polished,
    sampleRate: extracted.sampleRate,
    strippedC2paBytes: extracted.strippedC2paBytes,
  };
}

/**
 * Fast check for whether a WAV/PCM buffer contains any embedded or trailing C2PA/JUMBF chunk.
 */
export function hasEmbeddedC2paInAudioBytes(bytes: Uint8Array): boolean {
  if (!bytes || bytes.byteLength < 48) return false;
  for (let pos = 0; pos <= bytes.byteLength - 16; pos++) {
    if (
      bytes[pos] === 0x43 &&
      bytes[pos + 1] === 0x32 &&
      bytes[pos + 2] === 0x50 &&
      bytes[pos + 3] === 0x41
    ) {
      const check = isC2paRiffChunkAt(bytes, pos, bytes.byteLength);
      if (check.valid) return true;
    }
  }
  return false;
}

/**
 * Zero-drift retroactive cleaner for an already-assembled master WAV file:
 * - Replaces every embedded C2PA/JUMBF subchunk inside `data` with exact 0x00 silence IN-PLACE
 *   so total sample count and all timeline timestamps remain 100.000% unchanged (N_out === N_in).
 * - Applies a 12ms C1 Half-Hann fade-out immediately before each erased C2PA block (and fade-in
 *   immediately after if non-zero audio follows) without altering a single bit of clean speech.
 * - Also strips any post-`data` trailing C2PA chunks if present outside `dataSize`.
 */
export function cleanMasterWavEmbeddedC2paInPlace(wavBytes: Uint8Array): {
  wavBytes: Uint8Array;
  cleanedBlocks: number;
  zeroedBytes: number;
  strippedPostDataBytes: number;
  sampleRate: number;
  totalSamples: number;
} {
  if (
    !wavBytes ||
    wavBytes.byteLength < 44 ||
    readAsciiFourCC(wavBytes, 0) !== 'RIFF' ||
    readAsciiFourCC(wavBytes, 8) !== 'WAVE'
  ) {
    return {
      wavBytes,
      cleanedBlocks: 0,
      zeroedBytes: 0,
      strippedPostDataBytes: 0,
      sampleRate: DEFAULT_GEMINI_TTS_SAMPLE_RATE,
      totalSamples: 0,
    };
  }

  const work = new Uint8Array(wavBytes.byteLength);
  work.set(wavBytes);
  const view = new DataView(work.buffer, work.byteOffset, work.byteLength);

  let sampleRate = DEFAULT_GEMINI_TTS_SAMPLE_RATE;
  let dataOffset = -1;
  let dataSize = 0;
  let cursor = 12;

  while (cursor <= work.byteLength - 8) {
    const id = readAsciiFourCC(work, cursor);
    const sz = view.getUint32(cursor + 4, true);
    if (id === 'fmt ' && sz >= 16 && cursor + 24 <= work.byteLength) {
      const sr = view.getUint32(cursor + 12, true);
      if (sr >= 8000 && sr <= 192000) sampleRate = sr;
    } else if (id === 'data') {
      dataOffset = cursor + 8;
      dataSize =
        sz === WAV_STREAMING_SIZE_SENTINEL || dataOffset + sz > work.byteLength
          ? work.byteLength - dataOffset
          : sz;
      break;
    }
    const padded = sz + (sz & 1);
    const next = cursor + 8 + padded;
    if (next <= cursor || next > work.byteLength) break;
    cursor = next;
  }

  if (dataOffset < 0) {
    dataOffset = 44;
    dataSize = work.byteLength - 44;
  }

  const dataEnd = Math.min(work.byteLength, dataOffset + dataSize);
  const fadeBytes = Math.max(64, Math.round((sampleRate * EDGE_HALF_HANN_FADE_MS) / 1000)) * 2;
  let cleanedBlocks = 0;
  let zeroedBytes = 0;

  let pos = dataOffset;
  while (pos <= dataEnd - 16) {
    if (
      work[pos] === 0x43 &&
      work[pos + 1] === 0x32 &&
      work[pos + 2] === 0x50 &&
      work[pos + 3] === 0x41
    ) {
      const check = isC2paRiffChunkAt(work, pos, dataEnd);
      if (check.valid) {
        const expanded = expandContiguousRiffMetadataBounds(
          work,
          dataOffset,
          dataEnd,
          pos,
          pos + check.totalPaddedBytes
        );
        // Align [eraseStart, eraseEnd) strictly to Int16 sample boundaries relative to dataOffset
        const eraseStart = expanded.start - ((expanded.start - dataOffset) & 1);
        let eraseEnd = expanded.end + ((expanded.end - dataOffset) & 1);
        if (eraseEnd > dataEnd) eraseEnd = dataEnd - ((dataEnd - dataOffset) & 1);

        // 12ms C1 Half-Hann fade-out on real PCM immediately preceding eraseStart
        const preStart = Math.max(dataOffset, eraseStart - fadeBytes);
        if (eraseStart - preStart >= 4) {
          applyHalfHannFadeOutInPlace(view, preStart, eraseStart);
        }

        // Exact in-place zeroing of the embedded C2PA block (preserves N_out === N_in)
        work.fill(0, eraseStart, eraseEnd);
        cleanedBlocks += 1;
        zeroedBytes += eraseEnd - eraseStart;

        // If non-zero audio immediately follows eraseEnd without a pause, smooth its entry too
        const postEnd = Math.min(dataEnd, eraseEnd + fadeBytes);
        if (postEnd - eraseEnd >= 4) {
          let hasImmediateNonZero = false;
          for (let k = eraseEnd; k < Math.min(dataEnd, eraseEnd + 32); k++) {
            if (work[k] !== 0) {
              hasImmediateNonZero = true;
              break;
            }
          }
          if (hasImmediateNonZero) {
            applyHalfHannFadeInInPlace(view, eraseEnd, postEnd);
          }
        }

        // Jump strictly past the entire C2PA block (avoids matching inner X.509 "C2PA" strings)
        pos = Math.max(pos + 4, eraseEnd);
        continue;
      }
    }
    pos += 1;
  }

  // If the WAV also had post-`data` trailing chunks (e.g. single-segment raw Gemini WAV), strip them cleanly
  const strippedPostDataBytes = work.byteLength - dataEnd;
  let finalWav = work;
  if (strippedPostDataBytes > 0) {
    finalWav = work.slice(0, dataEnd);
    const outView = new DataView(finalWav.buffer, finalWav.byteOffset, finalWav.byteLength);
    outView.setUint32(4, finalWav.byteLength - 8, true);
  }

  return {
    wavBytes: finalWav,
    cleanedBlocks,
    zeroedBytes,
    strippedPostDataBytes,
    sampleRate,
    totalSamples: Math.floor((dataEnd - dataOffset) / 2),
  };
}

/**
 * Detects and surgically trims 2x full-take hallucinations from `gemini-3.8-flash-tts`,
 * where the model occasionally reads a short dramatic question or transition sentence twice
 * separated by a 250ms–900ms silence valley (dropping effective words/sec from ~2.4 to ~1.0–1.4).
 */
export function trimDuplicatedTakeInPcm(
  pcmBytes: Uint8Array,
  sampleRate: number = DEFAULT_GEMINI_TTS_SAMPLE_RATE,
  wordCount: number = 0
): {
  pcmBytes: Uint8Array;
  wasTrimmed: boolean;
  originalDurationSec: number;
  trimmedDurationSec: number;
} {
  const evenBytes = pcmBytes.byteLength & ~1;
  const totalSamples = evenBytes >> 1;
  const safeSr = sampleRate > 0 ? sampleRate : DEFAULT_GEMINI_TTS_SAMPLE_RATE;
  const durationSec = totalSamples / safeSr;

  if (wordCount < 6 || durationSec < 5.0) {
    return {
      pcmBytes: pcmBytes.subarray(0, evenBytes),
      wasTrimmed: false,
      originalDurationSec: durationSec,
      trimmedDurationSec: durationSec,
    };
  }

  const wps = wordCount / durationSec;
  // Single-take Spanish documentary speech runs at ~2.15–2.90 wps; only inspect suspiciously slow (<1.68 wps) blocks
  if (wps >= 1.68) {
    return {
      pcmBytes: pcmBytes.subarray(0, evenBytes),
      wasTrimmed: false,
      originalDurationSec: durationSec,
      trimmedDurationSec: durationSec,
    };
  }

  const view = new DataView(pcmBytes.buffer, pcmBytes.byteOffset, evenBytes);
  const winSamples = Math.max(120, Math.round(safeSr * 0.02)); // 20ms windows
  const nWins = Math.floor(totalSamples / winSamples);
  if (nWins < 60) {
    return {
      pcmBytes: pcmBytes.subarray(0, evenBytes),
      wasTrimmed: false,
      originalDurationSec: durationSec,
      trimmedDurationSec: durationSec,
    };
  }

  const rms20 = new Float32Array(nWins);
  for (let w = 0; w < nWins; w++) {
    const base = w * winSamples;
    let sumSq = 0;
    for (let i = 0; i < winSamples; i++) {
      const s = view.getInt16((base + i) * 2, true) / 32768;
      sumSq += s * s;
    }
    rms20[w] = Math.sqrt(sumSq / winSamples);
  }

  // Search [35%..65%] of block for the longest clean silence valley (rms < 0.0025 for >= 240ms = 12 windows)
  const searchFrom = Math.floor(nWins * 0.35);
  const searchTo = Math.ceil(nWins * 0.65);
  let bestRunStart = -1;
  let bestRunEnd = -1;
  let bestRunLen = 0;

  let w = searchFrom;
  while (w < searchTo) {
    if (rms20[w] < 0.0025) {
      let end = w + 1;
      while (end < Math.min(nWins, searchTo + 25) && rms20[end] < 0.0025) {
        end++;
      }
      const len = end - w;
      if (len >= 12 && len > bestRunLen) {
        bestRunLen = len;
        bestRunStart = w;
        bestRunEnd = end;
      }
      w = end;
    } else {
      w++;
    }
  }

  if (bestRunStart < 0) {
    return {
      pcmBytes: pcmBytes.subarray(0, evenBytes),
      wasTrimmed: false,
      originalDurationSec: durationSec,
      trimmedDurationSec: durationSec,
    };
  }

  // Align speech onset of Take 1 and Take 2 so leading silence differences (e.g. 200ms at t=0) never skew correlation
  let onset1 = 0;
  while (onset1 < bestRunStart && rms20[onset1] < 0.015) onset1++;
  let end1 = bestRunStart;
  while (end1 > onset1 && rms20[end1 - 1] < 0.005) end1--;

  let onset2 = bestRunEnd;
  while (onset2 < nWins && rms20[onset2] < 0.015) onset2++;
  let end2 = nWins;
  while (end2 > onset2 && rms20[end2 - 1] < 0.005) end2--;

  const speechLen1 = end1 - onset1;
  const speechLen2 = end2 - onset2;
  const lengthRatio = Math.min(speechLen1, speechLen2) / Math.max(1, Math.max(speechLen1, speechLen2));
  if (Math.min(speechLen1, speechLen2) < 25 || lengthRatio < 0.72) {
    return {
      pcmBytes: pcmBytes.subarray(0, evenBytes),
      wasTrimmed: false,
      originalDurationSec: durationSec,
      trimmedDurationSec: durationSec,
    };
  }

  // Time-normalize Take 1 [onset1..end1) and Take 2 [onset2..end2) onto 64 proportional bins
  // so a 2-5% speaking-speed difference between the two takes still aligns syllable-for-syllable
  const N_BINS = 64;
  const env1 = new Float32Array(N_BINS);
  const env2 = new Float32Array(N_BINS);
  let mean1 = 0;
  let mean2 = 0;

  for (let b = 0; b < N_BINS; b++) {
    const f0 = b / N_BINS;
    const f1 = (b + 1) / N_BINS;

    const a0 = onset1 + Math.floor(f0 * speechLen1);
    const a1 = Math.max(a0 + 1, onset1 + Math.ceil(f1 * speechLen1));
    let s1 = 0;
    let c1 = 0;
    for (let k = a0; k < Math.min(end1, a1); k++) {
      s1 += rms20[k];
      c1++;
    }
    env1[b] = c1 > 0 ? s1 / c1 : 0;
    mean1 += env1[b];

    const b0 = onset2 + Math.floor(f0 * speechLen2);
    const b1 = Math.max(b0 + 1, onset2 + Math.ceil(f1 * speechLen2));
    let s2 = 0;
    let c2 = 0;
    for (let k = b0; k < Math.min(end2, b1); k++) {
      s2 += rms20[k];
      c2++;
    }
    env2[b] = c2 > 0 ? s2 / c2 : 0;
    mean2 += env2[b];
  }
  mean1 /= N_BINS;
  mean2 /= N_BINS;

  let num = 0;
  let den1 = 0;
  let den2 = 0;
  for (let b = 0; b < N_BINS; b++) {
    const d1 = env1[b] - mean1;
    const d2 = env2[b] - mean2;
    num += d1 * d2;
    den1 += d1 * d1;
    den2 += d2 * d2;
  }
  const bestCorr = num / (Math.sqrt(den1 * den2) + 1e-9);

  if (bestCorr < 0.35) {
    return {
      pcmBytes: pcmBytes.subarray(0, evenBytes),
      wasTrimmed: false,
      originalDurationSec: durationSec,
      trimmedDurationSec: durationSec,
    };
  }

  // Keep Take 1 + up to 260ms (13 windows) of natural trailing room decay inside the dead silence valley
  const cutWin = Math.min(bestRunEnd, bestRunStart + 13);
  const cutSamples = Math.min(totalSamples, cutWin * winSamples);
  const cutBytes = cutSamples * 2;
  const trimmed = new Uint8Array(cutBytes);
  trimmed.set(pcmBytes.subarray(0, cutBytes));

  return {
    pcmBytes: trimmed,
    wasTrimmed: true,
    originalDurationSec: durationSec,
    trimmedDurationSec: cutSamples / safeSr,
  };
}
