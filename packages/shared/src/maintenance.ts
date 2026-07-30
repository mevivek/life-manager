import { z } from 'zod'

/**
 * `POST /api/v1/maintenance::run-daily` — the daily reminder scan, triggered from outside.
 *
 * **Why this endpoint exists rather than a cron inside the process.**
 * [ADR-0012](../../../docs/decisions/0012-pg-boss-background-jobs.md) gave scheduling to pg-boss, but
 * a pg-boss schedule requires *something to always be running* to fire it — and the API is Cloud Run
 * with `--min-instances=0`. A schedule there either never fires (nothing is awake at 08:00) or forces
 * an always-on instance, which also keeps Neon's compute awake and is debt **D8**. An external
 * trigger inverts it: the caller wakes the API, the work runs in the request, the instance sleeps
 * again. [ADR-0028](../../../docs/decisions/0028-external-trigger-for-the-daily-scan.md).
 *
 * The counts are deliberately four numbers rather than one `ok`, because "found 3, delivered 0" and
 * "found 0" are completely different situations and only one of them is fine.
 */
export const maintenanceRunResponseSchema = z.object({
  /**
   * `skipped_locked` means another run held the advisory lock, so this call did nothing — and that
   * is a **success**, not an error. Returning 2xx for it is deliberate: Cloud Scheduler retries a
   * non-2xx, and retrying a call that was correctly declined would build a retry storm out of the
   * one mechanism protecting against double-delivery.
   */
  status: z.enum(['ran', 'skipped_locked']),
  /** The UTC date the scan compared against, echoed so a wrong-timezone bug is visible in the log. */
  today: z.string(),
  /** Reminders whose lead window has opened and which have not been sent. */
  found: z.number().int().nonnegative(),
  /** Of those, the ones where at least one push was accepted, so `sent_at` was written. */
  delivered: z.number().int().nonnegative(),
  /**
   * Found but not delivered: no live subscription in the space, or every endpoint refused. `sent_at`
   * stays null, so tomorrow's run tries again — this is not a lost notification, it is a pending one.
   */
  undelivered: z.number().int().nonnegative(),
  /** Threw outright. Logged at `error`; the run continues so one bad reminder cannot stop the rest. */
  errored: z.number().int().nonnegative(),
  /** Orphaned reminders soft-deleted by the sweep that follows the scan. */
  swept: z.number().int().nonnegative(),
  duration_ms: z.number().int().nonnegative(),
})
export type MaintenanceRunResponse = z.infer<typeof maintenanceRunResponseSchema>
