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

### G26. Edit pack 2: ten more edits, her outline, caption styles (overnight run, 2026-10-14)

- **Ten more edits, same four places** (Idea Format, Video step shot slots,
  Finish Edit style, Fine-tune Edit lane), each with Subtle, Normal and
  Strong, a moving thumbnail and one line, all made by code on the worker:
  velocity edit (fast, slow on the beat, fast; the music's beat or a
  steady grid), text behind subject, karaoke captions, split screen or
  duet (stacked or side by side), green-screen reaction, glitch hit (RGB
  split, sideways jumps, noise; every frame is still one picture), zoom-
  rotate spin (the zoom always covers the corners, so no black shows; a
  hard cut inside the blur), dolly zoom, record-scratch freeze, snap zoom.
- **Her outline (the person mask):** PP-HumanSeg from the OpenCV Zoo
  (Apache-2.0, 6 MB), fetched by `npm run models` with the face models and
  run on onnxruntime-web in the worker, free. Frames go through at
  192x192, the soft mask is smoothed over time so the edge does not
  flicker, then scaled and feathered. RVM (better on video) was left out:
  it is GPL-3.0. Only the worker checks for the model; the API on Vercel
  does not have it and never blocks on it.
- **Text behind subject** lays big plain words between the room and her
  (her outline goes back on top). **Green screen** puts her, cut out, at
  the bottom over the post's B-roll; B-roll now takes a screenshot image
  too (it becomes an 8-second still clip), and the green screen uses the
  B-roll as its background instead of cutting to it. **Dolly zoom** keeps
  her the same size while the room pushes in; the room behind her is
  filled with a blur of itself first, so the bigger room never shows a
  second copy of her (a soft halo can show on high-contrast hair; a better
  fill is in LATER.md).
- **The record scratch is made by code** (a pitch sweep and vinyl noise,
  half a second); edits can now ask the sound bed for accents, mixed in at
  their time before the loudness pass, so the scratch is heard even when
  the post has no other sound. No sample, no AI.
- **Caption styles:** TikTok's white box (default) or Outline (white text,
  black stroke, TikTok Classic), per post, in the Caption step; the
  default position is now the upper third (owner), so captions stay off
  her mouth and hands. The freeze pop and the record-scratch line also
  sit in the upper third, and the other captions step aside during the
  freeze. Karaoke lights each word with a yellow pill (or the word's
  color at Subtle), timed by word length, or by a voice line's own word
  times when there are some.
- **Stacking groundwork:** every edit now has a stage (layout, transition,
  camera, hit, time, loop, text) in the yaml, the order stacked edits run
  in (item 2).

### G27. Every input made plain before a render; worker errors say "our side" (owner bug report, 2026-10-14)

- **The bug:** a video post whose clip was a clone (712x1294, with the
  source's sound put back) failed on the worker with "Error reinitializing
  filters! Failed to inject frame into filter network: Invalid argument,
  stream #1:0", with and without an edit. No video post had rendered in
  production before it. The worker runs Debian's ffmpeg 5.1, which is
  stricter than the 6.1 used in development: when one input of a graph
  that joins several inputs has unusual properties, the graph can fail to
  start. Synthetic odd sizes, mid-stream size and sound changes, variable
  frame rates and rotated files all rendered on 5.1 here, so the exact
  property of that clone file is not known; the fix does not depend on it.
- **The fix (owner's):** every shot (clips and B-roll) first goes through
  its own one-input pass: the canvas size (1080x1920) with the renderer's
  own fit, square pixels, a constant frame rate, yuv420p, and the sound as
  48 kHz stereo AAC padded to the picture, or none. A one-input chain can
  rebuild itself when a file changes mid-stream, so the multi-input render
  only ever sees plain files. A sound track that cannot be read is left
  out rather than stopping the picture.
- **Cached per clip:** the plain copy is saved as an asset on the clip's
  first render and reused (keyed by version, canvas, with or without sound,
  and the source asset), instead of being made at upload, so clips that
  are never rendered cost no worker time.
- **Tests:** odd sizes (712x1294 and 711x1293), full-range color, a size
  and sound-layout change mid-stream, a variable frame rate, a TikTok-style
  download (rotation, a cover image stream, 44.1 kHz stereo), and all of
  them cut together with a caption, run on ffmpeg 6.1 and on 5.1 (the
  worker's version).
- **Error copy:** work the worker does itself never says "The provider
  reported a failure." A technical failure there reads "The render failed
  on our side. Nothing was charged." with Retry, and the ffmpeg message
  stays under Details. The Studio's own plain messages ("Add shot B ...")
  are shown as they are.

### G28. Clone: replace the person and keep the scene (owner bug report, 2026-10-14)

- **What went wrong:** a rave TikTok cloned with Genjutsu motion transfer
  came back in a gray studio, in a white tee and jeans, and a dancer in the
  background became a second Callie. The run sent seven sheet images (REF-00
  plus every face shot) as the character images. A motion model copies the
  moves onto the image it gets, so it took the sheet's gray background and
  plain clothes as the scene, and with several people moving it put her
  face on more than one of them.
- **Lesson:** never feed a motion model a bare sheet image, and never send
  more of the sheet than the face needs. Sheet images are for identity; the
  scene must come from the clip or from a still made for that scene.
- **Two modes, "Replace the person (keep the scene)" the default:**
  - Replace swaps only the picked person and keeps the clip's place,
    light, crowd and outfit. It runs Genjutsu replace
    (`hf_mult_replace_object`) on the owner's Higgsfield plan, with the
    clip as the one video (`video_references`) and REF-00 plus the first
    approved three-quarter view as images (`image_references`). On the API
    it runs Seedance 2.5 video edit (Kling O3 video edit is also offered).
    Not motion control.
  - "Copy the moves into a new scene" (motion control) first makes a scene
    still: the clip's first frame edited (Nano Banana 2.1 on the plan, GPT
    Image 2.5 on the API) to put the character in place of the picked
    person, keeping everything else. The still is shown with its free
    checks; the first good one is kept, "Use this still" picks another.
    The motion run gets only that still. Without one it is refused, with
    the way forward.
- **Only the main subject changes:** the worker finds the faces on the
  first frame at ingest (largest first). The largest is replaced unless the
  owner taps another on the frame; with more than one person and no tap the
  quote says so. Models take no boxes, so the pick goes into the prompt in
  words ("the person on the left side of the frame, further back"), and
  every prompt says everyone else stays exactly as they are. A new tap drops
  kept scene stills, since they show the old pick. Clips prepared before
  this get their first frame when the panel opens (free, on the worker).
- **Outfit:** the clip's outfit by default; "your character's outfit from
  this post's still" adds that still as the last image. With no still the
  clip's outfit stays, with a note (a default, never a block).
- **Preview before the paid run:** "What runs" shows the first frame with
  the person ringed and the two face images (Replace), or the scene still
  (Copy the moves), above the price.
- **Price:** Genjutsu replace cannot be priced before its clip is uploaded
  (Higgsfield answers 422 without one, checked 2026-10-14 with a free price
  call), so its quote comes from the price book (3 credits a second at
  720p, a placeholder marked not confirmed) until the first run shows the
  charge. The last pick is remembered per mode, so the old motion pick no
  longer becomes the default.
- **Tests:** the rave case (two dancers: only the main one changes, REF-00
  and REF-01 only, the clip as the video, the scene and outfit kept; a tap
  on the dancer in the back; a motion model refused under Replace; the
  motion run refused without a scene still, then given only the still),
  the outfit choice, and the account adapter's media roles.
- **Re-run of the rave clip:** a paid run, so it waits for the owner's
  click in Replace mode (counts toward the 150-credit cap).

### G29. The editor is the owner's OpenReel fork, on one timeline (owner, 2026-10-14)

- **Why:** an edit like a crash zoom must be placed on a timeline where the
  owner chooses the spot, sees it, drags it and trims it. A whole-video
  "give me a crash cut" button guesses and can wreck a video. OpenReel
  (MIT, React and TypeScript, multi-track timeline, keyframes with easing,
  text with animations and karaoke, transitions, effects, chroma key,
  WebCodecs export) replaces Fine-tune, the rough cut panel and the Finish
  step's Edit style. Items 1 and 2 of the overnight list are built here,
  on the timeline.
- **Spike (time-boxed to 3 hours, took about 40 minutes): PASS.**
  1. Builds: the fork's web app builds in about 40 s to 59 MB of static
     files (89 MB with ffmpeg.wasm).
  2. Embedded: served by the Studio at `/editor/` on its own origin, with
     `Cross-Origin-Opener-Policy: same-origin` and
     `Cross-Origin-Embedder-Policy: require-corp` (the export needs an
     isolated page). Opened as `/editor/?studio=<post>`: no welcome
     screen, tour or recovery dialog; a Studio bar on top (Back to the
     post, status, Done).
  3. Loads a post from storage: `GET /api/v1/content/<id>/editor` gives
     the post's shots in order, its captions, the canvas and the saved
     project; media come through the Studio's asset route (in production
     a short-lived R2 link, which R2's CORS rule already allows for GET).
     A test post opened with its shot and caption on the timeline in 5 s.
  4. Saves back: Done exports in the browser, uploads through the
     Studio's upload slots, and `POST /api/v1/content/<id>/editor` keeps
     the project (JSON in R2) and queues a free worker job that makes the
     export the post's video. Verified end to end.
- **Export format:** MP4 with H.264 and AAC where the browser can encode
  them (Chrome, Edge); WebM with VP9 otherwise. The worker passes every
  export through the same plain-input pass as renders (G27: 1080x1920,
  30 fps, H.264, 48 kHz AAC), so the post never depends on the browser's
  encoder. The test container's Chromium has neither H.264 nor AAC, so
  the end-to-end check fed the editor a VP9 copy of the clip (test only);
  the owner's Chrome reads the Studio's MP4 directly.
- **Fork layout:** branch `studio-embed` on ericon10/openreel-video, with
  upstream (Augani/openreel-video) kept as a remote. Everything added lives
  in `apps/web/src/studio/`; upstream files get three one-line hooks,
  listed in the fork's `STUDIO.md` (main entry, recovery dialog, the
  ffmpeg.wasm base URL). The Studio pins a commit in
  `editor/openreel.json`; `scripts/build-editor.mjs` clones that commit,
  installs with the fork's pnpm, builds its small AssemblyScript helpers
  (FFT, WAV, beat detection), builds the app under `/editor/` and serves
  ffmpeg.wasm next to it, so the isolated page never needs a CDN. The
  Vercel build runs it (`npm run build`).
- **License check:** OpenReel is MIT (Copyright (c) 2024-2026 Augustus Otu
  and Contributors); its notice and full text are in Settings, Notices.
  Of the 781 packages in the web app's install, 765 are MIT, Apache-2.0,
  BSD, ISC or similar. Not MIT/Apache/BSD:
  - `mediabunny` 1.25.3: MPL-2.0 (file-level copyleft; used unmodified,
    named in Notices).
  - `gsap` 3.14.2 and `@gsap/react` 2.1.2: GSAP's standard "no charge"
    license (free to use, including commercially; not open source).
  - `@paper-design/shaders` and `-react` 0.0.76: PolyForm Shield 1.0.0
    (not open source; forbids competing with the licensor). Used only by
    OpenReel's motion-graphics shaders; the Studio does not need them and
    they can be dropped from the fork if that matters.
  - `posthog-js`: its own permissive license; analytics only run when
    OpenReel's PostHog keys are set, and the Studio build sets none.
  - `@img/sharp-libvips` (LGPL-3.0) and `caniuse-lite` (CC-BY-4.0):
    build tools only, not shipped to the browser.
  - `@ffmpeg/core` says MIT, but the FFmpeg build inside carries LGPL and
    GPL terms; it is only the editor's fallback for files the browser
    cannot read, and is named in Notices.
- **What changes in the Studio:** the Finish step's rough cut panel, Edit
  style row and Fine-tune are gone. The Timeline card shows what the
  Studio laid out and opens the editor; Back and Done return to the
  Finish step where the owner left it (`?step=finish`). The old Fine-tune
  address opens the editor. On a phone the Finish step offers the preview,
  Trim start and end, and Export. A post edited in the editor exports from
  the editor (Done) until the worker renders timelines itself (phase D).

### G30. Editor phase B: presets on the timeline (overnight run, 2026-10-14)

- **What shipped:** the editor's Presets tab (the default tab in the
  Studio) holds 28 presets in five groups, each a card with a moving
  thumbnail and one line:
  - Transitions (land on the nearest cut): crash zoom, whip pan,
    zoom-through, spin, glitch/RGB split, flash cut, hand over the lens,
    match cut.
  - Moments (at the playhead): speed ramp, velocity, snap zoom, punch-in,
    impact shake, freeze and text pop, record scratch, dolly zoom, slow
    push in, slow pull out, rewind.
  - Text (on the caption): karaoke, word-by-word pop, caption slam, text
    behind her.
  - Caption looks: white box, outline; both put the caption in the upper
    third (26 percent down), clear of TikTok's buttons and its own caption.
  - Layouts: split screen, picture in picture, green-screen reaction.
