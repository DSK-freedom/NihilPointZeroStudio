/**
 * Assisted YouTube publishing (free, no OAuth, no limits). We don't push via the API
 * (that needs OAuth + Google verification and forces uploads private) — instead we
 * prepare everything and open YouTube's upload page so the user drops the finished
 * file in: title/description/tags on the clipboard, upload page opened, file revealed.
 */
import { getActiveProvider } from '../llm'
import { extractJson } from '../director'

/** The best upload URL: the channel's Studio upload page if we know the channel, else the generic one. */
export function buildUploadUrl(channelId: string): string {
  const id = (channelId || '').trim()
  return /^UC[\w-]{20,}$/.test(id)
    ? `https://studio.youtube.com/channel/${id}/videos/upload`
    : 'https://www.youtube.com/upload'
}

export interface PublishMeta {
  description: string
  tags: string[]
}

/** A safe fallback description/tags built from the title (used if the AI is unavailable). */
export function fallbackMeta(title: string): PublishMeta {
  const words = title
    .toLowerCase()
    .replace(/[^a-z0-9 ]/g, ' ')
    .split(/\s+/)
    .filter((w) => w.length > 2)
  return { description: title, tags: [...new Set(words)].slice(0, 12) }
}

/** Asks the active (free) AI for a YouTube description + tags. Falls back gracefully. */
export async function generatePublishMeta(title: string): Promise<PublishMeta> {
  try {
    const prompt = [
      `Write YouTube publishing metadata for a video titled: "${title}".`,
      'Return ONLY JSON: {"description":"<2-3 short paragraphs, engaging, with a line of relevant hashtags at the end>","tags":["12 short relevant tags"]}'
    ].join('\n')
    const reply = await getActiveProvider().generateText(prompt, 700)
    const parsed = extractJson(reply) as { description?: unknown; tags?: unknown } | null
    const description = typeof parsed?.description === 'string' && parsed.description.trim() ? parsed.description.trim() : title
    const tags = Array.isArray(parsed?.tags)
      ? parsed.tags.filter((t): t is string => typeof t === 'string' && !!t.trim()).slice(0, 15)
      : fallbackMeta(title).tags
    return { description, tags }
  } catch {
    return fallbackMeta(title)
  }
}
