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
   setting to turn it off. Recreate stills and the face pass use the
   short form, "REALISM: Natural skin texture, not retouched." (owner,
   2026-10-15: the full blocks stacked next to a real person's photo
   tripped the provider's filter).
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
  characters are 21 or older (checked on the record and before a
  Recreate run, never written into a Recreate prompt); no nudity or explicit content; a new
  person, never a copy of the inspiration face (with Recreate's face
  checks before the motion: face 0.45 or more against REF-00, beating
  the likeness to the clip's person by 0.12 or more, likeness under
  0.45, or numbers the owner approves in the gate check; a video take is
  scored with the same numbers as a warning, never rejected: the owner
  keeps it or tries again); posts labeled as
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
- **Every new feature ships with its guide and help (owner,
  2026-10-14).** In the same change: UX-PLAN.md first, then the Guide
  (`src/studio/guide/content.ts`: the page or step section and the
  glossary; fresh annotated screenshots in `public/studio-guide/`,
  hotspots in `shots.json`), then the help throughout the Studio: a
  `HowTo` on each new screen, step and panel, linked to its Guide
  section, and every existing help text the feature changes. A feature
  is not done, and is not pushed, until its guide and help match the
  screen.
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
- **The editor is the owner's OpenReel fork** (DECISIONS G29; it replaced
  Fine-tune, the rough cut panel and the whole-video Edit style). Edits
  are placed on the post's timeline by the owner, never guessed for the
  whole video. Our changes live on the fork's `studio-embed` branch in
  `apps/web/src/studio/`, with upstream kept as a remote; bump
  `editor/openreel.json` to ship a new fork commit. Keep OpenReel's (and
  OpenCut's) license notice in Settings > Notices.

## Character Studio layout

