import { describe, expect, it } from 'vitest'
import { buildStitchArgs } from './stitch'

const enc = ['-c:v', 'libx264', '-preset', 'veryfast', '-pix_fmt', 'yuv420p']

describe('buildStitchArgs', () => {
  it('throws with fewer than two inputs', () => {
    expect(() => buildStitchArgs({ inputs: ['a.mp4'], width: 1920, height: 1080, encoderArgs: enc, outPath: 'o.mp4' })).toThrow()
  })

  it('adds one -i per input and concatenates N streams', () => {
    const args = buildStitchArgs({ inputs: ['a.mp4', 'b.mp4', 'c.mp4'], width: 1920, height: 1080, encoderArgs: enc, outPath: 'o.mp4' })
    expect((args.filter((x) => x === '-i')).length).toBe(3)
    const fc = args[args.indexOf('-filter_complex') + 1]
    expect(fc).toContain('concat=n=3:v=1:a=1')
    expect(fc).toContain('[v0][a0][v1][a1][v2][a2]concat')
    expect(args[args.length - 1]).toBe('o.mp4')
  })

  it('scales+pads each input to the common frame and normalizes audio', () => {
    const args = buildStitchArgs({ inputs: ['a.mp4', 'b.mp4'], width: 1280, height: 720, encoderArgs: enc, outPath: 'o.mp4' })
    const fc = args[args.indexOf('-filter_complex') + 1]
    expect(fc).toContain('scale=1280:720:force_original_aspect_ratio=decrease')
    expect(fc).toContain('pad=1280:720')
    expect(fc).toContain('aformat=sample_rates=44100:channel_layouts=stereo')
  })
})
