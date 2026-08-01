/**
 * The mask a hidden number wears — `•••• 8109`.
 *
 * ═══════════════════════════════════════════════════════════════════════════════════════
 *  Derived on the CLIENT, from the full value. There is no `*_last4` field any more.
 * ═══════════════════════════════════════════════════════════════════════════════════════
 *
 * `documents.identifier_last4` and `things.serial_last4` used to carry this, computed server-side on
 * every write so a client could not send a mask that disagreed with its own number. That guarantee
 * stopped being worth a column the moment ADR-0027 put the **full** value on every response: the two
 * fields travelled together, from the same row, so they could not disagree — and the second one was a
 * copy of the last four characters of the first. ADR-0036 dropped both columns and moved the last
 * remaining reader here.
 *
 * One function for both domains rather than one per feature, because the two masks must look
 * identical: a document's number and a thing's serial sit on the same library list.
 */
export function maskedNumber(value: string): string {
  return `•••• ${value.slice(-4)}`
}
