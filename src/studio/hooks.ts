import { useEffect, useRef } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { api } from './api'

// Server state. Job lists poll while anything is running, so progress is the
// runner's real status, never a fake progress bar.

export const keys = {
  me: ['me'] as const,
  characters: ['characters'] as const,
  character: (id: string) => ['character', id] as const,
  jobs: (scope: string) => ['jobs', scope] as const,
  usage: ['usage'] as const,
  settings: ['settings'] as const,
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

export function useCharacterJobs(id: string) {
  return useQuery({ queryKey: keys.jobs(id), queryFn: () => api.jobs({ characterId: id }), refetchInterval: 4000 })
}

export function useUsage() { return useQuery({ queryKey: keys.usage, queryFn: api.usage }) }
// Polls while a model test is running, so its result shows up on its own.
export function useSettings() {
  return useQuery({ queryKey: keys.settings, queryFn: api.settings, refetchInterval: q => (q.state.data?.models.some(m => m.testing) ? 3000 : false) })
}

// Refresh everything a write can affect.
export function useRefresh() {
  const qc = useQueryClient()
  return (characterId?: string) => {
    if (characterId) qc.invalidateQueries({ queryKey: keys.character(characterId) })
    qc.invalidateQueries({ queryKey: keys.characters })
    qc.invalidateQueries({ queryKey: ['jobs'] })
    qc.invalidateQueries({ queryKey: keys.usage })
    qc.invalidateQueries({ queryKey: keys.settings })
  }
}

export function useStudioMutation<TArgs, TResult>(fn: (args: TArgs) => Promise<TResult>, characterId?: string) {
  const refresh = useRefresh()
  return useMutation({ mutationFn: fn, onSettled: () => refresh(characterId) })
}
