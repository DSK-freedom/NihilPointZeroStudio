// @vitest-environment jsdom
/**
 * Tests for the standalone phone app.
 *
 * Two things matter most here and are easy to break later:
 *  1. PARITY — the phone must use the desktop app's real prompt builders, not a
 *     copy. If someone ever pastes a divergent prompt in, these fail loudly.
 *  2. ISOLATION — the phone's storage is its own. It must never be able to reach
 *     or destroy the user's real work, and deleting must only remove what was asked.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { buildAdvisorSystemPrompt, buildIdeaPrompt, buildScriptPrompt } from '../../src/main/prompts'
import { advisorSystem } from './ai'
import { getKey, getProvider, listSaved, remove, save, setKey, setProvider } from './store'

beforeEach(() => {
  // Un-stub FIRST: a previous test may have replaced localStorage with a throwing
  // stub, and clearing that would blow up before the real one is back.
  vi.unstubAllGlobals()
  localStorage.clear()
})

describe('prompt parity with the desktop app', () => {
  it('uses the desktop advisor prompt verbatim', () => {
    expect(advisorSystem()).toBe(buildAdvisorSystemPrompt())
    expect(advisorSystem('working on the rupee')).toBe(buildAdvisorSystemPrompt('working on the rupee'))
  })

  it('carries the honesty rules that stop the AI inventing channel numbers', () => {
    // These exact guarantees are what make the output trustworthy; the phone
    // must not quietly ship a softened version of them.
    expect(advisorSystem()).toContain('NEVER invent or cite specific numbers')
    expect(buildIdeaPrompt({ focusArea: 'x', count: 1 }, [], [])).toContain('HONESTY')
  })

  it('still produces a full script prompt with no trend or news data available', () => {
    // The phone has no trends feed, no YouTube API and no news search — the
    // shared builders must degrade gracefully rather than emit a broken prompt.
    const prompt = buildScriptPrompt({ topic: 'Rupee', length: 'long', languageMix: 'balanced', styles: ['standard'] })
    expect(prompt).toContain('[PATTERN INTERRUPT]')
    expect(prompt).toContain('===SCRIPT===')
    expect(prompt).toContain('Avoid stating precise, specific numbers')
  })
})

describe('phone storage', () => {
  it('defaults to the free AI with no key, so the app works with nothing typed in', () => {
    expect(getProvider()).toBe('free')
    expect(getKey()).toBe('')
  })

  it('remembers the provider and key', () => {
    setProvider('anthropic')
    setKey('  sk-test  ')
    expect(getProvider()).toBe('anthropic')
    expect(getKey()).toBe('sk-test')
  })

  it('falls back to free if the stored provider is nonsense', () => {
    localStorage.setItem('npz.provider', 'not-a-provider')
    expect(getProvider()).toBe('free')
  })

  it('lists newest first', () => {
    save('idea', 'first', 'a')
    save('script', 'second', 'b')
    expect(listSaved().map((i) => i.title)).toEqual(['second', 'first'])
  })

  it('caps stored items so a phone cannot silently fill up', () => {
    for (let i = 0; i < 205; i++) save('idea', `i${i}`, 'body')
    expect(listSaved()).toHaveLength(200)
    // The cap drops the OLDEST, never the newest.
    expect(listSaved()[0].title).toBe('i204')
  })

  it('deletes only the requested item', () => {
    const keep = save('script', 'keep', 'a')
    const drop = save('script', 'drop', 'b')
    remove(drop.id)
    expect(listSaved().map((i) => i.id)).toEqual([keep.id])
  })

  it('survives storage being unavailable instead of crashing', () => {
    vi.stubGlobal('localStorage', {
      getItem: () => {
        throw new Error('blocked')
      },
      setItem: () => {
        throw new Error('blocked')
      }
    })
    expect(getProvider()).toBe('free')
    expect(listSaved()).toEqual([])
    expect(() => save('idea', 't', 'b')).not.toThrow()
  })

  it('recovers from corrupted stored data', () => {
    localStorage.setItem('npz.saved', 'not json')
    expect(listSaved()).toEqual([])
    localStorage.setItem('npz.saved', '{"not":"an array"}')
    expect(listSaved()).toEqual([])
  })
})

describe('free mode requests', () => {
  it('sends no key and no authorization header', async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ choices: [{ message: { content: 'hi' } }] }), { status: 200 }))
    vi.stubGlobal('fetch', fetchMock)

    const { complete } = await import('./ai')
    await complete('a prompt', 100)

    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit]
    expect(url).toBe('https://text.pollinations.ai/openai')
    const headers = init.headers as Record<string, string>
    expect(headers.Authorization).toBeUndefined()
    expect(headers['x-api-key']).toBeUndefined()
    // Generations must not land in the provider's public feed.
    expect(JSON.parse(init.body as string).private).toBe(true)
  })

  it('turns a provider error into plain language, not a status code', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('nope', { status: 429 })))
    const { complete } = await import('./ai')
    await expect(complete('x', 10)).rejects.toThrow(/busy right now/i)
  })
})
