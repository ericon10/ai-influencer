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
Routing is config (`config/routing.yaml`). It first shipped with Claude
Opus 5.5 for every LLM task; since G9 (2026-10-13) every Claude task
runs on Sonnet 5.5 by default, and each can be switched to Opus 5.5 per
account in Settings, Claude models.
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

## F. Phase 2 rulings, 2026-10-13

### F1. Reference images keep the plain gray background (owner)
Every reference image, the hero and REF-01 to REF-11, keeps its plain light
gray background. A character's REALISM block is written for scenes, so a
clause about the background ("ordinary background clutter") is left out of
hero and sheet prompts (`realismForReference` in `server/core/realism.ts`).
Scenes keep the block as written.

### F2. The planner fills fields; code writes the prompt
A scene is a set of fields (moment, setting, outfit, footwear, jewelry,
makeup, hair, pose, angle, expression, camera, framing, light, destination).
The owner writes a line in their own words; Claude fills the fields under
the character's rules (a quoted LLM call); the scene template turns them
into the prompt (SPEC 9: prompts are never written from scratch by an LLM).
Every field stays editable and is saved as it is typed.

### F3. Refs by angle come from the sheet graph
The ref picker reads `sheet.yaml` (view, framing, expression per shot), so
a character's "use when" table never needs REF math: REF-00 always, the
closest angle close up, a full-body ref when more than the head shows, and
the matching expression ref, at most 4. Models without image inputs use the
saved character (Soul, with the drift lock pass after it) or the full card.

### F4. Scene QA fixes what an edit can fix (face drift: see G3)
In scenes a logo, extra jewelry or the cuff on the wrong ear is an edit (or
the free mirror when no text is in frame), not a regenerate; face drift and
plastic or smoothed skin always regenerate. Jewelry the scene asked for is
not extra. Framing and an unclear angle go to a person. Face matching skips
faces under 64 px and sends a miss to a person when there are several
faces in the frame. Logos and text are read by the vision model; OCR is not
added (SPEC 6 lists OCR with the vision model; the vision model alone is
judged enough for now).

### F5. The combo log lives in the character file (repeats are fine: see G5)
The "Combo log (last 10)" section of the character file is the log. A run
whose moment and camera pair is in the last 10 entries is refused with the
date and place of the earlier one; the first pick of a scene appends its
entry (moment / camera / light / place) and keeps the newest 10. A rerun of
a logged scene is allowed.

### F6. Closer shots are crops, then an upscale
A closer shot of a scene is a crop of the wide still at the scene's aspect
(free, local), then a 2x upscale with the ByteDance upscaler on the
owner's account (never Nano Banana, which re-composes). An upscale or edit
whose skin detail falls below the texture threshold waits as failed QA and
never replaces its source.

## G. Defaults, not locks, 2026-10-13

### G1. Two buckets: fixed and default (owner)
The owner needs full creative freedom with every character: the sheet
keeps the person from drifting (face first), and after that a character
wears anything and does anything in real life. Every rule in the Studio
is in `config/rules.yaml` with a `bucket`:

- **Fixed**, the only rules that can stop a run, and they cannot be
  switched off: the Realism principle (REALISM block, banned words,
  beautify off, the texture check, the natural baseline), bare face on
  hero and sheet, characters 21 or older, no nudity or explicit
  content, the price shown before any paid run, budget caps, keys
  server-side only.
- **Default**, everything else: pre-filled, editable, at most a warning.
  The lint forces a default to "warning" whatever the yaml says, and
  `server/pipeline/rulebook.test.ts` trips every lintable default and
  shows none of them blocks.

One addition to the owner's fixed list, kept fixed on purpose and
confirmed by the owner: **distinct-person** (a hero that matches the
face in an inspiration image cannot become REF-00). It is the same
safety line as "no explicit content": the Studio makes new people,
never a copy of a real one.

### G2. Switches per account and per character
Settings > Rules lists every rule with its bucket. Each default has an
on/off switch for all characters and, separately, for one character; a
character setting wins over "All characters" and "Set here" clears it.
Rules with a value (the sheet background) take an edited value the same
way. Switches live in account settings (`rule_switches`); turning one off
changes what the Studio suggests and checks, never what the owner types.

### G3. What changed from earlier rulings
- **Jewelry is styling, not a mark.** Callie's updated file keeps only
  the mole as a fixed mark. The ear cuff is a signature piece the
  planner may suggest and the owner adds per scene; when worn it goes on
  the left ear. Scenes never add it for you, and QA never flags it
  missing or added (it notes the side only when the scene asked for it).
  Supersedes the "constant mark added for you" line in Phase 2.
- **Any camera angle.** Eye level, slightly high, over the shoulder, a
  friend shooting from rocks or a ledge and a long lens across a venue
  are offered; low and high are allowed. The planner's default is to
  avoid low angles up at her body and tight crops on the body.
- **Combo log repeats warn** with "Use anyway" (supersedes F5's refusal;
  superseded by G5: repeats are fine).
