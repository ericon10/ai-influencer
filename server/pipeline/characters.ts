import { and, asc, desc, eq, inArray, isNull } from 'drizzle-orm'
import { assets, candidates, characterInspirations, characterRevisions, characters, concepts, refImages } from '../db/schema'
import type { Ctx, Deps } from '../context'
import type { CharacterData, CharacterIdentity, CharacterMark, FileSection, Pronouns } from '../core/character'
import { validateCharacter } from '../core/character'
import { nextUp, sheetProgress, type ShotState } from '../core/sheet'
import { slugify } from '../core/text'
import { newId } from '../lib/ids'
import { AppError, notFound } from '../lib/errors'

export type CharacterRow = typeof characters.$inferSelect
export type CandidateRow = typeof candidates.$inferSelect
export type RefRow = typeof refImages.$inferSelect

const DEFAULT_PRONOUNS: Pronouns = { subj: 'she', obj: 'her', poss: 'her', noun: 'woman' }

export function toData(row: CharacterRow): CharacterData {
  const features = (row.features ?? {}) as { eyes?: string; pronouns?: Pronouns }
  return {
    name: row.name,
    age: row.age,
    card: row.card,
    eyes: features.eyes ?? '',
    marks: (row.marks ?? []) as CharacterMark[],
    body: row.body,
    style: (row.style ?? {}) as CharacterData['style'],
    makeup: { default: 'natural', glam_when: [], ...((row.makeup ?? {}) as Partial<CharacterData['makeup']>) },
    persona: (row.persona ?? {}) as CharacterData['persona'],
    pronouns: { ...DEFAULT_PRONOUNS, ...(features.pronouns ?? {}) },
    avoidModels: (row.avoidModels ?? []) as string[],
    preferredModels: (row.preferredModels ?? {}) as Record<string, string>,
    disclosure: row.disclosure,
    notes: row.notes,
    identity: (row.identityModel ?? null) as CharacterIdentity | null,
    sections: (row.fileSections ?? []) as FileSection[],
  }
}

function fromData(d: Partial<CharacterData>): Partial<typeof characters.$inferInsert> {
  const out: Partial<typeof characters.$inferInsert> = {}
  if (d.name !== undefined) out.name = d.name
  if (d.age !== undefined) out.age = d.age
  if (d.card !== undefined) out.card = d.card
  if (d.marks !== undefined) out.marks = d.marks
  if (d.body !== undefined) out.body = d.body
  if (d.style !== undefined) out.style = d.style
  if (d.makeup !== undefined) out.makeup = d.makeup
  if (d.persona !== undefined) out.persona = d.persona
  if (d.avoidModels !== undefined) out.avoidModels = d.avoidModels
  if (d.preferredModels !== undefined) out.preferredModels = d.preferredModels
  if (d.disclosure !== undefined) out.disclosure = d.disclosure
  if (d.notes !== undefined) out.notes = d.notes
  if (d.identity !== undefined) out.identityModel = d.identity
  if (d.sections !== undefined) out.fileSections = d.sections
  return out
}

export async function getCharacter(deps: Deps, ctx: Ctx, id: string): Promise<CharacterRow> {
  const [row] = await deps.db.select().from(characters).where(and(eq(characters.accountId, ctx.accountId), eq(characters.id, id)))
  if (!row) throw notFound('Character')
  return row
}

export async function listCharacters(deps: Deps, ctx: Ctx): Promise<CharacterRow[]> {
  return deps.db.select().from(characters).where(and(eq(characters.accountId, ctx.accountId), isNull(characters.archivedAt))).orderBy(desc(characters.updatedAt))
}

async function uniqueSlug(deps: Deps, ctx: Ctx, name: string): Promise<string> {
  const base = slugify(name)
  const rows = await deps.db.select({ slug: characters.slug }).from(characters).where(eq(characters.accountId, ctx.accountId))
  const taken = new Set(rows.map(r => r.slug))
  if (!taken.has(base)) return base
  for (let i = 2; ; i++) if (!taken.has(`${base}-${i}`)) return `${base}-${i}`
}

