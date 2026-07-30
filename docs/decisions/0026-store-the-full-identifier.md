# ADR-0026: Store the full document identifier, unencrypted

- **Status:** accepted — **the detail-only rule superseded by
  [ADR-0027](0027-identifier-in-the-list-response.md)**
- **Superseded by:** [ADR-0027](0027-identifier-in-the-list-response.md), **scoped: the "returned on the
  detail response only" rule.** `identifier` is now on `documentSchema`, so it comes back on **every**
  document response including the list. Everything else here stands — the full value is stored, in
  plaintext, `identifier_last4` is derived server-side and never sent by a client, and Reveal is a
  display state rather than an authorization boundary. The cost 0027 accepted is that the persisted
  cache now holds every number on the device (debt **D47**).
- **Date:** 2026-07-30
- **Amends:** [ADR-0009](0009-sensitivity-tiers.md) — the data-minimisation half of it, not the
  encryption half
- **Reverses:** business rule 6 in [domains/documents.md](../domains/documents.md) §4

## Context

Rule 6 said: *"Never store a full identifier. Passport numbers, account numbers, and national IDs are
truncated to `identifier_last4` at the API boundary. The full number is on the scan."* The API
accepted `identifier` up to 64 characters, kept the last four, and discarded the rest.

The reasoning was sound as far as it went — a plaintext column holding a whole passport number is a
liability, and the scan is access-controlled anyway. **It had one hole, and it is the app's entire
reason for existing:** a number you cannot read is a number you go and find the original for. The
truncation optimised for a breach that has not happened at the cost of the errand this app was built
to remove.

It is also wrong about where the value lives. For the documents this app's user actually owns —
Aadhaar, PAN, a vehicle registration, an EPF UAN — **the number is the thing you need at a counter**,
far more often than the scan is. You are asked to *recite* an Aadhaar number, not to show a photo of
one. Rule 6 made the app useless for the single most common way those documents get used.

Two further facts made the decision easy rather than close:

1. **The scan is frequently absent.** Rule 6 leaned on "the full number is on the scan", but capture
   is title-only by design (Q2), and the maintainer's own archive is currently 2 documents with 0
   scans. The fallback the rule depended on did not exist.
2. **`identifier_last4` was already being displayed as if it meant something.** Four characters under
   a label reading "Last four of the number" is a mask with nothing behind it — it can confirm you
   are looking at the right record and do nothing else.

## Decision

**Store the identifier in full, in plaintext, and mask it for display.**

- A new `identifier` column on `documents` holds the whole value.
- `identifier_last4` stays, as the **display** form, derived server-side on every write by
  `truncateToLast4`. A client cannot send a mask that disagrees with the number it masks.
- The full value is returned on the **detail** response only. The list keeps the mask.
- The UI shows the mask with a **Reveal** toggle and a **Copy** button.

**No encryption.** [Invariant 7](../../CLAUDE.md#invariants) and ADR-0009 reserve application-level
encryption for the vault (M5), and this is not the vault. Nothing about this decision changes that —
which is worth stating plainly, because it is the part most likely to be misremembered as "we
encrypted the numbers".

### What this does and does not amend

ADR-0009 has two separable claims. **The encryption claim is untouched**: no application-level
encryption for anything except the vault, because a server that cannot read the data cannot OCR it,
search it, or send a reminder about it. **The data-minimisation posture is what changes** — documents
remain the tier the server reads in the clear, and the set of fields it holds in the clear now
includes the identifier.

## Consequences

- **The redaction list stopped being belt-and-braces.** `identifier` and `*.identifier` are in
  pino's `REDACTED_PATHS`. Before this, the worst a leaked log line held was four characters; now it
  is a whole Aadhaar number. `identifier_last4` is deliberately **not** redacted — it is the display
  form, it is in every list, and censoring it would make request logs unreadable while protecting
  nothing.
- **The list must never carry it.** `documentSchema` has no `identifier` field, and `toDocument()` in
  the service does not map one; the detail handler spreads it in separately. That is the enforcement:
  a new list endpoint gets the mask by default and has to opt in. A test asserts the full value is
  absent from `GET /documents`, on the raw body rather than the parsed rows.
- **Reveal is a display state, not an authorization boundary.** The full value is in the detail
  response before any tap, and the server does not gate it — a caller who can read the document is by
  definition entitled to its number. Hiding it is about shoulders near a screen. Treating Reveal as a
  security control would be exactly the UI-gating mistake the security model forbids.
- **The edit form had to change or it would have destroyed data.** It populated its number field from
  `identifier_last4`; with the full value stored, opening a document and saving nothing would have
  replaced its number with its own last four digits. It reads `identifier` now.
- **The 4-character input cap is gone.** It existed to make the truncation visible before it happened.
  Kept, it would have been the only thing discarding the number — silently, mid-typing.
- **Encryption is now a debt rather than a decision** — see D44. The honest position is that this is a
  single-user private app whose threat model is a lost phone, not a hostile DBA, and that the vault
  (M5) is where key management gets built properly. Adding a second, weaker crypto scheme here first
  would make that harder rather than easier.
- **No copy in the app may say "encrypted".** The design comp's own text — *"Stored in full,
  encrypted at rest, hidden until you ask"* — was rewritten in both places it appears. A test asserts
  `IdentifierCard` never renders the word.

## Alternatives considered

**Keep last-4 only.** Rejected: it is what created the problem. The mask cannot answer "what is my
PAN", which is the question.

**Store full, encrypted with an app-level key.** Rejected for now, and this is the closest call. It
needs a key that is not in the database, a rotation story, and a decision about what happens to the
column when the key is lost — all of which is M5's work, done once, properly, for the vault. A
bespoke scheme here would be a second thing to rotate and a false sense of a boundary that
`Reveal` already invites people to over-read. Recorded as D44 so the trigger is written down.

**Full for policy and consumer numbers, last-4 for Aadhaar / PAN / Voter ID.** Rejected: it is a rule
the user has to learn, applied to the exact documents where the number matters most, and it would
still store enough to be worth protecting while being too little to be useful.

**Encrypt in the client before sending.** Rejected on the same grounds ADR-0009 rejected it for
documents generally: the server could no longer search it, and the value of a searchable archive is
the product.

## Open items

- The `Copy` button puts a full identifier on the system clipboard, where other apps can read it and
  some platforms sync it across devices. Acceptable for a value the user is about to type into a form
  anyway, but it is the one place the number leaves the app's control. No copy-expiry, because the Web
  Clipboard API offers none.
- Nothing purges the column. A user who wants a number gone must clear the field; the row keeps no
  history, but there is also no audit of when it was revealed. Consistent with the rest of the app,
  which has no audit log at all.
