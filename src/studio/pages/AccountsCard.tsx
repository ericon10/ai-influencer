import { useEffect, useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { ChevronDown, ChevronRight, Plus, Trophy } from 'lucide-react'
import { api } from '../api'
import { useContent, useSocialAccounts } from '../hooks'
import { errorMessage, useToast } from '../ui'
import type { CharacterSummary, SocialAccount } from '../types'
import { HowTo } from '../guide/Guide'
import { STRUCTURES, codeLabel } from '../../../server/core/playbook'

// Posts home > Accounts (UX-PLAN.md section 14): one row per account tag
// with its product (section 29: the product of every new post on it; none
// until the owner picks one), its tracked link or promo code and its
// signups, ranked by signups (then signups per exported post), never by
// views. Collapsed by default.

const KEY = 'st-accounts-open'

export function AccountsCard({ characters }: { characters: CharacterSummary[] }) {
  const q = useSocialAccounts()
  const qc = useQueryClient()
  const toast = useToast()
  const [open, setOpen] = useState(() => { try { return localStorage.getItem(KEY) === '1' } catch { return false } })
  useEffect(() => { try { localStorage.setItem(KEY, open ? '1' : '0') } catch { /* private window */ } }, [open])
  const [adding, setAdding] = useState('')
  const rows = q.data?.accounts ?? []
  const top = rows[0]
  async function add() {
    try { await api.saveSocialAccount(adding, {}); setAdding(''); await qc.invalidateQueries({ queryKey: ['social-accounts'] }) } catch (e) { toast({ tone: 'bad', text: errorMessage(e) }) }
  }
  return (
    <section className="st-card st-accounts" data-field="accounts" style={{ marginBottom: 18 }}>
      <div className="st-card-head st-row" style={{ gap: 10 }}>
      <button type="button" className="st-row grow" style={{ flex: 1, background: 'none', border: 0, cursor: 'pointer', textAlign: 'left', gap: 10, color: 'inherit', font: 'inherit', padding: 0 }} onClick={() => setOpen(!open)} aria-expanded={open}>
        {open ? <ChevronDown size={16} /> : <ChevronRight size={16} />}
        <Trophy size={16} />
        <div className="grow">
          <div className="st-h3">Accounts</div>
          <div className="st-hint">{rows.length ? `${rows.length} account${rows.length === 1 ? '' : 's'} · ${q.data?.totalSignups ?? 0} signups${top && top.signups > 0 ? ` · top: ${top.tag}` : ''}. Ranked by signups, not views.` : 'Each account\'s tracked link or promo code, and a scoreboard by signups.'}</div>
        </div>
      </button>
      <HowTo id="hooks" label="How the scoreboard works" />
      </div>
      {open && (
        <div className="st-card-body st-col" style={{ gap: 10 }}>
          {rows.length > 0 && (
            <div className="st-tablewrap">
              <table className="st-table">
                <thead><tr><th>#</th><th>Account</th><th>Character</th><th title="The product of every new post on this account (none until you pick one)">Product</th><th title="The playbook's structures for this account: the primary (about 35% of posts) and the backup (about 20%)">Primary and backup</th><th>Tracked link</th><th>Promo code</th><th>Posts</th><th>Signups</th><th>Per post</th></tr></thead>
                <tbody>{rows.map(r => <AccountRow key={r.tag} r={r} characters={characters} />)}</tbody>
              </table>
            </div>
          )}
          <div className="st-row" style={{ gap: 8 }}>
            <input className="st-input" style={{ maxWidth: 260 }} value={adding} onChange={e => setAdding(e.target.value)} placeholder="Add an account, e.g. callie.tiktok" onKeyDown={e => { if (e.key === 'Enter' && adding.trim()) void add() }} />
            <button className="st-btn sm" disabled={!adding.trim()} onClick={() => void add()} title={!adding.trim() ? 'Name the account first' : undefined}><Plus size={14} />Add account</button>
            <span className="st-hint">Accounts also appear here when a post is tagged with one. Type signups from your link tracker; views never rank.</span>
          </div>
        </div>
      )}
    </section>
  )
}

function AccountRow({ r, characters }: { r: SocialAccount; characters: CharacterSummary[] }) {
  const qc = useQueryClient()
  const toast = useToast()
  const products = useContent().data?.products ?? []
  const [link, setLink] = useState(r.link)
  const [code, setCode] = useState(r.code)
  const [signups, setSignups] = useState(String(r.signups))
  const [saving, setSaving] = useState(false)
  // Each field follows the server on its own, so saving one never wipes
  // another that is still being typed.
  useEffect(() => setLink(r.link), [r.link])
  useEffect(() => setCode(r.code), [r.code])
  useEffect(() => setSignups(String(r.signups)), [r.signups])
  async function save(patch: Parameters<typeof api.saveSocialAccount>[1]) {
    setSaving(true)
    try { await api.saveSocialAccount(r.tag, patch); await qc.invalidateQueries({ queryKey: ['social-accounts'] }) } catch (e) { toast({ tone: 'bad', text: errorMessage(e) }) } finally { setSaving(false) }
  }
  return (
    <tr aria-busy={saving}>
      <td>{r.rank}</td>
      <td><b>{r.tag}</b></td>
      <td>
        <select className="st-input sm" value={r.characterId ?? ''} onChange={e => void save({ characterId: e.target.value || null })} aria-label={`Character for ${r.tag}`}>
          <option value="">None</option>
          {characters.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
        </select>
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
        <span className="st-hint" style={{ fontSize: 11 }}>{r.lastCode ? `Last post: ${codeLabel(r.lastCode)}` : r.structuresSet ? 'Set here' : r.primary ? 'From the playbook' : 'Not set'}</span>
      </td>
      <td><input className="st-input sm" value={link} placeholder="https://..." onChange={e => setLink(e.target.value)} onBlur={() => link !== r.link && void save({ link })} aria-label={`Tracked link for ${r.tag}`} /></td>
      <td><input className="st-input sm st-mono" style={{ width: 110 }} value={code} placeholder="e.g. CALLIE10" onChange={e => setCode(e.target.value)} onBlur={() => code !== r.code && void save({ code })} aria-label={`Promo code for ${r.tag}`} /></td>
      <td title={`${r.exported} exported`}>{r.posts}</td>
      <td><input className="st-input sm" style={{ width: 80 }} inputMode="numeric" value={signups} onChange={e => setSignups(e.target.value.replace(/\D/g, ''))} onBlur={() => Number(signups) !== r.signups && void save({ signups: Number(signups) || 0 })} aria-label={`Signups for ${r.tag}`} /></td>
      <td>{r.perPost ?? 'n/a'}</td>
    </tr>
  )
}

// A structure or lens code (S1 to S12, L13 to L25).
function CodePick({ value, label, onChange }: { value: string | null; label: string; onChange: (v: string | null) => void }) {
  return (
    <select className="st-input sm" style={{ width: 190 }} value={value ?? ''} onChange={e => onChange(e.target.value || null)} aria-label={label} title={value ? codeLabel(value) : 'Not set'}>
      <option value="">None</option>
      {STRUCTURES.map(c => <option key={c.code} value={c.code}>{codeLabel(c.code)}</option>)}
    </select>
  )
}
