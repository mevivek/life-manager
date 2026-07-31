import type {
  Document,
  DocumentListQuery,
  Thing,
  ThingKind,
  ThingListQuery,
} from '@life-manager/shared'
import { KIND_LABELS, thingKindSchema } from '@life-manager/shared'
import { createFileRoute, useNavigate } from '@tanstack/react-router'
import { useState } from 'react'
import { z } from 'zod'
import { Button } from '@/components/ui/button'
import { Chip } from '@/components/ui/chip'
import { ScreenSkeleton } from '@/components/ui/skeleton'
import { Toast } from '@/components/ui/toast'
import { useOpenAdd } from '@/features/documents/AddSheetProvider'
import { DocumentFilters, type Filters } from '@/features/documents/DocumentFilters'
import { DocumentList } from '@/features/documents/DocumentList'
import { DocumentRow } from '@/features/documents/DocumentRow'
import { useDocuments, useHolders } from '@/features/documents/useDocuments'
import { useLedger } from '@/features/documents/useLedger'
import { LibrarySearchField, SearchSummary, SearchToggle } from '@/features/library/LibrarySearch'
import { mergeRows } from '@/features/library/mergeRows'
import {
  type LibraryScope,
  libraryScopeSchema,
  SCOPE_LABELS,
  SCOPE_TITLES,
} from '@/features/library/scope'
import { coverOf } from '@/features/things/CoverStatus'
import { SumInsuredCard } from '@/features/things/SumInsuredCard'
import { ThingRow } from '@/features/things/ThingRow'
import { useThings } from '@/features/things/useThings'
import { cn } from '@/lib/utils'

/**
 * ═══════════════════════════════════════════════════════════════════════════════════════
 *  The library — one tab holding both collections.
 *  [ADR-0032](../../../../docs/decisions/0032-one-library-tab.md).
 * ═══════════════════════════════════════════════════════════════════════════════════════
 *
 * This screen replaces `documents.index.tsx` and `things.index.tsx`, which are now redirects into it.
 * The bar is `Now · Everything · You` again; the domains are a **scope switch** on this screen's
 * title, which is the shape ADR-0025 §4 originally described and ADR-0029 built as `DomainSwitcher`.
 *
 * **It is not that component coming back, and the difference is the whole decision.** `DomainSwitcher`
 * navigated between two separate screens, so it was a second navigation control competing with the
 * tab bar — which is why ADR-0031 deleted it. These pills navigate nowhere: there is one screen, one
 * list, and the pills narrow it. `All` is a real view that neither old screen could render, and it is
 * the default.
 *
 * ── What each scope is, mechanically ──
 *
 *  - **All** — documents and things interleaved by soonest date (`mergeRows`), one loaded page of
 *    each, no pager. The pager is deliberately absent: two cursors advancing independently under one
 *    "Load more" is a paging model with two sources of truth, and the failure it produces (rows
 *    appearing above where you are reading) is worse than a floor stated honestly in the footer.
 *  - **Documents** — the archive exactly as it was, `DocumentList` and its filters and its pager.
 *  - **Things** — the things list exactly as it was, kind chips and the sum-insured card.
 *
 * The two single-domain scopes keep their own filters rather than losing them to match the comp,
 * which draws only the scope pills. Handoff 5 deletes the Type / Tag / Expiring-before / Whose /
 * Has-scan row and the kind chips outright; those all ship today, the Now screen deep-links **into**
 * one of them (`?scan=no`), and no ADR has retired the Whose filter that documents.md §4 rule 13
 * specifies. Matching the comp there would have removed working function to match a drawing —
 * design.md's "the comp wins unless there is a hard reason" cuts the other way when the comp is
 * removing something rather than shaping it. The deviation is recorded in ADR-0032.
 */

