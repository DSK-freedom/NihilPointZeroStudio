/**
 * Turns a parsed price spreadsheet (PSX/CSV/Excel) into an OHLC series with SMA and
 * RSI overlays — using the SAME unit-tested math (sma, rsiWilder) as the rest of the
 * analysis engine, so the charts are mathematically accurate to the number. Pure
 * (no Electron), so it can be unit-tested against a known series.
 */
import type { ParsedSheet } from './parseFile'
import { findColumnIndex, parseDateValue, toNumber } from './parseFile'
import { sma, rsiWilder } from './math'
import type { PriceBar, PriceSeries } from '../../shared/types'

/**
 * Extracts OHLC bars from a sheet. Requires a date column and a close/last/price
 * column; open/high/low fall back to close when absent (so a close-only file still
 * charts as a line). Rows are sorted oldest → newest.
 */
export function extractBars(sheet: ParsedSheet): PriceBar[] {
  const h = sheet.headers
  const di = findColumnIndex(h, ['date', 'time'])
  const ci = findColumnIndex(h, ['close', 'last', 'ltp', 'price', 'rate'])
  const oi = findColumnIndex(h, ['open'])
  const hi = findColumnIndex(h, ['high'])
  const li = findColumnIndex(h, ['low'])
  const vi = findColumnIndex(h, ['volume', 'vol', 'turnover'])
  if (di === -1 || ci === -1) return []

  const bars: PriceBar[] = []
  for (const row of sheet.rows) {
    const date = parseDateValue(row[di] ?? null)
    const close = toNumber(row[ci] ?? null)
    if (!date || close === null) continue
    const open = oi === -1 ? close : toNumber(row[oi] ?? null) ?? close
    const high = hi === -1 ? Math.max(open, close) : toNumber(row[hi] ?? null) ?? Math.max(open, close)
    const low = li === -1 ? Math.min(open, close) : toNumber(row[li] ?? null) ?? Math.min(open, close)
    const volume = vi === -1 ? null : toNumber(row[vi] ?? null)
    bars.push({ date: date.toISOString().slice(0, 10), open, high, low, close, volume })
  }
  bars.sort((a, b) => a.date.localeCompare(b.date))
  return bars
}

/** Rolling series of an indicator computed with the tested pure functions. */
function rollingSma(closes: number[], period: number): (number | null)[] {
  return closes.map((_, i) => sma(closes.slice(0, i + 1), period))
}
function rollingRsi(closes: number[], period: number): (number | null)[] {
  return closes.map((_, i) => rsiWilder(closes.slice(0, i + 1), period))
}

/**
 * Builds a price series directly from close+volume bars (e.g. live PSX EOD, which has no
 * per-day OHLC). Open/High/Low are set to the close so it renders as a line, and SMA/RSI
 * use the same tested math. Bars must already be oldest→newest.
 */
export function buildPriceSeriesFromBars(
  bars: { date: string; close: number; volume: number | null }[]
): PriceSeries {
  if (!bars.length) return { bars: [], sma20: [], sma50: [], rsi14: [], error: 'No price data to chart.' }
  const ohlc: PriceBar[] = bars.map((b) => ({
    date: b.date,
    open: b.close,
    high: b.close,
    low: b.close,
    close: b.close,
    volume: b.volume
  }))
  const closes = ohlc.map((b) => b.close)
  return {
    bars: ohlc,
    sma20: rollingSma(closes, 20),
    sma50: rollingSma(closes, 50),
    rsi14: rollingRsi(closes, 14)
  }
}

/** Builds the full price series (bars + SMA20 + SMA50 + RSI14) from a parsed sheet. */
export function buildPriceSeries(sheet: ParsedSheet): PriceSeries {
  const bars = extractBars(sheet)
  if (bars.length === 0) {
    return { bars: [], sma20: [], sma50: [], rsi14: [], error: 'No date + price columns found in that file.' }
  }
  const closes = bars.map((b) => b.close)
  return {
    bars,
    sma20: rollingSma(closes, 20),
    sma50: rollingSma(closes, 50),
    rsi14: rollingRsi(closes, 14)
  }
}
