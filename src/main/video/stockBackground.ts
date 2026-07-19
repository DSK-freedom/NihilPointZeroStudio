/**
 * Assembles a real-footage background video from free stock clips matched to a
 * script. For each on-screen section it picks a relevant clip (searched by the
 * section's keyword, with the video title as a fallback), scales/crops it to fill the
 * frame, loops/trims it to the section's duration, and concatenates the segments into
 * one bg.mp4 — which the renderer then overlays the title/cards/waveform onto.
 *
 * Returns the bg.mp4 path, or throws if no footage could be fetched at all (offline /
 * bad key / no results) so the caller falls back to the animated visualizer.
 */
import { mkdtempSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { runFfmpeg } from './ffmpeg'
import { chooseEncoderForJob, runEncodeWithFallback } from './encoder'
import { extractCards, type Layout } from './render'
import { downloadStockClip, sanitizeKeyword, searchStockVideos, type StockClip } from '../data/stockFootage'

export interface StockBackgroundOptions {
  title: string
  body: string
  layout: Layout
  durationSec: number
  apiKey: string
  onProgress?: (stage: string) => void
}

/** Builds the queries to search: each section keyword, then the title as a fallback. */
export function stockQueries(title: string, body: string): string[] {
  const cards = extractCards(body, title).map(sanitizeKeyword).filter(Boolean)
  const titleKw = sanitizeKeyword(title)
  const queries = [...cards]
  if (titleKw) queries.push(titleKw)
  // De-dup while keeping order.
  return [...new Set(queries)]
}

export async function buildStockBackground(opts: StockBackgroundOptions): Promise<string> {
  const { title, body, layout, durationSec, apiKey, onProgress } = opts
  const cards = extractCards(body, title)
  const nSections = Math.max(1, cards.length)
  const secDur = durationSec / nSections
  const scratch = mkdtempSync(join(tmpdir(), 'stockbg-'))

  onProgress?.('Finding matching stock footage…')
  // Build a pool of clips from the section keywords + title, de-duplicated by id.
  const pool: StockClip[] = []
  const seen = new Set<string>()
  for (const q of stockQueries(title, body)) {
    if (pool.length >= nSections + 2) break
    const clips = await searchStockVideos(q, apiKey, layout.w, 4)
    for (const c of clips) {
      if (!seen.has(c.id)) {
        seen.add(c.id)
        pool.push(c)
      }
    }
  }
  if (!pool.length) throw new Error('No stock footage found (offline, bad key, or no matches).')

  // Same safe encoder choice as the main render (8K → CPU), with a runtime fallback.
  const encoder = await chooseEncoderForJob(layout.w, layout.h, secDur)

  // Download + build one segment per section, cycling the pool.
  const segPaths: string[] = []
  for (let i = 0; i < nSections; i++) {
    const clip = pool[i % pool.length]
    onProgress?.(`Preparing footage ${i + 1}/${nSections}…`)
    const raw = join(scratch, `clip${i}.mp4`)
    try {
      await downloadStockClip(clip.url, raw)
    } catch {
      // Skip a bad download; if we end up with zero segments we throw below.
      continue
    }
    const seg = join(scratch, `seg${i}.mp4`)
    await runEncodeWithFallback(
      encoder,
      (encArgs) => [
        '-y', '-stream_loop', '-1', '-i', raw, '-t', secDur.toFixed(3), '-an',
        '-vf', `scale=${layout.w}:${layout.h}:force_original_aspect_ratio=increase,crop=${layout.w}:${layout.h},setsar=1,fps=25`,
        ...encArgs, '-r', '25', seg
      ],
      { onNotice: onProgress }
    )
    segPaths.push(seg)
  }
  if (!segPaths.length) throw new Error('Could not prepare any stock footage segments.')

  // Concatenate the segments into the final background.
  const listPath = join(scratch, 'list.txt')
  writeFileSync(listPath, segPaths.map((p) => `file '${p.replace(/\\/g, '/')}'`).join('\n'), 'utf-8')
  const bgPath = join(scratch, 'bg.mp4')
  await runFfmpeg(['-y', '-f', 'concat', '-safe', '0', '-i', listPath, '-c', 'copy', bgPath])
  return bgPath
}
