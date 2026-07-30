import { mkdtempSync, rmSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { makeFfmpegProgressLogger, runFfmpeg } from './ffmpeg'
import { chooseEncoderForJob, encoderLabel, isHardware, runEncodeWithFallback } from './encoder'
import { finishingChain, templateFor, titleAlphaExpr, type VideoTemplate } from './templates'
import type { VideoStyle } from '../../shared/types'

export type VideoResolution = '1080p' | '1440p' | '4k' | '8k'
export type { VideoStyle } from '../../shared/types'
export type VideoAspect = '16:9' | '9:16' | '1:1'

/** Colors + sizing that give each preset style a distinct look. */
export interface StyleTheme {
  /** Background fill (hex 0xRRGGBB) when no images/animation are used. */
  bgColor: string
  /** Title text color. */
  titleColor: string
  /** Section-card text color. */
  cardColor: string
  /** Waveform color+alpha for showwaves (0xRRGGBB@a). */
  waveColor: string
  /** Multiplier applied to base font sizes. */
  fontScale: number
  /** Animated-gradient endpoints + type for the moving background. */
  gradFrom: string
  gradTo: string
  gradType: 'linear' | 'radial' | 'circular'
}

export const STYLE_THEMES: Record<VideoStyle, StyleTheme> = {
  cinematic: { bgColor: '0x0B0F1A', titleColor: '0xF5E9C8', cardColor: '0xFFFFFF', waveColor: '0xE8B923@0.85', fontScale: 1, gradFrom: '0x0B0F1A', gradTo: '0x1A2A44', gradType: 'radial' },
  cartoon: { bgColor: '0x1B6CA8', titleColor: '0xFFF14D', cardColor: '0xFFFFFF', waveColor: '0xFF5DA2@0.9', fontScale: 1.12, gradFrom: '0x1B6CA8', gradTo: '0x33B0E0', gradType: 'linear' },
  anime: { bgColor: '0x14122B', titleColor: '0xFF9EE6', cardColor: '0xB6F0FF', waveColor: '0x8A7CFF@0.9', fontScale: 1.06, gradFrom: '0x14122B', gradTo: '0x3A2A6B', gradType: 'radial' },
  neon: { bgColor: '0x05010D', titleColor: '0x39FF14', cardColor: '0x00E5FF', waveColor: '0xFF00E5@0.9', fontScale: 1, gradFrom: '0x05010D', gradTo: '0x2A004A', gradType: 'radial' },
  minimal: { bgColor: '0xF5F5F0', titleColor: '0x111111', cardColor: '0x222222', waveColor: '0x888888@0.8', fontScale: 1, gradFrom: '0xF5F5F0', gradTo: '0xE2E2DA', gradType: 'linear' },

  // Cinematic variants
  noir: { bgColor: '0x0A0A0A', titleColor: '0xF2F2F2', cardColor: '0xD8D8D8', waveColor: '0xFFFFFF@0.75', fontScale: 1, gradFrom: '0x000000', gradTo: '0x2E2E2E', gradType: 'linear' },
  blockbuster: { bgColor: '0x061218', titleColor: '0xFFB169', cardColor: '0xE8F6FF', waveColor: '0xFF8C42@0.9', fontScale: 1.04, gradFrom: '0x061821', gradTo: '0x1E5C6E', gradType: 'radial' },
  'vintage-film': { bgColor: '0x1A140C', titleColor: '0xF3D9A4', cardColor: '0xF7ECD8', waveColor: '0xD9A441@0.85', fontScale: 1, gradFrom: '0x1A140C', gradTo: '0x4A3520', gradType: 'linear' },
  documentary: { bgColor: '0x141618', titleColor: '0xFFFFFF', cardColor: '0xE6E6E6', waveColor: '0xB0B0B0@0.8', fontScale: 0.98, gradFrom: '0x141618', gradTo: '0x30363B', gradType: 'linear' },

  // Cartoon variants
  'cartoon-3d': { bgColor: '0x1E4FA3', titleColor: '0xFFE066', cardColor: '0xFFFFFF', waveColor: '0x6BE3FF@0.9', fontScale: 1.1, gradFrom: '0x1E4FA3', gradTo: '0x59A5F5', gradType: 'radial' },
  comic: { bgColor: '0xF2E7C9', titleColor: '0xD62828', cardColor: '0x1A1A1A', waveColor: '0x003049@0.9', fontScale: 1.14, gradFrom: '0xF2E7C9', gradTo: '0xFFD166', gradType: 'linear' },
  watercolour: { bgColor: '0xFBF6EE', titleColor: '0x4A5D6B', cardColor: '0x33424E', waveColor: '0x8FB3C7@0.8', fontScale: 1.04, gradFrom: '0xFBF6EE', gradTo: '0xDCE9F0', gradType: 'linear' },

  // Anime variants
  'anime-90s': { bgColor: '0x1C1A24', titleColor: '0xF6C6A8', cardColor: '0xE9E1D6', waveColor: '0xC98F7A@0.85', fontScale: 1.04, gradFrom: '0x1C1A24', gradTo: '0x46374A', gradType: 'linear' },
  'anime-pastoral': { bgColor: '0x123A2E', titleColor: '0xFFF4C2', cardColor: '0xEAFBEF', waveColor: '0x8FD9A8@0.85', fontScale: 1.06, gradFrom: '0x123A2E', gradTo: '0x3E8E6B', gradType: 'radial' },
  'anime-dark': { bgColor: '0x0C0C10', titleColor: '0xC8102E', cardColor: '0xD6D6DE', waveColor: '0x8A0F26@0.9', fontScale: 1.02, gradFrom: '0x0C0C10', gradTo: '0x2A1016', gradType: 'radial' },

  infographic: { bgColor: '0xFFFFFF', titleColor: '0x0B3C5D', cardColor: '0x1D3557', waveColor: '0x457B9D@0.85', fontScale: 1, gradFrom: '0xFFFFFF', gradTo: '0xDCE9F2', gradType: 'linear' }
}

/**
 * Builds an animated `gradients` lavfi source string for a theme — a slow, smooth
 * moving gradient that fills WxH for `durSec` seconds. Cheap at any resolution
 * (unlike per-pixel geq), so it works even at 4K/8K. Pure + unit-tested.
 */
export function buildGradientSource(theme: StyleTheme, w: number, h: number, durSec: number): string {
  return (
    `gradients=s=${w}x${h}:c0=${theme.gradFrom}:c1=${theme.gradTo}:nb_colors=2:` +
    `type=${theme.gradType}:speed=0.006:d=${durSec.toFixed(2)}:r=25`
  )
}

/** Returns the theme for a style, defaulting to cinematic. */
export function themeFor(style: VideoStyle = 'cinematic'): StyleTheme {
  return STYLE_THEMES[style] ?? STYLE_THEMES.cinematic
}

/** The SHORT side (px) for each quality tier. The long side follows the aspect ratio. */
const SHORT_SIDE: Record<VideoResolution, number> = {
  '1080p': 1080,
  '1440p': 1440,
  '4k': 2160,
  '8k': 4320
}

/**
 * Pixel [width,height] for a resolution tier + aspect. 16:9 is landscape (long side is
 * width), 9:16 is portrait (Shorts/Reels), 1:1 is square. The 16:9 values are identical
 * to before (e.g. 1080p→1920x1080), so existing videos are unchanged. Pure + tested.
 */
export function dimensionsFor(resolution: VideoResolution = '1080p', aspect: VideoAspect = '16:9'): [number, number] {
  const short = SHORT_SIDE[resolution] ?? 1080
  const long = Math.round((short * 16) / 9)
  if (aspect === '9:16') return [short, long]
  if (aspect === '1:1') return [short, short]
  return [long, short]
}

/** A font that exists on every Windows install; escaped for use inside an ffmpeg filtergraph. */
function fontArg(): string {
  const path = `${process.env.WINDIR ?? 'C:\\Windows'}\\Fonts\\arial.ttf`
  return path.replace(/\\/g, '/').replace(/:/g, '\\:')
}

/** Path for a drawtext `textfile=` / input option, escaped for the filtergraph. */
function fileArg(path: string): string {
  return path.replace(/\\/g, '/').replace(/:/g, '\\:')
}

export interface Layout {
  w: number
  h: number
  titleFont: number
  cardFont: number
  waveW: number
  waveH: number
  titleY: number
  waveMargin: number
}

/**
 * Pixel dimensions and proportionally-scaled font/element sizes. Everything
 * scales off width relative to 1080p, so 4K is 2x and 8K is 4x — the layout is
 * identical, just sharper. Pure + exported for unit testing.
 */
export function computeLayout(resolution: VideoResolution = '1080p', aspect: VideoAspect = '16:9'): Layout {
  const [w, h] = dimensionsFor(resolution, aspect)
  // Scale off the SHORT side so text/waveform stay readable and contained in any shape.
  // For 16:9 this equals the old w/1920 exactly (min(w,h)=h, /1080), so nothing changes.
  const k = Math.min(w, h) / 1080
  return {
    w,
    h,
    titleFont: Math.round(56 * k),
    cardFont: Math.round(72 * k),
    waveW: w,
    waveH: Math.round(220 * k),
    titleY: Math.round(90 * k),
    waveMargin: Math.round(50 * k)
  }
}

export interface AudioPlan {
  chains: string[]
  audioMap: string
  /** Ordered extra inputs after narration: 'music' then one 'sfx' per transition. */
  extraInputs: Array<'music' | 'sfx'>
}

/**
 * Builds the audio portion of the filtergraph. Pure + exported for unit testing.
 *
 * - Narration ([1:a]) always drives the waveform. When we also mix music/SFX we
 *   MUST split it first (an input pad can't feed two filters), so we `asplit`.
 * - Music is volume-lowered and fades in/out so it sits cleanly under the voice
 *   ("smart placement"): a bed, never competing with the narration.
 * - Each section transition gets a soft SFX whoosh, delayed to its timestamp.
 * - `amix ... normalize=0` keeps the narration at full level (default amix would
 *   quietly duck everything as inputs grow).
 */
export function buildAudioFilter(opts: {
  hasMusic: boolean
  sfxTimesSec: number[]
  dur: number
  layout: Layout
  /** Waveform color+alpha (0xRRGGBB@a); defaults to the cinematic gold. */
  waveColor?: string
}): AudioPlan {
  const { hasMusic, sfxTimesSec, dur, layout } = opts
  const waveColor = opts.waveColor ?? '0xE8B923@0.85'
  const wave = `showwaves=s=${layout.waveW}x${layout.waveH}:mode=cline:rate=25:colors=${waveColor}`
  const needMix = hasMusic || sfxTimesSec.length > 0
  if (!needMix) {
    // Narration only — identical to the long-verified path.
    return { chains: [`[1:a]${wave}[wave]`], audioMap: '1:a', extraInputs: [] }
  }

  // Normalise every mix input to one sample-rate + layout first — Piper narration is
  // 16 kHz mono while music/SFX are 44.1 kHz, and amix on mismatched inputs is unreliable.
  const NORM = 'aresample=44100,aformat=sample_fmts=fltp:channel_layouts=stereo'
  const chains = [`[1:a]${NORM},asplit=2[awave][anarr]`, `[awave]${wave}[wave]`]
  const mixLabels: string[] = ['[anarr]']
  const extraInputs: Array<'music' | 'sfx'> = []
  let idx = 2

  if (hasMusic) {
    const fadeOutStart = Math.max(0.1, dur - 2.5)
    chains.push(
      `[${idx}:a]${NORM},volume=0.18,afade=t=in:st=0:d=1.5,afade=t=out:st=${fadeOutStart.toFixed(2)}:d=2.5[mus]`
    )
    mixLabels.push('[mus]')
    extraInputs.push('music')
    idx++
  }

  sfxTimesSec.forEach((t, i) => {
    const ms = Math.max(0, Math.round(t * 1000))
    chains.push(`[${idx}:a]${NORM},adelay=${ms}:all=1,volume=0.5[wh${i}]`)
    mixLabels.push(`[wh${i}]`)
    extraInputs.push('sfx')
    idx++
  })

  // normalize=0 keeps narration at its authored level; the summed narration + ducked music
  // + whoosh(es) can still exceed 0 dBFS, so a final peak limiter (level=disabled = attenuate
  // overs only, never make-up gain) prevents encoder clipping.
  chains.push(
    `${mixLabels.join('')}amix=inputs=${mixLabels.length}:duration=first:normalize=0[amx];[amx]alimiter=limit=0.95:level=disabled[aout]`
  )
  return { chains, audioMap: '[aout]', extraInputs }
}

/**
 * Assembles the full ffmpeg argument list. Pure + exported for unit testing.
 * Inputs are, in order: the color background, the narration, then (matching
 * AudioPlan.extraInputs) the looped music and one whoosh input per SFX cue.
 */
export type BackgroundSpec =
  | { kind: 'color'; color: string }
  | { kind: 'animated'; source: string }
  | { kind: 'file'; path: string }

export function buildFfmpegArgs(params: {
  layout: Layout
  dur: number
  audioPath: string
  musicPath?: string
  sfxCount: number
  whooshPath?: string
  filter: string
  videoMap: string
  audioMap: string
  outPath: string
  /** Background: a solid color (default) or a pre-rendered slideshow file. */
  background?: BackgroundSpec
  /** `-c:v …` block (from encoder.ts). Defaults to CPU libx264. */
  videoEncoderArgs?: string[]
}): string[] {
  const { layout, dur, audioPath, musicPath, sfxCount, whooshPath, filter, videoMap, audioMap, outPath } = params
  const videoEncoderArgs = params.videoEncoderArgs ?? ['-c:v', 'libx264', '-preset', 'veryfast', '-pix_fmt', 'yuv420p']
  const bg: BackgroundSpec = params.background ?? { kind: 'color', color: '0x0B0F1A' }
  const bgInput =
    bg.kind === 'color'
      ? ['-f', 'lavfi', '-i', `color=c=${bg.color}:s=${layout.w}x${layout.h}:d=${dur.toFixed(2)}`]
      : bg.kind === 'animated'
        ? ['-f', 'lavfi', '-i', bg.source]
        : ['-i', bg.path]
  const args = ['-y', ...bgInput, '-i', audioPath]
  if (musicPath) args.push('-stream_loop', '-1', '-i', musicPath)
  for (let i = 0; i < sfxCount; i++) args.push('-i', whooshPath as string)
  args.push(
    '-filter_complex',
    filter,
    '-map',
    videoMap,
    '-map',
    audioMap,
    ...videoEncoderArgs,
    '-r',
    '25',
    '-c:a',
    'aac',
    '-b:a',
    '192k',
    '-shortest',
    '-movflags',
    '+faststart',
    outPath
  )
  return args
}

/**
 * Derives the on-screen "cards" that cycle through the video: the bracketed
 * stage directions / section titles in the script (e.g. [PATTERN INTERRUPT],
 * [TRADE DEFICIT]). Falls back to a few generic cards if none are found.
 */
export function extractCards(body: string, title: string): string[] {
  // 1) Honour explicit [BRACKET] sections when the writer provided them.
  const bracket: string[] = []
  for (const line of body.split(/\r?\n/)) {
    const m = /^\s*\[([^\]]{2,40})\]\s*$/.exec(line)
    if (m) bracket.push(m[1].trim())
  }
  const uniqueBrackets = [...new Set(bracket)]
  if (uniqueBrackets.length >= 2) return uniqueBrackets

  // 2) Otherwise DERIVE several scenes from the prose so the video has real variety
  //    (many distinct scenes/images), instead of just 3 static cards. Aim ~1 scene per
  //    ~24 words, 4–10 scenes. Each label = the opening words of a sentence-group.
  const clean = body.replace(/^\s*\[[^\]]*\]\s*$/gm, ' ').replace(/\s+/g, ' ').trim()
  const words = clean ? clean.split(' ').filter(Boolean) : []
  if (words.length < 12) return [title.slice(0, 40) || 'FinScript', 'ANALYSIS', 'KEY TAKEAWAY']

  const sentences = clean.split(/(?<=[.!?])\s+/).map((s) => s.trim()).filter((s) => s.length > 0)
  // Scale scene/section count to the SCRIPT LENGTH so long scripts aren't stuck on a few
  // static cards: ~1 section per ~22 words, 4–40. (A 25-min ~3500-word script → ~40
  // sections; the renderer paces them evenly across the narration.)
  const target = Math.min(40, Math.max(4, Math.round(words.length / 22)))
  const per = Math.max(1, Math.ceil(sentences.length / target))
  const labels: string[] = []
  for (let i = 0; i < sentences.length && labels.length < target; i += per) {
    const chunk = sentences.slice(i, i + per).join(' ')
    const label = chunk.split(' ').slice(0, 5).join(' ').replace(/[.!?,;:]+$/, '').trim()
    if (label) labels.push(label)
  }
  const unique = [...new Set(labels)]
  return unique.length >= 2 ? unique : [title.slice(0, 40) || 'FinScript', 'ANALYSIS', 'KEY TAKEAWAY']
}

