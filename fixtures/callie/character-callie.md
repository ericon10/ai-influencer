# Character: Callie

## Card
Callie, 24 years old. Long honey-blonde hair, loose beachy waves, deep side part. Warm hazel-brown eyes, soft oval face, full light-brown brows, full lips. Fit, athletic build, toned legs, defined waist, naturally curvy hips. Distinguishing mark: small mole above her left brow. Style: a regular girl whose style evolves; natural glow.

## Realism principle (most important rule)
Callie looks real because she is not perfect. Her hero and sheet were made with no makeup, real skin, visible pores, and small imperfections. That is the identity, not a flaw to fix.
- Hero and sheet: always bare-faced, no makeup, no retouching.
- Every scene prompt includes the REALISM block. No exceptions.
- Keep: pores, faint texture, slight redness, uneven tone, shine, flyaways, smile lines, asymmetry, the subtle mole.
- Never ask any model to smooth, retouch, beautify, perfect, or "enhance" skin. No beauty filters or face-enhance steps.
- Upscales and edits must preserve skin texture; if skin comes back smoother or waxier than the input, reject it.
- QA rejects plastic, airbrushed, or porcelain skin even when the face matches.
- Makeup in scenes stays light and believable; soft glam is still real skin underneath.

## Distinguishing marks
- Small, subtle mole just above her left brow (keep it subtle, never a feature)
- That is her only fixed mark. No accessory is permanent; there are no absolutes.

## Style (evolves over time, never a uniform)
- She is a regular 24-year-old with her own developing taste. Any outfit fits her as long as it is something a real girl her age would actually wear for that moment.
- Every scene prompt names the full outfit; nothing here is enforced.
- Starting ideas only (optional): soft neutrals and pastels, light denim, linen sets, simple tees, sundresses, activewear, a butter-yellow ribbed one-piece swimsuit, white sandals or clean sneakers, dainty gold jewelry.
- Jewelry varies freely. She sometimes wears a gold double-band ear cuff (no piercing, removable). Optional per scene; when she wears it, the left ear keeps continuity, but leaving it off is never an error.
- Hair styling changes often: loose beachy waves with a deep side part; tucked behind her left ear; claw clip or low bun; slicked back after the gym or pool; anything new she tries.
- Makeup: natural by default (light skin, groomed brows, tinted lip). Soft glam (bronzer, warm blush, glossy nude-pink lip) for nights out and events.
- Footwear: always name her shoes in scene prompts (the sheet sneakers should not carry into scenes)

## Voice
- ElevenLabs voice "Callie" (voice_id v3PqSRD51socDi8mEJ5f), picked Oct 14 from design round 3 (preview H).
- Method: Eric performs her lines and runs them through ElevenLabs speech-to-speech into the Callie voice (no real voice talent needed).
- Sound: early 20s, bright, fun, light vocal fry, upspeak, a very slight smoky edge (heavy rasp made her sound mid-30s).
- Spare from the same round: "Spare: young female 1" (SifNfmAby6mpNZSg7knN), held for a future character.

## Persona
- Vibe: sunny, approachable, real girl you'd see on the street, a little playful
- Usual settings: neighborhood cafes, farmers markets, her apartment kitchen, the car, gym and pilates studio, pool and beach, tropical coves, rooftops at golden hour, lakeside terraces, raw urban concrete backdrops, nights out at clubs and raves
- Usual defaults (overridable, never locks): light makeup in daytime, real-moment feel over staged ad shoot, no visible logos unless it's a brand deal. Every scene, angle, outfit and setting is open; nothing about her is fixed except her face and the realism principle.

## Reference sheet
| ID | Shows | Use when the shot is |
| --- | --- | --- |
| REF-00 | Front, neutral, chest-up | Any front-facing shot; always attach one face ref |
| REF-01 | 3/4 left, chest-up | Head turned to her left |
| REF-02 | 3/4 right, chest-up | Head turned to her right |
| REF-03 | Left profile, chest-up | Side shots from her left, over-the-shoulder candids |
| REF-04 | Right profile, chest-up | Side shots from her right, driver's seat views |
| REF-05 | Back of head and hair | Walking away, looking out a window, hair focus |
| REF-06 | Front, full body | Full-body front, outfit shots, mirror selfies |
| REF-07 | Side, full body | Walking, full-body side shots |
| REF-08 | Back, full body | Walking away, full-body from behind |
| REF-09 | Front, open smile | Happy, smiling shots |
| REF-10 | 3/4, laughing | Mid-laugh candids |
| REF-11 | Front, serious, looking down | Calm, focused, reading, phone-in-hand shots |

