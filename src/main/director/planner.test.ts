import { describe, expect, it } from 'vitest'
import { buildPlannerPrompt, sanitizePlan } from './planner'

describe('buildPlannerPrompt', () => {
  it('includes the title, script, and the JSON contract', () => {
    const p = buildPlannerPrompt('Oil Crash', 'Prices are falling fast...')
    expect(p).toContain('Oil Crash')
    expect(p).toContain('Prices are falling')
    expect(p).toContain('"hook"')
    expect(p).toContain('"sections"')
  })
})

describe('sanitizePlan', () => {
  it('keeps valid sections and coerces types', () => {
    const plan = sanitizePlan({
      hook: '  Watch this  ',
      sections: [
        { title: 'Intro', keyword: 'stock market screen', seconds: 12.7 },
        { title: '', keyword: '', seconds: 5 }, // dropped (no title/keyword)
        { title: 'Proof', keyword: 'gold bars' } // seconds missing → 0
      ],
      thumbnailIdea: 'Red arrow down',
      ctrTips: ['Use a number', 42, 'Ask a question']
    })
    expect(plan.hook).toBe('Watch this')
    expect(plan.sections).toHaveLength(2)
    expect(plan.sections[0].seconds).toBe(13) // rounded
    expect(plan.sections[1].seconds).toBe(0)
    expect(plan.ctrTips).toEqual(['Use a number', 'Ask a question']) // non-strings dropped
  })

  it('is safe on empty/garbage input', () => {
    expect(sanitizePlan(null)).toEqual({ hook: '', sections: [], thumbnailIdea: '', ctrTips: [] })
    expect(sanitizePlan({ sections: 'nope' }).sections).toEqual([])
  })
})
