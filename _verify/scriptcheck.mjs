// src/main/services.ts
import { randomUUID as randomUUID2 } from "crypto";

// src/main/llm/anthropic.ts
import Anthropic from "@anthropic-ai/sdk";

// src/main/prompts.ts
var STYLE_GUIDE = {
  standard: "Standard: a clean, balanced explainer \u2014 clear and professional, no extremes.",
  "deep-dive": "Deep Dive: go several layers deeper than surface commentary \u2014 trace second- and third-order effects and mechanisms.",
  masterclass: "Masterclass: teach it like a structured lesson \u2014 define terms, build concepts step by step, so a motivated beginner can follow an expert-level argument.",
  "institutional-framework": "Institutional Framework: frame the analysis the way a research desk would \u2014 thesis, drivers, risks, scenarios, and what would invalidate the view.",
  "financial-research": "Financial Research: write like a sell-side/buy-side research note \u2014 data-led, sourced reasoning, measured tone, explicit assumptions.",
  "technical-charting": "Technical Charting: emphasize price action, levels, trends, momentum and chart structure; describe what the technicals imply (using only provided/verified figures for specifics).",
  "fundamental-deep-dive": "Fundamental Deep Dive: focus on fundamentals \u2014 earnings, ratios, growth, balance-sheet health, valuation drivers (using only provided/verified figures for specifics).",
  infotainment: "Infotainment: keep it rigorous but genuinely entertaining \u2014 vivid analogies, momentum, personality, without dumbing down the substance.",
  normal: "Normal: a natural, conversational register \u2014 how a smart friend who happens to be a finance pro would explain it.",
  hooking: "Hooking: maximize retention aggressively \u2014 stack curiosity gaps, open loops, and mini-cliffhangers between sections to pull the viewer through."
};
function buildStyleBlock(styles) {
  if (!styles || !styles.length) return "";
  const directives = styles.map((s) => `- ${STYLE_GUIDE[s]}`).join("\n");
  return `
Apply and BLEND the following stylistic modes simultaneously (they combine \u2014 honor all of them):
${directives}
`;
}
var NICHE_CONTEXT = `You are a senior content strategist and financial journalist working with a YouTube channel that covers finance and economics for a Pakistani / South Asian audience. Scripts are delivered in natural, code-switched Roman Urdu and English, the way a well-educated Pakistani finance professional actually speaks (e.g. "aaj hum baat karain ge Pakistan ke current account deficit ke baare mein, aur why it matters for the average investor"). The channel's positioning is institutional-grade: accurate, sourced in its reasoning, structured like a research note or a Bloomberg/FT explainer \u2014 never clickbait-empty, never financial-advice-illegal ("buy this stock now"), always framed as analysis and education.`;
function buildTrendPrompt(focusArea, count) {
  return `${NICHE_CONTEXT}

Task: Based on your general knowledge of recurring and currently unfolding themes in finance and economics (global and Pakistan/South Asia-specific), list ${count} topic clusters that are likely to have strong search and watch interest right now for a YouTube channel in this niche, focused on: "${focusArea || "general finance & economics"}".

Be explicit that this is reasoned estimation, not live search data. Favor topics with: real financial stakes for ordinary viewers, an news hook or recurring seasonal pattern (budget season, tax season, Fed/SBP rate decisions, Ramadan spending, etc.), and a clear reason someone would click today rather than skip.

Respond ONLY with a JSON array, no prose, no markdown fences, matching this shape:
[{"topic": string, "why": string, "momentum": "rising" | "steady" | "seasonal"}]`;
}
function formatViews(n) {
  if (n >= 1e6) return `${(n / 1e6).toFixed(1)}M views`;
  if (n >= 1e3) return `${(n / 1e3).toFixed(1)}K views`;
  return `${n} views`;
}
function buildIdeaPrompt(req, trends, ytSignals = []) {
  const trendBlock = trends.length ? `Here are candidate trend signals to draw from (you may combine, reject, or go beyond them if you have a stronger idea):
${trends.map((t) => `- ${t.topic} (${t.momentum}): ${t.why}`).join("\n")}` : "No external trend data was supplied \u2014 rely on your own judgment of what performs well in this niche.";
  const ytBlock = ytSignals.length ? `
Here are REAL existing YouTube videos currently ranking for this topic (via YouTube Data API, actual view counts) \u2014 use this to gauge genuine saturation and to find an angle that isn't already done to death:
${ytSignals.map((s) => `- "${s.title}" \u2014 ${s.channelTitle} \u2014 ${formatViews(s.viewCount)} \u2014 published ${s.publishedAt.slice(0, 10)}`).join("\n")}
Calibrate competitionLevel and viewPotentialReason against this real data, not guesses.` : "";
  return `${NICHE_CONTEXT}

Task: Generate ${req.count} distinct YouTube video ideas for the focus area: "${req.focusArea}".
${req.audienceNote ? `Audience note: ${req.audienceNote}` : ""}

${trendBlock}
${ytBlock}

For each idea, think like a YouTube strategist scoring for view potential: curiosity gap in the title, timeliness, search intent, emotional stakes (fear/greed/status/security), and how saturated the angle already is on YouTube.

HONESTY: You have NO access to this channel's analytics or past performance and must assume it may be brand new with zero uploads. In viewPotentialReason, NEVER invent specific numbers or claim a "previous video grew the channel by X%" or cite fake view/subscriber figures. Reason qualitatively and honestly ("this angle tends to attract search traffic because\u2026"); the viewPotentialScore is your subjective 1-10 estimate, not measured data.

Respond ONLY with a JSON array, no prose, no markdown fences, matching this shape:
[{
  "title": string (a bilingual or English hook-style title, under 70 characters, no clickbait lies),
  "hook": string (the first-15-seconds spoken hook, in Roman Urdu/English mix),
  "angle": string (what makes this take different from generic finance content),
  "viewPotentialScore": number (1-10),
  "viewPotentialReason": string (specific, honest reasoning \u2014 not generic praise),
  "competitionLevel": "low" | "medium" | "high",
  "contentPillars": string[] (2-4 short tags, e.g. "inflation", "stock market", "career"),
  "suggestedLength": "short" | "long" | "deep-dive"
}]`;
}
var LENGTH_GUIDE = {
  short: "Target 900-1300 words (roughly 6-8 minutes spoken).",
  long: "Target 1900-2600 words (roughly 12-17 minutes spoken). This is a long-form explainer with real depth.",
  "deep-dive": "Target 3000-4200 words (roughly 20-28 minutes spoken). This is an institutional-grade deep dive with multiple sections, data-driven arguments, and counterpoints.",
  "feature-90": "Target ~13,500 words (roughly 90 minutes spoken). A feature-length documentary-grade treatment.",
  "feature-180": "Target ~27,000 words (roughly 180 minutes spoken). A masterclass-length, exhaustive treatment."
};
var FEATURE_PLANS = {
  "feature-90": { sections: 12, wordsPerSection: 1150 },
  "feature-180": { sections: 20, wordsPerSection: 1350 }
};
function isFeatureLength(length) {
  return length === "feature-90" || length === "feature-180";
}
function buildOutlinePrompt(req, sectionCount) {
  return `${NICHE_CONTEXT}

Task: Plan the CHAPTER OUTLINE for a feature-length (${req.length === "feature-180" ? "~180" : "~90"}-minute) YouTube video on this topic. It will be written section by section, so give a strong, non-repetitive arc.

Topic: ${req.topic}
${req.ideaContext ? `Angle: ${req.ideaContext}` : ""}
${req.audienceNote ? `Audience: ${req.audienceNote}` : ""}

Produce exactly ${sectionCount} sequential sections that build on each other \u2014 opening hook section, escalating analysis, counterpoints, case studies, and a strong closing section. No two sections should cover the same ground.

Respond ONLY with a JSON array of exactly ${sectionCount} items, no prose, no markdown fences:
[{"title": string (short section title), "focus": string (one sentence: what THIS section uniquely covers)}]`;
}
function buildSectionPrompt(req, section, index, total, outline) {
  const plan = FEATURE_PLANS[req.length];
  const words = plan?.wordsPerSection ?? 1200;
  const fullArc = outline.map((s, i) => `${i + 1}. ${s.title}`).join("\n");
  return `${NICHE_CONTEXT}

You are writing ONE section of a feature-length video script, section ${index + 1} of ${total}. Write ONLY this section's spoken narration \u2014 do not re-introduce the whole video, do not write an outro unless this is the final section, and do not repeat other sections.

Full chapter arc (for context \u2014 do not rewrite these, only write the current one):
${fullArc}

CURRENT SECTION ${index + 1}: "${section.title}"
This section must cover: ${section.focus}

Length: about ${words} words for this section alone.
Language: ${LANGUAGE_GUIDE[req.languageMix]}
${buildStyleBlock(req.styles)}${req.verifiedData?.trim() ? `
VERIFIED DATA (treat as ground truth \u2014 use ONLY these figures for specific numbers): 
${req.verifiedData.trim()}` : "\nDo not invent precise statistics you cannot verify \u2014 describe magnitude/direction qualitatively instead."}
${index === 0 ? "This is the OPENING section: start with a strong [PATTERN INTERRUPT] hook." : ""}
${index === total - 1 ? "This is the FINAL section: end with a [TAKEAWAY] and an [URGENT ALPHA] call to action." : ""}

Write only the spoken narration for this section, no headers, no JSON, no commentary.`;
}
var LANGUAGE_GUIDE = {
  balanced: "Mix Roman Urdu and English roughly evenly, the way a bilingual Pakistani analyst naturally code-switches \u2014 technical/finance terms usually stay in English, connective and emotional language flows in Roman Urdu.",
  "mostly-english": "Write mostly in English, with occasional natural Roman Urdu phrases for emphasis, transitions, or cultural resonance (10-20% of the script).",
  "mostly-roman-urdu": "Write mostly in Roman Urdu, keeping finance/economics technical terms (inflation, GDP, interest rate, portfolio, etc.) in English since that is how they are actually said, even in Urdu speech.",
  "formal-urdu": "Write in proper Urdu script (\u0646\u0633\u062A\u0639\u0644\u06CC\u0642), in a formal, professional register \u2014 the tone of a serious news anchor or an institutional briefing, not casual speech. Keep finance/economics technical terms (inflation, GDP, interest rate, portfolio, etc.) in English as they are actually spoken even in formal Urdu. Maintain dignity and precision; avoid slang and filler."
};
function buildScriptPrompt(req) {
  return `${NICHE_CONTEXT}

Task: Write a complete, ready-to-record long-form YouTube script.

Topic: ${req.topic}
${req.ideaContext ? `Context / angle from the approved idea: ${req.ideaContext}` : ""}
${req.audienceNote ? `Audience note: ${req.audienceNote}` : ""}
${req.recentNewsContext?.trim() ? `
REAL RECENT NEWS on this topic (last 14 days, via live news search \u2014 use for currency/timeliness, not as your only source):
${req.recentNewsContext.trim()}` : ""}

Length: ${LENGTH_GUIDE[req.length]}
Language: ${LANGUAGE_GUIDE[req.languageMix]}
${buildStyleBlock(req.styles)}${req.verifiedData?.trim() ? `
VERIFIED DATA (from live public data feeds and/or checked by the user \u2014 treat as ground truth): 
${req.verifiedData.trim()}

Use ONLY these figures for any specific numbers, dates, or statistics related to them. Do not invent additional specific numbers you cannot verify from this list \u2014 if you need a figure not provided here, describe the trend or direction qualitatively instead of stating a precise number.` : '\nNo verified data was supplied. Avoid stating precise, specific numbers you cannot be confident are correct (exact percentages, exact currency figures, exact dates) \u2014 describe magnitude and direction qualitatively instead (e.g. "sharply higher than last year" rather than inventing a precise figure).'}

Write it as a high-retention "hook \u2192 retain \u2192 convert" engine. Use these bracketed stage directions on their own line before each section:

[PATTERN INTERRUPT] \u2014 first 3 seconds. Break the viewer's expectation: a counterintuitive claim, a shocking number, or a "you've been told X, but..." reversal. Absolutely no "hi guys, welcome back," no channel intro, no throat-clearing.
[BLUF] \u2014 one or two sentences, bottom-line-up-front: tell the viewer exactly what they'll walk away understanding. This is the promise that stops the scroll.
[CONTEXT] \u2014 briefly ground why this matters right now, and open a curiosity loop you'll close later ("but the real reason is stranger than that \u2014 I'll get to it").
[EVIDENCE BLOCS] \u2014 the substantive body, broken into 2-4 short blocs. In every bloc, pair each claim with a concrete number, comparison, or mechanism \u2014 never a vague assertion. Reason like an analyst. Between blocs, use a retention turn ("here's what almost nobody tells you...", "and this is where it gets interesting...").
[COUNTERPOINT] \u2014 steelman a credible opposing view or a real risk to the thesis. This is what makes it institutional-grade rather than one-sided.
[TAKEAWAY] \u2014 close every open loop and give a concrete "what this means / what to watch for." Educational framing only \u2014 never personalized financial advice, never "buy this now."
[URGENT ALPHA] \u2014 the conversion close: a specific, topic-tied reason to subscribe/comment now (e.g. "next week I break down [related thing] \u2014 subscribe so you catch it"), not a generic sign-off.

Do not include camera directions, music cues, or B-roll notes beyond the bracketed section labels. Write only the spoken script text.

Respond in EXACTLY this format and nothing else \u2014 no JSON, no markdown fences, no commentary before or after:

TITLE: <the video title on a single line>
===SCRIPT===
<the full script body, starting with [HOOK]>`;
}
function buildThumbnailPrompt(topic, title) {
  return `${NICHE_CONTEXT}

Task: Design a YouTube thumbnail BRIEF (a text blueprint a designer or image tool can execute \u2014 you are NOT generating an image) for this finance/economics video.

Video topic: ${topic}
Video title: ${title || topic}

The thumbnail must be a "stop-scroll" trigger built on Authority\u2013Shock\u2013Scarcity psychology. Give a concrete, specific, executable brief \u2014 not vague adjectives.

Respond in plain text with EXACTLY these labeled lines and nothing else:

MAIN SUBJECT: <the central visual \u2014 person/object/chart, their expression or state>
COMPOSITION: <layout using rule-of-thirds; where subject, text, and focal point sit>
LIGHTING: <a specific lighting style, e.g. dramatic chiaroscuro, hard rim light, high-contrast>
COLOR PSYCHOLOGY: <2-3 dominant colors and the emotion each is chosen to trigger>
OVERLAY TEXT: <3-5 punchy words max, the on-thumbnail hook \u2014 can be Roman Urdu or English>
PSYCHOLOGICAL TRIGGER: <name which of Authority / Shock / Scarcity dominates and why it fits this topic>`;
}

