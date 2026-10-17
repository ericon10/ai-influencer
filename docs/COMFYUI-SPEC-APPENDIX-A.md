# Appendix A: What the Character Studio does, as built

Companion to `character-system-comfyui-spec.md`. The spec describes the method; this appendix describes what the Studio's code does today, so a team running the same character system on ComfyUI with local models can match it.

## What changed since 3f7140a

The previous edition described commit `3f7140a` (2026-10-16). Since then:

- **Products** (DECISIONS G57, UX-PLAN.md section 29): every post belongs to one product or none (`content_items.product_id`, migration 0017). Every post is written to the general standard; a product can add its own rules on top (`products.writing`, `writing_standards` in `config/content.yaml`, the `sidestep_` templates). Whether a post is an ad is a separate switch (#ad, a plan row's `ad` column). A.5.4.
- **post.json version 2**: a `plan` section, `caption.cta_line`, "Ad:" first in `caption.as_posted`, each special slide's own fields, and a post.json for video posts too. Slideshows export TikTok only; the Instagram set is an option, off. A.2.
- **The launch plan CSV import** (`server/core/planImport.ts`, `server/pipeline/planImport.ts`): a free preview, drafts with every word as written, a `product` (a name) and an `ad` column, and Generate N posts ten at a time through the job runner's new queue groups. A.6.2, A.7.2.
- **The language lint** (`server/core/copyLint.ts`): 13 free warning checks plus `structure-repeat`, all defaults. The dash check runs on every post; the rest only on posts whose product's rules turn them on. A.4.10.
- **Nine more special slides** drawn by code and the **Product screenshot** (the owner's upload only). A.2.2.
- **The writers** (G56): Write 10 with Claude gives each hook a moment, an alt hook and a rank (plus effects, a structure code, a pain score and a separate reviewer under SideStep's rules); Use this hook writes a CTA line; hooks are no longer cut at 14 words (30 is a cap against runaway answers). A.5.4, A.6.4.
- **Character files**: template v1.6's `## Models (UNIVERSAL defaults, ...)` section is read for models now. A.1.4.
- **Prompt text**: the moment and the setting start their sentences with a capital letter, a topic still's light sentence ends with one period, the end frame names the character's own skin marks, the motion prompt says sound off once, and a topic still may show text on a screen or paper when the shot quotes it. A.5.3.
- **Checks**: `neutral-body-cups` and the card check no longer match "A cup" or a cup "of" something; the batch CSV import's run route answers 400 on a bad body; `slideshow.batch_max` is capped at 10. A.4.5, A.6.1, A.6.4.
- **A.8**: eight of the nine gaps the last edition listed were fixed in `7c07140`; post.json for video posts came in `c377d91`, batches still have none. New gaps are listed in A.8.2.

Today's cleanup build (2026-10-17) added:

- **The slide image model** (G58, UX-PLAN section 30, `ed620c8`): the stills path (Your Higgsfield plan or the Higgsfield API) is the pick; each slide's model follows who is in it (the character file's stills default, or the cheapest model the path runs for a slide with no one), and every slideshow and plan still is billed to the picked path. A.5.2, A.5.3, A.6.2, A.7.5.
- **Results** (G60, UX-PLAN section 32, `c23ac34`): a post's results typed on its card or pasted from a CSV; post.json gains a `results` key. A.2, A.6.6.
- **The daily spend cap** (G59, UX-PLAN section 31, `ec22ba7`): $10 a day by default (UTC), plan credits counted at the API rate; a queued group over the cap waits. How to read, A.7.2.
- **Download day** (G61, UX-PLAN section 33, `00ae32b`): one zip of a day's approved posts in posting order, with `checklist.txt` and `left-out.txt`; post.json there also has a `posting` block. A.2.6.

## How to read this appendix

- **Source.** This appendix covers production as of today's cleanup build (2026-10-17). It was read from the `character-studio` branch at commit `b53f108` (2026-10-17: the Products feature merged at `bdda34a` and the slide image model, `ed620c8`), plus the cleanup build's three commits read with `git show` on their own branches: `c23ac34` Results, `ec22ba7` the daily spend cap and `00ae32b` Download day. Paths are relative to the repository root. Where a sample was produced by running the Studio's own functions on fake input in a scratch copy, it says so; samples carried over from the 3f7140a edition say that their code did not change since.
- **Not built.** When something asked about does not exist in the code, this appendix says **Not built** and does not describe a design for it.
- **Placeholders.** Every name, ID, handle and key in the samples is fake (`Ada Sample`, `Pan Club`, `Sample Kit`, accounts `ada.cooks` and `F1`, plan rows `R001` to `R004`, `00000000-0000-4000-8000-000000000000`, `VOICEIDPLACEHOLDER0001`, `cnt_SAMPLEPOST000001`). No keys, environment values, database addresses or private links appear here. Environment settings are named, never given values. SideStep is the owner's product whose rules are the one writing standard in `config/content.yaml` (key `sidestep`); it is named where the code and config name it, never in a sample (the samples give those rules to the fake `Sample Kit`).
- **Fixed and default.** The Studio sorts every rule into two buckets (`config/rules.yaml`, `bucket:`). **Fixed** rules can stop a run and cannot be switched off (the realism principle, bare face on hero and sheet, 21 or older, no nudity, a new person never a copy, AI labeling, a price before every paid run, budget caps (per run, per calendar day in UTC, per calendar month, per character), keys server-side). **Default** rules are pre-filled, can be switched off per account or per character in Settings > Rules, and at most warn.
- **Money.** Every paid call needs a quote the owner has seen. Prices are in the price book (`config/pricebook.yaml`); amounts inside the code are micro-dollars.
- **IDs.** Records use prefixed, time-sortable IDs: `chr_` character, `cnt_` post, `cand_` still or take, `ast_` file, `job_` job, `qte_` quote, `scn_` scene, `ssc_` saved slideshow scene, `prd_` product, `que_` a run's queue (Generate N posts).

## Contents

- A.1 Character import format
- A.2 post.json and the export zip
- A.3 Face gates
- A.4 Other checks as built
- A.5 Prompt assembly
- A.6 Batch and plan import
- A.7 Provider interface
- A.8 Gaps found while writing this appendix

---

## A.1 Character import format

### A.1.1 Where a character file comes in

| Entry point | What it does | Cost |
|---|---|---|
| Characters page, **Import a character file** (and the character page's File step, **Import edits**) | Opens the Import dialog | Free |
| `POST /api/v1/characters/import/check` body `{ "markdown": string }` (1 to 500,000 characters) | Runs the template check (A.1.5) and looks for a character of the same name. Returns `{ report, name, match }` where `match` is `{ id, name }` or `null` | Free |
| `POST /api/v1/characters/import` | Creates a character from the file (201), or updates the character named in `characterId` (200). Returns `{ characterId, updated, importedShots, unchangedShots, checkShots, checkJobId, warnings }` | Free |
| `POST /api/v1/characters/:id/import-file` | Applies a file, sheet images, or both to an existing character. Returns `{ warnings, importedShots, checkShots, checkJobId, view }` | Free |

Both import routes take either:

- **multipart/form-data**: field `file` (the `.md`) and field `images` (any number of image files). Each file must be 25 MB or less.
- **application/json**: `{ "markdown": string (max 500,000), "uploads": [{ "uploadId": string, "name": string (max 300), "type": string (max 100, optional) }] (max 40), "characterId": "chr_..." (optional) }`. `uploads` are files already sent to the Studio's direct-upload slots.

Code: `server/api/app.ts` (`fileBundle`, `sheetImagesFrom`, the three routes), `server/pipeline/files.ts` (`importCharacter`, `attachSheetImages`, `attachCheckImages`, `mergeReimport`), `server/pipeline/brand.ts` (`importCheck`).

**Sheet image file names.** `sheetRefOf` in `server/storage/uploads.ts` reads the REF number from the file name with `/REF[\s_-]*(\d{1,2})(?!\d)/` (case-insensitive, extension ignored). Numbers 0 to 11 map to `REF-00` to `REF-11`; `REF-00.png`, `REF 00.jpg` and `ref_3.webp` all work. Anything else is ignored.

- A name that also contains `MIRROR` (for example `REF-04-MIRRORED.png`) is stored as an image "to check" beside that shot. It is never approved and never enters the sheet.
- Every other matching image becomes the **approved** image for that shot. If its SHA-256 equals the approved image already there, it is skipped (`unchangedShots`). If it replaces one, the old one is marked `superseded` and every shot built from it is marked stale for re-check.
- After an import with images, a free local job (`import_check`) runs on the worker: a face match against REF-00 and the skin texture check for each new image (A.3, A.4.9). Results attach to the shot; nothing is un-approved.

### A.1.2 Two file shapes

`importCharacterFile(md, { models })` in `server/core/characterFile.ts` decides by the first bytes:

1. **Studio header file.** The file starts with a front-matter block (`---` line, content, `---` line). The block is parsed as YAML (YAML 1.2 also reads plain JSON) and validated with the zod schema `frontSchema`. This is what the Studio itself exports (`GET /api/v1/characters/:id/export`, file name `character-<slug>.md`).
2. **Hand-written file** (no front matter). `importFreeform` reads it section by section. This is how files built in the Claude project with character template v1.6 (`docs/character-template.md`, Part B) come in.

Sections are split on `## ` headings only (`###` is not a split), and headings inside code fences are ignored (`splitSections`). Section titles are matched case-insensitively after removing everything that is not a letter or space, so `## Models (UNIVERSAL ...)` normalizes to `models universal ...` (see A.1.4).

### A.1.3 Studio header fields

| Field | Type | Required | Default | What the importer does |
|---|---|---|---|---|
| `studio` | `"character-studio"` | optional | none | Marker only |
| `format` | number | optional | none | Exports write `1` |
| `name` | string | **required** | none | The only required field. Missing: the import fails with a zod error on `name` |
| `age` | number or `null` | optional | `null` | Stored. Not checked on a new import (see A.1.6) |
| `eyes` | string | optional | `""` | |
| `card` | string | optional | `""` | Replaced by the `## Card` section text when that section exists (lines joined, spaces collapsed) |
| `body` | string | optional | `""` | Replaced by the `## Body` section when present |
| `marks` | array of mark | optional | `[]` | See mark object below. The `## Distinguishing marks` section is ignored in this shape (it is regenerated from `marks` on export) |
| `marks[].name` | string, min 1 | yes, per mark | | For example `mole` |
| `marks[].description` | string, min 1 | yes, per mark | | For example `small mole` |
| `marks[].side` | `"LEFT"` or `"RIGHT"` | yes, per mark | | Always the character's own left or right |
| `marks[].region` | one of `brow`, `eye`, `cheek`, `ear`, `lip`, `jaw`, `neck`, `nose`, `temple`, `forehead`, `chin` | yes, per mark | | |
| `marks[].kind` | `"skin"` or `"jewelry"` | yes, per mark | | |
| `marks[].subtle` | boolean | optional | `true` | |
| `pronouns` | `{ subj, obj, poss, noun }` strings | optional | `she`, `her`, `her`, `woman` | Used in every prompt template (`{subj}`, `{poss}` ...) |
| `makeup` | `{ default: string, glam_when: string[], glam?: string }` | optional | `{ default: "natural", glam_when: [] }` | The `## Makeup` section is ignored in this shape |
| `style` | object, any keys | optional | `{}` | The Studio reads `ideas`, `hair_options`, `notes`, `palette`, `pieces`, `accessories` (string arrays, `notes` a string). Suggestions only: style never goes into a prompt (each scene names its own outfit) |
| `persona` | object, any keys | optional | `{}` | The Studio reads `vibe` (string), `settings` (string[]), `never` (string[]), `defaults` (string), `voice` (voice card, below) |
| `persona.voice` | object | optional | | Keys: `elevenlabsId`, `who`, `talks`, `uses` (string[]), `never` (string[]), `emoji`, `humor`, `pov`, `pillars` (string[]), `example`. The slideshow writers put it in every prompt as the character's voice card (A.5.4) |
| `avoid_models` | string[] | optional | `[]` | Model refs such as `higgsfield/soul-2` |
| `preferred_models` | object string to string | optional | `{}` | Keys the Studio sets: `scene_still`, `scene_still_alt`, `edit`, `video_final`, `video_test`, `sheet`. A `sheet` value on a **new** import also sets the sheet lock (model plus the sheet quality and resolution from `config/sheet.yaml`) |
| `identities` | array | optional | `[]` | Saved provider identities: `{ provider: string, kind: "element" or "trained", name: string, externalId: string, status: "ready" or "queued" or "failed", model?: string, promptBlock?: string, followUp?: { name, model?, text }, notes?: string }` |
| `realism` | `{ block?: string, avoid?: string, notes?: string[] }` | optional | `{}` | `block` and `avoid` replace the Studio's default REALISM and AVOID blocks in every image prompt (A.5) |
| `disclosure` | string | optional | `"Label all posts as AI-generated"` | Copied into `post.json` as `ai_label` |
| `notes` | string | optional | `""` | Replaced by the `## Notes` section when present (`(none)` reads as empty) |
| `sheet` | array of `{ id, label, status, checksum: string or null }` | optional | | Read and returned, but **not applied**: sheet images only come from REF files (A.1.1) |

Every other `## ` section is kept word for word in the record's `sections` list (`{ title, body }`), except a generated `Reference sheet` or `Sheet status` table, which is rebuilt on export.

### A.1.4 Hand-written file: what is read from each section

| Section title (after normalizing) | Read into | How |
|---|---|---|
| `# Character: Name` or `# Name` (the first `#` heading) | `name` | `Character:` is stripped. No heading: `Imported character` |
| `Card` or `Character card` (or a line `Card: ...` anywhere) | `card`, `age`, `eyes`, `body` | Sentences starting `Distinguishing mark(s):`, `Marks:`, `Signature style:` or `Style:` are moved out. A leading `Name, ` is removed. Age: the first `NN years old` or `NN y/o`, else the first two-digit number in the card, else `age NN` anywhere. Eyes: the one or two words before `eyes` |
| `Body` | `body` | Else the card sentence with build, figure, frame or physique |
| Any title ending in `mark` or `marks` | `marks` | Per line: needs `left` or `right` and a region word (`brow`, `eyebrow`, `eye`, `cheek`, `ear`, `lip`, `jaw`, `neck`, `nose`, `temple`, `forehead`, `chin`). Jewelry words (`cuff`, `stud`, `hoop`, `ring`, `earring`, `piercing`, `chain`, `jewel`) make it a style idea, not a mark. No marks section: the whole file is scanned |
| `Style`, `Signature style`, or a title ending in `style` | `style`, `makeup` | Bullets `Key: value`. Key contains `palette` or `colors`: `style.palette` (comma list). `pieces`, `staples`, `wardrobe`: `style.pieces`. `idea`, `suggest`, `starting`: `style.ideas`. `accessor`: `style.accessories` (semicolon list). `hair`: `style.hair_options`. `groom`: `makeup.default`, and `Dressed-up version: <look> for <a>, <b> and <c>` sets `makeup.glam` and `makeup.glam_when` (snake_case). `makeup`: `<x> by default` and `glam ... for ...`. Anything else: `style.notes` |
| `Persona` or `Personality` | `persona` | Key contains `default`: `defaults`. `vibe` or `personality`: `vibe`. `setting`, `places`, `locations`: `settings` (list). Starts with `never`, `avoid`, `don`: `never` (list) |
| `Voice` and `Voice card` (both read) | `persona.voice` | `parseVoiceSection` (`server/core/voiceCard.ts`). Key `eleven`, `voice id`, `voice_id` (or `voice_id XXXX` inside a sentence, 12 to 40 letters and digits): `elevenlabsId`. `who`, `pov`, `talk`/`tone`/`speaks` (quoted phrases also go to `uses`), `uses`/`words`/`says`/`phrases`, `humor`, `emoji`, `never`/`avoid`/`don`, `pillar`/`topics`/`posts about`, `example`. Keys starting `spare` are skipped |
| `Disclosure` | `disclosure` | |
| A title whose first word is `Models` or `Model`: `Models`, `Model notes`, template v1.6's `Models (UNIVERSAL defaults, update as tests change)` (pattern `/^models?\b/` on the normalized title; changed in `7c07140`) | `identities`, `preferred_models`, `avoid_models` | A line with a UUID and `element`, `identity`, `character` or `soul_id` becomes an identity. Model names are matched against each model's `label` and `aliases` in `config/models.yaml` (longest name wins). Key words: `avoid` to `avoid_models`. A key with `video`: plus `final` to `video_final`, plus `test`/`cheap`/`motion` to `video_test`; with neither, each comma clause of the value is read on its own, a clause with `final(s)` setting `video_final` and one with `cheap...` or `test(s)` setting `video_test` (template v1.6: "Video from stills: Seedance 2.5 for finals, Kling 3.0 Pro as the cheaper default."); a video line is never read as a still model. `still`/`scene`/`image` to `scene_still`; `edit` to `edit`; `also`/`alternat`/`second` adds `_alt`. A key with `sheet` (template v1.6: "Hero and sheet: GPT Image 2.5 Flare, High, 2K."), or a bullet with no key that says `sheet`, to `sheet`. Keys `drift lock` or `follow-up` attach a follow-up pass to the identity whose model they name. Lines with no model name or no matching key (for example "Motion from a real clip: choose per clip") are skipped |
| `Saved identity` | `identities` | Each line with a UUID: an Element if it says `element`, else a trained identity, status `ready` |
| `Fixed blocks` or `Prompt blocks` | `realism`, identity `promptBlock` | `REALISM: ...` to `realism.block`, `AVOID: ...` to `realism.avoid`, `<WORD> IDENTITY: ...` to the matching identity's `promptBlock` |
| Any title starting with `Realism` | `realism` | Bullets keyed `REALISM`, `Realism block` or `Block` set `realism.block`; `AVOID` sets `realism.avoid` (these win over Fixed blocks). Other lines and the lead paragraph become `realism.notes` |
| `Notes` | `notes` | |
| (whole file) | `pronouns` | Counts she/her/hers, he/him/his, they/them/their; the most common wins, she by default |

Every section the importer does not consume is kept as written in `sections`. Several are read later from there:

- **Brand layer** (`readBrand`, `server/core/brand.ts`): `## Brand` bullets `Interest`, `Sub-interest`, `Arc`, `Brand statement`; `## Why people watch` bullets `Series`, `Running bits`, `Cast` (lists split on `;` or `,`), `Payoff style`, `How they film` (or she, he); `## Accounts` (kept as text); `## Winning stack ...` and `## Growth log` (one bullet per item). A value still holding a template placeholder such as `[Name]` reads as empty.
- **Combo log** (`## Combo log ...`): read by the hair rotation and the variety note (A.4.6, A.4.8).
- **Scene rules**, **Video rules**, **Recipe** sections and the **Reference sheet** table are kept for people and for the template check; the prompt builders do not parse them.

Observed in a scratch run at `bdda34a`: a fake file with template v1.6's heading `## Models (UNIVERSAL defaults, update as tests change)` now gives `sheet`, `scene_still`, `scene_still_alt`, `edit`, `video_final`, `video_test` and `avoid_models` (the A.1.7 sample), and the section is still kept as text too. At `3f7140a` that heading was not read for models (A.8.1, item 1).

### A.1.5 The template check (`checkTemplate`, `server/core/templateCheck.ts`)

Template version `1.6`. Free, no Claude. It never blocks an import; with a needed item missing, the button reads "Import anyway". Unchanged since 3f7140a.

Needed items (`needed`, each `{ id, label, ok, detail }`):

| `id` | Passes when |
|---|---|
| `realism` | A section title starts with `realism` |
| `models` | A section title starts with `model` or `models` |
| `scene-rules` | A section title starts with `scene rules` |
| `video-rules` | A section title starts with `video rules` |
| `recipe-candid` | A title contains `recipe` and then `candid` or `caught you` |
| `recipe-recreate` | A title contains `recipe` and then `recreate` |
| `age` | The parsed age is 21 or more |
| `mark` | Exactly one non-jewelry mark parses (zero or two or more fail) |
| `refs` | A `Reference sheet` section labels all 12 of `REF-00` to `REF-11`, as table rows (`\| REF-03 \| Left profile \| ...`) or bullets (`- REF-03: ...`). A label that is only a `[placeholder]`, `link` or dashes does not count |
| `element` | Only when the file names a Higgsfield Element: passes when a UUID is on that line (or a saved Element identity exists) |

`missingOptional` lists, in template order, the optional sections not found: `Card` (first, if missing), `Brand`, `Why people watch`, `Style`, `Voice`, `Persona`, `Voice card`, `Fixed blocks`, `Build notes`, `Stress test`, `Identity fixes`, `Saved identity` (also satisfied by a `Saved identity:` line or any parsed identity), `Competitors`, `Accounts`, `Monetization`, `Winning stack`, `Growth log`, `Disclosure`, `Combo log`.

`brackets` lists sections whose title or body still holds a template placeholder (`[...]` of 2 to 120 characters, not a `[x]` checkbox, not a link). `complete` is true when every needed item passes.

### A.1.6 Rules applied on import

- **New import** (`createCharacter`): no validation. A file without an age imports; the fixed 21-or-older rule is enforced before every run instead (`adultProblem`, "Set an age first. Characters must be adults, 21 or older.").
- **Update** (`characterId` given, or the File step): `updateCharacter` runs `validateCharacter` and refuses with `invalid_request` when the age is missing or under 21, the card is empty, or a mark has no LEFT or RIGHT side. A card over 40 words or cup sizes and measurements in the card or body are warnings only. The cup-size pattern (`SIZE_TERMS`, `server/core/character.ts`) starts at `B` and skips a cup "of" something, so "A cup" and "a cup of tea" are not sizes (changed in `7c07140`).
- **Update merge** (`mergeReimport`): the file's words replace the character's words. Posts, takes, stills, clips and the sheet are separate records and stay. The combo log is merged (both logs, duplicates removed, sorted by date, newest `combo_window` kept; the Studio's entries survive). Saved identities the file leaves out are kept. The voice card and the REALISM block are kept when the file has none.
- Warnings are returned as plain sentences in `warnings` (for example "Jewelry is not a fixed mark, so it is kept as a style idea: ...", "No REALISM block in the file; every image prompt uses the Studio's default one.").

### A.1.7 Sample character (JSON, fake values)

This is the Studio header as JSON. Put it between two `---` lines at the top of a `.md` file and the importer reads it (YAML reads JSON). It was produced at `bdda34a` by running a fake hand-written file in the template v1.6 shape (its models under `## Models (UNIVERSAL defaults, update as tests change)`, with the lines "Hero and sheet: GPT Image 2.5 Flare, High, 2K." and "Video from stills: Seedance 2.5 for finals, Kling 3.0 Pro as the cheaper default.") through `importCharacterFile` and `exportCharacterFile` in a scratch copy, then read back through `importCharacterFile` with the same header. The Element ID and voice ID are placeholders. `sections` are not in the header; they follow it as `## ` sections. Against the 3f7140a sample, `preferred_models.sheet` is new: the v1.6 Models section is read now.

```json
{
  "studio": "character-studio",
  "format": 1,
  "name": "Ada Sample",
  "age": 27,
  "eyes": "hazel",
  "card": "27 years old. Chin-length auburn hair, loose waves, side part. Hazel eyes, oval face, soft arched brows. Average, slim build.",
  "body": "Average, slim build",
  "marks": [
    { "name": "mole", "description": "small mole", "side": "LEFT", "region": "brow", "kind": "skin", "subtle": true }
  ],
  "pronouns": { "subj": "she", "obj": "her", "poss": "her", "noun": "woman" },
  "makeup": { "default": "natural", "glam_when": ["nights_out", "weddings"], "glam": "soft glam" },
  "style": {
    "ideas": ["denim", "oversized knits", "clogs"],
    "accessories": ["a hair clip", "small hoops"],
    "hair_options": ["low bun", "claw clip", "down and tucked behind one ear"]
  },
  "persona": {
    "vibe": "dry, warm, a little tired",
    "settings": ["small kitchen", "hospital parking lot", "corner store"],
    "defaults": "daytime look, real-moment feel",
    "never": ["brand names unless a brand deal"],
    "voice": {
      "elevenlabsId": "VOICEIDPLACEHOLDER0001",
      "who": "27, night-shift nurse, cooks to unwind",
      "pov": "every recipe is a small rescue",
      "talks": "\"okay hear me out\", \"no notes\"",
      "uses": ["okay hear me out", "no notes"],
      "humor": "deadpan",
      "emoji": "one per caption",
      "never": ["diet talk", "shaming"],
      "pillars": ["One Pan Monday (recipes)", "Fridge Clear-out (leftovers)"],
      "example": "Okay hear me out: rice, an egg, and spite."
    }
  },
  "avoid_models": ["higgsfield/soul-2"],
  "preferred_models": {
    "sheet": "higgsfield/gpt-image-2.5-flare",
    "scene_still": "higgsfield/gpt-image-2.5-flare",
    "scene_still_alt": "higgsfield/nano-banana-2.1",
    "edit": "higgsfield/gpt-image-2.5-flare",
    "video_final": "higgsfield/seedance-2.5",
    "video_test": "higgsfield/kling-3.0-pro"
  },
  "identities": [
    {
      "provider": "higgsfield",
      "kind": "element",
      "name": "Ada",
      "externalId": "00000000-0000-4000-8000-000000000000",
      "status": "ready",
      "notes": "00000000-0000-4000-8000-000000000000"
    }
  ],
  "realism": {
    "block": "REALISM: Candid phone photo, natural light. Real skin texture: visible pores, a few freckles, faint shine.",
    "avoid": "AVOID: studio lighting, plastic skin, airbrushed skin, beauty filter, text, watermarks.",
    "notes": ["Ada looks real because she is not perfect."]
  },
  "disclosure": "Label all posted content as AI-generated.",
  "notes": "",
  "sheet": [
    { "id": "REF-00", "label": "Front, close-up", "status": "approved", "checksum": null },
    { "id": "REF-01", "label": "Left side, three-quarter", "status": "approved", "checksum": null },
    { "id": "REF-02", "label": "Right side, three-quarter", "status": "approved", "checksum": null },
    { "id": "REF-03", "label": "Left side, profile", "status": "approved", "checksum": null },
    { "id": "REF-04", "label": "Right side, profile", "status": "approved", "checksum": null },
    { "id": "REF-05", "label": "Back of head", "status": "approved", "checksum": null },
    { "id": "REF-06", "label": "Full body, front", "status": "approved", "checksum": null },
    { "id": "REF-07", "label": "Full body, side", "status": "approved", "checksum": null },
    { "id": "REF-08", "label": "Full body, back", "status": "approved", "checksum": null },
    { "id": "REF-09", "label": "Open smile, close-up", "status": "approved", "checksum": null },
    { "id": "REF-10", "label": "Laughing, three-quarter", "status": "approved", "checksum": null },
    { "id": "REF-11", "label": "Serious, looking down", "status": "approved", "checksum": null }
  ]
}
```

The `card` starts with "27 years old." because the importer removed the leading "Ada Sample, " from the hand-written card. The REF labels are the shot labels in `config/sheet.yaml`.

---

## A.2 post.json and the export zip

### A.2.1 What is built

- **Slideshows**: built. Export images (free, on the worker) writes one zip with the TikTok set, `caption.txt` and `post.json`; the Instagram set (1080 x 1440) goes in only when the post asks for it (**Also make the Instagram set**, Finish step, `spec.instagramSet`, off by default since writing standard v1.2). The post.json is also saved on its own (`outputs.jsonAssetId`). The mapping lives only in `postExportJson` (`server/core/postExport.ts`); the caller is `renderSlideshow` in `server/pipeline/slideshow.ts`.
- **Video posts**: built since `c377d91`. The render job's `meme` branch (`runContentRender`, `server/pipeline/content.ts`) writes `videoPostExportJson` (`server/core/postExport.ts`) as its own asset next to the MP4 (`outputs.videoAssetId`, `outputs.jsonAssetId`). The Finish step offers **Download MP4** and **post.json**. There is no zip.
- **Batches of video posts**: still no post.json. The download is a zip (or zip parts) of MP4s plus `captions.txt` (A.2.6).
- `POST_EXPORT_VERSION` is `2` (version 2 added the `plan` section, `caption.cta_line` and the video post.json). The keys added since are new keys only, so the version stays 2: `results` (`c23ac34`, every post.json) and `posting` (`00ae32b`, only in a Download day zip). The file comment still says "The posting engine's format is coming later".
- **Results** (`c23ac34`, G60): `results` is written when the post is exported, from `spec.results` (`resultsSchema`, `server/core/results.ts`), and is `null` until any field is typed. Typing results does not write a new post.json; the next export does, and a Download day zip always writes the current results.
- **Download day** (`00ae32b`, G61): one zip of a day's approved posts (A.2.6), each with its slides or MP4, `caption.txt` and its post.json plus `results` and `posting`.
- The post's product (`content_items.product_id`) is not written to either file (A.8.2, item 1).

### A.2.2 Schema of a slideshow's post.json (`postExportJson` output)

| Path | Type | Source |
|---|---|---|
| `format` | `"character-studio.post"` | constant |
| `version` | number, `2` | `POST_EXPORT_VERSION` |
| `exported_at` | ISO 8601 string | export time |
| `post.id` | string (`cnt_...`) | the post |
| `post.kind` | string: `"slideshow"` (the post kinds are `meme` for a video post, `slideshow`, `batch`) | |
| `post.title` | string | a plan draft's title is `<row_id>: <hook>` (A.6.2) |
| `post.idea` | string | the Idea step text (a plan draft: the row's `moment`) |
| `post.account` | string or `null` | account tag, `null` when empty |
| `post.character` | `{ id: string, name: string or null }` or `null` | `null` when the post has no character. A topic post is filed under a character for storage, and that character is written here (A.8.2, item 2) |
| `post.variation_of` | string or `null` | parent post id for a variation |
| `post.batch_of` | string or `null` | parent post id for a batch row |
| `post.created_at`, `post.updated_at` | ISO 8601 strings | |
| `slideshow.photos_of` | `"character"` or `"topic"` | who is in the photos |
| `slideshow.hook` | string | slide 1 text |
| `slideshow.hook_pattern` | `{ id, label }` or `null` | ids: `doubt`, `pov`, `nobody_tells`, `red_flags`, `listicle`, `storytime`, `myth_fact`, `tier_list`. A plan draft has `null` |
| `slideshow.text_style` | `"classic"`, `"box"`, `"minimal"` or `"note"` | |
| `slideshow.made_for` | `"tiktok"` or `"instagram"` | the shape the stills were generated in (9:16 or 3:4). The Stills step no longer offers 3:4; an older 3:4 post keeps it |
| `slideshow.scene.place` | string | the locked scene (a plan draft: the scene's words before the first "Slide N:") |
| `slideshow.scene.light` | string | a light preset id from `config/scenes.yaml` (for example `window`) or empty |
| `slideshow.scene.camera` | string | a camera preset id (for example `friend_phone`) or empty |
| `slideshow.scene.phone` | `""`, `"front"` or `"rear"` | |
| `slideshow.scene.outfit` | string | character mode only |
| `slideshow.scene.details` | string[] (max 2) | |
| `slideshow.scene.saved_scene_id` | string or `null` | Scene library id |
| `slideshow.cta.kind` | `"part2"`, `"save"`, `"handle"`, `"comment"`, `"page"`, `"own"` or `"none"` | Use this hook and a plan draft set `own` (the last slide as written) |
| `slideshow.cta.handle` | string or `null` | |
| `slideshow.cta.word` | string or `null` | |
| `slideshow.cta.text` | string or `null` | from `ctaText`; `null` for `own` and `none` |
| `caption.text` | string | the caption as written |
| `caption.hashtags` | string[] | at most 5 (`config/content.yaml`, `slideshow.hashtags: [3, 5]`); a Claude draft's are lower case with no `ad` tag, a plan row's are as written (without `#`) |
| `caption.ad` | boolean | `isProductPost`: #ad on, or a plan row with `ad` yes whose draft did not answer `product_ending: "none"` (A.5.4) |
| `caption.cta_line` | string or `null` | the CTA line (a question, a warm offer or a shrug): Use this hook's `cta`, or a plan row's `cta` column |
| `caption.as_posted` | string | what to paste (`postCaption`): `Ad: ` first on an ad (unless the caption already starts with `Ad:` or `#ad`), then the caption, a blank line, the CTA line when the caption does not already hold it, a blank line, at most 5 hashtags with `#` |
| `caption.file` | `"caption.txt"` | |
| `plan` | object or `null` | `planJson`: `null` unless the post has a plan row id, a structure, a moment or an alt hook (a plan draft, a Claude hook card used with Use this hook, or a variation, whose alt hook is its source's hook). Fields below |
| `plan.row_id`, `plan.plan_id`, `plan.date`, `plan.slot`, `plan.format`, `plan.tension`, `plan.pillar`, `plan.audience` | string or `null` | the plan row's columns as written (`plan_id` is `plan-<earliest date in the file>`) |
| `plan.product` | boolean | the row's **ad** switch, under the plan's older column name: `ad` yes, or an older file's `product` yes (A.6.2). Not the post's product |
| `plan.mention_mother` | boolean | |
| `plan.structure` | `{ code, name }` or `null` | `S1` to `S12`, `L13` to `L25` with their names (`server/core/playbook.ts`) |
| `plan.effect_open`, `plan.effect_payoff` | `{ code, name }` or `null` | `E1` to `E8` |
| `plan.hook_score` | number 1 to 5 or `null` | |
| `plan.moment_id`, `plan.moment`, `plan.alt_hook`, `plan.scene`, `plan.clip_action`, `plan.cta`, `plan.stat_source`, `plan.notes` | string or `null` | as written; an empty value is `null` |
| `results` | object or `null` | `resultsJson` (`c23ac34`): `null` until any field is typed (on the post's card, in Finish, or from the results CSV, A.6.6). The numbers are the first 72 hours. Never copied to a copy, a variation or a batch row |
| `results.post_url` | string or `null` | as typed, never fetched |
| `results.posted_at` | string or `null` | `YYYY-MM-DDTHH:MM`, or `YYYY-MM-DD` when only the day is known; read from many forms (`readPostedAt`), a time zone dropped and the time kept as written |
| `results.views_72h`, `results.follows_72h`, `results.saves_72h`, `results.shares_72h` | number or `null` | read from `12.4K`, `1,203`, `1.2M` (`readCount`) |
| `results.decision` | `"variations"`, `"keep"`, `"retry"`, `"drop"` or `null` | the owner's (Make 3 variations, Keep, One more try, Drop); the hints from `config/content.yaml` `results` only suggest one |
| `results.notes` | string or `null` | |
| `results.updated_at` | ISO 8601 string or `null` | when the results were last typed or pasted |
| `posting` | object, only in a Download day zip | `{ date, slot, slot_time, folder, approved_at, pack_id, packed_at, ai_label: "on" }` (`00ae32b`, A.2.6) |
| `slides[].number` | number, 1-based | |
| `slides[].text` | string | |
| `slides[].shot` | string or `null` | what the photo shows inside the locked scene |
| `slides[].picture` | `"still"`, `"special"` or `"none"` | |
| `slides[].still_id` | string (`cand_...`) or `null` | |
| `slides[].special` | object or `null` | a drawn screen: `{ type, from, title, body, lines: string[], time }` plus `variant` when set, `score` on a survey (the picked 0 to 10, or `null`), `count` when not 0 (a form's field count), `blur: true` when amounts are blurred. A product screenshot: `{ type: "product_shot", asset_id, width (0.2 to 1, its width on the slide), position: "top" or "middle" }`. Types: `notification`, `text_thread`, `rejection_email`, `job_posting`, and since 3f7140a `application_form`, `portal_status`, `calendar_invite`, `receipt`, `bank_app`, `museum_placard`, `survey`, `lock_screen`, `profile_card`, `product_shot` (the owner's upload only; the Studio never draws a product screen). Real brand names are replaced by generic names from `config/content.yaml` |
| `slides[].text_position` | `{ x: number 0..1, y: number 0..1 }` or `null` | where the words were dragged; `null` means the style's default place |
| `slides[].files` | `{ tiktok: string, instagram: string or null }` | paths inside the zip; `instagram` is `null` without the Instagram set |
| `files.tiktok`, `files.instagram` | string[] | in slide order; `instagram` is empty without the Instagram set |
| `files.caption` | `"caption.txt"` | |
| `sizes.tiktok` | `{ width: 1080, height: 1920 }` | `config/content.yaml` `canvas` |
| `sizes.instagram` | `{ width: 1080, height: 1440 }`, only with the Instagram set | `config/content.yaml` `slideshow.instagram` |
| `ai_label` | string | the character's `disclosure`, else `"Label all posts as AI-generated"` |

### A.2.3 Sample post.json for a slideshow (fake values)

Produced by calling the real `postExportJson` (as of `c23ac34`, with `results`) with fake input in a scratch run: the topic slideshow that the launch plan import drafts from row `R001` of the fake plan in A.6.2 (with **Draw mock screens by code** on), the plan fields as `metaOf` builds them (`server/pipeline/planImport.ts`; it is not exported, so its body was copied into the scratch script), stills filled in by Generate, and slide 1's words dragged. Slide 3 is a special slide (a lock screen drawn by code over the nearest slide's photo, blurred), so it has no `still_id`. The Instagram set was off. The row is not an ad and its CTA line is not in the caption, so `as_posted` adds it. It is a first export, so `results` is `null`.

```json
{
  "format": "character-studio.post",
  "version": 2,
  "exported_at": "2026-10-30T09:41:00.000Z",
  "post": {
    "id": "cnt_SAMPLEPOST000001",
    "kind": "slideshow",
    "title": "R001: i bought 14 meal prep containers in january. i have used 2",
    "idea": "Sunday 9:40pm, a fridge with one lemon and six sauces. The tell: last week's meal prep containers are still in the dishwasher.",
    "account": "F1",
    "character": {
      "id": "chr_SAMPLECHAR00001",
      "name": "Ada Sample"
    },
    "variation_of": null,
    "batch_of": null,
    "created_at": "2026-10-30T09:00:00.000Z",
    "updated_at": "2026-10-30T09:40:00.000Z"
  },
  "slideshow": {
    "photos_of": "topic",
    "hook": "i bought 14 meal prep containers in january. i have used 2",
    "hook_pattern": null,
    "text_style": "classic",
    "made_for": "tiktok",
    "scene": {
      "place": "A small apartment kitchen at night.",
      "light": "",
      "camera": "",
      "phone": "",
      "outfit": "",
      "details": [],
      "saved_scene_id": null
    },
    "cta": {
      "kind": "own",
      "handle": null,
      "word": null,
      "text": null
    }
  },
  "caption": {
    "text": "the containers are thriving. i am not",
    "hashtags": [
      "mealprep",
      "sundayreset",
      "kitchentok"
    ],
    "ad": false,
    "cta_line": "what is in your fridge right now?",
    "as_posted": "the containers are thriving. i am not\n\nwhat is in your fridge right now?\n\n#mealprep #sundayreset #kitchentok",
    "file": "caption.txt"
  },
  "plan": {
    "row_id": "R001",
    "plan_id": "plan-2026-11-02",
    "date": "2026-11-02",
    "slot": "AM",
    "format": "mock UI slideshow",
    "tension": "T2",
    "pillar": "P1",
    "audience": "A1",
    "product": false,
    "mention_mother": false,
    "structure": {
      "code": "S11",
      "name": "Contrast pair"
    },
    "effect_open": {
      "code": "E1",
      "name": "That's literally me"
    },
    "effect_payoff": {
      "code": "E4",
      "name": "LMAO"
    },
    "hook_score": 2,
    "moment_id": "F1-M01",
    "moment": "Sunday 9:40pm, a fridge with one lemon and six sauces. The tell: last week's meal prep containers are still in the dishwasher.",
    "alt_hook": "14 containers. 2 meals prepped. it is november",
    "scene": "A small apartment kitchen at night. Slide 1: a kitchen counter with a tall stack of empty plastic containers, warm lamp light. Slide 2: an open dishwasher full of containers. Slide 3: a lock screen notification reading 'Reminder' and 'meal prep Sunday' at 9:40 PM. Slide 4: a hand on an open fridge door. Slide 5: the fridge shelf with one lemon and six sauce bottles, no labels readable. Slide 6: the counter again, one container with a lid on. No brand names.",
    "clip_action": null,
    "cta": "what is in your fridge right now?",
    "stat_source": null,
    "notes": "Story details invented."
  },
  "results": null,
  "slides": [
    {
      "number": 1,
      "text": "i bought 14 meal prep containers in january. i have used 2",
      "shot": "a kitchen counter with a tall stack of empty plastic containers, warm lamp light.",
      "picture": "still",
      "still_id": "cand_SAMPLESTILL01",
      "special": null,
      "text_position": {
        "x": 0.5,
        "y": 0.28
      },
      "files": {
        "tiktok": "tiktok/01-r001-i-bought-14-meal-prep-containers-in.jpg",
        "instagram": null
      }
    },
    {
      "number": 2,
      "text": "they live in the dishwasher now. rent free",
      "shot": "an open dishwasher full of containers.",
      "picture": "still",
      "still_id": "cand_SAMPLESTILL02",
      "special": null,
      "text_position": null,
      "files": {
        "tiktok": "tiktok/02-r001-i-bought-14-meal-prep-containers-in.jpg",
        "instagram": null
      }
    },
    {
      "number": 3,
      "text": "my phone at 9:40pm: 'Reminder' 'meal prep Sunday'",
      "shot": "a lock screen notification reading 'Reminder' and 'meal prep Sunday' at 9:40 PM.",
      "picture": "special",
      "still_id": null,
      "special": {
        "type": "lock_screen",
        "from": "",
        "title": "",
        "body": "",
        "lines": [
          "Reminder",
          "meal prep Sunday"
        ],
        "time": "9:40 PM"
      },
      "text_position": null,
      "files": {
        "tiktok": "tiktok/03-r001-i-bought-14-meal-prep-containers-in.jpg",
        "instagram": null
      }
    },
    {
      "number": 4,
      "text": "so i opened the fridge to plan the week",
      "shot": "a hand on an open fridge door.",
      "picture": "still",
      "still_id": "cand_SAMPLESTILL04",
      "special": null,
      "text_position": null,
      "files": {
        "tiktok": "tiktok/04-r001-i-bought-14-meal-prep-containers-in.jpg",
        "instagram": null
      }
    },
    {
      "number": 5,
      "text": "one lemon. six sauces. zero plan",
      "shot": "the fridge shelf with one lemon and six sauce bottles, no labels readable.",
      "picture": "still",
      "still_id": "cand_SAMPLESTILL05",
      "special": null,
      "text_position": null,
      "files": {
        "tiktok": "tiktok/05-r001-i-bought-14-meal-prep-containers-in.jpg",
        "instagram": null
      }
    },
    {
      "number": 6,
      "text": "what is in your fridge right now? be honest",
      "shot": "the counter again, one container with a lid on. No brand names.",
      "picture": "still",
      "still_id": "cand_SAMPLESTILL06",
      "special": null,
      "text_position": null,
      "files": {
        "tiktok": "tiktok/06-r001-i-bought-14-meal-prep-containers-in.jpg",
        "instagram": null
      }
    }
  ],
  "files": {
    "tiktok": [
      "tiktok/01-r001-i-bought-14-meal-prep-containers-in.jpg",
      "tiktok/02-r001-i-bought-14-meal-prep-containers-in.jpg",
      "tiktok/03-r001-i-bought-14-meal-prep-containers-in.jpg",
      "tiktok/04-r001-i-bought-14-meal-prep-containers-in.jpg",
      "tiktok/05-r001-i-bought-14-meal-prep-containers-in.jpg",
      "tiktok/06-r001-i-bought-14-meal-prep-containers-in.jpg"
    ],
    "instagram": [],
    "caption": "caption.txt"
  },
  "sizes": {
    "tiktok": {
      "width": 1080,
      "height": 1920
    }
  },
  "ai_label": "Label all posted content as AI-generated."
}
```

### A.2.4 post.json for a video post (`videoPostExportJson` output)

| Path | Type | Source |
|---|---|---|
| `format`, `version`, `exported_at` | as A.2.2 | |
| `post` | as A.2.2 (`kind` is `"meme"`) | |
| `video.file` | string | `<name>.mp4` (A.2.6) |
| `video.asset_id` | string (`ast_...`) | the exported MP4 |
| `video.duration_sec` | number or `null` | |
| `video.on_screen_text` | string or `null` | the post's caption on the video (a plan clip row: its `hook`); `null` when **No caption** is on |
| `caption.text` | string | the caption to post: `spec.plan.caption`, from the plan row or typed in the Text step |
| `caption.hashtags` | string[] | `spec.plan.hashtags`, at most 5 |
| `caption.ad` | boolean | `spec.plan.product` (the ad switch) |
| `caption.cta_line` | string or `null` | `spec.plan.cta` |
| `caption.as_posted` | string | `postCaption`, as A.2.2 |
| `plan` | object or `null` | `planJson`, as A.2.2 |
| `results` | object or `null` | `resultsJson`, as A.2.2 |
| `ai_label` | string | as A.2.2 |

There is no `files`, `sizes` or `caption.file`: the MP4 and the post.json are separate downloads.

Sample, produced by calling the real `videoPostExportJson` (as of `c23ac34`) with fake input in a scratch run: the video post that the plan import drafts from row `R002` of the fake plan in A.6.2 (a character clip, an ad), exported again after the owner typed its results on the post's card (views "12.4K", saves "1,203", read by `readCount`). The post URL is a placeholder.

```json
{
  "format": "character-studio.post",
  "version": 2,
  "exported_at": "2026-11-06T09:30:00.000Z",
  "post": {
    "id": "cnt_SAMPLEPOST000002",
    "kind": "meme",
    "title": "R002: night shift ended at 7. dinner is at 7:10. it is one pan",
    "idea": "7:10am after a night shift, still in scrubs, one pan on the stove.",
    "account": "Ada Sample",
    "character": {
      "id": "chr_SAMPLECHAR00001",
      "name": "Ada Sample"
    },
    "variation_of": null,
    "batch_of": null,
    "created_at": "2026-10-30T09:00:00.000Z",
    "updated_at": "2026-10-30T10:05:00.000Z"
  },
  "video": {
    "file": "r002-night-shift-ended-at-7-dinner-is-at.mp4",
    "asset_id": "ast_SAMPLEVIDEO00001",
    "duration_sec": 8.2,
    "on_screen_text": "night shift ended at 7. dinner is at 7:10. it is one pan"
  },
  "caption": {
    "text": "no notes. rice, an egg and spite",
    "hashtags": [
      "nightshift",
      "onepan",
      "easydinner",
      "nurselife"
    ],
    "ad": true,
    "cta_line": "what do you cook after a long shift?",
    "as_posted": "Ad: no notes. rice, an egg and spite\n\nwhat do you cook after a long shift?\n\n#nightshift #onepan #easydinner #nurselife"
  },
  "plan": {
    "row_id": "R002",
    "plan_id": "plan-2026-11-02",
    "date": "2026-11-02",
    "slot": "PM",
    "format": "character clip",
    "tension": "T1",
    "pillar": "P2",
    "audience": "A2",
    "product": true,
    "mention_mother": false,
    "structure": {
      "code": "S6",
      "name": "Teaser"
    },
    "effect_open": {
      "code": "E3",
      "name": "I need to know how this ends"
    },
    "effect_payoff": {
      "code": "E6",
      "name": "So it's not me"
    },
    "hook_score": 1,
    "moment_id": "ADA-M01",
    "moment": "7:10am after a night shift, still in scrubs, one pan on the stove.",
    "alt_hook": null,
    "scene": "Character clip, 9:16, locked scene: a small apartment kitchen at dawn, window light. Outfit: navy scrub top, gray joggers. Hair: low loose ponytail.",
    "clip_action": "She cracks an egg into the pan, looks at the camera and shrugs. She takes the first bite.",
    "cta": "what do you cook after a long shift?",
    "stat_source": null,
    "notes": null
  },
  "results": {
    "post_url": "https://example.com/@ada.sample/video/0000000000000000001",
    "posted_at": "2026-11-02T18:05",
    "views_72h": 12400,
    "follows_72h": 86,
    "saves_72h": 1203,
    "shares_72h": 310,
    "decision": "variations",
    "notes": "Hook landed; try the alt hook next.",
    "updated_at": "2026-11-05T18:10:00.000Z"
  },
  "ai_label": "Label all posted content as AI-generated."
}
```

The row names the product `Pan Club`, which `importPlan` makes the post's product (`content_items.product_id`); it appears nowhere in the file. `plan.product: true` is the row's `ad` column.

### A.2.5 Batches of video posts

**Not built**: no post.json. The batch export is described in A.2.6.

### A.2.6 Zip folder and file names

`<name>` is the post title made into a slug: lower case, every run of characters other than a to z and 0 to 9 becomes `-`, a leading or trailing `-` removed, then cut to 40 characters (so a cut name can end in `-`), `content` when empty (`slug` in `server/pipeline/content.ts`). `NN` is the slide or video number, two digits from `01`. The browser names its downloads from the post's name with its own slug (`fileSlug(postName(...))`, `src/studio/pages/post/FinishStep.tsx`): `<post name>.mp4` and `<post name>.post.json` for a video post, `<post name>-slides.zip` and `<post name>-post.json` for a slideshow.

Slideshow zip (stored, not compressed):

```
tiktok/NN-<name>.jpg        one per slide, 1080 x 1920, JPEG quality from config (slideshow.image.quality)
instagram/NN-<name>.jpg     one per slide, 1080 x 1440, only with "Also make the Instagram set"
caption.txt
post.json
```

`caption.txt` holds `caption.as_posted`, a blank line, then: "Post on TikTok as a photo slideshow, the images in tiktok/ in order (1080 x 1920)." With the Instagram set it adds " The instagram/ set (1080 x 1440) is the same slides in 3:4." It ends with " Turn on the AI-generated content label (TikTok and Instagram)." (`AI_LABEL_LINE`). For the A.2.3 sample:

```
the containers are thriving. i am not

what is in your fridge right now?

#mealprep #sundayreset #kitchentok

Post on TikTok as a photo slideshow, the images in tiktok/ in order (1080 x 1920). Turn on the AI-generated content label (TikTok and Instagram).
```

Batch of video posts (zip parts of at most 150 MB each, `batch.zip_part_mb`):

```
<name>-NN.mp4               one per caption; a failed video leaves its number out
captions.txt                in every part: "NN. <caption>" per line
```

Video post: one MP4 and one post.json, no zip.

**Download day** (`00ae32b`, G61, UX-PLAN section 33; `server/core/postingDay.ts`, `server/pipeline/postingDay.ts`): Posts home > Download day picks a date (the browser's today by default). A free preview (`GET /api/v1/posting/day?date=&packed=0|1&tz=`) lists every video post and slideshow of that day (its own posting day, else its plan row's date, else the day its results say it was posted) in posting order: by the slot's clock time (`config/content.yaml` `posting.slot_times`: `AM` 09:00, `Daily` 12:00, `PM` 18:00, editable per account, `PUT /api/v1/posting/slots`; a slot with no time last), then account, then the plan's row. Each goes in, or is left out with the first reason that applies: no account, not approved for posting, already packed (unless **Include packed posts**), exporting now, missing pictures, or could not be exported. **Approve for posting** is per post (`spec.posting`, `PUT /api/v1/content/:id/posting` with `{ approved?, date?, slot? }`; a batch review's Approve counts), saved on its own and never copied. **Make the zip** (`POST /api/v1/posting/day/pack`, free, a local job `posting_pack` on the worker) exports an approved post that has no export yet, then writes (stored, not compressed):

```
<date>/checklist.txt                          one line per post, in posting order
<date>/left-out.txt                           what stayed out and why
<date>/<account>/<n>-<SLOT>-<HHMM>/01.jpg     a slideshow's TikTok slides (01.jpg, 02.jpg, ...)
<date>/<account>/<n>-<SLOT>-<HHMM>/video.mp4  or a video post's MP4
<date>/<account>/<n>-<SLOT>-<HHMM>/caption.txt  caption.as_posted
<date>/<account>/<n>-<SLOT>-<HHMM>/post.json    the post's post.json, with the current results and a posting block
```

`<account>` is the account tag with characters other than letters, digits, `.`, `_` and `-` turned into `-` (two tags that clean alike get `-2`); `<n>` counts the account's posts in posting order; `<SLOT>` is the slot in capitals (`ANY` when none) and `<HHMM>` its time, left out when the slot has no time. Each post that went in is marked packed (`spec.posting.packed`) and left out of that day's next zip. Sample, the real `orderDay`, `folderNames`, `checklistText` and `leftOutText` on fake posts (rows R001 and R002 of A.6.2 approved, a third slideshow not approved) in a scratch run:

```
Download day: Monday, November 2, 2026
2 posts, in posting order. Made Nov 2, 7:30 AM.
Post each one from its folder: the slides in number order (or video.mp4), the words in caption.txt. Turn on the AI-generated content label on every post.

[ ] 1. F1 | 09:00 (AM) | Hook: "i bought 14 meal prep containers in january. i have used 2" | Ad: no | AI-generated label: on | F1/1-AM-0900/
[ ] 2. Ada Sample | 18:00 (PM) | Hook: "night shift ended at 7. dinner is at 7:10. it is one pan" | Ad: yes | AI-generated label: on | Ada-Sample/1-PM-1800/
```

```
Left out of Download day 2026-11-02: 1 post.

F1 | 18:00 (PM) | Hook: "the fridge at 11pm is a different fridge" | Not approved for posting
```

The `posting` block in each post.json there: `{ "date", "slot", "slot_time", "folder", "approved_at", "pack_id", "packed_at", "ai_label": "on" }`. The Instagram set and batches are not in a Download day zip.

---

## A.3 Face gates

Unchanged since 3f7140a: no file this section reads changed.

### A.3.1 The face model and library

- **Detector**: YuNet, file `face_detection_yunet_2023mar.onnx` (OpenCV Zoo, MIT).
- **Recognizer**: SFace, file `face_recognition_sface_2021dec.onnx` (OpenCV Zoo, Apache-2.0).
- **Runtime**: `onnxruntime-web` (WebAssembly, one thread, in-process; no native build, no network call). Images are decoded with `sharp`.
- Fetched once with `npm run models` (`scripts/fetch-models.mjs`, SHA-256 checked) into the folder named by the `STUDIO_MODELS_DIR` setting. If the files are missing, face matching reports itself unavailable and every face check is skipped with a message ("Face matching is off ..."), never failed.
- Code: `server/qa/faces.ts` (`createFaceMatcher`, `cosineSimilarity`, `alignFace`, `decodeYunet`), `server/pipeline/identity.ts` (the checks that use it).

### A.3.2 How one score is computed

1. **Decode**: EXIF rotation applied, alpha removed, resized to fit inside 1280 x 1280 (never enlarged), raw RGB.
2. **Detect**: the image is letterboxed into the top-left of a black 640 x 640 square, BGR, values 0 to 255, run through YuNet. Outputs are decoded at strides 8, 16 and 32; score = sqrt(cls x obj); kept when score is 0.75 or more; non-maximum suppression at IoU 0.3; faces smaller than 3% of the image's short edge are dropped.
3. **Pick**: the largest face by box area. `faces` (the count) is kept for messages.
4. **Crop and align**: the five landmarks (right eye, left eye, nose tip, right and left mouth corner) are mapped onto the 112 x 112 ArcFace template `[38.2946, 51.6963], [73.5318, 51.5014], [56.0252, 71.7366], [41.5493, 92.3655], [70.7299, 92.2041]` by a least-squares similarity transform (rotation, uniform scale, translation, no reflection), with bilinear sampling and black outside the source.
5. **Embed**: SFace on the aligned crop (RGB, 0 to 255, channels first, 1 x 3 x 112 x 112). The output vector is L2-normalized.
6. **Compare**: cosine similarity of two embeddings (dot product over the product of norms). Higher is more alike.

Results are cached per image checksum (64 entries); calls run one at a time.

### A.3.3 Thresholds in use

| Check | Number | Where | Effect |
|---|---|---|---|
| Same person (sheet shots, scene stills) | `identity_min_similarity: 0.363` | `config/review.yaml` `qa` | Below it: a `face_drift` finding (severity fail). The item waits for the owner's review; outside the fixed Recreate gate, face drift is a strong warning and the owner decides. With two or more faces in a scene still, a miss is only a warning (the largest face may be someone else) |
| A new person (hero vs inspiration photos, clone vs source clip) | `distinctness_max_similarity: 0.363` | `config/review.yaml` `qa` | At or above it: a `too_similar` finding (severity fail). A Recreate still or clone that fails it is held and cannot be used (fixed rule: a new person, never a copy) |
| Scene still face too small | 64 px short side | `MIN_SCENE_FACE`, `server/pipeline/identity.ts` | Not scored, "check the face yourself" |
| Recreate still gate: face | `face_min: 0.45` | `config/content.yaml` `clone.recreate.gate` | Fixed rule, blocks the motion run |
| Recreate still gate: margin | `margin: 0.12` | same | Fixed rule, blocks |
| Recreate still gate: likeness | `source_max: 0.45` (must stay under) | same | Fixed rule, blocks |
| Skip the face pass | `face_skip_margin: 0.3` | same | Face pass skipped and not charged |
| Face pass keeps its scene | `SCENE_MIN = 0.6` | `server/qa/sceneMatch.ts` | Below it: `scene_changed`, the face pass is held (`qa_failed`) |

Which refs a score is against: a sheet shot is scored against REF-00 plus its approved attach refs (closest angles; views marked `identity: skip` in `config/views.yaml` are skipped), and the best match counts. A Recreate still is scored against REF-00 only.

### A.3.4 The Recreate gates (still, before any video spend)

For each Recreate still (`onCloneStill` hook in `server/pipeline/clone.ts`):

- `face` = cosine similarity of the still's main face to REF-00 (`scoreSceneIdentity`).
- `likeness` = cosine similarity of the still's main face to the face in the clip's frame the still was made from (`scorePerformer`; the highest across pairs).
- `margin` = `face - likeness`, rounded to 3 decimals.

`gateFor` passes a still only when all hold:

- `face >= face_min` (0.45). No face found: fails ("No face to match with REF-00 was found on it.").
- `margin >= margin` (0.12), checked when both scores exist.
- `likeness < source_max` (0.45), checked when a face shows in the clip frame.
- The still is not `qa_failed` (for example `too_similar` or `scene_changed`), and a face pass made before the scene check existed is held.

When no face shows in the clip frame, only `face` is checked, with the note "No face showed in the clip's frame to compare with, so the margin was not checked." Mock (demo) stills pass with a note. Starting the motion with a still that fails throws `gate_failed` with the reasons; this is a fixed rule (`config/rules.yaml`) and cannot be switched off. The best still for "You pick" is ranked by `(gate ok ? 1 : 0) + face - likeness`.

The face pass (an edit of the best still that puts REF-00's face on it) runs inside the same price unless the best still already passes with `margin >= 0.30`; then it is canceled and not charged.

### A.3.5 Video takes: medians, a warning only

A Recreate video take is never rejected for its face; a miss is a warning with **Keep this take** or **Try again**.

- **On arrival** (`onClone`): three frames at 30%, 60% and 90% of the take's length, and the source clip's frames at the same fractions, each scored for `face` (vs REF-00) and `likeness` (vs the clip's person at the same moment).
- **The review** (`runCloneReview`, `server/pipeline/recreate.ts`): every `review_step` = 0.5 s (`config/content.yaml`), frames scaled to 480 px wide with ffmpeg, the take and the source clip side by side in time. Scores rounded to 2 decimals.
- **The video rule** (`takeGateFor`, `server/core/takeGate.ts`) over those samples:
  - `face` = the **median** of the per-frame face scores (a blink or a turned head does not sink a take),
  - `margin` = the **median** of per-frame `face - likeness` (frames where both exist),
  - `likeness` = the **highest** per-frame likeness (not the median: the moment it looks most like the clip's person).
  - Passes when `face >= face_min`, `margin >= margin` and `likeness < source_max`, using the video numbers (A.3.6).
- **Drift strip** (`driftSpans`): stretches where a frame's face is under the video `face_min` or no face was found, shown on the take.
- Text found by OCR and picture cuts come from the same review (A.4.1).

### A.3.6 Recalibration (the gate check)

`server/pipeline/gateCheck.ts`, shown in Settings > Rules (GateCheckCard). Suggest only; nothing changes until the owner clicks.

- **Counting**: a "real recreate" is a completed motion job (`clone:<postId>` purpose, a model whose `clone.mode` is `motion`, provider not `mock`). The check is due when the count is 10 or more past the last review (`EVERY = 10`).
- **Still numbers**: the still each video was made from is "picked"; the other stills of that post are "passed over". `suggestGate` proposes:
  - `face_min` = max(0.363, floor to 2 decimals of (lowest picked face - 0.03)),
  - `margin` = max(0.05, floor to 2 decimals of (smallest picked margin - 0.03)), or unchanged with no data,
  - `source_max` = min(0.5, max(0.3, ceil to 2 decimals of (highest picked likeness + 0.03))), or unchanged.
  - It also shows the effect: how many picked stills pass and how many passed-over stills are held, under the current and the suggested numbers.
- **Video numbers**: the same formulas over takes the owner kept (approved) next to takes marked Try again, with each take's median face, median margin and highest likeness.
- **Approve**: "Use these numbers" stores them per account (settings keys `recreate_gate` and `recreate_video_gate`, each with `approvedAt`); "Keep the current numbers" only closes the check until the next 10. Stored numbers are used only when all three are finite and between 0 and 1; otherwise the config defaults apply. Until video numbers are approved, takes use the still numbers.

---

## A.4 Other checks as built

How rules behave everywhere (`server/core/rules.ts`, `server/pipeline/rules.ts`): the prompt lint forces every **default** rule hit to a warning whatever its yaml says; only a **fixed** rule can block (`prompt_rejected`). A default's switch is `stored.on ?? starts_on` (`starts_on` is true unless the rule says otherwise), and a per-character switch wins over the account-wide one. Rules of type `behavior` or `code` are not lint checks; the code that reads the switch does the work. Since 3f7140a, 14 more defaults of type `behavior` sit in area `copy` (spec "28"): the 13 language lint checks and `structure-repeat` (A.4.10).

### A.4.1 OCR (text left on a Recreate take)

- **Engine**: `tesseract.js` 7, English only, LSTM engine (OEM 1), language data `eng.traineddata` (tessdata_fast) read from the `STUDIO_MODELS_DIR` folder, fetched by `npm run models`. Code: `server/qa/ocr.ts` (`createOcr`, `classifyText`).
- **Where it runs**: only in the Recreate take review (`runCloneReview`, `server/pipeline/recreate.ts`), a free local job queued after a take lands, after a free trim, and from Review again. Frames come from the **generated take** only: 1 frame per second (`ocr_step: 1`), scaled to 720 px wide.
- **What counts**: each recognized line is cleaned (characters other than letters, digits and `@#._ '!?,:-` removed). Dropped when it has fewer than 3 letters or digits, or confidence under 55. Then classified: `handle` if it matches `@` plus 3 or more word characters; `logo` if it matches `tik tok`, `tiktok`, `reel`, `reels`, `instagram`, `capcut`, `youtube`, `shorts`, `snapchat`; otherwise `caption` (first 80 characters). Repeats are counted once (a later reading that starts with an earlier one, or the other way round, is skipped).
- **Output**: `{ t, kind, text, frameAssetId }` per hit, with a thumbnail of the frame and the words boxed in red.
- **Effect**: information only. It never blocks and never changes the take's status. No rule in `config/rules.yaml` covers it; it switches itself off (with a note) when the language data is missing.

### A.4.2 Hot spot check

**Not built.** No code measures bright or blown highlights on the skin, and no rule mentions hot spots. "Hot spots" appear only as **prompt words**: character template v1.6 puts "Even, soft exposure on the face, no bright hot spots" in its REALISM block and "blown highlights or hot spots on the skin" in its AVOID block, and the importer carries those blocks into every image prompt for that character (A.1.4). The Studio's own default REALISM and AVOID blocks do not mention hot spots. (In the UI code, "hotspots" means only the numbered labels on the Guide's screenshots.) The only exposure reading in code is the clip reader's dark-clip hint (`dark_luma: 70`), which suggests a route and checks nothing.

### A.4.3 Risky word warning (`wording-risky`, default, on)

- **Rule**: "May be blocked by the provider's filter". Stages: `scene`, `edit`, `video` (scene stills, slideshow character stills, a plan clip row's opening still, still edits, Recreate stills and face pass, scene video, Recreate motion). Not run on hero, sheet or upscale.
- **Words**: `findRiskyWords` (`server/core/wording.ts`) scans the prompt text before `AVOID:` for the `boy shorts` swaps, the `fit` list, the `body` list and the cup-size patterns (A.4.5). Not the pose list. Each word is named once.
- **Shown**: under the price button, "May be blocked by the provider's filter: <words>. Your words go as typed." It never blocks; the owner's words are sent as typed.
- **After a refusal** (an error matching `nsfw`, `content filter`, `safety`, `moderation` or `policy`, or for Recreate stills `content filter`, `filter blocked`, `blocked by`, `moderation`, `safety system`, `not allowed by the provider`): the run list shows "Likely trigger words: <words>" and a **Retry with safer wording** button (action `retry_safer`). It runs `catalogWording` over the whole prompt before `AVOID:` with no exemption for the owner's words (swaps, pose rewrites, body phrases, fit words and cup sizes removed), shows "Changed: <list>. Only the words change, never the outfit.", and is priced like the refused run. No Claude call. If nothing would change: "No likely trigger words were found in what was sent. Use Retry, or change the words yourself."

### A.4.4 Garment check (`outfit-garment`, default, on)

- **When**: only on the Recreate "Make 4 stills" price, only when the outfit came from the clip reader (never one the owner typed), and the outfit names no garment type.
- **Matching** (`namesGarment`): each garment term as a whole word, case-insensitive, an optional `s` or `es`, and a space or hyphen inside a term also matches a space, a hyphen or nothing (`t-shirt` matches `t shirt` and `tshirt`). A bare "top" is not in the list, so "black top" warns.
- **Warning**: `No garment type in "<outfit>": name the garment: tank top, t-shirt...` with a priced fix, **Read the outfit again** (action `clone_outfit`: one Claude call on the clip's frame, returns `{ outfit }`, must name the garment; the result goes through the catalog wording; the chips, traits and motion line stay).
- **The `garments` list** (`config/wording.yaml`, 90 entries):

```
tank top, tank, cami, camisole, halter top, halter, crop top, tube top, bandeau,
wrap top, peplum top, corset top, off-the-shoulder top, off-shoulder top,
one-shoulder top, bikini top, bra top, bodysuit, leotard, t-shirt, tee, shirt,
blouse, button-down, polo, henley, turtleneck, sweater, jumper, cardigan, hoodie,
sweatshirt, pullover, vest, waistcoat, corset, bustier, bralette, sports bra, tunic,
kimono, jacket, blazer, coat, trench, parka, puffer, windbreaker, bomber, shacket,
overshirt, poncho, cape, dress, sundress, slip dress, gown, skirt, miniskirt, skort,
jeans, pants, trousers, slacks, chinos, leggings, joggers, sweatpants, shorts,
culottes, cargos, capris, jumpsuit, romper, playsuit, overalls, dungarees, swimsuit,
one-piece, bikini, unitard, catsuit, tracksuit, co-ord, pajamas, pyjamas, robe,
bathrobe, nightgown, scrubs
```

### A.4.5 Banned fit and body words (`prompt-catalog-wording`, default, on)

The lists live in `config/wording.yaml`; `catalogWording` in `server/core/wording.ts` applies them.

```
fit:      skin-tight, tight-fitting, close-fitting, form-fitting, figure-hugging,
          body-hugging, body-skimming, fitted, tight, snug, clingy, bodycon, low-cut,
          plunging, deep v-neck, deep v neckline, deep v, sheer, see-through, skimpy,
          toned, curvy, shapely, busty, buxom, voluptuous
body:     hips, waist, waistline, legs, thighs, bust, cleavage, curves, midriff,
          physique, butt, glutes, abs
swaps:    boy shorts -> bike shorts; boyshorts -> bike shorts
pose:     posing in -> wearing; poses in -> wears;
          posing for the camera -> caught mid-moment; poses for the camera -> is caught mid-moment;
          posing for a photo -> caught mid-moment; poses for a photo -> is caught mid-moment;
          striking a pose -> caught mid-moment; strikes a pose -> is caught mid-moment;
          posing -> standing
patterns (cup sizes, case-sensitive):
          \b(?:[B-H]|DD|DDD)[- ]?cups?\b(?!\s+of\b)
          \b(?:2[89]|3[0-9]|4[0-6])(?:AA|DDD|DD|[B-H])\b
```

What `catalogWording` does, only on the text before `AVOID:`: (1) swaps and pose rewrites, longest first, keeping the first letter's case; (2) body terms, removing the whole lead-in phrase ("showing off her legs", "around the waist"), but not after furniture or garment words (`table`, `chair`, `stool`, `bench`, `desk`, `tripod`, `piano`, `bed`, `sofa`, `couch`, `trouser`, `pant`) and not before `up`, `height`, `level`, `high`, `deep`, `length`; (3) fit words, the word alone; (4) cup patterns. Then commas, articles and capitals are tidied. A term that appears anywhere in the owner's own words is left alone everywhere in that text. Silent; it returns the list of changes.

Where it applies (Claude's words only; the owner's words get the `wording-risky` warning instead):

| Writer | Gated by the switch |
|---|---|
| Scene planner, Punch it up, prompt writer (still and video) | yes |
| Recreate clip reader, Recreate still outfit, Read the outfit again, slideshow draft shot lines, scene outfit and details | no, always |

A plan import's words are the owner's (kept as written), so the catalog wording does not touch them.

Related lists:

- **Realism banned words** (fixed rule `realism-banned-words`, `BANNED_REALISM_TERMS` in `server/core/realism.ts`): `flawless`, `perfect skin`, `smooth skin`, `airbrushed`, `retouched`, `porcelain`, `beautify`, `glamour retouch`, `skin smoothing`, `beauty filter`, `enhance face`. Whole words, case-insensitive. Allowed inside an `AVOID:` line and when negated (`no`, `not`, `never`, `without`, `avoid`, `zero`, `nothing`, `free of`, `instead of`, `rather than` within the same clause, up to two words before). The builders strip them with a warning; one that still reaches a run is refused at the lint and again at the quote.
- **Heavy flaw words** (default `realism-flaw-dose`): `blemish`, `acne`, `pimple`, `zit`, `scar`, `scarred`, `rough skin`, `pockmark...`, `breakout`, `enlarged pores`, `deep wrinkles`, `blotchy`, `skin lesion`, `rosacea`, `eczema`, `sun damage` are stripped unless the character's card, marks or realism notes name them.
- **Makeup words on hero and sheet** (fixed bare face): `glam`, `glamorous`, `soft glam`, `full glam`, `full makeup`, `heavy makeup`, `makeup look`, `wearing makeup`, `with makeup`, `red lip(stick)`, `bold lip`, `lipstick`, `lip gloss`, `winged (eye)liner`, `eyeliner`, `mascara`, `eyeshadow`, `eye shadow`, `contour`, `bronzer`, `false lashes`, `lash extensions`, `smokey eye` are stripped from hero and sheet prompts.
- **Cup sizes and measurements** (defaults `neutral-body-cups`, `neutral-body-measurements`): a warning on any prompt. Since `7c07140` the `neutral-body-cups` pattern in `config/rules.yaml` is `\b(?:[B-H]|AA|DD|DDD)[- ]?cups?\b(?!\s+of\b)`, so "A cup of coffee" and "A cup sits on the sill" no longer warn and "a DD cup bralette" does. On the character record, a cup size or measurement in the card or body gives "Neutral body terms usually work better than cup sizes or measurements; models exaggerate them." (the same pattern, plus `cup size`, `bust size`, `measurements` and `NN-NN-NN`).
- **Recreate card** (`cardForPhotoEdit`): next to a real person's photo, only card sentences with face or hair words are kept, and comma parts with any of `fit`, `build`, `body`, `figure`, `physique`, `leg(s)`, `thigh(s)`, `waist`, `hip(s)`, `curv...`, `bust`, `chest`, `breast(s)`, `butt`, `glute(s)`, `abs`, `toned`, `athletic`, `slim`, `slender`, `petite`, `tall`, `height`, `weight`, `muscular`, `hourglass` are dropped; age words are removed too.
- **No nudity or explicit content** (fixed `no-explicit`, `server/core/safety.ts`): `nude` (not when followed by a color or cosmetic word such as pink, beige, tones, lips, heels, polish, nails, makeup, gloss, lipstick), `nudity`, `naked`, `topless`, `bottomless`, `unclothed`, `undressed`, `no clothes`, `without clothes`, `nipple(s)`, `areola(s)`, `genital(s)`, `genitalia`, `pubic`, `vulva`, `penis`, `vagina`, `explicit`, `sexual(ly)`, `sex scene`, `sex act`, `having sex`, `intercourse`, `orgasm...`, `porn...`, `erotic...`, `nsfw`, `fetish...`, `bdsm`, `see-through top|bra|shirt|dress`, `exposed breast(s)|chest|buttocks`. Allowed inside AVOID and when negated. Never stripped: always refused ("No nudity or explicit content. This is a fixed rule and cannot be switched off.").

### A.4.6 Hair rotation (`hair-rotation`, default, on)

- **Bank** (`config/scenes.yaml` `hair_bank`, in order): behind both shoulders; tucked behind one ear; blowing back off the face; half-up claw clip; low loose ponytail; high sleek ponytail; messy top bun; sunglasses as a headband; damp and air-dried; parted on the other side.
- **When**: in `createScene` (`server/pipeline/scenes.ts`) for a new scene, a copied scene and a post's scene, only when no hair was typed, the owner's words name no styling (`hairFromWords`), and the switch is on. A plan row's "Hair:" in its scene is a typed styling: a slideshow row puts it on the locked scene (`lock.hair`), a clip row in the scene's `hair` field.
- **Recent** (`rotatedHair`): the hair of the last 5 combo log entries that have one (`hair_window: 5`), plus the hair of the character's last 5 scenes.
- **Pick** (`nextHair`, `server/core/scenes.ts`): names compared lower-case with punctuation as spaces. Start after the bank position of the newest recent styling (or at the first), walk the bank in a circle, return the first styling not in recent. All used: the one whose last use is oldest.
- **Owner-set**: a typed hair value, or a styling in the owner's words (buns, ponytails, braids, clips, headbands, "hair up/down/back/tucked", "wet/damp/slicked-back/air-dried hair", "tucked behind her ear"). A value equal to a bank entry counts as the rotation's pick, not the owner's: later words replace it and it is not copied to another character.
- **In the prompt**: the template line `{makeup}. Hair: {hair}. {pose}, {expression}.` (`hair` is "as usual" when empty), and `- Hair styling: ...` in the prompt writer's facts. Hair color and texture stay the character's. Recreate does not rotate hair.

### A.4.7 Makeup by setting (`makeup-by-setting`, default, on)

- **Classification** (`makeupForSetting`): the scene's moment, setting and location joined; `bare` when any phrase below matches (whole words, case-insensitive), otherwise `natural`. There is no word list for "public", "night out" or "events": anything that is not bare counts as public. For a character slideshow it runs on the post's own scene before the locked place is applied (A.8.2, item 6).

```
at home, home, apartment, bedroom, in bed, bed, couch, sofa, living room, bathroom,
kitchen, balcony, pajamas, pyjamas, waking up, wakes up, woke up, just woke,
morning routine, gym, workout, working out, treadmill, weights, between sets,
locker room, yoga, pilates, spin class, early beach, beach at dawn, beach at sunrise,
sunrise on the beach
```

- **Lines** (`makeupLine`, `config/templates.yaml` `makeup`):
  - bare: `No makeup, bare skin`
  - natural, no line of the character's own: `Makeup: soft everyday makeup, light coverage that still shows skin texture, groomed brows, mascara, warm bronzer, a matte nude lip; lips natural and matte, no gloss; the same lip shape, nose and jaw as the references`
  - natural with the character's own line (`makeup.default` not `natural`, `light`, `minimal`, `soft`, `everyday` or empty): `Makeup: <own>; lips natural and matte, no gloss; the same lip shape, nose and jaw as the references` (`none`, `no makeup` or `bare` give the bare line)
  - soft glam: `Makeup: <makeup.glam or "soft glam">, with real skin texture still visible underneath`
  - men (pronoun noun `man`, `guy`, `boy`, or subject `he`): `Groomed brows and beard` for every choice
- **Soft glam is never set by the setting.** It comes from the owner's choice, the owner's words (`glam`, `smokey eye`, `winged liner`, `red lip`, `lipstick`, `lip gloss`, `glossy lips`, `false lashes`) or the planner (told "soft glam ... is for <glam_when>", default "nights out and events").
- **Owner wins**: a makeup choice in the fields, or makeup words in the brief (`no makeup`, `bare-faced`, `makeup-free`, `fresh-faced`; the glam words; `natural makeup`, `light makeup`, `minimal makeup`, `tinted lip`), skip the by-setting step.
- **REALISM block**: soft glam drops the block's makeup-limiting clause; bare drops its "or light makeup only". Hero and sheet stay bare-faced (fixed).

### A.4.8 Combo log

- **Rule** `scene-combo-log` (default, **starts off**): when on, the planner prefers a moment and camera pair not in the log, and a repeat shows a small variety note ("<moment>" with "<camera>" was used on <date> ...). It never blocks. The log is written either way.
- **Entry**: `{ date (YYYY-MM-DD, the approval day), moment (preset label), camera (preset label), light (preset label), location (the location field, or the setting up to the first comma or period, max 40), hair? (max 60) }`.
- **Format**: a bulleted list, not a table, in a section titled `Combo log (last 10)` (any title starting with `combo log` is read): `- YYYY-MM-DD <moment> / <camera> / <light> / <location> / <hair>`. A `/` inside a part becomes `-`. Indented continuation lines join the entry above. Four-part lines without hair still parse.
- **Written** (`logCombo`) on a scene's first approved still only; the newest 10 kept (`combo_window: 10`).
- **Stored** in the character's `file_sections` (no table of its own); `scenes.combo_logged_at` marks a logged scene.
- **Merged on re-import** as described in A.1.6.

### A.4.9 Skin texture check (related, fixed `realism-texture`)

After an upscale or an edit, and on imported sheet images, `compareTexture` (`server/qa/texture.ts`) measures fine detail as the variance of a Laplacian filter on the face crop of both images at the same scale (crop scaled to at most 256 px). Output detail under `texture_min_ratio: 0.6` of the input's (`config/runtime.yaml`) is "skin smoothed". A face under 64 px, or two faces of very different size, is not judged. A smoothed upscale never replaces REF-00.

### A.4.10 Language lint (`server/core/copyLint.ts`, new since 3f7140a)

Free checks on the words people read: hooks (slide 1, and a video post's on-screen hook), the other slides, and captions. Warnings only: never a block on a run, an import or an export (rule one). One pure function (`lintCopy`, and `lintPost` for a whole post) runs in the browser as the owner types (`src/studio/lint.tsx`: hook cards, the hook box, each slide, the caption, a video post's on-screen text and caption, the Finish step's summary) and on the server in the plan import's preview (A.6.2).

- **Buckets.** Each check is a **default** rule in `config/rules.yaml` (area `copy`, `check: { type: behavior }`, spec "28"), switchable per account or per character; the switched-off ids reach the browser as `options.lint.off` and `offFor` (`lintSettings`, `server/pipeline/copyLint.ts`).
- **Which posts.** `lint-dashes` runs on every post, any product or none. The other 12 run only when the post's product's rules have `lint: true` (`writing_standards` in `config/content.yaml`; today only `sidestep`): the option `standard` (rule two, G57). The product's own name is the word list `products` (the name never in a hook).
- **Word lists** (`config/content.yaml` `copy_lint`): `values` (should, need to, needs to, must, ought), `hype` (dream job, unlock, level up, game-changer, game changer, supercharge), `products` (empty in config, the post's product added at run time), `max_hashtags: 5`, `hook_max_words: 22`, `hook_labels` (Exhibit, Levels of, Previously on, Calendar invite), `job_words` (job, interview, recruiter, offer, salary, salaries, resume, résumé, hiring, application), `ending_never` (ghosted, ghosting, passed over, applies for you, apply for you, applies for me, applying for you, auto-apply, auto apply).
- **The caption is checked as posted** on the slideshow screens (after `postCaption` puts "Ad:" first and adds the CTA line); a video post's Text step and the plan preview check the caption as written (A.8.2, item 4).

| Rule id | Runs on | Flags | Message |
|---|---|---|---|
| `lint-dashes` | any text, every post | an em dash (U+2014) or an en dash (U+2013) | `A long dash (em or en). Use a comma, a period or "to".` |
| `lint-values` | any text | the first `values` phrase found (whole words, case-insensitive; a space or hyphen inside matches either) | `"<w>" is values language. Turn it into a feeling, a fact or a joke.` |
| `lint-just` | any text | "just" opening a clause (start, or after `. ! ? : ; , " (`), or after and, so, then, can, could, gotta, simply, should, must, will, need to, have to, has to, ought to or a word ending in `'ll`, followed by a word other than because, kidding, like, in, now, a, an, the, my, me, one, two, that, this, for, to, as, not, about, enough, another, some, got, had, was, did, said | `"<just x>" reads as an order. Drop "just", or ask it as a question.` |
| `lint-hype` | any text | the first `hype` phrase | `"<w>" is a hustle word. Say what actually happens instead.` |
| `lint-you-start` | any text | a sentence (split at `. ! ?` and line breaks) whose first word is `you...` after optional quotes, `(` or `*` ("POV: you" is fine) | `A sentence starts with "<You>". Move "you" to the middle or the end ("POV:" is fine).` |
| `lint-hook-long` | hook | more than `hook_max_words` (22) words | `<n> words. Slide 1 reads in one go at 22 or fewer.` |
| `lint-hook-label` | hook | opens with a `hook_labels` entry, or a timestamp or date (`2:14am`, `11:52 PM`, `Sunday 9:40pm`, `Tue, 4pm`, `Oct 19`, `10/19`) | `Opens with "<x>", a label or stage direction.` or `..., a timestamp.`, then `Say the pain plainly first; the frame can wait for slide 2.` |
| `lint-hook-quotes` | hook | more than one quoted phrase (straight or curly double quotes, curly single quotes, or straight single quotes that are not an apostrophe) | `<n> quoted phrases. One at most, so it is clear on one read.` |
| `lint-hook-nojob` | hook | no word starting with a `job_words` entry | `No job word. Name the job situation (<first 8 job words>): a stranger can't tell it's about the job hunt.` |
| `lint-product-hook` | hook | the post's own product name | `<Name> is in the hook. Name it on slide 5 or 6, or late in the caption.` |
| `lint-product-ending` | the last slide of a product post | an `ending_never` phrase | `"<w>" on the product ending. <Name> can't promise replies and never applies for anyone: use one of its honest endings.` |
| `lint-hashtags` | caption | more than `max_hashtags`, counting `#tags` in the text plus the hashtag list | `<n> hashtags. At most 5.` |
| `lint-ad-caption` | caption of a product post (`product`: an ad) | a caption that does not start with `Ad:` | `A product post: start the caption with "Ad:".` |
| `structure-repeat` | the hook writer, hook cards, plan rows (products with the playbook's structures) | the code of the account's post before this one, in schedule order (`codeBefore`, `server/pipeline/playbook.ts`) | the writer is told `Never use <code>: the account's last post used it.`; a card or a plan row with that code: `The same structure as this account's post before it (never twice in a row)` |

Sample, produced at `bdda34a` by running the real `lintPost` in a scratch run on a fake product post (`product: true`) for the fake product `Pan Club`, with the config's word lists. `[U+2014]` stands for an em dash in the input and the output; the character itself is left out of this file by the owner's rule. `slide` is the index: 0 is the hook, `null` the caption.

```
hook:     Exhibit 1: you should see what Pan Club did to my Sunday [U+2014] "one pan" "ten minutes"
slide 2:  You will be too tired to chop anything
slide 3:  just open the freezer and level up
slide 4:  the pan does the rest
slide 5:  my friend told me about Pan Club. it applies for you
caption:  one pan, one egg, ten minutes #a #b #c    (hashtag list: d, e, f)
```

With `standard: false` (a product whose rules have no lint, or no product), one hit:

```
{"slide":0,"rule":"lint-dashes","match":"[U+2014]","message":"A long dash (em or en). Use a comma, a period or \"to\"."}
```

With `standard: true`:

```
{"slide":0,"rule":"lint-dashes","match":"[U+2014]","message":"A long dash (em or en). Use a comma, a period or \"to\"."}
{"slide":0,"rule":"lint-values","match":"should","message":"\"should\" is values language. Turn it into a feeling, a fact or a joke."}
{"slide":0,"rule":"lint-hook-label","match":"Exhibit","message":"Opens with \"Exhibit\", a label or stage direction. Say the pain plainly first; the frame can wait for slide 2."}
{"slide":0,"rule":"lint-hook-quotes","match":"2 quotes","message":"2 quoted phrases. One at most, so it is clear on one read."}
{"slide":0,"rule":"lint-hook-nojob","match":"no job word","message":"No job word. Name the job situation (job, interview, recruiter, offer, salary, salaries, resume, résumé): a stranger can't tell it's about the job hunt."}
{"slide":0,"rule":"lint-product-hook","match":"Pan Club","message":"Pan Club is in the hook. Name it on slide 5 or 6, or late in the caption."}
{"slide":1,"rule":"lint-you-start","match":"You","message":"A sentence starts with \"You\". Move \"you\" to the middle or the end (\"POV:\" is fine)."}
{"slide":2,"rule":"lint-just","match":"just open","message":"\"just open\" reads as an order. Drop \"just\", or ask it as a question."}
{"slide":2,"rule":"lint-hype","match":"level up","message":"\"level up\" is a hustle word. Say what actually happens instead."}
{"slide":4,"rule":"lint-product-ending","match":"applies for you","message":"\"applies for you\" on the product ending. Pan Club can't promise replies and never applies for anyone: use one of its honest endings."}
{"slide":null,"rule":"lint-hashtags","match":"6 hashtags","message":"6 hashtags. At most 5."}
{"slide":null,"rule":"lint-ad-caption","match":"one pan, one","message":"A product post: start the caption with \"Ad:\"."}
```

---

## A.5 Prompt assembly

Image and video prompts are filled by code from templates (`config/templates.yaml`, `config/scenes.yaml`) and the character record. Claude writes only one optional part of them, the body of a scene still or video prompt ("Write and generate"); the Studio's own lines are added around it by code. Claude also writes a post's words (hooks, slides, captions) from the writer templates (A.5.4); a slideshow's photo prompts are then built by code from those words. Every paid step goes `POST /api/v1/actions/estimate` then `/actions/run`, through `buildAction` (`server/pipeline/actions.ts`), to the stage builder below, which returns job specs for the runner (A.7.2).

### A.5.1 Rules shared by every image prompt

`finishPrompt` (`server/core/prompts.ts`) and `finalizeImagePrompt` (`server/core/realism.ts`) end every hero, sheet, scene and edit prompt, in this order:

1. The saved identity's prompt block, if any (for example a trained character's IDENTITY block).
2. Banned smoothing words stripped (A.4.5), heavy flaw words stripped unless the character has them.
3. Hero and sheet only: makeup words stripped, then `Bare face, no makeup, no retouching.` appended.
4. A new line with the REALISM block: the character's own `realism.block`, else the Studio default, adjusted for the stage (hero and sheet drop the background clause and the "or light makeup only" allowance), the scene's makeup choice, and the framing's skin detail (`skin` per framing in `config/scenes.yaml`: chest-up gets the full skin list, waist-up and knees-up get "Natural skin texture", full body and wide get no skin detail; "no beauty smoothing" and "no retouching" always stay).
5. A new line with the AVOID block: the character's own `realism.avoid`, else the default.
6. Recreate stills and the face pass use the short form `REALISM: Natural skin texture, not retouched.` instead of steps 4 and 5 (no AVOID block).

Also: `normalizePrompt` joins each template body into one line (only REALISM and AVOID sit on their own lines). A model's `prompt_lines` from `config/models.yaml` go just before `REALISM:` (`withModelLines`); today only GPT Image 2.5 Flare has one, `Bare natural lips, no gloss.`, and a topic slideshow still removes it again. No prompt names a REF id: references are "the attached reference images" or "the first image" and "the other images", in attachment order.

The Studio default blocks (`server/core/realism.ts`):

```
REALISM: Candid iPhone photo, neutral natural light. Real skin texture: visible pores, soft peach fuzz catching the light on the cheeks and jaw, a few stray brow hairs and baby hairs at the hairline, subtle color variation with slight redness around the nose and cheeks, faint natural shine. No makeup or light makeup only, no beauty retouching, no beauty filter, no skin smoothing. Ordinary background, not a professional shoot.
AVOID: airbrushed or plastic skin, skin smoothing, beauty filters, studio lighting, perfect symmetry, text, watermarks.
```

The lint (`lintPrompt`, `server/core/rules.ts`) runs on each built prompt, and the runner's `guardRealism` refuses at quote time any image prompt without a REALISM block, any prompt with a banned word, any hero or sheet prompt without the bare-face line, and any explicit term.

Mark lines (`markLines`, `server/core/prompts.ts`, templates `marks` in `config/templates.yaml`) state each mark with the character's own side, and for a front view also say which side of the image it appears on; a hidden mark is stated as hidden, and the other side is declared clean for jewelry or hidden marks. Hero and sheet use all marks; scenes and character slideshows use skin marks only; edits, Recreate and video use none, except the end frame helper, which names the character's skin marks by name (sample 4).

### A.5.2 The stages at a glance

| Stage | Builder (file) | Claude writes part? | Default model (config) | Images attached |
|---|---|---|---|---|
| Hero | `buildHeroPrompts` (`server/core/prompts.ts`), called from `buildAction` case `hero` | No (the card it uses may come from Claude's concepts step) | `higgsfield/gpt-image-2.5`, image, high, 2k, 3:4 (`config/routing.yaml` `hero`) | None (text only). 3 prompt variants, 1 to 8 runs each |
| Sheet ref | `buildSheetPrompt` (`server/core/prompts.ts`), `buildAction` case `sheet` | No | the sheet lock, else `higgsfield/gpt-image-2.5`, image edit, high, 2k (`routing.yaml` `sheet`) | The shot's `attach` refs from `config/sheet.yaml` (for example REF-03 attaches REF-00 and REF-01) |
| Scene still | `buildScenePrompt` (template), `assembleStillPrompt` (written), `assembleAsWritten` (pasted), all in `server/core/scenes.ts`; chosen in `buildSceneRun` (`server/pipeline/sceneActions.ts`). Also a plan clip row's opening still: Generate N posts calls `buildSceneRun` with one variation, no QA, on the character's slide model for the picked path and billed to that path (`buildPlanGenerate`, `server/pipeline/planImport.ts`) | Optional: the body only (`buildScenePromptWrite`, route `prompt_writer`). A plan clip row's scene fields are the row's words (A.6.2) | `higgsfield/gpt-image-2.5-flare` (`scenes.yaml`) | Up to 4 refs by angle (`pickSceneRefs`): REF-00, the closest angle, a body ref only at knees-up or full body, an expression ref |
| Edit | `buildEditPrompt` (`server/core/scenes.ts`), from `buildSceneEdit`, `buildSceneEndFrame` and the drift lock | No | `higgsfield/nano-banana-2.1` (`scenes.yaml` `edit_models`) | The still, plus REF-00 for a face edit |
| Face pass | `facePassRun` (`server/pipeline/clone.ts`), template `clone.face_pass`, then `buildEditPrompt` | No | the model that made the still | The still first, then REF-00 (plus one three-quarter ref without an Element) |
| Recreate still | `buildCloneStill` (`server/pipeline/clone.ts`), template `clone.recreate_still`, then `buildEditPrompt` | No (Claude's clip reader fills the traits, keep chips, outfit and motion fields) | `higgsfield/nano-banana-2.1` on the plan, `higgsfield/gpt-image-2.5` on the API (`content.yaml` `clone.scene_still`) | The clip's frame first, then REF-00 and REF-01 or REF-02 (or the Element on the plan), then an outfit still if picked |
| Motion | `buildClone` (`server/pipeline/clone.ts`), template `clone.motion`, then `assembleVideoPrompt` | No (the motion line can come from the clip reader) | `higgsfield/wan-3.0-motion` (`content.yaml` `clone.motion_model`) | The chosen still (`@Image1`) and the cleaned clip (`@Video1`) |
| Image to video | `assembleVideoPrompt` (`server/core/promptWriter.ts`), from `buildSceneVideo` (`sceneActions.ts`) | Optional: the labeled text (`buildScenePromptWrite` target `video`) | `higgsfield/kling-3.0-pro` (`scenes.yaml`) | The still as start frame, an end frame when the model takes one |
| Slideshow stills | `slideRequest` through `buildSlideshowStills` (`server/pipeline/slideshow.ts`): `buildScenePrompt` plus `slideshow_set` (character), or `slideshow_topic` (topic). Also every photo slide of a plan post from Generate N posts (`buildPlanGenerate`) | No. Claude's draft (Use this hook, A.5.4) fills each slide's shot and the locked scene; a plan draft takes them from the CSV's scene as written ("Slide N:" parts and the rest, A.6.2) | Per slide, by who is in it (`ed620c8`, G58, `server/core/stillModels.ts`): a slide with the character uses the character file's `scene_still`, else `scene_still_alt`, else `scenes.yaml` `default_still_model` (`higgsfield/gpt-image-2.5-flare`), else the first of `scenes.yaml` `still_models` the path runs; a slide with no one uses the cheapest of `content.yaml` `slideshow.empty_still_models` (Flare, Nano Banana 2.1, Soul 2) the path runs, priced from the price book at the Standard level (credits on the plan, dollars on the API; Flare today: 1 credit or $0.0625). The path is the owner's pick (Your Higgsfield plan or the Higgsfield API, `spec.stillPath`, the account's last pick in the setting `slideshow_still_path`), and every Higgsfield still is billed to it (`billing` set on every request, `request.slide.path`) | Character slides: scene refs by angle, cut to the model's `max_refs`; on the plan the character's Element too, except on a model with `elements: false` (Flare). Slides with no one: only the saved scene's look picture, if any |

Who is in a slide (`slidePerson`, `server/core/slides.ts`): a topic slideshow's slides show no one; in a character slideshow, the owner's pick on the slide card (`spec.people[i]`: `character` or `none`), else read from the shot for free (`shotShowsCharacter`): the character's name, their pronoun, a shot that starts with an `-ing` verb (not a thing such as "morning" or "building"), a selfie or a look at the lens show the character; anything else, or "no one" / "no faces", shows no one; an empty shot shows the character. A plan photo row is always the character. A no-one slide in a character slideshow is built like a topic still (`slideshow_topic`, stage `slideshow`, no refs, no face check) and the run warns "No one in N slides". A model runs on a path when (`runsOn`): on the plan, it has an account (MCP) entry; on the API, its `api` is not false; a model outside Higgsfield runs on either.

### A.5.3 Samples

Each sample below is real output: the Studio's own builder functions were run in a scratch copy with the options the pipeline passes, on the fake character from A.1.7 without its Realism section (card "27 years old. Chin-length auburn hair, loose waves, side part. Hazel eyes, oval face, soft arched brows. Average, slim build.", a small mole above her LEFT brow, no REALISM or AVOID block of her own, so the Studio defaults apply). The scene fields are fake. Samples 3, 7, 9a and 9b and the end frame line were produced again at `bdda34a` (sample 3, 9a and 9b through the real pipeline: `buildAction` on an in-memory database with the mock providers, nothing paid); 9a and 9b were run again at `b53f108` with the slide image model and came out the same, word for word. Samples 1, 2, 4, 5, 6 and 8 were produced at `3f7140a`; the templates and builders they use have not changed since.

**1. Hero.** Inputs: `card` (turned into "a woman, 27 years old. ..." because it starts with a digit), `marks` for the front view, `pronouns`, the background from the default rule `sheet-background`, one of three `variants`. Template `hero.base`.

```
Chest-up portrait of a woman, 27 years old. Chin-length auburn hair, loose waves, side part. Hazel eyes, oval face, soft arched brows. Average, slim build. Facing the camera, relaxed neutral expression. Plain light gray background, soft even daylight. Plain white crew-neck tee, hair in its usual style. The small mole above her LEFT brow is visible (it appears on the right side of the image, because her LEFT side is on the right as we face her). Photorealistic, natural skin with visible pores and small believable imperfections. Bare face, no makeup, no retouching.
REALISM: Candid iPhone photo, neutral natural light. Real skin texture: visible pores, soft peach fuzz catching the light on the cheeks and jaw, a few stray brow hairs and baby hairs at the hairline, subtle color variation with slight redness around the nose and cheeks, faint natural shine. No makeup, no beauty retouching, no beauty filter, no skin smoothing. Not a professional shoot.
AVOID: airbrushed or plastic skin, skin smoothing, beauty filters, studio lighting, perfect symmetry, text, watermarks.
```

**2. Sheet ref (REF-03, left profile, chest-up).** Inputs: the shot's `view`, `framing`, `expression` from `config/sheet.yaml`, the view text from `config/views.yaml`, marks for that view, the sheet outfit for the framing, `body` only at full body, an optional review fix line. Template `sheet.base`.

```
Using the attached reference images, keep this woman's face, hair, skin tone, and distinguishing marks exactly the same. Chest-up framing, from mid-chest to just above the top of the head. Full side profile: head turned 90 degrees so only her LEFT side faces the camera, LEFT ear fully visible; her nose points toward the left edge of the frame. The small mole above her LEFT brow is visible. Relaxed neutral expression, mouth closed. Plain light gray background, soft even daylight. Wearing a simple white crew-neck t-shirt. Photorealistic, natural skin with visible pores and the same small imperfections as the reference. Same person as the reference, not a lookalike. Bare face, no makeup, no retouching.
REALISM: Candid iPhone photo, neutral natural light. Real skin texture: visible pores, soft peach fuzz catching the light on the cheeks and jaw, a few stray brow hairs and baby hairs at the hairline, subtle color variation with slight redness around the nose and cheeks, faint natural shine. No makeup, no beauty retouching, no beauty filter, no skin smoothing. Not a professional shoot.
AVOID: airbrushed or plastic skin, skin smoothing, beauty filters, studio lighting, perfect symmetry, text, watermarks.
```

**3. Scene still (template path, the default model Flare).** Inputs: the scene fields (`moment`, `task`, `trigger`, `setting`, `outfit`, `footwear`, `jewelry`, `makeup`, `hair`, `pose`, `view`, `expression`, `camera`, `distance`, `phone`, `height`, `framing`, `light`, `destination`, `brands`) and the character's card, skin marks, pronouns and makeup lines. Template `scene.base` with the reference, adult, outfit-override, brand-free and hair-color lines. The fake fields: kitchen at night (so makeup by setting is bare), a friend's phone, rear camera, waist-up, light `night_practical`, hair "low loose ponytail". Since `7c07140` the moment and the setting each start their sentence with a capital letter ("A small apartment kitchen ..."; the 3f7140a sample had "a small ...").

```
Using the attached reference images, keep this woman's face, hair, and features exactly the same. She is an adult, 21 or older. Ada stirs a pan of fried rice at the stove after a night shift. Stirring the pan. Her phone buzzing on the counter catches her attention. A small apartment kitchen at night, dishes in the rack. She is wearing oversized gray knit sweater, black leggings, with white socks, wearing this outfit instead of the white t-shirt, jeans and sneakers in the reference images. No makeup, bare skin. Hair: low loose ponytail. Relaxed, caught mid-moment, soft, closed-mouth smile. The small mole above her LEFT brow is visible (it appears on the right side of the image, because her LEFT side is on the right as we face her). Candid phone photo taken by a friend about 6 feet away, on the rear camera, waist-up framing, eye level. Evening, lit by warm practical lights such as string lights and lamps, slight phone-camera grain. Everything she wears and holds is plain and unbranded, with no logos or readable text. Bare natural lips, no gloss.
REALISM: Candid iPhone photo, neutral natural light. Natural skin texture. No makeup, no beauty retouching, no beauty filter, no skin smoothing. Ordinary background, not a professional shoot.
AVOID: airbrushed or plastic skin, skin smoothing, beauty filters, studio lighting, perfect symmetry, text, watermarks.
```

With the prompt writer on, Claude's paragraph replaces the template body and the Studio wraps it (`assembleStillPrompt`): reference line, adult line, the written text (any REALISM or AVOID line in it is dropped), the exact outfit sentence, the mark lines, the hair-color line, the brand-free line, then the same tail. The writer's instructions are `prompt_writer.still_system` in `config/templates.yaml` (120 to 170 words, one paragraph, never the face, eyes, hair color, skin or marks, catalog wording, no mood words); its input is `writerFacts` (one `- Label: value.` line per filled field).

**4. Edit ("Fix one thing", preset "Look into the lens", a face edit).** Inputs: the change (one change per pass; more is a warning), whether it is a face edit, the scene's framing for the skin detail. Template `edit.base` plus `edit.face_ref`.

```
Turn her head slightly so she looks straight into the lens with a soft, knowing half-smile, mouth closed. Keep everything else in the image exactly the same. Use the attached reference image only for her face.
REALISM: Candid iPhone photo, neutral natural light. Natural skin texture. No makeup or light makeup only, no beauty retouching, no beauty filter, no skin smoothing. Ordinary background, not a professional shoot.
AVOID: airbrushed or plastic skin, skin smoothing, beauty filters, studio lighting, perfect symmetry, text, watermarks.
```

The end-frame helper wraps the change in `video.end_frame` and sends a head mask; the drift lock uses `edits.drift_lock` from `config/scenes.yaml`. Since `7c07140` the template's `{marks}` lists the character's own skin marks by name (", the mole"; jewelry left out; empty when there are none) instead of "the mole" for everyone. Filled for the fake character (then `buildEditPrompt` adds the REALISM and AVOID tail as above):

```
Edit only the masked area, her head and face: she turns her head toward the camera and looks into the lens. Keep her identity, hair, skin texture, the mole and everything outside the mask exactly the same.
```

**5. Face pass (Recreate, API path).** Inputs: the name, the face and hair sentences of the card only (`cardForPhotoEdit`: age, body, style and mood words removed), and on the plan the Element written as ` <<<ELEMENT_ID>>>`. Template `clone.face_pass`.

```
Edit the first image. Change only her face to match Ada Sample (the face in the other images): Chin-length auburn hair, loose waves, side part. Hazel eyes, oval face, soft arched brows. Use the other images only for the face. Keep everything else in the first image exactly the same, pixel for pixel: the hair, the outfit, the pose, the hands, the light, the background and the framing. Keep everything else in the image exactly the same.
REALISM: Natural skin texture, not retouched.
```

**6. Recreate still (API path, outfit kept from the clip).** Inputs: who to replace (`target_main`, or a tapped position `target_at`), the face words, the hair color read from the card, traits the result must not copy (`recreate_not_like`), keep chips, the outfit choice (`outfit_keep_named`, `outfit_hers_named` or `outfit_hers`). Template `clone.recreate_still`. Age is never written into a Recreate prompt; it is checked on the record before the run.

```
Use the first image only for the place, the light, the camera angle, the framing, the pose and the outfit. Replace the main person (the largest person, closest to the camera) in it completely with Ada Sample (the person in the other reference images): Chin-length auburn hair, loose waves, side part. Hazel eyes, oval face, soft arched brows. Her hair is chin-length auburn. She must not have that person's blonde bangs and dimples. Keep the head angle and the gaze of the first image. Remove all caption text, the TikTok logo and the username, leaving no text or watermark anywhere in the image. Black ribbed tank top, light wash jeans, same as in the photo. Keep everything else in the image exactly the same.
REALISM: Natural skin texture, not retouched.
```

**7. Motion (Recreate motion transfer).** Inputs: the hair color, the keep chips (else "her outfit, the place and the light"), the motion line. Template `clone.motion` filled with `fill`, then `assembleVideoPrompt` adds the silent line and the full REALISM block (no AVOID), as `buildClone` does. Kling 3.0 Motion Control on the Higgsfield plan takes no prompt, so it is sent empty there. Since `7c07140` "Silent." left the template, so sound off is said once.

```
Motion transfer. @Image1 defines everything you see: this exact woman, her face, chin-length auburn hair, her outfit, the place and the light, exactly as in @Image1 for the whole clip. The first frame matches @Image1. @Video1 is used ONLY for motion: copy its body movement, head turns, facial expressions, timing and handheld phone camera movement exactly, beat for beat. Never copy the person, the room, the caption text or the logo from @Video1. The motion: she sways side to side, points at the camera and laughs. Her face stays the same person from every angle. Her outfit stays exactly as in @Image1 for the whole clip, same cut, length and fit. One continuous take, no cuts. No text, no captions, no logos, no watermark. Candid phone video, natural skin, not retouched. Silent, no audio, no dialogue.
REALISM: Candid iPhone photo, neutral natural light. Real skin texture: visible pores, soft peach fuzz catching the light on the cheeks and jaw, a few stray brow hairs and baby hairs at the hairline, subtle color variation with slight redness around the nose and cheeks, faint natural shine. No makeup or light makeup only, no beauty retouching, no beauty filter, no skin smoothing. Ordinary background, not a professional shoot.
```

**8. Image to video (the owner's words, audio off).** Inputs: what happens (the owner's words, or Claude's labeled lines), the directions (default "No talking, no winking, steady eye contact. One continuous take, no cuts." plus any edit-style slot text; a chained take adds `video.continue`), audio on or off, the framing's skin detail.

```
Ada stirs the pan, glances up at the camera and smiles a little. No talking, no winking, steady eye contact. One continuous take, no cuts. Silent, no audio, no dialogue.
REALISM: Candid iPhone photo, neutral natural light. Natural skin texture. No makeup or light makeup only, no beauty retouching, no beauty filter, no skin smoothing. Ordinary background, not a professional shoot.
```

When Claude writes it, the text is labeled lines kept one per line, in the order `FORMAT:`, `SUBJECT:`, `SETTING/LIGHT:`, `CAMERA:`, `ACTION:`, `CONTINUITY:`, `AUDIO:`, `CONSTRAINTS:`; the Studio replaces the `FORMAT:` line with its own (`FORMAT: <duration> s, <aspect>, live-action personal phone video, one continuous take, no cuts.`) and the `AUDIO:` line with `AUDIO: Sound off: silent, no dialogue, no music.` (or the sound-on line), then adds the directions line and REALISM.

**9a. Slideshow still, character mode (locked scene, API model Flare).** Inputs: the slide's shot (made into a moment: "leaning on the counter" becomes "Ada Sample is leaning on the counter"), the locked scene (place, two details, light, camera, phone, outfit, and since 3f7140a hair from a plan row's "Hair:"), the post scene's other fields, then `buildScenePrompt` with `slideshow_set` as the addendum (and on the plan, `slideshow_element` with the Element). Produced through `buildAction` (`slideshow_stills`, live mode with a placeholder Higgsfield API key and no plan, so the path is the API; the slide shows the character, so the model is the file's `scene_still`, `higgsfield/gpt-image-2.5-flare`, billed to the API); the post's idea was "Cooking in my kitchen after a night shift", whose scene gives the makeup by setting (A.8.2, item 6). The hair is the rotation's first pick for a character with no history.

```
Using the attached reference images, keep this woman's face, hair, and features exactly the same. She is an adult, 21 or older. Ada Sample is leaning on the counter, eyes half closed. A small apartment kitchen. Also in the place: a dish rack by the sink, a sticky note on the fridge. She is wearing oversized gray knit sweater, black leggings, white socks, wearing this outfit instead of the white t-shirt, jeans and sneakers in the reference images. No makeup, bare skin. Hair: behind both shoulders. Relaxed, caught mid-moment, relaxed, natural expression. The small mole above her LEFT brow is visible (it appears on the right side of the image, because her LEFT side is on the right as we face her). Candid phone photo taken by a friend about 6 feet away, on the rear camera, waist-up framing, eye level. Soft daylight from a nearby window, the rest of the room a little darker. Her hair stays chin-length auburn and her skin tone is unchanged, even here. Everything she wears and holds is plain and unbranded, with no logos or readable text. This photo is one of a set from the same day, like one camera roll: the same place, light, phone and outfit in every photo of the set; only the moment changes. Bare natural lips, no gloss.
REALISM: Candid iPhone photo, neutral natural light. Natural skin texture. No makeup, no beauty retouching, no beauty filter, no skin smoothing. Ordinary background, not a professional shoot.
AVOID: airbrushed or plastic skin, skin smoothing, beauty filters, studio lighting, perfect symmetry, text, watermarks.
```

**9b. Slideshow still, topic mode (no person).** Inputs: the shot, the place, details, light (a preset's words), the camera words, the aspect. Template `slideshow_topic` plus the topic REALISM line; no AVOID block, no face check. With a saved scene's look picture attached, `slideshow_same_place` is added. Produced through `buildAction` as 9a (9:16, no refs; a slide with no one, so the cheapest of `empty_still_models` on the API, Flare). The same prompt is used for a no-one slide inside a character slideshow. Since 3f7140a the light sentence ends with one period (`7c07140`) and the template allows text on a screen or paper when the shot quotes it, word for word (it said "no readable text" before). The body ends with a space before the line break (A.8.2, item 7).

```
A candid phone photo for a photo slideshow, held at chest height. A laptop open on a desk next to a cold coffee. The place: a small home office. Also there: a desk lamp, a stack of mail. Soft daylight from a nearby window, the rest of the room a little darker. Every photo of the set is in this same place, light and phone, like one camera roll from one day. No one in focus and no faces; no logos or real brand names on anything; text on a screen or paper only where the shot quotes it, word for word. A 9:16 vertical frame. 
REALISM: A real phone photo with natural grain, real textures and uneven everyday light, not retouched or polished.
```

### A.5.4 Text writers: the general standard and a product's own rules (new since 3f7140a)

The slideshow writers are Claude text calls, not image prompts. Each is priced before it runs and goes through the `content_writer` route (`config/routing.yaml`: `anthropic/claude-sonnet-5-5`, effort low, switchable to Opus in Settings). What they write becomes the words on the slides, the caption and each slide's shot, which the stills builder above turns into photo prompts.

**Which rules a post is written to** (G57, UX-PLAN.md section 29, `server/pipeline/products.ts`):

- The post's product is `content_items.product_id` (one product or none). A new post takes its account's product from Posts home > Accounts (`social_accounts.product_id`, `defaultProductFor`), else none; copies, variations, batch rows, Recreate with another character and plan drafts keep their source's product. Never "the first product".
- With no product, or a product whose `writing` is `""`, the post gets the **general standard** alone: the unprefixed templates.
- A product whose `writing` is a key of `writing_standards` in `config/content.yaml` adds that standard's rules on top. Today there is one, `sidestep` (label "SideStep rules v1.2 (job word, pain 7+, honest endings)", `names: [SideStep]`: a product of that name starts on it at kit import, `writingForName`). Its flags: `review` (a separate reviewer call), `lint` (the language notes, A.4.10), `endings` (honest endings on an ad), `structures` (the playbook's structures per account).
- `templateFor(deps, std, name)` picks `<key>_<name>` from `config/templates.yaml` when it exists (`sidestep_slideshow_hooks`), else `<name>`.
- Written for a product and an ad for it are separate: the ad switch is #ad on the post (a plan row's `ad` column). `isProductPost(spec)` is `spec.ad`, or `spec.plan.product` with `spec.productEnding` not `"none"`; it puts "Ad:" first in the caption and sets `caption.ad` in post.json.

| Writer (action) | General standard | With a product's `sidestep` rules |
|---|---|---|
| Write 10 with Claude (`slideshow_hooks`) | `slideshow_hooks`, `{standard}` = `hook_standard`. One call. JSON per hook (`generalHooksJsonSchema`): `moment`, `pattern` (one of the 8 pattern ids), `hook`, `alt_hook`, `rank` 1 to 5. The writer runs the stop test itself (four checks) | `sidestep_slideshow_hooks`, `{standard}` = `sidestep_hook_standard` (with its pass and fail examples as the few-shot set), `{menu}` = `sidestep_playbook_menu` with `{ladder}` = `sidestep_playbook_ladder`, `{structures}` = the account's primary, backup and last code (`accountStructures`: the Accounts card, else the `playbook.fit` table in `config/content.yaml`). JSON per hook (`hooksJsonSchema`): `effect_open`, `effect_payoff` (E1 to E8), `moment`, `code` (S1 to S12, L13 to L25), `pain` 1 to 10, `hook`, `alt_hook`, `rank`. Then the reviewer `sidestep_slideshow_hooks_review`, a waiting child job (`parentIndex: 0`) under the same price; JSON per hook (`reviewJsonSchema`): `n`, `stops`, `job`, `exact`, `pain`, `friend`, `score`, `note`. Code makes a hook that fails any check, or has pain under 7, a 3 at best (`fails` lists the checks); only 1s and 2s show |
| Use this hook and Batch from hooks (`slideshow_draft`, `slideshow_batch`) | `slideshow_draft` | `sidestep_slideshow_draft`: adds `{structure}` ("Pour it into <code>..." from the hook card, or "Pick the structure or lens that fits the hook (S1 to S12, L13 to L25).") and, on an ad, the honest endings from `sidestep_product_endings` |
| Make variations (`slideshow_variations`) | `slideshow_variations`, `{standard}` = `hook_standard`; variation 1 uses the alt hook word for word when the post has one; each goes to another account of the same kind | the same template, `{standard}` = `sidestep_hook_standard` |
| A kit hook's variants (`hook_variants`), by the hook's own product | `hook_variants`, `{standard}` = `hook_standard` | the same template, `{standard}` = `sidestep_hook_standard` |
| Rewrite the caption (`slideshow_caption`) | `slideshow_caption`, the same for every product | the same |

Both drafts list the drawn screens from `slideshow_special_menu` (the 13 drawn types and their fields; never the product screenshot). The draft's JSON (`draftJsonSchema`): `slides[]` of `{ text, shot, special: { type ("none" or a drawn type), from, title, body, lines, time } }`, `scene` `{ place, light (a light id other than as_written), camera (a camera id, or a few words in topic mode), outfit, details (2) }`, `caption`, `cta`, `hashtags` (at most 5), `product_ending` (`"none"`, plus each ending's pain when the post is an ad on a product with endings). `draftPatch` keeps the hook word for word, cuts the other slides to 18 words, puts shots and outfits through the catalog wording, keeps at most 2 special slides (never slide 1, generic names only), fills only the scene fields the owner did not set, stores the CTA line and the hook card's code, effects, moment, alt hook and score in `spec.plan`; on an ad with endings, a known `product_ending` is kept (`productEnding`), anything else sets `productEnding: "none"` and turns #ad off. Hooks are cut only at 30 words (a cap against runaway answers); the lint notes a hook over 22.

What the draft writer is told about the product (`product_rule`), real output from `buildAction` (`slideshow_draft`) at `bdda34a` on fake products (`Pan Club` on the general standard, `Sample Kit` given the `sidestep` rules):

```
No product:                   There is no product: name no product or brand, and product_ending is "none".
Pan Club, not an ad:          This is not an ad: never name Pan Club, and product_ending is "none".
Pan Club, an ad:              This is a product post (an ad for Pan Club): the last slide is a friend's honest tip about Pan Club that fits the hook's story, in the same voice, inside its claims sheet only. Pan Club is never in the hook or the slides before the last two. product_ending is "none". The caption starts with "Ad:" naming Pan Club.
Sample Kit (sidestep), an ad: This is a product post (an ad). The last slide is a friend's tip that fixes the exact pain from slide 1, in the same voice ("my friend told me about Sample Kit fr fr..."), using only one of these honest endings, and only when Sample Kit really fixes that pain:
                              - retyping the resume into boxes: "one click fills the whole app. i just check it and hit submit"
                              - hours on jobs you don't fit: "it shows how u match before u apply"
                              - rewriting the resume for every job: "it shows exactly what to add from stuff i actually did"
                              - paying monthly for job tools: "$99 once. no subscription"
                              product_ending is that ending's pain, word for word. Ghosting, fake jobs, layoffs, salary games, scams and interview rounds stay pure pain: if the hook's pain is one of those, or no ending above fixes it, never name Sample Kit anywhere, the last slide is relief or a question, and product_ending is "none". Never "stop getting ghosted", "stop getting passed over" or "it applies for you": Sample Kit cannot promise replies and never submits for anyone. Sample Kit is never in the hook or slides 1 to 5. Inside its claims sheet only. When it is named, the caption starts with "Ad:" naming it.
```

The endings are the `sidestep` standard's data, so any product given those rules gets them under its own name. The hook writer gets a shorter line (`productLine`); for `Sample Kit` as an ad, from the same run: "This is a product post: its last slide will be a friend's tip that fixes the hook's pain, so pick pains Sample Kit really fixes: retyping the resume into boxes; hours on jobs you don't fit; rewriting the resume for every job; paying monthly for job tools. Any other pain stays pure pain. Sample Kit is never in the hook." Not an ad: "This is not an ad: <product> is never named." No product: nothing.

Sample: the general standard's Write 10 with Claude prompt (system, then prompt) for the fake character, account `ada.cooks`, no product, produced at `bdda34a` through `buildAction` (`slideshow_hooks`). The empty lines are empty variables (`{product}`, `{tension}`, `{claims}`).

```
You write hooks for TikTok and Instagram photo slideshows for Ada Sample, an original, fictional adult character.
A hook is the words on slide 1, and every hook follows this standard:
Why we post: people share a post that names something they feel so
exactly that they send it to someone who feels it too. The reaction on
slide 1: "wait, that's me." Shares and follows come from that, not from
clever.
The hook (slide 1):
- Says exactly what happened: the number, the thing, the moment. Never a
  pointer like "how bad it is" or "it did not go how i thought".
- Clear on one read, with no image: about 15 words or fewer. A stranger
  knows what it is about without the photo. No labels or stage
  directions ("Exhibit 3:", "Levels of...", a timestamp first), no
  stacked quotes.
- Opens a loop the slides close. The punchline never sits on slide 1.
The voice: the account's own, from its voice card when one is given;
otherwise plain words, the way a real person texts a friend. Never
marketing copy: if it could run in a print ad, rewrite it.
The stop test (every hook, before anything else; any "no" means rewrite):
1. Would a stranger scrolling past stop on this line alone?
2. Is it clear on one read, with no image?
3. Does it say exactly what happened?
4. Does it sound like a person, not a brand?
Moments and the story shape slides 2 to 6 and the payoff; they never
replace a plain, clear slide 1.
Write exactly 10 candidates for this account's next post. For each
one, in this order:
1. moment: one specific scene of what happened, in one line: when,
   where, what is on screen, and the tell (one detail only someone who
   lived it would know). It feeds slides 2 to 6.
2. pattern: the hook's shape, one of doubt (someone doubts or reacts),
   pov, nobody_tells, red_flags, listicle, storytime, myth_fact,
   tier_list. Spread the candidates over at least 4 shapes.
3. Write 3 hooks for the moment and run the stop test on all three;
   keep the best as hook and the runner-up as alt_hook. rank is your
   own score of the kept hook: 1 passes the stop test and is sharp
   enough to share, 2 passes it. Only keep hooks that pass.

Language: no quotation marks around the hook; an emoji only where a
person would text it. No em or en dashes. Roast the situation, never
the viewer. No real people, celebrities, named shows, songs, creators,
logos or real companies by name. Adults only. Original words only:
learn from the vault's hooks, never copy one. A product named stays
inside its claims sheet. Nothing sexual, no medical or money promises.
Never say the photos are real or that anyone in them is a real person.

Account: ada.cooks
Who posts it: Ada Sample, an original, fictional adult character
Ada Sample's voice card (write every line the way Ada Sample talks):
- Who: 27, night-shift nurse, cooks to unwind
- Point of view: every recipe is a small rescue
- Talks like: "okay hear me out", "no notes"
- Words and phrases Ada Sample uses: okay hear me out; no notes
- Humor: deadpan
- Emoji: one per caption
- Never: diet talk; shaming
- Content pillars: One Pan Monday (recipes); Fridge Clear-out (leftovers)
- Example line in this voice: Okay hear me out: rice, an egg, and spite.
Topic: cooking after a night shift


Hooks from the vault (learn from them, never copy one):
None yet.

No buyer language collected yet.



Write 10 candidates.
```

For a topic (faceless) post, `{who}` is "a faceless topic account (<tag>): no person in the photos, only places, things and mock screens" and no voice card is sent: nothing of the character the post is filed under goes in.

---

## A.6 Batch and plan import

What the Studio accepts today. **Excel files (.xlsx) are not parsed anywhere**: there is no spreadsheet library in the project, only CSV-style text. Since 3f7140a a **content plan import is built**: the launch plan CSV (A.6.2). A **posting calendar is not built** (the roadmap in `docs/studio/PLAN.md` lists it as not started). "Plan the details" in the Stills step is a priced Claude action that fills one scene's fields; it is not an import.

### A.6.1 Batch spreadsheet (CSV, or rows pasted from a spreadsheet)

One row per video post. Code: `server/core/csvImport.ts` (`parseCsv`, `headerMap`, `csvRows`, `planRows`), `server/pipeline/csvImport.ts` (`previewImport`, `runImport`), UI `src/studio/pages/post/ImportCard.tsx`.

- **Where**: a Batch post, Idea step, card **Import a spreadsheet**: paste the rows (with the header line) or **Upload a CSV** (`accept=".csv,text/csv,text/plain"`); **Download a template** saves `batch-template.csv`; **Preview (free)**; **Make N posts**. A switch, on by default: "Export the ones that reuse a clip now (free, on the worker)".
- **Encoding**: the browser reads the file as UTF-8 (`File.text()`); a leading byte-order mark is removed (`parseCsv`). No other encoding is detected.
- **Delimiter**: whichever of comma, semicolon or tab appears most in the header line (ties go to comma, then semicolon, then tab). Cells copied from Excel or Google Sheets paste as tab-separated text and work.
- **Quoting**: RFC 4180 style. A quote opens a quoted cell only at the start of a cell; `""` inside quotes is one quote; delimiters and line breaks inside quotes are kept. Row ends: `\n`, `\r\n`, `\r`. All-blank rows are dropped. Cells are trimmed.
- **Header**: required (the first non-blank row). Header text is trimmed, lower-cased and inner spaces collapsed, then matched exactly against the aliases below. Column order does not matter. A duplicate or unknown column is reported as "Columns not used: ...".
- **Limits**: 50 rows (`config/content.yaml` `batch.max`; the rest are dropped, with a warning in the preview). 200,000 characters per import (client check "<name> is over 200 KB. Split it."; server check "That file is too big for one import (200 KB). Split it.").

| Column | Header aliases (exact, after lower-casing) | Required | Type | Rules |
|---|---|---|---|---|
| `character` | `character`, `char`, `creator`, `persona`, `who` | optional | string | Empty: the batch's own character. Matched by name, case-insensitive, spaces, `_` and `-` treated alike. Errors: "Name the character", "No character named "<x>"", "<n> characters are called "<x>"; import from that character's batch" |
| `account` | `account`, `account tag`, `account_tag`, `handle`, `tag` | optional | string | One leading `@` removed, cut to 60 characters. Empty: the batch's account tag |
| `clip` | `clip`, `clip name`, `clip_name`, `reuse`, `reuse clip` | `clip` or `still` column must exist | string | The name of an approved clip of that character (matched like the character name, `.mp4`, `.mov`, `.webm` ignored), or `still: <prompt>`. A real clip wins over any still prompt. Errors: "No clip named "<x>" for <Name>", "Name a clip to reuse, or write "still: your prompt"" |
| `still` | `still`, `still prompt`, `still_prompt`, `image prompt`, `prompt` | see above | string | A new still prompt (wins over `still:` in the clip cell) |
| `video` | `video`, `video prompt`, `video_prompt`, `motion` | optional | string | Used only for rows that generate; added to the post's idea as "In the video: <text>" |
| `caption` | `caption`, `text`, `hook`, `on-screen text` | optional | string | Over 400 characters is a problem (row skipped). Also the post title (first 60 characters). A missing caption column is reported but rows still import |
| `style` | `style`, `edit style`, `edit_style`, `format`, `edit` | optional | string | An edit style by label or id from `config/edits.yaml` (for example `Crash zoom cut` or `crash_zoom`). Error: "No edit style called "<x>"" |

Edit style ids and labels: `crash_zoom` Crash zoom cut, `punch_in` Punch-in on the beat, `flash_shake` Flash and impact shake, `word_pop` Word-by-word text pop, `hand_lens` Hand over the lens, `velocity` Velocity edit, `karaoke` Karaoke captions, `green_screen` Green-screen reaction, `spin` Zoom-rotate spin, `record_scratch` Record-scratch freeze, `speed_ramp` Speed ramp to slow motion, `freeze_pop` Freeze frame and caption pop, `seamless_loop` Seamless loop, `whip_pan` Whip pan transition, `zoom_reveal` Zoom-out reveal, `text_behind` Text behind subject, `split_screen` Split screen or duet, `glitch` Glitch hit, `dolly_zoom` Dolly zoom (vertigo), `snap_zoom` Snap zoom.

What each row becomes: a new video post (kind `meme`), not linked to the batch. Status `reuse` (a clip is reused: free, opens at Finish, exported at once when the switch is on), `generate` (opens at the Stills step; the still and the take are priced later inside that post, each with its own quote), or `problem` (skipped). The import itself never spends.

Endpoints:

- `POST /api/v1/content/:id/import/preview` body `{ "csv": string }` (max 200,000). Returns `{ rows, problems, totals: { rows, reuse, generate, problem, usd }, priceNote }`; each row has `line`, `characterId`, `characterName`, `accountTag`, `clipId`, `clipTitle`, `stillPrompt`, `videoPrompt`, `caption`, `style`, `status`, `problems`, `priceUsd`. `priceUsd` is an estimate for a generate row: one still on the default still model plus a 5 s take on the default video model, from the price book.
- `POST /api/v1/content/:id/import` body `{ "csv": string, "exportFree": boolean (default true) }`. Returns 201 `{ created: [{ line, id, status }], exporting, skipped, notExported: [{ line, id, reason }] }`. The server parses the CSV again; it does not reuse the preview. Since `7c07140` a malformed body (no `csv`, or over 200,000 characters) answers 400 `bad_request` naming the field, as the preview route does.

Built-in template (`ImportCard.tsx`) header, with fake rows. Run through `csvRows` in a scratch copy at 3f7140a, it parses with no problems; the header and the parser have not changed since.

```csv
character,account,clip,video,caption,style
Ada Sample,ada.cooks,stir-fry-take.mp4,,dinner after a 12 hour shift,Crash zoom cut
Ada Sample,ada.cooks,"still: at the stove at night, one pan, steam rising",she tastes it and looks at the camera,the freezer is my sous chef,
```

### A.6.2 The launch plan CSV (new since 3f7140a)

One row per post, any mix of formats and accounts. Built for the 140-post launch plan (UX-PLAN.md sections 28 and 29, DECISIONS G56 and G57); the spec files are in `docs/content/` (`launch-plan-v2-posts.csv`, `viral-writing-playbook.md`, `post-writer-brief.md`, `sidestep-script-kit.md`). Code: `server/core/planImport.ts` (pure: `readPlan`, `checkRow`, `planKind`, `sceneParts`, `specialFor`, `scheduleOrder`, `repeatedCodes`), `server/core/planMeta.ts` (`planMetaSchema`, what a post keeps), `server/pipeline/planImport.ts` (`previewPlan`, `importPlan`, `planView`, `buildPlanGenerate`), UI `src/studio/pages/PlanCard.tsx`. The import is code, not Claude: every word is kept as written.

- **Where**: Posts home, the **Launch plan** card, four numbered steps: 1 **Upload the CSV** (`accept=".csv,text/csv,text/plain"`, or paste the rows), 2 **Preview (free)** with the switch **Draw mock screens by code** (off), 3 **This plan is for** (a product, or No product, for the rows that name none; pre-filled when the plan's accounts agree on one product on the Accounts card) and **tick the rows to import** (none ticked at first; filter by day or account, Tick the shown, Tick all), 4 **Import N rows (free)**. Then tick posts and **Generate N posts** (priced).
- **Reading**: `parseCsv` as in A.6.1 (byte-order mark, delimiter, quoting, row ends). The header is trimmed, lower-cased and each run of spaces becomes `_` (`Row ID` reads as `row_id`); columns are read by name in any order; with a duplicate name the first column wins. Cells are trimmed; all-blank rows are dropped; `line` is the row's number after the header (the first data row is 2).
- **Limits**: 400,000 characters (client "<name> is over 400 KB. Split it."; server "That file is too big for one import (400 KB). Split it."), the first 300 rows ("Only the first 300 rows are read."), Generate up to 100 posts in one click.
- **Problems for the whole file**: `Missing column(s): <list>.` for any of the required `row_id`, `date`, `account`, `format`, `hook`; `Columns not used: <list>.` for headers not in the list below.

Columns (`PLAN_COLUMNS`, 31):

| Column | Required | Read as |
|---|---|---|
| `row_id` | yes | The row's id; must be unique in the file. A post made from it is matched by account and `row_id` on the next import |
| `date` | yes (column) | `YYYY-MM-DD`; another shape is an error; empty is a warning ("No date: it goes at the end of the plan") |
| `slot` | | `AM`, `PM` or `Daily` (case-insensitive); anything else is a warning and sorts as Daily |
| `account` | yes | The account tag (one leading `@` removed). For a character format it must equal a character's name (case-insensitive) |
| `format` | yes | `character slideshow`, `character photo`, `character clip`, or any text containing `slideshow` (a topic slideshow: `slideshow list`, `slideshow story`, `mock UI slideshow`, `stat slideshow`); anything else is an error |
| `tension`, `pillar`, `audience` | | Tags kept as written (12 characters each) |
| `product` | | A product's **name** (case-insensitive, among the account's live products); blank: the plan's pick (step 3). A name not in Products is an error ("Product "<x>" is not in Products (Library > Hooks): add it there, or fix the row"). An older file's `yes` or `no` here is read as the `ad` column, with the plan's pick as the product (G57) |
| `ad` | | `yes` or `no` (also y, true, 1, n, false, 0): an ad for its product (#ad, "Ad:", the honest endings). Anything else is a warning and reads as no |
| `mention_mother` | | yes or no, kept |
| `structure` | | `S1` to `S12`, `L13` to `L25`, with or without the name (`S11 Contrast pair`), or the name alone; anything else is a warning |
| `effect_open`, `effect_payoff` | | `E1` to `E8` (a name may follow); anything else is a warning |
| `hook_score` | | 1 to 5; anything else is a warning; 3 or more warns "only a 1 or 2 ships (playbook)" |
| `moment_id`, `moment` | | Kept; `moment` is also the post's idea, and a photo row's shot |
| `hook` | yes | Slide 1, or a clip's on-screen text |
| `alt_hook` | | Kept: **Swap with the alt hook** and Make variations use it |
| `slide_2` to `slide_6` | slideshow rows | The other slides, as written; a slideshow row with none of them is an error, a gap is a warning; trailing empty slides are dropped |
| `scene` | | Split by `sceneParts`: `Outfit:` and `Hair:` are taken out (and used on character rows only), a leading "Character slideshow, 9:16, locked scene:" is dropped, `Slide N:`, `Slides N to M:` (or `-`, `and`) give each slide's shot, and the words before the first marker are the locked place. Without markers, a character set's numbered stills ("Six stills, same framing: 1 ...; 2 ...") are read the same way |
| `clip_action` | clip rows | What happens in the video; a clip row without it is a warning |
| `caption`, `hashtags` | | The caption to post and its hashtags (`#` and commas optional), as written |
| `cta` | | The CTA line, added after the caption in "As posted" |
| `stat_source`, `notes` | | Kept |

What each ticked good row becomes (`importPlan`, free, in schedule order: day, then AM, Daily, PM, then the file's order):

| Format | Becomes |
|---|---|
| A topic slideshow | A slideshow post (`mode: "topic"`, no one in the photos) at the Stills step: title `<row_id>: <hook>`, idea = `moment`, the hook and slides 2 to 6 as written, each slide's shot from the scene, the locked place, the caption, hashtags, CTA line, `ad`, `cta.kind: "own"`, `pattern: null`, `spec.plan`. With **Draw mock screens by code** on, a slide whose scene words describe a screen the Studio draws becomes that special slide, its quoted words in the fields (`specialFor`: placard, lock screen, calendar invite, receipt or invoice, bank or savings app, survey, portal or status timeline, application form, profile card, text thread, notification, job posting, mock email; real brand names swapped for generic ones). Filed under the account's picked character (the preview's pick, else a character named like the tag, else the oldest character): storage only |
| A character slideshow | The same with `mode: "character"`, filed under the character named like the account, the lock's outfit and hair from `Outfit:` and `Hair:`. Drawn screens come only from the owner (a slide card's picture menu): the switch reads topic rows only |
| A character photo | A one-slide character slideshow: the hook is the slide's words, the `moment` column its shot, and the slide always shows the character (`people: ["character"]`) |
| A character clip | A video post (kind `meme`) at the Stills step with a new scene for the character: the scene as written is its brief, its fields `setting` (the place), `outfit`, `hair`, `moment` (the first sentence of `clip_action`, else `moment`), its video prompt `clip_action`; the post's on-screen text is the hook; caption, hashtags and CTA line wait in `spec.plan` for the Text and Finish steps |

Every draft gets its product: the row's own, else the plan's pick, else none. Importing the same file again updates drafts that have no pictures yet (matched by account and `row_id`) and keeps the ones that do (`kept`). Rows not ticked make no draft. Errors in a row skip it.

The preview (`previewPlan`) also checks, per row, what needs the database: the account's character, duplicate `row_id`s, the product name, and the language notes of the row's own product (A.4.10: the hook, slides and the CSV's caption as written, with the row's `ad`); and, when the plan's product (step 3) has the playbook's structures, a row whose account used the same structure on its post before (`repeatedCodes`). It prices each row on the picked stills path (`b53f108`): each photo slide by its own model (A.5.2: a topic row's slides the cheapest model for no one; a character row's slide the character's default when `shotShowsCharacter` reads the shot as the character, else the cheapest; a photo row and a clip's one still the character's default), in plan credits on the plan and dollars on the API (`priceUsd`, `credits`, and `price` as shown, for example "6 credits"), 0 for problem and kept rows.

**Generate N posts** (action `plan_generate`, `{ postIds: string[] (1 to 100), path?: "account" or "api" }`, one quote; an older `stillModel` is read as its path): each ticked post in schedule order: a slideshow or photo gets a still for every empty photo slide (`buildSlideshowStills`, each slide's model by who is in it), a clip its opening still (`buildSceneRun`, one variation, no QA, the character's default on the path, billed to it); its take is made later in the post with its own price. The path picked is saved as the account's default. A post that cannot be built is skipped with a reason (warning `plan-skipped`). Posts run ten at a time: the job specs carry `queue: { group }`, a new group every 10 posts (warning `plan-queue`, A.7.2).

Endpoints:

- `POST /api/v1/plan/preview` body `{ "csv": string (max 400,000), "drawSpecials"?: boolean, "store"?: { "<account tag>": "<characterId>" }, "path"?: "account" or "api" or null, "stillModel"?: string or null (older pages, read as its path), "productId"?: string or null, "rows"?: string[] (max 2000) }`. Returns `{ rows, accounts, days, problems, totals: { rows, ok, problem, kept, slideshows, photos, clips, stills, usd, credits, price }, still: { path, pathLabel, problem, paths: [{ path, label, problem }], models: [{ who, label, perStill, from: "file" or "studio" or "cheapest" }] }, planId, product, suggestedProductId, blankProductRows }`; each row has `line`, `rowId`, `date`, `slot`, `account`, `format`, `kind`, `hook`, `photos`, `specials`, `priceUsd`, `credits`, `price`, `product`, `productFrom` (`row` or `plan`), `ad`, `errors`, `warnings`, `lint`, `postId`, `state` (`new`, `update`, `kept`, `problem`).
- `POST /api/v1/plan/import` (member role) with the same body; `rows` is required in practice ("Tick the rows to import first."), and `productId` (a product or `null`) when a ticked good row names no product ("Pick the plan's product first (or No product): some ticked rows name no product of their own."). Returns `{ created, updated, kept, skipped, posts: [{ rowId, id, state }] }`.
- `GET /api/v1/plan` returns `{ posts }` in schedule order, each with `need` and `have` (photo slides and the stills on them) and `exported`.
- Generate goes `POST /api/v1/actions/estimate` then `POST /api/v1/actions/run` with `{ "action": { "type": "plan_generate", "postIds": [...], "path": "account" } }`.
- `GET /api/v1/slideshow/still-models?characterId=` returns the two paths and, for a character, what each path makes (`{ pick, name, paths: [{ path, label, problem, character: { ref, label, from, perStill }, empty: { ... } }] }`); `PUT /api/v1/slideshow/still-model` `{ "path": "account" or "api" }` saves the pick.

Sample, a fake plan (31 columns, the current shape) run through the real `readPlan`, `checkRow`, `scheduleOrder`, `repeatedCodes`, `sceneParts` and `specialFor` in a scratch run at `bdda34a`:

```csv
row_id,date,slot,account,format,tension,pillar,audience,product,ad,mention_mother,structure,effect_open,effect_payoff,hook_score,moment_id,moment,hook,alt_hook,slide_2,slide_3,slide_4,slide_5,slide_6,scene,clip_action,caption,hashtags,cta,stat_source,notes
R001,2026-11-02,AM,F1,mock UI slideshow,T2,P1,A1,,no,no,S11 Contrast pair,E1 That's literally me,E4 LMAO,2,F1-M01,"Sunday 9:40pm, a fridge with one lemon and six sauces. The tell: last week's meal prep containers are still in the dishwasher.",i bought 14 meal prep containers in january. i have used 2,14 containers. 2 meals prepped. it is november,they live in the dishwasher now. rent free,my phone at 9:40pm: 'Reminder' 'meal prep Sunday',so i opened the fridge to plan the week,one lemon. six sauces. zero plan,what is in your fridge right now? be honest,"A small apartment kitchen at night. Slide 1: a kitchen counter with a tall stack of empty plastic containers, warm lamp light. Slide 2: an open dishwasher full of containers. Slide 3: a lock screen notification reading 'Reminder' and 'meal prep Sunday' at 9:40 PM. Slide 4: a hand on an open fridge door. Slide 5: the fridge shelf with one lemon and six sauce bottles, no labels readable. Slide 6: the counter again, one container with a lid on. No brand names.",,the containers are thriving. i am not,#mealprep #sundayreset #kitchentok,what is in your fridge right now?,,Story details invented.
R002,2026-11-02,PM,Ada Sample,character clip,T1,P2,A2,Pan Club,yes,no,S6 Teaser,E3,E6,1,ADA-M01,"7:10am after a night shift, still in scrubs, one pan on the stove.",night shift ended at 7. dinner is at 7:10. it is one pan,,,,,,,"Character clip, 9:16, locked scene: a small apartment kitchen at dawn, window light. Outfit: navy scrub top, gray joggers. Hair: low loose ponytail.","She cracks an egg into the pan, looks at the camera and shrugs. She takes the first bite.","no notes. rice, an egg and spite",#nightshift #onepan #easydinner #nurselife,what do you cook after a long shift?,,
R003,2026-11-03,Noon,Ada Sample,character photo,T1,P2,A2,yes,,no,S6,E1,E4,4,ADA-M02,"Ada at the window with the first coffee after a shift.",the coffee after a night shift hits different,,,,,,,"Character photo, 9:16: a small apartment kitchen, morning window light. Outfit: oversized gray knit sweater.",,first coffee. second wind,#nightshift,,,
R004,2026-11-03,AM,F1,carousel,,,,,,,,,,,,,,,,,,,,,,,,,,
```

`readPlan`: no missing or unused columns, 4 rows. `checkRow`:

| line | row_id | kind | ad | product name | code | score | errors | warnings |
|---|---|---|---|---|---|---|---|---|
| 2 | R001 | `topic_slideshow` | false | (blank: the plan's pick) | S11 | 2 | | |
| 3 | R002 | `clip` | true | `Pan Club` | S6 | 1 | | |
| 4 | R003 | `photo` | true (an older `product: yes`, no `ad`) | (blank: the plan's pick) | S6 | 4 | | `Slot "Noon" is not AM, PM or Daily`; `hook_score 4: only a 1 or 2 ships (playbook)` |
| 5 | R004 | `null` | false | | | | `No hook`; `Format "carousel" is not one the Studio makes (slideshow list, slideshow story, mock UI slideshow, stat slideshow, character slideshow, character photo, character clip)` | |

`scheduleOrder`: R001, R002, R004, R003 (on 2026-11-03, AM before "Noon", which ranks as Daily). `repeatedCodes`: line 4 (R003 repeats S6 after R002 on the same account; shown only when the plan's product has the playbook's structures). `planId`: `plan-2026-11-02`.

`sceneParts` for R001 and R002:

```json
{ "common": "A small apartment kitchen at night.",
  "slides": { "1": "a kitchen counter with a tall stack of empty plastic containers, warm lamp light.",
              "2": "an open dishwasher full of containers.",
              "3": "a lock screen notification reading 'Reminder' and 'meal prep Sunday' at 9:40 PM.",
              "4": "a hand on an open fridge door.",
              "5": "the fridge shelf with one lemon and six sauce bottles, no labels readable.",
              "6": "the counter again, one container with a lid on. No brand names." },
  "outfit": "", "hair": "" }
{ "common": "a small apartment kitchen at dawn, window light.", "slides": {},
  "outfit": "navy scrub top, gray joggers.", "hair": "low loose ponytail." }
```

`specialFor` on R001's slide 3 (the only slide whose words describe a drawn screen): `{ "type": "lock_screen", "from": "", "title": "", "body": "", "lines": ["Reminder", "meal prep Sunday"], "time": "9:40 PM", "variant": "", "count": 0, "blur": false, "assetId": null, "scale": 0.72, "ratio": 0.5 }`. The post.json of the drafts from R001 and R002 are the samples in A.2.3 and A.2.4.

The real launch plan, `docs/content/launch-plan-v2-posts.csv` (read the same way in the scratch run, counts only): 140 rows, 30 columns (the older shape: no `ad` column, `product` is yes or no, 28 rows yes, so 28 ads with the plan's pick as their product), CRLF line endings (read fine), accounts `F2`, `F3`, `F6`, `F7`, `CALLIE`, `SOLEI`. Formats: `mock UI slideshow` 43, `slideshow story` 28, `stat slideshow` 21, `slideshow list` 20 (112 topic slideshows), `character slideshow` 10, `character clip` 10, `character photo` 8. `checkRow` finds no errors; the account check needs characters named CALLIE and SOLEI.

### A.6.3 Batch captions (one per line)

Batch post, Captions step: "Captions, one per line, optional". Split on line breaks, trimmed, blank lines dropped, at most 50, each at most 400 characters (the video draws the first 220). Saved through `PATCH /api/v1/content/:id` `{ "spec": { "captions": string[] } }`. Each line becomes one video of the batch; the batch's clips and B-roll rotate across the captions (clip `i mod n`). Free to paste and to render; **Write N captions** (Claude) is priced.

### A.6.4 Slideshow "Batch from hooks" (one per line)

Slideshow post, Idea step, card **Batch from hooks**: "Hooks, one a line (N of 10)". At most 10 lines (schema `batchHooks`, max 10 items of 200 characters; since `7c07140` the config's `slideshow.batch_max` allows at most 10 too). Each hook is cleaned (long dashes become ", ", outer quotes removed, cut to its first 30 words; it was 14 at 3f7140a). **Make N slideshows** is one priced run: each hook gets a Claude draft (the post's product's draft template, A.5.4) and a still for every slide, as a new slideshow with `batch_of` set to the parent and the parent's product; one review screen offers Approve (export, free), Reroll (priced) and Reject (archived). Run through `POST /api/v1/actions/estimate` then `POST /api/v1/actions/run` with `{ "action": { "type": "slideshow_batch", "contentId": "<id>" } }`.

### A.6.5 Script kit (.md)

Library > Hooks, **Import a script kit** (`.md`, `.markdown`, `.txt`; at most 200 KB). `POST /api/v1/products/import` body `{ "markdown"?: string, "starter"?: boolean, "name"?: string }`. Parser `parseScriptKit` (`server/core/scriptKit.ts`); headings `#` to `####`, compared after removing `**`, a leading `N. ` and case:

- Product name: the first `#` heading minus "script kit..." and "v<n>...".
- **Claims sheet** (title starts with `claims`): `Label:` lines open a group, bullets under it are items; `Label: value` lines are one-line rules; the group whose label contains "never" gives the watch words. The words that count as naming the product (`mentions`) are the product's name only (it also had "extension" at 3f7140a).
- **Buyer language** (title matches `buyer` or `language`): the same group format.
- **Hook vault** (title contains `hook vault`): numbered lines `1. ...` or `1) ...`; a subsection title (minus any trailing "(...)") is the hook kind. At most 500 hooks.
- **Voice cards** (title contains `voice card`): each subsection is one voice; `Name (live)` fills empty voice-card fields of the character with that name; "proposed" or "to build" cards are stored only.
- Everything else is kept as notes.

A kit with no hooks and no claims is refused: "No hooks or claims found. A kit has a "Claims sheet" section and a "Hook vault" section with numbered hooks." Importing is free. A new product starts on the writing standard that names it (`writingForName`: a kit named SideStep starts on `sidestep`), any other on the general standard; the owner changes it on the product's card (**Writing rules**, `PATCH /api/v1/products/:id` `{ "writing": "<key>" or "" }`).

### A.6.6 Results CSV (`c23ac34`, G60, UX-PLAN section 32)

Posts home > Results, **paste or upload a CSV** of what posts did (free; no platform API is read). Code: `readResultsCsv`, `readCount`, `readPostedAt`, `readDecision` (`server/core/results.ts`), `previewResultsCsv`, `applyResultsCsv`, `setPostResults` (`server/pipeline/results.ts`).

- **Reading**: `parseCsv` as in A.6.1. Headers are lower-cased, runs of spaces and hyphens become `_`, other characters dropped, then matched to `row_id`, `post_id`, `account`, `post_url`, `posted_at`, `views_72h`, `follows_72h`, `saves_72h`, `shares_72h`, `decision`, `notes`, or an alias (`url`, `link`, `post_link`, `tiktok_url`; `posted`, `posted_on`, `date_posted`, `post_date`; `views`, `follows`, `followers`, `new_followers`, `saves`, `shares`; `note`; `account_tag`; `studio_id`). `row_id` or `post_id` is required; other headers are named as not used.
- **Matching**: by the plan's `row_id`; `post_id` (the Studio's `cnt_...`) for a post with no plan row; an `account` column when two accounts share a `row_id`.
- **Values**: counts as `12.4K`, `1,203`, `1.2M`; `posted_at` in ISO, `10/19/2026 9:14 PM` (month first, day first when the first number is over 12), `19.10.2026 21:14` (day first), `Oct 19, 2026 9:14 PM`, a weekday in front allowed, a time zone dropped; `decision` as Make 3 variations, Keep, One more try (or retry), Drop, or none to clear. A blank cell leaves the field as it is; a value that does not read is an error on that row.
- **Endpoints**: `POST /api/v1/results/csv/preview` `{ "csv": string (max 400,000) }` (free: matched posts, their changes, row_ids not found, unused columns), then `POST /api/v1/results/csv/apply` (member role). One post's results: `PUT /api/v1/content/:id/results` `{ postUrl?, postedAt?, views72h?, follows72h?, saves72h?, shares72h?, decision?, notes? }`, written into `spec.results` on its own (it never moves the post up Posts home). `GET /api/v1/results?from=&to=&tag=&character=&product=` gives the totals and breakdowns (by account, product, character and hook structure, follows per post first).
- **Hints** (`config/content.yaml` `results`): 50,000 views or more suggests Make 3 variations; a hook family with 2 posts under 1,000 views suggests Drop. Suggestions only; the decision is the owner's.

### A.6.7 Not built

- `.xlsx` parsing, `.tsv` in the file pickers (pasted tab-separated rows do work), a posting calendar, a bulk Recreate import (Recreate batch rows are added one at a time).
- Planned only in `LATER.md`, for the batch spreadsheet: a CSV `voice` column, a CSV `hook` column, a "Generate all new rows" button (the launch plan has its own Generate N posts).

---

## A.7 Provider interface

### A.7.1 The contract (`server/providers/types.ts`)

Unchanged since 3f7140a. Every image, video and audio generation goes through one interface, `ProviderAdapter`:

```ts
interface ProviderAdapter {
  id: string
  needsPublicAssetUrls?: boolean            // true: the runner fills AssetRef.url before submit
  uploadAsset?(data: Buffer, mime: string): Promise<string>   // put bytes in the provider's storage, return what its models accept
  listModels(): Promise<ModelInfo[]>
  estimate(req: GenRequest): Promise<CostEstimate>
  submit(req: GenRequest, opts: { idempotencyKey: string; webhookUrl?: string }): Promise<{ jobId: string; raw?: unknown }>
  status(jobId: string): Promise<JobStatus>
  result(jobId: string): Promise<Output[]>
  cancel?(jobId: string): Promise<void>
  verifyWebhook?(input: { headers; query; body }): boolean
  download?(output: Output): Promise<Buffer>   // custom download instead of the runner's guarded HTTP fetch
  verifyCredentials?(): Promise<{ ok: boolean; message: string }>
  charges?(): Promise<Array<{ name: string; credits: number; at: string }>>  // recent account charges, newest first
  exactPrice?(req: GenRequest): Promise<{ credits: number; micros: number } | null>
}
```

`GenRequest` (what the pipeline asks for):

| Field | Type | Meaning |
|---|---|---|
| `kind` | `image`, `image_edit`, `video`, `video_extend`, `video_clone`, `audio`, `train_identity`, `upscale` | |
| `model` | string | model ref `provider/model`, for example `higgsfield/gpt-image-2.5-flare`; the part before `/` picks the adapter |
| `prompt` | string | the finished prompt (A.5) |
| `refs` | `AssetRef[]` | reference images, in order (REF-00 first) |
| `startFrame`, `endFrame` | `AssetRef` | image to video |
| `sourceVideo` | `AssetRef` | Recreate and clone: the clip |
| `mask` | `AssetRef` | masked edit: white may change |
| `maskFor` | `{ assetId, region: "head" }` | a head mask the runner builds on the worker before submit |
| `aspect`, `resolution`, `quality` | string | for example `9:16`, `2k`, `high` |
| `durationSec` | number | |
| `audio` | boolean | only `true` turns sound on; video is stored silent otherwise |
| `seed` | number | |
| `identityId` | string | a saved provider identity (trained Soul character) |
| `scale` | `2` | upscale factor, never more |
| `billing` | `api` or `account` | Higgsfield only, stamped at quote time |
| `modelTest`, `cloneBackground`, `keepSourceSound`, `promptFrom`, `voiceId`, `modelRef`, `quotedCredits`, `slide` | | Studio bookkeeping; most are never sent to a provider |

`AssetRef` is `{ assetId, url?, width?, height? }`; `url` is filled by the runner just before submit and never stored. `JobStatus` is `{ state: "queued" | "running" | "succeeded" | "failed" | "nsfw" | "canceled", outputs?: Output[], error?: string, pollAfterSec?: number, raw?: unknown }`. `Output` is `{ url, kind: "image" | "video" | "audio", mime?, width?, height?, durationSec? }`. `CostEstimate` is `{ totalMicros, lines: [{ label, quantity, unit, unitPriceMicros, amountMicros }], priceVersion, verified, credits?, note? }` (money in micro-dollars).

Errors are thrown as `ProviderError(message, { retryable: boolean, submitted: "no" | "unknown", status?, code?, detail? })`. `submitted: "unknown"` means the provider may have accepted (and charged) the job; the runner never resubmits it.

### A.7.2 How the Studio calls an adapter (the job runner)

Code: `server/jobs/runner.ts`, `server/providers/registry.ts`, `server/costs/pricebook.ts`, `server/costs/quotes.ts`, `server/costs/budgets.ts`, `config/runtime.yaml`, `config/budgets.yaml`.

1. **Pick the adapter.** `registry.gen(accountId, modelRef, { billing })` splits the ref on `/`. `mock` gives the mock adapter; `elevenlabs` the voice adapter; `higgsfield` with billing `account` the MCP account adapter; `higgsfield` otherwise the REST API adapter with the account's key. Any other provider fails: with no stored key for it, "Add your <p> API key in Settings to run this live."; with one, "No adapter for provider "<p>" yet."
2. **Quote** (`quoteJobs`, before any spend). The realism and safety lint runs first and refuses a prompt without the REALISM block, with a banned smoothing word, without the bare-face line on a hero or sheet shot, or with explicit terms (`guardRealism`). Then `adapter.estimate(request)` per job (identical requests priced once, 4 at a time). Then the budget caps (fixed, `checkBudget`): the run's total over the per-run cap (`job`, $3.00), the account's spend this calendar month (UTC) plus its open holds plus the run over `month` ($200.00), or, for a run with a character, that character's lifetime spend plus its holds plus the run over `character` ($50.00) blocks the quote (`status: "blocked"`). The **daily cap** (`ec22ba7`, G59, UX-PLAN section 31) is checked the same way: `day` ($10.00 in `config/budgets.yaml`, budget scope `day` per account), today being the calendar day in UTC (`dayWindow`); today's spend is today's charges plus the holds of runs under way (`daySpend`; a queued group that has not started holds nothing yet), and plan credits count at the price book's API rate (`api_credit_usd` in `config/pricebook.yaml`, $0.0625 a credit), so one cap covers both Higgsfield paths. A run over it reads **Waits**: "Waits: today's spend $X + this run $Y would pass your $10 daily cap. Raise the cap in Settings > Budgets and usage, or run it tomorrow (UTC). Nothing is charged while it waits." (`dayCapMessage`); every block now says which cap in plain words, and every price shows "today $X of $10". For a run queued in groups only the first group counts at the quote (`runDayMicros`, `startNow`). From `warn_pct` (80%) of a cap it warns; a run above `confirm_above` ($0.50) needs one more confirmation. Defaults are `config/budgets.yaml`, edited per account in Settings. The quote is stored with an id and expires after `quote_ttl_sec` (900 s).
3. **Run** (`runJobs` with the quote id). The jobs are priced again and must match the quote; the budget is checked again inside the run's transaction (runs are serialized per account, so two runs cannot both pass a cap; over a cap: `budget_exceeded`). Each job row gets `idempotencyKey = "<quoteId>:<index>"` and a ledger **hold** for its estimate. A job can wait on a parent job in the same run (`parentIndex`). Since 3f7140a a run can also hold **queue groups** (`JobSpec.queue: { group }`, used by the plan's Generate N posts, ten posts a group): every job of the run gets `request.queue = { id: "que_...", group }`; group 0 starts `queued`, later groups start `waiting`; after every job's hook, `advanceQueue` starts the lowest waiting group once no job of an earlier group is queued, submitting, running or ingesting (or waiting on a parent), logs an `activated` event and wakes the worker. Since `ec22ba7` the daily cap is checked there first (`capHolds`): a group that would pass it stays `waiting` with its hold (nothing charged), each of its jobs gets the error `{ message, capWait: true }` with the same "Waits: ... this group ..." words and one `cap_wait` event, and `resumeCapWaits` starts it when the cap is raised or on a new day (UTC), checked when the cap changes and when the Studio reads its runs.
4. **Submit** (worker, `submitGen`). If `needsPublicAssetUrls`, every `AssetRef` gets a `url`: from `adapter.uploadAsset(bytes, mime)` when the adapter has it (cached 6 hours per asset checksum), else a short-lived public URL of the Studio's own storage. Then `adapter.submit(request, { idempotencyKey, webhookUrl })`. `webhookUrl` is `<public base>/api/v1/webhooks/<provider>/<jobId>?t=<token>` when a public base URL is set. The job moves to `running` with the provider's `jobId`. On the Higgsfield API, `adapter.exactPrice` is then asked for the provider's own price and logged next to the quote.
5. **Poll** (`pollGen`). `adapter.status(jobId)`. `queued` or `running`: poll again after `pollAfterSec`, else a backoff of 2 s times 1.5 per poll, capped at 10 s (`poll_initial_sec`, `poll_backoff`, `poll_max_sec`). A job still running after `stuck_after_sec` (image and image edit 600 s, video 1800 s, audio 900 s) gets a "stuck" event; it keeps polling. A webhook only wakes the poll; its body is never trusted. `succeeded`: outputs from the status, else `adapter.result(jobId)`. `failed`, `nsfw`, `canceled`: the hold is released, nothing is charged, the job's hook runs with the error.
6. **Ingest** (`ingestGen`). Each output is downloaded with `adapter.download(output)` if the adapter has it, else the runner's guarded fetch (hosts allowed per provider in `config/runtime.yaml` `downloads.allowed_hosts`, private and loopback addresses always refused, 500 MB, 120 s). A video is stored silent unless the request asked for audio. Outputs are saved as assets.
7. **Settle.** Higgsfield account path: the quoted plan credits are charged, then `adapter.charges()` (the account's transactions) is matched to log the real credits next to the quote. Every other path: the actual cost is computed from the **price book** (`actualGen`, using the measured video length), not from the adapter. Ledger entries: `hold`, `release`, `charge`, in micro-dollars. A cost check flags a run more than 20% off its quote.
8. **Hook.** The job's purpose (for example `clone_still:<postId>:...`) selects a pipeline hook that runs the free checks (face, skin, scene) and files the result. Then `advanceQueue` (step 3).
9. **Cancel.** `cancelJob` calls `adapter.cancel?.(providerJobId)` when the job is `running` at the provider, then releases the hold.

Error handling (`handleProviderError`): `submitted: "unknown"` puts the job in `needs_attention` and keeps the hold ("check its console before retrying"). `retryable: true` is retried up to `submit_max_attempts` (3) with the same backoff. Anything else fails the job and releases the hold. A worker that died mid-submit also leaves the job in `needs_attention`. A failed download is retried with the same backoff until the job's attempt count reaches `submit_max_attempts + 3`, then the job goes to `needs_attention`.

Cost reporting data (`config/pricebook.yaml`): entries `{ provider, model, unit: image | second | call | mtok_in | mtok_out | mtok_cache_read | mtok_cache_write, price (USD, may be 0), verified, when?: { resolution?, quality?, aspect? }, credits?, credits_verified?, source? }`. A model with no matching entry cannot be quoted: "No price for <ref> per <unit>. Add it to the price book before running."

### A.7.3 The two Higgsfield adapters as built

Unchanged since 3f7140a.

**REST API** (`createHiggsfieldAdapter`, `server/providers/higgsfield.ts`, id `higgsfield`, through `@higgsfield/client` v2):

| Method | Call |
|---|---|
| `submit` | SDK `subscribe(endpoint, { input: mapInput(entry, req), withPolling: false, webhook? })` with header `Idempotency-Key: <idempotencyKey>`; SDK retries off. Returns `request_id` |
| `status`, `result` | `GET /requests/{id}/status`. `completed` with at least one image or video is the only success; `queued`, `in_progress`, `failed`/`error`, `nsfw`/`moderated`/`content_filtered`/`rejected`, `canceled`/`cancelled` map to the states above |
| `cancel` | `POST /requests/{id}/cancel` |
| `uploadAsset` | `POST /files/generate-upload-url { content_type }`, then `PUT` the bytes to `upload_url`; returns `public_url` |
| `exactPrice` | `POST /estimate/{endpoint}` with the same input; returns credits and dollars (free) |
| `estimate` | the price book (`estimateGen`) |
| `verifyCredentials` | a status lookup for a job that does not exist (404 means the key works) |

The request body is built per model family from `input_map` in `config/models.yaml`: `marketing_image`, `soul_v2`, `soul_v1`, `generic_image`, `generic_upscale`, `seedance_i2v`, `wan_i2v`, `wan_reference`, `kling_v3`, `kling_motion_control`, `genjutsu_motion`, `seedance_video_edit`, `kling_o3_edit`, `generic_audio`, `generic_video`. Every body goes through `forceBeautifyOff` plus the model's `force_off` list, so no beautify, face-enhance, skin-smoothing or prompt-enhance option is ever on. Status codes: 401 bad key, 403 not enough credits, 400 and 422 rejected, 404 unknown model, 423, 429, 502, 503, 504 retryable; a timeout after sending a submit is `submitted: "unknown"`.

**Account (MCP, plan credits)** (`createHiggsfieldAccountAdapter`, `server/providers/higgsfieldAccount.ts`): tools `generate_image_batch`, `generate_video_batch`, `generate_audio_batch` (submit), `generate_image`/`generate_video`/`generate_audio` with `get_cost: true` (live price, 6 s wait, cached per request shape), `motion_control`, `upscale_image`, `upscale_video`, `jobs_wait` with `timeout_seconds: 0` (status), `media_upload` plus `media_confirm` (references are media ids, not URLs), `balance`, `transactions` (real cost), `show_medias`. `use_unlim` is always false.

### A.7.4 What a ComfyUI adapter would implement

No ComfyUI code exists in the repository today. The ComfyUI routes below were read from ComfyUI's own `server.py` and `execution.py` (master branch, 2026-10-16) for the 3f7140a edition and were not read again; every route is also served under `/api`.

| Adapter method | ComfyUI HTTP call | Notes |
|---|---|---|
| `id` | `"comfyui"` | Model refs `comfyui/<name>` route to it |
| `needsPublicAssetUrls` | `true` | So the runner calls `uploadAsset` for every reference, start frame, end frame, mask and source clip |
| `uploadAsset(data, mime)` | `POST /upload/image`, multipart fields `image` (the file), `type=input`, `subfolder` (optional), `overwrite` (`"true"` or `"1"`, optional) | Returns `{ name, subfolder, type }`. Return a string the adapter can later put into a load node, for example `<subfolder>/<name>`. The route writes the bytes as sent (it does not check the type), so it can carry a source clip too. Without `overwrite`, a same-named different file gets ` (1)` added |
| `listModels()` | none | From `config/models.yaml` entries whose ref starts with `comfyui/` |
| `estimate(req)` | none | `estimateGen(config, req)` with price book entries for provider `comfyui` (price `0` is allowed) |
| `submit(req, { idempotencyKey })` | `POST /prompt` with `{ "prompt": <API-format workflow>, "client_id": "<string>", "prompt_id"?: "<uuid>" }` | The adapter loads the workflow for `req.model` (exported from ComfyUI with Save (API)) and writes `req.prompt`, the uploaded names, `aspect`, `resolution`, `seed` and `durationSec` into its node inputs. Response `{ prompt_id, number, node_errors }`; an invalid workflow is HTTP 400 `{ error: { type, message, details, extra_info }, node_errors }` (throw `ProviderError` with `retryable: false, submitted: "no"`). Connection refused: `retryable: true, submitted: "no"`. Timeout after sending: `submitted: "unknown"` |
| `status(jobId)` | `GET /history/{prompt_id}`, and `GET /queue` | History returns `{}` until the job ends, then `{ <prompt_id>: { prompt, outputs: { <node_id>: { images?: [{ filename, subfolder, type }], ... } }, status: { status_str: "success" | "error", completed: boolean, messages: [...] } } }`. Not in history: look in `/queue` (`queue_pending` gives `queued`, `queue_running` gives `running`; each item is `[number, prompt_id, ...]`). In neither: treat as failed (for example the server restarted). `success`: `succeeded` with outputs |
| `result(jobId)` | `GET /history/{prompt_id}` | Each output file becomes `Output { url: "<base>/view?filename=<f>&subfolder=<s>&type=<t>", kind }`. Output keys differ by save node, so read every file entry under each node |
| `download(output)` | `GET /view?filename=&subfolder=&type=output` | **Needed**: the runner's own download refuses private and loopback addresses, where a local ComfyUI usually runs |
| `cancel(jobId)` | pending: `POST /queue { "delete": [prompt_id] }`; running: `POST /interrupt { "prompt_id": "<id>" }` | |
| `verifyCredentials()` | `GET /system_stats` | ComfyUI has no API key of its own |
| `exactPrice`, `charges`, `verifyWebhook` | none | Leave out: no billing, no webhooks (the runner polls; ComfyUI's `/ws` websocket is not needed) |

Idempotency: ComfyUI accepts a client-supplied `prompt_id` (a canonical lower-case UUID) but does not refuse a repeated one, so it does not protect against a double submit. A UUID derived from `idempotencyKey` lets the adapter look the job up in `/queue` and `/history` before posting again. ComfyUI keeps the last 10,000 finished prompts in history.

A queued group (A.7.2, step 3) needs nothing from the adapter: the runner holds its jobs in `waiting` and submits them only when their group starts.

### A.7.5 Can it be added without editing core files?

**Not entirely.** The adapter itself is a new file, and models, prices and routing are data, but one core file has to change, and two Studio choices assume Higgsfield.

1. **Registry (required, about 3 lines).** `registry.gen()` in `server/providers/registry.ts` only knows `mock`, `elevenlabs` and `higgsfield`. Add, before the vault key lookup: `if (p === 'comfyui') return createComfyUiAdapter({ config: o.config, baseUrl: <from env or config> })`. The alternative that leaves the registry alone: `createRegistry` already accepts `overrides: { gen: { comfyui: adapter } }` (checked before the key lookup, used by tests); passing it from `server/bootstrap.ts` is a one-line change there instead.
2. **New file**: `server/providers/comfyui.ts` implementing A.7.4.
3. **Data only** (no code):
   - `config/models.yaml`: one entry per ComfyUI workflow, for example `ref: comfyui/flux-scene-still`, `label`, `kinds`, `max_refs`, `endpoint` (can hold the workflow file name), `input_map` (any string; the ComfyUI adapter decides how to use it), `verified`, and `clone` for a motion workflow.
   - `config/pricebook.yaml`: an entry per model and unit with provider `comfyui` (price 0 is fine). Required: the runner prices every finished job from the price book (`actualGen` in `ingestGen`), whatever the adapter's own `estimate` returns, so a missing entry stops the job at ingest (and at quote time when `estimate` uses the price book too). The slideshow stills and the plan import's preview price each still from the price book as well (`stillPrice`, `slidePrice`), and the model for a slide with no one is the cheapest by those prices; a model with no `image` entry at the Standard level is skipped there (shown as "no price yet").
   - `config/routing.yaml` (`hero`, `sheet`, `upscale`), `config/scenes.yaml` (scene still and video models; `default_still_model` and `still_models`, which a character slide picks from), `config/content.yaml` (`slideshow.empty_still_models` for slides with no one, the Recreate stills and motion models): point at `comfyui/...` refs. A character file's `preferred_models.scene_still` can name one too, if it is in `still_models`.
   - `config/runtime.yaml` `stuck_after_sec` if local runs are slower.
4. **Higgsfield assumptions in code** (small changes if those flows should use ComfyUI):
   - Slideshow stills and the plan's Generate N posts (since `ed620c8`) pick a **path**, not a model: "Your Higgsfield plan" or "Higgsfield API" (`slideStillPaths`, `stillPathFor`); in live mode the plan path needs the Higgsfield account connected and the API path a Higgsfield API key, whatever model a slide uses. The model is then chosen per slide (`characterStill`, `cheapestStill`), and `runsOn` lets a model outside Higgsfield run on either path, so a `comfyui/...` ref listed in `still_models` or `empty_still_models` with a price book entry is picked like any other, with no `billing` stamped (`pathRun` stamps Higgsfield models only). A path for ComfyUI itself would be new code in `server/core/stillModels.ts` (`StillPath`, `PATH_LABELS`) and `slideStillPaths`.
   - Recreate stills still offer exactly two fixed choices (`recreateStillChoices` in `server/pipeline/clone.ts`: Nano Banana 2.1 on the plan, GPT Image 2.5 on the API). A `comfyui/...` ref in the API slot is blocked in live mode unless a Higgsfield API key is set (`apiKeyReady`), and is labeled "Higgsfield API".
   - The Recreate motion picker's path check (`motionPath` in `server/pipeline/clone.ts`) only knows the Higgsfield plan and the Higgsfield API; a `comfyui/...` motion model fails it in live mode without a Higgsfield key.
   - Higgsfield Elements (saved identities) ride along only on the Higgsfield plan path; a ComfyUI run gets the attached refs only.

---

## A.8 Gaps found while writing this appendix

Observed in the code or in the scratch runs, not fixed by this task (it changed no code). They matter mostly for a team copying the Studio's behavior.

### A.8.1 Gaps from the 3f7140a edition, at bdda34a

1. **Template v1.6 Models heading was not read for models.** **Fixed** in `7c07140`: any title starting with the word `Models` or `Model` is read; "Video from stills: X for finals, Y as the cheaper default" sets both video roles and is never a still model; "Hero and sheet: X" sets the sheet model (A.1.4, A.1.7).
2. **post.json existed for slideshows only.** **Partly fixed** in `c377d91`: video posts write post.json version 2 next to the MP4 (A.2.4). **Still open** for batches of video posts: their zip holds MP4s and `captions.txt` only (A.2.5).
3. **Topic slideshow prompts ended the light sentence with two periods.** **Fixed** in `7c07140` (sample 9b).
4. **The scene `setting` sentence was not capitalized.** **Fixed** in `7c07140`: the moment and the setting both start their sentences with a capital letter (sample 3).
5. **`neutral-body-cups` matched "A cup".** **Fixed** in `7c07140`: the pattern starts at `B` and skips a cup "of" something, in `config/rules.yaml` and in the card check (A.1.6, A.4.5).
6. **The CSV import run route answered 500 on a malformed body.** **Fixed** in `7c07140`: 400 `bad_request` naming the field (A.6.1).
7. **Batch from hooks cap**: the config allowed 20, the post stores 10. **Fixed** in `7c07140`: `slideshow.batch_max` is at most 10 (A.6.4).
8. **The end-frame edit template named "the mole" for everyone.** **Fixed** in `7c07140`: `{marks}` names the character's own skin marks, empty with none (sample 4).
9. **The motion prompt repeated the silent line.** **Fixed** in `7c07140`: "Silent." left the template; the Studio still adds "Silent, no audio, no dialogue." (sample 7).

### A.8.2 New at bdda34a

1. **post.json has no product.** The post's product (`content_items.product_id`, the thing its writing rules follow) is not written to either post.json; `plan.product`, and a video post's `caption.ad`, is the ad switch under the plan's older column name (A.2.2, A.2.4). Read in the code and seen in both samples.
2. **A topic post's post.json names a character.** A faceless slideshow is filed under a character for storage only, but post.json writes that character as `post.character` and uses its `disclosure` as `ai_label` (A.2.3).
3. **The plan id can come from a bad date.** `planIdOf` takes the earliest date string of every row, error rows included: a scratch file with one row dated `11/03/2026` (an error) was named `plan-11/03/2026`, because that string sorts before the ISO dates. Observed in a scratch run.
4. **The plan preview and a video post's Text step lint the caption as written; the slideshow screens lint it as posted.** On a product whose rules have lint on, an ad whose caption does not start with "Ad:" gets `lint-ad-caption` in the plan preview (the CSV's caption) and in a video post's Text step (`spec.plan.caption`), though the export puts "Ad:" first (`postCaption`, both post.json files) and the slideshow screens check the caption that way. Read in the code; the check itself was run (A.4.10 sample).
5. **`lint-just` flags "just" before a noun after a sentence break.** "no notes. just rice, an egg and spite" gives `"just rice" reads as an order.` Only on posts whose product's rules have lint on. Observed in a scratch run.
6. **A slideshow's locked place does not feed makeup by setting.** The makeup comes from the post's own scene (made from the idea) before the lock's place is applied (`effectiveFields`, then the lock, in `stillContext`), so a kitchen lock on a post whose idea named no place ("What I cook after a night shift") got the soft everyday makeup line instead of "No makeup, bare skin." The same code was there at 3f7140a. Observed in a scratch run.
7. **Topic stills on GPT Image 2.5 Flare end the body with a space.** The model's line "Bare natural lips, no gloss." is added and then removed for topic stills, and the space before it stays before the REALISM line (sample 9b). Cosmetic. Observed in a scratch run.
8. **The plan preview's structure warning follows the plan's product, not each row's.** `repeatedCodes` warnings are added when the product picked in step 3 has the playbook's structures; a row that names its own product does not change that. Read in the code, not run.
9. **Docs name SideStep's templates without their prefix.** UX-PLAN.md section 28 says `hook_standard`, `playbook_ladder` and `product_endings`, and DECISIONS G56 says `slideshow_hooks_review`; since Products the keys are `sidestep_hook_standard`, `sidestep_playbook_ladder`, `sidestep_product_endings` and `sidestep_slideshow_hooks_review`, and `hook_standard` is the general standard (A.5.4). Doc drift only.
