import { existsSync, readFileSync, rmSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import * as XLSX from 'xlsx'
import { describe, expect, it } from 'vitest'
import { analyzePsxBars, buildPsxWorkbook, normalizeSymbol, parsePsxEod, summarizePsxAnalysis, type PsxBar } from './psxLive'

const DAY = 86400
function bars(closes: number[], vols?: number[]): PsxBar[] {
  // oldest→newest, one day apart, starting at a fixed epoch (no Date.now — deterministic)
  const start = 1_600_000_000
  return closes.map((c, i) => ({
    ts: start + i * DAY,
    date: new Date((start + i * DAY) * 1000).toISOString().slice(0, 10),
    close: c,
    volume: vols ? vols[i] : 1000
  }))
}

describe('normalizeSymbol', () => {
  it('uppercases and strips junk', () => {
    expect(normalizeSymbol(' luck ')).toBe('LUCK')
    expect(normalizeSymbol('hub-c!')).toBe('HUBC')
  })
})

describe('parsePsxEod', () => {
  it('parses the portal payload newest-first into ascending bars with close+volume', () => {
    const json = { status: 1, message: '', data: [[1784286000, 445.63, 1489663, 453], [1784199600, 451.2, 1390663, 444.5]] }
    const out = parsePsxEod(json, 'LUCK')
    expect(out.length).toBe(2)
    expect(out[0].ts).toBeLessThan(out[1].ts) // sorted ascending
    expect(out[1].close).toBe(445.63) // newest last
    expect(out[1].volume).toBe(1489663)
  })
  it('drops malformed rows and throws on empty/failed payloads', () => {
    const json = { status: 1, message: '', data: [[1, 100, 5], ['bad'], [2, -3, 9], [3, 101, 7]] }
    const out = parsePsxEod(json, 'X')
    expect(out.map((b) => b.close)).toEqual([100, 101]) // negative + non-array dropped
    expect(() => parsePsxEod({ status: 0, data: [] }, 'X')).toThrow()
  })
})

describe('analyzePsxBars', () => {
  it('computes change, range, SMAs and RSI from real closes', () => {
    // steadily rising series → price above all SMAs, RSI high, uptrend
    const closes = Array.from({ length: 250 }, (_, i) => 100 + i)
    const a = analyzePsxBars('TEST', bars(closes))
    expect(a.latest).toBe(349)
    expect(a.changePct).toBeCloseTo((349 - 348) / 348 * 100, 5)
    expect(a.high52w).toBe(349)
    expect(a.sma20).not.toBeNull()
    expect(a.latest).toBeGreaterThan(a.sma50!)
    expect(a.sma50!).toBeGreaterThan(a.sma200!)
    expect(a.rsi14).toBe(100) // no losses in a monotonic rise
    expect(a.trend).toContain('uptrend')
  })
  it('flags a downtrend when price is below falling SMAs', () => {
    const closes = Array.from({ length: 250 }, (_, i) => 400 - i)
    const a = analyzePsxBars('TEST', bars(closes))
    expect(a.trend).toContain('downtrend')
    expect(a.rsi14).toBe(0)
  })
  it('summary is human-readable and cites the symbol + latest', () => {
    const a = analyzePsxBars('LUCK', bars(Array.from({ length: 60 }, (_, i) => 100 + i)))
    const s = summarizePsxAnalysis(a)
    expect(s).toContain('LUCK')
    expect(s).toContain('Latest close')
    expect(s).toContain('RSI(14')
  })
})

describe('buildPsxWorkbook', () => {
  it('writes a real .xlsx with Summary + Prices sheets that read back correctly', () => {
    const b = bars(Array.from({ length: 30 }, (_, i) => 100 + i), Array.from({ length: 30 }, () => 5000))
    const a = analyzePsxBars('LUCK', b)
    const out = join(tmpdir(), `psx-test-${b[0].ts}.xlsx`)
    try {
      buildPsxWorkbook(b, a, out)
      expect(existsSync(out)).toBe(true)
      const wb = XLSX.read(readFileSync(out), { type: 'buffer' })
      expect(wb.SheetNames).toContain('Summary')
      expect(wb.SheetNames).toContain('Prices')
      const prices = XLSX.utils.sheet_to_json(wb.Sheets['Prices'], { header: 1 }) as unknown[][]
      expect(prices[0]).toContain('Close (PKR)') // header row
      expect(prices.length).toBe(b.length + 1) // one row per bar + header
    } finally {
      if (existsSync(out)) rmSync(out, { force: true })
    }
  })
})
