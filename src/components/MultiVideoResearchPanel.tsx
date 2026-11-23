import React, { useEffect, useMemo, useRef, useState } from 'react';
import { DocumentaryProject } from '../types';
import {
  getMediaBridgeSnapshot,
  getOrderedMediaBridgeBases,
  isLocalMediaRuntimeOrigin,
} from '../utils/mediaBridge';

/**
 * Etapa 1 — several YouTube videos analyzed AT THE SAME TIME by Gemini Web (each in its own tab). Every analysis
 * stays in the library of analyzed videos; the documentary picks several of them as research material for the
 * Deep Research and the script (promptConfig.SELECTED_VIDEO_ANALYSES_IDS + SELECTED_VIDEO_ANALYSES_BLOCK).
 */

interface AnalyzedVideo {
  id: string;
  videoId: string;
  url: string;
  title: string;
  channelName?: string;
  geminiAnalysis?: string;
  analysisStatus?: 'analyzing' | 'done' | 'error';
  analysisStartedAt?: string;
  analysisDoneAt?: string;
  analysisError?: string;
}

const MAX_CHARS_PER_VIDEO = 9000;

function serverOrigin(): string {
  if (typeof window === 'undefined' || isLocalMediaRuntimeOrigin()) return '';
  const origin = String(getMediaBridgeSnapshot().activeOrigin || getOrderedMediaBridgeBases()[0] || '').replace(
    /\/+$/,
    ''
  );
  return origin && origin !== window.location.origin ? origin : '';
}
const api = (p: string) => `${serverOrigin()}${p}`;

