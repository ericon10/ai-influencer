import { Hono, type Context } from 'hono'
import { z } from 'zod'
import sharp from 'sharp'
import { and, desc, eq, inArray } from 'drizzle-orm'
import type { Ctx, Deps, Principal } from '../context.js'
import { hasRole } from '../context.js'
import { AppError } from '../lib/errors.js'
import { ProviderError } from '../providers/types.js'
import { newId } from '../lib/ids.js'
import type { AuthProvider } from '../auth/provider.js'
import { jobEvents, jobs } from '../db/schema.js'
import { readAsset, saveAsset, getAsset } from '../storage/assets.js'
import { verifyAssetSignature } from '../jobs/assetUrls.js'
import { cancelJob, getJob, resolveJob, wakeFromWebhook } from '../jobs/runner.js'
import { wakeWorker } from '../jobs/wake.js'
import { actionSchema, estimateAction, runAction } from '../pipeline/actions.js'
import { createCharacter, getCandidate, getCharacter, linkInspiration, listCharacters, setCharacterFields, updateCharacter } from '../pipeline/characters.js'
import { approveSceneCandidate, archiveScene, copyScene, createScene, cropCandidate, saveVideoModel, updateScene } from '../pipeline/scenes.js'
import { videoPrices } from '../pipeline/sceneActions.js'
import { addBroll, archiveBroll, archiveContent, contentView, createContent, startRender, updateBroll, updateContent } from '../pipeline/content.js'
import { rulesView, setRuleSwitch } from '../pipeline/rules.js'
import { chooseConcept } from '../pipeline/concepts.js'
import { approveCandidate, keepStale, pickHero, rejectCandidate, reopenCandidate, setFavorite, mirrorCandidate } from '../pipeline/review.js'
import { isValidEndpoint, MODEL_OVERRIDES_KEY, readModelOverrides } from '../providers/modelOverrides.js'
import { attachCheckImages, attachSheetImages, exportCharacter, importCharacter, type CheckImage } from '../pipeline/files.js'
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
async function fileBundle(deps: Deps, c: Context, ctx: Ctx): Promise<{ markdown: string | null; files: UploadedFile[] }> {
  if ((c.req.header('content-type') ?? '').includes('application/json')) {
    const body = parse(z.object({ markdown: z.string().max(500_000).optional(), uploads: uploadRefs }), await json(c))
    return { markdown: body.markdown ?? null, files: await takeUploads(deps, ctx, body.uploads) }
  }
  const body = await c.req.parseBody({ all: true })
  const md = ([] as unknown[]).concat(body.file ?? [])[0]
  return { markdown: md instanceof File ? await md.text() : null, files: await multipartFiles(body.images) }
}

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
  app.get('/health', c => c.json({ ok: true }))

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
    const body = parse(z.object({ name: z.string().max(80).default('') }), await json(c))
    const row = await createCharacter(deps, ctx, { name: body.name || 'New character' })
    return c.json({ id: row.id }, 201)
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
  })

  app.patch('/characters/:id', async c => {
    const ctx = c.get('ctx')
    requireRole(ctx, 'member')
    const body = parse(z.object({ patch: patchSchema, reason: z.string().max(200).default('edited') }), await json(c))
    await updateCharacter(deps, ctx, c.req.param('id'), body.patch, body.reason)
    return c.json(await characterView(deps, ctx, c.req.param('id')))
  })

  app.delete('/characters/:id', async c => {
    const ctx = c.get('ctx')
    requireRole(ctx, 'admin')
    await getCharacter(deps, ctx, c.req.param('id'))
    await setCharacterFields(deps, ctx, c.req.param('id'), { archivedAt: deps.clock.now(), status: 'archived' })
    return c.json({ ok: true })
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
    return c.json({ driver: deps.store.driver, bucket: deps.store.driver === 's3' ? deps.env.S3_BUCKET : null, origins, corsRules: corsRules(origins) })
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
    fields: z.record(z.string(), z.union([z.string().max(400), z.boolean(), z.array(z.string().max(20)).max(8)])).optional(),
    prompts: z.object({ still: z.string().max(4000).optional(), video: z.string().max(4000).optional() }).optional(),
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

  app.post('/characters/import', async c => {
    const ctx = c.get('ctx')
    requireRole(ctx, 'member')
    const { markdown, files } = await fileBundle(deps, c, ctx)
    if (!markdown) throw new AppError('bad_request', 'Attach the character file (.md).')
    const { images, checks } = sheetImagesFrom(files)
    const result = await importCharacter(deps, ctx, markdown, { images, checks })
    const checkJobId = result.importedShots.length ? await startImportCheck(deps, ctx, result.characterId, result.importedShots) : null
    return c.json({ characterId: result.characterId, importedShots: result.importedShots, checkShots: result.checkShots, checkJobId, warnings: result.result.warnings }, 201)
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
    if (c.req.query('active') === '1') conds.push(inArray(jobs.status, ['waiting', 'queued', 'submitting', 'running', 'ingesting', 'needs_attention']))
    const rows = await deps.db.select().from(jobs).where(and(...conds)).orderBy(desc(jobs.createdAt)).limit(Math.min(200, Number(c.req.query('limit') ?? 50)))
    // Safety net for a lost wake (say, the worker was redeploying): the
    // Studio polls this while jobs run, so an overdue job wakes the worker.
    const overdue = deps.clock.now().getTime() - 20_000
    if (rows.some(r => ['queued', 'submitting', 'running', 'ingesting'].includes(r.status) && r.nextPollAt && r.nextPollAt.getTime() < overdue)) await wakeWorker(deps)
    const ids = rows.map(r => r.id)
    const created = ids.length ? await deps.db.select().from(jobEvents).where(and(inArray(jobEvents.jobId, ids), eq(jobEvents.type, 'created'))) : []
    const labels = new Map(created.map(e => [e.jobId, (e.data as { label?: string }).label ?? '']))
    return c.json({
      jobs: rows.map(j => ({
        id: j.id, label: labels.get(j.id) ?? j.purpose, purpose: j.purpose, stage: j.stage, status: j.status, kind: j.kind,
        model: `${j.provider}/${j.model}`, characterId: j.characterId,
        estimate: formatUsd(j.estimateMicros), actual: j.actualMicros != null ? formatUsd(j.actualMicros) : null,
        error: (j.error as { message?: string } | null)?.message ?? null, createdAt: j.createdAt.toISOString(), completedAt: j.completedAt?.toISOString() ?? null,
      })),
    })
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

  // ── Assets (auth-checked; thumbnails resized on the fly) ──
  app.get('/assets/:id/content', async c => {
    const ctx = c.get('ctx')
    const width = Number(c.req.query('w') ?? 0)
    if (width) {
      const asset = await getAsset(deps, ctx, c.req.param('id'))
      if (asset.kind === 'image') {
        // Assets never change, so each thumbnail size is made once and kept.
        const w = [160, 320, 480, 720, 960, 1600].find(x => x >= width) ?? 1600
        const key = `${asset.storageKey.replace(/\.[a-z0-9]+$/, '')}.w${w}.webp`
        let thumb: Buffer
        if (await deps.store.exists(key)) thumb = await deps.store.get(key)
        else {
          const { data } = await readAsset(deps, ctx, asset.id)
          thumb = await sharp(data).resize({ width: w, withoutEnlargement: true }).webp({ quality: 82 }).toBuffer()
          await deps.store.put(key, thumb, 'image/webp')
        }
        return new Response(new Uint8Array(thumb), { headers: { 'content-type': 'image/webp', 'cache-control': 'private, max-age=31536000, immutable' } })
      }
    }
    // Videos and download bundles come straight from storage (a short-lived
    // link): a function response is capped at 4.5 MB on Vercel.
    const download = c.req.query('download') ? (c.req.query('name') || `${c.req.param('id')}`) : null
    if (deps.store.driver === 's3') {
      const asset = await getAsset(deps, ctx, c.req.param('id'))
      if (asset.kind === 'video' || asset.kind === 'file' || download) {
        const ext = asset.storageKey.split('.').pop() ?? 'bin'
        const url = await deps.store.presignGet(asset.storageKey, 3600, download ? { downloadName: download.endsWith(`.${ext}`) ? download : `${download}.${ext}` } : undefined)
        if (url) return new Response(null, { status: 302, headers: { location: url, 'cache-control': 'private, max-age=600' } })
      }
    }
    const { row, data } = await readAsset(deps, ctx, c.req.param('id'))
    const ext = row.storageKey.split('.').pop() ?? 'bin'
    const headers: Record<string, string> = { 'content-type': row.mime, 'cache-control': 'private, max-age=31536000, immutable', 'accept-ranges': 'bytes', 'content-disposition': download ? `attachment; filename="${(download.endsWith(`.${ext}`) ? download : `${download}.${ext}`).replace(/[^\w.-]+/g, '_')}"` : 'inline' }
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

  // ── Content builder: B-roll, meme videos, slideshows, batches ──
  app.get('/content', async c => c.json(await contentView(deps, c.get('ctx'))))
  app.post('/broll', async c => {
    const ctx = c.get('ctx')
    requireRole(ctx, 'member')
    const body = parse(z.object({ uploadId: z.string().max(40), name: z.string().max(300), title: z.string().max(120).optional(), product: z.string().max(60).optional() }), await json(c))
    return c.json(await addBroll(deps, ctx, body), 201)
  })
  app.patch('/broll/:id', async c => {
    const ctx = c.get('ctx')
    requireRole(ctx, 'member')
    const body = parse(z.object({ title: z.string().max(120).optional(), product: z.string().max(60).optional() }), await json(c))
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
    const body = parse(z.object({ kind: z.enum(['meme', 'slideshow', 'batch']), characterId: z.string().max(60), title: z.string().max(120).optional(), spec: z.record(z.string(), z.unknown()).optional() }), await json(c))
    const row = await createContent(deps, ctx, body)
    return c.json({ id: row.id }, 201)
  })
  app.patch('/content/:id', async c => {
    const ctx = c.get('ctx')
    requireRole(ctx, 'member')
    const body = parse(z.object({ title: z.string().max(120).optional(), spec: z.record(z.string(), z.unknown()).optional() }), await json(c))
    const row = await updateContent(deps, ctx, c.req.param('id'), body)
    return c.json({ id: row.id })
  })
  app.delete('/content/:id', async c => {
    const ctx = c.get('ctx')
    requireRole(ctx, 'member')
    await archiveContent(deps, ctx, c.req.param('id'))
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
      confirmAbove: z.number().min(0).max(1000).optional(), warnPct: z.number().int().min(1).max(100).optional(),
    }), await json(c))
    if (body.job) await setBudget(deps, ctx, 'job', body.job)
    if (body.character) await setBudget(deps, ctx, 'character', body.character)
    if (body.month) await setBudget(deps, ctx, 'month', body.month, { warnPct: body.warnPct })
    if (body.confirmAbove != null) await setBudget(deps, ctx, 'confirm_above', body.confirmAbove)
    return c.json(await settingsView(deps, ctx))
  })

  return app
}
