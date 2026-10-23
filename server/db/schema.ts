import {
  bigint, boolean, doublePrecision, index, integer, jsonb, pgTable, primaryKey, text, timestamp, uniqueIndex,
} from 'drizzle-orm/pg-core'
import { sql } from 'drizzle-orm'

// Every table carries account_id. Rows a person caused also carry user_id.
// Money is integer micro-USD. Timestamps are timezone-aware.

const createdAt = () => timestamp('created_at', { withTimezone: true }).defaultNow().notNull()
const updatedAt = () => timestamp('updated_at', { withTimezone: true }).defaultNow().notNull()
const micros = (name: string) => bigint(name, { mode: 'number' })

// ── Tenancy and identity ─────────────────────────────────────────

export const accounts = pgTable('accounts', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  createdAt: createdAt(),
})

export const users = pgTable('users', {
  id: text('id').primaryKey(),
  email: text('email').notNull(),
  name: text('name').notNull().default(''),
  passwordHash: text('password_hash'),
  createdAt: createdAt(),
}, t => [uniqueIndex('users_email_uq').on(t.email)])

export const memberships = pgTable('memberships', {
  accountId: text('account_id').notNull().references(() => accounts.id),
  userId: text('user_id').notNull().references(() => users.id),
  role: text('role').notNull(), // owner | admin | member | viewer
  createdAt: createdAt(),
}, t => [primaryKey({ columns: [t.accountId, t.userId] })])

export const sessions = pgTable('sessions', {
  id: text('id').primaryKey(),
  accountId: text('account_id').notNull().references(() => accounts.id),
  userId: text('user_id').notNull().references(() => users.id),
  tokenHash: text('token_hash').notNull(),
  userAgent: text('user_agent').notNull().default(''),
  ip: text('ip').notNull().default(''),
  createdAt: createdAt(),
  expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
  revokedAt: timestamp('revoked_at', { withTimezone: true }),
}, t => [uniqueIndex('sessions_token_uq').on(t.tokenHash)])

// Sign-in attempts, for the login throttle. They happen before anyone is
// signed in, so account_id is set only when the email belongs to a user.
export const loginAttempts = pgTable('login_attempts', {
  id: text('id').primaryKey(),
  accountId: text('account_id'),
  email: text('email').notNull(),
  ip: text('ip').notNull().default(''),
  ok: boolean('ok').notNull(),
  createdAt: createdAt(),
}, t => [index('login_attempts_email_idx').on(t.email, t.createdAt), index('login_attempts_ip_idx').on(t.ip, t.createdAt)])

export const auditLog = pgTable('audit_log', {
  id: text('id').primaryKey(),
  accountId: text('account_id').notNull().references(() => accounts.id),
  userId: text('user_id'),
  action: text('action').notNull(),
  targetType: text('target_type').notNull().default(''),
  targetId: text('target_id').notNull().default(''),
  data: jsonb('data').notNull().default({}),
  createdAt: createdAt(),
}, t => [index('audit_account_idx').on(t.accountId, t.createdAt)])

// Per-account overrides for config (rules, templates, routing, budgets defaults).
export const accountSettings = pgTable('account_settings', {
  accountId: text('account_id').notNull().references(() => accounts.id),
  key: text('key').notNull(),
  value: jsonb('value').notNull(),
  updatedBy: text('updated_by'),
  updatedAt: updatedAt(),
}, t => [primaryKey({ columns: [t.accountId, t.key] })])

// Provider keys, encrypted per account. Only last4 is ever shown.
export const providerCredentials = pgTable('provider_credentials', {
  id: text('id').primaryKey(),
  accountId: text('account_id').notNull().references(() => accounts.id),
  provider: text('provider').notNull(),
  label: text('label').notNull().default(''),
  // Envelope: the secret is encrypted with a random data key, and the data
  // key is wrapped with the master key named by key_version.
  keyVersion: text('key_version').notNull(),
  envelope: text('envelope').notNull(),
  last4: text('last4').notNull(),
  verifyStatus: text('verify_status').notNull().default('unverified'), // unverified | ok | failed
  verifiedAt: timestamp('verified_at', { withTimezone: true }),
  createdBy: text('created_by'),
  createdAt: createdAt(),
  revokedAt: timestamp('revoked_at', { withTimezone: true }),
}, t => [
  uniqueIndex('cred_active_uq').on(t.accountId, t.provider).where(sql`revoked_at is null`),
])

