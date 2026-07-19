/**
 * GRAFT — the "living picture" engine behind the Presenter Studio graft mode.
 *
 * The idea (free-for-life, no paid service): you provide a PICTURE of yourself where
 * you look your best, plus a VIDEO of yourself narrating. The moving part of the video
 * (usually the mouth/lower face) is cropped out, feather-edged, colour-tweaked and
 * composited ONTO the picture — so the picture appears to speak while keeping the look
 * that made you pick it. Output is a normal video the rest of the studio consumes like
 * any clip (the presenter pipeline just swaps your raw footage for this).
 *
 * Two engines, best-first, never breaks a build:
 *   1. OPTIONAL local AI face-animation tool (user-installed, e.g. Wav2Lip/SadTalker) —
 *      configured in Settings as a command template with {photo} {video} {audio} {out}
 *      placeholders. Full-quality when present.
 *   2. BUILT-IN ffmpeg graft (this file) — honest region compositing: crop → feather →
 *      overlay. Works offline, out of the box, on every machine.
 *   3. Fallback: your raw clip, exactly as the video mode (current behaviour).
 *
 * Everything that computes ffmpeg args is PURE and unit-tested; the runners at the
 * bottom do the I/O. No Electron imports (testable under vitest).
 */
import { spawn } from 'child_process'
import { existsSync, statSync } from 'fs'
import { parseCommandLine } from '../audio/separate'
import { ffprobeDuration, makeFfmpegProgressLogger, runFfmpeg } from './ffmpeg'
import { buildVideoEncoderArgs, chooseEncoderForJob, runEncodeWithFallback } from './encoder'
import type { GraftRegion } from '../../shared/types'

export const DEFAULT_GRAFT_REGION: GraftRegion = {
  // Source: middle of the lower half of the video frame — where a talking mouth
  // usually is on a selfie-style narration video.
  sx: 0.3,
  sy: 0.5,
  sw: 0.4,
  sh: 0.3,
  // Destination: centred on the lower-middle of the picture.
  dx: 0.35,
  dy: 0.55,
  dw: 0.3,
  featherFrac: 0.12,
  brightness: 0,
  saturation: 1
}

const clamp = (n: number, lo: number, hi: number): number => Math.min(Math.max(n, lo), hi)

/** Clamps every region field into a sane, render-safe range (pure). */
export function sanitizeGraftRegion(r?: Partial<GraftRegion> | null): GraftRegion {
  const d = DEFAULT_GRAFT_REGION
  const num = (v: unknown, fb: number): number => (typeof v === 'number' && Number.isFinite(v) ? v : fb)
  const sw = clamp(num(r?.sw, d.sw), 0.05, 1)
  const sh = clamp(num(r?.sh, d.sh), 0.05, 1)
  const dw = clamp(num(r?.dw, d.dw), 0.05, 1)
  return {
    sx: clamp(num(r?.sx, d.sx), 0, 1 - sw),
    sy: clamp(num(r?.sy, d.sy), 0, 1 - sh),
    sw,
    sh,
    dx: clamp(num(r?.dx, d.dx), 0, 0.98),
    dy: clamp(num(r?.dy, d.dy), 0, 0.98),
    dw,
    featherFrac: clamp(num(r?.featherFrac, d.featherFrac), 0, 0.45),
    brightness: clamp(num(r?.brightness, d.brightness), -0.3, 0.3),
    saturation: clamp(num(r?.saturation, d.saturation), 0.2, 2)
  }
}

/**
 * The filter graph (pure). Inputs: 0 = the picture (looped still), 1 = the video.
 *  [base]  picture cover-scaled + cropped to the output frame.
 *  [part]  the video's moving region: cropped (expressions on iw/ih so the video's own
 *          resolution never matters), optionally colour-tweaked to sit better on the
 *          picture, scaled to its destination width, then alpha-feathered: alpha ramps
 *          from 0 at the cut edge to 255 over F pixels, so the graft melts into the
 *          picture instead of showing a hard rectangle.
 *  overlay places the part; shortest=1 ends the output with the video.
 */
export function buildGraftFilter(regionIn: GraftRegion, width: number, height: number, fps: number): string {
  const r = sanitizeGraftRegion(regionIn)
  const destW = Math.max(16, Math.floor((width * r.dw) / 2) * 2)
  const featherPx = Math.max(2, Math.round(destW * r.featherFrac))
  const destX = Math.round(width * r.dx)
  const destY = Math.round(height * r.dy)
  const needsEq = r.brightness !== 0 || r.saturation !== 1
  const eq = needsEq ? `eq=brightness=${r.brightness}:saturation=${r.saturation},` : ''
  return (
    `[0:v]scale=${width}:${height}:force_original_aspect_ratio=increase,crop=${width}:${height},setsar=1[base];` +
    `[1:v]crop=floor(iw*${r.sw}/2)*2:floor(ih*${r.sh}/2)*2:floor(iw*${r.sx}):floor(ih*${r.sy}),` +
    `${eq}scale=${destW}:-2:flags=lanczos,format=yuva444p,` +
    `geq=lum='lum(X,Y)':cb='cb(X,Y)':cr='cr(X,Y)':a='255*clip(min(min(X,W-X),min(Y,H-Y))/${featherPx},0,1)'[part];` +
    `[base][part]overlay=${destX}:${destY}:shortest=1,fps=${fps},format=yuv420p[v]`
  )
}

/** Full ffmpeg args for the graft render (pure). Video-only output (-an) by default —
 *  the presenter pipeline lays the ORIGINAL video's voice as the master audio track. */
