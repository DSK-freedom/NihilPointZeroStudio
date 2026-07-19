/**
 * Scene Studio backend: turns a script into an ordered list of editable "scenes", and
 * generates one AI image per scene on demand. The renderer drives the loop (so the user
 * sees each scene appear, can PAUSE between scenes, and can edit + regenerate any single
 * scene) and then builds the final video from the approved images via the normal
 * video-build path. All generation is FREE + keyless (see ../image).
 */
import { join } from 'path'
import { extractCards } from '../video/render'
import { generateImage, sceneImagePrompt } from '../image'
import { thumbnailsDir } from '../store'
import type { VideoStyle } from '../../shared/types'

export interface PlannedScene {
  index: number
  /** The script section this scene came from (e.g. "TRADE DEFICIT"). */
  label: string
  /** The editable image prompt — the user can rewrite this to control the scene. */
  prompt: string
}

/** Practical ceiling on scenes per plan. High, but not literally infinite — every scene is
 *  a free AI image and hundreds take a long time on the free queue. */
const MAX_SCENES = 200

/**
 * Plans scenes so the video FLOWS beat-by-beat instead of a few static cards:
 *  1) If the script contains several descriptive [visual direction] blocks (as pro shot
 *     lists do), each block becomes its own scene — exactly the shots you wrote.
 *  2) Otherwise the prose is split into ~2-sentence beats (~15s of narration each), so a
 *     long script yields many sequential scenes.
 * `direction` (e.g. "dark documentary look, 1970s Karachi") is folded into every prompt.
 * Pure (no network) + unit-tested.
 */
export function planScenes(
  title: string,
  body: string,
  style: VideoStyle = 'cinematic',
  direction = ''
): PlannedScene[] {
  // 1) Descriptive bracketed visual blocks (≥20 chars, so [OUTRO]/[Hook] tags don't count).
  const visualBlocks = [...body.matchAll(/\[([^\]]{20,600})\]/g)].map((m) => m[1].replace(/\s+/g, ' ').trim())
  let beats: string[]
  if (visualBlocks.length >= 4) {
    beats = visualBlocks
  } else {
    // 2) Split the prose into ~2-sentence beats. Strip markdown headings, bold, bracket
    //    tags and list numbering so scenes describe the CONTENT, not formatting.
    const clean = body
      .replace(/^\s*#{1,6}.*$/gm, ' ')
      .replace(/\*\*/g, '')
      .replace(/\[[^\]]*\]/g, ' ')
      .replace(/^\s*\d+\.\s+/gm, ' ')
      .replace(/\s+/g, ' ')
      .trim()
    const sentences = clean.split(/(?<=[.!?])\s+/).map((s) => s.trim()).filter((s) => s.split(' ').length >= 4)
    beats = []
    for (let i = 0; i < sentences.length; i += 2) beats.push(sentences.slice(i, i + 2).join(' '))
    // Fallback to the old section-card behaviour only if the prose was too thin to split.
    if (beats.length === 0) beats = extractCards(body, title)
  }
  return beats.slice(0, MAX_SCENES).map((beat, index) => ({
    index,
    label: beat.split(' ').slice(0, 6).join(' ').replace(/[.,;:]+$/, '') || `Scene ${index + 1}`,
    // Keep most of the writer's shot description (was 240 → chopped detailed directions);
    // the image endpoint accepts long prompts, so preserve the full cinematic direction.
    prompt: sceneImagePrompt(style, [beat.slice(0, 700), direction.trim()].filter(Boolean).join(', '), title)
  }))
}

/** Generates one scene image from a (possibly user-edited) prompt. Returns the file path. */
export async function generateSceneImage(
  prompt: string,
  seed: number,
  fast: boolean
): Promise<string> {
  const outPath = join(thumbnailsDir(), `scene-${seed}-${Date.now().toString(36)}.jpg`)
  return generateImage(prompt, outPath, { width: 1280, height: 720, seed, model: fast ? 'turbo' : 'flux' })
}
