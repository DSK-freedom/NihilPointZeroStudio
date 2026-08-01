import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'http'
import type { AddressInfo } from 'net'
import { randomBytes } from 'crypto'
import { networkInterfaces } from 'os'
import { generateIdeasFlow, generateScriptFlow } from '../services'
import { getModel, getSettings, listActivityLog, listLibrary, logActivity } from '../store'
import { ollamaChatStream, type ChatTurn } from '../llm/ollama'
import { getActiveProvider } from '../llm'
import { buildAdvisorSystemPrompt } from '../prompts'
import { MOBILE_PAGE } from './page'

let server: Server | null = null
let token = ''
let boundPort = 0

export interface WebServerStatus {
  running: boolean
  url: string | null
}

function lanIp(): string {
  for (const addrs of Object.values(networkInterfaces())) {
    for (const a of addrs ?? []) {
      if (a.family === 'IPv4' && !a.internal) return a.address
    }
  }
  return '127.0.0.1'
}

export function getWebServerStatus(): WebServerStatus {
  return { running: !!server, url: server ? `http://${lanIp()}:${boundPort}/?t=${token}` : null }
}

function authed(req: IncomingMessage): boolean {
  try {
    const url = new URL(req.url ?? '', 'http://x')
    // Query param opens the page (it's the link the user taps); the page's own API
    // calls then send the token in the X-Token header instead of the URL.
    return url.searchParams.get('t') === token || req.headers['x-token'] === token
  } catch {
    return false
  }
}

/**
 * Small per-IP sliding-window rate limit on the generation endpoints, so a LAN host
 * that somehow obtained the URL can't burn the AI keys/quota in a loop. Generous for
 * one human on a phone; tight for a script.
 */
const RATE_WINDOW_MS = 5 * 60_000
const RATE_MAX = 30
const rateHits = new Map<string, number[]>()
function rateLimited(req: IncomingMessage): boolean {
  const ip = req.socket.remoteAddress ?? 'unknown'
  const now = Date.now()
  const hits = (rateHits.get(ip) ?? []).filter((t) => now - t < RATE_WINDOW_MS)
  if (hits.length >= RATE_MAX) {
    rateHits.set(ip, hits)
    return true
  }
  hits.push(now)
  rateHits.set(ip, hits)
  return false
}

function readBody(req: IncomingMessage): Promise<unknown> {
  return new Promise((resolve, reject) => {
    let data = ''
    req.on('data', (c) => {
      data += c
      if (data.length > 2_000_000) req.destroy() // basic guard
    })
    req.on('end', () => {
      try {
        resolve(data ? JSON.parse(data) : {})
      } catch {
        reject(new Error('Invalid JSON body'))
      }
    })
    req.on('error', reject)
  })
}

function sendJson(res: ServerResponse, code: number, body: unknown): void {
  const s = JSON.stringify(body)
  res.writeHead(code, { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(s) })
  res.end(s)
}

async function handleAdvisor(res: ServerResponse, body: any): Promise<void> {
  const settings = getSettings()
  const system = buildAdvisorSystemPrompt(typeof body?.context === 'string' ? body.context : undefined)
  const messages: { role: 'user' | 'assistant'; content: string }[] = Array.isArray(body?.messages) ? body.messages : []
  res.writeHead(200, { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-cache' })
  if (settings.activeProvider === 'ollama') {
    const turns: ChatTurn[] = [{ role: 'system', content: system }, ...messages]
    await ollamaChatStream(getModel('ollama'), turns, (delta) => res.write(delta))
  } else {
    const provider = getActiveProvider()
    const flat = `${system}\n\n${messages.map((m) => `${m.role.toUpperCase()}: ${m.content}`).join('\n\n')}\n\nASSISTANT:`
    res.write(await provider.generateText(flat, 1500))
  }
  res.end()
}

async function route(req: IncomingMessage, res: ServerResponse): Promise<void> {
  const url = new URL(req.url ?? '', 'http://x')
  const path = url.pathname

  // EVERYTHING requires the token now — including the page itself, so a random LAN
  // host hitting the bare IP:port learns nothing. The link the app shows carries ?t=.
  if (!authed(req)) {
    sendJson(res, 401, { error: 'Unauthorized — open the exact link shown in the app (it includes its key).' })
    return
  }
  if (path === '/' || path === '/index.html') {
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' })
    res.end(MOBILE_PAGE)
    return
  }
  if (path.startsWith('/api/') && rateLimited(req)) {
    sendJson(res, 429, { error: 'Too many requests — wait a few minutes and try again.' })
    return
  }
  if (path === '/api/library' && req.method === 'GET') {
    sendJson(res, 200, listLibrary())
    return
  }
  // Read-only. The phone can look at the log; only the desktop app's explicit
  // user-initiated "Clear Log" can ever empty it.
  if (path === '/api/activity' && req.method === 'GET') {
    sendJson(res, 200, listActivityLog().slice(0, 100))
    return
  }
  if (path === '/api/ideas' && req.method === 'POST') {
    const body = (await readBody(req)) as any
    logActivity('user', 'Generated ideas from phone', String(body?.focusArea ?? ''))
    sendJson(res, 200, await generateIdeasFlow({
      focusArea: String(body?.focusArea ?? ''),
      audienceNote: body?.audienceNote ? String(body.audienceNote) : undefined,
      count: Math.min(Math.max(Number(body?.count) || 5, 1), 10)
    }))
    return
  }
  if (path === '/api/script' && req.method === 'POST') {
    const body = (await readBody(req)) as any
    logActivity('user', 'Wrote script from phone', String(body?.topic ?? ''))
    sendJson(res, 200, await generateScriptFlow({
      topic: String(body?.topic ?? ''),
      length: body?.length ?? 'long',
      languageMix: body?.languageMix ?? 'balanced',
      styles: Array.isArray(body?.styles) && body.styles.length ? body.styles : ['standard']
    }))
    return
  }
  if (path === '/api/advisor' && req.method === 'POST') {
    await handleAdvisor(res, await readBody(req))
    return
  }
  sendJson(res, 404, { error: 'Not found' })
}

export async function startWebServer(): Promise<WebServerStatus> {
  if (server) return getWebServerStatus()
  token = randomBytes(12).toString('base64url')
  server = createServer((req, res) => {
    route(req, res).catch((err) => {
      if (!res.headersSent) sendJson(res, 500, { error: err instanceof Error ? err.message : 'Server error' })
      else res.end()
    })
  })
  await new Promise<void>((resolve, reject) => {
    server!.once('error', reject)
    server!.listen(0, '0.0.0.0', () => resolve())
  })
  boundPort = (server.address() as AddressInfo).port
  // Log WITHOUT the token — the activity log is persistent, and a secret written to a
  // log isn't a secret. The full tokenized link lives only in the Settings UI.
  logActivity('user', 'Started phone web-view server', `http://${lanIp()}:${boundPort}`)
  return getWebServerStatus()
}

export function stopWebServer(): WebServerStatus {
  if (server) {
    server.close()
    server = null
    logActivity('user', 'Stopped phone web-view server')
  }
  return getWebServerStatus()
}
