import { describe, expect, it } from 'vitest'
import { buildVideoEncoderArgs, encoderLabel, HW_H264, isHardware, shouldUseHardware } from './encoder'

describe('shouldUseHardware', () => {
  it('uses hardware for 4K/8K regardless of length', () => {
    expect(shouldUseHardware(3840, 5)).toBe(true)
    expect(shouldUseHardware(7680, 5)).toBe(true)
  })
  it('uses hardware for long videos even at 1080p', () => {
    expect(shouldUseHardware(1920, 45)).toBe(true)
    expect(shouldUseHardware(1920, 600)).toBe(true)
  })
  it('uses the CPU for short low-res clips (GPU overhead not worth it)', () => {
    expect(shouldUseHardware(1920, 10)).toBe(false)
    expect(shouldUseHardware(2560, 20)).toBe(false)
  })
})

describe('buildVideoEncoderArgs', () => {
  it('starts every encoder block with -c:v <encoder> and sets a pixel format', () => {
    for (const enc of [...HW_H264, 'libx264']) {
      const args = buildVideoEncoderArgs(enc)
      expect(args[0]).toBe('-c:v')
      expect(args[1]).toBe(enc)
      expect(args).toContain('-pix_fmt')
    }
  })

  it('uses nv12 for QuickSync and yuv420p elsewhere', () => {
    expect(buildVideoEncoderArgs('h264_qsv')).toContain('nv12')
    expect(buildVideoEncoderArgs('h264_nvenc')).toContain('yuv420p')
    expect(buildVideoEncoderArgs('libx264')).toContain('yuv420p')
  })

  it('falls back to libx264 for an unknown id', () => {
    expect(buildVideoEncoderArgs('nonsense')[1]).toBe('libx264')
  })
})

describe('isHardware / encoderLabel', () => {
  it('flags hardware encoders and labels them', () => {
    expect(isHardware('h264_nvenc')).toBe(true)
    expect(isHardware('libx264')).toBe(false)
    expect(encoderLabel('h264_nvenc')).toMatch(/NVIDIA/)
    expect(encoderLabel('libx264')).toMatch(/CPU/)
  })
})
