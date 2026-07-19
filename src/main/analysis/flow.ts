import { findColumnIndex, toNumber, type ParsedSheet } from './parseFile'

export function isFlowSheet(sheet: ParsedSheet): boolean {
  const normalized = sheet.headers.map((h) => h.toLowerCase())
  const hasForeign = normalized.some((h) => h.includes('foreign') || h.includes('fipi'))
  const hasLocal = normalized.some((h) => h.includes('local') || h.includes('lipi'))
  const hasFlowWord = normalized.some((h) => h.includes('net') || h.includes('buy') || h.includes('sell'))
  return (hasForeign || hasLocal) && hasFlowWord
}

export interface FlowRow {
  label: string
  foreignNet: number | null
  localNet: number | null
}

export interface FlowAnalysisResult {
  summary: string
  rows: FlowRow[]
}

/** Parses NCCPL-style FIPI/LIPI institutional flow reports the user has downloaded themselves. */
export function analyzeFlow(sheet: ParsedSheet): FlowAnalysisResult {
  const dateIdx = findColumnIndex(sheet.headers, ['date'])
  const foreignNetIdx = findColumnIndex(sheet.headers, ['foreign net', 'net foreign', 'fipi net'])
  const localNetIdx = findColumnIndex(sheet.headers, ['local net', 'net local', 'lipi net'])
  const foreignBuyIdx = findColumnIndex(sheet.headers, ['foreign buy'])
  const foreignSellIdx = findColumnIndex(sheet.headers, ['foreign sell'])
  const localBuyIdx = findColumnIndex(sheet.headers, ['local buy'])
  const localSellIdx = findColumnIndex(sheet.headers, ['local sell'])

  const rows: FlowRow[] = []
  for (const row of sheet.rows) {
    const label = dateIdx !== -1 ? String(row[dateIdx] ?? '') : String(row[0] ?? '')
    if (!label) continue

    let foreignNet = foreignNetIdx !== -1 ? toNumber(row[foreignNetIdx]) : null
    if (foreignNet === null && foreignBuyIdx !== -1 && foreignSellIdx !== -1) {
      const buy = toNumber(row[foreignBuyIdx])
      const sell = toNumber(row[foreignSellIdx])
      if (buy !== null && sell !== null) foreignNet = buy - sell
    }

    let localNet = localNetIdx !== -1 ? toNumber(row[localNetIdx]) : null
    if (localNet === null && localBuyIdx !== -1 && localSellIdx !== -1) {
      const buy = toNumber(row[localBuyIdx])
      const sell = toNumber(row[localSellIdx])
      if (buy !== null && sell !== null) localNet = buy - sell
    }

    if (foreignNet !== null || localNet !== null) {
      rows.push({ label, foreignNet, localNet })
    }
  }

  if (!rows.length) {
    return {
      rows: [],
      summary:
        'Could not identify foreign/local net flow columns. Expecting columns like "Foreign Net"/"Local Net", or "Foreign Buy" + "Foreign Sell" pairs.'
    }
  }

  const totalForeign = rows.reduce((sum, r) => sum + (r.foreignNet ?? 0), 0)
  const totalLocal = rows.reduce((sum, r) => sum + (r.localNet ?? 0), 0)
  const latest = rows[rows.length - 1]

  const lines: string[] = []
  lines.push(`Imported ${rows.length} periods of institutional flow data.`)
  lines.push(`Cumulative net foreign flow over this file: ${totalForeign.toLocaleString()}`)
  lines.push(`Cumulative net local flow over this file: ${totalLocal.toLocaleString()}`)
  lines.push(
    `Latest period (${latest.label}): foreign net ${latest.foreignNet?.toLocaleString() ?? 'n/a'}, local net ${latest.localNet?.toLocaleString() ?? 'n/a'}`
  )
  // "Overall" reflects combined institutional flow (foreign + local), not foreign
  // alone — otherwise the headline could contradict a large opposite local flow.
  const overallNet = totalForeign + totalLocal
  const direction =
    overallNet > 0 ? 'net institutional buying' : overallNet < 0 ? 'net institutional selling' : 'flat net flow'
  lines.push(`Overall trend in this file (foreign + local combined): ${direction}.`)
  lines.push(
    '(Computed directly from your imported figures — verify column meanings against the original NCCPL report.)'
  )

  return { rows, summary: lines.join('\n') }
}
