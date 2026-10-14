import { describe, expect, it } from 'vitest'
import { csvRows, parseCsv, planRows } from './csvImport.js'

describe('the spreadsheet import', () => {
  it('reads quotes, commas and line breaks inside quotes', () => {
    expect(parseCsv('a,b\n"one, two","say ""hi""\nthere"\r\n,\n')).toEqual([['a', 'b'], ['one, two', 'say "hi"\nthere']])
    expect(parseCsv('\uFEFFcaption;clip\nhey;dance')).toEqual([['caption', 'clip'], ['hey', 'dance']])
    // A semicolon inside a comma file stays in the caption.
    expect(parseCsv('caption,clip\nwait; what,dance')).toEqual([['caption', 'clip'], ['wait; what', 'dance']])
  })

  it('maps forgiving headers and says what is missing', () => {
    const r = csvRows('Character,Account Tag,Clip Name,Video Prompt,Caption,Format,Notes\nCallie,@jobs.callie,dance.mp4,,hello,Crash zoom cut,x')
    expect(r.rows[0]).toEqual({ line: 2, cells: { character: 'Callie', account: '@jobs.callie', clip: 'dance.mp4', video: '', caption: 'hello', style: 'Crash zoom cut' } })
    expect(r.problems).toEqual(['Columns not used: Notes.'])
    expect(csvRows('character,account\nCallie,a').problems).toEqual(['Add a "caption" column (one caption per row).', 'Add a "clip" column (a clip to reuse, or "still: your prompt").'])
  })

  it('plans each row: a reused clip is free, a still prompt is generated, problems are named', () => {
    const { rows } = csvRows([
      'character,account,clip,video,caption,style',
      'callie,@callie.jobs,Dance Take,,entry level 5 years,crash zoom cut',
      'Callie,callie2,"still: at her desk, laptop open",she sighs and looks up,ghosted again,',
      'Mara,x,dance take,,hi,',
      'Callie,x,nope,,,glitter',
    ].join('\n'))
    const plan = planRows(rows, {
      characters: [{ id: 'chr_1', name: 'Callie' }],
      clips: [{ id: 'cand_1', characterId: 'chr_1', title: 'dance-take.mp4' }],
      styles: [{ id: 'crash_zoom', label: 'Crash zoom cut' }],
      max: 50,
    })
    expect(plan[0]).toMatchObject({ status: 'reuse', characterId: 'chr_1', accountTag: 'callie.jobs', clipId: 'cand_1', style: 'crash_zoom' })
    expect(plan[1]).toMatchObject({ status: 'generate', stillPrompt: 'at her desk, laptop open', videoPrompt: 'she sighs and looks up', clipId: null })
    expect(plan[2]).toMatchObject({ status: 'problem', problems: ['No character named "Mara"'] })
    expect(plan[3]!.problems).toEqual(['No clip named "nope" for Callie', 'Write the caption', 'No edit style called "glitter"'])
  })

  it('two characters with one name: the batch\'s own wins, else the row asks', () => {
    const { rows } = csvRows('character,clip,caption\nCallie,still: x,hi')
    const chars = [{ id: 'chr_a', name: 'Callie' }, { id: 'chr_b', name: 'Callie' }]
    expect(planRows(rows, { characters: chars, clips: [], styles: [], defaultCharacterId: 'chr_b', max: 50 })[0]).toMatchObject({ characterId: 'chr_b', status: 'generate' })
    expect(planRows(rows, { characters: chars, clips: [], styles: [], defaultCharacterId: 'chr_x', max: 50 })[0]!.problems).toEqual(['2 characters are called "Callie"; import from that character\'s batch'])
  })

  it('takes at most the batch size', () => {
    const { rows } = csvRows(['caption,clip', ...Array.from({ length: 60 }, (_, i) => `c${i},still: p`)].join('\n'))
    expect(planRows(rows, { characters: [{ id: 'chr_1', name: 'C' }], clips: [], styles: [], defaultCharacterId: 'chr_1', max: 50 })).toHaveLength(50)
  })
})
