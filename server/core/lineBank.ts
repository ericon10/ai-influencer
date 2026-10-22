import { parseCsv } from './csvImport.js'

// The line bank (owner, 2026-10-22; UX-PLAN.md section 36, item 29). Pure:
// reading an Apify comment scrape and its videos, the free first pass, who a
// line fits, the reviewer's bar, and the JSON schemas of the three priced
// calls (tags, writer, reviewer) and of the voice rewrite. Storage, prices
// and jobs are the caller's (server/pipeline/lineBank.ts).

export interface LineBankConfig {
  min_likes: number; min_words: number; max_words: number; pass_score: number
  tag_batch: number; examples: number
  emotions: string[]; topics: string[]; formats: string[]
  fits: Array<{ id: Fit; label: string }>
  topic_words: string[]; video_words: string[]; foreign_words: string[]; english_words: string[]; first_person_words: string[]
}

export type Fit = 'first' | 'secondhand' | 'both'
export type Stance = 'first' | 'secondhand'

export interface BankComment {
  comment: string; likes: number; replies: number
  videoAccount: string; videoViews: number; videoUrl: string; videoCaption: string
  // The scrape's own themes column, when it has one.
  themes: string
}

export interface BankTags { emotion: string; topic: string; pain: string; fits: Fit; format: string; fight: boolean; fightReason: string }
export interface BankReview { gut: number; specific: number; real: number; setup: boolean; meh: boolean; note: string }

// ── Reading the files ─────────────────────────────────────────────────

// "415007.0", "1,204", "1.2K", "3M" as a whole number (0 when unreadable).
export function readNumber(raw: string): number {
  const s = String(raw ?? '').trim().replace(/,/g, '')
  const m = s.match(/^(-?\d+(?:\.\d+)?)\s*([kKmM])?$/)
  if (!m) return 0
  const n = Number(m[1]) * (m[2] ? (m[2].toLowerCase() === 'k' ? 1_000 : 1_000_000) : 1)
  return Number.isFinite(n) ? Math.max(0, Math.round(n)) : 0
}

const head = (h: string) => h.trim().toLowerCase().replace(/[\s.]+/g, '_')
function columns(header: string[], names: Record<string, RegExp>): Record<string, number> {
  const out: Record<string, number> = {}
  for (const [k, re] of Object.entries(names)) out[k] = header.findIndex(h => re.test(head(h)))
  return out
}