/**
 * Extracts the FULL text of each `[bracketed cinematic direction]` in the script, in order,
 * as rich image-generation prompts. Unlike `extractCards` (which caps brackets at 40 chars
 * because it uses them as short ON-SCREEN labels), this keeps the entire direction — e.g.
 * "[Cinematic extreme close-up of a stressed investor's glasses reflecting a crashing red
 * ticker…]" — so the generated AI image actually FOLLOWS the writer's shot description
 * instead of a 5-word snippet of narration. Exact duplicates are collapsed; order is kept.
 * Returns [] when the script has no bracketed directions (caller then derives scenes from prose).
 */
export function extractScenePrompts(body: string): string[] {
  const prompts: string[] = []
  const seen = new Set<string>()
  // Match a bracketed block that may span multiple lines; [^\]] keeps it to a single [...] group.
  const re = /\[\s*([^\]]{8,})\]/g
  let m: RegExpExecArray | null
  while ((m = re.exec(body)) !== null) {
    const text = m[1].replace(/\s+/g, ' ').trim()
    if (!text) continue
    const key = text.toLowerCase()
    if (seen.has(key)) continue
    seen.add(key)
    prompts.push(text)
  }
  return prompts
}

/** Removes characters that are painful inside drawtext; card text is short so this is safe. */
function sanitizeCard(text: string): string {
  return text.replace(/[^A-Za-z0-9 ,.!?%&/-]/g, ' ').replace(/\s+/g, ' ').trim().toUpperCase()
}