/**
 * ── This is NOT `documentListQuerySchema` or `thingListQuerySchema` ──
 *
 * It is the union of what the two collection screens each used to hold, plus `scope` and `search`. The
 * wire schemas are `z.strictObject`s with repeatable arrays and a cursor; this describes *the UI's*
 * state, which is one value per filter and no cursor. `toDocumentQuery` and `toThingQuery` map one to
 * the other, each in one place.
 *
 * `.default()` **and** `.catch()` on every field, and both are needed — the two schemas this replaces
 * carried the same pair and the same note:
 *
 *  - `.default` makes the field optional on the way *in*, so `<Link to="/library">` with no search
 *    params typechecks. Without it the router demands all eight on every link here, the tab bar's
 *    included.
 *  - `.catch` makes it total on the way *out*, so `?scope=nonsense` from a hand-edited URL lands on
 *    the library rather than throwing a route error at someone who mistyped.
 */
const searchSchema = z.object({
  scope: libraryScopeSchema.default('all').catch('all'),
  q: z.string().default('').catch(''),
  /**
   * Whether the search field is unfolded.
   *
   * In the URL rather than in `useState` for one specific reason: `?q=` can arrive from a link, and a
   * query that filters the list while its field is folded away is a list that looks wrong for no
   * visible cause. Keeping the two together means a deep link can open the field with the query in it.
   */
  search: z.boolean().default(false).catch(false),

  // Document filters — unchanged from the archive's schema.
  type: z.string().default('').catch(''),
  tag: z.string().default('').catch(''),
  before: z.string().default('').catch(''),
  scan: z.enum(['', 'yes', 'no']).default('').catch(''),
  /** `mine` or a holder's name. See `Filters.who`. */
  who: z.string().default('').catch(''),

  // Thing filters — unchanged from the things list's schema.
  kind: z.string().default('').catch(''),
  ownership: z.enum(['', 'here', 'lent', 'gone']).default('').catch(''),
})

export const Route = createFileRoute('/_authed/library')({
  component: LibraryPage,
  validateSearch: searchSchema,
})

type Search = z.infer<typeof searchSchema>

/** 20, to match the "Load 20 more" the archive's pager offers. */
const DOCUMENT_PAGE_SIZE = 20
/** 100, matching `LEDGER_PAGE_LIMIT`. A household passes 100 things later than it passes 100 papers. */
const THING_PAGE_SIZE = 100

function toDocumentQuery(search: Search): Partial<DocumentListQuery> {
  return {
    limit: DOCUMENT_PAGE_SIZE,
    sort: 'expires_on',
    order: 'asc',
    ...(search.q.trim() === '' ? {} : { q: search.q.trim() }),
    ...(search.type === '' ? {} : { type: [search.type as Document['doc_type']] }),
    ...(search.tag === '' ? {} : { tag: [search.tag] }),
    ...(search.before === '' ? {} : { expiring_before: search.before }),
    ...(search.scan === '' ? {} : { has_file: search.scan === 'yes' }),
    ...(search.who === '' ? {} : { holder: search.who }),
  }
}

function toThingQuery(search: Search): Partial<ThingListQuery> {
  return {
    limit: THING_PAGE_SIZE,
    sort: 'name',
    order: 'asc',
    ...(search.q.trim() === '' ? {} : { q: search.q.trim() }),
    ...(search.kind === '' ? {} : { kind: [search.kind as ThingKind] }),
    ...(search.who === '' ? {} : { holder: search.who }),
    ...(search.ownership === '' ? {} : { ownership: [search.ownership] }),
  }
}

/** Whether anything other than the scope is narrowing the list. */
function hasNarrowing(search: Search): boolean {
  return (
    search.q.trim() !== '' ||
    search.type !== '' ||
    search.tag !== '' ||
    search.before !== '' ||
    search.scan !== '' ||
    search.who !== '' ||
    search.kind !== '' ||
    search.ownership !== ''
  )
}

/** Everything except `scope` reset — what "clear" means, and what changing scope does. */
const CLEARED = {
  q: '',
  search: false,
  type: '',
  tag: '',
  before: '',
  scan: '',
  who: '',
  kind: '',
  ownership: '',
} as const

