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
| D8 | pg-boss cron would wake Neon compute, so the DB is never truly idle — free-tier hours unverified. **Resolved by avoidance, 2026-07-30 ([ADR-0028](../decisions/0028-external-trigger-for-the-daily-scan.md)):** the daily scan is no longer a pg-boss schedule at all. Cloud Scheduler POSTs `/api/v1/maintenance:run-daily`, the request wakes the API, the work runs inline, and the instance and the database both go back to sleep. `ENABLE_SCHEDULED_JOBS` stays **off**, which is now a permanent position rather than a deferral | low | **closed** | Nothing. The trigger to watch has moved: if `ENABLE_SCHEDULED_JOBS` is ever switched on in a deployed environment, this reopens immediately — measure Neon compute hours that month |
| D9 | `Idempotency-Key` is documented in [api.md](../conventions/api.md) §5 but **not implemented**. M0 ships no mutation of its own, so nothing honours it yet | med | **fixed** | 2026-07-28, M1. `lib/idempotency.plugin.ts` — one plugin, not per route. Claimed with insert-on-conflict so concurrency is settled by a unique index; a failed operation releases its claim so a real retry still works. A retried `POST /documents` returns the first document instead of creating a second |
| D10 | Cursor pagination primitives exist in `packages/shared` but no endpoint uses them, so the shape is unproven | low | **fixed** | 2026-07-28, M1. `lib/cursor.ts`, shared across domains. The `id` tie-break and nulls-last handling are the parts that were unproven; there is a test paging through four documents that share one `expires_on`, which is the case naive keyset pagination gets wrong |
| D11 | **No password reset and no email verification for the password route.** `requireEmailVerification: false`, and there is no mail provider. **Mitigated, not fixed,** by Google sign-in ([ADR-0020](../decisions/0020-google-oauth-alongside-password.md)): a forgotten password no longer locks you out, because Google is a second route to the same account — but a *password-only* account still has no reset path | low | accepted | Before M3 — a family member cannot be told "just use Google" — **or sooner if it bites.** Needs `RESEND_API_KEY`, already stubbed in `.env.example` |
| D12 | Auth-table `id` columns are `uuid`, diverging from what `auth:generate` emits (`text`). Justified by [data.md](../conventions/data.md) §4, but it means regenerating that file reintroduces the divergence silently | low | accepted | Any `better-auth` upgrade: regenerate, diff, re-apply the uuid columns. The header comment in `schema/auth.ts` says so |
| D13 | Better Auth's endpoints do **not** appear in `/api/v1/openapi.json`, so [api.md](../conventions/api.md)'s "the OpenAPI document is the contract" is not true for auth. `@fastify/swagger` only sees Fastify-declared schemas | low | accepted | Before a second client is written against the API (Android). Until then the web client uses `better-auth/react`, which carries its own types |
| D14 | Graceful shutdown on `SIGTERM` is unverified — Windows does not deliver POSIX signals. **The trigger has already fired and nobody looked:** the path is on Cloud Run now, not Fly ([ADR-0021](../decisions/0021-cloud-run-for-the-api.md)), and `--min-instances=0` exercises it several times a day. The M0 review observed `uptime_seconds: 180` on a live health call, which is a cold start — so the instance before it was shut down somehow, and whether that was clean is still unknown | low | open | **Now.** Read the Cloud Run logs for `shutdown complete` rather than a SIGKILL. No deploy needed — scale-to-zero already produces the event |
| D15 | Production login depends on owning `mevivek.dev`. Losing or changing the domain breaks the session cookie, not just the URL ([ADR-0019](../decisions/0019-same-site-subdomain-deployment.md)) | low | accepted | Domain renewal. If it ever changes, `API_BASE_URL`, `WEB_ORIGIN`, `VITE_API_URL` and `apps/web/public/_headers` all change together. **Not `COOKIE_DOMAIN`** — ADR-0019's amendment established it is not required and is deliberately unset |
| D16 | PWA icons were generated, aliased PNGs with no antialiasing — real icons, but visibly jagged at small sizes | low | **fixed** | 2026-07-28. `scripts/generate-icons.mjs` rasterises `favicon.svg` with Chromium (already installed, so no new dependency): 2.9× the pixel data at 192px. Also added a **separate maskable icon** — `purpose: 'maskable'` had been pointing at the ordinary one, so Android cropped its rounded corners a second time and clipped the glyph |
| D17 | No E2E test. [ADR-0016](../decisions/0016-testing-and-tooling.md) lists Playwright; still unwritten. **Partly mitigated:** `scripts/verify-deployment.mjs` runs 25 checks against the deployed app, including the cross-subdomain cookie that localhost structurally cannot test — but it is a smoke script, not a test suite, and CI does not run it | low | accepted | **Trigger has fired — see D35**, which carries this forward now that the flow exists and has been driven manually. Fold the script's checks into Playwright rather than rewriting them |
| D18 | **The Neon dev credential was pasted into a chat transcript and had not been rotated.** Neon's free tier has no IP allowlist, so the string alone was full read/write/drop | med | **closed 2026-07-30** | Rotated in the Neon console and rebound via `./scripts/provision.ps1 neon`, ahead of the first real document exactly as the trigger required. Revision `life-manager-api-00016-wgs` came up healthy on the new credential, which also proves migrate-on-boot reconnected |
| D19 | `pnpm dev` hot reload is unreliable on Windows. `--watch-path=src` fixed an infinite restart loop (20+ restarts, never healthy), but editing a file fires two watcher events and the two restarts race for port 8080, so the server may not come back. **Workaround: run without `--watch`** — `node --env-file-if-exists=.env --import tsx src/server.ts` — and restart by hand | low | open | When it becomes an actual annoyance during M1, or if a second developer/OS joins |
| D20 | The app depended on the maintainer's laptop being awake | med | **fixed** | 2026-07-27. Web on Cloudflare Pages, API on Cloud Run ([ADR-0021](../decisions/0021-cloud-run-for-the-api.md)). The Cloudflare Tunnel is out of the routing path but kept configured — it is still the cheapest way to re-verify ADR-0019 after an auth change |
| D21 | 18 commits on `redo/architecture-scaffold` were unpushed, with no off-machine copy | high | **fixed** | Pushed 2026-07-27. `origin/redo/architecture-scaffold` now tracks. Keep pushing — the risk returns silently |
| D22 | Deploys were asymmetric: web built on push, the API needed a terminal | med | **fixed** | 2026-07-28. Cloud Build webhook trigger `deploy-api-on-push` tests, builds, deploys and health-checks on push to `main`; the guard skips deploys from other branches. Verified: 11/11 steps ran, tests took 25s against a real Postgres, and a feature-branch push was correctly **not** deployed |
| D23 | **A Pages build with `VITE_API_URL` unset produces a site that looks perfectly healthy and cannot log in.** The value is baked in at build time; when absent, `api-origin.ts` falls back to `window.location.origin` and the SPA fallback in `_redirects` answers every path with HTML and a 200. This shipped once. `node scripts/verify-deployment.mjs` greps the built JavaScript for the API origin specifically because status codes cannot detect it | med | accepted | Structural, not fixable by config. Mitigation is the verify script; run it after every deploy. A CI step asserting the origin is present in `dist` would close it properly |
| D24 | **GitHub Actions never runs on this repository.** Every run dies in seconds with no runner, no steps and no logs — an account-level block, on every commit including ones predating any workflow. Billing was corrected and a fresh push failed identically. So `.github/workflows/ci.yml` looks authoritative and executes nothing, while `cloudbuild.deploy.yaml` is the real pipeline | med | accepted | If Actions is ever unblocked: delete the Cloud Build trigger and the webhook, and let the workflow take over. Until then **do not trust the workflow file as evidence of anything** |
| D25 | **The Cloud Build trigger holds an INLINE copy of `cloudbuild.deploy.yaml`,** because a webhook trigger has no attached repository to read it from. Editing the file changes nothing until the copy is replaced, with no error to indicate the stale one ran. **Worse than it sounds: `gcloud builds triggers update webhook` cannot do it** — it rejects `--inline-config` with `INVALID_ARGUMENT` and has no `--substitutions` flag at all. The trigger must be **deleted and recreated** | med | accepted | Every edit to that file, run the delete+recreate in [README.md](../../README.md) § Deploying. Closes properly only by connecting the repo to Cloud Build, which needs its GitHub App installed |
| D26 | **CI was reported green all through M0 on the strength of local runs.** `pnpm typecheck lint test build` passing locally was repeatedly described as CI passing; the actual runs had never once succeeded. The failure mode gave no output to read, so nothing contradicted the claim | low | **fixed** | 2026-07-28. [testing.md](../conventions/testing.md) §7 now states that local green is not CI green and gives the two commands that distinguish "a test failed" from "the job never started" |
| D27 | **[api.md](../conventions/api.md) §7's "unknown query parameters are rejected, not ignored" is not implemented**, and the mechanism cited for it cannot implement it (an inert `ajv` option; `fastify-type-provider-zod` replaces ajv, and a Zod object *strips* unknown keys). Confirmed by probe during the M0 review: `?limit=5&typo=oops` returned **200** | med | **fixed** | 2026-07-28, M1. Every querystring schema is `z.strictObject`, and `pageQueryShape` is exported as a raw shape rather than a schema so that spreading it cannot silently produce a non-strict object. `?expiring_befor=` is a 400 naming the key |
| D28 | **Deployment status is asserted independently in five files, and M0's deploy work updated two of them.** The M0 review found the same drift in `README.md` (front page still said "not yet deployed", and § Deploying still opened with "no deploy has ever been executed"), `CLAUDE.md`'s stack table ("Fly.io … never deployed", contradicting its own Status section 100 lines above), `architecture.md` §9 (API → Fly.io, citing the superseded ADR-0014), and `roadmap.md`'s caveat about API deploys needing a terminal (D22, fixed). All fixed 2026-07-28, but **the mechanism is the finding**: nothing makes one of these authoritative, so the next hosting or pipeline change will drift the same way | med | open | The next change to what is deployed or how. Either cut the duplicated status down to one authoritative place that the others link to, or add it to the lens-3 checklist as a named list of files to update together. **[§4](#4-turning-findings-into-work): if this recurs at the M1 review, treat the duplication as the bug, not the stale lines** |
| D29 | Tests, `.github/workflows/ci.yml` and `cloudbuild.deploy.yaml` all run **`postgres:17-alpine`**, while production is Neon **18.4**. [ADR-0005](../decisions/0005-postgres-neon-drizzle.md) says explicitly not to pin a major version and to record the observed one; the test image pins 17 anyway. [ADR-0018](../decisions/0018-testcontainers-for-api-tests.md)'s "revisit if" anticipates the image and Neon diverging on a feature — it already reads as a hypothetical when the versions have in fact diverged | low | open | Bump the image to `postgres:18-alpine` in all three places at the next touch of any of them, or the first time a query behaves differently in tests than on Neon. Nothing currently depends on an 18-only feature, which is why this is low and not med |
| D30 | `wrangler` is a root devDependency with **no script that invokes it**. Cloudflare Pages builds through the dashboard's git integration, so nothing runs `wrangler pages deploy`. Its `workerd` postinstall pulls a ~100MB platform binary, which is why `pnpm-workspace.yaml` carries an `onlyBuiltDependencies` note about it — the note outlived the need | low | open | Next dependency audit, or sooner if install size bites. Removing it also removes the `pnpm-workspace.yaml` note; keep it only if a local `wrangler pages dev` is actually wanted |
| D31 | **[security-model.md](../security-model.md) §7 "Known gaps" and this register are two hand-maintained lists of the same thing, and they had already diverged.** §7 omitted the missing password reset / email verification (D11) and the unrotated Neon credential (D18) — both registered here. Rows added 2026-07-28, but §7 is the doc a session is told to read *in full* before touching auth, so a gap missing from it is a gap that session will not know about | low | open | Any change to either list. The durable fix is for §7 to stop restating and instead point at this register with the security-relevant ids (D1–D5, D11, D18) |

