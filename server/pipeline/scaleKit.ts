import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { and, asc, desc, eq, inArray, isNull, sql } from 'drizzle-orm'
import { contentItems, hookVariants, hooks, products, socialAccounts } from '../db/schema.js'
import type { Ctx, Deps } from '../context.js'
import { AppError, notFound } from '../lib/errors.js'
import { newId } from '../lib/ids.js'
import { registerJobHook, type JobOutcome, type JobRow } from '../jobs/hooks.js'
import type { JobSpec } from '../jobs/runner.js'
import { isOwnerAccount } from '../providers/serverKeys.js'
import { fill, hardWrap } from '../core/text.js'
import { claimFlags, claimsText, languageText, parseScriptKit, type Claims, type Group, type KitVoice, type Language } from '../core/scriptKit.js'
import { cleanVoiceCard, voiceCardText, type VoiceCard } from '../core/voiceCard.js'
import { getCharacter, listCharacters, toData, updateCharacter } from './characters.js'
import { resolveRoute } from './settings.js'

// The scale kit (overnight item 5, DECISIONS G35; UX-PLAN.md section 14):
// per product, the hook vault, the claims sheet and the buyer-language
// bank (Library > Hooks); hook variants in each character's voice (Claude,
// priced on the button); and per social account its tracked link or promo
// code and signups, ranked by signups (Posts home, Accounts).

export type ProductRow = typeof products.$inferSelect
export type HookRow = typeof hooks.$inferSelect

const KIT_DIR = join(process.cwd(), 'config', 'kits')
// The owner's starter kit (the SideStep script kit, 2026-10-13).
const STARTER = 'sidestep-script-kit.md'

export const claimsOf = (r: ProductRow): Claims => {
  const c = (r.claims ?? {}) as Partial<Claims>
  return { groups: c.groups ?? [], lines: c.lines ?? [], watch: c.watch ?? [], mentions: c.mentions ?? [r.name.toLowerCase()] }
}
export const languageOf = (r: ProductRow): Language => ({ groups: ((r.language ?? {}) as Partial<Language>).groups ?? [] })
const voicesOf = (r: ProductRow): KitVoice[] => (Array.isArray(r.voices) ? r.voices as KitVoice[] : [])

export async function listProducts(deps: Deps, ctx: Ctx): Promise<ProductRow[]> {
  const rows = await deps.db.select().from(products).where(and(eq(products.accountId, ctx.accountId), isNull(products.archivedAt))).orderBy(asc(products.createdAt))
  if (rows.length) return rows
  // The owner's account starts with the SideStep kit (the owner asked for
  // it to be seeded); any other account starts empty and can load it.
  const owner = await isOwnerAccount(deps.db, ctx.accountId, deps.env.STUDIO_OWNER_EMAIL || 'owner@studio.local')
  if (!owner) return rows
  await importKit(deps, ctx, starterKit())
  return deps.db.select().from(products).where(and(eq(products.accountId, ctx.accountId), isNull(products.archivedAt))).orderBy(asc(products.createdAt))
}

export const starterKit = () => readFileSync(join(KIT_DIR, STARTER), 'utf8')

// The product chips: name and how many hooks.
export async function productSummaries(deps: Deps, ctx: Ctx) {
  const rows = await listProducts(deps, ctx)
  const counts = rows.length ? await deps.db.select({ productId: hooks.productId, n: sql<number>`count(*)` }).from(hooks)
    .where(and(eq(hooks.accountId, ctx.accountId), inArray(hooks.productId, rows.map(r => r.id)), isNull(hooks.archivedAt))).groupBy(hooks.productId) : []
  return rows.map(r => ({ id: r.id, name: r.name, hooks: Number(counts.find(c => c.productId === r.id)?.n ?? 0) }))
}

export async function getProduct(deps: Deps, ctx: Ctx, id: string): Promise<ProductRow> {
  const [row] = await deps.db.select().from(products).where(and(eq(products.accountId, ctx.accountId), eq(products.id, id)))
  if (!row || row.archivedAt) throw notFound('Product')
  return row
}

