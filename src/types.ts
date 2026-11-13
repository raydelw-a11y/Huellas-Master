export interface TTSSegmentTiming {
  type: 'text' | 'pause';
  text?: string;
  startSec: number;
  endSec: number;
  durationSec: number;
}

export interface TTSRecord {
  id: string;
  text: string;
  voice: string;
  style: string;
  speed: string;
  language: string;
  consistencyMode?: boolean;
  filename: string;
  audioUrl: string;
  createdAt: string;
  storageMode?: 'gcs' | 'local';
  wordCount: number;
  pauseCount?: number;
  duration: number;
  providerUsed?: string;
  label?: string;
  segmentTimings?: TTSSegmentTiming[];
}

export interface ServerStatus {
  hasGeminiKey: boolean;
  maskedKey?: string;
  gcsBucket: string | null;
  storageMode: 'gcs' | 'local';
  authMethod?: string;
  hasElevenLabsKey?: boolean;
  hasGoogleTts?: boolean;
  ffmpegAvailable?: boolean;
}

export interface SavedVoice {
  id: string;
  name: string;
  styleDescription: string;
  baseVoice: VoiceName;
  speed: 'slow' | 'medium' | 'fast';
  prompt?: string;
  createdAt: string;
  updatedAt?: string;
}

export type VoiceName =
  | 'Kore'
  | 'Aoede'
  | 'Puck'
  | 'Charon'
  | 'Fenrir'
  | 'Zephyr'
  | 'Adam'
  | 'Antoni'
  | 'Bella'
  | 'Domi'
  | 'Grace'
  | 'Michael'
  | 'Rachel'
  | 'Serena'
  | 'Journey_F'
  | 'Journey_M'
  | 'Wavenet_A'
  | 'Wavenet_B'
  | 'Neural2_F'
  | 'Neural2_M'
  | 'Coqui_Default'
  | 'Coqui_Custom';

export interface VoiceOption {
  value: VoiceName;
  label: string;
  provider: 'Gemini' | 'ElevenLabs' | 'Google Cloud' | 'Coqui';
  gender: 'Femenino' | 'Masculino' | 'Neutro';
  description: string;
}

export const AVAILABLE_VOICES: VoiceOption[] = [
  { value: 'Charon', label: 'Charon (Documental)', provider: 'Gemini', gender: 'Masculino', description: 'Voz oficial madura y profunda, ideal para documentales e historias solemnes.' },
  { value: 'Fenrir', label: 'Fenrir (Dramático)', provider: 'Gemini', gender: 'Masculino', description: 'Voz oficial robusta y con cuerpo, perfecta para contenidos dramáticos o intensos.' },
  { value: 'Zephyr', label: 'Zephyr (Calmada)', provider: 'Gemini', gender: 'Masculino', description: 'Voz oficial equilibrada, cálida y calmada, óptima para explicaciones y reflexiones.' },
  { value: 'Puck', label: 'Puck (Dinámico)', provider: 'Gemini', gender: 'Masculino', description: 'Voz oficial juvenil, enérgica y carismática.' },
  { value: 'Kore', label: 'Kore', provider: 'Gemini', gender: 'Femenino', description: 'Voz oficial clara, brillante e ideal para narraciones y guías.' },
  { value: 'Aoede', label: 'Aoede', provider: 'Gemini', gender: 'Femenino', description: 'Voz oficial sumamente expresiva y cálida para historias.' },
  { value: 'Adam', label: 'Adam', provider: 'ElevenLabs', gender: 'Masculino', description: 'Voz profunda estilo narrador de documental, imponente y madura.' },
  { value: 'Antoni', label: 'Antoni', provider: 'ElevenLabs', gender: 'Masculino', description: 'Voz suave, templada y sumamente profesional.' },
  { value: 'Michael', label: 'Michael', provider: 'ElevenLabs', gender: 'Masculino', description: 'Voz clásica de locución con absoluta claridad.' },
  { value: 'Bella', label: 'Bella', provider: 'ElevenLabs', gender: 'Femenino', description: 'Voz femenina acogedora y natural.' },
  { value: 'Rachel', label: 'Rachel', provider: 'ElevenLabs', gender: 'Femenino', description: 'Voz femenina articulada y fresca.' },
  { value: 'Serena', label: 'Serena', provider: 'ElevenLabs', gender: 'Femenino', description: 'Voz femenina elegante, analítica y profunda.' },
  { value: 'Journey_M', label: 'Journey-M', provider: 'Google Cloud', gender: 'Masculino', description: 'Voz masculina con alta solidez y excelente resonancia.' },
  { value: 'Journey_F', label: 'Journey-F', provider: 'Google Cloud', gender: 'Femenino', description: 'Voz femenina moderna, fluida y natural.' },
  { value: 'Wavenet_B', label: 'Wavenet-B', provider: 'Google Cloud', gender: 'Masculino', description: 'Voz de locución periodística tradicional con cadencia limpia.' },
  { value: 'Neural2_M', label: 'Neural2-M', provider: 'Google Cloud', gender: 'Masculino', description: 'Voz masculina estable y neutra.' },
  { value: 'Coqui_Default', label: 'Coqui Local', provider: 'Coqui', gender: 'Neutro', description: 'Voz 100% local ultra-realista.' },
  { value: 'Coqui_Custom', label: 'Coqui Clon (Custom)', provider: 'Coqui', gender: 'Neutro', description: 'Voz clonada local.' },
];

