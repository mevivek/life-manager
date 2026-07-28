import { zodResolver } from '@hookform/resolvers/zod'
import {
  countryCodeSchema,
  type DocumentCreate,
  type DocumentDetailResponse,
  documentCreateSchema,
  documentTypeSchema,
} from '@life-manager/shared'
import { useState } from 'react'
import { useForm } from 'react-hook-form'
import { z } from 'zod'
import { Alert } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { ApiError } from '@/lib/api'
import { useIssuers } from './useDocuments'

/**
 * Create / edit a document. domains/documents.md §7: "title-first, everything else progressively
 * disclosed."
 *
 * ═══════════════════════════════════════════════════════════════════════════════════════
 *  ONE required field, and that is a product decision — not an oversight.
 * ═══════════════════════════════════════════════════════════════════════════════════════
 *
 * Q2 (product/open-questions.md §2) was answered explicitly: title only, everything else optional
 * and backfillable. Capture friction is the bigger risk, because a required field is paid on every
 * single capture forever while missing metadata is fixable at any time.
 *
 * So the extra fields sit behind a disclosure toggle and the form submits with the title alone.
 * **Do not promote a second field to required without re-answering Q2.**
 *
 * Validation is `documentCreateSchema` from `packages/shared` — the same schema the server
 * validates with (ADR-0004). It is here for UX only: the server is authoritative, and a rule that
 * existed only here would not exist at all (invariant 5).
 */

/**
 * ═══════════════════════════════════════════════════════════════════════════════════════
 *  Empty strings must become `null` BEFORE validation, not after.
 * ═══════════════════════════════════════════════════════════════════════════════════════
 *
 * A cleared HTML input yields `''`. `documentCreateSchema` types the optional dates as
 * `z.iso.date().nullish()`, which **rejects** `''` — so validating the raw form values means a
 * document with no expiry date cannot be submitted at all. That is not a cosmetic bug: it breaks
 * the exact case Q2 exists to protect, where the user fills in a title and nothing else.
 *
 * Normalising in the submit handler does not fix it, because the resolver runs first. So it is
 * declared here, in the schema, and validation and submission cannot disagree.
 */
const blank = z.literal('').transform(() => null)

const documentFormSchema = documentCreateSchema.extend({
  issuer: z.union([blank, documentCreateSchema.shape.issuer]),
  issued_on: z.union([blank, documentCreateSchema.shape.issued_on]),
  expires_on: z.union([blank, documentCreateSchema.shape.expires_on]),
  notes: z.union([blank, documentCreateSchema.shape.notes]),
  /**
   * Uppercased on the way through: `countryCodeSchema` is `^[A-Z]{2}$`, and rejecting `gb` for
   * being lowercase would be a pointless 400 on a field the user typed correctly.
   */
  country: z.union([
    blank,
    z
      .string()
      .trim()
      .transform((value) => value.toUpperCase())
      // `countryCodeSchema`, not `documentCreateSchema.shape.country`: the latter is
      // `optional(nullable(string))`, whose input accepts null — which a pipe target cannot.
      .pipe(countryCodeSchema),
  ]),
})

/** The schema's INPUT type: what the form fields hold before defaults and coercion. */
type DocumentFormValues = z.input<typeof documentFormSchema>

const TYPE_LABELS: Record<string, string> = {
  identity: 'Identity',
  financial: 'Financial',
  legal: 'Legal',
  warranty: 'Warranty',
  receipt: 'Receipt',
  certificate: 'Certificate',
  other: 'Other',
}

export type DocumentFormProps = {
  /** Present when editing; absent when creating. */
  initial?: DocumentDetailResponse
  onSubmit: (values: DocumentCreate) => Promise<unknown>
  onCancel?: () => void
  submitLabel?: string
}

