/**
 * The AI Director: turns a plain-English instruction into structured edits and runs
 * them through the ALREADY-VERIFIED engine (trim / music / SFX / remix). The AI only
 * decides WHAT to do (a small, validated action list); the tested code does the HOW,
 * so the model can never run arbitrary ffmpeg or touch the filesystem directly.
 *
 * The "brain" is whatever provider is active in Settings — free local Ollama by
 * default, or a paid cloud model when the user switches — via getActiveProvider().
 */
import { getActiveProvider } from '../llm'
import { ffprobeDuration, trimVideo, stitchVideos } from '../video'
import { renderMusic, renderSfx, remixVideoAudio } from '../audio'
import { MOODS, SFX_KINDS, type AudioClip, type DirectorAction, type DirectorInterpretation } from '../../shared/types'

/**
 * Extracts a JSON object from a model reply that may include prose or ```json fences.
 * Pure + unit-tested. Returns null when nothing parseable is found.
 */
/**
 * Repairs the JSON slips small local models make constantly: smart quotes, // and /* *​/
 * comments, and trailing commas. Applied ONLY after a strict parse fails, so it can only
 * turn a would-be failure into a success — never corrupt already-valid JSON.
 */
function lenient(s: string): string {
  return s
    .replace(/[“”]/g, '"')
    .replace(/[‘’]/g, "'")
    .replace(/\/\/[^\n\r]*/g, '')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/,(\s*[}\]])/g, '$1')
}

export function extractJson(text: string): unknown | null {
  if (!text) return null
  // Prefer a fenced ```json block if present.
  const fenced = /```(?:json)?\s*([\s\S]*?)```/i.exec(text)
  const candidates: string[] = []
  if (fenced) candidates.push(fenced[1])
  // Fallback: the substring from the first '{' to the last '}' (object)…
  const firstObj = text.indexOf('{')
  const lastObj = text.lastIndexOf('}')
  if (firstObj !== -1 && lastObj > firstObj) candidates.push(text.slice(firstObj, lastObj + 1))
  // …or the first '[' to the last ']' (a top-level array).
  const firstArr = text.indexOf('[')
  const lastArr = text.lastIndexOf(']')
  if (firstArr !== -1 && lastArr > firstArr) candidates.push(text.slice(firstArr, lastArr + 1))
  for (const c of candidates) {
    const trimmed = c.trim()
    try {
      return JSON.parse(trimmed)
    } catch {
      // Retry once with lenient repair before giving up on this candidate.
      try {
        return JSON.parse(lenient(trimmed))
      } catch {
        /* try next candidate */
      }
    }
  }
  return null
}

/** Clamps a number into [0, max], returning fallback when not finite. */
function clampSec(n: unknown, max: number, fallback = 0): number {
  const v = typeof n === 'number' && Number.isFinite(n) ? n : fallback
  return Math.min(Math.max(v, 0), max)
}

/**
 * Clamps an optional gain into [0, 2] (0 = mute, 1 = unchanged, 2 = +6 dB ceiling).
 * Returns undefined when not a finite number, so a hallucinated `gain` field can
 * never reach the audio engine as a raw value (`volume=40` would blow the mix).
 */
function clampGain(n: unknown): number | undefined {
  if (typeof n !== 'number' || !Number.isFinite(n)) return undefined
  return Math.min(Math.max(n, 0), 2)
}

/**
 * Validates a raw parsed object into a safe DirectorInterpretation. Unknown moods/
 * SFX kinds and out-of-range times are dropped/clamped, so a hallucinated field can
 * never reach the engine. Pure + unit-tested.
 */
