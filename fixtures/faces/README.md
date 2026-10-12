# Face fixtures

Small crops used by `server/qa/faces.test.ts` to check the face matcher
with the real models:

| File | Who |
|---|---|
| `person-a-1.jpg` | Person A, studio portrait |
| `person-a-2.jpg` | Person A, a different photo (other light, other setting) |
| `person-b.jpg` | Person B, a different person |

All three are AI-generated demo characters that shipped with the
original app (Marcus and an influencer example), cropped and
downscaled. The full demo images have since been removed from `public/`;
these small crops stay as test data. They are not real people.

The model tests skip when the models are missing. Fetch them with
`npm run models`.
