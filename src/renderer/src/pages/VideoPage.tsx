import { useEffect, useMemo, useRef, useState } from 'react'
import { useLocation } from 'react-router-dom'
import { useAutosave } from '../hooks/useAutosave'
import type {
  AiEngineStatus,
  ExportFormat,
  GeneratedScript,
  LibraryEntry,
  LookEngine,
  Mood,
  PostMetadata,
  TrimMode,
  VideoAspect,
  VideoJob,
  VideoResolution,
  VideoStyle,
  VideoTemplate
} from '../../../shared/types'
import { EXPORT_FORMATS, MOODS, VIDEO_STYLES, VIDEO_TEMPLATES } from '../../../shared/types'
import { useStudio } from '../store/StudioContext'
import MicButton, { appendDictation } from '../components/MicButton'
import VoiceRecorder from '../components/VoiceRecorder'
import { toast } from '../components/Toast'
import { confirmDialog } from '../components/Confirm'
import DjStationPage from './DjStationPage'
import DirectorPage from './DirectorPage'

const ENGINE_INFO: Record<LookEngine, { label: string; badge: string; blurb: string }> = {
  presets: {
    label: 'Style presets',
    badge: '🟢 Free · offline',
    blurb: 'Styles text, backgrounds, waveform + your own images. Always works, no key.'
  },
  'ai-free': {
    label: 'AI visuals (free)',
    badge: '🟢 Free · online · no key',
    blurb: 'Generates a real AI image for each scene and animates them. Needs internet; no key or install.'
  },
  'ai-cloud': {
    label: 'AI footage (cloud)',
    badge: '💳 Paid · your key',
    blurb: 'Real AI-generated footage from a paid provider you supply a key for.'
  },
  'ai-local': {
    label: 'AI footage (local GPU)',
    badge: '🟢 Free · needs GPU',
    blurb: 'Runs AI models on your own GPU via a local server. Free per video, not portable.'
  }
}

const SCRIPTPAD_KEY = '__scriptpad__'

/** Turns an absolute Windows/POSIX path into a file:// URL usable in a <video src>. */
function fileUrl(p: string): string {
  return `file:///${p.replace(/\\/g, '/').replace(/^\/+/, '')}`
}

/** Legitimately free / royalty-free music libraries. Downloading here is legal —
 * unlike ripping arbitrary YouTube videos, which would violate YouTube's terms.
 * Opened in the system browser via the main window's external-link handler. */
const FREE_MUSIC = [
  { name: 'YouTube Audio Library', url: 'https://studio.youtube.com/', note: 'YouTube Studio → Audio Library (free for YouTube)' },
  { name: 'Pixabay Music', url: 'https://pixabay.com/music/', note: 'CC0 / no attribution needed' },
  { name: 'Incompetech', url: 'https://incompetech.com/music/royalty-free/music.html', note: 'Kevin MacLeod, CC-BY (credit him)' },
  { name: 'Free Music Archive', url: 'https://freemusicarchive.org/', note: 'Creative Commons tracks' },
  { name: 'Chosic', url: 'https://www.chosic.com/free-music/all/', note: 'Royalty-free, filterable by mood' }
]

/** A script that can be turned into a video — either the live Writer draft or a saved Library script. */
interface VideoSource {
  key: string
  label: string
  title: string
  body: string
}

/** Always-present source: a blank slate you can paste into, type in, or fill by uploading a file. */
const PASTE_KEY = '__paste__'
const PASTE_SOURCE: VideoSource = {
  key: PASTE_KEY,
  label: '✍️ Paste / write my own script',
  title: '',
  body: ''
}

