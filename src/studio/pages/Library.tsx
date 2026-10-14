import { useMemo, useRef, useState, type ReactNode } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { useQueryClient } from '@tanstack/react-query'
import { Archive, AudioLines, Clapperboard, Download, Film, History, Images, LayoutGrid, Loader2, Music, Plus, Upload, Wind } from 'lucide-react'
import { api, assetUrl, downloadUrl } from '../api'
import { keys, useCharacters, useContent, useLibrary, useScenes, useSounds, useWorkerGate } from '../hooks'
import { Callout, Img, errorMessage, useToast } from '../ui'
import { ClipGrid, ClipUpload, StillGrid } from '../library'
import { RunStatus } from '../runs'
import type { BrollClip, ContentData, ScenesData, SoundItem } from '../types'
import { KIND_LABEL, fileSlug, postName, useNewPost } from './post/parts'
import { HowTo } from '../guide/Guide'

// The Library (UX-PLAN.md): browse everything made, across characters.
// Stills and clips start a new post in one click; B-roll is uploaded and
// tagged here; exported posts can be downloaded again.

type Tab = 'stills' | 'clips' | 'broll' | 'sounds' | 'posts'
const TABS: Array<[Tab, string, ReactNode]> = [
  ['stills', 'Stills', <Images size={14} key="s" />],
  ['clips', 'Clips', <Film size={14} key="c" />],
  ['broll', 'B-roll', <Clapperboard size={14} key="b" />],
  ['sounds', 'Sounds', <AudioLines size={14} key="a" />],
  ['posts', 'Posts', <LayoutGrid size={14} key="p" />],
]

export default function Library() {
  const [params, setParams] = useSearchParams()
  const tab = (TABS.some(([k]) => k === params.get('tab')) ? params.get('tab') : 'stills') as Tab
  const characterId = params.get('c')
  const scene = params.get('scene')
  const chars = useCharacters()
  const lib = useLibrary(characterId)
  const content = useContent()
  const newPost = useNewPost()
  const characters = chars.data?.characters ?? []
  const set = (patch: Record<string, string | null>) => {
    const next = new URLSearchParams(params)
    for (const [k, v] of Object.entries(patch)) { if (v === null) next.delete(k); else next.set(k, v) }
    setParams(next, { replace: true })
  }
  const stills = (lib.data?.stills ?? []).filter(s => !scene || s.sceneId === scene)
  const clips = lib.data?.clips ?? []
  const uploadFor = characterId ?? (characters.length === 1 ? characters[0]!.id : null)

  return (
    <div className="st-page wide">
      <div className="st-pagehead">
        <div className="grow"><div className="st-kicker st-row" style={{ gap: 10 }}>Library<HowTo id="library" /></div><h1 className="st-h1">Everything you made</h1><p className="st-sub">Stills, clips, B-roll and exported posts. Start a new post from any still or clip.</p></div>
      </div>
      <div className="st-row" style={{ gap: 12, flexWrap: 'wrap', marginBottom: 18 }}>
        <div className="st-seg" role="tablist">
          {TABS.map(([k, label, icon]) => <button key={k} role="tab" aria-selected={tab === k} className={tab === k ? 'on' : ''} onClick={() => set({ tab: k, scene: null })}><span className="st-row" style={{ gap: 6 }}>{icon}{label}</span></button>)}
        </div>
        {tab !== 'broll' && characters.length > 1 && (
          <div className="st-row" style={{ gap: 6, flexWrap: 'wrap' }}>
            <button className={`st-chip ${!characterId ? 'on' : ''}`} onClick={() => set({ c: null })}>All characters</button>
            {characters.map(c => <button key={c.id} className={`st-chip ${characterId === c.id ? 'on' : ''}`} onClick={() => set({ c: c.id })}>{c.name}</button>)}
          </div>
        )}
      </div>

      {tab === 'stills' && (
        !lib.data ? <Skel /> : (
          <div className="st-col" style={{ gap: 20 }}>
            {scene && <Callout tone="info">Showing one scene's stills. <button className="st-todo-link" onClick={() => set({ scene: null })}>Show all stills</button></Callout>}
            {!stills.length ? <Callout tone="info">No stills yet. Make them in a post's Stills step. <button className="st-todo-link" onClick={() => void newPost.create('meme')}>Start a video post</button></Callout> : (
              <StillGrid stills={stills} showCharacter={!characterId} action={s => (
                <button type="button" className="st-btn sm" disabled={!!newPost.busy} onClick={() => void newPost.create('meme', { characterId: s.characterId, sceneId: s.sceneId, spec: { stillId: s.id }, step: 'video' })}><Plus size={13} />Use in a new post</button>
              )} />
            )}
            {characterId && <ComboLog characterId={characterId} />}
          </div>
        )
      )}

      {tab === 'clips' && (
        !lib.data ? <Skel /> : (
          <div className="st-col" style={{ gap: 16 }}>
            <div className="st-row" style={{ gap: 10, flexWrap: 'wrap' }}>
              {uploadFor ? <ClipUpload characterId={uploadFor} label={`Upload a video${characters.length > 1 ? ` of ${characters.find(c => c.id === uploadFor)?.name}` : ''}`} /> : <span className="st-hint">Pick a character above to upload a video as one of their clips.</span>}
              <span className="st-hint">Kept takes, uploads and clones. Any video file becomes a clip.</span>
            </div>
            {!clips.length ? <Callout tone="info">No clips yet. Keep a take in a post's Video step, or upload a video.</Callout> : (
              <ClipGrid clips={clips} showCharacter={!characterId} action={c => (
                <button type="button" className="st-btn sm" disabled={!!newPost.busy} onClick={() => void newPost.create('meme', { characterId: c.characterId, spec: { clipId: c.id }, step: 'text' })}><Plus size={13} />Make a video post</button>
              )} />
            )}
          </div>
        )
      )}

      {tab === 'broll' && (!content.data ? <Skel /> : <BrollTab data={content.data} />)}

      {tab === 'sounds' && <SoundsTab />}

      {tab === 'posts' && (
        !content.data ? <Skel /> : <ExportedPosts data={content.data} characterId={characterId} />
      )}
    </div>
  )
}

