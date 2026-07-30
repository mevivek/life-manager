import type { Thing, ThingService } from '@life-manager/shared'
import { useState } from 'react'
import { Alert } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { Eyebrow } from '@/components/ui/label'
import { formatDate, formatDateShort } from '@/features/documents/ExpiryStatus'
import { ApiError } from '@/lib/api'
import { formatMoney } from './money'
import { useLogService } from './useThings'

/**
 * Service history. things.md §4 rule 3, comp lines 738–758.
 *
 * ═══════════════════════════════════════════════════════════════════════════════════════
 *  A SERVICE IS A CYCLE, NOT A DATE.
 * ═══════════════════════════════════════════════════════════════════════════════════════
 *
 * That is the whole reason this section exists rather than a `service_due_on` row in the facts list.
 * An interval in months, a log of what was done and what it cost, and a next date that **moves** when
 * a service is logged — so the header reads *"Every 12 months · Next 20 Aug 2026"* and not just a date.
 *
 * The log is a first-class part of the record because **it is what a buyer asks to see** (ADR-0029). A
 * boiler with eight years of annual services is a different object from one with none, and the
 * difference is only legible if the app kept the rows.
 *
 * ── The next date is the SERVER's, always ──
 *
 * `service_due_on` is recomputed server-side from the newest logged service plus the interval (rule 3),
 * and this component never computes it. A next date derived in the client is a next date two devices
 * can disagree about (invariant 5), and `useLogService` invalidates the whole `things` key precisely so
 * the recomputed value is read back rather than guessed at.
 */
export function ServiceHistory({
  thingId,
  thing,
  services,
  today,
}: {
  thingId: string
  thing: Pick<Thing, 'service_every_months' | 'service_due_on'>
  services: ThingService[]
  /** Injectable so "serviced today" is assertable rather than a race with the clock. */
  today?: Date
}) {
  const [error, setError] = useState<string | null>(null)
  const log = useLogService(thingId)

  /**
   * Rendered when there is a cycle **or** a log, not only a cycle.
   *
   * The comp gates the whole section on `hasCycle`, which hides every logged service on a thing whose
   * interval was cleared or never set — the rows exist, they are the thing's history, and they would
   * silently vanish. A thing with rows and no cycle is a normal state (rule 3: no interval means no
   * *due date*, not no history).
   */
  if (thing.service_every_months === null && services.length === 0) return null

  /**
   * Newest first, asserted rather than assumed.
   *
   * `thingDetailResponseSchema` documents `services` as newest-first and the API will sort it that
   * way — but the log reads as history, so a response that arrived in insertion order would show it
   * upside down, and a re-sort here costs nothing on a list this size. Compared as ISO strings, which
   * sort lexicographically for `YYYY-MM-DD` and need no `Date`.
   */
  const ordered = [...services].sort((a, b) => b.serviced_on.localeCompare(a.serviced_on))

  async function logToday() {
    setError(null)
    try {
      await log.mutateAsync({ serviced_on: isoToday(today) })
    } catch (caught) {
      // Never swallowed. Today this is the Things API's 404 (things.md §10); once it exists it is a
      // real failure and the user still has to be told the row was not written.
      setError(
        caught instanceof ApiError
          ? caught.message
          : 'That did not save. Check your connection and try again.',
      )
    }
  }

  return (
    <section className="mt-6">
      <div className="flex items-baseline justify-between gap-2.5 pb-2.5">
        <Eyebrow>Service history</Eyebrow>
        <span className="text-meta text-ink-3">{cycleLabel(thing)}</span>
      </div>

      {error !== null && <Alert className="mb-2.5">{error}</Alert>}

      {ordered.length > 0 ? (
        <ul className="list-none">
          {ordered.map((service) => (
            <li
              key={service.id}
              className="flex min-h-12 items-baseline justify-between gap-3 border-t border-rule py-3"
            >
              <span className="min-w-0">
                <span className="block text-row">{formatDate(service.serviced_on)}</span>
                {/*
                  The provider, when there is one. Omitted rather than shown as a dash: unlike a cost,
                  "who did it" has no natural placeholder, and an empty line under every row on a log
                  the user never filled in reads as data that failed to load.
                */}
                {service.provider !== null && service.provider.trim() !== '' && (
                  <span className="mt-0.5 block text-meta text-ink-3">{service.provider}</span>
                )}
              </span>
              {/*
                Mono, because it is a number the eye scans down a column — design.md §3, "what the
                machine names". A dash where there is no cost, so the column still lines up.
              */}
              <span className="shrink-0 font-mono text-row font-medium">
                {formatMoney(service.cost, service.currency) ?? '—'}
              </span>
            </li>
          ))}
        </ul>
      ) : (
        <p className="border-t border-rule pt-2.5 text-meta leading-relaxed text-ink-3 [text-wrap:pretty]">
          {/* The comp's own sentence, and it is the honest argument for logging anything at all. */}
          Nothing logged yet. The log is what a buyer asks to see.
        </p>
      )}

      <Button
        variant="secondary"
        className="mt-3 w-full"
        disabled={log.isPending}
        onClick={() => void logToday()}
      >
        {log.isPending ? 'Logging…' : 'Serviced today — log it'}
      </Button>
    </section>
  )
}

/**
 * `Every 12 months · Next 20 Aug 2026`, and each half is optional.
 *
 * Both halves matter and they fail independently: a thing can have an interval with no next date
 * (nothing logged and nothing seeded) or a next date with no interval (a one-off appointment). The
 * comp always prints both and emits "No date set" for the missing half, which is right for the date and
 * wrong for the interval — "Every null months" is what its own template would give.
 */
export function cycleLabel(thing: Pick<Thing, 'service_every_months' | 'service_due_on'>): string {
  const months = thing.service_every_months
  const every = months === null ? null : months === 1 ? 'Every month' : `Every ${months} months`
  const next =
    thing.service_due_on === null ? 'No date set' : `Next ${formatDateShort(thing.service_due_on)}`

  return every === null ? next : `${every} · ${next}`
}

/**
 * Today as `YYYY-MM-DD`, in **local** date parts.
 *
 * `toISOString()` would be UTC, so anyone east of Greenwich late in the evening would log a service
 * for tomorrow — the same class of off-by-a-day the note on `formatDate` in `ExpiryStatus` describes,
 * in the opposite direction. `serviced_on` is a calendar date with no time in it.
 */
function isoToday(today = new Date()): string {
  return `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`
}
