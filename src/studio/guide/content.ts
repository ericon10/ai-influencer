// The Guide (owner, 2026-10-13; UX-PLAN.md pattern 12): the visual manual.
// Each section explains one page or post step: what it is, what to do,
// tips, what costs money, and annotated screenshots of the real screen
// (shots.json, made from the Studio in demo mode). The same sections open
// in a drawer from the "How this works" button on each page and step.

export type GuideColor = 'orange' | 'pink' | 'violet' | 'blue' | 'teal' | 'green' | 'amber' | 'red'

export type GuideId =
  | 'big-picture' | 'posts' | 'characters' | 'setup-start' | 'setup-face' | 'setup-sheet' | 'setup-file'
  | 'post-idea' | 'post-stills' | 'post-video' | 'post-clone' | 'post-text' | 'post-finish'
  | 'library' | 'settings' | 'feedback' | 'realism'

export interface GuideSection {
  id: GuideId
  group: 'Start here' | 'Set up a character' | 'Make a post' | 'Everything else'
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
  { n: 7, title: 'Export and download', text: 'Export MP4 is free. Download it, post it, and turn on the AI-generated label.', shot: 'post-finish', color: 'green', focus: [8, 22, 1.8] },
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
      'Library has every still, clip, B-roll video and export. Any of them can start a new post.',
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
    tips: ['Images named REF 00 to REF 11 (or REF-00) become approved sheet shots when you import them.'],
    shots: [{ id: 'setup-file', caption: 'The character file' }],
  },
  {
    id: 'post-idea', group: 'Make a post', title: 'Step 1: Idea', color: 'pink',
    tagline: 'What happens, in your own words. The only required field.',
    where: 'Any post > Idea',
    intro: 'Write one sentence: who does what, where. That sentence drives everything after it: the planner, the prompt writer and the video. Pick the character and the account tag here too.',
    steps: [
      'Type the idea. It saves as you type.',
      'Punch it up (optional) writes three sharper, more specific versions to pick from.',
      'Check the character, and set the account tag (which TikTok or Instagram it is for).',
    ],
    tips: ['Specific beats general: "stirs her coffee at a window seat when a friend says her name" works better than "drinks coffee".'],
    cost: 'Punch it up is a small Claude call (under a cent).',
    shots: [{ id: 'post-idea', caption: 'The Idea step' }],
  },
  {
    id: 'post-stills', group: 'Make a post', title: 'Step 2: Stills', color: 'amber',
    tagline: 'Photos of the moment. The best one starts the video.',
    where: 'A video post or slideshow > Stills',
    intro: 'Write and generate does two things for one price: Claude writes the prompt from your idea (with Director\'s notes on what makes it memorable), then the stills run on it. The prompt stays in the box, editable, for the next run. Details (outfit, place, camera, light, her task, what catches her attention) are optional: Plan the details fills them from your idea.',
    steps: [
      'Pick a model (up to 2 to compare) and how many stills per model.',
      'Press Write and generate. Each still shows the free checks when it lands.',
      'Edit the Director\'s notes or the prompt if you like, then Rewrite or Generate again.',
      'Open a still to look closely: Check this (Claude), Fix one thing, crop closer, upscale.',
      'Press Use this still on the best one. It moves you to the Video step and Claude writes the video prompt from it.',
    ],
    tips: [
      'Fix one thing makes one change and keeps the rest of the still. Diagnose and revise has one-click fixes: plastic face, staged pose, morphing hands, synchronized background, fake low light, overprocessed.',
      'Face drift (the face does not match REF-00) is usually a regenerate, not an edit.',
      'Already have a still? Pick a still from the Library. Already have a clip? Skip: I have a clip.',
    ],
    cost: 'Each still is one image; the prompt writer is a small Claude call. One price on the button for both.',
    shots: [
      { id: 'post-stills-start', caption: 'Before generating' },
      { id: 'post-stills-done', caption: 'The written prompt, Director\'s notes and the stills' },
      { id: 'still-drawer', caption: 'A still opened: the free checks' },
      { id: 'still-fix', caption: 'Fix one thing and Diagnose and revise' },
    ],
  },
  {
    id: 'post-video', group: 'Make a post', title: 'Step 3: Video', color: 'blue',
    tagline: 'Four ways to get the clip. Picking one keeps it.',
    where: 'A video post > Video (a batch calls it Clips)',
    intro: 'Make a video from a still turns your still into a real video (Kling, Seedance and others). Claude writes the video prompt in labeled lines: FORMAT, SUBJECT, SETTING/LIGHT, CAMERA, ACTION, CONTINUITY, AUDIO, CONSTRAINTS. FORMAT (9:16) and AUDIO (sound off unless you turn it on) are always set by the Studio. You can also clone a TikTok, upload a video, or pick a clip from the Library.',
    steps: [
      'Read or edit the video prompt and the Director\'s notes (hook in the first second, payoff in the last two, one camera move).',
      'Pick a video model. Each shows the price of one take; your pick is remembered.',
      'Set the length, shape, sound and number of takes, then press Generate a take.',
      'Press Use this take on the one you like. Upscale this take adds detail to the exact same take later.',
    ],
    tips: [
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
    id: 'post-clone', group: 'Make a post', title: 'Clone a TikTok or Reel', color: 'blue',
    tagline: 'The same motion and camera, rebuilt with your character.',
    where: 'A video post or batch > Video > Clone a TikTok or Reel',
    intro: 'Save a TikTok or Reel to your device, then choose the file here. The Studio keeps a copy with its sound. Clone it rebuilds the clip with your character, or with several characters at once on one price. Each clone is checked for free (the face, the skin, and that it is not the person in the original) and kept in Library > Clips.',
    steps: [
      'Choose the video (3 to 30 seconds; longer is cut to 30).',
      'Pick who is in it: the post\'s character is already picked; add others for a clone each.',
      'Pick a clone model. Some keep the clip\'s place; others take the place from the character image.',
      'Original sound is off by default. Turn it on to put the clip\'s own sound back.',
      'Press Clone it, then Use this clip.',
    ],
    tips: [
      'A clone that looks like the person in the original is never kept: the character must be a new person.',
      'Another character\'s clone has Make a video post: a new post for that character, ready at the caption.',
    ],
    cost: 'Priced per second of the clip, per character, on the button.',
    shots: [{ id: 'post-clone', caption: 'Clone a TikTok or Reel' }],
  },
  {
    id: 'post-text', group: 'Make a post', title: 'Step 4: Caption, slides or captions', color: 'teal',
    tagline: 'The words on the post, with a live TikTok preview.',
    where: 'Any post > Caption (Slides for a slideshow, Captions for a batch)',
    intro: 'A video post has one caption in TikTok\'s white box. A slideshow has a hook on slide 1, slides, a post caption and hashtags; Claude can write them. A batch has one caption per line, one video each; Claude can write as many as you ask for.',
    steps: [
      'Video post: type the caption and watch the preview.',
      'Slideshow: press Write the slides (or type them), add or remove slides, then the caption and hashtags.',
      'Batch: set How many, press Write, and edit the list. The clips rotate across the captions.',
    ],
    tips: ['The preview uses the same font, box and safe zones as the export, so what you see is what you get.'],
    cost: 'Writing slides or captions is a small Claude call. Typing them is free.',
    shots: [
      { id: 'post-caption', caption: 'Video post: the caption' },
      { id: 'post-slideshow', caption: 'Slideshow: the hook and slides' },
      { id: 'post-batch', caption: 'Batch: one caption per video' },
    ],
  },
  {
    id: 'post-finish', group: 'Make a post', title: 'Step 5: Finish', color: 'green',
    tagline: 'Export, download, post. Free.',
    where: 'Any post > Finish',
    intro: 'Export MP4 renders the post on the Studio\'s own worker: 9:16, the caption burned in, B-roll cut in. It costs nothing. Download it and post it. A slideshow exports JPEG slides; a batch exports every video and a zip.',
    steps: [
      'Press Export MP4 (it shows what is still missing if anything is).',
      'Download MP4.',
      'Turn on TikTok\'s AI-generated content label when you post.',
      'Make another like this for the next one in a series.',
    ],
    tips: ['Change anything above and press Export MP4 again for a new version.'],
    cost: 'Free.',
    shots: [{ id: 'post-finish', caption: 'Finish' }],
  },
  {
    id: 'library', group: 'Everything else', title: 'Library', color: 'teal',
    tagline: 'Everything you made, ready to reuse.',
    where: 'Sidebar > Library',
    intro: 'Stills, Clips (kept takes, uploads and clones), B-roll and finished Posts, across all characters. Open anything to see it, download it, or start a new post from it. Upload B-roll and clips here too.',
    steps: [
      'Pick a tab: Stills, Clips, B-roll or Posts.',
      'Filter by character.',
      'Open an item, then Use in a new post.',
    ],
    tips: ['Inside a post, the same Library opens as a drawer: pick, and it drops into the step.'],
    shots: [{ id: 'library', caption: 'The Library' }],
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
      'Budgets and usage: set the monthly and per-run caps.',
    ],
    tips: [
      'Fixed rules: real skin, 21 or older, nothing explicit, a new person (never a copy), the AI label, the price first, budget caps, keys on the server.',
      'Defaults include the Director\'s pass, the prompt writer, automatic Claude checks and the variety note.',
    ],
    shots: [
      { id: 'settings-general', caption: 'General' },
      { id: 'settings-rules', caption: 'Rules: fixed and defaults' },
      { id: 'settings-usage', caption: 'Budgets and usage' },
    ],
  },
  {
    id: 'feedback', group: 'Everything else', title: 'Prices, live status and Activity', color: 'amber',
    tagline: 'Every run shows its price first, then its live status.',
    where: 'Every button that starts work, and Activity in the sidebar',
    intro: 'A price button shows the price and the model before anything runs (Details shows the exact prompts). Over the confirm threshold it asks you to Confirm. Once it runs, a live line under it says Submitting, Queued, Generating (with the time and the usual time), Downloading, Checking, then Done. A failure says what happened in plain words, whether anything was charged, and offers Retry.',
    steps: [
      'Read the price and the model on the button.',
      'Press it (and Confirm if asked). Watch the live line under it.',
      'Done results get a highlight; if you scrolled away, a small toast has Show.',
      'Activity in the sidebar lists everything running and everything that finished in the last 15 minutes.',
    ],
    tips: [
      'Demo mock, free next to a price means demo mode: nothing is charged.',
      '"Not confirmed" next to a price means it is a placeholder until that model\'s first real run.',
    ],
    shots: [
      { id: 'live-status', caption: 'A live status line' },
      { id: 'activity', caption: 'Activity' },
    ],
  },
]

export const GLOSSARY: Array<[string, string]> = [
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
]

export const sectionById = (id: GuideId): GuideSection => GUIDE.find(s => s.id === id)!
