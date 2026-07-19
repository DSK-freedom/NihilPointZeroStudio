/**
 * Pure helpers for turning an imported file into a clean narration script.
 * Kept free of any Node/Electron import so they can be unit-tested directly.
 */

/**
 * Strips SubRip (.srt) subtitle scaffolding — the numeric sequence lines and the
 * `00:00:01,000 --> 00:00:04,000` time-ranges — leaving just the spoken text,
 * de-duplicated of blank runs. Inline tags like <i>…</i> are removed too.
 */
export function stripSrt(raw: string): string {
  const out: string[] = []
  for (const line of raw.split(/\r?\n/)) {
    const t = line.trim()
    if (!t) continue
    if (/^\d+$/.test(t)) continue // sequence index
    if (/^\d{1,2}:\d{2}:\d{2}[.,]\d{1,3}\s*-->\s*\d{1,2}:\d{2}:\d{2}[.,]\d{1,3}/.test(t)) continue // time range
    out.push(t.replace(/<[^>]+>/g, '').trim())
  }
  return out.join('\n')
}

/** Derives a human title from a filename by dropping the extension and tidying separators. */
export function deriveTitleFromFilename(fileName: string): string {
  const base = fileName.replace(/\.[^.]+$/, '')
  return base.replace(/[_-]+/g, ' ').replace(/\s+/g, ' ').trim()
}

/**
 * Normalizes extracted text for a given lower-case extension. `.srt` gets its
 * subtitle scaffolding removed; everything else is passed through with trailing
 * whitespace trimmed and blank-line runs collapsed so cards/pacing stay sane.
 */
export function normalizeScriptText(text: string, ext: string): string {
  const cleaned = ext === 'srt' ? stripSrt(text) : text
  return cleaned
    .replace(/\r\n/g, '\n')
    .replace(/[ \t]+$/gm, '')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}
