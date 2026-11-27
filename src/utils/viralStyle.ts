// Viral Clips — the design of a documentary's clips (title and captions): fonts, colours, texture, outline,
// shadow and animations. Each documentary has its own, chosen by Gemini from the documentary's era, place and
// story when the clips are asked for, and every piece can be changed by hand. Shared by the page's preview and
// the Mac's render so both draw the same thing. A documentary without a design keeps the classic look.

export type ViralTexture = 'none' | 'worn' | 'grain' | 'scratched' | 'stone' | 'ink';
export type ViralShadow = 'soft' | 'hard' | 'glow' | 'none';
export type ViralOutline = 'none' | 'thin' | 'thick';
export type ViralTitleAnim = 'fade' | 'words' | 'typewriter' | 'slide' | 'zoom' | 'wipe' | 'blur';
export type ViralCaptionAnim = 'highlight' | 'pop' | 'box' | 'single' | 'underline';

export interface ViralFontDef {
  id: string;
  /** Name shown in the selectors */
  label: string;
  /** Family name libass looks for (the render) and the CSS family the page registers it under */
  ass: string;
  bold?: boolean;
  /** File in data/fonts (absent: a font the system already has) */
  file?: string;
  /** Height of a capital letter ÷ ASS font size, measured with the render's own engine */
  capAss: number;
  /** Average width of a capital ÷ its height, relative to League Gothic (1 = as narrow as League Gothic) */
  widthFactor: number;
  use: 'title' | 'caption' | 'both';
  /** How the title is written: all capitals, or capitals only at the start of words (blackletter, script) */
  titleCase: 'upper' | 'capitalized';
  /** What it suits, for Gemini (English) */
  mood: string;
}

/** League Gothic's capital height ÷ ASS font size: every size of the look is expressed against it */
export const VIRAL_REF_CAP_ASS = 0.5675;
/** Arial Black's capital height ÷ CSS em: the documentary's caption size is given in Arial Black ems */
export const VIRAL_CAPTION_REF_CAP_EM = 0.716;

const F = (
  id: string,
  label: string,
  ass: string,
  file: string | undefined,
  capAss: number,
  wPerCap: number,
  use: ViralFontDef['use'],
  mood: string,
  extra: Partial<ViralFontDef> = {}
): ViralFontDef => ({
  id,
  label,
  ass,
  ...(file ? { file } : {}),
  capAss,
  widthFactor: Number((wPerCap / 0.451).toFixed(3)),
  use,
  titleCase: 'upper',
  mood,
  ...extra,
});

