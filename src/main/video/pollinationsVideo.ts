/**
 * FREE-CLOUD real-video route #2: Pollinations' unified gen API.
 *
 * Why this exists: the Puter route needs a Puter account sign-in, and Puter's
 * verification does not accept phone numbers from every country (it rejected a
 * Pakistani number in practice, 2026-07-31). Pollinations registration is a
 * developer key from enter.pollinations.ai (GitHub/email — NO phone), and
 * registered users get a small DAILY Pollen grant that renews every day.
 *
 * Contract, verified live against gen.pollinations.ai/openapi.json (2026-07-31):
 *   GET https://gen.pollinations.ai/video/{prompt}?model=...&width=...&height=...
 *       &seed=...&duration=<1..120>          (Authorization: Bearer pk_/sk_ key)
 *   200 -> raw video/mp4 bytes
 *   401 -> no/invalid key · 402 -> Pollen used up · 429 -> too fast · 5xx -> their end
 *   GET https://gen.pollinations.ai/account/balance -> { balance: number }
 *
 * Cheapest real-motion model: wan-fast (Wan 2.2) at 0.01 Pollen/second — a 5s scene
 * costs ~0.05 Pollen, so even a small daily grant is several scenes every day.
 * Electron-free and config-passed-in, so the whole module is unit-testable.
 */
import { writeFileSync, mkdtempSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'

const BASE = 'https://gen.pollinations.ai'
export const DEFAULT_POLLINATIONS_VIDEO_MODEL = 'wan-fast'
/** Cloud video generation is legitimately slow — generous, but never infinite. */
const CLIP_TIMEOUT_MS = 10 * 60_000

/** Builds the generation URL. Pure + tested. */
export function buildPollinationsVideoUrl(opts: {
  prompt: string
  model?: string
  width: number
  height: number
  seed: number
  seconds: number
}): string {
  const model = (opts.model || DEFAULT_POLLINATIONS_VIDEO_MODEL).trim()
  const duration = Math.min(120, Math.max(1, Math.round(opts.seconds)))
  const q =
    `model=${encodeURIComponent(model)}&width=${Math.round(opts.width)}&height=${Math.round(opts.height)}` +
    `&seed=${Math.round(opts.seed)}&duration=${duration}`
  return `${BASE}/video/${encodeURIComponent(opts.prompt)}?${q}`
}

/** Turns an HTTP failure into the plain-English reason for the build log. Pure + tested. */
export function classifyPollinationsError(status: number, body?: string): string {
  if (status === 401) return 'the Pollinations key is missing or invalid — check Settings → AI Video'
  if (status === 402) return 'your free daily Pollen is used up for now (it renews every day)'
  if (status === 403) return 'this Pollinations key is not allowed to use that video model'
  if (status === 429) return 'Pollinations is rate-limiting — too many requests at once'
  if (status >= 500) return `Pollinations had a problem on their end (HTTP ${status})`
  const detail = (body || '').slice(0, 160)
  return `Pollinations returned HTTP ${status}${detail ? ` — ${detail}` : ''}`
}

/**
 * Validates a key WITHOUT spending any Pollen, via /account/balance. Returns the
 * balance so Settings can show it. Never throws.
 */
export async function checkPollinationsKey(key: string): Promise<{ ok: boolean; balance?: number; detail: string }> {
  if (!key.trim()) return { ok: false, detail: 'No key saved yet — get a free one at enter.pollinations.ai (no phone needed).' }
  try {
    const res = await fetch(`${BASE}/account/balance`, {
      headers: { Authorization: `Bearer ${key.trim()}` },
      signal: AbortSignal.timeout(10_000)
    })
    if (!res.ok) return { ok: false, detail: classifyPollinationsError(res.status, await res.text().catch(() => '')) }
    const data = (await res.json()) as { balance?: number }
    const balance = typeof data.balance === 'number' ? data.balance : undefined
    return {
      ok: true,
      balance,
      detail:
        balance !== undefined
          ? `Key works ✓ — ${balance.toFixed(2)} Pollen available (a 5s scene on wan-fast costs ~0.05).`
          : 'Key works ✓'
    }
  } catch {
    return { ok: false, detail: 'Could not reach Pollinations (offline?) — try again later.' }
  }
}

/**
 * Generates ONE real motion clip and returns a local MP4 path. Throws with a
 * classified plain-English reason on any failure — the caller decides the fallback
 * (per-scene slideshow still).
 */
export async function generatePollinationsClip(opts: {
  key: string
  model?: string
  prompt: string
  seconds: number
  width: number
  height: number
  seed: number
  signal?: AbortSignal
  onStatus?: (s: string) => void
}): Promise<string> {
  if (!opts.key.trim()) throw new Error('the Pollinations key is missing — add it in Settings → AI Video')
  if (opts.signal?.aborted) throw new Error('stopped')
  opts.onStatus?.('Asking Pollinations for real video (free daily Pollen)…')
  const url = buildPollinationsVideoUrl(opts)
  const timeout = AbortSignal.timeout(CLIP_TIMEOUT_MS)
  const anyFn = (AbortSignal as unknown as { any?: (s: AbortSignal[]) => AbortSignal }).any
  const signal = opts.signal && anyFn ? anyFn.call(AbortSignal, [opts.signal, timeout]) : (opts.signal ?? timeout)
  let res: Response
  try {
    res = await fetch(url, { headers: { Authorization: `Bearer ${opts.key.trim()}` }, signal })
  } catch (err) {
    if (opts.signal?.aborted) throw new Error('stopped', { cause: err })
    throw new Error(
      err instanceof Error && err.name === 'TimeoutError'
        ? 'the generation took too long'
        : 'Pollinations could not be reached (offline?)',
      { cause: err }
    )
  }
  if (!res.ok) throw new Error(classifyPollinationsError(res.status, await res.text().catch(() => '')))
  const buf = Buffer.from(await res.arrayBuffer())
  if (buf.length < 10_000) throw new Error('Pollinations returned an empty/placeholder response instead of a video')
  const out = join(mkdtempSync(join(tmpdir(), 'ai-pollin-')), 'clip.mp4')
  writeFileSync(out, buf)
  return out
}
