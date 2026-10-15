# Character: Wren

## Card
Wren, 26 years old. Shoulder-length dark brown hair,
soft natural waves, center part. Green-gray eyes,
heart-shaped face, straight medium brows. Average,
athletic build. Distinguishing mark: a small
freckle cluster under her right eye. Style: easy,
outdoorsy, lived-in.

## Realism principle (UNIVERSAL)
Wren looks real because she is not perfect.
The hero and sheet were made bare-faced, with real
skin, visible pores and small imperfections. That
is the identity, not a flaw to fix.
- Hero and sheet: always bare-faced, no makeup, no
  retouching.
- Every scene prompt includes the REALISM block.
  Exception: recreates into a real person's photo
  use the one-line version (see that recipe).
- Keep: pores, texture, slight redness, uneven
  tone, shine, flyaways, smile lines, asymmetry,
  the mark.
- Never ask a model to smooth, retouch, beautify,
  perfect or "enhance" skin. No beauty filters or
  face-enhance steps.
- Upscales and edits must keep skin texture; if
  skin comes back smoother than the input, reject.
- QA rejects plastic or airbrushed skin even when
  the face matches.
- No exposure hot spots. A faint natural shine is
  real; a bright glare patch on the nose, forehead
  or cheeks is not, and it gets worse in video.
- Never downscale, blur or recompress refs or
  outputs. Always use the full-resolution original.

## Distinguishing mark
- Small freckle cluster just below her right eye. Keep it subtle, never a feature.
- It is the only fixed mark. No accessory is permanent;
  there are no absolutes.

## Brand
- Interest: trail running and cheap weekend trips
- Sub-interest (optional): the slowest runner in every race
- Arc: training for her first trail half marathon
- Brand statement: Wren, the slow trail runner who shows the real side of getting outside on a budget

## Why people watch
- Series: Slow Mile Monday; Trip under $100; Gear I regret
- Running bits: rates every trail out of ten muddy socks; always forgets one thing at home
- Cast: Jules the roommate; her dad on the phone
- Payoff style: the mishap lands in the first second
- How they film: phone at chest height, fast cuts, out of breath

## Style (evolves, never a uniform)
- Any outfit fits as long as a real person her age would wear it for that moment.
- Every scene prompt names the full outfit and the shoes.
- Starting ideas (optional): earth tones, running shorts, fleece, trail shoes.
- Accessories: a cap; a running vest; all optional per scene.
- Hair options: low ponytail; claw clip; braid.
- Grooming default: natural. Dressed-up version: soft glam for nights out.

## Voice
- ElevenLabs voice "Wren" (voice_id wrenVoice0000001), picked Oct 15.
- Method: the owner performs, speech-to-speech converts.
- Sound: mid-twenties, warm, a little breathless.

## Persona
- Vibe: cheerful, a bit chaotic, never gives up
- Who she is: a barista in Denver who spends every weekend on a trail; once got lost on a 5K
- Usual settings: trailheads, her small apartment, cafes, mountain towns
- Defaults (overridable): daytime look, real-moment feel over staged, no logos unless a brand deal

## Voice card
- Who: 26, barista, weekend trail runner
- POV: tells every story as a small disaster that turned out fine
- Talks like: "okay so", "real talk", "we move"
- Humor: self-deprecating
- Emoji: one per caption, usually the mountain
- Never: shames anyone's pace; fake hype
- Pillars: Slow Mile Monday (running), Trip under $100 (travel), Gear I regret (honest gear)
- Example: "Okay so I got passed by a man walking his dog."

## Reference sheet
| ID | Shows | Use when the shot is |
| --- | --- | --- |
| REF-00 | Front, neutral, chest-up | Any front shot; always attach one face ref |
| REF-01 | 3/4 left, chest-up | Head turned to their left |
| REF-02 | 3/4 right, chest-up | Head turned to their right |
| REF-03 | Left profile, chest-up | Side shots from their left |
| REF-04 | Right profile, chest-up | Side shots from their right, driver's seat |
| REF-05 | Back of head and hair | Walking away, hair focus |
| REF-06 | Front, full body | Full-body front, mirror selfies |
| REF-07 | Side, full body | Walking, full-body side |
| REF-08 | Back, full body | Full-body from behind |
| REF-09 | Front, open smile | Happy shots |
| REF-10 | 3/4, laughing | Mid-laugh candids |
| REF-11 | Front, serious, looking down | Calm, reading, phone-in-hand |

