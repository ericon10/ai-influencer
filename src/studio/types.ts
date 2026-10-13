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
  items: Array<{ label: string; model: string; amount: string; amountMicros: number; credits: number | null; verified: boolean }>
  budget: { ok: boolean; blocks: Array<{ scope: string; capMicros: number; afterMicros: number }>; warnings: Array<{ scope: string; capMicros: number; afterMicros: number }> }
}

export interface ActionPreview { title: string; prompts: Array<{ label: string; text: string; wrapped: string }>; warnings: Array<{ title: string; message: string; spec: string }>; invalidates: string[] }

export type StudioAction =
  | { type: 'breakdown'; characterId: string; notes?: string }
  | { type: 'concepts'; characterId: string; notes?: string }
  | { type: 'hero'; characterId: string; runsPerPrompt: number }
  | { type: 'upscale'; characterId: string }
  | { type: 'card_update'; characterId: string }
  | { type: 'sheet'; characterId: string; refId: string; variations: number; reason?: string; refsMode?: 'graph' | 'ref00_only'; withQa?: boolean }
  | { type: 'qa'; characterId: string; candidateId: string }
  | { type: 'model_test'; model: string }

export interface JobView { id: string; label: string; purpose: string; stage: string; status: string; kind: string; model: string; characterId: string | null; estimate: string; actual: string | null; error: string | null; createdAt: string; completedAt: string | null }

export interface Me { email: string; role: string; accountId: string; mode: 'demo' | 'live'; auth: string }

export interface SettingsView {
  mode: 'demo' | 'live'
  credentials: Array<{ id: string; provider: string; last4: string; verifyStatus: string; verifiedAt: string | null; createdAt: string }>
  providers: Array<{ id: string; label: string; hint: string; placeholder: string; usedFor: string }>
  budgets: { job: number; character: number; month: number; confirmAbove: number; warnPct: number }
  routing: Array<{ task: string; configured: string; effective: string }>
  models: Array<{
    ref: string; label: string; kinds: string[]; verified: boolean; notes: string
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
}
