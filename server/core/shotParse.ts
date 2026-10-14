// What the owner's own words already say about the shot (owner,
// 2026-10-14, after the first real run): "a front-camera selfie in a black
// tank" came back as a friend's photo in the sheet outfit, because the
// camera, the outfit and the framing stayed at their defaults. This reads
// them from the words, free and in plain code, so the defaults never
// overrule what the owner wrote. The server layers it under the owner's own
// field choices; the Idea step shows it as editable chips. Pure: no config,
// no imports, so the browser uses the same file.

export type ShotCamera = 'selfie' | 'mirror_selfie' | 'pov' | 'over_shoulder' | 'event_long_lens' | 'timer' | 'friend_phone'
export type ShotFraming = 'chest_up' | 'waist_up' | 'knees_up' | 'full_body' | 'wide_small'
export type ShotMakeup = 'bare' | 'natural' | 'soft_glam'

export interface ShotRead {
  camera?: ShotCamera
  phone?: 'front' | 'rear'
  framing?: ShotFraming
  // True when the framing was not named but follows from the camera (a
  // selfie at arm's length is close).
  framingFromCamera?: boolean
  outfit?: string
  makeup?: ShotMakeup
  // A short name for the place ("a packed rave").
  place?: string
  // The words describe the light themselves, so no template light line.
  ownLight?: boolean
  // The words say who shoots it, so no template camera line either.
  ownCamera?: boolean
}

const CLOTHES = [
  'tank top', 'tank', 'crop top', 'top', 't-shirt', 'tee', 'shirt', 'blouse', 'camisole', 'cami', 'bodysuit', 'corset', 'bralette', 'bra',
  'sports bra', 'dress', 'slip dress', 'sundress', 'gown', 'skirt', 'miniskirt', 'jeans', 'pants', 'trousers', 'shorts', 'leggings', 'joggers',
  'sweatpants', 'cargos', 'hoodie', 'sweatshirt', 'sweater', 'jumper', 'cardigan', 'jacket', 'coat', 'blazer', 'vest', 'puffer', 'parka',
  'bikini', 'swimsuit', 'one-piece', 'romper', 'jumpsuit', 'overalls', 'tracksuit', 'uniform', 'robe', 'pajamas', 'pyjamas', 'kimono',
  'suit', 'polo', 'jersey', 'halter', 'halter top', 'tube top', 'tights', 'apron', 'scrubs', 'outfit', 'set', 'two-piece',
]
const CLOTH = `(?:${[...CLOTHES].sort((a, b) => b.length - a.length).map(c => c.replace(/[-]/g, '[- ]?')).join('|')})s?`
// "in a black tank", "wearing an oversized gray hoodie and bike shorts".
const OUTFIT = new RegExp(
  `\\b(?:wearing|dressed in|in|wears|has on|throws on|pulls on)\\s+((?:(?:a|an|the|her|his|their|my|some|just)\\s+)?(?:[\\w'-]+\\s+){0,4}?${CLOTH}`
  + `(?:\\s*(?:,|and|with|over|under|plus)\\s+(?:(?:a|an|the|her|his|their|my|some)\\s+)?(?:[\\w'-]+\\s+){0,4}?${CLOTH})*)\\b`, 'i',
)

