/**
 * Assembles a narration take from one or more recorded segments, each optionally
 * trimmed to a [start,end] window, concatenated in order into a single WAV. This is
 * what powers "redo from here" (punch-in): keep segment 1 up to the playhead, then
 * append a freshly recorded segment. Pure arg builder + unit-tested; the runner writes
 * the segment blobs to temp files and runs the bundled ffmpeg.
 */
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { runFfmpeg } from '../video/ffmpeg'

export interface VoiceSegmentSpec {
  /** Trim window within this segment (seconds). Omit for the whole segment. */
  startSec?: number
  endSec?: number
}

/**
 * Builds the ffmpeg args to trim each input to its window and concat them to one WAV.
 * Every segment is normalized to 44.1kHz mono so concat never fails on format mismatch.
 * Pure — takes already-written input file paths.
 */
export function buildAssembleArgs(inputPaths: string[], specs: VoiceSegmentSpec[], outPath: string): string[] {
  const inputs = inputPaths.flatMap((p) => ['-i', p])
  const chains = inputPaths.map((_, i) => {
    const s = specs[i] ?? {}
    const parts: string[] = []
    if (s.startSec != null || s.endSec != null) {
      const seg: string[] = []
      if (s.startSec != null) seg.push(`start=${s.startSec.toFixed(3)}`)
      if (s.endSec != null) seg.push(`end=${s.endSec.toFixed(3)}`)
      parts.push(`atrim=${seg.join(':')}`)
    }
    parts.push('asetpts=PTS-STARTPTS')
    parts.push('aformat=sample_rates=44100:channel_layouts=mono')
    return `[${i}:a]${parts.join(',')}[a${i}]`
  })
  const labels = inputPaths.map((_, i) => `[a${i}]`).join('')
  const filter = `${chains.join(';')};${labels}concat=n=${inputPaths.length}:v=0:a=1[out]`
  return ['-y', ...inputs, '-filter_complex', filter, '-map', '[out]', outPath]
}

/**
 * Writes each segment's bytes to a temp file, assembles them into one WAV, and returns
 * the WAV bytes (so the renderer can preview/scrub and later attach it).
 */
export async function assembleVoice(
  segments: { bytes: Uint8Array; startSec?: number; endSec?: number }[]
): Promise<Uint8Array> {
  if (!segments.length) throw new Error('No audio to assemble.')
  const dir = mkdtempSync(join(tmpdir(), 'finscript-voice-'))
  try {
    const paths = segments.map((seg, i) => {
      const p = join(dir, `seg${i}.webm`)
      writeFileSync(p, Buffer.from(seg.bytes))
      return p
    })
    const out = join(dir, 'assembled.wav')
    await runFfmpeg(buildAssembleArgs(paths, segments, out))
    return new Uint8Array(readFileSync(out))
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
}
