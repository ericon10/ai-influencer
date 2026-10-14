import { readFileSync } from 'node:fs'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { createHarness, drain, type Harness } from '../testing/harness.js'
import { registerPipelineHooks } from './hooks.js'
import { importCharacter } from './files.js'
import { getCharacter, toData, updateCharacter } from './characters.js'
import { createContent, getContent, startRender, updateContent, type ContentOutputs, type MemeSpec } from './content.js'
import { addClip, libraryView } from './clips.js'
import { estimateAction, runAction } from './actions.js'
import { addVoiceTakes, getVoiceLine, listVoiceLines, updateVoiceLine, voiceLineView } from './voiceLines.js'
import { listSounds } from './sounds.js'
import { postCutView } from './cutView.js'
import { editorManifest } from './openreel.js'
import { renderPlaceholderPortrait } from '../providers/mock.js'
import { makeClip } from '../media/testClips.js'
import { ffmpeg, probeFile } from '../media/ffmpeg.js'
import { measureLoudness } from '../media/sound.js'
import { readAsset } from '../storage/assets.js'
import { uploadKey } from '../storage/uploads.js'
import type { SubmitOptions } from '../providers/types.js'

// Voice lines (overnight item 4) against the mock voice: the owner's takes
// are prepared free, converted only with a quote, and the converted line is
// a post's voiceover with captions from its words. No real ElevenLabs call.

const FIX = join(process.cwd(), 'fixtures', 'callie')
let h: Harness, characterId: string, clipId: string, dir: string

// A take: a voice-like tone that changes pitch every half second.
async function take(name: string, seconds = 3): Promise<string> {
  const src = join(dir, name)
  await ffmpeg(['-f', 'lavfi', '-i', `aevalsrc='0.4*sin(2*PI*(180+60*floor(2*t))*t)*(0.6+0.4*sin(2*PI*3*t))':s=44100:d=${seconds}`, '-ac', '2', src])
  const uploadId = `upl_${name.replace(/[^a-z0-9]/g, '').padEnd(20, 'v').slice(0, 20)}`
  await h.deps.store.put(uploadKey(h.ctx.accountId, uploadId), await readFile(src), 'audio/wav')
  return uploadId
}

beforeAll(async () => {
  registerPipelineHooks()
  h = await createHarness()
  dir = await mkdtemp(join(tmpdir(), 'voice-'))
  const images: Record<string, { data: Buffer }> = {}
  for (let i = 0; i <= 11; i++) images[`REF-${String(i).padStart(2, '0')}`] = { data: await renderPlaceholderPortrait(`Callie REF-${i}`) }
  characterId = (await importCharacter(h.deps, h.ctx, readFileSync(join(FIX, 'character-callie.md'), 'utf8'), { images })).characterId
  const src = join(dir, 'clip.mp4')
  await makeClip(src, { width: 360, height: 640, fps: 30, durationSec: 4, audio: false })
  const uploadId = 'upl_' + 'c'.repeat(20)
  await h.deps.store.put(uploadKey(h.ctx.accountId, uploadId), await readFile(src), 'video/mp4')
  await addClip(h.deps, h.ctx, { characterId, uploadId, name: 'desk.mp4' })
  await drain(h, 20)
  clipId = (await libraryView(h.deps, h.ctx)).clips[0]!.id
}, 240_000)

afterAll(async () => { await rm(dir, { recursive: true, force: true }) })

let lineId: string

