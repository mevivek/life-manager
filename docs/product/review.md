# Review

**Checking that what got built is what was intended, and that it still holds.**

One of the four brain modes ([brain.md](brain.md) §2 and §9). This file holds the method,
the checklists, and the **debt register** — the living record of known problems.

Why this exists: in a codebase edited by sessions with no shared memory, drift is the
default. Each session makes locally reasonable choices; nothing accumulates a view of
whether the whole still matches its design. Nobody notices that the fourth repository
function quietly omitted the space filter, or that a domain doc has described a
non-existent column for two milestones.

**Run a review at the end of every milestone**, and any time something feels off. It is a
required step in [roadmap.md](../roadmap.md) precisely because nothing else forces it and it
ships no feature.

---

## 1. The four lenses

Run all four. They catch different things and a review that only does one is not a review.

### Lens 1 — Intent: does the code match the spec?

The domain doc is the spec ([ADR-0015](../decisions/0015-docs-as-orientation.md)). Drift
here means the doc has become fiction, and the next session will trust it anyway.

- [ ] Every entity and column in domain doc §3 exists, with the stated type
- [ ] Every numbered business rule in §4 is implemented **and has a test**
- [ ] Every endpoint in §5 exists; no endpoint exists that §5 doesn't list
- [ ] Jobs in §6 are registered and their failure behavior matches what's written
- [ ] §10 **Files** lists real paths, with `(planned)` markers removed
- [ ] Where code and doc disagree, decide which is right — then fix the other. **Do not
      leave both.**

### Lens 2 — Invariants: are the twelve still holding?

The [`CLAUDE.md`](../../CLAUDE.md) invariants are the ones that break silently. Most are
mechanically checkable — actually run the checks rather than eyeballing.

- [ ] **Every** repository function takes `actor: ActorContext` first
- [ ] **Every** domain table has `space_id`; no `owner_id` or `user_id` has crept onto a
      domain table
- [ ] **Every** repository query filters space and `deleted_at` — via the shared `scoped()`
      helper, not hand-written
- [ ] No Drizzle query or raw SQL outside a repository
- [ ] **Every** data endpoint has a cross-space 404 test
      ([conventions/testing.md](../conventions/testing.md) §2)
- [ ] No cross-space path returns 403 where it should return 404
- [ ] No database URL or storage credential outside `apps/api`
- [ ] No business rule that exists only in the web client
- [ ] No storage object key supplied by a client
- [ ] No hand-written type mirroring a Zod schema
- [ ] No hand-rolled crypto; primitives match [security-model.md](../security-model.md) §5
- [ ] No secrets in the repo, in code, docs, or commit messages
- [ ] No `catch {}` swallowing an error in an auth, crypto, or job path

Useful starting greps — verify results rather than trusting a clean exit:

```bash
rg 'owner_id|user_id' --glob '*/domains/**/*.schema.ts'   # expect: nothing
rg 'db\.(select|insert|update|delete)' --glob '*.routes.ts' --glob '*.service.ts'  # expect: nothing
rg 'export async function' --glob '*.repository.ts' -A1 | rg -v 'actor'  # expect: nothing
rg 'as any|@ts-ignore|!\.' --glob 'apps/**/*.ts'          # expect: only justified, commented
```

### Lens 3 — Docs: do they still describe reality?

- [ ] `CLAUDE.md` **Status** and **Conventions** sections are current — these go stale first,
      and they are the first thing every session reads
- [ ] Stack table matches what's actually installed
- [ ] Every internal link resolves
- [ ] No accepted ADR is contradicted by shipped code. **If one is, that is either a bug or
      a missing superseding ADR — decide which**
- [ ] Playbooks match what you'd actually do now. If you improvised around one, fix it
- [ ] [open-questions.md](open-questions.md): anything answered in practice but still listed
      as open?
- [ ] Known gaps in [security-model.md](../security-model.md) §7 still accurate

### Lens 4 — Use: is it actually being used?

The lens most likely to be skipped and the most valuable. Built ≠ useful.

- [ ] Is the milestone's feature being used in real life, weekly?
- [ ] What was built and **never** used? Candidate for **deletion** — unused code is pure
      cost, and deleting it is a win, not a loss
