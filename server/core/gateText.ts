// Gate numbers in words (owner, 2026-10-22, item 21): a score next to its
// limit gets the decimals that show which side it is on. 0.448 against 0.45
// reads "0.448, needs 0.450", never "0.45, needs 0.45". Two decimals when
// they already tell the two apart; up to four.

export function fmt(v: number, digits = 2): string {
  return v.toFixed(digits)
}

// The fewest decimals (2 to 4) at which the value and the limit differ.
export function digitsFor(value: number, limit: number): number {
  for (let d = 2; d <= 4; d++) if (value.toFixed(d) !== limit.toFixed(d)) return d
  return 4
}

// The value and the limit at the same decimals.
export function vs(value: number, limit: number): [string, string] {
  const d = digitsFor(value, limit)
  return [value.toFixed(d), limit.toFixed(d)]
}

// A score shown on its own, with the decimals it needs against its limit
// (a badge next to a gate).
export function scoreAgainst(value: number | null, limit: number | null | undefined): string {
  if (value == null) return '?'
  return limit == null ? value.toFixed(2) : value.toFixed(digitsFor(value, limit))
}
