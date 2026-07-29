import { zodResolver } from '@hookform/resolvers/zod'
import {
  countryCodeSchema,
  type DocumentCreate,
  type DocumentDetailResponse,
  documentCreateSchema,
  documentTypeSchema,
} from '@life-manager/shared'
import { useState } from 'react'
import { Controller, useForm } from 'react-hook-form'
import { z } from 'zod'
import { Alert } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { Chip } from '@/components/ui/chip'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { ApiError } from '@/lib/api'
import { useIssuers } from './useDocuments'

/**
 * Create / edit a document. domains/documents.md §7, ADR-0024 §5.
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
 * The design draws that requirement as **weight, not an asterisk**: the title gets a 1.5px `--ink`
 * border (`emphasis` on `Input`) while every other field keeps the 1px `--rule-2` one. On a form
 * where everything else is optional *forever*, an asterisk on one field implies the others were
 * merely not-yet-starred.
 *
 * Validation is `documentCreateSchema` from `packages/shared` — the same schema the server validates
 * with (ADR-0004). It is here for UX only: the server is authoritative, and a rule that existed only
 * here would not exist at all (invariant 5).
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
   * The last four of the number, which the previous form did not offer at all.
   *
   * `identifier` is what the wire schema calls it, and the API **truncates** rather than rejecting
   * (business rule 6) — so pasting a full passport number stores four characters and discards the
   * rest server-side. `maxLength={4}` on the field makes that visible before it happens; it is a
   * guardrail, not the enforcement.
   */
  identifier: z.union([blank, documentCreateSchema.shape.identifier]),
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

/**
 * ═══════════════════════════════════════════════════════════════════════════════════════
 *  No "Other" pill. `other` is the ABSENCE of a type, and absence is drawn as absence.
 * ═══════════════════════════════════════════════════════════════════════════════════════
 *
 * `doc_type` defaults to `'other'` in `documentCreateSchema`, so rendering all seven options put a
 * filled ink **Other** pill on every untouched form. A screenshot made the problem obvious: the type
 * row looked *answered* before the user had touched it, which is the opposite of what Q2 wants — it
 * quietly discourages picking the real type, and it reports a choice nobody made.
 *
 * With six pills, "none selected" *is* `other`, which is exactly how the rest of the app already
 * treats it: the detail screen shows "No type", and `DocumentRow` omits it from the meta line
 * entirely. One meaning, three places, no special case.
 *
 * The FILTER chip row keeps its Other option, and that is not an inconsistency — filtering *by*
 * untyped documents is a real thing to want, whereas setting a document to untyped is just declining
 * to set it.
 */
const SELECTABLE_TYPES = documentTypeSchema.options.filter((option) => option !== 'other')

export type DocumentFormProps = {
  /** Present when editing; absent when creating. */
  initial?: DocumentDetailResponse
  onSubmit: (values: DocumentCreate) => Promise<unknown>
  onCancel?: () => void
  submitLabel?: string
  /**
   * The sheet's field set: no country, no notes.
   *
   * Not a smaller form for its own sake — those two are the fields nobody has to hand at the moment
   * of capture, and the design's Add sheet omits them for exactly that reason. Both stay editable
   * from the detail screen, so nothing becomes unreachable.
   */
  compact?: boolean
  /** Open the optional fields immediately — the "Add an expiry date" path from the saved step. */
  defaultShowMore?: boolean
  /** Renders the attach-a-scan invitation, which only a create flow can offer. */
  onAttachScan?: () => void
}