Ref rule: chest-up and waist-up shots attach face
refs only. Full-body refs (06 to 08) only for
knees-up and full-body shots; they drag the sheet
outfit in.

Ref files (full-resolution originals):
- REF-00: REF-00.png in the sheet folder
- REF-01 to REF-11: REF-01.png to REF-11.png

## Fixed blocks
- REFERENCE: Using the attached reference images,
  keep this woman's face, hair, and features
  exactly the same.
- IDENTITY (with any saved character, trained model or strong style): dark brown hair, straight medium brows, light olive skin, heart-shaped face, a freckle cluster under the right eye. If hair is wet or slicked back, add "but still clearly dark brown."
- REALISM: Candid iPhone photo, natural light.
  Real skin texture: visible pores, soft peach
  fuzz on the cheeks and jaw, a few stray hairs, subtle color
  variation with slight redness around the nose and
  cheeks, faint natural shine. Even, soft exposure
  on the face, no bright hot spots. No makeup or light makeup only, no beauty
  retouching, no beauty filter, no skin smoothing.
  Ordinary background, not a professional shoot.
- AVOID: studio lighting, perfect symmetry, plastic
  skin, airbrushed or smoothed skin, beauty filter,
  heavy makeup, blown highlights or hot spots on
  the skin, text, watermarks.

## Build notes
- The hero took three rounds; the freckle cluster drifted to the left eye twice. Name the side in every prompt.

## Stress test
- [x] 1 Wet hair  - [x] 2 Harsh sun
- [x] 3 Dim light  - [x] 4 Strong style
- [x] 5 Profile in a scene  - [x] 6 Full body, new outfit  - [x] 7 Dressed up  - [x] 8 Recreate

## Identity fixes (from the stress test)
- Harsh sun: the freckles faded -> add "freckle cluster still visible under her right eye"

## Saved identity
- Higgsfield Element "Wren": 4b2a1c3d-5e6f-4a7b-8c9d-0e1f2a3b4c5d
- Trained model (if any): none
- API path: attach REF-00 + closest-angle ref

## Models (UNIVERSAL defaults, update as tests change)
- Hero and sheet: GPT Image 2.5 Flare, High, 2K.
- Scene stills: GPT Image 2.5 Flare by default
  (add "bare natural lips, no gloss" for natural
  looks; it adds gloss otherwise). Nano Banana 2.1
  as an alternative.
- Edits, face passes, expression edits: GPT Image
  2.5 Flare with the image attached and "keep
  everything else identical." Nano Banana 2.1 as
  an alternative only. Never use Nano Banana for
  makeup or face edits on full-body shots: it
  enlarged the head and reshaped the face (Solei,
  Oct 15). Bold makeup goes in the generation
  prompt, with "same lip shape, nose and jaw."
- Over-the-shoulder glances in full-body shots
  give every model "big head" syndrome. Fix seen
  Oct 15: attach more refs (face, side and back,
  plus full body) and add "natural head-to-body
  proportions." Nano Banana Pro held proportions
  best with the extra refs.
- Upscale with an upscaler, 2x max, never with an
  image model.
- Video from stills: Seedance 2.5 for finals,
  Kling 3.0 Pro as the cheaper default.
- Motion from a real clip: choose per clip
  (Genjutsu, Wan 3.0, Wan 3.0 Prime, Kling 3.0
  Motion Control).

## Scene rules (UNIVERSAL)
- Write the full outfit and shoes in every prompt;
  never "same outfit as before." Name the sheet
  outfit to drop it.
