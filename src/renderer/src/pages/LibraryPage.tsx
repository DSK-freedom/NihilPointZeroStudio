import { useEffect, useState } from 'react'
import type { GeneratedScript, LibraryEntry, VideoIdea } from '../../../shared/types'
import { toast } from '../components/Toast'
import { confirmDialog } from '../components/Confirm'

export default function LibraryPage() {
  const [entries, setEntries] = useState<LibraryEntry[]>([])
  const [selected, setSelected] = useState<LibraryEntry | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    window.api.library.list().then((list) => {
      setEntries(list)
      setLoading(false)
    })
  }, [])

  async function handleDelete(id: string): Promise<void> {
    const ok = await confirmDialog({
      title: 'Delete this item?',
      message: 'This permanently removes the saved item from your library. This cannot be undone.',
      danger: true
    })
    if (!ok) return
    const updated = await window.api.library.remove(id)
    setEntries(updated)
    if (selected?.id === id) setSelected(null)
    toast('Item deleted', 'info')
  }

  async function handleExport(entry: LibraryEntry): Promise<void> {
    if (entry.kind !== 'script') return
    const script = entry.data as GeneratedScript
    const fileName = `${script.title.replace(/[^a-z0-9]+/gi, '-').toLowerCase()}.txt`
    try {
      const res = await window.api.exportText(fileName, `${script.title}\n\n${script.body}`)
      if (res.saved) toast(`Exported to ${res.path}`, 'success')
      else if (res.error) toast(`Export failed: ${res.error}`, 'error')
    } catch (err) {
      toast(err instanceof Error ? err.message : 'Export failed', 'error')
    }
  }

  return (
    <div className="max-w-6xl mx-auto p-8">
      <h1 className="text-2xl font-serif text-ink-100">Library</h1>
      <p className="text-ink-400 text-sm mt-1">Saved ideas and scripts, stored locally on this machine.</p>

      {loading ? (
        <p className="mt-6 text-ink-400 text-sm">Loading…</p>
      ) : entries.length === 0 ? (
        <p className="mt-6 text-ink-600 text-sm">Nothing saved yet.</p>
      ) : (
        <div className="mt-6 grid grid-cols-1 lg:grid-cols-3 gap-6">
          <div className="lg:col-span-1 space-y-2">
            {entries.map((entry) => {
              const title = entry.kind === 'idea' ? (entry.data as VideoIdea).title : (entry.data as GeneratedScript).title
              return (
                <button
                  key={entry.id}
                  onClick={() => setSelected(entry)}
                  className={`w-full text-left rounded-md border px-3 py-2 text-sm transition-colors ${
                    selected?.id === entry.id
                      ? 'border-gold-500 bg-ink-800 text-ink-100'
                      : 'border-ink-700 bg-ink-900 text-ink-300 hover:border-ink-500'
                  }`}
                >
                  <div className="flex items-center justify-between gap-2">
                    <span className="truncate">{title}</span>
                    <span className="shrink-0 text-[10px] uppercase tracking-wide text-ink-500">{entry.kind}</span>
                  </div>
                  <div className="text-[11px] text-ink-600 mt-0.5">
                    {new Date(entry.savedAt).toLocaleString()}
                  </div>
                </button>
              )
            })}
          </div>

          <div className="lg:col-span-2">
            {selected ? (
              <div className="rounded-lg border border-ink-700 bg-ink-900 p-4">
                {selected.kind === 'idea' ? (
                  <IdeaDetail idea={selected.data as VideoIdea} />
                ) : (
                  <ScriptDetail script={selected.data as GeneratedScript} />
                )}
                <div className="flex gap-2 mt-4">
                  {selected.kind === 'script' && (
                    <button
                      onClick={() => handleExport(selected)}
                      className="rounded-md border border-ink-600 hover:border-ink-400 text-ink-200 text-sm px-4 py-1.5 transition-colors"
                    >
                      Export .txt
                    </button>
                  )}
                  <button
                    onClick={() => handleDelete(selected.id)}
                    className="rounded-md border border-red-500/40 text-red-300 hover:border-red-400 text-sm px-4 py-1.5 transition-colors"
                  >
                    Delete
                  </button>
                </div>
              </div>
            ) : (
              <div className="rounded-lg border border-dashed border-ink-700 h-full min-h-[300px] flex items-center justify-center text-ink-600 text-sm">
                Select an item to view details.
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  )
}

function IdeaDetail({ idea }: { idea: VideoIdea }) {
  return (
    <div className="space-y-2">
      <h2 className="text-lg font-medium text-ink-100">{idea.title}</h2>
      <p className="text-sm text-ink-400 italic">&ldquo;{idea.hook}&rdquo;</p>
      <p className="text-sm text-ink-200">{idea.angle}</p>
      <p className="text-xs text-ink-400 border-l-2 border-gold-500/40 pl-2">{idea.viewPotentialReason}</p>
      <div className="text-xs text-ink-400">
        Score {idea.viewPotentialScore}/10 · {idea.competitionLevel} competition · {idea.suggestedLength}
      </div>
    </div>
  )
}

function ScriptDetail({ script }: { script: GeneratedScript }) {
  return (
    <div>
      <div className="flex items-start justify-between gap-3">
        <h2 className="text-lg font-medium text-ink-100">{script.title}</h2>
        <div className="text-xs text-ink-400 shrink-0 text-right">
          {script.estimatedWordCount} words · ~{script.estimatedDurationMinutes} min
        </div>
      </div>
      <pre className="mt-3 whitespace-pre-wrap font-serif text-sm text-ink-200 leading-relaxed max-h-[500px] overflow-y-auto">
        {script.body}
      </pre>
    </div>
  )
}
