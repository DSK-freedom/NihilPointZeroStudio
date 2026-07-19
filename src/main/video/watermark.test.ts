import { describe, expect, it } from 'vitest'
import { buildWatermarkArgs, overlayXY } from './watermark'

describe('overlayXY', () => {
  it('places the logo in each corner with the margin', () => {
    expect(overlayXY('top-left', 24)).toBe('x=24:y=24')
    expect(overlayXY('top-right', 24)).toBe('x=W-w-24:y=24')
    expect(overlayXY('bottom-left', 24)).toBe('x=24:y=H-h-24')
    expect(overlayXY('bottom-right', 24)).toBe('x=W-w-24:y=H-h-24')
  })
})

describe('buildWatermarkArgs', () => {
  it('scales the logo and overlays it, copying audio', () => {
    const args = buildWatermarkArgs({ videoPath: 'v.mp4', logoPath: 'logo.png', logoWidthPx: 288, position: 'bottom-right', outPath: 'o.mp4' })
    const f = args.join(' ')
    expect(f).toContain('[1:v]scale=288:-1[wm]')
    expect(f).toContain('overlay=x=W-w-24:y=H-h-24')
    expect(f).toContain('-c:a copy')
    expect(f).toContain('0:a?') // tolerate videos with no audio
  })
  it('never scales below a sane minimum', () => {
    expect(buildWatermarkArgs({ videoPath: 'v', logoPath: 'l', logoWidthPx: 2, outPath: 'o' }).join(' ')).toContain('scale=16:-1')
  })
})
