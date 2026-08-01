/**
 * The phone app's AI brain.
 *
 * This deliberately imports the SAME prompt builders and response parsers the
 * desktop app uses (`src/main/prompts.ts`, `src/main/llm/parse.ts`) rather than
 * copying them, so a phone script reads exactly like a desktop script and the
 * two can never drift apart. Those modules import only TYPES, so they bundle
 * into a browser cleanly.
 *
 * Default provider is the same free, keyless Pollinations endpoint the desktop
 * app defaults to — so the phone app works with nothing typed in. The user may
 * optionally supply their own Claude/OpenAI key for higher quality; that key
 * lives only in this phone's storage and is sent only to that provider.
 */
import type { IdeaGenRequest, ScriptGenRequest, VideoIdea } from '../../src/shared/types'
import { buildAdvisorSystemPrompt, buildIdeaPrompt, buildScriptPrompt, buildThumbnailPrompt } from '../../src/main/prompts'
import { extractJson, parseScriptResponse } from '../../src/main/llm/parse'
import { LLMRequestError } from '../../src/main/llm/types'
import { getKey, getProvider } from './store'

export type PhoneIdea = Omit<VideoIdea, 'id' | 'createdAt'>

const POLLINATIONS = 'https://text.pollinations.ai/openai'
const OPENAI = 'https://api.openai.com/v1/chat/completions'
const ANTHROPIC = 'https://api.anthropic.com/v1/messages'

/**
 * Longer than the desktop's 45s: a phone on mobile data is slower than a PC on
 * broadband, and a feature script legitimately takes a while. Still bounded, so
 * a dead service surfaces as a clear message instead of a spinner forever.
 */
const TIMEOUT_MS = 90_000

/** Human-readable, non-technical failure text. The user does not read stack traces. */
function friendly(status: number, provider: string): string {
  if (status === 401 || status === 403)
    return 'That AI key was rejected. Check it in Settings, or switch back to Free mode.'
  if (status === 402) return 'That AI account needs credit before it can answer. Switch to Free mode to keep working.'
  if (status === 429) return 'The AI service is busy right now. Wait a minute and tap the button again.'
  if (status >= 500) return `The ${provider} AI service is having trouble on their end. Try again shortly.`
  return `The ${provider} AI service returned an error (${status}).`
}

async function post(url: string, headers: Record<string, string>, body: unknown, provider: string): Promise<Response> {
  let res: Response
  try {
    res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...headers },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(TIMEOUT_MS)
    })
  } catch (err) {
    const timedOut = err instanceof Error && (err.name === 'TimeoutError' || err.name === 'AbortError')
    throw new LLMRequestError(
      timedOut
        ? `The AI took longer than ${Math.round(TIMEOUT_MS / 1000)} seconds to answer. Try a shorter length, or try again.`
        : 'Could not reach the AI. Check that your phone has internet.'
    )
  }
  if (!res.ok) throw new LLMRequestError(friendly(res.status, provider), { status: res.status })
  return res
}

/**
 * One prompt in, one block of text out. Streaming is used only by the Advisor
 * (see `completeStream`), because that is the only place where watching words
 * appear is worth the extra complexity.
 */
export async function complete(prompt: string, maxTokens: number, system?: string): Promise<string> {
  const provider = getProvider()
  const key = getKey()

  if (provider === 'anthropic' && key) {
    const res = await post(
      ANTHROPIC,
      {
        'x-api-key': key,
        'anthropic-version': '2023-06-01',
        // Required for calls made straight from a browser rather than a server.
        'anthropic-dangerous-direct-browser-access': 'true'
      },
      {
        model: 'claude-sonnet-4-5',
        max_tokens: maxTokens,
        ...(system ? { system } : {}),
        messages: [{ role: 'user', content: prompt }]
      },
      'Claude'
    )
    const data = (await res.json()) as { content?: { text?: string }[] }
    const text = data.content?.map((c) => c.text ?? '').join('')
    if (!text?.trim()) throw new LLMRequestError('Claude returned no text. Try again.')
    return text
  }

  if (provider === 'openai' && key) {
    const res = await post(
      OPENAI,
      { Authorization: `Bearer ${key}` },
      {
        model: 'gpt-4o',
        max_tokens: maxTokens,
        messages: [...(system ? [{ role: 'system', content: system }] : []), { role: 'user', content: prompt }]
      },
      'OpenAI'
    )
    const data = (await res.json()) as { choices?: { message?: { content?: string } }[] }
    const text = data.choices?.[0]?.message?.content
    if (!text?.trim()) throw new LLMRequestError('OpenAI returned no text. Try again.')
    return text
  }

  // Free mode — no key, no signup. Same endpoint and options as the desktop app.
  const res = await post(
    POLLINATIONS,
    {},
    {
      model: 'openai',
      messages: [...(system ? [{ role: 'system', content: system }] : []), { role: 'user', content: prompt }],
      max_tokens: maxTokens,
      private: true,
      referrer: 'nihilpointzero-phone'
    },
    'free'
  )
  const data = (await res.json()) as { choices?: { message?: { content?: string } }[] }
  const text = data.choices?.[0]?.message?.content
  if (!text?.trim()) throw new LLMRequestError('The free AI service returned nothing. Try again in a moment.')
  return text
}

