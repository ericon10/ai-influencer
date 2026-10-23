import { and, eq, isNull, sql } from 'drizzle-orm'
import { bankLines, contentItems } from '../db/schema.js'
import type { Ctx, Deps } from '../context.js'
import { AppError } from '../lib/errors.js'
import { planMetaSchema } from '../core/planMeta.js'
import { draftMotion, slotNumber, weekOf } from '../core/weeks.js'
import { fitWhy, newPostRowId, postLine, postPlace, rankPlaces, type LineMode } from '../core/postRow.js'
import type { BankTags } from '../core/lineBank.js'
import { getContent, updateContent, type ContentRow } from './content.js'
import { getCharacter, listCharacters, toData } from './characters.js'
import { facelessOf, kindOf, readFacelessPost } from './faceless.js'
import { saveSocialAccount, scoreboard } from './scaleKit.js'
import { getSetting } from './settings.js'
import { productRef } from './products.js'
import { STANCES_KEY } from './lineBank.js'
import { bankPage, freeLines, patchWeek, placeStills, reusePlaceStill, stanceOf, useLine, weekCells } from './weeks.js'

// Line first, both doors (owner, 2026-10-23; UX-PLAN.md rule 2 and section
// 43). A New post builds its record the way a Weeks row does, in one order
// (line > place > still > video > sound > text), and every picture of a
// post can open its row. Here: the row of a post, the line pick (the bank,
// own words or none), the place suggestions with their stills (reused at
// $0), Use this place, and Add to a week. Applies to every character,
// account and product; a person's "places" are their own settings.

const norm = (s: string) => s.trim().toLowerCase()
const tagsOf = (r: { tags: unknown }) => (r.tags ?? {}) as Partial<BankTags>
const specOf = (row: ContentRow) => (row.spec ?? {}) as Record<string, unknown>

export interface RowLine { id: string | null; text: string; mode: LineMode; pain: string; emotion: string; format: string; source: string; likes: number; comment: string; lifeOrJob: string | null }
export interface PostRowView {
  postId: string; kind: string; title: string; characterId: string | null; characterName: string; faceless: boolean
  accountTag: string; rowId: string; date: string; slot: number | null; week: string | null; postType: string
  line: RowLine
  place: { id: string; name: string; scene: string; motion: string } | null
  stillAssetId: string | null; stillFrom: 'place' | 'new' | 'upload' | null; videoAssetId: string | null
  sound: string; caption: string; hashtags: string[]
}

async function bankLine(deps: Deps, ctx: Ctx, id: string | null) {
  if (!id) return null
  const [l] = await deps.db.select().from(bankLines).where(and(eq(bankLines.accountId, ctx.accountId), eq(bankLines.id, id)))
  return l ?? null
}

function rowLine(row: ContentRow, l: Awaited<ReturnType<typeof bankLine>>): RowLine {
  const pl = postLine(row.kind, specOf(row))
  const t = l ? tagsOf(l) : {}
  const tag = (v: string | undefined) => (v && v !== 'none' ? v : '')
  return { id: l?.id ?? null, text: pl.text, mode: pl.mode, pain: tag(t.pain), emotion: tag(t.emotion), format: tag(t.format), source: l?.source ?? '', likes: l?.likes ?? 0, comment: l && l.comment !== l.line ? l.comment : '', lifeOrJob: l?.lifeOrJob ?? null }
}

