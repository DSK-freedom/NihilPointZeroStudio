/**
 * Ties every figure in a script to the file and row it came from, and writes the
 * sources list for the description.
 *
 * WHY THIS IS THE MOAT AND NOT THE PAPERWORK
 * Anyone can make a video saying reserves fell. Almost nobody in this niche shows where
 * the number came from, because it is slow, boring work — which is exactly what makes
 * it defensible. A channel whose figures are all traceable becomes the one other people
 * cite, and being cited is the compounding asset in finance content. It also makes a
 * hostile comment ("where did you get that?") into a link rather than an argument.
 *
 * HOW IT RELATES TO WHAT IS ALREADY HERE
 * `numberCheck.ts` answers "is this figure backed by data I imported?". This answers the
 * next two questions: WHICH file and row, and what does the sources list look like. It
 * deliberately builds on numberCheck's `KnownFigure` rather than re-deriving anything —
 * one matcher, not two.
 *
 * Pure. No AI: a citation invented by a language model is worse than no citation at all,
 * because it looks exactly like a real one.
 */
import { checkNumbers, type CheckedNumber, type KnownFigure } from './numberCheck'

/** A figure plus enough provenance to defend it in public. */
export interface SourcedFigure extends KnownFigure {
  /** Where it physically came from: "psx-eod-2026-07.csv". */
  file?: string
  /** Which row/line, so it can be found again in seconds. */
  row?: number
  /** Publisher, if known: "State Bank of Pakistan". */
  publisher?: string
  /** As-of date of the data itself, NOT the day it was downloaded. */
  asOf?: string
  /** Public link, when one exists. */
  url?: string
}

export interface Citation {
  /** The figure as written in the script. */
  written: string
  /** Character offset, so the UI can jump to it. */
  index: number
  /** The sentence it sits in. */
  excerpt: string
  source: SourcedFigure
  /** Exact match, or the author's own rounding. */
  exact: boolean
}

export interface SourceAudit {
  cited: Citation[]
  /** Figures with no source. These are the ones that get a channel into trouble. */
  uncited: CheckedNumber[]
  /** One line for the UI. */
  headline: string
  /** True when every figure in the script is traceable. */
  fullyTraceable: boolean
}

/**
 * Walks the script and pairs every figure with its provenance.
 *
 * Reuses `checkNumbers` for the matching so the two features can never disagree about
 * whether a figure is backed — which would be worse than either being wrong alone,
 * because the user would not know which to believe.
 */
export function auditSources(script: string, sources: SourcedFigure[]): SourceAudit {
  const checked = checkNumbers(script, sources)
  const cited: Citation[] = []
  const uncited: CheckedNumber[] = []

  for (const c of checked) {
    if (c.verdict === 'ordinary') continue
    if (c.verdict === 'unbacked' || !c.matched) {
      uncited.push(c)
      continue
    }
    cited.push({
      written: c.raw,
      index: c.index,
      excerpt: c.excerpt,
      source: c.matched as SourcedFigure,
      exact: c.verdict === 'backed'
    })
  }

  const total = cited.length + uncited.length
  const fullyTraceable = total > 0 && uncited.length === 0
  let headline: string
  if (!total) headline = 'No figures in this script to source.'
  else if (fullyTraceable) {
    headline = `Every one of the ${total} figure${total === 1 ? '' : 's'} traces to a file on this machine. Sources list is ready to paste.`
  } else {
    headline =
      `${uncited.length} of ${total} figure${total === 1 ? '' : 's'} ${uncited.length === 1 ? 'has' : 'have'} no source. ` +
      `Those are the ones a comment will ask about — pin them down before publishing.`
  }
  return { cited, uncited, headline, fullyTraceable }
}

/**
 * The sources block for a video description.
 *
 * Deduplicated by source, because a description listing the same file eight times
 * because eight figures came from it looks careless rather than rigorous — and rigour
 * is the entire point of publishing it.
 */
export function sourcesList(audit: SourceAudit, options: { heading?: string } = {}): string {
  if (!audit.cited.length) return ''
  const heading = options.heading ?? 'Sources'

  const seen = new Map<string, SourcedFigure>()
  for (const c of audit.cited) {
    const key = sourceKey(c.source)
    if (!seen.has(key)) seen.set(key, c.source)
  }

  const lines = [...seen.values()].map((s) => {
    const bits: string[] = []
    if (s.publisher) bits.push(s.publisher)
    if (s.file) bits.push(s.file)
    if (s.asOf) bits.push(`as of ${s.asOf}`)
    const label = bits.length ? bits.join(' — ') : s.label
    return s.url ? `• ${label}: ${s.url}` : `• ${label}`
  })

  return `${heading}:\n${lines.join('\n')}`
}

function sourceKey(s: SourcedFigure): string {
  return [s.publisher ?? '', s.file ?? '', s.asOf ?? '', s.url ?? '', s.label].join('|')
}

/**
 * An on-screen credit for a figure, so the provenance is visible in the video itself
 * and not only in a description nobody opens.
 *
 * Kept short deliberately: a full citation burned into the frame is unreadable at
 * phone size and covers the chart it is citing.
 */
export function screenCredit(source: SourcedFigure, maxChars = 48): string {
  const parts = [source.publisher, source.asOf].filter(Boolean)
  const text = parts.length ? parts.join(', ') : (source.file ?? source.label)
  return text.length <= maxChars ? text : `${text.slice(0, maxChars - 1).trimEnd()}…`
}

/**
 * Turns imported price data into sourced figures, carrying the file and row through.
 *
 * The row number is what makes this useful under pressure: "the reserves figure came
 * from sbp-reserves.csv" is an assertion; "row 84 of sbp-reserves.csv" is a fact
 * someone can check in ten seconds, including you, a year later.
 */
export function sourcedFromRows(
  file: string,
  rows: { date?: string; close?: number; open?: number; high?: number; low?: number; volume?: number }[],
  meta: { publisher?: string; url?: string } = {}
): SourcedFigure[] {
  const out: SourcedFigure[] = []
  rows.forEach((r, i) => {
    for (const [field, value] of [
      ['close', r.close],
      ['open', r.open],
      ['high', r.high],
      ['low', r.low],
      ['volume', r.volume]
    ] as const) {
      if (typeof value !== 'number' || !Number.isFinite(value)) continue
      out.push({
        label: `${file} ${field}${r.date ? ` ${r.date}` : ''}`,
        value,
        file,
        // +2 rather than +1: a spreadsheet has a header row, and an off-by-one here
        // sends the user to the wrong line, which is worse than no row number.
        row: i + 2,
        asOf: r.date,
        publisher: meta.publisher,
        url: meta.url
      })
    }
  })
  return out
}
