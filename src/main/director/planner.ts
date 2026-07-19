/**
 * AI video planner: reads a title + script and proposes a retention-optimized (AVD)
 * and click-optimized (CTR) plan — a punchy hook, an ordered section list each with a
 * concrete stock-footage keyword, a thumbnail idea, and CTR tips. The section keywords
 * can feed the stock-footage engine for better B-roll matching.
 *
 * Uses the active brain (free Ollama / paid). The prompt + `sanitizePlan` parser are
 * pure + unit-tested; the model's creative output is judgment, not math.
 */
import { getActiveProvider } from '../llm'
import { extractJson } from './index'

export interface PlanSection {
  title: string
  keyword: string
  seconds: number
}
export interface VideoPlan {
  hook: string
  sections: PlanSection[]
  thumbnailIdea: string
  ctrTips: string[]
}

export function buildPlannerPrompt(title: string, script: string): string {
  return [
    'You are a top YouTube strategist. Read the video TITLE and SCRIPT and produce a plan that maximizes',
    'audience retention (AVD) and click-through (CTR).',
    'Respond with ONLY a JSON object of this exact shape:',
    '{',
    '  "hook": "<a punchy 1-2 sentence opening line to stop the scroll>",',
    '  "sections": [ { "title": "<short section name>", "keyword": "<concrete visual search term for b-roll>", "seconds": <approx duration> } ],',
    '  "thumbnailIdea": "<one line: what the thumbnail should show + text>",',
    '  "ctrTips": [ "<short actionable tip>", "..." ]',
    '}',
    'Keywords must be concrete, filmable nouns (e.g. "oil refinery", "stock market screen", "gold bars") — NOT abstract labels.',
    '',
    `TITLE: ${title}`,
    `SCRIPT: ${script.slice(0, 4000)}`,
    '',
    'JSON:'
  ].join('\n')
}

/** Coerces raw model output into a safe VideoPlan (drops junk, clamps types). */
export function sanitizePlan(raw: unknown): VideoPlan {
  const o = (raw ?? {}) as Record<string, unknown>
  const sections: PlanSection[] = Array.isArray(o.sections)
    ? o.sections
        .map((s) => {
          const sec = (s ?? {}) as Record<string, unknown>
          const title = typeof sec.title === 'string' ? sec.title.trim() : ''
          const keyword = typeof sec.keyword === 'string' ? sec.keyword.trim() : ''
          const seconds = typeof sec.seconds === 'number' && sec.seconds > 0 ? Math.round(sec.seconds) : 0
          return { title, keyword, seconds }
        })
        .filter((s) => s.title || s.keyword)
    : []
  const ctrTips = Array.isArray(o.ctrTips) ? o.ctrTips.filter((t): t is string => typeof t === 'string').slice(0, 6) : []
  return {
    hook: typeof o.hook === 'string' ? o.hook.trim() : '',
    sections,
    thumbnailIdea: typeof o.thumbnailIdea === 'string' ? o.thumbnailIdea.trim() : '',
    ctrTips
  }
}

/** Generates a plan for a title + script using the active provider. */
export async function generateVideoPlan(title: string, script: string): Promise<VideoPlan> {
  const provider = getActiveProvider()
  const reply = await provider.generateText(buildPlannerPrompt(title, script), 900)
  const parsed = extractJson(reply)
  if (parsed == null) {
    return { hook: reply.trim().slice(0, 400), sections: [], thumbnailIdea: '', ctrTips: [] }
  }
  return sanitizePlan(parsed)
}
