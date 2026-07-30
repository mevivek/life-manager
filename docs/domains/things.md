# Domain: Things

- **Status:** **built.** Both halves. The screens, the contract and the client hooks landed first; the
  tables, repository, service and routes followed (M4 step 1). See §10 for the file list and the two
  things that are still open.
- **Milestone:** pulled forward from M4 by the fourth design handoff —
  [ADR-0029](../decisions/0029-the-things-domain.md), [roadmap.md](../roadmap.md)
- **Sensitivity tier:** **0 — server-readable.** Same reasoning as Documents
  ([ADR-0009](../decisions/0009-sensitivity-tiers.md)); a serial number is not vault material
- **Depends on:** Documents, for the link in §3 and the sum-insured card in §7

## 1. Purpose

Things holds the **physical objects a household owns** — a car, a laptop, a boiler, a gold chain — as
records that *own the paperwork proving them*.

The question it answers is not "is this still valid" (a thing does not expire) but:

> *"What do I own, is it still covered, when was it last serviced, and where are its papers?"*

That last clause is the reason the domain exists rather than being a `doc_type`. A car carries four
dated papers — registration, insurance, roadworthiness, service record — and the only place they are
naturally indexed together is *the car*. Filed as documents alone they are four rows in an archive of
forty, related to each other by a coincidence of titles.

## 2. Scope

**In scope:** the object's identity (kind, make, model, serial); what it cost and when it was bought;
its **cover** (a manufacturer warranty, or none); a **service cycle** with a log; where it is kept;
whose it is; its photos; its **ownership state** when it leaves the house; and the link to its
documents.

**Out of scope:**

- **Anything that expires.** A vehicle's insurance and roadworthiness are *documents*, filed against
  the thing. The thing itself has cover, not an expiry. §4 rule 2.
- **What it is worth today.** Depreciation, resale value and market pricing are Money's business, if
  anyone ever wants them. Things holds `price` — what was paid — because that is the number an insurer
  asks for.
- **Consumables and inventory.** This is not a stock system. If the answer to "how many do you have"
  is a number rather than a name, it does not belong here.
- **A registry of makes and models.** `MAKES` and `MODELS` in the capture form are *suggestions over a
  free-text field*, exactly as `issuer` is for Documents. Never a closed list — §9(1).

## 3. Entity model

```
things 1───* thing_photos
   │
   ├─────* documents          (via documents.thing_id — nullable, one-to-many)
   ├─────* thing_services     (the service log)
   └─────* reminders          (generic: entity_type = 'thing')
```

Universal columns per [conventions/data.md](../conventions/data.md) §1 are assumed on every table and
not repeated. `space_id` is on every one of them (invariant 2).

### `things`

| Column | Type | Notes |
|---|---|---|
| `name` | `text not null` | Free text. **The only field required at capture** — same rule as a document's `title`, and for the same reason (Q2) |
| `kind` | `enum not null` | `phone` · `laptop` · `tablet` · `vehicle` · `appliance` · `av` · `furniture` · `tool` · `valuable` · `other` |
| `brand` | `text null` | The make. Free text with suggestions — §9(1) |
| `model` | `text null` | |
| `serial` | `text null` | **The full value**, plaintext, masked for display — the same decision as a document's `identifier` ([ADR-0026](../decisions/0026-store-the-full-identifier.md)). What it is *called* depends on the kind: IMEI, registration, hallmark, order number |
| `serial_last4` | `text null` | The **display** form, derived from `serial` on every write. Never sent by a client |
| `purchased_on` | `date null` | Starts the cover clock and drives `age` |
| `price` | `numeric null` | What was paid. Never a float ([conventions/data.md](../conventions/data.md) §4) |
| `currency` | `char(3) null` | Non-null whenever `price` is |
| `warranty_ends_on` | `date null` | `null` means **no cover recorded**, which is a normal state and not a gap |
| `service_every_months` | `int null` | The cycle length. `null` means the thing has no service cycle |
| `service_due_on` | `date null` | The next one. Recomputed from the newest `thing_services` row plus the interval |
| `kept_at` | `text null` | "Driveway", "Kitchen cupboard". Free text — it is a memory aid, not an address |
| `holder` | `text null` | Whose it is, as a **label**. `null` means the owner's own. Identical semantics to `documents.holder` — §4 rule 6 |
| `relation` | `text null` | Cosmetic gloss on `holder`, and `null` whenever `holder` is |
| `ownership` | `enum not null default 'here'` | `here` · `lent` · `gone` — §4 rule 4 |
| `ownership_who` | `text null` | Who has it, or who it went to. Free text, optional even when not `here` |
| `ownership_since` | `date null` | When it left |
| `notes` | `text null` | |
| `search_vector` | `tsvector generated stored` | Weighted: name A, brand/model B, notes/kept_at C |

