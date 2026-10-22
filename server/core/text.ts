// Text helpers shared by prompt builders, exports and the UI.

const EM_DASH = String.fromCharCode(0x2014)

// Fills {placeholders}. An unknown placeholder is a template bug, so it
// throws instead of silently sending "{card}" to a provider.
export function fill(template: string, vars: Record<string, string>): string {
  return template.replace(/\{([A-Za-z_]+)\}/g, (_, key: string) => {
    if (!(key in vars)) throw new Error(`Template placeholder {${key}} has no value.`)
    return vars[key]!
  })
}

// One clean line for the provider: no stray whitespace, no empty sentences,
// and never an em-dash (SPEC 5.7 rule 42).
export function normalizePrompt(text: string): string {
  return text
    .replaceAll(EM_DASH, ', ')
    .replace(/\s+/g, ' ')
    .replace(/\s+([.,;:])/g, '$1')
    .replace(/([.;])(\s*[.;])+/g, '$1')
    .replace(/,\s*\./g, '.')
    .trim()
}

// Hard-wraps for display (SPEC 5.7 rule 43): never one long horizontal line.
export function hardWrap(text: string, width = 72): string {
  const out: string[] = []
  for (const para of text.split('\n')) {
    if (!para.trim()) { out.push(''); continue }
    let line = ''
    for (const word of para.split(/\s+/).filter(Boolean)) {
      if (word.length > width) {
        if (line) { out.push(line); line = '' }
        for (let i = 0; i < word.length; i += width) out.push(word.slice(i, i + width))
        continue
      }
      if (!line) line = word
      else if (line.length + 1 + word.length <= width) line += ` ${word}`
      else { out.push(line); line = word }
    }
    if (line) out.push(line)
  }
  return out.join('\n')
}

export const capitalize = (s: string) => (s ? s[0]!.toUpperCase() + s.slice(1) : s)

export const wordCount = (s: string) => s.trim().split(/\s+/).filter(Boolean).length

export function slugify(s: string): string {
  return s.toLowerCase().normalize('NFKD').replace(/[^\w\s-]/g, '').trim().replace(/[\s_]+/g, '-').replace(/-+/g, '-').slice(0, 48) || 'character'
}

// A model that draws whatever words it is given, even negated ones (Soul:
// "no text" put text on the picture, owner 2026-10-21 on 100 faceless
// stills). Every clause that mentions one of `words` comes out: an item of
// the AVOID list, or a clause of a sentence (so an object that carries text
// leaves the scene too). A sentence left empty goes; a line left empty goes.
export function dropMentions(prompt: string, words: string[]): string {
  const list = words.map(w => w.trim()).filter(Boolean)
  if (!list.length) return prompt
  const re = new RegExp(`\\b(?:${list.map(w => w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|')})\\b`, 'i')
  if (!re.test(prompt)) return prompt
  const out: string[] = []
  for (const line of prompt.split('\n')) {
    const kept = dropLine(line, re)
    // A line that only held such words goes; blank lines of the prompt stay.
    if (kept !== null) out.push(kept)
  }
  return out.join('\n')
}

function dropLine(line: string, re: RegExp): string | null {
  if (!re.test(line)) return line
  const avoid = line.match(/^(\s*AVOID:\s*)(.*)$/)
  if (avoid) {
    const items = avoid[2]!.replace(/\.\s*$/, '').split(/\s*,\s*/).filter(i => i && !re.test(i))
    return items.length ? `${avoid[1]}${items.join(', ')}.` : null
  }
  const label = line.match(/^(\s*[A-Z][A-Z ]+:\s*)/)?.[1] ?? ''
  const body = line.slice(label.length)
  const sentences = body.split(/(?<=[.!?])\s+/).map(sentence => {
    if (!re.test(sentence)) return sentence
    const end = sentence.match(/[.!?]+$/)?.[0] ?? ''
    const clauses = sentence.slice(0, sentence.length - end.length).split(/\s*[,;]\s*/).filter(c => c && !re.test(c))
    if (!clauses.length) return ''
    const joined = clauses.join(', ')
    return `${joined.charAt(0).toUpperCase()}${joined.slice(1)}${end || '.'}`
  }).filter(Boolean)
  return sentences.length ? `${label}${sentences.join(' ')}` : null
}
