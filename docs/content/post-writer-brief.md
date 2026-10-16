# Post Writer Brief v1.2

The procedure for writing any batch of social posts (slideshows are TikTok only; Callie and Solei character posts can go anywhere) for one account in the SideStep network: mother characters and feeder slideshows. Oct 16, 2026. It produced the launch plan v2 (`claude/launch-plan-v2-posts.csv`) and is the spec for the Studio's Plan page and overnight runner when they draft posts.

## Read first, in this order
1. `claude/viral-writing-playbook.md`: THE STANDARD at the top is the law (hook, voice, story, tests, SideStep endings). The numbered sections below it are tools for slides 2 to 6.
2. `claude/sidestep-script-kit.md`: the claims sheet (wins over everything), buyer language, voice cards.
3. `claude/sidestep-social-strategy.md`: tensions T1 to T13, account territories (section 5), guardrails (section 10), product truth (section 11).
4. `claude/moment-bank.md`: moments already used, so new posts don't repeat them on the same account.
5. The character file for a mother account (`claude/character-[name].md`): voice card, settings, style, scene and video rules.

## What the schedule fixes (from the plan grid)
Each slot arrives with: account, day, slot, tension, pillar, audience, product (yes or no), mention_mother (yes or no). The writer keeps these and writes everything else. Format can change within the account's formats:
- Feeders: slideshow list, slideshow story, mock UI slideshow, stat slideshow (stats on at most 1 in 4 posts).
- Characters: character clip, character slideshow, character photo.

## The procedure, for every slot
1. **Pick the pain.** One specific job-hunt pain for the slot's tension (from `claude/pain-hook-bank.md`, the moment bank, or new). It must pass the feeling test: super painful, frustrating, shows how bad it is now, or super annoying.
2. **Write 3 hooks, keep 1.** Each names the job situation, says exactly what happened, hurts 7+, reads in one second, in the group-chat voice (playbook THE STANDARD). Run the stop test on all three; keep the best as hook, the runner-up as alt_hook.
3. **Write the story on slides 2 to 6.** One thread. Setup, the turn on 3 or 4 (often a person reacting), the payoff on 5, relief or a question on 6. Every slide makes sense to a stranger. Same voice as the hook.
4. **Write an image line for every slide** that shows that beat. Feeders: hands, screens, rooms, objects, never faces. Characters: the character in a real moment, outfit in catalog words, real light.
5. **Caption:** one line in the same voice that adds a layer, not a repeat. Sources for any market stat go here.
6. **Product slots only:** slide 6 is the friend's SideStep tip that fixes the exact slide 1 pain, using only the honest endings in THE STANDARD. If SideStep doesn't fix that pain, pick a different pain for the slot.
7. **Check:** the stop test, the feeling test, the clarity test, the claims sheet, no dashes. A separate reviewer checks every batch before anything ships.

Tags still recorded on each row for the results review: tension, pillar, audience, structure code if one was used, moment_id.

## Slides, clips, captions
- Slideshows: TikTok, 9:16, 6 slides, 4 to 14 words each. An emoji is fine when a person would text it (💀 😭).
- Character clips: the hook is the on-screen text. One calm action and one camera move, 5 to 8 seconds. The face stays calm; the story is carried by props, small actions and the text. It must read on mute.
- Character photos: the hook is the on-screen text; the image carries the moment.
- Hashtags: 3 to 5. One broad, one niche, one community.

## Stats
Claims-sheet market stats first, then strategy-doc stats, each with a source on the row and a short cite on the slide or caption. A stat is a reveal inside a moment, never alone on slide 1. Story details (times, rounds, tallies, budget rows) can be invented for the bit; anything that reads like a market number is sourced.

## Product posts (the 20%)
- SideStep only on slide 6, or late in a clip caption, as a friend's tip that fixes the slide 1 pain. Never in the hook.
- Honest endings only (playbook THE STANDARD). Never "stop getting ghosted," "passed over" or "it applies for you."
- Approved claims only (claims sheet). The site's 90% and "get hired faster" lines at most once per account per two weeks.
- Never: a character's personal hiring result from SideStep, beats or tricks the ATS, auto-apply, ghost-job detection, salary flags, phone, local-first.
- Caption starts with "Ad:" and names SideStep; the slide carries a small "Ad" label. Link in bio only.
- Competitors: category only, no competitor prices on slides.

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
account, day, slot, tension, pillar, audience, product, mention_mother, format, structure, moment_id, moment, hook, alt_hook, slides (5 or empty), slide images (6 or empty), clip_action, caption, hashtags, stat_source, notes.