- **Outfit and footwear are optional** scene fields. Nothing from the
  sheet or the style notes is put in for you.
- **Logos:** brand-free by default; a per-scene "Brands and logos" switch
  turns off the plain-and-unbranded line and the logo check for brand
  deals and products.
- **The persona "never" list** is sent to the planner as suggestions.
- **The gray background** is the default for hero and sheet and is an
  editable value in Rules (F1 stands as the default).
- **QA is advice** with one-click fixes (supersedes F4's "always
  regenerate" for face drift). Face drift asks the owner to confirm
  before a pick ("Pick anyway"); plastic or smoothed skin stays fixed
  and is never picked. The free mirror is offered for any still.
- **Refs:** picked by angle by default; the owner can choose up to 4
  sheet shots per scene.
- **Audio is per request**: silent by default, stripped unless the
  request asked for audio. Voice and sound come later (ElevenLabs).
- **Untested models warn** on their quote instead of being refused; a
  model with no official endpoint is still refused (it cannot run).
- **Hero runs** are 1 to 8 per prompt (fewer than 4 warns), and the sheet
  can be regenerated out of order (missing inputs fall back with a
  warning).

### G4. The AI-generated label is fixed; posting is TikTok only (owner)
- **ai-label** joins the fixed rules: every post the Studio prepares and
  every ready-to-post export is labeled as AI-generated (TikTok and
  Instagram require it). The character file's disclosure line is the
  wording; the label itself cannot be switched off.
- Posting calendar (SPEC 13.1, R7): TikTok is prepare and notify through
  the owner's Higgsfield account (the owner presses publish). Instagram
  is not posted for now; the calendar exports ready-to-post files.

### G5. Repeats are fine; required fields are the minimum (owner)
- **Repeats.** "You are never going to get the same picture twice." The
  combo log stays as a history of picked scenes. The variety note (rule
  `scene-combo-log`) starts off; switched on, it is a small note and the
  planner prefers fresh pairs. Nothing is ever pressed to get past it.
- **Required fields.** Only what cannot be filled for the owner: a scene
  needs only its moment, and the owner's own words count as the moment.
  Moment type, camera and light start pre-filled (`scenes.yaml`
  `settings.defaults`) and are saved with the scene when it first runs.
- **Impossible to miss.** A REQUIRED badge and colored border until a field
  is filled, then a green check; example text starts with "e.g." and is
  light and italic; section headers show "2 of 3 required done"; a blocked
  button shows "N things left" right above it, each a link that scrolls to
  and highlights the field. Applies to every Studio form.
- **Prices never hang.** The button says "Getting price..." and, after 10
  seconds, the reason with a Retry. On the account path the estimate
  reuses Higgsfield's live price for the same request shape (6 hours),
  waits at most 6 seconds for a new one, then falls back to a saved live
  price or the price book's credit cost, marked as not confirmed and with
  the reason shown. Identical stills in one run are priced once.

### G6. Punch it up, and scenes reused across characters (owner)
- **Punch it up** (Scenes tab, next to "What is she doing?"): a quoted
  Claude call turns a rough idea into three specific moments. Each has one
  action caught mid-motion, who shoots and from where, the place, time and
  light, and one small real-life detail. A second person gets a clearly
  different hair color and cut; sunglasses keep the eyes visible (pushed
  up, in hand or lowered). The pick fills the box and stays editable.
- **Use for other characters** (scene page): copies a scene's words and
  choices to any other characters, with the name swapped. Each character's
  own sheet refs and signature pieces apply, so those are not copied. A
  copy is a free draft until it is generated. This is the first step of
  the Scene library and multi-character runs (SPEC 13.1, R3 and R4).

### G7. Video: straight to the final model, then upscale the take (owner)
- **Takes** run straight on Seedance 2.5 at 720p; there is no separate
  draft model. "Upscale this take" (Higgsfield's video upscaler on the
  owner's account, ByteDance, 1080p, 24 fps) works on a take you keep, so
  the exact take is preserved instead of re-rolled. The Generate button
  shows the take's price and, under it, what the upscale will cost per
  take. The upscaler has no price preflight, so its price comes from the
  price book, marked not confirmed until the first run.
- **Quick motion test**: Kling 3.0 Turbo, 5 s, an optional toggle that is
  off by default, labeled "faces not representative", for complex motion.
- **Defaults, all editable**: start frame plus an optional end frame, 9:16,
  audio off, the directions "No talking, no winking, steady eye contact.
  One continuous take, no cuts." in the prompt, 5 or 10 s, 1 to 4 takes.
- **End frame helper**: inpaints only the head and face of the start frame
  with Nano Banana 2.1 (media role `mask` plus `is_inpaint`, from the
  Higgsfield catalog). The mask is an ellipse over the detected head, made
  on the worker just before submit (the face models live there); REF-00 is
  attached for the face, and scene QA checks the result (mole side first).
- **Clip QA** is local and free: face match to REF-00 on a middle and a late
  frame, and skin detail against the start still (video compression
  softens skin a little, so only a clear loss is pointed out). A smoothed
  upscale is flagged and the original take stays.

### G8. Claude checks on demand; the free checks always run (owner)
- **Automatic Claude QA is off by default** for stills (scenes, edits,
  end frames, the sheet) and video takes. The owner reviews with their
  own eyes. The switch is the `scene-auto-qa` default rule (`starts_on:
  false`), so it can be turned back on for all characters or one in
  Settings, Rules.
- **The free local checks stay on**: face match against REF-00 and the
  skin texture check (sheet, scenes, edits, takes). They cost nothing.
  A still that passes them reads "Free checks passed (face match,
  skin). Not checked by Claude; look it over yourself.", never "ready".
- **"Check this"** on each still and take runs the Claude check on
  demand, with its own price on the button; a take is checked on its
  saved last frame. The QA model is Sonnet 5.5 (`routing.yaml`,
  `qa_perception`), not Opus (see G9).
- **The Generate price shows only what will run**: with the switch off
  there is no Claude line in the quote (for example "8.24 credits").

### G9. Sonnet 5.5 for every Claude call; Opus is a switch (owner)
- **Default**: every Claude task runs on Sonnet 5.5: the scene planner
  (Plan it), Punch it up, Check this, the inspiration breakdown, the
  character concepts and the card check. Code builds the image and video
  prompts from data, so no Claude call writes them.
- **Switch**: Settings, Claude models lists each Claude task with a
  Sonnet 5.5 or Opus 5.5 choice, per account (`routing_overrides`;
  `PUT /settings/claude`). The choices are data (`routing.yaml`,
  `claude_choices`); image tasks and other models are refused. Picking
  the default again removes the override.
- **Model name next to each price**: every price button shows the models
  the run uses ("Claude Sonnet 5.5", "Nano Banana 2.1"), as does the
  follow-up price line and the price details. Demo mode says "Demo mock,
  free".

### G10. The prompt writer: Claude writes the final prompt (owner)
- **Default on** (rule `scene-prompt-writer`; Settings, Claude models has
  the same switch, and Settings, Rules a per-character one). Sonnet 5.5,
  switchable to Opus like every Claude task (route `prompt_writer`).
- Claude turns the scene fields into the final prompt as natural
  sentences describing a real candid moment: 110 to 150 words for
  stills, 40 to 80 for video (`scenes.yaml`, `settings.prompt_words`).
  The video writer sees the start frame, "What happens" and the
  directions.
- The prompt sits above the Generate button, fully editable and saved as
  you type, with Rewrite (priced, with the model name), Copy, and "Use the
  template instead" (free). Generate needs a prompt in the box; a change
  to the details after writing is pointed out, never forced.
- **What code still adds** around the text, so it never depends on the
  writing: the reference line for each model (refs, saved character or
  card), the outfit swap line, the jewelry with its side, the mark sides,
  the colors and brand-free lines, and the REALISM and AVOID blocks (rule
  zero). A REALISM block typed into the box is replaced by the
  character's own, and smoothing words are stripped. Video prompts get
  the directions, the silent line when sound is off, and the REALISM
  block too.
- **Switched off**, the template builds the prompt as before. A run
  with the writer on but nothing written yet (a regenerate from the
  drawer) uses the template, with a note.
- This replaces the SPEC 9 line "prompts are never written from scratch
  by an LLM": the writer works from the fields, and the safety lines
  stay in code.

### G11. Video model picker (owner)
- Kling 3.0 Pro (default), Kling 3.0 Standard, Seedance 2.0, Seedance 2.5
  and Wan 3.0 Prime (`scenes.yaml`, `video.models`), each shown with the
  price of one take at the chosen length and shape (free estimates; on
  the account path a live Higgsfield price, saved for hours).
- The last pick is remembered per account (`video_model` setting) and is
  the next take's default.
- Wan 3.0 Prime runs on the owner's account too (`wan3_0_prime` in the
  connector's catalog, 2026-10-13). Kling's sound now follows the Sound
  switch instead of always being off.

### G12. Text-overlay content builder (owner)
- **Content** page, four tabs: Meme video, Slideshow, Batch, B-roll
  library. Reaction clips come from Clone Video later (roadmap R1), so
  there is no reactions tab; any kept clip (a take, its upscale, later a
  clone) works.
- **B-roll**: the owner's uploads (up to 200 MB a video), tagged by
  product, converted on the worker to a lean H.264 copy without sound
  (never enlarged). Landscape clips are fitted over a blurred copy of
  themselves in 9:16, so nothing on a laptop screen is cut off.
- **Meme video**: the clip, then an optional B-roll cut in hard (or
  B-roll first), never a crossfade, with the caption on top the whole
  time. 1080x1920, 30 fps, H.264, no sound, no music.
- **Caption style** (`config/content.yaml`): TikTok's white rounded box
  per line, black TikTok Sans text (open font, bundled), centered,
  balanced line lengths, inside TikTok's safe zones (top 250, bottom
  480, sides 60 and 160 px at 1080x1920). Emoji come from Noto Emoji.
  Drawn as outlines, so the worker needs no system fonts.