// src/main/llm/types.ts
var LLMConfigError = class extends Error {
};
var LLMRequestError = class extends Error {
};

// src/main/llm/parse.ts
function snippet(text) {
  const clean = text.trim().replace(/\s+/g, " ");
  return clean.length > 200 ? `${clean.slice(0, 200)}\u2026` : clean;
}
function extractJson(text) {
  const trimmed = text.trim();
  const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const candidate = fenced ? fenced[1] : trimmed;
  const start = candidate.search(/[[{]/);
  const end = Math.max(candidate.lastIndexOf("]"), candidate.lastIndexOf("}"));
  const sliced = start >= 0 && end >= start ? candidate.slice(start, end + 1) : candidate;
  try {
    return JSON.parse(sliced);
  } catch {
    try {
      return JSON.parse(sliced.replace(/,(\s*[\]}])/g, "$1"));
    } catch {
      throw new LLMRequestError(`Model response was not valid JSON. Response started with: "${snippet(text)}"`);
    }
  }
}
function parseScriptResponse(text) {
  const marker = "===SCRIPT===";
  const idx = text.indexOf(marker);
  if (idx === -1) {
    throw new LLMRequestError(
      `Model response was missing the "${marker}" section. Response started with: "${snippet(text)}"`
    );
  }
  const titleMatch = text.slice(0, idx).match(/TITLE:\s*(.+)/i);
  const title = titleMatch ? titleMatch[1].trim() : "";
  const body = text.slice(idx + marker.length).trim();
  if (!title || !body) {
    throw new LLMRequestError("Model response was missing a title or a script body.");
  }
  return { title, body };
}

