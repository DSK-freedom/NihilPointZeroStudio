/**
 * The AI Command Panel ("Studio Agent"). The user types a plain-English request
 * ("write a 2-minute anime script about Tesla and build it in 4K with calm music,
 * then make a thumbnail that says MELTDOWN") and the active AI turns it into an
 * ordered plan of SAFE, validated steps. The already-tested engine then executes
 * each step end-to-end, streaming progress.
 *
 * Exactly like the AI Director, the model only decides WHAT (a small fixed set of
 * steps with validated, clamped fields); this tested code does the HOW. A
 * hallucinated action type or field can never reach ffmpeg or the filesystem.
 *
 * The "brain" is whatever provider is active in Settings — free local Ollama by
 * default, or a paid cloud model — via getActiveProvider().
 */
import { randomUUID } from 'crypto'
import { join } from 'path'
import { getActiveProvider } from '../llm'
import { extractJson } from '../director'
import { generateIdeasFlow, generateScriptFlow } from '../services'
import { buildVideoFromScript, renderThumbnail } from '../video'
import { generateImage, sceneImagePrompt } from '../image'
import { renderMusic } from '../audio'
import { fetchPsxEod, analyzePsxBars, summarizePsxAnalysis } from '../data/psxLive'
import { buildAnalysisScriptPrompt } from '../data/analysisScript'
import { planScenes } from '../scene'
import { appendVideo, getScriptPad, logActivity, saveScriptPad, thumbnailsDir, videosDir } from '../store'
import {
  MOODS,
  VIDEO_STYLES,
  type AgentPlan,
  type AgentStep,
  type AgentStepResult,
  type LanguageMix,
  type Mood,
  type ScriptLength,
  type VideoJob,
  type VideoResolution,
  type VideoStyle
} from '../../shared/types'

const RESOLUTIONS: VideoResolution[] = ['1080p', '1440p', '4k', '8k']
const LANGUAGE_MIXES: LanguageMix[] = ['balanced', 'mostly-english', 'mostly-roman-urdu', 'formal-urdu']

function asStyle(v: unknown): VideoStyle | undefined {
  return VIDEO_STYLES.includes(v as VideoStyle) ? (v as VideoStyle) : undefined
}
function asResolution(v: unknown): VideoResolution | undefined {
  return RESOLUTIONS.includes(v as VideoResolution) ? (v as VideoResolution) : undefined
}
function asMood(v: unknown): Mood | 'none' | undefined {
  if (v === 'none') return 'none'
  return MOODS.includes(v as Mood) ? (v as Mood) : undefined
}
function asLanguageMix(v: unknown): LanguageMix | undefined {
  return LANGUAGE_MIXES.includes(v as LanguageMix) ? (v as LanguageMix) : undefined
}
function asString(v: unknown): string | undefined {
  return typeof v === 'string' && v.trim() ? v.trim() : undefined
}
function asNumber(v: unknown): number | undefined {
  return typeof v === 'number' && Number.isFinite(v) ? v : undefined
}

/**
 * Validates a raw parsed object into a safe AgentPlan. Unknown step types are
 * dropped; unknown enum values are dropped/defaulted; steps missing a required field
 * are dropped — so a hallucinated action can never reach the engine. Pure + unit-tested.
 */
