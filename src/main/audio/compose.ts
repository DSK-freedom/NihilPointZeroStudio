/**
 * Procedural music + SFX composition — PURE (no Node/Electron), so every generated
 * ffmpeg synthesis string is deterministic from its inputs and unit-testable. The
 * app *creates* its own audio with ffmpeg's `aevalsrc`/`anoisesrc` (all present in
 * the bundled build), so music and sound effects are free, offline, and license-clear.
 *
 * Music approach: one `aevalsrc` expression per track. Time `t` (seconds) drives
 * sine partials for a chord pad + bass + a stepped arpeggio. A short chord cycle is
 * repeated with `mod(t, cycle)` so the expression stays bounded and the bed loops.
 * Phases use absolute `t` (continuous) while note selection uses cycle-local time.
 */

import { type Mood, type SfxKind } from '../../shared/types'
export { MOODS, SFX_KINDS, type Mood, type SfxKind } from '../../shared/types'

/** Equal-temperament frequency (Hz) for a MIDI note number. A4 (69) = 440 Hz. */
export function noteToFreq(midi: number): number {
  return 440 * Math.pow(2, (midi - 69) / 12)
}

/** Chord shapes as semitone offsets from the chord root. */
const CHORD: Record<'maj' | 'min' | 'sus', number[]> = {
  maj: [0, 4, 7],
  min: [0, 3, 10], // min7-ish flavour (root, b3, b7) — warmer bed
  sus: [0, 5, 7]
}

interface MoodSpec {
  /** Root MIDI note of the progression. */
  root: number
  /** Chord progression as [semitone-offset-from-root, quality] steps. */
  progression: Array<[number, keyof typeof CHORD]>
  /** Seconds per chord. */
  chordDur: number
  /** Tremolo depth 0..1 and rate Hz for gentle movement. */
  tremDepth: number
  tremRate: number
  /** Low-pass cutoff (warmth). */
  cutoff: number
  /** Echo/space amount (aecho decay 0..1). */
  space: number
}

const MOOD_SPECS: Record<Mood, MoodSpec> = {
  // Roots chosen in a comfortable mid register (MIDI ~48–57).
  calm: { root: 57, progression: [[0, 'maj'], [-4, 'min'], [-7, 'sus'], [-5, 'maj']], chordDur: 3.2, tremDepth: 0.18, tremRate: 0.5, cutoff: 1800, space: 0.4 },
  uplifting: { root: 60, progression: [[0, 'maj'], [7, 'maj'], [9, 'min'], [5, 'maj']], chordDur: 2.4, tremDepth: 0.12, tremRate: 1.2, cutoff: 3000, space: 0.3 },
  tense: { root: 52, progression: [[0, 'min'], [1, 'min'], [0, 'min'], [-2, 'sus']], chordDur: 2.0, tremDepth: 0.3, tremRate: 3.0, cutoff: 2200, space: 0.25 },
  lofi: { root: 55, progression: [[0, 'min'], [-3, 'maj'], [-5, 'min'], [-7, 'maj']], chordDur: 2.8, tremDepth: 0.22, tremRate: 0.8, cutoff: 1200, space: 0.5 },
  corporate: { root: 60, progression: [[0, 'maj'], [5, 'maj'], [7, 'sus'], [0, 'maj']], chordDur: 2.6, tremDepth: 0.1, tremRate: 1.0, cutoff: 3200, space: 0.2 },
  cinematic: { root: 48, progression: [[0, 'min'], [3, 'maj'], [-2, 'sus'], [5, 'min']], chordDur: 3.6, tremDepth: 0.15, tremRate: 0.35, cutoff: 2600, space: 0.6 }
}

/** Deterministic small integer picker from a seed (no Math.random — resume-safe). */
function pick<T>(arr: T[], seed: number): T {
  const i = ((seed % arr.length) + arr.length) % arr.length
  return arr[i]
}

const f2 = (n: number): string => n.toFixed(2)

/**
 * Escapes commas so an expression can be embedded in an ffmpeg lavfi graph without
 * the parser mistaking `mod(t,x)` / `between(...)` commas for filter separators.
 */
export function escapeExprCommas(expr: string): string {
  return expr.replace(/,/g, '\\,')
}

interface MusicPlan {
  /** The `aevalsrc` value expression. */
  expr: string
  /** Length of one progression cycle in seconds. */
  cycleSec: number
  spec: MoodSpec
}

/**
 * Builds the `aevalsrc` expression for a mood. Sums a chord pad (soft hump envelope
 * per chord), a sustained bass an octave down, and a 4-step arpeggio whose order is
 * chosen by the seed. Amplitudes are kept low so the mix never clips.
 */