function parseSelectedIds(raw: unknown): string[] {
  return String(raw || '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
}

/** Research block the prompts receive (built from the selected, finished analyses). */
export function buildSelectedVideoAnalysesBlock(videos: AnalyzedVideo[], ids: string[]): string {
  const chosen = ids
    .map((id) => videos.find((v) => v.videoId === id))
    .filter((v): v is AnalyzedVideo => Boolean(v && v.analysisStatus === 'done' && v.geminiAnalysis));
  if (chosen.length === 0) return '';
  return chosen
    .map(
      (v, i) =>
        `=== VIDEO ${i + 1}: "${v.title}"${v.channelName ? ` (${v.channelName})` : ''} — ${v.url} ===\n${String(
          v.geminiAnalysis
        ).slice(0, MAX_CHARS_PER_VIDEO)}`
    )
    .join('\n\n');
}

interface Props {
  activeDoc: DocumentaryProject;
  updateActiveDoc: (patch: Partial<DocumentaryProject>, options?: { docId?: string; source?: string }) => any;
}

export default function MultiVideoResearchPanel({ activeDoc, updateActiveDoc }: Props) {
  const [videos, setVideos] = useState<AnalyzedVideo[]>([]);
  const [linksText, setLinksText] = useState('');
  const [starting, setStarting] = useState(false);
  const [message, setMessage] = useState('');
  const [openId, setOpenId] = useState('');
  const docIdRef = useRef(activeDoc.id);
  docIdRef.current = activeDoc.id;

  const selectedIds = useMemo(
    () => parseSelectedIds(activeDoc.promptConfig?.SELECTED_VIDEO_ANALYSES_IDS),
    [activeDoc.promptConfig?.SELECTED_VIDEO_ANALYSES_IDS]
  );

  const load = async () => {
    try {
      const r = await fetch(api('/api/youtube/video-analysis/list'), { cache: 'no-store' });
      const j = await r.json();
      const list = Array.isArray(j) ? j : Array.isArray(j?.videos) ? j.videos : [];
      setVideos(list);
    } catch {}
  };

  useEffect(() => {
    void load();
  }, []);

  // While Gemini is working, refresh the list every few seconds
  const anyAnalyzing = videos.some((v) => v.analysisStatus === 'analyzing');
  useEffect(() => {
    if (!anyAnalyzing) return;
    const t = setInterval(() => void load(), 4000);
    return () => clearInterval(t);
  }, [anyAnalyzing]);

  // Keep the research block the prompts use in step with the selection (also when a selected analysis finishes)
  useEffect(() => {
    if (videos.length === 0) return;
    const block = buildSelectedVideoAnalysesBlock(videos, selectedIds);
    const current = String(activeDoc.promptConfig?.SELECTED_VIDEO_ANALYSES_BLOCK || '');
    if (block !== current) {
      updateActiveDoc(
        {
          promptConfig: {
            ...(activeDoc.promptConfig || {}),
            SELECTED_VIDEO_ANALYSES_BLOCK: block,
          },
        },
        { docId: activeDoc.id, source: 'multi-video-research' }
      );
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [videos, selectedIds.join(','), activeDoc.id]);

  const toggle = (videoId: string) => {
    const next = selectedIds.includes(videoId)
      ? selectedIds.filter((id) => id !== videoId)
      : [...selectedIds, videoId];
    updateActiveDoc(
      {
        promptConfig: {
          ...(activeDoc.promptConfig || {}),
          SELECTED_VIDEO_ANALYSES_IDS: next.join(','),
          SELECTED_VIDEO_ANALYSES_BLOCK: buildSelectedVideoAnalysesBlock(videos, next),
        },
      },
      { docId: activeDoc.id, source: 'multi-video-research' }
    );
  };

  const start = async (urls: string[]) => {
    if (urls.length === 0) {
      setMessage('Pega al menos un enlace de YouTube.');
      return;
    }
    setStarting(true);
    setMessage('');
    try {
      const r = await fetch(api('/api/youtube/video-analysis/start'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ urls, topic: activeDoc.topic || activeDoc.title || '' }),
      });
      const j = await r.json().catch(() => ({}));
      if (!r.ok || !j?.ok) throw new Error(j?.error || `Error ${r.status}`);
      setLinksText('');
      void load();
      // The videos started now are selected for this documentary right away
      const startedIds: string[] = (j.started || []).map((s: any) => String(s.videoId));
      const next = [...new Set([...selectedIds, ...startedIds])];
      if (docIdRef.current === activeDoc.id) {
        updateActiveDoc(
          {
            promptConfig: {
              ...(activeDoc.promptConfig || {}),
              SELECTED_VIDEO_ANALYSES_IDS: next.join(','),
            },
          },
          { docId: activeDoc.id, source: 'multi-video-research' }
        );
      }
      setMessage(
        `🌐 ${startedIds.length} video${startedIds.length === 1 ? '' : 's'} enviado${
          startedIds.length === 1 ? '' : 's'
        } a Gemini Web, cada uno en su pestaña. Los análisis aparecen aquí solos.`
      );
    } catch (e: any) {
      setMessage(`⚠️ ${e?.message || 'No se pudo enviar.'}`);
    } finally {
      setStarting(false);
    }
  };

  const linksFromText = () =>
    linksText
      .split(/[\s,]+/)
      .map((s) => s.trim())
      .filter((s) => /youtu\.?be/i.test(s));

  // Only videos analyzed with this tool (the older library entries keep using the selector below)
  const analysisList = videos.filter((v) => v.analysisStatus || v.geminiAnalysis);
  const selectedDone = analysisList.filter((v) => selectedIds.includes(v.videoId) && v.analysisStatus === 'done');

  return (
    <div className="bg-slate-950/70 border border-sky-500/30 rounded-xl p-3 space-y-3 min-w-0 max-w-full">
      <div>
        <h4 className="font-bold text-sky-300 text-sm">🧪 Analizar varios videos a la vez (Gemini Web)</h4>
        <p className="text-[11px] text-slate-400">
          Pega varios enlaces de YouTube (uno por línea). Gemini analiza cada video por separado, todos al mismo
          tiempo en pestañas distintas. Marca los que quieras usar: entran en la investigación profunda y en el
          guion de este documental.
        </p>
      </div>
      <textarea
        value={linksText}
        onChange={(e) => setLinksText(e.target.value)}
        rows={3}
        placeholder={'https://www.youtube.com/watch?v=...\nhttps://youtu.be/...'}
        className="w-full min-w-0 bg-slate-950 border border-slate-800 rounded-lg px-2.5 py-2 text-xs text-slate-100"
      />
      <button
        type="button"
        disabled={starting || linksFromText().length === 0}
        onClick={() => void start(linksFromText())}
        className="w-full py-2 rounded-lg bg-sky-500/20 hover:bg-sky-500/30 border border-sky-500/40 text-sky-200 text-xs font-bold cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
      >
        {starting
          ? 'Enviando…'
          : `Analizar ${linksFromText().length || ''} video${linksFromText().length === 1 ? '' : 's'} en paralelo`}
      </button>
      {message && <p className="text-[11px] text-slate-300">{message}</p>}

      {analysisList.length > 0 && (
        <div className="space-y-1.5">
          <div className="text-[11px] font-semibold text-slate-300">
            Videos analizados ({analysisList.length}) · usados en este documental: {selectedDone.length}
          </div>
          <div className="max-h-[360px] overflow-y-auto overscroll-contain space-y-1.5 pr-0.5">
            {analysisList.map((v) => {
              const checked = selectedIds.includes(v.videoId);
              const st = v.analysisStatus || (v.geminiAnalysis ? 'done' : '');
              return (
                <div
                  key={v.videoId}
                  className={`rounded-lg border px-2.5 py-2 text-xs min-w-0 ${
                    checked ? 'border-sky-500/50 bg-sky-500/10' : 'border-slate-800 bg-slate-950'
                  }`}
                >
                  <div className="flex items-start gap-2 min-w-0">
                    <input
                      type="checkbox"
                      checked={checked}
                      onChange={() => toggle(v.videoId)}
                      className="mt-0.5 shrink-0 accent-sky-500 cursor-pointer"
                      aria-label={`Usar ${v.title}`}
                    />
                    <div className="min-w-0 flex-1">
                      <div className="font-semibold text-slate-100 break-words">{v.title}</div>
                      <div className="text-[10px] text-slate-500 truncate">{v.channelName}</div>
                    </div>
                    <span
                      className={`shrink-0 px-1.5 py-0.5 rounded text-[10px] font-bold ${
                        st === 'done'
                          ? 'bg-emerald-500/20 text-emerald-300'
                          : st === 'analyzing'
                          ? 'bg-amber-500/20 text-amber-300 animate-pulse'
                          : 'bg-rose-500/20 text-rose-300'
                      }`}
                    >
                      {st === 'done' ? '✓ Listo' : st === 'analyzing' ? 'Analizando…' : 'Error'}
                    </span>
                  </div>
                  {st === 'error' && (
                    <div className="mt-1.5 flex items-center justify-between gap-2 flex-wrap">
                      <span className="text-[10px] text-rose-300">{v.analysisError}</span>
                      <button
                        type="button"
                        disabled={starting}
                        onClick={() => void start([v.url])}
                        className="px-2 py-0.5 rounded bg-slate-900 border border-slate-700 text-[10px] text-slate-200 cursor-pointer"
                      >
                        Reintentar
                      </button>
                    </div>
                  )}
                  {st === 'done' && v.geminiAnalysis && (
                    <div className="mt-1.5">
                      <button
                        type="button"
                        onClick={() => setOpenId(openId === v.videoId ? '' : v.videoId)}
                        className="text-[10px] text-sky-300 underline cursor-pointer"
                      >
                        {openId === v.videoId ? 'Ocultar análisis' : 'Ver análisis'}
                      </button>
                      {openId === v.videoId && (
                        <div className="mt-1 max-h-[260px] overflow-y-auto whitespace-pre-wrap text-[11px] text-slate-300 bg-black/30 rounded p-2">
                          {v.geminiAnalysis}
                        </div>
                      )}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
