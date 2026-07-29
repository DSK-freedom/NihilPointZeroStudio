/**
 * Which AI brain powers the app:
 * - 'free'      — a keyless, no-install hosted model (needs internet). The default:
 *                 free for life, nothing to sign up for.
 * - 'ollama'    — a model running locally on this PC (free, offline; needs install).
 * - 'anthropic' — Claude, your key (paid, highest quality).
 * - 'openai'    — OpenAI, your key (paid).
 */
export type LLMProviderId = 'free' | 'anthropic' | 'openai' | 'ollama'

export interface ProviderSettings {
  activeProvider: LLMProviderId
  freeModel: string
  anthropicModel: string
  openaiModel: string
  ollamaModel: string
  hasAnthropicKey: boolean
  hasOpenAIKey: boolean
  hasYouTubeKey: boolean
  /** Optional free AI Horde key for faster photo-to-scene (img2img) generation. */
  hasHordeKey: boolean
  /** Optional free MVSEP token for online music separation (remove music from outside videos). */
  hasMvsepToken: boolean
  /** Optional local Demucs command/path for offline music separation. */
  demucsCmd: string
  /**
   * Optional local face-animation tool for the Presenter GRAFT mode (full-quality
   * "living picture"). A command template with {photo} {video} {audio} {out}
   * placeholders; when unset, the built-in ffmpeg graft is used.
   */
  faceAnimCmd: string
  /** The user's YouTube channel ID, used to deep-link the upload page. */
  youtubeChannelId: string
}

export interface YouTubeSignal {
  title: string
  channelTitle: string
  viewCount: number
  publishedAt: string
}

export interface OllamaStatus {
  connected: boolean
  models: string[]
}

export type LanguageMix = 'balanced' | 'mostly-english' | 'mostly-roman-urdu' | 'formal-urdu'

export type ScriptLength = 'short' | 'long' | 'deep-dive' | 'feature-90' | 'feature-180'

export type ScriptStyle =
  | 'standard'
  | 'deep-dive'
  | 'masterclass'
  | 'institutional-framework'
  | 'financial-research'
  | 'technical-charting'
  | 'fundamental-deep-dive'
  | 'infotainment'
  | 'normal'
  | 'hooking'

export interface IdeaGenRequest {
  focusArea: string
  audienceNote?: string
  count: number
}

export interface VideoIdea {
  id: string
  title: string
  hook: string
  angle: string
  viewPotentialScore: number
  viewPotentialReason: string
  competitionLevel: 'low' | 'medium' | 'high'
  contentPillars: string[]
  suggestedLength: ScriptLength
  createdAt: string
}

export interface ScriptGenRequest {
  topic: string
  ideaContext?: string
  length: ScriptLength
  languageMix: LanguageMix
  audienceNote?: string
  verifiedData?: string
  /** User-selected stylistic modes to blend into the output. */
  styles?: ScriptStyle[]
  /** Auto-populated server-side from live news search — not user-editable. */
  recentNewsContext?: string
}

export interface GeneratedScript {
  id: string
  topic: string
  length: ScriptLength
  languageMix: LanguageMix
  title: string
  body: string
  estimatedWordCount: number
  estimatedDurationMinutes: number
  createdAt: string
}

/** A generated picture saved in the Library (scene images, thumbnails). */
export interface SavedImage {
  title: string
  /** Absolute path of the image file on disk. */
  path: string
  /** Where it came from, e.g. "Scene Studio" or "Thumbnail". */
  source: string
}

export interface LibraryEntry {
  id: string
  kind: 'idea' | 'script' | 'image'
  data: VideoIdea | GeneratedScript | SavedImage
  savedAt: string
  /** Set when the user moves the entry to the Trash Can. Only the user can empty the
   *  Trash — nothing in the app deletes library items outright. */
  trashedAt?: string
}

export interface TrendTopic {
  topic: string
  why: string
  momentum: 'rising' | 'steady' | 'seasonal'
}

/** One OHLC price bar for charting. `date` is an ISO date string. */
export interface PriceBar {
  date: string
  open: number
  high: number
  low: number
  close: number
  volume: number | null
}

/** A price series plus indicator overlays (aligned index-for-index with `bars`). */
export interface PriceSeries {
  bars: PriceBar[]
  sma20: (number | null)[]
  sma50: (number | null)[]
  rsi14: (number | null)[]
  /** Non-empty when the file/series could not be read. */
  error?: string
}