- **Slideshow**: picked stills in order; Claude (route `content_writer`,
  Sonnet 5.5, switchable) writes a hook plus 5 to 7 slides (one per still
  after the first, stills repeat if fewer), a caption and hashtags, all
  editable. Export: 1080x1920 JPEGs in order, plus a zip with
  `caption.txt` (caption, hashtags, the AI-label reminder).
- **Batch**: captions pasted (one per line) or written by Claude from a
  topic (up to 20), one clip and B-roll for all, one video per caption.
  Each video is its own short worker job, so other work runs in between;
  the last one bundles a zip with `captions.txt`.
- **Money**: rendering is local and free; only Claude's writing is
  priced (quote first, model name shown). Every export reminds the owner
  to turn on TikTok's AI-generated label (fixed rule `ai-label`).
- **Downloads**: videos and zips come straight from R2 through a
  short-lived link (a function response is capped at 4.5 MB on Vercel).
- Posts (`content_items`) keep their parts as data (clip, B-roll and its
  in and out points, caption text), not baked in, so Phase 4 can open
  the same post in OpenCut with editable layers (G13).

### G13. Phase 4: OpenCut embedded in the Studio (owner, planned)
- One app, one login. The post screen has **Export** (renders straight
  to MP4; most posts) and **Fine-tune** (OpenCut opens as a page inside
  the Studio, the project preloaded from R2: clips, B-roll, captions as
  editable text layers). **Done** saves the final MP4 back to the post
  and the vault and returns to the Studio. No downloads, no re-uploads,
  no second login, no folders.
