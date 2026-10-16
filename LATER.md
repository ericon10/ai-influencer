# Later

Small ideas noticed while building, kept here instead of built (owner,
2026-10-14: "put small ideas in LATER.md instead of building them").
Newest at the bottom of each section. Each is a default-level idea, not a
rule.

## Phase 3 (chaining, sound bed, rough cut)

- Refresh the Guide's screenshots for the new Finish step (rough cut and
  Sound row) and the Continue this shot panel; the text is already updated.
- A cutaway helper for a failed seam (SPEC 4.3 step 4): a 1-second shot of
  the scene (a glass, the string lights) generated to cover the seam. Paid,
  so it needs a quote and a model test first.
- Drag to trim and drag to reorder in the rough cut (today: numbers and
  arrows). Phase 4's editor covers this for heavy edits.
- A waveform on the Sound lane and on music chips, so the owner can see
  where a track builds.
- A "start the music at" offset per post (today a track starts at 0 s).
- Ambience tags matched to the scene's place (a cafe scene picks a cafe
  recording when one is tagged "cafe").
- Show each chained clip's seam scores in the clip drawer (they are stored
  in candidates.meta).
- Let "Continue this shot" also continue a clip picked in a batch.

## Phase 4 (Fine-tune, batch at scale)

- Snap to shot edges and to the playhead when dragging in Fine-tune.
- A waveform under the Sound lane in Fine-tune, and the clip's own sound
  as a lane when a clone keeps it.
- Keyboard nudge (arrow keys move the playhead one frame) and J/K/L
  playback in Fine-tune.
- Preview Room tone in the browser (today it is mixed only in the export).
- Batches: a progress line per batch on Posts home ("12 of 50 done"), and
  a batch Fine-tune that edits the template every video shares.

## Phase 5 (Amazing Edits)

- A live preview of the edit inside Fine-tune (CSS zooms and a slowed
  playback rate in the browser), instead of the badge.
- Per-edit fine numbers in Fine-tune (zoom amount, slow-motion speed,
  freeze length) on top of Subtle, Normal and Strong.
- More than one edit per post (a zoom-out reveal at the start and a freeze
  at the payoff), each with its own marker on the Edit lane.
- Sound accents that ride with an edit: a whoosh under the whip pan, a hit
  under the flash, from the owner's uploaded sounds (no AI sound).
- Pick the punch-in beats by hand (tap along while the music plays).
- Thumbnails rendered from one of the owner's own kept clips, once there
  are clips to choose from.
- Trim shot B's handoff automatically for the whip pan (start it on its
  blurriest frame).
- Make the close-up for the whip pan and hand over the lens too (today it
  is offered for the crash zoom).

## Overnight run

- A cleaner room behind her for the dolly zoom: fill her area with a
  normalized blur of the room only (no halo on high-contrast hair).
- Text behind subject: drag the words up or down in Fine-tune, and pick
  their color.
- Split screen: a "reaction" layout (her small in a corner over shot A).
- The green screen in batches (one background per video).
- A person mask cache per clip, so a re-export skips making it again.

## Editor (OpenReel)

- Own moving thumbnails for the nine presets that share one (rendered by
  the worker's preset renderer from the same keys).
- Drag a preset card straight onto the timeline (today: click places it at
  the playhead).
- More suggested spots: a reaction peak (face motion) and the loudest beat.
- Seamless loop as a preset (trim to the frame closest to the first).
- The editor's caption box like the worker's: rounded corners, padding
  and the bundled TikTok Sans, so captions match to the pixel.
- More than one time, text or layout preset per video on the worker
  (today the first one renders, the rest are listed).
- Run scripts/editor-parity.mjs in CI with a Chromium that has H.264.
- Tune the clone cleanup on real saved TikToks (the end card and the
  handle positions); a per-clip "these spots" picker on the frame.
- CSV import: a "Generate all new rows" button with one combined price.

## Voice lines

- **Lip sync (plan only, owner 2026-10-14).** A converted voice line on a
  talking take: the take's mouth re-timed to the line. Plan:
  1. Model: a lip-sync model on the official Higgsfield Model API
     Reference, or ElevenLabs' own when it ships one; confirmed by one small
     paid test (Settings, Higgsfield models) like every model. Prices from
     open.higgsfield.ai/pricing, shown before the run.
  2. Input: the post's clip (a front-facing take, the mouth visible for the
     whole line) and the converted line's MP3. The Video step offers "Lip
     sync to the voiceover" only when the post has a voiceover and a clip
     at least as long as the line.
  3. Realism: the free face match against REF-00 and the skin texture
     check run on the result, like an upscale; a smoothed or drifted face
     is flagged, never silently kept. No beautify or face-enhance option.
  4. Captions stay from the line's word timings; the take's own sound is
     replaced by the line (the voiceover layer, ducked bed).
  5. Kept as a new take of the clip (Use this take decides), so the
     original stays.
- A "voice" column in the CSV import (a hook number picks that
  character's converted line for the row's post).
- Re-time a voice line's captions by hand (drag word edges) when the word
  timings are off.
- Batch voiceovers: one converted line per caption, matched by hook
  number.

## Scale kit

- Pull signups from the link tracker or the checkout (an API key or a
  CSV upload) instead of typing them; keep a weekly history per account
  so the scoreboard can show "this week".
- "Clone what sells": from the top account, one click makes the same
  posts for a paused account's character.
