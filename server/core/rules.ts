import type { Rule, RulesConfig } from '../config/pipeline.js'
import type { GenRequest } from '../providers/types.js'
import type { Mark } from './marks.js'
import { BARE_FACE_LINE, findBannedTerms, findMakeupTerms, hasRealismBlock, isBareFaceStage } from './realism.js'
import { EXPLICIT_MESSAGE, findExplicitTerms } from './safety.js'

// The rules engine (SPEC 5). Rules are data (config/rules.yaml); this file
// only knows how to evaluate each check type against a prompt and request.

// Which rules are on (Settings, Rules), for all characters or one. Fixed
// rules are always on; a default is on unless switched off. A default never
// blocks: its violations are warnings (owner ruling G1).
export interface RuleSwitches {
  on(id: string): boolean
  value(id: string): string | undefined
}

export const ALL_DEFAULTS_ON: RuleSwitches = { on: () => true, value: () => undefined }

export interface RuleContext {
  switches?: RuleSwitches
  stage?: string
  framing?: string
  kind?: string
  request?: Partial<GenRequest>
  sheetLock?: { model: string } | null
  // The prompt block of the saved identity this request uses, if any.
  identityBlock?: string
  aspectByFraming?: Record<string, string>
  marks?: Mark[]
}

export interface RuleViolation {
  ruleId: string
  spec: string
  title: string
  severity: 'error' | 'warning'
  message: string
  match?: string
}

function applies(rule: Rule, ctx: RuleContext): boolean {
  const w = rule.when
  if (w.stage && (!ctx.stage || !w.stage.includes(ctx.stage))) return false
  if (w.framing && (!ctx.framing || !w.framing.includes(ctx.framing))) return false
  if (w.kind && (!ctx.kind || !w.kind.includes(ctx.kind))) return false
  return true
}

function attachments(req?: Partial<GenRequest>): number {
  if (!req) return 0
  return (req.refs?.length ?? 0) + (req.startFrame ? 1 : 0) + (req.endFrame ? 1 : 0) + (req.sourceVideo ? 1 : 0)
}

function check(rule: Rule, prompt: string, ctx: RuleContext): string | null | undefined {
  const c = rule.check
  switch (c.type) {
    case 'forbid_pattern': {
      const text = c.exclude_after ? prompt.split(c.exclude_after)[0]! : prompt
      const m = text.match(new RegExp(c.pattern, c.flags))
      return m ? m[0] : null
    }
    case 'require_phrase':
      return prompt.toLowerCase().includes(c.phrase.toLowerCase()) ? null : `missing "${c.phrase}"`
    case 'forbid_char':
      return prompt.includes(String.fromCodePoint(c.codepoint)) ? String.fromCodePoint(c.codepoint) : null
    case 'no_attachments':
      return attachments(ctx.request) > 0 ? `${attachments(ctx.request)} attachment(s)` : null
    case 'requires_start_frame':
      return ctx.request?.startFrame ? null : 'no start frame'
    case 'request_fields': {
      for (const [field, allowed] of Object.entries(c.require)) {
        const v = (ctx.request as Record<string, unknown> | undefined)?.[field]
        if (!allowed.includes(v as string | number | boolean)) return `${field}=${String(v)}`
      }
      return null
    }
    case 'aspect_matches_framing': {
      const want = ctx.framing ? ctx.aspectByFraming?.[ctx.framing] : undefined
      return want && ctx.request?.aspect !== want ? `aspect ${ctx.request?.aspect ?? 'unset'}, expected ${want}` : null
    }
    case 'identity_block':
      return ctx.identityBlock && !prompt.includes(ctx.identityBlock.trim()) ? 'the saved identity\'s prompt block is missing' : null
    case 'sheet_model_locked':
      return ctx.sheetLock && ctx.request?.model && ctx.request.model !== ctx.sheetLock.model ? `${ctx.request.model} (sheet uses ${ctx.sheetLock.model})` : null
    case 'marks_stated': {
      for (const m of ctx.marks ?? []) {
        if (!prompt.includes(m.description) || !prompt.includes(m.side)) return `mark "${m.name}" is not stated with its side`
      }
      return null
    }
    case 'require_pattern': {
      const text = c.ignore ? prompt.replace(new RegExp(c.ignore, `g${c.flags.replace('g', '')}`), '') : prompt
      return new RegExp(c.pattern, c.flags).test(text) ? null : 'missing'
    }
    case 'reference_slot': {
      // SPEC 5.2 rule 14: refs attached need the REFERENCE line and the
      // sheet outfit replaced (rule 15); a saved character attaches nothing.
      const refs = attachments(ctx.request)
      if (refs > 0) {
        if (!/using the attached reference images/i.test(prompt)) return 'refs attached without the REFERENCE line'
        if (!/instead of [^.]*reference images/i.test(prompt)) return 'the sheet outfit is not replaced'
        return null
      }
      if (ctx.identityBlock && !prompt.includes('the saved character')) return 'a saved character must be named as "the saved character"'
      return null
    }
    case 'max_words':
    case 'behavior':
    case 'code':
      return undefined
  }
}

