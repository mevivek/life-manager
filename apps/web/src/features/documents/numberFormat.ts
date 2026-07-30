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

/**
 * ═══════════════════════════════════════════════════════════════════════════════════════
 *  A vehicle registration is TWO live formats, and the series is a choice — never a guess.
 * ═══════════════════════════════════════════════════════════════════════════════════════
 *
 * domains/things.md §4 rule 9. India has two series in circulation:
 *
 *  - **state** — `KA 01 AB 1234`: state code, RTO number, up to three series letters, four digits.
 *  - **Bharat (BH)** — `22 BH 1234 AA`: year first, the literal `BH`, four digits, a letter pair.
 *    Issued since 2021 and valid across states, so it carries no RTO code.
 *
 * **Neither is a subset of the other.** A single `AA##AA####` mask — which is what handoff 3 shipped
 * and what this replaces — made a BH plate *untypeable*: the leading `22` found no letter slot, so the
 * first two characters of a plate the user typed correctly were eaten before anything else landed.
 *
 * The series therefore has to be an explicit choice on screen. There is no reliable sniff: a plate is
 * often typed one character at a time, and `2` is a legal first keystroke in both series (a state code
 * cannot start with a digit, but a *partial* one being reshaped as BH mid-typing is exactly the
 * "invents data" failure `carryNumber` exists to prevent).
 */
export type PlateSeries = 'state' | 'bh'

/** `A` accepts a letter, `#` a digit. Anything else in a mask is not supported. */
export type NumberFormat =
  | { kind: 'digits'; digits: number; groups: number[] }
  | { kind: 'mask'; mask: string }
  /**
   * A vehicle registration. Not expressible as a `mask`, because both series have a *variable* run
   * (up to three series letters on a state plate) and because there are two of them — see above.
   */
  | { kind: 'plate'; series: PlateSeries }

/** Letters and digits only — the characters that carry meaning, as opposed to grouping spaces. */
export function significant(value: string): string {
  return value.replace(/[^0-9a-z]/gi, '').toUpperCase()
}

/**
 * How many significant characters a complete value has, or `null` where there is no single answer.
 *
 * **A plate returns `null` on purpose**, and the return type is what forces a caller to deal with it.
 * The two series are different lengths (a state plate runs to 11 significant characters, a BH plate to
 * 10) and a state plate's series letters are 1–3, so *no* number here would be true for both — a
 * "7 of 10" counter would be wrong for one of the two formats at all times. `numberHint` drops the
 * counter rather than picking a number and being wrong half the time.
 */
export function capacityOf(format: NumberFormat): number | null {
  if (format.kind === 'digits') return format.digits
  if (format.kind === 'mask') return format.mask.length
  return null
}

/**
 * The two plate series, as the row of chips the number field offers, in the order they are offered.
 * State first: it is the overwhelmingly common case and the default.
 */
export const PLATE_SERIES: readonly PlateSeries[] = ['state', 'bh']

export const PLATE_SERIES_LABEL: Record<PlateSeries, string> = {
  state: 'State series',
  bh: 'Bharat (BH)',
}

/** A real plate of each series — the placeholder, and what the field is compared against by eye. */
export const PLATE_EXAMPLE: Record<PlateSeries, string> = {
  state: 'KA 01 AB 1234',
  bh: '22 BH 1234 AA',
}

/** The shape shown beside the label, in the same `A`/`#` alphabet a mask uses. */
export const PLATE_SHAPE: Record<PlateSeries, string> = {
  state: 'AA ## AA ####',
  bh: '## BH #### AA',
}

/** One sentence naming the parts, because the shape alone does not say what an `AA` *is*. */
export const PLATE_HINT: Record<PlateSeries, string> = {
  state: 'State code, RTO number, series letters, then four digits — KA 01 AB 1234.',
  bh: 'Year, BH, four digits, then a letter pair — 22 BH 1234 AA. Valid in every state.',
}

/**
 * The two series as regular expressions over the *significant* characters.
 *
 * Every group is `{0,n}`, so the pattern matches every prefix a person types on the way to a whole
 * plate — which is the "never rejects a keystroke" promise, expressed as a quantifier rather than as a
 * special case. Overflow past the last group is dropped, exactly as a mask drops it.
 */