// ── Characters ───────────────────────────────────────────────────

export const characters = pgTable('characters', {
  id: text('id').primaryKey(),
  accountId: text('account_id').notNull().references(() => accounts.id),
  name: text('name').notNull(),
  slug: text('slug').notNull(),
  status: text('status').notNull().default('draft'), // draft | active | archived
  stage: integer('stage').notNull().default(1),
  age: integer('age'),
  card: text('card').notNull().default(''),
  features: jsonb('features').notNull().default({}),
  marks: jsonb('marks').notNull().default([]),
  body: text('body').notNull().default(''),
  style: jsonb('style').notNull().default({}),
  makeup: jsonb('makeup').notNull().default({}),
  persona: jsonb('persona').notNull().default({}),
  avoidModels: jsonb('avoid_models').notNull().default([]),
  preferredModels: jsonb('preferred_models').notNull().default({}),
  identityModel: jsonb('identity_model'),
  disclosure: text('disclosure').notNull().default('Label all posts as AI-generated'),
  sheetLock: jsonb('sheet_lock'),
  breakdown: jsonb('breakdown'),
  notes: text('notes').notNull().default(''),
  // Sections of the character file the Studio does not model (scene rules,
  // recipes, combo log), kept word for word so the file round-trips.
  fileSections: jsonb('file_sections').notNull().default([]),
  // The character's REALISM and AVOID prompt blocks (Realism principle).
  realism: jsonb('realism').notNull().default({}),
  revision: integer('revision').notNull().default(1),
  createdBy: text('created_by'),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
  archivedAt: timestamp('archived_at', { withTimezone: true }),
}, t => [uniqueIndex('characters_slug_uq').on(t.accountId, t.slug)])

// Every card edit is kept ("nothing is lost").
export const characterRevisions = pgTable('character_revisions', {
  id: text('id').primaryKey(),
  accountId: text('account_id').notNull().references(() => accounts.id),
  characterId: text('character_id').notNull().references(() => characters.id),
  revision: integer('revision').notNull(),
  snapshot: jsonb('snapshot').notNull(),
  reason: text('reason').notNull().default(''),
  createdBy: text('created_by'),
  createdAt: createdAt(),
}, t => [uniqueIndex('char_rev_uq').on(t.characterId, t.revision)])

export const characterInspirations = pgTable('character_inspirations', {
  accountId: text('account_id').notNull().references(() => accounts.id),
  characterId: text('character_id').notNull().references(() => characters.id),
  assetId: text('asset_id').notNull(),
  position: integer('position').notNull().default(0),
  createdAt: createdAt(),
}, t => [primaryKey({ columns: [t.characterId, t.assetId] })])

export const concepts = pgTable('concepts', {
  id: text('id').primaryKey(),
  accountId: text('account_id').notNull().references(() => accounts.id),
  characterId: text('character_id').notNull().references(() => characters.id),
  position: integer('position').notNull(),
  data: jsonb('data').notNull(),
  status: text('status').notNull().default('proposed'), // proposed | chosen | discarded
  sourceJobId: text('source_job_id'),
  createdAt: createdAt(),
}, t => [index('concepts_char_idx').on(t.characterId)])

// ── Assets ───────────────────────────────────────────────────────

export const assets = pgTable('assets', {
  id: text('id').primaryKey(),
  accountId: text('account_id').notNull().references(() => accounts.id),
  kind: text('kind').notNull(), // image | video | audio
  storageKey: text('storage_key').notNull(),
  mime: text('mime').notNull(),
  bytes: bigint('bytes', { mode: 'number' }).notNull(),
  width: integer('width'),
  height: integer('height'),
  durationMs: integer('duration_ms'),
  checksumSha256: text('checksum_sha256').notNull(),
  origin: text('origin').notNull(), // generated | upload | derived | fixture
  sourceJobId: text('source_job_id'),
  sourceUrl: text('source_url'),
  label: text('label').notNull().default(''),
  createdBy: text('created_by'),
  createdAt: createdAt(),
  archivedAt: timestamp('archived_at', { withTimezone: true }),
}, t => [index('assets_account_idx').on(t.accountId, t.createdAt), index('assets_checksum_idx').on(t.accountId, t.checksumSha256)])

// ── Reference sheet ──────────────────────────────────────────────

