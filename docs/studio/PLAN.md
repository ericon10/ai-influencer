# Character Studio: Build Plan (Phases 0 to 2)

Scope: SPEC.md section 13, Phase 0 (foundation) and Phase 1 (character
creation, Stages 1 to 5). Decisions behind this plan are in
`DECISIONS.md`. Boxes are ticked as work lands on the
`character-studio` branch. Open boxes wait on the owner (fixtures, keys,
or a go-ahead), not on code.

Guardrails that apply to every item:
- No paid call without a quote shown first (enforced by the server).
- Tests use the mock adapter only.
- No em-dashes in code, copy, prompts, docs or commit messages.
- Prompts in the UI are hard-wrapped with one-click copy.
- Video requests always carry audio off.
- Secrets live in `.env` or the encrypted per-account vault, never in code.

---

## Phase 0: Foundation

### 0.1 Project setup
- [x] Decisions log, this plan, CLAUDE.md standing rules merged
- [x] TypeScript (strict), Vitest, `npm run check` (typecheck + tests + no-em-dash)
- [x] `.env.example` documenting every deployment secret
- [x] GitHub Actions CI running `npm run check`

### 0.2 Storage
- [x] Drizzle schema: accounts, users, memberships, sessions, audit log,
      provider credentials, characters (+ revisions), concepts, assets,
      ref images, candidates, jobs (+ events), ledger, budgets, quotes,
      account settings
- [x] Every table carries `account_id`; acting rows carry `user_id`
- [x] SQL migrations applied on boot; PGlite locally and in tests, Neon in cloud
- [x] Tenant-scoped repository layer (no query runs without an account context)
- [x] BlobStore interface: local disk driver, S3-compatible driver (R2)
- [x] Assets record checksum (SHA-256), size, dimensions, duration, source job

### 0.3 Platform services
- [x] AuthProvider interface + owner passphrase session (signed cookie)
- [x] Per-account credential vault (AES-256-GCM, versioned master key)
- [x] Structured logging (pino) with request, account, job ids and redaction
- [x] Audit log for keys, budgets and run approvals

### 0.4 Provider layer
- [x] `ProviderAdapter` interface (SPEC 7.1) plus capabilities and webhook parsing
- [x] Request validator: video always `audio: false`; hero runs reject refs
- [x] Mock adapter with scripted scenarios (success, slow, fail, nsfw,
      submit error, submit timeout, no output, crash mid-submit) producing
      real image and video files
- [x] Higgsfield API adapter (key id + secret, submit, status, result,
      cancel, webhook token, own upload for reference images)
- [x] Per-account model confirmation: path from the official Model API
      Reference, then one small quoted paid test per model
- [ ] Confirm each model once the owner's key is in (Flare, Seedance 2.5 and Kling 3.0
      Turbo confirmed 2026-10-13; the others wait on their first paid test)
- [x] Anthropic adapter for text and vision with token-based estimates
- [x] Provider contract test suite (runs against the mock in CI)

