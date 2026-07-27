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
 *     export async function registerJobs(boss: PgBoss): Promise<void> {
 *       await boss.createQueue('reminders.scan')
 *       await boss.work('reminders.scan', scanReminders)
 *       await boss.schedule('reminders.scan', '0 7 * * *')
 *     }
 *
 * Because handlers live behind this function and a Fastify plugin, moving workers to a separate
 * deployment of the same image later is a startup-flag change, not a refactor (ADR-0012).
 */
export async function registerJobs(_boss: PgBoss): Promise<void> {
  // No jobs yet. See above.
}
