# Architecture decisions

One line per ADR, so you can find the right one without opening seventeen files.

**How ADRs work here:** each records one decision, its context, its **rejected
alternatives**, and its consequences. The rejected-alternatives section is the load-bearing
part — it is what stops a future session re-proposing an option that was already ruled out
for a reason that still holds.

ADRs are **superseded, never edited in place.** If a decision changes, write a new ADR and
mark the old one superseded. Rationale: [ADR-0015](0015-docs-as-orientation.md).

The one narrow exception: **clarifying or widening the scope of a decision that has not been
acted on yet**, where the decision itself is unchanged. Record it as an `Amended:` line
stating what changed and why it wasn't superseded — see
[ADR-0017](0017-product-brain.md). If the original conclusion would change, that is a
supersession, not an amendment.

Template: [0000-adr-template.md](0000-adr-template.md).

---

## Index

| # | Decision | Status | In one line |
|---|---|---|---|
| [0001](0001-typescript-monorepo.md) | TypeScript monorepo | accepted | One language, pnpm workspaces + Turborepo; shared Zod contract is the reason |
| [0002](0002-api-first-decoupling.md) | API-first decoupling | accepted — amended 2026-07-30 | Every client is a plain HTTP consumer; only `apps/api` touches the database, with one named exemption for the deploy verifier's cleanup |
| [0003](0003-vite-spa-pwa-over-nextjs.md) | Vite SPA, not Next.js | accepted | SSR is unusable under ADR-0002 and tempts sessions to break it |
| [0004](0004-zod-single-contract-source.md) | Zod as the single contract | accepted | One schema → validation + types + OpenAPI + form validation |
| [0005](0005-postgres-neon-drizzle.md) | Postgres on Neon, Drizzle | accepted | JSONB, full-text, transactions; branching makes resets free |
| [0006](0006-space-based-ownership.md) | Space-based ownership | accepted, **amended** | Records belong to spaces, not users — family sharing is near-term |
| [0007](0007-better-auth-self-hosted.md) | Better Auth, self-hosted | accepted | Users in our own Postgres; passkeys and vault key material need it |
| [0008](0008-object-storage-r2.md) | Cloudflare R2, presigned URLs | accepted | Zero egress; the API chooses object keys, bytes never transit it |
| [0009](0009-sensitivity-tiers.md) | Sensitivity tiers | accepted | No app-level encryption for ordinary data; that's what keeps OCR and search possible |
| [0010](0010-vault-key-hierarchy.md) | Vault key hierarchy | accepted | Argon2id → keypair → space key → per-item DEK, plus a recovery code |
| [0011](0011-pre-v1-schema-resets.md) | Pre-v1 schema resets | accepted | Reset the dev database rather than migrate it — **until M3** |
| [0012](0012-pg-boss-background-jobs.md) | pg-boss for jobs | accepted | Queue on the existing Postgres; jobs enqueue transactionally. No Redis |
| [0013](0013-read-only-offline-v1.md) | Read-only offline in v1 | **superseded by 0024** | Cache reads; writes need connectivity. The read half is built and still stands; the no-writes half is superseded |
| [0014](0014-hosting-topology.md) | Hosting topology | **superseded by 0021** | Cloudflare Pages + Fly.io + Neon + R2; free except a few dollars for the API |
| [0015](0015-docs-as-orientation.md) | Docs as orientation | accepted | Documentation is a routing system for sessions with no memory |
| [0016](0016-testing-and-tooling.md) | Testing and tooling | accepted | Vitest against real Postgres, Playwright, Biome; a cross-space test per endpoint |
| [0017](0017-product-brain.md) | Project brain | accepted | Living doc driving product + technical direction, review, and re-planning; AI proposes, human decides scope |
| [0018](0018-testcontainers-for-api-tests.md) | Testcontainers for API tests | accepted | Throwaway Postgres per run; `TEST_DATABASE_URL` overrides it; skips (not fails) with neither, except in CI |
| [0019](0019-same-site-subdomain-deployment.md) | One domain, two subdomains | accepted, **amended** | `app.` + `api.mevivek.dev` are same-site, so `SameSite=Lax` survives two hosting providers |
| [0020](0020-google-oauth-alongside-password.md) | Google sign-in | accepted | Google OAuth **alongside** email+password, with google as a trusted linking provider |
| [0021](0021-cloud-run-for-the-api.md) | Cloud Run for the API | accepted | Supersedes 0014's Fly choice; --min-instances=0 is what keeps it free |
| [0022](0022-web-push-library.md) | Web Push library | accepted | `webpush-webcrypto` (MIT), because `web-push` is MPL-2.0 and hand-rolling RFC 8291 is forbidden |
| [0023](0023-migrate-on-boot.md) | Migrations applied on API boot | accepted | Nothing else applied them once ADR-0021 dropped Fly's release_command; the fix has to ship in the image because of D25 |
| [0024](0024-offline-writes-outbox.md) | Offline writes via an outbox | accepted | Supersedes 0013's no-writes half. Server `version` precondition, stale write → **409**, IndexedDB outbox replayed on reconnect, conflicts SURFACED never merged |
| [0025](0025-ledger-design-system.md) | The Ledger design system | accepted — **§4's three-tab rule superseded by 0031** | Warm paper, serif + grotesk, colour spent only on status; five-state expiry ladder readable in greyscale. Everything except §4 stands. §4's tab NAMES were amended by 0026's handoff (Add left the bar, You took the slot); its *"three tabs, forever, domains are a switcher"* rule is **reversed by 0031** |
| [0026](0026-store-the-full-identifier.md) | Store the full document identifier, unencrypted | accepted — **detail-only rule superseded by 0027** | **Reverses business rule 6.** Full value in `identifier`, mask DERIVED into `identifier_last4`, detail response only. Plaintext — amends 0009's data-minimisation half, not its encryption half (invariant 7 stands) |
| [0027](0027-identifier-in-the-list-response.md) | The full identifier is returned in the list response | accepted | **Supersedes 0026's detail-only rule.** `identifier` on `documentSchema`, so the archive shows and copies a number with no detail round-trip. Cost accepted and named: the persisted cache holds every number on the device (**D47**) |
| [0028](0028-external-trigger-for-the-daily-scan.md) | An external scheduler triggers the daily scan over HTTP | accepted | **Amends 0012: pg-boss keeps the queue, loses the clock.** A pg-boss cron cannot fire on a scale-to-zero service, so `POST /maintenance:run-daily` does the scan inline, authenticated by a constant-time-compared `X-Cron-Key` and serialised by an advisory lock. Avoids **D8** rather than accepting it |
| [0029](0029-the-things-domain.md) | The Things domain — and cover is not expiry | accepted — **navigation decision superseded by 0031** | The second domain, pulled forward from M4. **Cover gets its own four-state ladder** (a depleting bar, 60-day boundary) because a lapsed warranty is not an invalid document. Ownership is `here`/`lent`/`gone`, never a delete. One nullable `thing_id` links the two domains. The domain, the ladder and the link stand; only its *"switcher, not a fourth tab"* paragraph is reversed by **0031** |
| [0030](0030-capture-as-a-stepped-wizard.md) | Capture is a stepped wizard, two tracks | accepted | Replaces the single-page form: `type→whose→title→number→dates→scan` for a document, `kind→name→detail→purchase→warranty→photo` for a thing. **Q2 is unchanged** — one required field per track, and every other step draws *Skip for now* |
| [0031](0031-things-is-a-fourth-tab.md) | Things is a fourth tab | accepted | **Reverses 0025 §4's "three tabs, forever" and 0029's switcher.** The bar is `Now · Documents · Things · You`; `DomainSwitcher` is deleted. Evidence, per 0029's own reopening condition: the maintainer used the shipped app and did not find the domain. Explicitly makes **no** "four tabs, forever" claim — the trigger for the fifth is a 390px measurement, and the switcher *pattern* returns inside a tab when the bar is full |

