import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { PLAN_COLUMNS, readPlan } from './planImport.js'

// The plan reader is column-driven (owner, 2026-10-16): a rewritten launch
// plan with the same columns replaces the test file later, so every value
// is read by its header's name, never by its place.

const CSV = readFileSync(join(process.cwd(), 'docs', 'content', 'launch-plan-v2-posts.csv'), 'utf8')

// The same table with its columns in another order, one optional column
// left out and one column the Studio does not know added.
function reshaped(text: string, order: (h: string[]) => number[], extra?: { name: string; value: string }): string {
  const lines = parseLines(text)
  const head = lines[0]!
  const idx = order(head)
  const out = lines.map((cells, n) => [...idx.map(i => cells[i] ?? ''), ...(extra ? [n === 0 ? extra.name : extra.value] : [])])
  return out.map(cells => cells.map(c => /[",\n]/.test(c) ? `"${c.replace(/"/g, '""')}"` : c).join(',')).join('\n')
}

// A small CSV reader for the test (quoted cells, doubled quotes, line breaks in quotes).
function parseLines(text: string): string[][] {
  const rows: string[][] = []
  let row: string[] = [], cell = '', q = false
  for (let i = 0; i < text.length; i++) {
    const ch = text[i]!
    if (q) {
      if (ch === '"' && text[i + 1] === '"') { cell += '"'; i++ } else if (ch === '"') q = false; else cell += ch
    } else if (ch === '"') q = true
    else if (ch === ',') { row.push(cell); cell = '' } else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && text[i + 1] === '\n') i++
      row.push(cell); rows.push(row); row = []; cell = ''
    } else cell += ch
  }
  if (cell || row.length) { row.push(cell); rows.push(row) }
  return rows.filter(r => r.some(Boolean))
}

describe('the plan reader', () => {
  it('reads every value by its column name: another order, a column left out, a column it does not know', () => {
    const base = readPlan(CSV)
    expect(base.rows).toHaveLength(140)
    expect(base.missing).toEqual([])
    expect(base.unknown).toEqual([])

    const text = reshaped(CSV, head => head.map((_, i) => i).filter(i => head[i] !== 'notes').reverse(), { name: 'Reviewer Notes', value: 'checked' })
    const moved = readPlan(text)
    expect(moved.missing).toEqual([])
    expect(moved.unknown).toEqual(['reviewer_notes'])
    expect(moved.rows).toHaveLength(140)
    for (const [i, r] of moved.rows.entries()) {
      const b = base.rows[i]!
      for (const c of PLAN_COLUMNS.filter(c => c !== 'notes')) expect(r.cells[c], `${b.cells.row_id} ${c}`).toBe(b.cells[c])
      expect(r.cells.notes).toBe('')
    }
  })

  it('headers are matched without regard to case or spaces; a required column missing is named', () => {
    const lines = CSV.split('\n')
    const head = lines[0]!.replace('row_id', 'Row ID').replace('hook', 'HOOK')
    const read = readPlan([head, ...lines.slice(1)].join('\n'))
    expect(read.missing).toEqual([])
    expect(read.rows[0]!.cells.row_id).toBe('P001')
    expect(read.rows[0]!.cells.hook).toMatch(/^Exhibit 1/)
    const noHook = reshaped(CSV, h => h.map((_, i) => i).filter(i => h[i] !== 'hook'))
    expect(readPlan(noHook).missing).toEqual(['hook'])
  })
})
