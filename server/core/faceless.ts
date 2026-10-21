// Faceless characters (owner, 2026-10-22; UX-PLAN.md section 35, item 4):
// an account with no face. Its file holds a persona (who, town, life
// details), a place bank (reusable scenes, picked per post like set
// plates), look rules, the voice and line formats, and a sound bank (music
// beds and voiceover clips with their search words). Pure: the file's
// shape, the first one (Doug), and the still prompt with its rules.

export interface FacelessPlace { id: string; name: string; line: string }
export interface FacelessSound { id: string; kind: 'music' | 'voiceover'; name: string; search: string; soundId?: string | null }
export interface FacelessFile {
  persona: { who: string; town: string; life: string }
  places: FacelessPlace[]
  look: string[]
  voice: { notes: string; formats: string[] }
  sounds: FacelessSound[]
}

export const EMPTY_FACELESS: FacelessFile = { persona: { who: '', town: '', life: '' }, places: [], look: [], voice: { notes: '', formats: [] }, sounds: [] }

// The first one (owner, 2026-10-22): Doug, 31, Peoria IL, laid-off
// contract data entry, rainy Midwest everyday life, never named on screen.
export const DOUG: { name: string; file: FacelessFile } = {
  name: 'Doug',
  file: {
    persona: {
      who: 'Doug, 31. Laid off from a contract data entry job. Never named on screen, never seen.',
      town: 'Peoria, Illinois',
      life: 'Rainy Midwest everyday life: a used sedan, a one-bedroom apartment, gas station coffee, the unemployment office, a laptop on the kitchen table, a long drive with nowhere to be.',
    },
    places: [
      { id: 'car-rain', name: 'Car, rain on the windshield', line: 'the inside of a parked used sedan, rain streaming down the windshield, a gray parking lot outside, wipers off' },
      { id: 'kitchen-table', name: 'Kitchen table at night', line: 'a small apartment kitchen table at night, a closed laptop, a half-empty mug, one overhead light, a dark window behind' },
      { id: 'gas-station', name: 'Gas station at dusk', line: 'an empty gas station forecourt at dusk, wet concrete, the pumps lit, a gray sky over Peoria' },
      { id: 'apartment-window', name: 'Apartment window, overcast', line: 'a one-bedroom apartment window on an overcast afternoon, rain on the glass, bare parking lot and bare trees outside' },
      { id: 'highway', name: 'Highway from the passenger seat', line: 'a two-lane Illinois highway from the passenger seat, flat wet fields, low gray clouds, the road ahead empty' },
      { id: 'laundromat', name: 'Laundromat, late', line: 'an empty laundromat late at night, plastic chairs, one dryer turning, fluorescent light on a wet tile floor' },
    ],
    look: [
      'No person or body part in the frame (hands read as AI).',
      'No objects that carry text: no packaging, screens, paper, mail, signs or labeled buttons.',
      'A plain phone snapshot of a real place, upright portrait, level.',
      'Muted, rainy Midwest color.',
    ],
    voice: {
      notes: 'Flat, tired, dry. Says the hard thing plainly. Never asks for pity.',
      formats: ['The on-screen line states one finished thing that hurt ("they replaced me with a spreadsheet macro").', 'Present tense, lowercase, no hashtags on screen.'],
    },
    sounds: [
      { id: 'sad-piano', kind: 'music', name: 'Sad piano bed', search: 'slow sad piano', soundId: null },
      { id: 'rain-ambient', kind: 'music', name: 'Rain and low synth', search: 'rain ambient sad', soundId: null },
      { id: 'vo-it-is-what-it-is', kind: 'voiceover', name: 'It is what it is', search: 'it is what it is', soundId: null },
    ],
  },
}

// The still rules (owner, 2026-10-22, item 4c), from what worked on Soul:
// no person or body part, no object that carries text (Soul writes
// gibberish on them), a plain phone snapshot with "upright portrait" and
// "level" ("slightly tilted" made Soul rotate the frame), and a fixed
// ending. Soul 2.0, 9:16.
export const FACELESS_STILL_MODEL = 'higgsfield/soul-2'
export const FACELESS_ASPECT = '9:16'
export const FACELESS_ENDING = 'Level, unedited. Sharp, real phone grain, muted color. No people.'
const SNAPSHOT = 'A plain phone snapshot of a real place, upright portrait, level.'
const PERSON = /\b(?:hands?|fingers?|arms?|legs?|feet|foot|face|faces|person|people|man|men|woman|women|guy|girl|boy|someone|somebody|he|she|his|her|him|they|their|doug|selfie|reflection of)\b/i
const TEXTY = /\b(?:packag\w*|box(?:es)?|cereal|label\w*|screens?|phones?|laptop screen|monitor|tv|television|paper\w*|mail|envelope\w*|letters?|receipts?|signs?|signage|billboard\w*|posters?|buttons?|keyboard|calendar|notes?|sticky notes?|menus?|newspaper|book cover|logo\w*)\b/i
const TILT = /\b(?:slightly\s+)?(?:tilted|tilt|dutch angle|canted|crooked|askew|rotated)\b/gi

export interface FacelessStill { prompt: string; warnings: Array<{ id: 'faceless-person' | 'faceless-text' | 'faceless-tilt'; message: string; match: string }> }

