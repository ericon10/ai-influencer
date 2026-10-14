
// Voice lines (overnight item 4, DECISIONS G34): the owner performs a line,
// ElevenLabs turns the take into the character's voice and times every
// word. This file is the pure part: what a take's file name says, and the
// captions a voice line makes (short phrases, each with its own word times
// so the karaoke edit lights each word as it is said).

export interface Word { text: string; start: number; end: number }

export interface TakeName {
  // The hook number from the vault ("047" is hook 47), when the name has one.
  hook: number | null
  // The line as the name spells it, in plain words.
  line: string
  title: string
}

// "047_check-my-match-score.wav" is hook 47, "check my match score".
// Names without a number keep their words; dashes, underscores and dots
// read as spaces.
export function parseTakeName(name: string): TakeName {
  const base = name.replace(/^.*[\\/]/, '').replace(/\.[a-z0-9]{1,5}$/i, '')
  const m = base.match(/^\s*(?:hook[\s_-]*)?(\d{1,4})(?:[\s_.-]+|$)(.*)$/i)
  const hook = m ? Number(m[1]) : null
  const rest = (m ? m[2]! : base).replace(/[_\-.]+/g, ' ').replace(/\s+/g, ' ').trim()
  const line = rest
  const title = line ? line.charAt(0).toUpperCase() + line.slice(1) : hook != null ? `Hook ${hook}` : 'Voice line'
  return { hook, line, title }
}

export const hookTag = (hook: number | null) => (hook == null ? '' : `Hook ${hook}`)

export interface PhraseOptions {
  // A phrase ends after this many words, this many seconds, or at a pause
  // this long, or at the end of a sentence or a comma.
  maxWords: number
  maxSec: number
  pauseSec: number
  // At most this many phrases (the cut's caption limit); the shortest
  // neighbors are joined until it fits.
  maxPhrases: number
}

export const PHRASES: PhraseOptions = { maxWords: 6, maxSec: 2.4, pauseSec: 0.35, maxPhrases: 8 }

export interface Phrase { text: string; start: number; end: number; words: Word[] }

const clean = (words: Word[]) => words
  .map(w => ({ text: w.text.trim(), start: Math.max(0, w.start), end: Math.max(w.start, w.end) }))
  .filter(w => w.text)
  .sort((a, b) => a.start - b.start)

// The words in short phrases, the way people read captions: a few words at
// a time, broken where the speaker breaks.
export function phrases(input: Word[], o: PhraseOptions = PHRASES): Phrase[] {
  const words = clean(input)
  const out: Phrase[] = []
  let cur: Word[] = []
  const flush = () => {
    if (!cur.length) return
    out.push({ text: cur.map(w => w.text).join(' '), start: cur[0]!.start, end: cur[cur.length - 1]!.end, words: cur })
    cur = []
  }
  for (const [i, w] of words.entries()) {
    const prev = words[i - 1]
    if (cur.length && prev && (w.start - prev.end >= o.pauseSec || w.end - cur[0]!.start > o.maxSec || cur.length >= o.maxWords)) flush()
    cur.push(w)
    if (/[.!?,;:]["')\]]*$/.test(w.text) && cur.length >= 2) flush()
  }
  flush()
  // Too many: join the shortest neighboring pair until it fits.
  while (out.length > Math.max(1, o.maxPhrases)) {
    let best = 0
    for (let i = 1; i < out.length - 1; i++) {
      const len = (k: number) => out[k]!.words.length + out[k + 1]!.words.length
      if (len(i) < len(best)) best = i
    }
    const a = out[best]!, b = out[best + 1]!
    out.splice(best, 2, { text: `${a.text} ${b.text}`, start: a.start, end: b.end, words: [...a.words, ...b.words] })
  }
  return out
}

const r3 = (n: number) => Math.round(n * 1000) / 1000

// The cut's captions from a voice line that starts `at` seconds into the
// video: one caption per phrase, held until the next phrase starts (the
// last one until a beat after the line ends), each with its word times.
export function voiceCaptions(words: Word[], at: number, o: PhraseOptions & { holdSec?: number; durationSec?: number | null } = PHRASES): Array<{ id: string; text: string; start: number; end: number; words: Word[] }> {
  const list = phrases(words, o)
  const hold = o.holdSec ?? 0.6
  return list.map((p, i) => {
    const next = list[i + 1]
    let end = next ? next.start + at : p.end + at + hold
    if (o.durationSec != null) end = Math.min(end, o.durationSec)
    return {
      id: `voice${i}`,
      text: p.text,
      start: r3(p.start + at),
      end: r3(Math.max(p.start + at + 0.1, end)),
      words: p.words.map(w => ({ text: w.text, start: r3(w.start + at), end: r3(w.end + at) })),
    }
  })
}

// The words as one line of text (what the line says, for the Library).
export const transcript = (words: Word[]) => clean(words).map(w => w.text).join(' ')
