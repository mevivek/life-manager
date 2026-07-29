import { useNavigate } from '@tanstack/react-router'
import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { Eyebrow } from '@/components/ui/label'
import { Sheet } from '@/components/ui/sheet'
import { DocumentForm } from './DocumentForm'
import { ExpiryGlyph } from './ExpiryStatus'
import { useCreateDocument } from './useDocuments'

/**
 * Capture, as a bottom sheet. ADR-0025 §5.
 *
 * ═══════════════════════════════════════════════════════════════════════════════════════
 *  A sheet rather than a route, and the reason is the capture budget
 * ═══════════════════════════════════════════════════════════════════════════════════════
 *
 * Adding a document is something you do **on top of** what you were looking at, not a place you go.
 * A route navigation unmounts the current screen, so cancelling has to rebuild it — and on the Now
 * screen that means re-rendering the whole ledger to get back to where the user already was.
 *
 * `/documents/new` still exists as a real route, so a deep link and a home-screen shortcut both
 * work. It renders the same form full-page.
 *
 * ── Two steps, and the second one is not a dead end ──
 *
 * `form` → `saved`. The sheet **stays open** after a successful save and swaps its contents for
 * three optional next steps plus Done. That is the design's central claim about capture: *"never a
 * dead end, never a demand"*. Closing the sheet on success would be the demand — it decides for the
 * user that they are finished.
 */

type Step = { kind: 'form'; showMore: boolean } | { kind: 'saved'; id: string; title: string }

export function AddDocumentSheet({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [step, setStep] = useState<Step>({ kind: 'form', showMore: false })
  const create = useCreateDocument()
  const navigate = useNavigate()

  function close() {
    onClose()
    // Reset AFTER closing, so the sheet does not visibly flip back to the form as it animates away.
    setStep({ kind: 'form', showMore: false })
  }

  /** Close the sheet, then land on the new document's screen. */
  async function openDocument(documentId: string) {
    close()
    await navigate({ to: '/documents/$documentId', params: { documentId } })
  }

  return (
    <Sheet open={open} onClose={close} labelledBy="add-document-heading">
      {step.kind === 'form' ? (
        <>
          <div className="flex items-baseline justify-between gap-3">
            <h2
              id="add-document-heading"
              className="font-serif text-[1.4375rem] font-normal leading-tight"
            >
              Add a document
            </h2>
            <Button variant="quiet" size="bare" className="px-1 text-ink-3" onClick={close}>
              Cancel
            </Button>
          </div>

          <div className="pt-3.5">
            <DocumentForm
              compact
              defaultShowMore={step.showMore}
              submitLabel="Save"
              onSubmit={async (values) => {
                const created = await create.mutateAsync(values)
                setStep({ kind: 'saved', id: created.id, title: created.title })
              }}
              /**
               * Attaching a scan needs a document to attach it to, and at this point there is not
               * one yet — `document_files` rows hang off a `document_id`. So the invitation routes
               * through the saved step rather than opening a file picker that would have nowhere to
               * send the bytes. Deliberately not wired here; the saved step offers it.
               */
            />
          </div>
        </>
      ) : (
        <div className="pt-1.5 pb-1">
          <div className="flex items-center gap-2.5">
            {/* The ring glyph in the ok tone — the ladder's own vocabulary reused as a success mark,
                rather than a tick borrowed from somewhere else. `[animation:none]` because the pulse
                means "expires today" and nothing else; a pulsing confirmation would be alarming. */}
            <ExpiryGlyph state="today" size={15} className="text-status-ok [animation:none]" />
            <Eyebrow id="add-document-heading">Saved</Eyebrow>
          </div>

          <h2 className="mt-3 font-serif text-[1.4375rem] font-normal leading-snug">
            {step.title}
          </h2>
          <p className="mt-1.5 text-row leading-relaxed text-ink-2">
            It’s in. Add anything else now, or close this and get on with your day.
          </p>

          <div className="mt-4 flex flex-col gap-2">
            {/*
              ═══════════════════════════════════════════════════════════════════════════════
               Both "add" paths open the DETAIL screen, where the comp reopened this form.
              ═══════════════════════════════════════════════════════════════════════════════

              The prototype's `addMoreDetail` set `addStep: "form", moreOpen: true` — it reopened the
              same sheet with the optional fields unfolded. That cannot work here, and the difference
              is not cosmetic: `DocumentForm` **creates**. Reopening it after a successful save and
              submitting again would POST a *second* document rather than adding a date to the first.

              The prototype could get away with it because its save was a state change. Ours returns
              a real id, so the honest destination for "add one more field to the thing I just made"
              is that document's own screen — which is also where the scan goes, since
              `document_files` rows hang off a `document_id` that did not exist a moment ago.
            */}
            <SavedAction onClick={() => void openDocument(step.id)}>Add an expiry date</SavedAction>
            <SavedAction onClick={() => void openDocument(step.id)}>Attach a scan</SavedAction>
            <SavedAction onClick={() => setStep({ kind: 'form', showMore: false })}>
              Add another document
            </SavedAction>
            <Button size="lg" className="w-full" onClick={close}>
              Done
            </Button>
          </div>
        </div>
      )}
    </Sheet>
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
