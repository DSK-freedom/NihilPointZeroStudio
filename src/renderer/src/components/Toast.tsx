import { useEffect, useState } from 'react'

export type ToastKind = 'success' | 'error' | 'info'
interface ToastItem {
  id: number
  msg: string
  kind: ToastKind
}

let listeners: ((t: ToastItem) => void)[] = []
let seq = 0

/** Show a transient toast from anywhere: toast('Done', 'success'). */
export function toast(msg: string, kind: ToastKind = 'info'): void {
  const item = { id: ++seq, msg, kind }
  listeners.forEach((l) => l(item))
}

/** Mount once (in App). Renders stacked, auto-dismissing toasts bottom-right. */
export default function ToastHost(): React.JSX.Element {
  const [items, setItems] = useState<ToastItem[]>([])
  useEffect(() => {
    const l = (t: ToastItem): void => {
      setItems((prev) => [...prev, t])
      setTimeout(() => setItems((prev) => prev.filter((x) => x.id !== t.id)), 4000)
    }
    listeners.push(l)
    return () => {
      listeners = listeners.filter((x) => x !== l)
    }
  }, [])

  return (
    <div className="fixed bottom-4 left-1/2 -translate-x-1/2 z-[60] flex flex-col items-center gap-2 pointer-events-none">
      {items.map((t) => (
        <div
          key={t.id}
          onClick={() => setItems((prev) => prev.filter((x) => x.id !== t.id))}
          className={`pointer-events-auto cursor-pointer max-w-md rounded-md border px-4 py-2 text-sm shadow-lg ${
            t.kind === 'success'
              ? 'border-emerald-600 bg-emerald-950/90 text-emerald-200'
              : t.kind === 'error'
                ? 'border-red-700 bg-red-950/90 text-red-200'
                : 'border-ink-600 bg-ink-900/95 text-ink-100'
          }`}
        >
          {t.kind === 'success' ? '✓ ' : t.kind === 'error' ? '⚠ ' : ''}
          {t.msg}
        </div>
      ))}
    </div>
  )
}
