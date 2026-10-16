import { useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { Copy, Plus, RotateCcw, X } from 'lucide-react'
import { keys } from '../../../hooks'
import { PriceButton } from '../../../PriceButton'
import { Field, useToast, type TodoItem } from '../../../ui'
import { HowTo } from '../../../guide/Guide'
import { CTA_KINDS, TEXT_STYLES, backdropFor, cleanSpecial, ctaText, editSlides, fullSpecial, postCaption, setAt, slideList, type CtaKind, type SlidePos, type SpecialSlide, type TextStyleId } from '../../../../../server/core/slides'
import { wordsNote } from '../../../../../server/core/slideSvg'
import type { SlideshowSpec } from '../../../types'
import type { PostCtx } from '../ctx'
import { SlideFrame, type FrameId } from './SlideFrame'
import { LintNote, useLint } from '../../../lint'
import { useSlideFonts } from './draw'

// The slideshow's Slides step (UX-PLAN.md section 27): the text style
// (Classic by default, Text box, Minimal, Note), a big preview with the
// safe zones where the words are dragged, each slide's words and special
// slide, the CTA slide, the caption (rewritten by Claude, priced), at most
// 5 hashtags, and #ad. What shows here is burned into the export.

export function SlideshowText({ ctx }: { ctx: PostCtx }) {
  const { item, draft, data, lib } = ctx
  const qc = useQueryClient()
  const toast = useToast()
  const fonts = useSlideFonts()
  const spec = draft.spec as unknown as SlideshowSpec
  const list = slideList(spec)
  const [sel, setSel] = useState(0)
  const [safe, setSafe] = useState(true)
  const [frame, setFrame] = useState<FrameId>(spec.made === 'instagram' ? 'instagram' : 'tiktok')
  const cur = list[Math.min(sel, Math.max(0, list.length - 1))]
  const asset = (id: string | null | undefined) => (id ? lib?.stills.find(s => s.id === id)?.assetId ?? null : null)
  // A special slide shows the nearest slide's photo behind it.
  const pic = (s: { index: number; stillId: string | null; special: unknown }) => asset(s.special ? backdropFor(list, s.index) : s.stillId)
  const brands = { names: data.options.slideshow.brandNames ?? [], generic: data.options.slideshow.genericNames ?? [] }
  const max = data.options.slideshow.hashtagsMax ?? 5
  const tags = (spec.hashtags ?? []).slice(0, max)
  const texts = [spec.hook, ...spec.slides]
  const hasWords = texts.some(t => t.trim())
  const lint = useLint(item.characterId)
  const product = !!(spec.ad || spec.plan?.product)
  const cta = spec.ctaLine ?? ''

  const setText = (i: number, value: string) => draft.setSpec((i === 0 ? { hook: value } : { slides: setAt(spec.slides, i - 1, value, '') }) as never)
  const setPos = (i: number, pos: SlidePos | null) => draft.setSpec({ textPos: setAt(spec.textPos ?? [], i, pos, null) } as never)
  const setSpecial = (i: number, patch: Partial<SpecialSlide>) => { const s = list[i]?.special; if (s) draft.setSpec({ specials: setAt(spec.specials ?? [], i, { ...s, ...patch }, null) } as never) }
  function setCta(kind: CtaKind, o: { handle?: string; word?: string } = {}) {
    const cta = { ...spec.cta, kind, ...o }
    const text = ctaText(kind, cta)
    const last = list.length - 1
    const isCta = (t: string) => CTA_KINDS.some(c => { const x = ctaText(c.id, cta); return !!x && x === t.trim() }) || /^follow\b|^save this\b|^comment\b|^more (?:like this )?on my page\b/i.test(t.trim())
    if (kind === 'none') {
      // The CTA slide goes when it reads like one.
      if (last > 0 && isCta(texts[last] ?? '')) { draft.setSpec({ ...editSlides(spec, { remove: last }), cta } as never); return }
      draft.setSpec({ cta } as never)
      return
    }
    if (!text) { draft.setSpec({ cta } as never); return }
    // The last slide becomes the CTA (or a CTA slide is added after the payoff).
    if (last >= 1 && (isCta(texts[last] ?? '') || !(texts[last] ?? '').trim())) draft.setSpec({ cta, slides: setAt(spec.slides, last - 1, text, '') } as never)
    else { const added = editSlides(spec, { add: list.length }); draft.setSpec({ ...added, cta, slides: setAt(added.slides, list.length - 1, text, '') } as never) }
  }
  async function copyCaption() {
    try { await navigator.clipboard.writeText(postCaption(spec.caption, tags, { ad: spec.ad, max, cta })); toast({ tone: 'ok', text: 'Caption copied.' }) } catch { toast({ tone: 'bad', text: 'Could not copy. Select the text and copy it.' }) }
  }
  const writeTodo: TodoItem[] = [...(!spec.hook.trim() && (draft.fields.idea.trim() || spec.topic.trim()).length < 3 ? [{ label: 'A hook or the idea (Idea step)', target: 'slideshow-hook', onGo: () => ctx.open('idea', { field: 'slideshow-hook' }) }] : [])]

  return (
    <div className="st-col" style={{ gap: 18 }} data-field="slideshow-text">
      <div className="st-row" style={{ gap: 10, flexWrap: 'wrap', alignItems: 'flex-start' }}>
        {spec.hook.trim().length >= 3 ? (
          <PriceButton label={hasWords && texts.length > 1 ? `Draft ${spec.slideCount} slides again from the hook` : `Draft ${spec.slideCount} slides from the hook`} variant={texts.length > 1 ? 'secondary' : 'primary'} size="sm"
            action={draft.saving || !item.characterId ? null : { type: 'slideshow_draft', contentId: item.id, hook: spec.hook.trim(), pattern: spec.pattern ?? null }} waiting={draft.saving ? 'Saving...' : undefined}
            watch={j => j.purpose === `slide_draft:${item.id}:self`} onDone={() => void qc.invalidateQueries({ queryKey: keys.content })} />
        ) : (
          <PriceButton label="Write the slides from the idea" variant="secondary" size="sm" todo={writeTodo}
            action={writeTodo.length || draft.saving || !item.characterId ? null : { type: 'content_slides', characterId: item.characterId, contentId: item.id }} waiting={draft.saving ? 'Saving...' : undefined}
            watch={j => j.purpose === `content_slides:${item.id}`} />
        )}
        <HowTo id="slideshow" label="Text styles and safe zones" />
      </div>

      <Field label="Text style" group>
        <div className="st-stylepick" role="radiogroup" aria-label="Text style" data-field="text-style">
          {TEXT_STYLES.map(s => (
            <button key={s.id} type="button" role="radio" aria-checked={spec.textStyle === s.id} aria-label={`${s.label}: ${s.line}`} className={spec.textStyle === s.id ? 'on' : ''} onClick={() => draft.setSpec({ textStyle: s.id } as never)} title={s.line}>
              {fonts ? <SlideFrame slide={{ ...(cur ?? SAMPLE), special: null, pos: null, text: cur?.text || SAMPLE.text }} assetId={asset(cur?.stillId)} style={s.id as TextStyleId} ad={false} width={92} /> : <div className="st-skel" style={{ width: 92, height: 164 }} />}
              <b>{s.label}</b><span className="st-muted">{s.line}</span>
            </button>
          ))}
        </div>
      </Field>

      {list.length === 0 ? <span className="st-hint">No slides yet. Draft them from a hook in the Idea step, or pick stills; words are optional.</span> : (
        <div className="st-slides-editor">
          <div className="st-col" style={{ gap: 10, minWidth: 0 }}>
            <div className="st-slidestrip" role="tablist" aria-label="Slides">
              {list.map(s => (
                <button key={s.index} type="button" role="tab" aria-selected={cur?.index === s.index} className={cur?.index === s.index ? 'on' : ''} onClick={() => setSel(s.index)}>
                  {fonts ? <SlideFrame slide={s} assetId={pic(s)} style={spec.textStyle} ad={spec.ad && s.index === 0} width={64} brands={brands} /> : <div className="st-skel" style={{ width: 64, height: 114 }} />}
                </button>
              ))}
            </div>
            {list.map(s => {
              const note = wordsNote(texts[s.index] ?? '')
              return (
                <div key={s.index} className="st-col" style={{ gap: 6 }} data-field={`slide-text-${s.index}`} onFocus={() => setSel(s.index)}>
                  <div className="st-row" style={{ gap: 8, flexWrap: 'nowrap' }}>
                    <span className="st-hint" style={{ width: 58, flex: 'none' }}>{s.index === 0 ? 'Hook' : s.index === list.length - 1 && list.length > 2 ? `${s.index + 1} (CTA)` : `Slide ${s.index + 1}`}</span>
                    <input className="st-input" style={{ flex: 1, minWidth: 0 }} maxLength={s.index ? 300 : 200} value={texts[s.index] ?? ''} onChange={e => setText(s.index, e.target.value)} aria-label={`Slide ${s.index + 1} words`} placeholder={s.index ? 'Words on this slide (optional)' : 'The hook'} />
                    {s.pos && <button type="button" className="st-btn ghost sm" title="Back to the default place" onClick={() => setPos(s.index, null)}><RotateCcw size={13} /></button>}
                    {list.length > 1 && <button type="button" className="st-btn ghost sm" aria-label={`Remove slide ${s.index + 1}`} onClick={() => { draft.setSpec(editSlides(spec, { remove: s.index }) as never); setSel(0) }}><X size={14} /></button>}
                  </div>
                  {note && <span className="st-hint" style={{ marginLeft: 66 }}>{note}</span>}
                  <div style={{ marginLeft: 66 }}><LintNote hits={lint(texts[s.index] ?? '', s.index === 0 ? 'hook' : 'slide', { product })} field={`slide-lint-${s.index}`} /></div>
                  {s.special && cur?.index === s.index && <SpecialEditor special={s.special} onChange={p => setSpecial(s.index, p)} brands={brands} />}
                </div>
              )
            })}
            {list.length < 10 && <button type="button" className="st-btn ghost sm" style={{ alignSelf: 'flex-start' }} onClick={() => draft.setSpec(editSlides(spec, { add: list.length }) as never)}><Plus size={14} />Add a slide</button>}
          </div>
          {cur && (
            <div className="st-col" style={{ gap: 8, alignItems: 'center' }} data-field="slide-preview">
              {fonts ? <SlideFrame slide={cur} assetId={pic(cur)} style={spec.textStyle} ad={spec.ad && cur.index === 0} width={300} frame={frame} safe={safe} brands={brands} onMove={p => setPos(cur.index, p)} /> : <div className="st-skel" style={{ width: 300, height: 533 }} />}
              <div className="st-row" style={{ gap: 8, flexWrap: 'wrap', justifyContent: 'center' }}>
                <label className="st-row" style={{ gap: 6 }}><input type="checkbox" checked={safe} onChange={e => setSafe(e.target.checked)} />Safe zones</label>
                <div className="st-seg sm" role="radiogroup" aria-label="Preview size">
                  <button type="button" role="radio" aria-checked={frame === 'tiktok'} className={frame === 'tiktok' ? 'on' : ''} onClick={() => setFrame('tiktok')}>TikTok</button>
                  <button type="button" role="radio" aria-checked={frame === 'instagram'} className={frame === 'instagram' ? 'on' : ''} onClick={() => setFrame('instagram')}>Instagram</button>
                </div>
              </div>
              <span className="st-hint" style={{ maxWidth: 300, textAlign: 'center' }}>Drag the words (or use the arrow keys) to move them on this slide. They stay out of the top 10% and the bottom 20%. Exactly this goes into the JPEG.</span>
            </div>
          )}
        </div>
      )}

      <Field id="slideshow-cta" label="CTA slide" group hint="Sets the last slide's words. A handle is typed without the @.">
        <div className="st-row" style={{ gap: 8, flexWrap: 'wrap' }}>
          <select className="st-select" value={spec.cta.kind} onChange={e => setCta(e.target.value as CtaKind)} aria-label="CTA">
            {CTA_KINDS.map(c => <option key={c.id} value={c.id}>{c.label}</option>)}
          </select>
          {spec.cta.kind === 'handle' && <input className="st-input" style={{ maxWidth: 220 }} maxLength={40} value={spec.cta.handle} onChange={e => setCta('handle', { handle: e.target.value.replace(/^@+/, '') })} placeholder="yourhandle" aria-label="Handle" />}
          {spec.cta.kind === 'comment' && <input className="st-input" style={{ maxWidth: 180 }} maxLength={30} value={spec.cta.word} onChange={e => setCta('comment', { word: e.target.value })} placeholder="e.g. guide" aria-label="Comment word" />}
        </div>
      </Field>

      <div className="st-col" style={{ gap: 10 }} data-field="slideshow-caption">
        <Field label="Caption" extra={item.characterId ? <span style={{ marginLeft: 8 }}><PriceButton size="sm" variant="secondary" icon={false} compact label="Rewrite the caption" action={!hasWords || draft.saving ? null : { type: 'slideshow_caption', contentId: item.id }} waiting={draft.saving ? 'Saving...' : undefined} todo={hasWords ? [] : [{ label: 'Write the slides first' }]} /></span> : null}
          hint="A first-person story in the account's voice. Rewrite the caption has Claude write a new one from the slides.">
          <textarea className="st-textarea" rows={3} maxLength={2200} value={spec.caption} onChange={e => draft.setSpec({ caption: e.target.value } as never)} />
        </Field>
        <LintNote hits={lint(spec.caption, 'caption', { product, hashtags: spec.hashtags ?? [] })} field="caption-lint" />
        <Field label="CTA line" hint="One line under the caption: a question, a warm offer or a shrug, never an order. Added to the caption as posted when it is not already in it.">
          <input className="st-input" maxLength={300} value={cta} onChange={e => draft.setSpec({ ctaLine: e.target.value } as never)} placeholder="e.g. What time did yours arrive?" />
        </Field>
        <Field label={`Hashtags (${tags.length} of ${max} at most)`} hint="Separated by spaces, without #. Only the first 5 are used.">
          <input className="st-input" value={(spec.hashtags ?? []).join(' ')} onChange={e => draft.setSpec({ hashtags: e.target.value.split(/[\s,]+/).map(h => h.replace(/^#+/, '')).filter(Boolean).slice(0, max) } as never)} />
        </Field>
        <label className="st-row" style={{ gap: 10, cursor: 'pointer', alignItems: 'flex-start' }} data-field="slideshow-ad">
          <button type="button" role="switch" aria-checked={spec.ad} className={`st-switch ${spec.ad ? 'on' : ''}`} onClick={() => draft.setSpec({ ad: !spec.ad } as never)}><span /></button>
          <span className="st-col" style={{ gap: 2 }}><b>#ad</b><span className="st-hint">{spec.ad ? 'On: "Ad" on slide 1, and "Ad:" first in the caption.' : 'Off. Turn it on for a product post, a paid post or a brand deal.'}</span></span>
        </label>
        {(spec.caption.trim() || tags.length > 0 || cta.trim()) && (
          <div className="st-col" style={{ gap: 6 }}>
            <span className="st-label">As posted</span>
            <pre className="st-license" style={{ whiteSpace: 'pre-wrap', maxHeight: 160 }}>{postCaption(spec.caption, tags, { ad: spec.ad, max, cta })}</pre>
            <button type="button" className="st-btn ghost sm" style={{ alignSelf: 'flex-start' }} onClick={copyCaption}><Copy size={14} />Copy caption and hashtags</button>
          </div>
        )}
      </div>
    </div>
  )
}

// A text style tile before there are slides.
const SAMPLE = { index: 0, text: 'Your hook goes right here', stillId: null, special: null, shot: '', pos: null }

function SpecialEditor({ special, onChange, brands }: { special: SpecialSlide; onChange: (p: Partial<SpecialSlide>) => void; brands: { names: string[]; generic: string[] } }) {
  const cleaned = cleanSpecial(special, brands.names, brands.generic)
  const replaced = JSON.stringify(cleaned) !== JSON.stringify(fullSpecial(special))
  const f = (label: string, key: 'from' | 'title' | 'body' | 'time', o: { area?: boolean; ph?: string } = {}) => (
    <Field label={label}>
      {o.area ? <textarea className="st-textarea" rows={3} value={special[key]} onChange={e => onChange({ [key]: e.target.value })} placeholder={o.ph} /> : <input className="st-input" value={special[key]} onChange={e => onChange({ [key]: e.target.value })} placeholder={o.ph} />}
    </Field>
  )
  const lines = (label: string, hint: string, max = 10) => (
    <Field label={label} hint={hint}>
      <textarea className="st-textarea" rows={4} value={special.lines.join('\n')} onChange={e => onChange({ lines: e.target.value.split('\n').slice(0, max) })} />
    </Field>
  )
  const seg = (label: string, value: string, options: Array<[string, string]>, set: (v: string) => void) => (
    <Field label={label} group>
      <div className="st-seg sm" role="radiogroup" aria-label={label}>
        {options.map(([id, l]) => <button key={id} type="button" role="radio" aria-checked={value === id} className={value === id ? 'on' : ''} onClick={() => set(id)}>{l}</button>)}
      </div>
    </Field>
  )
  const blur = (
    <label className="st-row" style={{ gap: 8, cursor: 'pointer' }}>
      <button type="button" role="switch" aria-checked={special.blur} className={`st-switch ${special.blur ? 'on' : ''}`} onClick={() => onChange({ blur: !special.blur })}><span /></button>
      <span className="st-hint">Blur the amounts</span>
    </label>
  )
  const t = special.type
  return (
    <div className="st-card" style={{ marginLeft: 66 }} data-field="special-editor">
      <div className="st-card-body st-col" style={{ gap: 8 }}>
        <span className="st-hint">{t === 'product_shot' ? 'Your own screenshot of the product, placed as it is (the Studio never draws one).' : 'A mock screen, drawn by code (free). Generic names only: a real brand is shown as a generic name.'}</span>
        {t === 'notification' && <>{f('App', 'from', { ph: 'Messages' })}{f('From', 'title')}{f('Message', 'body', { area: true })}{f('Time', 'time', { ph: 'now' })}</>}
        {t === 'text_thread' && <>{f('Contact', 'title')}{lines('Messages, one a line', 'Yours start with "me: ".')}</>}
        {t === 'rejection_email' && <>{f('From', 'from')}{f('Subject', 'title')}{f('Email', 'body', { area: true })}{f('Time', 'time')}</>}
        {t === 'job_posting' && <>{f('Role', 'title')}{f('Company', 'from')}{f('Place and pay', 'body')}{lines('Requirements, one a line', 'Up to 5.', 5)}{f('Posted', 'time', { ph: '2 days ago' })}</>}
        {t === 'application_form' && <>
          {seg('State', special.variant || 'empty', [['empty', 'Empty'], ['filled', 'Filled']], v => onChange({ variant: v }))}
          {f('Portal', 'from', { ph: 'Careers portal' })}{f('Page', 'title', { ph: 'Work history, page 4 of 6' })}
          {lines('Fields, one a line', special.variant === 'filled' ? 'Filled: "Label: value".' : 'The labels; the first box shows the cursor. Up to 5.', 5)}
          <Field label="Fields in all" hint="The progress line: 0 of this many (empty) or all of them (filled).">
            <input className="st-input" type="number" min={0} max={200} value={special.count} onChange={e => onChange({ count: Math.max(0, Math.min(200, Number(e.target.value) || 0)) })} />
          </Field>
        </>}
        {t === 'portal_status' && <>{f('Portal', 'from')}{f('Role', 'title')}{f('Status', 'body', { ph: 'In review' })}{lines('Steps, one a line', '"Step · timestamp"; the last one is now. Up to 6.', 6)}</>}
        {t === 'calendar_invite' && <>{f('Event', 'title')}{f('When', 'time', { ph: 'Tue, Oct 20 · 2:00 to 2:30 PM' })}{f('Where', 'body', { ph: 'Video call' })}{f('Organizer', 'from')}{lines('Attendees, one a line', 'Initials only. Up to 8.', 8)}</>}
        {t === 'receipt' && <>
          {seg('Kind', special.variant || 'invoice', [['invoice', 'Invoice'], ['receipt', 'Receipt']], v => onChange({ variant: v }))}
          {f('Number', 'title', { ph: 'INVOICE No. 047' })}{f('Billed to', 'from')}{lines('Items, one a line', '"Item · amount". Up to 7.', 7)}{f('Total line', 'body', { ph: 'Total due · $685.00' })}{f('Due', 'time')}{blur}
        </>}
        {t === 'bank_app' && <>{f('Bank', 'from', { ph: 'Everyday Bank' })}{f('Account', 'title', { ph: 'Savings' })}{f('Label', 'time', { ph: 'Available balance' })}{f('Balance', 'body')}{lines('Rows, one a line', '"Label · amount"; + is green, - is red. Up to 5.', 5)}{blur}</>}
        {t === 'museum_placard' && <>{f('Title', 'title')}{f('Artist', 'from')}{f('Medium and year', 'time', { ph: 'Email, 2026' })}{f('Placard text', 'body', { area: true })}</>}
        {t === 'survey' && <>{f('Survey', 'from')}{f('Question', 'title', { area: true })}
          <Field label="Picked score">
            <select className="st-select" value={special.count} onChange={e => onChange({ count: Number(e.target.value) })}>
              <option value={-1}>None yet</option>
              {Array.from({ length: 11 }, (_, k) => <option key={k} value={k}>{k}</option>)}
            </select>
          </Field>
        </>}
        {t === 'lock_screen' && <>{f('Clock', 'time', { ph: '2:14' })}{f('Date', 'from', { ph: 'Wednesday, October 21' })}{lines('Notifications, one a line', '"App · Sender · message". Up to 4.', 4)}</>}
        {t === 'profile_card' && <>{f('Name', 'title')}{f('Headline', 'from', { ph: 'Open to work · Class of 2026' })}{f('About', 'body', { area: true })}{lines('Stats, one a line', '"Label · value". Up to 3.', 3)}
          {seg('Banner', special.variant || 'blue', [['blue', 'Blue'], ['green', 'Green'], ['purple', 'Purple'], ['orange', 'Orange'], ['gray', 'Gray']], v => onChange({ variant: v }))}
        </>}
        {t === 'product_shot' && <>
          {!special.assetId && <span className="st-hint st-warntext">No screenshot yet: upload it on this slide's card in the Stills step.</span>}
          <Field label={`Size (${Math.round(special.scale * 100)}% of the width)`}>
            <input type="range" min={40} max={100} value={Math.round(special.scale * 100)} onChange={e => onChange({ scale: Number(e.target.value) / 100 })} aria-label="Screenshot size" />
          </Field>
          {seg('Where', special.variant === 'top' ? 'top' : 'middle', [['middle', 'Under the words'], ['top', 'At the top']], v => onChange({ variant: v }))}
        </>}
        {replaced && <span className="st-hint st-warntext">A real brand name is replaced with a generic one on the slide.</span>}
      </div>
    </div>
  )
}
