# Character Studio: Phase 0 and Phase 1 Plan

Scope: SPEC.md section 13, Phase 0 (foundation) and Phase 1 (character
creation, Stages 1 to 5). Decisions behind this plan are in
`DECISIONS.md`. Boxes are ticked as work lands on the
`character-studio` branch.

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
- [ ] Decisions log, this plan, CLAUDE.md standing rules merged
- [ ] TypeScript (strict), Vitest, `npm run check` (typecheck + tests + no-em-dash)
- [ ] `.env.example` documenting every deployment secret
- [ ] GitHub Actions CI running `npm run check`

### 0.2 Storage
- [ ] Drizzle schema: accounts, users, memberships, sessions, audit log,
      provider credentials, characters (+ revisions), concepts, assets,
      ref images, candidates, jobs (+ events), ledger, budgets, quotes,
      account settings
- [ ] Every table carries `account_id`; acting rows carry `user_id`
- [ ] SQL migrations applied on boot; PGlite locally and in tests, Neon in cloud
- [ ] Tenant-scoped repository layer (no query runs without an account context)
- [ ] BlobStore interface: local disk driver, S3-compatible driver (R2)
- [ ] Assets record checksum (SHA-256), size, dimensions, duration, source job

### 0.3 Platform services
- [ ] AuthProvider interface + owner passphrase session (signed cookie)
- [ ] Per-account credential vault (AES-256-GCM, versioned master key)
- [ ] Structured logging (pino) with request, account, job ids and redaction
- [ ] Audit log for keys, budgets and run approvals

### 0.4 Provider layer
- [ ] `ProviderAdapter` interface (SPEC 7.1) plus capabilities and webhook parsing
- [ ] Request validator: video always `audio: false`; hero runs reject refs
- [ ] Mock adapter with scripted scenarios (success, slow, fail, nsfw,
      duplicate webhook, crash after submit) producing real image files
- [ ] Higgsfield API adapter (key id + secret, submit, status, result,
      cancel, webhook token), endpoints in config, verified on connect
- [ ] Anthropic adapter for text and vision with token-based estimates
- [ ] Provider contract test suite (runs against the mock in CI)

### 0.5 Cost ledger
- [ ] Price book as versioned data with effective dates
- [ ] Quote service: estimate, budget check (job, character, month, holds), expiry
- [ ] Ledger entries: hold, charge, release, refund, adjustment (micro-USD)
- [ ] Budgets per account with warn thresholds; blocking is server side
- [ ] Cost views: per character, per stage, per approved asset

### 0.6 Job runner
- [ ] State machine: quoted, queued, submitting, submitted, running,
      succeeded, failed, canceled, needs_attention, ingested
- [ ] Submit with idempotency key; never auto-resubmit an unknown outcome
- [ ] Webhook receiver (per-job token, constant-time check) wakes the job;
      status is always re-fetched from the provider
- [ ] Poll loop with backoff as fallback; stuck-job alert after a set time
- [ ] Ingest: download every output (host allowlist, size cap), checksum,
      store, create Asset, release hold, write actual charge
- [ ] Runs in-process locally, as a worker container, or via a cron sweep

### 0.7 Media tools (ffmpeg)
- [ ] Probe (resolution, fps, duration, audio streams)
- [ ] Last frame at full resolution; step back about 0.5 s if blurry
- [ ] Strip audio
- [ ] Normalize: resolution, constant frame rate, pixel format, color range
- [ ] Trim (including drop-first-frame for chained clips)
- [ ] Join with seam scoring (SPEC 4.3): drop first frame, SSIM score,
      color-match then 2 to 4 frame crossfade, re-score, fail the seam
      and refuse export if still bad
- [ ] Mix audio layers with gains onto a video
- [ ] Tests on synthetic clips (mixed sizes, with and without audio, hard
      color jumps)

---

## Phase 1: Character creation (Stages 1 to 5)

### 1.1 Rules and templates as data
- [ ] Rules engine: every SPEC 5.1 rule that can be checked in a prompt
      becomes a data rule (forbid, require, limit) with its SPEC reference
