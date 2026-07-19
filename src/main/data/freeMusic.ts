/**
 * Online free-music search + download via Openverse (https://openverse.org) — an
 * Creative-Commons / public-domain media index run by WordPress/CC. Keyless and
 * legal: we only surface CC-licensed audio and always show the license. This is NOT
 * YouTube ripping.
 *
 * `rankTracks` is PURE (no network) and unit-tested; the network functions degrade
 * gracefully so an offline machine (e.g. a USB on a disconnected PC) never blocks —
 * the caller falls back to the built-in generator + bundled pack.
 */
import { writeFileSync } from 'fs'
import type { FreeTrack, MusicSearchResult } from '../../shared/types'

const ENDPOINT = 'https://api.openverse.org/v1/audio/'

/** Tokenizes a query into lowercase words for scoring. */
function tokens(s: string): string[] {
  return s.toLowerCase().split(/[^a-z0-9]+/).filter((w) => w.length > 1)
}

/** True for the most permissive licenses (public domain / CC0). */
function isVeryPermissive(license: string): boolean {
  const l = license.toLowerCase()
  return l === 'cc0' || l === 'pdm' || l.includes('publicdomain')
}

/**
 * Ranks tracks for a query: keyword overlap in title/artist, a bonus for permissive
 * licenses, and a bonus for having a directly usable audio URL. Returns a new sorted
 * array (stable — ties keep their original order). Pure + unit-tested.
 */
export function rankTracks(query: string, tracks: FreeTrack[]): FreeTrack[] {
  const q = tokens(query)
  const score = (t: FreeTrack): number => {
    let s = 0
    const title = t.title.toLowerCase()
    const artist = t.artist.toLowerCase()
    for (const w of q) {
      if (title.includes(w)) s += 2
      if (artist.includes(w)) s += 1
    }
    if (isVeryPermissive(t.license)) s += 3
    else if (t.license.toLowerCase().startsWith('by')) s += 1
    if (t.audioUrl) s += 2
    return s
  }
  return tracks
    .map((t, i) => ({ t, i, s: score(t) }))
    .sort((a, b) => (b.s - a.s) || (a.i - b.i))
    .map((x) => x.t)
}

interface OpenverseResult {
  id: string
  title?: string
  creator?: string
  license?: string
  license_url?: string
  foreign_landing_url?: string
  url?: string
  duration?: number // milliseconds
}

/**
 * Searches Openverse for CC audio matching `query`. Biases toward commercially-usable,
 * modifiable licenses. On any network/parse failure returns `{ online: false }` so the
 * UI can show a notice and fall back to generated/bundled sounds.
 */
export async function searchMusic(query: string): Promise<MusicSearchResult> {
  const url =
    `${ENDPOINT}?q=${encodeURIComponent(query)}&page_size=20` +
    `&license_type=commercial,modification`
  try {
    const res = await fetch(url, { headers: { 'User-Agent': 'NIHILPOINTZERO-OS/1.0 (studio app)' } })
    if (!res.ok) return { tracks: [], online: true, error: `Search failed (HTTP ${res.status}).` }
    const data = (await res.json()) as { results?: OpenverseResult[] }
    const tracks: FreeTrack[] = (data.results ?? []).map((r) => ({
      id: r.id,
      title: r.title || 'Untitled',
      artist: r.creator || 'Unknown',
      license: (r.license || '').toUpperCase(),
      licenseUrl: r.license_url,
      landingUrl: r.foreign_landing_url,
      audioUrl: r.url,
      durationSec: typeof r.duration === 'number' ? Math.round(r.duration / 1000) : undefined
    }))
    return { tracks: rankTracks(query, tracks), online: true }
  } catch {
    // No connection (or DNS blocked) — signal offline so the caller falls back.
    return { tracks: [], online: false, error: 'You appear to be offline.' }
  }
}

/** Downloads a track's audio to `outPath`. Throws on failure (caller handles). */
export async function downloadTrack(audioUrl: string, outPath: string): Promise<void> {
  const res = await fetch(audioUrl, { headers: { 'User-Agent': 'NIHILPOINTZERO-OS/1.0 (studio app)' } })
  if (!res.ok) throw new Error(`Download failed (HTTP ${res.status}).`)
  const buf = Buffer.from(await res.arrayBuffer())
  if (!buf.length) throw new Error('Downloaded file was empty.')
  writeFileSync(outPath, buf)
}
