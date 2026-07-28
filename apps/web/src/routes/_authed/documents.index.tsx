import { createFileRoute, Link } from '@tanstack/react-router'
import { buttonVariants } from '@/components/ui/button'
import { DocumentList } from '@/features/documents/DocumentList'

export const Route = createFileRoute('/_authed/documents/')({ component: DocumentsPage })

/**
 * The document list. domains/documents.md §7.
 *
 * `buttonVariants` on a `Link` rather than a `Button` wrapping one: `Button` is a plain `<button>`
 * with no `asChild` slot, and nesting an anchor inside a button is invalid HTML that breaks
 * keyboard navigation.
 */
function DocumentsPage() {
  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-center justify-between gap-4">
        <div>
          <h1 className="text-xl font-semibold">Documents</h1>
          <p className="text-sm text-muted-foreground">Sorted by what expires soonest.</p>
        </div>
        <Link to="/documents/new" className={buttonVariants({ size: 'sm' })}>
          Add
        </Link>
      </div>

      <DocumentList emptyMessage="No documents yet. Add your passport and see what happens." />
    </div>
  )
}
