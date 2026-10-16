# Appendix A: What the Character Studio does, as built

Companion to `character-system-comfyui-spec.md`. The spec describes the method; this appendix describes what the Studio's code does today, so a team running the same character system on ComfyUI with local models can match it.

## How to read this appendix

- **Source.** Everything here was read from the `character-studio` branch of the Studio repository at commit `3f7140a` (2026-10-16). Paths are relative to the repository root. Where a sample was produced by running the Studio's own functions on fake input in a scratch copy, it says so.
- **Not built.** When something asked about does not exist in the code, this appendix says **Not built** and does not describe a design for it.
- **Placeholders.** Every name, ID, handle and key in the samples is fake (`Ada Sample`, `00000000-0000-4000-8000-000000000000`, `VOICEIDPLACEHOLDER0001`, `cnt_SAMPLEPOST000001`). No keys, environment values, database addresses or private links appear here. Environment settings are named, never given values.
- **Fixed and default.** The Studio sorts every rule into two buckets (`config/rules.yaml`, `bucket:`). **Fixed** rules can stop a run and cannot be switched off (the realism principle, bare face on hero and sheet, 21 or older, no nudity, a new person never a copy, AI labeling, a price before every paid run, budget caps, keys server-side). **Default** rules are pre-filled, can be switched off per account or per character in Settings > Rules, and at most warn.
- **Money.** Every paid call needs a quote the owner has seen. Prices are in the price book (`config/pricebook.yaml`); amounts inside the code are micro-dollars.
- **IDs.** Records use prefixed, time-sortable IDs: `chr_` character, `cnt_` post, `cand_` still or take, `ast_` file, `job_` job, `qte_` quote, `scn_` scene, `ssc_` saved slideshow scene.

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

Sections are split on `## ` headings only (`###` is not a split), and headings inside code fences are ignored (`splitSections`). Section titles are matched case-insensitively after removing everything that is not a letter or space, so `## Models (UNIVERSAL ...)` and `## Models` normalize differently (see A.1.4).

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
| `persona.voice` | object | optional | | Keys: `elevenlabsId`, `who`, `talks`, `uses` (string[]), `never` (string[]), `emoji`, `humor`, `pov`, `pillars` (string[]), `example` |
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
| Exactly `Models` or `Model notes` | `identities`, `preferred_models`, `avoid_models` | A line with a UUID and `element`, `identity`, `character` or `soul_id` becomes an identity. Model names are matched against each model's `label` and `aliases` in `config/models.yaml` (longest name wins). Key words: `avoid` to `avoid_models`; `video` plus `final` to `video_final`; `video` plus `test`/`cheap`/`motion` to `video_test`; `still`/`scene`/`image` to `scene_still`; `edit` to `edit`; `also`/`alternat`/`second` adds `_alt`; a bullet with no key that says `sheet` to `sheet`. Keys `drift lock` or `follow-up` attach a follow-up pass to the identity whose model they name |
| `Saved identity` | `identities` | Each line with a UUID: an Element if it says `element`, else a trained identity, status `ready` |
| `Fixed blocks` or `Prompt blocks` | `realism`, identity `promptBlock` | `REALISM: ...` to `realism.block`, `AVOID: ...` to `realism.avoid`, `<WORD> IDENTITY: ...` to the matching identity's `promptBlock` |
| Any title starting with `Realism` | `realism` | Bullets keyed `REALISM`, `Realism block` or `Block` set `realism.block`; `AVOID` sets `realism.avoid` (these win over Fixed blocks). Other lines and the lead paragraph become `realism.notes` |
| `Notes` | `notes` | |
| (whole file) | `pronouns` | Counts she/her/hers, he/him/his, they/them/their; the most common wins, she by default |

Every section the importer does not consume is kept as written in `sections`. Several are read later from there:

- **Brand layer** (`readBrand`, `server/core/brand.ts`): `## Brand` bullets `Interest`, `Sub-interest`, `Arc`, `Brand statement`; `## Why people watch` bullets `Series`, `Running bits`, `Cast` (lists split on `;` or `,`), `Payoff style`, `How they film` (or she, he); `## Accounts` (kept as text); `## Winning stack ...` and `## Growth log` (one bullet per item). A value still holding a template placeholder such as `[Name]` reads as empty.
- **Combo log** (`## Combo log ...`): read by the hair rotation and the variety note (A.4.6, A.4.8).
- **Scene rules**, **Video rules**, **Recipe** sections and the **Reference sheet** table are kept for people and for the template check; the prompt builders do not parse them.

Observed in a scratch run: with template v1.6's heading `## Models (UNIVERSAL defaults, update as tests change)`, the title does not normalize to exactly `models`, so preferred and avoided models are **not** read from it (the section is kept as text, and the template check still counts it). With the heading `## Models` they are read.

### A.1.5 The template check (`checkTemplate`, `server/core/templateCheck.ts`)

