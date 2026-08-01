/**
 * NIHILPOINTZERO — phone app.
 *
 * A standalone home-screen app that works on mobile data with the PC switched
 * off. It does the thinking/writing half of the studio: Ideas, Script Writer,
 * Advisor, plus a thumbnail brief. It deliberately does NOT pretend to do video
 * rendering, voice-over, or subtitles — those need the PC's ffmpeg and Whisper
 * and are honestly labelled as such in the UI.
 */
import type { LanguageMix, ScriptLength, ScriptStyle } from '../../src/shared/types'
import { advisorSystem, completeStream, generateIdeas, generateScript, generateThumbnailBrief } from './ai'
import { getKey, getProvider, listSaved, remove, save, setKey, setProvider, type PhoneProvider, type SavedItem } from './store'

type TabName = 'ideas' | 'writer' | 'advisor' | 'saved' | 'settings'

const $ = <T extends HTMLElement = HTMLElement>(id: string): T => document.getElementById(id) as T

function esc(s: string): string {
  return (s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c] as string)
}

function val(id: string): string {
  return ($(id) as HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement).value.trim()
}

function message(err: unknown): string {
  return err instanceof Error ? err.message : String(err)
}

/** Shows a spinner-ish busy label on a button and guarantees it is restored. */
async function withBusy<T>(btnId: string, busyLabel: string, fn: () => Promise<T>): Promise<T | null> {
  const btn = $<HTMLButtonElement>(btnId)
  const original = btn.textContent ?? ''
  btn.disabled = true
  btn.textContent = busyLabel
  try {
    return await fn()
  } catch (err) {
    return Promise.reject(err) as never
  } finally {
    btn.disabled = false
    btn.textContent = original
  }
}

function setError(id: string, err: unknown): void {
  $(id).innerHTML = `<div class="err">${esc(message(err))}</div>`
}

// ---------------------------------------------------------------- tabs

function showTab(name: TabName): void {
  const tabs: TabName[] = ['ideas', 'writer', 'advisor', 'saved', 'settings']
  for (const t of tabs) {
    $(`s-${t}`).classList.toggle('hidden', t !== name)
    const btn = document.getElementById(`t-${t}`)
    if (btn) btn.classList.toggle('on', t === name)
  }
  if (name === 'saved') renderSaved()
  window.scrollTo(0, 0)
}

// ---------------------------------------------------------------- ideas

async function runIdeas(): Promise<void> {
  const out = $('i-out')
  const focusArea = val('i-focus')
  if (!focusArea) {
    setError('i-out', new Error('Type a focus area first — for example "Pakistan inflation".'))
    return
  }
  out.innerHTML = '<div class="muted">Thinking… this usually takes 10-30 seconds.</div>'
  try {
    await withBusy('i-go', 'Thinking…', async () => {
      const ideas = await generateIdeas({
        focusArea,
        audienceNote: val('i-aud') || undefined,
        count: Math.min(Math.max(Number(val('i-count')) || 5, 1), 10)
      })
      out.innerHTML = ideas
        .map(
          (i) => `<div class="card">
            <h3>${esc(i.title)}</h3>
            <div class="muted">Score ${esc(String(i.viewPotentialScore))}/10 · ${esc(i.competitionLevel)} competition</div>
            <pre>${esc(i.hook)}</pre>
            <div class="muted" style="margin-top:8px">${esc(i.angle)}</div>
            <div class="row">
              <button class="mini" data-use="${esc(i.title)}">Write this</button>
              <button class="mini" data-copy="${esc(`${i.title}\n\n${i.hook}\n\n${i.angle}`)}">Copy</button>
            </div>
          </div>`
        )
        .join('')
      save('idea', `${ideas.length} ideas — ${focusArea}`, ideas.map((i) => `${i.title}\n${i.hook}`).join('\n\n'))
    })
  } catch (err) {
    setError('i-out', err)
  }
}

// ---------------------------------------------------------------- writer

