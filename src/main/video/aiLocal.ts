/**
 * Local AI-footage engine (🟢 free per video — but needs a capable GPU). It talks to
 * a generation server you run on your own machine (e.g. an AUTOMATIC1111 / ComfyUI /
 * custom endpoint). Free at inference time, but the model + GPU are NOT bundled: this
 * engine is OPTIONAL and portability-limited, so the free preset engine stays the
 * default and always works offline.
 *
 * Expected local contract (configure the base URL in Settings → AI Video):
 *   GET  {localEndpoint}/health   -> 200 when the server is up
 *   POST {localEndpoint}/generate -> { prompt, seconds, width, height } -> video bytes
 *     (either raw video/* body, or JSON { videoUrl } we then download)
 */
import { writeFileSync, mkdtempSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'
import { getAiVideoConfig } from '../store'
import { buildFootagePrompt, type AiFootageRequest } from './aiCloud'

const DEFAULT_ENDPOINT = 'http://127.0.0.1:7860'

function endpoint(): string {
  return getAiVideoConfig().localEndpoint || DEFAULT_ENDPOINT
}

/** Pings the local server's /health; returns false on any error (not detected). */
export async function detectLocal(): Promise<boolean> {
  try {
    const res = await fetch(`${endpoint()}/health`, { method: 'GET', signal: AbortSignal.timeout(5_000) })
    return res.ok
  } catch {
    return false
  }
}

const RES_WH: Record<string, [number, number]> = {
  '1080p': [1920, 1080],
  '1440p': [2560, 1440],
  '4k': [3840, 2160],
  '8k': [7680, 4320]
}

/**
 * Generates footage via the local server and returns a local file path. Throws an
 * instructive error when the server isn't detected.
 */
export async function generateLocalFootage(req: AiFootageRequest): Promise<string> {
  if (!(await detectLocal())) {
    throw new Error(
      'Local AI footage server not detected. This engine is FREE per video but needs a capable GPU and a local ' +
        'text-to-video server (e.g. ComfyUI/AnimateDiff or Stable Video Diffusion) running on this PC. Start your ' +
        `server (default ${DEFAULT_ENDPOINT}) or set its URL under Settings → AI Video — or switch to “Style presets (free)”.`
    )
  }
  const [w, h] = RES_WH[req.resolution ?? '1080p']
  const res = await fetch(`${endpoint()}/generate`, {
    method: 'POST',
    // Local text-to-video generation is legitimately slow — generous, but never infinite.
    signal: AbortSignal.timeout(15 * 60_000),
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ prompt: buildFootagePrompt(req), seconds: Math.max(1, Math.round(req.durationSec)), width: w, height: h })
  })
  if (!res.ok) throw new Error(`Local AI server returned HTTP ${res.status}.`)
  const out = join(mkdtempSync(join(tmpdir(), 'ai-local-')), 'footage.mp4')
  const ct = res.headers.get('content-type') || ''
  if (ct.includes('application/json')) {
    const data = (await res.json()) as { videoUrl?: string; url?: string }
    const url = data.videoUrl || data.url
    if (!url) throw new Error('Local AI server did not return video data.')
    const dl = await fetch(url, { signal: AbortSignal.timeout(300_000) })
    if (!dl.ok) throw new Error(`Could not download local footage (HTTP ${dl.status}).`)
    writeFileSync(out, Buffer.from(await dl.arrayBuffer()))
  } else {
    writeFileSync(out, Buffer.from(await res.arrayBuffer()))
  }
  return out
}
