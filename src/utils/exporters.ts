import { Sentence } from '../types';
import { formatTimestamp, formatSRT, formatVTT } from './formatTime';
import { splitWordsIntoShortLines } from './smartParsers';

function getStatsHeader(sentences: Sentence[]): string {
  if (!sentences || sentences.length === 0) return '';
  const totalWords = sentences.reduce(
    (acc, s) => acc + s.text.trim().split(/\s+/).filter(Boolean).length,
    0
  );
  const maxEnd = sentences.reduce((max, s) => Math.max(max, s.end), 0);
  const durationSecs = maxEnd > 0 ? maxEnd : 1;
  const wpm = ((totalWords * 60) / durationSecs).toFixed(1);
  return `===================================\nCANTIDAD DE PALABRAS: ${totalWords}\nPALABRAS POR MINUTO (WPM): ${wpm}\n===================================\n\n`;
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
    const words = (s.text || '').trim().split(/\s+/).filter(Boolean);
    if (words.length === 0) continue;
    const chunks = splitWordsIntoShortLines(words, maxCharsPerLine);
    const totalDur = Math.max(0.1, s.end - s.start);
    const weights = chunks.map((chunk) => {
      const text = chunk.join(' ');
      const lastW = chunk[chunk.length - 1] || '';
      const punctBonus = /[.?!:;…]$/.test(lastW) ? 5 : /[,]$/.test(lastW) ? 2 : 0;
      return Math.max(1, text.length + punctBonus);
    });
    const totalWeight = weights.reduce((a, b) => a + b, 0);
    let accWeight = 0;
    let prevStart = s.start;
    for (let i = 0; i < chunks.length; i++) {
      accWeight += weights[i];
      const nextEnd =
        i === chunks.length - 1 ? s.end : s.start + (accWeight / totalWeight) * totalDur;
      const idx = blocks.length + 1;
      blocks.push(`${idx}\n${formatSRT(prevStart)} --> ${formatSRT(nextEnd)}\n${chunks[i].join(' ')}`);
      prevStart = nextEnd;
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
