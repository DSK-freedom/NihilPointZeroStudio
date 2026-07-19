import { findColumnIndex, parseDateValue, toNumber, type ParsedSheet } from './parseFile'
import { rsiWilder, sma } from './math'

export function isPriceHistorySheet(sheet: ParsedSheet): boolean {
  return findColumnIndex(sheet.headers, ['close', 'price']) !== -1
}

export function analyzeTechnical(sheet: ParsedSheet): string {
  const closeIdx = findColumnIndex(sheet.headers, ['close', 'price'])
  const dateIdx = findColumnIndex(sheet.headers, ['date'])
  if (closeIdx === -1) return 'Could not find a close/price column in this file.'

  let rows = sheet.rows.filter((r) => toNumber(r[closeIdx]) !== null)
  if (dateIdx !== -1) {
    // Only keep rows with a parseable date, then sort ascending. Previously
    // undated rows fell back to epoch 0 and sorted to the FRONT, which corrupted
    // "latest vs prior" (an undated row could masquerade as the latest close).
    rows = rows
      .filter((r) => parseDateValue(r[dateIdx]) !== null)
      .sort((a, b) => parseDateValue(a[dateIdx])!.getTime() - parseDateValue(b[dateIdx])!.getTime())
  }

  const closes = rows.map((r) => toNumber(r[closeIdx])).filter((n): n is number => n !== null)
  if (closes.length < 2) return 'Not enough numeric price data in this file to analyze.'

  const latest = closes[closes.length - 1]
  const prior = closes[closes.length - 2]
  // Guard against a zero prior close (would otherwise produce Infinity/NaN).
  const changePct = prior !== 0 ? ((latest - prior) / prior) * 100 : null
  const high = Math.max(...closes)
  const low = Math.min(...closes)
  const sma20 = sma(closes, 20)
  const sma50 = sma(closes, 50)
  const sma200 = sma(closes, 200)
  const rsi14 = rsiWilder(closes, 14)

  const lines: string[] = []
  lines.push(`Imported ${closes.length} price points from your file.`)
  lines.push(
    changePct !== null
      ? `Latest close: ${latest.toFixed(2)} (${changePct >= 0 ? '+' : ''}${changePct.toFixed(2)}% vs prior period in file)`
      : `Latest close: ${latest.toFixed(2)} (prior period was 0, so % change is undefined)`
  )
  lines.push(`Range in this file: ${low.toFixed(2)} - ${high.toFixed(2)}`)
  if (sma20 !== null) lines.push(`20-period SMA: ${sma20.toFixed(2)} (price is ${latest > sma20 ? 'above' : 'below'} it)`)
  if (sma50 !== null) lines.push(`50-period SMA: ${sma50.toFixed(2)} (price is ${latest > sma50 ? 'above' : 'below'} it)`)
  if (sma200 !== null) lines.push(`200-period SMA: ${sma200.toFixed(2)} (price is ${latest > sma200 ? 'above' : 'below'} it)`)
  if (rsi14 !== null) {
    const rsiNote = rsi14 >= 70 ? 'overbought territory' : rsi14 <= 30 ? 'oversold territory' : 'neutral range'
    lines.push(`RSI(14, Wilder): ${rsi14.toFixed(1)} (${rsiNote})`)
  }
  lines.push(
    '(Mechanical calculations on your imported data using standard formulas — verify figures before citing as precise.)'
  )
  return lines.join('\n')
}
