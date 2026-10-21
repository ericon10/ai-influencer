import { describe, expect, it } from 'vitest'
import { sheetRefOf } from './uploads.js'
import { sheetRefOf as browserSheetRefOf } from '../../src/studio/files.js'

// Callie's folder is "CALLIE MASTER CHARACTER" with images "REF 00" to
// "REF 11" (REF 12 and REF 13 when it has build refs); every common
// spelling maps to REF-00 to REF-13.
describe('sheet image names', () => {
  it('normalizes REF 00 to REF 13, with any separator, case or extra words', () => {
    for (const fn of [sheetRefOf, (n: string) => browserSheetRefOf(n)]) {
      expect(fn('REF 00')).toBe('REF-00')
      expect(fn('REF 11.png')).toBe('REF-11')
      expect(fn('ref_3.jpg')).toBe('REF-03')
      expect(fn('Callie REF-04 mirrored.png')).toBe('REF-04')
      expect(fn('REF07 final.webp')).toBe('REF-07')
      expect(fn('REF 12.png')).toBe('REF-12')
      expect(fn('REF 14.png')).toBeNull()
      expect(fn('BONUS-01.png')).toBeNull()
      expect(fn('preference.png')).toBeNull()
    }
  })
})
