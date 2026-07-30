import type { DocumentDetailResponse } from '@life-manager/shared'
import { createFileRoute, Link, useNavigate } from '@tanstack/react-router'
import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { Eyebrow } from '@/components/ui/label'
import { Skeleton } from '@/components/ui/skeleton'
import { Toast } from '@/components/ui/toast'
import { DocumentFiles } from '@/features/documents/DocumentFiles'
import { DocumentForm } from '@/features/documents/DocumentForm'
import { DocumentReminders } from '@/features/documents/DocumentReminders'
import {
  ExpiryGlyph,
  ExpiryWords,
  expiryOf,
  formatDate,
  STATUS_BG,
} from '@/features/documents/ExpiryStatus'
import { IdentifierCard } from '@/features/documents/IdentifierCard'
import { numberLabelFor } from '@/features/documents/presets'
import {
  useDeleteDocument,
  useDocument,
  useUpdateDocument,
} from '@/features/documents/useDocuments'
import { cn } from '@/lib/utils'

export const Route = createFileRoute('/_authed/documents/$documentId')({
  component: DocumentDetailPage,
})

/**
 * Document detail. domains/documents.md §7, ADR-0025 §7.
 *
 * The screen is ordered by what a person came here to find out:
 *
 *  1. **The status block** — is it still valid, when does it expire, and what will tell me. Tinted with
 *     the state's own background, so the answer is legible before any text is read.
 *  2. **Details** — the metadata, with unset fields shown as italic "Not set" rather than hidden.
 *  3. **Scans** — the versions.
 *  4. **Delete** — quiet, at the bottom, text-only.
 *
 * That order is why the previous four-equal-`Card` stack is gone: it gave "Delete" the same visual
 * weight as the expiry date.
 */
