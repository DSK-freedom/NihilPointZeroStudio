import { LLMRequestError } from './types'

function snippet(text: string): string {
  const clean = text.trim().replace(/\s+/g, ' ')
  return clean.length > 200 ? `${clean.slice(0, 200)}…` : clean
}

export function extractJson<T>(text: string): T {
  const trimmed = text.trim()
  const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i)
  const candidate = fenced ? fenced[1] : trimmed
  const start = candidate.search(/[[{]/)
  // Close with the bracket that MATCHES the opening char, so trailing prose that
  // happens to contain the other bracket type can't over-extend the slice.
  const end =
    start >= 0 && candidate[start] === '['
      ? candidate.lastIndexOf(']')
      : candidate.lastIndexOf('}')
  const sliced = start >= 0 && end >= start ? candidate.slice(start, end + 1) : candidate
  try {
    return JSON.parse(sliced) as T
  } catch {
    // Some smaller local models leave a trailing comma before a closing bracket — try once more after stripping it.
    try {
      return JSON.parse(sliced.replace(/,(\s*[\]}])/g, '$1')) as T
    } catch {
      throw new LLMRequestError(`Model response was not valid JSON. Response started with: "${snippet(text)}"`)
    }
  }
}

export function parseScriptResponse(text: string): { title: string; body: string } {
  const marker = '===SCRIPT==='
  const idx = text.indexOf(marker)
  if (idx === -1) {
    throw new LLMRequestError(
      `Model response was missing the "${marker}" section. Response started with: "${snippet(text)}"`
    )
  }
  const titleMatch = text.slice(0, idx).match(/TITLE:\s*(.+)/i)
  const title = titleMatch ? titleMatch[1].trim() : ''
  const body = text.slice(idx + marker.length).trim()
  if (!title || !body) {
    throw new LLMRequestError('Model response was missing a title or a script body.')
  }
  return { title, body }
}
