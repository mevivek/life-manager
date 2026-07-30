import { describe, expect, it } from 'vitest'
import {
  autoCapitalizeFor,
  capacityOf,
  caretForSignificant,
  carryNumber,
  carryPlate,
  fitsShape,
  formatNumber,
  formatPlate,
  inputModeFor,
  numberHint,
  PLATE_EXAMPLE,
  PLATE_SERIES,
  significant,
  withPlateSeries,
} from './numberFormat'
import { PRESETS, presetByName } from './presets'

/**
 * Format-as-you-type. Pure functions, so they get tested directly rather than through the form —
 * which is the point of extracting them: the keystroke-by-keystroke behaviour is the part most likely
 * to be subtly wrong, and driving it through a rendered input tests React as much as the logic.
 */

const AADHAAR = presetByName('Aadhaar')?.format
const PAN = presetByName('PAN card')?.format
const PASSPORT = presetByName('Passport')?.format
const RC = presetByName('Vehicle RC')?.format

/** A typo'd preset name would make every assertion below vacuously pass against `undefined`. */
describe('the fixtures resolved', () => {
  it('found every preset these tests name', () => {
    for (const format of [AADHAAR, PAN, PASSPORT, RC]) expect(format).toBeDefined()
  })
})

describe('formatNumber, digit groups', () => {
  it('groups as the user types, one keystroke at a time', () => {
    // The sequence a person actually produces. Each step must be a valid intermediate — a formatter
    // that only works on a complete value is a formatter that fights you for eleven keystrokes.
    expect(formatNumber(AADHAAR, '9')).toBe('9')
    expect(formatNumber(AADHAAR, '9999')).toBe('9999')
    expect(formatNumber(AADHAAR, '99998')).toBe('9999 8')
    expect(formatNumber(AADHAAR, '999988887777')).toBe('9999 8888 7777')
  })

  it('re-groups a value that already has spaces, so a paste lands correctly', () => {
    expect(formatNumber(AADHAAR, '9999 8888 7777')).toBe('9999 8888 7777')
    expect(formatNumber(AADHAAR, '9999-8888-7777')).toBe('9999 8888 7777')
    expect(formatNumber(AADHAAR, '  9999  8888  7777  ')).toBe('9999 8888 7777')
  })

  it('caps at the digit count and drops non-digits', () => {
    expect(formatNumber(AADHAAR, '9999888877776666')).toBe('9999 8888 7777')
    expect(formatNumber(AADHAAR, '99a99b8888c7777')).toBe('9999 8888 7777')
  })

  it('handles the 5-5-5 grouping of an ITR acknowledgement', () => {
    const itr = presetByName('ITR acknowledgement')?.format
    expect(formatNumber(itr, '123456789012345')).toBe('12345 67890 12345')
    expect(formatNumber(itr, '123456')).toBe('12345 6')
  })
})

describe('formatNumber, masks', () => {
  it('upper-cases and keeps only what fits each slot', () => {
    expect(formatNumber(PAN, 'abcde1234f')).toBe('ABCDE1234F')
    expect(formatNumber(PASSPORT, 'm1234567')).toBe('M1234567')
  })

  it('skips a character that does not fit, rather than stopping there', () => {
    // Skipping is what makes a paste of a punctuated number work. Stopping at the first mismatch
    // would truncate `ABCDE-1234-F` to `ABCDE`, which looks like data loss and is.
    expect(formatNumber(PAN, 'ABCDE-1234-F')).toBe('ABCDE1234F')
  })

  it('does not let one stray character eat a slot — the comp bug', () => {
    /**
     * The comp advanced the mask slot on every iteration, whether or not it consumed a character, so
     * a single leading digit cascaded: `1ABCDE1234F` came out as `ABCD123`, silently dropping the `E`
     * and the trailing `F` from a value typed correctly apart from one keystroke.
     *
     * Hunting inside the slot keeps every character that has somewhere to go.
     */
    expect(formatNumber(PAN, '1ABCDE1234F')).toBe('ABCDE1234F')
    // A digit typed where a letter belongs, mid-value, is dropped and the rest still lands.
    expect(formatNumber(PAN, 'ABCD1E1234F')).toBe('ABCDE1234F')
  })

  it('caps at the mask length', () => {
    expect(formatNumber(PAN, 'ABCDE1234FGHIJ')).toBe('ABCDE1234F')
  })

  it('never rejects a partial value', () => {
    // Q2: the field is optional forever, so every prefix has to be a legal thing to hold.
    expect(formatNumber(PAN, 'A')).toBe('A')
    expect(formatNumber(PAN, 'ABC')).toBe('ABC')
    expect(formatNumber(PAN, 'ABCDE1')).toBe('ABCDE1')
  })
})