// A script kit (markdown) becomes a product with its hooks. The kit's
// live voice cards fill the matching character's card where it is empty
// (a default: the owner's own edits are never overwritten).
export async function importKit(deps: Deps, ctx: Ctx, md: string, name?: string): Promise<{ product: ProductRow; hooks: number; voicesApplied: string[] }> {
  if (md.length > 200_000) throw new AppError('bad_request', 'That kit is too big (200 KB at most).')
  const kit = parseScriptKit(md, name || 'Product')
  if (!kit.hooks.length && !kit.claims.groups.length) throw new AppError('bad_request', 'No hooks or claims found. A kit has a "Claims sheet" section and a "Hook vault" section with numbered hooks.')
  const id = newId('prd')
  const [product] = await deps.db.insert(products).values({
    id, accountId: ctx.accountId, name: (name || kit.product).slice(0, 80), claims: kit.claims, language: kit.language, voices: kit.voices, notes: kit.notes.slice(0, 20_000), createdBy: ctx.userId,
  }).returning()
  if (kit.hooks.length) {
    await deps.db.insert(hooks).values(kit.hooks.slice(0, 500).map(h => ({ id: newId('hok'), accountId: ctx.accountId, productId: id, number: h.number, kind: h.kind.slice(0, 80), text: h.text.slice(0, 600) })))
  }
  const voicesApplied: string[] = []
  const chars = await listCharacters(deps, ctx)
  for (const v of kit.voices.filter(x => x.status === 'live')) {
    const ch = chars.find(c => c.name.trim().toLowerCase() === v.name.trim().toLowerCase())
    if (!ch) continue
    const row = await getCharacter(deps, ctx, ch.id)
    const data = toData(row)
    const current = cleanVoiceCard(data.persona.voice)
    const merged: VoiceCard = { ...cleanVoiceCard(v.card), ...current }
    if (JSON.stringify(merged) === JSON.stringify(current)) continue
    await updateCharacter(deps, ctx, ch.id, { persona: { ...data.persona, voice: merged } }, `voice card from the ${kit.product} kit`)
    voicesApplied.push(ch.name)
  }
  return { product: product!, hooks: kit.hooks.length, voicesApplied }
}

const groupSchema = (g: unknown): Group[] => (Array.isArray(g) ? g : []).map(x => ({
  label: String((x as Group).label ?? '').trim().slice(0, 80),
  items: (Array.isArray((x as Group).items) ? (x as Group).items : []).map(i => String(i).trim().slice(0, 400)).filter(Boolean).slice(0, 80),
})).filter(x => x.label || x.items.length).slice(0, 30)
const words = (v: unknown): string[] => (Array.isArray(v) ? v : []).map(x => String(x).trim().toLowerCase().slice(0, 60)).filter(Boolean).slice(0, 60)

export async function updateProduct(deps: Deps, ctx: Ctx, id: string, patch: { name?: string; claims?: Partial<Claims>; language?: Partial<Language>; notes?: string }): Promise<ProductRow> {
  const row = await getProduct(deps, ctx, id)
  const c = claimsOf(row)
  const claims: Claims = patch.claims ? {
    groups: patch.claims.groups ? groupSchema(patch.claims.groups) : c.groups,
    lines: patch.claims.lines ? groupSchema(patch.claims.lines) : c.lines,
    watch: patch.claims.watch ? words(patch.claims.watch) : c.watch,
    mentions: patch.claims.mentions ? words(patch.claims.mentions) : c.mentions,
  } : c
  const [out] = await deps.db.update(products).set({
    name: patch.name !== undefined ? patch.name.trim().slice(0, 80) || row.name : row.name,
    claims,
    language: patch.language?.groups ? { groups: groupSchema(patch.language.groups) } : languageOf(row),
    notes: patch.notes !== undefined ? patch.notes.slice(0, 20_000) : row.notes,
    updatedAt: deps.clock.now(),
  }).where(eq(products.id, row.id)).returning()
  return out!
}

export async function archiveProduct(deps: Deps, ctx: Ctx, id: string): Promise<void> {
  const row = await getProduct(deps, ctx, id)
  await deps.db.update(products).set({ archivedAt: deps.clock.now(), updatedAt: deps.clock.now() }).where(eq(products.id, row.id))
}

export async function getHook(deps: Deps, ctx: Ctx, id: string): Promise<HookRow> {
  const [row] = await deps.db.select().from(hooks).where(and(eq(hooks.accountId, ctx.accountId), eq(hooks.id, id)))
  if (!row || row.archivedAt) throw notFound('Hook')
  return row
}