Indexes: `(space_id) where deleted_at is null`, `(space_id, warranty_ends_on) where deleted_at is
null` and `(space_id, service_due_on) where deleted_at is null` (the cross-domain horizon and the
reminder scan read both), GIN on `search_vector`.

### `thing_services`

The service log. **A cycle, not a date** — §4 rule 3.

| Column | Type | Notes |
|---|---|---|
| `thing_id` | `uuid not null` | → `things(id)`, cascade |
| `serviced_on` | `date not null` | |
| `cost` | `numeric null` | |
| `currency` | `char(3) null` | Non-null whenever `cost` is |
| `provider` | `text null` | "VW Kilburn", "Plumbcraft" |
| `notes` | `text null` | |

Index: `(thing_id, serviced_on desc)`. The newest row is what `service_due_on` is derived from.

### `thing_photos`

Deliberately **not** `document_files`. A thing's photo is not a version of a document, so it needs no
`version`, no `is_primary` demotion transaction, and no OCR. Everything else about it is the same, and
the two share `storage_key`'s shape and the presign contract
([ADR-0008](../decisions/0008-object-storage-r2.md)).

| Column | Type | Notes |
|---|---|---|
| `thing_id` | `uuid not null` | → `things(id)`, cascade |
| `storage_key` | `text not null` | **Chosen by the API**: `spaces/{spaceId}/things/{thingId}/{photoId}` |
| `mime` | `text not null` | The same allowlist as documents, minus PDF — a photo of a boiler is not a PDF |
| `size_bytes` | `bigint not null` | |
| `sha256` | `text null` | |
| `is_hero` | `boolean not null default false` | The one shown at the top of the detail screen and as the list thumbnail |
| `uploaded_at` | `timestamptz null` | `null` until confirmed |

Partial unique: one `is_hero = true` per thing.

### `documents.thing_id` — the link

**One nullable column on the document**, not a join table. A receipt belongs to one object; an object
collects many papers. ADR-0029 § *Alternatives* has the reasoning and the trigger for revisiting it.

| Column | Type | Notes |
|---|---|---|
| `thing_id` | `uuid null` | → `things(id)`, **`on delete set null`** — §4 rule 5 |

Index: `(thing_id) where deleted_at is null`.

## 4. Business rules

Each maps to a test ([conventions/testing.md](../conventions/testing.md)).

1. **`name` is required and 1–200 characters. Everything else is optional at capture.** A thing may
   exist with no kind detail, no price, no cover and no photo. This is Q2 applied to a second domain,
   and it is the rule the capture wizard's *Skip for now* exists to honour
   ([ADR-0030](../decisions/0030-capture-as-a-stepped-wizard.md)).

