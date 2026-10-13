# Character Studio: Decisions Log

Decisions made at kickoff (2026-10-12). The owner delegated these calls
("make your own decisions, I trust you"), with two priorities: **easy to
use** and **looks high quality**. Each entry says what was decided and
why, so any of them can be revisited deliberately later.

Status values: **Decided** (build on it), **Default** (a sensible value
the owner can change in Settings), **Deferred** (not needed until a
later phase).

---

## A. Open questions from SPEC.md section 14

### A1. Local-first or hosted? (Decided)
**Hosted-ready, one codebase.** The same code runs on a laptop and in
the cloud. During the build it runs locally; it deploys to the cloud
when Phase 0 is stable.

Why: the product is going to be sold, so it must be hostable. Webhooks
need a public URL; locally the job runner simply falls back to polling,
which SPEC already requires as the fallback path.

### A2. Storage choice (Decided)
- **Database: Postgres everywhere.** Neon in the cloud; PGlite (real
  Postgres compiled to WebAssembly, stored in a local folder) for local
  development and for tests. One set of SQL migrations serves both.
- **Files: object storage behind one interface.** Cloudflare R2 in the
  cloud (no egress fees, which matters for video), local disk on a
  laptop and in tests.

Why: SQLite would need a second migration dialect later. PGlite gives
"no install, no Docker" locally while staying on the production engine.

Update 2026-10-12: reference images do not need our storage to be public.
The Higgsfield API has its own upload (`POST /files/generate-upload-url`
returns a presigned PUT link and a public URL; confirmed in the official
SDKs), so the Studio uploads each reference there before a run. R2 is
still the plan for hosting the Studio's own files in the cloud.

### A3. Dzine (Deferred)
No adapter until Dzine publishes API endpoints and pricing (SPEC 7.2).
The provider layer is pluggable, so adding it later is one adapter file
plus price book rows. Update 2026-10-13: a Dzine AI slot now sits on the
shared MCP connection flow, marked coming soon (E4).

### A4. Budget limits (Default)
| Scope | Default cap | Warn at |
| --- | --- | --- |
| Per job (one run, all variations) | $3.00 | n/a |
| Per character (lifetime) | $50.00 | 80% |
| Per account, per calendar month | $200.00 | 80% |
| Confirm prompt for any single run above | $0.50 | n/a |
| Default variation count for outputs priced above $0.25 | 2 | n/a |

All five are stored as data per account and editable in Settings. A run
that would cross any cap is blocked before it reaches a provider.

### A5. License (Decided)
Neither the fork nor upstream `DaanKieft/ai-influencer` has a license
file, so by default copyright law reserves all rights to the author.
The owner has the creator's personal permission to use the code and
ZIP however they want. Recommended housekeeping before selling:

1. Get that permission as a one-line written note (an email is enough).
   Buyers and investors ask for it during due diligence.
2. Remove the creator's personal hooks from anything customers see.
   Done 2026-10-12 with the owner's approval:
   - Higgsfield affiliate code `fpr=dankieft` (the sign-in popup now
     goes straight to OAuth).
   - His Google feedback button on the classic pages.
   - `docs/seedance-influencer-guide.md` ("All rights reserved").
   - The demo personas and their images and videos in `public/`, plus
     `public/seeds.json`. Browsers that already had them drop them once
     on the next visit; nothing a user created is touched.
   - `.claude/settings.local.json` untracked and ignored.
   Later the same day the owner approved removing the "Made by Dan
   Kieft" badge from the product UI; README.md keeps a short thank-you.

These do not block the Studio build. They are tracked in PLAN.md.

### A6. Single user or accounts? (Decided)
**Accounts from day one in the data model, one login in v1.** Every
row carries `account_id` (and `user_id` where a person acted). Auth goes
through an `AuthProvider` interface. v1 ships an owner login (passphrase
plus a signed, http-only session cookie) so a hosted copy is never open
to the internet. A real identity provider replaces it later without a
schema change.

### A7. OpenCut classic or rewrite? (Deferred to Phase 4)
The Studio will write its own versioned, editor-neutral export folder
(`manifest.json`, `clips/`, `stems/`). The first exporter targets what
opencut-classic can open; the rewrite becomes a second exporter. The
OpenCut fork is never modified from this repo.

---

## B. Enterprise decisions

### B1. Language and structure (Decided)
- All new code is **TypeScript (strict)**. Legacy JSX stays as is.
- `server/` holds the API, the job runner, providers, media tools and
  the pipeline. `server/core/` is pure logic (no I/O) so the pipeline
  and QA rules are fully unit tested.
- `config/` holds rules, prompt templates, model routing, the sheet
  graph and the price book as validated data files. Accounts can
  override them in the database. Nothing about Callie lives in app
  code; she is a fixture in `fixtures/callie/`.

