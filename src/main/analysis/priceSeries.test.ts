import { describe, expect, it } from 'vitest'
import { buildPriceSeries, extractBars } from './priceSeries'
import type { ParsedSheet } from './parseFile'

function sheet(headers: string[], rows: (string | number | null)[][]): ParsedSheet {
  return { headers, rows }
}

describe('extractBars', () => {
  it('reads OHLC + volume and sorts oldest→newest', () => {
    const s = sheet(
      ['Date', 'Open', 'High', 'Low', 'Close', 'Volume'],
      [
        ['2024-01-03', 12, 14, 11, 13, 1000],
        ['2024-01-01', 10, 11, 9, 10, 500],
        ['2024-01-02', 10, 13, 10, 12, 800]
      ]
    )
    const bars = extractBars(s)
    expect(bars.map((b) => b.date)).toEqual(['2024-01-01', '2024-01-02', '2024-01-03'])
    expect(bars[2]).toMatchObject({ open: 12, high: 14, low: 11, close: 13, volume: 1000 })
  })

  it('falls back to close for missing OHLC (close-only file)', () => {
    const bars = extractBars(sheet(['date', 'ltp'], [['2024-01-01', 100], ['2024-01-02', 105]]))
    expect(bars[0]).toMatchObject({ open: 100, high: 100, low: 100, close: 100 })
    expect(bars[1].close).toBe(105)
  })

  it('returns [] when there is no date or price column', () => {
    expect(extractBars(sheet(['a', 'b'], [[1, 2]]))).toEqual([])
  })
})

describe('buildPriceSeries', () => {
  it('aligns SMA/RSI overlays with the bars and uses the tested math', () => {
    const rows = Array.from({ length: 30 }, (_, i) => [`2024-02-${String(i + 1).padStart(2, '0')}`, 100 + i])
    const series = buildPriceSeries(sheet(['date', 'close'], rows))
    expect(series.bars.length).toBe(30)
    expect(series.sma20.length).toBe(30)
    expect(series.rsi14.length).toBe(30)
    // First 19 SMA20 values are null (need 20 points), the 20th is defined.
    expect(series.sma20[18]).toBeNull()
    expect(series.sma20[19]).not.toBeNull()
    // A pure uptrend → RSI should be 100 once defined.
    expect(series.rsi14[29]).toBe(100)
  })

  it('reports an error for an unreadable sheet', () => {
    expect(buildPriceSeries(sheet(['x'], [[1]])).error).toBeTruthy()
  })
})
