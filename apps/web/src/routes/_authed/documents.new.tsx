import { createFileRoute, Link, useNavigate } from '@tanstack/react-router'
import { CaptureWizard } from '@/features/documents/CaptureSheet'

export const Route = createFileRoute('/_authed/documents/new')({ component: NewDocumentPage })

/**
 * Capture, as a full page. domains/documents.md §7, and the screen Q2's answer is really about.
 *
 * ── This is the sheet's twin, not its replacement ──
 *
 * Every Add control opens `CaptureSheet` over whatever you were looking at, and that is the path
 * essentially every capture takes. **This route stays because a sheet has no URL**: a home-screen
 * shortcut, a shared link, and the Now screen's zero state all need somewhere to point.
 * [ADR-0030](../../../../docs/decisions/0030-capture-as-a-stepped-wizard.md) says so explicitly, and
 * it renders the *same wizard* — same steps, same skips, same saved readback, same mutation — so there
 * is one capture path with two doors rather than two implementations that drift.
 *
 * No `Card` wrapper and no "What is it?" sub-heading. Both were framing capture as *a form inside a
 * panel on a page*; ADR-0025 makes the screen itself the container.
 *
 * ── Why there is no `onSubmit` here any more ──
 *
 * The wizard owns the save and the saved step, because the readback is part of capture rather than part
 * of whichever surface opened it. So this route supplies only the two ways *out*: Cancel, and Done.
 * Both land on the archive, which is where the wizard's own "Add an expiry date" / "Attach a scan"
 * actions have already navigated past by the time they are used — and, for a create that queued
 * offline, the only honest destination, since there is no id to build a detail route from (ADR-0024).
 */
function NewDocumentPage() {
  const navigate = useNavigate()

  return (
    <div>
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

      <h1 className="mt-1.5 mb-4 font-heading text-title font-face-h leading-tight">
        Add a document
      </h1>

      <CaptureWizard
        onCancel={() => void navigate({ to: '/library', search: { scope: 'documents' } })}
        onDone={() => void navigate({ to: '/library', search: { scope: 'documents' } })}
      />
    </div>
  )
}