export function DocumentForm({
  initial,
  onSubmit,
  onCancel,
  submitLabel,
  compact = false,
  defaultShowMore,
  onAttachScan,
}: DocumentFormProps) {
  const [serverError, setServerError] = useState<string | null>(null)
  // Open by default when editing: if a document already has detail, hiding it looks like data loss.
  const [showMore, setShowMore] = useState(defaultShowMore ?? initial !== undefined)
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
    control,
    handleSubmit,
    watch,
    formState: { errors, isSubmitting },
  } = useForm<DocumentFormValues, unknown, DocumentCreate>({
    resolver: zodResolver(documentFormSchema),
    defaultValues: {
      title: initial?.title ?? '',
      doc_type: initial?.doc_type ?? 'other',
      issuer: initial?.issuer ?? '',
      issued_on: initial?.issued_on ?? '',
      expires_on: initial?.expires_on ?? '',
      identifier: initial?.identifier_last4 ?? '',
      country: initial?.country ?? '',
      notes: initial?.notes ?? '',
      tags: initial?.tags ?? [],
    },
  })

  /**
   * Save is enabled from the FIRST character and dims only at zero.
   *
   * ADR-0024 §5 counts this into the capture budget: a Save that stays disabled until the whole form
   * validates makes the user look at the button to find out whether they are finished.
   */
  const title = watch('title')
  const canSave = typeof title === 'string' && title.trim().length > 0

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
    <form onSubmit={submit} className="flex flex-col gap-3" noValidate>
      {serverError !== null && (
        <Alert>
          <p className="font-medium">Couldn’t save — the server rejected it</p>
          {/* The server's own sentence, verbatim. Nothing was lost: the form keeps its values, so
              the fix is an edit rather than a retype. */}
          <p className="mt-0.5 text-meta leading-relaxed text-ink-2">{serverError}</p>
        </Alert>
      )}

      <div className="flex flex-col gap-1.5">
        <Label htmlFor="title">Title</Label>
        <Input
          id="title"
          emphasis
          // The only field that gets focus on mount: it is the only one that must be filled in, and
          // focusing it on the way up is what keeps capture to a single tap. Deliberate — see Q2 and
          // the capture budget above.
          autoFocus
          placeholder="Dishwasher receipt"
          aria-invalid={errors.title !== undefined}
          {...register('title')}
        />
        {errors.title && <p className="text-body text-status-late">{errors.title.message}</p>}
      </div>

      <Button type="submit" size="lg" disabled={isSubmitting || !canSave} className="w-full">
        {isSubmitting ? 'Saving…' : (submitLabel ?? 'Save')}
      </Button>

      <p className="text-meta leading-relaxed text-ink-3 [text-wrap:pretty]">
        Everything else — type, issuer, dates{compact ? '' : ', country, notes'}, a scan — is
        optional forever. Add it now if you have it, or later when you do.
      </p>

      <Button
        variant="quiet"
        size="bare"
        className="self-start"
        onClick={() => setShowMore((previous) => !previous)}
        aria-expanded={showMore}
      >
        {showMore ? 'Hide the optional fields' : 'Add more now (all optional)'}
      </Button>

      {showMore && (
        <div className="flex flex-col gap-3.5 pt-0.5">
          <div className="flex flex-col gap-1.5">
            {/*
              A wrapping row of pills, NOT a `<select>` — ADR-0024 §7. Six options on a 390px screen
              are better shown than hidden behind an OS wheel the user has to scroll past
              "Certificate" to reach the end. `Controller` rather than `register`, because a chip row
              is not a native input and there is nothing for `register` to bind to.
            */}
            <Controller
              control={control}
              name="doc_type"
              render={({ field }) => (
                /**
                 * A real `<fieldset>` and `<legend>`, not a `<div role="group">`.
                 *
                 * The chips are one control made of several buttons, and a fieldset is what says so
                 * natively — a screen reader announces the legend before each pill, so "Type,
                 * Certificate" rather than a bare "Certificate" among five unexplained siblings.
                 * `min-w-0` because a fieldset defaults to `min-width: min-content`, which stops the
                 * flex parent from shrinking it and lets the pill row overflow the sheet.
                 */
                <fieldset className="min-w-0 border-0 p-0">
                  <legend className="pb-1.5 font-mono text-label font-medium uppercase tracking-label text-ink-3">
                    Type
                  </legend>
                  <div className="flex flex-wrap gap-1.5">
                    {SELECTABLE_TYPES.map((option) => (
                      <Chip
                        key={option}
                        selected={field.value === option}
                        // Tapping the selected pill again returns to `other` — the choice is undoable
                        // without a "None" pill that would read as a type of its own.
                        onClick={() => field.onChange(field.value === option ? 'other' : option)}
                      >
                        {TYPE_LABELS[option] ?? option}
                      </Chip>
                    ))}
                  </div>
                </fieldset>
              )}
            />
            <p className="text-meta leading-relaxed text-ink-3">
              Identity documents and certificates get 90/30/7-day reminders automatically, if they
              have an expiry date.
            </p>
          </div>

          <div className="flex flex-col gap-1.5">
            <Label htmlFor="issuer">Issuer</Label>
            <Input
              id="issuer"
              // Autocomplete over distinct existing issuers — domains/documents.md §9 question 1
              // settles on free text plus autocomplete rather than an issuers table, until the
              // archive passes ~100 documents.
              list="issuer-suggestions"
              placeholder="Start typing — we remember the ones you’ve used"
              {...register('issuer')}
            />
            <datalist id="issuer-suggestions">
              {issuers.data?.map((issuer) => (
                <option key={issuer} value={issuer} />
              ))}
            </datalist>
          </div>

          <div className="flex gap-2.5">
            <div className="flex flex-1 flex-col gap-1.5">
              <Label htmlFor="issued_on">Issued</Label>
              <Input id="issued_on" type="date" className="px-3" {...register('issued_on')} />
            </div>
            <div className="flex flex-1 flex-col gap-1.5">
              <Label htmlFor="expires_on">Expires</Label>
              {/*
                `emphasis` on Expires even though it is optional. It is the field the whole domain
                turns on — a document with a date is one the app can warn you about, one without is
                inert — so it is drawn as the one worth filling in without being made required.
              */}
              <Input
                id="expires_on"
                type="date"
                emphasis
                className="px-3"
                {...register('expires_on')}
              />
              {errors.expires_on && (
                <p className="text-body text-status-late">{errors.expires_on.message}</p>
              )}
            </div>
          </div>

          <div className="flex flex-col gap-1.5">
            <Label htmlFor="identifier">Last four of the number</Label>
            <Input
              id="identifier"
              maxLength={4}
              placeholder="4471"
              className="font-mono tracking-mask"
              {...register('identifier')}
            />
            <p className="text-meta leading-snug text-ink-3">
              Four characters, that’s all we’ll take. The scan is the record.
            </p>
          </div>

          {!compact && (
            <>
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="country">Country</Label>
                <Input
                  id="country"
                  placeholder="GB"
                  maxLength={2}
                  className="uppercase"
                  {...register('country')}
                />
                {errors.country && (
                  <p className="text-body text-status-late">{errors.country.message}</p>
                )}
              </div>

              <div className="flex flex-col gap-1.5">
                <Label htmlFor="notes">Notes</Label>
                <textarea
                  id="notes"
                  rows={3}
                  className="rounded-2 border border-rule-2 bg-raised px-3.5 py-2.5 text-[max(1rem,16px)] text-ink placeholder:text-ink-3"
                  {...register('notes')}
                />
              </div>
            </>
          )}

          {onAttachScan !== undefined && (
            <Button variant="dashed" onClick={onAttachScan}>
              Attach a scan — camera, photos or files
            </Button>
          )}
        </div>
      )}

      {onCancel && (
        <Button variant="quiet" size="bare" className="self-start" onClick={onCancel}>
          Cancel
        </Button>
      )}
    </form>
  )
}
