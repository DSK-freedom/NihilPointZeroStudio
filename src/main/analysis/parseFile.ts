import * as XLSX from 'xlsx'

export interface ParsedSheet {
  headers: string[]
  rows: (string | number | null)[][]
}

/** Reads a user-selected local CSV/Excel file — never fetched from the network. */
export function parseSpreadsheetFile(filePath: string): ParsedSheet {
  const workbook = XLSX.readFile(filePath)
  const sheetName = workbook.SheetNames[0]
  const sheet = workbook.Sheets[sheetName]
  const raw = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: null }) as (string | number | null)[][]
  const [headerRow, ...dataRows] = raw
  const headers = (headerRow ?? []).map((h) => (h === null ? '' : String(h)))
  return { headers, rows: dataRows }
}

/**
 * Excel stores dates as serial day-counts from 1899-12-30 when a cell isn't read
 * with cellDates — a plain `new Date(String(cell))` silently fails on those. This
 * handles both that numeric form and normal date strings (as CSV always has).
 */
export function parseDateValue(v: string | number | null): Date | null {
  if (v === null) return null
  if (typeof v === 'number') {
    const excelEpochMs = Date.UTC(1899, 11, 30)
    const d = new Date(excelEpochMs + v * 86400000)
    return Number.isFinite(d.getTime()) ? d : null
  }
  const d = new Date(v)
  return Number.isFinite(d.getTime()) ? d : null
}

/**
 * Coerces a spreadsheet cell to a finite number, or null. Handles thousands
 * separators (`1,234`) and accounting-style parenthesized negatives (`(1,234)`
 * → `-1234`). This is the single shared implementation — every analysis module
 * imports it so number parsing is identical everywhere (previously each module
 * kept its own copy and they disagreed on parenthesized negatives).
 */
export function toNumber(v: string | number | null): number | null {
  if (typeof v === 'number') return Number.isFinite(v) ? v : null
  if (typeof v === 'string') {
    const cleaned = v.replace(/,/g, '').trim()
    if (cleaned === '') return null
    const negParen = /^\((.*)\)$/.exec(cleaned)
    const n = Number(negParen ? `-${negParen[1]}` : cleaned)
    return Number.isFinite(n) ? n : null
  }
  return null
}

/**
 * Finds the first header column whose (lowercased, trimmed) name contains any of
 * the candidate substrings, in candidate priority order. -1 if none match.
 */
export function findColumnIndex(headers: string[], candidates: string[]): number {
  const normalized = headers.map((h) => h.toLowerCase().trim())
  for (const c of candidates) {
    const idx = normalized.findIndex((h) => h.includes(c))
    if (idx !== -1) return idx
  }
  return -1
}
