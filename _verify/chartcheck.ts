/* Verifies the price-series builder on a realistic CSV: parse → OHLC → SMA/RSI using
 * the real analysis modules, and sanity-check the numbers. */
import { mkdtempSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { parseSpreadsheetFile } from '../src/main/analysis/parseFile'
import { buildPriceSeries } from '../src/main/analysis/priceSeries'

function main(): void {
  const d = mkdtempSync(join(tmpdir(), 'chartcheck-'))
  const csv = join(d, 'prices.csv')
  // 60 daily bars, a gentle up-then-down wave.
  const rows = ['Date,Open,High,Low,Close,Volume']
  for (let i = 0; i < 60; i++) {
    const base = 100 + 20 * Math.sin(i / 8)
    const open = base
    const close = base + (i % 2 === 0 ? 1.5 : -1.2)
    const high = Math.max(open, close) + 1
    const low = Math.min(open, close) - 1
    const day = String((i % 28) + 1).padStart(2, '0')
    const mon = String(Math.floor(i / 28) + 1).padStart(2, '0')
    rows.push(`2024-${mon}-${day},${open.toFixed(2)},${high.toFixed(2)},${low.toFixed(2)},${close.toFixed(2)},${1000 + i}`)
  }
  writeFileSync(csv, rows.join('\n'), 'utf-8')

  const sheet = parseSpreadsheetFile(csv)
  const s = buildPriceSeries(sheet)
  const definedSma20 = s.sma20.filter((v) => v !== null).length
  const definedRsi = s.rsi14.filter((v) => v !== null).length
  const ok =
    s.bars.length === 60 &&
    s.sma20.length === 60 &&
    s.sma20[18] === null && s.sma20[19] !== null && // 20-period needs 20 points
    definedSma20 === 41 && // 60 - 19
    definedRsi === 46 && // 60 - 14
    !s.error
  console.log(`bars=${s.bars.length} smaDefined=${definedSma20} rsiDefined=${definedRsi} lastClose=${s.bars[59].close}`)
  console.log(`last SMA20=${s.sma20[59]?.toFixed(2)} SMA50=${s.sma50[59]?.toFixed(2)} RSI14=${s.rsi14[59]?.toFixed(1)}`)
  console.log('RESULT:', ok ? 'CHARTS DATA OK' : 'CHARTS DATA FAILED')
  process.exit(ok ? 0 : 1)
}
main()
