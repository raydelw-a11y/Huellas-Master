// Cinematography catalogue, historical support shots and era-appropriate archival media for the
// Stage 8 clip prompts. The page fixes the quotas and checks them afterwards; Gemini decides which
// scene gets each resource, because only Gemini reads the narration.

/** Historical support shot types (a clip with camera movement only; nothing inside the frame moves). */
export const SUPPORT_SHOT_TYPES = [
  'MAP',
  'SCALE_MODEL',
  'INK_DRAWING',
  'DOCUMENT',
  'MUSEUM_OBJECT',
  'ROUTE_MAP',
  'ARCHITECTURAL_SECTION',
  'PERIOD_ARTWORK',
  'WALL_SHADOWS',
  'REFLECTION',
] as const;
export type SupportShotType = (typeof SUPPORT_SHOT_TYPES)[number];

const SUPPORT_SHOT_DESCRIPTIONS: Record<SupportShotType, string> = {
  MAP: 'an antique map or atlas page of the place being narrated',
  SCALE_MODEL: 'a hand-built architectural or tactical scale model (diorama) of the building, city or battlefield',
  INK_DRAWING: 'a black-and-white ink, charcoal or engraved drawing on paper',
  DOCUMENT: 'a period letter, decree, ledger or open book on a desk by candlelight',
  MUSEUM_OBJECT: 'one single period artifact (crown, seal, weapon, coin, tool) isolated on a dark background',
  ROUTE_MAP: 'an antique map with a hand-inked route line drawn across it',
  ARCHITECTURAL_SECTION: 'a hand-drawn cutaway section or construction plan of the building',
  PERIOD_ARTWORK: 'the scene told in an artwork of its own era (tapestry, stained glass, fresco or mosaic)',
  WALL_SHADOWS: 'silhouettes cast by firelight on a stone wall',
  REFLECTION: 'the place seen as a still reflection in water, polished metal or a mirror',
};

export const MAX_SUPPORT_SHOTS_PER_DOC = 5;
export const SUPPORT_SHOT_INTERVAL_SEC = 180;
export const SUPPORT_SHOT_MIN_GAP_FROM_BROLL = 3;

/** One support shot every 3 minutes of documentary, never more than 5. */
export function getSupportShotQuota(totalDocSec: number): number {
  if (!Number.isFinite(totalDocSec) || totalDocSec < SUPPORT_SHOT_INTERVAL_SEC) return 0;
  return Math.min(MAX_SUPPORT_SHOTS_PER_DOC, Math.floor(totalDocSec / SUPPORT_SHOT_INTERVAL_SEC));
}

/** Archival image medium that existed in each period (avoids anachronisms such as a photograph in 1250). */
export const ARCHIVE_MEDIA_BY_ERA: Array<{
  from: number;
  to: number;
  key: string;
  label: string;
  english: string;
}> = [
  {
    from: -100000,
    to: 499,
    key: 'ANCIENT_ART',
    label: 'Relieve, mosaico o pintura mural',
    english: 'a carved stone relief, mosaic, wall painting or painted pottery',
  },
  {
    from: 500,
    to: 1449,
    key: 'MANUSCRIPT_MINIATURE',
    label: 'Miniatura de manuscrito, tapiz o vitral',
    english:
      'a full-page illuminated manuscript miniature in tempera and gold leaf on vellum whose painted scene and decorative border fill the whole page, a woven tapestry or a stained-glass panel',
  },
  {
    from: 1450,
    to: 1599,
    key: 'WOODCUT',
    label: 'Xilografía o dibujo a pluma',
    english: 'a woodcut print with bold carved black lines on aged laid paper with plain unlettered margins, or a pen drawing',
  },
  {
    from: 1600,
    to: 1799,
    key: 'COPPER_ENGRAVING',
    label: 'Grabado en cobre o aguafuerte',
    english: 'a copperplate engraving or etching with fine cross-hatched lines and plain unlettered margins, or an ink-and-wash drawing',
  },
  {
    from: 1800,
    to: 1839,
    key: 'LITHOGRAPH',
    label: 'Litografía o acuarela',
    english: 'a lithograph with soft crayon-like grey tones and plain unlettered margins, or a watercolour',
  },
  {
    from: 1840,
    to: 1859,
    key: 'DAGUERREOTYPE',
    label: 'Daguerrotipo',
    english: 'a daguerreotype on a silvered plate with a mirror-like surface and dark tarnished edges',
  },
  {
    from: 1860,
    to: 1899,
    key: 'ALBUMEN_PHOTO',
    label: 'Fotografía en albúmina (sepia)',
    english: 'a warm sepia albumen print photograph mounted on a plain unlettered card with worn corners',
  },
  {
    from: 1900,
    to: 1949,
    key: 'BW_PHOTO',
    label: 'Fotografía en blanco y negro',
    english: 'a black-and-white press photograph with visible film grain',
  },
  {
    from: 1950,
    to: 100000,
    key: 'LATE_PHOTO',
    label: 'Fotografía tardía',
    english: 'a late black-and-white or faded colour photograph',
  },
];