2. **Cover is not expiry, and the two must never share a vocabulary.**
   [ADR-0029](../decisions/0029-the-things-domain.md) is the decision; this is the rule.

   A document that expires becomes *invalid*. A thing whose warranty ends **keeps working** — so the
   four cover states get their own shapes, their own words, and their own boundary:

   | State | When | Words |
   |---|---|---|
   | `active` | more than 60 days left | "3 years left" |
   | `ending` | 0–60 days left | "Ends in 6 weeks" |
   | `ended` | past `warranty_ends_on` | "Ended 20 Jan 2026" |
   | `none` | `warranty_ends_on IS NULL` | "No warranty recorded" |

   **`COVER_ENDING_DAYS` is 60, and `NEEDS_YOU_DAYS` stays 45.** Two thresholds, deliberately: the
   useful action on an ending warranty (register it, claim on it, decide whether to extend) has a
   longer lead than renewing a passport. Neither is a business rule about *notifications* — reminders
   fire server-side from `DEFAULT_LEAD_DAYS` (invariant 5).

   `ended` never says "Expired" and never pulses. It states a date.

3. **A service is a cycle, not a date.** Logging a service inserts a `thing_services` row and
   **recomputes** `service_due_on` as `serviced_on + service_every_months`. A thing with
   `service_every_months IS NULL` has no cycle and no due date; a thing with a cycle and an empty log
   uses its seeded `service_due_on` until the first service is logged.

   Service urgency uses **45 days**, not cover's 60 — a service is an appointment you have to make,
   which is the same shape of errand as renewing a document.