export interface RenderOptions {
  title: string
  body: string
  audioPath: string
  durationSec: number
  outPath: string
  /** Output resolution — 1080p (default), 1440p, 4k, or 8k. */
  resolution?: VideoResolution
  /** Frame shape — 16:9 (default), 9:16 (Shorts/Reels), or 1:1 (square). */
  aspect?: VideoAspect
  /** Optional background music file, mixed (volume-lowered, faded) under the narration. */
  musicPath?: string
  /** Add a soft whoosh at each section transition. */
  soundEffects?: boolean
  /** Visual style (preset engine). Defaults to cinematic. */
  style?: VideoStyle
  /** Graphics v2 finishing template (grade/vignette/grain/letterbox/animated title). */
  template?: VideoTemplate
  /** Optional user image paths for a Ken-Burns slideshow background. */
  images?: string[]
  /** A pre-rendered background video (e.g. assembled stock footage). Takes precedence. */
  backgroundVideo?: string
  /** Animated moving-gradient background (default true). Set false for a flat color. */
  animatedBg?: boolean
  onLog?: (line: string) => void
  /** Coarse, user-facing status notices (e.g. encoder choice / CPU fallback / % done). */
  onProgress?: (stage: string) => void
  /** Called once with a small preview PNG of the opening frame, so the UI can show the
   * look immediately instead of waiting for the whole render. Best-effort. */
  onPreview?: (pngPath: string) => void
}

