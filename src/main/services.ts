import { randomUUID } from 'crypto'
import type { GeneratedScript, IdeaGenRequest, ScriptGenRequest, VideoIdea } from '../shared/types'
import { getActiveProvider } from './llm'
import { generateFeatureScript } from './llm/feature'
import { isFeatureLength } from './prompts'
import { searchYouTubeSignals } from './data/youtube'
import { getRelevantHeadlines, getTopicNews } from './data/news'
import { getMarketSnapshotNote } from './data/currency'
import { logActivity, saveToLibrary } from './store'

/**
 * Shared generation orchestration used by BOTH the Electron IPC handlers and the
 * LAN web server, so the two never drift. Auto-saves results to the library and
 * logs activity, exactly as before.
 */

function countWords(text: string): number {
  return text.trim().split(/\s+/).filter(Boolean).length
}

/**
 * Coerces raw model output into safe VideoIdea objects. The model can return a
 * non-array, or ideas with missing/malformed fields; without this a bad shape would crash
 * `rawIdeas.map` or persist garbage to the library. Drops entries with no title, clamps
 * the score to 1–10, and fills sensible defaults (mirrors the Agent/Director validation).
 */
function sanitizeIdeas(raw: unknown): Omit<VideoIdea, 'id' | 'createdAt'>[] {
  if (!Array.isArray(raw)) return []
  const comp = new Set(['low', 'medium', 'high'])
  const out: Omit<VideoIdea, 'id' | 'createdAt'>[] = []
  for (const it of raw) {
    if (!it || typeof it !== 'object') continue
    const o = it as Record<string, unknown>
    const title = typeof o.title === 'string' ? o.title.trim() : ''
    if (!title) continue
    const s = Number(o.viewPotentialScore)
    out.push({
      title,
      hook: typeof o.hook === 'string' ? o.hook : '',
      angle: typeof o.angle === 'string' ? o.angle : '',
      viewPotentialScore: Number.isFinite(s) ? Math.min(10, Math.max(1, Math.round(s))) : 5,
      viewPotentialReason: typeof o.viewPotentialReason === 'string' ? o.viewPotentialReason : '',
      competitionLevel: comp.has(o.competitionLevel as string) ? (o.competitionLevel as 'low' | 'medium' | 'high') : 'medium',
      contentPillars: Array.isArray(o.contentPillars) ? (o.contentPillars.filter((p) => typeof p === 'string') as string[]) : [],
      suggestedLength: (['short', 'long', 'deep-dive', 'feature-90', 'feature-180'] as const).includes(
        o.suggestedLength as VideoIdea['suggestedLength']
      )
        ? (o.suggestedLength as VideoIdea['suggestedLength'])
        : 'short'
    })
  }
  return out
}

export async function generateIdeasFlow(req: IdeaGenRequest): Promise<VideoIdea[]> {
  const [ytSignals, headlines] = await Promise.all([
    searchYouTubeSignals(req.focusArea),
    getRelevantHeadlines(req.focusArea)
  ])
  const trends = headlines.map((h) => ({
    topic: h,
    why: 'Real current headline from Dawn / Business Recorder (today), not a model guess',
    momentum: 'rising' as const
  }))
  const provider = getActiveProvider()
  const rawIdeas = sanitizeIdeas(await provider.generateIdeas(req, trends, ytSignals))
  logActivity('ai', `Generated ${rawIdeas.length} ideas`, req.focusArea)
  const ideas = rawIdeas.map((idea) => ({ ...idea, id: randomUUID(), createdAt: new Date().toISOString() }))
  for (const idea of ideas) {
    saveToLibrary({ kind: 'idea', data: idea, id: randomUUID(), savedAt: new Date().toISOString() })
  }
  return ideas
}

export async function generateScriptFlow(
  req: ScriptGenRequest,
  onProgress?: (stage: string) => void
): Promise<GeneratedScript> {
  const [fxNote, topicNews] = await Promise.all([getMarketSnapshotNote(), getTopicNews(req.topic)])
  const enrichedReq: ScriptGenRequest = {
    ...req,
    verifiedData: [fxNote, req.verifiedData?.trim()].filter(Boolean).join('\n'),
    recentNewsContext: topicNews.map((t) => `- ${t}`).join('\n')
  }
  const provider = getActiveProvider()
  const { title, body } = isFeatureLength(enrichedReq.length)
    ? await generateFeatureScript(provider, enrichedReq, onProgress)
    : await provider.generateScriptBody(enrichedReq)
  const wordCount = countWords(body)
  logActivity('ai', isFeatureLength(req.length) ? 'Generated feature-length script' : 'Generated script', title)
  const script: GeneratedScript = {
    id: randomUUID(),
    topic: req.topic,
    length: req.length,
    languageMix: req.languageMix,
    title,
    body,
    estimatedWordCount: wordCount,
    estimatedDurationMinutes: Math.round((wordCount / 150) * 10) / 10,
    createdAt: new Date().toISOString()
  }
  saveToLibrary({ kind: 'script', data: script, id: randomUUID(), savedAt: new Date().toISOString() })
  return script
}
