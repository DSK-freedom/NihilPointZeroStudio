/* Headless verification of the Phase 4 audio generator: render one music bed per
 * mood and every SFX kind with the REAL compose builders, then ffprobe each to
 * confirm a valid, non-silent audio stream of the expected duration. */
import { mkdtempSync, existsSync, statSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { spawnSync } from 'child_process'
import {
  buildMusicFilter,
  buildSfxFilter,
  MOODS,
  SFX_KINDS,
  type SynthSpec
} from '../src/main/audio/compose'
import { ffmpegPath, ffprobePath, runFfmpeg } from '../src/main/video/ffmpeg'

function synthArgs(spec: SynthSpec, out: string): string[] {
  return ['-y', '-f', 'lavfi', '-i', spec.src, '-af', spec.af, '-c:a', 'libmp3lame', '-q:a', '4', out]
}
function dur(file: string): number {
  const r = spawnSync(ffprobePath, ['-v', 'error', '-show_entries', 'format=duration', '-of', 'default=nw=1:nk=1', file])
  return parseFloat(r.stdout.toString().trim())
}
/** mean_volume in dB via volumedetect (very negative or -inf ⇒ silent). */
function meanVolume(file: string): number {
  const ff = spawnSync(ffmpegPath, ['-hide_banner', '-i', file, '-af', 'volumedetect', '-f', 'null', '-'], { encoding: 'utf-8' })
  const m = /mean_volume:\s*(-?\d+(?:\.\d+)?) dB/.exec(ff.stderr || '')
  return m ? parseFloat(m[1]) : NaN
}

async function main(): Promise<void> {
  const d = mkdtempSync(join(tmpdir(), 'audiocheck-'))
  let ok = true

  console.log('=== MUSIC (per mood, 8s) ===')
  for (const mood of MOODS) {
    const out = join(d, `music-${mood}.mp3`)
    try {
      await runFfmpeg(synthArgs(buildMusicFilter(mood, 8, 1), out))
      const dd = dur(out)
      const mv = meanVolume(out)
      const good = existsSync(out) && statSync(out).size > 0 && Math.abs(dd - 8) < 0.6 && mv > -50
      ok = ok && good
      console.log(`${good ? 'OK ' : 'FAIL'} ${mood.padEnd(10)} dur=${dd.toFixed(2)}s mean=${mv.toFixed(1)}dB`)
    } catch (e) {
      ok = false
      console.log(`FAIL ${mood} -> ${(e as Error).message.slice(0, 120)}`)
    }
  }

  console.log('\n=== SFX (per kind) ===')
  for (const kind of SFX_KINDS) {
    const out = join(d, `sfx-${kind}.mp3`)
    try {
      const spec = buildSfxFilter(kind)
      await runFfmpeg(synthArgs(spec, out))
      const dd = dur(out)
      const mv = meanVolume(out)
      const good = existsSync(out) && statSync(out).size > 0 && dd > 0 && mv > -60
      ok = ok && good
      console.log(`${good ? 'OK ' : 'FAIL'} ${kind.padEnd(10)} dur=${dd.toFixed(2)}s mean=${mv.toFixed(1)}dB`)
    } catch (e) {
      ok = false
      console.log(`FAIL ${kind} -> ${(e as Error).message.slice(0, 120)}`)
    }
  }

  console.log('\nRESULT:', ok ? 'AUDIO OK' : 'AUDIO FAILED')
  process.exit(ok ? 0 : 1)
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
