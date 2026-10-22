import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { beforeAll, describe, expect, it } from 'vitest'
import { and, eq } from 'drizzle-orm'
import { createHarness, drain, type Harness } from '../testing/harness.js'
import { registerPipelineHooks } from './hooks.js'
import { estimateAction, runAction, type StudioAction } from './actions.js'
import { importCharacter } from './files.js'
import { createContent, getContent } from './content.js'
import { importKit, starterKit } from './scaleKit.js'
import { renderPlaceholderPortrait } from '../providers/mock.js'
import { bankLines, jobs } from '../db/schema.js'
import { loadConfig } from '../config/load.js'
import { bankView, importBank, setLineCall, setStance, sourcesFor, weekPlan } from './lineBank.js'
import { cleanLine, firstPass, passes, readCaptions, readComments, stanceFrom, videoKey, withCaptions, type LineBankConfig } from '../core/lineBank.js'

// The line bank (UX-PLAN.md section 36, item 29) in demo mode: the import
// and its free first pass, the priced run (tags, writer, reviewer chained per
// batch), the view (only passed lines, filters, one account per line), the
// owner's calls fed back to the writer, Use this line and Write the week.

const cfg = loadConfig().pipeline.content.line_bank as LineBankConfig
const HEAD = 'comment_likes,replies,comment,themes,video_account,video_views,liked_by_creator,video_url\n'
const V1 = 'https://www.tiktok.com/@reb/video/7667755283665472782'
const V2 = 'https://www.tiktok.com/@jes/video/7691460633648237837'
const good = [
  'They laid me off 2 weeks before Christmas and asked me to train my replacement',
  'applied to 300 jobs since May and got ONE interview and they ghosted me',
  '6 rounds of interviews for a job that pays less than my old internship',
  'my mom asks how the job search is going every single dinner',
  'entry level job wanted 5 years of experience and a masters degree',
  'the recruiter said they would be in touch. that was in march',
  'got rejected by an AI before a human ever saw my resume',
  'my rent is due friday and the only offer i got is $14 an hour',
  'i have a degree and i am working the same retail shift as in high school',
]
const csv = HEAD + [
  ...good.map((c, i) => `${1000 - i * 10},3,"${c}",,@reb,13911804,yes,${i % 2 ? V2 : V1}`),
  `5,0,"${good[0]}",,@reb,13911804,,${V1}`,
  '1,0,"my boss fired me for being late once on the first day",,@reb,100,,' + V1,
  '40,1,"so true bestie",,@reb,100,,' + V1,
  '30,2,"ang hirap humanap ng trabaho, any advice naman po sa mga job",,@jes,100,,' + V2,
  '50,0,"this audio is stuck in my head at work now",,@jes,100,,' + V2,
  '60,0,"she looks exactly like my cousin from ohio lol",,@jes,100,,' + V2,
  '70,0,,,@jes,100,,' + V2,
].join('\n')
const videos = `url,text,authorMeta.name\n${V1},this is vulnerableeee but I'm emo today,reb\n${V2},bye cava #quit #unemployed,jes\n`

describe('the free first pass', () => {
  it('reads the comments and the captions, joins them by video, and drops duplicates, 0 or 1 likes, too short, another language, the video itself and off the job search', () => {
    const read = readComments(csv)
    expect(read.missing).toEqual([])
    expect(read.empty).toBe(1)
    const caps = readCaptions(videos)
    expect(caps.count).toBe(2)
    expect(videoKey(`${V1}?is_from_webapp=1`)).toBe('7667755283665472782')
    const rows = withCaptions(read.rows, caps)
    expect(rows[0]!.videoCaption).toMatch(/vulnerableeee/)
    const pass = firstPass(rows, cfg)
    expect(pass.kept.map(r => r.comment)).toEqual(good)
    expect(pass.dropped).toEqual({ duplicate: 1, likes: 1, short: 1, language: 1, video: 1, topic: 1 })
    // The most liked copy of a duplicate is the one kept.
    expect(pass.kept[0]!.likes).toBe(1000)
    expect(readComments('text,hearts\nhi,1\n').missing).toEqual(['comment_likes'])
  })
  it('who tells a line, and the reviewer\'s bar', () => {
    expect(cleanLine('"laid off on a call"')).toBe('laid off on a call')
    expect(cleanLine("'we regret to inform you' for an app from a YEAR ago")).toBe("'we regret to inform you' for an app from a YEAR ago")
    expect(cleanLine('6 rounds — then nothing')).toBe('6 rounds, then nothing')
    expect(stanceFrom('23, laid off from a marketing job in March', cfg)).toBe('first')
    expect(stanceFrom('a nurse who roasts her friends\' job hunts', cfg)).toBe('secondhand')
    expect(passes({ gut: 8, specific: 9, real: 8, setup: false, meh: false, note: '' }, 8)).toBe(true)
    expect(passes({ gut: 7, specific: 9, real: 9, setup: false, meh: false, note: '' }, 8)).toBe(false)
    expect(passes({ gut: 9, specific: 9, real: 9, setup: true, meh: false, note: '' }, 8)).toBe(false)
  })
})

