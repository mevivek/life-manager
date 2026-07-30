# ADR-0028: An external scheduler triggers the daily scan over HTTP

- **Status:** accepted
- **Date:** 2026-07-30
- **Amends:** [ADR-0012](0012-pg-boss-background-jobs.md) — pg-boss keeps the *queue*, and loses the
  *clock*. ADR-0012 is not superseded: everything it decided about not running Redis, and about
  enqueueing a job in the same transaction as the write that causes it, still holds.

## Context

**M1's "done when" is a real document in the system and a real notification before it expires.** The
first half has been true since 2026-07-30. The second has never happened once, and the reason is not
a bug — it is that the two decisions below are individually correct and jointly fatal.

- [ADR-0012](0012-pg-boss-background-jobs.md) gave scheduling to pg-boss, with `reminders.scan` on a
  daily cron.
- [ADR-0021](0021-cloud-run-for-the-api.md) moved the API to Cloud Run with `--min-instances=0`,
  because 180k vCPU-seconds/month cannot cover an always-on instance. That flag is the difference
  between free and billed.

A pg-boss schedule needs **something to be running at the moment it fires**. On a scale-to-zero
service, nothing is. So `ENABLE_SCHEDULED_JOBS` has been off since M1 shipped, and switching it on
would not have fixed it — it would either have done nothing at 08:00 UTC because no instance existed,
or, with `--min-instances=1`, have kept a container alive around the clock *and* kept Neon's compute
awake through pg-boss's polling, which is debt **D8**. The cost would have been the waiting rather
than the work.

The result is the worst shape a feature can have: reminders are created, listed and visible in the
app, and they never arrive. The app looks like it is watching your passport for you when it is not.

## Decision

**Cloud Scheduler calls an authenticated endpoint on the API once a day, and that request does the
whole job synchronously.**

```
POST /api/v1/maintenance:run-daily
X-Cron-Key: <32+ bytes from Secret Manager>

→ 200 { status, today, found, delivered, undelivered, errored, swept, duration_ms }
```

Three parts of this are load-bearing.

**1. The work runs in the request, not in a queue.** `runRemindersInline()` scans and delivers in one
pass. Enqueueing to pg-boss here would be worse than useless: the instance exists because the
scheduler's request woke it, and it goes away shortly after the response, so a `deliver` job would sit
in the queue until some later request happened to wake a worker with time to spare. Reminders would
appear scheduled and still not arrive, which is the exact failure being fixed.

**2. A shared secret in a header, compared in constant time.** `CRON_SECRET` is optional, and **unset
means the endpoint answers 503, not 200** — the same posture as R2 and VAPID, and the reason `pnpm
test` and a fresh clone need no credential. The comparison hashes both sides with SHA-256 and uses
`timingSafeEqual`, which is what makes it safe on inputs of unknown length without leaking the length.

**3. An advisory lock, so a retry cannot double-send.** Cloud Scheduler retries a non-2xx and enforces
its own attempt deadline, so a slow run can be retried while the first is still sending — and both
would see the same `sent_at is null` rows. `pg_try_advisory_lock` makes the second a no-op that
returns **200 `skipped_locked`**. Returning 409 there would be more RESTful and actively harmful: the
scheduler retries a non-2xx, so the one mechanism preventing double-delivery would generate a retry
storm.

## Alternatives considered

- **`--min-instances=1` and switch `ENABLE_SCHEDULED_JOBS` on.** The smallest diff — one flag, no new
  code, and pg-boss keeps its retries and dead-lettering. Rejected on cost, twice over: it leaves the
  Cloud Run free tier ([ADR-0021](0021-cloud-run-for-the-api.md)), and pg-boss's pollers keep Neon's
  compute from ever idling (**D8**). Paying continuously for a job that runs for two seconds a day is
  the wrong shape, and the free tier is a real constraint on this project rather than a preference.