- Built in Phase 4, not now. The content builder already stores each
  post's parts separately for this.
- OpenCut's license notice stays in the app.
- ai-influencer (the upstream this Studio grew from) has no license
  file; the owner is getting written permission from its author
  (SPEC 2).


### G14. Worker light (owner)
- The header shows the worker's state: green "Worker ready" with the
  code version, yellow "Worker restarting" after a push, red "Worker
  down". It is read from the database (`worker_status`), never by
  calling the worker, so an open tab does not keep it awake.
- The code version is a hash of the files the worker is built from
  (`server/lib/codeVersion.ts`). The API and the worker compute it the
  same way, so a mismatch means the worker deploy is still rolling out.
- While the light is not green, every button that starts work is held,
  with the reason shown, instead of leaving jobs at "Preparing...".

### G15. UX plan approved (owner)
- `UX-PLAN.md` is the layout: Posts home, one workspace per post with a
  stepper, drawers for the Library and characters, Settings tabs for
  Usage and Rules. Every new feature fits it or updates it first.
- Picking a take keeps it. "Write and generate" and the auto-written
  video prompt (when a still is used) are in, both priced first.
- The mole above the left brow is the only fixed mark; the ear cuff is
  jewelry, a default like any outfit choice.
- Batch rotates several clips and B-roll clips across its captions.
- Every post has "Make another like this" and an account tag.
- Built: Posts home with account and character filters; the post
  workspace (steps fold into a line when done; the current one and those
  after it stay open, so no Next clicks); the Library page and drawer;
  Settings tabs; character setup as a stepper. A post's scene is made from
  its idea; "Use this still" also writes the video prompt (priced on the
  button); "Use this take" keeps and picks it. Uploaded videos become kept
  clips. Old addresses redirect.
- Importing a character file: jewelry listed with the marks becomes a
  style idea, with a note; marks are skin features.

### G16. Presets declined on the account path (owner)
- Higgsfield's account tools can answer a generate_* request with a
  recommended preset instead of a job (seen live on a Kling 3.0 Pro take:
  "Preset IN THE DARK was recommended instead of submitting a job", 0
  submitted). The adapter declines it: it resubmits the same request once
  with params.declined_preset_id set to that preset. The Studio never uses
  a recommended preset. A second recommendation fails plainly, with
  nothing charged.
- use_unlim: false is sent on every generate_* call on the account path.

### G17. Feedback everywhere (owner)
- Every button that starts work switches to "Submitting..." at once and
  cannot be pressed twice. Its runs show live under it from the runner's
  real state (Queued at the provider, Generating with the elapsed and the
  usual time, Downloading, Checking, Done). The usual time is the
  account's own median for the model, else a typical time per kind
  (runtime.yaml typical_sec).
- Done results get a short highlight, and a toast with Show when the step
  is out of view. A failure says what happened in plain words, whether
  anything was charged, offers a priced Retry, and keeps the provider's
  message under Details. Activity shows the same rows.

