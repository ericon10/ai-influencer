import { and, eq } from 'drizzle-orm'
import { candidates, refImages } from '../db/schema'
import type { Ctx, Deps } from '../context'
import { exportCharacterFile, importCharacterFile, type ImportResult, type SheetEntry } from '../core/characterFile'
import { newId } from '../lib/ids'
import { AppError } from '../lib/errors'
import { getAsset, saveAsset } from '../storage/assets'
import { approvedAssets, createCharacter, getCharacter, getRef, refRows, setCharacterFields, toData, updateCharacter } from './characters'
import { markDependentsStale } from './review'

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

export async function importCharacter(deps: Deps, ctx: Ctx, markdown: string, opts: ImportOptions = {}): Promise<{ characterId: string; result: ImportResult; importedShots: string[]; checkShots: string[] }> {
  const result = importCharacterFile(markdown, { models: deps.config.models.models })
  const data = result.character
  let characterId: string
  if (opts.characterId) {
    await updateCharacter(deps, ctx, opts.characterId, data, 'imported character file')
    characterId = opts.characterId
  } else {
    const row = await createCharacter(deps, ctx, { name: data.name, data, stage: 5 })
    characterId = row.id
  }
  const importedShots = await attachSheetImages(deps, ctx, characterId, opts.images ?? {}, data.name)
  const checkShots = await attachCheckImages(deps, ctx, characterId, opts.checks ?? [])
  const sheetModel = data.preferredModels.sheet
  if (sheetModel && !opts.characterId) await setCharacterFields(deps, ctx, characterId, { sheetLock: { model: sheetModel, quality: deps.config.pipeline.sheet.settings.quality, resolution: deps.config.pipeline.sheet.settings.resolution } })
  return { characterId, result, importedShots, checkShots }
}

// Approved sheet images brought in from outside (for example a sheet built
// before the Studio). An image that replaces an approved one supersedes it
// and marks the shots built on it for re-check, as a regeneration would.
export async function attachSheetImages(deps: Deps, ctx: Ctx, characterId: string, images: Record<string, { data: Buffer; mime?: string }>, label?: string): Promise<string[]> {
  const shots = deps.config.pipeline.sheet.shots
  const name = label ?? (await getCharacter(deps, ctx, characterId)).name
  const attached: string[] = []
  const order = Object.keys(images).sort()
  for (const refId of order) {
    if (!shots.some(s => s.id === refId)) throw new AppError('bad_request', `Unknown shot ${refId}.`)
  }
  for (const refId of order) {
    const img = images[refId]!
    const asset = await saveAsset(deps, ctx, { data: img.data, mime: img.mime, origin: 'upload', label: `${name} ${refId}` })
    const ref = await getRef(deps, ctx, characterId, refId)
    const previous = ref.approvedCandidateId
    const candId = newId('cand')
    const now = deps.clock.now()
    await deps.db.insert(candidates).values({ id: candId, accountId: ctx.accountId, characterId, target: refId === 'REF-00' ? 'hero' : 'sheet', refId, assetId: asset.id, status: 'approved', reviewedBy: ctx.userId, reviewedAt: now, createdBy: ctx.userId })
    if (previous) await deps.db.update(candidates).set({ status: 'superseded', updatedAt: now }).where(and(eq(candidates.accountId, ctx.accountId), eq(candidates.id, previous)))
    await deps.db.update(refImages).set({ status: 'approved', approvedCandidateId: candId, staleReason: '', staleSince: null, updatedAt: now }).where(eq(refImages.id, ref.id))
    if (previous) await markDependentsStale(deps, ctx, characterId, refId)
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
