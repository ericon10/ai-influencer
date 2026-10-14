// Spreadsheet import for a batch (overnight item 3): one CSV row per post.
// Columns, in any order (header names are forgiving):
//   character   the character's name
//   account     the account tag the post is for
//   clip        an existing clip's name (reused, free), or "still: <prompt>"
//   still       a new still prompt (instead of "still:" in the clip column)
//   video       an optional video prompt (motion for the new still)
//   caption     the post's caption (required)
//   style       an optional edit style (the Idea step's Format), by name
// Pure: the parser, the header map and the row check. Prices come from the
// caller (the price book).

export interface CsvRow { line: number; cells: Record<string, string> }

// RFC 4180: commas, quotes ("" inside quotes), newlines inside quotes.
export function parseCsv(text: string): string[][] {
  const rows: string[][] = []
  let row: string[] = [], cell = '', quoted = false
  const src = text.replace(/^\uFEFF/, '')
  // The separator is whichever of comma, semicolon or tab the header line
  // uses most (spreadsheets in some countries save with semicolons).
  const head = src.split(/\r?\n/, 1)[0] ?? ''
  const sep = [',', ';', '\t'].map(d => ({ d, n: head.split(d).length })).sort((a, b) => b.n - a.n)[0]!.d
  for (let i = 0; i < src.length; i++) {
    const ch = src[i]!
    if (quoted) {
      if (ch === '"') {
        if (src[i + 1] === '"') { cell += '"'; i++ } else quoted = false
      } else cell += ch
      continue
    }
    if (ch === '"' && cell === '') quoted = true
    else if (ch === sep) { row.push(cell); cell = '' }
    else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && src[i + 1] === '\n') i++
      row.push(cell); cell = ''
      if (row.some(c => c.trim())) rows.push(row)
      row = []
    } else cell += ch
  }
  row.push(cell)
  if (row.some(c => c.trim())) rows.push(row)
  return rows
}

const ALIASES: Record<string, string[]> = {
  character: ['character', 'char', 'creator', 'persona', 'who'],
  account: ['account', 'account tag', 'account_tag', 'handle', 'tag'],
  clip: ['clip', 'clip name', 'clip_name', 'reuse', 'reuse clip'],
  still: ['still', 'still prompt', 'still_prompt', 'image prompt', 'prompt'],
  video: ['video', 'video prompt', 'video_prompt', 'motion'],
  caption: ['caption', 'text', 'hook', 'on-screen text'],
  style: ['style', 'edit style', 'edit_style', 'format', 'edit'],
}

export function headerMap(header: string[]): { map: Record<string, number>; unknown: string[] } {
  const map: Record<string, number> = {}
  const unknown: string[] = []
  header.forEach((h, i) => {
    const key = h.trim().toLowerCase().replace(/\s+/g, ' ')
    const field = Object.entries(ALIASES).find(([, names]) => names.includes(key))?.[0]
    if (field && map[field] === undefined) map[field] = i
    else if (key) unknown.push(h.trim())
  })
  return { map, unknown }
}

export function csvRows(text: string): { rows: CsvRow[]; problems: string[] } {
  const table = parseCsv(text)
  if (!table.length) return { rows: [], problems: ['The file is empty.'] }
  const { map, unknown } = headerMap(table[0]!)
  const problems: string[] = []
  if (map.caption === undefined) problems.push('Add a "caption" column (one caption per row).')
  if (map.clip === undefined && map.still === undefined) problems.push('Add a "clip" column (a clip to reuse, or "still: your prompt").')
  if (unknown.length) problems.push(`Columns not used: ${unknown.join(', ')}.`)
  const rows = table.slice(1).map((r, i) => ({
    line: i + 2,
    cells: Object.fromEntries(Object.entries(map).map(([k, idx]) => [k, (r[idx] ?? '').trim()])),
  }))
  return { rows, problems }
}

export interface ImportCharacter { id: string; name: string }
export interface ImportClip { id: string; characterId: string; title: string }
export interface ImportStyle { id: string; label: string }

export interface PlannedRow {
  line: number
  characterId: string | null
  characterName: string
  accountTag: string
  clipId: string | null
  clipTitle: string | null
  stillPrompt: string | null
  videoPrompt: string | null
  caption: string
  style: string | null
  status: 'reuse' | 'generate' | 'problem'
  problems: string[]
}

const norm = (s: string) => s.trim().toLowerCase().replace(/\.(mp4|mov|webm)$/i, '').replace(/[\s_-]+/g, ' ')

export function planRows(rows: CsvRow[], ctx: { characters: ImportCharacter[]; clips: ImportClip[]; styles: ImportStyle[]; defaultCharacterId?: string | null; max: number }): PlannedRow[] {
  return rows.slice(0, ctx.max).map(r => {
    const c = r.cells
    const problems: string[] = []
    const who = c.character ?? ''
    // Two characters with one name: the batch's own wins, else the row asks.
    const named = who ? ctx.characters.filter(x => norm(x.name) === norm(who)) : ctx.characters.filter(x => x.id === ctx.defaultCharacterId)
    const character = named.length > 1 ? named.find(x => x.id === ctx.defaultCharacterId) : named[0]
    if (!character) problems.push(!who ? 'Name the character' : named.length > 1 ? `${named.length} characters are called "${who}"; import from that character's batch` : `No character named "${who}"`)
    const clipCell = c.clip ?? ''
    const stillFromClip = /^still\s*:/i.test(clipCell) ? clipCell.replace(/^still\s*:/i, '').trim() : ''
    const stillPrompt = (c.still || stillFromClip || '').trim() || null
    let clip: ImportClip | undefined
    if (clipCell && !stillFromClip) {
      clip = ctx.clips.find(x => (!character || x.characterId === character.id) && norm(x.title) === norm(clipCell))
      if (!clip) problems.push(`No clip named "${clipCell}"${character ? ` for ${character.name}` : ''}`)
    }
    if (!clipCell && !stillPrompt) problems.push('Name a clip to reuse, or write "still: your prompt"')
    const caption = (c.caption ?? '').trim()
    if (!caption) problems.push('Write the caption')
    if (caption.length > 400) problems.push('The caption is over 400 characters')
    const styleCell = (c.style ?? '').trim()
    const style = styleCell ? ctx.styles.find(x => norm(x.label) === norm(styleCell) || norm(x.id) === norm(styleCell)) : undefined
    if (styleCell && !style) problems.push(`No edit style called "${styleCell}"`)
    return {
      line: r.line,
      characterId: character?.id ?? null,
      characterName: character?.name ?? who,
      accountTag: (c.account ?? '').replace(/^@/, '').trim().slice(0, 60),
      clipId: clip?.id ?? null,
      clipTitle: clip?.title ?? null,
      stillPrompt: clip ? null : stillPrompt,
      videoPrompt: (c.video ?? '').trim() || null,
      caption: caption.slice(0, 400),
      style: style?.id ?? null,
      status: problems.length ? 'problem' : clip ? 'reuse' : 'generate',
      problems,
    }
  })
}
