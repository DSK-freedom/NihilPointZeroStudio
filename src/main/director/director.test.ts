import { describe, expect, it } from 'vitest'
import { extractJson, resolveKeptIntervals, sanitizeInterpretation } from './index'

describe('extractJson', () => {
  it('parses a plain JSON object', () => {
    expect(extractJson('{"a":1}')).toEqual({ a: 1 })
  })
  it('parses JSON inside a ```json fence with surrounding prose', () => {
    const t = 'Sure! Here is the plan:\n```json\n{"actions":[]}\n```\nHope that helps.'
    expect(extractJson(t)).toEqual({ actions: [] })
  })
  it('parses JSON embedded in prose without a fence', () => {
    expect(extractJson('Plan: {"x": true} done')).toEqual({ x: true })
  })
  it('returns null when there is no JSON', () => {
    expect(extractJson('no json here')).toBeNull()
    expect(extractJson('')).toBeNull()
  })
})

describe('sanitizeInterpretation', () => {
  const dur = 120

  it('keeps valid actions and marks kind as edit', () => {
    const raw = {
      explanation: 'do stuff',
      actions: [
        { type: 'keep', startSec: 0, endSec: 90 },
        { type: 'music', mood: 'calm', atSec: 0 },
        { type: 'sfx', kind: 'whoosh', atSec: 20 }
      ]
    }
    const out = sanitizeInterpretation(raw, dur)
    expect(out.kind).toBe('edit')
    expect(out.actions).toHaveLength(3)
  })

  it('clamps out-of-range times to the video length', () => {
    const out = sanitizeInterpretation({ actions: [{ type: 'remove', startSec: -5, endSec: 999 }] }, dur)
    expect(out.actions[0]).toEqual({ type: 'remove', startSec: 0, endSec: 120 })
  })

  it('drops actions with unknown moods / sfx kinds (no hallucinated values reach the engine)', () => {
    const out = sanitizeInterpretation(
      { actions: [{ type: 'music', mood: 'dubstep', atSec: 0 }, { type: 'sfx', kind: 'explosion', atSec: 1 }] },
      dur
    )
    expect(out.actions).toHaveLength(0)
    expect(out.kind).toBe('reply')
  })

  it('drops zero/negative-length trims', () => {
    const out = sanitizeInterpretation({ actions: [{ type: 'keep', startSec: 50, endSec: 50 }] }, dur)
    expect(out.actions).toHaveLength(0)
  })

  it('with no actions returns a reply', () => {
    const out = sanitizeInterpretation({ explanation: 'That video is 2 minutes long.' }, dur)
    expect(out.kind).toBe('reply')
    expect(out.explanation).toContain('2 minutes')
  })

  it('clamps an out-of-range gain into [0, 2] and drops a non-numeric one', () => {
    const out = sanitizeInterpretation(
      {
        actions: [
          { type: 'music', mood: 'calm', atSec: 0, gain: 40 },
          { type: 'sfx', kind: 'whoosh', atSec: 1, gain: 'loud' }
        ]
      },
      dur
    )
    expect(out.actions[0]).toMatchObject({ type: 'music', gain: 2 })
    expect(out.actions[1]).toMatchObject({ type: 'sfx', gain: undefined })
  })
})

describe('resolveKeptIntervals', () => {
  const dur = 100

  it('returns the whole video when there are no cuts', () => {
    expect(resolveKeptIntervals([], dur)).toEqual([{ start: 0, end: 100 }])
  })

  it('resolves TWO removes against the ORIGINAL timeline (the compounding bug)', () => {
    // "remove 0–10 and 50–60" must delete the original 50–60, NOT a shifted region.
    const out = resolveKeptIntervals(
      [
        { type: 'remove', startSec: 0, endSec: 10 },
        { type: 'remove', startSec: 50, endSec: 60 }
      ],
      dur
    )
    expect(out).toEqual([
      { start: 10, end: 50 },
      { start: 60, end: 100 }
    ])
  })

  it('intersects sequential keeps in original coordinates', () => {
    const out = resolveKeptIntervals(
      [
        { type: 'keep', startSec: 20, endSec: 80 },
        { type: 'keep', startSec: 30, endSec: 90 }
      ],
      dur
    )
    expect(out).toEqual([{ start: 30, end: 80 }])
  })

  it('merges touching remainders and drops empty results', () => {
    const out = resolveKeptIntervals(
      [
        { type: 'keep', startSec: 0, endSec: 50 },
        { type: 'remove', startSec: 0, endSec: 50 }
      ],
      dur
    )
    expect(out).toEqual([])
  })
})
