import { existsSync, statSync, writeFileSync } from 'fs'
import { join } from 'path'
import { runFfmpeg } from '../video/ffmpeg'
import { generatedAudioDir } from '../store'
import {
  buildMusicFilter,
  buildSfxFilter,
  MOODS,
  SFX_KINDS,
  type Mood,
  type SfxKind,
  type SynthSpec
} from './compose'
import { buildTimelineFilter } from './mixplan'
import type { AudioClip } from '../../shared/types'

export { MOODS, SFX_KINDS, type Mood, type SfxKind } from './compose'

/** Builds the ffmpeg args that render a synth spec to an MP3 at `outPath`. */
function synthArgs(spec: SynthSpec, outPath: string): string[] {
  return ['-y', '-f', 'lavfi', '-i', spec.src, '-af', spec.af, '-c:a', 'libmp3lame', '-q:a', '4', outPath]
}

function nonEmpty(path: string): boolean {
  try {
    return existsSync(path) && statSync(path).size > 0
  } catch {
    return false
  }
}

/**
 * Generates a music bed for a mood/duration/seed and returns its file path. Results
 * are cached by (mood, seed, duration) so re-requesting is instant.
 */
export async function renderMusic(mood: Mood, durationSec: number, seed: number): Promise<string> {
  const dur = Math.max(1, Math.round(durationSec))
  const out = join(generatedAudioDir(), `music-${mood}-s${seed}-${dur}s.mp3`)
  if (nonEmpty(out)) return out
  await runFfmpeg(synthArgs(buildMusicFilter(mood, dur, seed), out))
  return out
}

/** Generates a sound effect of the given kind and returns its file path (cached). */
export async function renderSfx(kind: SfxKind): Promise<string> {
  const out = join(generatedAudioDir(), `sfx-${kind}.mp3`)
  if (nonEmpty(out)) return out
  await runFfmpeg(synthArgs(buildSfxFilter(kind), out))
  return out
}

/**
 * Re-mixes a finished video: overlays the DJ-station timeline clips on top of the
 * video's OWN audio (narration) and writes a new file. The video stream is copied
 * (fast, lossless); only audio is re-encoded. Non-destructive.
 */
export async function remixVideoAudio(
  videoPath: string,
  clips: AudioClip[],
  outPath: string,
  onLog?: (line: string) => void
): Promise<void> {
  const plan = buildTimelineFilter(clips, '0:a')
  const args = ['-y', '-i', videoPath]
  for (const src of plan.clipInputs) args.push('-i', src)
  if (plan.chains.length) args.push('-filter_complex', plan.chains.join(';'))
  args.push(
    '-map', '0:v',
    '-map', plan.audioMap,
    '-c:v', 'copy',
    '-c:a', 'aac', '-b:a', '192k',
    '-movflags', '+faststart',
    outPath
  )
  await runFfmpeg(args, onLog)
}

/**
 * Renders the DJ timeline into a STANDALONE audio file (MP3) over silence — "create
 * music only", no video needed. Same clip engine as remixVideoAudio, just mixed onto
 * a silent bed of `durationSec`. Returns nothing; writes `outPath`.
 */
export async function renderMixToAudio(
  clips: AudioClip[],
  durationSec: number,
  outPath: string,
  onLog?: (line: string) => void
): Promise<void> {
  const dur = Math.max(1, durationSec)
  const plan = buildTimelineFilter(clips, '0:a')
  const args = ['-y', '-f', 'lavfi', '-i', `anullsrc=r=44100:cl=stereo:d=${dur.toFixed(2)}`]
  for (const src of plan.clipInputs) args.push('-i', src)
  if (plan.chains.length) args.push('-filter_complex', plan.chains.join(';'))
  args.push('-map', plan.audioMap, '-t', dur.toFixed(2), '-c:a', 'libmp3lame', '-q:a', '2', outPath)
  await runFfmpeg(args, onLog)
}

export interface AudioPackItem {
  id: string
  kind: 'music' | 'sfx'
  label: string
  file: string
  mood?: Mood
  sfx?: SfxKind
}

/**
 * Renders the full bundled "starter pack" into `targetDir` and writes a manifest.
 * Called at build time (resources/audio-pack) so the DJ station is instantly full on
 * first launch, and reusable at runtime to (re)populate the cache. Each mood gets a
 * short loopable bed; every SFX kind is rendered once.
 */
export async function generateStarterPack(targetDir: string): Promise<AudioPackItem[]> {
  const items: AudioPackItem[] = []
  for (const mood of MOODS) {
    const file = join(targetDir, `music-${mood}.mp3`)
    if (!nonEmpty(file)) await runFfmpeg(synthArgs(buildMusicFilter(mood, 24, 1), file))
    items.push({ id: `music-${mood}`, kind: 'music', label: `${mood} bed`, file, mood })
  }
  for (const kind of SFX_KINDS) {
    const file = join(targetDir, `sfx-${kind}.mp3`)
    if (!nonEmpty(file)) await runFfmpeg(synthArgs(buildSfxFilter(kind), file))
    items.push({ id: `sfx-${kind}`, kind: 'sfx', label: `${kind}`, sfx: kind, file })
  }
  writeFileSync(join(targetDir, 'manifest.json'), JSON.stringify(items, null, 2), 'utf-8')
  return items
}
