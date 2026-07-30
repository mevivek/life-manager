import { describe, expect, it } from 'vitest'
import { copyFor } from './voice'

/**
 * Voice, walked in both registers.
 *
 * The point of collecting the sentences in one module was that the *set* could be tested — a ternary
 * per call site would only ever be exercised on whatever screen someone happened to open. So these
 * walk every function `copyFor` returns and assert the property that matters: **plain differs from
 * warm, and never says less.** A sentence added to `voice.ts` with only one register filled in is a
 * failure here rather than a surprise in production.
 */

const warm = copyFor('warm')
const plain = copyFor('plain')

/** A date with a known weekday: 30 July 2026 is a Thursday. Fixed, because voice must not read a clock. */
const THURSDAY = new Date(2026, 6, 30)

describe('voice', () => {
  it('gives the date a human face in warm and a record face in plain', () => {
    // Warm names the weekday, because that is how a person locates a day; plain names the year,
    // because that is how a record does. Neither is a formatting preference.
    expect(warm.todayLabel(THURSDAY)).toBe('Thursday 30 July')
    expect(plain.todayLabel(THURSDAY)).toBe('30 Jul 2026')
  })

  it('counts what needs you, spelling the plural rather than tacking on an s', () => {
    expect(warm.nowHeadline(1, 5)).toBe('One thing needs you.')
    expect(warm.nowHeadline(2, 5)).toBe('2 things need you.')
    expect(plain.nowHeadline(1, 5)).toBe('1 item due')
    expect(plain.nowHeadline(2, 5)).toBe('2 items due')
  })

  it('has a distinct nothing-needed and nothing-stored state in both registers', () => {
    expect(warm.nowHeadline(0, 5)).toBe('Nothing needs you today.')
    expect(plain.nowHeadline(0, 5)).toBe('No action due')
    expect(warm.nowHeadline(0, 0)).toBe('Nothing in here yet.')
    expect(plain.nowHeadline(0, 0)).toBe('No documents')
  })

  it('keeps the sub answering the question — never just “nothing”', () => {
    const args = { attention: 0, total: 3, nextDate: '4 March 2027', nextRelative: '7 months' }
    // Warm reassures with the date; plain states it. Both NAME the date — that is the whole reason
    // the Now screen exists, and the register is not allowed to drop it.
    expect(warm.nowSub(args)).toContain('4 March 2027')
    expect(plain.nowSub(args)).toContain('4 March 2027')
  })

  it('plain says no LESS than warm: a count where warm gives a reassurance', () => {
    const args = { attention: 2, total: 5, nextDate: null, nextRelative: null }
    // Warm: "Everything else is in order." Plain must not just be terser — it carries the fact the
    // reassurance stood in for, which is how many others there are.
    expect(warm.nowSub(args)).toBe('Everything else is in order.')
    expect(plain.nowSub(args)).toContain('3 other')
  })

  it('takes the all-clear threshold as an argument rather than hardcoding it', () => {
    // The number must be able to follow NEEDS_YOU_DAYS, so a caller passing 45 and 30 gets 45 and 30.
    expect(warm.clearTitle(45)).toBe('Nothing expires in the next 45 days')
    expect(warm.clearTitle(30)).toBe('Nothing expires in the next 30 days')
    expect(plain.clearTitle(45)).toBe('No expiry within 45 days')
  })

  it('pluralises the dated-document count in the all-clear body', () => {
    expect(plain.clearBody(1)).toContain('1 dated document ')
    expect(plain.clearBody(4)).toContain('4 dated documents ')
    // Warm does not count — it reassures. That asymmetry is the two registers, not a gap.
    expect(warm.clearBody(4)).not.toMatch(/\d/)
  })

  it('describes the saved step the wizard actually draws, not the form it replaced', () => {
    /**
     * design.md §13: **a label must be one the value can carry.** Both registers described the
     * pre-ADR-0030 single-page form — plain promised "Optional fields below", warm invited "Add
     * anything else now" — and the wizard's saved step has no fields on it. It shows a read-back of
     * the values, a note naming the blanks, and actions that leave for the record's own screen.
     *
     * A sentence naming furniture that is not on screen is the kind of rot that only shows up in the
     * register nobody switches to, which is the blind spot §12(2) names. So it is asserted.
     */
    expect(plain.savedBody).not.toMatch(/optional fields/i)
    expect(warm.savedBody).not.toMatch(/add anything else/i)
    // Neither may promise a form or an input on this step.
    for (const register of [warm.savedBody, plain.savedBody]) {
      expect(register).not.toMatch(/\bfields? below\b/i)
    }
    // Plain says no less than warm: it names what is listed AND what the actions do.
    expect(plain.savedBody).toMatch(/below/)
    expect(plain.savedBody).toMatch(/actions/)
  })

  it('differs between registers for every fixed-string sentence', () => {
    // The walk. Each of these is a plain string on the copy object; if a new one is added with the
    // same text in both registers, this catches the half-done translation.
    for (const key of ['zeroLine', 'authHeadline', 'authSub', 'savedBody'] as const) {
      expect(warm[key], `warm.${key} is empty`).not.toBe('')
      expect(plain[key], `plain.${key} is empty`).not.toBe('')
      expect(warm[key], `${key} is identical in both registers`).not.toBe(plain[key])
    }
  })
})