function LibraryPage() {
  const search = Route.useSearch()
  const navigate = useNavigate({ from: Route.fullPath })
  const openAdd = useOpenAdd()
  const scope = search.scope

  /**
   * Revealed numbers — ADR-0027. Two pieces of state, not one; the archive's note applies unchanged.
   *
   * `revealAll` is the header toggle and `revealedIds` is the per-row one. With one set, turning the
   * header off after revealing a single row would have to remember which rows the *user* opened, and
   * turning it on would have to enumerate rows not yet fetched. Neither persists — a "keep revealed"
   * preference would be a way to leave every number on screen permanently, which is the opposite of
   * what masking is for.
   */
  const [revealAll, setRevealAll] = useState(false)
  const [revealedIds, setRevealedIds] = useState<ReadonlySet<string>>(() => new Set())
  const [copied, setCopied] = useState<string | null>(null)
  const [openPanel, setOpenPanel] = useState<'none' | 'type' | 'tag' | 'before' | 'who'>('none')

  const documentQuery = toDocumentQuery(search)
  const thingQuery = toThingQuery(search)

  /**
   * Both collections, always fetched — even in a scope that shows only one.
   *
   * The cost is one extra request on a screen with a scope switch on it, and it buys two things that
   * are otherwise impossible: the search summary can say *"2 documents · 1 thing match"* while you are
   * looking at Documents, and switching scope is instant rather than a spinner. TanStack Query dedupes
   * on the key, so All and Documents share the document fetch rather than issuing two.
   */
  const documents = useDocuments(documentQuery)
  const things = useThings(thingQuery)

  /**
   * The unfiltered pages, for the things a filtered one cannot answer: which kinds exist, which tags
   * exist, and the total to sit beside a filtered count. Deriving those from the *filtered* page would
   * make each control's own options vanish as you use it.
   *
   * `useLedger` rather than a fresh `useDocuments` — it is the same query key the Now screen and the
   * tab bar's badge already use, so this is a read of a fetch that has happened, not a fourth request.
   */
  const allDocuments = useLedger()
  const allThings = useThings({ sort: 'name', order: 'asc', limit: THING_PAGE_SIZE })

  const holders = useHolders()
  const people = (holders.data ?? []).map((person) => person.holder)

  const documentRows = documents.data?.data ?? []
  const thingRows = things.data?.data ?? []
  const everyThing = allThings.data?.data ?? []
  const complete = documents.data?.next_cursor === null && things.data?.next_cursor === null

  const filters: Filters = {
    q: search.q,
    type: search.type,
    tag: search.tag,
    before: search.before,
    scan: search.scan,
    who: search.who,
  }

  /** Patch the URL. `replace` throughout, so a filter change does not stack a history entry. */
  const setSearch = (next: Partial<Search>) =>
    void navigate({ search: { ...search, ...next }, replace: true })

  return (
    <div>
      {/*
        The header does not scroll away. It is `sticky` with the shell's own top inset: the scope
        pills and the search are how you navigate a long list, and losing them at the top of a
        200-row list means scrolling back up to change your mind.

        The negative gutter margins let the `--paper` ground and the bottom hairline run full-bleed
        while the content stays on the gutter.

        ── `pt-1.5`, and it is not decoration ──

        The archive had no top padding here, because the shell's own `pt-[…+0.5rem]` sat above it and
        a heading needs no more. The search field does: it is `sticky top-0`, so once the page scrolls
        the shell's padding is gone and the field's **focus ring is clipped against the viewport
        edge** — found by rendering this at 390px, not by any test, which is the whole point of
        design.md §10. Six pixels clears the ring in both states and costs the list nothing.
      */}
      <div className="-mx-gutter sticky top-0 z-30 border-b border-rule bg-paper px-gutter pt-1.5 pb-3">
        {search.search ? (
          <LibrarySearchField
            value={search.q}
            scope={scope}
            onChange={(q) => setSearch({ q })}
            // Close clears. A folded field with a live query is a list narrowed by something the
            // user can no longer see — see `LibrarySearch`'s header.
            onClose={() => setSearch({ search: false, q: '' })}
          />
        ) : (
          <div className="flex items-center justify-between gap-2.5">
            <div className="flex min-w-0 items-baseline gap-2">
              <h1 className="truncate font-heading text-title font-face-h leading-tight">
                {SCOPE_TITLES[scope]}
              </h1>
              <Count
                scope={scope}
                documents={documentRows.length}
                things={thingRows.length}
                narrowed={hasNarrowing(search)}
                complete={complete}
                pending={documents.isPending || things.isPending}
                failed={documents.isError || things.isError}
              />
            </div>

            <div className="flex shrink-0 items-center gap-0.5">
              {/*
                Show / hide every number on the page — ADR-0027. Only under Documents, and only when
                the loaded page actually holds one. A control that reveals nothing is worse than no
                control: it implies the list holds numbers it does not.
              */}
              {scope === 'documents' && documentRows.some((row) => row.identifier !== null) && (
                <Button
                  variant="quiet"
                  size="sm"
                  className="shrink-0 gap-1.5 text-meta text-ink-2"
                  onClick={() => {
                    setRevealAll((previous) => !previous)
                    // Turning the page-wide toggle OFF clears rows the user opened individually
                    // too. Otherwise "hide" leaves numbers on screen, which is the one thing the
                    // control promises not to do.
                    setRevealedIds(new Set())
                  }}
                  aria-pressed={revealAll}
                >
                  <span
                    aria-hidden="true"
                    className={cn(
                      'font-mono text-[0.6875rem] tracking-label uppercase',
                      revealAll ? 'text-ink' : 'text-ink-3',
                    )}
                  >
                    {revealAll ? '••••' : '1234'}
                  </span>
                  {revealAll ? 'Hide' : 'Show'}
                </Button>
              )}
              <SearchToggle
                open={false}
                active={search.q.trim() !== ''}
                scope={scope}
                onClick={() => setSearch({ search: true })}
              />
            </div>
          </div>
        )}

        {/*
          The scope switch. `aria-pressed` toggles, not links — see `scope.ts` for why this is not the
          navigation rule design.md §8 states.

          Changing scope clears the filters, because they do not survive the crossing: `?kind=vehicle`
          means nothing to a document and `?type=identity` means nothing to a thing, and carrying them
          silently would produce a confidently empty list whose cause is a chip the current scope does
          not draw. The search query is the one thing worth keeping — it is the same question asked of
          a different pile, which is exactly what the summary line invites.
        */}
        <fieldset className="-mx-gutter mt-3 flex min-w-0 gap-1.5 overflow-x-auto border-0 px-gutter">
          <legend className="sr-only">Show</legend>
          {libraryScopeSchema.options.map((option) => (
            <Chip
              key={option}
              size="sm"
              selected={scope === option}
              onClick={() =>
                setSearch({ ...CLEARED, scope: option, q: search.q, search: search.search })
              }
            >
              {SCOPE_LABELS[option]}
            </Chip>
          ))}
        </fieldset>

        {search.search && (
          <SearchSummary
            query={search.q}
            documents={documentRows.length}
            things={thingRows.length}
            complete={complete}
          />
        )}

        {/* Absent unless a contents policy is found, which is most of the time. See the component. */}
        {scope === 'things' && <SumInsuredCard things={everyThing} className="mt-3" />}

        {scope === 'documents' && (
          <DocumentFilters
            filters={filters}
            availableTags={collectTags(allDocuments.data?.data ?? [])}
            openPanel={openPanel}
            onOpenPanel={setOpenPanel}
            people={people}
            onChange={(next) => setSearch(next)}
          />
        )}

        {scope === 'things' && (
          <KindFilter
            kinds={kindsPresent(everyThing)}
            selected={search.kind}
            onSelect={(kind) => setSearch({ kind })}
          />
        )}
      </div>

      {scope === 'documents' ? (
        <DocumentList
          query={documentQuery}
          numbers={{
            revealedIds,
            revealAll,
            onToggle: (documentId) =>
              setRevealedIds((previous) => {
                const next = new Set(previous)
                if (next.has(documentId)) next.delete(documentId)
                else next.add(documentId)
                return next
              }),
            onCopied: setCopied,
          }}
          emptyState={
            <Empty
              scope="documents"
              narrowed={hasNarrowing(search)}
              onClear={() => setSearch(CLEARED)}
            />
          }
        />
      ) : scope === 'things' ? (
        things.isPending ? (
          /* First paint only (design.md §6). A refetch keeps the stale list — replacing real content
             with shimmer is how a working app looks broken. */
          <ScreenSkeleton />
        ) : things.isError ? (
          <LoadFailed message={things.error.message} onRetry={() => void things.refetch()} />
        ) : thingRows.length === 0 ? (
          <Empty
            scope="things"
            narrowed={hasNarrowing(search)}
            onClear={() => setSearch(CLEARED)}
          />
        ) : (
          <>
            {thingRows.map((thing) => (
              <ThingRow
                key={thing.id}
                thing={thing}
                className="-mx-gutter border-b border-rule px-gutter"
              />
            ))}
            <ThingsFooter things={thingRows} complete={things.data?.next_cursor === null} />
          </>
        )
      ) : (
        <AllScope
          documents={documentRows}
          things={thingRows}
          pending={documents.isPending || things.isPending}
          error={documents.error ?? things.error}
          onRetry={() => {
            void documents.refetch()
            void things.refetch()
          }}
          narrowed={hasNarrowing(search)}
          onClear={() => setSearch(CLEARED)}
          complete={complete}
        />
      )}

      {/*
        Room for the pill at the end of the list. The shell's bottom padding clears the tab bar, but
        the pill sits *above* the bar — so without this the last row is permanently under it, and the
        one row you cannot reach is whatever sorts last.
      */}
      <div aria-hidden="true" className="h-[4.875rem]" />

      {/*
        ═══════════════════════════════════════════════════════════════════════════════════
         The Add pill — the one emphatic control in the app.
        ═══════════════════════════════════════════════════════════════════════════════════

        `fixed` rather than `absolute`, because the design positions it against the viewport and this
        page's own box is as tall as the list. It clears the tab bar by sitting above the same
        safe-area inset the bar pads itself with, so it never lands on the home indicator. It carries
        the comp's `--e-pill` shadow — design.md §5, and `documents.index.tsx`'s note before it.

        **`openAdd` is the picker now, not the document track.** design.md §8's *"each domain keeps
        its own Add"* was a rule about two screens; there is one, and above a list holding both kinds
        the answer to "what are you adding" is not on screen. It asks — `AddPicker`.
      */}
      <button
        type="button"
        onClick={openAdd}
        className="fixed right-gutter bottom-[calc(env(safe-area-inset-bottom)+6.5rem)] z-40 flex min-h-[3.25rem] items-center gap-2.5 rounded-pill border border-ink bg-ink pr-5 pl-4 text-head text-onink shadow-pill active:opacity-90"
      >
        <span aria-hidden="true" className="relative block size-4">
          <span className="absolute top-[7px] left-0 h-[2.5px] w-4 rounded-[1px] bg-current" />
          <span className="absolute top-0 left-[7px] h-4 w-[2.5px] rounded-[1px] bg-current" />
        </span>
        Add
      </button>

      {/* The copy confirmation. A PLAIN toast — there is nothing to undo about a clipboard write. */}
      {copied !== null && <Toast message={`${copied} copied`} onDismiss={() => setCopied(null)} />}
    </div>
  )
}

