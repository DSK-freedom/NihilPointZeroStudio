/**
 * Fetches exactly one document from a PSX-owned domain, at the user's explicit
 * direction — mirroring PSX's own Terms of Use, which permits downloading "a
 * single, unaltered, permanent copy... for personal, non-commercial use only."
 *
 * This is intentionally NOT a crawler: it makes exactly one request to exactly
 * the URL the user provides, never follows links, never paginates, never runs
 * on a schedule. It only ever touches *.psx.com.pk — NCCPL is excluded (their
 * robots.txt explicitly blocks AI/Claude crawlers, a separate and independent
 * restriction this exception does not address).
 */

const ALLOWED_HOST_SUFFIX = '.psx.com.pk'
const ALLOWED_EXACT_HOST = 'psx.com.pk'

export class PsxFetchError extends Error {}

function isAllowedPsxUrl(rawUrl: string): boolean {
  try {
    const url = new URL(rawUrl)
    if (url.protocol !== 'https:') return false
    const host = url.hostname.toLowerCase()
    return host === ALLOWED_EXACT_HOST || host.endsWith(ALLOWED_HOST_SUFFIX)
  } catch {
    return false
  }
}

function guessFileName(rawUrl: string, contentDisposition: string | null): string {
  if (contentDisposition) {
    const match = /filename\*?=(?:UTF-8'')?"?([^";]+)"?/i.exec(contentDisposition)
    if (match?.[1]) return decodeURIComponent(match[1])
  }
  const url = new URL(rawUrl)
  const last = url.pathname.split('/').filter(Boolean).pop()
  return last && last.includes('.') ? last : `psx-document-${Date.now()}.pdf`
}

export async function fetchPsxDocument(rawUrl: string): Promise<{ buffer: Buffer; fileName: string }> {
  if (!isAllowedPsxUrl(rawUrl)) {
    throw new PsxFetchError('That URL is not on a psx.com.pk domain. This tool only fetches documents you link to directly from PSX itself.')
  }
  let res: Response
  try {
    res = await fetch(rawUrl, { signal: AbortSignal.timeout(30_000) })
  } catch (err) {
    throw new PsxFetchError(err instanceof Error ? `Could not reach that URL: ${err.message}` : 'Could not reach that URL')
  }
  if (!res.ok) {
    throw new PsxFetchError(`PSX returned an error (${res.status}) for that URL.`)
  }
  const arrayBuffer = await res.arrayBuffer()
  const fileName = guessFileName(rawUrl, res.headers.get('content-disposition'))
  return { buffer: Buffer.from(arrayBuffer), fileName }
}
