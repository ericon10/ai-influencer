// Response shapes from /api/v1 (see server/api/views.ts).

export type Side = 'LEFT' | 'RIGHT'

export interface Mark { name: string; description: string; side: Side; region: string; kind: 'skin' | 'jewelry'; subtle: boolean }

export interface CharacterData {
  name: string; age: number | null; card: string; eyes: string; marks: Mark[]; body: string
  pronouns: { subj: string; obj: string; poss: string; noun: string }
  disclosure: string; notes: string
  style: Record<string, unknown>; persona: Record<string, unknown>
  makeup: { default: string; glam_when: string[]; glam?: string }
  preferredModels: Record<string, string>; avoidModels: string[]
  identities: Array<{ provider: string; kind: 'element' | 'trained'; name: string; externalId: string; status: string; model?: string; promptBlock?: string; followUp?: { name: string; model?: string; text: string }; notes?: string }>
  sections: Array<{ title: string; body: string; wrapped?: string }>
}

export interface QaFinding { code: string; severity: 'fail' | 'warn' | 'info'; message: string; mark?: string }
export interface IdentityScore { kind: 'identity' | 'distinctness'; score: number; threshold: number; against: string }
export interface QaReport {
  verdict: 'post' | 'edit' | 'regenerate' | 'uncertain'; summary: string; findings: QaFinding[]; reasons: string[]; detectedView: string | null
  identity?: IdentityScore | null
  mirrorFix?: { available: boolean; message: string } | null
  // Fine skin detail after an upscale or edit, as a share of its input's.
  texture?: { ratio: number; smoothed: boolean; region: string; message: string } | null
}

// Scenes (Stage 7) and still edits (Stage 8).
export interface SceneFields {
  title: string; momentType: string; moment: string; setting: string; location: string
  outfit: string; footwear: string; jewelry: string; makeup: 'bare' | 'natural' | 'soft_glam'
  hair: string; pose: string; view: string; expression: string; camera: string; foreground: string
  task: string; trigger: string; distance: string; phone: '' | 'rear' | 'front'
  height: string; framing: string; light: string; destination: string
  brands: boolean; refs: string[]
  // A pasted prompt goes as written, plus only the fixed blocks.
  asWritten: boolean
}

// The rule book (Settings, Rules): fixed rules are always on; defaults are
// on unless switched off, for all characters or one, and only ever warn.
export interface RuleRow {
  id: string; title: string; bucket: 'fixed' | 'default'; area: string; spec: string; message: string; defaultValue: string | null
  global: { on: boolean; value: string | null; set: boolean }
  character: { on: boolean; value: string | null; set: boolean; valueSet: boolean } | null
}
export interface RulesView { areas: Record<string, string>; rules: RuleRow[] }

export interface SceneEdit { code: string; change: string; face: boolean }

export interface SceneStill extends Candidate {
  op: 'generate' | 'edit' | 'crop' | 'upscale' | 'mirror' | 'drift_lock' | 'end_frame' | 'video' | 'video_upscale' | 'upload' | 'clone' | 'chain' | 'last_frame'
  media: 'image' | 'video'
  parentId: string | null; sceneId: string
  qaReport: (QaReport & { edits?: SceneEdit[] }) | null
}

export interface SceneView {
  id: string; title: string; brief: string; fields: Partial<SceneFields>; planned: boolean; status: 'draft' | 'generating' | 'in_review' | 'approved'; busy: boolean
  createdAt: string; comboLogged: boolean; aspect: string; complete: boolean; missing: string[]
  combo: { moment: string; camera: string; light: string; location: string } | null
  comboProblem: string | null
  refs: Array<{ refId: string; role: 'face' | 'angle' | 'body' | 'expression'; assetId: string }>
  refsChosen: boolean
  // What the owner's words say (free, shotParse.ts), and the fields the
  // owner set by hand (which win).
  words: { read: Partial<SceneFields>; ownerSet: string[] }
  candidates: SceneStill[]
  // The prompt writer's text (or the owner's edit) for stills and video.
  prompts: { still: WrittenPrompt | null; video: WrittenPrompt | null }
  // What "Use the template" puts in the prompt box.
  templateText: string | null
}

export interface WrittenPrompt {
  text: string; source: 'claude' | 'owner' | 'template'; at: string; model?: string; words: number; stale: boolean
  motion?: string; directions?: string
  // The director's notes (default rule scene-directors-pass) and who set them.
  notes?: string; notesBy?: 'claude' | 'owner'
  // Mood words taken out (default rule prompt-no-flourish).
  removed?: string[]
}

