import { describe, expect, it } from 'vitest'
import {
  beatStartTimes,
  buildStoryboardPrompt,
  compileStoryboardToTimeline,
  sanitizeStoryboard,
  storyboardDuration
} from './storyboard'
import type { ResolvedBeatAsset } from './storyboard'
import type { StoryboardDoc } from '../../shared/types'

const DEF = { width: 1920, height: 1080, fps: 25 }

describe('sanitizeStoryboard', () => {
  it('keeps valid beats, clamps duration, defaults enums', () => {
    const doc = sanitizeStoryboard(
      {
        title: 'My Day',
        style: 'nonsense',
        beats: [
          { durationSec: 15, visual: 'Ferrari arrival', narration: 'Watch this', subject: { kind: 'photo', beautify: true }, transitionSec: 1, motion: 'left', mood: 'bold' },
          { durationSec: 99999, visual: 'Helicopter over hills', subject: { kind: 'ai-person' } }
        ]
      },
      DEF
    )
    expect(doc.style).toBe('cinematic') // invalid → default
    expect(doc.beats).toHaveLength(2)
    expect(doc.beats[0].subject).toMatchObject({ kind: 'photo', beautify: true })
    expect(doc.beats[0].motion).toBe('left')
    expect(doc.beats[1].durationSec).toBe(600) // clamped to MAX_BEAT
    expect(doc.beats[1].subject.kind).toBe('ai-person')
  })

  it('drops empty beats (no visual, narration or caption) and clamps transition to duration', () => {
    const doc = sanitizeStoryboard(
      { beats: [{ subject: { kind: 'none' } }, { durationSec: 4, visual: 'x', transitionSec: 10 }] },
      DEF
    )
    expect(doc.beats).toHaveLength(1)
    expect(doc.beats[0].transitionSec).toBe(4) // clamped to the 4s beat
  })

  it('is safe on garbage', () => {
    expect(sanitizeStoryboard(null, DEF).beats).toHaveLength(0)
    expect(sanitizeStoryboard('nope', DEF).beats).toHaveLength(0)
    expect(sanitizeStoryboard({ beats: 'no' }, DEF).beats).toHaveLength(0)
  })

  it('keeps valid beat sounds and drops invalid ones', () => {
    const doc = sanitizeStoryboard(
      {
        beats: [
          {
            durationSec: 10,
            visual: 'x',
            sounds: [
              { kind: 'music', ref: 'calm', gain: 0.3 },
              { kind: 'sfx', ref: 'whoosh', atSec: 2 },
              { kind: 'file', src: 'C:/me.mp3' },
              { kind: 'music', ref: 'reggae' }, // invalid mood → dropped
              { kind: 'sfx' }, // no ref → dropped
              { kind: 'file' }, // no src → dropped
              { kind: 'bogus', ref: 'x' } // invalid kind → dropped
            ]
          }
        ]
      },
      DEF
    )
    const sounds = doc.beats[0].sounds!
    expect(sounds).toHaveLength(3)
    expect(sounds[0]).toMatchObject({ kind: 'music', ref: 'calm', gain: 0.3 })
    expect(sounds[1]).toMatchObject({ kind: 'sfx', ref: 'whoosh', atSec: 2 })
    expect(sounds[2]).toMatchObject({ kind: 'file', src: 'C:/me.mp3' })
  })
})

function doc(beats: StoryboardDoc['beats']): StoryboardDoc {
  return { title: 't', style: 'cinematic', ...DEF, beats }
}
const beat = (over: Partial<StoryboardDoc['beats'][number]> & { id: string; durationSec: number }): StoryboardDoc['beats'][number] => ({
  visual: 'scene',
  subject: { kind: 'none' },
  ...over
})