export const VIRAL_FONTS: ViralFontDef[] = [
  F('league_gothic', 'League Gothic', 'League Gothic', 'LeagueGothic.ttf', 0.5675, 0.451, 'both', 'tall condensed film-poster capitals; neutral, works for any era'),
  F('bebas_neue', 'Bebas Neue', 'Bebas Neue', 'BebasNeue-Regular.ttf', 0.54, 0.532, 'both', 'clean modern condensed capitals; 20th-21st century, cities, engineering'),
  F('anton', 'Anton', 'Anton', 'Anton-Regular.ttf', 0.4975, 0.52, 'both', 'very heavy condensed headline; disasters, wars, breaking-news impact'),
  F('cinzel_decorative', 'Cinzel Decorative', 'Cinzel Decorative', 'CinzelDecorative-Bold.ttf', 0.7675, 0.663, 'title', 'Roman inscription capitals with flourishes; Rome, Greece, ancient empires', { bold: true }),
  F('marcellus_sc', 'Marcellus SC', 'Marcellus SC', 'MarcellusSC-Regular.ttf', 0.56, 0.824, 'title', 'elegant classical Roman capitals; antiquity, Renaissance, museums'),
  F('caesar_dressing', 'Caesar Dressing', 'Caesar Dressing', 'CaesarDressing-Regular.ttf', 0.61, 0.648, 'title', 'rough hand-cut Greek/Roman letters; mythology, gladiators, ancient Greece'),
  F('piedra', 'Piedra', 'Piedra', 'Piedra-Regular.ttf', 0.63, 0.643, 'title', 'letters carved in stone; prehistory, Aztec, Maya, Inca and other ancient civilizations'),
  F('uncial_antiqua', 'Uncial Antiqua', 'Uncial Antiqua', 'UncialAntiqua-Regular.ttf', 0.71, 0.787, 'title', 'uncial manuscript; early Middle Ages, monasteries, Celts, Vikings'),
  F('pirata_one', 'Pirata One', 'Pirata One', 'PirataOne-Regular.ttf', 0.625, 0.489, 'title', 'readable blackletter; medieval Europe, castles, plague, crusades', { titleCase: 'capitalized' }),
  F('metamorphous', 'Metamorphous', 'Metamorphous', 'Metamorphous-Regular.ttf', 0.6, 0.945, 'title', 'medieval legend lettering; myths, legends, alchemy'),
  F('almendra', 'Almendra', 'Almendra', 'Almendra-Bold.ttf', 0.5175, 0.831, 'title', 'Spanish calligraphic hand; Spanish Golden Age, conquest, viceroyalties, colonial America', { bold: true, titleCase: 'capitalized' }),
  F('im_fell', 'IM Fell English', 'IM FELL English SC', 'IMFeENsc28P.ttf', 0.5375, 0.942, 'title', 'worn 17th-century printing type; exploration, pirates, 1500s-1700s', { titleCase: 'capitalized' }),
  F('trade_winds', 'Trade Winds', 'Trade Winds', 'TradeWinds-Regular.ttf', 0.5475, 0.855, 'title', 'old sea-chart lettering; navigation, sea voyages, the Caribbean'),
  F('old_standard', 'Old Standard', 'Old Standard TT', 'OldStandard-Bold.ttf', 0.5825, 0.934, 'title', '19th-century scientific book type; science, medicine, inventions of the 1800s', { bold: true }),
  F('abril_fatface', 'Abril Fatface', 'Abril Fatface', 'AbrilFatface-Regular.ttf', 0.52, 0.879, 'title', 'heavy elegant 19th-century headline; press, high society, industrial-era elegance'),
  F('playfair', 'Playfair Display', 'Playfair Display', 'PlayfairDisplay-Bold.ttf', 0.5025, 0.874, 'title', 'editorial serif; political history, biographies', { bold: true }),
  F('yeseva_one', 'Yeseva One', 'Yeseva One', 'YesevaOne-Regular.ttf', 0.505, 0.9, 'title', 'serif with character; royalty, belle époque, biographies'),
  F('rye', 'Rye', 'Rye', 'Rye-Regular.ttf', 0.615, 0.882, 'title', 'Wild West poster; 19th-century America, gold rush, railroads'),
  F('sancreek', 'Sancreek', 'Sancreek', 'Sancreek-Regular.ttf', 0.57, 0.671, 'title', 'ornate tuscan woodtype; circus, fairs, 19th-century shows'),
  F('ultra', 'Ultra', 'Ultra', 'Ultra-Regular.ttf', 0.5625, 1.069, 'title', 'fat slab woodtype; old newspapers, frontier towns'),
  F('alfa_slab', 'Alfa Slab One', 'Alfa Slab One', 'AlfaSlabOne-Regular.ttf', 0.5, 0.924, 'both', 'heavy slab; industry, construction, machines'),
  F('limelight', 'Limelight', 'Limelight', 'Limelight-Regular.ttf', 0.5775, 0.902, 'title', 'art deco marquee; 1920s-30s, skyscrapers, jazz age, old Hollywood'),
  F('righteous', 'Righteous', 'Righteous', 'Righteous-Regular.ttf', 0.5675, 0.834, 'both', 'rounded deco; 1930s-70s design, pop culture'),
  F('kelly_slab', 'Kelly Slab', 'Kelly Slab', 'KellySlab-Regular.ttf', 0.62, 0.753, 'title', 'geometric constructivist slab; revolutions, avant-garde 1910s-30s'),
  F('staatliches', 'Staatliches', 'Staatliches', 'Staatliches-Regular.ttf', 0.5325, 0.581, 'both', 'Bauhaus capitals; modern architecture, design, interwar Europe'),
  F('germania_one', 'Germania One', 'Germania One', 'GermaniaOne-Regular.ttf', 0.615, 0.666, 'title', 'angular German lettering; Prussia, Germany, central Europe'),
  F('ruslan_display', 'Ruslan Display', 'Ruslan Display', 'RuslanDisplay-Regular.ttf', 0.455, 1.281, 'title', 'old Slavic lettering; tsarist Russia, eastern Europe'),
  F('russo_one', 'Russo One', 'Russo One', 'RussoOne-Regular.ttf', 0.5825, 0.912, 'both', 'technical Soviet-style sans; space race, Cold War, technology'),
  F('special_elite', 'Special Elite', 'Special Elite', 'SpecialElite-Regular.ttf', 0.71, 0.821, 'both', 'typewriter; espionage, secret files, 20th-century wars, investigations'),
  F('black_ops', 'Black Ops One', 'Black Ops One', 'BlackOpsOne-Regular.ttf', 0.455, 1.028, 'title', 'military stencil; modern armies, operations, weapons'),
  F('stardos_stencil', 'Stardos Stencil', 'Stardos Stencil', 'StardosStencil-Bold.ttf', 0.505, 0.898, 'title', 'serif stencil on crates; world wars, shipping, expeditions', { bold: true }),
  F('graduate', 'Graduate', 'Graduate', 'Graduate-Regular.ttf', 0.5725, 0.854, 'title', 'college slab; sports, universities, 20th-century USA'),
  F('bowlby_sc', 'Bowlby One SC', 'Bowlby One SC', 'BowlbyOneSC-Regular.ttf', 0.4975, 0.949, 'both', 'thick poster capitals; 1950s-70s, sports, big bold stories'),
  F('fjalla_one', 'Fjalla One', 'Fjalla One', 'FjallaOne-Regular.ttf', 0.5175, 0.546, 'both', 'condensed humanist sans; nature, polar and mountain expeditions'),
  F('archivo_black', 'Archivo Black', 'Archivo Black', 'ArchivoBlack-Regular.ttf', 0.5125, 1.041, 'both', 'heavy grotesque; contemporary topics, science, economy'),
  F('permanent_marker', 'Permanent Marker', 'Permanent Marker', 'PermanentMarker-Regular.ttf', 0.53, 0.834, 'title', 'marker pen; crime, unsolved cases, street stories'),
  F('arial_black', 'Arial Black', 'Arial Black', undefined, 0.51, 1.003, 'caption', 'the classic heavy caption letter', { bold: true }),
  F('poppins_black', 'Poppins Black', 'Poppins Black', 'Poppins-Black.ttf', 0.4025, 0.887, 'caption', 'geometric, modern and friendly'),
  F('barlow_condensed', 'Barlow Condensed', 'Barlow Condensed ExtraBold', 'BarlowCondensed-ExtraBold.ttf', 0.52, 0.627, 'caption', 'condensed, technical, road-sign feel'),
  F('passion_one', 'Passion One', 'Passion One Black', 'PassionOne-Black.ttf', 0.5675, 0.88, 'caption', 'compact and punchy'),
  F('lilita_one', 'Lilita One', 'Lilita One', 'LilitaOne-Regular.ttf', 0.615, 0.796, 'caption', 'soft rounded, warm'),
  F('titan_one', 'Titan One', 'Titan One', 'TitanOne-Regular.ttf', 0.6225, 0.893, 'caption', 'very round and bold, playful'),
  F('paytone_one', 'Paytone One', 'Paytone One', 'PaytoneOne-Regular.ttf', 0.4225, 0.883, 'caption', 'rounded sans, clear'),
  F('changa_one', 'Changa One', 'Changa One', 'ChangaOne-Regular.ttf', 0.5925, 0.888, 'caption', 'squared, strong'),
  F('zilla_slab', 'Zilla Slab', 'Zilla Slab', 'ZillaSlab-Bold.ttf', 0.5425, 0.929, 'caption', 'readable slab serif, bookish', { bold: true }),
];

