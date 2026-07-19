/**
 * Real current news via public RSS feeds meant for exactly this kind of
 * consumption — free forever, no key, no ToS risk (unlike scraping a site's
 * HTML directly).
 */
const DAWN_BUSINESS_RSS = 'https://www.dawn.com/feeds/business'
const BRECORDER_RSS = 'https://www.brecorder.com/feeds/latest-news'

function extractItemTitles(xml: string): string[] {
  const itemBlocks = xml.match(/<item[^>]*>[\s\S]*?<\/item>/g) ?? []
  return itemBlocks
    .map((block) => block.match(/<title>(?:<!\[CDATA\[)?(.*?)(?:\]\]>)?<\/title>/))
    .map((m) => m?.[1]?.trim())
    .filter((t): t is string => !!t)
}

async function fetchTitlesFromFeed(url: string): Promise<string[]> {
  try {
    const res = await fetch(url)
    if (!res.ok) return []
    return extractItemTitles(await res.text())
  } catch {
    return []
  }
}

/** General current Pakistani business headlines, for idea/trend grounding. */
export async function getRelevantHeadlines(focusArea: string, maxItems = 5): Promise<string[]> {
  const [dawn, brecorder] = await Promise.all([
    fetchTitlesFromFeed(DAWN_BUSINESS_RSS),
    fetchTitlesFromFeed(BRECORDER_RSS)
  ])
  const titles = [...new Set([...dawn, ...brecorder])]
  if (!titles.length) return []

  const keywords = focusArea
    .toLowerCase()
    .split(/\s+/)
    .filter((w) => w.length > 3)
  const relevant = keywords.length ? titles.filter((t) => keywords.some((k) => t.toLowerCase().includes(k))) : []

  return (relevant.length ? relevant : titles).slice(0, maxItems)
}

/** Real news specifically about a chosen script topic, via Google News' public RSS search. */
export async function getTopicNews(topic: string, maxItems = 5): Promise<string[]> {
  if (!topic.trim()) return []
  const url = `https://news.google.com/rss/search?q=${encodeURIComponent(topic)}+when:14d&hl=en-PK&gl=PK&ceid=PK:en`
  const titles = await fetchTitlesFromFeed(url)
  return titles.slice(0, maxItems)
}