export function getArchiveMediumForYear(year: number) {
  return ARCHIVE_MEDIA_BY_ERA.find((m) => year >= m.from && year <= m.to) || null;
}

/** Rules appended to the Stage 8 request. `brollSceneNumbers` are the rows the page already marked as static B-roll. */
export function buildShotDirectionClause(opts: {
  totalDocSec: number;
  expectedTotalClips: number;
  brollSceneNumbers: number[];
}): string {
  const quota = getSupportShotQuota(opts.totalDocSec);
  const hasBroll = opts.brollSceneNumbers.length > 0;
  const eraTable = ARCHIVE_MEDIA_BY_ERA.map((m) => {
    const range =
      m.from < 0 ? `before ${m.to + 1}` : m.to > 9000 ? `${m.from} onward` : `${m.from}-${m.to}`;
    return `${range}: ${m.english} [Archive: ${m.key}]`;
  }).join('; ');

  const catalogue = `
- CINEMATOGRAPHY CATALOGUE (VARY IT ACROSS THE WHOLE DOCUMENTARY): Open every Clip NN description, right after "showing", with the shot size and the single camera movement, then the subject and its one action. Choose from: SHOT SIZES extreme wide shot, wide establishing shot, full ensemble shot, medium shot, cowboy shot, close-up, extreme close-up, insert shot of hands at work; ANGLES eye-level, low angle, high angle, overhead top-down, ground-level, aerial bird's-eye view, over-the-shoulder, point-of-view of a witness, shot through a doorway, grille or window, backlit silhouette; CAMERA MOVEMENTS slow dolly-in, slow dolly-out reveal, lateral tracking shot, crane up, crane down, slow pan, slow tilt, following shot from behind, slow orbit, handheld immersive, static locked-off tripod shot, parallax past a foreground object. Never use the same shot size, the same angle or the same camera movement in two consecutive scenes, and do not let any single camera movement exceed one quarter of all clips. Use the slow orbit and the dolly-out reveal sparingly (at most once every 15 clips each). Never use a dolly zoom, a camera roll, a whip pan or a rack focus.
- OPTICS IN IMAGE NN ONLY (the clip inherits them from its starting image): add exactly ONE short lens phrase, written as the phrase alone and never with its reason. Allowed phrases: "wide-angle lens" (architecture and landscapes), "35mm lens" or "50mm lens" (scenes with people), "85mm portrait lens, shallow depth of field" (one face), "telephoto lens" (crowds and distant ranks), "macro lens" (textures such as ink, cloth or metal), "deep focus" (when the setting matters as much as the subject). The words in parentheses are guidance for you and must NOT be copied into the prompt. Never name a camera brand or model.
- ONE OR TWO SHOTS PER CLIP (DECIDE SCENE BY SCENE FROM THE NARRATION): By default a Clip NN is ONE continuous shot. Write a TWO-SHOT clip only when that row's narration clearly holds two distinct beats — it moves to another place, another subject or another moment, or a [pausa] splits the row into two ideas — so that a single shot cannot honestly cover both. Decide it by the scene and the narration, never for variety or to reach a quota. Clip 01, every row marked ★ (Static B-Roll) and every historical support shot are ALWAYS one shot. Format of a two-shot clip: right after "showing" write "first shot, [shot size + one camera movement + subject + its one action], then a hard cut to a second shot, [a DIFFERENT shot size and camera movement + subject + its one action]", each shot filling about half of the clip. The first shot starts exactly on Image NN; the second shot has no starting image, so describe it fully in words (subject age, anonymous role, period attire, setting) and keep it in the same year and wardrobe. Add the tag "[Shots: 2]" immediately before "[Duration:", and in that clip replace the closing words "single continuous shot, strictly no shot changes" with "exactly two shots joined by one hard cut, each shot one continuous take". One-shot clips keep "single continuous shot, strictly no shot changes" and carry no tag.
- DESCRIBE WHAT IS THERE, NOT WHAT IS MISSING: inside the scene description prefer positive wording ("an empty stone hall", "a deserted quay at dawn") over lists of exclusions. Keep every mandatory closing phrase and safety phrase of this stage exactly as specified.`;

  const support =
    quota > 0
      ? `
- HISTORICAL SUPPORT SHOTS (EXACTLY ${quota} IN THIS DOCUMENTARY, NEVER MORE): Choose exactly ${quota} scene${
          quota === 1 ? '' : 's'
        } whose narration is best served by a support shot, spread evenly from the beginning to the end of the documentary (roughly one every 3 minutes), each of a DIFFERENT type, never two in consecutive scenes${
          hasBroll
            ? `, and each at least ${SUPPORT_SHOT_MIN_GAP_FROM_BROLL} scenes away from every row marked ★ (Static B-Roll scenes: ${opts.brollSceneNumbers.join(
                ', '
              )})`
            : ''
        }. Never choose Clip 01, the slogan scene or the final scene. Types: ${SUPPORT_SHOT_TYPES.map(
          (t) => `${t} (${SUPPORT_SHOT_DESCRIPTIONS[t]})`
        ).join('; ')}. A support shot is a normal Image NN + Clip NN pair with zero people. Its Clip NN is camera movement ONLY: write "a static, locked-off scene in which nothing inside the frame moves" plus ONE slow camera movement (slow dolly-in, slow pan, slow tilt or slow dolly-out), and use [Model: Veo 3.1 - Lite [Lower Priority]]. In BOTH its Image NN and its Clip NN write the tags "[Support: TYPE] [Era: YYYY]" immediately before "[Duration:" (for Image NN, immediately before "fix the name"), where YYYY is the approximate year narrated in that scene (negative for BC). Every map, drawing, document or artwork in a support shot must be of a medium that already existed in that year, with plain unlettered margins.`
      : '';

  const archive = hasBroll
    ? `
- ONE PERIOD ARCHIVAL IMAGE PER DOCUMENTARY (EXACTLY ONE): Choose exactly ONE of the rows marked ★ — the one whose narration suits it best — and design its Static B-Roll plate as an archival image made in the medium that existed in the year narrated IN THAT SCENE (decide by the scene, not by the documentary as a whole): ${eraTable}. Add the tags "[Archive: KEY] [Era: YYYY]" immediately before "[Time:" in that Image NN. Never use a photograph of any kind for a scene narrated before 1840. The archival image is picture only: plain unlettered margins and mount, the image area filled by the scene itself (tested in Nano Banana: when margins are left undescribed it invents captions, dates and lines of script). All the other ★ rows stay regular Static B-Roll plates without an [Archive:] tag.`
    : '';

  return `${catalogue}${support}${archive}`;
}