export const VIRAL_TITLE_FONTS = VIRAL_FONTS.filter((f) => f.use !== 'caption');
export const VIRAL_CAPTION_FONTS = VIRAL_FONTS.filter((f) => f.use !== 'title');
export const viralFontById = (id: string | undefined | null): ViralFontDef =>
  VIRAL_FONTS.find((f) => f.id === id) || VIRAL_FONTS[0];
/** Font files the Mac may serve to the page */
export const VIRAL_FONT_FILES: string[] = VIRAL_FONTS.map((f) => f.file || '').filter(Boolean);

export const VIRAL_TEXTURES: Array<{ id: ViralTexture; label: string; mood: string }> = [
  { id: 'none', label: 'Lisa (sin textura)', mood: 'clean, modern' },
  { id: 'worn', label: 'Gastada (cartel impreso)', mood: 'worn printed poster' },
  { id: 'grain', label: 'Grano de película', mood: 'film grain, old footage' },
  { id: 'scratched', label: 'Rayada (metal, celuloide)', mood: 'scratched metal or film' },
  { id: 'stone', label: 'Piedra picada', mood: 'chipped carved stone, ruins' },
  { id: 'ink', label: 'Tinta desigual (sello, imprenta)', mood: 'uneven ink, stamp, old press' },
];
export const VIRAL_SHADOWS: Array<{ id: ViralShadow; label: string }> = [
  { id: 'soft', label: 'Sombra suave' },
  { id: 'hard', label: 'Sombra dura desplazada' },
  { id: 'glow', label: 'Resplandor de color' },
  { id: 'none', label: 'Sin sombra' },
];
export const VIRAL_OUTLINES: Array<{ id: ViralOutline; label: string }> = [
  { id: 'none', label: 'Sin contorno' },
  { id: 'thin', label: 'Contorno fino' },
  { id: 'thick', label: 'Contorno grueso' },
];
export const VIRAL_TITLE_ANIMS: Array<{ id: ViralTitleAnim; label: string; mood: string }> = [
  { id: 'fade', label: 'Aparece entero', mood: 'the whole title fades in; calm, solemn' },
  { id: 'words', label: 'Palabra a palabra', mood: 'words fade in one after another; narrative' },
  { id: 'typewriter', label: 'Máquina de escribir', mood: 'words typed in sharply one by one; files, investigation' },
  { id: 'slide', label: 'Desliza desde un lado', mood: 'words slide in from the side; movement, journeys' },
  { id: 'zoom', label: 'Zoom con golpe', mood: 'each word lands with a punch; impact, war, disaster' },
  { id: 'wipe', label: 'Revelado con barrido', mood: 'each word is revealed left to right; discovery, mystery' },
  { id: 'blur', label: 'De desenfocado a nítido', mood: 'words come into focus; memory, dream, the distant past' },
];
export const VIRAL_CAPTION_ANIMS: Array<{ id: ViralCaptionAnim; label: string; mood: string }> = [
  { id: 'highlight', label: 'Resalta la palabra', mood: 'the spoken word changes colour' },
  { id: 'pop', label: 'La palabra salta', mood: 'the spoken word pops bigger' },
  { id: 'box', label: 'Caja de color', mood: 'the spoken word sits on a colour block' },
  { id: 'single', label: 'Una palabra cada vez', mood: 'only the spoken word on screen, large' },
  { id: 'underline', label: 'Subrayado que avanza', mood: 'an underline follows the spoken word' },
];

