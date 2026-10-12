// Money is integer micro-USD everywhere (1 USD = 1,000,000). No floats.
export const MICROS = 1_000_000

export function usdToMicros(usd: number): number {
  return Math.round(usd * MICROS)
}

export function microsToUsd(micros: number): number {
  return micros / MICROS
}

// "$0.25", "$1.20", "$0.0042" (small amounts keep enough digits to be honest).
export function formatUsd(micros: number): string {
  const usd = micros / MICROS
  const abs = Math.abs(usd)
  const digits = abs === 0 ? 2 : abs < 0.01 ? 4 : 2
  const s = abs.toFixed(digits)
  return `${usd < 0 ? '-' : ''}$${s}`
}