/**
 * Renders a single small PNG of the opening frame of the chosen background, so the UI
 * can show what the video looks like right away. Cheap even at 8K (one downscaled
 * frame). Best-effort — never throws into the build.
 */
async function renderPreviewFrame(bg: BackgroundSpec, layout: Layout, previewPath: string): Promise<void> {
  const input =
    bg.kind === 'file'
      ? ['-i', bg.path]
      : bg.kind === 'animated'
        ? ['-f', 'lavfi', '-i', bg.source]
        : ['-f', 'lavfi', '-i', `color=c=${bg.color}:s=${layout.w}x${layout.h}:d=1`]
  await runFfmpeg(['-y', ...input, '-frames:v', '1', '-vf', 'scale=640:-2', previewPath])
}

/** The distinct Ken-Burns camera moves we cycle through, so consecutive shots differ. */
export type KenBurnsMotion = 'zoom-in' | 'pan-right' | 'zoom-out' | 'pan-left'
export const KEN_BURNS_MOTIONS: KenBurnsMotion[] = ['zoom-in', 'pan-right', 'zoom-out', 'pan-left']

/**
 * The `zoompan=…` expression for one Ken-Burns move. All four are validated to run
 * with the bundled ffmpeg. Uses `on` (output frame) so motion is deterministic, and
 * `pzoom` for a smooth zoom-out. Pure + unit-tested.
 */
