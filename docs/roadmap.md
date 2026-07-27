# Roadmap

Sequenced milestones. A session picking up work should find the first milestone that isn't
done and work on it. Each milestone is a coherent, shippable slice — not a phase of a
waterfall.

**Current position: M0 not started.** Only documentation exists.

---

## M0 — Scaffold

Make the repo runnable end to end with one trivial vertical slice. No product features.

- pnpm workspace: `apps/web`, `apps/api`, `packages/shared`; Turborepo pipeline
- Biome, TypeScript strict, GitHub Actions CI (typecheck, lint, test, build)
- Fastify app with `/api/v1/health`, Zod type provider, OpenAPI served at
  `/api/v1/openapi.json`, pino logging, RFC 9457 error mapping
- Drizzle + drizzle-kit wired to a Neon branch; `users`, `spaces`, `space_members`
- Better Auth mounted: email + password signup/login; **personal space auto-created at
  signup**
- Vite React SPA that logs in, calls `/health`, and installs as a PWA
- Vitest running in both apps; one API integration test against real Postgres

**Done when:** you can sign up on your phone, and the API proves the session resolves to an
`ActorContext` with exactly one space.

**Update [CLAUDE.md](../CLAUDE.md) "Conventions" and "Status" sections as part of this
milestone** — they currently say no tooling exists.

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
- Every milestone that changes an invariant updates the relevant ADR or writes a new one.
- Pre-v1, the dev database may be reset rather than migrated
  ([ADR-0011](decisions/0011-pre-v1-schema-resets.md)). That freedom ends at M3, when real
  shared data exists.