### B2. Libraries (Decided)
| Need | Choice | Why |
| --- | --- | --- |
| API | Hono | Typed, tiny, runs on Vercel and plain Node unchanged |
| DB access and migrations | Drizzle ORM + drizzle-kit SQL migrations | Typed schema, plain SQL migration files |
| Validation | Zod | Every request, config file and provider payload is parsed |
| Logging | pino (JSON) | Structured logs with request, account, job ids; secrets redacted |
| Images | sharp | Crops for QA, flips, dimensions, upscale checks |
| Video and audio | system ffmpeg via argument arrays | Deterministic, free, no shell injection |
| Tests | Vitest | Same toolchain as Vite |
| UI data | TanStack Query | Caching, background refresh of job status |

### B3. Hosting (Default)
Vercel for the web app, API and webhook receiver. One small always-on
worker container (Railway or Fly.io) for the job runner and ffmpeg,
sharing the Neon database. A Vercel Cron sweep is also provided, so a
Vercel-only deployment still works with slower polling.

### B4. Higgsfield: API, not the web subscription (Decided)
The existing app talks to Higgsfield's consumer MCP server through
browser OAuth, which bills the web subscription. SPEC calls for the
pay-per-use API (key id plus secret from the Higgsfield Console, server
side only, billed separately). The Studio's Higgsfield adapter targets
the API. The legacy pages keep working on the MCP path untouched. An
MCP adapter (to spend subscription credits) can be added later.

Facts that shaped the design (from the official SDK, MIT licensed):
- Statuses: `queued`, `in_progress`, `completed`, `failed`, `nsfw`.
  Failed and nsfw runs are refunded.
- Webhooks are attached per request (`?hf_webhook=`). Signature
  verification is not documented, so the Studio puts a per-job secret
  token in the webhook URL and **never trusts a webhook body**: a
  webhook only wakes the job, which then re-fetches status from the API.
- No pre-submit quote endpoint and no cost field in responses. So
  estimates come from our own versioned **price book** (data), actual
  cost is computed from the real output (for example actual seconds)
  and marked `computed` until reconciled against provider usage.

### B5. LLM provider (Decided)
Anthropic Claude, called server side with the account's own key.
Routing is config (`config/routing.yaml`). It ships with Claude Opus 5.5
for every LLM task (breakdown, concepts, card check, QA perception),
because side-of-face accuracy matters more than the few cents saved;
any task can be moved to Sonnet 5.5 or Haiku 5.5 by editing one line.
LLM calls go through the same estimate, ledger and budget path as image
and video jobs. The character file and rules sit in a cached prompt
prefix.

### B6. Face matching for identity QA (Decided)
InsightFace's pretrained weights are non-commercial, so they are ruled
out. Default: **OpenCV Zoo YuNet (MIT) for detection and SFace
(Apache-2.0) for embeddings**, run locally, free per call. Behind a
`FaceMatcher` interface so a paid service (for example AWS Rekognition)
can be swapped in. Before selling, have counsel confirm the training
data provenance of whichever model ships.

### B7. Money and metering (Decided)
- Amounts are integers in **micro-USD** (no floating point money).
- The ledger is append-only: `hold` when a run is confirmed, `charge`
  when it finishes, `release` or `refund` otherwise, `adjustment` for
  reconciliation. Every entry carries account, user, character, stage,
  provider, model, units, unit price and price book version. That is
  enough to become usage metering and billing later.
- Holds count against budgets, so two runs started at once cannot
  overspend a cap.
- Customers bring their own provider keys (SPEC). A `markup` field is
  reserved for a future resale model; it is zero today.

### B8. Estimate-before-spend is enforced by the server (Decided)
Every paid run is two calls: `POST .../estimate` returns a quote (price,
budget check, expiry), and `POST .../run` requires that quote id. The
server refuses a run without a fresh quote. The UI always renders the
quote on the button before it can be pressed. This makes the "never
spend without showing the estimate" rule structural, not a convention.

### B9. Double-charge protection (Decided)
A job is written as `submitting` (with an idempotency key) before the
provider call. If the process dies between submit and saving the
provider job id, the job is **not** resubmitted automatically; it is
flagged `needs_attention` for a human to check the provider console.

### B10. Secrets (Decided)
- `.env` holds only deployment secrets: database URL, storage
  credentials, the master encryption key, the session secret.
- Provider keys are entered in Settings, encrypted per account with
  AES-256-GCM under a versioned master key (envelope encryption, ready
  to move to a cloud KMS), and never returned to the browser beyond the
  last four characters.

### B11. Content policy (Decided)
- Characters must be adults. The concept step rejects any age under 21
  as a product default (Callie is 24); the hard floor is 18.
