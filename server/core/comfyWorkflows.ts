import { createHash } from 'node:crypto'
import { stableStringify } from '../costs/stableJson.js'

// ComfyUI workflows as data (UX-PLAN.md section 41, item 4): an API-format
// graph plus a small manifest that says which node field takes each of the
// Studio's inputs. Pure: validate, bind, and the environment hash.

export type ComfyFamily = 'qwen' | 'krea2' | 'wan'
export type ComfyStep = 'still' | 'edit' | 'video' | 'recreate_motion'

export interface Binding { node: string; field: string }

export interface WorkflowManifest {
  id: string
  version: number
  label: string
  // The model ref the Studio routes to (config/models.yaml).
  ref: string
  steps: ComfyStep[]
  kinds: string[]
  family: ComfyFamily
  license_check?: boolean
  // Model files it needs, by folder (comfy/env/models.json paths).
  models: string[]
  // The LoRA base a character's LoRA must be trained on to ride along.
  lora_base?: 'qwen' | 'krea2'
  inputs: {
    prompt: Binding
    negative?: Binding
    seed?: Binding
    width?: Binding
    height?: Binding
    batch?: Binding
    frames?: Binding
    fps?: Binding
    refs?: Binding[]
    start_image?: Binding
    clip?: Binding
    person_point?: Binding
    lora?: Binding & { strength_field?: string; optional?: boolean }
  }
  outputs: Array<{ node: string; kind: 'image' | 'video' }>
  fps?: number
  max_frames?: number
  est_sec: number
  timeout_sec: number
  notes?: string
}

export type ApiGraph = Record<string, { class_type: string; inputs: Record<string, unknown>; _meta?: unknown }>

export interface Workflow { manifest: WorkflowManifest; graph: ApiGraph; source: 'repo' | 'uploaded' }

// A link to another node's output in an API graph: ["7", 0].
const isLink = (v: unknown): v is [string, number] => Array.isArray(v) && v.length === 2 && typeof v[0] === 'string' && typeof v[1] === 'number'

// What is wrong with a workflow and its manifest, in words (empty: fine).
// Every bound node and field must exist, outputs must be save nodes, and
// every link must point at a node in the graph.
export function workflowProblems(m: Partial<WorkflowManifest>, graph: unknown): string[] {
  const out: string[] = []
  if (!m || typeof m !== 'object') return ['The manifest is not a JSON object.']
  if (!m.id || !/^[a-z0-9][a-z0-9.-]{1,60}$/.test(m.id)) out.push('The manifest needs an id (lowercase letters, digits, dots and dashes).')
  if (!m.label) out.push('The manifest needs a label.')
  if (!m.ref || !/^comfy\/[a-z0-9.-]+$/.test(m.ref)) out.push('The manifest needs a ref like comfy/my-workflow.')
  if (!m.family || !['qwen', 'krea2', 'wan'].includes(m.family)) out.push('The manifest family must be qwen, krea2 or wan.')
  if (!Array.isArray(m.steps) || !m.steps.length) out.push('The manifest needs its steps (still, edit, video or recreate_motion).')
  if (!Array.isArray(m.outputs) || !m.outputs.length) out.push('The manifest needs at least one output node.')
  if (!m.inputs?.prompt) out.push('The manifest must bind the prompt.')
  if (!m.est_sec || !m.timeout_sec) out.push('The manifest needs est_sec and timeout_sec.')
  if (!graph || typeof graph !== 'object' || Array.isArray(graph)) return [...out, 'The workflow is not an API-format graph (export it with Save (API) in ComfyUI).']
  const g = graph as ApiGraph
  for (const [id, n] of Object.entries(g)) {
    if (!n || typeof n !== 'object' || typeof n.class_type !== 'string' || !n.inputs || typeof n.inputs !== 'object') { out.push(`Node ${id} is not an API-format node (class_type and inputs).`); continue }
    for (const [f, v] of Object.entries(n.inputs)) if (isLink(v) && !g[v[0]]) out.push(`Node ${id} (${n.class_type}) field ${f} links to node ${v[0]}, which is not in the graph.`)
  }
  const check = (name: string, b: Binding | undefined) => {
    if (!b) return
    const n = g[b.node]
    if (!n) out.push(`${name} is bound to node ${b.node}, which is not in the graph.`)
    else if (!(b.field in n.inputs)) out.push(`${name} is bound to ${n.class_type} (node ${b.node}) field ${b.field}, which that node does not have.`)
  }
  const ins = m.inputs ?? ({} as WorkflowManifest['inputs'])
  for (const k of ['prompt', 'negative', 'seed', 'width', 'height', 'batch', 'frames', 'fps', 'start_image', 'clip', 'person_point', 'lora'] as const) check(k, ins[k] as Binding | undefined)
  ins.refs?.forEach((b, i) => check(`Reference ${i + 1}`, b))
  if (ins.lora?.strength_field) check('LoRA strength', { node: ins.lora.node, field: ins.lora.strength_field })
  for (const o of m.outputs ?? []) {
    const n = g[o.node]
    if (!n) out.push(`Output node ${o.node} is not in the graph.`)
    else if (!/^Save/.test(n.class_type)) out.push(`Output node ${o.node} is ${n.class_type}; outputs must be save nodes (SaveImage, SaveVideo).`)
  }
  return out
}

export interface BindInput {
  prompt: string
  negative?: string
  seed: number
  width?: number
  height?: number
  batch?: number
  frames?: number
  fps?: number
  // How many reference images ride along (each becomes slot ref0, ref1...).
  refs: number
  startImage?: boolean
  clip?: boolean
  personPoint?: { x: number; y: number } | null
  lora?: { fileName: string; strength: number } | null
}

