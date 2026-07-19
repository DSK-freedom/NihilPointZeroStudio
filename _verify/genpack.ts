/* Build-time generator for the bundled royalty-free "starter pack": renders every
 * mood as a short loopable bed + every SFX kind into resources/audio-pack, with a
 * manifest. We authored these (pure ffmpeg synthesis), so they are license-clear.
 * Imports only compose + ffmpeg (no electron), so it runs headlessly. */
import { existsSync, mkdirSync, statSync, writeFileSync } from 'fs'
import { join } from 'path'
import { buildMusicFilter, buildSfxFilter, MOODS, SFX_KINDS, type SynthSpec } from '../src/main/audio/compose'
import { runFfmpeg } from '../src/main/video/ffmpeg'

function synthArgs(spec: SynthSpec, out: string): string[] {
  return ['-y', '-f', 'lavfi', '-i', spec.src, '-af', spec.af, '-c:a', 'libmp3lame', '-q:a', '4', out]
}

async function main(): Promise<void> {
  const target = join(__dirname, '..', 'resources', 'audio-pack')
  if (!existsSync(target)) mkdirSync(target, { recursive: true })

  const items: Array<{ id: string; kind: 'music' | 'sfx'; label: string; file: string }> = []
  for (const mood of MOODS) {
    const file = join(target, `music-${mood}.mp3`)
    await runFfmpeg(synthArgs(buildMusicFilter(mood, 24, 1), file))
    items.push({ id: `music-${mood}`, kind: 'music', label: `${mood} bed`, file })
    console.log(`music-${mood}.mp3  ${statSync(file).size}b`)
  }
  for (const kind of SFX_KINDS) {
    const file = join(target, `sfx-${kind}.mp3`)
    await runFfmpeg(synthArgs(buildSfxFilter(kind), file))
    items.push({ id: `sfx-${kind}`, kind: 'sfx', label: kind, file })
    console.log(`sfx-${kind}.mp3  ${statSync(file).size}b`)
  }
  // Manifest paths are runtime-resolved (process.resourcesPath/audio-pack), so store
  // only the basenames; the main process rebuilds absolute paths.
  const manifest = items.map((it) => ({ ...it, file: it.file.split(/[\\/]/).pop() }))
  writeFileSync(join(target, 'manifest.json'), JSON.stringify(manifest, null, 2), 'utf-8')
  console.log(`\nWrote ${items.length} clips + manifest.json to ${target}`)
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
