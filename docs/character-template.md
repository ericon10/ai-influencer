# Character Template (any character)

The build path and file format for every new character, woman or man. Built from what made Callie and Solei believable. Version 1.6, Oct 15 2026 (1.1 no exposure hot spots; 1.2 catalog wording; 1.3 filter-safe recreate prompt; 1.4 build session loop, full sheet prompts with angle fixes, fill-in stress test prompts, never downscale refs; 1.5 catalog-fit wording on the full-body refs; 1.6 brand layer restored: entertainment first, interest and brand statement, series and cast, competitor research, accounts and profile, monthly growth loop, monetization by fit only).

How to use:
1. Follow Part A in order. Every gate must pass before the next step. A drifted or plastic-looking image never gets approved, because everything after it inherits the flaw.
2. Copy Part B to `claude/character-[name].md`, fill every [bracket], and import it into your tools.
3. Sections marked UNIVERSAL are copied unchanged. When a universal rule changes, update this template first, then every character file.

Fixed rules for every character: realism is the identity, 21+, non-explicit, an original person never a copy, AI label on every post, price shown before every paid run. Everything else is a default, never a lock.

Entertainment first: people follow a person, not a pitch. The order is entertaining, then trusted, then monetized. Products are guests in a character's content, never the reason for it. The brand layer (Steps 8 to 10 and 13) is the base that lets a character grow in many directions.

---

# PART A: BUILD PATH

## How a build session runs
Works best in a Claude project with an image-generation connector (Higgsfield), so Claude can see each batch itself. Without one, upload your takes to the chat and Claude reviews them the same way.

