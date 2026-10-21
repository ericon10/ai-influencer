import { useEffect, useMemo, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { useQueryClient } from '@tanstack/react-query'
import { Archive, CopyPlus, FileUp, Film, Images, Layers, Loader2, Plus } from 'lucide-react'
import { api, assetUrl } from '../api'
import { keys, useCharacters, useContent, useLibrary } from '../hooks'
import { Callout, Img, errorMessage, useToast } from '../ui'
import { REALISM_LINE } from '../copy'
import type { BatchSpec, ContentItem, LibraryData, MemeSpec, SlideshowSpec } from '../types'
import { KIND_LABEL, NEW_POST, STEPS, postName, useDuplicate, useNewPost } from './post/parts'
import { batchProgress } from './post/batchProgress'
import { HowTo, QuickStartBanner } from '../guide/Guide'
import { AccountsCard } from './AccountsCard'
import { PlanCard } from './PlanCard'
import { ImportDoor } from '../importDoor'
import { ResultsCard } from './ResultsCard'
import { DownloadDayCard } from './DownloadDayCard'
import { PostingChips } from '../posting'
import { ResultsRow, useResultsView } from '../results'
import type { ResultHint } from '../types'
import { SelectBar, SelectToggle, TileCheck, useSelection } from '../trash'

// Home (UX-PLAN.md): every post, newest work first, filtered by account,
// character and product (section 29). One click opens a post where it was
// left.

const KIND_ICON = { meme: Film, slideshow: Images, batch: Layers }

export default function Posts() {
  const content = useContent()
  const chars = useCharacters()
  const lib = useLibrary()
  const newPost = useNewPost()
  const [tag, setTag] = useState<string | null>(null)
  const [character, setCharacter] = useState<string | null>(null)
  // The product filter (section 29): a product id, or "none".
  const [product, setProduct] = useState<string | null>(null)
  const items = content.data?.items ?? []
  const characters = chars.data?.characters ?? []
  const products = content.data?.products ?? []
  // The list holds the newest 200 posts; Show older posts pages past them,
  // with the filters applied on the server (so a filter finds older posts).
  const older = useOlderPosts(content.data?.next ?? null, items.at(-1)?.id ?? null, tag, character, product)
  const all = useMemo(() => { const seen = new Set(items.map(i => i.id)); return [...items, ...older.items.filter(i => !seen.has(i.id))] }, [items, older.items])
  const shown = all.filter(i => (!tag || i.accountTag === tag) && (!character || i.characterId === character) && (!product || (product === 'none' ? !i.productId : i.productId === product)))
  const tags = content.data?.accountTags ?? []
  const used = useMemo(() => new Set([...(content.data?.characterIds ?? []), ...items.map(i => i.characterId)]), [items, content.data?.characterIds])
  // The decision hints on each card (section 32), read over every post.
  const hints = useResultsView().data?.hints ?? {}
  const nav = useNavigate()
  const toast = useToast()
  const qc = useQueryClient()
  const [setting, setSetting] = useState(false)
  // Select many (owner, 2026-10-22): tick posts, Select all respects the
  // filters, shift-click a range; the ticked ones go to the Trash together.
  const sel = useSelection<ContentItem>()
  async function trashPicked() {
    const n = sel.items.length
    try {
      await api.trash(sel.items.map(i => ({ kind: 'post' as const, id: i.id })))
      sel.stop()
      await qc.invalidateQueries({ queryKey: keys.content })
      toast({ tone: 'ok', text: `${n} post${n === 1 ? '' : 's'} moved to Library > Trash. Restore within 7 days.` })
    } catch (e) { toast({ tone: 'bad', text: errorMessage(e) }) }
  }
  async function setUp() {
    setSetting(true)
    try { const { id } = await api.createCharacter('New character'); nav(`/studio/characters/${id}`) } catch (e) { toast({ tone: 'bad', text: errorMessage(e) }) } finally { setSetting(false) }
  }

  return (
    <div className="st-page wide">
      <div className="st-pagehead">
        <div className="grow">
          <div className="st-kicker st-row" style={{ gap: 10 }}>Posts<HowTo id="posts" /></div>
          <h1 className="st-h1">Your posts</h1>
          <p className="st-sub">Each post goes from an idea to an exported video or slideshow on one page.</p>
        </div>
        <div className="st-row" style={{ gap: 8, flexWrap: 'wrap' }}>
          {characters.length > 0 && <ImportDoor newBatch={async () => { await newPost.create('batch'); return 'batch' }} />}
          {NEW_POST.map(([kind, label]) => {
            const Icon = KIND_ICON[kind]
            return <button key={kind} className={`st-btn ${kind === 'meme' ? 'primary' : ''}`} disabled={!!newPost.busy} onClick={() => void newPost.create(kind)}>{newPost.busy === kind ? <Loader2 size={15} className="st-spin" /> : <Icon size={15} />}{label}</button>
          })}
        </div>
      </div>

      <QuickStartBanner />
      {characters.length > 0 && <AccountsCard characters={characters} />}
      {characters.length > 0 && <PlanCard characters={characters} />}
      {characters.length > 0 && items.length > 0 && <DownloadDayCard />}
      {characters.length > 0 && items.length > 0 && <ResultsCard tag={tag} character={character} product={product} filtered={!!(tag || character || product)} />}

      {(tags.length > 0 || used.size > 1 || products.length > 0) && (
        <div className="st-col" style={{ gap: 8, marginBottom: 18 }}>
          {tags.length > 0 && (
            <div className="st-row" style={{ gap: 6, flexWrap: 'wrap' }}>
              <span className="st-label" style={{ width: 76 }}>Account</span>
              <button className={`st-chip ${tag === null ? 'on' : ''}`} onClick={() => setTag(null)}>All</button>
              {tags.map(t => <button key={t} className={`st-chip ${tag === t ? 'on' : ''}`} onClick={() => setTag(t)}>{t}</button>)}
            </div>
          )}
          {used.size > 1 && (
            <div className="st-row" style={{ gap: 6, flexWrap: 'wrap' }}>
              <span className="st-label" style={{ width: 76 }}>Character</span>
              <button className={`st-chip ${character === null ? 'on' : ''}`} onClick={() => setCharacter(null)}>All</button>
              {characters.filter(c => used.has(c.id)).map(c => <button key={c.id} className={`st-chip ${character === c.id ? 'on' : ''}`} onClick={() => setCharacter(c.id)}>{c.name}</button>)}
            </div>
          )}
          {products.length > 0 && (
            <div className="st-row" style={{ gap: 6, flexWrap: 'wrap' }} data-field="posts-product-filter">
              <span className="st-label" style={{ width: 76 }}>Product</span>
              <button className={`st-chip ${product === null ? 'on' : ''}`} onClick={() => setProduct(null)}>All</button>
              {products.map(p => <button key={p.id} className={`st-chip ${product === p.id ? 'on' : ''}`} onClick={() => setProduct(p.id)}>{p.name}</button>)}
              <button className={`st-chip ${product === 'none' ? 'on' : ''}`} onClick={() => setProduct('none')}>No product</button>
            </div>
          )}
        </div>
      )}

      {!content.data || chars.isLoading ? (
        <div className="st-grid cards">{[0, 1, 2].map(i => <div key={i} className="st-skel" style={{ height: 300, borderRadius: 26 }} />)}</div>
      ) : !characters.length ? (
        <div className="st-empty">
          <h2 className="st-h1">Start with a <em>character</em></h2>
          <p className="st-sub" style={{ margin: 0 }}>Posts use your characters' stills and clips. Set one up from an inspiration image, or import one you already built.</p>
          <p className="st-realism">{REALISM_LINE}</p>
          <div className="st-row" style={{ justifyContent: 'center' }}>
            <Link className="st-btn" to="/studio/characters?import=1"><FileUp size={16} />Import one</Link>
            <button className="st-btn primary big" disabled={setting} onClick={() => void setUp()}>{setting ? <Loader2 size={18} className="st-spin" /> : <Plus size={18} />}Set up a character</button>
          </div>
        </div>
      ) : !items.length ? (
        <div className="st-empty">
          <h2 className="st-h1">Make your first <em>post</em></h2>
          <p className="st-sub" style={{ margin: 0 }}>Start from an idea. Stills, video, text and export all happen on the post's page.</p>
          <div className="st-row" style={{ justifyContent: 'center' }}>
            {NEW_POST.map(([kind, label, hint]) => {
              const Icon = KIND_ICON[kind]
              return <button key={kind} className={`st-btn ${kind === 'meme' ? 'primary big' : ''}`} title={hint} disabled={!!newPost.busy} onClick={() => void newPost.create(kind)}><Icon size={16} />Make a {label.toLowerCase()}</button>
            })}
          </div>
        </div>
      ) : !shown.length && !older.more ? (
        <Callout tone="info">No posts match these filters. <button className="st-todo-link" onClick={() => { setTag(null); setCharacter(null); setProduct(null) }}>Show all posts</button></Callout>
      ) : (
        <>
          {shown.length > 0 && (
            <div className="st-row" style={{ gap: 8, marginBottom: 10, flexWrap: 'wrap' }}>
              <SelectToggle sel={sel} />
            </div>
          )}
          <SelectBar sel={sel} all={shown} help="posts">
            <button type="button" className="st-btn sm bad" disabled={!sel.items.length} onClick={() => void trashPicked()}>Move {sel.items.length || ''} to the Trash</button>
          </SelectBar>
          {shown.length > 0 && (
            <div className="st-grid cards">
              {shown.map(i => <PostCard key={i.id} item={i} lib={lib.data} characterName={characters.find(c => c.id === i.characterId)?.name ?? ''} productName={products.find(p => p.id === i.productId)?.name ?? ''} hints={hints[i.id]}
                select={sel.on ? { on: sel.has(i.id), toggle: e => sel.toggle(i, e) } : null} />)}
            </div>
          )}
          {older.more && (
            <div className="st-row" style={{ gap: 10, justifyContent: 'center', marginTop: 18, flexWrap: 'wrap' }} data-field="posts-older">
              {!shown.length && <span className="st-hint">None of the newest {items.length} posts match these filters.</span>}
              <button type="button" className="st-btn" disabled={older.loading} onClick={() => void older.load()}>{older.loading ? <Loader2 size={15} className="st-spin" /> : null}Show older posts</button>
              <span className="st-hint">{shown.length} shown{tag || character || product ? ' (filtered)' : ''}. Older ones load {PAGE} at a time.</span>
            </div>
          )}
        </>
      )}
    </div>
  )
}

// Older posts than the newest 200, a page at a time. A filter starts the
// pages again from the end of the list, filtered on the server.
const PAGE = 60
function useOlderPosts(first: string | null, lastListed: string | null, tag: string | null, character: string | null, product: string | null) {
  const toast = useToast()
  const [state, setState] = useState<{ key: string; items: ContentItem[]; next: string | null }>({ key: '', items: [], next: null })
  const [loading, setLoading] = useState(false)
  const key = `${first ?? ''}|${tag ?? ''}|${character ?? ''}|${product ?? ''}`
  // A new list or a new filter starts over from the end of the list.
  useEffect(() => { setState({ key, items: [], next: first ? lastListed : null }) }, [key, first, lastListed])
  const cursor = state.key === key ? state.next : (first ? lastListed : null)
  async function load() {
    if (!cursor) return
    setLoading(true)
    try {
      const page = await api.contentPage({ before: cursor, limit: PAGE, tag, character, product })
      setState(s => ({ key, items: [...(s.key === key ? s.items : []), ...page.items], next: page.next }))
    } catch (e) { toast({ tone: 'bad', text: errorMessage(e) }) } finally { setLoading(false) }
  }
  return { items: state.key === key ? state.items : [], more: !!cursor, loading, load }
}

// The picture on a post's card: its export, else its clip, else its still.
function cover(item: ContentItem, lib: LibraryData | undefined): { video?: string; image?: string } {
  const o = item.outputs
  if (o.imageAssetIds?.[0]) return { image: o.imageAssetIds[0] }
  // A faceless post shows its still (section 35, item 4e).
  const faceless = (item.spec as { faceless?: { stillAssetId?: string } | null }).faceless
  if (faceless?.stillAssetId) return { image: faceless.stillAssetId }
  const clipId = item.kind === 'meme' ? (item.spec as unknown as MemeSpec).clipId : item.kind === 'batch' ? (item.spec as unknown as BatchSpec).clipIds?.[0] : null
  const clip = clipId ? lib?.clips.find(c => c.id === clipId) : undefined
  if (clip?.posterId) return { image: clip.posterId }
  const video = o.videoAssetId ?? o.videos?.find(v => v)?.assetId ?? (clip?.status === 'approved' ? clip.assetId : undefined)
  if (video) return { video }
  const stillId = item.kind === 'slideshow' ? (item.spec as unknown as SlideshowSpec).stillIds?.[0] : (item.spec as unknown as MemeSpec).stillId
  const still = stillId ? lib?.stills.find(s => s.id === stillId) : undefined
  return still ? { image: still.assetId } : {}
}

const STATUS: Record<ContentItem['status'], { label: string; tone: string }> = {
  draft: { label: 'Draft', tone: '' }, rendering: { label: 'Rendering', tone: 'accent live' }, ready: { label: 'Exported', tone: 'ok' }, failed: { label: 'Export failed', tone: 'bad' },
}

function PostCard({ item, lib, characterName, productName, hints, select }: { item: ContentItem; lib: LibraryData | undefined; characterName: string; productName: string; hints?: ResultHint[]; select?: { on: boolean; toggle: (e: { shiftKey: boolean }) => void } | null }) {
  const toast = useToast()
  const qc = useQueryClient()
  const duplicate = useDuplicate()
  const c = cover(item, lib)
  const st = STATUS[item.status] ?? STATUS.draft
  const step = STEPS[item.kind].find(([k]) => k === item.step)?.[1]
  async function archive() {
    try { await api.archiveContent(item.id); await qc.invalidateQueries({ queryKey: keys.content }); toast({ tone: '', text: 'Post archived.' }) } catch (e) { toast({ tone: 'bad', text: errorMessage(e) }) }
  }
  return (
    <div className={`st-casting st-postcard ${select?.on ? 'picked' : ''}`}>
      {select && <button type="button" className="st-tile-open st-postcard-select" aria-pressed={select.on} aria-label={`Select ${postName(item)}`} onClick={e => select.toggle(e)}><TileCheck on={select.on} /></button>}
      <Link to={`/studio/posts/${item.id}`} className="st-postcard-cover" aria-label={`Open ${postName(item)}`}>
        {c.video ? <video src={`${assetUrl(c.video)}#t=0.1`} muted playsInline preload="metadata" /> : <Img assetId={c.image} width={520} />}
        <span className={`st-badge ${st.tone}`}>{item.status === 'draft' && step ? `Draft · ${step}` : st.label}</span>
      </Link>
      <div className="st-casting-body">
        <Link to={`/studio/posts/${item.id}`} className="st-postcard-name">{postName(item)}</Link>
        <div className="st-casting-meta">
          <span>{[KIND_LABEL[item.kind], characterName, item.accountTag, productName].filter(Boolean).join(' · ')}</span>
        </div>
        {item.kind === 'batch' && <BatchProgress item={item} />}
        <PostingChips item={item} />
        <ResultsRow item={item} hints={hints} />
        <div className="st-row" style={{ gap: 4 }}>
          <span className="st-hint">{new Date(item.updatedAt).toLocaleDateString([], { month: 'short', day: 'numeric' })}</span>
          <span className="st-spacer" />
          <button className="st-btn sm ghost" onClick={() => void duplicate(item.id)} title="Make another like this"><CopyPlus size={14} />Another</button>
          <button className="st-btn sm ghost icon" onClick={archive} title="Archive" aria-label="Archive"><Archive size={14} /></button>
        </div>
      </div>
    </div>
  )
}

// A batch's progress on its card, live while it renders.
function BatchProgress({ item }: { item: ContentItem }) {
  const p = batchProgress(item.outputs)
  if (!p) return null
  return (
    <div className="st-col" style={{ gap: 4 }} aria-live="polite">
      <span className="st-hint">{item.status === 'rendering' ? 'Rendering: ' : ''}{p.text}</span>
      {item.status === 'rendering' && <div className="st-meter" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(p.share * 100)}><span style={{ width: `${Math.round(p.share * 100)}%` }} /></div>}
    </div>
  )
}