async function runScript(): Promise<void> {
  const out = $('w-out')
  const topic = val('w-topic')
  if (!topic) {
    setError('w-out', new Error('Type a topic first.'))
    return
  }
  const length = val('w-len') as ScriptLength
  out.innerHTML = `<div class="muted">Writing… ${
    length === 'short' ? 'about 30 seconds' : 'a long script can take 1-3 minutes. Keep the screen on.'
  }</div>`
  try {
    await withBusy('w-go', 'Writing…', async () => {
      const script = await generateScript({
        topic,
        length,
        languageMix: val('w-lang') as LanguageMix,
        styles: [val('w-style') as ScriptStyle]
      })
      const words = script.body.trim().split(/\s+/).length
      out.innerHTML = `<div class="card">
        <h3>${esc(script.title)}</h3>
        <div class="muted">${words} words · roughly ${Math.round(words / 150)} min spoken · saved on this phone</div>
        <pre>${esc(script.body)}</pre>
        <div class="row">
          <button class="mini" data-copy="${esc(`${script.title}\n\n${script.body}`)}">Copy</button>
          <button class="mini" data-share="${esc(script.title)}" data-sharebody="${esc(script.body)}">Send to PC</button>
        </div>
      </div>`
      save('script', script.title, script.body)
    })
  } catch (err) {
    setError('w-out', err)
  }
}

async function runThumbnail(): Promise<void> {
  const topic = val('w-topic')
  if (!topic) {
    setError('w-out', new Error('Type a topic first.'))
    return
  }
  try {
    await withBusy('w-thumb', 'Designing…', async () => {
      const brief = await generateThumbnailBrief(topic, '')
      $('w-out').innerHTML = `<div class="card"><h3>Thumbnail brief</h3><pre>${esc(brief)}</pre>
        <div class="row"><button class="mini" data-copy="${esc(brief)}">Copy</button></div></div>`
      save('thumbnail', `Thumbnail — ${topic}`, brief)
    })
  } catch (err) {
    setError('w-out', err)
  }
}

// ---------------------------------------------------------------- advisor

const convo: { role: 'user' | 'assistant'; content: string }[] = []

async function runAdvisor(): Promise<void> {
  const input = $<HTMLTextAreaElement>('a-in')
  const text = input.value.trim()
  if (!text) return
  input.value = ''
  convo.push({ role: 'user', content: text })

  const log = $('a-log')
  log.insertAdjacentHTML('beforeend', `<div class="card"><div class="muted">You</div><pre>${esc(text)}</pre></div>`)
  const bubble = document.createElement('div')
  bubble.className = 'card'
  bubble.innerHTML = '<div class="muted">Advisor</div><pre></pre>'
  log.appendChild(bubble)
  const pre = bubble.querySelector('pre') as HTMLPreElement

  const btn = $<HTMLButtonElement>('a-go')
  btn.disabled = true
  try {
    const system = advisorSystem()
    // The whole conversation is replayed each turn so the advisor keeps context;
    // the phone has no server session to hold it.
    const flat = convo.map((m) => `${m.role.toUpperCase()}: ${m.content}`).join('\n\n')
    const answer = await completeStream(`${flat}\n\nASSISTANT:`, system, 1500, (delta) => {
      pre.textContent = (pre.textContent ?? '') + delta
      window.scrollTo(0, document.body.scrollHeight)
    })
    convo.push({ role: 'assistant', content: answer })
    save('advice', text.slice(0, 60), answer)
  } catch (err) {
    pre.innerHTML = `<span class="err">${esc(message(err))}</span>`
  } finally {
    btn.disabled = false
  }
}

// ---------------------------------------------------------------- saved

function renderSaved(): void {
  const items = listSaved()
  const out = $('sv-out')
  if (!items.length) {
    out.innerHTML = '<div class="muted">Nothing saved yet. Anything you generate is kept here on this phone.</div>'
    return
  }
  out.innerHTML = items.map((i) => card(i)).join('')
}

