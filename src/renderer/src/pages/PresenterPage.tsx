import { useEffect, useMemo, useRef, useState } from 'react'
import { VIDEO_STYLES, type VideoStyle } from '../../../shared/types'
import MicButton, { appendDictation } from '../components/MicButton'
import { useAutosave } from '../hooks/useAutosave'
import { toast } from '../components/Toast'

type Mode = 'video' | 'photo' | 'graft'

const MODE_NOTE: Record<Mode, string> = {
  video:
    '🎥 Real Video Presenter (recommended). Upload a video of yourself narrating. Your REAL voice becomes the master track and your real face/lips appear as the on-camera moments — the rest cuts to theme b-roll + AI scenes on your voice. No fakery, real sync.',
  photo:
    '🖼 Photo Presenter. No video needed — your still photo appears (subtly moving, background-removed into the scene) on the presenter beats; the natural voice narrates. Good when you don’t want to film yourself.',
  graft:
    '🧪 Lip-graft (experimental). Same as Video, but presenter beats are flagged for an OPTIONAL local lip-graft tool you install yourself (heavy GPU deepfake). If the tool isn’t set up it simply uses your real clip. Since your video already has synced lips, Video mode is almost always better.'
}

/**
 * Presenter Studio — put YOU in the video. Pick a mode, add your video (or photo) + script,
 * and the AI intercuts you with theme b-roll (Pixabay) + AI scenes, your voice throughout.
 * Reuses the tested Storyboard engine under the hood.
 */
