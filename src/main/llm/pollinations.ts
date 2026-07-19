/**
 * A FREE, keyless, no-install AI brain: Pollinations' OpenAI-compatible hosted text
 * endpoint. No API key, no signup, no local model download — it just needs internet.
 * This is the app's default provider so every AI feature works out of the box for
 * free. Users can still switch to local Ollama (free/offline) or a paid Claude/OpenAI
 * key for higher quality in Settings.
 *
 * Same LLMProvider contract + prompt builders as the paid providers, so behaviour is
 * identical — only the (free) backend differs.
 */
import type { IdeaGenRequest, ScriptGenRequest, TrendTopic, VideoIdea, YouTubeSignal } from '../../shared/types'
import { buildIdeaPrompt, buildScriptPrompt, buildThumbnailPrompt, buildTrendPrompt } from '../prompts'
import { LLMRequestError, type LLMProvider } from './types'
import { extractJson, parseScriptResponse } from './parse'

const ENDPOINT = 'https://text.pollinations.ai/openai'

export class PollinationsProvider implements LLMProvider {
  constructor(private model: string = 'openai') {}

  private async complete(prompt: string, maxTokens: number): Promise<string> {
    try {
      const res = await fetch(ENDPOINT, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: this.model || 'openai',
          messages: [{ role: 'user', content: prompt }],
          max_tokens: maxTokens,
          // Keep generations out of the public feed and identify the app politely.
          private: true,
          referrer: 'nihilpointzero-studio'
        }),
        // A stalled socket must not hang the request forever — long scripts are fine
        // within this, and the resilient chain moves to the next provider on timeout.
        signal: AbortSignal.timeout(120_000)
      })
      if (!res.ok) {
        throw new LLMRequestError(
          `The free AI service returned ${res.status}. It can get busy — wait a moment and try again, ` +
            `or switch to local Ollama / a paid key in Settings.`
        )
      }
      const data = (await res.json()) as { choices?: { message?: { content?: string } }[] }
      const text = data.choices?.[0]?.message?.content
      if (!text || !text.trim()) {
        throw new LLMRequestError('The free AI service returned no text. Try again in a moment.')
      }
      return text
    } catch (err) {
      if (err instanceof LLMRequestError) throw err
      throw new LLMRequestError(
        err instanceof Error
          ? `Free AI request failed (${err.message}). Check your internet connection.`
          : 'Free AI request failed. Check your internet connection.'
      )
    }
  }

  async generateTrendTopics(focusArea: string, count: number): Promise<TrendTopic[]> {
    const text = await this.complete(buildTrendPrompt(focusArea, count), 2000)
    return extractJson<TrendTopic[]>(text)
  }

  async generateIdeas(
    req: IdeaGenRequest,
    trends: TrendTopic[],
    ytSignals: YouTubeSignal[]
  ): Promise<Omit<VideoIdea, 'id' | 'createdAt'>[]> {
    const text = await this.complete(buildIdeaPrompt(req, trends, ytSignals), 3000)
    return extractJson<Omit<VideoIdea, 'id' | 'createdAt'>[]>(text)
  }

  async generateScriptBody(req: ScriptGenRequest): Promise<{ title: string; body: string }> {
    const text = await this.complete(buildScriptPrompt(req), 8000)
    return parseScriptResponse(text)
  }

  async generateThumbnailBrief(topic: string, title: string): Promise<string> {
    return (await this.complete(buildThumbnailPrompt(topic, title), 1000)).trim()
  }

  async generateText(prompt: string, maxTokens = 4000): Promise<string> {
    return (await this.complete(prompt, maxTokens)).trim()
  }
}
