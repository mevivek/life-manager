import { type Document, KIND_LABELS, type Thing } from '@life-manager/shared'
import { coverOf, serviceOf } from '@/features/things/CoverStatus'
import {
  type Expiry,
  expiryAccessibleName,
  expiryOf,
  formatDate,
  formatDateShort,
  needsYou,
  span,
} from './ExpiryStatus'
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

/**
 * ═══════════════════════════════════════════════════════════════════════════════════════
 *  THE HORIZON IS CROSS-DOMAIN. One timeline, two kinds of thing on it.
 * ═══════════════════════════════════════════════════════════════════════════════════════
 *
 * ADR-0029 and design.md §8: a thing's warranty end and its next service sit on the **same** timeline
 * as a document's expiry, and what separates them is **shape** — a square dot with a mono kicker for a
 * thing event, the existing round dot and no kicker for a document.
 *
 * Two section headers would have been the easy version and would have destroyed the one property Now
 * has: that it answers *"what is next"* without first asking which domain the answer lives in. A car's
 * MOT and a passport's expiry belong in one list (ADR-0025 §4), and so does the boiler's warranty.
 *
 * ── Why this lives in `features/documents` ──
 *
 * Because the Now screen's data lives here, in one module, and the alternative is a third folder whose
 * only job is to import from the other two. The dependency direction is the honest one: Now is a
 * *documents-shaped* screen that things join, so the merge reads Things and Things does not read this.
 *
 * ── What is deliberately NOT on the timeline ──
 *
 *  - **A `gone` thing.** things.md §4 rule 4: a warranty on somebody else's dishwasher is not your
 *    deadline. `lent` is *not* excluded — it is still yours and its dates still matter.
 *  - **Anything already past.** Cover that has ended, and a service already overdue. This is a
 *    *forward* timeline; the urgent live above it in Needs you, which today is documents-only.
 *  - **`cover.tag`** as the kicker. The tag says whether the thing is covered ("Covered", "Cover
 *    ends"); the kicker names **what the date is** ("Warranty ends"). Those are different sentences and
 *    reusing the tag would put the state where the event belongs.
 */

/**
 * The tone an entry's date line is drawn in.
 *
 * Three, not five, and `late` is absent **by construction**: everything past is either in Needs you or
 * excluded above, so nothing on a forward timeline can be late. If a fourth appears here, something is
 * putting history on the horizon.
 */
export type HorizonTone = 'ok' | 'soon' | 'quiet'

/**
 * One entry, already reduced to what `Horizon` draws.
 *
 * The view gets words and a tone **name**, never a Tailwind class — a class in a data module is a
 * design token that `cn()` cannot see and `utils.test.ts` cannot walk (design.md §1). The link target
 * is data rather than a rendered element so the entry stays a plain value and the component keeps the
 * only `<Link>`.
 */
export type HorizonEntry = {
  /** A stable React key. A thing contributes up to two entries, so its id alone is not unique. */
  key: string
  /** `YYYY-MM-DD`, the date this entry sorts on. */
  date: string
  /**
   * The mono uppercase eyebrow — `Warranty ends`, `Service due` — or **`null` for a document**.
   *
   * `null` is not "no words yet"; it is the distinction. A document needs no kicker because an expiry
   * is what this timeline is *by default*, and labelling it would make the two kinds symmetric when the
   * whole point is that one is the norm and one is the visitor.
   */
  kicker: string | null
  title: string
  /** `Identity · Ministry of External Affairs`, or `Appliance · Bosch`. May be empty. */
  meta: string
  /** `12 Sep 2026 · in 8 months` — the date FIRST, because on the horizon nothing is urgent. */
  when: string
  tone: HorizonTone
  /** Spelled out in words for both kinds — design.md §9. The glyph is `aria-hidden`. */
  accessibleName: string
} & ({ entity: 'document'; documentId: string } | { entity: 'thing'; thingId: string })

/**
 * Merges the document horizon and the things into one date-sorted timeline.
 *
 * `documentRows` is `Ledger.horizon` — already partitioned, so every one of them is `far` by
 * construction and none is urgent. `things` is whatever the Things request returned; **pass `[]` when
 * it failed**, which is what keeps the Now screen alive while that domain has no API (things.md §10).
 */
