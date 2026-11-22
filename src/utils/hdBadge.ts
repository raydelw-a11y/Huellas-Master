import hdBadgeUrl from '../assets/brand/hd_badge_9x16.png';

/**
 * Official "HD" gold badge of the 9:16 thumbnails, cut from the Video 30 thumbnail (4K, 3072×5504).
 * Every new 9:16 thumbnail gets this exact badge at the same place and size instead of an AI-drawn one.
 * Geometry in the 3072-wide original: badge box 430 px wide, left edge at x=2550, top at y=165.
 * The server (save-captured-thumbnail) uses the same numbers.
 */
export const HD_BADGE_9X16_GEOMETRY = { refW: 3072, refH: 5504, boxW: 430, x: 2550, y: 165 };

/** In the prompt the AI leaves the top-right corner empty: the badge is added afterwards. */
export const HD_BADGE_EMPTY_CORNER_CLAUSE =
  'the top-right corner left completely clean and empty with no text, no badge and no logo in that corner';

const loadImage = (src: string) =>
  new Promise<HTMLImageElement>((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = reject;
    img.src = src;
  });

/** Returns the thumbnail with the official HD badge stamped top-right (or the original if anything fails). */
export async function stampHdBadgeOn9x16Thumbnail(dataUrl: string): Promise<string> {
  if (!dataUrl || !dataUrl.startsWith('data:image/')) return dataUrl;
  try {
    const [base, badge] = await Promise.all([loadImage(dataUrl), loadImage(hdBadgeUrl)]);
    const W = base.naturalWidth;
    const H = base.naturalHeight;
    if (!W || !H || !badge.naturalWidth) return dataUrl;
    const canvas = document.createElement('canvas');
    canvas.width = W;
    canvas.height = H;
    const ctx = canvas.getContext('2d');
    if (!ctx) return dataUrl;
    ctx.drawImage(base, 0, 0);
    const g = HD_BADGE_9X16_GEOMETRY;
    const bw = (W * g.boxW) / g.refW;
    const bh = (bw * badge.naturalHeight) / badge.naturalWidth;
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(badge, (W * g.x) / g.refW, (H * g.y) / g.refH, bw, bh);
    return canvas.toDataURL('image/png');
  } catch {
    return dataUrl;
  }
}
