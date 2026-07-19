import { describe, expect, it } from 'vitest'
import { buildCompositeArgs, buildCompositeFilter } from './composite'

describe('buildCompositeFilter', () => {
  it('cover-fills the background and crops to the exact frame', () => {
    const f = buildCompositeFilter({ width: 1920, height: 1080 })
    expect(f).toContain('scale=1920:1080:force_original_aspect_ratio=increase,crop=1920:1080')
  })

  it('scales the subject to the requested fraction of frame height', () => {
    const f = buildCompositeFilter({ width: 1920, height: 1080, subjectScale: 0.5 })
    expect(f).toContain('scale=-1:540') // 1080 * 0.5
  })

  it('anchors bottom-center by default', () => {
    const f = buildCompositeFilter({ width: 1920, height: 1080 })
    expect(f).toContain('overlay=(W-w)/2:H-h')
  })

  it('honours left/right/top/middle anchors', () => {
    expect(buildCompositeFilter({ width: 100, height: 100, x: 'left', y: 'top' })).toContain('overlay=40:40')
    expect(buildCompositeFilter({ width: 100, height: 100, x: 'right', y: 'middle' })).toContain('overlay=W-w-40:(H-h)/2')
  })

  it('clamps subjectScale into [0.1, 1]', () => {
    expect(buildCompositeFilter({ width: 100, height: 100, subjectScale: 5 })).toContain('scale=-1:100')
    expect(buildCompositeFilter({ width: 100, height: 1000, subjectScale: 0 })).toContain('scale=-1:100') // 1000 * 0.1
  })
})

describe('buildCompositeArgs', () => {
  it('maps two inputs through the composite to one image', () => {
    const args = buildCompositeArgs('bg.jpg', 'me.png', 'out.jpg', { width: 1920, height: 1080 })
    expect(args).toContain('bg.jpg')
    expect(args).toContain('me.png')
    expect(args).toContain('-filter_complex')
    expect(args).toContain('[out]')
    expect(args[args.length - 1]).toBe('out.jpg')
  })
})