- **How each kind maps onto OpenReel:**
  - Camera presets are adjustment-layer blocks on a "Presets" track. Each
    block carries its keyframes (time 0 to 1 across the block, so a trim
    stretches the move) for zoom, move, rotate, blur, streak, RGB split,
    shake, flash, dark, colour, brightness and vignette, with an easing per
    key. Subtle, Normal and Strong scale the distance from as-shot (0.55,
    1, 1.6), never the as-shot frame itself. The math (`cameraAt`) is pure
    and unit tested in the fork; the worker will mirror it (phase D).
  - Time presets use OpenReel's speed engine: ramps as speed keyframes,
    freeze as a held frame, rewind as a reversed split with an RGB hit.
    The record scratch adds a short desaturated freeze and a scratch sound
    made in code (`public/studio-sfx/record-scratch.mp3`, no stock audio).
  - Text presets use OpenReel's own text animations, behind-subject text
    and karaoke subtitles. Layouts use clip transforms and crops; the green
    screen moves her to an Overlay track with the person cutout on.
- **A block is editable like any clip:** drag to move, drag an edge to trim
  (snapping to cuts, beats, markers, the playhead and zero; a transition
  snaps by its centre, the cut), each gesture one undo step. Clicking it
  opens its panel: Subtle/Normal/Strong, start and length, the keyframe
  table (add a key at the playhead, remove one, Reset), Delete. Delete or
  Backspace removes the selected block.
- **Suggested spots:** the manifest sends the payoff (the post's own, else
  2 s before the end) as a spot. It shows as a marker on the timeline and
  as a button in the Presets tab; one click moves the playhead there, a
  second click places the preset. Nothing is placed without a click.
- **Format as a template:** each edit style in `config/edits.yaml` names
  its editor preset (`preset:`). A post whose Idea step Format is set gets
  that preset placed once, at the payoff, the first time the editor opens
  (no saved timeline yet). Seamless loop has no preset yet (null).
- **Track order (a fix found in the export check):** OpenReel paints the
  top track last. The Studio's caption track was being added under the
  video, so the caption was hidden in the preview and the export. Now the
  order is captions, Presets, footage, audio, and a preset moves only the
  tracks below its own track, so the caption stays still and readable over
  a zoom. Saved timelines from phase A are reordered when they open.
- **OpenReel's own Export button is hidden in the embed:** Done is the one
  way to export, so the video always lands on the post.
- **Measured (browser test, local, mock data):** Payoff spot, Snap zoom,
  open the block, Strong, Close, Outline look, Done: 7 clicks, back on the
  Finish step in 14 s with no page errors. The exported MP4 shows the
  caption in the upper third at 1 s, the footage zoomed under a still
  caption at 4.5 s, and as-shot again at 5.5 s.
- **Not yet:** nine presets share a near thumbnail (zoom-through, flash
  cut, match cut, push in, pull out, rewind, caption slam, the two caption
  looks, picture in picture). Their own thumbnails come from the worker's
  preset renderer in phase D, rendered from the same keys.

### G31. Editor phase C: beat sync, editing basics, saved styles (overnight run, 2026-10-14)

- **Beat sync, in the Presets tab's Beat card:**
  - The post's music (the Sound row's uploaded track) now comes onto the
    timeline as a music track, and the editor finds its beat when it
    opens (OpenReel's own beat detection, mapped to where the music
    plays). "Add music" puts another track on and finds its beat.
  - Or tap the tempo (4 taps or more; a 2 s pause starts over), or type a
    BPM, and the grid is laid through the playhead across the timeline.
  - Beats show on the timeline (OpenReel's beat overlay, downbeats
    brighter). Clips, captions and preset blocks snap to beats and to
    markers; a preset clicked with the playhead just off a beat (a quarter
    beat at most, 0.15 s at most) lands on the beat.
  - "Music in the export" (on by default) mutes the music tracks in the
    export when switched off, for posts that get the TikTok sound in the
    app. Beats, the music list and the switch are kept with the timeline.
- **Editing basics:** OpenReel already has split, cut, copy and paste,
  duplicate, delete, ripple delete, trim to the playhead, select all and
  multi-select, snapping on and off, zoom, markers, undo and redo, and
  shortcut maps (OpenReel, CapCut, Premiere, Final Cut, DaVinci). The
  embed adds:
  - Ripple trim (a switch in the Studio bar, on): trim a shot shorter and
    the shots after it slide over, so no gap opens. Trimming longer is
    left as is.
  - Beat and marker snapping for clips (above).
  - Undo and redo verified on preset blocks in the browser test (place,
    Ctrl+Z, Ctrl+Shift+Z).
