import { createFileRoute } from '@tanstack/react-router'
import { useOpenAdd } from '@/features/documents/AddSheetProvider'
import { ThingDetail } from '@/features/things/ThingDetail'

export const Route = createFileRoute('/_authed/things/$thingId')({
  component: ThingDetailPage,
})

/**
 * Thing detail. things.md §7, ADR-0029, comp lines 689–897.
 *
 * ═══════════════════════════════════════════════════════════════════════════════════════
 *  Deliberately a shell. The screen is `features/things/ThingDetail.tsx`.
 * ═══════════════════════════════════════════════════════════════════════════════════════
 *
 * Two things live here and nothing else does, and both are the reasons this file exists at all: the
 * route's **param**, and the **Add sheet**, which is a context supplied by `AddSheetProvider` in
 * `__root.tsx`. Everything else is in `ThingDetail`, which can therefore be rendered by a test without
 * the generated route tree or the sheet behind it.
 *
 * ── TODO (the CaptureSheet / ADR-0030 work): pass the prefill through ──
 *
 * things.md §7 wants an empty slot in the vehicle 2×2 to open capture **past the type step**, with the
 * type, a suggested title and the thing prefilled — which is the case ADR-0030's five-step variant
 * exists for. That arrives with `CaptureSheet` and its `forThing` prop; `useOpenAdd()` is `() => void`
 * today, so there is no argument to hand it.
 *
 * So capture opens at step one. That is a control which **works** and is one step short of the shortcut
 * — not a dead tile, and not a second Add mechanism invented in parallel, which is the failure mode
 * `AddSheetProvider`'s own note exists to prevent. `PapersChecklist` already resolves the slot's
 * `docType` and `suggestedTitle` and hands them to `onCapture`; when the sheet accepts arguments, this
 * line is where they go.
 */
function ThingDetailPage() {
  const { thingId } = Route.useParams()
  const openAdd = useOpenAdd()

  return <ThingDetail thingId={thingId} onFileDocument={() => openAdd()} />
}
