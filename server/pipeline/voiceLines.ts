import { readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { and, desc, eq, isNull } from 'drizzle-orm'
import { sounds } from '../db/schema.js'
import type { Ctx, Deps } from '../context.js'
import { AppError, notFound } from '../lib/errors.js'
import { newId } from '../lib/ids.js'
import { registerJobHook, registerLocalJob, type JobOutcome, type JobRow } from '../jobs/hooks.js'
import { enqueueLocalJob, type JobSpec } from '../jobs/runner.js'
import { ffmpeg, probeFile, withTempDir, MediaError } from '../media/ffmpeg.js'
import { measureLoudness } from '../media/sound.js'
import { readAsset, saveAsset } from '../storage/assets.js'
import { uploadKey } from '../storage/uploads.js'
import { getCharacter, toData } from './characters.js'
import { cleanVoiceCard } from '../core/voiceCard.js'
import { hookTag, parseTakeName, transcript, type Word } from '../core/voiceLines.js'
import type { GenRequest } from '../providers/types.js'

// Voice lines (overnight item 4, DECISIONS G34; UX-PLAN.md section 13).
// The owner performs each line and uploads the takes (one WAV per line,
// named like 047_check-my-match-score.wav) in Library > Voice lines. The
// worker prepares each take (free). "Convert" is priced first, then
// ElevenLabs speech to speech turns the take into the character's voice
// and speech to text times every word. A converted line can be the
// voiceover on any video post (no lip sync), with captions from its words.
//
// A voice line is a row in `sounds` (kind "voice") with the character, and
// in meta: the hook, the line, the take, and once converted, the words.
// Status: processing (take being prepared), take (ready to convert),
// converting, ready (in the character's voice), failed (the take could not
// be read).

export type VoiceRow = typeof sounds.$inferSelect
export interface VoiceMeta {
  hook: number | null
  line: string
  takeAssetId: string | null
  takeSec: number | null
  voiceId: string | null
  words: Word[]
  transcript: string
  convertJobId: string | null
  convertedAt: string | null
}

const metaOf = (r: VoiceRow): VoiceMeta => {
  const m = (r.meta ?? {}) as Partial<VoiceMeta>
  return {
    hook: typeof m.hook === 'number' ? m.hook : null, line: m.line ?? '', takeAssetId: m.takeAssetId ?? null, takeSec: m.takeSec ?? null,
    voiceId: m.voiceId ?? null, words: Array.isArray(m.words) ? m.words : [], transcript: m.transcript ?? '', convertJobId: m.convertJobId ?? null, convertedAt: m.convertedAt ?? null,
  }
}

export function voiceLineView(r: VoiceRow) {
  const m = metaOf(r)
  return {
    id: r.id, characterId: r.characterId, title: r.title, tag: r.tag, hook: m.hook, line: m.line, status: r.status, error: r.error,
    takeAssetId: m.takeAssetId, takeSec: m.takeSec, assetId: r.status === 'ready' ? r.assetId : null,
    durationSec: r.durationMs ? Math.round(r.durationMs / 100) / 10 : null,
    words: m.words, transcript: m.transcript, convertedAt: m.convertedAt, createdAt: r.createdAt.toISOString(),
  }
}
export type VoiceLineView = ReturnType<typeof voiceLineView>

export async function listVoiceLines(deps: Deps, ctx: Ctx, characterId?: string | null): Promise<VoiceRow[]> {
  const where = [eq(sounds.accountId, ctx.accountId), eq(sounds.kind, 'voice'), isNull(sounds.archivedAt)]
  if (characterId) where.push(eq(sounds.characterId, characterId))
  return deps.db.select().from(sounds).where(and(...where)).orderBy(desc(sounds.createdAt))
}

export async function getVoiceLine(deps: Deps, ctx: Ctx, id: string): Promise<VoiceRow> {
  const [row] = await deps.db.select().from(sounds).where(and(eq(sounds.accountId, ctx.accountId), eq(sounds.id, id), eq(sounds.kind, 'voice')))
  if (!row || row.archivedAt) throw notFound('Voice line')
  return row
}

// The takes the owner uploaded, one line each, for one character.
export async function addVoiceTakes(deps: Deps, ctx: Ctx, input: { characterId: string; takes: Array<{ uploadId: string; name: string }> }): Promise<VoiceRow[]> {
  const cfg = deps.config.pipeline.content.sound.voice
  const ch = await getCharacter(deps, ctx, input.characterId)
  if (!input.takes.length) throw new AppError('bad_request', 'Pick the takes to upload.')
  if (input.takes.length > cfg.max_takes) throw new AppError('bad_request', `Upload at most ${cfg.max_takes} takes at a time.`)
  const out: VoiceRow[] = []
  for (const t of input.takes) {
    if (!/^upl_[a-z0-9]{20}$/.test(t.uploadId)) throw new AppError('bad_request', 'That upload id is not valid.')
    if (!(await deps.store.exists(uploadKey(ctx.accountId, t.uploadId)))) throw new AppError('bad_request', `${t.name} did not finish uploading. Try again.`)
  }
  for (const t of input.takes) {
    const name = parseTakeName(t.name)
    const id = newId('snd')
    const meta: VoiceMeta = { hook: name.hook, line: name.line, takeAssetId: null, takeSec: null, voiceId: null, words: [], transcript: '', convertJobId: null, convertedAt: null }
    const [row] = await deps.db.insert(sounds).values({
      id, accountId: ctx.accountId, kind: 'voice', characterId: ch.id, title: name.title.slice(0, 120), tag: hookTag(name.hook),
      status: 'processing', meta, createdBy: ctx.userId,
    }).returning()
    await enqueueLocalJob(deps, ctx, { stage: 'content', purpose: `voice_take:${id}`, label: `Prepare take: ${row!.title}`, characterId: ch.id, request: { uploadId: t.uploadId } })
    out.push(row!)
  }
  return out
}

export async function updateVoiceLine(deps: Deps, ctx: Ctx, id: string, patch: { title?: string; line?: string; hook?: number | null }): Promise<VoiceRow> {
  const row = await getVoiceLine(deps, ctx, id)
  const m = metaOf(row)
  const hook = patch.hook !== undefined ? patch.hook : m.hook
  const [out] = await deps.db.update(sounds).set({
    title: patch.title !== undefined ? patch.title.trim().slice(0, 120) || row.title : row.title,
    tag: hookTag(hook),
    meta: { ...m, hook, line: patch.line !== undefined ? patch.line.trim().slice(0, 400) : m.line },
    updatedAt: deps.clock.now(),
  }).where(eq(sounds.id, row.id)).returning()
  return out!
}

// The take, prepared: mono WAV at 44.1 kHz (what speech to speech reads
// best), cut at the length limit, with its loudness measured. Free.
async function runVoiceTake(deps: Deps, ctx: Ctx, job: JobRow): Promise<unknown> {
  const id = job.purpose.split(':')[1]!
  const { uploadId } = job.request as { uploadId: string }
  const key = uploadKey(ctx.accountId, uploadId)
  const cfg = deps.config.pipeline.content.sound.voice
  try {
    const row = await getVoiceLine(deps, ctx, id)
    const result = await withTempDir(async dir => {
      const input = join(dir, 'take.bin'), out = join(dir, 'take.wav')
      await writeFile(input, await deps.store.get(key))
      const p = await probeFile(input)
      if (!p.hasAudio) throw new MediaError('That file has no sound.')
      await ffmpeg(['-i', input, '-t', String(cfg.max_seconds), '-vn', '-map', '0:a:0', '-ac', '1', '-ar', '44100', '-c:a', 'pcm_s16le', out], 300_000)
      const done = await probeFile(out)
      const loud = await measureLoudness(out)
      if (loud.i < -60) throw new MediaError('The take is silent.')
      const asset = await saveAsset(deps, ctx, { data: await readFile(out), mime: 'audio/wav', origin: 'upload', label: `Take: ${row.title}`, sourceJobId: job.id })
      return { assetId: asset.id, durationSec: done.durationSec ?? 0, loudness: loud.i, cut: (p.durationSec ?? 0) > cfg.max_seconds }
    })
    const m = metaOf(row)
    await deps.db.update(sounds).set({
      meta: { ...m, takeAssetId: result.assetId, takeSec: Math.round(result.durationSec * 100) / 100 }, loudness: result.loudness,
      status: 'take', error: result.cut ? `The take was longer than ${cfg.max_seconds} s; only the first ${cfg.max_seconds} s are kept.` : null, updatedAt: deps.clock.now(),
    }).where(eq(sounds.id, id))
    await deps.store.delete(key).catch(() => undefined)
    return result
  } catch (e) {
    await deps.db.update(sounds).set({ status: 'failed', error: `This take could not be read as sound (${(e as Error).message.slice(0, 200)}).`, updatedAt: deps.clock.now() }).where(eq(sounds.id, id))
    throw e
  }
}

// "Convert": each take into its character's voice, one quote with a line
// per take. Needs the character's ElevenLabs voice ID (Profile, Voice).
export async function buildVoiceConvert(deps: Deps, ctx: Ctx, soundIds: string[]): Promise<{ purpose: string; characterId: string | null; specs: JobSpec[]; preview: { title: string; prompts: []; warnings: []; invalidates: [] } }> {
  const cfg = deps.config.pipeline.content.sound.voice
  const ids = [...new Set(soundIds)]
  if (!ids.length) throw new AppError('bad_request', 'Pick the voice lines to convert.')
  const specs: JobSpec[] = []
  const voices = new Map<string, { id: string; name: string }>()
  for (const id of ids) {
    const row = await getVoiceLine(deps, ctx, id)
    const m = metaOf(row)
    if (row.status === 'processing') throw new AppError('bad_request', `"${row.title}" is still being prepared. Try again in a moment.`)
    if (row.status === 'converting') throw new AppError('bad_request', `"${row.title}" is already converting.`)
    if (!m.takeAssetId || !row.characterId) throw new AppError('bad_request', `"${row.title}" has no take that could be read. Upload it again.`)
    let voice = voices.get(row.characterId)
    if (!voice) {
      const ch = await getCharacter(deps, ctx, row.characterId)
      const card = cleanVoiceCard(toData(ch).persona.voice)
      if (!card.elevenlabsId) throw new AppError('bad_request', `Add ${ch.name}'s ElevenLabs voice ID first (the character's Profile, Voice).`)
      voice = { id: card.elevenlabsId, name: ch.name }
      voices.set(row.characterId, voice)
    }
    const request: GenRequest = {
      kind: 'audio', model: cfg.model, prompt: m.line || row.title, refs: [{ assetId: m.takeAssetId }], voiceId: voice.id,
      durationSec: Math.max(1, Math.ceil(m.takeSec ?? 5)),
    }
    specs.push({ type: 'gen', stage: 'content', purpose: `voice_convert:${row.id}`, label: `${row.tag ? `${row.tag}: ` : ''}${row.title} in ${voice.name}'s voice`, request, characterId: row.characterId })
  }
  const chars = [...new Set(specs.map(s => s.characterId))]
  const n = specs.length
  return {
    purpose: n === 1 ? specs[0]!.purpose : 'voice_convert:many',
    characterId: chars.length === 1 ? chars[0]! : null,
    specs,
    preview: { title: n === 1 ? `Convert "${specs[0]!.label}"` : `Convert ${n} voice lines`, prompts: [], warnings: [], invalidates: [] },
  }
}

export async function markConverting(deps: Deps, ctx: Ctx, soundIds: string[], jobIds: Map<string, string>): Promise<void> {
  for (const id of soundIds) {
    const row = await getVoiceLine(deps, ctx, id).catch(() => null)
    if (!row) continue
    await deps.db.update(sounds).set({ status: 'converting', error: null, meta: { ...metaOf(row), convertJobId: jobIds.get(id) ?? null }, updatedAt: deps.clock.now() }).where(eq(sounds.id, row.id))
  }
}

// The converted line: the audio becomes the line's sound, the words its
// timings. A failed run leaves the take as it was (and costs nothing).
async function onVoiceConvert(deps: Deps, ctx: Ctx, job: JobRow, out: JobOutcome): Promise<void> {
  const id = job.purpose.split(':')[1]!
  const row = await getVoiceLine(deps, ctx, id).catch(() => null)
  if (!row) return
  const m = metaOf(row)
  const before = row.assetId ? 'ready' : 'take'
  const audio = out.assets?.find(a => a.kind === 'audio')
  const wordsAsset = out.assets?.find(a => a.mime === 'application/json')
  if (out.status !== 'completed' || !audio) {
    await deps.db.update(sounds).set({ status: before, error: `The conversion did not finish: ${out.error ?? 'no audio came back'}. Nothing was charged for a failed run.`, meta: { ...m, convertJobId: null }, updatedAt: deps.clock.now() }).where(eq(sounds.id, id))
    return
  }
  let words: Word[] = []
  if (wordsAsset) {
    try {
      const raw = JSON.parse((await readAsset(deps, ctx, wordsAsset.id)).data.toString('utf8')) as unknown
      if (Array.isArray(raw)) words = raw.filter((w): w is Word => !!w && typeof (w as Word).text === 'string' && Number.isFinite((w as Word).start) && Number.isFinite((w as Word).end)).slice(0, 400)
    } catch { words = [] }
  }
  const req = job.request as GenRequest
  await deps.db.update(sounds).set({
    assetId: audio.id, durationMs: audio.durationMs, status: 'ready', error: words.length ? null : 'No word timings came back; captions from this line are spread evenly instead.',
    meta: { ...m, words, transcript: transcript(words), voiceId: req.voiceId ?? null, convertJobId: null, convertedAt: deps.clock.now().toISOString() },
    updatedAt: deps.clock.now(),
  }).where(eq(sounds.id, id))
}

// What a post keeps of its voiceover: the line and its words, copied when
// the owner picks it (so a render never waits on another lookup).
export async function voiceForPost(deps: Deps, ctx: Ctx, voiceLineId: string, characterId: string | null): Promise<{ words: Word[]; title: string; durationSec: number | null }> {
  const row = await getVoiceLine(deps, ctx, voiceLineId)
  if (characterId && row.characterId && row.characterId !== characterId) {
    const ch = await getCharacter(deps, ctx, row.characterId).catch(() => null)
    throw new AppError('bad_request', `That voice line is ${ch?.name ?? 'another character'}'s. Pick one of this character's lines.`)
  }
  if (row.status !== 'ready' || !row.assetId) throw new AppError('bad_request', `"${row.title}" is not in the character's voice yet. Convert it in Library, Voice lines.`)
  const m = metaOf(row)
  const words = m.words.length ? m.words : evenWords(m.line || row.title, row.durationMs ? row.durationMs / 1000 : 3)
  return { words, title: row.title, durationSec: row.durationMs ? row.durationMs / 1000 : null }
}

// No timings came back: the line's words spread over its length.
function evenWords(text: string, seconds: number): Word[] {
  const tokens = text.split(/\s+/).filter(Boolean)
  const step = Math.max(0.15, seconds - 0.2) / Math.max(1, tokens.length)
  return tokens.map((t, i) => ({ text: t, start: Math.round((0.1 + i * step) * 100) / 100, end: Math.round((0.1 + (i + 0.85) * step) * 100) / 100 }))
}

// A converted line's file, written into a render's work folder.
export async function voiceFile(deps: Deps, ctx: Ctx, voiceLineId: string, dir: string): Promise<string> {
  const row = await getVoiceLine(deps, ctx, voiceLineId)
  if (row.status !== 'ready' || !row.assetId) throw new AppError('bad_request', `The voice line "${row.title}" is not converted yet.`)
  const path = join(dir, 'voice.mp3')
  await writeFile(path, (await readAsset(deps, ctx, row.assetId)).data)
  return path
}

let registered = false
export function registerVoiceLines(): void {
  if (registered) return
  registered = true
  registerLocalJob('voice_take', runVoiceTake)
  registerJobHook('voice_convert', onVoiceConvert)
}
