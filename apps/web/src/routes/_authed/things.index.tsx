import { KIND_LABELS, type Thing, type ThingKind, thingKindSchema } from '@life-manager/shared'
import { createFileRoute, useNavigate } from '@tanstack/react-router'
import { z } from 'zod'
import { DomainSwitcher } from '@/components/DomainSwitcher'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { Chip } from '@/components/ui/chip'
import { ScreenSkeleton } from '@/components/ui/skeleton'
import { useAddSheet } from '@/features/documents/AddSheetProvider'
import { coverOf } from '@/features/things/CoverStatus'
import { SumInsuredCard } from '@/features/things/SumInsuredCard'
import { ThingRow } from '@/features/things/ThingRow'
import { useThings } from '@/features/things/useThings'

/**
 * The Things list. things.md §7, ADR-0029 — the sibling of `documents.index.tsx`.
 *
 * ═══════════════════════════════════════════════════════════════════════════════════════
 *  The API does not exist yet, so the ERROR state is the one that actually renders.
 * ═══════════════════════════════════════════════════════════════════════════════════════
 *
 * things.md §10: there are no `things` tables, no repository, no service and no routes. Every call
 * 404s against the deployed API today. That is deliberate — the contract and the screens land first so
 * the API session implements `packages/shared/src/things.ts` rather than a second guess at it — and it
 * means the error branch below is not a rarely-exercised corner. It is the default view. See its
 * comment for why it is drawn calm rather than alarmed.
 *
 * ── Filters live in the URL, not in component state ──
 *
 * The same reasoning as the archive: a back-navigation from a thing should return to the filtered list
 * the user was reading, and a filter in a child's `useState` has no address. `validateSearch` is a Zod
 * schema, so a hand-edited URL is coerced rather than trusted.
 */

/**
 * ── This is NOT `thingListQuerySchema` ──
 *
 * The wire schema is `z.strictObject` with `repeatable()` arrays and a `cursor`; this describes *the
 * UI's* state, which is one value per filter and no cursor. `toQuery` maps one to the other, in one
 * place.
 *
 * `.default('')` **and** `.catch('')` on every field, and both are needed — the archive's schema
 * carries the same pair and the same note:
 *
 *  - `.default` makes the field optional on the way *in*, so `<Link to="/things">` with no search
 *    params typechecks. Without it the router demands all three on every link to this route, including
 *    `DomainSwitcher`'s.
 *  - `.catch` makes it total on the way *out*, so `?ownership=maybe` from a hand-edited URL lands on an
 *    unfiltered list rather than throwing a route error at someone who mistyped.
 */
const searchSchema = z.object({
  /** One kind, matching the comp's single-select chip row. The wire parameter is repeatable. */
  kind: z.string().default('').catch(''),
  /** `mine` or a holder's name — the same three states and the same sentinel as the archive's. */
  who: z.string().default('').catch(''),
  ownership: z.enum(['', 'here', 'lent', 'gone']).default('').catch(''),
})

export const Route = createFileRoute('/_authed/things/')({
  component: ThingsPage,
  validateSearch: searchSchema,
})

type Filters = z.infer<typeof searchSchema>

/**
 * 100, matching `LEDGER_PAGE_LIMIT`.
 *
 * A household's things pass 100 later than its documents do, and past it the screen stays *correct*
 * rather than becoming wrong: the count gains a `+` and the sum insured's footer says the total is a
 * floor. There is no "load more" here yet because there is no API to page.
 */
const PAGE_SIZE = 100

/** The base query — unfiltered, so it is also the source for "which kinds exist". */
const BASE_QUERY = { sort: 'name', order: 'asc', limit: PAGE_SIZE } as const

function toQuery(filters: Filters) {
  return {
    ...BASE_QUERY,
    ...(filters.kind === '' ? {} : { kind: [filters.kind as ThingKind] }),
    ...(filters.who === '' ? {} : { holder: filters.who }),
    ...(filters.ownership === '' ? {} : { ownership: [filters.ownership] }),
  }
}

function hasAnyFilter(filters: Filters): boolean {
  return filters.kind !== '' || filters.who !== '' || filters.ownership !== ''
}

