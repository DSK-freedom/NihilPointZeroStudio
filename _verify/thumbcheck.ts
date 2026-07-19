/* Verifies the thumbnail image generator: render a PNG from a headline using the REAL
 * builders, and ffprobe it to confirm a valid 1280x720 PNG came out. */
import { mkdtempSync, existsSync, statSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { spawnSync } from 'child_process'
import { buildThumbnailArgs, splitHeadline, thumbThemeFor } from '../src/main/video/thumbnail'
import { ffprobePath, runFfmpeg } from '../src/main/video/ffmpeg'
import { writeFileSync } from 'fs'

function probe(file: string): string {
  const r = spawnSync(ffprobePath, ['-v', 'error', '-select_streams', 'v:0', '-show_entries', 'stream=codec_name,width,height', '-of', 'default=nw=1', file])
  return r.stdout.toString().replace(/\s+/g, ' ').trim()
}

async function main(): Promise<void> {
  const d = mkdtempSync(join(tmpdir(), 'thumbcheck-'))
  const lines = splitHeadline('The Greatest Wealth Transfer In History')
  const lineFiles = lines.map((l, i) => {
    const p = join(d, `line${i}.txt`)
    writeFileSync(p, l, 'utf-8')
    return p
  })
  const out = join(d, 'thumb.png')
  await runFfmpeg(buildThumbnailArgs({ lineFiles, theme: thumbThemeFor('neon'), outPath: out }))
  const info = probe(out)
  const ok = existsSync(out) && statSync(out).size > 0 && /width=1280/.test(info) && /height=720/.test(info) && /png/.test(info)
  console.log(`headline lines: ${JSON.stringify(lines)}`)
  console.log(`thumbnail: [${info}] ${statSync(out).size}b`)
  console.log('RESULT:', ok ? 'THUMBNAIL OK' : 'THUMBNAIL FAILED')
  process.exit(ok ? 0 : 1)
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
