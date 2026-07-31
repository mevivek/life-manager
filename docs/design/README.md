# Design handoffs — the source comps

These are the **Claude Design handoff bundles** the Ledger design system was built from. They were
uploaded into agent sessions as zip files and lived only in a scratchpad until now — this directory
is where they are kept so a future session can see the design that was actually specified, not just
the code that resulted from it.

**They are the design's source of truth. [conventions/design.md](../conventions/design.md) is the
practical translation, [ADR-0025](../decisions/0025-ledger-design-system.md) is the *why*.** When
those disagree with a comp, that is usually a deliberate deviation recorded in one of them — read the
deviation before "fixing" the code to match the comp.

## The files

| File | What it is |
|---|---|
| `Life-Manager-handoff-1.dc.html` | First handoff — the Ledger system itself (warm paper, Newsreader + IBM Plex, colour only on status, the expiry ladder, three tabs) |
| `Life-Manager-handoff-2.dc.html` | Second handoff — replaced the **Add** tab with **You**; the 22-document preset chooser |
| `Life-Manager-handoff-3.dc.html` | Third handoff — the full document identifier, holders (*"Whose document is it?"*), and the three **Feel** preferences (density · headings · voice) |
| `Life-Manager-handoff-4.dc.html` | Fourth handoff — the **Things** domain (a second domain, pulled forward from M4), capture as a **stepped wizard**, a cross-domain horizon, and the document↔thing link. [ADR-0029](../decisions/0029-the-things-domain.md) and [ADR-0030](../decisions/0030-capture-as-a-stepped-wizard.md) |
| `Life-Manager-handoff-5.dc.html` | Fifth handoff, **the authoritative one** — the tab bar goes back to **three tabs** with Documents and Things merged into one **Everything** library ([ADR-0032](../decisions/0032-one-library-tab.md)), Add asks which track, search folds behind a toggle. It also carries a **People** sub-domain, a Google-only sign-in screen, an expanded You screen and a public vehicle plate, **none of which is built** — see *What handoff 5 changed* below |
| `Life-Manager-icon.dc.html` | The **app icon** handoff, a separate bundle from the screen comps. Three variants (ink · paper · green), the 1024-grid geometry, and the two rationale blocks — *why the shortest bar is amber* and *why no glyph*. `apps/web/public/favicon.svg` implements the **ink** variant; the paper and green ones are drawn but unshipped, and D61 says why. **Its "Production notes" are misleading about the inset** — they say 66px on a 1024 grid while the art it was drawn from is 22% horizontally and centres the bars vertically at ~32%. The SVG's comment records which was followed |
| `favicon-small-16px.svg` | **A proposal, not shipped.** The icon cut to two bars for 16–24px, where the three-bar mark's bars and gaps are ~1.1 device pixels each and merge into a smudge. Every value is a multiple of 64 — one device pixel at 16px — so it rasterises exactly. Wiring it is debt **D61** and needs a product call, because `favicon.svg` is also the raster source for the PNGs (`scripts/generate-icons.mjs`), where three bars read perfectly |
| `support.js` | The Claude Design player runtime, shared byte-for-byte across all five. The comps reference it as a sibling (`./support.js`), which is why one copy sits beside them |
| `image-slot.js` | The player's drop-an-image-here custom element, new in handoff 4 — it is how the comp fakes a photo on the Thing hero and on a document's scans. **Nothing in it is production code**: the shipped app puts real R2 files there ([ADR-0008](../decisions/0008-object-storage-r2.md)) |
| `HANDOFF.md` | The bundle's own README, verbatim — the "coding agents, read this first" note the tool ships |

Each handoff **supersedes the earlier one only for the parts it changed.** Handoff 5 is the one to
trust for anything current; the earlier four are kept because they show what a decision replaced (the
Add-tab-to-You move, the single-page capture form, the four-tab bar) and because a comp is cheaper to
read than to reconstruct.

**Handoff 5 is the first one this repo has NOT implemented in full**, so do not read it as a
description of the app. Its navigation half is built; its People half is not. The table below says
which is which, and it is the thing to check before assuming a screen exists.

## What handoff 4 changed, in one place

Read this before diffing 3 against 4 yourself — the file grew by 1300 lines and most of that is new
rather than changed.

**New:**

- **The Things domain.** A `Things` list and a `Thing` detail screen: thing kinds, warranty **cover**
  (deliberately *not* expiry — [ADR-0029](../decisions/0029-the-things-domain.md)), a service cycle
  with a log, ownership states (lent / handed on), a sum-insured card measured against the contents
  policy, a claim pack, and a vehicle's four-paper checklist.
- **The document↔thing link**, drawn from both sides: *Belongs to* on a document, *Its documents* on
  a thing.
- **A cross-domain horizon.** Thing events — a warranty ending, a service due — sit on the Now
  timeline beside document expiries, with a **square** dot and a mono kicker where a document has a
  **round** dot and none.
- **A full-screen photo viewer** for scans and thing photos.

**Changed:**

- **Capture is a six-step wizard**, on two tracks — `type → whose → title → number → dates → scan`
  for a document, `kind → name → detail → purchase → warranty → photo` for a thing. Handoff 3 drew one
  page with an *"Add more now (all optional)"* disclosure.
  [ADR-0030](../decisions/0030-capture-as-a-stepped-wizard.md).
- **A vehicle registration is two live formats, not one mask.** Handoff 3 masked `Vehicle RC` to
  `AA##AA####`; handoff 4's own comment says that made a Bharat-series plate (`22 BH 1234 AA`)
  untypeable. The series is now an explicit choice, and the number hint drops for it because two
  formats have no single length.
