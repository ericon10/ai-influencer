# WaveSpeed and Kie.ai: models, prices, references (research only, 2026-10-22)

Item 21 of the Weeks build (UX-PLAN.md section 37). Research only: neither
provider is wired in. Waits for the owner.

How this was sourced: this session's network proxy refused kie.ai,
docs.kie.ai and wavespeed.ai directly, so every figure comes from web
searches restricted to the providers' own domains (their model, pricing,
docs and blog pages as indexed). Some indexed copies are months old and
some of the providers' own pages disagree; each conflict is noted.
UNCONFIRMED means no official page showed it. Check the live pages before
deciding: https://kie.ai/pricing and https://wavespeed.ai/pricing

## Kie.ai

Credits: 1 USD = 200 credits ($0.005 a credit); the top top-up tier adds
about 10% (https://kie.ai/seedream-4-5, https://kie.ai/seedance-2-0).

| Model | Model id | Price | References | Notes |
|---|---|---|---|---|
| Seedream 4.5 Edit | `seedream/4.5-edit` | 6.5 cr, $0.0325 an image (https://kie.ai/seedream-4-5) | up to 14 `image_urls` (30 MB each) | basic 2K, high 4K; `nsfw_checker` flag |
| Nano Banana 2 | id UNCONFIRMED (docs.kie.ai/market/google/nanobanana2) | 1K $0.04, 2K $0.06, 4K $0.09 (https://kie.ai/nano-banana-2) | up to 10 files | |
| Nano Banana Pro | id UNCONFIRMED | 1K/2K $0.09, 4K $0.12 (an older page: flat 24 cr) (https://kie.ai/nano-banana-pro) | 8 per the docs, 14 per the FAQ (conflict) | |
| Nano Banana 2.1 | id UNCONFIRMED | 1K $0.02, 2K $0.03, 4K $0.045 (https://kie.ai/nano-banana-2-1) | UNCONFIRMED | mask editing |
| Kling 2.5 Turbo i2v Pro | id UNCONFIRMED | $0.042 a second, 1080p (5 s $0.21, 10 s $0.42) (https://kie.ai/kling-2-5) | start frame, end frame (`tail_image_url`) | no 720p tier |
| Kling 2.6 | id UNCONFIRMED | about $0.055 a second "HD"; audio doubles it (https://kie.ai/kling-2-6) | start frame | HD resolution UNCONFIRMED |
| Kling 3.0 | `kling-3.0/video` | Std $0.07/s silent ($0.10 audio), Pro $0.09/s ($0.135 audio), 4K 67 cr/s (https://kie.ai/kling-3-0) | first and last frame (single shot), up to 3 elements of 2 to 4 images | multi shot takes a first frame only |
| Kling 3.0 Turbo | (docs.kie.ai/market/kling/v3-turbo-image-to-video) | 720p $0.09/s, 1080p $0.1125/s (https://kie.ai/kling-3-0-turbo) | | |
| Kling 2.6 Motion Control | id UNCONFIRMED | 720p $0.055/s, 1080p $0.09/s (https://kie.ai/kling-2.6-motion-control) | character image + driving video | |
| Kling 3.0 Motion Control | (docs.kie.ai/market/kling/motion-control-v3) | 720p $0.10/s, 1080p $0.135/s (https://kie.ai/kling-3-motion-control) | character image + driving video | |
| Wan 2.2 Animate Replace / Move | `wan/2-2-animate-replace`, `wan/2-2-animate-move` | 480p $0.03/s, 580p $0.0475/s, 720p $0.0625/s (https://kie.ai/wan-animate) | `image_url` + `video_url`, up to 30 s | file limits conflict on the page |
| Seedance 1.0 Lite / Pro | (docs.kie.ai/market/bytedance/v1-lite-image-to-video) | Lite 720p $0.0225/s, 1080p $0.05/s; Pro 720p $0.03/s, 1080p $0.07/s (https://kie.ai/bytedance/seedance-v1) | start frame | |
| Seedance 1.5 Pro | id UNCONFIRMED | silent: 720p $0.0175/s, 1080p $0.0375/s; audio doubles (https://kie.ai/seedance-1-5-pro) | UNCONFIRMED | 1080p availability conflicts on the same page |
| Seedance 2.0 | id UNCONFIRMED | 480p $0.059/s, 720p $0.124/s (with a video input $0.034 and $0.075 a second, billed on input + output seconds); no 1080p listed (https://kie.ai/seedance-2-0) | about 9 images and 3 clips (Kie blog) | 2.0 Mini 720p 8.2 cr/s |

Platform: `Authorization: Bearer <key>`; `POST /api/v1/jobs/createTask`,
then an HMAC-signed `callBackUrl` or polling `recordInfo?taskId=`; 20 new
tasks per 10 s per account (429 past it, not queued). A clause on
real-person likeness: UNCONFIRMED (none found in the terms).

## WaveSpeed

Prices in USD per run, no credits.

| Model | Model id | Price | References | Notes |
|---|---|---|---|---|
| Seedream 4.5 Edit | `bytedance/seedream-v4.5/edit` | $0.04 an image (https://wavespeed.ai/models/bytedance/seedream-v4.5/edit) | 1 to 10 `images` | 1024 to 4096 px; Seedream 4.0 edit $0.027 |
| Nano Banana 2 Edit | `google/nano-banana-2/edit` | 1K $0.07, 2K $0.105, 4K $0.14 (an older post: $0.08 / $0.12 / $0.16) | UNCONFIRMED | `edit-fast` 2K $0.045 |
| Nano Banana 2.1 Edit | `google/nano-banana-2.1/edit` | 1K $0.04, 2K $0.06, 4K $0.135, plus $0.002 a reference (https://wavespeed.ai/collections/google) | up to 14 | |
| Nano Banana Pro Edit | `google/nano-banana-pro/edit` | 1K/2K $0.14, 4K $0.24 | UNCONFIRMED | `edit-multi` $0.07 |
| Kling 2.5 Turbo Std i2v | `kwaivgi/kling-v2.5-turbo-std/image-to-video` | $0.042/s, 720p | start frame | |
| Kling 2.5 Turbo Pro i2v | `kwaivgi/kling-v2.5-turbo-pro/image-to-video` | $0.07/s, 1080p | start + `last_image` | |
| Kling 2.6 Pro i2v | `kwaivgi/kling-v2.6-pro/image-to-video` | $0.07/s; sound x2; 5 or 10 s | | |
| Kling 3.0 Std / Pro / 4K i2v | `kwaivgi/kling-v3.0-std/image-to-video` (and `-pro`, `-4k`) | Std $0.084/s, Pro $0.112/s, 4K $0.42/s; sound x1.5; 3 to 15 s | `last_image`, up to 3 elements | Std resolution UNCONFIRMED |
| Kling 2.6 Motion Control | `kwaivgi/kling-v2.6-pro/motion-control`, `-std/` | Pro $0.112/s; Std $0.21 per 3 s; 3 to 30 s | image + driving video | |
| Wan 2.2 Animate | `wavespeed-ai/wan-2.2/animate` | 480p $0.04/s, 720p $0.08/s; 3 s minimum, up to 120 s | image + driving video; `mode` replace or animate | same price per mode UNCONFIRMED |
| Seedance 1.0 Lite | `bytedance/seedance-v1-lite-i2v-720p` (and 480p, 1080p) | per 5 s: 480p $0.08, 720p $0.16, 1080p $0.45 (the collection page conflicts) | start frame | |
| Seedance 1.5 Pro (Fast) | `bytedance/seedance-v1.5-pro/image-to-video(-fast)` | Pro 720p $0.026/s silent; Fast 720p $0.02/s, 1080p $0.03/s; audio doubles | | |
| Seedance 2.0 (Fast) | `bytedance/seedance-2.0/image-to-video`, `-fast/` | Std 720p $0.24/s, 1080p $0.60/s (a blog: $0.36); Fast 720p $0.20/s | start + `last_image`, up to 4 references | audio on by default |

Platform: `Authorization: Bearer <key>`; poll
`/api/v3/predictions/{id}/result` (no faster than every 2 s); webhook
details UNCONFIRMED. The terms require consent of every identifiable
person in the inputs and ban sexual content of real people.

## The cheapest per job (silent video)

| Job | Kie.ai | WaveSpeed | Cheapest |
|---|---|---|---|
| Image edit, 2+ references | Seedream 4.5 edit $0.0325 | Seedream 4.5 edit $0.04 | Kie |
| 5 s 720p image to video | Seedance 1.5 Pro $0.0875 | Seedance 1.5 Pro Fast $0.10 | Kie (close) |
| 10 s 1080p image to video | Seedance 1.5 Pro $0.375 (1080p in doubt); Kling 2.5 Turbo $0.42 | Seedance 1.5 Pro Fast $0.30; Kling 2.5 Turbo Pro $0.70 | WaveSpeed; for Kling, Kie |
| Wan Animate replace, 10 s | 720p $0.625 | 720p $0.80 | Kie |

Overall: Kie.ai is about 20 to 40% cheaper like for like on Kling, Wan
Animate and Seedream; WaveSpeed wins Seedance at 1080p, has more endpoint
variants and states its consent policy plainly.
