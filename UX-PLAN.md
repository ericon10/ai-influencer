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
                             │  5 Finish      preview > Export or Fine-tune          │   │  notify, R7) │
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
| **Library** | `/studio/library` | Browse everything made: tabs Stills, Clips, B-roll, Posts; filter by character and product; download; "Use in a new post"; upload B-roll and clips | My library |
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
4. The rest of Phase 3 (chaining, sound bed, rough cut), each fitted into
   a step of this plan first.
