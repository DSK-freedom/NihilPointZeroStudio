import { toNumber } from './parseFile'
import { marginPct, currentRatio } from './ratios'

export interface KeyFigure {
  label: string
  values: number[]
}

/**
 * Extracts the full plain text of a PDF (all pages) — used on PSX statement PDFs
 * the user downloaded. pdf-parse (and its heavy pdfjs runtime) is imported lazily
 * so the pure text/figure helpers below stay importable without loading it.
 */
export async function extractPdfText(buffer: Buffer): Promise<string> {
  const { PDFParse } = await import('pdf-parse')
  const parser = new PDFParse({ data: new Uint8Array(buffer) })
  try {
    const res = await parser.getText()
    return res.text
  } finally {
    await parser.destroy()
  }
}

/**
 * Heuristically pulls "label followed by one or more numbers" rows out of
 * statement text (e.g. "Revenue 1,234 5,678"). Deliberately conservative: it
 * only accepts a leading textual label followed by numeric tokens, so prose
 * paragraphs are ignored. These are extracted mechanically and must be verified.
 */
export function extractKeyFigures(text: string): KeyFigure[] {
  const out: KeyFigure[] = []
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.replace(/\t/g, ' ').trim()
    if (!line) continue
    const m = /^([A-Za-z][A-Za-z0-9 .,&()/'-]{2,60}?)[\s:]+((?:\(?-?[\d,]+(?:\.\d+)?\)?\s*){1,8})$/.exec(line)
    if (!m) continue
    const label = m[1].trim().replace(/[.:]+$/, '')
    const tokens = m[2].match(/\(?-?[\d,]+(?:\.\d+)?\)?/g) ?? []
    const values = tokens.map((t) => toNumber(t)).filter((n): n is number => n !== null)
    if (values.length) out.push({ label, values })
  }
  return out
}

/** Latest (last-period) value for the first figure whose label contains any of `names`. */
function latest(figures: KeyFigure[], names: string[]): number | null {
  for (const f of figures) {
    const l = f.label.toLowerCase()
    if (names.some((n) => l.includes(n)) && f.values.length) return f.values[f.values.length - 1]
  }
  return null
}

/**
 * Best-effort ratios computed ONLY from confidently-labelled figures. Any ratio
 * whose inputs aren't both found is simply omitted — it never emits a guessed or
 * wrong number. Uses the tested helpers in ratios.ts.
 */
export function computeStatementRatios(figures: KeyFigure[]): string[] {
  const revenue = latest(figures, ['revenue', 'net sales', 'turnover', 'total income'])
  const netProfit = latest(figures, ['net profit', 'profit after tax', 'profit for the', 'net income'])
  const grossProfit = latest(figures, ['gross profit'])
  const curAssets = latest(figures, ['current assets'])
  const curLiab = latest(figures, ['current liabilities'])

  const out: string[] = []
  if (netProfit !== null && revenue !== null) {
    const m = marginPct(netProfit, revenue)
    if (m !== null) out.push(`Net profit margin ≈ ${m.toFixed(1)}% (net profit / revenue)`)
  }
  if (grossProfit !== null && revenue !== null) {
    const m = marginPct(grossProfit, revenue)
    if (m !== null) out.push(`Gross margin ≈ ${m.toFixed(1)}% (gross profit / revenue)`)
  }
  if (curAssets !== null && curLiab !== null) {
    const c = currentRatio(curAssets, curLiab)
    if (c !== null) out.push(`Current ratio ≈ ${c.toFixed(2)} (current assets / current liabilities)`)
  }
  return out
}

/**
 * Builds a compact, clearly-caveated summary of a downloaded statement PDF for
 * feeding into the Writer's verified-data box: detected figures, any ratios we
 * could safely compute, and a truncated slice of the raw text.
 */
export function summarizeStatement(text: string, maxChars = 6000): string {
  const figures = extractKeyFigures(text)
  const lines: string[] = []

  if (figures.length) {
    lines.push('Detected figures (extracted mechanically — VERIFY against the original document before citing):')
    for (const f of figures.slice(0, 40)) {
      lines.push(`- ${f.label}: ${f.values.map((v) => v.toLocaleString()).join(' | ')}`)
    }
    lines.push('')
  }

  const ratios = computeStatementRatios(figures)
  if (ratios.length) {
    lines.push('Ratios computed from the detected figures (verify inputs first):')
    for (const r of ratios) lines.push(`- ${r}`)
    lines.push('')
  }

  const trimmed = text.trim().replace(/\n{3,}/g, '\n\n')
  lines.push('Raw extracted text (truncated):')
  lines.push(trimmed.length > maxChars ? `${trimmed.slice(0, maxChars)}\n…(truncated)…` : trimmed)
  return lines.join('\n')
}
