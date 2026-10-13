import { and, desc, eq, inArray, isNull, sql } from 'drizzle-orm'
import sharp from 'sharp'
import { candidates, jobs, scenes } from '../db/schema.js'
import type { Ctx, Deps } from '../context.js'
import { AppError, notFound } from '../lib/errors.js'
import { audit } from '../lib/audit.js'
import { newId } from '../lib/ids.js'
import { readAsset, saveAsset } from '../storage/assets.js'
import {
  COMBO_TITLE, appendCombo, aspectFor, checkSceneFields, comboConflict, comboEntryFor, isComboSection, parseComboLog,
  pickSceneRefs, sceneFieldsSchema, type ComboEntry, type RefPick, type SceneFields,
} from '../core/scenes.js'
import { getCandidate, getCharacter, toData, updateCharacter, approvedAssets, sheetState } from './characters.js'
import { ruleSwitches } from './rules.js'

// Scenes (Stage 7) and still edits (Stage 8): the scene records, the free
// steps (crop, mirror) and the human gate. Paid steps are actions.

export type SceneRow = typeof scenes.$inferSelect

export async function getScene(deps: Deps, ctx: Ctx, id: string): Promise<SceneRow> {
  const [row] = await deps.db.select().from(scenes).where(and(eq(scenes.accountId, ctx.accountId), eq(scenes.id, id)))
  if (!row) throw notFound('Scene')
  return row
}

export async function listScenes(deps: Deps, ctx: Ctx, characterId: string): Promise<SceneRow[]> {
  return deps.db.select().from(scenes)
    .where(and(eq(scenes.accountId, ctx.accountId), eq(scenes.characterId, characterId), isNull(scenes.archivedAt)))
    .orderBy(desc(scenes.createdAt))
}

// Fields as far as they are filled in. A draft can be incomplete; a run
// needs every required field (sceneFields below).
export function draftFields(row: SceneRow): Partial<SceneFields> {
  return (row.fields ?? {}) as Partial<SceneFields>
}

export function sceneFields(deps: Deps, row: SceneRow): SceneFields {
  const parsed = sceneFieldsSchema.safeParse(row.fields ?? {})
  if (!parsed.success) {
    const first = parsed.error.issues[0]
    throw new AppError('invalid_request', `Finish the scene first: ${first?.path.join('.') || 'fields'} ${first?.message ?? 'is missing'}.`)
  }
  const issues = checkSceneFields(deps.config.pipeline.scenes, deps.config.pipeline.views, parsed.data)
  if (issues.length) throw new AppError('invalid_request', issues.map(i => i.message).join(' '))
  return parsed.data
}

export async function createScene(deps: Deps, ctx: Ctx, characterId: string, input: { brief?: string; title?: string; fields?: Partial<SceneFields> }): Promise<SceneRow> {
  await getCharacter(deps, ctx, characterId)
  const [row] = await deps.db.insert(scenes).values({
    id: newId('scn'), accountId: ctx.accountId, characterId, createdBy: ctx.userId,
    brief: (input.brief ?? '').slice(0, 2000), title: (input.title ?? input.fields?.title ?? '').slice(0, 80),
    fields: cleanFields(input.fields ?? {}),
  }).returning()
  await audit(deps.db, ctx, 'scene.created', { type: 'scene', id: row!.id })
  return row!
}

// Only known fields are kept, trimmed to their limits.
function cleanFields(f: Partial<SceneFields>): Partial<SceneFields> {
  const shape = sceneFieldsSchema.shape
  const out: Record<string, unknown> = {}
  for (const [k, v] of Object.entries(f)) {
    if (!(k in shape) || v === undefined || v === null) continue
    out[k] = typeof v === 'string' ? v.slice(0, 400) : Array.isArray(v) ? v.filter(x => typeof x === 'string').slice(0, 8) : v
  }
  return out as Partial<SceneFields>
}

export async function updateScene(deps: Deps, ctx: Ctx, id: string, patch: { brief?: string; title?: string; fields?: Partial<SceneFields> }): Promise<SceneRow> {
  const row = await getScene(deps, ctx, id)
  const fields = patch.fields ? { ...draftFields(row), ...cleanFields(patch.fields) } : draftFields(row)
  const [out] = await deps.db.update(scenes).set({
    brief: patch.brief !== undefined ? patch.brief.slice(0, 2000) : row.brief,
    title: patch.title !== undefined ? patch.title.slice(0, 80) : (patch.fields?.title ?? row.title),
    fields, updatedAt: deps.clock.now(),
  }).where(eq(scenes.id, row.id)).returning()
  return out!
}

export async function archiveScene(deps: Deps, ctx: Ctx, id: string): Promise<void> {
  const row = await getScene(deps, ctx, id)
  await deps.db.update(scenes).set({ archivedAt: deps.clock.now(), updatedAt: deps.clock.now() }).where(eq(scenes.id, row.id))
  await audit(deps.db, ctx, 'scene.archived', { type: 'scene', id: row.id })
}

