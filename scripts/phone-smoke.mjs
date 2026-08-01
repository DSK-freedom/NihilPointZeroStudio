/**
 * Click-through smoke test for the standalone phone app, in a real browser at a
 * real phone screen size:
 *
 *   npm run build:phone && node scripts/phone-smoke.mjs
 *
 * It serves `phone/dist` over http, stubs the AI endpoint so the test never
 * spends a request or depends on a third-party service being up, then drives the
 * actual UI: generate ideas, write a script, save it, delete it. Anything that
 * throws in the page fails the run.
 *
 * Same spirit as the desktop click-through gate — a build that cannot be clicked
 * through is not shippable.
 */
import { chromium } from 'playwright-core'
import { createServer } from 'node:http'
import { readFileSync, existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join, extname } from 'node:path'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const DIST = join(ROOT, 'phone', 'dist')

if (!existsSync(join(DIST, 'app.js'))) {
  console.error('phone/dist is missing — run `npm run build:phone` first.')
  process.exit(1)
}

const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.png': 'image/png',
  '.webmanifest': 'application/manifest+json'
}

const server = createServer((req, res) => {
  const path = (req.url || '/').split('?')[0]
  const file = join(DIST, path === '/' ? 'index.html' : path.replace(/^\/+/, ''))
  if (!file.startsWith(DIST) || !existsSync(file)) {
    res.writeHead(404).end('not found')
    return
  }
  res.writeHead(200, { 'Content-Type': TYPES[extname(file)] || 'application/octet-stream' })
  res.end(readFileSync(file))
})

await new Promise((r) => server.listen(0, '127.0.0.1', r))
const base = `http://127.0.0.1:${server.address().port}`

const IDEAS = JSON.stringify([
  {
    title: 'Why the rupee keeps sliding',
    hook: 'Aaj hum baat karain ge rupee ki.',
    angle: 'Mechanism, not blame.',
    viewPotentialScore: 8,
    viewPotentialReason: 'Search intent is steady.',
    competitionLevel: 'medium',
    contentPillars: ['currency'],
    suggestedLength: 'long'
  }
])
const SCRIPT = 'TITLE: The Rupee Trap\n===SCRIPT===\n[PATTERN INTERRUPT]\nYeh number dekhein.'

const fails = []
const step = (name, ok, detail = '') => {
  console.log(`${ok ? '  ok ' : '  FAIL '} ${name}${detail ? ` — ${detail}` : ''}`)
  if (!ok) fails.push(name)
}

const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' })
try {
  const ctx = await browser.newContext({
    viewport: { width: 390, height: 844 }, // iPhone-class portrait
    userAgent: 'Mozilla/5.0 (Linux; Android 14) AppleWebKit/537.36 Chrome/120 Mobile Safari/537.36'
  })
  const page = await ctx.newPage()

  const pageErrors = []
  page.on('pageerror', (e) => pageErrors.push(e.message))
  page.on('console', (m) => m.type() === 'error' && pageErrors.push(m.text()))

  // Stub the AI so the smoke test is deterministic and costs nothing.
  let aiCalls = 0
  await page.route('https://text.pollinations.ai/**', async (route) => {
    aiCalls++
    const body = JSON.parse(route.request().postData() || '{}')
    const wantsScript = String(body.messages?.[0]?.content || '').includes('===SCRIPT===')
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ choices: [{ message: { content: wantsScript ? SCRIPT : IDEAS } }] })
    })
  })

  console.log(`\nPhone app smoke test (${base})\n`)
  await page.goto(base, { waitUntil: 'networkidle' })
  step('page loads', await page.title() === 'NIHILPOINTZERO', await page.title())

  // --- Ideas -------------------------------------------------------------
  await page.fill('#i-focus', 'Pakistan rupee')
  await page.click('#i-go')
  await page.waitForSelector('#i-out .card', { timeout: 15_000 })
  step('ideas render', (await page.locator('#i-out .card h3').first().textContent())?.includes('rupee'))

  // --- Writer, reached via "Write this" on an idea ------------------------
  await page.click('#i-out button[data-use]')
  step('"Write this" jumps to the writer', await page.locator('#s-writer').isVisible())
  step('topic is carried over', (await page.inputValue('#w-topic')).length > 0)

  await page.selectOption('#w-len', 'short')
  await page.click('#w-go')
  await page.waitForSelector('#w-out .card', { timeout: 15_000 })
  step('script renders', (await page.locator('#w-out h3').textContent()) === 'The Rupee Trap')
  step('stage directions survive', (await page.locator('#w-out pre').textContent())?.includes('[PATTERN INTERRUPT]'))

  // --- Saved --------------------------------------------------------------
  await page.click('#t-saved')
  const savedCount = await page.locator('#sv-out .card').count()
  step('generations are saved on the phone', savedCount >= 2, `${savedCount} items`)

  page.on('dialog', (d) => d.accept())
  await page.locator('#sv-out button[data-del]').first().click()
  await page.waitForTimeout(200)
  step('delete removes exactly one item', (await page.locator('#sv-out .card').count()) === savedCount - 1)

  // --- Settings -----------------------------------------------------------
  await page.click('#t-settings')
  step('free mode is the default', (await page.inputValue('#st-provider')) === 'free')
  step('key box is hidden in free mode', !(await page.locator('#st-keyrow').isVisible()))
  await page.selectOption('#st-provider', 'anthropic')
  step('key box appears for a keyed provider', await page.locator('#st-keyrow').isVisible())

  // --- Installability -----------------------------------------------------
  const manifest = await page.evaluate(async () => {
    const href = document.querySelector('link[rel=manifest]')?.getAttribute('href')
    if (!href) return null
    return (await fetch(href)).json()
  })
  step('manifest is served', !!manifest)
  step('manifest is standalone (installs as an app)', manifest?.display === 'standalone')
  step('manifest has a maskable icon', manifest?.icons?.some((i) => i.purpose === 'maskable'))
  for (const icon of manifest?.icons ?? []) {
    const res = await page.request.get(new URL(icon.src, `${base}/`).toString())
    step(`icon ${icon.sizes} loads`, res.ok())
  }

  step('AI endpoint was actually exercised', aiCalls >= 2, `${aiCalls} calls`)
  step('no page errors', pageErrors.length === 0, pageErrors.join(' | '))
} finally {
  await browser.close()
  server.close()
}

console.log(fails.length ? `\n${fails.length} check(s) FAILED\n` : '\nAll checks passed\n')
process.exit(fails.length ? 1 : 0)