export interface ShotPlanClipLike {
  clipNumber: number;
  imagePrompt?: string;
  videoPrompt?: string;
  isStaticBroll?: boolean;
}

/**
 * The page's prompt parser rewrites every prompt and drops unknown tags, so the support / archive / era
 * tags are read from Gemini's raw answer, scene by scene, before that happens.
 */
export function extractShotPlanTextByScene(rawText: string): Map<number, string> {
  const byScene = new Map<number, string>();
  const re = /^\s*(?:\*\*)?(?:Image|Clip)\s+0*(\d{1,3})\b/gim;
  const marks: Array<{ num: number; idx: number }> = [];
  let m: RegExpExecArray | null;
  while ((m = re.exec(rawText || ''))) marks.push({ num: Number(m[1]), idx: m.index });
  marks.forEach((mk, i) => {
    const chunk = rawText.slice(mk.idx, i + 1 < marks.length ? marks[i + 1].idx : rawText.length);
    byScene.set(mk.num, `${byScene.get(mk.num) || ''} ${chunk}`);
  });
  return byScene;
}

/** true when a clip prompt (raw from Gemini or already cleaned by the page) is a two-shot clip. */
export function isTwoShotClipText(text: string | undefined | null): boolean {
  const t = String(text || '');
  return (
    /\[Shots:\s*2\s*\]/i.test(t) ||
    /\bthen\s+a\s+hard\s+cut\s+to\s+a\s+second\s+shot\b/i.test(t) ||
    /\bexactly\s+two\s+shots\s+joined\s+by\s+one\b/i.test(t)
  );
}