- [ ] Prompt templates from SPEC 10 as config; the engine fills them
- [ ] Prompt lint runs before every quote; a failing prompt cannot run
- [ ] Hard-wrap utility shared by UI and exports

### 1.2 Stage 1: Inspiration intake
- [ ] Upload 1 or more inspiration images (stored as assets)
- [ ] Vision LLM Keep / Change breakdown (quoted, ledgered)

### 1.3 Stage 2: Concepts
- [ ] 3 character cards: 40-word card, specific features, 2 side-specific marks
- [ ] Validation: adult age, exactly LEFT or RIGHT per mark, neutral body terms
- [ ] Human picks one; the card becomes the character record

### 1.4 Stage 3: Hero
- [ ] 3 hero prompts from the template, 4 to 8 runs each (explicit count, quoted)
- [ ] Text only: the request validator rejects any attachment
- [ ] Natural makeup baseline enforced by template and lint
- [ ] Human picks one hero across all prompts; it becomes REF-00
- [ ] Upscale offer (2x, never more) when REF-00 is under 1,500 px tall
- [ ] "The image wins": guided card edit when the hero differs from the card

### 1.5 Stage 4: Reference sheet
- [ ] Sheet graph (SPEC 4.1) as data; validated acyclic, deps only on lower ids
- [ ] One model and variant locked for the whole sheet
- [ ] Sheet settings: quality high, 2k, 3:4 chest-up, 9:16 full body
- [ ] Side-specific mark visibility lines per view (hidden marks are stated)
- [ ] Next-up selection: lowest unblocked shot, refs attached automatically
- [ ] Regenerate any shot from REF-00 on request
- [ ] Stale invalidation: regenerating a shot marks every shot that
      depends on it, directly or through another shot, stale and re-queues QA

### 1.6 QA
- [ ] **First: the mirrored-mark test** (Callie fixture, REF-04 negative case)
- [ ] Structured perception call (vision LLM): head orientation, image-side
      positions of ears, jewelry, brow marks, framing, eye color
- [ ] Deterministic side logic maps image sides to subject sides by view
- [ ] Optional mirror-consistency pass (flip and re-ask) to catch model confusion
- [ ] Checks: mark side, mark presence, extra jewelry, framing, eye color
- [ ] Identity: FaceMatcher interface, YuNet + SFace implementation
- [ ] Distinctness vs inspiration
- [ ] Verdict in plain language: Post, Edit or Regenerate

### 1.7 Stage 5: Character file
- [ ] Export `character-[name].md` (YAML front matter + readable sections)
- [ ] Import edits back; round-trip test (export, import, export is identical)
- [ ] Importer accepts Callie's existing file format

### 1.8 Review UI
- [ ] One "next up" card at a time, candidate beside REF-00 at full size
- [ ] Side-by-side and slider compare, zoom on face, ears and hands
- [ ] Approve / Reject with reason chips; each reason maps to a fix action (data)
- [ ] QA verdict and reasons shown in plain words
- [ ] Phone layout with thumb-reach actions and Undo

### 1.9 Studio UI
- [ ] Design tokens and components (dark-first, light theme supported)
- [ ] Characters (casting cards), character page, creation wizard
- [ ] Price on every Generate button; budget meter; cost to date
- [ ] Jobs drawer with honest status; Settings for keys and budgets
- [ ] In-browser verification of every flow against the mock adapter

### 1.10 Acceptance: rebuild Callie
- [ ] Owner uploads fixtures to `fixtures/callie/` (character file,
      REF-00 to REF-11, mirrored REF-04)
- [ ] Studio imports her character file and sheet
- [ ] Regenerate any sheet shot from REF-00 (mock in tests; live only after a quote)
- [ ] QA flags the mirrored REF-04 (ear cuff on the wrong ear)

---

## Housekeeping (not blocking)
- [ ] Remove the creator's affiliate code, feedback form, guide doc,
      credit line and demo assets from customer-facing surfaces
- [ ] Untrack `.claude/settings.local.json`
