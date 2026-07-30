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
| `Life-Manager-handoff-4.dc.html` | Fourth handoff, **the authoritative one** — the **Things** domain (a second domain, pulled forward from M4), capture as a **stepped wizard**, a cross-domain horizon, and the document↔thing link. [ADR-0029](../decisions/0029-the-things-domain.md) and [ADR-0030](../decisions/0030-capture-as-a-stepped-wizard.md) |
| `Life-Manager-icon.dc.html` | The **app icon** handoff, a separate bundle from the screen comps. Three variants (ink · paper · green), the 1024-grid geometry, and the two rationale blocks — *why the shortest bar is amber* and *why no glyph*. `apps/web/public/favicon.svg` implements the **ink** variant; the paper and green ones are drawn but unshipped, and D61 says why. **Its "Production notes" are misleading about the inset** — they say 66px on a 1024 grid while the art it was drawn from is 22% horizontally and centres the bars vertically at ~32%. The SVG's comment records which was followed |
| `support.js` | The Claude Design player runtime, shared byte-for-byte across all four. The comps reference it as a sibling (`./support.js`), which is why one copy sits beside them |
| `image-slot.js` | The player's drop-an-image-here custom element, new in handoff 4 — it is how the comp fakes a photo on the Thing hero and on a document's scans. **Nothing in it is production code**: the shipped app puts real R2 files there ([ADR-0008](../decisions/0008-object-storage-r2.md)) |
| `HANDOFF.md` | The bundle's own README, verbatim — the "coding agents, read this first" note the tool ships |

Each handoff **supersedes the earlier one only for the parts it changed.** Handoff 4 is the one to
trust for anything current; the earlier three are kept because they show what a decision replaced (the
Add-tab-to-You move, the single-page capture form) and because a comp is cheaper to read than to
reconstruct.

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
- **The seed data is the tool's fake fixtures** (`rowan@hey.com`, `FAKE…` document numbers, eight
  British-priced products). None of it is real, and none of it should be treated as a value to
  preserve. Handoff 4's `PRODUCTS` array is a *fixture*, not a spec: the shapes it demonstrates are
  what matter, and those are written down in [domains/things.md](../domains/things.md) §3.
