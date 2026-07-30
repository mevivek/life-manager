import type { Thing } from '@life-manager/shared'
import { useState } from 'react'
import { Alert } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { ApiError } from '@/lib/api'
import { useDeleteThing } from './useThings'

/**
 * Delete a thing. things.md §4 rule 5, comp lines 891–894.
 *
 * ═══════════════════════════════════════════════════════════════════════════════════════
 *  Two sentences carry this control, and both of them are refusals.
 * ═══════════════════════════════════════════════════════════════════════════════════════
 *
 * **1. "Its documents stay in Documents."** Rule 5 requires the copy to say so, because
 * `documents.thing_id` is `on delete set null` and a user who does not know that will not risk the tap.
 * A cascade here would let one tap destroy a passport-adjacent archive because somebody sold a car.
 *
 * **2. There is NO "recoverable for 30 days."** `DELETE` is a soft delete — it sets `deleted_at`, and
 * every repository query filters `deleted_at IS NULL` — but there is **no restore endpoint and no purge
 * job**, so that sentence would promise two things the system does not do: a route back, and a
 * deadline. Recoverable by someone with database access is not recoverable by the user.
 * `components/ui/toast.tsx` records that judgement for documents; this is the same one, and it is also
 * why nothing here passes a toast `action`.
 *
 * ── Text in `--status-late`, never a filled red block ──
 *
 * design.md §4. A red button would make "delete" the loudest thing on a screen whose subject is
 * somebody's car — and colour in this system is spent on *status*, not on consequences.
 *
 * ── The version is the precondition, and it is the RENDERED one ──
 *
 * ADR-0024 and debt D41: a delete built against stale data is refused with 409 rather than destroying an
 * edit made elsewhere while this confirmation sat open. `useDeleteThing` takes it in its signature, so a
 * call site that forgets is a type error rather than a lost record.
 */
export function DeleteThing({
  thing,
  /** Called only after the server has confirmed. The caller navigates away; this component does not. */
  onDeleted,
}: {
  thing: Pick<Thing, 'id' | 'version'>
  onDeleted: () => void
}) {
  const [confirming, setConfirming] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const remove = useDeleteThing()

  async function confirm() {
    setError(null)
    try {
      await remove.mutateAsync({ id: thing.id, version: thing.version })
      onDeleted()
    } catch (caught) {
      /**
       * Surfaced, never swallowed (conventions/code.md §6). A 409 is the interesting case and it has to
       * be legible: the record moved on, so this delete was built against a version that no longer
       * exists, and the right next step is to reload rather than to press again.
       *
       * `remove` is deliberately **not** queued offline — see `useDeleteThing`'s note. So an
       * `OfflineError` here is a plain "it did not happen", which is exactly what ADR-0013 requires.
       */
      setError(
        caught instanceof ApiError
          ? caught.status === 409
            ? 'This record changed somewhere else, so it was not deleted. Reload and try again.'
            : caught.message
          : 'That did not happen — no connection. Nothing was deleted.',
      )
    }
  }

  return (
    <section className="mt-6 border-t border-rule pt-4">
      {error !== null && <Alert className="mb-2.5">{error}</Alert>}

      {confirming ? (
        <div className="flex flex-col gap-2">
          <p className="text-body text-ink-2 [text-wrap:pretty]">
            Deleting hides this thing and stops its reminders. Its documents stay in Documents —
            deleting the thing doesn’t shred the paperwork. There is no undo button yet.
          </p>
          <div className="flex gap-2">
            <Button
              variant="destructive"
              size="sm"
              className="border border-status-late"
              disabled={remove.isPending}
              onClick={() => void confirm()}
            >
              {remove.isPending ? 'Deleting…' : 'Yes, delete it'}
            </Button>
            <Button variant="secondary" size="sm" onClick={() => setConfirming(false)}>
              Keep it
            </Button>
          </div>
        </div>
      ) : (
        <Button
          variant="destructive"
          size="bare"
          className="px-0"
          onClick={() => setConfirming(true)}
        >
          Delete this thing
        </Button>
      )}
    </section>
  )
}