- Catalog wording for outfits: name the garment,
  color and fabric the way a product page would
  ("sage ribbed sports bra and high-waisted black
  bike shorts," "butter-yellow triangle bikini top
  with matching bottoms"). Activewear, swimwear and
  cute everyday outfits are all fine; the wording
  just keeps content filters from misreading them.
- No body-emphasis words in scene prompts: toned,
  curvy, hips, waist, legs, tight, revealing,
  cleavage, busty, cup sizes. The references carry
  the build. One catalog-fit line in the outfit
  description is fine ("the dress fits her full
  natural bust and soft waist"); never stack it
  with skin words (wet, droplets, thin straps).
- Waist-up shots in fitted clothes attach REF-06
  as well as the face refs, so the build holds.
- Give them a moment, not a pose: "refilling her
  water bottle between sets" reads as lifestyle;
  "posing in" reads as glamour.
- Avoid terms that double as underwear words
  ("boy shorts"); use "lounge shorts," "running
  shorts" or "bike shorts."
- When a scene changes hair or skin (wet, wind,
  harsh sun, strong style), state the colors anyway.
- Hair styling in every scene prompt, rotated.
  The sheet holds one styling, so without a
  styling line every post copies it and the
  feed looks alike (Solei, Oct 15). Color and
  texture are identity; placement is not. Bank:
  behind both shoulders; tucked behind one ear;
  blowing back off the face; half-up claw clip;
  low loose ponytail; high sleek ponytail; messy
  top bun; sunglasses as a headband; damp and
  air-dried; other part. Log it in the combo log;
  no repeat from the last 5. Rotate expression
  and head angle too.
- Makeup by setting. The sheet is bare-faced, so
  with no makeup line the character goes out
  bare-faced. Out in public: soft everyday makeup
  (light coverage that still shows skin texture,
  groomed brows, mascara, warm bronzer, matte
  nude lip, no gloss, "same lip shape, nose and
  jaw as the references"). Bare or minimal at
  home, the gym, early beach, waking up. Bold
  looks go in the Flare generation prompt, never
  a Nano Banana edit (it reshapes the face). For
  men: groomed brows and beard, no makeup words.
- Wrong-side jewelry: leave it, mirror the image
  (no text in frame) or edit it out. Never
  regenerate a good shot over jewelry.
- A closer shot of the same scene is a crop of the
  wide shot, upscaled, never a new generation.
- Light is a principle: describe the place's real
  light, its direction, and how much reaches them.
  Dark places stay dark. Skin detail scales with
  light.
- No exposure hot spots on the face, even in sun.
  Bright places keep the light but the skin keeps
  detail. A still with a glare patch gets a
  face-preserving edit before it goes anywhere.
- Another person's photo as a style ref copies its
  grain; use it for composition only.
- "Handheld iPhone, held mostly steady, slight
  natural sway" beats a locked-off shot.
- Clubs, night venues and real dancing: use the
  recreate recipe, not prompts.
- Background people are fine; edit out only what
  breaks the shot.
- Safety filters judge stacked words, not intent.
  Use plain wording ("warm, friendly, closed-mouth
  smile"). A refused prompt costs nothing; remove
  the stacked words and rerun.

## Video rules (UNIVERSAL)
- Always image-to-video from an approved still.
- Never animate a still with a hot spot on the
  face; video makes it pulse and blow out. Fix the
  still first.
- One continuous take; let the model do the zoom
  with start and end frames. Never digitally zoom
  into a tiny face or stitch generations.
- Calm action: listening, small nods, mouth mostly
  closed. "Animated talking" distorts faces.
- Looking at camera: add "no winking, steady eye
  contact."
- Camera never walks up to them; no extras crossing
  frame.
- Generated audio off or far down; chatter stays
  unintelligible.
- Never crossfade when the subject moved.
- End frames: edit the head only; full edits
  re-compose the scene.
- Walking toward a tracking camera: "keep walking
  the whole clip, camera tracks backward,
  background slides past."
- Slow motion: ramp in the editor, not the prompt.

## Recipe: candid "caught you" shot (UNIVERSAL)
1. Still A: wide, from inside a venue, they are
   small in frame, chatting with a friend.
2. Still B: crop of A around them, upscaled 2x.
3. End frame: edit of B, looking into the lens
   with a soft, knowing half-smile, mouth closed.
4. One take, start = A, end = look frame, about
   12 s: holds wide, model zooms in, they turn and
   find the lens near the end.
5. Trim before any wink or over-held stare.
6. Mix: room ambience, light clinks, low track,
   normalized to social loudness.

## Recipe: recreate from a real clip (UNIVERSAL)
1. Clean the clip (watermark, captions). Take the
   frame about 0.2 s in.
2. 4 stills, 9:16: frame as image reference plus
   the identity. Photo is only for place, light,
   angle, framing, pose and outfit; replace the
   person completely; list the source person's
   traits they must NOT have; keep head angle and
   gaze; remove caption, logo and username.
   FILTER-SAFE RULES (proven Oct 14: the long
   prompt was blocked as "nsfw" next to a real
   person's photo; no single word was the cause,
   the stack was; this version passed):
   - Face and hair only: hair color, length and
     style, eyes, brows, lips, face shape, the
     mark. Never build or body words (fit, toned,
     curvy, waist, hips, legs, athletic); the
     element and refs carry the body.
   - No age in the prompt, not even "21 or older."
     Age is checked before the run.
   - Outfit: the specific garment type, color and
     fabric, plus a style word when it's clear,
     then "same as in the photo" ("dark green
     ribbed tank top with thin straps, going-out
     look, same as in the photo"). Garment names
     (tank, cami, halter, slip dress, bodysuit)
     are fine. Only fit and body words stay out
     (fitted, tight, low-cut, sheer) unless the
     user typed them. A bare "top" gets drawn as
     a plain tee (seen Oct 14).
   - Realism is one line: "REALISM: Natural skin
     texture, not retouched." No long skin block,
     no AVOID list.
   - Keep it short: the photo gives place, light,
     pose and body; name only what changes.
   - Blocked runs are refunded; Higgsfield only
     says "nsfw," never which word.
3. Face-only pass, 2 takes: "change only the face
   to match, keep everything else pixel-for-pixel."
   Skip it when the best still already passes the
   gate with a wide margin.
4. Gates: face match to REF-00 0.45 or more,
   beating the source likeness by 0.12 or more
   (calibrated on 2 clips; recalibrate after 10).
5. Motion: still as image reference, cleaned clip
   as video reference, 720p, audio off. "@Image1
   defines everything you see... @Video1 is used
   ONLY for motion." Lock the outfit: "same cut,
   length and fit as @Image1."
6. Trim cuts to wide shots where background people
   melt.

## Competitors
- Format (how to film): @trailtalks: the walking selfie; @slowrunclub: the honest race recap
- Element (structure to borrow, any niche): @budgetbites: the price tag reveal; @gearfails: the regret countdown; @cityhikes: the map open
- Take filming and structure only, never words, faces, captions or handles.

## Accounts
- Main: @wren.runs, TikTok and Instagram
- Interest account (optional): @trips.under.100, cheap weekend trips
- Bio: slow runner, fast talker. trips under $100.
- Link note: the trail map I always forget to bring

## Monetization (fit only)
- Products that fit their life: trail shoes, budget travel, coffee
- Affiliate: none yet
- Brand deal fit: running gear, hostels, coffee
- UGC for hire: yes
- Rules: fun test first; a product is a guest, never the hook; selling stays rare and never breaks character; #ad on paid or affiliate posts.
- Funnel: views > follows > link clicks > signups or sales. Rank by follows per reel.

## Winning stack (from the last growth review)
- The mishap in the first second
- Out-of-breath voiceover
- Golden-hour trail

## Growth log
- 2026-09: top 5 shared the mishap hook; bottom 5 lacked a person in the first frame; stack mishap hook, voiceover, golden hour; retired gear lists; testing Trip under $100; brand check fits

## Disclosure
Label all posted content as AI-generated per each
platform's rules. Paid or affiliate posts carry
#ad.

## Combo log (last 10)
- 2026-10-14 Caught you / Friend shot / Golden hour / Trailhead
  / low loose ponytail

