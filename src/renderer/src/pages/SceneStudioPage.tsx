import { useEffect, useMemo, useRef, useState } from 'react'
import type { VideoAspect, VideoJob, VideoResolution, VideoStyle, VideoTemplate } from '../../../shared/types'
import { VIDEO_STYLES, VIDEO_TEMPLATES } from '../../../shared/types'
import MicButton, { appendDictation } from '../components/MicButton'
import { useAutosave } from '../hooks/useAutosave'
import { toast } from '../components/Toast'

function fileUrl(p: string): string {
  return `file:///${p.replace(/\\/g, '/').replace(/^\/+/, '')}`
}

type SceneStatus = 'idle' | 'generating' | 'done' | 'error'
interface Scene {
  index: number
  label: string
  prompt: string
  img: string | null
  status: SceneStatus
  /** Absolute path to an attached photo — when set, this scene is generated FROM it (img2img). */
  photo?: string | null
  /** Live status/queue message (e.g. photo-scene queue position). */
  msg?: string
}

/** Pulls a whole-number percent out of a "Rendering 45% (…)" progress line, else null. */
function parsePct(stage: string | null): number | null {
  if (!stage) return null
  const m = /(\d+)%/.exec(stage)
  return m ? Math.min(100, Number(m[1])) : null
}

/**
 * Scene Studio — generate a video scene-by-scene, WATCH each scene appear, PAUSE any
 * time, rewrite any scene's prompt and regenerate just that scene, then build the final
 * video with a live progress bar. Free AI images, no key. This is the "see it as it
 * happens and steer it" workspace.
 */
