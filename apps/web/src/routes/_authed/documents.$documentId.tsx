import type { DocumentDetailResponse } from '@life-manager/shared'
import { createFileRoute, Link, useNavigate } from '@tanstack/react-router'
import { useState } from 'react'
import { RecordMeta } from '@/components/RecordMeta'
import { Alert } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { Eyebrow } from '@/components/ui/label'
import { Skeleton } from '@/components/ui/skeleton'
import { Toast } from '@/components/ui/toast'
import { BelongsTo } from '@/features/documents/BelongsTo'
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
import { WhoseSheet } from '@/features/people/WhoseSheet'
import { cn } from '@/lib/utils'

export const Route = createFileRoute('/_authed/documents/$documentId')({
  component: DocumentDetailRoute,
})

/**
 * The route reads the param; the screen takes it as a prop.
 *
 * Split for the same reason `home.tsx` exports `NowPage`: `Route.useParams()` resolves against the
 * *generated* route id, so a component that calls it can only be rendered under the real route tree —
 * which puts the whole `_authed` guard, the persister and the provider stack between a test and the one
 * screen it wants to assert on. With the id as a prop, `DocumentDetailPage` mounts under a two-route
 * memory router (`useNavigate` and the back `<Link>` still need one) and the version precondition below
 * becomes testable.
 */
function DocumentDetailRoute() {
  const { documentId } = Route.useParams()
  return <DocumentDetailPage documentId={documentId} />
}

/**
 * Document detail. domains/documents.md §7, ADR-0025 §7.
 *
 * The screen is ordered by what a person came here to find out:
 *
 *  1. **The status block** — is it still valid, when does it expire, and what will tell me. Tinted with
 *     the state's own background, so the answer is legible before any text is read.
 *  2. **Details** — the metadata, with unset fields shown as italic "Not set" rather than hidden.
 *  3. **Scans** — the versions. Tapping an image opens the full-screen viewer.
 *  4. **Belongs to** — the thing this paperwork proves, or an invitation to link one (ADR-0029).
 *  5. **Delete** — quiet, text-only, the last *control* on the screen.
 *  6. **When it was added** — the page foot, under the delete rather than above it. Provenance is the
 *     quietest fact here and the only one nobody arrives wanting; `RecordMeta` argues the placement.
 *
 * That order is why the previous four-equal-`Card` stack is gone: it gave "Delete" the same visual
 * weight as the expiry date.
 */
