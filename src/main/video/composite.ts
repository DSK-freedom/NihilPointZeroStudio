/**
 * Composite engine — places a subject (an RGBA cutout of the real person, produced by
 * the on-device matting step) onto a background scene at WxH. Pure ffmpeg-arg builder so
 * the scale/anchor/position math is unit-tested; the runner (./index compositeImage) runs it.
 *
 * The background is cover-scaled + cropped to fill the frame (no letterboxing); the subject
 * is height-scaled to `subjectScale` of the frame height (aspect preserved) and anchored.
 */
export type XAnchor = 'left' | 'center' | 'right'
export type YAnchor = 'top' | 'middle' | 'bottom'

export interface CompositeOptions {
  width: number
  height: number
  /** Subject height as a fraction of frame height (0.1–1.0). */
  subjectScale?: number
  x?: XAnchor
  y?: YAnchor
}

/** Overlay x expression for the anchor (W = main width, w = overlay width). */
function xExpr(a: XAnchor): string {
  if (a === 'left') return '40'
  if (a === 'right') return 'W-w-40'
  return '(W-w)/2'
}
/** Overlay y expression for the anchor (H = main height, h = overlay height). */
function yExpr(a: YAnchor): string {
  if (a === 'top') return '40'
  if (a === 'middle') return '(H-h)/2'
  return 'H-h' // bottom: feet/base at the frame bottom
}

/** Builds the filter_complex for a background + subject composite. Pure + unit-tested. */
export function buildCompositeFilter(opts: CompositeOptions): string {
  const { width: W, height: H } = opts
  const scale = Math.max(0.1, Math.min(1, opts.subjectScale ?? 0.9))
  const subjectH = Math.round(H * scale)
  const x = xExpr(opts.x ?? 'center')
  const y = yExpr(opts.y ?? 'bottom')
  return [
    // Background: cover-fill the frame, then hard-crop to exactly WxH.
    `[0:v]scale=${W}:${H}:force_original_aspect_ratio=increase,crop=${W}:${H},setsar=1[bg]`,
    // Subject: scale to subjectH tall (width auto, aspect kept), keep its alpha.
    `[1:v]scale=-1:${subjectH}:flags=lanczos[fg]`,
    `[bg][fg]overlay=${x}:${y}:format=auto[out]`
  ].join(';')
}

/** Full ffmpeg args: background (input 0) + RGBA subject (input 1) → composed image `out`. Pure. */
export function buildCompositeArgs(bgPath: string, subjectPath: string, out: string, opts: CompositeOptions): string[] {
  return [
    '-y',
    '-i', bgPath,
    '-i', subjectPath,
    '-filter_complex', buildCompositeFilter(opts),
    '-map', '[out]',
    '-frames:v', '1',
    '-q:v', '2',
    out
  ]
}
