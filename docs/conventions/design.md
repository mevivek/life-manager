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
**Colour is spent only on expiry status** — there is no brand accent and adding one breaks the system
rather than extending it. Elevation is a **1px hairline**, not a shadow; exactly two things lift.
Light and dark are at **full parity**. Three tabs, forever.

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

`utils.test.ts` walks the exported `TEXT_SIZES` and `RADII` lists. Extend the list, and the test
covers the new token automatically. Debt **D42**.

---

## 2. The expiry ladder is the only status vocabulary

`apps/web/src/features/documents/ExpiryStatus.tsx`. **Never hand-roll a second one**, and never
render an expiry date without it.

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

## 3. Type: three families, three jobs

| Family | Job | Tokens |
|---|---|---|
| **Newsreader** (serif) | What a human wrote — titles, headlines, a document's name on the horizon | `text-display` `text-title` `text-serif-row` |
| **IBM Plex Sans** | What the interface says — rows, body, buttons, status | `text-head` `text-row` `text-body` `text-meta` |
| **IBM Plex Mono** | What the machine names — eyebrow labels, the last-four mask, serials, counts | `text-label` `text-mask` |

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
- **Destructive is text in `--status-late`, never a filled red block** — a red button makes "delete"
  the loudest thing on a screen whose subject is a passport.
- `--color-destructive` is an **alias** onto `--status-late`. Do not introduce a second red.

---

## 5. Elevation is a hairline

`--e-0` is `0 0 0 1px var(--rule)` and that is the whole inventory for ordinary UI. **Exactly two
things cast a shadow**, because they are the two things temporarily on top of your life:

- the add sheet — `--e-sheet`
- the toast — `--e-toast`

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
- **At 430px nothing reflows.** The gutter and the display size step up via tokens, and the horizon
  shows five entries instead of four. Row heights are unchanged: a taller row on a bigger phone just
  means more scrolling.
- **The page body never scrolls sideways.** Wide content gets `overflow-x: auto` on its own container.
- Do not touch the `@layer base` app-shell rules in `styles.css` without reading the comment on each
  one. Every rule removes a specific "this is a web page" tell, and each looks deletable to someone
  who does not know what it is for.

---

## 8. Navigation: three tabs, forever

**Now · Documents · Add.** Permanently visible, always labelled.

**Domains never become tabs.** When assets, money, people and the vault arrive, the *middle tab's
title* becomes a domain switcher — one tap swaps the collection under the same search, the same
filters, the same row. Now stays a single cross-domain deadline feed, because a car's MOT and a
passport's expiry belong in one list. Tab count stays three at six domains.

**Do not draw the switcher until the second domain exists.** One domain, no chevron. Honest, never
decorative: the control appears the day the thing it switches between does.

This reverses an earlier plan to grow the bar one tab per domain. See ADR-0025 §4 before proposing
tabs again.

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

## 11. Where things live

```
apps/web/src/styles.css                      tokens, both themes, the app-shell rules, keyframes
apps/web/src/lib/utils.ts                    cn() — the tailwind-merge class groups (see §1)
apps/web/src/lib/theme.ts                    light/dark resolution; index.html mirrors it pre-paint
apps/web/src/components/ui/                  primitives: button chip input label card alert sheet toast skeleton
apps/web/src/components/TabBar.tsx           three tabs, forever (§8)
apps/web/src/features/documents/
  ExpiryStatus.tsx                           the ladder — the only status vocabulary (§2)
  DocumentRow.tsx                            the row every list is made of
```