Template version `1.6`. Free, no Claude. It never blocks an import; with a needed item missing, the button reads "Import anyway".

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
- **Update** (`characterId` given, or the File step): `updateCharacter` runs `validateCharacter` and refuses with `invalid_request` when the age is missing or under 21, the card is empty, or a mark has no LEFT or RIGHT side. A card over 40 words or cup sizes and measurements in the card or body are warnings only.
- **Update merge** (`mergeReimport`): the file's words replace the character's words. Posts, takes, stills, clips and the sheet are separate records and stay. The combo log is merged (both logs, duplicates removed, sorted by date, newest `combo_window` kept; the Studio's entries survive). Saved identities the file leaves out are kept. The voice card and the REALISM block are kept when the file has none.
- Warnings are returned as plain sentences in `warnings` (for example "Jewelry is not a fixed mark, so it is kept as a style idea: ...", "No REALISM block in the file; every image prompt uses the Studio's default one.").

### A.1.7 Sample character (JSON, fake values)

This is the Studio header as JSON. Put it between two `---` lines at the top of a `.md` file and the importer reads it (YAML reads JSON). It was produced by running a fake hand-written file through `importCharacterFile` and `exportCharacterFile` in a scratch copy, then read back through `importCharacterFile` with the same result. The Element ID and voice ID are placeholders. `sections` are not in the header; they follow it as `## ` sections.

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

- **Slideshows**: built. Export images (free, on the worker) writes one zip with both sizes, `caption.txt` and `post.json`. The mapping lives only in `postExportJson` (`server/core/postExport.ts`); the caller is `renderSlideshow` in `server/pipeline/slideshow.ts`.
- **Video posts**: **post.json is not built.** A video post's export is a single MP4 asset (no zip, no JSON). The post record keeps `outputs.videoAssetId`, `durationSec`, `preset` (the export preset id), `capped`, `sound`, `editNote`, `fromTimeline`, `fromEditor`, `variants` (hook variants) and `cover` (`ContentOutputs`, `server/pipeline/content.ts`), but nothing writes them to a file.
- **Batches of video posts**: no post.json. The download is a zip (or zip parts) of MP4s plus `captions.txt` (A.2.4).
- The file comment says "The posting engine's format is coming later". `POST_EXPORT_VERSION` is `1`.

### A.2.2 Schema (`postExportJson` output)

| Path | Type | Source |
|---|---|---|
| `format` | `"character-studio.post"` | constant |
| `version` | number, `1` | `POST_EXPORT_VERSION` |
| `exported_at` | ISO 8601 string | export time |
| `post.id` | string (`cnt_...`) | the post |
| `post.kind` | string: `"slideshow"` (the post kinds are `meme` for a video post, `slideshow`, `batch`) | |
| `post.title` | string | |
| `post.idea` | string | the Idea step text |
| `post.account` | string or `null` | account tag, `null` when empty |
| `post.character` | `{ id: string, name: string or null }` or `null` | `null` when the post has no character |
| `post.variation_of` | string or `null` | parent post id for a variation |
| `post.batch_of` | string or `null` | parent post id for a batch row |
| `post.created_at`, `post.updated_at` | ISO 8601 strings | |
| `slideshow.photos_of` | `"character"` or `"topic"` | who is in the photos |
| `slideshow.hook` | string | slide 1 text |
| `slideshow.hook_pattern` | `{ id, label }` or `null` | ids: `doubt`, `pov`, `nobody_tells`, `red_flags`, `listicle`, `storytime`, `myth_fact`, `tier_list` |
| `slideshow.text_style` | `"classic"`, `"box"`, `"minimal"` or `"note"` | |
| `slideshow.made_for` | `"tiktok"` or `"instagram"` | the shape the stills were generated in (9:16 or 3:4) |
| `slideshow.scene.place` | string | the locked scene |
| `slideshow.scene.light` | string | a light preset id from `config/scenes.yaml` (for example `window`) or empty |
| `slideshow.scene.camera` | string | a camera preset id (for example `friend_phone`) or empty |
| `slideshow.scene.phone` | `""`, `"front"` or `"rear"` | |
| `slideshow.scene.outfit` | string | character mode only |
| `slideshow.scene.details` | string[] (max 2) | |
| `slideshow.scene.saved_scene_id` | string or `null` | Scene library id |
| `slideshow.cta.kind` | `"part2"`, `"save"`, `"handle"`, `"comment"`, `"page"`, `"own"` or `"none"` | |
| `slideshow.cta.handle` | string or `null` | |
| `slideshow.cta.word` | string or `null` | |
| `slideshow.cta.text` | string or `null` | from `ctaText`; `null` for `own` and `none` |
| `caption.text` | string | the caption as written |
| `caption.hashtags` | string[] | at most 5 (`config/content.yaml`, `slideshow.hashtags: [3, 5]`) |
| `caption.ad` | boolean | #ad on |
| `caption.as_posted` | string | what to paste: `#ad ` first on an ad, then the caption, a blank line, the hashtags with `#` (`postCaption`) |
| `caption.file` | `"caption.txt"` | |
| `slides[].number` | number, 1-based | |
| `slides[].text` | string | |
| `slides[].shot` | string or `null` | what the photo shows inside the locked scene |
| `slides[].picture` | `"still"`, `"special"` or `"none"` | |
| `slides[].still_id` | string (`cand_...`) or `null` | |
| `slides[].special` | `{ type, from, title, body, lines: string[], time }` or `null` | `type`: `notification`, `text_thread`, `rejection_email`, `job_posting`. Real brand names are replaced by generic names from `config/content.yaml` |
| `slides[].text_position` | `{ x: number 0..1, y: number 0..1 }` or `null` | where the words were dragged; `null` means the style's default place |
| `slides[].files` | `{ tiktok: string, instagram: string }` | paths inside the zip |
| `files.tiktok`, `files.instagram` | string[] | in slide order |
| `files.caption` | `"caption.txt"` | |
| `sizes.tiktok` | `{ width: 1080, height: 1920 }` | `config/content.yaml` `canvas` |
| `sizes.instagram` | `{ width: 1080, height: 1440 }` | `config/content.yaml` `slideshow.instagram` |
| `ai_label` | string | the character's `disclosure`, else `"Label all posts as AI-generated"` |

### A.2.3 Sample post.json for a slideshow (fake values)

Produced by calling the real `postExportJson` with fake input in a scratch run. Slide 3 is a special slide (drawn by code over the nearest slide's photo, blurred), so it has no `still_id`.

```json
{
  "format": "character-studio.post",
  "version": 1,
  "exported_at": "2026-10-16T09:21:00.000Z",
  "post": {
    "id": "cnt_SAMPLEPOST000001",
    "kind": "slideshow",
    "title": "One pan Monday rice",
    "idea": "What I cook after a night shift",
    "account": "Ada TikTok",
    "character": {
      "id": "chr_SAMPLECHAR00001",
      "name": "Ada Sample"
    },
    "variation_of": null,
    "batch_of": null,
    "created_at": "2026-10-16T09:00:00.000Z",
    "updated_at": "2026-10-16T09:20:00.000Z"
  },
  "slideshow": {
    "photos_of": "character",
    "hook": "Things nobody tells you about cooking after a night shift",
    "hook_pattern": {
      "id": "nobody_tells",
      "label": "Things nobody tells you"
    },
    "text_style": "classic",
    "made_for": "tiktok",
    "scene": {
      "place": "a small apartment kitchen",
      "light": "window",
      "camera": "friend_phone",
      "phone": "rear",
      "outfit": "oversized gray knit sweater, black leggings, white socks",
      "details": [
        "a dish rack by the sink",
        "a sticky note on the fridge"
      ],
      "saved_scene_id": null
    },
    "cta": {
      "kind": "part2",
      "handle": null,
      "word": null,
      "text": "Follow for part 2"
    }
  },
  "caption": {
    "text": "Night shift ends, the pan comes out. This is the dinner I make when I can barely stand.",
    "hashtags": [
      "nightshift",
      "onepan",
      "easydinner",
      "nurselife"
    ],
    "ad": false,
    "as_posted": "Night shift ends, the pan comes out. This is the dinner I make when I can barely stand.\n\n#nightshift #onepan #easydinner #nurselife",
    "file": "caption.txt"
  },
  "slides": [
    {
      "number": 1,
      "text": "Things nobody tells you about cooking after a night shift",
      "shot": "Ada at the stove, steam rising",
      "picture": "still",
      "still_id": "cand_SAMPLESTILL01",
      "special": null,
      "text_position": {
        "x": 0.5,
        "y": 0.28
      },
      "files": {
        "tiktok": "tiktok/01-one-pan-monday-rice.jpg",
        "instagram": "instagram/01-one-pan-monday-rice.jpg"
      }
    },
    {
      "number": 2,
      "text": "You will be too tired to chop anything",
      "shot": "Ada leaning on the counter, eyes half closed",
      "picture": "still",
      "still_id": "cand_SAMPLESTILL02",
      "special": null,
      "text_position": null,
      "files": {
        "tiktok": "tiktok/02-one-pan-monday-rice.jpg",
        "instagram": "instagram/02-one-pan-monday-rice.jpg"
      }
    },
    {
      "number": 3,
      "text": "So the freezer does the chopping",
      "shot": "a bag of frozen vegetables in her hand",
      "picture": "special",
      "still_id": null,
      "special": {
        "type": "notification",
        "from": "Messages",
        "title": "Roommate",
        "body": "are you cooking or is that the smoke alarm",
        "lines": [],
        "time": "now"
      },
      "text_position": null,
      "files": {
        "tiktok": "tiktok/03-one-pan-monday-rice.jpg",
        "instagram": "instagram/03-one-pan-monday-rice.jpg"
      }
    },
    {
      "number": 4,
      "text": "One pan, one egg, ten minutes",
      "shot": "the pan from above, egg cracking",
      "picture": "still",
      "still_id": "cand_SAMPLESTILL04",
      "special": null,
      "text_position": null,
      "files": {
        "tiktok": "tiktok/04-one-pan-monday-rice.jpg",
        "instagram": "instagram/04-one-pan-monday-rice.jpg"
      }
    },
    {
      "number": 5,
      "text": "It tastes like a small rescue",
      "shot": "Ada taking the first bite",
      "picture": "still",
      "still_id": "cand_SAMPLESTILL05",
      "special": null,
      "text_position": null,
      "files": {
        "tiktok": "tiktok/05-one-pan-monday-rice.jpg",
        "instagram": "instagram/05-one-pan-monday-rice.jpg"
      }
    },
    {
      "number": 6,
      "text": "Follow for part 2",
      "shot": null,
      "picture": "still",
      "still_id": "cand_SAMPLESTILL06",
      "special": null,
      "text_position": null,
      "files": {
        "tiktok": "tiktok/06-one-pan-monday-rice.jpg",
        "instagram": "instagram/06-one-pan-monday-rice.jpg"
      }
    }
  ],
  "files": {
    "tiktok": [
      "tiktok/01-one-pan-monday-rice.jpg",
      "tiktok/02-one-pan-monday-rice.jpg",
      "tiktok/03-one-pan-monday-rice.jpg",
      "tiktok/04-one-pan-monday-rice.jpg",
      "tiktok/05-one-pan-monday-rice.jpg",
      "tiktok/06-one-pan-monday-rice.jpg"
    ],
    "instagram": [
      "instagram/01-one-pan-monday-rice.jpg",
      "instagram/02-one-pan-monday-rice.jpg",
      "instagram/03-one-pan-monday-rice.jpg",
      "instagram/04-one-pan-monday-rice.jpg",
      "instagram/05-one-pan-monday-rice.jpg",
      "instagram/06-one-pan-monday-rice.jpg"
    ],
    "caption": "caption.txt"
  },
  "sizes": {
    "tiktok": {
      "width": 1080,
      "height": 1920
    },
    "instagram": {
      "width": 1080,
      "height": 1440
    }
  },
  "ai_label": "Label all posted content as AI-generated."
}
```

### A.2.4 Sample post.json for a video post

**Not built.** The Studio writes no post.json for a video post, so there is no sample to give. The one place to add it is `server/core/postExport.ts` (its own comment says so), and the video export entry point is the `meme` branch of the render job in `server/pipeline/content.ts`.

### A.2.5 Zip folder and file names

`<name>` is the post title made into a slug: lower case, every run of characters other than a to z and 0 to 9 becomes `-`, trimmed, at most 40 characters, `content` when empty (`slug` in `server/pipeline/content.ts`). `NN` is the slide or video number, two digits from `01`.

Slideshow zip (stored, not compressed):

```
tiktok/NN-<name>.jpg        one per slide, 1080 x 1920, JPEG quality 90
instagram/NN-<name>.jpg     one per slide, 1080 x 1440
caption.txt
post.json
```

`caption.txt` holds `caption.as_posted`, a blank line, then: "Post as a photo slideshow, images in order (tiktok/ for TikTok at 1080 x 1920, instagram/ for Instagram at 1080 x 1440). Turn on the AI-generated content label (TikTok and Instagram)."

Batch of video posts (zip parts of at most 150 MB each, `batch.zip_part_mb`):

```
<name>-NN.mp4               one per caption; a failed video leaves its number out
captions.txt                in every part: "NN. <caption>" per line
```

Video post: one MP4, no zip.

---

## A.3 Face gates

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

How rules behave everywhere (`server/core/rules.ts`, `server/pipeline/rules.ts`): the prompt lint forces every **default** rule hit to a warning whatever its yaml says; only a **fixed** rule can block (`prompt_rejected`). A default's switch is `stored.on ?? starts_on` (`starts_on` is true unless the rule says otherwise), and a per-character switch wins over the account-wide one. Rules of type `behavior` or `code` are not lint checks; the code that reads the switch does the work.

### A.4.1 OCR (text left on a Recreate take)

- **Engine**: `tesseract.js` 7, English only, LSTM engine (OEM 1), language data `eng.traineddata` (tessdata_fast) read from the `STUDIO_MODELS_DIR` folder, fetched by `npm run models`. Code: `server/qa/ocr.ts` (`createOcr`, `classifyText`).
- **Where it runs**: only in the Recreate take review (`runCloneReview`, `server/pipeline/recreate.ts`), a free local job queued after a take lands, after a free trim, and from Review again. Frames come from the **generated take** only: 1 frame per second (`ocr_step: 1`), scaled to 720 px wide.
- **What counts**: each recognized line is cleaned (characters other than letters, digits and `@#._ '!?,:-` removed). Dropped when it has fewer than 3 letters or digits, or confidence under 55. Then classified: `handle` if it matches `@` plus 3 or more word characters; `logo` if it matches `tik tok`, `tiktok`, `reel`, `reels`, `instagram`, `capcut`, `youtube`, `shorts`, `snapchat`; otherwise `caption` (first 80 characters). Repeats are counted once (a later reading that starts with an earlier one, or the other way round, is skipped).
- **Output**: `{ t, kind, text, frameAssetId }` per hit, with a thumbnail of the frame and the words boxed in red.
- **Effect**: information only. It never blocks and never changes the take's status. No rule in `config/rules.yaml` covers it; it switches itself off (with a note) when the language data is missing.

### A.4.2 Hot spot check

**Not built.** No code measures bright or blown highlights on the skin, and no rule mentions hot spots. "Hot spots" appear only as **prompt words**: character template v1.6 puts "Even, soft exposure on the face, no bright hot spots" in its REALISM block and "blown highlights or hot spots on the skin" in its AVOID block, and the importer carries those blocks into every image prompt for that character (A.1.4). The Studio's own default REALISM and AVOID blocks do not mention hot spots. (In the UI code, "hotspots" means only the numbered labels on the Guide's screenshots.) The only exposure reading in code is the clip reader's dark-clip hint (`dark_luma: 70`), which suggests a route and checks nothing.

### A.4.3 Risky word warning (`wording-risky`, default, on)

- **Rule**: "May be blocked by the provider's filter". Stages: `scene`, `edit`, `video` (scene stills, slideshow character stills, still edits, Recreate stills and face pass, scene video, Recreate motion). Not run on hero, sheet or upscale.
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
| Recreate clip reader, Recreate still outfit, Read the outfit again, slideshow draft shot lines | no, always |

Related lists:

- **Realism banned words** (fixed rule `realism-banned-words`, `BANNED_REALISM_TERMS` in `server/core/realism.ts`): `flawless`, `perfect skin`, `smooth skin`, `airbrushed`, `retouched`, `porcelain`, `beautify`, `glamour retouch`, `skin smoothing`, `beauty filter`, `enhance face`. Whole words, case-insensitive. Allowed inside an `AVOID:` line and when negated (`no`, `not`, `never`, `without`, `avoid`, `zero`, `nothing`, `free of`, `instead of`, `rather than` within the same clause, up to two words before). The builders strip them with a warning; one that still reaches a run is refused at the lint and again at the quote.
- **Heavy flaw words** (default `realism-flaw-dose`): `blemish`, `acne`, `pimple`, `zit`, `scar`, `scarred`, `rough skin`, `pockmark...`, `breakout`, `enlarged pores`, `deep wrinkles`, `blotchy`, `skin lesion`, `rosacea`, `eczema`, `sun damage` are stripped unless the character's card, marks or realism notes name them.
- **Makeup words on hero and sheet** (fixed bare face): `glam`, `glamorous`, `soft glam`, `full glam`, `full makeup`, `heavy makeup`, `makeup look`, `wearing makeup`, `with makeup`, `red lip(stick)`, `bold lip`, `lipstick`, `lip gloss`, `winged (eye)liner`, `eyeliner`, `mascara`, `eyeshadow`, `eye shadow`, `contour`, `bronzer`, `false lashes`, `lash extensions`, `smokey eye` are stripped from hero and sheet prompts.
- **Cup sizes and measurements** (defaults `neutral-body-cups`, `neutral-body-measurements`): a warning on any prompt; and on the character record, a cup size or measurement in the card or body gives "Neutral body terms usually work better than cup sizes or measurements; models exaggerate them."
- **Recreate card** (`cardForPhotoEdit`): next to a real person's photo, only card sentences with face or hair words are kept, and comma parts with any of `fit`, `build`, `body`, `figure`, `physique`, `leg(s)`, `thigh(s)`, `waist`, `hip(s)`, `curv...`, `bust`, `chest`, `breast(s)`, `butt`, `glute(s)`, `abs`, `toned`, `athletic`, `slim`, `slender`, `petite`, `tall`, `height`, `weight`, `muscular`, `hourglass` are dropped; age words are removed too.
- **No nudity or explicit content** (fixed `no-explicit`, `server/core/safety.ts`): `nude` (not when followed by a color or cosmetic word such as pink, beige, tones, lips, heels, polish, nails, makeup, gloss, lipstick), `nudity`, `naked`, `topless`, `bottomless`, `unclothed`, `undressed`, `no clothes`, `without clothes`, `nipple(s)`, `areola(s)`, `genital(s)`, `genitalia`, `pubic`, `vulva`, `penis`, `vagina`, `explicit`, `sexual(ly)`, `sex scene`, `sex act`, `having sex`, `intercourse`, `orgasm...`, `porn...`, `erotic...`, `nsfw`, `fetish...`, `bdsm`, `see-through top|bra|shirt|dress`, `exposed breast(s)|chest|buttocks`. Allowed inside AVOID and when negated. Never stripped: always refused ("No nudity or explicit content. This is a fixed rule and cannot be switched off.").

### A.4.6 Hair rotation (`hair-rotation`, default, on)

- **Bank** (`config/scenes.yaml` `hair_bank`, in order): behind both shoulders; tucked behind one ear; blowing back off the face; half-up claw clip; low loose ponytail; high sleek ponytail; messy top bun; sunglasses as a headband; damp and air-dried; parted on the other side.
- **When**: in `createScene` (`server/pipeline/scenes.ts`) for a new scene, a copied scene and a post's scene, only when no hair was typed, the owner's words name no styling (`hairFromWords`), and the switch is on.
- **Recent** (`rotatedHair`): the hair of the last 5 combo log entries that have one (`hair_window: 5`), plus the hair of the character's last 5 scenes.
- **Pick** (`nextHair`, `server/core/scenes.ts`): names compared lower-case with punctuation as spaces. Start after the bank position of the newest recent styling (or at the first), walk the bank in a circle, return the first styling not in recent. All used: the one whose last use is oldest.
- **Owner-set**: a typed hair value, or a styling in the owner's words (buns, ponytails, braids, clips, headbands, "hair up/down/back/tucked", "wet/damp/slicked-back/air-dried hair", "tucked behind her ear"). A value equal to a bank entry counts as the rotation's pick, not the owner's: later words replace it and it is not copied to another character.
- **In the prompt**: the template line `{makeup}. Hair: {hair}. {pose}, {expression}.` (`hair` is "as usual" when empty), and `- Hair styling: ...` in the prompt writer's facts. Hair color and texture stay the character's. Recreate does not rotate hair.

### A.4.7 Makeup by setting (`makeup-by-setting`, default, on)

- **Classification** (`makeupForSetting`): the scene's moment, setting and location joined; `bare` when any phrase below matches (whole words, case-insensitive), otherwise `natural`. There is no word list for "public", "night out" or "events": anything that is not bare counts as public.

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

---

## A.5 Prompt assembly

Prompts are filled by code from templates (`config/templates.yaml`, `config/scenes.yaml`) and the character record. Claude writes only one optional part, the body of a scene still or video prompt ("Write and generate"); the Studio's own lines are added around it by code. Every paid step goes `POST /api/v1/actions/estimate` then `/actions/run`, through `buildAction` (`server/pipeline/actions.ts`), to the stage builder below, which returns job specs for the runner (A.7.2).

### A.5.1 Rules shared by every image prompt

`finishPrompt` (`server/core/prompts.ts`) and `finalizeImagePrompt` (`server/core/realism.ts`) end every hero, sheet, scene and edit prompt, in this order:

1. The saved identity's prompt block, if any (for example a trained character's IDENTITY block).
2. Banned smoothing words stripped (A.4.5), heavy flaw words stripped unless the character has them.
3. Hero and sheet only: makeup words stripped, then `Bare face, no makeup, no retouching.` appended.
4. A new line with the REALISM block: the character's own `realism.block`, else the Studio default, adjusted for the stage (hero and sheet drop the background clause and the "or light makeup only" allowance), the scene's makeup choice, and the framing's skin detail (`skin` per framing in `config/scenes.yaml`: chest-up gets the full skin list, waist-up and knees-up get "Natural skin texture", full body and wide get no skin detail; "no beauty smoothing" and "no retouching" always stay).
5. A new line with the AVOID block: the character's own `realism.avoid`, else the default.
6. Recreate stills and the face pass use the short form `REALISM: Natural skin texture, not retouched.` instead of steps 4 and 5 (no AVOID block).

