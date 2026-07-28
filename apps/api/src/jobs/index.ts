import type { PgBoss } from 'pg-boss'
import { logger } from '../lib/logger.js'
import {
  DELIVER_QUEUE,
  type DeliverPayload,
  deliverReminder,
  SCAN_QUEUE,
  SWEEP_QUEUE,
  scanReminders,
  schedulesEnabled,
  sweepAbandoned,
} from './reminders.js'

/**
 * Where job handlers get registered. **Empty at M0, deliberately** — the lifecycle is wired so
 * that M1 can add a job without touching `app.ts`.
 *
 * M1's first entry is `reminders.scan` (roadmap.md M1, domains/documents.md §6): a daily cron
 * that finds documents expiring soon and enqueues Web Push deliveries.
 *
 * **`await boss.createQueue(name)` before any `work()` or `send()`.** Required since pg-boss
 * v10 — a `send()` to a queue that was never created throws, and it throws at the moment
 * something tries to enqueue rather than at boot, which is the worst time to find out.
 *
 * **Decided 2026-07-27: the recurring schedule stays OFF in development.** A daily cron is
 * pointless against a database with three test documents in it, and it has a cost that is not
 * obvious — a schedule means *something must always be running*, which is what forces an
 * always-on host and keeps Neon's compute awake (ADR-0014, ADR-0012). So when M1 adds this,
 * `createQueue` and `work` are unconditional but **`schedule` is gated**:
 *
 *     export async function registerJobs(boss: PgBoss): Promise<void> {
 *       await boss.createQueue('reminders.scan')
 *       await boss.work('reminders.scan', scanReminders)
 *       // Gated deliberately — see above. Enqueuing by hand still works in dev:
 *       //   await boss.send('reminders.scan', {})
 *       if (env.ENABLE_SCHEDULED_JOBS) {
 *         await boss.schedule('reminders.scan', '0 7 * * *')
 *       }
 *     }
 *
 * Keeping `work()` ungated is the point: the handler stays testable and manually triggerable in
 * dev, so the only thing switched off is the clock.
 *
 * Because handlers live behind this function and a Fastify plugin, moving workers to a separate
 * deployment of the same image later is a startup-flag change, not a refactor (ADR-0012).
 */
export async function registerJobs(boss: PgBoss): Promise<void> {
  await boss.createQueue(SCAN_QUEUE)
  await boss.createQueue(DELIVER_QUEUE)
  await boss.createQueue(SWEEP_QUEUE)

  /**
   * The scan. §6 asks for retry with backoff and an **alert after 3 failures**.
   *
   * A silent scan failure means silently missed renewals — the whole feature failing invisibly — so
   * the failure path logs at `error` and rethrows rather than letting pg-boss absorb it. An
   * `error`-level log is what "alert" means on this deployment today, because there is no alerting
   * pipeline yet (debt D6, triggered before going public).
   */
  await boss.work(SCAN_QUEUE, { batchSize: 1 }, async ([job]) => {
    if (job === undefined) return
    try {
      const result = await scanReminders()
      logger.info({ jobId: job.id, ...result }, 'reminders.scan complete')
    } catch (error) {
      logger.error({ jobId: job.id, err: error }, 'reminders.scan FAILED — renewals may be missed')
      // Rethrown so pg-boss records the failure and retries. Swallowing here would turn a broken
      // scan into one that appears to succeed every day (conventions/code.md §6).
      throw error
    }
  })

  await boss.work(DELIVER_QUEUE, { batchSize: 1 }, async ([job]) => {
    if (job === undefined) return
    const payload = job.data as DeliverPayload
    try {
      const result = await deliverReminder(payload)
      logger.info(
        { jobId: job.id, reminderId: payload.reminderId, ...result },
        'reminder delivered',
      )
    } catch (error) {
      logger.error(
        { jobId: job.id, reminderId: payload.reminderId, err: error },
        'reminders.deliver failed',
      )
      throw error
    }
  })

  await boss.work(SWEEP_QUEUE, { batchSize: 1 }, async ([job]) => {
    if (job === undefined) return
    const result = await sweepAbandoned()
    logger.info({ jobId: job.id, ...result }, 'sweep complete')
  })

  if (!schedulesEnabled()) {
    logger.info(
      { queues: [SCAN_QUEUE, DELIVER_QUEUE, SWEEP_QUEUE] },
      'job handlers registered; schedules OFF (ENABLE_SCHEDULED_JOBS is not true)',
    )
    return
  }

  // 08:00 UTC daily, exactly as §6 specifies.
  await boss.schedule(SCAN_QUEUE, '0 8 * * *')
  // An hour later, so the sweep never races the scan for the same rows.
  await boss.schedule(SWEEP_QUEUE, '0 9 * * *')

  /**
   * **Debt D8's trigger has just fired.** Reaching this line in a deployed environment means
   * something is now scheduled, so Neon's compute is no longer truly idle. Measure compute hours
   * that month before assuming the free tier still covers it (ADR-0012).
   */
  logger.info('job schedules registered — D8: measure Neon compute hours this month')
}
