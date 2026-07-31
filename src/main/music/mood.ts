/**
 * Turns a script/topic into 2-3 music mood-or-genre keywords to search Pixabay with.
 *
 * The AI does this when it can, but it is not allowed to be a hard dependency: the
 * whole point of the free music feature is that it works without a paid key, and the
 * free AI service is exactly the thing that has proved unreliable. So there is a plain
 * keyword-matching fallback that needs no AI at all.
 */

/** Moods the fallback can recognise, each with the words that suggest it. The app is
 * bilingual, so every mood also carries Roman Urdu spellings AND Urdu-script words —
 * a script written in Urdu must land on the same music as its English twin. */
const SIGNALS: { mood: string; words: string[] }[] = [
  {
    mood: 'tense',
    words: [
      'crash', 'crisis', 'risk', 'danger', 'warning', 'loss', 'debt', 'fraud', 'scam', 'collapse', 'default', 'panic',
      // Roman Urdu
      'nuqsan', 'nuqsaan', 'khatra', 'khatray', 'girawat', 'dhoka', 'bohran', 'buhran', 'qarza', 'qarz', 'tabahi',
      // Urdu script
      'نقصان', 'خطرہ', 'گراوٹ', 'دھوکہ', 'بحران', 'قرضہ', 'تباہی'
    ]
  },
  {
    mood: 'uplifting',
    words: [
      'growth', 'profit', 'success', 'win', 'gain', 'rally', 'boom', 'opportunity', 'rise', 'surge',
      'munafa', 'munafe', 'taraqqi', 'kamyabi', 'izafa', 'faida', 'mauqa',
      'منافع', 'ترقی', 'کامیابی', 'اضافہ', 'فائدہ', 'موقع'
    ]
  },
  {
    mood: 'corporate',
    words: [
      'business', 'company', 'market', 'invest', 'stock', 'bank', 'finance', 'economy', 'report', 'earnings',
      'karobar', 'sarmaya', 'sarmayakari', 'mandi', 'maeeshat', 'maishat', 'paisa', 'bank',
      'کاروبار', 'سرمایہ', 'منڈی', 'معیشت', 'پیسہ', 'بینک'
    ]
  },
  {
    mood: 'inspiring',
    words: [
      'future', 'dream', 'journey', 'change', 'build', 'start', 'vision', 'goal',
      'mustaqbil', 'khwab', 'safar', 'tabdeeli', 'manzil',
      'مستقبل', 'خواب', 'سفر', 'تبدیلی', 'منزل'
    ]
  },
  {
    mood: 'documentary',
    words: [
      'history', 'story', 'explain', 'analysis', 'truth', 'behind', 'why', 'how',
      'tareekh', 'kahani', 'wajah', 'tajzia', 'haqeeqat', 'sach',
      'تاریخ', 'کہانی', 'وجہ', 'تجزیہ', 'حقیقت', 'سچ'
    ]
  },
  {
    mood: 'calm',
    words: [
      'guide', 'learn', 'simple', 'basics', 'beginner', 'save', 'plan', 'steady',
      'asaan', 'bachat', 'mansuba', 'seekh', 'seekhna',
      'آسان', 'بچت', 'منصوبہ', 'سیکھ'
    ]
  }
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

/** Pure, AI-free mood guess from the words in the script. Always returns 2-3 keywords.
 * Normalization keeps Arabic-script characters — stripping them (the old behavior)
 * made every Urdu-script script fall through to the generic defaults. */
export function moodsFromText(text: string): string[] {
  const hay = ` ${text.toLowerCase().replace(/[^a-z؀-ۿ ]/g, ' ')} `
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

/**
 * Direct category links into the FREE music libraries for the detected moods —
 * the "where do I find more of this exact vibe" routing. Pure + tested; the UI
 * opens these in the system browser (nothing is scraped or automated).
 */
export function freeLibraryLinks(moods: string[]): { name: string; url: string }[] {
  const links: { name: string; url: string }[] = []
  for (const mood of moods.slice(0, 2)) {
    const q = encodeURIComponent(mood)
    links.push({ name: `Pixabay Music: ${mood}`, url: `https://pixabay.com/music/search/${q}/` })
    links.push({ name: `Free Music Archive: ${mood}`, url: `https://freemusicarchive.org/search?quicksearch=${q}` })
  }
  return links
}

/** The built-in synthesizer's moods (shared/types Mood) that each keyword maps to,
 * so "make music" follows the subject too. Unknown keywords land on 'corporate' —
 * the safest bed under financial narration. Pure + tested. */
const SYNTH_MOOD: Record<string, 'calm' | 'uplifting' | 'tense' | 'lofi' | 'corporate' | 'cinematic'> = {
  tense: 'tense',
  uplifting: 'uplifting',
  corporate: 'corporate',
  inspiring: 'uplifting',
  documentary: 'cinematic',
  calm: 'calm',
  ambient: 'calm',
  lofi: 'lofi',
  cinematic: 'cinematic'
}

export function synthMoodFromText(text: string): 'calm' | 'uplifting' | 'tense' | 'lofi' | 'corporate' | 'cinematic' {
  return SYNTH_MOOD[moodsFromText(text)[0]] ?? 'corporate'
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