export interface FileAnalysis {
  fileName: string
  kind: 'technical' | 'fundamental' | 'flow' | 'document'
  summary: string
}

export interface FileImportResult {
  canceled: boolean
  analysis?: FileAnalysis
  error?: string
}

export interface PsxFetchResult {
  canceled: boolean
  savedPath?: string
  analysis?: FileAnalysis
  error?: string
}

/** Result of analysing LIVE PSX end-of-day data for one symbol (all figures computed in-app). */
export interface PsxLiveAnalysis {
  symbol: string
  points: number
  from: string
  to: string
  latest: number
  latestDate: string
  changePct: number | null
  high52w: number
  low52w: number
  yearChangePct: number | null
  sma20: number | null
  sma50: number | null
  sma200: number | null
  rsi14: number | null
  latestVolume: number
  volumeVs20dAvg: number | null
  trend: string
}

export interface CorrelationResult {
  canceled: boolean
  summary?: string
  error?: string
}

export type VideoResolution = '1080p' | '1440p' | '4k' | '8k'

/** Frame shape: 16:9 (landscape/YouTube), 9:16 (Shorts/Reels/TikTok), 1:1 (square). */
export type VideoAspect = '16:9' | '9:16' | '1:1'
export const VIDEO_ASPECTS: VideoAspect[] = ['16:9', '9:16', '1:1']

/** Graphics v2 finishing template (colour-grade / vignette / grain / letterbox / animated title). */
export type VideoTemplate = 'clean' | 'news' | 'cinematic' | 'bold'
export const VIDEO_TEMPLATES: VideoTemplate[] = ['clean', 'news', 'cinematic', 'bold']

/** Visual style for the free preset renderer. */
export type VideoStyle = 'cinematic' | 'cartoon' | 'anime' | 'neon' | 'minimal'
export const VIDEO_STYLES: VideoStyle[] = ['cinematic', 'cartoon', 'anime', 'neon', 'minimal']

/**
 * Which engine renders the video's look:
 * - 'presets'  — free, offline style renderer (default). Styles text/backgrounds and
 *   your own images; does NOT fabricate AI footage.
 * - 'ai-free'  — FREE online AI visuals: generates a unique AI image per scene (keyless,
 *   no install; needs internet) and animates them. Falls back to the animated look if
 *   offline / the service is busy.
 * - 'ai-cloud' — paid cloud AI video footage; you supply an API key.
 * - 'ai-local' — free local AI footage; needs a capable GPU + local model server.
 */
export type LookEngine = 'presets' | 'ai-free' | 'ai-cloud' | 'ai-local'

/** Optional configuration for the two AI-footage engines (stored locally). */
export interface AiVideoConfig {
  /** Cloud engine: your provider API key. */
  cloudApiKey?: string
  /** Cloud engine: REST endpoint that accepts {prompt, seconds} and returns a video URL. */
  cloudEndpoint?: string
  cloudModel?: string
  /** Local engine: base URL of your local generation server (default http://127.0.0.1:7860). */
  localEndpoint?: string
}

/** Live status of the AI engines, for the UI badges. */
export interface AiEngineStatus {
  cloudConfigured: boolean
  localDetected: boolean
  cloudEndpoint?: string
  localEndpoint?: string
}

export interface VideoBuildRequest {
  title: string
  body: string
  /** Output resolution — 1080p (default), 1440p, 4k, or 8k. */
  resolution?: VideoResolution
  /** Frame shape — 16:9 (default), 9:16 (Shorts/Reels), or 1:1 (square). */
  aspect?: VideoAspect
  /** Graphics v2 finishing template (clean/news/cinematic/bold). */
  template?: VideoTemplate
  /** Computer narration voice: 'windows' (default) or 'piper' (natural, if installed). */
  narrationVoice?: 'windows' | 'piper'
  /** Absolute path to a background music file (chosen via the pick-music dialog). */
  musicPath?: string
  /** Add a soft transition sound at each section change. */
  soundEffects?: boolean
  /** Look engine (default 'presets'). */
  engine?: LookEngine
  /** Visual style for the preset engine (default 'cinematic'). */
  style?: VideoStyle
  /** Optional user images (absolute paths) shown as a Ken-Burns slideshow background. */
  images?: string[]
  /** Use real stock footage (online) matched to the script (needs a saved Pixabay key). */
  useStock?: boolean
}

export interface VideoJob {
  id: string
  title: string
  path: string
  hasCustomVoice: boolean
  createdAt: string
  /** Saved narration-only audio, so background music can later be removed/replaced
   * exactly (no AI un-mixing). Present for videos built after this feature shipped. */
  narrationPath?: string
}