function ThingsPage() {
  const filters = Route.useSearch()
  const navigate = useNavigate({ from: Route.fullPath })
  // The THING track — design.md §8, each domain keeps its own Add. See the pill's comment.
  const { openAddThing } = useAddSheet()

  /**
   * Two reads of the same endpoint, and with no filter active they are **one fetch**.
   *
   * `all` is unfiltered and answers two questions the filtered list cannot: the total for the header,
   * and which kinds actually exist so the chip row offers only those (the comp does the same). Offering
   * every one of the ten kinds would mean nine chips that produce a confidently empty list; deriving
   * them from the *filtered* page instead would make the control's own options vanish as you use it —
   * the same trap the archive's tag filter avoids by reading the unfiltered ledger.
   *
   * When no filter is set, `toQuery` returns `BASE_QUERY` and TanStack Query serves both hooks from a
   * single request, because the key is the query object.
   */
  const query = toQuery(filters)
  const all = useThings(BASE_QUERY)
  const list = useThings(query)

  const everything = all.data?.data ?? []
  const shown = list.data?.data ?? []
  const total = everything.length
  const complete = all.data?.next_cursor === null

  return (
    <div>
      {/*
        The header does not scroll away: the switcher and the chips are how you navigate the list, and
        losing them at the top of a long one means scrolling back up to change your mind.

        The negative gutter margins let the `--paper` ground and the bottom hairline run full-bleed
        while the content stays on the gutter.
      */}
      <div className="-mx-gutter sticky top-0 z-30 border-b border-rule bg-paper px-gutter pb-3">
        <div className="flex items-baseline gap-2">
          <h1 className="font-heading text-title font-face-h leading-tight">Things</h1>
          <span className="text-body text-ink-3">
            {all.isPending
              ? ''
              : hasAnyFilter(filters)
                ? // Both numbers are knowable here — unlike the archive, where a filtered count has no
                  // unfiltered total to sit beside — because the unfiltered page is already loaded.
                  `${shown.length} of ${total}${complete ? '' : '+'}`
                : `${total}${complete ? '' : '+'}`}
          </span>
        </div>

        {/*
          The domain switcher, not a fourth tab. design.md §8 and ADR-0029 — the comp draws both and
          defaults to a tab; `TabBar`'s block comment is where the argument against that lives.
        */}
        <DomainSwitcher current="things" className="mt-3" />

        {/* Absent unless a contents policy is found, which is most of the time. See the component. */}
        <SumInsuredCard things={everything} className="mt-3" />

        <KindFilter
          kinds={kindsPresent(everything)}
          selected={filters.kind}
          onSelect={(kind) =>
            // `replace` so flipping through chips does not stack a history entry each time —
            // otherwise the back button walks the user chip by chip out of their own filter.
            void navigate({ search: { ...filters, kind }, replace: true })
          }
        />
      </div>

      {list.isPending ? (
        /*
          First paint only (design.md §6). A refetch keeps the stale list and dims nothing: replacing
          real content with shimmer is how a working app looks broken.

          `ScreenSkeleton`, NOT `DocumentListSkeleton` — same geometry, honest label. The latter's live
          region announces "Loading documents", which is the exact bug its own comment warns about: a
          skeleton naming the wrong domain is a screen reader being told something false while it waits.
        */
        <ScreenSkeleton />
      ) : list.isError ? (
        <ThingsError message={list.error.message} onRetry={() => void list.refetch()} />
      ) : shown.length === 0 ? (
        <EmptyThings
          filtered={hasAnyFilter(filters)}
          onClear={() =>
            void navigate({ search: { kind: '', who: '', ownership: '' }, replace: true })
          }
        />
      ) : (
        <>
          {shown.map((thing) => (
            <ThingRow
              key={thing.id}
              thing={thing}
              // Full-bleed rows with a rule below each, so the list reads as a ledger page rather than
              // a stack of cards. The negative margin undoes the shell's gutter for the rule only.
              className="-mx-gutter border-b border-rule px-gutter"
            />
          ))}
          <ThingsFooter things={shown} complete={complete} />
        </>
      )}

      {/*
        Room for the pill at the end of the list. The shell's bottom padding clears the tab bar, but the
        pill sits *above* the bar — so without this the last row is permanently under it, and the one
        row you cannot reach is alphabetically last.
      */}
      <div aria-hidden="true" className="h-[4.875rem]" />

      {/*
        ═══════════════════════════════════════════════════════════════════════════════════
         The Add pill. **A hairline, not a shadow**, and it opens the THING track.
        ═══════════════════════════════════════════════════════════════════════════════════

        `fixed` rather than `absolute`, because the design positions it against the viewport and this
        page's own box is as tall as the list. The comp draws `0 8px 24px rgba(10,10,9,.24)`, which would
        make it the third thing in the app to cast a shadow — design.md §5 allows exactly two, the sheet
        and the toast, on the grounds that a shadow means "temporarily on top of your life". A permanent
        control is not that, and the ink fill already separates it from any ground it crosses.

        `openAddThing`, not `openAdd`. design.md §8: **each domain keeps its own Add**, because inside a
        domain the answer to "what are you adding" is already known — so the pill row swaps the
        collection *and* what the Add button captures (ADR-0030). Reusing the document opener here would
        put the wrong wizard on the right screen, which is worse than no pill: the user taps Add on
        Things and is asked for a document type.
      */}
      <button
        type="button"
        onClick={openAddThing}
        className="fixed right-gutter bottom-[calc(env(safe-area-inset-bottom)+6.5rem)] z-40 flex min-h-[3.25rem] items-center gap-2.5 rounded-pill border border-ink bg-ink pr-5 pl-4 text-head text-onink active:opacity-90"
      >
        <span aria-hidden="true" className="relative block size-4">
          <span className="absolute top-[7px] left-0 h-[2.5px] w-4 rounded-[1px] bg-current" />
          <span className="absolute top-0 left-[7px] h-4 w-[2.5px] rounded-[1px] bg-current" />
        </span>
        Add
      </button>
    </div>
  )
}

