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
| D3 | No passkeys or 2FA. Google sign-in ([ADR-0020](../decisions/0020-google-oauth-alongside-password.md)) is **not** a substitute — it is a second password-grade route, not a second factor | high | accepted | Before going public; **hard prerequisite for the vault** (M5) |
| D4 | No backup/restore runbook; Neon PITR never tested | **high** | open | **Before storing anything irreplaceable** — arguably already overdue |
| D5 | No credential rotation procedure for R2 or the database | low | accepted | Before going public |
| D6 | No uptime monitoring or alerting | low | accepted | Before going public |
| D7 | Migration path never exercised — first real migration will be the first one ever run | med | accepted | M3. Rehearse against a Neon branch first ([ADR-0011](../decisions/0011-pre-v1-schema-resets.md)) |
| D8 | pg-boss cron would wake Neon compute, so the DB is never truly idle — free-tier hours unverified. **Moot as of 2026-07-27:** nothing is scheduled, and scheduled jobs are deliberately off in development | low | accepted | When `ENABLE_SCHEDULED_JOBS` is first switched on in a deployed environment — measure compute hours that month ([ADR-0012](../decisions/0012-pg-boss-background-jobs.md)) |
| D9 | `Idempotency-Key` is documented in [api.md](../conventions/api.md) §5 but **not implemented**. M0 ships no mutation of its own, so nothing honours it yet | med | accepted | **The first M1 `POST`.** A retried upload creating two documents is the exact failure it exists to prevent |
| D10 | Cursor pagination primitives exist in `packages/shared` but no endpoint uses them, so the shape is unproven | low | accepted | The first list endpoint (M1 `GET /documents`) |
| D11 | **No password reset and no email verification for the password route.** `requireEmailVerification: false`, and there is no mail provider. **Mitigated, not fixed,** by Google sign-in ([ADR-0020](../decisions/0020-google-oauth-alongside-password.md)): a forgotten password no longer locks you out, because Google is a second route to the same account — but a *password-only* account still has no reset path | low | accepted | Before M3 — a family member cannot be told "just use Google" — **or sooner if it bites.** Needs `RESEND_API_KEY`, already stubbed in `.env.example` |
| D12 | Auth-table `id` columns are `uuid`, diverging from what `auth:generate` emits (`text`). Justified by [data.md](../conventions/data.md) §4, but it means regenerating that file reintroduces the divergence silently | low | accepted | Any `better-auth` upgrade: regenerate, diff, re-apply the uuid columns. The header comment in `schema/auth.ts` says so |
| D13 | Better Auth's endpoints do **not** appear in `/api/v1/openapi.json`, so [api.md](../conventions/api.md)'s "the OpenAPI document is the contract" is not true for auth. `@fastify/swagger` only sees Fastify-declared schemas | low | accepted | Before a second client is written against the API (Android). Until then the web client uses `better-auth/react`, which carries its own types |
| D14 | Graceful shutdown on `SIGTERM` is unverified — Windows does not deliver POSIX signals. **The trigger has already fired and nobody looked:** the path is on Cloud Run now, not Fly ([ADR-0021](../decisions/0021-cloud-run-for-the-api.md)), and `--min-instances=0` exercises it several times a day. The M0 review observed `uptime_seconds: 180` on a live health call, which is a cold start — so the instance before it was shut down somehow, and whether that was clean is still unknown | low | open | **Now.** Read the Cloud Run logs for `shutdown complete` rather than a SIGKILL. No deploy needed — scale-to-zero already produces the event |
| D15 | Production login depends on owning `mevivek.dev`. Losing or changing the domain breaks the session cookie, not just the URL ([ADR-0019](../decisions/0019-same-site-subdomain-deployment.md)) | low | accepted | Domain renewal. If it ever changes, `API_BASE_URL`, `WEB_ORIGIN`, `VITE_API_URL` and `apps/web/public/_headers` all change together. **Not `COOKIE_DOMAIN`** — ADR-0019's amendment established it is not required and is deliberately unset |
| D16 | PWA icons are generated, aliased PNGs with no antialiasing — real icons, but visibly jagged at small sizes | low | open | Whenever the app is shown to anyone, or M2's PWA polish |
| D17 | No E2E test. [ADR-0016](../decisions/0016-testing-and-tooling.md) lists Playwright; still unwritten. **Partly mitigated:** `scripts/verify-deployment.mjs` runs 23 checks against the deployed app, including the cross-subdomain cookie that localhost structurally cannot test — but it is a smoke script, not a test suite, and CI does not run it | low | accepted | M1, when [testing.md](../conventions/testing.md) §6's first flow has a document list to land on. Fold the script's checks into Playwright rather than rewriting them |
| D18 | **The Neon dev credential was pasted into a chat transcript and has not been rotated.** Harmless today — the branch holds no real data and [ADR-0011](../decisions/0011-pre-v1-schema-resets.md) says it may be wiped freely — but Neon's free tier has no IP allowlist, so the string alone is full read/write/drop | med | open | **Before the first real document is stored.** The exposure does not get worse; the data behind it does |
| D19 | `pnpm dev` hot reload is unreliable on Windows. `--watch-path=src` fixed an infinite restart loop (20+ restarts, never healthy), but editing a file fires two watcher events and the two restarts race for port 8080, so the server may not come back. **Workaround: run without `--watch`** — `node --env-file-if-exists=.env --import tsx src/server.ts` — and restart by hand | low | open | When it becomes an actual annoyance during M1, or if a second developer/OS joins |
| D20 | The app depended on the maintainer's laptop being awake | med | **fixed** | 2026-07-27. Web on Cloudflare Pages, API on Cloud Run ([ADR-0021](../decisions/0021-cloud-run-for-the-api.md)). The Cloudflare Tunnel is out of the routing path but kept configured — it is still the cheapest way to re-verify ADR-0019 after an auth change |
| D21 | 18 commits on `redo/architecture-scaffold` were unpushed, with no off-machine copy | high | **fixed** | Pushed 2026-07-27. `origin/redo/architecture-scaffold` now tracks. Keep pushing — the risk returns silently |
| D22 | Deploys were asymmetric: web built on push, the API needed a terminal | med | **fixed** | 2026-07-28. Cloud Build webhook trigger `deploy-api-on-push` tests, builds, deploys and health-checks on push to `main`; the guard skips deploys from other branches. Verified: 11/11 steps ran, tests took 25s against a real Postgres, and a feature-branch push was correctly **not** deployed |
| D23 | **A Pages build with `VITE_API_URL` unset produces a site that looks perfectly healthy and cannot log in.** The value is baked in at build time; when absent, `api-origin.ts` falls back to `window.location.origin` and the SPA fallback in `_redirects` answers every path with HTML and a 200. This shipped once. `node scripts/verify-deployment.mjs` greps the built JavaScript for the API origin specifically because status codes cannot detect it | med | accepted | Structural, not fixable by config. Mitigation is the verify script; run it after every deploy. A CI step asserting the origin is present in `dist` would close it properly |
| D24 | **GitHub Actions never runs on this repository.** Every run dies in seconds with no runner, no steps and no logs — an account-level block, on every commit including ones predating any workflow. Billing was corrected and a fresh push failed identically. So `.github/workflows/ci.yml` looks authoritative and executes nothing, while `cloudbuild.deploy.yaml` is the real pipeline | med | accepted | If Actions is ever unblocked: delete the Cloud Build trigger and the webhook, and let the workflow take over. Until then **do not trust the workflow file as evidence of anything** |
| D25 | **The Cloud Build trigger holds an INLINE copy of `cloudbuild.deploy.yaml`,** because a webhook trigger has no attached repository to read it from. Editing the file changes nothing until the copy is replaced, with no error to indicate the stale one ran. **Worse than it sounds: `gcloud builds triggers update webhook` cannot do it** — it rejects `--inline-config` with `INVALID_ARGUMENT` and has no `--substitutions` flag at all. The trigger must be **deleted and recreated** | med | accepted | Every edit to that file, run the delete+recreate in [README.md](../../README.md) § Deploying. Closes properly only by connecting the repo to Cloud Build, which needs its GitHub App installed |
| D26 | **CI was reported green all through M0 on the strength of local runs.** `pnpm typecheck lint test build` passing locally was repeatedly described as CI passing; the actual runs had never once succeeded. The failure mode gave no output to read, so nothing contradicted the claim | low | **fixed** | 2026-07-28. [testing.md](../conventions/testing.md) §7 now states that local green is not CI green and gives the two commands that distinguish "a test failed" from "the job never started" |
| D27 | **[api.md](../conventions/api.md) §7's "unknown query parameters are rejected, not ignored" is not implemented, and the mechanism cited for it cannot implement it.** `app.ts` set an `ajv` option in that rule's name, but `setValidatorCompiler(validatorCompiler)` replaces ajv entirely for Zod-schema routes, and a Zod object *strips* unknown keys rather than rejecting them. **Confirmed by probe** during the M0 review, reproducing `app.ts`'s exact setup: `?limit=5&typo=oops` returned **200, not 400**. Harmless at M0 — no endpoint takes a querystring — and the inert option has been removed so it no longer reads as enforcement | med | open | **M1's `GET /documents`.** Add `.strict()` to the querystring schema (or a shared strict helper in `packages/shared`) plus a test asserting 400 on an unknown parameter. This is the endpoint the rule exists for: a typo'd `?expiring_befor=` that silently returns the *unfiltered* list is worse than an error |
| D28 | **Deployment status is asserted independently in five files, and M0's deploy work updated two of them.** The M0 review found the same drift in `README.md` (front page still said "not yet deployed", and § Deploying still opened with "no deploy has ever been executed"), `CLAUDE.md`'s stack table ("Fly.io … never deployed", contradicting its own Status section 100 lines above), `architecture.md` §9 (API → Fly.io, citing the superseded ADR-0014), and `roadmap.md`'s caveat about API deploys needing a terminal (D22, fixed). All fixed 2026-07-28, but **the mechanism is the finding**: nothing makes one of these authoritative, so the next hosting or pipeline change will drift the same way | med | open | The next change to what is deployed or how. Either cut the duplicated status down to one authoritative place that the others link to, or add it to the lens-3 checklist as a named list of files to update together. **[§4](#4-turning-findings-into-work): if this recurs at the M1 review, treat the duplication as the bug, not the stale lines** |
| D29 | Tests, `.github/workflows/ci.yml` and `cloudbuild.deploy.yaml` all run **`postgres:17-alpine`**, while production is Neon **18.4**. [ADR-0005](../decisions/0005-postgres-neon-drizzle.md) says explicitly not to pin a major version and to record the observed one; the test image pins 17 anyway. [ADR-0018](../decisions/0018-testcontainers-for-api-tests.md)'s "revisit if" anticipates the image and Neon diverging on a feature — it already reads as a hypothetical when the versions have in fact diverged | low | open | Bump the image to `postgres:18-alpine` in all three places at the next touch of any of them, or the first time a query behaves differently in tests than on Neon. Nothing currently depends on an 18-only feature, which is why this is low and not med |
| D30 | `wrangler` is a root devDependency with **no script that invokes it**. Cloudflare Pages builds through the dashboard's git integration, so nothing runs `wrangler pages deploy`. Its `workerd` postinstall pulls a ~100MB platform binary, which is why `pnpm-workspace.yaml` carries an `onlyBuiltDependencies` note about it — the note outlived the need | low | open | Next dependency audit, or sooner if install size bites. Removing it also removes the `pnpm-workspace.yaml` note; keep it only if a local `wrangler pages dev` is actually wanted |
| D31 | **[security-model.md](../security-model.md) §7 "Known gaps" and this register are two hand-maintained lists of the same thing, and they had already diverged.** §7 omitted the missing password reset / email verification (D11) and the unrotated Neon credential (D18) — both registered here. Rows added 2026-07-28, but §7 is the doc a session is told to read *in full* before touching auth, so a gap missing from it is a gap that session will not know about | low | open | Any change to either list. The durable fix is for §7 to stop restating and instead point at this register with the security-relevant ids (D1–D5, D11, D18) |

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
| **Appending findings to the nearest table** | D24–D26 were appended to *this* table rather than the register in §3, so their severity, status and trigger silently vanished — GitHub Flavored Markdown drops cells past the header's column count. Findings go in §3, and nowhere else |