export const refImages = pgTable('ref_images', {
  id: text('id').primaryKey(),
  accountId: text('account_id').notNull().references(() => accounts.id),
  characterId: text('character_id').notNull().references(() => characters.id),
  refId: text('ref_id').notNull(), // REF-00 .. REF-11
  view: text('view').notNull(),
  framing: text('framing').notNull(),
  aspect: text('aspect').notNull(),
  dependsOn: jsonb('depends_on').notNull().default([]),
  status: text('status').notNull().default('pending'), // pending | generating | in_review | approved | stale
  approvedCandidateId: text('approved_candidate_id'),
  staleReason: text('stale_reason').notNull().default(''),
  staleSince: timestamp('stale_since', { withTimezone: true }),
  updatedAt: updatedAt(),
}, t => [uniqueIndex('ref_images_uq').on(t.characterId, t.refId)])

// Every generated result for a human gate (hero, sheet shot, later scenes).
export const candidates = pgTable('candidates', {
  id: text('id').primaryKey(),
  accountId: text('account_id').notNull().references(() => accounts.id),
  characterId: text('character_id').notNull().references(() => characters.id),
  target: text('target').notNull(), // hero | sheet | scene
  refId: text('ref_id'),
  // Scenes (Stage 7 and 8): the scene a still belongs to, the still it was
  // made from (an edit, crop, upscale, mirror or drift lock), and how.
  sceneId: text('scene_id'),
  parentId: text('parent_id'),
  op: text('op').notNull().default('generate'), // generate | edit | crop | upscale | mirror | drift_lock | end_frame | video | video_upscale | upload | clone
  // A name for a clip the owner brought in (an upload's file name).
  label: text('label').notNull().default(''),
  heroPromptIndex: integer('hero_prompt_index'),
  jobId: text('job_id'),
  assetId: text('asset_id'),
  prompt: text('prompt').notNull().default(''),
  status: text('status').notNull().default('generating'),
  // generating | qa_pending | qa_failed | in_review | approved | rejected | superseded | failed
  qaReport: jsonb('qa_report'),
  qaVerdict: text('qa_verdict'), // post | edit | regenerate | uncertain
  rejectReasons: jsonb('reject_reasons').notNull().default([]),
  rejectNote: text('reject_note').notNull().default(''),
  favorite: boolean('favorite').notNull().default(false),
  // Extra facts some ops keep: a last frame's source clip and handoff time,
  // a chained clip's parts and seam scores (Phase 3 chaining).
  meta: jsonb('meta').notNull().default({}),
  reviewedBy: text('reviewed_by'),
  reviewedAt: timestamp('reviewed_at', { withTimezone: true }),
  createdBy: text('created_by'),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
}, t => [index('candidates_char_idx').on(t.characterId, t.target, t.refId), index('candidates_scene_idx').on(t.sceneId)])

// A scene (Stage 7): one moment for a character, its structured fields (the
// prompt is built from them by code, never written by an LLM), and the stills
// made for it. Approving a still writes the scene to the combo log.
export const scenes = pgTable('scenes', {
  id: text('id').primaryKey(),
  accountId: text('account_id').notNull().references(() => accounts.id),
  characterId: text('character_id').notNull().references(() => characters.id),
  title: text('title').notNull().default(''),
  // The owner's own words, kept as written.
  brief: text('brief').notNull().default(''),
  fields: jsonb('fields').notNull().default({}),
  // The fields the last run used (defaults and what was read included).
  ranFields: jsonb('ran_fields'),
  // The written prompts (prompt writer or the owner's own edit), by target:
  // { still?: WrittenPrompt, video?: WrittenPrompt }.
  prompts: jsonb('prompts').notNull().default({}),
  status: text('status').notNull().default('draft'), // draft | generating | in_review | approved
  comboLoggedAt: timestamp('combo_logged_at', { withTimezone: true }),
  createdBy: text('created_by'),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
  archivedAt: timestamp('archived_at', { withTimezone: true }),
}, t => [index('scenes_char_idx').on(t.characterId, t.createdAt)])

// ── System: the job worker's status (shared infrastructure, no tenant data)

