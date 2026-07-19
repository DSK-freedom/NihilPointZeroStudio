/**
 * Resilience wrapper: a busy/flaky free AI service should never hard-block the user.
 * This wraps the chosen provider and, on any failure, transparently retries with the
 * next provider in the chain (e.g. the keyless free Pollinations model). It implements
 * the same LLMProvider interface, so callers don't change.
 */
import type { IdeaGenRequest, ScriptGenRequest, TrendTopic, VideoIdea, YouTubeSignal } from '../../shared/types'
import type { LLMProvider } from './types'

export class ResilientProvider implements LLMProvider {
  /** Providers to try in order; the first that succeeds wins. At least one required. */
  constructor(private chain: LLMProvider[]) {
    if (!chain.length) throw new Error('ResilientProvider needs at least one provider')
  }

  private async attempt<T>(run: (p: LLMProvider) => Promise<T>): Promise<T> {
    let lastErr: unknown
    for (const p of this.chain) {
      try {
        return await run(p)
      } catch (err) {
        lastErr = err
      }
    }
    throw lastErr instanceof Error ? lastErr : new Error('All AI providers failed. Check your internet connection.')
  }

  generateIdeas(
    req: IdeaGenRequest,
    trends: TrendTopic[],
    ytSignals: YouTubeSignal[]
  ): Promise<Omit<VideoIdea, 'id' | 'createdAt'>[]> {
    return this.attempt((p) => p.generateIdeas(req, trends, ytSignals))
  }
  generateTrendTopics(focusArea: string, count: number): Promise<TrendTopic[]> {
    return this.attempt((p) => p.generateTrendTopics(focusArea, count))
  }
  generateScriptBody(req: ScriptGenRequest): Promise<{ title: string; body: string }> {
    return this.attempt((p) => p.generateScriptBody(req))
  }
  generateThumbnailBrief(topic: string, title: string): Promise<string> {
    return this.attempt((p) => p.generateThumbnailBrief(topic, title))
  }
  generateText(prompt: string, maxTokens?: number): Promise<string> {
    return this.attempt((p) => p.generateText(prompt, maxTokens))
  }
}