| Path | What it does |
|---|---|
| `config/*.yaml` | Rules engine, prompt templates, sheet graph, views, routing, price book, budgets |
| `server/core/` | Pure, unit-tested logic (prompts, rules, sheet DAG, QA side logic, character file) |
| `server/core/realism.ts` | Rule zero: bare-face line, REALISM and AVOID blocks, banned words, beautify filter |
| `server/core/safety.ts` | Fixed: no nudity or explicit content (lint and runner) |
| `config/wording.yaml`, `server/core/wording.ts` | Catalog wording (G46): outfits in catalog terms, fit and body words out of Claude's words, underwear-sounding names swapped, a moment not a pose; the owner's words go as typed with a warning on the price (`wording-risky`); trigger words and Retry with safer wording (`retry_safer`) after a refusal |
| `src/studio/failures.ts`, `src/studio/runs.tsx` | Earlier failures in one gray line (G45): only the run just started is red, the rest counted by reason with Show and Clear, in the Recreate stills grid and every run list |
| `config/rules.yaml`, `server/pipeline/rules.ts` | Rule one: the rule book (fixed or default), switches per account and per character, Settings > Rules |
| `config/scenes.yaml`, `server/core/scenes.ts` | Stage 7 and 8 presets, scene and edit prompts, ref picker by angle, combo log |
| `UX-PLAN.md` | The Studio's layout (approved): Posts home, one workspace per post, drawers, Library, Settings tabs. New features fit it or update it first |
| `src/studio/pages/Post.tsx`, `src/studio/pages/post/` | The post workspace: Idea, Stills, Video, Text, Finish on one page (video post, slideshow, batch) |
| `src/studio/pages/Guide.tsx`, `src/studio/guide/` | The Guide (DECISIONS G21): Quick start, every page and step with annotated screenshots (`public/studio-guide/`, hotspots in `shots.json`), glossary; `HowTo` opens a section in a drawer from each page and step. Update its text and screenshots when a screen changes |
| `src/studio/pages/Posts.tsx`, `Library.tsx`, `src/studio/library.tsx` | Posts home (account and character filters, Make another like this); the Library and its drawer |
| `config/content.yaml`, `server/pipeline/content.ts`, `server/core/overlay.ts`, `server/media/meme.ts` | Posts on the server: idea, scene, account tag, step; B-roll; video posts, slideshows, batches (clips rotate); TikTok caption box (bundled fonts); renders free on the worker |
| `server/pipeline/clips.ts` | Uploaded clips (kept clips of a character) and the Library view |
| `server/pipeline/clone.ts`, `src/studio/pages/post/ClonePanel.tsx` | Clone Video (SPEC 13.1 R1, DECISIONS G18, G28, G38): the source clip with its sound, Replace the person or Recreate from a real clip (4 stills from the frame, You pick, face pass, the motion from the clip as uploaded, Trim), free checks (face, skin, not the performer), original sound put back, results kept in Library > Clips |
| `server/pipeline/chain.ts`, `src/studio/pages/post/ContinueShot.tsx` | Chaining (DECISIONS G22): Continue this shot, the last frame as the next start frame on the same model, takes joined into one clip (seams scored, never crossfaded), two shots when a seam fails |
| `server/core/cut.ts`, `server/media/timeline.ts`, `server/pipeline/cutView.ts`, `src/studio/pages/post/SoundRow.tsx` | The automatic cut (G22): what the Studio lays out on the timeline from the steps (shots, timed captions); the Sound row. Export renders it on the worker |
| `server/media/sound.ts`, `server/pipeline/sounds.ts` | The sound bed (G22): Room tone or uploaded ambience, uploaded music ducked under clip sound, two-pass loudness to -14 LUFS (-28 for ambience only); Library > Sounds. No AI music |
| `server/providers/elevenlabs.ts`, `server/pipeline/voiceLines.ts`, `server/core/voiceLines.ts`, `src/studio/pages/library/VoiceLines.tsx` | Voice lines (G34): the owner's takes (Library > Voice lines, named by hook), Convert (priced) into the character's ElevenLabs voice with word timings, the voiceover in the Sound row with captions from its words; `ELEVENLABS_API_KEY` server-side, mock voice in dev and tests. Lip sync: plan in LATER.md |
| `server/core/voiceCard.ts`, `src/studio/pages/character/VoiceEditor.tsx` | The voice card (G34, G35): the ElevenLabs voice ID and how the character talks, in `persona.voice`; the writers follow it |
| `server/core/scriptKit.ts`, `server/pipeline/scaleKit.ts`, `config/kits/`, `src/studio/pages/library/Hooks.tsx`, `src/studio/pages/AccountsCard.tsx` | The scale kit (G35): products from a script kit (hook vault, claims sheet, buyer language), hook variants in each character's voice (priced), claims warnings, Pick a hook in the Text step; Posts home > Accounts (tracked link or promo code, ranked by signups) |
| `editor/openreel.json`, `scripts/build-editor.mjs`, `server/pipeline/openreel.ts`, `src/studio/pages/post/EditorCard.tsx` | The editor (DECISIONS G29): the owner's OpenReel fork (branch `studio-embed`, upstream kept as a remote, our code in `apps/web/src/studio/`, see its STUDIO.md) pinned by commit, built into `/editor/` (COOP/COEP); the post's manifest and Done (`/content/:id/editor`); the Finish step's Timeline card. `server/core/opencut.ts` keeps the post as an OpenCut project too |
| `config/presets.yaml`, `server/core/camera.ts`, `server/media/camera.ts`, `server/core/timelinePlan.ts`, `server/pipeline/workerTimeline.ts` | The worker renders the post's timeline (G32): the editor's preset library as data (`npm run presets:sync`), the editor's camera math frame by frame, saved timelines, carried stacks and a batch's style (`src/studio/pages/post/BatchStyle.tsx`); parity script `scripts/editor-parity.mjs` |
| `server/core/shotParse.ts`, `src/studio/pages/post/IdeaStep.tsx` | The owner's words read for free (camera, front or rear, framing, outfit, makeup, place, light; a pasted prompt) as scene fields under the owner's own (G37); the Idea step's one box, chips and More control; mood words the writer added are taken out |
| `server/pipeline/sent.ts`, `server/core/costCheck.ts`, `src/studio/pages/character/SentPanel.tsx` | What was sent under every still (prompt, refs by REF id, model, path, settings, quote and real cost); the real cost of each run (plan credits from the Higgsfield transactions, Claude tokens), flagged when more than 20% off (G37) |
| `server/pipeline/recreate.ts`, `server/qa/ocr.ts`, `server/media/cuts.ts`, `src/studio/pages/post/RecreatePanel.tsx`, `src/studio/pages/RecreateLink.tsx` | Recreate, finished (G39): entry points (Idea "Start from a real clip", Library "Use this clip", `/studio/recreate?clip=&character=&model=&cap=`), keep and drop chips, the outfit choice, the fixed face gates before the motion, the motion picker (Genjutsu, Wan 3.0, Wan 3.0 Prime, Kling 3.0 Motion Control on the plan or the API), the free review (synced pair, face every 0.5 s, OCR, cuts), Use this take, another character, batch of 20, spend cap per post |
| `server/pipeline/gateCheck.ts`, `src/studio/pages/Rules.tsx` (GateCheckCard) | The Recreate gate check (G41, G44): after every 10 real recreates, face and margin of the stills picked vs passed over, and of the video takes kept vs tried again, suggested gate numbers (suggest only; the owner approves, stored per account). The stills model choice (Nano Banana 2.1 on the plan or GPT Image 2.5 on the API) is in `server/pipeline/clone.ts` |
| `server/core/takeGate.ts`, `server/qa/sceneMatch.ts` | Recreate takes and face passes (G44): the video rule over a take (a warning with Keep this take or Try again, never a reject); the face pass scene check (outside the face it must match its still) and the skip at a 0.30 margin |
| `server/core/promptWriter.ts`, `src/studio/pages/character/PromptBox.tsx` | The prompt writer: Claude writes the final still or video prompt (editable above Generate); code adds the reference line, mark sides and REALISM |
| `src/studio/pages/character/SceneStills.tsx`, `VideoSection.tsx`, `server/pipeline/videoAssets.ts`, `server/media/mask.ts` | A post's Stills (details, Write and generate, Use this still) and Video (takes, Use this take, upscale this take, end frame helper, clip QA) |
| `config/edits.yaml`, `server/media/edits.ts`, `src/studio/pages/post/EditStyles.tsx`, `editZones.ts` | Amazing Edits (G24, G26): twenty edits made by code on the worker (never a video model); Format in Idea; the worker's renderer for the editor's time, text and layout presets (G32); thumbnails from `scripts/edit-thumbs.ts` in `public/studio-edits/` |
| `server/media/segment.ts` | Her outline (person mask, G26): PP-HumanSeg on onnxruntime-web in the worker, for text behind subject, the green screen and the dolly zoom |
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
