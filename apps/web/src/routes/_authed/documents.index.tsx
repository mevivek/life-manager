import type { Document, DocumentListQuery } from '@life-manager/shared'
import { createFileRoute, useNavigate } from '@tanstack/react-router'
import { useState } from 'react'
import { z } from 'zod'
import { Button } from '@/components/ui/button'
import { Toast } from '@/components/ui/toast'
import { useOpenAdd } from '@/features/documents/AddSheetProvider'
import { DocumentFilters, type Filters, hasAnyFilter } from '@/features/documents/DocumentFilters'
import { DocumentList } from '@/features/documents/DocumentList'
import { useDocuments } from '@/features/documents/useDocuments'
import { useLedger } from '@/features/documents/useLedger'
import { cn } from '@/lib/utils'

/**
 * The archive. domains/documents.md §7, ADR-0025 §7.
 *
 * ── Filters live in the URL, not in component state ──
 *
 * The previous version held search and type in `DocumentList`'s `useState`. Two things make that
 * untenable now:
 *
 *  1. The Now screen's no-scan nudge deep-links **into** a filtered archive (`?scan=no`). A filter in
 *     a child component's state has no address, so that link could not exist.
 *  2. A back-navigation from a document should return to the filtered list the user was reading, not
 *     to an unfiltered one. The router restores search params for free; it cannot restore `useState`.
 *
 * `validateSearch` is a Zod schema, so a hand-edited URL is coerced rather than trusted — the same
 * discipline the API applies to its own query strings, for the same reason.
 */

/**
 * ── This is NOT `documentListQuerySchema` ──
 *
 * It deliberately does not reuse the API's query schema, and the difference is not laziness. The wire
 * schema is `z.strictObject` with `repeatable()` arrays and a `cursor`; this describes *the UI's*
 * state, which is one value per filter and no cursor at all (paging is `DocumentList`'s business).
 * Mapping one to the other is `toQuery` below, in one place.
 *
 * `.catch()` on every field rather than `.optional()`: a URL is user-editable, and `?scan=maybe`
 * should land on an unfiltered archive rather than throw a route error at someone who mistyped.
 */
/**
 * `.default('')` AND `.catch('')` on every field, and both are needed:
 *
 *  - `.default` makes the field optional on the way *in*, so `<Link to="/documents">` with no search
 *    params still typechecks. Without it the router demands all five on every link to this route,
 *    including the "Back to documents" link from a detail screen.
 *  - `.catch` makes it total on the way *out*, so `?scan=maybe` from a hand-edited URL lands on an
 *    unfiltered archive rather than throwing a route error at someone who mistyped.
 */
const searchSchema = z.object({
  q: z.string().default('').catch(''),
  type: z.string().default('').catch(''),
  tag: z.string().default('').catch(''),
  before: z.string().default('').catch(''),
  scan: z.enum(['', 'yes', 'no']).default('').catch(''),
})

export const Route = createFileRoute('/_authed/documents/')({
  component: DocumentsPage,
  validateSearch: searchSchema,
})

/** 20 to match the "Load 20 more" the design's pager offers. */
const PAGE_SIZE = 20

function toQuery(filters: Filters): Partial<DocumentListQuery> {
  return {
    limit: PAGE_SIZE,
    sort: 'expires_on',
    order: 'asc',
    ...(filters.q.trim() === '' ? {} : { q: filters.q.trim() }),
    ...(filters.type === '' ? {} : { type: [filters.type as Document['doc_type']] }),
    ...(filters.tag === '' ? {} : { tag: [filters.tag] }),
    ...(filters.before === '' ? {} : { expiring_before: filters.before }),
    ...(filters.scan === '' ? {} : { has_file: filters.scan === 'yes' }),
  }
}

