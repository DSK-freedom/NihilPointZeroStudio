import { useEffect, useRef, useState } from 'react'

/** Appends newly-dictated text to an existing field value with a single space. */
export function appendDictation(existing: string, text: string): string {
  return existing.trim() ? `${existing.trim()} ${text}` : text
}

type MicState = 'idle' | 'recording' | 'working' | 'error'

/**
 * A small dictation button. Records from the mic, sends the clip to the offline
 * Whisper model in the main process, and hands the transcribed text back via
 * onText. Click to start, click again to stop → transcribe. Fully offline/free.
 */
export default function MicButton({
  onText,
  className = ''
}: {
  onText: (text: string) => void
  className?: string
}) {
  const [state, setState] = useState<MicState>('idle')
  const recorderRef = useRef<MediaRecorder | null>(null)
  const streamRef = useRef<MediaStream | null>(null)
  const chunksRef = useRef<Blob[]>([])

  // Release the mic if the component unmounts mid-recording (switching tabs) — otherwise
  // the MediaStream stays live and the OS mic indicator stays on. Privacy/resource leak.
  useEffect(() => {
    return () => {
      try {
        if (recorderRef.current && recorderRef.current.state === 'recording') recorderRef.current.stop()
      } catch {
        /* ignore */
      }
      streamRef.current?.getTracks().forEach((t) => t.stop())
    }
  }, [])

  async function start(): Promise<void> {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
      streamRef.current = stream
      const rec = new MediaRecorder(stream)
      chunksRef.current = []
      rec.ondataavailable = (e) => e.data.size > 0 && chunksRef.current.push(e.data)
      rec.onstop = async () => {
        stream.getTracks().forEach((t) => t.stop())
        streamRef.current = null
        setState('working')
        try {
          const blob = new Blob(chunksRef.current, { type: 'audio/webm' })
          const bytes = new Uint8Array(await blob.arrayBuffer())
          const text = await window.api.speech.transcribe(bytes)
          if (text) onText(text)
          setState('idle')
        } catch {
          setState('error')
          setTimeout(() => setState('idle'), 2500)
        }
      }
      rec.start()
      recorderRef.current = rec
      setState('recording')
    } catch {
      setState('error')
      setTimeout(() => setState('idle'), 2500)
    }
  }

  function handleClick(): void {
    if (state === 'recording') recorderRef.current?.stop()
    else if (state === 'idle' || state === 'error') void start()
  }

  const label =
    state === 'recording'
      ? '⏹ Stop'
      : state === 'working'
        ? '… transcribing'
        : state === 'error'
          ? '⚠ mic error'
          : '🎤 Speak'
  const tone =
    state === 'recording'
      ? 'border-red-500 text-red-300'
      : state === 'error'
        ? 'border-red-500/60 text-red-300'
        : 'border-ink-600 hover:border-gold-500 text-ink-300 hover:text-gold-400'

  return (
    <button
      type="button"
      onClick={handleClick}
      disabled={state === 'working'}
      title="Dictate — speak instead of typing (offline). English → English, Urdu → Urdu script."
      className={`rounded-md border px-2 py-0.5 text-[10px] transition-colors disabled:opacity-60 ${tone} ${className}`}
    >
      {label}
    </button>
  )
}
