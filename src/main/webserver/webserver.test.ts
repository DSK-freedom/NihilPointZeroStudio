/**
 * Guards the phone web-view server.
 *
 * The point of these tests is the SECURITY MODEL: every request must carry the
 * token, the new read-only routes must not become a hole in that, and nothing
 * the phone can reach may modify or delete the user's work. They start the real
 * HTTP server and make real requests rather than poking at internals, because
 * that is the only way to prove the gate actually holds.
 */
import { mkdtempSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { afterEach, describe, expect, it, vi } from 'vitest'

vi.mock('../store', () => ({
  getModel: () => 'test-model',
  getSettings: () => ({ activeProvider: 'free' }),
  listLibrary: () => [
    { id: 'a', kind: 'script', data: { title: 'Rupee explainer', body: 'text' }, savedAt: '2026-01-02T00:00:00.000Z' },
    { id: 'b', kind: 'idea', data: { title: 'Trashed', hook: 'h' }, savedAt: '2026-01-01T00:00:00.000Z', trashedAt: '2026-01-03T00:00:00.000Z' }
  ],
  listActivityLog: () => Array.from({ length: 150 }, (_, i) => ({
    id: `e${i}`,
    timestamp: '2026-01-01T00:00:00.000Z',
    actor: 'user',
    action: `action ${i}`
  })),
  logActivity: vi.fn(),
  // Used by the project importer behind POST /api/project.
  phoneAssetsDir: () => mkdtempSync(join(tmpdir(), 'npz-ws-assets-')),
  setDraft: vi.fn()
}))

vi.mock('../services', () => ({
  generateIdeasFlow: vi.fn(async () => [{ title: 'Idea' }]),
  generateScriptFlow: vi.fn(async () => ({ title: 'S', body: 'B' }))
}))

vi.mock('../llm/ollama', () => ({ ollamaChatStream: vi.fn() }))
vi.mock('../llm', () => ({ getActiveProvider: () => ({ generateText: async () => 'advice' }) }))

import { getWebServerStatus, startWebServer, stopWebServer } from './index'
import { MOBILE_PAGE } from './page'

/** Starts the server and returns its base URL plus the one valid token. */
async function boot(): Promise<{ base: string; token: string }> {
  const status = await startWebServer()
  const url = new URL(status.url as string)
  // Bound to 0.0.0.0; talk to it over loopback so the test never leaves the box.
  return { base: `http://127.0.0.1:${url.port}`, token: url.searchParams.get('t') as string }
}

afterEach(() => {
  stopWebServer()
})

describe('phone web server auth gate', () => {
  it('rejects every route without a token, including the page itself', async () => {
    const { base } = await boot()
    for (const path of ['/', '/index.html', '/api/library', '/api/activity']) {
      const res = await fetch(`${base}${path}`)
      expect(res.status, `${path} must be gated`).toBe(401)
    }
    // The one route that WRITES must be gated just as hard as the reads.
    const push = await fetch(`${base}/api/project`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: '{"formatVersion":1}'
    })
    expect(push.status).toBe(401)
  })

  it('rejects a wrong token', async () => {
    const { base } = await boot()
    const res = await fetch(`${base}/api/library`, { headers: { 'X-Token': 'not-the-token' } })
    expect(res.status).toBe(401)
  })

  it('accepts the token in the query string or the header', async () => {
    const { base, token } = await boot()
    expect((await fetch(`${base}/?t=${token}`)).status).toBe(200)
    expect((await fetch(`${base}/api/library`, { headers: { 'X-Token': token } })).status).toBe(200)
  })

  it('issues a fresh token each start, so turning phone access off invalidates the old link', async () => {
    const first = await boot()
    stopWebServer()
    const second = await boot()
    expect(second.token).not.toBe(first.token)
    const res = await fetch(`${second.base}/api/library`, { headers: { 'X-Token': first.token } })
    expect(res.status).toBe(401)
  })

  it('never puts the token in the status URL of a stopped server', () => {
    expect(getWebServerStatus()).toEqual({ running: false, url: null })
  })
})

describe('read-only phone routes', () => {
  it('serves the library', async () => {
    const { base, token } = await boot()
    const res = await fetch(`${base}/api/library`, { headers: { 'X-Token': token } })
    const body = await res.json()
    expect(body).toHaveLength(2)
    expect(body[0].data.title).toBe('Rupee explainer')
  })

  it('caps the activity log so a long history cannot flood a phone', async () => {
    const { base, token } = await boot()
    const res = await fetch(`${base}/api/activity`, { headers: { 'X-Token': token } })
    const body = await res.json()
    expect(body).toHaveLength(100)
  })

  it('accepts a plan pushed from the phone and reports what arrived', async () => {
    const { base, token } = await boot()
    const res = await fetch(`${base}/api/project`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Token': token },
      body: JSON.stringify({
        formatVersion: 1,
        title: 'From the phone',
        storyboard: { title: 'From the phone', style: 'noir', beats: [{ durationSec: 5, visual: 'A skyline' }] },
        build: { style: 'noir' },
        assets: []
      })
    })
    expect(res.status).toBe(200)
    expect(await res.json()).toMatchObject({ ok: true, scenes: 1, needMedia: 0 })
  })

  it('rejects a pushed plan that is not a plan, without crashing the server', async () => {
    const { base, token } = await boot()
    const res = await fetch(`${base}/api/project`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Token': token },
      body: JSON.stringify({ definitely: 'not a plan' })
    })
    expect(res.status).toBe(400)
    // The server must still be answering afterwards.
    expect((await fetch(`${base}/api/library`, { headers: { 'X-Token': token } })).status).toBe(200)
  })

  it('refuses to mutate anything — no write verb is routed', async () => {
    const { base, token } = await boot()
    for (const method of ['DELETE', 'PUT', 'PATCH']) {
      for (const path of ['/api/library', '/api/activity']) {
        const res = await fetch(`${base}${path}`, { method, headers: { 'X-Token': token } })
        expect(res.status, `${method} ${path} must not be handled`).toBe(404)
      }
    }
  })
})

describe('mobile page', () => {
  it('exposes every tab the script wires up', () => {
    for (const tab of ['ideas', 'writer', 'advisor', 'library', 'activity']) {
      expect(MOBILE_PAGE).toContain(`id="t-${tab}"`)
      expect(MOBILE_PAGE).toContain(`id="s-${tab}"`)
    }
  })

  it('is self-contained — no external asset can leak the private link', () => {
    // Any http(s) reference would tell a third-party server the LAN address and
    // token via the Referer header. The icon is an inline data: URI for this reason.
    expect(MOBILE_PAGE).not.toMatch(/(src|href)="https?:\/\//)
  })

  it('escapes HTML so PC-side content cannot inject script into the phone page', () => {
    expect(MOBILE_PAGE).toContain(`function esc(`)
    // Every place that interpolates server data must run it through esc().
    expect(MOBILE_PAGE).not.toMatch(/\+\s*(s\.title|s\.body|a\.action|a\.details)\s*\+/)
  })
})