describe('voice lines', () => {
  it('uploads takes named by hook; the worker prepares each one free', async () => {
    const a = await take('047a.wav')
    const b = await take('003b.wav', 2)
    const rows = await addVoiceTakes(h.deps, h.ctx, { characterId, takes: [{ uploadId: a, name: '047_check-my-match-score.wav' }, { uploadId: b, name: '003_entry-level.wav' }] })
    expect(rows.map(r => [r.kind, r.status, r.tag, r.title])).toEqual([['voice', 'processing', 'Hook 47', 'Check my match score'], ['voice', 'processing', 'Hook 3', 'Entry level']])
    await drain(h, 20)
    const lines = (await listVoiceLines(h.deps, h.ctx, characterId)).map(voiceLineView)
    expect(lines.map(l => l.status)).toEqual(['take', 'take'])
    const line = lines.find(l => l.hook === 47)!
    expect(line.takeSec).toBeGreaterThan(2.9)
    expect(line.assetId).toBeNull()
    lineId = line.id
    // The take is a mono 44.1 kHz WAV.
    const p = join(dir, 'take.wav')
    await writeFile(p, (await readAsset(h.deps, h.ctx, line.takeAssetId!)).data)
    expect(await probeFile(p)).toMatchObject({ hasAudio: true, hasVideo: false })
    // Voice lines never show up as ambience or music.
    expect((await listSounds(h.deps, h.ctx)).some(s => s.kind === 'voice')).toBe(false)
    expect(await h.deps.store.exists(uploadKey(h.ctx.accountId, a))).toBe(false)
  })

  it('a take that is not sound fails with a plain reason', async () => {
    const uploadId = 'upl_' + 'n'.repeat(20)
    await h.deps.store.put(uploadKey(h.ctx.accountId, uploadId), Buffer.from('not audio at all'), 'audio/wav')
    const [row] = await addVoiceTakes(h.deps, h.ctx, { characterId, takes: [{ uploadId, name: 'broken.wav' }] })
    await drain(h, 20)
    const failed = await getVoiceLine(h.deps, h.ctx, row!.id)
    expect(failed.status).toBe('failed')
    expect(failed.error).toMatch(/could not be read as sound/)
  })

  it('asks for the character\'s ElevenLabs voice before anything is priced', async () => {
    // Her file (2026-10-14) names her voice; the spare voice is never taken.
    const ch = toData(await getCharacter(h.deps, h.ctx, characterId))
    expect(ch.persona.voice?.elevenlabsId).toBe('v3PqSRD51socDi8mEJ5f')
    await updateCharacter(h.deps, h.ctx, characterId, { persona: { ...ch.persona, voice: {} } }, 'no voice yet')
    await expect(estimateAction(h.deps, h.ctx, { type: 'voice_convert', soundIds: [lineId] })).rejects.toThrow(/ElevenLabs voice ID first/)
  })

  it('converts with a quote first: the line in her voice, every word timed', async () => {
    const ch = toData(await getCharacter(h.deps, h.ctx, characterId))
    await updateCharacter(h.deps, h.ctx, characterId, { persona: { ...ch.persona, voice: { elevenlabsId: 'voice-test-1', talks: 'casual' } } }, 'added the voice')
    await updateVoiceLine(h.deps, h.ctx, lineId, { line: 'Before I apply anywhere, I check my match score first.' })
    const action = { type: 'voice_convert' as const, soundIds: [lineId] }
    const { quote, preview } = await estimateAction(h.deps, h.ctx, action)
    expect(quote.status).toBe('open')
    expect(quote.totalMicros).toBeGreaterThan(0)
    expect(preview.title).toMatch(/Hook 47: Check my match score in Callie's voice/)
    const { jobs } = await runAction(h.deps, h.ctx, action, quote.id, true)
    expect(jobs[0]!.provider).toBe('elevenlabs')
    expect((await getVoiceLine(h.deps, h.ctx, lineId)).status).toBe('converting')
    await drain(h, 20)
    const line = voiceLineView(await getVoiceLine(h.deps, h.ctx, lineId))
    expect(line.status).toBe('ready')
    expect(line.assetId).toBeTruthy()
    expect(line.transcript).toBe('Before I apply anywhere, I check my match score first.')
    expect(line.words).toHaveLength(10)
    expect(line.words.every((w, i) => i === 0 || w.start >= line.words[i - 1]!.end)).toBe(true)
    const row = await getVoiceLine(h.deps, h.ctx, lineId)
    expect((row.meta as { voiceId?: string }).voiceId).toBe('voice-test-1')
  })

  it('a post picks it as the voiceover: its words are copied, and the captions follow them', async () => {
    const post = (await createContent(h.deps, h.ctx, { kind: 'meme', characterId, spec: { clipId, caption: 'typed caption' } })).id
    await updateContent(h.deps, h.ctx, post, { spec: { sound: { voice: { id: lineId, at: 0.5 } } } })
    const spec = (await getContent(h.deps, h.ctx, post)).spec as MemeSpec
    expect(spec.sound.voice).toMatchObject({ id: lineId, at: 0.5, captions: true, title: 'Check my match score' })
    expect(spec.sound.voice!.words).toHaveLength(10)
    const view = await postCutView(h.deps, h.ctx, post)
    expect(view.captions.length).toBeGreaterThan(1)
    expect(view.captions.map(c => c.shown).join(' ')).toBe('Before I apply anywhere, I check my match score first.')
    expect(view.captions[0]!.start).toBeGreaterThanOrEqual(0.5)
    // The editor gets the voice on its own track and the same captions.
    const m = await editorManifest(h.deps, h.ctx, post)
    expect(m.media.find(x => x.role === 'voice')).toMatchObject({ kind: 'audio', start: 0.5 })
    expect(m.captions.map(c => c.text)).toEqual(view.captions.map(c => c.shown))
  })

  it('renders with the voice in front: ambience dips under it, the mix at -14 LUFS', async () => {
    const post = (await createContent(h.deps, h.ctx, { kind: 'meme', characterId, spec: { clipId, caption: 'typed caption', sound: { ambience: 'room' } } })).id
    await updateContent(h.deps, h.ctx, post, { spec: { sound: { ambience: 'room', voice: { id: lineId, at: 0.3 } } } })
    await startRender(h.deps, h.ctx, post)
    await drain(h, 30)
    const row = await getContent(h.deps, h.ctx, post)
    expect(row.status).toBe('ready')
    const out = row.outputs as ContentOutputs
    expect(out.sound!.layers).toEqual(['ambience', 'voice'])
    const p = join(dir, 'voiced.mp4')
    await writeFile(p, (await readAsset(h.deps, h.ctx, out.videoAssetId!)).data)
    const l = await measureLoudness(p)
    expect(l.i).toBeGreaterThan(-15.5)
    expect(l.i).toBeLessThan(-12.5)
  })

  it('switching captions off keeps the typed caption; a batch never takes a voiceover', async () => {
    const post = (await createContent(h.deps, h.ctx, { kind: 'meme', characterId, spec: { clipId, caption: 'typed caption' } })).id
    await updateContent(h.deps, h.ctx, post, { spec: { sound: { voice: { id: lineId, at: 0, captions: false } } } })
    expect((await postCutView(h.deps, h.ctx, post)).captions.map(c => c.shown)).toEqual(['typed caption'])
    const batch = (await createContent(h.deps, h.ctx, { kind: 'batch', characterId })).id
    await updateContent(h.deps, h.ctx, batch, { spec: { sound: { voice: { id: lineId, at: 0 } } } })
    expect(((await getContent(h.deps, h.ctx, batch)).spec as { sound: { voice: unknown } }).sound.voice).toBeNull()
  })

  it('a line that is not converted, or is another character\'s, is refused in plain words', async () => {
    const other = (await listVoiceLines(h.deps, h.ctx, characterId)).find(l => l.status === 'take')!
    const post = (await createContent(h.deps, h.ctx, { kind: 'meme', characterId, spec: { clipId, caption: 'x' } })).id
    await expect(updateContent(h.deps, h.ctx, post, { spec: { sound: { voice: { id: other.id, at: 0 } } } })).rejects.toThrow(/not in the character's voice yet/)
  })
})

describe('the ElevenLabs adapter', () => {
  const OPTS: SubmitOptions = { idempotencyKey: 'test' }
  it('sends the take to speech to speech, then times the words, with the key in a header only', async () => {
    const { createElevenLabsAdapter } = await import('../providers/elevenlabs.js')
    const calls: Array<{ url: string; key: string | null; fields: string[] }> = []
    const fakeMp3 = Buffer.concat([Buffer.from('ID3'), Buffer.alloc(64)])
    const fetchImpl = (async (url: string | URL, init?: RequestInit) => {
      const form = init?.body as FormData
      calls.push({ url: String(url), key: new Headers(init?.headers).get('xi-api-key'), fields: [...form.keys()] })
      if (String(url).includes('speech-to-speech')) return new Response(fakeMp3, { status: 200 })
      return Response.json({ text: 'hi there', words: [{ text: 'hi', start: 0.1, end: 0.3, type: 'word' }, { text: ' ', start: 0.3, end: 0.35, type: 'spacing' }, { text: 'there', start: 0.35, end: 0.7, type: 'word' }] })
    }) as typeof fetch
    const store = h.deps.store
    const a = createElevenLabsAdapter({ config: h.deps.config, store, loadAsset: async () => Buffer.from('RIFF....WAVE'), apiKey: 'sk_test_key', fetchImpl })
    const { jobId } = await a.submit({ kind: 'audio', model: 'elevenlabs/sts-v2', prompt: 'hi there', refs: [{ assetId: 'ast_x' }], voiceId: 'v1', durationSec: 1 }, OPTS)
    expect(calls.map(c => c.url)).toEqual(['https://api.elevenlabs.io/v1/speech-to-speech/v1?output_format=mp3_44100_128', 'https://api.elevenlabs.io/v1/speech-to-text'])
    expect(calls.every(c => c.key === 'sk_test_key')).toBe(true)
    expect(calls[0]!.fields).toEqual(['audio', 'model_id'])
    expect(calls[1]!.fields).toEqual(['file', 'model_id', 'timestamps_granularity'])
    const status = await a.status(jobId)
    expect(status.state).toBe('succeeded')
    const outs = await a.result(jobId)
    expect(JSON.parse((await a.download!(outs[1]!)).toString())).toEqual([{ text: 'hi', start: 0.1, end: 0.3 }, { text: 'there', start: 0.35, end: 0.7 }])
    expect((await a.download!(outs[0]!)).subarray(0, 3).toString()).toBe('ID3')
  })

  it('a refused key or voice is a plain error, not a charge', async () => {
    const { createElevenLabsAdapter } = await import('../providers/elevenlabs.js')
    const fetchImpl = (async () => new Response('{"detail":{"status":"voice_not_found"}}', { status: 404 })) as typeof fetch
    const a = createElevenLabsAdapter({ config: h.deps.config, store: h.deps.store, loadAsset: async () => Buffer.from('x'), apiKey: 'k', fetchImpl })
    await expect(a.submit({ kind: 'audio', model: 'elevenlabs/sts-v2', prompt: '', refs: [{ assetId: 'a' }], voiceId: 'nope' }, OPTS)).rejects.toThrow(/ElevenLabs answered 404/)
  })
})
