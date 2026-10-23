import { useState } from 'react'
import { Link } from 'react-router-dom'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { AlertTriangle, Cpu, Pause, Play, PlugZap, Upload } from 'lucide-react'
import { api, assetUrl } from './api'
import { AsyncButton, Callout, Drawer, PromptViewer, errorMessage, useToast } from './ui'
import { PriceButton } from './PriceButton'
import { HowTo } from './guide/Guide'
import type { CharacterView, ComfyView, LeverView } from './types'

// ComfyUI on a remote workstation (UX-PLAN.md section 41): the Settings
// card (the agent token, status, environment, pause, max jobs, workflows,
// Failed), the engine lever, a character's LoRAs and the bake-off.

const ago = (iso: string | null) => {
  if (!iso) return 'never'
  const s = Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 1000))
  return s < 90 ? `${s} s ago` : s < 5400 ? `${Math.round(s / 60)} min ago` : `${Math.round(s / 3600)} h ago`
}
const mins = (sec: number | null) => (sec == null ? null : sec < 90 ? `${Math.round(sec)} s` : `${Math.round(sec / 60)} min`)
const gb = (mb: number | null) => (mb == null ? '' : `${Math.round(mb / 1024)} GB`)

export function useComfy() {
  return useQuery({ queryKey: ['comfy'], queryFn: () => api.comfy(), refetchInterval: 10_000 })
}

