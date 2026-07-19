import { describe, it, expect } from 'vitest'
import { sma, rsiWilder, pearsonCorrelation, growthPct } from './math'

describe('sma', () => {
  it('averages the last `period` values', () => {
    expect(sma([1, 2, 3, 4, 5], 5)).toBe(3)
    expect(sma([2, 4, 6, 8], 3)).toBe(6) // (4+6+8)/3
  })
  it('returns null when there are fewer than `period` values', () => {
    expect(sma([1, 2], 5)).toBeNull()
    expect(sma([1, 2, 3], 0)).toBeNull()
  })
})

describe('rsiWilder', () => {
  it('returns null below the minimum window (period + 1)', () => {
    expect(rsiWilder(Array(14).fill(1), 14)).toBeNull()
  })
  it('is 100 for a strictly rising series (no losses)', () => {
    const rising = Array.from({ length: 20 }, (_, i) => i + 1)
    expect(rsiWilder(rising, 14)).toBe(100)
  })
  it('is 0 for a strictly falling series (no gains)', () => {
    const falling = Array.from({ length: 20 }, (_, i) => 100 - i)
    expect(rsiWilder(falling, 14)).toBe(0)
  })
  it('is 50 (neutral) for a perfectly flat series, not 100', () => {
    // A flat window is genuinely 0/0 — conventionally neutral, never overbought.
    expect(rsiWilder(Array(15).fill(42), 14)).toBe(50)
  })
  it('is exactly 50 for the seed window when gains and losses are equal', () => {
    // Exactly period+1 (15) points, alternating +1 / -1 → seed avgGain === avgLoss
    // → RS = 1 → RSI = 50, with no smoothing steps yet.
    const alt = Array.from({ length: 15 }, (_, i) => (i % 2 === 0 ? 10 : 11))
    expect(rsiWilder(alt, 14)).toBeCloseTo(50, 6)
  })
  it('leans above 50 when recent moves are net positive', () => {
    // 14 flat-ish diffs seeded then several strong up moves → RSI clearly > 50, < 100.
    const closes = [...Array.from({ length: 15 }, (_, i) => (i % 2 === 0 ? 10 : 11)), 14, 18, 23]
    const r = rsiWilder(closes, 14)!
    expect(r).toBeGreaterThan(50)
    expect(r).toBeLessThan(100)
  })
  it('matches the canonical external reference (StockCharts Wilder RSI-14 example)', () => {
    // The industry-standard worked example (StockCharts / Wilder). The first RSI value
    // for this exact close series is documented as 70.53 — hand-verifiable, an
    // independent check that our formula is correct, not just internally consistent.
    const closes = [
      44.3389, 44.0902, 44.1497, 43.6124, 44.3278, 44.8264, 45.0955, 45.4245, 45.8433,
      46.0826, 45.8931, 46.0328, 45.614, 46.282, 46.282
    ]
    expect(rsiWilder(closes, 14)).toBeCloseTo(70.53, 1)
  })
})

describe('pearsonCorrelation', () => {
  it('is +1 for perfectly positively related series', () => {
    expect(pearsonCorrelation([1, 2, 3], [2, 4, 6])).toBeCloseTo(1, 6)
  })
  it('is -1 for perfectly inversely related series', () => {
    expect(pearsonCorrelation([1, 2, 3], [6, 4, 2])).toBeCloseTo(-1, 6)
  })
  it('is 0 when a series has zero variance or too few points', () => {
    expect(pearsonCorrelation([1, 1, 1], [1, 2, 3])).toBe(0)
    expect(pearsonCorrelation([1], [1])).toBe(0)
  })
})

describe('growthPct', () => {
  it('computes percent change using |from| as the denominator', () => {
    expect(growthPct(100, 150)).toBeCloseTo(50, 6)
    expect(growthPct(-100, -50)).toBeCloseTo(50, 6) // loss shrank → positive
    expect(growthPct(-100, -200)).toBeCloseTo(-100, 6) // loss doubled → negative
  })
  it('returns null when the base is zero', () => {
    expect(growthPct(0, 500)).toBeNull()
  })
})