// The full row of a post (the drawer every picture opens).
export async function postRow(deps: Deps, ctx: Ctx, postId: string): Promise<PostRowView> {
  const row = await getContent(deps, ctx, postId)
  const spec = specOf(row)
  const plan = planMetaSchema.parse(spec.plan ?? {})
  const ch = row.characterId ? await getCharacter(deps, ctx, row.characterId).catch(() => null) : null
  const faceless = !!ch && kindOf(ch) === 'faceless'
  const pl = postLine(row.kind, spec)
  const l = await bankLine(deps, ctx, pl.lineId)
  const placeId = postPlace(spec)
  const p = placeId && ch && faceless ? facelessOf(ch).places.find(x => x.id === placeId) ?? null : null
  const [cell] = row.kind === 'meme' || row.kind === 'slideshow' ? await weekCells(deps, ctx, [row]) : []
  const f = readFacelessPost(spec.faceless)
  const caption = row.kind === 'slideshow' ? String(spec.caption ?? '') : f.postCaption || plan.caption
  return {
    postId: row.id, kind: row.kind, title: row.title, characterId: row.characterId, characterName: ch?.name ?? '', faceless,
    accountTag: row.accountTag, rowId: plan.rowId, date: plan.date, slot: plan.date ? slotNumber(plan.slot) : null, week: plan.date ? weekOf(plan.date) || null : null,
    postType: cell?.postType ?? row.kind,
    line: rowLine(row, l),
    place: placeId ? { id: placeId, name: p?.name ?? '', scene: p?.line ?? '', motion: p?.motion ?? '' } : null,
    stillAssetId: cell?.thumbAssetId ?? null, stillFrom: cell?.stillFrom ?? null, videoAssetId: cell?.videoAssetId ?? null,
    sound: cell?.sound?.name ?? '', caption, hashtags: row.kind === 'slideshow' ? ((spec.hashtags as string[] | undefined) ?? []) : f.hashtags.length ? f.hashtags : plan.hashtags,
  }
}

// ── The line pick ─────────────────────────────────────────────────────

export interface LinePickQuery { pain?: string | null; emotion?: string | null; format?: string | null; lifeOrJob?: string | null; q?: string | null }

// The bank for one post (section 45): only lines tagged for the post's
// product (No product: lines tagged no product), only lines whose voice fit
// matches the character (first person or both for a first-person character,
// secondhand or both otherwise), none used on another account; unused
// first, then by likes. best: the 3 for the slot (unused, the exact voice
// before "both", then likes). Never another product's lines.
export async function linePicks(deps: Deps, ctx: Ctx, postId: string, q: LinePickQuery) {
  const row = await getContent(deps, ctx, postId)
  const ch = row.characterId ? await getCharacter(deps, ctx, row.characterId) : null
  const picked = await getSetting<Record<string, 'first' | 'secondhand'>>(deps.db, ctx.accountId, STANCES_KEY, {})
  const stance = ch ? await stanceOf(deps, ctx, ch, picked) : 'secondhand'
  const page = await bankPage(deps, ctx, { ...q, limit: 5000 })
  const product = row.productId ? await productRef(deps, ctx, row.productId) : null
  const here = norm(row.accountTag)
  const current = postLine(row.kind, specOf(row)).lineId
  const mine = page.lines.filter(l => (l.productId ?? null) === (row.productId ?? null))
  const fits = mine.filter(l => l.fits === 'both' || l.fits === stance)
  const open = fits.filter(l => !l.usedAccount || l.usedPostId === row.id || (here && norm(l.usedAccount) === here))
  const rank = (l: (typeof open)[number]) => (l.id === current ? 0 : !l.usedAccount ? 1 : 2)
  const lines = [...open].sort((a, b) => rank(a) - rank(b) || b.likes - a.likes)
  const view = (l: (typeof open)[number]) => ({ id: l.id, text: l.original, pain: l.pain === 'none' ? '' : l.pain, emotion: l.emotion === 'none' ? '' : l.emotion, format: l.format, fits: l.fits, lifeOrJob: l.lifeOrJob, source: l.source, likes: l.likes, comment: l.comment !== l.original ? l.comment : '', used: l.usedAccount ? { account: l.usedAccount, date: l.usedDate, here: l.usedPostId === row.id } : null })
  const best = open.filter(l => !l.usedAccount && l.id !== current).sort((a, b) => Number(b.fits === stance) - Number(a.fits === stance) || b.likes - a.likes).slice(0, 3)
  return {
    lines: lines.slice(0, 200).map(view), best: best.map(view),
    total: lines.length, unused: lines.filter(l => !l.usedAccount).length, hidden: fits.length - open.length, otherVoice: mine.length - fits.length,
    options: page.options, stance, characterName: ch?.name ?? '', current,
    product: product ? { id: product.id, name: product.name } : null,
  }
}

