import { describe, expect, it } from 'vitest'
import { buildSetMusicArgs } from './music'

describe('buildSetMusicArgs', () => {
  it('remove: keeps the video stream and uses ONLY the narration audio', () => {
    const args = buildSetMusicArgs({ mode: 'remove', videoPath: 'v.mp4', narrationPath: 'n.wav', outPath: 'o.mp4' })
    expect(args).toContain('v.mp4')
    expect(args).toContain('n.wav')
    // narration is input 1, mapped as the audio; video stream copied
    expect(args.join(' ')).toContain('-map 0:v:0 -map 1:a:0')
    expect(args.join(' ')).toContain('-c:v copy')
    expect(args).not.toContain('-stream_loop') // no music input
  })

  it('replace: loops the music, auto-ducks it under the voice, and mixes', () => {
    const args = buildSetMusicArgs({ mode: 'replace', videoPath: 'v.mp4', narrationPath: 'n.wav', musicPath: 'm.mp3', outPath: 'o.mp4' })
    expect(args).toContain('m.mp3')
    expect(args.join(' ')).toContain('-stream_loop -1')
    expect(args.join(' ')).toContain('sidechaincompress') // auto-duck under the narration
    expect(args.join(' ')).toContain('amix=inputs=2')
    expect(args.join(' ')).toContain('-map [aout]')
  })

  it('replace with no music path falls back to remove (never crashes)', () => {
    const args = buildSetMusicArgs({ mode: 'replace', videoPath: 'v.mp4', narrationPath: 'n.wav', outPath: 'o.mp4' })
    expect(args.join(' ')).toContain('-map 1:a:0')
    expect(args).not.toContain('-filter_complex')
  })
})
