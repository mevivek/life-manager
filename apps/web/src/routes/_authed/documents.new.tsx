import { createFileRoute, Link, useNavigate } from '@tanstack/react-router'
import { DocumentForm } from '@/features/documents/DocumentForm'
import { useCreateDocument } from '@/features/documents/useDocuments'

export const Route = createFileRoute('/_authed/documents/new')({ component: NewDocumentPage })

/**
 * Capture, as a full page. domains/documents.md §7, and the screen Q2's answer is really about.
 *
 * ── This is the sheet's twin, not its replacement ──
 *
 * The Add tab opens `AddDocumentSheet` over whatever you were looking at, and that is the path
 * essentially every capture takes. **This route stays because a sheet has no URL**: a home-screen
 * shortcut, a shared link, and the Now screen's zero state all need somewhere to point. It renders the
 * same `DocumentForm` against the same mutation, so there is one create path with two doors.
 *
 * No `Card` wrapper and no "What is it?" sub-heading. Both were framing the form as *a form inside a
 * panel on a page*; ADR-0024 makes the screen itself the container, so the serif title sits directly
 * above the fields.
 *
 * On success it navigates to the **detail** page rather than back to the list, because the next thing a
 * person wants after naming a document is to attach the scan — and a list would hide the thing they
 * just created among everything else.
 */
function NewDocumentPage() {
  const navigate = useNavigate()
  const create = useCreateDocument()

  return (
    <div>
      <Link
        to="/documents"
        className="-ml-1 inline-flex min-h-tap items-center gap-[7px] px-1 text-body font-medium text-ink-2"
      >
        <span
          aria-hidden="true"
          className="h-3 w-[7px] rotate-45 border-b-[1.5px] border-l-[1.5px] border-ink-2"
        />
        Documents
      </Link>

      <h1 className="mt-1.5 mb-4 font-serif text-title font-normal leading-tight">
        Add a document
      </h1>

      <DocumentForm
        submitLabel="Save"
        onCancel={() => void navigate({ to: '/documents' })}
        onSubmit={async (values) => {
          const created = await create.mutateAsync(values)
          await navigate({
            to: '/documents/$documentId',
            params: { documentId: created.id },
          })
        }}
      />
    </div>
  )
}
