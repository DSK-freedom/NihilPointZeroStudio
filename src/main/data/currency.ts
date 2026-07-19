/**
 * Free, no-key, no-rate-limit live exchange rates (fawazahmed0/currency-api,
 * CDN-hosted, ECB/central-bank sourced). Genuinely free forever — this is a
 * public static dataset refreshed daily, not a metered service. Gold, silver,
 * and Bitcoin ride the exact same payload (no extra network calls).
 */
const PRIMARY_URL = (date: string): string =>
  `https://cdn.jsdelivr.net/npm/@fawazahmed0/currency-api@${date}/v1/currencies/usd.json`
const FALLBACK_URL = (date: string): string => `https://${date}.currency-api.pages.dev/v1/currencies/usd.json`

const GRAMS_PER_TROY_OZ = 31.1034768
const GRAMS_PER_TOLA = 11.6638038

/**
 * Converts a gold price to PKR per tola (24k). `usdXau` is the currency-api
 * convention "troy ounces of gold per 1 USD" (so USD/oz = 1/usdXau); `usdPkr`
 * is PKR per USD. Exported for unit testing the conversion in isolation.
 */
export function goldPkrPerTola(usdXau: number, usdPkr: number): number {
  const ozUsd = 1 / usdXau
  return (ozUsd * usdPkr * GRAMS_PER_TOLA) / GRAMS_PER_TROY_OZ
}

export async function getMarketSnapshotNote(): Promise<string | null> {
  for (const urlFn of [PRIMARY_URL, FALLBACK_URL]) {
    try {
      const res = await fetch(urlFn('latest'), { signal: AbortSignal.timeout(15_000) })
      if (!res.ok) continue
      const data = await res.json()
      const usd = data?.usd
      const pkr = typeof usd?.pkr === 'number' ? usd.pkr : null
      if (pkr === null) continue

      const lines = [`1 USD = ${pkr.toFixed(2)} PKR (live rate, fetched just now from a public exchange-rate feed)`]

      if (typeof usd?.xau === 'number') {
        const ozUsd = 1 / usd.xau
        const tolaPkr = goldPkrPerTola(usd.xau, pkr)
        lines.push(
          `Gold = $${ozUsd.toFixed(2)}/troy oz (live) ≈ ${tolaPkr.toFixed(0)} PKR per tola (24k, before local dealer premium)`
        )
      }
      if (typeof usd?.btc === 'number') {
        lines.push(`Bitcoin = $${Math.round(1 / usd.btc).toLocaleString()} USD (live)`)
      }

      return lines.join('\n')
    } catch {
      continue
    }
  }
  return null
}
