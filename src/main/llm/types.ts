import type { IdeaGenRequest, ScriptGenRequest, TrendTopic, VideoIdea, YouTubeSignal } from '../../shared/types'

export interface LLMProvider {
  generateIdeas(
    req: IdeaGenRequest,
    trends: TrendTopic[],
    ytSignals: YouTubeSignal[]
  ): Promise<Omit<VideoIdea, 'id' | 'createdAt'>[]>
  generateTrendTopics(focusArea: string, count: number): Promise<TrendTopic[]>
  generateScriptBody(req: ScriptGenRequest): Promise<{ title: string; body: string }>
  generateThumbnailBrief(topic: string, title: string): Promise<string>
  /** Generic single-prompt completion, used to orchestrate multi-part feature-length scripts. */
  generateText(prompt: string, maxTokens?: number): Promise<string>
}

export class LLMConfigError extends Error {}
export class LLMRequestError extends Error {}
