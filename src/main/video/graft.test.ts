import { describe, expect, it } from 'vitest'
import {
  buildGraftArgs,
  buildGraftFilter,
  buildGraftPreviewArgs,
  buildToolCommand,
  DEFAULT_GRAFT_REGION,
  sanitizeGraftRegion
} from './graft'

describe('sanitizeGraftRegion', () => {
  it('returns defaults for missing input', () => {
    expect(sanitizeGraftRegion(null)).toEqual(DEFAULT_GRAFT_REGION)
    expect(sanitizeGraftRegion({})).toEqual(DEFAULT_GRAFT_REGION)
  })

  it('clamps out-of-range values into render-safe bounds', () => {
    const r = sanitizeGraftRegion({ sx: 2, sy: -1, sw: 9, sh: 0, dx: 5, dy: -3, dw: 0, featherFrac: 3, brightness: 9, saturation: 99 })
    expect(r.sw).toBe(1)
    expect(r.sh).toBe(0.05)
    expect(r.sx).toBe(0) // 1 - sw = 0
    expect(r.sy).toBe(0)
    expect(r.dx).toBe(0.98)
    expect(r.dy).toBe(0)
    expect(r.dw).toBe(0.05)
    expect(r.featherFrac).toBe(0.45)
    expect(r.brightness).toBe(0.3)
    expect(r.saturation).toBe(2)
  })

  it('never lets the source rect overflow the frame (sx + sw <= 1)', () => {
    const r = sanitizeGraftRegion({ sx: 0.9, sw: 0.4 })
    expect(r.sx + r.sw).toBeLessThanOrEqual(1)
  })
})

describe('buildGraftFilter', () => {
  const region = { ...DEFAULT_GRAFT_REGION }

  it('builds base, feathered part, and overlay chains', () => {
    const f = buildGraftFilter(region, 1920, 1080, 25)
    expect(f).toContain('[0:v]scale=1920:1080:force_original_aspect_ratio=increase,crop=1920:1080')
    expect(f).toContain('[1:v]crop=')
    expect(f).toContain('format=yuva444p')
    expect(f).toContain('geq=') // the feathering alpha ramp
    expect(f).toContain('[base][part]overlay=')
    expect(f).toContain('shortest=1')
    expect(f).toContain('fps=25')
    expect(f.endsWith('[v]')).toBe(true)
  })

  it('destination width is even (encoder-safe) and placement matches the region', () => {
    const f = buildGraftFilter({ ...region, dw: 0.333, dx: 0.25, dy: 0.5 }, 1920, 1080, 25)
    const scaleMatch = /scale=(\d+):-2/.exec(f)
    expect(scaleMatch).toBeTruthy()
    expect(Number(scaleMatch![1]) % 2).toBe(0)
    expect(f).toContain(`overlay=${Math.round(1920 * 0.25)}:${Math.round(1080 * 0.5)}`)
  })

  it('omits the eq stage at neutral colour settings, includes it otherwise', () => {
    // NB: check 'eq=brightness' specifically — plain 'eq=' would also match the geq= feather stage.
    expect(buildGraftFilter({ ...region, brightness: 0, saturation: 1 }, 1920, 1080, 25)).not.toContain('eq=brightness')
    expect(buildGraftFilter({ ...region, brightness: 0.1, saturation: 1.2 }, 1920, 1080, 25)).toContain(
      'eq=brightness=0.1:saturation=1.2'
    )
  })
})

describe('buildGraftArgs', () => {
  const base = {
    photoPath: 'C:\\me\\best photo.jpg',
    videoPath: 'C:\\me\\talk.mp4',
    region: DEFAULT_GRAFT_REGION,
    width: 1920,
    height: 1080,
    fps: 25,
    outPath: 'C:\\out\\grafted.mp4',
    encoderArgs: ['-c:v', 'libx264']
  }

  it('loops the photo, maps the composited stream, and drops audio by default', () => {
    const args = buildGraftArgs(base)
    expect(args.slice(0, 5)).toEqual(['-y', '-loop', '1', '-i', 'C:\\me\\best photo.jpg'])
    expect(args).toContain('-filter_complex')
    expect(args).toContain('[v]')
    expect(args).toContain('-an')
    expect(args[args.length - 1]).toBe('C:\\out\\grafted.mp4')
  })

  it('keeps the video audio when asked', () => {
    const args = buildGraftArgs({ ...base, keepAudio: true })
    expect(args).toContain('1:a?')
    expect(args).not.toContain('-an')
  })
})

describe('buildGraftPreviewArgs', () => {
  it('seeks the video and renders exactly one frame', () => {
    const args = buildGraftPreviewArgs({
      photoPath: 'p.jpg',
      videoPath: 'v.mp4',
      region: DEFAULT_GRAFT_REGION,
      width: 1280,
      height: 720,
      atSec: 3.5,
      outPng: 'prev.png'
    })
    const ss = args.indexOf('-ss')
    expect(ss).toBeGreaterThan(-1)
    expect(args[ss + 1]).toBe('3.5')
    expect(args.indexOf('-ss')).toBeLessThan(args.lastIndexOf('-i')) // fast input seek
    expect(args).toContain('-frames:v')
    expect(args[args.length - 1]).toBe('prev.png')
  })
})

describe('buildToolCommand', () => {
  const files = { photo: 'C:\\my pics\\best.jpg', video: 'C:\\vid\\talk.mp4', out: 'C:\\out\\anim.mp4' }

  it('substitutes placeholders AFTER tokenising, so spaced paths stay single args', () => {
    const argv = buildToolCommand('python -m mytool --face {photo} --video {video} --outfile {out}', files)
    expect(argv).toEqual([
      'python', '-m', 'mytool',
      '--face', 'C:\\my pics\\best.jpg',
      '--video', 'C:\\vid\\talk.mp4',
      '--outfile', 'C:\\out\\anim.mp4'
    ])
  })

  it('defaults {audio} to the video path when no audio file is given', () => {
    const argv = buildToolCommand('tool --audio {audio} --out {out}', files)
    expect(argv).toContain('C:\\vid\\talk.mp4')
  })

  it('rejects a template without {out}', () => {
    expect(() => buildToolCommand('tool --face {photo}', files)).toThrow(/\{out\}/)
  })

  it('rejects an empty template', () => {
    expect(() => buildToolCommand('   ', files)).toThrow(/empty/)
  })
})
