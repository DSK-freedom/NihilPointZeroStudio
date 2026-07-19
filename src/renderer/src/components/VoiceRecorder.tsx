import { useEffect, useRef, useState } from 'react'
import type { VideoJob } from '../../../shared/types'

type Phase = 'idle' | 'recording' | 'paused' | 'ready'

function mmss(sec: number): string {
  const s = Math.max(0, Math.floor(sec))
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`
}

/**
 * In-tab voice-over studio (lives inside Video Studio, under each built video).
 * Record with Pause/Resume, review with a scrubber, "Redo from here" (punch-in: keeps
 * everything before the playhead and re-records the rest), re-record from scratch, then
 * attach — either REPLACING the video's audio or KEEPING it and adding your voice on top.
 * All free/offline (mic + bundled ffmpeg).
 */
export default function VoiceRecorder({ job, onDone }: { job: VideoJob; onDone: (newJob: VideoJob) => void }): React.JSX.Element {
  const [phase, setPhase] = useState<Phase>('idle')
  const [take, setTake] = useState<{ bytes: Uint8Array; url: string } | null>(null)
  const [elapsed, setElapsed] = useState(0)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const recRef = useRef<MediaRecorder | null>(null)
  const streamRef = useRef<MediaStream | null>(null)
  const chunksRef = useRef<Blob[]>([])
  const audioRef = useRef<HTMLAudioElement | null>(null)
  const redoFromRef = useRef<number | null>(null)
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const takeRef = useRef<{ bytes: Uint8Array; url: string } | null>(null)

  useEffect(() => {
    takeRef.current = take
  }, [take])

  // Clean up mic + object URLs when the panel closes.
  useEffect(() => {
    return () => {
      streamRef.current?.getTracks().forEach((t) => t.stop())
      if (timerRef.current) clearInterval(timerRef.current)
      if (takeRef.current) URL.revokeObjectURL(takeRef.current.url)
    }
  }, [])

  function startTimer(reset: boolean): void {
    if (reset) setElapsed(0)
    if (timerRef.current) clearInterval(timerRef.current)
    timerRef.current = setInterval(() => setElapsed((e) => e + 1), 1000)
  }
  function stopTimer(): void {
    if (timerRef.current) clearInterval(timerRef.current)
    timerRef.current = null
  }

  function setTakeFrom(bytes: Uint8Array, mime: string): void {
    if (takeRef.current) URL.revokeObjectURL(takeRef.current.url)
    const url = URL.createObjectURL(new Blob([bytes as unknown as BlobPart], { type: mime }))
    setTake({ bytes, url })
  }

  async function beginRecording(): Promise<void> {
    setError(null)
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
      streamRef.current = stream
      const rec = new MediaRecorder(stream)
      chunksRef.current = []
      rec.ondataavailable = (e) => e.data.size > 0 && chunksRef.current.push(e.data)
      rec.onstop = handleStop
      rec.start()
      recRef.current = rec
      setPhase('recording')
      startTimer(true)
    } catch {
      setError('Could not access the microphone. Check Windows mic permissions.')
      setPhase(take ? 'ready' : 'idle')
    }
  }

  async function handleStop(): Promise<void> {
    streamRef.current?.getTracks().forEach((t) => t.stop())
    stopTimer()
    setBusy(true)
    try {
      const seg = new Uint8Array(await new Blob(chunksRef.current, { type: 'audio/webm' }).arrayBuffer())
      const cutAt = redoFromRef.current
      const prev = takeRef.current
      if (cutAt != null && prev) {
        // Punch-in: keep prior take up to the playhead, then append the new segment.
        const assembled = await window.api.video.assembleVoice([
          { bytes: prev.bytes, endSec: cutAt },
          { bytes: seg }
        ])
        setTakeFrom(assembled, 'audio/wav')
      } else {
        setTakeFrom(seg, 'audio/webm')
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not process the recording.')
    } finally {
      redoFromRef.current = null
      setBusy(false)
      setPhase('ready')
    }
  }

  function pause(): void {
    recRef.current?.pause()
    stopTimer()
    setPhase('paused')
  }
  function resume(): void {
    recRef.current?.resume()
    startTimer(false)
    setPhase('recording')
  }
  function stop(): void {
    recRef.current?.stop()
  }

  function reRecord(): void {
    redoFromRef.current = null
    void beginRecording()
  }
  function redoFromPlayhead(): void {
    redoFromRef.current = audioRef.current?.currentTime ?? 0
    void beginRecording()
  }

  async function useTake(mode: 'replace' | 'add'): Promise<void> {
    if (!take) return
    setBusy(true)
    setError(null)
    try {
      const newJob =
        mode === 'replace'
          ? await window.api.video.attachVoice(job.id, take.bytes)
          : await window.api.video.addVoice(job.id, take.bytes)
      onDone(newJob as VideoJob)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not attach the voice-over.')
    } finally {
      setBusy(false)
    }
  }

  const recording = phase === 'recording' || phase === 'paused'

  return (
    <div className="mt-2 rounded-md border border-ink-700 bg-ink-900/60 p-3 space-y-3">
      <div className="flex items-center gap-2">
        <span className="text-[11px] text-gold-300 font-medium">🎙 Voice studio</span>
        {recording && <span className="text-[11px] text-red-300 tabular-nums">● {mmss(elapsed)}</span>}
      </div>

      {/* Recording controls */}
      <div className="flex flex-wrap items-center gap-2">
        {!recording && (
          <button onClick={() => void beginRecording()} disabled={busy} className="rounded-md bg-red-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-red-500 disabled:opacity-40">
            ● {take ? 'Record again' : 'Start recording'}
          </button>
        )}
        {phase === 'recording' && (
          <button onClick={pause} className="rounded-md bg-amber-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-amber-500">⏸ Pause</button>
        )}
        {phase === 'paused' && (
          <button onClick={resume} className="rounded-md bg-emerald-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-emerald-500">▶ Resume</button>
        )}
        {recording && (
          <button onClick={stop} className="rounded-md bg-ink-700 px-3 py-1.5 text-xs font-medium text-ink-100 hover:bg-ink-600">⏹ Stop</button>
        )}
        {busy && <span className="text-[11px] text-gold-300">working…</span>}
      </div>

      {/* Review + edit the take */}
      {take && !recording && (
        <div className="space-y-2">
          <audio ref={audioRef} src={take.url} controls className="w-full" />
          <div className="flex flex-wrap items-center gap-2">
            <button onClick={redoFromPlayhead} disabled={busy} className="rounded-md border border-ink-600 px-3 py-1.5 text-xs text-ink-200 hover:border-gold-500 disabled:opacity-40">
              ↻ Redo from playhead (keep the part before it)
            </button>
            <button onClick={reRecord} disabled={busy} className="rounded-md border border-ink-600 px-3 py-1.5 text-xs text-ink-200 hover:border-gold-500 disabled:opacity-40">
              ⟲ Re-record from scratch
            </button>
          </div>
          <div className="rounded-md border border-ink-700 bg-ink-950 p-2">
            <div className="text-[11px] text-ink-400 mb-1">Use this voice-over:</div>
            <div className="flex flex-wrap gap-2">
              <button onClick={() => void useTake('replace')} disabled={busy} className="rounded-md bg-gold-500 px-3 py-1.5 text-xs font-medium text-ink-950 hover:bg-gold-400 disabled:opacity-40">
                Replace the video’s narration
              </button>
              <button onClick={() => void useTake('add')} disabled={busy} className="rounded-md border border-gold-500/60 px-3 py-1.5 text-xs font-medium text-gold-300 hover:bg-gold-500/10 disabled:opacity-40">
                Keep existing audio + add my voice
              </button>
            </div>
            <div className="mt-1 text-[10px] text-ink-600">
              “Replace” swaps the audio for your recording. “Keep + add” layers your voice over whatever the video already has.
              A new video is created; your original is kept.
            </div>
          </div>
        </div>
      )}

      {error && <div className="text-[11px] text-red-300">{error}</div>}
    </div>
  )
}
