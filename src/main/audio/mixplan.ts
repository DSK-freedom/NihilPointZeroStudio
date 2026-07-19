/**
 * Pure builder for the DJ-station timeline mix. Given a base audio input (a built
 * video's own narration/audio = input 0) and a list of placed clips (inputs 1..N),
 * it produces the `filter_complex` chains that trim each clip to its segment, delay
 * it to its timestamp, apply gain + fades, and mix everything with the base.
 *
 * Mirrors the proven pattern in video/render.ts `buildAudioFilter`: `amix` with
 * `normalize=0` so the base narration keeps its full level as clips are added.
 * No Node/Electron imports → unit-tested.
 */
import type { AudioClip } from '../../shared/types'

export interface TimelinePlan {
  /** filter_complex chains (joined with ';'). Empty when there are no clips. */
  chains: string[]
  /** What to pass to `-map` for audio. */
  audioMap: string
  /** Source paths for the clip inputs, in order (each becomes one `-i`). */
  clipInputs: string[]
}

const f3 = (n: number): string => n.toFixed(3)

/**
 * Builds the timeline mix. `baseLabel` is the ffmpeg pad for the video's own audio
 * (default `0:a`). Clips become inputs starting at index 1. Clips with a start/end
 * are trimmed to that segment first; all are delayed to `atSec`, gained, and faded.
 */
export function buildTimelineFilter(clips: AudioClip[], baseLabel = '0:a'): TimelinePlan {
  if (!clips.length) return { chains: [], audioMap: baseLabel, clipInputs: [] }

  // Normalise every user clip to one rate/layout before amix — user clips are arbitrary
  // rates/layouts and mixing mismatched inputs is unreliable. (The base is the app's own
  // 44.1 kHz audio, so it needs no conversion.)
  const NORM = 'aresample=44100,aformat=sample_fmts=fltp:channel_layouts=stereo'
  const chains: string[] = []
  const mixLabels: string[] = [`[${baseLabel}]`]
  const clipInputs: string[] = []

  clips.forEach((clip, i) => {
    const input = i + 1 // input 0 is the base audio
    clipInputs.push(clip.src)
    const parts: string[] = []

    // Optional segment selection within the source file.
    if (typeof clip.startSec === 'number' || typeof clip.endSec === 'number') {
      const start = Math.max(0, clip.startSec ?? 0)
      const end = clip.endSec ?? undefined
      parts.push(end !== undefined ? `atrim=${f3(start)}:${f3(end)}` : `atrim=${f3(start)}`)
      parts.push('asetpts=PTS-STARTPTS')
    }

    // Gain. Accept 0 as a valid value (explicit mute) — only a non-finite or
    // negative gain (which would invert phase) falls back to unity.
    const gain = Number.isFinite(clip.gain) && clip.gain >= 0 ? clip.gain : 1
    if (gain !== 1) parts.push(`volume=${f3(gain)}`)

    // Fades. Fade-in is anchored at the clip start. Fade-out is anchored to the
    // clip's own length: when the segment length is known we place it precisely;
    // when it is unknown we fade the tail via areverse→afade(in)→areverse, which
    // needs no length up front (works for any finite clip).
    if (clip.fadeIn > 0) parts.push(`afade=t=in:st=0:d=${f3(clip.fadeIn)}`)
    if (clip.fadeOut > 0) {
      const segLen =
        typeof clip.endSec === 'number' && typeof clip.startSec === 'number'
          ? Math.max(0, clip.endSec - clip.startSec)
          : undefined
      if (segLen !== undefined) {
        const st = Math.max(0, segLen - clip.fadeOut)
        parts.push(`afade=t=out:st=${f3(st)}:d=${f3(clip.fadeOut)}`)
      } else {
        parts.push('areverse', `afade=t=in:st=0:d=${f3(clip.fadeOut)}`, 'areverse')
      }
    }

    // Delay to the placement timestamp (both channels).
    const ms = Math.max(0, Math.round(clip.atSec * 1000))
    if (ms > 0) parts.push(`adelay=${ms}:all=1`)

    const chain = parts.length ? `${NORM},${parts.join(',')}` : NORM
    chains.push(`[${input}:a]${chain}[c${i}]`)
    mixLabels.push(`[c${i}]`)
  })

  // normalize=0 keeps the base narration at full level as clips are added, but summed
  // clips (some at gain up to 2×) can exceed 0 dBFS and hard-clip in the encoder — so a
  // final alimiter catches the peaks (matches the timeline mix in video/timeline.ts).
  chains.push(
    `${mixLabels.join('')}amix=inputs=${mixLabels.length}:duration=first:normalize=0[amx];[amx]alimiter=limit=0.95:level=disabled[aout]`
  )
  return { chains, audioMap: '[aout]', clipInputs }
}