export default function PresenterPage(): React.JSX.Element {
  const [mode, setMode] = useState<Mode>('video')
  const [title, setTitle] = useState('')
  const [body, setBody] = useState('')
  const [style, setStyle] = useState<VideoStyle>('cinematic')
  const [presenterPath, setPresenterPath] = useState('')
  const [busy, setBusy] = useState(false)
  const [stage, setStage] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [note, setNote] = useState<string | null>(null)

  const unsub = useRef<(() => void) | null>(null)
  useEffect(() => {
    unsub.current = window.api.video.onProgress((s: string) => setStage(s))
    return () => unsub.current?.()
  }, [])

  // Autosave everything on this tab (script, mode, style, chosen file) so nothing is lost.
  const persisted = useMemo(
    () => ({ mode, title, body, style, presenterPath }),
    [mode, title, body, style, presenterPath]
  )
  const saveStatus = useAutosave('presenter-tab', persisted, (v) => {
    if (v.mode) setMode(v.mode)
    if (v.title != null) setTitle(v.title)
    if (v.body != null) setBody(v.body)
    if (v.style) setStyle(v.style)
    if (v.presenterPath != null) setPresenterPath(v.presenterPath)
  })

  const needsPhoto = mode === 'photo'
  const fileLabel = needsPhoto ? 'your photo' : 'your narration video'

  async function pick(): Promise<void> {
    setError(null)
    const p = needsPhoto ? await window.api.storyboard.pickPhoto() : await window.api.presenter.pickVideo()
    if (p) setPresenterPath(p)
  }

  async function build(): Promise<void> {
    if (!body.trim()) { setError('Paste your script first.'); return }
    if (!presenterPath) { setError(`Add ${fileLabel} first.`); return }
    setBusy(true); setError(null); setNote(null); setStage('Starting…')
    try {
      const res = await window.api.presenter.build({ title: title.trim() || 'Presenter video', body, mode, presenterPath, style })
      if (res.ok) { setNote('Presenter video built ✓ — open Video Studio to preview, voice-check, export, or the Timeline to fine-tune.'); toast('Presenter video built ✓', 'success') }
      else setError(res.error ?? 'Build failed.')
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Build failed.')
    } finally {
      setBusy(false); setStage(null)
    }
  }

  const fileName = presenterPath ? presenterPath.split(/[\\/]/).pop() : ''

  return (
    <div className="max-w-4xl mx-auto p-8">
      <h1 className="text-2xl font-serif text-gold-400">Presenter Studio
        <span className="ml-3 align-middle text-[11px] text-ink-500">{saveStatus === 'saving' ? 'Saving…' : saveStatus === 'saved' ? 'Saved ✓' : ''}</span>
      </h1>
      <p className="text-ink-400 text-sm mt-1">Put yourself in the video — real footage or your photo — and the AI cuts to theme b-roll + AI scenes on your voice.</p>

      {/* Mode selector */}
      <div className="mt-4 inline-flex rounded-md border border-ink-700 overflow-hidden text-sm">
        {(['video', 'photo', 'graft'] as Mode[]).map((m) => (
          <button key={m} onClick={() => setMode(m)} className={`px-3 py-1.5 ${mode === m ? 'bg-gold-500 text-ink-950' : 'text-ink-300 hover:bg-ink-800'}`}>
            {m === 'video' ? '🎥 Real Video' : m === 'photo' ? '🖼 Photo' : '🧪 Lip-graft'}
          </button>
        ))}
      </div>
      <div className="mt-2 rounded-md border border-ink-800 bg-ink-900 px-3 py-2 text-[12px] text-ink-300">{MODE_NOTE[mode]}</div>

      {/* File + inputs */}
      <div className="mt-4 flex flex-wrap items-center gap-2">
        <button onClick={pick} disabled={busy} className="rounded-md border border-ink-700 px-3 py-2 text-sm text-ink-200 hover:bg-ink-800 disabled:opacity-40">
          {needsPhoto ? '🖼 Choose my photo' : '🎥 Upload my narration video'}
        </button>
        {fileName && <span className="text-xs text-ink-500 truncate max-w-[280px]">{fileName}</span>}
        <label className="ml-auto text-xs text-ink-400">Look</label>
        <select value={style} onChange={(e) => setStyle(e.target.value as VideoStyle)} className="rounded-md border border-ink-700 bg-ink-950 px-2 py-1 text-sm text-ink-200">
          {VIDEO_STYLES.map((s) => <option key={s} value={s}>{s}</option>)}
        </select>
      </div>

      <div className="mt-4 space-y-2">
        <div className="flex items-center justify-between">
          <label className="text-xs text-ink-400">Title</label>
          <MicButton onText={(t) => setTitle((p) => appendDictation(p, t))} />
        </div>
        <input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Optional — a title (auto-derived if blank)" className="w-full rounded-md border border-ink-700 bg-ink-950 px-3 py-2 text-sm text-ink-100" />
        <div className="flex items-center justify-between">
          <label className="text-xs text-ink-400">Script (paste your full narration — [visual] lines become scenes)</label>
          <MicButton onText={(t) => setBody((p) => appendDictation(p, t))} />
        </div>
        <textarea value={body} onChange={(e) => setBody(e.target.value)} rows={12} placeholder="Paste your full script here. For video mode this should match what you say in your uploaded video." className="w-full rounded-md border border-ink-700 bg-ink-950 p-3 text-sm text-ink-200 font-serif" />
      </div>

      <div className="mt-3 flex items-center gap-3">
        <button onClick={build} disabled={busy || !body.trim() || !presenterPath} className="rounded-md bg-gold-500 hover:bg-gold-400 disabled:opacity-40 px-4 py-2 text-sm font-medium text-ink-950">
          {busy ? 'Building…' : '🎬 Build presenter video'}
        </button>
        {busy && stage && <span className="text-sm text-gold-300">{stage}</span>}
      </div>

      {error && <div className="mt-3 rounded-md border border-red-800 bg-red-950/40 px-3 py-2 text-sm text-red-300">{error}</div>}
      {note && <div className="mt-3 rounded-md border border-emerald-800 bg-emerald-950/40 px-3 py-2 text-sm text-emerald-300">{note}</div>}

      <p className="mt-4 text-[11px] text-ink-600">
        Tip: theme b-roll needs a free Pixabay key in Settings (already connected on this PC). Build times scale with your
        video length — a long narration takes a while. Everything you add here autosaves and the finished video is saved in Video Studio.
      </p>
    </div>
  )
}
