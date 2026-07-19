import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { dirname, join } from 'path'
import { stripStageDirections, synthesizeSpeechToFile } from '../voiceover'
import { isPiperInstalled, synthesizeWithPiper } from '../voice/piper'
import {
  beginRenderSession,
  ffprobeDuration,
  makeFfmpegProgressLogger,
  renderSessionSignal,
  runFfmpeg,
  throwIfCancelled
} from './ffmpeg'
import { attachVoiceover, computeLayout, renderVideo, type VideoResolution } from './render'
import { buildStockBackground } from './stockBackground'
import { buildExportArgs, type ExportFormat } from './export'
import { buildTrimArgs, clampRange, type TrimMode } from './trim'
import { buildStitchArgs } from './stitch'
import { buildSetMusicArgs, type MusicMode } from './music'
import { buildTimelineArgs, videoTrackDuration } from './timeline'
import { buildBeautifyArgs, type BeautifyOptions } from './beautify'
import { buildCompositeArgs, type CompositeOptions } from './composite'
import { chooseEncoderForJob, runEncodeWithFallback } from './encoder'
import type { TimelineDoc } from '../../shared/types'
import { ffprobeVideoSize } from './ffmpeg'
import { generateCloudFootage } from './aiCloud'
import { generateLocalFootage } from './aiLocal'
import { extractCards, extractScenePrompts } from './render'
import { generateImage, sceneImagePrompt } from '../image'
import type { LookEngine, VideoStyle } from '../../shared/types'

export { ffprobeDuration } from './ffmpeg'
export type { VideoResolution } from './render'
export { EXPORT_FORMATS, formatExtension, type ExportFormat } from './export'
export type { TrimMode } from './trim'
export { renderThumbnail } from './thumbnail'

export interface BuildVideoOptions {
  /** Output resolution — 1080p (default), 1440p, 4k, or 8k. */
  resolution?: VideoResolution
  /** Frame shape — 16:9 (default), 9:16 (Shorts/Reels), or 1:1 (square). */
  aspect?: import('./render').VideoAspect
  /** Graphics v2 finishing template (clean/news/cinematic/bold). */
  template?: import('./templates').VideoTemplate
  /** Optional background music file, mixed (volume-lowered, faded) under the narration. */
  musicPath?: string
  /** Add a soft transition sound at each section change. */
  soundEffects?: boolean
  /** Look engine (default 'presets'). */
  engine?: LookEngine
  /** Visual style for the preset engine (default 'cinematic'). */
  style?: VideoStyle
  /** Optional user image paths for a Ken-Burns slideshow background. */
  images?: string[]
  /** Use real stock footage (online) matched to the script. */
  useStock?: boolean
  /** Pixabay API key for stock footage (required when useStock). */
  stockApiKey?: string
  /** Called once with a small opening-frame preview PNG, so the UI can show the look early. */
  onPreview?: (pngPath: string) => void
  /** If set, the narration WAV is copied here (persisted) so music can later be removed/replaced. */
  narrationOutPath?: string
  /** Which computer voice to narrate with: 'windows' (default) or 'piper' (natural, if installed). */
  narrationVoice?: 'windows' | 'piper'
}

/**
 * Full pipeline: script → free Windows-TTS narration → measured duration →
 * rendered MP4 (1080p or 4K, optional background music) at outPath. Reports
 * coarse progress stages.
 */