// The slot a placeholder names ("studio:ref0" is slot ref0).
export const PLACEHOLDER = 'studio:'
export const slotOf = (v: unknown): string | null => (typeof v === 'string' && v.startsWith(PLACEHOLDER) ? v.slice(PLACEHOLDER.length) : null)

// Drops a node and every input that links to it (only optional inputs link
// to a dropped image slot; the manifest lists them as extra refs).
function dropNode(g: ApiGraph, id: string): void {
  delete g[id]
  for (const n of Object.values(g)) for (const [f, v] of Object.entries(n.inputs)) if (isLink(v) && v[0] === id) delete n.inputs[f]
}

// Takes a pass-through node out (a LoRA loader with no LoRA): whatever read
// its output reads its input instead.
function bypassNode(g: ApiGraph, id: string, through: string): void {
  const src = g[id]?.inputs[through]
  delete g[id]
  for (const n of Object.values(g)) for (const [f, v] of Object.entries(n.inputs)) if (isLink(v) && v[0] === id) n.inputs[f] = src
}

// The graph with the Studio's inputs in place, and the image and clip slots
// the agent fills ({ ref0: true, start: true, clip: true }).
export function bindWorkflow(wf: Workflow, input: BindInput): { graph: ApiGraph; slots: string[] } {
  const g: ApiGraph = JSON.parse(JSON.stringify(wf.graph))
  const m = wf.manifest
  const set = (b: Binding | undefined, v: unknown) => { if (b && v !== undefined && g[b.node]) g[b.node]!.inputs[b.field] = v }
  set(m.inputs.prompt, input.prompt)
  set(m.inputs.negative, input.negative ?? '')
  set(m.inputs.seed, input.seed)
  set(m.inputs.width, input.width)
  set(m.inputs.height, input.height)
  set(m.inputs.batch, input.batch)
  if (input.frames !== undefined) set(m.inputs.frames, Math.min(input.frames, m.max_frames ?? input.frames))
  set(m.inputs.fps, input.fps)
  if (input.personPoint) set(m.inputs.person_point, JSON.stringify([{ x: Math.round(input.personPoint.x), y: Math.round(input.personPoint.y) }]))
  const slots: string[] = []
  // References: the first n slots are filled, the rest dropped.
  for (const [i, b] of (m.inputs.refs ?? []).entries()) {
    if (i < input.refs) { set(b, `${PLACEHOLDER}ref${i}`); slots.push(`ref${i}`) } else dropNode(g, b.node)
  }
  if (m.inputs.start_image) {
    if (!input.startImage) throw new Error(`${m.label} needs a start image.`)
    set(m.inputs.start_image, `${PLACEHOLDER}start`); slots.push('start')
  }
  if (m.inputs.clip) {
    if (!input.clip) throw new Error(`${m.label} needs the source clip.`)
    set(m.inputs.clip, `${PLACEHOLDER}clip`); slots.push('clip')
  }
  const lora = m.inputs.lora
  if (lora) {
    if (input.lora) {
      set(lora, input.lora.fileName)
      if (lora.strength_field) set({ node: lora.node, field: lora.strength_field }, input.lora.strength)
    } else if (lora.optional) bypassNode(g, lora.node, 'model')
    else throw new Error(`${m.label} needs the character's LoRA.`)
  }
  return { graph: g, slots }
}

// Any placeholder left in a graph (the agent refuses to queue one).
export function unfilledSlots(g: ApiGraph): string[] {
  const out: string[] = []
  for (const n of Object.values(g)) for (const v of Object.values(n.inputs)) { const s = slotOf(v); if (s) out.push(s) }
  return out
}

// ── The frozen environment (E3) ──

export interface EnvLock {
  version: number
  comfyui: string
  pytorch?: string
  nodes: Record<string, string>
  models: Record<string, string | null>
}

// The environment hash: sha256 of the lock as sorted JSON (whitespace and
// key order never change it). The agent computes the same over what it
// measures on the machine.
export const envHash = (lock: EnvLock): string => createHash('sha256').update(stableStringify({ version: lock.version, comfyui: lock.comfyui, pytorch: lock.pytorch ?? null, nodes: lock.nodes, models: lock.models })).digest('hex')

// What differs between the expected lock and the machine's, in words.
export function envDiff(expected: EnvLock, actual: Partial<EnvLock> | null | undefined): string[] {
  if (!actual) return ['The machine sent no environment.']
  const out: string[] = []
  const short = (s: string | null | undefined) => (s ? s.slice(0, 12) : 'missing')
  if (expected.comfyui !== actual.comfyui) out.push(`ComfyUI is at ${short(actual.comfyui)}, expected ${short(expected.comfyui)}.`)
  if ((expected.pytorch ?? null) !== (actual.pytorch ?? null)) out.push(`PyTorch is ${actual.pytorch ?? 'missing'}, expected ${expected.pytorch ?? 'none'}.`)
  for (const [k, v] of Object.entries(expected.nodes)) if (actual.nodes?.[k] !== v) out.push(`Custom node ${k} is at ${short(actual.nodes?.[k])}, expected ${short(v)}.`)
  for (const k of Object.keys(actual.nodes ?? {})) if (!(k in expected.nodes)) out.push(`Custom node ${k} is on the machine but not in the lock.`)
  for (const [k, v] of Object.entries(expected.models)) {
    const a = actual.models?.[k]
    if (a === undefined) out.push(`Model ${k} is missing on the machine.`)
    else if (v !== a) out.push(v === null ? `Model ${k} has not been measured in the lock yet (the machine has ${short(a)}).` : `Model ${k} has checksum ${short(a)}, expected ${short(v)}.`)
  }
  return out
}
