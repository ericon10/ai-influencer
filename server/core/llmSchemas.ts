import { z } from 'zod'
import { markSchema, pronounsSchema } from './character.js'

// Structured outputs for the LLM steps. The JSON Schema goes to the model;
// the Zod schema re-validates the answer before anything is stored.

const markJson = {
  type: 'object', additionalProperties: false, required: ['name', 'description', 'side', 'region', 'kind'],
  properties: {
    name: { type: 'string' }, description: { type: 'string' },
    side: { type: 'string', enum: ['LEFT', 'RIGHT'] },
    region: { type: 'string', enum: ['brow', 'eye', 'cheek', 'ear', 'lip', 'jaw', 'neck', 'nose', 'temple', 'forehead', 'chin'] },
    kind: { type: 'string', enum: ['skin', 'jewelry'] },
  },
}

export const breakdownSchema = z.object({
  keep: z.array(z.object({ aspect: z.string(), detail: z.string() })),
  change: z.array(z.object({ feature: z.string(), observed: z.string(), direction: z.string() })),
  vibe: z.string(),
  cautions: z.array(z.string()),
})
export type Breakdown = z.infer<typeof breakdownSchema>

export const breakdownJsonSchema = {
  type: 'object', additionalProperties: false, required: ['keep', 'change', 'vibe', 'cautions'],
  properties: {
    keep: { type: 'array', items: { type: 'object', additionalProperties: false, required: ['aspect', 'detail'], properties: { aspect: { type: 'string' }, detail: { type: 'string' } } } },
    change: { type: 'array', items: { type: 'object', additionalProperties: false, required: ['feature', 'observed', 'direction'], properties: { feature: { type: 'string' }, observed: { type: 'string' }, direction: { type: 'string' } } } },
    vibe: { type: 'string' },
    cautions: { type: 'array', items: { type: 'string' } },
  },
}

export const conceptSchema = z.object({
  name: z.string(),
  age: z.number().int(),
  card: z.string(),
  features: z.record(z.string(), z.string()).default({}),
  marks: z.array(markSchema),
  body: z.string(),
  style: z.string(),
  vibe: z.string(),
  pronouns: pronounsSchema,
})
export const conceptsSchema = z.object({ concepts: z.array(conceptSchema) })
export type Concept = z.infer<typeof conceptSchema>

export const conceptsJsonSchema = {
  type: 'object', additionalProperties: false, required: ['concepts'],
  properties: {
    concepts: {
      type: 'array',
      items: {
        type: 'object', additionalProperties: false, required: ['name', 'age', 'card', 'eyes', 'marks', 'body', 'style', 'vibe', 'pronouns'],
        properties: {
          name: { type: 'string' }, age: { type: 'integer' }, card: { type: 'string' }, eyes: { type: 'string' },
          marks: { type: 'array', items: markJson },
          body: { type: 'string' }, style: { type: 'string' }, vibe: { type: 'string' },
          pronouns: { type: 'object', additionalProperties: false, required: ['subj', 'obj', 'poss', 'noun'], properties: { subj: { type: 'string' }, obj: { type: 'string' }, poss: { type: 'string' }, noun: { type: 'string' } } },
        },
      },
    },
  },
}

export const cardUpdateSchema = z.object({
  differences: z.array(z.object({ field: z.string(), card_says: z.string(), image_shows: z.string() })),
  card: z.string(),
  marks: z.array(markSchema),
})
export type CardUpdate = z.infer<typeof cardUpdateSchema>

export const cardUpdateJsonSchema = {
  type: 'object', additionalProperties: false, required: ['differences', 'card', 'marks'],
  properties: {
    differences: { type: 'array', items: { type: 'object', additionalProperties: false, required: ['field', 'card_says', 'image_shows'], properties: { field: { type: 'string' }, card_says: { type: 'string' }, image_shows: { type: 'string' } } } },
    card: { type: 'string' },
    marks: { type: 'array', items: markJson },
  },
}
