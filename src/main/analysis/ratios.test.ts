import { describe, it, expect } from 'vitest'
import { marginPct, eps, peRatio, roePct, currentRatio } from './ratios'

describe('ratios', () => {
  it('marginPct', () => {
    expect(marginPct(20, 200)).toBeCloseTo(10, 6)
    expect(marginPct(5, 0)).toBeNull()
  })
  it('eps', () => {
    expect(eps(1000, 250)).toBeCloseTo(4, 6)
    expect(eps(1000, 0)).toBeNull()
  })
  it('peRatio', () => {
    expect(peRatio(100, 4)).toBeCloseTo(25, 6)
    expect(peRatio(100, 0)).toBeNull()
  })
  it('roePct', () => {
    expect(roePct(150, 1000)).toBeCloseTo(15, 6)
    expect(roePct(150, 0)).toBeNull()
  })
  it('currentRatio', () => {
    expect(currentRatio(300, 150)).toBeCloseTo(2, 6)
    expect(currentRatio(300, 0)).toBeNull()
  })
})
