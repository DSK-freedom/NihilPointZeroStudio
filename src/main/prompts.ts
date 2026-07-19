import type { IdeaGenRequest, ScriptGenRequest, ScriptStyle, TrendTopic, YouTubeSignal } from '../shared/types'

const STYLE_GUIDE: Record<ScriptStyle, string> = {
  standard: 'Standard: a clean, balanced explainer — clear and professional, no extremes.',
  'deep-dive': 'Deep Dive: go several layers deeper than surface commentary — trace second- and third-order effects and mechanisms.',
  masterclass: 'Masterclass: teach it like a structured lesson — define terms, build concepts step by step, so a motivated beginner can follow an expert-level argument.',
  'institutional-framework': 'Institutional Framework: frame the analysis the way a research desk would — thesis, drivers, risks, scenarios, and what would invalidate the view.',
  'financial-research': 'Financial Research: write like a sell-side/buy-side research note — data-led, sourced reasoning, measured tone, explicit assumptions.',
  'technical-charting': 'Technical Charting: emphasize price action, levels, trends, momentum and chart structure; describe what the technicals imply (using only provided/verified figures for specifics).',
  'fundamental-deep-dive': 'Fundamental Deep Dive: focus on fundamentals — earnings, ratios, growth, balance-sheet health, valuation drivers (using only provided/verified figures for specifics).',
  infotainment: 'Infotainment: keep it rigorous but genuinely entertaining — vivid analogies, momentum, personality, without dumbing down the substance.',
  normal: 'Normal: a natural, conversational register — how a smart friend who happens to be a finance pro would explain it.',
  hooking: 'Hooking: maximize retention aggressively — stack curiosity gaps, open loops, and mini-cliffhangers between sections to pull the viewer through.'
}

function buildStyleBlock(styles?: ScriptStyle[]): string {
  if (!styles || !styles.length) return ''
  const directives = styles.map((s) => `- ${STYLE_GUIDE[s]}`).join('\n')
  return `\nApply and BLEND the following stylistic modes simultaneously (they combine — honor all of them):\n${directives}\n`
}

const NICHE_CONTEXT = `You are a senior content strategist and financial journalist working with a YouTube channel that covers finance and economics for a Pakistani / South Asian audience. Scripts are delivered in natural, code-switched Roman Urdu and English, the way a well-educated Pakistani finance professional actually speaks (e.g. "aaj hum baat karain ge Pakistan ke current account deficit ke baare mein, aur why it matters for the average investor"). The channel's positioning is institutional-grade: accurate, sourced in its reasoning, structured like a research note or a Bloomberg/FT explainer — never clickbait-empty, never financial-advice-illegal ("buy this stock now"), always framed as analysis and education.`

export function buildTrendPrompt(focusArea: string, count: number): string {
  return `${NICHE_CONTEXT}

Task: Based on your general knowledge of recurring and currently unfolding themes in finance and economics (global and Pakistan/South Asia-specific), list ${count} topic clusters that are likely to have strong search and watch interest right now for a YouTube channel in this niche, focused on: "${focusArea || 'general finance & economics'}".

Be explicit that this is reasoned estimation, not live search data. Favor topics with: real financial stakes for ordinary viewers, an news hook or recurring seasonal pattern (budget season, tax season, Fed/SBP rate decisions, Ramadan spending, etc.), and a clear reason someone would click today rather than skip.

Respond ONLY with a JSON array, no prose, no markdown fences, matching this shape:
[{"topic": string, "why": string, "momentum": "rising" | "steady" | "seasonal"}]`
}

function formatViews(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M views`
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K views`
  return `${n} views`
}