export default function VideoPage() {
  const { writer } = useStudio()
  const location = useLocation()
  // Set when the user clicked "Send to Video Generator" on the Script Pad.
  const wantScriptPad = (location.state as { useScriptPad?: boolean } | null)?.useScriptPad === true

  const [sources, setSources] = useState<VideoSource[]>([])
  const [selectedKey, setSelectedKey] = useState<string>('')
  const [title, setTitle] = useState('')
  const [body, setBody] = useState('')

  // Persist the paste/write-your-own script editor so switching tabs never loses it.
  // Skip restore when navigating in from "Send to Video Generator" (that flow supplies
  // its own content). Memoized ref → no autosave save-loop.
  const editorPersist = useMemo(() => ({ title, body }), [title, body])
  useAutosave('video-editor', editorPersist, (v) => {
    if (wantScriptPad) return
    if (v.title != null) setTitle(v.title)
    if (v.body != null) setBody(v.body)
  })

  const [studioView, setStudioView] = useState<'build' | 'sound' | 'director'>('build')
  const [resolution, setResolution] = useState<VideoResolution>('1080p')
  const [aspect, setAspect] = useState<VideoAspect>('16:9')
  const [template, setTemplate] = useState<VideoTemplate>('cinematic')
  const [narrationVoice, setNarrationVoice] = useState<'windows' | 'piper' | 'winnatural'>('windows')
  const [piperInstalled, setPiperInstalled] = useState(false)
  // Windows NATURAL voices (incl. Urdu Asad/Uzma once the Windows speech pack exists).
  const [winVoices, setWinVoices] = useState<{ id: string; name: string; language: string }[]>([])
  const [winVoiceId, setWinVoiceId] = useState('')
  const [previewing, setPreviewing] = useState(false)
  const [musicPath, setMusicPath] = useState<string | null>(null)
  const [soundEffects, setSoundEffects] = useState(true)
  // Default to the free per-scene AI engine so the visuals actually follow the script
  // (a real generated image per section) instead of plain text cards over a gradient.
  // Falls back to the animated look automatically if the image service is unreachable.
  const [engine, setEngine] = useState<LookEngine>('ai-free')
  const [style, setStyle] = useState<VideoStyle>('cinematic')
  const [images, setImages] = useState<string[]>([])
  const [useStock, setUseStock] = useState(false)
  const [hasStockKey, setHasStockKey] = useState(false)
  const [aiStatus, setAiStatus] = useState<AiEngineStatus | null>(null)
  const [plan, setPlan] = useState<{ hook: string; sections: { title: string; keyword: string; seconds: number }[]; thumbnailIdea: string; ctrTips: string[] } | null>(null)
  const [planning, setPlanning] = useState(false)

  /** Speaks one line in the chosen Windows natural voice so it can be judged by ear. */
  async function previewWinVoice(): Promise<void> {
    setPreviewing(true)
    try {
      const r = await window.api.voice.winNaturalPreview(
        winVoiceId,
        'Salam. Yeh aapki narration ki awaaz hai. This is your narration voice.'
      )
      if (r.ok && r.wavBase64) {
        await new Audio(`data:audio/wav;base64,${r.wavBase64}`).play()
      } else {
        toast(r.error || 'Could not play that voice.', 'error')
      }
    } catch (err) {
      toast(err instanceof Error ? err.message : 'Could not play that voice.', 'error')
    } finally {
      setPreviewing(false)
    }
  }

  async function handlePlan(): Promise<void> {
    if (!title.trim() && !body.trim()) return
    setPlanning(true)
    setError(null)
    setPlan(null)
    try {
      setPlan(await window.api.video.plan(title.trim(), body))
    } catch (err) {
      setError(err instanceof Error ? err.message : 'AI planning failed — is your AI brain (Ollama/key) set up?')
    } finally {
      setPlanning(false)
    }
  }

  const [building, setBuilding] = useState(false)
  const [stage, setStage] = useState<string | null>(null)
  const [buildPreview, setBuildPreview] = useState<string | null>(null)
  const [musicBusyId, setMusicBusyId] = useState<string | null>(null)
  const [replaceMood, setReplaceMood] = useState<Mood>('calm')
  const [voiceOpenId, setVoiceOpenId] = useState<string | null>(null)
  const [captionBusyId, setCaptionBusyId] = useState<string | null>(null)
  const [shortsBusyId, setShortsBusyId] = useState<string | null>(null)
  const [shortsCount, setShortsCount] = useState(3)
  const [metaBusyId, setMetaBusyId] = useState<string | null>(null)
  const [postMeta, setPostMeta] = useState<{ id: string; meta: PostMetadata } | null>(null)
  const [watermarkLogo, setWatermarkLogo] = useState<string | null>(null)
  const [watermarkPos, setWatermarkPos] = useState<'top-left' | 'top-right' | 'bottom-left' | 'bottom-right'>('bottom-right')
  const [watermarkBusyId, setWatermarkBusyId] = useState<string | null>(null)
  const [publishBusyId, setPublishBusyId] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [savedNote, setSavedNote] = useState<string | null>(null)
  const [cancelling, setCancelling] = useState(false)

  async function handleCancel(): Promise<void> {
    setCancelling(true)
    try {
      await window.api.video.cancel()
    } finally {
      // The in-flight build/export/trim promise will reject and reset the flags.
      setTimeout(() => setCancelling(false), 500)
    }
  }

  /** True when the failure was a user cancellation rather than a real error. */
  function isCancel(err: unknown): boolean {
    return err instanceof Error && /cancel/i.test(err.message)
  }

  const [jobs, setJobs] = useState<VideoJob[]>([])
  const [exportFormat, setExportFormat] = useState<ExportFormat>('youtube')
  const [exportingId, setExportingId] = useState<string | null>(null)
  const [enhanceBusyId, setEnhanceBusyId] = useState<string | null>(null)
  const [trimOpenId, setTrimOpenId] = useState<string | null>(null)
  const [trimMode, setTrimMode] = useState<TrimMode>('remove')
  const [trimStart, setTrimStart] = useState(0)
  const [trimEnd, setTrimEnd] = useState(0)
  const [trimmingId, setTrimmingId] = useState<string | null>(null)
  const [stitchSel, setStitchSel] = useState<string[]>([])
  const [stitching, setStitching] = useState(false)
  const videoRefs = useRef<Record<string, HTMLVideoElement | null>>({})

  async function handleEnhance(job: VideoJob): Promise<void> {
    setEnhanceBusyId(job.id)
    try {
      const res = await window.api.video.enhance(job.id)
      if (res.ok) { await refreshJobs(); toast('Enhanced copy created ✓', 'success') }
      else toast(res.error ?? 'Enhance failed', 'error')
    } catch (err) {
      toast(err instanceof Error ? err.message : 'Enhance failed', 'error')
    } finally {
      setEnhanceBusyId(null)
    }
  }

  async function refreshJobs(): Promise<void> {
    const vids = (await window.api.video.list()) as VideoJob[]
    setJobs(vids)
  }

  // Assemble the list of scripts you can build from: the current Writer draft (if
  // any) plus every script already saved to the Library. Also load built videos.
  useEffect(() => {
    void (async () => {
      const [lib, vids, pad] = await Promise.all([
        window.api.library.list(),
        window.api.video.list(),
        window.api.scriptpad.get()
      ])
      const saved = (lib as LibraryEntry[])
        .filter((e) => e.kind === 'script')
        .map((e) => e.data as GeneratedScript)
      // The blank "paste / write your own" slate is always first so you never
      // depend on having generated a finance script to make a video.
      const next: VideoSource[] = [PASTE_SOURCE]
      if (pad.body.trim()) {
        next.push({
          key: SCRIPTPAD_KEY,
          label: `📝 Script Pad${pad.title ? ` — ${pad.title}` : ''}`,
          title: pad.title,
          body: pad.body
        })
      }
      if (writer.script && writer.body.trim()) {
        next.push({ key: 'writer', label: `Current Writer draft — ${writer.script.title}`, title: writer.script.title, body: writer.body })
      }
      for (const s of saved) {
        next.push({ key: s.id, label: s.title, title: s.title, body: s.body })
      }
      setSources(next)
      setJobs(vids as VideoJob[])
      void refreshAiStatus()
      void window.api.voice.piperStatus().then((s) => setPiperInstalled(s.installed))
      void window.api.voice.winNaturalList().then((list) => {
        setWinVoices(list)
        // Prefer an Urdu voice by default when one is installed — this channel narrates
        // in Roman Urdu/Urdu, so ur-PK is almost always the right pick.
        const urdu = list.find((v) => v.language.toLowerCase().startsWith('ur'))
        setWinVoiceId((cur) => cur || urdu?.id || list[0]?.id || '')
      })
      void window.api.stock.getConfig().then((c) => {
        setHasStockKey(c.hasPixabay)
        if (c.hasPixabay) setUseStock(true)
      })
      if (selectedKey) return
      // If the user arrived via the Script Pad's "Send to Video Generator", start
      // on that. Otherwise prefer a real script (Writer/Library/Pad) over the
      // blank slate, falling back to the blank slate when nothing else exists.
      const initial = (wantScriptPad && next.find((s) => s.key === SCRIPTPAD_KEY)) || next[1] || next[0]
      if (initial) {
        setSelectedKey(initial.key)
        setTitle(initial.title)
        setBody(initial.body)
      }
    })()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  function handleSelect(key: string): void {
    setSelectedKey(key)
    const src = sources.find((s) => s.key === key)
    if (src) {
      setTitle(src.title)
      setBody(src.body)
    }
  }

  async function handleBuild(): Promise<void> {
    // Only a script is required now — a missing title is auto-derived from the first line
    // (previously the button stayed disabled unless you ALSO typed a title).
    if (!body.trim()) return
    const effectiveTitle =
      title.trim() ||
      body.replace(/^[\s#*[\]]+/, '').split(/[\n.!?]/)[0].split(/\s+/).slice(0, 8).join(' ').slice(0, 60) ||
      'My Video'
    setBuilding(true)
    setError(null)
    setStage('Starting…')
    setBuildPreview(null)
    const unsubscribe = window.api.video.onProgress((s) => setStage(s))
    const unsubPreview = window.api.video.onPreview((png) => setBuildPreview(`${fileUrl(png)}?t=${Date.now()}`))
    try {
      await window.api.video.build({
        title: effectiveTitle,
        body,
        resolution,
        aspect,
        template,
        narrationVoice,
        winVoiceId: narrationVoice === 'winnatural' ? winVoiceId : undefined,
        musicPath: musicPath ?? undefined,
        soundEffects,
        engine,
        style,
        images: engine === 'presets' && images.length ? images : undefined,
        useStock: engine === 'presets' && useStock && hasStockKey
      })
      await refreshJobs()
      toast('Video built ✓', 'success')
    } catch (err) {
      if (isCancel(err)) setSavedNote('Build stopped.')
      else {
        setError(err instanceof Error ? err.message : 'Video build failed')
        toast(err instanceof Error ? err.message : 'Video build failed', 'error')
      }
    } finally {
      unsubscribe()
      unsubPreview()
      setBuilding(false)
      setStage(null)
      setBuildPreview(null)
    }
  }

  async function handlePickMusic(): Promise<void> {
    const p = await window.api.video.pickMusic()
    if (p) setMusicPath(p)
  }

  async function handleSetMusic(job: VideoJob, mode: 'remove' | 'replace'): Promise<void> {
    setMusicBusyId(job.id)
    setError(null)
    setStage(mode === 'remove' ? 'Removing background music…' : 'Replacing background music…')
    const unsubscribe = window.api.video.onProgress((s) => setStage(s))
    try {
      await window.api.video.setMusic(job.id, mode, mode === 'replace' ? replaceMood : undefined)
      await refreshJobs()
      toast(mode === 'remove' ? 'Music removed — voice kept ✓' : 'Music replaced ✓', 'success')
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Music edit failed')
      toast(err instanceof Error ? err.message : 'Music edit failed', 'error')
    } finally {
      unsubscribe()
      setMusicBusyId(null)
      setStage(null)
    }
  }

  async function handlePublish(job: VideoJob): Promise<void> {
    setPublishBusyId(job.id)
    setError(null)
    setSavedNote(null)
    try {
      const r = await window.api.youtube.publish(job.id)
      setSavedNote(
        `YouTube upload page opened + file revealed. Title/description/tags copied to clipboard — paste them in. (${r.tags.length} tags generated.)`
      )
      toast('YouTube upload page opened · details copied to clipboard', 'success')
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not prepare the upload')
      toast('Could not prepare the upload', 'error')
    } finally {
      setPublishBusyId(null)
    }
  }

  async function pickLogo(): Promise<void> {
    const paths = await window.api.video.pickImages()
    if (paths[0]) setWatermarkLogo(paths[0])
  }

  async function handleWatermark(job: VideoJob): Promise<void> {
    if (!watermarkLogo) {
      setError('Pick a logo image first (PNG with transparency looks best).')
      return
    }
    setWatermarkBusyId(job.id)
    setError(null)
    setSavedNote(null)
    setStage('Adding logo watermark…')
    const unsubscribe = window.api.video.onProgress((s) => setStage(s))
    try {
      await window.api.video.watermark(job.id, watermarkLogo, watermarkPos)
      await refreshJobs()
      setSavedNote('Watermarked video created (saved in the list).')
      toast('Logo added ✓', 'success')
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Watermark failed')
      toast(err instanceof Error ? err.message : 'Watermark failed', 'error')
    } finally {
      unsubscribe()
      setWatermarkBusyId(null)
      setStage(null)
    }
  }

  // Auto-caption: transcribe narration → .srt (and optionally burn into the video).
  async function handleCaptions(job: VideoJob, burn: boolean): Promise<void> {
    setCaptionBusyId(job.id)
    setError(null)
    setSavedNote(null)
    setStage(burn ? 'Transcribing + burning captions…' : 'Transcribing narration…')
    const unsubscribe = window.api.video.onProgress((s) => setStage(s))
    try {
      const res = await window.api.video.captions(job.id, burn)
      if (burn) await refreshJobs()
      setSavedNote(burn ? 'Captioned video created (also saved in the list).' : `Subtitles saved: ${res.srtPath}`)
      toast(burn ? 'Captioned video created ✓' : 'Subtitles (.srt) saved ✓', 'success')
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Captioning failed')
      toast(err instanceof Error ? err.message : 'Captioning failed', 'error')
    } finally {
      unsubscribe()
      setCaptionBusyId(null)
      setStage(null)
    }
  }

  /**
   * MAKE SHORTS — cut this video into vertical, captioned clips for Shorts/TikTok/Reels.
   * Everything is local and free: offline transcript → best moments → 9:16 crop + burned
   * captions. Each clip appears in this same list.
   */
  /** Ready-to-paste title/description/hashtags for one finished clip. */
  async function handlePostMeta(job: VideoJob, platform: 'youtube' | 'tiktok'): Promise<void> {
    setMetaBusyId(job.id)
    setError(null)
    try {
      // A 9:16 clip is a short — the title carries the marker set when it was cut.
      const vertical = /short/i.test(job.title)
      const meta = await window.api.shorts.postMeta(job.id, platform, vertical)
      setPostMeta({ id: job.id, meta })
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not write posting text')
      toast(err instanceof Error ? err.message : 'Could not write posting text', 'error')
    } finally {
      setMetaBusyId(null)
    }
  }

  async function handleMakeShorts(job: VideoJob, count: number): Promise<void> {
    setShortsBusyId(job.id)
    setError(null)
    setSavedNote(null)
    setStage('Finding the best moments…')
    const unsubscribe = window.api.video.onProgress((s) => setStage(s))
    try {
      const res = await window.api.shorts.make(job.id, count)
      await refreshJobs()
      const picked = res.moments.map((m, i) => `${i + 1}. “${m.title}” — ${m.reason}`).join('\n')
      setSavedNote(`${res.jobs.length} vertical short(s) created and added to this list:\n${picked}`)
      toast(`${res.jobs.length} short(s) ready ✓`, 'success')
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not make shorts')
      toast(err instanceof Error ? err.message : 'Could not make shorts', 'error')
    } finally {
      unsubscribe()
      setShortsBusyId(null)
      setStage(null)
    }
  }

  // Outside videos (music already blended in): AI-separate to remove music, keep vocals.
  async function handleSeparateMusic(job: VideoJob, engine: 'online' | 'local'): Promise<void> {
    setMusicBusyId(job.id)
    setError(null)
    setStage(engine === 'online' ? 'Separating audio (online)…' : 'Separating audio (local)…')
    const unsubscribe = window.api.video.onProgress((s) => setStage(s))
    try {
      await window.api.video.separateMusic(job.id, engine)
      await refreshJobs()
      toast('Music separated out ✓', 'success')
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Separation failed')
      toast(err instanceof Error ? err.message : 'Separation failed', 'error')
    } finally {
      unsubscribe()
      setMusicBusyId(null)
      setStage(null)
    }
  }

  async function handleAddImages(): Promise<void> {
    const paths = await window.api.video.pickImages()
    if (paths.length) setImages((prev) => [...prev, ...paths])
  }

  async function refreshAiStatus(): Promise<void> {
    try {
      setAiStatus(await window.api.ai.engineStatus())
    } catch {
      /* status is best-effort; badges just show defaults */
    }
  }

  // Upload a .txt/.md/.srt/.pdf and drop its text straight into the editor as a
  // brand-new "paste / write your own" script. No finance generation required.
  async function handleImportFile(): Promise<void> {
    setError(null)
    const res = await window.api.video.importScript()
    if (res.canceled) return
    if (res.error) {
      setError(res.error)
      return
    }
    setSelectedKey(PASTE_KEY)
    if (res.title) setTitle(res.title)
    if (res.body) setBody(res.body)
  }

  async function handleDelete(id: string): Promise<void> {
    const ok = await confirmDialog({
      title: 'Delete this video?',
      message:
        'This permanently deletes the built video AND its file on disk. This cannot be undone.',
      danger: true
    })
    if (!ok) return
    await window.api.video.remove(id)
    await refreshJobs()
    setStitchSel((s) => s.filter((x) => x !== id))
  }

  function toggleStitchSel(id: string): void {
    setStitchSel((s) => (s.includes(id) ? s.filter((x) => x !== id) : [...s, id]))
  }

  async function handleStitch(): Promise<void> {
    if (stitchSel.length < 2) return
    setStitching(true)
    setError(null)
    setSavedNote(null)
    setStage('Stitching videos…')
    const unsub = window.api.video.onProgress((s) => setStage(s))
    try {
      // Preserve the order in which they were selected.
      await window.api.video.stitch(stitchSel)
      await refreshJobs()
      setStitchSel([])
      setSavedNote('Stitched video created below.')
    } catch (err) {
      if (isCancel(err)) setSavedNote('Stitch stopped.')
      else setError(err instanceof Error ? err.message : 'Stitch failed')
    } finally {
      unsub()
      setStitching(false)
      setStage(null)
    }
  }

  function toggleTrim(job: VideoJob): void {
    if (trimOpenId === job.id) {
      setTrimOpenId(null)
      return
    }
    // Seed the range from the player: start at current time, end at duration.
    const el = videoRefs.current[job.id]
    const dur = el && Number.isFinite(el.duration) ? el.duration : 0
    setTrimStart(el ? Math.floor(el.currentTime) : 0)
    setTrimEnd(dur ? Math.round(dur) : 0)
    setTrimMode('remove')
    setTrimOpenId(job.id)
  }

  function applyCurrentTime(job: VideoJob, which: 'start' | 'end'): void {
    const el = videoRefs.current[job.id]
    if (!el) return
    const val = Math.round(el.currentTime * 100) / 100
    if (which === 'start') setTrimStart(val)
    else setTrimEnd(val)
  }

  async function handleTrim(job: VideoJob): Promise<void> {
    if (trimEnd - trimStart < 0.05) {
      setError('Pick an end time later than the start (at least 0.05s apart).')
      return
    }
    setError(null)
    setSavedNote(null)
    setTrimmingId(job.id)
    setStage(trimMode === 'keep' ? 'Cutting your clip…' : 'Removing that section…')
    const unsubscribe = window.api.video.onProgress((s) => setStage(s))
    try {
      await window.api.video.trim(job.id, trimMode, trimStart, trimEnd)
      await refreshJobs()
      setTrimOpenId(null)
    } catch (err) {
      if (isCancel(err)) setSavedNote('Trim stopped.')
      else setError(err instanceof Error ? err.message : 'Trim failed')
    } finally {
      unsubscribe()
      setTrimmingId(null)
      setStage(null)
    }
  }

  async function handleSaveAs(job: VideoJob): Promise<void> {
    setSavedNote(null)
    const name = `${(job.title || 'video').replace(/[^a-z0-9]+/gi, '-').toLowerCase()}.mp4`
    const res = await window.api.video.saveAs(job.path, name)
    if (res.saved) setSavedNote(`Saved a copy to ${res.path}`)
  }

  // Transcode + download a video in the chosen delivery format. Streams coarse
  // ffmpeg progress into the same stage line the build uses.
  async function handleExport(job: VideoJob): Promise<void> {
    setSavedNote(null)
    setError(null)
    setExportingId(job.id)
    setStage('Preparing export…')
    const unsubscribe = window.api.video.onProgress((s) => setStage(s))
    try {
      const res = await window.api.video.export(job.id, exportFormat)
      if (res.saved) setSavedNote(`Downloaded (${exportFormat}) to ${res.path}`)
    } catch (err) {
      if (isCancel(err)) setSavedNote('Export stopped.')
      else setError(err instanceof Error ? err.message : 'Export failed')
    } finally {
      unsubscribe()
      setExportingId(null)
      setStage(null)
    }
  }

  // (The old inline mic-recording flow lived here; it was superseded by the full
  // 🎙 Voice studio (VoiceRecorder component) — pause/resume, scrub, redo-from-playhead.)

  const wordCount = body.trim() ? body.trim().split(/\s+/).length : 0

  return (
    <div className="max-w-6xl mx-auto p-8">
      <div>
        <h1 className="text-2xl font-serif text-ink-100">Video Studio</h1>
        <p className="text-ink-400 text-sm mt-1">
          Build narrated videos and craft their sound — all in one place. Free, on your own machine. Every video
          auto-saves to memory.
        </p>
      </div>

      {/* Sub-tabs: build the video, or open the Sound Studio (DJ) — one unified studio. */}
      <div className="mt-4 inline-flex rounded-lg border border-ink-700 bg-ink-900 p-1">
        <button
          onClick={() => setStudioView('build')}
          className={`rounded-md px-4 py-1.5 text-sm transition-colors ${
            studioView === 'build' ? 'bg-gold-500 text-ink-950 font-medium' : 'text-ink-300 hover:text-ink-100'
          }`}
        >
          🎬 Build &amp; Videos
        </button>
        <button
          onClick={() => setStudioView('sound')}
          className={`rounded-md px-4 py-1.5 text-sm transition-colors ${
            studioView === 'sound' ? 'bg-gold-500 text-ink-950 font-medium' : 'text-ink-300 hover:text-ink-100'
          }`}
        >
          🎚 Sound Studio (DJ)
        </button>
        <button
          onClick={() => setStudioView('director')}
          className={`rounded-md px-4 py-1.5 text-sm transition-colors ${
            studioView === 'director' ? 'bg-gold-500 text-ink-950 font-medium' : 'text-ink-300 hover:text-ink-100'
          }`}
        >
          🧠 AI Director
        </button>
      </div>

      {studioView === 'sound' && (
        <div className="mt-6">
          <DjStationPage embedded />
        </div>
      )}

      {studioView === 'director' && (
        <div className="mt-6">
          <DirectorPage embedded />
        </div>
      )}

      <div className={`mt-6 grid grid-cols-1 lg:grid-cols-3 gap-6 ${studioView === 'build' ? '' : 'hidden'}`}>
        <div className="lg:col-span-1 space-y-3">
          <div className="rounded-lg border border-ink-700 bg-ink-900 p-4 space-y-3">
            <div>
              <label className="text-xs text-ink-400">Script to turn into a video</label>
              <select
                value={selectedKey}
                onChange={(e) => handleSelect(e.target.value)}
                className="mt-1 w-full rounded-md bg-ink-800 border border-ink-700 px-3 py-2 text-sm text-ink-100 outline-none focus:border-gold-500"
              >
                {sources.map((s) => (
                  <option key={s.key} value={s.key}>
                    {s.label}
                  </option>
                ))}
              </select>
              <button
                onClick={handleImportFile}
                className="mt-1.5 w-full rounded-md border border-ink-600 hover:border-gold-500 text-ink-200 text-xs px-3 py-1.5 transition-colors"
              >
                📄 Upload a file (.txt / .md / .srt / .pdf)
              </button>
              <p className="text-[10px] text-ink-600 mt-1">
                Pick <span className="text-ink-400">“✍️ Paste / write my own”</span> to type or paste a script
                directly, or upload a file to load one. You can freely edit the title and text below before building.
              </p>
            </div>
            <div>
              <div className="flex items-center justify-between">
                <label className="text-xs text-ink-400">Video title</label>
                <MicButton onText={(t) => setTitle((prev) => appendDictation(prev, t))} />
              </div>
              <input
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                placeholder="Video title shown on the opening card"
                className="mt-1 w-full rounded-md bg-ink-800 border border-ink-700 px-3 py-2 text-sm text-ink-100 outline-none focus:border-gold-500"
              />
            </div>
            <div>
              <div className="flex items-center justify-between">
                <label className="text-xs text-ink-400">Narration script ({wordCount} words)</label>
                <MicButton onText={(t) => setBody((prev) => appendDictation(prev, t))} />
              </div>
              <textarea
                value={body}
                onChange={(e) => setBody(e.target.value)}
                rows={10}
                placeholder="The spoken narration. Bracketed [STAGE DIRECTIONS] become on-screen section cards."
                className="mt-1 w-full rounded-md bg-ink-800 border border-ink-700 px-3 py-2 text-sm text-ink-100 leading-relaxed outline-none focus:border-gold-500 font-serif"
              />
            </div>
            <div>
              <button
                onClick={handlePlan}
                disabled={planning || (!title.trim() && !body.trim())}
                className="w-full rounded-md border border-ink-600 hover:border-gold-500 text-ink-200 text-xs px-3 py-1.5 transition-colors disabled:opacity-50"
              >
                {planning ? 'Planning…' : '🧭 AI Plan this video (hook + b-roll + CTR tips)'}
              </button>
              {plan && (
                <div className="mt-2 rounded-md border border-ink-700 bg-ink-800 p-3 space-y-2 text-[11px]">
                  {plan.hook && (
                    <div>
                      <span className="text-gold-400">Hook:</span> <span className="text-ink-200">{plan.hook}</span>
                    </div>
                  )}
                  {plan.sections.length > 0 && (
                    <div>
                      <span className="text-gold-400">Sections &amp; b-roll:</span>
                      <ul className="mt-1 space-y-0.5">
                        {plan.sections.map((s, i) => (
                          <li key={i} className="text-ink-300">
                            • <span className="text-ink-100">{s.title}</span>
                            {s.keyword ? ` → 🎞 ${s.keyword}` : ''}
                            {s.seconds ? ` (~${s.seconds}s)` : ''}
                          </li>
                        ))}
                      </ul>
                    </div>
                  )}
                  {plan.thumbnailIdea && (
                    <div>
                      <span className="text-gold-400">Thumbnail:</span> <span className="text-ink-200">{plan.thumbnailIdea}</span>
                    </div>
                  )}
                  {plan.ctrTips.length > 0 && (
                    <div>
                      <span className="text-gold-400">CTR tips:</span>
                      <ul className="mt-1 space-y-0.5">
                        {plan.ctrTips.map((t, i) => (
                          <li key={i} className="text-ink-300">• {t}</li>
                        ))}
                      </ul>
                    </div>
                  )}
                  <p className="text-[10px] text-ink-600">
                    Guidance from your AI brain. Use the b-roll keywords with stock footage, and the hook/tips to sharpen
                    your script &amp; thumbnail.
                  </p>
                </div>
              )}
            </div>

            <div>
              <label className="text-xs text-ink-400">Video look (engine)</label>
              <div className="mt-1 space-y-1.5">
                {(Object.keys(ENGINE_INFO) as LookEngine[]).map((id) => {
                  const info = ENGINE_INFO[id]
                  const active = engine === id
                  const ready =
                    id === 'presets' ||
                    id === 'ai-free' ||
                    (id === 'ai-cloud' && aiStatus?.cloudConfigured) ||
                    (id === 'ai-local' && aiStatus?.localDetected)
                  return (
                    <button
                      key={id}
                      onClick={() => setEngine(id)}
                      className={`w-full text-left rounded-md border px-3 py-2 transition-colors ${
                        active ? 'border-gold-500 bg-gold-500/5' : 'border-ink-700 hover:border-ink-500'
                      }`}
                    >
                      <div className="flex items-center justify-between gap-2">
                        <span className="text-sm text-ink-100">{info.label}</span>
                        <span className="text-[10px] text-ink-400 shrink-0">{info.badge}</span>
                      </div>
                      <p className="text-[10px] text-ink-500 mt-0.5">{info.blurb}</p>
                      {id !== 'presets' && id !== 'ai-free' && (
                        <p className={`text-[10px] mt-0.5 ${ready ? 'text-emerald-400' : 'text-amber-400/80'}`}>
                          {ready ? '✓ Configured — ready' : 'Not set up yet — configure in Settings → AI Video'}
                        </p>
                      )}
                      {id === 'ai-free' && (
                        <p className="text-[10px] mt-0.5 text-emerald-400">✓ Ready — just needs internet</p>
                      )}
                    </button>
                  )
                })}
              </div>
              {(engine === 'ai-cloud' || engine === 'ai-local') && (
                <p className="text-[10px] text-ink-500 mt-1.5">
                  These generate real AI footage. The free “Style presets” engine needs no setup and always works
                  offline. If the chosen AI engine isn’t configured, the build will show setup instructions.
                </p>
              )}
              {engine === 'ai-free' && (
                <p className="text-[10px] text-emerald-400/90 mt-1.5">
                  Generates a real AI image for each scene (free, no key) and animates them. Needs internet; if the
                  service is busy it falls back to the animated look so the build never breaks.
                </p>
              )}
            </div>

            {engine === 'ai-free' && (
              <div>
                <label className="text-xs text-ink-400">Visual style (guides the AI images)</label>
                <select
                  value={style}
                  onChange={(e) => setStyle(e.target.value as VideoStyle)}
                  className="mt-1 w-full rounded-md bg-ink-800 border border-ink-700 px-3 py-2 text-sm text-ink-100 outline-none focus:border-gold-500 capitalize"
                >
                  {VIDEO_STYLES.map((s) => (
                    <option key={s} value={s} className="capitalize">
                      {s}
                    </option>
                  ))}
                </select>
              </div>
            )}

            {engine === 'presets' && (
              <>
                <div>
                  <label className="text-xs text-ink-400">Style</label>
                  <select
                    value={style}
                    onChange={(e) => setStyle(e.target.value as VideoStyle)}
                    className="mt-1 w-full rounded-md bg-ink-800 border border-ink-700 px-3 py-2 text-sm text-ink-100 outline-none focus:border-gold-500 capitalize"
                  >
                    {VIDEO_STYLES.map((s) => (
                      <option key={s} value={s} className="capitalize">
                        {s}
                      </option>
                    ))}
                  </select>
                  <p className="text-[10px] text-ink-600 mt-1">
                    Changes colors, fonts and the waveform. Styles your text &amp; your images — it does not fabricate
                    AI footage.
                  </p>
                </div>
                <div>
                  <label className={`flex items-center gap-2 text-xs cursor-pointer ${hasStockKey ? 'text-ink-300' : 'text-ink-600'}`}>
                    <input
                      type="checkbox"
                      checked={useStock && hasStockKey}
                      disabled={!hasStockKey}
                      onChange={(e) => setUseStock(e.target.checked)}
                      className="accent-gold-500"
                    />
                    🎞 Use real stock footage (online) — matched to your script
                  </label>
                  <p className="text-[10px] text-ink-600 mt-1">
                    {hasStockKey
                      ? 'Pulls real B-roll from Pixabay for each section (needs internet). Falls back to the animated look if offline.'
                      : 'Add a free Pixabay key in Settings → “Stock footage” to unlock real footage. Until then, videos use the animated look.'}
                  </p>
                </div>
                <div>
                  <label className="text-xs text-ink-400">Background images (optional Ken-Burns)</label>
                  <button
                    onClick={handleAddImages}
                    className="mt-1 w-full rounded-md border border-ink-600 hover:border-gold-500 text-ink-200 text-xs px-3 py-1.5 transition-colors"
                  >
                    🖼 Add images…
                  </button>
                  {images.length > 0 && (
                    <div className="mt-1 flex items-center justify-between text-[10px] text-ink-500">
                      <span>{images.length} image(s) — slow pan/zoom background</span>
                      <button onClick={() => setImages([])} className="text-ink-400 hover:text-red-300">
                        Clear
                      </button>
                    </div>
                  )}
                </div>
              </>
            )}

            <div>
              <label className="text-xs text-ink-400">Look (template)</label>
              <select
                value={template}
                onChange={(e) => setTemplate(e.target.value as VideoTemplate)}
                className="mt-1 w-full rounded-md bg-ink-800 border border-ink-700 px-3 py-2 text-sm text-ink-100 outline-none focus:border-gold-500 capitalize"
              >
                {VIDEO_TEMPLATES.map((t) => (
                  <option key={t} value={t} className="capitalize">{t}</option>
                ))}
              </select>
              <p className="text-[10px] text-ink-600 mt-1">
                Clean = plain · News = crisp graded · Cinematic = graded + vignette + film grain + letterbox ·
                Bold = punchy colors. All add an animated title.
              </p>
            </div>
            <div>
              <label className="text-xs text-ink-400">Narration voice</label>
              <select
                value={narrationVoice}
                onChange={(e) => setNarrationVoice(e.target.value as 'windows' | 'piper' | 'winnatural')}
                className="mt-1 w-full rounded-md bg-ink-800 border border-ink-700 px-3 py-2 text-sm text-ink-100 outline-none focus:border-gold-500"
              >
                <option value="winnatural" disabled={!winVoices.length}>
                  {winVoices.length
                    ? '★ Windows natural voice (best free — supports Urdu)'
                    : 'Windows natural voice — none found on this PC'}
                </option>
                <option value="piper" disabled={!piperInstalled}>
                  {piperInstalled ? 'Natural voice (Piper)' : 'Natural voice (Piper) — install in Settings first'}
                </option>
                <option value="windows">Built-in Windows voice (robotic, always free)</option>
              </select>

              {narrationVoice === 'winnatural' && (
                <div className="mt-2 space-y-1.5">
                  <select
                    value={winVoiceId}
                    onChange={(e) => setWinVoiceId(e.target.value)}
                    className="w-full rounded-md bg-ink-800 border border-ink-700 px-3 py-2 text-sm text-ink-100 outline-none focus:border-gold-500"
                  >
                    {winVoices.map((v) => (
                      <option key={v.id} value={v.id}>
                        {v.name} · {v.language}
                        {v.language.toLowerCase().startsWith('ur') ? ' (Urdu)' : ''}
                      </option>
                    ))}
                  </select>
                  <div className="flex items-center gap-3">
                    <button
                      disabled={previewing || !winVoiceId}
                      onClick={() => void previewWinVoice()}
                      className="rounded-md border border-ink-600 hover:border-ink-400 text-ink-200 text-xs px-3 py-1.5 disabled:opacity-40"
                    >
                      {previewing ? '▶ playing…' : '🔊 Hear this voice'}
                    </button>
                    <button
                      onClick={() => void window.api.voice.openSpeechSettings()}
                      className="text-[11px] text-gold-300 hover:text-gold-200"
                      title="Windows Settings → Speech: add a language to get its voices (free)"
                    >
                      + Add Urdu / more voices
                    </button>
                  </div>
                  {!winVoices.some((v) => v.language.toLowerCase().startsWith('ur')) && (
                    <p className="text-[10px] text-amber-400/80">
                      No Urdu voice on this PC yet. Click &ldquo;+ Add Urdu&rdquo;, add Urdu (Pakistan) speech in Windows,
                      then reopen this tab — Asad &amp; Uzma will appear here. Free, offline after install.
                    </p>
                  )}
                </div>
              )}

              <p className="text-[10px] text-ink-600 mt-1">
                Prefer your own voice? Build with any of these, then use 🎙 Voice studio to record over it — that stays
                the best quality.
              </p>
            </div>
            <div>
              <label className="text-xs text-ink-400">Format (shape)</label>
              <select
                value={aspect}
                onChange={(e) => setAspect(e.target.value as VideoAspect)}
                className="mt-1 w-full rounded-md bg-ink-800 border border-ink-700 px-3 py-2 text-sm text-ink-100 outline-none focus:border-gold-500"
              >
                <option value="16:9">16:9 — Landscape (YouTube)</option>
                <option value="9:16">9:16 — Vertical (Shorts / Reels / TikTok)</option>
                <option value="1:1">1:1 — Square (feed posts)</option>
              </select>
            </div>
            <div>
              <label className="text-xs text-ink-400">Resolution</label>
              <select
                value={resolution}
                onChange={(e) => setResolution(e.target.value as VideoResolution)}
                className="mt-1 w-full rounded-md bg-ink-800 border border-ink-700 px-3 py-2 text-sm text-ink-100 outline-none focus:border-gold-500"
              >
                <option value="1080p">1080p Full HD (fastest)</option>
                <option value="1440p">1440p 2K QHD</option>
                <option value="4k">4K Ultra HD (sharper, slower)</option>
                <option value="8k">8K Ultra HD (7680×4320 — very slow, huge file)</option>
              </select>
              {resolution === '8k' && (
                <p className="text-[10px] text-gold-400/80 mt-1">
                  8K renders take a long time and produce very large files. For text/waveform-style videos, 4K already
                  looks razor-sharp — 8K is here because you asked, but 4K is the practical sweet spot.
                </p>
              )}
            </div>
            <label className="flex items-center gap-2 text-xs text-ink-300 cursor-pointer">
              <input
                type="checkbox"
                checked={soundEffects}
                onChange={(e) => setSoundEffects(e.target.checked)}
                className="accent-gold-500"
              />
              Add transition sound effects (a soft whoosh at each section change)
            </label>
            <div>
              <label className="text-xs text-ink-400">Background music (optional)</label>
              <div className="mt-1 flex gap-1.5">
                <button
                  onClick={handlePickMusic}
                  className="flex-1 rounded-md border border-ink-600 hover:border-ink-400 text-ink-200 text-xs px-3 py-1.5 transition-colors truncate"
                  title={musicPath ?? undefined}
                >
                  {musicPath ? `🎵 ${musicPath.split(/[\\/]/).pop()}` : '🎵 Add your own music file…'}
                </button>
                {musicPath && (
                  <button
                    onClick={() => setMusicPath(null)}
                    className="rounded-md border border-ink-700 hover:border-red-500/60 text-ink-400 hover:text-red-300 text-xs px-2 py-1.5 transition-colors shrink-0"
                  >
                    Clear
                  </button>
                )}
              </div>
              <p className="text-[10px] text-ink-600 mt-1">
                Mixed softly under the narration (auto fade in/out). Use your own file, or grab a free track below.
              </p>
              <details className="mt-2 rounded-md border border-ink-700 bg-ink-800/60">
                <summary className="cursor-pointer px-3 py-1.5 text-xs text-gold-400 select-none">
                  🎼 Get free, legal music ↗
                </summary>
                <div className="px-3 pb-2 pt-1 space-y-1">
                  {FREE_MUSIC.map((m) => (
                    <button
                      key={m.url}
                      onClick={() => window.open(m.url, '_blank')}
                      className="block w-full text-left rounded px-2 py-1 hover:bg-ink-700/60 transition-colors"
                    >
                      <span className="text-[11px] text-ink-100">{m.name}</span>
                      <span className="block text-[10px] text-ink-500">{m.note}</span>
                    </button>
                  ))}
                  <p className="text-[10px] text-ink-600 pt-1">
                    Download a track from one of these (all free/royalty-free), then click “Add your own music file”
                    above. We don’t rip from YouTube — that breaks its rules and could get your channel in trouble.
                  </p>
                </div>
              </details>
            </div>
            <div className="flex gap-2">
              <button
                onClick={handleBuild}
                disabled={building || !body.trim()}
                className="flex-1 rounded-md bg-gold-500 hover:bg-gold-400 disabled:opacity-50 disabled:cursor-not-allowed text-ink-950 font-medium px-4 py-2 text-sm transition-colors"
              >
                {building ? 'Building video…' : `🎬 Build Video (${resolution.toUpperCase()}, free)`}
              </button>
              {(building || exportingId || trimmingId) && (
                <button
                  onClick={handleCancel}
                  disabled={cancelling}
                  className="rounded-md border border-red-500/60 hover:border-red-400 text-red-300 text-sm px-4 py-2 transition-colors disabled:opacity-50"
                >
                  {cancelling ? 'Stopping…' : '⏹ Stop'}
                </button>
              )}
            </div>
            {(building || exportingId || trimmingId) && stage && (
              <div className="flex items-center gap-2 rounded-md border border-gold-500/30 bg-gold-500/5 px-3 py-2">
                <span className="h-1.5 w-1.5 shrink-0 animate-pulse rounded-full bg-gold-400" />
                <span className="text-[11px] text-gold-300/90 leading-snug">{stage}</span>
              </div>
            )}
            {building && buildPreview && (
              <div className="rounded-md border border-ink-800 bg-ink-950 p-2">
                <div className="text-[10px] uppercase tracking-wider text-ink-500 mb-1">Live preview — opening frame</div>
                <img src={buildPreview} alt="preview" className="w-full rounded" />
              </div>
            )}
            {error && (
              <div className="rounded-md border border-red-500/40 bg-red-500/10 px-3 py-2 text-xs text-red-300">
                {error}
              </div>
            )}
            <p className="text-[10px] text-ink-600">
              Uses the free bundled ffmpeg and the built-in Windows voice. Long scripts take longer to render — the
              progress line above shows the current stage.
            </p>
          </div>
        </div>

        <div className="lg:col-span-2">
          <div className="rounded-lg border border-ink-700 bg-ink-900 p-4">
            <div className="flex items-center justify-between">
              <h2 className="text-lg font-medium text-ink-100">Your videos</h2>
              <span className="text-xs text-ink-500">{jobs.length} built</span>
            </div>
            {jobs.length > 1 && (
              <div className="mt-2 flex items-center gap-2 rounded-md border border-ink-700 bg-ink-800/60 px-3 py-1.5">
                <span className="text-[11px] text-ink-400">
                  🔗 Tick videos to join them end-to-end{stitchSel.length ? ` (${stitchSel.length} selected)` : ''}
                </span>
                <button
                  onClick={handleStitch}
                  disabled={stitching || stitchSel.length < 2}
                  className="ml-auto rounded-md bg-gold-500 hover:bg-gold-400 disabled:opacity-40 text-ink-950 text-[11px] font-medium px-3 py-1 transition-colors"
                >
                  {stitching ? 'Stitching…' : 'Stitch selected'}
                </button>
                {stitchSel.length > 0 && (
                  <button onClick={() => setStitchSel([])} className="text-[11px] text-ink-400 hover:text-ink-200">
                    Clear
                  </button>
                )}
              </div>
            )}
            {savedNote && <p className="mt-1 text-[11px] text-emerald-400 break-all">{savedNote}</p>}
            {jobs.length ? (
              <div className="mt-3 space-y-2">
                {jobs.map((job) => (
                  <div key={job.id} className="rounded-md border border-ink-700 bg-ink-800 p-3">
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0 flex items-start gap-2">
                        {jobs.length > 1 && (
                          <input
                            type="checkbox"
                            checked={stitchSel.includes(job.id)}
                            onChange={() => toggleStitchSel(job.id)}
                            title="Select for stitching"
                            className="mt-1 accent-gold-500 shrink-0"
                          />
                        )}
                        <div className="min-w-0">
                        <div className="text-sm text-ink-100 truncate">{job.title || 'Untitled video'}</div>
                        <div className="text-[11px] text-ink-500 mt-0.5">
                          {job.hasCustomVoice ? 'With your recorded voice' : 'Narrated (Windows voice)'} ·{' '}
                          {new Date(job.createdAt).toLocaleString()}
                        </div>
                        <p className="text-[10px] text-ink-600 mt-1 break-all">{job.path}</p>
                        </div>
                      </div>
                      <div className="flex shrink-0 flex-wrap justify-end gap-1.5">
                        <button
                          onClick={() => window.api.video.reveal(job.path)}
                          className="rounded-md border border-ink-600 hover:border-ink-400 text-ink-200 text-xs px-3 py-1 transition-colors"
                        >
                          Show file
                        </button>
                        <button
                          onClick={() => handleSaveAs(job)}
                          className="rounded-md border border-ink-600 hover:border-ink-400 text-ink-200 text-xs px-3 py-1 transition-colors"
                        >
                          Save a copy
                        </button>
                        <button
                          onClick={() => handleEnhance(job)}
                          disabled={enhanceBusyId === job.id}
                          title="Clean up the voice (de-noise + loudness) and polish the picture (colour + sharpen) → a new copy"
                          className="rounded-md border border-ink-600 hover:border-ink-400 text-ink-200 text-xs px-3 py-1 transition-colors disabled:opacity-50"
                        >
                          {enhanceBusyId === job.id ? 'Enhancing…' : '✨ Enhance'}
                        </button>
                        <button
                          onClick={() => setVoiceOpenId(voiceOpenId === job.id ? null : job.id)}
                          className={`rounded-md border text-xs px-3 py-1 transition-colors ${
                            voiceOpenId === job.id
                              ? 'border-gold-500 text-gold-300'
                              : 'border-ink-600 hover:border-ink-400 text-ink-200'
                          }`}
                        >
                          🎙 Voice studio
                        </button>
                        <button
                          onClick={() => toggleTrim(job)}
                          className={`rounded-md border text-xs px-3 py-1 transition-colors ${
                            trimOpenId === job.id
                              ? 'border-gold-500 text-gold-300'
                              : 'border-ink-600 hover:border-ink-400 text-ink-200'
                          }`}
                        >
                          ✂ Trim / cut
                        </button>
                        <button
                          onClick={() => handlePublish(job)}
                          disabled={publishBusyId === job.id}
                          className="rounded-md border border-red-500/50 hover:border-red-400 text-red-300 text-xs px-3 py-1 transition-colors disabled:opacity-50"
                        >
                          {publishBusyId === job.id ? 'Preparing…' : '▶ Publish to YouTube'}
                        </button>
                        <button
                          onClick={() => handleDelete(job.id)}
                          className="rounded-md border border-ink-700 hover:border-red-500/60 text-ink-400 hover:text-red-300 text-xs px-3 py-1 transition-colors"
                        >
                          Delete
                        </button>
                      </div>
                    </div>
                    {job.narrationPath ? (
                      <div className="mt-2 flex flex-wrap items-center gap-1.5 rounded-md border border-ink-700 bg-ink-900/60 p-2">
                        <span className="text-[11px] text-ink-400">🎵 Music</span>
                        <button
                          onClick={() => handleSetMusic(job, 'remove')}
                          disabled={musicBusyId === job.id}
                          className="rounded-md border border-ink-600 hover:border-ink-400 text-ink-200 text-xs px-3 py-1 transition-colors disabled:opacity-50"
                        >
                          Remove (keep my voice)
                        </button>
                        <span className="text-[11px] text-ink-500">or replace with</span>
                        <select
                          value={replaceMood}
                          onChange={(e) => setReplaceMood(e.target.value as Mood)}
                          className="rounded-md bg-ink-800 border border-ink-700 px-2 py-1 text-xs text-ink-100 outline-none focus:border-gold-500 capitalize"
                        >
                          {MOODS.map((m) => (
                            <option key={m} value={m} className="capitalize">{m}</option>
                          ))}
                        </select>
                        <button
                          onClick={() => handleSetMusic(job, 'replace')}
                          disabled={musicBusyId === job.id}
                          className="rounded-md border border-ink-600 hover:border-ink-400 text-ink-200 text-xs px-3 py-1 transition-colors disabled:opacity-50"
                        >
                          Replace
                        </button>
                        {musicBusyId === job.id && <span className="text-[10px] text-gold-300">working…</span>}
                      </div>
                    ) : (
                      <div className="mt-2 flex flex-wrap items-center gap-1.5 rounded-md border border-ink-700 bg-ink-900/60 p-2">
                        <span className="text-[11px] text-ink-400">🎵 Remove music (AI separate)</span>
                        <button
                          onClick={() => handleSeparateMusic(job, 'online')}
                          disabled={musicBusyId === job.id}
                          className="rounded-md border border-ink-600 hover:border-ink-400 text-ink-200 text-xs px-3 py-1 transition-colors disabled:opacity-50"
                        >
                          Online (free)
                        </button>
                        <button
                          onClick={() => handleSeparateMusic(job, 'local')}
                          disabled={musicBusyId === job.id}
                          className="rounded-md border border-ink-600 hover:border-ink-400 text-ink-200 text-xs px-3 py-1 transition-colors disabled:opacity-50"
                        >
                          Local (Demucs)
                        </button>
                        {musicBusyId === job.id && <span className="text-[10px] text-gold-300">working…</span>}
                        <span className="w-full text-[10px] text-ink-600">
                          For videos NOT made in the app (music already mixed in). Online works out of the box (free, built-in);
                          Local needs a one-time Demucs install. Quality is an AI estimate — great for clear speech over music.
                          Videos you build in the app remove/replace music exactly without this.
                        </span>
                      </div>
                    )}
                    <div className="mt-2 flex flex-wrap items-center gap-1.5 rounded-md border border-ink-700 bg-ink-900/60 p-2">
                      <span className="text-[11px] text-ink-400">📝 Captions</span>
                      <button
                        onClick={() => handleCaptions(job, false)}
                        disabled={captionBusyId === job.id}
                        className="rounded-md border border-ink-600 hover:border-ink-400 text-ink-200 text-xs px-3 py-1 transition-colors disabled:opacity-50"
                      >
                        Get subtitles (.srt)
                      </button>
                      <button
                        onClick={() => handleCaptions(job, true)}
                        disabled={captionBusyId === job.id}
                        className="rounded-md border border-ink-600 hover:border-ink-400 text-ink-200 text-xs px-3 py-1 transition-colors disabled:opacity-50"
                      >
                        Burn into video
                      </button>
                      {captionBusyId === job.id && <span className="text-[10px] text-gold-300">working…</span>}
                      <span className="w-full text-[10px] text-ink-600">
                        Transcribes your narration offline (free). The .srt uploads straight to YouTube; “Burn” makes a
                        captioned copy for Shorts/Reels.
                      </span>
                    </div>
                    <div className="mt-2 flex flex-wrap items-center gap-1.5 rounded-md border border-gold-500/30 bg-ink-900/60 p-2">
                      <span className="text-[11px] text-gold-300">📱 Make Shorts</span>
                      <label className="text-[11px] text-ink-400 flex items-center gap-1">
                        How many
                        <select
                          value={shortsCount}
                          onChange={(e) => setShortsCount(Number(e.target.value))}
                          disabled={shortsBusyId === job.id}
                          className="rounded bg-ink-800 border border-ink-700 px-2 py-1 text-xs text-ink-100"
                        >
                          {[1, 2, 3, 4, 5].map((n) => (
                            <option key={n} value={n}>{n}</option>
                          ))}
                        </select>
                      </label>
                      <button
                        onClick={() => handleMakeShorts(job, shortsCount)}
                        disabled={shortsBusyId === job.id}
                        className="rounded-md bg-gold-500 hover:bg-gold-400 text-ink-950 text-xs font-medium px-3 py-1 transition-colors disabled:opacity-50"
                      >
                        📱 Cut into vertical shorts
                      </button>
                      {shortsBusyId === job.id && <span className="text-[10px] text-gold-300">working…</span>}
                      <span className="w-full text-[10px] text-ink-600">
                        Listens to this video offline, picks the strongest moments (hooks, numbers, questions), and
                        makes 9:16 clips with big burned-in captions — ready for YouTube Shorts, TikTok and Reels.
                        They appear in this list. Free, no internet needed.
                      </span>
                    </div>
                    {/* Ready-to-paste posting text so uploading is copy-paste, not writing. */}
                    <div className="mt-2 flex flex-wrap items-center gap-1.5 rounded-md border border-ink-700 bg-ink-900/60 p-2">
                      <span className="text-[11px] text-ink-400">🏷 Posting text</span>
                      <button
                        onClick={() => handlePostMeta(job, 'youtube')}
                        disabled={metaBusyId === job.id}
                        className="rounded-md border border-ink-600 hover:border-ink-400 text-ink-200 text-xs px-3 py-1 transition-colors disabled:opacity-50"
                      >
                        YouTube
                      </button>
                      <button
                        onClick={() => handlePostMeta(job, 'tiktok')}
                        disabled={metaBusyId === job.id}
                        className="rounded-md border border-ink-600 hover:border-ink-400 text-ink-200 text-xs px-3 py-1 transition-colors disabled:opacity-50"
                      >
                        TikTok
                      </button>
                      {metaBusyId === job.id && <span className="text-[10px] text-gold-300">writing…</span>}
                      {postMeta && postMeta.id === job.id && (
                        <div className="w-full mt-1 space-y-1.5">
                          {(
                            [
                              ['Title', postMeta.meta.title],
                              ['Description', postMeta.meta.description],
                              ['Hashtags', postMeta.meta.hashtags.map((h) => `#${h}`).join(' ')]
                            ] as [string, string][]
                          ).map(([label, value]) => (
                            <div key={label} className="rounded border border-ink-800 bg-ink-950 p-1.5">
                              <div className="flex items-center gap-2">
                                <span className="text-[10px] text-ink-500">{label}</span>
                                <button
                                  onClick={() => {
                                    // Match the app's existing guarded pattern, but never
                                    // claim success if the clipboard isn't available.
                                    if (navigator.clipboard?.writeText) {
                                      void navigator.clipboard
                                        .writeText(value)
                                        .then(() => toast(`${label} copied ✓`, 'success'))
                                        .catch(() => toast('Could not copy — select the text and press Ctrl+C', 'error'))
                                    } else {
                                      toast('Could not copy — select the text and press Ctrl+C', 'error')
                                    }
                                  }}
                                  className="ml-auto text-[10px] text-gold-300 hover:text-gold-200"
                                >
                                  Copy
                                </button>
                              </div>
                              <div className="whitespace-pre-wrap text-[11px] text-ink-200">{value}</div>
                            </div>
                          ))}
                        </div>
                      )}
                      <span className="w-full text-[10px] text-ink-600">
                        Writes a click-worthy title, a short description and hashtags for this clip — then Copy each
                        one straight into YouTube/TikTok.
                      </span>
                    </div>
                    <div className="mt-2 flex flex-wrap items-center gap-1.5 rounded-md border border-ink-700 bg-ink-900/60 p-2">
                      <span className="text-[11px] text-ink-400">🏷 Logo</span>
                      <button
                        onClick={pickLogo}
                        className="rounded-md border border-ink-600 hover:border-ink-400 text-ink-200 text-xs px-3 py-1 transition-colors"
                      >
                        {watermarkLogo ? 'Change logo' : 'Pick logo image'}
                      </button>
                      {watermarkLogo && <span className="text-[10px] text-emerald-400 truncate max-w-[120px]">{watermarkLogo.split(/[\\/]/).pop()}</span>}
                      <select
                        value={watermarkPos}
                        onChange={(e) => setWatermarkPos(e.target.value as typeof watermarkPos)}
                        className="rounded bg-ink-800 border border-ink-700 px-2 py-1 text-xs text-ink-100"
                      >
                        <option value="bottom-right">bottom-right</option>
                        <option value="bottom-left">bottom-left</option>
                        <option value="top-right">top-right</option>
                        <option value="top-left">top-left</option>
                      </select>
                      <button
                        onClick={() => handleWatermark(job)}
                        disabled={watermarkBusyId === job.id || !watermarkLogo}
                        className="rounded-md border border-ink-600 hover:border-ink-400 text-ink-200 text-xs px-3 py-1 transition-colors disabled:opacity-50"
                      >
                        Apply
                      </button>
                      {watermarkBusyId === job.id && <span className="text-[10px] text-gold-300">working…</span>}
                    </div>
                    {voiceOpenId === job.id && (
                      <VoiceRecorder
                        job={job}
                        onDone={async (newJob) => {
                          setVoiceOpenId(null)
                          await refreshJobs()
                          setSavedNote(`Voice-over added — new video “${newJob.title}” saved.`)
                        }}
                      />
                    )}
                    <div className="mt-2 flex flex-wrap items-center gap-1.5 rounded-md border border-ink-700 bg-ink-900/60 p-2">
                      <span className="text-[11px] text-ink-400">⬇ Download as</span>
                      <select
                        value={exportFormat}
                        onChange={(e) => setExportFormat(e.target.value as ExportFormat)}
                        className="rounded-md bg-ink-800 border border-ink-700 px-2 py-1 text-[11px] text-ink-100 outline-none focus:border-gold-500"
                      >
                        {EXPORT_FORMATS.map((f) => (
                          <option key={f.id} value={f.id}>
                            {f.label}
                          </option>
                        ))}
                      </select>
                      <button
                        onClick={() => handleExport(job)}
                        disabled={exportingId === job.id}
                        className="rounded-md bg-gold-500 hover:bg-gold-400 disabled:opacity-50 disabled:cursor-not-allowed text-ink-950 text-[11px] font-medium px-3 py-1 transition-colors"
                      >
                        {exportingId === job.id ? 'Exporting…' : '⬇ Download'}
                      </button>
                      <span className="text-[10px] text-ink-600 basis-full">
                        {EXPORT_FORMATS.find((f) => f.id === exportFormat)?.note} Pick a different format if YouTube ever
                        changes what it accepts.
                      </span>
                    </div>
                    <video
                      ref={(el) => {
                        videoRefs.current[job.id] = el
                      }}
                      src={fileUrl(job.path)}
                      controls
                      preload="metadata"
                      className="mt-2 w-full max-h-72 rounded-md bg-black"
                    />
                    {trimOpenId === job.id && (
                      <div className="mt-2 rounded-md border border-gold-500/30 bg-ink-900/60 p-3 space-y-2">
                        <p className="text-[11px] text-ink-300">
                          Play the video above, pause where you want, then click “Use current”. Choose whether to keep
                          only that range or cut it out.
                        </p>
                        <div className="flex flex-wrap items-end gap-2">
                          <div>
                            <label className="text-[10px] text-ink-400 block">Start (s)</label>
                            <input
                              type="number"
                              min={0}
                              step={0.1}
                              value={trimStart}
                              onChange={(e) => setTrimStart(parseFloat(e.target.value) || 0)}
                              className="w-24 rounded-md bg-ink-800 border border-ink-700 px-2 py-1 text-xs text-ink-100 outline-none focus:border-gold-500"
                            />
                            <button
                              onClick={() => applyCurrentTime(job,'start')}
                              className="ml-1 rounded border border-ink-600 hover:border-ink-400 text-ink-300 text-[10px] px-1.5 py-1"
                            >
                              Use current
                            </button>
                          </div>
                          <div>
                            <label className="text-[10px] text-ink-400 block">End (s)</label>
                            <input
                              type="number"
                              min={0}
                              step={0.1}
                              value={trimEnd}
                              onChange={(e) => setTrimEnd(parseFloat(e.target.value) || 0)}
                              className="w-24 rounded-md bg-ink-800 border border-ink-700 px-2 py-1 text-xs text-ink-100 outline-none focus:border-gold-500"
                            />
                            <button
                              onClick={() => applyCurrentTime(job,'end')}
                              className="ml-1 rounded border border-ink-600 hover:border-ink-400 text-ink-300 text-[10px] px-1.5 py-1"
                            >
                              Use current
                            </button>
                          </div>
                        </div>
                        <div className="flex flex-wrap items-center gap-2">
                          <select
                            value={trimMode}
                            onChange={(e) => setTrimMode(e.target.value as TrimMode)}
                            className="rounded-md bg-ink-800 border border-ink-700 px-2 py-1 text-xs text-ink-100 outline-none focus:border-gold-500"
                          >
                            <option value="remove">Remove this range (cut it out)</option>
                            <option value="keep">Keep only this range (clip it)</option>
                          </select>
                          <button
                            onClick={() => handleTrim(job)}
                            disabled={trimmingId === job.id}
                            className="rounded-md bg-gold-500 hover:bg-gold-400 disabled:opacity-50 text-ink-950 text-xs font-medium px-3 py-1 transition-colors"
                          >
                            {trimmingId === job.id ? 'Working…' : 'Apply ✂'}
                          </button>
                          <span className="text-[10px] text-ink-600">
                            Creates a new video — your original stays untouched.
                          </span>
                        </div>
                      </div>
                    )}
                  </div>
                ))}
              </div>
            ) : (
              <div className="mt-3 rounded-md border border-dashed border-ink-700 py-10 px-6 text-center text-ink-500 text-sm">
                No videos yet. Pick a script on the left and click “Build Video”.
                <span className="block mt-2 text-[11px] text-ink-600">
                  Once a video is built, it appears here with buttons to <span className="text-ink-400">Save a copy</span>{' '}
                  (download to USB/anywhere), <span className="text-ink-400">🎙 Voice studio</span> (record your own
                  audio over it), and a built-in preview player.
                </span>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
