import type { ScriptGenRequest } from '../../shared/types'
import {
  buildOutlinePrompt,
  buildSectionPrompt,
  FEATURE_PLANS,
  type OutlineSection
} from '../prompts'
import { extractJson } from './parse'
import type { LLMProvider } from './types'

export interface FeatureProgress {
  (stage: string): void
}

/**
 * Generates a feature-length (90-180 min) script by chaptering: first an outline,
 * then each section as its own generation, then stitched together. This is the only
 * way to exceed a single model call's output ceiling. On a CPU-only machine this is
 * SLOW (many sequential calls) — callers should surface that expectation.
 */
export async function generateFeatureScript(
  provider: LLMProvider,
  req: ScriptGenRequest,
  onProgress?: FeatureProgress
): Promise<{ title: string; body: string }> {
  const plan = FEATURE_PLANS[req.length]
  const sectionCount = plan?.sections ?? 12

  onProgress?.(`Planning ${sectionCount}-section outline`)
  const outlineText = await provider.generateText(buildOutlinePrompt(req, sectionCount), 2000)
  const genericArc = (): OutlineSection[] =>
    Array.from({ length: sectionCount }, (_, i) => ({
      title: `Part ${i + 1}`,
      focus: `Section ${i + 1} of the analysis of ${req.topic}.`
    }))
  let outline: OutlineSection[]
  try {
    const parsed = extractJson<unknown>(outlineText)
    // extractJson only guards against parse failure — a syntactically valid but
    // wrong-shaped payload (e.g. an object, or sections missing a title) must
    // also fall back to the synthesized arc rather than crash section writing.
    if (!Array.isArray(parsed) || parsed.length === 0) throw new Error('outline not an array')
    outline = parsed.map((s, i) => {
      const sec = (s ?? {}) as Partial<OutlineSection>
      return {
        title: typeof sec.title === 'string' && sec.title.trim() ? sec.title : `Part ${i + 1}`,
        focus:
          typeof sec.focus === 'string' && sec.focus.trim()
            ? sec.focus
            : `Section ${i + 1} of the analysis of ${req.topic}.`
      }
    })
  } catch {
    // Fallback: if outline JSON fails or is wrong-shaped, synthesize a minimal generic arc so we still produce output.
    outline = genericArc()
  }
  outline = outline.slice(0, sectionCount)

  const parts: string[] = []
  for (let i = 0; i < outline.length; i++) {
    const section = outline[i]
    onProgress?.(`Writing section ${i + 1} of ${outline.length}: ${section.title}`)
    const sectionText = await provider.generateText(
      buildSectionPrompt(req, section, i, outline.length, outline),
      2600
    )
    parts.push(`[${section.title.toUpperCase()}]\n${sectionText.trim()}`)
  }

  const title = req.topic.length <= 70 ? req.topic : `${req.topic.slice(0, 67)}...`
  return { title, body: parts.join('\n\n') }
}
