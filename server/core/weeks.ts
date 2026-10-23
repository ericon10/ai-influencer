import { parseCsv } from './csvImport.js'
import { lintCopy, wordsIn, type LintLists } from './copyLint.js'
import { plain } from './lineBank.js'

// Weeks (owner, 2026-10-22; UX-PLAN.md section 37): a character's week
// planned in chat, written as a plan CSV to docs/PLAN-CSV-SPEC.md, read
// here. Pure: the columns (one list for the reader, the template and the
// spec's test), the reader, the checks of a row, the fill draw and its
// rules, the visual drafted from a line, the 9-point line lint and the
// near-duplicate test for imported lines. Storage, prices and jobs are the
// caller's (server/pipeline/weeks.ts).

// text_only and photo_dump (section 42 A, B) are made free on the worker.
export type PostType = 'slideshow' | 'clip' | 'photo' | 'faceless' | 'text_only' | 'photo_dump'
export const POST_TYPES: PostType[] = ['slideshow', 'clip', 'photo', 'faceless', 'text_only', 'photo_dump']
export const FREE_TYPES: PostType[] = ['text_only', 'photo_dump']
export type LifeOrJob = 'life' | 'job'
export type VoiceFit = 'first' | 'secondhand' | 'both'

export interface WeekColumn { name: string; required: boolean; values?: string; about: string }

// Every column of the plan CSV, in the template's order. The spec
// (docs/PLAN-CSV-SPEC.md) lists exactly these; a test holds them together.
export const WEEK_COLUMNS = [
  { name: 'row_id', required: true, values: 'Any short id, unique in the file (20 characters at most)', about: 'The row. Importing a file again with the same row_id asks Replace or Add as new.' },
  { name: 'account', required: true, values: 'An account on the Accounts page (a new name is added there)', about: 'Where the post goes.' },
  { name: 'date', required: true, values: 'YYYY-MM-DD', about: 'The day it posts. The week is the Monday to Sunday it falls in.' },
  { name: 'slot', required: true, values: '1 to the account\'s slots per day (AM, Daily and PM read as 1, 2 and 3)', about: 'The slot that day, in posting order.' },
  { name: 'device_id', required: false, values: 'Any text, e.g. DEVICE-01', about: 'The phone it posts from. Blank: the account\'s Device ID on the Accounts page.' },
  { name: 'character', required: false, values: 'A character\'s name', about: 'Blank: the account\'s character.' },
  { name: 'post_type', required: false, values: 'slideshow, clip, photo, faceless, text_only, photo_dump', about: 'Blank: faceless on a faceless account, clip otherwise. text_only and photo_dump are made free (no generation).' },
  { name: 'life_or_job', required: false, values: 'life, job', about: 'Blank: Fill picks one so the account keeps its life/job blend.' },
  { name: 'story_beat', required: false, values: 'Free text', about: 'What is happening in her week that day. Fit to voice fits the line to it; the scene is drafted from it.' },
  { name: 'line_id', required: false, values: 'A line bank id (bl_...)', about: 'The bank line for this post. Blank with no line: Fill draws one.' },
  { name: 'line', required: false, values: 'Free text, 12 words or fewer', about: 'The on-screen line as written (slide 1 of a slideshow). Wins over line_id.' },
  { name: 'voice_fit', required: false, values: 'first, secondhand, both', about: 'How the line is told. Blank: the character\'s way (first person for a faceless character or one out of work, secondhand otherwise).' },
  { name: 'caption', required: false, values: 'Free text', about: 'The posting caption. The AI label line is added when it is sent.' },
  { name: 'hashtags', required: false, values: 'Words with or without #, spaces or commas between', about: 'Five at most is the default.' },
  { name: 'scene', required: false, values: 'Free text', about: 'What the still shows. Blank: drafted from the story beat or the place bank when the line is filled.' },
  { name: 'place_id', required: false, values: 'A place id in a faceless character\'s place bank (e.g. IS015)', about: 'Faceless only: that place\'s scene, motion line and still.' },
  { name: 'outfit', required: false, values: 'Free text', about: 'A person post needs one before Make (Check flags it).' },
  { name: 'light', required: false, values: 'A light preset or free words', about: '' },
  { name: 'clip_action', required: false, values: 'Free text', about: 'What happens in the clip (a person clip).' },
  { name: 'video_prompt', required: false, values: 'Free text', about: 'The video prompt as written. A row with one gets a video in Make, whatever its type.' },
  { name: 'sound_name', required: false, values: 'Free text', about: 'The sound to add in the app (in the manifest).' },
  { name: 'sound_type', required: false, values: 'music, voiceover, original', about: '' },
  { name: 'voiceover_clip', required: false, values: 'Free text', about: 'The voiceover\'s search words.' },
  { name: 'product', required: false, values: 'A product\'s name, or blank', about: 'The post\'s product (its rules and claims).' },
  { name: 'ad', required: false, values: 'yes, no', about: 'An ad for its product (#ad, "Ad:" first in the caption).' },
  { name: 'notes', required: false, values: 'Free text', about: 'Kept on the post.' },
  { name: 'lane', required: false, values: 'Free text', about: 'Line Engine field, kept on the post and in post.json.' },
  { name: 'line_format', required: false, values: 'Free text', about: 'Line Engine field.' },
  { name: 'feeling', required: false, values: 'Free text', about: 'Line Engine field.' },
  { name: 'topic', required: false, values: 'Free text', about: 'Line Engine field.' },
  { name: 'still_job_id', required: false, values: 'A Higgsfield job id', about: 'Faceless only: that still, pulled free, instead of making one.' },
  { name: 'slide_2', required: false, values: 'Free text', about: 'Slideshow only: slides 2 to 6 (slide 1 is the line).' },
  { name: 'slide_3', required: false, about: '' },
  { name: 'slide_4', required: false, about: '' },
  { name: 'slide_5', required: false, about: '' },
  { name: 'slide_6', required: false, about: '' },
  { name: 'slide_1_image', required: false, values: 'Free text', about: 'Slideshow only: each slide\'s own image line.' },
  { name: 'slide_2_image', required: false, about: '' },
  { name: 'slide_3_image', required: false, about: '' },
  { name: 'slide_4_image', required: false, about: '' },
  { name: 'slide_5_image', required: false, about: '' },
  { name: 'slide_6_image', required: false, about: '' },
  { name: 'bg_color', required: false, values: 'A hex color, e.g. #000000', about: 'text_only: the background. Blank: black.' },
  { name: 'text_style', required: false, values: 'centered, two_beat, dialogue', about: 'text_only: centered white (default); two_beat (the punch line appears at 2 s; split with " / "); dialogue ("Her: ... / Me: ...").' },
  { name: 'bg_motion', required: false, values: 'none, zoom', about: 'text_only and photo_dump: zoom adds a slow push-in.' },
  { name: 'still_ids', required: false, values: 'Approved still ids, spaces or commas between', about: 'photo_dump: the 5 or 6 stills to use. Blank: her newest approved stills.' },
] as const satisfies readonly WeekColumn[]
export type WeekColumnName = (typeof WEEK_COLUMNS)[number]['name']
export const WEEK_COLUMN_NAMES: WeekColumnName[] = WEEK_COLUMNS.map(c => c.name)
export const REQUIRED_WEEK_COLUMNS: WeekColumnName[] = WEEK_COLUMNS.filter(c => c.required).map(c => c.name)
export type WeekCells = Record<WeekColumnName, string>

