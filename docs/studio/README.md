# Character Studio guide

## Run it

```bash
npm install
npm run models        # face models for identity QA (one time, about 40 MB)
npm run studio        # API + job worker on :8787 and the app on :5173
```

Open http://localhost:5173. A fresh checkout needs no setup: it uses an
embedded Postgres (PGlite) in `.data/pg`, files in `.data/blobs`, and signs
you in automatically as the local owner. New accounts start in **demo
mode**: every step runs on free mock providers so the whole flow can be
tried without spending anything.

Separately: `npm run dev` (app only), `npm run dev:api` (API and worker
only), `npm run worker` (worker only, for hosted setups).

## Go live

1. Settings, Provider keys: add your Higgsfield API key (`KEY_ID:KEY_SECRET`
   from the Higgsfield Console, pay-per-use; not your web login) and your
   Anthropic API key. Keys are encrypted per account; a free call checks
   each one.
2. Confirm the Higgsfield model endpoints in `config/models.yaml` (set
   `endpoint` and `verified: true`) and their prices in
   `config/pricebook.yaml`. Until then the adapter refuses to send anything
   to an unverified model.
3. Reference images must be reachable by the provider: set up cloud storage
   (`STORAGE_DRIVER=s3` with R2 credentials) or a public URL
   (`STUDIO_PUBLIC_URL`). Text-only hero runs work without either.
4. Settings, Mode: switch to Live. Every run still shows its price first,
   and budget caps block anything over the limit.

## How a character is built

| Stage | What you do | What the Studio does |
| --- | --- | --- |
| 1. Inspiration | Upload images | Keep / Change breakdown (vision LLM) |
| 2. Concepts | Pick one of three | Three cards with two side-specific marks each |
| 3. Hero | Pick one hero across all prompts | 3 text-only prompts x N runs; upscale offer; card check |
| 4. Sheet | Approve or reject one shot at a time | REF-01 to REF-11 in dependency order with QA quoted in |
| 5. File | Download or edit | `character-[name].md`, round-trips |

Every paid step is two calls: an estimate (free) and a run that must present
that estimate. Failed QA never reaches the review queue. Regenerating a shot
marks every shot built on it for re-check.

## What QA checks

| Check | How | Fails when |
| --- | --- | --- |
| Mark side | Vision LLM reports image positions; code maps them to the character's own sides by view; a flipped re-ask catches left/right confusion | A mark is on the wrong side or missing |
| Extra jewelry, logos, framing, eye color | Same perception call | Anything not in the character file, or the wrong framing |
| Identity | Face embeddings (YuNet + SFace, run in process) vs REF-00 and the closest-angle ref | Match under `identity_min_similarity` |
| Distinctness | Face embeddings, hero vs every inspiration face | Match at or over `distinctness_max_similarity` |

Thresholds live in `config/review.yaml`. Face matching skips profiles and
backs (set per view in `config/views.yaml`) and demo images, and says so in
the report. Without the models it reports "skipped" and a person checks the
face. The models (OpenCV Zoo, MIT and Apache-2.0, fine for commercial use)
download to `STUDIO_MODELS_DIR`, checksum-verified.

## Where things live

| Path | What |
| --- | --- |
| `config/*.yaml` | Rules, templates, sheet graph, views, routing, prices, budgets (data, not code) |
| `server/core/` | Pure logic: prompts, rules engine, sheet graph, QA side logic, character file |
| `server/providers/` | Adapter interface, mock, Higgsfield API, Anthropic, contract tests |
| `server/jobs/` | Async runner: quotes, holds, submit, webhook or poll, ingest, ledger |
| `server/media/` | ffmpeg: last frame, strip audio, normalize, trim, seam-scored join, mix |
| `server/qa/` | Face matcher (detect, align, embed, compare) |
| `server/pipeline/` | Stage services, review gates, hooks, import/export, cost views |
| `server/api/` | Hono API at `/api/v1` |
| `src/studio/` | The Studio UI (React, TanStack Query, `studio.css` design system) |
| `fixtures/callie/` | Acceptance test data (Callie is a fixture, not app logic) |

## Checks

```bash
npm run check   # typecheck + no-em-dash check + all tests (mock providers only)
```

## Deploy (when ready)

Vercel serves the app and `/api/v1` (`api/studio.ts`, rewrite in
`vercel.json`). Set `DATABASE_URL` (Neon), storage, `STUDIO_MASTER_KEYS`,
`STUDIO_SESSION_SECRET`, `STUDIO_OWNER_EMAIL`, `STUDIO_OWNER_PASSPHRASE`
and `STUDIO_PUBLIC_URL` (see `.env.example`). Identity QA runs where the
worker runs: run `npm run models` in its image (or point
`STUDIO_MODELS_DIR` at a mounted copy). Run `npm run worker` in a
small always-on container, or add a Vercel Cron call to
`/api/v1/cron/tick?key=$CRON_SECRET` for slower polling without one.
