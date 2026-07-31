# ADR-0032: Documents and Things share one tab

- **Status:** accepted
- **Date:** 2026-07-31
- **Supersedes:** the navigation decision in [ADR-0031](0031-things-is-a-fourth-tab.md) (the fourth
  tab)
- **Superseded by:** [ADR-0033](0033-handoff-5-the-rest.md), **in part** — only § *Deviation*, the
  filter chips, which came off once the maintainer confirmed search alone is enough. That was this
  ADR's own stated reopening condition. The navigation decision, the merged `All` ordering, the scope
  pills and the Add picker all stand. The body below is left exactly as accepted (ADR-0015).

## Context

The tab bar is `Now · Documents · Things · You`. It got its fourth tab yesterday: ADR-0031 reversed
ADR-0029's domain switcher on the evidence that the maintainer opened the shipped app and could not
find Things, because it lived under the Documents title.

**Design handoff 5 changes the shape rather than the count.** It does not restore the switcher and it
does not keep four tabs. It draws `Now · Everything · You`, where the middle tab is **one screen
holding both collections** — a single dated list of documents and things, with `All / Documents /
Things` pills narrowing it. Its own `libDefault` knob defaults to `all`, so the merged list is what
the design renders when nobody touches anything.

Three things make this a different question from the one ADR-0031 answered, rather than a
re-litigation of it a day later.

**1. The failure ADR-0031 fixed does not come back.** That ADR's evidence was *location*: Things was
reachable only by first going to Documents, so finding it required knowing to look there. Under the
merge Things is not behind Documents — both are behind a tab named for containing everything, and the
default view shows both at once. Things is still one tap from anywhere, which is exactly what
ADR-0031 bought and this preserves.

**2. `All` is a view neither screen could render.** This is the part that is genuinely new. A
household's records are one pile: the car and its insurance, the geyser and its warranty, the
passport and the trip it is for. Two screens meant the answer to *"what do I need to deal with?"*
lived in two places and had to be assembled by the reader. `Now` already solved this for the near
horizon and design.md §8 states the principle — *"a car's MOT and a passport's expiry belong in one
list"*. The archive was the one place still organised by domain rather than by date.

**3. The cost ADR-0031 knowingly paid is refunded.** It measured four tabs at **84.5px** each against
a 63px "Documents" label and called the ~22px of slack *"real, but not comfortable"*, noting that a
fifth tab spends it. Three tabs is **115px** a slot. The bar goes back to having room, which matters
because [roadmap.md](../roadmap.md) still holds Money, the Vault, People and Notes.

## Decision

**The tab bar is `Now · Everything · You`.** Three tabs, permanently visible, always labelled.

**`/library` is the screen**, with `?scope=all|documents|things` in the URL. `/documents` and
`/things` become redirects into the matching scope, carrying their search params across — the PWA is
installed on a real phone and can hold a saved URL, and the Now screen's no-scan nudge deep-links into
`?scan=no`. The detail routes are unchanged: `/documents/$documentId` and `/things/$thingId` keep
their own addresses, and **both light the Everything tab**, so `Tab.match` is a list of prefixes
rather than one.

**`All` interleaves the two collections by the date that bites first** — a document's expiry, a
thing's earlier of cover-end and service-due (`features/library/mergeRows.ts`). Undated records sort
last, not first: the obvious implementation substitutes an empty string for "no date" and puts a
marriage certificate and a sofa at the top of a list headed by urgency.

**The scope pills are `<button>`s, not `<Link>`s, and that is not a breach of design.md §8's
navigation rule.** That rule governs movement between *places*: a tab is a destination and must carry
an href. These filter one list on one route — same screen, one search param — where `aria-pressed` is
the correct announcement. Making them links would put three addresses for one place in the history
stack, so Back would walk the user pill by pill instead of leaving the library.

**Add asks which track.** design.md §8's *"each domain keeps its own Add"* was a rule about two
screens: on Things the pill opened the thing wizard, on Documents the document one. There is one pill
now, above a list holding both kinds, so it opens `AddPicker` — a two-option sheet. **It is a fork,
not a seventh wizard step**: [ADR-0030](0030-capture-as-a-stepped-wizard.md) fixes capture at six
steps with exactly one required field per track, and folding this question into `CaptureSheet` would
add a second required answer, which is the regression that ADR exists to prevent. The doors that
already know their track — a thing's own screen, a papers checklist — skip the picker.