describe('beatStartTimes + storyboardDuration', () => {
  it('places sequential beats with no transitions back-to-back', () => {
    const d = doc([beat({ id: 'a', durationSec: 15 }), beat({ id: 'b', durationSec: 20 }), beat({ id: 'c', durationSec: 90 })])
    expect(beatStartTimes(d)).toEqual([0, 15, 35])
    expect(storyboardDuration(d)).toBe(125)
  })

  it('pulls each beat back by its crossfade (overlap) — matches the xfade offset', () => {
    const d = doc([beat({ id: 'a', durationSec: 15 }), beat({ id: 'b', durationSec: 20, transitionSec: 2 }), beat({ id: 'c', durationSec: 90, transitionSec: 3 })])
    // b starts at 15 − 2 = 13; c starts at (13 + 20) − 3 = 30
    expect(beatStartTimes(d)).toEqual([0, 13, 30])
    // total = 15 + 20 + 90 − 2 − 3 = 120
    expect(storyboardDuration(d)).toBe(120)
  })
})

describe('compileStoryboardToTimeline', () => {
  const d = doc([
    beat({ id: 'a', durationSec: 15, caption: 'INTRO', narration: 'hello' }),
    beat({ id: 'b', durationSec: 20, transitionSec: 2, narration: 'world' })
  ])
  const assets: Record<string, ResolvedBeatAsset> = {
    a: { clipPath: 'a.mp4', narrationPath: 'a.wav', narrationDurationSec: 4 },
    b: { clipPath: 'b.mp4', narrationPath: 'b.wav', narrationDurationSec: 18 }
  }

  it('maps beats to trimmed video clips with their transitions', () => {
    const tl = compileStoryboardToTimeline(d, assets)
    expect(tl.video).toHaveLength(2)
    expect(tl.video[0]).toMatchObject({ src: 'a.mp4', inSec: 0, outSec: 15, transitionSec: 0 })
    expect(tl.video[1]).toMatchObject({ src: 'b.mp4', outSec: 20, transitionSec: 2 })
  })

  it('anchors captions to the beat start with a fade', () => {
    const tl = compileStoryboardToTimeline(d, assets)
    expect(tl.text).toHaveLength(1)
    expect(tl.text[0]).toMatchObject({ text: 'INTRO', startSec: 0, endSec: 15, y: 'bottom' })
  })

  it('places each narration audio clip at its beat start, using the real audio length', () => {
    const tl = compileStoryboardToTimeline(d, assets)
    expect(tl.audio).toHaveLength(2)
    expect(tl.audio[0]).toMatchObject({ src: 'a.wav', atSec: 0, outSec: 4 })
    // b starts at 15 − 2 = 13
    expect(tl.audio[1]).toMatchObject({ src: 'b.wav', atSec: 13, outSec: 18 })
  })

  it('omits narration audio when the asset has no narration path', () => {
    const tl = compileStoryboardToTimeline(d, { a: { clipPath: 'a.mp4' }, b: { clipPath: 'b.mp4' } })
    expect(tl.audio).toHaveLength(0)
  })

  it('places per-beat sounds at (beat start + sound offset) on the audio track', () => {
    const tl = compileStoryboardToTimeline(d, {
      a: { clipPath: 'a.mp4' },
      b: {
        clipPath: 'b.mp4',
        sounds: [{ path: 'boom.wav', atSec: 1.5, outSec: 2, gain: 0.8, fadeInSec: 0.2, fadeOutSec: 0.5 }]
      }
    })
    // b starts at 13 (15 − 2 crossfade); the sound sits at 13 + 1.5 = 14.5
    const s = tl.audio.find((c) => c.src === 'boom.wav')!
    expect(s).toMatchObject({ atSec: 14.5, outSec: 2, gain: 0.8, fadeInSec: 0.2, fadeOutSec: 0.5 })
  })
})

describe('buildStoryboardPrompt', () => {
  it('auto mode tells the model to decide everything', () => {
    const p = buildStoryboardPrompt({ mode: 'auto', title: 'T', brief: 'a script', totalSeconds: 120 })
    expect(p).toMatch(/AUTO/)
    expect(p).toMatch(/decide everything/)
    expect(p).toMatch(/about 120s/)
  })
  it('guided mode tells the model to honour the user beats', () => {
    const p = buildStoryboardPrompt({ mode: 'guided', title: 'T', brief: 'first 15s ferrari...' })
    expect(p).toMatch(/GUIDED/)
    expect(p).toMatch(/faithfully/i)
  })
})
