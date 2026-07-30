import type { DocumentListQuery } from '@life-manager/shared'
import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { DocumentListSkeleton } from '@/components/ui/skeleton'
import { DocumentRow } from './DocumentRow'
import { groupForReading } from './numberFormat'
import { numberLabelFor } from './presets'
import { useDocuments } from './useDocuments'

/**
 * The archive list. domains/documents.md §7, ADR-0025 §7.
 *
 * Pagination is cursor-based and **append-only** — "Load 20 more" rather than numbered pages. That
 * follows from the API (conventions/api.md §4: cursors, because offsets break when rows are inserted
 * mid-scroll) and from the main consumer being a phone.
 *
 * ── The filters moved out ──
 *
 * This component used to own a search box and a `<select>`, both in local `useState`. They are gone:
 * the archive route owns filter state now, because the Now screen's no-scan nudge deep-links into a
 * pre-filtered archive, and a filter living in this component's state could not be addressed from
 * outside it. What is left here is paging and rendering, which is all a list should be.
 */

export type DocumentListProps = {
  /** The full query, filters included. Owned by the caller. */
  query: Partial<DocumentListQuery>
  emptyState?: React.ReactNode
  /** `divided` runs rows full-bleed with a rule between; `card` groups them in one bordered panel. */
  variant?: 'divided' | 'card'
  /**
   * The row-level number display — ADR-0027. Absent means no numbers are drawn, which is what the
   * Now screen's cards want.
   *
   * The revealed set is owned **above** this component because the archive header has a toggle that
   * reveals every row at once. Local state per row could not be reached by it, and a boolean threaded
   * down from the page is simpler than a context for two consumers.
   */
  numbers?: {
    /** Ids currently revealed. A page-wide toggle is expressed by `revealAll`, not by filling this. */
    revealedIds: ReadonlySet<string>
    revealAll: boolean
    onToggle: (documentId: string) => void
    /** Called with the number's label after a successful copy, so the page can say so. */
    onCopied: (label: string) => void
  }
}

export function DocumentList({
  query,
  emptyState,
  variant = 'divided',
  numbers,
}: DocumentListProps) {
  /**
   * One `useQuery` per page, keyed by its cursor, rather than `useInfiniteQuery`.
   *
   * Kept from the previous implementation because the reason still holds: changing a filter resets the
   * list anyway, and one query per page keeps every page independently cached for a back-navigation.
   */
  const [cursors, setCursors] = useState<string[]>([])

  /**
   * The cursor list is keyed to the filters that produced it.
   *
   * Without this, changing a filter while on page 3 would keep paging with cursors minted against the
   * *old* filter set, and the API would answer with rows that do not match what the chips say. It is
   * compared during render rather than in an effect, so there is no frame in which the two disagree —
   * the pattern React documents as "adjusting state when props change".
   */
  const queryKey = JSON.stringify(query)
  const [seenQueryKey, setSeenQueryKey] = useState(queryKey)
  if (seenQueryKey !== queryKey) {
    setSeenQueryKey(queryKey)
    setCursors([])
  }

  const pages = [undefined, ...cursors]

  return (
    <div>
      {pages.map((cursor, index) => (
        <DocumentPage
          // The cursor identifies the page; 'first' is the fallback for the one with no cursor.
          key={cursor ?? 'first'}
          query={{ ...query, ...(cursor === undefined ? {} : { cursor }) }}
          isFirst={index === 0}
          isLast={index === pages.length - 1}
          emptyState={emptyState}
          variant={variant}
          numbers={numbers}
          onLoadMore={(next) => setCursors((previous) => [...previous, next])}
        />
      ))}
    </div>
  )
}

function DocumentPage({
  query,
  isFirst,
  isLast,
  emptyState,
  variant,
  numbers,
  onLoadMore,
}: {
  query: Partial<DocumentListQuery>
  isFirst: boolean
  isLast: boolean
  emptyState?: React.ReactNode
  variant: 'divided' | 'card'
  numbers?: DocumentListProps['numbers']
  onLoadMore: (cursor: string) => void
}) {
  const documents = useDocuments(query)

  if (documents.isPending) {
    // A skeleton the size of the rows that are coming, so the height is settled before the data lands.
    // First page only — a "load more" that replaces the list with shimmer loses the reader's place.
    return isFirst ? <DocumentListSkeleton count={Math.min(query.limit ?? 3, 3)} /> : null
  }

  if (documents.isError) {
    return (
      <Card tone="late" className="p-card">
        <p className="text-row font-medium">Couldn’t load your documents</p>
        <p className="mt-1 text-body leading-relaxed text-ink-2">{documents.error.message}</p>
        <Button
          variant="secondary"
          size="sm"
          className="mt-3"
          onClick={() => void documents.refetch()}
        >
          Try again
        </Button>
      </Card>
    )
  }

  const { data, next_cursor } = documents.data

  if (data.length === 0 && isFirst) return <>{emptyState}</>

  const rows = data.map((document, index) => (
    <DocumentRow
      key={document.id}
      document={document}
      divided={variant === 'card' && index > 0}
      chevron={variant === 'card'}
      number={
        numbers === undefined || document.identifier === null
          ? undefined
          : {
              label: numberLabelFor(document.title, document.doc_type),
              revealed: numbers.revealAll || numbers.revealedIds.has(document.id),
              grouped: groupForReading(document.identifier),
              onToggleReveal: () => numbers.onToggle(document.id),
              onCopy: () => {
                // `document.identifier` is non-null in this branch; the closure captures the narrowed
                // value rather than re-reading it, so a re-render cannot make it null underneath.
                const value = document.identifier ?? ''
                void navigator.clipboard
                  .writeText(value)
                  .then(() => numbers.onCopied(numberLabelFor(document.title, document.doc_type)))
                  .catch(() => {
                    // Clipboard access can be refused (insecure origin, denied permission). Revealing
                    // is the fallback that always works, because the value becomes selectable — never
                    // a silent no-op.
                    numbers.onToggle(document.id)
                  })
              },
            }
      }
      // The archive's rows run full-bleed to the screen edges with a rule below each, so the list
      // reads as a ledger page rather than as a stack of cards. The negative margin undoes the
      // shell's gutter for the rule only; the content keeps it.
      className={variant === 'divided' ? '-mx-gutter border-b border-rule px-gutter' : undefined}
    />
  ))

  return (
    <>
      {variant === 'card' ? <Card className="overflow-hidden p-0">{rows}</Card> : rows}

      {isLast && next_cursor !== null && (
        <div className="flex flex-col items-center gap-2 pt-4 pb-8">
          <Button
            variant="secondary"
            size="sm"
            className="rounded-pill px-[18px]"
            onClick={() => onLoadMore(next_cursor)}
          >
            Load {query.limit ?? 20} more
          </Button>
          <span className="text-meta text-ink-3">
            Showing {data.length} of what’s loaded · newest cursor
          </span>
        </div>
      )}
    </>
  )
}