// src/main/llm/anthropic.ts
var AnthropicProvider = class {
  constructor(apiKey, model) {
    this.model = model;
    this.client = new Anthropic({ apiKey });
  }
  client;
  async complete(prompt, maxTokens) {
    try {
      const res = await this.client.messages.create({
        model: this.model,
        max_tokens: maxTokens,
        messages: [{ role: "user", content: prompt }]
      });
      const block = res.content.find((b) => b.type === "text");
      if (!block || block.type !== "text") throw new LLMRequestError("Anthropic returned no text content");
      return block.text;
    } catch (err) {
      if (err instanceof LLMRequestError) throw err;
      throw new LLMRequestError(err instanceof Error ? err.message : "Anthropic request failed");
    }
  }
  async generateTrendTopics(focusArea, count) {
    const text = await this.complete(buildTrendPrompt(focusArea, count), 2e3);
    return extractJson(text);
  }
  async generateIdeas(req, trends, ytSignals) {
    const text = await this.complete(buildIdeaPrompt(req, trends, ytSignals), 3e3);
    return extractJson(text);
  }
  async generateScriptBody(req) {
    const text = await this.complete(buildScriptPrompt(req), 8e3);
    return parseScriptResponse(text);
  }
  async generateThumbnailBrief(topic, title) {
    return (await this.complete(buildThumbnailPrompt(topic, title), 1e3)).trim();
  }
  async generateText(prompt, maxTokens = 4e3) {
    return (await this.complete(prompt, maxTokens)).trim();
  }
};

