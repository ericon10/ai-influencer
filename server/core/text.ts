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
