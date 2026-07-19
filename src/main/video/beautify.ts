/**
 * Portrait beautify — a free, deterministic, on-device skin/face retouch built purely
 * from standard ffmpeg filters (no ML, no cloud). The arg construction is pure so the
 * exact filter math is unit-tested; the runner (./index beautifyImage) just executes it.
 *
 * `strength` is signed in [-1, 1]:
 *   • > 0  → BEAUTIFY: edge-preserving skin smoothing (smartblur only flattens low-contrast
 *            skin, leaving eyes/hair/edges sharp), a gentle brightness/saturation/contrast
 *            lift, and a light unsharp so the eyes stay crisp after smoothing.
 *   • < 0  → the opposite ("or vice versa"): more local contrast, extra sharpening, a touch
 *            less saturation, and subtle film grain for a grittier, harsher look.
 *   • = 0  → passthrough (a `null` filter), so the pipeline shape is always valid.
 *
 * The magnitude scales every parameter, so the effect is continuous and predictable.
 */
export interface BeautifyOptions {
  /** Signed intensity in [-1, 1]. Positive beautifies; negative roughens. */
  strength: number
}

const n2 = (n: number): string => (Math.round(n * 100) / 100).toFixed(2)

/** Builds the ffmpeg `-vf` filter chain string for a beautify pass. Pure + unit-tested. */
export function buildBeautifyFilter(opts: BeautifyOptions): string {
  const strength = Math.max(-1, Math.min(1, Number.isFinite(opts.strength) ? opts.strength : 0))
  const s = Math.abs(strength)
  if (s < 0.001) return 'null'
  const parts: string[] = []
  if (strength > 0) {
    // Edge-preserving skin smoothing: positive luma_threshold means only low-contrast
    // (flat, skin-like) regions are blurred; edges stay sharp.
    parts.push(`smartblur=lr=${n2(1 + 2 * s)}:ls=${n2(0.6 * s)}:lt=${Math.round(20 * s)}`)
    parts.push(`eq=brightness=${n2(0.03 * s)}:saturation=${n2(1 + 0.12 * s)}:contrast=${n2(1 + 0.05 * s)}:gamma=${n2(1 + 0.05 * s)}`)
    // Restore micro-detail (eyes, brows) that smoothing softened.
    parts.push(`unsharp=5:5:${n2(0.4 * s)}:5:5:0.0`)
  } else {
    parts.push(`eq=contrast=${n2(1 + 0.4 * s)}:saturation=${n2(1 - 0.25 * s)}:brightness=${n2(-0.02 * s)}`)
    parts.push(`unsharp=5:5:${n2(1.2 * s)}:5:5:0.0`)
    parts.push(`noise=alls=${Math.round(12 * s)}:allf=t`)
  }
  return parts.join(',')
}

/** Full ffmpeg args to beautify one image file to `out`. Pure. */
export function buildBeautifyArgs(input: string, out: string, opts: BeautifyOptions): string[] {
  return ['-y', '-i', input, '-vf', buildBeautifyFilter(opts), '-q:v', '2', out]
}
