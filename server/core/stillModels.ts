import type { ModelEntry, PriceBook } from '../config/load.js'
import { findPrice, splitRef } from '../costs/pricebook.js'

// Which model makes a slide's still (owner, 2026-10-17; UX-PLAN.md section
// 30). The path is the owner's pick: Your Higgsfield plan (credits, the
// account through MCP) or the Higgsfield API (dollars). The model follows
// who is in the slide:
// - a slide that shows the character: the character file's stills default
//   (its Models section), else its second choice, else the Studio's
//   default (scenes.yaml default_still_model), each only when the path can
//   run it;
// - a slide with no one in it: the cheapest of the empty-slide models the
//   path can run, priced from the price book at the Standard level.
// Pure: config in, a model ref out.

export type StillPath = 'account' | 'api'
export const PATH_LABELS: Record<StillPath, string> = { account: 'Your Higgsfield plan', api: 'Higgsfield API' }

type Entry = Pick<ModelEntry, 'ref' | 'label' | 'kinds' | 'api'> & { mcp_id?: string | null; mcp?: unknown }

// A Higgsfield model runs on the plan when it has an account (MCP) entry,
// and on the API unless the API does not offer it.
export function runsOn(m: Entry, path: StillPath): boolean {
  if (!m.ref.startsWith('higgsfield/')) return true
  return path === 'account' ? !!m.mcp_id && !!m.mcp : m.api !== false
}

const makesStills = (m: Entry) => m.kinds.some(k => k === 'image' || k === 'image_edit')

export interface StillPrice { credits: number | null; micros: number; verified: boolean }

// One still's price on a path at a level: plan credits on the plan (the
// price book's credits, as the account adapter falls back to), dollars on
// the API. Null when the price book has no entry.
export function stillPrice(pb: PriceBook, ref: string, level: { quality: string; resolution: string }, path: StillPath): StillPrice | null {
  const { provider, model } = splitRef(ref)
  const e = findPrice(pb, provider, model, 'image', { quality: level.quality, resolution: level.resolution })
  if (!e) return null
  if (path === 'account' && e.credits != null) return { credits: e.credits, micros: 0, verified: e.credits_verified === true }
  return { credits: null, micros: Math.round(e.price * 1_000_000), verified: e.verified }
}

// The cheapest still model the path can run: by plan credits on the plan,
// by dollars on the API (a model with no credit price on the plan comes
// after those with one). Ties keep the list's order.
export function cheapestStill(models: Entry[], refs: string[], pb: PriceBook, levelFor: (ref: string) => { quality: string; resolution: string }, path: StillPath): { ref: string; label: string; price: StillPrice } | null {
  let best: { ref: string; label: string; price: StillPrice; key: [number, number] } | null = null
  for (const ref of refs) {
    const m = models.find(x => x.ref === ref)
    if (!m || !makesStills(m) || !runsOn(m, path)) continue
    const price = stillPrice(pb, ref, levelFor(ref), path)
    if (!price) continue
    const key: [number, number] = path === 'account' ? [price.credits ?? Number.POSITIVE_INFINITY, price.micros] : [price.micros, 0]
    if (!best || key[0] < best.key[0] || (key[0] === best.key[0] && key[1] < best.key[1])) best = { ref, label: m.label, price, key }
  }
  return best ? { ref: best.ref, label: best.label, price: best.price } : null
}

// The model for a slide that shows the character: the file's stills
// default when the path can run it, else the file's second choice, else
// the Studio's default, else the first Studio still model the path runs.
export function characterStill(models: Entry[], prefs: Record<string, string>, studio: { default_still_model?: string; still_models: string[] }, path: StillPath): { ref: string; label: string; from: 'file' | 'studio' } | null {
  const ok = (ref: string | undefined): ref is string => {
    const m = ref ? models.find(x => x.ref === ref) : undefined
    return !!m && studio.still_models.includes(m.ref) && makesStills(m) && runsOn(m, path)
  }
  const label = (ref: string) => models.find(x => x.ref === ref)?.label ?? ref
  for (const ref of [prefs.scene_still, prefs.scene_still_alt]) if (ok(ref)) return { ref, label: label(ref), from: 'file' }
  for (const ref of [studio.default_still_model, ...studio.still_models]) if (ok(ref)) return { ref, label: label(ref), from: 'studio' }
  return null
}
