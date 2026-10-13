import { Hono, type Context } from 'hono'
import { z } from 'zod'
import sharp from 'sharp'
import { and, desc, eq, inArray } from 'drizzle-orm'
import type { Ctx, Deps, Principal } from '../context'
import { hasRole } from '../context'
import { AppError } from '../lib/errors'
import { newId } from '../lib/ids'
import type { AuthProvider } from '../auth/provider'
import { jobEvents, jobs } from '../db/schema'
import { readAsset, saveAsset, getAsset } from '../storage/assets'
import { verifyAssetSignature } from '../jobs/assetUrls'
import { cancelJob, getJob, resolveJob, wakeFromWebhook } from '../jobs/runner'
import { actionSchema, estimateAction, runAction } from '../pipeline/actions'
import { createCharacter, getCharacter, linkInspiration, listCharacters, setCharacterFields, updateCharacter } from '../pipeline/characters'
import { chooseConcept } from '../pipeline/concepts'
import { approveCandidate, keepStale, pickHero, rejectCandidate, reopenCandidate, setFavorite, mirrorCandidate } from '../pipeline/review'
import { isValidEndpoint, MODEL_OVERRIDES_KEY, readModelOverrides } from '../providers/modelOverrides'
import { attachCheckImages, attachSheetImages, exportCharacter, importCharacter, type CheckImage } from '../pipeline/files'
import { accountUsage } from '../pipeline/costs'
import { providerMode, setSetting } from '../pipeline/settings'
import { listCredentials, markVerified, revokeCredential, saveCredential } from '../providers/credentials'
import { disconnectAccount, finishAccountConnect, readAccountTokens, startAccountConnect } from '../providers/higgsfieldOAuth'
import { readBilling, saveBilling } from '../providers/billing'
import type { AccountBalance } from '../providers/higgsfieldAccount'
import { setBudget } from '../costs/budgets'
import { formatUsd } from '../costs/money'
import { characterSummary, characterView, settingsView } from './views'

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

// Uploaded files named REF-00 to REF-11 become approved sheet images. A
// mirrored copy (a negative QA fixture) becomes an image to check instead.
async function sheetImagesFrom(value: unknown): Promise<{ images: Record<string, { data: Buffer; mime: string }>; checks: CheckImage[] }> {
  const images: Record<string, { data: Buffer; mime: string }> = {}
  const checks: CheckImage[] = []
  for (const f of ([] as unknown[]).concat(value ?? [])) {
    if (!(f instanceof File)) continue
    if (f.size > MAX_UPLOAD) throw new AppError('bad_request', `${f.name} is larger than 25 MB.`)
    const ref = f.name.toUpperCase().match(/REF-(\d{2})/)
    if (!ref) continue
    const data = Buffer.from(await f.arrayBuffer())
    if (/MIRROR/.test(f.name.toUpperCase())) checks.push({ refId: `REF-${ref[1]}`, name: f.name, data, mime: f.type })
    else images[`REF-${ref[1]}`] = { data, mime: f.type }
  }
  return { images, checks }
}

export function createApp(deps: Deps, auth: AuthProvider): Hono<Env> {
  const app = new Hono<Env>().basePath('/api/v1')

  app.onError((err, c) => {
    const reqId = c.get('ctx')?.requestId
    if (err instanceof AppError) {
      return c.json({ error: { code: err.code, message: err.message, details: err.details ?? null, requestId: reqId } }, err.status as 400)
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
    const { assets } = await import('../db/schema')
    const [row] = await deps.db.select().from(assets).where(eq(assets.id, id))
    if (!row) return c.json({ error: { code: 'not_found', message: 'Not found.' } }, 404)
    return new Response(new Uint8Array(await deps.store.get(row.storageKey)), { headers: { 'content-type': row.mime, 'cache-control': 'private, max-age=600' } })
  })

  // The redirect back from the Higgsfield account sign-in. A browser
  // navigation, so no API session: the one-time state binds it to the admin
  // who started it. Always lands on Settings with a message.
  app.get('/oauth/higgsfield/callback', async c => {
    const q = c.req.query()
    const r = await finishAccountConnect(deps, { code: q.code, state: q.state, error: q.error, error_description: q.error_description })
    const params = new URLSearchParams(r.ok ? { higgsfield: 'connected' } : { higgsfield: 'error', message: r.message })
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

  app.post('/characters/:id/inspirations', async c => {
    const ctx = c.get('ctx')
    requireRole(ctx, 'member')
    const file = await uploadedFile(c, 'file')
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

  // ── Review gates ──
  app.post('/candidates/:id/approve', async c => { const ctx = c.get('ctx'); requireRole(ctx, 'member'); return c.json(await approveCandidate(deps, ctx, c.req.param('id'))) })
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
    const body = await c.req.parseBody({ all: true })
    const md = ([] as unknown[]).concat(body.file ?? [])[0]
    const { images, checks } = await sheetImagesFrom(body.images)
    if (!(md instanceof File) && !Object.keys(images).length && !checks.length) throw new AppError('bad_request', 'Attach the character file (.md) or sheet images named REF-00 to REF-11.')
    let warnings: string[] = []
    let importedShots: string[]
    let checkShots: string[]
    if (md instanceof File) {
      const r = await importCharacter(deps, ctx, await md.text(), { characterId: id, images, checks })
      warnings = r.result.warnings
      importedShots = r.importedShots
      checkShots = r.checkShots
    } else {
      importedShots = await attachSheetImages(deps, ctx, id, images)
      checkShots = await attachCheckImages(deps, ctx, id, checks)
    }
    return c.json({ warnings, importedShots, checkShots, view: await characterView(deps, ctx, id) })
  })

  app.post('/characters/import', async c => {
    const ctx = c.get('ctx')
    requireRole(ctx, 'member')
    const body = await c.req.parseBody({ all: true })
    const md = body.file
    if (!(md instanceof File)) throw new AppError('bad_request', 'Attach the character file (.md).')
    const { images, checks } = await sheetImagesFrom(body.images)
    const result = await importCharacter(deps, ctx, await md.text(), { images, checks })
    return c.json({ characterId: result.characterId, importedShots: result.importedShots, checkShots: result.checkShots, warnings: result.result.warnings }, 201)
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
    const { row, data } = await readAsset(deps, ctx, c.req.param('id'))
    return new Response(new Uint8Array(data), { headers: { 'content-type': row.mime, 'cache-control': 'private, max-age=31536000, immutable', 'content-disposition': c.req.query('download') ? `attachment; filename="${row.id}.${row.mime.split('/')[1]}"` : 'inline' } })
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
      if (!creds.length) throw new AppError('bad_request', 'Add at least one provider key before switching to live.')
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
  app.post('/oauth/higgsfield/start', async c => {
    const ctx = c.get('ctx')
    const origin = c.req.header('origin') || new URL(c.req.url).origin
    return c.json(await startAccountConnect(deps, ctx, { origin }))
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

  app.delete('/settings/higgsfield-account', async c => {
    const ctx = c.get('ctx')
    await disconnectAccount(deps, ctx)
    balances.delete(ctx.accountId)
    return c.json(await settingsView(deps, ctx))
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
