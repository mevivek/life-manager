# ADR-0024: Offline writes via an outbox, guarded by a version precondition

- **Status:** accepted
- **Date:** 2026-07-29
- **Supersedes:** [ADR-0013](0013-read-only-offline-v1.md) (read-only offline in v1)

## Context

[ADR-0013](0013-read-only-offline-v1.md) decided that v1 would cache reads and require connectivity
for writes. It was right at the time and it named its own revisit condition:

> **Revisit if:** offline capture becomes a genuine daily friction, most likely once Documents
> supports quick photo capture of receipts.

That condition has been reached, by an explicit product decision: the app must support offline use
including **capturing a document image**, which is the one thing you most want to do standing in
front of a filing cabinet or a parked car with no signal. ADR-0013 predicted this exact complaint —
"no offline file access — the most likely first complaint in practice".

What has changed since ADR-0013 is also that the read half now exists: the Query cache persists to
IndexedDB, and the app opens and reads offline. So this ADR is an increment on working code rather
than a green-field sync design.

**What has *not* changed is the risk.** ADR-0013's central argument still stands word for word: "a
queued write that appears to succeed and then loses data is worse than a write that plainly failed",
and "silent data loss from a bad merge is the single worst failure mode this app could have". Nothing
below softens that. The design here is the one ADR-0013 itself sketched as its upgrade path,
precisely so that adding offline writes does not mean adopting the naive version it rejected.

## Decision

**Writes may be made offline. They are queued in an outbox, replayed on reconnect, and rejected by
the server if the record changed underneath them. A rejected write is shown to the user and never
merged automatically.**

Five parts, in the order ADR-0013 listed them:

1. **Every mutable record carries a server-assigned `version`.** An integer, starting at 1,
   incremented by the server on every successful update. Exposed on the record so a client always
   knows what it read.
2. **A write carries the version it read, and a stale write is rejected with `409`.** The update is
   conditional in SQL — `where id = … and version = :expected` — so the check is decided by the
   database rather than by a read-then-write race in application code. `conventions/api.md` already
   reserved 409 for exactly this ("Conflict — version mismatch, duplicate").
3. **An IndexedDB outbox holds pending mutations** and replays them in order on reconnect. Each entry
   carries an `Idempotency-Key` for its logical operation, so a replay that already succeeded but
   whose response was lost replays rather than repeats (`conventions/api.md` §5).
4. **A 409 surfaces to the user.** Both values are shown and the user picks. There is no automatic
   resolution, no last-write-wins, and no field merging.
5. **Field-level merge rules are explicitly out of scope**, as they were in ADR-0013. They remain a
   possible later refinement on top of 1–4, not a substitute for them.

### Offline file capture

Image bytes are stored in IndexedDB while offline and uploaded on reconnect. This needs **no change
to [ADR-0008](0008-object-storage-r2.md)**: the presigned-URL flow is unchanged, and the presign
simply happens at replay time rather than capture time. That sidesteps the objection ADR-0013 raised
against caching files ("fetched from R2 by presigned URL, which expires") — we are not caching a
*download*, we are deferring an *upload*, and a fresh URL is minted when the network returns.

**The API still chooses the object key** (invariant 6). The outbox entry holds the bytes and the
declared mime; it never holds a key or a URL.

### The new consequence: storage quota

This is the one genuinely new problem, and it did not exist for the read cache. Document scans are
megabytes, and IndexedDB is **evictable** — a browser under storage pressure may discard the origin's
data without warning, which for a pending upload would mean silently losing the only copy of a
photo the user has already been told is saved.

So: request `navigator.storage.persist()` before accepting the first offline capture, check
`navigator.storage.estimate()` before queueing, and **refuse the capture with a clear message if
quota is short** rather than accepting bytes that may evaporate. Refusing to accept a file is a bad
experience; accepting one and losing it is a bug of the worst category this ADR is trying to avoid.

## Alternatives considered

- **Keep ADR-0013 as it stands.** Rejected because the maintainer's actual use — capturing documents
  away from a desk — is the use ADR-0013 predicted would force this change.
- **Last-write-wins on replay.** Cheapest by far, and rejected for the second time on the same
  grounds ADR-0013 gave: it silently destroys a change made on the other device, with nothing shown.
  It was explicitly offered and explicitly declined when this work was scoped.
- **CRDTs (Yjs, Automerge).** Rejected again, unchanged reasoning: these are structured records with
  independent fields, not shared prose, and one user with two devices rarely edits both at once.
- **`updated_at` as the precondition instead of a `version` integer.** Rejected: it works, but it
  couples correctness to timestamp precision and to clock behaviour on write, and it reads ambiguously
  when two writes land inside the same tick. An integer has neither problem.
- **`If-Match`/`ETag` headers rather than a `version` field in the body.** More HTTP-correct, and
  genuinely tempting. Rejected for consistency: every other contract in this codebase is a Zod schema
  in `packages/shared` ([ADR-0004](0004-zod-single-contract-source.md)), and a header-carried
  precondition would be the one rule expressed outside that single source. Revisit if a non-web
  client ever wants HTTP-standard caching semantics.

## Consequences

**Good:** Offline capture works, which is close to the point of a phone app for documents. The
server remains the single source of truth — the outbox is a queue of *intents*, not a second copy of
the truth, so there is no divergent local database to reconcile. The version precondition is useful
beyond offline: it also closes the ordinary two-tabs-open race, which was previously last-write-wins
by accident.

**Bad:** Meaningfully more moving parts than ADR-0013 — an outbox, a replay path, a conflict state
and a conflict UI, all of which can be wrong. Every mutable record grows a column and every write
grows a required field. A conflict is now a state the UI has to represent, which is the first place
in this app where the user is asked to resolve something rather than being told an outcome.

**What this ADR does NOT cover, deliberately:**

- ~~**`DELETE` has no version precondition yet.**~~ **Closed 2026-07-30 (D41).** `DELETE` now takes
  `?version=` — a query parameter rather than a body, because `fetch` will not reliably send a body on
  a `DELETE` — and a stale delete is refused with `409` exactly like a stale `PATCH`. It was worth
  closing before real documents went in: a delete is the one write this app cannot undo, since there
  is no restore endpoint, which makes it the write where a lost update matters *most* rather than
  least. Queueing a delete offline is now safe but still deliberately not done — see `lib/outbox.ts`.
- Reminders and files carry no version. They are append/remove-shaped rather than edit-shaped, so a
  merge question does not arise in the same way — but this should be re-examined the moment either
  grows an editable field.

**Revisit if:** conflicts turn out to be frequent enough that resolving them by hand is a chore, at
which point field-level merge for provably-independent fields (part 5) becomes worth the risk.
