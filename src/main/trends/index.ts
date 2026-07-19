import type { TrendTopic } from '../../shared/types'
import { getActiveProvider } from '../llm'

/**
 * Trend source seam: today this reasons about likely-trending topics via the
 * active LLM. Swap this function's body for a real YouTube Data API / Google
 * Trends client later without touching any caller — the return shape stays
 * the same.
 */
export async function getTrendingTopics(focusArea: string, count = 6): Promise<TrendTopic[]> {
  const provider = getActiveProvider()
  return provider.generateTrendTopics(focusArea, count)
}
