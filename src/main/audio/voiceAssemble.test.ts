import { describe, expect, it } from 'vitest'
import { buildAssembleArgs } from './voiceAssemble'

describe('buildAssembleArgs', () => {
  it('concatenates a single whole segment', () => {
    const args = buildAssembleArgs(['a.webm'], [{}], 'out.wav')
    expect(args).toContain('a.webm')
    expect(args.join(' ')).toContain('concat=n=1:v=0:a=1')
    expect(args.join(' ')).toContain('aformat=sample_rates=44100:channel_layouts=mono')
    expect(args.join(' ')).not.toContain('atrim') // no trim window given
    expect(args[args.length - 1]).toBe('out.wav')
  })

  it('punch-in: trims the head to the playhead, then appends the new take', () => {
    const args = buildAssembleArgs(
      ['head.webm', 'tail.webm'],
      [{ endSec: 12.5 }, {}],
      'out.wav'
    )
    const f = args.join(' ')
    expect(f).toContain('[0:a]atrim=end=12.500') // head cut at the playhead
    expect(f).toContain('concat=n=2:v=0:a=1')
    // both segments normalized before concat
    expect((f.match(/aformat=sample_rates=44100/g) ?? []).length).toBe(2)
  })

  it('supports an explicit start+end window', () => {
    const args = buildAssembleArgs(['a.webm'], [{ startSec: 3, endSec: 8 }], 'o.wav')
    expect(args.join(' ')).toContain('atrim=start=3.000:end=8.000')
  })
})
