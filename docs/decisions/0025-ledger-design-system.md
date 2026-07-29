# ADR-0025: The Ledger design system

- **Status:** accepted
- **Date:** 2026-07-29
- **Supersedes:** the navigation plan recorded in `components/TabBar.tsx` (one tab per domain)

## Context

M1 shipped a working Documents app in the default shadcn/ui dark theme: a dark slate ground, a teal
`--primary`, `ui-sans-serif` throughout, and a two-tab bar. It worked, and it looked like every other
app built the same way — which for this product is a specific problem rather than a matter of taste.

The brief that produced this design put it plainly: **the user opens this app twice a month and wants
an answer, not an identity.** Three consequences fall out of that, and they are what the previous
theme could not express:

1. **Colour has exactly one job.** Whether a document is still valid, and how soon it stops being so.
   Anything else coloured is noise competing with the only signal that matters.
2. **The good state is the hard one.** A dashboard that says "nothing expiring in the next 90 days"
   is worthless twice a month: it answers a question the user did not ask. The old home screen did
   exactly this.
3. **Two-week intervals mean nothing is learned.** Every visit is effectively a first visit, so
   affordances must be visible and labelled rather than discoverable.

A design was worked up in Claude Design (`Life Manager.dc.html`) as an HTML/CSS/JS prototype plus a
design-system specification, and handed over for implementation. This ADR records the system it
specifies, the four places the implementation deviates from the prototype, and the decisions that go
beyond styling.

## Decision

**Adopt the Ledger design system**: warm paper, an ink-black hierarchy, a serif for what a human
wrote and a grotesk for what the machine says, and an accent-free palette where colour is spent only
on status.

The point of view is that this is a **register of dates that happens to hold scans**, so the system is
built like a printed ledger rather than like a filing cabinet.

### 1. The Now screen replaces the dashboard

Now always shows the **forward timeline** — the next expiry however far away — alongside what needs
doing. So the answer is never *nothing*; it is "nothing until 4 March".

This is the single change that makes an all-clear screen worth opening, and it is why `Horizon` has no
meaningful empty state: if there are no dated documents at all it renders nothing and the headline
carries the message.

It also collapses the old two-card layout. `domains/documents.md` §7 already recorded that *Needs
attention* (90 days) and *Missing a file* were what remained after two duplicate expiry cards were
merged; Now goes further and makes the timeline the frame rather than a third card.

### 2. Colour: three status hues, both themes at full parity

Semantic names only — there is no `--red-500` and no brand accent. Every token is named for its job.

| | Light (paper) | Dark (near-black) |
|---|---|---|
| `--paper` / `--raised` / `--sunken` | `#F7F5F0` `#FFFFFF` `#EFEBE3` | `#131311` `#1C1C19` `#0D0D0C` |
| `--ink` / `--ink-2` / `--ink-3` | `#15140F` `#4A4740` `#7C776C` | `#F2EFE8` `#B4AFA4` `#8A857A` |
| `--rule` / `--rule-2` | `#DFDAD0` `#C6BFB2` | `#2E2E2A` `#46453F` |
| `--status-ok` / `--status-soon` / `--status-late` | `#2C5B4A` `#8A5A12` `#96331F` | `#7FBFA4` `#E0B063` `#E88B72` |
| `--onink` / `--focus` | `#F7F5F0` `#2E5AA8` | `#131311` `#8FB4F2` |

Light is **paper, not white** — white plus a serif reads as a document *viewer*, and this is not one.
Dark is **warm near-black, never `#000`**, so the hairlines survive. `--status-none` is an alias of
`--ink-3`: the absence of a countdown is drawn as absence, in the same grey as any unfilled value,
never as a warning.

Dark is not an afterthought. A PWA opened at 11pm in bed is a real case, so both themes carry every
token name.

### 3. The expiry ladder: five states, readable in greyscale

Each state changes **four** things at once — the glyph's shape, the words, the type's weight, and its
case. **Colour is the fourth wheel, not the axle.**