- [ ] What is the human still doing manually that this should have caught?
- [ ] Is time-to-capture still fast? ([brain.md](brain.md) principle 2 — degrades silently)
- [ ] Is the data real, or still test fixtures? An empty database means the feature failed
      regardless of quality
- [ ] Which cross-domain question got closer to answerable?

## 2. Running a review

1. **Read the intent first** — the domain doc and the milestone in
   [roadmap.md](../roadmap.md) — *before* reading code. Reading code first anchors you to
   what exists and you stop seeing what's missing.
2. **Work the four lenses in order.** Intent, invariants, docs, use.
3. **Record every finding** in the debt register below, even trivial ones. A finding not
   written down is a finding lost.
4. **Fix cheap things immediately.** A stale doc line or a missing test is faster to fix now
   than to describe.
5. **Triage the rest** — see §4.
6. **Then re-plan if needed** ([brain.md](brain.md) §10).

**A review that finds nothing was not a review.** Say what you checked and how, so the next
reviewer can trust or repeat it. If the checks genuinely passed, name the ones you ran.

## 3. Debt register

Living record of known problems. **Findings go here; do not leave them in chat.**

Status: `open` · `accepted` (known, deliberately not fixing) · `fixed`.

| # | Finding | Severity | Status | Trigger to fix |
|---|---|---|---|---|
| D1 | Postgres RLS not enabled — repository layer is the only isolation enforcement | med | accepted | **M3**, before anyone else's data exists ([ADR-0006](../decisions/0006-space-based-ownership.md)) |
| D2 | No audit log of reads or writes | med | accepted | Before multi-member spaces ship (M3) |
| D3 | No passkeys or 2FA | high | accepted | Before going public; **hard prerequisite for the vault** (M5) |
| D4 | No backup/restore runbook; Neon PITR never tested | **high** | open | **Before storing anything irreplaceable** — arguably already overdue |
| D5 | No credential rotation procedure for R2 or the database | low | accepted | Before going public |
| D6 | No uptime monitoring or alerting | low | accepted | Before going public |
| D7 | Migration path never exercised — first real migration will be the first one ever run | med | accepted | M3. Rehearse against a Neon branch first ([ADR-0011](../decisions/0011-pre-v1-schema-resets.md)) |
| D8 | pg-boss cron would wake Neon compute, so the DB is never truly idle — free-tier hours unverified. **Moot as of 2026-07-27:** nothing is scheduled, and scheduled jobs are deliberately off in development | low | accepted | When `ENABLE_SCHEDULED_JOBS` is first switched on in a deployed environment — measure compute hours that month ([ADR-0012](../decisions/0012-pg-boss-background-jobs.md)) |
| D9 | `Idempotency-Key` is documented in [api.md](../conventions/api.md) §5 but **not implemented**. M0 ships no mutation of its own, so nothing honours it yet | med | accepted | **The first M1 `POST`.** A retried upload creating two documents is the exact failure it exists to prevent |
| D10 | Cursor pagination primitives exist in `packages/shared` but no endpoint uses them, so the shape is unproven | low | accepted | The first list endpoint (M1 `GET /documents`) |
| D11 | **No password reset and no email verification.** `requireEmailVerification: false`, and there is no mail provider. A forgotten password means deleting the user row from the database by hand | med | accepted | Before M3 — unacceptable the moment a family member has an account — **or sooner if it bites once.** Needs `RESEND_API_KEY`, already stubbed in `.env.example` |
| D12 | Auth-table `id` columns are `uuid`, diverging from what `auth:generate` emits (`text`). Justified by [data.md](../conventions/data.md) §4, but it means regenerating that file reintroduces the divergence silently | low | accepted | Any `better-auth` upgrade: regenerate, diff, re-apply the uuid columns. The header comment in `schema/auth.ts` says so |
| D13 | Better Auth's endpoints do **not** appear in `/api/v1/openapi.json`, so [api.md](../conventions/api.md)'s "the OpenAPI document is the contract" is not true for auth. `@fastify/swagger` only sees Fastify-declared schemas | low | accepted | Before a second client is written against the API (Android). Until then the web client uses `better-auth/react`, which carries its own types |
| D14 | Graceful shutdown on `SIGTERM` is unverified — Windows does not deliver POSIX signals, and that path only runs on Fly, where scale-to-zero exercises it constantly | low | open | The first `fly deploy`: watch the logs for `shutdown complete` rather than a SIGKILL |
| D15 | Production login depends on owning `mevivek.dev`. Losing or changing the domain breaks the session cookie, not just the URL ([ADR-0019](../decisions/0019-same-site-subdomain-deployment.md)) | low | accepted | Domain renewal. If it ever changes, `COOKIE_DOMAIN`, `API_BASE_URL`, `WEB_ORIGIN`, `VITE_API_URL` and `apps/web/public/_headers` all change together |
| D16 | PWA icons are generated, aliased PNGs with no antialiasing — real icons, but visibly jagged at small sizes | low | open | Whenever the app is shown to anyone, or M2's PWA polish |
| D17 | No E2E test. [ADR-0016](../decisions/0016-testing-and-tooling.md) lists Playwright; M0's acceptance test is a human on a phone | low | accepted | M1, when [testing.md](../conventions/testing.md) §6's first flow ("sign up → land on the document list") has a document list to land on |
| D18 | **The Neon dev credential was pasted into a chat transcript and has not been rotated.** Harmless today — the branch holds no real data and [ADR-0011](../decisions/0011-pre-v1-schema-resets.md) says it may be wiped freely — but Neon's free tier has no IP allowlist, so the string alone is full read/write/drop | med | open | **Before the first real document is stored.** The exposure does not get worse; the data behind it does |
| D19 | `pnpm dev` hot reload is unreliable on Windows. `--watch-path=src` fixed an infinite restart loop (20+ restarts, never healthy), but editing a file fires two watcher events and the two restarts race for port 8080, so the server may not come back. **Workaround: run without `--watch`** — `node --env-file-if-exists=.env --import tsx src/server.ts` — and restart by hand | low | open | When it becomes an actual annoyance during M1, or if a second developer/OS joins |