export function buildIdeaPrompt(req: IdeaGenRequest, trends: TrendTopic[], ytSignals: YouTubeSignal[] = []): string {
  const trendBlock = trends.length
    ? `Here are candidate trend signals to draw from (you may combine, reject, or go beyond them if you have a stronger idea):\n${trends
        .map((t) => `- ${t.topic} (${t.momentum}): ${t.why}`)
        .join('\n')}`
    : 'No external trend data was supplied — rely on your own judgment of what performs well in this niche.'

  const ytBlock = ytSignals.length
    ? `\nHere are REAL existing YouTube videos currently ranking for this topic (via YouTube Data API, actual view counts) — use this to gauge genuine saturation and to find an angle that isn't already done to death:\n${ytSignals
        .map((s) => `- "${s.title}" — ${s.channelTitle} — ${formatViews(s.viewCount)} — published ${s.publishedAt.slice(0, 10)}`)
        .join('\n')}\nCalibrate competitionLevel and viewPotentialReason against this real data, not guesses.`
    : ''

  return `${NICHE_CONTEXT}

Task: Generate ${req.count} distinct YouTube video ideas for the focus area: "${req.focusArea}".
${req.audienceNote ? `Audience note: ${req.audienceNote}` : ''}

${trendBlock}
${ytBlock}

For each idea, think like a YouTube strategist scoring for view potential: curiosity gap in the title, timeliness, search intent, emotional stakes (fear/greed/status/security), and how saturated the angle already is on YouTube.

HONESTY: You have NO access to this channel's analytics or past performance and must assume it may be brand new with zero uploads. In viewPotentialReason, NEVER invent specific numbers or claim a "previous video grew the channel by X%" or cite fake view/subscriber figures. Reason qualitatively and honestly ("this angle tends to attract search traffic because…"); the viewPotentialScore is your subjective 1-10 estimate, not measured data.

Respond ONLY with a JSON array, no prose, no markdown fences, matching this shape:
[{
  "title": string (a bilingual or English hook-style title, under 70 characters, no clickbait lies),
  "hook": string (the first-15-seconds spoken hook, in Roman Urdu/English mix),
  "angle": string (what makes this take different from generic finance content),
  "viewPotentialScore": number (1-10),
  "viewPotentialReason": string (specific, honest reasoning — not generic praise),
  "competitionLevel": "low" | "medium" | "high",
  "contentPillars": string[] (2-4 short tags, e.g. "inflation", "stock market", "career"),
  "suggestedLength": "short" | "long" | "deep-dive"
}]`
}

const LENGTH_GUIDE: Record<ScriptGenRequest['length'], string> = {
  short: 'Target 900-1300 words (roughly 6-8 minutes spoken).',
  long: 'Target 1900-2600 words (roughly 12-17 minutes spoken). This is a long-form explainer with real depth.',
  'deep-dive': 'Target 3000-4200 words (roughly 20-28 minutes spoken). This is an institutional-grade deep dive with multiple sections, data-driven arguments, and counterpoints.',
  'feature-90': 'Target ~13,500 words (roughly 90 minutes spoken). A feature-length documentary-grade treatment.',
  'feature-180': 'Target ~27,000 words (roughly 180 minutes spoken). A masterclass-length, exhaustive treatment.'
}

/** ~150 spoken words per minute; how many sections to chapter an ultra-long script into. */
export const FEATURE_PLANS: Partial<Record<ScriptGenRequest['length'], { sections: number; wordsPerSection: number }>> = {
  'feature-90': { sections: 12, wordsPerSection: 1150 },
  'feature-180': { sections: 20, wordsPerSection: 1350 }
}

export function isFeatureLength(length: ScriptGenRequest['length']): boolean {
  return length === 'feature-90' || length === 'feature-180'
}

export interface OutlineSection {
  title: string
  focus: string
}

export function buildOutlinePrompt(req: ScriptGenRequest, sectionCount: number): string {
  return `${NICHE_CONTEXT}

Task: Plan the CHAPTER OUTLINE for a feature-length (${req.length === 'feature-180' ? '~180' : '~90'}-minute) YouTube video on this topic. It will be written section by section, so give a strong, non-repetitive arc.

Topic: ${req.topic}
${req.ideaContext ? `Angle: ${req.ideaContext}` : ''}
${req.audienceNote ? `Audience: ${req.audienceNote}` : ''}

Produce exactly ${sectionCount} sequential sections that build on each other — opening hook section, escalating analysis, counterpoints, case studies, and a strong closing section. No two sections should cover the same ground.

Respond ONLY with a JSON array of exactly ${sectionCount} items, no prose, no markdown fences:
[{"title": string (short section title), "focus": string (one sentence: what THIS section uniquely covers)}]`
}

