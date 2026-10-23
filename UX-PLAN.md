# Character Studio UX plan

Status: APPROVED by the owner (2026-10-13), with the decisions in section 0.
Built (the refactor, step 2 of section 7): every page below exists, the old
addresses redirect, and the click counts in section 6 were measured in the
browser in demo mode. Clone Video is built too (step 3 of section 7,
DECISIONS G18). Every new feature must fit this plan or update it first.

Wireframes: `docs/studio/ux/` (rough, grayscale; numbers match section 4).

---

## 0. Owner decisions (2026-10-13)

- **Multi-product, multi-character, multi-account (standing rule, owner,
  2026-10-17).** The Studio makes posts for many products, characters and
  accounts. Nothing product-specific is ever global: a product's rules,
  wording, examples, word lists and defaults apply only to that product's
  posts (section 29). Every new feature's plan states which products,
  characters and accounts it applies to, and anything with no product
  works with neutral defaults.
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
- **Every post stays reachable (owner, 2026-10-17).** Posts home shows the
  newest 200 posts (by when they were last changed); under them, **Show
  older posts** loads 60 more at a time, with the account and character
  filters applied on the server, so a filter finds older posts too. The
  filter chips list every account and character with posts. A post opens
  from its link however old it is.

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
    - Every tap target is at least 40 px tall (owner's phone pass,
      2026-10-17): small buttons, chips, segmented choices and step pills
      grow on a phone; the round Guide buttons and switches keep their size
      with a 44 px touch area around them; tick boxes are 22 px.
    - A wide table becomes one small card per row (the launch plan's
      posts, its accounts and its rows to import), so a column never sits
      off the screen. A grid meant to scroll (the plan by day and account,
      a strip of slides) scrolls inside its card, never the page.
    - A switch keeps its words beside it.
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
| Write 10 hooks | Under the hook box | Two buttons. **10 from the vault** (free, code only): hooks from the product's hook vault and buyer language, recast into the patterns below. **Write 10 with Claude** (priced on the button, the model named): the vault, the buyer language and the character's voice card go in; 10 come back. Each hook carries its pattern tag: someone doubts or reacts, POV, things nobody tells you, red flags, listicle, storytime, myth vs fact, tier list. Pattern chips filter the list. The product is the post's product (section 29), never the first kit by default | 1 |
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
| Write 10 with Claude, to THE STANDARD (v1.2) | Idea step (slideshows), under the hook box, on SideStep posts (section 29) | Follows THE STANDARD at the top of `viral-writing-playbook.md` v1.2 and `post-writer-brief.md` v1.2: every hook names the job situation (a job application, interview, offer, recruiter, salary, resume), says exactly what happened (the number, the thing, the moment), hurts 7 or more out of 10, reads in one second with no image (about 15 words), opens a loop the slides close, in the TikTok group-chat voice (lowercase, CAPS for the shock word, texting spellings, one or two slang words, never LinkedIn). The playbook's pass and fail examples are the writer's few-shot set. For each of 10 slots Claude also gives the effects, a moment and a structure or lens (they shape slides 2 to 6, not the hook), writes 3 and keeps 1 plus the runner-up as the alt hook. Then a second Claude call, a separate reviewer, runs the five-check stop test first (stops a stranger, clearly a job, exactly what happened, pain 7 or more, sounds like a friend; any no is a 3 at best) and scores every hook on the v1.2 ladder; only the 1s and 2s are shown ("4 scored 3 to 5 and are hidden; 4 of them failed the stop test"). One price covers both calls, models named. THE STANDARD, the ladder and the honest endings are data (`hook_standard`, `playbook_ladder`, `product_endings` in `config/templates.yaml`), shared with Make variations and the kit's hook variants | 1 |
| A hook card | The hook list | The hook; one line for the moment; the code as the tag (S1 to S12, L13 to L25, with its name); the target effect (E1 to E8); the alt hook; the reviewer's score (1 or 2), its pain out of 10 and its note. Chips filter by code. 10 from the vault stays free and keeps its pattern tags | 0 |
| Per account | Posts home > Accounts, each row | A **primary** and a **backup** structure (filled from the playbook's fit table: F1 S3 and S11, F2 L14 and S1, F3 S11 and L20, F4 S11 and S3, F5 S3 and L18, F6 S6 and S1, F7 S12 and S4, F8 S9 and L24, F9 S2 and L21, Callie S5 and S10, Solei S2 and S6; editable, a default). The writer leans on them and never repeats the account's last code; a hook with the last post's code carries a warning | 1 per edit |
| The story draft | Use this hook | The draft follows the brief v1.2: 6 slides, 4 to 14 words, in the hook's voice, one thread: slide 2 the setup that raises the stakes, slide 3 or 4 the turn (often a person reacting), slide 5 the payoff, slide 6 relief, recognition or a question the comments answer; every slide makes sense to a stranger and has its image line; the caption is one line that adds a layer. The moment, code and effects of the hook go in; the alt hook is kept on the post | 1 |
| Product endings | A product post's last slide (Use this hook, variations, batch) | Slide 6 is a friend's tip that fixes the exact slide 1 pain ("my friend told me about SideStep fr fr..."), from the four honest endings only: one click fills the whole app (retyping the resume into boxes), it shows how u match before u apply (hours on jobs you don't fit), it shows exactly what to add from stuff i actually did (rewriting the resume for every job), $99 once, no subscription (paying monthly for job tools). Ghosting, fake jobs, layoffs, salary games, scams and interview rounds stay pure pain: the draft says "none", SideStep is not named, #ad goes off and the Slides step says why. Never "stop getting ghosted", "passed over" or "it applies for you". The caption starts with "Ad:" when SideStep is named | 0 |
| Language lint | On SideStep posts only (section 29): every hook card, the hook box, every slide's words, the caption (slideshows), the on-screen text (video posts), the plan import's preview and the Finish step | Free, as you type, warnings only: em or en dashes; should, need to, must, ought; "just" before an instruction; dream job, unlock, level up, game-changer, supercharge; a sentence that starts with "You" ("POV:" is fine); more than 5 hashtags; SideStep in a hook; a product post whose caption does not start with "Ad:"; and on a hook, THE STANDARD's four: no job word (job, interview, recruiter, offer, salary, resume, hiring, application), over 22 words (the writer aims for about 15; the v1.2 passing examples run to 22), opening with a label or stage direction (Exhibit, Levels of, Previously on, Calendar invite, a timestamp or date), more than one quoted phrase; on a product post's last slide: ghosted, passed over or applies for you. The caption is checked as posted ("Ad:" is put first by the export). Each is a default in Settings > Rules (on or off, per account or character); the word lists are data (`config/content.yaml`) | 0 |
| Import a plan | Posts home, the **Launch plan** card (under Accounts, collapsed when empty) | Upload or paste a CSV with the plan's columns, read by name in any order (a rewritten plan with the same columns replaces the test file later; unknown columns and missing required ones are named in the preview). **Preview (free)**: the rows in a grid by day and account (format, the hook's first words), each row's errors and lint warnings, what each slide becomes (photo or special slide), the character each account's posts are filed under, and the total price to generate everything with the picked stills model. **Import N rows** (free; only the ticked rows, with the plan's product, section 29): each becomes a draft in its flow. Importing the same file again updates the drafts that have not been generated yet (matched by row_id) instead of doubling them | 2 |
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

TikTok only (v1.2): slideshows are made for TikTok. The stills are made
at 9:16 (the Stills step's "Made for" choice is gone; an older 3:4 post can
switch back), and Export makes the 1080 x 1920 set with caption.txt and
post.json. **Also make the Instagram set** (Finish, off by default) adds
the same slides at 1080 x 1440.

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

**The Pictures column follows Generate (owner, 2026-10-17).** After
Generate N posts, each post's row on the Launch plan card counts its
stills as they land and ends on its full count ("6 of 6"), and so does the
card's "with their pictures" line, with no reload. Before, the card
stopped reading the plan when the stills stopped running, so a finished
post could stay at "0 of 6" until the page was reloaded.

## 29. Products: every post belongs to one product, or none (owner, 2026-10-17)

Goal: the Studio promotes many different things for many characters on
many accounts (rule two, section 0). Every post is written to the general
standard; everything that belongs to one product (its hook vault, buyer
language and claims sheet, the rules it adds, their language notes, its
B-roll, its plan rows) follows the post's product and nothing else. A post
with no product gets the general standard and neutral defaults.

Applies to: every post kind (video post, slideshow, batch), every
character, every account. SideStep's rules reach SideStep posts only.

**What the Studio did before this (the audit):**

| Piece | Before |
|---|---|
| The post's product | Slideshows only, in their spec; when none was picked the writers took the account's first product (SideStep), so every slideshow wrote to SideStep's rules. Video posts and batches had none |
| THE STANDARD (SideStep's writing standard v1.2) | In every hook writer, the reviewer, Use this hook, Make variations and the kit's hook variants, whatever the post was about |
| Language notes | On every post: a Callie video post captioned "Do boys even know what it's like to be a girl?" got "No job word" |
| "Pick a hook" (Caption step) | Its own product chips, not saved, the first product by default |
| B-roll | A free-text "Product, e.g. Notion" label, not tied to the products |
| Posts home | Filters by account and character only |
| Launch plan import | Every row became a draft (all 140); the plan had no product; the CSV's product column was a yes or no |
| Wording | Job-hunt examples in placeholders and in drawn screens' first words on every post |

**What it does now:**

| Piece | Where | How it works | Clicks |
|---|---|---|---|
| Product | The Idea step of every post (video post, slideshow, batch), one chip row: **No product** and each product, with what the post is written to under it | The post's product, saved with the post. A new post takes its account's product (Posts home > Accounts) or none; never "the first product". Make another like this, variations, batch posts, Recreate with another character and plan drafts keep their source's product. The post card shows it | 0 or 1 |
| The general standard | Every writer, every post | The hook: a stranger would stop on it, clear on one read with no image, says exactly what happened, sounds like a person (the stop test, four checks), about 15 words, a loop the slides close. The slides: one story thread, the clarity test (every slide makes sense to a stranger), an image line a slide. The voice: the character's voice card, or the account's own words. Write 10 with Claude is one call with no reviewer: the writer runs the stop test and keeps only hooks that pass, each with its moment, pattern and alt hook. Data: the unprefixed templates in `config/templates.yaml` (`hook_standard`, `slideshow_hooks`, `slideshow_draft`, `slideshow_variations`, `hook_variants`) | 0 |
| A product's own rules | Library > Hooks, each product's card: **Writing rules** | The general standard alone, or a set of rules on top (`writing_standards` in `config/content.yaml`). SideStep rules v1.2 add the job word, pain 7 or more, the group-chat voice, THE STANDARD's examples, the playbook's structures per account, the honest endings on ads, a separate stop-test reviewer (a second call) and the language notes; its templates are the `sidestep_` ones. A product made from the SideStep kit starts on them; any other on the general standard alone | 1 |
| Written for a product vs an ad for it | The post's #ad switch; a plan row's ad column | Separate. #ad puts "Ad" on slide 1 and "Ad:" first in the caption and, on a product whose rules have them, the honest endings on the last slide; on any other product, an honest tip about it inside its claims sheet. A post written for a product with #ad off never names it. A plan import never turns a pure-pain row into an ad | 0 |
| Language notes | Every hook, slide and caption | The long dash check on every post, any product. The rest (should and must, "just", hustle words, a sentence starting with "You", hashtags, the product in a hook, "Ad:", the four hook checks, the product ending) only on posts whose product's rules have lint on (SideStep's). The post's own product is the name never in a hook | 0 |
| Accounts | Posts home > Accounts, a **Product** column | Each account's product: the default for new posts on that account. No account has one until the owner sets it (no hard-coded defaults) | 1 |
| Posts home filter | Posts home, a **Product** chip row next to Account and Character | All, each product, No product; applied on the server, so Show older posts finds older posts of that product too | 1 |
| Pick a hook | Caption step | The post's product's vault; with no product, a note and a product pick to browse | 0 |
| B-roll | Library > B-roll and the post's B-roll row | The product is picked from your products (or none), no free text. A post's B-roll lists its product's clips first. A clip from before keeps its old label until a product is picked | 1 |
| Launch plan import | Posts home > Launch plan | Four numbered steps: 1 **Upload the CSV** (shows "launch-plan-v2-posts.csv · 140 rows loaded"; the text itself behind **See or edit the rows** or **Paste the rows instead**), 2 **Preview (free)**, 3 **This plan is for** (the product of the rows that name none, or No product; filled when the plan's accounts agree on one) and **tick the rows to import** (nothing ticked at first; filter by day or account, Tick the shown, Tick all; each row shows its product and Ad), 4 **Import N rows (free)**. Only the ticked rows become drafts. The button names what is left when it cannot run | 3 to 4 |
| Plan columns | The CSV | **product** holds a product name (blank: the plan's pick) and **ad** holds yes or no. A row naming a product not in Products is an error in the free preview and never imports. An older file whose product column is yes or no still imports: that is the ad column, and the plan's pick sets the product | 0 |
| Draw mock screens by code | The import's step 2 | One plain line: phone screens, emails, placards and forms drawn by the Studio (free, the exact words) instead of photos; off, every slide is a photo made from its scene | 1 |

Free throughout: the product pick, the filters, the writing rules, the
import. Paid steps keep their price buttons; on the general standard
Write 10 with Claude is one Claude call (SideStep's rules add the
reviewer, a second call on the same button).

Defaults in Settings > Rules (rule one): the language notes keep their
switches; their messages say which are SideStep's. Fixed rules are
unchanged.

Wording: placeholders and examples outside SideStep are neutral (the
caption box, the slideshow topic, hook and batch boxes, the voice card,
the Accounts box, the batch CSV template, "How {product}'s buyers really
talk"), and a drawn screen starts with neutral words. Slideshows stay
TikTok only by default for every product (the owner's v1.2 item; the
Instagram set is one switch in Finish). The 3 slideshows made before this
on the TikTok account had no product picked (they wrote to SideStep only
through the first-product default); they now show No product until the
owner picks one.

## 30. Slide image model: by who is in the slide (owner, 2026-10-17)

Goal: a slide showing a character uses that character file's stills
default (Callie: GPT Image 2.5 Flare plus "bare natural lips, no gloss");
a slide with no character uses the cheapest model. Plan-path billing is
right for Flare. Clip opening stills follow the path picked on the card.
Model and price on every generate button. The edit, face pass and
Recreate stills defaults do not change.

**What the Studio did before this (the audit):**

| Piece | Before |
|---|---|
| The stills pick | One model per path, the same for every slide: Nano Banana 2.1 on the Higgsfield plan, GPT Image 2.5 Flare on the Higgsfield API (`still_model`, `api_still_model`), the last pick kept |
| Character files | The Models section's stills default ("Scene stills: GPT Image 2.5 Flare by default") was read, but only the post Stills step's model chips used it |
| Topic slides | The same model as the path (Nano Banana 2.1 on the plan at 1.5 credits a still, when Flare is 1) |
| A character slideshow's slide of a thing | Made with the character's sheet refs and her name in the prompt, like every other slide |
| Flare on the plan path | Not offered. A run that put Flare on the plan sent no billing path (only a model the API does not offer went to the account), so the runner used the account's Higgsfield default, which is the API in production: the quote, the hold and the charge were the API's dollars, on the API key |
| Clip opening stills (Generate N posts) | The picked model, with no billing path: the account's Higgsfield default, whatever the card said |
| The plan preview's price | Dollars for every path, from one model's price |

**What it does now:**

| Piece | Where | How it works | Clicks |
|---|---|---|---|
| Stills on | The slideshow's Stills step, above Generate the set; the Launch plan card, in the import's preview and above Generate N posts | Two chips: **Your Higgsfield plan · credits** and **Higgsfield API · dollars**. The owner's pick, kept per post and as the account's last pick; the plan when it is connected. A path that cannot run says why (connect the plan, add the key) | 1 |
| The models line | Under the chips | What the picked path makes, with a still's price: "Callie's slides: GPT Image 2.5 Flare (Callie's file), 1 credit a still. Slides with no one: GPT Image 2.5 Flare (the cheapest on this path), 1 credit a still" | 0 |
| A slide that shows the character | Every still of a character slideshow, a photo row, a clip's opening still | The stills model in the character file's Models section ("Scene stills: ..."), at the Standard level. When the path cannot run it (Nano Banana 2.1 on the API), the file's second choice; a file that names none uses the Studio default (`default_still_model`, GPT Image 2.5 Flare at Standard: medium, 2k). Every Flare prompt carries "Bare natural lips, no gloss." The sheet refs carry the face; the Higgsfield element goes with them on the plan only on a model that takes elements (Flare does not) | 0 |
| A slide with no one in it | A topic slideshow's slides; a character slideshow's slide whose shot has no person | The cheapest still model the path can run, from the price book at the Standard level (`empty_still_models` in `config/content.yaml`; GPT Image 2.5 Flare today: 1 plan credit, about $0.06 on the API). The topic prompt (no one in focus, no faces), no refs, no face check | 0 |
| Who is in the photo | Each slide card of a character slideshow: **Callie in it · GPT Image 2.5 Flare** or **No one in it · GPT Image 2.5 Flare** | Read from the shot for free: the character's name, her pronoun, a shot that starts with what she does ("typing fast on the laptop"), a selfie or a look at the lens shows her; a thing or a place ("a laptop balanced on a keg", "close-up of the lock screen") shows no one. A default: the owner switches it on the card and the pick moves with the slide. A plan photo row is always the character | 0 or 1 |
| Plan-path billing | Every still on Your Higgsfield plan | Billed to the Higgsfield account (MCP): the quote is Higgsfield's live credit price (the price book's credits when it is slow; Flare at Standard 1 credit a still), the hold and the charge are in credits. On the API, the API's dollars. The path is in each request, so it never falls back to the account's Higgsfield default | 0 |
| Clip opening stills | The Launch plan card, Generate N posts | A clip row's opening still is its character's file default, on the path picked on the card | 0 |
| Model and price on the button | Generate the set, Reroll and Make it on a slide card, Generate N posts, Make variations, Make 10 | "Generate the set (6 stills) · 6 credits · GPT Image 2.5 Flare". When one run mixes models (the character's and the no-one slides on different models) the button names both ("Nano Banana 2.1 + GPT Image 2.5 Flare") and Details lists each still with its model and price | 0 |
| The plan preview's price | Launch plan card, the import's preview | Each photo priced on its own model on the picked path: credits on the plan, dollars on the API ("about 180 credits on Your Higgsfield plan") | 0 |

Unchanged: the post Stills step's own model chips (its default stays
GPT Image 2.5 Flare), one-change edits, the face pass, crops and upscales,
Recreate's stills (Nano Banana 2.1 on the plan, GPT Image 2.5 on the API),
a batch from hooks (its slides are priced before their shots exist, so
each uses the post's mode: the character's model, or the cheapest for a
topic batch). Variations use each slide's own model.

Data, not code: the character's model comes from the file, the empty-slide
candidates from `config/content.yaml`, the levels from
`config/scenes.yaml`, the prices and credits from `config/pricebook.yaml`,
and which models take elements from `config/models.yaml`.

## 31. Daily spend cap (owner, 2026-10-17)

Goal: a setting in Settings, default $10 a day, editable. A run that would
cross the cap waits and says so, with today's spend and the run's price.
The cap applies on the plan path and the API path. Today's spend shows
next to the price on every paid button. Budget caps are a fixed rule
(rule one): this one blocks.

**What the Studio did before this (the audit):**

| Piece | Before |
|---|---|
| Caps | Per run ($3), per character ($50), per month ($200); holds of unfinished runs count as spent. No daily cap |
| Plan-path runs | Priced in credits and counted at the owner's credit value for the caps, $0 unless set: on the plan, the caps never saw them |
| A blocked run | "Over budget" on the price and "This run would go over a budget cap. Adjust caps in Settings." No numbers |
| Generate N posts | One quote for every group of ten, held up front; a later group started when the one before finished, with no check |
| Paid buttons | The price and the model; no running total |

**What it does now:**

| Piece | Where | How it works | Clicks |
|---|---|---|---|
| Per day | Settings > Budgets and usage, Budget caps | $10 by default (`config/budgets.yaml`, `day`), saved per account (the `budgets` table, scope `day`). "Today" is the calendar day in UTC (the Studio does not know your time zone) and the field says so | 1 to edit |
| One cap, both paths | Every paid run | Plan credits count at the price book's API rate (`api_credit_usd` in `config/pricebook.yaml`: 1.5 credits = $0.094, so $0.0625 a credit); API and Claude runs at their dollars. Today's spend is what was charged today plus what runs under way hold (they count as spent, so two runs started together cannot pass it) | 0 |
| Today next to the price | Every price button (Generate, Reroll, Make it, Use this hook, Write 10, Retry, Generate N posts, the rest) | A small "today $3.20 of $10" after the model, on desktop and phone; Details repeats it | 0 |
| A run over the cap waits | The price button | The price reads **Waits**, the button is held, and one line says why: "Waits: today's spend $8.40 + this run $2.10 would pass your $10 daily cap. Raise the cap in Settings > Budgets and usage, or run it tomorrow (UTC). Nothing is charged while it waits." with a link to Budgets and usage. The server checks again at the click, so spend that landed in between still stops it | 0 |
| Generate N posts and its groups of ten | The Launch plan card, and every run list | The quote counts the first group against today; each later group is checked when its turn comes. A group that would pass the cap stays waiting (its hold, no charge) and each of its runs says "Waits: today's spend ... + this group ... would pass your ... daily cap." It starts on its own when the cap is raised, or on a new day (UTC) while the Studio is open | 0 |
| Batches, variations, Make 10 | Their price buttons | One run each: counted whole against today | 0 |
| Today in Budgets and usage | Settings > Budgets and usage, the spend card | "$X spent today (UTC) of your $10 daily cap" with a bar, and how plan credits count | 0 |

The other caps are unchanged (the per-run cap, the character cap, the
month cap, the confirm step); a blocked run says which cap in plain words.

## 32. Results: what each post did, and what to make next (owner, 2026-10-17)

Goal: from launch day on, every post keeps what it did once posted, and
Posts home shows which accounts, products, characters and hook structures
win, by follows per post (the playbook's section 11: decide by follows per
post first, then saves and shares, never by views alone). Free; no
platform APIs yet: the owner types or pastes the numbers. No new page, no
new step.

Applies to: every post kind (video post, slideshow, batch), with or
without a plan row, every product (or none), every character and every
account. Nothing in it is product-specific; the thresholds are data.

**What the Studio did before this (the audit):**

| Piece | Before |
|---|---|
| A post's results | Nowhere. Posts home > Accounts kept signups per account (typed), never per post |
| Reading results | Only in the playbook (section 11): the tiers (50K+ views: make 3 variations; under 1K twice: drop the hook family) were words, not on any screen |
| post.json | The post, its words, the plan's fields; nothing about how it did |

**What it does now:**

| Piece | Where | How it works | Clicks |
|---|---|---|---|
| The results of a post | Each post's card on Posts home: a **Results** row under its name (folded to one line: follows, views, saves, and the decision chip); the same fields in the post's **Finish** step, under Results | post_url, posted_at, views_72h, follows_72h, saves_72h, shares_72h, decision (Make 3 variations, Keep, One more try, Drop, or None) and notes. Saved as typed ("Saving..." then "Saved"). The number fields open the number pad on a phone and take "12.4K", "1.2M" and "1,203"; posted_at is the phone's date and time picker. Kept on the post (`spec.results`); results never move a post up Posts home (its last changed time stays) and never travel with Make another like this, a variation or a batch's slideshow | 1 to open, then typing |
| The decision chip | The post's card, next to the Results line | A small colored chip: Make 3 variations (green), Keep (blue), One more try (amber), Drop (red). None shows no chip | 0 |
| Paste results | Posts home > **Results** card: **Paste results from a CSV** (paste, or Upload the CSV) | Columns read by name in any order: `row_id, post_url, posted_at, views_72h, follows_72h, saves_72h, shares_72h, decision, notes` (common names like views or follows work too). A post with no plan row is matched by `post_id` (the Studio's id, in the post's link); an `account` column picks between two posts that share a row_id (the same plan imported for two accounts); on one account the plan's own post is the first made (Make another like this keeps the row_id). **Preview (free)**: each matched post and exactly which fields change (from what to what), the row_ids not found, the rows that match more than one post, a cell it cannot read (that row is left out), and the columns not used (named, then ignored). A blank cell leaves that field as it is; "none" clears the decision. **Apply N changes** writes only the rows that change something | 2 to 3 |
| posted_at | The CSV and the card | ISO ("2026-10-19 21:14", "2026-10-19T21:14", a day alone) and common forms ("10/19/2026 9:14 PM": month first, day first when the first number is over 12; "19.10.2026 21:14"; "Oct 19, 2026 9:14 PM"; "19 Oct 2026 21:14"). Kept as written ("YYYY-MM-DDTHH:MM"); a time zone in the cell is dropped and the time stays as written | 0 |
| The Results view | Posts home, the **Results** card (under Launch plan, folded like it) | **Follows per post** first and biggest, then posts with results, follows, views, saves and shares. **By** Account, Product, Character or Hook structure (the plan's structure code with its name, or the hook's from Use this hook; "No structure" when none): each row with posts, follows per post, follows, views, saves and shares, sorted by follows per post. Topic posts count as "No one (topic posts)" under Character. **Posted** from and to (days, on posted_at): only the posts that went up then; posts with numbers but no posted_at are counted apart. The Account, Character and Product filters above the cards apply to it too | 1 |
| Decision hints | The post's card (under its Results line), its Finish step, and the Results card's **Hints** list | Hints, never automatic. A post at 50K views or more: **"50K+ views: make 3 variations"**, with **Make variations** one click away on a slideshow (it opens the post at its Make variations card). A hook family with two posts under 1K views: **"Under 1K twice: drop the hook family"**, on every post of that family (drafts included, so the next one is not posted). The numbers are data (`config/content.yaml`, `results`: variations_views, variations_count, drop_views, drop_posts) | 0 |
| A hook family | The hints | A post and its variations (`variation_of`, the Studio's family), joined with every post that shares its plan moment (`moment_id`: the plan's row, its variations and Make another like this keep it). The plan gives each row its own moment, so two different rows are never one family | 0 |
| post.json | Every export | A `results` key (post_url, posted_at, views_72h, follows_72h, saves_72h, shares_72h, decision, notes, updated_at; null until any is typed), named as the CSV names them, for the posting engine later. Still version 2 (a new key) | 0 |

Free throughout: typing, the preview, Apply, the view and the hints.

Built details: the Results card's numbers and the hints read every live
post on the server (not only the newest 200 on the page); a hook family
crosses accounts, so the hints are worked out over every post and the
filters only choose which hinted posts are listed. Archived posts are out.
Results are written into the post on their own (`PUT /content/:id/results`),
so an edit in the post's workspace never undoes them. On a phone (section
3.11): the fields, chips and toggles are 40 px tall, a card with its Results
open takes the whole row, and the breakdown and the CSV preview become one
small card per row.

## 33. Download day: one zip a day of the approved posts, in posting order (owner, 2026-10-17)

Goal: until the posting engine is ready, posts go out by hand. Download
day turns a day's posts into one download: a folder per account, a
subfolder per slot with the slides (or the video), caption.txt and
post.json, and checklist.txt in posting order. Only approved posts go in;
each one is marked packed so it never packs twice by accident. Free. No new
page, no new step: a card on Posts home, a chip on each post's card and a
card in the Finish step.

Applies to: video posts and slideshows, with or without a plan row, every
product (or none), every character and every account. Nothing in it is
product-specific; slot times are data. A batch (many videos in one post) is
not a day's post: its own zip in its Finish step stays its download.

**What "approved" means (chosen from the code).** The batch review's
Approve covers a batch's slideshows only, and Exported (status ready) only
says the files exist, not that the owner wants the post out (and an
approved post with no export must still go in, exported first). So every
post gets one switch, **Approve for posting** (`spec.posting.approved`):
on its card on Posts home and in its Finish step. A batch review's Approve
turns it on too (Reject or back to pending turns it off), and a batch
slideshow approved in review before this counts as approved until the
switch is changed. Nothing else approves a post.

**What the Studio did before this (the audit):**

| Piece | Before |
|---|---|
| Approve | Only in a slideshow batch's review (Approve exports it); nothing on other posts |
| A post's day and slot | The plan row's date and slot (kept on the post, shown in its Plan line); nothing for a post with no plan row |
| Downloads | One post at a time: a slideshow's zip (slides, caption.txt, post.json), a video post's MP4 and post.json, a batch's zip |
| Posting order, a checklist | None |

**What it does now:**

| Piece | Where | How it works | Clicks |
|---|---|---|---|
| Approve for posting | Each video post's and slideshow's card on Posts home (a chip: Approve for posting, then Approved in green), and the Finish step's **Posting** card (a switch) | One tap on, one tap off. Saved on its own: it never moves the post up Posts home. Only approved posts go into Download day | 1 |
| The post's day and slot | The Finish step's Posting card: **Post on** (a day) and the slot (AM, Daily, PM or Any time) | The plan's date and slot by default ("From the plan"); set here for a post with no plan row or to move one; **Back to the plan's** undoes it. A post's day is its own, else the plan's, else the day it was posted (its results). The card shows the day and slot next to the chips | 0 to 2 |
| Download day | Posts home, the **Download day** card (under Launch plan, folded like it) | Pick the day: today by default (this phone's or computer's own day), or any other. **Include packed posts** (off): pack posts again. The **slot times** show as chips (AM 09:00, Daily 12:00, PM 18:00 to start; **Change** edits them, kept per account; the defaults are data in `config/content.yaml`, `posting.slot_times`) | 1 |
| The preview (free) | The card's list | Every post of that day, in posting order (the slot's clock time, then the account, then the plan's row): the slot and time, the account, the hook, Ad, and either **Goes in** with its folder (and "exported first, free" when it has no export yet) or **Left out** and why: not approved for posting; already packed (when, and which day's zip); missing pictures (the slides that need one, or a video post's clip); not exported yet and could not be exported (the reason); exporting right now; no account. Each row opens its post. On a phone each row is a small card | 0 |
| Make the zip | Under the list: **Make the zip · N posts · Free** (full width on a phone) | A free job on the Studio's worker, with the live status line. An approved post never exported is exported first (free). Then **Download the zip**. When nothing can go in, the button says what is left (approve a post, or Include packed posts) | 1 |
| The zip | The download (`download-day-<date>.zip`) | `<date>/checklist.txt`, `<date>/left-out.txt`, and `<date>/<account>/<n>-<SLOT>-<HHMM>/` per post (for example `F2/1-AM-0900`, numbered in posting order within the account so the folders sort the same way; a post with no slot time is `n-ANY`): the 1080 x 1920 slides `01.jpg`, `02.jpg`... (a video post: `video.mp4`), `caption.txt` (the caption as posted, "Ad:" first on an ad) and `post.json` (the post's own, with its `results` and a `posting` block: day, slot, time, folder, pack id, "AI-generated label: on") | 0 |
| checklist.txt | Top of the zip | One line per post in posting order: `[ ] 1. F2 \| 09:00 (AM) \| Hook: "..." \| Ad: no \| AI-generated label: on \| F2/1-AM-0900/`, under a line that says to post each one from its folder and turn the label on | 0 |
| left-out.txt | Top of the zip | Each post of the day left out, with its account, slot time, hook and the reason; or "nothing was left out" | 0 |
| Packed | Each post that went in: a **Packed** chip on its card (the day; it downloads that zip again) and on its Finish step's Posting card | The next Download day of that date leaves it out ("Already packed") unless Include packed posts is on. **Zips made** on the card lists the last ten zips, to download again (each is kept in storage like any export) | 0 |

Free throughout: approving, the preview, the zip and any export it needs.
The zip takes each post's last export: after a change, export the post
again in its Finish step, then make the zip.

Built details: the zip is made by a local job on the worker
(`posting_pack:<date>`, fflate, stored, not compressed, in storage like any
export and served as a redirect, so Vercel only moves JSON); the job is the
pack's record (the zip's asset, the posts and the left-out list). A zip for
a day cannot start while another for the same day is being made. A video
exported from the editor gets a post.json made at packing time.

## 34. Library viewer, filters and collections (owner, 2026-10-17)

Goal: see anything full size in one tap, find it again fast, and keep
named sets of it. One shared viewer for every still and clip thumbnail in
the Studio, and filters and collections on the Library's Stills and Clips
tabs. No new page or step. Everything here is free.

| Piece | Where | How it works | Clicks |
|---|---|---|---|
| The viewer | Library > Stills and Clips; the Library drawer inside a post (the view button on a tile); a post's Stills and Video steps (the still and take tiles); the Recreate and Replace stills; a slideshow's slide cards and its batch review | Tap a still or a clip and it opens full size over the page. A still fits the screen; a clip plays with its controls, sound off until you unmute it. The left and right arrow keys, the arrow buttons, or a swipe on a phone go to the previous or next item of the grid it was opened from. Esc, the X or a tap outside the picture closes it, and you are back where you were | 1 |
| Under the asset | The viewer | Its name, date, character, model and cost (credits on the plan, dollars on the API; Free for uploads, local renders and demo runs), the posts that use it (each opens the post), **Download** (the original file) and the use button of the place it was opened from: Use in a new post, Make a video post and Use this clip (Library), Use in this post (the Library drawer in a post, the same as picking it), Use this still, Use this take or Add to the slideshow (a post's steps), Pick this one or Use this still (Recreate and Replace), Open the post (the batch review). In a post's steps **Details** opens the still's or take's drawer as before (check, fix, crop, keep, reject) | 0 |
| Small first | Every grid and the viewer | Grids load small copies (480 wide, made once and kept); only the open item loads the full file. The items next to it load their small copies, so the next one shows at once. An uploaded clip gets a small first-frame picture when it is prepared, so the Clips grid loads pictures, not videos; the clip itself plays in the viewer (on a computer, hovering a clip tile still plays it) | 0 |
| Filters | Library > Stills and Clips, under the tabs | Character (as before), **Model** (the models that made what is in the tab, plus Uploaded and Made on the Studio), **Date** (Any time, Today, Last 7 days, Last 30 days, or From and To), **Used** (Used in a post or Not used), **Product** (made in or used by a post of that product, section 29), **Collection**. The type is the tab: Stills or Clips. Filters run on the server, so an item older than the newest 400 is found too. Each active filter shows as a chip with an x, and Clear all removes them. The address keeps each tab's own filters (the character is shared by every tab, as before), so a link, a reload or Back brings them back | 1 per filter |
| Collections | Library > Stills and Clips: **Select**, then **Add to collection** | Pick items with Select (as for Delete), press Add to collection, then pick a collection or type a new name. A collection can hold stills and clips of any character. Pick it in the Collection filter to see only its items; with one picked, the Select bar also has Remove from the collection. **Collections** (next to the filter) renames or deletes one; deleting a collection never deletes its items. Stored per account | 2 to 3 |
| Phone | The viewer | Full screen; swipe left or right; the facts and buttons sit under the asset and scroll; every button is at least 44 px tall | 0 |

"Used in a post" means a live post names the item in its steps, its render
or its saved editor timeline: the same check the Delete warning makes
(section 22). A deleted item leaves its collections' view while it is in
the Trash and comes back with Restore.

## 35. The Oct 22 build: unblock posting, faceless characters, importer quality (owner, 2026-10-22)

Shipped in tier order; each tier is tested, pushed and live on production
before the next starts. New ideas found while building go to the report
and LATER.md, never into the build.

### Standing rules (owner, 2026-10-22; also in CLAUDE.md)

- **R1. Nothing covers a face.** Nothing the Studio places on an image or a
  video (captions, hooks, labels, stickers, drawn screens) ever covers a
  face. Every overlay checks the face boxes first: on a still, its faces;
  on a video, the faces across the whole clip.
- **R2. Fixed means fixed on production.** A fix is done when it works on
  character-studio-pi.vercel.app; the report names the production version
  checked and shows a screenshot. Every UI fix ships with a browser test
  that clicks the visible thing like a person and fails before the fix.
- **R3. Never limit shots.** The one-action, calm, one-camera-move rules
  live only inside the "caught you" recipe. Every other video and clip
  prompt builder (clip library, imported clip rows, image-to-video) keeps
  only: start from an approved still, same face and outfit, protect the
  face. Multi Shot is offered where a model has it.
- **R4. Price first, every feature on the API path.** Every paid step shows
  its price and waits for the owner's click. Every feature works on the API
  path, not only on a Higgsfield plan.
- **R5. One post workspace with drawers.** No bolted-on pages: new work
  fits the post workspace, its drawers, Posts home, Characters, Library or
  Settings.

### Tier 1: unblock posting

| # | Piece | Where | How it works |
|---|---|---|---|
| 1 | Editor text like CapCut | The editor (OpenReel fork), Text tab and every caption | The words render inside their selection box at every zoom and aspect, whatever the preset's alignment (the fork's renderer centers the text block on its position; alignment lines the rows up inside the block). A new line grows the box. One click on the words selects them, a drag moves them, a second click (without dragging) or typing a letter edits them in place, and a double-click edits too. Checked on every Text preset (Heading, Subtitle, Lower Third, Caption, Hero, Quote, Outline, Badge) on a 9:16 post (`e2e/editor/textpresets.spec.ts`) |
| 2a | Re-import asks | Launch plan import preview | Rows whose row_id matches posts already made show "N rows match posts you already have" with **Replace them (their pictures go to Trash)** or **Add as new posts**. Nothing is updated silently |
| 2b | Remake pictures | Launch plan list | Posts that already have pictures can be ticked and remade ("Remake 6 pictures, $X"); the old pictures go to Trash |
| 2c | Import a CSV | Launch plan card | The button reads "Import a CSV" |
| 2d | Clear | Launch plan card | Clear: all drafts in this import, only drafts with no images, or the ticked ones. One confirm, to Trash (restorable); the confirm says "3 of these have images you paid for" |
| 2e | Select all | Launch plan list, Posts home, Library, Trash, batch review | A header checkbox that respects the filters, "12 selected" with Clear selection, shift-click for a range |
| 2f | Next step | After an import | The last line is the next step: "10 drafts made. Next: Generate 10 posts, $X" with the button |
| 2g | One import door | Posts home | One Import button reads the file and routes slideshow, photo, clip and plan rows (and faceless rows, item 4g) to the right place, with a clear message. A plan CSV is never read as the older video batch sheet |
| 3a | Import a finished character | Characters | Upload the character file plus REF-00 to REF-11 (REF-12 and REF-13 when present) in one go; no hero generation, no inspiration likeness check; lands on a complete character |
| 3b | Delete character | Every character, half-built ones too | To Trash, restorable |
| 3c | Any upload as hero | Character setup | An uploaded image can always be picked as the hero |
| 3d | Edit refs | Any character's sheet | Add, replace or remove any reference image without a rebuild; prompt builders pick refs by framing, so new refs are used at once |
| 3e | Build refs | Character setup, Settings per character | "Build the models shrink" adds REF-12 (front waist-up) and REF-13 (3/4 waist-up) to the sheet steps and the import; Element creation takes several images (face plus build) |
| 4 | Faceless characters | Characters (Person or Faceless first), the post workspace | A faceless character's file (persona, place bank, look rules, voice and line formats, sound bank); its stills follow the faceless still rules (no person or body part, no text-carrying objects, a plain level upright phone snapshot, the fixed ending "Level, unedited. Sharp, real phone grain, muted color. No people.", Soul 2.0, 9:16); no hero, sheet, likeness gates, Element or face checks; posts use the same workspace (Still, Video, Sound, Text, Posted); products switch to an edit model; plan rows route to it; each account links to one character; voiceover clips (only if a source allows automated access); the "Finished damage" recipe |
| 5 | Line lint | Every on-screen line and slide 1 | Flags a line that reads as setup instead of a hit in its first words, or carries no clear emotion (angry, infuriated, sad, frustrated). Shows the flag, never blocks, free |

### Tier 2: importer and quality (planned 2026-10-22)

Applies to every product, character and account (rule two): the columns,
checks and placement are neutral; nothing is SideStep-only except item 15,
which reads the product's name from the line.

| # | What | Where | Plan |
|---|---|---|---|
| 6 | Scene from CSV columns | Plan CSV import | New optional columns `place`, `light`, `outfit`, `detail_1`, `detail_2` fill the post's scene lock (place, light, outfit, details) over what the `scene` cell says. Feeder (topic) rows may leave them blank; a character row needs an outfit (item 16) |
| 7 | Stills on kept | Plan page, Import | The preview's "Stills on" pick is sent with the import and saved on every imported post (`spec.stillPath`); Generate N right after the import uses it |
| 8 | Captions off faces, stills (R1) | Slide cards, slideshow export | A free face pass on each slide still finds the face boxes; the words go in the largest clear band of the safe zone that misses every face box grown by 4%: above first, then below, then one size smaller, last a box under the chin. Runs when a still lands, on a style change and after import; "Auto-place all" on the slideshow; a slide the owner dragged keeps its place; topic slides with no face keep theirs. Character still prompts add "Leave clear space in the top third of the frame for a caption." |
| 9 | Captions off faces, video (R1) | Video post caption, editor preview | Faces sampled about every 0.5 s across the clip, the union of their boxes; the caption goes in the clear band inside TikTok's safe zone, else under the chin above the buttons zone. The preview shows the face boxes |
| 10 | Drawn screens from text lines | Plan import, slides | A slide line that is mostly on-screen text (a job posting, an email, a text thread, a bank app) becomes that drawn screen automatically, its fields filled from the line, with generic company names, on every slideshow (no longer topic-only) |
| 11 | Slide image columns | Plan CSV import | `slide_1_image` to `slide_6_image` are each slide's own image line |
| 12 | Mixed framing | Character slideshows | Character slides rotate framing: close-up, mid, wide, hands only, over the shoulder (a default the owner can change per slide) |
| 13 | The slide's image line wins | Character slide prompts | A slide with its own image line sends it as written with only the REFERENCE line, the 21+ line, the outfit lock, the mark line and REALISM; no generic background, expression, camera or hair lines; no "same place in every photo" when the outfit lock says the place changes; `lock.place` carries only outfit and hair |
| 14 | Punch up | Import preview and each slideshow | A priced Claude call rewrites thin image lines to the density rule (a named camera, 3 to 5 specific objects, one background person or motion, mixed real light, mid-action), shows before and after, applies on OK |
| 15 | Product screenshot lines | Slides | An image line naming the product (SideStep) is marked "needs Eric's screenshot": never generated, never priced |
| 16 | Free pre-check | Plan preview and Generate N | Blocks a character row with no outfit and a slide with no shot line, named with the fix; free |
| 17 | Notes badge, "need to" lint | Plan rows | The notes badge opens its list on tap; the "need to" (values) lint flags only lines aimed at "you" |

### Built in this run (2026-10-22)

- **Item 1**: built. The fork's renderer centers every text block on its
  position (Caption and Lower Third were drawn a block above their box);
  a second click, a typed letter or a double-click edits in place; the edit
  box grows with its lines. Fork commit 1032533 pinned in
  `editor/openreel.json`.
- **Item 2**: built (2a to 2g). Posts and characters are Trash items now
  (`trash.ts` kinds `post` and `character`); Select all with shift-click on
  the Launch plan (rows and posts), Posts home (Select), Library, Trash and
  the batch review; Import on Posts home (`src/studio/importDoor.tsx`,
  `csvKind`).
- **Item 3**: 3a (the Import dialog already took the file and REF-00 to
  REF-11 in one go and lands complete), 3b, 3c and 3d built. **3e not
  built**: REF-12 and REF-13 need a waist-up framing in the sheet graph,
  its prompts, aspect and mark checks, and Element creation from several
  images is not in the Studio yet (Elements are made on Higgsfield and
  named in the file). Planned for its own session.
- **Item 4**: 4a, 4b, 4c, 4d, 4e, 4f, 4g, 4h (an account already links to
  one character on the Accounts card; faceless ones are listed) and 4j for
  faceless posts built. **4i stopped** as the owner asked: PlayPhrase.me
  and GetYarn.io forbid automated access; Clip.Cafe and Find Scene sell an
  API, but none of the four grants the right to put the clips' audio in
  posted videos. The Sound drawer keeps the row's search words and says
  so; voiceover clips are uploaded to Library > Sounds. **4j for person
  characters not built** (the recipe is a switch on faceless posts).
- **Item 5**: built (`lint-hit-first`, `lint-emotion`, word lists in
  `config/content.yaml` copy_lint).
- **Rule R3**: the video writer, its director's pass, the FORMAT line and
  the default directions no longer limit shots; the "Caught you" recipe
  (a scene whose moment is Caught you) keeps them. Multi Shot is not
  offered yet: no model in `config/models.yaml` documents it.
- **Tier 2**: not started in this run.

### Follow-ups built (2026-10-22, second run)

- **3e**: built. REF-12 (front waist-up) and REF-13 (three-quarter
  waist-up) are optional sheet shots with a `waist_up` framing (3:4),
  their own prompt lines and mark checks; a character turns them on with
  "Build refs" on its sheet (`PUT /characters/:id/build-refs`). A
  waist-up scene gets the build ref closest to its angle. Elements stay
  made on Higgsfield: the character file names one or more Element IDs,
  each with the REFs that built it (`refs`).
- **4j for person characters**: built. "Finished damage" is a switch on
  any person video post (one still, a 7 s just-existing take prefilled in
  the Video step, the sad song noted, the line).
- **Sound drawer** (replaces 4i): the sound's name and the voiceover's
  search words with Copy, and PlayPhrase.me and GetYarn.io buttons that
  open their search in a new tab with the words filled in. No scraping,
  no downloads. post.json has `sound_to_add` and the Download day
  checklist says "Add this sound in the app".
- **Slideshow text styles**: checked with the bundled fonts. Classic and
  Minimal drew their words low (descenders, the outline and the shadow
  past the box) and the Note card's shadow fell outside it. Every style
  now draws inside its box, words centered on their lines
  (`server/media/slideBox.test.ts`).
- **Text presets for 9:16**: every editor Text preset is sized for a
  1080x1920 frame and scaled to the post's height when added (size,
  outline, spacing, shadow); Caption is 56 px on a 9:16 post, was 24.
- **Price book**: a Soul 2.0 still is 0.12 plan credits, confirmed from
  the account's transactions of 2026-10-21.

### Tier 2 built (2026-10-22)

- **6**: `place`, `light`, `outfit`, `detail_1`, `detail_2` fill the lock
  (`rowScene` in `server/core/planImport.ts`); a light naming a preset is
  that preset, other light words stay with the place.
- **7**: the preview's Stills on pick goes with the import (`spec.stillPath`)
  and with Generate right after it.
- **8**: `server/core/facePlace.ts` (placement), `server/pipeline/facePlace.ts`
  (face boxes kept on each still's candidate, `autoPlace`), run when a slide
  still lands, from Auto-place all (`POST /content/:id/auto-place`) and on a
  text style change; a drag is `by: 'owner'` and sticks. Still prompts add
  `slideshow_caption_space`. The Instagram 3:4 set reuses the 9:16 place.
- **9**: `clipFaces` samples every 0.5 s (up to 120 frames) at export;
  `clearTop` in `server/core/overlay.ts` keeps the caption clear inside the
  safe zone, else under the chin; `outputs.faceBoxes` drawn on the Finish
  preview. The editor's own captions are placed by the owner (not moved).
- **10**: `screenFor` (mostly on-screen text) on every slideshow; the switch
  is on by default.
- **11**: `slide_1_image` to `slide_6_image`.
- **12**: `slideshow.framing_mix` in `config/content.yaml` defaults (close-up,
  mid, wide, hands only, over the shoulder; the `hands_only` framing preset),
  per slide on the slide card (`spec.framings`).
- **13**: `assembleSlideLine` in `server/core/scenes.ts`; `spec.asWritten` per
  slide, set by the import for plan image lines; "As written" on the card.
- **14**: `punch_up_lines` (route `punch_up`), `src/studio/punchUp.tsx` on the
  Stills step and the plan preview; OK'd lines go to the import as `lines`.
- **15**: a line naming one of the account's products becomes a Product
  screenshot slide with no upload ("Needs your screenshot"), never priced.
- **16**: `checkRow` blocks no outfit on character rows and slides with no
  shot line. The launch-plan-v2 file as written has 56 such rows.
- **17**: `NotesBadge` (tap to open); `lint-values` only in sentences aimed
  at "you".

## 36. The Oct 22 build, part 2: providers and recreates, small fixes, the line bank (owner, 2026-10-22)

Same standing rules as section 35 (R1 to R5). Shipped in tier order; each
tier tested, pushed and live before the next. New ideas go to the report and
LATER.md, never into the build. Rule two: everything here is neutral (every
product, character and account) except the line bank's ICP pain points,
which come from the product's own writing rules.

### Tier 3: providers and recreates (planned 2026-10-22)

| # | What | Where | Plan |
|---|---|---|---|
| 18 | No GPT Image 2.5 on a recreate | Recreate stills (the model choice) | OpenAI refuses edits of a real person's photo. The stills choices are Nano Banana 2.1 on the plan, Nano Banana 2.1 on Google AI Studio, Seedream 4.5 edit on fal (the fallback, "untested for recreates"). Default Nano Banana 2.1 (the plan when connected, else the first API path with a key). Flare stays for heroes, sheets and slideshow stills |
| 19 | The API path's providers | `server/providers/google.ts`, `fal.ts`; Settings > Provider keys | Google AI Studio (Gemini API generateContent) for Nano Banana 2.1; fal (queue API) for Seedream 4.5 edit, Wan 2.2 Animate replace and Kling 3.0 Motion Control. Keys made in each provider's dashboard and pasted in Settings only (sealed in the vault). A price on every button: each stills choice and motion model shows its own price |
| 20 | Stills before a clone | Replace the person | "Stills first" is on by default: the replace starts from a kept still that passed the gates, ahead of REF-00. Off: a warning on the panel and on the price, before the click |
| 21 | Gate decimals; your call on every take | Recreate stills and takes; Settings > Rules | A score next to its limit gets the decimals that show the fail (0.448 against 0.450, never 0.45 against 0.45). Every take asks Keep or Reject, a passing one too; each call is logged with the take's scores (Your calls on takes) |
| 22 | Priced buttons inside their cards | Every priced button | The button, its price, the model tag and today's spend wrap inside the card, tile or choice. A browser sweep checks every priced button on every page and post step at desktop and phone width |
| 23 | Genjutsu replace's real price | Price book | "Higgsfield Genjutsu - Object Swap" in the account's transactions: 77 and 35 credits, 7 a second (was a 3 a second placeholder) |
| 24 | Mass recreate | A batch post > Video > Recreate a batch of clips | A Google Sheet of TikTok links (link, character, keep place or new set, motion model, notes) or a synced Drive folder; fetched one at a time (TikTok through the owner's Apify, priced; Drive free); cleaned; skipped with a reason on failure. A free first pass: a clear adult (an age model on every face; no clear adult, skipped), people, length, the row's price. Tick rows, one total, one click for the stills; Keep or Reject each still; one click for the kept rows' videos. One queue group per row, so a long run waits at the daily cap and goes on after midnight (a daily cron resumes it). Two-person rows: two characters, left to right, Swap. The review queue plays the source and the result side by side. Works on the API path |

### Tier 3 built (2026-10-22)

- **18**: `recreateStillChoices` in `server/pipeline/clone.ts` (`scene_still`
  in `config/content.yaml`: `model`, `api_model` Google, `fallback_model`
  fal); a saved GPT Image 2.5 pick is ignored; `saveRecreateStillModel`
  refuses it.
- **19**: adapters with unit tests on fake networks (`apiPath.test.ts`);
  models in `config/models.yaml`, prices in `config/pricebook.yaml` (list
  prices, unconfirmed until each one's first paid run); download hosts in
  `config/runtime.yaml`. The motion picker shows fal models with their
  path ("fal") and price.
- **20**: `noStills` on the clone action; `clone-no-stills` shown under the
  price.
- **21**: `server/core/gateText.ts` (`vs`, `scoreAgainst`) in the still gate,
  the video rule and the badges; `TAKE_CALLS_KEY` log, `GET
  /recreate/take-calls`, the TakeCallsCard in Settings > Rules.
- **22**: `.st-pricebtn` and `.st-pricebtn-row` in `studio.css`; the sweep in
  `e2e/editor/tier3.spec.ts` (111 priced buttons on desktop, 114 on phone,
  every post step).
- **23**: `genjutsu-replace` at 7 credits a second, `charge_names: [Higgsfield
  Genjutsu - Object Swap]` so each run's real charge is matched.
- **24**: `server/pipeline/massRecreate.ts`, `src/studio/pages/post/
  MassRecreate.tsx`, the age check in `server/qa/age.ts` (the ONNX zoo's age
  GoogLeNet, fetched by `npm run models`), Apify in
  `server/providers/apify.ts`, the pair still (`recreate_pair`) and its
  scoring by side (`pairScores`), the new set line (`recreate_new_set`), the
  cron `GET /api/v1/cron/cap-resume` (`vercel.json` crons, 00:05 UTC).

### Tier 4: small (planned 2026-10-22)

| # | What | Where | Plan |
|---|---|---|---|
| 25 | Help chips never on a title | Every page and post step | Each chip sits inline right after its title (`.st-titlerow`, `.st-label:has(> .gd-howto)`) or right-aligned at the end of its header row. A browser sweep checks every chip against every title on every page and post step, dark and light, desktop and phone |
| 26 | Progress grouped by post | The run list and toasts | Runs carry their post (`postId`, `postLabel`: the plan row id, else the title or idea). One line per post ("P007: 4 of 6 stills done") and one toast when the post's last run ends, never one per still |
| 27 | The viewer on Trash and Posts | Library > Trash; Posts home | A Trash tile opens the viewer with Restore in it; a post's cover has a full-size button that opens the viewer with Open the post. The Guide's pictures of Posts home, Library, its Trash and Characters made again |
| 28 | One post, three platforms | Slideshow > Finish | One free click on the worker makes the Instagram carousel (1080 x 1440), a reel (1080 x 1920, 2 to 3 s a slide by its words, a slow zoom, cut, silent) and a Shorts copy within Shorts' caps, in one zip with caption.txt |

### Tier 4 built (2026-10-22)

- **25**: chips moved on Posts, Characters (and its Import dialog),
  Character, Settings, Library, the voice card, the faceless file,
  Finished damage, Products and the uploads row; the sweep in
  `e2e/editor/tier4.spec.ts` (`chipOverlaps`: no overlap with any title,
  and inline after it or last in its header row).
- **26**: `postRef` and `postLabels` in `server/jobs/jobView.ts`;
  `postProgress` and the post groups in `src/studio/runs.tsx`.
- **27**: `src/studio/trash.tsx`, `src/studio/pages/Posts.tsx`
  (`.st-postcard-view`); the four Guide pictures made with `GUIDE_SHOTS=1`.
- **28**: `server/pipeline/platforms.ts` (`slideSeconds`, `reelFilter`, the
  local job `platforms:<postId>`, `outputs.platforms`), `POST
  /content/:id/platforms`, the card in `SlideshowFinish.tsx`;
  `renderInstagramSet` taken out of `server/pipeline/slideshow.ts`. The
  test checks the files with ffprobe (1080 x 1920, no sound, the slides'
  length) and the zip's carousel at 1080 x 1440.

### Tier 5: the line bank (planned 2026-10-22)

Every post starts from a line that hits hard on the ICP's pain, written
from what real people said in the comments. Built fresh (branch
`claude/friendly-thompson-692xlp` ignored). It lives inside the Studio: a
drawer in the post workspace (the Idea step of a slideshow, the Caption
step of a video post or batch) and on Posts home's Launch plan card, never
a page of its own.

| # | What | Plan |
|---|---|---|
| 29a | Import | The drawer's Import: an Apify comment scrape as a CSV file or a Google Sheet link (columns comment, comment_likes, replies, video_account, video_views, video_url; any order, extra columns ignored) plus, optionally, the same run's videos CSV (url, text: the captions), joined to each comment by its video's URL. A private Sheet cannot be read by link: the drawer says "Share it as Anyone with the link, or download the tab as CSV". Each import picks the product whose writing rules apply (the post's product, else the plan's) |
| 29b | The free first pass | Code only, on the import: duplicates (same words after case, spaces, emoji and punctuation), not English (another script, or no common English words), about the video itself (the sound, her outfit, the edit, "who's here", tags of friends only), 0 or 1 likes, under 4 words, and off the job search (no word from the topic list in `config/content.yaml`). Kept comments go in the bank; the drop counts by reason show on the import |
| 29c | Tags (priced) | Batches of 30 kept comments, Claude Sonnet like every Claude task (route `line_tagger`): emotion (infuriated, angry, sad, crying, frustrated), topic (layoff, ghosting, interviews, applications, money, family, burnout, entry level, AI, bosses, quitting, small wins), the ICP pain point from the product's writing rules (`pains` of its standard; "none" for a product without), who it fits (unemployed first person, secondhand for the girls, both), format fit (finished damage, meme setup, question, list), and a fight flag (race, religion, politics) with a reason. Flagged lines never go into Write the week |
| 29d | Writer and reviewer (priced) | Each tag batch then goes to the writer (Sonnet, route `line_writer`): one on-screen line per comment in Gen Z vernacular, the comment's own truth and its specific detail, starting at 70 (the first words are the hit, no setup), readable in about 2 seconds (12 words or fewer). A separate reviewer call (route `line_reviewer`) scores each line 1 to 10 on gut punch, specificity and "would a real person post this", and marks setup or meh. A line passes when all three are 8 or more and it is neither; rejected lines never show (only their count). Tag, write and review are one price, one click, chained per batch |
| 29e | The bank view | Filters: character (lines that fit how the character speaks), emotion, topic, pain point; sorted by the source comment's likes; each line shows its source comment, its likes and its three scores; flagged lines carry their reason |
| 29f | Use | On a post, Pick from the bank lists lines that fit the post's character and are not used on another account. Use this line (priced, one small Sonnet call) rewrites it in the character's voice card and against their facts (the voice card's who and point of view): a line that contradicts them is edited to fit, or skipped with the reason. The result is placed: a slideshow's hook, a video post's caption, a batch's next caption. Write the week (Launch plan card, per account, priced): the account's posts dated in the next 7 days without a bank line each get the best unused fitting line, rewritten in one call. A line used on one account never shows for another |
| 29g | Learning | Keep or Reject on every line in the bank is logged; the last kept and rejected lines (up to 8 each) go to the writer and the reviewer as examples. A used line keeps its post; Results gets a "Source truth" breakdown (follows per post by the comment each post's line came from) |
| 29h | The real test | Eric's sheet ("TIKTOK APIFY RUN FOR SIDESTEP", tab comments, 5,375 comments; tab run1_ranked, 876 videos with captions) through the import and the first pass; the full run's price from the quote; the top 30 lines with their source comments and scores |

Where each part lives: the pure parts in `server/core/lineBank.ts` (the
reader, the first pass, the fit rules, the schemas), the jobs and storage
in `server/pipeline/lineBank.ts` (a `bank_lines` table and a
`line_bank_imports` setting), the drawer in
`src/studio/pages/post/LineBank.tsx`.

### Tier 5 built (2026-10-22)

- **29a, 29b**: `readComments`, `readCaptions`, `withCaptions` and
  `firstPass` in `server/core/lineBank.ts`; `importBank` in
  `server/pipeline/lineBank.ts` (`POST /line-bank/import`, free); the
  `bank_lines` table (migration 0018); imports kept in the
  `line_bank_imports` setting with their drop counts. The word lists are
  `line_bank` in `config/content.yaml`.
- **29c, 29d**: the `bank_run` action: per batch of 30, `bank_tag:`
  (route `line_tagger`), `bank_write:` and `bank_review:` (routes
  `line_writer` and `line_reviewer`; all on Sonnet, switchable to Opus), chained with `parentIndex`
  and held in one quote; templates `line_bank_tags`, `line_bank_writer`,
  `line_bank_reviewer` in `config/templates.yaml`. The writer is told its
  own rules win over the product's hook standard (a 6 s clip has no later
  slides). Pass: all three scores at `pass_score` (8) or more, not setup,
  not meh.
- **29e, 29f**: `bankView` (`GET /line-bank`), the stance per character
  (`line_bank_stances`, from the voice card's who and point of view),
  `bank_use` and `bank_week` (route `line_voice`, template
  `line_bank_voice`), `weekPlan` (`GET /line-bank/week`); the drawer
  `src/studio/pages/post/LineBank.tsx`: Pick from the bank in a
  slideshow's Idea step and in the Caption step of a video post or batch,
  Write the week on the Launch plan card.
- **29g**: `setLineCall` (`PUT /line-bank/lines/:id/call`), the latest
  calls as examples in the writer and the reviewer; Results' Source truth
  (`truth` in `server/core/results.ts`, from `sourcesFor`).
- **29h**: on the owner's sheet: 5,350 comments with words (25 empty),
  2,208 kept by the first pass (1,636 with 0 or 1 likes, 1,129 off the
  job search, 251 too short, 96 duplicates, 20 about the video, 10 not
  English); the full run quotes $5.82 (74 batches). The paid run itself
  waits on an Anthropic key in Settings and the production worker.

### Modal fix (owner, 2026-10-22)

- Every modal has one padding on all four sides, set on `.st-modal` (22 px,
  16 px on a phone); a modal's contents add none of their own. Its buttons
  sit in `.st-modal-actions`: inside the modal, at the right, wrapping on a
  phone.
- New character: nothing is picked to start and the button waits ("Pick
  one first"); the picked card has the accent border, its fill and a check,
  under the mouse too (the hover style no longer hides the pick); the arrow
  keys move the pick like any radio group; the button names the next step,
  "Start from a concept" for a person and "Set up the persona" for a
  faceless account.
- `e2e/editor/modals.spec.ts` opens every modal a person reaches (New
  character, Import a character file, Edit card, Voice, Delete character,
  a price's Details) at desktop and phone width and checks the padding,
  that left and right match, and that nothing sticks out.

## 37. Weeks: the bulk planner, and finished posts out to Google Drive (owner, 2026-10-22, night)

Goal: Eric and Claude plan a character's week in chat; Claude writes a plan
CSV to `docs/PLAN-CSV-SPEC.md`; the Studio fills it, makes about 100 posts
at about 85% ready, Eric reviews them, and the finished posts land in
Google Drive for his posting software. One flow, one page. Same standing
rules as section 35 (R1 to R5); defaults, never locks; no new paid
provider.

Applies to: every character (person or faceless), every account and every
product (rule two). The fill rules, the blends, the line lint and the
Drive layout are data (`config/content.yaml`, `weeks`), never code paths
for one character. Callie, Dani, Solei and Doug only appear as the
default blends, which the owner edits on the Accounts page.

**Navigation (the owner's call, this build: it updates section 2 and rule
R5).** The sidebar is: New post, then **Characters, Weeks, Posts, Line
bank, Library, Accounts, Settings**, then Guide. Posts stays home
(`/studio`). Weeks (`/studio/weeks`) replaces the Launch plan card on Posts
home: its import, its Replace or Add rule, its queue of ten and its daily
cap logic move there unchanged. The line bank gets its own page
(`/studio/line-bank`); the drawer in the Idea and Caption steps stays.
Accounts (`/studio/accounts`) replaces the Accounts card on Posts home.
Everything that makes one post still happens in the post workspace and
its drawers (R5): a cell on the Weeks grid opens that post.

| # | Piece | Where | How it works | Clicks |
|---|---|---|---|---|
| 1 | Sidebar | Every page | Characters, Weeks, Posts, Line bank, Library, Accounts, Settings (and Guide). Posts home loses the Launch plan and Accounts cards; Import on Posts home sends a plan CSV to Weeks | 1 |
| 2 | Weeks grid | Weeks | Accounts down, the 7 days of the week across (Monday first), each account's slots in its cells. A cell shows the slot, the post type, the first words of its line and its state (no line, flagged, ready to make, making, made, approved, killed, in Drive). The week picker lists every week with plan posts. Click a cell: the post opens in the normal workspace, with its drawers. A row on a phone scrolls inside its card (3.11) | 1 |
| 2b | The step bar | Top of Weeks | **Import > Fill > Check > Make > Review > Send to Drive**. The current step (the first one with work left) is lit with its one main button; any step can be opened. Each step's panel ends on a line that names the next step | 0 |
| 3 | Accounts page | Accounts | One row per account: Account, Device ID, character (person or faceless, shown), platform (TikTok, Instagram, YouTube), slots per day, life/job blend (life %; defaults by character name: Callie 70/30, Dani 80/20, Solei 90/10, Doug 0/100; else 50/50; editable, a default), product, tracked link, promo code, signups. Placeholders are fine (DEVICE-01, callie_ig_01). **Rename** an account: every post, bank line, Drive row and plan row that carries it follows | 1 per edit |
| 4 | The plan CSV spec | `docs/PLAN-CSV-SPEC.md`; Weeks: **Download template**, **Read the spec** | Every column, required or optional, allowed values, one example row per post type (slideshow, clip, photo, faceless). Required: row_id, account, date, slot. The template is made from the same column list the reader uses (`WEEK_COLUMNS`), and a test fails if the doc and the list disagree | 1 |
| 5 | Import | Weeks > Import | Upload or paste; Preview (free) by account and day, each row's errors and notes; tick rows (all ticked); rows whose row_id matches posts already made ask **Replace them** or **Add as new posts**, never silent (0b). Rows land as drafts in the grid. The last line names the next step ("98 drafts made. Next: Fill 61 empty slots, free") | 2 to 3 |
| 6 | Line bank fields | Line bank page | Every line: text, source (comment, caption, transcript, inventory, competitor, claude), source likes, pain, emotion (infuriated, angry, sad, crying, frustrated), format, voice fit (first-person, secondhand, both), life or job, used on (account, date). **Tag the bank** (priced, one Sonnet call per 30 lines, the price on the button): the lines that passed get life or job, and their pain, emotion, format and voice fit checked again | 1 |
| 7 | Import lines | Line bank page | A CSV with those columns (text required; the rest optional, read by name). Lines land written and passed (they were written by people or by Claude in chat); near-matches of a line already in the bank or in the same file (same words after case and punctuation, or 80% of the words shared) are dropped and counted | 2 |
| 8 | Filters, download | Line bank page | Pain, emotion, format, voice fit, life or job, unused (chips); Download as CSV (the shown lines, every field) | 1 per filter |
| 9 | Fill empty slots | Weeks > Fill | Free and random per slot, under the rules: (a) no pain repeats within that account's last 7 posts; (b) a line is never used on two accounts, ever; (c) emotion and format rotate, never 3 of the same in a row on an account; (d) voice fit matches (first-person characters get first-person or both; the others secondhand or both, unless the row's voice_fit says); (e) the account's blend sets each empty slot to life or job (a row's life_or_job wins); a life slot with no life line left stays empty and is flagged; never a job line in a life slot. The draw shows before anything is saved: each slot with its line, pain, emotion and format, **Redraw** per slot or **Redraw all**, **Lock** per slot (a locked slot keeps its line on every redraw), then **Save the draw** | 2+ |
| 10 | Fit to voice | Weeks > Fill, after a saved draw | Priced (Sonnet, one call per character, the price on the button): each drawn line rewritten in the character's voice card and fitted to its row's story_beat, keeping the original truth and detail (numbers, times, the petty reason), starting at 70 (the first words are the hit). Shows before and after with the 9-point line lint on each; **Use these** applies only after Eric's OK (per line or all) | 2 |
| 11 | The line drives the visual | Weeks > Fill (on Save the draw, free) | Each filled post with no scene gets one drafted by code: a faceless post a place from its character's place bank (words of the line and the story beat first, else the least used place), its motion line as the video prompt and a music bed from the sound bank; a person post its story beat with the character's own settings as the scene, a video prompt from the line, and a sound suggestion. Never an empty Video step; every field stays editable | 0 |
| 12 | Check | Weeks > Check | Free, before money: a person post with no outfit, no line, no scene, a line outside the product's claims sheet (SideStep's rules, on SideStep posts only), a life slot with a job line, the same line on two accounts. Bad rows are marked in the grid with the reason; the rest can run | 1 |
| 13 | Make the week | Weeks > Make | One total price, one click: stills first, then the video where the row asks (a clip, a faceless post, a row with a video_prompt), each video chained to its own still (it starts when that still lands, on the same quote). Ten posts at a time, each group checked against the daily cap when its turn comes; a group over the cap waits and goes on after midnight UTC (the cap-resume cron). Progress is one line per post | 1 |
| 14 | Review | Weeks > Review | A grid of finished posts with **Approve**, **Kill** and **Redo** (priced, the redo's price on it). Keyboard: A, K, R, arrows. "84 of 100 approved" on top. Approve is Approve for posting (section 33); every keep or kill is logged (Settings > Rules, Your calls on posts) | 1 per post |
| 15 | Google Drive | Settings > General > Google Drive | **Connect Google Drive** (Google's own sign-in, the drive.file scope: the Studio sees only the folders and files it made), then **pick a root folder** (make one, or pick one the Studio made). The OAuth client is Eric's own (Google Cloud, the same project as his AI Studio key), its ID and secret pasted in Settings > Provider keys and sealed in the vault | 2 |
| 16 | Send to Drive | Weeks > Send to Drive | Free, on the worker: approved posts to `ROOT / CHARACTER / week of YYYY-MM-DD /`, files named `date_slot_account_rowid.mp4` (`.jpg` a photo, `.zip` a slideshow), plus a manifest Google Sheet and a CSV in the same folder, one row per post: Device ID, Account (first two), file_name, caption, hashtags, date, slot, sound_name, ad_label. Sending again replaces the same files and rows, never duplicates. Each caption carries the AI label line (the character file's disclosure; the export's rule) | 1 |
| 17 | Sound | The editor's Add media, the faceless Sound drawer | Any uploaded mp3 (music, ambience, voiceover clips, voice lines) can go on a post: every sound is in the editor's media, and the faceless Sound drawer has Upload. No gate | 1 |
| 18 | Places | A faceless character's file | Every place carries a motion line (the video prompt) and, when it has one, the Higgsfield still it was made from (`still_job_id`, pulled free when a post uses it). A place with no motion gets one drafted by code from its line. **Import places (CSV)**: place_id, scene, motion, still_job_id. Doug's 100 places from `doug-places.csv` | 1 |
| 19 | Line Engine fields | The plan CSV | lane, line_format, feeling, topic ride along on the post (its Plan line, post.json) | 0 |
| 20 | Finish a half-built character | Any character's page | **Import a character file** (the file plus its REF images) finishes it: the setup steps are skipped and the character opens at its sheet or file. A character whose sheet is complete opens there whatever step it was left on (Solei was stuck at Inspiration with all 12 refs approved) | 2 |
| 21 | WaveSpeed and Kie.ai | The report only | Research: which models each offers, real prices, reference image support. Not wired in | 0 |

Where each part lives: the pure parts in `server/core/weeks.ts` (the
columns, the reader, the checks, the draw, the scene draft, the 9-point
line lint), storage and jobs in `server/pipeline/weeks.ts` and
`server/pipeline/drive.ts` (Drive), the page in `src/studio/pages/Weeks.tsx`,
the line bank page in `src/studio/pages/LineBankPage.tsx`, the accounts page
in `src/studio/pages/Accounts.tsx`.

**The 9-point line lint** (free, warnings only, each a default in Settings >
Rules): (1) the hit in the first words, no setup opening; (2) a clear
emotion; (3) 12 words or fewer; (4) one specific detail (a number, a time,
a day, an amount or a named thing); (5) no long dashes; (6) not opening on
"You"; (7) no hype words; (8) no hashtag or product name on screen; (9) no
should, must or need to aimed at the viewer.

Every paid step shows its price and model and waits for the click: Tag the
bank, Fit to voice, Make the week, Redo. Free and saying so: Import,
Preview, Fill and its draws, the scene drafts, Check, Review's Approve and
Kill, Send to Drive. Everything runs on the API path as well as the plan.

### Built (2026-10-22, night)

- **1, 2**: the sidebar in the owner's order (`src/studio/Shell.tsx`); `/studio/weeks`
  (`src/studio/pages/Weeks.tsx`): the week picker, Download template and Read the
  spec (the spec read from `docs/PLAN-CSV-SPEC.md` in a drawer), the step bar
  (`currentStep` in `server/core/weeks.ts`), the grid (`weekView` in
  `server/pipeline/weeks.ts`). Posts home lost the Launch plan and Accounts cards;
  Import on Posts home sends a week's plan, an older launch plan or a faceless
  plan to Weeks (`csvKind` reads `week`). The older launch plan card is unchanged,
  on Weeks > Import > An older launch plan file?.
- **3**: `social_accounts` gained `device_id`, `platform`, `slots_per_day`,
  `life_share` (migration 0019); the blend defaults are `weeks.blend_defaults` in
  `config/content.yaml` (by the character's name or its first word);
  `renameSocialAccount` moves posts, bank lines and Drive manifest rows.
- **4, 5**: `WEEK_COLUMNS`, `readWeek`, `checkWeekRow`, `templateCsv`; a test holds
  the spec and the list together. `previewWeek`, `importWeek` (Replace or Add).
- **6 to 8**: `bank_lines` gained `source`, `life_or_job`, `used_date`; the page
  `src/studio/pages/LineBankPage.tsx` (`bankPage`, `bankCsv`, `importLines` with
  `nearDuplicate`, the `bank_retag` action and its template `line_bank_retag`).
- **9 to 11**: `drawLines` (rules a to e over a seeded random; 40 seeds in the
  tests), `drawWeek`, `saveFill`, `setLock`; `week_fit` (template `week_fit`,
  `applyFit`), `lineLint` (the 9 points; three new rule switches
  `lint-line-words`, `lint-line-detail`, `lint-line-tag`); `draftVisual` and
  `draftVisuals` (a place and its motion for a faceless post, the story beat as
  the scene for a person post).
- **12**: `checkWeek` (flags kept on each post's `spec.week.check`).
- **13**: `week_make` (`buildWeekMake`): each post's still, then its video as a
  child job with `chainStart` that the still's hook starts from the new still
  (`activateChained` in `server/jobs/runner.ts`, called by the scene, drift lock
  and faceless still hooks; a still that fails cancels its video). Queue groups of
  ten under the daily cap, as Generate N posts.
- **14**: `setReview` (Approve is Approve for posting; a person clip's still and
  take are picked for its export), `reviewLog`; `week_redo` (old pictures to the
  Trash when it starts, never the redo's own).
- **15, 16**: `server/pipeline/drive.ts`: the owner's OAuth client in the vault
  (`google_oauth`), the drive.file sign-in, the refresh token sealed
  (`google_drive`), the root folder, the `drive_send` worker job (folders by
  character and week, files named by `driveName`, the manifest CSV and Sheet,
  replaced in place on a resend), `captionWithLabel` for the AI label line. Tests
  run against `server/testing/fakeDrive.ts`.
- **17**: every uploaded sound (voice lines too) in the editor's Add media; Upload
  an mp3 in the faceless Sound drawer.
- **18**: places carry `motion` and `stillJobId`; `importPlaces` (Import places on
  the faceless file); `draftMotion` for a place with none; a post whose place has
  a still pulls it free (`week_pull`). `docs/content/doug-places.csv` (100 places).
- **19**: lane, line_format, feeling, topic in the plan meta (`planMetaSchema`).
- **20**: `effectiveStage` in `server/api/views.ts` (a complete sheet opens at the
  file); a re-import of a character file onto a half-built character sets stage 5;
  Import a character file on a half-built character's page.
- **21**: `docs/studio/research-wavespeed-kie.md`.

## 38. Hover and focus on every control (owner, 2026-10-23)

Bug (Eric, Oct 22, a screenshot): New post in the left menu nearly
disappeared on hover, its dark text and icon on a dark fill. The cause: the
menu item's hover fill (`.st-nav-item:hover`) replaced New post's accent
fill and kept its dark text. Applies to every page, every character, every
account and both themes.

**The rule.** Hover never lowers contrast. Text keeps at least 4.5:1
against the fill under it on hover, an icon alone at least 3:1. Hover only
lightens or tints the fill, or adds a border; it never swaps a fill for a
darker one under dark text. Primary buttons (New post, Generate, Make the
week, Send to Drive, any `.st-btn.primary`) keep their accent fill on hover,
a little brighter (`--st-primary-hover`). Every control shows a focus ring
to the keyboard (`--st-focus`, `--st-ring`): the legacy pages' stylesheet
turns the browser's outline off on every button, so the Studio sets its
own on every button, link, tab, menu item, switch and focusable element.

**Tokens, never one-off colors.** Hover and focus colors live in the theme
tokens in `src/studio/studio.css`, per theme: `--st-hover`,
`--st-hover-soft`, `--st-hover-line`, `--st-hover-accent-line`,
`--st-primary-hover`, `--st-on-accent`, `--st-overlay-hover` (buttons over
a picture), `--st-focus`, `--st-ring`. Components use them.

**What was fixed (2026-10-23).**
- New post: keeps its gradient on hover (and while its menu is open).
- Primary buttons: never showed a focus ring (their own shadow hid it).
- No focus ring at all before: the menu items (Activity, New post), the
  post steps, the Weeks steps, chips (filters, Approve for posting, Room
  tone, TikTok, Reels, None), the Settings tabs (Models, Live, 3 days), the
  Results and Download day toggles, the cover's view button, Outline, the
  Guide's numbered pins.
- Help chips ("How this works") and the Guide's chips: hover tints the fill
  instead of filling it with the color under dark text (4.45:1 in light).
- The Guide's links in light theme: darkened toward the text color (3.96:1
  on white before).
- Delete on a Library tile in light theme: the red is darker in light
  (`--st-bad` #c62828; 2.83:1 before).
- OK buttons keep their green on hover; the over-picture buttons (viewer,
  tile and cover view) share one hover token.

**Test.** `e2e/editor/hover.spec.ts` hovers every kind of control on Weeks,
Posts home, four post workspaces (every step), Line bank, Characters, a
character, Accounts, Library, Settings (three tabs) and the Guide, in both
themes, reads the pixels at 2x and fails under 4.5:1 (3:1 for an icon), and
fails any control whose look does not change on keyboard focus. It failed
on the version before the fix (New post 1.06:1 on hover) and passes after.

## 39. Weeks: import from Google Sheets (owner, 2026-10-23)

Drive is connected on production (Settings, verified by Eric). The week's
plan can live in a Google Sheet instead of a CSV file: Claude or Eric edit
the sheet, the Studio reads it. Applies to every character, account and
product a plan names; nothing product-specific. Free: reading a sheet is
not a paid step.

1. **From Google Sheets** on Weeks > Import, next to Upload the plan CSV:
   pick a sheet from Drive (the newest first, a search box, the Plans
   folders on top) or paste its link. The sheet's first tab is read as
   CSV and goes through the same reader, spec (`docs/PLAN-CSV-SPEC.md`),
   pre-check, preview and Replace-or-Add rule as the CSV import. Each
   imported post keeps the sheet's id and a fingerprint of its row.
2. **Re-sync** on each linked sheet (Weeks > Import, Linked sheets) pulls
   the sheet's latest edits. A free preview first: new rows (added),
   changed rows on drafts with no pictures (drafted again), changed rows
   whose posts already have pictures (listed, never changed unless ticked:
   "Update these too, their pictures go to Trash"), rows gone from the
   sheet (listed, never deleted), unchanged rows (left alone). Apply does
   only what the preview showed.
3. **Line bank > Import lines** also takes a Google Sheet (a link or a
   pick), with the same dry run and near-match dropping.
4. **Drive layout, made on first use:** ROOT / Plans / CHARACTER / (week
   sheets), next to ROOT / CHARACTER / week of YYYY-MM-DD / (the output).
   Made when From Google Sheets first opens with a root folder set.
5. **Access.** Reading a sheet the Studio did not make needs Google's
   read-only Drive permission on top of drive.file. Settings > Google Drive
   says so and offers Reconnect (one consent screen); until then the
   picker shows the reason, never a silent empty list.

## 40. Kie.ai and WaveSpeed: more providers for the same models (owner, 2026-10-23)

Eric picked both by name (Oct 22) after the research in
`docs/studio/research-wavespeed-kie.md`. Higgsfield stays the default for
every model it runs until Eric picks another provider. Applies to every
character, account and product; nothing product-specific. R4: every paid
step shows its price for the provider picked and waits for the click; the
API path works for all of it.

**One table: step > model > provider** (`config/engines.yaml`, read by
`server/core/engines.ts`). Each step (still, edit, video, recreate stills,
recreate motion) lists its model families; each family lists the provider
refs that run it, the default first (the model the Studio already used, so
Higgsfield where it runs it). The ComfyUI build's engine lever adds a
provider (or a local engine) as one more ref in a family: nothing else
changes.

| Family | Providers (default first) |
|---|---|
| Nano Banana 2.1 | Higgsfield, Google AI Studio, Kie.ai, WaveSpeed |
| Seedream 4.5 edit | fal, Kie.ai, WaveSpeed |
| Kling 3.0 Pro | Higgsfield, Kie.ai, WaveSpeed |
| Kling 3.0 Standard | Higgsfield, Kie.ai, WaveSpeed |
| Seedance 1.5 Pro | Kie.ai, WaveSpeed (new: the cheapest video) |
| Wan 2.2 Animate replace | fal, Kie.ai, WaveSpeed |
| Kling 3.0 Motion Control | Higgsfield, fal, Kie.ai |

1. **Keys.** Settings > Provider keys gets Kie.ai and WaveSpeed (keys made
   in each dashboard, pasted here only, sealed in the vault). Each saved key
   has Test key (a free call) and shows its balance when the provider
   reports one (Kie: credits and dollars; WaveSpeed: dollars).
2. **Adapters** (`server/providers/kie.ts`, `wavespeed.ts`): submit, poll
   or webhook, the output fetched into our storage like every provider;
   reference images, start and end frames and the source clip passed as
   links where the model takes them. Kie: createTask, recordInfo, its own
   charge (creditsConsumed). WaveSpeed: POST /api/v3/{model}, the
   prediction's result.
3. **Price book.** Each provider's per-image and per-second list price, with
   the date it was checked (`checked:`), not confirmed until the first real
   run. Every price button prices the provider picked.
4. **Provider picker** (`ProviderPick`) on the still, edit, video and
   recreate steps: every provider that can run the model, its price side by
   side, the cheapest marked, "Add a key" when there is none. The pick is
   saved for the step (all characters) or for this character on this step
   (the character wins). Weeks > Make the week has "Provider for this run":
   each post uses it where it runs that post's model, else the post's own.
5. **Failures.** A run that fails or is refused says why and offers the
   next provider that runs the same model, with its price: "Try on Kie.ai,
   $0.03". Nothing switches or spends on its own; the offer is a priced
   button like any other.
6. **What was sent** names the provider on every output (Provider: Kie.ai).
7. **Tests** use fake provider servers (`server/testing/fakeProviders.ts`),
   never the real APIs. The one real still on each provider waits for Eric's
   keys and his click, and its real charge is checked against the price book.

## 41. ComfyUI on a remote workstation, and the engine lever (owner, 2026-10-23, night)

The brief is `docs/studio/briefs/2026-10-23-comfyui.md`. ComfyUI runs on a
friend's workstation (a big GPU, full-size models, no low-VRAM tricks). It
is one more provider in `config/engines.yaml`, next to Higgsfield, Google,
fal, Kie.ai and WaveSpeed. Applies to every character, account and
product; faceless characters use it for stills and video but never train a
LoRA. Built and tested against a mock ComfyUI (the machine is not
connected yet); `docs/COMFY.md` is how its owner connects it.

**How it connects (E1, items 1 to 3).** The machine never takes a call from
the Studio and opens no port. A small agent on it (`comfy/agent/agent.mjs`,
in the pinned image) calls out: it sends a heartbeat (GPU, VRAM, ComfyUI's
queue, the models it has, its environment hash), claims jobs, fetches each
job's inputs through short-lived storage links, runs the workflow on its own
ComfyUI (upload images, queue the prompt, websocket progress), puts the
outputs straight into our storage through short-lived links, and reports
done. Settings > Provider keys > ComfyUI: the agent token (made here, shown
once, kept as a hash; the agent sends it on every call) and, optionally,
the machine's private tunnel address (Tailscale or Cloudflare Tunnel) for
reaching it by hand. Test connection asks the agent to answer on its next
heartbeat (within a few seconds) and shows the answer.

**The queue (E1, E2, E4, E6).** One persistent queue in Postgres
(`comfy_tasks`): the API and the Railway worker validate and enqueue, the
agent pulls. Each task has an idempotency key (the post's row or the run,
the step and the attempt): submitting the same run twice makes one task,
reporting done twice stores the outputs once. A claimed task holds a lease;
progress renews it. A lease that runs out (the agent died, the machine
lost power) is reclaimed and retried once as attempt 2; a second loss, or a
hard timeout, puts it in Failed, which Settings lists with Retry (priced as
$0 API, a click). An out-of-memory failure is retried once at batch 1.
Claims prefer the model family already loaded (Krea 2, then Qwen, then
Wan), so models are not swapped back and forth; the agent reports a family
ready only after its first job of that family loads.

**Frozen environment (E3).** `comfy/env/`: the Dockerfile (a pinned base
image with CUDA, ComfyUI at a commit, Python packages at versions, Node for
the agent), `nodes.lock.json` (every custom node at a commit hash),
`models.json` (each model file, its folder, size and sha256) and
`environment.lock.json` (the three together). The environment hash is the
sha256 of that lock. The agent checks the files on start and reports the
hash; the Studio refuses to hand it jobs when it differs from the one this
Studio expects, and Settings says which and what to do.

**Workflows (items 4, 5).** API-format JSON in `comfy/workflows/`, each with
a manifest: name, version, step (still, edit, i2v, recreate), model family,
the model files it needs, inputs (prompt, negative, seed, refs, start
image, clip, LoRA and its strength, width, height, frames, fps) bound to
node fields, outputs, the expected time and a hard timeout. Shipped:
Qwen-Image-Edit-2511 with the character's LoRA and refs (still and edit),
Krea 2 Turbo with a LoRA trained on Krea 2 Raw (still, text only; marked
"license check" until Eric confirms commercial use), Wan 2.2 I2V (video),
Wan 2.2 Animate replace and mix (recreate: replace keeps the clip's place;
mix keeps the still's place with the clip's motion). Settings > ComfyUI >
Workflows: upload a workflow and its manifest (checked: every bound node
and field exists), no rebuild. Each is marked not confirmed until its first
real run on the machine.

**Character LoRAs (items 6, 7).** Train LoRA on a person character's page:
the base (Qwen or Krea 2 Raw), REF-00 to REF-11 (REF-12 and 13 when
present) and the approved stills ticked, a trigger word, the estimated time
from the machine's past runs. It runs on the machine as a training task; the
LoRA file stays on the machine, the Studio keeps its version, trigger word,
file name and checksum. Retrain makes v2; any version can be the active one.
Faceless characters have no Train LoRA.

**Our rules inside the pipeline (item 8).** No provider filter here, so
before a task is queued: the character is 21 or older, the prompt passes
the explicit-content check, a person shot carries the REALISM block and no
banned smoothing word (the same runner checks as every provider), a source
clip passes the adult check (Recreate's own gate), and export adds the AI
label as everywhere.

**Cost and safety (items 9 to 11).** Every run waits for the click, priced
"$0 API, about N min on ComfyUI" (N from the machine's own past times per
workflow, else the manifest's). Machine offline (no heartbeat for 2
minutes): the step says so (the provider picker marks ComfyUI offline, the
price button says the machine is offline) and offers the other providers
of that step with their prices; a run already queued waits, and a batch
that loses the machine mid-run shows an alert on the status card. Never a
silent switch. The machine owner's own work comes first: max jobs at once
(default 1) and Pause the queue (in Settings, or on the machine with
`comfy-agent pause`).

**The bake-off (item 12).** Review > Compare providers: 10 of Callie's real
prompts (her latest scene stills) on Nano Banana 2.1 (Kie.ai), Qwen and
Krea 2 Turbo (her LoRAs), one priced click ($0.30 on Kie.ai, $0 on
ComfyUI), side by side with each still's face score against REF-00 and its
skin texture score (the same Laplacian check as Realism rule 5; higher is
more real skin). Use as default sets that provider for stills; nothing
changes until he picks.

**Docs (items 13, 14).** `docs/COMFY.md` for the machine owner, step by
step. `docs/DRIVE-OUTPUT.md`: the Send to Drive layout and manifest as a
format any install of the posting software reads; nothing in it is tied to
one person (each install sets its own Drive root, accounts and devices).

**The engine lever (item 15).** One switch at the top of Settings and on
Weeks > Make the week: Engine = Higgsfield subscription, Higgsfield API,
Kie.ai, WaveSpeed or ComfyUI. `config/engines.yaml` gains a table of each
engine's model per step; the lever routes every step through it: the same
model on that provider where it runs it, else the engine's model for the
step, else (the engine cannot do the step) the step's own model with a
warning on the price naming why and the price. Prices follow the engine's
units (plan credits, dollars, machine minutes). Picks per step and per
character still win over the lever; the engine of every run is in What was
sent.

## 42. The overnight stack: $0 post types, three platforms in Drive, results by blend, polish (owner, 2026-10-23, night)

The brief is `docs/studio/briefs/2026-10-23-overnight-stack.md`. Every item
applies to every character, account and product; nothing here spends money.

**A. Text only.** A Weeks and plan CSV `post_type` of `text_only`: the line
on a plain background (black by default; `bg_color` takes any hex color),
9:16, 6 to 8 seconds by the line's length. `text_style`: `centered` (white,
centered, the default), `two_beat` (the setup, then the punch line appears
at 2 s; the line splits on " / " or after its first sentence) or `dialogue`
("Her: ... / Me: ..." stacked, each speaker's line on its own). `bg_motion`
`zoom` adds a slow push-in. A dimmed still behind the text: `place_id` names
a place in the character's place bank whose still is already in the
Studio ($0); no still means the plain background. Sound: the row's
`sound_name` as the note, or an mp3 uploaded on the post's Sound row. It is
made on the worker for free: Make the week shows "Render N $0 posts" next to
the priced button (a click, no quote). Fill, Check, Review and Send to Drive
treat it like any post (an .mp4).

**B. Photo dump.** `post_type` `photo_dump`: 5 or 6 of the character's
approved stills (the newest, or the ones the row names in `still_ids`), about
1 s each, one line of text over them, 6 s, 9:16, cut (never crossfaded). No
generation; rendered free like A. Fewer than 5 approved stills is a flag on
Check that says how many there are.

**C. Three platforms in Drive.** A finished slideshow's Three platforms set
(the Instagram carousel, the reel, the Shorts copy; section 36) goes to Drive
with the post when it exists: the carousel as a zip and the two videos, each
with its own manifest row (`file_name` ending `_ig.zip`, `_reel.mp4`,
`_shorts.mp4`, the same caption, and a `platform` column at the end:
tiktok, instagram, reels or shorts).

**D. Results by blend.** The Results card gains two splits: follows per post
by account, and by life vs job (the plan row's `life_or_job`), so the blend
test can be called. Entry stays as it is (typed on the card, or the results
CSV). Every clip export's sound note: `sound_name` and `sound_type` on the
review card and in post.json (`sound: { name, type, note: "add this sound in
the app" }`).

**E. Free LATER items.** Approve all, with every picture on screen, in the
batch review; Generate the rest of this day on the plan list (priced, waits
for the click); Posts home progress grouped by post; the viewer's next and
previous across Trash and Posts home; the post.json gaps.

**F. Polish.** Help chips never overlap a title, priced buttons fit their
card, at desktop and phone width (a browser test measures both); Guide
screenshots with numbered callouts for Weeks, Accounts, Line bank, From
Google Sheets, Providers and ComfyUI.
