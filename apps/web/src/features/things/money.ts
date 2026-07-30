/**
 * Money, formatted from the two fields the contract actually stores.
 *
 * ═══════════════════════════════════════════════════════════════════════════════════════
 *  Never hardcode a currency symbol. The comp does, and it is wrong to copy it.
 * ═══════════════════════════════════════════════════════════════════════════════════════
 *
 * `Life-Manager-handoff-4.dc.html` writes `"£" + n.toLocaleString("en-GB")` in its `gbp()` helper,
 * because its fixtures are British. The app is not: `conventions/data.md` §4 is the reason `price` is a
 * `numeric` **plus** a `char(3)` currency, and `things.md` §8 names those two columns as Money's future
 * join point. A hardcoded `£` would render a rupee price as pounds — a wrong number, not a wrong
 * decoration, and the number an insurer asks for.
 *
 * So the currency comes from the record and `Intl.NumberFormat` decides the symbol, the position and
 * the grouping. Where the currency is missing the amount is printed **bare**, never guessed: an amount
 * with no currency is incomplete data, and inventing a symbol for it would hide that.
 */

/**
 * `('45999.00', 'INR')` → `₹45,999.00`. Returns `null` when there is no amount to show, so a caller
 * can draw absence rather than an empty string.
 *
 * ── Why `Number()` and not the string ──
 *
 * `decimalStringSchema` keeps money as a string precisely so no arithmetic is done on it. This does
 * none: it converts once, at the edge, for display. A double is exact for every integer up to 2^53, so
 * any price a household could plausibly have paid — in paise, cents or yen — round-trips unchanged.
 * (`Intl.NumberFormat#format` does accept a numeric string in current engines, but its TypeScript
 * signature depends on which `lib` the project pulls in, and a type error here would be a worse trade
 * than a conversion that is provably lossless in range.)
 *
 * A non-numeric amount returns the raw string rather than `NaN`. The server validates the shape, so
 * this only fires for something a stale cache handed us (debt D46) — and showing the odd value is more
 * use than showing "NaN".
 */
export function formatMoney(
  amount: string | null | undefined,
  currency: string | null | undefined,
  /**
   * `'whole'` drops the minor units — `£24,601` rather than `£24,600.50`.
   *
   * The comp's `gbp()` (line 1891) is `"£" + Math.round(n).toLocaleString("en-GB")`, and every figure
   * it feeds is a **total** on the Sum insured card. That is the right call for a total and the wrong
   * one for a price: an aggregate of eight things to the penny is false precision that makes the
   * number harder to read and no more accurate, while "Paid" on a thing is a single amount off a
   * receipt and the pence are part of it. So this is per-call rather than a global default.
   *
   * `Intl` rounds half away from zero here, which is what `Math.round` does for positive values — and
   * every value this sees is positive.
   */
  precision: 'exact' | 'whole' = 'exact',
): string | null {
  if (amount == null || amount.trim() === '') return null

  const value = Number(amount)
  if (!Number.isFinite(value)) return amount

  const digits = precision === 'whole' ? { minimumFractionDigits: 0, maximumFractionDigits: 0 } : {}

  if (currency == null || currency.trim() === '') {
    // No symbol, no code, no guess — just the number, grouped so it is readable.
    return new Intl.NumberFormat(undefined, { maximumFractionDigits: 2, ...digits }).format(value)
  }

  try {
    return new Intl.NumberFormat(undefined, { style: 'currency', currency, ...digits }).format(
      value,
    )
  } catch {
    /**
     * `Intl` throws `RangeError` on a **malformed** currency code — anything that is not three
     * letters — and a thrown formatter takes the whole screen down at the root error boundary over a
     * typo in one field.
     *
     * Note what does **not** throw: a well-formed code `Intl` has never heard of. `'ZZZ'` formats as
     * `ZZZ 1,000.00` all by itself, which is already the honest rendering — so this branch is
     * narrower than it looks, and only fires for a value `currencySchema` (`^[A-Z]{3}$`) would have
     * rejected anyway. It exists because the persisted cache can hand this component a record an
     * older build wrote (debt D46), and a screen that crashes on a bad three-character string is a
     * worse outcome than one that prints it.
     *
     * Deliberately not swallowed silently: the code is still printed, so the bad value stays visible
     * rather than being hidden (conventions/code.md §6).
     */
    return `${new Intl.NumberFormat(undefined, { maximumFractionDigits: 2 }).format(value)} ${currency}`
  }
}
