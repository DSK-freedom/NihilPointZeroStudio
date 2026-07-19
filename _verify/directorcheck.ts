/* Verifies the AI Director's EXECUTION ORCHESTRATION end-to-end without electron:
 * it mirrors executeActions() exactly for the plan [remove 2-4s, add calm music@0,
 * add impact SFX@1s] using the same electron-free builders the engine calls
 * (trim -> generate music/sfx -> remix), then ffprobes the result. The individual
 * ops (trim, music, sfx, remix) are each already verified in the other harnesses. */
import { mkdtempSync, existsSync, statSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { spawnSync } from 'child_process'
import { buildTrimArgs, clampRange } from '../src/main/video/trim'
import { buildMusicFilter, buildSfxFilter, type SynthSpec } from '../src/main/audio/compose'
import { buildTimelineFilter } from '../src/main/audio/mixplan'
import { ffprobePath, runFfmpeg } from '../src/main/video/ffmpeg'
import type { AudioClip } from '../src/shared/types'

function synthArgs(spec: SynthSpec, out: string): string[] {
  return ['-y', '-f', 'lavfi', '-i', spec.src, '-af', spec.af, '-c:a', 'libmp3lame', '-q:a', '4', out]
}
function probe(file: string, entries: string): string {
  const r = spawnSync(ffprobePath, ['-v', 'error', '-show_entries', entries, '-of', 'default=nw=1', file])
  return r.stdout.toString().replace(/\s+/g, ' ').trim()
}

async function main(): Promise<void> {
  const d = mkdtempSync(join(tmpdir(), 'directorcheck-'))
  const src = join(d, 'src.mp4')
  await runFfmpeg([
    '-y', '-f', 'lavfi', '-i', 'testsrc=size=320x240:rate=25:duration=6',
    '-f', 'lavfi', '-i', 'sine=frequency=330:duration=6',
    '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-shortest', src
  ])

  // STEP 1 (trims first, in order): remove 2s-4s from a 6s clip -> ~4s.
  const trimmed = join(d, 'cut0.mp4')
  await runFfmpeg(buildTrimArgs('remove', src, clampRange(2, 4, 6), 6, trimmed))

  // STEP 2 (generate sounds): calm music + impact SFX.
  const music = join(d, 'music.mp3')
  const sfx = join(d, 'sfx.mp3')
  await runFfmpeg(synthArgs(buildMusicFilter('calm', 4, 1), music))
  await runFfmpeg(synthArgs(buildSfxFilter('impact'), sfx))

  // STEP 3 (layer as one remix over the trimmed video).
  const clips: AudioClip[] = [
    { id: 'm0', src: music, label: 'calm', atSec: 0, gain: 0.25, fadeIn: 1, fadeOut: 1.5 },
    { id: 's0', src: sfx, label: 'impact', atSec: 1, gain: 0.8, fadeIn: 0, fadeOut: 0 }
  ]
  const plan = buildTimelineFilter(clips, '0:a')
  const final = join(d, 'final.mp4')
  const args = ['-y', '-i', trimmed]
  for (const s of plan.clipInputs) args.push('-i', s)
  args.push('-filter_complex', plan.chains.join(';'), '-map', '0:v', '-map', plan.audioMap,
    '-c:v', 'copy', '-c:a', 'aac', '-b:a', '192k', '-movflags', '+faststart', final)
  await runFfmpeg(args)

  const dur = parseFloat(probe(final, 'format=duration').replace(/[^0-9.]/g, ''))
  const streams = probe(final, 'stream=codec_type')
  const ok = existsSync(final) && statSync(final).size > 0 && streams.includes('video') && streams.includes('audio') && Math.abs(dur - 4) < 0.6
  console.log(`final dur=${dur.toFixed(2)}s streams=[${streams}] size=${statSync(final).size}b`)
  console.log('RESULT:', ok ? 'DIRECTOR EXECUTION OK' : 'DIRECTOR EXECUTION FAILED')
  process.exit(ok ? 0 : 1)
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
