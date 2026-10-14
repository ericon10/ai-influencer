import type { ActionPreview, CharacterSummary, CharacterView, HiggsfieldAccount, JobView, Me, QuoteView, RulesView, SceneFields, ScenesData, SettingsView, StudioAction, Usage, VideoPrice, BrollClip, ContentData, ContentKind, LibraryData, PostStep, WorkerStatus, CloneOptions, CloneResult, CutView, SoundItem } from './types'
import { sheetRefOf, typeOf, uploadFiles } from './files'

// Thin client for /api/v1. Every write sends the CSRF header the server
// requires; errors come back as ApiError with the server's plain message.

export class ApiError extends Error {
  constructor(readonly status: number, readonly code: string, message: string, readonly details: unknown = null) {
    super(message)
  }
}

async function request<T>(method: string, path: string, body?: unknown, signal?: AbortSignal): Promise<T> {
  const headers: Record<string, string> = {}
  let payload: BodyInit | undefined
  if (body instanceof FormData) payload = body
  else if (body !== undefined) { payload = JSON.stringify(body); headers['content-type'] = 'application/json' }
  if (method !== 'GET') headers['x-studio-request'] = '1'
  const res = await fetch(`/api/v1${path}`, { method, headers, body: payload, credentials: 'same-origin', signal })
  const text = await res.text()
  let json: unknown = null
  try { json = text ? JSON.parse(text) : null } catch { /* non-JSON */ }
  if (!res.ok) {
    const e = (json as { error?: { code?: string; message?: string; details?: unknown } } | null)?.error
    throw new ApiError(res.status, e?.code ?? 'error', e?.message ?? (res.status === 502 || res.status === 504 ? 'The Studio did not answer in time. Try again in a moment.' : `Request failed (${res.status}).`), e?.details)
  }
  return json as T
}

export const assetUrl = (id: string, width?: number) => `/api/v1/assets/${id}/content${width ? `?w=${width}` : ''}`
// A download under a readable name (videos and zips come straight from storage).
export const downloadUrl = (id: string, name: string) => `/api/v1/assets/${id}/content?download=1&name=${encodeURIComponent(name)}`

