# Roadmap

Sequenced milestones. A session picking up work should find the first milestone that isn't
done and work on it. Each milestone is a coherent, shippable slice — not a phase of a
waterfall.

**Current position: M0 complete, deployed, and verified on the real domain.**

Everything in M0 is built and green, and on **2026-07-27** it was verified end to end over a
Cloudflare Tunnel serving `app.mevivek.dev` and `api.mevivek.dev` — 21/21 public checks, including
the cross-subdomain session cookie that `localhost` cannot exercise. The PWA installs. Google
sign-in ([ADR-0020](decisions/0020-google-oauth-alongside-password.md)) created a real account with
exactly one personal space.

**M0 is deployed as well as built.** `app.mevivek.dev` on Cloudflare Pages, `api.mevivek.dev` on
Cloud Run ([ADR-0021](decisions/0021-cloud-run-for-the-api.md)), Postgres on Neon. Nothing runs on
the maintainer's laptop. `node scripts/verify-deployment.mjs` re-checks all of it in 23 assertions.

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

**The two things that used to block M1 are done.** The M0 review has been run, and Q1 and Q2 have
been answered by the maintainer. **M1 is now the next action** — but read the three notes below
first, because the review changed what M1 has to do.

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

### 3. Then M1 — now unblocked



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
all of it in 23 checks — the `Secure; HttpOnly; SameSite=Lax` cookie with **no `Domain`**, the
cross-subdomain session, and that the API origin is actually baked into the shipped JavaScript.

## M1 — Documents, core + reminders

The first real domain. See [domains/documents.md](domains/documents.md) for the full spec.

- `documents`, `document_files`, `reminders` tables
- Full CRUD for documents; list with filters `?q=&type=&expiring_before=&tag=`
- File upload/download via API-minted presigned R2 URLs; file versioning
- Full-text search over title/issuer/notes/tags (`tsvector`)
- **Reminders**: pg-boss daily scan + Web Push delivery
- Web UI: document list, detail, create/edit, upload, expiring-soon view

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

## M2 — Documents, enrichment

- `documents.extract-text` pg-boss job: OCR uploaded PDFs/images into `document_text`
- Search index extended to cover extracted text
- Thumbnails/previews for the document list
- Offline read cache (app shell + last-seen list) per
  [ADR-0013](decisions/0013-read-only-offline-v1.md)

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

Assets and Money, using [agent-playbooks/add-a-domain.md](agent-playbooks/add-a-domain.md).
Each gets its own doc in [domains/](domains/) before implementation.

The real test here is whether the playbook works: adding a domain should be mechanical.
If it isn't, fix the playbook, not just the domain.

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
