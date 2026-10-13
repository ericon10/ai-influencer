import type { Ctx, Deps } from '../context.js'
import type { RulesConfig } from '../config/pipeline.js'
import type { RuleSwitches } from '../core/rules.js'
import { AppError } from '../lib/errors.js'
import { getSetting, setSetting } from './settings.js'
import { getCharacter } from './characters.js'

// Rule switches (Settings, Rules; owner ruling G1). Fixed rules are always
// on. A default is on unless switched off, for all characters (global) or
// for one character, which wins over global. Some defaults carry an
// editable value (the sheet background).

export const RULE_SWITCHES_KEY = 'rule_switches'

export interface RuleSetting { on?: boolean; value?: string }
interface Stored { global?: Record<string, RuleSetting>; characters?: Record<string, Record<string, RuleSetting>> }

export function makeSwitches(rules: RulesConfig, stored: Stored, characterId?: string | null): RuleSwitches {
  const byId = new Map(rules.rules.map(r => [r.id, r]))
  const pick = (id: string): RuleSetting => ({ ...(stored.global?.[id] ?? {}), ...((characterId && stored.characters?.[characterId]?.[id]) || {}) })
  return {
    on(id) {
      const rule = byId.get(id)
      if (!rule || rule.bucket === 'fixed') return true
      return pick(id).on ?? true
    },
    value(id) {
      const rule = byId.get(id)
      if (!rule) return undefined
      return pick(id).value ?? rule.value
    },
  }
}

async function readStored(deps: Deps, ctx: Ctx): Promise<Stored> {
  return getSetting<Stored>(deps.db, ctx.accountId, RULE_SWITCHES_KEY, {})
}

export async function ruleSwitches(deps: Deps, ctx: Ctx, characterId?: string | null): Promise<RuleSwitches> {
  return makeSwitches(deps.config.pipeline.rules, await readStored(deps, ctx), characterId)
}

// `on: null` (or `value: null`) clears the setting, so it follows global
// (for a character) or the built-in default (for global).
export async function setRuleSwitch(deps: Deps, ctx: Ctx, input: { ruleId: string; characterId?: string | null; on?: boolean | null; value?: string | null }): Promise<void> {
  const rule = deps.config.pipeline.rules.rules.find(r => r.id === input.ruleId)
  if (!rule) throw new AppError('bad_request', `Unknown rule "${input.ruleId}".`)
  if (rule.bucket === 'fixed') throw new AppError('bad_request', `"${rule.title}" is a fixed rule and is always on.`)
  if (input.value !== undefined && input.value !== null && rule.value === undefined) throw new AppError('bad_request', `"${rule.title}" has no value to edit.`)
  if (input.characterId) await getCharacter(deps, ctx, input.characterId)
  const stored = await readStored(deps, ctx)
  const scope: Record<string, RuleSetting> = input.characterId ? { ...(stored.characters?.[input.characterId] ?? {}) } : { ...(stored.global ?? {}) }
  const next: RuleSetting = { ...(scope[rule.id] ?? {}) }
  if (input.on !== undefined) { if (input.on === null) delete next.on; else next.on = input.on }
  if (input.value !== undefined) { if (input.value === null || !input.value.trim()) delete next.value; else next.value = input.value.trim().slice(0, 400) }
  if (Object.keys(next).length) scope[rule.id] = next
  else delete scope[rule.id]
  const out: Stored = input.characterId
    ? { ...stored, characters: { ...(stored.characters ?? {}), [input.characterId]: scope } }
    : { ...stored, global: scope }
  await setSetting(deps, ctx, RULE_SWITCHES_KEY, out)
}

const AREA_LABEL: Record<string, string> = {
  safety: 'Safety', realism: 'Realism', money: 'Money and keys', character: 'Character', hero: 'Hero', sheet: 'Reference sheet',
  scene: 'Scenes', qa: 'Automatic QA', edit: 'Edits and models', video: 'Video', copy: 'Copy',
}

// Every rule with its bucket and where it stands, for all characters and
// (when asked) for one.
export async function rulesView(deps: Deps, ctx: Ctx, characterId?: string | null) {
  const stored = await readStored(deps, ctx)
  const global = makeSwitches(deps.config.pipeline.rules, stored)
  const one = characterId ? makeSwitches(deps.config.pipeline.rules, stored, characterId) : null
  return {
    areas: AREA_LABEL,
    rules: deps.config.pipeline.rules.rules.map(r => ({
      id: r.id, title: r.title, bucket: r.bucket, area: r.area, spec: r.spec, message: r.message,
      defaultValue: r.value ?? null,
      global: { on: global.on(r.id), value: r.value !== undefined ? global.value(r.id) ?? null : null, set: stored.global?.[r.id]?.on !== undefined },
      character: one ? {
        on: one.on(r.id), value: r.value !== undefined ? one.value(r.id) ?? null : null,
        set: stored.characters?.[characterId!]?.[r.id]?.on !== undefined, valueSet: stored.characters?.[characterId!]?.[r.id]?.value !== undefined,
      } : null,
    })),
  }
}
