/**
 * THE SHIP GATE: launches the REAL built app (out/main/index.js under the local
 * Electron) and walks EVERY tab like a user would — plus one full offline video
 * build clicked through the actual UI. If any tab renders dead, crashes, or the
 * build button does nothing, this exits non-zero and the ship STOPS.
 *
 * Why this exists: 471 unit tests can pass while a button in the UI is dead —
 * that class of failure reached the user repeatedly (2026-07-31). Nothing ships
 * without this click-through passing again.
 *
 * Isolation: NPZ_E2E_USERDATA points the app at a throwaway data home (see
 * src/main/index.ts) so a test run can never read or write real user work, never
 * runs the auto-backup, and never phones the update check.
 *
 * Determinism: only offline paths are exercised for pass/fail (presets engine,
 * Windows TTS, local ffmpeg). Anything needing the internet is checked for
 * PRESENCE and RESPONSIVENESS, never for online success.
 */
import { _electron as electron } from 'playwright-core'
import { mkdtempSync, rmSync } from 'fs'
import { tmpdir } from 'os'
import { join, dirname, resolve } from 'path'
import { fileURLToPath } from 'url'

const repo = resolve(dirname(fileURLToPath(import.meta.url)), '..')

/** Every sidebar route, with a string that must be visible for the tab to count as alive.
 * Keep these to STABLE headline copy; a missing string means the tab is blank/broken. */
const TABS = [
  { route: '/', name: 'Today', mustSee: 'Your studio at a glance' },
  { route: '/ideas', name: 'Ideas & Trends', mustSee: 'audience' },
  { route: '/agent', name: 'AI Command', mustSee: 'Batch' },
  { route: '/scenes', name: 'Scene Studio', mustSee: 'Scene Studio' },
  { route: '/writer', name: 'Script Writer', mustSee: 'script' },
  { route: '/scriptpad', name: 'Script Pad', mustSee: 'Script Pad' },
  { route: '/video', name: 'Video Studio', mustSee: 'Video look (engine)' },
  { route: '/storyboard', name: 'Storyboard Director', mustSee: 'Storyboard Director' },
  { route: '/presenter', name: 'Presenter Studio', mustSee: 'Presenter Studio' },
  { route: '/recorder', name: 'Recorder', mustSee: 'Recorder' },
  { route: '/timeline', name: 'Timeline Editor', mustSee: 'Timeline' },
  { route: '/charts', name: 'Charts', mustSee: 'Charts' },
  { route: '/psx', name: 'Live PSX Data', mustSee: 'PSX' },
  { route: '/nccpl', name: 'NCCPL Analysis', mustSee: 'NCCPL' },
  { route: '/advisor', name: 'Advisor', mustSee: 'Advisor' },
  { route: '/library', name: 'Library', mustSee: 'Library' },
  // Activity Log's one button is deliberately disabled while the (fresh, isolated)
  // log is empty — read-only there is correct, so only render-aliveness is checked.
  { route: '/activity', name: 'Activity Log', mustSee: 'recorded automatically', readOnlyWhenEmpty: true },
  { route: '/settings', name: 'Settings', mustSee: 'AI Video engines (optional)' }
]

const failures = []
const fail = (tab, why) => {
  failures.push(`${tab}: ${why}`)
  console.error(`  ✗ ${tab}: ${why}`)
}

const dataHome = mkdtempSync(join(tmpdir(), 'npz-e2e-'))
console.log(`E2E data home (isolated, throwaway): ${dataHome}`)

const app = await electron.launch({
  args: [join(repo, 'out', 'main', 'index.js')],
  cwd: repo,
  env: { ...process.env, NPZ_E2E_USERDATA: dataHome }
})

try {
  const win = await app.firstWindow()
  const pageErrors = []
  win.on('pageerror', (err) => pageErrors.push(String(err?.message ?? err)))
  await win.waitForLoadState('domcontentloaded')
  // First paint of the React tree.
  await win.waitForSelector('main', { timeout: 15000 })

  // ---- 1) Every tab must render alive: headline present, no crash screen,
  //         real content, and at least one enabled button to press.
  for (const tab of TABS) {
    try {
      await win.evaluate((route) => {
        window.location.hash = `#${route}`
      }, tab.route)
      await win.waitForTimeout(700)

      if ((await win.locator('text=This tab hit a snag').count()) > 0) {
        fail(tab.name, 'crashed (ErrorBoundary is showing)')
        continue
      }
      const mainText = (await win.locator('main').innerText()).trim()
      if (mainText.length < 40) {
        fail(tab.name, `rendered nearly blank (${mainText.length} chars of text)`)
        continue
      }
      if (!mainText.toLowerCase().includes(tab.mustSee.toLowerCase())) {
        fail(tab.name, `expected to see "${tab.mustSee}" — not found`)
        continue
      }
      // "Alive" = something a user can act on. Some tabs (Today, Activity Log) use
      // clickable cards/links rather than <button>, so count every interactive kind.
      const interactive = await win
        .locator('main button:enabled, main a, main [role="button"], main select, main input, main textarea')
        .count()
      if (interactive < 1 && !tab.readOnlyWhenEmpty) {
        fail(tab.name, 'has nothing interactive at all (no buttons, links, cards or inputs)')
        continue
      }
      console.log(`  ✓ ${tab.name} (${interactive} interactive elements)`)
    } catch (err) {
      fail(tab.name, `check threw: ${err?.message ?? err}`)
    }
  }

  // ---- 2) The core promise, clicked like a user: paste a script in Video Studio,
  //         pick the offline engine, press Build, and get an actual finished video.
  console.log('  … building a real video through the UI (offline engine)')
  try {
    await win.evaluate(() => {
      window.location.hash = '#/video'
    })
    await win.waitForTimeout(700)

    await win.locator('main select').first().selectOption({ label: '✍️ Paste / write my own script' })
    await win.locator('input[placeholder="Video title shown on the opening card"]').fill('E2E smoke test')
    await win
      .locator('textarea[placeholder*="spoken narration"]')
      .fill('This is the automated click-through test. It builds a tiny real video completely offline.')
    // Offline engine tile — everything else stays at defaults.
    await win.locator('button', { hasText: 'Style presets' }).first().click()

    const buildBtn = win.locator('button', { hasText: 'Build Video' }).first()
    if ((await buildBtn.count()) === 0) throw new Error('the Build Video button is missing')
    await buildBtn.click()

    // The build must COMPLETE: a new entry appears in "Your videos". Progress text
    // alone is not enough — the user's complaint is builds that never finish.
    await win.waitForFunction(
      () => {
        const main = document.querySelector('main')
        return main ? /E2E smoke test/.test(main.innerText) && !!main.querySelector('video') : false
      },
      { timeout: 240_000 }
    )
    console.log('  ✓ Build Video: clicked → rendered → finished video visible in the list')
  } catch (err) {
    fail('Video Studio BUILD', `${err?.message ?? err}`)
  }

  if (pageErrors.length) {
    for (const e of pageErrors) fail('Renderer exception', e.slice(0, 200))
  }
} finally {
  await app.close().catch(() => {})
  rmSync(dataHome, { recursive: true, force: true })
}

if (failures.length) {
  console.error(`\nE2E FAILED — ${failures.length} problem(s). THIS BUILD MUST NOT SHIP.`)
  process.exit(1)
}
console.log('\nE2E OK — every tab is alive and a real video built end-to-end through the UI.')