function DocumentDetailPage() {
  const { documentId } = Route.useParams()
  const navigate = useNavigate()
  const [editing, setEditing] = useState(false)
  const [confirmingDelete, setConfirmingDelete] = useState(false)
  const [toast, setToast] = useState<string | null>(null)

  const document = useDocument(documentId)
  const update = useUpdateDocument(documentId)
  const remove = useDeleteDocument()

  if (document.isPending) {
    return (
      <div role="status" aria-label="Loading document" aria-live="polite">
        <Skeleton className="h-3 w-20 rounded-1" />
        <Skeleton className="mt-3 h-7 w-56" />
        <Skeleton className="mt-4 h-28 w-full rounded-3" />
        <Skeleton className="mt-5 h-40 w-full rounded-3" />
      </div>
    )
  }

  if (document.isError) {
    /**
     * A 404 here is indistinguishable from "belongs to another space", deliberately — invariant 4: a
     * 403 would confirm the record exists. So this copy must not speculate about which it was, and
     * the last line is there to stop the reader doing it either.
     */
    return (
      <div>
        <BackLink />
        <div className="px-8 py-14 text-center">
          <div
            aria-hidden="true"
            className="mx-auto mb-4 h-[19px] w-[15px] rounded-1 border-[1.5px] border-ink-3"
          />
          <p className="font-serif text-[1.25rem] leading-snug">This document isn’t here</p>
          <p className="mt-2 text-body leading-relaxed text-ink-3 [text-wrap:pretty]">
            It may have been deleted, or the link is wrong. Nothing else to read into it.
          </p>
          <Link
            to="/documents"
            className="mt-4 inline-flex min-h-tap items-center rounded-2 border border-rule-2 px-4 text-body font-medium"
          >
            Back to documents
          </Link>
        </div>
      </div>
    )
  }

  const detail = document.data
  const expiry = expiryOf(detail.expires_on)

  return (
    <div>
      <BackLink />

      <div className="pt-1.5">
        <Eyebrow>{detail.doc_type === 'other' ? 'No type' : capitalise(detail.doc_type)}</Eyebrow>
        <h1 className="mt-2 font-serif text-[1.6875rem] font-normal leading-[1.18] tracking-tight-display">
          {detail.title}
        </h1>
      </div>

      {/* ── 1. Status ── */}
      <Card className={cn('mt-4 p-4', STATUS_BG[expiry.state])}>
        <div className="flex items-center gap-3">
          <ExpiryGlyph state={expiry.state} size={15} />
          <div>
            <ExpiryWords expiry={expiry} size="large" className="block" />
            <p className="mt-0.5 text-body text-ink-2">
              {detail.expires_on === null
                ? // Q1, said out loud. An empty slot here would read as data the user failed to enter.
                  'Nothing to count down to. That’s not a gap.'
                : expiry.state === 'expired'
                  ? `Expired ${formatDate(detail.expires_on)} — renew it or delete the record`
                  : formatDate(detail.expires_on)}
            </p>
          </div>
        </div>

        <DocumentReminders
          documentId={documentId}
          reminders={detail.reminders}
          expiresOn={detail.expires_on}
          docType={detail.doc_type}
        />
      </Card>

      {/* ── 2. Details ── */}
      <section className="mt-5">
        <div className="flex items-baseline justify-between pb-1">
          <Eyebrow>Details</Eyebrow>
          <Button
            variant="quiet"
            size="bare"
            className="px-1 text-meta"
            onClick={() => setEditing((previous) => !previous)}
          >
            {editing ? 'Cancel' : 'Edit'}
          </Button>
        </div>

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
          <>
            <dl className="list-none">
              {fieldsOf(detail).map((field) => (
                <div
                  key={field.label}
                  className="flex min-h-12 items-baseline gap-3.5 border-b border-rule py-3"
                >
                  <dt className="w-24 shrink-0 text-body text-ink-3">{field.label}</dt>
                  <dd
                    className={cn(
                      'flex-1 [text-wrap:pretty]',
                      field.value === null
                        ? // Unset is italic and muted — visibly "not filled in yet" rather than
                          // missing. Q2 makes half-empty documents normal, and a field that vanished
                          // would read as a bug.
                          'text-body italic text-ink-3'
                        : cn('text-row', field.mono === true && 'font-mono text-body'),
                      field.selectable === true && 'selectable',
                    )}
                  >
                    {field.value ?? 'Not set'}
                  </dd>
                </div>
              ))}
            </dl>

            {/*
              ADR-0026 replaced the old "we only ever keep the last four" card. The number is stored
              in full now, so the card reveals rather than explains a truncation — see
              `IdentifierCard` for why the mask is a display state and not a boundary.

              The label names the real document, via the same preset table the capture form uses:
              "Aadhaar number" rather than "Number". Falls back to "Number" for a document whose
              title matches no preset, which is most warranties and receipts.
            */}
            <IdentifierCard
              identifier={detail.identifier}
              last4={detail.identifier_last4}
              label={numberLabelFor(detail.title, detail.doc_type)}
            />
          </>
        )}
      </section>

      {/* ── 3. Scans ── */}
      <section className="mt-6">
        <div className="flex items-baseline justify-between pb-2.5">
          <Eyebrow>Scans</Eyebrow>
          <span className="text-meta text-ink-3">{scanCount(detail)}</span>
        </div>
        <DocumentFiles documentId={documentId} files={detail.files} />
      </section>

      {/* ── 4. Delete ── */}
      <section className="mt-7 border-t border-rule pt-4">
        {confirmingDelete ? (
          <div className="flex flex-col gap-2">
            <p className="text-body text-ink-2 [text-wrap:pretty]">
              {/*
                ═══════════════════════════════════════════════════════════════════════════
                 The comp said "Recoverable for 30 days". This says what is actually true.
                ═══════════════════════════════════════════════════════════════════════════

                `DELETE /documents/:id` is a soft delete — it sets `deleted_at`, and every repository
                query filters `deleted_at IS NULL`. So the row does survive. But there is **no restore
                endpoint and no purge job**, which means "recoverable for 30 days" would promise two
                things the system does not do: a route back, and a deadline. Recoverable by someone
                with database access is not recoverable by the user.

                Uploaded files are genuinely kept, so that half is safe to say. See ADR-0025 §10.
              */}
              Deleting hides this document and stops its reminders. The uploaded scans are kept, so
              an accidental delete is not final — but there is no undo button yet.
            </p>
            <div className="flex gap-2">
              <Button
                variant="destructive"
                size="sm"
                className="border border-status-late"
                disabled={remove.isPending}
                onClick={async () => {
                  await remove.mutateAsync(documentId)
                  setToast('Deleted')
                  await navigate({ to: '/documents' })
                }}
              >
                {remove.isPending ? 'Deleting…' : 'Yes, delete it'}
              </Button>
              <Button variant="secondary" size="sm" onClick={() => setConfirmingDelete(false)}>
                Keep it
              </Button>
            </div>
          </div>
        ) : (
          <Button
            variant="destructive"
            size="bare"
            className="px-0"
            onClick={() => setConfirmingDelete(true)}
          >
            Delete this document
          </Button>
        )}
      </section>

      {/* No `action` on the toast: there is nothing an Undo button could call. See ui/toast.tsx. */}
      {toast !== null && <Toast message={toast} onDismiss={() => setToast(null)} />}
    </div>
  )
}

