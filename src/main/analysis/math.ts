/**
 * Pure, dependency-free numeric functions used by the analysis modules. Kept
 * separate (and exported) so they can be unit-tested against known reference
 * values without touching file parsing or Electron.
 */

/** Simple moving average of the last `period` values. null if fewer than `period`. */
export function sma(values: number[], period: number): number | null {
  if (period <= 0 || values.length < period) return null
  const slice = values.slice(-period)
  return slice.reduce((a, b) => a + b, 0) / period
}

/**
 * Wilder's RSI over `period` (default 14) — the standard smoothed formula, not a
 * single-window average. Seeds the average gain/loss with the simple mean of the
 * first `period` diffs, then applies Wilder smoothing
 * (avg = (prevAvg*(period-1) + current) / period) for every later diff.
 * Returns null if fewer than `period + 1` closes, 100 if there are no losses,
 * 0 if there are no gains.
 */
export function rsiWilder(closes: number[], period = 14): number | null {
  if (period <= 0 || closes.length < period + 1) return null
  let gainSum = 0
  let lossSum = 0
  for (let i = 1; i <= period; i++) {
    const diff = closes[i] - closes[i - 1]
    if (diff >= 0) gainSum += diff
    else lossSum -= diff
  }
  let avgGain = gainSum / period
  let avgLoss = lossSum / period
  for (let i = period + 1; i < closes.length; i++) {
    const diff = closes[i] - closes[i - 1]
    const gain = diff > 0 ? diff : 0
    const loss = diff < 0 ? -diff : 0
    avgGain = (avgGain * (period - 1) + gain) / period
    avgLoss = (avgLoss * (period - 1) + loss) / period
  }
  // A perfectly flat window gives avgGain === avgLoss === 0 (RSI is genuinely
  // 0/0 there). Conventionally that is neutral (50), never overbought — so test
  // the both-zero case before the single-sided ones.
  if (avgGain === 0 && avgLoss === 0) return 50
  if (avgLoss === 0) return 100
  if (avgGain === 0) return 0
  const rs = avgGain / avgLoss
  return 100 - 100 / (1 + rs)
}

/**
 * Pearson correlation coefficient of two series. Uses the first
 * min(x.length, y.length) points. Returns 0 for fewer than 2 points or when
 * either series has zero variance (correlation is undefined there).
 */
export function pearsonCorrelation(x: number[], y: number[]): number {
  const n = Math.min(x.length, y.length)
  if (n < 2) return 0
  let meanX = 0
  let meanY = 0
  for (let i = 0; i < n; i++) {
    meanX += x[i]
    meanY += y[i]
  }
  meanX /= n
  meanY /= n
  let num = 0
  let denX = 0
  let denY = 0
  for (let i = 0; i < n; i++) {
    const dx = x[i] - meanX
    const dy = y[i] - meanY
    num += dx * dy
    denX += dx * dx
    denY += dy * dy
  }
  if (denX === 0 || denY === 0) return 0
  return num / Math.sqrt(denX * denY)
}

/**
 * Percentage change from `from` to `to`, using |from| as the denominator so the
 * sign reflects direction of the numerator even when the base is negative.
 * null when `from` is 0 (change is undefined / infinite).
 */
export function growthPct(from: number, to: number): number | null {
  if (from === 0) return null
  return ((to - from) / Math.abs(from)) * 100
}
