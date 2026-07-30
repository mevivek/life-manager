# Roadmap

Sequenced milestones. A session picking up work should find the first milestone that isn't
done and work on it. Each milestone is a coherent, shippable slice — not a phase of a
waterfall.

## Current position

**M1 built, DEPLOYED, fully provisioned, and one observation from done.**

**This heading is the single authoritative statement of what is deployed and provisioned.**
[README.md](../README.md), [architecture.md](architecture.md) §9 and `CLAUDE.md` all link here rather
than restating it — asserting it in five places is the mechanism that drifted at M0 and again at M1
(debt **D28**). If you change what is deployed, change it here.

R2, VAPID, the Neon rotation and now `CRON_SECRET` plus the Cloud Scheduler job are all provisioned; real
documents are in; and the daily scan has been called against production and reported
`found: 1, delivered: 0, undelivered: 1` — the mechanism working, with no push subscription to deliver to.

**What is left is not code.** Turn reminders on from the You screen, call the endpoint again, and see the
notification. Until one has actually been *seen*, M1's "done when" is unmet. Then lens 4 of the review
wants a week of real use. See §4.6–7 below.

Everything in M0 is built and green, and on **2026-07-27** it was verified end to end over a
Cloudflare Tunnel serving `app.mevivek.dev` and `api.mevivek.dev` — 21/21 public checks, including
the cross-subdomain session cookie that `localhost` cannot exercise. The PWA installs. Google
sign-in ([ADR-0020](decisions/0020-google-oauth-alongside-password.md)) created a real account with
exactly one personal space.

**M0 is deployed as well as built.** `app.mevivek.dev` on Cloudflare Pages, `api.mevivek.dev` on
Cloud Run ([ADR-0021](decisions/0021-cloud-run-for-the-api.md)), Postgres on Neon. Nothing runs on
the maintainer's laptop. `node scripts/verify-deployment.mjs` re-checks all of it — **42 checks** as of
2026-07-30, 42/42 against production.

**Three caveats, all real:**

- **CI is `cloudbuild.deploy.yaml`, not GitHub Actions.** Both halves now deploy on push (D22
  fixed), but Actions never runs on this account, so `.github/workflows/ci.yml` enforces nothing
  (debt D24) and editing the Cloud Build config needs a delete-and-recreate (debt D25).
- **`SIGTERM` graceful shutdown is still unverified** (debt D14). Windows does not deliver POSIX
  signals — but Cloud Run does, and `--min-instances=0` fires it several times a day, so this is
  now checkable from the logs with no deploy required. Nobody has looked.
- **A Pages build with `VITE_API_URL` unset ships a broken-but-healthy-looking site** (debt D23).
  It happened once. Run the verify script after every deploy; status codes cannot detect it.

---

## Next actions, in order — read this before starting anything

**M1 is built and deployed. It is still not done.** Every credential is bound and real documents are
in; steps 1–6 of §4 below are all closed. What is unmet is **§4.7 — nobody has seen a notification
arrive.** Turn reminders on from the You screen, call `/api/v1/maintenance:run-daily` again, and expect
`delivered: 1` with a notification on the phone. Then §4.8 wants a week of real use. That is the whole
next-actions list — not M2, and not more code.

### 1. ✅ The M0 review — done 2026-07-28

All four lenses, by a session that did not build M0. Findings and the full record of what was
checked are in [product/review.md](product/review.md) §6; new debt is **D27–D31**.

Worth carrying forward, because it changes how much you should trust things:

- **The invariants are in good shape.** All twelve hold, checked mechanically rather than by eye.
- **The database-backed tests were verified to actually execute** for the first time — 40/40 with a
  real Postgres, where the default environment silently skips 17 of them. Check the skip count.
- **Most of M0's drift was documentation, and it was one mechanism** (D28): deployment status is
  asserted in five files and the deploy work updated two. Expect this class of bug again.
- **D27 is the one that will bite M1 directly** — see note under M1 below.

### 2. ✅ Q1 and Q2 — answered 2026-07-28

Both **(a)**. Recorded with reasoning in
[product/open-questions.md](product/open-questions.md) §2 — read it there, not here.