/**
 * ═══════════════════════════════════════════════════════════════════════════════════════
 *  The two plate series — the bug handoff 3 shipped, and the guard against shipping it again.
 * ═══════════════════════════════════════════════════════════════════════════════════════
 *
 * `Vehicle RC` was masked `AA##AA####`, which made a Bharat-series plate untypeable: `22 BH 1234 AA`
 * begins with two digits, the mask's first two slots want letters, and the leading `22` was eaten
 * before anything else landed. things.md §4 rule 9.
 */
describe('formatPlate', () => {
  it('groups a state-series plate as it is written', () => {
    expect(formatPlate('state', 'ka01ab1234')).toBe('KA 01 AB 1234')
    // Already grouped, punctuated, or spaced differently — all the same plate.
    expect(formatPlate('state', 'KA 01 AB 1234')).toBe('KA 01 AB 1234')
    expect(formatPlate('state', 'KA-01-AB-1234')).toBe('KA 01 AB 1234')
    // Three series letters, which is why this cannot be a fixed-length mask.
    expect(formatPlate('state', 'KA01ABC1234')).toBe('KA 01 ABC 1234')
  })

  it('groups a Bharat-series plate, which the old mask could not hold at all', () => {
    // THE regression test. Under `AA##AA####` this came out as `BH` plus nothing usable.
    expect(formatPlate('bh', '22bh1234aa')).toBe('22 BH 1234 AA')
    expect(formatPlate('bh', '22 BH 1234 AA')).toBe('22 BH 1234 AA')
  })

  it('is typeable one keystroke at a time, in both series', () => {
    // Every prefix of a real plate must be a legal thing for the field to hold, or the formatter
    // fights the user for ten keystrokes. `never rejects a keystroke`, as an assertion.
    for (const series of PLATE_SERIES) {
      const target = significant(PLATE_EXAMPLE[series])
      for (let length = 1; length <= target.length; length += 1) {
        const typed = target.slice(0, length)
        // Nothing typed so far is ever dropped: the significant characters come back unchanged.
        expect(significant(formatPlate(series, typed))).toBe(typed)
      }
      // ...and the whole plate lands as the example is printed.
      expect(formatPlate(series, target)).toBe(PLATE_EXAMPLE[series])
    }
  })

  it('drops overflow past the last group rather than rejecting the field', () => {
    expect(formatPlate('state', 'KA01AB12345')).toBe('KA 01 AB 1234')
    expect(formatPlate('bh', '22BH1234AAA')).toBe('22 BH 1234 AA')
  })

  it('reaches the same answer through formatNumber, which is what the field calls', () => {
    expect(formatNumber({ kind: 'plate', series: 'bh' }, '22bh1234aa')).toBe('22 BH 1234 AA')
    expect(formatNumber(RC, 'ka01ab1234')).toBe('KA 01 AB 1234')
  })
})

describe('carryPlate', () => {
  it('keeps a draft the other series can hold without losing anything', () => {
    // A part-typed `22 BH` is legal in both: BH reads it as year + series, and the state pattern reads
    // the same characters as RTO digits + series letters. Nothing is lost, so nothing is cleared.
    expect(carryPlate('state', '22 BH')).toBe('22 BH')
    expect(carryPlate('bh', '22 BH')).toBe('22 BH')
  })

  it('clears a draft the new series would silently truncate', () => {
    // A whole BH plate reshaped as a state plate loses its trailing letter pair — `22 BH 1234` under a
    // label reading "Registration number" is a plate that does not exist. Empty is honest.
    expect(carryPlate('state', '22 BH 1234 AA')).toBe('')
    // And the reverse: a state plate's four trailing digits have nowhere to go in the BH shape.
    expect(carryPlate('bh', 'KA 01 AB 1234')).toBe('')
  })

  it('leaves an empty draft empty', () => {
    expect(carryPlate('bh', '')).toBe('')
  })
})