const Skel = () => <div className="st-skel" style={{ height: 240, borderRadius: 18 }} />

// Library > Sounds (Phase 3 sound bed): ambience recordings and music
// tracks for the Finish step's Sound row. Room tone is built in. No AI music.
function SoundsTab() {
  const toast = useToast()
  const qc = useQueryClient()
  const sounds = useSounds()
  const worker = useWorkerGate()
  const [busy, setBusy] = useState<string | null>(null)
  const [added, setAdded] = useState<string[]>([])
  const input = useRef<HTMLInputElement | null>(null)
  const kind = useRef<'ambience' | 'music'>('ambience')
  async function upload(files: File[]) {
    for (const [i, f] of files.entries()) {
      setBusy(`Uploading ${f.name} (${i + 1} of ${files.length})...`)
      try { const row = await api.addSound(f, kind.current); setAdded(a => [...a, row.id]) } catch (e) { toast({ tone: 'bad', text: `${f.name}: ${errorMessage(e)}` }) }
    }
    setBusy(null)
    await qc.invalidateQueries({ queryKey: ['sounds'] })
  }
  const pick = (k: 'ambience' | 'music') => { kind.current = k; input.current?.click() }
  const list = sounds.data?.sounds ?? []
  return (
    <div className="st-col" style={{ gap: 18 }}>
      <section className="st-card"><div className="st-card-body st-col" style={{ gap: 12 }}>
        <div className="st-h3">Add sounds</div>
        <span className="st-hint">Ambience: a real recording of a place (a cafe, a street, a room). Music: a track you have the rights to. Each is converted and measured so the mix can level it. Room tone is built in. No AI music.</span>
        <input ref={input} type="file" accept="audio/*,video/*" multiple hidden onChange={e => { const f = Array.from(e.target.files ?? []); e.target.value = ''; void upload(f) }} />
        <div className="st-row" style={{ gap: 10, flexWrap: 'wrap' }}>
          <button className="st-btn" disabled={!!busy || !worker.ready} onClick={() => pick('ambience')}><Wind size={15} />Upload ambience</button>
          <button className="st-btn" disabled={!!busy || !worker.ready} onClick={() => pick('music')}><Music size={15} />Upload music</button>
          {busy && <span className="st-hint"><Loader2 size={12} className="st-spin" style={{ verticalAlign: -2 }} /> {busy}</span>}
          {!worker.ready && <span className="st-hint st-warntext" role="status">{worker.reason} Uploads are prepared by the worker.</span>}
        </div>
        <RunStatus match={j => added.some(id => j.purpose === `sound_ingest:${id}`)} />
      </div></section>
      {!sounds.data ? <Skel /> : !list.length ? <Callout tone="info">No sounds yet. Room tone is built in; upload a recording or a track to add more.</Callout> : (
        <div className="st-soundlist">{list.map(x => <SoundCard key={x.id} s={x} />)}</div>
      )}
    </div>
  )
}