### G18. Clone Video in the Video step (owner; SPEC 13.1 R1)
- "Clone a TikTok or Reel" is the Video step's second way (UX-PLAN.md),
  also in a batch's Clips step, and "Video post from a TikTok" in the New
  post menu opens it directly. The owner chooses the saved file (no
  scrapers); the worker keeps a lean copy with its sound, cut to 30 s; a
  clip under 3 s is refused.
- One run clones for the post's character and any others picked (up to
  5): one quote with a line per character. Each result is a kept clip of
  its character in Library > Clips (op `clone`). "Use this clip" puts the
  post's own one in the post; another character's opens as a new video
  post at the Caption step ("Make a video post").
- Models (official Model API Reference, read 2026-10-13): Kling 3.0 Motion
  Control on the owner's plan (the motion_control tool; the place from the
  clip or the image), Kling 3.0 Motion Control Pro and Standard and
  Genjutsu motion transfer (the place from the character image),
  Seedance 2.5 video edit and Kling O3 video edit (the clip's place, the
  person swapped by prompt). Defaults keep the clip's place, so REF-00
  alone makes a full scene: Kling 3.0 Motion Control on the plan,
  Seedance 2.5 video edit on the API. The last pick is remembered.
  Prices are placeholders, set high and shown as not confirmed, until a
  run shows them; a real clone that finishes on the API also counts as
  the model's one paid test.
- The provider never keeps the source's sound. "Original sound" (off by
  default) puts it back on the worker, free; the post's MP4 keeps a
  clip's sound, with silence under B-roll. Every other clip stays silent.
- Free checks on every clone: the face against REF-00 (face drift is a
  strong warning; "Use this clip" asks first), the skin against REF-00,
  and that the result is not the person in the source clip at the same
  moments. A copy of the performer breaks a fixed rule (a new person,
  never a copy), so it is not kept and cannot be used.
- Prompts (the models that take one) carry the character's REALISM
  block and say the result must be the character, never the performer.


### G19. The new default REALISM block (owner, 2026-10-13)
- Every character without its own block uses the owner's tested text
  (Nano Banana 2.1 and GPT Image 2.5 Flare, clearly more realistic than the
  old block): "Candid iPhone photo, neutral natural light. Real skin
  texture: visible pores, soft peach fuzz catching the light on the cheeks
  and jaw, a few stray brow hairs and baby hairs at the hairline, subtle
  color variation with slight redness around the nose and cheeks, faint
  natural shine. No makeup or light makeup only, no beauty retouching, no
  beauty filter, no skin smoothing. Ordinary background, not a
  professional shoot."
- Hero and sheet stay bare-faced (fixed): there the block reads "No
  makeup" (the light-makeup allowance is left out) and loses its
  background sentence (the gray background). Clauses are edited one at a
  time, so "no skin smoothing" is never dropped with a neighbor.
- A scene's makeup choice (a default) wins over the block's makeup line:
  soft glam leaves out "No makeup or light makeup only", bare leaves out
  the allowance. Nothing else in the block changes.
- Callie's new character file carries the same block (with "her cheeks")
  and new model, video and safety-filter notes; it is the fixture now. In
  production it reaches Callie when the owner imports it on her Character
  file step.

### G20. The prompt writer follows the ultra-realism guide; the director's pass (owner, 2026-10-13)
- The owner's cyberjungle-ultra-realism guide is guidance for the Claude
  prompt writer, not a feature. Still prompts name who takes the photo
  (front or rear camera, position, distance), an ordinary task, one small
  trigger and the reaction the photo catches, a named light source and its
  direction, one cause-and-effect camera imperfection, hand and prop
  contact, and a short exclusion list for the scene. One paragraph.
- Video prompts use the guide's labeled lines: FORMAT, SUBJECT,
  SETTING/LIGHT, CAMERA, ACTION (task, trigger, small reaction, back to the
  task), CONTINUITY, AUDIO, CONSTRAINTS, one per line. The Studio writes
  FORMAT (9:16 by default, the take's length) and AUDIO (sound off unless
  turned on) itself, over whatever the writer put there. SUBJECT and
  SETTING point at the start frame instead of describing it again. The
  directions, the silent line and the REALISM block follow on their own
  lines. Word ranges: stills 120 to 170, video 110 to 180.
- The director's pass (default rule scene-directors-pass, on): before
  writing, the writer decides the moment the viewer remembers, the hook in
  the first second, the payoff in the last 2 seconds (video), one camera
  move (video), depth, motivated light and one contrast, and returns them
  as a short "Director's notes" line shown above the prompt. The owner can
  edit the notes; Rewrite (and Write and generate) then follow them as
  given. Switched off, there are no notes.
- Framing-aware REALISM (scenes.yaml framings, `skin`): close and chest-up
  keep the full skin detail; waist-up and knees-up say "natural skin
  texture"; full-body and wide name no skin detail. "No beauty smoothing"
  and "no retouching" are always there, added when a block lacks them.
  Scenes, edits, video takes and sheet shots (REF-06 to REF-08 are
  full-body) all follow it.