// The post's line: a bank line (marked used on this post's account, the
// one it replaces freed), the owner's own words, or none (a pure visual
// post). The on-screen text, and a faceless post's caption while empty,
// are filled from it; a faceless post with no place and no video prompt
// gets one drafted from the line.
export async function setPostLine(deps: Deps, ctx: Ctx, postId: string, input: { lineId?: string | null; text?: string | null; none?: boolean }): Promise<PostRowView> {
  const row = await getContent(deps, ctx, postId)
  if (row.kind !== 'meme' && row.kind !== 'slideshow') throw new AppError('bad_request', 'A line goes on a video post or a slideshow.')
  const spec = specOf(row)
  const plan = planMetaSchema.parse(spec.plan ?? {})
  let text = '', lineId: string | null = null, mode: 'bank' | 'own' | 'none'
  if (input.none) mode = 'none'
  else if (input.lineId) {
    const l = await bankLine(deps, ctx, input.lineId)
    if (!l || !l.passed) throw new AppError('not_found', 'That line is not in the bank any more.')
    if (l.usedPostId && l.usedPostId !== row.id && l.usedAccountTag && norm(l.usedAccountTag) !== norm(row.accountTag)) throw new AppError('invalid_request', `That line is used on ${l.usedAccountTag}: a line goes to one account only.`)
    // Section 45: a line is tagged for one product (or none) and only goes on its posts.
    if ((l.productId ?? null) !== (row.productId ?? null)) throw new AppError('invalid_request', 'That line is tagged for another product. Pick a line for this post\'s product, write your own, or pick No line.')
    text = l.line; lineId = l.id; mode = 'bank'
  } else {
    text = (input.text ?? '').trim().slice(0, 300)
    if (!text) throw new AppError('invalid_request', 'Write the line, or pick No line.')
    mode = 'own'
  }
  await freeLines(deps, ctx, row.id, lineId)
  const f = (spec.faceless ?? null) as Record<string, unknown> | null
  const facelessPatch = f ? {
    faceless: {
      ...f,
      ...(text && !String(f.postCaption ?? '').trim() ? { postCaption: text } : {}),
      ...(text && !String(f.videoPrompt ?? '').trim() && !f.placeId ? { videoPrompt: draftMotion(text) } : {}),
    },
  } : {}
  const onScreen = row.kind === 'slideshow' ? { hook: text } : { caption: text, ...(text ? { captionOff: false } : {}) }
  await updateContent(deps, ctx, row.id, { spec: { ...onScreen, ...facelessPatch, lineMode: mode, plan: { ...plan, lineId: lineId ?? '' } } as never })
  await patchWeek(deps, ctx, row.id, { lineId, lineFrom: text ? 'csv' : null, fillFlag: null, fit: null, check: null })
  if (lineId) await useLine(deps, ctx, lineId, { id: row.id, accountTag: row.accountTag, characterId: row.characterId, text, date: plan.date })
  return postRow(deps, ctx, row.id)
}

// ── The visual ────────────────────────────────────────────────────────

export interface PlaceSuggestion {
  id: string; name: string; scene: string; motion: string; score: number; why: string; used: number
  // The still to reuse for $0: one the Studio has (its picture), or one on
  // the owner's Higgsfield account (pulled free); null: a new one is priced.
  still: { assetId: string | null; from: 'studio' | 'higgsfield' } | null
}

