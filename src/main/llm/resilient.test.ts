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
})
