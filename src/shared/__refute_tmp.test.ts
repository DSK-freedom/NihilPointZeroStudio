import { describe, it, expect } from 'vitest'
import { gapReport } from './competitorGap'
import { describeChannelProblem, type ChannelReadProblem } from './youtubeKeySetup'

// Reproduce the EXACT gaps-panel render gates from ChannelPage.tsx at HEAD.
function renderGapsPanel(gaps: any): string[] {
  const out: string[] = []
  const showRead = gaps && (!gaps.problem || gaps.problem.kind === 'partial')
  out.push(showRead ? `HEADLINE: ${gaps.headline}` : 'HEADLINE: <generic marketing blurb, no claim about the channel>')
  if (gaps?.problem) {
    const n = describeChannelProblem(gaps.problem)
    out.push(`NOTICE[${n.tone}]: ${n.title} — ${n.message}`)
  }
  if (showRead) out.push(`Compared ${gaps.myVideos} of your videos against ${gaps.competitorVideos} from other channels.`)
  if (gaps && gaps.gaps.length > 0) out.push(`GAP LIST: ${gaps.gaps.length}`)
  if (gaps && gaps.onlyMine.length > 0) out.push(`ONLY MINE: ${gaps.onlyMine.length}`)
  return out
}

describe('claim: gaps panel contradicts its own could-not-tell notice', () => {
  it('wi-fi drop (unreachable): no comparison is claimed', () => {
    // ipc.ts:1210-1211 short circuit for problem + no videos
    const problem: ChannelReadProblem = { kind: 'unreachable' }
    const result = { ...gapReport([], []), problem, myVideos: 0, competitorVideos: 0, queries: [] }
    const lines = renderGapsPanel(result)
    console.log('UNREACHABLE:\n' + lines.join('\n'))
    expect(lines.join('\n')).not.toContain('search a topic first')
    expect(lines.join('\n')).not.toContain('Compared 0 of your videos')
  })

  it('no key: same', () => {
    const problem: ChannelReadProblem = { kind: 'no-key' }
    const result = { ...gapReport([], []), problem, myVideos: 0, competitorVideos: 0, queries: [] }
    const lines = renderGapsPanel(result)
    console.log('NO-KEY:\n' + lines.join('\n'))
    expect(lines.join('\n')).not.toContain('Compared 0 of your videos')
  })

  it('what gapReport([],[]).headline actually is', () => {
    console.log('RAW HEADLINE:', JSON.stringify(gapReport([], []).headline))
  })
})
