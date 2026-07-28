import * as remindersRepository from '../domains/reminders/reminders.repository.js'
import { env } from '../env.js'
import { logger } from '../lib/logger.js'
import { sendPush } from '../lib/push.js'

/**
 * The reminder jobs. domains/documents.md §6.
 *
 * | Job | Trigger | On failure |
 * |---|---|---|
 * | `reminders.scan` | cron, daily 08:00 UTC | retry with backoff; **alert after 3 failures** |
 * | `reminders.deliver` | queued by the scan | retry 3×, leave `sent_at` null so the next scan retries |
 *
 * **A silent scan failure means silently missed renewals**, which is the whole feature failing
 * invisibly — so the scan logs at `error` with a count and never swallows (§6,
 * conventions/code.md §6). That is also why `sent_at` is only written after a *successful* send.
 */

export const SCAN_QUEUE = 'reminders.scan'
export const DELIVER_QUEUE = 'reminders.deliver'
export const SWEEP_QUEUE = 'documents.sweep-abandoned'

export type DeliverPayload = {
  reminderId: string
  spaceId: string
  title: string
  dueOn: string
}

/**
 * `YYYY-MM-DD` in UTC.
 *
 * The comparison itself happens in SQL against `date` columns (see `listDueForMaintenance`), so
 * this only decides *which* day to ask about. UTC deliberately: `expires_on` is a calendar date
 * with no timezone (conventions/data.md §4), and using the server's local zone would make the
 * fire date depend on where the container happens to run.
 */
export function todayUtc(now: Date = new Date()): string {
  return now.toISOString().slice(0, 10)
}

/**
 * Finds everything due and enqueues one delivery per reminder.
 *
 * Scan and deliver are separate queues on purpose: one slow or failing push endpoint must not stop
 * the other reminders from going out, and pg-boss retries an individual delivery without re-running
 * the whole scan.
 */
export async function scanReminders(): Promise<{ found: number; enqueued: number }> {
  const today = todayUtc()
  const due = await remindersRepository.listDueForMaintenance(today)

  if (due.length === 0) {
    logger.info({ today }, 'reminder scan found nothing due')
    return { found: 0, enqueued: 0 }
  }

  // Imported lazily so that calling `scanReminders` in a test does not construct a pg-boss
  // instance unless there is actually something to enqueue.
  const { getBoss } = await import('./boss.js')
  const queue = getBoss()

  let enqueued = 0
  for (const reminder of due) {
    const payload: DeliverPayload = {
      reminderId: reminder.id,
      spaceId: reminder.spaceId,
      // An orphaned reminder (spec §9 q4 — no FK on `entity_id`) has no title. The sweep below
      // removes those, but a scan running before it must not crash on one.
      title: reminder.documentTitle ?? 'A document',
      dueOn: reminder.dueOn,
    }
    await queue.send(DELIVER_QUEUE, payload)
    enqueued += 1
  }

  logger.info({ today, found: due.length, enqueued }, 'reminder scan enqueued deliveries')
  return { found: due.length, enqueued }
}

/**
 * Delivers one reminder to every live subscription in its space.
 *
 * `sent_at` is set **only if at least one subscription accepted it** — that column is the
 * idempotency key (spec §3), so writing it after a total failure would silently drop the
 * notification forever. With no subscriptions at all it is also left null, so registering a browser
 * later still gets the pending reminder on the next scan.
 */
export async function deliverReminder(payload: DeliverPayload): Promise<{ sent: number }> {
  const subscriptions = await remindersRepository.listSubscriptionsForMaintenance(payload.spaceId)

  if (subscriptions.length === 0) {
    logger.warn(
      { reminderId: payload.reminderId, spaceId: payload.spaceId },
      'reminder due but the space has no push subscriptions',
    )
    return { sent: 0 }
  }

  const message = {
    title: `${payload.title} expires ${payload.dueOn}`,
    body: 'Open life-manager to check the details.',
    url: '/documents',
  }

  let sent = 0
  for (const subscription of subscriptions) {
    const outcome = await sendPush(
      { endpoint: subscription.endpoint, p256dh: subscription.p256dh, auth: subscription.auth },
      message,
    )

    switch (outcome.status) {
      case 'sent':
        sent += 1
        break
      case 'expired':
        await remindersRepository.markSubscriptionExpiredForMaintenance(subscription.id)
        logger.info({ subscriptionId: subscription.id }, 'push subscription expired; disabled')
        break
      case 'not-configured':
        // Nothing to retry and nothing to fix at runtime. Loud, because a deployment that
        // schedules reminders without VAPID keys will otherwise look like it is working.
        logger.error(
          { reminderId: payload.reminderId },
          'reminder due but web push is not configured; set the VAPID_* variables',
        )
        break
      case 'failed':
        // Left for pg-boss to retry: `sent_at` stays null, so the next scan picks it up too.
        logger.warn(
          { reminderId: payload.reminderId, detail: outcome.detail },
          'push delivery failed; will retry',
        )
        break
      default: {
        const exhaustive: never = outcome
        throw new Error(`unhandled push outcome: ${JSON.stringify(exhaustive)}`)
      }
    }
  }

  if (sent > 0) await remindersRepository.markSentForMaintenance(payload.reminderId)

  return { sent }
}

/**
 * Business rule 10 and spec §9 question 4's cost: sweeps abandoned uploads and orphaned reminders.
 *
 * Deliberately does **not** delete R2 objects yet. Rule 10 says the sweep removes the orphaned
 * object too, and doing that safely needs a delete path in `lib/storage.ts` plus certainty that the
 * row really is abandoned rather than mid-upload. The rows are swept so the database stays honest;
 * the objects are recorded as outstanding work rather than deleted on a guess.
 */
export async function sweepAbandoned(): Promise<{ reminders: number }> {
  const orphaned = await remindersRepository.listOrphanedForMaintenance()
  await remindersRepository.softDeleteManyForMaintenance(orphaned)

  if (orphaned.length > 0) {
    logger.info({ count: orphaned.length }, 'swept orphaned reminders')
  }

  return { reminders: orphaned.length }
}

/** Whether the recurring schedules should be registered. See `env.ENABLE_SCHEDULED_JOBS`. */
export function schedulesEnabled(): boolean {
  return env.ENABLE_SCHEDULED_JOBS
}
