import { createFileRoute, useNavigate } from '@tanstack/react-router'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { DocumentForm } from '@/features/documents/DocumentForm'
import { useCreateDocument } from '@/features/documents/useDocuments'

export const Route = createFileRoute('/_authed/documents/new')({ component: NewDocumentPage })

/**
 * Capture. domains/documents.md §7, and the screen Q2's answer is really about.
 *
 * On success it navigates to the **detail** page rather than back to the list, because the next
 * thing a person wants after naming a document is to attach the scan — and a list would hide the
 * thing they just created among everything else.
 */
function NewDocumentPage() {
  const navigate = useNavigate()
  const create = useCreateDocument()

  return (
    <div className="flex flex-col gap-6">
      <h1 className="text-xl font-semibold">Add a document</h1>

      <Card>
        <CardHeader>
          <CardTitle>What is it?</CardTitle>
        </CardHeader>
        <CardContent>
          <DocumentForm
            submitLabel="Add document"
            onCancel={() => void navigate({ to: '/documents' })}
            onSubmit={async (values) => {
              const created = await create.mutateAsync(values)
              await navigate({
                to: '/documents/$documentId',
                params: { documentId: created.id },
              })
            }}
          />
        </CardContent>
      </Card>
    </div>
  )
}