### 0.5 Cost ledger
- [x] Price book as versioned data; the version is stamped on every
      ledger entry (prices marked unverified until checked against the
      provider's live pricing)
- [x] Quote service: estimate, budget check (job, character, month, holds), expiry
- [x] Ledger entries: hold, charge, release, refund, adjustment (micro-USD)
- [x] Budgets per account with warn thresholds; blocking is server side
- [x] Cost views: per character, per stage, per approved asset

### 0.6 Job runner
- [x] State machine: quoted, queued, submitting, submitted, running,
      succeeded, failed, canceled, needs_attention, ingested
- [x] Submit with idempotency key; never auto-resubmit an unknown outcome
- [x] Webhook receiver (per-job token, constant-time check) wakes the job;
      status is always re-fetched from the provider
- [x] Poll loop with backoff as fallback; stuck-job alert after a set time
- [x] Ingest: download every output (host allowlist, size cap), checksum,
      store, create Asset, release hold, write actual charge
- [x] Runs in-process locally, as a worker container, or via a cron sweep

### 0.7 Media tools (ffmpeg)
- [x] Probe (resolution, fps, duration, audio streams)
- [x] Last frame at full resolution; step back about 0.5 s if blurry
- [x] Strip audio
- [x] Normalize: resolution, constant frame rate, pixel format, color range
- [x] Trim (including drop-first-frame for chained clips)
- [x] Join with seam scoring (SPEC 4.3, revised 2026-10-12): drop the
      duplicated first frame, SSIM score, cut when clean, cut on camera
      motion when the jump reads as a normal frame step, else color-match
      and re-score; never crossfade; a seam that still fails is marked
      failed and nothing is exported
- [x] Mix audio layers with gains onto a video
- [x] Tests on synthetic clips (mixed sizes, with and without audio,
      exposure drift, hard color jumps, a fast pan, dropped frames)

---

## Phase 1: Character creation (Stages 1 to 5)

### 1.1 Rules and templates as data
- [x] Rules engine: every SPEC 5.1 rule that can be checked in a prompt
      becomes a data rule (forbid, require, limit) with its SPEC reference
- [x] Prompt templates from SPEC 10 as config; the engine fills them
- [x] Prompt lint runs before every quote; a failing prompt cannot run
- [x] Hard-wrap utility shared by UI and exports

### 1.2 Stage 1: Inspiration intake
- [x] Upload 1 or more inspiration images (stored as assets)
- [x] Vision LLM Keep / Change breakdown (quoted, ledgered)

### 1.3 Stage 2: Concepts
- [x] 3 character cards: 40-word card, specific features, 2 side-specific marks
- [x] Validation: adult age, exactly LEFT or RIGHT per mark, neutral body terms
- [x] Human picks one; the card becomes the character record

### 1.4 Stage 3: Hero
- [x] 3 hero prompts from the template, 4 to 8 runs each (explicit count, quoted)
- [x] Text only: the request validator rejects any attachment
- [x] Natural makeup baseline enforced by template and lint
- [x] Human picks one hero across all prompts; it becomes REF-00
- [x] Upscale offer (2x, never more) when REF-00 is under 1,500 px tall
- [x] "The image wins": guided card edit when the hero differs from the card

### 1.5 Stage 4: Reference sheet
- [x] Sheet graph (SPEC 4.1) as data; validated acyclic, deps only on lower ids
- [x] One model and variant locked for the whole sheet
- [x] Sheet settings: quality high, 2k, 3:4 chest-up, 9:16 full body
- [x] Side-specific mark visibility lines per view (hidden marks are stated)
- [x] Next-up selection: lowest unblocked shot, refs attached automatically
- [x] Regenerate any shot from REF-00 on request
- [x] Stale invalidation: regenerating a shot marks every shot that
      depends on it, directly or through another shot, stale and offers a
      quoted QA recheck (no paid call runs on its own)

### 1.6 QA
- [x] **First: the mirrored-mark test** (Callie fixture, REF-04 negative case)
- [x] Structured perception call (vision LLM): head orientation, image-side
      positions of ears, jewelry, brow marks, framing, eye color
- [x] Deterministic side logic maps image sides to subject sides by view
- [x] Optional mirror-consistency pass (flip and re-ask) to catch model confusion
- [x] Checks: mark side, mark presence, extra jewelry, framing, eye color
- [x] Free mirror fix when flipping puts every mark on its own side and
      there is no text in frame (Callie's file)
- [x] Identity: FaceMatcher interface, YuNet + SFace implementation
      (onnxruntime-web in process; `npm run models`; skipped on profiles,
      backs and demo images)
- [x] Distinctness vs inspiration (a too-similar hero cannot be picked)
- [x] Verdict in plain language: Post, Edit or Regenerate

### 1.7 Stage 5: Character file
- [x] Export `character-[name].md` (YAML front matter + readable sections)
- [x] Import edits back; round-trip test (export, import, export is identical)
- [x] Importer reads Callie's real file (`fixtures/callie/character-callie.md`):
      card, marks, style, persona, her Higgsfield Element and model
      choices; sections the Studio does not model are kept word for word

### 1.8 Review UI
- [x] One "next up" card at a time, candidate beside REF-00 at full size
- [x] Side-by-side and slider compare, zoom on face, ears and hands
- [x] Approve / Reject with reason chips; each reason maps to a fix action (data)
- [x] QA verdict and reasons shown in plain words
- [x] Phone layout with thumb-reach actions and Undo

### 1.9 Studio UI
- [x] Design tokens and components (dark-first, light theme supported)
- [x] Characters (casting cards), character page, creation wizard
- [x] Price on every Generate button; budget meter; cost to date
- [x] Jobs drawer with honest status; Settings for keys and budgets
- [x] In-browser verification of every flow against the mock adapter

### 1.10 Acceptance: rebuild Callie
- [x] Her character file is in `fixtures/callie/` and loaded in the Studio
- [x] Owner uploads REF-00 to REF-11 and the mirrored REF-04 to
      `fixtures/callie/`
- [x] Studio attaches her real sheet images (the import path is built and
      tested; waiting on the images)
- [x] Regenerate any sheet shot from REF-00 (mock in tests; live only after a quote)
- [x] QA flags the mirrored REF-04 (ear cuff on the wrong ear), tested
      with recorded perception answers; a mirrored copy imported from the
      Sheet tab waits under "To check" and QA offers the free mirror fix
- [ ] Same check on her real images with a live vision call (needs a key
      and an approved quote)

---

## Higgsfield billing paths (owner, 2026-10-13)
- [x] Second Higgsfield adapter through the owner's account (MCP connector,
  plan credits); the REST API adapter stays for customers and production
- [x] Per-account default in Settings; quotes show credits on the account path
- [x] Server-side OAuth (PKCE, dynamic registration), tokens in the vault
- [x] Tests against an in-memory fake of the MCP server and OAuth endpoints
- [x] Owner connects the account once from Settings (needs a deployed or
  local Studio that can reach mcp.higgsfield.ai)

## Rule zero: Realism principle (owner, 2026-10-13)
- [x] First rule in CLAUDE.md and SPEC.md
- [x] Bare-face line hard-coded into every hero and sheet prompt
- [x] REALISM block mandatory in every image prompt (builder, lint, runner)
- [x] Banned-words lint: stripped with a warning, refused at run time
- [x] Adapters force beautify, face-enhance and skin-smoothing options off
- [x] Texture check after every upscale and edit ("skin smoothed")
- [x] QA keeps natural flaws and fails plastic skin even on a face match
- [x] One-line message on onboarding and the hero screen
- [x] Re-import Callie's file with its new Realism section and AVOID block
- [x] Hero step matches how Callie's REF-00 was made (text only, 4 to 8
  candidates per prompt across 3 prompts, the pick becomes REF-00)

## Deployment (owner, 2026-10-13)
- [x] Vercel project `character-studio`, deployed to production
- [x] Neon project `character-studio` in the owner's personal org
- [x] Browser uploads straight to R2 (presigned links, CORS)
- [x] Railway worker: Dockerfile, wake on demand, app sleeping
- [x] Production login with a throttle; 503 naming missing settings
- [x] Model test suite: five real paths in one quoted run, capped at $10
- [x] Owner adds the secrets (docs/studio/DEPLOY.md) and creates the
  Railway service
- [x] Model endpoints from the official Model API Reference (DECISIONS E5)
- [x] Owner runs the model tests (Settings, Model tests): all five passed
  2026-10-13 (GPT Image 2.5 Flare, Seedance 2.5 and Kling 3.0 Turbo confirmed
  on the API; Nano Banana 2.1 and the upscaler on the account)