function card(i: SavedItem): string {
  const when = new Date(i.createdAt).toLocaleString()
  return `<div class="card">
    <h3>${esc(i.title)}</h3>
    <div class="muted">${esc(i.kind)} · ${esc(when)}</div>
    <pre class="clamp">${esc(i.body)}</pre>
    <div class="row">
      <button class="mini" data-copy="${esc(i.body)}">Copy</button>
      <button class="mini" data-share="${esc(i.title)}" data-sharebody="${esc(i.body)}">Send to PC</button>
      <button class="mini danger" data-del="${esc(i.id)}">Delete</button>
    </div>
  </div>`
}

// ---------------------------------------------------------------- settings

function renderSettings(): void {
  const p = getProvider()
  ;($('st-provider') as HTMLSelectElement).value = p
  ;($('st-key') as HTMLInputElement).value = getKey()
  $('st-keyrow').classList.toggle('hidden', p === 'free')
}

function saveSettings(): void {
  const p = ($('st-provider') as HTMLSelectElement).value as PhoneProvider
  setProvider(p)
  setKey(val('st-key'))
  $('st-out').innerHTML =
    p === 'free'
      ? '<div class="muted">Saved. Using the free AI — nothing to pay, nothing to type in.</div>'
      : '<div class="muted">Saved. Your key is stored only on this phone.</div>'
  renderSettings()
}

// ---------------------------------------------------------------- shared actions

async function copyText(text: string): Promise<void> {
  try {
    await navigator.clipboard.writeText(text)
    toast('Copied')
  } catch {
    toast('Could not copy — long-press the text instead')
  }
}

async function shareText(title: string, body: string): Promise<void> {
  // Web Share hands off to WhatsApp/email/Drive etc., which is how a script
  // actually gets from the phone to the PC. Falls back to copying.
  if (navigator.share) {
    try {
      await navigator.share({ title, text: body })
      return
    } catch {
      // User dismissed the share sheet — not an error worth showing.
      return
    }
  }
  await copyText(body)
}

let toastTimer: number | undefined
function toast(text: string): void {
  const el = $('toast')
  el.textContent = text
  el.classList.remove('hidden')
  window.clearTimeout(toastTimer)
  toastTimer = window.setTimeout(() => el.classList.add('hidden'), 1800)
}

// ---------------------------------------------------------------- wiring

function wire(): void {
  for (const t of ['ideas', 'writer', 'advisor', 'saved', 'settings'] as TabName[]) {
    document.getElementById(`t-${t}`)?.addEventListener('click', () => showTab(t))
  }
  $('i-go').addEventListener('click', runIdeas)
  $('w-go').addEventListener('click', runScript)
  $('w-thumb').addEventListener('click', runThumbnail)
  $('a-go').addEventListener('click', runAdvisor)
  $('st-save').addEventListener('click', saveSettings)
  $('st-provider').addEventListener('change', () =>
    $('st-keyrow').classList.toggle('hidden', ($('st-provider') as HTMLSelectElement).value === 'free')
  )

  // One delegated listener for every generated button, so freshly rendered
  // cards work without re-binding anything.
  document.addEventListener('click', (e) => {
    const el = (e.target as HTMLElement).closest('button')
    if (!el) return
    const copy = el.getAttribute('data-copy')
    if (copy !== null) return void copyText(copy)
    const share = el.getAttribute('data-share')
    if (share !== null) return void shareText(share, el.getAttribute('data-sharebody') ?? '')
    const del = el.getAttribute('data-del')
    if (del !== null) {
      // Deletion is always confirmed, and only ever touches this phone's copy.
      if (confirm('Delete this from your phone? Your PC is not affected.')) {
        remove(del)
        renderSaved()
      }
      return
    }
    const use = el.getAttribute('data-use')
    if (use !== null) {
      ;($('w-topic') as HTMLTextAreaElement).value = use
      showTab('writer')
    }
  })

  renderSettings()
  showTab('ideas')
}

if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', wire)
else wire()

// Offline shell caching. Registration failing is not fatal — the app still runs
// online, it just won't open without a connection.
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('./sw.js').catch(() => undefined)
  })
}
