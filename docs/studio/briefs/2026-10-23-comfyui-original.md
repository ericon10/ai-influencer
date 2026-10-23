# CC build: ComfyUI provider (sent Oct 22 night)

Written Oct 22, 2026. Sent to CC the night of Oct 22 after CC said it had no brief (it was saved but never pasted). The sent version is self-contained (no spec attachment), adds Kie.ai and WaveSpeed to the engine lever and extends config/engines.yaml. The original text is kept below. Runs on Eric's friend's high-end workstation through a private tunnel. Attach claude/character-system-comfyui-spec.md.

Scope: ComfyUI as one more provider; workflows as API JSON with manifests (Qwen-Image-Edit-2511 still/edit, Wan 2.2 I2V, Wan 2.2 Animate recreate); per-character LoRA training from refs; our rules enforced inside the pipeline (21+, non-explicit lint, adult check, AI label, realism block); every job waits for Eric's click; offline fallback never silent; owner's work not blocked; first job is the Callie bake-off vs Nano Banana in Review; docs/COMFY.md setup guide for the machine owner.

Full message:

```
UX-PLAN.md first. Then CLAUDE.md. Read
claude/character-system-comfyui-spec.md
(Eric will paste it). One build.

BUILD: COMFYUI PROVIDER
Goal: the Studio sends stills, edits and
video jobs to ComfyUI on a powerful
remote machine (a friend's workstation),
as one more provider next to Higgsfield
and Google. Build for full-size models;
no low-VRAM workarounds.

CONNECTION
1. Settings > Providers > ComfyUI: base
   URL plus access token (dashboard only,
   never in repo). Reach it through a
   private tunnel (Cloudflare Tunnel or
   Tailscale), never an open port.
2. Status card: online/offline, GPU name
   and VRAM, queue length, models found.
   "Test connection" button.
3. Talks to the ComfyUI API: upload
   images, queue prompt, websocket
   progress, fetch outputs to R2.

ENGINE (built the way pro ComfyUI shops
run it)
E1. Gateway and queue: the Studio's
    Railway worker is the gateway. It
    validates each job, puts it on a
    persistent queue and returns a job
    ID. A small agent on the GPU machine
    pulls jobs; the machine never takes
    calls from the app directly.
E2. Jobs are never lost: a claimed job
    that goes quiet past its timeout is
    reclaimed and retried once; after
    that it lands in a Failed list Eric
    can see and retry. Every job has an
    idempotency key (row_id + step +
    attempt) so a retry never double
    charges or double posts.
E3. Frozen environment: a pinned Docker
    image (ComfyUI commit, every custom
    node at a commit hash, Python
    packages, CUDA) plus a model
    manifest with file names and
    checksums, all in /comfy/env. The
    agent reports its environment hash;
    the Studio refuses jobs if it does
    not match the expected one and says
    why. Upgrades are a new version,
    tested, then switched.
E4. Group jobs by model: the scheduler
    runs all jobs for one model family
    before switching (Krea 2, then Qwen,
    then Wan) to avoid reloading models.
    Models stay on local disk, never
    downloaded at job time. The agent
    reports ready only after the model
    has loaded.
E5. Recipe log: every output stores the
    workflow version, model and LoRA
    versions, seed, prompt and refs.
    "Remake exactly" on any post.
E6. Crash handling: the agent restarts
    itself; out-of-memory errors retry
    once at a smaller batch size; stuck
    jobs are killed at a hard timeout.
E7. Health and numbers: queue depth, GPU
    use, VRAM, average time per job type
    and failure rate on the ComfyUI
    status card, plus an alert in the
    Studio when the machine goes
    offline mid-batch.

WORKFLOWS
4. Workflows live as API-format JSON in
   /comfy/workflows, each with a small
   manifest: name, step type (still,
   edit, i2v, recreate), inputs (prompt,
   ref images, seed, LoRA, strength,
   size, frames) and outputs. The Studio
   maps a step's inputs to the manifest.
   Eric can upload a new workflow in
   Settings without a rebuild.
5. Ship these first, per the spec:
   a. Still/edit: Qwen-Image-Edit-2511
      with the character's LoRA plus ref
      images.
   b. Image-to-video: Wan 2.2 I2V.
   c. Recreate: Wan 2.2 Animate (replace
      and mix modes).
   d. Still: Krea 2 Turbo (the machine
      owner already runs it) with the
      character's LoRA trained on Krea 2
      Raw. Text-to-image only, so the
      face comes from the LoRA. Mark it
      "license check" until Eric confirms
      commercial use is allowed.

CHARACTER LORAS
6. "Train LoRA" on any person character:
   pick the base (Qwen-Image-Edit or
   Krea 2 Raw), uses REF-00 to REF-11 (plus REF-12/13
   when present) and any approved stills
   Eric ticks. Runs on the remote
   machine. Shows estimated time. Saves
   the LoRA with a version and trigger
   word on the character. Retrain makes
   v2; old versions stay selectable.
7. Faceless characters skip LoRAs.

RULES INSIDE THE PIPELINE
8. No outside filters here, so the
   Studio enforces ours on every
   ComfyUI job: 21+ only, non-explicit
   (prompt lint blocks explicit words
   before queueing), the adult check on
   source clips stays, AI label on
   export. Realism block on person
   shots; never skin smoothing words.

COST AND SAFETY
9. Every job still waits for Eric's
   click. Show "$0 API, about N min on
   ComfyUI" instead of a price.
10. If the machine is offline, the step
    says so and offers the default
    provider with its price. Never
    switch silently.
11. Jobs are tagged and queued so the
    owner's own work on that machine is
    not blocked. A max-jobs-at-once
    setting in Settings.

FIRST JOB: CALLIE BAKE-OFF
12. "Compare providers": run 10 of
    Callie's real prompts on Nano Banana,
    Qwen-Image-Edit and Krea 2 Turbo (her
    LoRAs), side by
    side in Review, with face score vs
    REF-00 and a skin smoothness score.
    Eric picks per step which provider
    becomes the default. Nothing changes
    until he does.

SETUP GUIDE
13. Write docs/COMFY.md for the machine
    owner: run the pinned Docker image,
    model downloads with checksums,
    tunnel setup, agent token, how to
    pause the queue for his own work.
    Short, step by step.

SHARED OUTPUT FORMAT
14. The machine owner runs the same
    posting software. Drive output from
    the Weeks build (folder layout plus
    manifest with Device ID and Account
    first) is a documented format in
    docs/DRIVE-OUTPUT.md, and nothing in
    it is tied to Eric: each install
    (Eric's, or the owner's fork) sets
    its own Drive root, accounts and
    devices in Settings. Same files, same
    manifest, either install.

ENGINE LEVER
15. One switch at the top of Settings and
    on the Weeks page: Engine =
    Higgsfield subscription, Higgsfield
    API, or ComfyUI (Google and others
    stay as per-step options). Pick one
    and the plumbing follows:
    a. A mapping table says which model
       each step uses on each engine
       (still, edit, i2v, recreate, face
       pass, LoRA). Editable in Settings.
    b. Prices switch to that engine's
       units (plan credits, dollars, or
       minutes on the machine).
    c. A step the engine can't do shows
       why and offers the closest engine
       with its price. Never silent.
    d. Override per character and per
       step (for example ComfyUI stills,
       Higgsfield video).
    e. The engine used is saved in each
       post's recipe log.

FINISH
Tests pass (mock ComfyUI server for CI,
including a killed job that is reclaimed,
a retry that does not double charge and
an environment mismatch refusal; plus one
real job if the machine is reachable). Push. Confirm the deploy is
READY and the version. Update the guide
and help buttons. Report item by item
with screenshots from production.
```
