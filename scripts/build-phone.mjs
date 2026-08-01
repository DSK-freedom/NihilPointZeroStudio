/**
 * Builds the standalone phone app into `phone/dist/`.
 *
 *   node scripts/build-phone.mjs
 *
 * The bundle pulls `src/main/prompts.ts` and `src/main/llm/parse.ts` straight
 * out of the desktop app, which is the whole point: the phone and the PC write
 * from one identical set of instructions and can never drift apart.
 *
 * Output is a plain static folder — index.html, one JS bundle, a manifest, a
 * service worker and icons. It needs no server of its own, which is what makes
 * it hostable on GitHub Pages and installable as a home-screen app.
 *
 * This does NOT touch the Electron build in any way. `npm run dist:win` and
 * `npm run ship` are completely unaffected by anything in `phone/`.
 */
import { build } from 'esbuild'
import { cpSync, mkdirSync, rmSync, readdirSync, statSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const SRC = join(ROOT, 'phone', 'src', 'app.ts')
const PUBLIC = join(ROOT, 'phone', 'public')
const DIST = join(ROOT, 'phone', 'dist')

rmSync(DIST, { recursive: true, force: true })
mkdirSync(DIST, { recursive: true })

const result = await build({
  entryPoints: [SRC],
  outfile: join(DIST, 'app.js'),
  bundle: true,
  format: 'esm',
  // Baseline that covers the Android Chrome and iOS Safari versions actually in
  // use, while still allowing top-level await and optional chaining.
  target: ['chrome100', 'safari15'],
  minify: true,
  sourcemap: false,
  legalComments: 'none',
  logLevel: 'warning',
  metafile: true
})

cpSync(PUBLIC, DIST, { recursive: true })

const bytes = Object.values(result.metafile.outputs).reduce((n, o) => n + o.bytes, 0)
const files = readdirSync(DIST).sort()
const total = files.reduce((n, f) => n + statSync(join(DIST, f)).size, 0)

console.log(`phone app built -> phone/dist (${files.length} files, ${(total / 1024).toFixed(1)} KB total)`)
console.log(`  bundle: ${(bytes / 1024).toFixed(1)} KB`)
for (const f of files) console.log(`  - ${f}`)