/** How a cut is applied: keep only the selected range, or remove it (see main/video/trim.ts). */
export type TrimMode = 'keep' | 'remove'

/** Procedural music moods and SFX kinds the built-in generator can synthesize. */
export type Mood = 'calm' | 'uplifting' | 'tense' | 'lofi' | 'corporate' | 'cinematic'
export type SfxKind = 'whoosh' | 'riser' | 'impact' | 'click' | 'pop' | 'swell' | 'subdrop'
export const MOODS: Mood[] = ['calm', 'uplifting', 'tense', 'lofi', 'corporate', 'cinematic']
export const SFX_KINDS: SfxKind[] = ['whoosh', 'riser', 'impact', 'click', 'pop', 'swell', 'subdrop']

/** Delivery/export formats a finished video can be transcoded to (see main/video/export.ts). */
export type ExportFormat = 'youtube' | 'mp4-h264' | 'mp4-h265' | 'mov' | 'webm-vp9'

export interface ExportFormatInfo {
  id: ExportFormat
  label: string
  /** Container file extension (no dot). */
  ext: string
  /** Short, user-facing note shown in the UI. */
  note: string
}

/** Ordered descriptors for the export dropdown. `youtube` is the recommended default. */
export const EXPORT_FORMATS: ExportFormatInfo[] = [
  { id: 'youtube', label: 'YouTube Optimized (MP4 · H.264)', ext: 'mp4', note: 'Best default for uploading to YouTube.' },
  { id: 'mp4-h264', label: 'MP4 · H.264 (universal)', ext: 'mp4', note: 'Plays almost everywhere.' },
  { id: 'mp4-h265', label: 'MP4 · H.265/HEVC (smaller file)', ext: 'mp4', note: 'Smaller size; needs a modern player.' },
  { id: 'mov', label: 'MOV · H.264 (editors)', ext: 'mov', note: 'Friendly to video editors.' },
  { id: 'webm-vp9', label: 'WebM · VP9 (open/web)', ext: 'webm', note: 'Open codec; great for the web.' }
]

/** Result of importing a script from a user-picked file (.txt/.md/.srt/.pdf). */
export interface ScriptImportResult {
  canceled: boolean
  /** Filename-derived title (no extension). */
  title?: string
  /** Extracted plain-text body ready to narrate. */
  body?: string
  /** Non-empty when the file was picked but text could not be extracted. */
  error?: string
}

/** The persistent free-write scratchpad ("Script Pad"), stored on disk. */
export interface ScriptPad {
  title: string
  body: string
  updatedAt: string
}

/** A no-copyright track found via the online free-music search (Openverse, CC). */
export interface FreeTrack {
  id: string
  title: string
  artist: string
  license: string
  licenseUrl?: string
  landingUrl?: string
  /** Direct audio file for in-app preview / download (absent for some results). */
  audioUrl?: string
  durationSec?: number
}

/** Result of an online music search — degrades gracefully when offline. */
export interface MusicSearchResult {
  tracks: FreeTrack[]
  online: boolean
  error?: string
}

/**
 * A single edit the AI Director can perform, mapping 1:1 to a verified engine op.
 * The AI only decides WHAT (these structured actions); the tested code does the HOW.
 */
export type DirectorAction =
  | { type: 'keep'; startSec: number; endSec: number }
  | { type: 'remove'; startSec: number; endSec: number }
  | { type: 'music'; mood: Mood; atSec: number; gain?: number }
  | { type: 'sfx'; kind: SfxKind; atSec: number; gain?: number }

/** The AI Director's reading of an instruction: either an edit plan or a plain reply. */
export interface DirectorInterpretation {
  kind: 'edit' | 'reply'
  /** Plain-English explanation of what it will do (or the answer, for 'reply'). */
  explanation: string
  /** The ordered edits to apply (empty for 'reply'). */
  actions: DirectorAction[]
}

/** One placed sound on the DJ-station timeline. */
export interface AudioClip {
  id: string
  /** Absolute path to the source audio file. */
  src: string
  label: string
  /** When the clip starts, in seconds from the start of the video. */
  atSec: number
  /** Optional in-point within the source file (use only a segment). */
  startSec?: number
  /** Optional out-point within the source file. */
  endSec?: number
  /** Linear gain multiplier (1 = unchanged). */
  gain: number
  /** Fade in / out lengths in seconds. */
  fadeIn: number
  fadeOut: number
}