/** Counts what Gemini actually delivered and returns one Spanish warning per broken rule. */
export function auditShotPlan(
  clips: ShotPlanClipLike[],
  opts: { totalDocSec: number; rawText?: string }
): {
  supportCount: number;
  archiveCount: number;
  quota: number;
  warnings: string[];
  twoShotCount: number;
  twoShotClips: number[];
} {
  const rawByScene = extractShotPlanTextByScene(opts.rawText || '');
  const warnings: string[] = [];
  const quota = getSupportShotQuota(opts.totalDocSec);
  const sorted = [...clips].sort((a, b) => a.clipNumber - b.clipNumber);
  const textOf = (c: ShotPlanClipLike) =>
    `${rawByScene.get(c.clipNumber) || ''} ${c.imagePrompt || ''} ${c.videoPrompt || ''}`;
  const eraOf = (txt: string): number | null => {
    const m = txt.match(/\[Era:\s*(-?\d{1,5})\s*\]/i);
    return m ? Number(m[1]) : null;
  };
  const brollNums = sorted.filter((c) => c.isStaticBroll).map((c) => c.clipNumber);

  const support = sorted
    .map((c) => {
      const m = textOf(c).match(/\[Support:\s*([A-Z_]+)\s*\]/i);
      return m ? { num: c.clipNumber, type: m[1].toUpperCase(), era: eraOf(textOf(c)), clip: c } : null;
    })
    .filter((s): s is NonNullable<typeof s> => Boolean(s));
  const archive = sorted
    .map((c) => {
      const m = textOf(c).match(/\[Archive:\s*([A-Z_]+)\s*\]/i);
      return m ? { num: c.clipNumber, key: m[1].toUpperCase(), era: eraOf(textOf(c)) } : null;
    })
    .filter((s): s is NonNullable<typeof s> => Boolean(s));

  if (quota > 0 && support.length !== quota) {
    warnings.push(
      `Tomas de apoyo: se pidieron ${quota} y llegaron ${support.length}${
        support.length ? ` (clips ${support.map((s) => s.num).join(', ')})` : ''
      }.`
    );
  }
  const seenTypes = new Map<string, number>();
  for (const s of support) {
    if (seenTypes.has(s.type)) {
      warnings.push(`Toma de apoyo repetida: ${s.type} en los clips ${seenTypes.get(s.type)} y ${s.num}.`);
    } else {
      seenTypes.set(s.type, s.num);
    }
    if (!(SUPPORT_SHOT_TYPES as readonly string[]).includes(s.type)) {
      warnings.push(`Clip ${s.num}: tipo de toma de apoyo desconocido (${s.type}).`);
    }
    const nearBroll = brollNums.find((b) => Math.abs(b - s.num) < SUPPORT_SHOT_MIN_GAP_FROM_BROLL && b !== s.num);
    if (nearBroll !== undefined) {
      warnings.push(`Clip ${s.num}: la toma de apoyo queda demasiado cerca del B-roll del clip ${nearBroll}.`);
    }
    if (s.clip.isStaticBroll) {
      warnings.push(`Clip ${s.num}: la toma de apoyo llegó como B-roll estático en vez de clip.`);
    }
    if (s.era === null) {
      warnings.push(`Clip ${s.num}: la toma de apoyo no indica el año ([Era: ...]).`);
    } else if (s.era < 1840 && /photograph|daguerreotype|albumen/i.test(textOf(s.clip))) {
      warnings.push(`Clip ${s.num}: usa fotografía en una escena de ${s.era} (anacronismo).`);
    }
  }
  for (let i = 1; i < support.length; i++) {
    if (support[i].num - support[i - 1].num === 1) {
      warnings.push(`Tomas de apoyo seguidas en los clips ${support[i - 1].num} y ${support[i].num}.`);
    }
  }

  if (brollNums.length > 0 && archive.length !== 1) {
    warnings.push(
      `Imagen de archivo de época: debe haber una sola y llegaron ${archive.length}${
        archive.length ? ` (clips ${archive.map((a) => a.num).join(', ')})` : ''
      }.`
    );
  }
  for (const a of archive) {
    if (a.era === null) {
      warnings.push(`Clip ${a.num}: la imagen de archivo no indica el año ([Era: ...]).`);
      continue;
    }
    const expected = getArchiveMediumForYear(a.era);
    if (expected && expected.key !== a.key) {
      warnings.push(
        `Clip ${a.num}: para el año ${a.era} corresponde "${expected.label}" y llegó ${a.key} (posible anacronismo).`
      );
    }
  }

  // Clips de dos tomas: los decide Gemini por escena; nunca en el Clip 01, en B-roll ni en tomas de apoyo
  const supportNums = new Set(support.map((s) => s.num));
  const twoShotNums = sorted.filter((c) => isTwoShotClipText(textOf(c))).map((c) => c.clipNumber);
  for (const n of twoShotNums) {
    if (n === 1) warnings.push('Clip 1: llegó con dos tomas y debe ser de una sola.');
    else if (brollNums.includes(n)) warnings.push(`Clip ${n}: es B-roll y llegó con dos tomas (debe ser una sola).`);
    else if (supportNums.has(n)) warnings.push(`Clip ${n}: es toma de apoyo y llegó con dos tomas (debe ser una sola).`);
  }

  return {
    supportCount: support.length,
    archiveCount: archive.length,
    quota,
    warnings,
    twoShotCount: twoShotNums.length,
    twoShotClips: twoShotNums,
  };
}
