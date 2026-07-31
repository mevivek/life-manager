# ADR-0033: The rest of handoff 5 — no filter chips, a public plate, and a You screen that counts both domains

- **Status:** accepted
- **Date:** 2026-07-31
- **Supersedes:** [ADR-0032](0032-one-library-tab.md) § *Deviation* (the filter chips), **in part** —
  its navigation decision stands entirely
- **Superseded by:** —

## Context

[ADR-0032](0032-one-library-tab.md) built the navigation half of design handoff 5 and deliberately
stopped there, listing what it had not built and why. The maintainer has now gone through that list
and decided each item. This ADR records those decisions and the one they declined.

It also fixes a defect in ADR-0032's own work, reported by the maintainer looking at the screen: **a
document row changed shape when the scope pill changed.**

## Decision

### 1. The filter chips come off — reversing ADR-0032's deviation

ADR-0032 kept the Type / Tag / Expiring-before / Whose / Has-scan row and the Things kind chips
against a comp that draws none of them, and wrote its own reopening condition:

> **Revisit if** the maintainer confirms search alone is enough; the chips come off in one commit.

They have. `DocumentFilters.tsx` is **deleted**, not left unreferenced, and the kind row goes with it.

**The query parameters survive the controls, and that distinction is the whole design.** `?scan=no`,
`?type=identity`, `?who=Priya` and the rest still filter server-side and still round-trip through the
URL. What is gone is the row of chips that *drew* them. This keeps the two things ADR-0032 named as
blockers working — the Now screen's no-scan nudge, and any URL an installed PWA has saved — while
matching the comp's header exactly.

**A `Clear` control sits beside the count, and it is required rather than decorative.** With no chip
to show *why* a list is short, a filter arriving from a URL would otherwise be unexplainable and
inescapable: the list is narrowed, nothing on screen says so, and nothing on screen undoes it. That
is the same failure the folding search guards against by staying lit, and it gets the same answer.
Drawn only when something is actually narrowing, so it is never a control that does nothing.

`documents.md` §4 rule 13's Whose filter is retired as a *control*. The `holder` query parameter and
`GET /documents/holders` are untouched, and capture still asks whose a document is.

### 2. One row builder, because a row must not change shape when a filter changes

**The defect.** ADR-0032's library built `All`'s rows inline and let `DocumentList` build the
`Documents` scope's. The same passport therefore rendered with a **52px glyph column and no number
controls** in one scope and a **14px column with Copy and Show** in the other, so tapping a scope pill
appeared to redraw the row.

**The fix is structural, not cosmetic.** `features/documents/documentRowProps.ts` is now the only
place a `Document` becomes `DocumentRow` props, and both lists call it. That is the comp's own
instruction, in a comment on its normalisers: *"these two normalizers are the only place a document or
a thing becomes row data, so the lists can't drift apart again."*

Two consequences worth stating, because they are behaviour changes rather than refactors:

- A document row now draws its **number line and its Copy / Show controls in every scope**, including
  `All`. It previously drew them only under Documents.
- The page-wide **Show / Hide numbers** toggle is therefore **no longer scope-gated**. A toggle that
  appeared only under Documents would leave numbers revealed on an `All` list with no way to hide
  them.

`ThingRow` needed no equivalent: it takes a `Thing` and nothing else, so it could not drift.

### 3. A vehicle's registration is not masked

Every other serial stays masked. A registration does not, because it is **painted on the outside of
the object**: masking it costs the owner a tap on the one number they actually read aloud — to a
mechanic, an insurer, a parking attendant — and protects nothing, since the threat the mask addresses
is shoulders near the screen and anyone standing there can read the plate off the car.

- `ThingSerial` renders a vehicle's serial in full, and draws **no Show / Hide control at all** — a
  toggle whose two states look identical is worse than no toggle. Copy stays.
- `ThingRow` draws it as a **plate**: a hairline `--ink-2` border, 4px radius, mono with wide
  tracking. That is what makes it scannable in a list without a label; nothing else in the app looks
  like this. No other kind's serial appears on a row at all.

**Nothing about storage changes.** The value was already plaintext by explicit decision
(things.md §4 rule 7, [ADR-0026](0026-store-the-full-identifier.md)); this changes only whether one
component hides it by default.

We do **not** follow the comp's second plate block near the thing's title. It draws the same number
twice on one screen, two rows apart from the serial card that already shows it with a Copy button.

### 4. A row-level *Add scan*

