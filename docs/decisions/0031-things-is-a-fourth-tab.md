# ADR-0031: Things is a fourth tab

- **Status:** accepted
- **Date:** 2026-07-30
- **Supersedes:** the navigation decision in [ADR-0029](0029-the-things-domain.md) (the domain
  switcher), and the *three tabs, forever* rule in [ADR-0025](0025-ledger-design-system.md) §4
- **Superseded by:** [ADR-0032](0032-one-library-tab.md) — the bar is `Now · Everything · You` and
  the two collections share one screen. **What this ADR fixed is preserved rather than undone**:
  Things is still one tap from anywhere and is not hidden behind Documents. What 0032 changes is that
  the domains stop being separate *screens* at all, which is a shape this ADR did not consider — it
  weighed a fourth tab against a switcher between two screens, and the merged list is neither. Its
  *What happens at domain three* section, its measurement procedure, and its two navigation rules
  (no dropdown; navigation is `<Link>`s with `aria-current`) all still hold. The body below is left
  exactly as accepted (ADR-0015): read 0032 for what changed and why.

## Context

The tab bar is `Now · Documents · You`, and Things reaches the user through a row of segmented
pills under the Documents and Things titles (`components/DomainSwitcher.tsx`). Two written
decisions put it there:

- **ADR-0025 §4** decided *"three tabs, forever"* and *"domains never become tabs"*, on the
  grounds that a user who opens the app at fortnightly intervals relearns the bar every time, and
  three labelled tabs is one glance. It also promised the switcher *"appears the day the second
  domain does"*.
- **ADR-0029** honoured that promise when Things arrived, and stated the cost outright: **"Things
  is two taps from Now rather than one."**

Three facts now sit against that.

**1. The comp shipped both variants and defaulted to the tab.** Handoff 4 carries a
`thingsNav: "tab" | "switch"` knob, and `docs/design/Life-Manager-handoff-4.dc.html:2418` reads
`showThingsTab: (this.props.thingsNav ?? "tab") === "tab"`. The four-tab bar — with a Things glyph
of two bottom-aligned rectangles at lines 916–919 — is what the design renders when nobody touches
a knob. The switcher was the non-default branch.

**2. The switcher was chosen on the strength of an older ADR, not on the design's own default.**
ADR-0029 § *Alternatives considered* rejects "a fourth tab — the comp's own default" with
*"ADR-0025 §4 decided this in advance and the reason still holds"*. That is an argument from
precedent. The design's own default was treated as the thing needing justification, and the
two-year-old-by-project-standards rule as the thing that did not.

**3. The maintainer has now looked at the shipped app and reported it wrong.** They opened it,
found Things living on the Documents screen, and said that does not match the design. ADR-0029
wrote its own reopening condition:

> If real use shows the switcher is too quiet, that is a superseding ADR with evidence, not a
> re-litigation of the same argument.

This is that. The evidence is a person using the app and not finding the domain — which is exactly
the failure mode "two taps from Now rather than one" predicted and accepted.

## Decision

**The tab bar is `Now · Documents · Things · You`.** Four tabs, permanently visible, always
labelled, in the comp's order. `/things` and `/things/$thingId` both light the Things tab.

**`DomainSwitcher` is deleted.** Not left unreferenced — an unused component whose docstring argues
at length for a rejected approach is precisely what misleads the next session. The pill row comes off
`documents.index.tsx` and `things.index.tsx`; the reasoning worth keeping is preserved here and in
[design.md §8](../conventions/design.md).

**Two properties of the switcher survive it, because they are rules about navigation and not about
pills:**

- **No dropdown, ever, including in navigation.** ADR-0025 §4's mock drew `Documents ⌄` — a chevron
  menu. design.md §6's no-dropdowns rule applies to navigation too: a menu that must be opened to
  reveal a choice that would fit on screen costs a tap and hides the options. If a switcher returns
  (see below), it returns as a visible row, not a menu.
- **Navigation is `<Link>`s with `aria-current="page"`, never buttons calling `navigate`.** A button
  has no href, cannot be long-pressed or opened in a new tab, and `selected`-style styling announces
  nothing. `TabBar` already does this; whatever replaces it must too.

**What ADR-0025 §4 got right, and what is being traded away.** The argument was never wrong, it was
outweighed. At fortnightly usage a smaller bar *is* easier to relearn, and four tabs at 390px is
**84.5px** of width each where three tabs had **115px**. We are spending real legibility headroom on
discoverability, and the measurement that the spend is affordable is in *Consequences* — it was
taken, not assumed.

### What happens at domain three

This is the part ADR-0025 §4 got wrong by over-committing, and repeating the shape of that mistake
one slot later would be worse than making it the first time. So, plainly:

**There is no claim that four tabs is the final number.** Four fit, measured. Five is marginal and six
does not fit at all — the bar's own padding is fixed (`px-3.5` plus an 8px gap per seam), so at 390px a
slot is 84.5px at four tabs, **66px at five**, and **54px at six**, against a "Documents" label that
renders **63px**. Five leaves three pixels; six truncates.

[roadmap.md](../roadmap.md) has **Money** (M4 step 4), the **Vault** (M5), and **People** and
**Notes** (Beyond). If every one of those became a tab the bar would hold six domains plus Now and
You, which is not a bar. So the plan, in order of what we expect to actually happen:

