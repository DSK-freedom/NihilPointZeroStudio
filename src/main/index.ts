import { app, BrowserWindow, shell } from 'electron'
import { checkForUpdate } from './updateCheck'
import { runAutoBackupIfDue } from './autoBackup'
import { runHealthCheck } from './health'
import { getLastHealth, logActivity, setLastHealth } from './store'
import { join } from 'path'
import { existsSync, mkdirSync, writeFileSync, rmSync } from 'fs'
import { registerIpcHandlers } from './ipc'

// Portable mode: when launched from the electron-builder portable target,
// PORTABLE_EXECUTABLE_DIR is the folder the .exe sits in. Prefer to keep ALL user
// data (settings, library, advisor memory, built videos) next to the executable
// so it travels with the USB stick / copied folder instead of living in %APPDATA%.
//
// BUT that folder can be read-only — e.g. the exe was burned to a CD/DVD or copied
// into a locked/protected directory. Writing there would throw and the app would
// fail to launch. So we probe writability first and only redirect userData when
// the location is actually writable; otherwise we leave it at the default per-user
// dir (always writable) so the app still runs. Must run before anything reads
// getPath('userData').
// E2E harness (scripts/e2e-smoke.mjs, the ship gate): a fully ISOLATED data home so
// the click-through suite can NEVER touch real user data — it must win over both the
// portable redirect and the Desktop-adoption below. Also silences the update check
// and auto-backup (network/disk noise a test run must not produce).
const e2eUserData = process.env.NPZ_E2E_USERDATA
if (e2eUserData) app.setPath('userData', e2eUserData)

const portableDir = process.env.PORTABLE_EXECUTABLE_DIR
if (e2eUserData) {
  /* isolated E2E data home already set above — skip all adoption logic */
} else if (portableDir) {
  const candidate = join(portableDir, 'nihilpointzero-data')
  // Does the portable folder already hold this user's data? If so we MUST use it —
  // never strand videos/settings there and silently start fresh in %APPDATA%.
  const hasPriorData = existsSync(join(candidate, 'settings.json')) || existsSync(join(candidate, 'videos.json'))
  let writable = false
  try {
    mkdirSync(candidate, { recursive: true })
    // PID-unique probe: multiple instances launching together must NOT collide on the
    // same '.write-test' file (that false "not writable" was pushing data into %APPDATA%).
    const probe = join(candidate, `.write-test-${process.pid}`)
    writeFileSync(probe, 'ok')
    rmSync(probe, { force: true })
    writable = true
  } catch {
    /* transient lock or truly read-only */
  }
  // Use the portable folder when it's writable OR already contains the user's data.
  // Only fall back to the per-user dir if it's BOTH unwritable AND empty (e.g. CD/DVD).
  if (writable || hasPriorData) {
    app.setPath('userData', candidate)
  }
} else {
  // Installed (non-portable) build: if the classic studio folder on the Desktop already
  // holds the user's data, ADOPT it instead of starting fresh in %APPDATA%. The installed
  // app and the portable exe then share ONE data home — videos, scripts and settings made
  // in either flavor appear in both, and the folder still travels on a USB as before.
  // (Only the canonical documented location is probed; no disk scanning.)
  try {
    const desktopData = join(app.getPath('desktop'), 'NihilPointZeroStudio', 'nihilpointzero-data')
    const hasDesktopData =
      existsSync(join(desktopData, 'settings.json')) || existsSync(join(desktopData, 'videos.json'))
    if (hasDesktopData) {
      app.setPath('userData', desktopData)
    }
  } catch {
    /* Desktop path unavailable (rare) — keep the default per-user dir. */
  }
}

function createWindow(): void {
  const mainWindow = new BrowserWindow({
    width: 1280,
    height: 860,
    minWidth: 960,
    minHeight: 640,
    show: false,
    title: 'NIHILPOINTZERO-OS',
    autoHideMenuBar: true,
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      // Set explicitly (not left to Electron's defaults) so the security posture can't
      // silently change across framework upgrades. The renderer only ever loads our own
      // local files, and the preload uses ONLY contextBridge + ipcRenderer (both fully
      // sandbox-compatible), so the Chromium sandbox stays ON as defence in depth.
      sandbox: true,
      contextIsolation: true,
      nodeIntegration: false
    }
  })

  mainWindow.on('ready-to-show', () => {
    mainWindow.show()
  })

  mainWindow.webContents.setWindowOpenHandler((details) => {
    shell.openExternal(details.url)
    return { action: 'deny' }
  })

  if (!app.isPackaged && process.env['ELECTRON_RENDERER_URL']) {
    mainWindow.loadURL(process.env['ELECTRON_RENDERER_URL'])
  } else {
    mainWindow.loadFile(join(__dirname, '../renderer/index.html'))
  }
}

// Prevent a second copy from launching against the same user-data dir (which
// otherwise produces cache-lock errors); focus the existing window instead.
const gotLock = app.requestSingleInstanceLock()
if (!gotLock) {
  app.quit()
} else {
  app.on('second-instance', () => {
    const [win] = BrowserWindow.getAllWindows()
    if (win) {
      if (win.isMinimized()) win.restore()
      win.focus()
    }
  })

  app.whenReady().then(() => {
    registerIpcHandlers()
    createWindow()

    // Quiet, delayed check for a newer shipped build (silent when offline/failing),
    // and the weekly copy-only backup — both skipped under the E2E harness, which
    // must not touch the network or write anything outside its isolated data home.
    if (!e2eUserData) {
      setTimeout(() => {
        void checkForUpdate()
      }, 8000)

      // Weekly copy-only backup of the user's work (at most once every 7 days).
      // Delayed well past first paint so it never competes with app startup.
      setTimeout(() => {
        void runAutoBackupIfDue()
      }, 30_000)

      // Weekly QUIET health check: the manual "Run full check" only helps when the
      // user remembers it. This runs the same live checks in the background, stores
      // the verdict (Settings shows a red badge when something is actually broken),
      // and writes a plain-English line to the Activity Log. Never blocks startup.
      setTimeout(() => {
        void (async () => {
          try {
            const last = getLastHealth()
            const lastAt = last.at ? Date.parse(last.at) : NaN
            if (!Number.isNaN(lastAt) && Date.now() - lastAt < 7 * 24 * 60 * 60 * 1000) return
            const report = await runHealthCheck()
            const failed = report.checks.filter((c) => c.status === 'fail').map((c) => c.name)
            setLastHealth(failed)
            if (failed.length) {
              logActivity(
                'ai',
                `Weekly self-check found ${failed.length} problem(s): ${failed.join(', ')}`,
                'Open Settings → "Run full check" for details and fixes. Everything else keeps working.'
              )
            }
          } catch {
            /* a failed self-check must never bother the user */
          }
        })()
      }, 90_000)
    }

    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) createWindow()
    })
  })
}

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})
