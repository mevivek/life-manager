/**
 * Format-as-you-type for a document's number.
 *
 * ═══════════════════════════════════════════════════════════════════════════════════════
 *  It only ever GROUPS, CASES and CAPS. It never rejects a keystroke and never blocks Save.
 * ═══════════════════════════════════════════════════════════════════════════════════════
 *
 * The point is that the field looks like the card in your hand: `9999 8888 7777`, not
 * `999988887777`. That is worth doing because the number is checked by eye against a physical
 * document, and an unbroken twelve-digit run is the one string a person cannot proof-read.
 *
 * What it deliberately does **not** do:
 *
 *  - **No validation.** `identifier` is optional forever (Q2), so a half-typed Aadhaar number must
 *    save. Nothing here can make the form invalid, and there is no error state.
 *  - **No truncation of unknown numbers.** Only a preset with a known shape is reshaped; everything
 *    else passes through with whitespace collapsed. A policy number's format is the insurer's
 *    business, and guessing at it would mangle a value the user typed correctly.
 *
 * The spec lives on the preset (`presets.ts`), not in a lookup keyed by name here. The comp had the
 * same names listed in three places — a digits-only list, a masked list, and a format map — which is
 * three chances for them to disagree about what an Aadhaar number looks like.
 */

/** `A` accepts a letter, `#` a digit. Anything else in a mask is not supported. */
export type NumberFormat =
  | { kind: 'digits'; digits: number; groups: number[] }
  | { kind: 'mask'; mask: string }

/** Letters and digits only — the characters that carry meaning, as opposed to grouping spaces. */
export function significant(value: string): string {
  return value.replace(/[^0-9a-z]/gi, '').toUpperCase()
}

/** How many significant characters a complete value has. */
export function capacityOf(format: NumberFormat): number {
  return format.kind === 'digits' ? format.digits : format.mask.length
}

/**
 * The value as it should appear in the field after this keystroke.
 *
 * With no format, whitespace is collapsed and the value is capped at a length no real identifier
 * reaches — a guard against a paste of an entire PDF, not a validation rule.
 */
export function formatNumber(format: NumberFormat | undefined, raw: string): string {
  if (format === undefined) return raw.replace(/\s+/g, ' ').slice(0, 64)

  if (format.kind === 'digits') {
    const digits = raw.replace(/\D/g, '').slice(0, format.digits)
    const parts: string[] = []
    let at = 0
    for (const size of format.groups) {
      if (at >= digits.length) break
      parts.push(digits.slice(at, at + size))
      at += size
    }
    return parts.join(' ')
  }

  /**
   * Walk the mask, and for each slot **hunt forward** through the input until a character fits it.
   *
   * Skipping rather than stopping is what makes a paste of `ABCDE-1234-F` land as `ABCDE1234F`
   * instead of `ABCDE`, and a mistyped character get dropped rather than blocking every character
   * after it.
   *
   * ── The hunt is inside the slot, and that is a fix to the comp's version ──
   *
   * The comp advanced the slot on every iteration, whether or not it consumed a character. So one
   * stray leading digit did not merely get dropped — it **ate a slot**, and the loss cascaded:
   * `1ABCDE1234F` came out as `ABCD123`, silently losing the `E` and the trailing `F` from a value
   * the user had typed correctly apart from one keystroke. Hunting inside the slot keeps every
   * character that has somewhere to go, which is what "only ever groups, cases and caps" claims.
   */
  const source = significant(raw)
  const fits = (slot: string, char: string) =>
    slot === 'A' ? /[A-Z]/.test(char) : /[0-9]/.test(char)

  let out = ''
  let at = 0
  for (const slot of format.mask) {
    while (at < source.length && !fits(slot, source[at] ?? '')) at += 1
    if (at >= source.length) break
    out += source[at]
    at += 1
  }
  return out
}

/**
 * `7 of 12` while typing, `Complete` once full, nothing at all when empty or unshaped.
 *
 * A count rather than a tick or a cross, because this is **not** validation: "Complete" says the
 * value is the right length for this document, not that it is the right number. Nothing downstream
 * reads it.
 */
export function numberHint(format: NumberFormat | undefined, value: string): string {
  if (format === undefined) return ''
  const have = significant(value).length
  if (have === 0) return ''
  const want = capacityOf(format)
  return have < want ? `${have} of ${want}` : 'Complete'
}

/**
 * What survives when the user picks a different preset mid-typing.
 *
 * The draft is kept **only if reformatting it to the new shape loses nothing**. Otherwise the field
 * clears: an empty field is honest, whereas a residue — the first five characters of an Aadhaar
 * number sitting under a label reading "PAN" — is a value the user did not type and may not notice.
 */
export function carryNumber(format: NumberFormat | undefined, draft: string): string {
  if (draft === '') return ''
  const next = formatNumber(format, draft)
  return significant(next) === significant(draft) ? next : ''
}

/**
 * The keyboard to ask for. `numeric` on a digits-only number saves the user a keyboard switch on
 * every capture; `text` everywhere else, because a mask that mixes letters and digits needs both.
 */
export function inputModeFor(format: NumberFormat | undefined): 'numeric' | 'text' {
  return format?.kind === 'digits' ? 'numeric' : 'text'
}

/**
 * `characters` for masked numbers, which are conventionally written in capitals and which
 * `formatNumber` upper-cases anyway — so the keyboard should not pretend otherwise. `none` for
 * digits and for free text, where autocapitalising is either pointless or wrong.
 */
export function autoCapitalizeFor(format: NumberFormat | undefined): 'characters' | 'none' {
  return format?.kind === 'mask' ? 'characters' : 'none'
}

/**
 * A stored value, grouped for reading aloud.
 *
 * `9999 8888 7777` is how an Aadhaar number is printed and how a person reads one back. An
 * alphanumeric code like `ABCDE1234F` is left alone: inserting spaces into one invents a format the
 * document does not use.
 *
 * Deliberately NOT `formatNumber`. This runs on a value already saved, where no preset is in hand —
 * the archive renders a hundred rows and knows only what came back from the API.
 */
export function groupForReading(value: string): string {
  if (!/^\d+$/.test(value) || value.length < 8) return value
  return value.replace(/(\d{4})(?=\d)/g, '$1 ')
}

/**
 * Where to put the caret after reformatting, given where it was in **significant** terms.
 *
 * Counted in significant characters rather than string indices, because the reformat inserts and
 * removes grouping spaces underneath the caret. Without this, typing the fifth digit of an Aadhaar
 * number moves the caret to the end of the field — so a correction mid-number is impossible and the
 * field feels broken in a way that is very hard to attribute.
 */
export function caretForSignificant(value: string, wanted: number): number {
  if (wanted <= 0) return 0
  let seen = 0
  for (let index = 0; index < value.length; index += 1) {
    if (/[0-9a-z]/i.test(value[index] ?? '')) {
      seen += 1
      if (seen === wanted) return index + 1
    }
  }
  return value.length
}
