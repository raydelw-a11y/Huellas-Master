import { Sentence } from '../types';
import { formatTimestamp, formatSRT, formatVTT } from './formatTime';
import { splitWordsIntoShortLines, stripPauseTags, UNIVERSAL_PAUSE_REGEX } from './smartParsers';

export function isSilentTimelineSegment(text?: string): boolean {
  return /^\[SIN\s+VOZ\s+NARRATIVA/i.test(String(text || '').trim());
}

function getStatsHeader(sentences: Sentence[]): string {
  if (!sentences || sentences.length === 0) return '';
  const spokenSentences = sentences.filter((s) => !isSilentTimelineSegment(s.text));
  const totalWords = spokenSentences.reduce((acc, s) => {
    const clean = stripPauseTags(s.text || '').trim();
    return acc + (clean ? clean.split(/\s+/).filter(Boolean).length : 0);
  }, 0);
  const maxEnd = sentences.reduce((max, s) => Math.max(max, s.end), 0);
  const minSpokenStart =
    spokenSentences.length > 0
      ? spokenSentences.reduce((min, s) => Math.min(min, s.start), Infinity)
      : 0;
  const maxSpokenEnd =
    spokenSentences.length > 0
      ? spokenSentences.reduce((max, s) => Math.max(max, s.end), 0)
      : maxEnd;
  const spokenSpanSecs = Math.max(1, maxSpokenEnd - minSpokenStart);
  const wpm = totalWords > 0 ? ((totalWords * 60) / spokenSpanSecs).toFixed(1) : '0.0';
  const totalVideoFormatted = formatTimestamp(maxEnd, 'MM:SS');
  return `===================================\nCANTIDAD DE PALABRAS: ${totalWords}\nPALABRAS POR MINUTO (WPM): ${wpm}\nDURACIÓN VIDEO TOTAL: ${totalVideoFormatted}\n===================================\n\n`;
}

export function generateTimelineText(
  sentences: Sentence[],
  timestampFormat: 'MM:SS' | 'HH:MM:SS' | 'HH:MM:SS,mmm',
  noBlankLines: boolean = true,
  includeLineNumbers: boolean = true
): string {
  const delimiter = noBlankLines ? '\n' : '\n\n';
  const body = sentences
    .map((s, idx) => {
      const startStr = formatTimestamp(s.start, timestampFormat);
      const endStr = formatTimestamp(s.end, timestampFormat);
      const lineNum = includeLineNumbers ? `${idx + 1} ` : '';
      return `${lineNum}${startStr} - ${endStr} ${s.text}`;
    })
    .join(delimiter);
  return getStatsHeader(sentences) + body;
}

export function generatePlainTranscript(
  sentences: Sentence[],
  noBlankLines: boolean = true
): string {
  const delimiter = noBlankLines ? '\n' : '\n\n';
  const body = sentences.map((s) => s.text).join(delimiter);
  return getStatsHeader(sentences) + body;
}

export function generateSRT(sentences: Sentence[], maxCharsPerLine: number = 32): string {
  const blocks: string[] = [];
  for (const s of sentences) {
    if (isSilentTimelineSegment(s.text)) continue;

    // Split around inline pause tags so dramatic pauses leave real silence without subtitles on screen
    const pauseRe = new RegExp(UNIVERSAL_PAUSE_REGEX.source, 'gi');
    const subParts: Array<{ type: 'text' | 'pause'; text?: string; sec?: number }> = [];
    const raw = String(s.text || '');
    let lastIdx = 0;
    let m: RegExpExecArray | null;
    while ((m = pauseRe.exec(raw)) !== null) {
      const before = raw.slice(lastIdx, m.index).trim();
      if (before) subParts.push({ type: 'text', text: before });
      let pSec = 1.5;
      if (m[1] !== undefined) {
        const val = parseFloat(m[1].replace(',', '.'));
        const unit = (m[2] || 's').toLowerCase();
        pSec = unit.startsWith('ms') || unit.startsWith('mili') ? val / 1000 : val;
      } else if (m[3] !== undefined) {
        const val = parseFloat(m[3].replace(',', '.'));
        const unit = (m[4] || 's').toLowerCase();
        pSec = unit === 'ms' ? val / 1000 : val;
      }
      subParts.push({ type: 'pause', sec: Math.max(0.2, Math.min(20, pSec || 1.5)) });
      lastIdx = m.index + m[0].length;
    }
    const tail = raw.slice(lastIdx).trim();
    if (tail) subParts.push({ type: 'text', text: tail });

    const totalSlotDur = Math.max(0.1, s.end - s.start);
    const rawPauseSum = subParts
      .filter((p) => p.type === 'pause')
      .reduce((acc, p) => acc + (p.sec || 0), 0);
    const effectivePauseScale =
      rawPauseSum > 0 && rawPauseSum > totalSlotDur * 0.7
        ? (totalSlotDur * 0.7) / rawPauseSum
        : 1;
    const netSpeechDur = Math.max(0.1, totalSlotDur - rawPauseSum * effectivePauseScale);

    const textParts = subParts.filter((p) => p.type === 'text' && p.text);
    const totalCharWeight = Math.max(
      1,
      textParts.reduce((acc, p) => acc + stripPauseTags(p.text || '').length, 0)
    );

    let cursor = s.start;
    for (const part of subParts) {
      if (part.type === 'pause') {
        cursor = Math.min(s.end, cursor + (part.sec || 0) * effectivePauseScale);
        continue;
      }
      const cleanPart = stripPauseTags(part.text || '').trim();
      const words = cleanPart.split(/\s+/).filter(Boolean);
      if (words.length === 0) continue;
      const partDur = Math.max(
        0.15,
        Math.min(s.end - cursor, (cleanPart.length / totalCharWeight) * netSpeechDur)
      );
      const partEnd = Math.min(s.end, cursor + partDur);
      const chunks = splitWordsIntoShortLines(words, maxCharsPerLine);
      const weights = chunks.map((chunk) => {
        const text = chunk.join(' ');
        const lastW = chunk[chunk.length - 1] || '';
        const punctBonus = /[.?!:;…]$/.test(lastW) ? 5 : /[,]$/.test(lastW) ? 2 : 0;
        return Math.max(1, text.length + punctBonus);
      });
      const totalWeight = weights.reduce((a, b) => a + b, 0);
      let accWeight = 0;
      let prevStart = cursor;
      for (let i = 0; i < chunks.length; i++) {
        accWeight += weights[i];
        const nextEnd =
          i === chunks.length - 1 ? partEnd : cursor + (accWeight / totalWeight) * (partEnd - cursor);
        const idx = blocks.length + 1;
        blocks.push(`${idx}\n${formatSRT(prevStart)} --> ${formatSRT(nextEnd)}\n${chunks[i].join(' ')}`);
        prevStart = nextEnd;
      }
      cursor = partEnd;
    }
  }
  return blocks.join('\n\n');
}

export function generateVTT(sentences: Sentence[]): string {
  const body = sentences
    .map((s) => {
      const timeline = `${formatVTT(s.start)} --> ${formatVTT(s.end)}`;
      return `${timeline}\n${s.text}`;
    })
    .join('\n\n');
  return `WEBVTT\n\n${body}`;
}

export function generateCSV(sentences: Sentence[]): string {
  const headers = ['index', 'start', 'end', 'start_formatted', 'end_formatted', 'text'];
  const rows = sentences.map((s, idx) => {
    const escapedText = s.text.replace(/"/g, '""');
    return [
      idx + 1,
      s.start.toFixed(2),
      s.end.toFixed(2),
      `"${formatTimestamp(s.start, 'MM:SS')}"`,
      `"${formatTimestamp(s.end, 'MM:SS')}"`,
      `"${escapedText}"`,
    ].join(',');
  });
  return [headers.join(','), ...rows].join('\n');
}

export function generateJSON(sentences: Sentence[]): string {
  return JSON.stringify(sentences, null, 2);
}

export function triggerFileDownload(content: string, filename: string, mimeType: string) {
  const blob = new Blob([content], { type: mimeType });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}
