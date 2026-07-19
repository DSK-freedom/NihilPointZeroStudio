import { describe, it, expect } from 'vitest'
import { extractCards, computeLayout, dimensionsFor, buildAudioFilter, buildFfmpegArgs } from './render'

describe('computeLayout', () => {
  it('1080p is 1920x1080 with base sizes', () => {
    const l = computeLayout('1080p')
    expect([l.w, l.h]).toEqual([1920, 1080])
    expect(l.titleFont).toBe(56)
    expect(l.cardFont).toBe(72)
  })
  it('4k is exactly double 1080p (same layout, sharper)', () => {
    const l = computeLayout('4k')
    expect([l.w, l.h]).toEqual([3840, 2160])
    expect(l.titleFont).toBe(112)
    expect(l.waveW).toBe(3840)
  })
  it('8k is 7680x4320 (4x)', () => {
    const l = computeLayout('8k')
    expect([l.w, l.h]).toEqual([7680, 4320])
    expect(l.titleFont).toBe(224)
  })
  it('1440p is 2560x1440', () => {
    expect(computeLayout('1440p').w).toBe(2560)
  })
  it('defaults to 1080p', () => {
    expect(computeLayout().w).toBe(1920)
  })
})

describe('dimensionsFor (aspect ratios)', () => {
  it('16:9 is unchanged (landscape) across tiers', () => {
    expect(dimensionsFor('1080p', '16:9')).toEqual([1920, 1080])
    expect(dimensionsFor('4k', '16:9')).toEqual([3840, 2160])
    expect(dimensionsFor('8k', '16:9')).toEqual([7680, 4320])
  })
  it('9:16 is vertical (Shorts/Reels): tall, short side = tier', () => {
    expect(dimensionsFor('1080p', '9:16')).toEqual([1080, 1920])
    expect(dimensionsFor('4k', '9:16')).toEqual([2160, 3840])
  })
  it('1:1 is square', () => {
    expect(dimensionsFor('1080p', '1:1')).toEqual([1080, 1080])
    expect(dimensionsFor('4k', '1:1')).toEqual([2160, 2160])
  })
  it('font scaling is consistent (short side) across shapes at the same tier', () => {
    // Vertical 1080p and landscape 1080p share the short side (1080) → same font sizes.
    expect(computeLayout('1080p', '9:16').titleFont).toBe(computeLayout('1080p', '16:9').titleFont)
    expect(computeLayout('1080p', '1:1').titleFont).toBe(56)
  })
})

describe('buildAudioFilter', () => {
  const layout = computeLayout('1080p')
  it('narration only: maps the input stream directly, just the waveform', () => {
    const a = buildAudioFilter({ hasMusic: false, sfxTimesSec: [], dur: 10, layout })
    expect(a.audioMap).toBe('1:a')
    expect(a.chains.join(';')).toContain('showwaves')
    expect(a.chains.join(';')).not.toContain('amix')
    expect(a.extraInputs).toEqual([])
  })
  it('with music: splits narration, lowers + fades music, mixes with normalize=0', () => {
    const a = buildAudioFilter({ hasMusic: true, sfxTimesSec: [], dur: 30, layout })
    expect(a.audioMap).toBe('[aout]')
    const f = a.chains.join(';')
    expect(f).toContain('asplit=2[awave][anarr]') // narration used twice → must split
    expect(f).toContain('volume=0.18') // music ducked under narration
    expect(f).toContain('afade=t=in') // smart placement: fades in…
    expect(f).toContain('afade=t=out') // …and out
    expect(f).toContain('amix=inputs=2:duration=first:normalize=0') // narration stays full
    expect(a.extraInputs).toEqual(['music'])
  })
  it('with SFX: one delayed whoosh per transition, mixed in order', () => {
    const a = buildAudioFilter({ hasMusic: true, sfxTimesSec: [5, 10, 15], dur: 20, layout })
    const f = a.chains.join(';')
    expect(f).toContain('adelay=5000:all=1') // first transition at 5s
    expect(f).toContain('adelay=15000:all=1') // third at 15s
    expect(f).toContain('amix=inputs=5') // narration + music + 3 sfx
    expect(a.extraInputs).toEqual(['music', 'sfx', 'sfx', 'sfx'])
  })
})

describe('buildFfmpegArgs', () => {
  const layout8k = computeLayout('8k')
  const base = { layout: layout8k, dur: 5, audioPath: 'n.wav', sfxCount: 0, filter: '[x]null[y]', videoMap: '[y]', outPath: 'out.mp4' }
  it('encodes the requested resolution (8K) into the color source', () => {
    const args = buildFfmpegArgs({ ...base, audioMap: '1:a' })
    expect(args.join(' ')).toContain('s=7680x4320')
    expect(args).toContain('+faststart') // YouTube-friendly
  })
  it('adds a looped music input only when musicPath is given', () => {
    const without = buildFfmpegArgs({ ...base, audioMap: '1:a' })
    expect(without).not.toContain('-stream_loop')
    const withMusic = buildFfmpegArgs({ ...base, musicPath: 'song.mp3', audioMap: '[aout]' })
    expect(withMusic.join(' ')).toContain('-stream_loop -1 -i song.mp3')
  })
  it('adds one whoosh input per SFX cue', () => {
    const args = buildFfmpegArgs({ ...base, sfxCount: 3, whooshPath: 'wh.wav', audioMap: '[aout]' })
    const inputCount = args.filter((a, i) => a === '-i' && args[i + 1] === 'wh.wav').length
    expect(inputCount).toBe(3)
  })
})

describe('extractCards', () => {
  it('pulls bracketed stage directions / section titles from the script', () => {
    const body = '[PATTERN INTERRUPT]\nHook line\n[BLUF]\nBottom line\n[TAKEAWAY]\nWrap'
    expect(extractCards(body, 'My Title')).toEqual(['PATTERN INTERRUPT', 'BLUF', 'TAKEAWAY'])
  })
  it('dedupes repeated labels', () => {
    const body = '[EVIDENCE]\na\n[EVIDENCE]\nb\n[COUNTERPOINT]\nc'
    expect(extractCards(body, 'T')).toEqual(['EVIDENCE', 'COUNTERPOINT'])
  })
  it('falls back to generic cards for very short prose', () => {
    const cards = extractCards('just prose with no headers', 'Rupee Devaluation')
    expect(cards.length).toBeGreaterThanOrEqual(2)
    expect(cards[0]).toContain('Rupee')
  })
  it('derives MANY scenes from a normal (bracket-less) script so videos are not static', () => {
    const body = Array.from({ length: 9 }, (_, i) =>
      `Sentence number ${i} explains an important point about the economy in detail here.`
    ).join(' ')
    const cards = extractCards(body, 'Economy')
    expect(cards.length).toBeGreaterThanOrEqual(4) // no longer just 3 static cards
  })
  it('scales scene count UP for a long script (a 25-min-style script gets many sections)', () => {
    // ~80 sentences of real prose → should yield far more than the old cap of 10.
    const body = Array.from({ length: 80 }, (_, i) =>
      `Point number ${i} discusses copper gold and molybdenum demand across the mineral supercycle in real detail.`
    ).join(' ')
    const cards = extractCards(body, 'Supercycle')
    expect(cards.length).toBeGreaterThan(20)
    expect(cards.length).toBeLessThanOrEqual(40)
  })
})
