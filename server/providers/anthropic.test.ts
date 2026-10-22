import { describe, expect, it } from 'vitest'
import { apiSchema } from './anthropic.js'
import { loadConfig } from '../config/load.js'
import { reviewerJsonSchema, tagsJsonSchema, voiceJsonSchema, writerJsonSchema, type LineBankConfig } from '../core/lineBank.js'
import { draftJsonSchema, generalHooksJsonSchema, hooksJsonSchema, reviewJsonSchema, variationsJsonSchema } from '../pipeline/slideshow.js'
import { captionsJsonSchema, slidesJsonSchema } from '../pipeline/content.js'
import { variantsJsonSchema } from '../pipeline/scaleKit.js'

// Structured output takes a subset of JSON Schema (production, 2026-10-22:
// "For 'array' type, 'minItems' values other than 0 or 1 are not
// supported"). Every schema the Studio sends goes through apiSchema first.

function arrayRules(schema: unknown, path = '$'): string[] {
  if (Array.isArray(schema)) return schema.flatMap((s, i) => arrayRules(s, `${path}[${i}]`))
  if (!schema || typeof schema !== 'object') return []
  const s = schema as Record<string, unknown>
  const bad = [
    typeof s.minItems === 'number' && s.minItems > 1 ? `${path}.minItems=${s.minItems}` : null,
    'maxItems' in s ? `${path}.maxItems` : null,
  ].filter((x): x is string => !!x)
  return [...bad, ...Object.entries(s).flatMap(([k, v]) => arrayRules(v, `${path}.${k}`))]
}

const cfg = loadConfig()
const bank = cfg.pipeline.content.line_bank as LineBankConfig

describe('the schemas sent to Anthropic', () => {
  const schemas: Record<string, unknown> = {
    tags: tagsJsonSchema(30, bank, ['a pain']), writer: writerJsonSchema(30), reviewer: reviewerJsonSchema(30), voice: voiceJsonSchema(5),
    hooks: hooksJsonSchema(10), generalHooks: generalHooksJsonSchema(10), hookReview: reviewJsonSchema(10),
    draft: draftJsonSchema(6, 5, ['window'], null), variations: variationsJsonSchema(3, 5, 5),
    slides: slidesJsonSchema(5, [3, 5]), captions: captionsJsonSchema(8), variants: variantsJsonSchema(4),
  }
  it('the builders keep their exact counts (they say what the prompt asks for)', () => {
    expect(arrayRules(schemas.tags)).toContain('$.properties.tags.minItems=30')
  })
  for (const [name, schema] of Object.entries(schemas)) {
    it(`${name}: no array rule Anthropic refuses`, () => {
      expect(arrayRules(apiSchema(schema))).toEqual([])
    })
  }
  it('an exact-size list stays a list (an object with 30 keys is refused as too large) and says its count', () => {
    const sent = apiSchema(tagsJsonSchema(30, bank, ['a pain'])) as { properties: { tags: { type: string; minItems: number; description: string } } }
    expect(sent.properties.tags).toMatchObject({ type: 'array', minItems: 1 })
    expect(sent.properties.tags.description).toMatch(/Exactly 30 entries/)
    // The schema sent stays small: one copy of the item, not thirty.
    expect(JSON.stringify(sent).split('"emotion":{').length - 1).toBe(1)
  })

  it('a double quote in an enum value goes as a single quote (sent as is, it came back unescaped and broke the JSON)', () => {
    expect(apiSchema({ type: 'string', enum: ['lowball pay and "competitive" salary', 'none'] })).toEqual({ type: 'string', enum: ["lowball pay and 'competitive' salary", 'none'] })
  })

  it('keeps everything else, and a minItems of 1 or 0', () => {
    expect(apiSchema({ type: 'array', minItems: 1, maxItems: 4, items: { type: 'string', enum: ['a'] } })).toEqual({ type: 'array', minItems: 1, items: { type: 'string', enum: ['a'] } })
    expect(apiSchema({ type: 'array', minItems: 0, items: { type: 'string' } })).toEqual({ type: 'array', items: { type: 'string' } })
    expect(apiSchema({ type: 'object', additionalProperties: false, required: ['x'], properties: { x: { type: 'array', minItems: 6, items: { type: 'integer' } } } }))
      .toEqual({ type: 'object', additionalProperties: false, required: ['x'], properties: { x: { type: 'array', minItems: 1, items: { type: 'integer' } } } })
    // A range (not an exact size) keeps a list: at least one item.
    expect(apiSchema({ type: 'array', minItems: 3, maxItems: 5, items: { type: 'string' } })).toEqual({ type: 'array', minItems: 1, items: { type: 'string' } })
  })
})