const CAMERAS: Array<[ShotCamera, RegExp]> = [
  ['mirror_selfie', /\bmirror[- ]?selfie\b|\bselfie in (?:the|a) mirror\b|\b(?:in|into) (?:the|a) (?:bathroom |gym |bedroom |elevator |full[- ]length )?mirror\b/i],
  ['selfie', /\bselfie\b|\bfront[- ](?:facing[- ])?cam(?:era)?\b|\bfront-facing\b|\bat arm'?s[- ]length\b|\bholds? (?:the|her|his|their|a) phone (?:out|up) (?:at|in front)/i],
  ['pov', /\bpov\b|\bpoint[- ]of[- ]view\b/i],
  ['over_shoulder', /\bover (?:the|a|her|his|their|my|someone'?s) shoulder\b/i],
  ['event_long_lens', /\blong lens\b|\btelephoto\b|\bfrom across the (?:room|venue|street|bar|club|floor)\b|\bpaparazzi\b/i],
  ['timer', /\b(?:on a |self[- ])?timer\b|\btripod\b|\bpropped (?:up )?(?:on|against)\b/i],
  ['friend_phone', /\b(?:a|her|his|their|my) friend (?:takes|took|shoots|snaps|films|holds)\b|\btaken by (?:a|her|his|their) friend\b|\bfriend'?s phone\b/i],
]

const FRAMINGS: Array<[ShotFraming, RegExp]> = [
  ['chest_up', /\bclose[- ]?up\b|\bchest[- ]up\b|\bhead and shoulders\b|\bhead[- ]?shot\b|\btight on (?:her|his|their) face\b|\bface fills\b/i],
  ['waist_up', /\bwaist[- ]up\b|\bfrom the waist\b|\bhalf[- ]body\b|\bmedium shot\b|\bmid[- ]shot\b/i],
  ['knees_up', /\bknees?[- ]up\b|\bfrom the knees\b|\bthree[- ]quarter (?:length|body|shot)\b|\bthigh[- ]up\b/i],
  ['full_body', /\bfull[- ]body\b|\bfull[- ]length\b|\bhead to toe\b|\bhead-to-toe\b|\bwhole body\b|\bhead to feet\b/i],
  ['wide_small', /\bwide shot\b|\bsmall in (?:the )?frame\b|\bfar (?:away|off) in the frame\b|\bestablishing shot\b/i],
]

const LIGHT = /\b(?:light|lights|lit|lighting|backlit|sunlight|sunlit|sun|sunset|sunrise|golden hour|blue hour|neon|strobe|strobes|laser|lasers|flash|spotlight|candle\w*|lamp\w*|dark|dim|dimly|shadow\w*|haze|hazy|fluorescent|led|leds|moonlight|overcast|daylight)\b/i
const BARE = /\bno[- ]makeup\b|\bbare[- ]?faced?\b|\bmakeup[- ]free\b|\bwithout (?:any )?makeup\b|\bfresh[- ]faced\b/i
const GLAM = /\b(?:soft |full |night[- ]out )?glam\b|\bsmok(?:e|ey|y) eyes?\b|\bwinged (?:eye)?liner\b|\bred lips?(?:tick)?\b|\blipstick\b|\blip ?gloss\b|\bglossy lips\b|\bfalse lashes\b/i
const NATURAL = /\bnatural makeup\b|\blight makeup\b|\bminimal makeup\b|\bno[- ]makeup makeup\b|\btinted (?:lip|balm|moisturi[sz]er)\b/i
// "at a packed rave", "in the middle of a busy market".
const PLACE = /(?<!(?:^|\s)(?:look|looks|looking|laugh|laughs|laughing|smile|smiles|smiling|stare|stares|staring|glance|glances|glancing|point|points|pointing|wave|waves|waving|yell|yells|grin|grins|grinning|nod|nods|aim|aims|shout|shouts|frown|frowns|squint|squints)\s)\b(?:at|in|inside|outside)\s+(?:the middle of\s+|the back of\s+|front of\s+)?((?:a|an|the|her|his|their|my)\s+(?:[\w'-]+\s+){0,3}?[\w'-]+)(?=\s*(?:[,.;!?]|$|\s+(?:with|while|as|at|on|in|during|holding|wearing|and|phone|her|his|their|the)\b))/gi
const NOT_PLACE = new RegExp(`(?:${CLOTH}$|\\b(?:hand|hands|arm|arms|face|hair|lens|camera|frame|mirror|length|moment|way|mood|middle|light|lights|time|style|pose|shot|photo|picture|selfie|video|clip|phone|flash|focus)s?\\b)`, 'i')

const tidy = (s: string) => s.replace(/\s+/g, ' ').trim().replace(/[.,;:]+$/, '')

export function readShot(raw: string): ShotRead {
  const text = (raw ?? '').replace(/\s+/g, ' ').trim()
  const out: ShotRead = {}
  if (!text) return out
  for (const [id, re] of CAMERAS) if (re.test(text)) { out.camera = id; out.ownCamera = true; break }
  if (/\bfront[- ](?:facing[- ])?cam(?:era)?\b|\bfront-facing\b/i.test(text) || out.camera === 'selfie') out.phone = 'front'
  else if (/\b(?:rear|back)[- ]cam(?:era)?\b/i.test(text)) out.phone = 'rear'
  for (const [id, re] of FRAMINGS) if (re.test(text)) { out.framing = id; break }
  if (!out.framing && out.camera === 'selfie') { out.framing = 'chest_up'; out.framingFromCamera = true }
  const outfit = text.match(OUTFIT)?.[1]
  if (outfit) out.outfit = tidy(outfit)
  if (BARE.test(text)) out.makeup = 'bare'
  else if (GLAM.test(text)) out.makeup = 'soft_glam'
  else if (NATURAL.test(text)) out.makeup = 'natural'
  for (const m of text.matchAll(PLACE)) {
    const p = tidy(m[1]!.replace(/\s+(?:when|while|as|that|because|who|which|where|until|after|before|so|from|across|behind|near|by|of|with|under|over)\b.*$/i, ''))
    if (NOT_PLACE.test(p) || (out.outfit && out.outfit.includes(p))) continue
    out.place = p.replace(/^(?:her|his|their|my)\s+/i, 'the ')
    break
  }
  if (LIGHT.test(text)) out.ownLight = true
  return out
}

// A full prompt pasted in, not a rough idea: long, or written the way
// prompts are (camera words, lens and light terms, several sentences of
// direction). It goes as written, plus the fixed blocks.
const PROMPTISH = /\b(?:shot on|photo of|photograph of|candid (?:photo|shot)|iphone|35 ?mm|50 ?mm|f\/\d|aperture|depth of field|bokeh|shallow focus|film grain|cinematic|hyper[- ]?realistic|photorealistic|ultra[- ]?realistic|8k|4k|raw photo|aspect ratio|--ar|negative prompt|composition|framing|lighting|color grade|exposure)\b/gi

export function looksLikePrompt(raw: string): boolean {
  const text = (raw ?? '').trim()
  if (text.length >= 400) return true
  const sentences = text.split(/[.!?]\s+|\n+/).filter(s => s.trim().length > 12).length
  const terms = new Set((text.match(PROMPTISH) ?? []).map(t => t.toLowerCase())).size
  return text.length >= 160 && (terms >= 2 || (terms >= 1 && sentences >= 3))
}

// Words the prompt writer must not add on its own (owner, 2026-10-14):
// they make a photo look staged. A word the owner used stays. Each is
// taken out so the sentence still reads: "glowing with sweat" becomes
// "damp with sweat", "soft light from the left" becomes "light from the
// left", "a stunning, cinematic shot" becomes "a shot".
const FLOURISHES: Array<{ word: string; re: RegExp; to: string }> = [
  { word: 'glowing', re: /\bglow(?:ing|s)? with sweat\b/gi, to: 'damp with sweat' },
  { word: 'golden glow', re: /\bgolden glow\b/gi, to: 'warm light' },
  { word: 'glow', re: /\bthe glow of\b/gi, to: 'the light of' },
  { word: 'soft light', re: /\bsoft(?:ly)?\s+(light|lighting|lit)\b/gi, to: '$1' },
  { word: 'perfect lighting', re: /\bperfect(?:ly)?\s+(light|lighting|lit)\b/gi, to: '$1' },
  { word: 'studio lighting', re: /\bstudio\s+(light|lighting)\b/gi, to: '$1' },
  { word: 'glowing', re: /\s*\bglow(?:ing|s|y)?\b/gi, to: '' },
  ...['beautiful', 'beautifully', 'stunning', 'gorgeous', 'ethereal', 'dreamy', 'radiant', 'luminous', 'flattering', 'magical', 'breathtaking', 'cinematic', 'editorial', 'glamorous', 'picturesque', 'angelic']
    .map(w => ({ word: w, re: new RegExp(`\\s*\\b${w}\\b,?`, 'gi'), to: '' })),
]

export const FLOURISH_WORDS = [...new Set(FLOURISHES.map(f => f.word))]

// The flourish words in `text` that the owner's words (`own`) do not use.
export function flourishesIn(text: string, own: string): string[] {
  const found = new Set<string>()
  for (const f of FLOURISHES) {
    f.re.lastIndex = 0
    const ownHas = new RegExp(f.re.source, 'i').test(own)
    f.re.lastIndex = 0
    if (!ownHas && new RegExp(f.re.source, 'i').test(text)) found.add(f.word)
  }
  return [...found]
}

// Takes those words out (see above) and tidies the sentence.
export function stripFlourishes(text: string, own: string): { text: string; removed: string[] } {
  const removed = new Set<string>()
  let out = text
  for (const f of FLOURISHES) {
    if (new RegExp(f.re.source, 'i').test(own)) continue
    const next = out.replace(f.re, f.to)
    if (next !== out) { removed.add(f.word); out = next }
  }
  out = out.replace(/\s+([,.;:])/g, '$1').replace(/,\s*([,.;:])/g, '$1').replace(/\b(a|an)\s+(a|an)\b/gi, '$1').replace(/([(])\s*,?\s*/g, '$1').replace(/\(\s*\)/g, '').replace(/ {2,}/g, ' ')
  // "an" before a consonant once its adjective is gone ("an ethereal shot").
  out = out.replace(/\b([Aa])n\s+(?=[bcdfghjklmnpqrstvwxyz])/g, '$1 ').replace(/\b([Aa])\s+(?=[aeiou])/g, '$1n ')
  return { text: out.trim(), removed: [...removed] }
}
