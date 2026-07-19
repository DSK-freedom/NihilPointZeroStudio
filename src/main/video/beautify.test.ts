import { describe, expect, it } from 'vitest'
import { buildBeautifyArgs, buildBeautifyFilter } from './beautify'

describe('buildBeautifyFilter', () => {
  it('is a passthrough at strength 0', () => {
    expect(buildBeautifyFilter({ strength: 0 })).toBe('null')
  })

  it('beautifies (smooth + lift + micro-sharpen) at positive strength', () => {
    const f = buildBeautifyFilter({ strength: 1 })
    expect(f).toContain('smartblur=')
    expect(f).toContain('eq=brightness=')
    expect(f).toContain('unsharp=')
    expect(f).not.toContain('noise=')
    // brightness/saturation lift is positive
    expect(f).toContain('saturation=1.12')
  })

  it('roughens (contrast + sharpen + grain, no smoothing) at negative strength', () => {
    const f = buildBeautifyFilter({ strength: -1 })
    expect(f).not.toContain('smartblur=')
    expect(f).toContain('noise=alls=12')
    expect(f).toContain('contrast=1.40')
    expect(f).toContain('saturation=0.75')
  })

  it('scales the effect continuously with magnitude', () => {
    const half = buildBeautifyFilter({ strength: 0.5 })
    expect(half).toContain('saturation=1.06') // 1 + 0.12*0.5
  })

  it('clamps out-of-range strength', () => {
    expect(buildBeautifyFilter({ strength: 9 })).toBe(buildBeautifyFilter({ strength: 1 }))
    expect(buildBeautifyFilter({ strength: -9 })).toBe(buildBeautifyFilter({ strength: -1 }))
  })
})

describe('buildBeautifyArgs', () => {
  it('wraps the filter into a full ffmpeg command', () => {
    const args = buildBeautifyArgs('in.jpg', 'out.jpg', { strength: 0.7 })
    expect(args[0]).toBe('-y')
    expect(args).toContain('in.jpg')
    expect(args).toContain('-vf')
    expect(args[args.length - 1]).toBe('out.jpg')
  })
})
