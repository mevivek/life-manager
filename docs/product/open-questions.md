# Open questions

Product questions that genuinely need a human answer, plus the answers already given.

**How this file works** ([ADR-0017](../decisions/0017-product-brain.md) rule 4): a session
that hits a product question it cannot answer **writes it here and continues with the rest
of the work.** Do not stall, and do not invent an answer and build on it silently. If you
must proceed, state the assumption in the entry so a later session can see what was
assumed and correct it.

Only questions where **different answers lead to different work** belong here. Routine
judgment calls get made and noted, not queued.

Answered questions move to §2 and stay forever — they are the record of *why*.

---

## 1. Open

### Q1 — Should documents without an expiry date be nagged about at all?

**Why it matters:** Reminders are the core value (principle 1), but most documents — a
deed, a birth certificate, an old contract — never expire. If the reminder system only
handles expiries, it is silent for the majority of the archive.

**Options:** (a) expiry-only, silent otherwise; (b) periodic review nudges — *"you haven't
looked at this in two years, is it still current?"*; (c) user-set arbitrary review dates
per document.

**Leaning:** (a) for M1, since it is the proven pattern
([prior-art.md](../prior-art.md) §3), with (c) as a small addition if (a) feels thin in use.
(b) risks becoming noise, and a notification people learn to ignore is worse than none.

**Blocks:** the shape of the `reminders` table beyond `due_on`. Answer before M1 finishes.

### Q2 — How much metadata is required at capture time?

**Why it matters:** Direct tension between principle 2 (effortless capture) and the app
being useful — a document with no type and no expiry is a file in a folder, which is the
thing this app is supposed to beat.

**Options:** (a) title only, everything else optional and backfilled later; (b) title +
type required; (c) type-specific required fields.

**Leaning:** (a). Capture friction is the bigger risk, and OCR (M2) can backfill. But it
means M1 must handle half-empty documents gracefully rather than treating them as broken.

**Blocks:** the create form and Zod schema in M1.

### Q3 — When family sharing lands, is sharing per-space or per-document?

**Why it matters:** [ADR-0006](../decisions/0006-space-based-ownership.md) makes *space*
sharing nearly free. Per-document sharing is a genuinely different model and would need
design. Real households have both: shared household documents and a spouse's private
passport.

**Options:** (a) space-only — a shared space plus separate personal spaces, move documents
between them; (b) space-level with per-document exceptions; (c) per-document ACLs.

**Leaning:** (a). It is what the architecture already supports, and moving a document
between spaces is a comprehensible mental model. (c) is a permissions system, which is a
project.

**Blocks:** M3 design. Not urgent, but answering early prevents building toward the wrong
one.

### Q4 — What is the actual retention and deletion policy?

**Why it matters:** Soft deletes never purge
([conventions/data.md](../conventions/data.md) §3) and deleting a document deliberately
leaves its R2 object ([ADR-0008](../decisions/0008-object-storage-r2.md)). That is
recoverable-by-design, but it means "delete" does not delete — which is arguably dishonest
under principle 5, and matters more once another person's data is involved.

**Options:** (a) soft delete forever, no purge; (b) a trash view with purge after N days;
(c) immediate hard delete on explicit confirmation.

**Leaning:** (b) — a visible trash with a 30-day purge job. Honest, recoverable, and the
pattern users already expect.

**Blocks:** nothing immediately, but it should not still be open at M3.

### Q5 — Is a native Android client actually wanted, or is the PWA enough?

**Why it matters:** [ADR-0002](../decisions/0002-api-first-decoupling.md) pays a real
upfront cost specifically to make native clients plug-and-play. That cost is justified if a
native client is genuinely coming; if the PWA is sufficient forever, some of that
decoupling ceremony was insurance against nothing.

**Note:** the decoupling is worth keeping regardless — it also enforces the clean API
boundary. But the answer changes how much effort goes into PWA polish (camera, share
target, widgets) versus waiting for native.

**Leaning:** PWA-first and see. Revisit once the app is in daily use.

**Blocks:** nothing yet. Worth answering before M2's PWA work.

### Q6 — Should `ActorContext.role` be a scalar or per-space?

**Why it matters:** [security-model.md](../security-model.md) §3 defines
`ActorContext.role: 'owner' | 'member'` as "role in the space being acted upon", while `spaceIds`
on the same type is an array. Those cannot both be true once a user belongs to two spaces, which is
exactly what M3 introduces. This is a **technical** question, which
[ADR-0017](../decisions/0017-product-brain.md)'s amended charter puts in scope for this file.

**Assumption M0 shipped on, stated so it can be corrected:** every user has exactly one space, so
`role` is populated from that single membership. Where it is set —
`apps/api/src/auth/actor.hook.ts` — carries a comment pointing here, and the type itself documents
the ambiguity.

