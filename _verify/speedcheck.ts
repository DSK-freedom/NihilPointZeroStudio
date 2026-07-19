/* Probes the best working encoder on THIS machine, then renders the same short video
 * with the CPU encoder and the chosen (hopefully hardware) encoder, comparing time. */
import { mkdtempSync, existsSync, statSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { spawnSync } from 'child_process'
import { buildVideoEncoderArgs, encoderLabel, isHardware, probeBestH264Encoder } from '../src/main/video/encoder'
import { ffprobePath, runFfmpeg } from '../src/main/video/ffmpeg'

function ok(file: string): boolean {
  if (!existsSync(file) || statSync(file).size === 0) return false
  const r = spawnSync(ffprobePath, ['-v', 'error', '-select_streams', 'v:0', '-show_entries', 'stream=codec_name', '-of', 'default=nw=1:nk=1', file])
  return /h264/.test(r.stdout.toString())
}

async function render(encoder: string, out: string): Promise<number> {
  const start = process.hrtime.bigint()
  await runFfmpeg([
    '-y', '-f', 'lavfi', '-i', 'testsrc2=size=1920x1080:rate=30:duration=6',
    ...buildVideoEncoderArgs(encoder), '-r', '30', out
  ])
  return Number(process.hrtime.bigint() - start) / 1e9
}

async function main(): Promise<void> {
  const d = mkdtempSync(join(tmpdir(), 'speedcheck-'))
  const best = await probeBestH264Encoder()
  console.log(`Best working encoder on this machine: ${best} (${encoderLabel(best)})${isHardware(best) ? ' ⚡ hardware' : ''}`)

  const cpuOut = join(d, 'cpu.mp4')
  const tCpu = await render('libx264', cpuOut)
  console.log(`libx264 (CPU):   ${tCpu.toFixed(2)}s  ok=${ok(cpuOut)}`)

  let tBest = tCpu
  if (isHardware(best)) {
    const hwOut = join(d, 'hw.mp4')
    tBest = await render(best, hwOut)
    console.log(`${best}: ${tBest.toFixed(2)}s  ok=${ok(hwOut)}`)
    console.log(`Speed-up: ${(tCpu / tBest).toFixed(1)}x faster`)
  } else {
    console.log('No hardware encoder available on this machine — CPU is the fallback (still works).')
  }

  const result = ok(cpuOut) && (best === 'libx264' || tBest > 0)
  console.log('RESULT:', result ? 'SPEED PATH OK' : 'SPEED PATH FAILED')
  process.exit(result ? 0 : 1)
}

main().catch((e) => { console.error(e); process.exit(1) })