export const AVAILABLE_LANGUAGES = [
  { value: 'es-la', label: 'Español Latino', flag: '🌎', localeCode: 'es-MX' },
  { value: 'es', label: 'Español (España)', flag: '🇪🇸', localeCode: 'es-ES' },
  { value: 'en', label: 'Inglés', flag: '🇺🇸', localeCode: 'en-US' },
  { value: 'pt', label: 'Portugués', flag: '🇧🇷', localeCode: 'pt-BR' },
  { value: 'fr', label: 'Francés', flag: '🇫🇷', localeCode: 'fr-FR' },
  { value: 'de', label: 'Alemán', flag: '🇩🇪', localeCode: 'de-DE' },
];

export const AVAILABLE_STYLES = [
  { value: 'dramatic', label: 'Dramático', emoji: '🎭', description: 'Énfasis emocional profundo y pausas expresivas.' },
  { value: 'formal', label: 'Formal / Solemne', emoji: '🏛️', description: 'Voz pausada, seria y documental.' },
  { value: 'standard', label: 'Estándar', emoji: '🎙️', description: 'Entonación neutral y profesional.' },
  { value: 'whisper', label: 'Susurro / Misterio', emoji: '🤫', description: 'Tono suave, lento e intrigante.' },
  { value: 'cheerful', label: 'Alegre', emoji: '✨', description: 'Tono entusiasta y enérgico.' },
];

export const AVAILABLE_SPEEDS = [
  { value: 'slow' as const, label: 'Lento', description: 'Hablar pausadamente' },
  { value: 'medium' as const, label: 'Normal', description: 'Velocidad estándar' },
  { value: 'fast' as const, label: 'Rápido', description: 'Velocidad acelerada' },
];

// Timeline Extractor Types
export interface Sentence {
  index?: number;
  start: number;
  end: number;
  start_formatted?: string;
  end_formatted?: string;
  text: string;
}

export type TimelineFormatStyle = 'MM:SS' | 'HH:MM:SS' | 'HH:MM:SS,mmm';
export type OutputStyleOption = 'timeline' | 'plain' | 'srt' | 'vtt' | 'csv' | 'json';
export type SentenceModeOption =
  | 'split-10-seconds'
  | 'split-8-seconds'
  | 'split-4-seconds'
  | 'one-sentence-per-line'
  | 'combine-short'
  | 'original-segments';

export interface ExtractorSettings {
  language: string;
  customLanguage: string;
  quality: 'fast' | 'balanced' | 'high';
  outputStyle: OutputStyleOption;
  timestampFormat: TimelineFormatStyle;
  sentenceMode: SentenceModeOption;
  noBlankLines: boolean;
  strictNarration: boolean;
  removeFiller: boolean;
  mergeShort: boolean;
  preservePunctuation: boolean;
  includeLineNumbers: boolean;
}

// Documentary Project Entities
export interface ReferenceAsset {
  id: string;
  tag: string; // e.g., "@Jack_El_Destripador" or "Whitechapel_1888"
  category: 'persona' | 'lugar';
  description: string;
  prompt: string;
  imageUrl?: string;
  isCreated: boolean;
}

export type BrollCameraMotion =
  | 'zoom_in'
  | 'zoom_out'
  | 'pan_right'
  | 'pan_left'
  | 'tilt_up'
  | 'tilt_down';