export interface ViralDocStyle {
  titleFont: string;
  captionFont: string;
  /** Most of the title, and its last line (hex #RRGGBB) */
  titleColor: string;
  titleAccentColor: string;
  /** Captions, and the word being said */
  captionColor: string;
  captionActiveColor: string;
  texture: ViralTexture;
  /** 0–100 */
  textureAmount: number;
  outline: ViralOutline;
  shadow: ViralShadow;
  titleAnimation: ViralTitleAnim;
  captionAnimation: ViralCaptionAnim;
  /** Who chose it and why (Gemini's own words) */
  source?: 'gemini' | 'manual';
  reason?: string;
}

/**
 * What a documentary's clips look like while it has no design of its own: plain white letters, no texture, no
 * colour accents. Every other look (the first one, of Video 30, included) is a design chosen for a documentary.
 */
export const VIRAL_PLAIN_STYLE: ViralDocStyle = {
  titleFont: 'bebas_neue',
  captionFont: 'arial_black',
  titleColor: '#FFFFFF',
  titleAccentColor: '#FFFFFF',
  captionColor: '#FFFFFF',
  captionActiveColor: '#FFFFFF',
  texture: 'none',
  textureAmount: 0,
  outline: 'thin',
  shadow: 'soft',
  titleAnimation: 'fade',
  captionAnimation: 'pop',
};

/** The first design (Video 30's): poster letters in bone white and gold, yellow captions */
export const VIRAL_CLASSIC_STYLE: ViralDocStyle = {
  titleFont: 'league_gothic',
  captionFont: 'arial_black',
  titleColor: '#EFE7D6',
  titleAccentColor: '#E3AA3C',
  captionColor: '#FFE600',
  captionActiveColor: '#FFFFFF',
  texture: 'worn',
  textureAmount: 50,
  outline: 'none',
  shadow: 'soft',
  titleAnimation: 'fade',
  captionAnimation: 'highlight',
};

// --- Colours ---------------------------------------------------------------------------------------------

export function parseViralHex(raw: unknown): [number, number, number] | null {
  const m = /^#?([0-9a-f]{6}|[0-9a-f]{3})$/i.exec(String(raw || '').trim());
  if (!m) return null;
  const h = m[1].length === 3 ? [...m[1]].map((c) => c + c).join('') : m[1];
  return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)];
}
const toHex = (rgb: [number, number, number]) =>
  `#${rgb.map((v) => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, '0')).join('')}`.toUpperCase();
