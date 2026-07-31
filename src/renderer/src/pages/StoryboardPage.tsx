import { useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAutosave } from '../hooks/useAutosave'
import { useHistory } from '../hooks/useHistory'
import { toast } from '../components/Toast'
import { confirmDialog } from '../components/Confirm'
import MicButton, { appendDictation } from '../components/MicButton'
import { useProducerTarget } from '../store/ProducerContext'
import { MOODS, SFX_KINDS, VIDEO_STYLES } from '../../../shared/types'
import type { BeatSound, ShotSubjectKind, StoryboardBeat, StoryboardDoc, VideoStyle } from '../../../shared/types'

/**
 * Storyboard Director — write your film shot by shot ("0–15s: I arrive in a Ferrari,
 * VO: '…'"), or paste a script and let the AI direct it. Each beat becomes a scene
 * (free AI image or your own photo/footage), narrated and timed, then rendered — and
 * the result opens in the Timeline editor for full add/edit/remove control.
 */
const RES: Record<string, { w: number; h: number }> = {
  '1080p': { w: 1920, h: 1080 },
  '720p': { w: 1280, h: 720 },
  '9:16 (Shorts)': { w: 1080, h: 1920 },
  '1:1': { w: 1080, h: 1080 }
}
const SUBJECTS: { value: ShotSubjectKind; label: string }[] = [
  { value: 'none', label: 'Scene only' },
  { value: 'photo', label: 'My photo' },
  { value: 'clip', label: 'My clip' },
  { value: 'ai-person', label: 'AI person' }
]

let seq = 0
const nid = (): string => `b${Date.now().toString(36)}${seq++}`