- **Q1 → expiry-only reminders.** `reminders` needs no more than `due_on`; documents without an
  expiry are silent. Do not add a review-date column "while you're there".
- **Q2 → title only.** Everything else optional. **This is a constraint, not a permission:** M1 has
  to render, list and search half-empty documents gracefully rather than treating them as broken.

### 3. ✅ M1 built — 2026-07-28

The Documents domain, its files, its reminders and the web app. 136 tests, zero skipped, against a
real Postgres. Findings and what was actually verified are in
[product/review.md](product/review.md) §6; new debt is **D32–D36**.

**But M1 is not done, and the distinction matters.** The standing rule is that a milestone is done
when it works *on your phone* — and M1's own "done when" is a real passport, a real licence and a
real warranty in the system, with a real notification before one expires. None of that has happened.
What is true today is that it works locally, including a genuine upload to a real S3 and a full
browser pass at phone width.

### 4. What M1 still needs — in order

1. ✅ **Deployed** — 2026-07-28, commit `09d0ace`. Both halves live: `api.mevivek.dev` reports that
   version, `app.mevivek.dev` serves the documents routes with the API origin baked in. Verified on
   production by writing a document, reading back its three automatic reminders, searching for it,
   replaying an `Idempotency-Key`, and confirming a typo'd filter 400s. **This deploy needed
   [ADR-0023](decisions/0023-migrate-on-boot.md) first** — nothing was applying migrations, and it
   would have shipped an API reporting healthy with five missing tables.
2. ✅ **R2 provisioned — 2026-07-30.** Bucket `life-manager-documents`, an Object Read & Write token
   scoped to it, and the bucket CORS policy set — that last one has no error message when missing,
   because the browser PUTs straight to R2 and the failure never reaches our code.
3. ✅ **VAPID provisioned — 2026-07-30.** Generated with `scripts/generate-vapid-keys.mjs` and bound;
   `provision.ps1 preflight` reports all three set.
4. ✅ **Neon credential rotated — 2026-07-30.** Reset in the Neon console and rebound via
   `./scripts/provision.ps1 neon`, ahead of the first real document exactly as D18's trigger
   required. Revision `life-manager-api-00016-wgs` came up healthy on the new credential, which is
   also proof that migrate-on-boot reconnected.
5. ✅ **Real documents are in — 2026-07-30.** Uploads confirmed working from the maintainer's phone,
   after D42: the app's own CSP `connect-src` named the API but not R2, so every browser upload was
   blocked while every server-side check passed. Now leave it a week; that half is unchanged.
6. ✅ **The daily scan has a trigger — built 2026-07-30, [ADR-0028](decisions/0028-external-trigger-for-the-daily-scan.md).**
   `ENABLE_SCHEDULED_JOBS` stays **off permanently**, and that is now a decision rather than a
   deferral: a pg-boss schedule cannot fire on a scale-to-zero service, and forcing it to would cost
   an always-on instance *and* keep Neon awake (**D8**). Instead Cloud Scheduler POSTs
   `/api/v1/maintenance:run-daily`; the request wakes the API, the scan and the deliveries run inline,
   and everything sleeps again. D8 is **closed by avoidance**.

   **Provisioned and proven in production, same day.** `./scripts/provision.ps1 cron` bound
   `CRON_SECRET` and created the Cloud Scheduler job `life-manager-daily-scan` (`ENABLED`, `0 8 * * *`,
   `Etc/UTC`, first fire `2026-07-31T08:00:00Z`). A real call against production returned:

       { "status": "ran", "today": "2026-07-30", "found": 1, "delivered": 0,
         "undelivered": 1, "errored": 0, "swept": 0, "duration_ms": 579 }

   Every layer is therefore exercised against the real thing: the secret, the constant-time compare,
   the content-type parser, the advisory lock, the scan, and the counts coming back.

   **It took four bugs to get there, three of them found by the maintainer running it** — see debt
   **D53**, because the pattern matters more than the individual fixes. In order: `--headers` passed to
   gcloud's `update` verb which does not accept it (and it failed *between* two writes, leaving the API
   on the new secret while the job held the old one); gcloud echoing the secret in its own success
   output; a verify instruction pointing at `logs read`, which renders `textPayload` while this API logs
   JSON; and a **415** on any bodyless POST declaring `application/octet-stream` — which is what Cloud
   Scheduler sends, so the daily run would have failed in production.