/** Relative luminance, 0 (black) – 1 (white) */
export function viralLuminance(hex: string): number {
  const rgb = parseViralHex(hex) || [255, 255, 255];
  const lin = rgb.map((v) => {
    const c = v / 255;
    return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
  });
  return 0.2126 * lin[0] + 0.7152 * lin[1] + 0.0722 * lin[2];
}
/** The colour, lightened just enough to read over video with a dark edge around it */
function readableOverVideo(hex: string, minLum: number): string {
  let rgb = parseViralHex(hex);
  if (!rgb) return '#FFFFFF';
  for (let i = 0; i < 12 && viralLuminance(toHex(rgb)) < minLum; i++) {
    rgb = rgb.map((v) => v + (255 - v) * 0.18) as [number, number, number];
  }
  return toHex(rgb);
}
const contrast = (a: string, b: string) => {
  const la = viralLuminance(a);
  const lb = viralLuminance(b);
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
};
/** Two colours a viewer tells apart at a glance: by brightness or by hue (yellow and white count). */
const colorsDiffer = (a: string, b: string): boolean => {
  const ra = parseViralHex(a) || [0, 0, 0];
  const rb = parseViralHex(b) || [0, 0, 0];
  const dist = Math.sqrt(ra.reduce((acc, v, i) => acc + (v - rb[i]) * (v - rb[i]), 0));
  return contrast(a, b) >= 1.3 || dist >= 80;
};
/** ASS colour (&HBBGGRR&) of a hex colour */
export function viralHexToAss(hex: string): string {
  const [r, g, b] = parseViralHex(hex) || [255, 255, 255];
  const h = (v: number) => v.toString(16).padStart(2, '0').toUpperCase();
  return `&H00${h(b)}${h(g)}${h(r)}&`;
}
/** Dark or light ink that reads on top of the colour (for the caption "box") */
export const viralInkOn = (hex: string): string => (viralLuminance(hex) > 0.4 ? '#101010' : '#FFFFFF');

// --- Reading a design (Gemini's answer, a saved one, or the selectors) ---------------------------------------

const pick = <T extends string>(raw: unknown, allowed: readonly T[], fallback: T): T => {
  const v = String(raw || '')
    .trim()
    .toLowerCase()
    .replace(/[\s-]+/g, '_') as T;
  return allowed.includes(v) ? v : fallback;
};

/** A complete, valid design from whatever was given (null when nothing usable was given). */
export function normalizeViralStyle(raw: any): ViralDocStyle | null {
  if (!raw || typeof raw !== 'object') return null;
  const C = VIRAL_CLASSIC_STYLE;
  const fontId = (v: unknown, list: ViralFontDef[], fallback: string) => {
    const want = String(v || '')
      .trim()
      .toLowerCase()
      .replace(/[\s-]+/g, '_');
    const hit = list.find((f) => f.id === want || f.label.toLowerCase().replace(/[\s-]+/g, '_') === want);
    return hit ? hit.id : fallback;
  };
  const amountRaw = Number(raw.textureAmount);
  const style: ViralDocStyle = {
    titleFont: fontId(raw.titleFont, VIRAL_TITLE_FONTS, C.titleFont),
    captionFont: fontId(raw.captionFont, VIRAL_CAPTION_FONTS, C.captionFont),
    // Strong reds and blues are kept (they read with the dark edge); only really dark tones are lightened
    titleColor: readableOverVideo(parseViralHex(raw.titleColor) ? raw.titleColor : C.titleColor, 0.12),
    titleAccentColor: readableOverVideo(parseViralHex(raw.titleAccentColor) ? raw.titleAccentColor : C.titleAccentColor, 0.12),
    captionColor: readableOverVideo(parseViralHex(raw.captionColor) ? raw.captionColor : C.captionColor, 0.3),
    captionActiveColor: readableOverVideo(parseViralHex(raw.captionActiveColor) ? raw.captionActiveColor : C.captionActiveColor, 0.18),
    texture: pick(raw.texture, VIRAL_TEXTURES.map((t) => t.id), C.texture),
    textureAmount: Number.isFinite(amountRaw) ? Math.max(0, Math.min(100, Math.round(amountRaw <= 1 && amountRaw > 0 ? amountRaw * 100 : amountRaw))) : C.textureAmount,
    outline: pick(raw.outline, VIRAL_OUTLINES.map((o) => o.id), C.outline),
    shadow: pick(raw.shadow, VIRAL_SHADOWS.map((s) => s.id), C.shadow),
    titleAnimation: pick(raw.titleAnimation, VIRAL_TITLE_ANIMS.map((a) => a.id), C.titleAnimation),
    captionAnimation: pick(raw.captionAnimation, VIRAL_CAPTION_ANIMS.map((a) => a.id), C.captionAnimation),
    source: raw.source === 'gemini' ? 'gemini' : 'manual',
    reason: String(raw.reason || '').replace(/\s+/g, ' ').trim().slice(0, 400),
  };
  // Letters with no edge at all cannot be read over a bright picture
  if (style.shadow === 'none' && style.outline === 'none') style.outline = 'thin';
  // The spoken word must stand out from the rest of the caption
  // (only where the colour is what marks it: with the other animations both may be the same)
  const colourMarksWord = style.captionAnimation === 'highlight' || style.captionAnimation === 'box';
  if (colourMarksWord && !colorsDiffer(style.captionColor, style.captionActiveColor)) {
    style.captionActiveColor = colorsDiffer(style.captionColor, '#FFFFFF') ? '#FFFFFF' : style.titleAccentColor;
    if (!colorsDiffer(style.captionColor, style.captionActiveColor)) style.captionActiveColor = '#FFE600';
  }
  return style;
}

