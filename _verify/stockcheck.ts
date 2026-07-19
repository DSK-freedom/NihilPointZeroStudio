/* End-to-end verification of the free stock-footage engine: search Pixabay for real
 * B-roll matching a finance script's sections, download clips, assemble them into a
 * background, and render the full narrated video on top — then ffprobe the result.
 * Pass the API key as argv[2]. */
import { mkdtempSync, existsSync, statSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { spawnSync } from 'child_process'
import { computeLayout, renderVideo } from '../src/main/video/render'
import { buildStockBackground } from '../src/main/video/stockBackground'
import { ffprobePath, runFfmpeg } from '../src/main/video/ffmpeg'

function probe(file: string): string {
  const r = spawnSync(ffprobePath, ['-v', 'error', '-select_streams', 'v:0', '-show_entries', 'stream=codec_name,width,height', '-of', 'default=nw=1', file])
  return r.stdout.toString().replace(/\s+/g, ' ').trim()
}

async function main(): Promise<void> {
  const key = process.argv[2]
  if (!key) { console.log('no key'); process.exit(1) }
  const d = mkdtempSync(join(tmpdir(), 'stockcheck-'))
  const wav = join(d, 'n.wav')
  await runFfmpeg(['-y', '-f', 'lavfi', '-i', 'sine=frequency=220:duration=12', wav])

  const title = 'Stock Market Crash'
  const body = 'Welcome.\n[STOCK MARKET]\nThe indices are moving.\n[OIL PRICES]\nEnergy shifts.\n[GOLD]\nSafe havens rally.'
  const layout = computeLayout('1080p')

  console.log('--- assembling stock background ---')
  const bg = await buildStockBackground({ title, body, layout, durationSec: 12, apiKey: key, onProgress: (s) => console.log('  ', s) })
  console.log('stock bg:', existsSync(bg), statSync(bg).size, 'bytes  [', probe(bg), ']')

  console.log('--- rendering full video over the footage ---')
  const out = join(d, 'final.mp4')
  await renderVideo({ title, body, audioPath: wav, durationSec: 12, outPath: out, resolution: '1080p', style: 'cinematic', backgroundVideo: bg })
  const info = probe(out)
  const ok = existsSync(out) && statSync(out).size > 0 && /width=1920/.test(info) && /height=1080/.test(info) && /h264/.test(info)
  console.log('final video:', `[${info}]`, statSync(out).size, 'bytes')
  console.log('RESULT:', ok ? 'STOCK ENGINE OK' : 'STOCK ENGINE FAILED')
  process.exit(ok ? 0 : 1)
}

main().catch((e) => { console.error(e); process.exit(1) })