describe('the plate has no completeness counter', () => {
  it('says nothing, because two live formats have no single length', () => {
    // A "7 of 10" would be wrong for one of the two series at all times. `capacityOf` returns null
    // rather than a number, so a future caller has to decide rather than inherit a wrong one.
    expect(capacityOf({ kind: 'plate', series: 'state' })).toBeNull()
    expect(capacityOf({ kind: 'plate', series: 'bh' })).toBeNull()
    expect(numberHint(RC, 'KA 01')).toBe('')
    expect(numberHint(RC, 'KA 01 AB 1234')).toBe('')
    // The formats that DO have one still have one — asserted so this does not turn into "no hints".
    expect(capacityOf({ kind: 'digits', digits: 12, groups: [4, 4, 4] })).toBe(12)
    expect(numberHint(AADHAAR, '9999')).toBe('4 of 12')
  })
})

describe('withPlateSeries', () => {
  it('rebinds a plate to the chosen series and leaves everything else alone', () => {
    // One row of chips governs the field without the preset table knowing about wizard state.
    expect(withPlateSeries(RC, 'bh')).toEqual({ kind: 'plate', series: 'bh' })
    expect(withPlateSeries(AADHAAR, 'bh')).toBe(AADHAAR)
    expect(withPlateSeries(undefined, 'bh')).toBeUndefined()
  })
})

describe('formatNumber with no format', () => {
  it('collapses whitespace and otherwise leaves the value alone', () => {
    // A policy number's format is the insurer's business. Reshaping one we do not know would mangle a
    // value the user typed correctly.
    expect(formatNumber(undefined, 'AV-4471  9820')).toBe('AV-4471 9820')
    expect(formatNumber(undefined, 'anything/goes_here.42')).toBe('anything/goes_here.42')
  })

  it('caps at a length no real identifier reaches, against a runaway paste', () => {
    expect(formatNumber(undefined, 'x'.repeat(200))).toHaveLength(64)
  })
})

describe('numberHint', () => {
  it('counts up and then says Complete', () => {
    expect(numberHint(AADHAAR, '')).toBe('')
    expect(numberHint(AADHAAR, '9999')).toBe('4 of 12')
    expect(numberHint(AADHAAR, '9999 8888 777')).toBe('11 of 12')
    expect(numberHint(AADHAAR, '9999 8888 7777')).toBe('Complete')
  })

  it('counts significant characters, not the grouped string length', () => {
    // '9999 8888' is 9 characters and 8 digits. Reporting 9 would say "9 of 12" on a value that is
    // two-thirds typed, and would reach "12 of 12" two digits early.
    expect(numberHint(AADHAAR, '9999 8888')).toBe('8 of 12')
  })

  it('says nothing for a shape we do not know', () => {
    expect(numberHint(undefined, 'AV-4471-9820')).toBe('')
  })
})

describe('carryNumber', () => {
  it('keeps a draft the new shape can hold without losing anything', () => {
    // Aadhaar → EPF/UAN: both 12 digits in 4-4-4, so the draft survives intact.
    const uan = presetByName('EPF / UAN')?.format
    expect(carryNumber(uan, '9999 8888 7777')).toBe('9999 8888 7777')
  })

  it('clears a draft that the new shape would silently truncate or mangle', () => {
    // Twelve Aadhaar digits into a PAN mask keeps almost nothing, so the field empties. An empty field
    // is honest; five stray characters under a label reading "PAN" is a value the user never typed.
    expect(carryNumber(PAN, '9999 8888 7777')).toBe('')
    // And the reverse: a PAN into Aadhaar's digits-only shape.
    expect(carryNumber(AADHAAR, 'ABCDE1234F')).toBe('')
  })

  it('leaves an empty draft empty', () => {
    expect(carryNumber(PAN, '')).toBe('')
  })
})

