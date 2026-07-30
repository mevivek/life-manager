# Design conventions

How the client is built visually. The system is **the Ledger**, decided in
[ADR-0025](../decisions/0025-ledger-design-system.md).

**That ADR is the *why*; this file is the *how*.** The ADR is a decision record and does not change
once accepted — so when a rule here turns out to be wrong or incomplete, fix it *here*. If the
underlying **decision** changes, that is a superseding ADR, not an edit to either file
([ADR-0015](../decisions/0015-docs-as-orientation.md)).

The dominant constraint is the same one `code.md` opens with: most changes will be made by sessions
with no memory of previous ones. So these rules favour **mechanically checkable** over tasteful, and
every one of them exists because getting it wrong produced a real bug.

---

## 0. The one-paragraph version

Warm paper, ink-black hierarchy. A **serif for what a human wrote** (titles, dates, headlines), a
**grotesk for what the machine says** (labels, status, controls), **mono for eyebrows and data**.
**Colour is spent only on status** — a document's expiry (§2) or a thing's cover (§2a), and nothing
else. There is no brand accent and adding one breaks the system rather than extending it. Elevation is a
**1px hairline**, not a shadow; three things lift (§5). Light and dark are at **full parity**. The bar
is **four tabs — Now · Documents · Things · You**, and how many it holds is a *measurement*, not a
promise (§8).

---

## 1. Tokens: never a raw value

Every colour, size, radius and duration comes from a token in the `@theme` block of
`apps/web/src/styles.css`. There are no hex codes, no `text-[13px]`, no `rounded-[10px]` in a
component.

| Need | Use | Not |
|---|---|---|
| Body copy | `text-body` | `text-[15px]` |
| A card ground | `bg-raised` | `bg-white` |
| Secondary text | `text-ink-2` | `text-gray-600` |
| A pill | `rounded-pill` | `rounded-full` |
| A revealed number | `text-number` | `text-[19px]` |
| The screen gutter | `px-gutter` | `px-5` |

Arbitrary values are permitted only where the value **is** the content — a progress bar's `width`, a
glyph's 13px box, a one-off `border-[1.5px]`. When you write one, say why in a comment.

### ⚠ Adding a token is a TWO-file change

**Adding a `--text-*`, `--radius-*` or named `--spacing-*` token to `styles.css` without also adding
its name to the class groups in `apps/web/src/lib/utils.ts` reintroduces a real bug for that class.**

`tailwind-merge` cannot tell `text-onink` (a colour) from `text-row` (a size). Left undeclared it
guesses, and it guesses wrong in **two opposite directions**:

- **Sizes look like colours** → they *conflict*, the later one wins, and the colour is silently
  dropped. This shipped a primary button rendering **ink on ink**: a black rectangle with invisible
  text, correct DOM, correct accessible name, passing tests.
- **Radii and named spacing look like nothing at all** → they conflict with *nothing*, so
  `cn('rounded-2', 'rounded-pill')` keeps **both** and CSS emission order decides which applies. A
  `className` override silently coexists instead of winning.

`utils.test.ts` walks the exported `TEXT_SIZES`, `RADII` and `NAMED_SPACING` lists. Extend the list,
and the test covers the new token automatically. Debt **D42**.

The feel work added two more traps of the same shape, both now declared and walked:

- **`--spacing-row-pad`, `-card`, `-stack`** (the density tokens) are named spacing, so `p-card`
  and `gap-stack` need their axes (`p`, `gap`, …) grouped or a `className` override coexists instead
  of winning.
- **`font-heading` (a family) and `font-face-h` (a weight)** both start `font-`, and tailwind-merge's
  built-in groups only know the stock names. Undeclared, a headline's family and a variant's weight
  land ungrouped and their precedence is emission order — so both are declared as their own groups.

---

## 2. The expiry ladder is the status vocabulary for a document

`apps/web/src/features/documents/ExpiryStatus.tsx`. **Never hand-roll another one**, and never render
an expiry date without it.

There is exactly one sibling — the **cover** ladder in §2a, for a thing's warranty, which is a
different kind of date and says so in shape and in words. Those two are the whole inventory.

Five states, and each changes **four things at once** — the glyph's shape, the words, the type's
weight, and its case:

