# Open questions

Product questions that genuinely need a human answer, plus the answers already given.

**How this file works** ([ADR-0017](../decisions/0017-product-brain.md) rule 4): a session
that hits a product question it cannot answer **writes it here and continues with the rest
of the work.** Do not stall, and do not invent an answer and build on it silently. If you
must proceed, state the assumption in the entry so a later session can see what was
assumed and correct it.

Only questions where **different answers lead to different work** belong here. Routine
judgment calls get made and noted, not queued.

> **A "Leaning" is not a decision.** Every open question below records one, with reasoning, so the
> human has something concrete to react to rather than a blank page. It is a *proposal*
> ([ADR-0017](../decisions/0017-product-brain.md); [CLAUDE.md](../../CLAUDE.md) invariant 12).
> **Do not build on a leaning and do not move a question to §2 without an explicit answer.** If a
> question blocks the work in front of you, say it is blocking and pick up something else — a
> wrong schema built on an assumed answer costs far more than a delay.

Answered questions move to §2 and stay forever — they are the record of *why*.

---

## 1. Open

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

### Q7 — Should a warranty or a service date create reminders automatically?

**Why it matters:** Documents auto-remind only for `identity` and `certificate` types (**Q1**, answered
(a): expiry-only). Things now has two due dates of its own — `warranty_ends_on` and `service_due_on` —
and the equivalent call has never been made, so **nothing creates a thing reminder at all.** The
capability was built and the switch deliberately left off: `reminders` is generic on `entity_type`, M4
step 1 added `THING_ENTITY_TYPE` and a `reminders[]` on the thing detail response, and there is a test
asserting that array comes back **empty**. An empty `reminders[]` on a thing is therefore correct
today, not a bug.

**This was live in [domains/things.md](../domains/things.md) §9(2) and never filed here**, which
[ADR-0017](../decisions/0017-product-brain.md) rule 4 requires — recorded so the omission is visible
rather than tidied away.

**Why it is not a `AUTO_REMINDER_TYPES`-shaped edit.** The daily scan is document-shaped: it left-joins
`documents` for a title and renders `"{title} expires {due_on}"`. Pointed at a thing that becomes *"A
document expires …"*, and if the join were naively widened, *"Dishwasher expires 20 Jan"* — the exact
sentence [ADR-0029](../decisions/0029-the-things-domain.md) and things.md §4 rule 2 exist to prevent,
because **a lapsed warranty is not an expiry and the dishwasher keeps washing dishes.** So answering
this also decides the *copy*: a second title source and a second register of words ("Warranty ends",
"Service due"). Debt **D58**.

**Options:** (a) neither — a warranty ending is information, not an action, and only expiries nag;
(b) **service due only**, since an overdue service is a thing you must actually do, while an ended
warranty is not; (c) both, at their own lead times (things.md §6 proposes 30/7 for a service and
60/14 for cover, against documents' 90/30/7); (d) per-thing opt-in.

**Leaning:** (b). It is the one of the two where a notification asks for an action, it keeps Q1's
"reminders are for deadlines you can miss" logic intact, and it needs only one new copy register rather
than two. (c) is the tempting answer and it doubles the wording decision for the half that is merely
informative.

**Blocks: M4 step 2.** Directly — that step *is* this question, and things.md §9(2) says so. Do not
build it on a leaning; the wording is the hard half and it is a human's call.
`things.test.ts`'s "§6: returns an empty reminders array" is the test whichever answer wins changes.

---

## 2. Answered

Decisions already made. Kept permanently.

### Q1 — Reminders are expiry-only. Documents without an expiry stay silent

**Answered:** 2026-07-28 · **was blocking M1**

Option (a). A document with no expiry generates **no reminder of any kind**. No periodic review
nudges, and no user-set arbitrary review dates.

**Reasoning:** it is the proven pattern — [prior-art.md](../prior-art.md) §3 found a whole product
category built on expiry tracking alone. Periodic nudges (b) risk becoming noise, and a
notification people learn to ignore is worse than none, which would undermine the one feature
principle 1 calls core. Arbitrary review dates (c) were considered as a small addition and
deliberately **not** taken in M1: it is easy to add later against real use, and adding it now means
guessing at a need nobody has felt yet.

**What this settles concretely:** `reminders` needs `due_on` and no second date concept.
Non-expiring documents are a normal, silent case — not a gap to design around.

**Revisit if** the archive fills with non-expiring documents and the app feels inert. Then (c) is
the cheap next step, not (b).

→ [roadmap.md](../roadmap.md) M1, [domains/documents.md](../domains/documents.md)

### Q2 — Title only at capture. Everything else optional

**Answered:** 2026-07-28 · **was blocking M1**

Option (a). The create form requires a **title and nothing else**. Type, issuer, expiry, tags and
notes are all optional and backfillable.

**Reasoning:** capture friction is the bigger risk to this app than thin metadata (principle 2 —
and [brain.md](brain.md) notes time-to-capture degrades silently, so it must be defended early). A
required field is paid on every single capture forever; missing metadata is fixable at any time, and
OCR at M2 can backfill much of it.

**The cost, stated so it is not discovered late:** M1 must handle half-empty documents **gracefully
rather than as broken**. A document with no type must still list, filter, search and render
sensibly; "untyped" is a valid state, not an error to badge. This is a real constraint on the list
and detail views, not just on the form.

**Revisit if** the archive becomes hard to navigate because too little is filled in. The fix then is
prompting after the fact, not blocking at capture.

→ [roadmap.md](../roadmap.md) M1, [domains/documents.md](../domains/documents.md)

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
