import React, { useEffect, useMemo, useRef, useState } from 'react';
import { DocumentaryProject } from '../types';
import {
  getMediaBridgeSnapshot,
  getOrderedMediaBridgeBases,
  isLocalMediaRuntimeOrigin,
} from '../utils/mediaBridge';

/**
 * Etapa 1 — the library of YouTube videos analyzed by Gemini Web (4 tabs at a time, the rest queued). One complete
 * analysis per video, valid for any documentary; each documentary marks the videos it uses and its prompts take
 * from each one what fits (promptConfig.SELECTED_VIDEO_ANALYSES_IDS + SELECTED_VIDEO_ANALYSES_BLOCK).
 */

interface AnalyzedVideo {
  id: string;
  videoId: string;
  url: string;
  title: string;
  channelName?: string;
  geminiAnalysis?: string;
  analysisStatus?: 'queued' | 'analyzing' | 'done' | 'error';
  commentsCount?: number;
  analysisStartedAt?: string;
  analysisDoneAt?: string;
  analysisError?: string;
}

// A whole analysis (its 7 sections, ~21k characters) must reach the prompts: doubts, gaps and structure come last
const MAX_CHARS_PER_VIDEO = 22000;

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
  /** Reports the analyses and their status (Paso 1 / Paso 2 warn when a marked one is still running) */
  onAnalysesChange?: (videos: AnalyzedVideo[]) => void;
}

