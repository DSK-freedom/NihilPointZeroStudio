/**
 * Pure builders for cutting a finished video. Two modes:
 *   - 'keep'   → keep only the [start, end] range, drop the rest.
 *   - 'remove' → cut the [start, end] range out, keep everything around it.
 *
 * Everything re-encodes (H.264/AAC) so cuts are frame-accurate rather than snapping
 * to the nearest keyframe (stream-copy would). No Node/Electron imports → unit-tested.
 */

import type { TrimMode } from '../../shared/types'
export type { TrimMode } from '../../shared/types'

export interface TrimRange {
  start: number
  end: number
}

/**
 * Clamps a requested [start, end] to a valid sub-range of a clip of `duration`
 * seconds. Throws when no positive-length range can be formed (so the UI can show a
 * clear error rather than producing a broken/empty file).
 */
export function clampRange(start: number, end: number, duration: number): TrimRange {
  if (!(duration > 0)) throw new Error('Clip duration is unknown or zero.')
  let s = Number.isFinite(start) ? start : 0
  let e = Number.isFinite(end) ? end : duration
  s = Math.min(Math.max(s, 0), duration)
  e = Math.min(Math.max(e, 0), duration)
  if (e - s < 0.05) throw new Error('Select a range of at least 0.05 seconds.')
  return { start: s, end: e }
}

/** Re-encode output args shared by both modes. `mp4` gets the faststart flag. */
function encodeOut(outPath: string): string[] {
  const args = [
    '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '20', '-pix_fmt', 'yuv420p',
    '-c:a', 'aac', '-b:a', '192k'
  ]
  if (/\.mp4$/i.test(outPath)) args.push('-movflags', '+faststart')
  args.push(outPath)
  return args
}

const t = (n: number): string => n.toFixed(3)

/**
 * Builds ffmpeg args for a keep-only cut using output-side seeking (`-ss`/`-to`
 * AFTER `-i`) so the cut is frame-accurate.
 */
export function buildKeepArgs(srcPath: string, range: TrimRange, outPath: string): string[] {
  return ['-y', '-i', srcPath, '-ss', t(range.start), '-to', t(range.end), ...encodeOut(outPath)]
}

/**
 * Builds ffmpeg args for removing [start, end] from a clip of `duration` seconds.
 * Depending on where the cut sits this yields one surviving segment (a plain keep)
 * or two segments concatenated via filter_complex.
 */
export function buildRemoveArgs(
  srcPath: string,
  range: TrimRange,
  duration: number,
  outPath: string
): string[] {
  const head = range.start > 0.05 // is there anything before the cut?
  const tail = range.end < duration - 0.05 // is there anything after the cut?
  if (!head && !tail) throw new Error('That range covers the whole clip — nothing would remain.')

  // Only one side survives → it's just a keep of the surviving segment.
  if (head && !tail) return buildKeepArgs(srcPath, { start: 0, end: range.start }, outPath)
  if (!head && tail) return buildKeepArgs(srcPath, { start: range.end, end: duration }, outPath)

  // Both sides survive → trim two segments and concat them.
  const filter =
    `[0:v]trim=0:${t(range.start)},setpts=PTS-STARTPTS[v0];` +
    `[0:a]atrim=0:${t(range.start)},asetpts=PTS-STARTPTS[a0];` +
    `[0:v]trim=${t(range.end)}:${t(duration)},setpts=PTS-STARTPTS[v1];` +
    `[0:a]atrim=${t(range.end)}:${t(duration)},asetpts=PTS-STARTPTS[a1];` +
    `[v0][a0][v1][a1]concat=n=2:v=1:a=1[v][a]`
  return ['-y', '-i', srcPath, '-filter_complex', filter, '-map', '[v]', '-map', '[a]', ...encodeOut(outPath)]
}

/** Dispatches to the right builder for the given mode. */
export function buildTrimArgs(
  mode: TrimMode,
  srcPath: string,
  range: TrimRange,
  duration: number,
  outPath: string
): string[] {
  return mode === 'keep' ? buildKeepArgs(srcPath, range, outPath) : buildRemoveArgs(srcPath, range, duration, outPath)
}