// One example row per post type, the template's rows (and the spec's).
export const WEEK_EXAMPLES: Array<Partial<Record<WeekColumnName, string>>> = [
  { row_id: 'C001', account: 'callie_tt_01', date: '2026-10-26', slot: '1', post_type: 'slideshow', life_or_job: 'job', story_beat: 'Monday: her roommate got a rejection email at 7am', line: 'my roommate got rejected at 7:02am. before coffee', caption: 'she said she is fine', hashtags: 'jobsearch roommate', outfit: 'oversized gray hoodie, black leggings', slide_2: 'she read it out loud like a eulogy', slide_3: 'the email said "we went another direction"', slide_4: 'there was no direction', slide_5: 'she made pancakes anyway', slide_6: 'we ate them in silence', slide_1_image: 'a phone on a messy kitchen counter next to a coffee maker, morning light' },
  { row_id: 'C002', account: 'callie_tt_01', date: '2026-10-26', slot: '2', post_type: 'clip', life_or_job: 'life', story_beat: 'Monday night: laundry day goes wrong', line: 'the dryer ate my one good sweater. i am 26', outfit: 'faded band tee, plaid pajama pants', scene: 'a small laundromat at night, fluorescent light', clip_action: 'she pulls a tiny shrunken sweater out of the dryer and holds it up', sound_name: 'sad violin', sound_type: 'music' },
  { row_id: 'C003', account: 'callie_ig_01', date: '2026-10-27', slot: '1', post_type: 'photo', line_id: 'bl_example', caption: 'tuesday', outfit: 'cream knit sweater, jeans', scene: 'sitting on the floor of her bedroom against the bed, laptop open' },
  { row_id: 'D001', account: 'doug_tt_01', date: '2026-10-26', slot: '1', post_type: 'faceless', story_beat: 'the unemployment portal is down again', place_id: 'IS015', video_prompt: 'Rain falls, the open mailbox door sways a little in the wind. 6 seconds, 9:16.', sound_name: 'sad piano', sound_type: 'music', caption: 'day 41' },
  { row_id: 'C004', account: 'callie_tt_01', date: '2026-10-28', slot: '1', post_type: 'text_only', line: 'my manager: any questions? / me: is this job real', text_style: 'two_beat', bg_color: '#000000', sound_name: 'ticking clock', sound_type: 'music' },
  { row_id: 'C005', account: 'callie_ig_01', date: '2026-10-28', slot: '2', post_type: 'photo_dump', line: 'october so far, a recap', bg_motion: 'zoom' },
]