// "What was sent" under a still or a take.
export interface SentView {
  candidateId: string | null; jobId: string; prompt: string; wrapped: string
  images: Array<{ assetId: string; role: 'ref' | 'start' | 'end' | 'source'; refId: string | null }>
  elements: Array<{ id: string; name: string }>
  model: string; ranOn: string; path: 'plan' | 'api' | 'demo'; pathLabel: string
  settings: Array<{ label: string; value: string }>
  quoted: string; actual: string | null; costNote: string | null; flagged: boolean; offPct: number | null
  status: string; error: string | null; providerJobId: string | null; at: string | null
}

export interface ScenePreset { id: string; label: string; hint?: string }
export interface SceneModel { ref: string; label: string; path: 'api' | 'account'; refs: number; trained: boolean; note: string }

export interface ScenesData {
  scenes: SceneView[]
  sheetRefs: Array<{ refId: string; label: string; assetId: string }>
  combos: Array<{ date: string; moment: string; camera: string; light: string; location: string }>
  reasons: Array<{ id: string; label: string }>
  options: {
    moments: ScenePreset[]; cameras: ScenePreset[]; lights: ScenePreset[]; framings: ScenePreset[]; expressions: ScenePreset[]; heights: ScenePreset[]
    autoQa: boolean; maxRefs: number; signatureJewelry: string[]
    makeup: ScenePreset[]; destinations: Array<ScenePreset & { aspect: string }>; views: ScenePreset[]
    editPresets: Array<ScenePreset & { text: string; face: boolean; group: 'quick' | 'diagnose'; hint: string }>
    diagnose: Array<{ symptom: string; revision: string }>
    stillModels: SceneModel[]; editModels: SceneModel[]; defaultModels: string[]
    maxVariations: number; maxModels: number; accountConnected: boolean; mode: 'demo' | 'live'
    stillLevels: Array<{ id: string; label: string; quality: string; resolution: string; models?: Record<string, { quality?: string; resolution?: string }> }>; stillLevel: string; defaultVariations: number
    promptWriter: { on: boolean; model: string; words: { still: [number, number]; video: [number, number] }; realism: string; directorsPass: boolean }
    video: {
      model: SceneModel; models: Array<SceneModel & { resolution: string | null }>; durations: number[]; duration: number; aspect: string; maxTakes: number; takes: number; directions: string
      test: { model: SceneModel; duration: number; label: string; note: string }
      upscale: SceneModel
      endFrame: { model: SceneModel; presets: Array<{ id: string; label: string; text: string }> }
    }
  }
}

export interface Candidate {
  id: string; assetId: string | null; status: string; refId: string | null; heroPromptIndex: number | null; prompt: string
  qaVerdict: QaReport['verdict'] | null; qaReport: QaReport | null; rejectReasons: string[]; rejectNote: string; favorite: boolean; createdAt: string
}

export type ShotStatus = 'pending' | 'generating' | 'in_review' | 'approved' | 'stale'

export interface Shot {
  id: string; label: string; view: string; framing: 'chest_up' | 'full_body'; aspect: string; attach: string[]
  status: ShotStatus; staleReason: string
  approved: { candidateId: string; assetId: string | null } | null
  candidates: Candidate[]
}

export interface Breakdown { keep: Array<{ aspect: string; detail: string }>; change: Array<{ feature: string; observed: string; direction: string }>; vibe: string; cautions: string[] }

export interface Concept { id: string; position: number; status: string; data: { name: string; age: number; card: string; marks: Mark[]; body: string; style: string; vibe: string; features?: { eyes?: string }; issues?: Array<{ field: string; message: string; severity: string }> } }

export interface Costs { spent: string; spentMicros: number; held: string; heldMicros: number; cap: string; capMicros: number; approvedAssets: number; costPerApproved: string | null; byStage: Array<{ stage: string; amount: string; micros: number }> }

export interface CharacterView {
  id: string; name: string; slug: string; stage: number; status: string; revision: number
  data: CharacterData; breakdown: Breakdown | null; issues: Array<{ field: string; message: string; severity: 'error' | 'warning' }>
  sheetLock: { model: string } | null
  ref00: { assetId: string; width: number | null; height: number | null; needsUpscale: boolean } | null
  cardSuggestion: { jobId: string; at: string | null; differences?: Array<{ field: string; card_says: string; image_shows: string }>; card?: string; marks?: Mark[] } | null
  inspirations: string[]; concepts: Concept[]; heroes: Candidate[]
  sheet: { shots: Shot[]; next: { refId: string; action: 'generate' | 'review' | 'recheck' } | null; progress: { approved: number; total: number; stale: number; complete: boolean } }
  costs: Costs
  reasons: Array<{ id: string; label: string }>
  variationDefault: number
  modelLabels: Record<string, string>
}

