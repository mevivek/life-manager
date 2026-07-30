import type { ThingDetailResponse } from '@life-manager/shared'
import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { cn } from '@/lib/utils'

/**
 * The claim pack. things.md §4 rule 12, comp lines 844–869.
 *
 * ═══════════════════════════════════════════════════════════════════════════════════════
 *  A CHECKLIST, NOT A GATE — and a READ, storing nothing.
 * ═══════════════════════════════════════════════════════════════════════════════════════
 *
 * Six pieces an insurer or a police report asks for: a photo, a serial or registration, a purchase
 * date, a price, a receipt-or-warranty document, and a cover end date. Every one of them is already on
 * the record or already absent — this component computes nothing new, writes nothing, and has no
 * endpoint behind it.
 *
 * **Missing pieces are named, never blocking.** That is rule 12's exact wording and it is the whole
 * design: a partial pack handed to an insurer beats no pack, so a missing serial must not disable
 * anything. The value of the list is that it tells you what to go and find *before* the morning you
 * need it — which is the one time nobody is in a state to work it out.
 *
 * ── There is no "Build the pack" button, and that is deliberate ──
 *
 * The comp draws one (line 863) and wires it to a toast saying the pack is "ready". Nothing is ready:
 * there is **no endpoint that assembles a pack**. A text summary of six field values would be a
 * different, lesser artefact wearing the same label.
 *
 * This note used to give a second reason — that the client could not reach a thing's photo bytes
 * either. That half is now false: `api.things.photos` exists and `ThingPhotos` renders real images. The
 * first reason is the one that decides it, and it has not moved: assembling a multi-file bundle is
 * server work (zip, or a PDF), and there is no route for it.
 *
 * `components/ui/toast.tsx` is the precedent and it is explicit: the comp drew an "Undo" the system
 * cannot honour, and we refused to ship it rather than shipping a control that lies. Same call here. So
 * the panel names the six pieces — which is the genuinely useful half, and works today — and says
 * plainly that assembling it is not possible yet. When an endpoint exists, the button goes back where
 * the comp put it.
 *
 * The collapsed row is therefore labelled **"Claim pack"** rather than the comp's "Build a claim pack":
 * a control named for an action it cannot perform is the same lie one step earlier.
 */
export function ClaimPack({ thing }: { thing: ThingDetailResponse }) {
  const [open, setOpen] = useState(false)

  const pieces = packPieces(thing)
  const present = pieces.filter((piece) => piece.present).length

  if (!open) {
    return (
      <section className="mt-6 border-t border-rule pt-4">
        <Button
          variant="secondary"
          className="min-h-[3.25rem] w-full justify-between px-4"
          onClick={() => setOpen(true)}
          // The count is the informative part, so it belongs in the name rather than only in the
          // trailing text — "Claim pack, button" alone tells a screen-reader user nothing.
          aria-label={`Claim pack — ${present} of ${pieces.length} pieces`}
        >
          <span className="text-body font-medium">Claim pack</span>
          <span className="text-meta font-normal text-ink-3">
            {present} of {pieces.length} pieces
          </span>
        </Button>
      </section>
    )
  }

  return (
    <section className="mt-6 border-t border-rule pt-4">
      <Card className="px-4 py-3.5">
        <p className="text-body font-medium">What goes in the pack</p>
        <p className="mt-1 text-meta leading-relaxed text-ink-2 [text-wrap:pretty]">
          {/* The comp's own sentence, and it is rule 12 said out loud. */}
          One bundle for an insurer or a police report. Missing pieces don’t stop it — they’re just
          named.
        </p>

        <ul className="mt-3 list-none">
          {pieces.map((piece) => (
            <li
              key={piece.label}
              className="flex min-h-11 items-center justify-between gap-3 border-t border-rule py-2"
            >
              <span className="text-body text-ink-2">{piece.label}</span>
              {/*
                `In` / `Missing`, in mono uppercase — the machine reporting a state, per design.md §3.

                Missing is `--status-soon`, never `--status-late`: a piece you have not gathered is a
                job, not a failure, and this list refuses to block on it. The two words differ before
                any colour does, so the mark survives greyscale on its own.
              */}
              <span
                className={cn(
                  'shrink-0 font-mono text-label font-medium uppercase tracking-label',
                  piece.present ? 'text-status-ok' : 'text-status-soon',
                )}
              >
                {piece.present ? 'In' : 'Missing'}
              </span>
            </li>
          ))}
        </ul>

        {/*
          Where the comp's "Build the pack" was. See the block comment above for why there is no button
          here — and note what this sentence does NOT say: it does not promise the feature is coming on
          any particular day, because nothing schedules it.
        */}
        <p className="mt-3.5 border-t border-rule pt-3 text-meta leading-relaxed text-ink-3 [text-wrap:pretty]">
          The app can’t assemble the bundle yet — there’s nowhere for it to put one. Until it can,
          this list is the useful half: it tells you what to gather.
        </p>

        <Button variant="quiet" className="mt-1 w-full" onClick={() => setOpen(false)}>
          Close
        </Button>
      </Card>
    </section>
  )
}

export type PackPiece = { label: string; present: boolean }

/**
 * The six pieces, and what counts as having one. Rule 12's list, in its order.
 *
 * Exported so the test can assert the marks without reading pixels — and so the count in the collapsed
 * row and the marks in the open panel come from one function rather than two that agree until they
 * don't (the comp computes them twice, at lines 2530 and 2537, and the two disagree: one counts *any*
 * file as a photo and the other counts only images).
 */
export function packPieces(thing: ThingDetailResponse): PackPiece[] {
  return [
    {
      label: 'Photo of it',
      /**
       * Only a **confirmed** photo counts. A `thing_photos` row with `uploaded_at === null` is a
       * presign that never completed — the same rule `DocumentFiles` applies to a scan — and counting
       * one would tell the user they have a photo of the boiler when the upload died on the stairs.
       */
      present: thing.photos.some((photo) => photo.uploaded_at !== null),
    },
    { label: 'Serial or registration', present: notBlank(thing.serial) },
    { label: 'Purchase date', present: thing.purchased_on !== null },
    { label: 'Price paid', present: notBlank(thing.price) },
    {
      label: 'Receipt or warranty',
      /**
       * `doc_type`, not the title. A receipt called "Currys 12 Mar" is still a receipt, and the type is
       * the field the capture form actually sets — unlike `PapersChecklist`'s slots, where two types
       * collide and the title is the only separator.
       */
      present: thing.documents.some(
        (document) => document.doc_type === 'receipt' || document.doc_type === 'warranty',
      ),
    },
    { label: 'Cover end date', present: thing.warranty_ends_on !== null },
  ]
}

/**
 * `== null` catches undefined as well as null — debt D46. A record rehydrated from the persisted cache
 * by an older build can be missing a key the current schema says is always there, and `.trim()` on
 * `undefined` throws at the root error boundary.
 */
function notBlank(value: string | null | undefined): boolean {
  return value != null && value.trim() !== ''
}
