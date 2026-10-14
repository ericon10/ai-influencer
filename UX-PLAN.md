# Character Studio UX plan

Status: APPROVED by the owner (2026-10-13), with the decisions in section 0.
Built (the refactor, step 2 of section 7): every page below exists, the old
addresses redirect, and the click counts in section 6 were measured in the
browser in demo mode. Clone Video is built too (step 3 of section 7,
DECISIONS G18). Every new feature must fit this plan or update it first.

Wireframes: `docs/studio/ux/` (rough, grayscale; numbers match section 4).

---

## 0. Owner decisions (2026-10-13)

- **Home is Posts.** `/studio` opens the Posts list.
- **No separate Create pages.** Making stills and clips happens inside a
  post, in its steps.
- **Picking a take keeps it.** "Use this take" is the Keep; there is no
  separate Keep click.
- **"Write and generate": yes.** One priced button writes the prompt and
  generates; the written prompt stays shown and editable for the next run.
- **Auto-write the video prompt when a still is used: yes**, priced first.
- **Usage and Rules become Settings tabs.**
- **The worker light ships first**, before the refactor.
- **Character setup: the mole above her left brow is the only fixed
  mark.** The ear cuff comes out of the marks (jewelry is a default, like
  any outfit choice).
- **Batch rotates clips.** Pick several clips (and several B-roll clips);
  the batch rotates them across the captions instead of one clip for all.
- **"Make another like this"** on every post: it duplicates the post with
  everything filled in and opens it at the Text step.
- **Account tag on each post** (e.g. "Callie TikTok"), chosen in the Idea
  step. Posts home filters by account and by character.

---

## Rule 1 (above everything): seamless, one-place workflow

- **One main workspace per post.** I start with an idea and finish with an
  exported post without leaving that screen: idea > stills > video or
  clone > caption or slides > export or Fine-tune. The steps flow top to
  bottom on the same page, as a stepper.
- **Never send me to another page to get something I need.** The Library,
  B-roll, characters and uploads open in a side panel (a drawer) inside the
  workspace. Pick, and it drops into the step.
- **Anything needed mid-flow happens inline in that step**: upload a clip,
  clone a TikTok, make a still. Not on a separate page.
- **The editor (OpenCut, Phase 4) opens over the workspace**, and "Done"
  returns to the same spot.
- **Separate pages only for setup and browsing**: Characters (create, face,
  reference sheet, character file), Library (browse everything), Settings.
- **Count clicks.** From idea to exported post takes the fewest steps
  possible. The main flows and their click counts are in section 6.

Rule zero (Realism) and rule one of SPEC.md (defaults, not locks) still
apply inside every step; this plan is about where things live and how they
flow, not what the rules are.

---

## 1. The journey, end to end

```
 SETUP (once per character)          MAKE (one workspace per post)                       OUT
 ┌───────────────────────┐   ┌──────────────────────────────────────────────────────┐   ┌──────────────┐
 │ Characters            │   │ Post workspace  (Video post, Slideshow or Batch)     │   │ Export       │
 │  Inspiration          │   │  1 Idea        what the post is, character           │   │  MP4 / JPEGs │
 │  Face (hero)          │──>│  2 Stills      make them here, or pick from Library  │──>│  zip         │
 │  Reference sheet      │   │  3 Video       video from a still | clone TikTok/Reel│   │ Publish      │
 │  Character file       │   │                | upload a clip | pick from Library   │   │  (TikTok     │
 └───────────────────────┘   │  4 Text        caption | hook and slides | captions  │   │  prepare and │
                             │  5 Finish      rough cut, sound > Export or Fine-tune │   │  notify, R7) │
                             │                         (OpenCut over the page,     │   └──────────────┘
                             │                          Phase 4; Done comes back)   │
                             └──────────────────────────────────────────────────────┘
                                         │ everything made lands in │
                                         v                          v
                             ┌──────────────────────────────────────────────────────┐
                             │ Library: Stills, Clips, B-roll, Posts (browse,       │
                             │ download, "Use in a new post")                       │
                             └──────────────────────────────────────────────────────┘
```

