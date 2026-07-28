import type { Document, DocumentListQuery } from '@life-manager/shared'
import { documentTypeSchema } from '@life-manager/shared'
import { Link } from '@tanstack/react-router'
import { useState } from 'react'
import { Alert } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { ExpiryBadge } from './ExpiryBadge'
import { useDocuments } from './useDocuments'

/**
 * The document list. domains/documents.md §7: "search, filter by type and tag, sorted by expiry.
 * Expiry badges."
 *
 * Pagination is cursor-based and **append-only** — "Load more" rather than numbered pages. That
 * follows from the API (conventions/api.md §4: cursors, because offsets break when rows are
 * inserted mid-scroll) and from the main consumer being a phone.
 */

export type DocumentListProps = {
  /** Extra filters merged into every query — used by the "expiring soon" view. */
  baseQuery?: Partial<DocumentListQuery>
  /** Hidden on a pre-filtered view, where a type filter would be confusing. */
  showFilters?: boolean
  emptyMessage?: string
}

export function DocumentList({
  baseQuery = {},
  showFilters = true,
  emptyMessage = 'Nothing here yet.',
}: DocumentListProps) {
  const [search, setSearch] = useState('')
  const [type, setType] = useState<string>('')
  const [cursors, setCursors] = useState<string[]>([])

  const query: Partial<DocumentListQuery> = {
    ...baseQuery,
    ...(search.trim() === '' ? {} : { q: search.trim() }),
    ...(type === '' ? {} : { type: [type as Document['doc_type']] }),
  }

  // One query per page, keyed by its cursor. Simpler than `useInfiniteQuery` here because the
  // filters reset the list anyway, and it keeps every page in the cache for a back-navigation.
  const pages = [undefined, ...cursors].map((cursor) => ({ cursor }))

  return (
    <div className="flex flex-col gap-4">
      {showFilters && (
        <div className="flex flex-col gap-2 sm:flex-row">
          <Input
            type="search"
            placeholder="Search titles, issuers, notes and tags"
            value={search}
            onChange={(event) => {
              setSearch(event.target.value)
              // A new search is a new list. Keeping the old cursors would page into results that
              // no longer exist.
              setCursors([])
            }}
            className="sm:flex-1"
          />
          <select
            className="h-11 rounded-md border border-input bg-transparent px-3 text-sm"
            value={type}
            onChange={(event) => {
              setType(event.target.value)
              setCursors([])
            }}
            aria-label="Filter by type"
          >
            <option value="">All types</option>
            {documentTypeSchema.options.map((option) => (
              <option key={option} value={option}>
                {option}
              </option>
            ))}
          </select>
        </div>
      )}

      {pages.map((page, index) => (
        <DocumentPage
          // The cursor identifies the page; index is the fallback for the first one.
          key={page.cursor ?? 'first'}
          query={{ ...query, ...(page.cursor === undefined ? {} : { cursor: page.cursor }) }}
          isLast={index === pages.length - 1}
          emptyMessage={index === 0 ? emptyMessage : undefined}
          onLoadMore={(cursor) => setCursors((previous) => [...previous, cursor])}
        />
      ))}
    </div>
  )
}

function DocumentPage({
  query,
  isLast,
  emptyMessage,
  onLoadMore,
}: {
  query: Partial<DocumentListQuery>
  isLast: boolean
  emptyMessage?: string
  onLoadMore: (cursor: string) => void
}) {
  const documents = useDocuments(query)

  if (documents.isPending) {
    return <p className="text-sm text-muted-foreground">Loading…</p>
  }

  if (documents.isError) {
    return <Alert variant="destructive">{documents.error.message}</Alert>
  }

  const { data, next_cursor } = documents.data

  if (data.length === 0 && emptyMessage !== undefined) {
    return <p className="text-sm text-muted-foreground">{emptyMessage}</p>
  }

  return (
    <>
      <ul className="flex flex-col gap-2">
        {data.map((document) => (
          <li key={document.id}>
            <DocumentRow document={document} />
          </li>
        ))}
      </ul>

      {isLast && next_cursor !== null && (
        <Button variant="outline" size="sm" onClick={() => onLoadMore(next_cursor)}>
          Load more
        </Button>
      )}
    </>
  )
}

function DocumentRow({ document }: { document: Document }) {
  return (
    <Link
      to="/documents/$documentId"
      params={{ documentId: document.id }}
      className="flex items-center justify-between gap-3 rounded-md border border-border px-3 py-3 hover:bg-secondary"
    >
      <div className="min-w-0">
        <p className="truncate text-sm font-medium">{document.title}</p>
        <p className="truncate text-xs text-muted-foreground">
          {[
            document.doc_type,
            document.issuer,
            // Surfaced because "documents with no file" is a real dashboard view (§7) and the
            // single most common thing to have left half-done.
            document.file_count === 0 ? 'no file' : `${document.file_count} file(s)`,
          ]
            .filter((part) => part !== null && part !== '')
            .join(' · ')}
        </p>
      </div>
      <ExpiryBadge expiresOn={document.expires_on} />
    </Link>
  )
}