describe('fitsShape', () => {
  it('accepts a value the shape reproduces exactly', () => {
    expect(fitsShape(PASSPORT, 'M1234567')).toBe(true)
    expect(fitsShape(AADHAAR, '999988887777')).toBe(true)
    // Already grouped — the spaces are not significant, so it still fits.
    expect(fitsShape(AADHAAR, '9999 8888 7777')).toBe(true)
  })

  it('rejects a value the shape would silently shorten', () => {
    // The hazard: this reformats to 'F1234471' — twelve characters down to eight, on a stored value.
    expect(fitsShape(PASSPORT, 'FAKEM1234471')).toBe(false)
    expect(fitsShape(AADHAAR, 'ABCDE1234F')).toBe(false)
  })

  it('treats absent and empty as fitting, since there is nothing to lose', () => {
    expect(fitsShape(PASSPORT, null)).toBe(true)
    expect(fitsShape(PASSPORT, undefined)).toBe(true)
    expect(fitsShape(PASSPORT, '')).toBe(true)
  })

  it('accepts anything when there is no shape to fit', () => {
    expect(fitsShape(undefined, 'AV-4471-9820')).toBe(true)
  })
})

describe('caretForSignificant', () => {
  it('maps a significant-character position back to a string index', () => {
    // '9999 8888' — after 4 significant characters the caret belongs at index 4, BEFORE the space,
    // so the next keystroke lands in the right group.
    expect(caretForSignificant('9999 8888', 4)).toBe(4)
    expect(caretForSignificant('9999 8888', 5)).toBe(6)
    expect(caretForSignificant('9999 8888', 8)).toBe(9)
  })

  it('clamps at both ends', () => {
    expect(caretForSignificant('9999', 0)).toBe(0)
    expect(caretForSignificant('9999', 99)).toBe(4)
  })
})

describe('keyboard hints', () => {
  it('asks for a numeric keypad only where the number is digits only', () => {
    expect(inputModeFor(AADHAAR)).toBe('numeric')
    expect(inputModeFor(PAN)).toBe('text')
    expect(inputModeFor(undefined)).toBe('text')
  })

  it('autocapitalises only masked numbers, which are written in capitals anyway', () => {
    expect(autoCapitalizeFor(PAN)).toBe('characters')
    expect(autoCapitalizeFor(AADHAAR)).toBe('none')
    expect(autoCapitalizeFor(undefined)).toBe('none')
  })
})

describe('the preset formats as a set', () => {
  it('gives every formatted preset an example shape, since the shape is now the example', () => {
    // A preset with a mask but no example would show a label and nothing to compare the card against.
    for (const preset of PRESETS) {
      if (preset.format === undefined) continue
      expect(preset.shape).not.toBe('')
      /**
       * The example must itself be a valid complete value under its own format — otherwise the
       * placeholder teaches the wrong shape, which is worse than teaching none.
       *
       * **A plate is exempt, and deliberately so**: it has no completeness counter (two series, two
       * lengths — see `capacityOf`), and its `shape` is the `AA ## AA ####` diagram rather than an
       * example. Its `placeholder` is the example, and it is checked in the block below rather than
       * dropped.
       */
      if (preset.format.kind === 'plate') continue
      expect(numberHint(preset.format, preset.shape)).toBe('Complete')
    }
  })

  it('gives every plate preset a placeholder that is a real, whole plate', () => {
    const plates = PRESETS.filter((preset) => preset.format?.kind === 'plate')
    // Non-zero, per design.md §10: an empty filter here would make every assertion below vacuous.
    expect(plates.length).toBeGreaterThan(0)
    for (const preset of plates) {
      const placeholder = preset.placeholder ?? ''
      expect(placeholder).not.toBe('')
      // Round-trips through its own formatter, so the example is a plate the field would produce.
      expect(formatNumber(preset.format, placeholder)).toBe(placeholder)
    }
  })

  it('uses only supported mask slots', () => {
    for (const preset of PRESETS) {
      if (preset.format?.kind !== 'mask') continue
      expect(preset.format.mask).toMatch(/^[A#]+$/)
    }
  })

  it('makes group sizes add up to the digit count', () => {
    for (const preset of PRESETS) {
      if (preset.format?.kind !== 'digits') continue
      const total = preset.format.groups.reduce((sum, size) => sum + size, 0)
      expect(total).toBe(preset.format.digits)
    }
  })
})

describe('significant', () => {
  it('keeps letters and digits, upper-cased, and drops everything else', () => {
    expect(significant('mh12 ab-1234')).toBe('MH12AB1234')
    expect(significant('')).toBe('')
  })
})
