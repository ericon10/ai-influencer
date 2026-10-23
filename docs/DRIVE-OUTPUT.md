# Drive output format (Send to Drive)

The files Weeks > Send to Drive writes, as a format any install of the
posting software can read. Nothing in it is tied to one person: each install
(Eric's, or a fork on another machine) sets its own Drive root, accounts and
Device IDs in its own Settings, and writes the same layout and the same
manifest.

## Where things go

```
<Drive root>/                      Settings > General > Google Drive (each install picks its own)
  <Character name>/                one folder per character ("No character" for posts with none)
    week of <YYYY-MM-DD>/          the week's Monday (config/content.yaml weeks.drive.week_folder)
      <date>_<slot>_<account>_<row_id>.mp4    a video post
      <date>_<slot>_<account>_<row_id>.zip    a slideshow (the slides, numbered, inside)
      <date>_<slot>_<account>_<row_id>.jpg    a single photo post
      manifest <YYYY-MM-DD>.csv    one row a post, in posting order
      manifest <YYYY-MM-DD>        the same rows as a Google Sheet
```

File names: every character outside `A-Z a-z 0-9 . _ -` becomes `-`. A post
sent again replaces its own file in the same folder (the same file id), so
nothing is posted twice from a stale copy.

## The manifest

A CSV with a header row, UTF-8, comma-separated, double quotes around a
value with a comma, a quote or a line break (a quote inside is doubled).
Columns, always in this order, Device ID and Account first:

| Column | What it holds |
|---|---|
| `Device ID` | The phone that posts it. From the plan row (`device_id`), else the account's Device ID on the Accounts page. Blank when neither is set. |
| `Account` | The account handle or tag the post goes out on, as on the Accounts page. |
| `file_name` | The file in this folder, exactly. |
| `caption` | The caption as it posts, with the AI label line at the end (the character's disclosure) unless the caption already carries it. Line breaks kept. |
| `hashtags` | Space-separated, each with one `#`. |
| `date` | The posting day, `YYYY-MM-DD`. |
| `slot` | The slot in the day (1, 2, 3...), as the plan has it. |
| `sound_name` | The sound to add in the app, free text; blank for none. |
| `ad_label` | `Ad` when the post is an ad for its product (the #ad switch), else blank. |
| `platform` | `tiktok` for the post's own file. A slideshow's three-platform set adds rows of its own: `instagram` (the carousel as a zip, `..._ig.zip`), `reels` (`..._reel.mp4`) and `shorts` (`..._shorts.mp4`), with the same caption. |

Rules a reader can rely on:

- One row per file in the folder; the manifest is rewritten in full on every
  send, so it always matches the folder.
- Rows are in posting order: date, then slot.
- Every post is labeled as AI-generated (a fixed rule): the label is in the
  caption column, never only in the file.
- Columns are only ever added at the end; a reader should read by header
  name, not position, after `Account`.

## Setting it up on another install

1. Settings > General > Google Drive: Connect with that install's own Google
   sign-in and its own OAuth client (CLIENT_ID:CLIENT_SECRET in Provider
   keys, Google Drive).
2. Pick or make the root folder.
3. Accounts page: each account's handle and Device ID.
4. Weeks > Send to Drive writes the layout above.