- [x] Owner drags the "CALLIE MASTER CHARACTER" folder into Callie's
  Sheet tab; review any face or texture flags

## MCP connections
- [x] Shared connection flow for MCP providers on the owner's plan
- [x] Dzine AI slot, marked coming soon (no calls)
- [ ] Dzine AI live once its MCP server and OAuth details are confirmed

## Housekeeping (not blocking)
- [x] Remove the creator's affiliate code, feedback form, guide doc and
      demo personas and images (approved 2026-10-12)
- [x] Untrack `.claude/settings.local.json` and ignore it
- [x] "Made by Dan Kieft" badge removed from the product UI; README keeps
      a short thank-you (approved 2026-10-12)

---

## Phase 2: Scenes and edits (Stages 7 and 8, started 2026-10-13)

Decisions: `DECISIONS.md` F1 to F6, then G1 to G3 (defaults, not locks).

### 2.1 Scenes as data
- [x] `config/scenes.yaml`: moment types, cameras (who shoots), camera
      heights, framings, light, expressions, makeup, destinations (aspect), edit
      presets, models offered for stills, edits and upscales
- [x] Scene template, edit template and planner prompt in `templates.yaml`
- [x] Rules as data (defaults): reference slot (5.2.14), footwear named
      (5.2.16), plain and unbranded (5.2.17), no low angles up at the body
      or tight body crops (5.2.20), aspect by destination (5.2.22); the sheet's
      chest-up legwear rule applies to hero and sheet only

### 2.2 Stage 7: scene stills
- [x] Scene records with the owner's words and structured fields
- [x] Planner: Claude fills the fields from the owner's words (quoted);
      code builds the prompt (SPEC 9); every field stays editable
- [x] Reference slot by model: 2 to 4 sheet refs picked by angle with REF-00
      always (edit models), the saved character with no attachments (Soul),
      or the full card (text only)
- [x] Outfit written out in full and replacing the sheet outfit; footwear
      named; colors stated when water, wind or harsh sun change how hair
      looks (all defaults; jewelry is never added for you, see G3)
- [x] Combo log: the first pick writes the entry to the character file as
      a history; repeats are fine (the variety note starts off, G5)
- [x] One or two models side by side, 1 to 4 stills each, one quote
- [x] Drift lock after a still from a trained character (DECISIONS D3)
- [x] Scene QA: face match against the face and closest-angle refs (small
      faces skipped; a miss with other people in frame goes to a person),
      marks by side, logos and text, jewelry the scene did not ask for,
      framing, skin texture; plain-language verdict with ready fixes
- [x] Human gate: pick one or more stills per scene

### 2.3 Stage 8: still edits
- [x] One change per pass (5.3.24), never for face drift (5.3.25)
- [x] QA findings become ready-made edits (remove the logo, the extra
      jewelry, the cuff on the wrong ear); presets for expression edits with
      REF-00 attached for the face
- [x] Free mirror when the cuff is on the wrong ear and no text is in frame
- [x] A closer shot is a free crop of the wide still (scene aspect), then a
      2x upscale with the upscaler; texture must hold or it never replaces
      its source
- [x] Re-check any still (QA, quoted)

### 2.4 UI
- [x] Scenes tab: "What is she doing?", scene cards, combo log
- [x] Scene page: your words and Plan the details, the fields grouped by
      moment, outfit and camera (saved as you type), attached refs with
      their roles, models, price, stills
- [x] Still panel: compare with REF-00, QA in plain words, pick, reject with
      reasons, fix one thing, mirror, crop closer, upscale, prompt with copy
- [x] Verified in the browser against the mock (desktop and phone)

### 2.4b Defaults, not locks (DECISIONS G1 to G3)
- [x] Rule book: every rule fixed or default in `config/rules.yaml`
- [x] Defaults only ever warn (lint forces it); fixed rules alone block
- [x] No nudity or explicit content as a fixed check (lint and runner)
- [x] Switches per account and per character; editable sheet background
- [x] Settings > Rules page
- [x] Scene form: optional outfit and footwear, signature pieces as
      chips, camera height, Brands and logos switch, refs chooser
- [x] Required fields at the minimum (a scene needs only its moment);
      REQUIRED badges, section progress, "things left" above every blocked
      button, "e.g." examples (G5)
- [x] Prices: "Getting price...", a 10 s limit with the reason and Retry;
      saved live prices and price book credits on the account path (G5)
- [x] QA as advice: face drift confirm, mirror for any still
- [x] Audio per request; untested models warn
- [x] Tests: no default can block a run (`rulebook.test.ts`)
- [ ] Re-import Callie's updated file in production (only the mole fixed)

### 2.4c Faster scenes (DECISIONS G6)
- [x] Punch it up: three specific moments from a rough idea (quoted)
- [x] Use a scene for other characters (free copies, name swapped)
- [x] QA leads with where the mole belongs when a side is in doubt

### 2.5 Live
- [ ] First live scene for Callie (Nano Banana 2.1 on the account, GPT Image
      2.5 Flare on the API), after the owner sees the quote
- [ ] Soul 2.0 model test, then a Soul scene with its drift lock

## Phase 3: Video (Stage 9, started 2026-10-13)

Decisions: `DECISIONS.md` G7.

- [x] Make a video from a picked still: Seedance 2.5 at 720p, 1 to 4 takes,
      start frame plus optional end frame, 9:16, audio off, directions in
      the prompt, one continuous take (all editable)
- [x] Quick motion test (Kling 3.0 Turbo, 5 s), off by default, labeled
      faces not representative
- [x] Upscale this take (video upscaler), price shown with the take
- [x] End frame helper: head-only masked inpaint (Nano Banana 2.1)
- [x] Local clip QA: face on sampled frames, skin texture; smoothed
      upscales never replace the take
