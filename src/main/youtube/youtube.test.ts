import { describe, expect, it } from 'vitest'
import { buildUploadUrl, fallbackMeta } from './index'

describe('buildUploadUrl', () => {
  it('deep-links to the channel Studio upload page for a valid channel id', () => {
    expect(buildUploadUrl('UCLJDgGkwHZgrIfeiAWAwe2Q')).toBe(
      'https://studio.youtube.com/channel/UCLJDgGkwHZgrIfeiAWAwe2Q/videos/upload'
    )
  })
  it('falls back to the generic upload page when no/invalid channel id', () => {
    expect(buildUploadUrl('')).toBe('https://www.youtube.com/upload')
    expect(buildUploadUrl('not-a-channel')).toBe('https://www.youtube.com/upload')
  })
})

describe('fallbackMeta', () => {
  it('derives tags from the title words', () => {
    const m = fallbackMeta('Pakistan Rupee Crisis Explained')
    expect(m.description).toBe('Pakistan Rupee Crisis Explained')
    expect(m.tags).toContain('pakistan')
    expect(m.tags).toContain('rupee')
    expect(m.tags.every((t) => t.length > 2)).toBe(true)
  })
})
