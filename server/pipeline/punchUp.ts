import type { Ctx, Deps } from '../context.js'
import { AppError } from '../lib/errors.js'
import type { JobSpec } from '../jobs/runner.js'
import { fill, hardWrap } from '../core/text.js'
import { mockPunchUp, thinParts } from '../core/punchUp.js'
import { slideList } from '../core/slides.js'
import type { SlideshowSpec } from '../core/slideshowSpec.js'
import { getContent } from './content.js'
import { resolveRoute } from './settings.js'

// "Punch up" (owner, 2026-10-22; UX-PLAN.md section 35, item 14): one priced
// Claude call rewrites the thin image lines of a post (its slides' shots)
// or of a plan's ticked rows (the import preview sends them). The answer
// waits on the job as before and after; nothing changes until the owner's
// OK (the post's Use these, or the preview's lines into the import).

export interface PunchLine { id: string; text: string }
const MAX = 60

export async function buildPunchUp(deps: Deps, ctx: Ctx, input: { contentId?: string; lines?: PunchLine[] }) {
  let lines: PunchLine[] = input.lines ?? []
  let characterId: string | null = null
  if (input.contentId) {
    const row = await getContent(deps, ctx, input.contentId)
    characterId = row.characterId ?? null
    if (row.kind !== 'slideshow') throw new AppError('bad_request', 'Punch up rewrites a slideshow\'s image lines.')
    const spec = row.spec as SlideshowSpec
    lines = slideList(spec).filter(s => !s.special).map(s => ({ id: String(s.index), text: s.shot }))
  }
  const thin = lines.filter(l => l.text.trim() && thinParts(l.text).length).slice(0, MAX)
  if (!thin.length) throw new AppError('bad_request', 'No thin image lines: each already names a camera, objects, a background and real light.')
  const t = deps.config.pipeline.templates.punch_up_lines
  const route = await resolveRoute(deps, ctx, 'punch_up')
  const prompt = fill(t.prompt, { lines: thin.map(l => `${l.id}: ${l.text.trim()}`).join('\n') })
  const schema = { type: 'object', additionalProperties: false, required: ['lines'], properties: { lines: { type: 'array', items: { type: 'object', additionalProperties: false, required: ['id', 'text'], properties: { id: { type: 'string' }, text: { type: 'string' } } } } } }
  const spec: JobSpec = {
    type: 'llm', stage: 'content', purpose: `punch_up:${input.contentId ?? 'plan'}`, label: `Punch up: ${thin.length} thin image line${thin.length === 1 ? '' : 's'}`,
    request: {
      model: route.model, system: t.system, prompt, schema, schemaName: 'punch_up_lines', maxTokens: 300 + 160 * thin.length, effort: route.effort ?? 'low',
      meta: { before: thin, ...(input.contentId ? { contentId: input.contentId } : {}), mockLines: { lines: thin.map(l => ({ id: l.id, text: mockPunchUp(l.text) })) } },
    },
  }
  return {
    purpose: spec.purpose, characterId,
    preview: { title: 'Punch up', prompts: [{ label: `${thin.length} thin line${thin.length === 1 ? '' : 's'} to rewrite`, text: `${t.system}\n${prompt}`, wrapped: hardWrap(`${t.system}\n${prompt}`) }], warnings: [], invalidates: [] },
    specs: [spec],
  }
}
