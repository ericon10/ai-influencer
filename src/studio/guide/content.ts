// The Guide (owner, 2026-10-13; UX-PLAN.md pattern 12): the visual manual.
// Each section explains one page or post step: what it is, what to do,
// tips, what costs money, and annotated screenshots of the real screen
// (shots.json, made from the Studio in demo mode). The same sections open
// in a drawer from the "How this works" button on each page and step.

export type GuideColor = 'orange' | 'pink' | 'violet' | 'blue' | 'teal' | 'green' | 'amber' | 'red'

export type GuideId =
  | 'big-picture' | 'posts' | 'characters' | 'setup-start' | 'setup-face' | 'setup-sheet' | 'setup-file'
  | 'post-idea' | 'post-stills' | 'post-video' | 'post-clone' | 'post-text' | 'post-finish'
  | 'library' | 'settings' | 'feedback' | 'realism' | 'voice' | 'hooks'

export interface GuideSection {
  id: GuideId
  group: 'Start here' | 'Set up a character' | 'Make a post' | 'Grow your accounts' | 'Everything else'
  title: string
  // One line: what this is for.
  tagline: string
  color: GuideColor
  // Where it is in the Studio.
  where: string
  intro: string
  steps: string[]
  tips: string[]
  // What costs money here, if anything.
  cost?: string
  // Screenshot ids in shots.json, each with a caption.
  shots: Array<{ id: string; caption: string }>
}

// The whole flow on one screen: the Quick start.
// focus: the part of the screenshot the card shows (x% y%, then zoom).
export const QUICK_START: Array<{ n: number; title: string; text: string; shot: string; color: GuideColor; once?: boolean; focus?: [number, number, number] }> = [
  { n: 1, title: 'Set up your character', text: 'Once per character. Pick a face (REF-00), then build the 12-shot reference sheet. Callie is already done.', shot: 'setup-face', color: 'violet', once: true, focus: [10, 45, 1.3] },
  { n: 2, title: 'New post', text: 'Press New post in the sidebar and pick Video post (or Slideshow, Batch, or From a TikTok).', shot: 'new-post-menu', color: 'orange', focus: [50, 30, 1] },
  { n: 3, title: 'Write the idea', text: 'One sentence in your own words: who does what, where. That is all that is required.', shot: 'post-idea', color: 'pink', focus: [0, 35, 1.6] },
  { n: 4, title: 'Make stills', text: 'Press Write and generate. Claude writes the prompt and the stills come back. Press Use this still on the best one.', shot: 'post-stills-done', color: 'amber', focus: [10, 84, 1.7] },
  { n: 5, title: 'Make the video', text: 'Claude has written the video prompt. Pick a model, press Generate a take, then Use this take.', shot: 'post-video-still', color: 'blue', focus: [0, 22, 1.7] },
  { n: 6, title: 'Add the caption', text: 'Type the caption. The preview shows it in TikTok\'s white box, clear of the buttons.', shot: 'post-caption', color: 'teal', focus: [30, 30, 1.5] },
  { n: 7, title: 'Export and download', text: 'Export MP4 is free. Download it, post it, and turn on the AI-generated label.', shot: 'post-finish', color: 'green', focus: [16, 62, 1.8] },
]