// The places (a faceless character's place bank) or settings (a person's
// own) in the order to suggest them for the post's line: the best fit
// first, then the least used.
export async function placeSuggestions(deps: Deps, ctx: Ctx, postId: string) {
  const row = await getContent(deps, ctx, postId)
  if (!row.characterId) return { faceless: false, line: '', current: null, places: [] as PlaceSuggestion[], settings: [] as Array<{ text: string; score: number; why: string }> }
  const ch = await getCharacter(deps, ctx, row.characterId)
  const line = postLine(row.kind, specOf(row)).text
  const themes = deps.config.pipeline.content.weeks.place_themes
  if (kindOf(ch) !== 'faceless') {
    const own = (toData(ch).persona as { settings?: string[] }).settings ?? []
    const list = (own.length ? own : deps.config.pipeline.content.weeks.settings).map((t, i) => ({ id: String(i), name: t, line: t }))
    const ranked = rankPlaces(line, list, themes)
    return { faceless: false, line, current: null, places: [] as PlaceSuggestion[], settings: ranked.map(r => ({ text: list[Number(r.id)]!.line, score: r.score, why: fitWhy(r) })) }
  }
  const file = facelessOf(ch)
  const have = await placeStills(deps, ctx, ch.id)
  // How often each place is on this character's posts.
  const posts = await deps.db.select({ spec: contentItems.spec }).from(contentItems).where(and(eq(contentItems.accountId, ctx.accountId), eq(contentItems.characterId, ch.id), isNull(contentItems.archivedAt)))
  const use = new Map<string, number>()
  for (const p of posts) { const id = postPlace(p.spec as Record<string, unknown>); if (id) use.set(id, (use.get(id) ?? 0) + 1) }
  // A place with a still to reuse ($0) wins a tie.
  const hasStill = (id: string) => have.has(id) || !!file.places.find(p => p.id === id)?.stillJobId
  const ranked = rankPlaces(line, file.places, themes, use).sort((a, b) => b.score - a.score || Number(hasStill(b.id)) - Number(hasStill(a.id)))
  const byId = new Map(file.places.map(p => [p.id, p]))
  const places: PlaceSuggestion[] = ranked.map(r => {
    const p = byId.get(r.id)!
    const known = have.get(p.id)
    return { id: p.id, name: p.name, scene: p.line, motion: p.motion || draftMotion(p.line), score: r.score, why: fitWhy(r), used: use.get(p.id) ?? 0, still: known ? { assetId: known.assetId, from: 'studio' } : p.stillJobId ? { assetId: null, from: 'higgsfield' } : null }
  })
  return { faceless: true, line, current: readFacelessPost(specOf(row).faceless).placeId, places, settings: [] as Array<{ text: string; score: number; why: string }> }
}

// Use this place on a faceless post: its scene (the post's own words
// cleared), its motion as the video prompt (unless the owner wrote one),
// and, with reuse, its still for $0 (attached at once, or pulled free).
export async function usePlace(deps: Deps, ctx: Ctx, postId: string, input: { placeId: string; reuse: boolean }): Promise<{ still: 'attached' | 'pulling' | 'none' | 'kept'; row: PostRowView }> {
  const row = await getContent(deps, ctx, postId)
  if (!row.characterId) throw new AppError('bad_request', 'Pick the character first.')
  const ch = await getCharacter(deps, ctx, row.characterId)
  if (kindOf(ch) !== 'faceless') throw new AppError('bad_request', 'Places belong to a faceless character.')
  const file = facelessOf(ch)
  const place = file.places.find(p => p.id === input.placeId)
  if (!place) throw new AppError('not_found', `No place ${input.placeId} in ${ch.name}'s place bank.`)
  const spec = specOf(row)
  const f = (spec.faceless ?? {}) as Record<string, unknown>
  const before = f.placeId ? file.places.find(p => p.id === f.placeId) : null
  const prompt = String(f.videoPrompt ?? '').trim()
  // A prompt that was the old place's motion (or drafted from the line) follows the new place.
  const prefilled = !prompt || (before && (prompt === before.motion || prompt === draftMotion(before.line))) || prompt === draftMotion(postLine(row.kind, spec).text)
  await updateContent(deps, ctx, row.id, { spec: { faceless: { ...f, placeId: place.id, line: '', ...(prefilled ? { videoPrompt: place.motion || draftMotion(place.line) } : {}) }, plan: { ...planMetaSchema.parse(spec.plan ?? {}), placeId: place.id } } as never })
  let still: 'attached' | 'pulling' | 'none' | 'kept' = 'none'
  if (input.reuse) still = await reusePlaceStill(deps, ctx, row.id, place)
  return { still, row: await postRow(deps, ctx, row.id) }
}

