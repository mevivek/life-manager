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
| `Life-Manager-handoff-3.dc.html` | Third handoff, **the authoritative one** — the full document identifier, holders (*"Whose document is it?"*), and the three **Feel** preferences (density · headings · voice) |
| `support.js` | The Claude Design player runtime, shared byte-for-byte across all three. The comps reference it as a sibling (`./support.js`), which is why one copy sits beside them |
| `HANDOFF.md` | The bundle's own README, verbatim — the "coding agents, read this first" note the tool ships |

Each handoff **supersedes the earlier one only for the parts it changed.** Handoff 3 is the one to
trust for anything current; the earlier two are kept because they show what a decision replaced (the
Add-tab-to-You move, for one) and because a comp is cheaper to read than to reconstruct.

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
- **The seed data is the tool's fake fixtures** (`rowan@hey.com`, `FAKE…` document numbers). None of
  it is real, and none of it should be treated as a value to preserve.