export async function addHook(deps: Deps, ctx: Ctx, productId: string, input: { text: string; kind?: string }): Promise<HookRow> {
  await getProduct(deps, ctx, productId)
  const text = input.text.trim()
  if (text.length < 3) throw new AppError('bad_request', 'Write the hook first.')
  const [max] = await deps.db.select({ n: sql<number>`coalesce(max(${hooks.number}), 0)` }).from(hooks).where(and(eq(hooks.accountId, ctx.accountId), eq(hooks.productId, productId)))
  const [row] = await deps.db.insert(hooks).values({ id: newId('hok'), accountId: ctx.accountId, productId, number: Number(max?.n ?? 0) + 1, kind: (input.kind ?? '').trim().slice(0, 80), text: text.slice(0, 600) }).returning()
  return row!
}

export async function updateHook(deps: Deps, ctx: Ctx, id: string, patch: { text?: string; kind?: string }): Promise<HookRow> {
  const row = await getHook(deps, ctx, id)
  const [out] = await deps.db.update(hooks).set({
    text: patch.text !== undefined ? patch.text.trim().slice(0, 600) || row.text : row.text,
    kind: patch.kind !== undefined ? patch.kind.trim().slice(0, 80) : row.kind,
    updatedAt: deps.clock.now(),
  }).where(eq(hooks.id, row.id)).returning()
  return out!
}

export async function archiveHook(deps: Deps, ctx: Ctx, id: string): Promise<void> {
  const row = await getHook(deps, ctx, id)
  await deps.db.update(hooks).set({ archivedAt: deps.clock.now(), updatedAt: deps.clock.now() }).where(eq(hooks.id, row.id))
}

export async function archiveVariant(deps: Deps, ctx: Ctx, id: string): Promise<void> {
  const [row] = await deps.db.select().from(hookVariants).where(and(eq(hookVariants.accountId, ctx.accountId), eq(hookVariants.id, id)))
  if (!row || row.archivedAt) throw notFound('Variant')
  await deps.db.update(hookVariants).set({ archivedAt: deps.clock.now() }).where(eq(hookVariants.id, row.id))
}

// A product with its hooks and each hook's variants (newest first).
export async function productView(deps: Deps, ctx: Ctx, id: string) {
  const row = await getProduct(deps, ctx, id)
  const hookRows = await deps.db.select().from(hooks).where(and(eq(hooks.accountId, ctx.accountId), eq(hooks.productId, row.id), isNull(hooks.archivedAt))).orderBy(asc(hooks.number))
  const ids = hookRows.map(h => h.id)
  const vars = ids.length ? await deps.db.select().from(hookVariants).where(and(eq(hookVariants.accountId, ctx.accountId), inArray(hookVariants.hookId, ids), isNull(hookVariants.archivedAt))).orderBy(desc(hookVariants.createdAt)) : []
  return {
    id: row.id, name: row.name, claims: claimsOf(row), language: languageOf(row), voices: voicesOf(row), notes: row.notes,
    hooks: hookRows.map(h => ({
      id: h.id, number: h.number, kind: h.kind, text: h.text,
      variants: vars.filter(v => v.hookId === h.id).map(v => ({ id: v.id, characterId: v.characterId, text: v.text, flags: (v.flags as string[]) ?? [], createdAt: v.createdAt.toISOString() })),
    })),
  }
}
export type ProductView = Awaited<ReturnType<typeof productView>>

// A kit's voice card onto a character (the owner's click): the card's
// fields replace the character's, the ElevenLabs voice stays.
export async function useKitVoice(deps: Deps, ctx: Ctx, productId: string, voiceName: string, characterId: string): Promise<void> {
  const row = await getProduct(deps, ctx, productId)
  const v = voicesOf(row).find(x => x.name === voiceName)
  if (!v) throw notFound('Voice card')
  const ch = await getCharacter(deps, ctx, characterId)
  const data = toData(ch)
  const current = cleanVoiceCard(data.persona.voice)
  await updateCharacter(deps, ctx, ch.id, { persona: { ...data.persona, voice: { ...cleanVoiceCard(v.card), ...(current.elevenlabsId ? { elevenlabsId: current.elevenlabsId } : {}) } } }, `voice card "${v.name}" from ${row.name}`)
}

// ── Hook variants (Claude, priced first) ──────────────────────────────

export const variantsJsonSchema = (n: number) => ({
  type: 'object', additionalProperties: false, required: ['variants'],
  properties: {
    variants: {
      type: 'array', minItems: n, maxItems: n,
      items: { type: 'object', additionalProperties: false, required: ['character', 'text'], properties: { character: { type: 'string' }, text: { type: 'string' } } },
    },
  },
})

