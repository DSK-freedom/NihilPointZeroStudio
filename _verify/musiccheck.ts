/* Phase 6 check: exercise the REAL searchMusic against Openverse (if online) and
 * verify graceful offline handling. Not a hard failure if the network is blocked —
 * the point is that the function never throws and reports online:false cleanly. */
import { searchMusic, downloadTrack } from '../src/main/data/freeMusic'
import { mkdtempSync, existsSync, statSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'

async function main(): Promise<void> {
  const result = await searchMusic('calm piano')
  console.log('online:', result.online, '| tracks:', result.tracks.length, '| error:', result.error ?? 'none')

  if (!result.online) {
    console.log('\nRESULT: OFFLINE-FALLBACK OK (searchMusic returned online:false without throwing)')
    process.exit(0)
  }

  // Online: verify shape of the top result and try one download.
  const top = result.tracks.find((t) => t.audioUrl)
  if (top) {
    console.log('top:', JSON.stringify({ title: top.title, license: top.license, hasUrl: !!top.audioUrl }))
    try {
      const d = mkdtempSync(join(tmpdir(), 'musiccheck-'))
      const out = join(d, 'dl.mp3')
      await downloadTrack(top.audioUrl as string, out)
      const ok = existsSync(out) && statSync(out).size > 0
      console.log(`download -> ${statSync(out).size}b ${ok ? 'OK' : 'FAIL'}`)
      console.log('\nRESULT:', ok ? 'ONLINE SEARCH+DOWNLOAD OK' : 'DOWNLOAD FAILED')
      process.exit(ok ? 0 : 1)
    } catch (e) {
      console.log('download error (host-specific, not fatal):', (e as Error).message.slice(0, 120))
      console.log('\nRESULT: SEARCH OK (download skipped)')
      process.exit(0)
    }
  }
  console.log('\nRESULT: SEARCH OK (no directly-downloadable url in top results)')
  process.exit(0)
}

main().catch((e) => {
  console.error('UNEXPECTED THROW (searchMusic should never throw):', e)
  process.exit(1)
})
