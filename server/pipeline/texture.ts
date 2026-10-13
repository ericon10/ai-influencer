import type { Ctx, Deps } from '../context.js'
import { readAsset } from '../storage/assets.js'
import { compareTexture, type TextureResult } from '../qa/texture.js'

// Realism principle: an upscale or edit must keep the face's fine skin
// detail. Free and local; a failure to measure never blocks the result.
export async function textureCheck(deps: Deps, ctx: Ctx, inputAssetId: string | undefined, outputAssetId: string, sameFraming: boolean): Promise<TextureResult | null> {
  if (!inputAssetId) return null
  try {
    const [a, b] = await Promise.all([readAsset(deps, ctx, inputAssetId), readAsset(deps, ctx, outputAssetId)])
    return await compareTexture(a.data, b.data, { faces: deps.faces, minRatio: deps.config.runtime.qa.texture_min_ratio, sameFraming })
  } catch (e) {
    ctx.log.warn({ err: e }, 'texture check could not run')
    return null
  }
}

export const textureSummary = (t: TextureResult) => ({ ratio: t.ratio, smoothed: t.smoothed, region: t.region, message: t.message })
