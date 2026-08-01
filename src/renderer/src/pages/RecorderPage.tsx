import { useEffect, useMemo, useRef, useState } from 'react'
import { COUNTDOWN_CHOICES } from '../../../shared/teleprompter'
import { useAutosave } from '../hooks/useAutosave'
import { toast } from '../components/Toast'

type Source = 'camera' | 'screen'
const RES: { label: string; h: number }[] = [
  { label: '720p', h: 720 },
  { label: '1080p', h: 1080 },
  { label: '1440p', h: 1440 },
  { label: '4K', h: 2160 },
  { label: '8K', h: 4320 }
]

/**
 * In-app Recorder — capture from your webcam + mic OR your screen, with browser-level noise
 * suppression / echo cancellation / auto-gain, a device picker (OBS Virtual Camera shows up
 * here automatically when OBS is running), and resolution up to your camera's limit. The
 * recording transcodes to MP4 and is SAVED into Video Studio (usable as your Presenter clip).
 * All capture uses Electron's real browser + desktop APIs — free, offline.
 */
/**
 * Kept as four separate setups rather than one merged mode: the only thing that
 * actually differs is WHERE the teleprompter must live so it never lands in the
 * recording, and that answer is different for every one of them.
 */
const SETUPS: {
  id: 'phone-camera' | 'phone-screen' | 'laptop-screen' | 'laptop-webcam'
  label: string
  detail: string
  prompter: string
  source?: Source
}[] = [
  {
    id: 'laptop-webcam',
    label: '💻 This laptop\'s webcam films me',
    detail: 'The built-in camera records you talking.',
    prompter: 'Open it on this screen, just below the webcam, so your eyeline stays right. The webcam films YOU, not the screen, so it can never be recorded.',
    source: 'camera'
  },
  {
    id: 'laptop-screen',
    label: '🖥 This laptop records its screen',
    detail: 'Tutorials, charts, walkthroughs.',
    prompter: 'Open the prompter window and pick a DIFFERENT screen or window to capture below. Tick the box to also ask Windows to hide the prompter from capture entirely.',
    source: 'screen'
  },
  {
    id: 'phone-camera',
    label: '📱 My phone\'s camera films me',
    detail: 'Phone on a stand, filming you.',
    prompter: 'Open it on this laptop and stand the laptop behind or below the phone. The phone films the room, so the prompter cannot end up in the video. Nothing to record here.'
  },
  {
    id: 'phone-screen',
    label: '📱 My phone records its own screen',
    detail: 'Demonstrating something on the phone.',
    prompter: 'Use Android\'s own screen recorder (swipe down the quick settings) — a web app is not allowed to record the phone screen, and it stops the moment you switch apps. Open the prompter on this laptop; it is a different device, so it is never in the capture.'
  }
]

const SETUP_BY_ID = Object.fromEntries(SETUPS.map((s) => [s.id, s])) as Record<string, (typeof SETUPS)[number]>

