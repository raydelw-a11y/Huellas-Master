import hdBadgeUrl from '../assets/brand/hd_badge_9x16.png';
import k8BadgeUrl from '../assets/brand/k8_badge_16x9.png';

/**
 * Brand marks stamped on every new thumbnail instead of letting the AI draw them:
 *  - top-left: the official page logo (the one saved in the app, /api/assets/official-logo)
 *  - top-right: "HD" gold badge on 9:16, "8K" gold badge on 16:9 (both cut from the Video 30 thumbnails)
 * Geometry measured on the Video 30 thumbnails (9:16 = 3072×5504, 16:9 = 5504×3072): x, y = top-left corner
 * of the mark, w = its width (height follows the image). The server (save-captured-thumbnail) uses the same numbers.
 */
export const THUMBNAIL_BRAND_GEOMETRY = {
  vertical: {
    refW: 3072,
    refH: 5504,
    logo: { x: 100, y: 110, w: 515 },
    badge: { x: 2550, y: 165, w: 430 },
  },
  horizontal: {
    refW: 5504,
    refH: 3072,
    logo: { x: 205, y: 112, w: 660 },
    badge: { x: 5065, y: 80, w: 370 },
  },
} as const;

/** In the prompt the AI leaves both top corners empty: the marks are added afterwards. */
export const HD_BADGE_EMPTY_CORNER_CLAUSE =
  'the top-right corner left completely clean and empty with no text, no badge and no logo in that corner';
export const LOGO_EMPTY_CORNER_CLAUSE =
  'the top-left corner left completely clean and empty with no text, no emblem and no logo in that corner';

const loadImage = (src: string) =>
  new Promise<HTMLImageElement>((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = reject;
    img.src = src;
  });

let cachedOfficialLogo = '';
async function getOfficialLogoDataUrl(): Promise<string> {
  if (cachedOfficialLogo) return cachedOfficialLogo;
  try {
    const resp = await fetch('/api/assets/official-logo');
    if (resp.ok) {
      const data = await resp.json();
      if (data?.logoDataUrl && String(data.logoDataUrl).startsWith('data:image/')) {
        cachedOfficialLogo = String(data.logoDataUrl);
      }
    }
  } catch {}
  return cachedOfficialLogo;
}

/**
 * Returns the thumbnail with the official logo (top-left) and the HD/8K badge (top-right) stamped on it,
 * or the original image if anything fails. `officialLogoDataUrl` can be passed when the page already has it.
 */
export async function stampBrandMarksOnThumbnail(
  dataUrl: string,
  orientation: 'vertical' | 'horizontal',
  officialLogoDataUrl?: string
): Promise<string> {
  if (!dataUrl || !dataUrl.startsWith('data:image/')) return dataUrl;
  try {
    const g = THUMBNAIL_BRAND_GEOMETRY[orientation];
    const logoSrc =
      officialLogoDataUrl && officialLogoDataUrl.startsWith('data:image/')
        ? officialLogoDataUrl
        : await getOfficialLogoDataUrl();
    const [base, badge, logo] = await Promise.all([
      loadImage(dataUrl),
      loadImage(orientation === 'vertical' ? hdBadgeUrl : k8BadgeUrl),
      logoSrc ? loadImage(logoSrc).catch(() => null) : Promise.resolve(null),
    ]);
    const W = base.naturalWidth;
    const H = base.naturalHeight;
    if (!W || !H) return dataUrl;
    const canvas = document.createElement('canvas');
    canvas.width = W;
    canvas.height = H;
    const ctx = canvas.getContext('2d');
    if (!ctx) return dataUrl;
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(base, 0, 0);
    const place = (
      img: HTMLImageElement | null,
      box: { x: number; y: number; w: number },
      softShadow = false
    ) => {
      if (!img || !img.naturalWidth) return;
      const w = (W * box.w) / g.refW;
      const h = (w * img.naturalHeight) / img.naturalWidth;
      const x = (W * box.x) / g.refW;
      const y = (H * box.y) / g.refH;
      if (softShadow) {
        // Soft dark shadow behind the logo so its text stays readable on light backgrounds (same as the server)
        ctx.save();
        ctx.shadowColor = 'rgba(0, 0, 0, 0.9)';
        ctx.shadowBlur = w * 0.028;
        ctx.drawImage(img, x, y, w, h);
        ctx.drawImage(img, x, y, w, h);
        ctx.restore();
      }
      ctx.drawImage(img, x, y, w, h);
    };
    place(logo, g.logo, true);
    place(badge, g.badge);
    return canvas.toDataURL('image/png');
  } catch {
    return dataUrl;
  }
}