| State | Glyph | Words | Type |
|---|---|---|---|
| `expired` | solid square — the only filled glyph | "Expired 6 weeks ago" | mono 500, UPPER, tracked — a stamp |
| `today` | hollow ring — the only circle, pulsing | "Expires today" | sans 600, sentence case |
| `near` ≤45d | gauge, 1 bar of 3 | "in 3 weeks" | sans 500 |
| `far` >45d | gauge, 3 bars of 3 | "in 8 months" | sans 400 — the quietest live state |
| `none` | a single dash | "No expiry" | sans 400 italic, muted |

**Shape alone separates all five**, which is what makes the ladder survive greyscale, colour
blindness and bright sun. The gauge is a fuel gauge for time; zero bars is never shown, because at
zero the *shape* changes instead.

**45 days is now the only threshold in the client**, replacing tiers at 30 and 90. One boundary, one
question. It decides a glyph and a sentence and **nothing else** — reminders fire at 90/30/7
server-side per `DEFAULT_LEAD_DAYS` (invariant 5). If the two disagree, the ladder is cosmetically off
and the reminders are still right.

### 4. Navigation: three tabs, forever — **this reverses the previous plan**

**Now · Documents · Add.** Permanently visible, always labelled.

`TabBar.tsx` previously committed to growing one tab per domain — "the shape M4 needs — Home ·
Documents · Assets · Money". **That is withdrawn.** Domains never become tabs. When assets, money,
people and the vault arrive, the *middle tab's title* becomes a domain switcher: one tap on
"Documents ⌄" swaps the collection under the same search, the same filters, the same row. Tab count
stays three at six domains.

Now stays a single **cross-domain deadline feed** — a car's MOT and a passport's expiry belong in one
list, and that is the cross-domain payoff the dashboard exists for.

**The switcher must not be drawn until the second domain exists.** One domain, no chevron. Honest,
never decorative.

Add is a tab rather than a floating button so it cannot be mistaken for decoration, and it **opens a
sheet rather than navigating**: capture is something you do on top of what you were looking at.

### 5. Capture: launch to saved in under five seconds

Title is the only required field (Q2, unchanged), drawn as **weight not an asterisk** — a 1.5px
`--ink` border where every other field gets 1px `--rule-2`. On a form where everything else is
optional *forever*, an asterisk on one field implies the others were merely not-yet-starred.

Save is enabled from the **first character** and dims only at zero, so nobody has to look at the
button to find out whether they are finished. The sheet stays open after a save and swaps to three
optional next steps plus Done — never a dead end, never a demand.

### 6. Push: earned, and three distinct kinds of "no"

The ask appears only once a document with an expiry exists, so it names **a real date the user just
typed**. "Not now" hides it permanently.

- **No keys** — the feature vanishes entirely. No card, no toggle, no greyed-out row, no mention.
- **Unsupported** — one muted line, no button, because nothing tappable would help.
- **Denied** — the literal Settings path, plus "Until then, this screen is the reminder."
- **Granted** — the card disappears; the notifications themselves are the feedback.

### 7. Components

Hairline, not shadow. `--e-0` is a 1px rule, and **only two things lift**: the add sheet and the
toast, the two things temporarily on top of your life.

- **No dropdowns anywhere.** Seven document types is a wrapping row of pills. A native `<select>` on
  a 390px screen opens an OS wheel that is *worse* than the options already being visible.
- **Destructive is text in `--status-late`, never a red block** — a filled red button would make
  "delete" the loudest thing on a screen whose subject is a passport.
- **Alerts are inline, never modal.** Nothing here is urgent enough to block on, and a modal removes
  the context that explains it.
- **Empty states are never illustrations** — a sentence in the serif, one instruction, one control.
- **Skeletons are first-paint only.** A refresh keeps the stale list and dims nothing.

### 8. Accessibility

- Focus is a 2px `--focus` ring at 2px offset on **every** interactive element, including list rows —
  they are tabbable, not merely tappable. Declared globally, because the one element whose focus ring
  gets forgotten is always the one nobody remembered to style.
- **Status is announced as text.** Every glyph is `aria-hidden`, and a row's accessible name is
  "Passport — expires in 6 weeks, 12 September 2026" — the distance *and* the absolute date, because
  a screen-reader user gets no tooltip and no second glance at the glyph.
