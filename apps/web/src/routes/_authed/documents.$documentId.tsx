import { createFileRoute, useNavigate } from '@tanstack/react-router'
import { useState } from 'react'
import { Alert } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Skeleton } from '@/components/ui/skeleton'
import { DocumentFiles } from '@/features/documents/DocumentFiles'
import { DocumentForm } from '@/features/documents/DocumentForm'
import { DocumentReminders } from '@/features/documents/DocumentReminders'
import { ExpiryBadge } from '@/features/documents/ExpiryBadge'
import {
  useDeleteDocument,
  useDocument,
  useUpdateDocument,
} from '@/features/documents/useDocuments'

export const Route = createFileRoute('/_authed/documents/$documentId')({
  component: DocumentDetailPage,
})

/** Document detail: metadata, file versions, reminders. domains/documents.md §7. */
function DocumentDetailPage() {
  const { documentId } = Route.useParams()
  const navigate = useNavigate()
  const [editing, setEditing] = useState(false)
  const [confirmingDelete, setConfirmingDelete] = useState(false)

  const document = useDocument(documentId)
  const update = useUpdateDocument(documentId)
  const remove = useDeleteDocument()

  if (document.isPending) {
    // Shaped like the real screen — a title, then three cards — so opening a document does not
    // flash an empty page and then reflow.
    return (
      <div className="flex flex-col gap-6" role="status" aria-label="Loading document">
        <div className="flex flex-col gap-2">
          <Skeleton className="h-7 w-48" />
          <Skeleton className="h-4 w-28" />
        </div>
        {[0, 1, 2].map((n) => (
          <Skeleton key={n} className="h-32 w-full rounded-lg" />
        ))}
      </div>
    )
  }

  if (document.isError) {
    // A 404 here is indistinguishable from "belongs to another space", deliberately (invariant 4).
    return <Alert variant="destructive">{document.error.message}</Alert>
  }

  const detail = document.data

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h1 className="text-xl font-semibold">{detail.title}</h1>
          <p className="text-sm text-muted-foreground">
            {detail.doc_type}
            {detail.issuer !== null && ` · ${detail.issuer}`}
          </p>
        </div>
        <ExpiryBadge expiresOn={detail.expires_on} />
      </div>

      <Card>
        <CardHeader className="flex-row items-center justify-between">
          <CardTitle>Details</CardTitle>
          <Button variant="ghost" size="sm" onClick={() => setEditing((previous) => !previous)}>
            {editing ? 'Cancel' : 'Edit'}
          </Button>
        </CardHeader>
        <CardContent>
          {editing ? (
            <DocumentForm
              initial={detail}
              submitLabel="Save changes"
              onCancel={() => setEditing(false)}
              onSubmit={async (values) => {
                // The version this form was populated FROM, not a fresh read — that is the whole
                // point of the precondition (ADR-0024). If the document changed while the form was
                // open, or while the edit sat in the outbox offline, the server refuses with 409
                // rather than overwriting the other change.
                await update.mutateAsync({ ...values, version: detail.version })
                setEditing(false)
              }}
            />
          ) : (
            <dl className="grid grid-cols-2 gap-x-4 gap-y-3">
              <Field label="Issued" value={detail.issued_on} />
              <Field label="Expires" value={detail.expires_on} />
              <Field label="Country" value={detail.country} />
              <Field
                label="Number"
                // Business rule 6: only the last four are ever stored. Shown masked so it is
                // obvious that the rest was never kept, rather than looking truncated by accident.
                value={detail.identifier_last4 === null ? null : `•••• ${detail.identifier_last4}`}
              />
              <Field
                label="Tags"
                value={detail.tags.length === 0 ? null : detail.tags.join(', ')}
              />
              <Field label="Notes" value={detail.notes} />
            </dl>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Files</CardTitle>
        </CardHeader>
        <CardContent>
          <DocumentFiles documentId={documentId} files={detail.files} />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Reminders</CardTitle>
        </CardHeader>
        <CardContent>
          <DocumentReminders
            documentId={documentId}
            reminders={detail.reminders}
            expiresOn={detail.expires_on}
          />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Delete</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-3">
          <p className="text-sm text-muted-foreground">
            Deleting hides the document and stops its reminders. The uploaded files are kept, so an
            accidental delete is recoverable.
          </p>
          {confirmingDelete ? (
            <div className="flex gap-2">
              <Button
                variant="destructive"
                size="sm"
                disabled={remove.isPending}
                onClick={async () => {
                  await remove.mutateAsync(documentId)
                  await navigate({ to: '/documents' })
                }}
              >
                {remove.isPending ? 'Deleting…' : 'Yes, delete it'}
              </Button>
              <Button variant="outline" size="sm" onClick={() => setConfirmingDelete(false)}>
                Keep it
              </Button>
            </div>
          ) : (
            <Button
              variant="outline"
              size="sm"
              className="self-start"
              onClick={() => setConfirmingDelete(true)}
            >
              Delete this document
            </Button>
          )}
        </CardContent>
      </Card>
    </div>
  )
}

/**
 * One metadata field. Renders "—" rather than hiding an empty value: Q2 means half-empty documents
 * are normal, and a field that vanishes reads as a bug, while a visible dash reads as "not filled
 * in yet" — which is exactly what it is, and an invitation to fill it.
 */
function Field({ label, value }: { label: string; value: string | null }) {
  return (
    <div>
      <dt className="text-xs uppercase tracking-wide text-muted-foreground">{label}</dt>
      <dd className="text-sm">{value ?? <span className="text-muted-foreground">—</span>}</dd>
    </div>
  )
}
