import { describe, expect, it } from 'vitest'
import { sceneImagePrompt } from './index'

describe('sceneImagePrompt', () => {
  it('includes the scene, the title, and a style-specific look', () => {
    const p = sceneImagePrompt('anime', 'TRADE DEFICIT', 'Pakistan Economy')
    expect(p).toContain('TRADE DEFICIT')
    expect(p).toContain('Pakistan Economy')
    expect(p.toLowerCase()).toContain('anime')
  })

  it('always steers away from on-screen text (the renderer adds titles)', () => {
    for (const style of ['cinematic', 'cartoon', 'anime', 'neon', 'minimal']) {
      expect(sceneImagePrompt(style, 'scene', 'title').toLowerCase()).toContain('no text')
    }
  })

  it('falls back to a cinematic look for an unknown style', () => {
    expect(sceneImagePrompt('unknown-style', 'scene', 'title').toLowerCase()).toContain('cinematic')
  })
})