export async function buildVideoFromScript(
  title: string,
  body: string,
  outPath: string,
  onProgress?: (stage: string) => void,
  options: BuildVideoOptions = {}
): Promise<void> {
  // Clear any leftover Stop from a previous build so this fresh one isn't aborted.
  beginRenderSession()
  const scratch = mkdtempSync(join(tmpdir(), 'finscript-vid-'))
  const wav = join(scratch, 'narration.wav')
  try {
    // Voice priority: use the NATURAL (Piper) voice whenever it's installed, unless the
    // user explicitly picked the robotic Windows voice. This makes "natural" the default
    // for every entry point (Video Studio, Scene Studio, AI Command, batch) instead of
    // silently defaulting to the robotic voice when narrationVoice is left unset.
    const wantNatural = options.narrationVoice !== 'windows'
    if (wantNatural && isPiperInstalled()) {
      onProgress?.('Generating narration (natural voice)…')
      await synthesizeWithPiper(stripStageDirections(body), wav)
    } else {
      onProgress?.('Generating narration (Windows voice)…')
      await synthesizeSpeechToFile(body, wav)
    }
    throwIfCancelled()
    onProgress?.('Measuring narration length…')
    const durationSec = await ffprobeDuration(wav)
    // Persist the narration-only track so background music can later be removed/replaced exactly.
    if (options.narrationOutPath) {
      try {
        writeFileSync(options.narrationOutPath, readFileSync(wav))
      } catch {
        /* non-fatal: music editing just won't be available for this video */
      }
    }
    const label = (options.resolution ?? '1080p').toUpperCase()

    const engine = options.engine ?? 'presets'
    // AI engines generate footage from a prompt, then we lay the narration over it.
    // They throw an instructive error if not configured/detected — the free preset
    // engine (default) always works offline.
    let aiFootage: string | undefined
    // FREE per-scene AI visuals: generate a unique image per script section and animate
    // them. Keyless/no-install; needs internet. Any failure falls back to the animated
    // look below so the build never breaks.
    let aiImages: string[] | undefined
    if (engine === 'ai-cloud') {
      onProgress?.('Generating AI footage (cloud)…')
      aiFootage = await generateCloudFootage({ title, body, durationSec, style: options.style, resolution: options.resolution })
    } else if (engine === 'ai-local') {
      onProgress?.('Generating AI footage (local GPU)…')
      aiFootage = await generateLocalFootage({ title, body, durationSec, style: options.style, resolution: options.resolution })
    } else if (engine === 'ai-free') {
      const style = options.style ?? 'cinematic'
      // Prefer the writer's OWN [bracketed cinematic directions] as the scene prompts so the
      // images FOLLOW the script shot-for-shot. Only when the script has none do we derive
      // scenes from the prose. Explicit shots are honoured up to 30 (each is an intended
      // distinct image); prose-derived scenes scale to length (~1 per 45s, 4–16).
      const bracketed = extractScenePrompts(body)
      const scenes = bracketed.length
        ? bracketed.slice(0, 30)
        : extractCards(body, title).slice(0, Math.min(16, Math.max(4, Math.round(durationSec / 45))))
      if (bracketed.length) {
        onProgress?.(`Found ${scenes.length} scene directions in your script — generating one image each…`)
      }
      const made: string[] = []
      for (let i = 0; i < scenes.length; i++) {
        throwIfCancelled() // Stop pressed mid-download must halt the loop, not finish all scenes.
        onProgress?.(`Generating AI visual ${i + 1}/${scenes.length} (free)…`)
        try {
          const imgPath = join(scratch, `ai-scene-${i}.jpg`)
          // signal: a Stop aborts the in-flight generation/download immediately instead of
          // letting the full retry/backoff/timeout cycle run before the next cancel poll.
          await generateImage(sceneImagePrompt(style, scenes[i], title), imgPath, {
            width: 1280,
            height: 720,
            seed: i + 1,
            signal: renderSessionSignal()
          })
          made.push(imgPath)
          if (made.length === 1) options.onPreview?.(imgPath) // show the first one right away
        } catch (err) {
          onProgress?.(`AI visual ${i + 1} failed (${err instanceof Error ? err.message : 'error'}) — continuing…`)
        }
      }
      if (made.length) aiImages = made
      else onProgress?.('Free AI visuals unavailable — using the animated look instead.')
    }

    // Free stock-footage background (online): try to assemble real B-roll matched to
    // the script; on ANY failure (offline, bad key, no matches) fall back silently to
    // the animated visualizer so the build never breaks. This is the "use the internet
    // when it helps, otherwise be creative offline" behaviour.
    let stockBg: string | undefined
    if (!aiFootage && options.useStock && options.stockApiKey && engine === 'presets') {
      try {
        stockBg = await buildStockBackground({
          title,
          body,
          layout: computeLayout(options.resolution, options.aspect),
          durationSec,
          apiKey: options.stockApiKey,
          onProgress
        })
      } catch (err) {
        onProgress?.(`Stock footage unavailable (${err instanceof Error ? err.message : 'error'}) — using the animated look instead.`)
      }
    }

    throwIfCancelled()
    onProgress?.(
      `Rendering ${label} video (~${Math.round(durationSec)}s${options.musicPath ? ', with music' : ''}${options.soundEffects ? ', with SFX' : ''})…`
    )
    await renderVideo({
      title,
      body,
      audioPath: wav,
      durationSec,
      outPath,
      resolution: options.resolution,
      aspect: options.aspect,
      template: options.template,
      musicPath: options.musicPath,
      soundEffects: options.soundEffects,
      style: options.style,
      backgroundVideo: stockBg,
      // Background priority: AI cloud/local footage clip → free per-scene AI images →
      // the user's own images. Each goes through the Ken-Burns slideshow path.
      images: aiFootage ? [aiFootage] : (aiImages ?? options.images),
      onProgress,
      onPreview: options.onPreview
    })
    if (stockBg) {
      try {
        rmSync(dirname(stockBg), { recursive: true, force: true })
      } catch {
        /* temp cleanup best-effort */
      }
    }
    onProgress?.('Finalizing…')
  } finally {
    rmSync(scratch, { recursive: true, force: true })
  }
}