- **The Things nav is drawn twice**, and the prototype has a `thingsNav: "tab" | "switch"` knob
  defaulting to `tab`. **We ship the tab — the comp's default — and the bar is four tabs.**
  [ADR-0031](../decisions/0031-things-is-a-fourth-tab.md).

  That took two goes, and the detour is worth knowing about because it is the clearest example of how
  to read these comps. ADR-0029 first chose the **switcher**, reasoning from ADR-0025 §4's *"three
  tabs, forever"* and from the fact that handoff 4's own §4 prose *still says it*. But the prose was
  inherited unchanged from handoff 1 and the **drawing** had moved on — and when the maintainer opened
  the shipped app, they said Things being on the Documents screen did not match the design. **Where a
  comp's prose and its drawing disagree, the drawing is the newer statement of intent.** The same rule
  settled the Add pill's shadow: ADR-0025 §3's "only two things lift" is prose, and every screen of
  the comp draws the shadow.

## What handoff 5 changed — and what of it is BUILT

The comp is one screen-graph, so it does not distinguish shipped from unshipped. This does. **Check
here before assuming a screen exists.**

### Built ([ADR-0032](../decisions/0032-one-library-tab.md))

- **Three tabs again: `Now · Everything · You`.** Documents and Things merge into one `/library`
  screen with `All / Documents / Things` scope pills; `All` interleaves both by the date that bites
  first. The comp's `libDefault` knob defaults to `all`, and that is what ships.
- **A 2×2 grid glyph** for the Everything tab, replacing the Documents rectangle and the Things
  two-objects mark.
- **Add asks which track** — *"What are you adding?"*, two options, before the capture wizard. It is
  a fork, **not** a seventh wizard step (ADR-0030's one-required-field rule survives untouched).
- **Search folds behind a magnifier toggle**, with a per-kind match summary beneath it.

**Deviation, deliberate:** the comp deletes every filter chip — Type / Tag / Expiring-before / Whose /
Has-scan, and the Things kind row — leaving only the scope pills. We kept them, drawn per scope. The
argument is in ADR-0032 § *Deviation*; the short version is that the Now screen deep-links into
`?scan=no` and documents.md §4 rule 13 specifies the Whose filter, so removing them is a product call
with a human yes (invariant 12) rather than a side effect of a navigation change.

### Drawn but NOT built

None of this exists in the app. An empty screen where the comp shows one of these is not a bug.

- **A People sub-domain** — the largest of them. `People` under You, a person detail screen, an
  add/edit/remove sheet, and a *"Whose document is this?"* sheet on a document's detail. It turns
  `holder` from a free-text label into a **record**, which needs a `people` table, a repository, a
  service and endpoints — a domain, not a screen. Today `holder` is still the string
  [documents.md](../domains/documents.md) §4 rule 13 describes, and `GET /documents/holders` derives
  the list from the documents themselves.
- **A Google-only sign-in screen** — the comp drops the email and password fields entirely and
  replaces them with one *Continue with Google* button plus a reassurance line.
- **An expanded You screen** — *Things owned* and *Dates watched* stats, *Value of things*, *Out of
  cover*, *Elsewhere* rows, a *People* row, and Turn-on / Turn-off buttons on Reminders (today it is
  a status line).
- **A public vehicle plate** — the comp stops masking a vehicle's registration, on the reasoning that
  a plate is painted on the outside of the car, and draws it as a plate chip on both the row and the
  detail screen. Today a vehicle's `serial` masks like every other.
- **A row-level *Add scan* button**, and a `?` chevron on rows that have neither a number nor a file.

### Fixture changes that are NOT specifications

Handoff 5 relocates the fake data from Britain to India — `₹` and `en-IN`, Indian issuers, a Maruti
Swift, an AO Smith geyser. **This is a fixture change and nothing more.** The app already formats
money from the record's own `currency` rather than a hardcoded symbol (`features/things/money.ts`,
and `thing-detail.test.tsx` asserts it), so there is nothing to implement — and hardcoding `₹` to
match the comp would undo a deliberate decision. The comp's own `gbp()` helper being renamed to emit
`₹` is exactly the hardcoding we refused.

## Reading them

Three things the [`HANDOFF.md`](./HANDOFF.md) says, worth repeating:

- **Read the source, don't render it.** Every dimension, colour and rule is spelled out in the HTML
  and the inline `<script type="text/x-dc">` block (the seed data, the token overrides, the two voice
  registers). A screenshot tells you nothing the source doesn't — and these comps link
  `fonts.googleapis.com`, which our production build deliberately does **not** (it self-hosts, so the
  type survives offline; [design.md §3](../conventions/design.md)). So a rendered comp is *less*
  faithful to the shipped app than the source is.
- **They are prototypes, not production.** The job was always to recreate the visual output in our
  stack (React + Tailwind v4), not to port the prototype's internal structure. Several places where
  our code diverges from a comp are noted in `design.md` and the component files — the row markup
  (`<Link>` vs the comp's `div`+`onClick`), the "encrypted at rest" copy the comp claims and we
  refuse, the 90-day all-clear the comp shows and we render at 45.
- **The seed data is the tool's fake fixtures** — `rowan@hey.com` and eight British-priced products in
  handoffs 1–4, `rohan.mehra@gmail.com` and the same eight repriced in rupees in handoff 5. None of it
  is real, and none of it should be treated as a value to preserve. The `PRODUCTS` array is a
  *fixture*, not a spec: the shapes it demonstrates are what matter, and those are written down in
  [domains/things.md](../domains/things.md) §3. **The currency is the sharpest case** — see *Fixture
  changes that are NOT specifications* above before changing a symbol anywhere.