/** What makes two designs the same combination (colours rounded, so near-identical tones count as equal). */
export function viralStyleSignature(style: ViralDocStyle): string {
  const q = (hex: string) => (parseViralHex(hex) || [0, 0, 0]).map((v) => Math.round(v / 32)).join('.');
  return [
    style.titleFont,
    style.captionFont,
    q(style.titleColor),
    q(style.titleAccentColor),
    q(style.captionColor),
    q(style.captionActiveColor),
    style.texture,
    style.outline,
    style.shadow,
    style.titleAnimation,
    style.captionAnimation,
  ].join('|');
}

/** The design, changed just enough (its animations) not to repeat a combination another documentary has. */
export function makeViralStyleUnique(style: ViralDocStyle, usedSignatures: string[]): { style: ViralDocStyle; changed: boolean } {
  const used = new Set(usedSignatures);
  if (!used.has(viralStyleSignature(style))) return { style, changed: false };
  for (const ca of VIRAL_CAPTION_ANIMS) {
    for (const ta of VIRAL_TITLE_ANIMS) {
      const candidate = { ...style, titleAnimation: ta.id, captionAnimation: ca.id };
      if (!used.has(viralStyleSignature(candidate))) return { style: candidate, changed: true };
    }
  }
  return { style, changed: false };
}

/** One-line summary of a design, for Gemini's list of combinations already taken. */
export function describeViralStyle(style: ViralDocStyle): string {
  return `titleFont=${style.titleFont}, captionFont=${style.captionFont}, titleColor=${style.titleColor}, titleAccentColor=${style.titleAccentColor}, captionColor=${style.captionColor}, captionActiveColor=${style.captionActiveColor}, texture=${style.texture}, outline=${style.outline}, shadow=${style.shadow}, titleAnimation=${style.titleAnimation}, captionAnimation=${style.captionAnimation}`;
}

/**
 * The part of Gemini's order that asks for the documentary's design (English, like the rest of the order).
 * `usedByOthers` are the combinations other documentaries already have.
 */
export function buildViralStyleRequest(usedByOthers: Array<{ title: string; style: ViralDocStyle }>): string {
  const list = (items: Array<{ id: string; mood: string }>) => items.map((i) => `${i.id} (${i.mood})`).join('; ');
  const used = usedByOthers.length
    ? ` The complete combination must NOT repeat any of these, already used by other documentaries (single values may repeat, the whole combination may not): ${usedByOthers
        .slice(0, 30)
        .map((u) => `[${u.title}: ${describeViralStyle(u.style)}]`)
        .join(' ')}.`
    : '';
  return (
    ` ON-SCREEN DESIGN: also return a top-level "style" object with the design shared by ALL the clips of this documentary (the big on-screen title and the captions). Choose every value from THIS documentary's era, place, story and mood, so the design belongs to this documentary and to no other (for example: letters carved in stone with jade and obsidian tones for the Aztec world, blackletter with parchment and blood-red tones for medieval Europe, art-deco letters with brass and midnight-blue tones for 1930s New York).` +
    ` Use ONLY these ids. "titleFont", one of: ${list(VIRAL_TITLE_FONTS)}.` +
    ` "captionFont", one of: ${list(VIRAL_CAPTION_FONTS)}.` +
    ` "texture" of the title letters, one of: ${list(VIRAL_TEXTURES)}; "textureAmount" from 0 to 100.` +
    ` "outline": none, thin or thick (a dark edge around the title letters). "shadow": soft, hard, glow or none.` +
    ` "titleAnimation", how the title comes in, one of: ${list(VIRAL_TITLE_ANIMS)}.` +
    ` "captionAnimation", one of: ${list(VIRAL_CAPTION_ANIMS)}.` +
    ` Colours are free "#RRGGBB" values taken from the documentary's own world (its materials, landscape, flags, art): "titleColor" (most of the title), "titleAccentColor" (the title's last line; it must clearly differ from titleColor), "captionColor" (the captions) and "captionActiveColor" (the word being spoken; it must clearly differ from captionColor). The caption colours must match the title's palette. All four are shown over moving video with a dark edge, so they must be light or strongly saturated, never dark or greyish.` +
    ` "reason": one sentence in Neutral Spanish saying why this design fits this documentary.` +
    used +
    ` Shape: "style":{"titleFont":"...","captionFont":"...","titleColor":"#RRGGBB","titleAccentColor":"#RRGGBB","captionColor":"#RRGGBB","captionActiveColor":"#RRGGBB","texture":"...","textureAmount":50,"outline":"...","shadow":"...","titleAnimation":"...","captionAnimation":"...","reason":"..."}.`
  );
}

