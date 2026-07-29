import { describe, expect, it } from 'vitest'
import { BACKUP_ALLOWLIST, BACKUP_DENYLIST, backupIsDue, isBackupCandidate } from './autoBackup'

const NOW = Date.parse('2026-07-30T12:00:00Z')
const daysAgo = (n: number): string => new Date(NOW - n * 24 * 60 * 60 * 1000).toISOString()

describe('backupIsDue', () => {
  it('is due when no backup has ever run', () => {
    expect(backupIsDue(NOW, undefined)).toBe(true)
  })
  it('is due after 7 days', () => {
    expect(backupIsDue(NOW, daysAgo(7))).toBe(true)
    expect(backupIsDue(NOW, daysAgo(30))).toBe(true)
  })
  it('is NOT due before 7 days (no backup storms on every launch)', () => {
    expect(backupIsDue(NOW, daysAgo(0))).toBe(false)
    expect(backupIsDue(NOW, daysAgo(6))).toBe(false)
  })
  it('is due when the stamp is corrupt (fail safe: back up rather than skip)', () => {
    expect(backupIsDue(NOW, 'not-a-date')).toBe(true)
    expect(backupIsDue(NOW, '')).toBe(true)
  })
})

describe('isBackupCandidate — secrets must never be copied', () => {
  it('copies the user work folders/files', () => {
    expect(isBackupCandidate('videos', true)).toBe(true)
    expect(isBackupCandidate('library.json', true)).toBe(true)
    expect(isBackupCandidate('drafts.json', true)).toBe(true)
  })
  it('NEVER copies files holding API keys', () => {
    expect(isBackupCandidate('settings.json', true)).toBe(false)
    expect(isBackupCandidate('stock.json', true)).toBe(false)
    // also blocked deeper in the tree, not just at the top
    expect(isBackupCandidate('settings.json', false)).toBe(false)
    expect(isBackupCandidate('stock.json', false)).toBe(false)
  })
  it('NEVER copies Chromium profile / credential state', () => {
    for (const n of ['Local State', 'Cookies', 'Network', 'Local Storage', 'Session Storage', 'Preferences']) {
      expect(isBackupCandidate(n, true)).toBe(false)
      expect(isBackupCandidate(n, false)).toBe(false)
    }
  })
  it('skips caches, temp files and the backup folder itself (no nesting)', () => {
    expect(isBackupCandidate('Cache', true)).toBe(false)
    expect(isBackupCandidate('GPUCache', false)).toBe(false)
    expect(isBackupCandidate('half-written.tmp', false)).toBe(false)
    expect(isBackupCandidate('NihilPointZero-Backups', false)).toBe(false)
  })
  it('ignores unknown items at the top level, but keeps children inside allowed folders', () => {
    expect(isBackupCandidate('something-new.json', true)).toBe(false)
    expect(isBackupCandidate('my-video.mp4', false)).toBe(true)
  })
  it('has no overlap between the allow and deny lists', () => {
    expect(BACKUP_ALLOWLIST.filter((a) => BACKUP_DENYLIST.includes(a))).toEqual([])
  })
})