export interface CharacterSummary { id: string; name: string; stage: number; status: string; card: string; portraitAssetId: string | null; progress: { approved: number; total: number }; spent: string; updatedAt: string }

export interface QuoteView {
  id: string; total: string; totalMicros: number; verified: boolean; status: 'open' | 'blocked'; needsConfirm: boolean; expiresAt: string
  // Plan credits on the Higgsfield account path, and the price as shown.
  credits: number; display: string
  items: Array<{ label: string; model: string; modelLabel: string; amount: string; amountMicros: number; credits: number | null; verified: boolean }>
  // The models that will run, by name.
  models: string[]
  notes?: string[]
  budget: { ok: boolean; blocks: Array<{ scope: string; capMicros: number; afterMicros: number }>; warnings: Array<{ scope: string; capMicros: number; afterMicros: number }> }
}

export interface ActionPreview { title: string; prompts: Array<{ label: string; text: string; wrapped: string }>; warnings: Array<{ title: string; message: string; spec: string }>; invalidates: string[]; followUp?: { label: string; display: string; verified: boolean; models: string[] } }

export type StudioAction =
  | { type: 'breakdown'; characterId: string; notes?: string }
  | { type: 'concepts'; characterId: string; notes?: string }
  | { type: 'hero'; characterId: string; runsPerPrompt: number }
  | { type: 'upscale'; characterId: string }
  | { type: 'card_update'; characterId: string }
  | { type: 'sheet'; characterId: string; refId: string; variations: number; reason?: string; refsMode?: 'graph' | 'ref00_only'; withQa?: boolean }
  | { type: 'qa'; characterId: string; candidateId: string }
  | { type: 'model_test'; model: string }
  | { type: 'model_suite' }
  | { type: 'retry'; jobId: string }
  | { type: 'retry_safer'; jobId: string }
  | { type: 'scene_plan'; characterId: string; sceneId: string }
  | { type: 'scene_ideas'; characterId: string; idea: string }
  | { type: 'scene_prompt'; characterId: string; sceneId: string; target: 'still' | 'video'; motion?: string; directions?: string; startCandidateId?: string; endCandidateId?: string; notes?: string; durationSec?: number; audio?: boolean; aspect?: string }
  | { type: 'scene_video'; characterId: string; candidateId: string; endCandidateId?: string; model?: string; motion: string; directions: string; durationSec: number; aspect: string; audio: boolean; takes: number; test: boolean }
  | { type: 'scene_video_upscale'; characterId: string; candidateId: string }
  | { type: 'scene_end_frame'; characterId: string; candidateId: string; change: string; withQa?: boolean }
  | { type: 'scene'; characterId: string; sceneId: string; models: string[]; variations: number; reason?: string; withQa?: boolean; allowRepeat?: boolean; write?: boolean; level?: string }
  | { type: 'scene_edit'; characterId: string; candidateId: string; change: string; face?: boolean; model?: string; withQa?: boolean }
  | { type: 'scene_upscale'; characterId: string; candidateId: string }
  | { type: 'scene_qa'; characterId: string; candidateId: string }
  | { type: 'content_slides'; characterId: string; contentId: string }
  | { type: 'content_captions'; characterId: string; contentId: string }
  | { type: 'clone_caption'; characterId: string; contentId: string }
  | { type: 'clone'; contentId: string; characterIds: string[]; model?: string; mode?: CloneMode; background?: 'video' | 'image'; outfit?: 'source' | 'hers'; looks: Record<string, string>; keepSound: boolean; stills?: Record<string, string> }
  | { type: 'recreate_batch'; contentId: string; step: 'stills' | 'face' | 'video'; facePass?: boolean }
  | { type: 'clone_still'; contentId: string; characterId: string; outfit?: 'source' | 'hers'; look?: string; takes?: number; facePass?: boolean; stillModel?: string }
  | { type: 'clone_face'; contentId: string; characterId: string; candidateId: string; takes?: number }
  | { type: 'clone_traits'; contentId: string; characterId: string }
  | { type: 'voice_convert'; soundIds: string[] }
  | { type: 'hook_variants'; hookId: string; characterIds: string[]; perCharacter?: number }