7. **Turn reminders on, and SEE the notification.** `undelivered: 1` with `errored: 0` above means the
   scan found a due reminder and had nowhere to send it: no live push subscription in the space. Switch
   reminders on from the **You** screen on the phone, then call the endpoint again and expect
   `delivered: 1`.

   Nothing has been lost in the meantime — `sent_at` is written only after a successful send, so that
   reminder is still pending and either a manual call or the 08:00 UTC run will pick it up.

   **Until a notification has actually been seen, M1 is not done.** The counts above are the mechanism
   working, which is not the same claim.

8. **Redo lens 4 of the M1 review** once there is a week of real use. The M1 review is explicitly
   incomplete without it.

> **Litter to clear — now TWO accounts, and the count only grows.** Each verification run creates a
> throwaway account, and every run so far has been from an agent container with no database credential
> to clean up with, so each one leaves its account behind:
> `deploy-check-1785260209@example.test` and `deploy-check-1785410330291@example.test`.
>
> `node scripts/verify-deployment.mjs` removes every `deploy-check-%@example.test` user as its last
> step **only when it can reach the database** — so running it again from a container adds a third
> rather than clearing the first two. Clear them by running it once with `DATABASE_URL_UNPOOLED` set
> (or from `apps/api/.env`), or by hand. Not urgent, but it is real rows in a real database and the
> pattern is self-accumulating.
>
> **Not verified: the deployed app in a browser.** The container's egress proxy relays `CONNECT`
> only, and Chromium's requests are reset, so production was checked over HTTP rather than driven.
> The UI itself was driven in a browser locally against the identical bundle. M1's "done when" is
> your phone anyway — step 5 covers it.

### 4b. The offline read cache landed early — 2026-07-29

**Out of order, by an explicit product decision.** M2's offline read cache was built before steps
2–7 above, because the maintainer asked to be able to iterate on the app without first provisioning
R2 and VAPID. Recording the reasoning because the order above otherwise looks violated:

- It unblocks *product* iteration without touching the credential steps at all, which are the ones
  that need a human at a dashboard.
- It needed no new decision — [ADR-0013](decisions/0013-read-only-offline-v1.md) already specified
  the design in detail, down to requiring a visible staleness marker.
- It is web-only and additive; nothing in steps 2–7 changes because of it.

Two things it deliberately did **not** do, both because ADR-0013 rules them out: no `runtimeCaching`
for the API in the service worker (the Query cache is the one cache), and no offline caching of file
bytes. Also shipped alongside: `docker-compose.dev.yml`, a local S3 mock so the upload path runs with
no Cloudflare account — but it does not validate signatures, so it cannot verify the presign
contract (debt D39).

**Steps 2–7 are unchanged and still the priority.** This did not make M1 done.

### 4c. The Things UI landed early too — 2026-07-30

The fourth design handoff specified a whole second domain, so its **client half** was built from the
comp: two screens, the cover ladder, a capture track, a cross-domain horizon and the
document↔thing link. [ADR-0029](decisions/0029-the-things-domain.md),
[ADR-0030](decisions/0030-capture-as-a-stepped-wizard.md),
[domains/things.md](domains/things.md).

**The Things API followed on the same day** — see M4 step 1 below, which is now done. The contract in
`packages/shared/src/things.ts` was written first precisely so the server half would implement it
rather than invent a second shape, and it did: not a line of that file changed.

**This did not make M1 done either**, and it did not change the priority: steps 2–7 above still come
first. What it did change is that the handoff also **rewrote capture** for both domains
(ADR-0030), so the Documents flow the maintainer is about to use a week of is the new stepped one
rather than the single page. Worth knowing before reading §4.7's "leave it a week".

### 5. Then M2

