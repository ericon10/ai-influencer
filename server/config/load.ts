import { readFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { parse as parseYaml } from 'yaml'
import { z } from 'zod'
import { pipelineSchemas, type PipelineConfig } from './pipeline.js'

// Rules, prompt templates, model routing, prices and limits are data in
// /config, validated here at boot. A bad config file fails fast with the
// file name and the offending path, instead of misbehaving at run time.

const genKind = z.enum(['image', 'image_edit', 'video', 'video_extend', 'audio', 'train_identity', 'upscale'])

const modelsSchema = z.object({
  version: z.number(),
  models: z.array(z.object({
    ref: z.string().regex(/^[a-z0-9-]+\/[a-z0-9.\-]+$/),
    label: z.string(),
    kinds: z.array(genKind).min(1),
    max_refs: z.number().int().min(0),
    endpoint: z.string().nullable(),
    // The official Model API Reference page the endpoint and fields come from.
    reference: z.string().url().optional(),
    // False when the model is not on the pay-per-use API at all (it is absent
    // from the official Model API Reference); it then runs only through the
    // owner's Higgsfield account.
    api: z.boolean().default(true),
    input_map: z.string(),
    verified: z.boolean(),
    notes: z.string().optional(),
    // Other names people use for the model (character files, the Higgsfield
    // web app). The character-file importer maps them to this ref.
    aliases: z.array(z.string()).default([]),
    // The model id in the Higgsfield web app and MCP connector. Models with
    // one can also run through the owner's Higgsfield account (plan credits).
    mcp_id: z.string().optional(),
    // The account path's inputs, from models_explore: the parameter names this
    // model accepts (nothing else is sent) and values always sent with it.
    mcp: z.object({
      params: z.array(z.string()).default([]),
      fixed: z.record(z.string(), z.union([z.string(), z.number(), z.boolean()])).default({}),
      roles: z.object({ refs: z.string().optional(), start: z.string().optional(), end: z.string().optional() }).default({}),
    }).optional(),
    // Video and audio: whether a request can turn generated sound off.
    // always_on means the Studio strips the track on arrival instead.
    audio: z.enum(['off_switch', 'always_on']).optional(),
    // Known inputs and limits, recorded as verified facts.
    params: z.record(z.string(), z.unknown()).default({}),
    use_for: z.array(z.string()).default([]),
    avoid_for: z.array(z.string()).default([]),
    // Realism principle: provider options known to beautify, face-enhance or
    // smooth skin by default, sent explicitly off on every request. Adapters
    // also force off any such option they send, listed here or not.
    force_off: z.record(z.string(), z.union([z.boolean(), z.string(), z.number()])).optional(),
  })),
  llm_models: z.array(z.object({
    ref: z.string(),
    label: z.string(),
    api_model: z.string(),
    vision: z.boolean(),
  })),
})

const priceUnit = z.enum(['image', 'second', 'call', 'mtok_in', 'mtok_out', 'mtok_cache_read', 'mtok_cache_write'])

const pricebookSchema = z.object({
  version: z.string(),
  currency: z.literal('USD'),
  entries: z.array(z.object({
    provider: z.string(),
    model: z.string(),
    unit: priceUnit,
    price: z.number().nonnegative(),
    verified: z.boolean(),
    when: z.record(z.string(), z.string()).optional(),
    source: z.string().optional(),
    // Higgsfield credits per unit as charged in the web/MCP account. Shown
    // for reference; estimates use the USD price.
    credits: z.number().nonnegative().optional(),
  })),
})

const budgetsSchema = z.object({
  job: z.number().positive(),
  character: z.number().positive(),
  month: z.number().positive(),
  warn_pct: z.number().int().min(1).max(100),
  confirm_above: z.number().nonnegative(),
  variation_threshold: z.number().nonnegative(),
  default_variations_expensive: z.number().int().min(1),
  default_variations_cheap: z.number().int().min(1),
})

const routeSchema = z.object({
  model: z.string(),
  kind: genKind.optional(),
  quality: z.string().optional(),
  resolution: z.string().optional(),
  aspect: z.string().optional(),
  effort: z.enum(['low', 'medium', 'high', 'xhigh', 'max']).optional(),
})

const routingSchema = z.object({
  version: z.number(),
  tasks: z.record(z.string(), routeSchema),
  mock: z.object({ image: z.string(), video: z.string(), llm: z.string() }),
  avoid: z.record(z.string(), z.array(z.string())),
})

const runtimeSchema = z.object({
  jobs: z.object({
    poll_initial_sec: z.number().positive(),
    poll_max_sec: z.number().positive(),
    poll_backoff: z.number().min(1),
    lock_sec: z.number().positive(),
    submit_max_attempts: z.number().int().min(1),
    quote_ttl_sec: z.number().positive(),
    stuck_after_sec: z.record(z.string(), z.number().positive()),
  }),
  downloads: z.object({
    max_bytes: z.number().positive(),
    timeout_sec: z.number().positive(),
    allowed_hosts: z.record(z.string(), z.array(z.string())),
  }),
  media: z.object({
    seam: z.object({ max_diff: z.number().positive(), motion_max_diff: z.number().positive(), motion_ratio: z.number().min(1), motion_threshold: z.number().positive(), color_match: z.boolean() }),
    last_frame: z.object({ step_back_sec: z.number().positive(), blur_ratio: z.number().positive() }),
  }),
  llm: z.object({ image_max_edge: z.number().int().positive(), image_max_tokens: z.number().int().positive() }),
  // Realism principle: after an upscale or edit, the face must keep at least
  // this share of its fine skin detail, or it is flagged as smoothed.
  qa: z.object({ texture_min_ratio: z.number().positive().max(1) }).default({ texture_min_ratio: 0.6 }),
  // One quoted run that checks each real model path once (Settings).
  model_suite: z.object({
    cap_usd: z.number().positive(),
    tests: z.array(z.object({
      model: z.string(),
      kind: z.enum(['image', 'video', 'upscale']),
      refs: z.number().int().min(0).max(4).default(0),
      frames: z.enum(['start', 'start_end']).default('start'),
      aspect: z.string().optional(),
      resolution: z.string().optional(),
      duration_sec: z.number().positive().optional(),
    })).min(1),
  }),
  // MCP-based providers that bill the owner's own plan (OAuth sign-in, plan
  // credits). One connection flow serves all of them; coming_soon ones are
  // listed and never called.
  mcp_connections: z.record(z.string(), z.object({
    label: z.string(),
    site: z.string().url(),
    status: z.enum(['live', 'coming_soon']),
    note: z.string().optional(),
    mcp_url: z.string().url().optional(),
    oauth: z.object({ register: z.string().url(), authorize: z.string().url(), token: z.string().url(), scope: z.string() }).optional(),
    timeout_sec: z.number().positive().default(60),
    poll_after_sec: z.number().positive().default(5),
  }).refine(c => c.status !== 'live' || (!!c.mcp_url && !!c.oauth), { message: 'A live connection needs mcp_url and oauth.' })),
})

export type ModelsConfig = z.infer<typeof modelsSchema>
export type ModelEntry = ModelsConfig['models'][number]
export type PriceBook = z.infer<typeof pricebookSchema>
export type PriceEntry = PriceBook['entries'][number]
export type BudgetDefaults = z.infer<typeof budgetsSchema>
export type RoutingConfig = z.infer<typeof routingSchema>
export type Route = z.infer<typeof routeSchema>
export type RuntimeConfig = z.infer<typeof runtimeSchema>

export interface StudioConfig {
  models: ModelsConfig
  pricebook: PriceBook
  budgets: BudgetDefaults
  routing: RoutingConfig
  runtime: RuntimeConfig
  pipeline: PipelineConfig
}

export class ConfigError extends Error {}

export function readConfigFile<T>(dir: string, file: string, schema: z.ZodType<T>): T {
  const path = join(dir, file)
  let raw: unknown
  try {
    raw = parseYaml(readFileSync(path, 'utf8'))
  } catch (e) {
    throw new ConfigError(`Could not read ${file}: ${(e as Error).message}`)
  }
  const parsed = schema.safeParse(raw)
  if (!parsed.success) {
    const issues = parsed.error.issues.map(i => `${i.path.join('.') || '(root)'}: ${i.message}`).join('; ')
    throw new ConfigError(`Invalid ${file}: ${issues}`)
  }
  return parsed.data
}

let cached: StudioConfig | null = null

export function loadConfig(dir = resolve(process.cwd(), 'config')): StudioConfig {
  if (cached && dir === resolve(process.cwd(), 'config')) return cached
  const cfg: StudioConfig = {
    models: readConfigFile(dir, 'models.yaml', modelsSchema),
    pricebook: readConfigFile(dir, 'pricebook.yaml', pricebookSchema),
    budgets: readConfigFile(dir, 'budgets.yaml', budgetsSchema),
    routing: readConfigFile(dir, 'routing.yaml', routingSchema),
    runtime: readConfigFile(dir, 'runtime.yaml', runtimeSchema),
    pipeline: {
      sheet: readConfigFile(dir, 'sheet.yaml', pipelineSchemas.sheet),
      views: readConfigFile(dir, 'views.yaml', pipelineSchemas.views),
      rules: readConfigFile(dir, 'rules.yaml', pipelineSchemas.rules),
      templates: readConfigFile(dir, 'templates.yaml', pipelineSchemas.templates),
      review: readConfigFile(dir, 'review.yaml', pipelineSchemas.review),
      scenes: readConfigFile(dir, 'scenes.yaml', pipelineSchemas.scenes),
    },
  }
  validateCrossRefs(cfg)
  if (dir === resolve(process.cwd(), 'config')) cached = cfg
  return cfg
}

// Checks that references between files line up (routes point at real models,
// every priced model exists, the sheet graph is well formed).
function validateCrossRefs(cfg: StudioConfig): void {
  const imageRefs = new Set(cfg.models.models.map(m => m.ref))
  const llmRefs = new Set(cfg.models.llm_models.map(m => m.ref))
  for (const [task, route] of Object.entries(cfg.routing.tasks)) {
    if (!imageRefs.has(route.model) && !llmRefs.has(route.model)) {
      throw new ConfigError(`routing.yaml: task "${task}" points at unknown model "${route.model}"`)
    }
  }
  for (const ref of Object.values(cfg.routing.mock)) {
    if (!imageRefs.has(ref) && !llmRefs.has(ref)) throw new ConfigError(`routing.yaml: unknown mock model "${ref}"`)
  }
  for (const v of cfg.pipeline.sheet.shots.map(s => s.view)) {
    if (!cfg.pipeline.views.views[v]) throw new ConfigError(`sheet.yaml: unknown view "${v}"`)
  }
  const sc = cfg.pipeline.scenes.settings
  for (const ref of [...sc.still_models, ...sc.edit_models, sc.upscale_model]) {
    if (!imageRefs.has(ref)) throw new ConfigError(`scenes.yaml: unknown model "${ref}"`)
  }
  const expressions = new Set(cfg.pipeline.sheet.shots.map(s => s.expression))
  for (const e of cfg.pipeline.scenes.expressions) {
    if (e.ref_expression && !expressions.has(e.ref_expression)) throw new ConfigError(`scenes.yaml: expression "${e.id}" points at "${e.ref_expression}", which no sheet shot has`)
  }
  try { new RegExp(cfg.pipeline.scenes.color_triggers, 'i') } catch { throw new ConfigError('scenes.yaml: color_triggers is not a valid pattern') }
}

export function resetConfigCache(): void { cached = null }