export function sanitizeAgentPlan(raw: unknown): AgentPlan {
  const obj = (raw ?? {}) as Record<string, unknown>
  const reply = asString(obj.reply) ?? ''
  const rawSteps = Array.isArray(obj.steps) ? obj.steps : []
  const steps: AgentStep[] = []
  for (const s of rawSteps) {
    const step = (s ?? {}) as Record<string, unknown>
    switch (step.type) {
      case 'write_script': {
        const topic = asString(step.topic)
        if (!topic) break
        steps.push({
          type: 'write_script',
          topic,
          lengthMinutes: asNumber(step.lengthMinutes),
          languageMix: asLanguageMix(step.languageMix)
        })
        break
      }
      case 'build_video': {
        const source =
          step.source === 'generated' || step.source === 'scriptpad' || step.source === 'text'
            ? step.source
            : 'generated'
        steps.push({
          type: 'build_video',
          source,
          title: asString(step.title),
          body: asString(step.body),
          style: asStyle(step.style),
          resolution: asResolution(step.resolution),
          musicMood: asMood(step.musicMood),
          soundEffects: typeof step.soundEffects === 'boolean' ? step.soundEffects : undefined,
          aiVisuals: typeof step.aiVisuals === 'boolean' ? step.aiVisuals : undefined
        })
        break
      }
      case 'make_thumbnail': {
        const headline = asString(step.headline)
        if (!headline) break
        steps.push({
          type: 'make_thumbnail',
          headline,
          style: asStyle(step.style),
          aiBackground: typeof step.aiBackground === 'boolean' ? step.aiBackground : undefined
        })
        break
      }
      case 'generate_image': {
        const prompt = asString(step.prompt)
        if (!prompt) break
        steps.push({ type: 'generate_image', prompt, style: asStyle(step.style) })
        break
      }
      case 'generate_ideas': {
        const focus = asString(step.focus)
        if (!focus) break
        steps.push({ type: 'generate_ideas', focus, count: asNumber(step.count) })
        break
      }
      case 'write_scriptpad': {
        const text = asString(step.text)
        if (!text) break
        steps.push({
          type: 'write_scriptpad',
          text,
          title: asString(step.title),
          append: typeof step.append === 'boolean' ? step.append : undefined
        })
        break
      }
      case 'analyze_psx': {
        const symbol = asString(step.symbol)
        if (!symbol) break
        steps.push({
          type: 'analyze_psx',
          symbol,
          language: asString(step.language),
          makeScript: typeof step.makeScript === 'boolean' ? step.makeScript : undefined
        })
        break
      }
      case 'generate_music': {
        const mood = MOODS.includes(step.mood as Mood) ? (step.mood as Mood) : undefined
        if (!mood) break
        steps.push({ type: 'generate_music', mood, seconds: asNumber(step.seconds) })
        break
      }
      case 'plan_scenes': {
        const source = step.source === 'scriptpad' ? 'scriptpad' : 'generated'
        steps.push({ type: 'plan_scenes', source, style: asStyle(step.style), direction: asString(step.direction) })
        break
      }
      default:
        break
    }
  }
  return { reply: reply || (steps.length ? 'Here is the plan I will run.' : 'I could not turn that into an action.'), steps }
}

/** Builds the strict prompt that asks the model for a JSON plan of allowed steps. */
export function buildAgentPrompt(command: string, ctx: { hasScriptPad: boolean }): string {
  return [
    'You are the AI Command Panel of a video studio. Turn the user request into a JSON PLAN of steps.',
    'You can ONLY use these step types — never invent others, never add fields not listed:',
    '  {"type":"write_script","topic":"...","lengthMinutes":2,"languageMix":"balanced"}',
    '  {"type":"build_video","source":"generated|scriptpad|text","title":"...","body":"(only if source=text)","style":S,"resolution":R,"musicMood":M,"soundEffects":true,"aiVisuals":true}',
    '  {"type":"make_thumbnail","headline":"SHORT PUNCHY TEXT","style":S,"aiBackground":true}',
    '  {"type":"generate_image","prompt":"a red sports car on a mountain road, cinematic","style":S}',
    '  {"type":"generate_ideas","focus":"...","count":5}',
    '  {"type":"write_scriptpad","text":"the full text to place in the Script Pad","title":"...","append":false}',
    '  {"type":"analyze_psx","symbol":"LUCK","language":"English|Roman Urdu|Urdu","makeScript":true}',
    '  {"type":"generate_music","mood":M,"seconds":40}',
    '  {"type":"plan_scenes","source":"generated|scriptpad","style":S,"direction":"optional look note"}',
    '',
    `  S (style) is one of: ${VIDEO_STYLES.join(', ')}.`,
    `  R (resolution) is one of: ${RESOLUTIONS.join(', ')} (8k is very slow — only if asked).`,
    `  M (musicMood) is one of: ${MOODS.join(', ')}, or "none".`,
    '',
    'RULES:',
    '- "aiVisuals":true makes the video use FREE AI-generated images for each scene (real generated',
    '  visuals, not stock) — use it when the user asks for "real footage", "AI footage", or "actual visuals".',
    '- "aiBackground":true gives the thumbnail a real AI-generated background behind the headline.',
    '- Use generate_image for a standalone picture (an object, a place, a concept: "a car", "a rocket").',
    '- To create a full video from an idea, emit write_script FIRST, then build_video with source "generated".',
    '- analyze_psx fetches REAL live PSX prices for a symbol; with "makeScript":true it writes a narration',
    '  script from the figures, which a following build_video (source "generated") can turn into a video.',
    '- write_scriptpad puts text into the Script Pad ("append":true adds to what is there instead of replacing).',
    '- generate_music makes a standalone music bed; plan_scenes previews the scene breakdown of the script.',
    '- You can NEVER delete anything, change settings, or publish/upload — those are the user\'s alone.',
    `- source "scriptpad" uses the user's saved Script Pad${ctx.hasScriptPad ? ' (it currently has text)' : ' (currently EMPTY — do not use it)'}.`,
    '- source "text" requires you to put the actual narration in the "body" field.',
    '- Only include fields the user implied; omit the rest (the app uses sensible defaults: 1080p, cinematic, no music).',
    '- Keep the plan minimal and ordered. Do not repeat steps.',
    '- If the request is a question or cannot map to steps, return an empty steps array and answer in "reply".',
    '',
    'Respond with ONLY a JSON object: {"reply":"<one short sentence>","steps":[ ... ]}.',
    '',
    `USER REQUEST: ${command}`,
    '',
    'JSON:'
  ].join('\n')
}

