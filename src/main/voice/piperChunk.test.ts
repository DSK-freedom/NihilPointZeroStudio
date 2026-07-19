import { describe, it, expect } from 'vitest'
import { chunkForPiper } from './piper'

/**
 * Piper synthesizes stdin one LINE at a time and overwrites --output_file per line, so a
 * multi-paragraph script previously left only the LAST line's audio in the WAV. chunkForPiper
 * normalises to single-line chunks that are later concatenated, so the whole script is spoken.
 */
describe('chunkForPiper', () => {
  it('produces single-line chunks (no embedded newlines)', () => {
    const text = 'First paragraph sentence one. Sentence two.\n\nSecond paragraph here.\nThird line.'
    const chunks = chunkForPiper(text)
    expect(chunks.length).toBeGreaterThan(0)
    for (const c of chunks) expect(c).not.toMatch(/[\r\n]/)
  })

  it('keeps chunks within the size budget (plus one trailing sentence)', () => {
    const sentence = 'This is a moderately long narration sentence that adds up. '
    const text = sentence.repeat(60) // ~3400 chars
    const chunks = chunkForPiper(text, 600)
    expect(chunks.length).toBeGreaterThan(1)
    for (const c of chunks) expect(c.length).toBeLessThanOrEqual(600 + sentence.length)
  })

  it('preserves the full content across chunks (nothing dropped)', () => {
    const text = 'Alpha one two three. Bravo four five six. Charlie seven eight nine. Delta ten.'
    const rejoined = chunkForPiper(text, 30).join(' ')
    for (const word of ['Alpha', 'Bravo', 'Charlie', 'Delta', 'ten']) {
      expect(rejoined).toContain(word)
    }
  })

  it('returns [] for empty/whitespace text', () => {
    expect(chunkForPiper('   \n  ')).toEqual([])
  })

  it('handles a single short line without splitting', () => {
    expect(chunkForPiper('Just one short line.')).toEqual(['Just one short line.'])
  })
})
