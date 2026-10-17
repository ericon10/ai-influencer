import { parseVoiceSection, type VoiceCard } from './voiceCard.js'

// The scale kit (overnight item 5, DECISIONS G35): a product's script kit
// as data. A kit file in the script kit's format (config/kits/, or one the
// owner uploads) becomes a product: its claims sheet (what can be said),
// its buyer-language bank (how buyers really talk), its hook vault
// (numbered, grouped by type), the voice cards it proposes, and its notes.
// Pure: markdown in, data out.

export interface Group { label: string; items: string[] }

export interface Claims {
  groups: Group[]
  // One-line rules under the lists ("Safe framing: ...", "Where the link
  // goes: ...").
  lines: Group[]
  // Words that, in a line that mentions the product, are worth a second
  // look against the claims sheet (a warning on a variant, never a block).
  watch: string[]
  // What counts as mentioning the product.
  mentions: string[]
}

export interface Language { groups: Group[] }
export interface KitHook { number: number; kind: string; text: string }
export interface KitVoice { name: string; status: 'live' | 'proposed'; card: VoiceCard }

export interface ScriptKit {
  title: string
  product: string
  claims: Claims
  language: Language
  hooks: KitHook[]
  voices: KitVoice[]
  notes: string
}

interface Section { title: string; level: number; body: string[] }

