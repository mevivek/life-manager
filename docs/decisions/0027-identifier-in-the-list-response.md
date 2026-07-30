# ADR-0027: The full identifier is returned in the list response

- **Status:** accepted
- **Date:** 2026-07-30
- **Supersedes:** the detail-only rule in [ADR-0026](0026-store-the-full-identifier.md). Everything
  else in 0026 — full storage, the derived mask, plaintext, "Reveal is not a boundary" — stands.

## Context

ADR-0026, accepted the same day, said this:

> Deliberately not on `documentSchema`, so it is absent from the list. A list of 100 documents has no
> use for 100 full numbers, and putting them there would mean every archive fetch, every offline cache
> write and every service-worker precache carried the lot. One document at a time, asked for by id, is
> the smallest surface that still answers "what is my Aadhaar number".

The third design handoff then put the number **on every archive row**, with a per-row Show/Hide, a
per-row Copy, and a header toggle that reveals the whole list at once.

The reasoning behind 0026's restriction was data minimisation, and it was not wrong about the cost.
What it under-weighted is the actual task: **the archive is where you go when you need a number.** You
open the app at a counter, someone asks for your PAN, and the shortest path should not be
list → tap row → wait for a detail fetch → tap Reveal → read. On a scale-to-zero API with a cold
start, that middle step is seconds of a person standing at a desk.

A middle path was considered and offered: render the mask from `identifier_last4` (already in the
list, so free) and fetch the one document's detail on Show. It preserves 0026's sentence exactly. It
was **declined in favour of the simpler contract**, and the decision is recorded here rather than
argued again.

## Decision

**`identifier` moves onto `documentSchema`**, so every list response carries the full value alongside
the derived `identifier_last4`.

- The archive row shows the number's label and the mask by default.
- A per-row control reveals or re-hides one number; a header control does the whole page.
- A per-row Copy puts the full value on the clipboard without opening the document.
- `documentDetailResponseSchema` no longer needs its own `identifier` — it inherits it.

## Consequences, stated plainly

These are the costs 0026 named, now accepted rather than avoided:

- **The offline cache holds every number.** The persisted Query cache writes list responses to
  IndexedDB (`lib/persister.ts`, `'documents'` is allowlisted), so a device that has opened the
  archive has every identifier on disk in plaintext, for up to the cache's 7-day `MAX_AGE_MS`. This is
  the same plaintext posture as the database (0026, invariant 7, debt D44) — but on a *phone*, which is
  the device most likely to be lost. **This is the real cost of this ADR**, and it is the reason
  sign-out purges the cache (`lib/session.ts`) rather than merely clearing the Query client.
- **Log redaction matters on more paths.** `identifier` and `*.identifier` are already in pino's
  `REDACTED_PATHS`, and now a *list* response body carries them too. The list is the highest-traffic
  endpoint in the app.
- **A capped page is no longer a partial answer.** Nothing changes functionally, but note the archive
  fetches 20 at a time: the numbers on disk are the numbers of the pages you have scrolled.
- **Reveal is still not an authorization boundary.** Unchanged from 0026 and now more obviously true:
  the values are in the list payload before any tap. Anything that must actually be gated has to be
  gated server-side.

## What is deliberately unchanged

- **No encryption.** Invariant 7 and [ADR-0009](0009-sensitivity-tiers.md) keep application-level
  encryption for the vault. Debt **D44** still holds the trigger, and it is now worth more: the same
  argument that made plaintext acceptable in one database row is weaker across a phone's IndexedDB.
- **`identifier_last4` is still derived server-side**, never sent by a client, and still the thing
  rendered by default. Revealing is per-row and does not persist across a reload.
- **No copy in the app says "encrypted."** The design comp still claims it; it is still false.

## Open items

- **The cache is the exposure now, not the response.** If this turns out to be uncomfortable, the
  cheapest mitigation is not to un-ship this ADR but to drop `identifier` on *dehydrate* — the
  persister already has a `shouldDehydrateQuery` hook, and stripping one field on the way to disk
  would keep the fast path and lose the at-rest copy. Recorded as debt **D47**.
- Nothing purges a revealed state; it is component state and dies with the render. That is deliberate —
  a "keep revealed" preference would be a way to leave every number on screen permanently.
