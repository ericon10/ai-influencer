import { useState, useEffect, createContext, useContext } from 'react'

// Generic small-value localStorage hook (inspiration boards, brand deals, etc.)
function useLocalStorage(key, initial) {
  const [value, setValue] = useState(() => {
    try {
      const stored = localStorage.getItem(key)
      return stored ? JSON.parse(stored) : initial
    } catch {
      return initial
    }
  })

  useEffect(() => {
    try {
      localStorage.setItem(key, JSON.stringify(value))
    } catch (e) {
      console.warn('localStorage quota exceeded — data not saved', e)
    }
  }, [key, value])

  return [value, setValue]
}

// ── Per-influencer storage ────────────────────────────────────────
// Each influencer lives in its own key: hf_influencer_${id}
// The ordered list of IDs lives in influencer_ids.
// This way adding/updating influencer N never risks losing influencer M.

const INF_PREFIX = 'hf_influencer_'
const IDS_KEY    = 'influencer_ids'

function readInfluencer(id) {
  try { return JSON.parse(localStorage.getItem(`${INF_PREFIX}${id}`)) } catch { return null }
}

function writeInfluencer(inf) {
  try {
    localStorage.setItem(`${INF_PREFIX}${inf.id}`, JSON.stringify(inf))
    return true
  } catch (e) {
    console.warn(`localStorage quota exceeded — influencer "${inf.name}" not saved`, e)
    return false
  }
}

function readIds() {
  try { return JSON.parse(localStorage.getItem(IDS_KEY) || 'null') } catch { return null }
}

function writeIds(ids) {
  try { localStorage.setItem(IDS_KEY, JSON.stringify(ids)) } catch {}
}

// Read the legacy single-key list (may still have data even after migration attempt)
function readLegacyList() {
  try {
    const raw = localStorage.getItem('influencers')
    if (!raw) return []
    return JSON.parse(raw) || []
  } catch { return [] }
}

function useInfluencerStore(initial) {
  const [influencers, setInfluencers] = useState(() => {
    const ids = readIds()
    if (ids && ids.length > 0) {
      const loaded = ids.map(readInfluencer).filter(Boolean)

      // If we loaded fewer than expected, some hf_influencer_* writes failed (quota).
      // Recover missing ones from the legacy 'influencers' key which may still have the data.
      if (loaded.length < ids.length) {
        const loadedSet = new Set(loaded.map(i => i.id))
        const legacy = readLegacyList()
        for (const inf of legacy) {
          if (!loadedSet.has(inf.id)) {
            loaded.push(inf)
            loadedSet.add(inf.id)
          }
        }
        // Restore original order
        const byId = Object.fromEntries(loaded.map(i => [i.id, i]))
        const ordered = ids.map(id => byId[id]).filter(Boolean)
        // Also pick up any influencers in legacy but not in ids (edge case)
        const orderedSet = new Set(ordered.map(i => i.id))
        for (const inf of legacy) {
          if (!orderedSet.has(inf.id)) ordered.push(inf)
        }
        return ordered.length > 0 ? ordered : initial
      }

      return loaded.length > 0 ? loaded : initial
    }

    // No new-format IDs yet — fall back to legacy single key
    const legacy = readLegacyList()
    return legacy.length > 0 ? legacy : initial
  })

  useEffect(() => {
    const ids = influencers.map(i => i.id)
    writeIds(ids)
    for (const inf of influencers) writeInfluencer(inf)
    // Remove keys for deleted influencers
    const idSet = new Set(ids)
    for (const key of Object.keys(localStorage)) {
      if (key.startsWith(INF_PREFIX)) {
        const id = key.slice(INF_PREFIX.length)
        if (!idSet.has(id)) try { localStorage.removeItem(key) } catch {}
      }
    }
  }, [influencers])

  return [influencers, setInfluencers]
}

// ── Shared contexts — one source of truth across all pages ──
const InfluencersCtx = createContext(null)
const InspirationCtx = createContext(null)
const BrandDealsCtx  = createContext(null)

// ── Sync startup block ────────────────────────────────────────────
// Runs before React renders. Order matters:
// 1. Free quota first (strip bloated video history blobs)
// 2. Then migrate influencers to per-key format while quota is available

// Step 1: Free quota by stripping base64 product refs from video history
try {
  const histKeys = Object.keys(localStorage).filter(k => k.startsWith('hf_video_history_'))
  for (const key of histKeys) {
    const raw = JSON.parse(localStorage.getItem(key) || '[]')
    if (raw.some(e => e.productRef1 || e.productRef2 || e.productRef3)) {
      const cleaned = raw.map(e => { const c = { ...e }; delete c.productRef1; delete c.productRef2; delete c.productRef3; return c })
      try { localStorage.setItem(key, JSON.stringify(cleaned)) } catch { localStorage.removeItem(key) }
    }
  }
} catch (_) {}

// Step 2: Migrate to per-influencer keys (now that quota has been freed)
try {
  if (!readIds()) {
    // First run with new code — migrate from legacy 'influencers' key
    const list = readLegacyList()
    for (const inf of list) writeInfluencer(inf)
    writeIds(list.map(i => i.id))
  }
} catch (_) {}

// Step 3: The original app seeded demo personas, photos, a board and a deal
// whose images are no longer shipped. Remove them once from browsers that
// still have them; nothing the user created is touched.
try {
  const DEMO_KEY = 'demo_personas_removed_v1'
  if (!localStorage.getItem(DEMO_KEY)) {
    const DEMO_IDS = new Set(['kayla-template', 'camila-template', 'marcus-template', 'mpe00fxqdypgtihqft', 'mpm5hc0xi4d78ry3qr', 'mpm8eqj77o69r06igss', 'mpma2ne5wzlwy87k7n', 'mpmd4rw1nhdryivbpxh'])
    const ids = readIds()
    if (ids) writeIds(ids.filter(id => !DEMO_IDS.has(id)))
    for (const id of DEMO_IDS) localStorage.removeItem(`${INF_PREFIX}${id}`)
    const legacy = readLegacyList()
    if (legacy.some(i => DEMO_IDS.has(i.id))) localStorage.setItem('influencers', JSON.stringify(legacy.filter(i => !DEMO_IDS.has(i.id))))
    const dropList = (key, keep) => {
      const list = JSON.parse(localStorage.getItem(key) || '[]')
      const kept = list.filter(keep)
      if (kept.length !== list.length) localStorage.setItem(key, JSON.stringify(kept))
    }
    dropList('photo_studio_history', p => !DEMO_IDS.has(p.influencerId))
    dropList('inspiration_boards', b => b.id !== 'seed-board-streetwear')
    dropList('brand_deals', d => d.id !== 'mpan5nonfy3trqamf4a')
    localStorage.setItem(DEMO_KEY, '1')
  }
} catch (_) {}

export function StoreProvider({ children }) {
  const influencerStore = useInfluencerStore([])
  const inspirationState = useLocalStorage('inspiration_boards', [])
  const brandDealsState  = useLocalStorage('brand_deals', [])

  return (
    <InfluencersCtx.Provider value={influencerStore}>
      <InspirationCtx.Provider value={inspirationState}>
        <BrandDealsCtx.Provider value={brandDealsState}>
          {children}
        </BrandDealsCtx.Provider>
      </InspirationCtx.Provider>
    </InfluencersCtx.Provider>
  )
}

export function useInfluencers()       { return useContext(InfluencersCtx) }
export function useInspirationBoards() { return useContext(InspirationCtx) }
export function useBrandDeals()        { return useContext(BrandDealsCtx) }

export function generateId() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2)
}