export const GUIDE: GuideSection[] = [
  {
    id: 'big-picture', group: 'Start here', title: 'The big picture', color: 'orange',
    tagline: 'Characters once, posts every day, everything kept in the Library.',
    where: 'The sidebar on the left',
    intro: 'The Studio has three places. Characters is where you set up a person once: a face and a reference sheet that keep them the same in every image. Posts is where you make content every day: one post goes from an idea to an exported video or slideshow on one page. Library keeps everything you made so you can reuse it.',
    steps: [
      'New post (the orange button) starts a post. Everything for that post happens on its page, top to bottom.',
      'Posts lists your posts. Open one to keep going where you left off.',
      'Characters is for setting up a person. You rarely go back once the sheet is done.',
      'Library has every still, clip, B-roll video, sound, voice line, hook and export. Any of them can start a new post.',
      'Settings holds your keys, Higgsfield billing, the Claude models, the rules and the budgets.',
    ],
    tips: [
      'Watch the worker light at the top left. Green means a run starts right away; yellow means it is restarting after an update.',
      'Demo mode (bottom left) makes free mock results so you can try every step. Live mode uses your real accounts.',
      'Activity (bottom left) shows everything running and everything that finished in the last 15 minutes.',
    ],
    shots: [{ id: 'shell', caption: 'The sidebar and Posts home' }],
  },
  {
    id: 'realism', group: 'Start here', title: 'Rule zero: real skin', color: 'red',
    tagline: 'Flaws, pores and a bare face are what make a character believable.',
    where: 'Everywhere, automatically',
    intro: 'Every image prompt gets a REALISM block that asks for real skin: pores, peach fuzz, stray hairs, a little redness and shine. Hero and sheet shots are always bare-faced. Words like flawless, airbrushed or smooth skin are removed, and any beautify option is forced off. You never have to add any of this yourself.',
    steps: [
      'Close and chest-up shots get the full skin detail. Waist-up says "natural skin texture". Full-body and wide shots leave skin detail out.',
      'The free checks compare each still with REF-00: the face match and whether the skin came back smoothed.',
      'A character can have their own REALISM block in the character file; otherwise the Studio default is used.',
    ],
    tips: [
      'Do not fix the flaws. The mole, freckles and uneven tone are part of the identity.',
      'If a result looks plastic or waxy, regenerate it or use Fix one thing > Plastic face.',
    ],
    shots: [],
  },
  {
    id: 'posts', group: 'Start here', title: 'Posts home', color: 'orange',
    tagline: 'Every post you are making, with filters.',
    where: 'Sidebar > Posts',
    intro: 'Posts home shows every post as a card: drafts, ready and exported. The tag on each card says where it is (Draft, Stills, Video, Exported). Open a card to keep going exactly where you stopped.',
    steps: [
      'Start a post with the buttons at the top right, or New post in the sidebar.',
      'Filter by account (the tag you give a post, like "Callie TikTok") or by character.',
      'Another on a card makes a filled-in copy that opens at the caption: the fastest way to make a series.',
      'Accounts (the card at the top, folded until you open it): each account\'s tracked link or promo code and its signups, ranked by signups. See Hooks and the scoreboard.',
    ],
    tips: ['Video post from a TikTok (in the New post menu) opens a post with Clone already open.'],
    shots: [
      { id: 'posts-home', caption: 'Posts home' },
      { id: 'new-post-menu', caption: 'The New post menu' },
    ],
  },
  {
    id: 'characters', group: 'Set up a character', title: 'Characters', color: 'violet',
    tagline: 'Each character is set up once, then used in every post.',
    where: 'Sidebar > Characters',
    intro: 'A character is a person who stays the same everywhere: the same face, marks and body in every still and video. You make one from inspiration photos, or import a character you already built (a character file and its sheet images).',
    steps: [
      'New character starts from inspiration photos (Inspiration step).',
      'Import brings in a character file (.md) and, if you have them, sheet images named REF-00 to REF-11.',
      'Open a character to see its four setup steps.',
      'Voice (next to Edit card on the character page): the character\'s ElevenLabs voice and how they talk. The writers and voice lines use it.',
    ],
    tips: ['The character is always a new person, never a copy of someone in the inspiration photos.'],
    shots: [{ id: 'characters', caption: 'Your characters' }],
  },
  {
    id: 'setup-start', group: 'Set up a character', title: 'Step 1: Inspiration', color: 'violet',
    tagline: 'Show the look you want; Claude separates the look from the face.',
    where: 'Characters > a character > Inspiration',
    intro: 'Drop in a few photos with the vibe you want. Break it down has Claude list what to keep (styling, hair, wardrobe, setting, camera feel) and what to change (the face, so it is a new person). Propose 3 concepts writes three character cards; pick one or write your own.',
    steps: [
      'Add inspiration images (and notes if you like).',
      'Press Break it down (priced, a few cents).',
      'Press Propose 3 concepts, then pick one. You can edit the card any time.',
      'Go to Face.',
    ],
    tips: ['The inspiration photos are never sent to the image models. Only the written card is.'],
    cost: 'Break it down and the concepts are Claude calls: a few cents each, priced on the button.',
    shots: [{ id: 'setup-start', caption: 'Inspiration, with the card on the left' }],
  },
  {
    id: 'setup-face', group: 'Set up a character', title: 'Step 2: Face (REF-00)', color: 'violet',
    tagline: 'Pick the one face every later image copies.',
    where: 'Characters > a character > Face',
    intro: 'Generate heroes makes portraits from the card: bare face, real skin, no makeup. Pick the best one. It becomes REF-00, the anchor for the whole sheet and every post. If it is small, upscale it 2x.',
    steps: [
      'Set Runs per prompt (3 prompts times that number).',
      'Press Generate heroes and wait for the live status to say Done.',
      'Pick the one you like best. Prefer one where the marks (like the mole) are visible.',
      'Compare card with hero updates the card to match the face (the image wins).',
      'Press Build the sheet.',
    ],
    tips: ['Changing REF-00 later marks the sheet shots built on it as stale, so pick carefully.'],
    cost: 'Each hero is one image, priced on the button.',
    shots: [{ id: 'setup-face', caption: 'Face: REF-00 on the left, heroes on the right' }],
  },
  {
    id: 'setup-sheet', group: 'Set up a character', title: 'Step 3: Reference sheet', color: 'violet',
    tagline: '12 shots of the same person: angles, expressions, full body.',
    where: 'Characters > a character > Reference sheet',
    intro: 'The sheet is REF-00 plus 11 more shots: three-quarter and profile on both sides, the back of the head, full body front, side and back, and three expressions. Stills attach the closest ones, so the face holds from any angle.',
    steps: [
      'Open a shot and press Generate (it attaches the shots it depends on).',
      'Review the result: approve it, or pick a reason and Regenerate with the fix.',
      'Check this asks Claude to look at the marks and sides (priced). The free face match always runs.',
      'When all 12 are approved, the sheet is complete.',
    ],
    tips: [
      'Marks have sides. A mole above the LEFT brow must stay on her left in every shot; the check catches mirrored marks.',
      'A shot marked stale was built on an older version of another shot. Regenerate it or keep it.',
    ],
    cost: 'Each shot is one image; Check this is a Claude call. Both priced on the button.',
    shots: [{ id: 'setup-sheet', caption: 'The reference sheet' }],
  },
  {
    id: 'setup-file', group: 'Set up a character', title: 'Step 4: Character file', color: 'violet',
    tagline: 'Everything about the character, in one file you can edit.',
    where: 'Characters > a character > Character file',
    intro: 'The character file (character-name.md) holds the card, the marks with their sides, the body, makeup, the REALISM block and every approved sheet shot. Download it to keep a copy or to edit it; import it back to apply your edits.',
    steps: [
      'Download the file to keep or edit.',
      'Edit the Card, Body and Notes sections freely.',
      'Import edits or sheet images to apply changes. The previous version stays in history.',
    ],
    tips: [
      'Images named REF 00 to REF 11 (or REF-00) become approved sheet shots when you import them.',
      'A "## Voice" section in the file (Who, POV, Talks like, Never, Pillars, Example, ElevenLabs voice ID) becomes the voice card.',
    ],
    shots: [{ id: 'setup-file', caption: 'The character file' }],
  },
  {
    id: 'post-idea', group: 'Make a post', title: 'Step 1: Idea', color: 'pink',
    tagline: 'One box: describe the shot, or paste a whole prompt.',
    where: 'Any post > Idea',
    intro: 'Write what happens in your own words, or paste a full prompt. The Studio reads what your words already say (a selfie, the front camera, close framing, a black tank, the place, the light) and shows it as chips; nothing you wrote is rewritten. Everything else (character, account, format, places and every detail of the shot) is under More control, collapsed.',
    steps: [
      'Pick how to start: Describe it (write the shot; stills and a video follow), or Start from a real clip (your character in a TikTok or Reel; see Start from a real clip).',
      'Type the idea, or paste a prompt. It saves as you type.',
      'Check the chips under the box: Camera, Phone camera, Framing, Outfit, Makeup, Place, Light. Click one to change it (it then says "you set"); the x puts it back to what your words say. "+ Set a detail" adds one your words did not name.',
      'Pasted a whole prompt? "Send my prompt as written" switches on by itself: your text goes unchanged with only the reference line, the 21+ line and the REALISM block added. Switch it off to have the prompt writer write from it instead.',
      'Punch it up (optional) writes three sharper versions to pick from; what your words already say stays (a selfie stays a selfie).',
      'More control: the character, the account tag, Format, places from the persona, and the full details (her task, outfit, camera, light and the rest), with Plan the details and Use for other characters.',
      'A batch can Import a spreadsheet: one row per post (character, account, a clip to reuse or "still: your prompt", video, caption, style). Preview shows each row and the total price; Make N posts creates them and exports the ones that reuse a clip, free.',
    ],
    tips: [
      'Specific beats general: "front-camera selfie in a black tank at a packed rave, phone a little above her" works better than "at a rave".',
      'Close (chest-up) and waist-up shots attach face refs only, so the sheet outfit never comes along; a knees-up or full-body shot adds a body ref.',
    ],
    cost: 'Reading your words is free. Punch it up is a small Claude call (under a cent).',
    shots: [
      { id: 'post-idea-start', caption: 'Describe it, or start from a real clip' },
      { id: 'post-idea', caption: 'One box, and the chips read from your words' },
      { id: 'post-idea-paste', caption: 'A pasted prompt, sent as written' },
      { id: 'post-idea-more', caption: 'More control' },
    ],
  },
  {
    id: 'post-stills', group: 'Make a post', title: 'Step 2: Stills', color: 'amber',
    tagline: 'Photos of the moment. The best one starts the video.',
    where: 'A video post or slideshow > Stills',
    intro: 'Write and generate does two things for one price: Claude writes the prompt from your idea (with Director\'s notes on what makes it memorable), then the stills run on it. The prompt stays in the box, editable, for the next run. The writer keeps your camera, outfit and light, and adds no mood words you did not use (glowing, cinematic, soft light). It says outfits the way a shop catalog does (garment, color, fabric, a style word: "dark green ribbed tank top with thin straps, going-out look"), never with fit or body words (fitted, tight, low-cut, sheer, toned, curvy, hips, waist, legs), never with names that sound like underwear ("bike shorts", not "boy shorts"), and gives a moment, not a pose ("refilling her water bottle", never "posing in"). Only the words change, never what she wears; the box says what it took out or reworded. Your own words go as typed. The details are one line here; change them in the Idea step under More control.',
    steps: [
      'Pick a model (up to 2 to compare) and how many stills per model. It starts at GPT Image 2.5 Flare, 4 stills, Standard quality, 9:16; Nano Banana 2.1 and High quality are one click each. Flare prompts always add "Bare natural lips, no gloss." The price is on the button: credits on your Higgsfield plan, dollars on the API.',
      'Press Write and generate. Each still shows the free checks when it lands. A pasted prompt sent as written skips the writer.',
      'What was sent, under every still and on every failed run: the final prompt exactly as sent (with Copy), the images and the Higgsfield element attached, the model, your plan or the API, the settings, the price quoted next to the real cost, and for a failed run why it failed.',
      'A word you typed that the provider\'s filter often blocks is named under the price ("May be blocked by the provider\'s filter: tight. Your words go as typed."). It is a warning, never a block: change it or run as is.',
      'A run the filter refuses shows its likely trigger words (read from what was sent) and Retry with safer wording: the same run with only those words reworded by code. The rewording is free; the run is priced like the one that was refused (and refunded). Earlier failures fold into one gray line ("4 blocked by the filter, refunded. Nothing charged.") with Show and Clear; only the run you just started can be red.',
      'Edit the Director\'s notes or the prompt if you like, then Rewrite or Generate again.',
      'Open a still to look closely: Check this (Claude), Fix one thing, crop closer, upscale.',
      'Press Use this still on the best one. It moves you to the Video step and Claude writes the video prompt from it.',
    ],
    tips: [
      'Fix one thing makes one change and keeps the rest of the still. Diagnose and revise has one-click fixes: plastic face, staged pose, morphing hands, synchronized background, fake low light, overprocessed.',
      'Face drift (the face does not match REF-00) is usually a regenerate, not an edit.',
      'Already have a still? Pick a still from the Library. Already have a clip? Skip: I have a clip.',
    ],
    cost: 'Each still is one image (GPT Image 2.5 Flare at Standard: 1 plan credit, High 2.75; Nano Banana 2.1: 1.5 at 1k, 2 at 2k); the prompt writer is a small Claude call. One price on the button for both. The real cost of each run is logged next to its quote; more than 20% off is flagged in What was sent and Settings > Costs.',
    shots: [
      { id: 'post-stills-start', caption: 'Before generating: Flare, 4 stills, 9:16' },
      { id: 'post-stills-done', caption: 'The written prompt, Director\'s notes and the stills' },
      { id: 'still-sent', caption: 'What was sent: prompt, refs, model and cost' },
      { id: 'still-drawer', caption: 'A still opened: the free checks' },
      { id: 'still-fix', caption: 'Fix one thing and Diagnose and revise' },
    ],
  },
  {
    id: 'post-video', group: 'Make a post', title: 'Step 3: Video', color: 'blue',
    tagline: 'Four ways to get the clip. Picking one keeps it.',
    where: 'A video post > Video (a batch calls it Clips)',
    intro: 'Make a video from a still turns your still into a real video (Kling, Seedance and others). Claude writes the video prompt in labeled lines: FORMAT, SUBJECT, SETTING/LIGHT, CAMERA, ACTION, CONTINUITY, AUDIO, CONSTRAINTS. FORMAT (9:16) and AUDIO (sound off unless you turn it on) are always set by the Studio. You can also start from a real clip (Recreate), upload a video, or pick a clip from the Library.',
    steps: [
      'Read or edit the video prompt and the Director\'s notes (hook in the first second, payoff in the last two, one camera move).',
      'Pick a video model. Each shows the price of one take; your pick is remembered.',
      'Set the length, shape, sound and number of takes, then press Generate a take.',
      'Press Use this take on the one you like. Upscale this take adds detail to the exact same take later.',
      'Two-shot edit? Shot B sits under shot A: make it from a still, pick it from the Library, or upload it. For the crash zoom, Make the close-up crops shot A\'s last frame around her face (free), then Upscale 2x and Make a video from it.',
      'Want it longer? Press Continue this shot under the clip (free). Its last frame starts the next take on the same model; Generate a take, then Use this take, and the two join into one longer clip.',
    ],
    tips: [
      'Continue this shot keeps the same place, light, wardrobe and camera. The seam is scored and cut, never blended; if it fails you can regenerate the take or keep them as two shots.',
      'If a take looks off, open "If a take looks off" under the prompt: what to change for a restless camera, morphing hands, a staged look and more.',
      'Start and end frames give two beats in one continuous take. The end frame helper changes only the head of the start frame.',
      'B-roll (optional) is a screen recording or phone video cut in hard before or after the clip.',
    ],
    cost: 'Each take is priced on the button (per second of video). The video prompt is a small Claude call.',
    shots: [
      { id: 'post-video-ways', caption: 'The four ways to get a clip' },
      { id: 'post-video-still', caption: 'The video prompt in labeled lines' },
      { id: 'post-video-models', caption: 'Video models with their prices' },
      { id: 'post-video-takes', caption: 'Takes' },
    ],
  },
  {
    id: 'post-clone', group: 'Make a post', title: 'Start from a real clip (Recreate)', color: 'blue',
    tagline: 'Your character in a real TikTok or Reel: real motion, real light, in 4 or 5 clicks.',
    where: 'A video post > Idea > Start from a real clip; Library > Clips > Use this clip; a batch > Video > Recreate a batch of clips',
    intro: 'Recreate puts your character into a real clip: four stills of them in the clip\'s frame, a face pass if one drifted, then the clip\'s real motion onto the still you pick. Real footage beats prompted club light and prompted dancing. Two free face checks guard the money step: the video only starts from a still whose face matches REF-00 and that does not look like the person in the clip. That still gate is the only thing that blocks spend: a finished take is never thrown away. Nothing spends on its own; every paid step shows its price first. Replace the person (keep the scene) is still there for clips where only the person should change.',
    steps: [
      'Start: in a new video post pick "Start from a real clip" and choose the file, paste a video link, or paste a Higgsfield media ID. Or press Use this clip on any clip in Library > Clips (it uses that clip\'s character). The clip is cleaned for free: the end card is cut and burned-in captions and the handle are filled in.',
      'What to keep, what to drop: "Scene to keep" chips (the place, the light, the angle, props) and "Source traits to drop" chips (hair color, eye color, piercings, makeup such as winged liner). Read them for me fills both from four frames of the clip (Claude, priced). Click x to take a chip out, type to add one.',
      'The outfit: keep the clip\'s outfit (described in words), or pick theirs (one of the character\'s looks, or your own words). Read them for me names it like a shop catalog: the garment, its color and fabric, and a style word when it is clear ("dark green ribbed tank top with thin straps, going-out look"), never a bare "top" and never fit or body words. What you type goes as typed; a word the filter often blocks is named under the price. "What happens in the clip" is the motion line for the video prompt.',
      'The stills model: Nano Banana 2.1 (your Higgsfield plan; what the proven runs used) or GPT Image 2.5 (the Higgsfield API; untested for recreates). Same prompts, same face pass, same gates either way, and the face pass runs on the model the stills used. Nano Banana 2.1 is picked when the plan is connected, GPT Image 2.5 when it is not (the API does not offer Nano Banana 2.1). A choice with no plan or no key is grey with one line why. Your last pick is remembered, and a batch uses it too.',
      'Press Make 4 stills + face pass (9:16): the 4 stills, then the face pass (2 takes) on the best one, in one price. The face pass edits that still (it is the first image; the element and REF-00 only carry the face), so the kitchen, the outfit, her position and the framing stay. It is skipped, and its part of the price is not charged, when the best still already beats the clip\'s person by 0.30 or more (a line says so). The switch beside the button skips it for the lower price. With GPT Image 2.5 the button says "GPT Image 2.5, untested for recreates".',
      'Each still and face pass shows Face (match to REF-00), Clip (likeness to the person in the clip) and Margin (Face minus Clip). A face pass must still match its still outside the face; one that changed the scene says "Face pass changed the scene, not usable" and has no Make the video. Fix this face redoes only the face (2 takes) on any other still. You pick chooses the best face match that looks least like the person in the clip.',
      'A still the provider\'s filter refused shows its likely trigger words and Retry with safer wording (only those words change, free; the still is priced like the refused one). Failures from earlier runs fold into one gray line under the stills ("4 blocked by the filter, refunded; 2 face passes not run. Nothing charged.") with Show and Clear (cleared for good on this post); only the run you just started shows its failures as tiles.',
      'The gates (fixed): Make the video shows only on a still with Face 0.45 or more, a Margin of 0.12 or more, and Clip under 0.45. Calibrated on the two proven stills (kitchen: 0.71, 0.26, margin 0.45; rave: 0.54, 0.37, margin 0.17). A still that fails says why and offers Fix the face again or Make 4 new stills.',
      'The motion model: Genjutsu, Wan 3.0, Wan 3.0 Prime or Kling 3.0 Motion Control, each with its price and its billing path (your Higgsfield plan or the Higgsfield API). A model with no working key or plan is greyed out with one line saying why. Your last pick is selected. Every model gets the still as the image, the cleaned clip as the motion, 720p, 9:16, sound off, and a prompt that keeps the outfit exactly as in the still.',
      'Press Make the video. The review runs by itself, free: the take and the clip side by side playing in sync, a face check every half second with drift marked red (a face under 0.45, the same number as the video rule), text found on the frames (logos, @handles, captions) each with a thumbnail of its frame and the words boxed, and any cut in the take with Trim at the cut.',
      'The video rule reads the whole take with the stills\' numbers: the middle face match 0.45 or more, the middle margin 0.12 or more, the highest likeness under 0.45 (she copies the clip\'s expressions, so a take reads a little higher than a still). A take that passes is kept. One that misses is never thrown away: a warning shows the scores and what missed, with Keep this take and Try again (back to Make the video; nothing spends until you make it).',
      'Press Use this take: it is put on the post with no music, and the Text step opens.',
      'Recreate with another character makes a new post with the same clip for someone else, starting at What to keep.',
    ],
    tips: [
      'Clicks from a recreate link to a finished video: 3 (Make 4 stills + face pass, Make the video, Use this take). From Library > Use this clip: 4. From the Idea step: 5.',
      'A spend cap per post (cap= in a recreate link) refuses a step that would pass it and says how much is left.',
      'A batch of recreates: up to 20 rows, each a clip and a character in its own post, each with its own motion model (or Set all). Each step runs every row at it for one price, with the price on each row; a row that fails a gate or has no face yet waits for you and says why.',
      'A new person is still a fixed rule, and the still gate enforces it before any video spend. After that the call on a take is yours: takes the old check marked Not kept show again with their scores and Keep this take.',
      'Recreate prompts stay short: the character\'s face and hair only (her body is in the element and the sheet), no age line (21 or older is checked before the run), the outfit in catalog terms ("Dark green ribbed tank top with thin straps, going-out look, same as in the photo"; your own typed words go as typed), and "REALISM: Natural skin texture, not retouched." Longer stacks of words next to a real person\'s photo get blocked by the provider\'s filter. What was sent shows the exact prompt, even on a failed still.',
      'Original sound is off by default; the export has no music unless you add one in the Finish step.',
      'The gate check: after every 10 real recreates (a video made on a real model, not the demo) Settings > Rules shows the face match and margin of the stills you made videos from next to the ones you passed over, with suggested gate numbers and what each would have held. Use these numbers or Keep the current numbers; nothing changes until you click. Video takes get their own numbers the same way: after every 10 real takes, the takes you kept next to the ones you tried again on. The Recreate panel shows a one-line notice when a check is ready.',
    ],
    cost: 'Every paid step shows its price first; nothing spends on its own. On the plan: 4 stills and the face pass 9 credits (6 and 3; 6 if you skip the face pass, or when it skips itself because the best still already clears 0.30), Genjutsu 7 credits a second at 720p (42 for 6 s), Wan 3.0 1.75 a second, Wan 3.0 Prime 3 a second. The proven kitchen run cost 51 credits in all. On the API (GPT Image 2.5 stills, or a motion model on the API) the price is in dollars, and the exact price is read back from Higgsfield after each run. The review, the checks and Trim are free.',
    shots: [
      { id: 'post-idea-start', caption: 'Start from a real clip, in the Idea step' },
      { id: 'recreate-step2', caption: 'Scene to keep, source traits to drop, the outfit in catalog terms' },
      { id: 'price-wording', caption: 'A typed word the filter often blocks, named under the price' },
      { id: 'recreate-stills', caption: 'The stills, a refused one with its trigger words and Retry with safer wording, earlier failures in one gray line' },
      { id: 'recreate-model', caption: 'The motion model, with its price and billing path' },
      { id: 'recreate-review', caption: 'The review: in sync, face every 0.5 s (drift under 0.45), the video rule, text found on its frame, Keep this take or Try again' },
      { id: 'recreate-batch', caption: 'A batch of recreates' },
      { id: 'gate-check', caption: 'The gate check in Settings > Rules: picked vs passed over, suggested numbers' },
    ],
  },
  {
    id: 'post-text', group: 'Make a post', title: 'Step 4: Caption, slides or captions', color: 'teal',
    tagline: 'The words on the post, with a live TikTok preview.',
    where: 'Any post > Caption (Slides for a slideshow, Captions for a batch)',
    intro: 'A video post has one caption in TikTok\'s white box. A slideshow has a hook on slide 1, slides, a post caption and hashtags; Claude can write them. A batch has one caption per line, one video each; Claude can write as many as you ask for.',
    steps: [
      'Video post: type the caption and watch the preview, or press Pick a hook to use one from the vault (this character\'s own variants come first). Pick White box or Outline (white text with a black stroke, TikTok Classic). It sits in the upper third, off her mouth and hands.',
      'Slideshow: press Write the slides (or type them), add or remove slides, then the caption and hashtags.',
      'Batch: set How many, press Write, and edit the list. The clips rotate across the captions.',
    ],
    tips: [
      'The preview uses the same font, box and safe zones as the export, so what you see is what you get.',
      'Claude writes slides and captions in the character\'s voice card when there is one (the character page, Voice).',
      'A voiceover with "Captions from the voice line" on replaces the typed caption with the line\'s own words (Finish, Sound).',
    ],
    cost: 'Writing slides or captions is a small Claude call. Typing them is free.',
    shots: [
      { id: 'post-caption', caption: 'Video post: the caption' },
      { id: 'post-slideshow', caption: 'Slideshow: the hook and slides' },
      { id: 'post-batch', caption: 'Batch: one caption per video' },
    ],
  },
  {
    id: 'post-finish', group: 'Make a post', title: 'Step 5: Finish', color: 'green',
    tagline: 'Timeline, editor, sound, export, download, post. Free.',
    where: 'Any post > Finish',
    intro: 'The Timeline lays the post out from the steps above: its shots, B-roll and captions. Open the editor to place edits exactly where you want them on that timeline (OpenReel, full screen): drop a preset at the playhead, drag it, trim it, set Subtle, Normal or Strong. Done in the editor exports the video, saves it here with the timeline, and brings you back. Without the editor, Export MP4 renders the timeline on the Studio\'s own worker, for free. A slideshow exports JPEG slides; a batch exports every video and a zip.',
    steps: [
      'Check the Timeline: the shots and captions the Studio laid out for you.',
      'Open the editor (best on a computer): click a suggested spot (the payoff) or move the playhead, then click a preset (a crash zoom, a speed ramp, karaoke captions and more). Drag or trim its block; click it for Subtle, Normal or Strong and its keyframes. The Beat card finds the beat of your music (or tap the tempo) so cuts and presets snap to it; the Styles card saves your presets as a style for the next post. Press Done: it exports, saves to the post and comes back here.',
      'Captions in the editor: click the words in the preview to select a caption, drag it to move it. Double-click it (or its block on the timeline; double-tap on a phone) to change the words right there: Enter saves, Shift+Enter starts a new line, Esc cancels. Long captions wrap inside the frame. Drag one of the four small dots just outside its corners to make it bigger or smaller: it wraps to stay in the frame, never grows taller than the frame, and one drag is one undo step. Click anywhere empty (beside the frame, or a spot on it with nothing there) to clear the selection. On a phone, drag a caption or its handles with a finger. Drag its block on the timeline to show it later or sooner, or its end to show it for less time. Karaoke captions light up the caption\'s own words in turn and keep its place and look; click the preset again to turn it off.',
      'Freeze and speed ramp get a marker on the Presets track: click it to open the Speed panel for that shot (on a phone, the Edit tab). A shot shows its speed on its block (2x, Ramp, Freeze). The tracks are named by what they hold: Captions, Shots, B-roll, Voice, Music, Presets.',
      'The post ends with its last shot: a caption or music that ended with the last shot keeps ending with it when you speed a shot up, trim it or delete one, so the export never runs on over black. One you retimed to end elsewhere stays where you put it.',
      'Shots in the editor: S splits at the playhead, drag an edge to trim, and drag a shot onto another to put it in front (the shots close up). Ctrl+Z undoes any of it.',
      'Pick the sound: Room tone (the default), a recording you uploaded, or None; add a music track you uploaded if you like. Music dips under the clip\'s own sound.',
      'Voiceover (optional): pick one of the character\'s converted voice lines, where it starts and how loud. Captions from the voice line are on by default: the words show a few at a time, each timed, so Karaoke captions light each word as it is said. Music and ambience dip under the voice.',
      'Or press Export MP4: the worker renders your timeline, presets included, for free (it shows what is still missing if anything is). On a phone: Trim start and end, then Export MP4.',
      'Download MP4.',
      'Turn on TikTok\'s AI-generated content label when you post.',
      'Make another like this for the next one in a series.',
    ],
    tips: ['Edits are placed on the timeline where you choose them, never guessed for the whole video.', 'Open the editor again to change an edit: the timeline is kept with the post.', 'The preview opens bigger; drag the edge above the timeline to give the tracks more room.', 'The editor opens with your music ducked under the voice line (or the clip\'s own sound); the music clip\'s Audio Ducking panel changes or removes it. If a file cannot open, the bar names it and the rest of the post opens.', 'On a phone the tabs at the bottom of the editor switch between Timeline, Media (the presets) and Edit (whatever is selected).', 'There is no AI music. Upload tracks you have the rights to (Library > Sounds holds them all).', 'Cuts between shots are hard cuts, never a crossfade.'],
    cost: 'Free.',
    shots: [{ id: 'post-finish', caption: 'Finish' }, { id: 'editor-captions', caption: 'The editor: a caption edited in place' }, { id: 'editor-resize', caption: 'The editor: small corner dots to resize, move and retime a caption' }, { id: 'editor-speed', caption: 'The editor: freeze and ramp markers, named tracks, the speed on the shot, a bigger preview' }],
  },
  {
    id: 'voice', group: 'Grow your accounts', title: 'Voice and voice lines', color: 'pink',
    tagline: 'How each character talks, and lines in their own voice.',
    where: 'A character > Voice, Library > Voice lines, and a post\'s Finish step > Sound',
    intro: 'Every character has a voice card: who they are, their point of view, how they talk, the words they use and never use, their emoji habit, their humor, their content pillars and an example line. Claude writes captions, slides and hook variants in that voice, so thirty accounts never sound like one. The card also holds the character\'s ElevenLabs voice: you perform a line yourself, and Convert turns your take into the character\'s voice with every word timed. A converted line becomes a post\'s voiceover, with captions from its words. There is no lip sync yet.',
    steps: [
      'On the character page, press Voice. Paste the ElevenLabs voice ID (ElevenLabs, Voices, the voice, ID) and fill in as much of the card as you like. Every field is optional.',
      'Record each line as its own WAV, named by hook: 047_check-my-match-score.wav is Hook 47, "Check my match score".',
      'Library > Voice lines: pick the character, press Upload takes and choose the files. The worker prepares each take for free.',
      'Press Convert on a take, or Convert all, and check the price. When it is done, play your take and the converted line side by side; "Heard" shows the words it timed.',
      'In a video post, Finish > Sound > Voiceover: pick the line, set where it starts and how loud it is. Captions from the voice line is on by default.',
    ],
    tips: [
      'Captions from the voice line show a few words at a time, each timed to when it is said; with Karaoke captions each word lights up as it is spoken.',
      'Music and ambience dip under the voice, and the finished post is leveled to -14 LUFS.',
      'A voice line belongs to one character: switching the post\'s character drops it. A batch has no voiceover.',
      'The "never" list is advice for the writers, never a block.',
    ],
    cost: 'Preparing takes is free. Convert is priced per second of the take, shown on the button first (an estimate until the first real run confirms it).',
    shots: [
      { id: 'voice-card', caption: 'The voice card' },
      { id: 'voice-lines', caption: 'Library > Voice lines' },
      { id: 'voiceover', caption: 'The voiceover in the Sound row' },
    ],
  },
  {
    id: 'hooks', group: 'Grow your accounts', title: 'Hooks and the scoreboard', color: 'orange',
    tagline: 'A hook vault per product, variants in each voice, and signups per account.',
    where: 'Library > Hooks, a post\'s Caption > Pick a hook, and Posts home > Accounts',
    intro: 'Each product has a script kit: the hook vault (numbered hooks, grouped by type), the claims sheet (what you can say about the product, and what never to say) and the buyer-language bank (how buyers really talk). SideStep is loaded from your script kit. Write variants asks Claude to rewrite one hook in each character\'s voice, inside the claims sheet, so no two accounts post the same line. The Accounts card on Posts home keeps each account\'s tracked link or promo code and its signups, and ranks the accounts by signups, never by views.',
    steps: [
      'Library > Hooks: pick the product. Filter the vault by type (Relatable pain, Myth bust, Soft product and more).',
      'Under Write variants for, pick the characters. Open a hook and press Write variants (priced first). Each variant shows the character\'s name, with Copy, Use in a new post and Archive.',
      'Edit anything in place: a hook\'s words, a new hook, the claims sheet or the buyer language (Edit, one item per line; a line ending in a colon starts a group).',
      'In a video post, press Pick a hook next to Caption: this character\'s variants come first under each hook.',
      'On Posts home, open Accounts: add each account, its character, its tracked link or promo code, and type its signups from your link tracker. The table re-ranks itself.',
    ],
    tips: [
      'Keep the 80/20 mix: about 80% pure value and relatable posts, 20% soft product mentions.',
      'A variant that mentions the product next to a watch word from the claims sheet (interviews, hired, beats) gets a warning to check it. It never blocks.',
      'Import a script kit (.md) to add another product. The kit\'s voice cards can be used for any character.',
      'The link goes in the post caption or bio, never on the video.',
    ],
    cost: 'Write variants is a small Claude call, priced on the button. Everything else is free.',
    shots: [
      { id: 'hooks', caption: 'Library > Hooks' },
      { id: 'hook-variants', caption: 'A hook with a variant in Callie\'s voice' },
      { id: 'accounts', caption: 'Posts home > Accounts' },
    ],
  },
  {
    id: 'library', group: 'Everything else', title: 'Library', color: 'teal',
    tagline: 'Everything you made, ready to reuse.',
    where: 'Sidebar > Library',
    intro: 'Stills, Clips (kept takes, uploads and clones), B-roll, Sounds, Voice lines and finished Posts, across all characters. Open anything to see it, download it, or start a new post from it. Upload B-roll, clips, sounds and voice takes here too.',
    steps: [
      'Pick a tab: Stills, Clips, B-roll, Sounds, Voice lines or Posts.',
      'Filter by character.',
      'Open an item, then Use in a new post.',
      'Clips: Use this clip starts Recreate with that clip and its character, straight to What to keep (5 clicks to a finished video).',
      'Voice lines: your performed takes, turned into the character\'s voice. See Voice and voice lines.',
      'Hooks: each product\'s hook vault, claims sheet and buyer language, with variants in each character\'s voice. See Hooks and the scoreboard.',
    ],
    tips: [
      'Inside a post, the same Library opens as a drawer: pick, and it drops into the step.',
    ],
    shots: [{ id: 'library', caption: 'The Library' }, { id: 'library-clips', caption: 'Clips: Use this clip' }],
  },
  {
    id: 'settings', group: 'Everything else', title: 'Settings', color: 'blue',
    tagline: 'Keys, billing, models, rules and budgets.',
    where: 'Sidebar > Settings',
    intro: 'General has Demo or Live, your provider keys (they stay on the server) and Higgsfield billing: your plan credits (your own account) or the pay-per-use API. Models sets the Claude model per task and tests each Higgsfield model once. Rules lists every rule. Budgets and usage shows spend and caps.',
    steps: [
      'General: switch to Live when your keys are in, and pick Higgsfield billing.',
      'Models: Sonnet runs every Claude task; switch one to Opus if you want. Run each model\'s small test once.',
      'Rules: fixed rules always apply. Every other rule is a default you can switch off for everyone or one character.',
      'Rules > Recreate gate check: after every 10 real recreates, the face and margin scores of the stills you picked next to the ones you passed over, and suggested gate numbers. Use these numbers or Keep the current numbers; nothing changes until you click.',
      'Budgets and usage: set the monthly and per-run caps.',
    ],
    tips: [
      'Fixed rules: real skin, 21 or older, nothing explicit, a new person (never a copy), the AI label, the price first, budget caps, keys on the server.',
      'Defaults include the Director\'s pass, the prompt writer, automatic Claude checks and the variety note.',
      'Two wording defaults: Outfits in catalog terms (Claude\'s words lose fit and body words, underwear-sounding names and "posing"; the lists are in config/wording.yaml) and May be blocked by the provider\'s filter (a warning under the price when your own words use one of them). Both are on; switch either off.',
    ],
    shots: [
      { id: 'settings-general', caption: 'General' },
      { id: 'settings-rules', caption: 'Rules: fixed and defaults' },
      { id: 'gate-check', caption: 'Rules: the Recreate gate check' },
      { id: 'settings-usage', caption: 'Budgets and usage' },
    ],
  },
  {
    id: 'feedback', group: 'Everything else', title: 'Prices, live status and Activity', color: 'amber',
    tagline: 'Every run shows its price first, then its live status.',
    where: 'Every button that starts work, and Activity in the sidebar',
    intro: 'A price button shows the price and the model before anything runs (Details shows the exact prompts). Over the confirm threshold it asks you to Confirm. Once it runs, a live line under it says Submitting, Queued, Generating (with the time and the usual time), Downloading, Checking, then Done. A failure says what happened in plain words, whether anything was charged, and offers Retry. Only the run you just started can be red: earlier failures fold into one gray line ("Earlier: 4 blocked by the filter, refunded; 1 not run. Nothing charged.") with Show and Clear. A run the provider\'s filter refused also names its likely trigger words and offers Retry with safer wording.',
    steps: [
      'Read the price and the model on the button.',
      'Press it (and Confirm if asked). Watch the live line under it.',
      'Done results get a highlight; if you scrolled away, a small toast has Show.',
      'Activity in the sidebar lists everything running and everything that finished in the last 15 minutes.',
      'A failed run: read why, open What was sent, then Retry (same request, new price) or, after a refusal, Retry with safer wording (only the trigger words change, by code; the rewording is free).',
      'Clear on the gray line hides those earlier failures for good in this browser.',
    ],
    tips: [
      'Demo mock, free next to a price means demo mode: nothing is charged.',
      '"Not confirmed" next to a price means it is a placeholder until that model\'s first real run.',
      'Each finished run logs its real cost next to its quote: the credits in your Higgsfield transactions on the plan, the measured tokens for Claude. More than 20% off is flagged under the still (What was sent) and in Settings > Budgets and usage.',
    ],
    shots: [
      { id: 'live-status', caption: 'A live status line' },
      { id: 'run-failures', caption: 'The run just refused, its trigger words and Retry with safer wording; earlier failures in one gray line' },
      { id: 'activity', caption: 'Activity' },
    ],
  },
]