// A run's live status (server/jobs/jobView.ts).
export type JobPhase = 'waiting' | 'queued' | 'submitting' | 'working' | 'sent' | 'provider_queued' | 'generating' | 'downloading' | 'checking' | 'done' | 'failed' | 'canceled' | 'needs_attention'
export interface JobView {
  id: string; label: string; purpose: string; stage: string; status: string; kind: string; model: string; modelName: string; characterId: string | null
  estimate: string; actual: string | null
  phase: JobPhase; phaseLabel: string; since: string; typicalSec: number | null
  error: string | null; detail: string | null; charged: 'no' | 'yes' | 'maybe' | null; retry: boolean
  // A refusal by the provider's filter: the likely trigger words in what was
  // sent, and whether "Retry with safer wording" can run (G46).
  triggers: string[]; safer: boolean
  createdAt: string; completedAt: string | null
}

export interface Me { email: string; role: string; accountId: string; mode: 'demo' | 'live'; auth: string }

export interface SettingsView {
  mode: 'demo' | 'live'
  modelSuite: {
    cap: string
    tests: Array<{
      ref: string; label: string; what: string; endpoint: string; path: 'api' | 'account'; testing: boolean
      lastTest: { at: string; ok: boolean; message: string; jobId: string } | null
      cost: string | null; estimate: string | null
    }>
  }
  credentials: Array<{ id: string; provider: string; last4: string; verifyStatus: string; verifiedAt: string | null; createdAt: string }>
  providers: Array<{ id: string; label: string; hint: string; placeholder: string; usedFor: string; serverKey?: boolean }>
  budgets: { job: number; character: number; month: number; confirmAbove: number; warnPct: number }
  routing: Array<{ task: string; configured: string; effective: string }>
  // Claude tasks and the model each runs on (Settings, Claude models).
  claude: {
    choices: Array<{ ref: string; label: string }>
    tasks: Array<{ task: string; label: string; hint: string; model: string; modelLabel: string; default: string; changed: boolean; rule: { id: string; on: boolean } | null }>
  }
  models: Array<{
    ref: string; label: string; kinds: string[]; verified: boolean; notes: string; api: boolean; reference: string | null
    endpoint: string; endpointSource: 'config' | 'account' | 'none'; confirmedAt: string | null
    lastTest: { at: string; ok: boolean; message: string; jobId: string } | null; testing: boolean
  }>
  prices: Array<{ model: string; unit: string; price: string; verified: boolean; source: string; when: string; credits: number | null }>
  priceVersion: string
  billing: { default: 'api' | 'account'; creditUsd: number; accountConnected: boolean; accountStatus: string | null; accountModels: string[] }
  connections: Array<{ id: string; label: string; site: string; status: 'live' | 'coming_soon'; note: string; connected: boolean; verifyStatus: string | null; connectedAt: string | null }>
}

export interface HiggsfieldAccount {
  connected: boolean
  connectedAt?: string
  verifyStatus?: string
  credits?: number | null
  plan?: string | null
  error?: string
}

export interface Usage {
  month: { since: string; spent: string; spentMicros: number; cap: string; capMicros: number; warnPct: number }
  held: string; heldMicros: number
  byCharacter: Array<{ characterId: string | null; name: string; amount: string; micros: number }>
  byModel: Array<{ model: string; runs: number; amount: string; micros: number }>
  recent: Array<{ id: string; at: string; type: string; amount: string; micros: number; stage: string; model: string; note: string; source: string }>
  // Quote against real cost, per run (flagged when more than 20% off).
  costChecks: Array<{ jobId: string; at: string; model: string; offPct: number | null; flagged: boolean; note: string; source: string }>
  flaggedChecks: number
}

export interface VideoPrice { model: string; label: string; display: string | null; verified: boolean; note: string | null }