export function buildSectionPrompt(
  req: ScriptGenRequest,
  section: OutlineSection,
  index: number,
  total: number,
  outline: OutlineSection[]
): string {
  const plan = FEATURE_PLANS[req.length]
  const words = plan?.wordsPerSection ?? 1200
  const fullArc = outline.map((s, i) => `${i + 1}. ${s.title}`).join('\n')
  return `${NICHE_CONTEXT}

You are writing ONE section of a feature-length video script, section ${index + 1} of ${total}. Write ONLY this section's spoken narration — do not re-introduce the whole video, do not write an outro unless this is the final section, and do not repeat other sections.

Full chapter arc (for context — do not rewrite these, only write the current one):
${fullArc}

CURRENT SECTION ${index + 1}: "${section.title}"
This section must cover: ${section.focus}

Length: about ${words} words for this section alone.
Language: ${LANGUAGE_GUIDE[req.languageMix]}
${buildStyleBlock(req.styles)}${
    req.verifiedData?.trim()
      ? `\nVERIFIED DATA (treat as ground truth — use ONLY these figures for specific numbers): \n${req.verifiedData.trim()}`
      : '\nDo not invent precise statistics you cannot verify — describe magnitude/direction qualitatively instead.'
  }
${index === 0 ? 'This is the OPENING section: start with a strong [PATTERN INTERRUPT] hook.' : ''}
${index === total - 1 ? 'This is the FINAL section: end with a [TAKEAWAY] and an [URGENT ALPHA] call to action.' : ''}

Write only the spoken narration for this section, no headers, no JSON, no commentary.`
}

const LANGUAGE_GUIDE: Record<ScriptGenRequest['languageMix'], string> = {
  balanced: 'Mix Roman Urdu and English roughly evenly, the way a bilingual Pakistani analyst naturally code-switches — technical/finance terms usually stay in English, connective and emotional language flows in Roman Urdu.',
  'mostly-english': 'Write mostly in English, with occasional natural Roman Urdu phrases for emphasis, transitions, or cultural resonance (10-20% of the script).',
  'mostly-roman-urdu': 'Write mostly in Roman Urdu, keeping finance/economics technical terms (inflation, GDP, interest rate, portfolio, etc.) in English since that is how they are actually said, even in Urdu speech.',
  'formal-urdu':
    'Write in proper Urdu script (نستعلیق), in a formal, professional register — the tone of a serious news anchor or an institutional briefing, not casual speech. Keep finance/economics technical terms (inflation, GDP, interest rate, portfolio, etc.) in English as they are actually spoken even in formal Urdu. Maintain dignity and precision; avoid slang and filler.'
}

export function buildScriptPrompt(req: ScriptGenRequest): string {
  return `${NICHE_CONTEXT}

Task: Write a complete, ready-to-record long-form YouTube script.

Topic: ${req.topic}
${req.ideaContext ? `Context / angle from the approved idea: ${req.ideaContext}` : ''}
${req.audienceNote ? `Audience note: ${req.audienceNote}` : ''}
${
  req.recentNewsContext?.trim()
    ? `\nREAL RECENT NEWS on this topic (last 14 days, via live news search — use for currency/timeliness, not as your only source):\n${req.recentNewsContext.trim()}`
    : ''
}

Length: ${LENGTH_GUIDE[req.length]}
Language: ${LANGUAGE_GUIDE[req.languageMix]}
${buildStyleBlock(req.styles)}${
  req.verifiedData?.trim()
    ? `\nVERIFIED DATA (from live public data feeds and/or checked by the user — treat as ground truth): \n${req.verifiedData.trim()}\n\nUse ONLY these figures for any specific numbers, dates, or statistics related to them. Do not invent additional specific numbers you cannot verify from this list — if you need a figure not provided here, describe the trend or direction qualitatively instead of stating a precise number.`
    : '\nNo verified data was supplied. Avoid stating precise, specific numbers you cannot be confident are correct (exact percentages, exact currency figures, exact dates) — describe magnitude and direction qualitatively instead (e.g. "sharply higher than last year" rather than inventing a precise figure).'
}

Write it as a high-retention "hook → retain → convert" engine. Use these bracketed stage directions on their own line before each section:

[PATTERN INTERRUPT] — first 3 seconds. Break the viewer's expectation: a counterintuitive claim, a shocking number, or a "you've been told X, but..." reversal. Absolutely no "hi guys, welcome back," no channel intro, no throat-clearing.
[BLUF] — one or two sentences, bottom-line-up-front: tell the viewer exactly what they'll walk away understanding. This is the promise that stops the scroll.
[CONTEXT] — briefly ground why this matters right now, and open a curiosity loop you'll close later ("but the real reason is stranger than that — I'll get to it").
[EVIDENCE BLOCS] — the substantive body, broken into 2-4 short blocs. In every bloc, pair each claim with a concrete number, comparison, or mechanism — never a vague assertion. Reason like an analyst. Between blocs, use a retention turn ("here's what almost nobody tells you...", "and this is where it gets interesting...").
[COUNTERPOINT] — steelman a credible opposing view or a real risk to the thesis. This is what makes it institutional-grade rather than one-sided.
[TAKEAWAY] — close every open loop and give a concrete "what this means / what to watch for." Educational framing only — never personalized financial advice, never "buy this now."
[URGENT ALPHA] — the conversion close: a specific, topic-tied reason to subscribe/comment now (e.g. "next week I break down [related thing] — subscribe so you catch it"), not a generic sign-off.

Do not include camera directions, music cues, or B-roll notes beyond the bracketed section labels. Write only the spoken script text.

Respond in EXACTLY this format and nothing else — no JSON, no markdown fences, no commentary before or after:

TITLE: <the video title on a single line>
===SCRIPT===
<the full script body, starting with [PATTERN INTERRUPT]>`
}

