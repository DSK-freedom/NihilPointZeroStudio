/**
 * OPT-IN natural narration voice via Piper (free, offline neural TTS). To keep the base
 * app small + portable, Piper (its binary + a voice model, ~80 MB) is downloaded ONCE
 * into the portable data folder (so it travels with the folder). The user's own recorded
 * voice remains the default way to narrate; this is just a nicer computer voice when
 * they want it, replacing the robotic Windows voice.
 */
import { spawn } from 'child_process'
import { createWriteStream, existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { app } from 'electron'
import { runFfmpeg } from '../video/ffmpeg'

const BIN_URL = 'https://github.com/rhasspy/piper/releases/download/2023.11.14-2/piper_windows_amd64.zip'
const VOICE_URL =
  'https://huggingface.co/rhasspy/piper-voices/resolve/main/en/en_US/lessac/low/en_US-lessac-low.onnx'
const VOICE_JSON_URL = `${VOICE_URL}.json`

function piperRoot(): string {
  const dir = join(app.getPath('userData'), 'piper')
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true })
  return dir
}
function piperExe(): string {
  return join(piperRoot(), 'piper', 'piper.exe')
}
function voiceModel(): string {
  return join(piperRoot(), 'en_US-lessac-low.onnx')
}

/** True once the binary + voice model are present in the data folder. */
export function isPiperInstalled(): boolean {
  return existsSync(piperExe()) && existsSync(voiceModel())
}

async function downloadFile(url: string, dest: string, onFrac?: (frac: number) => void): Promise<void> {
  // One-time ~80 MB voice download: generous cap so slow connections still finish,
  // but a stalled socket can no longer hang the "Download natural voice" button forever.
  const res = await fetch(url, { signal: AbortSignal.timeout(30 * 60_000) })
  if (!res.ok || !res.body) throw new Error(`Download failed (${res.status}) for ${url}`)
  const total = Number(res.headers.get('content-length') || 0)
  const ws = createWriteStream(dest)
  const reader = res.body.getReader()
  let done = 0
  for (;;) {
    const { done: finished, value } = await reader.read()
    if (finished) break
    if (value) {
      ws.write(Buffer.from(value))
      done += value.length
      if (total) onFrac?.(done / total)
    }
  }
  await new Promise<void>((resolve) => ws.end(() => resolve()))
}

function extractZip(zipPath: string, destDir: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const p = spawn('powershell.exe', [
      '-NoProfile',
      '-Command',
      `Expand-Archive -LiteralPath '${zipPath}' -DestinationPath '${destDir}' -Force`
    ])
    let err = ''
    p.stderr.on('data', (d) => (err = (err + d.toString()).slice(-500)))
    p.on('error', reject)
    p.on('exit', (code) => (code === 0 ? resolve() : reject(new Error(`Unzip failed: ${err.trim()}`))))
  })
}

/** Downloads + installs Piper into the data folder. Reports coarse progress. */
export async function downloadPiper(onProgress?: (stage: string) => void): Promise<void> {
  const root = piperRoot()
  const zip = join(root, 'piper.zip')
  onProgress?.('Downloading natural-voice engine… 0%')
  await downloadFile(BIN_URL, zip, (f) => onProgress?.(`Downloading natural-voice engine… ${Math.round(f * 100)}%`))
  onProgress?.('Unpacking voice engine…')
  await extractZip(zip, root)
  onProgress?.('Downloading voice… 0%')
  await downloadFile(VOICE_URL, voiceModel(), (f) => onProgress?.(`Downloading voice… ${Math.round(f * 100)}%`))
  await downloadFile(VOICE_JSON_URL, `${voiceModel()}.json`)
  onProgress?.('Natural voice installed.')
  if (!isPiperInstalled()) throw new Error('Install finished but the voice files are missing — try again.')
}

/**
 * Splits narration into single-line chunks for Piper. This is essential, not cosmetic:
 * Piper synthesizes stdin one LINE at a time and, with --output_file, OVERWRITES that
 * file for every line — so feeding a multi-paragraph script left only the last line's
 * audio in the WAV (almost the whole narration was silently lost). We normalise each
 * chunk to a single line and keep chunks modest so a long script never chokes the
 * phonemizer; the per-chunk WAVs are concatenated into one continuous track.
 */
export function chunkForPiper(text: string, maxChars = 600): string[] {
  const clean = text.replace(/\s+/g, ' ').trim()
  if (!clean) return []
  // Break on sentence boundaries, then greedily pack sentences up to maxChars per chunk.
  const sentences = clean.match(/[^.!?]+[.!?]+|\S+[^.!?]*$/g) ?? [clean]
  const chunks: string[] = []
  let cur = ''
  for (const s of sentences) {
    const piece = s.trim()
    if (!piece) continue
    if (cur && (cur.length + 1 + piece.length) > maxChars) {
      chunks.push(cur)
      cur = piece
    } else {
      cur = cur ? `${cur} ${piece}` : piece
    }
    // A single sentence longer than maxChars still goes out as its own chunk.
    if (cur.length >= maxChars) {
      chunks.push(cur)
      cur = ''
    }
  }
  if (cur) chunks.push(cur)
  return chunks
}

/** Runs Piper once on a single-line chunk, writing one WAV. */
function piperOnce(line: string, outWavPath: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const p = spawn(piperExe(), ['--model', voiceModel(), '--output_file', outWavPath])
    let err = ''
    p.stderr.on('data', (d) => (err = (err + d.toString()).slice(-500)))
    p.on('error', reject)
    p.on('exit', (code) => (code === 0 ? resolve() : reject(new Error(`Natural voice failed: ${err.trim()}`))))
    // Force a single line so Piper treats the whole chunk as one utterance → one file.
    p.stdin.write(line.replace(/[\r\n]+/g, ' '))
    p.stdin.end()
  })
}

/** Synthesizes `text` to a WAV using Piper. Requires isPiperInstalled(). */
export async function synthesizeWithPiper(text: string, outWavPath: string): Promise<void> {
  if (!isPiperInstalled()) {
    throw new Error('Natural voice not installed. Download it in Settings first.')
  }
  const chunks = chunkForPiper(text)
  if (chunks.length === 0) {
    throw new Error('Nothing to narrate — the script was empty after cleanup.')
  }
  // Single chunk: synthesize straight to the target, no concat needed.
  if (chunks.length === 1) {
    await piperOnce(chunks[0], outWavPath)
    return
  }
  // Multiple chunks: render each to its own WAV, then concat losslessly into one track.
  const work = mkdtempSync(join(tmpdir(), 'piper-'))
  try {
    const parts: string[] = []
    for (let i = 0; i < chunks.length; i++) {
      const part = join(work, `part-${String(i).padStart(4, '0')}.wav`)
      await piperOnce(chunks[i], part)
      parts.push(part)
    }
    // concat demuxer: identical-format WAVs join with a stream copy (no re-encode).
    const listPath = join(work, 'list.txt')
    writeFileSync(listPath, parts.map((p) => `file '${p.replace(/'/g, "'\\''")}'`).join('\n'), 'utf-8')
    await runFfmpeg(['-y', '-f', 'concat', '-safe', '0', '-i', listPath, '-c', 'copy', outWavPath])
  } finally {
    rmSync(work, { recursive: true, force: true })
  }
}
