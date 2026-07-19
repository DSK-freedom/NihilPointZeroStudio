import { mkdtempSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { spawnSync } from 'child_process'
import ffmpegStatic from 'ffmpeg-static'
import ffprobeStatic from 'ffprobe-static'
import { renderVideo } from '../src/main/video/render'

const ff = ffmpegStatic as unknown as string
const fp = ffprobeStatic.path
const scratch = mkdtempSync(join(tmpdir(), 'vidcheck-'))
const narration = join(scratch, 'narration.wav')
const music = join(scratch, 'music.wav')
const out = join(scratch, 'out.mp4')

// Generate a 3s narration tone and a 2s music tone (music shorter → must loop).
spawnSync(ff, ['-y', '-f', 'lavfi', '-i', 'sine=frequency=300:duration=3', narration])
spawnSync(ff, ['-y', '-f', 'lavfi', '-i', 'sine=frequency=500:duration=2', music])

try {
  await renderVideo({
    title: 'Test Video',
    body: '[INTRO]\nline\n[MIDDLE]\nline\n[END]\nline',
    audioPath: narration,
    durationSec: 3,
    outPath: out,
    resolution: '8k',
    musicPath: music,
    soundEffects: true,
    onLog: () => {}
  })
  const dims = spawnSync(fp, [
    '-v', 'error', '-select_streams', 'v:0',
    '-show_entries', 'stream=width,height', '-of', 'csv=p=0', out
  ]).stdout.toString().trim()
  const acodec = spawnSync(fp, [
    '-v', 'error', '-select_streams', 'a:0',
    '-show_entries', 'stream=codec_name', '-of', 'csv=p=0', out
  ]).stdout.toString().trim()
  const vcodec = spawnSync(fp, [
    '-v', 'error', '-select_streams', 'v:0',
    '-show_entries', 'stream=codec_name', '-of', 'csv=p=0', out
  ]).stdout.toString().trim()
  console.log('RENDER_OK dims=' + dims + ' video=' + vcodec + ' audio=' + acodec)
} catch (e) {
  console.log('RENDER_ERROR: ' + (e instanceof Error ? e.message : String(e)))
}
process.exit(0)