| State | Glyph | Words | Type |
|---|---|---|---|
| `expired` | solid square — the only filled glyph | "Expired 6 weeks ago" | mono 500, UPPER, tracked |
| `today` | hollow ring — the only circle, pulsing | "Expires today" | sans 600, sentence case |
| `near` ≤45d | gauge, 1 bar of 3 | "in 3 weeks" | sans 500 |
| `far` >45d | gauge, 3 bars of 3 | "in 8 months" | sans 400 — quietest live state |
| `none` | a single dash | "No expiry" | sans 400 italic, muted |

**Colour is the fourth wheel, not the axle.** Shape alone must still separate all five — that is what
makes the ladder survive greyscale, colour blindness, and a phone in sunlight. If you add a state,
give it a new *shape*, not a new hue.

**No business rule goes in this file.** `NEEDS_YOU_DAYS` (45) decides a glyph and a sentence.
Reminders fire at 90/30/7 **server-side** from `DEFAULT_LEAD_DAYS`; the two are allowed to disagree,
and if they do the ladder is cosmetically off while the reminders stay right (invariant 5).

---

## 2a. The cover ladder is the SECOND status vocabulary, and the last one

`apps/web/src/features/things/CoverStatus.tsx`. **A thing's warranty is not a document's expiry**, and
this exists because reusing the expiry ladder for it would make the app lie in its loudest register —
[ADR-0029](../decisions/0029-the-things-domain.md).

A document that expires is *invalid*. A dishwasher whose warranty ended **keeps washing dishes**. So
cover gets four states, its own shape, and a boundary of its own:

| State | Glyph | Words | Tone |
|---|---|---|---|
| `active` | a **depleting bar**, proportional | "3 years left" | `--status-ok` |
| `ending` ≤60d | the same bar, low | "Ends in 6 weeks" | `--status-soon` |
| `ended` | the bar at zero | "Ended 20 Jan 2026" | `--status-late` |
| `none` | a **dotted rule**, no bar | "No warranty recorded" | `--status-none` |

Four rules, each with a failure mode:

1. **The bar is proportional and continuous; the expiry gauge is three discrete bars.** A warranty is a
   span with a start and an end; an expiry is a countdown to a cliff.

   ⚠ **This ladder does NOT fully survive greyscale, and that is a measured limitation rather than a
   claim.** A greyscale render of all four states shows `active` (a part-filled track) and `none` (a
   dotted rule, italic words) as unmistakable — but **`ending` and `ended` are near-identical**. The
   bar is proportional over the *whole* span, so a car bought in 2019 whose cover ends in 38 days
   draws **1.4% — a four-pixel dot** against `ended`'s empty track, and both sentences are the same
   weight and size. Only the words separate them.

   Read strictly, that is what rule 2 asks for ("the *words* are what carry the difference"), and the
   §2 expiry ladder's stronger promise — *shape alone separates all five* — is deliberately **not**
   made here. But do not repeat the stronger claim about cover: it is not true, and on the Things list
   two rows in different states can look the same. If this needs fixing, the fix is a **minimum
   floor** on the rendered bar for `ending` (so it can never approach zero) or a different shape for
   `ended` — not a hue, which is what greyscale is testing for in the first place.
2. **`ended` never says "Expired" and never pulses.** It states a date. `--status-late` is the palette's
   "past its date" hue and is correct; the *words* are what carry the difference.
3. **`COVER_ENDING_DAYS` is 60, `NEEDS_YOU_DAYS` is 45, and service urgency is 45.** Three numbers,
   two ladders, and this is not drift — each is a named constant beside the ladder that reads it, and
   the reasoning is in [domains/things.md](../domains/things.md) §4 rules 2 and 3. None of them fires a
   notification.
4. **A third status vocabulary is a smell.** Two exist. If a domain arrives whose dates fit neither,
   the question to answer first is whether it is really a new *kind* of date or a new *name* for one of
   these.

---

## 3. Type: three families, three jobs

