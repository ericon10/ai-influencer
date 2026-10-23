# The plan CSV: one week of posts (spec v1, 2026-10-22)

The single source of truth for the file Claude writes in chat and the
Studio reads on **Weeks > Import** (UX-PLAN.md section 37). Write to this
spec exactly. The Studio's reader and its **Download template** button use
the same column list (`WEEK_COLUMNS` in `server/core/weeks.ts`), and a test
fails if this page and that list disagree.

## The file

- UTF-8, comma separated, the first line is the header.
- Columns are read by name, in any order. Unknown columns are named in the
  preview and ignored.
- One row per post. Quote a cell that holds a comma, a quote or a line
  break ("like ""this"""), as any spreadsheet does.
- No em or en dashes anywhere (the Studio's rule): use a comma or a period.
- 300 rows and 400 KB at most per file. A week of about 100 posts fits.
- The launch plan's older names still read: `hook` as `line`, `format` as
  `post_type`.
- A Google Sheet works the same way (Weeks > Import > From Google Sheets):
  its first tab, with the same header, is read as this CSV. Keep a week's
  sheet in ROOT / Plans / CHARACTER / in Drive; Re-sync pulls later edits
  (a post that already has pictures changes only when ticked).

## Required columns

| Column | Required | Allowed values | What it does |
|---|---|---|---|
| `row_id` | required | Any short id, unique in the file (20 characters at most) | The row. Importing a file again with the same row_id asks **Replace them** or **Add as new posts**, never silent. |
| `account` | required | An account on the Accounts page; a new name is added there | Where the post goes. Placeholders are fine (`callie_ig_01`). |
| `date` | required | `YYYY-MM-DD` | The day it posts. The week is the Monday to Sunday it falls in. |
| `slot` | required | `1` to the account's slots per day (`AM`, `Daily`, `PM` read as 1, 2, 3) | The slot that day, in posting order. A slot past the account's slots per day still imports, with a note. |

## Optional columns

| Column | Required | Allowed values | What it does |
|---|---|---|---|
| `device_id` | optional | Any text, e.g. `DEVICE-01` | The phone it posts from. Blank: the account's Device ID on the Accounts page. |
| `character` | optional | A character's name | Blank: the account's character. |
| `post_type` | optional | `slideshow`, `clip`, `photo`, `faceless`, `text_only`, `photo_dump` | Blank: `faceless` on a faceless account, `clip` otherwise. `text_only` (the line on a plain background, 6 to 8 s) and `photo_dump` (5 or 6 approved stills, about 1 s each, one line, 6 s) are made free on the worker: no generation, $0. |
| `life_or_job` | optional | `life`, `job` | Blank: Fill picks one so the account keeps its life/job blend. |
| `story_beat` | optional | Free text | What is happening in her week that day. Fit to voice fits the line to it; the scene is drafted from it. |
| `line_id` | optional | A line bank id (`bl_...`) | The bank line for this post. Blank with no `line`: Fill draws one. |
| `line` | optional | Free text, 12 words or fewer | The on-screen line as written (slide 1 of a slideshow). Wins over `line_id`. |
| `voice_fit` | optional | `first`, `secondhand`, `both` | How the line is told. Blank: the character's way (first person for a faceless character or one out of work, secondhand otherwise). |
| `caption` | optional | Free text | The posting caption. The AI label line is added when it is sent. |
| `hashtags` | optional | Words with or without `#`, spaces or commas between | Five at most is the default. |
| `scene` | optional | Free text | What the still shows. Blank: drafted from the story beat or the place bank when the line is filled. |
| `place_id` | optional | A place id in a faceless character's place bank (e.g. `IS015`) | Faceless only: that place's scene, motion line and still. |
| `outfit` | optional | Free text | A person post needs one before Make (Check flags it). |
| `light` | optional | A light preset or free words | |
| `clip_action` | optional | Free text | What happens in the clip (a person clip). |
| `video_prompt` | optional | Free text | The video prompt as written. A row with one gets a video in Make, whatever its type. |
| `sound_name` | optional | Free text | The sound to add in the app (in the manifest). |
| `sound_type` | optional | `music`, `voiceover`, `original` | |
| `voiceover_clip` | optional | Free text | The voiceover's search words. |
| `product` | optional | A product's name, or blank | The post's product (its rules and claims). A name not in Products is an error in the preview. |
| `ad` | optional | `yes`, `no` | An ad for its product (#ad, "Ad:" first in the caption). |
| `notes` | optional | Free text | Kept on the post. |
| `lane` | optional | Free text | Line Engine field, kept on the post and in post.json. |
| `line_format` | optional | Free text | Line Engine field. |
| `feeling` | optional | Free text | Line Engine field. |
| `topic` | optional | Free text | Line Engine field. |
| `still_job_id` | optional | A Higgsfield job id | Faceless only: that still, pulled free, instead of making one. |
| `new_still` | optional | yes, no | Faceless only: yes makes a new still even when the place has one. Blank: the place's still is reused at $0 when it has one. |
| `slide_2` | optional | Free text | Slideshow only: slides 2 to 6 (slide 1 is the line). |
| `slide_3` | optional | Free text | Slideshow only. |
| `slide_4` | optional | Free text | Slideshow only. |
| `slide_5` | optional | Free text | Slideshow only. |
| `slide_6` | optional | Free text | Slideshow only. |
| `slide_1_image` | optional | Free text | Slideshow only: each slide's own image line. |
| `slide_2_image` | optional | Free text | Slideshow only. |
| `slide_3_image` | optional | Free text | Slideshow only. |
| `slide_4_image` | optional | Free text | Slideshow only. |
| `slide_5_image` | optional | Free text | Slideshow only. |
| `slide_6_image` | optional | Free text | Slideshow only. |
| `bg_color` | optional | A hex color, e.g. `#000000` | `text_only`: the background. Blank: black. |
| `text_style` | optional | `centered`, `two_beat`, `dialogue` | `text_only`: centered white (default); `two_beat`: the setup, then the punch line appears at 2 s (split the line with ` / `, else after its first sentence); `dialogue`: `Her: ... / Me: ...`, each speaker on its own line. |
| `bg_motion` | optional | `none`, `zoom` | `text_only` and `photo_dump`: `zoom` adds a slow push-in. |
| `still_ids` | optional | Approved still ids (`cand_...`), spaces or commas between | `photo_dump`: the 5 or 6 stills to use, in order. Blank: her newest approved stills. |

## What each post type needs to be ready

| post_type | Becomes | Needs before Make (Check flags what is missing) | Make makes |
|---|---|---|---|
| `slideshow` | A slideshow: the line on slide 1, `slide_2` to `slide_6` after it | A line, a scene or slide image lines, an outfit (a person's slideshow) | A still for every photo slide |
| `clip` | A video post | A line, a scene, an outfit | The opening still, then the video from it |
| `photo` | A one-slide slideshow (one 1080 x 1920 picture) | A line, a scene, an outfit | The still |
| `faceless` | A faceless video post (no person in frame) | A line, a scene or a `place_id` | The still (or the place's own still), then the video from it |

A row with a `video_prompt` gets a video too, whatever its type.

## Example rows (one per post type)

The template (**Download template** on Weeks) has these four rows under the
header. Real ids in place of `bl_example` and the dates of the week.

```csv
row_id,account,date,slot,post_type,life_or_job,story_beat,line,caption,hashtags,outfit,slide_2,slide_3,slide_4,slide_5,slide_6,slide_1_image
C001,callie_tt_01,2026-10-26,1,slideshow,job,Monday: her roommate got a rejection email at 7am,my roommate got rejected at 7:02am. before coffee,she said she is fine,jobsearch roommate,"oversized gray hoodie, black leggings",she read it out loud like a eulogy,"the email said ""we went another direction""",there was no direction,she made pancakes anyway,we ate them in silence,"a phone on a messy kitchen counter next to a coffee maker, morning light"
```

```csv
row_id,account,date,slot,post_type,life_or_job,story_beat,line,outfit,scene,clip_action,sound_name,sound_type
C002,callie_tt_01,2026-10-26,2,clip,life,Monday night: laundry day goes wrong,the dryer ate my one good sweater. i am 26,"faded band tee, plaid pajama pants","a small laundromat at night, fluorescent light",she pulls a tiny shrunken sweater out of the dryer and holds it up,sad violin,music
```

```csv
row_id,account,date,slot,post_type,line_id,caption,outfit,scene
C003,callie_ig_01,2026-10-27,1,photo,bl_example,tuesday,"cream knit sweater, jeans","sitting on the floor of her bedroom against the bed, laptop open"
```

```csv
row_id,account,date,slot,post_type,story_beat,place_id,video_prompt,sound_name,sound_type,caption
D001,doug_tt_01,2026-10-26,1,faceless,the unemployment portal is down again,IS015,"Rain falls, the open mailbox door sways a little in the wind. 6 seconds, 9:16.",sad piano,music,day 41
```

## What the Studio does with the file

1. **Import** (free): the preview by account and day, each row's errors and
   notes. Rows matching posts already made ask Replace or Add. Rows land as
   drafts on the Weeks grid.
2. **Fill** (free): every post with no line gets one drawn from the line
   bank under the rules (no pain twice in an account's last 7 posts; a line
   on one account only, ever; emotion and format rotate, never 3 alike in a
   row; the voice fits; the account's life/job blend, never a job line in a
   life slot). Then **Fit to voice** (priced) puts each in the character's
   voice and fits it to its `story_beat`. A filled post with no scene gets
   one drafted from its line.
3. **Check** (free), **Make the week** (one price), **Review**, **Send to
   Drive**: see the Guide, Weeks.

## Writing a good week (Claude's checklist)

- Every `row_id` unique; every `date` in the same Monday to Sunday week.
- Slots 1 to the account's slots per day, no gaps.
- `story_beat` on every row: one plain sentence of what happens that day.
- Leave `line` and `line_id` blank to have the Studio draw from the bank;
  write `line` only when the line is already decided.
- A person post: an `outfit` and a `scene` (or `slide_N_image` lines).
- A faceless post: a `place_id` from the character's place bank, or a
  `scene` with no person, no body part and nothing that carries text.
- Lines: the hit in the first words, a clear emotion, 12 words or fewer,
  one specific detail, no hashtags or product name, no dashes.
