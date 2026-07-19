import { describe, expect, it } from 'vitest'
import { buildSrt, srtTime, buildBurnSubsArgs, escapeSubtitlesPath } from './captions'

describe('srtTime', () => {
  it('formats HH:MM:SS,mmm', () => {
    expect(srtTime(0)).toBe('00:00:00,000')
    expect(srtTime(65.25)).toBe('00:01:05,250')
    expect(srtTime(3661.5)).toBe('01:01:01,500')
  })
})

describe('buildSrt', () => {
  it('numbers cues and formats time ranges', () => {
    const srt = buildSrt([
      { text: 'Hello there', start: 0, end: 2 },
      { text: 'second line', start: 2, end: 4.5 }
    ])
    expect(srt).toContain('1\n00:00:00,000 --> 00:00:02,000\nHello there')
    expect(srt).toContain('2\n00:00:02,000 --> 00:00:04,500\nsecond line')
  })
  it('skips empty text and gives a default 2s duration when end<=start', () => {
    const srt = buildSrt([{ text: '  ', start: 0, end: 1 }, { text: 'x', start: 5, end: 5 }])
    expect(srt).toContain('00:00:05,000 --> 00:00:07,000\nx')
    expect(srt).not.toMatch(/^1\n.*\n\s*\n/m) // the blank one was dropped
  })
})

describe('escapeSubtitlesPath / burn args', () => {
  it('escapes the drive colon and backslashes', () => {
    expect(escapeSubtitlesPath('C:\\Users\\a\\v.srt')).toBe('C\\:/Users/a/v.srt')
  })
  it('builds a burn command that re-encodes video and copies audio', () => {
    const args = buildBurnSubsArgs('v.mp4', 'C:\\x\\c.srt', 'o.mp4')
    expect(args.join(' ')).toContain("subtitles='C\\:/x/c.srt'")
    expect(args.join(' ')).toContain('-c:a copy')
    expect(args).toContain('libx264')
  })
})