// ── Add to a week ─────────────────────────────────────────────────────

// A New post joins a week: an account, a date and a slot, and a row id
// (NP plus four), so Fill, Check, Make, Review and Send to Drive treat it
// like any other row. clash: another post already in that slot.
export async function addToWeek(deps: Deps, ctx: Ctx, postId: string, input: { accountTag: string; date: string; slot: number }): Promise<{ week: string; rowId: string; clash: string | null; row: PostRowView }> {
  const row = await getContent(deps, ctx, postId)
  if (row.kind !== 'meme' && row.kind !== 'slideshow') throw new AppError('bad_request', 'Only a video post or a slideshow goes in a week.')
  const tag = input.accountTag.replace(/^@+/, '').trim()
  if (!tag) throw new AppError('invalid_request', 'Pick the account.')
  const monday = /^\d{4}-\d{2}-\d{2}$/.test(input.date) ? weekOf(input.date) : ''
  if (!monday) throw new AppError('invalid_request', 'Pick the date (YYYY-MM-DD).')
  const slot = Math.round(input.slot)
  if (!(slot >= 1 && slot <= 24)) throw new AppError('invalid_request', 'The slot is 1 to 24.')
  const board = await scoreboard(deps, ctx)
  if (!board.accounts.some(a => norm(a.tag) === norm(tag))) await saveSocialAccount(deps, ctx, tag, { characterId: row.characterId })
  const spec = specOf(row)
  const plan = planMetaSchema.parse(spec.plan ?? {})
  const pl = postLine(row.kind, spec)
  const ch = row.characterId ? (await listCharacters(deps, ctx)).find(c => c.id === row.characterId) : null
  const postType = row.kind === 'slideshow' ? 'slideshow' : spec.faceless || (ch && kindOf(ch) === 'faceless') ? 'faceless' : 'clip'
  const rowId = plan.rowId || newPostRowId(row.id)
  const clashRows = await deps.db.select({ id: contentItems.id, spec: contentItems.spec }).from(contentItems).where(and(eq(contentItems.accountId, ctx.accountId), isNull(contentItems.archivedAt), sql`${contentItems.spec}->'plan'->>'date' = ${input.date}`, sql`${contentItems.spec}->'plan'->>'slot' = ${String(slot)}`, sql`lower(${contentItems.accountTag}) = ${norm(tag)}`))
  const clash = clashRows.find(c => c.id !== row.id)
  await updateContent(deps, ctx, row.id, { accountTag: tag, spec: { ...(row.kind === 'meme' && postType === 'faceless' && !spec.faceless ? { faceless: { posted: false } } : {}), plan: { ...plan, rowId, planId: plan.planId || `week-${monday}`, week: monday, date: input.date, slot: String(slot), postType, format: plan.format || postType, lineId: pl.lineId ?? '', placeId: postPlace(spec) ?? '' } } as never })
  await patchWeek(deps, ctx, row.id, { lineId: pl.lineId, lineFrom: pl.text ? 'csv' : null, check: null })
  if (pl.lineId) await useLine(deps, ctx, pl.lineId, { id: row.id, accountTag: tag, characterId: row.characterId, text: pl.text, date: input.date })
  return { week: monday, rowId, clash: clash ? planMetaSchema.parse(((clash.spec ?? {}) as { plan?: unknown }).plan ?? {}).rowId || 'another post' : null, row: await postRow(deps, ctx, row.id) }
}
