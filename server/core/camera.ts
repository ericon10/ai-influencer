// Camera presets on the worker (editor phase D): the same math as the
// editor's (the OpenReel fork's packages/core/src/studio/presets.ts:
// ease, cameraAt, shakeOffset), so a block placed in the editor moves the
// frame the same way when the worker renders the timeline. Pure; the parity
// tests run the same vectors as the fork's presets.test.ts.

export type PresetEase = 'linear' | 'in' | 'out' | 'inOut' | 'inExpo' | 'outExpo' | 'outBack' | 'hold'
export type PresetStrength = 'subtle' | 'normal' | 'strong'

export interface CameraKey {
  t: number
  scale?: number
  x?: number
  y?: number
  rotation?: number
  blur?: number
  motionBlur?: number
  rgb?: number
  flash?: number
  dark?: number
  shake?: number
  saturation?: number
  brightness?: number
  vignette?: number
  ease?: PresetEase
}

export interface CameraFrame {
  scale: number; x: number; y: number; rotation: number; blur: number; motionBlur: number; rgb: number
  flash: number; dark: number; shake: number; saturation: number; brightness: number; vignette: number
}

// A preset block on the timeline, as the editor saves it.
export interface CameraBlock {
  start: number
  duration: number
  strength: PresetStrength
  keys: CameraKey[]
  preset: string
}

export const STRENGTH_SCALE: Record<PresetStrength, number> = { subtle: 0.55, normal: 1, strong: 1.6 }
export const IDENTITY: CameraFrame = { scale: 1, x: 0, y: 0, rotation: 0, blur: 0, motionBlur: 0, rgb: 0, flash: 0, dark: 0, shake: 0, saturation: 1, brightness: 1, vignette: 0 }
const CHANNELS = Object.keys(IDENTITY) as (keyof CameraFrame)[]

export function ease(name: PresetEase | undefined, u: number): number {
  const x = Math.max(0, Math.min(1, u))
  switch (name) {
    case 'in': return x * x * x
    case 'out': return 1 - Math.pow(1 - x, 3)
    case 'inOut': return x < 0.5 ? 4 * x * x * x : 1 - Math.pow(-2 * x + 2, 3) / 2
    case 'inExpo': return x === 0 ? 0 : Math.pow(2, 10 * x - 10)
    case 'outExpo': return x === 1 ? 1 : 1 - Math.pow(2, -10 * x)
    case 'outBack': { const c1 = 1.70158, c3 = c1 + 1; return 1 + c3 * Math.pow(x - 1, 3) + c1 * Math.pow(x - 1, 2) }
    case 'hold': return x < 1 ? 0 : 1
    default: return x
  }
}

const amplify = (ch: keyof CameraFrame, v: number, s: number) => IDENTITY[ch] + (v - IDENTITY[ch]) * s

export function cameraAt(keys: readonly CameraKey[], u: number, strength: PresetStrength = 'normal'): CameraFrame {
  const s = STRENGTH_SCALE[strength]
  const sorted = [...keys].sort((a, b) => a.t - b.t)
  const out: CameraFrame = { ...IDENTITY }
  for (const ch of CHANNELS) {
    const pts = sorted.filter(k => k[ch] !== undefined)
    if (!pts.length) continue
    const val = (k: CameraKey) => k[ch] as number
    let v: number
    if (u <= pts[0]!.t) v = val(pts[0]!)
    else if (u >= pts[pts.length - 1]!.t) v = val(pts[pts.length - 1]!)
    else {
      let i = 0
      while (i < pts.length - 1 && pts[i + 1]!.t < u) i++
      const a = pts[i]!, b = pts[i + 1]!
      const span = b.t - a.t
      v = val(a) + (val(b) - val(a)) * ease(b.ease, span > 0 ? (u - a.t) / span : 1)
    }
    out[ch] = amplify(ch, v, s)
  }
  out.flash = Math.max(0, Math.min(1, out.flash))
  out.dark = Math.max(0, Math.min(1, out.dark))
  out.motionBlur = Math.max(0, Math.min(1.5, out.motionBlur))
  out.vignette = Math.max(0, Math.min(1, out.vignette))
  out.scale = Math.max(0.2, out.scale)
  return out
}

export function shakeOffset(time: number, amount: number): { dx: number; dy: number; rot: number } {
  if (amount <= 0) return { dx: 0, dy: 0, rot: 0 }
  const n = (f: number, p: number) => Math.sin(time * f + p) * 0.6 + Math.sin(time * f * 2.3 + p * 1.7) * 0.4
  return { dx: n(61, 0.3) * amount, dy: n(53, 1.9) * amount, rot: n(47, 4.1) * amount * 40 }
}

export function isIdentity(f: CameraFrame): boolean {
  return f.scale === 1 && !f.x && !f.y && !f.rotation && !f.blur && !f.motionBlur && !f.rgb && !f.flash && !f.dark && !f.shake && f.saturation === 1 && f.brightness === 1 && !f.vignette
}

// The frame a block gives at a timeline time (null outside it).
export function blockFrameAt(b: CameraBlock, time: number): CameraFrame | null {
  if (b.duration <= 0 || time < b.start || time >= b.start + b.duration) return null
  return cameraAt(b.keys, (time - b.start) / b.duration, b.strength)
}