// The content builder (text overlays): B-roll, meme videos, slideshows, batches.
export type ContentKind = 'meme' | 'slideshow' | 'batch'
export interface BrollClip { id: string; title: string; product: string; status: 'processing' | 'ready' | 'failed'; error: string | null; assetId: string | null; durationSec: number | null; createdAt: string }
export interface BrollTiming { order: 'clip_first' | 'broll_first'; brollStart: number; brollSeconds: number }
export interface MemeSpec extends BrollTiming {
  clipId: string | null; stillId: string | null; brollId: string | null; caption: string; clone: CloneSource | null
  sound?: Partial<SoundSpec>; cut?: Cut | null; continueFrom?: ContinueFrom | null
  edit?: Partial<EditSpec>; clipB?: string | null; stillB?: string | null; captionStyle?: CaptionStyle | null
  // No caption on this post (owner, 2026-10-15); the words are kept.
  captionOff?: boolean
  // The OpenReel editor's saved timeline (G29).
  editor?: { projectAssetId: string | null; savedAt: string | null } | null
}
// Phase 5: Amazing Edits (config/edits.yaml).
export type EditStyleId = 'crash_zoom' | 'speed_ramp' | 'punch_in' | 'freeze_pop' | 'flash_shake' | 'seamless_loop' | 'word_pop' | 'whip_pan' | 'hand_lens' | 'zoom_reveal'
  | 'velocity' | 'text_behind' | 'karaoke' | 'split_screen' | 'green_screen' | 'glitch' | 'spin' | 'dolly_zoom' | 'record_scratch' | 'snap_zoom'
export type EditStrength = 'subtle' | 'normal' | 'strong'
export interface EditSpec { style: 'none' | EditStyleId; strength: EditStrength; payoff: number | null; text: string; variant?: string }
export type CaptionStyle = 'box' | 'outline'
export interface EditStyleView { id: EditStyleId; label: string; line: string; shots: 1 | 2; anchor: string; slots: { a: string; b: string } | null; params: Record<EditStrength, Record<string, number>>; stage?: string; needs?: Array<'mask' | 'background'>; variants?: Array<{ id: string; label: string }> | null; text?: string | null }
// Phase 3: the sound bed, the rough cut and "Continue this shot".
export type SoundLevel = 'quiet' | 'normal' | 'loud'
export interface VoiceWord { text: string; start: number; end: number }
// A post's voiceover (voice lines): the line, where it starts, its level,
// and whether its words are the captions. The server copies the words.
export interface PostVoice { id: string; at: number; level: SoundLevel; captions: boolean; title?: string; words?: VoiceWord[] }
export interface SoundSpec { ambience: string; ambienceLevel: SoundLevel; music: string | null; musicLevel: SoundLevel; duck: boolean; clipSound: boolean; voice?: PostVoice | null }
export interface CutShot { id: string; kind: 'clip' | 'broll'; ref: string; in: number; out: number | null }
export interface CutCaption { id: string; text: string | null; start: number; end: number | null }
export interface Cut { auto: boolean; shots: CutShot[]; captions: CutCaption[] }
export interface ContinueFrom { clipId: string; frameId: string | null; status: 'preparing' | 'ready' | 'joining' | 'failed'; model: string | null; takeId: string | null; error: string | null }
// A voice line (Library > Voice lines): the owner's take, then the line in
// the character's voice with its word timings.
export interface VoiceLine {
  id: string; characterId: string | null; title: string; tag: string; hook: number | null; line: string
  status: 'processing' | 'take' | 'converting' | 'ready' | 'failed'; error: string | null
  takeAssetId: string | null; takeSec: number | null; assetId: string | null; durationSec: number | null
  words: VoiceWord[]; transcript: string; convertedAt: string | null; createdAt: string
}
// The voice card (Profile, Voice): how the character talks, and the
// ElevenLabs voice for voice lines. Every field optional.
export interface VoiceCard { elevenlabsId?: string; who?: string; talks?: string; uses?: string[]; never?: string[]; emoji?: string; humor?: string; pov?: string; pillars?: string[]; example?: string }
export interface SoundItem { id: string; kind: 'ambience' | 'music'; title: string; tag: string; status: 'processing' | 'ready' | 'failed'; error: string | null; assetId: string | null; durationSec: number | null; loudness: number | null; createdAt: string }
export interface CutShotView extends CutShot { title: string; assetId: string | null; posterId: string | null; sourceSec: number | null; start: number | null; durationSec: number | null; hasSound: boolean; ready: boolean; takes: number }
export interface CutView {
  auto: boolean; shots: CutShotView[]; captions: Array<CutCaption & { shown: string; linked: boolean }>; totalSec: number; complete: boolean
  limits: { maxSeconds: number; maxShots: number; maxCaptions: number }
  sound: { spec: SoundSpec; sounds: SoundItem[]; hasClipSound: boolean; targetLufs: number; levels: Record<SoundLevel, number>; maxUploadMb: number }
}
export interface SlideshowSpec { stillIds: string[]; topic: string; hook: string; slides: string[]; caption: string; hashtags: string[] }
// A batch rotates its clips and B-roll across the captions.
export interface BatchSpec extends BrollTiming { clipIds: string[]; brollIds: string[]; topic: string; count: number; captions: string[]; clone: CloneSource | null; sound?: Partial<SoundSpec>; edit?: Partial<EditSpec>; captionStyle?: CaptionStyle | null; captionOff?: boolean; stack?: StyleItem[] | null; styleName?: string | null }

