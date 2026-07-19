/**
 * LIVE Pakistan Stock Exchange data — pulled directly from the public PSX data portal
 * (dps.psx.com.pk), which serves keyless JSON. We fetch a symbol's real end-of-day
 * history and its company fundamentals, then run the SAME unit-tested math the rest of
 * the app uses (SMA / Wilder RSI / growth). No paid key, no third-party service.
 *
 * Honesty notes baked into the design:
 *  - The MATH is deterministic and unit-tested (see analysis/math.ts) — accurate.
 *  - The FETCH depends on PSX keeping these public endpoints up and unchanged; if the
 *    portal changes shape, the fetchers throw a clear error rather than inventing data.
 *  - EOD `close` is the portal's ADJUSTED close (correct input for indicators). We never
 *    fabricate OHLC we don't have.
 */
import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'fs'
import { join } from 'path'
import * as XLSX from 'xlsx'
import { growthPct, rsiWilder, sma } from '../analysis/math'
import type { PsxLiveAnalysis } from '../../shared/types'

/** Analysis shape — defined once in shared/types as PsxLiveAnalysis so main + renderer agree. */
export type PsxAnalysis = PsxLiveAnalysis

const DPS = 'https://dps.psx.com.pk'
const UA = { 'User-Agent': 'Mozilla/5.0 (NihilPointZero Studio)' }

export interface PsxBar {
  /** Unix seconds. */
  ts: number
  /** ISO date (YYYY-MM-DD). */
  date: string
  /** Adjusted close (matches the portal's live quote for the latest bar). */
  close: number
  /** Traded volume (shares). */
  volume: number
}

/** Normalises a user-typed symbol to the portal's form (LUCK, HUBC, ENGRO, …). */
export function normalizeSymbol(symbol: string): string {
  return (symbol || '').trim().toUpperCase().replace(/[^A-Z0-9.]/g, '')
}

/**
 * Where last-good EOD payloads are cached. Set once at startup by the main process
 * (ipc.ts) — deliberately injected rather than derived here so this module stays free
 * of any Electron import and unit-testable. Unset (tests) → caching is simply off.
 */
let psxCacheDir: string | null = null
export function setPsxCacheDir(dir: string): void {
  psxCacheDir = dir
}

interface PsxCacheEntry {
  fetchedAt: string // ISO timestamp of the successful fetch
  json: { status?: number; message?: string; data?: unknown }
}

function cachePathFor(sym: string): string | null {
  return psxCacheDir ? join(psxCacheDir, `eod-${sym}.json`) : null
}

/** Best-effort atomic cache write (temp + rename) — a failure never breaks a fetch. */
function writePsxCache(sym: string, json: PsxCacheEntry['json']): void {
  const p = cachePathFor(sym)
  if (!p || !psxCacheDir) return
  try {
    mkdirSync(psxCacheDir, { recursive: true })
    const entry: PsxCacheEntry = { fetchedAt: new Date().toISOString(), json }
    const tmp = `${p}.tmp`
    writeFileSync(tmp, JSON.stringify(entry), 'utf-8')
    renameSync(tmp, p)
  } catch {
    /* cache is best-effort */
  }
}

function readPsxCache(sym: string): PsxCacheEntry | null {
  const p = cachePathFor(sym)
  if (!p) return null
  try {
    const entry = JSON.parse(readFileSync(p, 'utf-8')) as PsxCacheEntry
    return entry && typeof entry.fetchedAt === 'string' && entry.json ? entry : null
  } catch {
    return null
  }
}

export interface PsxEodResult {
  bars: PsxBar[]
  /** null = live data. Otherwise the YYYY-MM-DD the shown (cached) data was last fetched. */
  staleAsOf: string | null
}

/**
 * Fetches a symbol's real EOD history with a hard timeout, one retry, and a last-good
 * cache: every successful fetch is saved, and if the portal is unreachable the saved
 * data is served instead — marked stale via `staleAsOf` so the UI can say so plainly
 * (graceful degradation instead of a blank tab when dps.psx.com.pk is down).
 */
export async function fetchPsxEodDetailed(symbol: string): Promise<PsxEodResult> {
  const sym = normalizeSymbol(symbol)
  if (!sym) throw new Error('Enter a PSX symbol, e.g. LUCK, HUBC or ENGRO.')
  let lastErr: Error | null = null
  for (let attempt = 0; attempt < 2; attempt++) {
    if (attempt > 0) await new Promise((r) => setTimeout(r, 1500)) // brief pause, then retry once
    try {
      const res = await fetch(`${DPS}/timeseries/eod/${sym}`, {
        headers: UA,
        // A stalled socket must not hang the tab forever (the cancel flag can't reach a fetch).
        signal: AbortSignal.timeout(15_000)
      })
      if (!res.ok) {
        lastErr = new Error(`PSX portal returned HTTP ${res.status} for "${sym}". Check the symbol.`)
        // 4xx (bad symbol) won't improve on retry — and must NOT be masked by stale cache.
        if (res.status >= 400 && res.status < 500) throw lastErr
        continue
      }
      const json = (await res.json()) as PsxCacheEntry['json']
      const bars = parsePsxEod(json, sym) // throws if the payload is unusable
      writePsxCache(sym, json)
      return { bars, staleAsOf: null }
    } catch (err) {
      if (err === lastErr) throw err // the 4xx case above — a real answer, not an outage
      lastErr = new Error(
        `Could not reach the PSX data portal (check your internet): ${err instanceof Error ? err.message : 'network error'}`
      )
    }
  }
  // Portal unreachable — serve the last-good data if we have it, clearly marked stale.
  const cached = readPsxCache(sym)
  if (cached) {
    try {
      const bars = parsePsxEod(cached.json, sym)
      return { bars, staleAsOf: cached.fetchedAt.slice(0, 10) }
    } catch {
      /* corrupt cache — fall through to the real error */
    }
  }
  throw lastErr ?? new Error(`Could not fetch PSX data for "${sym}".`)
}

