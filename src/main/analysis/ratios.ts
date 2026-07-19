/**
 * Pure, tested fundamental-ratio helpers. Every function returns null when its
 * denominator is 0 (the ratio is undefined there) rather than Infinity/NaN, so
 * callers can safely skip undefined ratios. Kept dependency-free for unit tests.
 */

/** Margin as a percentage: part / whole * 100. null if whole is 0. */
export function marginPct(part: number, whole: number): number | null {
  return whole === 0 ? null : (part / whole) * 100
}

/** Earnings per share: net profit / shares outstanding. null if shares is 0. */
export function eps(netProfit: number, shares: number): number | null {
  return shares === 0 ? null : netProfit / shares
}

/** Price-to-earnings: price / EPS. null if EPS is 0. */
export function peRatio(price: number, epsValue: number): number | null {
  return epsValue === 0 ? null : price / epsValue
}

/** Return on equity as a percentage: net profit / equity * 100. null if equity is 0. */
export function roePct(netProfit: number, equity: number): number | null {
  return equity === 0 ? null : (netProfit / equity) * 100
}

/** Current ratio: current assets / current liabilities. null if liabilities is 0. */
export function currentRatio(currentAssets: number, currentLiabilities: number): number | null {
  return currentLiabilities === 0 ? null : currentAssets / currentLiabilities
}