Seeded from [security-model.md](../security-model.md) §7 and the ADR consequence sections.
**Every entry needs a trigger** — debt with no trigger is debt nobody will ever pay.

**D4 is the one to be uncomfortable about.** Everything else is deferred against a future
milestone; D4 is a gap that bites retroactively, and the whole point of this app is holding
documents you can't afford to lose.

**D11 is the one most likely to bite first**, and it bites the maintainer personally: at M0 there
is no way to recover an account except editing the database.

## 4. Turning findings into work

| Severity | Meaning | Action |
|---|---|---|
| **high** | Data loss, security hole, or a broken invariant | Fix before the next feature. Displaces planned work |
| **med** | Real problem, contained | Register with a trigger; schedule it |
| **low** | Papercut or cosmetic | Register; batch them |

- **Broken invariant is always at least high**, regardless of whether anything has gone
  wrong yet. It means the mechanism failed, and the next session will copy the broken
  pattern.
- **A finding that recurs across two reviews escalates.** Recurrence means the fix didn't
  hold or the underlying cause was never addressed — treat the *mechanism* as the bug, not
  the instance.
- Product findings go to [idea-backlog.md](idea-backlog.md); technical debt stays here;
  anything needing a human decision goes to [open-questions.md](open-questions.md).

## 5. Review anti-patterns

| Anti-pattern | Why it's bad |
|---|---|
| **Reviewing only the diff** | Drift is cumulative. The bug is usually the interaction between two individually fine changes |
| **Finding nothing** | Not a clean bill of health — an ineffective review. State what you actually checked |
| **Fixing everything mid-review** | You lose the overview and the review never finishes. Fix cheap things, register the rest |
| **Registering without triggers** | Debt nobody will ever pay |
| **Skipping lens 4** | The one that reveals you built the wrong thing. Also the easiest to skip, because it needs honesty rather than greps |
| **Trusting the docs as ground truth** | The doc may be the thing that's wrong. Check both directions |
| **Reviewing your own work in the same session** | You'll see intent rather than what's there. Prefer a fresh session |
