import { useId } from 'react'
import { Sheet } from '@/components/ui/sheet'

/**
 * *"What are you adding?"* — the first fork of capture, when the track is not already known.
 *
 * ═══════════════════════════════════════════════════════════════════════════════════════
 *  This sheet exists because the collections merged, not because capture got a step.
 * ═══════════════════════════════════════════════════════════════════════════════════════
 *
 * [ADR-0032](../../../../docs/decisions/0032-one-library-tab.md) puts Documents and Things behind a
 * single **Everything** tab. That deletes the thing design.md §8 relied on — *"each domain keeps its
 * own Add"* — because on a list showing both kinds at once, "what are you adding" genuinely has no
 * answer yet. The Things pill used to open the thing track and the Documents pill the document track;
 * there is now one pill on one screen and it has to ask.
 *
 * **It is a fork, not a wizard step, and the distinction is load-bearing.**
 * [ADR-0030](../../../../docs/decisions/0030-capture-as-a-stepped-wizard.md) fixes capture at six
 * steps with exactly one required field per track. Folding this question into `CaptureSheet` as a
 * step zero would make it a **seventh** step and a **second** required answer — the precise
 * regression that ADR forbids. So the fork sits outside the wizard: it takes one tap, commits to
 * nothing, and hands off to a track that is unchanged from the day it shipped.
 *
 * The two doors that still know their track do **not** go through here. `openAddThing` from a thing's
 * own screen and `openAddAgainst` from a papers checklist both skip it, because asking a question
 * whose answer is already on screen is the thing this sheet is meant to avoid.
 */
export function AddPicker({
  open,
  onClose,
  onPickDocument,
  onPickThing,
}: {
  open: boolean
  onClose: () => void
  onPickDocument: () => void
  onPickThing: () => void
}) {
  const headingId = useId()

  return (
    <Sheet open={open} onClose={onClose} labelledBy={headingId}>
      <h2 id={headingId} className="font-heading text-[1.4375rem] font-face-h leading-tight">
        What are you adding?
      </h2>
      {/*
        The subtitle names what each track *carries*, not what it is called. "Paperwork carries dates
        and a scan; a thing carries cover, a photo and a price" is answerable by someone holding the
        object; "a document or a thing" is a taxonomy question, and a user with a warranty card in
        their hand has a genuinely reasonable case for either.
      */}
      <p className="mt-1.5 text-body leading-normal text-ink-2 [text-wrap:pretty]">
        Paperwork carries dates and a scan. A thing carries cover, a photo and a price.
      </p>

      <div className="mt-4.5 flex flex-col gap-2.5">
        <PickerOption
          title="A document"
          hint="Passport, insurance, receipt, warranty, certificate"
          onClick={onPickDocument}
          glyph={
            <span
              aria-hidden="true"
              className="block h-[27px] w-[22px] rounded-[3px] border-2 border-ink-2"
            />
          }
        />
        <PickerOption
          title="A thing you own"
          hint="Phone, car, geyser, laptop, jewellery"
          onClick={onPickThing}
          glyph={
            /* The same two bottom-aligned rectangles the Everything tab draws, at 24×22 rather than
               17×15. Reusing the glyph is what tells the user this door leads to the half of that
               tab they can already see. */
            <span aria-hidden="true" className="flex h-[22px] w-6 items-end gap-[3px]">
              <span className="block h-3.5 w-2 rounded-[2px] border-2 border-ink-2" />
              <span className="block h-5 w-[11px] rounded-[2px] border-2 border-ink-2" />
            </span>
          }
        />
      </div>

      {/*
        Cancel, not a bare backdrop tap. The backdrop is pointer-only decoration (see `Sheet`), so
        without this the keyboard's only exit is Escape — which is real but undiscoverable, and this
        sheet is the first thing a new user meets when they tap Add.
      */}
      <button
        type="button"
        onClick={onClose}
        className="mt-3.5 min-h-12 w-full text-row font-medium text-ink-3 active:text-ink-2"
      >
        Cancel
      </button>
    </Sheet>
  )
}

/**
 * One door: a glyph, a title, a hint, a chevron — 72px tall.
 *
 * A `<button>` rather than a `<Link>`, and this is the one place in the app where that is correct
 * rather than the mistake design.md §8 warns about. That rule is about *navigation*: a tab or a row
 * that leads somewhere must carry an href. This leads nowhere — it swaps the contents of a sheet
 * that is already open, on top of whatever screen you were reading. There is no address to give it.
 */
function PickerOption({
  title,
  hint,
  glyph,
  onClick,
}: {
  title: string
  hint: string
  glyph: React.ReactNode
  onClick: () => void
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="flex min-h-[4.5rem] w-full items-center gap-3.5 rounded-3 border border-rule-2 bg-raised px-4 py-3.5 text-left transition-colors hover:border-ink active:bg-sunken"
    >
      <span className="flex shrink-0 items-center justify-center">{glyph}</span>
      <span className="min-w-0 flex-1">
        <span className="block text-head font-semibold leading-snug">{title}</span>
        <span className="mt-0.5 block text-meta leading-snug text-ink-3 [text-wrap:pretty]">
          {hint}
        </span>
      </span>
      <span
        aria-hidden="true"
        className="h-3 w-[7px] shrink-0 rotate-45 border-t-[1.5px] border-r-[1.5px] border-rule-2"
      />
    </button>
  )
}
