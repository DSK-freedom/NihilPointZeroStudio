import { app, safeStorage } from 'electron'
import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'fs'
import { randomUUID } from 'crypto'
import { join } from 'path'
import type {
  ActivityActor,
  ActivityLogEntry,
  AiVideoConfig,
  AudioPlan,
  ChatMessage,
  LLMProviderId,
  LibraryEntry,
  ProviderSettings,
  ScriptPad,
  VideoJob
} from '../shared/types'
import { DEFAULT_PIPER_VOICE_ID, resolvePiperVoiceId } from './voice/piperVoices'

interface PersistedSettings {
  activeProvider: LLMProviderId
  freeModel: string
  anthropicModel: string
  openaiModel: string
  ollamaModel: string
  anthropicKeyEnc: string | null
  openaiKeyEnc: string | null
  youtubeKeyEnc: string | null
  hordeKeyEnc: string | null
  mvsepTokenEnc: string | null
  demucsCmd: string
  faceAnimCmd: string
  youtubeChannelId: string
  piperVoiceId: string
  /** Optional second backup home (USB / second disk) — survives a dead system drive. */
  secondBackupDir?: string
  /** Delete-sync: a permanent delete in the app also removes the backup copy. */
  purgeBackupsOnDelete?: boolean
  /** Last quiet health check: when it ran and which checks failed (for the badge). */
  lastHealthAt?: string
  lastHealthFailed?: string[]
}

const DEFAULT_SETTINGS: PersistedSettings = {
  // Free, keyless, no-install hosted AI is the default so the app is fully usable
  // out of the box (needs internet). Users can switch to local Ollama or a paid key.
  activeProvider: 'free',
  freeModel: 'openai',
  anthropicModel: 'claude-sonnet-5',
  openaiModel: 'gpt-4o',
  ollamaModel: 'llama3.1:8b',
  anthropicKeyEnc: null,
  openaiKeyEnc: null,
  youtubeKeyEnc: null,
  hordeKeyEnc: null,
  mvsepTokenEnc: null,
  demucsCmd: '',
  faceAnimCmd: '',
  youtubeChannelId: 'UCLJDgGkwHZgrIfeiAWAwe2Q',
  piperVoiceId: DEFAULT_PIPER_VOICE_ID
}

/**
 * Atomic JSON write: write a temp file then rename over the target. An interrupted write
 * (USB pulled mid-save, crash, power loss) leaves the original intact instead of a
 * truncated file — which readers would otherwise silently treat as empty/defaults, i.e.
 * apparent data loss (videos vanish from the list, saved keys revert).
 */
function atomicWrite(filePath: string, content: string): void {
  const tmp = `${filePath}.tmp`
  writeFileSync(tmp, content, 'utf-8')
  renameSync(tmp, filePath)
}

function dataDir(): string {
  const dir = app.getPath('userData')
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true })
  return dir
}

function settingsPath(): string {
  return join(dataDir(), 'settings.json')
}

function libraryPath(): string {
  return join(dataDir(), 'library.json')
}

function activityLogPath(): string {
  return join(dataDir(), 'activity-log.json')
}

function readSettings(): PersistedSettings {
  try {
    const raw = readFileSync(settingsPath(), 'utf-8')
    return { ...DEFAULT_SETTINGS, ...JSON.parse(raw) }
  } catch {
    return { ...DEFAULT_SETTINGS }
  }
}

function writeSettings(settings: PersistedSettings): void {
  atomicWrite(settingsPath(), JSON.stringify(settings, null, 2))
}

function isPortable(): boolean {
  return !!process.env.PORTABLE_EXECUTABLE_DIR
}

/**
 * Encrypts an API key for storage. On a normal install we use OS-bound DPAPI
 * (safeStorage). In PORTABLE mode we deliberately DON'T — DPAPI blobs can't be
 * decrypted on another machine, which would break the whole point of a USB you
 * can move between PCs — so keys are stored obfuscated (base64) instead. Each
 * value is tagged with its scheme so decrypt() always knows how to read it.
 */
function encrypt(value: string): string {
  if (!isPortable() && safeStorage.isEncryptionAvailable()) {
    return `dpapi:${safeStorage.encryptString(value).toString('base64')}`
  }
  return `plain:${Buffer.from(value, 'utf-8').toString('base64')}`
}