export function lintPrompt(rules: RulesConfig, prompt: string, ctx: RuleContext): RuleViolation[] {
  const out: RuleViolation[] = []
  const switches = ctx.switches ?? ALL_DEFAULTS_ON
  for (const rule of rules.rules) {
    if (rule.bucket === 'default' && !switches.on(rule.id)) continue
    if (!applies(rule, ctx)) continue
    const hit = check(rule, prompt, ctx)
    // A default is a warning at most, whatever the file says.
    const severity = rule.bucket === 'fixed' ? rule.severity : 'warning'
    if (hit) out.push({ ruleId: rule.id, spec: rule.spec, title: rule.title, severity, message: rule.message, match: hit })
  }
  return [...out, ...realismViolations(prompt, ctx), ...safetyViolations(prompt)]
}

// Fixed rule no-explicit, in code so no config can switch it off.
export function safetyViolations(prompt: string): RuleViolation[] {
  const terms = findExplicitTerms(prompt)
  return terms.length ? [{ ruleId: 'no-explicit', spec: 'B11', title: 'No nudity or explicit content', severity: 'error', message: EXPLICIT_MESSAGE, match: terms.join(', ') }] : []
}

// Rule zero, the Realism principle. Checked in code for every prompt, after
// the configured rules, so no config edit can switch it off.
export function realismViolations(prompt: string, ctx: Pick<RuleContext, 'kind' | 'stage'>): RuleViolation[] {
  const out: RuleViolation[] = []
  const image = ctx.kind === 'image' || ctx.kind === 'image_edit'
  const v = (ruleId: string, title: string, message: string, match?: string): RuleViolation => ({ ruleId, spec: '0', title, severity: 'error', message, match })
  if (image && !hasRealismBlock(prompt)) {
    out.push(v('realism-block', 'Every image prompt carries the REALISM block', 'Every image prompt must include the REALISM block (real skin texture, visible pores, no retouching). It cannot be turned off.', 'no REALISM block'))
  }
  const banned = [...new Set(findBannedTerms(prompt).map(h => h.term))]
  if (banned.length) {
    out.push(v('realism-banned-words', 'No smoothing or beautifying words', 'Words like these make models smooth skin away. Real skin and visible flaws are what make the character believable.', banned.join(', ')))
  }
  if (image && isBareFaceStage(ctx.stage)) {
    if (!prompt.includes(BARE_FACE_LINE)) out.push(v('realism-bare-face', 'Hero and sheet are bare-faced', `Hero and sheet prompts must include "${BARE_FACE_LINE}"`, 'no bare-face line'))
    const makeup = findMakeupTerms(prompt)
    if (makeup.length) out.push(v('realism-makeup', 'No makeup on hero and sheet', 'Hero and sheet shots never wear makeup. Makeup belongs in scenes.', makeup.join(', ')))
  }
  return out
}

export const blocking = (v: RuleViolation[]) => v.filter(x => x.severity === 'error')
