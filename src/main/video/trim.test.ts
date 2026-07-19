import { describe, expect, it } from 'vitest'
import { buildKeepArgs, buildRemoveArgs, buildTrimArgs, clampRange } from './trim'

describe('clampRange', () => {
  it('clamps start/end into [0, duration]', () => {
    expect(clampRange(-5, 100, 60)).toEqual({ start: 0, end: 60 })
    expect(clampRange(10, 20, 60)).toEqual({ start: 10, end: 20 })
  })

  it('throws when the range is too short or inverted', () => {
    expect(() => clampRange(30, 30, 60)).toThrow()
    expect(() => clampRange(40, 10, 60)).toThrow()
  })

  it('throws when duration is unknown', () => {
    expect(() => clampRange(0, 5, 0)).toThrow()
  })
})

describe('buildKeepArgs', () => {
  it('uses output-side seeking (-ss/-to after -i) for frame accuracy', () => {
    const args = buildKeepArgs('in.mp4', { start: 5, end: 12.5 }, 'out.mp4')
    const i = args.indexOf('-i')
    const ss = args.indexOf('-ss')
    expect(ss).toBeGreaterThan(i) // -ss comes AFTER -i
    expect(args).toContain('12.500')
    expect(args).toContain('libx264')
    expect(args.join(' ')).toContain('-movflags +faststart')
  })
})

describe('buildRemoveArgs', () => {
  const dur = 60

  it('removing a middle range concats two segments', () => {
    const args = buildRemoveArgs('in.mp4', { start: 20, end: 30 }, dur, 'out.mp4')
    const fc = args[args.indexOf('-filter_complex') + 1]
    expect(fc).toContain('concat=n=2:v=1:a=1')
    expect(fc).toContain('trim=0:20.000')
    expect(fc).toContain('trim=30.000:60.000')
  })

  it('removing from the start degrades to a single keep of the tail', () => {
    const args = buildRemoveArgs('in.mp4', { start: 0, end: 15 }, dur, 'out.mp4')
    expect(args).not.toContain('-filter_complex')
    expect(args).toContain('15.000') // keep [15, 60]
    expect(args).toContain('60.000')
  })

  it('removing to the end degrades to a single keep of the head', () => {
    const args = buildRemoveArgs('in.mp4', { start: 45, end: 60 }, dur, 'out.mp4')
    expect(args).not.toContain('-filter_complex')
    expect(args).toContain('45.000') // keep [0, 45]
  })

  it('throws if the cut would remove the entire clip', () => {
    expect(() => buildRemoveArgs('in.mp4', { start: 0, end: 60 }, dur, 'out.mp4')).toThrow()
  })
})

describe('buildTrimArgs dispatch', () => {
  it('routes keep vs remove', () => {
    expect(buildTrimArgs('keep', 'in.mp4', { start: 1, end: 2 }, 10, 'o.mp4')).toContain('-ss')
    expect(buildTrimArgs('remove', 'in.mp4', { start: 3, end: 6 }, 10, 'o.mp4')).toContain('-filter_complex')
  })
})