Only after step 7. M2's remaining scope is OCR and previews — the offline read cache is done, see
§4b. Starting the rest before M1 has a week of real use would repeat the mistake the working
agreements name first: "one domain at a time — finish and actually use it before starting the next"
([product/brain.md](product/brain.md) §5).

**That agreement is under strain and it is worth saying so plainly.** Things is a second domain
finished — both halves — before the first is done. The mitigation that used to be recorded here was
that only the client half existed; that mitigation is gone. **M1's last observation is still
outstanding**, and a session tempted to keep going on Things (the offline outbox, §9(2)) instead of
turning reminders on from the You screen and watching one arrive should read §5 of the brain again
first.

---

## M0 — Scaffold

Make the repo runnable end to end with one trivial vertical slice. No product features.

- [x] pnpm workspace: `apps/web`, `apps/api`, `packages/shared`; Turborepo pipeline
- [x] Biome, TypeScript strict, CI (typecheck, lint, test, build) — **via Cloud Build, not GitHub
      Actions.** The workflow file was written and committed and has never executed once; debt D24.
      Do not read this checkbox as "Actions works"
- [x] Fastify app with `/api/v1/health`, Zod type provider, OpenAPI served at
      `/api/v1/openapi.json`, pino logging, RFC 9457 error mapping
- [x] Drizzle + drizzle-kit; `users`, `spaces`, `space_members` (+ `sessions`, `accounts`,
      `verifications`), one committed migration
- [x] Better Auth mounted: email + password signup/login; **personal space auto-created at
      signup** — see the amended [ADR-0006](decisions/0006-space-based-ownership.md) for the
      mechanism, which is a database constraint plus idempotent retry, not one transaction
- [x] Vite React SPA that signs up, signs in, calls `/health` and `/me`, and builds a service
      worker + manifest
- [x] Vitest in all three packages; 40 tests, including API integration tests against real
      Postgres ([ADR-0018](decisions/0018-testcontainers-for-api-tests.md))
- [x] pg-boss lifecycle wired, zero handlers registered
- [x] `CLAUDE.md` Status, Conventions, Layout and Stack updated

**Deployment, all done 2026-07-27:**

- [x] `apps/api/.env` filled; schema applied to the Neon dev branch
- [x] API on **Cloud Run** — not Fly; see [ADR-0021](decisions/0021-cloud-run-for-the-api.md)
- [x] Cloudflare Pages project connected to GitHub, `VITE_API_URL` set, `app.mevivek.dev` attached
- [x] DNS: `api` → Cloud Run domain mapping, `app` → Pages
- [x] Google sign-in ([ADR-0020](decisions/0020-google-oauth-alongside-password.md))
- [x] **The phone check below**

**Done when:** you can sign up on your phone, and the API proves the session resolves to an
`ActorContext` with exactly one space. Concretely: sign up at `https://app.mevivek.dev`, land on
the home route showing your email and exactly one space (`personal` / `owner`), add it to the home
screen, open it standalone, and **still be logged in** — that last part is the
[ADR-0019](decisions/0019-same-site-subdomain-deployment.md) cookie path and the most likely thing
to fail. Then sign up a second account and confirm it gets its own separate space and cannot see
the first.

**Verified on the deployed app**, not just locally: `node scripts/verify-deployment.mjs` asserts
all of it in **42** checks — the `Secure; HttpOnly; SameSite=Lax` cookie with **no `Domain`**, the
cross-subdomain session, that the API origin is actually baked into the shipped JavaScript, and
that every asset and lazy route chunk the app names is really served rather than answered by the
SPA fallback.

## M1 — Documents, core + reminders

The first real domain. See [domains/documents.md](domains/documents.md) for the full spec.

- [x] `documents`, `document_files`, `reminders` tables — plus `push_subscriptions` and
      `idempotency_keys`, neither of which this list anticipated
- [x] Full CRUD for documents; list with filters `?q=&type=&expiring_before=&tag=&has_file=`
- [x] File upload/download via API-minted presigned R2 URLs; file versioning
- [x] Full-text search over title/issuer/notes/tags (`tsvector`)
- [x] **Reminders**: pg-boss scan + deliver + sweep, and Web Push delivery.
      **The schedule is registered but switched off** (`ENABLE_SCHEDULED_JOBS`), so the scan has
      never run unattended — see next actions
