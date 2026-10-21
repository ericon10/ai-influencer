import type { Ctx, Deps } from '../context.js'
import { DEFAULT_LINT_LISTS, LINT_RULE_IDS, type LintLists } from '../core/copyLint.js'
import { listCharacters } from './characters.js'
import { switchesReader } from './rules.js'

// The language lint's settings (UX-PLAN.md section 28): the word lists from
// config/content.yaml and which checks are switched off, for the whole
// account and per character (Settings > Rules). The browser runs the checks
// as you type with these; the server runs the same ones on the plan import.

export const LINT_SWITCH_IDS = [...LINT_RULE_IDS, 'structure-repeat'] as const

export function lintLists(deps: Deps): LintLists {
  const cl = deps.config.pipeline.content.copy_lint
  return { values: cl.values, hype: cl.hype, products: cl.products, maxHashtags: cl.max_hashtags, hookMaxWords: cl.hook_max_words, hookLabels: cl.hook_labels, jobWords: cl.job_words, endingNever: cl.ending_never, setupOpeners: cl.setup_openers ?? DEFAULT_LINT_LISTS.setupOpeners, emotionWords: cl.emotion_words ?? DEFAULT_LINT_LISTS.emotionWords }
}

export async function lintSettings(deps: Deps, ctx: Ctx): Promise<{ lists: LintLists; off: string[]; offFor: Record<string, string[]> }> {
  const read = await switchesReader(deps, ctx)
  const global = read(null)
  const offFor: Record<string, string[]> = {}
  for (const c of await listCharacters(deps, ctx)) {
    const sw = read(c.id)
    const off = LINT_SWITCH_IDS.filter(id => !sw.on(id))
    if (off.length) offFor[c.id] = off
  }
  return { lists: lintLists(deps), off: LINT_SWITCH_IDS.filter(id => !global.on(id)), offFor }
}

// What the server checks with, for one character (or the account).
export async function lintFor(deps: Deps, ctx: Ctx, characterId?: string | null): Promise<{ lists: LintLists; off: string[]; on: (id: string) => boolean }> {
  const sw = (await switchesReader(deps, ctx))(characterId ?? null)
  return { lists: lintLists(deps), off: LINT_SWITCH_IDS.filter(id => !sw.on(id)), on: id => sw.on(id) }
}