// src/main/llm/openai.ts
import OpenAI from "openai";
var OpenAIProvider = class {
  constructor(apiKey, model) {
    this.model = model;
    this.client = new OpenAI({ apiKey });
  }
  client;
  async complete(prompt, maxTokens) {
    try {
      const res = await this.client.chat.completions.create({
        model: this.model,
        max_tokens: maxTokens,
        messages: [{ role: "user", content: prompt }]
      });
      const text = res.choices[0]?.message?.content;
      if (!text) throw new LLMRequestError("OpenAI returned no text content");
      return text;
    } catch (err) {
      if (err instanceof LLMRequestError) throw err;
      throw new LLMRequestError(err instanceof Error ? err.message : "OpenAI request failed");
    }
  }
  async generateTrendTopics(focusArea, count) {
    const text = await this.complete(buildTrendPrompt(focusArea, count), 2e3);
    return extractJson(text);
  }
  async generateIdeas(req, trends, ytSignals) {
    const text = await this.complete(buildIdeaPrompt(req, trends, ytSignals), 3e3);
    return extractJson(text);
  }
  async generateScriptBody(req) {
    const text = await this.complete(buildScriptPrompt(req), 8e3);
    return parseScriptResponse(text);
  }
  async generateThumbnailBrief(topic, title) {
    return (await this.complete(buildThumbnailPrompt(topic, title), 1e3)).trim();
  }
  async generateText(prompt, maxTokens = 4e3) {
    return (await this.complete(prompt, maxTokens)).trim();
  }
};