/** Fetches a symbol's real end-of-day history from the PSX portal, oldest→newest. */
export async function fetchPsxEod(symbol: string): Promise<PsxBar[]> {
  return (await fetchPsxEodDetailed(symbol)).bars
}

/**
 * Pure parser for the PSX EOD payload — separated so it can be unit-tested without a
 * network call. Rows arrive as [unixSeconds, adjClose, volume, refPrice], newest first;
 * we keep close+volume, drop malformed rows, and sort ascending by time.
 */
export function parsePsxEod(json: { status?: number; message?: string; data?: unknown }, sym: string): PsxBar[] {
  if (!json || json.status !== 1 || !Array.isArray(json.data) || json.data.length === 0) {
    throw new Error(`PSX returned no usable data for "${sym}"${json?.message ? ` (${json.message})` : ''}.`)
  }
  const bars: PsxBar[] = []
  for (const row of json.data as unknown[]) {
    if (!Array.isArray(row) || row.length < 3) continue
    const ts = Number(row[0])
    const close = Number(row[1])
    const volume = Number(row[2])
    if (!Number.isFinite(ts) || !Number.isFinite(close) || close <= 0) continue
    bars.push({ ts, date: new Date(ts * 1000).toISOString().slice(0, 10), close, volume: Number.isFinite(volume) ? volume : 0 })
  }
  if (bars.length === 0) throw new Error(`PSX data for "${sym}" was unreadable.`)
  bars.sort((a, b) => a.ts - b.ts)
  return bars
}

/**
 * Pure analysis of a bar series — no network, fully deterministic, so it can be
 * unit-tested against known inputs. Reuses the app's shared math (sma / rsiWilder /
 * growthPct). This is the "100% mathematically accurate" part: same standard formulas,
 * verified by tests.
 */
export function analyzePsxBars(symbol: string, bars: PsxBar[]): PsxAnalysis {
  if (bars.length < 2) throw new Error(`Not enough price history for ${symbol} to analyze.`)
  const closes = bars.map((b) => b.close)
  const latest = closes[closes.length - 1]
  const prior = closes[closes.length - 2]
  const last252 = closes.slice(-252)
  const yearAgo = last252[0]
  const vols = bars.map((b) => b.volume)
  const avgVol20 = sma(vols, 20)
  const latestVolume = vols[vols.length - 1]
  const sma50 = sma(closes, 50)
  const sma200 = sma(closes, 200)
  let trend = 'insufficient history for a full trend read'
  if (sma50 !== null && sma200 !== null) {
    if (latest > sma50 && sma50 > sma200) trend = 'uptrend (price > 50-DMA > 200-DMA)'
    else if (latest < sma50 && sma50 < sma200) trend = 'downtrend (price < 50-DMA < 200-DMA)'
    else trend = 'mixed / transitioning (SMAs not aligned)'
  }
  return {
    symbol: normalizeSymbol(symbol),
    points: bars.length,
    from: bars[0].date,
    to: bars[bars.length - 1].date,
    latest,
    latestDate: bars[bars.length - 1].date,
    changePct: growthPct(prior, latest),
    high52w: Math.max(...last252),
    low52w: Math.min(...last252),
    yearChangePct: growthPct(yearAgo, latest),
    sma20: sma(closes, 20),
    sma50,
    sma200,
    rsi14: rsiWilder(closes, 14),
    latestVolume,
    volumeVs20dAvg: avgVol20 && avgVol20 !== 0 ? latestVolume / avgVol20 : null,
    trend
  }
}