Also: `normalizePrompt` joins each template body into one line (only REALISM and AVOID sit on their own lines). A model's `prompt_lines` from `config/models.yaml` go just before `REALISM:` (`withModelLines`); today only GPT Image 2.5 Flare has one, `Bare natural lips, no gloss.` No prompt names a REF id: references are "the attached reference images" or "the first image" and "the other images", in attachment order.

The Studio default blocks (`server/core/realism.ts`):

```
REALISM: Candid iPhone photo, neutral natural light. Real skin texture: visible pores, soft peach fuzz catching the light on the cheeks and jaw, a few stray brow hairs and baby hairs at the hairline, subtle color variation with slight redness around the nose and cheeks, faint natural shine. No makeup or light makeup only, no beauty retouching, no beauty filter, no skin smoothing. Ordinary background, not a professional shoot.
AVOID: airbrushed or plastic skin, skin smoothing, beauty filters, studio lighting, perfect symmetry, text, watermarks.
```

The lint (`lintPrompt`, `server/core/rules.ts`) runs on each built prompt, and the runner's `guardRealism` refuses at quote time any image prompt without a REALISM block, any prompt with a banned word, any hero or sheet prompt without the bare-face line, and any explicit term.

Mark lines (`markLines`, `server/core/prompts.ts`, templates `marks` in `config/templates.yaml`) state each mark with the character's own side, and for a front view also say which side of the image it appears on; a hidden mark is stated as hidden, and the other side is declared clean for jewelry or hidden marks. Hero and sheet use all marks; scenes and character slideshows use skin marks only; edits, Recreate and video use none.

