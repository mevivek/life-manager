# ADR-0029: The Things domain — a second domain, and cover is not expiry

- **Status:** accepted
- **Date:** 2026-07-30
- **Supersedes:** —
- **Superseded by:** —

## Context

The fourth design handoff ([docs/design/](../design/README.md)) introduces **Things** — the physical
objects a household owns — as a working domain rather than a sketch. That pulls
[roadmap.md](../roadmap.md) M4's "Assets" forward, and it forces three decisions the Documents domain
never had to make.

**1. A thing's dates are not expiries.** A passport that expires is *invalid*; a dishwasher whose
warranty ends keeps washing dishes. The expiry ladder ([ADR-0025](0025-ledger-design-system.md) §2,
[design.md](../conventions/design.md) §2) is five states built around "is this still valid", and
`--status-late` on a lapsed warranty would say something false in the loudest voice the system has.

**2. Ownership is a state, not a deletion.** People lend things and sell them. The record has to
survive both, because *proving what you handed over and when* is a large part of why anyone files a
receipt. A "sold" thing that vanished from the archive would delete the evidence at the moment it
became useful.

**3. Documents and things point at each other.** A car carries four dated papers; a warranty card
belongs to a boiler. That relationship is the reason to have both domains rather than filing
everything as a document with a `product` attribute — which is what `warrantyAttrs.product` in
[shared/documents.ts](../../packages/shared/src/documents.ts) does today, and it is a string, so
nothing can be read from the thing's side.

And there is a fourth, which is where the design contradicts itself: the comp draws the Things
navigation **twice** and ships a `thingsNav: "tab" | "switch"` knob defaulting to `tab` — while its
own §4 prose, unchanged from handoff 1, still reads *"three tabs, forever"* and *"domains never become
tabs… the middle tab's title becomes a domain switcher"*.

## Decision

**Things is a real domain**, with its own contract in `packages/shared/src/things.ts`, its own doc at
[domains/things.md](../domains/things.md), and its own two screens. It is not a `doc_type`.

**Cover gets its own four-state ladder, and it never borrows the expiry gauge.** New shapes, new
words, and one shape the expiry ladder does not own:

| Cover state | Glyph | Words | Tone |
|---|---|---|---|
| `active` | a **depleting bar**, filling from the left | "3 years left" | `--status-ok` |
| `ending` ≤60d | the same bar, low | "Ends in 6 weeks" | `--status-soon` |
| `ended` | the bar at zero | "Ended 20 Jan 2026" | `--status-late` |
| `none` | a **dotted rule** — no bar at all | "No warranty recorded" | `--status-none` |

The bar is the point. A document's gauge counts *down* in three discrete bars towards a cliff; a
warranty is a continuous span with a start and an end, and a proportional bar is the honest drawing of
one. `ended` is stated as a date and not alarmed about: it is `--status-late` because that is the
palette's "past its date" hue, and the *words* carry the difference — "Ended 20 Jan 2026", never
"Expired".

**60 days, not 45.** `NEEDS_YOU_DAYS` is 45 and stays 45; cover's boundary is `COVER_ENDING_DAYS = 60`,
because the useful action on an ending warranty (register it, claim on it, decide whether to extend) has
a longer lead than renewing a passport. Two thresholds in two ladders, each named where it is used.

**Service is a cycle, not a date.** An interval in months, a log of what was done and what it cost, and
a next date that *moves* when a service is logged. The log is a first-class part of the record because
it is what a buyer asks to see.

**Ownership is `here` | `lent` | `gone`.** `lent` means still yours and elsewhere — reminders carry on.
`gone` means sold or given away — the record stays, is dimmed in the list, and is excluded from both the
sum insured and the Now horizon. Neither is a delete.

**A document and a thing are linked by one nullable `thing_id` on the document**, read from both sides:
*Belongs to* on the document, *Its documents* on the thing. One-to-many, because a receipt belongs to
one object and an object collects many papers.

**The Things navigation is the switcher on the Documents title, not a fourth tab.** Tab bar stays
`Now · Documents · You`. Segmented pills under the title swap the collection.