// Clone Video (SPEC 13.1 R1): the post's saved TikTok or Reel, the models
// with their prices, and the results.
export type CloneMode = 'replace' | 'motion'
export interface PersonBox { x: number; y: number; w: number; h: number }
export interface CloneSource {
  status: 'preparing' | 'ready' | 'failed'; name: string; uploadId: string | null; assetId: string | null
  durationSec: number | null; hasAudio: boolean; trimmed: boolean; error: string | null
  firstFrameId?: string | null; people?: PersonBox[]; target?: { x: number; y: number } | null; stills?: Record<string, string>
  originalAssetId?: string | null; cleanAssetId?: string | null; cleanup?: { endCardSec: number | null; spots: number; on: boolean } | null
  textFrameId?: string | null; sourceCaption?: string | null
  // Recreate from a real clip: the frame about 0.2 s into the clip as
  // uploaded, the traits the character must not take from that person, and
  // the free read of the clip (dark, movement) that suggests the route.
  rawFrameId?: string | null; motionAssetId?: string | null; notLike?: string
  look?: { dark: boolean; motion: number; suggest: CloneMode; why: string } | null
  // Step 2 (owner, 2026-10-14): what to keep, the outfit, what happens in
  // the clip; the post's credit cap and what its steps started so far.
  keep?: string[]; outfit?: { choice: 'source' | 'hers'; text: string; lookId: string | null }; motion?: string
  capCredits?: number | null; spentCredits?: number; from?: string
}
// Recreate's stills model: Nano Banana 2.1 on the plan or GPT Image 2.5 on the API.
export interface StillChoice { ref: string; label: string; path: 'account' | 'api'; pathLabel: string; problem: string | null; note: string | null }
export type GateNumbers = { face_min: number; margin: number; source_max: number }
export interface GateSample { postId: string; candidateId: string; assetId: string | null; pass: 'still' | 'face'; face: number | null; likeness: number | null; margin: number | null; model: string | null; at: string }
// A take's scores over the whole take (the video rule) and the gate
// check's video section (owner, 2026-10-15).
export interface TakeGate { ok: boolean; face: number | null; likeness: number | null; margin: number | null; frames: number; reasons: string[]; note: string | null }
export interface TakeScore { postId: string; candidateId: string; assetId: string | null; face: number | null; likeness: number | null; margin: number | null; model: string | null; at: string }
export interface VideoGateView {
  count: number; every: number; reviewedAt: number; due: boolean; nextAt: number
  current: GateNumbers; suggested: GateNumbers | null; kept: TakeScore[]; triedAgain: TakeScore[]
  effect: { current: { keptPass: number; triedAgainHeld: number }; suggested: { keptPass: number; triedAgainHeld: number } | null }
  why: string[]
}
export interface GateCheckView {
  video: VideoGateView
  count: number; every: number; reviewedAt: number; due: boolean; nextAt: number
  current: GateNumbers; suggested: GateNumbers | null; picked: GateSample[]; passedOver: GateSample[]
  effect: { current: { pickedPass: number; passedOverHeld: number }; suggested: { pickedPass: number; passedOverHeld: number } | null }
  why: string[]
}
export interface StillGate { ok: boolean; face: number | null; likeness: number | null; margin: number | null; reasons: string[]; note: string | null }
export interface CloneStill {
  id: string; characterId: string; characterName: string; assetId: string | null; status: string; kept: boolean; error: string | null
  findings: Array<{ code: string; severity: string; message: string }>; createdAt: string
  // A face pass made from another still, and the free scores (face match
  // to REF-00, likeness to the person in the clip; null in demo mode).
  parentId: string | null; pass: 'still' | 'face'; faceScore: number | null; sourceScore: number | null
  // Why a face pass did not run when that is good news (status 'skipped').
  note: string | null
  // The gates before the video (fixed): whether it can start it, and why not.
  gate: StillGate
  // The run it came from (one click) and, for a failure, what kind: blocked
  // by the provider's filter, never run, or failed. None of them is charged.
  runId: string
  failure: 'blocked' | 'not_run' | 'failed' | null
  jobId: string | null
  triggers: string[]
  safer: boolean
}
export interface CloneModel {
  ref: string; label: string; mode: CloneMode; resolution: string | null; background: Array<'video' | 'image'>; minSec: number; maxSec: number
  path: 'account' | 'api'; pathLabel: string; note: string; display: string | null; verified: boolean; problem: string | null; takesPrompt: boolean
}
export interface CloneOptions {
  suggest: { mode: CloneMode; why: string } | null; takes: { still: number; face: number }; gate: { face_min: number; margin: number; source_max: number }; facePass: boolean; stillModel: { ref: string; label: string; onPlan: boolean; note: string | null }; stillModels: StillChoice[]; cap: { credits: number | null; spent: number } | null
  mode: CloneMode; outfit: 'source' | 'hers'; defaults: Record<CloneMode, string>; target: string; model: string; models: CloneModel[]; seconds: number; maxCharacters: number; keepSound: boolean; minSeconds: number; maxSeconds: number; maxUploadMb: number
}
// The review of a take (free, on the worker): the face every half second,
// text found on the frames, and cuts.
export interface CloneReview {
  at: string; duration: number; step: number; faceMin: number
  samples: Array<{ t: number; face: number | null; likeness: number | null }>
  drift: Array<{ start: number; end: number }>
  text: Array<{ t: number; kind: 'handle' | 'logo' | 'caption'; text: string; frameAssetId?: string | null }>
  cuts: number[]; notes: string[]
  gate?: TakeGate | null
}
export interface CloneResult {
  id: string; characterId: string; characterName: string; assetId: string | null; status: string; label: string
  durationSec: number | null; error: string | null; findings: Array<{ code: string; severity: string; message: string }>; createdAt: string
  sourceAssetId: string | null; review: CloneReview | null; model: string | null; parentId: string | null
  posters: { source: string | null; take: string | null }
  // The video rule over the take, the owner's call, a take the old check
  // rejected (shown again), and text found without frames yet.
  gate: TakeGate | null; decision: 'kept' | 'tried_again' | null; oldReject: string | null; needsFrames: boolean
  favorite: boolean
}
// A batch of recreates: each row a clip and a character in its own post.
export interface RecreateRow {
  postId: string; characterId: string; characterName: string; name: string; status: string; error: string | null; frameId: string | null; seconds: number | null
  model: string; modelLabel: string; stills: number; faces: number; still: { id: string; assetId: string | null; gate: StillGate } | null
  take: { id: string; assetId: string | null; status: string } | null
  next: 'preparing' | 'working' | 'stills' | 'face' | 'video' | 'waiting' | 'done' | 'failed'; why: string | null
}
export interface RecreateBatchView {
  rows: RecreateRow[]; max: number; defaultModel: string
  prices: Record<string, { step: 'stills' | 'face' | 'video'; display: string; credits: number | null; micros: number } | null>
}
export type PostStep = 'idea' | 'stills' | 'video' | 'text' | 'finish'
export interface ContentOutputs {
  videoAssetId?: string; imageAssetIds?: string[]; videos?: Array<{ caption: string; assetId: string; clipId?: string; brollId?: string | null } | null>; zipAssetId?: string
  done?: number; failed?: number; total?: number; dropped?: string[]; renderedAt?: string
  durationSec?: number; sound?: { layers: Array<'clip' | 'ambience' | 'music'>; targetLufs: number | null; ducked: boolean }
  errors?: Record<string, string>; zipParts?: Array<{ assetId: string; from: number; to: number }>; editNote?: string | null
  fromEditor?: boolean; fromTimeline?: boolean; editorOnly?: string[]
}
export interface ContentItem {
  id: string; kind: ContentKind; characterId: string | null; title: string; spec: Record<string, unknown>
  idea: string; sceneId: string | null; accountTag: string; step: PostStep
  status: 'draft' | 'rendering' | 'ready' | 'failed'; outputs: ContentOutputs; error: string | null; createdAt: string; updatedAt: string
}
export interface ContentData {
  broll: BrollClip[]; products: string[]; items: ContentItem[]; accountTags: string[]
  options: {
    caption: { size: number; safe: { top: number; bottom: number; left: number; right: number }; position: 'top' | 'upper_third' | 'middle' | 'bottom'; maxChars: number; box: { fill: string; text: string; radius: number; pad_x: number; pad_y: number }; style?: CaptionStyle | 'plain'; outline?: { text: string; stroke: string; width: number }; karaoke?: { fill: string; text: string; color: string } }
    canvas: { width: number; height: number; fps: number }
    meme: { max_clip_seconds: number; broll_seconds: number; max_broll_seconds: number; order: 'clip_first' | 'broll_first' }
    slideshow: { slides: [number, number]; maxStills: number }
    batch: { max: number; default_count: number }
    maxUploadMb: number
    cut?: { max_seconds: number; max_shots: number; max_captions: number }
    sound?: { defaultAmbience: 'none' | 'room'; targetLufs: number; maxUploadMb: number }
    chain?: { maxParts: number }
    edits?: { styles: EditStyleView[]; payoffFromEnd: number }
  }
}

