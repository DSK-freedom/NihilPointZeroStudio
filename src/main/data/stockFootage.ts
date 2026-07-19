/**
 * Free stock-VIDEO search + download via Pixabay (and Pexels-ready). The user
 * supplies a free API key; footage is real, license-clear (Pixabay Content License,
 * free for commercial use, no attribution required). Used to assemble real B-roll
 * under a narration — the "make a video from my script" feature. Offline or on
 * failure, callers fall back to the animated visualizer.
 *
 * `pickClipUrl` and `sanitizeKeyword` are pure + unit-tested; the network functions
 * degrade gracefully (never throw on a bad connection — they return []).
 */
import { writeFileSync } from 'fs'

export interface StockClip {
  id: string
  /** Best downloadable MP4 url for the requested size. */
  url: string
  width: number
  height: number
  durationSec: number
  tags: string
  pageUrl?: string
}

interface PixabayVideoFile {
  url: string
  width: number
  height: number
  size: number
}
interface PixabayHit {
  id: number
  duration: number
  tags: string
  pageURL?: string
  videos: Record<string, PixabayVideoFile>
}

/** Cleans a phrase into a good search keyword (letters/numbers/spaces, trimmed). */
export function sanitizeKeyword(text: string): string {
  return text.replace(/[^A-Za-z0-9 ]/g, ' ').replace(/\s+/g, ' ').trim().toLowerCase()
}

/**
 * Chooses the best Pixabay video rendition for a target width: the smallest one that
 * is still ≥ target (to avoid upscaling), else the largest available. Pure + tested.
 */
export function pickClipUrl(videos: Record<string, PixabayVideoFile>, targetWidth: number): PixabayVideoFile | null {
  const files = Object.values(videos).filter((v) => v && v.url)
  if (!files.length) return null
  const bigEnough = files.filter((v) => v.width >= targetWidth).sort((a, b) => a.width - b.width)
  if (bigEnough.length) return bigEnough[0]
  return files.sort((a, b) => b.width - a.width)[0]
}

/**
 * Searches Pixabay for videos matching `query`. Returns [] on any failure (offline,
 * bad key, no results) so the caller can fall back gracefully.
 */
export async function searchStockVideos(query: string, key: string, targetWidth = 1920, count = 5): Promise<StockClip[]> {
  const q = sanitizeKeyword(query)
  if (!key || !q) return []
  const url = `https://pixabay.com/api/videos/?key=${encodeURIComponent(key)}&q=${encodeURIComponent(q)}&per_page=${Math.max(3, count)}&safesearch=true`
  try {
    const res = await fetch(url, {
      headers: { 'User-Agent': 'NIHILPOINTZERO-OS/1.0', Accept: 'application/json' },
      signal: AbortSignal.timeout(20_000)
    })
    if (!res.ok) return []
    const data = (await res.json()) as { hits?: PixabayHit[] }
    const clips: StockClip[] = []
    for (const h of data.hits ?? []) {
      const file = pickClipUrl(h.videos, targetWidth)
      if (file) clips.push({ id: String(h.id), url: file.url, width: file.width, height: file.height, durationSec: h.duration, tags: h.tags, pageUrl: h.pageURL })
    }
    return clips
  } catch {
    return []
  }
}

/** Downloads a stock clip to `outPath`. Throws on failure (caller handles). */
export async function downloadStockClip(url: string, outPath: string): Promise<void> {
  const res = await fetch(url, {
    headers: { 'User-Agent': 'NIHILPOINTZERO-OS/1.0' },
    signal: AbortSignal.timeout(300_000) // video files are large — generous, never infinite
  })
  if (!res.ok) throw new Error(`Stock clip download failed (HTTP ${res.status}).`)
  const buf = Buffer.from(await res.arrayBuffer())
  if (!buf.length) throw new Error('Downloaded stock clip was empty.')
  writeFileSync(outPath, buf)
}