export function buildMusicExpr(mood: Mood, seed: number): MusicPlan {
  const spec = MOOD_SPECS[mood]
  const { root, progression, chordDur } = spec
  const cycleSec = progression.length * chordDur
  const arpOrders = [[0, 1, 2, 1], [0, 2, 1, 2], [2, 1, 0, 1], [0, 1, 2, 0]]
  const arpOrder = pick(arpOrders, seed)

  const terms: string[] = []
  progression.forEach(([offset, quality], ci) => {
    const start = ci * chordDur
    const end = start + chordDur
    const active = `between(mod(t,${f2(cycleSec)}),${f2(start)},${f2(end)})`
    const local = `(mod(t,${f2(cycleSec)})-${f2(start)})` // 0..chordDur within this chord
    // Soft swell envelope for the pad: sin hump over the chord window.
    const padEnv = `sin(PI*${local}/${f2(chordDur)})`
    const notes = CHORD[quality].map((s) => noteToFreq(root + offset + s))

    // Pad: chord tones at low amplitude, gated to this chord's window.
    notes.forEach((freq) => {
      terms.push(`${active}*${padEnv}*0.10*sin(2*PI*${f2(freq)}*t)`)
    })
    // Bass: root one octave down, gently sustained.
    const bass = noteToFreq(root + offset - 12)
    terms.push(`${active}*0.14*sin(2*PI*${f2(bass)}*t)`)

    // Arpeggio: 4 plucks across the chord window, note order from the seed, each with
    // a fast decay envelope so it reads as a pluck.
    const stepDur = chordDur / 4
    arpOrder.forEach((noteIdx, si) => {
      const s0 = start + si * stepDur
      const s1 = s0 + stepDur
      const stepActive = `between(mod(t,${f2(cycleSec)}),${f2(s0)},${f2(s1)})`
      const stepLocal = `(mod(t,${f2(cycleSec)})-${f2(s0)})`
      const decay = `exp(-4*${stepLocal})`
      const af = noteToFreq(root + offset + CHORD[quality][noteIdx % CHORD[quality].length] + 12)
      terms.push(`${stepActive}*${decay}*0.08*sin(2*PI*${f2(af)}*t)`)
    })
  })

  return { expr: terms.join('+'), cycleSec, spec }
}

export interface SynthSpec {
  /** lavfi input spec (goes after `-f lavfi -i`). */
  src: string
  /** post-processing filter chain for `-af`. */
  af: string
  durationSec: number
}

/**
 * Full music synth spec for a mood at a given duration. The bed loops via the
 * bounded cycle expression; the post chain adds tremolo, warmth (lowpass), space
 * (aecho), fades, and a safety limiter so output is clean and non-clipping.
 */
export function buildMusicFilter(mood: Mood, durationSec: number, seed: number): SynthSpec {
  const dur = Math.max(1, durationSec)
  const { expr, spec } = buildMusicExpr(mood, seed)
  const fadeOut = Math.max(0.1, dur - 2.5)
  const echo = spec.space > 0
    ? `,aecho=0.8:0.9:${Math.round(60 + spec.space * 120)}:${f2(spec.space * 0.5)}`
    : ''
  const af =
    `tremolo=f=${f2(spec.tremRate)}:d=${f2(spec.tremDepth)}` +
    `,lowpass=f=${Math.round(spec.cutoff)}` +
    echo +
    `,afade=t=in:st=0:d=1.5,afade=t=out:st=${f2(fadeOut)}:d=2.5` +
    `,alimiter=limit=0.95:level=disabled`
  // Commas inside the expression (from mod()/between()) would be read as filter
  // separators by the lavfi graph parser, so escape them with a backslash.
  return { src: `aevalsrc=exprs=${escapeExprCommas(expr)}:s=44100:d=${f2(dur)}`, af, durationSec: dur }
}

/** Short, deterministic sound effect specs, one per kind. */
export function buildSfxFilter(kind: SfxKind): SynthSpec {
  switch (kind) {
    case 'whoosh':
      return {
        src: 'anoisesrc=d=0.6:c=pink:r=44100:a=0.9',
        af: 'afade=t=in:d=0.05,afade=t=out:st=0.35:d=0.25,bandpass=f=1200:width_type=h:w=1600,volume=0.9',
        durationSec: 0.6
      }
    case 'riser':
      // Frequency-rising tone (phase not exact but reads as a riser) + noise + long fade-in.
      return {
        src: 'aevalsrc=exprs=0.3*sin(2*PI*(200+700*t)*t)+0.15*random(0):s=44100:d=1.5',
        af: 'afade=t=in:d=1.3,afade=t=out:st=1.35:d=0.15,highpass=f=200,volume=0.9',
        durationSec: 1.5
      }
    case 'impact':
      return {
        src: 'aevalsrc=exprs=0.9*exp(-8*t)*sin(2*PI*60*t)+0.25*exp(-30*t)*random(0):s=44100:d=0.7',
        af: 'lowpass=f=800,afade=t=out:st=0.5:d=0.2,volume=1.0',
        durationSec: 0.7
      }
    case 'click':
      return {
        src: 'anoisesrc=d=0.05:c=white:r=44100:a=0.7',
        af: 'afade=t=out:st=0.01:d=0.04,highpass=f=2000,volume=0.7',
        durationSec: 0.05
      }
    case 'pop':
      return {
        src: 'aevalsrc=exprs=0.6*exp(-20*t)*sin(2*PI*820*t):s=44100:d=0.25',
        af: 'afade=t=out:st=0.15:d=0.1,volume=0.9',
        durationSec: 0.25
      }
    case 'swell':
      return {
        src: 'aevalsrc=exprs=0.3*sin(2*PI*220*t)+0.2*sin(2*PI*330*t)+0.15*sin(2*PI*440*t):s=44100:d=2.5',
        af: 'afade=t=in:d=1.8,afade=t=out:st=2.0:d=0.5,lowpass=f=2000,volume=0.9',
        durationSec: 2.5
      }
    case 'subdrop':
      return {
        src: 'aevalsrc=exprs=0.9*exp(-2*t)*sin(2*PI*(120-70*t)*t):s=44100:d=1.2',
        af: 'lowpass=f=400,afade=t=out:st=1.0:d=0.2,volume=1.0',
        durationSec: 1.2
      }
    default: {
      const _never: never = kind
      throw new Error(`Unknown SFX kind: ${String(_never)}`)
    }
  }
}