// The worker light in the header (server/jobs/workerStatus.ts).
export interface WorkerStatus {
  state: 'ready' | 'restarting' | 'down'; message: string; version: string | null; expected: string | null
  commit: string | null; startedAt: string | null; lastSeenAt: string | null; inProcess: boolean
}


// The Library: everything made, across characters (server/pipeline/clips.ts).
export interface LibraryStill { id: string; assetId: string; characterId: string; characterName: string; sceneId: string | null; sceneTitle: string; status: string; op: string; createdAt: string }
export interface LibraryClip extends LibraryStill { posterId: string | null; durationSec: number | null; title: string; error: string | null }
export interface LibraryData { stills: LibraryStill[]; clips: LibraryClip[] }

// Saved styles from the editor (editor phase C, G31): presets with places
// relative to the video.
export interface StyleAnchor { on: 'payoff' | 'cut' | 'beat' | 'start' | 'end'; index: number; offset: number; ratio: number }
export interface StyleItem { preset: string; strength: 'subtle' | 'normal' | 'strong'; at: StyleAnchor; duration: number | null; keys: Array<Record<string, number | string>> | null }
export interface EditorStyle { id: string; name: string; items: StyleItem[]; createdAt: string }

// Spreadsheet import inside a batch (overnight item 3).
export interface ImportRow {
  line: number; characterId: string | null; characterName: string; accountTag: string; clipId: string | null; clipTitle: string | null
  stillPrompt: string | null; videoPrompt: string | null; caption: string; style: string | null
  status: 'reuse' | 'generate' | 'problem'; problems: string[]; priceUsd: number
}
export interface ImportPreview { rows: ImportRow[]; problems: string[]; totals: { rows: number; reuse: number; generate: number; problem: number; usd: number }; priceNote: string }