| Family | Job | Tokens |
|---|---|---|
| **Newsreader** (serif) | What a human wrote — titles, headlines, a document's name on the horizon | `text-display` `text-title` `text-serif-row` |
| **IBM Plex Sans** | What the interface says — rows, body, buttons, status | `text-head` `text-row` `text-body` `text-meta` |
| **IBM Plex Mono** | What the machine names — eyebrow labels, the mask, a revealed identifier, serials, counts | `text-label` `text-mask` `text-number` |

**Every heading uses `font-heading` / `font-face-h`, never `font-serif` directly.** The
[Feel preference](#12-feel-preferences) *Headings* swaps the heading face between the serif and the
grotesk by moving `--face-h` — so a headline hardcoded to `font-serif` silently opts out of that
preference. `font-heading` resolves to the serif by default, so this changed nothing on screen; it is
purely what lets the preference reach the headline. The remaining literal `font-serif` in the codebase
is inside `styles.css` (the token definition) and the `--font-serif` fallback stack.

Rules that are not preferences:

- **Body never below `text-body`** (15px). **Inputs never below 16px** — under it, iOS Safari zooms
  the whole page on focus and breaks a fixed layout. `styles.css` enforces the input floor with
  `font-size: max(1rem, 16px)`.
- **All sizes in `rem`, never `px`**, and rows use `min-h-*` not `h-*`. At 200% system text a row must
  grow, not clip.
- **Eyebrow labels are `<Eyebrow>`, not `<Label>`, when they label no control.** A `<label>` with no
  `htmlFor` is announced by screen readers as a form label that then finds nothing.
- **Fonts are self-hosted** and must stay that way. A CDN `<link>` falls back to Georgia exactly when
  the app is offline, which is the case [ADR-0024](../decisions/0024-offline-writes-outbox.md) and the
  read cache exist to serve.

---

## 4. Colour is only for status

Three hues, each doubling as a background tint:

| Token | Means | Background |
|---|---|---|
| `--status-ok` | far / all clear | `--status-ok-bg` |
| `--status-soon` | inside 45 days | `--status-soon-bg` |
| `--status-late` | expired, or expiring today | `--status-late-bg` |

`--status-none` is an alias of `--ink-3` on purpose: the absence of a countdown is drawn as absence,
in the same grey as any unfilled value, **never as a warning**.

What this forbids:

- **No accent hue.** No brand colour to admire. The user opens this twice a month and wants an answer.
- **No colour per `doc_type`.** Seven type-colours is a code nobody learns at fortnightly intervals.
- **Exactly one control in the app is emphatic**: the Add pill on Documents. It is an ink fill with a
  hairline **and the comp's `--e-pill` shadow** — see §5. A second emphatic control anywhere means one
  of them is wrong.
- **Destructive is text in `--status-late`, never a filled red block** — a red button makes "delete"
  the loudest thing on a screen whose subject is a passport.
- `--color-destructive` is an **alias** onto `--status-late`. Do not introduce a second red.

---

## 5. Elevation is a hairline

`--e-0` is `0 0 0 1px var(--rule)` and that is the whole inventory for ordinary UI. **Three things
cast a shadow, and no fourth:**

- the add sheet — `--e-sheet`
- the toast — `--e-toast`
- the **Add pill** — `--e-pill`

**The pill was the exception this section used to claim it wasn't.** It shipped on a hairline for a
while, reasoned from ADR-0025 §3's "only the sheet and the toast lift" — but that sentence is the comp
*describing itself*, and the comp's own **drawing** puts `0 8px 24px rgba(10,10,9,.24)` on the pill on
**every screen it appears on** (handoff 4, lines 380 and 683). When a comp's prose and its drawing
disagree, the drawing is the design: the pill floats over a scrolling list, and the shadow is what keeps
its edge legible against whatever row it happens to be crossing.

`--e-pill` repeats `--e-toast`'s value, because the comp does. It is a separate token name so a change
meant for one of them cannot silently move the other.

The rule that survives is the one that matters: **a fourth shadow needs an argument**, and "it would
look nicer raised" is not one.

A card with a drop shadow claims to float above a screen it is actually part of. Group related rows
inside **one** bordered card with hairline dividers rather than giving each its own box — four
problems in four cards read as four sections.

---

## 6. Controls

- **No dropdowns anywhere.** A `<select>` on a 390px screen opens an OS wheel that is *worse* than the
  options already being visible. Seven document types is a wrapping row of `<Chip>`. If a set is
  genuinely unbounded (a date), use the native input for that type.
- **Everything tappable clears 44px** (`--tap-min`), including text-only buttons. `Button`'s `sm` size
  is *narrower*, not shorter.

  ⚠ **`Chip` does not, and this rule and `chip.tsx` currently contradict each other.** Measured at
  390px: a filter chip is **36px**, a form chip **40px**, `Tag` **30px**, and the reminder chip's `×` is
  **18×24** — the smallest target in the app. Those are close to the comp, which draws its filter pills
  at `min-height:36px` and its form pills at `40px` (handoff 4, lines 299–303 and 981). So the code
  matches the design and misses the floor this bullet states, and the two cannot both be right.

  **It is unresolved on purpose rather than quietly reworded.** Raising every chip to 44px changes the
  density of five screens and departs from the comp; softening this bullet to name the exceptions
  concedes a real accessibility floor. Whichever way it goes it is a maintainer's call — see the
  fidelity review's *needs a decision* list — and until then neither the rule nor the component should be
  edited to agree with the other by stealth. The `×` is the part worth fixing first regardless: it is
  below the floor on **both** readings.
- **Required is drawn by weight, not an asterisk** — `<Input emphasis>` gives a 1.5px `--ink` border.
  On a form where everything else is optional forever, an asterisk on one field implies the others
  were merely not-yet-starred.
- **A chip row is a `<fieldset>` with a `<legend>`**, not a `div role="group"`. The legend is
  announced before each pill, so "Type, Certificate" rather than a bare "Certificate".
- **Empty states are never illustrations** — a sentence in the serif, one instruction, one control.
- **A wizard step must be skippable, and the skip must be drawn.**
  [ADR-0030](../decisions/0030-capture-as-a-stepped-wizard.md) made capture six steps, and the single
  most likely regression is a guard added to a step because a blank one looks unfinished. **Exactly one
  field is required per track** — a document's `title`, a thing's lead field — and every enrichment step
  carries a visible *Skip for now* beneath the primary button. Q2 is unchanged; six steps must not
  become six required fields by ceremony.
- **A tap on a choice step advances it.** Picking a preset or a kind sets the value *and* moves on.
  "Choose, then press Continue" is two taps for one decision, and the capture budget (ADR-0025 §5) has
  no room for it.
- **Alerts are inline, never modal.** Nothing here is urgent enough to block on, and a modal removes
  the context that explains it.
- **Skeletons are first-paint only.** A refresh keeps the stale list and dims nothing; replacing real
  content with shimmer makes a working app look broken.

---

## 7. Layout

- The screen gutter is `--gutter` (22px, 26px at ≥430px). Rows that run full-bleed undo it with
  `-mx-gutter` and re-apply `px-gutter` to their content.
- **A page whose content can be short needs `flex-1` and a footer with `mt-auto`.** The app shell is
  `min-h-dvh`, so short content otherwise leaves a screen of dead space above the tab bar. This was
  reported from a real phone with one undated document — the emptiest real state, and the one every
  fixture missed. `routes/_authed/home.tsx` is the worked example. Two traps in it: `mt-auto` only
  works when the footer is a **direct child** of the growing flex column, so wrapping a body
  component that returns a fragment in a `<div>` silently restores the gap; and this applies only to
  a page with a **foot** — a list that simply runs out (Documents, an empty state) is meant to end
  where it ends, and stretching it would be worse.
- **A screen with too little content gets more content, not more stretch.** Pinning a footer to the
  foot relocates a void; it does not remove one. The Now screen at two documents had *every*
  space-filling section render nothing — empty horizon, absent notifications card — so the fix was to
  say something true in the gap (`Horizon`'s "nothing else has a date we watch", and
  `GettingStarted`), not to distribute the emptiness more evenly. **Before stretching a layout, check
  what returned `null`.**
- **An empty section has two reasons and usually two different answers.** `Horizon` renders nothing
  when no document is dated — the headline already said so, and repeating it is furniture — but a
  sentence when every dated document is *already urgent*, because "the horizon is empty" is then a
  fact rather than an absence. Collapsing both into one `if (rows.length === 0) return null` is how
  the blank half-screen shipped.
- **At 430px nothing reflows.** The gutter and the display size step up via tokens, and the horizon
  shows five **documents** instead of four. Row heights are unchanged: a taller row on a bigger phone
  just means more scrolling.
- **The horizon has TWO limits, not one** — `limitHorizon()` in `Horizon.tsx`. Documents are capped
  first (four, five at 430px, the bullet above), then thing events join and the **merged list is capped
  at six**, both widths. Handoff 4 applies both (`horizonDocs = …slice(0, 4)` at comp 2220, then
  `items.slice(0, 6)` at comp 1884); this shipped with only the first, so one thing with a warranty and
  a service could push every document off the timeline. The two caps fail in opposite directions and
  `Horizon.test.tsx` covers each: without the merged cap the list can exceed six rows, and without the
  document cap the six nearest documents fill it and a Things-owning household never sees Things on Now.
- **The page body never scrolls sideways.** Wide content gets `overflow-x: auto` on its own container.
- Do not touch the `@layer base` app-shell rules in `styles.css` without reading the comment on each
  one. Every rule removes a specific "this is a web page" tell, and each looks deletable to someone
  who does not know what it is for.

---

## 8. Navigation: four tabs — Now · Documents · Things · You

`apps/web/src/components/TabBar.tsx`. Permanently visible, always labelled, in the comp's order.
[ADR-0031](../decisions/0031-things-is-a-fourth-tab.md).

**A tab is a place.** That is the rule the names follow from, and it is why Add is *not* one: it opens
a sheet and leaves you where you were, so it belonged on the surfaces it acts on — a text button in
the Now header, an ink pill on each collection — rather than in a bar of destinations. ADR-0025 §4 named
the third tab Add; the second design handoff replaced it with You, which is a place, and gave the
account, sign-out and theme controls that §10 said they needed.

**Now stays a single cross-domain deadline feed** regardless of the tab count, because a car's MOT and a
passport's expiry belong in one list.

**Each domain keeps its own Add.** Inside a domain the answer to "what are you adding" is already known,
so Documents' pill opens the document track and Things' opens the thing track
([ADR-0030](../decisions/0030-capture-as-a-stepped-wizard.md)).

**A detail screen keeps its collection's tab lit.** `/things/$thingId` lights Things,
`/documents/$documentId` lights Documents — a `startsWith` match on the pathname. A bar that goes blank
one level down tells the user they have left the app's structure. `TabBar.test.tsx` renders both.

### How many tabs the bar holds is a measurement, not a promise

This section said **"three tabs, forever"** and **"domains never become tabs"** for two milestones, and
both are now wrong. The history is worth carrying, because the reasoning still applies to the *fifth*
tab even though the conclusion did not survive the fourth:

1. **ADR-0025 §4** withdrew an even earlier plan to grow the bar one tab per domain, and decided three
   tabs *forever*: at fortnightly usage a user relearns the bar every time they open the app, so a
   smaller bar is a real advantage. Domains were to be a switcher on the middle tab's title.
2. **ADR-0029** honoured that when Things arrived and shipped `DomainSwitcher` — `Documents` / `Things`
   pills beneath the title — naming its cost: *Things is two taps from Now rather than one.*
3. **[ADR-0031](../decisions/0031-things-is-a-fourth-tab.md) reverses it, on evidence.** The maintainer
   opened the shipped app and reported that Things living on the Documents screen did not match the
   design — the exact reopening condition ADR-0029 wrote for itself. Handoff 4's `thingsNav` knob
   defaults to `tab` and the comp draws the four-tab bar; the switcher was its non-default branch.
   `DomainSwitcher` is deleted rather than left unreferenced.

**Do not write "four tabs, forever".** Four fit, measured. The bar's padding is fixed (`px-3.5`, plus an
8px gap per seam), so at 390px a slot is **84.5px at four tabs, 66px at five, 54px at six** — against a
"Documents" label that renders **63px**. Five leaves three pixels; six truncates.
[roadmap.md](../roadmap.md) still has Money, the Vault, People and Notes.

