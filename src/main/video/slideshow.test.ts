import { describe, expect, it } from 'vitest'
import { KEN_BURNS_MOTIONS, planSlideshowShots, zoompanExpr } from './render'

describe('planSlideshowShots', () => {
  it('turns few images over a long video into many varied shots (no 3-image ping-pong)', () => {
    const shots = planSlideshowShots(3, 30)
    expect(shots).toHaveLength(5) // ~one shot per 6s
    expect(shots.map((s) => s.imageIndex)).toEqual([0, 1, 2, 0, 1]) // round-robin
    // Consecutive shots use different camera moves.
    for (let i = 1; i < shots.length; i++) {
      expect(shots[i].motion).not.toBe(shots[i - 1].motion)
    }
  })

  it('never uses fewer shots than images', () => {
    const shots = planSlideshowShots(3, 6)
    expect(shots.length).toBeGreaterThanOrEqual(3)
  })

  it('gives a single image multiple moving shots', () => {
    const shots = planSlideshowShots(1, 30)
    expect(shots.length).toBeGreaterThan(1)
    expect(shots.every((s) => s.imageIndex === 0)).toBe(true)
    expect(new Set(shots.map((s) => s.motion)).size).toBeGreaterThan(1)
  })

  it('caps the shot count so the filtergraph stays sane', () => {
    expect(planSlideshowShots(2, 600)).toHaveLength(12)
  })

  it('is safe for zero/degenerate inputs', () => {
    expect(planSlideshowShots(0, 0).length).toBeGreaterThanOrEqual(1)
  })
})

describe('zoompanExpr', () => {
  it('builds a valid-looking zoompan for each motion with size + fps', () => {
    for (const m of KEN_BURNS_MOTIONS) {
      const expr = zoompanExpr(m, 150, 1920, 1080)
      expect(expr.startsWith('zoompan=')).toBe(true)
      expect(expr).toContain('s=1920x1080')
      expect(expr).toContain('d=150')
      expect(expr).toContain('fps=25')
    }
  })

  it('zoom-in ramps up and zoom-out ramps down', () => {
    expect(zoompanExpr('zoom-in', 150, 1920, 1080)).toContain('min(1.0+0.0015*on,1.5)')
    expect(zoompanExpr('zoom-out', 150, 1920, 1080)).toContain('pzoom-0.0015')
  })

  it('pans move horizontally in opposite directions', () => {
    expect(zoompanExpr('pan-right', 150, 1920, 1080)).toContain(`min(on/150,1)`)
    expect(zoompanExpr('pan-left', 150, 1920, 1080)).toContain(`(1-min(on/150,1))`)
  })
})