export function zoompanExpr(motion: KenBurnsMotion, frames: number, w: number, h: number): string {
  const common = `d=${frames}:s=${w}x${h}:fps=25`
  const center = `x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)'`
  switch (motion) {
    case 'zoom-in':
      return `zoompan=z='min(1.0+0.0015*on,1.5)':${center}:${common}`
    case 'zoom-out':
      return `zoompan=z='if(lte(on,0),1.5,max(1.0,pzoom-0.0015))':${center}:${common}`
    case 'pan-right':
      return `zoompan=z='1.25':x='(iw-iw/zoom)*min(on/${frames},1)':y='ih/2-(ih/zoom/2)':${common}`
    case 'pan-left':
      return `zoompan=z='1.25':x='(iw-iw/zoom)*(1-min(on/${frames},1))':y='ih/2-(ih/zoom/2)':${common}`
  }
}

export interface SlideshowShot {
  imageIndex: number
  motion: KenBurnsMotion
}

/**
 * Plans the shots for a slideshow. The key fix for "the same 3 images going back and
 * forth": instead of one static shot per image, we cut a shot roughly every ~6 seconds
 * and give each a DIFFERENT camera move (cycling zoom-in / pan-right / zoom-out /
 * pan-left), reusing images round-robin. So even 3 images over a minute become ~10
 * distinct, moving shots that feel alive rather than a slow ping-pong. Pure + tested.
 */
