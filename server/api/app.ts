import { Hono, type Context } from 'hono'
import { importFacelessPlan, previewFacelessPlan } from '../pipeline/facelessImport.js'
import { createFacelessCharacter, saveFaceless } from '../pipeline/faceless.js'
import { z } from 'zod'
import { and, desc, eq, gt, inArray, or } from 'drizzle-orm'
import type { Ctx, Deps, Principal } from '../context.js'
import { hasRole } from '../context.js'
import { AppError } from '../lib/errors.js'
import { ProviderError } from '../providers/types.js'
import { newId } from '../lib/ids.js'
import type { AuthProvider } from '../auth/provider.js'
import { jobEvents, jobs } from '../db/schema.js'
import { readAsset, saveAsset, getAsset, thumbnail } from '../storage/assets.js'
import { verifyAssetSignature } from '../jobs/assetUrls.js'
import { cancelJob, getJob, resolveJob, resumeCapWaits, wakeFromWebhook } from '../jobs/runner.js'
import { wakeWorker } from '../jobs/wake.js'
import { actionSchema, estimateAction, runAction } from '../pipeline/actions.js'
import { createCharacter, getCandidate, getCharacter, linkInspiration, listCharacters, setCharacterFields, toData, updateCharacter } from '../pipeline/characters.js'
import { cleanVoiceCard } from '../core/voiceCard.js'
import type { CharacterData } from '../core/character.js'
import { approveSceneCandidate, archiveScene, copyScene, createScene, cropCandidate, saveVideoModel, updateScene } from '../pipeline/scenes.js'
import { whatWasSent, whatWasSentForJob } from '../pipeline/sent.js'
import { videoPrices } from '../pipeline/sceneActions.js'
import { expectedVersion, readWorkerStatus } from '../jobs/workerStatus.js'
import { addClip, addStills, libraryItem, libraryView } from '../pipeline/clips.js'
import { addToCollection, deleteLibraryCollection, listCollections, removeFromCollection, renameLibraryCollection } from '../pipeline/collections.js'
import { hasFilter, parseLibraryQuery, type LibraryQuery } from '../core/libraryFilter.js'
import { autoCleanPreview, cleanIfDue, setAutoCleanDays, startAutoClean, storageView } from '../pipeline/storage.js'
import { listTrash, parseRefs, restore, trash, trashWarnings, TRASH_DAYS } from '../pipeline/trash.js'
import { cancelContinue, continueShot, keepTwoShots, useChainTake } from '../pipeline/chain.js'
import { postCutView, postEditorProject } from '../pipeline/cutView.js'
import { makeCloseup } from '../pipeline/closeup.js'
import { addSound, archiveSound, listSounds, soundView, updateSound } from '../pipeline/sounds.js'
import { addVoiceTakes, getVoiceLine, listVoiceLines, updateVoiceLine, voiceLineView } from '../pipeline/voiceLines.js'
import { addHook, archiveHook, archiveProduct, archiveVariant, importKit, productSummaries, productView, saveSocialAccount, scoreboard, starterKit, updateHook, updateProduct, useKitVoice } from '../pipeline/scaleKit.js'
import { deleteStyle, editorManifest, listStyles, saveFromEditor, saveStyle } from '../pipeline/openreel.js'
import { previewImport, runImport } from '../pipeline/csvImport.js'
import { answerGateCheck, gateCheck } from '../pipeline/gateCheck.js'
import { addCloneSource, cloneOptions, cloneStills, keepClone, pickCloneStill, postClones, postFromClone, saveCloneModel, saveRecreateStillModel, setCloneChoices, setCloneCleanup, setCloneNotLike, setCloneTarget, trimClone, tryCloneAgain, useCloneStill } from '../pipeline/clone.js'
import { editorLibrary } from '../pipeline/editorMedia.js'
import { addRecreateRow, recreateBatch, recreateFor, reviewTakeAgain, setRecreateRows, startRecreate, useCloneTake } from '../pipeline/recreate.js'
import { jobViews } from '../jobs/jobView.js'
import { clearPlan, importPlan, planView, previewPlan } from '../pipeline/planImport.js'
import { applyResultsCsv, previewResultsCsv, resultsView, setPostResults } from '../pipeline/results.js'
import { DECISIONS } from '../core/results.js'
import { dayView, saveSlotTimes, setPosting, slotTimes, startPack } from '../pipeline/postingDay.js'
import { slotList } from '../core/postingDay.js'
import { archiveSlideScene, batchView, familyView, listSlideScenes, reuseReport, reviewBatchItem, saveSlideScene, saveSlideStillPath, slideStillOptions, stillPathFor, vaultHookIdeas } from '../pipeline/slideshow.js'
import { PATTERN_IDS } from '../core/slides.js'
import { POST_STEPS, addBroll, archiveBroll, archiveContent, contentItemView, contentPage, contentView, createContent, duplicateContent, postScene, retryFailedBatch, startCover, startRender, startVariants, updateBroll, updateContent } from '../pipeline/content.js'
import { rulesView, setRuleSwitch } from '../pipeline/rules.js'
import { chooseConcept } from '../pipeline/concepts.js'
import { approveCandidate, keepStale, pickHero, rejectCandidate, reopenCandidate, setFavorite, mirrorCandidate } from '../pipeline/review.js'
import { isValidEndpoint, MODEL_OVERRIDES_KEY, readModelOverrides } from '../providers/modelOverrides.js'
import { attachCheckImages, attachSheetImages, clearRefImage, setRefImage, exportCharacter, importCharacter, type CheckImage } from '../pipeline/files.js'
import { importCheck, updateBrand } from '../pipeline/brand.js'
import { accountUsage } from '../pipeline/costs.js'
import { providerMode, setClaudeModel, setSetting } from '../pipeline/settings.js'
import { listCredentials, markVerified, revokeCredential, saveCredential } from '../providers/credentials.js'
import { readAccountTokens } from '../providers/higgsfieldOAuth.js'
import { disconnect, finishConnect, startConnect } from '../providers/mcpConnections.js'
import { readBilling, saveBilling } from '../providers/billing.js'
import { serverKeyFor } from '../providers/serverKeys.js'
import type { AccountBalance } from '../providers/higgsfieldAccount.js'
import { setBudget } from '../costs/budgets.js'
import { formatUsd } from '../costs/money.js'
import { characterSummary, characterView, scenesView, settingsView } from './views.js'
import { createUploadSlots, receiveUpload, sheetRefOf, takeUploads, MAX_UPLOAD_BYTES, type UploadedFile } from '../storage/uploads.js'
import { corsRules } from '../storage/blobStore.js'
import { startImportCheck } from '../pipeline/importCheck.js'

// The Studio API (/api/v1). Every route except webhooks and signed public
// asset links requires a signed-in principal; every query is scoped to that
// principal's account.

type Env = { Variables: { ctx: Ctx } }

const MAX_UPLOAD = 25 * 1024 * 1024

function parse<T>(schema: z.ZodType<T>, value: unknown): T {
  const r = schema.safeParse(value)
  if (!r.success) throw new AppError('bad_request', r.error.issues.map(i => `${i.path.join('.') || 'body'}: ${i.message}`).join('; '))
  return r.data
}

async function json(c: Context): Promise<unknown> {
  try { return await c.req.json() } catch { throw new AppError('bad_request', 'Expected a JSON body.') }
}

function requireRole(ctx: Ctx, role: Parameters<typeof hasRole>[1]): void {
  if (!hasRole(ctx, role)) throw new AppError('forbidden', 'You do not have permission to do that.')
}

// Files named REF-00 to REF-11 (or "REF 00", "ref_3": names are
// normalized) become approved sheet images. A mirrored copy (a negative QA
// fixture) becomes an image to check instead. Files arrive either in a
// multipart body (small, local) or as direct uploads named by id.
function sheetImagesFrom(files: UploadedFile[]): { images: Record<string, { data: Buffer; mime: string }>; checks: CheckImage[] } {
  const images: Record<string, { data: Buffer; mime: string }> = {}
  const checks: CheckImage[] = []
  for (const f of files) {
    const refId = sheetRefOf(f.name.replace(/\.[a-z0-9]+$/i, ''))
    if (!refId) continue
    if (/MIRROR/i.test(f.name)) checks.push({ refId, name: f.name, data: f.data, mime: f.mime })
    else images[refId] = { data: f.data, mime: f.mime }
  }
  return { images, checks }
}

async function multipartFiles(value: unknown): Promise<UploadedFile[]> {
  const out: UploadedFile[] = []
  for (const f of ([] as unknown[]).concat(value ?? [])) {
    if (!(f instanceof File)) continue
    if (f.size > MAX_UPLOAD) throw new AppError('bad_request', `${f.name} is larger than 25 MB.`)
    out.push({ name: f.name, data: Buffer.from(await f.arrayBuffer()), mime: f.type })
  }
  return out
}

const uploadRefs = z.array(z.object({ uploadId: z.string(), name: z.string().max(300), type: z.string().max(100).optional() })).max(40).default([])

// A character file and its images, from a multipart body or a JSON body
// naming direct uploads.
async function fileBundle(deps: Deps, c: Context, ctx: Ctx): Promise<{ markdown: string | null; files: UploadedFile[]; characterId?: string }> {
  if ((c.req.header('content-type') ?? '').includes('application/json')) {
    const body = parse(z.object({ markdown: z.string().max(500_000).optional(), uploads: uploadRefs, characterId: z.string().regex(/^chr_[a-z0-9]{8,40}$/).optional() }), await json(c))
    return { markdown: body.markdown ?? null, files: await takeUploads(deps, ctx, body.uploads), characterId: body.characterId }
  }
  const body = await c.req.parseBody({ all: true })
  const md = ([] as unknown[]).concat(body.file ?? [])[0]
  return { markdown: md instanceof File ? await md.text() : null, files: await multipartFiles(body.images) }
}

// When each account's queues waiting on the daily cap were last checked
// (once a minute per process at most).
const capChecked = new Map<string, number>()
function capCheckDue(accountId: string, now: number): boolean {
  if (now - (capChecked.get(accountId) ?? 0) < 60_000) return false
  capChecked.set(accountId, now)
  if (capChecked.size > 1000) capChecked.delete(capChecked.keys().next().value!)
  return true
}

// The plan routes' body as the import functions take it.
const planArgs = (b: { csv: string; drawSpecials?: boolean; store?: Record<string, string>; stillModel?: string | null; path?: 'account' | 'api' | null; productId?: string | null; rows?: string[]; existing?: 'replace' | 'add' }) => [b.csv, { drawSpecials: b.drawSpecials, store: b.store, stillModel: b.stillModel, path: b.path, productId: b.productId, rows: b.rows, existing: b.existing }] as const