// One row ('main'). The worker writes its code version when it starts and
// "last seen" while it works; the API writes failed wake calls. The Studio
// reads it for the worker light in the header, without waking the worker.
export const workerStatus = pgTable('worker_status', {
  id: text('id').primaryKey(),
  version: text('version'),
  commit: text('commit'),
  startedAt: timestamp('started_at', { withTimezone: true }),
  lastSeenAt: timestamp('last_seen_at', { withTimezone: true }),
  wakeFailedAt: timestamp('wake_failed_at', { withTimezone: true }),
  wakeError: text('wake_error'),
  // The code version the API has waited for the worker to report, and since
  // when (a deploy that never arrives turns the light red).
  waitingFor: text('waiting_for'),
  waitingSince: timestamp('waiting_since', { withTimezone: true }),
  // Free disk on the worker (owner, 2026-10-15), in MB, and when it was read.
  freeDiskMb: integer('free_disk_mb'),
  diskCheckedAt: timestamp('disk_checked_at', { withTimezone: true }),
  updatedAt: updatedAt(),
})

// The Trash (owner, 2026-10-15; UX-PLAN.md section 22): an item deleted in
// the Library (a still, a take, a clip, an upload, B-roll, a sound or a
// render) waits here 7 days, restorable, then the daily clean removes its
// files from storage for good. `restore` holds what it was (its status, a
// render's outputs); `reason` is owner or auto (Auto-clean).
export const trashItems = pgTable('trash_items', {
  id: text('id').primaryKey(),
  accountId: text('account_id').notNull().references(() => accounts.id),
  kind: text('kind').notNull(), // candidate | broll | sound | render
  refId: text('ref_id').notNull(),
  label: text('label').notNull().default(''),
  characterId: text('character_id'),
  assetIds: jsonb('asset_ids').notNull().default([]),
  restore: jsonb('restore').notNull().default({}),
  reason: text('reason').notNull().default('owner'),
  deletedBy: text('deleted_by'),
  deletedAt: timestamp('deleted_at', { withTimezone: true }).notNull().defaultNow(),
  purgeAfter: timestamp('purge_after', { withTimezone: true }).notNull(),
  restoredAt: timestamp('restored_at', { withTimezone: true }),
  purgedAt: timestamp('purged_at', { withTimezone: true }),
}, t => [index('trash_account_idx').on(t.accountId, t.deletedAt)])

// ── Content builder (text overlays, owner 2026-10-13) ───────────────

// The owner's own clips (screen recordings, phone video of a laptop), tagged
// by product. The upload is converted on the worker to a lean copy.
export const brollClips = pgTable('broll_clips', {
  id: text('id').primaryKey(),
  accountId: text('account_id').notNull().references(() => accounts.id),
  assetId: text('asset_id'),
  title: text('title').notNull().default(''),
  // The product it shows (UX-PLAN.md section 29), picked from the products.
  // `product` is the old free-text label, kept for clips made before.
  productId: text('product_id'),
  product: text('product').notNull().default(''),
  status: text('status').notNull().default('processing'), // processing | ready | failed
  error: text('error'),
  createdBy: text('created_by'),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
  archivedAt: timestamp('archived_at', { withTimezone: true }),
}, t => [index('broll_account_idx').on(t.accountId, t.createdAt)])

// The sound library (Phase 3 sound bed): ambience recordings and music
// tracks the owner uploaded. Converted to AAC and measured (integrated
// loudness, LUFS) so the mix can level them. No AI music.
export const sounds = pgTable('sounds', {
  id: text('id').primaryKey(),
  accountId: text('account_id').notNull().references(() => accounts.id),
  kind: text('kind').notNull(), // ambience | music | voice
  // Voice lines (overnight item 4): the character whose voice it is, and
  // the performed take, the voice and the word timings in meta.
  characterId: text('character_id'),
  meta: jsonb('meta').notNull().default({}),
  assetId: text('asset_id'),
  title: text('title').notNull().default(''),
  tag: text('tag').notNull().default(''),
  durationMs: integer('duration_ms'),
  loudness: doublePrecision('loudness'),
  status: text('status').notNull().default('processing'), // processing | ready | failed
  error: text('error'),
  createdBy: text('created_by'),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
  archivedAt: timestamp('archived_at', { withTimezone: true }),
}, t => [index('sounds_account_idx').on(t.accountId, t.kind, t.createdAt)])