- [x] Video model picker with prices (Kling 3.0 Pro default; last pick
      remembered), DECISIONS G11
- [x] Prompt writer for stills and video, editable above Generate,
      DECISIONS G10

## Phase 3b: Text-overlay content builder (2026-10-13)

Decisions: `DECISIONS.md` G12.

- [x] B-roll library: uploads up to 200 MB, tagged by product, lean copy
- [x] Meme video: kept clip, optional B-roll hard cut, TikTok caption box
- [x] Slideshow: Claude writes hook, slides, caption, hashtags; images in order
- [x] Batch: captions pasted or written by Claude, one video each, zip

## The UX plan (approved 2026-10-13; `UX-PLAN.md`)

Decisions: `DECISIONS.md` G14, G15.

- [x] Worker light in the header; buttons held while it is not green
- [x] Posts home with account and character filters; Make another like this
- [x] One workspace per post: Idea, Stills, Video, Text, Finish
- [x] Write and generate (one price); Use this still writes the video prompt
- [x] Use this take keeps it; uploads become kept clips
- [x] Batches rotate several clips and B-roll clips
- [x] Library page and drawer (Stills, Clips, B-roll, Posts)
- [x] Settings tabs (General, Models, Rules, Budgets and usage, Notices)
- [x] Character setup as a stepper; the mole is the only fixed mark
- [x] Old addresses redirect
- [x] Clone Video in the Video step (G18): upload, characters, model picker
  with prices, original sound optional, results in Library > Clips, New
  post from a TikTok
- [ ] First live clone per model (confirms its price and endpoint)
- [x] New default REALISM block; Callie's new character file (G19)
- [x] Prompt writer follows the ultra-realism guide; director's notes;
  framing-aware REALISM; task, trigger, distance and phone camera fields;
  Diagnose and revise (G20)

## Phase 4: Fine-tune and batch at scale (evening build 2026-10-14)

Decisions: `DECISIONS.md` G13. Export or Fine-tune from the post screen;
OpenCut as a page in the Studio, project from R2, Done saves back.

- [x] Fine-tune over the workspace: layers, preview, split, trim, move,
      undo; Done saves the cut, renders the MP4 back to the post (G23)
- [x] The OpenCut engine: not needed (owner, G25). Fine-tune stays the
      Studio's own editor; the OpenCut project format is kept for later
- [x] Batch at scale: 50 videos, idempotent slots, retry failed, zip parts
- [x] OpenCut's license notice in the app (Settings > Notices)
- [ ] Written permission from the ai-influencer author (owner)
- [ ] First live take, then confirm the upscaler's real price
- [x] Chaining (continue from the last frame), sound bed, rough cut
      (Phase 3 finish, G22; UX-PLAN.md section 8)

## Phase 5: Amazing Edits (evening build 2026-10-14)

Decisions: `DECISIONS.md` G24. UX: `UX-PLAN.md` section 10.

- [x] Ten edits made by code on the worker (`config/edits.yaml`,
      `server/media/edits.ts`), each with Subtle, Normal and Strong
- [x] Idea step Format; Finish step Edit style (default None) with moving
      thumbnails and one-line descriptions
- [x] Shot B for two-shot edits: from a still, the Library or an upload;
      directions added to both takes; Make the close-up (free crop)
- [x] Captions follow the edit's time; word pop and freeze pop captions
- [x] Fine-tune Edit lane: style, strength, draggable payoff marker
- [x] Batches take the one-shot edits
- [ ] Live takes that test the whip pan and hand-over-lens directions
      (paid; owner approval)
- [ ] First close-up upscale on a live take (paid; owner approval)

## Overnight run (2026-10-14)

Decisions: `DECISIONS.md` G25 onward. UX: `UX-PLAN.md` section 11.

- [x] OpenCut decided: our own Fine-tune, OpenCut's format kept (G25)
- [x] Batch progress on Posts home (G25)
- [ ] Approved paid tests 1 to 6 (not run tonight; G25)
- [x] Edit pack 2: ten more edits, the person mask, caption styles (G26)

## Fixes from the first real run, and Recreate from a real clip (2026-10-14)

Decisions: `DECISIONS.md` G37 and G38. UX: `UX-PLAN.md` section 15.

- [x] The owner's words read for free; refs by framing; no sheet clothes; no gloss; 21+ (G37)
- [x] What was sent under every still (G37)
- [x] A pasted prompt sent as written; no mood words the owner did not use (G37)
- [x] The Idea step: one box, chips, More control (G37)
- [x] Prices: Nano Banana 2.1, 4 stills, Standard, 9:16 by default; real cost logged and flagged over 20% (G37)
- [x] ElevenLabs: Callie's voice ID; the importer skips spare voices (G37)
- [x] Recreate from a real clip: frame, 4 stills, You pick, face pass, checks, motion from the clip as uploaded, Trim (G38)
- [x] Kling 3.0 Motion Control on the Vercel AI Gateway (G38; removed in G39)
- [x] Flare's real price per quality, from its first logged runs (G39: Standard 1 credit, High 2.75)

### Round 16: Recreate finished (G39, UX-PLAN.md section 16)