/** A named, saved arrangement of placed sounds, mixed over a video's own audio. */
export interface AudioPlan {
  id: string
  name: string
  clips: AudioClip[]
  savedAt: string
}

export interface ChatMessage {
  id: string
  role: 'user' | 'assistant'
  content: string
  createdAt: string
}

/** Sent to the Advisor: the running conversation plus optional context about what the user is working on. */
export interface AdvisorRequest {
  messages: { role: 'user' | 'assistant'; content: string }[]
  /** Free-text context (current topic / script excerpt / styles) so the advisor can reason about the actual task. */
  context?: string
}

/**
 * The AI Command Panel ("Studio Agent"). The user types a plain-English request and
 * the active AI turns it into an ordered plan of SAFE, validated steps that the
 * already-tested engine executes end-to-end. As with the AI Director, the model only
 * decides WHAT (this small fixed set of steps with validated fields); the code does the
 * HOW — so the model can never run arbitrary code, ffmpeg, or touch the filesystem.
 */
export type AgentStep =
  | { type: 'write_script'; topic: string; lengthMinutes?: number; languageMix?: LanguageMix }
  | {
      type: 'build_video'
      /** Where the script comes from: a script written earlier in this run, the Script Pad, or inline text. */
      source: 'generated' | 'scriptpad' | 'text'
      title?: string
      body?: string
      style?: VideoStyle
      resolution?: VideoResolution
      /** A music bed mood to generate and lay under the narration ('none' = no music). */
      musicMood?: Mood | 'none'
      soundEffects?: boolean
      /** Generate free AI visuals (one image per scene) instead of the animated look. */
      aiVisuals?: boolean
    }
  | { type: 'make_thumbnail'; headline: string; style?: VideoStyle; aiBackground?: boolean }
  | { type: 'generate_image'; prompt: string; style?: VideoStyle }
  | { type: 'generate_ideas'; focus: string; count?: number }
  // ── Tabs the agent can also operate (create/edit only — never deletes or publishes) ──
  /** Writes (or appends to) the Script Pad tab. */
  | { type: 'write_scriptpad'; text: string; title?: string; append?: boolean }
  /** Fetches LIVE PSX data for a symbol and analyses it; optionally writes a narration script. */
  | { type: 'analyze_psx'; symbol: string; language?: string; makeScript?: boolean }
  /** Generates a music bed of the given mood/length (DJ Station / audio). */
  | { type: 'generate_music'; mood: Mood; seconds?: number }
  /** Plans the scene breakdown (Scene Studio) from this run's script or the Script Pad. */
  | { type: 'plan_scenes'; source?: 'generated' | 'scriptpad'; style?: VideoStyle; direction?: string }

export type AgentStepType = AgentStep['type']

// ─────────────────────────── Timeline NLE ───────────────────────────
/** One video clip on the timeline: a source file trimmed to [inSec, outSec]. */
export interface TimelineVideoClip {
  id: string
  src: string
  /** Source in-point (seconds into the file). */
  inSec: number
  /** Source out-point (seconds into the file). */
  outSec: number
  /** Crossfade INTO this clip from the previous one, in seconds (0/undefined = hard cut). */
  transitionSec?: number
  /** UI label only. */
  name?: string
}

/** One audio clip on the timeline, placed at `atSec` on the master timeline. */
export interface TimelineAudioClip {
  id: string
  src: string
  inSec: number
  outSec: number
  /** Position on the master timeline (seconds). */
  atSec: number
  /** Linear gain (0 = mute, 1 = unchanged). */
  gain?: number
  fadeInSec?: number
  fadeOutSec?: number
  name?: string
}

/** A text overlay drawn over the video between [startSec, endSec]. */
export interface TimelineTextOverlay {
  id: string
  text: string
  startSec: number
  endSec: number
  x?: 'left' | 'center' | 'right'
  y?: 'top' | 'middle' | 'bottom'
  fontSize?: number
  /** Fade in/out ramp length in seconds. */
  fadeSec?: number
}

/** A full timeline project. Video and audio are separate tracks. */
export interface TimelineDoc {
  width: number
  height: number
  fps: number
  video: TimelineVideoClip[]
  audio: TimelineAudioClip[]
  text: TimelineTextOverlay[]
}

// ─────────────────────────── Storyboard Director ───────────────────────────
/** Who/what is on screen for a beat. The user keeps their REAL face via 'photo'/'clip'. */
/**
 * GRAFT region — how the moving part of the user's video is composited onto their
 * picture ("living picture"). All values normalized 0..1 of the respective frame.
 */