// A post (UX-PLAN.md): a video post, a slideshow or a batch. What it is made
// of (spec), and what rendering it produced (outputs). Drafts are saved as
// they are edited, and the post reopens at the step it was left on.
export const contentItems = pgTable('content_items', {
  id: text('id').primaryKey(),
  accountId: text('account_id').notNull().references(() => accounts.id),
  characterId: text('character_id'),
  kind: text('kind').notNull(), // meme (a video post) | slideshow | batch
  title: text('title').notNull().default(''),
  // The owner's idea for the post, in their own words.
  idea: text('idea').notNull().default(''),
  // The scene its stills come from (made in the post, or picked).
  sceneId: text('scene_id'),
  // Where it gets posted, for example "Callie TikTok" (Posts filters by it).
  accountTag: text('account_tag').notNull().default(''),
  // The product the post is for (UX-PLAN.md section 29), or none. Its vault,
  // claims and writing rules follow it; nothing else does.
  productId: text('product_id'),
  // The step it was left on: idea | stills | video | text | finish.
  step: text('step').notNull().default('idea'),
  spec: jsonb('spec').notNull().default({}),
  status: text('status').notNull().default('draft'), // draft | rendering | ready | failed
  outputs: jsonb('outputs').notNull().default({}),
  error: text('error'),
  // A slideshow's family (UX-PLAN.md section 27): the post a variation was
  // made from (the family's first post), and the batch post that made it.
  variationOf: text('variation_of'),
  batchOf: text('batch_of'),
  createdBy: text('created_by'),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
  archivedAt: timestamp('archived_at', { withTimezone: true }),
}, t => [index('content_account_idx').on(t.accountId, t.createdAt), index('content_family_idx').on(t.accountId, t.variationOf), index('content_batch_idx').on(t.accountId, t.batchOf)])

// The Scene library (UX-PLAN.md section 27): a saved slideshow scene (the
// place, light, camera and 2 details) for one character or one topic, with
// the picture it was saved from, so the same room looks the same every time.
export const slideScenes = pgTable('slide_scenes', {
  id: text('id').primaryKey(),
  accountId: text('account_id').notNull().references(() => accounts.id),
  characterId: text('character_id'),
  topic: text('topic').notNull().default(''),
  name: text('name').notNull(),
  place: text('place').notNull().default(''),
  light: text('light').notNull().default(''),
  camera: text('camera').notNull().default(''),
  phone: text('phone').notNull().default(''),
  details: jsonb('details').notNull().default([]),
  lookAssetId: text('look_asset_id'),
  createdBy: text('created_by'),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
  archivedAt: timestamp('archived_at', { withTimezone: true }),
}, t => [index('slide_scenes_account_idx').on(t.accountId, t.createdAt)])

// ── Jobs and money ───────────────────────────────────────────────

export const jobs = pgTable('jobs', {
  id: text('id').primaryKey(),
  accountId: text('account_id').notNull().references(() => accounts.id),
  userId: text('user_id'),
  characterId: text('character_id'),
  stage: text('stage').notNull(),
  purpose: text('purpose').notNull(),
  provider: text('provider').notNull(),
  model: text('model').notNull(),
  kind: text('kind').notNull(),
  request: jsonb('request').notNull(),
  idempotencyKey: text('idempotency_key').notNull(),
  quoteId: text('quote_id'),
  estimateMicros: micros('estimate_micros').notNull(),
  actualMicros: micros('actual_micros'),
  actualSource: text('actual_source'), // computed | provider | reconciled
  status: text('status').notNull(),
  providerJobId: text('provider_job_id'),
  webhookTokenHash: text('webhook_token_hash'),
  attempts: integer('attempts').notNull().default(0),
  pollCount: integer('poll_count').notNull().default(0),
  nextPollAt: timestamp('next_poll_at', { withTimezone: true }),
  lastPolledAt: timestamp('last_polled_at', { withTimezone: true }),
  lockedUntil: timestamp('locked_until', { withTimezone: true }),
  error: jsonb('error'),
  resultMeta: jsonb('result_meta'),
  submittedAt: timestamp('submitted_at', { withTimezone: true }),
  completedAt: timestamp('completed_at', { withTimezone: true }),
  // What the run is doing now, for the live status (owner, 2026-10-13):
  // sent | provider_queued | generating | checking | done, and since when.
  phase: text('phase'),
  phaseAt: timestamp('phase_at', { withTimezone: true }),
  // The real cost next to the quote (owner, 2026-10-14): on the plan the
  // credits Higgsfield actually took, read from its transactions; the
  // measured tokens for Claude. Flagged when more than 20% off the quote.
  costCheck: jsonb('cost_check'),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
}, t => [
  uniqueIndex('jobs_idem_uq').on(t.idempotencyKey),
  index('jobs_due_idx').on(t.status, t.nextPollAt),
  index('jobs_account_idx').on(t.accountId, t.createdAt),
  index('jobs_character_idx').on(t.accountId, t.characterId),
])