// src/main/llm/ollama.ts
import { request as httpRequest } from "http";
var OLLAMA_BASE_URL = "http://127.0.0.1:11434";
var OLLAMA_HOST = "127.0.0.1";
var OLLAMA_PORT = 11434;
var SOCKET_IDLE_TIMEOUT_MS = 20 * 60 * 1e3;
function ollamaChat(model, prompt, numPredict) {
  const payload = JSON.stringify({
    model,
    messages: [{ role: "user", content: prompt }],
    stream: false,
    // Ollama defaults to a 2048-token context regardless of the model's real
    // capacity, which silently truncates long scripts mid-generation.
    options: { num_ctx: 8192, num_predict: numPredict }
  });
  return new Promise((resolve, reject) => {
    const req = httpRequest(
      {
        host: OLLAMA_HOST,
        port: OLLAMA_PORT,
        path: "/api/chat",
        method: "POST",
        headers: { "Content-Type": "application/json", "Content-Length": Buffer.byteLength(payload) }
      },
      (res) => {
        const chunks = [];
        res.on("data", (c) => chunks.push(c));
        res.on("end", () => {
          const body = Buffer.concat(chunks).toString("utf-8");
          if ((res.statusCode ?? 500) >= 400) {
            reject(new LLMRequestError(`Ollama request failed (${res.statusCode}): ${body.slice(0, 300)}`));
            return;
          }
          try {
            const content = JSON.parse(body)?.message?.content;
            if (!content) reject(new LLMRequestError("Ollama returned no content"));
            else resolve(content);
          } catch {
            reject(new LLMRequestError("Ollama returned a malformed response"));
          }
        });
      }
    );
    req.setTimeout(SOCKET_IDLE_TIMEOUT_MS, () => {
      req.destroy();
      reject(
        new LLMRequestError(
          `Ollama did not respond within ${SOCKET_IDLE_TIMEOUT_MS / 6e4} minutes. On a CPU-only machine long scripts are slow \u2014 try a shorter length, or switch to a cloud provider in Settings for speed.`
        )
      );
    });
    req.on("error", (err) => {
      if (err.code === "ECONNREFUSED") {
        reject(
          new LLMRequestError(
            `Could not reach Ollama at ${OLLAMA_BASE_URL}. Open the Ollama app so it is running, then try again.`
          )
        );
      } else {
        reject(new LLMRequestError(`Ollama request error: ${err.message}`));
      }
    });
    req.write(payload);
    req.end();
  });
}
var OllamaProvider = class {
  constructor(model) {
    this.model = model;
  }
  complete(prompt, numPredict = 2048) {
    return ollamaChat(this.model, prompt, numPredict);
  }
  async generateTrendTopics(focusArea, count) {
    const text = await this.complete(buildTrendPrompt(focusArea, count));
    return extractJson(text);
  }
  async generateIdeas(req, trends, ytSignals) {
    const text = await this.complete(buildIdeaPrompt(req, trends, ytSignals));
    return extractJson(text);
  }
  async generateScriptBody(req) {
    const text = await this.complete(buildScriptPrompt(req), 6e3);
    return parseScriptResponse(text);
  }
  async generateThumbnailBrief(topic, title) {
    return (await this.complete(buildThumbnailPrompt(topic, title), 1e3)).trim();
  }
  async generateText(prompt, maxTokens = 2500) {
    return (await this.complete(prompt, maxTokens)).trim();
  }
};