**Before adding a fifth tab, run this — it is §10 applied to the bar, and it is the trigger:**

1. Render the bar at **390px**, in **both themes**, and at **`data-density="compact"`**.
2. Read the longest label. Today that is **Documents**: **63px in an 84.5px slot**, one line, ~22px of
   slack — *identical* in light, dark, compact and the grotesk face, because the bar pads itself with a
   fixed `px-3.5` rather than `--gutter`, so density does not move it. At 430px the slot is 94.5px; at
   360px it is 77px and still fits.
3. If a label truncates (`scrollWidth > clientWidth`) or wraps, or a tab drops below `--tap-min` in
   *width*, **the bar is full.** The answer then is the switcher **pattern**, returning inside the
   domain-holding tab — not a shorter label, and not a dropdown.

Two rules the deleted switcher leaves behind, because they are about navigation rather than about pills:

- **No dropdown, ever, including in navigation.** ADR-0025 §4's mock drew a `Documents ⌄` chevron menu.
  §6's no-dropdowns rule covers navigation too: a menu that must be opened to reveal a choice that would
  fit on screen costs a tap and hides the options. A switcher, if one returns, is a visible row.
- **Navigation is `<Link>`s carrying `aria-current="page"`, never buttons calling `navigate`.** A button
  has no href, cannot be long-pressed or opened in a new tab, and `selected`-style styling announces
  nothing to a screen reader. Exactly one tab may be current; two `aria-current`s is the app claiming
  two locations.