export function DocumentForm({ initial, onSubmit, onCancel, submitLabel }: DocumentFormProps) {
  const [serverError, setServerError] = useState<string | null>(null)
  // Open by default when editing: if a document already has detail, hiding it looks like data loss.
  const [showMore, setShowMore] = useState(initial !== undefined)
  const issuers = useIssuers()

  /**
   * Three generics, not one, and it is not optional.
   *
   * `documentCreateSchema` has defaults (`doc_type`, `tags`, `custom_attrs`), so its **input** type
   * has them optional while its **output** type has them required. React Hook Form needs the input
   * type for the field registry and the output type for what `handleSubmit` hands you; collapsing
   * them into `useForm<DocumentCreate>` makes the resolver un-assignable.
   */
  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<DocumentFormValues, unknown, DocumentCreate>({
    resolver: zodResolver(documentFormSchema),
    defaultValues: {
      title: initial?.title ?? '',
      doc_type: initial?.doc_type ?? 'other',
      issuer: initial?.issuer ?? '',
      issued_on: initial?.issued_on ?? '',
      expires_on: initial?.expires_on ?? '',
      country: initial?.country ?? '',
      notes: initial?.notes ?? '',
      tags: initial?.tags ?? [],
    },
  })

  const submit = handleSubmit(async (values) => {
    setServerError(null)
    try {
      // `values` is already coerced by `documentFormSchema`: blanks are null and the country code
      // is uppercase. Nothing left to normalise here.
      await onSubmit(values)
    } catch (error) {
      // The server owns the rules, so its message is the useful one — particularly for rule 2
      // (expiry before issue date), which this form does not duplicate.
      setServerError(
        error instanceof ApiError ? error.message : 'Something went wrong. Please try again.',
      )
    }
  })

  return (
    <form onSubmit={submit} className="flex flex-col gap-4" noValidate>
      {serverError !== null && <Alert variant="destructive">{serverError}</Alert>}

      <div className="flex flex-col gap-2">
        <Label htmlFor="title">Title</Label>
        <Input
          id="title"
          // The only field that gets focus on mount: it is the only one that must be filled in.
          // eslint-disable-next-line jsx-a11y/no-autofocus -- deliberate, see Q2 above
          autoFocus
          placeholder="Passport"
          aria-invalid={errors.title !== undefined}
          {...register('title')}
        />
        {errors.title && <p className="text-sm text-destructive">{errors.title.message}</p>}
        <p className="text-xs text-muted-foreground">
          The only thing you need now. Everything else can wait.
        </p>
      </div>

      {!showMore && (
        <Button type="button" variant="ghost" size="sm" onClick={() => setShowMore(true)}>
          Add details
        </Button>
      )}

      {showMore && (
        <div className="flex flex-col gap-4 rounded-md border border-border p-4">
          <div className="flex flex-col gap-2">
            <Label htmlFor="doc_type">Type</Label>
            <select
              id="doc_type"
              className="h-11 rounded-md border border-input bg-transparent px-3 text-sm"
              {...register('doc_type')}
            >
              {documentTypeSchema.options.map((option) => (
                <option key={option} value={option}>
                  {TYPE_LABELS[option] ?? option}
                </option>
              ))}
            </select>
            <p className="text-xs text-muted-foreground">
              Identity documents and certificates get 90/30/7-day reminders automatically, if they
              have an expiry date.
            </p>
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <div className="flex flex-col gap-2">
              <Label htmlFor="issued_on">Issued</Label>
              <Input id="issued_on" type="date" {...register('issued_on')} />
            </div>
            <div className="flex flex-col gap-2">
              <Label htmlFor="expires_on">Expires</Label>
              <Input id="expires_on" type="date" {...register('expires_on')} />
              {errors.expires_on && (
                <p className="text-sm text-destructive">{errors.expires_on.message}</p>
              )}
            </div>
          </div>

          <div className="flex flex-col gap-2">
            <Label htmlFor="issuer">Issuer</Label>
            <Input
              id="issuer"
              // Autocomplete over distinct existing issuers — domains/documents.md §9 question 1
              // settles on free text plus autocomplete rather than an issuers table, until the
              // archive passes ~100 documents.
              list="issuer-suggestions"
              placeholder="HM Passport Office"
              {...register('issuer')}
            />
            <datalist id="issuer-suggestions">
              {issuers.data?.map((issuer) => (
                <option key={issuer} value={issuer} />
              ))}
            </datalist>
          </div>

          <div className="flex flex-col gap-2">
            <Label htmlFor="country">Country</Label>
            <Input
              id="country"
              placeholder="GB"
              maxLength={2}
              className="uppercase"
              {...register('country')}
            />
            {errors.country && <p className="text-sm text-destructive">{errors.country.message}</p>}
          </div>

          <div className="flex flex-col gap-2">
            <Label htmlFor="notes">Notes</Label>
            <textarea
              id="notes"
              rows={3}
              className="rounded-md border border-input bg-transparent px-3 py-2 text-sm"
              {...register('notes')}
            />
          </div>

          <p className="text-xs text-muted-foreground">
            Document numbers are deliberately not stored in full — only the last four characters,
            because the scan itself is the record.
          </p>
        </div>
      )}

      <div className="flex gap-2">
        <Button type="submit" disabled={isSubmitting}>
          {isSubmitting ? 'Saving…' : (submitLabel ?? 'Save')}
        </Button>
        {onCancel && (
          <Button type="button" variant="outline" onClick={onCancel} disabled={isSubmitting}>
            Cancel
          </Button>
        )}
      </div>
    </form>
  )
}
