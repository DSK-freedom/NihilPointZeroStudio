/**
 * Presenter planner — the PURE, unit-tested brain of the three "Presenter" modes. It turns
 * a script into a StoryboardDoc where the on-camera "you" beats are interleaved with theme
 * B-roll / AI-scene beats, so the video reads as "he's live, then relevant cutaways", voice
 * throughout. The heavy lifting (image gen, Pixabay b-roll, render) is the already-verified
 * Storyboard engine (./storyboard, ./storyboardRender); this only decides the beat
 * breakdown, the timing, and which beats are the presenter.
 *
 *   • 'video' — REAL-VOICE mode: your uploaded narration video is the master audio (your
 *               actual voice), beats are timed to fill it, presenter beats show your real
 *               footage (subject.kind='clip'), the rest are B-roll/AI. No TTS.
 *   • 'photo' — your still photo with subtle motion on presenter beats; narration is spoken
 *               by the natural voice (TTS), beats sized to the narration.
 *   • 'graft' — like 'video' but presenter beats are flagged for an OPTIONAL local lip-graft
 *               tool; if that tool isn't installed it degrades to your real clip.
 *
 * Non-presenter beats are subject.kind='none' → theme B-roll (Pixabay) or an AI scene image.
 */
import type { BeatSound, ShotMotion, ShotSubject, StoryboardBeat, StoryboardDoc, VideoStyle } from '../../shared/types'

export type PresenterMode = 'video' | 'photo' | 'graft'

const WPS = 2.5 // words/second of speech, to size TTS beats
const MIN_BEAT = 3
const MAX_BEAT = 30
const TARGET_BEAT = 15 // ~15s cutaways when filling a fixed-length voice track

const BROLL_MOTIONS: ShotMotion[] = ['in', 'left', 'right', 'up']

/** Splits a script into beats: its descriptive [visual] blocks if it has several, else
 *  ~2-sentence chunks (mirrors Scene Studio so the two behave consistently). */
export function splitScriptBeats(body: string): { narration: string; visual?: string }[] {
  const visualBlocks = [...body.matchAll(/\[([^\]]{20,600})\]/g)].map((m) => m[1].replace(/\s+/g, ' ').trim())
  if (visualBlocks.length >= 4) {
    const parts = body.split(/\[[^\]]{20,600}\]/).map((s) => s.replace(/\s+/g, ' ').trim())
    return visualBlocks.map((visual, i) => ({ visual, narration: (parts[i + 1] || parts[i] || visual).slice(0, 600) }))
  }
  const clean = body
    .replace(/^\s*#{1,6}.*$/gm, ' ')
    .replace(/\*\*/g, '')
    .replace(/\[[^\]]*\]/g, ' ')
    .replace(/^\s*\d+\.\s+/gm, ' ')
    .replace(/\s+/g, ' ')
    .trim()
  const sentences = clean.split(/(?<=[.!?])\s+/).map((s) => s.trim()).filter((s) => s.split(' ').length >= 4)
  const beats: { narration: string }[] = []
  for (let i = 0; i < sentences.length; i += 2) beats.push({ narration: sentences.slice(i, i + 2).join(' ') })
  return beats.length ? beats : [{ narration: clean || 'Presenter video' }]
}

function clamp(n: number, lo: number, hi: number): number {
  return Math.min(Math.max(n, lo), hi)
}

function subjectFor(mode: PresenterMode, isPresenter: boolean, presenterSrc?: string): ShotSubject {
  if (!isPresenter) return { kind: 'none' } // B-roll / AI scene
  if (mode === 'photo') return { kind: 'photo', beautify: true }
  if (mode === 'graft') return { kind: 'clip', src: presenterSrc, description: 'lip-graft' }
  return { kind: 'clip', src: presenterSrc }
}

/**
 * Builds a presenter StoryboardDoc.
 *  - `everyN`: cadence — beat 0 is the presenter (so viewers see "you" immediately), then a
 *    presenter beat recurs every `everyN` beats; the rest are B-roll/AI.
 *  - `voiceTrackSeconds` + `masterAudioSrc` (video/graft): fill the timeline to the length of
 *    YOUR uploaded video, drop TTS, and lay your real voice as one master audio track.
 *  - otherwise (photo): beats are sized to their narration and spoken by the natural voice.
 * Pure + unit-tested — no network, no fs.
 */
export function planPresenterStoryboard(params: {
  title: string
  body: string
  mode: PresenterMode
  style?: VideoStyle
  everyN?: number
  presenterSrc?: string
  /** Length of the user's narration video (video/graft real-voice mode). */
  voiceTrackSeconds?: number
  /** Path to the user's extracted narration audio (its real voice). */
  masterAudioSrc?: string
  width?: number
  height?: number
  fps?: number
  language?: string
}): StoryboardDoc {
  const { title, body, mode, presenterSrc } = params
  const everyN = Math.max(2, params.everyN ?? 4)
  const templates = splitScriptBeats(body)
  const realVoice = (mode === 'video' || mode === 'graft') && !!params.voiceTrackSeconds && params.voiceTrackSeconds > 0

  let beats: StoryboardBeat[]
  if (realVoice) {
    // Fill the whole voice track with ~TARGET_BEAT cutaways; visuals cycle through the
    // script's beats; NO TTS (the master audio below is your real voice).
    const total = params.voiceTrackSeconds as number
    const count = Math.max(templates.length, Math.round(total / TARGET_BEAT))
    const per = clamp(total / count, MIN_BEAT, MAX_BEAT)
    beats = Array.from({ length: count }, (_, i) => {
      const tpl = templates[i % templates.length]
      const isPresenter = i === 0 || i % everyN === 0
      return {
        id: `p-${i + 1}`,
        durationSec: per,
        visual: tpl.visual ?? tpl.narration.slice(0, 200),
        narration: undefined, // real voice comes from the master track, not TTS
        subject: subjectFor(mode, isPresenter, presenterSrc),
        transitionSec: i === 0 ? 0 : 0.5,
        motion: isPresenter ? 'in' : BROLL_MOTIONS[i % BROLL_MOTIONS.length],
        sounds: []
      }
    })
    if (params.masterAudioSrc) {
      const master: BeatSound = { id: 'master-voice', kind: 'file', src: params.masterAudioSrc, atSec: 0, gain: 1, fadeInSec: 0, fadeOutSec: 0 }
      beats[0].sounds = [master]
    }
  } else {
    // Photo mode (or no video supplied): TTS narration, beats sized to the words.
    beats = templates.map((tpl, i) => {
      const isPresenter = i === 0 || i % everyN === 0
      const words = tpl.narration.trim().split(/\s+/).filter(Boolean).length
      return {
        id: `p-${i + 1}`,
        durationSec: clamp(Math.round(words / WPS), MIN_BEAT, MAX_BEAT),
        visual: tpl.visual ?? tpl.narration.slice(0, 200),
        narration: tpl.narration,
        subject: subjectFor(mode, isPresenter, presenterSrc),
        transitionSec: i === 0 ? 0 : 0.6,
        motion: isPresenter ? 'in' : BROLL_MOTIONS[i % BROLL_MOTIONS.length],
        sounds: []
      }
    })
  }

  return {
    title: title || 'Presenter video',
    style: params.style ?? 'cinematic',
    width: params.width ?? 1920,
    height: params.height ?? 1080,
    fps: params.fps ?? 25,
    language: params.language,
    beats
  }
}
