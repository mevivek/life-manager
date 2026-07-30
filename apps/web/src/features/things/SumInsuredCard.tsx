import type { Document, Thing } from '@life-manager/shared'
import { Link } from '@tanstack/react-router'
import { Eyebrow } from '@/components/ui/label'
import { useLedger } from '@/features/documents/useLedger'
import { cn } from '@/lib/utils'
import { formatMoney } from './money'

/**
 * Sum insured — **the one genuinely cross-domain read in the app.** things.md §7, ADR-0029.
 *
 * It totals what the user paid for the things they still own and measures it against the sum insured on
 * their contents-insurance policy. That number lives in a **document's** `custom_attrs`
 * (`financialAttrs.value` + `currency`), which is why this card reads Documents from a Things screen.
 *
 * ═══════════════════════════════════════════════════════════════════════════════════════
 *  Drawn ONLY when a policy is found, so the common case is absent rather than wrong.
 * ═══════════════════════════════════════════════════════════════════════════════════════
 *
 * That is the design's own instruction and it is the whole safety property. A card that guessed at a
 * policy would put a confident number about somebody's insurance cover on the screen — the one class of
 * mistake this app cannot afford, because the person reading it would act on it.
 *
 * ── Why the client computes this, and what it costs ──
 *
 * ADR-0029 considered a server-computed field and rejected it for now: it would mean the Things service
 * reading the Documents repository. The cost is stated there and repeated here because it reaches the
 * user — **this number is only as complete as the page loaded.** It is exactly the `complete` caveat
 * the Now footer carries: `useLedger` fetches 100 documents and `useThings` a page of things, so past
 * either limit the total is a floor. The footer line says so rather than hiding it.
 *
 * ── It costs no extra request ──
 *
 * `useLedger()` is the fixed query key the Now screen and `TabBar` already fetch, so TanStack Query
 * serves this from that same fetch (its own comment explains why it takes no parameters — the shared
 * key *is* the deduplication). A narrow `useDocuments({ type: ['financial'] })` would be a second
 * request for data already in the cache.
 */

/**
 * How the contents policy is identified — and it is deliberately not a title match.
 *
 * A hard-coded `title === 'Contents insurance'` would work on exactly one archive: the maintainer's,
 * in English, spelled that way. The comp gets to do that because a prototype only has to look right.
 *
 * So the rule is structural first and lexical second:
 *
 *  1. **Structural** — a `financial` document carrying both a `value` and a `currency` in
 *     `custom_attrs`. That is the shape of "a policy with a sum insured" and it is the only shape the
 *     arithmetic can use at all.
 *  2. **Lexical, as a tie-break** — among those, prefer one whose title *or tags* mention contents.
 *     A household with a life policy and a contents policy has two structural matches, and this is
 *     what picks the right one.
 *  3. **Otherwise, only if there is exactly one.** One structural match with no hint is unambiguous, so
 *     it is used. Two with no hint is a guess, and a guess renders **nothing** — which is the honest
 *     answer and the one the design asks for.
 *
 * `CONTENTS_HINTS` are words rather than a full title, and matched case-insensitively as substrings, so
 * "Home contents insurance", "contents cover" and a `#contents` tag all hit.
 */
const CONTENTS_HINTS = ['contents', 'household']

type Policy = { document: Document; value: string; currency: string }

export function findContentsPolicy(documents: Document[]): Policy | null {
  const candidates: Policy[] = []

  for (const document of documents) {
    if (document.doc_type !== 'financial') continue
    /**
     * `custom_attrs` is `Record<string, unknown>` on the wire — the per-type schema is applied
     * server-side once the effective `doc_type` is known (`validateCustomAttrs`), so a client reading
     * it has to narrow rather than trust. Both a decimal string and a 3-letter currency are required:
     * a value with no currency cannot be formatted, and formatting it with a guessed symbol is how the
     * comp's hardcoded `£` would come back.
     */
    const value = document.custom_attrs['value']
    const currency = document.custom_attrs['currency']
    if (typeof value !== 'string' || typeof currency !== 'string') continue
    if (Number.isNaN(Number(value))) continue
    candidates.push({ document, value, currency })
  }

  const hinted = candidates.filter((candidate) => mentionsContents(candidate.document))
  if (hinted.length > 0) return hinted[0] ?? null
  // Exactly one, or nothing. See rule 3 above — two unhinted policies is a guess, not a shortlist.
  return candidates.length === 1 ? (candidates[0] ?? null) : null
}

