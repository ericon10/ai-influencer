import { and, eq, isNull } from 'drizzle-orm'
import { products, socialAccounts } from '../db/schema.js'
import type { Ctx, Deps } from '../context.js'
import { notFound } from '../lib/errors.js'

// Products (owner, 2026-10-17; UX-PLAN.md section 29): every post belongs to
// one product, or none. Every post is written to the general standard; what
// belongs to a product (its hook vault, buyer language and claims sheet,
// the rules it adds on top and their language notes) follows the post's
// product and nothing else. Never "the first product". Whether a post is an
// ad for its product is separate: the post's #ad switch (a plan row's
// product column).

type ProductRow = typeof products.$inferSelect

// The rules a product adds on top of the general standard: a key of
// writing_standards in config/content.yaml ("sidestep"), or none. Its
// templates are the ones named with its key first in config/templates.yaml
// ("sidestep_slideshow_hooks"); the general standard uses the unprefixed
// ones.
export interface WritingStandard { key: string; label: string; review: boolean; lint: boolean; endings: boolean; structures: boolean }
// A product that adds no rules (and a post with no product) is written to
// the general standard alone (the unprefixed templates).
export const GENERAL_LABEL = 'General standard'

export function writingStandards(deps: Deps): WritingStandard[] {
  return Object.entries(deps.config.pipeline.content.writing_standards).map(([key, s]) => ({ key, label: s.label, review: s.review, lint: s.lint, endings: s.endings, structures: s.structures }))
}

export function standardOf(deps: Deps, writing: string | null | undefined): WritingStandard | null {
  if (!writing) return null
  return writingStandards(deps).find(s => s.key === writing) ?? null
}

// The rules a product starts with when it is made (a kit import): the
// standard that names it, else none. The owner changes it on its card.
export function writingForName(deps: Deps, name: string): string {
  const n = name.trim().toLowerCase()
  const hit = Object.entries(deps.config.pipeline.content.writing_standards).find(([, s]) => s.names.some(x => x.trim().toLowerCase() === n))
  return hit?.[0] ?? ''
}

// A template under a standard: its own version when it has one, else the
// plain one. `name` is a key of config/templates.yaml.
export function templateFor<K extends keyof Deps['config']['pipeline']['templates']>(deps: Deps, std: WritingStandard | null, name: K): Deps['config']['pipeline']['templates'][K] {
  const t = deps.config.pipeline.templates as Record<string, unknown>
  return ((std && t[`${std.key}_${String(name)}`]) ?? t[name as string]) as Deps['config']['pipeline']['templates'][K]
}

// The post's product (null: none, archived or another account's).
export async function productOf(deps: Deps, ctx: Ctx, productId: string | null | undefined): Promise<ProductRow | null> {
  if (!productId) return null
  const [row] = await deps.db.select().from(products).where(and(eq(products.accountId, ctx.accountId), eq(products.id, productId)))
  return row && !row.archivedAt ? row : null
}

// A product id the owner picked must be one of this account's live ones.
export async function checkProduct(deps: Deps, ctx: Ctx, productId: string | null | undefined): Promise<string | null> {
  if (!productId) return null
  const row = await productOf(deps, ctx, productId)
  if (!row) throw notFound('Product')
  return row.id
}

// The product and writing rules a post follows.
export async function postWriting(deps: Deps, ctx: Ctx, productId: string | null | undefined): Promise<{ product: ProductRow | null; std: WritingStandard | null }> {
  const product = await productOf(deps, ctx, productId)
  return { product, std: product ? standardOf(deps, product.writing) : null }
}

// A new post's product: its account's (Posts home > Accounts), else none.
// No account has a product until the owner sets it there.
export async function defaultProductFor(deps: Deps, ctx: Ctx, tag: string | null | undefined): Promise<string | null> {
  const t = (tag ?? '').trim()
  if (!t) return null
  const [acct] = await deps.db.select({ productId: socialAccounts.productId }).from(socialAccounts).where(and(eq(socialAccounts.accountId, ctx.accountId), eq(socialAccounts.tag, t)))
  return acct?.productId ? (await productOf(deps, ctx, acct.productId))?.id ?? null : null
}

// A post's product by id and name, for post.json (section 42 E).
export async function productRef(deps: Deps, ctx: Ctx, productId: string | null): Promise<{ id: string; name: string } | null> {
  if (!productId) return null
  const [p] = await deps.db.select({ id: products.id, name: products.name }).from(products).where(and(eq(products.accountId, ctx.accountId), eq(products.id, productId)))
  return p ?? null
}
