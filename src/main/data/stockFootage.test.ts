import { describe, expect, it } from 'vitest'
import { pickClipUrl, sanitizeKeyword } from './stockFootage'

describe('sanitizeKeyword', () => {
  it('lowercases and strips punctuation to a clean query', () => {
    expect(sanitizeKeyword('[TRADE DEFICIT!]')).toBe('trade deficit')
    expect(sanitizeKeyword('Oil & Gas, 2024')).toBe('oil gas 2024')
  })
})

describe('pickClipUrl', () => {
  const videos = {
    large: { url: 'l', width: 3840, height: 2160, size: 9 },
    medium: { url: 'm', width: 1920, height: 1080, size: 5 },
    small: { url: 's', width: 1280, height: 720, size: 2 },
    tiny: { url: 't', width: 640, height: 360, size: 1 }
  }

  it('picks the smallest rendition that still meets the target width', () => {
    expect(pickClipUrl(videos, 1920)?.url).toBe('m') // medium is exactly 1920
    expect(pickClipUrl(videos, 1000)?.url).toBe('s') // small (1280) is smallest >= 1000
  })

  it('falls back to the largest when nothing meets the target', () => {
    expect(pickClipUrl(videos, 5000)?.url).toBe('l') // none >= 5000, take largest
  })

  it('returns null when there are no usable files', () => {
    expect(pickClipUrl({}, 1920)).toBeNull()
  })
})