A document row with no number and no file gets a dashed **Add scan** control instead of the bare
dashed page glyph — the difference between labelling an absence and offering to fix it. A row that
already carries Copy and Show keeps the small glyph, because three controls on one row at 390px is
where a miss lands on the wrong one.

**It is a `<Link>` to the document's Scans section, not a file picker.** Opening the OS picker would
mean firing `input.click()` after a navigation, which browsers refuse without a user gesture on the
destination page. A control that silently does nothing on some devices is worse than one that takes
you to where the job is.

### 5. The You screen counts both domains

- **Figures:** `Documents filed · Things owned · Dates watched`. *Things owned* excludes `gone`
  things — a handed-on thing keeps its record and is not a possession. *Dates watched* is one figure
  across both domains because **one daily scan** watches a passport expiry, a warranty end and a
  service date; two figures would have implied two mechanisms.
- **App rows:** `Value of things`, `Out of cover`, `Missing a scan`, `Elsewhere`.
- **Reminders gains Turn on / Turn off.** You previously stated the push state and left the only
  control on the Now screen's nudge, which appears only when a document has an expiry — so a user who
  turned reminders off had no route back to them from the screen named after their own settings.

Every figure is derived from the helper the other screens use — `totalInsurable`, `coverOf` — never
re-implemented. Two screens computing "what do I own" separately is how they come to disagree, and
the disagreement is invisible until somebody puts them side by side.

**Turn off is client-side, and that is the complete fix rather than half of one.** Unsubscribing the
browser's `PushSubscription` stops delivery immediately, and the API already handles the consequence:
`sendPush` returns `expired` on a 404/410 and `jobs/reminders.ts` calls
`markSubscriptionExpiredForMaintenance`, so the row disables itself on the first send after. A
`DELETE /api/v1/push/subscriptions/:id` would buy a tidier table a few hours earlier and change
nothing the user experiences.

### 6. Sign-in is NOT changed to Google-only — and this needs a human decision

Handoff 5 draws the sign-in screen with the email and password fields removed, leaving one *Continue
with Google* button and the line *"One account, no password to forget."*

**Not built, because [ADR-0020](0020-google-oauth-alongside-password.md) already considered and
rejected exactly this**, under *Alternatives considered* → *"Google only, drop email+password"*:

> Rejected because it makes a single Google account the only way into a system whose stated long-term
> goal is a password vault. A locked or lost Google account would mean losing access to everything,
> and "recover your Google account" is not a recovery story this project controls.

That is a decision about **account recovery**, not about layout, and a comp does not supersede it. The
`GoogleButton` it asks for already exists on both auth screens — what handoff 5 changes is the removal
of the other route in, which is the half ADR-0020 refused.

There is also a deployment risk that would have to be settled first: `GOOGLE_CLIENT_ID` and
`GOOGLE_CLIENT_SECRET` are **optional** in `env.ts`, and `socialProviders` is an empty object without
them. Nothing in `cloudbuild.deploy.yaml` sets them. If they are not provisioned on the deployed API,
shipping Google-only would remove the only working way into production.

**To do this, supersede ADR-0020 explicitly**, and confirm the credentials are set first. If it is
wanted with the recovery risk mitigated, the safer shape is for the API to advertise whether Google is
configured and for the screen to fall back to the password form when it is not — that matches the comp
whenever OAuth works and cannot lock anyone out.

## Consequences

**Good:**

- The library header is the comp's: a title, a count, a search toggle and the scope pills.
- A row is one shape everywhere, enforced by there being one builder.
- The You screen answers "what do I own" for both domains, from the same helpers the library uses.
- Reminders can be turned off from the screen that reports them.

**Bad, and real:**

- **Five filters are gone as controls**, and the only remaining narrowing in the UI is text search.
  Someone who used `Whose` or `Expires before` has to type instead. The parameters still work, so the
  chips can come back in one commit — but nothing in the app now teaches that those filters exist.
- **`Missing a scan` lost its in-app deep link target's visible cause.** The Now nudge still lands on
  a filtered list; the only thing telling the user it is filtered is the count reading "N matching"
  and the `Clear` beside it.
- **A document row is busier in `All` than it was**, because the number line now draws there too.
  That is the price of one shape everywhere, and the alternative is the drift this ADR fixes.
- **The sign-in screen is knowingly not matching the comp**, and will keep not matching it until
  someone supersedes ADR-0020.

**Revisit if:** search alone turns out not to be enough — the chips are one commit away and the
parameters never left. Or when a decision is made on ADR-0020.
