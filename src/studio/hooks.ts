import { useEffect, useRef } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { api } from './api'

// Server state. Job lists poll while anything is running, so progress is the
// runner's real status, never a fake progress bar.

export const keys = {
  me: ['me'] as const,
  characters: ['characters'] as const,
  character: (id: string) => ['character', id] as const,
  scenes: (id: string) => ['scenes', id] as const,
  rules: (characterId: string | null) => ['rules', characterId ?? 'all'] as const,
  jobs: (scope: string) => ['jobs', scope] as const,
  usage: ['usage'] as const,
  settings: ['settings'] as const,
  higgsfieldAccount: ['higgsfield-account'] as const,
  content: ['content'] as const,
  library: (characterId: string | null) => ['library', characterId ?? 'all'] as const,
  worker: ['worker'] as const,
}

export function useMe() {
  return useQuery({ queryKey: keys.me, queryFn: api.me, retry: false, staleTime: 30_000 })
}

const ACTIVE = ['waiting', 'queued', 'submitting', 'running', 'ingesting', 'needs_attention']
// A job is settled before its free checks run (phase "checking"), and its
// result appears only after them, so it still counts as running until then.
export const isActiveJob = (j: { status: string; phase?: string }) => ACTIVE.includes(j.status) || j.phase === 'checking'

// Everything running, and what finished in the last 15 minutes: the live
// status in each step and in Activity. Polls fast while anything runs.
export function useLiveJobs() {
  return useQuery({
    queryKey: keys.jobs('live'),
    queryFn: () => api.jobs({ live: true, limit: 100 }),
    refetchInterval: q => (q.state.data?.jobs.some(j => isActiveJob(j) && j.status !== 'needs_attention') ? 1500 : 8000),
  })
}

export function useActiveJobs() {
  const live = useLiveJobs()
  const jobs = live.data?.jobs.filter(isActiveJob)
  return { ...live, data: live.data ? { jobs: jobs! } : undefined }
}

export function useCharacters() {
  return useQuery({ queryKey: keys.characters, queryFn: api.characters })
}

export function useCharacter(id: string) {
  const qc = useQueryClient()
  const active = useActiveJobs()
  const busy = (active.data?.jobs ?? []).some(j => j.characterId === id)
  // When this character's last job finishes, fetch once more so the final
  // results (new candidates, QA verdicts) always appear.
  const wasBusy = useRef(false)
  useEffect(() => {
    if (wasBusy.current && !busy) {
      qc.invalidateQueries({ queryKey: keys.character(id) })
      qc.invalidateQueries({ queryKey: keys.jobs(id) })
      qc.invalidateQueries({ queryKey: keys.usage })
    }
    wasBusy.current = busy
  }, [busy, id, qc])
  return useQuery({ queryKey: keys.character(id), queryFn: () => api.character(id), refetchInterval: busy ? 1500 : false })
}

// A character's scenes; polls while any of them is working.
export function useScenes(characterId: string) {
  const qc = useQueryClient()
  const active = useActiveJobs()
  const busy = (active.data?.jobs ?? []).some(j => j.characterId === characterId && /^(scene|scene_plan|scene_qa|scene_edit|scene_upscale|scene_end_frame|scene_video|scene_video_upscale|scene_prompt|drift_lock):/.test(j.purpose))
  const wasBusy = useRef(false)
  useEffect(() => {
    // A finished job's own checks (a video take's frame QA) run just after
    // it ends, so look again a moment later too.
    if (wasBusy.current && !busy) {
      qc.invalidateQueries({ queryKey: keys.scenes(characterId) })
      const t = setTimeout(() => qc.invalidateQueries({ queryKey: keys.scenes(characterId) }), 3000)
      wasBusy.current = busy
      return () => clearTimeout(t)
    }
    wasBusy.current = busy
  }, [busy, characterId, qc])
  return useQuery({
    queryKey: keys.scenes(characterId),
    queryFn: () => api.scenes(characterId),
    // Keep looking while a job runs or anything is still being checked.
    refetchInterval: q => (busy || q.state.data?.scenes.some(s => s.candidates.some(c => c.status === 'qa_pending')) ? 1500 : false),
  })
}

