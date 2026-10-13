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
}

export function useMe() {
  return useQuery({ queryKey: keys.me, queryFn: api.me, retry: false, staleTime: 30_000 })
}

export function useActiveJobs() {
  return useQuery({
    queryKey: keys.jobs('active'),
    queryFn: () => api.jobs({ active: true }),
    refetchInterval: q => ((q.state.data?.jobs.length ?? 0) > 0 ? 1500 : 8000),
  })
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

// The content builder: polls while a render or a B-roll upload is working.
export function useContent() {
  const qc = useQueryClient()
  const active = useActiveJobs()
  // Claude writing slides or captions, a render, or a B-roll upload.
  const busy = (active.data?.jobs ?? []).some(j => /^(content_slides|content_captions|content_render|broll_ingest):/.test(j.purpose))
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
  }
}

export function useStudioMutation<TArgs, TResult>(fn: (args: TArgs) => Promise<TResult>, characterId?: string) {
  const refresh = useRefresh()
  return useMutation({ mutationFn: fn, onSettled: () => refresh(characterId) })
}