Bonus: BONUS-01 (seated, near-front, logo removed). Old body build; keep out of training.

## Fixed blocks
- REFERENCE: Using the attached reference images, keep this woman's face, hair, and features exactly the same.
- SOUL IDENTITY (always include with the saved Soul character): Honey-blonde hair, light brown brows, fair skin with a light sun-kissed tan, soft oval face with a rounded chin, full lips. If hair is wet or slicked back, add "but still clearly blonde."
- REALISM: Candid iPhone photo, neutral natural light. Real skin texture: visible pores, soft peach fuzz catching the light on her cheeks and jaw, a few stray brow hairs and baby hairs at the hairline, subtle color variation with slight redness around the nose and cheeks, faint natural shine. No makeup or light makeup only, no beauty retouching, no beauty filter, no skin smoothing. Ordinary background, not a professional shoot.
- AVOID: studio lighting, perfect symmetry, plastic skin, airbrushed or smoothed skin, beauty filter, heavy makeup, text, watermarks.

## Models
- Soul 2.0 character "Callie" (soul_id 0fdc33c0-7a1a-40a9-9b12-0dc35f44e29e): trained after two attempts. Works well for stills when the SOUL IDENTITY block is in the prompt. Without it she drifts to a brunette, tan, slimmer-faced look, especially with moodboards like Siren or wet hair. Use the General moodboard as the neutral default.
- Drift lock: after any Soul still, run a Nano Banana 2.1 face-only pass with the Soul image as base plus @REF-00 and the closest-angle ref; keep everything else identical (inpaint mask on face and hair if it re-composes).
- Saved identity: Higgsfield Elements "Callie" (id 705d2b7d-596d-468e-bd2c-b171799cd7a6) and "Callie-1" (id 1602db94-79e3-4e5a-bbe5-de3537cd0b83), made from REF-00. Instant, no training. Work with Nano Banana 2 / 2.1 / Pro, GPT Image 2, Seedream, Seedance 2.0, Kling 3.0 (Kling needs a start frame too).
- Stills with refs and all edits: Nano Banana 2.1. Use @ references in Higgsfield so the model knows which image is which.
- Model feel (Oct 13 test, new REALISM block): Nano Banana 2.1 gives the most candid, truly bare-faced everyday look; GPT Image 2.5 Flare gives polished close-up selfies (adds lip gloss and a pout unless told "bare natural lips, no gloss").
- Stills, also strong: GPT Image 2.5 Flare. Produced her best beach shot (Koh Samui, real skin texture), though it once distorted her hair in an earlier scene. Worth running alongside Nano Banana and picking the best.
- Video, final: Seedance 2.5 (mode omni_reference, start + end frame). Best faces by far, but expensive.
- Video, cheap default: Kling 3.0 Pro. Kling 3.0 Turbo for motion tests only; faces melt when she is small in frame. Kling 3.0 Pro distorted her face when she talked animatedly.
- Real-motion clips: Genjutsu motion transfer (hf_mult_motion_control) on the Higgsfield plan; Kling 3.0 Motion Control on the API path.
- Sheet images were built in GPT Image 2.5

## Scene rules learned
- Always write the full outfit in every prompt; never say "same outfit as before." Name the sheet outfit to drop it (white tee, jeans, sneakers).
- When a scene changes how hair or skin looks (wet, wind, harsh sun, strong moodboard), state her colors anyway.
- Ear cuff on the wrong ear: either leave it, mirror the image horizontally (no text in frame), or edit it out. Never regenerate a good shot over jewelry.
- A closer shot of the same scene is a crop of the wide shot, upscaled, never a new generation. New generations invent a new environment.
- Upscale with an upscaler, not Nano Banana; Nano Banana re-composes the frame.
- Expression edits on an existing frame (e.g. turning to look at the lens) work well in Nano Banana 2.1 when the prompt says to keep everything else identical and attaches REF-00 for the face.
- Background people and tourists are fine and add realism; only edit out what breaks the shot.
- Light, principle not rule: models brighten faces by default. Describe the real light the place would have (whatever its sources) and how much of it actually reaches her; dark places stay dark. Seen once in a dim diner test.
- Attaching another person's photo as a style reference copies its grain and compression into the result. Use it for composition only or describe the look instead.
- Handheld wins: "handheld iPhone, held mostly steady, slight natural sway" reads more real than a locked-off shot.
- Club and night scenes generated from prompts alone came out lit like a film set (Oct 13). Use the real-clip recipe below for these.