/**
 * The count beside the title.
 *
 * `isError` as well as `isPending`, and the reason was found by looking at the screen: branching on
 * pending alone let a failed request fall through to the loaded case with a total of 0, so the header
 * read **"Things 0+"** directly above "Couldn't load your things" — two claims about the same failed
 * request, one of them invented. A count is a fact about data we hold; when the request failed we hold
 * none, so the honest rendering is nothing at all.
 */
function Count({
  scope,
  documents,
  things,
  narrowed,
  complete,
  pending,
  failed,
}: {
  scope: LibraryScope
  documents: number
  things: number
  narrowed: boolean
  complete: boolean
  pending: boolean
  failed: boolean
}) {
  if (pending || failed) return null

  const total = scope === 'documents' ? documents : scope === 'things' ? things : documents + things
  const suffix = complete ? '' : '+'

  return (
    <span className="shrink-0 text-body text-ink-3">
      {/* "6 of 12" is only sayable when both numbers are known, and under a filter the second would
          need an unfiltered count the API does not give. So say what matched. */}
      {narrowed ? `${total}${suffix} matching` : `${total}${suffix}`}
    </span>
  )
}

/**
 * **All** — the merged list, and the only view neither old screen could render.
 *
 * No pager, by decision rather than omission: see this file's header. The footer states the floor
 * instead, because a count that is silently a page-worth is exactly the D33 failure — a number nobody
 * can stand behind, presented as though they could.
 */
