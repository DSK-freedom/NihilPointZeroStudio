import { describe, expect, it } from 'vitest'
import { planPresenterStoryboard, splitScriptBeats } from './presenter'

const script = Array.from(
  { length: 16 },
  (_, i) => `This is sentence number ${i} explaining a clear point about the mineral market here.`
).join(' ')

describe('splitScriptBeats', () => {
  it('splits plain prose into ~2-sentence beats', () => {
    expect(splitScriptBeats(script).length).toBeGreaterThan(4)
  })
  it('uses descriptive [visual] blocks when the script has several', () => {
    const body = Array.from({ length: 5 }, (_, i) => `[A cinematic drone shot of mine site ${i}, golden light]\nNarration line ${i} here goes on.`).join('\n\n')
    const beats = splitScriptBeats(body)
    expect(beats).toHaveLength(5)
    expect(beats[0].visual).toContain('drone shot')
  })
})

describe('planPresenterStoryboard', () => {
  it('video (real-voice): fills the video length, no TTS, your clip on presenter beats, real voice as master', () => {
    const doc = planPresenterStoryboard({
      title: 'Doc', body: script, mode: 'video', everyN: 4,
      presenterSrc: 'C:/me.mp4', voiceTrackSeconds: 120, masterAudioSrc: 'C:/voice.wav'
    })
    expect(doc.beats[0].subject.kind).toBe('clip')
    expect(doc.beats[0].subject.src).toBe('C:/me.mp4')
    expect(doc.beats[1].subject.kind).toBe('none') // b-roll
    expect(doc.beats.every((b) => b.narration === undefined)).toBe(true) // no TTS — real voice
    expect(doc.beats[0].sounds?.[0]).toMatchObject({ kind: 'file', src: 'C:/voice.wav', atSec: 0 })
    const total = doc.beats.reduce((s, b) => s + b.durationSec, 0)
    expect(Math.abs(total - 120)).toBeLessThanOrEqual(2) // beats fill the voice track
  })
  it('photo: presenter beats use the beautified photo, narration is spoken (TTS)', () => {
    const doc = planPresenterStoryboard({ title: 'Doc', body: script, mode: 'photo', everyN: 3 })
    expect(doc.beats[0].subject.kind).toBe('photo')
    expect(doc.beats[0].subject.beautify).toBe(true)
    expect((doc.beats[0].narration ?? '').length).toBeGreaterThan(0)
  })
  it('graft: presenter beats are clips flagged for the lip-graft tool', () => {
    const doc = planPresenterStoryboard({ title: 'Doc', body: script, mode: 'graft', presenterSrc: 'C:/me.mp4', voiceTrackSeconds: 60, masterAudioSrc: 'C:/v.wav' })
    expect(doc.beats[0].subject.kind).toBe('clip')
    expect(doc.beats[0].subject.description).toBe('lip-graft')
  })
  it('beat durations stay sane (3-30s)', () => {
    const doc = planPresenterStoryboard({ title: 'Doc', body: script, mode: 'photo' })
    expect(doc.beats.every((b) => b.durationSec >= 3 && b.durationSec <= 30)).toBe(true)
  })
})