export const jobEvents = pgTable('job_events', {
  id: text('id').primaryKey(),
  accountId: text('account_id').notNull().references(() => accounts.id),
  jobId: text('job_id').notNull().references(() => jobs.id),
  type: text('type').notNull(),
  data: jsonb('data').notNull().default({}),
  createdAt: createdAt(),
}, t => [index('job_events_job_idx').on(t.jobId, t.createdAt)])

export const jobOutputs = pgTable('job_outputs', {
  accountId: text('account_id').notNull().references(() => accounts.id),
  jobId: text('job_id').notNull().references(() => jobs.id),
  position: integer('position').notNull(),
  assetId: text('asset_id').notNull(),
  providerUrl: text('provider_url'),
}, t => [primaryKey({ columns: [t.jobId, t.position] })])

export const quotes = pgTable('quotes', {
  id: text('id').primaryKey(),
  accountId: text('account_id').notNull().references(() => accounts.id),
  userId: text('user_id'),
  characterId: text('character_id'),
  purpose: text('purpose').notNull(),
  fingerprint: text('fingerprint').notNull(),
  items: jsonb('items').notNull(),
  totalMicros: micros('total_micros').notNull(),
  budget: jsonb('budget').notNull(),
  status: text('status').notNull(), // open | used | blocked | expired
  expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
  usedAt: timestamp('used_at', { withTimezone: true }),
  createdAt: createdAt(),
})

// Append-only. Signed amounts: hold (+) / release (-) track reservations;
// charge (+) / refund (-) / adjustment (+/-) track real spend.
export const ledgerEntries = pgTable('ledger_entries', {
  id: text('id').primaryKey(),
  accountId: text('account_id').notNull().references(() => accounts.id),
  userId: text('user_id'),
  characterId: text('character_id'),
  jobId: text('job_id'),
  quoteId: text('quote_id'),
  stage: text('stage').notNull().default(''),
  provider: text('provider').notNull().default(''),
  model: text('model').notNull().default(''),
  entryType: text('entry_type').notNull(), // hold | release | charge | refund | adjustment
  amountMicros: micros('amount_micros').notNull(),
  quantity: doublePrecision('quantity'),
  unit: text('unit'),
  unitPriceMicros: micros('unit_price_micros'),
  priceVersion: text('price_version'),
  markupMicros: micros('markup_micros').notNull().default(0),
  source: text('source').notNull().default('computed'), // computed | provider | reconciled | estimate
  note: text('note').notNull().default(''),
  createdAt: createdAt(),
}, t => [
  index('ledger_account_idx').on(t.accountId, t.createdAt),
  index('ledger_character_idx').on(t.accountId, t.characterId),
  index('ledger_job_idx').on(t.jobId),
])

export const budgets = pgTable('budgets', {
  id: text('id').primaryKey(),
  accountId: text('account_id').notNull().references(() => accounts.id),
  scope: text('scope').notNull(), // job | character | month | confirm_above | variation_threshold
  scopeRef: text('scope_ref').notNull().default(''), // character id for a per-character override
  capMicros: micros('cap_micros').notNull(),
  warnPct: integer('warn_pct').notNull().default(80),
  updatedBy: text('updated_by'),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
}, t => [uniqueIndex('budgets_scope_uq').on(t.accountId, t.scope, t.scopeRef)])

// The scale kit (overnight item 5, DECISIONS G35): per product, the hook
// vault, the claims sheet and the buyer-language bank; hook variants in
// each character's voice; and per social account (a post's account tag),
// its tracked link or promo code and signups for the scoreboard.
export const products = pgTable('products', {
  id: text('id').primaryKey(),
  accountId: text('account_id').notNull().references(() => accounts.id),
  name: text('name').notNull(),
  // Claims sheet, buyer language, the kit's voice cards and notes (JSON,
  // edited inline; server/core/scriptKit.ts has the shape).
  claims: jsonb('claims').notNull().default({}),
  language: jsonb('language').notNull().default({}),
  voices: jsonb('voices').notNull().default([]),
  notes: text('notes').notNull().default(''),
  // The product's writing rules (UX-PLAN.md section 29): a key of
  // writing_standards in config/content.yaml ("sidestep"), or "" for Plain.
  writing: text('writing').notNull().default(''),
  createdBy: text('created_by'),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
  archivedAt: timestamp('archived_at', { withTimezone: true }),
}, t => [index('products_account_idx').on(t.accountId, t.createdAt)])