export default function StoryboardPage(): React.JSX.Element {
  const navigate = useNavigate()
  const [mode, setMode] = useState<'auto' | 'guided'>('auto')
  const [title, setTitle] = useState('')
  const [brief, setBrief] = useState('')
  const [language, setLanguage] = useState('English')
  const [resKey, setResKey] = useState('1080p')
  const [fps, setFps] = useState(25)
  const [totalSeconds, setTotalSeconds] = useState(120)
  const [style, setStyle] = useState<VideoStyle>('cinematic')
  const [beats, setBeats] = useState<StoryboardBeat[]>([])
  // Undo/redo over the shot list — deleting or mangling a beat is no longer final.
  const history = useHistory(beats, setBeats)
  const [photoPath, setPhotoPath] = useState<string | null>(null)
  const [beautifyStrength, setBeautifyStrength] = useState(0.6)
  // Scene motion: classic animated stills, or REAL AI video per beat (free cloud / local
  // GPU). Failures fall back to the still for that beat — a render never breaks over this.
  const [motion, setMotion] = useState<'stills' | 'ai-free-video' | 'ai-local'>('stills')
  const [beautyPreview, setBeautyPreview] = useState<string | null>(null)
  const [busy, setBusy] = useState<string | null>(null)
  const [progress, setProgress] = useState<string | null>(null)
  const [renderedTimeline, setRenderedTimeline] = useState<unknown | null>(null)
  const [renderedPath, setRenderedPath] = useState<string | null>(null)

  const unsub = useRef<(() => void) | null>(null)
  useEffect(() => {
    unsub.current = window.api.video.onProgress((s) => setProgress(s))
    return () => unsub.current?.()
  }, [])

  // Expose the screenplay brief to the YouTube Producer for arc/hook/pacing rewrites.
  useProducerTarget({ label: 'Storyboard brief', kind: 'brief', text: brief, apply: (next) => setBrief(next) })

  const persisted = useMemo(
    () => ({ mode, title, brief, language, resKey, fps, totalSeconds, style, beats, photoPath, beautifyStrength }),
    [mode, title, brief, language, resKey, fps, totalSeconds, style, beats, photoPath, beautifyStrength]
  )
  const saveStatus = useAutosave('storyboard-project', persisted, (v) => {
    if (v.mode) setMode(v.mode)
    if (v.title != null) setTitle(v.title)
    if (v.brief != null) setBrief(v.brief)
    if (v.language) setLanguage(v.language)
    if (v.resKey) setResKey(v.resKey)
    if (typeof v.fps === 'number') setFps(v.fps)
    if (typeof v.totalSeconds === 'number') setTotalSeconds(v.totalSeconds)
    if (v.style) setStyle(v.style)
    if (Array.isArray(v.beats)) setBeats(v.beats)
    if (v.photoPath !== undefined) setPhotoPath(v.photoPath)
    if (typeof v.beautifyStrength === 'number') setBeautifyStrength(v.beautifyStrength)
  })

  async function previewBeautify(): Promise<void> {
    if (!photoPath) return
    setBusy('Beautifying preview…')
    try {
      const res = await window.api.storyboard.beautify(photoPath, beautifyStrength)
      if (res.ok && res.path) setBeautyPreview(`file:///${res.path.replace(/\\/g, '/').replace(/^\/+/, '')}?t=${Date.now()}`)
      else toast(res.error ?? 'Beautify failed.', 'error')
    } catch (err) {
      toast(err instanceof Error ? err.message : 'Beautify failed.', 'error')
    } finally {
      setBusy(null)
    }
  }

  const dims = RES[resKey] ?? RES['1080p']

  async function plan(): Promise<void> {
    if (!brief.trim()) { toast(mode === 'auto' ? 'Paste your script first.' : 'Describe your shots first.', 'error'); return }
    if (beats.length > 0) {
      const ok = await confirmDialog({
        title: 'Re-direct and replace your shots?',
        message: 'This replaces your current shots with a fresh AI-directed storyboard. (Your last version stays in autosave history.)',
        confirmLabel: 'Re-direct',
        danger: true
      })
      if (!ok) return
    }
    setBusy('Directing your storyboard…'); setProgress(null)
    try {
      const res = await window.api.storyboard.plan({ mode, title, brief, totalSeconds, language, width: dims.w, height: dims.h, fps })
      if (res.ok && res.storyboard) {
        setBeats(res.storyboard.beats)
        setStyle(res.storyboard.style)
        if (res.storyboard.title) setTitle(res.storyboard.title)
        toast(`Directed ${res.storyboard.beats.length} shots — review & edit below.`, 'success')
      } else {
        toast(res.error ?? 'Could not plan the storyboard.', 'error')
      }
    } catch (err) {
      toast(err instanceof Error ? err.message : 'Planning failed.', 'error')
    } finally {
      setBusy(null)
    }
  }

  function addBeat(): void {
    setBeats((p) => [...p, { id: nid(), durationSec: 6, visual: 'A cinematic establishing shot', subject: { kind: 'none' }, transitionSec: 0.5, motion: 'in' }])
  }
  function patch(id: string, up: Partial<StoryboardBeat>): void {
    setBeats((p) => p.map((b) => (b.id === id ? { ...b, ...up } : b)))
  }
  function patchSubject(id: string, up: Partial<StoryboardBeat['subject']>): void {
    setBeats((p) => p.map((b) => (b.id === id ? { ...b, subject: { ...b.subject, ...up } } : b)))
  }
  function moveBeat(id: string, dir: -1 | 1): void {
    setBeats((p) => {
      const i = p.findIndex((b) => b.id === id)
      const j = i + dir
      if (i < 0 || j < 0 || j >= p.length) return p
      const n = [...p]
      ;[n[i], n[j]] = [n[j], n[i]]
      return n
    })
  }
  async function removeBeat(id: string): Promise<void> {
    const ok = await confirmDialog({ title: 'Delete this shot?', message: 'Removes the beat from the storyboard.', confirmLabel: 'Delete', danger: true })
    if (ok) setBeats((p) => p.filter((b) => b.id !== id))
  }
  async function pickPhoto(): Promise<void> {
    const p = await window.api.storyboard.pickPhoto()
    if (p) setPhotoPath(p)
  }
  async function pickClip(id: string): Promise<void> {
    const paths = await window.api.timeline.pickClips()
    if (paths.length) patchSubject(id, { src: paths[0] })
  }

  function addSound(beatId: string, kind: BeatSound['kind']): void {
    const snd: BeatSound = {
      id: `s${Date.now().toString(36)}${seq++}`,
      kind,
      ref: kind === 'music' ? 'calm' : kind === 'sfx' ? 'whoosh' : undefined,
      gain: kind === 'music' ? 0.25 : 0.8,
      fadeInSec: kind === 'music' ? 0.5 : 0,
      fadeOutSec: kind === 'music' ? 0.5 : 0,
      atSec: 0
    }
    setBeats((p) => p.map((b) => (b.id === beatId ? { ...b, sounds: [...(b.sounds ?? []), snd] } : b)))
  }
  function patchSound(beatId: string, sid: string, up: Partial<BeatSound>): void {
    setBeats((p) => p.map((b) => (b.id === beatId ? { ...b, sounds: (b.sounds ?? []).map((s) => (s.id === sid ? { ...s, ...up } : s)) } : b)))
  }
  function removeSound(beatId: string, sid: string): void {
    setBeats((p) => p.map((b) => (b.id === beatId ? { ...b, sounds: (b.sounds ?? []).filter((s) => s.id !== sid) } : b)))
  }
  async function pickSoundFile(beatId: string, sid: string): Promise<void> {
    const path = await window.api.video.pickMusic()
    if (path) patchSound(beatId, sid, { src: path })
  }

  const totalDur = useMemo(() => {
    let t = 0
    beats.forEach((b, i) => { t += b.durationSec; if (i > 0) t -= Math.min(Math.max(b.transitionSec ?? 0, 0), b.durationSec) })
    return Math.max(0, t)
  }, [beats])

  async function render(): Promise<void> {
    if (!beats.length) { toast('Plan or add at least one shot first.', 'error'); return }
    const doc: StoryboardDoc = { title: title || 'Storyboard film', style, width: dims.w, height: dims.h, fps, language, beats }
    setBusy('Rendering your film…'); setProgress(null); setRenderedPath(null); setRenderedTimeline(null)
    try {
      const res = await window.api.storyboard.render(doc, {
        photoPath: photoPath ?? undefined,
        beautifyStrength,
        motionEngine: motion === 'stills' ? undefined : motion
      })
      if (res.ok && res.video) {
        setRenderedPath(res.video.path)
        setRenderedTimeline(res.timeline ?? null)
        toast('Film rendered — also saved in Video Studio.', 'success')
      } else {
        toast(res.error ?? 'Render failed.', 'error')
      }
    } catch (err) {
      toast(err instanceof Error ? err.message : 'Render failed.', 'error')
    } finally {
      setBusy(null); setProgress(null)
    }
  }

  const fileUrl = (p: string): string => `file:///${p.replace(/\\/g, '/').replace(/^\/+/, '')}`

  return (
    <div className="max-w-5xl mx-auto p-8">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-serif text-gold-400">
            Storyboard Director
            <span className="ml-3 align-middle text-[11px] text-ink-500">{saveStatus === 'saving' ? 'Saving…' : saveStatus === 'saved' ? 'Saved ✓' : ''}</span>
          </h1>
          <p className="text-ink-400 text-sm mt-1">
            Direct your film shot by shot, or paste a script and let the AI decide everything. Total so far:{' '}
            <span className="text-ink-200">{totalDur.toFixed(1)}s</span>.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={history.undo}
            disabled={!history.canUndo}
            title="Undo (Ctrl+Z)"
            className="rounded-md border border-ink-700 px-2 py-1.5 text-sm text-ink-200 hover:border-gold-500 disabled:opacity-40"
          >
            ↩
          </button>
          <button
            onClick={history.redo}
            disabled={!history.canRedo}
            title="Redo (Ctrl+Y)"
            className="rounded-md border border-ink-700 px-2 py-1.5 text-sm text-ink-200 hover:border-gold-500 disabled:opacity-40"
          >
            ↪
          </button>
        </div>
      </div>

      {/* SETUP */}
      <div className="mt-5 rounded-lg border border-ink-800 bg-ink-900 p-4 space-y-3">
        <div className="flex flex-wrap items-center gap-2">
          <div className="inline-flex rounded-md border border-ink-700 overflow-hidden">
            <button onClick={() => setMode('auto')} className={`px-3 py-1.5 text-sm ${mode === 'auto' ? 'bg-gold-500 text-ink-950' : 'text-ink-300'}`}>Auto (AI decides)</button>
            <button onClick={() => setMode('guided')} className={`px-3 py-1.5 text-sm ${mode === 'guided' ? 'bg-gold-500 text-ink-950' : 'text-ink-300'}`}>Guided (my shots)</button>
          </div>
          <select value={resKey} onChange={(e) => setResKey(e.target.value)} className="rounded-md border border-ink-700 bg-ink-950 px-2 py-1.5 text-sm text-ink-200">
            {Object.keys(RES).map((k) => <option key={k}>{k}</option>)}
          </select>
          <select value={fps} onChange={(e) => setFps(Number(e.target.value))} className="rounded-md border border-ink-700 bg-ink-950 px-2 py-1.5 text-sm text-ink-200">
            {[24, 25, 30, 60].map((f) => <option key={f} value={f}>{f} fps</option>)}
          </select>
          <select value={language} onChange={(e) => setLanguage(e.target.value)} className="rounded-md border border-ink-700 bg-ink-950 px-2 py-1.5 text-sm text-ink-200">
            <option>English</option><option>Roman Urdu</option><option>Urdu</option>
          </select>
          <select value={style} onChange={(e) => setStyle(e.target.value as VideoStyle)} className="rounded-md border border-ink-700 bg-ink-950 px-2 py-1.5 text-sm text-ink-200" title="Visual style">
            {VIDEO_STYLES.map((s) => <option key={s} value={s}>{s}</option>)}
          </select>
          <select
            value={motion}
            onChange={(e) => setMotion(e.target.value as 'stills' | 'ai-free-video' | 'ai-local')}
            className="rounded-md border border-ink-700 bg-ink-950 px-2 py-1.5 text-sm text-ink-200"
            title="Real AI motion generates actual video per shot; any failure falls back to the animated still — the render never breaks."
          >
            <option value="stills">Scenes: animated stills (default)</option>
            <option value="ai-free-video">Scenes: REAL AI video — free cloud</option>
            <option value="ai-local">Scenes: REAL AI video — local GPU</option>
          </select>
          {mode === 'auto' && (
            <label className="text-xs text-ink-400">Target length
              <input type="number" min={10} value={totalSeconds} onChange={(e) => setTotalSeconds(Number(e.target.value))} className="ml-2 w-20 rounded-md border border-ink-700 bg-ink-950 px-2 py-1 text-sm text-ink-100" />s
            </label>
          )}
        </div>
        <div className="flex items-center gap-2">
          <input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Title of your video" className="flex-1 rounded-md border border-ink-700 bg-ink-950 px-3 py-2 text-sm text-ink-100" />
          <button onClick={pickPhoto} className="rounded-md border border-ink-700 px-3 py-2 text-sm text-ink-200 hover:bg-ink-800">{photoPath ? '✓ Photo set' : 'Set my photo'}</button>
        </div>
        {photoPath && (
          <div className="rounded-md border border-ink-800 bg-ink-950 p-3">
            <div className="flex items-center gap-3">
              <span className="text-xs text-ink-400 w-28">Beautify ↔ Rougher</span>
              <input type="range" min={-1} max={1} step={0.05} value={beautifyStrength} onChange={(e) => setBeautifyStrength(Number(e.target.value))} className="flex-1" />
              <span className="text-xs text-ink-300 w-10 text-right">{beautifyStrength.toFixed(2)}</span>
              <button onClick={previewBeautify} disabled={!!busy} className="rounded-md border border-ink-700 px-3 py-1.5 text-xs text-ink-200 hover:bg-ink-800 disabled:opacity-40">Preview</button>
            </div>
            <div className="mt-1 text-[11px] text-ink-600">
              Positive = smoother skin, brighter, even tone. Negative = grittier, sharper, more contrast. Applied to your real photo (which is then cut out and composited into each "My photo" scene).
            </div>
            {beautyPreview && <img src={beautyPreview} alt="beautify preview" className="mt-2 max-h-64 rounded-md border border-ink-800" />}
          </div>
        )}
        <div>
          <div className="flex items-center justify-between">
            <label className="text-xs text-ink-400">{mode === 'auto' ? 'Paste your full script — the AI will split it into directed shots.' : 'Describe your shots in plain English (timings, actions, what you say).'}</label>
            <MicButton onText={(t) => setBrief((prev) => appendDictation(prev, t))} />
          </div>
          <textarea
            value={brief}
            onChange={(e) => setBrief(e.target.value)}
            rows={5}
            placeholder={mode === 'auto'
              ? 'Paste the whole script here…'
              : "e.g. First 15s I arrive fast in a Ferrari and say '…', my secretary helps with my coat, I board my helicopter which flies slowly over the hills and fades. Then 90s of me at a UN council delivering the speech: '…'"}
            className="mt-1 w-full rounded-md border border-ink-700 bg-ink-950 p-3 text-sm text-ink-200"
          />
        </div>
        <button onClick={plan} disabled={!!busy} className="rounded-md bg-gold-500 hover:bg-gold-400 disabled:opacity-40 px-4 py-2 text-sm font-medium text-ink-950">
          ✦ Direct storyboard
        </button>
      </div>

      {busy && <div className="mt-3 text-sm text-gold-300">{busy}{progress ? ` — ${progress}` : ''}</div>}

      {/* BEATS */}
      {beats.length > 0 && (
        <section className="mt-6">
          <div className="flex items-center justify-between">
            <h2 className="text-sm font-medium text-ink-200">Shots ({beats.length})</h2>
            <div className="flex gap-2">
              <button onClick={addBeat} className="rounded-md border border-ink-700 px-3 py-1.5 text-xs text-ink-200 hover:bg-ink-800">+ Add shot</button>
              <button onClick={render} disabled={!!busy} className="rounded-md bg-gold-500 hover:bg-gold-400 disabled:opacity-40 px-4 py-1.5 text-xs font-medium text-ink-950">🎬 Render film</button>
            </div>
          </div>
          <div className="mt-2 space-y-3">
            {beats.map((b, i) => (
              <div key={b.id} className="rounded-lg border border-ink-800 bg-ink-900 p-3">
                <div className="flex items-center gap-2">
                  <span className="text-xs text-ink-500 w-6">{i + 1}.</span>
                  <input value={b.visual} onChange={(e) => patch(b.id, { visual: e.target.value })} placeholder="What the camera shows" className="flex-1 rounded-md border border-ink-700 bg-ink-950 px-2 py-1.5 text-sm text-ink-100" />
                  <button onClick={() => moveBeat(b.id, -1)} disabled={i === 0} className="rounded px-2 py-1 text-xs text-ink-300 hover:bg-ink-800 disabled:opacity-30">↑</button>
                  <button onClick={() => moveBeat(b.id, 1)} disabled={i === beats.length - 1} className="rounded px-2 py-1 text-xs text-ink-300 hover:bg-ink-800 disabled:opacity-30">↓</button>
                  <button onClick={() => void removeBeat(b.id)} className="rounded px-2 py-1 text-xs text-red-400 hover:bg-red-950/40">✕</button>
                </div>
                <textarea value={b.narration ?? ''} onChange={(e) => patch(b.id, { narration: e.target.value })} rows={2} placeholder="Narration spoken during this shot (optional)" className="mt-2 w-full rounded-md border border-ink-700 bg-ink-950 px-2 py-1.5 text-sm text-ink-200" />
                <div className="mt-2 grid grid-cols-2 md:grid-cols-4 gap-2">
                  <label className="block"><span className="block text-[11px] text-ink-500">Duration (s)</span>
                    <input type="number" min={0.5} step={0.5} value={b.durationSec} onChange={(e) => patch(b.id, { durationSec: Math.max(0.5, Number(e.target.value)) })} className="mt-1 w-full rounded-md border border-ink-700 bg-ink-950 px-2 py-1.5 text-sm text-ink-100" />
                  </label>
                  <label className="block"><span className="block text-[11px] text-ink-500">Crossfade in (s)</span>
                    <input type="number" min={0} step={0.1} value={b.transitionSec ?? 0} onChange={(e) => patch(b.id, { transitionSec: Math.max(0, Number(e.target.value)) })} disabled={i === 0} className="mt-1 w-full rounded-md border border-ink-700 bg-ink-950 px-2 py-1.5 text-sm text-ink-100 disabled:opacity-40" />
                  </label>
                  <label className="block"><span className="block text-[11px] text-ink-500">Subject</span>
                    <select value={b.subject.kind} onChange={(e) => patchSubject(b.id, { kind: e.target.value as ShotSubjectKind })} className="mt-1 w-full rounded-md border border-ink-700 bg-ink-950 px-2 py-1.5 text-sm text-ink-100">
                      {SUBJECTS.map((s) => <option key={s.value} value={s.value}>{s.label}</option>)}
                    </select>
                  </label>
                  <label className="block"><span className="block text-[11px] text-ink-500">Caption (optional)</span>
                    <input value={b.caption ?? ''} onChange={(e) => patch(b.id, { caption: e.target.value })} className="mt-1 w-full rounded-md border border-ink-700 bg-ink-950 px-2 py-1.5 text-sm text-ink-100" />
                  </label>
                </div>
                {b.subject.kind === 'ai-person' && (
                  <input value={b.subject.description ?? ''} onChange={(e) => patchSubject(b.id, { description: e.target.value })} placeholder="Describe the AI person (e.g. a confident CEO in a navy suit)" className="mt-2 w-full rounded-md border border-ink-700 bg-ink-950 px-2 py-1.5 text-sm text-ink-100" />
                )}
                {b.subject.kind === 'photo' && <div className="mt-2 text-[11px] text-ink-500">{photoPath ? 'Uses your set photo.' : 'Tip: click "Set my photo" above so this shot uses your real face.'}</div>}
                {b.subject.kind === 'clip' && (
                  <div className="mt-2 flex items-center gap-2">
                    <button onClick={() => void pickClip(b.id)} className="rounded-md border border-ink-700 px-3 py-1 text-xs text-ink-200 hover:bg-ink-800">Pick my clip</button>
                    <span className="text-[11px] text-ink-500 truncate">{b.subject.src ? b.subject.src.split(/[\\/]/).pop() : 'no clip chosen'}</span>
                  </div>
                )}

                {/* Per-beat sounds */}
                <div className="mt-2 border-t border-ink-800 pt-2">
                  <div className="flex flex-wrap items-center gap-1.5">
                    <span className="text-[11px] text-ink-500 mr-1">Sounds:</span>
                    <button onClick={() => addSound(b.id, 'music')} className="rounded-full border border-ink-700 px-2 py-0.5 text-[11px] text-ink-200 hover:bg-ink-800">+ Music</button>
                    <button onClick={() => addSound(b.id, 'sfx')} className="rounded-full border border-ink-700 px-2 py-0.5 text-[11px] text-ink-200 hover:bg-ink-800">+ SFX</button>
                    <button onClick={() => addSound(b.id, 'file')} className="rounded-full border border-ink-700 px-2 py-0.5 text-[11px] text-ink-200 hover:bg-ink-800">+ Audio file</button>
                  </div>
                  {(b.sounds ?? []).map((s) => (
                    <div key={s.id} className="mt-1.5 flex flex-wrap items-center gap-2 rounded-md bg-ink-950 border border-ink-800 px-2 py-1.5">
                      {s.kind === 'music' && (
                        <select value={s.ref} onChange={(e) => patchSound(b.id, s.id, { ref: e.target.value })} className="rounded border border-ink-700 bg-ink-900 px-1.5 py-0.5 text-[11px] text-ink-100">
                          {MOODS.map((m) => <option key={m} value={m}>🎵 {m}</option>)}
                        </select>
                      )}
                      {s.kind === 'sfx' && (
                        <select value={s.ref} onChange={(e) => patchSound(b.id, s.id, { ref: e.target.value })} className="rounded border border-ink-700 bg-ink-900 px-1.5 py-0.5 text-[11px] text-ink-100">
                          {SFX_KINDS.map((k) => <option key={k} value={k}>💥 {k}</option>)}
                        </select>
                      )}
                      {s.kind === 'file' && (
                        <button onClick={() => void pickSoundFile(b.id, s.id)} className="rounded border border-ink-700 px-2 py-0.5 text-[11px] text-ink-200 hover:bg-ink-800">
                          {s.src ? `🎧 ${s.src.split(/[\\/]/).pop()}` : '🎧 Pick file'}
                        </button>
                      )}
                      <label className="text-[10px] text-ink-500">gain
                        <input type="number" min={0} max={4} step={0.05} value={s.gain ?? 1} onChange={(e) => patchSound(b.id, s.id, { gain: Math.max(0, Number(e.target.value)) })} className="ml-1 w-14 rounded border border-ink-700 bg-ink-900 px-1 py-0.5 text-[11px] text-ink-100" />
                      </label>
                      <label className="text-[10px] text-ink-500">at(s)
                        <input type="number" min={0} step={0.1} value={s.atSec ?? 0} onChange={(e) => patchSound(b.id, s.id, { atSec: Math.max(0, Number(e.target.value)) })} className="ml-1 w-14 rounded border border-ink-700 bg-ink-900 px-1 py-0.5 text-[11px] text-ink-100" />
                      </label>
                      <label className="text-[10px] text-ink-500">fade in
                        <input type="number" min={0} step={0.1} value={s.fadeInSec ?? 0} onChange={(e) => patchSound(b.id, s.id, { fadeInSec: Math.max(0, Number(e.target.value)) })} className="ml-1 w-12 rounded border border-ink-700 bg-ink-900 px-1 py-0.5 text-[11px] text-ink-100" />
                      </label>
                      <label className="text-[10px] text-ink-500">fade out
                        <input type="number" min={0} step={0.1} value={s.fadeOutSec ?? 0} onChange={(e) => patchSound(b.id, s.id, { fadeOutSec: Math.max(0, Number(e.target.value)) })} className="ml-1 w-12 rounded border border-ink-700 bg-ink-900 px-1 py-0.5 text-[11px] text-ink-100" />
                      </label>
                      <button onClick={() => removeSound(b.id, s.id)} className="ml-auto rounded px-1.5 py-0.5 text-[11px] text-red-400 hover:bg-red-950/40">✕</button>
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </section>
      )}

      {renderedPath && (
        <section className="mt-8">
          <h2 className="text-sm font-medium text-ink-200">Your film</h2>
          <video src={fileUrl(renderedPath)} controls className="mt-2 w-full max-w-2xl rounded-md bg-black" />
          <div className="mt-2 flex gap-2">
            <button onClick={() => void window.api.video.reveal(renderedPath)} className="rounded bg-ink-800 px-3 py-1.5 text-xs text-ink-200 hover:bg-ink-700">Show file</button>
            {renderedTimeline != null && (
              <button
                onClick={() => navigate('/timeline', { state: { importTimeline: renderedTimeline } })}
                className="rounded bg-ink-800 px-3 py-1.5 text-xs text-gold-300 hover:bg-ink-700"
              >
                ✂ Open in Timeline editor (add/edit sound, effects, more)
              </button>
            )}
          </div>
        </section>
      )}
    </div>
  )
}