export function DocumentDetailPage({ documentId }: { documentId: string }) {
  const navigate = useNavigate()
  const [editing, setEditing] = useState(false)
  /**
   * The version this screen was showing when the delete confirmation was RAISED, or `null` when it
   * is not raised — ADR-0024 and debt D41.
   *
   * A boolean plus `detail.version` read at the moment of the tap was the same defeat of the
   * precondition the edit form had: `useDocument` refetches on window focus, so a confirmation left
   * open while the app was backgrounded came back holding a newer version, and the delete then
   * carried a precondition it had just been handed rather than the one the user decided against.
   */
  const [confirmingDelete, setConfirmingDelete] = useState<number | null>(null)
  const [toast, setToast] = useState<string | null>(null)
  /** Set when an edit went to the outbox instead of the server (ADR-0024). Cleared by the next edit. */
  const [queuedEdit, setQueuedEdit] = useState(false)
  /**
   * The version this screen was showing when the **Whose** sheet was opened, or `null` when it is
   * closed — the same snapshot the delete confirmation keeps, and for the same reason (ADR-0024,
   * debt D41).
   *
   * `useDocument` refetches on window focus, so reading `detail.version` at the moment a name is
   * tapped would hand the patch a precondition it had just been given: an edit made on another device
   * while this sheet sat open would be overwritten instead of coming back as a 409.
   */
  const [whoseVersion, setWhoseVersion] = useState<number | null>(null)

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
          <p className="font-heading text-[1.25rem] font-face-h leading-snug">
            This document isn’t here
          </p>
          <p className="mt-2 text-body leading-relaxed text-ink-3 [text-wrap:pretty]">
            It may have been deleted, or the link is wrong. Nothing else to read into it.
          </p>
          <Link
            to="/library"
            search={{ scope: 'documents' }}
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
        <h1 className="mt-2 font-heading text-[1.6875rem] font-face-h leading-[1.18] tracking-heading">
          {detail.title}
        </h1>
      </div>

      {/* ── 1. Status ── */}
      <Card className={cn('mt-4 p-card', STATUS_BG[expiry.state])}>
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
            onClick={() => {
              setQueuedEdit(false)
              setEditing((previous) => !previous)
            }}
          >
            {editing ? 'Cancel' : 'Edit'}
          </Button>
        </div>

        {editing ? (
          <DocumentForm
            initial={detail}
            submitLabel="Save changes"
            onCancel={() => setEditing(false)}
            onSubmit={async (values, seededVersion) => {
              /**
               * `seededVersion` is the version the form's FIELDS were populated from — handed back by
               * `DocumentForm`, frozen at its mount. Not `detail.version`, which is live: a focus
               * refetch can advance it while the inputs still hold the older values, and stamping
               * old values with the new version is how the server's `where version = :expected`
               * matches and another device's edit disappears (ADR-0024).
               *
               * The `?? detail.version` arm is unreachable — this form is only rendered with
               * `initial`, so the version is always a number — and it is a fallback rather than a
               * `!` because `noNonNullAssertion` is a lint error and sending the live version is a
               * far better failure than crashing on a save.
               */
              const result = await update.mutateAsync({
                ...values,
                version: seededVersion ?? detail.version,
              })
              setEditing(false)
              /**
               * Offline the mutation resolves `{ queued: true }` and nothing has been saved yet
               * (ADR-0024). Closing the form without saying so redraws the *unchanged* cache, which
               * reads as a save that reverted — so the queued branch says what happened, exactly as
               * `BelongsTo` does for the link. `Document` has no `queued` key, so this narrows
               * without a cast.
               */
              if ('queued' in result) setQueuedEdit(true)
            }}
          />
        ) : (
          <>
            <dl className="list-none">
              {fieldsOf(detail, () => setWhoseVersion(detail.version)).map((field) => (
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
                    {field.onEdit === undefined ? (
                      (field.value ?? 'Not set')
                    ) : (
                      /*
                        ── The one editable row, and the VALUE is the control ──

                        The comp makes the whole field row tappable (`f.edit`, comp 602) and gives only
                        Whose an `edit`. A `<div onClick>` spanning a `<dt>`/`<dd>` pair cannot be that
                        control here: it is neither a valid child of `<dl>` nor announced as anything
                        activatable. So the value itself becomes a real `<button>` — same words, same
                        place, and a 44px hit area (design.md §6) that a screen reader announces with
                        both the current answer and what pressing it does.

                        `-my-2` claws back the row's own vertical padding so the taller target does not
                        make this row stand a step off the ones above and below it.
                      */
                      <button
                        type="button"
                        onClick={field.onEdit}
                        aria-label={`${field.label}: ${field.value ?? 'Not set'}. Change it.`}
                        className="-my-2 inline-flex min-h-tap items-center gap-2.5 text-left"
                      >
                        <span>{field.value ?? 'Not set'}</span>
                        <span aria-hidden="true" className="text-meta font-medium text-ink-3">
                          Change
                        </span>
                      </button>
                    )}
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

        {queuedEdit && (
          <Alert variant="notice" className="mt-2">
            Saved on this device. The change will be sent when you’re back online — you can watch it
            in the outbox. The details above are still the last ones the server has.
          </Alert>
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

      {/* ── 4. Belongs to ──
          The cross-domain link, ADR-0029. Placed after the scans and before Delete, which is the
          comp's own order (533–560): it is a fact about the document, so it belongs above the one
          destructive control and below the thing you came here to look at. */}
      <BelongsTo document={detail} />

      {/* ── 5. Delete ── */}
      <section className="mt-7 border-t border-rule pt-4">
        {confirmingDelete !== null ? (
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
                  // `confirmingDelete` is the version the screen was showing when this confirmation
                  // was raised — debt D41. Not `detail.version`, which a focus refetch can advance
                  // while the panel sits open: re-reading it would hand the delete a precondition it
                  // has just been given, so a document edited elsewhere in the meantime would be
                  // destroyed instead of refused with 409.
                  await remove.mutateAsync({ id: documentId, version: confirmingDelete })
                  setToast('Deleted')
                  await navigate({ to: '/library', search: { scope: 'documents' } })
                }}
              >
                {remove.isPending ? 'Deleting…' : 'Yes, delete it'}
              </Button>
              <Button variant="secondary" size="sm" onClick={() => setConfirmingDelete(null)}>
                Keep it
              </Button>
            </div>
          </div>
        ) : (
          <Button
            variant="destructive"
            size="bare"
            className="px-0"
            // Snapshots the version the user is deciding against, not the one that happens to be in
            // the cache when they tap "Yes, delete it". See the note on the state.
            onClick={() => setConfirmingDelete(detail.version)}
          >
            Delete this document
          </Button>
        )}
      </section>

      {/* ── 6. When it was added, and when it last changed ──
          The page foot, under the one control rather than above it: it is the quietest fact on the
          screen and the only one nobody opens the app to ask. See `RecordMeta.tsx`. */}
      <RecordMeta createdAt={detail.created_at} updatedAt={detail.updated_at} />

      {/*
        ── "Whose document is this?" — ADR-0034 ──

        The sheet offers Mine, everybody in the People directory, everybody derived from the records
        themselves, and a door to add somebody new. Picking one is a `PATCH` of this document's
        `holder`, carrying `whoseVersion` — the version the screen was showing when the sheet was
        **opened**, never `detail.version` read at the tap. See the note on that state.

        A holder is a **label** and this changes nothing about who can read the record: `space_id` is
        still the only thing that decides that (invariant 2, documents.md §4 rule 13).

        **Mounted only while it is open**, rather than rendered closed. `Sheet` returns `null` when
        shut, but the hooks above it do not — so a permanently mounted sheet would fetch the directory
        and the derived holders on every visit to every document, for a panel most visits never open.
      */}
      {whoseVersion !== null && (
        <WhoseSheet
          open
          onClose={() => setWhoseVersion(null)}
          holder={detail.holder}
          onPick={async (holder, relation) => {
            const version = whoseVersion
            setWhoseVersion(null)
            if (version === null) return

            try {
              const result = await update.mutateAsync({ holder, relation, version })
              /*
              Offline the mutation resolves `{ queued: true }` and nothing has been saved yet
              (ADR-0024). Saying "Filed under Priya" then would be the app claiming a write it has
              only written down — the same distinction the edit form's `queuedEdit` draws.
            */
              setToast(
                'queued' in result
                  ? 'Saved on this device — it will be sent when you’re back online'
                  : holder === null
                    ? 'Filed under you'
                    : `Filed under ${holder}`,
              )
            } catch (error) {
              // Never swallowed: a 409 here means somebody else moved the document, and a sheet that
              // closed silently would leave the old name on screen looking like a save.
              setToast(error instanceof Error ? error.message : 'That could not be saved.')
            }
          }}
        />
      )}

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
      to="/library"
      search={{ scope: 'documents' }}
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
  /**
   * Makes this row's value a button. Exactly one field has one — **Whose** — because it is the only
   * fact on this screen with a picker behind it (ADR-0034). Everything else is edited through the
   * form above, which is where a field that needs a keyboard belongs.
   */
  onEdit?: () => void
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
function fieldsOf(detail: DocumentDetailResponse, onEditWhose: () => void): Field[] {
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
     *
     * **The only field here that opens something.** `onEdit` raises the Whose sheet — see the note on
     * `<WhoseSheet>` above for why the version is snapshotted rather than read at the tap.
     */
    {
      label: 'Whose',
      value:
        detail.holder == null || detail.holder === ''
          ? 'Mine'
          : detail.relation == null || detail.relation === ''
            ? detail.holder
            : `${detail.holder} · ${detail.relation}`,
      onEdit: onEditWhose,
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