export function templateCsv(): string {
  const esc = (v: string) => (/[",\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v)
  return [WEEK_COLUMN_NAMES.join(','), ...WEEK_EXAMPLES.map(r => WEEK_COLUMN_NAMES.map(c => esc(r[c] ?? '')).join(','))].join('\n') + '\n'
}

export interface WeekRow { line: number; cells: WeekCells }

// A row's fingerprint (section 39): Re-sync redrafts a row only when one of
// its cells changed. FNV-1a over the spec's columns in order, as 8 hex.
export function rowHash(cells: WeekCells): string {
  let h = 0x811c9dc5
  const text = WEEK_COLUMNS.map(c => (cells[c.name] ?? '').trim()).join('\u0001')
  for (let i = 0; i < text.length; i++) { h ^= text.charCodeAt(i); h = Math.imul(h, 0x01000193) >>> 0 }
  return h.toString(16).padStart(8, '0')
}

// A Google Sheet named by its link or its id (section 39).
export function sheetRef(text: string): string | null {
  const t = text.trim()
  const m = /\/(?:spreadsheets|file)\/d\/([a-zA-Z0-9_-]{10,})/.exec(t) ?? /[?&]id=([a-zA-Z0-9_-]{10,})/.exec(t)
  if (m) return m[1]!
  return /^[a-zA-Z0-9_-]{20,}$/.test(t) ? t : null
}

export function readWeek(text: string): { rows: WeekRow[]; missing: string[]; unknown: string[] } {
  const table = parseCsv(text)
  if (!table.length) return { rows: [], missing: [...REQUIRED_WEEK_COLUMNS], unknown: [] }
  const header = table[0]!.map(h => h.trim().toLowerCase().replace(/\s+/g, '_'))
  const at = new Map<string, number>()
  header.forEach((h, i) => { if (!at.has(h)) at.set(h, i) })
  // The launch plan's own names read too (format, hook).
  const alias: Record<string, string> = { hook: 'line', format: 'post_type', type: 'post_type', text: 'line' }
  for (const [from, to] of Object.entries(alias)) if (at.has(from) && !at.has(to)) at.set(to, at.get(from)!)
  const missing = REQUIRED_WEEK_COLUMNS.filter(c => !at.has(c))
  const unknown = header.filter(h => h && !(WEEK_COLUMN_NAMES as string[]).includes(h) && !(h in alias))
  const rows = table.slice(1).map((r, i) => ({
    line: i + 2,
    cells: Object.fromEntries(WEEK_COLUMN_NAMES.map(c => [c, (at.has(c) ? r[at.get(c)!] ?? '' : '').trim()])) as WeekCells,
  })).filter(r => Object.values(r.cells).some(Boolean))
  return { rows, missing, unknown }
}

// The Monday of a date's week (UTC dates, YYYY-MM-DD).
export function weekOf(date: string): string {
  const t = new Date(`${date}T12:00:00Z`)
  if (Number.isNaN(t.getTime())) return ''
  const day = (t.getUTCDay() + 6) % 7
  return new Date(t.getTime() - day * 86_400_000).toISOString().slice(0, 10)
}
export const weekDays = (monday: string) => Array.from({ length: 7 }, (_, i) => new Date(new Date(`${monday}T12:00:00Z`).getTime() + i * 86_400_000).toISOString().slice(0, 10))

// A slot as a number: 1, 2, 3...; AM, Daily and PM read as 1, 2 and 3.
export function slotNumber(raw: string): number | null {
  const s = raw.trim().toLowerCase()
  if (/^\d{1,2}$/.test(s)) { const n = Number(s); return n >= 1 && n <= 24 ? n : null }
  return ({ am: 1, daily: 2, pm: 3 } as Record<string, number>)[s] ?? null
}

// A post type read from a cell: the four names, or the launch plan's formats.
export function readPostType(raw: string): PostType | null {
  const s = raw.trim().toLowerCase()
  if (!s) return null
  if ((POST_TYPES as string[]).includes(s)) return s as PostType
  if (/faceless/.test(s)) return 'faceless'
  if (/text/.test(s)) return 'text_only'
  if (/dump/.test(s)) return 'photo_dump'
  if (/photo/.test(s)) return 'photo'
  if (/clip|video/.test(s)) return 'clip'
  if (/slideshow|carousel/.test(s)) return 'slideshow'
  return null
}
const readEnum = <T extends string>(raw: string, list: readonly T[]): T | null => (list as readonly string[]).includes(raw.trim().toLowerCase()) ? raw.trim().toLowerCase() as T : null
export const readLifeOrJob = (raw: string) => readEnum(raw, ['life', 'job'] as const)
export function readVoiceFit(raw: string): VoiceFit | null {
  const s = raw.trim().toLowerCase().replace(/[\s_-]+/g, '')
  if (s === 'first' || s === 'firstperson') return 'first'
  if (s === 'secondhand') return 'secondhand'
  if (s === 'both') return 'both'
  return null
}

export interface WeekAccountInfo { tag: string; kind: 'person' | 'faceless' | null; characterId: string | null; characterName: string; slotsPerDay: number }

export interface CheckedWeekRow {
  line: number; rowId: string; account: string; date: string; slot: number | null; postType: PostType | null
  lifeOrJob: LifeOrJob | null; voiceFit: VoiceFit | null; characterName: string
  errors: string[]; warnings: string[]
}

// A row checked against the accounts (free, on the preview). Only what
// makes a row impossible to place is an error; what Check flags later
// (a missing outfit, no line, no scene) is not.
export function checkWeekRow(r: WeekRow, accounts: Map<string, WeekAccountInfo>): CheckedWeekRow {
  const c = r.cells
  const errors: string[] = [], warnings: string[] = []
  const account = c.account.replace(/^@+/, '').trim()
  if (!c.row_id) errors.push('No row_id')
  else if (c.row_id.length > 20) errors.push(`row_id "${c.row_id}" is over 20 characters`)
  if (!account) errors.push('No account')
  if (!c.date) errors.push('No date')
  else if (!/^\d{4}-\d{2}-\d{2}$/.test(c.date) || !weekOf(c.date)) errors.push(`Date "${c.date}" is not YYYY-MM-DD`)
  const slot = c.slot ? slotNumber(c.slot) : null
  if (!c.slot) errors.push('No slot')
  else if (slot == null) errors.push(`Slot "${c.slot}" is not a number (1, 2, 3...)`)
  const acct = accounts.get(account.toLowerCase())
  if (acct && slot && slot > acct.slotsPerDay) warnings.push(`Slot ${slot} is past ${acct.tag}'s ${acct.slotsPerDay} slots a day (it still imports)`)
  let postType = readPostType(c.post_type)
  if (c.post_type && !postType) errors.push(`post_type "${c.post_type}" is not slideshow, clip, photo, faceless, text_only or photo_dump`)
  if (!postType) postType = acct?.kind === 'faceless' ? 'faceless' : 'clip'
  if (acct?.kind === 'faceless' && postType !== 'faceless') warnings.push(`${acct.tag} is a faceless account: a ${postType} row puts a person on it`)
  if (acct?.kind === 'person' && postType === 'faceless') errors.push(`${acct.tag} is ${acct.characterName}'s account: a faceless row goes on a faceless account`)
  if (acct && !acct.characterId && !c.character) errors.push(`${acct.tag} has no character: pick one on the Accounts page, or fill the character column`)
  const lifeOrJob = readLifeOrJob(c.life_or_job)
  if (c.life_or_job && !lifeOrJob) warnings.push(`life_or_job "${c.life_or_job}" is not life or job: Fill picks one`)
  const voiceFit = readVoiceFit(c.voice_fit)
  if (c.voice_fit && !voiceFit) warnings.push(`voice_fit "${c.voice_fit}" is not first, secondhand or both: the character's way is used`)
  if (c.line && wordsIn(c.line) > 14) warnings.push(`The line is ${wordsIn(c.line)} words: about 12 reads in 2 seconds`)
  if (c.place_id && postType !== 'faceless' && postType !== 'text_only') warnings.push('place_id is for faceless and text_only rows: left out')
  if (c.bg_color && !/^#?[0-9a-f]{6}$/i.test(c.bg_color.trim())) warnings.push(`bg_color "${c.bg_color}" is not a hex color (#000000): black is used`)
  if (c.text_style && !['centered', 'two_beat', 'dialogue'].includes(c.text_style.trim().toLowerCase())) warnings.push(`text_style "${c.text_style}" is not centered, two_beat or dialogue: centered is used`)
  if (c.ad && !/^(?:y|yes|n|no|true|false|1|0)$/i.test(c.ad)) warnings.push(`ad "${c.ad}" is not yes or no: read as no`)
  return { line: r.line, rowId: c.row_id, account, date: c.date, slot, postType, lifeOrJob, voiceFit, characterName: c.character.trim(), errors, warnings }
}

// ── The fill draw (item 9) ────────────────────────────────────────────

export interface WeekRules { pain_window: number; max_run: number }
export const DEFAULT_WEEK_RULES: WeekRules = { pain_window: 7, max_run: 2 }

export interface PoolLine {
  id: string; text: string; pain: string; emotion: string; format: string; fits: VoiceFit
  lifeOrJob: LifeOrJob | null; usedAccount: string | null; fight: boolean
}
export interface DrawSlot {
  postId: string; account: string; date: string; slot: number
  // The row's own life_or_job and voice_fit (they win over the blend and the character).
  lifeOrJob: LifeOrJob | null; voiceFit: VoiceFit | null
  // The character's way of telling a line: first person or secondhand.
  stance: 'first' | 'secondhand'
  // A line the slot already has (a locked or saved slot, or a line the
  // CSV gave): it stays, and it counts for the rules after it.
  keep: { lineId: string | null; pain: string; emotion: string; format: string } | null
}
export interface HistoryItem { pain: string; emotion: string; format: string }
export interface Draw { postId: string; lineId: string | null; lifeOrJob: LifeOrJob; kept: boolean; flag: string | null }

// A small seeded random (mulberry32), so a draw can be shown and drawn
// again the same way, and a test can pin one.
export function rng(seed: number): () => number {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}
export function hashSeed(...parts: Array<string | number>): number {
  let h = 2166136261
  for (const ch of parts.join('|')) { h ^= ch.charCodeAt(0); h = Math.imul(h, 16777619) }
  return h >>> 0
}
const shuffle = <T>(list: T[], r: () => number): T[] => {
  const a = [...list]
  for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(r() * (i + 1)); [a[i], a[j]] = [a[j]!, a[i]!] }
  return a
}

// Rule e: which of an account's open slots are life and which job, so the
// week keeps its blend (lifeShare is the life %). Slots the row named keep
// theirs and count toward the blend; the rest are dealt at random.
export function assignBlend(slots: Array<{ postId: string; lifeOrJob: LifeOrJob | null }>, lifeShare: number, seed: number): Map<string, LifeOrJob> {
  const out = new Map<string, LifeOrJob>()
  const share = Math.max(0, Math.min(100, lifeShare)) / 100
  const want = Math.round(slots.length * share)
  const named = slots.filter(s => s.lifeOrJob)
  for (const s of named) out.set(s.postId, s.lifeOrJob!)
  const open = shuffle(slots.filter(s => !s.lifeOrJob), rng(seed))
  let life = Math.max(0, want - named.filter(s => s.lifeOrJob === 'life').length)
  for (const s of open) { out.set(s.postId, life > 0 ? 'life' : 'job'); if (life > 0) life-- }
  return out
}

// Rule d: how a slot takes lines. A row's voice_fit wins; else the
// character's stance.
export const fitsVoice = (line: VoiceFit, slot: VoiceFit | null, stance: 'first' | 'secondhand') => {
  const want = slot && slot !== 'both' ? slot : slot === 'both' ? null : stance
  return want == null || line === 'both' || line === want
}

// Why a line cannot go in a slot, or null when it can (rules a to e).
export function blocked(l: PoolLine, s: DrawSlot, kind: LifeOrJob, recent: HistoryItem[], rules: WeekRules): string | null {
  // b: a line is never used on two accounts, ever (used once, it is used).
  if (l.usedAccount != null) return 'used'
  if (l.fight) return 'fight'
  // e: never a job line in a life slot (an untagged line is a job line).
  if ((l.lifeOrJob ?? 'job') !== kind) return 'kind'
  // d: voice fit.
  if (!fitsVoice(l.fits, s.voiceFit, s.stance)) return 'voice'
  // a: no pain repeats within the account's last N posts.
  const window = recent.slice(-rules.pain_window)
  if (l.pain && l.pain !== 'none' && window.some(h => h.pain === l.pain)) return 'pain'
  // c: emotion and format rotate (never max_run + 1 of the same in a row).
  const run = recent.slice(-rules.max_run)
  if (run.length === rules.max_run && run.every(h => h.emotion && h.emotion === l.emotion)) return 'emotion'
  if (run.length === rules.max_run && run.every(h => h.format && h.format === l.format)) return 'format'
  return null
}

const FLAG: Record<string, string> = {
  life: 'No life line left that fits this slot: left empty. Import life lines or write one.',
  job: 'No job line left that fits the rules here (pain, rotation, voice): left empty.',
}

// The draw: every slot in posting order across the accounts (so no account
// gets first pick of the whole bank), each open slot a random line that
// passes rules a to e, or left empty with the reason. Slots with a line to
// keep stay as they are and count for the rules after them. history: each
// account's posts before this week, oldest first.
export function drawLines(input: { slots: DrawSlot[]; pool: PoolLine[]; history: Map<string, HistoryItem[]>; blend: Map<string, LifeOrJob>; seed: number; rules?: WeekRules }): Draw[] {
  const rules = input.rules ?? DEFAULT_WEEK_RULES
  const taken = new Set<string>()
  for (const s of input.slots) if (s.keep?.lineId) taken.add(s.keep.lineId)
  const recent = new Map<string, HistoryItem[]>()
  for (const [k, v] of input.history) recent.set(k.toLowerCase(), [...v])
  const order = [...input.slots].sort((a, b) => a.date.localeCompare(b.date) || a.slot - b.slot || a.account.localeCompare(b.account) || a.postId.localeCompare(b.postId))
  const out: Draw[] = []
  for (const s of order) {
    const key = s.account.toLowerCase()
    const mine = recent.get(key) ?? []
    recent.set(key, mine)
    const kind = s.lifeOrJob ?? input.blend.get(s.postId) ?? 'job'
    if (s.keep) {
      mine.push({ pain: s.keep.pain, emotion: s.keep.emotion, format: s.keep.format })
      out.push({ postId: s.postId, lineId: s.keep.lineId, lifeOrJob: kind, kept: true, flag: null })
      continue
    }
    const r = rng(hashSeed(input.seed, s.postId))
    const ok = shuffle(input.pool.filter(l => !taken.has(l.id) && !blocked(l, s, kind, mine, rules)), r)
    const pick = ok[0]
    if (!pick) { out.push({ postId: s.postId, lineId: null, lifeOrJob: kind, kept: false, flag: FLAG[kind]! }); continue }
    taken.add(pick.id)
    mine.push({ pain: pick.pain, emotion: pick.emotion, format: pick.format })
    out.push({ postId: s.postId, lineId: pick.id, lifeOrJob: kind, kept: false, flag: null })
  }
  return out
}

// The rules checked over a finished week (the tests, and the draw's own
// note): each break with the post and the rule.
export function ruleBreaks(rows: Array<{ postId: string; account: string; date: string; slot: number; line: PoolLine | null; lifeOrJob: LifeOrJob }>, rules: WeekRules = DEFAULT_WEEK_RULES): Array<{ postId: string; rule: 'a' | 'b' | 'c' | 'e' }> {
  const out: Array<{ postId: string; rule: 'a' | 'b' | 'c' | 'e' }> = []
  const accountOf = new Map<string, string>()
  const seen = new Map<string, HistoryItem[]>()
  for (const r of [...rows].sort((a, b) => a.date.localeCompare(b.date) || a.slot - b.slot)) {
    // A post with a line of its own (no tags) still counts as a post.
    if (!r.line) { const mine = seen.get(r.account.toLowerCase()) ?? []; mine.push({ pain: '', emotion: '', format: '' }); seen.set(r.account.toLowerCase(), mine); continue }
    const prev = accountOf.get(r.line.id)
    if (prev && prev !== r.account.toLowerCase()) out.push({ postId: r.postId, rule: 'b' })
    accountOf.set(r.line.id, r.account.toLowerCase())
    const mine = seen.get(r.account.toLowerCase()) ?? []
    if (r.line.pain && r.line.pain !== 'none' && mine.slice(-rules.pain_window).some(h => h.pain === r.line!.pain)) out.push({ postId: r.postId, rule: 'a' })
    const run = mine.slice(-rules.max_run)
    if (run.length === rules.max_run && (run.every(h => h.emotion === r.line!.emotion) || run.every(h => h.format === r.line!.format))) out.push({ postId: r.postId, rule: 'c' })
    if (r.lifeOrJob === 'life' && (r.line.lifeOrJob ?? 'job') !== 'life') out.push({ postId: r.postId, rule: 'e' })
    mine.push({ pain: r.line.pain, emotion: r.line.emotion, format: r.line.format })
    seen.set(r.account.toLowerCase(), mine)
  }
  return out
}

// ── The line drives the visual (item 11) ──────────────────────────────

export interface DraftPlace { id: string; name: string; line: string; motion: string }
export interface DraftSound { name: string; search: string; kind: string }

const words = (s: string) => new Set(plain(s).split(' ').filter(w => w.length > 3))
const overlap = (a: Set<string>, b: Set<string>) => [...a].filter(w => b.has(w)).length

// A motion line from a place's still line, by code (free): what moves in it
// and a held phone camera. The owner edits it like any prompt.
export function draftMotion(placeLine: string): string {
  const p = placeLine.toLowerCase()
  const moves = [
    /rain/.test(p) && 'rain keeps falling',
    /steam|coffee|ramen|tea|soup|kettle/.test(p) && 'steam rises',
    /window|blind|curtain/.test(p) && 'the light at the window shifts a little',
    /lamp|light|neon|fluorescent|flicker/.test(p) && 'the light hums and flickers once',
    /tree|field|wind|grass|flag/.test(p) && 'the wind moves through it',
    /car|road|highway|street|traffic/.test(p) && 'a car passes in the distance',
    /dryer|washer|fan|ceiling fan/.test(p) && 'it keeps turning',
  ].filter(Boolean) as string[]
  const what = moves.length ? moves.slice(0, 2).join(', ') : 'nothing much moves, the light barely changes'
  return `${what[0]!.toUpperCase()}${what.slice(1)}, slight handheld sway. 6 seconds, 9:16.`
}

// The visual of a filled post with no scene: a faceless post's place (the
// words of its line and story beat first, else the least used place), its
// motion line and a music bed; a person post's scene from its story beat
// and the character's own settings, and a video prompt from the line.
export function draftVisual(input: {
  postType: PostType; line: string; storyBeat: string; name: string
  places: DraftPlace[]; placeUse: Map<string, number>; sounds: DraftSound[]; settings: string[]; seed: number
}): { placeId: string | null; scene: string; videoPrompt: string; soundName: string } {
  const text = words(`${input.line} ${input.storyBeat}`)
  const music = input.sounds.filter(s => s.kind === 'music')
  const sound = music.length ? music[hashSeed(input.seed, input.line) % music.length]!.name : ''
  if (input.postType === 'faceless') {
    if (!input.places.length) return { placeId: null, scene: input.storyBeat, videoPrompt: input.storyBeat ? draftMotion(input.storyBeat) : '', soundName: sound }
    const r = rng(hashSeed(input.seed, input.line, input.storyBeat))
    const scored = shuffle(input.places, r).map(p => ({ p, score: overlap(text, words(`${p.name} ${p.line}`)), used: input.placeUse.get(p.id) ?? 0 }))
      .sort((a, b) => b.score - a.score || a.used - b.used)
    const pick = scored[0]!.p
    return { placeId: pick.id, scene: pick.line, videoPrompt: pick.motion || draftMotion(pick.line), soundName: sound }
  }
  const setting = input.settings.length ? input.settings[hashSeed(input.seed, input.line) % input.settings.length]! : ''
  const scene = [input.storyBeat, setting].filter(Boolean).join('. ') || `${input.name} in an ordinary moment of her week`
  const videoPrompt = input.postType === 'slideshow' || input.postType === 'photo' ? '' : `${input.name} reacts to it for real${input.storyBeat ? ` (${input.storyBeat.replace(/[.\s]+$/, '')})` : ''}: the moment the line is about, her face clear the whole time.`
  return { placeId: null, scene, videoPrompt, soundName: sound }
}

// ── The 9-point line lint (item 10) ───────────────────────────────────

export const LINE_LINT_POINTS = [
  { n: 1, id: 'lint-hit-first', title: 'The hit in the first words' },
  { n: 2, id: 'lint-emotion', title: 'A clear emotion' },
  { n: 3, id: 'lint-line-words', title: '12 words or fewer' },
  { n: 4, id: 'lint-line-detail', title: 'One specific detail' },
  { n: 5, id: 'lint-dashes', title: 'No long dashes' },
  { n: 6, id: 'lint-you-start', title: 'Not opening on "You"' },
  { n: 7, id: 'lint-hype', title: 'No hype words' },
  { n: 8, id: 'lint-line-tag', title: 'No hashtag or product name on screen' },
  { n: 9, id: 'lint-values', title: 'No should, must or need to aimed at the viewer' },
] as const

const DETAIL = /\d|\$|£|€|\b(?:monday|tuesday|wednesday|thursday|friday|saturday|sunday|tonight|morning|midnight|noon|am|pm|a\.m\.|p\.m\.|hours?|minutes?|days?|weeks?|months?|years?|once|twice|three|four|five|six|seven|eight|nine|ten|twenty|hundred|thousand)\b|["“'‘][^"”'’]{2,}["”'’]/i

export interface LintPoint { n: number; id: string; title: string; ok: boolean; message: string }

// Free, warnings only. Points 1, 2, 5, 6, 7 and 9 are the copy lint's own
// checks (run on every post here, whatever its product); 3, 4 and 8 are the
// line's own. off: rules switched off in Settings > Rules (they pass).
export function lineLint(text: string, o: { lists?: Partial<LintLists>; maxWords?: number; products?: string[]; off?: Iterable<string> } = {}): LintPoint[] {
  const off = new Set(o.off ?? [])
  const t = (text ?? '').trim()
  const hits = lintCopy(t, { kind: 'hook', lists: { ...(o.lists ?? {}), jobWords: [], products: o.products ?? o.lists?.products ?? [] }, standard: true })
  const hit = (id: string) => hits.find(h => h.rule === id)
  const max = o.maxWords ?? 12
  const n = wordsIn(t)
  const product = (o.products ?? []).find(p => p.trim().length > 2 && new RegExp(`\\b${p.trim().replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'i').test(t))
  const tag = t.match(/(^|\s)#[A-Za-z0-9_]+/)?.[0]?.trim()
  return LINE_LINT_POINTS.map(p => {
    let message = ''
    if (p.id === 'lint-line-words') message = n > max ? `${n} words: ${max} or fewer reads in about 2 seconds.` : ''
    else if (p.id === 'lint-line-detail') message = DETAIL.test(t) ? '' : 'No specific detail: a number, a time, a day, an amount or the exact words someone said.'
    else if (p.id === 'lint-line-tag') message = tag ? `${tag} on screen: hashtags go in the caption.` : product ? `${product} on screen: the product is never in the line.` : ''
    else message = hit(p.id)?.message ?? ''
    const ok = !message || off.has(p.id)
    return { n: p.n, id: p.id, title: p.title, ok, message: ok ? '' : message }
  })
}

// ── Imported lines: near-duplicates (item 7) ──────────────────────────

// Two lines are the same line when their words match after case, emoji and
// punctuation, or when 80% of the words (of the shorter) are shared.
export function nearDuplicate(a: string, b: string, share = 0.8): boolean {
  const pa = plain(a), pb = plain(b)
  if (!pa || !pb) return false
  if (pa === pb) return true
  const wa = pa.split(' ').filter(Boolean), wb = pb.split(' ').filter(Boolean)
  const small = wa.length <= wb.length ? wa : wb
  const big = new Set(wa.length <= wb.length ? wb : wa)
  if (small.length < 3) return false
  return small.filter(w => big.has(w)).length / small.length >= share
}

export const LINE_SOURCES = ['comment', 'caption', 'transcript', 'inventory', 'competitor', 'claude'] as const
export type LineSource = (typeof LINE_SOURCES)[number]
export const LINE_COLUMNS = ['text', 'source', 'source_likes', 'pain', 'emotion', 'format', 'voice_fit', 'life_or_job', 'used_on_account', 'used_on_date'] as const

export interface ImportedLine { line: number; text: string; source: LineSource; likes: number; pain: string; emotion: string; format: string; fits: VoiceFit; lifeOrJob: LifeOrJob | null; problems: string[] }

// The Import lines CSV: text required, the rest read by name in any order
// (comment and line read as text; likes as source_likes).
export function readLines(text: string, cfg: { emotions: string[]; formats: string[] }): { rows: ImportedLine[]; missing: string[]; unknown: string[] } {
  const table = parseCsv(text)
  if (!table.length) return { rows: [], missing: ['text'], unknown: [] }
  const header = table[0]!.map(h => h.trim().toLowerCase().replace(/\s+/g, '_'))
  const find = (...names: string[]) => header.findIndex(h => names.includes(h))
  const c = {
    text: find('text', 'line', 'comment'), source: find('source'), likes: find('source_likes', 'likes', 'comment_likes'), pain: find('pain', 'pain_point'), emotion: find('emotion'),
    format: find('format'), fits: find('voice_fit', 'fits', 'voice'), life: find('life_or_job', 'life_job', 'lane_type'),
  }
  if (c.text < 0) return { rows: [], missing: ['text'], unknown: [] }
  const known = new Set(['text', 'line', 'comment', 'source', 'source_likes', 'likes', 'comment_likes', 'pain', 'pain_point', 'emotion', 'format', 'voice_fit', 'fits', 'voice', 'life_or_job', 'life_job', 'lane_type', 'used_on_account', 'used_on_date', 'used_on'])
  const cell = (r: string[], i: number) => (i >= 0 ? r[i] ?? '' : '').trim()
  const rows = table.slice(1).map((r, i) => {
    const problems: string[] = []
    const src = cell(r, c.source).toLowerCase()
    const source = (LINE_SOURCES as readonly string[]).includes(src) ? src as LineSource : 'claude'
    if (src && source !== src) problems.push(`source "${src}" read as claude`)
    const emotion = cell(r, c.emotion).toLowerCase()
    const format = cell(r, c.format).toLowerCase()
    if (emotion && !cfg.emotions.includes(emotion)) problems.push(`emotion "${emotion}" is not one of ${cfg.emotions.join(', ')}`)
    const fits = readVoiceFit(cell(r, c.fits)) ?? 'both'
    const life = readLifeOrJob(cell(r, c.life))
    const likes = Number(cell(r, c.likes).replace(/,/g, ''))
    return { line: i + 2, text: cell(r, c.text).replace(/\s+/g, ' '), source, likes: Number.isFinite(likes) ? Math.max(0, Math.round(likes)) : 0, pain: cell(r, c.pain), emotion: cfg.emotions.includes(emotion) ? emotion : '', format, fits, lifeOrJob: life, problems }
  }).filter(r => r.text)
  return { rows, missing: [], unknown: header.filter(h => h && !known.has(h)) }
}

// ── The step bar ──────────────────────────────────────────────────────

export const WEEK_STEPS = ['import', 'fill', 'check', 'make', 'review', 'drive'] as const
export type WeekStep = (typeof WEEK_STEPS)[number]

export interface WeekCounts { posts: number; noLine: number; flagged: number; unchecked: number; toMake: number; making: number; toReview: number; approved: number; killed: number; toSend: number; sent: number }

// The current step: the first one with work left.
export function currentStep(c: WeekCounts): WeekStep {
  if (!c.posts) return 'import'
  if (c.noLine > 0) return 'fill'
  if (c.unchecked > 0) return 'check'
  if (c.toMake > 0 || c.making > 0) return 'make'
  if (c.toReview > 0) return 'review'
  if (c.toSend > 0) return 'drive'
  return 'drive'
}

// The file name a post goes to Drive under: date_slot_account_rowid.ext.
export function driveName(p: { date: string; slot: number | string; account: string; rowId: string; ext: string }): string {
  const safe = (s: string) => s.trim().replace(/[^A-Za-z0-9._-]+/g, '-').replace(/^-+|-+$/g, '') || 'x'
  return `${safe(p.date)}_${safe(String(p.slot))}_${safe(p.account)}_${safe(p.rowId)}.${p.ext}`
}

// `platform` (section 42 C) is last: columns are only ever added at the end.
export const MANIFEST_COLUMNS = ['Device ID', 'Account', 'file_name', 'caption', 'hashtags', 'date', 'slot', 'sound_name', 'ad_label', 'platform'] as const
export function manifestCsv(rows: Array<Record<(typeof MANIFEST_COLUMNS)[number], string>>): string {
  const esc = (v: string) => (/[",\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v)
  return [MANIFEST_COLUMNS.join(','), ...rows.map(r => MANIFEST_COLUMNS.map(c => esc(r[c] ?? '')).join(','))].join('\n') + '\n'
}

// The caption as sent: the post's caption, its hashtags after it, then the
// AI label line (the character file's disclosure, rule: posts labeled as
// AI-generated) when the caption does not already carry it.
export function captionWithLabel(caption: string, label: string): string {
  const c = caption.trim()
  const l = label.trim()
  if (!l || c.toLowerCase().includes(l.toLowerCase())) return c
  return c ? `${c}\n\n${l}` : l
}