// A TikTok video's key: its numeric id when the URL has one, else the URL
// without its query and trailing slash (lowercase).
export function videoKey(url: string): string {
  const u = String(url ?? '').trim()
  const id = u.match(/\/video\/(\d{8,})/)?.[1] ?? u.match(/\/photo\/(\d{8,})/)?.[1]
  if (id) return id
  return u.toLowerCase().replace(/[?#].*$/, '').replace(/\/+$/, '')
}

export const COMMENT_COLUMNS = ['comment', 'comment_likes', 'replies', 'video_account', 'video_views', 'video_url'] as const

// The comments tab: comment, comment_likes, replies, video_account,
// video_views, video_url (any order; Apify's own names read too; extra
// columns ignored).
// Rows with no words (a sticker or a picture) are counted apart.
export function readComments(text: string): { rows: BankComment[]; missing: string[]; empty: number } {
  const table = parseCsv(text)
  if (!table.length) return { rows: [], missing: ['comment', 'comment_likes'], empty: 0 }
  const c = columns(table[0]!, {
    comment: /^(comment|text|comment_text)$/, likes: /^(comment_likes|likes|diggcount|digg_count|comment_digg_count)$/, replies: /^(replies|reply_count|replycommenttotal|reply_comment_total)$/,
    account: /^(video_account|account|author|video_author)$/, views: /^(video_views|views|playcount|play_count)$/, url: /^(video_url|videowebur?l|url|post_url)$/, themes: /^themes?$/,
  })
  const missing = [c.comment! < 0 && 'comment', c.likes! < 0 && 'comment_likes'].filter((x): x is string => !!x)
  if (missing.length) return { rows: [], missing, empty: 0 }
  const cell = (r: string[], i: number) => (i >= 0 ? r[i] ?? '' : '').trim()
  const all = table.slice(1).filter(r => r.some(x => x.trim())).map(r => ({
    comment: cell(r, c.comment!).replace(/\s+/g, ' '), likes: readNumber(cell(r, c.likes!)), replies: readNumber(cell(r, c.replies!)),
    videoAccount: cell(r, c.account!).replace(/^@/, ''), videoViews: readNumber(cell(r, c.views!)), videoUrl: cell(r, c.url!), videoCaption: '', themes: cell(r, c.themes!),
  }))
  const rows = all.filter(r => r.comment)
  return { rows, missing: [], empty: all.length - rows.length }
}

// The same run's videos (url and text: the caption): each video's caption by
// its key, and by its account when the account has one video.
export function readCaptions(text: string): { byVideo: Map<string, string>; byAccount: Map<string, string>; count: number } {
  const table = parseCsv(text)
  const byVideo = new Map<string, string>(), accounts = new Map<string, string[]>()
  if (!table.length) return { byVideo, byAccount: new Map(), count: 0 }
  const c = columns(table[0]!, { url: /^(url|video_url|webvideourl|web_video_url|post_url)$/, text: /^(text|caption|desc|description|video_caption)$/, account: /^(authormeta_name|author|account|video_account|username)$/ })
  if (c.url! < 0 || c.text! < 0) return { byVideo, byAccount: new Map(), count: 0 }
  for (const r of table.slice(1)) {
    const url = (r[c.url!] ?? '').trim(), caption = (r[c.text!] ?? '').trim().replace(/\s+/g, ' ')
    if (!url || !caption) continue
    byVideo.set(videoKey(url), caption)
    const account = (c.account! >= 0 ? r[c.account!] ?? '' : url.match(/@([^/]+)/)?.[1] ?? '').trim().replace(/^@/, '').toLowerCase()
    if (account) accounts.set(account, [...(accounts.get(account) ?? []), caption])
  }
  const byAccount = new Map([...accounts].filter(([, list]) => list.length === 1).map(([a, list]) => [a, list[0]!]))
  return { byVideo, byAccount, count: byVideo.size }
}

export function withCaptions(rows: BankComment[], caps: ReturnType<typeof readCaptions>): BankComment[] {
  return rows.map(r => ({ ...r, videoCaption: caps.byVideo.get(videoKey(r.videoUrl)) ?? caps.byAccount.get(r.videoAccount.toLowerCase()) ?? '' }))
}

// ── The free first pass ───────────────────────────────────────────────

export type DropReason = 'duplicate' | 'likes' | 'short' | 'language' | 'video' | 'topic'
export const DROP_LABEL: Record<DropReason, string> = {
  duplicate: 'Duplicates', likes: '0 or 1 likes', short: 'Too short', language: 'Not English', video: 'About the video itself', topic: 'Off the job search',
}

// Lowercase, straight quotes, emoji and punctuation gone, one space.
export function plain(s: string): string {
  return s.toLowerCase().replace(/[’‘]/g, "'").replace(/[“”]/g, '"')
    .replace(/[\p{Extended_Pictographic}\u{FE0F}\u{200D}]/gu, ' ')
    .replace(/[^\p{L}\p{N}'\s-]/gu, ' ').replace(/\s+/g, ' ').trim()
}

const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
// One regex for a word list: whole words, a phrase as written.
export function wordsRegex(words: string[]): RegExp {
  const list = [...new Set(words.map(w => plain(w)).filter(Boolean))].sort((a, b) => b.length - a.length)
  return new RegExp(`(?:^|[^\\p{L}\\p{N}])(?:${list.map(escape).join('|') || '(?!)'})(?=$|[^\\p{L}\\p{N}])`, 'u')
}
const countWords = (words: string[], set: Set<string>) => words.filter(w => set.has(w)).length

export interface FirstPass { kept: BankComment[]; dropped: Record<DropReason, number>; examples: Record<DropReason, string[]> }

// Code only, free: drops duplicates, 0 or 1 likes, too few words, other
// languages, comments about the video itself and comments off the job
// search, in that order (each comment counted once, for its first reason).
export function firstPass(rows: BankComment[], cfg: LineBankConfig): FirstPass {
  const topic = wordsRegex(cfg.topic_words), video = wordsRegex(cfg.video_words)
  const foreign = new Set(cfg.foreign_words.map(plain)), english = new Set(cfg.english_words.map(plain))
  const dropped = Object.fromEntries(Object.keys(DROP_LABEL).map(k => [k, 0])) as Record<DropReason, number>
  const examples = Object.fromEntries(Object.keys(DROP_LABEL).map(k => [k, [] as string[]])) as Record<DropReason, string[]>
  const seen = new Set<string>()
  const kept: BankComment[] = []
  // The most liked copy of a comment is the one kept.
  for (const r of [...rows].sort((a, b) => b.likes - a.likes)) {
    const p = plain(r.comment)
    const words = p.split(' ').filter(Boolean)
    const reason = ((): DropReason | null => {
      if (!p || seen.has(p)) return 'duplicate'
      if (r.likes < cfg.min_likes) return 'likes'
      if (words.length < cfg.min_words) return 'short'
      const letters = r.comment.match(/\p{L}/gu) ?? []
      const latin = letters.filter(ch => /\p{Script=Latin}/u.test(ch)).length
      if (letters.length && latin / letters.length < 0.7) return 'language'
      const f = countWords(words, foreign), e = countWords(words, english)
      if (f >= 2 && f >= e) return 'language'
      if (video.test(p)) return 'video'
      if (!topic.test(p) && !r.themes.trim()) return 'topic'
      return null
    })()
    if (p) seen.add(p)
    if (reason) {
      dropped[reason]++
      if (examples[reason].length < 5) examples[reason].push(r.comment.slice(0, 140))
      continue
    }
    kept.push(r)
  }
  return { kept, dropped, examples }
}

// ── Who a line fits ───────────────────────────────────────────────────

// How a character tells a line: first person when their voice card's who or
// point of view says they are out of work; otherwise secondhand.
export function stanceFrom(text: string, cfg: Pick<LineBankConfig, 'first_person_words'>): Stance {
  return wordsRegex(cfg.first_person_words).test(plain(text)) ? 'first' : 'secondhand'
}
export const fitsStance = (fits: Fit | string | null | undefined, stance: Stance) => fits === 'both' || fits === stance

// The reviewer's bar: all three scores at the pass score or more, and
// neither setup nor meh.
export function passes(r: BankReview | null | undefined, passScore: number): boolean {
  if (!r) return false
  return Math.min(r.gut, r.specific, r.real) >= passScore && !r.setup && !r.meh
}
export const reviewScore = (r: BankReview | null | undefined) => (r ? Math.round(((r.gut + r.specific + r.real) / 3) * 10) / 10 : null)

// ── Reading the calls' answers ────────────────────────────────────────

const pick = (v: unknown, list: readonly string[], fallback: string) => {
  const s = String(v ?? '').trim().toLowerCase()
  return list.find(x => x.toLowerCase() === s) ?? fallback
}
const score = (v: unknown) => { const n = Math.round(Number(v)); return Number.isFinite(n) ? Math.min(10, Math.max(1, n)) : 1 }
const clean = (v: unknown, max: number) => String(v ?? '').replace(/\s+/g, ' ').trim().slice(0, max)

export function readTags(v: Record<string, unknown> | undefined, cfg: LineBankConfig, pains: string[]): BankTags | null {
  if (!v) return null
  return {
    emotion: pick(v.emotion, [...cfg.emotions, 'none'], 'none'), topic: pick(v.topic, cfg.topics, cfg.topics[0]!),
    pain: pick(v.pain, [...pains, 'none'], 'none'), fits: pick(v.fits, ['first', 'secondhand', 'both'], 'both') as Fit,
    format: pick(v.format, cfg.formats, cfg.formats[0]!), fight: v.fight === true, fightReason: v.fight === true ? clean(v.fight_reason, 200) : '',
  }
}

export function readReview(v: Record<string, unknown> | undefined): BankReview | null {
  if (!v) return null
  return { gut: score(v.gut), specific: score(v.specific), real: score(v.real), setup: v.setup === true, meh: v.meh === true, note: clean(v.note, 240) }
}

// A line as placed on screen: one line, no wrapping quotes, no long dashes.
export function cleanLine(v: unknown): string {
  // Quotes come off only when they wrap the whole line ("a quoted phrase"
  // at the start keeps both of its marks).
  let s = clean(v, 200)
  while (/^["“'].*["”']$/.test(s) && s.length > 1 && !/^["“'][^"“”']*["”'][^"“”']/.test(s)) s = s.slice(1, -1).trim()
  return s.replace(/\s*[\u2014\u2013]\s*/g, ', ').trim()
}

// ── The calls' JSON schemas ───────────────────────────────────────────

const obj = (props: Record<string, unknown>) => ({ type: 'object', additionalProperties: false, required: Object.keys(props), properties: props })
const listOf = (key: string, item: Record<string, unknown>, n: number) => obj({ [key]: { type: 'array', minItems: n, maxItems: n, items: obj({ n: { type: 'integer' }, ...item }) } })

export function tagsJsonSchema(n: number, cfg: LineBankConfig, pains: string[]) {
  return listOf('tags', {
    emotion: { type: 'string', enum: [...cfg.emotions, 'none'] }, topic: { type: 'string', enum: cfg.topics },
    pain: { type: 'string', enum: [...pains, 'none'] }, fits: { type: 'string', enum: ['first', 'secondhand', 'both'] },
    format: { type: 'string', enum: cfg.formats }, fight: { type: 'boolean' }, fight_reason: { type: 'string' },
  }, n)
}
export const writerJsonSchema = (n: number) => listOf('lines', { line: { type: 'string' }, skip: { type: 'boolean' }, why: { type: 'string' } }, n)
export const reviewerJsonSchema = (n: number) => listOf('reviews', {
  gut: { type: 'integer' }, specific: { type: 'integer' }, real: { type: 'integer' }, setup: { type: 'boolean' }, meh: { type: 'boolean' }, note: { type: 'string' },
}, n)
export const voiceJsonSchema = (n: number) => listOf('results', { line: { type: 'string' }, fits: { type: 'boolean' }, why: { type: 'string' } }, n)

// ── The calls' inputs ─────────────────────────────────────────────────

// A comment as numbered input (its likes, and its video's caption for
// context; never the account's name).
export function listComments(rows: Array<Pick<BankComment, 'comment' | 'likes' | 'videoCaption'>>): string {
  return rows.map((r, i) => `${i + 1}. (${r.likes} likes${r.videoCaption ? `; under a video captioned: "${r.videoCaption.slice(0, 160)}"` : ''}) ${r.comment.slice(0, 600)}`).join('\n')
}

export function examplesText(kept: string[], rejected: string[]): string {
  if (!kept.length && !rejected.length) return 'None yet.'
  return [
    kept.length ? `Lines the owner kept:\n${kept.map(l => `- ${l}`).join('\n')}` : '',
    rejected.length ? `Lines the owner rejected:\n${rejected.map(l => `- ${l}`).join('\n')}` : '',
  ].filter(Boolean).join('\n')
}

// ── Free stand-ins (demo mode and tests) ──────────────────────────────

const has = (p: string, words: string[]) => words.some(w => p.includes(w))
export function mockTags(rows: Array<Pick<BankComment, 'comment'>>, cfg: LineBankConfig, pains: string[]) {
  return {
    tags: rows.map((r, i) => {
      const p = plain(r.comment)
      const topic = has(p, ['laid off', 'layoff']) ? 'layoff' : has(p, ['ghost']) ? 'ghosting' : has(p, ['interview']) ? 'interviews' : has(p, ['rent', 'money', 'pay', 'broke']) ? 'money' : has(p, ['mom', 'dad', 'family']) ? 'family' : has(p, ['entry level', 'experience']) ? 'entry level' : 'applications'
      const emotion = has(p, ['crying', '😭']) ? 'crying' : has(p, ['hate', 'tight', 'pissed']) ? 'angry' : has(p, ['sad']) ? 'sad' : cfg.emotions[(i + 4) % cfg.emotions.length]!
      return {
        n: i + 1, emotion: cfg.emotions.includes(emotion) ? emotion : cfg.emotions[0]!, topic: cfg.topics.includes(topic) ? topic : cfg.topics[0]!,
        pain: pains.length ? pains[i % pains.length]! : 'none', fits: (['both', 'secondhand', 'both', 'first'] as const)[i % 4]!, format: cfg.formats[i % cfg.formats.length]!,
        fight: has(p, ['trump', 'biden', 'democrat', 'republican', 'religion', 'church', 'racist']), fight_reason: has(p, ['trump', 'biden', 'democrat', 'republican']) ? 'politics' : '',
      }
    }),
  }
}
export function mockLines(rows: Array<Pick<BankComment, 'comment'>>, maxWords: number) {
  return {
    lines: rows.map((r, i) => {
      const words = plain(r.comment).split(' ').filter(Boolean)
      return { n: i + 1, line: words.slice(0, maxWords).join(' '), skip: words.length < 4, why: words.length < 4 ? 'nothing specific to keep' : '' }
    }),
  }
}
// Every third line falls under the bar, so the rejected count shows.
export function mockReviews(n: number) {
  return { reviews: Array.from({ length: n }, (_, i) => ({ n: i + 1, gut: i % 3 === 2 ? 6 : 9, specific: i % 3 === 2 ? 7 : 8, real: 9, setup: false, meh: i % 3 === 2, note: i % 3 === 2 ? 'reads like setup' : 'specific and it hurts' })) }
}
export function mockVoice(lines: string[]) {
  return { results: lines.map((l, i) => ({ n: i + 1, line: l, fits: true, why: '' })) }
}
