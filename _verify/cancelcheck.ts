/* Verifies the Stop/Cancel path: start a deliberately long ffmpeg render, cancel it
 * mid-flight via cancelActiveFfmpeg(), and confirm the run rejects with the cancel
 * marker (not a normal error) and the process is gone. */
import { CANCELLED_MESSAGE, cancelActiveFfmpeg, runFfmpeg } from '../src/main/video/ffmpeg'
import { join } from 'path'
import { tmpdir } from 'os'
import { mkdtempSync } from 'fs'

async function main(): Promise<void> {
  const out = join(mkdtempSync(join(tmpdir(), 'cancelcheck-')), 'long.mp4')
  // A 60s 1080p render — plenty of time to cancel it.
  const p = runFfmpeg([
    '-y', '-f', 'lavfi', '-i', 'testsrc=size=1920x1080:rate=30:duration=60',
    '-c:v', 'libx264', '-preset', 'veryfast', '-pix_fmt', 'yuv420p', out
  ])

  let rejected: Error | null = null
  p.catch((e: Error) => { rejected = e })

  // Let it start, then cancel.
  await new Promise((r) => setTimeout(r, 1500))
  const killed = cancelActiveFfmpeg()
  console.log(`cancelActiveFfmpeg killed: ${killed} process(es)`)

  // Wait for the run promise to settle.
  await new Promise((r) => setTimeout(r, 1500))

  const ok = killed === 1 && rejected !== null && (rejected as Error).message === CANCELLED_MESSAGE
  console.log(`rejected with: ${rejected ? (rejected as Error).message : '(still running!)'}`)
  console.log('RESULT:', ok ? 'CANCEL OK' : 'CANCEL FAILED')
  process.exit(ok ? 0 : 1)
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