- **Steps adapt to the post type.**
  - Video post: Idea, Stills (optional), Video, Caption, Finish.
  - Slideshow: Idea, Stills, Slides, Finish.
  - Batch: Idea, Video, Captions, Finish.
- **Clone Video lives in step 3 (Video)** as "Clone a TikTok or Reel". The
  saved file is uploaded inline, the post's character (or characters) is
  pre-filled, there's a model picker with prices and an "Original sound"
  switch, and the price comes first. The result is selected in the step
  and is also saved to Library > Clips. Shortcut: "New post from a TikTok"
  opens a video post with the clone option already open.
- **OpenCut (Phase 4) lives in step 5 (Finish)** as "Fine-tune". It opens
  full screen over the workspace with the post's clips, B-roll and caption
  as editable layers. "Done" saves the MP4 back to the post (and the
  Library) and returns to step 5.
- **Publish** (roadmap R7) is the last action in step 5, once built.
  Instagram is ready-to-post files only.

---

## 2. Sitemap

The sidebar is organized by what I'm making: a big **New post** button,
then Posts, Characters, Library, Settings. The worker light sits at the
top; Activity, the month's spend and Demo/Live sit at the bottom.

| Page | Route | What it's for | What I get |
|---|---|---|---|
| **Posts** (home) | `/studio` | Every post: drafts, ready, exported. Filters: account tag, character. New post (Video post, Slideshow, Batch, From a TikTok). "Make another like this" on each post | A list of my posts and one click into any of them |
| **Post workspace** | `/studio/posts/:id` | Make one post, idea to export, on one page (rule 1) | "Make a video post", "Make a slideshow", "Make a batch of video posts" |
| Editor overlay (Phase 4) | `/studio/posts/:id/edit` | OpenCut over the workspace | A fine-tuned MP4 saved back to the post |
| **Characters** | `/studio/characters` | All characters; make or import one | "Your characters" |
| **Character setup** | `/studio/characters/:id` | Inspiration > Face > Reference sheet > Character file, as a stepper | "Set up Callie": a finished reference sheet and character file |
| Sheet review | `/studio/characters/:id/review/:ref` | Full-screen review of sheet results (setup only) | An approved sheet shot |
| **Library** | `/studio/library` | Browse everything made: tabs Stills, Clips, B-roll, Sounds, Posts; filter by character and product; download; "Use in a new post"; upload B-roll, clips and sounds | My library |
| **Settings** | `/studio/settings` | Tabs: General (mode, keys, Higgsfield billing), Models (Claude, Higgsfield), Rules, Budgets and usage, Notices | A Studio set up the way I want |
| **Guide** | `/studio/guide` | The visual manual (owner, 2026-10-13): Quick start, the big picture, every page and step with an annotated screenshot, and a glossary. In the sidebar under Settings | "How do I use this?" answered with pictures |

