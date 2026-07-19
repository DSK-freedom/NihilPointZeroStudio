/* Headless verification of the Phase 5 DJ remix: make a 5s video, generate a music
 * bed + an SFX, place them on a timeline, remix onto the video, and ffprobe that the
 * result still has both streams and the right duration. */
import { mkdtempSync, existsSync, statSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { spawnSync } from 'child_process'
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
  const d = mkdtempSync(join(tmpdir(), 'remixcheck-'))
  const vid = join(d, 'vid.mp4')
  const music = join(d, 'music.mp3')
  const sfx = join(d, 'sfx.mp3')

  await runFfmpeg([
    '-y', '-f', 'lavfi', '-i', 'testsrc=size=320x240:rate=25:duration=5',
    '-f', 'lavfi', '-i', 'sine=frequency=330:duration=5',
    '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-shortest', vid
  ])
  await runFfmpeg(synthArgs(buildMusicFilter('calm', 5, 1), music))
  await runFfmpeg(synthArgs(buildSfxFilter('impact'), sfx))

  const clips: AudioClip[] = [
    { id: '1', src: music, label: 'calm', atSec: 0, gain: 0.25, fadeIn: 1, fadeOut: 1.5 },
    { id: '2', src: sfx, label: 'impact', atSec: 2, gain: 0.9, fadeIn: 0, fadeOut: 0 }
  ]
  const plan = buildTimelineFilter(clips, '0:a')

  const out = join(d, 'mixed.mp4')
  const args = ['-y', '-i', vid]
  for (const s of plan.clipInputs) args.push('-i', s)
  args.push('-filter_complex', plan.chains.join(';'), '-map', '0:v', '-map', plan.audioMap,
    '-c:v', 'copy', '-c:a', 'aac', '-b:a', '192k', '-movflags', '+faststart', out)
  await runFfmpeg(args)

  const dur = parseFloat(probe(out, 'format=duration').replace(/[^0-9.]/g, ''))
  const streams = probe(out, 'stream=codec_type')
  const ok = existsSync(out) && statSync(out).size > 0 && streams.includes('video') && streams.includes('audio') && Math.abs(dur - 5) < 0.6
  console.log(`clip inputs: ${plan.clipInputs.length}`)
  console.log(`mixed dur=${dur.toFixed(2)}s streams=[${streams}] size=${statSync(out).size}b`)
  console.log('\nRESULT:', ok ? 'REMIX OK' : 'REMIX FAILED')
  process.exit(ok ? 0 : 1)
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