// The still prompt: the place (from the bank or written for this post),
// the post's moment if any, the look rules that are about the picture, and
// the fixed ending. Tilt words are taken out (Soul rotated the frame).
export function facelessStillPrompt(input: { place?: FacelessPlace | null; line?: string; moment?: string; look?: string[] }): FacelessStill {
  const warnings: FacelessStill['warnings'] = []
  const raw = [input.line?.trim() || input.place?.line || '', input.moment?.trim() ?? ''].filter(Boolean).join('. ')
  const tilt = raw.match(TILT)
  if (tilt) warnings.push({ id: 'faceless-tilt', match: tilt[0], message: `"${tilt[0]}" was taken out: Soul rotates the whole frame. The still stays level.` })
  const scene = raw.replace(TILT, '').replace(/\s{2,}/g, ' ').replace(/\s+([.,])/g, '$1').trim().replace(/[.\s]+$/, '')
  const person = scene.match(PERSON)
  if (person) warnings.push({ id: 'faceless-person', match: person[0], message: `"${person[0]}": a faceless still shows no person or body part (hands read as AI). Write the place only.` })
  const text = scene.match(TEXTY)
  if (text) warnings.push({ id: 'faceless-text', match: text[0], message: `"${text[0]}" carries text, and Soul writes gibberish on it. Leave it out, or use a product post (an edit model with the product photo).` })
  const look = (input.look ?? []).filter(l => !/no person|no objects that carry text|plain phone snapshot/i.test(l)).map(l => l.trim().replace(/[.\s]+$/, '')).filter(Boolean)
  const prompt = [`${scene || 'An ordinary real place'}.`, SNAPSHOT, ...look.map(l => `${l}.`), FACELESS_ENDING].join(' ')
  return { prompt, warnings }
}

// A product on a faceless post (item 4f): Soul can't render labels, so the
// still is made by an edit model with the product photo as the reference.
export const FACELESS_PRODUCT_MODELS = ['higgsfield/nano-banana-2.1', 'higgsfield/gpt-image-2.5'] as const
export function facelessProductPrompt(base: string, product: string): string {
  return `${base.replace(/\s*No people\.$/, '')} The product in the reference image (${product.trim() || 'the product'}) sits in the scene exactly as in the photo, its label and packaging unchanged and readable. No people.`
}

// "Finished damage" (owner, 2026-10-22, item 4j): one still, a 7 s "just
// existing" clip, a sad song and the on-screen line.
export const FINISHED_DAMAGE = {
  // A person character's take: the same nothing-happens clip, with them in it.
  personMotion: (name: string) => `${name} just exists: sits still in the parked car staring ahead while rain runs down the windshield, the light barely changes, the phone propped up on the dash. Nothing else happens.`,
  durationSec: 7,
  motion: 'Nothing happens: just existing. The rain keeps running down the glass, the light barely changes, the camera holds still like a phone propped up. No cuts.',
  musicSearch: 'sad',
}

// The sound a post's export asks the owner to add in the app (owner,
// 2026-10-22): its music bed's name and the voiceover's search words, from
// a faceless post's fields (or any post's Finished damage note). No clip is
// fetched or mixed: the sound is added on TikTok or Instagram.
export function soundToAdd(f: { musicName?: unknown; voiceover?: { search?: unknown } | null } | null | undefined): { music: string; voiceover: string } | null {
  const music = typeof f?.musicName === 'string' ? f.musicName.trim() : ''
  const voiceover = typeof f?.voiceover?.search === 'string' ? f.voiceover.search.trim() : ''
  return music || voiceover ? { music, voiceover } : null
}
export function soundLine(s: { music: string; voiceover: string } | null): string {
  if (!s) return ''
  return `Add this sound in the app: ${[s.music ? `music "${s.music}"` : '', s.voiceover ? `voiceover "${s.voiceover}"` : ''].filter(Boolean).join(', ')}`
}

// The file read from stored JSON (fields missing in an older one stay empty).
export function readFaceless(x: unknown): FacelessFile {
  const f = (x ?? {}) as Partial<FacelessFile>
  const str = (v: unknown, n: number) => (typeof v === 'string' ? v.slice(0, n) : '')
  return {
    persona: { who: str(f.persona?.who, 600), town: str(f.persona?.town, 200), life: str(f.persona?.life, 2000) },
    places: (Array.isArray(f.places) ? f.places : []).slice(0, 80).map((p, i) => ({ id: str(p?.id, 60) || `place-${i + 1}`, name: str(p?.name, 120), line: str(p?.line, 600) })).filter(p => p.line),
    look: (Array.isArray(f.look) ? f.look : []).map(l => str(l, 300)).filter(Boolean).slice(0, 30),
    voice: { notes: str(f.voice?.notes, 1000), formats: (Array.isArray(f.voice?.formats) ? f.voice!.formats : []).map(l => str(l, 300)).filter(Boolean).slice(0, 20) },
    sounds: (Array.isArray(f.sounds) ? f.sounds : []).slice(0, 120).map((s, i) => ({ id: str(s?.id, 60) || `sound-${i + 1}`, kind: s?.kind === 'voiceover' ? 'voiceover' as const : 'music' as const, name: str(s?.name, 120), search: str(s?.search, 200), soundId: typeof s?.soundId === 'string' ? s.soundId.slice(0, 60) : null })).filter(s => s.name),
  }
}