/**
 * Back to the archive.
 *
 * Always "Documents" rather than remembering where the user came from. The comp tracked the origin
 * screen and labelled the link accordingly, but a back link that changes its own text between visits
 * is harder to learn than one that always names the same place — and the tab bar already offers Now.
 */
function BackLink() {
  return (
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
  )
}

type Field = {
  label: string
  value: string | null
  mono?: boolean
  selectable?: boolean
}

/**
 * The metadata rows, including the per-type `custom_attrs`.
 *
 * ── Why `custom_attrs` is read here but not written ──
 *
 * `CUSTOM_ATTRS_BY_TYPE` gives each `doc_type` its own validated shape — a warranty has a vendor,
 * product, serial and purchase price; a receipt has a vendor and an amount. Those are real fields on
 * real documents and the comp shows them, so they are displayed. They are **not** editable, because
 * an editor would need a per-type form generated from seven Zod schemas, and `documents.md` §9
 * question 2 leaves user-defined fields explicitly open. Reading what exists costs nothing and hides
 * nothing; writing it is a feature.
 *
 * Values are read defensively — `custom_attrs` is `Record<string, unknown>` on the wire, so anything
 * put there by an older client is rendered only if it is a string or a number.
 */
function fieldsOf(detail: DocumentDetailResponse): Field[] {
  const fields: Field[] = [
    {
      label: 'Type',
      value: detail.doc_type === 'other' ? null : capitalise(detail.doc_type),
    },
    /**
     * "Whose" — always shown, and "Mine" when there is no holder.
     *
     * Not hidden for the owner's own documents the way the row badge is. A row is scanned in a list
     * where nine "Me" pills would be noise; a detail screen is one document being read deliberately,
     * and "Mine" is a fact worth stating next to Issuer and Type rather than an absence to infer.
     */
    {
      label: 'Whose',
      value:
        detail.holder == null || detail.holder === ''
          ? 'Mine'
          : detail.relation == null || detail.relation === ''
            ? detail.holder
            : `${detail.holder} · ${detail.relation}`,
    },
    { label: 'Issuer', value: emptyToNull(detail.issuer) },
    { label: 'Issued', value: detail.issued_on === null ? null : formatDate(detail.issued_on) },
    {
      label: 'Expires',
      value: detail.expires_on === null ? null : formatDate(detail.expires_on),
    },
    { label: 'Country', value: emptyToNull(detail.country) },
  ]

  const attrs = detail.custom_attrs
  const attr = (key: string): string | null => {
    const value = attrs[key]
    if (typeof value === 'string' && value.trim() !== '') return value
    if (typeof value === 'number') return String(value)
    return null
  }

  // Ordered per type, not alphabetically: on a warranty, "Vendor" before "Serial" is how the card in
  // the drawer reads.
  for (const [label, key, mono] of [
    ['Vendor', 'vendor', false],
    ['Product', 'product', false],
    ['Serial', 'serial_number', true],
    ['Counterparty', 'counterparty', false],
    ['Authority', 'issuing_authority', false],
    ['Issuing body', 'issuing_body', false],
    ['Credential', 'credential_id', true],
    ['Jurisdiction', 'jurisdiction', false],
  ] as const) {
    const value = attr(key)
    if (value !== null) fields.push({ label, value, mono, selectable: mono })
  }

  // Money last, and only with its currency — `decimalStringSchema` plus a currency code is the
  // contract's shape precisely so an amount is never rendered without one.
  for (const key of ['purchase_price', 'amount', 'value'] as const) {
    const amount = attr(key)
    if (amount === null) continue
    const currency = attr('currency')
    fields.push({
      label: 'Paid',
      value: currency === null ? amount : `${amount} ${currency}`,
      mono: true,
    })
    break
  }

  fields.push({
    label: 'Tags',
    value: detail.tags.length === 0 ? null : detail.tags.map((tag) => `#${tag}`).join(', '),
  })
  fields.push({ label: 'Notes', value: emptyToNull(detail.notes), selectable: true })

  return fields
}

/** `''` and `null` mean the same thing to a reader, so they are collapsed before rendering. */
function emptyToNull(value: string | null): string | null {
  return value === null || value.trim() === '' ? null : value
}

function scanCount(detail: DocumentDetailResponse): string {
  // Only confirmed versions — an unconfirmed presign is not a scan the user has (business rule 10).
  const confirmed = detail.files.filter((file) => file.uploaded_at !== null).length
  if (confirmed === 0) return 'None'
  return confirmed === 1 ? '1 version' : `${confirmed} versions`
}

function capitalise(value: string): string {
  return value.length === 0 ? value : value[0]?.toUpperCase() + value.slice(1)
}
