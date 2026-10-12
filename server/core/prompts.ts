import type { SheetShot, TemplatesConfig, ViewDef, ViewsConfig } from '../config/pipeline'
import type { CharacterData, Pronouns } from './character'
import { imageSideOf, markExpectation, otherSide, regionVisible, type Mark } from './marks'
import { capitalize, fill, normalizePrompt } from './text'

// Prompts are filled by code from templates and the character record
// (SPEC 9: never written from scratch by an LLM).

function pronounVars(p: Pronouns): Record<string, string> {
  return { subj: p.subj, obj: p.obj, poss: p.poss, noun: p.noun, Subj: capitalize(p.subj), Poss: capitalize(p.poss), Obj: capitalize(p.obj) }
}

function markPhrase(t: TemplatesConfig, m: Mark, poss: string): string {
  const relation = t.relations[m.region] ?? 'on'
  return `${m.description} ${relation} ${poss} ${m.side} ${m.region}`
}

// Side-specific mark lines for one view (SPEC 5.1 rule 11): visible marks
// say where they are, hidden marks are stated as hidden, and the opposite
// side is declared clean so the model does not mirror them. Marks sharing a
// side and visibility are grouped into one sentence.
export function markLines(t: TemplatesConfig, view: ViewDef, marks: Mark[], p: Pronouns): string {
  const pv = pronounVars(p)
  const groups = new Map<string, Mark[]>()
  for (const m of marks) {
    const key = `${markExpectation(view, m)}|${m.side}`
    groups.set(key, [...(groups.get(key) ?? []), m])
  }
  const lines: string[] = []
  for (const [key, group] of groups) {
    const [exp, side] = key.split('|') as ['required' | 'optional' | 'hidden', Mark['side']]
    const phrases = group.map(m => markPhrase(t, m, p.poss))
    const plural = group.length > 1
    const vars = {
      ...pv, side, image_side: imageSideOf(side, view.facing),
      mark: phrases.length > 2 ? `${phrases.slice(0, -1).join(', ')}, and the ${phrases.at(-1)}` : phrases.join(' and the '),
      is: plural ? 'are' : 'is', it: plural ? 'they' : 'it', appears: plural ? 'appear' : 'appears', stays: plural ? 'stay' : 'stays',
    }
    const template = exp === 'required'
      ? (view.turn === 'none' && view.facing === 'camera' ? t.marks.required_front_hint : t.marks.required)
      : exp === 'optional' ? t.marks.optional : t.marks.hidden
    lines.push(fill(template, vars))
  }
  for (const m of marks) {
    const exp = markExpectation(view, m)
    const otherHasSame = marks.some(x => x !== m && x.region === m.region && x.kind === m.kind && x.side === otherSide(m.side))
    const otherShows = regionVisible(view, otherSide(m.side), m.region)
    if (otherShows && !otherHasSame && (m.kind === 'jewelry' || exp === 'hidden')) {
      lines.push(fill(t.marks.other_clean, { ...pv, side: m.side, other: otherSide(m.side), region: m.region, name: m.name, kind_noun: t.kind_nouns[m.kind] ?? 'mark' }))
    }
  }
  return lines.join(' ')
}

function cardPhrase(card: string, noun: string): string {
  const c = card.trim().replace(/\.$/, '')
  return /^\d/.test(c) ? `a ${noun}, ${c}` : c
}

export function buildHeroPrompts(t: TemplatesConfig, views: ViewsConfig, ch: Pick<CharacterData, 'card' | 'marks' | 'pronouns'>): string[] {
  const front = views.views.front!
  const marks = markLines(t, front, ch.marks, ch.pronouns)
  return t.hero.variants.map(variant => normalizePrompt(fill(t.hero.base, {
    ...pronounVars(ch.pronouns), card: cardPhrase(ch.card, ch.pronouns.noun), variant, marks,
  })))
}

export function buildSheetPrompt(t: TemplatesConfig, views: ViewsConfig, shot: SheetShot, ch: Pick<CharacterData, 'marks' | 'pronouns' | 'body'>, addendum = ''): string {
  const view = views.views[shot.view]
  if (!view) throw new Error(`Unknown view "${shot.view}" for ${shot.id}.`)
  const pv = pronounVars(ch.pronouns)
  const expression = t.expressions[shot.expression] ?? ''
  const body = shot.framing === 'full_body' ? fill(t.body_line, { ...pv, body: ch.body }) : ''
  const prompt = fill(t.sheet.base, {
    ...pv,
    framing: t.framing[shot.framing]!,
    view: fill(view.prompt, pv),
    marks: markLines(t, view, ch.marks, ch.pronouns),
    expression: expression ? `${expression} ` : '',
    body: body ? `${body} ` : '',
    outfit: t.outfit[shot.framing]!,
  })
  return normalizePrompt(addendum ? `${prompt} ${addendum}` : prompt)
}
