import { describe, expect, it } from 'vitest'
import { AUDIO_ENHANCE_FILTER, VIDEO_ENHANCE_FILTER, buildEnhanceArgs } from './enhance'

describe('media enhance filters', () => {
  it('audio chain de-noises, normalizes loudness and limits peaks', () => {
    expect(AUDIO_ENHANCE_FILTER).toContain('afftdn')
    expect(AUDIO_ENHANCE_FILTER).toContain('loudnorm=I=-16')
    expect(AUDIO_ENHANCE_FILTER).toContain('alimiter=limit=0.95:level=disabled')
  })
  it('video chain grades colour and sharpens', () => {
    expect(VIDEO_ENHANCE_FILTER).toContain('eq=')
    expect(VIDEO_ENHANCE_FILTER).toContain('unsharp')
  })
})

describe('buildEnhanceArgs', () => {
  it('both passes: re-encodes video + audio with the enhance filters', () => {
    const a = buildEnhanceArgs('in.mp4', 'out.mp4', { audio: true, video: true })
    const s = a.join(' ')
    expect(s).toContain('-vf ' + VIDEO_ENHANCE_FILTER)
    expect(s).toContain('-af ' + AUDIO_ENHANCE_FILTER)
    expect(s).toContain('-c:v libx264')
    expect(s).toContain('-c:a aac')
    expect(a[a.length - 1]).toBe('out.mp4')
  })
  it('audio only: copies video, enhances audio', () => {
    const s = buildEnhanceArgs('in.mp4', 'out.mp4', { audio: true, video: false }).join(' ')
    expect(s).toContain('-c:v copy')
    expect(s).toContain('-af ' + AUDIO_ENHANCE_FILTER)
    expect(s).not.toContain('-vf')
  })
  it('video only: enhances video, copies audio', () => {
    const s = buildEnhanceArgs('in.mp4', 'out.mp4', { audio: false, video: true }).join(' ')
    expect(s).toContain('-vf ' + VIDEO_ENHANCE_FILTER)
    expect(s).toContain('-c:a copy')
  })
})