**Search folds behind a toggle.** The merged header carries a title, a count, a scope switch and
(under Documents) a filter row; a permanent 48px field on top of that is 48px of chrome above the
first result on every visit, including the many that are browsing rather than looking something up.
The button stays lit while a query is set and the summary line stays drawn, so folding it can never
hide the reason a list is short.

### Deviation: the per-domain filters stay, and the comp deletes them

Handoff 5's library header draws the scope pills and nothing else. It removes the Type / Tag /
Expiring-before / Whose / Has-scan chip row **and** the Things kind chips. We are keeping both, drawn
per scope — document filters under Documents, kind chips under Things, neither under All.

design.md's standing rule is that the comp wins unless there is a hard reason. It is stated for cases
where the comp *shapes* something and the code disagrees about the shape. Here the comp removes
working, shipped function, and three specific things would break:

- The Now screen deep-links into `?scan=no`. Deleting the filter deletes the destination.
- [documents.md](../domains/documents.md) §4 rule 13 specifies the Whose filter, and no ADR retires
  it. A design that drops a control does not by itself supersede a domain rule.
- Removing them is not reversible cheaply — the panels, the URL contract and their tests all go.

Retiring them is a product call with a human yes (invariant 12), not a side effect of a nav change.
**Revisit if** the maintainer confirms search alone is enough; the chips come off in one commit.

## Alternatives considered

- **Keep four tabs and add an "All" scope to each.** Rejected: it puts the merged list on two screens
  and leaves the bar carrying two names for one place. The scope pills would then be doing the tab
  bar's job *and* the tab bar would be doing theirs.
- **Three tabs with the switcher navigating between two screens** — literally ADR-0029's
  `DomainSwitcher`. Rejected, and this is the distinction the whole ADR turns on: that control was a
  *second navigation system* competing with the bar, which is why ADR-0031 deleted it, and it could
  never render `All`. One screen with a filter is not two screens with a switch.
- **Follow the comp exactly and delete the filters.** Rejected above, and recorded as a deviation
  rather than quietly ignored.
- **Merge the row components into one.** The comp normalises documents and things through two
  functions into one row shape. Rejected: `DocumentRow` and `ThingRow` already draw the two shapes
  the comp's own `isDoc` / `isThing` branches draw, and they carry behaviour the other does not
  (ADR-0027's copy and reveal controls; the ownership tag). Collapsing them would be a large rewrite
  of two well-tested components to reach the markup they already produce. `DocumentRow` gained one
  prop — a 52px glyph column, so its titles line up with a thing's thumbnail in the mixed list.
- **Page the merged list.** Rejected: two cursors advancing independently under one "Load more" is a
  paging model with two sources of truth, and the failure it produces — rows appearing above where
  you are reading — is worse than a floor stated honestly in the footer. One page of each, and a
  footer that says so.

## Consequences

**Good:**

- One list answers *"what do I own and what needs dealing with"* without the user assembling it from
  two screens. That view did not exist before, at any tap count.
- Both domains stay one tap from anywhere — ADR-0031's win, kept.
- The bar has 115px slots again instead of 84.5px, so the next domain does not immediately force the
  measurement in design.md §8.
- One collection screen instead of two. The archive and the things list had drifted into two
  near-identical headers, two empty states and two paging stories; there is now one of each.

**Bad, and real:**

- **The bar has changed shape twice in two days**, and this is the third navigation ADR in four. That
  is a real cost to anyone holding a mental model of the app, and it is the direct consequence of
  building each handoff as it lands. The mitigation is that this one follows the comp's *default*
  rather than a knob, as ADR-0031 did.
- **`All` shows one page of each collection and stops.** With more than 20 documents the merged list
  is a floor, not a total. The footer says so, and the Documents scope still pages properly. A real
  merged pager needs a server-side union that does not exist.
- **Two extra queries on the library**, because both collections are fetched in every scope so the
  search summary can count across them and switching scope is instant. TanStack Query dedupes on the
  key, so the unfiltered reads share the Now screen's and the badge's fetches — but under a filter it
  is genuinely two requests where one screen used to make one.
- **`documents.index.tsx` and `things.index.tsx` are now redirect stubs**, which is a file whose name
  no longer describes what it does. Kept deliberately — see the note in each — but a reader looking
  for the archive finds a redirect and has to follow it.
- **design.md §8's "each domain keeps its own Add" is dead** as written, replaced by the picker.

**Revisit if:** real use shows the merged list is noise rather than signal — the tell would be the
maintainer habitually landing on All and immediately tapping Documents, which is `libDefault` pointing
at the wrong scope and is a one-line change. Or if a fourth domain arrives: the measurement in
design.md §8 is the test, and it now has room to pass.