export function planSlideshowShots(imageCount: number, durationSec: number): SlideshowShot[] {
  const imgs = Math.max(1, imageCount)
  const target = Math.min(12, Math.max(imgs, Math.round(Math.max(1, durationSec) / 6)))
  const shots: SlideshowShot[] = []
  for (let i = 0; i < target; i++) {
    shots.push({ imageIndex: i % imgs, motion: KEN_BURNS_MOTIONS[i % KEN_BURNS_MOTIONS.length] })
  }
  return shots
}

/**
 * Renders a Ken-Burns slideshow of the given images to `outPath` at the layout size
 * for `dur` seconds. Each shot cover-scales, crops to frame, then applies a varied
 * camera move (see planSlideshowShots). Pure ffmpeg — no paid service.
 */
export async function makeSlideshow(
  images: string[],
  layout: Layout,
  dur: number,
  outPath: string
): Promise<void> {
  const shots = planSlideshowShots(images.length, dur)
  const n = shots.length
  const slot = Math.max(1, dur / n)
  const fps = 25
  const frames = Math.round(slot * fps)
  const inputs: string[] = []
  shots.forEach((shot) => {
    // Feed EXACTLY ONE frame per shot; zoompan (below, d=frames) expands that single
    // frame into `frames` output frames. The old `-loop 1 -t <slot>` fed slot*fps input
    // frames and zoompan emits `d` frames PER input frame → a ~100x frame EXPLOSION
    // (measured: 10,000 frames / 400s for a 4s shot). That made every render run far past
    // the narration length and crash ffmpeg with code 4294967295. One input frame + d=frames
    // yields exactly the intended duration.
    inputs.push('-i', images[shot.imageIndex])
  })
  const segs = shots.map((shot, i) =>
    `[${i}:v]scale=${layout.w}:${layout.h}:force_original_aspect_ratio=increase,` +
    `crop=${layout.w}:${layout.h},setsar=1,${zoompanExpr(shot.motion, frames, layout.w, layout.h)}[s${i}]`
  )
  const concatInputs = shots.map((_, i) => `[s${i}]`).join('')
  const filter = `${segs.join(';')};${concatInputs}concat=n=${n}:v=1:a=0[v]`
  await runFfmpeg([
    '-y',
    ...inputs,
    '-filter_complex',
    filter,
    '-map',
    '[v]',
    '-c:v',
    'libx264',
    '-preset',
    'veryfast',
    '-pix_fmt',
    'yuv420p',
    '-r',
    String(fps),
    outPath
  ])
}

/** Generates a short, soft "whoosh" transition sound (pink-noise swish). Free — no files. */
async function makeWhoosh(outPath: string): Promise<void> {
  await runFfmpeg([
    '-y',
    '-f',
    'lavfi',
    '-i',
    'anoisesrc=d=0.35:c=pink:r=44100',
    '-af',
    'afade=t=in:d=0.03,afade=t=out:st=0.15:d=0.2,lowpass=f=2500,volume=0.9',
    outPath
  ])
}