function AllScope({
  documents,
  things,
  pending,
  error,
  onRetry,
  narrowed,
  onClear,
  complete,
}: {
  documents: readonly Document[]
  things: readonly Thing[]
  pending: boolean
  error: Error | null
  onRetry: () => void
  narrowed: boolean
  onClear: () => void
  complete: boolean
}) {
  if (pending) return <ScreenSkeleton />
  if (error !== null) return <LoadFailed message={error.message} onRetry={onRetry} />

  const rows = mergeRows(documents, things)
  if (rows.length === 0) return <Empty scope="all" narrowed={narrowed} onClear={onClear} />

  return (
    <>
      {rows.map((row) =>
        row.kind === 'document' ? (
          <DocumentRow
            key={`document-${row.id}`}
            document={row.document}
            // 52px, so a document's glyph column lines up with a thing's thumbnail. Without it the
            // two kinds indent differently and the list reads as two lists shuffled together.
            glyphColumn="wide"
            className="-mx-gutter border-b border-rule px-gutter"
          />
        ) : (
          <ThingRow
            key={`thing-${row.id}`}
            thing={row.thing}
            className="-mx-gutter border-b border-rule px-gutter"
          />
        ),
      )}
      <p className="px-1 pt-4 text-meta leading-relaxed text-ink-3 [text-wrap:pretty]">
        {complete
          ? 'That’s everything you’ve filed.'
          : 'Showing the most pressing of each — narrow with the pills or a search to see the rest.'}
      </p>
    </>
  )
}

