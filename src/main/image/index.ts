/**
 * FREE, keyless AI image generation via Pollinations' hosted image endpoint. No API
 * key, no signup, no install — just internet. Used for real AI thumbnails, for
 * per-scene AI "footage" visuals, and for generating objects (a car, a rocket…) from
 * a description in the AI Command panel.
 *
 * Images are generated at a sensible 16:9 size and the video engine scales them to the
 * chosen resolution — generating at the full 8K would be slow/unreliable on a free tier.
 */
import { writeFileSync } from 'fs'
import { logAiError } from '../llm/errorLog'
import { styleById } from './styles'

const BASE = 'https://image.pollinations.ai/prompt/'

export interface ImageGenOptions {
  width?: number
  height?: number
  /** Deterministic seed (varies the image when changed). */
  seed?: number
  /** Pollinations model: 'flux' (default, best) or 'turbo' (faster/more reliable). */
  model?: string
  /** How many times to try before giving up (default 4). */
  attempts?: number
  /** Per-attempt timeout in ms (default 60s — flux can be slow but must not hang forever). */
  timeoutMs?: number
  /** Abort signal — lets a Stop cancel an in-flight download immediately. */
  signal?: AbortSignal
}

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms))

/** One HTTP attempt with a hard timeout, so a hung request can't stall the whole build. */
async function fetchImageOnce(
  prompt: string,
  outPath: string,
  width: number,
  height: number,
  model: string,
  seed: number | undefined,
  timeoutMs: number,
  external?: AbortSignal
): Promise<void> {
  const params = new URLSearchParams({
    width: String(width),
    height: String(height),
    nologo: 'true',
    model,
    referrer: 'nihilpointzero-studio'
  })
  if (seed !== undefined) params.set('seed', String(seed))
  const url = `${BASE}${encodeURIComponent(prompt.slice(0, 1500))}?${params.toString()}`

  const ctrl = new AbortController()
  const timer = setTimeout(() => ctrl.abort(), timeoutMs)
  // Chain the caller's Stop signal into our controller.
  const onExternalAbort = (): void => ctrl.abort()
  if (external) {
    if (external.aborted) ctrl.abort()
    else external.addEventListener('abort', onExternalAbort, { once: true })
  }
  try {
    const res = await fetch(url, { signal: ctrl.signal })
    if (!res.ok) throw new Error(`Free image service returned ${res.status}. It can get busy — retrying.`)
    const buf = Buffer.from(await res.arrayBuffer())
    // Pollinations sometimes returns a tiny placeholder/error body instead of a real JPEG.
    if (buf.length < 2000) throw new Error('Free image service returned an empty image.')
    writeFileSync(outPath, buf)
  } finally {
    clearTimeout(timer)
    if (external) external.removeEventListener('abort', onExternalAbort)
  }
}

/**
 * Generates one image from a text prompt and writes it to `outPath`. Returns the path.
 *
 * The free Pollinations endpoint (especially the high-quality `flux` model) frequently
 * returns 502/503 or times out under load — a single-shot request meant most scenes in a
 * build failed and were skipped ("only 1–2 of 8 images generated"). So we retry with
 * backoff and, on the last attempts, fall back to the faster/more reliable `turbo` model
 * so a scene ends up with SOME real image rather than none. Only throws if every attempt
 * fails, letting the caller fall back to the animated look.
 */
export async function generateImage(prompt: string, outPath: string, opts: ImageGenOptions = {}): Promise<string> {
  const width = opts.width ?? 1280
  const height = opts.height ?? 720
  const attempts = Math.max(1, opts.attempts ?? 5)
  const timeoutMs = opts.timeoutMs ?? 60_000
  // Try the requested model (default flux) for the first attempts, then drop to turbo,
  // which is markedly more reliable when the queue is busy.
  const primary = opts.model ?? 'flux'
  let lastErr: unknown
  for (let i = 0; i < attempts; i++) {
    if (opts.signal?.aborted) throw new Error('Render cancelled by user.')
    const model = i >= attempts - 1 && primary !== 'turbo' ? 'turbo' : primary
    try {
      await fetchImageOnce(prompt, outPath, width, height, model, opts.seed, timeoutMs, opts.signal)
      return outPath
    } catch (err) {
      lastErr = err
      if (opts.signal?.aborted) throw new Error('Render cancelled by user.', { cause: err })
      // Exponential backoff with ±40% jitter, capped at 12s. The jitter matters: several
      // scenes generating in parallel used to retry in LOCKSTEP, hammering the busy free
      // queue at the same instants — so whole batches failed together.
      if (i < attempts - 1) await sleep(Math.min(12_000, 1200 * 2 ** i) * (0.6 + Math.random() * 0.8))
    }
  }
  const detail = lastErr instanceof Error ? lastErr.message : 'unknown error'
  logAiError({
    at: new Date().toISOString(),
    provider: `free-image/${primary}`,
    feature: 'image',
    message: `gave up after ${attempts} tries: ${detail}`
  })
  throw new Error(
    `Free image service failed after ${attempts} tries (${detail}). ` +
      `It can get busy — the video will use the animated look for this scene.`
  )
}

/**
 * Builds a clean image prompt for a scene: the visual style + the scene text + the
 * video's topic, steering away from on-screen text (the renderer adds titles itself).
 */
export function sceneImagePrompt(style: string, scene: string, title: string): string {
  // LEAD with the user's own visual concept so the image matches their bracketed direction
  // (its subject, mood AND colours) instead of being overridden by a fixed dark "dramatic"
  // style string — that override was why images looked mismatched and washed-out/dark.
  const styleText = styleById(style).prompt
  const subject = [scene, title].filter(Boolean).join('. ')
  return `${subject}. Style: ${styleText}. Accurate rich colour, high detail, professional, no text, no watermark, no letters, no captions, no subtitles.`
}