**Options:** (a) `memberships: ReadonlyArray<{ spaceId, role }>` on `ActorContext`, with the role
resolved per target space in the service layer; (b) keep the scalar and resolve the target space
earlier, in the route; (c) drop `role` from `ActorContext` entirely and have services look up the
membership they need.

**Leaning:** (a). It makes the type honest and keeps role resolution in one place. It edits
`security-model.md` §3, which is a doc a session is told to read *in full* before touching auth —
so changing it is a human decision, not a refactor.

**Blocks:** M3's role enforcement. Nothing before that, because there is no second space and no
role check yet. Answer during M3 planning, not sooner.

---

## 2. Answered

Decisions already made. Kept permanently.

### Google sign-in added, but email+password kept

**Answered:** 2026-07-27

Google OAuth is enabled alongside email+password, with account linking and `google` as a trusted
provider, so both routes reach one account.

**Reasoning:** Google-only would be simpler and would eliminate debt D11 (no password reset)
outright rather than merely softening it. Rejected because it makes a single Google account the
only way into a system whose long-term goal is a password vault — a locked Google account would
mean losing everything, and that recovery path is not one this project controls.

**Also settled:** Google identity is **not** used for the vault. Vault access derives from a
passphrase the server never sees; tying it to an OAuth session would mean the server could unlock
it, which is not E2EE. Signing in and unlocking the vault stay separate acts.

→ [ADR-0020](../decisions/0020-google-oauth-alongside-password.md),
[review.md](review.md) D3 and D11

### Scheduled jobs stay off during development

**Answered:** 2026-07-27

The daily `reminders.scan` cron is **not** scheduled in development. When M1 adds it,
`createQueue` and `work` are unconditional but `schedule` is gated behind
`ENABLE_SCHEDULED_JOBS` — so the handler stays testable and manually triggerable
(`boss.send('reminders.scan', {})`), and only the clock is switched off.

**Reasoning:** a daily cron against a database holding three test documents earns nothing, and
it carries a cost that isn't obvious at the point of writing `boss.schedule(...)` — **a schedule
means something must always be running.** That single requirement is what ruled out
request-driven hosting and kept Neon's compute awake. Removing it reopens the host choice
([ADR-0014](../decisions/0014-hosting-topology.md), amended) and makes Cloud Run's free tier
viable, since 180,000 vCPU-seconds/month cannot cover an always-on instance but covers a
scale-to-zero personal app easily.

**Note:** this does not defer *reminders*. They remain the headline M1 deliverable — storage
without reminders is the commodity half ([prior-art.md](../prior-art.md) §3). Only the
unattended timer is deferred, and only until the app is somewhere it can usefully fire.

→ `apps/api/src/jobs/index.ts`, [ADR-0014](../decisions/0014-hosting-topology.md),
[review.md](review.md) D8

### Vault recovery — recovery code, not strict zero-knowledge, not server-assisted

**Answered:** 2026-07-26

Zero-knowledge with a **client-side one-time recovery code**. The key material is wrapped
under both the passphrase and the recovery code; the server can never decrypt. Losing both
means permanent loss.

**Reasoning:** server-assisted recovery would mean the server can decrypt, which is not
E2EE. Strict no-recovery was judged too sharp an edge for something a person relies on.
The recovery code preserves the security property while making loss survivable once.

→ [ADR-0010](../decisions/0010-vault-key-hierarchy.md),
[security-model.md](../security-model.md) §5

### Encryption scope — vault only; ordinary data is not encrypted

**Answered:** 2026-07-26

No application-level encryption for documents or any other ordinary data. Encryption is a
vault-only concern. E2EE remains architecturally in scope as a future capability.

**Reasoning:** simplicity was the ask, but the stronger reason emerged from research — OCR,
search-inside-document, previews, and server-side reminders all require a server that can
read the data. Products that encrypt everything lose all of them permanently.

→ [ADR-0009](../decisions/0009-sensitivity-tiers.md), [prior-art.md](../prior-art.md) §5

### Family sharing — near-term, so ownership is space-based from day one

**Answered:** 2026-07-26

Sharing is expected after a few features land, not in a distant future. Ownership is
therefore modeled on spaces from the first table rather than `owner_id`.

**Reasoning:** retrofitting shared ownership later would touch every table, query,
authorization check, and test, in a codebase with real data, edited by sessions with
partial context. Two tables now avoids that.

→ [ADR-0006](../decisions/0006-space-based-ownership.md)

### Budget — free tiers now

**Answered:** 2026-07-26

Free tiers with a documented upgrade path. Realistic floor is a few dollars a month for the
API host; everything else is genuinely free.

→ [ADR-0014](../decisions/0014-hosting-topology.md)

### First domain — Documents

**Answered:** 2026-07-26

Documents first: identity, financial/legal, warranties/receipts, certificates.

→ [domains/documents.md](../domains/documents.md), [roadmap.md](../roadmap.md) M1
