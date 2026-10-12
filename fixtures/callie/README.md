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

- `appendix-a.json`: her card and marks transcribed from SPEC.md Appendix A.
  Used by tests until `character-callie.md` is uploaded; then the importer
  test checks that both agree.
- `perceptions/*.json`: recorded inspector answers (the structured result of
  the QA perception call) for specific sheet images. They let the QA logic
  be tested without paid calls. Once the images are uploaded, the live
  check (`npm run qa:callie`, run only after its quote is approved)
  compares real answers with these.
