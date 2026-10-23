import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { and, eq, inArray } from 'drizzle-orm'
import { createHarness, drain, type Harness } from '../testing/harness.js'
import { startFakeDrive, type FakeDrive } from '../testing/fakeDrive.js'
import { registerPipelineHooks } from './hooks.js'
import { estimateAction, runAction } from './actions.js'
import { importCharacter } from './files.js'
import { createFacelessCharacter, facelessOf, importPlaces } from './faceless.js'
import { renameSocialAccount, saveSocialAccount, scoreboard } from './scaleKit.js'
import { applyFit, bankPage, checkWeek, drawWeek, importLines, importWeek, previewWeek, reviewLog, saveFill, sendWeek, setLock, setReview, weekView } from './weeks.js'
import { driveAuthUrl, driveCallback, driveStatus, setDriveRoot } from './drive.js'
import { saveCredential } from '../providers/credentials.js'
import { getContent } from './content.js'
import { renderPlaceholderPortrait } from '../providers/mock.js'
import { bankLines, contentItems, jobs } from '../db/schema.js'
import { newId } from '../lib/ids.js'
import { ruleBreaks, type PoolLine } from '../core/weeks.js'
import { parseCsv } from '../core/csvImport.js'

// Weeks (UX-PLAN.md section 37) in demo mode: a 20-row plan for Callie and
// Doug imported, filled from the bank under the rules, fitted to voice,
// checked, two posts made (each video chained to its still), approved, and
// sent to a fake Google Drive with its manifest. Nothing real runs.

let h: Harness
let drive: FakeDrive
let callie: string, doug: string
const MONDAY = '2026-10-26'
const days = ['2026-10-26', '2026-10-27', '2026-10-28', '2026-10-29', '2026-10-30', '2026-10-31', '2026-11-01']