- [x] Stills default: GPT Image 2.5 Flare, Standard, 9:16, 4 takes; "Bare natural lips, no gloss." on every Flare prompt
- [x] Nano Banana 2.1 credits explained (each take is its own line: 1.5 at 1k, 2 at 2k)
- [x] AI Gateway path removed (code, packages, env, to-dos)
- [x] Motion picker: Genjutsu, Wan 3.0, Wan 3.0 Prime, Kling 3.0 Motion Control, priced per billing path, greyed with a reason, last pick selected, per row in a batch with Set all
- [x] Exact API price read back after each API run (provider_estimate)
- [x] Gates fixed: face 0.363 or more, likeness under 0.36, before any motion spend
- [x] Entry points: Idea "Start from a real clip", Library "Use this clip", the recreate link (4 clicks from the link, 5 from the Library)
- [x] Step 2 chips: Scene to keep, Source traits to drop, the outfit, the motion line
- [x] Review: synced pair, face every 0.5 s with drift, OCR (Tesseract), cuts with Trim at the cut; Use this take goes to Text with no music
- [x] Recreate with another character; batch of up to 20 rows; spend cap per post
- [x] Guide and help: Start from a real clip section, Idea, Stills, Library, glossary, fresh screenshots
- [ ] E2E on production: kitchen clip, Callie, Genjutsu, 50-credit cap (waits for the owner's approve click)
- [ ] First paid Wan 3.0, Wan 3.0 Prime and Kling 3.0 Motion Control runs on the API (prices confirmed from provider_estimate)

### Round 17: gate margin, face pass by default (G40)

- [x] Gate margin calibrated on the two proven stills: face 0.45 or more, margin 0.12 or more, likeness under 0.45
- [x] Face pass on by default with the stills (one price), a switch to skip it; batches too
- [x] No-plan stills on GPT Image 2.5 say "untested for recreates" on the button
- [x] Nano Banana 2.1 on the Higgsfield API: not offered (official Model API Reference)
- [ ] E2E through the Studio: kitchen clip, Callie, Genjutsu, 50-credit cap (waits for the owner's approve click)

### Round 18: stills model choice, gate check (G41)

- [x] Recreate stills model choice even with the plan connected: Nano Banana 2.1 (plan) or GPT Image 2.5 (API); same prompts, face pass and gates; last pick remembered
- [x] Gate check after every 10 real recreates: face and margin of the stills picked vs passed over, suggested numbers, owner approves (Settings > Rules)
- [ ] First GPT Image 2.5 recreate (waits for the owner's approve click)
- [ ] E2E through the Studio: kitchen clip, Callie, Genjutsu, 50-credit cap (waits for the owner's approve click)

### Round 19: the blocked Recreate stills (G42)

- [x] What was sent on failed runs and on every Recreate still
- [x] Recreate prompts: face and hair only, no age line (21+ checked before the run), plain outfit, short realism line
- [x] Proved with single test stills: fixed prompt passes on the Studio's frame (3 credits net, blocked runs refunded)

### Editor QA audit (G43)

- [x] Test matrix and a Playwright drive like a user (desktop and phone) on the pinned editor
- [x] Captions: select by click in the preview, edit in place by double-click (preview and timeline), move by drag, wrap in the frame
- [x] Karaoke on the caption itself (place, look and editing kept), preview and export
- [x] Reorder shots by drag on the same track; M4A music opens; sound ends with the post; ducking under the voice
- [x] First frame on open; phone tabs on screen
- [x] `e2e/editor/` suite (`npm run e2e:editor`), before and after runs in the report
- [x] Second pass, the owner's full matrix: caption resize follows the handle (handles outside the box), one undo per drag, retime and redo, Pick a hook into the editor
- [x] A finger drags and resizes a caption at phone width
- [x] The post ends with its last shot: captions and music that ended with it follow it (no black tail after a speed-up)
- [x] Render check per feature with a timer clip: caption edits, clip edits (split, 2x, reorder), Pack 1 presets
- [ ] Usability fixes from the report (the owner picks), the sea of red included

### Recreate gates (G44)

- [x] Video rule: the still numbers over the take (middle face 0.45+, middle margin 0.12+, highest likeness under 0.45)
- [x] A paid take is never rejected: a warning with Keep this take or Try again; only the still gate blocks spend
- [x] Old rejects shown again with their scores and Keep this take (today's kitchen take)
- [x] Text found shows its frame with the words boxed
- [x] Face pass edits the chosen still (first image; element and REF-00 for the face only); scene check outside the face
- [x] Face pass skipped, not charged, when the best still clears a 0.30 margin
- [x] Video numbers in the gate check after every 10 real takes (kept vs tried again)
- [ ] The owner keeps today's take on production (the click is the owner's)

### Usability fixes (G45, UX-PLAN.md section 19)

- [x] Earlier failures in one gray line with Show and Clear (stills grid and run lists); only the run just started is red
- [x] Face strip drift under 0.45, the video rule's number
- [x] Editor: small corner dots, no Locked on text, caption no taller than the frame
- [x] Editor: freeze and speed ramp markers that open the Speed panel
- [x] Editor: bigger preview, click away to deselect, named tracks, speed on the shot

### Catalog wording (G46, UX-PLAN.md section 20)

- [x] `config/wording.yaml` and `server/core/wording.ts`: fit words out, body phrases out, underwear-sounding names swapped, a moment not a pose
- [x] Clip reader, planner, Punch it up and the writer (stills and video) cleaned; system prompts ask for catalog terms
- [x] Recreate, scene-still and face-pass templates: "the person's position" (reverted the same day: "the pose" stays, G47)
- [x] The owner's words go as typed, with a warning under the price (`wording-risky`)
- [x] Likely trigger words on a refusal and Retry with safer wording (`retry_safer`), priced, free rewording

### Editor, caption and upload fixes, two reverts (G47, G48, UX-PLAN.md section 21)

- [x] Reverts: "sports bra" stays (only "boy shorts" is swapped); "the pose" back in the Recreate stills, scene still and face pass prompts (G47)
- [x] No caption: a third choice next to White box and Outline on every video post and batch, kept with the post; no caption track in the editor (assemble and reopen), none in Done or Export MP4; switched back, the words return
- [x] A caption is never required for any output: video posts, batches (How many counts the videos), slideshows (no words: the stills as they are), spreadsheet imports
- [x] The editor opens with the take on the live site: fresh storage links (`src`), never the browser's cache, then the Studio's address, then 4 MB parts (`?proxy=1`); the Studio's redirect is no longer cacheable; a saved timeline without its shots gets them back
- [x] Add media in the editor: the Studio picker first (this post, the character, the Library), From computer second; tap adds at the playhead, drag drops on a track; picked media opens again after Done (`GET /content/:id/editor/media`)
- [x] Upload images in Library > Stills and a slideshow's Stills step: several at once, drag and drop, the camera roll; for the character picked; kept byte for byte (`POST /characters/:id/stills`); in the editor picker; originals over 4 MB come straight from storage
- [x] A working run row pulses everywhere (images, videos, renders, Claude)
- [x] Playwright like a user, desktop and phone: the live failure reproduced behind a proxy with the browser cache on (`e2e/editor/r2.ts`), every way into the editor, the picker (tap, drag, From computer, after Done), No caption (editor and export pixels), uploads (picked, dropped, byte for byte, slideshow)

### Storage, traffic and auto-clean (G49, UX-PLAN.md section 22)

- [x] Every image (full size and thumbnails) a redirect to a short-lived R2 link; thumbnails made once and kept in R2; grids ask for thumbnails
- [x] `/api/hf`, `/api/hfproxy`, `/api/img-proxy` deleted (unused by the Studio)
- [x] Worker deletes crash temp folders on start; free disk in `/health`, `/api/v1/worker` and Settings
- [x] Upload slots never used deleted after 1 day (daily clean, and an R2 lifecycle rule when the key may)
- [x] Settings > General > Storage: GB, files, estimated monthly cost ($0.015 per GB-month after 10 GB free), Measure now
- [x] Library: Delete one, Select many, warnings for sheet refs and items a post uses, Trash with Restore (7 days), then removed for good with thumbnails
- [x] Auto-clean of takes never kept and stills never picked (14 days by default; 3, 7, 14, 30 or Off); never sheet refs, heroes, character files, kept or starred takes, anything any post uses (timelines and archived posts included), what a kept take was made from, or saved Library clips; one test per rule
- [x] Next auto-clean: N items and a Preview with a star on each; the first Auto-clean waits for Start Auto-clean
- [ ] Parked: slim the posts list (LATER.md)
- [x] A post outside the newest 200 opens by its own address
- [x] Tests: trash, auto-clean, daily clean, temp sweep, API routes; Playwright desktop and phone; before and after transfer for a normal session

### Long run, part 1: usability fixes audited (G50)

- [x] All six already live (G45); phone stills grid fixed; phone tests and the face strip test

### Long run, part 2: hair rotation, makeup by setting (G51, UX-PLAN.md section 23)

- [x] Never-send list: busty, buxom, voluptuous, cup sizes; warned on the price when typed
- [x] Hair styling rotated per scene from the template bank, never one of the last 5 combo entries or scenes; the owner's words and typed styling win
- [x] Combo log records the hair styling (fifth part); wrapped lines read
- [x] Makeup by setting: bare at home, the gym, an early beach, waking up; soft everyday makeup in public; men groomed, no makeup words
- [x] Rules hair-rotation and makeup-by-setting (defaults); guide and help; unit, pipeline and Playwright tests

### Long run, part 3: character files from the Claude project (G52, UX-PLAN.md section 24)

- [x] Import a character file first on the Characters page; Start from a concept second
- [x] Free template v1.6 check in the Import dialog and on the character file (needed items, optional sections, [brackets]); never blocks
- [x] Update the character of the same name by default: posts, takes, sheet kept; combo log merged; identities kept; identical images skipped
- [x] Brand card on the character page, written back into the file's sections
- [x] Winning stack in the prompt writer, planner and Punch it up; brand check in Punch it up (defaults)
- [x] Tested with Callie's current file and a full v1.6 file; unit, pipeline and Playwright tests

### Long run, part 4: editor polish (G53, UX-PLAN.md section 25)

- [x] Export for TikTok, Reels, Shorts: length cap, bitrate cap, loudness; Export, the editor's Done, hook variants, batches
- [x] Hook variants: up to 3 versions, one timeline, a different first 2 seconds each (a hook line, a first shot, a first edit), on the worker
- [x] Cover frame picker with cover text, a 1080 x 1920 JPEG
- [x] Safe zones (TikTok, Reels) over the editor's preview

### Name the garment (G54, UX-PLAN.md section 26)

- [x] The clip reader's outfit names a garment type, or the Recreate stills price warns ("name the garment: tank top, t-shirt..."); never on the owner's words
- [x] Read the outfit again: priced, the outfit only, beside the warning

### Slideshow power-up (G55, UX-PLAN.md section 27)

- [x] Audit of the slideshow flow (UX-PLAN.md section 27, the table "before")
- [x] Hook first: the hook box, 10 from the vault (free), Write 10 with Claude (priced), each tagged by pattern, filtered by chips
- [x] Use this hook: every slide drafted (6 by default, 3 to 10), the reveal on slide 3 or 4, a soft CTA last, 4 to 12 words, a shot each, special slides where they fit, the caption, at most 5 hashtags
- [x] Stills in one locked scene: the character (refs, or the element on the plan; the outfit locked) or a topic (no one, no face check, REALISM still in every prompt); 9:16 or 3:4; Generate the set and Reroll one slide, priced; Library and Upload per slide
- [x] The stills model on the plan (Nano Banana 2.1) or the API (GPT Image 2.5 Flare), the last pick kept
- [x] The Scene library (`slide_scenes`, migration 0015): save, pick, delete; a topic scene's picture as the place reference
- [x] Text styles (Classic, Text box, Minimal, Note) from one shared layout for the preview and the export; safe zones; drag or arrow keys to move; burned into the JPEGs
- [x] Special slides drawn by code, free: notification, text thread, rejection email, job posting; generic names only (`brand_names` in content.yaml)
- [x] CTA slide (a typeable handle), the caption (Rewrite, priced), #ad (Ad on slide 1, #ad first in the caption)
- [x] Export: numbered JPEGs at 1080 x 1920 and 1080 x 1440, caption.txt, post.json (`server/core/postExport.ts`), one zip
- [x] Make variations: new words, new image set, list reordered, new caption; a family (`variation_of`); the no-reuse warning (`slideshow-no-reuse`)
- [x] Batch from hooks: paste up to 10, Make 10 (one price, special slides released), one review with Approve, Reroll, Reject (`batch_of`)
- [x] Guide section "Slideshows, hook first", glossary, five annotated screenshots, How this works on each new panel
- [x] Tests: unit (layout, clamping, patterns, vault hooks, CTA, brand names, slide edits, post.json), pipeline (every action priced, both modes, the API path, export, variations, batch, no-reuse, Scene library), Playwright desktop, batch and phone

### Slideshow power-up 2: launch ready (G56, UX-PLAN.md section 28)

- [x] The four spec files in `docs/content/` (playbook, post writer brief, claims sheet, the plan CSV)
- [x] Write 10 with Claude the playbook way: a moment, a code (S1 to S12, L13 to L25), effects (E1 to E8), an alt hook, then a separate reviewer; only 1s and 2s show
- [x] Per account: a primary and a backup structure (Accounts, migration 0016, the fit table as data); never the last post's code (`structure-repeat`)
- [x] Jenga drafts: each slide opens the next, setup and punchline apart, payoff last, 4 to 14 words, the CTA line
- [x] Language lint, free and warnings only, on every hook, slide and caption, the plan preview and Finish (eight default rules, area copy)
- [x] Brief v1.1: THE STANDARD for slide 1 in every hook writer (one shared template), the reviewer's stop test first (a fail is a 3 at best), pain out of 10 on each card; three more hook checks (over 15 words, a label or timestamp to open, stacked quotes); the plan reader proven column-driven
- [x] Writing standard v1.2: the playbook and the brief v1.2 in `docs/content/`; THE STANDARD with its pass and fail examples in every hook writer; the five-check stop test; the v1.2 ladder; product endings from the four honest ones (no mention when SideStep does not fix the pain); two more lint checks (no job word, a dishonest product ending); TikTok-only export with the Instagram set as an option
- [x] Import a plan CSV: Preview (free) by day and account, the drafts as written (free), the plan fields on the post and in post.json version 2
- [x] Generate N posts: one price, ten posts at a time (job queue groups), up to 100
- [x] Alt hook swap (slideshows and video posts); variations start from the alt hook and go to an account of the same kind
- [x] Nine more mock screens drawn by code, and the Product screenshot (the owner's upload only; the export waits for it)
- [x] "Ad:" first in the caption for an ad or a product row
- [x] Guide: the launch plan section, the slideshow section updated, new glossary terms, six new or refreshed screenshots; How this works on the Launch plan card
- [x] Tests: unit (lint, playbook codes, the plan reader, the screens, the screenshot box), pipeline (hook writer and reviewer, never twice, the plan import and Generate N posts on the real CSV, the screenshot in both export sizes), Playwright (the plan, the hook cards, the lint, the swap, a lock screen and a product screenshot to export)
- [x] The length note over 22 words (owner: the v1.2 examples are the bar)
- [x] Posts home past 200 posts: Show older posts (60 at a time, filters on the server, chips from every post); the e2e finders page too
- [x] The plan's Pictures column shows each post's final count after Generate (it stayed "0 of 6" until a reload)
- [ ] The capped real test on the API path (production, the owner's click)

### Products (G57, UX-PLAN section 29, owner 2026-10-17)

- [x] Rule two in CLAUDE.md and UX-PLAN section 0: nothing product-specific is ever global
- [x] The post's product (`content_items.product_id`, migration 0017), the Idea step's Product row, an account's product as the default (no hard-coded defaults), never the first product; copies keep it
- [x] The general standard for every post (one call, no reviewer); SideStep's rules on top for SideStep posts only (`writing_standards`, the `sidestep_` templates, the product card's Writing rules)
- [x] Written for a product vs an ad for it; the dash check on every post, the other notes SideStep's
- [x] Posts home product filter; Accounts product column; Pick a hook by the post's product; B-roll by product; neutral placeholders and drawn screens
- [x] Launch plan: numbered steps, the plan's pick, only the ticked rows, the CSV's product (a name) and ad columns, older yes or no files
- [x] Tests: unit (products.test.ts, the lint, the plan reader), Playwright (products.spec.ts, the launch plan)

### Slide image model (G58, UX-PLAN section 30, owner 2026-10-17)

- [x] The stills path is the pick (Your Higgsfield plan or the Higgsfield API) on the Stills step and the Launch plan card; the model follows who is in each slide
- [x] A slide with the character: the character file's stills default (else its second choice, else `default_still_model`), Flare's "Bare natural lips, no gloss." kept
- [x] A slide with no one: the cheapest model the path runs, from the price book (`empty_still_models`); who is in a slide read from the shot, switched on the slide card
- [x] Plan-path billing: every Higgsfield still carries its path, so Flare on the plan is quoted, held and charged in credits through the account
- [x] Clip opening stills follow the card's path; the plan preview prices each photo on its own model, in credits or dollars
- [x] Model and price on every stills button (two models named when a run mixes them)
- [x] Guide (slideshow and launch plan sections, two glossary terms); tests: unit (`stillModels.test.ts`, `slideModels.test.ts`), Playwright (`slidemodel.spec.ts`)

### Daily spend cap (G59, UX-PLAN section 31, owner 2026-10-17)

- [x] Per day in Settings > Budgets and usage, $10 by default (`budgets.yaml` `day`), saved per account; today is the calendar day in UTC
- [x] One cap for the plan and the API: plan credits at the price book's API rate (`api_credit_usd`)
- [x] A run that would pass it waits and says why (today's spend, the run's price, the cap, what to do); re-checked at the click
- [x] Generate N posts: each later group of ten checked when its turn comes; over the cap it waits with the same words, no charge, and starts when the cap is raised or on a new day
- [x] Today's spend next to the price on every paid button ("today $3.20 of $10"), desktop and phone; today in Budgets and usage
- [x] Guide (Settings, Prices, the glossary); tests: unit (`dayCap.test.ts`), Playwright (`dailycap.spec.ts`)

### Results (G60, UX-PLAN section 32, owner 2026-10-17)

- [x] Per-post results on every post kind (`spec.results`): post_url, posted_at, views, follows, saves and shares in the first 72 hours, decision, notes; saved as typed, never moving the post up Posts home, never copied
- [x] Typed on the post card (a Results row, the decision chip) and in the Finish step; the number pad on a phone; 12.4K and 1,203
- [x] Paste a CSV by row_id (or post_id, an account column for a shared row_id): a free preview (matched posts, the changes, row_ids not found, unknown columns), then Apply
- [x] The Results card on Posts home: follows per post first, totals, by account, product, character and hook structure, a posted_at range, the Posts home filters
- [x] Decision hints from data (`config/content.yaml` results): 50K+ views, make 3 variations; a hook family under 1K twice, drop it
- [x] post.json `results`
- [x] Guide (Results section, glossary, Posts home), How this works on the card and the Finish step
- [x] Tests: unit (the CSV reader, numbers, dates, decisions, totals, families, hints, post.json), pipeline (results.test.ts), Playwright (results.spec.ts)

### Download day (G61, UX-PLAN section 33, owner 2026-10-17)

- [x] Approve for posting on every video post and slideshow (`spec.posting`): the card's chip, the Finish step's Posting card; the batch review's Approve sets it
- [x] A post's day and slot: its own (Post on, in Finish), else the plan's, else the day it was posted
- [x] Slot times as data (`config/content.yaml` posting.slot_times), edited per account on the card
- [x] Download day on Posts home: the day (today by default), the free preview in posting order with each reason, Include packed posts
- [x] The zip on the worker (free): `<date>/<account>/<n>-<SLOT>-<HHMM>/` with 01.jpg... or video.mp4, caption.txt and post.json; checklist.txt and left-out.txt; approved posts with no export exported first
- [x] Packed: marked on each post (the chip downloads that zip again), left out of the next zip of that day; Zips made on the card
- [x] Phone: the list as cards, the button full width, 40 px targets
- [x] Guide (Download day section, glossary, Posts home), How this works on the card and the Finish step
- [x] Tests: unit (server/core/postingDay.test.ts), pipeline (server/pipeline/postingDay.test.ts), Playwright (e2e/editor/downloadday.spec.ts)

### Library viewer, filters and collections (G62, UX-PLAN section 34, owner 2026-10-17)

- [x] One viewer (`src/studio/viewer.tsx`): full size, a clip muted with its controls, arrows, swipe, Esc, X, a tap outside, focus kept and given back
- [x] Under the asset: name, date, character, model, cost, the posts that use it, Download, the place's use button (`GET /library/items/:id`)
- [x] Everywhere a still or clip is a thumbnail: Library tabs, the Library drawer in a post (view button, Use in this post), a post's stills and takes (Details opens the drawer), Recreate and Replace stills, slide cards, the batch review
- [x] Small copies in the grids, the full file only in the viewer; an uploaded clip's first frame as its picture
- [x] Filters on the server: character, type (the tab), model, date, used or unused, product, collection; chips with an x; per tab in the address
- [x] Collections per account (one setting): Add to collection, the Collection filter, Remove, rename, delete (the items stay)
- [x] Phone: full screen, swipe, the facts scroll under the asset, 44 px buttons
- [x] Guide (Library section, glossary: Viewer, Collection), How this works on the filters, the viewer and Collections
- [x] Tests: unit (`libraryFilter.test.ts`, `collections.test.ts`), pipeline (`library.test.ts`), Playwright (`viewer.spec.ts`)

### Browser suite on its own data (G63, owner 2026-10-17)

- [x] Each run on its own fresh Studio (`e2e/global-setup.ts`: PGlite and blobs in `e2e/.out/run-<time>/`, Vite on its own port), stopped at the end; `E2E_BASE` for a running Studio
- [x] The seed through the API in demo mode (`e2e/seed.ts`, `npm run e2e:seed`): Callie, Solei, SideStep, Library items, a base post with a take, a voice line, music, two Recreate posts; ids in `seed.json`
- [x] Every spec alone or in any order: no finders, no `E2E_POST` or `E2E_RECREATE`, no skips, `retries` 0
- [x] The plan's "0 of 6" after Generate: `/plan` counts its own running stills (the jobs list shows at most 100), and a still counts until it is in its slide
- [ ] Two full runs from fresh state, both green (one so far: 95 of 97; the No caption click under the sticky step bar is fixed, and the Export for Shorts test, where the page stopped updating after the export, passed on a rerun)

## Roadmap after Phase 4 (owner, 2026-10-13; not started)

SPEC 13.1, R1 to R7: Clone Video (first after Phase 3), Inspo board
and "Recreate this", Scene library, Multi-character runs, LoRA
training, Vault, Posting calendar (TikTok prepare and notify;
Instagram as ready-to-post exports). Endpoints and rough costs are in
the SPEC. Phase 2 and Phase 3 come first.
