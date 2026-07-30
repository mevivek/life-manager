import { createFileRoute } from '@tanstack/react-router'
import { useAddSheet } from '@/features/documents/AddSheetProvider'
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
 * Two things live here and nothing else does, and they are the only two reasons this file exists: the
 * route's **param**, and the **capture sheet**, which is a context supplied by `AddSheetProvider` in
 * `__root.tsx`. Everything else is in `ThingDetail`, which can therefore be rendered by a test without
 * the generated route tree or the sheet behind it.
 *
 * `openAddAgainst` rather than `openAdd`: an empty slot in the vehicle 2×2 opens capture **past the type
 * step**, with the preset, a suggested title and the thing prefilled — things.md §7, and the case
 * ADR-0030's five-step variant exists for. It is passed straight through unwrapped, because
 * `ThingDetail`'s prop has the same signature on purpose: there is nothing to translate here and so
 * nothing to get wrong.
 */
function ThingDetailPage() {
  const { thingId } = Route.useParams()
  const { openAddAgainst } = useAddSheet()

  return <ThingDetail thingId={thingId} onFileAgainst={openAddAgainst} />
}