function DocumentsPage() {
  const filters = Route.useSearch()
  const openAdd = useOpenAdd()
  /**
   * Revealed numbers — ADR-0027. Two pieces of state, not one.
   *
   * `revealAll` is the header toggle and `revealedIds` is the per-row one, and they are deliberately
   * separate rather than the toggle filling the set: with one set, turning the header off after
   * revealing a single row would have to remember which rows the *user* opened, and turning it on
   * would have to enumerate rows that have not been fetched yet. Two flags compose without either
   * problem — a row is revealed if the page says so OR if it says so itself.
   *
   * Neither persists. A "keep revealed" preference would be a way to leave every number on screen
   * permanently, which is the opposite of what masking is for.
   */
  const [revealAll, setRevealAll] = useState(false)
  const [revealedIds, setRevealedIds] = useState<ReadonlySet<string>>(() => new Set())
  const [copied, setCopied] = useState<string | null>(null)
  const navigate = useNavigate({ from: Route.fullPath })
  const [openPanel, setOpenPanel] = useState<'none' | 'type' | 'tag' | 'before'>('none')

  const query = toQuery(filters)

  /**
   * The first page, read again here for the header's count.
   *
   * This is the *same query key* `DocumentList` uses for page one, so TanStack Query serves both from
   * one fetch — there is no second request. Reading it here rather than having the list report upward
   * avoids a `setState` during the child's render, which is what a callback would have forced.
   */
  const firstPage = useDocuments(query)

  /**
   * Tags come from the unfiltered ledger page, which `TabBar` has already fetched — so the tag filter
   * offers the tags that **exist in the archive** rather than only those surviving the current
   * filters. Offering a tag that the active filters exclude would produce a confidently empty list;
   * offering only surviving tags would make the control vanish as you use it.
   */
  const ledger = useLedger()
  const availableTags = collectTags(ledger.data?.data ?? [])

  const total = firstPage.data?.data.length ?? 0
  const complete = firstPage.data?.next_cursor === null
  /** Whether the loaded page holds any number at all — the toggle is not drawn otherwise. */
  const anyNumbers = (firstPage.data?.data ?? []).some((row) => row.identifier !== null)

  return (
    <div>
      {/*
        The header does not scroll away. It is `sticky` with the shell's own top inset, because the
        search field and the chips are how you navigate a long archive — losing them at the top of a
        200-row list means scrolling back up to change your mind.

        The negative gutter margins let the `--paper` ground and the bottom hairline run full-bleed
        while the content stays on the gutter.
      */}
      <div className="-mx-gutter sticky top-0 z-30 border-b border-rule bg-paper px-gutter pb-3">
        <div className="flex items-center justify-between gap-2.5">
          <div className="flex items-baseline gap-2">
            {/*
              No chevron beside "Documents". ADR-0025 §4: the domain switcher appears the day the second
              domain does, and drawing it now would be a control that does nothing.
            */}
            <h1 className="font-serif text-title font-normal leading-tight">Documents</h1>
            <span className="text-body text-ink-3">
              {firstPage.isPending
                ? ''
                : hasAnyFilter(filters)
                  ? // "6 of 12" is only sayable when both numbers are known. Under a filter the second
                    // number would need an unfiltered count the API cannot give, so say what matched.
                    `${total}${complete ? '' : '+'} matching`
                  : `${total}${complete ? '' : '+'}`}
            </span>
          </div>

          {/*
            Show / hide every number on the page — ADR-0027.

            Rendered only when the loaded page actually has one. A control that reveals nothing is
            worse than no control: it implies the archive holds numbers it does not, and it is the
            "draw it the day the thing exists" rule the domain switcher follows (ADR-0025 §4).
          */}
          {anyNumbers && (
            <Button
              variant="quiet"
              size="sm"
              className="-mr-2 shrink-0 gap-1.5 text-meta text-ink-2"
              onClick={() => {
                setRevealAll((previous) => !previous)
                // Turning the page-wide toggle OFF clears the rows the user opened individually too.
                // Otherwise "hide" leaves numbers on screen, which is the one thing the control
                // promises not to do.
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
              {revealAll ? 'Hide numbers' : 'Show numbers'}
            </Button>
          )}
        </div>

        <DocumentFilters
          filters={filters}
          availableTags={availableTags}
          openPanel={openPanel}
          onOpenPanel={setOpenPanel}
          onChange={(next) => {
            // `replace` so changing a filter does not stack a history entry per keystroke — otherwise
            // the back button walks the user letter by letter out of their own search.
            void navigate({ search: next, replace: true })
          }}
        />
      </div>

      <DocumentList
        query={query}
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
          <div className="px-8 py-10 text-center">
            <p className="font-serif text-[1.1875rem] leading-snug">
              {hasAnyFilter(filters) ? 'Nothing matches' : 'No documents yet'}
            </p>
            <p className="mt-1.5 text-body leading-relaxed text-ink-3">
              {hasAnyFilter(filters)
                ? 'Try fewer filters, or a shorter search.'
                : // Not "the Add tab" any more — Add stopped being a tab when You took the third
                  // slot. Naming a control that no longer exists is worse than naming none.
                  'Add the first one with the button below.'}
            </p>
            {hasAnyFilter(filters) && (
              <Button
                variant="secondary"
                size="sm"
                className="mt-3.5"
                onClick={() =>
                  void navigate({
                    search: { q: '', type: '', tag: '', before: '', scan: '' },
                    replace: true,
                  })
                }
              >
                Clear filters
              </Button>
            )}
          </div>
        }
      />

      {/*
        Room for the pill at the end of the list. The shell's `pb-28` clears the tab bar, but the pill
        sits *above* the bar — so without this the last row of a full archive is permanently under it,
        and the one row you cannot reach is the oldest document you own.
      */}
      <div aria-hidden="true" className="h-[4.875rem]" />

      {/*
        ═══════════════════════════════════════════════════════════════════════════════════
         The Add pill — the one emphatic control in the app.
        ═══════════════════════════════════════════════════════════════════════════════════

        `fixed` rather than `absolute`, because the design positions it against the viewport and this
        page's own box is as tall as the archive. It clears the tab bar by sitting above the same
        safe-area inset the bar pads itself with, so it never lands on the home indicator.

        **It carries a hairline, not a shadow.** The comp draws `0 8px 24px rgba(10,10,9,.24)`, which
        would make it the third thing in the app to cast one — and ADR-0025 §3 allows exactly two, the
        sheet and the toast, on the grounds that a shadow means "temporarily on top of your life".
        A permanent control is not that. The ink fill already separates it from any ground it crosses,
        which is the job the shadow was doing.
      */}
      <button
        type="button"
        onClick={openAdd}
        className="fixed right-gutter bottom-[calc(env(safe-area-inset-bottom)+6.5rem)] z-40 flex min-h-[3.25rem] items-center gap-2.5 rounded-pill border border-ink bg-ink pr-5 pl-4 text-head text-onink active:opacity-90"
      >
        <span aria-hidden="true" className="relative block size-4">
          <span className="absolute top-[7px] left-0 h-[2.5px] w-4 rounded-[1px] bg-current" />
          <span className="absolute top-0 left-[7px] h-4 w-[2.5px] rounded-[1px] bg-current" />
        </span>
        Add
      </button>

      {/*
        The copy confirmation. A PLAIN toast — the comp added a dismiss variant precisely because its
        toast showed "Undo" unconditionally, and there is nothing to undo about a clipboard write.
        `Toast` takes no action here, so it renders the dismiss affordance instead.
      */}
      {copied !== null && <Toast message={`${copied} copied`} onDismiss={() => setCopied(null)} />}
    </div>
  )
}

/** Distinct tags across the loaded ledger page, alphabetical so the row does not reshuffle. */
function collectTags(documents: Document[]): string[] {
  const tags = new Set<string>()
  for (const document of documents) {
    for (const tag of document.tags) tags.add(tag)
  }
  return [...tags].sort()
}
