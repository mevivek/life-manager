import {
  CAPTURE_KINDS,
  COVER_LENGTHS,
  documentCreateSchema,
  documentTypeSchema,
  KIND_LABELS,
  SERIAL_LABELS,
  type ThingKind,
  thingCreateSchema,
} from '@life-manager/shared'
import { useNavigate } from '@tanstack/react-router'
import { useEffect, useRef, useState } from 'react'
import { Alert } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { Chip, Tag } from '@/components/ui/chip'
import { Input } from '@/components/ui/input'
import { Eyebrow, Label } from '@/components/ui/label'
import { Sheet } from '@/components/ui/sheet'
import { useCreateThing, useThings } from '@/features/things/useThings'
import { ApiError } from '@/lib/api'
import { useFeel } from '@/lib/useFeel'
import { cn } from '@/lib/utils'
import {
  type CaptureStep,
  type CaptureTrack,
  coverEndsOn,
  DOC_STEPS,
  type DocumentDraft,
  EMPTY_DOCUMENT_DRAFT,
  EMPTY_THING_DRAFT,
  fieldsFor,
  KIND_META,
  MAKES,
  MODELS,
  REQUIRED_STEP,
  STEP_COPY,
  savedFacts,
  savedGaps,
  THING_STEPS,
  type ThingDraft,
  thingName,
  toDocumentCreate,
  toThingCreate,
} from './captureTracks'
import { ExpiryGlyph, formatDate } from './ExpiryStatus'
import {
  autoCapitalizeFor,
  caretForSignificant,
  carryNumber,
  carryPlate,
  formatNumber,
  inputModeFor,
  type NumberFormat,
  numberHint,
  PLATE_EXAMPLE,
  PLATE_HINT,
  PLATE_SERIES,
  PLATE_SERIES_LABEL,
  PLATE_SHAPE,
  type PlateSeries,
  significant,
  withPlateSeries,
} from './numberFormat'
import { COMMON_PRESETS, PRESETS, presetByName } from './presets'
import { useCreateDocument, useHolders, useIssuers } from './useDocuments'

/**
 * Capture — a stepped wizard on two tracks. [ADR-0030](docs/decisions/0030-capture-as-a-stepped-wizard.md).
 *
 * ═══════════════════════════════════════════════════════════════════════════════════════
 *  SIX STEPS, ONE REQUIRED FIELD. If you change one thing here, do not change that one.
 * ═══════════════════════════════════════════════════════════════════════════════════════
 *
 *     documents:  type → whose → title → number → dates → scan
 *     things:     kind → name  → detail → purchase → warranty → photo
 *
 * ADR-0030 names the regression this file is most likely to suffer: *"a wizard is a place where
 * 'required' creeps back in… someone adding a validation guard to a step because a blank one looks
 * unfinished."* So:
 *
 *  - **`Continue` is disabled on exactly one step per track** — the one in `REQUIRED_STEP` — and on no
 *    other step, ever. Q2 (product/open-questions.md §2) and things.md §4 rule 1 are the decisions.
 *  - **Every other step draws a visible *Skip for now*.** Not decoration: it is the only thing on
 *    screen that says out loud that six invitations have not become six obligations. `CaptureSheet.test.tsx`
 *    walks both tracks pressing it on every step and asserts a save, which is the test the ADR asks for
 *    by name.
 *  - **A tap on a choice step advances it** (design.md §6). Picking a preset, a broad type, a holder or
 *    a kind sets the value *and* moves on — "choose, then press Continue" is two taps for one decision
 *    and the capture budget (ADR-0025 §5) has no room for it. **The cover length is the one exception**,
 *    and it is the comp's: its note reads the chosen length back as a date, which advancing would make
 *    unshowable. See the chip row on the `warranty` step.
 *
 * ── Why this replaced a single page, and what it must NOT replace ──
 *
 * The sheet used to render `DocumentForm` with a disclosure for the optional fields. It could not grow
 * a second track: a thing's fields are conditional on its *kind*, so one page would swap its middle out
 * with no affordance saying why. `DocumentForm` therefore stays exactly as it was for its **other**
 * caller, the full-page edit screen — ADR-0030 is explicit that editing must not become a wizard,
 * because stepping through a record that already exists hides the field you came to change. Nothing in
 * this file imports it.
 *
 * ── What is deliberately NOT here ──
 *
 * The comp draws an upload control on the `scan` and `photo` steps. There is nothing to attach bytes
 * to *from inside the wizard*: both a `document_files` row and a `thing_photos` row hang off an id that
 * does not exist until the save. So the step carries the copy and the **saved** step carries the action —
 * "Attach a scan" for a document, "Add a photo" for a thing, each opening the record that now exists.
 *
 * Holding the bytes in wizard state and uploading them after the create is the obvious alternative, and
 * it is the one that has to fail well: the record is saved and the photo is not, mid-sheet, with no row
 * to put the error on. The saved step's link puts the upload on the screen that can show its progress,
 * its failure and its retry — which is the same screen the user would land on anyway.
 */

// ── The sheet, and the wizard it wraps ───────────────────────────────────────

/** How capture was opened — which track, and whether it is being filed against a thing. */
export type CaptureIntent = {
  track?: CaptureTrack
  /**
   * The thing this document belongs to, when capture was opened from a vehicle's papers checklist
   * (things.md §7). Its presence drops the `type` step — see `visibleSteps`.
   */
  forThing?: { id: string; name: string }
  /** Prefill from the slot that was tapped: a preset name, and/or a title. */
  preset?: string
  title?: string
}

export function CaptureSheet({
  open,
  onClose,
  intent,
}: {
  open: boolean
  onClose: () => void
  intent?: CaptureIntent
}) {
  /**
   * Remounted per opening, so a cancelled capture does not come back half-filled.
   *
   * `Sheet` renders nothing while closed, so the wizard unmounts on close and its state goes with it —
   * which is why there is no reset function here. The key is what makes a *reopen with a different
   * intent* (the papers checklist, twice, for two different slots) start clean rather than inherit the
   * previous slot's prefill.
   */
  const key = `${intent?.track ?? 'document'}:${intent?.forThing?.id ?? ''}:${intent?.title ?? ''}`

  return (
    <Sheet open={open} onClose={onClose} labelledBy={HEADING_ID}>
      <CaptureWizard
        key={key}
        intent={intent}
        onCancel={onClose}
        onDone={onClose}
        // The sheet has to get out of the way before the saved step navigates, or it would sit over
        // the detail screen it just sent the user to. A full-page route omits this: the navigation
        // replaces the whole screen, so there is nothing to close.
        onLeave={onClose}
      />
    </Sheet>
  )
}

const HEADING_ID = 'capture-heading'

