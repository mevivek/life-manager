import { zodResolver } from '@hookform/resolvers/zod'
import {
  countryCodeSchema,
  type DocumentCreate,
  type DocumentDetailResponse,
  documentCreateSchema,
  documentTypeSchema,
} from '@life-manager/shared'
import { useEffect, useRef, useState } from 'react'
import { Controller, useForm } from 'react-hook-form'
import { z } from 'zod'
import { Alert } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { Chip } from '@/components/ui/chip'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { ApiError } from '@/lib/api'
import { cn } from '@/lib/utils'
import {
  autoCapitalizeFor,
  caretForSignificant,
  carryNumber,
  formatNumber,
  inputModeFor,
  numberHint,
  significant,
} from './numberFormat'
import {
  COMMON_PRESETS,
  GENERIC_NUMBER_LABEL,
  numberLabelFor,
  PRESETS,
  presetByName,
} from './presets'
import { useIssuers } from './useDocuments'

/**
 * Create / edit a document. domains/documents.md §7, ADR-0025 §5.
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
   * The document's number, stored in full since ADR-0026.
   *
   * It used to be captured as "last four" because the API discarded the rest at the boundary. It no
   * longer does, so this field takes the whole value and the server derives the mask — see
   * `identifierColumns` in the API service. The blank-to-null transform matters here as much as
   * anywhere: an emptied field must clear both columns rather than fail `min(1)`.
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
  /** The chosen preset's NAME, not the object — so the selected pill survives a re-render by value. */
  const [preset, setPreset] = useState('')
  const [allPresets, setAllPresets] = useState(false)
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
    setValue,
    getValues,
    formState: { errors, isSubmitting },
  } = useForm<DocumentFormValues, unknown, DocumentCreate>({
    resolver: zodResolver(documentFormSchema),
    defaultValues: {
      title: initial?.title ?? '',
      doc_type: initial?.doc_type ?? 'other',
      issuer: initial?.issuer ?? '',
      issued_on: initial?.issued_on ?? '',
      expires_on: initial?.expires_on ?? '',
      /**
       * The FULL identifier, not the mask — ADR-0026.
       *
       * This read `initial?.identifier_last4` while the API stored only four characters. Now that it
       * stores the whole value, populating the form from the mask would mean **opening a document,
       * saving nothing, and having its number silently replaced by its own last four digits** — the
       * edit form quietly destroying the field it was showing. `identifier` is on
       * `DocumentDetailResponse` and nowhere else, which is exactly the shape this prop has.
       */
      identifier: initial?.identifier ?? '',
      country: initial?.country ?? '',
      notes: initial?.notes ?? '',
      tags: initial?.tags ?? [],
    },
  })

  const activePreset = presetByName(preset)
  /**
   * The number field's label: the real name of the number when a preset is in play, and on an EDIT
   * form the name derived from the document's own title. "Identifier" is never shown to anyone.
   */
  const numberLabel =
    activePreset?.numLabel ??
    (initial === undefined ? GENERIC_NUMBER_LABEL : numberLabelFor(initial.title, initial.doc_type))

  /**
   * `register('identifier')` split apart, so this field's `onChange` and `ref` can be wrapped.
   *
   * Spreading `register()` after a hand-written `onChange` would silently overwrite it — the last
   * prop wins — so the pieces are pulled out by name and reattached explicitly below. RHF still owns
   * validation and the value; this only reshapes the string on its way in and restores the caret.
   */
  const {
    ref: registerIdentifierRef,
    onChange: registerIdentifierChange,
    ...identifierField
  } = register('identifier')
  const identifierElement = useRef<HTMLInputElement | null>(null)
  /** Caret position in SIGNIFICANT characters, pending a re-render. See the `onChange` note. */
  const pendingCaret = useRef<number | null>(null)

  const numberProgress = numberHint(activePreset?.format, watch('identifier') ?? '')

  /**
   * Restore the caret after the reformat re-rendered the field.
   *
   * No dependency array: it must run after **every** render that had a pending caret, and the pending
   * value is cleared as it is consumed so a render without one costs a single null check.
   */
  useEffect(() => {
    const wanted = pendingCaret.current
    if (wanted === null) return
    pendingCaret.current = null
    const element = identifierElement.current
    if (element === null) return
    const index = caretForSignificant(element.value, wanted)
    try {
      element.setSelectionRange(index, index)
    } catch {
      // A field whose type does not support selection ranges. Nothing to restore, nothing to report.
    }
  })

  /**
   * Save is enabled from the FIRST character and dims only at zero.
   *
   * ADR-0025 §5 counts this into the capture budget: a Save that stays disabled until the whole form
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

      {/*
        ═══════════════════════════════════════════════════════════════════════════════════
         The preset chooser — creating only, and always skippable.
        ═══════════════════════════════════════════════════════════════════════════════════

        Above the title field so it can be ignored rather than answered: the eye reaches it first,
        recognises a document or does not, and moves on. `initial === undefined` gates it to creation —
        on an edit form a preset tap would overwrite the title of a document that already has one,
        which is a shortcut turning into a data loss.

        See `presets.ts` for why the list is client-side data and why it is India-only.
      */}
      {initial === undefined && (
        <fieldset className="flex flex-col gap-2 border-0 p-0">
          <div className="flex items-baseline justify-between gap-2.5">
            {/* A `<legend>`, so each pill announces as "Common documents, Aadhaar" rather than a bare
                "Aadhaar" — design.md §6. A `div role="group"` does not do this. */}
            <legend className="float-left font-mono text-label tracking-label text-ink-3 uppercase">
              Common documents · optional
            </legend>
            <Button
              variant="quiet"
              size="bare"
              className="px-1 text-meta"
              onClick={() => setAllPresets((previous) => !previous)}
              aria-expanded={allPresets}
            >
              {allPresets ? 'Show fewer' : `All ${PRESETS.length}`}
            </Button>
          </div>
          <div className="flex flex-wrap gap-1.5">
            {(allPresets ? PRESETS : COMMON_PRESETS).map((option) => (
              <Chip
                key={option.name}
                selected={preset === option.name}
                onClick={() => {
                  const next = preset === option.name ? '' : option.name
                  setPreset(next)
                  if (next === '') return
                  /**
                   * `shouldDirty`, and deliberately overwriting.
                   *
                   * Tapping a second preset must replace the first one's values, not merge with them —
                   * otherwise picking Aadhaar then Passport leaves UIDAI as the issuer of a passport.
                   * The issuer is written even when blank, for the same reason: the presets that leave
                   * it empty (insurers, banks) do so because we must not guess, and carrying over the
                   * previous pick's issuer would be exactly that guess.
                   */
                  setValue('title', option.name, { shouldDirty: true })
                  setValue('doc_type', option.type, { shouldDirty: true })
                  setValue('issuer', option.issuer, { shouldDirty: true })
                  /**
                   * A part-typed number survives the switch only if the new shape keeps every
                   * significant character it had. Otherwise the field clears.
                   *
                   * Reshaping it regardless would leave the first five characters of an Aadhaar number
                   * sitting under a label reading "PAN" — a value the user never typed, in the one
                   * field where a wrong value is worse than a blank one. `carryNumber` decides.
                   */
                  setValue(
                    'identifier',
                    carryNumber(option.format, String(getValues('identifier') ?? '')),
                    { shouldDirty: true },
                  )
                }}
              >
                {option.name}
              </Chip>
            ))}
          </div>
          {activePreset !== null && (
            <p className="rounded-2 border border-rule bg-sunken px-3 py-2.5 text-meta leading-relaxed text-ink-2 [text-wrap:pretty]">
              {activePreset.issuer === ''
                ? 'Issuer left blank — insurers and banks vary, so we won’t guess.'
                : `Issuer prefilled: ${activePreset.issuer}.`}{' '}
              {activePreset.numLabel}
              {activePreset.shape === '' ? '.' : ` (${activePreset.shape}).`}{' '}
              {/* Advisory copy only. It sets no date and creates no reminder — those come from
                  `expires_on` server-side, and a preset that implied otherwise would produce a
                  document that looks watched and is not (invariant 5). */}
              {activePreset.expires
                ? 'This one usually expires — worth adding the date so we can remind you.'
                : 'Usually no expiry, so it’ll stay silent. That’s correct, not missing.'}
            </p>
          )}
        </fieldset>
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

      {/*
        The number, promoted out of "Add more now" to the second field — ADR-0026. Asked every time,
        required never: `Save` works with it empty, which the copy under the button says out loud.

        No `maxLength`. It was 4 because the API discarded everything but the last four under the old
        business rule 6, so the cap made the truncation visible *before* it happened. Now that the whole
        value is stored, a cap would be the only thing throwing it away — silently, mid-typing, on a
        twelve-digit Aadhaar number.

        Mono without `tracking-mask`: that 0.14em is for a four-character mask, and on twelve digits it
        pushes the value past the field at 390px.
      */}
      <div className="flex flex-col gap-1.5">
        <div className="flex items-baseline justify-between gap-2.5">
          <Label htmlFor="identifier">{numberLabel}</Label>
          <div className="flex items-baseline gap-2">
            {/*
              The progress counter — "7 of 12", then "Complete". Mono, so the number reads as a count
              rather than a word, and it goes quiet (`--ink-3`) until the value is full.

              It is NOT validation. "Complete" says the value is the right *length* for this document,
              nothing more; `identifier` stays optional forever (Q2) and Save never waits for it.
            */}
            {numberProgress !== '' && (
              <span
                className={cn(
                  'font-mono text-meta',
                  numberProgress === 'Complete' ? 'text-status-ok' : 'text-ink-3',
                )}
              >
                {numberProgress}
              </span>
            )}
            {activePreset?.shape !== undefined && activePreset.shape !== '' && (
              <span className="text-meta text-ink-3">{activePreset.shape}</span>
            )}
          </div>
        </div>
        <Input
          id="identifier"
          placeholder={activePreset?.placeholder ?? activePreset?.shape ?? 'Number on the document'}
          className="font-mono"
          /*
            Keyboard hints, per preset. `numeric` on a digits-only number saves a keyboard switch on
            every capture; the rest keep a full keyboard because their masks mix letters and digits.
            Autocorrect and spellcheck are off on all of them — an identifier is not a word, and iOS
            will happily "correct" one.
          */
          inputMode={inputModeFor(activePreset?.format)}
          autoCapitalize={autoCapitalizeFor(activePreset?.format)}
          autoComplete="off"
          autoCorrect="off"
          spellCheck={false}
          {...identifierField}
          ref={(element) => {
            registerIdentifierRef(element)
            identifierElement.current = element
          }}
          onChange={(event) => {
            const element = event.target
            /**
             * Reformat, then put the caret back where it was in **significant** terms.
             *
             * Counting significant characters rather than string indices is the whole trick: the
             * reformat inserts and removes grouping spaces underneath the caret, so a naive
             * controlled input sends the caret to the end of the field on the 5th digit of an Aadhaar
             * number — which makes correcting a mistyped digit impossible.
             */
            const caretBefore = significant(
              element.value.slice(0, element.selectionStart ?? element.value.length),
            ).length
            const formatted = formatNumber(activePreset?.format, element.value)
            pendingCaret.current = caretBefore
            element.value = formatted
            // RHF's onChange returns a promise (it may run async validation). Nothing here depends on
            // it settling — the value is already in the DOM and the caret is restored by an effect —
            // so it is explicitly voided rather than left floating.
            void registerIdentifierChange(event)
          }}
        />
        <p className="text-meta leading-snug text-ink-3 [text-wrap:pretty]">
          Stored in full, shown as the last four until you tap Reveal. Leave it blank if you don’t
          have it to hand.
        </p>
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
              A wrapping row of pills, NOT a `<select>` — ADR-0025 §7. Six options on a 390px screen
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

          {/* The number field used to live here, behind "Add more now". ADR-0026 promotes it to the
              second field in the form — see the block under Title. */}

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
