import { describe, expect, it } from 'vitest'
import { loadConfig } from '../config/load.js'
import { clearAdult } from '../qa/age.js'
import { driveFolderId, massVerdict, rowsFromCsv, sheetCsvUrl } from './massRecreate.js'
import type { Deps } from '../context.js'

// Mass recreate (item 24): the sheet's rows, the links, and the free first
// pass's verdict. Pure; the whole flow runs in the browser suite.

const deps = { config: loadConfig() } as unknown as Deps
const chars = [{ id: 'chr_c', name: 'Callie' }, { id: 'chr_s', name: 'Solei' }]

describe('mass recreate', () => {
  it('reads the sheet: link, one or two characters left to right, keep or new set, the model, notes; an unknown name is skipped with why', () => {
    const csv = 'URL,Character,Keep place or new set,Motion model,Notes\nhttps://www.tiktok.com/@a/video/1,Callie,keep,Wan 3.0,\nhttps://vm.tiktok.com/xyz,"Callie, Solei",New set,genjutsu,a kitchen at night\nhttps://www.tiktok.com/@c/video/3,Nobody,,,\n,Callie,,,\nhttps://www.tiktok.com/@d/video/4,,keep,Sora 9,\n'
    const rows = rowsFromCsv(deps, csv, chars, 'chr_c')
    expect(rows).toHaveLength(4)
    expect(rows[0]).toMatchObject({ source: { kind: 'tiktok' }, characters: ['chr_c'], place: 'keep', model: 'higgsfield/wan-3.0-motion', status: 'to_fetch', ticked: true })
    expect(rows[1]).toMatchObject({ characters: ['chr_c', 'chr_s'], place: 'new', model: 'higgsfield/genjutsu-motion-control', notes: 'a kitchen at night' })
    expect(rows[2]).toMatchObject({ status: 'skipped', reason: expect.stringMatching(/No character named "Nobody"/) })
    // No character: the batch's; an unknown model: the default, and a note.
    expect(rows[3]).toMatchObject({ characters: ['chr_c'], model: null, notes: expect.stringMatching(/"Sora 9" is not one of the motion models/) })
    expect(() => rowsFromCsv(deps, 'character\nCallie\n', chars, null)).toThrow(/column with the TikTok links/)
  })
  it('turns a sheet or folder link into what is read', () => {
    expect(sheetCsvUrl('https://docs.google.com/spreadsheets/d/1kE5ZFC55EIIhnh-gRGg7syvtcjboxKWEYZFKjxckp3s/edit#gid=42')).toBe('https://docs.google.com/spreadsheets/d/1kE5ZFC55EIIhnh-gRGg7syvtcjboxKWEYZFKjxckp3s/export?format=csv&gid=42')
    expect(sheetCsvUrl('https://docs.google.com/spreadsheets/d/abc_DEF-123/edit')).toMatch(/gid=0$/)
    expect(() => sheetCsvUrl('https://example.com/page')).toThrow(/Google Sheet link/)
    expect(driveFolderId('https://drive.google.com/drive/folders/1AbCdEfGhIjKlMnOp?usp=sharing')).toBe('1AbCdEfGhIjKlMnOp')
    expect(() => driveFolderId('https://drive.google.com/')).toThrow(/folder link/)
  })
  it('the free first pass: no clear adult is skipped; two characters need two people; the length must fit the model', () => {
    const base = { seconds: 8, people: 1, characters: 1, adult: true, ageNote: null, minSec: 4, maxSec: 30, demo: false }
    expect(massVerdict(base)).toMatchObject({ ok: true })
    expect(massVerdict({ ...base, adult: false })).toMatchObject({ ok: false, reason: expect.stringMatching(/No clear adult/) })
    expect(massVerdict({ ...base, adult: null })).toMatchObject({ ok: false, reason: expect.stringMatching(/could not run/) })
    expect(massVerdict({ ...base, characters: 2 })).toMatchObject({ ok: false, reason: expect.stringMatching(/Two characters/) })
    expect(massVerdict({ ...base, people: 3 }).notes.join(' ')).toMatch(/3 people in the clip; the largest is replaced/)
    expect(massVerdict({ ...base, seconds: 2 })).toMatchObject({ ok: false, reason: expect.stringMatching(/takes 4 to 30 s/) })
    expect(massVerdict({ ...base, adult: null, demo: true })).toMatchObject({ ok: true })
  })
  it('a clear adult reads 25 or older with little weight on 20 and under', () => {
    expect(clearAdult([0, 0, 0, 0, 1, 0, 0, 0])).toMatchObject({ adult: true, group: '25-32' })
    expect(clearAdult([0, 0, 0, 0.3, 0.6, 0.1, 0, 0])).toMatchObject({ adult: false, young: 0.3 })
    expect(clearAdult([0, 0, 0.05, 0.7, 0.25, 0, 0, 0])).toMatchObject({ adult: false, group: '15-20' })
  })
})
