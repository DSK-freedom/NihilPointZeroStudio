/**
 * Stitches several finished videos into one. Clips may differ in resolution, so each
 * is scaled to fit a common WxH (letterboxed/padded, aspect preserved) and its audio
 * normalized, then all are concatenated. Pure arg construction is unit-tested.
 */

/**
 * Builds the ffmpeg args to concatenate `inputs` into `outPath` at WxH using the given
 * encoder args (from encoder.ts). Every input is scaled+padded to WxH@25fps and its
 * audio conformed to 44.1kHz stereo, so the concat is clean regardless of source.
 */
export function buildStitchArgs(params: {
  inputs: string[]
  width: number
  height: number
  encoderArgs: string[]
  outPath: string
}): string[] {
  const { inputs, width, height, encoderArgs, outPath } = params
  if (inputs.length < 2) throw new Error('Stitching needs at least two videos.')

  const chains: string[] = []
  const concatLabels: string[] = []
  inputs.forEach((_, i) => {
    chains.push(
      `[${i}:v]scale=${width}:${height}:force_original_aspect_ratio=decrease,` +
        `pad=${width}:${height}:(ow-iw)/2:(oh-ih)/2:color=black,setsar=1,fps=25[v${i}]`
    )
    chains.push(`[${i}:a]aformat=sample_rates=44100:channel_layouts=stereo[a${i}]`)
    concatLabels.push(`[v${i}][a${i}]`)
  })
  chains.push(`${concatLabels.join('')}concat=n=${inputs.length}:v=1:a=1[v][a]`)

  const args = ['-y']
  for (const p of inputs) args.push('-i', p)
  args.push(
    '-filter_complex', chains.join(';'),
    '-map', '[v]', '-map', '[a]',
    ...encoderArgs,
    '-r', '25', '-c:a', 'aac', '-b:a', '192k', '-movflags', '+faststart',
    outPath
  )
  return args
}