// ── Combo log (SPEC 5.2 rule 21) ──────────────────────────────────

export function comboEntries(ch: ReturnType<typeof toData>): ComboEntry[] {
  const section = ch.sections.find(s => isComboSection(s.title))
  return section ? parseComboLog(section.body) : []
}

// A warning, never a block (default rule scene-combo-log).
export function comboProblem(deps: Deps, ch: ReturnType<typeof toData>, f: SceneFields): string | null {
  const sc = deps.config.pipeline.scenes
  const entry = comboEntryFor(sc, f, '')
  const hit = comboConflict(comboEntries(ch), entry.moment, entry.camera, sc.settings.combo_window)
  return hit ? `"${entry.moment}" with "${entry.camera}" was used on ${hit.date} (${hit.location || 'no place noted'}). A different moment or camera keeps the feed fresh, or use it anyway.` : null
}

// Writes the scene to the character's combo log once, on its first pick.
async function logCombo(deps: Deps, ctx: Ctx, scene: SceneRow): Promise<void> {
  if (scene.comboLoggedAt) return
  const ch = toData(await getCharacter(deps, ctx, scene.characterId))
  const sc = deps.config.pipeline.scenes
  const entry = comboEntryFor(sc, sceneFields(deps, scene), deps.clock.now().toISOString().slice(0, 10))
  const existing = ch.sections.find(s => isComboSection(s.title))
  const sections = existing
    ? ch.sections.map(s => (s === existing ? { ...s, body: appendCombo(s.body, entry, sc.settings.combo_window) } : s))
    : [...ch.sections, { title: COMBO_TITLE, body: appendCombo('', entry, sc.settings.combo_window) }]
  await updateCharacter(deps, ctx, scene.characterId, { sections }, `combo log: ${entry.moment} / ${entry.camera}`)
  await deps.db.update(scenes).set({ comboLoggedAt: deps.clock.now() }).where(eq(scenes.id, scene.id))
}

// ── References ─────────────────────────────────────────────────────

export interface SceneRef extends RefPick { assetId: string }

// The sheet refs a scene attaches, chosen by angle (SPEC 5.2 rule 14).
export async function sceneRefs(deps: Deps, ctx: Ctx, characterId: string, f: Pick<SceneFields, 'view' | 'framing' | 'expression'> & { refs?: string[] }, byAngle = true): Promise<SceneRef[]> {
  const approved = await approvedAssets(deps, ctx, characterId)
  const state = await sheetState(deps, ctx, characterId)
  const usable = new Set(state.states.filter(s => s.status === 'approved' || s.status === 'stale').map(s => s.refId).filter(id => approved.has(id)))
  const picks = pickSceneRefs(deps.config.pipeline.sheet.shots, deps.config.pipeline.views, usable, f, deps.config.pipeline.scenes, byAngle)
  return picks.map(p => ({ ...p, assetId: approved.get(p.refId)! }))
}

// ── Candidates ─────────────────────────────────────────────────────

export async function sceneCandidates(deps: Deps, ctx: Ctx, sceneIds: string[]) {
  if (!sceneIds.length) return []
  return deps.db.select().from(candidates)
    .where(and(eq(candidates.accountId, ctx.accountId), inArray(candidates.sceneId, sceneIds)))
    .orderBy(desc(candidates.createdAt))
}

// Jobs still working for a scene (stills, edits, upscales, their QA).
export async function sceneBusy(deps: Deps, ctx: Ctx, sceneId: string): Promise<boolean> {
  const rows = await deps.db.select({ id: jobs.id }).from(jobs).where(and(
    eq(jobs.accountId, ctx.accountId), inArray(jobs.status, ['waiting', 'queued', 'submitting', 'running', 'ingesting']),
    sql`split_part(${jobs.purpose}, ':', 2) = ${sceneId}`,
  )).limit(1)
  return rows.length > 0
}

export async function markSceneBusy(deps: Deps, ctx: Ctx, sceneId: string): Promise<void> {
  await deps.db.update(scenes).set({ status: 'generating', updatedAt: deps.clock.now() }).where(and(eq(scenes.accountId, ctx.accountId), eq(scenes.id, sceneId)))
}

export async function refreshSceneStatus(deps: Deps, ctx: Ctx, sceneId: string): Promise<void> {
  const scene = await getScene(deps, ctx, sceneId)
  const cands = await sceneCandidates(deps, ctx, [sceneId])
  let status = 'draft'
  if (cands.some(c => c.status === 'approved')) status = 'approved'
  else if (await sceneBusy(deps, ctx, sceneId) || cands.some(c => c.status === 'qa_pending')) status = 'generating'
  else if (cands.length) status = 'in_review'
  if (status !== scene.status) await deps.db.update(scenes).set({ status, updatedAt: deps.clock.now() }).where(eq(scenes.id, scene.id))
}

