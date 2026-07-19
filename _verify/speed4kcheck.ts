/* Demonstrates the hardware win where it matters: a 4K clip. Renders the same 4K
 * video on CPU vs the probed hardware encoder and compares wall-clock time. */
import { mkdtempSync, existsSync, statSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { buildVideoEncoderArgs, encoderLabel, isHardware, probeBestH264Encoder } from '../src/main/video/encoder'
import { runFfmpeg } from '../src/main/video/ffmpeg'

async function render(encoder: string, out: string): Promise<number> {
  const start = process.hrtime.bigint()
  await runFfmpeg([
    '-y', '-f', 'lavfi', '-i', 'testsrc2=size=3840x2160:rate=30:duration=8',
    ...buildVideoEncoderArgs(encoder), '-r', '30', out
  ])
  return Number(process.hrtime.bigint() - start) / 1e9
}

async function main(): Promise<void> {
  const d = mkdtempSync(join(tmpdir(), 'speed4k-'))
  const best = await probeBestH264Encoder()
  console.log(`Hardware encoder: ${best} (${encoderLabel(best)})`)
  if (!isHardware(best)) { console.log('No hardware encoder here; skipping comparison. RESULT: SKIPPED'); process.exit(0) }

  const cpu = join(d, 'cpu.mp4'); const tCpu = await render('libx264', cpu)
  const hw = join(d, 'hw.mp4'); const tHw = await render(best, hw)
  console.log(`4K libx264 (CPU): ${tCpu.toFixed(2)}s`)
  console.log(`4K ${best}:  ${tHw.toFixed(2)}s`)
  console.log(`Speed-up at 4K: ${(tCpu / tHw).toFixed(1)}x`)
  const ok = existsSync(cpu) && existsSync(hw) && statSync(hw).size > 0
  console.log('RESULT:', ok ? 'OK' : 'FAILED')
  process.exit(ok ? 0 : 1)
}
main().catch((e) => { console.error(e); process.exit(1) })
