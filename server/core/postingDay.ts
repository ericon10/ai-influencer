import { z } from 'zod'

// Download day (owner, 2026-10-17; UX-PLAN.md section 33): until the
// posting engine is ready, posts go out by hand. One zip for a day: a
// folder per account, a subfolder per slot (numbered slides or video.mp4,
// caption.txt, post.json), checklist.txt in posting order and left-out.txt.
// Pure: what a post's posting state is, the order, why a post is left out,
// the folder and file names and the text files. The files themselves are
// the caller's (server/pipeline/postingDay.ts).

// A post's posting state (on the post, `spec.posting`). approved: the
// owner's Approve for posting (null: never set, then a batch review's
// Approve counts); date and slot: the owner's own day and slot (empty: the
// plan's); packed: the last Download day it went into.
export const packedSchema = z.object({
  at: z.string().max(40), packId: z.string().max(60), date: z.string().max(10), assetId: z.string().max(60).nullable().default(null),
})
export const postingSchema = z.object({
  approved: z.boolean().nullable().default(null),
  approvedAt: z.string().max(40).nullable().default(null),
  date: z.string().max(10).default(''),
  slot: z.string().max(12).default(''),
  packed: packedSchema.nullable().default(null),
})
export type Posting = z.infer<typeof postingSchema>
export type Packed = z.infer<typeof packedSchema>
export const emptyPosting = (): Posting => postingSchema.parse({})
export const readPosting = (raw: unknown): Posting => {
  const r = postingSchema.safeParse(raw ?? {})
  return r.success ? r.data : emptyPosting()
}

export const DAY = /^\d{4}-\d{2}-\d{2}$/
export const TIME = /^([01]\d|2[0-3]):[0-5]\d$/

// Approved for posting: the owner's switch, else a batch review's Approve.
export const isApproved = (posting: Posting, review?: string | null) => (posting.approved ?? review === 'approved')

// The day a post goes out: the owner's own day, else the plan's, else the
// day it was posted (its results).
export function postingDay(p: { posting: Posting; planDate?: string | null; postedAt?: string | null }): string {
  if (DAY.test(p.posting.date)) return p.posting.date
  if (p.planDate && DAY.test(p.planDate)) return p.planDate
  const posted = (p.postedAt ?? '').slice(0, 10)
  return DAY.test(posted) ? posted : ''
}
export const postingSlot = (p: { posting: Posting; planSlot?: string | null }) => (p.posting.slot || p.planSlot || '').trim()

// Slot times: the plan's slots (AM, PM, Daily...) as clock times, data with
// defaults in config/content.yaml (posting.slot_times), editable per account.
export type SlotTimes = Record<string, string>
export function slotTime(slot: string, times: SlotTimes): string | null {
  const key = Object.keys(times).find(k => k.toLowerCase() === slot.trim().toLowerCase())
  const t = key ? times[key]! : ''
  return TIME.test(t) ? t : null
}
// The slots in clock order.
export const slotList = (times: SlotTimes) => Object.entries(times).filter(([, t]) => TIME.test(t)).sort((a, b) => a[1].localeCompare(b[1]) || a[0].localeCompare(b[0])).map(([slot, time]) => ({ slot, time }))

export interface DayPost {
  id: string; name: string; kind: string
  account: string; slot: string; hook: string; ad: boolean
  approved: boolean; packed: Packed | null
  // Its files are made (a slideshow's images, a video post's MP4).
  exported: boolean; exportedAt: string | null
  rendering: boolean
  // Why it cannot be exported: pictures missing (or the clip), or another reason.
  missing: string | null
  problem: string | null
  // The plan's row (a tie-break in the order), or ''.
  rowId: string
  // A sound to add in the app ("Add this sound in the app: ..."), or ''.
  sound?: string
}

// Posting order: by the slot's clock time (a slot with no time last), then
// account, then the plan's row, then the name.
export function orderDay<T extends Pick<DayPost, 'slot' | 'account' | 'rowId' | 'name'>>(posts: T[], times: SlotTimes): T[] {
  const key = (p: T) => slotTime(p.slot, times) ?? '99:99'
  return [...posts].sort((a, b) => key(a).localeCompare(key(b)) || a.account.toLowerCase().localeCompare(b.account.toLowerCase())
    || a.rowId.localeCompare(b.rowId, undefined, { numeric: true }) || a.name.localeCompare(b.name))
}

export type LeftOutKind = 'no-account' | 'not-approved' | 'packed' | 'missing' | 'cannot-render' | 'rendering'
export interface LeftOut { kind: LeftOutKind; text: string }

// "Oct 19, 9:14 AM" in the owner's time zone (UTC when it is not known).
export function shortWhen(iso: string, tz?: string | null): string {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return iso
  const fmt = (zone: string | undefined) => new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit', timeZone: zone }).format(d)
  try { return fmt(tz || 'UTC') } catch { return fmt('UTC') }
}

