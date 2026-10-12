# Project context for Claude Code

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

## Character Studio standing rules (required)

From SPEC.md section 12 and the owner's guardrails. These are
requirements, not suggestions.

- **No em-dashes anywhere**: UI copy, prompts, docs, commit messages,
  code comments. `npm run check` fails on them in Studio paths.
- **Prompts shown in the UI are hard-wrapped**, never one long line,
  and each has a one-click copy.
- **Audio off for every video generation request**, always. Strip any
  audio track from generated clips before assembly anyway.
- **Cost estimate before every generation.** Never call a paid endpoint
  (image, video, audio, LLM, upscale, training) without a quote shown to
  the owner first. The server enforces this: a run needs a fresh quote id.
- **Tests use the mock adapter only.** No test, script or dev session
  calls a real provider without an approved quote.
- **SPEC.md section 5 rules are requirements.** They live as data in
  `config/` and are enforced by the prompt lint and QA.
- **Secrets stay in `.env`** (deployment secrets) or the encrypted
  per-account vault (provider keys). Never in code, never in the browser.
- **Multi-tenant from day one**: every record carries `account_id` (and
  `user_id` where a person acted). No single-user shortcuts.
- **Rules, prompt templates and model routing are data**, not code.
  Callie is a test fixture (`fixtures/callie/`), not app logic.
- Do not modify the OpenCut fork from this repo. The Studio hands
  OpenCut an export folder of finished, continuous shots only.

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
| `src/store.jsx` | localStorage-backed contexts (`useInfluencers`, etc.) and the `Kayla` seed |
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
