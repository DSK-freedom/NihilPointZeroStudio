/**
 * "What changed" — the screen that tells you what is new in the build you are running.
 *
 * WHY THIS EXISTS
 * An old build looks exactly like a new one. The gold badge in the sidebar proves WHICH
 * build is running, but it cannot tell you what that build actually does differently.
 * So every upgrade so far has been invisible: work lands, the app looks identical, and
 * the only way to find a new feature is to be told about it in a chat message that
 * scrolls away.
 *
 * THE ONE RULE THIS MODULE MUST NEVER BREAK
 * It must never advertise something the running build does not have. That is the exact
 * failure mode of a hand-written changelog: the note ships before the code, the user
 * goes looking for the button, and the button is not there. So every entry carries the
 * date it shipped, and an entry dated after the running build's own timestamp is
 * WITHHELD — not shown greyed out, not shown as "coming soon". Withheld, and shown for
 * the first time in the build that really contains it.
 *
 * WHY "SEEN" IS TRACKED BY ENTRY, NOT BY DATE
 * This project ships several times a day. Remembering "the last build the user saw" and
 * showing entries newer than that date loses every change that shipped later on the same
 * day. Remembering which ENTRIES have been read is exact, survives multiple ships an
 * hour, and cannot drift.
 *
 * Pure and shared: the desktop window and the phone both read this same list, so the
 * "what changed" screen can never disagree between them.
 */

export interface ChangeEntry {
  /** Stable id, never reused and never renamed — this is what "already read" is keyed on. */
  id: string
  /** yyyy-mm-dd the change shipped. Used ONLY to withhold entries newer than the build. */
  date: string
  /** One line, the headline. Written the way the user would describe it. */
  title: string
  /** What it does for them and why they would care. Plain English, no jargon. */
  detail: string
  /** Where to find it in the app, so the entry ends in an action. */
  where: string
}

/**
 * Newest first. Written in the same plain voice as the shipped docs.
 *
 * Add an entry in the same commit as the change it describes, so the two can never come
 * apart. Never edit an existing id.
 */
