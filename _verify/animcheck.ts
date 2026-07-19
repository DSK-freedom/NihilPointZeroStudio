/* Verifies the animated-gradient background renders end-to-end: build a short video
 * with the default (now animated) background via the REAL renderVideo, and ffprobe
 * that a valid 1080p H.264 video came out. */
import { mkdtempSync, existsSync, statSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { spawnSync } from 'child_process'
import { renderVideo } from '../src/main/video/render'
import { ffprobePath, runFfmpeg } from '../src/main/video/ffmpeg'

function probe(file: string): string {
  const r = spawnSync(ffprobePath, ['-v', 'error', '-select_streams', 'v:0', '-show_entries', 'stream=codec_name,width,height', '-of', 'default=nw=1', file])
  return r.stdout.toString().replace(/\s+/g, ' ').trim()
}

async function main(): Promise<void> {
  const d = mkdtempSync(join(tmpdir(), 'animcheck-'))
  const wav = join(d, 'n.wav')
  await runFfmpeg(['-y', '-f', 'lavfi', '-i', 'sine=frequency=220:duration=4', wav])
  const out = join(d, 'anim.mp4')
  // No images => default animated gradient background.
  await renderVideo({ title: 'Motion Test', body: 'Intro.\n[HOOK]\nBig idea.\n[PROOF]\nEvidence.', audioPath: wav, durationSec: 4, outPath: out, resolution: '1080p', style: 'cinematic' })
  const info = probe(out)
  const ok = existsSync(out) && statSync(out).size > 0 && /width=1920/.test(info) && /height=1080/.test(info) && /h264/.test(info)
  console.log(`animated-bg video: [${info}] ${statSync(out).size}b`)
  console.log('RESULT:', ok ? 'ANIMATED BG OK' : 'ANIMATED BG FAILED')
  process.exit(ok ? 0 : 1)
}

main().catch((e) => { console.error(e); process.exit(1) })