describe('the line bank', () => {
  let h: Harness
  let characterId: string
  let sideStep: string

  async function run(action: StudioAction) {
    const { quote, preview } = await estimateAction(h.deps, h.ctx, action)
    expect(quote.totalMicros).toBeGreaterThan(0)
    const { jobs: ran } = await runAction(h.deps, h.ctx, action, quote.id, true)
    await drain(h, 60)
    return { quote, preview, jobs: ran }
  }

  beforeAll(async () => {
    registerPipelineHooks()
    h = await createHarness()
    const md = readFileSync(join(process.cwd(), 'fixtures', 'callie', 'character-callie.md'), 'utf8')
    const images: Record<string, { data: Buffer }> = {}
    for (let i = 0; i <= 11; i++) images[`REF-${String(i).padStart(2, '0')}`] = { data: await renderPlaceholderPortrait(`Callie REF-${i}`) }
    characterId = (await importCharacter(h.deps, h.ctx, md, { images })).characterId
    sideStep = (await importKit(h.deps, h.ctx, starterKit(), 'SideStep')).product.id
  }, 120_000)

  it('imports free, keeps what passes, counts the drops, and never keeps a comment twice', async () => {
    const imp = await importBank(h.deps, h.ctx, { comments: { csv }, videos: { csv: videos }, name: 'Apify run 1', productId: sideStep })
    expect(imp).toMatchObject({ rows: 15, empty: 1, kept: 9, already: 0, captions: 2, productName: 'SideStep', dropped: { duplicate: 1, likes: 1, short: 1, language: 1, video: 1, topic: 1 } })
    const again = await importBank(h.deps, h.ctx, { comments: { csv } })
    expect(again).toMatchObject({ kept: 0, already: 9 })
    const view = await bankView(h.deps, h.ctx, {})
    expect(view.counts).toMatchObject({ comments: 9, waiting: 9, passed: 0 })
    // Nothing shows before the reviewer has passed it.
    expect(view.lines).toEqual([])
    expect(view.options.pains.length).toBeGreaterThan(5)
    await expect(importBank(h.deps, h.ctx, { comments: { csv: 'a,b\n1,2\n' } })).rejects.toThrow(/needs these columns: comment, comment_likes/)
  })

  it('one price, then per batch: the tags, the writer, a separate reviewer; only lines that pass show, most liked first, each with its source', async () => {
    const { quote, preview, jobs: ran } = await run({ type: 'bank_run', limit: null })
    expect(preview.title).toMatch(/Tag, write and review 9 comments \(1 batch\)/)
    expect(ran.map(j => j.purpose.split(':')[0])).toEqual(['bank_tag', 'bank_write', 'bank_review'])
    expect(quote.items).toHaveLength(3)
    const done = await h.deps.db.select().from(jobs).where(eq(jobs.accountId, h.ctx.accountId))
    expect(done.filter(j => /^bank_/.test(j.purpose)).every(j => j.status === 'completed')).toBe(true)
    // The writer saw the tags; the reviewer saw each line under its comment.
    const write = done.find(j => j.purpose.startsWith('bank_write'))!
    expect((write.request as { prompt: string }).prompt).toMatch(/\[emotion: \w+; topic: [\w ]+; pain: /)
    expect((done.find(j => j.purpose.startsWith('bank_review'))!.request as { prompt: string }).prompt).toMatch(/Source comment \(1000 likes\)/)
    const view = await bankView(h.deps, h.ctx, {})
    expect(view.counts).toMatchObject({ comments: 9, waiting: 0, tagged: 9, written: 9, passed: 6, rejected: 3 })
    expect(view.lines).toHaveLength(6)
    expect(view.lines.map(l => l.likes)).toEqual([...view.lines.map(l => l.likes)].sort((a, b) => b - a))
    expect(view.lines[0]).toMatchObject({ comment: good[0], likes: 1000, videoCaption: expect.stringMatching(/vulnerableeee/), tags: { emotion: expect.any(String), pain: expect.any(String) } })
    expect(view.lines.every(l => (l.score ?? 0) >= 8)).toBe(true)
    // Filters: emotion and topic.
    const t = view.lines[0]!.tags!
    expect((await bankView(h.deps, h.ctx, { topic: t.topic })).lines.every(l => l.tags?.topic === t.topic)).toBe(true)
    expect((await bankView(h.deps, h.ctx, { emotion: t.emotion })).lines.every(l => l.tags?.emotion === t.emotion)).toBe(true)
    await expect(estimateAction(h.deps, h.ctx, { type: 'bank_run' })).rejects.toThrow(/Every comment in the bank has been run/)
  })

  it('a character sees the lines told the way they tell them; the owner\'s Keep or Reject goes to the next writer and reviewer', async () => {
    await setStance(h.deps, h.ctx, characterId, 'first')
    const first = await bankView(h.deps, h.ctx, { characterId })
    expect(first.voice).toMatchObject({ stance: 'first', picked: true })
    expect(first.lines.length).toBeGreaterThan(0)
    expect(first.lines.every(l => l.tags!.fits === 'first' || l.tags!.fits === 'both')).toBe(true)
    await setStance(h.deps, h.ctx, characterId, 'secondhand')
    expect((await bankView(h.deps, h.ctx, { characterId })).lines.every(l => l.tags!.fits !== 'first')).toBe(true)
    await setStance(h.deps, h.ctx, characterId, 'first')

    const kept = first.lines[0]!
    await setLineCall(h.deps, h.ctx, kept.id, 'kept')
    await setLineCall(h.deps, h.ctx, first.lines[1]!.id, 'rejected')
    await importBank(h.deps, h.ctx, { comments: { csv: HEAD + '9,1,"they made me do a 6 hour unpaid take-home for a job that got reposted",,@reb,100,,x\n' }, productId: sideStep })
    const { preview } = await estimateAction(h.deps, h.ctx, { type: 'bank_run' })
    const writer = preview.prompts.find(p => p.label.startsWith('Writer'))!.text
    expect(writer).toContain(`Lines the owner kept:\n- ${kept.line}`)
    expect(writer).toContain(`Lines the owner rejected:\n- ${first.lines[1]!.line}`)
    expect(preview.prompts.find(p => p.label === 'Reviewer')!.text).toContain(kept.line)
  })

  it('Use this line: priced, in the character\'s voice, placed as the hook; then it never shows for another account', async () => {
    const post = await createContent(h.deps, h.ctx, { kind: 'slideshow', characterId, accountTag: 'callie.jobs', idea: 'job hunting', productId: sideStep })
    const line = (await bankView(h.deps, h.ctx, { characterId, accountTag: 'callie.jobs' })).lines[0]!
    const { preview } = await run({ type: 'bank_use', lineId: line.id, contentId: post.id })
    expect(preview.prompts[0]!.text).toMatch(/They tell lines in the first person/)
    expect(((await getContent(h.deps, h.ctx, post.id)).spec as { hook: string }).hook).toBe(line.line)
    const [row] = await h.deps.db.select().from(bankLines).where(and(eq(bankLines.accountId, h.ctx.accountId), eq(bankLines.id, line.id)))
    expect(row).toMatchObject({ usedPostId: post.id, usedAccountTag: 'callie.jobs', usedText: line.line })
    expect((await bankView(h.deps, h.ctx, { characterId, accountTag: 'callie.jobs' })).lines.some(l => l.id === line.id)).toBe(true)
    expect((await bankView(h.deps, h.ctx, { characterId, accountTag: 'callie.money' })).lines.some(l => l.id === line.id)).toBe(false)
    const other = await createContent(h.deps, h.ctx, { kind: 'slideshow', characterId, accountTag: 'callie.money', idea: 'job hunting' })
    await expect(estimateAction(h.deps, h.ctx, { type: 'bank_use', lineId: line.id, contentId: other.id })).rejects.toThrow(/used on @callie.jobs; a line goes to one account only/)
    expect((await sourcesFor(h.deps, h.ctx, [post.id])).get(post.id)).toMatchObject({ comment: expect.any(String), likes: line.likes })
  })

  it('Write the week fills the account\'s posts dated in the next 7 days, one unused line each, kept lines first', async () => {
    const day = (n: number) => new Date(h.deps.clock.now().getTime() + n * 86_400_000).toISOString().slice(0, 10)
    const a = await createContent(h.deps, h.ctx, { kind: 'slideshow', characterId, accountTag: 'callie.week', idea: 'a', spec: { hook: 'old words', plan: { rowId: 'P101', date: day(1) } } })
    const b = await createContent(h.deps, h.ctx, { kind: 'slideshow', characterId, accountTag: 'callie.week', idea: 'b', spec: { plan: { rowId: 'P102', date: day(2) } } })
    await createContent(h.deps, h.ctx, { kind: 'slideshow', characterId, accountTag: 'callie.week', idea: 'later', spec: { plan: { rowId: 'P199', date: day(12) } } })
    const plan = await weekPlan(h.deps, h.ctx, 'callie.week')
    expect(plan.posts.map(p => p.label)).toEqual(['P101', 'P102'])
    expect(plan.posts[0]!.current).toBe('old words')
    const { preview } = await run({ type: 'bank_week', accountTag: 'callie.week' })
    expect(preview.title).toBe('Write the week: 2 posts on @callie.week')
    expect(preview.warnings[0]!.message).toMatch(/1 of these posts have words on slide 1/)
    const hooks = await Promise.all([a, b].map(async p => ((await getContent(h.deps, h.ctx, p.id)).spec as { hook: string }).hook))
    expect(hooks.every(x => x && x !== 'old words')).toBe(true)
    expect(new Set(hooks).size).toBe(2)
    expect((await weekPlan(h.deps, h.ctx, 'callie.week')).posts).toEqual([])
  })
})