/**
 * Advisor streaming. Falls back to a single non-streamed answer if the provider
 * or the network refuses to stream — the user still gets their reply either way.
 */
export async function completeStream(
  prompt: string,
  system: string,
  maxTokens: number,
  onDelta: (chunk: string) => void
): Promise<string> {
  const provider = getProvider()
  const key = getKey()
  const usingKey = (provider === 'anthropic' || provider === 'openai') && !!key

  // Only the two keyed providers have a documented browser-side SSE contract we
  // can rely on; free mode reads better as one clean answer than a broken stream.
  if (!usingKey) {
    const text = await complete(prompt, maxTokens, system)
    onDelta(text)
    return text
  }

  const res =
    provider === 'anthropic'
      ? await post(
          ANTHROPIC,
          {
            'x-api-key': key,
            'anthropic-version': '2023-06-01',
            'anthropic-dangerous-direct-browser-access': 'true'
          },
          { model: 'claude-sonnet-4-5', max_tokens: maxTokens, system, stream: true, messages: [{ role: 'user', content: prompt }] },
          'Claude'
        )
      : await post(
          OPENAI,
          { Authorization: `Bearer ${key}` },
          {
            model: 'gpt-4o',
            max_tokens: maxTokens,
            stream: true,
            messages: [
              { role: 'system', content: system },
              { role: 'user', content: prompt }
            ]
          },
          'OpenAI'
        )

  const reader = res.body?.getReader()
  if (!reader) {
    const text = await complete(prompt, maxTokens, system)
    onDelta(text)
    return text
  }

  const decoder = new TextDecoder()
  let buffered = ''
  let full = ''
  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    buffered += decoder.decode(value, { stream: true })
    const lines = buffered.split('\n')
    // Keep the last (possibly incomplete) line for the next chunk.
    buffered = lines.pop() ?? ''
    for (const line of lines) {
      if (!line.startsWith('data:')) continue
      const payload = line.slice(5).trim()
      if (!payload || payload === '[DONE]') continue
      try {
        const evt = JSON.parse(payload)
        const delta: string =
          evt?.delta?.text ?? evt?.choices?.[0]?.delta?.content ?? ''
        if (delta) {
          full += delta
          onDelta(delta)
        }
      } catch {
        // A partial or non-JSON keep-alive frame — skip it rather than failing
        // the whole answer over one malformed line.
      }
    }
  }
  if (!full.trim()) throw new LLMRequestError('The AI returned no text. Try again.')
  return full
}

export async function generateIdeas(req: IdeaGenRequest): Promise<PhoneIdea[]> {
  // No trend feed or YouTube signals on the phone (those need the PC's API keys
  // and network modules) — the prompt builder already handles an empty list by
  // telling the model to rely on its own judgment.
  const text = await complete(buildIdeaPrompt(req, [], []), 3000)
  const ideas = extractJson<PhoneIdea[]>(text)
  if (!Array.isArray(ideas) || !ideas.length) throw new LLMRequestError('The AI did not return any ideas. Try again.')
  return ideas
}

export async function generateScript(req: ScriptGenRequest): Promise<{ title: string; body: string }> {
  return parseScriptResponse(await complete(buildScriptPrompt(req), 8000))
}

export async function generateThumbnailBrief(topic: string, title: string): Promise<string> {
  return (await complete(buildThumbnailPrompt(topic, title), 1000)).trim()
}

export function advisorSystem(context?: string): string {
  return buildAdvisorSystemPrompt(context)
}