- Write variants for many hooks at once (pick 10 to 15 for the week, one
  price), matching the kit's weekly rhythm.
- A Hook column in the CSV import (the hook number fills the caption with
  that character's variant, or the hook).
- Show which hooks each account already posted, so the vault suggests the
  ones it has not.
- A claims check on the batch caption writer's output too (today on hook
  variants only).

## Storage and traffic (parked by the owner, 2026-10-15)

- **Slim the posts list.** With the files off Vercel, JSON is what is left
  of a session's origin transfer, and most of it is the posts list
  (`GET /content`: every post with its whole spec, polled while anything
  runs), then a character's scenes and the Library. A measured local
  session (`e2e/editor/storage.spec.ts`, transfer): `/content` 1.31 MB,
  scenes 0.58 MB, library 0.33 MB of 2.46 MB. Ideas: a summary list (id,
  title, kind, step, status, character, thumbnail) with the full post from
  `GET /content/:id`; ETag or a `since` cursor so a poll that changed
  nothing sends nothing; poll only the running jobs.


## Long run (owner away, 2026-10-15)

### Paid tests queued for the owner

No paid run was made in the long run; each of these needs a quote shown
first.

- **Soft everyday makeup on a real still:** one public scene for Callie
  on Flare (her own everyday line plus "the same lip shape, nose and jaw
  as the references"). Check the lips and nose hold against REF-00 and no
  gloss creeps in. About 1 still.
- **Hair styling line:** two scenes with different rotated stylings (for
  example "half-up claw clip" and "low loose ponytail") on Flare and Nano
  Banana 2.1. Check the styling follows and the color and texture stay
  REF-00's. About 4 stills.
- **No makeup in a gym scene:** one gym scene, to check "No makeup, bare
  skin" reads as bare and not as a sheet look. About 1 still.

- **Winning stack in a real prompt (part 3):** one Write and generate for a
  character with a winning stack, to see the writer carry it without
  bending the shot. About 1 Claude call and 1 still.
- **Brand check on real moments (part 3):** one Punch it up on a rough idea
  that is off brand, to see the note come back. About 1 Claude call (under
  a cent).

### Small ideas (not built)

- Hair rotation could prefer stylings that fit the moment (damp and
  air-dried after a swim, sunglasses as a headband outdoors). Today it is
  bank order, never one of the last 5.
- A "Makeup: by setting" chip in the Idea step's chips row, so the setting
  choice shows without opening More control.
- The template check could offer "Add the missing sections" with the
  template's blank text, so the Brand card has every field to fill.
- A monthly reminder on Posts home for the growth review (template step 13),
  with the top 5 reels by follows once TikTok stats come in.
- Hook variants could swap the opening time, text or layout edit too
  (today the first edit is a camera preset only, since the worker draws
  one of those per whole video).
- A cover chosen in the editor, on its own timeline frame, with the safe
  zones on.
- Safe zones for YouTube Shorts.

## Slideshow power-up (2026-10-16)

### Real test made

- **One camera roll, Nano Banana 2.1 on the plan:** 4 stills of Callie at
  1k 9:16 with her element and the exact Studio prompts. Quoted 1.5
  credits a still first, charged 6.0 credits in all (31.2 to 25.2), about
  $0.38 at the API rate. Same office, the same gray crewneck, blue mug and
  sticky notes on every slide.

### Paid tests queued for the owner

- **Topic mode on Flare (API path):** one feeder set of 6 stills (an
  office, a skyline, a commute) on GPT Image 2.5 Flare with an API key, to
  check no person creeps in and the place holds. About 6 stills.
- **Claude hooks and drafts:** Write 10 with Claude and Use this hook on a
  real account voice card, to see the patterns land and the reveal sit on
  slide 3 or 4. About 2 Claude calls (a few cents).
- **Make 3 variations:** to check the new wording and new pictures read as
  new posts and the no-reuse warning stays quiet. About 18 stills.

### Small ideas (not built)

- A per-slide font size nudge on top of the style's own size.
- Drag the words on the slide strip thumbnails too (today: the big
  preview).
- More special slides: a calendar invite, a bank alert, a step counter.
- A "Same scene as last post" chip in the Scene library.
- Batch review: approve all that have every picture in one click.
- Export straight into the posting engine once its format is fixed (the
  mapping already lives in server/core/postExport.ts).

## Slideshow power-up 2: launch ready (2026-10-16)

### Paid tests queued for the owner

- **The capped real test (under $1, the owner's click in production):**
  Posts > Launch plan, import the plan CSV (free), then Generate 1 post
  for one feeder row on GPT Image 2.5 Flare on the Higgsfield API (6
  stills, about $0.36) and 1 post for a Callie slideshow row (6 stills).
  The first real API-path run.
- **Write 10 with Claude, the playbook way, on a real account:** the
  writer and the reviewer on F2 and on CALLIE, to see the codes, moments
  and scores land and how many the reviewer hides. Two Claude calls each
  (a few cents).

### Small ideas (not built)

- The Accounts card could show a topic account as "Topic" in its
  character column (today it shows the character its pictures are filed
  under).
- The plan grid could open a row's post on a click (today: the list below
  the import).
- Drag the product screenshot freely (today: Top or Middle and a size).
- A "Generate the rest of this day" button on the plan list.
- Read stat_source into a small source line on the last slide of a stat
  post, when the owner wants one.

