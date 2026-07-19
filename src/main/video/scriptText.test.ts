import { describe, expect, it } from 'vitest'
import { deriveTitleFromFilename, normalizeScriptText, stripSrt } from './scriptText'

describe('stripSrt', () => {
  it('removes sequence numbers and time ranges, keeping spoken text', () => {
    const srt = [
      '1',
      '00:00:01,000 --> 00:00:04,000',
      'Welcome back to the channel.',
      '',
      '2',
      '00:00:04,500 --> 00:00:07,200',
      'Today we talk about <i>inflation</i>.'
    ].join('\n')
    expect(stripSrt(srt)).toBe('Welcome back to the channel.\nToday we talk about inflation.')
  })

  it('handles dot-millisecond timestamps too', () => {
    const srt = '1\n00:00:01.000 --> 00:00:02.000\nHello'
    expect(stripSrt(srt)).toBe('Hello')
  })
})

describe('deriveTitleFromFilename', () => {
  it('drops the extension and tidies separators', () => {
    expect(deriveTitleFromFilename('my_big-video.final.srt')).toBe('my big video.final')
    expect(deriveTitleFromFilename('inflation-explained.txt')).toBe('inflation explained')
  })
})

describe('normalizeScriptText', () => {
  it('strips srt scaffolding for .srt but passes plain text through', () => {
    expect(normalizeScriptText('1\n00:00:01,000 --> 00:00:02,000\nHi there', 'srt')).toBe('Hi there')
    expect(normalizeScriptText('Just a line\n\n\n\nAnother', 'txt')).toBe('Just a line\n\nAnother')
  })

  it('collapses 3+ blank lines and trims trailing whitespace', () => {
    expect(normalizeScriptText('a   \n\n\n\nb   ', 'md')).toBe('a\n\nb')
  })
})
