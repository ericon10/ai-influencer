import { and, eq, isNull } from 'drizzle-orm'
import { characters } from '../db/schema.js'
import type { Ctx, Deps } from '../context.js'
import { readBrand, writeBrand, type BrandLayer, type BrandPatch } from '../core/brand.js'
import { importCharacterFile } from '../core/characterFile.js'
import { checkTemplate, type TemplateReport } from '../core/templateCheck.js'
import { getCharacter, toData, updateCharacter } from './characters.js'
import { exportCharacter } from './files.js'

// Character files from the Claude project (character template v1.6; owner,
// 2026-10-15, long run part 3): the free template check before an import
// and on the character page, and the brand layer read from and written
// back into the file's own sections.

export async function characterBrand(deps: Deps, ctx: Ctx, id: string): Promise<BrandLayer> {
  return readBrand(toData(await getCharacter(deps, ctx, id)).sections)
}

export async function updateBrand(deps: Deps, ctx: Ctx, id: string, patch: BrandPatch): Promise<BrandLayer> {
  const ch = toData(await getCharacter(deps, ctx, id))
  const sections = writeBrand(ch.sections, patch)
  await updateCharacter(deps, ctx, id, { sections }, `brand: ${Object.keys(patch).join(', ') || 'no change'}`)
  return readBrand(sections)
}

// The character's current file, checked against the template.
export async function characterTemplate(deps: Deps, ctx: Ctx, id: string): Promise<TemplateReport> {
  return checkTemplate((await exportCharacter(deps, ctx, id)).markdown)
}

// Before an import: the check, and the character of the same name if
// there is one (the import updates it by default, keeping its posts).
export async function importCheck(deps: Deps, ctx: Ctx, markdown: string): Promise<{ report: TemplateReport; name: string; match: { id: string; name: string } | null }> {
  const report = checkTemplate(markdown)
  let name = ''
  try { name = importCharacterFile(markdown, { models: deps.config.models.models }).character.name.trim() } catch { name = '' }
  const rows = name ? await deps.db.select({ id: characters.id, name: characters.name }).from(characters)
    .where(and(eq(characters.accountId, ctx.accountId), isNull(characters.archivedAt))) : []
  const match = rows.find(r => r.name.trim().toLowerCase() === name.toLowerCase()) ?? null
  return { report, name, match }
}
