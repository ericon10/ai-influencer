import { readFile, readdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { and, eq } from 'drizzle-orm'
import { candidates, characters, jobs } from '../db/schema.js'
import type { Ctx, Deps } from '../context.js'
import { AppError } from '../lib/errors.js'
import { registerLocalJob, type JobRow } from '../jobs/hooks.js'
import { ffmpeg, probeFile, withTempDir } from '../media/ffmpeg.js'
import { detectCuts } from '../media/cuts.js'
import { cosineSimilarity } from '../qa/faces.js'
import { classifyText, createOcr, type TextKind } from '../qa/ocr.js'
import type { GenRequest } from '../providers/types.js'
import { readAsset } from '../storage/assets.js'
import { approvedAssets, getCandidate } from './characters.js'
import { createContent, getContent, specSchemas, updateContent, type CloneSource, type ContentKind } from './content.js'
import { addCloneSource, bestCloneStill, buildClone, buildCloneFace, buildCloneStill, cloneModel, cloneStills, keepClone, postClones, saveCloneModel, useCloneStill, type StillGate } from './clone.js'
import { quoteItemsFor, type JobSpec } from '../jobs/runner.js'
import { displayPrice } from '../costs/quotes.js'
import type { RuleViolation } from '../core/rules.js'

// Recreate from a real clip, finished (owner, 2026-10-14; UX-PLAN.md 16):
// the ways in (a link, Library > Clips, the Idea step), "Recreate with
// another character", the review of a take (the face every half second,
// text on the frames, cuts) and "Use this take".

const cloneOf = (post: { kind: string; spec: unknown }): CloneSource | null =>
  post.kind === 'meme' || post.kind === 'batch' ? (specSchemas[post.kind as ContentKind].parse(post.spec) as { clone: CloneSource | null }).clone : null

// ── Ways in ─────────────────────────────────────────────────────────

// A character by id or by name (the Recreate link says "character=Callie").
async function characterFor(deps: Deps, ctx: Ctx, ref: string): Promise<string> {
  const rows = await deps.db.select({ id: characters.id, name: characters.name }).from(characters).where(eq(characters.accountId, ctx.accountId))
  const want = ref.trim().toLowerCase()
  const hit = rows.find(r => r.id === ref) ?? rows.find(r => r.name.trim().toLowerCase() === want)
  if (!hit) throw new AppError('not_found', `No character named "${ref}". Pick one of: ${rows.map(r => r.name).join(', ') || 'none yet'}.`)
  return hit.id
}

// A new video post of the character with the clip as its source, open at
// Recreate: from a link or a Higgsfield media ID, a saved clip (Library >
// Clips, "Use this clip"), or an upload. Free: the clip is prepared on the
// worker; nothing paid starts.
export async function startRecreate(deps: Deps, ctx: Ctx, input: { character: string; link?: string; assetId?: string; uploadId?: string; name?: string; model?: string; cap?: number | null }): Promise<{ id: string }> {
  const characterId = await characterFor(deps, ctx, input.character)
  const from = input.uploadId ? { uploadId: input.uploadId } : input.assetId ? { assetId: input.assetId } : input.link ? { link: input.link } : null
  if (!from) throw new AppError('invalid_request', 'Bring a clip: upload one, pick a saved clip, or paste a link or a Higgsfield media ID.')
  if (input.model) {
    const m = deps.config.models.models.find(x => x.ref === input.model || x.label.toLowerCase() === input.model!.toLowerCase())
    if (!m?.clone || m.clone.mode !== 'motion') throw new AppError('invalid_request', `"${input.model}" is not one of the motion models.`)
    await saveCloneModel(deps, ctx, m.ref)
  }
  const post = await createContent(deps, ctx, { kind: 'meme', characterId, idea: 'Recreate from a real clip', step: 'video', spec: { start: 'clip' } })
  await addCloneSource(deps, ctx, { contentId: post.id, name: input.name, capCredits: input.cap ?? null, ...from })
  return { id: post.id }
}

// "Recreate with another character": the same clip, chips and cap, new
// stills for the other character (free; the stills are priced when made).
export async function recreateFor(deps: Deps, ctx: Ctx, input: { contentId: string; characterId: string }): Promise<{ id: string }> {
  const from = await getContent(deps, ctx, input.contentId)
  const src = cloneOf(from)
  if (!src || src.status !== 'ready') throw new AppError('bad_request', 'The clip is not ready yet.')
  const characterId = await characterFor(deps, ctx, input.characterId)
  if (characterId === from.characterId) throw new AppError('bad_request', 'Pick another character.')
  const clone: CloneSource = { ...src, stills: {}, target: src.target, outfit: { ...src.outfit, lookId: null }, spentCredits: 0 }
  const post = await createContent(deps, ctx, { kind: 'meme', characterId, idea: from.idea, accountTag: from.accountTag, step: 'video', spec: { start: 'clip', clone } })
  return { id: post.id }
}

// "Use this take": keep it (face drift asks first), put it in the post as
// its clip, no music unless one is added, and open the Text step.
export async function useCloneTake(deps: Deps, ctx: Ctx, contentId: string, candidateId: string, acknowledge = false): Promise<{ ok: true }> {
  const post = await getContent(deps, ctx, contentId)
  if (post.kind !== 'meme') throw new AppError('bad_request', 'Use a take in a video post.')
  const cand = await getCandidate(deps, ctx, candidateId)
  if (cand.characterId !== post.characterId) throw new AppError('bad_request', 'That take is of another character. Use "Make a video post" for it instead.')
  await keepClone(deps, ctx, candidateId, acknowledge)
  const spec = post.spec as { sound?: Record<string, unknown> }
  await updateContent(deps, ctx, post.id, { spec: { clipId: cand.id, sound: { ...(spec.sound ?? {}), music: null } }, step: 'text' })
  return { ok: true }
}

// ── A batch of recreates (owner, 2026-10-14) ────────────────────────

// Up to 20 rows, each a clip and a character in its own video post, with
// its own motion model (or the account's last one). Rows move step by step
// together: stills, the face pass, the video. A row whose gates fail waits
// for the owner; the others carry on. Nothing runs without its price.

export type BatchStep = 'stills' | 'face' | 'video'
type Row = { postId: string; model: string | null }

async function batchOf(deps: Deps, ctx: Ctx, batchId: string) {
  const batch = await getContent(deps, ctx, batchId)
  if (batch.kind !== 'batch') throw new AppError('bad_request', 'Recreate rows live in a batch post.')
  const rows: Row[] = ((batch.spec as { recreate?: { rows?: Row[] } | null }).recreate?.rows ?? []).map(r => ({ postId: r.postId, model: r.model ?? null }))
  return { batch, rows }
}

export async function addRecreateRow(deps: Deps, ctx: Ctx, batchId: string, input: { character: string; link?: string; assetId?: string; uploadId?: string; name?: string }): Promise<{ postId: string }> {
  const { batch, rows } = await batchOf(deps, ctx, batchId)
  const max = deps.config.pipeline.content.clone.recreate.batch_max
  if (rows.length >= max) throw new AppError('invalid_request', `A batch takes up to ${max} rows.`)
  const { id } = await startRecreate(deps, ctx, { character: input.character, link: input.link, assetId: input.assetId, uploadId: input.uploadId, name: input.name })
  await updateContent(deps, ctx, batch.id, { spec: { recreate: { rows: [...rows, { postId: id, model: null }] } } })
  return { postId: id }
}

// A row's model, "Set all", or a row taken out (its post stays a draft).
export async function setRecreateRows(deps: Deps, ctx: Ctx, batchId: string, input: { all?: string | null; row?: { postId: string; model: string | null }; remove?: string }): Promise<{ ok: true }> {
  const { batch, rows } = await batchOf(deps, ctx, batchId)
  const motion = (ref: string | null) => {
    if (ref == null) return null
    const m = deps.config.models.models.find(x => x.ref === ref)
    if (!m?.clone || m.clone.mode !== 'motion') throw new AppError('invalid_request', `"${ref}" is not one of the motion models.`)
    return ref
  }
  let next = rows
  if (input.all !== undefined) next = next.map(r => ({ ...r, model: motion(input.all ?? null) }))
  if (input.row) next = next.map(r => (r.postId === input.row!.postId ? { ...r, model: motion(input.row!.model) } : r))
  if (input.remove) next = next.filter(r => r.postId !== input.remove)
  await updateContent(deps, ctx, batch.id, { spec: { recreate: { rows: next } } })
  return { ok: true }
}

interface RowState {
  postId: string; characterId: string; characterName: string; name: string; status: string; error: string | null; frameId: string | null; seconds: number | null
  model: string; modelLabel: string; stills: number; faces: number; still: { id: string; assetId: string | null; gate: StillGate } | null
  take: { id: string; assetId: string | null; status: string } | null
  next: 'preparing' | 'stills' | 'face' | 'video' | 'waiting' | 'done' | 'failed'; why: string | null
}

async function rowState(deps: Deps, ctx: Ctx, row: Row, fallbackModel: string): Promise<RowState | null> {
  const post = await getContent(deps, ctx, row.postId).catch(() => null)
  const src = post ? cloneOf(post) : null
  if (!post || !src || !post.characterId) return null
  const cid = post.characterId
  const [ch] = await deps.db.select({ name: characters.name }).from(characters).where(eq(characters.id, cid))
  const stills = await cloneStills(deps, ctx, post.id)
  const keptId = src.stills[cid]
  const kept = keptId ? stills.find(x => x.id === keptId) : undefined
  // The still a video would start from: the kept one when its gates pass,
  // else the best face pass (or still) that passes.
  const chosen = kept?.gate.ok ? kept : bestCloneStill(stills, cid, 'face') ?? kept ?? bestCloneStill(stills, cid) ?? null
  const takes = await postClones(deps, ctx, post.id)
  const take = takes[0] ?? null
  const model = row.model ?? fallbackModel
  const entry = deps.config.models.models.find(m => m.ref === model)
  const base = {
    postId: post.id, characterId: cid, characterName: ch?.name ?? '', name: src.name, status: src.status, error: src.error, frameId: src.rawFrameId ?? src.firstFrameId, seconds: src.durationSec,
    model, modelLabel: entry?.label ?? model, stills: stills.filter(x => x.pass === 'still' && !x.error).length, faces: stills.filter(x => x.pass === 'face' && !x.error).length,
    still: chosen ? { id: chosen.id, assetId: chosen.assetId, gate: chosen.gate } : null, take: take ? { id: take.id, assetId: take.assetId, status: take.status } : null,
  }
  if (src.status === 'failed') return { ...base, next: 'failed', why: src.error }
  if (src.status !== 'ready') return { ...base, next: 'preparing', why: null }
  if (take && take.status !== 'failed') return { ...base, next: 'done', why: null }
  if (!base.stills) return { ...base, next: 'stills', why: null }
  if (!base.faces) return { ...base, next: 'face', why: null }
  if (chosen?.gate.ok) return { ...base, next: 'video', why: null }
  return { ...base, next: 'waiting', why: chosen ? chosen.gate.reasons.join(' ') : 'No still passed the checks yet.' }
}

export async function recreateBatch(deps: Deps, ctx: Ctx, batchId: string) {
  const { rows } = await batchOf(deps, ctx, batchId)
  const fallback = await cloneModel(deps, ctx, 'motion')
  const states = (await Promise.all(rows.map(r => rowState(deps, ctx, r, fallback)))).filter((r): r is RowState => !!r)
  // The price per row for the step each row is at, and the total per step.
  const prices: Record<string, { step: BatchStep; display: string; credits: number | null; micros: number } | null> = {}
  for (const r of states) {
    const step = r.next === 'stills' || r.next === 'face' || r.next === 'video' ? r.next : null
    if (!step) { prices[r.postId] = null; continue }
    try {
      const built = await rowSpecs(deps, ctx, r, step)
      const items = await quoteItemsFor(deps, ctx, built.specs)
      const credits = items.some(i => i.estimate.credits != null) ? items.reduce((s, i) => s + (i.estimate.credits ?? 0), 0) : null
      const micros = items.reduce((s, i) => s + i.estimate.totalMicros, 0)
      prices[r.postId] = { step, display: displayPrice(items.map(i => ({ amountMicros: i.estimate.totalMicros, credits: i.estimate.credits ?? null }))), credits, micros }
    } catch (e) {
      // A row that cannot be priced (no face yet, no still) waits for you,
      // with the reason on the row.
      prices[r.postId] = null
      r.next = 'waiting'
      r.why = e instanceof Error ? e.message : String(e)
    }
  }
  return { rows: states, prices, max: deps.config.pipeline.content.clone.recreate.batch_max, defaultModel: fallback }
}

async function rowSpecs(deps: Deps, ctx: Ctx, r: RowState, step: BatchStep) {
  if (step === 'stills') return buildCloneStill(deps, ctx, { contentId: r.postId, characterId: r.characterId })
  if (step === 'face') {
    if (!r.still) throw new AppError('bad_request', 'No still to fix yet.')
    return buildCloneFace(deps, ctx, { contentId: r.postId, characterId: r.characterId, candidateId: r.still.id })
  }
  if (!r.still?.gate.ok) throw new AppError('gate_failed', r.still ? r.still.gate.reasons.join(' ') : 'No still yet.')
  return buildClone(deps, ctx, { contentId: r.postId, characterIds: [r.characterId], model: r.model, mode: 'motion', looks: {}, keepSound: false, stills: { [r.characterId]: r.still.id } })
}

// One priced run for every row at the step: rows not there yet, or held by
// their gates, are listed and left waiting.
export async function buildRecreateBatch(deps: Deps, ctx: Ctx, input: { contentId: string; step: BatchStep }) {
  const { batch } = await batchOf(deps, ctx, input.contentId)
  const view = await recreateBatch(deps, ctx, batch.id)
  const specs: JobSpec[] = []
  const prompts: Array<{ label: string; text: string; wrapped: string }> = []
  const warnings: RuleViolation[] = []
  const ran: Array<{ postId: string; stillId: string | null; model: string }> = []
  for (const r of view.rows) {
    const label = `Row ${view.rows.indexOf(r) + 1} (${r.characterName}, ${r.name})`
    if (r.next !== input.step) {
      if (r.next === 'waiting' && input.step === 'video') warnings.push({ ruleId: 'recreate-gate', spec: '13.1', title: `${label} waits`, severity: 'warning', message: `${r.why} It waits for you: fix the face again or make new stills.` })
      continue
    }
    try {
      const built = await rowSpecs(deps, ctx, r, input.step)
      specs.push(...built.specs)
      for (const p of built.preview.prompts) if (!prompts.some(x => x.text === p.text)) prompts.push({ ...p, label: `${label}: ${p.label}` })
      warnings.push(...built.preview.warnings)
      ran.push({ postId: r.postId, stillId: r.still?.id ?? null, model: r.model })
    } catch (e) {
      warnings.push({ ruleId: 'recreate-batch', spec: '13.1', title: `${label} skipped`, severity: 'warning', message: (e as Error).message })
    }
  }
  if (!specs.length) throw new AppError('bad_request', input.step === 'video' ? 'No row is ready for its video: each needs a still that passes the checks.' : `No row is at this step (${input.step === 'stills' ? 'make stills' : 'fix the face'}).`)
  const what = input.step === 'stills' ? 'Stills' : input.step === 'face' ? 'Face pass' : 'Videos'
  return {
    purpose: `recreate_batch:${batch.id}`, characterId: batch.characterId, specs, ran,
    preview: { title: `${what} for ${ran.length} of ${view.rows.length} rows`, prompts, warnings, invalidates: [] as string[] },
  }
}

// After a batch step starts: the still each row's face pass or video used
// is kept, so the next step follows on.
export async function afterRecreateBatch(deps: Deps, ctx: Ctx, step: BatchStep, ran: Array<{ postId: string; stillId: string | null }>): Promise<void> {
  if (step === 'stills') return
  for (const r of ran) if (r.stillId) await useCloneStill(deps, ctx, r.postId, r.stillId).catch(() => undefined)
}

// ── The review of a take (free, on the worker) ──────────────────────

export interface CloneReview {
  at: string
  duration: number
  step: number
  faceMin: number
  // The face against REF-00 and the likeness to the clip's person, every
  // `step` seconds (null: no face found).
  samples: Array<{ t: number; face: number | null; likeness: number | null }>
  // Stretches where the face drifts (under faceMin, or no face).
  drift: Array<{ start: number; end: number }>
  // Text found on the frames: logos, @handles, captions, with when.
  text: Array<{ t: number; kind: TextKind; text: string }>
  // Where the picture cuts (trim at the cut).
  cuts: number[]
  notes: string[]
}

const round2 = (n: number) => Math.round(n * 100) / 100

async function framesOf(video: string, dir: string, prefix: string, fps: number, width: number): Promise<string[]> {
  await ffmpeg(['-i', video, '-vf', `fps=${fps},scale=${width}:-2`, join(dir, `${prefix}_%04d.png`)], 180_000)
  return (await readdir(dir)).filter(f => f.startsWith(`${prefix}_`)).sort().map(f => join(dir, f))
}

async function runCloneReview(deps: Deps, ctx: Ctx, job: JobRow): Promise<unknown> {
  const candidateId = job.purpose.split(':')[2]!
  const cand = await getCandidate(deps, ctx, candidateId)
  if (!cand.assetId) return { skipped: true }
  const cfg = deps.config.pipeline.content.clone.recreate
  // The clip it was made from, and whether it ran on the free mock.
  const origin = async (id: string | null): Promise<{ source: string | null; demo: boolean }> => {
    if (!id) return { source: null, demo: false }
    const [row] = await deps.db.select({ request: jobs.request, provider: jobs.provider, purpose: jobs.purpose }).from(jobs).where(eq(jobs.id, id))
    if (!row) return { source: null, demo: false }
    // A trimmed take points at its parent's run.
    if (row.purpose.startsWith('clone_trim:') && cand.parentId) return origin((await getCandidate(deps, ctx, cand.parentId)).jobId)
    return { source: (row.request as GenRequest).sourceVideo?.assetId ?? null, demo: row.provider === 'mock' }
  }
  const { source, demo } = await origin(cand.jobId)
  const ref00 = (await approvedAssets(deps, ctx, cand.characterId)).get('REF-00')
  const review = await withTempDir(async dir => {
    const r = join(dir, 'take.mp4')
    await writeFile(r, (await readAsset(deps, ctx, cand.assetId!)).data)
    const duration = round2((await probeFile(r)).durationSec ?? 0)
    const notes: string[] = []
    // The face every half second, against REF-00, and the likeness to the
    // clip's person at the same moment.
    const takeFrames = await framesOf(r, dir, 'r', 1 / cfg.review_step, 480)
    let sourceFrames: string[] = []
    if (source) {
      const s = join(dir, 'source.mp4')
      await writeFile(s, (await readAsset(deps, ctx, source)).data)
      sourceFrames = await framesOf(s, dir, 's', 1 / cfg.review_step, 480)
    }
    const facesOn = !demo && (await deps.faces.status()).available
    const refFace = facesOn && ref00 ? await deps.faces.analyze((await readAsset(deps, ctx, ref00)).data, `ref:${ref00}`) : null
    if (demo) notes.push('Demo mode: the face is not checked frame by frame on mock takes.')
    else if (!facesOn) notes.push('Face matching is off on the worker, so the face was not checked frame by frame.')
    const samples: CloneReview['samples'] = []
    for (const [i, f] of takeFrames.entries()) {
      const t = round2(i * cfg.review_step)
      if (t > duration + 0.01) break
      if (!refFace) { samples.push({ t, face: null, likeness: null }); continue }
      const mine = await deps.faces.analyze(await readFile(f))
      const theirs = sourceFrames[i] ? await deps.faces.analyze(await readFile(sourceFrames[i]!)) : null
      samples.push({
        t,
        face: mine ? round2(cosineSimilarity(mine.embedding, refFace.embedding)) : null,
        likeness: mine && theirs ? round2(cosineSimilarity(mine.embedding, theirs.embedding)) : null,
      })
    }
    const drift: CloneReview['drift'] = []
    if (refFace) {
      for (const s of samples) {
        const bad = s.face == null || s.face < cfg.gate.face_min
        const last = drift[drift.length - 1]
        if (bad && last && Math.abs(last.end - s.t) < 1e-6) last.end = round2(Math.min(duration, s.t + cfg.review_step))
        else if (bad) drift.push({ start: s.t, end: round2(Math.min(duration, s.t + cfg.review_step)) })
      }
    }
    // Text on the frames: logos, @handles and captions that carried over.
    const text: CloneReview['text'] = []
    const ocr = createOcr()
    const status = await ocr.status()
    if (!status.available) notes.push(`The text check is off: ${status.reason}.`)
    else {
      try {
        const ocrFrames = await framesOf(r, dir, 'o', 1 / cfg.ocr_step, 720)
        const seen = new Set<string>()
        for (const [i, f] of ocrFrames.entries()) {
          for (const line of await ocr.read(await readFile(f))) {
            const hit = classifyText(line)
            if (!hit) continue
            // The same words read again later (or a letter short) count once.
            const key = hit.text.toLowerCase().replace(/[^a-z0-9@]+/g, '')
            if ([...seen].some(k => k.startsWith(key) || key.startsWith(k))) continue
            seen.add(key)
            text.push({ t: round2(i * cfg.ocr_step), ...hit })
          }
        }
      } catch (e) {
        notes.push(`The text check could not run (${(e as Error).message.slice(0, 120)}).`)
      } finally {
        await ocr.close()
      }
    }
    const cuts = await detectCuts(r, cfg.cut_threshold).catch(() => [])
    return { at: deps.clock.now().toISOString(), duration, step: cfg.review_step, faceMin: cfg.gate.face_min, samples, drift, text, cuts, notes } satisfies CloneReview
  })
  const meta = (cand.meta ?? {}) as Record<string, unknown>
  await deps.db.update(candidates).set({ meta: { ...meta, review }, updatedAt: deps.clock.now() }).where(and(eq(candidates.id, cand.id), eq(candidates.accountId, ctx.accountId)))
  return { drift: review.drift.length, text: review.text.length, cuts: review.cuts.length }
}

let registered = false
export function registerRecreate(): void {
  if (registered) return
  registered = true
  registerLocalJob('clone_review', runCloneReview)
}
