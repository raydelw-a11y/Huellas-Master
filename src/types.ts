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
  storageMode: 'gcs' | 'local';
  wordCount: number;
  duration: number;
  providerUsed?: string;
  label?: string;
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
  index: number;
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
  thumbnailTextOptions?: string[];
  thumbnailPrompt: string;
  thumbnailTextOverlay: string;
  thumbnailImageUrl: string;
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
}

export const DEFAULT_OPERATIONAL_HEADER = `Actúa como un historiador, director de cine, y periodista profesional.
Cambia los nombres de los clips a las primeras 6 palabras literales del prompt proveído pegado y enviado que incluyen la numeración.
Usa omni flash para videos y nano banana 2.1 para imágenes iniciales de cada clip.
Crea las imágenes primero y luego los clips usando cada imagen como fotograma inicial.
Usa las imágenes de referencia de personas y lugares para generar las imágenes iniciales y los clips para mantener fidelidad visual.
No hagas cambios de shot nunca en ningun clip (excepto en aquel clip específico donde el prompt indique expresamente hacer dos shots de 5 segundos cada uno porque la voz narrativa cambió de escena) y asegúrate de que los clips de video no hagan desapariciones ni transformaciones, la imagen inicial creada se usará para el inicio de cada clip.
Divide la creación en batches de 10.
rename everything adding _ as the blank spaces between words
from 1 to 9 change them to 01 to 09`;