function decrypt(stored: string): string {
  const sep = stored.indexOf(':')
  const scheme = sep === -1 ? '' : stored.slice(0, sep)
  const payload = sep === -1 ? stored : stored.slice(sep + 1)
  if (scheme === 'dpapi') {
    try {
      return safeStorage.decryptString(Buffer.from(payload, 'base64'))
    } catch {
      return '' // e.g. a DPAPI blob moved to a different machine — treat as unset.
    }
  }
  if (scheme === 'plain') {
    return Buffer.from(payload, 'base64').toString('utf-8')
  }
  // Legacy untagged value (pre-portable): try DPAPI, then fall back to base64.
  try {
    if (safeStorage.isEncryptionAvailable()) return safeStorage.decryptString(Buffer.from(stored, 'base64'))
  } catch {
    // fall through to base64
  }
  return Buffer.from(stored, 'base64').toString('utf-8')
}

export function getSettings(): ProviderSettings {
  const s = readSettings()
  return {
    activeProvider: s.activeProvider,
    freeModel: s.freeModel,
    anthropicModel: s.anthropicModel,
    openaiModel: s.openaiModel,
    ollamaModel: s.ollamaModel,
    hasAnthropicKey: !!s.anthropicKeyEnc,
    hasOpenAIKey: !!s.openaiKeyEnc,
    hasYouTubeKey: !!s.youtubeKeyEnc,
    hasHordeKey: !!s.hordeKeyEnc,
    hasMvsepToken: !!s.mvsepTokenEnc,
    demucsCmd: s.demucsCmd || '',
    faceAnimCmd: s.faceAnimCmd || '',
    youtubeChannelId: s.youtubeChannelId || '',
    piperVoiceId: resolvePiperVoiceId(s.piperVoiceId)
  }
}

/** Optional second backup location (unset = single-home backups). */
export function getSecondBackupDir(): string | null {
  const v = readSettings().secondBackupDir
  return v && v.trim() ? v : null
}

export function setSecondBackupDir(dir: string): void {
  const s = readSettings()
  s.secondBackupDir = dir.trim()
  writeSettings(s)
}

/** Delete-sync (ON by default per the user's explicit 2026-07-31 instruction). */
export function isPurgeBackupsOnDelete(): boolean {
  return readSettings().purgeBackupsOnDelete !== false
}

export function setPurgeBackupsOnDelete(on: boolean): void {
  const s = readSettings()
  s.purgeBackupsOnDelete = on
  writeSettings(s)
}

/** Quiet weekly health check bookkeeping (drives the Settings red badge). */
export function getLastHealth(): { at: string | null; failed: string[] } {
  const s = readSettings()
  return { at: s.lastHealthAt ?? null, failed: s.lastHealthFailed ?? [] }
}

export function setLastHealth(failed: string[]): void {
  const s = readSettings()
  s.lastHealthAt = new Date().toISOString()
  s.lastHealthFailed = failed
  writeSettings(s)
}

/** Persists the user's chosen Piper voice. An unknown/invalid id resolves to the default
 * rather than being saved verbatim, so a bad value can never silently break narration. */
export function setPiperVoiceId(voiceId: string): ProviderSettings {
  const s = readSettings()
  s.piperVoiceId = resolvePiperVoiceId(voiceId)
  writeSettings(s)
  return getSettings()
}

export function setActiveProvider(provider: LLMProviderId): ProviderSettings {
  const s = readSettings()
  s.activeProvider = provider
  writeSettings(s)
  return getSettings()
}

export function setModel(provider: LLMProviderId, model: string): ProviderSettings {
  // A pasted model id with a stray space (" claude-fable-5") 404s on every call, and the
  // failure is invisible to the user because of the free-AI fallback — so sanitize here.
  const m = (model || '').trim()
  const s = readSettings()
  if (provider === 'anthropic') s.anthropicModel = m
  else if (provider === 'openai') s.openaiModel = m
  else if (provider === 'free') s.freeModel = m
  else s.ollamaModel = m
  writeSettings(s)
  return getSettings()
}

export function setApiKey(provider: LLMProviderId, rawKey: string): ProviderSettings {
  const s = readSettings()
  const enc = rawKey ? encrypt(rawKey) : null
  if (provider === 'anthropic') s.anthropicKeyEnc = enc
  else if (provider === 'openai') s.openaiKeyEnc = enc
  // 'free' and 'ollama' carry no API key — ignore rather than misrouting the value
  // into the OpenAI slot (which would silently clobber a real OpenAI key).
  writeSettings(s)
  return getSettings()
}

