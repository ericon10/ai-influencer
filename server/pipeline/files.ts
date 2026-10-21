import { and, eq } from 'drizzle-orm'
import { candidates, refImages } from '../db/schema.js'
import type { Ctx, Deps } from '../context.js'
import { exportCharacterFile, importCharacterFile, type ImportResult, type SheetEntry } from '../core/characterFile.js'
import type { CharacterData, FileSection } from '../core/character.js'
import { appendCombo, isComboSection, parseComboLog, formatComboEntry } from '../core/scenes.js'
import { newId } from '../lib/ids.js'
import { sha256Hex } from '../lib/passwords.js'
import { AppError } from '../lib/errors.js'
import { getAsset, saveAsset } from '../storage/assets.js'
import { approvedAssets, createCharacter, getCharacter, getRef, refRows, setCharacterFields, toData, updateCharacter } from './characters.js'
import { markDependentsStale } from './review.js'
import { scoreDistinctness } from './identity.js'
import { liveRoute } from './settings.js'

// Stage 5: character-[name].md export and import (SPEC 8).

export async function exportCharacter(deps: Deps, ctx: Ctx, characterId: string): Promise<{ filename: string; markdown: string }> {
  const row = await getCharacter(deps, ctx, characterId)
  const approved = await approvedAssets(deps, ctx, characterId)
  const refs = await refRows(deps, ctx, characterId)
  const sheet: SheetEntry[] = []
  for (const shot of deps.config.pipeline.sheet.shots) {
    const ref = refs.find(r => r.refId === shot.id)
    const assetId = approved.get(shot.id)
    sheet.push({ id: shot.id, label: shot.label, status: ref?.status ?? 'pending', checksum: assetId ? (await getAsset(deps, ctx, assetId)).checksumSha256 : null })
  }
  return { filename: `character-${row.slug}.md`, markdown: exportCharacterFile(toData(row), sheet) }
}

export interface ImportOptions {
  characterId?: string // apply edits to an existing character instead of creating one
  images?: Record<string, { data: Buffer; mime?: string }> // REF-xx -> approved sheet image
  checks?: CheckImage[] // images to check with QA, never approved on import
}

export async function importCharacter(deps: Deps, ctx: Ctx, markdown: string, opts: ImportOptions = {}): Promise<{ characterId: string; result: ImportResult; importedShots: string[]; unchangedShots: string[]; checkShots: string[] }> {
  const result = importCharacterFile(markdown, { models: deps.config.models.models })
  let data = result.character
  let characterId: string
  if (opts.characterId) {
    // A re-import (owner, 2026-10-15): the file's words replace the
    // character's words; posts, takes, stills and the sheet live elsewhere
    // and stay. What the Studio added since the last export is kept.
    const current = toData(await getCharacter(deps, ctx, opts.characterId))
    data = mergeReimport(current, data, deps.config.pipeline.scenes.settings.combo_window)
    await updateCharacter(deps, ctx, opts.characterId, data, 'imported character file')
    characterId = opts.characterId
  } else {
    const row = await createCharacter(deps, ctx, { name: data.name, data, stage: 5 })
    characterId = row.id
  }
  const unchangedShots: string[] = []
  const importedShots = await attachSheetImages(deps, ctx, characterId, opts.images ?? {}, data.name, unchangedShots)
  const checkShots = await attachCheckImages(deps, ctx, characterId, opts.checks ?? [])
  const sheetModel = data.preferredModels.sheet
  if (sheetModel && !opts.characterId) await setCharacterFields(deps, ctx, characterId, { sheetLock: { model: sheetModel, quality: deps.config.pipeline.sheet.settings.quality, resolution: deps.config.pipeline.sheet.settings.resolution } })
  return { characterId, result, importedShots, unchangedShots, checkShots }
}