- [x] Web UI: dashboard, document list, detail, create/edit, upload, expiring-soon

**Reminders ship in M1, not later.** [prior-art.md](prior-art.md) §3 found an entire product
category that does nothing but expiry tracking — storage without reminders is the commodity
half of the feature. Per **Q1**, expiry-only: `due_on` and nothing more.

**Four registered debts come due in M1, and three of them land on the same endpoint.** Read their
triggers in [product/review.md](product/review.md) §3 before writing `GET /documents`, not after:

| Debt | What M1 must do about it |
|---|---|
| **D27** | `?q=&type=&expiring_before=&tag=` is the first querystring in the codebase, and unknown query parameters are **not** currently rejected despite [api.md](conventions/api.md) §7 saying they are. A typo'd `?expiring_befor=` silently returns the *unfiltered* list. Make the querystring schema strict and test it |
| **D10** | The cursor primitives in `packages/shared` have never been used by an endpoint. This list is where the shape gets proven, or found wrong |
| **D9** | `Idempotency-Key` is documented and unimplemented. `POST /documents` is the first mutation, and a retried upload creating two documents is exactly what it exists to prevent |
| **D18** | The exposed Neon dev credential must be rotated **before the first real document is stored** — which is M1's "done when" |

**Done when:** your real passport, driving licence, and a warranty are in the system, and
your phone notifies you before one expires.

> **Still not met — but only just.** Everything above is built, deployed and fully provisioned, and
> the database holds real documents. The **one** thing outstanding is that no notification has been
> *seen* on a phone: the scan has been called against production and reported
> `found: 1, delivered: 0, undelivered: 1`, which is the mechanism working with nowhere to deliver to.
> Switch reminders on from the **You** screen, call the endpoint again, and watch for `delivered: 1`.
> Nothing is missing but that observation — see § Next actions step 4.7.

## M2 — Documents, enrichment