export interface DocumentaryClip {
  id: string;
  clipNumber: number;
  timeRange: string; // e.g., "00:06 - 00:16"
  cameraSelection: string;
  visualExplanation: string;
  imagePrompt: string; // "Image 1: Create an image..."
  videoPrompt: string; // "Clip 1 (00:00 - 00:04): Create a video..."
  narrationSegment: string;
  pauseNotes?: string;
  imageReady: boolean;
  videoReady: boolean;
  recreated?: boolean;
  reviewedForEditor?: boolean;
  imagePreviewUrl?: string;
  auditStatus?: 'ok' | 'warning' | 'mismatch';
  auditReason?: string;
  suggestedImagePrompt?: string;
  suggestedVideoPrompt?: string;
  // Auditoría Visual Automática del Video Real de Google Flow
  videoAuditStatus?: 'idle' | 'generating' | 'auditing' | 'approved' | 'warning' | 'rejected';
  videoAuditScore?: number;
  videoAuditReason?: string;
  videoAuditIssues?: string[];
  videoFrames?: string[];
  videoAttempts?: number;
  videoSavedFileName?: string;
  discardedVideoFileName?: string;
  videoDiscardedAt?: number;
  videoSavedAt?: number;
  promptUpdatedAt?: number;
  // Smart Auto-Reframe 9:16 (Vertical Dual Format)
  reframe9x16Mode?: 'auto_center' | 'auto_focus' | 'auto_pan' | 'manual' | 'fit_blur';
  reframeFocusXStart?: number; // 0 to 100 (50 = center)
  reframeFocusXEnd?: number;   // 0 to 100 (50 = center)
  reframeFocusY?: number;      // 0 to 100 (50 = center)
  reframeConfidence?: number;
  reframeReason?: string;
  // Motor de video específico de este clip (Omni 1.1 Flash si hay personas, Veo 3.1 - Lite [Lower Priority] para el resto)
  flowClipEngine?: 'OMNI_1_1_FLASH' | 'VEO_3_1_LITE_LOWER_PRIORITY';
  // Clip B-Roll de Imagen Estática (~cada 2 min) con movimiento óptico puro de cámara local en 4K 60fps
  isStaticBroll?: boolean;
  brollCameraMotion?: BrollCameraMotion;
  previousVideoPrompt?: string;
}

export interface SunoTrack {
  id: string;
  trackNumber: number;
  title: string;
  duration: string; // e.g. "3:30 min"
  videoTimeRange: string; // e.g. "00:00 - 03:30"
  lyricsPrompt: string;
  stylePrompt: string;
  explanation: string;
  audioUrl?: string;
  isGenerated: boolean;
}

export type ProductionFormatType =
  | 'DOCUMENTAL_16X9'
  | 'REEL_9X16'
  | 'INMERSIVO'
  | 'TIMELAPSE'
  | 'NOTEBOOKLM'
  | 'POST_3X4';

export type DocumentaryStatusType =
  | 'planificacion'
  | 'guion'
  | 'locucion'
  | 'clips'
  | 'edicion_capcut'
  | 'publicado';

export interface AudienceCommentReply {
  id: string;
  author?: string;
  commentText: string;
  replyConcise: string;
  replyAlternative?: string;
  historicalContextNote?: string;
  imagePreviewUrl?: string;
  createdAt: string;
}

export interface DocumentaryProject {
  id: string;
  title: string;
  subtitle: string;
  productionType: ProductionFormatType;
  status: DocumentaryStatusType;
  createdAt: string;
  updatedAt: string;

  // Etapa 1: Configuración, Carpeta de Descarga Obligatoria y Prompt Maestro
  downloadFolderName?: string;
  downloadFolderPath?: string;
  geminiChatUrl?: string;
  geminiChatTitle?: string;
  promptConfig: Record<string, any>;
  compiledMasterPrompt: string;

  // Etapa 2: Tema, Tipología y Duración
  topic: string;
  typology: string;
  historicalTime: string;
  historicalLocation: string;
  targetDurationSeconds: number;
  clipDurationMode: '10_SEGUNDOS' | '8_SEGUNDOS';
  clip1SyncMode: 'RALENTIZAR_CAPCUT' | 'VOZ_EN_CLIP_2';
  clip1DurationSeconds: number;

  // Etapa 3: Estructura e Investigación Profunda
  sectionsStructure: string;
  deepResearchPrompt: string;
  deepResearchResult: string;

  // Etapa 4: Guion de Voz en Off + VoxFlow + Timeline Extractor
  voiceoverScript: string;
  selectedVoice: VoiceName;
  selectedStyle: string;
  selectedSpeed: 'slow' | 'medium' | 'fast';
  selectedLanguage: string;
  audioTracks: TTSRecord[];
  masterAudioUrl: string;
  timelineSentences: Sentence[];
  timelineFormattedText: string;
  timelineSettings: ExtractorSettings;

  // Etapa 5: Imágenes Modelo de Referencia (@Personas y Lugares)
  rawReferencePrompts: string;
  references: ReferenceAsset[];

