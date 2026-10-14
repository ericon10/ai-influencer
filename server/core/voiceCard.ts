// The voice card (overnight items 4 and 5, DECISIONS G34 and G35): how a
// character talks, so the caption, script and hook writers write as that
// person and thirty accounts never sound like one. Also the character's
// ElevenLabs voice for voice lines. Every field is optional and editable
// (a default, never a lock); the writers read what is there.

export interface VoiceCard {
  // The character's voice on ElevenLabs (voice lines).
  elevenlabsId?: string
  who?: string
  // How they talk, in the owner's words.
  talks?: string
  // Words and phrases they use, and ones they never use.
  uses?: string[]
  never?: string[]
  emoji?: string
  humor?: string
  pov?: string
  // What the account posts about.
  pillars?: string[]
  // One line in their voice (a hook rewritten), for the writers to match.
  example?: string
}

const KEYS: Array<keyof VoiceCard> = ['elevenlabsId', 'who', 'talks', 'uses', 'never', 'emoji', 'humor', 'pov', 'pillars', 'example']

// A list in the owner's words: commas or semicolons, except inside quotes.
function list(v: string): string[] {
  const out: string[] = []
  let cur = '', inQuote = false
  // A comma written inside the closing quote ("leverage," "synergy") still
  // separates the items.
  for (const ch of v.replace(/([,;.])(["”])/g, '$2$1')) {
    if (ch === '"' || ch === '“' || ch === '”') { inQuote = ch === '“' ? true : ch === '”' ? false : !inQuote; continue }
    if (!inQuote && (ch === ',' || ch === ';')) { out.push(cur); cur = ''; continue }
    cur += ch
  }
  out.push(cur)
  return out.map(s => s.trim().replace(/[.,;]+$/, '').trim()).filter(Boolean)
}
// The quoted phrases in a line ("be so for real," "I'm crying").
const quoted = (v: string) => [...v.matchAll(/["“]([^"“”]{2,60})["”]/g)].map(m => m[1]!.trim().replace(/,+$/, '')).filter(Boolean)

// A "## Voice" section of a character file: bullets like the script kit's
// voice cards ("Talks like: ...", "Never: ...", "Example (hook 3): ...").
export function parseVoiceSection(bullets: Array<{ key: string | null; value: string }>): VoiceCard {
  const v: VoiceCard = {}
  for (const b of bullets) {
    const k = (b.key ?? '').toLowerCase()
    const value = b.value.trim()
    if (!k || !value) continue
    if (/eleven|voice id|voice_id/.test(k)) v.elevenlabsId = value.replace(/[`"']/g, '').trim()
    else if (/^who/.test(k)) v.who = value
    else if (/^pov|point of view/.test(k)) v.pov = value
    else if (/talk|tone|speaks|how (?:she|he|they)/.test(k)) {
      v.talks = value
      const q = quoted(value)
      if (q.length) v.uses = [...new Set([...(v.uses ?? []), ...q])]
    } else if (/^(?:uses|words|says|phrases)/.test(k)) v.uses = [...new Set([...(v.uses ?? []), ...list(value)])]
    else if (/humou?r/.test(k)) v.humor = value
    else if (/emoji/.test(k)) v.emoji = value
    else if (/^(?:never|avoid|don)/.test(k)) v.never = list(value.replace(/\(([^)]*)\)/g, ', $1'))
    else if (/pillar|topics|posts about/.test(k)) v.pillars = list(value)
    else if (/^example/.test(k)) v.example = value.replace(/^["“]|["”]$/g, '')
  }
  return v
}

// A card as stored (any old shape), cleaned to the fields above.
export function cleanVoiceCard(raw: unknown): VoiceCard {
  if (!raw || typeof raw !== 'object') return {}
  const r = raw as Record<string, unknown>
  const out: VoiceCard = {}
  for (const k of KEYS) {
    const val = r[k]
    if (k === 'uses' || k === 'never' || k === 'pillars') {
      const arr = Array.isArray(val) ? val : typeof val === 'string' ? list(val) : []
      const clean = arr.map(x => String(x).trim()).filter(Boolean).slice(0, 40).map(x => x.slice(0, 120))
      if (clean.length) out[k] = clean
    } else if (typeof val === 'string' && val.trim()) out[k] = val.trim().slice(0, k === 'elevenlabsId' ? 80 : 600)
  }
  return out
}

export const hasVoiceCard = (v: VoiceCard) => !!(v.talks || v.uses?.length || v.never?.length || v.emoji || v.humor || v.pov || v.pillars?.length || v.example || v.who)

// The card as plain lines for a writer's prompt (empty when there is no
// card yet, so the prompt reads the same as before).
export function voiceCardText(name: string, v: VoiceCard): string {
  if (!hasVoiceCard(v)) return ''
  const lines = [
    `${name}'s voice card (write every line the way ${name} talks):`,
    v.who && `- Who: ${v.who}`,
    v.pov && `- Point of view: ${v.pov}`,
    v.talks && `- Talks like: ${v.talks}`,
    v.uses?.length && `- Words and phrases ${name} uses: ${v.uses.join('; ')}`,
    v.humor && `- Humor: ${v.humor}`,
    v.emoji && `- Emoji: ${v.emoji}`,
    v.never?.length && `- Never: ${v.never.join('; ')}`,
    v.pillars?.length && `- Content pillars: ${v.pillars.join('; ')}`,
    v.example && `- Example line in this voice: ${v.example}`,
  ].filter(Boolean)
  return lines.join('\n')
}

// The card as a "## Voice" section of the character file (export).
export function voiceSectionLines(v: VoiceCard): string[] {
  if (!hasVoiceCard(v) && !v.elevenlabsId) return []
  return [
    '## Voice',
    '',
    ...[
      v.elevenlabsId && `- ElevenLabs voice ID: ${v.elevenlabsId}`,
      v.who && `- Who: ${v.who}`,
      v.pov && `- POV: ${v.pov}`,
      v.talks && `- Talks like: ${v.talks}`,
      v.uses?.length && `- Uses: ${v.uses.join('; ')}`,
      v.humor && `- Humor: ${v.humor}`,
      v.emoji && `- Emoji: ${v.emoji}`,
      v.never?.length && `- Never: ${v.never.join('; ')}`,
      v.pillars?.length && `- Pillars: ${v.pillars.join('; ')}`,
      v.example && `- Example: ${v.example}`,
    ].filter((x): x is string => !!x),
    '',
  ]
}
