import { findColumnIndex, parseDateValue, toNumber, type ParsedSheet } from './parseFile'
import { pearsonCorrelation } from './math'
import { analyzeFlow } from './flow'

function isoDate(v: unknown): string | null {
  if (typeof v !== 'string' && typeof v !== 'number') return null
  return parseDateValue(v)?.toISOString().slice(0, 10) ?? null
}

/**
 * Cross-references institutional flow data against a price history — both
 * files the user imported themselves — to compute a real (if simple)
 * same-day-flow vs. next-day-price-change correlation and hit rate.
 */
export function correlateFlowWithPrice(flowSheet: ParsedSheet, priceSheet: ParsedSheet): string {
  const flow = analyzeFlow(flowSheet)
  if (!flow.rows.length) return flow.summary

  const priceDateIdx = findColumnIndex(priceSheet.headers, ['date'])
  const priceCloseIdx = findColumnIndex(priceSheet.headers, ['close', 'price'])
  if (priceDateIdx === -1 || priceCloseIdx === -1) {
    return 'Could not find date/close columns in the price file to correlate against.'
  }

  const priceByDate = new Map<string, number>()
  for (const row of priceSheet.rows) {
    const dateStr = isoDate(row[priceDateIdx])
    const close = toNumber(row[priceCloseIdx])
    if (dateStr && close !== null) priceByDate.set(dateStr, close)
  }

  const sortedDates = [...priceByDate.keys()].sort()
  const pairs: { flowNet: number; nextChangePct: number }[] = []
  for (const row of flow.rows) {
    const dateStr = isoDate(row.label)
    if (!dateStr) continue
    const idx = sortedDates.indexOf(dateStr)
    if (idx === -1 || idx >= sortedDates.length - 1) continue
    const todayClose = priceByDate.get(sortedDates[idx])!
    const nextClose = priceByDate.get(sortedDates[idx + 1])!
    // Guard against a 0 close in the imported file: an unguarded divide would
    // yield Infinity/NaN and poison the Pearson correlation downstream.
    if (todayClose === 0) continue
    const netFlow = (row.foreignNet ?? 0) + (row.localNet ?? 0)
    const changePct = ((nextClose - todayClose) / todayClose) * 100
    pairs.push({ flowNet: netFlow, nextChangePct: changePct })
  }

  if (pairs.length < 3) {
    return `Only found ${pairs.length} matching date(s) between the flow file and price file (need at least 3 to compute a correlation). Check that both files cover overlapping dates and use a compatible date format.`
  }

  const correlation = pearsonCorrelation(
    pairs.map((p) => p.flowNet),
    pairs.map((p) => p.nextChangePct)
  )
  const positiveFlowDays = pairs.filter((p) => p.flowNet > 0)
  const upNextAfterPositiveFlow = positiveFlowDays.filter((p) => p.nextChangePct > 0).length
  const hitRate = positiveFlowDays.length ? (upNextAfterPositiveFlow / positiveFlowDays.length) * 100 : null

  const lines: string[] = []
  lines.push(`Matched ${pairs.length} overlapping days between the flow file and price file.`)
  lines.push(
    `Correlation between same-day net institutional flow and next-day price change: ${correlation.toFixed(2)} (range -1 to +1; near 0 = weak relationship)`
  )
  if (hitRate !== null) {
    lines.push(
      `On days with net positive flow, price rose the next day ${hitRate.toFixed(0)}% of the time (${upNextAfterPositiveFlow}/${positiveFlowDays.length} such days in this file).`
    )
  }
  lines.push(
    '(A simple same-file correlation check on your imported data, not a validated trading signal — small sample sizes can be very misleading. Verify before treating as predictive.)'
  )
  return lines.join('\n')
}