export const CHANGELOG: ChangeEntry[] = [
  {
    id: 'whats-new-screen',
    date: '2026-08-01',
    title: 'A "What changed" screen',
    detail:
      'Every upgrade used to be invisible — the app looked identical afterwards. Now the new things in the build you are running are listed here, and only the ones that are really in it.',
    where: 'Settings → What changed'
  },
  {
    id: 'read-aloud',
    date: '2026-08-01',
    title: 'Hear your script read out at double speed',
    detail:
      'A script is spoken, not read, and reading it silently hides the faults that cost a retake — the sentence you cannot say in one breath, the number that is ambiguous out loud, the word repeated twice that the eye skips over. It reads the script to you at double speed and lists what to listen for, with the time each one happens.',
    where: 'Script Writer → Read it to me'
  },
  {
    id: 'series-linking',
    date: '2026-08-01',
    title: 'Your episodes linked to each other',
    detail:
      'It reads your own titles, works out which videos belong to the same series, tells you if a number is missing or used twice, and writes the description block, the pinned comment and the end-screen line for you. Reads Part, Episode, Hissa and Qist.',
    where: 'Your Channel → Get the links'
  },
  {
    id: 'channel-learning',
    date: '2026-08-01',
    title: 'The studio learns from YOUR channel, not from general advice',
    detail:
      'It reads your own past videos and works out which title shapes actually did better for you, and which day and hour your audience really shows up. It reports the number of videos behind every claim, and it refuses to answer at all until there is enough history to be honest.',
    where: 'Your Channel → Work it out'
  },
  {
    id: 'comment-mining',
    date: '2026-08-01',
    title: 'Video ideas pulled straight out of your comments',
    detail:
      'It reads your comments, finds the questions, groups the ones asking the same thing in English and Roman Urdu together, and ranks them by how many different people asked. Every question is quoted word for word from a real comment, so you can check it.',
    where: 'Your Channel → Read my comments'
  },
  {
    id: 'preflight',
    date: '2026-08-01',
    title: 'Problems caught in one second instead of twenty minutes',
    detail:
      'Before a render starts it checks the things that actually waste an hour: that ffmpeg really runs (not just that the file is there), that the work folder can be written to, that there is disk space, and which encoder you will get. It refuses only when the render genuinely cannot finish.',
    where: 'Runs automatically before every render'
  },
  {
    id: 'sources',
    date: '2026-08-01',
    title: 'Every figure traceable to a file and a row',
    detail:
      'Numbers that came out of a spreadsheet or PDF now carry where they came from, down to the row. If a figure in the script cannot be traced back to a source, it is flagged before you record it.',
    where: 'Script Writer → Where your numbers came from'
  },
  {
    id: 'pacing',
    date: '2026-08-01',
    title: 'Videos tighten toward the end instead of sagging',
    detail:
      'Scene lengths are planned so the last third moves faster than the first, which is where most finance videos lose people. The total length is preserved exactly, so the narration still lines up.',
    where: 'Automatic on every render'
  },
  {
    id: 'hook-rebuild',
    date: '2026-08-01',
    title: 'The first fifteen seconds rebuilt, from your own words',
    detail:
      'It offers five different openings for the script you already wrote — a contradiction, a number, a question, what is at stake, or dropping the viewer mid-scene — using only sentences from your script. Nothing is invented.',
    where: 'Script Writer → Rebuild the first fifteen seconds'
  },
  {
    id: 'chart-animation',
    date: '2026-08-01',
    title: 'Charts that draw themselves on screen',
    detail:
      'A line or bar chart now animates in as you talk over it, instead of appearing all at once as a flat picture.',
    where: 'Charts → Draw it on'
  },
  {
    id: 'broll-timing',
    date: '2026-08-01',
    title: 'B-roll that lands on the word it belongs to',
    detail:
      'When the script says "reserves" or "mehngai", the matching footage now appears on that word rather than somewhere near it. Works on English and Roman Urdu.',
    where: 'Automatic when stock footage is on'
  },
  {
    id: 'auto-zoom',
    date: '2026-08-01',
    title: 'Slow camera movement on every shot',
    detail:
      'Still footage no longer sits frozen. Each shot gets a slow push in or pull out, alternating so it never drifts in one direction, which is what makes a static clip look cheap.',
    where: 'Automatic on footage backgrounds'
  },
  {
    id: 'silence-removal',
    date: '2026-08-01',
    title: 'Cut the dead air out of a take',
    detail:
      'It tells you first what would be cut, then removes the long pauses where nothing is said, keeping a quarter-second of breath so it still sounds like a person talking. Picture and sound are cut together, so nothing goes out of sync. It makes a new video — your original is never touched.',
    where: 'Video Studio → Dead air → What would be cut?'
  },
  {
    id: 'youtube-loudness',
    date: '2026-08-01',
    title: 'Audio at the level YouTube actually wants',
    detail:
      'YouTube turns loud uploads down. Delivering at its own target instead means your video is not quietly turned down against everyone else.',
    where: 'Automatic on every render'
  },
  {
    id: 'one-pass-render',
    date: '2026-08-01',
    title: 'One render instead of four, so quality stops leaking',
    detail:
      'Colour, captions, watermark and trimming used to be four separate encodes, and every encode loses a little picture quality. They now happen in one pass.',
    where: 'Automatic on every render'
  },
  {
    id: 'repurpose',
    date: '2026-08-01',
    title: 'One script, every platform',
    detail:
      'From a finished script it writes the YouTube description with chapters, a community post, an X thread inside the character limit, a LinkedIn post and a WhatsApp broadcast — each in that platform\'s own shape, not the same text pasted five times.',
    where: 'Writer → Repurpose'
  },
  {
    id: 'ai-timeouts',
    date: '2026-08-01',
    title: 'An AI outage can no longer hang the app',
    detail:
      'When a provider stops answering, the wait is now bounded and it moves to the next brain instead of sitting there. The app also tells you which brain answered.',
    where: 'Automatic; the brain used is shown with the answer'
  },
  {
    id: 'phone-studio',
    date: '2026-08-01',
    title: 'The whole studio on your phone',
    detail:
      'Not a cut-down mobile version — the same screens, with your laptop doing the work. Anything added to the app appears on the phone too, automatically.',
    where: 'Settings → Phone, scan the QR code'
  },
  {
    id: 'phone-version-stamp',
    date: '2026-08-01',
    title: 'The phone can no longer get stuck on an old version',
    detail:
      'A phone keeps a copy of the app on the handset, so publishing a new one used to leave the old one running. Now the old copy is deleted and the page reloads itself once, and the version it is running is printed on the Settings screen.',
    where: 'Phone → Settings, bottom of the screen'
  }
]

/** How many entries a first run shows before it starts counting the rest. */
export const FIRST_RUN_MAX = 12

/**
 * The date+time out of a build tag like "v0.1.1 · 2026-08-01 04:30 · 3354ec9".
 * Null when the tag carries no timestamp — in which case nothing is claimed.
 */
