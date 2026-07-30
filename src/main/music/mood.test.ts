import { describe, expect, it } from 'vitest'
import { moodsFromText, normalizeMoods, parseMoodReply } from './mood'

describe('mood keywords', () => {
  it('always returns at least two keywords, even for empty text', () => {
    expect(moodsFromText('').length).toBeGreaterThanOrEqual(2)
  })

  it('picks a tense mood for a crisis script', () => {
    expect(moodsFromText('The market crash and the debt crisis put everything at risk')).toContain('tense')
  })

  it('picks an uplifting mood for a growth script', () => {
    expect(moodsFromText('Record profit, strong growth and a huge rally this year')).toContain('uplifting')
  })

  it('never returns more than three keywords', () => {
    expect(moodsFromText('crash crisis growth profit business market future dream history').length).toBeLessThanOrEqual(3)
  })

  // The search takes a keyword, not prose — an AI that ignores the instruction and
  // replies with a sentence must not poison the query.
  it('trims a chatty AI reply down to keywords', () => {
    expect(normalizeMoods(['Sure! Here you go: dramatic orchestral music for tension'])).toEqual(['sure here'])
  })

  it('strips punctuation and deduplicates', () => {
    expect(normalizeMoods(['tense!', 'TENSE', 'calm.'])).toEqual(['tense', 'calm'])
  })

  it('parses a comma-separated AI reply', () => {
    expect(parseMoodReply('tense, dramatic, dark', 'anything')).toEqual(['tense', 'dramatic', 'dark'])
  })

  it('parses a newline-separated AI reply', () => {
    expect(parseMoodReply('uplifting\ncorporate', 'anything')).toEqual(['uplifting', 'corporate'])
  })

  // A broken/refusing AI must not leave the video silent.
  it('falls back to word matching when the AI reply is unusable', () => {
    expect(parseMoodReply('', 'a story about the debt crisis and fraud')).toContain('tense')
  })

  it('falls back when the AI returns only one keyword', () => {
    const out = parseMoodReply('calm', 'growth and profit everywhere')
    expect(out.length).toBeGreaterThanOrEqual(2)
  })
})