- `documents.extract-text` pg-boss job: OCR uploaded PDFs/images into `document_text`
- Search index extended to cover extracted text
- Thumbnails/previews for the document list
- [x] Offline read cache (app shell + last-seen list) per
  [ADR-0013](decisions/0013-read-only-offline-v1.md) — **done 2026-07-29, out of order and on
  purpose: see §4b.** Offline *writes* followed as an outbox
  ([ADR-0024](decisions/0024-offline-writes-outbox.md), superseding 0013's no-writes half), so this
  line is the only part of M2 that is closed. What is still missing is offline access to **file
  bytes**, which ADR-0013 rules out deliberately

Only possible because documents are Tier 0 — see
[ADR-0009](decisions/0009-sensitivity-tiers.md).

## M3 — Family sharing

The payoff for [ADR-0006](decisions/0006-space-based-ownership.md). Should require **no
schema migration and no repository changes**.

- Invite flow: invite by email, accept, join a space
- Space switcher in the web UI; roles (`owner`, `member`) enforced server-side
- Audit log of writes within shared spaces
- **Enable Postgres RLS** as defense-in-depth before anyone else's data is in the system

If this milestone turns out to require rewriting queries, ADR-0006 failed and should be
amended with what was missed.

## M4 — Second and third domains

**Assets arrived early, as "Things", and it is now complete.** The fourth design handoff
specified the domain in full, so the client half was built against it ahead of schedule —
[ADR-0029](decisions/0029-the-things-domain.md), [domains/things.md](domains/things.md) —
and the server half followed on 2026-07-30.

So M4 is now, in order:

1. - [x] **The Things API**, to the spec in [domains/things.md](domains/things.md) §3–§6,
     using [agent-playbooks/add-a-domain.md](agent-playbooks/add-a-domain.md). **Done
     2026-07-30.** `things`, `thing_services`, `thing_photos`, the repository, two services,
     every endpoint in §5, and the `on delete set null` foreign key on `documents.thing_id`.
     `packages/shared/src/things.ts` was implemented **unchanged** (invariant 9). 71 new
     tests; suite 674/0. things.md §10 lists the files.
2. **Answer [Q7](product/open-questions.md)** — whether a warranty or a service date gets automatic
   reminders (things.md §9(2)) — before coding it. Documents only
   auto-remind for `identity` and `certificate`, and the equivalent call here has **still not
   been made**, so step 1 deliberately built the capability and left the switch off: nothing
   creates a thing reminder, and `GET /things/:id` returns an empty `reminders[]` with a test
   asserting exactly that. **Answering it is not only a `AUTO_REMINDER_TYPES`-shaped edit** —
   the daily scan's copy is document-shaped and would announce that a warranty "expires",
   which is the sentence ADR-0029 exists to prevent. Debt D58.
3. **The one client gap step 1 left**, named in things.md §10 item 2: Things writes do not go
   through the offline outbox — one entry kind plus one `writeOrQueue` per mutation. The
   photo client is **not** part of this any more: `api.things.photos` carries all five verbs
   and `ThingPhotos.tsx` draws the hero and the strip, so debt **D59** is closed for reads and
   writes and only its offline half survives, inside this same outbox work. (It landed with its
   URLs written `photos::presign-upload` — the `::` is Fastify's *registration* escape and never
   reaches a URL, so every photo verb 404'd until the paths were corrected to one colon. Fixed;
   recorded because the doc it was copied from said `::` too.)
4. **Money**, with its own doc first.

The real test here was whether the playbook works: adding a domain should be mechanical.
**Step 1 was the first measurement of ADR-0006's central promise** — that a second domain
needs no change to the tenant filter — and **it held: `apps/api/src/db/scoped.ts` was not
touched.** `spaceScoped()` gives a new table the two columns `SpaceScopedTable`
structurally requires, so `scoped(actor, things)` type-checked on first use. The playbook
itself needed **five amendments plus two smaller ones**, each recorded with the bug that
motivated it in its own § *If this playbook didn't work*. Two of the five were live defects
the tests caught: a cross-space count leak, and a 500 on the second photo of any thing.

Also candidates once two domains exist: email-inbox ingestion and AI-extracted expiry
dates (both from [prior-art.md](prior-art.md) §2).

## M5 — Vault

The end-to-end encrypted secrets domain. Design is already fixed in
[security-model.md](security-model.md) §5 and
[ADR-0010](decisions/0010-vault-key-hierarchy.md) — building it should not require new
cryptographic decisions.

- Vault setup: passphrase → Argon2id KEK, X25519 keypair, **one-time recovery code**
- `vault_items` with per-item DEKs wrapped under the Space Key
- Client-side unlock, in-memory decryption, auto-lock on idle
- Client-side search over decrypted items
- Shared vaults: wrap the Space Key to another member's public key

**Hard prerequisites, do not skip:** passkeys or 2FA on the account
([security-model.md](security-model.md) §7), and a tested backup/restore path. An
unrecoverable vault behind a password-only login is a liability, not a feature.

## Beyond

People, Notes, and cross-domain linking — the actual thesis of the project
([prior-art.md](prior-art.md), final section): *what does this warranty cover, what did it
cost, who sold it to me, and when does it expire?* No single-domain tool answers that.

Not scheduled. Revisit once M1–M4 have proven the domain pattern holds.

---

## Standing rules

- A milestone is done when it works **on your phone**, not when the tests pass.
- **Every milestone ends with a review** — all four lenses in
  [product/review.md](product/review.md), findings written to the debt register. This is a
  deliverable, not a nicety: nothing else forces it, it ships no feature, and it is the only
  thing that catches drift in a codebase edited by sessions with no shared memory.
- **Re-plan deliberately after each review** ([product/brain.md](product/brain.md) §10).
  The plan below will be wrong; changing it is expected, changing it *silently* is not.
- Every milestone that changes an invariant updates the relevant ADR or writes a new one.
- Pre-v1, the dev database may be reset rather than migrated
  ([ADR-0011](decisions/0011-pre-v1-schema-resets.md)). That freedom ends at M3, when real
  shared data exists.
