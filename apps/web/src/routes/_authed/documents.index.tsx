import { createFileRoute } from '@tanstack/react-router'
import { DocumentList } from '@/features/documents/DocumentList'

export const Route = createFileRoute('/_authed/documents/')({ component: DocumentsPage })

/**
 * The document list. domains/documents.md §7.
 *
 */
function DocumentsPage() {
  return (
    <div className="flex flex-col gap-6">
      {/* The tab bar owns "Add" on every screen, so repeating it here would be noise. */}
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Documents</h1>
        <p className="text-sm text-muted-foreground">Sorted by what expires soonest.</p>
      </div>

      <DocumentList emptyMessage="No documents yet. Add your passport and see what happens." />
    </div>
  )
}
