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
**1px hairline**, not a shadow; exactly two things lift. Light and dark are at **full parity**. Three
tabs, forever — domains are a switcher (§8).

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
  hairline and **no shadow** — see §5. A second emphatic control anywhere means one of them is wrong.
- **Destructive is text in `--status-late`, never a filled red block** — a red button makes "delete"
  the loudest thing on a screen whose subject is a passport.
- `--color-destructive` is an **alias** onto `--status-late`. Do not introduce a second red.

---

## 5. Elevation is a hairline

`--e-0` is `0 0 0 1px var(--rule)` and that is the whole inventory for ordinary UI. **Exactly two
things cast a shadow**, because they are the two things temporarily on top of your life:

- the add sheet — `--e-sheet`
- the toast — `--e-toast`

The Add pill is the case that tests this rule and does not break it: the comp drew it with
`0 8px 24px`, which would have made it a third. It ships on a hairline instead, because a *permanent*
control is not temporarily on top of anything — and the ink fill already separates it from any ground
it crosses.

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
  shows five entries instead of four. Row heights are unchanged: a taller row on a bigger phone just
  means more scrolling.
- **The page body never scrolls sideways.** Wide content gets `overflow-x: auto` on its own container.
- Do not touch the `@layer base` app-shell rules in `styles.css` without reading the comment on each
  one. Every rule removes a specific "this is a web page" tell, and each looks deletable to someone
  who does not know what it is for.

---

## 8. Navigation: three tabs, forever

**Now · Documents · You.** Permanently visible, always labelled.

**A tab is a place.** That is the rule the names follow from, and it is why Add is *not* one: it opens
a sheet and leaves you where you were, so it belonged on the surfaces it acts on — a text button in
the Now header, an ink pill on Documents — rather than in a bar of destinations. ADR-0025 §4 named the
third tab Add; the second design handoff replaced it with You, which is a place, and gave the account,
sign-out and theme controls the home §10 said they needed.

**Domains never become tabs.** When money, people and the vault arrive, the *middle tab's title* keeps
switching the collection under the same search, the same filters, the same row. Now stays a single
cross-domain deadline feed, because a car's MOT and a passport's expiry belong in one list. Tab count
stays three at six domains.

This reverses an earlier plan to grow the bar one tab per domain. See ADR-0025 §4 before proposing
tabs again.

### The switcher now exists, because domain two does

`apps/web/src/components/DomainSwitcher.tsx`. **Things arrived, so the control ADR-0025 §4 promised got
drawn** — segmented `Documents` / `Things` pills beneath the title, on both screens.

Three things about it:

- **It is a switcher, not a fourth tab, and the comp's default disagrees.** Handoff 4 draws both and
  ships a `thingsNav: "tab" | "switch"` knob defaulting to `tab` — while its own §4 prose still says
  "three tabs, forever". We ship the switcher, and
  [ADR-0029](../decisions/0029-the-things-domain.md) § *Alternatives considered* is where the argument
  lives. Cost, stated: Things is two taps from Now rather than one.
- **Pills, not a chevron menu.** ADR-0025 §4's mock drew a dropdown under `Documents ⌄`, which is right
  for six domains and wrong for two: a menu to choose between two things is a tap to reveal what could
  already be on screen. §6's no-dropdowns rule applies to navigation too. **Revisit at domain four**,
  where a row of pills stops fitting 390px — that is the trigger, and it is the same
  "draw it the day it is needed" discipline that kept the switcher itself unbuilt until now.
- **Each domain keeps its own Add.** The pill row swaps the collection *and* what the Add button
  captures, because inside a domain the answer to "what are you adding" is already known
  ([ADR-0030](../decisions/0030-capture-as-a-stepped-wizard.md)).

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
apps/web/src/components/ui/                  primitives: button chip input label card alert sheet toast skeleton
apps/web/src/components/TabBar.tsx           three tabs, forever (§8)
apps/web/src/components/DomainSwitcher.tsx   Documents / Things, drawn now domain two exists (§8)
apps/web/src/components/PhotoViewer.tsx      the full-screen image viewer for scans and photos
apps/web/src/features/documents/
  ExpiryStatus.tsx                           the expiry ladder — five states (§2)
  DocumentRow.tsx                            the row every document list is made of
  CaptureSheet.tsx                           the stepped wizard, both tracks (ADR-0030)
apps/web/src/features/things/
  CoverStatus.tsx                            the cover ladder — four states, the second and last (§2a)
  ThingRow.tsx                               the row every thing list is made of
```
