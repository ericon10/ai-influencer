# Deploying Character Studio

Production layout (approved 2026-10-13):

| Piece | Where | Notes |
|---|---|---|
| Studio UI and `/api/v1` | Vercel Hobby, project `character-studio`, region iad1 | https://character-studio-pi.vercel.app. `api/studio.ts`, 60 s limit. Never runs long work. |
| Database | Neon, project `character-studio` (`solitary-moon-90298015`), aws-us-east-1, Postgres 17, database `studio` | Free plan. Suspends when idle. |
| Files | Cloudflare R2 bucket | Browsers upload straight to R2 with presigned links. |
| Job worker | Railway Hobby, from `Dockerfile` and `railway.json` | Submits, polls, downloads, strips audio, QA, ffmpeg joins. Sleeps when idle; the API wakes it. |

## Environment variables

Never commit values. Generate the two Studio keys once and use the same
values everywhere; changing `STUDIO_MASTER_KEYS` later makes saved provider
keys unreadable (add a new version in front instead).

```bash
node -e "console.log('v1:' + require('crypto').randomBytes(32).toString('base64'))"   # STUDIO_MASTER_KEYS
node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"           # STUDIO_SESSION_SECRET
```

| Variable | Vercel | Railway | Local `.env.local` | Value |
|---|---|---|---|---|
| `DATABASE_URL` | yes | yes | no | Neon pooled connection string (host has `-pooler`) |
| `S3_ENDPOINT` | yes | yes | no | `https://<account id>.r2.cloudflarestorage.com` |
| `S3_BUCKET` | yes | yes | no | The R2 bucket name |
| `S3_ACCESS_KEY_ID` | yes | yes | no | R2 API token, Object Read and Write, this bucket only |
| `S3_SECRET_ACCESS_KEY` | yes | yes | no | Same token |
| `STUDIO_MASTER_KEYS` | yes | yes | no | Generated above, same in both |
| `STUDIO_SESSION_SECRET` | yes | yes | no | Generated above, same in both (the worker wake token comes from it) |
| `STUDIO_OWNER_PASSPHRASE` | yes | yes | no | The owner's sign-in passphrase |
| `HF_CREDENTIALS` | yes | yes | optional | Higgsfield API key, `KEY_ID:KEY_SECRET` |
| `ELEVENLABS_API_KEY` | yes | yes | optional | ElevenLabs API key for voice lines (speech to speech and speech to text). Owner's account only; without it the deployment refuses Convert with a plain reason (local dev uses the mock voice) |
| `STORAGE_DRIVER` | set (`s3`) | yes, `s3` | no | |
| `S3_REGION` | set (`auto`) | yes, `auto` | no | |
| `STUDIO_OWNER_EMAIL` | set | yes | no | `eric@erichelsel.com` |
| `STUDIO_PUBLIC_URL` | set | yes | no | `https://character-studio-pi.vercel.app` |
| `STUDIO_WORKER_URL` | yes | no | no | The Railway service's public URL |

"set" means it is already in the Vercel project. The Dockerfile sets
`NODE_ENV`, `STUDIO_WORKER_IDLE=wake` and `STUDIO_MODELS_DIR`; Railway sets
`PORT`. Never add `NODE_ENV` on Vercel (the build would skip dev
dependencies); a Vercel deployment always counts as production.

A deployment with settings missing answers `503 not_configured` and names
the missing variables (never their values).

## Vercel

1. Settings, Environments, Production, Branch Tracking: `character-studio`
   (older dashboards: Settings, Git, Production Branch). Builds of `main`
   are skipped in this project.
2. Settings, Environment Variables: paste the values (the form accepts a
   pasted `.env` block), environment Production, type Sensitive.
3. Deployments, the latest one, Redeploy (variables apply on the next
   deployment).

Deployment protection is "Only Preview Deployments": production is public
behind the Studio's own sign-in (with a login throttle); previews need a
Vercel login.

## Railway

1. New Project, Deploy from GitHub repo, `ericon10/ai-influencer` (allow
   the Railway GitHub app on that repo if asked).
2. Open the new service. Settings, Source: branch `character-studio`.
   `railway.json` is picked up (Dockerfile build, `/health` check, app
   sleeping, watch paths).
3. Variables, Raw Editor: paste the Railway column, then Deploy.
4. Settings, Networking, Generate Domain. Copy it into Vercel as
   `STUDIO_WORKER_URL` (with `https://`) and redeploy Vercel.
5. Check: `https://<railway domain>/health` answers `{"ok":true}` and the
   logs say "worker idle until woken".

## R2 CORS

The API tries to set the bucket's CORS rule on the first upload. An Object
Read and Write token usually cannot, so paste this in Cloudflare: R2, the
bucket, Settings, CORS Policy (also shown in Studio Settings, Storage):

```json
[
  {
    "AllowedOrigins": ["https://character-studio-pi.vercel.app"],
    "AllowedMethods": ["PUT", "GET", "HEAD"],
    "AllowedHeaders": ["content-type"],
    "ExposeHeaders": ["ETag"],
    "MaxAgeSeconds": 3600
  }
]
```

Then Studio Settings, Storage, Check uploads.

## Monthly cost (single owner)

| Service | Plan | Expected |
|---|---|---|
| Vercel | Hobby | $0 (personal use; move to Pro at $20 when customers pay) |
| Neon | Free | $0 (data is small; images live in R2) |
| R2 | Free tier | $0 under 10 GB stored; no egress fees |
| Railway | Hobby | $5, which includes $5 of usage. The worker sleeps when idle and uses about 100 to 300 MB while working, roughly $1 to $2 of usage a month |
| Total | | About $5 a month, plus Higgsfield generation |
