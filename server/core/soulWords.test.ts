import { describe, expect, it } from 'vitest'
import { loadConfig } from '../config/load.js'
import type { Deps } from '../context.js'
import { dropMentions } from './text.js'
import { finalizeImagePrompt, NO_PERSON_REALISM } from './realism.js'
import { facelessFinal, facelessStillPrompt } from './faceless.js'
import { withModelLines } from '../pipeline/sceneActions.js'

// Soul draws whatever words it is given, even negated ones (owner,
// 2026-10-21 on 100 faceless stills; 2026-10-22 the test mug came back with
// gibberish text and a watermark box). Soul prompts never name text,
// letters, labels, logos or watermarks in any form.

const cfg = loadConfig()
const deps = { config: cfg } as unknown as Deps
const soul = cfg.models.models.find(m => m.ref === 'higgsfield/soul-2')!
const NEVER = /\b(?:texts?|letters?|lettering|labels?|label(?:l)?ed|logos?|watermarks?|writing|written|words|captions?|typography|signage|signs?)\b/i

describe('words Soul never sees', () => {
  it('Soul\'s entry lists them; other models keep theirs', () => {
    expect(soul.prompt_never).toEqual(expect.arrayContaining(['text', 'letters', 'labels', 'logos', 'watermarks']))
    expect(cfg.models.models.find(m => m.ref === 'higgsfield/gpt-image-2.5')?.prompt_never ?? []).toEqual([])
  })

  it('an AVOID item, a clause or a whole sentence that names one comes out; the rest stays as written', () => {
    expect(dropMentions('A mug on a table.\nAVOID: a CGI look, studio lighting, text, watermarks.', soul.prompt_never)).toBe('A mug on a table.\nAVOID: a CGI look, studio lighting.')
    expect(dropMentions('A kitchen counter, a cereal box with its label, a fruit bowl. Soft light.', soul.prompt_never)).toBe('A kitchen counter, a fruit bowl. Soft light.')
    expect(dropMentions('No text anywhere. A quiet street at dusk.', soul.prompt_never)).toBe('A quiet street at dusk.')
    expect(dropMentions('AVOID: text, watermarks.\nA porch.', soul.prompt_never)).toBe('A porch.')
    // "textures" is not "text"; nothing changes when nothing is named.
    const plain = 'Real textures, uneven everyday light.\n\nA porch at night.'
    expect(dropMentions(plain, soul.prompt_never)).toBe(plain)
  })

  it('the Soul model test (the mug): no such word anywhere, the REALISM line kept', () => {
    const prompt = dropMentions(finalizeImagePrompt('A plain white ceramic mug on a wooden table, soft daylight, simple photo.', { person: false, plainLine: cfg.pipeline.templates.slideshow_topic_realism }).prompt, soul.prompt_never)
    expect(prompt).not.toMatch(NEVER)
    expect(prompt).toMatch(/\nREALISM: A real phone photo/)
    expect(prompt).toMatch(/\nAVOID: a CGI or 3D render look, studio lighting\.$/)
  })

  it('a character still on Soul (withModelLines): the AVOID block loses text and watermarks', () => {
    const built = finalizeImagePrompt('She laughs at her laptop at the kitchen table.').prompt
    expect(built).toMatch(/text, watermarks/)
    const sent = withModelLines(deps, 'higgsfield/soul-2', built)
    expect(sent).not.toMatch(NEVER)
    expect(sent).toMatch(/AVOID: airbrushed or plastic skin/)
    // Another model keeps the AVOID block as it was.
    expect(withModelLines(deps, 'higgsfield/nano-banana-2.1', built)).toMatch(/text, watermarks/)
  })

  it('a faceless still on Soul: none of the words, the faceless ending still last', () => {
    const body = facelessStillPrompt({ line: 'a gas station at night, the price sign glowing, wet asphalt' }).prompt
    const sent = dropMentions(facelessFinal(body, NO_PERSON_REALISM), soul.prompt_never)
    expect(sent).not.toMatch(NEVER)
    expect(sent).toMatch(/^A gas station at night, wet asphalt\./)
    expect(sent.endsWith('Level, unedited. Sharp, real phone grain, muted color. No people.')).toBe(true)
  })
})