## 6. Review log

What each review actually checked, so the next one can trust it or repeat it
([§2](#2-running-a-review): naming the checks is part of the deliverable).

### M0 — 2026-07-28

Run by a session that did **not** build M0, as [roadmap.md](../roadmap.md) asked.

**Verified green, not assumed.** `pnpm typecheck` (4 tasks), `pnpm lint` (Biome, 102 files) and
`pnpm build` all pass. **`pnpm test` was run twice, deliberately:** once as the environment came
(**23 passed, 17 skipped** — no container runtime), then again after starting Docker
(**40 passed, 0 skipped**, `postgres:17-alpine` via Testcontainers, 20s). That second run is the
first recorded evidence that the database-backed suites *execute* rather than skip — M0 reported
"40 tests pass" from a machine where 17 of them never ran ([ADR-0018](../decisions/0018-testcontainers-for-api-tests.md),
D26). **Check the skip count** is not advice, it is the finding.

**Lens 1 — intent.** No M0 domain doc exists to diff against, so the spec is the M0 checklist plus
[conventions/api.md](../conventions/api.md). Every endpoint the checklist claims exists and is
reachable; nothing undocumented is mounted. One rule was found unimplemented — api.md §7, now D27,
confirmed by probe rather than by reading.

**Lens 2 — invariants. All twelve hold; this is the part of M0 that is in genuinely good shape.**
Ran the greps in §2 plus: `space_id`/`owner_id` on every schema file, `db.select|insert|update|delete`
outside repositories (none), every `.repository.ts` export's first parameter, `as any` /
`@ts-ignore` / `!.` (only `routeTree.gen.ts`, generated), empty `catch` blocks (none), and a
credential scan across the tree (clean — the one hit is a throwaway test Postgres in
`cloudbuild.deploy.yaml`). `scoped()` is structurally typed so a table lacking `spaceId`/`deletedAt`
is a **compile** error, which makes security-model.md §3's claim literally true rather than
aspirational. The three `actor`-less functions in `spaces.repository.ts` and the non-`scoped()`
reads in `me.repository.ts` are the only deviations, both deliberate, both carrying the comment
[code.md](../conventions/code.md) §10 requires.

**Lens 3 — docs. Where M0 drifted, and it was one mechanism producing many symptoms.** See D28.
Fixed in this review: `README.md`'s status and § Deploying, `CLAUDE.md`'s stack and conventions
tables, `architecture.md` §9, `roadmap.md`'s stale D22 caveat and its "GitHub Actions CI" checkbox,
ADR-0019's `COOKIE_DOMAIN` self-contradiction, D14's and D15's stale triggers, and §7 of
security-model.md. All 44 markdown files were link-checked programmatically, targets and anchors —
**zero broken links**, which is worth recording as a check that passed.

**Lens 4 — use.** M0 ships no user-facing feature, so "used weekly?" has no honest answer yet; the
question M0 *can* answer is whether it stays up unattended. It does. A live read-only health call
returned **200** with `version: 76d2881`, `uptime_seconds: 180` — a cold start, so scale-to-zero is
working. `main` was one commit ahead at `8c7c790`, and **that is the correct state**: `8c7c790` is
doc-only and the pipeline deliberately skips those, so this independently verifies both D22's fix
and the doc-only skip from outside the pipeline. `app.mevivek.dev` answered 200. The database still
holds only the two accounts created during the 2026-07-27 verification — **the data is not real
yet**, which is expected at M0 and is exactly what M1 has to change.

Deletion candidates found: `wrangler` (D30). `apps/api/fly.toml` was considered and **kept** —
[ADR-0021](../decisions/0021-cloud-run-for-the-api.md) already declared it deliberate, so it is not
a finding.