export async function ensureSheet(deps: Deps, ctx: Ctx, characterId: string): Promise<void> {
  const existing = await deps.db.select({ refId: refImages.refId }).from(refImages).where(eq(refImages.characterId, characterId))
  const have = new Set(existing.map(r => r.refId))
  const missing = deps.config.pipeline.sheet.shots.filter(s => !have.has(s.id))
  if (!missing.length) return
  await deps.db.insert(refImages).values(missing.map(s => ({
    id: newId('ref'), accountId: ctx.accountId, characterId, refId: s.id, view: s.view, framing: s.framing,
    aspect: deps.config.pipeline.sheet.settings.aspect[s.framing], dependsOn: s.attach,
  })))
}

export async function createCharacter(deps: Deps, ctx: Ctx, input: { name: string; data?: Partial<CharacterData>; stage?: number }): Promise<CharacterRow> {
  const name = input.name.trim() || 'Untitled character'
  const id = newId('chr')
  const features: Record<string, unknown> = {}
  if (input.data?.eyes) features.eyes = input.data.eyes
  if (input.data?.pronouns) features.pronouns = input.data.pronouns
  const [row] = await deps.db.insert(characters).values({
    id, accountId: ctx.accountId, name, slug: await uniqueSlug(deps, ctx, name), createdBy: ctx.userId,
    stage: input.stage ?? 1, features, ...fromData(input.data ?? {}),
  }).returning()
  await ensureSheet(deps, ctx, id)
  await deps.db.insert(characterRevisions).values({ id: newId('rev'), accountId: ctx.accountId, characterId: id, revision: 1, snapshot: toData(row!), reason: 'created', createdBy: ctx.userId })
  return row!
}

// Every edit is a new revision; nothing is lost.
export async function updateCharacter(deps: Deps, ctx: Ctx, id: string, patch: Partial<CharacterData>, reason: string): Promise<CharacterRow> {
  const current = await getCharacter(deps, ctx, id)
  const merged = { ...toData(current), ...patch }
  const errors = validateCharacter(merged).filter(i => i.severity === 'error' && (patch.age !== undefined || patch.marks !== undefined || patch.body !== undefined || patch.card !== undefined))
  if (errors.length) throw new AppError('invalid_request', errors.map(e => e.message).join(' '), errors)
  const features = { ...(current.features as object), ...(patch.eyes !== undefined ? { eyes: patch.eyes } : {}), ...(patch.pronouns ? { pronouns: patch.pronouns } : {}) }
  const revision = current.revision + 1
  const [row] = await deps.db.update(characters).set({ ...fromData(patch), features, revision, updatedAt: deps.clock.now(), slug: patch.name ? await uniqueSlug(deps, ctx, patch.name) : current.slug })
    .where(eq(characters.id, id)).returning()
  await deps.db.insert(characterRevisions).values({ id: newId('rev'), accountId: ctx.accountId, characterId: id, revision, snapshot: toData(row!), reason, createdBy: ctx.userId })
  return row!
}

export async function setCharacterFields(deps: Deps, ctx: Ctx, id: string, fields: Partial<Pick<CharacterRow, 'stage' | 'status' | 'sheetLock' | 'breakdown' | 'archivedAt'>>): Promise<void> {
  await deps.db.update(characters).set({ ...fields, updatedAt: deps.clock.now() }).where(and(eq(characters.accountId, ctx.accountId), eq(characters.id, id)))
}

