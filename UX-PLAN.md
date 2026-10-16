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
| **Library** | `/studio/library` | Browse everything made: tabs Stills, Clips, B-roll, Sounds, Voice lines, Hooks, Posts; filter by character and product; download; "Use in a new post"; upload B-roll, clips, sounds and voice takes | My library |
| **Settings** | `/studio/settings` | Tabs: General (mode, keys, Higgsfield billing), Models (Claude, Higgsfield), Rules, Budgets and usage, Notices | A Studio set up the way I want |
| **Guide** | `/studio/guide` | The visual manual (owner, 2026-10-13): Quick start, the big picture, every page and step with an annotated screenshot, and a glossary. In the sidebar under Settings | "How do I use this?" answered with pictures |

**Not pages** (they open as drawers inside whatever page I'm on):

- **Library drawer**: Stills, Clips, B-roll, Posts, Hooks. Pick, and it drops in.
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

## 13. Voice lines (overnight item 4, 2026-10-14)

Placed before building. Nothing new in the sidebar.

| Piece | Where it lives | Clicks |
|---|---|---|
| The character's voice | Character page, Profile: a **Voice** button next to Edit card opens the voice card (a modal): the ElevenLabs voice ID on top, then how the character talks (item 5). Imported from a "## Voice" section of the character file too | 2 to open and save |
| Upload takes | Library > **Voice lines** (a new tab beside Sounds): pick the character, "Upload takes" (several WAV files at once, one line each). The file name gives the hook and the words: `047_check-my-match-score.wav` is Hook 47, "Check my match score". The worker prepares each take free (mono WAV, length and loudness) | 2 (Upload takes, pick files) |
| Convert | Same tab: each take has a play button and a **Convert** price button (ElevenLabs speech to speech, then speech to text for word timings, one price). "Convert all N takes" converts every waiting take in one quote. The row then plays the converted line and shows what was heard | 2 per take, or 2 for all |
| Voiceover on a post | Finish step, Sound row: a **Voiceover** line under Music: None, or the character's converted lines (hook and title). Starts at (seconds), Level (Quiet, Normal, Loud), and **Captions from the voice line** (on by default). Music and ambience dip under the voice | 1 to pick |
| Captions from the voice line | Automatic: the words become short captions (a few words at a time, broken where the speaker breaks), each timed by its words, so Karaoke captions light each word as it is said. Off: the typed caption stays | 0 |
| The editor | The voice opens on its own audio track at its start, and the captions are the voice line's phrases | 0 |

A batch has no voiceover (one line cannot match fifty captions); a video
post made from a spreadsheet row can pick its own. Lip sync is not built
(plan in LATER.md).

**Clicks, voiceover on a post:** Library > Voice lines, Upload takes, pick
files (2); Convert all, Run (2); in the post's Finish step, pick the line
(1). The post then exports as before (1).

## 14. Scale kit (overnight item 5, 2026-10-14)

For thirty characters and twenty accounts. Placed before building; no new
page or sidebar item.

| Piece | Where it lives | Clicks |
|---|---|---|
| Voice card | The same **Voice** modal on the character page: who, point of view, talks like, words used, words never used, emoji, humor, content pillars, an example line. Every field optional (a default, never a lock). The caption, slide, script and hook writers read it and write in that voice | 2 to open and save |
| Hook vault, claims sheet, buyer language | Library > **Hooks** (a new tab): pick the product (SideStep is seeded from the script kit). Three parts on one page: the hook vault (numbered, grouped by type, with the 80/20 mix note), the claims sheet (what it is, what it does, price, approved phrasings, never say), and the buyer-language bank (pain, feelings, small wins). All editable inline; add a hook, a phrase or a claim in one field | 1 to open |
| Hook variants | Each hook: **Write variants** (a price button): Claude rewrites the hook once in each chosen character's voice, inside the claims sheet, using buyer language. Variants are listed under the hook with the character's name, each with Copy and "Use in a new post" | 2 |
| Use a hook | Library drawer > Hooks from the post's Text step: pick a hook or a variant and it becomes the caption | 2 |
| Tracked link or promo code | Posts home, **Accounts** card (top, collapsed by default): one row per account tag with its character, its tracked link or promo code, posts made, and signups (typed in or pasted from the link tracker) | 1 to open, 1 per edit |
| Scoreboard | The same card, sorted by signups (then signups per post), never by views. Views can be noted but do not rank | 0 |

**Clicks, a hook in a character's voice into a post:** Library > Hooks (1),
Write variants, Run (2), Use in a new post (1).

## 15. Fixes from the first real run, and Recreate from a real clip (owner, 2026-10-14)

Placed before building. No new page or sidebar item.

**The Idea step (video post).** One box by default.

| Piece | Where it lives | Clicks |
|---|---|---|
| The box | **Describe the shot or paste a prompt** (the post's idea), with the post's character named above it (Change opens More control) | 0 |
| What the Studio read | Chips under the box, read for free from your words as you type: Camera (Selfie, Mirror selfie, Friend shot...), Front or rear camera, Framing, Outfit, Makeup, Place. Each chip opens to edit (a pick list or a short field) and has an x to go back to the default. What you set wins over what was read; nothing you wrote is rewritten | 1 per chip |
| A pasted prompt | When the box holds a full prompt (long, or written like one), a switch shows: **Send my prompt as written** (on by itself for a pasted prompt, off for a short idea). As written, the stills get your text unchanged plus only the fixed blocks: the reference line, the 21+ line and the REALISM and AVOID blocks. No prompt writer, no template camera, light or outfit lines. Banned skin words are still taken out (rule zero), with a note | 1 to switch |
| Punch it up | Under the box, as before. Picking an option keeps who shoots it (a selfie stays a selfie) | 2 |
| **More control** | Collapsed by default: Character, Account, Format, Places, and the scene details moved here from the Stills step (the moment, what the character wears, camera; Plan the details; Use for other characters) | 1 to open |

**The Stills step.** The Details card becomes one summary line with
"Change in the Idea step". The Generate card starts at **Nano Banana 2.1,
4 stills, Standard quality, 9:16** (by destination), with a Standard or
High switch; the price is on the button ("Generate 4 stills · 3 credits"
on the plan, dollars on the API).

**What was sent.** Under every still, a **What was sent** link opens the
still with its run: the final prompt (hard-wrapped, one-click copy), the
sheet refs attached (thumbnails with their REF ids), the model, the path
(your Higgsfield plan or the API), quality, resolution and aspect, and the
price quoted next to the real cost. 1 click. **Failed runs too** (owner,
2026-10-15): every failed run row and every failed Recreate still has
**What was sent**, with why it failed and the provider's id, the frame and
the Higgsfield element it carried.

**Prices.** Every finished run records its real cost next to its quote: on
the plan, the credits Higgsfield actually took (read from the account's
transactions, free); on the API, what the provider reported, or the quote
when it reports nothing. A real cost more than 20% off its quote is
flagged in What was sent and in Settings > Costs ("Quote off by 35%"),
with the price book entry to fix. Plan runs show credits everywhere,
never dollars.

**Recreate from a real clip** (the clone flow in the Video step). "What to
do" has two choices: **Recreate from a real clip** and **Replace the
person (keep the scene)**. Recreate replaces "Copy the moves into a new
scene" (the same idea with the owner's proven recipe). It is the default
for a dark clip or one with a lot of motion (clubs, dark venues, real
dancing), measured free when the clip is prepared, with the reason shown
("Suggested: a dark clip with a lot of movement"); Replace stays the
default otherwise. Either can be picked.

| Step | What you see | Clicks |
|---|---|---|
| a. The frame | The clip's frame about 0.2 s in, with the person to replace (tap another) | 0 |
| b. Four stills | "Not like the person in the clip" field (hair color, eye color, piercings, makeup such as winged liner; **Read them for me** fills it, priced, Claude). **Make 4 stills** (Nano Banana 2.1, 9:16, the frame plus the character's element on the plan, or REF-00 and a three-quarter view on the API; price on the button). The prompt uses the frame only for place, light, angle, framing, pose and outfit, replaces the person completely, lists the character's face and hair, the traits she must not have, keeps the head angle and gaze, and removes caption text, the TikTok logo and the username | 2 |
| c. Pick | Pick one, or **You pick** (best face match to REF-00 that is least like the person in the clip). Then **Fix the face** (2 takes, priced): only the face changes to match the character, everything else stays pixel for pixel. Optional; recommended when the face drifts | 1 + 2 |
| d. Checks | Free on every still: face match to REF-00 and likeness to the person in the clip. A still that looks like that person cannot go on (fixed rule); face drift is a strong warning | 0 |
| e. Copy the moves | **Copy the moves** (priced): the chosen still plus the ORIGINAL clip (as uploaded; its burned-in text does not carry over). Plan: Genjutsu motion control (hf_mult_motion_control), 720p, about 7 credits a second. API: Kling 3.0 Motion Control on the Higgsfield API (the Vercel AI Gateway path was removed, G39). The motion model is the remembered pick in the same panel; it starts on whichever path has keys | 2 |
| f. Trim | Each result has **Trim** (start and end, free on the worker) before Use this clip, for a cut to a wide shot where background people melt | 1 to 3 |

**Clicks, a rave clip to a usable clone:** choose the clip (2), Make 4
stills, Run (2), pick one (1), Fix the face, Run (2, optional), Copy the
moves, Run (2), Trim (optional), Use this clip (1). About 76 credits on
the plan for a 10 s clip.

## 16. Recreate, finished: entry points, motion picker, gates, review, scale (owner, 2026-10-14)

Placed before building. No new page or sidebar item. Every priced button
shows its price and runs in one click (a second "Confirm" only above the
budget's confirm line, which plan credits never reach).

**Stills default.** A post's Stills start at **GPT Image 2.5 Flare,
Standard quality, 9:16, 4 stills** (Standard is Flare's medium quality at
2k, 1 plan credit a still). Nano Banana 2.1 stays in the model setting.
Every Flare prompt carries "bare natural lips, no gloss." The Recreate
stills and the face pass stay on Nano Banana 2.1 (what was proven).

**Entry points.** Three ways in, all landing on the same Recreate panel in
the Video step:

| Where | What | Clicks |
|---|---|---|
| Video post > Idea | A two-way choice above the box: **Describe it** (the box, as now) or **Start from a real clip** (upload a clip, or paste a direct video link or a Higgsfield media ID). Picking a clip opens Recreate | 1 + the file |
| Library > Clips | **Use this clip** on any saved clip: a new video post of the character with that clip, open at Recreate | 1 |
| A link | `/studio/recreate?clip=<Higgsfield media ID or video link>&character=<name>&model=<motion model>&cap=<credits>` makes the post, brings the clip in (free, on the worker) and opens at the first priced step | 0 |

**Step 2: what to keep and what to drop.** Two chip lists under the frame,
each chip with an x and an add field: **Scene to keep** (place, light,
angle, framing, pose, outfit; read from the frame) and **Source traits to
drop** (hair color, eye color, piercings, makeup such as winged liner).
**Read them for me** (Claude, priced) fills both and writes one line of
what happens in the clip for the motion prompt. **Outfit**: Keep the
clip's outfit (default) or Pick hers (one of her stills, or type it).

**Step 3: stills and the face pass (owner, round 17).** One priced button,
**Make 4 stills + face pass**: the 4 stills, then the face pass (2 takes)
on the best one (You pick's choice), both in the one price shown before
the click. A switch beside it, **Face pass on the best still** (on by
default; both proven hand runs needed it), skips it: the button then reads
**Make 4 stills** at the lower price. Each still and face pass shows its
face match to REF-00, its likeness to the person in the clip, and the
margin between them. **Fix this face** on any other still (price on it)
still runs a face pass on that one. **You pick** chooses for you.

**Stills model (owner, round 18).** Two choices above the button, each
with its path: **Nano Banana 2.1** (your plan; what the proven runs used)
and **GPT Image 2.5** (the Higgsfield API; untested for recreates). Same
prompts, same face pass, same gates either way; the face pass runs on the
model the stills used. Nano Banana 2.1 is picked when the plan is
connected, GPT Image 2.5 when it is not (the API does not offer Nano Banana
2.1); a choice with no plan or no key is grey with one line why. Your last
pick is remembered. With GPT Image 2.5 the button says so: **Make 4 stills
+ face pass (GPT Image 2.5, untested for recreates)**.

**Step 4: the gates (fixed, owner 2026-10-14; margin added in round 17).**
Before any video spend the chosen still must pass three free checks: the
face matches REF-00 at 0.45 or more; the face match beats the likeness to
the person in the clip by a clear margin, 0.12 or more; and the likeness
stays under 0.45. Calibrated on the two proven stills (kitchen: face 0.71,
likeness 0.26, margin 0.45; rave: 0.54, 0.37, 0.17) and the rave still
before its face pass, which must fail (0.45, 0.57, margin -0.11).
Otherwise the video button is replaced by why ("Face match 0.40, needs
0.45"; "Beats the clip's person by 0.05, needs 0.12") and the way on:
**Fix the face again** or **Make new stills** (each priced). Nothing
spends on its own.

**Step 5: the motion model.** A list of choices, each with its price for
this clip and its billing path (Your Higgsfield plan, credits; or the
Higgsfield API, dollars): **Genjutsu**, **Wan 3.0**, **Wan 3.0 Prime**,
**Kling 3.0 Motion Control**. A model with no working plan or key is grey
with one line ("Needs your Higgsfield API key or plan: Settings >
Connected accounts"). The last one used is pre-selected. Every model on
both paths gets the same inputs: the chosen still as the image reference,
the cleaned clip (end card off, burned-in text filled, no sound) as the
video reference, 720p, 9:16, audio off, the preset suggestion declined,
and the motion prompt template plus "Her outfit stays exactly as in
@Image1 for the whole clip, same cut, length and fit." **Make the video**
(price on it).

**Step 6: review.** The result next to the source clip, playing in sync
(one play button, one scrubber). Under them a strip: the face match to
REF-00 every 0.5 s, with drift marked in red; text found on the frames
(logos, @handles, captions) with times; cuts in the clip, each with **Trim
at the cut**. Plus Trim (start and end). **Use this take** keeps it, puts
it in the post and opens the Text step. Export has no music unless one is
added.

**Scale.** On a finished take: **Recreate with another character** (the
same clip and chips, new stills for the other character). **Batch** (the
batch post's Video step): up to 20 rows, each a clip and a character with
its own motion model picker, plus **Set all**; each row shows its price
and the batch shows the total. Rows run step by step together (stills,
with the face pass, then the video); a row whose gates fail waits for you
with the same way on, and the others carry on.

**Recreate prompt words (owner, 2026-10-15).** The first real Recreate was
blocked by the provider's filter (all 4 stills) while the hand runs passed:
word stacking next to a real person's photo. Recreate stills and the face
pass now send the character's **face and hair only** (never age, body,
build or style words; her body is in the element and the sheet), **no age
line** (21 or older is checked before the run), a **plain outfit** ("Dark
green dress, same as in the photo."; Claude's words lose sleeve and fit
details, the owner's typed words go as typed), and the **short realism
line** "REALISM: Natural skin texture, not retouched." with no AVOID block.

**Gate check (owner, round 18).** After every 10 real recreates (a video
made from a still on a real model, not the demo), Settings > Rules shows a
**Recreate gate check** card, and the Recreate panel a one-line notice
linking to it. The card lists the face match and the margin of the stills
you made the videos from next to the stills you passed over, the gate
numbers now, and suggested numbers (just under the lowest picked face and
margin, just over the highest picked likeness, never below the standard
0.363 face match), with what each would have held. **Use these numbers**
applies them to your account; **Keep the current numbers** closes it until
the next 10. Nothing changes without your click.

**Spend cap.** A post can carry a credit cap (the link's `cap`, or set in
Recreate). A step that would pass it is refused before any spend, with
what it would cost and what is left.

**Clicks, link to finished video:** open the link (0), Make 4 stills +
face pass (1), Make the video (1), Use this take (1): **3**. From
Library > Clips: Use this clip, then the same: **4**. From the Idea step:
the choice and the file, then the same: **5**.

## 17. Editor fixes from the QA audit (owner, 2026-10-15)

The owner's audit: the editor passed its tests but failed in real use
(captions could not be selected or edited once added). Driven like a user
(Playwright: click, drag, double-click, type; desktop and phone), the
broken pieces are fixed in the fork and each has a Playwright test
(`e2e/editor/`). No new page, panel or button; these are how the existing
ones behave now.

| Piece | Where | How it works now | Clicks |
|---|---|---|---|
| Select a caption | The preview | Click the words. The box sits on the caption as drawn (wrapped lines), with the handles | 1 |
| Edit a caption | The preview, or its block on the timeline | Double-click (double-tap on a phone): a box over the caption with the words selected. Enter saves, Shift+Enter starts a new line, Esc cancels, clicking away saves. One undo step | 2 plus typing |
| Move a caption | The preview | Drag the box (not only the small center handle). One drag is one undo step | 1 drag |
| Resize a caption | The preview | Drag a handle; the handles sit just outside the caption, so a small caption can still be dragged by its box. The handle stays under the cursor; past the frame's width the words wrap instead. One drag is one undo step | 1 drag |
| Retime a caption | The timeline | Drag its block to show it later or sooner, or its end to show it for less time | 1 drag |
| Long captions | Preview and export | Wrap inside the frame (90% of its width), the same lines in both | 0 |
| Karaoke | Presets, Text, "Karaoke captions" | The caption's own words light up in turn, timed across the caption (the Studio's yellow; on a white box the word's box lights up). It keeps its place, look and text, and stays editable. Apply it again to turn it off | 1 |
| Reorder shots | The timeline | Drag a shot onto another on the same track: it goes in front of the shot it lands on and the shots close up. One undo puts them back | 1 drag |
| Open a post with music | Finish, Open the editor | Uploaded music (M4A) opens. A file that does not load is named in the bar ("Opened without: ...") and the rest of the post opens. Music and other sound end where the post ends | 0 |
| Ducking | Opens with the post | The music is ducked under the voice line (or under the clip's own sound when there is no voice). The music clip's Audio Ducking panel shows "Ducking Applied" and can change or remove it | 0 |
| First frame | Opening the editor | The preview shows the first frame without pressing Play | 0 |
| Phone | The editor at phone width | The editor fits under the Studio bar, so the bottom tabs are on screen: Timeline, Media (the Presets panel), Edit (the inspector for what is selected), AI. A finger drags a caption or its handles | 1 per tab |
| Ends with the last shot | The timeline and the export | A caption or music that ended with the last shot keeps ending with it when the shots change length (speed, trim, delete), so the export stops with the video instead of running on over black. One retimed to end elsewhere stays put. Undoing the shot's change brings it back too | 0 |

Editing a caption went from select the block, find the Text section in the
inspector and type (4 or more clicks, most of them hunting) to
double-click, type, Enter. The usability notes from the audit (a small
preview, handles that cover a small caption, no click-away deselect in the
preview, the voice track named "Track 2", and others) are in the audit
report for the owner to pick; none is built yet. A second pass (the
owner's full matrix) added the resize, undo, phone and last-shot rows and a
render check for each feature.

## 18. Recreate: no paid take is rejected; the face pass edits the still (owner, 2026-10-15)

From the first real Recreate (kitchen clip, Callie, Wan 3.0): the pipeline
worked, the gates did not. The take was clearly Callie (the face strip green
the whole clip) but marked "Not kept" (likeness 0.39 against an old 0.36
cap), and both face pass results were plain studio portraits that ignored
the kitchen still. Only the still gate blocks spend; everything after it is
the owner's call. No new page, step or panel.

| Piece | Where | How it works | Clicks |
|---|---|---|---|
| The video rule | Step 6, every take | The still rule's numbers: face 0.45 or more against REF-00, beating the clip's person by 0.12 or more, likeness under 0.45. Read over the whole take from the face every half second: the middle face match, the middle margin, the highest likeness (she copies the clip's expressions, so a take reads a little higher than a still) | 0 |
| A take that passes | Step 6 | Kept: the scores in one line, then Use this take | 1 |
| A take that misses | Step 6 | Never rejected. A warning with the scores and what missed, and two buttons: **Keep this take** (then Use this take) and **Try again** (back to Make the video, priced as before; nothing is spent by the button) | 1 |
| Takes the old check rejected | Step 6 | Shown again with their scores and Keep this take (today's kitchen take) | 1 |
| Text found | Step 6, "Text found on the take" | Each hit with a thumbnail of its frame, the words boxed, so a false reading ("Vij") is told from real leftover text. Takes reviewed before this get their thumbnails on the next look (a free review on the worker) | 0 |
| Face pass | Step 4, after Make 4 stills | Edits the chosen still: the still is the first image, the element and REF-00 are face references only, and the prompt starts "Edit the first image." | 0 |
| Face pass check | Step 4 | Outside the face, the result must match its still (the place, the outfit, the pose, the framing). If not: "Face pass changed the scene, not usable", and no Make the video from it. Face passes made before this check say so and are not offered for the video | 0 |
| Skip the face pass | Step 4 | When the best still already beats the clip's person by 0.30 or more, the face pass is skipped and its part of the price is not charged. The price line says so | 0 |
| Gate check | Settings > Rules, Recreate gate check | Video takes get their own numbers: after every 10 real takes, the scores of the takes you kept next to the ones you tried again on, with suggested video numbers. Suggest only; you approve. The still numbers stay as they are | 1 |

**Clicks, link to finished video (unchanged when the take passes):** open
the link (0), Make 4 stills + face pass (1), Make the video (1), Use this
take (1): **3**. When the take misses the rule: **+1** (Keep this take).

## 19. Usability fixes from the editor audit (owner, 2026-10-15)

The owner picked these from the audit's usability notes. No new page or
step; the stills grid, the run rows, the Recreate review and the editor
behave differently.

| Piece | Where | How it works | Clicks |
|---|---|---|---|
| Earlier failures, one gray line | The Recreate stills grid | Failed and not-run stills from earlier runs leave the grid and become one gray line under it, counted by reason: "4 blocked by the filter, refunded; 2 face passes not run. Nothing charged." **Show** opens them (with What was sent); **Clear** removes the line for good on this post (the records stay, in Activity). Only the run you just started (the newest one, while it is fresh) shows its failures red | 0 (1 to Show, 1 to Clear) |
| The same in the run rows | Every step's run rows | Failures other than the run you just started fold into one gray line with the same counts, **Show** and **Clear** (Clear is remembered in this browser). Under the stills button the run rows leave them out, since the grid already folds them | 0 |
| Face strip | Recreate review | Drift is marked under the video rule's face number (0.45, or the number you approved in the gate check), so the strip and the rule agree. The legend says "face under 0.45" | 0 |
| Caption handles | Editor preview | Small round handles just outside the caption (the hit area stays finger-sized); the Locked button is gone for text, and a caption always grows in proportion | 1 drag |
| Caption size | Editor preview | A caption cannot be made taller than the frame: the handle stops there | 0 |
| Freeze and speed ramp | Editor timeline, the Presets track | Each one placed on a shot gets a small marker on the Presets track at its time ("Freeze", "Speed ramp"). Clicking it selects the shot and opens its Speed panel (on a phone, the Edit tab) | 1 |
| Bigger preview | Editor | The timeline starts shorter, so the frame is about twice as tall on a laptop; the timeline's edge still drags | 0 |
| Click away to deselect | Editor preview | A click on the empty space around the frame (or on the frame where nothing is) clears the selection | 1 |
| Named tracks | Editor timeline | The Studio names the tracks it lays out: Shots, B-roll, Voice, Music, Ambience, Captions, Presets | 0 |
| Speed on the clip | Editor timeline | A shot that is not at normal speed shows its speed on the block ("2x", "0.5x", "Ramp") | 0 |

## 20. Catalog wording in every prompt (owner, 2026-10-15)

Outfits are said the way a shop catalog says them, and nothing in a prompt
describes her body or makes her pose. It applies to every prompt the Studio
writes: scene stills (template and the Claude writer), Recreate stills, the
face pass and the video prompts. The wording changes; what she wears never
does. No new page or step; the warnings and the refusal help appear where
prices and failures already show.

| Piece | Where | How it works | Clicks |
|---|---|---|---|
| Catalog outfit | Every outfit line the Studio writes (the planner, the writer, the outfit read from a clip) | Garment type, color and fabric, plus a style word when it is clear: "dark green ribbed tank top with thin straps, going-out look". Garment names stay (tank, cami, halter, slip dress, bodysuit). A bare "top" is never sent: the read asks for the garment | 0 |
| No fit or body words | Every prompt | Never sent: fitted, tight, low-cut, sheer, toned, curvy, hips, waist, legs (and their close cousins: skin-tight, form-fitting, plunging, see-through, figure-hugging). The refs carry her build | 0 |
| Underwear-sounding names | Every prompt | Only "boy shorts" is swapped, to "bike shorts" (section 21: "sports bra" and every other garment name stay). The list is data (`config/wording.yaml`) | 0 |
| A moment, not a pose | The writer, the planner, the templates | What she is doing ("refilling her water bottle"), never "posing in". The proven Recreate, scene-still and face-pass templates keep "the pose" (reverted, section 21) | 0 |
| Your words stay yours | Anything you type (idea, outfit, a pasted prompt) | Sent as typed. When a word is likely to be blocked, the price shows a warning under it: "May be blocked by the provider's filter: tight, low-cut. Your words go as typed." | 0 |
| A refusal | The failed run's row, the failed still's tile | "Likely trigger words: tight, boy shorts" (read from what was sent), and **Retry with safer wording**: the same request with only those words reworded by code (no Claude call, the rewording is free), priced like the run that was blocked and refunded. What was sent shows both | 1 |

Both behaviors are defaults in Settings > Rules: "Outfits in catalog terms,
no fit or body words" (`prompt-catalog-wording`, the cleaning of Claude's
words) and "May be blocked by the provider's filter" (`wording-risky`, the
warning under the price). The Recreate outfit box has one help line under
it, and every refusal links to the Guide's section on failed runs.

## 21. No caption, the editor opens with the take, Studio media first (owner, 2026-10-15)

Three fixes to the Text step and the editor, an optional caption
everywhere, a pulsing run row, image uploads, and two reverts. No new page
or step.

| Piece | Where | How it works | Clicks |
|---|---|---|---|
| No caption | The Text step of every video post (Recreate included) and every batch, next to White box and Outline | A third choice, **No caption**. It is kept with the post: the editor opens with no caption track, and neither the editor's Done nor Export MP4 puts a caption on the video. The words you typed are kept, dimmed, and come back when you pick White box or Outline again. A post exported before the switch keeps its old video until you export again (a line says so) | 1 |
| The editor opens with the take | Open the editor, from every path: a Recreate post after Use this take, a finished post, a post made from Library > Use in a new post, and Make another like this | The take or clip the post uses lands on the Shots track, trimmed as reviewed (the trimmed take, or the post's in and out), with its caption when one is on. On the live site the take was missing and the caption was there: the post page had just played the take, the browser kept that copy (without the permission the editor needs), and the editor got the kept copy and was refused. Each file now comes from a fresh storage link, never from the browser's kept copy, and if storage refuses, from the Studio itself in small parts. A file that still cannot load is named in the bar | 0 |
| Add media, Studio first | The editor's Media tab: Add media and Import media | Opens the Studio picker beside the timeline. **Studio** (first): this post's takes and stills, this character's clips and stills, then the Library (B-roll, sounds, other characters' clips). **From computer** is the second tab (your files, as before). One tap adds the item at the playhead; drag it onto a track to put it exactly there. Items added this way open again with the post | 1 (tap) |
| A caption is never required | Every output: a video post, a Recreate, a batch, a slideshow, a spreadsheet import | The caption (and a slideshow's words) is optional everywhere. An empty caption means a video with no caption; text can be added in the editor instead. The Words field is marked optional, the Finish step no longer asks for it, and Export never refuses for it. A batch with no lines makes How many videos; a slideshow with no words exports the stills as they are | 0 |
| A run that is working pulses | Every live run row, anywhere an image, a video, a render or a Claude run is going ("Video take: Generating · 47 s") | The row pulses in the accent color until the run ends, so it is obvious at a glance that it is working. Done turns it green, a failure turns it red; with reduced motion on, it holds a steady accent border instead | 0 |
| Upload images | The slideshow's Stills step (beside Pick from Library) and Library > Stills | **Upload**: several files at once, drag and drop on a computer, the camera roll on a phone (the file picker offers it). You pick the character they belong to (the post's character is picked for you in a slideshow). Each image is kept exactly as uploaded: the same file, full resolution, never downscaled, recompressed or converted (a thumbnail is made only for the grid). Uploads show in Library > Stills, in the slideshow's picker, and in the editor's Studio picker | 1 to 2 |

Two reverts (owner, 2026-10-15):

- **"Sports bra" stays "sports bra".** It is a normal catalog garment.
  Only "boy shorts" (and "boyshorts") is swapped, to "bike shorts". The
  garment itself is never changed.
- **"The pose" is back** in the Recreate stills, the scene still and the
  face pass prompts, word for word as proven. They change only when a
  real run shows a reason.

## 22. Storage, traffic and auto-clean (owner, 2026-10-15)

Goal: Vercel moves only JSON; media always goes between the browser and R2
directly; junk clears itself. One new Library tab (Trash), one Settings
card grows (General > Storage), and a star on takes. No new page or step.

| Piece | Where | How it works | Clicks |
|---|---|---|---|
| Images from R2 | Every image in the Studio, full size and thumbnails | Served the way videos are: the Studio answers with a redirect to a short-lived R2 link, never the image bytes. A thumbnail is made once (the first time a size is asked for) and kept in R2 next to the original. Grids ask for thumbnails, full size only where you look closely (the still drawer, crop). A 2K still over 4.5 MB loads like any other | 0 |
| Old proxies removed | `/api/hf`, `/api/hfproxy` and `/api/img-proxy` | They came from the old ai-influencer app and proxied Higgsfield and images through Vercel. Nothing in the Studio uses them, so they are deleted. The old app at the site's root loses Higgsfield connect, generation and image downloads; the Studio at /studio is unchanged | 0 |
| Worker temp sweep | The worker, on startup | Temp folders left by a crash are deleted when the worker starts. The worker reports its free disk, shown in Settings > General > Storage, in `/api/v1/worker` and in the worker's `/health` | 0 |
| Upload slots cleaned | R2 `uploads/` | An upload that was never used (a closed tab, a failed form) is deleted after 1 day by the daily clean (and by an R2 lifecycle rule when the key may set one) | 0 |
| Storage readout | Settings > General > Storage | This Studio's files in R2 (GB and file count, as of the last daily clean, with Measure now) and the estimated monthly cost at $0.015 per GB-month after the first 10 GB, which are free (R2's free tier is per Cloudflare account) | 0 to 1 |
| Delete | Library: Stills, Clips (kept takes, uploads, clones), B-roll, Sounds, Posts (renders) | A trash icon on each item, and **Select** to pick many (a checkbox on each tile, Select all, then Delete). Before it moves, a short warning names what it touches: "Used in 2 posts" (with their names) or "REF-03 of Callie's sheet". Delete moves to Trash; nothing is gone yet | 1 to 2 |
| Trash | Library > Trash | Everything deleted in the last 7 days, newest first, with how long until it goes for good ("removed for good in 5 days"), who or what put it there (you, or Auto-clean), and **Restore** (one or many). After 7 days the daily clean removes the files from R2 for good, thumbnails and plain copies included; a file another item still uses is kept | 1 |
| Auto-clean | Settings > General > Storage | Only two kinds of item ever move: takes never kept and stills never picked, from posts finished N days ago (14 by default; 3, 7, 14, 30 days, or Off). Never, whatever their age: sheet refs (REF-00 to REF-11), heroes and anything in a character file (or sharing one of their files); a take kept with Keep this take or Use this take (kept counts as starred), and anything starred; anything any post uses (live, posted, exported or archived, its render and its saved editor timeline); the stills, start and end frames a kept take was made from; saved clips and images in the Library (uploads, kept clips, kept clones). A scene that another unfinished post uses is left alone, and if a saved timeline cannot be read nothing moves | 0 to 1 |
| Next auto-clean and Preview | Settings > General > Storage, under Auto-clean | "Next auto-clean: N items" and **Preview**: a drawer listing each item (its picture, take or still, the post it came from and when that post was finished), with a star on each to keep it. The first Auto-clean waits until you press **Start Auto-clean** in the preview; after that it runs with the daily clean. Nothing is gone for good until 7 days in the Trash | 1 to 2 |
| Star a take | Every take card (Video step, Recreate review) | A star toggles; starred takes stay out of Auto-clean | 1 |

The daily clean runs on the worker once a day (when the Studio is opened
after a day, it wakes the worker for it): upload slots older than a day,
Trash older than 7 days, Auto-clean, and the storage measure. Every piece
is a default in the sense of rule one: the 7 days of Trash and the
Auto-clean days are shown and editable (Auto-clean can be Off); nothing
is deleted for good without 7 days in Trash first.

## 23. Hair rotation, makeup by setting, the rest of catalog wording (owner, 2026-10-15, long run part 2)

From character template v1.6 (`docs/character-template.md`, Scene rules).
Catalog wording itself is section 20; this adds the two scene defaults the
template asks for and closes two gaps in the never-send list. No new page
or step: both show as filled fields in the scene form, editable as before.

| Piece | Where | How it works | Clicks |
|---|---|---|---|
| Hair styling, rotated | The scene form's Hair styling field (Stills step, More control) | Each new scene starts with the next styling from the template's bank (behind both shoulders; tucked behind one ear; blowing back off the face; half-up claw clip; low loose ponytail; high sleek ponytail; messy top bun; sunglasses as a headband; damp and air-dried; other part), never one used in the character's last 5 combo entries or last 5 scenes. Color and texture stay the character's (identity); only the placement rotates. Your own words win: a styling you type, or one the owner set, is kept | 0 |
| Combo log with hair | Library > Stills, Combo log; the character file | Each logged scene now records its hair styling as a fifth column, so the rotation can read it back after a re-import | 0 |
| Makeup by setting | The scene form's Makeup field | Out in public: soft everyday makeup (light coverage that still shows skin texture, groomed brows, mascara, warm bronzer, matte nude lip, no gloss, the same lip shape, nose and jaw as the references). At home, the gym, an early beach or waking up: no makeup. Soft glam stays for the nights out and events the character file names. A character's own everyday makeup line replaces the default wording. For men: groomed brows and beard, no makeup words. A makeup word in your idea, or a choice you made, wins | 0 |
| Never-send list | Every prompt the Studio writes (section 20) | Adds "busty" (and buxom, voluptuous) and cup sizes ("D cup", "36DD") to the words that are never sent, and warns under the price when you typed one. The full-body sheet refs keep their one catalog-fit build line (template Step 4, [BUILD]); hero and sheet prompts are not scene prompts | 0 |

Both scene behaviors are defaults in Settings > Rules: "Rotate hair styling
per scene" (`hair-rotation`) and "Makeup by setting" (`makeup-by-setting`),
each switchable for all characters or one.

## 24. Character files from the Claude project (owner, 2026-10-15, long run part 3)

Character template v1.6 (`docs/character-template.md`, Part B) is how the
owner builds a character in the Claude project. Its file comes into the
Studio as is; the brand layer it carries shows on the character page and
feeds the writers. No new page: the Characters page, its Import dialog and
the character page's File step.

| Piece | Where | How it works | Clicks |
|---|---|---|---|
| Import first | Characters page header and empty state | "Import a character file" is the first, primary button; "Start from a concept" (inspiration, concepts, hero, sheet) is the second. Both always there | 1 |
| The 12 REF images | Import dialog | Drop the .md and the sheet folder (or choose a folder): images named REF-00 to REF-11 (REF 00 works) become the approved sheet, as before; the dialog lists which of the 12 are in and which are not | 0 |
| Template check | Import dialog, right after the file is chosen (free, no Claude) | Checked against template v1.6: every UNIVERSAL section (Realism principle, Models, Scene rules, Video rules, Recipe: candid, Recipe: recreate), one distinguishing mark, REF-00 to REF-11 each labeled in the Reference sheet, and the Element ID when the file names an Element. Each shows as a green tick or "Missing" with what to add. Optional sections that are missing (Brand, Why people watch, Accounts, Winning stack, Growth log and the rest) show in one gray line, and sections still holding [brackets] are named. Nothing blocks: with a needed item missing the button reads "Import anyway" | 0 |
| Update, not a copy | Import dialog, when a character of that name exists | "Update Callie (keeps her posts, takes and sheet)" is chosen by default; "Import as a new character" is the other choice | 0 or 1 |
| Re-import keeps everything | Same, and the File step's Import edits | The file's words replace the character's words; posts, takes, stills, clips and the sheet stay. The combo log is merged (the Studio's entries are kept), a saved identity stays when the file has none, and a sheet image identical to the approved one is skipped, so nothing goes stale | 0 |
| Brand card | Character page > File step, first card | The brand layer, editable in place and written back into the file's own sections: brand statement (with interest, sub-interest and arc), series, running bits, cast, accounts, winning stack, growth log (newest first, Add this month's entry). Saves as you leave a field; the previous version is in history | 1 per field |
| Template check on the character | Character page > File step | The same check over the character's current file, so a character imported before v1.6 shows what to add | 0 |
| Winning stack in every post | Prompt writer and planner (Write and generate, Plan the details) | The winning stack goes with the facts: every post carries it for 30 days, inside the fixed rules. Default rule `brand-winning-stack` | 0 |
| Brand check | Punch it up's three moments | Each moment is checked against the brand statement; one that does not fit says so in a small "Off brand" note with the reason. Advice only. Default rule `brand-check` | 0 |

## 25. Editor polish: hook variants, safe zones, cover, export presets (owner, 2026-10-15, long run part 4)

All four live in the post workspace's Finish step and the editor. No new
page. Everything here is free: it runs on the worker or in the browser.

| Piece | Where | How it works | Clicks |
|---|---|---|---|
| Export for | Finish step, above Export (video posts and batches) | Chips: TikTok, Reels, Shorts. Each is a preset with a length cap, a video bitrate cap and the loudness the sound ends at, shown on the chip ("up to 180 s, 12 Mbps, -14 LUFS"). It applies to Export, to the editor's Done and to hook variants. The post remembers it; TikTok is the default. The numbers are data (`config/content.yaml`) and starting points | 1 |
| Hook variants | Finish step > Hook variants card (video posts) | Up to 3 versions (A, B, C), each changing only the first 2 seconds: a hook line (typed, or picked from the character's saved hooks) over 0 to 2 s in place of a caption there; under it, First shot (a select: Same as the video, or this post's takes and stills, the character's clips and stills, Library B-roll) and First edit (a select: None, or a camera preset). Any one is enough. Export N versions renders the post's timeline once per version on the worker; the rest of the video is the same. Each version plays and downloads, with what it changed under it | 1 plus typing, or 2 (a select) |
| Safe zones | Editor top bar: Safe zones (Off, TikTok, Reels) | The app's top bar, buttons and caption area drawn over the preview in red, with names. Preview only, never exported. Remembered in this browser | 1 |
| Cover | Finish step > Cover card, once the video is exported | Scrub the video to a frame, type cover text (optional), Make the cover: a 1080 x 1920 JPEG of that frame with the text in the caption look. Download it for the app's cover upload | 2 |

## 26. Name the garment: a warning on the Recreate price (owner, 2026-10-16)

The clip reader is asked to name the garment, but nothing checked it: an
answer like "black top" went into the still prompt as it was, and a bare
"top" gets drawn as a plain tee. Now the Studio checks the outfit the clip
reader wrote, for free, against a list of garment types (`garments` in
`config/wording.yaml`: tank top, t-shirt, cami, halter top, slip dress,
bodysuit, jeans and the rest). Never the outfit you typed. No new page or
step.

| Piece | Where | How it works | Clicks |
|---|---|---|---|
| The warning | Recreate, under the stills price ("Make 4 new stills"), when the outfit came from the clip reader and names no garment type | "No garment type in "black top": name the garment: tank top, t-shirt...". The run is not blocked; the outfit goes as it is if you go ahead | 0 |
| The fix | Next to the warning | **Read the outfit again**, a small price button (one Claude call, its price on the button like every run): the reader looks at the frame again for the outfit only, with its last answer, and must name the garment. The new outfit fills the Outfit box; the chips, the traits and the motion line stay. The warning clears when the new outfit names a garment | 1 |
| Your words | The Outfit box | Typing in the box makes the outfit yours: no warning, and the reread never replaces it | 0 |

A default rule in Settings > Rules: "Name the garment in the clip's outfit"
(`outfit-garment`), on to start, off for one character or all.

## 27. Slideshow power-up: hook first, one camera roll, text styles, variations, batch (owner, 2026-10-16)

Goal: from a hook to a finished slideshow in minutes, at volume. Everything
is built inside the slideshow's own four steps (Idea, Stills, Slides,
Finish). No new page, no new step.

**What the slideshow did before this (the audit):**

| Step | Before |
|---|---|
| Idea | One box, "What is the slideshow about?", and More control (character, account). No hooks |
| Stills | Pick from the Library (several at once), Upload images, or Write and generate stills of the post's one scene (the video post's machinery: 1 to 4 stills of one moment, Add to the slideshow); reorder with arrows; up to 10. No per-slide shots, no reroll of one slide, no topic stills, 9:16 only |
| Slides | Write the slides (Claude, priced): a hook, 5 to 7 slides, a caption and 3 to 6 hashtags, all editable; a preview strip in TikTok's white box |
| Finish | Export images (free): 1080 x 1920 JPEGs with the words in the white box, a zip with caption.txt, each slide downloadable. No Instagram size, no JSON, no variations, no batch |

Kept as they were: Pick from the Library, Upload images, the arrows, the
free export on the worker, Make another like this, captions optional.

**What it does now:**

| Piece | Where | How it works | Clicks |
|---|---|---|---|
| Hook box | Idea step, at the top (slideshows) | One line, the hook (slide 1). Typing your own works; nothing is required | 0 |
| Write 10 hooks | Under the hook box | Two buttons. **10 from the vault** (free, code only): hooks from the product's hook vault and buyer language, recast into the patterns below. **Write 10 with Claude** (priced on the button, the model named): the vault, the buyer language and the character's voice card go in; 10 come back. Each hook carries its pattern tag: someone doubts or reacts, POV, things nobody tells you, red flags, listicle, storytime, myth vs fact, tier list. Pattern chips filter the list. The product is the account's first kit unless another is picked | 1 |
| Draft every slide | Each hook in the list: **Use this hook** (priced, Claude) | The hook becomes slide 1 and every slide is drafted (6 by default, 4 to 10 in Slides): hook, setup, the reveal on slide 3 or 4, the payoff, a soft CTA last. 4 to 12 words a slide. Each slide also gets the shot its photo shows (inside the locked scene) and, where it helps, a special slide (below). The caption and hashtags come with it. All editable | 1 |
| Who is in the photos | Idea step, under the hook | **The character** (refs or the Element, the REALISM block, the outfit locked across the slides) or **No one, a topic** (feeder accounts: offices, skylines, commutes, desk setups, interview lobbies). Topic photos have no person and no face check; the REALISM block is still in every prompt | 1 |
| One camera roll (the locked scene) | Stills step, top card | One scene for the whole slideshow so the set reads like one camera roll: place, light, phone camera, outfit (character only) and 2 details. Every slide's prompt carries the same lines; only the shot changes. Filled from the draft, editable | 0 |
| Made for | Stills step, beside the scene | **TikTok 9:16** (default) or **Instagram 3:4**: the shape the stills are made in. The export makes both sizes either way (the other by a center crop) | 1 |
| Generate the set | Stills step | One price for every slide that has no picture yet (model and billing path on the button: Nano Banana 2.1 on the Higgsfield plan, GPT Image 2.5 Flare on the Higgsfield API; whichever is connected, the last pick kept). Each still lands in its slide, with the free face and skin checks in character mode | 1 |
| Reroll one slide | Each slide card | **Reroll** (priced, one still): a new picture for that slide only, the rest of the set untouched. **Library** and **Upload** put your own picture in that slide; the old multi-pick and upload still add to the end | 1 |
| Scene library | Stills step, the scene card: **Save this scene** and the chips above it | A saved scene is the place, light, camera and 2 details, for one character or one topic, with the set's first picture as its look. Pick it in any slideshow and the same room looks the same every time: the words go in every prompt, and in a topic slideshow its picture also goes with each still as a "same place" reference (a character's stills attach the sheet only, so the face holds) | 1 |
| Text styles | Slides step, top | **Classic** (default): bold white, a black outline at 15% of the font size, the size scaled to the word count (5 to 7.5% of the image width), centered about 28% from the top, 4 to 6 words a line, nothing in the top 10% or the bottom 20%. **Text box** (TikTok's white box), **Minimal** (smaller, plain white with a soft shadow) and **Note** (a notes-app card). The safe-zone overlay is on in the preview; drag the words to move them (kept per slide, inside the safe area). The style and positions are burned into the exported JPEGs exactly as previewed | 1 to 2 |
| Special slides | Any slide card: **Make it a special slide** | Drawn by code, free: a phone notification, a text thread, a rejection email, a job posting. Clean, generic, no real brand names or logos (a name that looks like a real brand is replaced). The draft can suggest one; every field is editable | 1 |
| Caption and tags | Slides step, under the slides | A first-person story caption in the account's voice (from the draft, or **Rewrite the caption**, priced), at most 5 hashtags. **CTA slide**: Follow for part 2, Save this, Follow @handle (you type the handle), Comment a word, More on my page, or your own words; it sets the last slide. **#ad**: puts "Ad" on slide 1 and #ad first in the caption | 1 to 2 |
| Export | Finish step | **Export images** (free, on the worker): numbered JPEGs at 1080 x 1920 (TikTok) and 1080 x 1440 (Instagram), caption.txt, and post.json (every field of the post, mapped in one module, `server/core/postExport.ts`, so the posting engine can read it later), all in one zip | 1 |
| Make variations | Finish step | Pick how many (1 to 5) and one priced button makes them: new hook wording, a new image set, the list reordered (listicles and tier lists), a new caption. Each is a new slideshow in the same family (`variation_of`), listed under the button. A picture or an exact caption is never reused across accounts: the export warns when one is, with Reroll as the fix | 2 |
| Batch | Idea step: **Batch from hooks** | Paste up to 10 hooks (one a line), **Make 10** (one price: each drafted and its set generated). One review screen in the same post: each slideshow's slides in a strip with **Approve** (exports it, free), **Reroll** (a new set, priced) and **Reject** (archived) | 2, then 1 a slideshow |

Every paid step shows its price and model and waits for the click: the
hook writer, Use this hook, Generate the set, Reroll, Rewrite the caption,
Make variations and Make 10. Everything else (the vault hooks, special
slides, text styles, export) is free and says so. Each works on the
Higgsfield API as well as the plan.

A default in Settings > Rules (rule one): "Never reuse a picture or caption
across accounts" (`slideshow-no-reuse`, a warning on the export with
Reroll or Rewrite the caption as the fix). At most 5 hashtags is a setting
(`config/content.yaml`, slideshow hashtags). The REALISM block, banned
words, no nudity and the price before every run stay fixed.

Built details: a run's stills read as one line in the run list ("Slideshow
still: 3 of 5 done"); a still released because its slide became a special
slide reads "not needed", never as a failure, and is not charged.

## 28. Slideshow power-up 2: launch ready (owner, 2026-10-16)

Goal: the 140-post launch plan (starting Monday, October 19) goes from its
CSV to finished posts in the flows that exist, and new hooks are written
the playbook way. No new page, no new step. The spec is four files in
`docs/content/`: `viral-writing-playbook.md` (the method),
`post-writer-brief.md` (the procedure), `sidestep-script-kit.md` (the
claims sheet, which wins over everything) and `launch-plan-v2-posts.csv`
(the plan: 140 rows, 30 columns, six accounts).

**What the Studio did before this (the audit):**

| Piece | Before |
|---|---|
| Write 10 with Claude | One Claude call; each hook tagged with one of 8 patterns (doubt, POV, nobody tells, red flags, listicle, storytime, myth vs fact, tier list). No moment, effect, alt hook or score; no reviewer; nothing per account |
| Use this hook | Every slide drafted: hook, setup, the reveal on slide 3 or 4, payoff, soft CTA; 4 to 12 words a slide |
| Language checks | Only the long-dash clean-up in the writers' output. Nothing on what the owner types |
| Spreadsheet import | Inside a batch only: one video post per row (character, account, clip or "still:", video, caption, style). No slideshows, no photos, no plan columns, one character's batch at a time, at most a batch's size |
| Alt hook | None |
| Special slides | Four, drawn by code: phone notification, text thread, rejection email, job posting |
| Accounts | Posts home > Accounts: tag, character, product, tracked link or code, signups. No structures |
| post.json | Slideshows only; no plan fields |
| #ad | "Ad" on slide 1 and "#ad" first in the caption |

Kept as they were: 10 from the vault (free), the four special slides, the
batch's own spreadsheet import, every price button.

**What it does now:**

| Piece | Where | How it works | Clicks |
|---|---|---|---|
| Write 10 with Claude, the playbook way | Idea step (slideshows), under the hook box | Follows `post-writer-brief.md`: for each of 10 slots Claude picks the effect, writes the moment first, pours it into a structure or lens, writes 3 and keeps 1 plus the runner-up as the alt hook. Then a second Claude call, a separate reviewer that did not write them, scores every hook 1 to 5 on the playbook ladder with the kill test; only the 1s and 2s are shown ("4 scored 3 to 5 and are hidden"). One price on the button covers both calls, models named | 1 |
| A hook card | The hook list | The hook; one line for the moment; the code as the tag (S1 to S12, L13 to L25, with its name); the target effect (E1 to E8); the alt hook; the reviewer's score (1 or 2) and its note. Chips filter by code. 10 from the vault stays free and keeps its pattern tags | 0 |
| Per account | Posts home > Accounts, each row | A **primary** and a **backup** structure (filled from the playbook's fit table: F1 S3 and S11, F2 L14 and S1, F3 S11 and L20, F4 S11 and S3, F5 S3 and L18, F6 S6 and S1, F7 S12 and S4, F8 S9 and L24, F9 S2 and L21, Callie S5 and S10, Solei S2 and S6; editable, a default). The writer leans on them and never repeats the account's last code; a hook with the last post's code carries a warning | 1 per edit |
| Jenga drafts | Use this hook | The draft follows the brief: 6 slides, 4 to 14 words, each slide answers one small question and opens the next, setup and punchline never on one slide, the reveal waits, the payoff completes the scale on the last slide. The moment, code and effects of the hook go in; the alt hook is kept on the post; a product post names SideStep only on slide 5 or 6 and starts its caption with "Ad:" | 1 |
| Language lint | Every hook card, the hook box, every slide's words, the caption (slideshows), the on-screen text (video posts), the plan import's preview and the Finish step | Free, as you type, warnings only: em or en dashes; should, need to, must, ought; "just" before an instruction; dream job, unlock, level up, game-changer, supercharge; a sentence that starts with "You" ("POV:" is fine); more than 5 hashtags; SideStep in a hook; a product post whose caption does not start with "Ad:". Each is a default in Settings > Rules (on or off, per account or character); the word lists are data (`config/content.yaml`) | 0 |
| Import a plan | Posts home, the **Launch plan** card (under Accounts, collapsed when empty) | Upload or paste a CSV with the plan's columns. **Preview (free)**: the rows in a grid by day and account (format, the hook's first words), each row's errors and lint warnings, what each slide becomes (photo or special slide), the character each account's posts are filed under, and the total price to generate everything with the picked stills model. **Make 140 drafts** (free): every row becomes a draft in its flow. Importing the same file again updates the drafts that have not been generated yet (matched by row_id) instead of doubling them | 2 |
| Slideshow rows | Feeders (list, story, mock UI, stat) and character slideshows | A slideshow draft with the hook, slides 2 to 6, the scene, caption, hashtags and CTA as written (no redraft). The scene's "Slide N:" parts become each slide's shot; the rest is the locked scene. Every slide is a photo made as written by default (the plan's scenes put mock screens on laptops and phones in real places). **Draw mock screens by code** (a switch in the preview, off by default) turns a slide whose words describe a screen the Studio draws (calendar invite, email, lock screen, placard, invoice, bank app, portal timeline, form, survey, profile card, text thread, notification, posting) into that special slide with its quoted words filled in; any slide can also be switched by hand in its slide card. Feeders are topic slideshows (no one in the photos); Callie's and Solei's are character slideshows. product = yes turns on #ad | 0 |
| Photo rows | Character photos | A one-slide character slideshow: the hook is the on-screen text, the scene is the locked scene, the export is one 1080 x 1920 JPEG (and the 3:4 crop) with caption.txt and post.json | 0 |
| Clip rows | Character clips | A video post at its Stills step: the hook is the on-screen text, the scene as written is the post's idea (read for free into the scene fields), clip_action is "What happens in the video". Caption, hashtags and CTA wait in the Finish step to copy | 0 |
| What a plan row keeps | Every imported post | structure, effect_open, effect_payoff, hook_score, moment_id, moment, alt_hook, tension, pillar, audience, mention_mother (and row_id, date, slot, format, product, stat_source, notes, the scene and clip_action as written), shown in a small Plan line on the post and written into post.json | 0 |
| Generate | The Launch plan card, after the drafts | Tick rows (or a day, or an account) and **Generate N posts** (one price first, the stills model and billing path on the button: Nano Banana 2.1 on the plan or GPT Image 2.5 Flare on the API). A slideshow gets a still for every photo slide; a clip gets its opening still, and its take is made in the post with its own price after the owner picks the still. More than 10 rows queue in tens: ten posts run, then the next ten; built for 100 in one click | 1 |
| Alt hook swap | Idea step (slideshows) and the Caption step (video posts), next to the hook | **Swap with the alt hook** (free): the hook and the alt hook trade places in one tap. **Make variations** starts from the alt hook: variation 1 uses it word for word, the others reword it | 1 |
| More special slides | Each slide card's picture menu, and the Slides step's editor | Nine more, drawn by code, generic, no real brands or logos: application form (empty or filled, with a field count), portal status timeline with timestamps, calendar invite, itemized invoice or receipt, bank or savings app (amounts can be blurred), museum placard, 0 to 10 survey, lock screen with a notification stack, profile card with a banner | 1 |
| Product screenshot | The same picture menu: **Product screenshot** | **Upload the screenshot** on the slide card (a real SideStep screenshot); it is placed as uploaded, never stretched, over the slide's blurred photo; the Slides step sets its size and its place (Top or Middle) and keeps it out of the bottom 20%. Export waits until it is uploaded. The Studio never draws a SideStep screen | 2 |

Every paid step shows its price and model and waits for the click: Write 10
with Claude (writer and reviewer), Use this hook, Generate N posts, and
every step that was paid before. The lint, the import, the preview, the
drafts, the swap and the special slides are free and say so. Generation
works on the Higgsfield API as well as the plan.

Defaults in Settings > Rules (rule one): one rule per lint check (area
copy), "never the same structure twice in a row" (`structure-repeat`).
The claims sheet, the price before every run, the REALISM block, banned
words and no nudity stay fixed.

Built details: "#ad" becomes "Ad:" first in the caption (the brief's
rule), and a caption that already starts with "Ad:" is left as it is. A
CTA line that is not already in the caption is added after it in "As
posted". A topic account needs no character, but its posts are filed under
one (the account's character on the Accounts card, else the first
character) because pictures are stored per character; nothing of that
character (face, voice, name) goes into a topic post. The Idea step of a
topic post says so ("F2 · a topic account, no one in the photos (pictures
filed under Callie)") instead of "For Callie". Make variations sends each
variation to another account of the same kind: a character post's to
that character's other accounts, a topic post's to another topic account,
never a face onto a faceless account. post.json lists each special
slide's own fields, and a product screenshot's asset, width and place.