function sections(md: string): Section[] {
  const out: Section[] = []
  let cur: Section = { title: '', level: 1, body: [] }
  for (const raw of md.replace(/\r\n?/g, '\n').split('\n')) {
    const h = raw.match(/^(#{1,4})\s+(.*)$/)
    if (h) {
      out.push(cur)
      cur = { title: h[2]!.trim(), level: h[1]!.length, body: [] }
    } else cur.body.push(raw)
  }
  out.push(cur)
  return out.filter(s => s.title || s.body.some(l => l.trim()))
}

const clean = (s: string) => s.replace(/\*\*/g, '').replace(/\s+/g, ' ').trim()
const bare = (t: string) => clean(t).replace(/^\d+\.\s*/, '').toLowerCase()

// "Label:" lines with the bullets under them; "Label: value" lines on
// their own.
function labeled(body: string[]): { groups: Group[]; lines: Group[]; prose: string[] } {
  const groups: Group[] = []
  const lines: Group[] = []
  const prose: string[] = []
  let open: Group | null = null
  for (const raw of body) {
    const line = clean(raw)
    if (!line || /^-{3,}$/.test(line)) continue
    const bullet = raw.match(/^\s*[-*+]\s+(.*)$/)
    if (bullet && open) { open.items.push(clean(bullet[1]!)); continue }
    const head = line.match(/^([^:]{1,60}):$/)
    if (head) { open = { label: head[1]!.trim(), items: [] }; groups.push(open); continue }
    const kv = line.match(/^([A-Z][^:]{1,40}):\s+(.+)$/)
    if (kv && !bullet) { lines.push({ label: kv[1]!.trim(), items: [kv[2]!.trim()] }); open = null; continue }
    if (bullet) prose.push(clean(bullet[1]!))
    else prose.push(line)
  }
  return { groups: groups.filter(g => g.items.length), lines, prose }
}

const quotedIn = (s: string) => [...s.matchAll(/["“]([^"“”]{1,40})["”]/g)].map(m => m[1]!.trim()).filter(q => q.split(/\s+/).length <= 3)

// Watch words from the "never say" list: quoted short phrases, and the
// things a promise is made of ("Any promise of interviews, offers,
// callbacks or ...").
export function watchWords(never: string[]): string[] {
  const out = new Set<string>()
  for (const n of never) {
    for (const q of quotedIn(n)) out.add(q.toLowerCase())
    // "Fake results" (a character saying she got hired with it).
    if (/\bresults?\b/i.test(n) && /hired/i.test(n)) out.add('hired')
    const promise = n.match(/promise of ([^.]+)/i)?.[1]
    if (promise) for (const w of promise.split(/,|\bor\b|\band\b/)) {
      const t = w.replace(/["“”]/g, '').replace(/\b(a|an|the|any)\b/gi, '').trim().toLowerCase()
      if (t && t.split(/\s+/).length <= 2 && !/number/.test(t)) out.add(t)
    }
  }
  return [...out]
}

export function parseScriptKit(md: string, fallbackName = 'Product'): ScriptKit {
  const secs = sections(md)
  const title = clean(secs.find(s => s.level === 1 && s.title)?.title ?? fallbackName)
  const product = title.replace(/\s+script kit.*$/i, '').replace(/\s+v\d+.*$/i, '').trim() || fallbackName
  const find = (re: RegExp) => secs.find(s => re.test(bare(s.title)))

  // Claims sheet.
  const claimsSec = find(/^claims/)
  const c = labeled(claimsSec?.body ?? [])
  const never = c.groups.find(g => /never/i.test(g.label))?.items ?? []
  const claims: Claims = {
    groups: c.groups,
    lines: [...c.prose.length ? [{ label: 'Note', items: c.prose }] : [], ...c.lines],
    watch: watchWords(never),
    mentions: [product.toLowerCase()],
  }

  // Buyer language.
  const lang = labeled(find(/^buyer|language/)?.body ?? [])
  const language: Language = { groups: lang.groups }

  // Hook vault: numbered lines under "### type" headings after the vault.
  const hooks: KitHook[] = []
  const vaultAt = secs.findIndex(s => /hook vault/.test(bare(s.title)))
  if (vaultAt >= 0) {
    const level = secs[vaultAt]!.level
    let kind = ''
    for (const s of secs.slice(vaultAt)) {
      if (s !== secs[vaultAt] && s.level <= level) break
      if (s !== secs[vaultAt]) kind = clean(s.title).replace(/\s*\([^)]*\)\s*$/, '')
      for (const raw of s.body) {
        const m = raw.match(/^\s*(\d{1,4})[.)]\s+(.+)$/)
        if (m) hooks.push({ number: Number(m[1]), kind, text: clean(m[2]!) })
      }
    }
  }

  // Voice cards: "### Name (live)" or "### Proposed: "Name" (to build)".
  const voices: KitVoice[] = []
  const voiceAt = secs.findIndex(s => /voice cards?/.test(bare(s.title)))
  if (voiceAt >= 0) {
    const level = secs[voiceAt]!.level
    for (const s of secs.slice(voiceAt + 1)) {
      if (s.level <= level) break
      const t = clean(s.title)
      const proposed = /proposed|to build/i.test(t)
      const name = t.replace(/^proposed:\s*/i, '').replace(/\s*\([^)]*\)\s*$/, '').replace(/^["“]|["”]$/g, '').trim()
      const bullets = s.body.map(l => l.match(/^\s*[-*+]\s+(.*)$/)?.[1]).filter((x): x is string => !!x).map(x => {
        const kv = clean(x).match(/^([^:]{1,40}?)\s*:\s+(.+)$/)
        return kv ? { key: kv[1]!, value: kv[2]! } : { key: null, value: clean(x) }
      })
      voices.push({ name, status: proposed ? 'proposed' : 'live', card: parseVoiceSection(bullets) })
    }
  }

  // Everything else (how to use it, the weekly rhythm) as notes.
  const skip = new Set<number>()
  const block = (at: number) => {
    if (at < 0) return
    skip.add(at)
    for (let i = at + 1; i < secs.length && secs[i]!.level > secs[at]!.level; i++) skip.add(i)
  }
  block(vaultAt)
  block(voiceAt)
  for (const sec of [claimsSec, find(/^buyer|language/)]) if (sec) skip.add(secs.indexOf(sec))
  const notes = secs
    .filter((_, i) => !skip.has(i))
    .map(sec => [sec.level > 1 ? `## ${clean(sec.title)}` : '', ...sec.body.map(l => l.trimEnd()).filter(l => !/^-{3,}$/.test(l.trim()))].join('\n').trim())
    .filter(Boolean)
    .join('\n\n')
    .replace(/\n{3,}/g, '\n\n')

  return { title, product, claims, language, hooks, voices, notes }
}

// A line that mentions the product, checked against the claims sheet's
// watch words. Warnings only: the owner decides (defaults, not locks).
export function claimFlags(text: string, claims: Pick<Claims, 'watch' | 'mentions'>): string[] {
  const t = text.toLowerCase()
  if (!claims.mentions.some(m => m && t.includes(m.toLowerCase()))) return []
  return claims.watch.filter(w => w && new RegExp(`(^|[^a-z])${w.toLowerCase().replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`).test(t))
    .map(w => `Mentions "${w}" next to the product. The claims sheet says never to promise or imply this; check it before posting.`)
}

// The claims sheet and buyer language as plain lines for a writer.
export function claimsText(product: string, claims: Claims): string {
  const g = claims.groups.map(x => `${x.label}\n${x.items.map(i => `- ${i}`).join('\n')}`).join('\n')
  const l = claims.lines.map(x => `${x.label}: ${x.items.join(' ')}`).join('\n')
  return [`${product} claims sheet (anything about ${product} stays inside this; no made-up results):`, g, l].filter(Boolean).join('\n')
}

export function languageText(language: Language): string {
  if (!language.groups.length) return ''
  return ['How real buyers talk (use these words, not marketing words):', ...language.groups.map(x => `${x.label}: ${x.items.join('; ')}`)].join('\n')
}