export async function linkInspiration(deps: Deps, ctx: Ctx, characterId: string, assetId: string): Promise<void> {
  await getCharacter(deps, ctx, characterId)
  const [a] = await deps.db.select().from(assets).where(and(eq(assets.accountId, ctx.accountId), eq(assets.id, assetId)))
  if (!a || a.kind !== 'image') throw new AppError('bad_request', 'Inspiration must be an image you uploaded.')
  const count = (await deps.db.select().from(characterInspirations).where(eq(characterInspirations.characterId, characterId))).length
  await deps.db.insert(characterInspirations).values({ accountId: ctx.accountId, characterId, assetId, position: count }).onConflictDoNothing()
}

export async function inspirationAssetIds(deps: Deps, ctx: Ctx, characterId: string): Promise<string[]> {
  const rows = await deps.db.select().from(characterInspirations)
    .where(and(eq(characterInspirations.accountId, ctx.accountId), eq(characterInspirations.characterId, characterId))).orderBy(asc(characterInspirations.position))
  return rows.map(r => r.assetId)
}

export async function listConcepts(deps: Deps, ctx: Ctx, characterId: string) {
  return deps.db.select().from(concepts).where(and(eq(concepts.accountId, ctx.accountId), eq(concepts.characterId, characterId))).orderBy(desc(concepts.createdAt), asc(concepts.position))
}

export async function refRows(deps: Deps, ctx: Ctx, characterId: string): Promise<RefRow[]> {
  return deps.db.select().from(refImages).where(and(eq(refImages.accountId, ctx.accountId), eq(refImages.characterId, characterId)))
}

export async function getRef(deps: Deps, ctx: Ctx, characterId: string, refId: string): Promise<RefRow> {
  const [row] = await deps.db.select().from(refImages).where(and(eq(refImages.accountId, ctx.accountId), eq(refImages.characterId, characterId), eq(refImages.refId, refId)))
  if (!row) throw notFound(`Shot ${refId}`)
  return row
}

export async function candidatesFor(deps: Deps, ctx: Ctx, characterId: string, filter: { target?: string; refId?: string; statuses?: string[] } = {}): Promise<CandidateRow[]> {
  const conds = [eq(candidates.accountId, ctx.accountId), eq(candidates.characterId, characterId)]
  if (filter.target) conds.push(eq(candidates.target, filter.target))
  if (filter.refId) conds.push(eq(candidates.refId, filter.refId))
  if (filter.statuses) conds.push(inArray(candidates.status, filter.statuses))
  return deps.db.select().from(candidates).where(and(...conds)).orderBy(desc(candidates.createdAt))
}

export async function getCandidate(deps: Deps, ctx: Ctx, id: string): Promise<CandidateRow> {
  const [row] = await deps.db.select().from(candidates).where(and(eq(candidates.accountId, ctx.accountId), eq(candidates.id, id)))
  if (!row) throw notFound('Candidate')
  return row
}

// The approved asset for each shot, for attaching refs and for the UI.
export async function approvedAssets(deps: Deps, ctx: Ctx, characterId: string): Promise<Map<string, string>> {
  const refs = await refRows(deps, ctx, characterId)
  const ids = refs.map(r => r.approvedCandidateId).filter((x): x is string => !!x)
  if (!ids.length) return new Map()
  const cands = await deps.db.select().from(candidates).where(and(eq(candidates.accountId, ctx.accountId), inArray(candidates.id, ids)))
  const byId = new Map(cands.map(c => [c.id, c.assetId]))
  const out = new Map<string, string>()
  for (const r of refs) {
    const a = r.approvedCandidateId ? byId.get(r.approvedCandidateId) : null
    if (a && r.status !== 'pending') out.set(r.refId, a)
  }
  return out
}

export async function sheetState(deps: Deps, ctx: Ctx, characterId: string) {
  const shots = deps.config.pipeline.sheet.shots
  const refs = await refRows(deps, ctx, characterId)
  const states: ShotState[] = shots.map(s => ({ refId: s.id, status: (refs.find(r => r.refId === s.id)?.status ?? 'pending') as ShotState['status'] }))
  return { shots, refs, states, next: nextUp(shots, states), progress: sheetProgress(shots, states) }
}
