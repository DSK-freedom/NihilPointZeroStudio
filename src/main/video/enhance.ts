/**
 * Media enhancement — PURE ffmpeg arg builders for cleaning up a recording or any built
 * video. Free/offline. Two independent passes you can toggle:
 *
 *   AUDIO ("clean up my voice"): high-pass out rumble → FFT denoise → gentle compression to
 *   even out level → EBU R128 loudness normalize to broadcast/voice target → peak limiter.
 *   VIDEO ("polish"): a light colour grade (contrast/brightness/saturation/gamma) + a subtle
 *   unsharp so webcam/screen footage looks crisper and more even.
 *
 * All filters are standard bundled-ffmpeg filters; the builders are pure so they're unit-
 * tested, and the chains are validated by actually running ffmpeg.
 */

/** Voice-focused audio cleanup chain (for -af). `level=disabled` limiter = attenuate only. */
export const AUDIO_ENHANCE_FILTER =
  'highpass=f=80,afftdn=nf=-25,acompressor=threshold=-18dB:ratio=3:attack=15:release=250,loudnorm=I=-16:TP=-1.5:LRA=11,alimiter=limit=0.95:level=disabled'

/** Light video polish chain (for -vf): even colour + gentle sharpen. */
export const VIDEO_ENHANCE_FILTER = 'eq=contrast=1.06:brightness=0.03:saturation=1.08:gamma=0.98,unsharp=5:5:0.8'

/**
 * Builds ffmpeg args to enhance `input` → `out`. Enhanced streams are re-encoded; the other
 * stream is stream-copied (fast, lossless) when its pass is off. At least one pass must be on.
 * Pure + unit-tested.
 */
export function buildEnhanceArgs(
  input: string,
  out: string,
  opts: { audio?: boolean; video?: boolean } = { audio: true, video: true }
): string[] {
  const audio = opts.audio !== false
  const video = opts.video !== false
  const args = ['-y', '-i', input]
  if (video) args.push('-vf', VIDEO_ENHANCE_FILTER, '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '20', '-pix_fmt', 'yuv420p')
  else args.push('-c:v', 'copy')
  if (audio) args.push('-af', AUDIO_ENHANCE_FILTER, '-c:a', 'aac', '-b:a', '192k')
  else args.push('-c:a', 'copy')
  args.push('-movflags', '+faststart', out)
  return args
}