- Under `prefers-reduced-motion` the sheet appears without translating and the "expires today" ring
  stops pulsing.
- Type is in `rem` and rows are `min-height` rather than `height`, so 200% text grows a row instead
  of clipping it.
- At 430px nothing reflows: the gutter opens 22→26px, the display steps 30→31px, and the horizon shows
  five entries instead of four.

## Where the implementation deviates from the prototype

The prototype is a comp, not production code — the handoff brief says to recreate its *visual output*,
not its internals. Four deviations are substantive enough to record:

1. **Fonts are self-hosted, not loaded from `fonts.googleapis.com`.** A CDN `<link>` means the type
   falls back to Georgia/system-ui exactly when the app is offline, which is the case ADR-0013 exists
   to serve — and it adds a third-party origin to an app that otherwise talks only to its own API.
   Newsreader + IBM Plex Sans/Mono are vendored via `@fontsource`, latin subsets only, at the weights
   the design uses. All three are **SIL OFL 1.1**, which is neither on the org's allowed list (that
   list covers software licences) nor on its prohibited one; OFL permits embedding and redistribution,
   which is the grant needed here.
2. **`span()` was fixed, not ported.** The comp switched from months to years at 18 months and left
   the year count unpluralised, so 547 days rendered as **"1 years"** — ungrammatical, and it
   *understated*, calling a year and a half "1 year". The months band now runs to 24 and the count is
   pluralised, which makes 2 the first reachable year value.
3. **The upload picker sheet is not built.** The comp drew "Take Photo / Photo Library / Choose File",
   and its own caption says what it is: *"The OS decides how you pick — we just take the file."* It is
   an illustration of the OS sheet. Building it would be three buttons that all open the same native
   input while pretending to be a system control. `documents.md` §7 already requires the native path.
4. **No "Other" pill on the type row.** `doc_type` defaults to `'other'`, so rendering all seven
   options put a filled ink **Other** pill on every untouched form — the row looked *answered* before
   the user touched it. Six pills, where "none selected" *is* `other`, matches how the rest of the app
   already treats it: "No type" on the detail screen, omitted from a row's meta line. The **filter**
   chip row keeps its Other option, because filtering *by* untyped documents is a real thing to want.

Two smaller ones: the comp's back link changed its own label depending on the previous screen (now
always "Documents" — a link that renames itself is harder to learn than one that names a fixed place),
and the theme toggle plus Sign out share the Now screen's date line, since the comp drew no settings
surface at all and `endSession` has to stay reachable because it purges the persisted cache.

## Alternatives considered

**Keep the shadcn/ui dark-only theme and restyle nothing.** Rejected: the palette had a teal
`--primary` used on every button, so colour was already spent on chrome rather than status — which is
the one thing this domain cannot afford. It also had no light mode at all.

**Replace the shadcn token names entirely.** Rejected. `styles.css` promised that keeping them means a
future `shadcn add <component>` drops in without a rewrite, and that promise is worth keeping. They
survive as **aliases** onto the ledger semantics, so a generated component arrives already wearing the
right clothes. `--color-destructive` maps to `--status-late` rather than to a second red.

**Radix (`@radix-ui/react-dialog`) for the add sheet.** Rejected: a new runtime dependency plus its
focus-management peer, for one component in one place. The four behaviours a dialog must get right —
Escape, focus trap, focus restore, scroll lock — are ~90 lines and are now individually tested. A
native `<dialog>` was also tried: `showModal()` gives all four for free, but its `::backdrop` cannot
be animated in step with the sheet in Safari, and a bottom-anchored `<dialog>` fights
`env(safe-area-inset-bottom)` because the top layer is outside normal flow.

**Five or six tabs, one per domain.** Rejected — see §4. At two-week intervals the user relearns the
bar on every visit, so three labelled tabs is one glance and six is a menu.

**Colour-coding the seven document types.** Rejected: seven type-colours is a code nobody learns in a
session every two weeks, and it would spend colour on classification rather than on urgency.

