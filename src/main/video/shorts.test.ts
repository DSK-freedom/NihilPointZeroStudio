import { describe, expect, it } from 'vitest'
import { buildShortArgs, pickShortMoments, scoreSegment } from './shorts'
import type { CaptionSegment } from './captions'

/** Builds a spoken transcript: one segment per line, `secs` long each. */
function transcript(lines: string[], secs = 5): CaptionSegment[] {
  return lines.map((text, i) => ({ text, start: i * secs, end: (i + 1) * secs }))
}

describe('scoreSegment', () => {
  it('rewards hook words, numbers and questions', () => {
    const plain = scoreSegment('The market was open on Tuesday as usual and things went along.')
    const hooky = scoreSegment('But why did nobody notice the 40 percent collapse?')
    expect(hooky.score).toBeGreaterThan(plain.score)
    expect(hooky.reason).toMatch(/hook words|question|number/)
  })

  it('always explains its choice', () => {
    expect(scoreSegment('Something entirely ordinary.').reason).toBeTruthy()
  })
})

describe('pickShortMoments', () => {
  // 12 lines × 5s = a 60s source, so three ~15s clips genuinely fit.
  const lines = [
    'Welcome back to the channel today we are talking about the market.',
    'But why did nobody notice the 40 percent collapse in bank stocks?',
    'The index opened flat and drifted sideways for most of the morning.',
    'Trading desks reported steady interest from local institutional buyers.',
    'Here is the secret most people never understand about inflation numbers.',
    'The central bank kept its policy rate unchanged at the last meeting.',
    'Volumes were thin and the rupee held steady against the dollar.',
    'Analysts expect the trend to continue through the coming quarter.',
    'Remember this one mistake costs investors billions every single year.',
    'Foreign flows turned positive for the third consecutive session.',
    'Cement and fertiliser names led the gains on the benchmark index.',
    'That is all for today thanks for watching and see you next time.'
  ]

  it('returns the requested number of non-overlapping clips in time order', () => {
    const picks = pickShortMoments(transcript(lines), { count: 3, minSec: 10, maxSec: 15 })
    expect(picks).toHaveLength(3)
    for (let i = 1; i < picks.length; i++) {
      expect(picks[i].startSec).toBeGreaterThanOrEqual(picks[i - 1].endSec)
    }
  })

  it('returns FEWER clips (never overlapping ones) when the video is too short for the ask', () => {
    // 35s of source cannot hold three 20s clips — quality over quantity.
    const picks = pickShortMoments(transcript(lines.slice(0, 7)), { count: 3, minSec: 10, maxSec: 20 })
    expect(picks.length).toBeLessThan(3)
    expect(picks.length).toBeGreaterThan(0)
    for (let i = 1; i < picks.length; i++) {
      expect(picks[i].startSec).toBeGreaterThanOrEqual(picks[i - 1].endSec)
    }
  })

  it('prefers hooky openings over filler', () => {
    const picks = pickShortMoments(transcript(lines), { count: 2, minSec: 10, maxSec: 20 })
    const openings = picks.map((p) => p.captions[0].text).join(' | ')
    expect(openings).toMatch(/why did nobody|secret|mistake/i)
  })

  it('keeps clips inside the requested length window', () => {
    const picks = pickShortMoments(transcript(lines), { count: 3, minSec: 10, maxSec: 15 })
    for (const p of picks) {
      const len = p.endSec - p.startSec
      expect(len).toBeLessThanOrEqual(15)
      expect(len).toBeGreaterThan(0)
    }
  })

  it('re-bases captions so every clip starts at zero', () => {
    const picks = pickShortMoments(transcript(lines), { count: 3, minSec: 10, maxSec: 20 })
    for (const p of picks) {
      expect(p.captions[0].start).toBe(0)
      expect(p.captions[p.captions.length - 1].end).toBeLessThanOrEqual(p.endSec - p.startSec + 0.001)
    }
  })

  it('gives every clip a title and a human reason', () => {
    for (const p of pickShortMoments(transcript(lines), { count: 2, minSec: 10, maxSec: 20 })) {
      expect(p.title.length).toBeGreaterThan(0)
      expect(p.reason.length).toBeGreaterThan(0)
    }
  })

  it('is safe on an empty or speechless transcript', () => {
    expect(pickShortMoments([])).toEqual([])
    expect(pickShortMoments([{ text: '   ', start: 0, end: 3 }])).toEqual([])
  })

  it('still returns one clip for a video shorter than the minimum', () => {
    const picks = pickShortMoments(transcript(['A very short video about one single idea.']), {
      count: 3,
      minSec: 20,
      maxSec: 60
    })
    expect(picks).toHaveLength(1)
  })
})

describe('buildShortArgs', () => {
  const base = { srcPath: 'C:\\v\\in.mp4', outPath: 'C:\\v\\out.mp4', startSec: 12.5, endSec: 45 }

  it('cuts the exact window and reframes to a 9:16 1080x1920 canvas', () => {
    const a = buildShortArgs(base).join(' ')
    expect(a).toContain('-ss 12.500')
    expect(a).toContain('-to 45.000')
    expect(a).toContain('crop=')
    expect(a).toContain('scale=1080:1920')
    expect(a).toContain('setsar=1')
  })

  it('burns captions with the big centred short-form style when an srt is given', () => {
    const a = buildShortArgs({ ...base, srtPath: 'C:\\v\\clip.srt' }).join(' ')
    expect(a).toContain('subtitles=')
    expect(a).toContain('Bold=1')
    expect(a).toContain('Alignment=2')
  })

  it('omits the subtitles filter entirely when there is no srt', () => {
    expect(buildShortArgs(base).join(' ')).not.toContain('subtitles=')
  })

  it('honours a custom height and keeps the width even', () => {
    const a = buildShortArgs({ ...base, height: 1280 }).join(' ')
    expect(a).toContain('scale=720:1280')
  })
})