export async function buildHookVariants(deps: Deps, ctx: Ctx, a: { hookId: string; characterIds: string[]; perCharacter?: number }): Promise<{ purpose: string; characterId: string | null; specs: JobSpec[]; preview: { title: string; prompts: Array<{ label: string; text: string; wrapped: string }>; warnings: []; invalidates: [] } }> {
  const hook = await getHook(deps, ctx, a.hookId)
  const product = await getProduct(deps, ctx, hook.productId)
  const ids = [...new Set(a.characterIds)]
  if (!ids.length) throw new AppError('bad_request', 'Pick the characters to write variants for.')
  const per = Math.max(1, Math.min(3, a.perCharacter ?? 1))
  const chars = await Promise.all(ids.map(async id => toData(await getCharacter(deps, ctx, id))))
  const t = deps.config.pipeline.templates.hook_variants
  const route = await resolveRoute(deps, ctx, 'content_writer')
  const voices = chars.map(c => {
    const card = voiceCardText(c.name, cleanVoiceCard(c.persona.voice))
    return card || `${c.name}: no voice card yet. Persona: ${c.persona.vibe ?? 'not given'}.`
  }).join('\n\n')
  const count = chars.length * per
  const vars = {
    product: product.name, count: String(count), per: String(per),
    names: chars.map(c => c.name).join(', '),
    hook: hook.text, kind: hook.kind || 'not given',
    claims: claimsText(product.name, claimsOf(product)),
    language: languageText(languageOf(product)) || 'None collected yet.',
    voices,
  }
  const system = fill(t.system, vars)
  const prompt = fill(t.prompt, vars)
  const purpose = `hook_variants:${hook.id}`
  const mock = { variants: chars.flatMap(c => Array.from({ length: per }, (_, i) => ({ character: c.name, text: `${hook.text.replace(/\.$/, '')}${per > 1 ? ` (${i + 1})` : ''}, in ${c.name}'s words` }))) }
  return {
    purpose, characterId: ids.length === 1 ? ids[0]! : null,
    preview: { title: `Write ${count} variant${count === 1 ? '' : 's'} of hook ${hook.number}`, prompts: [{ label: 'Hook writer', text: `${system}\n${prompt}`, wrapped: hardWrap(`${system}\n${prompt}`) }], warnings: [], invalidates: [] },
    specs: [{
      type: 'llm', stage: 'content', purpose, label: `Hook ${hook.number} in ${vars.names}'s voice${ids.length === 1 ? '' : 's'}`,
      request: { model: route.model, system, prompt, schema: variantsJsonSchema(count), schemaName: 'hook_variants', maxTokens: 400 + 200 * count, effort: route.effort ?? 'low', meta: { hookId: hook.id, characters: chars.map((c, i) => ({ id: ids[i]!, name: c.name })), mockVariants: mock } },
    }],
  }
}

// Long dashes in a reply become commas (no em-dashes anywhere, SPEC 5.7).
const LONG_DASH = new RegExp(`\\s*${String.fromCharCode(8212)}\\s*`, 'g')
const unquote = (s: string) => s.trim().replace(/^["\u201c]+|["\u201d]+$/g, '').replace(LONG_DASH, ', ').trim()

async function onHookVariants(deps: Deps, ctx: Ctx, job: JobRow, out: JobOutcome): Promise<void> {
  if (out.status !== 'completed') return
  const hook = await getHook(deps, ctx, job.purpose.split(':')[1]!).catch(() => null)
  if (!hook) return
  const product = await getProduct(deps, ctx, hook.productId).catch(() => null)
  const meta = ((job.request as { meta?: { characters?: Array<{ id: string; name: string }> } }).meta ?? {})
  const chars = meta.characters ?? []
  const d = (out.data ?? {}) as { variants?: Array<{ character?: unknown; text?: unknown }> }
  const rows = (Array.isArray(d.variants) ? d.variants : [])
    .map(v => ({ name: String(v.character ?? '').trim().toLowerCase(), text: unquote(String(v.text ?? '')).slice(0, 600) }))
    .filter(v => v.text)
    .map(v => ({ ...v, characterId: chars.find(c => c.name.toLowerCase() === v.name)?.id ?? (chars.length === 1 ? chars[0]!.id : null) }))
    .filter((v): v is { name: string; text: string; characterId: string } => !!v.characterId)
  if (!rows.length) return
  const claims = product ? claimsOf(product) : { watch: [], mentions: [] }
  await deps.db.insert(hookVariants).values(rows.map(v => ({ id: newId('hvr'), accountId: ctx.accountId, hookId: hook.id, characterId: v.characterId, text: v.text, flags: claimFlags(v.text, claims), jobId: job.id })))
}

// ── Accounts: tracked link or promo code, signups, the scoreboard ─────