### Now is cross-domain, and shape is what separates the domains on it

The horizon merges thing events into the document timeline rather than sectioning them. A **square** dot
with a mono kicker ("Warranty ends", "Service due") is a thing; the existing **round** dot with no
kicker is a document. Two section headers would have been the easy version and would have destroyed the
one property Now has — that it answers *"what is next"* without asking which domain it is in.

---

## 9. Accessibility

- **Status is announced as text.** Every glyph is `aria-hidden`; a row's accessible name spells it out
  — `"Passport — expires in 6 weeks, 12 September 2026"`. Both the relative distance **and** the
  absolute date, because a screen-reader user gets no tooltip and no second glance at the glyph.
  `expiryAccessibleName()` builds it.
- **Focus is a 2px `--focus` ring at 2px offset on everything interactive**, list rows included — they
  are tabbable, not merely tappable. Declared once globally in `styles.css`, because the one element
  whose focus ring gets forgotten is the one nobody remembered to style.
- **A badge's meaning belongs on its control's accessible name**, not on the badge. `aria-label` on a
  role-less `<span>` is ignored by most screen readers and rejected by Biome's
  `useAriaPropsSupportedByRole` — it looks correct and does nothing.
- Under `prefers-reduced-motion` the sheet appears without translating and the "expires today" ring
  stops pulsing. The global reset in `styles.css` handles it; do not re-implement per component.

