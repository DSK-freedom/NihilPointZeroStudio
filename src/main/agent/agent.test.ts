import { describe, expect, it } from 'vitest'
import { buildAgentPrompt, sanitizeAgentPlan, scriptLengthForMinutes } from './index'

describe('sanitizeAgentPlan', () => {
  it('keeps valid steps and drops unknown step types', () => {
    const plan = sanitizeAgentPlan({
      reply: 'ok',
      steps: [
        { type: 'write_script', topic: 'Tesla earnings', lengthMinutes: 2 },
        { type: 'delete_all_files', path: 'C:/' }, // hallucinated — must be dropped
        { type: 'make_thumbnail', headline: 'MELTDOWN' }
      ]
    })
    expect(plan.reply).toBe('ok')
    expect(plan.steps).toHaveLength(2)
    expect(plan.steps[0].type).toBe('write_script')
    expect(plan.steps[1].type).toBe('make_thumbnail')
  })

  it('drops invalid enum values but keeps the step', () => {
    const plan = sanitizeAgentPlan({
      steps: [{ type: 'build_video', source: 'generated', style: 'purple', resolution: '16k', musicMood: 'jazz' }]
    })
    const step = plan.steps[0]
    expect(step.type).toBe('build_video')
    if (step.type === 'build_video') {
      expect(step.style).toBeUndefined()
      expect(step.resolution).toBeUndefined()
      expect(step.musicMood).toBeUndefined()
      expect(step.source).toBe('generated')
    }
  })

  it('keeps valid enum values', () => {
    const plan = sanitizeAgentPlan({
      steps: [{ type: 'build_video', source: 'scriptpad', style: 'anime', resolution: '4k', musicMood: 'calm', soundEffects: true }]
    })
    const step = plan.steps[0]
    if (step.type === 'build_video') {
      expect(step.style).toBe('anime')
      expect(step.resolution).toBe('4k')
      expect(step.musicMood).toBe('calm')
      expect(step.source).toBe('scriptpad')
      expect(step.soundEffects).toBe(true)
    }
  })

  it('defaults an unknown build source to generated, and allows musicMood "none"', () => {
    const plan = sanitizeAgentPlan({ steps: [{ type: 'build_video', source: 'nonsense', musicMood: 'none' }] })
    const step = plan.steps[0]
    if (step.type === 'build_video') {
      expect(step.source).toBe('generated')
      expect(step.musicMood).toBe('none')
    }
  })

  it('drops steps missing required fields', () => {
    const plan = sanitizeAgentPlan({
      steps: [
        { type: 'write_script' }, // no topic
        { type: 'make_thumbnail' }, // no headline
        { type: 'generate_image' }, // no prompt
        { type: 'generate_ideas' } // no focus
      ]
    })
    expect(plan.steps).toHaveLength(0)
  })

  it('supports free AI visuals, AI thumbnail background, and image generation', () => {
    const plan = sanitizeAgentPlan({
      steps: [
        { type: 'build_video', source: 'generated', aiVisuals: true },
        { type: 'make_thumbnail', headline: 'BOOM', aiBackground: true },
        { type: 'generate_image', prompt: 'a rocket launching at dawn', style: 'cinematic' }
      ]
    })
    expect(plan.steps).toHaveLength(3)
    const build = plan.steps[0]
    if (build.type === 'build_video') expect(build.aiVisuals).toBe(true)
    const thumb = plan.steps[1]
    if (thumb.type === 'make_thumbnail') expect(thumb.aiBackground).toBe(true)
    const img = plan.steps[2]
    if (img.type === 'generate_image') {
      expect(img.prompt).toBe('a rocket launching at dawn')
      expect(img.style).toBe('cinematic')
    }
  })

  it('accepts the new tab-operating steps (scriptpad / psx / music / scenes)', () => {
    const plan = sanitizeAgentPlan({
      steps: [
        { type: 'write_scriptpad', text: 'Hello world', title: 'Note', append: true },
        { type: 'analyze_psx', symbol: 'LUCK', language: 'Roman Urdu', makeScript: true },
        { type: 'generate_music', mood: 'calm', seconds: 30 },
        { type: 'plan_scenes', source: 'scriptpad', style: 'anime' }
      ]
    })
    expect(plan.steps).toHaveLength(4)
    const [pad, psx, music, scenes] = plan.steps
    if (pad.type === 'write_scriptpad') expect(pad).toMatchObject({ text: 'Hello world', title: 'Note', append: true })
    if (psx.type === 'analyze_psx') expect(psx).toMatchObject({ symbol: 'LUCK', language: 'Roman Urdu', makeScript: true })
    if (music.type === 'generate_music') expect(music).toMatchObject({ mood: 'calm', seconds: 30 })
    if (scenes.type === 'plan_scenes') expect(scenes).toMatchObject({ source: 'scriptpad', style: 'anime' })
  })

  it('drops new steps missing required fields and invalid music moods', () => {
    const plan = sanitizeAgentPlan({
      steps: [
        { type: 'write_scriptpad' }, // no text
        { type: 'analyze_psx' }, // no symbol
        { type: 'generate_music', mood: 'reggaeton' } // invalid mood
      ]
    })
    expect(plan.steps).toHaveLength(0)
  })

  it('defaults plan_scenes source to generated', () => {
    const plan = sanitizeAgentPlan({ steps: [{ type: 'plan_scenes', source: 'bogus' }] })
    const step = plan.steps[0]
    expect(step.type).toBe('plan_scenes')
    if (step.type === 'plan_scenes') expect(step.source).toBe('generated')
  })

  it('never keeps a delete/publish/settings step (create-edit only)', () => {
    const plan = sanitizeAgentPlan({
      steps: [
        { type: 'delete_video', id: 'x' },
        { type: 'publish_youtube', videoId: 'x' },
        { type: 'set_setting', key: 'provider', value: 'openai' }
      ]
    })
    expect(plan.steps).toHaveLength(0)
  })

  it('is safe on garbage input', () => {
    expect(sanitizeAgentPlan(null).steps).toHaveLength(0)
    expect(sanitizeAgentPlan('nope').steps).toHaveLength(0)
    expect(sanitizeAgentPlan({ steps: 'not-an-array' }).steps).toHaveLength(0)
  })
})

describe('scriptLengthForMinutes', () => {
  it('maps minutes to supported lengths', () => {
    expect(scriptLengthForMinutes(1)).toBe('short')
    expect(scriptLengthForMinutes(2)).toBe('short')
    expect(scriptLengthForMinutes(5)).toBe('long')
    expect(scriptLengthForMinutes(15)).toBe('deep-dive')
    expect(scriptLengthForMinutes(undefined)).toBe('short')
  })
})

describe('buildAgentPrompt', () => {
  it('lists the allowed styles, resolutions and moods', () => {
    const p = buildAgentPrompt('make an anime video', { hasScriptPad: false })
    expect(p).toMatch(/anime/)
    expect(p).toMatch(/8k/)
    expect(p).toMatch(/calm/)
    expect(p).toMatch(/EMPTY/) // warns the script pad is empty
  })
})
