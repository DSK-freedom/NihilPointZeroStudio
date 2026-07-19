import { describe, expect, it } from 'vitest'
import { buildTimelineFilter } from './mixplan'
import type { AudioClip } from '../../shared/types'

function clip(over: Partial<AudioClip>): AudioClip {
  return { id: 'x', src: 'c.mp3', label: 'c', atSec: 0, gain: 1, fadeIn: 0, fadeOut: 0, ...over }
}

describe('buildTimelineFilter', () => {
  it('with no clips just maps the base audio through', () => {
    const plan = buildTimelineFilter([])
    expect(plan.chains).toEqual([])
    expect(plan.audioMap).toBe('0:a')
    expect(plan.clipInputs).toEqual([])
  })

  it('delays a clip to its timestamp in milliseconds', () => {
    const plan = buildTimelineFilter([clip({ atSec: 2.5, src: 'a.mp3' })])
    expect(plan.clipInputs).toEqual(['a.mp3'])
    expect(plan.chains[0]).toContain('adelay=2500:all=1')
    expect(plan.audioMap).toBe('[aout]')
  })

  it('trims to a segment when start/end are given', () => {
    const plan = buildTimelineFilter([clip({ startSec: 5, endSec: 20 })])
    expect(plan.chains[0]).toContain('atrim=5.000:20.000')
    expect(plan.chains[0]).toContain('asetpts=PTS-STARTPTS')
  })

  it('applies gain and fades, with fade-out relative to segment length', () => {
    const plan = buildTimelineFilter([clip({ startSec: 0, endSec: 10, gain: 0.5, fadeIn: 1, fadeOut: 2 })])
    const c = plan.chains[0]
    expect(c).toContain('volume=0.500')
    expect(c).toContain('afade=t=in:st=0:d=1.000')
    expect(c).toContain('afade=t=out:st=8.000:d=2.000') // 10 - 2
  })

  it('treats gain 0 as an explicit mute (volume=0), not full volume', () => {
    const plan = buildTimelineFilter([clip({ gain: 0 })])
    expect(plan.chains[0]).toContain('volume=0.000')
  })

  it('falls back to unity for a non-finite or negative gain', () => {
    const neg = buildTimelineFilter([clip({ gain: -3 })])
    expect(neg.chains[0]).not.toContain('volume=')
    const bad = buildTimelineFilter([clip({ gain: Number.NaN })])
    expect(bad.chains[0]).not.toContain('volume=')
  })

  it('fades out via areverse when the segment length is unknown', () => {
    // A Director-added clip sets fadeOut but no trim window — the tail fade must
    // still be applied (previously it was silently dropped).
    const plan = buildTimelineFilter([clip({ fadeOut: 1.5 })])
    const c = plan.chains[0]
    expect(c).toContain('areverse,afade=t=in:st=0:d=1.500,areverse')
  })

  it('mixes base + N clips with normalize=0 and correct input count', () => {
    const plan = buildTimelineFilter([clip({}), clip({ atSec: 1 }), clip({ atSec: 2 })])
    const mix = plan.chains[plan.chains.length - 1]
    expect(mix).toContain('amix=inputs=4:duration=first:normalize=0') // base + 3 clips
    expect(mix).toContain('[0:a][c0][c1][c2]')
  })

  it('honours a custom base label', () => {
    const plan = buildTimelineFilter([clip({})], '1:a')
    expect(plan.chains[plan.chains.length - 1]).toContain('[1:a][c0]')
  })
})