export const api = {
  me: () => request<Me>('GET', '/me'),
  login: (email: string, passphrase: string) => request<{ ok: true }>('POST', '/auth/login', { email, passphrase }),
  logout: () => request<{ ok: true }>('POST', '/auth/logout', {}),

  characters: () => request<{ characters: CharacterSummary[] }>('GET', '/characters'),
  createCharacter: (name: string) => request<{ id: string }>('POST', '/characters', { name }),
  character: (id: string) => request<CharacterView>('GET', `/characters/${id}`),
  updateCharacter: (id: string, patch: Record<string, unknown>, reason = 'edited') => request<CharacterView>('PATCH', `/characters/${id}`, { patch, reason }),
  archiveCharacter: (id: string) => request<{ ok: true }>('DELETE', `/characters/${id}`),
  addInspiration: async (id: string, file: File) => {
    const [up] = await uploadFiles([file])
    return request<{ assetId: string }>('POST', `/characters/${id}/inspirations`, { uploads: [up] })
  },
  chooseConcept: (conceptId: string) => request<{ ok: true }>('POST', `/concepts/${conceptId}/choose`, {}),

  approve: (candidateId: string, acknowledge = false) => request<{ invalidated: string[]; sheetComplete: boolean; comboLogged?: boolean }>('POST', `/candidates/${candidateId}/approve`, acknowledge ? { acknowledge } : {}),
  rules: (characterId?: string | null) => request<RulesView>('GET', `/settings/rules${characterId ? `?characterId=${encodeURIComponent(characterId)}` : ''}`),
  setRule: (body: { ruleId: string; characterId?: string | null; on?: boolean | null; value?: string | null }) => request<RulesView>('PUT', '/settings/rules', body),
  reject: (candidateId: string, reasons: string[], note: string) => request<{ fixes: Array<{ reason: string; action: string; label: string; available: boolean }> }>('POST', `/candidates/${candidateId}/reject`, { reasons, note }),
  reopen: (candidateId: string) => request<{ ok: true }>('POST', `/candidates/${candidateId}/reopen`, {}),
  pickHero: (candidateId: string) => request<{ needsUpscale: boolean; height: number | null }>('POST', `/candidates/${candidateId}/pick-hero`, {}),
  favorite: (candidateId: string, favorite: boolean) => request<{ ok: true }>('POST', `/candidates/${candidateId}/favorite`, { favorite }),
  keepStale: (characterId: string, refId: string) => request<{ ok: true }>('POST', `/characters/${characterId}/sheet/${refId}/keep`, {}),

  // A character file and its sheet images. Images go straight to storage;
  // names like "REF 00" are normalized; the face and skin checks run after.
  importCharacter: async (markdown: string, images: File[], onProgress?: (done: number, total: number) => void) => {
    const uploads = await uploadFiles(images.filter(f => sheetRefOf(f.name)), onProgress)
    return request<{ characterId: string; importedShots: string[]; checkShots: string[]; checkJobId: string | null; warnings: string[] }>('POST', '/characters/import', { markdown, uploads })
  },
  exportUrl: (id: string) => `/api/v1/characters/${id}/export`,
  applyFile: async (id: string, files: File[], onProgress?: (done: number, total: number) => void) => {
    const md = files.find(f => f.name.toLowerCase().endsWith('.md'))
    const uploads = await uploadFiles(files.filter(f => typeOf(f).startsWith('image/') && sheetRefOf(f.name)), onProgress)
    return request<{ warnings: string[]; importedShots: string[]; checkShots: string[]; checkJobId: string | null; view: CharacterView }>('POST', `/characters/${id}/import-file`, { markdown: md ? await md.text() : undefined, uploads })
  },
  setModelEndpoint: (ref: string, endpoint: string) => request<SettingsView>('PUT', '/settings/models', { ref, endpoint }),
  mirror: (candidateId: string) => request<{ candidateId: string }>('POST', `/candidates/${candidateId}/mirror`),

  // Scenes (Stage 7) and still edits (Stage 8).
  scenes: (characterId: string) => request<ScenesData>('GET', `/characters/${characterId}/scenes`),
  copyScene: (id: string, characterIds: string[]) => request<{ copies: Array<{ characterId: string; sceneId: string; name: string }> }>('POST', `/scenes/${id}/copy`, { characterIds }),
  createScene: (characterId: string, body: { brief?: string; title?: string; fields?: Partial<SceneFields> }) => request<{ id: string }>('POST', `/characters/${characterId}/scenes`, body),
  updateScene: (sceneId: string, body: { brief?: string; title?: string; fields?: Partial<SceneFields>; prompts?: { still?: string; video?: string }; fromTemplate?: boolean; notes?: { still?: string; video?: string } }) => request<{ id: string }>('PATCH', `/scenes/${sceneId}`, body),
  videoPrices: (characterId: string, duration: number, aspect: string) => request<{ prices: VideoPrice[] }>('GET', `/characters/${characterId}/video-prices?duration=${duration}&aspect=${encodeURIComponent(aspect)}`),
  setVideoModel: (model: string) => request<{ model: string }>('PUT', '/settings/video-model', { model }),
  worker: () => request<WorkerStatus>('GET', '/worker'),
  // The content builder.
  content: () => request<ContentData>('GET', '/content'),
  addBroll: async (file: File, product: string, onProgress?: (done: number, total: number) => void) => {
    const [up] = await uploadFiles([file], onProgress)
    return request<BrollClip>('POST', '/broll', { uploadId: up!.uploadId, name: file.name, product })
  },
  updateBroll: (id: string, patch: { title?: string; product?: string }) => request<BrollClip>('PATCH', `/broll/${id}`, patch),
  archiveBroll: (id: string) => request<{ ok: true }>('DELETE', `/broll/${id}`),
  createContent: (body: { kind: ContentKind; characterId: string; title?: string; spec?: Record<string, unknown>; idea?: string; accountTag?: string; sceneId?: string | null; step?: PostStep }) => request<{ id: string }>('POST', '/content', body),
  updateContent: (id: string, patch: { title?: string; spec?: Record<string, unknown>; idea?: string; accountTag?: string; sceneId?: string | null; step?: PostStep; characterId?: string }) => request<{ id: string }>('PATCH', `/content/${id}`, patch),
  duplicateContent: (id: string) => request<{ id: string }>('POST', `/content/${id}/duplicate`, {}),
  postScene: (id: string) => request<{ id: string; sceneId: string }>('POST', `/content/${id}/scene`, {}),
  library: (characterId?: string | null) => request<LibraryData>('GET', `/library${characterId ? `?characterId=${encodeURIComponent(characterId)}` : ''}`),
  // Any video file becomes a kept clip of the character (and is picked in
  // the post it was uploaded from).
  addClip: async (characterId: string, file: File, contentId?: string, onProgress?: (done: number, total: number) => void) => {
    const [up] = await uploadFiles([file], onProgress)
    return request<{ id: string }>('POST', `/characters/${characterId}/clips`, { uploadId: up!.uploadId, name: file.name, ...(contentId ? { contentId } : {}) })
  },
  // Clone Video: the saved TikTok or Reel goes up, the worker keeps a lean
  // copy with its sound; then the models with prices, and the results.
  addCloneSource: async (contentId: string, file: File, onProgress?: (done: number, total: number) => void) => {
    const [up] = await uploadFiles([file], onProgress)
    return request<{ ok: true }>('POST', `/content/${contentId}/clone-source`, { uploadId: up!.uploadId, name: file.name })
  },
  cloneOptions: (contentId: string) => request<CloneOptions>('GET', `/content/${contentId}/clone-options`),
  clones: (contentId: string) => request<{ clones: CloneResult[] }>('GET', `/content/${contentId}/clones`),
  keepClone: (id: string, acknowledge = false) => request<{ ok: true }>('POST', `/clones/${id}/keep`, { acknowledge }),
  postFromClone: (contentId: string, cloneId: string, acknowledge = false) => request<{ id: string }>('POST', `/content/${contentId}/clones/${cloneId}/post`, { acknowledge }),
  setCloneModel: (model: string) => request<{ model: string }>('PUT', '/settings/clone-model', { model }),
  archiveContent: (id: string) => request<{ ok: true }>('DELETE', `/content/${id}`),
  renderContent: (id: string) => request<{ id: string; status: string }>('POST', `/content/${id}/render`, {}),
  // Phase 3: the rough cut and sound bed, "Continue this shot", the sound library.
  cut: (id: string) => request<CutView>('GET', `/content/${id}/cut`),
  continueShot: (id: string) => request<{ id: string }>('POST', `/content/${id}/continue`, {}),
  chainUse: (id: string, takeId: string) => request<{ id: string }>('POST', `/content/${id}/continue/use`, { takeId }),
  twoShots: (id: string) => request<{ id: string }>('POST', `/content/${id}/continue/two-shots`, {}),
  cancelContinue: (id: string) => request<{ id: string }>('DELETE', `/content/${id}/continue`),
  sounds: () => request<{ sounds: SoundItem[] }>('GET', '/sounds'),
  addSound: async (file: File, kind: 'ambience' | 'music', onProgress?: (done: number, total: number) => void) => {
    const [up] = await uploadFiles([file], onProgress)
    return request<SoundItem>('POST', '/sounds', { uploadId: up!.uploadId, name: file.name, kind })
  },
  updateSound: (id: string, patch: { title?: string; tag?: string; kind?: 'ambience' | 'music' }) => request<SoundItem>('PATCH', `/sounds/${id}`, patch),
  archiveSound: (id: string) => request<{ ok: true }>('DELETE', `/sounds/${id}`),
  archiveScene: (sceneId: string) => request<{ ok: true }>('DELETE', `/scenes/${sceneId}`),
  crop: (candidateId: string, rect: { x: number; y: number; w: number; h: number }) => request<{ candidateId: string; width: number; height: number }>('POST', `/candidates/${candidateId}/crop`, rect),

  estimate: (action: StudioAction, signal?: AbortSignal) => request<{ quote: QuoteView; preview: ActionPreview }>('POST', '/actions/estimate', { action }, signal),
  run: (action: StudioAction, quoteId: string, confirmed: boolean) => request<{ jobIds: string[] }>('POST', '/actions/run', { action, quoteId, confirmed }),

  jobs: (opts: { characterId?: string; active?: boolean; live?: boolean; limit?: number } = {}) => {
    const q = new URLSearchParams()
    if (opts.limit) q.set('limit', String(opts.limit))
    if (opts.characterId) q.set('characterId', opts.characterId)
    if (opts.active) q.set('active', '1')
    if (opts.live) q.set('live', '1')
    return request<{ jobs: JobView[] }>('GET', `/jobs?${q}`)
  },
  job: (id: string) => request<{ job: { id: string; status: string; error: { message?: string } | null }; result: unknown }>('GET', `/jobs/${id}`),
  cancelJob: (id: string) => request<{ ok: true }>('POST', `/jobs/${id}/cancel`, {}),
  resolveJob: (id: string, body: { action: 'not_charged' } | { action: 'attach'; providerJobId: string }) => request<{ ok: true }>('POST', `/jobs/${id}/resolve`, body),

  usage: () => request<Usage>('GET', '/usage'),
  settings: () => request<SettingsView>('GET', '/settings'),
  setMode: (mode: 'demo' | 'live') => request<{ mode: string }>('PUT', '/settings/mode', { mode }),
  saveKey: (provider: string, secret: string) => request<{ credential: unknown; verify: { ok: boolean; message: string } }>('PUT', `/settings/credentials/${provider}`, { secret }),
  removeKey: (provider: string) => request<{ ok: true }>('DELETE', `/settings/credentials/${provider}`),
  saveBudgets: (b: Partial<SettingsView['budgets']>) => request<SettingsView>('PUT', '/settings/budgets', b),
  setBilling: (b: { default?: 'api' | 'account'; creditUsd?: number }) => request<SettingsView>('PUT', '/settings/billing', b),
  setClaudeModel: (task: string, model: string) => request<SettingsView>('PUT', '/settings/claude', { task, model }),
  higgsfieldAccount: (fresh = false) => request<HiggsfieldAccount>('GET', `/settings/higgsfield-account${fresh ? '?fresh=1' : ''}`),
  storage: () => request<{ driver: string; bucket: string | null; origins: string[]; corsRules: unknown[] }>('GET', '/settings/storage'),
  checkStorage: () => request<{ ok: boolean; message: string }>('POST', '/settings/storage/check', {}),
  // The shared MCP connection flow (Higgsfield account, Dzine AI soon).
  connect: (provider: string) => request<{ url: string }>('POST', `/oauth/${provider}/start`, {}),
  disconnect: (provider: string) => request<SettingsView>('DELETE', `/settings/connections/${provider}`),
}
