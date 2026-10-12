import { eq } from 'drizzle-orm'
import { candidates, refImages } from '../db/schema'
import type { Ctx, Deps } from '../context'
import { exportCharacterFile, importCharacterFile, type ImportResult, type SheetEntry } from '../core/characterFile'
import { newId } from '../lib/ids'
import { AppError } from '../lib/errors'
import { getAsset, saveAsset } from '../storage/assets'
import { approvedAssets, createCharacter, getCharacter, getRef, refRows, setCharacterFields, toData, updateCharacter } from './characters'

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
}

export async function importCharacter(deps: Deps, ctx: Ctx, markdown: string, opts: ImportOptions = {}): Promise<{ characterId: string; result: ImportResult; importedShots: string[] }> {
  const result = importCharacterFile(markdown)
  const data = result.character
  let characterId: string
  if (opts.characterId) {
    await updateCharacter(deps, ctx, opts.characterId, data, 'imported character file')
    characterId = opts.characterId
  } else {
    const row = await createCharacter(deps, ctx, { name: data.name, data, stage: 5 })
    characterId = row.id
  }
  const importedShots: string[] = []
  const shots = deps.config.pipeline.sheet.shots
  for (const [refId, img] of Object.entries(opts.images ?? {})) {
    if (!shots.some(s => s.id === refId)) throw new AppError('bad_request', `Unknown shot ${refId}.`)
    const asset = await saveAsset(deps, ctx, { data: img.data, mime: img.mime, origin: 'upload', label: `${data.name} ${refId}` })
    const ref = await getRef(deps, ctx, characterId, refId)
    const candId = newId('cand')
    await deps.db.insert(candidates).values({ id: candId, accountId: ctx.accountId, characterId, target: refId === 'REF-00' ? 'hero' : 'sheet', refId, assetId: asset.id, status: 'approved', reviewedBy: ctx.userId, reviewedAt: deps.clock.now(), createdBy: ctx.userId })
    await deps.db.update(refImages).set({ status: 'approved', approvedCandidateId: candId, staleReason: '', staleSince: null, updatedAt: deps.clock.now() }).where(eq(refImages.id, ref.id))
    importedShots.push(refId)
  }
  const sheetModel = data.preferredModels.sheet
  if (sheetModel && !opts.characterId) await setCharacterFields(deps, ctx, characterId, { sheetLock: { model: sheetModel, quality: deps.config.pipeline.sheet.settings.quality, resolution: deps.config.pipeline.sheet.settings.resolution } })
  return { characterId, result, importedShots }
}