// The worker light: read from the database (it never wakes the worker), every
// 30 seconds, and every 5 while the worker is not ready.
export function useWorker() {
  return useQuery({
    queryKey: keys.worker,
    queryFn: api.worker,
    refetchInterval: q => (q.state.data && q.state.data.state !== 'ready' ? 5000 : 30_000),
    retry: false,
  })
}

// Whether work can start now. While the worker is restarting or down, every
// button that starts work says why instead of queueing a job that would wait
// (or run on old code).
export function useWorkerGate(): { ready: boolean; reason: string | null } {
  const w = useWorker()
  const s = w.data
  if (!s || s.state === 'ready') return { ready: true, reason: null }
  return { ready: false, reason: s.state === 'restarting' ? 'The worker is restarting after an update. Try again in a few minutes.' : 'The worker is down, so nothing would run. Check Railway.' }
}

// The content builder: polls while a render or a B-roll upload is working.
export function useContent() {
  const qc = useQueryClient()
  const active = useActiveJobs()
  // Claude writing slides or captions, a render, or a B-roll upload.
  const busy = (active.data?.jobs ?? []).some(j => /^(content_slides|content_captions|content_render|broll_ingest|clip_ingest|clone_source|clone_frame|chain_frame|chain_join):/.test(j.purpose))
  const wasBusy = useRef(false)
  useEffect(() => {
    if (wasBusy.current && !busy) qc.invalidateQueries({ queryKey: keys.content })
    wasBusy.current = busy
  }, [busy, qc])
  return useQuery({
    queryKey: keys.content,
    queryFn: api.content,
    refetchInterval: q => (busy || q.state.data?.items.some(i => i.status === 'rendering') || q.state.data?.broll.some(b => b.status === 'processing') ? 2000 : false),
  })
}

// The Library (stills and clips across characters); polls while an upload is
// being prepared, and looks again when a job that makes clips or stills ends.
export function useLibrary(characterId: string | null = null) {
  const qc = useQueryClient()
  const active = useActiveJobs()
  const busy = (active.data?.jobs ?? []).some(j => /^(clip_ingest|scene|scene_edit|scene_upscale|scene_video|scene_video_upscale|drift_lock|clone|chain_join):/.test(j.purpose))
  const wasBusy = useRef(false)
  useEffect(() => {
    if (wasBusy.current && !busy) qc.invalidateQueries({ queryKey: ['library'] })
    wasBusy.current = busy
  }, [busy, qc])
  return useQuery({
    queryKey: keys.library(characterId),
    queryFn: () => api.library(characterId),
    refetchInterval: q => (busy || q.state.data?.clips.some(c => c.status === 'generating') ? 2000 : false),
  })
}

// A video post's rough cut and sound bed (Phase 3), looked at again when
// the post changes, when a render or a sound upload ends, or while a sound
// is being prepared.
export function useCut(contentId: string, version: string, enabled = true) {
  const qc = useQueryClient()
  const active = useActiveJobs()
  const busy = (active.data?.jobs ?? []).some(j => /^(sound_ingest|chain_join|clip_ingest|broll_ingest):/.test(j.purpose) || j.purpose === `content_render:${contentId}`)
  const wasBusy = useRef(false)
  useEffect(() => {
    if (wasBusy.current && !busy) qc.invalidateQueries({ queryKey: ['cut', contentId] })
    wasBusy.current = busy
  }, [busy, qc, contentId])
  return useQuery({
    queryKey: ['cut', contentId, version],
    queryFn: () => api.cut(contentId),
    enabled,
    placeholderData: prev => prev,
    refetchInterval: q => (busy || q.state.data?.sound.sounds.some(x => x.status === 'processing') ? 2500 : false),
  })
}

// A character's voice lines (or everyone's), polled while takes are being
// prepared or converted.
export function useVoiceLines(characterId?: string | null) {
  return useQuery({
    queryKey: ['voice-lines', characterId ?? 'all'],
    queryFn: () => api.voiceLines(characterId),
    refetchInterval: q => (q.state.data?.lines.some(x => x.status === 'processing' || x.status === 'converting') ? 2500 : false),
  })
}