- **Google OIDC token instead of a shared secret**, which is Cloud Scheduler's idiomatic option and
  needs no secret to rotate. Rejected because the Cloud Run service **must stay publicly invocable** —
  the browser calls it — so platform-level IAM cannot protect a single path, and the token would have
  to be verified in-process. That means a JWKS fetch, a cache, an issuer/audience check and a JWT
  verifier this project does not depend on; hand-rolling it is forbidden by invariant 8, and the
  failure mode of a subtly wrong verifier is fail-*open*. A 32-byte secret compared in constant time
  has failure modes that fit in a paragraph. **Revisit if the API ever stops needing to be public.**

- **GitHub Actions on a schedule.** Free, already in the repository, no new vendor. Rejected on a fact
  measured earlier: Actions does not run on this account at all (**D24**) — every run dies in seconds
  with no runner and no logs. A scheduler that cannot execute is not a scheduler.

- **Keep pg-boss's schedule and have Cloud Scheduler merely wake the instance** with a request to
  `/health`. Tempting because it changes almost nothing. Rejected as unpredictable: pg-boss would fire
  whenever its poller next ran inside whatever window the instance happened to be alive, so the actual
  send time would depend on cold-start timing and the instance's idle timeout. A daily job should run
  once, at a known time, and be observable — not probabilistically, some time after a ping.

- **`--min-instances=0` plus a Cloud Run Job rather than an HTTP endpoint.** Arguably the cleanest fit:
  a separate execution, no public surface, no shared secret, and pg-boss could stay in charge. Rejected
  for now on operational weight — a Job needs its own image tag, its own deploy path in
  `cloudbuild.deploy.yaml`, and its own configuration, and editing that pipeline requires a
  delete-and-recreate of the trigger (**D25**). Worth revisiting the moment there is a second scheduled
  job, because the cost is per-*pipeline*, not per-job.

## Consequences

**Good:** Reminders can actually fire, with the API still scale-to-zero and Neon still idling — D8 is
avoided rather than accepted. The trigger is observable in a way a background job never was: it returns
counts, so "the scan ran and delivered nothing" is distinguishable from "the scan did not run", which
is the distinction that matters and the one a `cron` inside a process hides. It is also manually
runnable, which means M1's notification can be verified today instead of at 08:00 tomorrow.

**Bad, and worth stating plainly:**

- **Retry-with-backoff and dead-lettering are gone for this path.** ADR-0012 rejected external cron
  partly for that, and it was right to. What replaces them: per-item `try`/`catch` so one bad push
  cannot stop the rest (ADR-0012's specific objection), and `sent_at` written only after a successful
  send, so the retry is *tomorrow*. With lead days at 90/30/7 every reminder gets three independent
  chances, so a day's delay is not a missed renewal. This is the one workload where a 24-hour retry
  interval is defensible; do not copy the pattern to a job where it is not.
- **A long-lived shared secret now exists**, and nothing rotates it. It is in Secret Manager and bound
  by `scripts/provision.sh cron`, never in the repository — but rotation is a two-step (secret, then
  scheduler header) with a window where one is updated and the other is not. Debt **D52**.
- **The scan's duration is now bounded by an HTTP deadline.** Cloud Scheduler's attempt deadline caps
  the run, so a large enough archive would time out mid-pass. `listDueForMaintenance` already caps at
  500 rows, so the ceiling is real but distant; the advisory lock means a timeout-plus-retry is safe
  rather than duplicating.
- **Two code paths now scan reminders**, `scanReminders` (enqueues, for pg-boss) and
  `runRemindersInline` (delivers, for this endpoint). That is genuine duplication, kept deliberately:
  deleting the pg-boss path would discard the queueing ADR-0012 still wants for M2's OCR, and merging
  them would mean one function whose behaviour depends on how it was called.

**Revisit if:** a second scheduled job appears (then compare a Cloud Run Job again, and pay the
pipeline cost once), the API stops needing to be publicly invocable (then OIDC is strictly better than
the shared secret), or job volume grows enough that doing the work inside a request stops being
appropriate.
