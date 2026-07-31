import type { Document, Thing } from '@life-manager/shared'

/**
 * The merge that makes **All** one list rather than two lists stacked.
 * [ADR-0032](../../../../docs/decisions/0032-one-library-tab.md).
 *
 * ═══════════════════════════════════════════════════════════════════════════════════════
 *  One question, one order: what bites first.
 * ═══════════════════════════════════════════════════════════════════════════════════════
 *
 * The library's whole claim is that a household's records are one pile, so the combined view is
 * ordered by **the date that will need attention soonest** — not by domain, and not by when a record
 * was filed. A passport expiring in March and a car service due in February interleave; sectioning
 * them by kind would rebuild the two screens this ADR merged, one scroll further down.
 *
 * That is the same principle Now is built on (design.md §8: *"a car's MOT and a passport's expiry
 * belong in one list"*), applied to the archive. The difference is only that Now shows the near
 * horizon and this shows everything.
 */

export type LibraryRow =
  | { kind: 'document'; id: string; document: Document }
  | { kind: 'thing'; id: string; thing: Thing }

/**
 * A document's sort date: its expiry, or nothing.
 *
 * A document with no expiry is not *late*, it is undated — Q1 made expiry-only reminders a decision
 * rather than a default ([open-questions.md](../../../../docs/product/open-questions.md) §2), and a
 * document that never expires is a completely normal thing to own. So it sorts to the end rather than
 * being treated as overdue, which is what a `0` or an empty string would have done.
 */
function documentWhen(document: Document): string | null {
  return document.expires_on
}

/**
 * A thing's sort date: **whichever of cover-end and service-due comes first.**
 *
 * Not `warranty_ends_on` alone. A thing carries two independent clocks and either can be the next
 * thing to deal with — a car whose warranty ran out years ago still has a service due next month, and
 * sorting it by the dead warranty would bury the live date underneath every document in the archive.
 *
 * `null` when it has neither, which is most things: a sofa has no cover and no service, and it sorts
 * to the end beside the undated documents. That is correct — it is not overdue, it simply has no date
 * anyone is waiting on.
 */
function thingWhen(thing: Thing): string | null {
  const dates = [thing.warranty_ends_on, thing.service_due_on].filter(
    (date): date is string => date !== null,
  )
  if (dates.length === 0) return null
  // ISO dates sort lexicographically, so `Math.min` over parsed timestamps buys nothing and would
  // reintroduce timezone handling this file otherwise does not need.
  return dates.sort()[0] ?? null
}

/** What a row is named, for the tie-break. */
function rowName(row: LibraryRow): string {
  return row.kind === 'document' ? row.document.title : row.thing.name
}

/** What a row is dated by. Exported for the tests, which assert the two clocks separately. */
export function rowWhen(row: LibraryRow): string | null {
  return row.kind === 'document' ? documentWhen(row.document) : thingWhen(row.thing)
}

/**
 * Interleave documents and things into one dated list.
 *
 * ── Undated records go last, not first ──
 *
 * `null` sorts after every date rather than before it. The obvious implementation — substituting an
 * empty string or a `0` for "no date" — puts every undated record at the *top*, which reads as "these
 * nine things are the most urgent" about a marriage certificate and a sofa. The sentinel is a far
 * future instead, and it is applied at comparison time so nothing downstream can mistake it for data.
 *
 * ── The tie-break is the name, and it is not decoration ──
 *
 * Without it, two records sharing a date (common: a policy and the thing it covers, filed the same
 * day) would order by whichever list they arrived in, and the list would **reshuffle between renders**
 * as the two queries resolve in different orders. `localeCompare` rather than `<`, so accented and
 * non-Latin names sort the way the user reads them rather than by code point.
 */
export function mergeRows(documents: readonly Document[], things: readonly Thing[]): LibraryRow[] {
  const rows: LibraryRow[] = [
    ...documents.map((document): LibraryRow => ({ kind: 'document', id: document.id, document })),
    ...things.map((thing): LibraryRow => ({ kind: 'thing', id: thing.id, thing })),
  ]

  return rows.sort((left, right) => {
    const a = rowWhen(left)
    const b = rowWhen(right)
    if (a !== b) {
      if (a === null) return 1
      if (b === null) return -1
      return a < b ? -1 : 1
    }
    return rowName(left).localeCompare(rowName(right))
  })
}
