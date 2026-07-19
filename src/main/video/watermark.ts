/**
 * Brand kit — logo watermark. Overlays a logo image (transparent PNG ideal) in a
 * corner of a built video. Pure arg builder + unit-tested; the video is re-encoded
 * (overlay needs it), audio copied. Non-destructive. The caller computes `logoWidthPx`
 * from the video width so the logo looks consistent at any resolution.
 */
export type WatermarkPosition = 'top-left' | 'top-right' | 'bottom-left' | 'bottom-right'

/** overlay x/y expressions for each corner, with a `m` px margin. Pure. */
export function overlayXY(pos: WatermarkPosition, m: number): string {
  switch (pos) {
    case 'top-left':
      return `x=${m}:y=${m}`
    case 'bottom-left':
      return `x=${m}:y=H-h-${m}`
    case 'bottom-right':
      return `x=W-w-${m}:y=H-h-${m}`
    case 'top-right':
    default:
      return `x=W-w-${m}:y=${m}`
  }
}

export function buildWatermarkArgs(params: {
  videoPath: string
  logoPath: string
  logoWidthPx: number
  position?: WatermarkPosition
  margin?: number
  outPath: string
}): string[] {
  const { videoPath, logoPath, logoWidthPx, outPath } = params
  const position = params.position ?? 'bottom-right'
  const margin = params.margin ?? 24
  const filter = `[1:v]scale=${Math.max(16, Math.round(logoWidthPx))}:-1[wm];[0:v][wm]overlay=${overlayXY(position, margin)}[v]`
  return [
    '-y',
    '-i',
    videoPath,
    '-i',
    logoPath,
    '-filter_complex',
    filter,
    '-map',
    '[v]',
    '-map',
    '0:a?',
    '-c:v',
    'libx264',
    '-preset',
    'veryfast',
    '-crf',
    '20',
    '-pix_fmt',
    'yuv420p',
    '-c:a',
    'copy',
    '-movflags',
    '+faststart',
    outPath
  ]
}