// The scale kit: products (the owner's account starts with the SideStep
// kit), one product's vault, and the accounts scoreboard.
export function useProducts() {
  return useQuery({ queryKey: ['products'], queryFn: api.products })
}
export function useProduct(id: string | null) {
  const active = useActiveJobs()
  const writing = (active.data?.jobs ?? []).some(j => j.purpose.startsWith('hook_variants:'))
  return useQuery({ queryKey: ['product', id], queryFn: () => api.product(id!), enabled: !!id, refetchInterval: writing ? 2500 : false })
}
export function useSocialAccounts() {
  return useQuery({ queryKey: ['social-accounts'], queryFn: api.socialAccounts })
}

export function useSounds() {
  const active = useActiveJobs()
  const busy = (active.data?.jobs ?? []).some(j => j.purpose.startsWith('sound_ingest:'))
  return useQuery({ queryKey: ['sounds'], queryFn: api.sounds, refetchInterval: q => (busy || q.state.data?.sounds.some(x => x.status === 'processing') ? 2500 : false) })
}

// A post's clones (Clone Video): looks again when one of its clone runs ends.
export function useClones(contentId: string) {
  const qc = useQueryClient()
  const active = useActiveJobs()
  const busy = (active.data?.jobs ?? []).some(j => j.purpose.startsWith(`clone:${contentId}:`))
  const wasBusy = useRef(false)
  useEffect(() => {
    if (wasBusy.current && !busy) { qc.invalidateQueries({ queryKey: ['clones', contentId] }); qc.invalidateQueries({ queryKey: ['library'] }) }
    wasBusy.current = busy
  }, [busy, qc, contentId])
  return useQuery({ queryKey: ['clones', contentId], queryFn: () => api.clones(contentId), refetchInterval: busy ? 3000 : false })
}

// A post's scene stills for "Copy the moves": looks again when one ends.
export function useCloneStills(contentId: string) {
  const qc = useQueryClient()
  const active = useActiveJobs()
  const busy = (active.data?.jobs ?? []).some(j => j.purpose.startsWith(`clone_still:${contentId}:`))
  const wasBusy = useRef(false)
  useEffect(() => {
    if (wasBusy.current && !busy) { qc.invalidateQueries({ queryKey: ['clone-stills', contentId] }); qc.invalidateQueries({ queryKey: keys.content }) }
    wasBusy.current = busy
  }, [busy, qc, contentId])
  return useQuery({ queryKey: ['clone-stills', contentId], queryFn: () => api.cloneStills(contentId), refetchInterval: busy ? 3000 : false })
}

export function useRules(characterId: string | null) {
  return useQuery({ queryKey: keys.rules(characterId), queryFn: () => api.rules(characterId) })
}

export function useCharacterJobs(id: string) {
  return useQuery({ queryKey: keys.jobs(id), queryFn: () => api.jobs({ characterId: id }), refetchInterval: 4000 })
}

export function useUsage() { return useQuery({ queryKey: keys.usage, queryFn: api.usage }) }
// Polls while a model test is running, so its result shows up on its own.
export function useSettings() {
  return useQuery({ queryKey: keys.settings, queryFn: api.settings, refetchInterval: q => (q.state.data?.models.some(m => m.testing) ? 3000 : false) })
}

// The connected Higgsfield account's plan and credits (asked only when one
// is connected).
export function useHiggsfieldAccount(connected: boolean) {
  return useQuery({ queryKey: keys.higgsfieldAccount, queryFn: () => api.higgsfieldAccount(), enabled: connected, staleTime: 30_000, retry: false })
}

// Refresh everything a write can affect.
export function useRefresh() {
  const qc = useQueryClient()
  return (characterId?: string) => {
    if (characterId) {
      qc.invalidateQueries({ queryKey: keys.character(characterId) })
      qc.invalidateQueries({ queryKey: keys.scenes(characterId) })
    }
    qc.invalidateQueries({ queryKey: keys.characters })
    qc.invalidateQueries({ queryKey: ['jobs'] })
    qc.invalidateQueries({ queryKey: keys.usage })
    qc.invalidateQueries({ queryKey: keys.settings })
    qc.invalidateQueries({ queryKey: keys.content })
    qc.invalidateQueries({ queryKey: ['library'] })
  }
}

export function useStudioMutation<TArgs, TResult>(fn: (args: TArgs) => Promise<TResult>, characterId?: string) {
  const refresh = useRefresh()
  return useMutation({ mutationFn: fn, onSettled: () => refresh(characterId) })
}
