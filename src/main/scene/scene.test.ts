import { describe, expect, it } from 'vitest'
import { planScenes } from './index'

describe('planScenes', () => {
  it('makes one editable scene per [SECTION] with a style-aware prompt', () => {
    const body = '[INTRO]\nhi\n[THE PROBLEM]\nbad\n[THE FIX]\ngood'
    const scenes = planScenes('My Video', body, 'anime')
    expect(scenes).toHaveLength(3)
    expect(scenes.map((s) => s.label)).toEqual(['INTRO', 'THE PROBLEM', 'THE FIX'])
    expect(scenes[0].index).toBe(0)
    expect(scenes[1].prompt.toLowerCase()).toContain('anime')
    expect(scenes[1].prompt).toContain('THE PROBLEM')
    expect(scenes[1].prompt).toContain('My Video')
  })

  it('folds the overall direction into every scene prompt', () => {
    const scenes = planScenes('T', '[A]\nx\n[B]\ny', 'cinematic', 'rainy night, neon reflections')
    expect(scenes.every((s) => s.prompt.includes('rainy night, neon reflections'))).toBe(true)
  })

  it('no longer caps at 8 — a long script yields many scenes', () => {
    const body = Array.from(
      { length: 20 },
      (_, i) => `This is sentence number ${i} about the mineral market and it carries enough words.`
    ).join(' ')
    expect(planScenes('T', body, 'neon').length).toBeGreaterThan(8) // ~10 beats
  })

  it('makes one scene per descriptive [visual] block when the script has several', () => {
    const body = Array.from(
      { length: 5 },
      (_, i) => `[A cinematic wide drone shot of location number ${i}, dramatic golden lighting]`
    ).join('\n\nNarration line goes here for this beat.\n\n')
    const scenes = planScenes('Doc', body, 'cinematic')
    expect(scenes).toHaveLength(5)
  })

  it('splits plain prose into many ~2-sentence beats (flowing scenes), bounded by a ceiling', () => {
    const body = Array.from(
      { length: 60 },
      (_, i) => `Sentence number ${i} explains an important detailed point about the mineral market here.`
    ).join(' ')
    const scenes = planScenes('T', body)
    expect(scenes.length).toBeGreaterThan(15) // ~30 beats, not a handful
    expect(scenes.length).toBeLessThanOrEqual(200) // practical ceiling
  })
})
