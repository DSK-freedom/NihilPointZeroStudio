import { describe, expect, it } from 'vitest'
import { buildAnalysisScriptPrompt } from './analysisScript'

describe('buildAnalysisScriptPrompt', () => {
  it('embeds the verified figures and forbids inventing numbers', () => {
    const p = buildAnalysisScriptPrompt({ kind: 'technical', subject: 'LUCK on the PSX', figures: 'Latest close: 445.63' })
    expect(p).toContain('LUCK on the PSX')
    expect(p).toContain('Latest close: 445.63')
    expect(p).toMatch(/do NOT invent/i)
    expect(p).toContain('[SECTION]')
  })
  it('honors a requested language', () => {
    const p = buildAnalysisScriptPrompt({ kind: 'flow', subject: 'NCCPL flows', figures: 'x', directives: { language: 'Roman Urdu' } })
    expect(p).toContain('Roman Urdu')
    expect(p).toMatch(/foreign FIPI vs local LIPI/i) // flow kind brief
  })
  it('passes through the user instruction and style', () => {
    const p = buildAnalysisScriptPrompt({
      kind: 'financial',
      subject: 'HUBC',
      figures: 'P/E 7.2',
      directives: { instruction: 'focus on dividend safety', style: 'punchy', language: 'English' }
    })
    expect(p).toContain('focus on dividend safety')
    expect(p).toContain('punchy')
    expect(p).toMatch(/fundamentals read/i)
  })
  it('omits language/instruction lines when not provided', () => {
    const p = buildAnalysisScriptPrompt({ kind: 'technical', subject: 'X', figures: 'y' })
    expect(p).not.toMatch(/ENTIRE narration in/)
    expect(p).not.toMatch(/user's specific request/)
  })
})
