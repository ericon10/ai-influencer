# Project context for Claude Code

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

The Studio gives 100% creative flexibility with every character. The
sheet keeps the person from drifting (the face matters most); after
that a character can wear anything, go anywhere and do anything in
real life. Lessons from earlier runs are starting suggestions, never
restrictions. Every rule is in exactly one of two buckets
(`config/rules.yaml`, `bucket:`):

- **FIXED, and only these:** the Realism principle (rule zero: real
  skin, the REALISM block, banned words, beautify off, the texture
  check, the natural baseline); bare face on hero and sheet;
  characters are 21 or older; no nudity or explicit content; a new
  person, never a copy of the inspiration face; posts labeled as
  AI-generated; the price shown before any paid run; budget caps;
  keys server-side only. Fixed rules can
  stop a run and cannot be switched off.
- **DEFAULT, everything else:** pre-filled, fully editable, a warning
  at most, never blocks a run. Outfit, footwear, jewelry (the ear
  cuff included), makeup and hair; any camera angle, height, distance
  or framing; aspect by destination; repeats (the combo log is a
  history; a variety note exists but starts off); logos (off by default, a per-scene "Brands and
  logos" switch for brand deals); the persona "never" list
  (suggestions only); the gray sheet background (editable); QA
  findings (advice with one-click fixes; face drift is a strong
  warning and the owner still decides); automatic Claude QA (starts
  off: the free face match and skin checks always run, and "Check
  this" asks Claude on demand, priced on the button); the Claude
  model per task (Sonnet 5.5 for every Claude call, each switchable to
  Opus in Settings, Claude models; the model name shows next to each
  price); video recipe rules (single
  take, calm action, no winking line, audio off).

Settings > Rules lists every rule with its bucket and an on/off switch
for each default, for all characters or one (the character setting
wins). The lint forces a default to "warning" even if the yaml says
"error", and `server/pipeline/rulebook.test.ts` proves no default can
block a run. A new rule is a default unless the owner says otherwise.

Forms follow the same idea: as few required fields as possible (a scene
needs only its moment, and the owner's own words count), each required
field marked REQUIRED until filled, and a blocked button always shows
what is left, linked to the field (`Field`, `Todo` in `src/studio/ui.tsx`).

This file gives a new Claude Code session enough context to be useful
immediately. Read this first before making changes.

## What this app is

A React+Vite single-page app for designing and generating AI influencers.
Local-first: every user's data lives in their own browser localStorage.
Image and video generation happens through the user's own Higgsfield
account (OAuth, PKCE).

On the `character-studio` branch this repo is becoming **Character
Studio** (scope: `SPEC.md`; decisions: `docs/studio/DECISIONS.md`;
checklist: `docs/studio/PLAN.md`). The Studio is server-backed
(Postgres + object storage + job runner). The legacy pages described
below keep working unchanged on localStorage and the Higgsfield MCP path.

## Character Studio working rules (required)

From SPEC.md section 12 and the owner's guardrails. Rule zero (Realism)
and rule one (defaults, not locks) come first. These are how we build
the Studio; they are not creative limits on a character.

- **No em-dashes anywhere**: UI copy, prompts, docs, commit messages,
  code comments. `npm run check` fails on them in Studio paths.
- **Prompts shown in the UI are hard-wrapped**, never one long line,
  and each has a one-click copy.
- **Audio is per request.** Video requests are silent by default
  (`audio` false) and the runner strips the track unless the request
  asked for audio. Voice and sound come later (ElevenLabs).
- **Cost estimate before every generation (fixed).** Never call a paid
  endpoint (image, video, audio, LLM, upscale, training) without a quote
  shown to the owner first. The server enforces this: a run needs a
  fresh quote id.
- **Push in batches, only when the owner needs to try something.** Commit
  locally as you go; push once a change is ready to use, after `npm run
  check` passes. Every push deploys Vercel (daily deploy limits) and,
  for `server/**` or `config/**`, restarts the Railway worker, so check
  that no job is running first. Say "ready" only after the deploy is
  READY.
- **Tests use the mock adapter only.** No test, script or dev session
  calls a real provider without an approved quote.
- **SPEC.md section 5 rules are defaults.** They live as data in
  `config/rules.yaml`; the prompt lint and QA warn on them and the
  owner can switch each one off. Only the fixed rules block.
- **Secrets stay in `.env`** (deployment secrets) or the encrypted
  per-account vault (provider keys). Never in code, never in the browser.
- **Multi-tenant from day one**: every record carries `account_id` (and
  `user_id` where a person acted). No single-user shortcuts.
- **Rules, prompt templates and model routing are data**, not code.
  Callie is a test fixture (`fixtures/callie/`), not app logic.
- **Higgsfield endpoints only from the official Model API Reference**,
  never from third-party catalog copies. A model not yet confirmed by
  one small paid test (Settings, Higgsfield models) shows a warning on
  its quote. USD prices from open.higgsfield.ai/pricing.
- **Never crossfade a seam.** Cut, grade, or mark the seam failed. Prefer
  one take with start and end frames (SPEC 4.3).
- Fine-tune (Phase 4, DECISIONS G13 and G23) is the Studio's own layer
  editor over the workspace, on OpenCut's project layout; the OpenCut
  engine itself waits for the owner's call (G23). Keep posts' parts as
  data (clips, B-roll, caption text, sound) so any editor can load them
  as layers, and keep OpenCut's license notice in Settings > Notices.

## Character Studio layout

| Path | What it does |
|---|---|
| `config/*.yaml` | Rules engine, prompt templates, sheet graph, views, routing, price book, budgets |
| `server/core/` | Pure, unit-tested logic (prompts, rules, sheet DAG, QA side logic, character file) |
| `server/core/realism.ts` | Rule zero: bare-face line, REALISM and AVOID blocks, banned words, beautify filter |
| `server/core/safety.ts` | Fixed: no nudity or explicit content (lint and runner) |
| `config/rules.yaml`, `server/pipeline/rules.ts` | Rule one: the rule book (fixed or default), switches per account and per character, Settings > Rules |
| `config/scenes.yaml`, `server/core/scenes.ts` | Stage 7 and 8 presets, scene and edit prompts, ref picker by angle, combo log |
| `UX-PLAN.md` | The Studio's layout (approved): Posts home, one workspace per post, drawers, Library, Settings tabs. New features fit it or update it first |
| `src/studio/pages/Post.tsx`, `src/studio/pages/post/` | The post workspace: Idea, Stills, Video, Text, Finish on one page (video post, slideshow, batch) |
| `src/studio/pages/Guide.tsx`, `src/studio/guide/` | The Guide (DECISIONS G21): Quick start, every page and step with annotated screenshots (`public/studio-guide/`, hotspots in `shots.json`), glossary; `HowTo` opens a section in a drawer from each page and step. Update its text and screenshots when a screen changes |
| `src/studio/pages/Posts.tsx`, `Library.tsx`, `src/studio/library.tsx` | Posts home (account and character filters, Make another like this); the Library and its drawer |
| `config/content.yaml`, `server/pipeline/content.ts`, `server/core/overlay.ts`, `server/media/meme.ts` | Posts on the server: idea, scene, account tag, step; B-roll; video posts, slideshows, batches (clips rotate); TikTok caption box (bundled fonts); renders free on the worker |
| `server/pipeline/clips.ts` | Uploaded clips (kept clips of a character) and the Library view |
| `server/pipeline/clone.ts`, `src/studio/pages/post/ClonePanel.tsx` | Clone Video (SPEC 13.1 R1, DECISIONS G18): the source clip with its sound, the run for one or more characters, free checks (face, skin, not the performer), original sound put back, results kept in Library > Clips |
| `server/pipeline/chain.ts`, `src/studio/pages/post/ContinueShot.tsx` | Chaining (DECISIONS G22): Continue this shot, the last frame as the next start frame on the same model, takes joined into one clip (seams scored, never crossfaded), two shots when a seam fails |
| `server/core/cut.ts`, `server/media/timeline.ts`, `server/pipeline/cutView.ts`, `src/studio/pages/post/RoughCut.tsx` | The rough cut (G22): a post as one timeline (shots, timed captions, sound lane), automatic until edited; Export renders exactly it |
| `server/media/sound.ts`, `server/pipeline/sounds.ts` | The sound bed (G22): Room tone or uploaded ambience, uploaded music ducked under clip sound, two-pass loudness to -14 LUFS (-28 for ambience only); Library > Sounds. No AI music |
| `src/studio/pages/post/Editor.tsx`, `server/core/opencut.ts` | Fine-tune (DECISIONS G23): the editor over the workspace at /studio/posts/:id/edit (layers, preview, split, trim, undo; Done saves and renders); the post as an OpenCut project for the engine later |
| `server/core/promptWriter.ts`, `src/studio/pages/character/PromptBox.tsx` | The prompt writer: Claude writes the final still or video prompt (editable above Generate); code adds the reference line, mark sides and REALISM |
| `src/studio/pages/character/SceneStills.tsx`, `VideoSection.tsx`, `server/pipeline/videoAssets.ts`, `server/media/mask.ts` | A post's Stills (details, Write and generate, Use this still) and Video (takes, Use this take, upscale this take, end frame helper, clip QA) |
| `config/edits.yaml`, `server/media/edits.ts`, `src/studio/pages/post/EditStyles.tsx`, `editZones.ts` | Amazing Edits (G24): ten edits made by code on the worker (never a video model); Format in Idea, Edit style in Finish, the Edit lane in Fine-tune; thumbnails from `scripts/edit-thumbs.ts` in `public/studio-edits/` |
| `server/pipeline/closeup.ts`, `src/studio/pages/post/ShotB.tsx` | Shot B of a two-shot edit: from a still, the Library or an upload; Make the close-up (a free crop of shot A's last frame) |
| `server/core/qa/scene.ts` | Scene QA as advice: one-click fixes, the free mirror, face drift as a strong warning |
| `server/pipeline/scenes.ts`, `sceneActions.ts`, `sceneHooks.ts` | Scene records, picks and crops; paid scene steps; what finished scene jobs do |
| `server/qa/texture.ts` | Texture check after upscales and edits (skin smoothed) |
| `server/providers/` | `ProviderAdapter` (SPEC 7.1), mock, Higgsfield API, Higgsfield account (MCP, plan credits), shared MCP connection flow (Dzine AI coming soon), Anthropic, contract tests |
| `server/jobs/runner.ts` | Quotes required for every run, holds, submit, webhook/poll, ingest, ledger |
| `server/media/` | ffmpeg tools including the seam-scored join (SPEC 4.3) |
| `server/qa/faces.ts` | Face matcher for identity and distinctness QA (YuNet + SFace on onnxruntime-web) |
| `server/pipeline/` | Stage services, review gates, job hooks, import/export, cost views |
| `server/api/app.ts` | Hono API at `/api/v1`; auth via `server/auth/provider.ts` |
| `src/studio/` | Studio UI; styles in `src/studio/studio.css` (`st-` classes, tokens) |
| `fixtures/callie/` | Acceptance fixtures; Callie is test data only |
| `api/studio.ts`, `vercel.json` | Vercel entry for `/api/v1` (fetch handler, 60 s, iad1) |
| `server/worker.ts`, `Dockerfile`, `railway.json` | Job worker on Railway; sleeps when idle, woken by the API (`server/jobs/wake.ts`) |
| `docs/studio/DEPLOY.md` | Production layout, env variables per place, Railway and R2 steps, costs |

Production: https://character-studio-pi.vercel.app (Vercel project
`character-studio`, Neon project `character-studio`, R2, Railway worker).
Worker bundle: `npm run build:worker`. Studio dev: `npm run studio` (API +
worker on 8787, Vite on 5173). Face
models for identity QA: `npm run models` (once). Checks: `npm run check`.
The Studio UI uses a stylesheet with design tokens rather than the legacy
inline-style convention.

## Tech stack

- **React 18** + **Vite 5** + **React Router 6**
- **No build-time API keys**: Higgsfield is OAuthed per-user; the optional
  Claude features call through a serverless proxy that expects an
  `x-api-key` header from the browser.
- **Vercel** is the intended host: `api/*.js` are Vercel serverless
  functions, and `vite.config.js` mirrors them as local dev proxies so
  the dev server behaves the same as production.

## Key files to know

| Path | What it does |
|---|---|
| `src/App.jsx` | Routes + `<ThemeProvider>` + `<StoreProvider>` |
| `src/store.jsx` | localStorage-backed contexts (`useInfluencers`, etc.); new users start with no demo personas |
| `src/utils/higgsfieldAuth.js` | OAuth PKCE flow against `mcp.higgsfield.ai` |
| `src/utils/higgsfieldGenerate.js` | MCP-style image/video generation, polling, media uploads |
| `src/utils/systemPrompt.js` | Prompt templates: poses, wardrobe library, vibe palettes, Soul vs GPT Image 2 variants |
| `src/pages/Create.jsx` | Multi-step influencer creation wizard |
| `src/pages/Influencers.jsx` | Influencer profile + Content Studio + Video Studio (very large, known structural debt) |
| `api/hf/[...path].js` | Edge function that proxies all Higgsfield MCP traffic and forwards SSE streams |
| `api/claude.js` | Anthropic API proxy; caller supplies their own `x-api-key` |

## Conventions

- Inline styles with CSS variables (`var(--bg)`, `var(--text-primary)`).
  Theme tokens are set on `<html data-theme="dark|light">` from
  `src/context/theme.jsx`.
- IDs use `generateId()` from `store.jsx` (`Date.now() + random`).
- Higgsfield models supported: `soul_2`, `gpt_image_2`, `nano_banana_2`,
  `nano_banana_flash`, `seedance_2_0`. Soul has its own simplified
  pose set (`POSES_SOUL`) because it struggles with detailed spatial pose
  instructions.

## Things not to do

- **Never kill the Vite dev server** (port 5173). The owner wants it
  running at all times.
- Don't trust the comment in `modelBaseParams` saying resolution and
  quality conflict for `gpt_image_2`. They don't; the working code
  intentionally passes both.
- Don't refactor `Influencers.jsx` casually. It's 4,700+ lines and the
  state is tangled; any split needs its own dedicated session with
  in-browser verification of every flow.

## Dev workflow

```bash
npm install
npm run dev          # http://localhost:5173
npm run build        # production build
npm run preview      # preview the production build locally
```

To diagnose Higgsfield issues, flip `HF_DEBUG = true` at the top of
`src/utils/higgsfieldGenerate.js` for verbose request/response logs.
