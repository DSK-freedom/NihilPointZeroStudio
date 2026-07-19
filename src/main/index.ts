import { app, BrowserWindow, shell } from 'electron'
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
const portableDir = process.env.PORTABLE_EXECUTABLE_DIR
if (portableDir) {
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

    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) createWindow()
    })
  })
}

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})
