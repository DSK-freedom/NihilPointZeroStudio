/* Headless verification of the Phase 3 trim pipeline: make a 6s clip, then keep a
 * middle range and remove a middle range, ffprobing the durations to confirm the
 * cuts are correct. */
import { mkdtempSync, existsSync, statSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { spawnSync } from 'child_process'
import { buildTrimArgs, clampRange } from '../src/main/video/trim'
import { ffprobePath, runFfmpeg } from '../src/main/video/ffmpeg'

function dur(file: string): number {
  const r = spawnSync(ffprobePath, ['-v', 'error', '-show_entries', 'format=duration', '-of', 'default=nw=1:nk=1', file])
  return parseFloat(r.stdout.toString().trim())
}

async function main(): Promise<void> {
  const d = mkdtempSync(join(tmpdir(), 'trimcheck-'))
  const src = join(d, 'src.mp4')
  await runFfmpeg([
    '-y', '-f', 'lavfi', '-i', 'testsrc=size=320x240:rate=25:duration=6',
    '-f', 'lavfi', '-i', 'sine=frequency=440:duration=6',
    '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-shortest', src
  ])
  const total = dur(src)
  console.log(`source duration ~${total.toFixed(2)}s\n`)

  // keep [1,4] → ~3s
  const keepOut = join(d, 'keep.mp4')
  await runFfmpeg(buildTrimArgs('keep', src, clampRange(1, 4, total), total, keepOut))
  const keepDur = dur(keepOut)
  const keepOk = existsSync(keepOut) && Math.abs(keepDur - 3) < 0.4

  // remove [2,4] from 6s → ~4s
  const remOut = join(d, 'remove.mp4')
  await runFfmpeg(buildTrimArgs('remove', src, clampRange(2, 4, total), total, remOut))
  const remDur = dur(remOut)
  const remOk = existsSync(remOut) && Math.abs(remDur - 4) < 0.5

  console.log(`KEEP  [1,4]  -> ${keepDur.toFixed(2)}s (${statSync(keepOut).size}b)  ${keepOk ? 'OK' : 'FAIL'}`)
  console.log(`REMOVE[2,4]  -> ${remDur.toFixed(2)}s (${statSync(remOut).size}b)  ${remOk ? 'OK' : 'FAIL'}`)
  console.log('\nRESULT:', keepOk && remOk ? 'TRIM OK' : 'TRIM FAILED')
  process.exit(keepOk && remOk ? 0 : 1)
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