export function getDecryptedKey(provider: LLMProviderId): string | null {
  const s = readSettings()
  const enc = provider === 'anthropic' ? s.anthropicKeyEnc : s.openaiKeyEnc
  if (!enc) return null
  return decrypt(enc)
}

export function getModel(provider: LLMProviderId): string {
  const s = readSettings()
  if (provider === 'anthropic') return s.anthropicModel
  if (provider === 'openai') return s.openaiModel
  if (provider === 'free') return s.freeModel
  return s.ollamaModel
}

export function setYouTubeApiKey(rawKey: string): ProviderSettings {
  const s = readSettings()
  s.youtubeKeyEnc = rawKey ? encrypt(rawKey) : null
  writeSettings(s)
  return getSettings()
}

export function getYouTubeApiKey(): string | null {
  const s = readSettings()
  if (!s.youtubeKeyEnc) return null
  return decrypt(s.youtubeKeyEnc)
}

export function setHordeApiKey(rawKey: string): ProviderSettings {
  const s = readSettings()
  s.hordeKeyEnc = rawKey ? encrypt(rawKey) : null
  writeSettings(s)
  return getSettings()
}

export function getHordeApiKey(): string | null {
  const s = readSettings()
  if (!s.hordeKeyEnc) return null
  return decrypt(s.hordeKeyEnc)
}

export function setMvsepToken(rawKey: string): ProviderSettings {
  const s = readSettings()
  s.mvsepTokenEnc = rawKey ? encrypt(rawKey) : null
  writeSettings(s)
  return getSettings()
}

export function getMvsepToken(): string | null {
  const s = readSettings()
  if (!s.mvsepTokenEnc) return null
  return decrypt(s.mvsepTokenEnc)
}

export function setDemucsCmd(cmd: string): ProviderSettings {
  const s = readSettings()
  s.demucsCmd = cmd || ''
  writeSettings(s)
  return getSettings()
}

export function getDemucsCmd(): string {
  return readSettings().demucsCmd || ''
}

export function setFaceAnimCmd(cmd: string): ProviderSettings {
  const s = readSettings()
  s.faceAnimCmd = cmd || ''
  writeSettings(s)
  return getSettings()
}

export function getFaceAnimCmd(): string {
  return readSettings().faceAnimCmd || ''
}

export function setYouTubeChannelId(id: string): ProviderSettings {
  const s = readSettings()
  s.youtubeChannelId = id || ''
  writeSettings(s)
  return getSettings()
}

export function getYouTubeChannelId(): string {
  return readSettings().youtubeChannelId || ''
}

function readLibrary(): LibraryEntry[] {
  try {
    const raw = readFileSync(libraryPath(), 'utf-8')
    return JSON.parse(raw)
  } catch {
    return []
  }
}

function writeLibrary(entries: LibraryEntry[]): void {
  atomicWrite(libraryPath(), JSON.stringify(entries, null, 2))
}

export function listLibrary(): LibraryEntry[] {
  return readLibrary().sort((a, b) => b.savedAt.localeCompare(a.savedAt))
}

export function saveToLibrary(entry: LibraryEntry): LibraryEntry[] {
  const entries = readLibrary()
  entries.push(entry)
  writeLibrary(entries)
  return listLibrary()
}

/**
 * Trash Can semantics: "delete" in the UI only MOVES an entry to the Trash (reversible).
 * Nothing is removed from disk until the user explicitly deletes forever / empties the
 * Trash — the same only-the-user-can-destroy rule the activity log follows.
 */
export function trashLibraryEntry(id: string): LibraryEntry[] {
  const entries = readLibrary()
  const hit = entries.find((e) => e.id === id)
  if (hit) hit.trashedAt = new Date().toISOString()
  writeLibrary(entries)
  return listLibrary()
}

export function restoreLibraryEntry(id: string): LibraryEntry[] {
  const entries = readLibrary()
  const hit = entries.find((e) => e.id === id)
  if (hit) delete hit.trashedAt
  writeLibrary(entries)
  return listLibrary()
}

/** Permanent removal — only ever called from the explicit user-initiated IPC handlers. */
export function deleteFromLibrary(id: string): LibraryEntry[] {
  const entries = readLibrary().filter((e) => e.id !== id)
  writeLibrary(entries)
  return listLibrary()
}

