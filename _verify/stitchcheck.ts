/* Verifies stitching: make two short clips of DIFFERENT resolutions, stitch them via
 * the REAL buildStitchArgs, and ffprobe that the result is one valid video whose
 * duration ≈ the sum. */
import { mkdtempSync, existsSync, statSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { spawnSync } from 'child_process'
import { buildStitchArgs } from '../src/main/video/stitch'
import { buildVideoEncoderArgs } from '../src/main/video/encoder'
import { ffprobePath, runFfmpeg } from '../src/main/video/ffmpeg'

function dur(f: string): number {
  const r = spawnSync(ffprobePath, ['-v', 'error', '-show_entries', 'format=duration', '-of', 'default=nw=1:nk=1', f])
  return parseFloat(r.stdout.toString().trim())
}

async function main(): Promise<void> {
  const d = mkdtempSync(join(tmpdir(), 'stitchcheck-'))
  const a = join(d, 'a.mp4'), b = join(d, 'b.mp4')
  // a: 1080p 3s, b: 720p 2s (different resolutions on purpose).
  await runFfmpeg(['-y', '-f', 'lavfi', '-i', 'testsrc=size=1920x1080:rate=25:duration=3', '-f', 'lavfi', '-i', 'sine=frequency=300:duration=3', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-shortest', a])
  await runFfmpeg(['-y', '-f', 'lavfi', '-i', 'testsrc=size=1280x720:rate=25:duration=2', '-f', 'lavfi', '-i', 'sine=frequency=500:duration=2', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-shortest', b])

  const out = join(d, 'joined.mp4')
  await runFfmpeg(buildStitchArgs({ inputs: [a, b], width: 1920, height: 1080, encoderArgs: buildVideoEncoderArgs('libx264'), outPath: out }))
  const total = dur(out)
  const ok = existsSync(out) && statSync(out).size > 0 && Math.abs(total - 5) < 0.7
  console.log(`stitched duration ~${total.toFixed(2)}s (expected ~5s), ${statSync(out).size}b`)
  console.log('RESULT:', ok ? 'STITCH OK' : 'STITCH FAILED')
  process.exit(ok ? 0 : 1)
}
main().catch((e) => { console.error(e); process.exit(1) })
