/**
 * OPTIONAL audio source-separation for OUTSIDE videos — where the music is already
 * blended into one track, so it must be "un-mixed" with an AI model to recover the
 * spoken/vocal track. Two engines, both free:
 *
 *  - Online (MVSEP): upload the audio, poll the free queue, download the vocals stem.
 *    Internet, no install. Needs a free MVSEP API token (Settings).
 *  - Local (Demucs): run a locally-installed Demucs command. Offline, best quality,
 *    but requires a one-time install (Python + `pip install demucs`).
 *
 * Both return the path to a "vocals only" audio file (music removed). Quality is an
 * ML estimate — good on clear speech-over-music, never bit-perfect.
 */
import { spawn } from 'child_process'
import { existsSync, mkdtempSync, readdirSync, readFileSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'

const MVSEP_API = 'https://mvsep.com/api'
// Baked-in MVSEP token so online music separation works on EVERY copy with zero setup.
// A user-supplied token in Settings overrides this. To revoke, regenerate at mvsep.com.
const DEFAULT_MVSEP_TOKEN = 'NQxP7gU0ItYOG8V53634R6G0BF4mCp'
const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms))

export interface SeparateProgress {
  message: string
}

/** Online separation via MVSEP's free queue. Returns a path to the vocals-only file. */
export async function separateOnline(
  inputAudioPath: string,
  token: string,
  outDir: string,
  onProgress?: (p: SeparateProgress) => void,
  maxWaitMs = 15 * 60 * 1000
): Promise<string> {
  const key = token?.trim() || DEFAULT_MVSEP_TOKEN
  onProgress?.({ message: 'Uploading audio to the free separation queue…' })
  const form = new FormData()
  form.append('api_token', key)
  form.append('sep_type', '0') // vocals/instrumental model
  form.append('output_format', '1') // wav
  form.append('audiofile', new Blob([readFileSync(inputAudioPath) as unknown as BlobPart]), 'audio.wav')

  const createRes = await fetch(`${MVSEP_API}/separation/create`, { method: 'POST', body: form })
  const createJson = (await createRes.json().catch(() => ({}))) as {
    success?: boolean
    data?: { hash?: string; message?: string }
    errors?: string[]
  }
  if (!createRes.ok || !createJson.success || !createJson.data?.hash) {
    throw new Error(
      `Separation service rejected the upload: ${
        createJson.errors?.join(', ') || createJson.data?.message || createRes.status
      }`
    )
  }
  const hash = createJson.data.hash

  const started = Date.now()
  while (Date.now() - started < maxWaitMs) {
    await sleep(6000)
    const st = (await (await fetch(`${MVSEP_API}/separation/get?hash=${hash}`)).json().catch(() => ({}))) as {
      status?: string
      data?: { files?: { url?: string; download?: string; type?: string }[] }
    }
    onProgress?.({ message: `Separating audio (${st.status ?? 'working'})…` })
    if (st.status === 'done') {
      const files = st.data?.files ?? []
      const vocals =
        files.find((f) => /vocal/i.test(`${f.type ?? ''} ${f.url ?? ''}`)) ?? files[0]
      const url = vocals?.download || vocals?.url
      if (!url) throw new Error('Separation finished but no vocals track was returned.')
      const dl = await fetch(url)
      const outPath = join(outDir, 'vocals-online.wav')
      writeFileSync(outPath, Buffer.from(await dl.arrayBuffer()))
      return outPath
    }
    if (st.status === 'failed' || st.status === 'error') throw new Error('The separation job failed. Try again.')
  }
  throw new Error('Separation timed out — the free queue is busy. Try again later or use the local engine.')
}

/** Local separation via a Demucs CLI install. Returns a path to the vocals-only file. */
export function separateLocal(
  inputAudioPath: string,
  demucsCmd: string,
  outDir: string,
  onProgress?: (p: SeparateProgress) => void
): Promise<string> {
  return new Promise<string>((resolve, reject) => {
    if (!demucsCmd) {
      reject(new Error('No local Demucs command set. Install Demucs and set its command in Settings → “Music separation (local)”.'))
      return
    }
    onProgress?.({ message: 'Running local Demucs separation (this can take a while)…' })
    // demucs --two-stems=vocals -o <outDir> <input>  → writes <outDir>/<model>/<track>/vocals.wav
    // shell:true re-parses the command line, so paths with spaces (e.g. "C:\Users\Shoaib Khan\…")
    // MUST be quoted or they get split into multiple args (local separation then fails 100%).
    // demucsCmd itself is passed verbatim because it may be a multi-word command ("python -m demucs").
    const proc = spawn(`${demucsCmd} --two-stems=vocals -o "${outDir}" "${inputAudioPath}"`, { shell: true })
    let err = ''
    proc.stderr.on('data', (d) => (err += d.toString()))
    proc.on('error', (e) => reject(new Error(`Could not run Demucs ("${demucsCmd}"): ${e.message}. Check the command in Settings.`)))
    proc.on('exit', (code) => {
      if (code !== 0) {
        reject(new Error(`Demucs exited with code ${code}. ${err.trim().slice(-300)}`))
        return
      }
      const found = findFileRecursive(outDir, 'vocals.wav')
      if (!found) reject(new Error('Demucs finished but no vocals.wav was found in its output.'))
      else resolve(found)
    })
  })
}

/** Depth-first search for a file by exact name under a directory. */
function findFileRecursive(dir: string, name: string): string | null {
  if (!existsSync(dir)) return null
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name)
    if (entry.isDirectory()) {
      const hit = findFileRecursive(full, name)
      if (hit) return hit
    } else if (entry.name.toLowerCase() === name.toLowerCase()) {
      return full
    }
  }
  return null
}

/** Makes a scratch dir for a separation job. */
export function makeSeparationScratch(): string {
  return mkdtempSync(join(tmpdir(), 'finscript-sep-'))
}