/** Permanently removes every trashed entry — only from the user's "Empty Trash" click. */
export function emptyLibraryTrash(): LibraryEntry[] {
  const entries = readLibrary().filter((e) => !e.trashedAt)
  writeLibrary(entries)
  return listLibrary()
}

function readActivityLog(): ActivityLogEntry[] {
  try {
    const raw = readFileSync(activityLogPath(), 'utf-8')
    return JSON.parse(raw)
  } catch {
    return []
  }
}

function writeActivityLog(entries: ActivityLogEntry[]): void {
  atomicWrite(activityLogPath(), JSON.stringify(entries, null, 2))
}

/**
 * Append-only by design: this is the ONLY function anywhere in the app that
 * writes to the activity log, and it only ever adds entries. There is no
 * automatic pruning/rotation. The sole way entries disappear is the user
 * explicitly clicking "Clear Log" in the UI, which calls clearActivityLog()
 * below — no generation/settings/IPC code path may call that function.
 */
export function logActivity(actor: ActivityActor, action: string, details?: string): void {
  const entries = readActivityLog()
  entries.push({ id: randomUUID(), timestamp: new Date().toISOString(), actor, action, details })
  writeActivityLog(entries)
}

export function listActivityLog(): ActivityLogEntry[] {
  return readActivityLog().sort((a, b) => b.timestamp.localeCompare(a.timestamp))
}

/** Only ever call this from the explicit user-initiated "Clear Log" IPC handler. */
export function clearActivityLog(): ActivityLogEntry[] {
  writeActivityLog([])
  return []
}

// ---------------------------------------------------------------------------
// Universal autosave: every tab's working state is persisted here (debounced from
// the renderer) so nothing is ever lost on close/restart, with a rolling version
// history per key so a previous version can be restored.
// ---------------------------------------------------------------------------
export interface DraftRecord {
  current: unknown
  history: { at: string; value: unknown }[]
}

function draftsPath(): string {
  return join(dataDir(), 'drafts.json')
}
function readDrafts(): Record<string, DraftRecord> {
  try {
    return JSON.parse(readFileSync(draftsPath(), 'utf-8'))
  } catch {
    return {}
  }
}
function writeDrafts(d: Record<string, DraftRecord>): void {
  atomicWrite(draftsPath(), JSON.stringify(d))
}

/** Returns a saved draft (current value + version history) for a key, or null. */
export function getDraft(key: string): DraftRecord | null {
  return readDrafts()[key] ?? null
}

/** Saves the current value for a key, pushing the prior value into a 10-deep history. */
export function setDraft(key: string, value: unknown): void {
  const all = readDrafts()
  const prev = all[key]
  const history = prev?.history ? [...prev.history] : []
  if (prev && JSON.stringify(prev.current) !== JSON.stringify(value)) {
    history.unshift({ at: new Date().toISOString(), value: prev.current })
  }
  all[key] = { current: value, history: history.slice(0, 10) }
  writeDrafts(all)
}

function chatPath(): string {
  return join(dataDir(), 'advisor-chat.json')
}

function readChat(): ChatMessage[] {
  try {
    return JSON.parse(readFileSync(chatPath(), 'utf-8'))
  } catch {
    return []
  }
}

function writeChat(messages: ChatMessage[]): void {
  atomicWrite(chatPath(), JSON.stringify(messages, null, 2))
}

/** Advisor conversation is durable memory: append-only except for the user's own explicit deletes below. */
export function listChat(): ChatMessage[] {
  return readChat()
}

export function appendChat(message: ChatMessage): ChatMessage[] {
  const messages = readChat()
  messages.push(message)
  writeChat(messages)
  return messages
}

/** Deletes one message by id — only ever reachable from an explicit user action in the UI. */
export function deleteChatMessage(id: string): ChatMessage[] {
  const messages = readChat().filter((m) => m.id !== id)
  writeChat(messages)
  return messages
}

/** Clears the whole advisor conversation — only from the user's explicit "Clear" action. */
export function clearChat(): ChatMessage[] {
  writeChat([])
  return []
}

function scriptPadPath(): string {
  return join(dataDir(), 'scriptpad.json')
}

/**
 * The free-write scratchpad. A single persisted document (title + body) the user
 * can write in freely and send straight to the Video Generator. Autosaved from
 * the renderer; travels with userData in portable mode.
 */