async function sceneCandidate(deps: Deps, ctx: Ctx, id: string) {
  const cand = await getCandidate(deps, ctx, id)
  if (!cand.sceneId || !cand.assetId) throw new AppError('bad_request', 'That is not a scene still.')
  return cand
}

// The human gate for scenes: picks. Several stills of one scene can be
// picked (a wide still, its crop and a look frame, for example).
// Face drift is a strong warning (default rule qa-face-drift): the pick
// needs `acknowledge`, then it is the owner's call. Plastic or smoothed
// skin is the fixed Realism rule and cannot be picked.
export async function approveSceneCandidate(deps: Deps, ctx: Ctx, id: string, opts: { acknowledge?: boolean } = {}): Promise<{ comboLogged: boolean }> {
  const cand = await sceneCandidate(deps, ctx, id)
  if (!['in_review', 'qa_failed', 'rejected', 'superseded', 'approved'].includes(cand.status)) throw new AppError('conflict', 'This still is not ready for review yet.')
  const report = cand.qaReport as { findings?: Array<{ code: string; severity: string }> } | null
  const fails = (code: string) => !!report?.findings?.some(f => f.severity === 'fail' && f.code === code)
  if (fails('skin_plastic') || fails('skin_smoothed')) {
    throw new AppError('bad_request', 'The skin in this still came back smoothed or plastic. Real skin is a fixed rule, so it cannot be picked; regenerate it.')
  }
  if (fails('face_drift') && !opts.acknowledge && (await ruleSwitches(deps, ctx, cand.characterId)).on('qa-face-drift')) {
    throw new AppError('confirm_required', 'QA found that the face does not match REF-00. Pick it anyway?')
  }
  const now = deps.clock.now()
  await deps.db.update(candidates).set({ status: 'approved', reviewedBy: ctx.userId, reviewedAt: now, updatedAt: now }).where(eq(candidates.id, cand.id))
  const scene = await getScene(deps, ctx, cand.sceneId!)
  const first = !scene.comboLoggedAt
  await logCombo(deps, ctx, scene)
  await refreshSceneStatus(deps, ctx, scene.id)
  await audit(deps.db, ctx, 'scene.approved', { type: 'candidate', id: cand.id }, { sceneId: scene.id })
  return { comboLogged: first }
}

// A closer shot of the same scene is a crop of the wide still, never a new
// generation (Callie's scene rules). Free; an upscale brings it to size.
export async function cropCandidate(deps: Deps, ctx: Ctx, id: string, rect: { x: number; y: number; w: number; h: number }): Promise<{ candidateId: string; width: number; height: number }> {
  const cand = await sceneCandidate(deps, ctx, id)
  const scene = await getScene(deps, ctx, cand.sceneId!)
  const { data } = await readAsset(deps, ctx, cand.assetId!)
  const meta = await sharp(data).metadata()
  const W = meta.width ?? 0, H = meta.height ?? 0
  const clamp = (v: number) => Math.min(1, Math.max(0, Number.isFinite(v) ? v : 0))
  const left = Math.round(clamp(rect.x) * W), top = Math.round(clamp(rect.y) * H)
  const width = Math.min(W - left, Math.round(clamp(rect.w) * W)), height = Math.min(H - top, Math.round(clamp(rect.h) * H))
  if (width < 64 || height < 64) throw new AppError('bad_request', 'That crop is too small to use.')
  if (width >= W && height >= H) throw new AppError('bad_request', 'Drag the frame smaller to crop in.')
  const out = await sharp(data).extract({ left, top, width, height }).png().toBuffer()
  const asset = await saveAsset(deps, ctx, { data: out, origin: 'derived', label: `${scene.title || 'Scene'} crop` })
  const newIdValue = newId('cand')
  await deps.db.insert(candidates).values({
    id: newIdValue, accountId: ctx.accountId, characterId: cand.characterId, target: 'scene', sceneId: cand.sceneId, parentId: cand.id, op: 'crop',
    assetId: asset.id, prompt: cand.prompt, status: 'in_review', createdBy: ctx.userId,
    qaReport: { verdict: 'uncertain', summary: `Needs your eye: a crop of a still, ${width} x ${height} px. Upscale it 2x before posting.`, findings: [{ code: 'uncertain', severity: 'info', message: 'A crop of an existing still: same environment, no new generation.' }], reasons: [], detectedView: null },
    qaVerdict: 'uncertain',
  })
  await refreshSceneStatus(deps, ctx, scene.id)
  await audit(deps.db, ctx, 'scene.cropped', { type: 'candidate', id: newIdValue }, { from: cand.id, rect })
  return { candidateId: newIdValue, width, height }
}

// The destination aspect for a scene, used by the crop frame in the UI.
export function sceneAspect(deps: Deps, f: Partial<SceneFields>): string {
  try { return aspectFor(deps.config.pipeline.scenes, { destination: f.destination ?? 'vertical' }) } catch { return '9:16' }
}
