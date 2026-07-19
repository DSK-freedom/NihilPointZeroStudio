import { describe, expect, it } from 'vitest'
import {
  buildTimelineArgs,
  buildTimelinePlan,
  clipDuration,
  sanitizeOverlayText,
  videoTrackDuration
} from './timeline'
import type { TimelineDoc, TimelineVideoClip } from '../../shared/types'

function vclip(over: Partial<TimelineVideoClip> & { inSec: number; outSec: number }): TimelineVideoClip {
  return { id: 'v', src: 'clip.mp4', ...over }
}

function doc(over: Partial<TimelineDoc>): TimelineDoc {
  return { width: 1920, height: 1080, fps: 25, video: [], audio: [], text: [], ...over }
}

describe('clipDuration', () => {
  it('is out - in, never negative', () => {
    expect(clipDuration(2, 10)).toBe(8)
    expect(clipDuration(10, 2)).toBe(0)
  })
})

describe('videoTrackDuration', () => {
  it('sums clip durations with no transitions', () => {
    const d = doc({ video: [vclip({ inSec: 0, outSec: 5 }), vclip({ inSec: 0, outSec: 3 })] })
    expect(videoTrackDuration(d)).toBe(8)
  })
  it('subtracts each crossfade (transitions overlap)', () => {
    const d = doc({
      video: [vclip({ inSec: 0, outSec: 5 }), vclip({ inSec: 0, outSec: 5, transitionSec: 1 }), vclip({ inSec: 0, outSec: 5, transitionSec: 2 })]
    })
    // 5 + 5 + 5 − 1 − 2 = 12
    expect(videoTrackDuration(d)).toBe(12)
  })
  it('clamps a transition longer than its clip', () => {
    const d = doc({ video: [vclip({ inSec: 0, outSec: 5 }), vclip({ inSec: 0, outSec: 2, transitionSec: 10 })] })
    // transition clamped to the 2s clip → 5 + 2 − 2 = 5
    expect(videoTrackDuration(d)).toBe(5)
  })
})

describe('buildTimelinePlan — video', () => {
  it('trims and normalises each clip to WxH@fps', () => {
    const plan = buildTimelinePlan(doc({ video: [vclip({ src: 'a.mp4', inSec: 2, outSec: 7 })] }))
    expect(plan.inputs).toEqual(['a.mp4'])
    expect(plan.chains[0]).toContain('[0:v]trim=start=2.000:end=7.000')
    expect(plan.chains[0]).toContain('scale=1920:1080:force_original_aspect_ratio=decrease')
    expect(plan.chains[0]).toContain('fps=25[v0]')
    expect(plan.videoMap).toBe('[v0]')
  })

  it('hard-cuts adjacent clips with pairwise concat', () => {
    const plan = buildTimelinePlan(doc({ video: [vclip({ inSec: 0, outSec: 5 }), vclip({ inSec: 0, outSec: 4 })] }))
    expect(plan.chains.some((c) => c.includes('[v0][v1]concat=n=2:v=1:a=0[j1]'))).toBe(true)
    expect(plan.videoMap).toBe('[j1]')
  })

  it('crossfades with the correct offset (accumulated length − transition)', () => {
    const plan = buildTimelinePlan(
      doc({
        video: [
          vclip({ inSec: 0, outSec: 5 }),
          vclip({ inSec: 0, outSec: 5, transitionSec: 1 }),
          vclip({ inSec: 0, outSec: 5, transitionSec: 2 })
        ]
      })
    )
    // first xfade offset = 5 − 1 = 4
    expect(plan.chains.some((c) => c.includes('xfade=transition=fade:duration=1.000:offset=4.000'))).toBe(true)
    // running length after first xfade = 5 + 5 − 1 = 9; second offset = 9 − 2 = 7
    expect(plan.chains.some((c) => c.includes('xfade=transition=fade:duration=2.000:offset=7.000'))).toBe(true)
  })

  it('throws with no video clips', () => {
    expect(() => buildTimelinePlan(doc({ video: [] }))).toThrow(/no video clips/i)
  })
})