4. **Ownership is a state, never a delete.** `here` → `lent` → `here` is a loan; `here` → `gone` is a
   sale or a gift. In both cases the record **stays**, because proving what you handed over and when is
   a large part of why anyone files a receipt. Three consequences, each easy to undo by accident:

   - **`gone` is excluded from the sum insured** (you no longer own it) and from the **Now horizon** (a
     warranty on somebody else's dishwasher is not your deadline). `lent` is excluded from neither —
     it is still yours, and its reminders carry on.
   - **`gone` is dimmed in the list, not hidden.** Hiding it would make the archive lie about what it
     holds; a filter would be a control for a state most people have on two rows.
   - **`ownership_who` and `ownership_since` cannot outlive `ownership`.** Returning a thing to `here`
     clears both in the same statement, for the same reason `relation` cannot outlive `holder`.

5. **Deleting a thing does not delete its documents.** `documents.thing_id` is `on delete set null`,
   and the copy on the delete control says so: *"Its documents stay in Documents — deleting the thing
   doesn't shred the paperwork."* A cascade here would let one tap destroy a passport-adjacent archive
   because somebody sold a car.

6. **`holder` is a label, and never a permission.** Identical to `documents.md` §4 rule 13 — read it
   there rather than trusting a paraphrase. `null` means "mine" and is drawn as *absence*: no "Me"
   badge anywhere.

7. **Store the full serial; mask it for display.** `serial_last4` is **derived** server-side, so a
   client cannot send a mask that disagrees with its value. Plaintext, by the same explicit decision as
   `documents.identifier` (invariant 7, [ADR-0009](../decisions/0009-sensitivity-tiers.md)) — so **no
   copy in the app may say "encrypted"**. Revealing it is a display state, not an authorization
   boundary. `serial` goes in pino's `REDACTED_PATHS` alongside `identifier`.

8. **What the serial is *called* depends on the kind**, and the label is always visible. IMEI for a
   phone, `Registration` for a vehicle, `Hallmark` for a valuable, `Order number` for furniture,
   `Serial number` otherwise. An unlabelled twelve-character string is a string nobody can identify.

9. **A vehicle registration is two live formats, and the series is a choice.** The state series is
   `KA 01 AB 1234`; the Bharat series, issued since 2021 and valid across states, is `22 BH 1234 AA` —
   year first, no RTO code. Neither is a subset of the other, so it is **detected and offered, never
   guessed**: a single `AA##AA####` mask made a BH plate untypeable, which is the bug handoff 3 shipped
   and handoff 4 names. Formatting never rejects a keystroke and never blocks a save.

10. **Every read and write is scoped to `space_id IN actor.spaceIds`.** Cross-space access returns
    **404, not 403** ([conventions/api.md](../conventions/api.md) §3).

11. **Uploads are limited to 25 MB** and to the image half of the document allowlist: JPEG, PNG, HEIC,
    WebP, TIFF. **Not PDF** — §3 `thing_photos`.

12. **The claim pack is a checklist, not a gate.** Six pieces — a photo, a serial, a purchase date, a
    price, a receipt or warranty document, and a cover end date. Missing pieces are **named, never
    blocking**: the pack builds anyway, because a partial pack handed to an insurer beats no pack. This
    is a *read* over data that already exists; it stores nothing.

## 5. API surface

**All of this exists** — `apps/api/src/domains/things/things.routes.ts`, and §10 lists the files. It
was written down before it was built because `packages/shared/src/things.ts` is the contract the client
already coded against, and the session that built the API implemented *this* rather than inventing a
second shape (invariant 9). It did, unchanged.

Universal rules — pagination, `problem+json`, `Idempotency-Key`, auth, the `::` escape for a `:verb`
([conventions/api.md](../conventions/api.md) §2) — are not restated.

```
GET    /api/v1/things
       ?q=          full-text over search_vector
       ?kind=       repeatable
       ?holder=     an exact holder name, or the literal `mine` for holder IS NULL
       ?ownership=  here|lent|gone, repeatable
       ?sort=name|purchased_on|warranty_ends_on|service_due_on   ?order=asc|desc
       Default sort: name asc — a thing has no single date that orders it the way an expiry
       orders a document, and alphabetical is the one order a person can predict

POST   /api/v1/things
GET    /api/v1/things/:id                    includes photos[], services[], documents[] and reminders[]
PATCH  /api/v1/things/:id                    version precondition required (ADR-0024)
DELETE /api/v1/things/:id?version=N          soft delete; documents.thing_id set null

GET    /api/v1/things/holders                distinct holders + most recent relation, as PAIRS

POST   /api/v1/things/:id/services           log a service; recomputes service_due_on
DELETE /api/v1/things/:id/services/:serviceId

POST   /api/v1/things/:id/photos::presign-upload   → { photo_id, upload_url, storage_key, expires_at }
POST   /api/v1/things/:id/photos::confirm          { photo_id, sha256? }
POST   /api/v1/things/:id/photos::presign-download { photo_id }
PATCH  /api/v1/things/:id/photos/:photoId          is_hero only
DELETE /api/v1/things/:id/photos/:photoId
```

The link is written from the **document** side, because that is where the column is:
`PATCH /api/v1/documents/:id { thing_id }`. Both screens draw it, one endpoint sets it.

Note the `::` on the photo verbs. A `:verb` in a route pattern needs the double colon and **may only
follow a static segment** — `/photos/:photoId:presign-download` generates a broken OpenAPI path even
though Fastify routes it correctly. That is why the photo is named in the **body**, exactly as
`documents.md` §5 does it. [conventions/api.md](../conventions/api.md) §2.

## 6. Reminders

`reminders` is already generic — keyed by `entity_type` + `entity_id`
([documents.md](./documents.md) §3), which is the whole point of it having been built that way. Things
sets `entity_type = 'thing'` and needed **no schema change**. That prediction held exactly.

Two kinds of due date, and they want different lead times:

| Event | `due_on` | Lead days |
|---|---|---|
| Cover ending | `warranty_ends_on` | 60, 14 |
| Service due | `service_due_on` | 30, 7 |

**Neither is automatic, and that is still true after the API landed.** Documents create reminders
automatically for `identity` and `certificate` only (`AUTO_REMINDER_TYPES`), and the equivalent
question for things — *should every warranty get a reminder?* — is **§9(2), unanswered**, and belongs
in [open-questions.md](../product/open-questions.md) before it is coded. Do not decide it in a
repository.

So the API session built the **capability** and left the switch off:

- `THING_ENTITY_TYPE` exists in `reminders.repository.ts`, and `listForEntity` now takes the entity
  type as an explicit parameter rather than defaulting to `'document'`.
- `reminderSchema.entity_type` is an enum (`document | thing`) rather than the literal `'document'` it
  was. That was not optional: `reminderSchema` is nested in *both* detail responses, so a thing's own
  reminders would have failed their own response schema.
- `GET /things/:id` returns `reminders[]`, and a test asserts it is **empty** — with a comment saying
  which test to change when the switch is flipped.
- Nothing anywhere creates one.

**Read the note on `listDueForMaintenance` before switching it on.** The daily scan joins `documents`
for a title and renders `"{title} expires {due_on}"`, so a thing reminder would be announced as *"A
document expires …"* — or, if the join were naively widened, *"Dishwasher expires 20 Jan"*, which is
precisely the sentence §4 rule 2 and ADR-0029 exist to prevent. Widening the scan needs a second title
source and a second copy register ("Warranty ends", "Service due"), which is part of answering §9(2)
rather than a preparatory refactor. Debt **D58**.

## 7. Screens

Two, plus changes to three that already existed.

**Things (list).** The domain switcher under the title (`Documents` / `Things` segmented pills —
[ADR-0029](../decisions/0029-the-things-domain.md), never a fourth tab), a **sum insured** card, kind
filter chips, and the rows.

- A row is a 52×40 thumbnail, the name plus an optional holder pill, then a **cover bar** with its tag
  and words, then the meta line and a document count. A `lent` or `gone` state adds a fourth line.
  `gone` dims the whole row to 55%.
- **The sum insured card is the one genuinely cross-domain read.** It totals `price` across things the
  user still owns and measures it against the contents-insurance policy's `sum_insured` — which lives
  in a *document's* `custom_attrs`. It is drawn **only when such a policy is found**, so the common
  case is that the card is absent rather than wrong. Over-cover is `--status-soon` and says the
  shortfall in money; under is a quiet line. The list thumbnail is **not** a drop target.

**Thing (detail).** Hero photo → name and kind → ownership banner if away → the **cover card** (tag,
dates, bar, words, age, and the service tag) → service history with *"Serviced today — log it"* →
facts (bought, paid, kept) → the masked serial with Copy and Show → *"Papers this one needs"* for a
vehicle → *"Its documents"* → photos → *"Build a claim pack"* → *"It's not with me any more"* →
delete.

- **"Papers this one needs" is a 2×2 grid, and only vehicles have one.** Four slots — registration,
  insurance, roadworthiness, service record. A filled slot is solid and carries the document's own
  expiry status; an empty one is dashed and says "Not filed". Tapping an empty slot opens capture
  **past the type step**, with the type, the title and the thing prefilled — which is the case
  ADR-0030's five-step variant exists for.
- The 2×2 is not generalised to other kinds yet, and that is a product decision rather than an
  oversight: a laptop's "papers it needs" is a receipt, and a checklist of one is a nag.

**Changes to existing screens:**

- **Now — the horizon becomes cross-domain.** Thing events (cover ending, service due) merge into the
  document expiry timeline, sorted by date. A thing event gets a **square** dot and a mono kicker
  ("Warranty ends", "Service due"); a document keeps its **round** dot and no kicker. Shape, not a
  section header — one timeline is the whole reason Now exists (ADR-0025 §4).
- **Document detail — "Belongs to".** The linked thing as a tappable card, or a dashed *"Link this to
  something you own"* button that opens a picker.
- **Capture — a second track.** [ADR-0030](../decisions/0030-capture-as-a-stepped-wizard.md).

## 8. Relationships to other domains

- **Documents** — `documents.thing_id`. The load-bearing one, and the reason both exist.
- **Money** — `price` and a service's `cost` are the natural join points, and they are `numeric` with a
  `currency` for exactly that reason ([conventions/data.md](../conventions/data.md) §4). Nothing is
  built.
- **People** — `holder` is free text today, as `issuer` is for Documents. When People exists, both
  become the same migration.
- **Reminders** — shared table, no change needed (§6).

## 9. Open decisions

1. **`brand` and `model` stay free text.** The capture form offers suggestions (`MAKES`, `MODELS` from
   the comp), and a suggestion list is not a foreign key. Revisit when a user has enough things that
   two spellings of "Volkswagen" become a real annoyance — the same trigger `documents.md` §9 sets for
   `issuer`.
2. **Should a warranty create reminders automatically?** §6. Unanswered.
3. **Does the 2×2 papers checklist generalise?** §7. Deliberately vehicle-only for now.
4. **`other` as a tenth kind.** Present in the contract so nothing is unfileable, absent from the
   capture chips so it is never *chosen* — the same shape as `doc_type: 'other'`.

## 10. Files, and what is still open

**Both halves are built.** This section used to say the API did not exist; it does.

### Server (M4 step 1)

| File | What |
|---|---|
| `apps/api/src/domains/things/things.schema.ts` | `things`, `thing_services`, `thing_photos`, the two enums, the generated `tsvector` |
| `apps/api/src/domains/things/things.repository.ts` | the only SQL. `scoped()` used **unchanged** |
| `apps/api/src/domains/things/things.service.ts` | §4's rules, and `addMonthsClamped` for rule 3 |
| `apps/api/src/domains/things/things.photos.service.ts` | presign → PUT → confirm, and the hero slot |
| `apps/api/src/domains/things/things.routes.ts` | §5 exactly, `::` escapes and all |
| `apps/api/src/domains/things/things.test.ts` | 49 tests, one per rule, plus the cross-space sweep |
| `apps/api/src/domains/things/things.photos.test.ts` | 22 tests |
| `apps/api/drizzle/0007_nasty_leech.sql` | the tables **and** the `documents.thing_id` foreign key |

`documents.repository.ts` grew two functions for the link — `listLinkedToThing` and `unlinkFromThing`
— because the column lives on `documents` and one column should have one owner.

### Client (the fourth design handoff)

The shared contract, the client hooks, the cover ladder, both screens, the capture track, the
cross-domain horizon, and the document-side link. All unchanged by the server work: the API implemented
`packages/shared/src/things.ts` rather than editing it (invariant 9).

### ADR-0006's promise, which was the thing being measured

**`apps/api/src/db/scoped.ts` was not touched.** Adding a second domain needed no change to the tenant
filter: `spaceScoped()` gives every new table the two columns `SpaceScopedTable` structurally requires,
so `scoped(actor, things)` type-checked on first use. That is the claim ADR-0006 made and it held.

### Still open

1. **§9(2) — automatic warranty reminders.** Unanswered, so the capability is built and the switch is
   off. §6 has the detail, including why the daily scan must not simply be widened (debt **D58**).
2. **Offline writes.** `useThings` deliberately does not route through the outbox: `lib/outbox.ts`'s
   entry union is document-shaped, and widening it was left with the endpoints rather than done before
   them. Now that the endpoints exist, this is one outbox kind plus one `writeOrQueue` per mutation —
   see the note at the top of `apps/web/src/features/things/useThings.ts`.
3. **No client for the photo verbs.** The four endpoints exist and are tested; `api.things` has no
   method for them and `ThingPhotos.tsx` says so on screen. Debt **D59**.
4. **Two comments in `apps/web/` are now false**, and were left alone deliberately because the API
   session's brief was not to touch the client: the header block in
   `apps/web/src/features/things/useThings.ts` and the `things:` block in `apps/web/src/lib/api.ts`
   both still announce in a banner that *"none of these endpoints exist yet"* and that every call
   answers 404. They do exist. Fix those banners in whichever pass closes items 2 and 3 — a confident
   false comment costs a session more than a missing one.
5. **Money**, which is M4 step 3 and has no doc yet.