export function buildGraftArgs(params: {
  photoPath: string
  videoPath: string
  region: GraftRegion
  width: number
  height: number
  fps: number
  outPath: string
  encoderArgs: string[]
  keepAudio?: boolean
}): string[] {
  const { photoPath, videoPath, region, width, height, fps, outPath, encoderArgs } = params
  const audio = params.keepAudio ? ['-map', '1:a?', '-c:a', 'aac', '-b:a', '192k'] : ['-an']
  return [
    '-y',
    '-loop', '1', '-i', photoPath,
    '-i', videoPath,
    '-filter_complex', buildGraftFilter(region, width, height, fps),
    '-map', '[v]',
    ...audio,
    ...encoderArgs,
    '-movflags', '+faststart',
    outPath
  ]
}

/** Args for a single composited PREVIEW frame at `atSec` (pure) — instant feedback in the UI. */
export function buildGraftPreviewArgs(params: {
  photoPath: string
  videoPath: string
  region: GraftRegion
  width: number
  height: number
  atSec: number
  outPng: string
}): string[] {
  const { photoPath, videoPath, region, width, height, atSec, outPng } = params
  return [
    '-y',
    '-loop', '1', '-i', photoPath,
    '-ss', String(Math.max(0, atSec)), '-i', videoPath,
    '-filter_complex', buildGraftFilter(region, width, height, 25),
    '-map', '[v]',
    '-frames:v', '1',
    outPng
  ]
}

/**
 * Substitutes {photo} {video} {audio} {out} placeholders into a user-configured tool
 * command template and splits it shell-free (pure). Each placeholder lands as a clean
 * single argument even when the path has spaces, because substitution happens AFTER
 * tokenising. Throws if the template forgets {out} (the tool's result would be lost).
 */
export function buildToolCommand(
  template: string,
  files: { photo: string; video: string; audio?: string; out: string }
): string[] {
  const parts = parseCommandLine(template)
  if (parts.length === 0) throw new Error('The face-animation command in Settings is empty.')
  if (!parts.some((p) => p.includes('{out}'))) {
    throw new Error('The face-animation command must include an {out} placeholder for the result file.')
  }
  return parts.map((p) =>
    p
      .replaceAll('{photo}', files.photo)
      .replaceAll('{video}', files.video)
      .replaceAll('{audio}', files.audio ?? files.video)
      .replaceAll('{out}', files.out)
  )
}

/* ------------------------------------------------------------------------------------ */
/* Runners (impure)                                                                      */
/* ------------------------------------------------------------------------------------ */

/** Renders the full "living picture" video with the built-in ffmpeg engine. */
export async function renderGraftVideo(params: {
  photoPath: string
  videoPath: string
  region: GraftRegion
  width: number
  height: number
  fps: number
  outPath: string
  onProgress?: (line: string) => void
}): Promise<void> {
  const dur = await ffprobeDuration(params.videoPath).catch(() => 0)
  const encoder = await chooseEncoderForJob(params.width, params.height, dur || 60)
  await runEncodeWithFallback(
    encoder,
    (encoderArgs) => buildGraftArgs({ ...params, encoderArgs }),
    {
      onLog: makeFfmpegProgressLogger(dur, params.onProgress, undefined, 'Grafting'),
      onNotice: params.onProgress
    }
  )
}

/** Renders one composited preview frame; returns the PNG path. */
export async function renderGraftPreview(params: {
  photoPath: string
  videoPath: string
  region: GraftRegion
  width: number
  height: number
  atSec: number
  outPng: string
}): Promise<string> {
  await runFfmpeg(buildGraftPreviewArgs(params))
  return params.outPng
}

/**
 * Runs the user's optional local face-animation tool (Settings command template).
 * Success = the tool exits 0 AND wrote a real, probe-able video to {out}. Bounded at
 * 30 minutes so a wedged tool can never hang a build. Never throws for tool failure —
 * returns false so the caller falls through to the built-in ffmpeg graft.
 */
export async function runGraftTool(
  template: string,
  files: { photo: string; video: string; audio?: string; out: string },
  onProgress?: (line: string) => void
): Promise<boolean> {
  let argv: string[]
  try {
    argv = buildToolCommand(template, files)
  } catch (err) {
    onProgress?.(err instanceof Error ? err.message : 'Face-animation command is invalid.')
    return false
  }
  const [exe, ...args] = argv
  const ok = await new Promise<boolean>((resolve) => {
    const proc = spawn(exe, args) // argument array, no shell
    const killer = setTimeout(() => {
      try {
        proc.kill('SIGKILL')
      } catch {
        /* already gone */
      }
      onProgress?.('Face-animation tool timed out after 30 minutes — using the built-in graft instead.')
    }, 30 * 60_000)
    let tail = ''
    proc.stderr?.on('data', (d) => {
      tail = (tail + d.toString()).slice(-400)
    })
    proc.on('error', (e) => {
      clearTimeout(killer)
      onProgress?.(`Could not run the face-animation tool (${e.message}) — using the built-in graft instead.`)
      resolve(false)
    })
    proc.on('exit', (code) => {
      clearTimeout(killer)
      if (code !== 0) onProgress?.(`Face-animation tool exited with code ${code} — using the built-in graft instead. ${tail.trim()}`)
      resolve(code === 0)
    })
  })
  if (!ok) return false
  if (!existsSync(files.out) || statSync(files.out).size < 10_000) {
    onProgress?.('Face-animation tool finished but produced no usable video — using the built-in graft instead.')
    return false
  }
  const dur = await ffprobeDuration(files.out).catch(() => 0)
  if (!dur) {
    onProgress?.('Face-animation tool output was unreadable — using the built-in graft instead.')
    return false
  }
  return true
}

// Re-exported so callers can build encoder args in tests without the encoder probe.
export { buildVideoEncoderArgs }
