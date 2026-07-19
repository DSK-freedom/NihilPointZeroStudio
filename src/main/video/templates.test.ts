import { describe, expect, it } from 'vitest'
import { finishingChain, templateFor, titleAlphaExpr, VIDEO_TEMPLATES } from './templates'

describe('templates', () => {
  it('clean adds no finishing (fast, plain)', () => {
    expect(finishingChain(templateFor('clean'), 'v', 'o', 1920, 1080)).toBeNull()
  })
  it('cinematic grades, vignettes, grains and letterboxes', () => {
    const f = finishingChain(templateFor('cinematic'), 'v', 'o', 1920, 1080) as string
    expect(f.startsWith('[v]')).toBe(true)
    expect(f.endsWith('[o]')).toBe(true)
    expect(f).toContain('eq=contrast=1.08')
    expect(f).toContain('vignette')
    expect(f).toContain('noise=alls=8')
    expect(f).toContain('drawbox') // letterbox bars
  })
  it('news grades without vignette/grain/letterbox', () => {
    const f = finishingChain(templateFor('news'), 'v', 'o', 1920, 1080) as string
    expect(f).toContain('eq=')
    expect(f).not.toContain('vignette')
    expect(f).not.toContain('noise')
    expect(f).not.toContain('drawbox')
  })
  it('every template resolves and title fade is a valid-looking expr', () => {
    for (const t of VIDEO_TEMPLATES) expect(templateFor(t)).toBeTruthy()
    expect(titleAlphaExpr(0.8)).toContain('t/0.8')
  })
})
