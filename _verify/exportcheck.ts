/* Headless verification of the Phase 2 export pipeline: build a tiny test video,
 * transcode it to every EXPORT_FORMATS entry using the REAL buildExportArgs, then
 * ffprobe each output and assert a valid stream was produced. */
import { mkdtempSync, existsSync, statSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { spawnSync } from 'child_process'
import { EXPORT_FORMATS } from '../src/shared/types'
import { buildExportArgs, formatExtension } from '../src/main/video/export'
import { ffmpegPath, ffprobePath, runFfmpeg } from '../src/main/video/ffmpeg'

function probe(file: string): string {
  const r = spawnSync(ffprobePath, [
    '-v', 'error', '-show_entries', 'stream=codec_name,codec_type', '-of', 'default=nw=1', file
  ])
  return r.stdout.toString().replace(/\s+/g, ' ').trim()
}

async function main(): Promise<void> {
  const dir = mkdtempSync(join(tmpdir(), 'exportcheck-'))
  const src = join(dir, 'src.mp4')
  await runFfmpeg([
    '-y', '-f', 'lavfi', '-i', 'color=c=blue:s=320x240:d=2',
    '-f', 'lavfi', '-i', 'sine=frequency=440:duration=2',
    '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-shortest', src
  ])
  console.log('ffmpeg:', ffmpegPath)
  console.log('input made:', existsSync(src), statSync(src).size, 'bytes\n')

  let allOk = true
  for (const f of EXPORT_FORMATS) {
    const out = join(dir, `out-${f.id}.${formatExtension(f.id)}`)
    try {
      await runFfmpeg(buildExportArgs(f.id, src, out))
      const size = existsSync(out) ? statSync(out).size : 0
      const ok = size > 0 && /codec_type=video/.test(probe(out))
      allOk = allOk && ok
      console.log(`${ok ? 'OK ' : 'FAIL'} ${f.id.padEnd(10)} ${size.toString().padStart(7)}b  [${probe(out)}]`)
    } catch (e) {
      allOk = false
      console.log(`FAIL ${f.id} -> ${(e as Error).message.slice(0, 140)}`)
    }
  }
  console.log('\nRESULT:', allOk ? 'ALL FORMATS OK' : 'SOME FORMATS FAILED')
  process.exit(allOk ? 0 : 1)
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
