# ADR-0013: Read-only offline in v1; no offline writes

- **Status:** accepted
- **Date:** 2026-07-26

## Context

The app is a PWA, installable on a phone, synced across devices. "Installable and synced"
invites the assumption of offline-first — full local read/write with background
synchronization.

Offline writes are a much larger project than they appear. Two devices editing the same
document while disconnected produces a conflict, and resolving conflicts requires choosing
a model (last-write-wins per field, vector clocks, CRDTs), building an outbox with retry
and reconciliation, handling writes that reference records deleted on the server, and
designing a UI for conflicts that cannot be resolved automatically. Each of those is a
source of subtle, hard-to-reproduce bugs — the worst possible category for a codebase
maintained by sessions with no shared memory.

Set against that: the actual usage pattern is one person, on two devices, rarely
simultaneously, almost always with connectivity.

## Decision

**v1 caches reads. Writes require connectivity.**

- The service worker (Workbox via `vite-plugin-pwa`) precaches the **app shell** so the app
  opens instantly and works as an installed app.
- TanStack Query's cache is persisted to IndexedDB, so the last-seen document list and
  detail views are readable offline — genuinely useful: your passport number in a queue
  with no signal.
- **Mutations while offline fail with a clear message** and are not queued. The UI states
  plainly that the change was not saved.
- Cached data is visibly marked as potentially stale, with the time it was fetched.
- Downloaded files are **not** cached offline in v1 (they are large and fetched from R2 by
  presigned URL, which expires).

The server remains the single source of truth. No local write log, no client-generated
IDs that need reconciliation, no merge logic.

## Alternatives considered

- **Full offline-first with an outbox and sync.** The complete answer, and what the app
  arguably deserves eventually. Rejected for v1 on the complexity analysis above — it is
  plausibly larger than the entire Documents domain, and it would be built before knowing
  whether it is needed. Building it wrong is worse than not building it: silent data loss
  from a bad merge is the single worst failure mode this app could have.
- **CRDTs (Yjs, Automerge).** The principled solution to concurrent editing, and excellent
  for collaborative text. Rejected as a poor fit: this is structured records with
  independent fields, not shared prose. It would add a substantial dependency and a
  fundamentally different data model to solve a conflict problem that mostly does not
  arise with one user.
- **Queue writes and replay them naively on reconnect, with no conflict handling.** The
  cheap version of offline-first. Rejected as actively dangerous — it silently overwrites
  whatever changed on the server in the meantime. A queued write that appears to succeed
  and then loses data is worse than a write that plainly failed.
- **No offline capability at all.** Simplest. Rejected because the read cache is cheap and
  genuinely useful — read access to your documents with no signal is close to the point of
  the app.

## Consequences

**Good:** The sync model is trivial to reason about — the server is always right. No merge
logic, no outbox, no conflict UI, no client-generated IDs. Users still get instant app
startup and offline reads, which covers the common case. Sessions cannot introduce sync
bugs in code that does not exist.

**Bad:** Cannot add or edit a document without connectivity, which is a real limitation for
capturing a receipt somewhere with no signal. Cached data can be stale, so the UI must be
honest about it rather than pretending. No offline file access — the most likely first
complaint in practice.

**Upgrade path, if offline writes are ever needed.** Recorded so a future session does not
start from scratch:

1. Add a server-assigned `version` (or `updated_at` precondition) to every mutable record.
2. Client sends the version it read; the server rejects a stale write with `409`.
3. Add an IndexedDB outbox for pending mutations, replayed on reconnect.
4. On `409`, surface a conflict to the user — do not auto-merge.
5. Only then consider field-level merge rules for specific low-risk fields.

Steps 1 and 2 are cheap and could be adopted early; they make the rest possible later.

**Revisit if:** offline capture becomes a genuine daily friction, most likely once
Documents supports quick photo capture of receipts.
