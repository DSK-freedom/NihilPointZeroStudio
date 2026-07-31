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

  // A fresh data home = first run = the onboarding tour overlay. It must exist
  // (that's a feature), be skippable, and get out of the way before the sweep.
  const skipTour = win.locator('button', { hasText: 'Skip tour' })
  if ((await skipTour.count()) > 0) {
    await skipTour.first().click()
    await win.waitForTimeout(300)
    if ((await skipTour.count()) > 0) fail('Onboarding tour', 'Skip did not dismiss the tour')
    else console.log('  ✓ Onboarding tour: shown on first run, Skip dismisses it')
  } else {
    fail('Onboarding tour', 'did not appear on a fresh first run')
  }

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

  // ---- 3) Edge cases a real user hits: the app must stay alive and SAY something
  //         every time — silence or a crash is the failure being hunted here.

  // 3a. Autosave: typed work must survive leaving the tab and coming back.
  try {
    await win.evaluate(() => {
      window.location.hash = '#/scriptpad'
    })
    await win.waitForTimeout(500)
    const pad = win.locator('main textarea').first()
    await pad.fill('E2E autosave probe — do not lose me')
    await win.waitForTimeout(1200) // let the debounced save fire
    await win.evaluate(() => {
      window.location.hash = '#/'
    })
    await win.waitForTimeout(400)
    await win.evaluate(() => {
      window.location.hash = '#/scriptpad'
    })
    await win.waitForTimeout(800)
    const back = await win.locator('main textarea').first().inputValue()
    if (!back.includes('do not lose me')) {
      fail('Autosave', `typed text did not survive a tab switch (got: "${back.slice(0, 60)}")`)
    } else {
      console.log('  ✓ Autosave: typed work survives leaving and re-entering the tab')
    }
  } catch (err) {
    fail('Autosave', `${err?.message ?? err}`)
  }

  // 3b. Empty input: the correct behavior (already implemented) is that the Build
  //     button is DISABLED — submitting nothing must be impossible, not "handled".
  try {
    await win.evaluate(() => {
      window.location.hash = '#/video'
    })
    await win.waitForTimeout(700)
    await win.locator('main select').first().selectOption({ label: '✍️ Paste / write my own script' })
    await win.locator('input[placeholder="Video title shown on the opening card"]').fill('')
    await win.locator('textarea[placeholder*="spoken narration"]').fill('')
    await win.waitForTimeout(300)
    const disabled = await win.locator('button', { hasText: 'Build Video' }).first().isDisabled()
    if (!disabled) {
      fail('Empty-input guard', 'Build is clickable with an empty script — it must be disabled')
    } else {
      console.log('  ✓ Empty-input guard: Build is correctly disabled until a script exists')
    }
  } catch (err) {
    fail('Empty-input guard', `${err?.message ?? err}`)
  }

  // 3c. Bilingual + emoji build TO COMPLETION: Roman Urdu, Urdu script and emoji
  //     through narration, layout and encoding — the whole offline pipeline.
  try {
    await win.locator('input[placeholder="Video title shown on the opening card"]').fill('E2E اردو test 🎬')
    await win
      .locator('textarea[placeholder*="spoken narration"]')
      .fill('Rupay ki girawat aur mehngai. معیشت کا تجزیہ اور منافع کی کہانی۔ Emoji check 🚀📈 done.')
    await win.locator('button', { hasText: 'Style presets' }).first().click()
    await win.locator('button', { hasText: 'Build Video' }).first().click()
    await win.waitForFunction(
      () => {
        const main = document.querySelector('main')
        return main ? /E2E اردو test/.test(main.innerText) && !!main.querySelector('video') : false
      },
      { timeout: 240_000 }
    )
    console.log('  ✓ Urdu + emoji build: finished video visible in the list')
  } catch (err) {
    fail('Urdu/emoji build', `${err?.message ?? err}`)
  }

  // 3d. Huge script + rapid double-click + Stop mid-build: the panic-clicking user.
  //     Must start, must not double-build into chaos, must stop when told, must recover.
  try {
    const huge = 'Market analysis paragraph with numbers and risk words. '.repeat(280) // ~15k chars
    await win.locator('input[placeholder="Video title shown on the opening card"]').fill('E2E huge cancel test')
    await win.locator('textarea[placeholder*="spoken narration"]').fill(huge)
    const buildBtn = win.locator('button', { hasText: 'Build Video' }).first()
    await buildBtn.click()
    await buildBtn.click({ force: true }).catch(() => {}) // rapid second click must be harmless
    await win.waitForTimeout(4000) // let the build visibly start
    const stop = win.locator('button', { hasText: 'Stop' }).first()
    if ((await stop.count()) === 0) throw new Error('no Stop button appeared during a running build')
    await stop.click()
    // Recovery = the Build button is usable again reasonably soon after Stop.
    await win.waitForFunction(
      () => {
        const btns = [...document.querySelectorAll('main button')]
        const b = btns.find((x) => /Build Video/.test(x.textContent ?? ''))
        return !!b && !b.disabled
      },
      { timeout: 30_000 }
    )
    if ((await win.locator('text=This tab hit a snag').count()) > 0) throw new Error('tab crashed after Stop')
    console.log('  ✓ Huge script + double-click + Stop: build started, stopped instantly, UI recovered')
  } catch (err) {
    fail('Huge/cancel build', `${err?.message ?? err}`)
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