/**
 * Renders an H.264 / AAC MP4 (YouTube-accepted) at 1080p/1440p/4K/8K: a dark
 * studio background, a persistent title, section cards that cycle in time with
 * the narration, an audio-reactive waveform, optional background music (faded &
 * ducked), and optional transition sound effects. All ffmpeg — no paid service.
 */
export async function renderVideo(opts: RenderOptions): Promise<void> {
  const scratch = mkdtempSync(join(tmpdir(), 'finscript-video-'))
  try {
    const layout = computeLayout(opts.resolution, opts.aspect)
    const theme = themeFor(opts.style)
    const titleFont = Math.round(layout.titleFont * theme.fontScale)
    const cardFont = Math.round(layout.cardFont * theme.fontScale)
    const cards = extractCards(opts.body, opts.title).map(sanitizeCard).filter(Boolean)
    // Never let cards be empty: slot = dur/cards.length would become Infinity/NaN and every
    // enable='between(t,…)' expression would be invalid → an ffmpeg parse error.
    if (cards.length === 0) cards.push(sanitizeCard(opts.title) || 'ANALYSIS')
    const dur = Math.max(1, opts.durationSec)

    const titleFile = join(scratch, 'title.txt')
    writeFileSync(titleFile, sanitizeCard(opts.title) || 'FINSCRIPT STUDIO', 'utf-8')

    const font = fontArg()
    const slot = dur / cards.length

    // SFX at each transition (start of cards 1..N-1), only when enabled.
    const sfxTimesSec = opts.soundEffects ? cards.slice(1).map((_, i) => (i + 1) * slot) : []
    let whooshPath: string | undefined
    if (sfxTimesSec.length) {
      whooshPath = join(scratch, 'whoosh.wav')
      await makeWhoosh(whooshPath)
    }

    // Background: a Ken-Burns slideshow of the user's images if provided; otherwise a
    // themed animated moving gradient (richer than a flat color), unless explicitly
    // turned off (then a solid themed color).
    let background: BackgroundSpec =
      opts.animatedBg === false
        ? { kind: 'color', color: theme.bgColor }
        : { kind: 'animated', source: buildGradientSource(theme, layout.w, layout.h, dur) }
    if (opts.backgroundVideo) {
      // Pre-assembled footage (e.g. stock B-roll) — use it directly.
      background = { kind: 'file', path: opts.backgroundVideo }
    } else if (opts.images && opts.images.length) {
      // One corrupt/truncated image must not abort the whole build — fall back to the
      // animated gradient (the storyboard path already does this; the main path didn't).
      try {
        const bgPath = join(scratch, 'bg.mp4')
        await makeSlideshow(opts.images, layout, dur, bgPath)
        background = { kind: 'file', path: bgPath }
      } catch (err) {
        opts.onProgress?.(`Slideshow failed (${err instanceof Error ? err.message : 'error'}) — using the animated look instead.`)
      }
    }

    // Best-effort opening-frame preview so the UI shows the look immediately.
    if (opts.onPreview) {
      const previewPath = `${opts.outPath}.preview.png`
      try {
        await renderPreviewFrame(background, layout, previewPath)
        opts.onPreview(previewPath)
      } catch {
        /* preview is optional — never block the build */
      }
    }

    const audio = buildAudioFilter({ hasMusic: !!opts.musicPath, sfxTimesSec, dur, layout, waveColor: theme.waveColor })
    const chains: string[] = [...audio.chains]

    // Persistent title near the top. (Windows ffmpeg quirk: both fontfile and
    // textfile must be single-quoted with escaped colon, else "both text and
    // textfile". Timeline expressions are single-quoted so commas stay literal.)
    const tpl = templateFor(opts.template)
    const titleAlpha = tpl.animateTitle ? `:alpha='${titleAlphaExpr()}'` : ''
    chains.push(
      `[0:v]drawtext=fontfile='${font}':textfile='${fileArg(titleFile)}':fontcolor=${theme.titleColor}:fontsize=${titleFont}:x=(w-tw)/2:y=${layout.titleY}${titleAlpha}[v0]`
    )
    chains.push(`[v0][wave]overlay=x=0:y=H-h-${layout.waveMargin}[v1]`)

    let prev = 'v1'
    cards.forEach((card, i) => {
      const cardFile = join(scratch, `card${i}.txt`)
      writeFileSync(cardFile, card, 'utf-8')
      const start = i * slot
      const s = start.toFixed(2)
      const end = (i === cards.length - 1 ? dur : (i + 1) * slot).toFixed(2)
      const next = `c${i}`
      const alpha = `if(lt(t,${s}),0,if(lt(t,${(start + 0.6).toFixed(2)}),(t-${s})/0.6,1))`

      if (tpl.lowerThird) {
        // Broadcast-style animated LOWER-THIRD: an accent bar + label slide in from the left.
        const barW = Math.round(layout.w * 0.42)
        const barH = Math.round(layout.h * 0.085)
        const barY = layout.h - Math.round(layout.h * 0.17)
        const travel = barW + 120
        const slide = `min((t-${s})/0.4,1)`
        const bar = `b${i}`
        chains.push(
          `[${prev}]drawbox=x='${-barW - 40}+${travel}*${slide}':y=${barY}:w=${barW}:h=${barH}:color=${tpl.accent}@0.92:t=fill:` +
            `enable='between(t,${s},${end})'[${bar}]`
        )
        chains.push(
          `[${bar}]drawtext=fontfile='${font}':textfile='${fileArg(cardFile)}':fontcolor=${theme.bgColor}:fontsize=${Math.round(cardFont * 0.5)}:` +
            `x='${-barW}+${travel}*${slide}':y=${barY + Math.round(barH * 0.28)}:enable='between(t,${s},${end})'[${next}]`
        )
      } else {
        // Kinetic centered card: fade in while sliding up ~40px.
        const y = `(h-th)/2 + 40*(1-min((t-${s})/0.6,1))`
        chains.push(
          `[${prev}]drawtext=fontfile='${font}':textfile='${fileArg(cardFile)}':fontcolor=${theme.cardColor}:fontsize=${cardFont}:` +
            `x=(w-tw)/2:y='${y}':alpha='${alpha}':enable='between(t,${s},${end})'[${next}]`
        )
      }
      prev = next
    })

    // Graphics v2 finishing: colour-grade / vignette / grain / letterbox for the template.
    const fin = finishingChain(tpl, prev, 'vfinal', layout.w, layout.h)
    if (fin) chains.push(fin)
    const videoMapLabel = fin ? '[vfinal]' : `[${prev}]`

    // Pick the fastest SAFE path: GPU for big/long jobs within hardware limits (where
    // it wins), CPU otherwise. 8K exceeds every consumer GPU's H.264 limit, so it uses
    // the CPU encoder here — and runEncodeWithFallback retries on CPU if any GPU encode
    // still fails at runtime, so a video always renders.
    const encoder = await chooseEncoderForJob(layout.w, layout.h, dur)
    const note = `Encoding via ${encoderLabel(encoder)}${isHardware(encoder) ? ' — hardware accelerated ⚡' : ''}`
    opts.onLog?.(note)
    opts.onProgress?.(note)

    const filter = chains.join(';')
    const buildArgs = (videoEncoderArgs: string[]): string[] =>
      buildFfmpegArgs({
        layout,
        dur,
        audioPath: opts.audioPath,
        musicPath: opts.musicPath,
        sfxCount: sfxTimesSec.length,
        whooshPath,
        filter,
        videoMap: videoMapLabel,
        audioMap: audio.audioMap,
        outPath: opts.outPath,
        background,
        videoEncoderArgs
      })
    // Parse ffmpeg's live "time=" so the UI shows a real percentage every second,
    // instead of a single "Rendering…" line until the very end (shared helper).
    const handleLog = makeFfmpegProgressLogger(dur, opts.onProgress, opts.onLog)
    await runEncodeWithFallback(encoder, buildArgs, { onLog: handleLog, onNotice: opts.onProgress })
  } finally {
    rmSync(scratch, { recursive: true, force: true })
  }
}

/**
 * Replaces a finished video's audio track with a user-recorded voice file
 * (re-encoding audio to AAC, copying the video stream). Output is a fresh MP4.
 */
export async function attachVoiceover(videoPath: string, audioPath: string, outPath: string): Promise<void> {
  await runFfmpeg([
    '-y',
    '-i',
    videoPath,
    '-i',
    audioPath,
    '-map',
    '0:v:0',
    '-map',
    '1:a:0',
    '-c:v',
    'copy',
    '-c:a',
    'aac',
    '-b:a',
    '192k',
    '-shortest',
    '-movflags',
    '+faststart',
    outPath
  ])
}