/**
 * System instruction for the Advisor chat. It's a reasoning partner, not a
 * yes-man: it should critique the user's plan, propose better angles, and be
 * honest about weaknesses — grounded in this channel's finance/economics niche.
 */
export function buildAdvisorSystemPrompt(context?: string): string {
  return `${NICHE_CONTEXT}

You are the user's strategic ADVISOR for this YouTube finance/economics channel — a sharp, candid producer and analyst. The user will describe ideas, topics, scripts, or tasks. Your job is to REASON and TALK BACK: tell them honestly what would work better, what's weak or saturated, what angle would get more views, what's factually risky, and what they should do next. Be specific and opinionated, not generic praise. If a topic is a bad idea, say so and explain why, then offer a stronger alternative. Keep answers concise and actionable (short paragraphs or tight bullet points). Never give personalized financial advice ("buy X now"); frame everything as content strategy and educational analysis.

CRITICAL HONESTY RULES — do not violate these:
- You have NO access to this user's YouTube channel, its analytics, view counts, subscribers, watch time, or ANY past video performance. You have never seen their data. Assume they may be brand new with zero uploads.
- NEVER invent or cite specific numbers you cannot verify: no made-up view counts, no "this grew the channel by X%", no "your previous video did Y", no fake subscriber/CTR/retention figures, no fabricated sources or studies. This is the single most important rule.
- When you estimate view potential or competition, frame it explicitly as YOUR REASONED JUDGMENT about the niche in general ("this angle tends to…", "topics like this usually…"), never as measured fact about their channel.
- If you don't know something, say "I don't have data on that" plainly. It is always better to admit uncertainty than to fabricate a confident-sounding number. A single invented statistic destroys your usefulness.${
    context?.trim()
      ? `\n\nWHAT THE USER IS CURRENTLY WORKING ON (use this to ground your advice):\n${context.trim()}`
      : ''
  }`
}

export function buildThumbnailPrompt(topic: string, title: string): string {
  return `${NICHE_CONTEXT}

Task: Design a YouTube thumbnail BRIEF (a text blueprint a designer or image tool can execute — you are NOT generating an image) for this finance/economics video.

Video topic: ${topic}
Video title: ${title || topic}

The thumbnail must be a "stop-scroll" trigger built on Authority–Shock–Scarcity psychology. Give a concrete, specific, executable brief — not vague adjectives.

Respond in plain text with EXACTLY these labeled lines and nothing else:

MAIN SUBJECT: <the central visual — person/object/chart, their expression or state>
COMPOSITION: <layout using rule-of-thirds; where subject, text, and focal point sit>
LIGHTING: <a specific lighting style, e.g. dramatic chiaroscuro, hard rim light, high-contrast>
COLOR PSYCHOLOGY: <2-3 dominant colors and the emotion each is chosen to trigger>
OVERLAY TEXT: <3-5 punchy words max, the on-thumbnail hook — can be Roman Urdu or English>
PSYCHOLOGICAL TRIGGER: <name which of Authority / Shock / Scarcity dominates and why it fits this topic>`
}
