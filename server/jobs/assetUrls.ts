import { createHmac } from 'node:crypto'
import type { Deps } from '../context.js'
import { getAsset } from '../storage/assets.js'
import { safeEqual } from '../lib/passwords.js'
import type { Ctx } from '../context.js'

// Providers fetch reference images by URL. Cloud storage gives a short-lived
// presigned URL; otherwise, when the deployment has a public URL, we sign a
// link to our own API. With neither, live runs with references are refused.

const TTL_SEC = 3600

function sign(secret: string, assetId: string, exp: number): string {
  return createHmac('sha256', secret).update(`${assetId}.${exp}`).digest('base64url')
}

export function verifyAssetSignature(secret: string, assetId: string, exp: number, sig: string, nowMs: number): boolean {
  if (!Number.isFinite(exp) || exp * 1000 < nowMs) return false
  return safeEqual(sign(secret, assetId, exp), sig)
}

export async function publicAssetUrl(deps: Deps, ctx: Ctx, assetId: string): Promise<string | null> {
  const asset = await getAsset(deps, ctx, assetId)
  const presigned = await deps.store.presignGet(asset.storageKey, TTL_SEC)
  if (presigned) return presigned
  if (!deps.env.STUDIO_PUBLIC_URL) return null
  const exp = Math.floor(deps.clock.now().getTime() / 1000) + TTL_SEC
  const base = deps.env.STUDIO_PUBLIC_URL.replace(/\/$/, '')
  return `${base}/api/v1/public/assets/${assetId}?exp=${exp}&sig=${sign(deps.env.STUDIO_SESSION_SECRET, assetId, exp)}`
}