// _verify/electron-shim.mjs
var app = {
  getPath() {
    return process.env.CHECK_USERDATA || ".";
  },
  setPath() {
  },
  isPackaged: false
};
var safeStorage = {
  isEncryptionAvailable() {
    return false;
  },
  encryptString(s) {
    return Buffer.from(String(s), "utf-8");
  },
  decryptString(b) {
    return Buffer.from(b).toString("utf-8");
  }
};

// src/main/store.ts
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "fs";
import { randomUUID } from "crypto";
import { join } from "path";
var DEFAULT_SETTINGS = {
  activeProvider: "ollama",
  anthropicModel: "claude-sonnet-5",
  openaiModel: "gpt-4o",
  ollamaModel: "llama3.1:8b",
  anthropicKeyEnc: null,
  openaiKeyEnc: null,
  youtubeKeyEnc: null
};
function dataDir() {
  const dir = app.getPath("userData");
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  return dir;
}
function settingsPath() {
  return join(dataDir(), "settings.json");
}
function libraryPath() {
  return join(dataDir(), "library.json");
}
function activityLogPath() {
  return join(dataDir(), "activity-log.json");
}
function readSettings() {
  try {
    const raw = readFileSync(settingsPath(), "utf-8");
    return { ...DEFAULT_SETTINGS, ...JSON.parse(raw) };
  } catch {
    return { ...DEFAULT_SETTINGS };
  }
}
function decrypt(stored) {
  const sep = stored.indexOf(":");
  const scheme = sep === -1 ? "" : stored.slice(0, sep);
  const payload = sep === -1 ? stored : stored.slice(sep + 1);
  if (scheme === "dpapi") {
    try {
      return safeStorage.decryptString(Buffer.from(payload, "base64"));
    } catch {
      return "";
    }
  }
  if (scheme === "plain") {
    return Buffer.from(payload, "base64").toString("utf-8");
  }
  try {
    if (safeStorage.isEncryptionAvailable()) return safeStorage.decryptString(Buffer.from(stored, "base64"));
  } catch {
  }
  return Buffer.from(stored, "base64").toString("utf-8");
}
function getSettings() {
  const s = readSettings();
  return {
    activeProvider: s.activeProvider,
    anthropicModel: s.anthropicModel,
    openaiModel: s.openaiModel,
    ollamaModel: s.ollamaModel,
    hasAnthropicKey: !!s.anthropicKeyEnc,
    hasOpenAIKey: !!s.openaiKeyEnc,
    hasYouTubeKey: !!s.youtubeKeyEnc
  };
}
function getDecryptedKey(provider) {
  const s = readSettings();
  const enc = provider === "anthropic" ? s.anthropicKeyEnc : s.openaiKeyEnc;
  if (!enc) return null;
  return decrypt(enc);
}
function getModel(provider) {
  const s = readSettings();
  if (provider === "anthropic") return s.anthropicModel;
  if (provider === "openai") return s.openaiModel;
  return s.ollamaModel;
}
function readLibrary() {
  try {
    const raw = readFileSync(libraryPath(), "utf-8");
    return JSON.parse(raw);
  } catch {
    return [];
  }
}
function writeLibrary(entries) {
  writeFileSync(libraryPath(), JSON.stringify(entries, null, 2), "utf-8");
}
function listLibrary() {
  return readLibrary().sort((a, b) => b.savedAt.localeCompare(a.savedAt));
}
function saveToLibrary(entry) {
  const entries = readLibrary();
  entries.push(entry);
  writeLibrary(entries);
  return listLibrary();
}
function readActivityLog() {
  try {
    const raw = readFileSync(activityLogPath(), "utf-8");
    return JSON.parse(raw);
  } catch {
    return [];
  }
}
function writeActivityLog(entries) {
  writeFileSync(activityLogPath(), JSON.stringify(entries, null, 2), "utf-8");
}
function logActivity(actor, action, details) {
  const entries = readActivityLog();
  entries.push({ id: randomUUID(), timestamp: (/* @__PURE__ */ new Date()).toISOString(), actor, action, details });
  writeActivityLog(entries);
}

