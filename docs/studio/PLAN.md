# Character Studio: Phase 0 and Phase 1 Plan

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
- [ ] Confirm each model once the owner's key is in (waiting on the key)
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
- [ ] Owner uploads REF-00 to REF-11 and the mirrored REF-04 to
      `fixtures/callie/`
- [ ] Studio attaches her real sheet images (the import path is built and
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
- [ ] Owner connects the account once from Settings (needs a deployed or
  local Studio that can reach mcp.higgsfield.ai)

## Housekeeping (not blocking)
- [x] Remove the creator's affiliate code, feedback form, guide doc and
      demo personas and images (approved 2026-10-12)
- [x] Untrack `.claude/settings.local.json` and ignore it
- [x] "Made by Dan Kieft" badge removed from the product UI; README keeps
      a short thank-you (approved 2026-10-12)