function SoundCard({ s }: { s: SoundItem }) {
  const toast = useToast()
  const qc = useQueryClient()
  const [title, setTitle] = useState(s.title)
  const [tag, setTag] = useState(s.tag)
  async function save(patch: { title?: string; tag?: string; kind?: 'ambience' | 'music' }) {
    try { await api.updateSound(s.id, patch); await qc.invalidateQueries({ queryKey: ['sounds'] }) } catch (e) { toast({ tone: 'bad', text: errorMessage(e) }) }
  }
  async function archive() {
    try { await api.archiveSound(s.id); await qc.invalidateQueries({ queryKey: ['sounds'] }) } catch (e) { toast({ tone: 'bad', text: errorMessage(e) }) }
  }
  return (
    <div className="st-sounditem">
      {s.kind === 'music' ? <Music size={16} /> : <Wind size={16} />}
      <input className="st-input" style={{ maxWidth: 240 }} value={title} onChange={e => setTitle(e.target.value)} onBlur={() => title !== s.title && void save({ title })} aria-label="Title" />
      <input className="st-input" style={{ maxWidth: 160 }} value={tag} onChange={e => setTag(e.target.value)} onBlur={() => tag !== s.tag && void save({ tag })} placeholder="Tag, e.g. cafe" aria-label="Tag" />
      <div className="st-seg sm" role="radiogroup" aria-label="Kind">
        {(['ambience', 'music'] as const).map(k => <button key={k} type="button" role="radio" aria-checked={s.kind === k} className={s.kind === k ? 'on' : ''} onClick={() => s.kind !== k && void save({ kind: k })}>{k === 'music' ? 'Music' : 'Ambience'}</button>)}
      </div>
      <span className="st-hint">{s.status === 'processing' ? 'Being prepared...' : s.status === 'failed' ? s.error : [s.durationSec ? `${s.durationSec} s` : '', s.loudness != null ? `${s.loudness} LUFS` : ''].filter(Boolean).join(' · ')}</span>
      <span className="st-spacer" />
      {s.assetId && <audio className="st-audio" src={assetUrl(s.assetId)} controls preload="none" />}
      <button className="st-btn sm ghost icon" onClick={() => void archive()} aria-label={`Remove ${s.title}`} title="Remove from the library"><Archive size={14} /></button>
    </div>
  )
}

