/**
 * On-device person cutout (background removal) — free, no cloud. Uses a portrait-matting
 * model via transformers.js to produce an alpha matte, then ffmpeg `alphamerge` turns the
 * original photo + matte into a transparent-background RGBA PNG (keeping the user's REAL
 * pixels — this never invents a face).
 *
 * HONESTY / ROBUSTNESS:
 *  - The matting model is fetched free on first use and then cached on disk (the rest of
 *    the app's models are bundled + offline; this one optional feature is the exception).
 *  - EVERYTHING is wrapped so any failure (offline, model/API mismatch, unsupported image)
 *    resolves to `null` — the caller then falls back to a framed composite. The render
 *    never breaks because of this feature.
 *  - If the user supplies a photo that is ALREADY a transparent PNG, we skip the model
 *    entirely and use it directly — a 100%-reliable path.
 */
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { app } from 'electron'
import { runFfmpeg } from '../video/ffmpeg'

/** Cheap check: does this PNG already carry an alpha channel (a pre-made cutout)? */
export function pngHasAlpha(path: string): boolean {
  try {
    if (!/\.png$/i.test(path)) return false
    const buf = readFileSync(path)
    // PNG IHDR color type byte is at offset 25; types 4 (gray+alpha) and 6 (RGBA) have alpha.
    if (buf.length < 26 || buf.toString('ascii', 1, 4) !== 'PNG') return false
    const colorType = buf[25]
    return colorType === 4 || colorType === 6
  } catch {
    return false
  }
}

let matterPromise: Promise<{ model: unknown; processor: unknown; RawImage: unknown } | null> | null = null

/**
 * Lazily loads the matting model. Enables remote model fetch + a writable cache dir just
 * for this optional feature. Returns null (never throws) if it can't be loaded.
 */
async function getMatter(): Promise<{ model: unknown; processor: unknown; RawImage: unknown } | null> {
  if (!matterPromise) {
    matterPromise = (async () => {
      let tf: {
        env: { allowRemoteModels: boolean; allowLocalModels: boolean; cacheDir?: string | null }
        AutoModel: { from_pretrained: (id: string, opts?: Record<string, unknown>) => Promise<unknown> }
        AutoProcessor: { from_pretrained: (id: string, opts?: Record<string, unknown>) => Promise<unknown> }
        RawImage: unknown
      }
      try {
        tf = (await import('@huggingface/transformers')) as never
      } catch {
        return null
      }
      // Enable network fetch for THIS model only, then restore — the transformers env is a
      // process-wide singleton shared with the offline Whisper model, so leaving
      // allowRemoteModels=true would silently drop that "never touch the network" guarantee.
      const prevRemote = tf.env.allowRemoteModels
      const prevLocal = tf.env.allowLocalModels
      try {
        tf.env.allowRemoteModels = true
        tf.env.allowLocalModels = true
        const cacheDir = join(app.getPath('userData'), 'models-cache')
        if (!existsSync(cacheDir)) mkdirSync(cacheDir, { recursive: true })
        tf.env.cacheDir = cacheDir
        // dtype 'q8' = the small (~44 MB) model_quantized.onnx — same file the previous
        // library version fetched, and already cached on machines that used this feature.
        const model = await tf.AutoModel.from_pretrained('briaai/RMBG-1.4', { dtype: 'q8' })
        const processor = await tf.AutoProcessor.from_pretrained('briaai/RMBG-1.4')
        return { model, processor, RawImage: tf.RawImage }
      } catch {
        return null
      } finally {
        tf.env.allowRemoteModels = prevRemote
        tf.env.allowLocalModels = prevLocal
      }
    })()
  }
  const m = await matterPromise
  // A null (offline / fetch blip) shouldn't disable the feature for the whole session —
  // clear the memo so a later beat or a retry can succeed once the network is back.
  if (!m) matterPromise = null
  return m
}

/**
 * Produces a transparent-background RGBA PNG at `outPng` from `photoPath`. Returns true on
 * success, false if matting is unavailable (caller should fall back). Never throws.
 */
export async function removeBackgroundToPng(photoPath: string, outPng: string): Promise<boolean> {
  // Guaranteed path: the photo is already a cutout.
  if (pngHasAlpha(photoPath)) {
    try {
      writeFileSync(outPng, readFileSync(photoPath))
      return true
    } catch {
      return false
    }
  }

  const matter = await getMatter()
  if (!matter) return false

  const dir = mkdtempSync(join(tmpdir(), 'finscript-matte-'))
  try {
    const RawImage = matter.RawImage as { read: (p: string) => Promise<{ width: number; height: number }> }
    // Forward-slash the path — transformers.js treats string inputs as URLs/paths and a raw
    // Windows backslash path is a fragile input.
    const image = await RawImage.read(photoPath.replace(/\\/g, '/'))
    const processor = matter.processor as (img: unknown) => Promise<{ pixel_values: unknown }>
    const { pixel_values } = await processor(image)
    const model = matter.model as (inp: { input: unknown }) => Promise<Record<string, unknown>>
    const result = await model({ input: pixel_values })

    // The matte tensor: handle the common output keys/shapes defensively.
    const raw = (result.output ?? result.alphas ?? result.logits ?? Object.values(result)[0]) as unknown
    const tensor = (Array.isArray(raw) ? raw[0] : raw) as { data: ArrayLike<number>; dims: number[] }
    if (!tensor || !tensor.data || !tensor.dims) return false
    const dims = tensor.dims
    const mh = dims[dims.length - 2]
    const mw = dims[dims.length - 1]
    const src = tensor.data
    // RMBG-1.4 emits a sigmoid matte in ~[0,1]; use the canonical ×255 (NOT a divide-by-max
    // contrast stretch, which would amplify a noise-only matte into garbage).
    const mask = Buffer.alloc(mw * mh)
    let foreground = 0
    for (let i = 0; i < mw * mh && i < src.length; i++) {
      const v = Math.round(src[i] * 255)
      const clamped = v < 0 ? 0 : v > 255 ? 255 : v
      mask[i] = clamped
      if (clamped > 128) foreground++
    }
    // Reject a degenerate (near-empty) matte — otherwise alphamerge yields an all-transparent
    // PNG that "succeeds" and the person silently vanishes from the scene. Fall back instead.
    if (foreground / (mw * mh) < 0.02) return false
    const maskRaw = join(dir, 'mask.gray')
    writeFileSync(maskRaw, mask)

    // photo + (mask scaled to photo size) → RGBA PNG via alphamerge.
    await runFfmpeg([
      '-y',
      '-i', photoPath,
      '-f', 'rawvideo', '-pix_fmt', 'gray', '-s', `${mw}x${mh}`, '-i', maskRaw,
      '-filter_complex', `[1:v]scale=${image.width}:${image.height}[m];[0:v][m]alphamerge`,
      '-frames:v', '1',
      outPng
    ])
    return existsSync(outPng)
  } catch {
    return false
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
}