function mentionsContents(document: Document): boolean {
  const haystack = [document.title, ...document.tags].join(' ').toLowerCase()
  return CONTENTS_HINTS.some((hint) => haystack.includes(hint))
}

export function SumInsuredCard({
  things,
  className,
}: {
  /** The things loaded on this screen. `gone` rows are excluded here, not by the caller. */
  things: Thing[]
  className?: string
}) {
  const ledger = useLedger()
  const policy = findContentsPolicy(ledger.data?.data ?? [])
  if (policy === null) return null

  const total = totalInsurable(things, policy.currency)
  const covered = toMinorUnits(policy.value)
  const short = total.minorUnits > covered

  /**
   * `?? ''` is unreachable: `formatMoney` returns `null` only for an absent amount, and
   * `fromMinorUnits` always produces one. Written rather than asserted because `noNonNullAssertion` is
   * a lint error and an empty string in a figure slot is a visible bug, not a crash.
   */
  const format = (minorUnits: number) =>
    formatMoney(fromMinorUnits(minorUnits), policy.currency) ?? ''

  return (
    /**
     * The whole card is a `<Link>` to the policy, because "what am I measured against" is the next
     * question this card provokes and the answer is one document away. A `<div onClick>` would not be
     * focusable, would not announce as a link, and could not be opened in a new tab.
     *
     * A hairline, not a shadow — design.md §5. Nothing on a list screen is temporarily on top of
     * anything.
     */
    <Link
      to="/documents/$documentId"
      params={{ documentId: policy.document.id }}
      className={cn(
        // `p-card` rather than the comp's literal 13/15px: it is the token the DENSITY preference
        // moves (design.md §12), and a card that ignores it is a card that stays generous in compact.
        'block rounded-3 border border-rule-2 bg-raised p-card transition-colors hover:bg-sunken active:bg-sunken',
        className,
      )}
    >
      <span className="flex items-baseline justify-between gap-2.5">
        <Eyebrow>Sum insured</Eyebrow>
        {/*
          The policy's own title, where the comp hardcodes "Contents insurance". The card was found by
          a hint rather than by that string, so printing the string back would be the app telling the
          user what it decided instead of what it read.
        */}
        <span className="min-w-0 truncate text-meta text-ink-3">{policy.document.title}</span>
      </span>

      <span className="mt-2 flex flex-wrap items-baseline gap-2">
        {/* Mono, because this is a figure rather than prose — design.md §3. `text-number` (19px) where
            the comp draws 21px: the nearest token, and there is no case for a new one. */}
        <span className="font-mono text-number font-medium">{format(total.minorUnits)}</span>
        <span className="text-meta text-ink-3">of things filed vs {format(covered)} covered</span>
      </span>

      {/*
        The fill bar. `aria-hidden` — the two figures above it are the truth, and the sentence below
        states the outcome; a bar announced as "84 percent" would be a third description of the same
        fact.

        The arbitrary values are the two design.md §1 permits: the width IS the datum, and 5px/3px is
        a glyph's geometry — a `--spacing-*` step would round a hairline bar out of existence.
      */}
      <span
        aria-hidden="true"
        className="mt-2.5 block h-[5px] overflow-hidden rounded-[3px] bg-rule-2"
      >
        <span
          className={cn('block h-full rounded-[3px]', short ? 'bg-status-soon' : 'bg-status-ok')}
          style={{ width: `${fillPercent(total.minorUnits, covered)}%` }}
        />
      </span>

      {short ? (
        /**
         * Over-cover is `--status-soon` and **says the shortfall in money**, because "you are
         * over-insured by an unspecified amount" is not actionable. This is the one thing on the card
         * that spends colour, and it earns it: it is a status.
         */
        <span className="mt-2 block text-meta font-medium leading-relaxed text-status-soon">
          {format(total.minorUnits - covered)} more than the policy covers
        </span>
      ) : (
        <span className="mt-2 block text-meta leading-relaxed text-ink-3">
          Within cover. Things you’ve handed on don’t count toward this
          {total.skipped > 0
            ? // Named rather than silently folded in: a total mixing currencies is a false number, and
              // a total that quietly dropped rows is a false number the user cannot see.
              `, and ${total.skipped} ${total.skipped === 1 ? 'thing is' : 'things are'} priced in another currency`
            : ''}
          .
        </span>
      )}
    </Link>
  )
}