function ExportedPosts({ data, characterId }: { data: ContentData; characterId: string | null }) {
  const done = data.items.filter(i => (i.status === 'ready' || i.outputs.zipAssetId || i.outputs.videoAssetId) && (!characterId || i.characterId === characterId))
  if (!done.length) return <Callout tone="info">No exported posts yet. Export one from its Finish step.</Callout>
  return (
    <div className="st-content-videos">
      {done.map(i => {
        const o = i.outputs
        const name = fileSlug(postName(i))
        return (
          <div key={i.id} className="st-card st-col" style={{ gap: 8, padding: 10 }}>
            {o.videoAssetId ? <video className="st-content-result sm" src={assetUrl(o.videoAssetId)} controls playsInline preload="metadata" />
              : o.imageAssetIds?.[0] ? <Img assetId={o.imageAssetIds[0]} width={320} style={{ aspectRatio: '9 / 16' }} />
              : o.videos?.find(v => v) ? <video className="st-content-result sm" src={assetUrl(o.videos.find(v => v)!.assetId)} controls playsInline preload="metadata" /> : null}
            <Link to={`/studio/posts/${i.id}`} className="st-tile-label">{postName(i)}</Link>
            <span className="st-hint">{[KIND_LABEL[i.kind], i.accountTag].filter(Boolean).join(' · ')}</span>
            <div className="st-row" style={{ gap: 6 }}>
              {o.videoAssetId && <a className="st-btn sm secondary" href={downloadUrl(o.videoAssetId, `${name}.mp4`)}><Download size={13} />MP4</a>}
              {o.zipAssetId && <a className="st-btn sm secondary" href={downloadUrl(o.zipAssetId, `${name}.zip`)}><Download size={13} />Zip</a>}
            </div>
          </div>
        )
      })}
    </div>
  )
}

// SPEC 5.2 rule 21: the last picked scenes of a character, as a history.
// Repeats are fine; every still comes out different.
function ComboLog({ characterId }: { characterId: string }) {
  const q = useScenes(characterId)
  const data: ScenesData | undefined = q.data
  if (!data?.combos.length) return null
  return (
    <section className="st-card">
      <div className="st-card-head"><History size={16} /><div className="grow"><div className="st-h3">Combo log</div><div className="st-hint">The last {data.combos.length} picked scenes, as a history. Repeats are fine.</div></div></div>
      <div className="st-card-body st-col" style={{ gap: 6 }}>
        {[...data.combos].reverse().map((c, i) => (
          <div key={i} className="st-combo"><span className="st-mono st-muted">{c.date}</span><b>{c.moment}</b><span>{c.camera}</span><span className="st-muted">{c.light}</span><span className="st-muted">{c.location}</span></div>
        ))}
      </div>
    </section>
  )
}

// ── B-roll ────────────────────────────────────────────────────────────

