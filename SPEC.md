# Character Studio: Software Scope v0.1

## Rule zero: REALISM PRINCIPLE (above everything else)

Characters look real because they are not perfect. Flaws,
imperfections, real skin texture, and a no-makeup baseline are the
product. Never let the system smooth them away.

This is enforced in code (`server/core/realism.ts`, the prompt
lint, the job runner, the adapters and QA), not only in this file:

1. **Hero and sheet (REF-00 to REF-11) are always bare-faced.** The
   prompt builders add "Bare face, no makeup, no retouching." to
   every hero and sheet prompt and strip makeup words. Editing a
   template cannot remove it.
2. **The REALISM block is in every image prompt.** The builder adds
   the character's own block (or the Studio default); the lint and
   the job runner refuse any image prompt without it. There is no
   setting to turn it off.
3. **Banned words:** flawless, perfect skin, smooth skin, airbrushed,
   retouched, porcelain, beautify, glamour retouch, skin smoothing,
   beauty filter, enhance face. The builder strips them and tells the
   user why; the runner refuses a prompt that still has one. Negated
   uses ("no airbrushing") and the AVOID block are fine.
4. **No beautify, face-enhance, skin-smoothing or prompt-enhance step
   anywhere.** Adapters force any such provider option off.
5. **Upscales and edits keep texture.** A Laplacian-variance check on
   the face crop, against the input at the same scale, flags "skin
   smoothed" and suggests a rerun. A smoothed upscale never replaces
   REF-00.
6. **QA keeps the flaws.** Pores, freckles, slight redness, uneven
   tone, shine, flyaways, smile lines, asymmetry and the subtle mole
   are required, never defects, and QA never suggests fixing them.
   Plastic, waxy, airbrushed or porcelain skin fails QA even when the
   face embedding matches.
7. **New users are told, in one line:** "Real skin and no makeup is
   what makes characters believable. Don't fix the flaws."

## Rule one: DEFAULTS, NOT LOCKS (owner, 2026-10-13)

The lessons in this document are starting suggestions, never
restrictions. The sheet keeps the person from drifting, face first;
after that the character can wear anything and do anything in real
life. Every rule is in one of two buckets:

- **FIXED (only these):** the Realism principle (rule zero), bare face
  on hero and sheet, characters 21 or older, no nudity or explicit
  content, a new person rather than a copy of the inspiration face,
  posts labeled as AI-generated, the price shown before any paid
  run, budget caps, keys server-side only. Fixed rules can stop a
  run.
- **DEFAULT (everything else), including section 5 apart from its
  Realism items (5.1.3 and 5.2.19):**
  pre-filled, fully editable, a warning at most, never a block. Each
  default can be switched off in Settings > Rules for all characters
  or for one.

Outside rule zero, where this document says "always", "never" or
"locked" about a creative choice, read it as the default the Studio
starts from.

---

One place to create consistent AI characters and turn them into
finished UGC images and video, driven by provider APIs instead of
a dozen logins and interfaces.

Built from a real end-to-end run (character "Callie", Oct 2026):
inspiration image to hero, 12-shot reference sheet, scene stills,
image-to-video, sound bed, and assembly. Every rule in this doc
came from something that worked or something that failed and
wasted credits.

---

## 1. Problem and goal

**Problem.** Making one consistent character and a short candid
video currently means: an LLM chat for prompts, Higgsfield for
some models, Dzine for others, a third site for cheap video,
ElevenLabs or a sound library for audio, a local tool to pull
frames, and an editor to stitch it. Every hop is a login, a
different UI, a different credit balance, and manual file
shuffling.

**Goal.** A single studio that:

1. Runs the whole character pipeline (concept, hero, reference
   sheet, character file, scenes, video, sound, assembly).
2. Talks to providers only through APIs and MCPs.
3. Encodes the hard-won rules so prompts come out right the first
   time.
4. Gates every expensive step behind a cheap draft plus QA.
5. Tracks cost per approved asset.
6. Hands finished clips to OpenCut for final touches.