export function getScriptPad(): ScriptPad {
  try {
    const raw = readFileSync(scriptPadPath(), 'utf-8')
    const parsed = JSON.parse(raw)
    return {
      title: typeof parsed.title === 'string' ? parsed.title : '',
      body: typeof parsed.body === 'string' ? parsed.body : '',
      updatedAt: typeof parsed.updatedAt === 'string' ? parsed.updatedAt : ''
    }
  } catch {
    return { title: '', body: '', updatedAt: '' }
  }
}

export function saveScriptPad(title: string, body: string): ScriptPad {
  const pad: ScriptPad = { title, body, updatedAt: new Date().toISOString() }
  atomicWrite(scriptPadPath(), JSON.stringify(pad, null, 2))
  return pad
}

/** Where built videos are auto-saved ("memory"). Travels with userData (see index.ts portability). */
export function videosDir(): string {
  const dir = join(dataDir(), 'videos')
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true })
  return dir
}

/** Cache for procedurally generated music/SFX (so identical requests are instant). */
export function generatedAudioDir(): string {
  const dir = join(dataDir(), 'generated-audio')
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true })
  return dir
}

/** Where generated thumbnail images are saved. */
export function thumbnailsDir(): string {
  const dir = join(dataDir(), 'thumbnails')
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true })
  return dir
}

function aiVideoConfigPath(): string {
  return join(dataDir(), 'ai-video.json')
}

/**
 * Reads the AI-footage engine config. The cloud key is returned DECRYPTED in
 * `cloudApiKey` for in-process use; at rest it lives encrypted in `cloudApiKeyEnc`
 * like every other key in the app. A legacy file with a plain `cloudApiKey` (the one
 * credential that historically skipped encrypt()) is migrated in place on first read.
 */
export function getAiVideoConfig(): AiVideoConfig {
  try {
    const raw = JSON.parse(readFileSync(aiVideoConfigPath(), 'utf-8')) as AiVideoConfig
    if (raw.cloudApiKey && !raw.cloudApiKeyEnc) {
      // One-time migration: encrypt the legacy plain key at rest.
      raw.cloudApiKeyEnc = encrypt(raw.cloudApiKey)
      const onDisk = { ...raw }
      delete onDisk.cloudApiKey
      atomicWrite(aiVideoConfigPath(), JSON.stringify(onDisk, null, 2))
    }
    return {
      ...raw,
      cloudApiKey: raw.cloudApiKeyEnc ? decrypt(raw.cloudApiKeyEnc) || undefined : raw.cloudApiKey,
      pollinationsKey: raw.pollinationsKeyEnc ? decrypt(raw.pollinationsKeyEnc) || undefined : undefined
    }
  } catch {
    return {}
  }
}

export function setAiVideoConfig(partial: AiVideoConfig): AiVideoConfig {
  const current = getAiVideoConfig()
  const next: AiVideoConfig = { ...current, ...partial }
  // Never persist a decrypted form; encrypt any newly supplied key.
  const onDisk = { ...next }
  if (partial.cloudApiKey) onDisk.cloudApiKeyEnc = encrypt(partial.cloudApiKey)
  if (partial.pollinationsKey) onDisk.pollinationsKeyEnc = encrypt(partial.pollinationsKey)
  delete onDisk.cloudApiKey
  delete onDisk.pollinationsKey
  atomicWrite(aiVideoConfigPath(), JSON.stringify(onDisk, null, 2))
  return {
    ...onDisk,
    cloudApiKey: onDisk.cloudApiKeyEnc ? decrypt(onDisk.cloudApiKeyEnc) || undefined : undefined,
    pollinationsKey: onDisk.pollinationsKeyEnc ? decrypt(onDisk.pollinationsKeyEnc) || undefined : undefined
  }
}

function templatesPath(): string {
  return join(dataDir(), 'templates.json')
}

export interface ScriptTemplate {
  id: string
  name: string
  title: string
  body: string
  createdAt: string
}

/** Reusable script/video structures ("hook → context → analysis → takeaway…"). */
export function listTemplates(): ScriptTemplate[] {
  try {
    const raw = JSON.parse(readFileSync(templatesPath(), 'utf-8'))
    return Array.isArray(raw) ? raw : []
  } catch {
    return []
  }
}

