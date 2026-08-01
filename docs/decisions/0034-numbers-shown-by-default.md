# ADR-0034: Numbers are shown by default; masking is one device preference

- **Status:** accepted
- **Date:** 2026-08-01
- **Supersedes:** the *display* half of [ADR-0026](0026-store-the-full-identifier.md) and
  [ADR-0027](0027-identifier-in-the-list-response.md) — the derived `identifier_last4` column, the
  per-row and per-card Reveal, and 0027's page-wide header toggle. Everything else in both **stands**:
  the full value is still stored, still plaintext, still returned on every response including the
  list, and revealing still is not an authorization boundary. Extends the same treatment to
  [`things.md`](../domains/things.md) §4 rule 7's `serial_last4`.

## Context

A document's number was masked everywhere, always, and reversed by a tap in three separate places:

- **Reveal**, on the detail screen's `IdentifierCard`.
- **Show**, on every archive row.
- **Show**, once more in the library header, revealing the whole loaded page at once.

Things' serials worked the same way through `ThingSerial`, minus the header control and with vehicle
registrations already exempt (ADR-0033 — a plate is painted on the outside of the car).

**The masking never protected anything, and both of the ADRs it came from say so.** ADR-0026 stores
the full value in plaintext; ADR-0027 puts it on every list response. So by the time a row renders,
the number is already in the payload, in the persisted IndexedDB cache, and in the component's own
props. 0027's consequences section states it outright: *"Reveal is still not an authorization
boundary … the values are in the list payload before any tap."* Anything that must actually be gated
has to be gated server-side (invariant: authorization is server-side, UI gating is not a boundary).

What masking *is* good for is shoulders near the screen. That is a real cost in a coffee shop and no
cost at all at a kitchen table — which makes it a **preference**, not a default, and certainly not
three controls.

Against that: ADR-0027's own argument for putting the number in the list was that *"the archive is
where you go when you need a number"* — someone asks for your PAN at a counter and the shortest path
should not be list → tap → wait. It removed a network round-trip from that path and then left a tap
in it.

## Decision

**Numbers render in full by default, everywhere.** Masking becomes a single device preference,
`feel.numbers`, offered on the You screen as *Shown* / *Hidden* and defaulting to **Shown**.

- One preference governs **both domains**. A person who hides their Aadhaar number should not have to
  find a second switch for their IMEI.
- With `hidden`, each value draws `•••• 8109` with a per-item **Show** beside it — the behaviour that
  used to be unconditional.
- **The page-wide header toggle in the library is deleted.** It answered per page a question this
  preference answers once, and it could only ever speak for the rows already fetched.
- A vehicle registration stays unmasked at **both** settings (ADR-0033). The preference does not
  reach it, and no toggle is drawn for it.
- **`documents.identifier_last4` and `things.serial_last4` are dropped** — the columns, the
  server-side derivation, and the response fields. The mask is cut from the full value by the client
  that draws it (`apps/web/src/lib/mask.ts`).

It joins `density`, `face` and `voice` in `lib/feel.ts` rather than becoming a fourth preference
mechanism: device-scoped `localStorage`, a forgiving read, and default-means-remove-the-key. Like
`voice` and unlike the other two it is **not** stamped on `<html>` — no stylesheet can choose between
a value and a mask of it, and an attribute nothing matches is a comment pretending to be code.

## Why the derived columns go with it

Server-side derivation bought exactly one guarantee: a client could not store a mask that disagreed
with the number it masked. That was worth a column when the mask was the thing on screen and the full
value was not.

It stopped being worth one the moment ADR-0027 put both fields in the same response. Two values that
always travel together, from the same row, cannot disagree — and the second was a copy of the last
four characters of the first. Deleting the copy removes a write path, a redaction exemption, and a
class of drift (an edit that updates one and not the other) in exchange for `value.slice(-4)`.

`identifierLast4Schema` **stays**, because `custom_attrs` still has genuine tail-only fields
(`document_number_last4`, `account_last4`, `payment_method_last4`) where the full number must never be
stored at all. That is a different thing wearing a similar name.

## Rejected alternatives

- **Remove masking outright, with no setting.** The original request, and it is defensible: nothing
  is protected by it. Declined because the coffee-shop case is real and costs nothing to keep once it
  is opt-in — and because deleting a capability is harder to reverse than defaulting it off.
- **Keep the header toggle as a per-page override.** Two controls for one decision is how they end up
  disagreeing, and the page-wide one was always a partial answer: it could not speak for rows that
  had not been fetched.
- **Store the preference on the account.** Same argument as the theme and the feel keys: this is
  device state. A phone in public and a laptop at home want different answers, and syncing it would
  drag it through the `persister.ts` allowlist for nothing.
- **Keep `identifier_last4` and merely stop rendering it.** A column nothing reads is a column the
  next session has to work out the purpose of. The cost of keeping it is a permanent question; the
  cost of dropping it is one migration.
- **Default to `hidden`, so nothing changes for existing users.** That preserves a behaviour whose
  own ADRs argue against it, and it would make the setting an opt-out from a mask that never worked.
  The default is the decision here.

## Consequences, stated plainly

- **A stale bundle breaks until it reloads.** The web app and the API deploy on separate triggers
  (**D54**, **D62**). A client built before this change *requires* `identifier_last4` and
  `serial_last4` — a bare `.nullable()` makes the key mandatory in Zod — so once the API stops sending
  them, that build fails to parse every document and thing response and loses the archive. This is the
  D54 outage with the halves swapped. For a single-user pre-v1 app the remedy is one reload;
  `CACHE_BUSTER` is the build SHA, so the persisted cache drops itself on the next deploy anyway.
  Recorded as debt **D86**.
- **A number is on screen by default.** That is the point, and it is a change in what a bystander can
  read over a shoulder. The You screen says so in the one paragraph whose job is telling the user how
  their number is handled — and still may not say "encrypted" (invariant 7, **D44**).
- **D47 is unchanged.** The persisted cache still holds every number in plaintext; that is ADR-0027's
  cost, not this one's, and this ADR neither worsens nor fixes it.
- **The mask has one implementation now**, on the client, in `lib/mask.ts`, shared by both domains —
  where before there were two derivations server-side and two renderings client-side.
