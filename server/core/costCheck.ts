// The real cost of a run next to its quote (owner, 2026-10-14: "Log the
// real cost of each run and flag estimates off by more than 20%"). Pure.
//
// - On the Higgsfield plan: the credits Higgsfield actually took, read from
//   the account's transactions (free).
// - Claude: the measured tokens.
// - The Higgsfield API reports no cost, so the price book's figure stands
//   and nothing is flagged.

export type CostSource = 'transactions' | 'tokens' | 'quote' | 'not_found'

export interface CostCheck {
  quoted: { credits?: number; micros: number }
  actual: { credits?: number; micros?: number; source: CostSource }
  // Positive when the run cost more than quoted.
  offPct: number | null
  flagged: boolean
  note: string
  at: string
  // The account transaction that was matched (so it is never matched twice).
  txKey?: string
}

export const FLAG_PCT = 20

export function compareCost(quoted: CostCheck['quoted'], actual: CostCheck['actual'], at: Date, txKey?: string): CostCheck {
  const both = quoted.credits != null && actual.credits != null
  const q = both ? quoted.credits! : quoted.micros
  const a = both ? actual.credits! : actual.micros
  const offPct = a == null || actual.source === 'quote' || actual.source === 'not_found' || q <= 0 ? null : Math.round(((a - q) / q) * 100)
  const flagged = offPct != null && Math.abs(offPct) > FLAG_PCT
  const what = both ? `${fmt(actual.credits!)} credits taken, ${fmt(quoted.credits!)} quoted` : a != null ? `$${(a / 1e6).toFixed(3)} measured, $${(q / 1e6).toFixed(3)} quoted` : ''
  const note = actual.source === 'not_found' ? 'The charge was not found in your Higgsfield transactions yet, so the quote stands.'
    : actual.source === 'quote' ? 'The provider reports no cost for a run, so the price book figure stands.'
    : flagged ? `Quote off by ${offPct! > 0 ? '+' : ''}${offPct}%: ${what}. Fix the price book entry for this model.`
    : `${what}.`
  return { quoted, actual, offPct, flagged, note, at: at.toISOString(), ...(txKey ? { txKey } : {}) }
}

const fmt = (n: number) => String(Math.round(n * 100) / 100)

export interface Charge { name: string; credits: number; at: string }

const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, '')

// The account charge that belongs to a job: the same model (by its names),
// spent close to when the job was submitted, not already claimed by another
// job. Nearest in time wins.
export function matchCharge(charges: Charge[], o: { names: string[]; submittedAt: Date; claimed: Set<string>; windowSec?: number }): { charge: Charge; key: string } | null {
  const names = o.names.map(norm).filter(n => n.length >= 3)
  const window = (o.windowSec ?? 180) * 1000
  const t = o.submittedAt.getTime()
  let best: { charge: Charge; key: string; d: number; exact: boolean } | null = null
  for (const c of charges) {
    const key = `${c.at}|${c.name}|${c.credits}`
    if (o.claimed.has(key)) continue
    const n = norm(c.name)
    const exact = names.includes(n)
    if (!exact && !names.some(x => n.includes(x) || x.includes(n))) continue
    const d = Math.abs(new Date(c.at).getTime() - t)
    if (d > window) continue
    // An exact name beats a partial one ("Nano Banana 2" vs "2.1").
    if (!best || (exact && !best.exact) || (exact === best.exact && d < best.d)) best = { charge: c, key, d, exact }
  }
  return best ? { charge: best.charge, key: best.key } : null
}