export const GLOSSARY: Array<[string, string]> = [
  ['Chips (Idea step)', 'What your words already say about the shot (camera, phone camera, framing, outfit, makeup, place, light), read for free. Click one to change it; what you set wins.'],
  ['Send my prompt as written', 'A pasted prompt goes unchanged, with only the reference line, the 21+ line and the REALISM block added. No writer, no camera, light or outfit lines.'],
  ['More control', 'The collapsed part of the Idea step: character, account, format, places and every detail of the shot.'],
  ['What was sent', 'Under every still and on every failed run: the final prompt exactly as sent, the images and element attached, the model, the path, the settings, the price quoted next to the real cost, and why a failed run failed.'],
  ['Real cost', 'What a run actually took: the credits in your Higgsfield transactions on the plan, the measured tokens for Claude. More than 20% off the quote is flagged.'],
  ['Recreate from a real clip', 'Your character in a real clip: four stills in the clip\'s frame, an optional face pass, then the clip\'s real motion onto the still that passes both face checks.'],
  ['Face pass', 'On a Recreate still, only the face changes to match the character: it edits that still, so the place, outfit, pose and framing stay (one that changed the scene is marked not usable). It runs on the best still with Make 4 stills, and is skipped, not charged, when that still is already clear of the clip\'s person; Fix this face runs it on any other.'],
  ['Scene to keep / Source traits to drop', 'Recreate\'s chips: what of the clip stays (place, light, angle, props) and what of its person never carries over (hair color, eyes, piercings, makeup).'],
  ['Recreate gates', 'Fixed: the video starts only from a still whose face matches REF-00 (0.45 or more), beats its likeness to the person in the clip by a clear margin (0.12 or more), and whose likeness stays under 0.45 (or the numbers you approved in a gate check). A fail says why and offers another take.'],
  ['Gate check', 'After every 10 real recreates, Settings > Rules shows the face and margin scores of the stills you made videos from next to the ones you passed over, and suggests new gate numbers. Suggest only: the numbers change only when you press Use these numbers.'],
  ['Margin', 'On a Recreate still: its face match to REF-00 minus its likeness to the person in the clip. The gate needs 0.12 or more, so a still never passes looking almost as much like the source as like the character.'],
  ['Motion model', 'What moves the still like the clip: Genjutsu, Wan 3.0, Wan 3.0 Prime or Kling 3.0 Motion Control, each on your plan or the API, with its price.'],
  ['Billing path', 'How a run is paid: your Higgsfield plan (credits) or the Higgsfield API (dollars). Each model shows which one it uses.'],
  ['Spend cap', 'The most a recreate post may spend, in credits. A step that would pass it is refused with what is left.'],
  ['Drift marks', 'Red marks on the review strip where the face in the take drops under 0.45 against REF-00, the same number as the video rule.'],
  ['Earlier failures line', 'One gray line in place of a pile of red: how many runs before this one were blocked by the filter (refunded), never ran, or failed, and that nothing was charged. Show lists them; Clear hides them for good. Only the run you just started can be red.'],
  ['Catalog wording', 'Outfits said the way a shop catalog does: garment, color, fabric, a style word ("dark green ribbed tank top with thin straps, going-out look"). No fit or body words, no underwear-sounding names, a moment instead of a pose. Only the words change, never what she wears; your own words go as typed. The lists are config/wording.yaml.'],
  ['Likely trigger words', 'After a refusal by the provider\'s filter: the words in what was sent that filters often block (fit or body words, underwear-sounding names).'],
  ['Retry with safer wording', 'The refused run again with only its trigger words reworded by code ("tight" out, "boy shorts" to "bike shorts"). The rewording is free; the run is priced like the one that was refused.'],
  ['Speed marker', 'In the editor, a marker on the Presets track for a freeze or a speed ramp. Click it to open the Speed panel for that shot.'],
  ['Timeline', 'The post as one timeline: its shots, B-roll, captions, presets and sound. The Studio lays it out; the editor changes it.'],
  ['The editor', 'OpenReel, full screen over a post: place presets on the timeline, trim, move, retime. Done exports, saves to the post and returns.'],
  ['Edit in place', 'In the editor, double-click a caption (in the preview or on the timeline) to change its words where it sits. Enter saves, Esc cancels.'],
  ['Karaoke captions', 'A preset that lights up a caption\'s words one after another across the caption, in the Studio\'s yellow. The caption keeps its place, look and words.'],
  ['Ducking', 'The music dips under the voice line (or the clip\'s own sound) so the words stay clear. The editor applies it when a post opens.'],
  ['Ends with the last shot', 'In the editor, a caption or music that ended with the last shot keeps ending with it when the shots change length (speed, trim, delete), so the export stops with the video, not on black.'],
  ['Video rule', 'How a Recreate take is read: the stills\' numbers over the whole take (middle face match, middle margin, highest likeness). A take that misses is a warning with Keep this take and Try again, never thrown away.'],
  ['Preset', 'An edit you drop on the timeline at the playhead (a crash zoom, a speed ramp, karaoke captions): drag it, trim it, set its strength, change its keyframes.'],
  ['Continue this shot', 'Make the next take from the last frame of a clip, then join them into one longer clip.'],
  ['Shot B', 'The second shot of a two-shot edit (crash zoom cut, whip pan, hand over the lens, zoom-rotate spin), right after the clip; for split screen it plays beside or below it.'],
  ['Person mask', 'Her outline in every frame, made free on the worker, for text behind her, the green screen and the dolly zoom.'],
  ['Saved style', 'The presets on a timeline, saved with places like "at the payoff" or "on beat 4", so one click puts them on another post. Make another like this carries the post\'s own.'],
  ['Beat sync', 'Beats of the music (found by the editor, tapped or typed) shown on the timeline; clips and presets snap to them. The music can stay in the export or not.'],
  ['Payoff', 'The moment the video builds to. The editor can suggest it as a marker; you place presets on it with one click.'],
  ['Room tone', 'The quiet sound of a room, made by code. The default ambience; a silent video sounds dead.'],
  ['LUFS', 'How loud a video sounds overall. Posts are normalized to -14, like TikTok, Reels and Shorts play them.'],
  ['REF-00', 'The hero face. Every later image copies it.'],
  ['Reference sheet', 'REF-00 to REF-11: the same person from every angle, with expressions and full body.'],
  ['Still', 'A photo of a moment, made in a post\'s Stills step.'],
  ['Take', 'A video made from a still. Use this take keeps it.'],
  ['Clip', 'Any kept video: a take, an upload or a clone. It lives in Library > Clips.'],
  ['Clone', 'A saved TikTok or Reel rebuilt with your character.'],
  ['B-roll', 'A screen recording or phone video cut in before or after the clip.'],
  ['Director\'s notes', 'The writer\'s choices that make a shot memorable: the moment, the hook, the payoff, one camera move, depth, light, one contrast. Edit them and Rewrite follows them.'],
  ['REALISM block', 'The real-skin line added to every image prompt. Always on.'],
  ['Free checks', 'The face match against REF-00 and the skin check. They run on every still, take and clone.'],
  ['Check this', 'Claude looks closely at one result (marks, sides, logos, skin). Priced, on demand.'],
  ['Demo / Live', 'Demo makes free mock results. Live uses your real accounts and costs money.'],
  ['Plan credits / API', 'Higgsfield billing: your own account\'s credits, or the pay-per-use API.'],
  ['Fixed rule / default', 'Fixed rules always apply. Defaults are pre-filled and you can switch them off.'],
  ['Account tag', 'Which social account a post is for, like "Callie TikTok". Posts home filters by it.'],
  ['Voice card', 'How a character talks: point of view, words used and never used, emoji, humor, pillars, an example line, and their ElevenLabs voice. The writers follow it.'],
  ['Voice line', 'One line you performed, turned into the character\'s voice with every word timed. Library > Voice lines.'],
  ['Voiceover', 'A voice line laid over a video post, with the music and ambience dipping under it and captions from its words.'],
  ['Hook vault', 'A product\'s numbered opening lines, grouped by type. Library > Hooks.'],
  ['Variant', 'A hook rewritten in one character\'s voice, so accounts never post the same line.'],
  ['Claims sheet', 'What you can say about a product, and what never to say. Anything about the product stays inside it.'],
  ['Buyer language', 'Real phrases buyers use, collected from comments and reviews. The writers use them instead of marketing words.'],
  ['Scoreboard', 'Posts home > Accounts: accounts ranked by signups from their tracked link or promo code, never by views.'],
]

export const sectionById = (id: GuideId): GuideSection => GUIDE.find(s => s.id === id)!
