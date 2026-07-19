import { describe, it, expect } from 'vitest'
import { extractKeyFigures, computeStatementRatios, summarizeStatement, type KeyFigure } from './pdf'

describe('extractKeyFigures', () => {
  it('pulls label + numeric periods from statement-style lines', () => {
    const text = [
      'Balance Sheet as at June 30',
      'Revenue 1,000 2,000',
      'Net Profit (500) 750',
      'This is a prose sentence that should be ignored.',
      'EPS 4.50'
    ].join('\n')
    const figs = extractKeyFigures(text)
    const byLabel = Object.fromEntries(figs.map((f) => [f.label, f.values]))
    expect(byLabel['Revenue']).toEqual([1000, 2000])
    expect(byLabel['Net Profit']).toEqual([-500, 750]) // parenthesized negative
    expect(byLabel['EPS']).toEqual([4.5])
    expect(figs.find((f) => f.label.startsWith('This is a prose'))).toBeUndefined()
  })
})

describe('computeStatementRatios', () => {
  it('computes margins/current ratio only from confidently-labelled figures', () => {
    const figures: KeyFigure[] = [
      { label: 'Revenue', values: [2000] },
      { label: 'Gross Profit', values: [800] },
      { label: 'Net Profit after tax', values: [200] },
      { label: 'Current Assets', values: [600] },
      { label: 'Current Liabilities', values: [300] }
    ]
    const out = computeStatementRatios(figures)
    expect(out.some((l) => /Net profit margin ≈ 10\.0%/.test(l))).toBe(true)
    expect(out.some((l) => /Gross margin ≈ 40\.0%/.test(l))).toBe(true)
    expect(out.some((l) => /Current ratio ≈ 2\.00/.test(l))).toBe(true)
  })
  it('omits ratios when inputs are missing (never guesses)', () => {
    expect(computeStatementRatios([{ label: 'Revenue', values: [1000] }])).toEqual([])
  })
})

describe('summarizeStatement', () => {
  it('includes detected figures, ratios, and truncates raw text', () => {
    const text = 'Revenue 1,000\nNet Profit 100\n' + 'x'.repeat(9000)
    const out = summarizeStatement(text, 500)
    expect(out).toContain('Detected figures')
    expect(out).toContain('Raw extracted text (truncated)')
    expect(out).toContain('…(truncated)…')
  })
})
