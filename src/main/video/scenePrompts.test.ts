import { describe, it, expect } from 'vitest'
import { extractScenePrompts } from './render'

/**
 * Regression tests for the bug where a script's rich [bracketed cinematic directions] were
 * ignored: extractCards only matched brackets 2–40 chars, so long shot descriptions fell
 * through and images were built from 5-word narration snippets. extractScenePrompts keeps
 * the FULL direction so the generated image follows the writer's shot.
 */
describe('extractScenePrompts', () => {
  const script = `[Cinematic extreme close-up of a stressed retail investor's glasses reflecting a crashing red stock market ticker. The camera pulls back rapidly.]
Agar aapke portfolio mein wo stocks hain jinhein har koi safe samajhta hai...

[Macro shot of a wooden desk covered in complex brokerage reports that dissolve into a glowing blue holographic blueprint.]
Brokerage reports mein in cheezon ko itna complex dikhaya jata hai...`

  it('returns the FULL text of each long bracketed direction, in order', () => {
    const out = extractScenePrompts(script)
    expect(out).toHaveLength(2)
    expect(out[0]).toContain('extreme close-up')
    expect(out[0]).toContain('camera pulls back rapidly')
    expect(out[0].length).toBeGreaterThan(40) // the old 40-char cap would have dropped this
    expect(out[1]).toContain('holographic blueprint')
  })

  it('ignores the narration prose between brackets', () => {
    const out = extractScenePrompts(script)
    expect(out.join(' ')).not.toContain('Agar aapke portfolio')
  })

  it('collapses exact duplicate directions but keeps order', () => {
    const dup = '[A glowing golden mineral rock floating in the center of a dark cave]\nnarration one\n[A glowing golden mineral rock floating in the center of a dark cave]\nnarration two'
    expect(extractScenePrompts(dup)).toHaveLength(1)
  })

  it('returns [] when there are no bracketed directions', () => {
    expect(extractScenePrompts('Just plain narration with no shot directions at all.')).toEqual([])
  })

  it('ignores tiny tag-like brackets (too short to be a real direction)', () => {
    expect(extractScenePrompts('[Hook]\nsome text\n[OUTRO]')).toEqual([])
  })
})
