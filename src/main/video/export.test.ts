import { describe, expect, it } from 'vitest'
import { buildExportArgs, EXPORT_FORMATS, formatExtension, type ExportFormat } from './export'

describe('formatExtension', () => {
  it('maps every format to its container extension', () => {
    expect(formatExtension('youtube')).toBe('mp4')
    expect(formatExtension('mp4-h264')).toBe('mp4')
    expect(formatExtension('mp4-h265')).toBe('mp4')
    expect(formatExtension('mov')).toBe('mov')
    expect(formatExtension('webm-vp9')).toBe('webm')
  })
})

describe('buildExportArgs', () => {
  const src = 'C:/in.mp4'
  const out = 'C:/out.file'

  it('always starts with -y and the input, and ends with the output path', () => {
    for (const f of EXPORT_FORMATS) {
      const args = buildExportArgs(f.id, src, out)
      expect(args.slice(0, 3)).toEqual(['-y', '-i', src])
      expect(args[args.length - 1]).toBe(out)
    }
  })

  it('youtube preset is H.264/AAC yuv420p with faststart', () => {
    const args = buildExportArgs('youtube', src, out)
    expect(args).toContain('libx264')
    expect(args).toContain('aac')
    expect(args).toContain('yuv420p')
    expect(args.join(' ')).toContain('-movflags +faststart')
  })

  it('h265 uses libx265 and the hvc1 tag for MP4 compatibility', () => {
    const args = buildExportArgs('mp4-h265', src, out)
    expect(args).toContain('libx265')
    expect(args.join(' ')).toContain('-tag:v hvc1')
  })

  it('webm uses VP9 + Opus (no aac)', () => {
    const args = buildExportArgs('webm-vp9', src, out)
    expect(args).toContain('libvpx-vp9')
    expect(args).toContain('libopus')
    expect(args).not.toContain('aac')
  })

  it('mov is H.264 without the mp4 faststart flag', () => {
    const args = buildExportArgs('mov', src, out)
    expect(args).toContain('libx264')
    expect(args.join(' ')).not.toContain('faststart')
  })

  it('every descriptor id builds without throwing', () => {
    const ids: ExportFormat[] = EXPORT_FORMATS.map((f) => f.id)
    for (const id of ids) expect(() => buildExportArgs(id, src, out)).not.toThrow()
  })
})
