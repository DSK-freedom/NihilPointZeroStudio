/**
 * Weekly, silent, copy-only backup of the user's WORK.
 *
 * BACKUP-NOW.cmd exists for manual runs, but a backup that depends on remembering
 * isn't a backup. This runs a while after startup, at most once every 7 days.
 *
 * Rules that must never be relaxed:
 *  - COPY ONLY. Nothing in the source is modified or removed, and files deleted from
 *    the source are LEFT in the backup (no mirror/purge semantics).
 *  - SECRETS ARE NEVER COPIED. In portable mode API keys are stored reversibly
 *    (`plain:<base64>`), and the data folder doubles as the Chromium profile. Copying
 *    that into Documents — which may be OneDrive-synced — would push recoverable
 *    credentials off the machine. So this uses an ALLOWLIST of user-work items:
 *    settings/keys and all browser-profile state are deliberately excluded.
 *  - NEVER report success it didn't achieve: if any file failed, the 7-day stamp is
 *    NOT written (so the next launch retries) and the Activity Log says so.
 *  - ASYNC. Uses fs/promises and yields between files so the app never freezes.
 *  - No size cap: the big finished videos are exactly what must be protected.
 */
import { app } from 'electron'
import { copyFile, mkdir, readdir, stat, writeFile } from 'fs/promises'
import { existsSync, readFileSync } from 'fs'
import { join } from 'path'
import { logActivity } from './store'

const WEEK_MS = 7 * 24 * 60 * 60 * 1000

/**
 * The user's actual work — files and folders worth protecting. Anything not named
 * here is skipped, which is what keeps credentials and browser state out of the copy.
 */
export const BACKUP_ALLOWLIST = [
  'videos', // finished renders (the irreplaceable, multi-GB ones)
  'thumbnails',
  'videos.json',
  'drafts.json',
  'library.json',
  'scriptpad.json',
  'advisor-chat.json',
  'activity-log.json',
  'dj-plans.json'
]

/** Never copied, even if a name above ever expands to include them. */
export const BACKUP_DENYLIST = [
  'settings.json', // contains API keys (reversible in portable mode)
  'stock.json', // contains the Pixabay/Pexels keys
  'Local State',
  'Preferences',
  'Local Storage',
  'Session Storage',
  'Network',
  'Cookies',
  'Cache',
  'Code Cache',
  'GPUCache',
  'DawnGraphiteCache',
  'DawnWebGPUCache',
  'blob_storage',
  'Shared Dictionary',
  'SharedStorage',
  'DIPS',
  'piper' // re-downloadable voice models, hundreds of MB
]

interface Stamp {
  lastRunAt?: string
}

function stampPath(): string {
  return join(app.getPath('userData'), 'last-auto-backup.json')
}

function readStamp(): Stamp {
  try {
    return JSON.parse(readFileSync(stampPath(), 'utf-8')) as Stamp
  } catch {
    return {}
  }
}

export function backupIsDue(now: number, lastRunAt?: string): boolean {
  if (!lastRunAt) return true
  const last = Date.parse(lastRunAt)
  if (Number.isNaN(last)) return true
  return now - last >= WEEK_MS
}

/** True when an entry may be copied (allowlisted at the top level, never denylisted). */
export function isBackupCandidate(name: string, topLevel: boolean): boolean {
  if (BACKUP_DENYLIST.includes(name)) return false
  if (name.endsWith('.tmp') || name === 'NihilPointZero-Backups') return false
  return topLevel ? BACKUP_ALLOWLIST.includes(name) : true
}

interface Counters {
  copied: number
  unchanged: number
  failed: number
}

/**
 * Async recursive copy that adds/updates only. Failures are counted, never swallowed
 * into a success. Symlinks/junctions are skipped (withFileTypes reports them as
 * neither file nor directory), so a loop can't be followed out of the tree.
 */
async function copyTree(src: string, dst: string, counters: Counters, topLevel = true): Promise<void> {
  await mkdir(dst, { recursive: true })
  const entries = await readdir(src, { withFileTypes: true })
  for (const entry of entries) {
    if (!isBackupCandidate(entry.name, topLevel)) continue
    const from = join(src, entry.name)
    const to = join(dst, entry.name)
    try {
      if (entry.isDirectory()) {
        await copyTree(from, to, counters, false)
      } else if (entry.isFile()) {
        const s = await stat(from)
        if (existsSync(to)) {
          const d = await stat(to)
          if (d.size === s.size && Math.abs(d.mtimeMs - s.mtimeMs) < 2000) {
            counters.unchanged++
            continue
          }
        }
        await copyFile(from, to)
        counters.copied++
      }
      // Anything else (symlink, junction, socket) is intentionally ignored.
    } catch {
      counters.failed++
    }
  }
}

/**
 * Runs a backup if one is due. Never throws. The stamp is written ONLY on a clean
 * run, so a failed backup retries on the next launch instead of going quiet for a week.
 */
export async function runAutoBackupIfDue(): Promise<{
  ran: boolean
  copied?: number
  unchanged?: number
  failed?: number
  reason?: string
}> {
  try {
    const stamp = readStamp()
    if (!backupIsDue(Date.now(), stamp.lastRunAt)) return { ran: false, reason: 'not due yet' }
    // userData IS the live data folder (index.ts repoints it for the portable copy),
    // so this always matches what the running app actually reads and writes.
    const src = app.getPath('userData')
    if (!existsSync(src)) return { ran: false, reason: 'data folder not found' }
    const dst = join(app.getPath('documents'), 'NihilPointZero-Backups', 'nihilpointzero-data')
    const counters: Counters = { copied: 0, unchanged: 0, failed: 0 }
    await copyTree(src, dst, counters)

    if (counters.failed > 0) {
      // Do NOT stamp: an incomplete backup must try again next launch.
      logActivity(
        'ai',
        `Automatic weekly backup INCOMPLETE — ${counters.failed} file(s) could not be copied (will retry next time you open the app)`,
        `Copied ${counters.copied}, already up to date ${counters.unchanged}. Destination: Documents\\NihilPointZero-Backups. Common causes: disk full, or a file in use.`
      )
      return { ran: true, ...counters }
    }

    await writeFile(stampPath(), JSON.stringify({ lastRunAt: new Date().toISOString() }, null, 2), 'utf-8')
    logActivity(
      'ai',
      `Automatic weekly backup done — ${counters.copied} new/changed file(s) copied, ${counters.unchanged} already up to date`,
      'Your videos, scripts, library and logs were copied to Documents\\NihilPointZero-Backups. Copy-only: nothing in your work folder was changed or deleted. For safety, API keys and browser data are deliberately NOT included.'
    )
    return { ran: true, ...counters }
  } catch (err) {
    try {
      logActivity('ai', 'Automatic weekly backup could not run', err instanceof Error ? err.message : String(err))
    } catch {
      /* logging must never throw either */
    }
    return { ran: false, reason: 'error' }
  }
}