export function saveTemplate(name: string, title: string, body: string): ScriptTemplate[] {
  const all = listTemplates()
  all.unshift({
    id: `tpl-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    name: name.slice(0, 60) || 'Untitled template',
    title,
    body,
    createdAt: new Date().toISOString()
  })
  atomicWrite(templatesPath(), JSON.stringify(all.slice(0, 100), null, 2))
  return listTemplates()
}

/** User-initiated only — the UI confirms before calling (same rule as every delete). */
export function deleteTemplate(id: string): ScriptTemplate[] {
  const all = listTemplates().filter((t) => t.id !== id)
  atomicWrite(templatesPath(), JSON.stringify(all, null, 2))
  return all
}

function stockConfigPath(): string {
  return join(dataDir(), 'stock.json')
}

/** Free stock-footage API keys (Pixabay/Pexels). Obfuscated at rest like other keys. */
export function getStockConfig(): { pixabayKey?: string; pexelsKey?: string } {
  try {
    const raw = JSON.parse(readFileSync(stockConfigPath(), 'utf-8'))
    return {
      pixabayKey: raw.pixabayKeyEnc ? decrypt(raw.pixabayKeyEnc) : undefined,
      pexelsKey: raw.pexelsKeyEnc ? decrypt(raw.pexelsKeyEnc) : undefined
    }
  } catch {
    return {}
  }
}

export function setStockKey(provider: 'pixabay' | 'pexels', key: string): { hasPixabay: boolean; hasPexels: boolean } {
  let raw: { pixabayKeyEnc?: string | null; pexelsKeyEnc?: string | null } = {}
  try {
    raw = JSON.parse(readFileSync(stockConfigPath(), 'utf-8'))
  } catch {
    /* start fresh */
  }
  const enc = key ? encrypt(key) : null
  if (provider === 'pixabay') raw.pixabayKeyEnc = enc
  else raw.pexelsKeyEnc = enc
  atomicWrite(stockConfigPath(), JSON.stringify(raw, null, 2))
  return { hasPixabay: !!raw.pixabayKeyEnc, hasPexels: !!raw.pexelsKeyEnc }
}

function djPlansPath(): string {
  return join(dataDir(), 'dj-plans.json')
}

/** Named DJ-station timeline arrangements. Append/replace/delete only via user action. */
export function listDjPlans(): AudioPlan[] {
  try {
    return JSON.parse(readFileSync(djPlansPath(), 'utf-8'))
  } catch {
    return []
  }
}

export function saveDjPlan(plan: AudioPlan): AudioPlan[] {
  const plans = listDjPlans().filter((p) => p.id !== plan.id)
  plans.push(plan)
  atomicWrite(djPlansPath(), JSON.stringify(plans, null, 2))
  return plans
}

export function deleteDjPlan(id: string): AudioPlan[] {
  const plans = listDjPlans().filter((p) => p.id !== id)
  atomicWrite(djPlansPath(), JSON.stringify(plans, null, 2))
  return plans
}

function videosIndexPath(): string {
  return join(dataDir(), 'videos.json')
}

function readVideos(): VideoJob[] {
  try {
    return JSON.parse(readFileSync(videosIndexPath(), 'utf-8'))
  } catch {
    return []
  }
}

function writeVideos(jobs: VideoJob[]): void {
  atomicWrite(videosIndexPath(), JSON.stringify(jobs, null, 2))
}

export function listVideos(): VideoJob[] {
  return readVideos().sort((a, b) => b.createdAt.localeCompare(a.createdAt))
}

export function appendVideo(job: VideoJob): VideoJob[] {
  const jobs = readVideos()
  jobs.push(job)
  writeVideos(jobs)
  return listVideos()
}

/**
 * Deletes a built video — only ever from an explicit user action. Removes both
 * the index entry and the underlying file on disk.
 */
export function deleteVideo(id: string): VideoJob[] {
  const jobs = readVideos()
  const job = jobs.find((j) => j.id === id)
  if (job) {
    try {
      rmSync(job.path, { force: true })
    } catch {
      // File may already be gone; removing the index entry is what matters.
    }
    // The saved narration-only track belongs to this video — a permanent delete
    // must not leave it behind as an orphan.
    if (job.narrationPath) {
      try {
        rmSync(job.narrationPath, { force: true })
      } catch {
        /* same rule: best effort */
      }
    }
  }
  writeVideos(jobs.filter((j) => j.id !== id))
  return listVideos()
}
