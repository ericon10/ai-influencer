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

## Roadmap after Phase 4 (owner, 2026-10-13; not started)

SPEC 13.1, R1 to R7: Clone Video (first after Phase 3), Inspo board
and "Recreate this", Scene library, Multi-character runs, LoRA
training, Vault, Posting calendar (TikTok prepare and notify;
Instagram as ready-to-post exports). Endpoints and rough costs are in
the SPEC. Phase 2 and Phase 3 come first.