**Now stays a single cross-domain feed.** A thing's warranty end and service due sit on the same
horizon as a document's expiry, distinguished by shape rather than by section: a **square** dot with a
mono kicker for a thing event, the existing **round** dot and no kicker for a document.

## Alternatives considered

- **A fourth tab — the comp's own default.** Rejected because ADR-0025 §4 decided this in advance and
  the reason still holds: at fortnightly usage the user relearns the bar every time they open the app,
  and the plan was always that domain two arrives as a switcher. ADR-0025 §4 said the switcher
  *"appears the day the second domain does"* — today is that day, so honouring it is not a deviation
  from the comp, it is the comp's own stated rationale. Note what this costs: Things is two taps from
  Now instead of one. Accepted. If real use shows the switcher is too quiet, that is a superseding ADR
  with evidence, not a re-litigation of the same argument.
- **Ship the knob as a fourth Feel preference.** [design.md §12](../conventions/design.md) defines Feel
  as three device-scoped preferences and each one is a *different kind of thing* (tokens, tokens,
  prose). A navigation preference is a fourth kind, doubles the layout surface, and doubles every
  Things test to prove both paths. A preference is also the wrong tool for a structural question: it
  asks the user to decide something the design should have.
- **Things as a `doc_type`.** This is what exists today (`warranty` with a `product` string) and it is
  what the design is reacting against. A thing has no expiry, no issuer and no country; it has cover,
  a serial, a purchase price, a location and a service cycle. Forcing it through
  `documentCreateSchema` would mean six optional fields that are meaningless on nine types out of ten,
  and — the fatal part — no way to ask "which papers does this car have", which is the whole feature.
- **Reuse the expiry ladder for cover.** Cheapest by far: one component, one vocabulary, no new tokens.
  Rejected because it makes the app lie in its loudest register. A `today` ring pulsing on a warranty
  that lapses this afternoon says a fridge stops working at midnight. The ladder's five states encode
  *validity*, and cover is not validity.
- **A `thing_documents` join table.** More general, and the generality is unused: a receipt for one
  dishwasher does not belong to a second dishwasher. A nullable column on the document is one migration,
  one index, and no ambiguity about which side owns the relationship. Revisit if a genuine many-to-many
  appears (a single invoice covering three appliances is the plausible one) — that is a migration, not
  a redesign.
- **Sum insured as a computed server field.** It needs the contents-insurance policy's `sum_insured`,
  which lives in a *document's* `custom_attrs`, so computing it server-side means the Things service
  reading the Documents repository. Kept in the client for now, and flagged: see *Consequences*.

## Consequences

**Good:**

- The design's central claim survives — colour is spent only on status, and cover is a *different*
  status with a different shape, so the two ladders can sit on one screen without competing.
- `agent-playbooks/add-a-domain.md` gets its first real exercise. ADR-0006's promise is that a second
  domain is mechanical; this is where that is measured.
- The link makes both domains better in the direction that matters: a thing is the natural index for
  the paperwork a person actually hunts for ("where's the car insurance").
- Tab count stays three, so ADR-0025 §4 holds unbroken through domain two.

**Bad, and real:**

- **Two status vocabularies now exist**, and design.md §2's "never hand-roll a second one" needed
  amending rather than obeying. The mitigation is that `CoverStatus` is the *only* second one and it is
  named as such in design.md §2a — a third would be a smell.
- **Two thresholds, 45 and 60**, which look like a drift and are not. Both are named constants beside
  the ladder that uses them, and neither is a business rule: reminders still fire server-side.
- **The UI ships before the API.** This branch is the screens and the contract; the endpoints are
  another session's work. Until then `useThings` 404s and every Things screen renders its error state.
  That is a deliberate, temporary state and it is the reason `packages/shared/src/things.ts` exists
  first: whichever session builds the API implements *this* contract rather than inventing a second.
- **Sum insured is computed in the client**, which means the number is only as complete as the page
  loaded — exactly the `complete` caveat the Now footer already carries. It is drawn only when a
  contents policy is found, so the common case is that the card is absent rather than wrong.
- **The persisted cache grows a second domain of plaintext.** A thing's serial is the same class of
  data as a document's identifier, so debt **D47** now covers both. No new decision — the same one,
  wider.