export function CaptureWizard({
  intent,
  onCancel,
  onDone,
  onLeave,
}: {
  intent?: CaptureIntent
  onCancel: () => void
  /** Done on the saved step. The sheet closes; the full-page route navigates away. */
  onDone: () => void
  /**
   * Called immediately before the wizard navigates somewhere itself — the saved step's *"Add an
   * expiry date"* and *"Attach a scan"*. Separate from `onDone` because the two surfaces need
   * opposite things: a sheet must close first, and a route must **not** also navigate to the archive.
   */
  onLeave?: () => void
}) {
  /**
   * Needed by the `name` step's duplicate warning, which links to the thing the user already has.
   *
   * `SavedStep` has its own `useNavigate` for its own links; a hook cannot be shared down without
   * prop-drilling it, and both call sites are inside the same router either way.
   */
  const navigate = useNavigate()
  const [track, setTrack] = useState<CaptureTrack>(intent?.track ?? 'document')
  /** An index into `visibleSteps`, not into the track's full list — see `visibleSteps`. */
  const [at, setAt] = useState(0)
  const [document, setDocument] = useState<DocumentDraft>(() => ({
    ...EMPTY_DOCUMENT_DRAFT,
    preset: intent?.preset ?? '',
    docType: presetByName(intent?.preset ?? '')?.type ?? 'other',
    issuer: presetByName(intent?.preset ?? '')?.issuer ?? '',
    title: intent?.title ?? presetByName(intent?.preset ?? '')?.name ?? '',
  }))
  const [thing, setThing] = useState<ThingDraft>(EMPTY_THING_DRAFT)
  const [saved, setSaved] = useState<Saved | null>(null)
  const [serverError, setServerError] = useState<string | null>(null)
  const [allPresets, setAllPresets] = useState(false)
  const [plateSeries, setPlateSeries] = useState<PlateSeries>('state')
  /**
   * Whether the user has *asked* for the holder name fields — not whether they are showing.
   *
   * Openness is derived (`someoneElse` below) for the reason `DocumentForm` records at length: every
   * saved holder is also a suggestion, so seeding a boolean from the value lights a person's chip and
   * the dashed one at once. Only the explicit ask is state.
   */
  const [askedForAName, setAskedForAName] = useState(false)

  const createDocument = useCreateDocument()
  const createThing = useCreateThing()
  const issuers = useIssuers()
  const holders = useHolders()

  const steps = visibleSteps(track, intent?.forThing !== undefined)
  const step = steps[Math.min(at, steps.length - 1)] ?? steps[0] ?? 'title'
  const requiredStep = REQUIRED_STEP[track]
  const fields = fieldsFor(thing.kind)

  /**
   * `Continue` is dead only on the required step with nothing in it.
   *
   * One expression, one step, and no other clause — see the header. ADR-0030 also wants it live from
   * the FIRST character rather than from a valid form, so the user never has to look at the button to
   * find out whether they are finished.
   */
  const blocked =
    (step === 'title' && document.title.trim() === '') ||
    (step === 'name' && thing.lead.trim() === '')

  /** Everything except the required step. The skip is drawn, always — design.md §6. */
  const canSkip = step !== requiredStep

  const isLastStep = at >= steps.length - 1

  async function save() {
    setServerError(null)

    if (track === 'thing') {
      const parsed = thingCreateSchema.safeParse(toThingCreate(thing))
      if (!parsed.success) {
        // Back to the one required step, which is the only field a rejection can be about that the
        // user has not been shown. Anything else surfaces as the schema's own sentence.
        setServerError(firstMessage(parsed.error))
        return
      }
      try {
        const created = await createThing.mutateAsync(parsed.data)
        /**
         * No queued branch, and that is a fact about `useCreateThing` rather than an oversight: it
         * calls `api.things.create` directly, where `useCreateDocument` goes through `writeOrQueue`.
         * Things capture is **not** in the offline outbox yet (ADR-0024 built it for documents), so a
         * create without a connection fails rather than queueing.
         *
         * `created.id` is therefore unconditional. If a later session wires the outbox in, its return
         * type gains `{ queued: true }` and this line stops compiling — which is the signal wanted,
         * rather than a `'queued' in created` check that is dead today and silently right later.
         */
        setSaved({ track: 'thing', id: created.id })
      } catch (error) {
        setServerError(messageFor(error))
      }
      return
    }

    const parsed = documentCreateSchema.safeParse(toDocumentCreate(document, intent?.forThing?.id))
    if (!parsed.success) {
      setServerError(firstMessage(parsed.error))
      return
    }
    try {
      const created = await createDocument.mutateAsync(parsed.data)
      /**
       * `id: null` is not a missing value to defend against — it is the honest representation of
       * "saved, but not yet anywhere we can link to". A create made offline sits in the outbox until
       * the connection returns and its id is assigned at replay (ADR-0024), so the saved step drops
       * the actions that need one rather than offering links that would 404.
       */
      setSaved({ track: 'document', id: 'queued' in created ? null : created.id })
    } catch (error) {
      setServerError(messageFor(error))
    }
  }

  /**
   * One function behind both buttons, and that is the point.
   *
   * `Continue` and `Skip for now` do exactly the same thing — advance, or save on the last step. The
   * difference is entirely what they *say*, and saying it is the job: a step whose only forward
   * control is "Continue" reads as a step you are expected to fill in.
   */
  function advance() {
    if (!isLastStep) {
      setAt(at + 1)
      return
    }
    // Belt and braces: the required step cannot be advanced past with nothing in it, so this is
    // unreachable through the UI. It exists so a future `forThing`-style shortcut that jumps steps
    // cannot save a record with no name.
    const emptyRequired =
      track === 'document' ? document.title.trim() === '' : thing.lead.trim() === ''
    if (emptyRequired) {
      setAt(Math.max(0, steps.indexOf(requiredStep)))
      return
    }
    void save()
  }

  /** A choice that also moves on — design.md §6. Never on the last step, so it never saves. */
  function chooseAndAdvance(apply: () => void) {
    apply()
    if (!isLastStep) setAt(at + 1)
  }

  function switchTrack(next: CaptureTrack) {
    setTrack(next)
    setAt(0)
    setServerError(null)
    // The other track's draft is left alone, so switching back does not lose what was typed.
  }

  if (saved !== null) {
    return (
      <SavedStep
        saved={saved}
        facts={savedFacts(track, document, thing)}
        gaps={savedGaps(track, document, thing)}
        title={track === 'thing' ? thingName(thing) : document.title.trim()}
        onAddAnother={() => {
          setSaved(null)
          setAt(0)
          if (track === 'thing') setThing(EMPTY_THING_DRAFT)
          else setDocument(EMPTY_DOCUMENT_DRAFT)
        }}
        onDone={onDone}
        onLeave={onLeave}
      />
    )
  }

  const preset = presetByName(document.preset)
  /** The preset's format, bound to the series currently chosen — a plate is the only one that moves. */
  const format = withPlateSeries(preset?.format, plateSeries)
  const isPlate = preset?.format?.kind === 'plate'
  const numberProgress = numberHint(format, document.identifier)
  const holderValue = document.holder.trim()
  const holderHasChip = (holders.data ?? []).some((person) => person.holder === holderValue)
  const someoneElse = askedForAName || (holderValue !== '' && !holderHasChip)

  return (
    <div>
      {/* ── Header: back, progress, cancel ── */}
      <div className="flex items-center justify-between gap-2.5">
        {at > 0 && (
          <Button
            variant="quiet"
            size="bare"
            className="gap-[7px] pr-1 text-ink-2"
            // Back only moves the index. Nothing is cleared, which is ADR-0030's own warning about
            // the step machine desynchronising from the data: "skipping forward past a step and
            // coming back must not clear what was typed".
            onClick={() => setAt(at - 1)}
          >
            <span
              aria-hidden="true"
              className="h-3 w-[7px] rotate-45 border-b-[1.5px] border-l-[1.5px] border-ink-2"
            />
            Back
          </Button>
        )}
        {/* The count in words, beside the ticks that draw it. `flex-1` so it holds the middle whether
            or not there is a Back button to its left. */}
        <Eyebrow className="flex-1">{`Step ${at + 1} of ${steps.length}`}</Eyebrow>
        <Button variant="quiet" size="bare" className="px-1 text-ink-3" onClick={onCancel}>
          Cancel
        </Button>
      </div>

      {/*
        The ticks. **Honest, per ADR-0030**: with `forThing` the first step is already answered, so the
        row drops that segment rather than drawing a step the user will never see — the count and the
        ticks both come from `visibleSteps` so they cannot disagree.

        `aria-hidden`, because the "Step 3 of 5" beside it is the same fact in words, and a row of six
        unlabelled divs announces as nothing useful.

        The 3px height and 2px radius are arbitrary because the bar *is* the content — there is no type
        or spacing token for a 3px rule, and the sheet's own grab handle is drawn the same way
        (design.md §1 permits an arbitrary value where the value is the thing).
      */}
      <div aria-hidden="true" className="mt-2 flex gap-1">
        {steps.map((each, index) => (
          <div
            key={each}
            className={cn('h-[3px] flex-1 rounded-[2px]', index <= at ? 'bg-ink' : 'bg-rule')}
          />
        ))}
      </div>

      {/* `Tag`, not a hand-rolled pill: it is the same shape with no behaviour, and a second copy of
          it here would be a second place for the pill's height to drift. */}
      {intent?.forThing !== undefined && (
        <Tag className="mt-3.5">{`Filing against ${intent.forThing.name}`}</Tag>
      )}

      <h2 id={HEADING_ID} className="mt-4 font-heading text-title font-face-h leading-tight">
        {STEP_COPY[step].heading}
      </h2>
      {subFor(step, thing.kind, preset?.numLabel) !== '' && (
        <p className="mt-1.5 text-row leading-relaxed text-ink-2 [text-wrap:pretty]">
          {subFor(step, thing.kind, preset?.numLabel)}
        </p>
      )}

      {serverError !== null && (
        <Alert className="mt-3">
          <p className="font-medium">Couldn’t save — the server rejected it</p>
          {/* The server's own sentence, verbatim. Nothing was lost: every step keeps its values, so
              the fix is an edit rather than a retype. */}
          <p className="mt-0.5 text-meta leading-relaxed text-ink-2">{serverError}</p>
        </Alert>
      )}

      {/* ── The document track ── */}

      {step === 'type' && (
        <div className="mt-4 flex flex-col gap-4">
          <fieldset className="flex flex-col gap-2 border-0 p-0">
            <div className="flex items-baseline justify-between gap-2.5">
              {/* A `<legend>`, so each pill announces as "Common documents, Aadhaar" rather than a
                  bare "Aadhaar" — design.md §6. A `div role="group"` does not do this. */}
              <legend className="float-left font-mono text-label tracking-label text-ink-3 uppercase">
                Common documents
              </legend>
              <Button
                variant="quiet"
                size="bare"
                className="px-1 text-meta"
                aria-expanded={allPresets}
                onClick={() => setAllPresets(!allPresets)}
              >
                {allPresets ? 'Show fewer' : `All ${PRESETS.length}`}
              </Button>
            </div>
            <div className="flex flex-wrap gap-1.5">
              {(allPresets ? PRESETS : COMMON_PRESETS).map((option) => (
                <Chip
                  key={option.name}
                  selected={document.preset === option.name}
                  onClick={() =>
                    chooseAndAdvance(() => {
                      /**
                       * A preset fills three fields and carries the number — ADR-0030's second
                       * mitigation for the capture budget, and the reason the fast path is
                       * `tap Aadhaar → Continue → Continue → Save`.
                       *
                       * `carryNumber` is what stops the shortcut inventing data: a part-typed number
                       * survives only if the new shape keeps every significant character it had.
                       * Otherwise the field clears, because the first five characters of an Aadhaar
                       * number sitting under a label reading "PAN" is a value nobody typed. **That
                       * rule now has to hold across a step boundary as well as within one**
                       * (ADR-0030 § Consequences), which is exactly what this does: the number step
                       * is two steps ahead and reads the draft this writes.
                       */
                      setDocument({
                        ...document,
                        preset: option.name,
                        title: option.name,
                        docType: option.type,
                        // Written even when blank: the presets that leave the issuer empty do so
                        // because insurers and banks vary and we must not guess, and carrying the
                        // previous pick's issuer over would be exactly that guess.
                        issuer: option.issuer,
                        identifier: carryNumber(
                          withPlateSeries(option.format, plateSeries),
                          document.identifier,
                        ),
                      })
                    })
                  }
                >
                  {option.name}
                </Chip>
              ))}
            </div>
            {preset !== null && (
              <p className="rounded-2 border border-rule bg-sunken px-3 py-2.5 text-meta leading-relaxed text-ink-2 [text-wrap:pretty]">
                {preset.issuer === ''
                  ? 'Issuer left blank — insurers and banks vary, so we won’t guess.'
                  : `Issuer prefilled: ${preset.issuer}.`}{' '}
                {preset.numLabel}
                {preset.shape === '' ? '.' : ` (${preset.shape}).`}{' '}
                {/* Advisory copy only. It sets no date and creates no reminder — those come from
                    `expires_on` server-side, and a preset that implied otherwise would produce a
                    document that looks watched and is not (invariant 5). */}
                {preset.expires
                  ? 'This one usually expires — worth adding the date so we can remind you.'
                  : 'Usually no expiry, so it’ll stay silent. That’s correct, not missing.'}
              </p>
            )}
          </fieldset>

          <fieldset className="flex flex-col gap-2 border-0 p-0">
            <legend className="float-left font-mono text-label tracking-label text-ink-3 uppercase">
              Not in the list
            </legend>
            <div className="flex flex-wrap gap-1.5">
              {SELECTABLE_TYPES.map((option) => (
                <Chip
                  key={option}
                  selected={document.preset === '' && document.docType === option}
                  onClick={() =>
                    chooseAndAdvance(() =>
                      // Clears the preset: a broad type and a preset are two answers to one question,
                      // and leaving the preset set would keep its title and issuer on a document the
                      // user has just said is something else.
                      setDocument({ ...document, preset: '', docType: option, issuer: '' }),
                    )
                  }
                >
                  {TYPE_LABELS[option] ?? option}
                </Chip>
              ))}
            </div>
            <p className="text-meta leading-relaxed text-ink-3 [text-wrap:pretty]">
              A broad type is enough — you’ll name it on the next step.
            </p>
          </fieldset>

          {/*
            The escape hatch to the other track — ADR-0030's answer to "two Add controls". There is one
            Add everywhere except the Things list, which knows the answer already; the branch is a
            quiet footnote so the common case (a document) costs no extra taps.
          */}
          <div className="flex items-baseline justify-between gap-2.5 border-t border-rule pt-3.5">
            <span className="text-meta leading-snug text-ink-3 [text-wrap:pretty]">
              Filing a thing you own, not paperwork?
            </span>
            <Button
              variant="quiet"
              size="bare"
              className="shrink-0 px-1 text-ink"
              onClick={() => switchTrack('thing')}
            >
              Add a thing
            </Button>
          </div>
        </div>
      )}

      {step === 'whose' && (
        /*
          Whose document is it? — a LABEL, never a permission.

          Nobody is invited and nothing is shared. `holder` is a word on a document; `space_id` is
          still the only thing deciding who can read one (invariants 2 and 3, documents.md §4 rule 13).
          **"Me" is the ABSENCE of a holder**, drawn as absence — which is why the account owner has no
          name anywhere in the app and why there is no "Me" badge on a row.
        */
        <fieldset className="mt-4 flex flex-col gap-2 border-0 p-0">
          <legend className="float-left font-mono text-label tracking-label text-ink-3 uppercase">
            Whose is it?
          </legend>
          <div className="flex flex-wrap gap-1.5">
            {/* Exactly ONE chip is selected, always — which is why every `selected` is gated on
                `!someoneElse`. Two lit chips in a single-choice row leaves no way to tell which value
                will be saved. */}
            <Chip
              selected={!someoneElse && holderValue === ''}
              onClick={() =>
                chooseAndAdvance(() => {
                  setAskedForAName(false)
                  setDocument({ ...document, holder: '', relation: '' })
                })
              }
            >
              Me
            </Chip>
            {(holders.data ?? []).map((person) => (
              <Chip
                key={person.holder}
                selected={!someoneElse && holderValue === person.holder}
                onClick={() =>
                  chooseAndAdvance(() => {
                    setAskedForAName(false)
                    // The relation comes with the person, which is what keeps `relation` being stored
                    // per document from being a second thing to type every time.
                    setDocument({
                      ...document,
                      holder: person.holder,
                      relation: person.relation ?? '',
                    })
                  })
                }
              >
                {person.holder}
              </Chip>
            ))}
            {/* Dashed, because it opens a field rather than making a choice — and it does NOT advance,
                for the same reason: there is nothing chosen yet. */}
            <Chip
              variant="dashed"
              selected={someoneElse}
              onClick={() => {
                if (someoneElse) {
                  setAskedForAName(false)
                  setDocument({ ...document, holder: '', relation: '' })
                } else {
                  setAskedForAName(true)
                }
              }}
            >
              Someone else
            </Chip>
          </div>

          {someoneElse && (
            <div className="flex flex-col gap-2 pt-0.5">
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="capture-holder">Their name</Label>
                <Input
                  id="capture-holder"
                  placeholder="Priya"
                  value={document.holder}
                  onFocus={() => setAskedForAName(true)}
                  onChange={(event) => setDocument({ ...document, holder: event.target.value })}
                />
              </div>
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="capture-relation">How they’re related</Label>
                <Input
                  id="capture-relation"
                  placeholder="Wife"
                  value={document.relation}
                  onChange={(event) => setDocument({ ...document, relation: event.target.value })}
                />
                <p className="text-meta leading-snug text-ink-3 [text-wrap:pretty]">
                  Optional, and only a label — it changes nothing about who can see this.
                </p>
              </div>
            </div>
          )}

          {holderValue !== '' && (
            <p className="text-meta leading-relaxed text-ink-3 [text-wrap:pretty]">
              {`Filed under ${holderValue}. It shows up in your lists and reminders — ${holderValue} has no account and gets no notification.`}
            </p>
          )}
        </fieldset>
      )}

      {step === 'title' && (
        <div className="mt-4 flex flex-col gap-1.5">
          <Label htmlFor="capture-title">Title</Label>
          {/*
            `emphasis` is how "required" is drawn — a 1.5px ink border, never an asterisk (design.md
            §6). The comp writes "Title · required" in the label; the weight plus the sentence below
            says it without adding a word the user has to notice on a form where nothing else is
            starred.

            `autoFocus`: ADR-0030's third mitigation. The lead field of each track is focused on
            arrival with the keyboard already up, which is the difference between one tap and two.
          */}
          <Input
            id="capture-title"
            emphasis
            autoFocus
            placeholder="Dishwasher receipt"
            value={document.title}
            onChange={(event) => setDocument({ ...document, title: event.target.value })}
          />
          <p className="text-meta leading-relaxed text-ink-3 [text-wrap:pretty]">
            Whatever you’d call it out loud. This is the only thing we insist on.
          </p>
        </div>
      )}

      {step === 'number' && (
        <div className="mt-4 flex flex-col gap-1.5">
          <div className="flex items-baseline justify-between gap-2.5">
            <Label htmlFor="capture-number">{preset?.numLabel ?? 'Number'}</Label>
            <div className="flex items-baseline gap-2">
              {/* "7 of 12", then "Complete". NOT validation — it says the value is the right *length*
                  for this document and nothing more, and it is absent entirely for a plate, which has
                  two lengths (see `capacityOf`). */}
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
              {shapeFor(preset?.shape, isPlate, plateSeries) !== '' && (
                <span className="text-meta text-ink-3">
                  {shapeFor(preset?.shape, isPlate, plateSeries)}
                </span>
              )}
            </div>
          </div>

          {isPlate && (
            <PlateSeriesChips
              series={plateSeries}
              onChange={(next) => {
                setPlateSeries(next)
                // The same rule as changing preset: a draft survives only if the new series keeps
                // every significant character. A BH plate reshaped as a state plate loses its
                // trailing letter pair, so the field clears rather than showing a plausible,
                // wrong registration.
                setDocument({ ...document, identifier: carryPlate(next, document.identifier) })
              }}
            />
          )}

          <FormattedNumberInput
            id="capture-number"
            format={format}
            value={document.identifier}
            placeholder={
              isPlate
                ? PLATE_EXAMPLE[plateSeries]
                : (preset?.placeholder ?? preset?.shape ?? 'Number on the document')
            }
            onChange={(next) => setDocument({ ...document, identifier: next })}
          />

          {isPlate && (
            <p className="text-meta leading-relaxed text-ink-3 [text-wrap:pretty]">
              {PLATE_HINT[plateSeries]}
            </p>
          )}

          {/*
            **Never "encrypted".** The comp says "Stored in full and encrypted"; nothing here is
            encrypted — invariant 7 and ADR-0009 keep application-level encryption for the vault — and
            this is the one paragraph whose whole job is telling the user how their Aadhaar number is
            handled. Debt D44. The wording matches `DocumentForm` and `IdentifierCard` word for word so
            there is one claim in the app rather than three.
          */}
          <p className="text-meta leading-snug text-ink-3 [text-wrap:pretty]">
            Stored in full, and shown in full — You lets you hide it behind the last four. Leave it
            blank if you don’t have it to hand.
          </p>
        </div>
      )}

      {step === 'dates' && (
        <div className="mt-4 flex flex-col gap-3.5">
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="capture-issuer">Issuer</Label>
            <Input
              id="capture-issuer"
              // Autocomplete over distinct existing issuers — documents.md §9 question 1 settles on
              // free text plus autocomplete rather than an issuers table.
              list="capture-issuer-suggestions"
              placeholder="Start typing — we remember the ones you’ve used"
              value={document.issuer}
              onChange={(event) => setDocument({ ...document, issuer: event.target.value })}
            />
            <datalist id="capture-issuer-suggestions">
              {issuers.data?.map((issuer) => (
                <option key={issuer} value={issuer} />
              ))}
            </datalist>
          </div>
          <div className="flex gap-2.5">
            <div className="flex flex-1 flex-col gap-1.5">
              <Label htmlFor="capture-issued">Issued</Label>
              <Input
                id="capture-issued"
                type="date"
                className="px-3"
                value={document.issuedOn}
                onChange={(event) => setDocument({ ...document, issuedOn: event.target.value })}
              />
            </div>
            <div className="flex flex-1 flex-col gap-1.5">
              <Label htmlFor="capture-expires">Expires</Label>
              {/* `emphasis` even though it is optional: it is the field the whole domain turns on — a
                  document with a date is one the app can warn you about, one without is inert — so it
                  is drawn as the one worth filling in without being made required. */}
              <Input
                id="capture-expires"
                type="date"
                emphasis
                className="px-3"
                value={document.expiresOn}
                onChange={(event) => setDocument({ ...document, expiresOn: event.target.value })}
              />
            </div>
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="capture-country">Country</Label>
            <Input
              id="capture-country"
              placeholder="IN"
              maxLength={2}
              className="uppercase"
              value={document.country}
              onChange={(event) => setDocument({ ...document, country: event.target.value })}
            />
          </div>
        </div>
      )}

      {step === 'scan' && (
        <p className="mt-4 text-row leading-relaxed text-ink-2 [text-wrap:pretty]">
          A photo makes the record useful when you’re not at home. Save it first and the next screen
          takes the scan — a file has to belong to a document, and this one is a moment away from
          existing.
        </p>
      )}

      {/* ── The thing track ── */}

      {step === 'kind' && (
        <fieldset className="mt-4 flex flex-col gap-2 border-0 p-0">
          <legend className="float-left font-mono text-label tracking-label text-ink-3 uppercase">
            Kind of thing
          </legend>
          <div className="flex flex-wrap gap-1.5">
            {CAPTURE_KINDS.map((option) => (
              <Chip
                key={option}
                selected={thing.kind === option}
                onClick={() =>
                  chooseAndAdvance(() =>
                    // Changing kind changes which fields are asked for, so the model and serial are
                    // cleared: "Golf 1.5 TSI" under a label reading "Model" on a *laptop* is data the
                    // user did not enter. The lead survives — it is the required field, and a make is
                    // frequently right for the kind next door.
                    setThing({ ...thing, kind: option, model: '', serial: '' }),
                  )
                }
              >
                {KIND_LABELS[option]}
              </Chip>
            ))}
          </div>
          <p className="text-meta leading-relaxed text-ink-3 [text-wrap:pretty]">
            Vehicles get a documents checklist — registration, insurance, roadworthiness, service
            record — because one object carries four dated papers.
          </p>
        </fieldset>
      )}

      {step === 'name' && (
        <div className="mt-4 flex flex-col gap-1.5">
          {/*
            The duplicate catch — comp 1015–1020, and it was missing entirely until now.

            Filing the same laptop twice is the mistake this domain invites: a thing has no expiry to
            make the second record obviously redundant, and a household buys two of some things
            (identical chairs, two of the same phone) so it must never *block*. It is a warning with a
            link, exactly as the comp draws it.
          */}
          <DuplicateWarning
            draft={thing}
            onOpen={(id) => {
              onLeave?.()
              void navigate({ to: '/things/$thingId', params: { thingId: id } })
            }}
          />
          <Label htmlFor="capture-lead">{fields.lead.label}</Label>
          <Input
            id="capture-lead"
            emphasis
            autoFocus
            placeholder={fields.lead.placeholder}
            value={thing.lead}
            onChange={(event) => setThing({ ...thing, lead: event.target.value })}
          />
          {/*
            Suggestions over a free-text field, **never a closed list** — things.md §9(1). Tapping a
            make clears the model, because "Swift" under "Hyundai" is a car nobody owns.
          */}
          {(MAKES[thing.kind === '' ? 'other' : thing.kind] ?? []).length > 0 && (
            <div className="flex flex-wrap gap-1.5 pt-0.5">
              {(MAKES[thing.kind === '' ? 'other' : thing.kind] ?? []).map((make) => (
                <Chip
                  key={make}
                  size="sm"
                  selected={thing.lead === make}
                  onClick={() => setThing({ ...thing, lead: make, model: '' })}
                >
                  {make}
                </Chip>
              ))}
            </div>
          )}

          {/* The model appears once the lead has something in it: an empty "Model" above an empty
              "Make" asks the user to answer the second question first. */}
          {fields.model !== null && thing.lead.trim() !== '' && (
            <div className="flex flex-col gap-1.5 pt-2">
              <Label htmlFor="capture-model">{fields.model.label}</Label>
              <Input
                id="capture-model"
                placeholder={fields.model.placeholder}
                value={thing.model}
                onChange={(event) => setThing({ ...thing, model: event.target.value })}
              />
              {(MODELS[thing.lead.trim()] ?? []).length > 0 && (
                <div className="flex flex-wrap gap-1.5 pt-0.5">
                  {(MODELS[thing.lead.trim()] ?? []).map((model) => (
                    <Chip
                      key={model}
                      size="sm"
                      selected={thing.model === model}
                      onClick={() => setThing({ ...thing, model })}
                    >
                      {model}
                    </Chip>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>
      )}

      {step === 'detail' && (
        <div className="mt-4 flex flex-col gap-1.5">
          {/* What the serial is CALLED depends on the kind, and the label is always visible —
              things.md §4 rule 8. An unlabelled twelve-character string is a string nobody can
              identify. */}
          <Label htmlFor="capture-serial">
            {SERIAL_LABELS[thing.kind === '' ? 'other' : thing.kind]}
          </Label>

          {thing.kind === 'vehicle' ? (
            <>
              <PlateSeriesChips
                series={plateSeries}
                onChange={(next) => {
                  setPlateSeries(next)
                  setThing({ ...thing, serial: carryPlate(next, thing.serial) })
                }}
              />
              <FormattedNumberInput
                id="capture-serial"
                format={{ kind: 'plate', series: plateSeries }}
                value={thing.serial}
                placeholder={PLATE_EXAMPLE[plateSeries]}
                onChange={(next) => setThing({ ...thing, serial: next })}
              />
              <p className="text-meta leading-relaxed text-ink-3 [text-wrap:pretty]">
                {PLATE_HINT[plateSeries]}
              </p>
            </>
          ) : (
            <Input
              id="capture-serial"
              className="font-mono"
              placeholder={fields.serialPlaceholder}
              autoCapitalize="characters"
              autoComplete="off"
              autoCorrect="off"
              spellCheck={false}
              value={thing.serial}
              onChange={(event) => setThing({ ...thing, serial: event.target.value })}
            />
          )}

          <p className="text-meta leading-snug text-ink-3 [text-wrap:pretty]">
            {fields.serialHint}
          </p>
          {/* The same claim as a document's number, and for the same reason — things.md §4 rule 7
              stores the serial in plaintext too, so this must not say "encrypted" either. */}
          <p className="text-meta leading-snug text-ink-3 [text-wrap:pretty]">
            Stored in full, shown as the last four on the thing’s own screen.
          </p>
        </div>
      )}

      {step === 'purchase' && (
        <div className="mt-4 flex gap-2.5">
          <div className="flex flex-1 flex-col gap-1.5">
            <Label htmlFor="capture-purchased">Bought</Label>
            {/* `emphasis`, and still optional: the purchase date is what the cover clock counts from,
                so it is the one worth filling in on this step. */}
            <Input
              id="capture-purchased"
              type="date"
              emphasis
              className="px-3"
              value={thing.purchasedOn}
              onChange={(event) => setThing({ ...thing, purchasedOn: event.target.value })}
            />
          </div>
          <div className="flex flex-1 flex-col gap-1.5">
            <Label htmlFor="capture-price">Paid</Label>
            <Input
              id="capture-price"
              // `decimal`, not `numeric`: a price can carry a decimal point and the numeric keypad on
              // iOS does not offer one.
              inputMode="decimal"
              placeholder="1149"
              value={thing.price}
              onChange={(event) => setThing({ ...thing, price: event.target.value })}
            />
            {/* Rupees, unstated in a symbol nobody has to type: the presets are India-only by
                explicit decision (`presets.ts`), so `CAPTURE_CURRENCY` is fixed rather than picked. */}
            <p className="text-meta leading-snug text-ink-3">In ₹, as you paid it.</p>
          </div>
        </div>
      )}

      {step === 'warranty' && (
        <div className="mt-4 flex flex-col gap-2.5">
          {thing.purchasedOn === '' ? (
            /*
              No purchase date, so a length cannot be turned into a date — and **nothing here counts
              from today**. A dishwasher bought three years ago with a two-year warranty would come out
              covered until 2028, which is a fabricated date in the one column the cover ladder reads.
              So the step asks for the end date instead of guessing at it. See `coverEndsOn`.
            */
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="capture-cover-ends">Cover ends</Label>
              <Input
                id="capture-cover-ends"
                type="date"
                className="px-3"
                value={thing.coverEndsOn}
                onChange={(event) => setThing({ ...thing, coverEndsOn: event.target.value })}
              />
              <p className="text-meta leading-relaxed text-ink-3 [text-wrap:pretty]">
                Add the purchase date on the step before and we’ll work this out from a length
                instead.
              </p>
            </div>
          ) : (
            <fieldset className="flex flex-col gap-2 border-0 p-0">
              <legend className="float-left font-mono text-label tracking-label text-ink-3 uppercase">
                Cover length
              </legend>
              <div className="flex flex-wrap gap-1.5">
                {COVER_LENGTHS.map((option) => (
                  <Chip
                    key={option.label}
                    selected={thing.coverMonths === option.months}
                    /**
                     * ═══════════════════════════════════════════════════════════════════════
                     *  This step does NOT auto-advance, and it is the one choice step that
                     *  does not. The comp is deliberate about it.
                     * ═══════════════════════════════════════════════════════════════════════
                     *
                     * Every other chip row here advances on tap — a preset, a broad type, a
                     * holder, a kind — which is design.md §6's rule and the comp's behaviour at
                     * all four (`presets`, `types.pickAdd`, `people`, `pKinds` each set
                     * `addStep`). `pCovers.pick` is the exception: it sets `pCover` and stays
                     * put, because the sentence below **reads the answer back** and turns a
                     * length into a date. Advancing would make that note unshowable, and a user
                     * who picked "2 years" would never see which date the app derived.
                     *
                     * This shipped auto-advancing and the note was a static sentence about
                     * warranties in general. *Skip for now* is still drawn, so the step is not a
                     * required field — it is one tap plus Continue rather than one tap.
                     */
                    onClick={() => setThing({ ...thing, coverMonths: option.months })}
                  >
                    {option.label}
                  </Chip>
                ))}
              </div>
              {/*
                The comp's `pCoverNote` (comp 2602) — three sentences, and which one appears depends on
                what was picked. Before anything is picked it is the warranty-versus-expiry line, which
                is the sentence that explains why this step is not the expiry step (ADR-0029).
              */}
              <p className="text-meta leading-relaxed text-ink-3 [text-wrap:pretty]">
                {thing.coverMonths === null
                  ? 'A warranty is not an expiry — a dishwasher whose cover ended keeps washing dishes. We’ll tell you before it ends, not after.'
                  : thing.coverMonths === 0
                    ? // "No cover" is an ANSWER, not a skip, and this is what makes that legible: the
                      // record is still worth having without a date to watch.
                      'No warranty to watch. It still gets a record, a photo and its documents.'
                    : `Cover runs to ${coverEndsLabel(thing)}.`}
              </p>
            </fieldset>
          )}
        </div>
      )}

      {step === 'photo' && (
        <p className="mt-4 text-row leading-relaxed text-ink-2 [text-wrap:pretty]">
          {KIND_META[thing.kind === '' ? 'other' : thing.kind]?.photoSub ??
            'One of the thing, and one of the serial plate if you can reach it.'}{' '}
          Save it first — a photo hangs off a thing that exists, and the next screen takes it.
        </p>
      )}

      {/* ── Footer: the primary, and the skip that keeps six steps from becoming six fields ── */}
      <div className="mt-5 flex flex-col gap-1">
        <Button
          size="lg"
          className="w-full"
          disabled={blocked || createDocument.isPending || createThing.isPending}
          onClick={advance}
        >
          {primaryLabel(isLastStep, track, createDocument.isPending || createThing.isPending)}
        </Button>
        {/* `size="bare"` is already a 44px row — design.md §6: a text-only control still needs a
            thumb-sized hit area, and this is the control that carries Q2's promise. */}
        {canSkip && (
          <Button variant="quiet" size="bare" className="w-full" onClick={advance}>
            {isLastStep ? 'Save without a photo' : 'Skip for now'}
          </Button>
        )}
      </div>
    </div>
  )
}

// ── Pieces ───────────────────────────────────────────────────────────────────

/** The two series, as a fieldset so each pill announces as "Series, Bharat (BH)". */
function PlateSeriesChips({
  series,
  onChange,
}: {
  series: PlateSeries
  onChange: (next: PlateSeries) => void
}) {
  return (
    <fieldset className="min-w-0 border-0 p-0">
      <legend className="float-left pb-1.5 font-mono text-label tracking-label text-ink-3 uppercase">
        Series
      </legend>
      <div className="flex flex-wrap gap-1.5">
        {PLATE_SERIES.map((option) => (
          <Chip
            key={option}
            size="sm"
            selected={series === option}
            onClick={() => onChange(option)}
            // The shape is on the chip's accessible name, because "Bharat (BH)" tells a screen-reader
            // user nothing about what to type. `PLATE_HINT` says it in full below the field.
            aria-label={`${PLATE_SERIES_LABEL[option]} — ${PLATE_SHAPE[option]}`}
          >
            {PLATE_SERIES_LABEL[option]}
          </Chip>
        ))}
      </div>
    </fieldset>
  )
}

/**
 * A number field that reformats as you type and puts the caret back where it was.
 *
 * ═══════════════════════════════════════════════════════════════════════════════════════
 *  The caret is counted in SIGNIFICANT characters, and that is the whole trick.
 * ═══════════════════════════════════════════════════════════════════════════════════════
 *
 * The reformat inserts and removes grouping spaces underneath the caret, so a naive controlled input
 * sends the caret to the end of the field on the fifth digit of an Aadhaar number — which makes
 * correcting a mistyped digit impossible and feels broken in a way that is very hard to attribute.
 * `caretForSignificant` maps a logical position back to a string index after the value has changed.
 *
 * Extracted because both tracks need it: a document's number and a vehicle's registration are the same
 * control over two different formats.
 */
function FormattedNumberInput({
  id,
  format,
  value,
  placeholder,
  onChange,
}: {
  id: string
  format: NumberFormat | undefined
  value: string
  placeholder: string
  onChange: (next: string) => void
}) {
  const element = useRef<HTMLInputElement | null>(null)
  /** Caret position in significant characters, pending a re-render. */
  const pendingCaret = useRef<number | null>(null)

  // No dependency array: it must run after EVERY render that had a pending caret, and the pending
  // value is cleared as it is consumed so a render without one costs a single null check.
  useEffect(() => {
    const wanted = pendingCaret.current
    if (wanted === null) return
    pendingCaret.current = null
    const node = element.current
    if (node === null) return
    const index = caretForSignificant(node.value, wanted)
    try {
      node.setSelectionRange(index, index)
    } catch {
      // A field whose type does not support selection ranges. Nothing to restore, nothing to report.
    }
  })

  return (
    <Input
      id={id}
      ref={element}
      className="font-mono"
      value={value}
      placeholder={placeholder}
      // Keyboard hints per format. Autocorrect and spellcheck are off on all of them — an identifier
      // is not a word, and iOS will happily "correct" one.
      inputMode={inputModeFor(format)}
      autoCapitalize={autoCapitalizeFor(format)}
      autoComplete="off"
      autoCorrect="off"
      spellCheck={false}
      onChange={(event) => {
        const node = event.target
        const formatted = formatNumber(format, node.value)
        /**
         * The caret is restored **only when the value was actually reshaped**, and that condition is
         * not an optimisation.
         *
         * Significant characters are letters and digits, so a caret counted in them lands *before* any
         * punctuation the user has just typed. On a field with no format — a policy number, where the
         * reformat is a no-op — typing `AV-4471-9820` therefore came out as `AV44719820--`: each
         * hyphen was moved back behind the caret and the next digit landed in front of it. Skipping
         * the restore when nothing changed leaves the browser's own caret alone, which is already
         * right in exactly that case.
         */
        if (formatted !== node.value) {
          pendingCaret.current = significant(
            node.value.slice(0, node.selectionStart ?? node.value.length),
          ).length
        }
        onChange(formatted)
      }}
    />
  )
}

type Saved = { track: CaptureTrack; id: string | null }

/**
 * The saved step. **It reads back what the record holds and names what it does not** — ADR-0030.
 *
 * "Saved" on its own makes a person reopen the record to find out whether the number went in, which is
 * how a mistyped number survives unnoticed. So the facts come first, then one sentence listing the
 * blanks, then where it went.
 */
function SavedStep({
  saved,
  facts,
  gaps,
  title,
  onAddAnother,
  onDone,
  onLeave,
}: {
  saved: Saved
  facts: ReturnType<typeof savedFacts>
  gaps: string
  title: string
  onAddAnother: () => void
  onDone: () => void
  onLeave?: () => void
}) {
  const savedId = saved.id
  const { copy } = useFeel()
  const navigate = useNavigate()

  return (
    <div className="pt-1.5 pb-1">
      <div className="flex items-center gap-2.5">
        {/* The ring glyph in the ok tone — the ladder's own vocabulary reused as a success mark rather
            than a tick borrowed from somewhere else. `[animation:none]` because the pulse means
            "expires today" and nothing else; a pulsing confirmation would be alarming. */}
        <ExpiryGlyph state="today" size={15} className="text-status-ok [animation:none]" />
        <Eyebrow id={HEADING_ID}>Saved</Eyebrow>
      </div>

      <h2 className="mt-3 font-heading text-title font-face-h leading-snug">{title}</h2>
      <p className="mt-1.5 text-row leading-relaxed text-ink-2 [text-wrap:pretty]">
        {savedId === null
          ? // Queued offline. "It's in" would be a small lie — it is in the outbox, not the archive —
            // and this app's whole claim is that it tells you the truth. Deliberately outside the
            // voice set: it states a fact the register must not soften away, so it reads the same in
            // warm and plain.
            'Saved on this device. It’ll be sent the next time you’re online.'
          : // Where it went, and it is a fact rather than a reassurance — so it too is the same in
            // both registers. `savedBody` carries the register's own sentence beside it.
            `${saved.track === 'thing' ? 'It’s in Things.' : 'It’s in Documents.'} ${copy.savedBody}`}
      </p>

      {facts.length > 0 && (
        <dl className="mt-4">
          {facts.map((fact) => (
            <div
              key={fact.key}
              className="flex min-h-tap items-baseline justify-between gap-3.5 border-t border-rule py-2.5"
            >
              <dt className="shrink-0 text-body text-ink-3">{fact.key}</dt>
              <dd
                className={cn(
                  'min-w-0 text-right text-row [text-wrap:pretty]',
                  fact.mono === true && 'font-mono',
                )}
              >
                {fact.value}
              </dd>
            </div>
          ))}
        </dl>
      )}

      {gaps !== '' && (
        <p className="mt-3.5 rounded-2 border border-rule bg-sunken px-3.5 py-3 text-meta leading-relaxed text-ink-2 [text-wrap:pretty]">
          {gaps}
        </p>
      )}

      <div className="mt-4 flex flex-col gap-2">
        {/*
          ═══════════════════════════════════════════════════════════════════════════════
           Both "add" paths open the DETAIL screen, where the comp reopened the form.
          ═══════════════════════════════════════════════════════════════════════════════

          The prototype's `addMoreDetail` reopened the wizard at its `dates` step. That cannot work
          here, and the difference is not cosmetic: the wizard **creates**. Coming back to it after a
          successful save and pressing Save again would POST a *second* document rather than adding a
          date to the first. The prototype could get away with it because its save was a state change;
          ours returns a real id, so the honest destination for "add one more field to the thing I just
          made" is that record's own screen — which is also where the scan goes, since `document_files`
          rows hang off a `document_id` that did not exist a moment ago.

          **Both are dropped when the create was queued offline**, because there is no id to link to
          until it replays (ADR-0024) — and an action that cannot work is worse than one not offered.
          "Add another" still works: the outbox takes as many as quota allows.

          A thing now gets the same treatment, because its photo endpoints landed: "Add a photo" opens
          the record, where the hero frame is the picker. This used to be absent, and the note here said
          why — a control for an endpoint that does not exist is the failure mode this codebase has
          shipped twice.
        */}
        {savedId !== null && saved.track === 'thing' && (
          <SavedAction
            onClick={() => {
              onLeave?.()
              void navigate({ to: '/things/$thingId', params: { thingId: savedId } })
            }}
          >
            Add a photo
          </SavedAction>
        )}
        {savedId !== null && saved.track === 'document' && (
          <>
            <SavedAction
              onClick={() => {
                onLeave?.()
                void navigate({ to: '/documents/$documentId', params: { documentId: savedId } })
              }}
            >
              Add an expiry date
            </SavedAction>
            <SavedAction
              onClick={() => {
                onLeave?.()
                void navigate({ to: '/documents/$documentId', params: { documentId: savedId } })
              }}
            >
              Attach a scan
            </SavedAction>
          </>
        )}
        <SavedAction onClick={onAddAnother}>
          {saved.track === 'thing' ? 'Add another thing' : 'Add another document'}
        </SavedAction>
        <Button size="lg" className="w-full" onClick={onDone}>
          Done
        </Button>
      </div>
    </div>
  )
}

/** A left-aligned secondary row — a list of choices, not a row of buttons. */
function SavedAction({ children, onClick }: { children: React.ReactNode; onClick: () => void }) {
  return (
    <Button variant="secondary" size="lg" className="w-full justify-start" onClick={onClick}>
      {children}
    </Button>
  )
}

// ── Helpers ──────────────────────────────────────────────────────────────────

/**
 * The steps actually drawn, which is where ADR-0030's "progress is honest" lives.
 *
 * Capture opened **against a thing** already knows the type — the papers checklist filled it, along
 * with the title (things.md §7) — so the `type` step is dropped rather than shown as a question the
 * user will never answer. Everything else reads the length of this array, so the count, the ticks and
 * the back button cannot disagree about how many steps there are.
 */
export function visibleSteps(track: CaptureTrack, forThing: boolean): readonly CaptureStep[] {
  if (track === 'thing') return THING_STEPS
  return forThing ? DOC_STEPS.slice(1) : DOC_STEPS
}

/**
 * ═══════════════════════════════════════════════════════════════════════════════════════
 *  No "Other" pill. `other` is the ABSENCE of a type, and absence is drawn as absence.
 * ═══════════════════════════════════════════════════════════════════════════════════════
 *
 * `doc_type` defaults to `other`, so rendering all seven put a filled ink **Other** pill on a form
 * nobody had touched — the row looked *answered* before a choice was made, which is the opposite of
 * what Q2 wants. With six, "none selected" *is* `other`, which is how the rest of the app already
 * treats it: "No type" on the detail screen, omitted from a row's meta line.
 */
const SELECTABLE_TYPES = documentTypeSchema.options.filter((option) => option !== 'other')

const TYPE_LABELS: Record<string, string> = {
  identity: 'Identity',
  financial: 'Financial',
  legal: 'Legal',
  warranty: 'Warranty',
  receipt: 'Receipt',
  certificate: 'Certificate',
  other: 'Other',
}

/** The sub-line, where it depends on what has been chosen so far. */
function subFor(step: CaptureStep, kind: ThingKind | '', numLabel: string | undefined): string {
  if (step === 'number') {
    return numLabel === undefined
      ? 'The number printed on the document, if you have it to hand.'
      : `The ${numLabel.toLowerCase()}, if you have it to hand.`
  }
  const meta = KIND_META[kind === '' ? 'other' : kind]
  if (step === 'name') {
    if (meta?.nameSub !== undefined) return meta.nameSub
    return meta === undefined
      ? 'Whatever you’d call it out loud — that is what you will search for.'
      : `Make and model is what you’ll search for later — “${meta.example}”, not “${meta.noun}”.`
  }
  if (step === 'purchase') {
    return kind === 'vehicle'
      ? 'The date starts the warranty and service clock. The price is what an insurer will ask for.'
      : 'The date starts the warranty clock. The price is what an insurer will ask for.'
  }
  if (step === 'photo') return ''
  return STEP_COPY[step].sub
}

/** The shape beside the label — series-dependent for a plate, the preset's own otherwise. */
function shapeFor(shape: string | undefined, isPlate: boolean, series: PlateSeries): string {
  if (isPlate) return PLATE_SHAPE[series]
  return shape ?? ''
}

/**
 * The comp's duplicate catch (comp 1015–1020, `hasDupe`).
 *
 * ═══════════════════════════════════════════════════════════════════════════════════════
 *  A WARNING WITH A LINK, never a block. Q2 survives this too.
 * ═══════════════════════════════════════════════════════════════════════════════════════
 *
 * A household legitimately owns two of the same thing — two identical dining chairs, the same phone
 * bought twice — so this must not disable `Continue` and must not clear anything. It says *"you already
 * have this"* and offers the record, which is the whole intervention: the person who genuinely meant to
 * file a second one carries on typing, and the person who forgot they had already done it taps through.
 *
 * ── The match is the comp's, deliberately loose in both directions ──
 *
 * `"MacBook Air" + "M3"` against a stored `"MacBook Air M3"`: the typed text may be a prefix of the
 * record or the record may be a prefix of the typed text, so it tests containment **both ways**. Three
 * characters is the floor — below it, "TV" would flag every television in the house.
 *
 * ── Why a query here is cheap ──
 *
 * `useThings(DUPLICATE_QUERY)` is the same key `things.index.tsx` already fetches unfiltered, so capture
 * opened from the Things screen serves it straight from the cache. Opened from Now it is one small
 * request while the user is typing a name, and `enabled` keeps it from firing at all until there are
 * enough characters to match on.
 */
function DuplicateWarning({
  draft,
  onOpen,
}: {
  draft: ThingDraft
  onOpen: (thingId: string) => void
}) {
  const typed = `${draft.lead} ${draft.model}`.trim().toLowerCase()
  const enabled = typed.length > 3
  const things = useThings(DUPLICATE_QUERY, { enabled })

  if (!enabled) return null

  const match = (things.data?.data ?? []).find((candidate) => {
    const name = candidate.name.toLowerCase()
    return name.includes(typed) || typed.includes(name)
  })
  if (match === undefined) return null

  return (
    /**
     * `--status-soon`'s tint, which is the comp's `warnbg`. It is a status — "this may be a mistake" —
     * and design.md §4 spends colour on exactly that.
     */
    <div className="mb-1 rounded-2 border border-rule-2 bg-status-soon-bg px-3.5 py-3">
      <p className="text-body font-medium leading-snug [text-wrap:pretty]">
        You already have “{match.name}” filed
        {match.purchased_on === null ? '' : `, bought ${formatDate(match.purchased_on)}`}.
      </p>
      <Button
        variant="quiet"
        size="bare"
        className="mt-1 px-0 text-body"
        onClick={() => onOpen(match.id)}
      >
        Open the one you have
      </Button>
    </div>
  )
}

/**
 * The unfiltered first page, matching `things.index.tsx`'s `BASE_QUERY` so the two share one fetch.
 *
 * Named rather than inline: an object literal in the hook call is a new query key on every render.
 */
const DUPLICATE_QUERY = { sort: 'name', order: 'asc', limit: 100 } as const

/**
 * What the cover-length note says once a length is picked — the comp's `pCoverNote` (comp 2602).
 *
 * Two shapes, and which one appears depends on whether the purchase date is in hand. With it there is a
 * real date to read back; without it there is only the promise that the count starts from whenever the
 * date is filled in. **It never counts from today** — that is the fabricated-date trap the `warranty`
 * step's own comment describes, and `coverEndsOn` is the single place that rule lives.
 */
function coverEndsLabel(thing: ThingDraft): string {
  const label = COVER_LENGTHS.find((option) => option.months === thing.coverMonths)?.label ?? 'that'
  const ends = coverEndsOn(thing)
  return ends === null
    ? `roughly ${label} from the purchase date, once you add it`
    : formatDate(ends)
}

function primaryLabel(isLastStep: boolean, track: CaptureTrack, saving: boolean): string {
  if (saving) return 'Saving…'
  if (!isLastStep) return 'Continue'
  return track === 'thing' ? 'Save thing' : 'Save document'
}

/** The first message a Zod rejection carries, which is the one naming the field the user can fix. */
function firstMessage(error: { issues: readonly { message: string }[] }): string {
  return error.issues[0]?.message ?? 'Something in there was not accepted.'
}

/** The server owns the rules, so its own sentence is the useful one — rule 2 especially. */
function messageFor(error: unknown): string {
  return error instanceof ApiError ? error.message : 'Something went wrong. Please try again.'
}