// On a re-import: the combo log merged (the Studio's entries kept, the
// newest `window`), every saved identity kept, and the voice card and the
// REALISM block kept when the file has none.
export function mergeReimport(current: CharacterData, incoming: CharacterData, window: number): CharacterData {
  const out = { ...incoming }
  const mine = current.sections.find(s => isComboSection(s.title))
  const theirs = incoming.sections.find(s => isComboSection(s.title))
  if (mine) {
    const seen = new Set<string>()
    const all = [...parseComboLog(mine.body), ...(theirs ? parseComboLog(theirs.body) : [])]
      .filter(e => { const k = formatComboEntry(e).toLowerCase(); if (seen.has(k)) return false; seen.add(k); return true })
      .sort((a, b) => a.date.localeCompare(b.date))
    let body = ''
    for (const e of all) body = appendCombo(body, e, window)
    const section: FileSection = { title: theirs?.title ?? mine.title, body }
    out.sections = theirs ? incoming.sections.map(s => (s === theirs ? section : s)) : [...incoming.sections, section]
  }
  // A saved identity is never dropped by a file that leaves it out (an
  // Element takes a new build to replace); the file's own come first.
  const ids = new Set(incoming.identities.map(i => i.externalId))
  out.identities = [...incoming.identities, ...current.identities.filter(i => !ids.has(i.externalId))]
  if (!incoming.persona.voice && current.persona.voice) out.persona = { ...incoming.persona, voice: current.persona.voice }
  if (!incoming.realism?.block && current.realism?.block) out.realism = { ...current.realism, ...incoming.realism, block: current.realism.block }
  return out
}

// Approved sheet images brought in from outside (for example a sheet built
// before the Studio). An image that replaces an approved one supersedes it
// and marks the shots built on it for re-check, as a regeneration would.
export async function attachSheetImages(deps: Deps, ctx: Ctx, characterId: string, images: Record<string, { data: Buffer; mime?: string }>, label?: string, unchanged: string[] = [], opts: { stale?: boolean } = {}): Promise<string[]> {
  const shots = deps.config.pipeline.sheet.shots
  const name = label ?? (await getCharacter(deps, ctx, characterId)).name
  const attached: string[] = []
  const order = Object.keys(images).sort()
  for (const refId of order) {
    if (!shots.some(s => s.id === refId)) throw new AppError('bad_request', `Unknown shot ${refId}.`)
  }
  const approved = await approvedAssets(deps, ctx, characterId)
  for (const refId of order) {
    const img = images[refId]!
    // The same image as the approved one (a re-import of the same folder):
    // nothing to do, so nothing built on it goes stale.
    const currentId = approved.get(refId)
    if (currentId && (await getAsset(deps, ctx, currentId)).checksumSha256 === sha256Hex(img.data)) { unchanged.push(refId); continue }
    const asset = await saveAsset(deps, ctx, { data: img.data, mime: img.mime, origin: 'upload', label: `${name} ${refId}` })
    const ref = await getRef(deps, ctx, characterId, refId)
    const previous = ref.approvedCandidateId
    const candId = newId('cand')
    const now = deps.clock.now()
    await deps.db.insert(candidates).values({ id: candId, accountId: ctx.accountId, characterId, target: refId === 'REF-00' ? 'hero' : 'sheet', refId, assetId: asset.id, status: 'approved', reviewedBy: ctx.userId, reviewedAt: now, createdBy: ctx.userId })
    if (previous) await deps.db.update(candidates).set({ status: 'superseded', updatedAt: now }).where(and(eq(candidates.accountId, ctx.accountId), eq(candidates.id, previous)))
    await deps.db.update(refImages).set({ status: 'approved', approvedCandidateId: candId, staleReason: '', staleSince: null, updatedAt: now }).where(eq(refImages.id, ref.id))
    if (previous && opts.stale !== false) await markDependentsStale(deps, ctx, characterId, refId)
    attached.push(refId)
  }
  return attached
}

export interface CheckImage { refId: string; name: string; data: Buffer; mime?: string }

