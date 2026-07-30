import type { Document } from '@life-manager/shared'
import { type Expiry, expiryOf, needsYou } from './ExpiryStatus'
import { useDocuments } from './useDocuments'

/**
 * The Now screen's data, from **one** request.
 *
 * ═══════════════════════════════════════════════════════════════════════════════════════
 *  Why one query and a client-side partition, when the rest of the app filters server-side
 * ═══════════════════════════════════════════════════════════════════════════════════════
 *
 * `ExpiringSoon` used `?expiring_before=` and was right to: pushing a filter to the server is both
 * cheaper and, in that case, *more correct* (a null `expires_on` is not "expiring before" any date,
 * which is Q1's answer expressed as a query). So the deviation here needs a reason, and it is this:
 *
 * **"The horizon" needs a LOWER bound on `expires_on`, and the API has no filter for one.**
 * `documentListQuerySchema` offers `expiring_before` and nothing after. Getting the horizon
 * server-side would mean either a new query parameter (an API change, and a filter used by exactly
 * one screen) or a second overlapping request whose results have to be subtracted from the first —
 * which is the "two cards that duplicated each other" bug from `documents.md` §7 in a new costume.
 *
 * So: fetch one page sorted by `expires_on asc`, and partition it. The sort does the work — the API
 * returns `[expired…, today, near…, far…, no-expiry…]` in exactly that order, nulls last, so the
 * partition is a walk rather than three filters over the whole array.
 *
 * Three things fall out of this that are worth having:
 *
 *  - **One request instead of three** for a screen that previously fired two lists plus a push key.
 *  - **Exact totals** for the ledger footer, whenever the archive fits in one page — which is what
 *    `complete` reports. The API has no count endpoint, so this is the only honest route to "12
 *    documents".
 *  - **The whole archive lands in the offline cache** on a visit to Now, which is precisely
 *    ADR-0013's use case: checking a passport number in a queue with no signal.
 */

/**
 * 100 of a 200 maximum (`MAX_PAGE_LIMIT`).
 *
 * Chosen against the actual archive, not the limit: a personal document collection that passes 100
 * is already past the point where `documents.md` §9 says the `issuer` free-text decision gets
 * revisited. Past 100 the screen stays correct — `complete` goes false and the footer stops claiming
 * an exact total — so this degrades into vagueness rather than into being wrong.
 */
export const LEDGER_PAGE_LIMIT = 100

export type LedgerRow = { document: Document; expiry: Expiry }

export type Ledger = {
  /** Expired, expiring today, or inside 45 days. Soonest first. */
  needsYou: LedgerRow[]
  /** Everything dated beyond 45 days, soonest first. Not yet truncated — the view decides. */
  horizon: LedgerRow[]
  /** Documents with no expiry at all. A normal state, not a gap (Q1). */
  undated: LedgerRow[]
  /** Documents with no scan attached, across everything loaded. */
  withoutScan: Document[]
  /** How many documents carry a date we watch. */
  datedCount: number
  /** How many documents were loaded. Equals the archive total when `complete`. */
  loadedCount: number
  /**
   * Whether the whole archive fitted in one page. When false, every count above is a floor rather
   * than a total, and the footer must say so.
   */
  complete: boolean
}

/** The query key is fixed, so the tab bar's badge and the Now screen share one fetch. */
export function useLedger() {
  return useDocuments({ sort: 'expires_on', order: 'asc', limit: LEDGER_PAGE_LIMIT })
}

/** Partitions a loaded page into the shape the Now screen renders. */
export function toLedger(documents: Document[], nextCursor: string | null, today?: Date): Ledger {
  const needs: LedgerRow[] = []
  const horizon: LedgerRow[] = []
  const undated: LedgerRow[] = []

  for (const document of documents) {
    const expiry = expiryOf(document.expires_on, today)
    const row = { document, expiry }
    if (expiry.state === 'none') undated.push(row)
    else if (needsYou(expiry)) needs.push(row)
    else horizon.push(row)
  }

  return {
    needsYou: needs,
    horizon,
    undated,
    withoutScan: documents.filter((document) => document.file_count === 0),
    datedCount: needs.length + horizon.length,
    loadedCount: documents.length,
    complete: nextCursor === null,
  }
}