**Not pages** (they open as drawers inside whatever page I'm on):

- **Library drawer**: Stills, Clips, B-roll, Posts. Pick, and it drops in.
- **Character drawer**: switch the post's character; "Set up a new
  character" opens Characters.
- **Upload**: inline in the step that needs it (a drop zone).
- **Still or clip details**: fix one thing, crop, upscale, check, keep or
  reject, download.
- **Activity**: everything running or needing me.

**Old routes redirect** (nothing breaks):

| Old route | Opens |
|---|---|
| `/studio/c/:id` | `/studio/characters/:id` |
| `/studio/c/:id?tab=scenes&scene=X` | The post that holds scene X; if none, Library > Stills filtered to X |
| `/studio/c/:id/review/:ref` | `/studio/characters/:id/review/:ref` |
| `/studio/content?tab=meme\|slideshow\|batch&item=X` | `/studio/posts/X` |
| `/studio/content?tab=broll` | `/studio/library?tab=broll` |
| `/studio/usage` | `/studio/settings?tab=usage` |
| `/studio/settings/rules` | `/studio/settings?tab=rules` |

---

## 3. Shared patterns (every page)

1. **Required fields.** As few as possible. Each one shows a REQUIRED badge
   and a colored border until filled, then turns green (Done).
   Placeholders start with "e.g.". Fields that are optional say so in the
   section header.
2. **Empty states are never a dead end.** Every empty step, list or tab
   shows the next-step buttons right there:
   - No clip: [Make a video from a still] [Clone a TikTok or Reel] [Upload a video]
     [Pick from Library].
   - No stills: [Make stills from my idea] [Pick from Library].
   - No characters: [Set up a character] [Import one].
   - Empty Library tab: [Start a post] (and [Upload] where it fits).
3. **Price buttons.**
   - Label, price and model name on every paid button ("Generate 2 stills
     · 8.24 credits · Nano Banana 2.1").
   - "Getting price..." while it loads; after 10 seconds, the reason and a
     Retry button.
   - Details shows the hard-wrapped prompts with Copy. Confirm above the
     threshold.
   - Local renders say "Free".
4. **Worker status.** A light at the top of the sidebar: green "Worker
   ready · version", yellow "Worker restarting", red "Worker down". While
   it isn't green, every button that starts work is held, with the reason
   above it. Nothing gets stuck at "Preparing...".
5. **Feedback everywhere** (owner, 2026-10-13). Every button that starts
   work follows the same pattern:
   - **Instant:** the moment it is pressed it switches to a working state
     (spinner, "Submitting...") and cannot be pressed twice.
   - **Live status, in the step:** from the runner's real state, never a
     fake bar: Submitting, Queued at the provider (for example "Queued at
     Kling 3.0 Pro"), Generating with the elapsed time and the usual time
     for that model (the account's own median, else a typical time),
     Downloading, Checking, Done. Many runs of one kind (a batch, several
     stills) read as one line ("3 of 20 done").
   - **Done:** the result appears with a short highlight; when the step is
     scrolled out of view, a small toast with Show brings it back.
   - **Failed:** plain words for what happened, whether anything was
     charged (a failed run releases its hold), a Retry (priced, like any
     run), and the provider's own message under Details. No silent
     failures, and no result appearing minutes later without a signal.
   - **Activity** in the sidebar shows the same rows: running work first,
     then what finished in the last 15 minutes.
   - The stepper still shows each step as Done, Current or Waiting, and a
     done step folds to a one-line summary with Change.
6. **Errors.** Plain words: what happened, what to do, and a Retry. The
   provider's own message is passed through. Never "Something went wrong".
   Failed runs note that the provider refunds them.
7. **Drawers.** Open on the right (a bottom sheet on a phone). Esc or ×
   closes, and I'm back exactly where I was. Picking an item closes the
   drawer and the item appears in the step.
8. **Saving.** Everything saves as I type ("Saving..." then "Saved"). No
   Save buttons. Leaving and coming back restores the post at its step.
9. **Copy.**
   - Titles say what I get ("Make a video post").
   - No em-dashes, anywhere.
   - Prompts are hard-wrapped with Copy.
   - Every export reminds me to turn on the AI-generated label.
10. **Rules.** Default rules show as warnings inside the step they concern,
    with a one-click fix where there is one. Fixed rules block, with the
    reason.
11. **Phone.**
    - The sidebar becomes a bottom bar: New, Posts, Characters, Library,
      Settings, Guide.
    - Steps stack, and drawers become bottom sheets.
12. **How this works** (owner, 2026-10-13). Every page and every post step
    has a small "How this works" button in its header. It opens that
    section of the Guide in a drawer: what it is, what to do, tips, what
    costs money, and an annotated screenshot of the real screen. "Open the
    full guide" goes to `/studio/guide`. New users see a one-line Quick
    start banner on Posts home until they close it.

---

## 4. Wireframes

Rough, grayscale, desktop unless noted. Files in `docs/studio/ux/`.

1. `01-posts-home.png`: Posts home, the sidebar, and the New post menu
2. `02-video-post.png`: Video post workspace with Stills done and Video
   open; the empty-clip next steps
3. `03-video-clone-drawer.png`: Video step, "Clone a TikTok or Reel" inline,
   with the Library drawer open
4. `04-finish.png`: Finish step (preview, Export, Fine-tune)
5. `04b-editor-overlay.png`: Fine-tune: OpenCut over the workspace
   (Phase 4); Done returns to step 5
6. `05-slideshow.png`: Slideshow workspace
7. `06-library.png`: Library page
8. `07-character-setup.png`: Character setup stepper
9. `08-phone.png`: Video post on a phone

---

## 5. What changes in the current app

| Today | After the refactor |
|---|---|
| **Sidebar:** Characters, Content, Activity, Usage, Settings | **Sidebar:** New post, Posts, Characters, Library, Settings. Footer: Activity, spend (opens Settings > Usage), Demo/Live. Worker light at the top |
| **Character page:** tabs Start, Hero, Sheet, Scenes, Character file | **Character setup stepper:** Inspiration, Face, Reference sheet, Character file. The Scenes tab goes; making stills moves into a post |
| **Scene editor** (on the character page) | The **Stills step** of a post: the same idea box, Punch it up, planner, prompt writer, models and Generate, with the still drawer for fixes. A post creates its scene behind the scenes |
| **Make a video** card (inside the scene editor) | The **Video step**, "Make a video from a still" (real video starting from your photo): the same model picker, takes and Upscale. One box, "What happens in the video": "Use this still" has Claude write the video prompt into it (the guide's labeled lines, FORMAT to CONSTRAINTS; priced); edit it or Rewrite; the directions and "If a take looks off" are small lines under it. Both prompt boxes show an editable "Director's notes" line above the prompt (DECISIONS G20) |
| Clone Video (roadmap R1, not built) | The Video step's **"Clone a TikTok or Reel"** option, inline |
| **Content page:** tabs Meme video, Slideshow, Batch, B-roll | Post types in the workspace: **Video post** (was Meme video), **Slideshow**, **Batch**. The "Text-overlay content" title goes; captions are a step |
| B-roll tab | **Library > B-roll** (browse, upload, tag), and the Library drawer inside the Video and Caption steps |
| **Usage page** | Settings > Budgets and usage (the footer spend meter links there) |
| **Rules page** | Settings > Rules |
| Sheet review page | Stays full screen; it's part of character setup |
| Export buttons per builder | One **Finish step**: preview, Export (free render), Fine-tune (Phase 4), Download, later Publish |
| Content items and scenes are separate | A **post** (today's content item) holds its idea, the scene(s) its stills came from, the chosen clip, B-roll, text and exports. Scenes made outside a post (all of today's) show in the Library and can start a post |
| No worker light | Worker light and held buttons. Shipped before the refactor |
| Character marks include the ear cuff | The mole above the left brow is the only fixed mark; the ear cuff is jewelry (a default) |
| Batch: one clip for all captions | Batch: pick several clips and B-roll clips; they rotate across the captions |
| No way to repeat a post | "Make another like this" on every post: a filled-in copy that opens at the Text step |
| Posts have no account | Each post has an account tag (e.g. "Callie TikTok"), set in the Idea step; Posts home filters by account and character |

**Data changes (built, migration 0008):**

- `content_items` are the posts: `kind` (meme is a video post), `idea`,
  `scene_id`, `account_tag` and `step`. A video post's spec keeps its clip
  and the still it was made from; a batch's spec keeps lists of clips and
  B-roll clips that rotate across its captions.
- A post points at its scene (`scene_id`), so scenes need no post column.
  The scene is made from the idea once there is one, and its words follow
  the idea while they still match.
- Uploaded clips are candidates with `op` `upload` (and a `label`, the file
  name), so they show in Library > Clips and in every clip picker. Clones
  will use `op` `clone`.

---

## 6. Click counts (idea to exported post)

Clicks only; typing the idea or a caption isn't counted. "Today" is the
current app; "Plan" is this layout.

Measured in the browser after the refactor (demo mode): video post from an
idea **8**, slideshow from an idea **8** (with 2 stills; one more click per
extra still), batch **9** with one uploaded clip and one from the Library
(**8** with one clip from the Library).

| Flow | Before | Plan | How the plan saves clicks |
|---|---|---|---|
| **Video post from an idea** (still > take > caption > MP4) | 18 clicks, 3 pages | **8**, 1 page | No page changes; "Write and generate"; the video prompt is written when a still is used; picking a take keeps it; the clip and caption steps are already open below |
| **Video post from a TikTok** (clone > caption > MP4) | not possible | **8** planned; **7** measured (8 with a Confirm), 1 page | "New post from a TikTok" opens the clone option directly; the character comes from the post |
| **Slideshow** (6 stills from the Library > slides > JPEGs) | 15 (Content page, 6 picks, write, export, download) | **12**, 1 page | Multi-pick in the Library drawer adds all at once |
| **Slideshow from an idea** (generate 6 stills > slides) | 20+, 3 pages | **9**, 1 page | Stills made in the Stills step are picked in place |
| **Batch of 20** (clip > 20 captions > 20 MP4s) | 9 | **7**, 1 page | The clip picker in the Video step; captions written in place |

**The plan's video-post flow, click by click:**

1. New post
2. Video post (the character defaults to the last one used)
3. Write and generate 2 stills (one price for both)
4. Use this still (the video prompt is written, priced first)
5. Generate a take
6. Use this take (this keeps it)
7. Export MP4 (after typing the caption)
8. Download

Two approved shortcuts make it 8 instead of 10:

- **"Write and generate"** (one price for both). The prompt is still shown
  and editable for the next run.
- **Auto-write the video prompt** when a still is used (priced first).

**The plan's clone flow:**

1. New post from a TikTok
2. Choose file
3. (Model and sound are pre-filled) Clone it (priced)
4. Use this clip
5. Export MP4 (after typing the caption)
6. Download

That's 6 at the least, and 8 if I change the model or add a second
character.

Measured in the browser after Clone Video was built (demo mode): **7**
(New post, Video post from a TikTok, Choose the video, Clone it, Use this
clip, Export MP4, Download), and **8** when the price is over the confirm
threshold (one Confirm click, the price-first rule).

---

## 7. Order of work after approval

1. Ship the worker light (done first, on its own). Done.
2. Done: refactor the existing pages to this layout (routes, sidebar, post
   workspace with the stepper, drawers, Library, Settings tabs, redirects),
   with the four items folded in from section 0 (mole as the only fixed
   mark, batch clip rotation, "Make another like this", account tag). No
   other new features in this step.
3. Done: Clone Video in the Video step (upload, characters, model picker
   with prices, original sound optional, result in Library > Clips;
   DECISIONS G18).
4. The rest of Phase 3 (chaining, sound bed, rough cut), fitted into the
   steps as section 8 describes (2026-10-14).

---

## 8. Phase 3 finish: chaining, sound bed, rough cut (2026-10-14)

No new pages and no sidebar items. Everything sits in the post workspace,
with one new Library tab.

| Piece | Where it lives | What I do | Extra clicks |
|---|---|---|---|
| **Continue this shot** (chaining) | Video step, under "The clip" | Press Continue this shot (free). Its last frame (full size, stepped back if blurry) becomes the start frame of the next take, the same model is picked, and the prompt carries "same place, same light, same wardrobe". Generate a take, then Use this take: the takes are joined into one longer clip (seams scored, never crossfaded) | **3** per extra shot (Continue, Generate, Use) |
| A seam that fails | Video step, a callout under the clip | Regenerate the take, or "Keep them as two shots" (a real cut between two shots in the rough cut) | 1 |
| **Sound** (sound bed) | Finish step, the Sound row | Ambience: None, Room tone (built in) or a recording I uploaded. Music: None or a track I uploaded, ducked under the clip's own sound. Mixed and normalized to social loudness (-14 LUFS, -1 dBTP). No AI music | **0** (Room tone by default); 2 to add music |
| Upload a sound | Finish step (inline) and **Library > Sounds** (new tab: ambience and music, tagged) | Choose a file; it is converted and measured | 1 |
| **Rough cut** | Finish step, above Export | The post's clips, B-roll and captions laid out as one timeline, built automatically from the steps above. Click a block to trim it, move it or remove it; add a clip, B-roll or a caption; Rebuild returns to the automatic cut. Export renders exactly this timeline, and Fine-tune (Phase 4) opens the same layers | **0** (automatic) |

The video-post flow stays at **8** clicks; a two-shot chained video post is
**11** (8 plus Continue, Generate, Use).

---

## 9. Phase 4: Fine-tune over the workspace, batch at scale (2026-10-14)

Still no new pages and no sidebar items: the editor route was already in
the sitemap (`/studio/posts/:id/edit`, "Editor overlay").

| Piece | Where it lives | What I do | Clicks |
|---|---|---|---|
| **Fine-tune** | Finish step, next to Export; opens `/studio/posts/:id/edit` full screen over the workspace | The rough cut opens as layers: Video (clips and B-roll), Text (captions), Sound (ambience and music), and later Edit style. The preview plays the cut with its captions. Click the timeline to move the playhead; split a shot at the playhead, trim it, move it, delete it; drag a caption or change its text and times; set the levels; undo and redo. Nothing is downloaded: the clips stream from storage | **1** to open |
| **Done** | The editor's header | Saves the cut and the sound to the post, renders the MP4 on the worker (free), and returns to the Finish step, where the render shows live. The MP4 is the post's export, so it is also in Library > Posts | **1** |
| Cancel | The editor's header (or Esc) | Back to the Finish step with the post unchanged (asks first when something changed) | 1 |
| Editor engine | Inside the overlay | The Studio's own layer editor, on OpenCut's track layout (one main video track, text over it, audio under it) so the OpenCut engine can take the same project later. Why OpenCut itself is not inside yet: DECISIONS G23 | |
| Notices | Settings > Notices | OpenCut's MIT license, verbatim, with the other open-source notices | |
| **Batch at scale** | A batch post's Finish step | Up to 50 videos, clips and B-roll rotated. Each video is its own short job on the worker, so a crash or a deploy never counts a video twice or loses one; "Retry the failed ones" re-renders only those; the download is a zip, in parts of at most 150 MB | **1** to retry |

The video-post flow stays at **8** clicks; Fine-tune adds **2** (Fine-tune,
Done) when used.

---

## 10. Phase 5: Amazing Edits (2026-10-14)

One feature, about ten edits, all rendered free by code (ffmpeg on the
worker), never by a video model. It lives in exactly four places, and
nowhere else:

| Place | What it does | Clicks |
|---|---|---|
| **Idea step: Format** (default "Single take") | Pick the post's format up front: a one-shot edit (speed ramp, punch-in, freeze and caption pop, flash and shake, seamless loop, word pop, zoom-out reveal) or a two-shot edit (crash zoom cut, whip pan, hand over lens). It sets the edit style, and a two-shot format plans the shots below | 1 (optional) |
| **Video step: shot slots** (two-shot formats only) | Shot A (the post's clip, as today) and Shot B, each with its direction already in its prompt (for example "ends with a fast whip to the left"). Shot B: make it from a still, pick it from the Library, or upload it. Crash zoom adds **Make the close-up**: a free crop of A's last frame around the face, then the existing priced Upscale and Generate a take | 2 to 3 for Shot B |
| **Finish step: Edit style** (default None) | A row of the edits, each with a moving preview thumbnail and a one-line description, plus Subtle, Normal or Strong. Export renders it | 1 (optional) |
| **Fine-tune** | The Edit lane (between Text and Sound) shows where the edit acts, striped. Click it for the Edit panel: style, strength, where it lands. Drag the payoff marker (where a speed ramp, freeze or flash lands); Undo takes it back. The preview plays the plain cut with a badge inside the edit; Export renders it | 1 to open the panel |

No edit adds a page, a drawer or a sidebar item. A post with no edit
exports exactly as before.


## 11. Overnight run (2026-10-14)

Each piece is placed here before it is built. Rule 1 holds: one post
workspace, drawers and inline steps; no new page or sidebar item.

| Piece | Where it lives | Clicks |
|---|---|---|
| Batch progress | Posts home, on a batch's card: "12 of 50 done", a thin bar while it renders | 0 |
| Edit pack 2 | The same four places as pack 1, nothing new: Idea step Format, Video step shot slots, Finish step Edit style, Fine-tune Edit lane. Ten more edits with a moving thumbnail and one line each | 1 (optional) |
| Split screen, zoom-rotate spin | Two-shot edits: shot B sits under shot A in the Video step, as for the crash zoom. Split screen adds Stacked or Side by side under Subtle, Normal, Strong | 2 to 3 for shot B |
| Green-screen reaction | Her clip over the post's B-roll (a screen recording, or a screenshot image uploaded as B-roll). The Finish step lists "Pick B-roll for the background" until there is one, linked to the B-roll field | 1 to 2 |
| Text behind subject, green screen, dolly zoom | Need her outline (a person mask). The worker makes it at export, free; nothing to click | 0 |
| Karaoke captions, word pop | Caption edits: the caption itself changes, the picture does not | 0 |
| Spreadsheet import (item 3) | A batch's Idea step, "Import a spreadsheet" card: paste or upload a CSV (one row per post: character, account, clip or still prompt, video prompt, caption, edit style). A preview table shows each row's status (reuses a clip: free; new still and video: priced; a problem, named) and the total price, before anything runs. "Make N posts" creates the video posts (on Posts home, tagged with their accounts); "Export the free ones" renders the rows that reuse a clip (free). Rows with prompts open at their Stills step with the prompt filled, each generated with its own price as always | 3 to import and export the free ones |
| Clone source cleanup (item 3) | Automatic while the clip to clone is prepared (Video step, Clone panel): the TikTok end card is trimmed; burned-in captions and the bouncing handle watermark are found and blurred out before the clone runs, with a note and an "Undo the cleanup" switch. "Read its caption" (Claude, priced on the button) puts the clip's caption into the post's caption, editable | 0, or 1 to read the caption |

## 12. The editor: OpenReel on one timeline (owner, 2026-10-14)

The owner's OpenReel fork replaces Fine-tune, the rough cut panel and the
whole-video Edit style. Edits are placed on a timeline where the owner
sees, drags and trims them; nothing is guessed for the whole video. Rule 1
holds: no new page in the sidebar; the editor opens from the post and
returns to it.

**Where it lives.** Finish step, "Open the editor" (desktop). It opens full
screen in the same tab at `/editor/?studio=<post>` with a slim Studio bar
on top: "Back to the post", what is happening, and **Done**. Done exports
in the browser, saves the MP4 to the post and the Library, keeps the
timeline for the next edit, and returns to the Finish step scrolled to
where the owner left it. Back returns without saving.

**One timeline per post.** The timeline (an OpenReel project, JSON in R2)
is the post's source of truth: video track(s), B-roll, captions, effects
(presets), voice lines, the sound bed and music. The Studio assembles it
from the steps above (clips, B-roll, captions, sound) the first time it
opens, so there is no separate rough cut to build. Posts made before keep
their cut and edit style; the first open turns them into a timeline.

**Presets, not whole-video styles.** The editor's Presets panel lists the
library (transitions, moments, text, caption looks, layouts), each with a
moving thumbnail and one line. A preset drops at the playhead as a block
with handles: drag, trim, Subtle/Normal/Strong, and its keyframes stay
editable. The Studio may suggest spots (the payoff, a beat, a reaction
peak) as markers; one click accepts one; nothing is placed without the
owner. The Idea step's Format stays as a template that pre-places presets
for the owner to adjust. Two-shot presets keep shot B in the Video step,
with "Make the close-up".

**Beat sync.** The Presets tab's Beat card: the post's music comes onto the
timeline and its beat is found when the editor opens (0 clicks); "Add
music" adds another track; Tap (4 taps or more) or a typed BPM lays a grid
from the playhead. Beat markers show on the timeline and clips, captions
and presets snap to them. Done asks nothing extra; "Music in the export"
(in the Beat card, on by default) leaves the music out when the owner adds
the TikTok sound in the app.

**Saved styles.** The Presets tab's Styles card: "Save as a style" keeps the
stack with relative places ("at the payoff", "on cut 1", "on beat 4");
one click places a saved style on the open timeline. "Make another like
this" carries the post's stack into the copy, placed on its first open.

**Ripple trim.** A switch in the Studio bar, on by default: trim a shot
shorter and the shots after it slide over.

**Phone.** Editing is desktop first. On a phone the Finish step shows the
preview, Trim start and end, and Export (the worker renders the same
timeline). "Open the editor" says it works best on a computer.

**Batch.** Up to 50 videos render on the worker from the same timeline
JSON, with each video's clip and caption swapped in.

**Rendering on the worker (phase D).** One renderer for camera presets:
the worker runs the editor's own camera math frame by frame (parity
tested against the editor's export). Time, text and layout presets use
the worker's code edits (G24, G26) of the same name. What renders where:

| Post | Export MP4 (worker, free) | Done in the editor |
|---|---|---|
| Never opened in the editor | Its cut and its Format, as before (the worker's code edit) | Lays it out, places the Format's preset |
| Edited in the editor | Its saved timeline: shots as trimmed, presets, captions (look and place), music on or off | The export, as before |
| Made with "Make another like this" | Its own cut with the carried presets at its own payoff, cuts and beats | Places the stack on first open |
| Batch | Each video: its clip and caption, with the batch's style placed at that video's payoff, cuts and beats | Not used |

Effects only the editor can draw (OpenReel's own effects and
transitions, text animations, layouts made by hand) are listed under the
worker's export, with "Open the editor and press Done" as the way to get
them. Nothing blocks an export.

**A batch's style.** Finish step of a batch, "Style": None or one of the
saved styles (from the editor's Styles card), 1 click. Each video gets it
at its own places.

| Piece | Where | Clicks |
|---|---|---|
| Open the editor | Finish step | 1 |
| Place a preset | Editor, Presets panel: click (at the playhead) or drag onto the timeline | 1 to 2 |
| Accept a suggested spot | Editor, a marker on the timeline | 1 |
| Strength, trim, keyframes | Editor, the block and its panel | 1 each |
| Beat sync | Editor, Beat card: automatic with the post's music; type a BPM and Set; or Tap 4 times and Use | 0, 2 or 5 |
| Done (export, save, return) | Studio bar | 1 |
| Save a style | Editor, Styles card: Save as a style, name, Save | 3 |
| Place a saved style | Editor, Styles card | 1 |

The video-post flow stays at **8** clicks to an exported MP4 without the
editor (the Studio's own render of the timeline). With the editor and one
preset: **+3** (Open the editor, place the preset, Done), **+4** when the
preset goes on a suggested spot (one more click moves the playhead there).
Measured in phase B: spot, preset, Strong and an Outline caption look, then
Done, is 7 clicks inside the editor.

**Track order.** Top to bottom: captions, Presets, footage, audio. A
preset moves only what is below its track, so captions stay still and
readable over a zoom or a shake.