/** A plain-text, cite-ready summary of the analysis (used in UI + as script context). */
export function summarizePsxAnalysis(a: PsxAnalysis): string {
  const pct = (n: number | null) => (n === null ? 'n/a' : `${n >= 0 ? '+' : ''}${n.toFixed(2)}%`)
  const num = (n: number | null) => (n === null ? 'n/a' : n.toFixed(2))
  // When fewer than a full trading year (~252 bars) is available, `last252` spans
  // the whole file — so label the range/change by the ACTUAL window, never as
  // "52-week"/"1-year", which would overstate the period.
  const fullYear = a.points >= 252
  const rangeLabel = fullYear ? '52-week range' : `Range (last ${a.points} trading days)`
  const changeLabel = fullYear ? '1-year change' : `Change over last ${a.points} trading days`
  const lines = [
    `${a.symbol} — PSX live data (${a.points} trading days, ${a.from} → ${a.to})`,
    `Latest close (${a.latestDate}): ${a.latest.toFixed(2)} PKR (${pct(a.changePct)} vs prior day)`,
    `${rangeLabel}: ${a.low52w.toFixed(2)} – ${a.high52w.toFixed(2)} PKR`,
    `${changeLabel}: ${pct(a.yearChangePct)}`,
    `20-DMA: ${num(a.sma20)} · 50-DMA: ${num(a.sma50)} · 200-DMA: ${num(a.sma200)}`,
    `RSI(14, Wilder): ${a.rsi14 === null ? 'n/a' : a.rsi14.toFixed(1)}${a.rsi14 === null ? '' : a.rsi14 >= 70 ? ' (overbought)' : a.rsi14 <= 30 ? ' (oversold)' : ' (neutral)'}`,
    `Latest volume: ${a.latestVolume.toLocaleString()}${a.volumeVs20dAvg ? ` (${a.volumeVs20dAvg.toFixed(2)}× the 20-day average)` : ''}`,
    `Trend: ${a.trend}`,
    `(Figures computed in-app from PSX EOD data with standard formulas.)`
  ]
  return lines.join('\n')
}

/**
 * Writes a real .xlsx workbook (Prices + Summary sheets) to `outPath`. The Prices sheet
 * carries every fetched bar (Date, Close, Volume, running 20/50/200-DMA, RSI14) so the
 * numbers are auditable; the Summary sheet holds the headline metrics. Uses the bundled
 * `xlsx` (offline). Returns the path written.
 */
export function buildPsxWorkbook(bars: PsxBar[], analysis: PsxAnalysis, outPath: string): string {
  const closes = bars.map((b) => b.close)
  const priceRows: (string | number)[][] = [['Date', 'Close (PKR)', 'Volume', 'SMA20', 'SMA50', 'SMA200', 'RSI14']]
  for (let i = 0; i < bars.length; i++) {
    const upto = closes.slice(0, i + 1)
    const s20 = sma(upto, 20)
    const s50 = sma(upto, 50)
    const s200 = sma(upto, 200)
    const r = rsiWilder(upto, 14)
    priceRows.push([
      bars[i].date,
      bars[i].close,
      bars[i].volume,
      s20 === null ? '' : Number(s20.toFixed(2)),
      s50 === null ? '' : Number(s50.toFixed(2)),
      s200 === null ? '' : Number(s200.toFixed(2)),
      r === null ? '' : Number(r.toFixed(1))
    ])
  }
  const summaryRows: (string | number)[][] = [
    ['Metric', 'Value'],
    ['Symbol', analysis.symbol],
    ['Data points (trading days)', analysis.points],
    ['Date range', `${analysis.from} to ${analysis.to}`],
    ['Latest close (PKR)', analysis.latest],
    ['Latest date', analysis.latestDate],
    ['Change vs prior day (%)', analysis.changePct === null ? 'n/a' : Number(analysis.changePct.toFixed(2))],
    [analysis.points >= 252 ? '52-week low (PKR)' : `Low, last ${analysis.points} days (PKR)`, Number(analysis.low52w.toFixed(2))],
    [analysis.points >= 252 ? '52-week high (PKR)' : `High, last ${analysis.points} days (PKR)`, Number(analysis.high52w.toFixed(2))],
    [analysis.points >= 252 ? '1-year change (%)' : `Change, last ${analysis.points} days (%)`, analysis.yearChangePct === null ? 'n/a' : Number(analysis.yearChangePct.toFixed(2))],
    ['SMA 20', analysis.sma20 === null ? 'n/a' : Number(analysis.sma20.toFixed(2))],
    ['SMA 50', analysis.sma50 === null ? 'n/a' : Number(analysis.sma50.toFixed(2))],
    ['SMA 200', analysis.sma200 === null ? 'n/a' : Number(analysis.sma200.toFixed(2))],
    ['RSI 14 (Wilder)', analysis.rsi14 === null ? 'n/a' : Number(analysis.rsi14.toFixed(1))],
    ['Latest volume', analysis.latestVolume],
    ['Volume vs 20-day avg (×)', analysis.volumeVs20dAvg === null ? 'n/a' : Number(analysis.volumeVs20dAvg.toFixed(2))],
    ['Trend', analysis.trend],
    ['Source', 'PSX data portal (dps.psx.com.pk), EOD; figures computed in-app']
  ]
  const wb = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(summaryRows), 'Summary')
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(priceRows), 'Prices')
  // Write via a Buffer + Node fs (NOT XLSX.writeFile) — xlsx can't locate `fs` in
  // bundled/ESM contexts and throws "cannot save file". This works everywhere.
  const buf = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' }) as Buffer
  writeFileSync(outPath, buf)
  return outPath
}
