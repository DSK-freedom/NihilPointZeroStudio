/**
 * Change a built video's background music WITHOUT touching the narration — because we
 * kept the narration as its own track when the video was built, this is exact and fully
 * offline (no AI "unmixing" needed). 'remove' drops the music and keeps only the voice;
 * 'replace' lays a new music bed under the voice. Pure arg builder + unit-tested.
 */
export type MusicMode = 'remove' | 'replace'

export function buildSetMusicArgs(params: {
  mode: MusicMode
  videoPath: string
  narrationPath: string
  /** Required when mode==='replace': the new music bed file (looped, ducked under voice). */
  musicPath?: string
  outPath: string
}): string[] {
  const { mode, videoPath, narrationPath, musicPath, outPath } = params
  const tail = ['-c:v', 'copy', '-c:a', 'aac', '-b:a', '192k', '-shortest', '-movflags', '+faststart', outPath]

  if (mode === 'remove' || !musicPath) {
    // Keep only the narration: copy the video stream, use the narration audio as-is.
    return ['-y', '-i', videoPath, '-i', narrationPath, '-map', '0:v:0', '-map', '1:a:0', ...tail]
  }

  // Replace: mix a faded-in music bed (looped) under the narration, AUTO-DUCKED — the
  // music dips automatically whenever the voice is speaking (sidechain compression),
  // then mixes with the narration. Sounds professional, no manual volume-riding.
  return [
    '-y',
    '-i',
    videoPath,
    '-i',
    narrationPath,
    '-stream_loop',
    '-1',
    '-i',
    musicPath,
    '-filter_complex',
    // The narration pad [1:a] is needed TWICE (as the sidechain key AND as an amix input),
    // but an input pad can only feed one filter — so split it first with asplit. Without
    // this, ffmpeg rejects the graph and every "Replace music" op fails.
    // Normalise both to one rate/layout before sidechain+mix, and cap peaks with a
    // level=disabled limiter (attenuate-only) so ducked-music + narration transients
    // can't clip the encoder.
    '[1:a]aresample=44100,aformat=sample_fmts=fltp:channel_layouts=stereo,asplit=2[nkey][nmix];' +
      '[2:a]aresample=44100,aformat=sample_fmts=fltp:channel_layouts=stereo,volume=0.5,afade=t=in:st=0:d=1.5[mraw];' +
      '[mraw][nkey]sidechaincompress=threshold=0.03:ratio=6:attack=20:release=300[mus];' +
      '[nmix][mus]amix=inputs=2:duration=first:normalize=0[amx];[amx]alimiter=limit=0.95:level=disabled[aout]',
    '-map',
    '0:v:0',
    '-map',
    '[aout]',
    ...tail
  ]
}