export function sanitizeInterpretation(raw: unknown, durationSec: number): DirectorInterpretation {
  const obj = (raw ?? {}) as Record<string, unknown>
  const explanation = typeof obj.explanation === 'string' ? obj.explanation : ''
  const rawActions = Array.isArray(obj.actions) ? obj.actions : []
  const actions: DirectorAction[] = []
  for (const a of rawActions) {
    const act = a as Record<string, unknown>
    if (act.type === 'keep' || act.type === 'remove') {
      const start = clampSec(act.startSec, durationSec)
      const end = clampSec(act.endSec, durationSec, durationSec)
      if (end - start >= 0.05) actions.push({ type: act.type, startSec: start, endSec: end })
    } else if (act.type === 'music' && MOODS.includes(act.mood as never)) {
      actions.push({ type: 'music', mood: act.mood as never, atSec: clampSec(act.atSec, durationSec), gain: clampGain(act.gain) })
    } else if (act.type === 'sfx' && SFX_KINDS.includes(act.kind as never)) {
      actions.push({ type: 'sfx', kind: act.kind as never, atSec: clampSec(act.atSec, durationSec), gain: clampGain(act.gain) })
    }
  }
  const kind: 'edit' | 'reply' = actions.length ? 'edit' : 'reply'
  return { kind, explanation: explanation || (kind === 'edit' ? 'Applying your edits.' : 'No edit detected.'), actions }
}

/** Builds the strict system+user prompt that asks the model for a JSON edit plan. */
export function buildDirectorPrompt(instruction: string, durationSec: number): string {
  return [
    'You are the AI Director of a video studio. Turn the user\'s instruction into a JSON edit plan.',
    'You can ONLY use these action types — never invent others:',
    '  {"type":"keep","startSec":N,"endSec":N}     keep only this time range',
    '  {"type":"remove","startSec":N,"endSec":N}   cut out this time range',
    `  {"type":"music","mood":M,"atSec":N,"gain":0.25}   add a music bed (mood M one of: ${MOODS.join(', ')})`,
    `  {"type":"sfx","kind":K,"atSec":N,"gain":0.8}      add a sound effect (kind K one of: ${SFX_KINDS.join(', ')})`,
    `The video is ${durationSec.toFixed(1)} seconds long. All times are in SECONDS from the start.`,
    'Convert phrases like "the first 2 minutes" to seconds (120). Clamp to the video length.',
    'Respond with ONLY a JSON object: {"explanation": "<short plain-English summary>", "actions": [ ... ]}.',
    'If the instruction is a question or has no concrete edit, return an empty actions array and put your answer in explanation.',
    '',
    `USER INSTRUCTION: ${instruction}`,
    '',
    'JSON:'
  ].join('\n')
}

/** Asks the active provider to interpret an instruction against a video's duration. */
export async function interpretInstruction(videoPath: string, instruction: string): Promise<DirectorInterpretation> {
  const durationSec = await ffprobeDuration(videoPath)
  const provider = getActiveProvider()
  const reply = await provider.generateText(buildDirectorPrompt(instruction, durationSec), 700)
  const parsed = extractJson(reply)
  if (parsed == null) {
    // Model didn't return JSON — treat its text as a conversational reply.
    return { kind: 'reply', explanation: reply.trim() || 'I could not read that as an edit. Try rephrasing.', actions: [] }
  }
  return sanitizeInterpretation(parsed, durationSec)
}

/** A half-open time range [start, end) in a video's own coordinates. */
export interface Interval {
  start: number
  end: number
}

/**
 * Resolves an ORDERED list of keep/remove actions into the final set of kept
 * intervals, all expressed in the ORIGINAL video's coordinates.
 *
 * Why this exists: applying trims one at a time to the shrinking output is wrong.
 * After the first cut, every later action's timestamps still refer to the ORIGINAL
 * timeline, but the footage has shifted — so "remove 50–60s" would delete the wrong
 * ten seconds. Resolving all actions against [0, duration] first, then doing a
 * single extract+concat pass, is the only correct approach. Pure + unit-tested.
 */
export function resolveKeptIntervals(
  actions: Array<{ type: 'keep' | 'remove'; startSec: number; endSec: number }>,
  duration: number
): Interval[] {
  let kept: Interval[] = [{ start: 0, end: Math.max(0, duration) }]
  for (const a of actions) {
    const s = Math.max(0, Math.min(a.startSec, duration))
    const e = Math.max(0, Math.min(a.endSec, duration))
    if (e <= s) continue
    if (a.type === 'keep') {
      // Intersect every surviving interval with [s, e].
      kept = kept
        .map((iv) => ({ start: Math.max(iv.start, s), end: Math.min(iv.end, e) }))
        .filter((iv) => iv.end - iv.start >= 0.05)
    } else {
      // Subtract [s, e] from every surviving interval (may split one into two).
      const next: Interval[] = []
      for (const iv of kept) {
        if (e <= iv.start || s >= iv.end) {
          next.push(iv) // no overlap
          continue
        }
        if (s > iv.start) next.push({ start: iv.start, end: s }) // left remainder
        if (e < iv.end) next.push({ start: e, end: iv.end }) // right remainder
      }
      kept = next.filter((iv) => iv.end - iv.start >= 0.05)
    }
  }
  // Sort + merge touching/overlapping intervals so the concat has no seams.
  kept.sort((x, y) => x.start - y.start)
  const merged: Interval[] = []
  for (const iv of kept) {
    const last = merged[merged.length - 1]
    if (last && iv.start - last.end < 0.001) last.end = Math.max(last.end, iv.end)
    else merged.push({ ...iv })
  }
  return merged
}

