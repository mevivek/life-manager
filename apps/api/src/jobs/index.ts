import type { PgBoss } from 'pg-boss'

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
export async function registerJobs(_boss: PgBoss): Promise<void> {
  // No jobs yet. See above.
}
