import OpenAI from 'openai'
import type { IdeaGenRequest, ScriptGenRequest, TrendTopic, VideoIdea, YouTubeSignal } from '../../shared/types'
import { buildIdeaPrompt, buildScriptPrompt, buildThumbnailPrompt, buildTrendPrompt } from '../prompts'
import { LLMRequestError, type LLMProvider } from './types'
import { extractJson, parseScriptResponse } from './parse'

export class OpenAIProvider implements LLMProvider {
  private client: OpenAI

  constructor(apiKey: string, private model: string) {
    this.client = new OpenAI({ apiKey })
  }

  private async complete(prompt: string, maxTokens: number): Promise<string> {
    try {
      const res = await this.client.chat.completions.create({
        model: this.model,
        max_tokens: maxTokens,
        messages: [{ role: 'user', content: prompt }]
      })
      const text = res.choices[0]?.message?.content
      if (!text) throw new LLMRequestError('OpenAI returned no text content')
      return text
    } catch (err) {
      if (err instanceof LLMRequestError) throw err
      throw new LLMRequestError(err instanceof Error ? err.message : 'OpenAI request failed')
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
