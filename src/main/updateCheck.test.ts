import { describe, expect, it } from 'vitest'
import { isNewer, tagDate } from './updateCheck'

describe('tagDate', () => {
  it('parses the timestamp out of a build tag', () => {
    expect(tagDate('v0.1.1 · 2026-07-29 20:47 · f114d53')).toBe(Date.parse('2026-07-29T20:47:00'))
  })
  it('returns null when no timestamp is present', () => {
    expect(tagDate('v0.1.1')).toBeNull()
    expect(tagDate('')).toBeNull()
    expect(tagDate('garbage')).toBeNull()
  })
})

describe('isNewer', () => {
  const local = 'v0.1.1 · 2026-07-29 20:47 · f114d53'
  it('true when the remote build is meaningfully newer', () => {
    expect(isNewer(local, 'v0.1.1 · 2026-07-29 21:30 · abc1234')).toBe(true)
    expect(isNewer(local, 'v0.1.2 · 2026-08-01 09:00 · abc1234')).toBe(true)
  })
  it('false for the same build even when stamps differ by seconds-to-minutes', () => {
    expect(isNewer(local, 'v0.1.1 · 2026-07-29 20:47 · f114d53')).toBe(false)
    // ship stamp vs self-stamp of the SAME build can drift a minute or two
    expect(isNewer(local, 'v0.1.1 · 2026-07-29 20:49 · f114d53')).toBe(false)
  })
  it('false when the remote is older', () => {
    expect(isNewer(local, 'v0.1.1 · 2026-07-29 18:50 · ae3dc40')).toBe(false)
  })
  it('false when either tag is unparseable (never nag on bad data)', () => {
    expect(isNewer('junk', 'v0.1.1 · 2026-07-29 21:30 · abc1234')).toBe(false)
    expect(isNewer(local, 'junk')).toBe(false)
  })
})