// --- Title text in a font ----------------------------------------------------------------------------------

const SMALL_WORDS = new Set(['de', 'del', 'la', 'las', 'el', 'los', 'y', 'e', 'o', 'u', 'a', 'al', 'en', 'que', 'un', 'una', 'por', 'con', 'se', 'su', 'sus', 'lo', 'para', 'sin']);
/** The title's text as the font wants it: all capitals, or capitals at the start of the main words. */
export function applyViralTitleCase(text: string, mode: ViralFontDef['titleCase'], isFirstWord = false): string {
  const t = String(text || '');
  if (mode !== 'capitalized') return t.toUpperCase();
  const lower = t.toLowerCase();
  const bare = lower.replace(/[^a-záéíóúñü]/g, '');
  if (bare === 'youtube') return lower.replace('youtube', 'YouTube');
  if (!isFirstWord && SMALL_WORDS.has(bare)) return lower;
  return lower.replace(/[a-záéíóúñü]/, (c) => c.toUpperCase());
}
/** A whole line ("white part|accent part" keeps its mark), word by word. `startsTitle`: it is the first line. */
export function applyViralTitleCaseToLine(line: string, mode: ViralFontDef['titleCase'], startsTitle: boolean): string {
  if (mode !== 'capitalized') return String(line || '').toUpperCase();
  let first = startsTitle;
  let afterColon = false;
  return String(line || '')
    .split(/(\s+|\|)/)
    .map((tok) => {
      if (!tok || /^\s+$/.test(tok) || tok === '|') return tok;
      const out = applyViralTitleCase(tok, mode, first || afterColon);
      first = false;
      afterColon = /[:.?!]$/.test(tok);
      return out;
    })
    .join('');
}

/** One word of the title as it is drawn: its text in the font's case, and whether it takes the accent colour. */
export interface ViralTitleWordDraw {
  text: string;
  accent: boolean;
}
/**
 * The title's lines word by word, as the render draws them: "main part|accent part" on one line, otherwise a
 * line is in the main colour, or in the accent colour when it is the last one; each word in the font's case.
 */
export function viralTitleWordLines(rawLines: string[], mode: ViralFontDef['titleCase']): ViralTitleWordDraw[][] {
  const lines = rawLines.map((l) => String(l || '').trim()).filter(Boolean);
  let isFirstWord = true;
  let afterStop = false;
  const cased = (text: string) => {
    const out = mode === 'capitalized' ? applyViralTitleCase(text, mode, isFirstWord || afterStop) : text;
    isFirstWord = false;
    afterStop = /[:.?!]$/.test(text);
    return out;
  };
  return lines
    .map((line, i) => {
      const toWords = (part: string, accent: boolean) =>
        part
          .split(/\s+/)
          .filter(Boolean)
          .map((text) => ({ text: cased(text), accent }));
      if (line.includes('|')) {
        const [mainPart, accentPart] = line.split('|');
        return [...toWords(mainPart, false), ...toWords(accentPart || '', true)];
      }
      return toWords(line, i === lines.length - 1);
    })
    .filter((l) => l.length > 0);
}

/** Sizes of the title look for a font: an ASS font size `fontSize` drawn in it, as League Gothic units. */
export function viralTitleUnit(font: ViralFontDef, fontSize: number): number {
  return (fontSize * font.capAss) / VIRAL_REF_CAP_ASS;
}
/** Largest ASS font size of the font whose capitals are as tall as League Gothic's at `refFontSize`. */
export function viralMaxFontSizeFor(font: ViralFontDef, refFontSize: number): number {
  return (refFontSize * VIRAL_REF_CAP_ASS) / font.capAss;
}
/**
 * Distance between the title's lines next to the classic one (1): fonts written with real lower-case letters
 * need room for the strokes that go above and below the line.
 */
