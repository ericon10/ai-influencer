import { useEffect, useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { Pencil, Plus } from 'lucide-react'
import { api } from '../api'
import { useCharacters, useContent, useSocialAccounts } from '../hooks'
import { errorMessage, useToast } from '../ui'
import { HowTo } from '../guide/Guide'
import type { CharacterSummary, SocialAccount } from '../types'
import { STRUCTURES, codeLabel } from '../../../server/core/playbook'

// Accounts (owner, 2026-10-22; UX-PLAN.md section 37, item 3): one row per
// account with its Device ID, character (person or faceless), platform,
// slots per day and life/job blend (defaults by character, editable), and
// what the Accounts card had: product, structures, tracked link, promo
// code, signups. Placeholders are fine; renaming one updates every post.

const PLATFORMS = ['tiktok', 'instagram', 'youtube']

export default function Accounts() {
  const q = useSocialAccounts()
  const characters = useCharacters().data?.characters ?? []
  const qc = useQueryClient()
  const toast = useToast()
  const [adding, setAdding] = useState('')
  const rows = q.data?.accounts ?? []
  async function add() {
    try { await api.saveSocialAccount(adding.trim(), {}); setAdding(''); await qc.invalidateQueries({ queryKey: ['social-accounts'] }) } catch (e) { toast({ tone: 'bad', text: errorMessage(e) }) }
  }
  return (
    <div className="st-page wide" data-field="accounts-page">
      <div className="st-pagehead" style={{ marginBottom: 14 }}>
        <div className="grow">
          <div className="st-kicker">Where posts go</div>
          <div className="st-titlerow"><h1 className="st-h1">Accounts</h1><HowTo id="accounts" /></div>
          <p className="st-sub" style={{ margin: 0 }}>Each account's phone, character, platform, slots a day and life/job blend. Weeks and Send to Drive read them; every value is a default you can change. {q.data ? `${rows.length} accounts · ${q.data.totalSignups} signups, ranked by signups, never views.` : ''}</p>
        </div>
      </div>
      <section className="st-card">
        <div className="st-card-body st-col" style={{ gap: 10 }}>
          <div className="st-tablewrap">
            <table className="st-table st-accounts-table" data-field="accounts">
              <thead><tr><th>Account</th><th>Device ID</th><th>Character</th><th>Platform</th><th title="Slots a day: how many posts a day Weeks lays out">Slots a day</th><th title="The life % of the week; the rest are job posts">Life / job</th><th title="The product of every new post on this account">Product</th><th title="The playbook's structures: the primary (about 35% of posts) and the backup (about 20%)">Primary and backup</th><th>Tracked link</th><th>Promo code</th><th>Posts</th><th>Signups</th></tr></thead>
              <tbody>{rows.map(r => <AccountRow key={r.tag} r={r} characters={characters} />)}</tbody>
            </table>
          </div>
          <div className="st-row" style={{ gap: 8, flexWrap: 'wrap' }}>
            <input className="st-input" style={{ maxWidth: 260 }} value={adding} onChange={e => setAdding(e.target.value)} placeholder="Add an account, e.g. callie_ig_01" onKeyDown={e => { if (e.key === 'Enter' && adding.trim()) void add() }} aria-label="New account" />
            <button className="st-btn sm" disabled={!adding.trim()} onClick={() => void add()} title={!adding.trim() ? 'Name the account first' : undefined}><Plus size={14} />Add account</button>
            <span className="st-hint">A plan CSV that names a new account adds it here too, with the character its name starts with. Placeholders are fine (DEVICE-01, callie_ig_01): rename one later and every post follows.</span>
          </div>
        </div>
      </section>
    </div>
  )
}

function AccountRow({ r, characters }: { r: SocialAccount; characters: CharacterSummary[] }) {
  const qc = useQueryClient()
  const toast = useToast()
  const products = useContent().data?.products ?? []
  const [f, setF] = useState({ link: r.link, code: r.code, signups: String(r.signups), deviceId: r.deviceId, slots: String(r.slotsPerDay), life: String(r.lifeShare) })
  const [renaming, setRenaming] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  // Each field follows the server on its own, so saving one never wipes
  // another that is still being typed.
  useEffect(() => setF(x => ({ ...x, link: r.link })), [r.link])
  useEffect(() => setF(x => ({ ...x, code: r.code })), [r.code])
  useEffect(() => setF(x => ({ ...x, signups: String(r.signups) })), [r.signups])
  useEffect(() => setF(x => ({ ...x, deviceId: r.deviceId })), [r.deviceId])
  useEffect(() => setF(x => ({ ...x, slots: String(r.slotsPerDay) })), [r.slotsPerDay])
  useEffect(() => setF(x => ({ ...x, life: String(r.lifeShare) })), [r.lifeShare])
  async function save(patch: Parameters<typeof api.saveSocialAccount>[1]) {
    setSaving(true)
    try { await api.saveSocialAccount(r.tag, patch); await qc.invalidateQueries({ queryKey: ['social-accounts'] }) } catch (e) { toast({ tone: 'bad', text: errorMessage(e) }) } finally { setSaving(false) }
  }
  async function rename() {
    const to = (renaming ?? '').trim()
    setRenaming(null)
    if (!to || to === r.tag) return
    try { await api.renameSocialAccount(r.tag, to); await qc.invalidateQueries({ queryKey: ['social-accounts'] }); await qc.invalidateQueries({ queryKey: ['week'] }); toast({ tone: 'ok', text: `${r.tag} is now ${to}: every post, line and Drive row follows.` }) } catch (e) { toast({ tone: 'bad', text: errorMessage(e) }) }
  }
  const life = Number(f.life)
  return (
    <tr aria-busy={saving} data-field={`account-${r.tag}`}>
      <td style={{ whiteSpace: 'nowrap' }}>
        {renaming !== null
          ? <input className="st-input sm" autoFocus value={renaming} onChange={e => setRenaming(e.target.value)} onBlur={() => void rename()} onKeyDown={e => { if (e.key === 'Enter') void rename(); if (e.key === 'Escape') setRenaming(null) }} aria-label={`New name for ${r.tag}`} />
          : <><b>{r.tag}</b> <button type="button" className="st-btn xs ghost" onClick={() => setRenaming(r.tag)} aria-label={`Rename ${r.tag}`} title="Rename: every post, bank line and Drive row follows"><Pencil size={11} /></button></>}
      </td>
      <td><input className="st-input sm st-mono" style={{ width: 110 }} value={f.deviceId} placeholder="DEVICE-01" onChange={e => setF({ ...f, deviceId: e.target.value })} onBlur={() => f.deviceId !== r.deviceId && void save({ deviceId: f.deviceId })} aria-label={`Device ID for ${r.tag}`} /></td>
      <td>
        <select className="st-input sm" value={r.characterId ?? ''} onChange={e => void save({ characterId: e.target.value || null })} aria-label={`Character for ${r.tag}`}>
          <option value="">None</option>
          {characters.map(c => <option key={c.id} value={c.id}>{c.name}{c.kind === 'faceless' ? ' (faceless)' : ''}</option>)}
        </select>
        {r.kind && <div className="st-hint" style={{ fontSize: 11 }}>{r.kind === 'faceless' ? 'Faceless' : 'Person'}</div>}
      </td>
      <td>
        <select className="st-input sm" value={r.platform} onChange={e => void save({ platform: e.target.value })} aria-label={`Platform for ${r.tag}`}>
          {PLATFORMS.map(p => <option key={p} value={p}>{p === 'tiktok' ? 'TikTok' : p === 'instagram' ? 'Instagram' : 'YouTube'}</option>)}
        </select>
      </td>
      <td><input className="st-input sm" style={{ width: 56 }} inputMode="numeric" value={f.slots} onChange={e => setF({ ...f, slots: e.target.value.replace(/\D/g, '') })} onBlur={() => Number(f.slots) !== r.slotsPerDay && void save({ slotsPerDay: f.slots ? Number(f.slots) : null })} aria-label={`Slots a day for ${r.tag}`} /></td>
      <td style={{ whiteSpace: 'nowrap' }}>
        <input className="st-input sm" style={{ width: 52 }} inputMode="numeric" value={f.life} onChange={e => setF({ ...f, life: e.target.value.replace(/\D/g, '').slice(0, 3) })} onBlur={() => Number(f.life) !== r.lifeShare && void save({ lifeShare: f.life === '' ? null : Math.min(100, Number(f.life)) })} aria-label={`Life share for ${r.tag}`} />
        <span className="st-hint"> {Number.isFinite(life) ? `${Math.min(100, life)}/${100 - Math.min(100, life)}` : ''}</span>
        <div className="st-hint" style={{ fontSize: 11 }}>{r.lifeShareSet ? <button type="button" className="st-btn xs ghost" style={{ padding: 0, height: 'auto' }} onClick={() => void save({ lifeShare: null })}>Back to the default</button> : 'Default'}</div>
      </td>
      <td data-field={`account-product-${r.tag}`}>
        <select className="st-input sm" value={r.productId ?? ''} onChange={e => void save({ productId: e.target.value || null })} aria-label={`Product for ${r.tag}`}>
          <option value="">None</option>
          {products.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
        </select>
      </td>
      <td data-field={`account-structures-${r.tag}`}>
        <div className="st-col" style={{ gap: 4 }}>
          <CodePick value={r.primary ?? null} label={`Primary structure for ${r.tag}`} onChange={v => void save({ primaryCode: v, backupCode: r.backup ?? null })} />
          <CodePick value={r.backup ?? null} label={`Backup structure for ${r.tag}`} onChange={v => void save({ backupCode: v, primaryCode: r.primary ?? null })} />
        </div>
      </td>
      <td><input className="st-input sm" value={f.link} placeholder="https://..." onChange={e => setF({ ...f, link: e.target.value })} onBlur={() => f.link !== r.link && void save({ link: f.link })} aria-label={`Tracked link for ${r.tag}`} /></td>
      <td><input className="st-input sm st-mono" style={{ width: 100 }} value={f.code} placeholder="e.g. CALLIE10" onChange={e => setF({ ...f, code: e.target.value })} onBlur={() => f.code !== r.code && void save({ code: f.code })} aria-label={`Promo code for ${r.tag}`} /></td>
      <td title={`${r.exported} exported`}>{r.posts}</td>
      <td><input className="st-input sm" style={{ width: 70 }} inputMode="numeric" value={f.signups} onChange={e => setF({ ...f, signups: e.target.value.replace(/\D/g, '') })} onBlur={() => Number(f.signups) !== r.signups && void save({ signups: Number(f.signups) || 0 })} aria-label={`Signups for ${r.tag}`} /></td>
    </tr>
  )
}

function CodePick({ value, label, onChange }: { value: string | null; label: string; onChange: (v: string | null) => void }) {
  return (
    <select className="st-input sm" style={{ width: 170 }} value={value ?? ''} onChange={e => onChange(e.target.value || null)} aria-label={label} title={value ? codeLabel(value) : 'Not set'}>
      <option value="">None</option>
      {STRUCTURES.map(c => <option key={c.code} value={c.code}>{codeLabel(c.code)}</option>)}
    </select>
  )
}
