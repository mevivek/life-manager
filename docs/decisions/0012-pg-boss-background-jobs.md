# ADR-0012: Background jobs on pg-boss, no Redis

- **Status:** accepted — **scheduling half amended by [ADR-0028](0028-external-trigger-for-the-daily-scan.md)**
- **Date:** 2026-07-26

> **What 0028 changed, and what it did not.** pg-boss remains the queue, and the property this ADR
> turns on — enqueueing a job in the same transaction as the write that causes it — is untouched. What
> did not survive is the *clock*: a pg-boss `schedule` needs something to be running when it fires, and
> [ADR-0021](0021-cloud-run-for-the-api.md) made the API scale-to-zero. The daily reminder scan is now
> triggered by Cloud Scheduler over HTTP and runs inline. The `reminders.scan` / `reminders.deliver`
> queue entries in the table below still exist in code and are still the right design for a worker that
> is actually running; they are simply not what fires in production.

## Context

Several things must happen outside a request:

- **Reminders** — a daily scan for records approaching an expiry date, then delivery. This
  is not a nice-to-have; [prior-art.md](../prior-art.md) §3 found an entire product category
  built on nothing else, and reminders ship in M1.
- **OCR / text extraction** from uploaded files (M2) — far too slow for a request.
- **Reconciliation** between Postgres rows and R2 objects
  ([ADR-0008](0008-object-storage-r2.md)).

So the app needs both a queue and a scheduler. The question is what infrastructure that
should cost, given free-tier hosting and a solo maintainer.

## Decision

**pg-boss, backed by the Postgres already in use
([ADR-0005](0005-postgres-neon-drizzle.md)). No Redis, no separate broker, no extra
service.**

Workers run inside the API process for now.

```
reminders.scan            cron, daily — find due_on - lead_days = today, enqueue deliveries
reminders.deliver         queued     — send via the notification channel
documents.extract-text    on upload  — OCR → document_text → refresh search index (M2)
storage.reconcile         cron, weekly — orphaned R2 objects and rows
```

pg-boss provides scheduling, retries with backoff, dead-letter queues, and job
deduplication — everything actually needed here.

**The property that decides it: a job can be enqueued in the same transaction as the write
that causes it.** Create a document and schedule its reminder atomically. With an external
broker that is a distributed-transaction problem, and the usual outcome is a document with
no reminder or a reminder for a document that was rolled back. Here it is one `COMMIT`.

## Alternatives considered

- **BullMQ + Redis.** The standard Node answer: mature, excellent tooling, a good dashboard,
  higher throughput. Rejected on cost and coupling. It means a second stateful service to
  provision, monitor, and pay for — Redis free tiers are small and short-lived — for a
  workload measured in a handful of jobs per day. And it reintroduces the dual-write problem
  above. Throughput is the one thing this project has in abundance.
- **Cloud-native queues** (Cloudflare Queues, SQS, Inngest, Trigger.dev). Managed, scalable,
  and Inngest in particular has a very good developer experience. Rejected: another vendor,
  another set of credentials, jobs defined outside the codebase, and local development
  requires either a tunnel or a simulator. Same dual-write problem.
- **`setInterval` in the API process.** Genuinely the simplest thing. Rejected because it
  loses jobs on restart, has no retries, no visibility, and double-fires if the API ever
  runs more than one instance. Nothing to build on.
- **External cron hitting an HTTP endpoint** (GitHub Actions, cron-job.org). Fine for the
  daily scan alone. Rejected as the general mechanism: it handles scheduling but not
  queueing, retries, or per-item failure isolation — one bad document would fail the whole
  scan.
- **Postgres `LISTEN/NOTIFY` with a hand-rolled worker.** No dependency at all. Rejected:
  it means writing retries, backoff, and dead-lettering, which is precisely what pg-boss
  already does correctly.

## Consequences

**Good:** Zero additional infrastructure — one database, one deployable. Jobs are
transactional with the writes that create them. Job state is queryable with SQL, which
makes debugging a `SELECT` rather than a dashboard hunt. Local development needs nothing
beyond the database that is already running.

**Bad:** Job load competes with application queries for the same Postgres connections and
CPU — irrelevant at this scale, real at a larger one. Throughput is far below a dedicated
broker. pg-boss creates its own schema in the database, which is extra tables to look past.
Neon's scale-to-zero and the cron scan interact awkwardly: a scheduled job wakes the
database, so the compute is not truly idle — budget for it
([ADR-0014](0014-hosting-topology.md)).

**Deployment note:** running workers in the API process is a choice, not a constraint. If
job load ever justifies it, pg-boss supports running workers as a separate deployment of
the same image with no code change.

**Revisit if:** job volume grows enough to affect API latency, or a job needs to run
somewhere the API cannot (a GPU box for local OCR, say).
