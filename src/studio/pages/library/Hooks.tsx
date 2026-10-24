import { useEffect, useRef, useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { AlertTriangle, Archive, Copy, FileUp, Plus, Sparkles } from 'lucide-react'
import { api } from '../../api'
import { keys, useActiveJobs, useProduct, useProducts } from '../../hooks'
import { HowTo } from '../../guide/Guide'
import { PriceButton } from '../../PriceButton'
import { RunStatus } from '../../runs'
import { Callout, errorMessage, useToast } from '../../ui'
import type { CharacterSummary, KitGroup, KitHook, ProductView } from '../../types'
import { useNewPost } from '../post/parts'

// Library > Hooks (UX-PLAN.md section 14): per product, the hook vault, the
// claims sheet and the buyer-language bank. "Write variants" asks Claude
// (priced on the button) to rewrite a hook once in each picked character's
// voice, inside the claims sheet, so accounts never post the same line.
// Everything is editable inline; the claims checks are warnings only.

export function HooksTab({ characters }: { characters: CharacterSummary[] }) {
  const toast = useToast()
  const qc = useQueryClient()
  const list = useProducts()
  const products = list.data?.products ?? []
  const [productId, setProductId] = useState<string | null>(null)
  // No product opens by itself (section 45): the owner picks one to browse.
  const current = productId && products.some(p => p.id === productId) ? productId : null
  const product = useProduct(current)
  const [busy, setBusy] = useState<string | null>(null)
  const file = useRef<HTMLInputElement | null>(null)

  async function load(body: { markdown?: string; starter?: boolean; name?: string }) {
    setBusy(body.starter ? 'Loading the SideStep kit...' : 'Importing the kit...')
    try {
      const r = await api.importKit(body)
      await qc.invalidateQueries({ queryKey: ['products'] })
      setProductId(r.product.id)
      toast({ tone: 'ok', text: `${r.product.name}: ${r.hooks} hooks loaded.${r.voicesApplied.length ? ` Voice card filled in for ${r.voicesApplied.join(', ')}.` : ''}` })
    } catch (e) { toast({ tone: 'bad', text: errorMessage(e) }) } finally { setBusy(null) }
  }
  async function upload(f: File | undefined) {
    if (!f) return
    if (f.size > 200_000) { toast({ tone: 'bad', text: `${f.name} is over 200 KB.` }); return }
    await load({ markdown: await f.text(), name: '' })
  }

  return (
    <div className="st-col" style={{ gap: 18 }}>
      <div className="st-row" style={{ gap: 8, flexWrap: 'wrap' }}>
        {products.map(p => <button key={p.id} className={`st-chip ${p.id === current ? 'on' : ''}`} onClick={() => setProductId(p.id)}>{p.name} <span className="st-muted">{p.hooks}</span></button>)}
        <input ref={file} type="file" accept=".md,.markdown,.txt,text/markdown,text/plain" hidden onChange={e => { const f = e.target.files?.[0]; e.target.value = ''; void upload(f) }} />
        <button className="st-btn sm" disabled={!!busy} onClick={() => file.current?.click()}><FileUp size={14} />Import a script kit</button>
        {busy && <span className="st-hint" role="status">{busy}</span>}
      </div>
      {!list.data ? <div className="st-skel" style={{ height: 160 }} /> : !products.length ? (
        <Callout tone="info">
          No products yet. A script kit holds a product's hook vault, its claims sheet and how buyers talk.{' '}
          {list.data.starter
            ? <><button className="st-todo-link" disabled={!!busy} onClick={() => void load({ starter: true })}>Load the SideStep script kit</button> or import your own (.md).</>
            : <>Import yours (.md) with Import a script kit.</>}
        </Callout>
      ) : !current ? (
        <div className="st-col" style={{ gap: 10 }}>
          <span className="st-hint" data-field="hooks-pick">Pick a product above to see its hooks, claims and buyer language.</span>
          <RunStatus match={j => j.purpose.startsWith('hook_variants:')} />
        </div>
      ) : !product.data ? <div className="st-skel" style={{ height: 320 }} /> : (
        <ProductPanel p={product.data} characters={characters} />
      )}
    </div>
  )
}

function ProductPanel({ p, characters }: { p: ProductView; characters: CharacterSummary[] }) {
  const qc = useQueryClient()
  const toast = useToast()
  const [kind, setKind] = useState<string | null>(null)
  const [open, setOpen] = useState<string | null>(null)
  const [picked, setPicked] = useState<string[]>(() => characters.map(c => c.id))
  const [adding, setAdding] = useState('')
  const kinds = [...new Set(p.hooks.map(h => h.kind).filter(Boolean))]
  const shown = p.hooks.filter(h => !kind || h.kind === kind)
  const refresh = () => qc.invalidateQueries({ queryKey: ['product', p.id] })
  // A variant run that finishes refreshes the vault.
  const active = useActiveJobs()
  const writing = (active.data?.jobs ?? []).some(j => j.purpose.startsWith('hook_variants:'))
  const was = useRef(writing)
  useEffect(() => { if (was.current && !writing) void refresh(); was.current = writing })

  async function add() {
    try { await api.addHook(p.id, { text: adding, kind: kind ?? '' }); setAdding(''); await refresh(); await qc.invalidateQueries({ queryKey: ['products'] }) } catch (e) { toast({ tone: 'bad', text: errorMessage(e) }) }
  }

  // The rules this product adds on top of the general standard (section 29):
  // its posts follow them, no other product's do.
  async function setWriting(writing: string) {
    try {
      await api.updateProduct(p.id, { writing }); await refresh()
      await qc.invalidateQueries({ queryKey: ['products'] }); await qc.invalidateQueries({ queryKey: keys.content })
    } catch (e) { toast({ tone: 'bad', text: errorMessage(e) }) }
  }

  return (
    <div className="st-col" style={{ gap: 18 }}>
      <section className="st-card" data-field="product-writing"><div className="st-card-body st-col" style={{ gap: 8 }}>
        <div className="st-row" style={{ gap: 10, flexWrap: 'wrap', alignItems: 'center' }}>
          <span className="st-h3">Writing rules</span>
          <select className="st-select" style={{ width: 'auto' }} value={p.writing ?? ''} onChange={e => void setWriting(e.target.value)} aria-label={`Writing rules for ${p.name}`}>
            {(p.writings ?? [{ key: '', label: 'General standard' }]).map(w => <option key={w.key} value={w.key}>{w.key ? `General standard + ${w.label}` : w.label}</option>)}
          </select>
          <HowTo id="products" label="About products" />
        </div>
        <span className="st-hint">Every post is written to the general standard: the stop test (a stranger would stop, clear on one read, says exactly what happened, sounds like a person), one story thread, an image line a slide, the voice from the character's voice card or the account. {p.writing ? `${p.name}'s posts also get ${p.writingLabel}: its own hook writer and reviewer, its honest endings on ads and its language notes.` : `${p.name} adds no rules of its own.`} Only posts whose product is {p.name} follow this.</span>
      </div></section>
      <section className="st-card" data-field="hook-vault"><div className="st-card-body st-col" style={{ gap: 12 }}>
        <div className="st-row" style={{ gap: 10, flexWrap: 'wrap' }}>
          <div className="grow"><div className="st-h3">Hook vault <span className="st-muted">({p.hooks.length})</span></div><span className="st-hint">Every hook opens on a conflict, a surprise or a question. Keep about 80% pure value and relatable posts, 20% soft product mentions.</span></div>
        </div>
        {kinds.length > 1 && (
          <div className="st-row" style={{ gap: 6, flexWrap: 'wrap' }}>
            <button className={`st-chip ${kind === null ? 'on' : ''}`} onClick={() => setKind(null)}>All types</button>
            {kinds.map(k => <button key={k} className={`st-chip ${kind === k ? 'on' : ''}`} onClick={() => setKind(k)}>{k}</button>)}
          </div>
        )}
        <div className="st-row" style={{ gap: 6, flexWrap: 'wrap', alignItems: 'center' }}>
          <span className="st-label">Write variants for</span>
          {characters.map(c => {
            const on = picked.includes(c.id)
            return <button key={c.id} className={`st-chip ${on ? 'on' : ''}`} onClick={() => setPicked(on ? picked.filter(x => x !== c.id) : [...picked, c.id])}>{c.name}</button>
          })}
        </div>
        <div className="st-col st-hooklist" style={{ gap: 6 }}>
          {shown.map(h => <HookRow key={h.id} h={h} product={p} open={open === h.id} onOpen={() => setOpen(open === h.id ? null : h.id)} picked={picked} characters={characters} onChange={refresh} />)}
        </div>
        <div className="st-row" style={{ gap: 8 }}>
          <input className="st-input" value={adding} onChange={e => setAdding(e.target.value)} placeholder={`A new hook${kind ? ` (${kind})` : ''}`} onKeyDown={e => { if (e.key === 'Enter' && adding.trim().length >= 3) void add() }} />
          <button className="st-btn sm" disabled={adding.trim().length < 3} onClick={() => void add()} title={adding.trim().length < 3 ? 'Write the hook first' : undefined}><Plus size={14} />Add hook</button>
        </div>
        <RunStatus match={j => j.purpose.startsWith('hook_variants:')} />
      </div></section>

      <div className="st-grid two" style={{ gap: 18, alignItems: 'start' }}>
        <GroupsCard title="Claims sheet" hint={`What we can say about ${p.name}. Anything about ${p.name} stays inside it; no made-up results. Variants that mention ${p.name} with a watch word get a warning.`} groups={p.claims.groups}
          extra={[{ label: 'Rules', items: p.claims.lines.map(l => `${l.label}: ${l.items.join(' ')}`) }, { label: 'Watch words', items: p.claims.watch }]}
          onSave={async (groups, extra) => {
            const rules = extra[0]!.items.map(x => { const m = x.match(/^([^:]{1,60}):\s*(.*)$/); return m ? { label: m[1]!.trim(), items: [m[2]!.trim()] } : { label: 'Note', items: [x] } })
            await api.updateProduct(p.id, { claims: { groups, lines: rules, watch: extra[1]!.items } }); await refresh()
          }} field="claims" />
        <GroupsCard title="Buyer language" hint={`How ${p.name}'s buyers really talk. Use these words, not marketing words. Add phrases from comments and reviews as you collect them.`} groups={p.language.groups}
          onSave={async groups => { await api.updateProduct(p.id, { language: { groups } }); await refresh() }} field="language" />
      </div>

      {p.voices.length > 0 && <KitVoices p={p} characters={characters} />}
      {p.notes && <section className="st-card"><div className="st-card-body st-col" style={{ gap: 8 }}><div className="st-h3">Notes from the kit</div><pre className="st-pre" style={{ whiteSpace: 'pre-wrap', margin: 0 }}>{p.notes}</pre></div></section>}
    </div>
  )
}

function HookRow({ h, product, open, onOpen, picked, characters, onChange }: { h: KitHook; product: ProductView; open: boolean; onOpen: () => void; picked: string[]; characters: CharacterSummary[]; onChange: () => void }) {
  const toast = useToast()
  const newPost = useNewPost()
  const [text, setText] = useState(h.text)
  useEffect(() => setText(h.text), [h.text])
  const nameOf = (id: string) => characters.find(c => c.id === id)?.name ?? 'Unknown'
  async function save() {
    if (text.trim() === h.text) return
    try { await api.updateHook(h.id, { text }); onChange() } catch (e) { toast({ tone: 'bad', text: errorMessage(e) }) }
  }
  async function copy(t: string) {
    try { await navigator.clipboard.writeText(t); toast({ tone: 'ok', text: 'Copied.' }) } catch { toast({ tone: 'bad', text: 'Could not copy; select the text instead.' }) }
  }
  return (
    <div className={`st-hookrow ${open ? 'open' : ''}`} data-hook={h.number}>
      <div className="st-row" style={{ gap: 8, alignItems: 'center' }}>
        <span className="st-badge" title={h.kind}>{h.number}</span>
        <input className="st-input bare" value={text} onChange={e => setText(e.target.value)} onBlur={() => void save()} aria-label={`Hook ${h.number}`} />
        {h.kind && <span className="st-hint" style={{ whiteSpace: 'nowrap' }}>{h.kind}</span>}
        <button className={`st-btn sm ${open ? '' : 'ghost'}`} onClick={onOpen}><Sparkles size={13} />{h.variants.length ? `Variants (${h.variants.length})` : 'Write variants'}</button>
        <button className="st-btn sm icon ghost" aria-label="Archive this hook" title="Archive" onClick={async () => { try { await api.archiveHook(h.id); onChange() } catch (e) { toast({ tone: 'bad', text: errorMessage(e) }) } }}><Archive size={13} /></button>
      </div>
      {open && (
        <div className="st-col" style={{ gap: 8, padding: '10px 0 6px 40px' }}>
          <div className="st-row" style={{ gap: 8, flexWrap: 'wrap' }}>
            <PriceButton action={picked.length ? { type: 'hook_variants', hookId: h.id, characterIds: picked } : null} label={`Write ${picked.length} variant${picked.length === 1 ? '' : 's'}`} size="sm" todo={picked.length ? [] : [{ label: 'Pick at least one character above' }]} onStarted={onChange} />
            <span className="st-hint">One per picked character, in their voice card, inside the {product.name} claims sheet.</span>
          </div>
          {h.variants.map(v => (
            <div key={v.id} className="st-variant">
              <span className="st-badge">{nameOf(v.characterId)}</span>
              <span className="st-variant-text">{v.text}</span>
              <span className="st-spacer" />
              <button className="st-btn sm icon ghost" aria-label="Copy" title="Copy" onClick={() => void copy(v.text)}><Copy size={13} /></button>
              <button className="st-btn sm ghost" disabled={!!newPost.busy} onClick={() => void newPost.create('meme', { characterId: v.characterId, idea: v.text, spec: { caption: v.text }, productId: product.id })}><Plus size={13} />Use in a new post</button>
              <button className="st-btn sm icon ghost" aria-label="Archive this variant" title="Archive" onClick={async () => { try { await api.archiveVariant(v.id); onChange() } catch (e) { toast({ tone: 'bad', text: errorMessage(e) }) } }}><Archive size={13} /></button>
              {v.flags.map(f => <span key={f} className="st-hint st-warntext" style={{ flexBasis: '100%' }}><AlertTriangle size={12} style={{ verticalAlign: -2 }} /> {f}</span>)}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

// A list of labeled groups, edited as plain text: "Label:" on its own line,
// then one item per line.
const toText = (groups: KitGroup[]) => groups.map(g => [`${g.label}:`, ...g.items].join('\n')).join('\n\n')
function fromText(t: string): KitGroup[] {
  const out: KitGroup[] = []
  for (const raw of t.split('\n')) {
    const line = raw.trim().replace(/^[-*]\s+/, '')
    if (!line) continue
    const head = raw.trim().match(/^([^:]{1,60}):$/)
    if (head) { out.push({ label: head[1]!.trim(), items: [] }); continue }
    if (!out.length) out.push({ label: 'Notes', items: [] })
    out[out.length - 1]!.items.push(line)
  }
  return out
}

function GroupsCard({ title, hint, groups, extra = [], onSave, field }: { title: string; hint: string; groups: KitGroup[]; extra?: KitGroup[]; onSave: (groups: KitGroup[], extra: KitGroup[]) => Promise<void>; field: string }) {
  const toast = useToast()
  const [editing, setEditing] = useState(false)
  const [text, setText] = useState('')
  const [extraText, setExtraText] = useState<string[]>([])
  const [busy, setBusy] = useState(false)
  function start() { setText(toText(groups)); setExtraText(extra.map(e => e.items.join('\n'))); setEditing(true) }
  async function save() {
    setBusy(true)
    try {
      await onSave(fromText(text), extra.map((e, i) => ({ label: e.label, items: (extraText[i] ?? '').split('\n').map(x => x.trim()).filter(Boolean) })))
      setEditing(false)
      toast({ tone: 'ok', text: `${title} saved.` })
    } catch (e) { toast({ tone: 'bad', text: errorMessage(e) }) } finally { setBusy(false) }
  }
  return (
    <section className="st-card" data-field={field}><div className="st-card-body st-col" style={{ gap: 10 }}>
      <div className="st-row"><div className="grow"><div className="st-h3">{title}</div><span className="st-hint">{hint}</span></div>{!editing && <button className="st-btn sm ghost" onClick={start}>Edit</button>}</div>
      {editing ? (
        <div className="st-col" style={{ gap: 8 }}>
          <textarea className="st-textarea" rows={14} value={text} onChange={e => setText(e.target.value)} aria-label={title} />
          <span className="st-hint">A line ending in a colon starts a group; every other line is one item.</span>
          {extra.map((e, i) => (
            <label key={e.label} className="st-col" style={{ gap: 4 }}><span className="st-label">{e.label} (one per line)</span>
              <textarea className="st-textarea" rows={4} value={extraText[i] ?? ''} onChange={ev => setExtraText(x => x.map((y, j) => (j === i ? ev.target.value : y)))} /></label>
          ))}
          <div className="st-row" style={{ gap: 8, justifyContent: 'flex-end' }}><button className="st-btn sm ghost" onClick={() => setEditing(false)}>Cancel</button><button className="st-btn sm primary" disabled={busy} onClick={() => void save()}>{busy ? 'Saving...' : 'Save'}</button></div>
        </div>
      ) : (
        <div className="st-col" style={{ gap: 10 }}>
          {[...groups, ...extra].filter(g => g.items.length).map(g => (
            <div key={g.label} className="st-col" style={{ gap: 4 }}><span className="st-label">{g.label}</span><ul className="st-list" style={{ margin: 0, paddingLeft: 18 }}>{g.items.map((it, i) => <li key={i}>{it}</li>)}</ul></div>
          ))}
          {!groups.length && <span className="st-hint">Nothing here yet. Edit to add.</span>}
        </div>
      )}
    </div></section>
  )
}

function KitVoices({ p, characters }: { p: ProductView; characters: CharacterSummary[] }) {
  const toast = useToast()
  const qc = useQueryClient()
  const [target, setTarget] = useState<Record<string, string>>({})
  async function use(name: string) {
    const characterId = target[name]
    const ch = characters.find(c => c.id === characterId)
    if (!ch) return
    try {
      await api.useKitVoice(p.id, name, ch.id)
      await qc.invalidateQueries({ queryKey: ['character', ch.id] })
      toast({ tone: 'ok', text: `${ch.name} now writes as "${name}". Change it any time in ${ch.name}'s Voice.` })
    } catch (e) { toast({ tone: 'bad', text: errorMessage(e) }) }
  }
  return (
    <section className="st-card"><div className="st-card-body st-col" style={{ gap: 12 }}>
      <div><div className="st-h3">Voice cards in this kit</div><span className="st-hint">A starting point for a character's voice. Use one for a character, then edit it in that character's Voice.</span></div>
      <div className="st-grid two" style={{ gap: 12 }}>
        {p.voices.map(v => (
          <div key={v.name} className="st-card" style={{ padding: 14, boxShadow: 'none' }}>
            <div className="st-row" style={{ gap: 8 }}><b>{v.name}</b><span className={`st-badge ${v.status === 'live' ? 'ok' : ''}`}>{v.status === 'live' ? 'Live' : 'Proposed'}</span></div>
            <div className="st-hint" style={{ marginTop: 6 }}>{[v.card.who, v.card.talks, v.card.example ? `"${v.card.example}"` : ''].filter(Boolean).join(' · ')}</div>
            <div className="st-row" style={{ gap: 8, marginTop: 10 }}>
              <select className="st-input" style={{ maxWidth: 200 }} value={target[v.name] ?? ''} onChange={e => setTarget(t => ({ ...t, [v.name]: e.target.value }))} aria-label={`Character for ${v.name}`}>
                <option value="">Pick a character</option>
                {characters.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
              </select>
              <button className="st-btn sm" disabled={!target[v.name]} onClick={() => void use(v.name)} title={!target[v.name] ? 'Pick a character first' : undefined}>Use this voice</button>
            </div>
          </div>
        ))}
      </div>
    </div></section>
  )
}
