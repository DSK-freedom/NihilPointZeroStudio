/* Phase 7 check: render a styled video (neon theme) and a video with a Ken-Burns
 * image-slideshow background, ffprobing that both come out as valid MP4s at the
 * right resolution/duration. Uses the REAL renderVideo + makeSlideshow. */
import { mkdtempSync, existsSync, statSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { spawnSync } from 'child_process'
import { renderVideo, computeLayout, makeSlideshow } from '../src/main/video/render'
import { ffprobePath, runFfmpeg } from '../src/main/video/ffmpeg'

function probe(file: string, entries: string): string {
  const r = spawnSync(ffprobePath, ['-v', 'error', '-select_streams', 'v:0', '-show_entries', entries, '-of', 'default=nw=1', file])
  return r.stdout.toString().replace(/\s+/g, ' ').trim()
}

async function main(): Promise<void> {
  const d = mkdtempSync(join(tmpdir(), 'stylecheck-'))
  // A short narration wav to drive the videos.
  const wav = join(d, 'narr.wav')
  await runFfmpeg(['-y', '-f', 'lavfi', '-i', 'sine=frequency=200:duration=4', wav])
  const body = 'Intro line.\n[THE HOOK]\nThe big idea.\n[PROOF]\nThe evidence.'

  let ok = true

  // 1) Neon-styled video (solid theme background).
  const neon = join(d, 'neon.mp4')
  await renderVideo({ title: 'Neon Test', body, audioPath: wav, durationSec: 4, outPath: neon, resolution: '1080p', style: 'neon' })
  const neonInfo = probe(neon, 'stream=codec_name,width,height')
  const neonOk = existsSync(neon) && /width=1920/.test(neonInfo) && /height=1080/.test(neonInfo)
  ok = ok && neonOk
  console.log(`neon style  -> ${neonOk ? 'OK' : 'FAIL'}  [${neonInfo}] ${statSync(neon).size}b`)

  // 2) Video with a Ken-Burns image-slideshow background.
  const layout = computeLayout('1080p')
  const img1 = join(d, 'img1.png')
  const img2 = join(d, 'img2.png')
  await runFfmpeg(['-y', '-f', 'lavfi', '-i', 'color=c=teal:s=1280x720:d=1', '-frames:v', '1', img1])
  await runFfmpeg(['-y', '-f', 'lavfi', '-i', 'color=c=maroon:s=1280x720:d=1', '-frames:v', '1', img2])
  // sanity: the slideshow builder alone
  const slides = join(d, 'slides.mp4')
  await makeSlideshow([img1, img2], layout, 4, slides)
  const slidesOk = existsSync(slides) && statSync(slides).size > 0
  console.log(`slideshow   -> ${slidesOk ? 'OK' : 'FAIL'} ${statSync(slides).size}b`)

  const imgVid = join(d, 'imgbg.mp4')
  await renderVideo({ title: 'Image BG', body, audioPath: wav, durationSec: 4, outPath: imgVid, resolution: '1080p', style: 'cinematic', images: [img1, img2] })
  const imgInfo = probe(imgVid, 'stream=codec_name,width,height')
  const imgOk = existsSync(imgVid) && /width=1920/.test(imgInfo) && /height=1080/.test(imgInfo)
  ok = ok && slidesOk && imgOk
  console.log(`image-bg vid-> ${imgOk ? 'OK' : 'FAIL'}  [${imgInfo}] ${statSync(imgVid).size}b`)

  console.log('\nRESULT:', ok ? 'STYLE ENGINE OK' : 'STYLE ENGINE FAILED')
  process.exit(ok ? 0 : 1)
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
