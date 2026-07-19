import { describe, it, expect, beforeEach } from 'vitest'
import {
  beginRenderSession,
  cancelActiveFfmpeg,
  isCancelRequested,
  throwIfCancelled,
  CANCELLED_MESSAGE
} from './ffmpeg'

/**
 * The Stop button used to only kill the running ffmpeg process, so pressing it during
 * the pre-render stages (TTS, per-scene AI image downloads) did nothing — those loops
 * kept running. The sticky cancel flag + throwIfCancelled() poll fixes that. These tests
 * pin that contract without spawning any real ffmpeg.
 */
describe('render cancellation flag', () => {
  beforeEach(() => beginRenderSession())

  it('starts un-cancelled after beginRenderSession()', () => {
    expect(isCancelRequested()).toBe(false)
    expect(() => throwIfCancelled()).not.toThrow()
  })

  it('cancelActiveFfmpeg sets the sticky flag even when no ffmpeg is running', () => {
    // No live processes → returns 0, but the flag must still latch so the next poll stops.
    expect(cancelActiveFfmpeg()).toBe(0)
    expect(isCancelRequested()).toBe(true)
    expect(() => throwIfCancelled()).toThrow(CANCELLED_MESSAGE)
  })

  it('beginRenderSession clears a Stop from a previous build', () => {
    cancelActiveFfmpeg()
    expect(isCancelRequested()).toBe(true)
    beginRenderSession()
    expect(isCancelRequested()).toBe(false)
    expect(() => throwIfCancelled()).not.toThrow()
  })
})