const PLATE_PATTERNS: Record<PlateSeries, RegExp> = {
  state: /^([A-Z]{0,2})(\d{0,2})([A-Z]{0,3})(\d{0,4})/,
  bh: /^(\d{0,2})([A-Z]{0,2})(\d{0,4})([A-Z]{0,2})/,
}

/**
 * A registration number, grouped for the chosen series.
 *
 * Groups are joined with a space and empty ones are dropped, so a half-typed plate never carries a
 * leading or doubled gap: `KA0` is `KA 0`, not `KA 0  `.
 */
export function formatPlate(series: PlateSeries, raw: string): string {
  const chars = significant(raw)
  const match = PLATE_PATTERNS[series].exec(chars)
  // Unreachable while every group is `{0,n}` — kept because a future pattern with a required group
  // would otherwise return `undefined` from a function typed to return a string.
  if (match === null) return chars
  return match
    .slice(1)
    .filter((group) => group !== undefined && group !== '')
    .join(' ')
}

/**
 * What survives when the user switches series mid-typing. **The same rule as `carryNumber`**, which
 * is what this delegates to rather than reimplementing: a reformat that would drop a significant
 * character clears the field, because a reshaped fragment wearing a real label is invented data.
 *
 * Concretely: a BH plate typed under the state series reformats to `22 BH 1234` — the trailing letter
 * pair has nowhere to go — so switching to BH keeps it and switching *away* from BH clears it.
 */
export function carryPlate(series: PlateSeries, draft: string): string {
  return carryNumber({ kind: 'plate', series }, draft)
}

/**
 * A preset's format, rebound to the series currently chosen — and unchanged for everything else.
 *
 * The preset table can only carry *a* default series (`presets.ts`, `Vehicle RC`), so this is what
 * lets one row of chips govern the field without the table knowing about wizard state. Anything that
 * is not a plate passes through untouched, so a call site never has to ask what kind it holds.
 */
export function withPlateSeries(
  format: NumberFormat | undefined,
  series: PlateSeries,
): NumberFormat | undefined {
  return format?.kind === 'plate' ? { kind: 'plate', series } : format
}

/**
 * The value as it should appear in the field after this keystroke.
 *
 * With no format, whitespace is collapsed and the value is capped at a length no real identifier
 * reaches — a guard against a paste of an entire PDF, not a validation rule.
 */
export function formatNumber(format: NumberFormat | undefined, raw: string): string {
  if (format === undefined) return raw.replace(/\s+/g, ' ').slice(0, 64)

  if (format.kind === 'plate') return formatPlate(format.series, raw)

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
  // A plate has no single length, so there is no honest count to show — see `capacityOf`. The field
  // still gets the series' shape and example beside its label, which is the part that teaches.
  if (want === null) return ''
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
  // A plate is written in capitals for the same reason a mask is, and `formatPlate` upper-cases it
  // anyway — so the keyboard should not open in lower case and then appear to correct itself.
  return format?.kind === 'mask' || format?.kind === 'plate' ? 'characters' : 'none'
}

/**
 * Whether a value **already saved** matches the shape a preset would impose.
 *
 * ═══════════════════════════════════════════════════════════════════════════════════════
 *  This is the guard that stops an edit form silently rewriting a stored number.
 * ═══════════════════════════════════════════════════════════════════════════════════════
 *
 * Formatting a saved value on load is only safe when it is lossless. It frequently is not: a document
 * titled "Passport" whose number is `FAKEM1234471` reformats under the `A#######` mask to `F1234471` —
 * eight characters where there were twelve, silently, on a value the user never touched. Save without
 * editing anything and the mangled version is what persists.
 *
 * So when a stored value does not fit, the field treats itself as **unformatted** for that document:
 * no reshaping on load, none while typing, and no completeness counter (which would otherwise report
 * "Complete" on twelve characters in an eight-character shape). The document's number demonstrably is
 * not in the preset's shape, which means the shape is the wrong thing to trust — not the number.
 *
 * An absent or empty value fits by definition: there is nothing to lose, and the user may be about to
 * type one that does conform.
 */
export function fitsShape(
  format: NumberFormat | undefined,
  stored: string | null | undefined,
): boolean {
  if (format === undefined) return true
  if (stored == null || stored === '') return true
  return significant(formatNumber(format, stored)) === significant(stored)
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
