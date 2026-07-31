import { useEffect, useState } from 'react'

/**
 * Mounted once in App. Shows a calm notice when a newer shipped build exists.
 *
 * The click can NEVER look dead again (the old behavior's only effect was an
 * Explorer window that usually opened BEHIND the app — indistinguishable from a
 * broken button). Now:
 *  1. First try the instant path: the ship pipeline already swapped the installed
 *     app's code on disk, so a restart IS the update (main verifies before acting).
 *  2. Otherwise fall back to revealing the setup exe / download page — and SAY SO
 *     in the banner, so the user knows exactly what happened and where to look.
 */
export default function UpdateBanner(): React.JSX.Element | null {
  const [info, setInfo] = useState<{ remoteTag: string; localTag: string } | null>(null)
  const [dismissed, setDismissed] = useState(false)
  const [busy, setBusy] = useState(false)
  const [note, setNote] = useState<string | null>(null)

  useEffect(() => {
    const off = window.api.updates.onAvailable(setInfo)
    // Also pull: covers a renderer that mounted after the one-shot broadcast
    // (slow first paint, page reload).
    void window.api.updates.get().then((found) => {
      if (found) setInfo((cur) => cur ?? found)
    })
    return () => {
      off()
    }
  }, [])

  async function getUpdate(): Promise<void> {
    setBusy(true)
    setNote('Updating…')
    try {
      // Instant path: restart onto the already-updated code (installed app).
      const restarted = await window.api.updates.restart()
      if (restarted.ok) return // the app is relaunching — nothing more to say
      // Fallback: reveal the installer / download page, and narrate the result.
      const res = await window.api.updates.revealSetup(info?.remoteTag)
      setNote(
        res.opened === 'local'
          ? 'Opened the studio folder with the setup file selected — the window may be behind this one (check your taskbar). Double-click the setup file to update.'
          : 'Opened the download page in your browser — get the setup file there, then run it once.'
      )
    } catch {
      setNote('Could not start the update — the download page is github.com/DSKJazz/NihilPointZeroStudio/releases/latest')
    } finally {
      setBusy(false)
    }
  }

  if (!info || dismissed) return null
  return (
    <div className="fixed bottom-16 left-1/2 -translate-x-1/2 z-[65] max-w-xl rounded-md border border-sky-700 bg-sky-950/95 px-4 py-2 text-sm text-sky-100 shadow-lg">
      <div className="flex items-center gap-3">
        <span aria-hidden>⬆</span>
        <div className="min-w-0 flex-1">
          <span className="font-medium">A newer version of the app exists</span>
          <span className="ml-1 text-xs text-sky-300/80">({info.remoteTag})</span>
          <div className="text-xs text-sky-300/80">
            {note ?? 'One click below updates you — usually just a 2-second restart.'}
          </div>
        </div>
        <button
          onClick={() => void getUpdate()}
          disabled={busy}
          className="shrink-0 rounded bg-sky-600 hover:bg-sky-500 disabled:opacity-60 text-white text-[11px] font-medium px-2.5 py-1"
        >
          {busy ? 'Working…' : 'Get the update'}
        </button>
        <button
          onClick={() => setDismissed(true)}
          className="shrink-0 rounded px-2 py-0.5 text-sky-300 hover:bg-sky-900"
          aria-label="Dismiss"
        >
          ✕
        </button>
      </div>
    </div>
  )
}