- Planner fields (defaults, all optional): the character's task and what
  catches their attention, with the moment; the camera distance and the
  front or rear camera, with the camera. The planner fills them; the
  template and the writer use them.
- "Fix one thing" gets the guide's Diagnose and revise rows that a still
  edit can fix (plastic face, staged performance, hands or objects morph,
  background synchronized, low light synthetic, overprocessed). The full
  table sits under the video prompt as "If a take looks off".

### G21. The Guide: a visual manual inside the Studio (owner, 2026-10-13)

The owner found the Studio confusing and asked for a colorful Quick start
and a visual manual, stored in the tool so each section opens where it is
used.

- `/studio/guide` (sidebar, under Settings): a Quick start in 7 steps, the
  big picture (Characters, Posts, Library), one section per page and post
  step, and a glossary. Each section says what the part is for, where it
  is, what to do, tips, and what costs money.
- Screenshots are of the real screens in demo mode (free mock results, no
  paid call), stored as WebP in `public/studio-guide/`. Numbered hotspots
  are percentages in `src/studio/guide/shots.json`, so they scale with the
  image; hovering a number outlines that part and names it.
- The text is data (`src/studio/guide/content.ts`), not page code, so a
  change in the Studio is a change in one file.
- "How this works" (UX-PLAN.md pattern 12): a small colored button in the
  header of every page, character setup step and post step, plus the clone
  panel and Activity. It opens that section in a drawer, with "Open the
  full guide".
- Posts home shows a Quick start banner until it is closed. Closing is
  remembered in that browser only; if the browser blocks storage, the
  banner just shows again.

### G22. Phase 3 finish: chaining, sound bed, rough cut (evening build, 2026-10-14)

The owner asked for the rest of Phase 3 while away, with sensible calls
logged here. Everything fits the post workspace (UX-PLAN.md section 8): no
new pages or sidebar items; one new Library tab (Sounds).

- **Chaining is "Continue this shot"** under the Video step's clip. The
  clip's last frame is extracted at full resolution and stepped back about
  half a second when blurry (SPEC 5.4 rule 33, existing `extractLastFrame`),
  then saved as a still of the post's scene (op `last_frame`). The next
  take starts there, on the model the clip was made with (takes now record
  it in `candidates.meta.model`; `GenRequest.modelRef` carries the pick and
  is never sent to a provider), with a continuity line in its prompt ("same
  place, same light from the same direction, same wardrobe and hair, same
  camera position"; `templates.yaml` video.continue) and in the prompt
  writer's facts (with the previous take's prompt). Use this take joins the
  two on the worker (free): both normalized to the first clip's size and
  frame rate, the handoff frame dropped, the seam scored by the existing
  `joinClips` (cut, camera motion, or color match; never a crossfade).
  The result is one clip (op `chain`, its parts and seam scores in
  `candidates.meta`), kept in Library > Clips and picked for the post.
  Defaults, all in `content.yaml` chain: 4 takes, 40 s, step back 0.5 s,
  seam limit 0.18.
- **A failed seam is never exported** (SPEC 4.3). The owner can make
  another take, or "Keep them as two shots": the rough cut gets both clips
  with a real cut between them. A cut between two shots is an edit, not a
  seam, so this keeps the never-crossfade rule. Call made tonight.
- **Sound bed** (SPEC 5.5): ambience (built-in Room tone, None, or an
  uploaded recording) plus an optional uploaded music track, levels
  Quiet/Normal/Loud, music ducked under the clip's own sound (sidechain
  compressor), then a two-pass loudness normalization: -14 LUFS integrated
  and -1 dBTP when there is music or clip sound (TikTok, Reels and Shorts
  all play around -14), and -28 LUFS when there is only ambience, so a
  room never gets pushed up to soundtrack level. Every layer is leveled
  from its measured loudness. No AI music anywhere, and nothing offers it.
- **Room tone is the default ambience for every post** (config
  `sound.default_ambience`, switchable to none). A silent phone video
  sounds dead; Room tone is quiet brown noise kept under 450 Hz, made by
  code, deterministic. It is synthetic, so real recordings are better: the
  owner can upload them in Library > Sounds. Call made tonight; it changes
  exports that used to be silent (they now carry a faint room). Set
  ambience to None for the old behaviour.
- **Uploaded sounds** live in a new `sounds` table (migration 0010):
  AAC 48 kHz stereo, at most 10 minutes, measured on arrival. An .m4a keeps
  its audio type when stored (it used to sniff as video/mp4).