export function viralTitleLineStepFactor(font: ViralFontDef): number {
  return font.titleCase === 'capitalized' && font.id !== 'im_fell' ? 1.16 : 1;
}

/** What the title's height estimate needs to know about a font (see estimateViralBigTitleHeightFrac). */
export function viralTitleFontMetrics(font: ViralFontDef): { widthFactor: number; capAss: number; lineStepFactor: number } {
  return { widthFactor: font.widthFactor, capAss: font.capAss, lineStepFactor: viralTitleLineStepFactor(font) };
}

// --- Captions ------------------------------------------------------------------------------------------------

/**
 * Size of the captions' capitals next to the classic ones (1): narrow fonts are drawn a little taller so they
 * weigh the same on screen, and "one word at a time" is larger.
 */
export function viralCaptionSizeFactor(font: ViralFontDef, anim: ViralCaptionAnim): number {
  return (font.widthFactor < 1.45 ? 1.15 : 1) * (anim === 'single' ? 1.3 : 1);
}
/** "box": padding of the colour block around the spoken word, in capital heights */
export const VIRAL_CAPTION_BOX_PAD_CAPS = 0.37;

// --- How the title comes in ----------------------------------------------------------------------------------

/** When word `k` of `wordCount` starts to come in and how long it takes (seconds from the clip's start). */
export function viralTitleEntrance(anim: ViralTitleAnim, k: number, wordCount: number): { startSec: number; durSec: number } {
  const n = Math.max(1, wordCount);
  const each = (maxStep: number, wholeSec: number, durSec: number) => ({
    startSec: Number((k * Math.min(maxStep, wholeSec / n)).toFixed(3)),
    durSec,
  });
  switch (anim) {
    case 'words':
      return each(0.13, 1.4, 0.22);
    case 'typewriter':
      return each(0.15, 1.6, 0.04);
    case 'slide':
      return each(0.09, 1.2, 0.45);
    case 'zoom':
      return each(0.11, 1.3, 0.26);
    case 'wipe':
      return each(0.1, 1.3, 0.36);
    case 'blur':
      return each(0.1, 1.3, 0.55);
    default:
      return { startSec: 0, durSec: 0.25 };
  }
}
/** "slide": how far to the left a word starts, as a fraction of the frame width */
export const VIRAL_TITLE_SLIDE_FRAC = 0.2;
/** "zoom": how much bigger a word starts (1.7 = 70% bigger) */
export const VIRAL_TITLE_ZOOM_FROM = 1.7;
/** "blur": blur radius at the start, in title units (League Gothic font sizes) */
export const VIRAL_TITLE_BLUR_UNITS = 0.045;

/**
 * How word `k` looks at clip second `t` while it comes in: opacity, sideways shift (fraction of the frame
 * width), size, the share of the word already revealed from the left, and blur (title units).
 * The page draws exactly this; the render's filters follow the same curves.
 */
export function viralTitleEntranceState(
  anim: ViralTitleAnim,
  k: number,
  wordCount: number,
  t: number
): { opacity: number; shiftFrac: number; scale: number; reveal: number; blurUnits: number } {
  const { startSec, durSec } = viralTitleEntrance(anim, k, wordCount);
  const p = Math.max(0, Math.min(1, (t - startSec) / Math.max(0.001, durSec)));
  const rest = { opacity: 1, shiftFrac: 0, scale: 1, reveal: 1, blurUnits: 0 };
  if (t < startSec) return { ...rest, opacity: 0 };
  if (p >= 1) return rest;
  const fadeOver = (sec: number) => Math.max(0, Math.min(1, (t - startSec) / sec));
  switch (anim) {
    case 'slide':
      return { ...rest, opacity: fadeOver(0.2), shiftFrac: -VIRAL_TITLE_SLIDE_FRAC * Math.pow(1 - p, 3) };
    case 'zoom':
      return { ...rest, opacity: fadeOver(0.1), scale: 1 + (VIRAL_TITLE_ZOOM_FROM - 1) * (1 - p * p) };
    case 'wipe':
      return { ...rest, reveal: p };
    case 'blur':
      return { ...rest, opacity: fadeOver(0.2), blurUnits: VIRAL_TITLE_BLUR_UNITS * (1 - p) };
    default:
      return { ...rest, opacity: p };
  }
}
