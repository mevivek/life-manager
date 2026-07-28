import { Link } from '@tanstack/react-router'
import { Alert } from '@/components/ui/alert'
import { DocumentListSkeleton } from '@/components/ui/skeleton'
import { ExpiryBadge } from './ExpiryBadge'
import { useDocuments } from './useDocuments'

/**
 * "Expiring in the next N days" — the dashboard panel and the focused actionable list from
 * domains/documents.md §7.
 *
 * Uses `?expiring_before=` server-side rather than filtering a full list in the browser. That
 * matters for more than efficiency: the filter deliberately excludes documents with no expiry date
 * (a null `expires_on` is not "expiring before" any date), which is Q1's answer expressed as a
 * query rather than as client logic.
 */
export function ExpiringSoon({ withinDays, limit = 10 }: { withinDays: number; limit?: number }) {
  const before = isoDaysFromNow(withinDays)
  const documents = useDocuments({
    expiring_before: before,
    limit,
    sort: 'expires_on',
    order: 'asc',
  })

  if (documents.isPending) return <DocumentListSkeleton count={2} />
  if (documents.isError) return <Alert variant="destructive">{documents.error.message}</Alert>

  const rows = documents.data.data

  if (rows.length === 0) {
    return (
      <p className="text-sm text-muted-foreground">
        Nothing expiring in the next {withinDays} days. That is the point.
      </p>
    )
  }

  return (
    <ul className="flex flex-col gap-2">
      {rows.map((document) => (
        <li key={document.id}>
          <Link
            to="/documents/$documentId"
            params={{ documentId: document.id }}
            className="flex items-center justify-between gap-3 rounded-md border border-border px-3 py-2 hover:bg-secondary"
          >
            <span className="truncate text-sm font-medium">{document.title}</span>
            <ExpiryBadge expiresOn={document.expires_on} />
          </Link>
        </li>
      ))}
    </ul>
  )
}

/** `YYYY-MM-DD`, `days` from today, in UTC — matching how the server compares `date` columns. */
function isoDaysFromNow(days: number): string {
  const date = new Date()
  date.setUTCDate(date.getUTCDate() + days)
  return date.toISOString().slice(0, 10)
}
