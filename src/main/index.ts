import { app, BrowserWindow, shell } from 'electron'
import { checkForUpdate } from './updateCheck'
import { runAutoBackupIfDue } from './autoBackup'
import { runHealthCheck } from './health'
import { scanStranded } from './strandedData'
import { decideDataHome, holdsUserWork, isUsableDir, readPin, writePin } from './dataHome'
import { getLastHealth, logActivity, setLastHealth } from './store'
import { join } from 'path'
import { registerIpcHandlers } from './ipc'
import { captureHandlers } from './remote/registry'
import { attachRemoteEvents } from './remote/events'
import { installCrashReporting } from './crashReport'
import { recoverQueueOnStartup } from './renderQueueRunner'
import { logAiError } from './llm/errorLog'
import { dialog } from 'electron'

// E2E harness (scripts/e2e-smoke.mjs, the ship gate): a fully ISOLATED data home so
// the click-through suite can NEVER touch real user data — it outranks every other
// rule below. It also silences the update check and auto-backup (network/disk noise
// a test run must not produce).
const e2eUserData = process.env.NPZ_E2E_USERDATA

// WHERE THE USER'S WORK LIVES. Decided ONCE and written down (see main/dataHome.ts) —
// the app no longer re-derives this on every launch, which is what used to move it to
// a different folder and make every earlier video vanish from the UI.
let dataHomeNotice: string | undefined
{
  const defaultDir = join(app.getPath('appData'), app.getName())
  const portableDir = process.env.PORTABLE_EXECUTABLE_DIR
  const portableCandidate = portableDir ? join(portableDir, 'nihilpointzero-data') : undefined
  let desktopDir: string | undefined
  try {
    desktopDir = join(app.getPath('desktop'), 'NihilPointZeroStudio', 'nihilpointzero-data')
  } catch {
    /* no Desktop on this machine — the default folder still works */
  }
  const pinnedDir = e2eUserData || portableDir ? null : readPin(defaultDir)
  const choice = decideDataHome({
    e2eDir: e2eUserData,
    portableDir,
    portableCandidate,
    // Usable when writable OR already holding work (a read-only CD still must not
    // strand data that is already sitting there).
    portableUsable: portableCandidate
      ? isUsableDir(portableCandidate) || holdsUserWork(portableCandidate)
      : false,
    pinnedDir,
    pinnedUsable: pinnedDir ? isUsableDir(pinnedDir) : false,
    desktopDir,
    desktopHasData: desktopDir ? holdsUserWork(desktopDir) : false,
    defaultDir
  })
  if (choice.dir !== defaultDir) app.setPath('userData', choice.dir)
  if (choice.pin) writePin(defaultDir, choice.dir)
  dataHomeNotice = choice.notice
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

  // Lets a phone running the studio see the same live progress the desktop sees.
  // Everything still reaches this window first and unchanged; see remote/events.ts.
  attachRemoteEvents(mainWindow.webContents)

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

  // BEFORE anything else can throw. A tab crash is already caught by ErrorBoundary; an
  // unhandled error in THIS process had no handler at all — Electron tears the process
  // down and the window simply vanishes, leaving nothing to show anyone. That is the only
  // failure in the app that left no evidence.
  installCrashReporting({
    record: (entry) => logAiError(entry),
    notify: (message) => {
      // showErrorBox works with no window, which is the case that matters most — a crash
      // during startup, before there is anything to put a message inside.
      try {
        dialog.showErrorBox('NIHILPOINTZERO-OS has to close', message)
      } catch {
        /* nothing left to show it with */
      }
    },
    onFatal: () => {
      // The process state is unknown after this, and carrying on risks writing corrupted
      // data over the user's work. Recorded, told, and let go.
      app.exit(1)
    }
  })

  // Pick up anything the last session left half-rendered. Before the window exists, so an
  // interrupted item is already back in the queue by the time anything can look at it.
  try {
    const { recovered } = recoverQueueOnStartup()
    if (recovered) {
      logActivity('ai', `Put ${recovered} interrupted render${recovered === 1 ? '' : 's'} back in the queue`)
    }
  } catch {
    // A queue that cannot be read must never stop the app from starting.
  }

  app.whenReady().then(() => {
    // Registers exactly as before, and additionally remembers each handler so the same
    // function can be called from the phone. See remote/registry.ts for why it is
    // wrapped here rather than edited into all 157 registrations.
    captureHandlers(registerIpcHandlers)
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

      // The recorded work folder could not be reached this launch (drive unplugged,
      // folder renamed). Never let that pass silently — it looks exactly like "all my
      // work is gone" from the user's side.
      if (dataHomeNotice) {
        try {
          logActivity('ai', 'Your usual work folder could not be reached', dataHomeNotice)
        } catch {
          /* logging must never block startup */
        }
      }

      // Work stranded in a data folder the app is NOT using is invisible in the UI —
      // that really happened (1.15 GB of finished videos). Say so in the Activity Log
      // so it is discoverable without opening Settings. Quiet when there is nothing.
      setTimeout(() => {
        void (async () => {
        try {
          const s = await scanStranded()
          if (s.videoCount > 0) {
            logActivity(
              'ai',
              `Found ${s.videoCount} finished video(s) (${s.size}) that Video Studio isn't showing`,
              `They are NOT lost. Open Settings → "Where your work is kept" and press "Show these in Video Studio".` +
                `${s.inPlace ? ` ${s.inPlace} are already in your work folder (the list just lost track of them).` : ''}` +
                `${s.dir ? ` ${s.elsewhere} are in a folder the app no longer uses: ${s.dir}` : ''}`
            )
          }
        } catch {
          /* a failed look must never bother the user */
        }
        })()
      }, 45_000)

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