export const hooks = pgTable('hooks', {
  id: text('id').primaryKey(),
  accountId: text('account_id').notNull().references(() => accounts.id),
  productId: text('product_id').notNull(),
  number: integer('number').notNull(),
  // The hook's type in the vault ("Relatable pain", "Soft product").
  kind: text('kind').notNull().default(''),
  text: text('text').notNull(),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
  archivedAt: timestamp('archived_at', { withTimezone: true }),
}, t => [index('hooks_product_idx').on(t.accountId, t.productId, t.number)])

export const hookVariants = pgTable('hook_variants', {
  id: text('id').primaryKey(),
  accountId: text('account_id').notNull().references(() => accounts.id),
  hookId: text('hook_id').notNull(),
  characterId: text('character_id').notNull(),
  text: text('text').notNull(),
  // Free checks against the claims sheet (warnings, never a block).
  flags: jsonb('flags').notNull().default([]),
  jobId: text('job_id'),
  createdAt: createdAt(),
  archivedAt: timestamp('archived_at', { withTimezone: true }),
}, t => [index('hook_variants_hook_idx').on(t.accountId, t.hookId, t.createdAt)])

export const socialAccounts = pgTable('social_accounts', {
  id: text('id').primaryKey(),
  accountId: text('account_id').notNull().references(() => accounts.id),
  // The account tag posts carry (Posts home filter), e.g. "callie.jobs".
  tag: text('tag').notNull(),
  characterId: text('character_id'),
  productId: text('product_id'),
  link: text('link').notNull().default(''),
  code: text('code').notNull().default(''),
  signups: integer('signups').notNull().default(0),
  views: integer('views'),
  notes: text('notes').notNull().default(''),
  // The playbook's structures for this account (section 28): a primary
  // (about 35% of posts) and a backup (about 20%), codes S1 to S12 or L13
  // to L25. Null: the playbook's fit table for the tag (config).
  primaryCode: text('primary_code'),
  backupCode: text('backup_code'),
  // Weeks (UX-PLAN.md section 37): the phone it posts from, the platform,
  // its slots per day and its life/job blend (the life %; null: the default
  // for its character, config/content.yaml weeks.blend_defaults).
  deviceId: text('device_id').notNull().default(''),
  platform: text('platform').notNull().default(''),
  slotsPerDay: integer('slots_per_day'),
  lifeShare: integer('life_share'),
  updatedBy: text('updated_by'),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
}, t => [uniqueIndex('social_accounts_tag_uq').on(t.accountId, t.tag)])

// The line bank (UX-PLAN.md section 36, item 29): one row per comment kept
// by the free first pass of an import; its tags, its on-screen line and the
// reviewer's scores once the priced run reaches it; the owner's call; the
// post it went to (one account only).
export const bankLines = pgTable('bank_lines', {
  id: text('id').primaryKey(),
  accountId: text('account_id').notNull().references(() => accounts.id),
  importId: text('import_id').notNull(),
  // The product whose writing rules tag it (its pain points), or null.
  productId: text('product_id'),
  comment: text('comment').notNull(),
  likes: integer('likes').notNull().default(0),
  replies: integer('replies').notNull().default(0),
  videoAccount: text('video_account').notNull().default(''),
  videoViews: integer('video_views').notNull().default(0),
  videoUrl: text('video_url').notNull().default(''),
  videoCaption: text('video_caption').notNull().default(''),
  // new, tagged, written (passed or not), failed (a call failed; runs again).
  state: text('state').notNull().default('new'),
  // { emotion, topic, pain, fits, format, fight, fightReason }
  tags: jsonb('tags'),
  line: text('line').notNull().default(''),
  // The writer passed on the comment (no usable truth): why.
  skipped: text('skipped').notNull().default(''),
  // { gut, specific, real, setup, meh, note }
  review: jsonb('review'),
  passed: boolean('passed'),
  // The owner's Keep or Reject.
  call: text('call'),
  calledAt: timestamp('called_at', { withTimezone: true }),
  // Where it was used: the post, its account, the character and the words
  // placed (the line in that character's voice).
  usedPostId: text('used_post_id'),
  usedAccountTag: text('used_account_tag'),
  usedCharacterId: text('used_character_id'),
  usedText: text('used_text').notNull().default(''),
  usedAt: timestamp('used_at', { withTimezone: true }),
  // Characters whose facts it contradicts (never offered to them again).
  skips: jsonb('skips').notNull().default([]),
  // Weeks (UX-PLAN.md section 37, item 6): where the line came from
  // (comment, caption, transcript, inventory, competitor, claude), life or
  // job (null: not tagged yet; read as job), and the day it posts.
  source: text('source').notNull().default('comment'),
  lifeOrJob: text('life_or_job'),
  usedDate: text('used_date'),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
}, t => [index('bank_lines_account_idx').on(t.accountId, t.likes), index('bank_lines_import_idx').on(t.accountId, t.importId)])