// 14 Callie rows (two a day: a clip and a photo, Wednesday a slideshow, two
// lines given) and 6 Doug rows (faceless, one a day but Sunday).
const q = (v: string) => (/[",\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v)
function plan(): string {
  const head = ['row_id', 'account', 'date', 'slot', 'post_type', 'story_beat', 'line', 'outfit', 'scene', 'clip_action', 'caption', 'hashtags', 'slide_2', 'slide_3', 'place_id', 'device_id']
  const rows: string[][] = []
  days.forEach((d, i) => {
    rows.push([`C${i}a`, 'callie_tt_01', d, '1', 'clip', `day ${i + 1}: her roommate checks the portal`, i === 0 ? 'my roommate got rejected at 7:02am. she made pancakes anyway' : '', i === 3 ? '' : 'oversized gray hoodie', 'their small kitchen, morning light', 'she reads the email on her phone and puts it face down', 'monday', 'roommate jobsearch', '', '', '', ''])
    rows.push([`C${i}b`, 'callie_tt_01', d, '2', i === 2 ? 'slideshow' : 'photo', `day ${i + 1}: evening`, i === 5 ? 'the landlord texted happy friday and raised rent $400' : '', 'black tank top, jeans', 'on the couch at night, one lamp on', '', '', '', i === 2 ? 'she read it out loud' : '', i === 2 ? 'we ate in silence' : '', '', ''])
    if (i < 6) rows.push([`D${i}`, 'doug_tt_01', d, '1', 'faceless', i === 0 ? 'checking the mailbox in the rain' : `day ${i + 1} of nothing`, '', '', '', '', `day ${41 + i}`, 'unemployed', '', '', i === 1 ? 'IS016' : '', 'DEVICE-07'])
  })
  return [head.join(','), ...rows.map(r => r.map(q).join(','))].join('\n')
}

// A bank of passed lines: job lines and life lines, across pains,
// emotions, formats and voice fits.
async function seedBank(): Promise<void> {
  const pains = ['ghosted', 'lowball pay', 'unpaid test', 'layoff', 'no reply', 'entry level', 'rent', 'family']
  const emotions = ['angry', 'sad', 'frustrated', 'crying', 'infuriated'], formats = ['finished damage', 'meme setup', 'question', 'list']
  const values = Array.from({ length: 90 }, (_, i) => ({
    id: newId('bl'), accountId: h.ctx.accountId, importId: 'bim_seed', comment: `comment ${i}`, likes: 1000 - i, state: 'written', passed: true,
    line: `line ${i}: they said ${i + 2} weeks and it has been ${i + 9}`, source: 'comment', lifeOrJob: i % 3 === 0 ? 'life' : 'job',
    tags: { emotion: emotions[i % 5]!, topic: 'applications', pain: pains[i % 8]!, fits: (['both', 'secondhand', 'first'] as const)[i % 3]!, format: formats[(i * 3) % 4]!, fight: false, fightReason: '' },
  }))
  await h.deps.db.insert(bankLines).values(values)
}

beforeAll(async () => {
  registerPipelineHooks()
  drive = await startFakeDrive()
  h = await createHarness({ env: { GOOGLE_API_BASE: drive.url, GOOGLE_OAUTH_BASE: drive.url, GOOGLE_ACCOUNTS_BASE: drive.url } })
  const md = readFileSync(join(process.cwd(), 'fixtures', 'callie', 'character-callie.md'), 'utf8')
  const images: Record<string, { data: Buffer }> = {}
  for (let i = 0; i <= 11; i++) images[`REF-${String(i).padStart(2, '0')}`] = { data: await renderPlaceholderPortrait(`REF-${i}`) }
  callie = (await importCharacter(h.deps, h.ctx, md, { images })).characterId
  doug = (await createFacelessCharacter(h.deps, h.ctx, { name: '', template: 'doug' })).id
  await seedBank()
}, 180_000)
afterAll(async () => { await drive?.stop() })

describe('Accounts', () => {
  it('each account carries a Device ID, platform, slots per day and a life/job blend, defaults by character', async () => {
    await saveSocialAccount(h.deps, h.ctx, 'callie_tt_01', { characterId: callie, deviceId: 'DEVICE-01', slotsPerDay: 2 })
    await saveSocialAccount(h.deps, h.ctx, 'doug_tt_01', { characterId: doug })
    const board = await scoreboard(h.deps, h.ctx)
    const c = board.accounts.find(a => a.tag === 'callie_tt_01')!, d = board.accounts.find(a => a.tag === 'doug_tt_01')!
    expect(c).toMatchObject({ deviceId: 'DEVICE-01', platform: 'tiktok', slotsPerDay: 2, lifeShare: 70, lifeShareSet: false, kind: 'person', characterName: 'Callie' })
    expect(d).toMatchObject({ lifeShare: 0, kind: 'faceless', slotsPerDay: 3 })
    await saveSocialAccount(h.deps, h.ctx, 'callie_ig_01', { characterId: callie, lifeShare: 60 })
    expect((await scoreboard(h.deps, h.ctx)).accounts.find(a => a.tag === 'callie_ig_01')).toMatchObject({ platform: 'instagram', lifeShare: 60, lifeShareSet: true })
  })
})

describe('Doug\'s places', () => {
  it('imports doug-places.csv: 100 places with their motion line and still, into his bank of 6', async () => {
    const csv = readFileSync(join(process.cwd(), 'docs', 'content', 'doug-places.csv'), 'utf8')
    const r = await importPlaces(h.deps, h.ctx, doug, csv)
    expect(r).toMatchObject({ added: 100, replaced: 0, total: 106, drafted: 0 })
    const ch = await import('./characters.js').then(m => m.getCharacter(h.deps, h.ctx, doug))
    const place = facelessOf(ch).places.find(p => p.id === 'IS015')!
    expect(place.motion).toMatch(/^Rain falls/)
    expect(place.stillJobId).toBe('76f886da-64e3-40ca-8b4b-d0fabae1e227')
    // A place with no motion gets one drafted.
    const again = await importPlaces(h.deps, h.ctx, doug, 'place_id,scene\nX1,"a parked car in the rain, wipers off"\n')
    expect(again).toMatchObject({ added: 1, drafted: 1 })
    expect(facelessOf(await import('./characters.js').then(m => m.getCharacter(h.deps, h.ctx, doug))).places.find(p => p.id === 'X1')!.motion).toMatch(/^Rain keeps falling/)
  })
})

describe('a week, from the plan CSV to Google Drive', () => {
  let ids: Record<string, string> = {}
  it('Import: the free preview, then 20 drafts on the grid; the last line names the next step', async () => {
    const p = await previewWeek(h.deps, h.ctx, plan())
    expect(p.problems).toEqual([])
    expect(p.totals).toMatchObject({ rows: 20, ok: 20, problem: 0, withLine: 2 })
    expect(p.weeks).toEqual([MONDAY])
    const r = await importWeek(h.deps, h.ctx, plan(), { rows: p.rows.map(x => x.rowId) })
    expect(r).toMatchObject({ created: 20, replaced: 0, skipped: 0, weeks: [MONDAY], noLine: 18 })
    ids = Object.fromEntries(r.posts.map(x => [x.rowId, x.id]))
    const v = await weekView(h.deps, h.ctx, MONDAY)
    expect(v.cells).toHaveLength(20)
    expect(v.step).toBe('fill')
    expect(v.counts.noLine).toBe(18)
    // Accounts down, days across.
    expect(v.accounts.slice(0, 2).map(a => a.tag).sort()).toEqual(['callie_tt_01', 'doug_tt_01'])
    expect(v.days).toEqual(days)
    // A faceless row with a place that has its own still pulls it (free).
    expect(r.pulls).toBe(1)
  })

  it('Import again asks Replace or Add, never silent', async () => {
    await expect(importWeek(h.deps, h.ctx, plan(), { rows: ['C0a'] })).rejects.toThrow(/Replace them .* or Add as new posts/)
  })

  it('Fill: the draw shows first, holds rules a to e, Redraw per slot, Lock keeps a slot; then Save', async () => {
    const d1 = await drawWeek(h.deps, h.ctx, MONDAY, { seed: 7, redraw: 'empty' })
    expect(d1.rows).toHaveLength(20)
    expect(d1.drawn + d1.rows.filter(r => r.kept).length + d1.empty).toBe(20)
    // Nothing saved by a draw.
    expect((await weekView(h.deps, h.ctx, MONDAY)).counts.noLine).toBe(18)
    const lines = await h.deps.db.select().from(bankLines).where(eq(bankLines.accountId, h.ctx.accountId))
    const pool = new Map(lines.map(l => [l.id, { id: l.id, text: l.line, pain: (l.tags as { pain: string }).pain, emotion: (l.tags as { emotion: string }).emotion, format: (l.tags as { format: string }).format, fits: (l.tags as { fits: PoolLine['fits'] }).fits, lifeOrJob: l.lifeOrJob as 'life' | 'job', usedAccount: null, fight: false } satisfies PoolLine]))
    const breaks = ruleBreaks(d1.rows.map(r => ({ postId: r.postId, account: r.account, date: r.date, slot: r.slot, line: r.lineId ? pool.get(r.lineId)! : null, lifeOrJob: r.lifeOrJob })))
    expect(breaks).toEqual([])
    // Doug's slots are all job (0/100) and first-person or both lines.
    for (const r of d1.rows.filter(x => x.account === 'doug_tt_01' && x.lineId)) { expect(r.lifeOrJob).toBe('job'); expect(['first', 'both']).toContain(r.fits) }
    // Callie: secondhand or both, about 70% life.
    const cal = d1.rows.filter(x => x.account === 'callie_tt_01')
    for (const r of cal.filter(x => x.lineId)) expect(['secondhand', 'both']).toContain(r.fits)
    expect(cal.filter(r => r.lifeOrJob === 'life').length).toBeGreaterThanOrEqual(9)
    // Redraw one slot: only it changes.
    const one = d1.rows.find(r => r.lineId && !r.kept)!
    const draft = Object.fromEntries(d1.rows.filter(r => !r.kept).map(r => [r.postId, r.lineId]))
    const d2 = await drawWeek(h.deps, h.ctx, MONDAY, { seed: 99, redraw: [one.postId], draft })
    for (const r of d2.rows.filter(x => x.postId !== one.postId && !x.kept)) expect(r.lineId).toBe(draft[r.postId])
    const saved = await saveFill(h.deps, h.ctx, MONDAY, { rows: d2.rows.filter(r => !r.kept).map(r => ({ postId: r.postId, lineId: r.lineId, lifeOrJob: r.lifeOrJob, flag: r.flag })) })
    expect(saved.filled).toBe(d2.rows.filter(r => !r.kept && r.lineId).length)
    // Item 11: every filled post got a visual (Doug's from his place bank).
    expect(saved.drafted).toBeGreaterThan(5)
    const d0 = await getContent(h.deps, h.ctx, ids.D2!)
    expect((d0.spec as { faceless: { placeId: string; videoPrompt: string } }).faceless.placeId).toBeTruthy()
    expect((d0.spec as { faceless: { videoPrompt: string } }).faceless.videoPrompt.length).toBeGreaterThan(10)
    // A line used once is used: every saved line is on its own post, account and day.
    const used = await h.deps.db.select().from(bankLines).where(and(eq(bankLines.accountId, h.ctx.accountId), inArray(bankLines.usedPostId, Object.values(ids))))
    expect(used.length).toBe(saved.filled)
    expect(used.every(u => u.usedDate && u.usedAccountTag)).toBe(true)
    // Lock: a locked slot keeps its line on Redraw all.
    await setLock(h.deps, h.ctx, one.postId, true)
    const d3 = await drawWeek(h.deps, h.ctx, MONDAY, { seed: 5, redraw: 'all' })
    const locked = d3.rows.find(r => r.postId === one.postId)!
    expect(locked).toMatchObject({ kept: true, locked: true })
  })

  it('Fit to voice: priced, before and after, and nothing changes until it is OK\'d', async () => {
    const action = { type: 'week_fit' as const, week: MONDAY, postIds: [ids.C1a!, ids.D1!] }
    const { quote, preview } = await estimateAction(h.deps, h.ctx, action)
    expect(quote.totalMicros).toBeGreaterThan(0)
    expect(preview.title).toMatch(/nothing changes until you OK it/)
    const before = (await getContent(h.deps, h.ctx, ids.C1a!)).spec as { caption: string }
    await runAction(h.deps, h.ctx, action, quote.id, true)
    await drain(h, 20)
    const v = await weekView(h.deps, h.ctx, MONDAY)
    const cell = v.cells.find(c => c.postId === ids.C1a!)!
    expect(cell.fit).toMatchObject({ before: before.caption })
    expect(cell.line).toBe(before.caption)
    await applyFit(h.deps, h.ctx, { postIds: [ids.C1a!], use: true })
    expect(((await getContent(h.deps, h.ctx, ids.C1a!)).spec as { caption: string }).caption).toBe(cell.fit!.after)
  })

  it('Check (free): marks the bad rows with the reason; the rest can run', async () => {
    const r = await checkWeek(h.deps, h.ctx, MONDAY)
    expect(r.checked).toBe(20)
    const v = await weekView(h.deps, h.ctx, MONDAY)
    expect(v.cells.find(c => c.rowId === 'C3a')!.flags).toContain('No outfit')
    expect(v.cells.filter(c => c.flags.length).length).toBe(r.flagged)
    expect(v.counts.unchecked).toBe(0)
  })

  it('Make: one price for two posts, stills first, then each video from its own still', async () => {
    const two = [ids.C1a!, ids.D0!]
    const action = { type: 'week_make' as const, week: MONDAY, postIds: two }
    const { quote, preview } = await estimateAction(h.deps, h.ctx, action)
    expect(quote.totalMicros).toBeGreaterThan(0)
    expect(preview.title).toBe('Make the week: 2 posts, 2 stills then 2 videos')
    const ran = await runAction(h.deps, h.ctx, action, quote.id, true)
    const rows = await h.deps.db.select({ purpose: jobs.purpose, status: jobs.status, request: jobs.request }).from(jobs).where(inArray(jobs.id, ran.jobs.map(j => j.id)))
    // The videos wait for their stills, with no start frame yet.
    const videos = rows.filter(r => /video/.test(r.purpose))
    expect(videos).toHaveLength(2)
    expect(videos.every(r => r.status === 'waiting' && !(r.request as { startFrame?: unknown }).startFrame)).toBe(true)
    await drain(h, 60)
    const after = await h.deps.db.select({ purpose: jobs.purpose, status: jobs.status, request: jobs.request }).from(jobs).where(inArray(jobs.id, ran.jobs.map(j => j.id)))
    expect(after.every(r => r.status === 'completed')).toBe(true)
    for (const r of after.filter(x => /video/.test(x.purpose))) expect((r.request as { startFrame?: { assetId: string } }).startFrame?.assetId).toBeTruthy()
    const v = await weekView(h.deps, h.ctx, MONDAY)
    for (const id of two) expect(v.cells.find(c => c.postId === id)).toMatchObject({ made: true, hasVideo: true })
    expect(v.counts.toReview).toBe(2)
  })

  it('Review: Approve and Kill, every call logged; Redo shows its price', async () => {
    await setReview(h.deps, h.ctx, ids.C1a!, 'approved')
    await setReview(h.deps, h.ctx, ids.D0!, 'approved')
    await setReview(h.deps, h.ctx, ids.C6b!, 'killed')
    const v = await weekView(h.deps, h.ctx, MONDAY)
    expect(v.counts.approved).toBe(2)
    expect(v.counts.killed).toBe(1)
    expect((await reviewLog(h.deps, h.ctx)).slice(0, 3).map(c => c.call)).toEqual(['killed', 'approved', 'approved'])
    const redo = await estimateAction(h.deps, h.ctx, { type: 'week_redo', week: MONDAY, postIds: [ids.C1a!] })
    expect(redo.quote.totalMicros).toBeGreaterThan(0)
    expect(redo.preview.title).toMatch(/^Redo 1 post/)
  })

  it('Send to Drive: ROOT / CHARACTER / week of / files named date_slot_account_rowid, a manifest Sheet and CSV; again replaces, never duplicates', async () => {
    await saveCredential(h.deps, h.ctx, 'google_oauth', '123-abc.apps.googleusercontent.com:secret-xyz')
    const url = new URL(await driveAuthUrl(h.deps, h.ctx, 'http://studio.test'))
    expect(url.searchParams.get('scope')).toMatch(/drive\.file/)
    await driveCallback(h.deps, h.ctx, { code: 'fake-code', state: url.searchParams.get('state')!, origin: 'http://studio.test' })
    expect(await driveStatus(h.deps, h.ctx, 'http://studio.test')).toMatchObject({ connected: true, client: true, email: 'owner@example.com' })
    await setDriveRoot(h.deps, h.ctx, { create: 'Studio test' })
    const sent = await sendWeek(h.deps, h.ctx, MONDAY, {})
    expect(sent.posts).toBe(2)
    await drain(h, 30)
    const [job] = await h.deps.db.select().from(jobs).where(eq(jobs.id, sent.jobId))
    expect(job!.status).toBe('completed')
    const f = drive.files()
    const root = f.find(x => x.name === 'Studio test')!
    const callieFolder = f.find(x => x.name === 'Callie' && x.parents.includes(root.id))!
    const dougFolder = f.find(x => x.name === 'Doug' && x.parents.includes(root.id))!
    const week = f.find(x => x.name === `week of ${MONDAY}` && x.parents.includes(callieFolder.id))!
    expect(f.find(x => x.name === `week of ${MONDAY}` && x.parents.includes(dougFolder.id))).toBeTruthy()
    const clip = f.find(x => x.name === `${days[1]}_1_callie_tt_01_C1a.mp4`)!
    expect(clip.parents).toEqual([week.id])
    expect(clip.data.length).toBeGreaterThan(1000)
    expect(f.find(x => x.name === `${MONDAY}_1_doug_tt_01_D0.mp4`)).toBeTruthy()
    const sheet = f.find(x => x.name === `manifest ${MONDAY}` && x.parents.includes(week.id))!
    expect(sheet.mimeType).toBe('application/vnd.google-apps.spreadsheet')
    const csv = parseCsv(f.find(x => x.name === `manifest ${MONDAY}.csv` && x.parents.includes(week.id))!.data.toString('utf8'))
    expect(csv[0]).toEqual(['Device ID', 'Account', 'file_name', 'caption', 'hashtags', 'date', 'slot', 'sound_name', 'ad_label'])
    expect(csv[1]!.slice(0, 3)).toEqual(['DEVICE-01', 'callie_tt_01', `${days[1]}_1_callie_tt_01_C1a.mp4`])
    // The AI label line in the caption.
    expect(csv[1]![3]).toMatch(/AI-generated/)
    const dougCsv = parseCsv(f.find(x => x.name === `manifest ${MONDAY}.csv` && x.parents.includes(f.find(y => y.name === `week of ${MONDAY}` && y.parents.includes(dougFolder.id))!.id))!.data.toString('utf8'))
    expect(dougCsv[1]!.slice(0, 2)).toEqual(['DEVICE-07', 'doug_tt_01'])
    const count = drive.files().length
    await sendWeek(h.deps, h.ctx, MONDAY, { again: true })
    await drain(h, 30)
    expect(drive.files().length).toBe(count)
    expect(drive.byName(`${days[1]}_1_callie_tt_01_C1a.mp4`)!.versions).toBe(2)
    const v = await weekView(h.deps, h.ctx, MONDAY)
    expect(v.counts.sent).toBe(2)
  })

  it('Renaming an account updates every post', async () => {
    await renameSocialAccount(h.deps, h.ctx, 'callie_tt_01', 'callie_tt_main')
    const rows = await h.deps.db.select({ tag: contentItems.accountTag }).from(contentItems).where(inArray(contentItems.id, Object.entries(ids).filter(([k]) => k.startsWith('C')).map(([, v]) => v)))
    expect(new Set(rows.map(r => r.tag))).toEqual(new Set(['callie_tt_main']))
    const lines = await h.deps.db.select({ tag: bankLines.usedAccountTag }).from(bankLines).where(inArray(bankLines.usedPostId, [ids.C1a!]))
    expect(lines[0]?.tag).toBe('callie_tt_main')
    await renameSocialAccount(h.deps, h.ctx, 'callie_tt_main', 'callie_tt_01')
  })
})

describe('the line bank page', () => {
  it('imports lines with their fields, drops near-matches, filters and downloads', async () => {
    const csv = 'text,source,source_likes,pain,emotion,format,voice_fit,life_or_job\n"my landlord raised rent $400 on my birthday",inventory,1200,rent,angry,finished damage,secondhand,life\n"My landlord raised rent $400 on my birthday!!",inventory,3,rent,angry,finished damage,secondhand,life\n"line 1: they said 3 weeks and it has been 10",claude,0,ghosted,sad,list,both,job\n'
    const dry = await importLines(h.deps, h.ctx, { csv, dryRun: true })
    expect(dry).toMatchObject({ rows: 3, kept: 1, duplicatesInFile: 1, duplicatesInBank: 1, importId: null })
    await importLines(h.deps, h.ctx, { csv })
    const p = await bankPage(h.deps, h.ctx, { lifeOrJob: 'life', source: 'inventory' })
    expect(p.lines.map(l => l.text)).toEqual(['my landlord raised rent $400 on my birthday'])
    expect(p.lines[0]).toMatchObject({ pain: 'rent', emotion: 'angry', fits: 'secondhand', likes: 1200 })
    expect((await bankPage(h.deps, h.ctx, { unused: true })).lines.every(l => !l.usedAccount)).toBe(true)
  })
  it('Tag the bank: priced, one call per 30 lines, life or job on each', async () => {
    await h.deps.db.update(bankLines).set({ lifeOrJob: null }).where(eq(bankLines.accountId, h.ctx.accountId))
    const { quote, preview } = await estimateAction(h.deps, h.ctx, { type: 'bank_retag' })
    expect(quote.totalMicros).toBeGreaterThan(0)
    expect(preview.title).toMatch(/^Tag 91 lines.*\(4 calls\)$/)
    await runAction(h.deps, h.ctx, { type: 'bank_retag' }, quote.id, true)
    await drain(h, 20)
    expect((await bankPage(h.deps, h.ctx, {})).counts.untagged).toBe(0)
  })
})
