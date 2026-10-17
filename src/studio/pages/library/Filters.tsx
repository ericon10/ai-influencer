import { useEffect, useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { Check, FolderMinus, FolderOpen, FolderPlus, Loader2, Trash2, X } from 'lucide-react'
import { api } from '../../api'
import { Callout, Drawer, Modal, errorMessage, useToast } from '../../ui'
import { HowTo } from '../../guide/Guide'
import type { LibraryCollection, ProductBrief } from '../../types'
import { DATE_LABEL, EMPTY_FILTER, USED_LABEL, filterChips, filterParams, type LibraryFilter, type LibraryTab } from '../../../../server/core/libraryFilter'

// Library > Stills and Clips: the filters and collections (UX-PLAN.md
// section 34). The filters live in the page's address, each tab its own,
// and run on the server; each active one shows as a chip with an x.
// Collections are named sets of items: Select, then Add to collection.

type SetParams = (patch: Record<string, string | null>) => void

const refreshAll = (qc: ReturnType<typeof useQueryClient>) => {
  for (const key of [['collections'], ['library'], ['library-item']]) void qc.invalidateQueries({ queryKey: key })
}

export function LibraryFilters({ tab, filter, set, models, products, collections, character }: {
  tab: LibraryTab; filter: LibraryFilter; set: SetParams
  models: Array<{ id: string; label: string }>; products: ProductBrief[]; collections: LibraryCollection[]
  // The character picked in the chips above (shared by every tab), or none.
  character: string | null
}) {
  const [managing, setManaging] = useState(false)
  const put = (patch: Partial<LibraryFilter>) => set(filterParams(tab, patch))
  // A model or collection in the address but not in the lists any more
  // still shows (by its id) so it can be cleared.
  const modelName = (id: string) => models.find(m => m.id === id)?.label ?? id
  const chips = filterChips(filter, {
    model: modelName,
    product: id => products.find(p => p.id === id)?.name ?? 'a product',
    set: id => collections.find(c => c.id === id)?.name ?? 'a deleted collection',
  })
  const today = new Date().toISOString().slice(0, 10)
  return (
    <>
      <div className="st-libfilters" data-field="library-filters" role="group" aria-label="Filters">
        <select className="st-select sm" aria-label="Model" value={filter.model ?? ''} onChange={e => put({ model: e.target.value || null })}>
          <option value="">Any model</option>
          {filter.model && !models.some(m => m.id === filter.model) && <option value={filter.model}>{filter.model}</option>}
          {models.map(m => <option key={m.id} value={m.id}>{m.label}</option>)}
        </select>
        <select className="st-select sm" aria-label="Date" value={filter.date ?? ''} onChange={e => { const d = e.target.value as LibraryFilter['date'] | ''; put(d === 'range' ? { date: 'range', from: filter.from ?? today, to: filter.to ?? today } : { date: d || null }) }}>
          <option value="">Any time</option>
          {(Object.keys(DATE_LABEL) as Array<keyof typeof DATE_LABEL>).map(k => <option key={k} value={k}>{DATE_LABEL[k]}</option>)}
          <option value="range">From and to...</option>
        </select>
        {filter.date === 'range' && (
          <>
            <input type="date" className="st-input sm" style={{ width: 'auto' }} aria-label="From" value={filter.from ?? ''} max={filter.to ?? undefined} onChange={e => put({ date: 'range', from: e.target.value || null })} />
            <input type="date" className="st-input sm" style={{ width: 'auto' }} aria-label="To" value={filter.to ?? ''} min={filter.from ?? undefined} onChange={e => put({ date: 'range', to: e.target.value || null })} />
          </>
        )}
        <select className="st-select sm" aria-label="Used" value={filter.used ?? ''} onChange={e => put({ used: (e.target.value || null) as LibraryFilter['used'] })}>
          <option value="">Used or not</option>
          <option value="used">{USED_LABEL.used}</option>
          <option value="unused">{USED_LABEL.unused}</option>
        </select>
        {products.length > 0 && (
          <select className="st-select sm" aria-label="Product" value={filter.product ?? ''} onChange={e => put({ product: e.target.value || null })}>
            <option value="">Any product</option>
            {products.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
          </select>
        )}
        <select className="st-select sm" aria-label="Collection" value={filter.set ?? ''} onChange={e => put({ set: e.target.value || null })}>
          <option value="">{collections.length ? 'All items' : 'No collections yet'}</option>
          {collections.map(c => <option key={c.id} value={c.id}>{c.name} ({c.count})</option>)}
        </select>
        <button type="button" className="st-btn sm ghost" onClick={() => setManaging(true)} data-field="library-collections"><FolderOpen size={14} />Collections</button>
        <HowTo id="library" label="About filters" />
      </div>
      {(chips.length > 0 || character) && (
        <div className="st-libchips" data-field="library-chips" aria-label="Active filters">
          {character && <span className="st-chip on">Character: {character}<button type="button" className="st-chip-x" aria-label="Clear the character filter" onClick={() => set({ c: null })}><X size={12} /></button></span>}
          {chips.map(c => (
            <span key={c.key} className="st-chip on">{c.label}<button type="button" className="st-chip-x" aria-label={`Clear ${c.label}`} onClick={() => put(c.key === 'date' ? { date: null } : { [c.key]: null })}><X size={12} /></button></span>
          ))}
          {chips.length + (character ? 1 : 0) > 1 && <button type="button" className="st-btn sm ghost" onClick={() => set({ ...filterParams(tab, EMPTY_FILTER), c: null })}>Clear all</button>}
        </div>
      )}
      <CollectionsDrawer open={managing} onClose={() => setManaging(false)} collections={collections} onShow={id => { put({ set: id }); setManaging(false) }} onDeleted={id => { if (filter.set === id) put({ set: null }) }} />
    </>
  )
}

export function NoMatch({ onClear }: { onClear: () => void }) {
  return <Callout tone="info">Nothing here matches these filters. <button type="button" className="st-todo-link" onClick={onClear}>Clear the filters</button></Callout>
}

// The Select bar's collection buttons: Add to collection, and with a
// collection picked in the filter, Remove from it.
export function CollectionButtons({ sel, set }: { sel: { items: Array<{ id: string }>; stop: () => void }; set: LibraryCollection | null }) {
  const toast = useToast()
  const qc = useQueryClient()
  const [adding, setAdding] = useState(false)
  const [busy, setBusy] = useState(false)
  const n = sel.items.length
  async function remove() {
    if (!set) return
    setBusy(true)
    try {
      const r = await api.removeFromCollection(set.id, sel.items.map(x => x.id))
      toast({ tone: 'ok', text: `Took ${r.removed} out of "${set.name}". ${r.removed === 1 ? 'It stays' : 'They stay'} in the Library.` })
      sel.stop()
      refreshAll(qc)
    } catch (e) { toast({ tone: 'bad', text: errorMessage(e) }) } finally { setBusy(false) }
  }
  return (
    <>
      <button type="button" className="st-btn sm" disabled={!n} onClick={() => setAdding(true)} data-field="add-to-collection"><FolderPlus size={13} />Add to collection</button>
      {set && <button type="button" className="st-btn sm" disabled={!n || busy} onClick={() => void remove()}>{busy ? <Loader2 size={13} className="st-spin" /> : <FolderMinus size={13} />}Remove from {set.name}</button>}
      <AddToCollection open={adding} onClose={() => setAdding(false)} items={sel.items.map(x => x.id)} onDone={() => { setAdding(false); sel.stop() }} />
    </>
  )
}

function AddToCollection({ open, onClose, items, onDone }: { open: boolean; onClose: () => void; items: string[]; onDone: () => void }) {
  const toast = useToast()
  const qc = useQueryClient()
  const [list, setList] = useState<LibraryCollection[] | null>(null)
  const [pick, setPick] = useState<string | null>(null)
  const [name, setName] = useState('')
  const [busy, setBusy] = useState(false)
  // The list as it is now, each time the dialog opens.
  useEffect(() => {
    if (!open) return
    let live = true
    setPick(null); setName(''); setList(null)
    api.collections().then(r => { if (live) setList(r.collections) }).catch(() => { if (live) setList([]) })
    return () => { live = false }
  }, [open])
  const typed = name.trim()
  async function add() {
    setBusy(true)
    try {
      const r = await api.addToCollection(typed ? { name: typed, items } : { id: pick!, items })
      toast({ tone: 'ok', text: r.added ? `Added ${r.added} to "${r.name}".` : `Already in "${r.name}".` })
      refreshAll(qc)
      onDone()
    } catch (e) { toast({ tone: 'bad', text: errorMessage(e) }) } finally { setBusy(false) }
  }
  return (
    <Modal open={open} onClose={onClose}>
      <div className="st-col" style={{ gap: 14, padding: 22 }} data-field="add-to-collection-dialog" aria-label="Add to collection">
        <div className="st-h2">Add {items.length} {items.length === 1 ? 'item' : 'items'} to a collection</div>
        {list === null ? <Loader2 size={16} className="st-spin" /> : list.length > 0 && (
          <div className="st-row" style={{ gap: 6, flexWrap: 'wrap' }} role="radiogroup" aria-label="Collections">
            {list.map(c => (
              <button key={c.id} type="button" role="radio" aria-checked={pick === c.id && !typed} className={`st-chip ${pick === c.id && !typed ? 'on' : ''}`} onClick={() => { setPick(c.id); setName('') }}>
                {pick === c.id && !typed && <Check size={12} />}{c.name} <span className="st-muted">{c.count}</span>
              </button>
            ))}
          </div>
        )}
        <label className="st-col" style={{ gap: 6 }}>
          <span className="st-label">{list?.length ? 'Or a new collection' : 'A new collection'}</span>
          <input className="st-input" maxLength={60} value={name} onChange={e => setName(e.target.value)} placeholder="e.g. Launch week" aria-label="New collection name"
            onKeyDown={e => { if (e.key === 'Enter' && (typed || pick)) void add() }} autoFocus={!list?.length} />
        </label>
        <span className="st-hint">A collection can hold stills and clips of any character. Pick it in the Collection filter to see only its items.</span>
        <div className="st-row" style={{ gap: 8 }}>
          <span className="st-spacer" />
          <button type="button" className="st-btn ghost" onClick={onClose}>Cancel</button>
          <button type="button" className="st-btn primary" disabled={busy || (!typed && !pick)} onClick={() => void add()}>{busy ? <Loader2 size={15} className="st-spin" /> : <FolderPlus size={15} />}{typed ? `Add to "${typed}"` : 'Add'}<span className="st-price">Free</span></button>
        </div>
      </div>
    </Modal>
  )
}

// Collections: rename or delete one. Deleting a collection never deletes
// its items.
function CollectionsDrawer({ open, onClose, collections, onShow, onDeleted }: { open: boolean; onClose: () => void; collections: LibraryCollection[]; onShow: (id: string) => void; onDeleted: (id: string) => void }) {
  return (
    <Drawer open={open} onClose={onClose} title={<span className="st-row" style={{ gap: 8 }}><FolderOpen size={18} />Collections</span>}>
      <div className="st-col" style={{ gap: 12 }} data-field="collections-drawer">
        <span className="st-hint">Named sets of stills and clips. To add items, press Select in Stills or Clips, pick them, then Add to collection. Deleting a collection never deletes its items.</span>
        {!collections.length ? <Callout tone="info">No collections yet.</Callout> : (
          <div className="st-collist">{collections.map(c => <CollectionRow key={c.id} c={c} onShow={() => onShow(c.id)} onDeleted={() => onDeleted(c.id)} />)}</div>
        )}
        <HowTo id="library" label="About collections" />
      </div>
    </Drawer>
  )
}

function CollectionRow({ c, onShow, onDeleted }: { c: LibraryCollection; onShow: () => void; onDeleted: () => void }) {
  const toast = useToast()
  const qc = useQueryClient()
  const [name, setName] = useState(c.name)
  const [confirm, setConfirm] = useState(false)
  async function rename() {
    if (name.trim() === c.name) return
    try { await api.renameCollection(c.id, name); refreshAll(qc) } catch (e) { setName(c.name); toast({ tone: 'bad', text: errorMessage(e) }) }
  }
  async function remove() {
    try {
      await api.deleteCollection(c.id)
      toast({ tone: 'ok', text: `Deleted the collection "${c.name}". Its items stay in the Library.` })
      onDeleted()
      refreshAll(qc)
    } catch (e) { toast({ tone: 'bad', text: errorMessage(e) }) }
  }
  if (confirm) return (
    <div className="st-colrow" style={{ flexWrap: 'wrap' }}>
      <span className="grow" style={{ flex: 1 }}>Delete the collection "{c.name}"? Its {c.count === 1 ? 'item stays' : `${c.count} items stay`} in the Library.</span>
      <button type="button" className="st-btn sm bad" onClick={() => void remove()}>Delete the collection</button>
      <button type="button" className="st-btn sm ghost" onClick={() => setConfirm(false)}>Cancel</button>
    </div>
  )
  return (
    <div className="st-colrow" data-field={`collection-${c.name}`}>
      <input className="st-input sm" style={{ flex: 1, minWidth: 0 }} maxLength={60} value={name} onChange={e => setName(e.target.value)} onBlur={() => void rename()} onKeyDown={e => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur() }} aria-label={`Name of ${c.name}`} />
      <span className="st-hint">{c.count}</span>
      <button type="button" className="st-btn sm ghost" onClick={onShow}>Show</button>
      <button type="button" className="st-btn sm ghost icon" onClick={() => setConfirm(true)} aria-label={`Delete the collection ${c.name}`} title="Delete the collection (its items stay)"><Trash2 size={14} /></button>
    </div>
  )
}
