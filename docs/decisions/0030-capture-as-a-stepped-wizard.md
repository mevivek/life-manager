# ADR-0030: Capture is a stepped wizard, on two tracks

- **Status:** accepted
- **Date:** 2026-07-30
- **Supersedes:** —
- **Superseded by:** —

## Context

Capture today is one page. `DocumentForm` renders the title field, the preset chooser, the number
field, and an *"Add more now (all optional)"* disclosure that unfolds issuer, dates, country and tags.
That shape came from handoff 3 and it was the right shape for a domain where **title is the only
required field** (Q2, [open-questions.md](../product/open-questions.md) §2) and everything else is
optional forever.

The fourth handoff replaces it with a **six-step wizard**, and it does so for a reason that is visible
in the diff rather than stated in prose: the sheet now has to serve **two different records**. Adding a
thing ([ADR-0029](0029-the-things-domain.md)) asks a completely different set of questions — kind, make
and model, serial, purchase date, price, warranty length, photo — and several of them are *conditional
on the kind*. A vehicle wants a registration and a fuel type; a gold chain wants a hallmark and neither.

One page cannot do that. A single form holding the union of both tracks would render, on the common
case, a screen of fields that do not apply, and Q2's whole point is that capture friction is the thing
being defended against.

There is a second force. The preset chooser already prefills title, type and issuer from one tap, and
the number field already reformats itself per preset ([ADR-0026](0026-store-the-full-identifier.md)).
Those are *sequenced* behaviours wearing a single-page costume: picking the preset changes what the
fields below it mean. The comp's wizard makes that sequence explicit instead of implicit.

## Decision

**Capture is a stepped wizard with two tracks, chosen at the first step.**

Documents — six steps:

    type → whose → title → number → dates → scan

Things — six steps:

    kind → name → detail → purchase → warranty → photo

The Documents track's first step carries the escape hatch to the other one: *"Filing a thing you own,
not paperwork? → Add a thing"*. There is one Add control, not two, on every surface except the Things
list (which knows the answer already and opens the thing track directly).

**Q2 is unchanged and this does not weaken it.** Exactly one field is required per track — `title` for
a document, the lead field (`Make`, `What it is`) for a thing — and **every other step can be skipped**.
`Continue` on a step with nothing typed is not blocked; the steps that are pure enrichment
(`number`, `dates`, `scan`, `detail`, `purchase`, `warranty`, `photo`) draw an explicit *Skip for now*
beneath the primary button. A wizard whose steps cannot be skipped would turn six optional fields into
six required ones by ceremony rather than by validation, which is the trap here and the thing to guard.

**The capture budget still governs.** ADR-0025 §5's claim is *launch to saved in under 5 seconds*, and
a six-step wizard threatens it. Three things protect it, and all three are load-bearing:

1. **A tap on the first step advances.** Picking a preset or a kind both sets the value *and* moves to
   step two. There is no "choose, then press Continue".
2. **A preset fills three fields and skips a step's worth of typing.** The `title` step arrives
   prefilled from the preset, so the fast path is `tap Aadhaar → Continue → Continue → Save`.
3. **The lead field of each track is focused on arrival**, keyboard already up, and `Continue` is
   enabled from the first character.

**Progress is drawn, and it is honest.** A tick per step, filled to the current one, plus
*"Step 3 of 6"*. When capture is launched *against a thing* — from a vehicle's papers checklist — the
first step is already answered, so the count drops to five and the ticks drop the first segment rather
than showing a step the user will never see.

**The saved step reads back what it holds, and names what it does not.** Not just "Saved": the facts
that went in, then one sentence listing the fields still blank — *"Still blank: number, type. Add any
of it later — the record works without."* A confirmation that only says "Saved" makes a person reopen
the record to find out whether the number went in.

**`/documents/new` stays a real route.** Deep links and home-screen shortcuts still work, and it renders
the same wizard full-page.

## Alternatives considered

- **Keep one page, and branch the fields on a "what are you adding?" toggle at the top.** The cheapest
  option: no wizard machinery, no step state, no progress ticks. Rejected because the thing track's
  fields are conditional on the *kind*, not just on the track — so the single page would still need to
  swap its middle out, and it would do so with no affordance telling the user why the form just changed
  shape under their thumb. It also puts the two tracks' union into one scroll, which is the friction Q2
  forbids.
- **Two separate sheets, one per track, reached from two Add controls.** Honest and simple, and rejected
  on ADR-0025 §4's own argument against an Add *tab*: a global control that first asks *what* you are
  adding costs a decision at the exact moment speed matters. One Add, with the branch as a quiet
  footnote on step one, keeps the common case (a document) at zero extra taps and makes the rare case
  (a thing) one tap.
- **A wizard for things, the existing single page for documents.** Tempting — it changes nothing that
  works. Rejected because it means two capture components, two save paths, and two places the offline
  outbox has to be wired ([ADR-0024](0024-offline-writes-outbox.md)); and because the *number* step is
  the one place the wizard genuinely improves the document track, since it is where a preset's shape,
  keyboard and live counter all apply at once.
- **Require more than one field, now that there are steps to put them on.** Explicitly rejected. Q2 was
  answered with reasoning and a required field is paid on every capture forever. The wizard is a
  sequence of *invitations*; `Skip for now` is what makes that true, and it is not decoration.

## Consequences

**Good:**

- One capture flow serves two domains, and a third would slot in as a third track rather than as a
  third form.
- The number step finally gets room for what ADR-0026 built: the preset's real label, its literal shape
  as a hint, the live *"7 of 12 → Complete"* counter, and the right keyboard — none of which fitted
  legibly beside a title field on a 390px screen.
- The saved step's readback closes a real gap. "Saved" plus a silent record is how a mistyped number
  survives unnoticed.

**Bad, and real:**

- **Six steps is more taps than one page, and no amount of prose makes that untrue.** The mitigations
  above are what keep the 5-second budget reachable *on the fast path*; a user who fills every field is
  slower than before. Accepted, because the slow path was previously behind a disclosure most people
  never opened, so its fields were effectively unreachable rather than fast.
- **`DocumentForm` now has two callers with different shapes** — the wizard and the full-page edit
  screen. The edit screen is *not* a wizard and must not become one: editing is a review of a record
  that already exists, and stepping through it would hide the field you came to change.
- **The step machine is state that can desynchronise from the data.** Skipping forward past a step and
  coming back must not clear what was typed, and changing a preset must not invent data — the
  `carryNum` rule from ADR-0026 (a reformat that would drop significant characters clears the field)
  now has to hold across a step boundary as well as within one.
- **A wizard is a place where "required" creeps back in.** The single most likely future regression is
  someone adding a validation guard to a step because a blank one looks unfinished. The guard against
  it is a test that walks both tracks pressing Skip on every skippable step and asserts a save.
