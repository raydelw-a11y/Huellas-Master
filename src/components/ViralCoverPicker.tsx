import React from 'react';
import { ViralPosterTitle, useViralPosterFontPx, viralPosterTextHeightPx } from './ViralPosterTitle';
import { VIRAL_TITLE_LOOK, computeViralCoverTitleTopFrac, type ViralFaceBox } from '../utils/viralTitle';

// Cover of a viral clip: the clip's last frame is a still with the big title. Shows the cover as it will be
// exported (picture + title, in the upper half and off faces) and the frames it can be changed to.

export interface ViralCoverCandidate {
  clipSec: number;
  score: number;
  faces: ViralFaceBox[];
  thumb?: string;
}

const COVER_W = 150;
const COVER_H = (COVER_W * 16) / 9;

export const ViralCoverPicker: React.FC<{
  candidates: ViralCoverCandidate[];
  /** The frame the page proposes */
  bestClipSec: number | null;
  /** The frame chosen by hand (undefined = the proposed one) */
  chosenClipSec?: number;
  onChoose: (clipSec: number | undefined) => void;
  titleLines: string[];
  /** Usual top of the title, % of the frame height */
  titleTopPct: number;
  loading: boolean;
}> = ({ candidates, bestClipSec, chosenClipSec, onChoose, titleLines, titleTopPct, loading }) => {
  const activeSec =
    typeof chosenClipSec === 'number' && candidates.some((c) => c.clipSec === chosenClipSec)
      ? chosenClipSec
      : bestClipSec;
  const active = candidates.find((c) => c.clipSec === activeSec) || null;
  const fontPx = useViralPosterFontPx(
    titleLines,
    COVER_W,
    COVER_H,
    VIRAL_TITLE_LOOK.bigTextWFrac,
    VIRAL_TITLE_LOOK.bigFontHFrac
  );
  const topPx =
    COVER_H *
    computeViralCoverTitleTopFrac({
      defaultTopFrac: titleTopPct / 100,
      textHeightFrac: viralPosterTextHeightPx(titleLines.length, fontPx) / COVER_H,
      faces: active ? active.faces : [],
    });
  const mmss = (sec: number) => `${Math.floor(sec / 60)}:${String(Math.floor(sec % 60)).padStart(2, '0')}`;

  if (candidates.length === 0) {
    return (
      <p className="text-[11px] text-slate-400 italic px-1">
        {loading
          ? 'Buscando los mejores fotogramas del clip para la portada…'
          : 'La portada se elegirá sola al exportar (aún no se pudieron leer fotogramas de este clip).'}
      </p>
    );
  }
  return (
    <div className="flex gap-3 items-start">
      <div
        className="relative shrink-0 rounded-lg overflow-hidden bg-black border border-amber-500/40"
        style={{ width: COVER_W, height: COVER_H }}
      >
        {active?.thumb && <img src={active.thumb} alt="Portada del clip" className="absolute inset-0 w-full h-full object-cover" />}
        <ViralPosterTitle
          lines={titleLines}
          frameW={COVER_W}
          frameH={COVER_H}
          maxTextWFrac={VIRAL_TITLE_LOOK.bigTextWFrac}
          maxFontHFrac={VIRAL_TITLE_LOOK.bigFontHFrac}
          topPx={topPx}
          visible
        />
      </div>
      <div className="min-w-0 flex-1 space-y-1.5">
        <div className="flex items-center justify-between gap-2">
          <span className="text-[11px] text-slate-300">
            {typeof chosenClipSec === 'number' && activeSec === chosenClipSec
              ? `Elegida a mano (${mmss(chosenClipSec)})`
              : `Elegida por la página${activeSec !== null ? ` (${mmss(activeSec)})` : ''}`}
          </span>
          {typeof chosenClipSec === 'number' && (
            <button
              type="button"
              onClick={() => onChoose(undefined)}
              className="text-[11px] text-amber-300 hover:text-amber-200 cursor-pointer"
            >
              Volver a la automática
            </button>
          )}
        </div>
        <div className="grid grid-cols-6 gap-1">
          {candidates.map((c) => {
            const isActive = c.clipSec === activeSec;
            return (
              <button
                key={c.clipSec}
                type="button"
                onClick={() => onChoose(c.clipSec === bestClipSec ? undefined : c.clipSec)}
                title={`Usar el fotograma del segundo ${mmss(c.clipSec)}${c.clipSec === bestClipSec ? ' (propuesto)' : ''}`}
                className={`relative rounded overflow-hidden border cursor-pointer ${
                  isActive ? 'border-amber-400 ring-1 ring-amber-400' : 'border-slate-700 hover:border-slate-500'
                }`}
                style={{ aspectRatio: '9 / 16' }}
              >
                {c.thumb && <img src={c.thumb} alt="" className="absolute inset-0 w-full h-full object-cover" />}
                {c.clipSec === bestClipSec && (
                  <span className="absolute bottom-0 inset-x-0 bg-amber-400 text-slate-950 text-[9px] font-black leading-tight text-center">
                    ★
                  </span>
                )}
              </button>
            );
          })}
        </div>
        <p className="text-[11px] text-slate-400 italic">
          Toca otro fotograma para cambiar la portada. ★ es el que propone la página.
        </p>
      </div>
    </div>
  );
};
