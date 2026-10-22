import { useEffect, useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { AlertTriangle, CalendarRange, CheckCircle2, Library, Sheet, Upload, X } from 'lucide-react'
import { api } from '../../api'
import { PriceButton } from '../../PriceButton'
import { useCharacters, useProducts } from '../../hooks'
import { AsyncButton, Callout, Drawer, errorMessage, useToast } from '../../ui'
import { HowTo } from '../../guide/Guide'
import type { BankImport, BankLineView, BankView } from '../../types'

// The line bank (owner, 2026-10-22; UX-PLAN.md section 36, item 29): real
// comments from an Apify scrape, a free first pass, then one priced run that
// tags, writes and reviews; only lines that pass the reviewer show. A drawer
// in the post workspace (Pick from the bank) and on the Launch plan card
// (Write the week), never a page of its own.

export interface BankPost { id: string; kind: string; characterId: string | null; accountTag: string }

const short = (n: number) => (n >= 1_000_000 ? `${Math.round(n / 100_000) / 10}M` : n >= 1000 ? `${Math.round(n / 100) / 10}k` : String(n))
const where = (kind: string) => (kind === 'slideshow' ? 'slide 1 (the hook)' : kind === 'meme' ? 'the caption' : 'the next caption')

export function LineBankButton({ post, label = 'Pick from the bank', className = 'st-btn sm' }: { post?: BankPost; label?: string; className?: string }) {
  const [open, setOpen] = useState(false)
  return (
    <>
      <button type="button" className={className} onClick={() => setOpen(true)} data-field="line-bank-open"><Library size={13} />{label}</button>
      <LineBankDrawer open={open} onClose={() => setOpen(false)} post={post} />
    </>
  )
}

export function LineBankDrawer({ open, onClose, post }: { open: boolean; onClose: () => void; post?: BankPost }) {
  return (
    <Drawer open={open} onClose={onClose} wide title={<span className="st-titlerow">Line bank<HowTo id="line-bank" label="How the line bank works" /></span>}>
      {open && <LineBank post={post} onPlaced={onClose} />}
    </Drawer>
  )
}

function LineBank({ post, onPlaced }: { post?: BankPost; onPlaced: () => void }) {
  const qc = useQueryClient()
  const toast = useToast()
  const characters = useCharacters()
  const [characterId, setCharacterId] = useState<string>(post?.characterId ?? '')
  const [emotion, setEmotion] = useState(''), [topic, setTopic] = useState(''), [pain, setPain] = useState('')
  const q = { characterId: characterId || undefined, emotion: emotion || undefined, topic: topic || undefined, pain: pain || undefined, accountTag: post ? post.accountTag : undefined }
  const view = useQuery({
    queryKey: ['line-bank', q], queryFn: () => api.lineBank(q),
    refetchInterval: x => (x.state.data?.counts.running ? 4000 : false),
  })
  const v: BankView | undefined = view.data
  const refresh = () => { void qc.invalidateQueries({ queryKey: ['line-bank'] }); void qc.invalidateQueries({ queryKey: ['estimate'] }) }
  const [using, setUsing] = useState<string | null>(null)
  const empty = v && v.counts.comments === 0
  return (
    <div className="st-col" style={{ gap: 14 }} data-field="line-bank">
      <span className="st-hint">Real comments from people in the job search, each turned into an on-screen line that starts at 70. A separate reviewer scores every line; anything under {v?.options.passScore ?? 8} never shows.</span>
      <ImportBox open={!!empty} last={v?.imports[0] ?? null} onDone={refresh} />
      {v && v.counts.comments > 0 && (
        <div className="st-col" style={{ gap: 8 }} data-field="line-bank-counts">
          <span className="st-hint">
            {v.counts.comments.toLocaleString()} comments in the bank: <b>{v.counts.passed.toLocaleString()} lines passed</b>
            {v.counts.rejected ? ` · ${v.counts.rejected.toLocaleString()} rejected by the reviewer (never shown)` : ''}
            {v.counts.skipped ? ` · ${v.counts.skipped.toLocaleString()} the writer passed on` : ''}
            {v.counts.fights ? ` · ${v.counts.fights} could start a fight (flagged, never used automatically)` : ''}
            {v.counts.used ? ` · ${v.counts.used} used` : ''}
          </span>
          {v.counts.running > 0 && <span className="st-hint">{v.counts.running.toLocaleString()} comments are being tagged, written and reviewed now.</span>}
          {v.counts.waiting > 0 && <RunBox waiting={v.counts.waiting} onStarted={refresh} />}
        </div>
      )}
      {v && v.counts.passed > 0 && (
        <div className="st-row" style={{ gap: 8, flexWrap: 'wrap', alignItems: 'center' }} data-field="line-bank-filters">
          <select className="st-input sm" style={{ width: 'auto', maxWidth: '100%' }} aria-label="Character" value={characterId} onChange={e => setCharacterId(e.target.value)}>
            <option value="">Every character</option>
            {(characters.data?.characters ?? []).map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
          {v.voice && (
            <div className="st-seg sm" role="radiogroup" aria-label={`How ${v.voice.name} tells lines`} data-field="line-bank-stance">
              {(['first', 'secondhand'] as const).map(s => (
                <button key={s} type="button" role="radio" aria-checked={v.voice!.stance === s} className={v.voice!.stance === s ? 'on' : ''}
                  onClick={async () => { try { await api.lineBankStance(v.voice!.characterId, s); refresh() } catch (e) { toast({ tone: 'bad', text: errorMessage(e) }) } }}>
                  {s === 'first' ? 'First person (out of work)' : 'Secondhand'}
                </button>
              ))}
            </div>
          )}
          <select className="st-input sm" style={{ width: 'auto', maxWidth: '100%' }} aria-label="Emotion" value={emotion} onChange={e => setEmotion(e.target.value)}>
            <option value="">Any emotion</option>
            {v.options.emotions.map(x => <option key={x} value={x}>{x}</option>)}
          </select>
          <select className="st-input sm" style={{ width: 'auto', maxWidth: '100%' }} aria-label="Topic" value={topic} onChange={e => setTopic(e.target.value)}>
            <option value="">Any topic</option>
            {v.options.topics.map(x => <option key={x} value={x}>{x}</option>)}
          </select>
          {v.options.pains.length > 0 && (
            <select className="st-input sm" style={{ width: 'auto', maxWidth: '100%' }} aria-label="Pain point" value={pain} onChange={e => setPain(e.target.value)}>
              <option value="">Any pain point</option>
              {v.options.pains.map(x => <option key={x} value={x}>{x}</option>)}
            </select>
          )}
        </div>
      )}
      {v?.voice && <span className="st-hint">{v.voice.picked ? '' : `From ${v.voice.name}'s voice card: `}{v.voice.name} tells lines {v.voice.stance === 'first' ? 'in the first person, out of work' : 'secondhand, about a friend'}; only lines that fit show{post ? ', and none used on another account' : ''}.</span>}
      {v && v.counts.passed > 0 && (
        <div className="st-col" style={{ gap: 8 }} data-field="line-bank-lines">
          <span className="st-hint">{v.total.toLocaleString()} line{v.total === 1 ? '' : 's'}, most liked source first{v.total > v.lines.length ? ` (the first ${v.lines.length})` : ''}.</span>
          {v.lines.map(l => <LineCard key={l.id} l={l} post={post} using={using === l.id} onUse={() => setUsing(using === l.id ? null : l.id)} onCall={refresh} onPlaced={() => { refresh(); void qc.invalidateQueries({ queryKey: ['content'] }); onPlaced() }} />)}
          {!v.lines.length && <Callout tone="info">No line fits these filters{v.voice ? ` and ${v.voice.name}` : ''} yet.</Callout>}
        </div>
      )}
      {v && v.skippedHere.length > 0 && (
        <details className="st-hint">
          <summary>{v.skippedHere.length} line{v.skippedHere.length === 1 ? '' : 's'} did not fit {v.voice?.name}'s facts</summary>
          <ul>{v.skippedHere.map(s => <li key={s.id}>{s.line}: {s.why}</li>)}</ul>
        </details>
      )}
      {view.error && <Callout tone="bad">{errorMessage(view.error)}</Callout>}
    </div>
  )
}

function LineCard({ l, post, using, onUse, onCall, onPlaced }: { l: BankLineView; post?: BankPost; using: boolean; onUse: () => void; onCall: () => void; onPlaced: () => void }) {
  const toast = useToast()
  const call = async (c: 'kept' | 'rejected' | null) => { try { await api.lineBankCall(l.id, c); onCall() } catch (e) { toast({ tone: 'bad', text: errorMessage(e) }) } }
  const usedHere = !!post && l.usedPostId === post.id
  return (
    <div className={`st-bankline ${l.call ?? ''}`} data-field="bank-line" data-id={l.id} data-call={l.call ?? ''}>
      <div className="st-bankline-text">{l.line}</div>
      <blockquote className="st-bankline-source">
        <span className="st-hint">From a comment with {short(l.likes)} likes{l.videoAccount ? ` on @${l.videoAccount}` : ''}:</span> {l.comment}
      </blockquote>
      <div className="st-row" style={{ gap: 6, flexWrap: 'wrap', alignItems: 'center' }}>
        {l.tags && <>
          <span className="st-badge plain">{l.tags.emotion}</span>
          <span className="st-badge plain">{l.tags.topic}</span>
          {l.tags.pain !== 'none' && <span className="st-badge plain">{l.tags.pain}</span>}
          <span className="st-badge plain">{l.tags.format}</span>
        </>}
        {l.review && <span className="st-hint" data-field="bank-line-scores">gut {l.review.gut} · specific {l.review.specific} · real {l.review.real}</span>}
        {l.tags?.fight && <span className="st-badge bad" title={l.tags.fightReason}><AlertTriangle size={11} />Could start a fight{l.tags.fightReason ? `: ${l.tags.fightReason}` : ''}</span>}
        {l.usedAccountTag != null && <span className="st-badge ok">Used on @{l.usedAccountTag}</span>}
      </div>
      <div className="st-row" style={{ gap: 6, flexWrap: 'wrap', alignItems: 'center' }}>
        <button type="button" className={`st-btn xs ${l.call === 'kept' ? '' : 'ghost'}`} aria-pressed={l.call === 'kept'} onClick={() => void call(l.call === 'kept' ? null : 'kept')}><CheckCircle2 size={12} />Keep</button>
        <button type="button" className={`st-btn xs ${l.call === 'rejected' ? '' : 'ghost'}`} aria-pressed={l.call === 'rejected'} onClick={() => void call(l.call === 'rejected' ? null : 'rejected')}><X size={12} />Reject</button>
        {post && !usedHere && <button type="button" className="st-btn xs" onClick={onUse} aria-expanded={using}>Use this line</button>}
        {usedHere && <span className="st-hint">On this post: {l.usedText}</span>}
      </div>
      {post && using && (
        <div className="st-col" style={{ gap: 6 }}>
          <span className="st-hint">Put in the character's voice (checked against their facts) and placed on {where(post.kind)}.</span>
          <PriceButton label="Use this line" size="sm" action={{ type: 'bank_use', lineId: l.id, contentId: post.id }} onDone={onPlaced} watch={j => j.purpose === `bank_voice:${post.id}`} />
        </div>
      )}
    </div>
  )
}

function RunBox({ waiting, onStarted }: { waiting: number; onStarted: () => void }) {
  const choices = [...new Set([30, 100, 300, waiting].filter(n => n <= waiting))].sort((a, b) => a - b)
  const [limit, setLimit] = useState(waiting)
  const n = Math.min(limit, waiting)
  return (
    <div className="st-col" style={{ gap: 6 }} data-field="line-bank-run">
      <div className="st-row" style={{ gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
        <span className="st-hint">{waiting.toLocaleString()} comments not run yet. Run</span>
        <select className="st-input sm" style={{ width: 'auto' }} aria-label="How many comments to run" value={n} onChange={e => setLimit(Number(e.target.value))}>
          {choices.map(c => <option key={c} value={c}>{c === waiting ? `all ${c.toLocaleString()}` : `the top ${c} by likes`}</option>)}
        </select>
      </div>
      <PriceButton label={`Tag, write and review ${n.toLocaleString()} comment${n === 1 ? '' : 's'}`} size="sm" action={{ type: 'bank_run', limit: n === waiting ? null : n }} onStarted={onStarted} onDone={onStarted} watch={j => /^bank_(tag|write|review):/.test(j.purpose)} />
    </div>
  )
}

function ImportBox({ open, last, onDone }: { open: boolean; last: BankImport | null; onDone: () => void }) {
  const toast = useToast()
  const products = useProducts()
  const [link, setLink] = useState(''), [videosLink, setVideosLink] = useState('')
  const [csv, setCsv] = useState<{ name: string; text: string } | null>(null)
  const [videos, setVideos] = useState<{ name: string; text: string } | null>(null)
  const [productId, setProductId] = useState<string>('')
  const [done, setDone] = useState<BankImport | null>(null)
  const shown = done ?? last
  const product = productId || products.data?.products[0]?.id || ''
  // Open by itself while the bank is empty; then yours to open and close.
  const [shown_, setShown] = useState(open)
  useEffect(() => { if (open) setShown(true) }, [open])
  return (
    <details className="st-card st-col" style={{ padding: 12, gap: 10 }} open={shown_} onToggle={e => setShown((e.currentTarget as HTMLDetailsElement).open)} data-field="line-bank-import">
      <summary className="st-row" style={{ gap: 8, cursor: 'pointer' }}><Upload size={14} /><b>Import comments</b><span className="st-hint">free</span></summary>
      <span className="st-hint">An Apify comment scrape: columns comment, comment_likes, replies, video_account, video_views, video_url. Add the same run's videos (url and text) for each comment's caption. A private Google Sheet cannot be read by link: share it as Anyone with the link, or download the tab as CSV and choose the file.</span>
      <div className="st-row" style={{ gap: 8, flexWrap: 'wrap' }}>
        <input className="st-input sm" style={{ flex: '1 1 240px', minWidth: 0 }} value={link} onChange={e => setLink(e.target.value)} placeholder="The comments tab's Sheet link" aria-label="Comments Sheet link" />
        <FilePick label={csv ? csv.name : 'Or choose its CSV'} aria="The comments as a CSV file" onPick={setCsv} />
      </div>
      <div className="st-row" style={{ gap: 8, flexWrap: 'wrap' }}>
        <input className="st-input sm" style={{ flex: '1 1 240px', minWidth: 0 }} value={videosLink} onChange={e => setVideosLink(e.target.value)} placeholder="The videos tab's Sheet link (optional)" aria-label="Videos Sheet link" />
        <FilePick label={videos ? videos.name : 'Or choose its CSV'} aria="The videos as a CSV file" onPick={setVideos} />
      </div>
      <div className="st-row" style={{ gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
        <span className="st-hint">Pain points from</span>
        <select className="st-input sm" style={{ width: 'auto' }} aria-label="Product" value={product} onChange={e => setProductId(e.target.value)}>
          {(products.data?.products ?? []).map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
          <option value="none">No product</option>
        </select>
        <AsyncButton className="st-btn sm" icon={<Sheet size={13} />} disabled={!link.trim() && !csv} busyLabel="Reading..." onClick={async () => {
          try {
            const r = await api.lineBankImport({
              comments: csv ? { csv: csv.text } : { link: link.trim() },
              videos: videos ? { csv: videos.text } : videosLink.trim() ? { link: videosLink.trim() } : null,
              name: csv?.name ?? '', productId: product === 'none' ? null : product || null,
            })
            setDone(r); setCsv(null); setVideos(null); setLink(''); setVideosLink(''); onDone()
            toast({ tone: 'ok', text: `${r.kept.toLocaleString()} comments kept of ${r.rows.toLocaleString()}.` })
          } catch (e) { toast({ tone: 'bad', text: errorMessage(e) }) }
        }}>Import (free)</AsyncButton>
      </div>
      {shown && <ImportSummary i={shown} />}
    </details>
  )
}

function FilePick({ label, aria, onPick }: { label: string; aria: string; onPick: (f: { name: string; text: string }) => void }) {
  return (
    <label className="st-btn sm ghost" style={{ cursor: 'pointer', maxWidth: '100%', overflow: 'hidden' }}>
      <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{label}</span>
      <input type="file" accept=".csv,text/csv" hidden aria-label={aria} onChange={async e => {
        const f = e.target.files?.[0]
        e.target.value = ''
        if (f) onPick({ name: f.name, text: await f.text() })
      }} />
    </label>
  )
}

const DROPS: Array<[keyof BankImport['dropped'], string]> = [['likes', 'with 0 or 1 likes'], ['topic', 'off the job search'], ['short', 'too short'], ['duplicate', 'duplicates'], ['video', 'about the video itself'], ['language', 'not English']]

function ImportSummary({ i }: { i: BankImport }) {
  return (
    <div className="st-col" style={{ gap: 4 }} data-field="line-bank-import-summary">
      <span className="st-hint"><b>{i.name}</b>{i.productName ? ` (${i.productName})` : ''}: {i.rows.toLocaleString()} comments{i.empty ? ` and ${i.empty} with no words` : ''}; <b>{i.kept.toLocaleString()} kept</b>{i.already ? `, ${i.already} already in the bank` : ''}{i.captions ? `; captions for ${i.joined.toLocaleString()} from ${i.captions} videos` : ''}.</span>
      <span className="st-hint">Dropped for free: {DROPS.filter(([k]) => i.dropped[k]).map(([k, label]) => `${i.dropped[k].toLocaleString()} ${label}`).join(', ') || 'none'}.</span>
    </div>
  )
}

// Write the week (Launch plan card): an account's posts dated in the next
// 7 days with no bank line each get the best unused line that fits.
export function WriteTheWeek({ accountTags }: { accountTags: string[] }) {
  const [tag, setTag] = useState(accountTags[0] ?? '')
  const [open, setOpen] = useState(false)
  const qc = useQueryClient()
  const week = useQuery({ queryKey: ['line-bank-week', tag], queryFn: () => api.lineBankWeek(tag), enabled: !!tag })
  const filled = (week.data?.posts ?? []).filter(p => p.lineId)
  const done = () => { void qc.invalidateQueries({ queryKey: ['line-bank-week'] }); void qc.invalidateQueries({ queryKey: ['plan'] }); void qc.invalidateQueries({ queryKey: ['line-bank'] }) }
  return (
    <div className="st-card st-col" style={{ padding: 12, gap: 8 }} data-field="write-the-week">
      <div className="st-row" style={{ gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
        <CalendarRange size={15} /><b className="grow">Write the week from the line bank</b>
        <HowTo id="line-bank" label="How the line bank works" />
      </div>
      <div className="st-row" style={{ gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
        <select className="st-input sm" style={{ width: 'auto' }} aria-label="Account" value={tag} onChange={e => setTag(e.target.value)}>
          {accountTags.map(t => <option key={t} value={t}>@{t}</option>)}
        </select>
        <button type="button" className="st-btn sm ghost" onClick={() => setOpen(true)}><Library size={13} />Open the line bank</button>
      </div>
      {week.data && (
        week.data.posts.length ? (
          <ul className="st-weeklist">
            {week.data.posts.map(p => <li key={p.postId}><b>{p.label}</b> <span className="st-muted">{p.date}</span>: {p.lineId ? p.line : <span className="st-muted">{p.why}</span>}{p.current && p.lineId ? <span className="st-hint"> (replaces "{p.current}")</span> : null}</li>)}
          </ul>
        ) : <span className="st-hint">No posts on @{tag} dated {week.data.from} to {week.data.to} without a bank line.</span>
      )}
      {filled.length > 0 && <PriceButton label={`Write the week: ${filled.length} post${filled.length === 1 ? '' : 's'}`} size="sm" action={{ type: 'bank_week', accountTag: tag }} onDone={done} watch={j => j.purpose.startsWith(`bank_voice:week-${tag}`)} />}
      {week.error && <Callout tone="bad">{errorMessage(week.error)}</Callout>}
      <LineBankDrawer open={open} onClose={() => setOpen(false)} />
    </div>
  )
}
