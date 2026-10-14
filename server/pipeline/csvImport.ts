import { z } from 'zod'
import type { Ctx, Deps } from '../context.js'
import { AppError } from '../lib/errors.js'
import { csvRows, planRows, type PlannedRow } from '../core/csvImport.js'
import { estimateGen } from '../costs/pricebook.js'
import { listCharacters } from './characters.js'
import { libraryView } from './clips.js'
import { createContent, getContent, startRender } from './content.js'

// Spreadsheet import inside a batch (overnight item 3, UX-PLAN section 11):
// a CSV with one row per post. The preview shows every row's status and the
// total price before anything runs; "Make N posts" creates the video posts,
// and the rows that reuse a clip can be exported at once (free). Rows with
// a still prompt open at their Stills step with the prompt as the idea;
// each still and take there is generated with its own price, as always.

const MAX_BYTES = 200_000

export interface ImportPreview {
  rows: Array<PlannedRow & { priceUsd: number }>
  problems: string[]
  totals: { rows: number; reuse: number; generate: number; problem: number; usd: number }
  priceNote: string
}

async function plan(deps: Deps, ctx: Ctx, batchId: string, csv: string) {
  if (csv.length > MAX_BYTES) throw new AppError('bad_request', 'That file is too big for one import (200 KB). Split it.')
  const batch = await getContent(deps, ctx, batchId)
  if (batch.kind !== 'batch') throw new AppError('bad_request', 'Import a spreadsheet from a batch.')
  const parsed = csvRows(csv)
  const [chars, lib] = await Promise.all([listCharacters(deps, ctx), libraryView(deps, ctx)])
  const rows = planRows(parsed.rows, {
    characters: chars.map(c => ({ id: c.id, name: c.name })),
    clips: lib.clips.filter(c => c.status === 'approved').map(c => ({ id: c.id, characterId: c.characterId, title: c.title })),
    styles: deps.config.pipeline.edits.styles.map(s => ({ id: s.id, label: s.label })),
    defaultCharacterId: batch.characterId,
    max: deps.config.pipeline.content.batch.max,
  })
  return { batch, rows, problems: parsed.problems, extra: Math.max(0, parsed.rows.length - rows.length) }
}

// A still and a 5 s take with the Studio's default models (the owner may
// pick others in the post; each run shows its own price first).
function generatePrice(deps: Deps): { usd: number; note: string } {
  const sc = deps.config.pipeline.scenes
  const stillModel = sc.settings.still_models[0]!
  const video = sc.video
  const vm = video.models.find(m => m.ref === video.model)
  try {
    const still = estimateGen(deps.config, { kind: 'image', model: stillModel, prompt: '', aspect: '9:16', resolution: '2k' })
    const take = estimateGen(deps.config, { kind: 'video', model: video.model, prompt: '', durationSec: video.duration, aspect: video.aspect, resolution: vm?.resolution })
    return { usd: (still.totalMicros + take.totalMicros) / 1e6, note: `A new still (${stillModel.split('/')[1]}) and a ${video.duration} s take (${video.model.split('/')[1]}) per row, before any reruns.` }
  } catch {
    return { usd: 0, note: 'The price book has no price for the default models yet; each post shows its price before it runs.' }
  }
}

export async function previewImport(deps: Deps, ctx: Ctx, batchId: string, csv: string): Promise<ImportPreview> {
  const { rows, problems, extra } = await plan(deps, ctx, batchId, csv)
  const price = generatePrice(deps)
  const priced = rows.map(r => ({ ...r, priceUsd: r.status === 'generate' ? Math.round(price.usd * 100) / 100 : 0 }))
  const count = (s: PlannedRow['status']) => rows.filter(r => r.status === s).length
  return {
    rows: priced,
    problems: [...problems, ...(extra ? [`Only the first ${rows.length} rows are used (a batch is at most ${rows.length}).`] : [])],
    totals: { rows: rows.length, reuse: count('reuse'), generate: count('generate'), problem: count('problem'), usd: Math.round(priced.reduce((a, r) => a + r.priceUsd, 0) * 100) / 100 },
    priceNote: price.note,
  }
}

const runBody = z.object({ csv: z.string().max(MAX_BYTES), exportFree: z.boolean().default(true) })

// Creates one video post per good row; rows with a problem are skipped (the
// preview named them). The free rows export at once when asked.
export async function runImport(deps: Deps, ctx: Ctx, batchId: string, raw: unknown): Promise<{ created: Array<{ line: number; id: string; status: 'reuse' | 'generate' }>; exporting: number; skipped: number; notExported: Array<{ line: number; id: string; reason: string }> }> {
  const body = runBody.parse(raw)
  const { batch, rows } = await plan(deps, ctx, batchId, body.csv)
  const good = rows.filter(r => r.status !== 'problem')
  if (!good.length) throw new AppError('bad_request', 'No row is ready to import. Fix the rows the preview names, then import again.')
  const created: Array<{ line: number; id: string; status: 'reuse' | 'generate' }> = []
  let exporting = 0
  const notExported: Array<{ line: number; id: string; reason: string }> = []
  for (const r of good) {
    const idea = r.stillPrompt ? [r.stillPrompt, r.videoPrompt ? `In the video: ${r.videoPrompt}` : ''].filter(Boolean).join('\n') : r.caption
    const row = await createContent(deps, ctx, {
      kind: 'meme', characterId: r.characterId!, title: r.caption.slice(0, 60), idea, accountTag: r.accountTag || batch.accountTag,
      step: r.status === 'reuse' ? 'finish' : 'stills',
      spec: { caption: r.caption, ...(r.clipId ? { clipId: r.clipId } : {}), ...(r.style ? { edit: { style: r.style } } : {}) },
    })
    created.push({ line: r.line, id: row.id, status: r.status as 'reuse' | 'generate' })
    if (body.exportFree && r.status === 'reuse') {
      // A post that still needs something (shot B for a two-shot Format)
      // says what, and waits for the owner.
      await startRender(deps, ctx, row.id).then(() => { exporting++ }).catch((e: Error) => { notExported.push({ line: r.line, id: row.id, reason: e.message }) })
    }
  }
  return { created, exporting, skipped: rows.length - good.length, notExported }
}