| D32 | **A `:verb` action suffix is a trap in two separate ways**, both fixed but neither obvious. Fastify parses `:` as a path parameter, so an unescaped pattern matched `POST /documents/x/filesGARBAGE` and left `params.fileId` undefined; `::` escapes it. And `@fastify/swagger` mistranslates the escape when it follows a *parameter*, emitting `/files/{fileId}:{presign}-download` — correct routing, wrong contract | med | **fixed** | 2026-07-28, M1. [api.md](../conventions/api.md) §2 now states both rules; the two affected endpoints take the id in the body or use a path segment. `documents.test.ts` asserts the 404 and the generated OpenAPI paths, because both failures are silent and too-permissive |
| D33 | **`file_count` was always 0 for the whole of M1's build, and 136 tests did not catch it.** In a select-field position Drizzle renders a correlated subquery's columns unqualified, so `where "document_id" = "id"` compared `document_files.document_id` to `document_files.id`. The same expression in a `WHERE` clause *is* qualified, so `?has_file=` filtered correctly and nothing looked broken until the dashboard showed "no file" beside a freshly uploaded file | med | **fixed** | 2026-07-28. Now `db.$count`, which qualifies by construction. **The test lesson is the durable part:** every `file_count` assertion happened to expect 0, so a constant-zero subquery satisfied all of them. When asserting a count, assert a non-zero one and assert it *changes* |
| D34 | **The R2 object for a deleted or abandoned file is never removed.** Business rule 10 says the sweep job deletes the orphaned object; it only sweeps the rows. `lib/storage.ts` has no delete path, and rule 9 deliberately keeps objects for deleted *documents*, so the two cases need distinguishing before anything is deleted | low | open | Before storage cost or the 10 GB free tier matters — realistically once the archive is real. Needs a `deleteObject` in `lib/storage.ts` plus a rule for "abandoned (never confirmed, >24h)" vs "deleted document (keep, recoverable)" |
| D35 | **No E2E test, still** — but M1 removed the excuse. D17 said "M1, when the first flow has a document list to land on"; that flow now exists and was driven manually in a real browser (signup → capture → expiry → upload → dashboard → search) with screenshots reviewed at phone width. That verification is **not committed**, so it does not run again | med | open | Fold the manual flow and `scripts/verify-deployment.mjs` into Playwright. Supersedes D17's "partly mitigated" framing: the flow is no longer hypothetical, only unautomated |
| D36 | A Zod **querystring** rejection reports its `path` as `(body)`, because `lib/problem.ts` falls back to that when `instancePath` is empty. Cosmetic but misleading — a client developer reads "(body)" for a URL problem. The message itself names the offending key, which is the actionable part | low | open | Next touch of `problem.ts`. Fastify's validation error does carry which part failed; thread it through instead of defaulting |

