# Roadmap

Sequenced milestones. A session picking up work should find the first milestone that isn't
done and work on it. Each milestone is a coherent, shippable slice — not a phase of a
waterfall.

**Current position: M0 code complete; deployment not done.** Everything below is built, and
`typecheck`, `lint`, `test` and `build` are green — but the app has never run anywhere except
`localhost`. **M0 is not signed off until the phone check in the M0 section passes.**

Next action is the maintainer's, not a session's: fill `apps/api/.env`, create the Fly app and
the Cloudflare Pages project, and add the two DNS records
([ADR-0019](decisions/0019-same-site-subdomain-deployment.md)).

---

## M0 — Scaffold

Make the repo runnable end to end with one trivial vertical slice. No product features.

- [x] pnpm workspace: `apps/web`, `apps/api`, `packages/shared`; Turborepo pipeline
- [x] Biome, TypeScript strict, GitHub Actions CI (typecheck, lint, test, build)
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

**Still outstanding — all of it needs the maintainer, none of it needs a session:**

- [ ] `apps/api/.env` filled in (Neon connection strings + `BETTER_AUTH_SECRET`)
- [ ] Fly app created, secrets set, `fly certs add api.mevivek.dev`, deployed
- [ ] Cloudflare Pages project created, `VITE_API_URL` set, `app.mevivek.dev` attached
- [ ] Two DNS records
- [ ] **The phone check below**

**Done when:** you can sign up on your phone, and the API proves the session resolves to an
`ActorContext` with exactly one space. Concretely: sign up at `https://app.mevivek.dev`, land on
the home route showing your email and exactly one space (`personal` / `owner`), add it to the home
screen, open it standalone, and **still be logged in** — that last part is the
[ADR-0019](decisions/0019-same-site-subdomain-deployment.md) cookie path and the most likely thing
to fail. Then sign up a second account and confirm it gets its own separate space and cannot see
the first.

**Verified locally instead, for the record:** signup over real HTTP returns a
`HttpOnly; SameSite=Lax` cookie, and `GET /api/v1/me` returns exactly one personal space owned by
the new user.

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
half of the feature.

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