export default function RecorderPage(): React.JSX.Element {
  const [source, setSource] = useState<Source>('camera')
  const [cameras, setCameras] = useState<MediaDeviceInfo[]>([])
  const [mics, setMics] = useState<MediaDeviceInfo[]>([])
  const [cameraId, setCameraId] = useState('')
  const [micId, setMicId] = useState('')
  const [screens, setScreens] = useState<{ id: string; name: string; thumbnail: string }[]>([])
  const [screenId, setScreenId] = useState('')
  const [noiseSuppress, setNoiseSuppress] = useState(true)
  const [echoCancel, setEchoCancel] = useState(true)
  const [autoGain, setAutoGain] = useState(true)
  const [micOnScreen, setMicOnScreen] = useState(true)
  const [enhance, setEnhance] = useState(true)
  const [resH, setResH] = useState(1080)

  /**
   * The four ways the user actually records, kept as DISTINCT choices rather than
   * merged into one clever mode. Each has a different answer to "where does the
   * teleprompter go so it isn't in the shot", and getting that wrong ruins the take.
   */
  const [setup, setSetup] = useState<'phone-camera' | 'phone-screen' | 'laptop-screen' | 'laptop-webcam'>('laptop-webcam')
  /** Seconds of countdown before recording starts, so you can get into position. */
  const [countdown, setCountdown] = useState<number>(5)
  const [counting, setCounting] = useState<number | null>(null)
  const [promptHidden, setPromptHidden] = useState(true)
  const countRef = useRef<ReturnType<typeof setInterval> | null>(null)

  const [previewing, setPreviewing] = useState(false)
  const [recording, setRecording] = useState(false)
  const [seconds, setSeconds] = useState(0)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [note, setNote] = useState<string | null>(null)

  const videoRef = useRef<HTMLVideoElement | null>(null)
  const streamRef = useRef<MediaStream | null>(null)
  const recRef = useRef<MediaRecorder | null>(null)
  const chunksRef = useRef<Blob[]>([])
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null)

  // Persist the setup (source, devices, toggles, resolution). Camera/screen bytes are saved
  // separately to Video Studio on stop.
  const persisted = useMemo(
    () => ({ source, cameraId, micId, noiseSuppress, echoCancel, autoGain, micOnScreen, enhance, resH }),
    [source, cameraId, micId, noiseSuppress, echoCancel, autoGain, micOnScreen, enhance, resH]
  )
  useAutosave('recorder-tab', persisted, (v) => {
    if (v.source) setSource(v.source)
    if (v.cameraId != null) setCameraId(v.cameraId)
    if (v.micId != null) setMicId(v.micId)
    if (typeof v.noiseSuppress === 'boolean') setNoiseSuppress(v.noiseSuppress)
    if (typeof v.echoCancel === 'boolean') setEchoCancel(v.echoCancel)
    if (typeof v.autoGain === 'boolean') setAutoGain(v.autoGain)
    if (typeof v.micOnScreen === 'boolean') setMicOnScreen(v.micOnScreen)
    if (typeof v.enhance === 'boolean') setEnhance(v.enhance)
    if (typeof v.resH === 'number') setResH(v.resH)
  })

  async function loadDevices(): Promise<void> {
    try {
      const devs = await navigator.mediaDevices.enumerateDevices()
      setCameras(devs.filter((d) => d.kind === 'videoinput'))
      setMics(devs.filter((d) => d.kind === 'audioinput'))
    } catch {
      /* labels appear after the first permission grant */
    }
  }

  useEffect(() => {
    void loadDevices()
    return () => stopEverything()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  function stopEverything(): void {
    if (timerRef.current) clearInterval(timerRef.current)
    // A countdown left running after the tab closes would fire startRecording()
    // against a torn-down stream.
    if (countRef.current) {
      clearInterval(countRef.current)
      countRef.current = null
    }
    try {
      if (recRef.current && recRef.current.state === 'recording') recRef.current.stop()
    } catch {
      /* ignore */
    }
    streamRef.current?.getTracks().forEach((t) => t.stop())
    streamRef.current = null
  }

  const audioConstraints = (): MediaTrackConstraints => ({
    deviceId: micId ? { exact: micId } : undefined,
    noiseSuppression: noiseSuppress,
    echoCancellation: echoCancel,
    autoGainControl: autoGain
  })

  async function startPreview(): Promise<void> {
    setError(null)
    setNote(null)
    stopEverything()
    try {
      let stream: MediaStream
      if (source === 'camera') {
        stream = await navigator.mediaDevices.getUserMedia({
          video: { deviceId: cameraId ? { exact: cameraId } : undefined, height: { ideal: resH }, width: { ideal: Math.round((resH * 16) / 9) } },
          audio: audioConstraints()
        })
      } else {
        if (!screenId) {
          setError('Pick a screen or window to capture first.')
          return
        }
        // Electron desktop capture: the source id goes through the non-standard mandatory
        // constraints (cast — the DOM types don't model chromeMediaSource).
        const screenStream = await navigator.mediaDevices.getUserMedia({
          audio: false,
          video: {
            mandatory: {
              chromeMediaSource: 'desktop',
              chromeMediaSourceId: screenId,
              maxHeight: resH,
              maxWidth: Math.round((resH * 16) / 9)
            }
          }
        } as unknown as MediaStreamConstraints)
        stream = screenStream
        // Optionally mix in the mic so screen recordings have your narration.
        if (micOnScreen) {
          try {
            const micStream = await navigator.mediaDevices.getUserMedia({ audio: audioConstraints() })
            micStream.getAudioTracks().forEach((t) => stream.addTrack(t))
          } catch {
            /* screen video still records without mic */
          }
        }
      }
      streamRef.current = stream
      if (videoRef.current) {
        videoRef.current.srcObject = stream
        videoRef.current.muted = true
        await videoRef.current.play().catch(() => undefined)
      }
      setPreviewing(true)
      void loadDevices() // labels are populated now that permission is granted
    } catch (err) {
      setError(err instanceof Error ? `Could not access ${source === 'camera' ? 'camera/mic' : 'screen'}: ${err.message}` : 'Capture failed.')
    }
  }

  async function loadScreens(): Promise<void> {
    setError(null)
    try {
      setScreens(await window.api.recorder.screenSources())
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not list screens.')
    }
  }

  /** Opens the prompter in its own always-on-top window. */
  async function openPrompter(): Promise<void> {
    try {
      await window.api.teleprompter.open({ hiddenFromCapture: promptHidden })
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not open the teleprompter.')
    }
  }

  /** Counts down out loud on screen, then starts recording. Cancellable. */
  function startWithCountdown(): void {
    if (!streamRef.current) {
      setError('Start the preview first.')
      return
    }
    if (countdown <= 0) {
      startRecording()
      return
    }
    setError(null)
    setCounting(countdown)
    countRef.current = setInterval(() => {
      setCounting((n) => {
        if (n === null) return null
        if (n <= 1) {
          if (countRef.current) clearInterval(countRef.current)
          countRef.current = null
          // Leaving state updates to the next tick keeps this out of the setState body.
          setTimeout(() => startRecording(), 0)
          return null
        }
        return n - 1
      })
    }, 1000)
  }

  function cancelCountdown(): void {
    if (countRef.current) clearInterval(countRef.current)
    countRef.current = null
    setCounting(null)
  }

  function startRecording(): void {
    const stream = streamRef.current
    if (!stream) {
      setError('Start the preview first.')
      return
    }
    chunksRef.current = []
    const mime = MediaRecorder.isTypeSupported('video/webm;codecs=vp9,opus')
      ? 'video/webm;codecs=vp9,opus'
      : 'video/webm'
    const rec = new MediaRecorder(stream, { mimeType: mime })
    rec.ondataavailable = (e) => e.data.size > 0 && chunksRef.current.push(e.data)
    rec.onstop = async () => {
      if (timerRef.current) clearInterval(timerRef.current)
      setBusy(true)
      try {
        const blob = new Blob(chunksRef.current, { type: 'video/webm' })
        const bytes = new Uint8Array(await blob.arrayBuffer())
        const res = await window.api.recorder.save(bytes, source, enhance)
        if (res.ok) {
          setNote('Recording saved to Video Studio ✓ — use it there, or upload it in Presenter Studio as your narration video.')
          toast('Recording saved to Video Studio ✓', 'success')
        } else setError(res.error ?? 'Save failed.')
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Save failed.')
      } finally {
        setBusy(false)
        setRecording(false)
      }
    }
    rec.start(1000)
    recRef.current = rec
    setRecording(true)
    setSeconds(0)
    timerRef.current = setInterval(() => setSeconds((s) => s + 1), 1000)
  }

  function stopRecording(): void {
    if (recRef.current && recRef.current.state === 'recording') recRef.current.stop()
  }

  const mmss = `${String(Math.floor(seconds / 60)).padStart(2, '0')}:${String(seconds % 60).padStart(2, '0')}`

  return (
    <div className="max-w-4xl mx-auto p-8">
      <h1 className="text-2xl font-serif text-gold-400">Recorder</h1>
      <p className="text-ink-400 text-sm mt-1">
        Record your camera + mic or your screen, right inside the studio. Noise suppression built in. Your recording is
        saved to Video Studio and can be used as your Presenter narration video. (OBS: start OBS's Virtual Camera and it
        appears in the camera list below.)
      </p>

      {/* ── How are you recording? Four distinct setups, because each one needs the
             teleprompter in a different place to stay out of the shot. ── */}
      <div className="mt-5 rounded-lg border border-ink-700 bg-ink-900 p-4">
        <div className="text-sm font-medium text-ink-100">How are you recording?</div>
        <div className="mt-3 grid gap-2 sm:grid-cols-2">
          {SETUPS.map((s) => (
            <button
              key={s.id}
              onClick={() => {
                setSetup(s.id)
                if (s.source) {
                  setSource(s.source)
                  setPreviewing(false)
                }
              }}
              disabled={recording}
              className={`rounded-md border p-3 text-left disabled:opacity-40 ${
                setup === s.id ? 'border-gold-500 bg-ink-800' : 'border-ink-700 hover:bg-ink-800'
              }`}
            >
              <div className="text-sm text-ink-100">{s.label}</div>
              <div className="mt-1 text-xs text-ink-400">{s.detail}</div>
            </button>
          ))}
        </div>

        <div className="mt-3 rounded-md border border-gold-700/40 bg-gold-950/20 p-3 text-xs text-gold-200">
          <b>Teleprompter:</b> {SETUP_BY_ID[setup].prompter}
        </div>

        <div className="mt-3 flex flex-wrap items-center gap-2">
          <button
            onClick={() => void openPrompter()}
            className="rounded-md border border-ink-700 px-3 py-1.5 text-sm text-ink-200 hover:bg-ink-800"
          >
            🧾 Open teleprompter window
          </button>
          <label className="flex items-center gap-1.5 text-xs text-ink-400">
            <input
              type="checkbox"
              checked={promptHidden}
              onChange={(e) => {
                setPromptHidden(e.target.checked)
                void window.api.teleprompter.setHiddenFromCapture(e.target.checked)
              }}
            />
            Ask Windows to keep it out of screen recordings
          </label>
        </div>
        <div className="mt-1 text-[11px] text-ink-600">
          That asks the operating system to exclude the prompter window from any capture. It works on Windows and
          macOS, but it is a request, not a guarantee — check your preview before a long take.
        </div>
      </div>

      <div className="mt-4 inline-flex rounded-md border border-ink-700 overflow-hidden text-sm">
        {(['camera', 'screen'] as Source[]).map((s) => (
          <button key={s} onClick={() => { setSource(s); setPreviewing(false) }} disabled={recording} className={`px-3 py-1.5 ${source === s ? 'bg-gold-500 text-ink-950' : 'text-ink-300 hover:bg-ink-800'} disabled:opacity-40`}>
            {s === 'camera' ? '📷 Camera + Mic' : '🖥 Screen'}
          </button>
        ))}
      </div>

      {/* Device / source controls */}
      <div className="mt-3 grid grid-cols-1 sm:grid-cols-2 gap-3">
        {source === 'camera' && (
          <label className="text-xs text-ink-400">Camera
            <select value={cameraId} onChange={(e) => setCameraId(e.target.value)} disabled={recording} className="mt-1 w-full rounded-md border border-ink-700 bg-ink-950 px-2 py-1.5 text-sm text-ink-100">
              <option value="">Default camera</option>
              {cameras.map((c) => <option key={c.deviceId} value={c.deviceId}>{c.label || 'Camera'}</option>)}
            </select>
          </label>
        )}
        <label className="text-xs text-ink-400">Microphone
          <select value={micId} onChange={(e) => setMicId(e.target.value)} disabled={recording} className="mt-1 w-full rounded-md border border-ink-700 bg-ink-950 px-2 py-1.5 text-sm text-ink-100">
            <option value="">Default microphone</option>
            {mics.map((m) => <option key={m.deviceId} value={m.deviceId}>{m.label || 'Microphone'}</option>)}
          </select>
        </label>
        <label className="text-xs text-ink-400">Resolution (capped by your device)
          <select value={resH} onChange={(e) => setResH(Number(e.target.value))} disabled={recording} className="mt-1 w-full rounded-md border border-ink-700 bg-ink-950 px-2 py-1.5 text-sm text-ink-100">
            {RES.map((r) => <option key={r.h} value={r.h}>{r.label}</option>)}
          </select>
        </label>
      </div>

      <div className="mt-2 flex flex-wrap items-center gap-3 text-[12px] text-ink-300">
        <label className="flex items-center gap-1"><input type="checkbox" checked={noiseSuppress} onChange={(e) => setNoiseSuppress(e.target.checked)} disabled={recording} /> Noise suppression</label>
        <label className="flex items-center gap-1"><input type="checkbox" checked={echoCancel} onChange={(e) => setEchoCancel(e.target.checked)} disabled={recording} /> Echo cancel</label>
        <label className="flex items-center gap-1"><input type="checkbox" checked={autoGain} onChange={(e) => setAutoGain(e.target.checked)} disabled={recording} /> Auto‑gain</label>
        {source === 'screen' && <label className="flex items-center gap-1"><input type="checkbox" checked={micOnScreen} onChange={(e) => setMicOnScreen(e.target.checked)} disabled={recording} /> Record mic with screen</label>}
        <label className="flex items-center gap-1" title="On stop: clean up your voice (de-noise + loudness) and polish the picture (colour + sharpen)."><input type="checkbox" checked={enhance} onChange={(e) => setEnhance(e.target.checked)} disabled={recording} /> ✨ Enhance on save</label>
      </div>

      {source === 'screen' && (
        <div className="mt-3">
          <button onClick={loadScreens} disabled={recording} className="rounded-md border border-ink-700 px-3 py-1.5 text-sm text-ink-200 hover:bg-ink-800">🖥 List screens & windows</button>
          {screens.length > 0 && (
            <div className="mt-2 grid grid-cols-2 sm:grid-cols-3 gap-2">
              {screens.map((s) => (
                <button key={s.id} onClick={() => setScreenId(s.id)} className={`rounded-md border p-1 text-left ${screenId === s.id ? 'border-gold-500' : 'border-ink-700 hover:border-ink-500'}`}>
                  <img src={s.thumbnail} alt={s.name} className="w-full rounded" />
                  <div className="text-[10px] text-ink-400 truncate mt-0.5">{s.name}</div>
                </button>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Preview + controls */}
      <div className="mt-4 rounded-lg border border-ink-800 bg-black overflow-hidden">
        <video ref={videoRef} className="w-full max-h-[360px] bg-black" playsInline />
      </div>

      <div className="mt-3 flex flex-wrap items-center gap-2">
        {!previewing ? (
          <button onClick={startPreview} disabled={busy} className="rounded-md border border-ink-700 px-4 py-2 text-sm text-ink-200 hover:bg-ink-800">▶ Start preview</button>
        ) : counting !== null ? (
          <div className="flex items-center gap-3">
            <span className="rounded-md bg-red-600 px-5 py-2 text-lg font-semibold tabular-nums text-white">
              {counting}
            </span>
            <span className="text-sm text-ink-300">Recording starts in {counting}s — get into position.</span>
            <button
              onClick={cancelCountdown}
              className="rounded-md border border-ink-700 px-3 py-1.5 text-sm text-ink-200 hover:bg-ink-800"
            >
              Cancel
            </button>
          </div>
        ) : !recording ? (
          <div className="flex flex-wrap items-center gap-2">
            <button onClick={startWithCountdown} disabled={busy} className="rounded-md bg-red-600 hover:bg-red-500 px-4 py-2 text-sm font-medium text-white">
              ⏺ Record{countdown > 0 ? ` after ${countdown}s` : ''}
            </button>
            <label className="flex items-center gap-2 text-xs text-ink-400">
              Countdown
              <select
                value={countdown}
                onChange={(e) => setCountdown(Number(e.target.value))}
                className="rounded-md border border-ink-700 bg-ink-950 px-2 py-1 text-xs text-ink-200"
              >
                {COUNTDOWN_CHOICES.map((c) => (
                  <option key={c} value={c}>
                    {c === 0 ? 'None — start now' : `${c} seconds`}
                  </option>
                ))}
              </select>
            </label>
          </div>
        ) : (
          <button onClick={stopRecording} className="rounded-md bg-gold-500 hover:bg-gold-400 px-4 py-2 text-sm font-medium text-ink-950">⏹ Stop & save ({mmss})</button>
        )}
        {previewing && !recording && <button onClick={() => { stopEverything(); setPreviewing(false) }} className="rounded-md border border-ink-700 px-3 py-2 text-sm text-ink-300 hover:bg-ink-800">Stop preview</button>}
        {busy && <span className="text-sm text-gold-300">Saving…</span>}
      </div>

      {error && <div className="mt-3 rounded-md border border-red-800 bg-red-950/40 px-3 py-2 text-sm text-red-300">{error}</div>}
      {note && <div className="mt-3 rounded-md border border-emerald-800 bg-emerald-950/40 px-3 py-2 text-sm text-emerald-300">{note}</div>}
    </div>
  )
}
