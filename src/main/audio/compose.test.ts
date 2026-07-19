import { describe, expect, it } from 'vitest'
import {
  buildMusicExpr,
  buildMusicFilter,
  buildSfxFilter,
  MOODS,
  noteToFreq,
  SFX_KINDS,
  type Mood
} from './compose'

describe('noteToFreq', () => {
  it('anchors A4=440 and is octave-accurate', () => {
    expect(noteToFreq(69)).toBeCloseTo(440, 6)
    expect(noteToFreq(81)).toBeCloseTo(880, 6) // one octave up
    expect(noteToFreq(57)).toBeCloseTo(220, 6) // one octave down
    expect(noteToFreq(60)).toBeCloseTo(261.63, 1) // middle C
  })
})

describe('mood + sfx catalogs', () => {
  it('exposes the expected counts', () => {
    expect(MOODS).toHaveLength(6)
    expect(SFX_KINDS).toHaveLength(7)
  })
})

describe('buildMusicExpr', () => {
  it('produces sine partials and a bounded, correct cycle length', () => {
    const plan = buildMusicExpr('calm', 0)
    expect(plan.expr).toContain('sin(2*PI*')
    // calm: 4 chords * 3.2s = 12.8s cycle
    expect(plan.cycleSec).toBeCloseTo(12.8, 5)
  })

  it('is deterministic for the same seed', () => {
    expect(buildMusicExpr('lofi', 3).expr).toBe(buildMusicExpr('lofi', 3).expr)
  })

  it('seed changes the arpeggio ordering (expression differs)', () => {
    // seeds 0 and 1 select different arp orders → different expression.
    expect(buildMusicExpr('uplifting', 0).expr).not.toBe(buildMusicExpr('uplifting', 1).expr)
  })
})

describe('buildMusicFilter', () => {
  it('emits an aevalsrc source and a clean post chain', () => {
    const spec = buildMusicFilter('cinematic', 30, 2)
    expect(spec.src.startsWith('aevalsrc=exprs=')).toBe(true)
    expect(spec.src).toContain(':d=30.00')
    expect(spec.af).toContain('tremolo')
    expect(spec.af).toContain('afade=t=in')
    expect(spec.af).toContain('alimiter') // anti-clip safety
    expect(spec.durationSec).toBe(30)
  })
})

describe('buildSfxFilter', () => {
  it('returns a valid spec for every kind', () => {
    for (const kind of SFX_KINDS) {
      const spec = buildSfxFilter(kind)
      expect(spec.src.length).toBeGreaterThan(0)
      expect(spec.af.length).toBeGreaterThan(0)
      expect(spec.durationSec).toBeGreaterThan(0)
    }
  })
})