/**
 * The empty state: **a sentence in the serif, one instruction, one control** — never an illustration
 * (design.md §6).
 *
 * Two different emptinesses, two different answers. "Nothing matches" is a filter to loosen; "nothing
 * here yet" is a first thing to add. Collapsing them is how a screen ends up telling someone with a
 * filter on that they own nothing.
 */
function Empty({
  scope,
  narrowed,
  onClear,
}: {
  scope: LibraryScope
  narrowed: boolean
  onClear: () => void
}) {
  const titles: Record<LibraryScope, string> = {
    all: 'Nothing filed yet',
    documents: 'No documents yet',
    things: 'Nothing of yours in here yet',
  }
  const blurbs: Record<LibraryScope, string> = {
    all: 'Everything you file, paperwork or possession, lands in this list.',
    documents: 'Add the first one with the button below.',
    things: 'Add the first one with the button below. A name is all it needs.',
  }

  return (
    <div className="px-8 py-10 text-center">
      <p className="font-heading text-head font-face-h leading-snug">
        {narrowed ? 'Nothing matches' : titles[scope]}
      </p>
      <p className="mt-1.5 text-body leading-relaxed text-ink-3 [text-wrap:pretty]">
        {narrowed
          ? 'Try a shorter word, or fewer filters — it searches titles, issuers, makes and serials.'
          : blurbs[scope]}
      </p>
      {narrowed && (
        <Button variant="secondary" size="sm" className="mt-3.5" onClick={onClear}>
          Clear
        </Button>
      )}
    </div>
  )
}

