import type { YouTubeSignal } from '../../shared/types'
import { getYouTubeApiKey } from '../store'

const BASE_URL = 'https://www.googleapis.com/youtube/v3'

interface YouTubeSearchItem {
  id?: { videoId?: string }
  snippet?: { title?: string; channelTitle?: string; publishedAt?: string }
}

interface YouTubeVideoStatsItem {
  id: string
  statistics?: { viewCount?: string }
}

/**
 * Real competitive-landscape grounding for a topic, via the free YouTube Data API v3
 * (10,000 quota units/day, no billing required). Returns [] silently if no key is
 * configured or the request fails — callers should treat this as a best-effort
 * enrichment, not a required dependency.
 */
export async function searchYouTubeSignals(query: string, maxResults = 8): Promise<YouTubeSignal[]> {
  const apiKey = getYouTubeApiKey()
  if (!apiKey || !query.trim()) return []

  try {
    const searchUrl = `${BASE_URL}/search?part=snippet&type=video&order=relevance&maxResults=${maxResults}&q=${encodeURIComponent(query)}&key=${apiKey}`
    const searchRes = await fetch(searchUrl)
    if (!searchRes.ok) return []
    const searchData = await searchRes.json()
    const items: YouTubeSearchItem[] = Array.isArray(searchData.items) ? searchData.items : []
    const ids = items.map((it) => it.id?.videoId).filter((id): id is string => !!id)
    if (!ids.length) return []

    const statsUrl = `${BASE_URL}/videos?part=statistics&id=${ids.join(',')}&key=${apiKey}`
    const statsRes = await fetch(statsUrl)
    const statsData = statsRes.ok ? await statsRes.json() : { items: [] }
    const viewsById = new Map<string, number>()
    for (const it of (statsData.items ?? []) as YouTubeVideoStatsItem[]) {
      viewsById.set(it.id, Number(it.statistics?.viewCount ?? 0))
    }

    return items
      .filter((it) => it.snippet?.title && it.id?.videoId)
      .map((it) => ({
        title: it.snippet!.title!,
        channelTitle: it.snippet?.channelTitle ?? 'Unknown channel',
        viewCount: viewsById.get(it.id!.videoId!) ?? 0,
        publishedAt: it.snippet?.publishedAt ?? ''
      }))
  } catch {
    return []
  }
}