export async function scoreboard(deps: Deps, ctx: Ctx) {
  const saved = await deps.db.select().from(socialAccounts).where(eq(socialAccounts.accountId, ctx.accountId))
  const posts = await deps.db.select({ tag: contentItems.accountTag, characterId: contentItems.characterId, status: contentItems.status, kind: contentItems.kind, n: sql<number>`count(*)` })
    .from(contentItems).where(and(eq(contentItems.accountId, ctx.accountId), isNull(contentItems.archivedAt)))
    .groupBy(contentItems.accountTag, contentItems.characterId, contentItems.status, contentItems.kind)
  const tags = new Set<string>([...saved.map(s => s.tag), ...posts.map(p => p.tag).filter(Boolean)])
  const rows = [...tags].map(tag => {
    const s = saved.find(x => x.tag === tag)
    const mine = posts.filter(p => p.tag === tag && p.kind !== 'batch')
    const made = mine.reduce((a, p) => a + Number(p.n), 0)
    const ready = mine.filter(p => p.status === 'ready').reduce((a, p) => a + Number(p.n), 0)
    const byChar = new Map<string, number>()
    for (const p of mine) if (p.characterId) byChar.set(p.characterId, (byChar.get(p.characterId) ?? 0) + Number(p.n))
    const characterId = s?.characterId ?? [...byChar.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? null
    const signups = s?.signups ?? 0
    return {
      tag, characterId, productId: s?.productId ?? null, link: s?.link ?? '', code: s?.code ?? '', signups, views: s?.views ?? null, notes: s?.notes ?? '',
      posts: made, exported: ready, perPost: ready ? Math.round((signups / ready) * 100) / 100 : null, updatedAt: s?.updatedAt.toISOString() ?? null,
    }
  })
  // Ranked by signups, never by views; then signups per exported post.
  rows.sort((a, b) => b.signups - a.signups || (b.perPost ?? 0) - (a.perPost ?? 0) || b.exported - a.exported || a.tag.localeCompare(b.tag))
  return { accounts: rows.map((r, i) => ({ ...r, rank: i + 1 })), totalSignups: rows.reduce((a, r) => a + r.signups, 0) }
}

const cleanTag = (s: string) => s.trim().replace(/^@+/, '').replace(/\s+/g, ' ').slice(0, 60)

export async function saveSocialAccount(deps: Deps, ctx: Ctx, rawTag: string, patch: { link?: string; code?: string; signups?: number; views?: number | null; characterId?: string | null; productId?: string | null; notes?: string }) {
  const tag = cleanTag(rawTag)
  if (!tag) throw new AppError('bad_request', 'Name the account first.')
  if (patch.characterId) await getCharacter(deps, ctx, patch.characterId)
  if (patch.productId) await getProduct(deps, ctx, patch.productId)
  if (patch.link && !/^https?:\/\/\S+$/i.test(patch.link.trim())) throw new AppError('bad_request', 'A tracked link starts with https://')
  const [cur] = await deps.db.select().from(socialAccounts).where(and(eq(socialAccounts.accountId, ctx.accountId), eq(socialAccounts.tag, tag)))
  const values = {
    link: patch.link !== undefined ? patch.link.trim().slice(0, 400) : cur?.link ?? '',
    code: patch.code !== undefined ? patch.code.trim().slice(0, 60) : cur?.code ?? '',
    signups: patch.signups !== undefined ? Math.max(0, Math.min(10_000_000, Math.round(patch.signups))) : cur?.signups ?? 0,
    views: patch.views !== undefined ? (patch.views == null ? null : Math.max(0, Math.round(patch.views))) : cur?.views ?? null,
    characterId: patch.characterId !== undefined ? patch.characterId : cur?.characterId ?? null,
    productId: patch.productId !== undefined ? patch.productId : cur?.productId ?? null,
    notes: patch.notes !== undefined ? patch.notes.slice(0, 400) : cur?.notes ?? '',
    updatedBy: ctx.userId, updatedAt: deps.clock.now(),
  }
  if (cur) await deps.db.update(socialAccounts).set(values).where(eq(socialAccounts.id, cur.id))
  else await deps.db.insert(socialAccounts).values({ id: newId('soc'), accountId: ctx.accountId, tag, ...values })
  return (await scoreboard(deps, ctx)).accounts.find(a => a.tag === tag)!
}

let registered = false
export function registerScaleKit(): void {
  if (registered) return
  registered = true
  registerJobHook('hook_variants', onHookVariants)
}