/**
 * The kind chips — `All` first, then only the kinds that actually appear.
 *
 * A `<fieldset>` with a `<legend>`, not a `div role="group"` (design.md §6): the legend is announced
 * before each pill, so a screen reader says "Kind, Vehicle" rather than a bare "Vehicle" — which on a
 * screen that also has a domain switcher and a policy card is genuinely ambiguous.
 *
 * Horizontally scrolling rather than wrapping. Nine kinds wrapped onto three lines would push the
 * first row of results below the fold on a 390px screen, and the filter row is not the content.
 */
function KindFilter({
  kinds,
  selected,
  onSelect,
}: {
  kinds: ThingKind[]
  selected: string
  onSelect: (kind: string) => void
}) {
  // One kind means one chip and an "All" that does nothing — the same "draw it the day it is needed"
  // rule as the switcher itself.
  if (kinds.length < 2) return null

  return (
    // `min-w-0` because a fieldset defaults to `min-width: min-content`, which stops the row
    // scrolling and lets it push the page sideways instead — the same fix `DocumentForm` needed.
    <fieldset className="-mx-gutter mt-3 flex min-w-0 gap-[7px] overflow-x-auto border-0 px-gutter pb-0.5">
      <legend className="sr-only">Kind</legend>
      <Chip size="sm" selected={selected === ''} onClick={() => onSelect('')}>
        All
      </Chip>
      {kinds.map((kind) => (
        <Chip
          key={kind}
          size="sm"
          selected={selected === kind}
          // Tapping the selected chip clears it, which is the same gesture the archive's type filter
          // uses — a chip row with no "off" makes the first tap irreversible.
          onClick={() => onSelect(selected === kind ? '' : kind)}
        >
          {KIND_LABELS[kind]}
        </Chip>
      ))}
    </fieldset>
  )
}

/**
 * Which kinds are present, in the contract's order.
 *
 * `thingKindSchema.options` rather than the order they happen to appear in the page: that order is
 * rough frequency of ownership (see the note on `KIND_LABELS`), so the common case stays near the
 * start of the row and the row does not reshuffle when a thing is added.
 */
function kindsPresent(things: Thing[]): ThingKind[] {
  const present = new Set(things.map((thing) => thing.kind))
  return thingKindSchema.options.filter((kind) => present.has(kind))
}

/**
 * The error state — **calm, because today it is the normal state** (things.md §10).
 *
 * A plain `Card` rather than `tone="late"`: the status tints are spent on a document's expiry and a
 * thing's cover (design.md §4), and a red panel here would say something urgent about the user's data
 * when the truth is that a screen was shipped before its endpoints. It names what failed, shows the
 * message rather than swallowing it, and offers the one action that can help.
 */
function ThingsError({ message, onRetry }: { message: string; onRetry: () => void }) {
  return (
    <Card className="p-card">
      <p className="text-row font-medium">Couldn’t load your things</p>
      <p className="mt-1 text-body leading-relaxed text-ink-2">{message}</p>
      <Button variant="secondary" size="sm" className="mt-3" onClick={onRetry}>
        Try again
      </Button>
    </Card>
  )
}

/**
 * The empty state: **a sentence in the serif, one instruction, one control** — never an illustration
 * (design.md §6).
 *
 * Two different emptinesses, two different answers. "Nothing matches" is a filter to loosen; "Nothing
 * here yet" is a first thing to add. Collapsing them into one message is how a screen ends up telling
 * someone with a filter on that they own nothing.
 */
function EmptyThings({ filtered, onClear }: { filtered: boolean; onClear: () => void }) {
  return (
    <div className="px-8 py-10 text-center">
      <p className="font-heading text-head font-face-h leading-snug">
        {filtered ? 'Nothing of that kind yet' : 'Nothing of yours in here yet'}
      </p>
      <p className="mt-1.5 text-body leading-relaxed text-ink-3">
        {filtered
          ? 'Add the first one, or clear the filter.'
          : 'Add the first one with the button below. A name is all it needs.'}
      </p>
      {filtered && (
        <Button variant="secondary" size="sm" className="mt-3.5" onClick={onClear}>
          Clear filters
        </Button>
      )}
    </div>
  )
}

/**
 * The footer line, per the comp: how many things are out of cover, or that nothing is.
 *
 * Counted from `coverOf` rather than from a second `warranty_ends_on < today` comparison — one ladder
 * decides what "out of cover" means, and a screen that computed it itself could disagree with the bar
 * printed two lines above it.
 *
 * `complete` is surfaced for the same reason the Now footer surfaces it: past one page the count is a
 * floor, and a floor stated as a total is the one kind of wrong this screen can be.
 */
function ThingsFooter({ things, complete }: { things: Thing[]; complete: boolean }) {
  const ended = things.filter((thing) => coverOf(thing).state === 'ended').length

  return (
    <p className="px-1 pt-4 text-meta leading-relaxed text-ink-3">
      {ended === 0
        ? 'Everything here is still covered.'
        : `${ended} ${ended === 1 ? 'thing is' : 'things are'} out of cover — worth knowing before you call anyone.`}
      {complete ? '' : ' Counted across what’s loaded so far.'}
    </p>
  )
}