export default function MultiVideoResearchPanel({ activeDoc, updateActiveDoc, onAnalysesChange }: Props) {
  const [videos, setVideos] = useState<AnalyzedVideo[]>([]);
  const [linksText, setLinksText] = useState('');
  const [starting, setStarting] = useState(false);
  const [message, setMessage] = useState('');
  const [openId, setOpenId] = useState('');
  const docIdRef = useRef(activeDoc.id);
  docIdRef.current = activeDoc.id;
  const videosRef = useRef<AnalyzedVideo[]>([]);
  videosRef.current = videos;
  const onAnalysesChangeRef = useRef(onAnalysesChange);
  onAnalysesChangeRef.current = onAnalysesChange;

  const selectedIds = useMemo(
    () => parseSelectedIds(activeDoc.promptConfig?.SELECTED_VIDEO_ANALYSES_IDS),
    [activeDoc.promptConfig?.SELECTED_VIDEO_ANALYSES_IDS]
  );

  const load = async (light = false) => {
    try {
      const r = await fetch(api(`/api/youtube/video-analysis/list${light ? '?light=1' : ''}`), { cache: 'no-store' });
      const j = await r.json();
      const list: AnalyzedVideo[] = Array.isArray(j) ? j : Array.isArray(j?.videos) ? j.videos : [];
      if (!light) {
        setVideos(list);
        onAnalysesChangeRef.current?.(list);
        return;
      }
      // Light poll (statuses only, no texts): the full list is fetched once when something changed
      const prev = videosRef.current;
      const changed = list.some((v) => {
        const before = prev.find((x) => x.videoId === v.videoId);
        return !before || before.analysisStatus !== v.analysisStatus;
      });
      if (changed) await load(false);
    } catch {}
  };

  useEffect(() => {
    void load();
  }, []);

  // While Gemini is working, refresh the list every few seconds
  const anyAnalyzing = videos.some((v) => v.analysisStatus === 'analyzing' || v.analysisStatus === 'queued');
  useEffect(() => {
    if (!anyAnalyzing) return;
    const t = setInterval(() => void load(true), 4000);
    return () => clearInterval(t);
  }, [anyAnalyzing]);

  // Keep the research block the prompts use in step with the selection (also when a selected analysis finishes)
  useEffect(() => {
    if (videos.length === 0) return;
    const block = buildSelectedVideoAnalysesBlock(videos, selectedIds);
    const current = String(activeDoc.promptConfig?.SELECTED_VIDEO_ANALYSES_BLOCK || '');
    if (block !== current) {
      // Only this key: updateActiveDoc merges it into the latest promptConfig (no stale copy of the other keys)
      updateActiveDoc(
        { promptConfig: { SELECTED_VIDEO_ANALYSES_BLOCK: block } },
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
          SELECTED_VIDEO_ANALYSES_IDS: next.join(','),
          SELECTED_VIDEO_ANALYSES_BLOCK: buildSelectedVideoAnalysesBlock(videos, next),
        },
      },
      { docId: activeDoc.id, source: 'multi-video-research' }
    );
  };

  const [search, setSearch] = useState('');

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
        body: JSON.stringify({ urls }),
      });
      const j = await r.json().catch(() => ({}));
      if (!r.ok || !j?.ok) throw new Error(j?.error || `Error ${r.status}`);
      setLinksText('');
      void load();
      const n = (j.started || []).length;
      setMessage(
        `🌐 ${n} video${n === 1 ? '' : 's'} en cola. Gemini Web analiza 4 a la vez, cada uno en su pestaña; los análisis aparecen aquí solos.`
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

  const statusOf = (v: AnalyzedVideo) => v.analysisStatus || (v.geminiAnalysis ? 'done' : 'none');
  const q = search.trim().toLowerCase();
  // Marked videos first, then the most recent
  const libraryList = videos
    .filter((v) => !q || `${v.title} ${v.channelName || ''}`.toLowerCase().includes(q))
    .sort((a, b) => Number(selectedIds.includes(b.videoId)) - Number(selectedIds.includes(a.videoId)));
  const selectedDone = videos.filter((v) => selectedIds.includes(v.videoId) && statusOf(v) === 'done');
  const pendingCount = videos.filter((v) => v.analysisStatus === 'queued' || v.analysisStatus === 'analyzing').length;

  return (
    <div className="bg-slate-950/70 border border-sky-500/30 rounded-xl p-3 space-y-3 min-w-0 max-w-full">
      <div>
        <h4 className="font-bold text-sky-300 text-sm">🧪 Videos analizados con Gemini Web</h4>
        <p className="text-[11px] text-slate-400">
          Pega enlaces de YouTube (uno por línea), de cualquier tema o de tu canal. Gemini analiza cada video (4 a la
          vez) y guarda su análisis y sus comentarios en la biblioteca, para este y otros documentales. Marca los que
          quieras usar aquí: el Paso 1, la investigación profunda y el guion tomarán de cada uno lo que corresponda
          (hechos si es de nuestro tema; estructura y ganchos de cualquiera). Si no escribes el Tema, el Paso 1
          propone uno por cada video marcado.
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
          : `Analizar ${linksFromText().length || ''} video${linksFromText().length === 1 ? '' : 's'} con Gemini`}
      </button>
      {message && <p className="text-[11px] text-slate-300">{message}</p>}

      {videos.length > 0 && (
        <div className="space-y-1.5">
          <div className="flex items-center justify-between gap-2 flex-wrap">
            <div className="text-[11px] font-semibold text-slate-300">
              Biblioteca ({videos.length}) · usados en este documental: {selectedDone.length}
              {pendingCount > 0 ? ` · ${pendingCount} en proceso` : ''}
            </div>
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Buscar video..."
              className="w-40 min-w-0 bg-slate-950 border border-slate-800 rounded-lg px-2 py-1 text-[11px] text-slate-200"
            />
          </div>
          <div className="max-h-[360px] overflow-y-auto overscroll-contain space-y-1.5 pr-0.5">
            {libraryList.map((v) => {
              const checked = selectedIds.includes(v.videoId);
              const st = statusOf(v);
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
                      disabled={st === 'none' && !checked}
                      onChange={() => toggle(v.videoId)}
                      className="mt-0.5 shrink-0 accent-sky-500 cursor-pointer disabled:cursor-not-allowed"
                      aria-label={`Usar ${v.title}`}
                      title={st === 'none' ? 'Analízalo primero con Gemini' : 'Usar en este documental'}
                    />
                    <div className="min-w-0 flex-1">
                      <div className="font-semibold text-slate-100 break-words">{v.title}</div>
                      <div className="text-[10px] text-slate-500 truncate">
                        {v.channelName}
                        {Number(v.commentsCount || 0) > 0 ? ` · ${v.commentsCount} comentarios` : ''}
                      </div>
                    </div>
                    <span
                      className={`shrink-0 px-1.5 py-0.5 rounded text-[10px] font-bold ${
                        st === 'done'
                          ? 'bg-emerald-500/20 text-emerald-300'
                          : st === 'analyzing'
                          ? 'bg-amber-500/20 text-amber-300 animate-pulse'
                          : st === 'queued'
                          ? 'bg-slate-700/60 text-slate-200'
                          : st === 'none'
                          ? 'bg-slate-800 text-slate-400'
                          : 'bg-rose-500/20 text-rose-300'
                      }`}
                    >
                      {st === 'done'
                        ? '✓ Listo'
                        : st === 'analyzing'
                        ? 'Analizando…'
                        : st === 'queued'
                        ? 'En cola'
                        : st === 'none'
                        ? 'Sin analizar'
                        : 'Error'}
                    </span>
                  </div>
                  {(st === 'error' || st === 'none' || st === 'done') && (
                    <div className="mt-1.5 flex items-center justify-between gap-2 flex-wrap">
                      {st === 'error' ? (
                        <span className="text-[10px] text-rose-300">{v.analysisError}</span>
                      ) : st === 'done' && v.geminiAnalysis ? (
                        <button
                          type="button"
                          onClick={() => setOpenId(openId === v.videoId ? '' : v.videoId)}
                          className="text-[10px] text-sky-300 underline cursor-pointer"
                        >
                          {openId === v.videoId ? 'Ocultar análisis' : 'Ver análisis'}
                        </button>
                      ) : (
                        <span className="text-[10px] text-slate-500">Aún sin análisis de Gemini</span>
                      )}
                      {v.url && (
                        <button
                          type="button"
                          disabled={starting}
                          onClick={() => void start([v.url])}
                          className="px-2 py-0.5 rounded bg-slate-900 border border-slate-700 text-[10px] text-slate-200 cursor-pointer"
                        >
                          {st === 'error' ? 'Reintentar' : st === 'none' ? 'Analizar' : 'Reanalizar'}
                        </button>
                      )}
                    </div>
                  )}
                  {st === 'done' && openId === v.videoId && v.geminiAnalysis && (
                    <div className="mt-1 max-h-[260px] overflow-y-auto whitespace-pre-wrap text-[11px] text-slate-300 bg-black/30 rounded p-2">
                      {v.geminiAnalysis}
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