export interface GraftRegion {
  /** Source rect in the VIDEO (top-left x/y + width/height). */
  sx: number
  sy: number
  sw: number
  sh: number
  /** Destination on the PICTURE frame: top-left x/y + width (height follows the source aspect). */
  dx: number
  dy: number
  dw: number
  /** Edge feather as a fraction of the grafted part's width (0 = hard cut). */
  featherFrac: number
  /** Colour tweak so the part sits naturally on the picture. */
  brightness: number
  saturation: number
}

export type ShotSubjectKind = 'none' | 'photo' | 'clip' | 'ai-person'

export interface ShotSubject {
  kind: ShotSubjectKind
  /** For 'ai-person': a description of the character to generate. */
  description?: string
  /** For 'clip': the user's own footage file (optional at plan time; filled in the UI). */
  src?: string
  /** For 'photo': beautify the composited photo. */
  beautify?: boolean
}

/** Ken-Burns / camera motion hint for a beat. */
export type ShotMotion = 'still' | 'in' | 'out' | 'left' | 'right' | 'up' | 'down'

/** A sound attached to a beat: a generated music bed, a generated SFX, or the user's own file. */
export interface BeatSound {
  id: string
  kind: 'music' | 'sfx' | 'file'
  /** Music mood (a Mood) or SFX kind (a SfxKind) when generated. Ignored for 'file'. */
  ref?: string
  /** The user's own audio file when kind === 'file'. */
  src?: string
  /** Linear gain (0 = mute, 1 = unchanged). */
  gain?: number
  fadeInSec?: number
  fadeOutSec?: number
  /** Start offset within the beat, in seconds (0 = at the beat's start). */
  atSec?: number
  /** UI label only. */
  name?: string
}

/** One beat of the screenplay: a timed shot with a scene, a subject, narration and a caption. */
export interface StoryboardBeat {
  id: string
  /** How long this beat lasts, in seconds. */
  durationSec: number
  /** What the camera shows — the scene/background description (fed to free image gen). */
  visual: string
  /** Spoken narration for this beat (TTS). Optional. */
  narration?: string
  /** Optional on-screen text overlay for this beat. */
  caption?: string
  /** Who is on screen. */
  subject: ShotSubject
  /** Crossfade INTO this beat from the previous one, seconds (0 = hard cut). */
  transitionSec?: number
  /** Camera motion hint. */
  motion?: ShotMotion
  /** Mood tag for this beat (e.g. 'triumphant', 'somber'). */
  mood?: string
  /** Per-beat sounds: music beds, SFX, or the user's own audio, mixed under this shot. */
  sounds?: BeatSound[]
}

/** A full storyboard the director compiles into a TimelineDoc and renders. */
export interface StoryboardDoc {
  title: string
  style: VideoStyle
  width: number
  height: number
  fps: number
  /** Narration language, e.g. 'English', 'Roman Urdu', 'Urdu'. */
  language?: string
  beats: StoryboardBeat[]
}

/** The agent's reading of a command: an ordered plan (possibly empty) + a plain-English reply. */
export interface AgentPlan {
  /** Short plain-English summary of what it will do, or the answer when there are no steps. */
  reply: string
  steps: AgentStep[]
}

/** The outcome of one executed step, surfaced to the UI. */
export interface AgentStepResult {
  type: AgentStepType
  /** Human-readable label of what this step did. */
  label: string
  ok: boolean
  /** A produced artifact path (thumbnail), if any. */
  path?: string
  /** A produced video job (build step), so the UI can play/list it. */
  video?: VideoJob
  /** Extra detail on success (e.g. the generated script title). */
  detail?: string
  error?: string
}

export interface AgentRunResult {
  results: AgentStepResult[]
}

/** Ready-to-paste posting text for a finished clip (YouTube/TikTok/Reels). */
export interface PostMetadata {
  title: string
  description: string
  hashtags: string[]
}

export type HealthStatus = 'ok' | 'warn' | 'fail'
export interface HealthCheck {
  name: string
  status: HealthStatus
  /** Plain-English verdict — never contains key material. */
  detail: string
}
export interface HealthReport {
  checkedAt: string
  checks: HealthCheck[]
  failCount: number
  warnCount: number
}

export type ActivityActor = 'ai' | 'user'

export interface ActivityLogEntry {
  id: string
  timestamp: string
  actor: ActivityActor
  action: string
  details?: string
}
