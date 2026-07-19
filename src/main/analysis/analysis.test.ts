import { describe, it, expect } from 'vitest'
import type { ParsedSheet } from './parseFile'
import { analyzeTechnical } from './technical'
import { analyzeFundamental } from './fundamental'
import { analyzeFlow } from './flow'
import { correlateFlowWithPrice } from './backtest'

describe('analyzeTechnical', () => {
  it('sorts by date and ignores undated rows (no phantom "latest")', () => {
    const sheet: ParsedSheet = {
      headers: ['Date', 'Close'],
      rows: [
        ['2024-01-01', 100],
        ['2024-01-03', 120],
        ['2024-01-02', 110],
        [null, 999] // undated — must be dropped, not treated as the latest close
      ]
    }
    const out = analyzeTechnical(sheet)
    expect(out).toContain('Latest close: 120.00')
    expect(out).toContain('+9.09%') // (120-110)/110
    expect(out).not.toContain('999')
  })

  it('does not divide by zero when the prior close is 0', () => {
    const sheet: ParsedSheet = { headers: ['Close'], rows: [[0], [50]] }
    const out = analyzeTechnical(sheet)
    expect(out).not.toMatch(/Infinity|NaN/)
    expect(out).toContain('undefined')
  })
})

describe('analyzeFundamental', () => {
  it('handles a negative base (a shrinking loss reads as positive growth)', () => {
    const sheet: ParsedSheet = { headers: ['Item', 'P1', 'P2'], rows: [['Net Profit', -100, -50]] }
    expect(analyzeFundamental(sheet)).toContain('+50.0% overall')
  })
  it('skips blank/non-numeric periods when computing growth', () => {
    const sheet: ParsedSheet = { headers: ['Item', 'P1', 'P2', 'P3'], rows: [['Revenue', 200, null, 400]] }
    expect(analyzeFundamental(sheet)).toContain('+100.0% overall')
  })
})

describe('analyzeFlow', () => {
  it('derives net = buy - sell and reports combined direction', () => {
    const sheet: ParsedSheet = {
      headers: ['Date', 'Foreign Buy', 'Foreign Sell', 'Local Net'],
      rows: [['2024-01-01', 300, 100, -50]]
    }
    const res = analyzeFlow(sheet)
    expect(res.rows[0].foreignNet).toBe(200)
    expect(res.rows[0].localNet).toBe(-50)
    // combined 200 + (-50) = 150 > 0 → buying
    expect(res.summary).toContain('net institutional buying')
  })
})

describe('correlateFlowWithPrice', () => {
  it('computes a positive correlation and hit rate for flow that leads price up', () => {
    const flow: ParsedSheet = {
      headers: ['Date', 'Foreign Net'],
      rows: [
        ['2024-01-01', 100],
        ['2024-01-02', 200],
        ['2024-01-03', 300]
      ]
    }
    const price: ParsedSheet = {
      headers: ['Date', 'Close'],
      rows: [
        ['2024-01-01', 100],
        ['2024-01-02', 101], // +1% after flow 100
        ['2024-01-03', 103.02], // +2% after flow 200
        ['2024-01-04', 106.11] // +3% after flow 300
      ]
    }
    const out = correlateFlowWithPrice(flow, price)
    const corr = Number(/change: (-?\d+\.\d+)/.exec(out)?.[1])
    expect(corr).toBeGreaterThan(0.9)
    expect(out).toContain('rose the next day 100%')
  })
})
