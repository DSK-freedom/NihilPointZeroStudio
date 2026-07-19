import { describe, expect, it } from 'vitest'
import { rankTracks } from './freeMusic'
import type { FreeTrack } from '../../shared/types'

function track(over: Partial<FreeTrack>): FreeTrack {
  return { id: over.id ?? 'x', title: 'Untitled', artist: 'Unknown', license: 'BY', ...over }
}

describe('rankTracks', () => {
  it('ranks keyword matches in the title above non-matches', () => {
    const tracks = [
      track({ id: 'a', title: 'Rainy Day Jazz' }),
      track({ id: 'b', title: 'Epic Cinematic Trailer' })
    ]
    const ranked = rankTracks('cinematic trailer', tracks)
    expect(ranked[0].id).toBe('b')
  })

  it('rewards permissive licenses and usable audio URLs', () => {
    const tracks = [
      track({ id: 'by', title: 'Song', license: 'BY-NC' }),
      track({ id: 'cc0', title: 'Song', license: 'CC0', audioUrl: 'http://x/a.mp3' })
    ]
    const ranked = rankTracks('song', tracks)
    expect(ranked[0].id).toBe('cc0')
  })

  it('is a stable sort for equal scores (original order preserved)', () => {
    const tracks = [track({ id: '1', title: 'zzz' }), track({ id: '2', title: 'zzz' })]
    const ranked = rankTracks('nomatch', tracks)
    expect(ranked.map((t) => t.id)).toEqual(['1', '2'])
  })

  it('does not mutate the input array', () => {
    const tracks = [track({ id: '1', title: 'a' }), track({ id: '2', title: 'match' })]
    const before = tracks.map((t) => t.id)
    rankTracks('match', tracks)
    expect(tracks.map((t) => t.id)).toEqual(before)
  })
})
