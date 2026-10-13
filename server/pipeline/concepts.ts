import { and, eq } from 'drizzle-orm'
import { concepts } from '../db/schema.js'
import type { Ctx, Deps } from '../context.js'
import type { Concept } from '../core/llmSchemas.js'
import { AppError, notFound } from '../lib/errors.js'
import { audit } from '../lib/audit.js'
import { getCharacter, setCharacterFields, updateCharacter } from './characters.js'

// Stage 2 gate: a person picks one of three concepts; it becomes the card.
export async function chooseConcept(deps: Deps, ctx: Ctx, conceptId: string): Promise<void> {
  const [row] = await deps.db.select().from(concepts).where(and(eq(concepts.accountId, ctx.accountId), eq(concepts.id, conceptId)))
  if (!row) throw notFound('Concept')
  if (row.status === 'discarded') throw new AppError('conflict', 'That concept was replaced by a newer set.')
  const c = row.data as Concept
  await updateCharacter(deps, ctx, row.characterId, {
    name: c.name, age: c.age, card: c.card, eyes: c.features?.eyes ?? '', marks: c.marks, body: c.body, pronouns: c.pronouns,
    style: { notes: c.style }, persona: { vibe: c.vibe },
  }, `chose concept ${c.name}`)
  await deps.db.update(concepts).set({ status: 'discarded' }).where(and(eq(concepts.characterId, row.characterId), eq(concepts.status, 'proposed')))
  await deps.db.update(concepts).set({ status: 'chosen' }).where(eq(concepts.id, row.id))
  const ch = await getCharacter(deps, ctx, row.characterId)
  if (ch.stage < 3) await setCharacterFields(deps, ctx, ch.id, { stage: 3 })
  await audit(deps.db, ctx, 'concept.chosen', { type: 'concept', id: row.id })
}
