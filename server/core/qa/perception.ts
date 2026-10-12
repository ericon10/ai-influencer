import { z } from 'zod'

// The structured answer of the QA perception call. Every position is
// relative to the image as displayed; code, not the model, translates image
// sides into the character's own sides.

const imageSide = z.enum(['image_left', 'image_right'])

export const observationSchema = z.object({
  pose: z.enum(['frontal', 'three_quarter', 'profile', 'back', 'unclear']),
  nose: z.enum(['image_left', 'image_right', 'toward_camera', 'away', 'unclear']),
  confidence: z.number().min(0).max(1),
  framing: z.enum(['chest_up', 'waist_up', 'three_quarter_length', 'full_body', 'seated', 'unclear']),
  standing: z.boolean(),
  ears: z.array(z.object({ image_side: imageSide, jewelry: z.boolean(), jewelry_description: z.string() })),
  skin_marks: z.array(z.object({ image_side: z.enum(['image_left', 'image_right', 'center']), location: z.string(), description: z.string() })),
  other_jewelry: z.array(z.object({ image_side: z.enum(['image_left', 'image_right', 'center']), description: z.string() })),
  eye_color: z.string(),
  text_or_logos: z.array(z.string()),
  artifacts: z.array(z.string()),
  notes: z.string(),
})

export type Observation = z.infer<typeof observationSchema>

export function parseObservation(raw: unknown): Observation {
  const { _about: _a, ...rest } = (raw ?? {}) as Record<string, unknown>
  return observationSchema.parse(rest)
}

// JSON Schema sent with the request (structured outputs).
export const observationJsonSchema: Record<string, unknown> = {
  type: 'object',
  additionalProperties: false,
  required: ['pose', 'nose', 'confidence', 'framing', 'standing', 'ears', 'skin_marks', 'other_jewelry', 'eye_color', 'text_or_logos', 'artifacts', 'notes'],
  properties: {
    pose: { type: 'string', enum: ['frontal', 'three_quarter', 'profile', 'back', 'unclear'] },
    nose: { type: 'string', enum: ['image_left', 'image_right', 'toward_camera', 'away', 'unclear'] },
    confidence: { type: 'number' },
    framing: { type: 'string', enum: ['chest_up', 'waist_up', 'three_quarter_length', 'full_body', 'seated', 'unclear'] },
    standing: { type: 'boolean' },
    ears: {
      type: 'array',
      items: {
        type: 'object', additionalProperties: false, required: ['image_side', 'jewelry', 'jewelry_description'],
        properties: { image_side: { type: 'string', enum: ['image_left', 'image_right'] }, jewelry: { type: 'boolean' }, jewelry_description: { type: 'string' } },
      },
    },
    skin_marks: {
      type: 'array',
      items: {
        type: 'object', additionalProperties: false, required: ['image_side', 'location', 'description'],
        properties: { image_side: { type: 'string', enum: ['image_left', 'image_right', 'center'] }, location: { type: 'string' }, description: { type: 'string' } },
      },
    },
    other_jewelry: {
      type: 'array',
      items: {
        type: 'object', additionalProperties: false, required: ['image_side', 'description'],
        properties: { image_side: { type: 'string', enum: ['image_left', 'image_right', 'center'] }, description: { type: 'string' } },
      },
    },
    eye_color: { type: 'string' },
    text_or_logos: { type: 'array', items: { type: 'string' } },
    artifacts: { type: 'array', items: { type: 'string' } },
    notes: { type: 'string' },
  },
}