/**
 * Transcodes a finished video into a chosen delivery format at `outPath`. Pure arg
 * construction lives in ./export (unit-tested); this just runs ffmpeg.
 */
export async function exportVideo(
  srcPath: string,
  format: ExportFormat,
  outPath: string,
  onLog?: (line: string) => void
): Promise<void> {
  await runFfmpeg(buildExportArgs(format, srcPath, outPath), onLog)
}

/**
 * Cuts a finished video: keep only [start, end] or remove that range. Measures the
 * real duration via ffprobe, clamps the requested range, and re-encodes at `outPath`.
 * Non-destructive — the caller keeps the original.
 */
export async function trimVideo(
  srcPath: string,
  mode: TrimMode,
  start: number,
  end: number,
  outPath: string,
  onLog?: (line: string) => void
): Promise<void> {
  const duration = await ffprobeDuration(srcPath)
  const range = clampRange(start, end, duration)
  await runFfmpeg(buildTrimArgs(mode, srcPath, range, duration, outPath), onLog)
}

/**
 * Stitches multiple built videos into one at `outPath`. Uses the first video's
 * resolution as the target, scales/pads the rest to match, and picks the fast
 * encoder. Non-destructive.
 */
export async function stitchVideos(
  inputs: string[],
  outPath: string,
  onLog?: (line: string) => void
): Promise<void> {
  if (inputs.length < 2) throw new Error('Pick at least two videos to stitch.')
  const [width, height] = await ffprobeVideoSize(inputs[0])
  // Rough total duration for the encoder heuristic: sum of durations.
  let total = 0
  for (const p of inputs) total += await ffprobeDuration(p).catch(() => 0)
  const encoder = await chooseEncoderForJob(width, height, total)
  await runEncodeWithFallback(
    encoder,
    (encoderArgs) => buildStitchArgs({ inputs, width, height, encoderArgs, outPath }),
    // Real percentage while stitching (total = summed input durations).
    { onLog: makeFfmpegProgressLogger(total, onLog, undefined, 'Stitching'), onNotice: onLog }
  )
}

/**
 * Removes or replaces a built video's background music while keeping the narration
 * exactly — uses the saved narration track, so no AI separation is needed. Produces a
 * new MP4 (original kept). `musicPath` is required for 'replace'.
 */
export async function setVideoMusic(
  videoPath: string,
  narrationPath: string,
  mode: MusicMode,
  musicPath: string | undefined,
  outPath: string,
  onLog?: (line: string) => void
): Promise<void> {
  await runFfmpeg(buildSetMusicArgs({ mode, videoPath, narrationPath, musicPath, outPath }), onLog)
}

/**
 * Renders a Timeline NLE project to a single MP4 at `outPath`. Picks the fast
 * encoder for the project's size/length and rebuilds args per attempt (so the
 * HW→CPU fallback works). The timing-critical arg construction is the pure,
 * unit-tested `buildTimelineArgs` (see ./timeline).
 */
export async function renderTimeline(
  doc: TimelineDoc,
  outPath: string,
  onLog?: (line: string) => void
): Promise<void> {
  beginRenderSession() // don't inherit a Stop from a previous build
  if (!doc.video.length) throw new Error('Add at least one video clip to the timeline before rendering.')
  const total = videoTrackDuration(doc)
  const encoder = await chooseEncoderForJob(doc.width, doc.height, total)
  // Show a real percentage during the encode instead of raw ffmpeg stderr spam.
  await runEncodeWithFallback(encoder, (encoderArgs) => buildTimelineArgs(doc, encoderArgs, outPath), {
    onLog: makeFfmpegProgressLogger(total, onLog),
    onNotice: onLog
  })
}

/** Beautifies (or roughens) one image to `out` using the pure, tested filter chain. */
export async function beautifyImage(input: string, out: string, opts: BeautifyOptions): Promise<void> {
  await runFfmpeg(buildBeautifyArgs(input, out, opts))
}

/** Composites an RGBA subject cutout (input 1) over a background scene (input 0) to `out`. */
export async function compositeImage(bgPath: string, subjectPath: string, out: string, opts: CompositeOptions): Promise<void> {
  await runFfmpeg(buildCompositeArgs(bgPath, subjectPath, out, opts))
}

/** Replaces a built video's narration with the user's own recorded audio bytes. */
export async function attachRecordedVoice(
  videoPath: string,
  audioBytes: Uint8Array,
  outPath: string
): Promise<void> {
  const scratch = mkdtempSync(join(tmpdir(), 'finscript-voice-'))
  const audio = join(scratch, 'voice.webm')
  try {
    writeFileSync(audio, Buffer.from(audioBytes))
    await attachVoiceover(videoPath, audio, outPath)
  } finally {
    rmSync(scratch, { recursive: true, force: true })
  }
}
