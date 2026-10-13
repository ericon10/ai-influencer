import { describe, expect, it } from 'vitest'
import { loadConfig } from '../config/load.js'
import { modelLabel } from './quotes.js'

// The model name shown next to each price.

describe('modelLabel', () => {
  const deps = { config: loadConfig() }
  it('names Claude and Higgsfield models as people know them', () => {
    expect(modelLabel(deps, 'anthropic/claude-sonnet-5-5')).toBe('Claude Sonnet 5.5')
    expect(modelLabel(deps, 'anthropic/claude-opus-5-5')).toBe('Claude Opus 5.5')
    expect(modelLabel(deps, 'higgsfield/nano-banana-2.1')).toBe(deps.config.models.models.find(m => m.ref === 'higgsfield/nano-banana-2.1')!.label)
  })
  it('says when a demo mock runs, and falls back to the ref', () => {
    expect(modelLabel(deps, 'mock/llm')).toBe('Demo mock, free')
    expect(modelLabel(deps, 'other/unknown')).toBe('other/unknown')
  })
})