// The scale kit (Library > Hooks, Posts home > Accounts).
export interface KitGroup { label: string; items: string[] }
export interface ProductClaims { groups: KitGroup[]; lines: KitGroup[]; watch: string[]; mentions: string[] }
export interface HookVariant { id: string; characterId: string; text: string; flags: string[]; createdAt: string }
export interface KitHook { id: string; number: number; kind: string; text: string; variants: HookVariant[] }
export interface ProductSummary { id: string; name: string; hooks: number }
export interface ProductView {
  id: string; name: string; claims: ProductClaims; language: { groups: KitGroup[] }
  voices: Array<{ name: string; status: 'live' | 'proposed'; card: VoiceCard }>; notes: string; hooks: KitHook[]
}
export interface SocialAccount {
  tag: string; characterId: string | null; productId: string | null; link: string; code: string; signups: number; views: number | null; notes: string
  posts: number; exported: number; perPost: number | null; updatedAt: string | null; rank: number
}

// Storage, traffic and auto-clean (owner, 2026-10-15; UX-PLAN.md section 22).
export interface StorageInfo {
  driver: string; bucket: string | null; origins: string[]; corsRules: unknown[]
  usage: { bytes: number; files: number; uploadsWaiting: number; measuredAt: string } | null
  monthlyCost: number | null; priceNote: string
  autoCleanDays: number | null; autoCleanChoices: number[]
  autoCleanNext: number; autoCleanStarted: boolean
  trashDays: number; uploadSlotDays: number; cleanedAt: string | null; measuring: boolean
  worker: { freeDiskMb: number | null; checkedAt: string | null }
}
// The next Auto-clean, listed without moving anything.
export interface AutoCleanItem {
  id: string; kind: 'take' | 'still'; label: string; assetId: string | null; media: 'image' | 'video'
  characterId: string; postId: string; postName: string; finishedAt: string
}
export interface TrashRef { kind: 'candidate' | 'broll' | 'sound' | 'render'; id: string }
export interface TrashItem {
  id: string; kind: TrashRef['kind']; refId: string; label: string; characterId: string | null; reason: 'owner' | 'auto'
  assetId: string | null; media: 'image' | 'video' | 'audio' | 'file' | null
  deletedAt: string; purgeAfter: string; daysLeft: number
}