// src/main/llm/index.ts
function getActiveProvider() {
  const settings = getSettings();
  const model = getModel(settings.activeProvider);
  if (settings.activeProvider === "ollama") return new OllamaProvider(model);
  const key = getDecryptedKey(settings.activeProvider);
  if (!key) {
    throw new LLMConfigError(
      `No API key configured for ${settings.activeProvider}. Add one in Settings before generating.`
    );
  }
  if (settings.activeProvider === "anthropic") return new AnthropicProvider(key, model);
  return new OpenAIProvider(key, model);
}

// src/main/llm/feature.ts
async function generateFeatureScript(provider, req, onProgress) {
  const plan = FEATURE_PLANS[req.length];
  const sectionCount = plan?.sections ?? 12;
  onProgress?.(`Planning ${sectionCount}-section outline`);
  const outlineText = await provider.generateText(buildOutlinePrompt(req, sectionCount), 2e3);
  let outline;
  try {
    outline = extractJson(outlineText);
  } catch {
    outline = Array.from({ length: sectionCount }, (_, i) => ({
      title: `Part ${i + 1}`,
      focus: `Section ${i + 1} of the analysis of ${req.topic}.`
    }));
  }
  outline = outline.slice(0, sectionCount);
  const parts = [];
  for (let i = 0; i < outline.length; i++) {
    const section = outline[i];
    onProgress?.(`Writing section ${i + 1} of ${outline.length}: ${section.title}`);
    const sectionText = await provider.generateText(
      buildSectionPrompt(req, section, i, outline.length, outline),
      2600
    );
    parts.push(`[${section.title.toUpperCase()}]
${sectionText.trim()}`);
  }
  const title = req.topic.length <= 70 ? req.topic : `${req.topic.slice(0, 67)}...`;
  return { title, body: parts.join("\n\n") };
}

