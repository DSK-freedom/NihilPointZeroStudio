import { describe, expect, it } from 'vitest'
import { buildThumbnailArgs, sanitizeHeadline, splitHeadline, thumbThemeFor } from './thumbnail'

describe('sanitizeHeadline', () => {
  it('uppercases and strips risky characters', () => {
    expect(sanitizeHeadline('The 1% are "winning"')).toBe('THE 1% ARE WINNING')
  })
})

describe('splitHeadline', () => {
  it('wraps on word boundaries within the line limit', () => {
    const lines = splitHeadline('THE GREATEST WEALTH TRANSFER IN HISTORY', 16, 3)
    expect(lines.length).toBeGreaterThanOrEqual(2)
    for (const l of lines) expect(l.length).toBeLessThanOrEqual(16)
  })
  it('never exceeds maxLines', () => {
    expect(splitHeadline('one two three four five six seven eight nine ten', 6, 3).length).toBeLessThanOrEqual(3)
  })
  it('falls back to a placeholder for empty input', () => {
    expect(splitHeadline('')).toEqual(['THUMBNAIL'])
  })
})

describe('buildThumbnailArgs', () => {
  const theme = thumbThemeFor('neon')
  it('renders a single PNG frame with a color background and drawtext per line', () => {
    const args = buildThumbnailArgs({ lineFiles: ['a.txt', 'b.txt'], theme, outPath: 'o.png' })
    const s = args.join(' ')
    expect(s).toContain('color=c=')
    expect(s).toContain('-frames:v 1')
    expect((s.match(/drawtext/g) || []).length).toBe(2)
    expect(args[args.length - 1]).toBe('o.png')
  })
  it('uses an image input (no lavfi color) when a background image is given', () => {
    const args = buildThumbnailArgs({ lineFiles: ['a.txt'], theme, outPath: 'o.png', bgImage: 'bg.jpg' })
    expect(args.join(' ')).not.toContain('color=c=')
    expect(args).toContain('bg.jpg')
  })
})