- **Rough cut** in the Finish step: the post's shots (clips and B-roll,
  each trimmed) and captions (each timed) as one timeline, with a Sound
  lane. Built automatically from the steps (the clip, its B-roll before or
  after, the caption over the whole video) until the owner edits it; then
  the owner's cut is kept (`spec.cut`, `auto: false`) and Rebuild returns
  to the automatic one. A caption with no text of its own shows the
  Caption step's text, so editing the caption still works on an edited
  cut. Export renders exactly the cut (`server/media/timeline.ts`: hard
  cuts, captions by time, then the sound bed). Limits: 90 s, 12 shots, 8
  captions. Batches render through the same path (one automatic cut per
  caption, with the batch's sound bed).
- Click counts: the video-post flow stays at 8; each extra chained shot
  is 3 more (Continue, Generate a take, Use this take), measured in the
  browser in demo mode.

### G23. Phase 4: Fine-tune over the workspace; the OpenCut engine waits; batch at scale (evening build, 2026-10-14)

- **Fine-tune ships** as planned in UX-PLAN.md (section 9): the Finish
  step's Fine-tune opens `/studio/posts/:id/edit`, full screen over the
  same workspace (the post page stays mounted under it). The rough cut
  opens as layers: Video (clips and B-roll), Text (captions), Sound
  (ambience and music). The preview plays the cut with captions in
  TikTok's box and the music, streamed from storage (same origin, same
  login, nothing downloaded). Split at the playhead, trim by the edges,
  drag to move, delete, duplicate, retime and rewrite captions, sound
  levels, undo and redo (a drag is one step). Done saves the cut and the
  sound to the post, renders the MP4 on the worker (free, the same
  renderer as Export) and returns to the Finish step, where the render
  shows live; the MP4 is the post's export, so it is in Library > Posts.
  Cancel leaves the post as it was.
- **The editor inside is the Studio's own, not OpenCut, for now.** Call
  made tonight, and the first thing for the owner to decide. What was
  checked:
  - OpenCut's main repository is being rewritten from the ground up
    (pre-release; it lives at new.opencut.app). Its README promises an
    Editor API, plugins and a headless mode, which are exactly what an
    embed needs, and they are not out yet.
  - The usable version, opencut-classic, is a Next.js 16 server app
    (auth, a database, a Cloudflare deploy), about 685 source files, with
    no embedding or import API. Its dependencies install cleanly here
    (bun, 974 packages), but its current main fails its own TypeScript
    check (`isShortcutKey` is not exported), so it does not build as is.
  - Embedding it would mean keeping a fork, a second deployment (or a
    large static build committed into this repository) and a bridge into
    its internal stores, unattended and untested in a real browser.
  - So the Fine-tune editor follows OpenCut's project layout instead (one
    main video track, text tracks over it, audio tracks under it, times
    in ticks of 1/120000 s): `server/core/opencut.ts` turns a post into
    an OpenCut project, and `GET /content/:id/editor` returns it with
    every media file's streaming URL. When the owner picks a route
    (embed a classic fork in an iframe at /editor, wait for the
    rewrite's Editor API, or keep the Studio editor), the data is ready.
- **OpenCut's MIT license** is in Settings > Notices, verbatim, with a
  line in the notices table.
- **Batch at scale:** up to 50 videos (was 20). Each video is its own
  short job and owns one slot of the post's outputs: a job that runs again
  (a crash, a deploy overlap) overwrites its own slot instead of counting
  twice, results merge under a row lock (`SELECT ... FOR UPDATE`), and a
  failed video keeps its reason by index. "Retry the failed ones"
  re-renders only those. The download is a zip in parts of at most 150 MB
  (`batch.zip_part_mb`), so the worker never holds all the videos in
  memory at once. The runner now renews each claimed job's lock right
  before it runs (compare and set), so a job whose lock lapsed while it
  waited behind others is skipped if another worker took it; a render
  never runs twice at once. Tested with 25 rotated videos.

### G16a. Presets declined, also when Higgsfield flags them as errors (owner report, 2026-10-14)

- Live Kling 3.0 Pro takes still failed with "Preset IN THE DARK was
  recommended instead of submitting a job". Higgsfield now sends that
  answer as a tool error (isError), so the MCP client threw before the
  decline in G16 could run. The client now keeps the error's body, and the
  account adapter reads a preset recommendation out of it like a normal
  answer: nothing was created, so it declines that exact preset
  (`declined_preset_id`, which Higgsfield's tool schema says suppresses
  that preset for the retry) and submits the same request again.
- When Higgsfield recommends a different preset each time, the adapter
  declines up to two more (three submits in all), then fails plainly with
  nothing run and nothing charged. Any other tool error fails as before.
- The test double now answers a recommendation as a tool error, like the
  live service; the normal-answer shape is still covered.


### G24. Phase 5: Amazing Edits, ten edits made by code (evening build, 2026-10-14)

- **One field, four places.** A post's edit is `spec.edit` (style,
  strength, payoff, pop text), default none. The Idea step's Format, the
  Finish step's Edit style and Fine-tune's Edit lane all set that same
  field (UX-PLAN.md section 10). No page, drawer or sidebar item was
  added. The edits are data in `config/edits.yaml`: names, one-line
  descriptions, one or two shots, where each lands, the directions a
  two-shot edit adds to its takes, and the numbers behind Subtle, Normal
  and Strong. Every edit is a default the owner picks; none is applied on
  its own.