- The distinctness check (face similarity vs the inspiration image) runs
  whenever an inspiration image is used, so a character is a new person,
  not a copy of a real one.
- Each character stores its AI disclosure line (SPEC 8).

### B12. Quality gates (Decided)
- CI (GitHub Actions): typecheck, tests, and a no-em-dash check on every
  push. Tests never call a paid endpoint; all providers are mocked.
- A provider contract test suite that every adapter must pass, run
  against the mock in CI and against real providers only by hand, after
  an estimate is shown and approved.

### B13. Legacy app (Decided)
The Studio becomes the home screen. Legacy pages (Influencers, Photo
Studio, Brand Deals, Inspiration) keep working at their current routes
but leave the main navigation. Their localStorage data is not migrated.
Legacy copy still contains em-dashes; it is retired, not edited, per
the CLAUDE.md rule against casual changes to `Influencers.jsx`.

---

## C. Design direction

Owner priorities: easy to use, looks high quality. Researched on Mobbin
(references below). Direction:

- **Dark-first studio canvas** with a light theme, warm neutrals, and
  one vivid signature accent. Images are the hero; chrome stays quiet.
- **Price on every Generate button**, like fal's "Est. $0.54" run bar,
  and a small cost chip on every result.
- **Budget meter** like the OpenAI Platform usage page: "$0.13 / $10"
  with a thin bar, always visible on the character page.
- **Review is one card at a time**: candidate beside REF-00 at full
  size, side-by-side or slider compare (Customer.io, Leonardo), zoom on
  face, ears and hands, and big Approve and Reject buttons with reason
  chips. On a phone the actions sit in a thumb-reach bar with Undo.
- **Honest progress**: queued and generating tiles with real status
  from the job runner, not fake progress bars (Magnific style).
- **Plain-language labels** ("Left side, close-up"), prompts tucked
  behind a "View prompt" toggle, hard-wrapped, with one-click copy.