export function ComfyCard() {
  const toast = useToast()
  const qc = useQueryClient()
  const q = useComfy()
  const v = q.data
  const [token, setToken] = useState<string | null>(null)
  const [tunnel, setTunnel] = useState<string | null>(null)
  const save = async (body: Parameters<typeof api.setComfy>[0], ok?: string) => {
    try { qc.setQueryData(['comfy'], await api.setComfy(body)); if (ok) toast({ tone: 'ok', text: ok }) } catch (e) { toast({ tone: 'bad', text: errorMessage(e) }) }
  }
  async function upload(files: FileList | null) {
    if (!files?.length) return
    try {
      const all = await Promise.all(Array.from(files).map(async f => ({ name: f.name, json: JSON.parse(await f.text()) as unknown })))
      const manifest = all.find(f => /manifest/i.test(f.name))?.json ?? all.find(f => (f.json as { inputs?: unknown; ref?: unknown }).ref)?.json
      const graph = all.find(f => f.json !== manifest)?.json
      if (!manifest || !graph) throw new Error('Pick both files: the workflow (Save (API) in ComfyUI) and its manifest (name ending in .manifest.json).')
      const r = await api.uploadComfyWorkflow({ manifest, graph })
      await qc.invalidateQueries({ queryKey: ['comfy'] })
      toast({ tone: 'ok', text: `Workflow ${r.id} v${r.version} added. It shows "not confirmed" until its first run on the machine.` })
    } catch (e) { toast({ tone: 'bad', text: errorMessage(e) }) }
  }
  return (
    <div className="st-card" data-field="settings-comfy">
      <div className="st-card-head">
        <div className="grow"><div className="st-h2 st-row" style={{ gap: 8 }}><Cpu size={18} aria-hidden />ComfyUI<HowTo id="comfy" label="How ComfyUI works" /></div>
          <div className="st-hint">Stills, edits, video and LoRAs on the ComfyUI machine. Its agent calls out to the Studio (it opens no port); every run still waits for your click, priced as $0 API and the minutes it takes. Setup for the machine's owner: docs/COMFY.md.</div></div>
        {v && <span className={`st-badge plain ${v.online ? 'ok' : 'warn'}`} data-field="comfy-online">{v.online ? 'Online' : v.lastSeen ? 'Offline' : 'Not connected'}</span>}
      </div>
      <div className="st-card-body st-col" style={{ gap: 16 }}>
        {!v ? <span className="st-hint">Reading...</span> : (
          <>
            {v.alert && <Callout tone="warn" icon={<AlertTriangle size={16} />}><span data-field="comfy-alert">{v.alert}</span></Callout>}
            <div className="st-col" style={{ gap: 8 }}>
              <span className="st-label" style={{ margin: 0 }}>Agent token</span>
              <span className="st-hint">The machine's agent sends it on every call. Shown once; the Studio keeps only its hash. Making a new one stops the old one.</span>
              {token ? (
                <div className="st-col" style={{ gap: 6 }} data-field="comfy-token">
                  <PromptViewer text={token} wrapped={token} label="Agent token (copy it now)" />
                  <span className="st-hint">Put it on the machine as STUDIO_AGENT_TOKEN (docs/COMFY.md, step 4). Never in a repo or a chat.</span>
                </div>
              ) : <span className="st-hint">{v.token ? `Token ending ${v.token.last4}, made ${ago(v.token.at)}.` : 'No token yet.'}</span>}
              <div className="st-row" style={{ gap: 8 }}>
                <AsyncButton field="comfy-make-token" className="st-btn" onClick={async () => { try { const r = await api.comfyToken(); setToken(r.token); await qc.invalidateQueries({ queryKey: ['comfy'] }) } catch (e) { toast({ tone: 'bad', text: errorMessage(e) }) } }}>{v.token ? 'Make a new token' : 'Make the agent token'}</AsyncButton>
                <AsyncButton field="comfy-test" className="st-btn" icon={<PlugZap size={16} />} disabled={!v.token} onClick={() => save({ testConnection: true }, 'Asked the machine to answer on its next heartbeat (a few seconds).')}>Test connection</AsyncButton>
                {v.test.askedAt && <span className="st-hint" data-field="comfy-test-answer">{v.test.answered ? `Answered ${ago(v.test.answeredAt)}.` : 'Waiting for the machine...'}</span>}
              </div>
            </div>
            <label className="st-field">
              <span className="st-label">Private tunnel address (optional)</span>
              <input className="st-input" placeholder="comfy-box.tailnet.ts.net or a Cloudflare Tunnel name" value={tunnel ?? v.tunnel} onChange={e => setTunnel(e.target.value)} onBlur={() => tunnel !== null && tunnel !== v.tunnel && save({ tunnel }, 'Saved.')} />
              <span className="st-hint">For reaching the machine by hand (Tailscale or Cloudflare Tunnel). The Studio never calls it; the agent calls out.</span>
            </label>
            <div className="st-comfy-status" data-field="comfy-status">
              <div><span className="st-muted">Last heartbeat</span><b>{ago(v.lastSeen)}</b></div>
              <div><span className="st-muted">GPU</span><b>{v.agent?.gpu ?? 'unknown'}</b>{v.agent?.vramTotalMb != null && <span className="st-hint">{gb(v.agent.vramFreeMb)} free of {gb(v.agent.vramTotalMb)}{v.agent.gpuUse != null ? `, ${Math.round(v.agent.gpuUse)}% in use` : ''}</span>}</div>
              <div><span className="st-muted">Queue</span><b>{v.queue.queued} waiting, {v.queue.running} running</b><span className="st-hint">ComfyUI's own queue: {v.agent?.comfyQueue ?? 0}</span></div>
              <div><span className="st-muted">Models found</span><b>{v.agent?.models.length ?? 0}</b>{v.agent?.loadedFamily && <span className="st-hint">Loaded: {v.agent.loadedFamily}</span>}</div>
              <div><span className="st-muted">Failure rate (7 days)</span><b>{v.failureRate == null ? 'no runs yet' : `${Math.round(v.failureRate * 100)}%`}</b></div>
            </div>
            {v.agent?.comfyOk === false && <Callout tone="warn">The agent is running but cannot reach ComfyUI on the machine: {v.agent.comfyError}</Callout>}
            <div className="st-col" style={{ gap: 8 }} data-field="comfy-env">
              <span className="st-label" style={{ margin: 0 }}>Environment</span>
              {v.env.ok
                ? <span className="st-hint">The machine matches the expected environment (hash {v.env.expected.slice(0, 12)}{v.env.custom ? `, accepted ${ago(v.env.acceptedAt)}` : ', the repo\'s lock'}).</span>
                : (
                  <Callout tone="warn">
                    <div className="st-col" style={{ gap: 6 }}>
                      <span>{v.env.actual ? 'The machine is not the expected environment, so it gets no jobs:' : 'The machine has not sent its environment yet.'}</span>
                      {v.env.problems.slice(0, 8).map(p => <span key={p} className="st-hint">{p}</span>)}
                      {v.env.actual && <span className="st-hint">If the machine's owner upgraded on purpose and tested it, use its environment. Otherwise rebuild the pinned image (docs/COMFY.md, step 2).</span>}
                    </div>
                  </Callout>
                )}
              <div className="st-row" style={{ gap: 8 }}>
                {!v.env.ok && v.env.actual && <AsyncButton field="comfy-accept-env" className="st-btn" onClick={() => save({ acceptMachineEnv: true }, 'The machine\'s environment is now the expected one.')}>Use this machine's environment</AsyncButton>}
                {v.env.custom && <AsyncButton className="st-btn ghost" onClick={() => save({ useRepoEnv: true }, 'Back to the repo\'s lock.')}>Use the repo's lock</AsyncButton>}
              </div>
            </div>
            <div className="st-row" style={{ gap: 12, alignItems: 'center', flexWrap: 'wrap' }}>
              <AsyncButton field="comfy-pause" className="st-btn" icon={v.paused ? <Play size={16} /> : <Pause size={16} />} onClick={() => save({ paused: !v.paused }, v.paused ? 'The machine takes Studio jobs again.' : 'Paused: the machine finishes what it is running and takes nothing new.')}>{v.paused ? 'Resume the queue' : 'Pause the queue'}</AsyncButton>
              {v.localPause && <span className="st-hint">Paused on the machine (comfy-agent pause).</span>}
              <label className="st-row" style={{ gap: 8, alignItems: 'center' }}>
                <span className="st-label" style={{ margin: 0 }}>Max jobs at once</span>
                <select className="st-select" style={{ width: 80 }} value={v.maxJobs} onChange={e => void save({ maxJobs: Number(e.target.value) }, 'Saved.')} data-field="comfy-max-jobs">
                  {[1, 2, 3, 4].map(n => <option key={n} value={n}>{n}</option>)}
                </select>
              </label>
              <span className="st-hint">The machine's owner's own work comes first: 1 leaves the rest of the GPU to them.</span>
            </div>
            <div className="st-col" style={{ gap: 8 }} data-field="comfy-workflows">
              <div className="st-row" style={{ alignItems: 'center' }}>
                <span className="st-label grow" style={{ margin: 0 }}>Workflows</span>
                <label className="st-btn sm" style={{ cursor: 'pointer' }}><Upload size={14} />Upload a workflow<input type="file" multiple accept=".json,application/json" hidden onChange={e => void upload(e.target.files)} /></label>
              </div>
              <div className="st-table-wrap">
                <table className="st-table">
                  <thead><tr><th>Workflow</th><th>Steps</th><th>Time</th><th>Runs</th><th /></tr></thead>
                  <tbody>
                    {v.workflows.map(w => (
                      <tr key={w.id} data-field={`comfy-wf-${w.id}`}>
                        <td><b>{w.label}</b> <span className="st-muted">v{w.version}{w.source === 'uploaded' ? ', uploaded' : ''}</span></td>
                        <td>{w.steps.join(', ')}</td>
                        <td>{mins(w.avgSec) ?? `about ${mins(w.estSec)}`}</td>
                        <td>{w.done} done{w.failed ? `, ${w.failed} failed` : ''}</td>
                        <td>{w.licenseCheck && <span className="st-badge plain warn">License check</span>} {!w.confirmed && <span className="st-badge plain">Not confirmed</span>}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <span className="st-hint">A workflow is the API JSON from ComfyUI (Save (API)) plus a manifest that says which node takes the prompt, the refs, the seed and the LoRA. Each is checked on upload; no rebuild.</span>
            </div>
            {v.failedTasks.length > 0 && (
              <div className="st-col" style={{ gap: 8 }} data-field="comfy-failed">
                <span className="st-label" style={{ margin: 0 }}>Failed</span>
                {v.failedTasks.map(f => (
                  <div key={f.id} className="st-row" style={{ gap: 10, alignItems: 'center' }}>
                    <div className="grow st-col" style={{ gap: 2, minWidth: 200 }}>
                      <b>{f.workflowId}{f.attempt > 1 ? `, attempt ${f.attempt}` : ''}</b>
                      <span className="st-hint">{f.error} ({ago(f.at)})</span>
                    </div>
                    {f.jobId && f.jobStatus === 'failed' && <PriceButton action={{ type: 'retry', jobId: f.jobId }} label="Retry" size="sm" variant="secondary" compact noStatus />}
                  </div>
                ))}
              </div>
            )}
          </>
        )}
      </div>
    </div>
  )
}

// The engine lever (item 15): one switch, at the top of Settings and on
// Weeks. Picks per step and per character still win.
export function EngineLever({ compact = false }: { compact?: boolean }) {
  const toast = useToast()
  const qc = useQueryClient()
  const q = useQuery({ queryKey: ['lever'], queryFn: () => api.lever(), staleTime: 15_000 })
  const v: LeverView | undefined = q.data
  const [open, setOpen] = useState(false)
  async function set(body: Parameters<typeof api.setLever>[0], ok: string) {
    try {
      qc.setQueryData(['lever'], await api.setLever(body))
      await Promise.all([qc.invalidateQueries({ queryKey: ['estimate'] }), qc.invalidateQueries({ queryKey: ['engine-pick'] })])
      toast({ tone: 'ok', text: ok })
    } catch (e) { toast({ tone: 'bad', text: errorMessage(e) }) }
  }
  if (!v) return null
  const current = v.engines.find(e => e.id === v.engine)
  return (
    <div className={compact ? 'st-col' : 'st-card'} style={compact ? { gap: 8 } : undefined} data-field="engine-lever">
      <div className={compact ? 'st-row' : 'st-card-head'} style={compact ? { gap: 8, alignItems: 'center', flexWrap: 'wrap' } : undefined}>
        <div className="grow">
          <div className={`${compact ? 'st-label' : 'st-h2'} st-row`} style={{ gap: 8, margin: 0 }}>Engine<HowTo id="engine" label="How the engine lever works" /></div>
          {!compact && <div className="st-hint">One switch for every step: the engine's model for each step, its prices in its own units. A pick on a step or a character still wins. Nothing runs without its price and your click.</div>}
        </div>
        <select className="st-select" style={{ width: compact ? 260 : 300, maxWidth: "100%" }} aria-label="Engine" value={v.engine ?? ''} onChange={e => void set({ engine: e.target.value || null }, e.target.value ? `Engine: ${v.engines.find(x => x.id === e.target.value)?.label}. Prices follow it.` : 'Each step uses its own model again.')} data-field="engine-select">
          <option value="">Each step's own model (no engine)</option>
          {v.engines.map(e => <option key={e.id} value={e.id}>{e.label} ({e.units})</option>)}
        </select>
      </div>
      <div className={compact ? 'st-col' : 'st-card-body st-col'} style={{ gap: 10 }}>
        {current && v.notes.map(n => <Callout key={n} tone="warn"><span data-field="engine-note">{n}</span></Callout>)}
        <button type="button" className="st-btn ghost sm" style={{ alignSelf: 'flex-start' }} onClick={() => setOpen(!open)} aria-expanded={open} data-field="engine-table-toggle">{open ? 'Hide the table' : 'See which model each step uses'}</button>
        {open && (
          <div className="st-table-wrap" data-field="engine-table">
            <table className="st-table">
              <thead><tr><th>Step</th>{v.engines.map(e => <th key={e.id} className={e.id === v.engine ? 'on' : ''}>{e.label}</th>)}<th>Every engine</th></tr></thead>
              <tbody>
                {v.rows.map(r => (
                  <tr key={r.step}>
                    <td><b>{r.label}</b></td>
                    {v.engines.map(e => {
                      const c = r.cells[e.id]
                      return (
                        <td key={e.id} className={e.id === v.engine ? 'on' : ''}>
                          <select className="st-select xs" aria-label={`${r.label} on ${e.label}`} value={c?.ref ?? ''} onChange={ev => void set({ cell: { engine: e.id, step: r.step, ref: ev.target.value || null } }, `${e.label}, ${r.label.toLowerCase()}: ${ev.target.value ? r.options.find(o => o.ref === ev.target.value)?.label : 'not on this engine'}.`)}>
                            <option value="">Cannot do this step</option>
                            {r.options.map(o => <option key={o.ref} value={o.ref}>{o.label}</option>)}
                          </select>
                          {c?.price && <div className="st-hint st-mono">{c.price}</div>}
                        </td>
                      )
                    })}
                    <td>
                      {r.step !== 'lora' && (
                        <select className="st-select xs" aria-label={`${r.label} on every engine`} value={r.override ?? ''} onChange={ev => void set({ step: { step: r.step as Exclude<typeof r.step, 'lora'>, ref: ev.target.value || null } }, ev.target.value ? `${r.label} now use ${r.options.find(o => o.ref === ev.target.value)?.label} on every engine.` : `${r.label} follow the engine again.`)}>
                          <option value="">Follow the engine</option>
                          {r.options.map(o => <option key={o.ref} value={o.ref}>{o.label}</option>)}
                        </select>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  )
}

// A character's LoRAs (items 6, 7): Train LoRA on Qwen-Image-Edit or Krea 2
// Raw from the sheet and the approved stills ticked; any version active.
export function LoraCard({ v }: { v: CharacterView }) {
  const toast = useToast()
  const qc = useQueryClient()
  const q = useQuery({ queryKey: ['loras', v.id], queryFn: () => api.loras(v.id), refetchInterval: 15_000 })
  const [base, setBase] = useState<'qwen' | 'krea2'>('qwen')
  const [picked, setPicked] = useState<string[]>([])
  const [comparing, setComparing] = useState(false)
  const scenes = useQuery({ queryKey: ['scenes', v.id], queryFn: () => api.scenes(v.id), staleTime: 60_000 })
  const faceless = (v.data as { kind?: string }).kind === 'faceless'
  if (faceless) return null
  const approvedStills = (scenes.data?.scenes ?? []).flatMap(sc => sc.candidates).filter(s => s.status === 'approved' && s.assetId && s.media === 'image')
  const loras = q.data?.loras ?? []
  const sheetReady = v.sheet.progress.approved > 0
  return (
    <section className="st-card" data-field="character-loras">
      <div className="st-card-head"><div className="grow"><div className="st-h2 st-row" style={{ gap: 8 }}>LoRAs on ComfyUI<HowTo id="comfy" label="How LoRAs work" /></div>
        <div className="st-hint">A LoRA teaches the ComfyUI models {v.data.name}'s face from her sheet (REF-00 to REF-11) and any approved stills you tick. It trains on the ComfyUI machine; the file stays there. The active version rides along on every ComfyUI still.</div></div></div>
      <div className="st-card-body st-col" style={{ gap: 14 }}>
        {loras.length > 0 && (
          <div className="st-col" style={{ gap: 6 }} data-field="lora-list">
            {loras.map(l => (
              <div key={l.id} className="st-row" style={{ gap: 10, alignItems: 'center' }}>
                <b>{l.base === 'krea2' ? 'Krea 2' : 'Qwen'} v{l.version}</b>
                <span className="st-mono st-hint">{l.trigger}</span>
                <span className="st-hint">{l.images} images, {l.steps} steps</span>
                <span className={`st-badge plain ${l.state === 'ready' ? 'ok' : l.state === 'failed' ? 'bad' : ''}`}>{l.state === 'ready' ? (l.active ? 'Active' : 'Ready') : l.state === 'failed' ? 'Failed' : 'Training'}</span>
                {l.state === 'ready' && !l.active && <AsyncButton className="st-btn sm" onClick={async () => { try { await api.setActiveLora(v.id, l.id); await qc.invalidateQueries({ queryKey: ['loras', v.id] }); toast({ tone: 'ok', text: `${l.base === 'krea2' ? 'Krea 2' : 'Qwen'} v${l.version} is active.` }) } catch (e) { toast({ tone: 'bad', text: errorMessage(e) }) } }}>Make active</AsyncButton>}
              </div>
            ))}
          </div>
        )}
        <div className="st-row" style={{ gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
          <span className="st-label" style={{ margin: 0 }}>Base</span>
          <span className="st-seg" role="radiogroup" aria-label="LoRA base">
            <button type="button" role="radio" aria-checked={base === 'qwen'} className={base === 'qwen' ? 'on' : ''} onClick={() => setBase('qwen')}>Qwen-Image-Edit</button>
            <button type="button" role="radio" aria-checked={base === 'krea2'} className={base === 'krea2' ? 'on' : ''} onClick={() => setBase('krea2')}>Krea 2 Raw</button>
          </span>
          {base === 'krea2' && <span className="st-badge plain warn">License check</span>}
        </div>
        {approvedStills.length > 0 && (
          <div className="st-col" style={{ gap: 6 }}>
            <span className="st-label" style={{ margin: 0 }}>Also train on these approved stills (optional)</span>
            <div className="st-row" style={{ gap: 6, flexWrap: 'wrap' }}>
              {approvedStills.slice(0, 24).map(s => (
                <label key={s.id} className={`st-lora-pick${picked.includes(s.id) ? ' on' : ''}`}>
                  <input type="checkbox" checked={picked.includes(s.id)} onChange={e => setPicked(e.target.checked ? [...picked, s.id] : picked.filter(x => x !== s.id))} />
                  <img src={assetUrl(s.assetId!, 160)} alt="" loading="lazy" />
                </label>
              ))}
            </div>
          </div>
        )}
        <PriceButton action={sheetReady ? { type: 'comfy_train', characterId: v.id, base, stillIds: picked } : null} label={`Train ${loras.some(l => l.base === base) ? 'a new version of the' : 'the'} ${base === 'krea2' ? 'Krea 2' : 'Qwen'} LoRA`} todo={sheetReady ? [] : [{ label: 'Approve the reference sheet first (REF-00 at least)' }]} watch={j => j.purpose.startsWith(`comfy_lora:${v.id}:`)} />
        <div className="st-row" style={{ gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
          <button type="button" className="st-btn" onClick={() => setComparing(true)} data-field="open-compare">Compare providers</button>
          <span className="st-hint">10 of {v.data.name}'s real prompts on Nano Banana (Kie.ai), Qwen and Krea 2 Turbo with her LoRAs, side by side with face and skin scores.</span>
        </div>
      </div>
      <CompareDrawer v={v} open={comparing} onClose={() => setComparing(false)} />
    </section>
  )
}

// The bake-off (item 12), in Review style: each prompt's stills side by
// side, the face score against REF-00 and the skin texture score.
export function CompareDrawer({ v, open, onClose }: { v: CharacterView; open: boolean; onClose: () => void }) {
  const toast = useToast()
  const q = useQuery({ queryKey: ['compare', v.id], queryFn: () => api.compare(v.id), enabled: open, refetchInterval: open ? 10_000 : false })
  const c = q.data
  return (
    <Drawer open={open} onClose={onClose} title={<span className="st-row" style={{ gap: 8 }}>Compare providers<HowTo id="comfy" label="How the comparison works" /></span>} wide>
      <div className="st-col" style={{ gap: 16 }} data-field="compare-drawer">
        <span className="st-hint">Face: the match with REF-00 (higher is the same person). Skin: detail against REF-00's (1.0 is as much real skin texture; low means smoothed). Nothing changes until you press Use as default.</span>
        <PriceButton action={{ type: 'compare_providers', characterId: v.id }} label="Run the comparison" watch={j => j.purpose.startsWith('bakeoff:') && j.characterId === v.id} />
        {c?.run && c.models && c.rows && (
          <>
            <div className="st-row" style={{ gap: 10, flexWrap: 'wrap' }} data-field="compare-summary">
              {c.models.map(m => (
                <div key={m.ref} className="st-card" style={{ padding: 12, minWidth: 200 }}>
                  <b>{m.label}</b>
                  <div className="st-hint">Face {m.face ?? 'n/a'}, skin {m.texture ?? 'n/a'}</div>
                  <AsyncButton className="st-btn sm" onClick={async () => { try { await api.useCompared(m.ref); toast({ tone: 'ok', text: `${m.label} is now the default for stills on every character. Settings > Engine changes it back.` }) } catch (e) { toast({ tone: 'bad', text: errorMessage(e) }) } }}>Use as default for stills</AsyncButton>
                </div>
              ))}
            </div>
            <div className="st-col" style={{ gap: 14 }}>
              {c.rows.map(r => (
                <div key={r.index} className="st-col" style={{ gap: 6 }}>
                  <span className="st-hint">{r.index + 1}. {r.prompt.split('\n')[0]?.slice(0, 160)}</span>
                  <div className="st-compare-row">
                    {c.models!.map(m => {
                      const cell = r.cells[m.ref]
                      return (
                        <figure key={m.ref} className="st-compare-cell">
                          {cell?.assetId ? <img src={assetUrl(cell.assetId, 480)} alt={`${m.label}, prompt ${r.index + 1}`} loading="lazy" /> : <div className="st-skel" style={{ aspectRatio: '9 / 16' }} />}
                          <figcaption><b>{m.label}</b><span className="st-hint">{cell ? (cell.status === 'completed' ? `Face ${cell.face ?? 'n/a'}, skin ${cell.texture ?? 'n/a'}` : cell.status) : 'not run'}</span></figcaption>
                        </figure>
                      )
                    })}
                  </div>
                </div>
              ))}
            </div>
          </>
        )}
        {c && !c.run && <span className="st-hint">No comparison yet. <Link to="/studio/settings?tab=general">ComfyUI</Link> must be online for its two columns.</span>}
      </div>
    </Drawer>
  )
}

export type { ComfyView }
