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
): string | null {
  if (amount == null || amount.trim() === '') return null

  const value = Number(amount)
  if (!Number.isFinite(value)) return amount

  if (currency == null || currency.trim() === '') {
    // No symbol, no code, no guess — just the number, grouped so it is readable.
    return new Intl.NumberFormat(undefined, { maximumFractionDigits: 2 }).format(value)
  }

  try {
    return new Intl.NumberFormat(undefined, { style: 'currency', currency }).format(value)
  } catch {
    /**
     * `Intl` throws `RangeError` on a currency code it does not recognise, and a thrown formatter
     * would take the whole screen down at the root error boundary for a three-letter typo. Falling
     * back to `1,234.56 XYZ` keeps both facts on screen and loses only the symbol.
     *
     * Deliberately not swallowed silently: the code is still printed, so the bad value is visible
     * rather than hidden (conventions/code.md §6).
     */
    return `${new Intl.NumberFormat(undefined, { maximumFractionDigits: 2 }).format(value)} ${currency}`
  }
}
