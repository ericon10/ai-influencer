# BUILD: wire Kie.ai and WaveSpeed (owner, 2026-10-23)

UX-PLAN.md first. Read docs/studio/research-wavespeed-kie.md. One build.

Eric picked both by name (Oct 22). Higgsfield stays the default for every
model it supports until Eric changes it.

1. Settings > Provider keys: Kie.ai and WaveSpeed keys (dashboard only).
   Each with "Test key" and its balance if the API reports one.
2. Adapters for every model in the research doc that we use: Seedream 4.5
   edit, Nano Banana, Kling, Wan Animate, Seedance. Reference images
   passed where the model takes them. Async jobs: submit, poll or
   webhook, fetch output to R2, same as our other providers.
3. Price book: real per-image and per-second prices from each provider,
   with the date checked. Every button shows the price for the provider
   picked.
4. Provider picker on each step (still, edit, video, recreate) lists
   every provider that can run that model, with its price side by side,
   cheapest marked. Per character and per step overrides. Weeks "Make the
   week" can pick a provider for the whole run.
5. Failures: if a provider errors or refuses, the job says why and offers
   the next provider with its price. Never switch or spend silently.
6. Recipe log saves the provider on every output.
7. Keep this ready for the engine lever in the ComfyUI build: providers
   plug into one table of step > model > provider.

FINISH: tests pass (mocked APIs plus key tests). After Eric adds keys and
clicks, one real still on each provider to confirm the real charge
matches the price book. Push. Confirm the deploy is READY and the
version. Update the guide and help buttons. Report item by item with real
prices and screenshots from production.
