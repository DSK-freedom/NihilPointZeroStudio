import { useEffect, useState } from 'react'

/**
 * Mounted once in App. Shows a calm notice when a newer shipped build exists on
 * GitHub (the main process checks quietly on startup). One click reveals the
 * setup exe; dismiss hides it for the rest of this app session.
 */
export default function UpdateBanner(): React.JSX.Element | null {
  const [info, setInfo] = useState<{ remoteTag: string; localTag: string } | null>(null)
  const [dismissed, setDismissed] = useState(false)

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

  if (!info || dismissed) return null
  return (
    <div className="fixed bottom-16 left-1/2 -translate-x-1/2 z-[65] max-w-xl rounded-md border border-sky-700 bg-sky-950/95 px-4 py-2 text-sm text-sky-100 shadow-lg">
      <div className="flex items-center gap-3">
        <span aria-hidden>⬆</span>
        <div className="min-w-0 flex-1">
          <span className="font-medium">A newer version of the app exists</span>
          <span className="ml-1 text-xs text-sky-300/80">({info.remoteTag})</span>
          <div className="text-xs text-sky-300/80">
            One click below finds the update for you — then one double-click installs it.
          </div>
        </div>
        <button
          onClick={() => void window.api.updates.revealSetup(info.remoteTag)}
          className="shrink-0 rounded bg-sky-600 hover:bg-sky-500 text-white text-[11px] font-medium px-2.5 py-1"
        >
          Get the update
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