1. One step at a time, strictly in order, all in one chat so the history stays linear.
2. Claude writes the prompt. You run it (settings below, 4 takes) and say "done."
3. Claude pulls the batch, lays it side by side with REF-00, then checks 1:1 crops of the face, the mark and the skin.
4. Claude gates every take (identity, mark on the correct side, reads the card's age, real skin at 1:1, no hot spots, the angle was actually achieved) and picks one with a one-line reason.
5. Claude hands back the pick as a direct link to the full-resolution original. Save it as `[Name]_REF-XX` and re-upload it so it shows by name in your picker.
6. Claude posts the next prompt.

If every take fails, Claude rewrites the prompt. Never approve "close enough."

**Never downscale, blur, compress, crop or screenshot a ref.** Always keep the original file exactly as generated. Downscaled copies made both Callie's and Solei's refs soft, worst on full-body shots where the face is already small.

Default image settings: GPT Image 2.5 Flare, High quality, 2K, 4 takes. 3:4 for chest-up, 2:3 for full body. Check the price on the button before every run.

## Step 1. Inspiration
- Pick a candid, everyday photo: phone camera, real light, real place. Avoid glam shots, studio light, heavy filters and heavy makeup; they bake plastic skin into the hero.
- Output the Keep / Change table (project instructions, Mode 1 Step A).
- Gate: the person is clearly an adult.

## Step 2. Three concepts
- Three concepts with name, 40-word card, new specific features inside the kept face type, and ONE subtle distinguishing mark (a small mole, a faint scar, a freckle cluster). One mark, not two; more marks read as a costume.
- Each concept also sketches the brand: an interest, a brand statement draft, and two series ideas (filled in fully at Step 8).
- Pick one.

## Step 3. Hero (REF-00)
- Model: GPT Image 2.5 Flare, 3:4. Text only, never attach the inspiration.
- Run 12 per round. The first round shows what to fix; adjust the prompt and run again. Expect 2 to 3 rounds.

```
Chest-up portrait of [CARD], facing the camera,
relaxed expression with a hint of a smile in her
eyes. [MARK, written as "barely visible, only
noticeable up close, the same color as her
skin"]. Youthful [AGE] face: no forehead
wrinkles, no under-eye hollows, rested eyes.
Slight natural asymmetry. Plain light gray
background, soft daylight from a window on the
left, even soft exposure on the face with no
bright hot spots, simple white crew-neck
t-shirt. Candid iPhone photo. No makeup, bare
natural lips, no gloss. Real skin texture:
visible pores, [peach fuzz on the cheeks / light
stubble along the jaw], slight redness around
the nose, uneven tone, faint shine, a few stray
hairs. No retouching, no beauty filter, no skin
smoothing.
```

Hero lessons (Solei, Oct 14 to 15):
- A mark written as a "scar" comes out as a dark notch, often on the wrong side. Describe it as barely visible and skin-colored.
- "Deep-set eyes" adds hollows and years. Keep the youthful-age line in the prompt.
- If a card feature never renders after two rounds (Solei's chin cleft), drop it from the card instead of fighting the model.
- Check every candidate at 1:1. GPT Image 2.5 sometimes draws swirly, fingerprint-like fake pores. Pick a take without them.
- A hot spot on an otherwise perfect hero gets one face-preserving edit, never a hero switch. Use Flare from the main Image generator with the ORIGINAL hero attached (quick-edit boxes may not offer Flare and can halve the resolution; never edit an edit). Run 4 takes and compare each to the original at full size.

Hot-spot edit prompt:
```
Edit the attached photo. Reduce only the bright
glare on the [bridge and tip of her nose] to a
faint, natural skin shine that matches the rest
of her face. The [tip of her nose] has no bright
white highlight, only the same soft sheen as her
cheeks. Keep everything else identical: her
face, features, expression, [MARK], freckles,
pores, skin texture, hair, t-shirt, background
and light. Bare natural lips, no gloss, same lip
shape. Do not smooth, retouch or beautify the
skin. Same person, same photo.
```

Gates (all must pass):
- [ ] Real skin: pores, uneven tone, slight redness, faint shine, no swirly fake pores at 1:1
- [ ] Even exposure: no bright hot spots on the nose, forehead or cheeks
- [ ] Slight asymmetry; not a perfect face
- [ ] Clearly 21+ and reads the card's age
- [ ] Someone who follows the inspiration person would not recognize them
- [ ] Looks like someone you would pass on the street, not a model
- [ ] The mark is there, on the correct side, and subtle

Save the winner as REF-00.

## Step 4. Reference sheet (REF-01 to REF-11)
One ref at a time, in this order, each attaching the approved refs listed. Sheet constants: plain light gray background, soft even daylight, fitted white crew-neck t-shirt, mid-wash straight-leg jeans, white sneakers, the same hair, bare-faced. The sheet is a measurement, not content.

| ID | View | Framing | Aspect | Attach |
| --- | --- | --- | --- | --- |
| REF-01 | 3/4, turned to her left | Chest-up | 3:4 | REF-00 |
| REF-02 | 3/4, turned to her right | Chest-up | 3:4 | REF-00 |
| REF-03 | Left profile | Chest-up | 3:4 | REF-00, REF-02 |
| REF-04 | Right profile | Chest-up | 3:4 | REF-00, REF-01 |
| REF-05 | Back of head and hair | Chest-up | 3:4 | REF-03, REF-04 |
| REF-06 | Front, standing | Full body | 2:3 | REF-00 |
| REF-07 | Side, standing | Full body | 2:3 | REF-03, REF-06 |
| REF-08 | Back, standing | Full body | 2:3 | REF-05, REF-06 |
| REF-09 | Front, open smile | Chest-up | 3:4 | REF-00 |
| REF-10 | 3/4, laughing | Chest-up | 3:4 | REF-00, REF-01 |
| REF-11 | Front, serious, looking down | Chest-up | 3:4 | REF-00 |

Fill these slots once from the card, then paste into every prompt:
- [MARK]: the mark exactly as the hero prompt wrote it.
- [HAIR]: color, length, texture, part ("Long espresso-brown hair, loose soft waves, deep side part on her right").
- [BUILD]: the card's build in catalog-fit words, full-body shots only, plus one fit line on the tee ("Slim frame, narrow shoulders, full natural bust, soft waist. The fitted white crew-neck t-shirt fits snugly across her bust"). Never leave the build out: with no build words the model defaults to slim, and every later shot inherits it (Solei, Oct 15). Never cup sizes, "busty" or "cleavage"; they trip filters.
- For a man: swap she/her for he/his and "peach fuzz" for "light stubble."

**REF-01** · Attach REF-00 · 3:4
```
Using the attached reference image, keep this
woman's face, hair, skin tone and [MARK] exactly
the same, but photograph her from a new angle.
Chest-up. Her head and shoulders are turned
about 45 degrees to her left, so her nose points
toward the right edge of the frame and we see
more of her right cheek. Her eyes follow her
head, looking past the camera, not at it.
Relaxed neutral expression. Plain light gray
background, soft even daylight, no bright hot
spots on the skin. Fitted white crew-neck
t-shirt. [HAIR]. No makeup, bare natural lips,
no gloss. Real skin texture: visible pores,
peach fuzz, slight redness, uneven tone, faint
shine. No retouching, no skin smoothing. Same
person, not a lookalike.
```

**REF-02** · Attach REF-00 · 3:4
```
Using the attached reference image, keep this
woman's face, hair, skin tone and [MARK] exactly
the same, but photograph her from a new angle.
Chest-up. Her head and shoulders are turned
about 45 degrees to her right, so her nose
points toward the left edge of the frame and we
see more of her left cheek. Her eyes follow her
head, looking past the camera, not at it.
Relaxed neutral expression. Plain light gray
background, soft even daylight, no bright hot
spots on the skin. Fitted white crew-neck
t-shirt. [HAIR]. No makeup, bare natural lips,
no gloss. Real skin texture: visible pores,
peach fuzz, slight redness, uneven tone, faint
shine. No retouching, no skin smoothing. Same
person, not a lookalike.
```

**REF-03** · Attach REF-00, REF-02 · 3:4
```
Using the attached reference images, keep this
woman's face, hair, skin tone and [MARK] exactly
the same, but photograph her in exact side
profile. Chest-up. She faces the left edge of
the frame, so we see only the left side of her
face: one eye, her nose in silhouette, her lips
and chin in profile, and her left ear. She looks
straight ahead, not at the camera. Relaxed
neutral expression. Plain light gray background,
soft even daylight, no bright hot spots on the
skin. Fitted white crew-neck t-shirt. [HAIR]. No
makeup, bare natural lips, no gloss. Real skin
texture: visible pores, peach fuzz, slight
redness, uneven tone, faint shine. No
retouching, no skin smoothing. Same person, not
a lookalike.
```

**REF-04** · Attach REF-00, REF-01 · 3:4
```
Using the attached reference images, keep this
woman's face, hair, skin tone and [MARK] exactly
the same, but photograph her in exact side
profile. Chest-up. She faces the right edge of
the frame, so we see only the right side of her
face: one eye, her nose in silhouette, her lips
and chin in profile, and her right ear. She
looks straight ahead, not at the camera.
Relaxed neutral expression. Plain light gray
background, soft even daylight, no bright hot
spots on the skin. Fitted white crew-neck
t-shirt. [HAIR]. No makeup, bare natural lips,
no gloss. Real skin texture: visible pores,
peach fuzz, slight redness, uneven tone, faint
shine. No retouching, no skin smoothing. Same
person, not a lookalike.
```

**REF-05** · Attach REF-03, REF-04 · 3:4
```
Using the attached reference images, keep this
woman's hair exactly the same. Chest-up, seen
from directly behind, so we see only the back of
her head and shoulders, no face. [HAIR], natural
flyaways, as long as in the references. Plain
light gray background, soft even daylight.
Fitted white crew-neck t-shirt. Candid iPhone
photo, no retouching.
```

**REF-06** · Attach REF-00 · 2:3
```
Using the attached reference image, keep this
woman's face, hair, skin tone and [MARK] exactly
the same. Full body, head to toe, standing
straight and facing the camera, arms relaxed at
her sides, feet slightly apart. Relaxed neutral
expression. [BUILD]. Fitted white crew-neck
t-shirt, mid-wash straight-leg jeans, white
sneakers. [HAIR]. Plain light gray background,
soft even daylight, no bright hot spots on the
skin. No makeup, bare natural lips, no gloss.
Real skin texture, no retouching, no skin
smoothing. Same person, not a lookalike.
```

**REF-07** · Attach REF-03, REF-06 · 2:3
```
Using the attached reference images, keep this
woman's face, hair, body, skin tone and outfit
exactly the same, but photograph her in exact
side profile. Full body, head to toe, standing
straight, arms relaxed at her sides. She faces
the left edge of the frame, so we see only her
left side: her face in profile, her left ear,
her shoulder, hip and legs from the side. She
looks straight ahead, not at the camera.
Relaxed neutral expression. [BUILD]. Fitted
white crew-neck t-shirt, mid-wash straight-leg
jeans, white sneakers. [HAIR]. Plain light gray
background, soft even daylight, no bright hot
spots on the skin. No makeup. Real skin
texture, no retouching, no skin smoothing. Same
person, not a lookalike.
```

**REF-08** · Attach REF-05, REF-06 · 2:3
```
Using the attached reference images, keep this
woman's hair, body and outfit exactly the same.
Full body, head to toe, seen from directly
behind, standing straight, arms relaxed at her
sides, no face visible. [BUILD]. Fitted white
crew-neck t-shirt, mid-wash straight-leg jeans,
white sneakers. [HAIR], natural flyaways. Plain
light gray background, soft even daylight.
Candid iPhone photo, no retouching.
```

**REF-09** · Attach REF-00 · 3:4
```
Using the attached reference image, keep this
woman's face, hair, skin tone and [MARK] exactly
the same. Chest-up, facing the camera, big warm
open smile showing her teeth, eyes crinkling
naturally, like she just heard something funny.
Plain light gray background, soft even
daylight, no bright hot spots on the skin.
Fitted white crew-neck t-shirt. [HAIR]. No
makeup, bare natural lips, no gloss. Real skin
texture: visible pores, peach fuzz, smile lines,
slight redness, uneven tone, faint shine. No
retouching, no skin smoothing. Same person, not
a lookalike.
```

**REF-10** · Attach REF-00, REF-01 · 3:4
```
Using the attached reference images, keep this
woman's face, hair, skin tone and [MARK] exactly
the same. Chest-up. Her head and shoulders are
turned about 45 degrees to her left, so her nose
points toward the right edge of the frame. She
is mid-laugh, mouth open, eyes crinkled, head
tipped back slightly, looking past the camera.
Plain light gray background, soft even
daylight, no bright hot spots on the skin.
Fitted white crew-neck t-shirt. [HAIR]. No
makeup, bare natural lips, no gloss. Real skin
texture: visible pores, peach fuzz, smile lines,
slight redness, uneven tone, faint shine. No
retouching, no skin smoothing. Same person, not
a lookalike.
```

**REF-11** · Attach REF-00 · 3:4
```
Using the attached reference image, keep this
woman's face, hair, skin tone and [MARK] exactly
the same. Chest-up, facing the camera, calm and
serious, eyes looking down slightly as if
reading something in her hands. Plain light
gray background, soft even daylight, no bright
hot spots on the skin. Fitted white crew-neck
t-shirt. [HAIR]. No makeup, bare natural lips,
no gloss. Real skin texture: visible pores,
peach fuzz, slight redness, uneven tone, faint
shine. No retouching, no skin smoothing. Same
person, not a lookalike.
```

Gate for each shot vs REF-00 at full size:
- [ ] Same eye color, brows, nose, jaw, mark
- [ ] Skin no smoother than REF-00
- [ ] No exposure hot spots
- [ ] The angle or expression asked for was actually achieved
- [ ] Not a lookalike; the same person

Sheet lessons (Solei, Oct 15):
- Flare copies the reference pose. "Turned to her left" alone gave a slight cant; the frame-edge wording ("nose points toward the right edge of the frame") forces a real turn.
- Attach by visible side: the left profile leans on the 3/4 that shows the left cheek (REF-02); the right profile leans on REF-01.
- Freckles sometimes turn into heavy dark sun spots that add years. Reject those takes.
- Hair-only and back shots drift to crimped, uniform waves. Pick the loose, natural take that matches REF-00.
- Smiles and laughs: pick the take with the fewest crow's feet; deep ones add years.
- Full-body faces are small. That is normal; never shrink the file further.

Reject and regenerate with the closest approved angle. Never approve drift.

## Step 5. Save the identity
- Higgsfield: create an Element from REF-00 (instant, free, no training). Record its ID. Elements work with Nano Banana, GPT Image 2, Seedream, Seedance and Kling (Kling also needs a start frame). GPT Image 2.5 Flare does not take Elements, so Flare stills keep attaching refs.
- API path: attach REF-00 plus the closest-angle ref. The refs are the identity.
- Optional training (Soul, LoRA): only after 20 to 30 approved images in varied light and outfits. Write an IDENTITY block for it (Part B) so it doesn't drift.

## Step 6. Stress test (before any posting)
Eight runs built to break the identity. Flare, High, 2K, 9:16, 4 takes each, one at a time.

| Test | What usually breaks |
| --- | --- |
| Wet or slicked-back hair | Hair color shifts |
| Harsh midday sun | Skin tone, face shape, hot spots |
| Night or dim light | Model brightens the face, skin goes plastic |
| Strong style (flash, film look) | Whole face drifts to the style's look |
| Profile in a real scene | Nose and jaw |
| Full body in a new outfit | Sheet outfit leaks in, face too small |
| Dressed-up look (soft glam or sharp evening) | Skin smoothed, features "beautified" |
| One recreate from a real clip | Face pulls toward the source person |

Gates for each:
- [ ] Face matches REF-00
- [ ] Skin still real
- [ ] Hair color holds
- [ ] No hot spots on the face

Every failure becomes a line in Part B "Identity fixes," the way Callie's SOUL IDENTITY block was born. Rerun until it passes.

Filter note (Solei, Oct 15): swimwear plus "thin straps" plus "water droplets on her skin" got 3 of 4 wet-hair takes blocked. Keep swimwear to the catalog name only. Blocked takes are refunded.

Fill in the brackets from the character file. Outfits always in catalog wording (Part B, Scene rules).

**#1 Wet hair** · Attach REF-00, REF-01
```
Using the attached reference images, keep this
woman's face, hair, and features exactly the
same. She is wringing water out of her hair
with both hands, just out of the [ocean / pool],
laughing at something off camera. [Place, with
2 real details]. [Swimwear in catalog terms].
Her hair is wet and slicked back, but still
clearly [HAIR COLOR]. Shot by a friend on an
iPhone, chest-up, slightly off-center. Late
afternoon sun from the left, warm and low.
Candid iPhone photo. Real skin texture: visible
pores, peach fuzz, slight redness, faint shine.
Even exposure on the face, no bright hot spots.
No makeup, bare natural lips, no gloss, no
retouching, no skin smoothing.
```

**#2 Harsh midday sun** · Attach REF-00, REF-02
```
Using the attached reference images, keep this
woman's face, hair, and features exactly the
same. She is taking a quick front-camera selfie
while waiting to cross a street, squinting a
little in the sun with a half-smile. [Sunny
street in her city, 2 details]. [Daytime outfit
in catalog terms]. [HAIR]. Front-camera selfie
at arm's length, chest-up. Harsh noon sun from
directly above, hard shadows under her brows
and chin, but even exposure on her skin, no
bright hot spots on the nose, forehead or
cheeks. Candid iPhone photo. Real skin texture:
visible pores, peach fuzz, slight redness, faint
shine. No makeup, bare natural lips, no gloss,
no retouching, no skin smoothing.
```

**#3 Night, dim light** · Attach REF-00, REF-11
```
Using the attached reference images, keep this
woman's face, hair, and features exactly the
same. She is sitting on [her balcony / her
couch] at night, scrolling her phone, reading
something with a small frown. [1 to 2 details
of the place]. [Loungewear in catalog terms],
hair up in a loose claw clip with strands
falling out. Shot by a friend from a doorway,
chest-up. The only light is warm lamp light
from behind the camera and the cool glow of her
phone on her face. The scene stays dim; her face
is softly lit, not brightened. Candid iPhone
photo, slight grain. Real skin texture: visible
pores, uneven tone. No makeup, bare natural
lips, no retouching, no skin smoothing.
```

**#4 Strong style** · Attach REF-00, REF-09
```
Using the attached reference images, keep this
woman's face, hair, and features exactly the
same. She is laughing outside a bar with
friends at night, mid-laugh, holding a drink.
Busy sidewalk, neon sign glow, blurred people
behind her. [Going-out top in catalog terms],
[jewelry], going-out look. [HAIR]. Disposable
film camera look with direct on-camera flash,
waist-up, slightly tilted frame. Flash lights
her face evenly with no blown-out glare patches.
Visible film grain. Real skin texture: visible
pores, faint shine. Light makeup only, tinted
lip, no retouching, no skin smoothing.
```

**#5 Profile in a real scene** · Attach REF-00, REF-03
```
Using the attached reference images, keep this
woman's face, hair, and features exactly the
same, seen in left profile. She is sipping a
coffee at an outdoor cafe counter, watching the
street, not looking at the camera. [Cafe, 2
details]. [Outfit in catalog terms]. [HAIR],
tucked behind her left ear. Shot by a friend
from her left side, chest-up, so we see her
nose in profile and [MARK]. Soft morning light
from the street side. Candid iPhone photo. Real
skin texture: visible pores, peach fuzz, slight
redness, faint shine. Even exposure, no hot
spots. No makeup, bare natural lips, no gloss,
no retouching, no skin smoothing.
```

**#6 Full body, new outfit** · Attach REF-00, REF-06
```
Using the attached reference images, keep this
woman's face, hair, and features exactly the
same, wearing this outfit instead of the one in
the reference images. She is walking down a
sunny sidewalk carrying an iced coffee, glancing
back at a friend with a big smile. [Street, 2
details]. [Full outfit and shoes in catalog
terms]. [HAIR]. Shot by a friend on an iPhone,
full body, head to toe, slightly off-center.
Warm morning sun from the side. Candid iPhone
photo. Real skin texture. Even exposure on the
face, no hot spots. No makeup, bare natural
lips, no gloss, no retouching, no skin
smoothing.
```

**#7 Dressed up** · Attach REF-00, REF-02
```
Using the attached reference images, keep this
woman's face, hair, and features exactly the
same. She is arriving at [an evening event],
turning toward the camera with a warm,
confident smile. [Venue at dusk, 2 details,
guests blurred behind her]. [Evening outfit in
catalog terms], [jewelry]. [Dressed-up hair].
Soft glam makeup: warm bronzer, groomed brows,
glossy nude lip, real skin underneath. Shot by
a friend on an iPhone, waist-up. Last light of
sunset from the left mixed with warm string
lights. Candid iPhone photo. Real skin texture:
visible pores, faint shine. Even exposure, no
hot spots. No beauty retouching, no skin
smoothing.
```

**#8 Recreate from a real clip:** pick a real clip with a clear adult (a bar, a party, a hair flip) and run the Part B recreate recipe with the saved Element.

## Step 7. Voice
- Design voices in ElevenLabs. Target the character's real age; deeper rasp and heavy texture add years.
- Write a short brief (age, background, energy, texture, what to avoid) and a sample line in the character's voice from their voice card.
- Pick one, keep the runner-up as a spare for a future character.
- Method: a real performance converted with speech-to-speech beats text-to-speech.
- Gate: [ ] Sounds their age, not older.

## Step 8. Brand, persona and voice card
People follow a person, not a pitch. Build the brand from the character's own life: every choice should be something this person would actually do, wear and say. Fill Brand, Why people watch, Persona and Voice card in Part B.

1. **Interest:** something they genuinely do (pilates, cooking, cafes, outfits, cars). An interest, not a niche: a niche boxes them in, while an interest gives people a reason to follow and still lets them post anything.
2. **Sub-interest (optional):** the narrow lane they become known for, so people link a thing to them ("rates every cafe she works from," "eggs 50 ways"). See the thing, think of them.
3. **Situation is an arc, not the niche.** Job hunting, a move, a new career: a storyline people follow to a payoff, not the topic of every post.
4. **Brand statement:** who they are plus their primary interest, in one line. It is the filter for every post: if a video doesn't map to it, it doesn't post.
5. **Why people watch:**
   - Series: 2 to 3 recurring formats, each able to run 30+ episodes.
   - Running bits: a catchphrase, a rating scale, a recurring disaster.
   - Recurring cast: roommate, friend, family. Off camera is fine; they give the character a world.
   - Payoff in the first second of every reel: a laugh, a reaction, a "wait, what."
6. **How they film:** the brand statement decides camera behavior. A loud, confident character holds the phone high and talks fast; a shy, dry one holds it low and lets pauses land.
7. **Voice card:** pillars map to the brand statement.

Gates:
- [ ] Brand statement fits in one line
- [ ] Every pillar and series maps to it
- [ ] Two series that could each run 30 episodes
- [ ] Fun test: worth watching with no product in it
- [ ] Reads differently from every other character. Same hook, different person.

## Step 9. Competitor research
Find real accounts that already win, in two lists. Write both into Part B.
- **Format competitors (3 to 5):** accounts already filming the formats this character will do. They show how to film: angles, framing, light, phone height, pacing, cuts. Their clips feed the recreate recipe and scene prompts. Take the filming, never their words, face, caption or handle.
- **Element competitors (any niche):** accounts with a piece worth borrowing: a hook structure, an energy level, an outfit pattern, a transition, a story shape. A cooking page's hook can open a job-hunt vlog. Borrow the structure, never the words.
- Gate: [ ] At least 3 format and 3 element competitors, each with one line on what to take.

## Step 10. Accounts and profile
- **Main account:** the character's life and personality, all series. The long-term asset. Grow it first.
- **Interest account (optional):** an audience-first page built on the interest. The character appears, but the hook is the interest. It grows faster because the platform knows exactly who to show it to, and it feeds the main account.
- **Profile in their voice:** handle, display name, bio and link note all sound like the character, not a brand. Put the link in a story highlight with a bio line in their voice pointing to it.
- **Disclosure:** the AI label per each platform's rules on every post, plus #ad on any paid or affiliate post.
- Gate: [ ] Bio reads like the character wrote it, and the link has a reason to click that isn't "buy this."

## Step 11. File and import
- Claude writes the full Part B file (Mode 3), with every ref link, the Element ID, build notes, stress test results and the brand layer. Save it as `claude/character-[name].md` and import it into your tools.

## Step 12. First 10 posts
- Every concept maps to the brand statement and passes the fun test.
- Mix the series; never the same format twice in a row.
- Strict QA on each (project instructions, QA mode). Any face drift is Regenerate, never Edit.
- Log every combo.
- Cheap volume: one body with several different hooks makes several posts.

## Step 13. Monthly growth review (every month, per account)
Follows per reel is the metric, not views. The funnel is views, then follows, then link clicks, then signups or sales.
1. Open Insights > Follows > Reels. Take the top 5 reels by follows and watch each twice.
2. Find what they share: hook, outfit, angle, setting, energy, series, length. Check format last.
3. Look at the bottom 5 for what the top ones don't have.
4. Write the **winning stack** into Part B. Every post carries it for the next 30 days, inside the fixed rules.
5. Retire what isn't working; pick 1 to 2 new tests (a new series, an interest account, a collab between characters).
6. Brand check: does the brand statement still fit? Change it only if the data says so.
7. Log it in Part B "Growth log."

---

# PART B: CHARACTER FILE

```markdown
# Character: [Name]

## Card
[Name], [age, 21+] years old. [Hair color, length,
texture, usual styling]. [Eye color], [face
shape], [brows]. [Build in neutral terms].
Distinguishing mark: [one subtle mark]. Style:
[3 to 5 words].

## Realism principle (UNIVERSAL)
[Name] looks real because [he/she] is not perfect.
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
- [mark]. Keep it subtle, never a feature.
- It is the only fixed mark. No accessory is
  permanent; there are no absolutes.

## Brand
- Interest: [what they genuinely do]
- Sub-interest (optional): [the lane they're
  known for]
- Arc: [the storyline people follow, e.g. a job
  hunt, a move]
- Brand statement: [who they are + interest, one
  line]

## Why people watch
- Series: [2 to 3 recurring formats, 30+
  episodes each]
- Running bits: [catchphrase, rating scale,
  recurring disaster]
- Cast: [roommate, friend, family]
- Payoff style: [what lands in the first second]
- How they film: [phone height, energy, pacing]

## Style (evolves, never a uniform)
- Any outfit fits as long as a real person [his/
  her] age would wear it for that moment.
- Every scene prompt names the full outfit and the
  shoes.
- Starting ideas (optional): [palette, go-to
  pieces].
- Accessories: [items], all optional per scene.
- Hair options: [3 to 4 stylings].
- Grooming default: [natural / none]. Dressed-up
  version: [for nights out and events].

## Voice
- ElevenLabs voice "[Name]" (voice_id [id]),
  picked [date].
- Method: [performer] performs, speech-to-speech
  converts.
- Sound: [age, tone, texture].

## Persona
- Vibe: [one line]
- Who [he/she] is: [situation, work, city, one
  lived-in backstory detail]
- Usual settings: [list]
- Defaults (overridable): [daytime look, real-
  moment feel over staged, no logos unless a
  brand deal]

## Voice card
- Who: [age, situation]
- POV: [how they tell stories]
- Talks like: [phrases]
- Humor: [type]
- Emoji: [which, how often]
- Never: [list]
- Pillars: [content types, each mapped to the
  brand statement]
- Example: [one hook in their voice]

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
- REF-00: [link]
- REF-01 to REF-11: [links]

## Fixed blocks
- REFERENCE: Using the attached reference images,
  keep this [woman/man]'s face, hair, and features
  exactly the same.
- IDENTITY (with any saved character, trained
  model or strong style): [hair color], [brows],
  [skin tone], [face shape], [one key feature]. If
  hair is wet or slicked back, add "but still
  clearly [hair color]."
- REALISM: Candid iPhone photo, natural light.
  Real skin texture: visible pores, [soft peach
  fuzz on the cheeks and jaw / light stubble along
  the jaw], a few stray hairs, subtle color
  variation with slight redness around the nose and
  cheeks, faint natural shine. Even, soft exposure
  on the face, no bright hot spots. [No makeup or
  light makeup only / No makeup], no beauty
  retouching, no beauty filter, no skin smoothing.
  Ordinary background, not a professional shoot.
- AVOID: studio lighting, perfect symmetry, plastic
  skin, airbrushed or smoothed skin, beauty filter,
  heavy makeup, blown highlights or hot spots on
  the skin, text, watermarks.

## Build notes
- [What the hero and sheet rounds taught about
  this character: card changes, prompt fixes,
  takes to avoid]

## Stress test
- [ ] 1 Wet hair  - [ ] 2 Harsh sun
- [ ] 3 Dim light  - [ ] 4 Strong style
- [ ] 5 Profile in a scene  - [ ] 6 Full body,
  new outfit  - [ ] 7 Dressed up  - [ ] 8 Recreate

## Identity fixes (from the stress test)
- [test]: [what drifted] -> [fix line to add]

## Saved identity
- Higgsfield Element "[Name]": [id]
- Trained model (if any): [platform, id, trigger]
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
- Format (how to film): [account]: [what to take]
  (3 to 5)
- Element (structure to borrow, any niche):
  [account]: [what to take] (3 or more)
- Take filming and structure only, never words,
  faces, captions or handles.

## Accounts
- Main: [handle], [platforms]
- Interest account (optional): [handle], [hook]
- Bio: [in their voice]
- Link note: [in their voice, a reason to click]

## Monetization (fit only)
- Products that fit their life: [categories]
- Affiliate: [programs, after checking each
  program's AI rules]
- Brand deal fit: [3 categories]
- UGC for hire: [yes/no]
- Rules: fun test first; a product is a guest,
  never the hook; selling stays rare and never
  breaks character; #ad on paid or affiliate
  posts.
- Funnel: views > follows > link clicks > signups
  or sales. Rank by follows per reel.

## Winning stack (from the last growth review)
- [elements every post carries for the next 30
  days]

## Growth log
- [month]: top 5 shared [x]; bottom 5 lacked [y];
  stack [z]; retired [a]; testing [b]; brand
  check [fits / changed to ...]

## Disclosure
Label all posted content as AI-generated per each
platform's rules. Paid or affiliate posts carry
#ad.

## Combo log (last 10)
- [date] [moment] / [camera] / [light] / [location]
  / [hair styling]
```