export function buildHorizon(
  documentRows: LedgerRow[],
  things: Thing[],
  today?: Date,
): HorizonEntry[] {
  const entries: HorizonEntry[] = []

  for (const { document, expiry } of documentRows) {
    // Non-null by partition: `expiry.state === 'none'` rows went to `undated`. Checked rather than
    // asserted, because `noNonNullAssertion` is a lint error and a silent skip is the safe failure.
    if (document.expires_on === null) continue
    entries.push({
      entity: 'document',
      documentId: document.id,
      key: `document:${document.id}`,
      date: document.expires_on,
      kicker: null,
      title: document.title,
      meta: [document.doc_type === 'other' ? null : capitalise(document.doc_type), document.issuer]
        .filter((part) => part !== null && part !== '')
        .join(' · '),
      when: `${formatDateShort(document.expires_on)} · ${expiry.label}`,
      tone: 'ok',
      accessibleName: expiryAccessibleName(document.title, document.expires_on, today),
    })
  }

  for (const thing of things) {
    // things.md §4 rule 4. `lent` is deliberately not excluded.
    if (thing.ownership === 'gone') continue

    const meta = [KIND_LABELS[thing.kind], thing.brand]
      .filter((part) => part !== null && part !== '')
      .join(' · ')

    /**
     * Cover, while it is still ahead.
     *
     * `days >= 0` rather than the comp's `days > 0` (its `buildHorizon`, line 1868). The comp drops a
     * warranty ending **today** off the timeline, which is the one day it is worth reading — and the
     * cover ladder deliberately has no `today` state to catch it either, because a lapsing warranty is
     * not a pulsing emergency (ADR-0029). So today's is included, quietly, and says "today".
     */
    const cover = coverOf(thing, today)
    if (thing.warranty_ends_on !== null && cover.days !== null && cover.days >= 0) {
      entries.push({
        entity: 'thing',
        thingId: thing.id,
        key: `thing:${thing.id}:warranty`,
        date: thing.warranty_ends_on,
        kicker: 'Warranty ends',
        title: thing.name,
        meta,
        when: `${formatDateShort(thing.warranty_ends_on)} · ${distance(cover.days)}`,
        // `ended` and `none` are unreachable behind the guard above.
        tone: cover.state === 'ending' ? 'soon' : 'ok',
        accessibleName: `${thing.name} — warranty ends ${distance(cover.days)}, ${formatDate(thing.warranty_ends_on)}`,
      })
    }

    /**
     * The next service, while it is still ahead.
     *
     * `scheduled` is `quiet` rather than `ok`, which is Agent-A's reasoning in `CoverStatus`'s
     * `SERVICE_TONE` and it is right: a service booked for next spring is a fact with no colour
     * attached, and spending `--status-ok` on it would put a second green thing on the timeline meaning
     * something different by it.
     */
    const service = serviceOf(thing, today)
    if (thing.service_due_on !== null && service !== null && service.days >= 0) {
      entries.push({
        entity: 'thing',
        thingId: thing.id,
        key: `thing:${thing.id}:service`,
        date: thing.service_due_on,
        kicker: 'Service due',
        title: thing.name,
        meta,
        when: `${formatDateShort(thing.service_due_on)} · ${distance(service.days)}`,
        tone: service.state === 'due' ? 'soon' : 'quiet',
        accessibleName: `${thing.name} — service due ${distance(service.days)}, ${formatDate(thing.service_due_on)}`,
      })
    }
  }

  /**
   * One sort, by the ISO date string.
   *
   * `YYYY-MM-DD` sorts lexicographically in date order, so this needs no `Date` at all — which also
   * sidesteps the timezone trap `formatDate`'s comment documents. `Array.sort` is stable, so entries on
   * the same day keep the order they were added: documents first, then a thing's warranty before its
   * service. Arbitrary, but *fixed*, which is what stops a re-render shuffling two rows.
   */
  return entries.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0))
}

/** `in 8 months`, or `today` — because `in 0 days` is not a sentence anybody writes. */
function distance(days: number): string {
  return days === 0 ? 'today' : `in ${span(days)}`
}

function capitalise(value: string): string {
  return value.length === 0 ? value : value[0]?.toUpperCase() + value.slice(1)
}