function BrollTab({ data }: { data: ContentData }) {
  const toast = useToast()
  const qc = useQueryClient()
  const [product, setProduct] = useState('')
  const [filter, setFilter] = useState<string | null>(null)
  const [busy, setBusy] = useState<string | null>(null)
  const [added, setAdded] = useState<string[]>([])
  const input = useRef<HTMLInputElement | null>(null)
  const worker = useWorkerGate()
  async function upload(files: File[]) {
    const videos = files.filter(f => f.type.startsWith('video/') || /\.(mp4|mov|webm|m4v)$/i.test(f.name))
    if (!videos.length) { toast({ tone: 'bad', text: 'Pick video files (MP4, MOV or WebM).' }); return }
    for (const [i, f] of videos.entries()) {
      setBusy(`Uploading ${f.name} (${i + 1} of ${videos.length})...`)
      try { const b = await api.addBroll(f, product); setAdded(a => [...a, b.id]) } catch (e) { toast({ tone: 'bad', text: `${f.name}: ${errorMessage(e)}` }) }
    }
    setBusy(null)
    await qc.invalidateQueries({ queryKey: keys.content })
  }
  const shown = data.broll.filter(b => !filter || b.product === filter)
  return (
    <div className="st-col" style={{ gap: 18 }}>
      <section className="st-card"><div className="st-card-body st-col" style={{ gap: 12 }}>
        <div className="st-h3">Add B-roll</div>
        <span className="st-hint">Screen recordings and phone video of your laptop, up to {data.options.maxUploadMb} MB each. They are kept as a lean copy without sound. Landscape clips are fitted over a blurred copy in 9:16, so nothing on screen is cut off.</span>
        <div className="st-row" style={{ gap: 10, flexWrap: 'wrap' }}>
          <input className="st-input" style={{ maxWidth: 260 }} list="broll-products" value={product} onChange={e => setProduct(e.target.value)} placeholder="Product, e.g. Notion" aria-label="Product" />
          <datalist id="broll-products">{data.products.map(p => <option key={p} value={p} />)}</datalist>
          <input ref={input} type="file" accept="video/*" multiple hidden onChange={e => { const f = Array.from(e.target.files ?? []); e.target.value = ''; void upload(f) }} />
          <button className="st-btn primary" disabled={!!busy || !worker.ready} onClick={() => input.current?.click()}>{busy ? <Loader2 size={15} className="st-spin" /> : <Upload size={15} />}Upload videos</button>
          {busy && <span className="st-hint">{busy}</span>}
          {!worker.ready && <span className="st-hint st-warntext" role="status">{worker.reason} Uploads are prepared by the worker.</span>}
        </div>
        <RunStatus match={j => added.some(id => j.purpose === `broll_ingest:${id}`)} />
      </div></section>
      {data.products.length > 0 && (
        <div className="st-row" style={{ gap: 6, flexWrap: 'wrap' }}>
          <button className={`st-chip ${filter === null ? 'on' : ''}`} onClick={() => setFilter(null)}>All products</button>
          {data.products.map(p => <button key={p} className={`st-chip ${filter === p ? 'on' : ''}`} onClick={() => setFilter(p)}>{p}</button>)}
        </div>
      )}
      {!shown.length ? <Callout tone="info">No B-roll yet. Upload a screen recording to start the library.</Callout> : (
        <div className="st-content-videos">{shown.map(b => <BrollCard key={b.id} b={b} products={data.products} />)}</div>
      )}
    </div>
  )
}

function BrollCard({ b, products }: { b: BrollClip; products: string[] }) {
  const toast = useToast()
  const qc = useQueryClient()
  const [title, setTitle] = useState(b.title)
  const [product, setProduct] = useState(b.product)
  const listId = useMemo(() => `p-${b.id}`, [b.id])
  async function save(patch: { title?: string; product?: string }) {
    try { await api.updateBroll(b.id, patch); await qc.invalidateQueries({ queryKey: keys.content }) } catch (e) { toast({ tone: 'bad', text: errorMessage(e) }) }
  }
  async function archive() {
    try { await api.archiveBroll(b.id); await qc.invalidateQueries({ queryKey: keys.content }) } catch (e) { toast({ tone: 'bad', text: errorMessage(e) }) }
  }
  return (
    <div className="st-card st-col" style={{ gap: 8, padding: 10 }}>
      {b.status === 'ready' && b.assetId ? <video className="st-content-result sm" src={assetUrl(b.assetId)} controls muted playsInline preload="metadata" />
        : b.status === 'processing' ? <div className="st-content-processing"><Loader2 size={18} className="st-spin" />Preparing...</div>
        : <div className="st-content-processing bad">{b.error ?? 'This upload failed.'}</div>}
      <input className="st-input" value={title} onChange={e => setTitle(e.target.value)} onBlur={() => title !== b.title && save({ title })} aria-label="Title" />
      <input className="st-input" list={listId} value={product} onChange={e => setProduct(e.target.value)} onBlur={() => product !== b.product && save({ product })} placeholder="Product" aria-label="Product" />
      <datalist id={listId}>{products.map(p => <option key={p} value={p} />)}</datalist>
      <div className="st-row"><span className="st-hint">{b.durationSec != null ? `${b.durationSec} s` : ''}</span><span className="st-spacer" /><button className="st-btn ghost sm" onClick={archive}><Archive size={13} />Archive</button></div>
    </div>
  )
}