// ── ComfyUI on a remote workstation (UX-PLAN.md section 41) ────────

// The queue the machine's agent pulls from. The API and the worker enqueue
// (idempotent on `key`: the run, the step and the attempt); the agent claims
// a task, renews its lease with progress and reports done or failed. A lease
// that runs out is reclaimed once as attempt 2; then the task is Failed.
export const comfyTasks = pgTable('comfy_tasks', {
  id: text('id').primaryKey(),
  accountId: text('account_id').notNull().references(() => accounts.id),
  // The Studio job this task runs (null for a LoRA training started on its
  // own), the character and who clicked.
  jobId: text('job_id'),
  characterId: text('character_id'),
  userId: text('user_id'),
  key: text('key').notNull(),
  // workflow | train
  kind: text('kind').notNull(),
  workflowId: text('workflow_id').notNull(),
  workflowVersion: integer('workflow_version').notNull().default(1),
  // qwen | krea2 | wan: claims prefer the family the machine has loaded.
  family: text('family').notNull(),
  // The API graph with the Studio's inputs bound; images are placeholders
  // ("studio:ref0") the agent fills with the names it uploaded.
  graph: jsonb('graph').notNull(),
  // { slot: assetId } for every image or clip the agent fetches.
  inputs: jsonb('inputs').notNull().default({}),
  // The recipe log (E5): workflow, models, LoRA version, seed, prompt, refs.
  recipe: jsonb('recipe').notNull().default({}),
  // queued | claimed | running | done | failed | canceled
  state: text('state').notNull().default('queued'),
  attempt: integer('attempt').notNull().default(1),
  batch: integer('batch').notNull().default(1),
  leaseUntil: timestamp('lease_until', { withTimezone: true }),
  claimedAt: timestamp('claimed_at', { withTimezone: true }),
  startedAt: timestamp('started_at', { withTimezone: true }),
  finishedAt: timestamp('finished_at', { withTimezone: true }),
  timeoutSec: integer('timeout_sec').notNull().default(900),
  progress: doublePrecision('progress').notNull().default(0),
  // A lease token per claim: a late report from an earlier claim is refused.
  claimToken: text('claim_token'),
  // [{ storageKey, kind, mime, width, height, durationSec }]
  outputs: jsonb('outputs'),
  // A LoRA training's result: { fileName, sha256 }.
  result: jsonb('result'),
  error: text('error'),
  // Why it failed: oom | lease | timeout | agent | env.
  failReason: text('fail_reason'),
  envHash: text('env_hash'),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
}, t => [
  uniqueIndex('comfy_tasks_key_uq').on(t.accountId, t.key),
  index('comfy_tasks_state_idx').on(t.accountId, t.state, t.createdAt),
  index('comfy_tasks_job_idx').on(t.jobId),
])

// A character's LoRAs, trained on the machine. The file stays there; the
// Studio keeps its version, trigger word, file name and checksum.
export const comfyLoras = pgTable('comfy_loras', {
  id: text('id').primaryKey(),
  accountId: text('account_id').notNull().references(() => accounts.id),
  characterId: text('character_id').notNull(),
  // qwen | krea2
  base: text('base').notNull(),
  version: integer('version').notNull(),
  trigger: text('trigger').notNull(),
  // training | ready | failed
  state: text('state').notNull().default('training'),
  taskId: text('task_id'),
  fileName: text('file_name'),
  sha256: text('sha256'),
  // The images it was trained on: [{ assetId, refId? }].
  images: jsonb('images').notNull().default([]),
  active: boolean('active').notNull().default(false),
  steps: integer('steps').notNull().default(2000),
  createdBy: text('created_by'),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
}, t => [
  uniqueIndex('comfy_loras_version_uq').on(t.accountId, t.characterId, t.base, t.version),
  index('comfy_loras_character_idx').on(t.accountId, t.characterId),
])
