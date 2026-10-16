# Post Writer Brief v1.1

The procedure for writing any batch of social posts (TikTok and Instagram) for one account in the SideStep network: mother characters and feeder slideshows. Oct 16, 2026. It produced the launch plan v2 (`claude/launch-plan-v2-posts.csv`) and is the spec for the Studio's Plan page and overnight runner when they draft posts.

## Read first, in this order
1. `claude/viral-writing-playbook.md`: the method. Sections 0 to 9 and 14 matter most.
2. `claude/sidestep-script-kit.md`: the claims sheet (wins over everything), buyer language, voice cards.
3. `claude/sidestep-social-strategy.md`: tensions T1 to T13, account territories (section 5), guardrails (section 10), product truth (section 11).
4. `claude/moment-bank.md`: moments already used, so new posts don't repeat them on the same account.
5. The character file for a mother account (`claude/character-[name].md`): voice card, settings, style, scene and video rules.

## What the schedule fixes (from the plan grid)
Each slot arrives with: account, day, slot, tension, pillar, audience, product (yes or no), mention_mother (yes or no). The writer keeps these and writes everything else. Format can change within the account's formats:
- Feeders: slideshow list, slideshow story, mock UI slideshow, stat slideshow (stats on at most 1 in 4 posts).
- Characters: character clip, character slideshow, character photo.

## The procedure, for every slot
**Slide 1 follows THE STANDARD at the top of the playbook (v1.1):** the pain said plainly in the viewer's words, 7+ out of 10 on pain, clear on one read with no image, a loop only swiping closes, about 15 words or fewer, no stacked quotes, labels or timestamps. Moments, structures and lenses shape slides 2 to 6 and the payoff, not the hook. Most posts are not ads: they name a shared pain so people share it. Voice: a friend in the group chat, fr fr (playbook, "The voice"): open with a feeling (man, uggh, ok so), fragments, ask the group ("is it me fam?"), one or two real slang words, never copy that could run on LinkedIn.

1. **Effect.** Pick effect_open (E1 to E8) for slide 1 and effect_payoff for the end.
2. **Moment first.** Write the moment card (playbook section 3): when, where, what's on screen, the tell. One scene of the problem happening. The tension is a tag, never the hook's subject.
3. **Structure or lens.** Pick a code (S1 to S12, L13 to L25). Each account has a primary (about 35% of posts) and a backup (about 20%) in playbook section 4, plus at least 5 other codes per two weeks. Never the same code twice in a row.
4. **Write 3, keep 1.** Draft at least 3 hooks in different proven shapes (playbook THE STANDARD). Rank each on the playbook ladder (section 8). Keep the best as the hook and the runner-up as alt_hook. Only a 1 or 2 ships. Kill test: the stop test first (would a stranger stop, clear on one read, pain 7+), then what the viewer gets at the end and where the turn is.
5. **Jenga slides.** Each slide answers one small thing and opens the next. Setup and punchline never share a slide. The reveal waits. The last slide completes the scale.
6. **Communication pass.** At least two of Feelings, Facts, Fun. No should, need to, must, ought, "just" before an instruction, or hustle words. No sentence starts with "You" (a "POV:" opener is fine). The CTA is a question, a warm offer or a shrug.
7. **Benchmark.** The playbook's 10 points (section 9). Record the drivers hit.

## Slides, clips, captions
- Slideshows: 6 slides, 4 to 14 words each, plain text, no emoji on slides.
- Character clips: the hook is the on-screen text. One calm action and one camera move, 5 to 8 seconds. The face stays calm; Fun comes from props, secondary motion, edits and text. The punchline must read on mute.
- Character photos: the hook is the on-screen text; the scene carries the moment.
- Scene: feeders describe each image exactly (mock UI text, real places, real light, no real brand names or logos). Characters: setting, the moment, outfit in catalog words with shoes, rotated hair styling, real light, no body-emphasis words.
- Captions: 1 to 3 short sentences that add a layer. Feeders: no emoji or one. Characters: per voice card.
- Hashtags: 3 to 5. One broad, one niche, one community.

## Stats
Claims-sheet market stats first, then strategy-doc stats, each with a source on the row and a short cite on the slide or caption. A stat is a reveal inside a moment, never alone on slide 1. Story details (times, rounds, tallies, budget rows) can be invented for the bit; anything that reads like a market number is sourced.

## Product posts (the 20%)
- SideStep on slide 5 or 6, or late in a clip caption, never in the hook. Best placements (playbook section 12): Two Characters insider fix, Levels top level, mock UI before and after, Is It Worth It category comparison.
- Approved claims only (claims sheet). The site's 90% and "get hired faster" lines at most once per account per two weeks.
- Never: a character's personal hiring result from SideStep, beats or tricks the ATS, auto-apply, ghost-job detection, salary flags, phone, local-first.
- Caption starts with "Ad:" and names SideStep; the slide carries a small "Ad" label. Link in bio only.
- Competitors: category only, with no competitor prices on slides (blur checkout amounts).

## Mother mentions
Only on slots marked mention_mother. "@callie" or "@solei" on slide 6 or in the CTA, never the hook. Control accounts never mention anyone.

## Network rules (learned on the launch plan)
- Each topic has an owner account. Others avoid its signature jokes: F7 owns weekly billing, savings meters and forecasts; F6 owns rounds, take-homes and interns; F2 owns rejection emails, portal statuses, surveys and package trackers; F3 owns entry-level listings and the too-senior and too-junior bind.
- Check new moments against `claude/moment-bank.md` and the other accounts' current batch for near-duplicates.
- Dates in posts match the posting date.
- Then a separate reviewer (one that didn't write the posts) scores every hook and flags claims breaks, flat jokes and cross-account duplicates before anything ships.

## Hard rules
No em or en dashes. No real people, celebrities, named shows, songs or creators, no logos, and no real companies mocked by name. Roast the system, never the viewer. Original words only. Adults only.

## Output fields (one object per post)
account, day, slot, tension, pillar, audience, product, mention_mother, format, angle, structure, effect_open, effect_payoff, moment_id, moment, hook, alt_hook, rank, slides (5 or empty), scene, clip_action, caption, hashtags, cta, drivers, stat_source, notes.
