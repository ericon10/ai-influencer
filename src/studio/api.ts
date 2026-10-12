import type { ActionPreview, CharacterSummary, CharacterView, JobView, Me, QuoteView, SettingsView, StudioAction, Usage } from './types'

// Thin client for /api/v1. Every write sends the CSRF header the server
// requires; errors come back as ApiError with the server's plain message.

export class ApiError extends Error {
  constructor(readonly status: number, readonly code: string, message: string, readonly details: unknown = null) {
    super(message)
  }
}

async function request<T>(method: string, path: string, body?: unknown): Promise<T> {
  const headers: Record<string, string> = {}
  let payload: BodyInit | undefined
  if (body instanceof FormData) payload = body
  else if (body !== undefined) { payload = JSON.stringify(body); headers['content-type'] = 'application/json' }
  if (method !== 'GET') headers['x-studio-request'] = '1'
  const res = await fetch(`/api/v1${path}`, { method, headers, body: payload, credentials: 'same-origin' })
  const text = await res.text()
  let json: unknown = null
  try { json = text ? JSON.parse(text) : null } catch { /* non-JSON */ }
  if (!res.ok) {
    const e = (json as { error?: { code?: string; message?: string; details?: unknown } } | null)?.error
    throw new ApiError(res.status, e?.code ?? 'error', e?.message ?? (res.status === 502 || res.status === 504 ? 'The Studio API is not running. Start it with npm run studio.' : `Request failed (${res.status}).`), e?.details)
  }
  return json as T
}

export const assetUrl = (id: string, width?: number) => `/api/v1/assets/${id}/content${width ? `?w=${width}` : ''}`

export const api = {
  me: () => request<Me>('GET', '/me'),
  login: (email: string, passphrase: string) => request<{ ok: true }>('POST', '/auth/login', { email, passphrase }),
  logout: () => request<{ ok: true }>('POST', '/auth/logout', {}),

  characters: () => request<{ characters: CharacterSummary[] }>('GET', '/characters'),
  createCharacter: (name: string) => request<{ id: string }>('POST', '/characters', { name }),
  character: (id: string) => request<CharacterView>('GET', `/characters/${id}`),
  updateCharacter: (id: string, patch: Record<string, unknown>, reason = 'edited') => request<CharacterView>('PATCH', `/characters/${id}`, { patch, reason }),
  archiveCharacter: (id: string) => request<{ ok: true }>('DELETE', `/characters/${id}`),
  addInspiration: (id: string, file: File) => { const f = new FormData(); f.append('file', file); return request<{ assetId: string }>('POST', `/characters/${id}/inspirations`, f) },
  chooseConcept: (conceptId: string) => request<{ ok: true }>('POST', `/concepts/${conceptId}/choose`, {}),

  approve: (candidateId: string) => request<{ invalidated: string[]; sheetComplete: boolean }>('POST', `/candidates/${candidateId}/approve`, {}),
  reject: (candidateId: string, reasons: string[], note: string) => request<{ fixes: Array<{ reason: string; action: string; label: string; available: boolean }> }>('POST', `/candidates/${candidateId}/reject`, { reasons, note }),
  reopen: (candidateId: string) => request<{ ok: true }>('POST', `/candidates/${candidateId}/reopen`, {}),
  pickHero: (candidateId: string) => request<{ needsUpscale: boolean; height: number | null }>('POST', `/candidates/${candidateId}/pick-hero`, {}),
  favorite: (candidateId: string, favorite: boolean) => request<{ ok: true }>('POST', `/candidates/${candidateId}/favorite`, { favorite }),
  keepStale: (characterId: string, refId: string) => request<{ ok: true }>('POST', `/characters/${characterId}/sheet/${refId}/keep`, {}),

  importCharacter: (form: FormData) => request<{ characterId: string; importedShots: string[]; warnings: string[] }>('POST', '/characters/import', form),
  exportUrl: (id: string) => `/api/v1/characters/${id}/export`,
  applyFile: (id: string, file: File) => { const f = new FormData(); f.append('file', file); return request<{ warnings: string[]; view: CharacterView }>('POST', `/characters/${id}/import-file`, f) },

  estimate: (action: StudioAction) => request<{ quote: QuoteView; preview: ActionPreview }>('POST', '/actions/estimate', { action }),
  run: (action: StudioAction, quoteId: string, confirmed: boolean) => request<{ jobIds: string[] }>('POST', '/actions/run', { action, quoteId, confirmed }),

  jobs: (opts: { characterId?: string; active?: boolean } = {}) => {
    const q = new URLSearchParams()
    if (opts.characterId) q.set('characterId', opts.characterId)
    if (opts.active) q.set('active', '1')
    return request<{ jobs: JobView[] }>('GET', `/jobs?${q}`)
  },
  cancelJob: (id: string) => request<{ ok: true }>('POST', `/jobs/${id}/cancel`, {}),
  resolveJob: (id: string, body: { action: 'not_charged' } | { action: 'attach'; providerJobId: string }) => request<{ ok: true }>('POST', `/jobs/${id}/resolve`, body),

  usage: () => request<Usage>('GET', '/usage'),
  settings: () => request<SettingsView>('GET', '/settings'),
  setMode: (mode: 'demo' | 'live') => request<{ mode: string }>('PUT', '/settings/mode', { mode }),
  saveKey: (provider: string, secret: string) => request<{ credential: unknown; verify: { ok: boolean; message: string } }>('PUT', `/settings/credentials/${provider}`, { secret }),
  removeKey: (provider: string) => request<{ ok: true }>('DELETE', `/settings/credentials/${provider}`),
  saveBudgets: (b: Partial<SettingsView['budgets']>) => request<SettingsView>('PUT', '/settings/budgets', b),
}