## Proven recipe: the candid "caught you" shot
1. Still A: wide, from inside a venue looking out, she is small in frame, chatting with a friend.
2. Still B: crop of Still A around her, upscaled 2x (environment matches exactly).
3. End frame: Nano Banana edit of Still B where she looks into the lens with a soft, knowing half-smile, mouth closed.
4. One Seedance 2.5 take, start = Still A, end = look frame, about 12 s: holds wide 3 s, the model zooms in smoothly, she chats calmly, then turns and finds the lens near the end.
5. Trim the ending before any wink or over-held stare; ending on the side-glance toward the camera works well.
6. Mix: terrace ambience, light clinks, low deep house track, normalized to social loudness.

## Proven recipe: recreate from a real clip (Oct 14, rave)
For clubs, dark venues and any clip with real dancing or tricky motion. Prompted motion and prompted club light look fake; real footage fixes both.
1. First frame of the real source clip (about 0.2 s in).
2. Nano Banana 2.1, 4 takes, 9:16: source frame as image reference plus the @Callie element. Use the photo only for place, light, angle, framing, pose and outfit; replace the woman completely; list Callie's face traits and the source person's traits she must not have (eye color, piercings); keep the head tilt and gaze; remove the TikTok logo and handle.
3. Pick one, then a face-only pass: chosen still as reference plus the element, "change only her face to match, keep everything else pixel-for-pixel," 2 takes. The real frame always pulls her toward the source person (thinner lips); this pass brings her back without recomposing.
4. Motion transfer with the chosen still plus the ORIGINAL source clip: Genjutsu (hf_mult_motion_control) at 720p, about 70 credits for 10 s. On the API path, Kling 3.0 Motion Control.
5. Trim off any cut to a wide shot where background people melt.
Total about 76 credits on the Higgsfield plan.

## Video rules
- Candid format: one continuous take. Let the video model perform the zoom (start and end frames) so her face renders at full size. Never digitally zoom into a tiny face, and never stitch two generations for a "continuous" shot.
- Calm action only: listening, soft smile, small nods, mouth mostly closed, a few subtle words. "Chats animatedly" causes gaping mouths and distorted faces.
- Add "no winking, steady eye contact" whenever she looks at the camera; models add repeated winks otherwise.
- Camera never walks up to her; no extras crossing the frame. She is unaware of the camera until the payoff look.
- Generated audio is off or pushed far down in post; any chatter must stay unintelligible.
- Mix: terrace or room ambience, light clinks, a low house track like venue speakers. Normalize to social loudness.
- Never crossfade between clips when the subject moved; it ghosts.
- End frames: full edits in Nano Banana re-compose the whole scene; use inpaint with a mask on the head only.
- Kling 3.0, seen once: an end frame with the body in the same position as the start froze a walking shot (feet sliding). Not yet tested on Seedance. Options if it happens: a tighter end frame (crop to chest-up, upscale, inpaint the head) or no end frame.
- When she walks toward a tracking camera, say it outright: keep walking the whole clip, camera tracks backward, background slides past.
- Slow motion in the prompt is unreliable; ramp the last 2 to 3 seconds in the editor.
- Higgsfield's safety filter blocked "playful, slightly shy smile, lips gently closed." Use plain wording like "warm, friendly, closed-mouth smile."

## Disclosure
Label all posted content as AI-generated per each platform's rules.

## Combo log (last 10)
- 2026-10-12 Caught mid-action / Friend shot / Golden hour / Rooftop
- 2026-10-12 POV / Event photographer, long lens / Golden hour / Rooftop
- 2026-10-12 Caught you / Phone from inside, model zoom / Overcast daylight / Lakeside terrace
- 2026-10-12 Laughing in the water / Friend shot from rocks / Tropical late morning / Koh Samui cove
- 2026-10-14 Dancing at a rave / Friend handheld, real-clip motion / Club red and magenta / Rave