**Amendments** (see the rule above): [0006](0006-space-based-ownership.md) 2026-07-27 — the
personal-space guarantee restated in terms of what is actually enforced, because Better Auth cannot
create it in the same transaction as the user. Decision unchanged; only the mechanism was
misstated. [0017](0017-product-brain.md) 2026-07-27 — charter widened from product-only to
product and technical thinking. [0019](0019-same-site-subdomain-deployment.md) 2026-07-27 —
`COOKIE_DOMAIN`/`crossSubDomainCookies` turned out **not** to be required and are now unset;
found by actually running the design over a tunnel. Two subdomains confirmed correct.
[0014](0014-hosting-topology.md) 2026-07-27 — the always-on requirement disappeared with the
cron, so the host choice is open again and Fly is no longer mandatory.

---

## By topic

**Deciding how to build something**
0001 language · 0003 web client · 0004 contract · 0005 database · 0012 jobs · 0016 tests ·
0018 test database

**Touching auth, ownership, or crypto** — read [security-model.md](../security-model.md)
first
0002 boundaries · 0006 ownership · 0007 auth · 0009 tiers · 0010 vault keys ·
0019 cookies and same-site · 0020 Google sign-in and account linking

**Changing the schema**
0005 Drizzle · 0006 `space_id` on everything · 0011 reset-don't-migrate

**Files and storage**
0008 R2 and presigned URLs · 0009 not encrypted

**Deployment and cost**
0021 Cloud Run (API) · 0014 original topology, superseded · 0019 domains and cookies ·
0005 Neon · 0008 R2

**Deciding what to build, reviewing it, changing the plan**
0017 project brain · 0015 documentation structure

**Notifications and background work**
0022 Web Push library · 0012 pg-boss

**Adding a screen, or touching how anything looks**
0025 the Ledger design system — tokens, the expiry ladder (its §4 tab rule is superseded) · 0031 the
tab bar as it is now: four tabs, and how to tell when it is full · 0003 SPA shell · 0024 what a write
does with no network, and what the cache holds · 0026 why a passport number is stored in full and why
it is not encrypted · 0029 the second status ladder · 0030 why capture has steps

**Working on Things, or on anything a household owns**
0029 the domain, cover-is-not-expiry, ownership states, the document↔thing link · 0030 the thing
capture track · 0025 the ladder cover deliberately does not reuse

---

## Writing a new ADR

1. Copy [0000-adr-template.md](0000-adr-template.md) to `NNNN-short-kebab-title.md`.
2. Fill in every section. **Spend the effort on "Alternatives considered"** — it is the
   section a future session will actually need.
3. Add a row above, and a topic entry if it fits one.
4. If it replaces an existing decision, set `Superseded by` on the old ADR and `Supersedes`
   on the new one. Do not delete or rewrite the old one.

Write an ADR when a choice constrains future work, would be expensive to reverse, or has a
plausible alternative someone will suggest again. Not for routine implementation choices —
those belong in [conventions/](../conventions/).