- **Saved styles, in the Presets tab's Styles card:** "Save as a style"
  keeps the timeline's presets as a stack with places relative to the
  video: at the payoff (the marker, else the Studio's spot), on a cut, on
  a beat, or so far from the start or the end; camera blocks keep a
  changed length and edited keyframes. Styles are saved per account
  (`account_settings`, key `editor_styles`, at most 50; a name used again
  replaces the old style). One click places a saved style on the open
  timeline. The math is pure and the same in the fork
  (`packages/core/src/studio/style.ts`) and the Studio
  (`server/core/editorStyle.ts`, for the worker in phase D), with the
  same test vectors.
- **Make another like this:** Done saves the post's stack with its
  timeline. The copy gets the stack, not the timeline (which names the
  first post's media); its first open places the stack, which wins over
  the Idea step's Format. Verified in the browser: the copy opened with
  all of the first post's presets at its payoff.
- **Measured (browser test, local, mock data):** type 120 and Set (13
  beats), Payoff spot, Impact shake, undo and redo, Save as a style, name,
  Save, Done, then the copy opened with the stack and the saved style
  placed in one click: 7 clicks, no page errors.

### G32. Editor phase D: the worker renders the same timeline (overnight run, 2026-10-14)

- **Headless editor export on the worker: no.** It would need a Chromium
  with WebCodecs in the Railway image (hundreds of MB), open-source
  Chromium has no H.264 encoder, and a 50-video batch would hold a
  browser per job. Instead, one renderer for the camera presets: the
  worker runs the editor's own camera math (`server/core/camera.ts`, a
  line-for-line copy of the fork's `cameraAt`, `ease`, `shakeOffset`)
  frame by frame (`server/media/camera.ts`: scale, shift and rotate over
  black, blur, colour, brightness, the motion streak, RGB split,
  vignette, dark, flash, in the canvas's order). Time, text and layout
  presets use the worker's code edits of the same name (G24, G26), one
  per video.
- **The preset library is data:** `config/presets.yaml`, copied from the
  pinned fork commit by `npm run presets:sync`; a test fails when the pin
  moves without a sync, and the config check fails when an edit style
  names a preset that is not there.
- **What the worker renders** (`server/pipeline/workerTimeline.ts`):
  1. A timeline saved by the editor: its shots as trimmed (black where it
     has a gap), its captions (text, box or outline, nearest safe place),
     its camera blocks, its music switch, and its time or text preset as
     the code edit. What only the editor draws (OpenReel's own effects
     and transitions, a second video track, the person cutout, karaoke,
     text animations, text behind her) is listed under the export with
     "Open the editor and press Done for them". Nothing blocks.
  2. A stack carried by Make another like this: placed at this post's own
     payoff, cuts and beats (beats found in the post's music).
  3. A batch's style (Finish step, Style: a saved style): placed on every
     video at that video's own places.
  4. Otherwise the cut and its Format exactly as before (the worker's
     code edit, which zooms toward her face). A first try rendered a
     camera Format with the editor's preset instead; it changed how old
     posts look (a centre zoom, a transition at the payoff instead of its
     cut) and the existing edit tests caught it, so it was dropped.
- **Migration:** no data is rewritten. Posts made before keep their cut
  and Format; the worker renders them as before (row 4) and the
  editor lays them out on first open (phase B), placing the Format's
  preset; from then on the saved timeline renders. A post edited in the
  editor no longer needs Done to export: Export MP4 renders its saved
  timeline (phase A's "export it there with Done" block is gone).
- **Parity** (`scripts/editor-parity.mjs`, local Studio and Playwright's
  Chromium): one post, Snap zoom (Strong) at the payoff, exported by the
  editor (Done) and rendered by the worker (Export MP4); frames compared
  over the bottom two thirds (no caption: the editor draws text with the
  browser's fonts, the worker with the bundled TikTok Sans).
  - Before the zoom: 35.5 and 35.7 dB. Inside it (4.05 to 5.0 s): 32.5 to
    33.0 dB. The picture matches; what is left is the two decoders (VP9 in
    this test browser, H.264 on the worker) and the two scalers.
  - In the test suite (`server/media/camera.test.ts`,
    `server/pipeline/workerTimeline.test.ts`): a zoomed frame against
    ffmpeg's own scale and crop of the same frame (above 24 dB), unmoved
    frames against a plain render (above 24 dB), zoomed frames against a
    plain render (7 dB, so a missing zoom fails loudly), for a saved
    timeline, a carried stack and a 2-video batch with a style.
- **Captions start the same in both:** the manifest sends the post's
  caption look (the white box by default) and place (the upper third),
  and the editor's first layout uses them.
- **Library:** the editor's Done already lands the MP4 in Library >
  Posts (the post's video), as the worker's export does.

### G33. Item 3: batch upgrades (overnight run, 2026-10-14)

- **Spreadsheet import, inside a batch** (Idea step, "Import a
  spreadsheet"): paste rows or upload a CSV, one row per post. Columns in
  any order, forgiving names: character, account, clip (an existing
  clip's name to reuse, or "still: your prompt"), still, video (optional),
  caption (required), style (optional, the Format by name). The separator
  is whichever of comma, semicolon or tab the header uses, so a caption
  with a semicolon stays whole.
  - Preview (free): every row's status (reuses a clip: free; a new still
    and take: priced; a problem: named, and skipped) and the total. The
    price is the Studio's default still model plus a 5 s take on the
    default video model, per new row, from the price book, before reruns.
  - Make N posts: one video post per good row, tagged with its account (or
    the batch's). Rows that reuse a clip open at Finish and export at once
    (free) unless the owner switches that off; a row whose Format still
    needs something (shot B for a crash zoom) says what and waits. Rows
    with a still prompt open at their Stills step with the prompt (and
    "In the video: ...") as the idea.
  - Call: nothing paid runs from the import. A still and a take are
    generated in each post with its own price, as always (price before any
    paid run is fixed). The total in the preview is an estimate for those.
- **Caption styles**: Outline (TikTok Classic) next to the white box and
  the upper third as the default place were already in (earlier tonight);
  the editor now starts captions in the same look and place (G32).
- **Clone source cleanup** (automatic while the clip is prepared; a
  default, `clone.cleanup` in content.yaml, and "Use the cleaned clip" per
  clip in the Clone panel):
  - TikTok's end card: a mostly black stretch (82 percent of pixels near
    black) that runs to the end and starts in the last 6 s is cut off.
  - Burned-in captions and the bouncing handle watermark: text that stays
    sharp and still for 2 s while the picture moves (light against dark,
    an outline or TikTok's white box), found in overlapping 2 s windows on
    small grey frames, grown into words and lines, split into text bands
    when a cluster is taller than a caption, boxed with its time, then
    filled in from around it (ffmpeg delogo) only while it shows. The
    handle that jumps corners halfway is found in both places.
  - A still picture (nothing moves) is left alone: there is no way to tell
    text from the scene. Detection is a heuristic, tested on a synthetic
    TikTok (panning picture, caption box, jumping handle, end card); real
    clips may need tuning (LATER).
  - The clip as uploaded is kept; switching "Use the cleaned clip" off
    clones that instead.
- **Read its caption** (Clone panel, Claude, priced on the button): reads
  the caption from a frame of the clip as uploaded (the cleaned copy has
  it filled in) and puts it in the post's caption, editable.

### G34. Item 4: voice lines (overnight run, 2026-10-14)

- **The character's voice**: an ElevenLabs voice ID in the character file
  (`persona.voice.elevenlabsId`), set in the character page's Voice modal
  or imported from a "## Voice" section (the script kit's card format).
  The same card holds how the character talks (item 5, G35).
- **Takes** (Library > Voice lines, a new tab; UX-PLAN section 13): one
  file per line, named by hook. `047_check-my-match-score.wav` reads as
  Hook 47, "Check my match score"; a name without a number keeps its
  words. The worker prepares each take free: mono WAV at 44.1 kHz, at most
  60 s, loudness measured; a file that is not sound fails with a reason.
  - Stored in `sounds` (kind `voice`, migration 0011 adds `character_id`
    and `meta`), never listed with ambience and music.
- **Convert** (priced, `voice_convert`, one quote for one take or all):
  ElevenLabs speech to speech (`eleven_multilingual_sts_v2`, MP3 44.1
  kHz) into the character's voice, then speech to text (`scribe_v1`, word
  timestamps) on the converted audio. One priced request per take.
  - Price: `elevenlabs/sts-v2`, USD 0.006 per second of take, marked
    unverified (ElevenLabs bills credits by plan; the estimate is a
    ceiling until the first real run confirms it).
  - Both calls answer directly, so the adapter does them at submit and
    keeps the results in storage under the job id; the runner then
    ingests them as usual (audio and a JSON of words). A failed run leaves
    the take as it was.
  - Key: `ELEVENLABS_API_KEY` on Vercel and Railway (the owner's account),
    or an account's own ElevenLabs key in Settings, Provider keys. With
    neither, production refuses the quote in plain words; local dev and
    tests use the mock voice (the take a little higher, words spread).
- **Voiceover on a post** (Finish step, Sound row, video posts): pick a
  converted line, Starts at, level, and "Captions from the voice line"
  (on by default).
  - The line's words are copied into the post when picked (and refreshed
    at export), so the cut, the editor and the render read the same words
    without another lookup.
  - Captions: the words in short phrases (6 words, 2.4 s, a 0.35 s pause
    or a sentence end breaks a phrase; at most the cut's 8 captions),
    each held until the next phrase, each with its word times. Karaoke
    lights each word when it is said. A voiceover is laid over the
    finished picture, so its captions keep their times through a time
    edit (speed ramp, freeze).
  - Mix: the voice at -16 LUFS before the mix; music and ambience dip
    under it (the same sidechain ducking as for a clip's own sound); the
    finished post at -14 LUFS.
  - The editor gets the voice on its own audio track and the phrases as
    captions. A timeline saved before the voiceover was picked keeps its
    own captions; the editor adds the voice track when it next opens (fork
    commit 676dd49), and the export mixes it in either way.
  - Switching the post's character drops the voiceover (a line belongs to
    one character). A batch takes none (one line cannot match fifty
    captions; LATER has per-caption lines).
- **Lip sync**: not built; the plan is in LATER.md.

### G35. Item 5: the scale kit (overnight run, 2026-10-14)

For thirty characters and twenty accounts (UX-PLAN section 14). Items 4
and 5 ship in one push: they share the voice card and the new Library
tabs, and one deploy instead of two saves a Vercel build and a worker
restart.

- **Voice card per character** (the character page's Voice modal, also
  "## Voice" in the character file, `persona.voice`): who, point of view,
  talks like, words used, words never used, emoji, humor, content pillars,
  an example line, and the ElevenLabs voice (G34). Every field optional.
  - The batch caption writer, the slideshow writer and the hook variant
    writer get the card as plain lines and are told to write in that
    voice. With no card, the prompts read as before.
  - The "never" words are suggestions to the writer, not a block (rule
    one: the persona never list is a default).
- **Products** (Library > Hooks, a new tab): a product is a script kit as
  data: the claims sheet (labeled lists: what it is, what it does, price,
  approved phrasings, never say; one-line rules such as safe framing and
  where the link goes), the buyer-language bank (labeled lists), the hook
  vault (numbered, grouped by type) and the kit's notes (how to use it,
  the weekly rhythm). Tables `products`, `hooks`, `hook_variants`
  (migration 0012).
  - Seeded from the owner's `sidestep-script-kit.md`, kept as data in
    `config/kits/`. The owner's account gets it automatically the first
    time the Hooks tab opens; any other account starts empty and can load
    it in one click or import its own kit (.md, same format; a parser in
    `server/core/scriptKit.ts`, no Claude call).
  - Import fills a character's empty voice card from the kit's live card
    with the same name (Callie). The kit's proposed cards (the
    ex-recruiter, the career switcher) are listed with "Use this voice"
    for any character; the character's ElevenLabs voice is kept.
  - Everything edits inline: a hook's text, a new hook (numbered next),
    the claims and the buyer language as plain text (a line ending in a
    colon starts a group).
- **Hook variants** (priced on the button, `hook_variants`, Claude on the
  content writer route, Sonnet by default): one hook rewritten once per
  picked character, in each voice card, using buyer language, inside the
  claims sheet (the whole sheet, never-say list included, is in the
  prompt). Variants are kept under the hook with the character's name,
  Copy, "Use in a new post" (a video post for that character with the
  variant as the caption) and Archive. Em-dashes in a reply become commas.
  - Claims check (free, code, a warning only): a variant that mentions the
    product (its name or "extension") and a watch word gets a note. Watch
    words come from the never-say list (quoted short phrases, the things a
    "promise of" lists, "hired" for fake results) and are editable. Not a
    block: the claims sheet is the owner's default, and the fixed rules
    are only those in rule one.
- **Pick a hook** (the video post's Text step, beside Caption): a drawer
  with the vault; this character's variants first under each hook. One
  click makes it the caption.
- **Accounts** (Posts home, a card collapsed by default; table
  `social_accounts`): one row per account tag (from posts, or added by
  hand) with its character, tracked link (https only) or promo code,
  posts made, and signups typed in from the link tracker. Ranked by
  signups, then signups per exported post, never by views (views can be
  stored but never rank). Link clicks are not tracked by the Studio; the
  link tracker (or the promo code at checkout) is the source.

### G36. Item 6: light in the prompt writer (overnight run, 2026-10-14)

- The still and video writers now say: the light always has a direction
  that shapes the face (from one side, above and in front, behind and to
  the side), never flat, frontal or shadowless; and skin detail follows
  the light: in bright or raking light real texture shows on its own, in a
  dim or low-light scene the writer asks for less micro detail (soft phone
  grain, gentle shadow, a little noise) so the face never turns crunchy or
  over-sharpened.
- The REALISM block itself is unchanged (rule zero, fixed): it is still
  added to every image prompt. The note only changes how the writer
  describes the light around it.

### G37. Fixes from the first real run (owner, 2026-10-14)

The owner asked for a front-camera selfie in a black tank at a rave and
got a friend's photo in the sheet outfit (white tee, jeans) with glossy
lips. What happened, read from production:

- The text was not sent as written. Punch it up's pick kept only the
  moment; its "Callie herself, front camera" line was dropped, so the
  camera stayed at the default Friend shot and the writer was told "a
  friend about 6 feet away". No black tank was ever in the post (no outfit
  field, nothing in the words), so no outfit line went out.
- Refs: REF-00 and REF-06 (full body, front). A waist-up framing pulled the
  full-body sheet shot, which carries the sheet outfit.
- Makeup: the natural line said "tinted lip"; Flare adds gloss on its own.
- Model: GPT Image 2.5 Flare on the Higgsfield API, 2k, high, 9:16.
- Price: $0.25 a still from a flat placeholder in the price book (no
  quality or resolution), not a live price.

Changes:

- **The owner's words are read** (`server/core/shotParse.ts`, free, plain
  code, shared with the browser): camera (selfie, mirror selfie, POV,
  over the shoulder, long lens, timer, a friend), front or rear camera,
  framing, outfit (phrases ending in a clothing word), makeup, place, and
  whether the words describe the light. Layering, last wins: presets,
  defaults, what the words say, what the owner set. The planner never
  plans away what the words say. A run records what it used in
  `scenes.ran_fields` instead of freezing the fields.
- **Refs by framing:** a body ref only at knees-up and full body
  (`scenes.yaml body_ref_framings`, a default). Chest-up and waist-up get
  face refs only.
- **No sheet clothes:** with refs attached and no outfit named, the prompt
  says the character is dressed for the moment instead of the sheet
  outfit (rule scene-outfit-override, a default).
- **No gloss:** the natural makeup line adds "lips natural and matte, no
  gloss" (template data).
- **21+ in every still prompt** (fixed): "She is an adult, 21 or older."
- **Punch it up** keeps what the idea says (a selfie stays one), and the
  pick carries who takes the photo into the idea.
- **What was sent** (`GET /candidates/:id/sent`): the final prompt as
  sent, the images with their REF ids, model, path, settings, quote and
  real cost. In the still drawer and under every still.
- **A pasted prompt goes as written** (scene field `asWritten`, on by
  itself when the box holds a prompt, a switch in the Idea step): the
  owner's text plus only the reference line (refs for the face only), the
  21+ line and REALISM/AVOID. No writer, no camera, light or outfit line.
  Banned skin words still come out (rule zero).
- **No mood words** (default rule prompt-no-flourish): glowing, cinematic,
  soft light, beautiful, stunning, dreamy and the like come out of the
  writer's text unless the owner used them; the prompt box says which.
- **The Idea step** is one box ("Describe the shot or paste a prompt"),
  the chips, Punch it up, and More control (collapsed) with the character,
  account, format, places and the scene details moved from Stills.
- **Prices:** stills start at Nano Banana 2.1, 4 takes, Standard (1k,
  medium quality where the model has one), 9:16 by destination; High (2k)
  is one click. Flare's placeholder is now by quality and still marked
  not confirmed. The account's own transactions show Nano Banana 2.1 at
  1.5 credits per image (the face pass of 2 images took 3 credits), so a
  4-take run is 6 credits, not 3.
- **Real cost log** (`jobs.cost_check`): on the plan, the matching spend in
  the account's Higgsfield transactions (read-only, free) next to the
  quoted credits; for Claude, the measured tokens. More than 20% off is
  flagged in What was sent and in Settings > Costs. The Higgsfield API
  reports no cost per run, so its quote stands.
- **ElevenLabs:** Callie's voice ID v3PqSRD51socDi8mEJ5f is in her Voice
  (production revision 8). The importer reads a voice_id inside a
  sentence and never takes a "Spare" voice. The spare voice "Spare: young
  female 1" (SifNfmAby6mpNZSg7knN) is held for a future character and is
  not assigned.

### G38. Recreate from a real clip (owner, 2026-10-14)

The owner's route, proven twice by hand in Higgsfield (a rave clip and a
kitchen hair-flip clip): real motion, real light, her face held through
the turns, no caption or watermark. It replaces "Copy the moves into a new
scene" (the same idea with a weaker still) and sits next to "Replace the
person" in the clone panel.

- **Suggested, never forced:** when a clip is prepared, the worker reads
  it for free (small gray frames, two a second): average brightness under
  70 is "dark", average change between frames over 14 is "a lot of
  movement" (`content.yaml clone.recreate`). Either suggests Recreate, with
  the reason; otherwise Replace. The owner's pick wins.
- **a. The frame:** about 0.2 s into the clip as uploaded (captions still
  on; the still removes them, no blur needed).
- **b. Four stills:** Nano Banana 2.1, 9:16, Standard (1k): the frame
  first, then the character's Higgsfield element on the plan
  (`<<<element_id>>>` in the prompt; Callie's "Callie" element from her
  file) or REF-00 and one three-quarter view off the plan. The prompt
  (`templates.yaml clone.recreate_still`) uses the frame only for place,
  light, angle, framing, pose and outfit, replaces the person completely,
  names her face (the card) and hair color, the traits she must not have
  ("Not like the person in the clip", typed or read by Claude, priced),
  keeps the head angle and gaze, and removes caption text, the TikTok logo
  and the username. 21+ and REALISM as always.
- **c. Pick:** Use this still, or You pick (the best face match to REF-00
  minus the likeness to the person in the clip; the newest in demo mode).
  Fix the face: the chosen still plus the element, "change only her face,
  keep everything else pixel for pixel", 2 takes. The masked inpaint is not
  used ("Unknown media role: mask" through the Higgsfield connector).
- **d. Checks:** every still and face pass gets the free face match to
  REF-00 and the likeness check against the person in the clip, with the
  scores shown. A still like that person cannot be used (fixed rule).
- **e. Motion:** the chosen still plus the clip as uploaded, cut before
  TikTok's end card (`motionAssetId`), never the filled-in copy. Plan:
  Genjutsu motion control (`hf_mult_motion_control`, image_references and
  video_references, 720p, the preset suggestion declined): 7 credits a
  second, from the owner's transactions (70 for 10 s, 42 for 6 s). API:
  Kling 3.0 Motion Control through the Vercel AI Gateway
  (`klingai/kling-v3.0-motion-control`, checked in Vercel's docs; the AI
  SDK's start and status calls, the operation stored as the job id so a
  worker restart never loses or repeats a run; `AI_GATEWAY_API_KEY` on the
  server or a Gateway key in Settings), or the Higgsfield API's Kling 3.0
  Motion Control Pro. The motion model is the remembered pick; it starts on
  whichever path has keys (plan, Gateway, Higgsfield API). Gateway prices
  are placeholders until a paid run's cost is logged.
- **f. Trim:** each result has Trim (start and end, free on the worker):
  a new kept clip, the original stays. Cut, never crossfaded.
- Prices on every paid step; on the plan, 4 stills are 6 credits (1.5
  each, from the transactions; the "1.5 per 2 takes" note was per image),
  a face pass 3, the motion about 7 a second.

### G39. Recreate, finished; Flare default; no AI Gateway (owner, 2026-10-14)

- **Stills default:** GPT Image 2.5 Flare, Standard quality (medium,
  2k), 9:16, 4 takes (`scenes.yaml default_still_model`,
  `still_levels.standard.models`). Nano Banana 2.1 stays one click away.
  Every Flare prompt carries "Bare natural lips, no gloss."
  (`models.yaml prompt_lines`, inserted before REALISM by
  `withModelLines`). Recreate's stills and face pass stay on Nano Banana
  2.1 for now: on the plan whenever it is connected, whatever the billing
  default (production's is the API); GPT Image 2.5 on the API only when
  there is no plan.
- **Real Flare prices (plan transactions):** Standard 2k 1 credit,
  High 2k 2.75 credits a still. API dollars are not confirmed yet; every
  API run now reads its exact price back from Higgsfield
  (`POST /estimate/{endpoint}`, logged as `provider_estimate` in the real
  cost log).
- **Nano Banana 2.1, 0.75 vs 1.5 credits:** no setting explains it. The
  plan bills each take as its own line: 1.5 credits at 1k, 2 at 2k. Two
  takes are 3 credits, so the "0.75 per take" was a total divided by two
  lines that were each one take.
- **The AI Gateway path is removed** (`vercelGateway.ts`, the `ai` and
  `@ai-sdk/gateway` packages, `AI_GATEWAY_API_KEY`). Kling runs on the
  Higgsfield plan or the Higgsfield API only.
- **Motion model picker:** Genjutsu, Wan 3.0, Wan 3.0 Prime and Kling 3.0
  Motion Control, each priced on its billing path (plan or API, the
  account's billing default first). A model with no working key or plan
  is greyed with one line saying why. The last pick is selected. Every
  model works on the API alone, so a lapsed plan still runs. All get the
  still as image_references, the cleaned clip as video_references, 720p,
  9:16, audio off, the preset declined, and the motion template with
  "Her outfit stays exactly as in @Image1 for the whole clip, same cut,
  length and fit." Wan 3.0 and Prime use `alibaba/wan-3.0[-prime]/
  reference-to-video` (the `wan_reference` input map).
- **Gates (fixed, rule `recreate-gates`):** the motion step refuses a
  still unless its face matches REF-00 at 0.363 or more and its likeness
  to the clip's person is under 0.36 (`content.yaml clone.recreate.gate`).
  A null face blocks; demo mode passes. The refusal says why and offers
  Fix the face again or new stills. Nothing auto-spends.
- **Entry points:** the Idea step's "Describe it" or "Start from a real
  clip" (file, link or Higgsfield media ID), Library > Clips > "Use this
  clip", and `/studio/recreate?clip=&character=&model=&cap=`. Clicks to a
  finished video: 4 from the link, 5 from the Library, 6 from the Idea
  step (the choice and the file first).
- **Step 2 chips:** "Scene to keep" and "Source traits to drop", the
  outfit (keep the clip's, described, or pick hers), and the motion line;
  Read them for me fills all four from up to 4 frames.
- **Review (free, local job `clone_review`):** the take and the clip in
  sync, the face every 0.5 s with drift marks, Tesseract OCR every 1 s
  for logos, handles and captions (English data fetched with the face
  models), cuts by ffmpeg scene change with Trim at the cut. Use this take
  keeps it, sets no music and opens the Text step.
- **Scale:** Recreate with another character (a new post, same clip);
  a batch of up to 20 rows, each its own post, model per row and Set all,
  one priced run per step, rows that cannot run wait and say why.
- **Spend cap per post** (`cap=`): a step that would pass it is refused
  with what is left; API dollars count at 0.0625 a credit.

### G40. Recreate gate margin, face pass by default, no-plan stills (owner, round 17)

- **Gate margin, calibrated.** The face match to REF-00 (0.363) and the
  likeness to the clip's person (0.36) were nearly the same number, so a
  still could pass looking almost as much like the source as like the
  character. The gate now passes only when: face 0.45 or more; the face
  match beats the likeness by 0.12 or more; likeness under 0.45
  (`content.yaml clone.recreate.gate`, fixed rule `recreate-gates`).
- **Calibration.** Scored with the Studio's own matcher (YuNet and SFace,
  `server/qa/faces.ts`) against production REF-00 (found byte for byte in
  the owner's Higgsfield media, checksum match) and the clip frame each
  still was made from (0.2 s), in a short-lived Vercel Sandbox (the
  session's network cannot reach the media host):

  | Still | Face | Likeness | Margin | Gate |
  |---|---|---|---|---|
  | Kitchen, face pass `8ea5646f` (proven) | 0.711 | 0.263 | 0.448 | passes |
  | Kitchen, before the face pass `d0db0f08` | 0.762 | 0.239 | 0.523 | passes |
  | Rave, face pass `ccfd745f` (proven) | 0.537 | 0.370 | 0.167 | passes |
  | Rave, before the face pass `04c7e0ed` | 0.454 | 0.568 | -0.114 | fails |

  REF-00 against the clip's person: kitchen 0.20, rave 0.18. The proven
  rave still reads 0.370 on its 0.2 s frame, so the old 0.36 cap alone
  would have blocked it; its other frames read 0.18 to 0.29 (the 50% and
  75% frames show no detectable face). The rave still before its face
  pass is the case the margin exists for: a passing face match (0.45) but
  more like the source (0.57). Review drift marks keep the standard 0.363
  (moving frames read lower than a still).
- **Face pass on by default.** "Make 4 stills + face pass" quotes the 4
  stills and the face pass (2 takes) together; the face pass jobs wait as
  children of the first still and start on the best still (You pick's
  rule) once every still has landed and been checked, or are canceled
  with their hold released if none is usable. A switch skips it (the
  lower price). Batches do the same per row.
- **No-plan stills.** Nano Banana 2.1 is not on the Higgsfield API (the
  official Model API Reference lists 84 models, none of them Nano Banana;
  GPT Image 2.5 is there as Marketing Studio Image). Without the plan the
  Recreate stills run on GPT Image 2.5, and the button says
  "(GPT Image 2.5, untested for recreates)", with a quote warning.
- **Real costs of the proven recipe** (plan transactions, 2026-10-14):
  kitchen, 6 s: 4 stills 6 credits, face pass 3, Genjutsu 42, total 51;
  Wan 3.0 10.5 and Wan 3.0 Prime 18 on the same still and clip. Rave,
  10 s: 4 stills 6, face pass 3, Genjutsu 70 (plus 3 for 2 earlier takes).

### G41. Recreate stills model choice and the gate check (owner, round 18)

- **Stills model, the owner's choice.** Even with the plan connected the
  Recreate stills step offers two choices: **Nano Banana 2.1** (Your
  Higgsfield plan; what the proven runs used) and **GPT Image 2.5** (the
  Higgsfield API; "untested for recreates"). Same prompts, same face pass,
  same gates. The face pass runs on the model its still was made with (it
  reads the still job's model). The API choice runs on the API even when
  the account's default billing is the plan; the plan choice keeps the
  plan's element for her face, the API choice sends REF-00 and one
  three-quarter view. Default: Nano Banana 2.1 when the plan is connected,
  GPT Image 2.5 when it is not (the API does not offer Nano Banana 2.1). A
  choice with no plan or no key is grey with one line why. The last pick
  is remembered per account (`recreate_still_model`) and a batch uses it.
  The GPT Image 2.5 quote carries the untested warning.
- **Gate check, suggest only.** After every 10 real recreates (completed
  motion videos on a real model; the demo never counts) Settings > Rules
  shows the Recreate gate check, and the Recreate panel a one-line notice
  linking to it. Picked: the still each video was made from; passed over:
  the other stills of that post and character (a still picked once counts
  as picked; failed stills are left out). Suggested numbers: face just
  under the lowest picked face (minus 0.03, never below SFace's 0.363),
  margin just under the smallest picked margin (minus 0.03, never below
  0.05), likeness cap just over the highest picked likeness (plus 0.03,
  between 0.30 and 0.50), with what each set would have passed and held.
  **Use these numbers** (owner role only; the server works the suggestion
  out again and never takes numbers from the page) stores them for the
  account (`recreate_gate`, with the time approved); **Keep the current
  numbers** closes the check until the next 10. The gate itself stays a
  fixed rule; only its numbers move, and only on the owner's click.

### G42. Recreate prompts: face and hair only, short realism (owner, 2026-10-15)

- **What happened.** The first real Recreate (kitchen clip, Callie, Nano
  Banana 2.1 on the plan) had all 4 stills blocked by the provider's
  filter (Higgsfield status "nsfw"; refunded). The owner's hand runs with
  the same model, element and kind of frame passed.
- **Diagnosis** (single test stills, owner-approved, cap 6 credits; blocked
  runs are refunded, so only passes cost):

  | Test | Change from the blocked Studio prompt | Result |
  |---|---|---|
  | 1 | Age words out ("24 years old.", "She is an adult, 21 or older.") | blocked |
  | 2 | Also the body sentence out | blocked |
  | 3 | The owner's hand-run prompt, word for word, on the Studio's own frame | passed (1.5) |
  | 4 | The fixed Studio prompt below | passed (1.5) |

  The frame is fine (test 3); the words were the trigger, a stack of them
  next to a real person's photo, not any one word: age and body out alone
  were not enough (tests 1 and 2). Net spend 3 credits.
- **The fix, Recreate stills and the face pass only:**
  - **Face and hair only** from the card (`cardForPhotoEdit`): sentences
    about face or hair; age, body, build, style and mood words never go.
    Her body is in the element and the sheet.
  - **No age line**; 21 or older is checked before the run
    (`adultProblem`, on top of the record's own check).
  - **Plain outfit**: "{outfit}, same as in the photo." Claude's words lose
    sleeve, fit, length and cut details (`plainOutfit`; "dark green
    sleeveless fitted top" becomes "Dark green top"); words the owner typed
    (outfit text or keep chips, recorded in `typed`) go as typed. "Read
    them for me" now asks for color and garment only.
  - **Short realism**: "REALISM: Natural skin texture, not retouched." in
    place of the full REALISM and AVOID blocks (`templates.yaml
    clone.recreate_realism`). Still a REALISM block, so the lint and the
    runner keep requiring it.
- **What was sent on failed runs.** Every failed run row and every Recreate
  still (failed or not) has What was sent: the prompt, the images, the
  Higgsfield element named in the prompt, the model, the path, the
  settings, why it failed and the provider's id (`GET /jobs/:id/sent`).

### G43. Editor QA: tested like a user, fixed in the fork (owner, 2026-10-15)

- **Why.** The editor passed its tests but failed in real use: captions
  could not be selected or edited once added. The old tests called the
  editor's functions; nothing clicked, dragged or typed.
- **How it was tested.** Playwright in Chromium, desktop (1440 x 900) and
  phone (390 x 844, touch), clicking, dragging, double-clicking and typing
  on the built editor at the pinned fork commit, against a local Studio in
  demo mode (mock providers, nothing paid). The production site needs the
  owner's login, so the live `/editor/` bundle was checked to load and to
  match the pinned build; the drive itself ran locally. This Chromium has
  no H.264 decoder, so the test serves clips as VP9.
- **Fixed in the fork** (`studio-embed`, hooks listed in its STUDIO.md):
  - Captions: a click in the preview selects (hit test on the wrapped
    lines, topmost track first); double-click in the preview or on the
    timeline block edits in place (Enter, Shift+Enter, Esc, click away);
    the selection box is measured, not guessed from the character count,
    and drags the caption.
  - Long captions wrap at 90% of the frame in `TitleEngine.renderText`,
    measured and drawn with the same lines, so the preview and the export
    match.
  - Karaoke is `TextStyle.highlightColor` on the caption itself, drawn by
    the shared text renderer (preview and export): words share the
    caption by length and light up in turn. Upstream's route made a
    subtitle that lost the place, the look and the editing.
  - Reorder: a shot dropped onto another on the same track goes in front
    of it and the shots close up (one undo step), instead of stacking on a
    new track.
  - M4A audio imports (the Studio stores uploaded music that way); a file
    that does not load is named and the rest of the post opens. Sound ends
    with the post. The music is ducked under the voice (or the clip's
    sound) with OpenReel's own ducker when the post opens.
  - The first frame is drawn without pressing Play; the editor fits under
    the Studio bar, so the phone tabs (Timeline, Media, Edit, AI) are on
    screen.
- **Kept as tests.** `e2e/editor/` (`npm run e2e:editor`, needs `npm run
  studio` and a built editor): captions, clips, sound, phone. Not in
  `npm run check` (it needs a browser and the dev servers).
- **Not built (owner picks).** The usability notes in the audit report:
  the small preview, handles over a small caption, no click-away deselect
  in the preview, track names, the Tap button's second click, and the rest.
- **Second pass (owner's full matrix, same day).** Driven again for what the
  first pass skipped (resize, retime, redo, Pick a hook, phone dragging, a
  render check per feature with a clip that shows time). Fixed in the fork:
  - A caption's handle grew it about 1x per 100 project pixels, so at the
    embed's small preview a 40 px drag made it about 4x and one word a
    line. The scale now follows the handle (the box grows from its center
    by the distance moved), clamped 0.1x to 10x.
  - A caption drag (move or resize) was one undo step per frame, so Ctrl+Z
    took back a few pixels. It is one history group now, and the last
    position is committed on release.
  - A finger could tap and double-tap a caption but not drag it. Touch
    pointers go through the same handlers, the page does not scroll under
    the finger, and the caption's handles sit just outside its box (on a
    phone the box is a few pixels tall and the handles covered it).
  - Speeding up the only shot left the Studio's whole-post caption (and the
    music) running 2 s past it over black, in the preview and the export.
    The post ends with its last shot: a caption or sound clip that ended
    with the last shot keeps ending with it when the shots change length
    (`apps/web/src/studio/follow.ts`). It is not its own undo step; undoing
    the shot's change brings it back with it.

### G44. Recreate: no paid take is rejected; the face pass edits the still (owner, 2026-10-15)

From the owner's first real Recreate (kitchen clip, Callie, Wan 3.0): the
pipeline worked, the gates did not.

- **The video rule.** The take review still used the old 0.36 cap on the
  likeness and marked a take that was clearly Callie "Not kept" (likeness
  0.39 on three frames). A take now uses the still gate's numbers over
  the whole review (`server/core/takeGate.ts`): the middle face match 0.45
  or more, the middle margin (face minus likeness, frame by frame) 0.12 or
  more, the highest likeness under 0.45. The middle face and margin,
  because one turned head should not sink a take; the highest likeness,
  because the moment it looks most like the clip's person is the one that
  matters (she copies the clip's expressions, so a take reads higher than
  a still). The kitchen take: face 0.645, margin 0.43, likeness 0.32 over
  12 frames, a pass.
- **A paid take is never rejected.** A take that misses the rule shows
  "Misses the video rule": a warning with the scores and what missed, and
  two buttons, **Keep this take** and **Try again** (the call is recorded,
  nothing spends, the page goes back to Make the video). A take that
  passes is kept. Only the still gate blocks spend; "a new person" stays a
  fixed rule, enforced by that gate before the motion.
- **Old rejects come back.** A take the old check marked Not kept shows
  as "Your call" with the old reason, its scores worked out again from its
  review, and Keep this take. The kitchen take on production is one;
  nothing is kept for the owner on its own.
- **Text found, with its frame.** Each text hit keeps a thumbnail of its
  frame with the words boxed in red (`textThumb`), so a false reading
  ("if 7", "Vij") can be told from leftover text. Older reviews get
  theirs from a free review again when the take is opened. The first
  version failed on frames wider than 360 px (sharp resizes before it
  composites); two passes now, tested at a real take's size.
- **The face pass edits the still.** Both kitchen face passes came back as
  studio portraits in the sheet's white tee (0.82 and 0.85, marked ready).
  The chosen still is now the first image, the one being edited; the
  element and REF-00 are face reference only; the prompt starts "Edit the
  first image." (`config/templates.yaml`, `face_pass`).
- **The scene check.** Outside the face (its box grown by half each way,
  blanked in both), a face pass must match its still: both made small and
  gray and compared by correlation, 0.6 or more (`server/qa/sceneMatch.ts`).
  One that misses says "Face pass changed the scene, not usable" and has
  no Make the video. Face passes made before the check are held with a
  line saying so (make it again, or use a still).
- **The face pass skips itself when not needed.** When the best still
  already passes with a margin of 0.30 or more (`content.yaml`,
  `recreate.face_skip_margin`), the face pass is canceled before it runs
  and its hold released, with the line "Face pass skipped." The kitchen
  stills had margins of 0.47 to 0.64, so it would have been skipped.
- **Video numbers in the gate check.** After every 10 real takes,
  Settings > Rules shows the scores of the takes kept next to the ones
  tried again on, with suggested video numbers and what they would have
  held. Use these video numbers stores them for the account
  (`recreate_video_gate`); Keep the current video numbers closes the check
  until the next 10. Until then a take uses the still numbers.

### G45. Usability fixes from the editor audit (owner, 2026-10-15)

The owner picked six fixes from the audit's usability notes (UX-PLAN.md
section 19).

- **Earlier failures in one gray line.** Only the run just started can be
  red. Failures from earlier runs fold into one gray line counted by
  reason ("4 blocked by the filter, refunded; 2 face passes not run.
  Nothing charged.") with Show and Clear, in the Recreate stills grid and
  in every run list (`src/studio/failures.ts`). One click is one run: the
  stills group by their quote. The stills grid's Clear is kept with the
  post (`spec.failuresClearedAt`); a run list's Clear is kept in the
  browser. Under the stills button the run list leaves them out, so the
  same failures are not counted twice.
- **The face strip uses the video rule's number.** Drift is a face under
  the video gate's `face_min` (0.45, or the number approved in a gate
  check), on new and old reviews alike (`driftSpans` in
  `server/core/takeGate.ts`).
- **Editor (fork).** Four small corner dots just outside a caption (the
  hit area stays finger-sized) and no Locked button on text; a caption
  never grows taller than the frame (`capScaleToFrame`); freeze and speed
  ramp get a marker on the Presets track that opens the Speed panel; the
  preview starts bigger (a shorter timeline, no header bar); a click on
  empty space clears the selection; the Studio names its tracks (Shots,
  B-roll, Voice, Music, Ambience); a shot shows its speed (2x, Ramp,
  Freeze). Each has a Playwright test (`e2e/editor/usability.spec.ts`,
  `phone.spec.ts`, `failures.spec.ts`).

### G46. Catalog wording in every prompt writer (owner, 2026-10-15)

A bare "top" read from a clip was drawn as a plain tee, and fit and body
words next to a real person's photo get refused. Outfits are now said the
way a shop catalog says them, and nothing in a prompt describes her body
or makes her pose (UX-PLAN.md section 20).

- **What changes:** only the words, never what she wears. Fit words come
  out where they stand ("fitted", "tight", "low-cut", "sheer", "toned",
  "curvy"); the phrase naming a body word goes ("fitted at the waist",
  "showing off her legs"), but "waist-up" framing, "waist height",
  "waist-length" hair and table legs stay; underwear-sounding names become
  the everyday garment ("boy shorts" to "bike shorts"; the swap of
  "sports bra" was reverted the same day, see G47); "posing in" becomes
  "wearing". The lists are data
  (`config/wording.yaml`), the code is `server/core/wording.ts`.
- **Where:** Claude's words are cleaned before the owner sees them (the
  planner's fields, Punch it up, the clip reader's outfit, chips and motion
  line) and the writer's still and video prompts are cleaned when they
  land, next to the mood-word cleaning. The system prompts ask for catalog
  terms and a moment, never a pose. The Recreate, scene-still and
  face-pass templates said "the person's position" for "the pose" for a
  few hours; reverted (G47). `plainOutfit` (which cut sleeves and straps and left a bare
  "top") is gone.
- **The owner's words go as typed.** A word in the owner's own text
  (the brief, a field they set, a typed outfit or chip) is never touched.
  When the final prompt still has a risky word, the price says so under
  the button: "May be blocked by the provider's filter: tight. Your words
  go as typed." (default rule `wording-risky`, a warning, never a block;
  the cleaning is the default rule `prompt-catalog-wording`). Both are
  defaults, on, switchable in Settings > Rules.
- **After a refusal:** a run or still refused by the filter names its
  likely trigger words (read from what was sent) and offers Retry with
  safer wording (`retry_safer`): the same request with those words
  reworded by code, no Claude call. The rewording is free; the run is
  priced like the refused one, shown first, and counts against a Recreate
  post's spend cap like any retry (plain retries now do too).

### G47. Two reverts: "sports bra" and "the pose" stay (owner, 2026-10-15)

- **"Sports bra" stays "sports bra".** It is a normal catalog garment (the
  templates use "sage ribbed sports bra" as their own example). Only "boy
  shorts" (and "boyshorts") is swapped, to "bike shorts". The garment is
  never changed. `config/wording.yaml` keeps the one swap; the writer's
  rules, the clone reader's outfit line and the Guide say the same.
- **"The pose" is back**, word for word, in the Recreate stills ("the
  framing, the pose and the outfit"), the scene still ("the lighting, the
  pose, the framing") and the face pass ("the hair, the outfit, the pose,
  the hands"). That recipe is proven on real runs; its wording changes only
  when a real run shows a reason. Tests pin the exact sentences.

### G48. No caption, the editor opens with the take, Studio media first, image uploads (owner, 2026-10-15)

- **No caption** (UX-PLAN.md section 21): a third choice next to White box
  and Outline, on every video post (Recreate included) and every batch,
  kept with the post (`captionOff`). The cut has no captions, so the
  editor opens without a caption track (a saved project's caption track is
  left out, and comes back when the caption is switched on again), and
  neither Done nor Export MP4 nor the worker's timeline render draws one.
  The typed words are kept for switching back.
- **A caption is never required for any output** (owner, same day: "some
  people will want to add that stuff in the editor"). An empty caption is a
  video with no caption; nothing in the Finish step or the render checks
  asks for one. A batch with no lines makes How many videos; a slideshow
  with no words exports its stills as they are (still cropped to 9:16); a
  spreadsheet row may leave the caption empty.
- **The editor opens with the take.** On the live site the caption loaded
  and the take did not. The cause, reproduced in a test: the post page had
  just played the take through its Studio address, which redirected to a
  presigned R2 link; the browser kept that redirect (cacheable 10 minutes)
  and storage's answer, which has no CORS header because a plain <video>
  asks without an origin (R2 does not vary on Origin). The editor's fetch
  of the same address got the kept answer and was refused. An earlier
  guess ("Origin: null" after a redirect) was wrong: one redirect keeps the
  page's origin. Now each editor file carries a fresh direct link (`src`)
  fetched without the cache, then the Studio's address (also without the
  cache), then the Studio in parts of at most 4 MB (`?proxy=1`, a Vercel
  response is capped at 4.5 MB); the Studio's redirect is `no-store`. A
  timeline saved while its shots never loaded gets them back at their
  places when it opens. Every way in was tested by clicks: a Recreate after
  Use this take, a finished post, Library > Make a video post, Make
  another like this.
- **Add media, Studio first.** In the editor, Add media and Import media
  open the Studio picker (`apps/web/src/studio/media/` in the fork;
  `GET /content/:id/editor/media`): this post's takes and stills, the
  character's clips and stills, then the Library (B-roll, sounds, other
  characters' clips). One tap adds at the playhead on a new track; a drag
  puts it on a track where it is dropped. Picked items join the post's
  media map, so they open again after Done. From computer is the second
  tab: the Media tab's own file input, as before. Video thumbnails load
  only when their tile scrolls into view.
- **Upload images** in Library > Stills (for the character picked under
  For) and a slideshow's Stills step (added to the slideshow): several at
  once, dropped on a computer or picked from the camera roll on a phone.
  Each is kept exactly as uploaded: the same bytes (checksum kept), full
  resolution, the original type (PNG, JPEG, WebP); HEIC is refused with how
  to share it as JPEG. They are kept stills (`op: upload_image`), shown in
  Stills, the slideshow picker and the editor picker. An original over
  4 MB is served by a redirect to storage, never shrunk to fit.
- **A working run pulses.** Every live run row (images, videos, renders,
  Claude) pulses in the accent color until it ends; with reduced motion it
  holds a steady accent border.
- **Tests like a user**, desktop and phone (`e2e/editor/take.spec.ts`,
  `picker.spec.ts`, `caption.spec.ts`, `uploads.spec.ts`): the Studio runs
  behind a proxy that serves media as the live site does, with the browser
  cache on (Playwright's routing turns the cache off and hid the bug).
  The full flows run locally; the live site needs the owner's login.

### G49. Storage, traffic and auto-clean (owner, 2026-10-15)

Goal: Vercel moves only JSON; media always goes between the browser and
R2 directly; junk clears itself (UX-PLAN.md section 22).

- **Every file is a redirect.** `GET /assets/:id/content` on R2 answers
  302 to a presigned link for images too, full size and thumbnails,
  never the bytes (a 2K still over 4.5 MB failed through the function).
  A thumbnail (160, 320, 480, 720, 960 or 1600 wide, WebP) is made once,
  the first time a size is asked for, and kept next to the original as
  `<key>.w<width>.webp`. Links are signed on the hour so a page's
  repeated images stay cacheable; a page that reads files with CORS (the
  editor's picker and direct links) asks with `cors=1` and gets its own
  link, so a no-CORS answer kept for an <img> or <video> is never reused
  for it. Grids ask for thumbnails, the Recreate stills grid included.
  Locally (development) the Studio still serves the bytes.
- **The old app's proxies are gone**: `api/hf/[...path].js`,
  `api/hfproxy.js`, `api/img-proxy.js`, their `vercel.json` rewrite and
  the dev proxies in `vite.config.js`. The Studio never used them. The old
  pages at the site's root lose Higgsfield connect, generation and image
  downloads; /studio is unchanged.
- **Worker temp sweep**: on start the worker deletes temp folders older
  than 5 minutes that a crash left (`studio-media-`, `ingest-`,
  `mock-video-`), and reports its free disk (`/health`, `/api/v1/worker`,
  Settings > General > Storage).
- **The daily clean** (a free local job, `storage_clean:<date>`, queued
  when Posts home opens and a day has passed, which wakes the worker):
  upload slots under `uploads/` never used after 1 day (and an R2
  lifecycle rule for the same, set only when the key may and never over
  the bucket's other rules), the Trash past its 7 days, Auto-clean, then
  the storage measure. Measure now in Settings runs it at once.
- **Storage readout**: the account's files in R2 (bytes, files, upload
  slots waiting) and the estimated monthly cost at $0.015 per GB-month
  after the first 10 GB, which are free (per Cloudflare account).
- **Delete and the Trash**: any Library item (a still, an uploaded image,
  a kept take or clip, B-roll, a sound, a render) is deleted one at a time
  or many with Select. It moves to the Trash (`trash_items`), restorable
  for 7 days, with Undo in the message. A still that is (or shares its
  file with) a character's sheet ref, or anything a live post uses, asks
  first and names the REF or the posts. Candidates become `trashed`, then
  `purged`; B-roll and sounds are archived; a render keeps a snapshot of
  the post's outputs and the post goes back to a draft. Every list (post
  views, scene candidates, Recreate, the gate check, the Library) leaves
  trashed items out. After 7 days the daily clean deletes the file and all
  its thumbnails, unless another live item, a live post's render or
  another Trash entry still uses the same file.
- **Auto-clean** (default 14 days; 3, 7, 14, 30 or Off; a default per rule
  one) touches only two kinds of item: takes never kept and stills never
  picked, from posts finished that many days ago; they move to the Trash,
  marked Auto-clean. Never, whatever their age (owner, same day; each rule
  has its own test in `server/pipeline/trash.test.ts`):
  1. sheet refs (REF-00 to REF-11), heroes and anything in a character file,
     or any item sharing one of their files;
  2. a take kept with Keep this take or Use this take (kept counts as
     starred), or anything starred;
  3. anything any post names, live, posted, exported or archived: its
     fields, its render and its saved editor timeline (the project file
     lists the media picked into it);
  4. the stills, start and end frames a kept, starred or used item was made
     from, all the way back (parents, and the frames its run named);
  5. saved clips and images in the Library (uploads, kept clips, kept
     clones).
  A scene that another unfinished post uses is left alone. If a saved
  timeline cannot be read, nothing moves and the Trash is not emptied that
  day. Each take card (Video step, Recreate review) has a star.
- **Next auto-clean and Preview**: Settings > General > Storage shows "Next
  auto-clean: N items" and a Preview drawer of every item it would move,
  with a star on each to keep it. The first Auto-clean waits until the
  owner presses Start Auto-clean there (`storage.autoCleanStartedAt`); the
  daily clean skips Auto-clean until then.
- **Parked**: slimming the posts list (LATER.md, Storage and traffic).
- **Posts older than the newest 200** open by their own address now
  (`GET /content/:id`), found while testing.
- **Measured** (locally, on the live-site path, same client, a fresh
  browser): a normal session sends no file bytes through the Studio any
  more; what is left is JSON. The numbers are in the report and in
  `e2e/editor/storage.spec.ts` (transfer).

### G50. Long run, part 1: usability fixes, audited (owner away, 2026-10-15)

The owner's long-run list repeated the six usability fixes. All six were
already shipped (G45, UX-PLAN.md section 19), so this part checked each one
against the code and filled the gaps rather than building them again.

- **Already live:** earlier failures in one gray line with Show and Clear
  (stills grid and run rows), small caption handles with no Locked on text,
  freeze and speed ramp markers on the Presets track, the caption capped at
  the frame height, the bigger preview, click-away deselect, named tracks,
  the speed on the clip, and face-strip drift under 0.45.
- **Found and fixed:** on a phone the Recreate stills grid was wider than
  the screen (two columns that could not shrink below their widest
  button), which pushed the second tile and the gray line's Show button
  off screen. The columns now shrink and tile buttons wrap their words.
- **Tests added** so every item is covered on a phone too: the gray line
  in the stills grid and the run rows, small handles and no Locked, the
  height cap, a tap beside the frame to deselect, named tracks and the
  speed label; and a face strip test (desktop and phone) that checks the
  API's drift line is 0.45 and only scores under it are marked. Locally the
  face models are not installed, so that test serves known scores over the
  real take.
- **Decision:** no change to UX-PLAN.md (no new behavior); the phone grid
  fix is a layout bug.

### G51. Long run, part 2: hair rotation, makeup by setting, the rest of catalog wording (owner away, 2026-10-15)

From character template v1.6 (`docs/character-template.md`, Scene rules)
and the owner's part 2 list. Catalog wording itself shipped in G46; this
part audited it in every writer and added what the template asks for.
UX-PLAN.md section 23.

- **Audited, already live (G46):** outfits in catalog terms, no fit or body
  words, "bike shorts" for "boy shorts", a moment not a pose, the owner's
  words as typed with a warning on the price, trigger words and Retry
  with safer wording after a refusal. The planner, Punch it up, the prompt
  writer, the clip reader and the Recreate and face pass prompts all go
  through `catalogWording`; their tests still pass.
- **Never-send list:** busty, buxom and voluptuous join the fit words, and
  cup sizes ("a D cup", "36DD") are taken out by case-sensitive patterns
  (`config/wording.yaml`, `patterns`). Call: case-sensitive and single
  letters B to H only, so "a cup of coffee", "A cup", "30A" (the beach
  road) and "32GB" stay. The [BUILD] line on full-body sheet refs is a
  sheet prompt, not a scene prompt, so it is untouched.
- **Hair rotation (default rule `hair-rotation`):** a new scene starts with
  the next styling from the template bank (`config/scenes.yaml`,
  `hair_bank`), never one used in the character's last 5 combo log
  entries or last 5 scenes (`settings.hair_window`). Calls: the pick is
  written into the scene's Hair field at creation so it shows in the form
  and survives the planner (the planner's own hair choice is replaced by
  the rotated one); a styling named in the owner's words ("in a messy
  bun") is read for free and wins, even when the words change later; a
  styling the owner types wins; a copy for another character drops a
  rotated styling so that character rotates their own; a rotated styling
  does not make a fresh scene read as "planned". "Other part" in the
  template is written "parted on the other side" so it reads as a prompt
  phrase.
- **Combo log:** the hair styling is a fifth part ("/ low loose ponytail"),
  read back by the rotation. Older four-part lines still read; a line
  wrapped onto the next one, as the template writes it, is joined.
- **Makeup by setting (default rule `makeup-by-setting`):** no makeup at
  home, the gym, an early beach or waking up (the place words are
  `config/scenes.yaml`, `makeup_by_setting`); soft everyday makeup
  anywhere else. Calls: it sits under the owner's choice and the owner's
  makeup words; after a planner run the setting decides unless the planner
  picked soft glam for a night out; the "Natural" choice is now labeled
  "Soft everyday" (same id). The soft everyday wording is the template's
  (light coverage that still shows skin texture, groomed brows, mascara,
  warm bronzer, a matte nude lip) and a character's own everyday line
  (Callie's "natural (light skin, groomed brows, tinted lip)") replaces
  it; both end with "the same lip shape, nose and jaw as the references".
  Men (he, or a man) get "Groomed brows and beard" and never a makeup
  word. Hero and sheet stay bare-faced (fixed, unchanged).
- **Tests:** unit (bank, rotation order, wrapped combo lines, setting
  words, the makeup lines, cup sizes kept and removed) and pipeline
  (rotation across scenes, words and typed hair win, copies, the combo log
  read back, makeup by setting with the switch off and after the
  planner); Playwright desktop and phone (`e2e/editor/scenerules.spec.ts`).
- **No paid runs.** Whether the soft everyday line and the styling line
  hold on a real still is in the paid test queue.

### G52. Long run, part 3: character files from the Claude project (owner away, 2026-10-15)

Character template v1.6 (`docs/character-template.md`) is how the owner
builds a character in the Claude project. UX-PLAN.md section 24.

- **Import first.** The Characters page leads with "Import a character
  file" (primary); "Start from a concept" stays as the second choice, in
  the header and in the empty state.
- **Template check (free, `server/core/templateCheck.ts`).** Needed: every
  UNIVERSAL section (Realism principle, Models, Scene rules, Video rules,
  Recipe: candid, Recipe: recreate), the age 21 or older (a fixed rule, so
  it is checked here too), one distinguishing mark, REF-00 to REF-11 each
  labeled in the Reference sheet, and the Element ID when an Element is
  named. Calls: sections are matched by title words, so Callie's older
  titles ("Scene rules learned", "Proven recipe: recreate from a real
  clip") count; a jewelry piece listed with the marks does not count as a
  mark (template v1.6: no accessory is permanent); optional sections that
  are missing and sections still holding [brackets] are listed, never
  blocking. With a needed item missing the button reads "Import anyway"
  (rule one: a warning at most, never a block).
- **Callie's current file** (`fixtures/callie/character-callie.md`) passes
  every needed item; the brand layer and the build-path sections (Brand,
  Why people watch, Voice card, Build notes, Stress test, Identity fixes,
  Saved identity, Competitors, Accounts, Monetization, Winning stack,
  Growth log) are listed as optional and missing. A full v1.6 test file
  (`fixtures/template/character-wren.md`, a made-up character) passes with
  nothing missing.
- **Importer, v1.6 fields:** the Saved identity section (Element and its
  ID), "Grooming default" and "Dressed-up version" (makeup default, glam
  and when), both "Voice" and "Voice card" sections, and comma-separated
  hair options. A grooming default of "none" means no makeup in public too.
- **Update, not a copy.** When a character of the same name exists, the
  dialog chooses "Update <name>" by default ("Import as a new character" is
  the other choice). A re-import replaces the character's words; posts,
  takes, stills, clips and the sheet live in their own tables and stay.
  Calls: the combo log is merged (the Studio's entries are kept, newest 10);
  every saved identity is kept even when the file leaves it out (an
  Element takes a new build to replace); the voice card and REALISM block
  are kept when the file has none; a sheet image identical to the approved
  one (same checksum) is skipped, so nothing built on it goes stale.
- **Brand layer.** Read from and written back into the file's own sections
  (Brand, Why people watch, Accounts, Winning stack, Growth log), so the
  file stays the source of truth: the Brand card on the character page's
  Character file step edits each field in place and keeps every other line
  as written; a missing section is added before Disclosure and the combo
  log, in the template's words. No new table.
- **Writers.** Default rule `brand-winning-stack`: the winning stack goes
  with the prompt writer (still and video), the planner and Punch it up,
  "where it fits this shot and inside the fixed rules". Default rule
  `brand-check`: Punch it up checks each moment against the brand statement
  (two new fields in its answer) and the Idea step marks one that does not
  fit "Off brand" with the reason. Advice only; both are switchable.
- **Tests:** unit (the check on Callie's file, the v1.6 file and the blank
  template; brand read and write), pipeline (re-import keeps posts, takes,
  refs, the combo log and identities; brand edits come back on export; the
  writers carry the stack and the check, and drop them when switched off),
  Playwright desktop and phone (`e2e/editor/charfile.spec.ts`).

### G53. Long run, part 4: export presets, hook variants, the cover, safe zones (owner away, 2026-10-15)

UX-PLAN.md section 25. Everything here is free: it runs on the worker or
in the browser, never a provider.

- **Export for (presets as data, `config/content.yaml`, `export_presets`).**
  TikTok (up to 90 s, 12 Mbps, -14 LUFS), Reels (90 s, 10 Mbps, -14 LUFS)
  and Shorts (60 s, 10 Mbps, -14 LUFS), true peak -1 dBTP. Calls: the
  numbers are starting points chosen inside the Studio's own 90 s cut cap,
  not platform rules (the apps accept longer videos; the owner edits the
  file to change them); TikTok is the default. A preset applies to every
  export of the post: the worker's Export (length cap in the render, the
  loudness target in the sound bed, then a bitrate cap that encodes again
  only when the file is over it), the editor's Done (length and bitrate
  caps in the one normalize encode, then a loudness pass) and the hook
  variants. Batches take the preset too.
- **Hook variants.** Up to 3 versions per video post, each changing only
  the first 2 seconds (`hook_variants` in config), as the owner listed
  them: a caption, a first shot or a first edit, or any mix.
  - Caption: a hook line (`hookVariants`), typed or picked with the
    existing hook picker, over 0 to 2 s in place of a caption there: a
    caption that ends inside those seconds goes, one that runs past them
    starts at 2 s.
  - First shot (`hookShots`): any of the Studio's own media for the post
    (the editor's Add media list: this post's takes and stills, the
    character's clips and stills, Library B-roll). The first 2 seconds of
    picture come from it (a still is held for 2 seconds); the timeline
    carries on from 2 s, so the length, the captions and the presets stay
    where they were. Only this account's files are accepted.
  - First edit (`hookEdits`): a camera preset from the editor's library
    at 0 s, in place of any camera preset that started in the first 2
    seconds. Time, text and layout presets are not offered there: the
    worker draws one of those per video, and swapping it would change the
    whole video, not its opening.
  Calls: the variants live beside the post's own export
  (`outputs.variants`), never replace it; they render on the worker with
  the post's Export for preset; an editor-only effect is listed as for any
  worker render. A version with a camera preset goes through the camera
  pass like any post with one (one more encode of the picture).
- **Cover.** After an export: scrub to a frame, add optional cover text,
  Make the cover. The worker takes that frame of the exported video and
  draws the text in the caption look, centered, as a 1080 x 1920 JPEG
  (`outputs.cover`), to upload as the app's cover. Call: a cover is never
  burned into the video itself.
- **Safe zones (editor fork, `apps/web/src/studio/safezones/`).** A Safe
  zones choice in the editor's top bar (Off, TikTok, Reels) draws each
  app's top bar, button column and caption area over the preview, named,
  in red; preview only, never exported; remembered in the browser. The
  bands are approximate fractions of the 9:16 frame kept as data in the
  fork, with a test.
- **Tests:** unit (presets, hook captions, the bitrate reading), media (the
  bitrate cap and the loudness pass), pipeline (Shorts, three hooks from one
  timeline with different first seconds and the same rest, the cover), the
  fork's zone test, and Playwright desktop and phone.

### G54. Name the garment in the clip reader's outfit (owner, 2026-10-16)

UX-PLAN.md section 26. The owner: "Only for outfits the clip reader wrote,
never mine: if the outfit names no garment type ("black top"), show "name
the garment: tank top, t-shirt..." on the price, with a one-tap fix that
reruns the reader for the outfit only."

- **The check is free and code only.** `namesGarment` looks for a garment
  type from a list in `config/wording.yaml` (`garments`: tank top, cami,
  t-shirt, slip dress, bodysuit, jeans, shorts and the rest, plurals
  included, whole words only). Calls: compound tops count as garment types
  (crop top, tube top, wrap top, off-the-shoulder top); a bare "top",
  "outfit" or "look" does not; "uniform" is left out of the list (it is
  also an adjective).
- **Only the clip reader's outfit, only where it is used.** The warning
  shows on the Recreate stills price when the outfit in the prompt is the
  reader's (Keep the clip's outfit, or Pick hers named in words), never
  when the owner typed it and never when one of her stills carries the
  outfit. It is a default rule (`outfit-garment`), a warning that never
  blocks: the stills can still run with the outfit as it is.
- **The fix is priced.** "Read the outfit again" is one Claude call (the
  fixed rule: no paid call without a quote), so it is a small price button
  beside the warning: one tap runs it at the price shown. The reader looks
  at the frame again with its last answer and must name the garment; its
  answer is cleaned into catalog terms and replaces only the outfit (the
  chips, the traits and the motion line stay). An outfit the owner typed
  meanwhile is never replaced, and the button refuses to run on one.
- **The price refreshes when the fix lands.** A price button can now say
  when its own runs are done (`onDone`), so the stills price is fetched
  again however fast the reread ran, and the warning clears.
- **Tests:** unit (the garment check), pipeline (the warning and its fix
  on the price, the reread replaces the outfit only, typed words never
  warn and are never replaced, the rule switch), Playwright desktop and
  phone.

### G55. The slideshow power-up: hook first, one camera roll, text styles, variations, batch (owner, 2026-10-16)

The owner: "Hook to finished slideshow in minutes, at volume, with an edge
no other creator has. Build inside the existing Slideshow flow (Idea,
Stills, Slides, Finish). No new pages." UX-PLAN.md section 27 has the
audit and the plan.

- **Built on what was there.** Pick from the Library, Upload images, the
  scene stills of the post's scene and the free export stay; they now add
  slides at the end, under "More ways to add pictures". A slideshow's
  slides are parallel lists by slide number (words, picture, shot, special
  slide, dragged place), so the owner's edits and a still landing never
  undo each other; a slot is written under a row lock. Older slideshows
  read as before (stills repeat when there are fewer than slides).
- **Hooks.** "10 from the vault" is code only and free: the kit's hooks
  first (rotated by each press), then each pattern recast with the
  buyers' words or the topic. "Write 10 with Claude" is priced. Every hook
  carries one of the eight patterns the owner named.
- **The draft.** One Claude call per hook writes every slide, its shot,
  special slides (never slide 1, at most 2), the scene, the caption and at
  most 5 hashtags. Claude's shot and outfit words go through catalog
  wording; a scene field the owner typed is never replaced.
- **One camera roll.** Character stills reuse the post's scene (makeup by
  setting, the rotated hair, catalog wording, the REALISM block, the lint)
  with the locked place, light, camera, outfit and details over it and
  the slide's shot as the moment, plus one line saying the set is one
  day's camera roll. On the plan the character's Higgsfield element goes
  with the refs. Topic stills have no person, no refs (a saved scene's
  picture as the place reference when the model takes refs) and the
  short REALISM line; they are kept as `slide_topic` candidates, so the
  face checks and gate checks never see them.
- **API path.** The stills model is chosen like Recreate's: Nano Banana
  2.1 on the plan, GPT Image 2.5 Flare on the Higgsfield API, the last
  pick kept; with only an API key the API model is picked and billed to
  the API. Every Claude step uses the content writer route.
- **One renderer.** `server/core/slideSvg.ts` lays out the text styles,
  the Ad label and the four mock screens for a frame; the browser draws it
  as SVG text (TikTok Sans measured in a canvas) and the worker as
  outlines from the same fonts, so the preview's line breaks and places
  are the export's. Classic follows the owner's numbers (bold white, a
  black stroke at 15% of the font size, 5 to 7.5% of the width by word
  count, about 28% from the top, 4 to 6 words a line); every style stays
  out of the top 10% and the bottom 20%.
- **Special slides** are free and generic: a real brand name on a mock
  screen is replaced with a generic one (both lists in
  `config/content.yaml`, matched as the brand writes itself, so "target"
  in a sentence stays).
- **Export.** Both sizes (the other one a center crop of the stills), a
  caption.txt with #ad first when on, and post.json, whose field names are
  mapped in `server/core/postExport.ts` only, for the posting engine.
- **Variations and batch.** Both are one priced run: the Claude call first,
  then the stills as its waiting children (released, not charged, when the
  words do not come back, or when a slide became a special slide: those
  rows read "not needed", never as failures). Variation and batch posts
  get ids derived from their run, so a still never lands before its post
  exists. `variation_of` (the family's first post) and `batch_of` are
  columns (migration 0015). "Never reuse a picture or caption across
  accounts" is a default rule (`slideshow-no-reuse`): variations always
  make new pictures and captions, and the export warns with the fix.
- **Paid test.** One capped real test, under $1, price shown first (the
  report has the numbers).


### G56. Slideshow power-up 2: launch ready (owner, 2026-10-16)

The owner: "The 140-post launch plan (starts Mon Oct 19) goes from CSV to
finished posts in the existing flows, and new hooks get written the new
way. No new pages." The spec is four files in `docs/content/` (the
playbook, the post writer brief, the claims sheet and the plan CSV);
UX-PLAN.md section 28 has the audit and the plan.

- **The playbook is data.** The structure and lens codes (S1 to S12, L13
  to L25), the effects (E1 to E8) and the score ladder are in
  `server/core/playbook.ts`; the fit table (each account's primary and
  backup) and the lint's word lists are in `config/content.yaml`. Accounts
  keep the owner's own primary and backup (migration 0016) over the fit
  table.
- **Write 10 with Claude is two calls under one price**: the writer
  (`slideshow_hooks`) and a separate reviewer (`slideshow_hooks_review`,
  a waiting child activated with the writer's hooks). Only scores 1 and 2
  show; the rest are counted, not lost. When the reviewer fails, the
  writer's own ranks show, marked "(writer)". The writer never gets the
  code of the account's last post in schedule order (`structure-repeat`,
  a default).
- **THE STANDARD (brief v1.1, owner mid-build).** Slide 1 says the pain
  plainly in the viewer's words (7 or more out of 10), clear on one read
  with no image, opens a loop only swiping closes, about 15 words, in the
  group-chat voice; moments, structures and lenses move to slides 2 to 6.
  The text is one template (`hook_standard`) shared by every hook writer,
  and the ladder another (`playbook_ladder`). The reviewer runs the stop
  test first (stops, clear, pain) and code makes a fail a 3 at best, so
  it is hidden whatever score the reviewer gave. The playbook file that
  arrived was still v1.0 (no section 8 rewrite), so the ladder follows
  the brief's statement of THE STANDARD until the v1.1 playbook replaces
  `docs/content/viral-writing-playbook.md`; then only the template
  changes. Writers no longer cut a hook at 16 words: the lint says when
  it runs long.
- **Writing standard v1.2 (owner, mid-build).** THE STANDARD at the top of
  the playbook v1.2 is the spec for the writer, the reviewer and the lint:
  the hook names the job situation, says exactly what happened, hurts 7
  or more, in the TikTok group-chat voice; its pass and fail examples go
  into every hook writer's prompt as the few-shot set. The reviewer's
  stop test has five checks (stops, job, exact, pain, friend), stored on
  each hook (`fails`) so the hidden count says how many failed. The v1.2
  ladder replaced the interim one. Product posts end on a friend's tip
  from four honest endings (data, `product_endings`); a pain SideStep does
  not fix gets no mention, and the draft turns #ad off (`isProductPost`:
  #ad, or a product row whose draft found an ending). Two more lint
  checks: a hook with no job word, and ghosted, passed over or applies for
  you on a product post's last slide. Slideshows are TikTok only: Export
  makes 1080 x 1920; the 1080 x 1440 set is a per-post option, off.
  The length note shows over 22 words (owner, 2026-10-16: the v1.2
  passing examples, 14 to 22 words, are the bar; `hook_max_words` in
  content.yaml); the writer still aims for THE STANDARD's "about 15". Hooks are no longer cut at 16 words anywhere (Use
  this hook and batch included): 30 is a cap against runaway answers.
- **Follow-ups (owner, 2026-10-17).** The length note shows over 22 words.
  Posts home pages past the newest 200 posts: `GET /content/page` with
  keyset paging (when the post was last changed, then its id; `before` is
  the last post shown, compared as a row value so ties never skip a
  post), the account and character filters on the server, and the chips
  from every post (`accountTags`, `characterIds`). The first list stays
  the newest 200 with the options, so nothing else changes; an older post
  already opened by its link (`/content/:id`).
- **The plan's Pictures column after Generate (owner, 2026-10-17).** The
  Launch plan card read `/plan` every 5 s only while a still was running,
  and never once more after the last one: the last read could come before
  the last still landed, and a run on the mock could start and end
  between two reads of the jobs list, so a filled post stayed "0 of 6"
  until a reload. Now the card reads the plan again when its stills stop
  running (as `useCharacter` and `useScenes` do), and Generate N posts
  reads it when its own jobs are done.
- **The language lint** (`server/core/copyLint.ts`) is one pure function
  for the browser and the server: free, warnings only, each check a
  default rule (area copy) switchable per account or character. It never
  blocks a run or an export. THE STANDARD adds three hook checks: over 15
  words, a label or stage direction to open (the list is data; a
  timestamp or date is found by code), more than one quoted phrase. On
  the launch plan's 140 hooks the hook checks flag 92 (v1.2, the length
  note at 22: 83 with no job word, 28 labels or timestamps, 6 stacked
  quotes, 1 long); the rows still import as written, and the rewritten
  plan replaces the test file.
- **The plan import is code, not Claude, and column-driven.** Every value
  is read by its header's name (case and spaces ignored, any order), so a
  rewritten plan with the same columns replaces the test file without a
  change; unknown columns and missing required ones are named in the
  preview. Every word is kept as written;
  the scene is split by "Slide N:" into each slide's shot and the rest is
  the locked scene. Drafts are matched by account and row_id, so an import
  again updates instead of doubling and never touches a post with
  pictures. Feeders are topic slideshows filed under a character for
  storage only. "Draw mock screens by code" starts off: the plan's scenes
  put screens on laptops and phones in real places, so every slide is a
  photo as written unless the owner turns it on or switches a slide.
- **Generate N posts is one quote**, with the job runner's new queue
  groups: ten posts at a time, the next group activated when the one
  before has no job running or waiting on a parent (`advanceQueue`). Up to
  100 posts in one click. A clip row gets its opening still only; its take
  waits for the owner in the post, with its own price.
- **The plan row travels with the post** (`spec.plan`, `planMetaSchema`):
  the Plan line on the post, and post.json version 2's `plan` section with
  the CSV's own names. Video posts now save a post.json too.
- **"Ad:" replaces "#ad"** first in the caption (the brief's rule); a
  product row turns it on. The CTA line is added under the caption when
  it is not already in it.
- **Nine more mock screens** are drawn by `drawnScreen` in
  `server/core/slideSvg.ts` for the preview and the export alike, generic
  names only. The **Product screenshot** is never drawn: it is the
  owner's upload, placed as uploaded (its own aspect, sized and placed
  Top or Middle, out of the bottom 20%), and the export waits for it.
- **Variations go to an account of the same kind**: a character post's to
  that character's other accounts, a topic post's to another topic
  account. Variation 1 uses the alt hook word for word.
- **Paid test.** One capped real test under $1, price first, on the
  Higgsfield API path (GPT Image 2.5 Flare); see LATER.md for what ran.

### G57. Products: every post belongs to one product, or none (owner, 2026-10-17)

What went wrong: the SideStep writing standard (THE STANDARD v1.2, its job
examples, the stop test's "job" check, pain 7+, the honest endings, the
playbook menu and 13 language checks) was wired into the shared writer
templates and a global lint, and `kitFor` gave any slideshow with no
product the account's first product (SideStep). Every test and seed post
was a job-hunt post, so nothing showed a non-SideStep post getting it; a
Callie video post captioned "Do boys even know what it's like to be a
girl?" got "No job word". The cause was reading "THE STANDARD is the spec
for the writer, the reviewer and the lint" as every writer and every
post, never asking which posts it was for. The owner's standing rule two
(CLAUDE.md, UX-PLAN.md section 0) now says it for every feature: nothing
product-specific is ever global, and every plan states which products,
characters and accounts it applies to.

Decided (UX-PLAN.md section 29, approved with five changes):
- **The post's product is a column**, `content_items.product_id`
  (migration 0017; the slideshow spec's `productId` moved there). A new
  post takes its account's product (`social_accounts.product_id`, the
  Accounts card) or none. No hard-coded account defaults: the owner sets
  each account's product. Never "the first product".
- **The general standard** for every post, any product or none: the stop
  test's four checks (a stranger would stop, clear on one read, says
  exactly what happened, sounds like a person), one story thread, the
  clarity test, an image line a slide, the voice from the character's
  voice card or the account. One Claude call for Write 10, no reviewer.
  It is the unprefixed templates (`hook_standard`, `slideshow_hooks`,
  `slideshow_draft`, `slideshow_variations`, `hook_variants`).
- **A product adds its own rules on top** (`products.writing`, a key of
  `writing_standards` in `config/content.yaml`): SideStep's add the job
  word, pain 7+, its endings, the reviewer, the structures and the
  language notes, through the `sidestep_` templates (`templateFor` picks
  a standard's own version, else the general one). `names` starts a
  product of that name on it (the kit import).
- **Written for a product and an ad for it are separate.** The ad switch
  is #ad (a plan row's ad column); the honest endings and "Ad:" follow
  it. A plan import never turns a pure-pain row into an ad.
- **The em and en dash check runs on every post**; the other 12 checks
  only where the post's product's rules have lint on (`standard` in
  `lintCopy`), with the post's own product as the name never in a hook.
- **Plan CSV columns**: `product` is a product name (blank: the plan's
  pick) and `ad` is yes or no. A name not in Products is an error in the
  free preview. An older file's product column of yes or no is read as
  the ad column, with the plan's pick as the product.
- **Only the ticked rows import** (the preview reads them all), each with
  its product. Posts home filters by product on the server; B-roll picks
  its product from the products; Pick a hook opens the post's product's
  vault; drawn screens start with neutral words.

The three slideshows made before this on the TikTok account had no product
picked, so they now show No product until the owner picks one.

### G60. Results: typed or pasted per post, and read by follows per post (owner, 2026-10-17)

The owner, before launch: "On every post: post_url, posted_at, views_72h,
follows_72h, saves_72h, shares_72h, decision (make 3 variations / keep /
one more try / drop), notes. Typed on the post card, or bulk-pasted from a
CSV by row_id. A Results view on Posts home: totals and follows per post by
account, product, character and hook structure, with the decision rules
shown as hints. Free, no platform APIs yet."

Decided (UX-PLAN.md section 32):
- **Results live on the post** (`content_items.spec.results`, every post
  kind, in each kind's spec schema), no migration. They are written on
  their own (`PUT /content/:id/results`, a `jsonb_set`), never through the
  workspace's spec patch, so an edit in the workspace never undoes them,
  and `updated_at` stays: typing results never moves a post up Posts home.
  Make another like this, variations and a batch's slideshows start with
  none.
- **One reader for typed and pasted values** (`server/core/results.ts`,
  shared by the browser): counts take K, M and thousands commas; posted_at
  takes ISO and the common forms and is kept as written
  ("YYYY-MM-DDTHH:MM", a time zone dropped); the decision takes the four
  labels and their plain variants.
- **The CSV matches by row_id**, or `post_id` for a post with no plan row,
  with an optional `account` column for a row_id two accounts share. On one
  account the first made post is the plan's (Make another like this keeps
  the row_id). A blank cell changes nothing; a cell that cannot be read
  leaves its whole row out; unknown columns are named and ignored. The
  preview is free and writes nothing.
- **Follows per post is the headline** of the Results card and the sort of
  every breakdown (account, product, character, hook structure), the
  playbook's rule. Topic posts are "No one" under Character.
- **Hints, never automatic, thresholds as data** (`config/content.yaml`
  `results`): 50K+ views, make 3 variations (Make variations one click
  away on a slideshow); a hook family with two posts under 1K views, drop
  it, shown on every post of the family. **A hook family** is a post and its
  variations (`variation_of`) joined with every post sharing its plan
  moment (`moment_id`), because Make another like this and variations keep
  the moment and each plan row has its own.
- **post.json** gets a `results` key (still version 2: a new key only).
