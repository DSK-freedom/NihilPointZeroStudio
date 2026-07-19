import { spawn } from 'child_process'
import ffmpegStatic from 'ffmpeg-static'
import ffprobeStatic from 'ffprobe-static'

/**
 * ffmpeg / ffprobe live inside node_modules in dev. When packaged they sit inside
 * app.asar but are unpacked (asarUnpack in electron-builder.yml), so we point at
 * the app.asar.unpacked copy. Detecting this by path (rather than app.isPackaged)
 * keeps this module free of any Electron import, so it also runs under tests.
 */
function resolveBinary(p: string): string {
  return p.includes('app.asar') ? p.replace('app.asar', 'app.asar.unpacked') : p
}

export const ffmpegPath = resolveBinary(ffmpegStatic as unknown as string)
export const ffprobePath = resolveBinary(ffprobeStatic.path)

/** Live ffmpeg child processes, so an in-progress render can be cancelled. */
const activeFfmpeg = new Set<ReturnType<typeof spawn>>()

/** True when the most recent cancel is still "fresh", so we can label the failure. */
let lastCancelAt = 0

/**
 * Sticky "the user asked to stop" flag. Unlike killing ffmpeg, this also stops the
 * NON-ffmpeg stages of a build (narration TTS, per-scene AI image downloads, stock
 * fetches) — those run before any ffmpeg process exists, so killing ffmpeg alone did
 * nothing and the build kept going. Long stages poll `throwIfCancelled()` between steps.
 */
let cancelRequested = false

/** Marker text put on the rejection when a run was cancelled by the user. */
export const CANCELLED_MESSAGE = 'Render cancelled by user.'

/**
 * Call at the very start of a top-level build/export so a Stop from a PREVIOUS run
 * doesn't immediately abort this fresh one. Clears the sticky cancel flag.
 */
export function beginRenderSession(): void {
  cancelRequested = false
  lastCancelAt = 0
}

/** Throws CANCELLED_MESSAGE if the user has pressed Stop. Cheap; poll it between stages. */
export function throwIfCancelled(): void {
  if (cancelRequested) throw new Error(CANCELLED_MESSAGE)
}

/** True while a Stop is pending — for stages that want to bail without throwing. */
export function isCancelRequested(): boolean {
  return cancelRequested
}

/**
 * Requests cancellation: sets the sticky flag AND kills every running ffmpeg process
 * (there is normally just one build at a time). Returns how many ffmpeg procs were
 * killed. Even when that's 0 (we're mid TTS / image download), the flag ensures the
 * next `throwIfCancelled()` poll stops the build. Callers surface it as a friendly
 * "stopped" state rather than an error.
 */
export function cancelActiveFfmpeg(): number {
  cancelRequested = true
  lastCancelAt = Date.now()
  let n = 0
  for (const proc of activeFfmpeg) {
    try {
      proc.kill('SIGKILL')
      n++
    } catch {
      /* already gone */
    }
  }
  activeFfmpeg.clear()
  return n
}

/** Runs ffmpeg with the given args; streams stderr to onLog. Rejects on non-zero exit. */
export function runFfmpeg(args: string[], onLog?: (line: string) => void): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    // A Stop pressed between stages must stop the NEXT ffmpeg step too, not just the
    // one that was running when Stop was pressed.
    if (cancelRequested) return reject(new Error(CANCELLED_MESSAGE))
    const proc = spawn(ffmpegPath, args)
    activeFfmpeg.add(proc)
    let stderrTail = ''
    proc.stderr.on('data', (d) => {
      const s = d.toString()
      stderrTail = (stderrTail + s).slice(-2000)
      onLog?.(s)
    })
    proc.on('error', (err) => {
      activeFfmpeg.delete(proc)
      reject(err)
    })
    proc.on('exit', (code) => {
      activeFfmpeg.delete(proc)
      if (code === 0) return resolve()
      // A kill within the last few seconds means the user cancelled it.
      if (Date.now() - lastCancelAt < 4000) return reject(new Error(CANCELLED_MESSAGE))
      reject(new Error(`ffmpeg exited with code ${code}: ${stderrTail.trim()}`))
    })
  })
}

/** Returns the video's [width, height] via ffprobe (defaults to 1920x1080 on failure). */
export function ffprobeVideoSize(file: string): Promise<[number, number]> {
  return new Promise<[number, number]>((resolve) => {
    const proc = spawn(ffprobePath, [
      '-v', 'error', '-select_streams', 'v:0',
      '-show_entries', 'stream=width,height', '-of', 'csv=p=0:s=x', file
    ])
    let out = ''
    proc.stdout.on('data', (d) => (out += d.toString()))
    proc.on('error', () => resolve([1920, 1080]))
    proc.on('exit', () => {
      const m = /(\d+)x(\d+)/.exec(out.trim())
      resolve(m ? [parseInt(m[1], 10), parseInt(m[2], 10)] : [1920, 1080])
    })
  })
}

/** Returns the media duration in seconds via ffprobe. */
export function ffprobeDuration(file: string): Promise<number> {
  return new Promise<number>((resolve, reject) => {
    const proc = spawn(ffprobePath, [
      '-v',
      'error',
      '-show_entries',
      'format=duration',
      '-of',
      'default=nw=1:nk=1',
      file
    ])
    let out = ''
    let err = ''
    proc.stdout.on('data', (d) => (out += d.toString()))
    proc.stderr.on('data', (d) => (err += d.toString()))
    proc.on('error', reject)
    proc.on('exit', (code) => {
      const n = parseFloat(out.trim())
      if (code === 0 && Number.isFinite(n)) resolve(n)
      else reject(new Error(`ffprobe failed: ${err.trim() || 'no duration'}`))
    })
  })
}
