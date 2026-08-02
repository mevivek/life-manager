# Idea backlog

Every idea ever raised for life-manager, with its status. **Rejected entries stay here
permanently, with their reason** — that is what stops the same idea returning every few
sessions.

Method, funnel definitions, and the shaping template: [brain.md](brain.md).
Statuses: `raw` → `shaped` → `ready` → `roadmap` → `built`, or `rejected`.

**Only the human moves an idea to `roadmap`.** ([ADR-0017](../decisions/0017-product-brain.md))

**Last reviewed:** 2026-07-27 · **Seeded from:** the initial architecture session and
[prior-art.md](../prior-art.md).

---

## On the roadmap

Already committed. Detail lives in [roadmap.md](../roadmap.md); listed here only so the
backlog is a complete picture.

| Idea | Milestone | Domains | Status |
|---|---|---|---|
| Documents CRUD + file upload/versioning | M1 | Documents | **built** 2026-07-28 |
| **Expiry reminders with push delivery** | M1 | Documents | **built** 2026-07-28 — VAPID is provisioned now, and what is left is a phone subscribing and one notification being *seen*; status in [roadmap.md § Current position](../roadmap.md#current-position) |
| Full-text search over metadata | M1 | Documents | **built** 2026-07-28 — title/issuer/notes/tags, weighted |
| Expiring-soon dashboard as the home screen | M1 | Documents | **built** 2026-07-28 (shaped below; brought forward into M1 as §7 predicted) |
| OCR / search inside documents | M2 | Documents | roadmap |
| Offline read cache | M2 | — | **built** 2026-07-29 — pulled ahead of M1's "done when" by an explicit product call ([roadmap.md](../roadmap.md) §4b). The read half is [ADR-0013](../decisions/0013-read-only-offline-v1.md); offline **writes** followed as an outbox, [ADR-0024](../decisions/0024-offline-writes-outbox.md) |
| Family sharing (invites, roles, space switcher) | M3 | All | roadmap |
| **Things domain** (was "Assets") | M4, pulled into M1's window | Things | **built** 2026-07-30, both halves — [ADR-0029](../decisions/0029-the-things-domain.md), [domains/things.md](../domains/things.md). **It skipped this backlog entirely; see the note under § Ready** |
| Money domain | M4 | Money | roadmap |
| Secrets vault (E2EE) | M5 | Vault | roadmap |
| **Numbers shown by default, with one hide-them switch** | — | Documents · Things | **built** 2026-08-01 — [ADR-0036](../decisions/0036-numbers-shown-by-default.md). Entered as a maintainer request to *remove* the reveal step; the scope questions turned it into a preference (`feel.numbers`, off by default) covering both domains, and the maintainer answered each one before anything was written. The derived `identifier_last4` / `serial_last4` columns went with it. **This is what the note under § Ready asks for** — a scope change with the human's yes recorded, not inferred |

---

## Ready — awaiting a human yes

*(none yet — nothing has been shaped and validated far enough)*

> ### The Things domain never passed through here, and that is worth recording rather than tidying away
>
> A whole second domain went from *nothing* to *built, both halves* between 2026-07-29 and 2026-07-30
> with **no entry in this file at any point**. Its real path was:
>
> 1. A **design handoff** arrived specifying the domain in full — screens, the cover ladder, the
>    ownership triple, the capture track. It therefore entered at **`shaped`**, skipping `raw`, because
>    somebody else had already done the shaping.
> 2. [ADR-0029](../decisions/0029-the-things-domain.md) was written and the **client half was built the
>    same day**, from the comp.
> 3. The **server half** followed as M4 step 1 on 2026-07-30.
>
> So `shaped → built` directly. It never sat in **Ready**, and the human's explicit *yes* that
> [ADR-0017](../decisions/0017-product-brain.md) §3 puts between `ready` and `roadmap` was never asked
> for as a scope question — the handoff was treated as the decision. **The funnel gate was bypassed.**
>
> This is not retroactive permission and the entry above is not a claim it went well procedurally. It
> is here because [CLAUDE.md](../../CLAUDE.md) invariant 12 says the human decides product scope, and a
> bypass that leaves no trace is one nobody can weigh later. Two things follow: a design handoff is an
> *input* to shaping, not a substitute for the gate; and the next domain gets a `ready` entry and an
> explicit yes before a line of it is written, however finished the comp looks.

---

## Shaped

### Quick capture: photograph a receipt in under five seconds

- **Problem:** A paper receipt gets photographed or it gets lost. The moment of capture is
  standing at a counter or unpacking a box — any friction and it never happens.
- **User story:** As someone holding a receipt, I want to photograph it and be done in
  seconds, so that it is in the system before I put it down.
- **Why now:** Directly serves principle 2 (effortless capture), which is the difference
  between a used app and an empty one. Nothing else matters if the database stays empty.
- **Approach:** A camera-first entry point on the PWA home screen. Photo uploads
  immediately as a document with `doc_type = receipt` and no other metadata. OCR (M2)
  backfills merchant and date later; the user is never blocked on typing.
- **Domains:** Documents (→ Money later)
- **Effort:** M — needs the M2 OCR pipeline to be genuinely good, or it becomes a folder of
  unlabeled photos.
- **Success:** Receipts actually get captured, without a deliberate "let me file this" act.
- **Risks:** Depends on OCR quality. Without it, this creates junk rather than data.
- **Alternatives rejected:** A full metadata form at capture time — that is the friction
  this exists to remove.

### Expiring-soon dashboard as the app's home screen

> **Built in M1, 2026-07-28** — `apps/web/src/routes/_authed/home.tsx`. Shipped as expiring-in-30,
> expiring-in-90, recently added, and missing-a-file, exactly as the approach below describes. It is
> not yet the *default* route (`/` still redirects to `/home`, which is this page), and the success
> criterion — "opened and closed with nothing to do, and that feels informative" — cannot be judged
> until there is real data in it.
>
> The recorded risk was right: **empty-state design mattered.** Every panel needed a specific empty
> message rather than a blank space, and one panel had to learn to hide itself entirely when the
> feature behind it is unconfigured.

- **Problem:** Opening the app to a list of everything you own answers no question. Opening
  it to *"three things need attention"* does.
- **User story:** As someone who opens the app occasionally, I want the first screen to tell
  me what needs action, so I never have to go looking.
- **Why now:** Reminders are M1 anyway; this is the UI expression of the same data and
  costs little extra.
- **Approach:** Default route is a dashboard: expiring in 30/90 days, recently added,
  anything missing a file. Grows into a cross-domain view as domains land (principle 4).
- **Domains:** Documents now; all domains eventually
- **Effort:** S
- **Success:** The app is opened and closed with nothing to do — and that feels informative
  rather than pointless.
- **Risks:** Empty-state design matters; a blank dashboard on day one is discouraging.

---

## Raw

Captured, not yet examined. One line each. A session should shape or kill these, not let
them accumulate.

**Documents**

- Email-inbox ingestion — forward a receipt or policy to an address and it files itself
  (from [prior-art.md](../prior-art.md) §2; Trustworthy's headline feature)
- AI-extracted expiry dates and issuer from a scan, with human confirmation
- Document templates per type — a passport prompts for nationality, a warranty for retailer
- "Documents I should probably have but don't" — a checklist against a standard set
- Renewal *workflows*, not just reminders: what to do, links, prerequisites
- Bulk import from an existing folder of scans
- Share a single document externally via a signed, expiring link

**Cross-domain (principle 4 — these score highest)**

- Link a warranty document to the physical asset it covers
- Link a receipt to both the asset and the money transaction
- "Who sold me this" — link an asset to a person
- Unified search across every domain from one box
- A single timeline view: everything that happened or is due, ordered by date

**Assets / Money / People / Notes**

- ~~A people directory: file a record under someone by name~~ — **Ready → built 2026-07-31.** Human
  yes given after design handoff 5 drew it and it was deferred once as debt D84.
  [ADR-0034](../decisions/0034-people-is-a-directory.md), [domains/people.md](../domains/people.md).
  Deliberately *not* a personal CRM — see that doc §2 for what is out of scope and why
- Physical inventory with location ("which box is the drill in")
- Asset depreciation and replacement-due estimates
- Net-worth snapshot from assets minus liabilities — *not* budgeting (anti-goal)
- Insurance coverage gaps — assets above a value with no linked policy
- Personal CRM: last contact, important dates, gift ideas
- Notes with backlinks to any entity

**Vault (M5+)**

- Passkey-based vault unlock instead of a passphrase
- Browser extension for autofill
- Emergency access — a trusted person gets vault access after a delay and no response

**Platform**

- Native Android client (the plug-and-play test of
  [ADR-0002](../decisions/0002-api-first-decoupling.md))
- Export everything — full data portability, a hedge against this project being abandoned
- Home-screen widget for "expiring soon"
- Natural-language query: *"when does my car insurance run out"*

---

## Rejected

Kept permanently with reasons. **Do not re-propose without the stated reason having
changed.**

| Idea | Why not | Would reconsider if |
|---|---|---|
| End-to-end encrypt all documents | Permanently forecloses OCR, search-inside-document, previews, and server-side reminders — the features that make the category useful. [ADR-0009](../decisions/0009-sensitivity-tiers.md) | The app goes public and hosts other people's data |
| Full offline-first with sync | Plausibly larger than the entire Documents domain; a bad merge means silent data loss. [ADR-0013](../decisions/0013-read-only-offline-v1.md) | Offline capture becomes daily friction |
| Budgeting / envelope / double-entry accounting | Explicit anti-goal. Firefly III exists and is good | Never |
| Bank API integration as a core dependency | Fragile, jurisdiction-specific, permanent maintenance tax against principle 3 | A stable aggregator makes it genuinely zero-maintenance |
| Public sharing surface, feeds, social features | Anti-goal. This is a private tool | Never |
| Build all six domains in parallel | The most likely way this project fails — dilution, not slowness | Never |
| Use Bitwarden/1Password via API instead of building a vault | A unified cross-domain model is the thesis ([brain.md](brain.md) §3) | The vault is descoped — then this is the *right* answer, not weaker crypto |
| Collaborative editing / comments / task assignment | Family sharing is not collaboration. Anti-goal | Never |

---

## Parking lot

Interesting, no clear home yet, not worth shaping.

- Voice capture: *"remind me the boiler was serviced today"* → a note plus a reminder
- Physical-world links: a QR sticker on a box resolving to its asset record
- A "life audit" — what is missing, expiring, uninsured, or undocumented, scored
- Inheritance / next-of-kin view (Everplans' whole product; interacts hard with vault
  recovery in [ADR-0010](../decisions/0010-vault-key-hierarchy.md))