1. **The Vault is probably not a collection tab at all.** It is gated behind an unlock
   ([ADR-0010](0010-vault-key-hierarchy.md)) and is a different kind of place from a browsable
   archive. A tab that is usually locked is a tab that is usually a dead end. Most likely it lives
   under You, or gets a place of its own with its own rules.
2. **When a domain arrives that will not fit, the switcher pattern returns — inside a tab.** The
   pattern is recorded above and in design.md §8 for exactly this reason: deleting the component is
   not rejecting the idea. The likely shape is that the *domain-holding* tab carries a visible row of
   domains beneath its title, with the two or three most-used domains still reachable in one tap from
   the bar.
3. **The trigger is a measurement, not a count.** Add a tab, render the bar at 390px in both themes
   and at compact density, and read the longest label. When a label truncates, wraps, or a tab drops
   below `--tap-min` in *width*, the bar is full and step 2 applies. That check is written into
   design.md §8 so the next session runs it instead of arguing about it.

**Do not read this ADR as "four tabs, forever".**

## Alternatives considered

- **Keep the switcher and make it louder** — a larger pill row, or move it above the title.
  Rejected because the reported problem is not contrast, it is *location*: Things was on the
  Documents screen, so finding it required first knowing to go to Documents. No amount of weight on
  a control fixes a control the user never reaches. And the comp already drew the answer.
- **Ship `thingsNav` as a fourth Feel preference.** Rejected for the reasons ADR-0029 gave and they
  still hold: [design.md §12](../conventions/design.md#12-feel-preferences) defines Feel as three
  device-scoped preferences that each move a *different kind of thing* (tokens, tokens, prose); a
  navigation preference is a fourth kind, doubles the layout surface, doubles every Things test, and
  asks the user to decide something the design should have.
- **Amend ADR-0029 rather than supersede it.** The index's amendment rule is narrow: clarifying or
  widening a decision *that has not been acted on yet*, where the conclusion is unchanged. Both
  halves fail here — the switcher shipped and ran, and the conclusion is reversed. ADR-0015 is
  unambiguous: supersede, never edit in place. So neither ADR-0029's nor ADR-0025's body is touched;
  each gets a status line pointing here.
- **Four tabs *and* the switcher**, on the grounds that redundant paths are cheap. Rejected: two
  controls that do the same navigation is two things to keep in sync and two answers to "where am
  I". The pills' `aria-current` and the tab's `aria-current` would both claim the page.
- **Rename the tab to something shorter than "Things" to buy width.** Nothing to buy — "Things" is
  6 characters against "Documents"' 9, and it is the design's own word and the domain's name
  everywhere in the codebase and docs ([glossary.md](../glossary.md)). The width problem, if it
  ever appears, is "Documents", and shortening *that* is a design decision for the maintainer, not
  a width optimisation.

## Consequences

**Good:**

- Things is one tap from anywhere, which is what the reversal buys back and the whole reason for it.
- The app matches the comp's default instead of its non-default branch, so the next session comparing
  the two finds them in agreement rather than finding a deviation it has to look up.
- One navigation control instead of two. `documents.index.tsx` and `things.index.tsx` lose a shared
  dependency, and the header of each is the title, the count and the filters — nothing structural.
- The bar is now honestly the answer to "where does a domain live", so `TabBar.tsx`'s block comment
  stops being a long argument against the code around it.

**Bad, and real:**

- **Four tabs at 390px is 84.5px each, and "Documents" is the longest label in the bar.**
  Measured before shipping, not assumed (design.md §10): at 390px in light, dark, compact density and
  the grotesk heading face, the Documents label renders **63px in an 84.5px slot** on one line and does
  not truncate or wrap; `scrollWidth === clientWidth` on every label; every tab is 84.5×52, so it
  clears 44px in **both** axes. Compact is identical to generous because the bar pads itself with a
  fixed `px-3.5` rather than `--gutter`. At 430px the slot is 94.5px. At **360px** — narrower than the
  design's target, but a real Android width — it is 77px and still fits, with 14.5px of slack.
  So the tightest real case has **~22px of slack**: real, but not comfortable. A fifth tab spends it.
- **A rule that said "forever" has now been broken twice** — once by ADR-0029's own admission that
  the comp disagreed, and once here. The lesson recorded, not just the reversal: *"forever" was never
  a decision, it was a prediction*, and this ADR deliberately declines to make another one.
- **Two ADRs are now superseded in part rather than in whole.** ADR-0025 stays accepted — its
  tokens, its ladder and its type system are untouched — with §4's tab rule marked superseded here.
  That is the second partial supersession on ADR-0025 (§4's tab *names* were already amended by the
  second handoff), and a third would be a sign the ADR is doing too many jobs.
- **`DomainSwitcher`'s tests go with it.** Two assertions in
  `features/things/things.test.tsx` (`aria-current` on the current domain; the labelled `Domain`
  landmark) are deleted rather than migrated, because their subject no longer exists. The equivalent
  claims for the bar live in `TabBar.test.tsx`.

**Revisit if:** a domain arrives whose tab does not fit — the measurement in *What happens at domain
three* step 3 is the test, and the switcher pattern in *Decision* is the answer. Or if real use shows
a four-tab bar is harder to relearn than a three-tab one, which is the cost ADR-0025 §4 named and
this ADR is knowingly paying.