---

## 10. Verifying visual work

**Render it. Four bugs in this design system's own implementation were found only by looking**, every
one with valid markup, a passing suite and a correct accessible name: a button rendering ink on ink, a
chevron missing from the first row of every card, a push ask offering to notify about a date in the
past, and a file row clipping "Version 1" to "Versi…".

There is no visual regression testing (debt **D43**), so this is manual and it is not optional:

1. **390px, both themes.** That is the design's target width; debt **D37** is the record of what
   skipping it costs.
2. **The sparse state, not just the seeded one.** A twelve-document fixture hides everything the
   emptiest real archive shows. Test with **one undated document**, and with **zero**.
3. **The state each branch actually renders.** A component with five states needs five looks — a
   fixture that happens to hit one of them proves nothing about the other four.

Assert non-zero counts. `file_count` was 0 for the whole of M1 because every test expected 0 (debt
**D33**); the browser found it and the suite could not.

---

## 12. Feel preferences

Three device-scoped preferences set on the **You** screen — **Density**, **Headings**, **Voice**.
They default to what the app looked like before they existed (generous · serif · warm), so a user who
never opens the Feel card sees no change. Stored in `localStorage`, not the account, for the same
reason as the theme: someone may well want compact on a phone and generous on a laptop, and syncing
would drag them through the `persister.ts` allowlist for nothing. `lib/feel.ts` holds the
storage-and-DOM half; `lib/useFeel.tsx` the React half; `index.html` resolves density and face before
first paint, exactly like the theme.

