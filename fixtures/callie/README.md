# Callie fixtures (acceptance test: "Rebuild Callie")

Callie is test data, not app logic. Nothing in `server/` or `src/` refers to
her by name.

## Files the owner uploads

| File | What it is |
| --- | --- |
| `character-callie.md` | Her character file (source of truth) |
| `REF-00.png` to `REF-11.png` | The 12 approved sheet images |
| `REF-04-mirrored.png` | Negative case: right profile with the ear cuff on the wrong (right) ear |

Any common image format works (`.png`, `.jpg`, `.webp`); keep the base names.

## Files in this folder today

- `character-callie.md`: her real character file, written by hand. The
  importer test reads it and checks every field, including that her marks
  match SPEC.md Appendix A, and that it re-exports without losing a section.
- `appendix-a.json`: her card and marks transcribed from SPEC.md Appendix A,
  kept as an independent cross-check.
- `perceptions/*.json`: recorded inspector answers (the structured result of
  the QA perception call) for specific sheet images. They let the QA logic
  be tested without paid calls.

## When the images arrive

Add them to her in the Studio (Sheet tab, "Import sheet images", or drop
the files on the Character file tab). Files named REF-00 to REF-11 become
approved sheet shots; the mirrored copy is never attached. Running QA on a
real image is a paid vision call, so the Studio shows its price first.