/**
 * Executes a validated action list on a video and returns the final output path.
 * Trims are resolved first (structure), then music/SFX are layered as one remix
 * over the trimmed video, matching how a human would edit.
 *
 * A single trim uses the proven single-range trim path unchanged. TWO OR MORE
 * trims are resolved against the original timeline (see resolveKeptIntervals) and
 * rebuilt with one extract-per-segment + concat pass, so later cuts never act on
 * stale coordinates.
 */
export async function executeActions(
  videoPath: string,
  actions: DirectorAction[],
  makeOutPath: (tag: string) => string,
  onProgress?: (stage: string) => void
): Promise<string> {
  let current = videoPath

  const trims = actions.filter((a): a is Extract<DirectorAction, { type: 'keep' | 'remove' }> => a.type === 'keep' || a.type === 'remove')
  if (trims.length === 1) {
    const t = trims[0]
    onProgress?.(`Cutting (${t.type}) ${t.startSec.toFixed(1)}s–${t.endSec.toFixed(1)}s…`)
    const out = makeOutPath('cut0')
    await trimVideo(current, t.type, t.startSec, t.endSec, out)
    current = out
  } else if (trims.length > 1) {
    const duration = await ffprobeDuration(videoPath)
    const intervals = resolveKeptIntervals(trims, duration)
    const isFullVideo =
      intervals.length === 1 && intervals[0].start <= 0.001 && intervals[0].end >= duration - 0.001
    if (intervals.length === 0) {
      onProgress?.('Those cuts would remove the whole video — leaving it uncut.')
    } else if (!isFullVideo) {
      if (intervals.length === 1) {
        const iv = intervals[0]
        onProgress?.(`Trimming to ${iv.start.toFixed(1)}s–${iv.end.toFixed(1)}s…`)
        const out = makeOutPath('cut0')
        await trimVideo(videoPath, 'keep', iv.start, iv.end, out)
        current = out
      } else {
        const parts: string[] = []
        for (let i = 0; i < intervals.length; i++) {
          const iv = intervals[i]
          onProgress?.(`Extracting segment ${i + 1}/${intervals.length} (${iv.start.toFixed(1)}s–${iv.end.toFixed(1)}s)…`)
          const part = makeOutPath(`seg${i}`)
          await trimVideo(videoPath, 'keep', iv.start, iv.end, part)
          parts.push(part)
        }
        onProgress?.('Joining the kept segments…')
        const out = makeOutPath('joined')
        await stitchVideos(parts, out)
        current = out
      }
    }
  }

  const sounds = actions.filter((a): a is Extract<DirectorAction, { type: 'music' | 'sfx' }> => a.type === 'music' || a.type === 'sfx')
  if (sounds.length) {
    onProgress?.('Generating and layering sounds…')
    const clips: AudioClip[] = []
    for (let i = 0; i < sounds.length; i++) {
      const s = sounds[i]
      if (s.type === 'music') {
        const src = await renderMusic(s.mood, 24, 1)
        clips.push({ id: `m${i}`, src, label: s.mood, atSec: s.atSec, gain: s.gain ?? 0.25, fadeIn: 1, fadeOut: 1.5 })
      } else {
        const src = await renderSfx(s.kind)
        clips.push({ id: `s${i}`, src, label: s.kind, atSec: s.atSec, gain: s.gain ?? 0.8, fadeIn: 0, fadeOut: 0 })
      }
    }
    onProgress?.('Mixing the final audio…')
    const out = makeOutPath('mix')
    await remixVideoAudio(current, clips, out)
    current = out
  }

  return current
}
