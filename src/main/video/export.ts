/**
 * Pure builders for exporting/transcoding a finished video into a chosen delivery
 * format. Kept free of Node/Electron imports so the argument construction can be
 * unit-tested directly (the "mathematical accuracy" guarantee applies here: given a
 * format, the exact ffmpeg args are deterministic).
 *
 * All encoders used (libx264, libx265, libvpx-vp9, aac, libopus) are verified present
 * in the bundled ffmpeg-static build, so every format works fully offline.
 */

import { EXPORT_FORMATS, type ExportFormat } from '../../shared/types'

export { EXPORT_FORMATS, type ExportFormat, type ExportFormatInfo } from '../../shared/types'

/** File extension (no dot) for a given export format. */
export function formatExtension(format: ExportFormat): string {
  return EXPORT_FORMATS.find((f) => f.id === format)?.ext ?? 'mp4'
}

/**
 * Builds the full ffmpeg argument list to transcode `srcPath` into `outPath` for the
 * given format. Always re-encodes (rather than stream-copying) so the output is a
 * clean, self-contained file in the target container/codec.
 */
export function buildExportArgs(format: ExportFormat, srcPath: string, outPath: string): string[] {
  const base = ['-y', '-i', srcPath]
  switch (format) {
    case 'youtube':
    case 'mp4-h264':
      return [
        ...base,
        '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '20', '-pix_fmt', 'yuv420p',
        '-c:a', 'aac', '-b:a', '192k',
        '-movflags', '+faststart',
        outPath
      ]
    case 'mp4-h265':
      return [
        ...base,
        '-c:v', 'libx265', '-preset', 'veryfast', '-crf', '24', '-pix_fmt', 'yuv420p', '-tag:v', 'hvc1',
        '-c:a', 'aac', '-b:a', '192k',
        '-movflags', '+faststart',
        outPath
      ]
    case 'mov':
      return [
        ...base,
        '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '20', '-pix_fmt', 'yuv420p',
        '-c:a', 'aac', '-b:a', '192k',
        outPath
      ]
    case 'webm-vp9':
      return [
        ...base,
        '-c:v', 'libvpx-vp9', '-b:v', '0', '-crf', '32', '-pix_fmt', 'yuv420p',
        '-c:a', 'libopus', '-b:a', '160k',
        outPath
      ]
    default: {
      // Exhaustiveness guard — a new format must be handled above.
      const _never: never = format
      throw new Error(`Unsupported export format: ${String(_never)}`)
    }
  }
}