/**
 * The total, in the policy's currency's minor units.
 *
 * ── Two exclusions, and both are business rules from things.md §4 rule 4 ──
 *
 *  - **`gone` does not count.** You no longer own it, so insuring it is meaningless. `lent` *does* —
 *    it is still yours and elsewhere.
 *  - **A different currency does not count**, and is reported instead. Adding ₹ to £ would produce a
 *    number that is wrong in a way nobody can see; there is no rate here and inventing one would be
 *    the worst option of the three.
 */
function totalInsurable(
  things: Thing[],
  currency: string,
): { minorUnits: number; skipped: number } {
  let minorUnits = 0
  let skipped = 0

  for (const thing of things) {
    if (thing.ownership === 'gone') continue
    if (thing.price === null) continue
    if (thing.currency !== currency) {
      skipped++
      continue
    }
    minorUnits += toMinorUnits(thing.price)
  }

  return { minorUnits, skipped }
}

/**
 * `"14200.50"` → `1420050`.
 *
 * Summed in **minor units as integers**, never as floats: `0.1 + 0.2` is the canonical reason
 * conventions/data.md §4 stores money as `numeric` and a decimal string, and a client that parses it
 * straight to a `Number` and adds thirty of them reintroduces the drift the column type exists to
 * avoid.
 *
 * Two decimal places are assumed, which is right for every currency the app has seen and wrong for
 * JPY (0) and KWD (3). The consequence is bounded and cosmetic — the *ratio* the bar draws is
 * unaffected, since both sides go through this same function — and fixing it properly means a minor-unit
 * table, which is Money's business if it ever arrives.
 */
function toMinorUnits(decimal: string): number {
  const [whole = '0', fraction = ''] = decimal.trim().split('.')
  const cents = `${fraction}00`.slice(0, 2)
  const sign = whole.startsWith('-') ? -1 : 1
  return sign * (Math.abs(Number(whole)) * 100 + Number(cents))
}

/**
 * Back to a decimal string, so the shared formatter can take it.
 *
 * ── The formatting itself is `money.ts`'s job, not this file's ──
 *
 * `formatMoney` there already does the part that matters — the symbol comes from the record's stored
 * currency and never from a hardcoded `£` (the comp's `gbp()` helper) — and it handles the case a
 * private copy here would have got wrong: `Intl` throws `RangeError` on a currency code it does not
 * recognise, which from a render would take the whole screen down at the root error boundary for a
 * three-letter typo. Two `formatMoney`s in one folder is also exactly the duplication that lets one of
 * them quietly stop agreeing with the other.
 *
 * What stays here is the **summing**, because that is the part with a correctness requirement rather
 * than a presentation one — see `toMinorUnits`.
 */
function fromMinorUnits(minorUnits: number): string {
  const sign = minorUnits < 0 ? '-' : ''
  const absolute = Math.abs(minorUnits)
  return `${sign}${Math.floor(absolute / 100)}.${String(absolute % 100).padStart(2, '0')}`
}

/** The bar caps at 100: past the policy the *sentence* carries the overage, not a bar overflowing. */
function fillPercent(total: number, covered: number): number {
  if (covered <= 0) return 0
  return Math.min(100, Math.round((total / covered) * 100))
}