Each is a **different kind of thing**, and that is the load-bearing distinction:

| Preference | What it moves | How |
|---|---|---|
| **Density** generous · compact | `--gutter` `--row-min` `--t-display` `--row-pad` `--card-pad` `--stack` | Pure token swap on `[data-density]`. The first three read straight through existing utilities; the last three exist *only* so density has something to change (they were `py-3.5`, `p-4`, `gap-5`). |
| **Headings** serif · grotesk | `--face-h` `--h-weight` `--h-track` | Token swap on `[data-face]`. Reaches every headline via `font-heading` / `font-face-h` / `tracking-heading` — a headline hardcoded to `font-serif` opts out. |
| **Voice** warm · plain | ~9 sentences | **Not** a token — CSS cannot rewrite a sentence. Threaded through `lib/voice.ts` and read by the components that speak prose. |

Rules that will bite a session that skips this section:

1. **Density and face apply as `data-*` attributes, never as inline `style.setProperty`.** The comp
   does the latter; copying it would beat the `@media (min-width: 430px)` block and silently kill the
   app's responsiveness, including in the *default* density. The `[data-density="compact"]` and
   `[data-face="grotesk"]` blocks come **after** the 430px query in `styles.css`, because equal
   specificity makes source order the tiebreak — that is what keeps compact holding at every width.
2. **Voice lives in one module so the *set* can be tested.** A ternary per call site would only ever
   exercise the plain register on whatever screen someone happened to open; `voice.test.ts` walks
   every sentence in both registers. **Plain must differ from warm, and never say less** — it may drop
   a reassurance, never a fact. Where warm says "Everything else is in order", plain gives the count.
3. **Voice is device state read as a value, so it is a React *context*, not a bare hook.** The setter
   is on You and the sentences are on Now; two `useState`s seeded from storage would agree only until
   one is set, and whether that showed up would depend on whether the router kept both mounted.
   `useFeel` falls back to the warm defaults outside a provider so bare component tests need no wrapper.
4. **The all-clear threshold is passed to `voice.clearTitle`, not hardcoded** — so the sentence
   follows `NEEDS_YOU_DAYS` and cannot drift from the glyph it sits beside.

---

## 13. Where things live

```
apps/web/src/styles.css                      tokens, both themes, the app-shell rules, keyframes
apps/web/src/lib/utils.ts                    cn() — the tailwind-merge class groups (see §1)
apps/web/src/lib/theme.ts                    light/dark resolution; index.html mirrors it pre-paint
apps/web/src/lib/feel.ts + useFeel.tsx       density / face / voice preferences (§12)
apps/web/src/lib/voice.ts                    the two copy registers (§12)
apps/web/src/components/ui/                  primitives: button chip input label card alert sheet toast skeleton stat
apps/web/src/components/TabBar.tsx           four tabs — Now · Documents · Things · You (§8)
apps/web/src/components/PhotoViewer.tsx      the full-screen image viewer for scans and photos
apps/web/src/features/documents/
  ExpiryStatus.tsx                           the expiry ladder — five states (§2)
  DocumentRow.tsx                            the row every document list is made of
  CaptureSheet.tsx                           the stepped wizard, both tracks (ADR-0030)
apps/web/src/features/things/
  CoverStatus.tsx                            the cover ladder — four states, the second and last (§2a)
  ThingRow.tsx                               the row every thing list is made of
  ThingPhotos.tsx                            the 172px hero AND the strip — the app's only <img> on render
apps/web/src/features/health/
  BuildCard.tsx                              what is deployed, both halves, and whether they agree
```

**One rule from the Build card generalises.** It renders `uptime_seconds` as *"Awake for 5 minutes"*,
never as a deploy time, because the API scales to zero and that number is the last cold start. **A
label must be one the value can carry**, and this codebase has now refused three comp elements on that
ground — the toast's *Undo*, You's *"encrypted at rest"*, and *"last deployed"*. When a design asks for
a fact the system does not hold, the fix is a truer label or an honest "unknown", never the nearest
plausible number.
