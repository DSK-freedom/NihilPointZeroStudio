import { describe, expect, it } from 'vitest'
import { ResilientProvider } from './resilient'
import type { LLMProvider } from './types'

function stub(name: string, fail: boolean): LLMProvider {
  const val = async (): Promise<string> => {
    if (fail) throw new Error(`${name} down`)
    return name
  }
  return {
    generateText: val,
    generateThumbnailBrief: val,
    generateScriptBody: async () => {
      if (fail) throw new Error(`${name} down`)
      return { title: name, body: name }
    },
    generateIdeas: async () => {
      if (fail) throw new Error(`${name} down`)
      return []
    },
    generateTrendTopics: async () => {
      if (fail) throw new Error(`${name} down`)
      return []
    }
  }
}

describe('ResilientProvider', () => {
  it('uses the first provider when it works', async () => {
    const r = new ResilientProvider([stub('primary', false), stub('backup', false)])
    expect(await r.generateText('x')).toBe('primary')
  })

  it('falls back to the next provider when the first fails', async () => {
    const r = new ResilientProvider([stub('primary', true), stub('backup', false)])
    expect(await r.generateText('x')).toBe('backup')
    expect((await r.generateScriptBody({} as never)).title).toBe('backup')
  })

  it('throws the last error only when ALL providers fail', async () => {
    const r = new ResilientProvider([stub('a', true), stub('b', true)])
    await expect(r.generateText('x')).rejects.toThrow(/down/)
  })

  it('requires at least one provider', () => {
    expect(() => new ResilientProvider([])).toThrow()
  })

  it('reports each fallback through onFallback with the failed index', async () => {
    const seen: number[] = []
    const r = new ResilientProvider([stub('a', true), stub('b', false)], (i) => seen.push(i))
    expect(await r.generateText('x')).toBe('b')
    expect(seen).toEqual([0])
  })

  it('does not report a fallback when the LAST provider fails (nothing left to try)', async () => {
    const seen: number[] = []
    const r = new ResilientProvider([stub('a', true), stub('b', true)], (i) => seen.push(i))
    await expect(r.generateText('x')).rejects.toThrow(/down/)
    expect(seen).toEqual([0])
  })

  it('a throwing onFallback reporter never breaks the chain', async () => {
    const r = new ResilientProvider([stub('a', true), stub('b', false)], () => {
      throw new Error('reporter exploded')
    })
    expect(await r.generateText('x')).toBe('b')
  })
})
