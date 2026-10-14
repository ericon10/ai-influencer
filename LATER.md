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

- The owner's call on the OpenCut engine (DECISIONS G23): a classic fork
  in an iframe at /editor, the rewrite's Editor API when it ships, or the
  Studio editor as it is.
- Snap to shot edges and to the playhead when dragging in Fine-tune.
- A waveform under the Sound lane in Fine-tune, and the clip's own sound
  as a lane when a clone keeps it.
- Keyboard nudge (arrow keys move the playhead one frame) and J/K/L
  playback in Fine-tune.
- Preview Room tone in the browser (today it is mixed only in the export).
- Batches: a progress line per batch on Posts home ("12 of 50 done"), and
  a batch Fine-tune that edits the template every video shares.

