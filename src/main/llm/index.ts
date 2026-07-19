import { AnthropicProvider } from './anthropic'
import { OpenAIProvider } from './openai'
import { OllamaProvider } from './ollama'
import { PollinationsProvider } from './pollinations'
import { ResilientProvider } from './resilient'
import { LLMConfigError, type LLMProvider } from './types'
import { getDecryptedKey, getModel, getSettings } from '../store'

/** Builds the raw provider for the chosen id (throws for a paid provider with no key). */
function buildProvider(id: string, model: string): LLMProvider {
  // Trim the saved model id — a stray leading/trailing space (e.g. " claude-fable-5")
  // otherwise causes a hard 404 on every paid call.
  const m = (model || '').trim()
  if (id === 'free') return new PollinationsProvider(m || 'openai')
  if (id === 'ollama') return new OllamaProvider(m)
  const key = getDecryptedKey(id as 'anthropic' | 'openai')
  if (!key) throw new LLMConfigError(`No API key configured for ${id}. Add one in Settings before generating.`)
  if (id === 'anthropic') return new AnthropicProvider(key, m)
  return new OpenAIProvider(key, m)
}

/**
 * The active provider, wrapped so a busy/down service auto-falls-back and never hard-
 * blocks. Chain: the chosen provider first, then the keyless free hosted model as a
 * safety net. The free hosted model is ALWAYS appended (even for the free default, as a
 * one-shot retry) so a single transient hiccup never surfaces as an error. If the chosen
 * provider can't even be constructed (paid provider with no/undecryptable key — common on
 * a portable USB copy), we skip it rather than hard-failing the whole chain, degrading to
 * free. Needs internet for the free fallback.
 */
export function getActiveProvider(): LLMProvider {
  const settings = getSettings()
  const chain: LLMProvider[] = []
  try {
    chain.push(buildProvider(settings.activeProvider, getModel(settings.activeProvider)))
  } catch {
    /* no usable primary (missing/undecryptable key) — degrade to the free fallback below */
  }
  if (settings.activeProvider !== 'free') chain.push(new PollinationsProvider('openai'))
  // Final keyless safety net / retry — guarantees the chain is never empty and the free
  // default still gets one automatic retry.
  chain.push(new PollinationsProvider('openai'))
  return new ResilientProvider(chain)
}

export { LLMConfigError, LLMRequestError } from './types'