### A.5.2 The stages at a glance

| Stage | Builder (file) | Claude writes part? | Default model (config) | Images attached |
|---|---|---|---|---|
| Hero | `buildHeroPrompts` (`server/core/prompts.ts`), called from `buildAction` case `hero` | No (the card it uses may come from Claude's concepts step) | `higgsfield/gpt-image-2.5`, image, high, 2k, 3:4 (`config/routing.yaml` `hero`) | None (text only). 3 prompt variants, 1 to 8 runs each |
| Sheet ref | `buildSheetPrompt` (`server/core/prompts.ts`), `buildAction` case `sheet` | No | the sheet lock, else `higgsfield/gpt-image-2.5`, image edit, high, 2k (`routing.yaml` `sheet`) | The shot's `attach` refs from `config/sheet.yaml` (for example REF-03 attaches REF-00 and REF-01) |
| Scene still | `buildScenePrompt` (template), `assembleStillPrompt` (written), `assembleAsWritten` (pasted), all in `server/core/scenes.ts`; chosen in `buildSceneRun` (`server/pipeline/sceneActions.ts`) | Optional: the body only (`buildScenePromptWrite`, route `prompt_writer`) | `higgsfield/gpt-image-2.5-flare` (`scenes.yaml`) | Up to 4 refs by angle (`pickSceneRefs`): REF-00, the closest angle, a body ref only at knees-up or full body, an expression ref |
| Edit | `buildEditPrompt` (`server/core/scenes.ts`), from `buildSceneEdit`, `buildSceneEndFrame` and the drift lock | No | `higgsfield/nano-banana-2.1` (`scenes.yaml` `edit_models`) | The still, plus REF-00 for a face edit |
| Face pass | `facePassRun` (`server/pipeline/clone.ts`), template `clone.face_pass`, then `buildEditPrompt` | No | the model that made the still | The still first, then REF-00 (plus one three-quarter ref without an Element) |
| Recreate still | `buildCloneStill` (`server/pipeline/clone.ts`), template `clone.recreate_still`, then `buildEditPrompt` | No (Claude's clip reader fills the traits, keep chips, outfit and motion fields) | `higgsfield/nano-banana-2.1` on the plan, `higgsfield/gpt-image-2.5` on the API (`content.yaml` `clone.scene_still`) | The clip's frame first, then REF-00 and REF-01 or REF-02 (or the Element on the plan), then an outfit still if picked |
| Motion | `buildClone` (`server/pipeline/clone.ts`), template `clone.motion`, then `assembleVideoPrompt` | No (the motion line can come from the clip reader) | `higgsfield/wan-3.0-motion` (`content.yaml` `clone.motion_model`) | The chosen still (`@Image1`) and the cleaned clip (`@Video1`) |
| Image to video | `assembleVideoPrompt` (`server/core/promptWriter.ts`), from `buildSceneVideo` (`sceneActions.ts`) | Optional: the labeled text (`buildScenePromptWrite` target `video`) | `higgsfield/kling-3.0-pro` (`scenes.yaml`) | The still as start frame, an end frame when the model takes one |
| Slideshow stills | `slideRequest` (`server/pipeline/slideshow.ts`): `buildScenePrompt` plus `slideshow_set` (character), or `slideshow_topic` (topic) | No (Claude's draft fills each slide's shot and the locked scene) | `higgsfield/nano-banana-2.1` on the plan, `higgsfield/gpt-image-2.5-flare` on the API (`content.yaml` `slideshow`) | Character: scene refs by angle. Topic: only the saved scene's look picture, if any |

### A.5.3 Samples

Each sample below is real output: the Studio's own builder functions were run in a scratch copy with the options the pipeline passes, on the fake character from A.1.7 (card "27 years old. Chin-length auburn hair, loose waves, side part. Hazel eyes, oval face, soft arched brows. Average, slim build.", a small mole above her LEFT brow, no REALISM or AVOID block of her own, so the Studio defaults apply). The scene fields are fake.

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

**3. Scene still (template path, the default model Flare).** Inputs: the scene fields (`moment`, `task`, `trigger`, `setting`, `outfit`, `footwear`, `jewelry`, `makeup`, `hair`, `pose`, `view`, `expression`, `camera`, `distance`, `phone`, `height`, `framing`, `light`, `destination`, `brands`) and the character's card, skin marks, pronouns and makeup lines. Template `scene.base` with the reference, adult, outfit-override, brand-free and hair-color lines. The fake fields: kitchen at night (so makeup by setting is bare), a friend's phone, rear camera, waist-up, warm practical lights, rotated hair "low loose ponytail".

```
Using the attached reference images, keep this woman's face, hair, and features exactly the same. She is an adult, 21 or older. Ada stirs a pan of fried rice at the stove after a night shift. Stirring the pan. Her phone buzzing on the counter catches her attention. a small apartment kitchen at night, dishes in the rack. She is wearing oversized gray knit sweater, black leggings, with white socks, wearing this outfit instead of the white t-shirt, jeans and sneakers in the reference images. No makeup, bare skin. Hair: low loose ponytail. Relaxed, caught mid-moment, soft, closed-mouth smile. The small mole above her LEFT brow is visible (it appears on the right side of the image, because her LEFT side is on the right as we face her). Candid phone photo taken by a friend about 6 feet away, on the rear camera, waist-up framing, eye level. Evening, lit by warm practical lights such as string lights and lamps, slight phone-camera grain. Everything she wears and holds is plain and unbranded, with no logos or readable text. Bare natural lips, no gloss.
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

The end-frame helper wraps the change in `video.end_frame` ("Edit only the masked area, her head and face: ...") and sends a head mask; the drift lock uses `edits.drift_lock` from `config/scenes.yaml`.

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

**7. Motion (Recreate motion transfer).** Inputs: the hair color, the keep chips (else "her outfit, the place and the light"), the motion line. Template `clone.motion`, then `assembleVideoPrompt` adds the silent line and the full REALISM block (no AVOID). Kling 3.0 Motion Control on the Higgsfield plan takes no prompt, so it is sent empty there.

```
Motion transfer. @Image1 defines everything you see: this exact woman, her face, chin-length auburn hair, her outfit, the place and the light, exactly as in @Image1 for the whole clip. The first frame matches @Image1. @Video1 is used ONLY for motion: copy its body movement, head turns, facial expressions, timing and handheld phone camera movement exactly, beat for beat. Never copy the person, the room, the caption text or the logo from @Video1. The motion: she sways side to side, points at the camera and laughs. Her face stays the same person from every angle. Her outfit stays exactly as in @Image1 for the whole clip, same cut, length and fit. One continuous take, no cuts. No text, no captions, no logos, no watermark. Silent. Candid phone video, natural skin, not retouched. Silent, no audio, no dialogue.
REALISM: Candid iPhone photo, neutral natural light. Real skin texture: visible pores, soft peach fuzz catching the light on the cheeks and jaw, a few stray brow hairs and baby hairs at the hairline, subtle color variation with slight redness around the nose and cheeks, faint natural shine. No makeup or light makeup only, no beauty retouching, no beauty filter, no skin smoothing. Ordinary background, not a professional shoot.
```

**8. Image to video (the owner's words, audio off).** Inputs: what happens (the owner's words, or Claude's labeled lines), the directions (default "No talking, no winking, steady eye contact. One continuous take, no cuts." plus any edit-style slot text; a chained take adds `video.continue`), audio on or off, the framing's skin detail.

```
Ada stirs the pan, glances up at the camera and smiles a little. No talking, no winking, steady eye contact. One continuous take, no cuts. Silent, no audio, no dialogue.
REALISM: Candid iPhone photo, neutral natural light. Natural skin texture. No makeup or light makeup only, no beauty retouching, no beauty filter, no skin smoothing. Ordinary background, not a professional shoot.
```

When Claude writes it, the text is labeled lines kept one per line, in the order `FORMAT:`, `SUBJECT:`, `SETTING/LIGHT:`, `CAMERA:`, `ACTION:`, `CONTINUITY:`, `AUDIO:`, `CONSTRAINTS:`; the Studio replaces the `FORMAT:` line with its own (`FORMAT: <duration> s, <aspect>, live-action personal phone video, one continuous take, no cuts.`) and the `AUDIO:` line with `AUDIO: Sound off: silent, no dialogue, no music.` (or the sound-on line), then adds the directions line and REALISM.

**9a. Slideshow still, character mode (locked scene, API model Flare).** Inputs: the slide's shot (made into a moment: "leaning on the counter" becomes "Ada Sample is leaning on the counter"), the locked scene (place, two details, light, camera, phone, outfit), the post scene's other fields, then `buildScenePrompt` with `slideshow_set` as the addendum (and on the plan, `slideshow_element` with the Element).

```
Using the attached reference images, keep this woman's face, hair, and features exactly the same. She is an adult, 21 or older. Ada Sample is leaning on the counter, eyes half closed. a small apartment kitchen. Also in the place: a dish rack by the sink, a sticky note on the fridge. She is wearing oversized gray knit sweater, black leggings, white socks, wearing this outfit instead of the white t-shirt, jeans and sneakers in the reference images. No makeup, bare skin. Hair: tucked behind one ear. Relaxed, caught mid-moment, relaxed, natural expression. The small mole above her LEFT brow is visible (it appears on the right side of the image, because her LEFT side is on the right as we face her). Candid phone photo taken by a friend about 6 feet away, on the rear camera, waist-up framing, eye level. Soft daylight from a nearby window, the rest of the room a little darker. Her hair stays chin-length auburn and her skin tone is unchanged, even here. Everything she wears and holds is plain and unbranded, with no logos or readable text. This photo is one of a set from the same day, like one camera roll: the same place, light, phone and outfit in every photo of the set; only the moment changes. Bare natural lips, no gloss.
REALISM: Candid iPhone photo, neutral natural light. Natural skin texture. No makeup, no beauty retouching, no beauty filter, no skin smoothing. Ordinary background, not a professional shoot.
AVOID: airbrushed or plastic skin, skin smoothing, beauty filters, studio lighting, perfect symmetry, text, watermarks.
```

**9b. Slideshow still, topic mode (no person).** Inputs: the shot, the place, details, light (a preset's words), the camera words, the aspect. Template `slideshow_topic` plus the topic REALISM line; no AVOID block, no face check. With a saved scene's look picture attached, `slideshow_same_place` is added.

```
A candid phone photo for a photo slideshow, held at chest height. A laptop open on a desk next to a cold coffee. The place: a small home office. Also there: a desk lamp, a stack of mail. Soft daylight from a nearby window, the rest of the room a little darker.. Every photo of the set is in this same place, light and phone, like one camera roll from one day. No one in focus and no faces; no readable text, logos or brand names on anything. A 9:16 vertical frame.
REALISM: A real phone photo with natural grain, real textures and uneven everyday light, not retouched or polished.
```

(The double period after the light comes from the code: the topic builder adds a period to the light words and the template adds another. Recorded in A.8.)

---

## A.6 Batch and plan import

What the Studio accepts today. **Excel files (.xlsx) are not parsed anywhere**: there is no spreadsheet library in the project, only CSV-style text. A **content plan or calendar import is not built** (the posting calendar is on the roadmap in `docs/studio/PLAN.md` as not started). "Plan the details" in the Stills step is a priced Claude action that fills one scene's fields; it is not an import.

### A.6.1 Batch spreadsheet (CSV, or rows pasted from a spreadsheet)

One row per video post. Code: `server/core/csvImport.ts` (`parseCsv`, `headerMap`, `csvRows`, `planRows`), `server/pipeline/csvImport.ts` (`previewImport`, `runImport`), UI `src/studio/pages/post/ImportCard.tsx`.

- **Where**: a Batch post, Idea step, card **Import a spreadsheet**: paste the rows (with the header line) or **Upload a CSV** (`accept=".csv,text/csv,text/plain"`); **Download a template** saves `batch-template.csv`; **Preview (free)**; **Make N posts**. A switch, on by default: "Export the ones that reuse a clip now (free, on the worker)".
- **Encoding**: the browser reads the file as UTF-8 (`File.text()`); a leading byte-order mark is removed. No other encoding is detected.
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
- `POST /api/v1/content/:id/import` body `{ "csv": string, "exportFree": boolean (default true) }`. Returns 201 `{ created: [{ line, id, status }], exporting, skipped, notExported: [{ line, id, reason }] }`. The server parses the CSV again; it does not reuse the preview. Read in the code but not run: a malformed body on this route is not caught as a 400 and would surface as a 500.

Built-in template (`ImportCard.tsx`) header, with fake rows. Run through `csvRows` in a scratch copy, it parses with no problems:

```csv
character,account,clip,video,caption,style
Ada Sample,ada.cooks,stir-fry-take.mp4,,dinner after a 12 hour shift,Crash zoom cut
Ada Sample,ada.cooks,"still: at the stove at night, one pan, steam rising",she tastes it and looks at the camera,the freezer is my sous chef,
```

### A.6.2 Batch captions (one per line)

Batch post, Captions step: "Captions, one per line, optional". Split on line breaks, trimmed, blank lines dropped, at most 50, each at most 400 characters (the video draws the first 220). Saved through `PATCH /api/v1/content/:id` `{ "spec": { "captions": string[] } }`. Each line becomes one video of the batch; the batch's clips and B-roll rotate across the captions (clip `i mod n`). Free to paste and to render; **Write N captions** (Claude) is priced.

### A.6.3 Slideshow "Batch from hooks" (one per line)

Slideshow post, Idea step, card **Batch from hooks**: "Hooks, one a line (N of 10)". At most 10 lines (schema `batchHooks`, max 10 items of 200 characters). Each hook is cleaned (long dashes become ", ", outer quotes removed, cut to its first 14 words). **Make N slideshows** is one priced run: each hook gets a Claude draft and a still for every slide, as a new slideshow with `batch_of` set to the parent; one review screen offers Approve (export, free), Reroll (priced) and Reject (archived). Run through `POST /api/v1/actions/estimate` then `POST /api/v1/actions/run` with `{ "action": { "type": "slideshow_batch", "contentId": "<id>" } }`.

### A.6.4 Script kit (.md)

Library > Hooks, **Import a script kit** (`.md`, `.markdown`, `.txt`; at most 200 KB). `POST /api/v1/products/import` body `{ "markdown"?: string, "starter"?: boolean, "name"?: string }`. Parser `parseScriptKit` (`server/core/scriptKit.ts`); headings `#` to `####`, compared after removing `**`, a leading `N. ` and case:

- Product name: the first `#` heading minus "script kit..." and "v<n>...".
- **Claims sheet** (title starts with `claims`): `Label:` lines open a group, bullets under it are items; `Label: value` lines are one-line rules; the group whose label contains "never" gives the watch words.
- **Buyer language** (title matches `buyer` or `language`): the same group format.
- **Hook vault** (title contains `hook vault`): numbered lines `1. ...` or `1) ...`; a subsection title (minus any trailing "(...)") is the hook kind. At most 500 hooks.
- **Voice cards** (title contains `voice card`): each subsection is one voice; `Name (live)` fills empty voice-card fields of the character with that name; "proposed" or "to build" cards are stored only.
- Everything else is kept as notes.

A kit with no hooks and no claims is refused: "No hooks or claims found. A kit has a "Claims sheet" section and a "Hook vault" section with numbered hooks." Importing is free.

### A.6.5 Not built

- `.xlsx` parsing, `.tsv` in the file picker (pasted tab-separated rows do work), a content plan or calendar import, a bulk Recreate import (Recreate batch rows are added one at a time).
- Planned only in `LATER.md`: a CSV `voice` column, a CSV `hook` column, a "Generate all new rows" button.

---

## A.7 Provider interface

### A.7.1 The contract (`server/providers/types.ts`)

Every image, video and audio generation goes through one interface, `ProviderAdapter`:

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

Code: `server/jobs/runner.ts`, `server/providers/registry.ts`, `server/costs/pricebook.ts`, `config/runtime.yaml`.

1. **Pick the adapter.** `registry.gen(accountId, modelRef, { billing })` splits the ref on `/`. `mock` gives the mock adapter; `elevenlabs` the voice adapter; `higgsfield` with billing `account` the MCP account adapter; `higgsfield` otherwise the REST API adapter with the account's key. Any other provider fails: with no stored key for it, "Add your <p> API key in Settings to run this live."; with one, "No adapter for provider "<p>" yet."
2. **Quote** (`quoteJobs`, before any spend). The realism and safety lint runs first and refuses a prompt without the REALISM block, with a banned smoothing word, without the bare-face line on a hero or sheet shot, or with explicit terms (`guardRealism`). Then `adapter.estimate(request)` per job (identical requests priced once, 4 at a time). The quote is stored with an id and expires after `quote_ttl_sec` (900 s).
3. **Run** (`runJobs` with the quote id). The jobs are priced again and must match the quote. Each job row gets `idempotencyKey = "<quoteId>:<index>"` and a ledger **hold** for its estimate. A job can wait on a parent job in the same run (`parentIndex`).
4. **Submit** (worker, `submitGen`). If `needsPublicAssetUrls`, every `AssetRef` gets a `url`: from `adapter.uploadAsset(bytes, mime)` when the adapter has it (cached 6 hours per asset checksum), else a short-lived public URL of the Studio's own storage. Then `adapter.submit(request, { idempotencyKey, webhookUrl })`. `webhookUrl` is `<public base>/api/v1/webhooks/<provider>/<jobId>?t=<token>` when a public base URL is set. The job moves to `running` with the provider's `jobId`. On the Higgsfield API, `adapter.exactPrice` is then asked for the provider's own price and logged next to the quote.
5. **Poll** (`pollGen`). `adapter.status(jobId)`. `queued` or `running`: poll again after `pollAfterSec`, else a backoff of 2 s times 1.5 per poll, capped at 10 s (`poll_initial_sec`, `poll_backoff`, `poll_max_sec`). A job still running after `stuck_after_sec` (image and image edit 600 s, video 1800 s, audio 900 s) gets a "stuck" event; it keeps polling. A webhook only wakes the poll; its body is never trusted. `succeeded`: outputs from the status, else `adapter.result(jobId)`. `failed`, `nsfw`, `canceled`: the hold is released, nothing is charged, the job's hook runs with the error.
6. **Ingest** (`ingestGen`). Each output is downloaded with `adapter.download(output)` if the adapter has it, else the runner's guarded fetch (hosts allowed per provider in `config/runtime.yaml` `downloads.allowed_hosts`, private and loopback addresses always refused, 500 MB, 120 s). A video is stored silent unless the request asked for audio. Outputs are saved as assets.
7. **Settle.** Higgsfield account path: the quoted plan credits are charged, then `adapter.charges()` (the account's transactions) is matched to log the real credits next to the quote. Every other path: the actual cost is computed from the **price book** (`actualGen`, using the measured video length), not from the adapter. Ledger entries: `hold`, `release`, `charge`, in micro-dollars. A cost check flags a run more than 20% off its quote.
8. **Hook.** The job's purpose (for example `clone_still:<postId>:...`) selects a pipeline hook that runs the free checks (face, skin, scene) and files the result.
9. **Cancel.** `cancelJob` calls `adapter.cancel?.(providerJobId)` when the job is `running` at the provider, then releases the hold.

Error handling (`handleProviderError`): `submitted: "unknown"` puts the job in `needs_attention` and keeps the hold ("check its console before retrying"). `retryable: true` is retried up to `submit_max_attempts` (3) with the same backoff. Anything else fails the job and releases the hold. A worker that died mid-submit also leaves the job in `needs_attention`. A failed download is retried with the same backoff until the job's attempt count reaches `submit_max_attempts + 3`, then the job goes to `needs_attention`.

Cost reporting data (`config/pricebook.yaml`): entries `{ provider, model, unit: image | second | call | mtok_in | mtok_out | mtok_cache_read | mtok_cache_write, price (USD, may be 0), verified, when?: { resolution?, quality?, aspect? }, credits?, credits_verified?, source? }`. A model with no matching entry cannot be quoted: "No price for <ref> per <unit>. Add it to the price book before running."

### A.7.3 The two Higgsfield adapters as built

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

No ComfyUI code exists in the repository today. The ComfyUI routes below were read from ComfyUI's own `server.py` and `execution.py` (master branch, 2026-10-16); every route is also served under `/api`.

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

### A.7.5 Can it be added without editing core files?

**Not entirely.** The adapter itself is a new file, and models, prices and routing are data, but one core file has to change, and two Studio choices assume Higgsfield.

1. **Registry (required, about 3 lines).** `registry.gen()` in `server/providers/registry.ts` only knows `mock`, `elevenlabs` and `higgsfield`. Add, before the vault key lookup: `if (p === 'comfyui') return createComfyUiAdapter({ config: o.config, baseUrl: <from env or config> })`. The alternative that leaves the registry alone: `createRegistry` already accepts `overrides: { gen: { comfyui: adapter } }` (checked before the key lookup, used by tests); passing it from `server/bootstrap.ts` is a one-line change there instead.
2. **New file**: `server/providers/comfyui.ts` implementing A.7.4.
3. **Data only** (no code):
   - `config/models.yaml`: one entry per ComfyUI workflow, for example `ref: comfyui/flux-scene-still`, `label`, `kinds`, `max_refs`, `endpoint` (can hold the workflow file name), `input_map` (any string; the ComfyUI adapter decides how to use it), `verified`, and `clone` for a motion workflow.
   - `config/pricebook.yaml`: an entry per model and unit with provider `comfyui` (price 0 is fine). Required: the runner prices every finished job from the price book (`actualGen` in `ingestGen`), whatever the adapter's own `estimate` returns, so a missing entry stops the job at ingest (and at quote time when `estimate` uses the price book too).
   - `config/routing.yaml` (`hero`, `sheet`, `upscale`), `config/scenes.yaml` (scene still and video models), `config/content.yaml` (stills and motion models): point at `comfyui/...` refs.
   - `config/runtime.yaml` `stuck_after_sec` if local runs are slower.
4. **Higgsfield assumptions in code** (small changes if those flows should use ComfyUI):
   - Slideshow stills and Recreate stills offer exactly two fixed choices, `still_model` ("Your Higgsfield plan") and `api_still_model` ("Higgsfield API") (`slideStillChoices`, `recreateStillChoices`). A `comfyui/...` ref in the API slot is blocked in live mode unless a Higgsfield API key is set (`apiKeyReady`), and is labeled "Higgsfield API".
   - The Recreate motion picker's path check (`motionPath` in `server/pipeline/clone.ts`) only knows the Higgsfield plan and the Higgsfield API; a `comfyui/...` motion model fails it in live mode without a Higgsfield key.
   - Higgsfield Elements (saved identities) ride along only on the Higgsfield plan path; a ComfyUI run gets the attached refs only.

---

## A.8 Gaps found while writing this appendix

Observed in the code or in the scratch runs, not fixed (this task changed no code). They matter mostly for a team copying the Studio's behavior.

1. **Template v1.6 Models heading is not read for models.** The hand-written importer reads preferred and avoided models only from a section titled exactly `Models` or `Model notes`; the template's `## Models (UNIVERSAL defaults, update as tests change)` is kept as text instead (A.1.4). The template check still counts it as present.
2. **post.json exists for slideshows only.** Video posts and batches export media without a JSON file (A.2.1).
3. **Topic slideshow prompts end the light sentence with two periods** ("...a little darker.."), because both the code and the template add one (A.5.3, sample 9b).
4. **The scene `setting` sentence is not capitalized** in the template path (sample 3: "... catches her attention. a small apartment kitchen at night ..."). Cosmetic.
5. **`neutral-body-cups` matches "A cup"**: its pattern includes `A` and has no "cup of" exception, so "A cup of coffee" would raise the warning. Read from the pattern, not run.
6. **CSV import run route**: a malformed body (no `csv`, or over 200,000 characters) is not turned into a 400 and would answer 500. Read in the code, not run.
7. **Batch from hooks cap**: the config schema allows up to 20 (`slideshow.batch_max`), but the post's schema stores at most 10 hooks; 10 is the real cap.
8. **The end-frame edit template names "the mole"** (`video.end_frame`) whatever the character's marks are.
9. **The motion prompt repeats the silent line** ("Silent." inside the template, then "Silent, no audio, no dialogue." from `assembleVideoPrompt`). Harmless.