  // Etapa 6: Texto en Pantalla del Clip 1 (Primeros 6s)
  clip1TextMode: 'IA_CLIP_1' | 'CAPCUT_MANUAL';
  clip1Line1LocationTime: string;
  clip1Line2Hook: string;
  clip1OptionsRaw: string;

  // Etapa 7: Prompts de Imágenes Iniciales y Clips
  operationalHeader: string;
  rawClipsText: string;
  clips: DocumentaryClip[];

  // Etapa 8: Corrección de Captions .SRT de CapCut
  capcutRawSrt: string;
  correctedSrt: string;
  srtFileName: string;

  // Etapa 9: Banda Sonora (Suno)
  confirmedFinalDuration: string;
  rawSunoText: string;
  sunoTracks: SunoTrack[];

  // Etapa 10: Miniatura Oficial (Nano Banana 2.1)
  thumbnailOrientation?: 'HORIZONTAL_16X9' | 'VERTICAL_9X16';
  thumbnailPsychVariant?: 'A' | 'B' | 'C';
  thumbnailPsychTriggers?: ThumbnailPsychTriggerOption[];
  thumbnailTextOptions?: string[];
  thumbnailPrompt: string;
  thumbnailTextOverlay: string;
  thumbnailImageUrl: string;
  thumbnailHorizontalImageUrl?: string;
  thumbnailVerticalImageUrl?: string;
  thumbnailReady: boolean;

  // Etapa 11: Metadata de Publicación
  platform: 'YOUTUBE' | 'INSTAGRAM' | 'FACEBOOK_TIKTOK';
  rawMetadataText: string;
  rawYoutubeMetadata?: string;
  rawFacebookMetadata?: string;
  publishTitle: string;
  publishDescription: string;
  youtubeChapters: string;
  aiNote: string;
  slogan: string;
  hashtags: string;
  youtubeTags: string;
  pinnedComment: string;

  // Etapa 12: Respuestas a Comentarios de la Audiencia (Post-Producción)
  commentReplies?: AudienceCommentReply[];

  // Motor de generación de video en Google Flow (Etapa 7)
  flowVideoEngine?: 'HYBRID_PEOPLE_OMNI_REST_LOWER' | 'VEO_3_1_LITE_LOWER_PRIORITY' | 'OMNI_1_1_FLASH';
}

export interface ThumbnailPsychTriggerOption {
  id: 'A' | 'B' | 'C';
  title: string;
  description: string;
  prompt: string;
  suggestedOverlay?: string;
}

export const DEFAULT_OPERATIONAL_HEADER = `Act as a professional historian, film director, and journalist. Before starting the generation of any images or video clips, first analyze all provided prompts, check scene by scene whether people/human subjects are present or whether the scene is tagged [IMAGE ONLY — DO NOT GENERATE VIDEO CLIP], and give me a clear pre-generation report stating: (1) exact total number of initial images (Nano Banana 2.1), (2) how many video clips will be made with Omni (Omni 1.1 Flash), (3) how many video clips will be made with Lower Priority (Veo 3.1 - Lite [Lower Priority]), and (4) how many scenes are Image-Only Static B-Roll plates ([IMAGE ONLY — DO NOT GENERATE VIDEO CLIP] [B-Roll: STATIC_...]) that require ONLY the Nano Banana 2.1 still image and ZERO video clip generation, and only after delivering that report proceed with generation.
Rename every generated image and video clip using these exact prefixes followed by the 2-digit scene number (01 to 09 for 1 to 9) and the first 6 words of the prompt: start initial clip images with "Inicial_##_" (e.g., Inicial_01_create_an_image_in_16_9), start [IMAGE ONLY — DO NOT GENERATE VIDEO CLIP] Static B-Roll plates with "Broll_##_" (e.g., Broll_18_create_an_image_in_16_9), and start video clips with "Clip_##_" (e.g., Clip_01_create_a_cinematic_8_second_video).
Use Omni 1.1 Flash exclusively for video clips featuring people and use Veo 3.1 - Lite [Lower Priority] for all remaining video clips without people; use Nano Banana 2.1 for the initial images of each clip and for all [IMAGE ONLY — DO NOT GENERATE VIDEO CLIP] Static B-Roll plates.
Create the images first and then create video clips ONLY for scenes that include a "Clip XX:" prompt (using each corresponding image as the starting frame). STRICT RULE FOR STATIC B-ROLL PLATES: Whenever an "Image XX:" prompt is tagged [IMAGE ONLY — DO NOT GENERATE VIDEO CLIP] (with no "Clip XX:" prompt), generate ONLY the still image with Nano Banana 2.1 and DO NOT generate any video clip for that scene number (4K 60fps camera motion is applied locally in our video editor).
Use the @Reference images of people and locations ONLY when generating the initial images ("Inicial_##") with Nano Banana 2.1 to maintain visual fidelity; when generating each video clip ("Clip_##"), use ONLY its corresponding generated initial image ("Inicial_##") as the starting frame without re-attaching @Person reference sheets or real historical person names.
Never make shot changes in any clip (except in that specific clip where the prompt explicitly instructs making two 5-second shots each because the narration voice changed scenes) and ensure video clips have no disappearances or transformations; the created initial image will be used as the start of each video clip.
Divide creation into batches of 10.
rename everything adding _ as the blank spaces between words and replacing any colons (:) or hyphens with _ (never use : in filenames)
from 1 to 9 change the scene number to 01 to 09 (e.g., Inicial_01, Clip_01, Broll_08)`;

