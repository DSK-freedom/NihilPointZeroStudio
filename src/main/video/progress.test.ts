import { describe, expect, it } from 'vitest'
import { makeFfmpegProgressLogger } from './ffmpeg'

const TIME_LINE = (t: string): string =>
  `frame=  120 fps= 30 q=28.0 size=     512KiB time=${t} bitrate=1048.6kbits/s speed=1.2x`

describe('makeFfmpegProgressLogger', () => {
  it('turns ffmpeg time= lines into deduped percentage messages', () => {
    const msgs: string[] = []
    const log = makeFfmpegProgressLogger(80, (m) => msgs.push(m))
    log(TIME_LINE('00:00:08.00')) // 10%
    log(TIME_LINE('00:00:08.20')) // rounds to 10% again — deduped
    log(TIME_LINE('00:00:40.00')) // 50%
    expect(msgs).toEqual(['Rendering 10% (0:08 / 1:20)', 'Rendering 50% (0:40 / 1:20)'])
  })

  it('caps at 99% (completion is announced by the caller)', () => {
    const msgs: string[] = []
    const log = makeFfmpegProgressLogger(10, (m) => msgs.push(m))
    log(TIME_LINE('00:00:15.00')) // past the expected total
    expect(msgs).toEqual(['Rendering 99% (0:15 / 0:10)'])
  })

  it('stays silent when the total duration is unknown', () => {
    const msgs: string[] = []
    const log = makeFfmpegProgressLogger(0, (m) => msgs.push(m))
    log(TIME_LINE('00:00:05.00'))
    expect(msgs).toEqual([])
  })

  it('ignores non-progress lines but still forwards every raw line', () => {
    const msgs: string[] = []
    const raw: string[] = []
    const log = makeFfmpegProgressLogger(60, (m) => msgs.push(m), (l) => raw.push(l))
    log('Stream mapping:')
    log(TIME_LINE('00:00:30.00'))
    expect(msgs).toEqual(['Rendering 50% (0:30 / 1:00)'])
    expect(raw).toHaveLength(2)
  })

  it('supports a custom label', () => {
    const msgs: string[] = []
    const log = makeFfmpegProgressLogger(60, (m) => msgs.push(m), undefined, 'Stitching')
    log(TIME_LINE('00:00:30.00'))
    expect(msgs).toEqual(['Stitching 50% (0:30 / 1:00)'])
  })

  it('handles hour-scale timestamps', () => {
    const msgs: string[] = []
    const log = makeFfmpegProgressLogger(7200, (m) => msgs.push(m))
    log(TIME_LINE('01:00:00.00'))
    expect(msgs).toEqual(['Rendering 50% (60:00 / 120:00)'])
  })
})