describe('buildTimelinePlan — text overlays', () => {
  it('draws each overlay with an enable range and applies a fade alpha', () => {
    const plan = buildTimelinePlan(
      doc({
        video: [vclip({ inSec: 0, outSec: 10 })],
        text: [{ id: 't', text: 'Hello', startSec: 1, endSec: 4, fadeSec: 0.5, x: 'left', y: 'bottom' }]
      })
    )
    const dt = plan.chains.find((c) => c.includes('drawtext'))!
    expect(dt).toContain('fontfile=') // REQUIRED on Windows ffmpeg (no fontconfig)
    expect(dt).toContain("text='Hello'")
    expect(dt).toContain("enable='between(t,1.000,4.000)'")
    expect(dt).toContain('alpha=') // fade present
    expect(plan.videoMap).toBe('[vout]')
  })

  it('omits alpha when there is no fade', () => {
    const plan = buildTimelinePlan(
      doc({ video: [vclip({ inSec: 0, outSec: 10 })], text: [{ id: 't', text: 'X', startSec: 0, endSec: 2 }] })
    )
    const dt = plan.chains.find((c) => c.includes('drawtext'))!
    expect(dt).not.toContain('alpha=')
  })
})

describe('buildTimelinePlan — audio', () => {
  it('trims, gains, fades and delays a clip, then mixes', () => {
    const plan = buildTimelinePlan(
      doc({
        video: [vclip({ inSec: 0, outSec: 10 })],
        audio: [{ id: 'a', src: 'm.mp3', inSec: 0, outSec: 8, atSec: 2.5, gain: 0.5, fadeInSec: 1, fadeOutSec: 2 }]
      })
    )
    // audio input index = after the 1 video input
    const chain = plan.chains.find((c) => c.startsWith('[1:a]'))!
    expect(chain).toContain('atrim=0.000:8.000')
    expect(chain).toContain('volume=0.500')
    expect(chain).toContain('afade=t=in:st=0:d=1.000')
    expect(chain).toContain('afade=t=out:st=6.000:d=2.000') // 8 − 2
    expect(chain).toContain('adelay=2500:all=1')
    expect(plan.chains.some((c) => c.includes('amix=inputs=1:duration=longest:normalize=0[amx]'))).toBe(true)
    expect(plan.chains.some((c) => c.includes('alimiter=limit=0.95:level=disabled[aout]'))).toBe(true)
    expect(plan.audioMap).toBe('[aout]')
  })

  it('has no audio map when the audio track is empty', () => {
    const plan = buildTimelinePlan(doc({ video: [vclip({ inSec: 0, outSec: 5 })] }))
    expect(plan.audioMap).toBeNull()
  })

  it('treats gain 0 as a real mute', () => {
    const plan = buildTimelinePlan(
      doc({ video: [vclip({ inSec: 0, outSec: 5 })], audio: [{ id: 'a', src: 'm.mp3', inSec: 0, outSec: 5, atSec: 0, gain: 0 }] })
    )
    expect(plan.chains.find((c) => c.startsWith('[1:a]'))).toContain('volume=0.000')
  })
})

describe('sanitizeOverlayText', () => {
  it('neutralises quotes, colons, percent and newlines', () => {
    expect(sanitizeOverlayText("It's 50% up:\nnow")).toBe('It’s 50 percent up\\: now')
  })
})

describe('buildTimelineArgs', () => {
  it('assembles inputs, filter_complex, maps and output', () => {
    const args = buildTimelineArgs(
      doc({
        video: [vclip({ src: 'a.mp4', inSec: 0, outSec: 5 })],
        audio: [{ id: 'a', src: 'm.mp3', inSec: 0, outSec: 5, atSec: 0 }]
      }),
      ['-c:v', 'libx264'],
      'out.mp4'
    )
    expect(args[0]).toBe('-y')
    expect(args).toContain('a.mp4')
    expect(args).toContain('m.mp3')
    expect(args).toContain('-filter_complex')
    expect(args).toContain('-map')
    expect(args).toContain('[aout]')
    expect(args).toContain('-c:a')
    expect(args[args.length - 1]).toBe('out.mp4')
  })

  it('omits the audio codec/map when there is no audio', () => {
    const args = buildTimelineArgs(doc({ video: [vclip({ inSec: 0, outSec: 5 })] }), ['-c:v', 'libx264'], 'o.mp4')
    expect(args).not.toContain('[aout]')
    expect(args).not.toContain('-c:a')
  })
})
