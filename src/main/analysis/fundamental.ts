import { toNumber, type ParsedSheet } from './parseFile'
import { growthPct } from './math'

/** A comparable ordering key from a period header ("FY2024", "Q3 2026", "Dec-24", "2021"). */
function periodKey(h: string): number | null {
  const y = /(\d{4})/.exec(h)
  if (y) {
    let key = Number(y[1])
    const q = /Q\s*([1-4])/i.exec(h)
    if (q) key = key * 10 + Number(q[1])
    return key
  }
  const d = Date.parse(h)
  return Number.isNaN(d) ? null : d
}

/**
 * True when the period columns run NEWEST→oldest (common in PSX/company statement
 * exports). We detect this so growth isn't computed backwards (which would flip the
 * sign — reporting a growing company as shrinking).
 */
export function periodsAreNewestFirst(headers: string[]): boolean {
  const keys = headers.map(periodKey).filter((k): k is number => k !== null)
  if (keys.length < 2) return false
  let desc = 0
  let asc = 0
  for (let i = 1; i < keys.length; i++) {
    if (keys[i] < keys[i - 1]) desc++
    else if (keys[i] > keys[i - 1]) asc++
  }
  return desc > asc
}

/**
 * Expects a metric-rows layout: first column = line item label
 * (Revenue, Net Profit, EPS, ...), remaining columns = one value per period.
 * This is the common shape for exported financial statements.
 */
export function analyzeFundamental(sheet: ParsedSheet): string {
  const periodHeaders = sheet.headers.slice(1).filter(Boolean)
  // Financial exports are often newest-first; normalise to oldest→newest so first/last
  // (and therefore the growth sign) are correct.
  const newestFirst = periodsAreNewestFirst(periodHeaders)
  const lines: string[] = []
  lines.push(
    `Imported ${sheet.rows.length} line items across ${periodHeaders.length || 'an unlabeled set of'} periods${
      periodHeaders.length ? ` (${periodHeaders.join(', ')})` : ''
    }.`
  )

  let usableRows = 0
  for (const row of sheet.rows) {
    const label = row[0]
    if (!label) continue
    const values = row.slice(1).map(toNumber)
    let numericValues = values.filter((v): v is number => v !== null)
    if (numericValues.length < 2) continue
    // Put values oldest→newest so `first`→`last` growth reads in the right direction.
    if (newestFirst) numericValues = [...numericValues].reverse()

    usableRows++
    const first = numericValues[0]
    const last = numericValues[numericValues.length - 1]
    const overallPct = growthPct(first, last)
    const prevToLast = numericValues[numericValues.length - 2]
    const latestPct = growthPct(prevToLast, last)

    const parts = [`${label}: ${first.toLocaleString()} → ${last.toLocaleString()}`]
    if (overallPct !== null) parts.push(`${overallPct >= 0 ? '+' : ''}${overallPct.toFixed(1)}% overall`)
    if (latestPct !== null) parts.push(`${latestPct >= 0 ? '+' : ''}${latestPct.toFixed(1)}% latest period`)
    lines.push(parts.join(', '))
  }

  if (usableRows === 0) {
    return 'Could not find rows with at least two numeric period values to compute growth from. Expecting a layout like: row label in column 1, then one numeric value per period in the remaining columns.'
  }

  lines.push(
    `(Mechanical growth-rate calculations on your imported figures, read ${
      newestFirst ? 'newest-first (auto-detected)' : 'oldest-first'
    } — verify what each line item actually means before citing precisely.)`
  )
  return lines.join('\n')
}