/** Asks the active provider to turn a command into a validated plan. */
export async function interpretCommand(command: string): Promise<AgentPlan> {
  const provider = getActiveProvider()
  const hasScriptPad = !!getScriptPad().body.trim()
  const reply = await provider.generateText(buildAgentPrompt(command, { hasScriptPad }), 1400)
  const parsed = extractJson(reply)
  if (parsed == null) {
    return { reply: reply.trim() || 'I could not read that as a command. Try rephrasing.', steps: [] }
  }
  return sanitizeAgentPlan(parsed)
}

/** Maps a requested length in minutes to the closest supported script length. */
export function scriptLengthForMinutes(minutes?: number): ScriptLength {
  const m = minutes ?? 2
  if (m <= 2) return 'short'
  if (m <= 6) return 'long'
  return 'deep-dive'
}

function slug(text: string): string {
  return text.replace(/[^a-z0-9]+/gi, '-').toLowerCase().slice(0, 50) || 'video'
}

/**
 * Executes a validated plan step-by-step, reusing the same engine functions the rest
 * of the app uses. Each step is isolated: if one fails, its error is recorded and the
 * run continues, so a bad step never aborts the whole plan. Reports progress per step.
 */
export interface BatchResult {
  topic: string
  ok: boolean
  video?: VideoJob
  error?: string
}

/**
 * Batch mode: turn a list of topics into a video each (write a script → build it),
 * reusing the exact same validated engine as a single AI command. Reports progress
 * per topic; one failure never stops the rest.
 */
export async function runBatch(
  topics: string[],
  opts: {
    style?: VideoStyle
    resolution?: VideoResolution
    aiVisuals?: boolean
    onProgress?: (stage: string) => void
    onPreview?: (pngPath: string) => void
    stockApiKey?: string
  } = {}
): Promise<BatchResult[]> {
  const clean = topics.map((t) => t.trim()).filter(Boolean).slice(0, 25)
  const results: BatchResult[] = []
  for (let i = 0; i < clean.length; i++) {
    const topic = clean[i]
    opts.onProgress?.(`Batch ${i + 1}/${clean.length}: "${topic}"`)
    const plan = sanitizeAgentPlan({
      steps: [
        { type: 'write_script', topic },
        { type: 'build_video', source: 'generated', style: opts.style, resolution: opts.resolution, aiVisuals: opts.aiVisuals }
      ]
    })
    const stepResults = await executeAgentPlan(plan, {
      onProgress: opts.onProgress,
      onPreview: opts.onPreview,
      stockApiKey: opts.stockApiKey
    })
    const built = stepResults.find((r) => r.type === 'build_video')
    const failed = stepResults.find((r) => !r.ok)
    results.push(
      built?.ok && built.video
        ? { topic, ok: true, video: built.video }
        : { topic, ok: false, error: failed?.error ?? 'Build did not complete.' }
    )
  }
  return results
}