**Non-goals for v1.** Social posting and scheduling, multi-user
teams, training our own models, and a full timeline editor (that
is OpenCut's job).

---

## 2. Repo strategy

Two existing repos, both forked privately.

| Repo | What it is today | Role in this system |
| --- | --- | --- |
| [DaanKieft/ai-influencer](https://github.com/DaanKieft/ai-influencer) | React + Vite web app, Vercel serverless `api/` folder, browser localStorage for data, Higgsfield connected via Settings | **The Studio.** App shell, pipeline, provider adapters, QA, cost ledger |
| [OpenCut-app/OpenCut](https://github.com/OpenCut-app/OpenCut) | MIT open-source CapCut alternative. Being rewritten (Rust core, moon/proto monorepo). Editor API, MCP server and headless batch rendering are **planned, not shipped**. Upstream not taking outside contributions yet. "opencut-classic" is the working version today | **The Finishing Editor.** Human final cut. Later, an automation target once its Editor API, MCP or headless mode ships |

**Recommendation: keep them as two repos.**

- The Studio (ai-influencer fork) is where almost all new code
  goes.
- Keep the OpenCut fork as close to upstream as possible. It is
  mid-rewrite, so heavy local changes will be painful to merge.
- Connect them by **file handoff now, API later**:
  - Now: the Studio does the deterministic rough cut itself with
    ffmpeg (stitch, trim, mix) and exports a project folder
    (clips, audio stems, manifest) that OpenCut opens.
  - Later: when OpenCut's Editor API, MCP server or headless mode
    lands, the Studio pushes timelines into it directly.

**Gaps in ai-influencer to close first:**

- **Storage.** localStorage cannot hold video, reference sheets,
  or a cost ledger. Needs a real database plus file storage.
- **Providers.** Higgsfield only. Needs a provider abstraction so
  WaveSpeed, Dzine, fal and others plug in.
- **Jobs.** Video jobs run for minutes. Needs an async job runner
  with webhooks and polling, not request-response calls.
- **License.** Confirm the ai-influencer license before any
  commercial use. OpenCut is MIT.

---

## 3. Architecture

```
                 +-----------------------------+
                 |        Studio Web UI        |
                 | characters, sheet, scenes,  |
                 | video, QA queue, cost view  |
                 +--------------+--------------+
                                |
                 +--------------v--------------+
                 |       Pipeline Engine       |
                 | stages, dependency graph,   |
                 | rules engine, prompt        |
                 | templates, approval gates   |
                 +---+----------+----------+---+
                     |          |          |
        +------------v--+  +----v------+  +v--------------+
        | Provider      |  | QA        |  | Media Tools   |
        | Adapters      |  | Service   |  | (ffmpeg)      |
        | Higgsfield    |  | face match|  | last frame,   |
        | WaveSpeed     |  | mark side |  | strip audio,  |
        | Dzine         |  | logo/text |  | trim, stitch, |
        | fal / others  |  | warp check|  | mix, export   |
        +-------+-------+  +-----+-----+  +-------+-------+
                |                |                |
        +-------v----------------v----------------v-------+
        |  Job Runner + Cost Ledger + Storage (DB, files) |
        +--------------------------+----------------------+
                                   |
                        export folder or, later,
                        Editor API / MCP
                                   |
                         +---------v---------+
                         |  OpenCut (fork)   |
                         |  final cut        |
                         +-------------------+
```

**Key properties**

- **Every generation is a Job** with provider, model, inputs,
  estimated cost, actual cost, status, outputs, and QA verdict.
- **Outputs are copied to our own storage on completion.**
  Provider URLs expire (Higgsfield keeps outputs at least 7 days,
  then may drop them).
- **Webhooks first, polling as fallback.** Higgsfield and
  WaveSpeed both support submit, then webhook or poll.
- **Higgsfield API is the primary provider.** Its pay-per-use
  pricing is competitive with aggregators; others are added for
  price-shopping, not as defaults.

---

## 4. The pipeline

Ten stages. Each one has an approval gate before the next one
spends money.

| # | Stage | Input | Output | Who decides |
| --- | --- | --- | --- | --- |
| 1 | Inspiration intake | 1+ inspiration images | Keep/Change breakdown | Auto (vision LLM) |
| 2 | Concepts | Breakdown | 3 character cards with specific features and 2 marks | Human picks |
| 3 | Hero | Chosen card | 3 hero prompts x 4 to 8 runs each, text only | Human picks REF-00 |
| 4 | Reference sheet | REF-00 | REF-01 to REF-11, built in dependency order | Auto QA, then human |
| 5 | Character file | Approved sheet | `character-[name].md` source of truth | Auto, human edits |
| 6 | Identity model (optional) | Sheet + best scenes | Trained character (e.g. Higgsfield Soul) | Auto |
| 7 | Scene stills | Concept or batch request | Scene prompts and stills | Auto QA, then human |
| 8 | Still edits | Flagged stills | Logo, text, extra-jewelry fixes | Auto |
| 9 | Video | Approved still | Draft clips, then premium final | Auto QA, then human |
| 10 | Sound and assembly | Approved clips | Mixed rough cut + OpenCut export | Auto, human finishes |

### 4.1 Reference sheet dependency graph

Run in plain number order. Every shot only depends on lower
numbers, so the next one is always unblocked once the previous
shots are approved.

| ID | View | Framing | Aspect | Attach |
| --- | --- | --- | --- | --- |
| REF-00 | Front, neutral | Chest-up | 3:4 | (hero) |
| REF-01 | 3/4 left | Chest-up | 3:4 | 00 |
| REF-02 | 3/4 right | Chest-up | 3:4 | 00 |
| REF-03 | Left profile | Chest-up | 3:4 | 00, 01 |
| REF-04 | Right profile | Chest-up | 3:4 | 00, 02 |
| REF-05 | Back of head | Chest-up | 3:4 | 03, 04 |
| REF-06 | Front | Full body | 9:16 | 00 |
| REF-07 | Side | Full body | 9:16 | 03, 06 |
| REF-08 | Back | Full body | 9:16 | 05, 06 |
| REF-09 | Open smile | Chest-up | 3:4 | 00 |
| REF-10 | 3/4 laughing | Chest-up | 3:4 | 00, 01 |
| REF-11 | Serious, looking down | Chest-up | 3:4 | 00 |

**Invalidation rule.** If any shot is regenerated, every shot
that attached it is marked stale and re-queued for QA (example:
a mirror-flipped REF-04 invalidates REF-05 and REF-08).

### 4.2 Video flow

```
approved still (start frame)
   |
   v
Clip A draft (cheap model, 480p/720p, audio OFF)
   |  QA: face match, no warp, no talking, motion right
   v
Clip A final (premium model only if the draft passed)
   |
   +--> extend forward with Clip B prompt  (preferred: one file)
   |      or
   +--> start frame + approved end still   (most reliable for
   |                                         a specific ending)
   |      or
   +--> extract last frame (full res) -> Clip B -> stitch
   v
sound bed + mix -> rough cut -> OpenCut
```

### 4.3 Seam handling (OpenCut never sees a seam)

Chained clips are joined and verified inside the Studio. OpenCut
only receives finished, continuous shots.

1. **No seam is the goal.** A shot that fits in one generation is
   one take, with a start frame and an end frame when it has to land
   somewhere specific (for example the look into the lens). Chaining
   is for shots longer than one take allows; extend is used only
   where a provider offers it at an affordable tier. Last-frame
   chaining works on any model at any resolution, so seams can be
   tested on cheap 480p drafts.
2. **Normalize before joining.** Re-encode every clip to the same
   resolution, constant frame rate, pixel format, and color range
   (AI clips arrive in mixed sizes, e.g. 480x854 and 716x1280).
3. **Auto-join. Never crossfade:** a blend ghosts when the subject
   moved.
   - Drop the first frame of the incoming clip (it duplicates the
     handoff frame).
   - Score the join (SSIM or frame difference between the last
     frame of clip A and the first kept frame of clip B).
   - At or below threshold: cut.
   - Camera moving across the seam: cut when the jump looks like an
     ordinary frame step of that motion. The motion carries it.
   - Otherwise color-match clip B to clip A (a grade, not a blend)
     and re-score; cut if it now passes.
   - Still above threshold: mark the seam failed. Never export a
     failed seam, and never blend it away.
4. **Cutaway fallback.** Offer a 1-second cutaway (string lights,
   a glass on the table, the crowd) generated from the same scene
   to cover a seam that fails.
5. **Export shots, not beats.** A multi-beat moment ("listens,
   then looks into the lens") exports as one continuous file.
   Edit points in OpenCut are only real cuts between shots.
6. **Seam quality is resolution-independent enough** to approve
   at 480p; only the final render runs at high resolution.

---

## 5. Rules engine

These are the defaults the prompt builder and QA start from (rule
one). Each one is a lesson from the Callie run. Only the rules that
belong to rule zero (Realism, bare-faced hero and sheet) and the
fixed list in rule one can stop a run; every other rule here is a
warning at most and can be switched off in Settings > Rules. The
rule book is `config/rules.yaml`.

### 5.1 Character creation

1. **Hero is generated text-only.** Never attach the inspiration
   image to the hero run. The inspiration supplies the look, the
   card supplies the face.
2. **Pick one hero across all three hero prompts**, not one per
   prompt. Prefer a result where both distinguishing marks are
   visible, since every later shot copies what REF-00 shows.
3. **Bare-faced baseline (rule zero).** Hero and sheet are always
   bare-faced: no makeup, no retouching. Makeup is added per scene
   through the wardrobe line, never baked into the sheet. Adding
   makeup is easy for models; removing it changes the face.
4. **The image wins over the card.** When the approved hero
   differs from the card (ear cuff landed on the left ear, fuller
   lips), update the card to match the image.
5. **Sheet settings:** quality high or above, 2k resolution,
   3:4 for chest-up, 9:16 for full body. Low default quality
   smooths skin and erases small marks.
6. **Upscale REF-00 2x** (never more) if it is under about
   1,500 px tall before using it as a reference.
7. **One model and one variant for the whole sheet.** Switching
   mid-sheet causes drift. GPT Image 2.5 worked for Callie's sheet.
8. **Chest-up prompts never mention jeans or shoes.** Mentioning
   them pulled REF-01 out to a seated, three-quarter-length shot.
9. **Body is described in neutral brand terms** ("fit, athletic
   build, toned legs, defined waist, naturally curvy hips, natural
   medium bust"), never cup sizes or measurements. Models
   exaggerate named sizes. Tuck the sheet tee into high-rise jeans
   so the waist reads.
10. **Body is locked in REF-06/07/08.** Changing the build only
    requires redoing the full-body shots, not the face shots.
11. **Marks are side-specific.** Store each mark with its side
    (`mole: above LEFT brow`). For the opposite profile, the prompt
    says the mark is hidden. Models love to mirror marks. Jewelry
    is styling, not a mark: a signature piece such as Callie's ear
    cuff is suggested, never forced, and keeps its side when worn
    (`ear cuff: LEFT ear`).
12. **Marks should be subtle.** A subtle mole reads as real skin.
    QA confirms presence, not prominence.
13. **Hair styling is allowed to vary.** Hair color, length and
    part are identity; styling is not.

### 5.2 Scenes (stills)

14. **Reference slot depends on the platform:**
    - Edit model with image inputs (Nano Banana, GPT Image,
      Seedream, Flux Kontext): fixed REFERENCE line + 2 to 4
      sheet refs chosen by angle, always including one chest-up
      face ref.
    - Trained character (Soul): "[Name], the saved character" +
      any visible marks, no face description, no attachments.
    - Text-only: full 40-word card (expect drift).
15. **Override the sheet outfit explicitly**: full new outfit +
    "wearing this outfit instead of the one in the reference
    images."
16. **Name footwear (default).** Otherwise the sheet sneakers leak
    into scenes. Leaving it empty is allowed.
17. **Brand-free by default.** Prompts say "plain unbranded" for
    shoes, glasses, cups, and QA points out logos and printed text.
    A per-scene "Brands and logos" switch turns this off for brand
    deals and products.
18. **Camera matches the story.** Friend on a phone = "candid
    phone photo." Event photographer across the room = "candid
    event photo, long lens, about 25 feet away, compressed
    background, blurred foreground (door frame, diner's shoulder,
    candles)." Foreground occlusion is what sells "across the
    room."
19. **Imperfection is a feature.** Smile lines, skin creasing,
    shine, flyaways, uneven tan, soft focus stay. QA only rejects
    things a real camera would never capture.
20. **Body framing stays everyday (default).** The planner avoids
    low angles looking up at her body and tight crops on body parts;
    eye level, slightly high, over the shoulder, a friend shooting
    from rocks or a ledge, or a long lens from across a venue all
    fit. Any angle, including low or high, is allowed when chosen.
21. **Combo log.** A history of the character's last 10 picked
    scenes. Repeats are fine: every still comes out different. An
    optional variety note (off unless switched on) points them out
    and never stops a run.
22. **Aspect by destination:** 9:16 Reels/TikTok/Shorts/Stories,
    4:5 feed, 1:1 on request; other shapes are allowed.

### 5.3 Still edits

23. **Edit, don't regenerate**, when the face is right and only a
    detail is wrong (logo on a glass, extra earring). Far cheaper.
24. **One change per edit pass for small details.** Combined edits
    often skip the small one.
25. **Face drift is a strong warning.** QA says to regenerate with
    better-matched refs; the owner can still pick or edit the still
    after confirming. Plastic or smoothed skin is fixed (rule zero)
    and is never picked.

### 5.4 Video

26. **Image-to-video only.** Never text-to-video for a character.
27. **Audio off by default.** Generated audio invents gibberish
    speech, so requests are silent and sound is added in post. A
    clip can ask for audio when it is wanted.
28. **No audible dialogue in candid scenes.** People can talk
    visually; viewers hear only the room. Prompts include "silent,
    no audio, no dialogue."
29. **Never write "mouth moving as she talks."** It makes her the
    main speaker. Use "listens, nods, laughs softly, small natural
    mouth movements." Avoid: singing, shouting, exaggerated mouth
    movement.
30. **Start frames with a closed or softly smiling mouth.** A
    mid-laugh open mouth makes the model keep her talking.
31. **One primary action and one camera move per clip.** Two beats
    (chat, then look at camera) go into two clips, an extension,
    or a start + end frame pair.
32. **Eye contact must be explicit.** "Notices the camera" fails;
    she looks at her friend. Use: "turns her face away from her
    friend and straight toward the camera, looks directly into the
    camera lens, direct eye contact with the viewer, holds it,
    does not look back at her friend. Photographer stays out of
    frame." If it still fails, generate the end still and use
    start + end frames.
33. **Chaining:**
    - Extract the last frame at full video resolution with ffmpeg
      (never a screenshot).
    - If the last frame is blurry or mid-motion, step back about
      half a second.
    - Next clip uses the same model, resolution and fps.
    - Trim the first frame of the next clip (it duplicates the
      handoff frame).
    - Run one continuous audio track across the cut. Never
      crossfade the picture: color-match the incoming clip, or
      fail the seam (SPEC 4.3).
34. **Strip any audio track** from generated clips that did not ask
    for audio, even when audio was "off."
35. **Straight to the final model, then upscale the take you keep**
    (owner, 2026-10-13). Takes run on Seedance 2.5 at 720p; "Upscale
    this take" sends the exact take to Higgsfield's video upscaler, so
    it is preserved instead of re-rolled. Both prices are shown first.
    A quick motion test (Kling 3.0 Turbo, 5 s, "faces not
    representative") is optional and off by default, for complex
    motion only. Defaults, all editable: start frame plus optional end
    frame, 9:16, audio off, "no talking, no winking, steady eye
    contact" in the prompt, one continuous take. The end frame helper
    makes an end frame by inpainting only the head of the start frame
    (a mask), since full edits re-compose the whole scene.

### 5.5 Sound

36. **Layers:** far crowd (indistinct, no words) + close room
    detail (glasses, cutlery) + optional music very low.
37. **Real recordings over generated ambience.** Free libraries
    (Pixabay, Freesound) sound more natural and cost nothing.
38. **No AI music by default.** It was 95% of the audio spend in
    testing, and generation did not force instrumental mode. For
    paid ads, use music cleared for commercial use (TikTok or
    CapCut commercial libraries).
39. **Mix locally with ffmpeg.** Free and deterministic.

### 5.6 Providers and identity models

40. **Never block the pipeline on training.** Higgsfield Soul
    training sat "queued" for 2+ hours with no support channel
    beyond email and Discord. Reference-image models keep
    working meanwhile.
41. **Model routing from testing:**
    - Sheet: GPT Image 2.5 (high quality, 2k).
    - Scenes with refs: Nano Banana (held face and hair with 3
      refs).
    - Scenes, avoid: GPT Image 2.5 Flare (badly distorted hair).
    - Scenes with a trained identity: Soul 2.0 / Soul Cinema.
    - Video drafts: Wan or Kling Turbo. Video finals: Seedance 2.5
      (has extend and start/end frames) or Kling 3.0.

### 5.7 Output formatting

42. **No em-dashes in any generated copy.**
43. **Prompts shown in the UI are wrapped**, never one long
    horizontal line, and each has a one-click copy.

---

## 6. QA service

Automated checks run on every result before a human sees it.
Under rule one, QA findings are advice with one-click fixes (an
edit, the free mirror, a crop), never a block. Face drift is a
strong warning: the owner confirms before picking a drifted still.
Only the fixed checks stop a still: plastic, waxy or smoothed skin
(rule zero) and a hero that copies the inspiration face
(distinctness). In the table, "Fails when" means "flags when"
for every other row. Logos are flagged only when the scene is
brand-free, and jewelry the scene did not ask for is a note, not a
failure.

| Check | Method | Fails when |
| --- | --- | --- |
| Identity | Face-embedding similarity vs REF-00 (plus the closest-angle ref) | Score below threshold |
| Mark side | Vision LLM with the side-specific mark list | Mark missing, or on the wrong side |
| Eye color | Vision LLM, iris crop | Drifts from the card |
| Logos and text | OCR + vision LLM | Any brand mark or readable text |
| Extra jewelry | Vision LLM | Jewelry not in the character file |
| Hands | Vision LLM | Wrong finger count, impossible grip |
| Framing | Vision LLM vs requested framing and angle | Wrong framing (e.g. seated when chest-up asked) |
| Video identity | Face similarity sampled every N frames | Any frame below threshold |
| Video speech | Audio stream present, or mouth-motion heuristics | Audio present (auto-strip) or obvious talking when told to listen |
| Eye contact | Gaze estimate on final frames | Not looking at lens when required |
| Distinctness | Face similarity vs the **inspiration** image | Too similar (the character must be a new person) |

**Human gates:** hero pick, sheet approval, scene picks, final
video pick. Each shows the candidate next to REF-00 at full size.

**Note:** pick a face-embedding model whose license allows
commercial use.

---

## 7. Provider layer

### 7.1 Adapter interface

```ts
interface ProviderAdapter {
  id: string;                       // "higgsfield", "wavespeed"
  listModels(): Promise<ModelInfo[]>;
  estimate(req: GenRequest): Promise<CostEstimate>;
  submit(req: GenRequest): Promise<{ jobId: string }>;
  status(jobId: string): Promise<JobStatus>;
  result(jobId: string): Promise<Output[]>;
  cancel?(jobId: string): Promise<void>;
  verifyWebhook?(req: Request): boolean;
}

type GenRequest = {
  kind: "image" | "image_edit" | "video" | "video_extend"
      | "audio" | "train_identity";
  model: string;
  prompt: string;
  refs?: AssetRef[];          // reference images
  startFrame?: AssetRef;
  endFrame?: AssetRef;
  sourceVideo?: AssetRef;     // for extend
  aspect?: string;            // "3:4", "9:16"
  resolution?: string;        // "2k", "720p"
  quality?: string;
  durationSec?: number;
  audio?: false;              // video: always false
  seed?: number;
};
```

### 7.2 Providers to start with

| Provider | Access | What we use it for | Notes |
| --- | --- | --- | --- |
| **Higgsfield (primary)** | API key from Higgsfield Console, Python and TypeScript SDKs, webhooks or polling | Soul 2.0 / Soul Cinema, Soul training, Nano Banana, GPT Image, Seedance, Kling, Wan | Pay-per-use API is competitive (Oct 2026 list: Seedance 2.0 from $0.141/s, Kling 3.0 Standard $0.063/s, Wan 3.0 Prime from $0.068/s, lower with deposit discounts). API billing is separate from the web subscription. Download outputs promptly. ai-influencer already connects to it |
| WaveSpeed (secondary) | Bearer API key, `POST /api/v3/{model}` then poll or webhook | Models Higgsfield lacks; price-shopping drafts | Prepaid credits that do not expire, price shown before submit. Not automatically cheaper (Seedance 2.0 720p $0.24/s) |
| fal / Atlas Cloud (secondary) | API key | Cheapest Wan drafts (Atlas lists Wan Flash/Turbo around $0.02/s), Kling, Seedance | Optional second source for video |
| Dzine (manual only for now) | Subscription plans; no published API pricing found | Manual work if its subscription value beats per-second pricing | Do not build an adapter until API endpoints and pricing are confirmed |
| Dzine AI over MCP (coming soon) | OAuth sign-in to the owner's Dzine account, plan credits | Same as the manual entry, without leaving the Studio | A slot on the shared MCP connection flow (Settings, Connected accounts), next to the Higgsfield account. Listed as coming soon; no call is made until Dzine's MCP server and OAuth details are confirmed |
| ElevenLabs | API / MCP | Sound effects only if a library track will not do | Skip music generation |

**Price-shop per job.** Prices for the same model differ by
provider and change often. Each adapter returns an estimate, and
the router picks the cheapest provider that supports the task at
the requested tier. Re-check list prices monthly.

**Product direction: bring your own platform (note only, nothing
built yet).** Users connect any popular generation platform they
already pay for, either with an API key (pay-per-use) or by signing
in to their own account (plan credits, over MCP or OAuth). Every
platform goes through the same `ProviderAdapter` (7.1) and the same
connection flow, and the account picks which one pays, per account,
in one setting, the way Higgsfield already offers both paths (the
REST API and "My Higgsfield account"). Both Higgsfield paths stay
permanently: the account path is a long-term customer option, not a
stopgap. No new adapters are built until the owner asks for a
specific platform; Dzine over MCP stays a "coming soon" stub.

### 7.3 Routing policy

```
route(task):
  candidates = models that support task.kind and inputs
  drop models on the character's "avoid" list
  if task.tier == "draft":  pick cheapest passing candidate
  if task.tier == "final":  pick preferred model for task
  always: show estimate; refuse if over budget
```

---

## 8. Data model

```
Character
  id, name, card (40 words), marks[] {name, side, subtle},
  style {palette, pieces, accessories, hair_options},
  makeup {default: natural, glam_when: [nights_out, events]},
  persona {vibe, settings[], never[]},
  avoid_models[], preferred_models{},
  identity_model {provider, external_id, status},
  disclosure: "Label all posts as AI-generated"

RefImage
  character_id, ref_id ("REF-04"), view, framing, aspect,
  asset_id, depends_on[], status (pending|approved|stale),
  qa_report

Scene
  character_id, concept, moment_type, camera, light, location,
  outfit, footwear, makeup_level, aspect, prompt, refs[],
  status

Clip
  scene_id, start_frame, end_frame?, parent_clip?, tier
  (draft|final), action, camera_move, duration, status

Job
  id, provider, model, kind, request_json, estimate_cost,
  actual_cost, status, outputs[], qa_verdict, created_at

Asset
  id, type (image|video|audio), storage_url, width, height,
  duration, source_job_id, checksum

ComboLog
  character_id, date, moment_type, camera, light, location

CostLedger (view over Job)
  per character, per stage, per approved asset
```

The character file stays the human-readable source of truth and
round-trips with the `Character` record (export to
`character-[name].md`, import edits back).

---

## 9. Cost control

**KPI: cost per approved asset**, not cost per generation.

1. **Estimate before every run** and show it. Refuse runs over
   the per-job or per-character budget.
2. **Draft tier everywhere.** Lower resolution and cheaper models
   until QA passes.
3. **QA before upgrade.** No premium re-run, upscale, or
   extension on anything that failed automated QA.
4. **Edit over regenerate** for small fixes.
5. **Extend or end-frame** over re-rolling full clips.
6. **Free audio.** Library ambience, local mixing.
7. **Variation counts are explicit.** Default 2 for anything
   priced above a threshold, never a silent 4x.

**LLM token rules**

- Prompts are filled by code from templates and the character
  file, not written from scratch by an LLM each time.
- A small, cheap model handles routine prompt filling and
  first-pass QA triage. A larger model only for concepts and new
  scene ideas.
- Cache the character file and rules in the prompt prefix so they
  are not re-billed in full on every call.
- QA sends cropped regions (face, ears, hands, glass) instead of
  full frames where possible.

---

## 10. Prompt templates

Wrapped for readability. `{braces}` are filled by the engine.

**Hero (text-only, no attachments)**
```
Chest-up portrait of {card}. Facing the camera, relaxed
neutral expression, plain light gray background, soft even
daylight, simple white crew-neck t-shirt, hair in its usual
style. Photorealistic, real skin texture with visible pores
and small natural imperfections. Bare face, no makeup, no
retouching.
{REALISM block}
{AVOID block}
```

**Sheet shot**
```
Using the attached reference images, keep this woman's face,
hair, skin tone, and distinguishing marks exactly the same.
{framing}. {view and side-specific mark visibility}.
{expression}. {body line, full body only}. Plain light gray
background, soft even daylight, {outfit for framing}.
Photorealistic, real skin texture with visible pores, the same
freckles, redness and small imperfections as the reference. Same
person as the reference, not a lookalike. Bare face, no makeup,
no retouching.
{REALISM block}
{AVOID block}
```

**Scene (edit model with refs)**
```
Using the attached reference images, keep this woman's face,
hair, and features exactly the same. {moment}. {setting}.
{outfit}, {footwear}, {jewelry incl. marks}, wearing this
outfit instead of the one in the reference images. {makeup
level}, {hair styling}. {pose and gaze}. {camera: who shoots,
distance, framing, angle}. {light}.
{REALISM block}
{AVOID block: studio lighting, perfect symmetry, plastic skin,
text, watermarks, logos}
```

**Video clip**
```
Start frame: {asset}
Action: {one action, present tense, with speed}
Camera: {one move}
Secondary motion: {1 to 2 environmental details}
Style: silent {phone or event} footage, no audio, no dialogue,
natural motion, realistic physics, consistent face and outfit
throughout, no morphing.
Avoid: {talking, singing, exaggerated mouth movement, face
distortion, sudden cuts, warping background, + task-specific}
Duration: {5 to 8} seconds
```

**Still edit (one change)**
```
{single change, precise location and side}. Keep everything
else in the image exactly the same.
```

---

## 11. Human-friendly by design

Every item here fixes a real moment of friction from the Callie
run.

**Nobody juggles attachments or batch order**
- The sheet is a single "next up" card: one shot at a time, in
  order, with the right refs already attached. No REF math.
- Shots are labeled in plain words with thumbnails ("Left side,
  close-up"), not just IDs.

**Prompts are never the interface**
- Describe scenes in plain English ("cocktail party, a
  photographer across the room catches her looking"). The app
  writes the prompt.
- Change things in plain English too ("make her look straight at
  the camera"). The app picks the fix: edit, regenerate, or end
  frame.
- Prompts stay viewable for the curious: wrapped, never one long
  line, one-click copy.
- The app adapts the prompt to the chosen model automatically
  (refs vs trained character vs text-only).

**Review is fast and visual**
- Every candidate sits next to REF-00 at full size, with zoom on
  face, ears, and hands.
- Big Approve / Reject buttons. Reject offers reason chips:
  "face drifted", "mark on wrong side", "logo", "wrong framing",
  "hands", "she's talking". Each reason triggers the matching fix
  automatically.
- QA verdicts in plain language: Post, Edit, or Regenerate, with
  a one-click fix button.
- Works on a phone, so approvals happen from anywhere.

**Video is built in beats, not clips**
- Describe the moment as beats ("listens and laughs for 6 seconds"
  then "turns and looks into the lens"). The app decides whether
  to extend, use start and end frames, or chain clips, and handles
  last frames and trims behind the scenes.
- Audio is always off at generation. Pick a sound mood ("rooftop
  party, heard from inside"), and the app layers and mixes it.

**Money is always visible**
- Every Generate button shows its price before you click.
- Running cost per character and per finished asset.
- Budget caps that stop runs instead of surprising you.
- Draft quality by default; premium only on assets that passed
  QA, with a one-tap confirm.

**Waiting is handled for you**
- Long jobs run in the background with a phone notification when
  they finish.
- A stuck-queue alert after a set time (e.g. Soul training queued
  over 30 minutes), with an automatic fallback so work continues.

**Nothing is lost**
- Every version kept, with history and favorites. Rejected
  results are archived, not deleted.
- One character page, like a casting card: card, marks, sheet,
  best scenes, cost to date.

---

## 12. Before starting in Claude Code

1. Put this file in the repo root as `SPEC.md`.
2. Add a `CLAUDE.md` with the standing rules: no em-dashes in any
   copy, wrapped prompts, audio off for video, cost estimate
   before every generation.
3. Add test fixtures: Callie's character file and her 12 approved
   sheet images, plus the Consistent Character Image System
   methodology PDF.
4. Have API keys ready: Higgsfield API first (pay-per-use, start
   with a small top-up). WaveSpeed or Atlas later for cheap Wan
   drafts. Dzine only once its API is confirmed.
5. Define the first acceptance test: **rebuild Callie.** The
   Studio regenerates her sheet from REF-00 and its own QA passes
   or rejects each shot the way we did by hand.

---

## 13. Build phases

**Phase 0: Foundation**
- Fork setup, storage (database + file storage), Job runner with
  webhooks and polling, cost ledger.
- Provider adapters: Higgsfield first, then WaveSpeed or Atlas
  for price-shopping drafts.
- Media tools: ffmpeg wrappers (last frame, strip audio, trim,
  stitch, mix).

**Phase 1: Character creation (Stages 1 to 5)**
- Inspiration breakdown, 3 concepts, hero runs, sheet DAG with
  auto QA and stale-invalidation, character file export.

**Phase 2: Scenes and edits (Stages 7 and 8)**
- Scene builder with combo log, ref picker by angle, logo and
  text scan, one-change edit loop.

**Phase 3: Video and sound (Stages 9 and 10)**
- Draft-to-final routing, extend and start/end frame support,
  chaining, sound bed layering, automatic rough cut.

**Phase 4: OpenCut handoff and automation**
- Export folder (clips, stems, manifest) that OpenCut opens.
- Swap to OpenCut Editor API / MCP / headless when available.
- Batch mode: "7 scenes for the week" end to end, stopping only
  at human gates.

### 13.1 Roadmap after Phase 4 (owner, 2026-10-13)

Recorded, not built. Phase 2 and Phase 3 come first; Clone Video is
the first thing after Phase 3 ships. Rule one holds in every item:
every choice is a pre-filled default the owner can change, and only
the fixed rules stop a run (Realism and the texture check, 21 or
older, no explicit content, a new person rather than a copy, the
AI-generated label on posts, the price first, budget caps, keys
server-side).

Endpoints below are from Higgsfield's official Model API Reference
(docs.higgsfield.ai, read 2026-10-13) or are tools on the owner's
Higgsfield account (the MCP path, plan credits). Each new model gets
its one small paid test before it counts as confirmed. **Costs are
rough:** the Higgsfield pricing page was not reachable from the
build sandbox, so they come from the nearest price book entries and
are confirmed by the paid test. Every run is quoted before it starts.

**R1. Clone Video (Phase 3 add-on, highest priority)**
- Upload or paste a clip (3 to 30 s); pick one or more characters;
  rebuild it with the same motion and camera. "Keep original sound"
  is a per-clip switch (off by default, like every video). When on,
  the Studio puts the source audio back onto the result with ffmpeg
  (free and the same for every model) rather than trusting a model
  to keep it.
- One source across several characters: one quote with a line per
  character and video, and the total.
- Endpoints, picked per run (all behind the adapters):
  - API `kling-video/v3/motion-control/std` and `/pro`: one character
    image (REF-00 or an approved still) plus the source video;
    `keep_original_sound` sent as `no` (audio comes back by remux);
    `character_orientation` image or video.
  - API `higgsfield/genjutsu/motion-transfer/v1.0`: source video plus
    1 to 8 image refs, so several sheet shots can hold the face.
  - API `bytedance/seedance-2.5/video-edit`: prompt, source video and
    image refs; `generate_audio: false`.
  - API `kling-video/o3/video-edit` (3 to 15.5 s, up to 4 images).
  - Account tool `motion_control` (Kling 3.0, 720p or 1080p).
- QA on the output: face match against REF-00 on sampled frames,
  the texture check on face crops (smoothed or plastic skin fails),
  and distinctness against the performer in the source clip (the
  result must be the character, never the original person).
- Rough cost: Kling 3.0 motion control is not in the price book
  yet; Kling 3.0 image to video is $0.063/s (Standard) and $0.084/s
  (Pro), so plan on about $0.65 to $0.85 per 10 s clip per
  character. Seedance 2.5 video edit from $0.206/s, about $2.10 per
  10 s. QA about $0.05 per clip. Five characters on one 10 s source
  on Kling Pro: about $4.50.

**R2. Inspo board and "Recreate this"**
- Paste a link or upload a photo or clip. No scrapers: a link is
  used only when it is a direct image or video file, or a YouTube
  link through Higgsfield's own analysis; for an Instagram or TikTok
  post the owner uploads the file.
- Claude reads pose, outfit, setting, camera, framing and light and
  pre-fills a scene plan for the chosen character (the existing
  planner fields, all editable). Outfit and setting are copied as
  suggestions; the face and body always come from the character.
  A clip can go straight to Clone Video.
- Endpoints: Anthropic Messages with images (the vision model in
  `routing.yaml`); the existing `scene_plan` call; account tool
  `video_analysis_create` (an uploaded clip or a YouTube link,
  scene by scene, 3 to 5 minutes) as an option for longer clips.
- Rough cost: about $0.04 per photo and $0.10 per clip (8 sampled
  frames) at the price book's rates for the vision model, plus the
  plan (about $0.02).

**R3. Scene library**
- Save any approved scene, or just its recipe (fields, refs rule,
  models), as a template with a thumbnail. Multi-select templates
  and batch generate; each scene still goes through the scene
  flow, QA and the human pick.
- Endpoints: none new; the scene still models already in use.
- Rough cost: saving is free. A batch is the sum of its scenes: for
  example 5 templates x 2 stills on Nano Banana 2.1 is about $1.50
  plus about $0.05 of QA per still (price book placeholders).

**R4. Multi-character runs**
- Run one scene, template or clone across several characters at
  once. Each character's own sheet refs, card, marks and rule
  switches apply; one quote with a line per character and the
  total; budget caps checked against the whole batch.
- Endpoints: the same as the single run.
- Rough cost: the single-run price times the number of characters.

**R5. LoRA training (saved identities)**
- Pick approved images in the vault and train. The Studio suggests
  a 22 to 30 image set: the 12 sheet shots plus varied approved
  scenes (different light, framing, outfits and angles), chosen by
  face match to REF-00 and spread, never by beauty. The owner can
  add or remove any image.
- Endpoints: API `POST /v1/custom-references` (Soul ID; name,
  `model_version` v1, v2 or cinema, 1 to 100 images), polled at
  `GET /v1/custom-references/{id}`; the result's id is passed as
  `custom_reference_id` to Soul 2 or Soul Cinema, followed by the
  face-only drift lock (DECISIONS D3). Other trainers can be added
  behind the same adapter later. Training never blocks the
  pipeline (5.6.40): reference-image models keep working meanwhile.
- Rough cost: Soul ID training is not priced in the docs we could
  reach; it is quoted from the paid test and capped by the budget.
  Generating with the saved character is a Soul 2 still (about
  $0.10 placeholder) plus the drift lock edit.

**R6. Vault**
- One library for every image and clip: filters for generated,
  uploaded, edited and inspo, plus character, scene, model, status
  and date; collections the owner names. Feeds R2, R3 and R5.
- Endpoints: none (Postgres and object storage).
- Rough cost: free to use; storage on R2 is about $0.015 per GB per
  month with no download fees.

**R7. Posting calendar**
- Schedule finished content per character. Before posting: trending
  sound suggestions and a virality score, both optional.
- TikTok, prepare and notify (owner, 2026-10-13), through the
  owner's Higgsfield account: `tiktok_connect` and `tiktok_accounts`
  to link, `tiktok_music_trending` for sounds from TikTok's
  Commercial Music Library (cleared for commercial use, SPEC
  5.5.38), `tiktok_prepare_publish` and `tiktok_publish_status`.
  Higgsfield's publish form is submitted by the owner, so at the
  scheduled time the Studio prepares the post (or saves it to TikTok
  drafts) and notifies the owner to press publish.
- Instagram: no posting for now (owner, 2026-10-13). The calendar
  exports ready-to-post files instead: the media at the destination
  aspect, the caption with the disclosure line, and the suggested
  sound, in one folder per post. Higgsfield has no Instagram tool;
  posting later would go through Meta's Instagram API for a
  professional account, after Meta's app review.
- Virality: account tool `virality_predictor` on the finished clip.
- AI-generated label (fixed, owner 2026-10-13, rule `ai-label`):
  every prepared TikTok post sets the AI-generated flag
  (`is_aigc`), and every export carries the disclosure line in its
  caption and AI-source metadata in the file (IPTC digital source
  type "trainedAlgorithmicMedia", which platforms read to apply
  their own AI label). It cannot be switched off.
- Rough cost: posting, exports and the sound list are free; the
  virality score is charged in Higgsfield credits (price from its
  first quote).

---

## 14. Open questions

1. Local-first (like ai-influencer today) or hosted? Hosted makes
   webhooks easy; local-first keeps files on your machine.
2. Storage choice: Postgres (e.g. Neon) + object storage (e.g.
   Vercel Blob or Cloudflare R2), or SQLite + local disk for v1.
3. Which Dzine features are actually needed, and does its API
   cover them?
4. Budget limits per job, per character, per month.
5. ai-influencer license terms for commercial use.
6. Single user (you) for v1, or accounts from day one?
7. Track OpenCut classic or the rewrite for the handoff format?

---

## Appendix A: Reference character "Callie"

The first character built with this process and the test case for
the Studio. Her full character file lives in the Consistent
Character System project (`character-callie.md`).

- Card: 24, long honey-blonde beachy waves with a deep side part,
  warm hazel-brown eyes, soft oval face, full light-brown brows,
  full lips, fit athletic build with defined waist and curvy
  hips.
- Mark: subtle mole above her LEFT brow (the only fixed mark).
  Signature piece, optional: gold double-band ear cuff, on her LEFT
  ear when worn.
- Makeup: natural by default; soft glam for nights out and
  events.
- Sheet: GPT Image 2.5. Scenes: Nano Banana with refs. Soul 2.0
  character queued, not required.
- Proven scenes: rooftop cocktail party laugh (friend shot);
  event photographer through a doorway, long lens, across the
  room.