// Images brought in to be checked, such as a mirrored REF-04 kept as a
// negative test. They sit beside the shot as "to check", never in the sheet
// and never in the review queue; QA on one is a quoted action.
export async function attachCheckImages(deps: Deps, ctx: Ctx, characterId: string, checks: CheckImage[]): Promise<string[]> {
  const shots = deps.config.pipeline.sheet.shots
  const added: string[] = []
  for (const c of checks) {
    if (!shots.some(s => s.id === c.refId)) throw new AppError('bad_request', `Unknown shot ${c.refId}.`)
    const asset = await saveAsset(deps, ctx, { data: c.data, mime: c.mime, origin: 'upload', label: c.name })
    await deps.db.insert(candidates).values({
      id: newId('cand'), accountId: ctx.accountId, characterId, target: 'sheet', refId: c.refId, assetId: asset.id,
      status: 'check', rejectNote: `Uploaded to check: ${c.name}`, createdBy: ctx.userId,
    })
    added.push(c.name)
  }
  return added
}

// One reference image added, replaced or removed by hand (owner,
// 2026-10-22; UX-PLAN.md section 35, items 3c and 3d), without a rebuild:
// the shots built on it keep their images, and every prompt builder picks
// refs by framing from what is approved now, so the new one is used at
// once. An image uploaded as REF-00 is the hero (any upload can be): the
// fixed rule still holds, so one too close to an inspiration face is
// refused; the face check is free.
export async function setRefImage(deps: Deps, ctx: Ctx, characterId: string, refId: string, img: { data: Buffer; mime?: string }): Promise<{ refId: string; unchanged: boolean }> {
  const ch = await getCharacter(deps, ctx, characterId)
  if (!deps.config.pipeline.sheet.shots.some(s => s.id === refId)) throw new AppError('bad_request', `Unknown shot ${refId}.`)
  const unchanged: string[] = []
  await attachSheetImages(deps, ctx, characterId, { [refId]: img }, ch.name, unchanged, { stale: false })
  if (refId === 'REF-00' && !unchanged.length) {
    const ref = await getRef(deps, ctx, characterId, 'REF-00')
    const cand = ref.approvedCandidateId!
    const [row] = await deps.db.select({ assetId: candidates.assetId }).from(candidates).where(eq(candidates.id, cand))
    const qa = await scoreDistinctness(deps, ctx, { characterId, assetId: row!.assetId!, demo: false })
    if (qa?.findings.some(f => f.code === 'too_similar' && f.severity === 'fail')) {
      await clearRefImage(deps, ctx, characterId, 'REF-00', { allowHero: true })
      throw new AppError('bad_request', `${qa.findings.find(f => f.code === 'too_similar')!.message} Upload another image as the hero.`)
    }
    if (!ch.sheetLock) {
      const route = await liveRoute(deps, ctx, 'sheet')
      await setCharacterFields(deps, ctx, ch.id, { sheetLock: { model: route.model, quality: deps.config.pipeline.sheet.settings.quality, resolution: deps.config.pipeline.sheet.settings.resolution } })
    }
    if (ch.stage < 4) await setCharacterFields(deps, ctx, ch.id, { stage: 4 })
  }
  return { refId, unchanged: unchanged.length > 0 }
}

export async function clearRefImage(deps: Deps, ctx: Ctx, characterId: string, refId: string, opts: { allowHero?: boolean } = {}): Promise<void> {
  if (refId === 'REF-00' && !opts.allowHero) throw new AppError('bad_request', 'REF-00 is the face every shot copies: replace it instead of removing it.')
  const ref = await getRef(deps, ctx, characterId, refId)
  const now = deps.clock.now()
  if (ref.approvedCandidateId) await deps.db.update(candidates).set({ status: 'superseded', updatedAt: now }).where(and(eq(candidates.accountId, ctx.accountId), eq(candidates.id, ref.approvedCandidateId)))
  await deps.db.update(refImages).set({ status: 'pending', approvedCandidateId: null, staleReason: '', staleSince: null, updatedAt: now }).where(eq(refImages.id, ref.id))
}
