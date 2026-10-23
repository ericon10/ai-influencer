# ComfyUI for Character Studio: setup on the workstation

For the machine's owner. About an hour, most of it downloads. Nothing on
your machine is opened to the internet: a small agent calls out to the
Studio, takes one job at a time (you can change that) and puts the results
back. You can pause it any time for your own work.

You need: Linux (or WSL2) with an NVIDIA GPU (48 GB VRAM or more for the
full-size models; 24 GB runs the stills), recent NVIDIA drivers, Docker with
the NVIDIA Container Toolkit, about 200 GB free disk, and git.

## 1. Get the files

```
git clone -b character-studio https://github.com/ericon10/ai-influencer.git studio && cd studio
```

Use `-b character-studio`: the Studio lives on that branch, and `main` has
no `comfy/` folder. To update later: `git pull` in the same folder.

Everything ComfyUI needs is in `comfy/`:
`comfy/env/` (the pinned image and its lock), `comfy/workflows/` (the
workflows the Studio sends) and `comfy/agent/agent.mjs` (the agent).

## 2. Build the pinned image

```
docker build -t studio-comfy:1 -f comfy/env/Dockerfile .
```

The image pins ComfyUI, every custom node (by commit), PyTorch 2.8 for
CUDA 12.8 and the LoRA trainer. Do not update anything inside it by hand:
the agent reports a hash of what it runs, and the Studio refuses jobs when
it differs from the expected one. An upgrade is a new lock, built and tested,
then accepted in the Studio (step 7).

## 3. Put the models on disk

Make a models folder (for example `/data/studio-models`) with these
subfolders and files. `comfy/env/models.json` lists every file and where it
comes from. They are never downloaded at job time.

```
diffusion_models/qwen_image_edit_2511_bf16.safetensors
diffusion_models/wan2.2_i2v_high_noise_14B_fp16.safetensors
diffusion_models/wan2.2_i2v_low_noise_14B_fp16.safetensors
diffusion_models/wan2.2_animate_14B_bf16.safetensors
diffusion_models/krea2_turbo.safetensors      your own Krea 2 Turbo file
diffusion_models/krea2_raw.safetensors        Krea 2 Raw, for training LoRAs
text_encoders/qwen_2.5_vl_7b_fp8_scaled.safetensors
text_encoders/umt5_xxl_fp16.safetensors
text_encoders/krea2_text_encoder.safetensors
vae/qwen_image_vae.safetensors
vae/wan_2.1_vae.safetensors
vae/krea2_vae.safetensors
clip_vision/clip_vision_h.safetensors
sam2/sam2.1_hiera_large.safetensors
loras/                                        empty; trained LoRAs land here
```

`text_encoders/krea2_text_encoder.safetensors` is Krea 2's text encoder
(Qwen3-VL-4B); the Krea 2 workflow loads it with the CLIPLoader type
`krea2`, which the pinned ComfyUI lists.

**A test machine.** On a smaller card, smaller fp8 files may be saved under
the expected names above (an fp8 Krea 2 Turbo as `krea2_turbo.safetensors`,
for example): the workflows find them by name. Their hashes differ from
another machine's, so press **Use this machine's environment** in Settings >
General > ComfyUI on each machine (or after you swap a file); the Studio then
accepts that machine's files.

Most are on Hugging Face under Comfy-Org (the `source` in models.json), for
example:

```
cd /data/studio-models/diffusion_models
wget https://huggingface.co/Comfy-Org/Qwen-Image-Edit_ComfyUI/resolve/main/split_files/diffusion_models/qwen_image_edit_2511_bf16.safetensors
```

Krea 2: you already run it. Use your own files; if their names differ from
the list above, rename them or tell Eric the names (the Krea workflow and the
lock name them).

## 4. The agent token

Eric makes it in the Studio: Settings > General > ComfyUI > Make the agent
token. He sends it to you privately (not in a repo, a chat log or an email
thread you keep). Put it in a file only you can read:

```
mkdir -p ~/.studio && chmod 700 ~/.studio
printf 'STUDIO_AGENT_TOKEN=%s\nSTUDIO_URL=https://character-studio-pi.vercel.app\n' 'cfy.PASTE-THE-TOKEN' > ~/.studio/agent.env
chmod 600 ~/.studio/agent.env
```

## 5. Run it

```
docker run -d --name studio-comfy --restart unless-stopped --gpus all \
  --env-file ~/.studio/agent.env \
  -v /data/studio-models:/models \
  -v studio-comfy-agent:/root/.comfy-agent \
  studio-comfy:1
```

No `-p`: nothing is published. ComfyUI listens on the container's own
127.0.0.1; the agent is the only thing that talks to the Studio, and it only
calls out over HTTPS. Both restart on their own if they stop.

The first start measures the model files once (checksums; several minutes
for the big ones). Then the Studio shows the machine online with its GPU.

## 6. The private tunnel (optional)

The Studio does not need it. It is for reaching the machine by hand, for
example to open ComfyUI's page yourself. Use one of:

- Tailscale: `tailscale up` on the machine and on your laptop. Run the
  container with `-e COMFY_LISTEN=0.0.0.0 -p 127.0.0.1:8188:8188` (bound to
  the machine's own loopback only), then `tailscale serve 8188`: ComfyUI's
  page is on your tailnet only.
- Cloudflare Tunnel with Cloudflare Access in front (never a public
  hostname without Access).

Never open port 8188 on your router.

## 7. Check it with Eric

In Settings > General > ComfyUI Eric presses Test connection; the card shows
your GPU, its free memory, the queue and the models found. The first time,
the environment shows "not measured yet" for the models: once the files are
in place, Eric presses Use this machine's environment. From then on a change
on the machine (a node updated, a model swapped) stops jobs until Eric accepts
it again.

To see what the agent measures:

```
docker exec studio-comfy comfy-agent lock
```

## 8. Your own work comes first

Pause the Studio's queue whenever you need the GPU. A job already running
finishes first; nothing new starts until you resume:

```
docker exec studio-comfy comfy-agent pause
docker exec studio-comfy comfy-agent resume
```

Eric can pause it too (Settings > ComfyUI > Pause the queue), and Max jobs at
once is 1 by default. The Studio groups jobs by model family (all Krea 2,
then Qwen, then Wan) so models are not swapped back and forth.

## What runs, and the rules inside

- Workflows: Qwen-Image-Edit-2511 (stills and edits, with the character's
  LoRA and up to three reference images), Krea 2 Turbo (stills, text only,
  with the character's Krea 2 LoRA), Wan 2.2 I2V (video from a still), Wan
  2.2 Animate replace and mix (recreating a real clip's motion).
- LoRA training uses ai-toolkit in the image; the LoRA file stays on your
  disk in `loras/`. The Studio keeps its name and checksum only.
- The Studio checks every job before it reaches you: characters are 21 or
  older, nothing explicit, every person shot asks for real skin texture
  (no smoothing). No beautify or face-enhance node is ever sent.
- If a job hangs or the machine goes off, the Studio takes it back after 90
  seconds of silence and runs it once more; a second loss goes to its Failed
  list. Out-of-memory errors retry once at batch size 1. Every job has a hard
  timeout (15 min for stills, 40 to 50 min for video, 4 h for training).

## Logs

```
docker logs -f studio-comfy
```

The agent prints one line per job (started, done or failed and why).