**A `prefers-color-scheme` media query instead of stamping `data-theme`.** Rejected: covering "the
system prefers dark and the user has not chosen" in CSS alone means repeating the entire dark palette
inside a media query, and a duplicated palette is a palette that drifts. Resolution happens in
`lib/theme.ts`, mirrored by a pre-paint inline script in `index.html`.

**Server-side filtering for the horizon.** Rejected, and this is the one place the app filters
client-side on purpose. The horizon needs a **lower** bound on `expires_on` and
`documentListQuerySchema` has only `expiring_before`. The options were a new query parameter used by
exactly one screen, or a second overlapping request whose rows must be subtracted from the first —
which is the "two cards that duplicated each other" bug in a new costume. `useLedger` fetches one
page sorted `expires_on asc` and partitions it; see that module's note.

## Consequences

**Good**

- Colour now means one thing, so the expiry state is legible before any text is read.
- The all-clear screen answers a question. "Nothing until 4 March" instead of "nothing".
- Light and dark at parity, following the system by default.
- The ladder survives greyscale, which is also what makes it survive a screenshot in a bug report.
- One request feeds the Now screen and the tab bar's badge, replacing two lists plus a push key.
- The whole archive lands in the offline cache on a visit to Now — precisely ADR-0013's use case.
- Real upload progress: `api.files.upload` moved to `XMLHttpRequest`, because `fetch` cannot report it
  and a 6MB scan on a phone is the app's slowest operation by an order of magnitude.

**Costs and risks**

- **Three font families, ~183KB of woff2 precached.** Self-hosting is what buys offline type; the
  non-latin Newsreader subsets are excluded from the precache via `globIgnores`.
- **`cn()` now needs the theme's scales declared.** `tailwind-merge` cannot tell `text-onink` (a
  colour) from `text-row` (a size), so it treated them as conflicting and the size won — which shipped
  a primary button rendering **ink on ink**, with correct DOM and a correct accessible name. The same
  hazard in reverse applies to the radius and named-spacing scales, where unrecognised names conflict
  with *nothing* and a `className` override silently coexists instead of winning. `lib/utils.ts`
  declares all three; `utils.test.ts` walks them. **Adding a `--text-*`, `--radius-*` or `--spacing-*`
  token without adding its name there reintroduces the bug for that class.**
- **Four bugs in this work were found only by looking at it**, not by any test: the ink-on-ink button,
  a chevron missing from the first row of every grouped card, a push ask offering to notify about a
  date six weeks in the past, and a file row clipping "Version 1" to "Versi…". Every one had correct
  markup and a correct accessible name. This is debt **D37**'s whole point and it earns its keep —
  render the thing at 390px before calling it done.
- The design system is now spread across `styles.css` (tokens), `ExpiryStatus.tsx` (the ladder) and
  `components/ui/` (primitives). There is no living style-guide page, so this ADR is the specification.

## Open items

Not blocking, and deliberately not built:

1. **No restore endpoint, so no Undo.** The comp's delete toast offered one and its detail screen said
   *"Recoverable for 30 days"*. `DELETE /documents/:id` is a **soft** delete — it sets `deleted_at` and
   every repository query filters it — so the row survives, but there is no route back and no job
   enforcing 30 days. Both would have been promises the system does not keep, so the copy says what is
   true and `Toast`'s `action` prop is unused. A real restore endpoint is API work.
2. **The saved step's "Add an expiry date" opens the detail screen** rather than reopening the form as
   the comp did. `DocumentForm` *creates*, so reopening it after a save and submitting again would POST
   a second document. Wiring it to PATCH the just-created row is the follow-up.
3. **No settings screen.** The theme toggle and Sign out share the Now screen's date line. Once there
   is a third such control they want a home of their own.
4. **Still to draw**, from the design's own second-pass note: the deleted-items recovery screen, and
   the second-domain (assets) shape that would prove the switcher in §4 stretches.
5. **The ledger footer's totals are exact only when the archive fits one page** (100 rows). The API has
   no count endpoint, so beyond that the footer says "100+" rather than a total. A facet/count response
   would fix it properly.