export function sanitizeOperationalHeader(
  rawHeader?: string,
  engine: 'HYBRID_PEOPLE_OMNI_REST_LOWER' | 'VEO_3_1_LITE_LOWER_PRIORITY' | 'OMNI_1_1_FLASH' = 'HYBRID_PEOPLE_OMNI_REST_LOWER'
): string {
  const engineLine =
    engine === 'HYBRID_PEOPLE_OMNI_REST_LOWER'
      ? 'Use Omni 1.1 Flash exclusively for video clips featuring people and use Veo 3.1 - Lite [Lower Priority] for all remaining video clips without people; use Nano Banana 2.1 for the initial images of each clip and for all [IMAGE ONLY — DO NOT GENERATE VIDEO CLIP] Static B-Roll plates.'
      : engine === 'OMNI_1_1_FLASH'
      ? 'Use Omni 1.1 Flash for videos and Nano Banana 2.1 for the initial images of each clip and for all [IMAGE ONLY — DO NOT GENERATE VIDEO CLIP] Static B-Roll plates.'
      : 'Use Veo 3.1 - Lite [Lower Priority] for videos and Nano Banana 2.1 for the initial images of each clip and for all [IMAGE ONLY — DO NOT GENERATE VIDEO CLIP] Static B-Roll plates.';

  const trimmed = String(rawHeader || '').trim();
  const isLegacySpanishOrIncomplete =
    !trimmed ||
    /^Act[uú]a como un historiador/i.test(trimmed) ||
    /Cambia\s+los\s+nombres/i.test(trimmed) ||
    /del\s+1\s+al\s+10/i.test(trimmed) ||
    /Cuando\s+se\s+hayan\s+generado\s+todas\s+las\s+im[áa]genes\s+me\s+avisas/i.test(trimmed) ||
    /keep\s+the\s+starting\s+image\s+100%\s+frozen\s+as\s+a\s+still\s+documentary\s+B-roll\s+plate/i.test(trimmed) ||
    !/^Act as a (?:(?:professional|master)\s+)?historian/i.test(trimmed) ||
    !/pre-generation\s+report|how\s+many\s+(?:video\s+)?clips\s+will\s+be\s+(?:made|generated)\s+with\s+Omni/i.test(trimmed) ||
    !/IMAGE\s+ONLY\s*[—–-]\s*DO\s+NOT\s+GENERATE\s+VIDEO\s+CLIP/i.test(trimmed) ||
    !/Inicial_/i.test(trimmed) ||
    !/Broll_/i.test(trimmed) ||
    !/Clip_/i.test(trimmed) ||
    !/(?:literal first 6 words|first 6 literal words|first 6 words)/i.test(trimmed) ||
    !/never use : in filenames/i.test(trimmed) ||
    !/batches of 10/i.test(trimmed) ||
    !trimmed.includes('01 to 09');

  const base = isLegacySpanishOrIncomplete ? DEFAULT_OPERATIONAL_HEADER : trimmed;
  const lineRegex =
    /(?:Use|Usa)\s+(?:omni\s*(?:1\.1\s*)?flash|veo\s*3\.1\s*(?:-\s*lite\s*\[lower\s*priority\])?|lower\s*priority)[^\n]*(?:for\s+(?:the\s+)?(?:initial|starting(?:\s+keyframe)?)\s+(?:clip\s+)?images[^\n]*|para\s+im[áa]genes\s+iniciales\s+de\s+cada\s+clip)\.?/gi;
  return lineRegex.test(base) ? base.replace(lineRegex, engineLine) : DEFAULT_OPERATIONAL_HEADER.replace(lineRegex, engineLine);
}
