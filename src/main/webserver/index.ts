import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'http'
import type { AddressInfo } from 'net'
import { randomBytes } from 'crypto'
import { networkInterfaces } from 'os'
import { generateIdeasFlow, generateScriptFlow } from '../services'
import { getModel, getSettings, listLibrary, logActivity } from '../store'
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
    return url.searchParams.get('t') === token || req.headers['x-token'] === token
  } catch {
    return false
  }
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

  if (path === '/' || path === '/index.html') {
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' })
    res.end(MOBILE_PAGE)
    return
  }
  if (!authed(req)) {
    sendJson(res, 401, { error: 'Unauthorized — open the link with its token.' })
    return
  }
  if (path === '/api/library' && req.method === 'GET') {
    sendJson(res, 200, listLibrary())
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
  token = randomBytes(9).toString('base64url')
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
  logActivity('user', 'Started phone web-view server', getWebServerStatus().url ?? '')
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