// Why a post stays out of the pack, or null when it goes in (exported
// first when it has no export yet). The first reason that applies.
export function leftOutReason(p: DayPost, o: { includePacked: boolean; tz?: string | null }): LeftOut | null {
  if (!p.account.trim()) return { kind: 'no-account', text: 'No account: pick its account in the Idea step' }
  if (!p.approved) return { kind: 'not-approved', text: 'Not approved for posting' }
  if (p.packed && !o.includePacked) return { kind: 'packed', text: `Already packed (${shortWhen(p.packed.at, o.tz)}${p.packed.date && p.packed.date !== '' ? `, Download day ${p.packed.date}` : ''})` }
  if (p.rendering) return { kind: 'rendering', text: 'Exporting right now: make the zip again when it is done' }
  if (!p.exported && p.missing) return { kind: 'missing', text: `Missing pictures: ${p.missing}` }
  if (!p.exported && p.problem) return { kind: 'cannot-render', text: `Not exported yet and could not be exported: ${p.problem}` }
  return null
}

const clean = (s: string, max = 40) => s.trim().replace(/[^A-Za-z0-9._-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, max)

// Each post's folder: "<account>/<n>-<SLOT>-<HHMM>", numbered in posting
// order within its account, so the folders sort in posting order.
export function folderNames<T extends Pick<DayPost, 'id' | 'account' | 'slot'>>(ordered: T[], times: SlotTimes): Map<string, string> {
  const seen = new Map<string, number>()
  const accFolder = new Map<string, string>()
  const taken = new Set<string>()
  // Two account tags that clean to the same name keep apart ("-2").
  const folderOf = (account: string) => {
    const known = accFolder.get(account)
    if (known) return known
    const base = clean(account) || 'no-account'
    let name = base
    for (let k = 2; taken.has(name.toLowerCase()); k++) name = `${base}-${k}`
    taken.add(name.toLowerCase())
    accFolder.set(account, name)
    return name
  }
  const out = new Map<string, string>()
  for (const p of ordered) {
    const acc = folderOf(p.account)
    const n = (seen.get(acc) ?? 0) + 1
    seen.set(acc, n)
    const time = slotTime(p.slot, times)
    const slot = clean(p.slot, 12).toUpperCase() || 'ANY'
    out.set(p.id, `${acc}/${n}-${slot}${time ? `-${time.replace(':', '')}` : ''}`)
  }
  return out
}

// The files of one post in its folder.
export const slideFile = (i: number) => `${String(i + 1).padStart(2, '0')}.jpg`
export const VIDEO_FILE = 'video.mp4'

const hookLine = (h: string) => `"${h.replace(/\s+/g, ' ').trim().slice(0, 140)}"`
const when = (slot: string, times: SlotTimes) => {
  const t = slotTime(slot, times)
  return t ? `${t}${slot ? ` (${slot})` : ''}` : slot ? `${slot} (no time set)` : 'Any time'
}
export function dayTitle(date: string): string {
  const d = new Date(`${date}T12:00:00Z`)
  return Number.isNaN(d.getTime()) ? date : d.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric', timeZone: 'UTC' })
}

// checklist.txt: one line per post in posting order, each with its account,
// slot time, hook, Ad yes or no and "AI-generated label: on".
export function checklistText(date: string, posts: Array<Pick<DayPost, 'id' | 'account' | 'slot' | 'hook' | 'ad' | 'kind'> & { sound?: string }>, folders: Map<string, string>, times: SlotTimes, madeAt: string): string {
  const head = [
    `Download day: ${dayTitle(date)}`,
    `${posts.length} post${posts.length === 1 ? '' : 's'}, in posting order. Made ${madeAt}.`,
    'Post each one from its folder: the slides in number order (or video.mp4), the words in caption.txt. Turn on the AI-generated content label on every post.',
    '',
  ]
  const lines = posts.map((p, i) => `[ ] ${i + 1}. ${p.account} | ${when(p.slot, times)} | Hook: ${hookLine(p.hook)} | Ad: ${p.ad ? 'yes' : 'no'} | AI-generated label: on${p.sound ? ` | ${p.sound}` : ''} | ${folders.get(p.id) ?? ''}/`)
  return [...head, ...(lines.length ? lines : ['Nothing to post on this day.'])].join('\n') + '\n'
}

// left-out.txt: what stayed out and why.
export function leftOutText(date: string, rows: Array<Pick<DayPost, 'account' | 'slot' | 'hook' | 'name'> & { reason: string }>, times: SlotTimes): string {
  if (!rows.length) return `Download day ${date}: nothing was left out.\n`
  return [`Left out of Download day ${date}: ${rows.length} post${rows.length === 1 ? '' : 's'}.`, '',
    ...rows.map(r => `${r.account || 'No account'} | ${when(r.slot, times)} | Hook: ${hookLine(r.hook || r.name)} | ${r.reason}`)].join('\n') + '\n'
}