References:
[fal generate](https://mobbin.com/screens/81a65bb8-9abf-4c16-9b5c-3c5513123a91),
[OpenAI usage](https://mobbin.com/screens/008725f3-1e67-4ff3-96c4-d56f14d23e15),
[Magnific queue](https://mobbin.com/screens/c141ad75-38fb-4393-873e-0aad76848815),
[Customer.io compare](https://mobbin.com/screens/57b5bc1c-2a05-4d91-b9e5-6ded3abd1b2b),
[Leonardo split view](https://mobbin.com/screens/47b549a4-9c26-488e-a885-b275effe1e3f),
[Grok two-up pick](https://mobbin.com/screens/69969610-8f18-4e5b-9e8f-c2d2e6ccca58),
[Plenty of Fish action bar](https://mobbin.com/screens/fbbbf1e3-56f3-4f56-a8f5-ad411d771a1b).

## D. Owner rulings, 2026-10-12

### D1. Seams are never crossfaded
A blend ghosts when the subject moved (Callie's video rules). The joiner
cuts clean seams, cuts on camera motion when the jump reads as an ordinary
frame step, otherwise grades the incoming clip and re-scores, and marks a
seam that still fails as failed. The preferred path is no seam at all: one
take with a start frame and an end frame. SPEC 4.3 and rule 33 updated.

### D2. Higgsfield endpoints only from the official reference
Third-party copies of the Higgsfield catalog are not trusted. A model's
REST path comes from Higgsfield's official Model API Reference, and a model
counts as confirmed only after one small paid test passes (per account, in
Settings). USD prices come from open.higgsfield.ai/pricing. Seedance keeps
both paths: start and end frames directly on REST, mode omni_reference on
the web app and MCP connector.

### D3. Saved identities
A character can carry several: Callie has a trained Soul character (with a
SOUL IDENTITY block that goes into every Soul prompt and a drift-lock pass
after every Soul still) and an instant Higgsfield Element. A Soul request
carries the soul_id as `custom_reference_id` (official SDK). The drift-lock
pass runs when scene stills arrive in Phase 2; today it is recorded with
the identity and shown on the Character file tab.

## E. Owner rulings, 2026-10-13

### E1. Style is optional ideas, never a uniform
A character file's style section is read as optional starting ideas, hair
options and notes. None of it goes into a prompt. Every scene names its own
full outfit (rules `scene-names-outfit` and `scene-no-carried-outfit`), and
the only constant is a distinguishing mark such as Callie's left-ear cuff.

### E2. Two Higgsfield billing paths, chosen per account
Higgsfield bills two ways. The pay-per-use REST API spends a separate
prepaid USD balance; it stays the path for customers and production. The
owner's own account (the MCP connector, OAuth sign-in) spends plan credits;
it is for the owner's own work. Each account picks its default in Settings,
Higgsfield billing (new accounts start on the API).

- The path is stamped into each Higgsfield request when it is quoted, so
  the quote fingerprint covers it: switching the default needs a new
  estimate, and a running job finishes on the path it started on.
- Account-path estimates come from Higgsfield's free cost preflight
  (`get_cost`) in credits, with the price book's credit column as the
  fallback (an upscale needs its image uploaded before Higgsfield can price
  it). The ledger records credits as quantity with unit `credit`; the USD
  amount is credits times the owner's optional value per credit (0 unless
  set), which is what budgets see.
- Only inputs the model accepts on that path are sent (`mcp.params` in
  `config/models.yaml`, from models_explore), plus fixed values: audio off
  for every video, `use_unlim: false` so free-trial generations are never
  spent on the owner's behalf. Seedance frames use mode `omni_reference`.
- The sign-in is OAuth with PKCE and dynamic client registration, run on
  the server; tokens are sealed in the account's key vault like any key and
  renew themselves. Model tests always use the API, because they confirm
  API endpoints. Wan 3.0 Prime has no account path yet.

### E3. Rule zero: the Realism principle
Characters look real because they are not perfect. Flaws, real skin
texture and a no-makeup baseline are the product, and nothing in the
system smooths them away. It is rule zero at the top of CLAUDE.md and
SPEC.md and is enforced in code, so no template, setting or character
file can switch it off:

- `server/core/realism.ts` holds the bare-face line, the default REALISM
  and AVOID blocks, the banned words and the beautify option filter.
- The hero and sheet builders add "Bare face, no makeup, no retouching."
  and strip makeup words; every image prompt gets the character's REALISM
  block (or the default) and AVOID block.
- The lint adds code checks after the configured rules, and the job runner
  refuses to quote or run an image prompt without the REALISM block, any
  prompt with a smoothing word, or a hero or sheet prompt without the
  bare-face line.
- Both Higgsfield adapters force any beautify, face-enhance,
  skin-smoothing or prompt-enhance option off.
- After every upscale and edit, a Laplacian-variance check on the face
  crop (both images at the same scale) flags "skin smoothed" below 60% of
  the input's fine detail (`config/runtime.yaml`, qa.texture_min_ratio).
  A smoothed upscale never replaces REF-00.
- QA treats pores, freckles, redness, uneven tone, shine, flyaways, smile
  lines, asymmetry and moles as required, drops any "artifact" that names
  one, never echoes a suggestion to fix one, and fails plastic, waxy,
  airbrushed or porcelain skin even when the face embedding matches.

### E4. One connection flow for MCP providers; Dzine AI coming soon
The Higgsfield account sign-in became a shared MCP connection flow
(`server/providers/mcpConnections.ts`): OAuth with PKCE and dynamic client
registration, tokens in the vault, routes `/oauth/:provider/start` and
`/oauth/:provider/callback`. Providers are data (`config/runtime.yaml`,
mcp_connections). Dzine AI (www.dzine.ai) is listed there as coming soon
with no endpoints, so it shows in Settings, Connected accounts, and never
makes a call. Adding it later is its MCP URL, OAuth endpoints and an
adapter, on the same flow.

### E5. Higgsfield API endpoints from the official reference (2026-10-13)
Read from docs.higgsfield.ai (the Model API Reference and the shared
request pages); each entry in `config/models.yaml` names its page in
`reference`. Every model still needs its one paid test before it counts as
confirmed.
- On the API: Seedance 2.5 and 2.0 image to video, Kling 3.0 Standard, Pro
  and Turbo image to video, Wan 3.0 Prime image to video, Soul 2, and GPT
  Image 2.5 Flare and Sunburst (as Marketing Studio Image).
- Not on the API (absent from the reference): Nano Banana 2.1 and 2, the
  ByteDance upscaler (the API has no upscaler) and Mirelo sound effects.
  They are marked `api: false` and run only through the owner's Higgsfield
  account. The model test suite runs them there when the account is
  connected, in plan credits.
- Request shapes follow each schema exactly (several reject unknown
  fields): Seedance and Wan default audio on, so `generate_audio: false` is
  always sent; Kling Standard and Pro send `sound: off`; Kling Turbo has no
  sound field, so its audio is stripped on arrival; Marketing Studio and Soul
  send `enhance_prompt: false`; Wan sends `enable_thinking: false`.
- Every submit carries the job's own Idempotency-Key, so Higgsfield never
  starts or charges one generation twice. An unknown outcome still goes to
  a person. 423 and 503 retry later; a reused key is reported as an earlier
  accepted job.
- Polling follows Higgsfield's guidance: 2 s, backing off to 10 s.
- Prices: open.higgsfield.ai (the console and pricing page) is still not
  reachable from the build sandbox, so the price book keeps its "from" and
  placeholder prices until each test shows the real charge.
