/**
 * Turns a script/topic into 2-3 music mood-or-genre keywords to search Pixabay with.
 *
 * The AI does this when it can, but it is not allowed to be a hard dependency: the
 * whole point of the free music feature is that it works without a paid key, and the
 * free AI service is exactly the thing that has proved unreliable. So there is a plain
 * keyword-matching fallback that needs no AI at all.
 */

/** Moods the fallback can recognise, each with the words that suggest it. */
const SIGNALS: { mood: string; words: string[] }[] = [
  { mood: 'tense', words: ['crash', 'crisis', 'risk', 'danger', 'warning', 'loss', 'debt', 'fraud', 'scam', 'collapse', 'default', 'panic'] },
  { mood: 'uplifting', words: ['growth', 'profit', 'success', 'win', 'gain', 'rally', 'boom', 'opportunity', 'rise', 'surge'] },
  { mood: 'corporate', words: ['business', 'company', 'market', 'invest', 'stock', 'bank', 'finance', 'economy', 'report', 'earnings'] },
  { mood: 'inspiring', words: ['future', 'dream', 'journey', 'change', 'build', 'start', 'vision', 'goal'] },
  { mood: 'documentary', words: ['history', 'story', 'explain', 'analysis', 'truth', 'behind', 'why', 'how'] },
  { mood: 'calm', words: ['guide', 'learn', 'simple', 'basics', 'beginner', 'save', 'plan', 'steady'] }
]

/** Always-safe defaults when nothing matches — pleasant under almost any narration. */
const DEFAULT_MOODS = ['calm', 'corporate', 'ambient']

/** Keeps the AI (or a caller) from handing the search a sentence instead of a keyword. */
export function normalizeMoods(raw: string[]): string[] {
  const out: string[] = []
  for (const item of raw) {
    const clean = item
      .toLowerCase()
      .replace(/[^a-z ]/g, ' ')
      .trim()
      .split(/\s+/)
      .slice(0, 2)
      .join(' ')
    if (clean && clean.length <= 24 && !out.includes(clean)) out.push(clean)
    if (out.length === 3) break
  }
  return out
}

/** Pure, AI-free mood guess from the words in the script. Always returns 2-3 keywords. */
export function moodsFromText(text: string): string[] {
  const hay = ` ${text.toLowerCase().replace(/[^a-z ]/g, ' ')} `
  const scored = SIGNALS.map((s) => ({
    mood: s.mood,
    score: s.words.reduce((n, w) => n + (hay.includes(` ${w}`) ? 1 : 0), 0)
  }))
    .filter((s) => s.score > 0)
    .sort((a, b) => b.score - a.score)
  const picked = scored.slice(0, 3).map((s) => s.mood)
  // Always hand back at least two keywords so the search has something to widen with.
  for (const d of DEFAULT_MOODS) {
    if (picked.length >= 2) break
    if (!picked.includes(d)) picked.push(d)
  }
  return picked
}

export const MOOD_PROMPT_HINT =
  'Reply with ONLY 2-3 comma-separated music mood or genre keywords (one or two words each, ' +
  'e.g. "tense, dramatic" or "uplifting, corporate"). No sentences, no explanation.'

/** Parses whatever the AI replied into clean keywords, falling back to the text guess. */
export function parseMoodReply(reply: string, fallbackText: string): string[] {
  const parts = reply
    .split(/[,\n]/)
    .map((s) => s.trim())
    .filter(Boolean)
  const moods = normalizeMoods(parts)
  return moods.length >= 2 ? moods : moodsFromText(fallbackText)
}