| D37 | **The PWA did not feel like an app**, and the causes were mechanical rather than aesthetic: no persistent navigation at all (moving between screens meant a text link and the browser's back button), selectable text and grey tap highlights on every element, browser overscroll and pull-to-refresh, five independent `Loading…` strings, and a centred `max-w-2xl py-8` document layout | med | **fixed** | 2026-07-28. Bottom tab bar (`components/TabBar.tsx`), `user-select`/tap-highlight/`overscroll-behavior` handled in `styles.css` with the tell each one removes written next to it, skeletons shaped like the content they replace, and card padding cut from `p-6` to `p-4` on mobile. **Verified by screenshot at 390px, not by reasoning** — every remaining fix came from looking at it |
| D42 | **The app's own CSP blocked every file upload in production.** `connect-src` named the API but not R2, and [ADR-0008](../decisions/0008-object-storage-r2.md) sends file bytes browser → R2 directly. CSP is browser-only, so the presign, the PUT, the CORS preflight and the confirm all passed from a script while no upload could work at all. Worse, a CSP block reaches JavaScript as a bare network error — indistinguishable from being offline — so the outbox queued each attempt under "waiting to send" and a phone with full signal sat under that message indefinitely | **high** | **fixed 2026-07-30** | Found from a user report, not a check. `_headers` now allows `https://*.r2.cloudflarestorage.com`, and `verify-deployment.mjs` §7 compares the deployed CSP against the origin of a REAL presigned URL — it failed against the live deploy before the fix, which is how we know it works |
| D43 | **The outbox retried a doomed write forever, silently.** Any `fetch` rejection became an `OfflineError`, so a write blocked by CSP, CORS, DNS or TLS was queued as "waiting to send" and retried on every launch with no attempt counter and no escalation. D42 is what exposed it | med | **fixed 2026-07-30** | Attempts that fail **while the browser reports being online** are now counted; after three the entry is surfaced as needing attention. Offline attempts are deliberately not counted — waiting is correct with no network. The pending banner is also tappable now, and no longer promises "when you are back online" while online |
| D41 | **`DELETE /documents/:id` had no version precondition, so a stale delete could destroy a newer edit.** Loading a document on one device, editing it on another, then deleting on the first removed the newer version with nothing shown — and a delete is the one write this app cannot undo, since there is no restore endpoint | med | **closed 2026-07-30** | Closed by requiring `?version=` on the route (a query parameter, since `fetch` will not reliably send a `DELETE` body). Three tests cover it: a stale delete is 409 and leaves the document intact, an omitted version is 400 rather than an unconditional delete, and a typo'd `?verison=` is 400 rather than being stripped |
| D40 | **`__APP_VERSION__` is declared by `define` in TWO configs — `vite.config.ts` for the build and `vitest.config.ts` for tests — and nothing keeps them in step.** `lib/persister.ts` reads it at module scope, so a config missing it fails with `__APP_VERSION__ is not defined` at import time, which reads as a broken test rather than a missing define (it did exactly that once while being written) | low | open | Adding a second build-time global. The durable fix is a shared fragment both configs import |
| D39 | **The local S3 mock does not validate presigned URLs** — Adobe S3Mock accepts signature, expiry and HTTP verb without checking any of them. So `docker-compose.dev.yml` can verify that the *upload flow* works, and cannot verify the *presign contract*. Both storage bugs M1 actually hit were signature-content bugs (unsigned `content-type`; a CRC32 checksum signed over an empty body) and neither would fail here. MinIO does validate, and was what M1 was verified against, but its server is AGPL-3.0 — a prohibited licence | med | open | Before trusting any change to `lib/storage.ts` that a local upload appears to confirm. Re-verify against real R2, or find an Apache-2.0 mock that validates SigV4 |
| D38 | **No route transitions and no scroll restoration.** Navigating swaps screens instantly with no push/pop animation, and returning to a list starts at the top. Both are things a native app does for free and their absence is felt rather than seen | low | open | The next round of PWA polish, or M2's offline work — TanStack Router has scroll restoration built in, so that half is small |
| D42 | **The design system's tokens and `cn()` are coupled, and nothing enforces it.** `tailwind-merge` cannot distinguish `text-onink` (a colour) from `text-row` (a size), so every `--text-*`, `--radius-*` and named `--spacing-*` token has to be declared in the class groups in `apps/web/src/lib/utils.ts`. Omitting one does not error — it silently drops a class, and the first instance of this shipped a primary button rendering **ink on ink** with correct DOM, correct classes and a correct accessible name | med | **mitigated** | 2026-07-29 ([ADR-0025](../decisions/0025-ledger-design-system.md)). All three scales declared and exported; `utils.test.ts` walks them. **Still open in principle**: a new token added to `styles.css` alone reintroduces it for that class. The durable fix is generating the lists from the CSS rather than hand-maintaining them |
| D43 | **No visual regression testing, and FIVE bugs in the ADR-0025 work were catchable only by looking** — the fifth found by the maintainer on a real phone after deploy, not by me: on an archive of one undated document the Now screen left most of a viewport empty above the tab bar, because the shell is `min-h-dvh` and the page did not `flex-1`. **Every fixture had twelve documents in it**, so no local check could have shown it; the lesson is that a sparse state needs its own fixture, now written into [conventions/design.md](../conventions/design.md) §10. The other four: the ink-on-ink button (D42), a chevron missing from the first row of every grouped card, a push ask offering to notify about a date six weeks in the *past*, and a file row clipping "Version 1" to "Versi…". All four had valid markup, passing tests and correct accessible names — the failure was entirely in the pixels | med | open | Before the next substantial UI change. Playwright is still not installed (D35), and installing it for screenshots would also unblock the E2E gap — one dependency closes both |
| D44 | **Document identifiers are stored in plaintext.** [ADR-0026](../decisions/0026-store-the-full-identifier.md) keeps the full Aadhaar / PAN / passport number in `documents.identifier` with no encryption, by explicit product decision — invariant 7 and [ADR-0009](../decisions/0009-sensitivity-tiers.md) reserve application-level encryption for the vault. The threat model this accepts is a lost phone rather than a hostile DBA, and it is honest in the UI: `IdentifierCard` and the You screen both say the numbers are *not* encrypted, and a test asserts the word never appears | med | **accepted, not fixed** | **M5, when the vault ships key management.** Doing it before then means a bespoke second crypto scheme to rotate, and would invite reading `Reveal` as a security boundary — which it is not. If a second user is ever added, re-decide first: the calculus changes the moment the DBA and the data subject are different people |
| D45 | **The preset table is India-only and matched by title string.** `apps/web/src/features/documents/presets.ts` hard-codes 22 Indian documents, and `numberLabelFor()` recovers a saved document's number label by exact-matching its **title** against that list — because the app deliberately does not store which preset created a row. So renaming "Aadhaar" to "Aadhaar (mine)" silently reverts its field label to the generic "Number" | low | open | **A second country, or a second user.** The fix is a `preset` column, which is only worth it once there is more than one list to choose between — until then it would be a fourth way to describe a document's type alongside `doc_type`, `custom_attrs` and tags |
| D46 | **The persisted-cache buster never changed, and nothing checked that it did — it crashed the app on a real phone.** `__APP_VERSION__` was `process.env.VITE_APP_VERSION ?? 'dev'` and **`VITE_APP_VERSION` was set nowhere**, so every deploy shipped the buster `'dev'` and the IndexedDB Query cache was never discarded. [ADR-0026](../decisions/0026-store-the-full-identifier.md) added `identifier` to the detail response; a weeks-old cached document rehydrated without it — **rehydration does not re-run Zod, validation is at the fetch boundary** — and `IdentifierCard` read `.length` off `undefined`. Root error boundary, *"undefined is not an object"*, app unusable, within the hour | **high** | **fixed + open** | Buster is now `CF_PAGES_COMMIT_SHA`, and the two components that read the new field tolerate a stale shape (tests: "survives a document cached by an older build"). **Still open:** nothing verifies the buster actually changes per deploy. A unit test cannot — the value is injected at build time and Vitest injects its own — so the check belongs in `scripts/verify-deployment.mjs`, which already greps the shipped bundle for `VITE_API_URL` for exactly this "configured wrong, looks fine" class. **Do that before the next response-shape change** |
| D47 | **Every document number is now on the phone, in plaintext, in IndexedDB.** [ADR-0027](../decisions/0027-identifier-in-the-list-response.md) put `identifier` on `documentSchema` so the archive can show and copy a number without a detail round-trip. The persisted Query cache writes list responses to disk (`lib/persister.ts`, `'documents'` is allowlisted), so a device that has opened the archive holds every Aadhaar, PAN and policy number for up to `MAX_AGE_MS` (7 days). Same plaintext posture as the database (D44) — but on the device most likely to be lost | med | **accepted, mitigable** | **If this becomes uncomfortable, do NOT un-ship ADR-0027.** The cheap fix is to strip `identifier` on *dehydrate*: `persister.ts` already has a `shouldDehydrateQuery` hook, and dropping one field on the way to disk keeps the fast path and loses the at-rest copy. Reconsider the moment a second user or a shared device exists |
| D48 | **A single-choice chip row can select two chips, and no test in this codebase can see it.** `DocumentForm`'s people picker stored "the name fields are open" as state seeded from `initial.holder`. Every saved holder is also a *suggestion*, so editing a document filed for Priya selected **her chip and the dashed "Someone else" chip together**, with an editable second copy of her name below — and choosing **Me** left an empty *Their name* open beneath a selected Me. Both were invisible to the eleven tests around them, because **the submitted payload was correct in every case**; the defect was entirely in which controls appeared and which were lit | med | **fixed, class open** | Openness is now derived (`askedForAName || (name has no chip)`), every `selected` is gated on it, and four tests lock the transitions. **The class is not fixed:** nothing asserts "at most one chip in a single-choice row is `aria-pressed`", and this codebase now has three chip rows (type, preset, people). That invariant is a six-line test helper and belongs beside `utils.test.ts` — write it the next time a chip row is added, or the fifth "found only by looking" bug (D43) will be this one again |
| D49 | **The app launched to a blank screen, and the offline read cache never worked at all.** `main.tsx` mounted `RouterProvider` inside `PersistQueryClientProvider` on the belief — stated in a comment — that it restores the IndexedDB cache *before* rendering children. It does not: it renders children immediately and restores in a `useEffect`. React runs a child's effects before its parent's, so the router's initial load ran FIRST and `routes/_authed.tsx`'s `ensureQueryData(['me'])` hit an **empty cache on every launch**. Online that meant every cold start waited on the API behind a blank page; offline `networkMode: 'online'` *paused* the fetch, so `beforeLoad` awaited a promise that never settled and the app rendered **nothing, permanently** — not the cached archive [ADR-0013](../decisions/0013-read-only-offline-v1.md) promises | **high** | **fixed** | Fixed: `App.tsx`'s `RestoreGate` holds the tree on `useIsRestoring()`, the `me` query is `networkMode: 'offlineFirst'` via one shared `meQueryOptions`, and the router has a `defaultPendingComponent` so a genuinely-cold guard draws the shell instead of nothing. `lib/startup.test.tsx` pins all of it and each fix was verified to fail independently. **The class is what matters:** `offline.test.ts` asserted `me` was on the persist *allowlist* and passed throughout — "in the cache file" and "reaching the guard in time" are different claims, and only the first was ever tested |
| D50 | **A cold API start is ~9 seconds, and `/health` pays for it too.** Measured on production 2026-07-30: `/api/v1/health` answered in **8825ms cold against 22ms warm**. That endpoint deliberately does not touch Postgres, so the time is process boot, not query time. Locally against an already-awake Postgres the whole boot is ~1.1s (module graph 880ms; `migrate()` 11ms steady-state; pg-boss `start()` **12ms** — it is not the culprit), which leaves ~7s unaccounted for. [ADR-0023](../decisions/0023-migrate-on-boot.md)'s migrate-on-boot opens the first unpooled connection to a sleeping Neon *before* `listen()`, so **every endpoint waits on Neon's compute wake**, including the one written specifically to avoid waking it | med | open, **measured** | Not a code fix — `--min-instances=0` is load-bearing for the free tier ([ADR-0021](../decisions/0021-cloud-run-for-the-api.md)). The client no longer *shows* the wait (D49). Three cheap options when it next annoys: Cloud Run `--cpu-boost`; lazy-import `@aws-sdk/client-s3` so presign-only code leaves the boot path; confirm the Neon share first with `gcloud run services logs read` — the API already logs `migrations applied {ms}` |
| D51 | **The first launch after every deploy starts twice.** `registerType: 'autoUpdate'` with `registerSW({ immediate: true })` reloads without prompting — vite-plugin-pwa's `client/build/register.js` calls `window.location.reload()` on the new worker's `activated` event. So a deploy costs a full boot, a service-worker swap, and a second full boot; and because the same deploy changes `CF_PAGES_COMMIT_SHA`, the reload lands on a cache the buster has just discarded (D46), which is exactly when the guard must go to the network. Once per deploy, not per launch | low | **accepted** | Leave it. The reload is how a new deploy takes effect without an update prompt, which was a deliberate call for a single-user app, and suppressing it risks serving stale code against a changed API. Recorded so the doubled startup is not re-diagnosed as a new bug |
| D52 | **`CRON_SECRET` is a long-lived shared secret with no rotation procedure.** [ADR-0028](../decisions/0028-external-trigger-for-the-daily-scan.md) authenticates the daily-scan trigger with a 32-byte secret in Secret Manager, compared in constant time. It is never in the repository — but it lives in **two** places that must agree (the secret, and the Cloud Scheduler job's `X-Cron-Key` header), so rotating it is a two-step with a window where one is updated and the other is not. During that window the scan either 401s or runs with the old key. There is also no expiry and no audit of who has seen it. **And it leaks on sight:** `gcloud scheduler jobs create/update/describe` prints the job as YAML *including its headers*, so the first real provisioning run displayed the secret in the terminal and it had to be rotated immediately. Both provision scripts now pass `--format=none`, but **any** read of the job (`jobs describe`, `jobs list --format=yaml`) still prints it | med | **accepted, one cause fixed** | Rotate alongside the other credentials when D5 (no key-rotation procedure) is done — the same runbook covers both, and doing this one alone would mean writing that runbook for the least valuable secret in the system. **Or sooner, and better: if the API ever stops needing to be publicly invocable, switch to Cloud Scheduler's OIDC token and the secret disappears entirely** (ADR-0028 records why OIDC was not viable while the browser calls the same service) | **Inspect the job with `--format='value(schedule,state)'`, never bare `jobs describe`.**
| D53 | **The provisioning scripts are the one part of this repo no agent session can execute, and it shows.** ADR-0028's `cron` step took **four** bugs to land, three found by the maintainer running it: `--headers` passed to gcloud's `update` verb, which only `create` accepts — and it failed *between* two writes, leaving the API on the new secret while the job still held the old one; gcloud echoing the secret in its own success output; a verify instruction pointing at `gcloud run services logs read`, which renders `textPayload` while this API logs JSON to `jsonPayload`; and a **415** on any bodyless POST declaring `application/octet-stream`, which is what Cloud Scheduler sends. Every one was in code an agent container cannot run — no `pwsh`, no `gcloud`, and `app.inject` defaults to no content-type, which is the one case that happened to work | med | **open — a process gap, not a bug** | **Treat `scripts/provision.*` and any gcloud argument list as a first draft until a human has run it**, and say so when handing one over. Two things would have caught most of this cheaply: asserting the HTTP surface across the content types real clients send (now done — four tests), and reading gcloud's flag reference for the *specific verb* rather than assuming create/update symmetry. Installing PowerShell in the dev container would close the rest; until then, no session should describe these scripts as verified |

| D54 | **The web app and the API deploy independently, and a client that requires a new response field takes the app down when the API lags.** Merging the handoff-4 work deployed the web half via Cloudflare Pages while the Cloud Build trigger **did not deploy the API at all** — fifteen minutes of polling `/api/v1/health` showed the same commit with uptime climbing unbroken, so no revision ever rolled out. The client had `documentSchema.thing_id` as `.nullable()`, which makes the **key required**, and `lib/api.ts` parses every document response with it — so a server that did not send the key failed the parse and took out the Now screen and the whole archive, not one field. Same mechanism as **D46**, from the other direction: there a stale *cache* lacked a new field, here a stale *server* did | **high** | **fixed (client), cause open** | Client fixed: `thing_id` is `.nullish().default(null)`, output type unchanged, with a test that absence parses and garbage still fails. **The rule is the general one: a response field added to the client must never be required of the server**, because the two halves deploy on separate triggers and nothing orders them. **Still open:** nobody knows why the API trigger did not fire, and there is no alarm for the skew — the new Build card on You makes it *visible* (it names the two commits and says when they disagree) but nothing detects it automatically. Add a version-skew check to `scripts/verify-deployment.mjs`, which already greps the shipped bundle for exactly this "configured wrong, looks fine" class |
| D55 | **`apps/web/src/lib/outbox.test.ts` is flaky — three tests, same three names, pass or fail run to run.** Observed across this session: 3 failures, 3 again, then 0, 0, 0, and one run with 6 where every extra was in the same file. Neither `outbox.test.ts` nor `outbox.ts` was modified while this was happening, and temporarily reverting the `thing_id` schema change does not reproduce it, so the contract was not the cause. **The damage is not the red — it is that a flaky file trains everyone to ignore it.** It was labelled "pre-existing on this branch's base" in several commits on the strength of a `git stash`, which removes uncommitted work and is *not* the same as checking out the base; the claim was weaker than it was stated to be, and a genuine regression in that file would have been waved through on the same reasoning | med | open | **Before trusting the suite about anything offline.** Run it 20× in isolation to fix the failure rate, then find the shared state — the likely candidates are the fake IndexedDB not being reset between cases and the replay's async settling racing the assertion. Until it is deterministic, **do not let anyone describe a failure in this file as expected**, which is the habit that makes a flaky test worse than a missing one |
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

### M1 — 2026-07-28

Written by the session that built M1, so **lens 2 and lens 4 here are worth less than usual**
([§5](#5-review-anti-patterns): reviewing your own work shows you intent rather than what is
there). The next session should redo them. What follows is what was actually verified, not a
judgement on whether the design was right.

**Verified green.** `pnpm typecheck lint build` pass. `pnpm test` is **136 passed, 0 skipped**
against a real Postgres — up from 40 at M0. The skip count was checked, per M0's finding.

**Verified beyond the test suite**, because three things were not testable in-process:

- **Against a real S3** (MinIO, via the new `R2_ENDPOINT` override). The presigned PUT is accepted;
  the same URL with a different `content-type` is rejected by *storage* with
  `SignatureDoesNotMatch`, and so is a body larger than the declared size. That is what makes rule
  11's limits real rather than numbers checked on values the client chose — and it confirmed two SDK
  defaults had to be overridden (`signableHeaders`, `requestChecksumCalculation`). Downloaded bytes
  were identical, with `Content-Disposition: attachment`.
- **Against a running server**, by curl: the identifier truncated to its last 4 (rule 6), tags
  lowercased, a retried `POST` with the same `Idempotency-Key` returning the same document and
  leaving exactly one row, a typo'd filter answering 400, a second account seeing nothing and
  getting 404 on the first account's document, and the file endpoints answering 503 rather than 500
  before R2 was configured.
- **In a real browser at phone width**: sign up, capture with a title alone, add an expiry and watch
  the 90/30/7 reminders appear, upload a file, see it counted on the dashboard, search for it.
  Screenshots reviewed.

**That browser pass is the only reason D33 was found.** `file_count` was 0 for every document
throughout M1's build; the API's own `?has_file=` filter was correct, so nothing was red and no test
failed. The dashboard showed "no file" next to a file it had just uploaded. Two lessons, both
registered: the Drizzle behaviour (D33) and the reason 136 tests missed it — **every assertion on
that field happened to expect zero**.

**Lens 1 found three places where the code and the spec disagreed**, all resolved by fixing whichever
was wrong and recorded rather than left:

- §5's `:presign-download` and `:dismiss` URL shapes were **unimplementable as written** (D32). The
  doc changed, because the router and the OpenAPI generator do not negotiate.
- §3 declared `document_files.sha256` `not null`. Built **nullable**: requiring it means the browser
  hashes the whole file before uploading, doubling the work on a phone, for a duplicate-detection
  feature §9(5) lists as an open question. Doc corrected.
- §10 gained two files the doc had not anticipated — `documents.files.service.ts` and
  `apps/web/public/push-sw.js` — and §10 now says why each exists.

Also corrected: ADR-0008's step-1 sketch shows a `filename` in the presign request, which business
rule 5 forbids and `document_files` has no column for. The domain doc is later and more specific, so
it wins; noted in `lib/storage.ts` where the key is built.

**Lens 4 is genuinely unanswerable yet, and saying otherwise would be the anti-pattern.** M1 was
finished minutes ago. Nobody's real passport is in it, no reminder has fired on a real phone, and
`ENABLE_SCHEDULED_JOBS` is still off — so the daily scan has never run unattended. The roadmap's
"done when" for M1 is explicitly a real document and a real notification, and that has not happened.
**The M1 review is therefore incomplete by design**: lens 4 must be redone after a week of real use,
and that is the next review's first job.