export function createApp(deps: Deps, auth: AuthProvider): Hono<Env> {
  const app = new Hono<Env>().basePath('/api/v1')

  app.onError((err, c) => {
    const reqId = c.get('ctx')?.requestId
    if (err instanceof AppError) {
      return c.json({ error: { code: err.code, message: err.message, details: err.details ?? null, requestId: reqId } }, err.status as 400)
    }
    // Provider messages are written for the owner (what went wrong and what
    // to do), so they are shown as they are instead of a generic error.
    if (err instanceof ProviderError) {
      deps.log.warn({ err, requestId: reqId }, 'provider error')
      return c.json({ error: { code: err.opts.code === 'reconnect' ? 'reconnect' : 'provider', message: err.message, details: null, requestId: reqId } }, 502)
    }
    deps.log.error({ err, requestId: reqId }, 'unhandled API error')
    return c.json({ error: { code: 'internal', message: 'Something went wrong on our side. It has been logged.', requestId: reqId } }, 500)
  })

  app.notFound(c => c.json({ error: { code: 'not_found', message: 'No such endpoint.' } }, 404))

  // ── Public: health, webhooks, signed asset links ──
  app.get('/health', c => c.json({ ok: true, version: expectedVersion() }))

  app.post('/webhooks/:provider/:jobId', async c => {
    const ok = await wakeFromWebhook(deps, c.req.param('provider'), c.req.param('jobId'), c.req.query('t') ?? '')
    return ok ? c.json({ ok: true }) : c.json({ error: { code: 'not_found', message: 'Unknown webhook.' } }, 404)
  })

  app.get('/public/assets/:id', async c => {
    const id = c.req.param('id')
    if (!verifyAssetSignature(deps.env.STUDIO_SESSION_SECRET, id, Number(c.req.query('exp')), c.req.query('sig') ?? '', deps.clock.now().getTime())) {
      return c.json({ error: { code: 'forbidden', message: 'Link expired or invalid.' } }, 403)
    }
    const { assets } = await import('../db/schema.js')
    const [row] = await deps.db.select().from(assets).where(eq(assets.id, id))
    if (!row) return c.json({ error: { code: 'not_found', message: 'Not found.' } }, 404)
    return new Response(new Uint8Array(await deps.store.get(row.storageKey)), { headers: { 'content-type': row.mime, 'cache-control': 'private, max-age=600' } })
  })

  // The redirect back from an account sign-in (shared MCP connection flow).
  // A browser navigation, so no API session: the one-time state binds it to
  // the admin who started it. Always lands on Settings with a message.
  app.get('/oauth/:provider/callback', async c => {
    const provider = c.req.param('provider')
    const q = c.req.query()
    const r = await finishConnect(deps, provider, { code: q.code, state: q.state, error: q.error, error_description: q.error_description })
    const params = new URLSearchParams(r.ok ? { connected: provider } : { connection_error: provider, message: r.message })
    return c.redirect(`${r.returnTo ?? ''}/studio/settings?${params}`, 302)
  })

  // ── Session ──
  app.post('/auth/login', async c => {
    const body = parse(z.object({ email: z.string().email(), passphrase: z.string().min(1) }), await json(c))
    const p = await auth.login(c, body)
    return c.json({ ok: true, email: p.email })
  })

  // Everything below needs a principal and, for writes, the CSRF header.
  app.use('*', async (c, next) => {
    const principal: Principal | null = await auth.authenticate(c)
    if (!principal) throw new AppError('unauthorized', 'Please sign in.')
    const requestId = c.req.header('x-request-id') || newId('req')
    c.set('ctx', { ...principal, requestId, log: deps.log.child({ requestId, accountId: principal.accountId }) })
    if (c.req.method !== 'GET' && c.req.method !== 'HEAD' && c.req.header('x-studio-request') !== '1') {
      throw new AppError('forbidden', 'Missing request header.')
    }
    const started = Date.now()
    await next()
    c.get('ctx').log.info({ method: c.req.method, path: c.req.path, status: c.res.status, ms: Date.now() - started }, 'request')
  })

  app.post('/auth/logout', async c => { await auth.logout(c); return c.json({ ok: true }) })

  app.get('/me', async c => {
    const ctx = c.get('ctx')
    return c.json({ email: ctx.email, role: ctx.role, accountId: ctx.accountId, mode: await providerMode(deps.db, ctx.accountId), auth: auth.name })
  })

  // ── Characters ──
  app.get('/characters', async c => {
    const ctx = c.get('ctx')
    const rows = await listCharacters(deps, ctx)
    return c.json({ characters: await Promise.all(rows.map(r => characterSummary(deps, ctx, r))) })
  })

  app.post('/characters', async c => {
    const ctx = c.get('ctx')
    requireRole(ctx, 'member')
    // Person or Faceless, asked first (section 35, item 4a); a faceless one
    // can start from Doug's file.
    const body = parse(z.object({ name: z.string().max(80).default(''), kind: z.enum(['person', 'faceless']).default('person'), template: z.enum(['doug']).nullable().optional() }), await json(c))
    const row = body.kind === 'faceless'
      ? await createFacelessCharacter(deps, ctx, { name: body.name, template: body.template ?? null })
      : await createCharacter(deps, ctx, { name: body.name || 'New character' })
    return c.json({ id: row.id }, 201)
  })
  app.put('/characters/:id/faceless', async c => {
    const ctx = c.get('ctx')
    requireRole(ctx, 'member')
    const body = parse(z.object({ file: z.record(z.string(), z.unknown()) }), await json(c))
    await saveFaceless(deps, ctx, c.req.param('id'), body.file)
    return c.json(await characterView(deps, ctx, c.req.param('id')))
  })

  app.get('/characters/:id', async c => c.json(await characterView(deps, c.get('ctx'), c.req.param('id'))))

  const markInput = z.object({
    name: z.string().min(1).max(40), description: z.string().min(1).max(120), side: z.enum(['LEFT', 'RIGHT']),
    region: z.enum(['brow', 'eye', 'cheek', 'ear', 'lip', 'jaw', 'neck', 'nose', 'temple', 'forehead', 'chin']), kind: z.enum(['skin', 'jewelry']), subtle: z.boolean().default(true),
  })
  const patchSchema = z.object({
    name: z.string().min(1).max(80).optional(), age: z.number().int().min(0).max(120).nullable().optional(),
    card: z.string().max(600).optional(), eyes: z.string().max(80).optional(), body: z.string().max(400).optional(),
    marks: z.array(markInput).max(4).optional(), notes: z.string().max(4000).optional(), disclosure: z.string().max(200).optional(),
    pronouns: z.object({ subj: z.string(), obj: z.string(), poss: z.string(), noun: z.string() }).optional(),
    // The voice card (Profile, Voice): kept in the persona, cleaned.
    voice: z.record(z.string(), z.unknown()).optional(),
  })

  app.patch('/characters/:id', async c => {
    const ctx = c.get('ctx')
    requireRole(ctx, 'member')
    const body = parse(z.object({ patch: patchSchema, reason: z.string().max(200).default('edited') }), await json(c))
    const { voice, ...rest } = body.patch
    const patch: Partial<CharacterData> = rest
    if (voice) patch.persona = { ...toData(await getCharacter(deps, ctx, c.req.param('id'))).persona, voice: cleanVoiceCard(voice) }
    await updateCharacter(deps, ctx, c.req.param('id'), patch, body.reason)
    return c.json(await characterView(deps, ctx, c.req.param('id')))
  })

  app.delete('/characters/:id', async c => {
    const ctx = c.get('ctx')
    requireRole(ctx, 'admin')
    await getCharacter(deps, ctx, c.req.param('id'))
    // To the Trash, restorable for 7 days (owner, 2026-10-22), half-built
    // characters too.
    const moved = await trash(deps, ctx, [{ kind: 'character', id: c.req.param('id') }])
    return c.json({ ok: true, trashIds: moved.ids })
  })

  async function uploadedFile(c: Context, field: string): Promise<{ data: Buffer; mime: string; name: string }> {
    const body = await c.req.parseBody()
    const f = body[field]
    if (!(f instanceof File)) throw new AppError('bad_request', `Attach a file in "${field}".`)
    if (f.size > MAX_UPLOAD) throw new AppError('bad_request', 'That file is larger than 25 MB.')
    return { data: Buffer.from(await f.arrayBuffer()), mime: f.type, name: f.name }
  }

  // ── Direct uploads (browser to R2) ──
  const corsChecked = new Set<string>()
  const studioOrigins = (extra?: string) => [...new Set([deps.env.STUDIO_PUBLIC_URL, extra, 'http://localhost:5173', 'http://127.0.0.1:5173'].filter((o): o is string => !!o && /^https?:\/\/[^/]+$/.test(o.replace(/\/$/, ''))).map(o => o.replace(/\/$/, '')))]
  app.post('/uploads', async c => {
    const ctx = c.get('ctx')
    requireRole(ctx, 'member')
    const body = parse(z.object({ files: z.array(z.object({ name: z.string().max(300), type: z.string().max(100), size: z.number().int().min(1).max(1024 * 1024 * 1024) })).min(1).max(40) }), await json(c))
    const result = await createUploadSlots(deps, ctx, body.files)
    // Direct uploads need the bucket's CORS rules; set them once if the key may.
    const origin = c.req.header('origin') ?? ''
    if (result.direct && deps.store.ensureCors && !corsChecked.has(origin)) {
      corsChecked.add(origin)
      const r = await deps.store.ensureCors(studioOrigins(origin))
      if (!r.ok) ctx.log.warn({ message: r.message }, 'storage CORS not set')
    }
    return c.json(result)
  })

  app.put('/uploads/:id', async c => {
    const ctx = c.get('ctx')
    requireRole(ctx, 'member')
    const data = Buffer.from(await c.req.arrayBuffer())
    await receiveUpload(deps, ctx, c.req.param('id'), data, (c.req.header('content-type') ?? '').split(';')[0]!.trim())
    return c.json({ ok: true })
  })

  app.get('/settings/storage', async c => {
    const origins = studioOrigins(c.req.header('origin'))
    const worker = await readWorkerStatus(deps)
    return c.json({
      driver: deps.store.driver, bucket: deps.store.driver === 's3' ? deps.env.S3_BUCKET : null, origins, corsRules: corsRules(origins),
      ...(await storageView(deps, c.get('ctx'))),
      worker: { freeDiskMb: worker.freeDiskMb, checkedAt: worker.diskCheckedAt },
    })
  })
  // Auto-clean: takes never kept go to the Trash N days after the post is
  // finished (3, 7, 14 or 30), or Off (owner, 2026-10-15).
  app.put('/settings/storage/auto-clean', async c => {
    const ctx = c.get('ctx')
    requireRole(ctx, 'member')
    const body = parse(z.object({ days: z.number().int().nullable() }), await json(c))
    await setAutoCleanDays(deps, ctx, body.days)
    return c.json(await storageView(deps, ctx))
  })
  // The next Auto-clean, listed without moving anything; Start Auto-clean
  // lets it run (it never runs before the owner has seen its list).
  app.get('/settings/storage/auto-clean/preview', async c => c.json(await autoCleanPreview(deps, c.get('ctx'))))
  app.post('/settings/storage/auto-clean/start', async c => {
    const ctx = c.get('ctx')
    requireRole(ctx, 'member')
    await startAutoClean(deps, ctx)
    return c.json(await storageView(deps, ctx))
  })
  // Measure now: the daily clean right away (free, on the worker).
  app.post('/settings/storage/measure', async c => {
    const ctx = c.get('ctx')
    requireRole(ctx, 'member')
    return c.json({ queued: await cleanIfDue(deps, ctx, { now: true }) })
  })

  app.post('/settings/storage/check', async c => {
    const ctx = c.get('ctx')
    requireRole(ctx, 'admin')
    if (!deps.store.ensureCors) return c.json({ ok: true, message: 'Local storage: uploads go through the Studio, no CORS needed.' })
    return c.json(await deps.store.ensureCors(studioOrigins(c.req.header('origin'))))
  })

  app.post('/characters/:id/inspirations', async c => {
    const ctx = c.get('ctx')
    requireRole(ctx, 'member')
    const file = (c.req.header('content-type') ?? '').includes('application/json')
      ? (await takeUploads(deps, ctx, parse(uploadRefs.unwrap().length(1), (await json(c) as { uploads?: unknown }).uploads)))[0]!
      : await uploadedFile(c, 'file')
    if (!file.mime.startsWith('image/')) throw new AppError('bad_request', 'Inspiration must be an image.')
    const asset = await saveAsset(deps, ctx, { data: file.data, mime: file.mime, origin: 'upload', label: `inspiration: ${file.name}` })
    await linkInspiration(deps, ctx, c.req.param('id'), asset.id)
    return c.json({ assetId: asset.id }, 201)
  })

  app.post('/concepts/:id/choose', async c => {
    const ctx = c.get('ctx')
    requireRole(ctx, 'member')
    await chooseConcept(deps, ctx, c.req.param('id'))
    return c.json({ ok: true })
  })

  // ── Rules: fixed and default (Settings, Rules; owner ruling G1) ──
  app.get('/settings/rules', async c => c.json(await rulesView(deps, c.get('ctx'), c.req.query('characterId') || null)))
  app.put('/settings/rules', async c => {
    const ctx = c.get('ctx')
    requireRole(ctx, 'admin')
    const body = parse(z.object({
      ruleId: z.string().max(80), characterId: z.string().max(60).nullable().optional(),
      on: z.boolean().nullable().optional(), value: z.string().max(400).nullable().optional(),
    }), await json(c))
    await setRuleSwitch(deps, ctx, body)
    return c.json(await rulesView(deps, ctx, body.characterId ?? null))
  })

  // ── Scenes (Stage 7) and still edits (Stage 8) ──
  app.get('/characters/:id/scenes', async c => c.json(await scenesView(deps, c.get('ctx'), c.req.param('id'))))
  const sceneBody = z.object({
    brief: z.string().max(2000).optional(),
    title: z.string().max(80).optional(),
    // null takes the owner's value away, so the words or the default count again.
    fields: z.record(z.string(), z.union([z.string().max(400), z.boolean(), z.array(z.string().max(20)).max(8), z.null()])).optional(),
    prompts: z.object({ still: z.string().max(4000).optional(), video: z.string().max(4000).optional() }).optional(),
    // The director's notes the owner edited.
    notes: z.object({ still: z.string().max(600).optional(), video: z.string().max(600).optional() }).optional(),
    // "Use the template": the prompt box text came from the template.
    fromTemplate: z.boolean().optional(),
  })
  app.post('/characters/:id/scenes', async c => {
    const ctx = c.get('ctx')
    requireRole(ctx, 'member')
    const body = parse(sceneBody, await json(c))
    const row = await createScene(deps, ctx, c.req.param('id'), body as Parameters<typeof createScene>[3])
    return c.json({ id: row.id }, 201)
  })
  // Use this scene for other characters: one new draft per character.
  app.post('/scenes/:id/copy', async c => {
    const ctx = c.get('ctx')
    requireRole(ctx, 'member')
    const body = parse(z.object({ characterIds: z.array(z.string()).min(1).max(20) }), await json(c))
    return c.json({ copies: await copyScene(deps, ctx, c.req.param('id'), body.characterIds) }, 201)
  })
  // The price of one take on each video model (free estimates), and the
  // model the owner picked last (the next take's default).
  app.get('/characters/:id/video-prices', async c => {
    const ctx = c.get('ctx')
    await getCharacter(deps, ctx, c.req.param('id'))
    const q = parse(z.object({ duration: z.coerce.number().int().min(2).max(15).default(5), aspect: z.string().max(8).default('9:16') }), { duration: c.req.query('duration'), aspect: c.req.query('aspect') })
    return c.json({ prices: await videoPrices(deps, ctx, { durationSec: q.duration, aspect: q.aspect }) })
  })
  app.put('/settings/video-model', async c => {
    const ctx = c.get('ctx')
    requireRole(ctx, 'member')
    const body = parse(z.object({ model: z.string().max(80) }), await json(c))
    await saveVideoModel(deps, ctx, body.model)
    return c.json({ model: body.model })
  })
  app.patch('/scenes/:id', async c => {
    const ctx = c.get('ctx')
    requireRole(ctx, 'member')
    const body = parse(sceneBody, await json(c))
    const row = await updateScene(deps, ctx, c.req.param('id'), body as Parameters<typeof updateScene>[3])
    return c.json({ id: row.id })
  })
  app.delete('/scenes/:id', async c => {
    const ctx = c.get('ctx')
    requireRole(ctx, 'member')
    await archiveScene(deps, ctx, c.req.param('id'))
    return c.json({ ok: true })
  })
  // A closer shot is a crop of the wide still, never a new generation. Free.
  app.post('/candidates/:id/crop', async c => {
    const ctx = c.get('ctx')
    requireRole(ctx, 'member')
    const body = parse(z.object({ x: z.number().min(0).max(1), y: z.number().min(0).max(1), w: z.number().gt(0).max(1), h: z.number().gt(0).max(1) }), await json(c))
    return c.json(await cropCandidate(deps, ctx, c.req.param('id'), body))
  })

  // ── Review gates ──
  app.post('/candidates/:id/approve', async c => {
    const ctx = c.get('ctx')
    requireRole(ctx, 'member')
    const cand = await getCandidate(deps, ctx, c.req.param('id'))
    const body = parse(z.object({ acknowledge: z.boolean().optional() }), await json(c).catch(() => ({})))
    if (cand.sceneId) return c.json({ ...(await approveSceneCandidate(deps, ctx, cand.id, { acknowledge: body.acknowledge })), invalidated: [], sheetComplete: false })
    return c.json(await approveCandidate(deps, ctx, cand.id))
  })
  app.post('/candidates/:id/pick-hero', async c => { const ctx = c.get('ctx'); requireRole(ctx, 'member'); return c.json(await pickHero(deps, ctx, c.req.param('id'))) })
  app.post('/candidates/:id/reject', async c => {
    const ctx = c.get('ctx')
    requireRole(ctx, 'member')
    const body = parse(z.object({ reasons: z.array(z.string()).min(1), note: z.string().max(2000).default('') }), await json(c))
    return c.json({ fixes: await rejectCandidate(deps, ctx, c.req.param('id'), body.reasons, body.note) })
  })
  app.post('/candidates/:id/reopen', async c => { const ctx = c.get('ctx'); requireRole(ctx, 'member'); await reopenCandidate(deps, ctx, c.req.param('id')); return c.json({ ok: true }) })
  // Free fix for a shot QA found mirrored: flip it, no provider call.
  app.post('/candidates/:id/mirror', async c => { const ctx = c.get('ctx'); requireRole(ctx, 'member'); return c.json(await mirrorCandidate(deps, ctx, c.req.param('id'))) })
  // "What was sent": the final prompt, the images, the model and the cost.
  app.get('/candidates/:id/sent', async c => c.json(await whatWasSent(deps, c.get('ctx'), c.req.param('id'))))
  app.get('/jobs/:id/sent', async c => c.json(await whatWasSentForJob(deps, c.get('ctx'), c.req.param('id'))))
  app.post('/candidates/:id/favorite', async c => {
    const body = parse(z.object({ favorite: z.boolean() }), await json(c))
    await setFavorite(deps, c.get('ctx'), c.req.param('id'), body.favorite)
    return c.json({ ok: true })
  })
  app.post('/characters/:id/sheet/:refId/keep', async c => {
    const ctx = c.get('ctx')
    requireRole(ctx, 'member')
    await keepStale(deps, ctx, c.req.param('id'), c.req.param('refId'))
    return c.json({ ok: true })
  })

  // One reference image by hand (owner, 2026-10-22; items 3c, 3d): add or
  // replace any REF (REF-00 is the hero; any upload can be), or remove one,
  // without a rebuild.
  app.post('/characters/:id/refs/:refId', async c => {
    const ctx = c.get('ctx')
    requireRole(ctx, 'member')
    const files = await takeUploads(deps, ctx, parse(z.object({ uploads: uploadRefs }), await json(c)).uploads)
    const f = files[0]
    if (!f || !f.mime.startsWith('image/')) throw new AppError('bad_request', 'Attach one image.')
    const r = await setRefImage(deps, ctx, c.req.param('id'), c.req.param('refId'), { data: f.data, mime: f.mime })
    const checkJobId = r.unchanged || r.refId === 'REF-00' ? null : await startImportCheck(deps, ctx, c.req.param('id'), [r.refId])
    return c.json({ ...r, checkJobId, view: await characterView(deps, ctx, c.req.param('id')) })
  })
  app.delete('/characters/:id/refs/:refId', async c => {
    const ctx = c.get('ctx')
    requireRole(ctx, 'member')
    await clearRefImage(deps, ctx, c.req.param('id'), c.req.param('refId'))
    return c.json({ view: await characterView(deps, ctx, c.req.param('id')) })
  })

  // ── Character file ──
  app.get('/characters/:id/export', async c => {
    const { filename, markdown } = await exportCharacter(deps, c.get('ctx'), c.req.param('id'))
    return new Response(markdown, { headers: { 'content-type': 'text/markdown; charset=utf-8', 'content-disposition': `attachment; filename="${filename}"` } })
  })

  // Apply edits made in an exported character file back to the character.
  // Edits to the character file, approved sheet images (REF-00 to REF-11),
  // or both, applied to an existing character.
  app.post('/characters/:id/import-file', async c => {
    const ctx = c.get('ctx')
    requireRole(ctx, 'member')
    const id = c.req.param('id')
    const { markdown, files } = await fileBundle(deps, c, ctx)
    const { images, checks } = sheetImagesFrom(files)
    if (!markdown && !Object.keys(images).length && !checks.length) throw new AppError('bad_request', 'Attach the character file (.md) or sheet images named REF-00 to REF-11 (REF 00 works too).')
    let warnings: string[] = []
    let importedShots: string[]
    let checkShots: string[]
    if (markdown) {
      const r = await importCharacter(deps, ctx, markdown, { characterId: id, images, checks })
      warnings = r.result.warnings
      importedShots = r.importedShots
      checkShots = r.checkShots
    } else {
      importedShots = await attachSheetImages(deps, ctx, id, images)
      checkShots = await attachCheckImages(deps, ctx, id, checks)
    }
    // Imported sheet images get a free face match against REF-00 and a skin
    // texture check on the worker; failures show on the Sheet tab.
    const checkJobId = importedShots.length ? await startImportCheck(deps, ctx, id, importedShots) : null
    return c.json({ warnings, importedShots, checkShots, checkJobId, view: await characterView(deps, ctx, id) })
  })

  // A new character from its file, or (with characterId) an update of one
  // that keeps its posts, takes and sheet (long run part 3).
  app.post('/characters/import', async c => {
    const ctx = c.get('ctx')
    requireRole(ctx, 'member')
    const { markdown, files, characterId } = await fileBundle(deps, c, ctx)
    if (!markdown) throw new AppError('bad_request', 'Attach the character file (.md).')
    if (characterId) await getCharacter(deps, ctx, characterId)
    const { images, checks } = sheetImagesFrom(files)
    const result = await importCharacter(deps, ctx, markdown, { images, checks, characterId })
    const checkJobId = result.importedShots.length ? await startImportCheck(deps, ctx, result.characterId, result.importedShots) : null
    return c.json({ characterId: result.characterId, updated: !!characterId, importedShots: result.importedShots, unchangedShots: result.unchangedShots, checkShots: result.checkShots, checkJobId, warnings: result.result.warnings }, characterId ? 200 : 201)
  })

  // The file checked against character template v1.6 before an import
  // (free), and the character of the same name, if any.
  app.post('/characters/import/check', async c => {
    const body = parse(z.object({ markdown: z.string().min(1).max(500_000) }), await json(c))
    return c.json(await importCheck(deps, c.get('ctx'), body.markdown))
  })

  // The brand layer, written back into the file's own sections.
  app.put('/characters/:id/brand', async c => {
    const ctx = c.get('ctx')
    requireRole(ctx, 'member')
    const line = z.string().max(600)
    const list = z.array(z.string().max(300)).max(30)
    const patch = parse(z.object({
      interest: line, subInterest: line, arc: line, statement: line,
      series: list, runningBits: list, cast: list, payoff: line, howTheyFilm: line,
      accounts: z.string().max(3000), winningStack: list, growthLog: z.array(z.string().max(1200)).max(60),
    }).partial(), await json(c))
    return c.json({ brand: await updateBrand(deps, ctx, c.req.param('id'), patch) })
  })

  // ── Paid actions: estimate first, then run with the quote ──
  app.post('/actions/estimate', async c => {
    const ctx = c.get('ctx')
    const body = parse(z.object({ action: actionSchema }), await json(c))
    return c.json(await estimateAction(deps, ctx, body.action))
  })

  app.post('/actions/run', async c => {
    const ctx = c.get('ctx')
    requireRole(ctx, 'member')
    const body = parse(z.object({ action: actionSchema, quoteId: z.string(), confirmed: z.boolean().default(false) }), await json(c))
    const { jobs: rows } = await runAction(deps, ctx, body.action, body.quoteId, body.confirmed)
    return c.json({ jobIds: rows.map(r => r.id) }, 202)
  })

  // ── Jobs ──
  app.get('/jobs', async c => {
    const ctx = c.get('ctx')
    const conds = [eq(jobs.accountId, ctx.accountId)]
    const characterId = c.req.query('characterId')
    if (characterId) conds.push(eq(jobs.characterId, characterId))
    const ACTIVE = ['waiting', 'queued', 'submitting', 'running', 'ingesting', 'needs_attention']
    if (c.req.query('active') === '1') conds.push(inArray(jobs.status, ACTIVE))
    // Live: what is running, and what finished in the last 15 minutes (the
    // live status in each step and in Activity).
    if (c.req.query('live') === '1') conds.push(or(inArray(jobs.status, ACTIVE), gt(jobs.completedAt, new Date(deps.clock.now().getTime() - 15 * 60_000)))!)
    const rows = await deps.db.select().from(jobs).where(and(...conds)).orderBy(desc(jobs.createdAt)).limit(Math.min(200, Number(c.req.query('limit') ?? 50)))
    // Safety net for a lost wake (say, the worker was redeploying): the
    // Studio polls this while jobs run, so an overdue job wakes the worker.
    const overdue = deps.clock.now().getTime() - 20_000
    if (rows.some(r => ['queued', 'submitting', 'running', 'ingesting'].includes(r.status) && r.nextPollAt && r.nextPollAt.getTime() < overdue)) await wakeWorker(deps)
    // A queued group waiting on the daily cap starts once the cap allows it
    // (a new day, UTC): checked at most once a minute while the Studio reads.
    if (rows.some(r => r.status === 'waiting' && (r.error as { capWait?: boolean } | null)?.capWait) && capCheckDue(ctx.accountId, deps.clock.now().getTime())) {
      const started = await resumeCapWaits(deps, ctx.accountId).catch(() => [] as string[])
      if (started.length) for (const r of rows) if (started.includes(r.id)) { r.status = 'queued'; r.error = null }
    }
    const ids = rows.map(r => r.id)
    const created = ids.length ? await deps.db.select().from(jobEvents).where(and(inArray(jobEvents.jobId, ids), eq(jobEvents.type, 'created'))) : []
    const labels = new Map(created.map(e => [e.jobId, (e.data as { label?: string }).label ?? '']))
    return c.json({ jobs: await jobViews(deps, ctx.accountId, rows, labels) })
  })

  app.get('/jobs/:id', async c => {
    const ctx = c.get('ctx')
    const job = await getJob(deps, ctx, c.req.param('id'))
    const events = await deps.db.select().from(jobEvents).where(eq(jobEvents.jobId, job.id)).orderBy(jobEvents.createdAt)
    return c.json({ job: { ...job, request: undefined, webhookTokenHash: undefined }, result: (job.resultMeta as { data?: unknown } | null)?.data ?? null, events: events.map(e => ({ type: e.type, data: e.data, at: e.createdAt.toISOString() })) })
  })

  app.post('/jobs/:id/cancel', async c => { await cancelJob(deps, c.get('ctx'), c.req.param('id')); return c.json({ ok: true }) })
  app.post('/jobs/:id/resolve', async c => {
    const ctx = c.get('ctx')
    requireRole(ctx, 'admin')
    const body = parse(z.union([z.object({ action: z.literal('not_charged') }), z.object({ action: z.literal('attach'), providerJobId: z.string().min(1) })]), await json(c))
    await resolveJob(deps, ctx, c.req.param('id'), body)
    return c.json({ ok: true })
  })

  // ── Assets (auth-checked; thumbnails made once and kept) ──
  // On R2 every file (full size or a thumbnail) is a redirect to a
  // short-lived storage link (owner, 2026-10-15: Vercel moves only JSON;
  // a 2K still over 4.5 MB failed as bytes through the function). The
  // redirect may be kept for 10 minutes: pages that read files with CORS
  // ask for `cors=1` and get their own link (see BlobStore.presignGet).
  // On local disk (development) the Studio serves the bytes itself.
  app.get('/assets/:id/content', async c => {
    const ctx = c.get('ctx')
    const id = c.req.param('id')
    const width = Number(c.req.query('w') ?? 0)
    const download = c.req.query('download') ? (c.req.query('name') || id) : null
    // The editor's fallback (owner, 2026-10-15): a part of the file from the
    // Studio's own address, at most 4 MB, when storage will not answer the
    // browser. Same origin, so no CORS and no redirect.
    if (c.req.query('proxy') && deps.store.driver === 's3') {
      const asset = await getAsset(deps, ctx, id)
      const PART = 4 * 1024 * 1024
      const m = /^bytes=(\d+)-(\d*)$/.exec(c.req.header('range') ?? '')
      const start = m ? Number(m[1]) : 0
      const end = Math.min(m?.[2] ? Number(m[2]) : start + PART - 1, start + PART - 1)
      const part = await deps.store.getRange(asset.storageKey, start, end)
      if (!part.total || start >= part.total) return new Response(null, { status: 416, headers: { 'content-range': `bytes */${part.total}` } })
      const last = start + part.data.length - 1
      return new Response(new Uint8Array(part.data), { status: 206, headers: { 'content-type': asset.mime, 'content-range': `bytes ${start}-${last}/${part.total}`, 'content-length': String(part.data.length), 'cache-control': 'private, max-age=600' } })
    }
    const asset = await getAsset(deps, ctx, id)
    const ext = asset.storageKey.split('.').pop() ?? 'bin'
    const fileName = download ? (download.endsWith(`.${ext}`) ? download : `${download}.${ext}`) : null
    const thumbKey = width && asset.kind === 'image' && !download ? await thumbnail(deps, ctx, asset, width) : null
    if (deps.store.driver === 's3') {
      const url = await deps.store.presignGet(thumbKey ?? asset.storageKey, 3600, { ...(fileName ? { downloadName: fileName } : {}), cors: !!c.req.query('cors') })
      if (url) return new Response(null, { status: 302, headers: { location: url, 'cache-control': 'private, max-age=600' } })
    }
    if (thumbKey) return new Response(new Uint8Array(await deps.store.get(thumbKey)), { headers: { 'content-type': 'image/webp', 'cache-control': 'private, max-age=31536000, immutable' } })
    const { row, data } = await readAsset(deps, ctx, id)
    const headers: Record<string, string> = { 'content-type': row.mime, 'cache-control': 'private, max-age=31536000, immutable', 'accept-ranges': 'bytes', 'content-disposition': fileName ? `attachment; filename="${fileName.replace(/[^\w.-]+/g, '_')}"` : 'inline' }
    // Video players ask for byte ranges (Safari will not play a clip without them).
    const range = /^bytes=(\d*)-(\d*)$/.exec(c.req.header('range') ?? '')
    if (range && data.length) {
      const start = range[1] ? Number(range[1]) : Math.max(0, data.length - Number(range[2]))
      const end = range[1] && range[2] ? Math.min(Number(range[2]), data.length - 1) : data.length - 1
      if (start > end || start >= data.length) return new Response(null, { status: 416, headers: { 'content-range': `bytes */${data.length}` } })
      return new Response(new Uint8Array(data.subarray(start, end + 1)), { status: 206, headers: { ...headers, 'content-range': `bytes ${start}-${end}/${data.length}`, 'content-length': String(end - start + 1) } })
    }
    return new Response(new Uint8Array(data), { headers })
  })

  // The worker light in the header (read from the database; never wakes it).
  app.get('/worker', async c => c.json(await readWorkerStatus(deps)))

  // ── Posts: B-roll, video posts, slideshows, batches; clips; the Library ──
  app.get('/content', async c => {
    const ctx = c.get('ctx')
    // The daily clean, when it is due (queueing it wakes the worker). Never
    // in the way of the list.
    await cleanIfDue(deps, ctx).catch(e => ctx.log.warn({ message: (e as Error).message }, 'daily clean not queued'))
    return c.json(await contentView(deps, ctx))
  })
  // One post, also one older than the newest 200 the list holds.
  // Older posts, a page at a time (Posts home), filtered by account or character.
  app.get('/content/page', async c => {
    const q = parse(z.object({ before: z.string().regex(/^cnt_[a-z0-9]{8,40}$/).optional(), limit: z.coerce.number().int().min(1).max(200).optional(), tag: z.string().max(80).optional(), character: z.string().regex(/^chr_[a-z0-9]{8,40}$/).optional(), product: z.string().regex(/^(prd_[a-z0-9]{8,40}|none)$/).optional() }), c.req.query())
    return c.json(await contentPage(deps, c.get('ctx'), { before: q.before, limit: q.limit, accountTag: q.tag, characterId: q.character, productId: q.product }))
  })
  app.get('/content/:id', async c => c.json(await contentItemView(deps, c.get('ctx'), c.req.param('id'))))
  // Delete and the Trash (owner, 2026-10-15; UX-PLAN.md section 22).
  app.post('/trash/check', async c => c.json({ warnings: await trashWarnings(deps, c.get('ctx'), parseRefs((await json(c) as { items?: unknown }).items)) }))
  app.post('/trash', async c => {
    const ctx = c.get('ctx')
    requireRole(ctx, 'member')
    return c.json(await trash(deps, ctx, parseRefs((await json(c) as { items?: unknown }).items)))
  })
  app.get('/trash', async c => c.json({ items: await listTrash(deps, c.get('ctx')), days: TRASH_DAYS }))
  app.post('/trash/restore', async c => {
    const ctx = c.get('ctx')
    requireRole(ctx, 'member')
    const body = parse(z.object({ ids: z.array(z.string().max(60)).min(1).max(200) }), await json(c))
    return c.json(await restore(deps, ctx, body.ids))
  })
  // The Library page's lists with its filters (UX-PLAN.md section 34); a
  // plain call (a post's pickers) gets the lists as before.
  app.get('/library', async c => {
    let query: LibraryQuery
    try { query = parseLibraryQuery(c.req.query()) } catch (e) { throw new AppError('bad_request', (e as Error).message) }
    return c.json(await libraryView(deps, c.get('ctx'), hasFilter(query) ? { query } : { characterId: query.characterId }))
  })
  // One item for the viewer: name, date, character, model, cost, the posts
  // that use it, its collections.
  app.get('/library/items/:id', async c => c.json(await libraryItem(deps, c.get('ctx'), c.req.param('id'))))
  // Collections: named sets of Library items, per account. Deleting one
  // never deletes its items.
  const collectionId = z.string().regex(/^col_[0-9a-z]{8,40}$/)
  const itemIds = z.array(z.string().regex(/^cand_[0-9a-z]{8,40}$/)).min(1).max(500)
  app.get('/library/collections', async c => c.json({ collections: await listCollections(deps, c.get('ctx')) }))
  app.post('/library/collections', async c => {
    const ctx = c.get('ctx')
    requireRole(ctx, 'member')
    const body = parse(z.object({ id: collectionId.optional(), name: z.string().max(200).optional(), items: itemIds }).refine(b => b.id || b.name?.trim(), 'Pick a collection or type a name.'), await json(c))
    return c.json(await addToCollection(deps, ctx, body))
  })
  app.post('/library/collections/:id/remove', async c => {
    const ctx = c.get('ctx')
    requireRole(ctx, 'member')
    const body = parse(z.object({ items: itemIds }), await json(c))
    return c.json(await removeFromCollection(deps, ctx, parse(collectionId, c.req.param('id')), body.items))
  })
  app.patch('/library/collections/:id', async c => {
    const ctx = c.get('ctx')
    requireRole(ctx, 'member')
    const body = parse(z.object({ name: z.string().max(200) }), await json(c))
    return c.json(await renameLibraryCollection(deps, ctx, parse(collectionId, c.req.param('id')), body.name))
  })
  app.delete('/library/collections/:id', async c => {
    const ctx = c.get('ctx')
    requireRole(ctx, 'member')
    return c.json(await deleteLibraryCollection(deps, ctx, parse(collectionId, c.req.param('id'))))
  })
  // An uploaded video becomes a kept clip of the character (picked in the
  // post it was uploaded from).
  app.post('/characters/:id/clips', async c => {
    const ctx = c.get('ctx')
    requireRole(ctx, 'member')
    const body = parse(z.object({ uploadId: z.string().max(40), name: z.string().max(300), contentId: z.string().max(60).optional(), slot: z.enum(['a', 'b']).optional() }), await json(c))
    return c.json(await addClip(deps, ctx, { characterId: c.req.param('id'), ...body }), 201)
  })
  // Uploaded images become kept stills of the character, exactly as
  // uploaded (picked in the slideshow they were uploaded from).
  app.post('/characters/:id/stills', async c => {
    const ctx = c.get('ctx')
    requireRole(ctx, 'member')
    const body = parse(z.object({ uploads: uploadRefs.unwrap().min(1).max(10), contentId: z.string().max(60).optional() }), await json(c))
    return c.json(await addStills(deps, ctx, { characterId: c.req.param('id'), ...body }), 201)
  })
  // Clone Video (SPEC 13.1 R1): the post's clip to clone, the models with
  // their prices, the results, and what to do with one.
  app.post('/content/:id/clone-source', async c => {
    const ctx = c.get('ctx')
    requireRole(ctx, 'member')
    // An upload, a saved clip (an asset), or a link or Higgsfield media ID.
    const body = parse(z.union([
      z.object({ uploadId: z.string().max(40), name: z.string().max(300) }),
      z.object({ assetId: z.string().max(60), name: z.string().max(300).optional() }),
      z.object({ link: z.string().min(8).max(2000), name: z.string().max(300).optional() }),
    ]), await json(c))
    return c.json(await addCloneSource(deps, ctx, { contentId: c.req.param('id'), ...body }), 201)
  })
  // Recreate from a real clip, finished (UX-PLAN.md 16): a new post from a
  // link, a saved clip or an upload; the same clip for another character;
  // step 2's choices; Use this take.
  app.post('/recreate', async c => {
    const ctx = c.get('ctx')
    requireRole(ctx, 'member')
    const body = parse(z.object({
      character: z.string().min(1).max(120), link: z.string().max(2000).optional(), assetId: z.string().max(60).optional(), uploadId: z.string().max(40).optional(),
      name: z.string().max(300).optional(), model: z.string().max(80).optional(), cap: z.number().positive().max(100000).nullable().optional(),
    }), await json(c))
    return c.json(await startRecreate(deps, ctx, body), 201)
  })
  app.post('/content/:id/recreate-for', async c => {
    const ctx = c.get('ctx')
    requireRole(ctx, 'member')
    const body = parse(z.object({ characterId: z.string().max(120) }), await json(c))
    return c.json(await recreateFor(deps, ctx, { contentId: c.req.param('id'), characterId: body.characterId }), 201)
  })
  app.put('/content/:id/clone-choices', async c => {
    const body = parse(z.object({
      keep: z.array(z.string().max(80)).max(12).optional(), notLike: z.string().max(300).optional(), motion: z.string().max(400).optional(),
      outfit: z.object({ choice: z.enum(['source', 'hers']).optional(), text: z.string().max(160).optional(), lookId: z.string().max(60).nullable().optional() }).optional(),
      capCredits: z.number().positive().max(100000).nullable().optional(),
    }), await json(c))
    return c.json({ clone: await setCloneChoices(deps, c.get('ctx'), c.req.param('id'), body) })
  })
  // A batch of recreates: its rows, a row added, a row's model or Set all.
  app.get('/content/:id/recreate-batch', async c => c.json(await recreateBatch(deps, c.get('ctx'), c.req.param('id'), { facePass: c.req.query('facePass') === '0' ? false : c.req.query('facePass') === '1' ? true : undefined })))
  app.post('/content/:id/recreate-rows', async c => {
    const ctx = c.get('ctx')
    requireRole(ctx, 'member')
    const body = parse(z.object({ character: z.string().min(1).max(120), link: z.string().max(2000).optional(), assetId: z.string().max(60).optional(), uploadId: z.string().max(40).optional(), name: z.string().max(300).optional() }), await json(c))
    return c.json(await addRecreateRow(deps, ctx, c.req.param('id'), body), 201)
  })
  app.put('/content/:id/recreate-rows', async c => {
    const body = parse(z.object({ all: z.string().max(80).nullable().optional(), row: z.object({ postId: z.string().max(60), model: z.string().max(80).nullable() }).optional(), remove: z.string().max(60).optional() }), await json(c))
    return c.json(await setRecreateRows(deps, c.get('ctx'), c.req.param('id'), body))
  })
  app.post('/content/:id/clones/:cid/use', async c => {
    const ctx = c.get('ctx')
    requireRole(ctx, 'member')
    const body = parse(z.object({ acknowledge: z.boolean().default(false) }), await json(c))
    return c.json(await useCloneTake(deps, ctx, c.req.param('id'), c.req.param('cid'), body.acknowledge))
  })
  // A take the owner passes on (recorded for the gate check; nothing spent),
  // and a free review again (fills in the frames of the text found).
  app.post('/content/:id/clones/:cid/try-again', async c => {
    const ctx = c.get('ctx')
    requireRole(ctx, 'member')
    return c.json(await tryCloneAgain(deps, ctx, c.req.param('cid')))
  })
  app.post('/content/:id/clones/:cid/review', async c => {
    const ctx = c.get('ctx')
    requireRole(ctx, 'member')
    return c.json(await reviewTakeAgain(deps, ctx, c.req.param('id'), c.req.param('cid')))
  })
  app.get('/content/:id/clone-options', async c => c.json(await cloneOptions(deps, c.get('ctx'), c.req.param('id'))))
  app.get('/content/:id/clones', async c => c.json({ clones: await postClones(deps, c.get('ctx'), c.req.param('id')) }))
  // Tap the person to replace on the first frame (null: the largest again).
  app.put('/content/:id/clone-target', async c => {
    const body = z.object({ at: z.object({ x: z.number().min(0).max(1), y: z.number().min(0).max(1) }).nullable() }).parse(await c.req.json())
    return c.json({ clone: await setCloneTarget(deps, c.get('ctx'), c.req.param('id'), body.at) })
  })
  // The OpenReel editor (G29): the post to load, and Done (the MP4 and the
  // project back).
  app.get('/content/:id/editor', async c => c.json(await editorManifest(deps, c.get('ctx'), c.req.param('id'))))
  // The editor's Add media, Studio first (owner, 2026-10-15).
  app.get('/content/:id/editor/media', async c => c.json(await editorLibrary(deps, c.get('ctx'), c.req.param('id'))))
  app.post('/content/:id/editor', async c => c.json(await saveFromEditor(deps, c.get('ctx'), c.req.param('id'), await json(c))))
  app.get('/editor/styles', async c => c.json({ styles: await listStyles(deps, c.get('ctx')) }))
  app.post('/editor/styles', async c => {
    const ctx = c.get('ctx')
    requireRole(ctx, 'member')
    return c.json(await saveStyle(deps, ctx, await json(c)), 201)
  })
  app.delete('/editor/styles/:sid', async c => {
    const ctx = c.get('ctx')
    requireRole(ctx, 'member')
    return c.json(await deleteStyle(deps, ctx, c.req.param('sid')))
  })
  app.post('/content/:id/clone-source/cleanup', async c => {
    const body = parse(z.object({ on: z.boolean() }), await json(c))
    return c.json(await setCloneCleanup(deps, c.get('ctx'), c.req.param('id'), body.on))
  })
  app.get('/content/:id/clone-stills', async c => c.json({ stills: await cloneStills(deps, c.get('ctx'), c.req.param('id')) }))
  app.post('/content/:id/clone-stills/pick', async c => {
    const body = parse(z.object({ characterId: z.string().max(60) }), await json(c))
    return c.json(await pickCloneStill(deps, c.get('ctx'), c.req.param('id'), body.characterId))
  })
  app.post('/content/:id/clone-stills/:cid/use', async c => c.json(await useCloneStill(deps, c.get('ctx'), c.req.param('id'), c.req.param('cid'))))
  app.put('/content/:id/clone-not-like', async c => {
    const body = parse(z.object({ text: z.string().max(300) }), await json(c))
    return c.json(await setCloneNotLike(deps, c.get('ctx'), c.req.param('id'), body.text))
  })
  // Trim a clone before export (free, on the worker).
  app.post('/clones/:id/trim', async c => {
    const body = parse(z.object({ start: z.number().min(0).max(60), end: z.number().min(0).max(60) }), await json(c))
    return c.json(await trimClone(deps, c.get('ctx'), c.req.param('id'), body))
  })
  app.post('/clones/:id/keep', async c => {
    const ctx = c.get('ctx')
    requireRole(ctx, 'member')
    const body = parse(z.object({ acknowledge: z.boolean().default(false) }), await json(c))
    return c.json(await keepClone(deps, ctx, c.req.param('id'), body.acknowledge))
  })
  app.post('/content/:id/clones/:cid/post', async c => {
    const ctx = c.get('ctx')
    requireRole(ctx, 'member')
    const body = parse(z.object({ acknowledge: z.boolean().default(false) }), await json(c))
    return c.json(await postFromClone(deps, ctx, c.req.param('id'), c.req.param('cid'), body.acknowledge), 201)
  })
  app.get('/recreate/gate-check', async c => c.json(await gateCheck(deps, c.get('ctx'))))
  app.post('/recreate/gate-check', async c => {
    const ctx = c.get('ctx')
    requireRole(ctx, 'owner')
    const body = parse(z.object({ use: z.boolean(), kind: z.enum(['still', 'video']).default('still') }), await json(c))
    return c.json(await answerGateCheck(deps, ctx, body.use, body.kind))
  })
  app.put('/settings/recreate-still-model', async c => {
    const ctx = c.get('ctx')
    requireRole(ctx, 'member')
    const body = parse(z.object({ model: z.string().max(80) }), await json(c))
    await saveRecreateStillModel(deps, ctx, body.model)
    return c.json({ model: body.model })
  })
  app.put('/settings/clone-model', async c => {
    const ctx = c.get('ctx')
    requireRole(ctx, 'member')
    const body = parse(z.object({ model: z.string().max(80) }), await json(c))
    await saveCloneModel(deps, ctx, body.model)
    return c.json({ model: body.model })
  })
  app.post('/broll', async c => {
    const ctx = c.get('ctx')
    requireRole(ctx, 'member')
    const body = parse(z.object({ uploadId: z.string().max(40), name: z.string().max(300), title: z.string().max(120).optional(), productId: z.string().max(60).nullable().optional() }), await json(c))
    return c.json(await addBroll(deps, ctx, body), 201)
  })
  app.patch('/broll/:id', async c => {
    const ctx = c.get('ctx')
    requireRole(ctx, 'member')
    const body = parse(z.object({ title: z.string().max(120).optional(), productId: z.string().max(60).nullable().optional() }), await json(c))
    return c.json(await updateBroll(deps, ctx, c.req.param('id'), body))
  })
  app.delete('/broll/:id', async c => {
    const ctx = c.get('ctx')
    requireRole(ctx, 'member')
    await archiveBroll(deps, ctx, c.req.param('id'))
    return c.json({ ok: true })
  })
  app.post('/content', async c => {
    const ctx = c.get('ctx')
    requireRole(ctx, 'member')
    const body = parse(z.object({
      kind: z.enum(['meme', 'slideshow', 'batch']), characterId: z.string().max(60), title: z.string().max(120).optional(), spec: z.record(z.string(), z.unknown()).optional(),
      idea: z.string().max(2000).optional(), accountTag: z.string().max(60).optional(), sceneId: z.string().max(60).nullable().optional(), step: z.enum(POST_STEPS).optional(),
      productId: z.string().max(60).nullable().optional(),
    }), await json(c))
    const row = await createContent(deps, ctx, body)
    return c.json({ id: row.id }, 201)
  })
  app.patch('/content/:id', async c => {
    const ctx = c.get('ctx')
    requireRole(ctx, 'member')
    const body = parse(z.object({
      title: z.string().max(120).optional(), spec: z.record(z.string(), z.unknown()).optional(),
      idea: z.string().max(2000).optional(), accountTag: z.string().max(60).optional(), sceneId: z.string().max(60).nullable().optional(), step: z.enum(POST_STEPS).optional(), characterId: z.string().max(60).optional(),
      productId: z.string().max(60).nullable().optional(),
    }), await json(c))
    const row = await updateContent(deps, ctx, c.req.param('id'), body)
    return c.json({ id: row.id })
  })
  // "Make another like this": a filled-in copy that opens at the Text step.
  // Spreadsheet import inside a batch: the preview (free), then the posts.
  app.post('/content/:id/import/preview', async c => {
    const body = parse(z.object({ csv: z.string().max(200_000) }), await json(c))
    return c.json(await previewImport(deps, c.get('ctx'), c.req.param('id'), body.csv))
  })
  app.post('/content/:id/import', async c => {
    const ctx = c.get('ctx')
    requireRole(ctx, 'member')
    return c.json(await runImport(deps, ctx, c.req.param('id'), await json(c)), 201)
  })
  app.post('/content/:id/duplicate', async c => {
    const ctx = c.get('ctx')
    requireRole(ctx, 'member')
    const row = await duplicateContent(deps, ctx, c.req.param('id'))
    return c.json({ id: row.id }, 201)
  })
  // The post's scene, made from its idea the first time (free).
  app.post('/content/:id/scene', async c => {
    const ctx = c.get('ctx')
    requireRole(ctx, 'member')
    const row = await postScene(deps, ctx, c.req.param('id'))
    return c.json({ id: row.id, sceneId: row.sceneId })
  })
  // Hook variants (long run part 4): the timeline once per hook (free).
  app.post('/content/:id/variants', async c => {
    const ctx = c.get('ctx')
    requireRole(ctx, 'member')
    return c.json(await startVariants(deps, ctx, c.req.param('id')), 202)
  })

  // The cover: a frame of the export with its text (free).
  app.post('/content/:id/cover', async c => {
    const ctx = c.get('ctx')
    requireRole(ctx, 'member')
    const body = parse(z.object({ at: z.number().min(0).max(600), text: z.string().max(200).default('') }), await json(c))
    return c.json(await startCover(deps, ctx, c.req.param('id'), body), 202)
  })

  app.delete('/content/:id', async c => {
    const ctx = c.get('ctx')
    requireRole(ctx, 'member')
    await archiveContent(deps, ctx, c.req.param('id'))
    return c.json({ ok: true })
  })
  // Phase 3: the rough cut and sound bed the Finish step shows, and
  // "Continue this shot" (chaining) in the Video step. All free.
  app.get('/content/:id/cut', async c => c.json(await postCutView(deps, c.get('ctx'), c.req.param('id'))))
  // Fine-tune (Phase 4): the cut as editor layers, streamed by URL, and in
  // OpenCut's project layout.
  app.get('/content/:id/editor', async c => c.json(await postEditorProject(deps, c.get('ctx'), c.req.param('id'))))
  app.post('/content/:id/continue', async c => {
    const ctx = c.get('ctx')
    requireRole(ctx, 'member')
    const row = await continueShot(deps, ctx, c.req.param('id'))
    return c.json({ id: row.id }, 202)
  })
  app.post('/content/:id/continue/use', async c => {
    const ctx = c.get('ctx')
    requireRole(ctx, 'member')
    const body = parse(z.object({ takeId: z.string().max(60) }), await json(c))
    const row = await useChainTake(deps, ctx, c.req.param('id'), body.takeId)
    return c.json({ id: row.id }, 202)
  })
  app.post('/content/:id/continue/two-shots', async c => {
    const ctx = c.get('ctx')
    requireRole(ctx, 'member')
    const row = await keepTwoShots(deps, ctx, c.req.param('id'))
    return c.json({ id: row.id })
  })
  app.delete('/content/:id/continue', async c => {
    const ctx = c.get('ctx')
    requireRole(ctx, 'member')
    const row = await cancelContinue(deps, ctx, c.req.param('id'))
    return c.json({ id: row.id })
  })
  // Phase 5: "Make the close-up" for a crash zoom's shot B (free crop).
  app.post('/content/:id/closeup', async c => {
    const ctx = c.get('ctx')
    requireRole(ctx, 'member')
    const row = await makeCloseup(deps, ctx, c.req.param('id'))
    return c.json({ id: row.id }, 202)
  })
  app.get('/sounds', async c => c.json({ sounds: (await listSounds(deps, c.get('ctx'))).map(soundView) }))
  app.post('/sounds', async c => {
    const ctx = c.get('ctx')
    requireRole(ctx, 'member')
    const body = parse(z.object({ uploadId: z.string().max(40), name: z.string().max(300), kind: z.enum(['ambience', 'music']), title: z.string().max(120).optional(), tag: z.string().max(60).optional() }), await json(c))
    return c.json(soundView(await addSound(deps, ctx, body)), 201)
  })
  app.patch('/sounds/:id', async c => {
    const ctx = c.get('ctx')
    requireRole(ctx, 'member')
    const body = parse(z.object({ title: z.string().max(120).optional(), tag: z.string().max(60).optional(), kind: z.enum(['ambience', 'music']).optional() }), await json(c))
    return c.json(soundView(await updateSound(deps, ctx, c.req.param('id'), body)))
  })
  app.delete('/sounds/:id', async c => {
    const ctx = c.get('ctx')
    requireRole(ctx, 'member')
    await archiveSound(deps, ctx, c.req.param('id'))
    return c.json({ ok: true })
  })
  // Voice lines (overnight item 4): the owner's takes, prepared free; the
  // conversion is a priced action (voice_convert).
  app.get('/voice-lines', async c => c.json({ lines: (await listVoiceLines(deps, c.get('ctx'), c.req.query('characterId') || null)).map(voiceLineView) }))
  app.post('/voice-lines', async c => {
    const ctx = c.get('ctx')
    requireRole(ctx, 'member')
    const body = parse(z.object({ characterId: z.string().max(60), takes: z.array(z.object({ uploadId: z.string().max(40), name: z.string().max(300) })).min(1).max(50) }), await json(c))
    return c.json({ lines: (await addVoiceTakes(deps, ctx, body)).map(voiceLineView) }, 201)
  })
  app.patch('/voice-lines/:id', async c => {
    const ctx = c.get('ctx')
    requireRole(ctx, 'member')
    const body = parse(z.object({ title: z.string().max(120).optional(), line: z.string().max(400).optional(), hook: z.number().int().min(0).max(9999).nullable().optional() }), await json(c))
    return c.json(voiceLineView(await updateVoiceLine(deps, ctx, c.req.param('id'), body)))
  })
  app.delete('/voice-lines/:id', async c => {
    const ctx = c.get('ctx')
    requireRole(ctx, 'member')
    await getVoiceLine(deps, ctx, c.req.param('id'))
    await archiveSound(deps, ctx, c.req.param('id'))
    return c.json({ ok: true })
  })
  // The scale kit (overnight item 5): products (hook vault, claims, buyer
  // language), hooks and variants; accounts and the signups scoreboard.
  app.get('/products', async c => c.json({ products: await productSummaries(deps, c.get('ctx')) }))
  app.post('/products/import', async c => {
    const ctx = c.get('ctx')
    requireRole(ctx, 'member')
    const body = parse(z.object({ markdown: z.string().max(200_000).optional(), starter: z.boolean().optional(), name: z.string().max(80).optional() }), await json(c))
    if (!body.starter && !body.markdown?.trim()) throw new AppError('bad_request', 'Pick a script kit file (.md) to import.')
    const r = await importKit(deps, ctx, body.starter ? starterKit() : body.markdown!, body.name || undefined)
    return c.json({ product: { id: r.product.id, name: r.product.name, hooks: r.hooks }, hooks: r.hooks, voicesApplied: r.voicesApplied }, 201)
  })
  app.get('/products/:id', async c => c.json(await productView(deps, c.get('ctx'), c.req.param('id'))))
  const groupBody = z.array(z.object({ label: z.string().max(80), items: z.array(z.string().max(400)).max(80) })).max(30)
  app.patch('/products/:id', async c => {
    const ctx = c.get('ctx')
    requireRole(ctx, 'member')
    const body = parse(z.object({
      name: z.string().max(80).optional(), notes: z.string().max(20_000).optional(),
      claims: z.object({ groups: groupBody.optional(), lines: groupBody.optional(), watch: z.array(z.string().max(60)).max(60).optional(), mentions: z.array(z.string().max(60)).max(60).optional() }).optional(),
      language: z.object({ groups: groupBody }).optional(),
      writing: z.string().max(40).optional(),
    }), await json(c))
    await updateProduct(deps, ctx, c.req.param('id'), body)
    return c.json(await productView(deps, ctx, c.req.param('id')))
  })
  app.delete('/products/:id', async c => {
    const ctx = c.get('ctx')
    requireRole(ctx, 'member')
    await archiveProduct(deps, ctx, c.req.param('id'))
    return c.json({ ok: true })
  })
  app.post('/products/:id/hooks', async c => {
    const ctx = c.get('ctx')
    requireRole(ctx, 'member')
    const body = parse(z.object({ text: z.string().max(600), kind: z.string().max(80).optional() }), await json(c))
    return c.json({ id: (await addHook(deps, ctx, c.req.param('id'), body)).id }, 201)
  })
  app.post('/products/:id/voices/use', async c => {
    const ctx = c.get('ctx')
    requireRole(ctx, 'member')
    const body = parse(z.object({ voice: z.string().max(120), characterId: z.string().max(60) }), await json(c))
    await useKitVoice(deps, ctx, c.req.param('id'), body.voice, body.characterId)
    return c.json({ ok: true })
  })
  app.patch('/hooks/:id', async c => {
    const ctx = c.get('ctx')
    requireRole(ctx, 'member')
    const body = parse(z.object({ text: z.string().max(600).optional(), kind: z.string().max(80).optional() }), await json(c))
    return c.json({ id: (await updateHook(deps, ctx, c.req.param('id'), body)).id })
  })
  app.delete('/hooks/:id', async c => {
    const ctx = c.get('ctx')
    requireRole(ctx, 'member')
    await archiveHook(deps, ctx, c.req.param('id'))
    return c.json({ ok: true })
  })
  app.delete('/hook-variants/:id', async c => {
    const ctx = c.get('ctx')
    requireRole(ctx, 'member')
    await archiveVariant(deps, ctx, c.req.param('id'))
    return c.json({ ok: true })
  })
  app.get('/social-accounts', async c => c.json(await scoreboard(deps, c.get('ctx'))))
  app.put('/social-accounts/:tag', async c => {
    const ctx = c.get('ctx')
    requireRole(ctx, 'member')
    const body = parse(z.object({
      link: z.string().max(400).optional(), code: z.string().max(60).optional(), signups: z.number().int().min(0).max(10_000_000).optional(),
      views: z.number().int().min(0).nullable().optional(), characterId: z.string().max(60).nullable().optional(), productId: z.string().max(60).nullable().optional(), notes: z.string().max(400).optional(),
      primaryCode: z.string().max(4).nullable().optional(), backupCode: z.string().max(4).nullable().optional(),
    }), await json(c))
    return c.json(await saveSocialAccount(deps, ctx, decodeURIComponent(c.req.param('tag')), body))
  })
  // A batch's failed videos render again (free).
  app.post('/content/:id/render/retry-failed', async c => {
    const ctx = c.get('ctx')
    requireRole(ctx, 'member')
    const row = await retryFailedBatch(deps, ctx, c.req.param('id'))
    return c.json({ id: row.id, status: row.status }, 202)
  })
  // ── The slideshow power-up (UX-PLAN.md section 27). Free parts only;
  // the paid ones are actions with a price (POST /actions/estimate).
  app.post('/content/:id/slideshow/vault-hooks', async c => {
    const ctx = c.get('ctx')
    requireRole(ctx, 'member')
    const body = parse(z.object({ offset: z.number().int().min(0).max(10_000).default(0), patterns: z.array(z.enum(PATTERN_IDS)).max(8).optional() }), await json(c))
    const row = await vaultHookIdeas(deps, ctx, c.req.param('id'), body)
    return c.json(await contentItemView(deps, ctx, row.id))
  })
  app.get('/content/:id/slideshow/family', async c => c.json(await familyView(deps, c.get('ctx'), c.req.param('id'))))
  app.get('/content/:id/slideshow/reuse', async c => c.json(await reuseReport(deps, c.get('ctx'), c.req.param('id'))))
  app.get('/content/:id/slideshow/batch', async c => c.json(await batchView(deps, c.get('ctx'), c.req.param('id'))))
  app.post('/content/:id/slideshow/batch/:child', async c => {
    const ctx = c.get('ctx')
    requireRole(ctx, 'member')
    const body = parse(z.object({ decision: z.enum(['approve', 'reject', 'pending']) }), await json(c))
    return c.json(await reviewBatchItem(deps, ctx, c.req.param('id'), c.req.param('child'), body.decision, id => startRender(deps, ctx, id)))
  })
  // Section 30: the two stills paths, and for a character what each makes
  // (the character's slides and the slides with no one, with a still's price).
  app.get('/slideshow/still-models', async c => c.json(await slideStillOptions(deps, c.get('ctx'), c.req.query('characterId') || null)))
  // The launch plan (section 28): the free preview, the drafts (free), and
  // the plan's posts in schedule order.
  const planBody = z.object({ csv: z.string().max(400_000), drawSpecials: z.boolean().optional(), store: z.record(z.string().max(60), z.string().max(60)).optional(), stillModel: z.string().max(80).nullable().optional(), path: z.enum(['account', 'api']).nullable().optional(), productId: z.string().max(60).nullable().optional(), rows: z.array(z.string().max(60)).max(2000).optional(), existing: z.enum(['replace', 'add']).optional() })
  app.post('/plan/preview', async c => c.json(await previewPlan(deps, c.get('ctx'), ...planArgs(parse(planBody, await json(c))))))
  app.post('/plan/import', async c => {
    const ctx = c.get('ctx')
    requireRole(ctx, 'member')
    return c.json(await importPlan(deps, ctx, ...planArgs(parse(planBody, await json(c)))))
  })
  app.get('/plan', async c => c.json(await planView(deps, c.get('ctx'))))
  // A faceless account's plan CSV (section 35, item 4g): free preview, import.
  const facelessBody = z.object({ csv: z.string().max(400_000), characterId: z.string().max(60).nullable().optional(), accountTag: z.string().max(60).nullable().optional(), rows: z.array(z.string().max(60)).max(2000).optional(), existing: z.enum(['replace', 'add']).optional() })
  app.post('/faceless/preview', async c => { const b = parse(facelessBody, await json(c)); return c.json(await previewFacelessPlan(deps, c.get('ctx'), b.csv, b)) })
  app.post('/faceless/import', async c => {
    const ctx = c.get('ctx')
    requireRole(ctx, 'member')
    const b = parse(facelessBody, await json(c))
    return c.json(await importFacelessPlan(deps, ctx, b.csv, { ...b, rows: b.rows ?? [] }))
  })
  // Clear (owner, 2026-10-22): the plan's drafts to the Trash; dryRun counts first.
  app.post('/plan/clear', async c => {
    const ctx = c.get('ctx')
    requireRole(ctx, 'member')
    const body = parse(z.object({ scope: z.enum(['all', 'empty', 'ids']), planId: z.string().max(60).nullable().optional(), ids: z.array(z.string().max(60)).max(500).optional(), dryRun: z.boolean().optional() }), await json(c))
    return c.json(await clearPlan(deps, ctx, body))
  })
  // Results (section 32): typed on a post's card or Finish step, pasted
  // from a CSV by row_id (a free preview, then Apply), and the Results view.
  const count = z.number().int().min(0).max(100_000_000_000).nullable()
  app.put('/content/:id/results', async c => {
    const ctx = c.get('ctx')
    requireRole(ctx, 'member')
    const body = parse(z.object({
      postUrl: z.string().max(500).optional(), postedAt: z.string().max(40).optional(),
      views72h: count.optional(), follows72h: count.optional(), saves72h: count.optional(), shares72h: count.optional(),
      decision: z.enum(DECISIONS).nullable().optional(), notes: z.string().max(2000).optional(),
    }), await json(c))
    return c.json({ results: await setPostResults(deps, ctx, c.req.param('id'), body) })
  })
  app.get('/results', async c => {
    const day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/)
    const q = parse(z.object({ from: day.optional(), to: day.optional(), tag: z.string().max(80).optional(), character: z.string().regex(/^chr_[a-z0-9]{8,40}$/).optional(), product: z.string().regex(/^(prd_[a-z0-9]{8,40}|none)$/).optional() }), c.req.query())
    return c.json(await resultsView(deps, c.get('ctx'), { from: q.from, to: q.to, accountTag: q.tag, characterId: q.character, productId: q.product }))
  })
  // Download day (section 33): a post's Approve for posting and its own day
  // and slot; the slot times; a day's preview (free) and its zip (free, on
  // the worker).
  app.put('/content/:id/posting', async c => {
    const ctx = c.get('ctx')
    requireRole(ctx, 'member')
    const body = parse(z.object({ approved: z.boolean().optional(), date: z.string().max(10).optional(), slot: z.string().max(12).optional() }), await json(c))
    return c.json({ posting: await setPosting(deps, ctx, c.req.param('id'), body) })
  })
  app.get('/posting/slots', async c => c.json({ slots: slotList(await slotTimes(deps, c.get('ctx'))) }))
  app.put('/posting/slots', async c => {
    const ctx = c.get('ctx')
    requireRole(ctx, 'member')
    const body = parse(z.object({ times: z.record(z.string().max(12), z.string().max(5)) }), await json(c))
    return c.json({ slots: await saveSlotTimes(deps, ctx, body.times) })
  })
  const dayQuery = z.object({ date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/), packed: z.enum(['0', '1']).optional(), tz: z.string().max(60).optional() })
  app.get('/posting/day', async c => {
    const q = parse(dayQuery, c.req.query())
    return c.json(await dayView(deps, c.get('ctx'), { date: q.date, includePacked: q.packed === '1', tz: q.tz ?? null }))
  })
  app.post('/posting/day/pack', async c => {
    const ctx = c.get('ctx')
    requireRole(ctx, 'member')
    const body = parse(z.object({ date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/), includePacked: z.boolean().optional(), tz: z.string().max(60).nullable().optional() }), await json(c))
    return c.json(await startPack(deps, ctx, body), 202)
  })
  app.post('/results/csv/preview', async c => c.json(await previewResultsCsv(deps, c.get('ctx'), parse(z.object({ csv: z.string().max(400_000) }), await json(c)).csv)))
  app.post('/results/csv/apply', async c => {
    const ctx = c.get('ctx')
    requireRole(ctx, 'member')
    return c.json(await applyResultsCsv(deps, ctx, parse(z.object({ csv: z.string().max(400_000) }), await json(c)).csv))
  })
  // The stills path picked last (a model ref from a page from before is
  // read as its path).
  app.put('/slideshow/still-model', async c => {
    const ctx = c.get('ctx')
    requireRole(ctx, 'member')
    const body = parse(z.object({ path: z.enum(['account', 'api']).optional(), model: z.string().max(80).optional() }), await json(c))
    await saveSlideStillPath(deps, ctx, await stillPathFor(deps, ctx, null, { path: body.path, stillModel: body.model }))
    return c.json({ ok: true })
  })
  app.get('/slide-scenes', async c => c.json({ scenes: await listSlideScenes(deps, c.get('ctx')) }))
  app.post('/slide-scenes', async c => {
    const ctx = c.get('ctx')
    requireRole(ctx, 'member')
    const body = parse(z.object({
      name: z.string().max(80), characterId: z.string().max(60).nullable().optional(), topic: z.string().max(120).optional(),
      place: z.string().max(300), light: z.string().max(40).optional(), camera: z.string().max(60).optional(), phone: z.string().max(10).optional(),
      details: z.array(z.string().max(160)).max(2).optional(), lookAssetId: z.string().max(60).nullable().optional(),
    }), await json(c))
    return c.json(await saveSlideScene(deps, ctx, body), 201)
  })
  app.delete('/slide-scenes/:id', async c => {
    const ctx = c.get('ctx')
    requireRole(ctx, 'member')
    await archiveSlideScene(deps, ctx, c.req.param('id'))
    return c.json({ ok: true })
  })

  // Rendering is local and free (ffmpeg and sharp on the worker).
  app.post('/content/:id/render', async c => {
    const ctx = c.get('ctx')
    requireRole(ctx, 'member')
    const row = await startRender(deps, ctx, c.req.param('id'))
    return c.json({ id: row.id, status: row.status }, 202)
  })

  // ── Usage and settings ──
  app.get('/usage', async c => c.json(await accountUsage(deps, c.get('ctx'))))
  app.get('/settings', async c => c.json(await settingsView(deps, c.get('ctx'))))

  app.put('/settings/mode', async c => {
    const ctx = c.get('ctx')
    requireRole(ctx, 'admin')
    const body = parse(z.object({ mode: z.enum(['demo', 'live']) }), await json(c))
    if (body.mode === 'live') {
      const creds = await listCredentials(deps.db, ctx.accountId)
      const server = await serverKeyFor(deps.db, { ownerEmail: deps.env.STUDIO_OWNER_EMAIL || 'owner@studio.local', higgsfield: deps.env.HF_CREDENTIALS }, ctx.accountId, 'higgsfield')
      if (!creds.length && !server) throw new AppError('bad_request', 'Add at least one provider key before switching to live.')
    }
    await setSetting(deps, ctx, 'provider_mode', body.mode)
    return c.json({ mode: body.mode })
  })

  app.put('/settings/credentials/:provider', async c => {
    const ctx = c.get('ctx')
    requireRole(ctx, 'admin')
    const provider = c.req.param('provider')
    const body = parse(z.object({ secret: z.string().min(8).max(500), label: z.string().max(60).default('') }), await json(c))
    const view = await saveCredential(deps, ctx, provider, body.secret, body.label)
    // A free call proves the key works (never a generation).
    let verify = { ok: false, message: 'Not verified.' }
    try {
      const model = provider === 'anthropic' ? 'anthropic/claude-haiku-5-5' : `${provider}/x`
      const adapter = provider === 'anthropic' ? await deps.providers.llm(ctx.accountId, model) : await deps.providers.gen(ctx.accountId, model)
      verify = (await adapter.verifyCredentials?.()) ?? verify
    } catch (e) { verify = { ok: false, message: (e as Error).message } }
    await markVerified(deps.db, ctx.accountId, provider, verify.ok, deps.clock.now())
    return c.json({ credential: { ...view, verifyStatus: verify.ok ? 'ok' : 'failed' }, verify })
  })

  app.delete('/settings/credentials/:provider', async c => {
    const ctx = c.get('ctx')
    requireRole(ctx, 'admin')
    await revokeCredential(deps, ctx, c.req.param('provider'))
    return c.json({ ok: true })
  })

  // ── Higgsfield billing: the REST API or the owner's own account ──
  // Starts a sign-in for any MCP connection (a coming-soon one refuses).
  app.post('/oauth/:provider/start', async c => {
    const ctx = c.get('ctx')
    const origin = c.req.header('origin') || new URL(c.req.url).origin
    return c.json(await startConnect(deps, ctx, c.req.param('provider'), { origin }))
  })

  app.delete('/settings/connections/:provider', async c => {
    const ctx = c.get('ctx')
    const provider = c.req.param('provider')
    await disconnect(deps, ctx, provider)
    if (provider === 'higgsfield') balances.delete(ctx.accountId)
    return c.json(await settingsView(deps, ctx))
  })

  // Plan and credits come from Higgsfield (a free call), cached briefly so
  // the Settings page does not ask on every render.
  const balances = new Map<string, { at: number; credentialId: string; value: AccountBalance }>()
  app.get('/settings/higgsfield-account', async c => {
    const ctx = c.get('ctx')
    const stored = await readAccountTokens(deps.db, deps.vault, ctx.accountId)
    if (!stored) return c.json({ connected: false })
    const base = { connected: true, connectedAt: stored.createdAt.toISOString(), verifyStatus: stored.verifyStatus }
    const hit = balances.get(ctx.accountId)
    if (hit && hit.credentialId === stored.id && Date.now() - hit.at < 30_000 && !c.req.query('fresh')) return c.json({ ...base, ...hit.value })
    try {
      const value = await deps.providers.higgsfieldAccountBalance(ctx.accountId)
      balances.set(ctx.accountId, { at: Date.now(), credentialId: stored.id, value })
      if (stored.verifyStatus !== 'ok') await markVerified(deps.db, ctx.accountId, 'higgsfield_account', true, deps.clock.now())
      return c.json({ ...base, verifyStatus: 'ok', ...value })
    } catch (e) {
      return c.json({ ...base, credits: null, plan: null, error: (e as Error).message })
    }
  })


  app.put('/settings/billing', async c => {
    const ctx = c.get('ctx')
    requireRole(ctx, 'admin')
    const body = parse(z.object({ default: z.enum(['api', 'account']).optional(), creditUsd: z.number().min(0).max(10).optional() }), await json(c))
    const current = await readBilling(deps.db, ctx.accountId)
    const next = { default: body.default ?? current.default, creditUsd: body.creditUsd ?? current.creditUsd }
    if (next.default === 'account' && !(await readAccountTokens(deps.db, deps.vault, ctx.accountId))) {
      throw new AppError('bad_request', 'Connect your Higgsfield account first.')
    }
    await saveBilling(deps, ctx, next)
    return c.json(await settingsView(deps, ctx))
  })

  // A model's REST path, from Higgsfield's official Model API Reference.
  // Changing it clears the model's confirmation until its test passes again.
  app.put('/settings/models', async c => {
    const ctx = c.get('ctx')
    requireRole(ctx, 'admin')
    const body = parse(z.object({ ref: z.string(), endpoint: z.string().trim().max(200) }), await json(c))
    if (!deps.config.models.models.some(m => m.ref === body.ref && m.ref.startsWith('higgsfield/'))) throw new AppError('bad_request', `Unknown Higgsfield model "${body.ref}".`)
    if (body.endpoint && !isValidEndpoint(body.endpoint)) throw new AppError('bad_request', 'Enter the path as the reference shows it, for example bytedance/seedance-2.5/image-to-video (no https:// or host).')
    const overrides = await readModelOverrides(deps.db, ctx.accountId)
    const current = overrides[body.ref] ?? {}
    const next = { ...current, endpoint: body.endpoint || undefined }
    if ((current.endpoint ?? '') !== body.endpoint) { delete next.confirmedAt; delete next.confirmedBy }
    await setSetting(deps, ctx, MODEL_OVERRIDES_KEY, { ...overrides, [body.ref]: next })
    return c.json(await settingsView(deps, ctx))
  })

  // Which Claude model a task runs on (Settings, Claude models).
  app.put('/settings/claude', async c => {
    const ctx = c.get('ctx')
    requireRole(ctx, 'admin')
    const body = parse(z.object({ task: z.string(), model: z.string() }), await json(c))
    await setClaudeModel(deps, ctx, body.task, body.model)
    return c.json(await settingsView(deps, ctx))
  })

  app.put('/settings/budgets', async c => {
    const ctx = c.get('ctx')
    requireRole(ctx, 'admin')
    const body = parse(z.object({
      job: z.number().positive().max(1000).optional(), character: z.number().positive().max(100000).optional(), month: z.number().positive().max(1000000).optional(),
      day: z.number().positive().max(100000).optional(),
      confirmAbove: z.number().min(0).max(1000).optional(), warnPct: z.number().int().min(1).max(100).optional(),
    }), await json(c))
    if (body.job) await setBudget(deps, ctx, 'job', body.job)
    if (body.character) await setBudget(deps, ctx, 'character', body.character)
    if (body.month) await setBudget(deps, ctx, 'month', body.month, { warnPct: body.warnPct })
    if (body.confirmAbove != null) await setBudget(deps, ctx, 'confirm_above', body.confirmAbove)
    // Section 31: a raised daily cap starts the queued groups it now allows.
    if (body.day) { await setBudget(deps, ctx, 'day', body.day); await resumeCapWaits(deps, ctx.accountId) }
    return c.json(await settingsView(deps, ctx))
  })

  return app
}
