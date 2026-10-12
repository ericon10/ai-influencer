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
  target: text('target').notNull(), // hero | sheet
  refId: text('ref_id'),
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
  reviewedBy: text('reviewed_by'),
  reviewedAt: timestamp('reviewed_at', { withTimezone: true }),
  createdBy: text('created_by'),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
}, t => [index('candidates_char_idx').on(t.characterId, t.target, t.refId)])

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