/**
 * A failed load — **calm**, not alarmed.
 *
 * A plain card rather than `tone="late"`: the status tints are spent on a document's expiry and a
 * thing's cover (design.md §4), and a red panel here would say something urgent about the user's data
 * when the truth is a request failed. It names what failed, shows the message rather than swallowing
 * it, and offers the one action that can help.
 */
function LoadFailed({ message, onRetry }: { message: string; onRetry: () => void }) {
  return (
    <div className="rounded-3 border border-rule-2 p-card">
      <p className="text-row font-medium">Couldn’t load this</p>
      <p className="mt-1 text-body leading-relaxed text-ink-2">{message}</p>
      <Button variant="secondary" size="sm" className="mt-3" onClick={onRetry}>
        Try again
      </Button>
    </div>
  )
}

/**
 * The kind chips — `All` first, then only the kinds that actually appear.
 *
 * A `<fieldset>` with a `<legend>`, not a `div role="group"` (design.md §6): the legend is announced
 * before each pill, so a screen reader says "Kind, Vehicle" rather than a bare "Vehicle" — which on a
 * screen that also has a scope switch is genuinely ambiguous.
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
  // One kind means one chip and an "All" that does nothing — "draw it the day it is needed".
  if (kinds.length < 2) return null

  return (
    // `min-w-0` because a fieldset defaults to `min-width: min-content`, which stops the row
    // scrolling and lets it push the page sideways instead.
    <fieldset className="-mx-gutter mt-3 flex min-w-0 gap-[7px] overflow-x-auto border-0 px-gutter pb-0.5">
      <legend className="sr-only">Kind</legend>
      {/*
        **"All kinds", not "All"** — and this was found by rendering the Things scope at 390px.

        This row now sits directly beneath the scope pills, whose first chip is also "All". Two
        adjacent selected-looking pills reading "All" above "All" is genuinely ambiguous: one means
        every *record*, the other every *kind of thing*. On the old standalone Things screen there was
        nothing above it to collide with. The legends already disambiguate them for a screen reader
        ("Show" and "Kind"); this is the sighted reader's version of the same fix.
      */}
      <Chip size="sm" selected={selected === ''} onClick={() => onSelect('')}>
        All kinds
      </Chip>
      {kinds.map((kind) => (
        <Chip
          key={kind}
          size="sm"
          selected={selected === kind}
          // Tapping the selected chip clears it — a chip row with no "off" makes the first tap
          // irreversible.
          onClick={() => onSelect(selected === kind ? '' : kind)}
        >
          {KIND_LABELS[kind]}
        </Chip>
      ))}
    </fieldset>
  )
}

/**
 * How many things are out of cover, or that nothing is.
 *
 * Counted from `coverOf` rather than a second `warranty_ends_on < today` comparison — one ladder
 * decides what "out of cover" means, and a screen that computed it itself could disagree with the bar
 * printed two lines above it.
 */
function ThingsFooter({ things, complete }: { things: readonly Thing[]; complete: boolean }) {
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

/** Distinct tags across the loaded ledger page, alphabetical so the row does not reshuffle. */
function collectTags(documents: readonly Document[]): string[] {
  const tags = new Set<string>()
  for (const document of documents) {
    for (const tag of document.tags) tags.add(tag)
  }
  return [...tags].sort()
}

/**
 * Which kinds are present, in the contract's order.
 *
 * `thingKindSchema.options` rather than the order they happen to appear in the page: that order is
 * rough frequency of ownership, so the common case stays near the start of the row and the row does
 * not reshuffle when a thing is added.
 */
function kindsPresent(things: readonly Thing[]): ThingKind[] {
  const present = new Set(things.map((thing) => thing.kind))
  return thingKindSchema.options.filter((kind) => present.has(kind))
}
