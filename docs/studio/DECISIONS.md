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

### A3. Dzine (Deferred)
No adapter until Dzine publishes API endpoints and pricing (SPEC 7.2).
The provider layer is pluggable, so adding it later is one adapter file
plus price book rows.

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
2. Remove the creator's personal hooks from anything customers see:
   - Higgsfield affiliate code `fpr=dankieft` fired on connect
     (`src/utils/higgsfieldAuth.js` lines 120 and 265).
   - His Google feedback form (`src/App.jsx` line 16).
   - `docs/seedance-influencer-guide.md` ("All rights reserved"),
     the "Made by Dan Kieft" credit, and the demo personas and images
     in `public/`.
   - `.claude/settings.local.json` (tracked despite `.gitignore`,
     contains another person's local paths).

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
Routing is config: a small model for prompt filling and QA triage, a
mid model for QA verdicts, a large model only for concepts. LLM calls go
through the same estimate, ledger and budget path as image and video
jobs. The character file and rules sit in a cached prompt prefix.

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