export async function executeAgentPlan(
  plan: AgentPlan,
  opts: { onProgress?: (stage: string) => void; onPreview?: (pngPath: string) => void; stockApiKey?: string } = {}
): Promise<AgentStepResult[]> {
  const { onProgress } = opts
  const results: AgentStepResult[] = []
  // Script written earlier in THIS run, so a later build_video can consume it.
  let generated: { title: string; body: string } | null = null

  for (let i = 0; i < plan.steps.length; i++) {
    const step = plan.steps[i]
    const n = `Step ${i + 1}/${plan.steps.length}`
    try {
      if (step.type === 'write_script') {
        onProgress?.(`${n}: Writing script about "${step.topic}"…`)
        const script = await generateScriptFlow(
          {
            topic: step.topic,
            length: scriptLengthForMinutes(step.lengthMinutes),
            languageMix: step.languageMix ?? 'balanced'
          },
          onProgress
        )
        generated = { title: script.title, body: script.body }
        results.push({ type: step.type, label: `Wrote script: "${script.title}"`, ok: true, detail: script.title })
      } else if (step.type === 'build_video') {
        const src =
          step.source === 'generated'
            ? generated
            : step.source === 'scriptpad'
              ? ((): { title: string; body: string } | null => {
                  const pad = getScriptPad()
                  return pad.body.trim() ? { title: step.title || pad.title || 'Video', body: pad.body } : null
                })()
              : step.body
                ? { title: step.title || 'Video', body: step.body }
                : null
        if (!src) {
          throw new Error(
            step.source === 'generated'
              ? 'No script was written earlier in this run — add a "write a script" step first.'
              : step.source === 'scriptpad'
                ? 'The Script Pad is empty.'
                : 'No script text was provided.'
          )
        }
        const res = (step.resolution ?? '1080p').toUpperCase()
        onProgress?.(`${n}: Building ${res} ${step.style ?? 'cinematic'} video…`)
        let musicPath: string | undefined
        if (step.musicMood && step.musicMood !== 'none') {
          onProgress?.(`${n}: Generating ${step.musicMood} music bed…`)
          musicPath = await renderMusic(step.musicMood, 40, 1)
        }
        const id = randomUUID()
        const outPath = join(videosDir(), `${slug(src.title)}-${id.slice(0, 8)}.mp4`)
        // Persist the narration-only track (same as the main Video Studio build) so the
        // user can later remove/replace this video's background music.
        const narrationOutPath = `${outPath}.narration.wav`
        // Free per-scene AI visuals when asked; otherwise the preset look with optional
        // free stock B-roll (when a Pixabay key is saved).
        const useAiVisuals = step.aiVisuals === true
        await buildVideoFromScript(src.title, src.body, outPath, onProgress, {
          resolution: step.resolution,
          style: step.style,
          soundEffects: step.soundEffects,
          musicPath,
          narrationOutPath,
          engine: useAiVisuals ? 'ai-free' : 'presets',
          // Free real B-roll when a Pixabay key is configured; silently falls back otherwise.
          useStock: !useAiVisuals && !!opts.stockApiKey,
          stockApiKey: opts.stockApiKey,
          onPreview: opts.onPreview
        })
        const job: VideoJob = { id, title: src.title, path: outPath, narrationPath: narrationOutPath, hasCustomVoice: false, createdAt: new Date().toISOString() }
        appendVideo(job)
        logActivity('ai', `AI Command built ${res} video`, src.title)
        results.push({ type: step.type, label: `Built ${res} video: "${src.title}"`, ok: true, video: job })
      } else if (step.type === 'make_thumbnail') {
        const style = step.style ?? 'cinematic'
        let bgImage: string | undefined
        if (step.aiBackground) {
          onProgress?.(`${n}: Generating AI thumbnail background…`)
          try {
            const bgPath = join(thumbnailsDir(), `thumbbg-${randomUUID().slice(0, 8)}.jpg`)
            bgImage = await generateImage(sceneImagePrompt(style, step.headline, ''), bgPath, { width: 1280, height: 720 })
          } catch (err) {
            onProgress?.(`AI background failed (${err instanceof Error ? err.message : 'error'}) — using a styled background.`)
          }
        }
        onProgress?.(`${n}: Making thumbnail "${step.headline}"…`)
        const outPath = join(thumbnailsDir(), `thumb-${randomUUID().slice(0, 8)}.png`)
        await renderThumbnail(step.headline, style, outPath, bgImage)
        logActivity('ai', 'AI Command made a thumbnail', step.headline)
        results.push({ type: step.type, label: `Made thumbnail: "${step.headline}"`, ok: true, path: outPath })
      } else if (step.type === 'generate_image') {
        onProgress?.(`${n}: Generating image — "${step.prompt}"…`)
        const outPath = join(thumbnailsDir(), `image-${randomUUID().slice(0, 8)}.jpg`)
        const prompt = step.style ? sceneImagePrompt(step.style, step.prompt, '') : step.prompt
        await generateImage(prompt, outPath, { width: 1280, height: 720 })
        if (opts.onPreview) opts.onPreview(outPath)
        logActivity('ai', 'AI Command generated an image', step.prompt)
        results.push({ type: 'generate_image', label: `Generated image: "${step.prompt}"`, ok: true, path: outPath })
      } else if (step.type === 'generate_ideas') {
        onProgress?.(`${n}: Generating ideas about "${step.focus}"…`)
        const count = Math.min(Math.max(Math.round(step.count ?? 5), 1), 10)
        const ideas = await generateIdeasFlow({ focusArea: step.focus, count })
        results.push({
          type: step.type,
          label: `Generated ${ideas.length} ideas about "${step.focus}" (saved to Library)`,
          ok: true,
          detail: ideas.map((idea) => idea.title).join(' • ')
        })
      } else if (step.type === 'write_scriptpad') {
        onProgress?.(`${n}: ${step.append ? 'Appending to' : 'Writing'} the Script Pad…`)
        const pad = getScriptPad()
        const title = step.title ?? pad.title
        const body = step.append && pad.body.trim() ? `${pad.body.trimEnd()}\n\n${step.text}` : step.text
        saveScriptPad(title, body)
        logActivity('ai', `AI Command ${step.append ? 'appended to' : 'wrote'} the Script Pad`, title || undefined)
        results.push({ type: step.type, label: `${step.append ? 'Appended to' : 'Wrote'} the Script Pad`, ok: true, detail: title || undefined })
      } else if (step.type === 'analyze_psx') {
        onProgress?.(`${n}: Fetching live PSX data for ${step.symbol}…`)
        const bars = await fetchPsxEod(step.symbol)
        const analysis = analyzePsxBars(step.symbol, bars)
        const summary = summarizePsxAnalysis(analysis)
        if (step.makeScript) {
          onProgress?.(`${n}: Writing a narration script for ${analysis.symbol}…`)
          const prompt = buildAnalysisScriptPrompt({
            kind: 'technical',
            subject: `${analysis.symbol} on the PSX`,
            figures: summary,
            directives: step.language ? { language: step.language } : undefined
          })
          const script = await getActiveProvider().generateText(prompt, 1800)
          // Hand the script to a later build_video step in this run (source "generated").
          generated = { title: `${analysis.symbol} — PSX Live Analysis (${analysis.latestDate})`, body: script }
          logActivity('ai', 'AI Command wrote a PSX analysis script', analysis.symbol)
          results.push({ type: step.type, label: `Analyzed ${analysis.symbol} + wrote a narration script`, ok: true, detail: summary })
        } else {
          logActivity('ai', 'AI Command analyzed live PSX data', analysis.symbol)
          results.push({ type: step.type, label: `Analyzed live PSX data for ${analysis.symbol}`, ok: true, detail: summary })
        }
      } else if (step.type === 'generate_music') {
        const seconds = Math.min(Math.max(Math.round(step.seconds ?? 40), 5), 300)
        onProgress?.(`${n}: Generating a ${seconds}s ${step.mood} music bed…`)
        const src = await renderMusic(step.mood, seconds, 1)
        logActivity('ai', 'AI Command generated a music bed', `${step.mood} · ${seconds}s`)
        results.push({ type: step.type, label: `Generated a ${seconds}s ${step.mood} music bed`, ok: true, path: src })
      } else if (step.type === 'plan_scenes') {
        const src =
          step.source === 'scriptpad'
            ? ((): { title: string; body: string } | null => {
                const pad = getScriptPad()
                return pad.body.trim() ? { title: pad.title || 'Script', body: pad.body } : null
              })()
            : generated
        if (!src) {
          throw new Error(
            step.source === 'scriptpad'
              ? 'The Script Pad is empty — nothing to plan scenes from.'
              : 'No script was written earlier in this run — add a "write a script" step first.'
          )
        }
        onProgress?.(`${n}: Planning the scene breakdown…`)
        const scenes = planScenes(src.title, src.body, step.style ?? 'cinematic', step.direction ?? '')
        results.push({
          type: step.type,
          label: `Planned ${scenes.length} scene${scenes.length === 1 ? '' : 's'} from the script`,
          ok: true,
          detail: scenes.map((s) => `${s.index + 1}. ${s.label}`).join('\n')
        })
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      results.push({ type: step.type, label: `Step ${i + 1} failed`, ok: false, error: message })
      onProgress?.(`${n} failed: ${message}`)
    }
  }
  return results
}