// src/main/data/news.ts
function extractItemTitles(xml) {
  const itemBlocks = xml.match(/<item[^>]*>[\s\S]*?<\/item>/g) ?? [];
  return itemBlocks.map((block) => block.match(/<title>(?:<!\[CDATA\[)?(.*?)(?:\]\]>)?<\/title>/)).map((m) => m?.[1]?.trim()).filter((t) => !!t);
}
async function fetchTitlesFromFeed(url) {
  try {
    const res = await fetch(url);
    if (!res.ok) return [];
    return extractItemTitles(await res.text());
  } catch {
    return [];
  }
}
async function getTopicNews(topic, maxItems = 5) {
  if (!topic.trim()) return [];
  const url = `https://news.google.com/rss/search?q=${encodeURIComponent(topic)}+when:14d&hl=en-PK&gl=PK&ceid=PK:en`;
  const titles = await fetchTitlesFromFeed(url);
  return titles.slice(0, maxItems);
}

// src/main/data/currency.ts
var PRIMARY_URL = (date) => `https://cdn.jsdelivr.net/npm/@fawazahmed0/currency-api@${date}/v1/currencies/usd.json`;
var FALLBACK_URL = (date) => `https://${date}.currency-api.pages.dev/v1/currencies/usd.json`;
var GRAMS_PER_TROY_OZ = 31.1034768;
var GRAMS_PER_TOLA = 11.6638038;
function goldPkrPerTola(usdXau, usdPkr) {
  const ozUsd = 1 / usdXau;
  return ozUsd * usdPkr * GRAMS_PER_TOLA / GRAMS_PER_TROY_OZ;
}
async function getMarketSnapshotNote() {
  for (const urlFn of [PRIMARY_URL, FALLBACK_URL]) {
    try {
      const res = await fetch(urlFn("latest"));
      if (!res.ok) continue;
      const data = await res.json();
      const usd = data?.usd;
      const pkr = typeof usd?.pkr === "number" ? usd.pkr : null;
      if (pkr === null) continue;
      const lines = [`1 USD = ${pkr.toFixed(2)} PKR (live rate, fetched just now from a public exchange-rate feed)`];
      if (typeof usd?.xau === "number") {
        const ozUsd = 1 / usd.xau;
        const tolaPkr = goldPkrPerTola(usd.xau, pkr);
        lines.push(
          `Gold = $${ozUsd.toFixed(2)}/troy oz (live) \u2248 ${tolaPkr.toFixed(0)} PKR per tola (24k, before local dealer premium)`
        );
      }
      if (typeof usd?.btc === "number") {
        lines.push(`Bitcoin = $${Math.round(1 / usd.btc).toLocaleString()} USD (live)`);
      }
      return lines.join("\n");
    } catch {
      continue;
    }
  }
  return null;
}

// src/main/services.ts
function countWords(text) {
  return text.trim().split(/\s+/).filter(Boolean).length;
}
async function generateScriptFlow(req, onProgress) {
  const [fxNote, topicNews] = await Promise.all([getMarketSnapshotNote(), getTopicNews(req.topic)]);
  const enrichedReq = {
    ...req,
    verifiedData: [fxNote, req.verifiedData?.trim()].filter(Boolean).join("\n"),
    recentNewsContext: topicNews.map((t) => `- ${t}`).join("\n")
  };
  const provider = getActiveProvider();
  const { title, body } = isFeatureLength(enrichedReq.length) ? await generateFeatureScript(provider, enrichedReq, onProgress) : await provider.generateScriptBody(enrichedReq);
  const wordCount = countWords(body);
  logActivity("ai", isFeatureLength(req.length) ? "Generated feature-length script" : "Generated script", title);
  const script = {
    id: randomUUID2(),
    topic: req.topic,
    length: req.length,
    languageMix: req.languageMix,
    title,
    body,
    estimatedWordCount: wordCount,
    estimatedDurationMinutes: Math.round(wordCount / 150 * 10) / 10,
    createdAt: (/* @__PURE__ */ new Date()).toISOString()
  };
  saveToLibrary({ kind: "script", data: script, id: randomUUID2(), savedAt: (/* @__PURE__ */ new Date()).toISOString() });
  return script;
}

// _verify/scriptcheck.ts
try {
  const s = await generateScriptFlow({
    topic: "Why the Pakistani rupee moves",
    length: "short",
    languageMix: "balanced",
    styles: ["standard"]
  });
  console.log("SCRIPT_OK title=", JSON.stringify(s.title), "words=", s.estimatedWordCount);
} catch (e) {
  console.log("SCRIPT_ERROR:", e instanceof Error ? e.message : String(e));
}
process.exit(0);