- **Made by code, never by a video model.** `server/media/edits.ts` runs
  each edit as one ffmpeg pass on the worker (split, trim and concat in a
  single filter graph), with filters that ffmpeg 5.1 on the worker image
  has. Free, like the export.
- **Render order:** the clean picture (the rough cut without captions),
  then the edit, then the captions moved with the edit's time map (a speed
  ramp or a freeze makes the video longer; the captions after it move
  too), then the sound bed. Captions are never zoomed or blurred, and
  loudness is measured on the final length.
- **The ten edits (Normal numbers; Subtle and Strong in the yaml):**
  crash zoom cut (the last 0.6 s of shot A zooms to 3x on her face, eased
  in, with motion blur inside the shot, then a hard cut to shot B); speed
  ramp (0.2 s ramp into 0.4x for 1 s at the payoff, frames blended, the
  clip's own sound slowed with it); punch-in on the beat (instant 1.14x
  zooms held between alternate beats of the uploaded music, found by onset
  detection, else every second); freeze and caption pop (the payoff frame
  holds 1.1 s while the pop text, or the caption, springs in the middle
  over 5 frames); flash and impact shake (a 0.14 s white flash and a shake
  that dies out over 0.4 s, on the first cut or where the owner placed
  it); seamless loop (ends on the frame most like the first, searched
  after 60% of the video); word-by-word pop (the caption builds one word at
  a time, each new word popping for 2 frames); whip pan (both sides slide
  under a directional blur that peaks at the cut, a hard cut inside the
  blur); hand over the lens (cuts from shot A's first dark frame to shot
  B's last one; with no dark frame, a 0.2 s dip to black on each side, a
  dip and never a blend); zoom-out reveal (from 2.4x on her face to the
  full frame in 1.2 s).
- **"Never crossfade a seam" holds.** Every cut stays a hard cut. Frame
  blending (motion blur) happens only inside one shot.
- **Her face** for the zooms comes from the free face matcher on the frame
  where the zoom starts; without a face it centers at 50% across, 38% down.
- **Speed ramp blends frames by default.** Motion-compensated frames are
  smoother but took 82 s on a 3 s test clip against 11 s for blending;
  `smooth: 1` in the yaml turns them on.
- **Shot B** (`spec.clipB`) sits right after the clip in the automatic
  cut. The Video step shows it only for a two-shot edit: make it from a
  still (the take's prompt gets the shot B direction), pick it from the
  Library, or upload it straight into the slot. Shot A's takes get the
  shot A direction. **Make the close-up** (crash zoom) is a free crop of
  shot A's last frame, 42% of the frame's height in 9:16 around her face;
  it becomes a still of the post's scene and shot B's start frame, and the
  priced Upscale 2x and Generate a take follow as usual.
- **Payoff:** where a speed ramp, freeze or flash lands, 2 s before the end
  until moved (`payoff_from_end`). Fine-tune's Edit lane shows where the
  edit acts (striped) and a marker; the payoff marker drags, with undo.
  Flash and shake hits the first cut unless the owner placed it.
- **Batches** take the one-shot edits only (each video has one clip); the
  edit runs on every video.
- **Fine-tune's preview** plays the plain cut with a badge while the
  playhead is inside the edit; the export renders the edit. A live
  in-browser preview of each edit is in LATER.md.
- **Thumbnails** are rendered by the real edit code on two drawn demo
  shots (`scripts/edit-thumbs.ts`): animated WebP, 144x256, 12 fps, about
  420 KB for all ten, in `public/studio-edits/`. Drawn figures rather than
  a character, so no paid run was needed and no character's face sits on
  a UI tile. Run the script again after an edit changes.
- No paid run was made. The live checks this phase needs are queued for
  the owner's approval (the evening report lists them).

### G25. Overnight run decisions (owner, 2026-10-14)

- **OpenCut, decided:** the Studio keeps its own Fine-tune editor. The
  post is still kept as an OpenCut project (`server/core/opencut.ts`,
  `GET /content/:id/editor`), so their engine can drop in if it ships. No
  time goes into the classic OpenCut build. G23's open question is closed.
- **The approved paid tests did not run tonight.** The owner approved tests
  1 to 6 under a 150-credit cap. They test the Studio itself (its stored
  start frame, its adapter, its chain, close-up, clone and upscale steps),
  so they have to run inside the production Studio. This build session
  cannot reach it: the Studio's domain, R2 and Higgsfield's CDN are
  blocked by the network policy of the container it runs in, and its keys
  stay server-side (fixed rule). A worker-side run started from the
  database was considered and dropped: the session's safety check treats a
  paid run started that way, without the owner's click, as an autonomous
  transaction. Running the Higgsfield tools directly from the session would
  not test the Studio, so that was not done either. Nothing was spent.
  The tests wait for the owner (the report lists the clicks), at the same
  cap.
- **Batch progress on Posts home:** a batch's card reads "12 of 50 done"
  (failures counted apart) with a thin bar while it renders; the card
  refreshes every 2 seconds while anything renders.