export default function SceneStudioPage(): React.JSX.Element {
  const [title, setTitle] = useState('')
  const [body, setBody] = useState('')
  const [style, setStyle] = useState<VideoStyle>('cinematic')
  const [direction, setDirection] = useState('')
  const [resolution, setResolution] = useState<VideoResolution>('1080p')
  const [aspect, setAspect] = useState<VideoAspect>('16:9')
  const [template, setTemplate] = useState<VideoTemplate>('cinematic')
  const [fast, setFast] = useState(true)
  const [soundEffects, setSoundEffects] = useState(true)
  const [photoStrength, setPhotoStrength] = useState(0.5)

  // Autosave the script + settings (not the generated images, which are files).
  const inputs = useMemo(
    () => ({ title, body, style, direction, resolution, aspect, template, fast, soundEffects }),
    [title, body, style, direction, resolution, aspect, template, fast, soundEffects]
  )
  const saveStatus = useAutosave('scene-inputs', inputs, (v) => {
    const o = (v ?? {}) as Partial<typeof inputs>
    if (typeof o.title === 'string') setTitle(o.title)
    if (typeof o.body === 'string') setBody(o.body)
    if (o.style) setStyle(o.style)
    if (typeof o.direction === 'string') setDirection(o.direction)
    if (o.resolution) setResolution(o.resolution)
    if (o.aspect) setAspect(o.aspect)
    if (o.template) setTemplate(o.template)
    if (typeof o.fast === 'boolean') setFast(o.fast)
    if (typeof o.soundEffects === 'boolean') setSoundEffects(o.soundEffects)
  })

  const [scenes, setScenes] = useState<Scene[]>([])
  // Persist the generated scenes too — NOT just the script. The images are files on disk,
  // so a restored scene shows its picture again; a scene that was mid-generation when you
  // left comes back as ready (idle) rather than stuck "generating". Without this, all your
  // scenes vanished on tab-switch while only the script was kept. (`scenes` is a stable
  // state ref, so this can't cause a save-loop.)
  useAutosave('scene-scenes', scenes, (v) => {
    if (Array.isArray(v) && v.length) {
      setScenes(
        (v as Scene[]).map((s) => ({ ...s, status: s.img ? 'done' : 'idle', msg: undefined }))
      )
    }
  })
  const [generating, setGenerating] = useState(false)
  const [paused, setPaused] = useState(false)
  const [building, setBuilding] = useState(false)
  const [stage, setStage] = useState<string | null>(null)
  const [buildPreview, setBuildPreview] = useState<string | null>(null)
  const [built, setBuilt] = useState<VideoJob | null>(null)
  const [error, setError] = useState<string | null>(null)

  // Refs so the async generation loop always reads the latest prompts/pause state.
  const scenesRef = useRef<Scene[]>([])
  const pausedRef = useRef(false)
  const fastRef = useRef(fast)
  const strengthRef = useRef(photoStrength)
  useEffect(() => {
    scenesRef.current = scenes
  }, [scenes])
  useEffect(() => {
    fastRef.current = fast
  }, [fast])
  useEffect(() => {
    strengthRef.current = photoStrength
  }, [photoStrength])
  // Live queue progress for photo-based scenes.
  useEffect(() => {
    const unsub = window.api.scene.onProgress((p) => patchScene(p.index, { msg: p.message }))
    return () => {
      unsub()
    }
  }, [])

  const doneCount = scenes.filter((s) => s.status === 'done').length
  const genPct = scenes.length ? Math.round((doneCount / scenes.length) * 100) : 0
  const buildPct = parsePct(stage)

  function patchScene(index: number, patch: Partial<Scene>): void {
    setScenes((prev) => prev.map((s) => (s.index === index ? { ...s, ...patch } : s)))
  }

  // --- storyboard controls: reorder / add / remove (generation is by scene id, so
  // reordering only changes the sequence used when building) ---
  function moveScene(arrIdx: number, dir: -1 | 1): void {
    setScenes((prev) => {
      const to = arrIdx + dir
      if (to < 0 || to >= prev.length) return prev
      const copy = [...prev]
      const [item] = copy.splice(arrIdx, 1)
      copy.splice(to, 0, item)
      return copy
    })
  }
  function addScene(): void {
    setScenes((prev) => {
      const id = (prev.reduce((m, s) => Math.max(m, s.index), -1) + 1) || prev.length
      const prompt = `${style} style, ${direction || title || 'establishing shot'}. high detail, no text, no watermark`
      return [...prev, { index: id, label: 'CUSTOM', prompt, img: null, status: 'idle' as SceneStatus }]
    })
  }
  function removeScene(index: number): void {
    setScenes((prev) => prev.filter((s) => s.index !== index))
  }

  async function useScriptPad(): Promise<void> {
    const pad = await window.api.scriptpad.get()
    if (pad.title) setTitle(pad.title)
    if (pad.body) setBody(pad.body)
  }

  async function plan(): Promise<void> {
    if (!body.trim()) {
      setError('Paste or write a script first (use [SECTION] headers for scene boundaries).')
      return
    }
    setError(null)
    setBuilt(null)
    const planned = await window.api.scene.plan(title.trim() || 'Video', body, style, direction)
    setScenes(planned.map((p) => ({ ...p, img: null, status: 'idle' as SceneStatus })))
  }

  /** Generate ONE scene: img2img from an attached photo if present, else free text-to-image. */
  async function genOne(index: number, seedBump = 0): Promise<void> {
    const s = scenesRef.current.find((x) => x.index === index)
    if (!s) return
    patchScene(index, { status: 'generating', msg: undefined })
    try {
      const img = s.photo
        ? await window.api.scene.generateFromPhoto(index, s.prompt, s.photo, strengthRef.current)
        : await window.api.scene.generate(s.prompt, index + 1 + seedBump, fastRef.current)
      patchScene(index, { img: `${fileUrl(img)}?t=${Date.now()}`, status: 'done', msg: undefined })
    } catch (err) {
      patchScene(index, { status: 'error', msg: err instanceof Error ? err.message : 'failed' })
    }
  }

  /** Runs a small concurrency pool over the not-yet-done scenes, honoring Pause. */
  async function generateRemaining(): Promise<void> {
    setGenerating(true)
    setPaused(false)
    pausedRef.current = false
    const pending = scenesRef.current.filter((s) => s.status !== 'done').map((s) => s.index)
    let cursor = 0
    // Photo scenes go through a slow free queue — run fewer at once.
    const anyPhoto = scenesRef.current.some((s) => s.photo)
    const workers = anyPhoto ? 1 : Math.max(1, Math.min(3, fast ? 3 : 2))
    const worker = async (): Promise<void> => {
      while (true) {
        if (pausedRef.current) return
        const at = cursor++
        if (at >= pending.length) return
        await genOne(pending[at])
      }
    }
    await Promise.all(Array.from({ length: workers }, () => worker()))
    setGenerating(false)
  }

  function pause(): void {
    pausedRef.current = true
    setPaused(true)
  }

  /** Regenerate ONE scene with its (possibly edited) prompt — works even while paused. */
  async function regenerate(index: number): Promise<void> {
    await genOne(index, Math.floor(Math.random() * 9999))
  }

  /** Attach a photo to a scene ("put me in this scene"). */
  async function attachPhoto(index: number): Promise<void> {
    const paths = await window.api.video.pickImages()
    if (paths[0]) patchScene(index, { photo: paths[0] })
  }

  async function build(): Promise<void> {
    const ready = scenes.filter((s) => s.status === 'done' && s.img)
    if (!ready.length) {
      setError('Generate at least one scene first.')
      return
    }
    setBuilding(true)
    setError(null)
    setStage('Starting…')
    setBuildPreview(null)
    const unsub = window.api.video.onProgress((s) => setStage(s))
    const unsubP = window.api.video.onPreview((png) => setBuildPreview(`${fileUrl(png)}?t=${Date.now()}`))
    try {
      // Strip the file:// wrapper back to a plain path for the builder.
      const imagePaths = ready.map((s) => decodeURI((s.img as string).replace(/^file:\/\/\//, '').split('?')[0]))
      const job = await window.api.video.build({
        title: title.trim() || 'Video',
        body,
        images: imagePaths,
        engine: 'presets',
        style,
        resolution,
        aspect,
        template,
        soundEffects
      })
      setBuilt(job)
      toast('Scene video built ✓', 'success')
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Build failed')
      toast(err instanceof Error ? err.message : 'Build failed', 'error')
    } finally {
      unsub()
      unsubP()
      setBuilding(false)
      setStage(null)
      setBuildPreview(null)
    }
  }

  return (
    <div className="max-w-5xl mx-auto px-8 py-8">
      <header className="mb-5">
        <div className="flex items-center gap-3">
          <h1 className="text-2xl font-serif text-gold-400">Scene Studio</h1>
          <span className="text-[11px] text-ink-500">{saveStatus === 'saving' ? 'Saving…' : saveStatus === 'saved' ? 'Saved ✓' : ''}</span>
        </div>
        <p className="text-ink-400 text-sm mt-1">
          Generate your video scene by scene and watch each one appear. Pause anytime, rewrite any scene’s
          prompt and regenerate just that scene, then build the final video with a live progress bar. Free AI
          images — no key, no install, needs internet.
        </p>
      </header>

      {/* Script + settings */}
      <div className="rounded-lg border border-ink-800 bg-ink-900 p-4 space-y-3">
        <div className="flex gap-2">
          <input
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="Title"
            className="flex-1 rounded-md bg-ink-950 border border-ink-800 px-3 py-2 text-sm text-ink-100"
          />
          <MicButton onText={(t) => setTitle((prev) => appendDictation(prev, t))} className="px-3 py-2" />
          <button onClick={useScriptPad} className="rounded-md border border-ink-700 px-3 text-xs text-ink-300 hover:border-gold-500">
            Use Script Pad
          </button>
        </div>
        <textarea
          value={body}
          onChange={(e) => setBody(e.target.value)}
          placeholder="Paste your script. Put [SECTION HEADERS] on their own lines to define scenes."
          rows={4}
          className="w-full resize-y rounded-md bg-ink-950 border border-ink-800 px-3 py-2 text-sm text-ink-100"
        />
        <div className="flex justify-end -mt-1">
          <MicButton onText={(t) => setBody((prev) => appendDictation(prev, t))} />
        </div>
        <div className="flex gap-2 items-start">
          <input
            value={direction}
            onChange={(e) => setDirection(e.target.value)}
            placeholder="Overall scene direction (optional) — e.g. “dark documentary look, 1970s Karachi, rain”"
            className="flex-1 rounded-md bg-ink-950 border border-ink-800 px-3 py-2 text-sm text-ink-100"
          />
          <MicButton onText={(t) => setDirection((prev) => appendDictation(prev, t))} className="px-3 py-2" />
        </div>
        <div className="flex flex-wrap items-center gap-3 text-xs text-ink-300">
          <label className="flex items-center gap-1">
            Style
            <select value={style} onChange={(e) => setStyle(e.target.value as VideoStyle)} className="rounded bg-ink-800 border border-ink-700 px-2 py-1 capitalize">
              {VIDEO_STYLES.map((s) => (
                <option key={s} value={s} className="capitalize">{s}</option>
              ))}
            </select>
          </label>
          <label className="flex items-center gap-1">
            Resolution
            <select value={resolution} onChange={(e) => setResolution(e.target.value as VideoResolution)} className="rounded bg-ink-800 border border-ink-700 px-2 py-1">
              <option value="1080p">1080p</option>
              <option value="1440p">1440p</option>
              <option value="4k">4K</option>
              <option value="8k">8K</option>
            </select>
          </label>
          <label className="flex items-center gap-1">
            Format
            <select value={aspect} onChange={(e) => setAspect(e.target.value as VideoAspect)} className="rounded bg-ink-800 border border-ink-700 px-2 py-1">
              <option value="16:9">16:9</option>
              <option value="9:16">9:16 vertical</option>
              <option value="1:1">1:1 square</option>
            </select>
          </label>
          <label className="flex items-center gap-1">
            Look
            <select value={template} onChange={(e) => setTemplate(e.target.value as VideoTemplate)} className="rounded bg-ink-800 border border-ink-700 px-2 py-1 capitalize">
              {VIDEO_TEMPLATES.map((t) => <option key={t} value={t} className="capitalize">{t}</option>)}
            </select>
          </label>
          <label className="flex items-center gap-1 cursor-pointer">
            <input type="checkbox" checked={fast} onChange={(e) => setFast(e.target.checked)} className="accent-gold-500" />
            Fast images (turbo)
          </label>
          <label className="flex items-center gap-1 cursor-pointer">
            <input type="checkbox" checked={soundEffects} onChange={(e) => setSoundEffects(e.target.checked)} className="accent-gold-500" />
            Transition SFX
          </label>
          <label className="flex items-center gap-1" title="How much a scene with your photo is transformed. Lower = keep more of you.">
            Photo transform
            <input type="range" min={0.2} max={0.9} step={0.05} value={photoStrength} onChange={(e) => setPhotoStrength(Number(e.target.value))} />
            <span className="tabular-nums">{Math.round(photoStrength * 100)}%</span>
          </label>
          <button onClick={plan} disabled={generating || building} className="ml-auto rounded-md bg-gold-500 px-4 py-2 text-sm font-medium text-ink-950 hover:bg-gold-400 disabled:opacity-40">
            Plan scenes
          </button>
        </div>
        <p className="text-[10px] text-ink-500">
          📎 “Put me in (photo)” on any scene uses your photo as the base (free image-to-image). It keeps your
          photo’s composition and follows the prompt (clothes, setting, style); exact face likeness varies. The free
          photo queue can be slow — add a free AI Horde key in Settings for priority.
        </p>
      </div>

      {error && <div className="mt-4 rounded-md border border-red-800 bg-red-950/40 px-4 py-3 text-sm text-red-300">{error}</div>}

      {/* Scene controls + progress */}
      {scenes.length > 0 && (
        <div className="mt-6">
          <div className="flex items-center gap-3 mb-3">
            {!generating ? (
              <button onClick={generateRemaining} disabled={building} className="rounded-md bg-emerald-600 px-4 py-2 text-sm font-medium text-white hover:bg-emerald-500 disabled:opacity-40">
                {doneCount ? '▶ Generate remaining' : '▶ Generate all scenes'}
              </button>
            ) : paused ? (
              <button onClick={generateRemaining} className="rounded-md bg-emerald-600 px-4 py-2 text-sm font-medium text-white hover:bg-emerald-500">
                ▶ Resume
              </button>
            ) : (
              <button onClick={pause} className="rounded-md bg-amber-600 px-4 py-2 text-sm font-medium text-white hover:bg-amber-500">
                ⏸ Pause
              </button>
            )}
            <div className="flex-1">
              <div className="flex justify-between text-[11px] text-ink-400 mb-1">
                <span>{doneCount} / {scenes.length} scenes ready{generating && !paused ? ' — generating…' : paused ? ' — paused' : ''}</span>
                <span>{genPct}%</span>
              </div>
              <div className="h-2 rounded bg-ink-800 overflow-hidden">
                <div className="h-full bg-gold-500 transition-all" style={{ width: `${genPct}%` }} />
              </div>
            </div>
            <button onClick={build} disabled={building || generating || doneCount === 0} className="rounded-md bg-gold-500 px-4 py-2 text-sm font-medium text-ink-950 hover:bg-gold-400 disabled:opacity-40">
              {building ? 'Building…' : '🎬 Build video'}
            </button>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            {scenes.map((s, arrIdx) => (
              <div key={s.index} className="rounded-lg border border-ink-800 bg-ink-900 p-3">
                <div className="flex items-center justify-between mb-1">
                  <span className="text-xs text-gold-400 font-medium">Scene {arrIdx + 1} · {s.label}</span>
                  <div className="flex items-center gap-1">
                    <span className="text-[10px] text-ink-500 mr-1">
                      {s.status === 'generating' ? '…working' : s.status === 'done' ? '✓ ready' : s.status === 'error' ? '✗ failed' : 'idle'}
                    </span>
                    <button onClick={() => moveScene(arrIdx, -1)} disabled={arrIdx === 0} title="Move up" className="text-[11px] text-ink-500 hover:text-gold-400 disabled:opacity-30">↑</button>
                    <button onClick={() => moveScene(arrIdx, 1)} disabled={arrIdx === scenes.length - 1} title="Move down" className="text-[11px] text-ink-500 hover:text-gold-400 disabled:opacity-30">↓</button>
                    <button onClick={() => removeScene(s.index)} title="Remove scene" className="text-[11px] text-ink-500 hover:text-red-300">✕</button>
                  </div>
                </div>
                <div className="aspect-video rounded bg-ink-950 overflow-hidden flex items-center justify-center mb-2">
                  {s.img ? (
                    <img src={s.img} alt={`scene ${s.index + 1}`} className="w-full h-full object-cover" />
                  ) : (
                    <span className="px-2 text-center text-[11px] text-ink-600">
                      {s.status === 'generating' ? s.msg ?? 'Generating…' : s.status === 'error' ? s.msg ?? 'failed' : 'not generated'}
                    </span>
                  )}
                </div>
                <div className="flex items-center gap-2 mb-1 text-[10px]">
                  <button onClick={() => attachPhoto(s.index)} className="rounded border border-ink-700 px-2 py-0.5 text-ink-300 hover:border-gold-500">
                    📎 {s.photo ? 'Change photo' : 'Put me in (photo)'}
                  </button>
                  {s.photo && (
                    <>
                      <span className="text-emerald-400">photo attached</span>
                      <button onClick={() => patchScene(s.index, { photo: null })} className="text-ink-500 hover:text-red-300">remove</button>
                    </>
                  )}
                </div>
                <textarea
                  value={s.prompt}
                  onChange={(e) => patchScene(s.index, { prompt: e.target.value })}
                  rows={2}
                  className="w-full resize-y rounded bg-ink-950 border border-ink-800 px-2 py-1 text-[11px] text-ink-200"
                />
                <div className="mt-1 flex items-center gap-2">
                  <button onClick={() => regenerate(s.index)} disabled={s.status === 'generating'} className="rounded border border-ink-700 px-2 py-1 text-[11px] text-ink-300 hover:border-gold-500 disabled:opacity-40">
                    ↻ Regenerate this scene
                  </button>
                  <MicButton onText={(t) => patchScene(s.index, { prompt: appendDictation(s.prompt, t) })} />
                </div>
              </div>
            ))}
          </div>
          <button
            onClick={addScene}
            className="mt-3 rounded-md border border-dashed border-ink-700 px-4 py-2 text-xs text-ink-400 hover:border-gold-500 hover:text-gold-400"
          >
            ＋ Add a scene
          </button>
        </div>
      )}

      {/* Build progress + result */}
      {building && (
        <div className="mt-6 rounded-lg border border-ink-800 bg-ink-950 p-4">
          <div className="flex justify-between text-[11px] text-ink-400 mb-1">
            <span>{stage ?? 'Building…'}</span>
            {buildPct != null && <span>{buildPct}%</span>}
          </div>
          <div className="h-2 rounded bg-ink-800 overflow-hidden">
            <div className="h-full bg-emerald-500 transition-all" style={{ width: `${buildPct ?? 5}%` }} />
          </div>
          {buildPreview && <img src={buildPreview} alt="preview" className="mt-3 w-full max-w-sm rounded border border-ink-800" />}
        </div>
      )}
      {built && (
        <div className="mt-6 rounded-lg border border-ink-800 bg-ink-900 p-4">
          <div className="text-sm text-ink-100 mb-2">✓ Built “{built.title}” — also saved in Video Studio.</div>
          <video src={fileUrl(built.path)} controls className="w-full max-w-2xl rounded bg-black" />
          <div className="mt-2">
            <button onClick={() => void window.api.video.reveal(built.path)} className="rounded bg-ink-800 px-3 py-1.5 text-xs text-ink-200 hover:bg-ink-700">
              Show file
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