export function tagStamp(tag: string): number | null {
  const m = /(\d{4}-\d{2}-\d{2}) (\d{2}):(\d{2})/.exec(tag ?? '')
  if (!m) return null
  const t = Date.parse(`${m[1]}T${m[2]}:${m[3]}:00`)
  return Number.isNaN(t) ? null : t
}

/** The yyyy-mm-dd out of a build tag, or null. */
export function tagDay(tag: string): string | null {
  return /(\d{4}-\d{2}-\d{2})/.exec(tag ?? '')?.[1] ?? null
}

/**
 * The entries that are genuinely IN this build.
 *
 * Compared at day granularity, and inclusive of the build's own day: an entry is written
 * in the same commit as its change, so a change that shipped this morning is in a build
 * stamped this afternoon. An entry dated tomorrow is not in today's build and is
 * withheld — that is the whole point of the check.
 */
export function entriesInBuild(buildTag: string, log: ChangeEntry[] = CHANGELOG): ChangeEntry[] {
  const day = tagDay(buildTag)
  const entries = (log ?? []).filter((e) => e && typeof e.id === 'string' && typeof e.date === 'string')
  // Without a readable build date there is no way to know what is in this build, so
  // nothing is claimed. Silence is the honest answer; a guess is not.
  if (!day) return []
  return entries.filter((e) => e.date <= day)
}

export interface WhatsNewReport {
  /** Unread entries that really are in this build, newest first. */
  entries: ChangeEntry[]
  /** True when nothing has ever been marked read — the first time the screen is opened. */
  firstRun: boolean
  /** One line for the top of the screen. */
  headline: string
  /** How many to show before "and N more" — the UI may collapse past this. */
  showAtMost: number
  /** The ids to remember once the user has seen the screen. */
  rememberIds: string[]
  /** The build the report describes, echoed back so the screen can show it. */
  buildTag: string
}

/**
 * What is new in the running build that this user has not read yet.
 *
 * `seenIds` is whatever was stored last time. An unknown id in it is ignored rather than
 * treated as an error, so an entry can be removed from the changelog without breaking
 * anyone's stored state.
 */
export function whatsNewReport(input: {
  buildTag: string
  seenIds?: string[] | null
  log?: ChangeEntry[]
}): WhatsNewReport {
  const log = input.log ?? CHANGELOG
  const inBuild = entriesInBuild(input.buildTag, log)
  const seen = new Set((input.seenIds ?? []).filter((x) => typeof x === 'string'))
  const firstRun = !input.seenIds || input.seenIds.length === 0
  const entries = inBuild.filter((e) => !seen.has(e.id))

  let headline: string
  if (!tagDay(input.buildTag)) {
    headline = 'Cannot tell which build this is, so nothing is claimed about what changed in it.'
  } else if (!entries.length) {
    headline = 'Nothing new since you last looked. You are up to date with this build.'
  } else if (firstRun) {
    headline = `${entries.length} thing${entries.length === 1 ? '' : 's'} in this build you have not seen yet.`
  } else {
    headline = `${entries.length} new thing${entries.length === 1 ? '' : 's'} since you last looked.`
  }

  return {
    entries,
    firstRun,
    headline,
    showAtMost: firstRun ? FIRST_RUN_MAX : entries.length,
    // Everything in the build is remembered, not just what fitted on screen: the list is
    // expandable, and re-announcing an entry the user already scrolled past is noise.
    rememberIds: inBuild.map((e) => e.id),
    buildTag: input.buildTag
  }
}

/**
 * True when there is something worth putting a dot on the Settings link for.
 *
 * Kept separate from the report so the sidebar can ask the cheap question without
 * building the whole thing.
 */
export function hasUnread(buildTag: string, seenIds?: string[] | null, log: ChangeEntry[] = CHANGELOG): boolean {
  return whatsNewReport({ buildTag, seenIds, log }).entries.length > 0
}

/** Groups entries by the day they shipped, newest day first — how the screen reads best. */
export function groupByDay(entries: ChangeEntry[]): { date: string; entries: ChangeEntry[] }[] {
  const byDay = new Map<string, ChangeEntry[]>()
  for (const e of entries ?? []) {
    const arr = byDay.get(e.date)
    if (arr) arr.push(e)
    else byDay.set(e.date, [e])
  }
  return [...byDay.entries()]
    .map(([date, list]) => ({ date, entries: list }))
    .sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0))
}
