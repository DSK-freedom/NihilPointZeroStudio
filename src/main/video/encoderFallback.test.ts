import { beforeEach, describe, expect, it, vi } from 'vitest'

// Mock the ffmpeg runner so we can simulate a hardware encoder failing at runtime.
const runFfmpeg = vi.fn()
vi.mock('./ffmpeg', () => ({
  CANCELLED_MESSAGE: 'Render cancelled by user.',
  runFfmpeg: (...args: unknown[]) => runFfmpeg(...args)
}))

import { hardwareSupportsResolution, runEncodeWithFallback } from './encoder'

beforeEach(() => runFfmpeg.mockReset())

describe('hardwareSupportsResolution', () => {
  it('permits the CPU encoder at any resolution (incl. 8K)', () => {
    expect(hardwareSupportsResolution('libx264', 7680, 4320)).toBe(true)
  })
  it('permits hardware through 4K but rejects 8K (the crash case)', () => {
    expect(hardwareSupportsResolution('h264_qsv', 3840, 2160)).toBe(true)
    expect(hardwareSupportsResolution('h264_qsv', 7680, 4320)).toBe(false)
    expect(hardwareSupportsResolution('h264_nvenc', 4096, 4096)).toBe(true)
    expect(hardwareSupportsResolution('h264_nvenc', 4097, 2160)).toBe(false)
  })
})

describe('runEncodeWithFallback', () => {
  const build = (encArgs: string[]): string[] => ['-y', ...encArgs, 'out.mp4']

  it('retries on libx264 when a hardware encode fails, and notifies the user', async () => {
    runFfmpeg.mockRejectedValueOnce(
      new Error('some encoding parameters are not supported by the QSV runtime')
    )
    runFfmpeg.mockResolvedValueOnce(undefined)
    const notices: string[] = []
    const used = await runEncodeWithFallback('h264_qsv', build, { onNotice: (m) => notices.push(m) })
    expect(used).toBe('libx264')
    expect(runFfmpeg).toHaveBeenCalledTimes(2)
    expect(runFfmpeg.mock.calls[0][0]).toContain('h264_qsv') // first tried the GPU
    expect(runFfmpeg.mock.calls[1][0]).toContain('libx264') // retried on CPU
    expect(notices.join(' ')).toMatch(/CPU/)
  })

  it('does not retry when the CPU encoder itself fails', async () => {
    runFfmpeg.mockRejectedValueOnce(new Error('disk full'))
    await expect(runEncodeWithFallback('libx264', build)).rejects.toThrow('disk full')
    expect(runFfmpeg).toHaveBeenCalledTimes(1)
  })

  it('never retries a user cancellation', async () => {
    runFfmpeg.mockRejectedValueOnce(new Error('Render cancelled by user.'))
    await expect(runEncodeWithFallback('h264_nvenc', build)).rejects.toThrow('cancelled')
    expect(runFfmpeg).toHaveBeenCalledTimes(1)
  })

  it('uses the hardware encoder directly when it succeeds', async () => {
    runFfmpeg.mockResolvedValueOnce(undefined)
    const used = await runEncodeWithFallback('h264_nvenc', build)
    expect(used).toBe('h264_nvenc')
    expect(runFfmpeg).toHaveBeenCalledTimes(1)
  })
})
