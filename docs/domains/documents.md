# Domain: Documents

- **Status:** **built** (M1, 2026-07-28). M2 additions still planned — see §3 `document_text`.
- **Milestone:** M1 (core + reminders), M2 (OCR, previews) — [roadmap.md](../roadmap.md)
- **Sensitivity tier:** **0 — server-readable.** Deliberate; see
  [ADR-0009](../decisions/0009-sensitivity-tiers.md)
- **Depends on:** none. First domain built.

## 1. Purpose

Documents holds the paperwork of a life — identity documents, financial and legal
contracts, warranties and receipts, certificates — as **structured records that happen to
have files attached**, not as a folder of scans.

The question it answers: *"where is that document, is it still valid, and when do I need to
do something about it?"* The third part is the valuable one. Storage is commodity; an
entire product category exists for nothing but expiry tracking
([prior-art.md](../prior-art.md) §3), which is why reminders ship in M1 rather than later.

## 2. Scope

**In scope:** document metadata and taxonomy; uploaded files with versioning; expiry and
renewal reminders; full-text search across metadata and (M2) extracted text; tags and
type-specific attributes.

**Out of scope:**

- The physical object a document describes — a car's warranty is a document; the car is an
  **Asset**.
- What something cost — a receipt is a document; the transaction is **Money**.
- Who issued or sold it as an entity — free-text `issuer` for now; **People** owns real
  person records.
- General file storage. Every file belongs to a document. There is no loose-file concept
  ([product/brain.md](../product/brain.md) anti-goals).

## 3. Entity model

```
documents 1───* document_files
    │
    └──────────* reminders  (generic; keyed by entity_type + entity_id)

document_files 1───0..1 document_text   (M2)
```

Universal columns per [conventions/data.md](../conventions/data.md) §1 are assumed on every
table and not repeated.

### `documents`

The logical document — "my passport" — independent of any particular scan of it.

| Column | Type | Notes |
|---|---|---|
| `title` | `text not null` | Free text. The only field required at capture — see [Q2](../product/open-questions.md) |
| `doc_type` | `enum not null` | `identity` · `financial` · `legal` · `warranty` · `receipt` · `certificate` · `other` |
| `issuer` | `text null` | Who issued it. Free text with autocomplete — see §9 |
| `identifier` | `text null` | **The full number**, plaintext — [ADR-0026](../decisions/0026-store-the-full-identifier.md). Returned on **every** document response including the list ([ADR-0027](../decisions/0027-identifier-in-the-list-response.md)). In pino's redaction list |
| `identifier_last4` | `text null` | The **display** form, derived from `identifier` on every write. This is what lists show — §4 rule 6 |
| `holder` | `text null` | Whose document it is, as a **label**. `null` means the owner's own — §4 rule 13 |
| `relation` | `text null` | How the holder relates to the owner — "Wife", "Son (12)". Cosmetic, and `null` whenever `holder` is |
| `issued_on` | `date null` | |
| `expires_on` | `date null` | **`date`, not timestamp.** A passport expires on a day, not an instant |
| `country` | `char(2) null` | ISO 3166-1 alpha-2 |
| `notes` | `text null` | |
| `tags` | `text[] not null default '{}'` | |
| `custom_attrs` | `jsonb not null default '{}'` | Type-specific fields, Zod-validated per `doc_type` ([conventions/data.md](../conventions/data.md) §5) |
| `search_vector` | `tsvector generated stored` | Weighted: title A, issuer B, notes/tags C |

Indexes: `(space_id) where deleted_at is null`, `(space_id, expires_on) where deleted_at is
null` (the reminder scan and the default sort), GIN on `search_vector`.

#### `custom_attrs` shapes per `doc_type`

JSONB in the database, but **not freeform over the wire** — a Zod discriminated union on
`doc_type` in `packages/shared` validates these at the API boundary
([conventions/data.md](../conventions/data.md) §5). Every field is optional; capture friction
is the bigger risk than incomplete records
([product/brain.md](../product/brain.md) principle 2).

| `doc_type` | Keys |
|---|---|
| `identity` | `document_number_last4`, `issuing_authority`, `nationality`, `place_of_issue` |
| `financial` | `counterparty`, `account_last4`, `value`, `currency`, `renewal_terms` |
| `legal` | `counterparty`, `jurisdiction`, `effective_from`, `renewal_terms` |
| `warranty` | `vendor`, `product`, `serial_number`, `purchase_price`, `currency`, `purchased_on`, `coverage_months` |
| `receipt` | `vendor`, `amount`, `currency`, `purchased_on`, `payment_method_last4` |
| `certificate` | `issuing_body`, `credential_id`, `level`, `verify_url` |
| `other` | *(none — freeform `notes` only)* |

Two rules that are easy to get wrong:

- **Still no full number in JSONB.** `document_number_last4`, `account_last4` and
  `payment_method_last4` remain truncated at the API boundary, and ADR-0026 does **not**
  extend to them. The top-level `identifier` is one named column, in one redaction path, on
  one detail response; JSONB is freeform, unredacted and easy to slip a card number into
  unnoticed. If a second full number is ever needed, it gets its own column and its own line
  in `REDACTED_PATHS` — not a key in here.
- **Money keys carry a `currency`** and are `numeric`, never float
  ([conventions/data.md](../conventions/data.md) §4). These are the natural join points to
  the future Money domain (§8), so getting the type right now avoids a conversion later.

`warranty` and `receipt` are deliberately separate types even though they often arrive
together — a receipt proves a purchase, a warranty confers a right, and only the latter
expires. Splitting them keeps the reminder logic clean.

### `document_files`

A specific uploaded file. Versioned — renewing a passport must not destroy the old scan.

| Column | Type | Notes |
|---|---|---|
| `document_id` | `uuid not null` | → `documents(id)`, cascade |
| `version` | `int not null` | Monotonic per document, starting at 1 |
| `storage_key` | `text not null` | **Chosen by the API**: `spaces/{spaceId}/documents/{documentId}/{fileId}` |
| `mime` | `text not null` | Validated against an allowlist |
| `size_bytes` | `bigint not null` | |
| `sha256` | `text null` | Integrity, and duplicate detection. **Nullable** — the client supplies it optionally; see §9(5) |
| `is_primary` | `boolean not null default false` | The version shown by default |
| `uploaded_at` | `timestamptz null` | `null` until the client confirms the upload |

Unique: `(document_id, version)`. Partial unique: one `is_primary = true` per document.

### `reminders`

**Generic on purpose** — keyed by entity rather than owned by Documents, so Assets and
Money reuse it instead of each inventing their own.

| Column | Type | Notes |
|---|---|---|
| `entity_type` | `text not null` | `'document'` today |
| `entity_id` | `uuid not null` | No FK — polymorphic. Orphans are swept by a job |
| `due_on` | `date not null` | Usually mirrors `documents.expires_on` |
| `lead_days` | `int not null` | Fires at `due_on - lead_days`. Multiple rows = multiple lead times |
| `channel` | `text not null` | `web_push` now; `email`, `fcm`, `apns` later |
| `sent_at` | `timestamptz null` | `null` = pending. Idempotency for the delivery job |
| `dismissed_at` | `timestamptz null` | User acknowledged |

Index: `(due_on, sent_at) where sent_at is null and deleted_at is null` — the daily scan.

### `document_text` — M2

| Column | Type | Notes |
|---|---|---|
| `file_id` | `uuid not null unique` | → `document_files(id)`, cascade |
| `content` | `text not null` | Extracted text |
| `extracted_at` | `timestamptz not null` | |
| `extractor` | `text not null` | Tool + version, so re-extraction is decidable |

**Defined now, built in M2.** The column and job names are fixed so the search index does
not need rebuilding later. Only possible because this domain is Tier 0.

## 4. Business rules

Each maps to a test ([conventions/testing.md](../conventions/testing.md)).

1. `title` is required and 1–200 characters. Everything else is optional at creation — a
   document may exist with no type, no expiry, and no file.
2. `expires_on`, when present, must be on or after `issued_on`.
3. A document may have **at most one** `is_primary` file. Uploading a new version makes it
   primary unless explicitly told otherwise; the previous primary is demoted in the same
   transaction.
4. `version` is assigned by the server, monotonically per document. Clients never supply it.
5. **The API always chooses `storage_key`.** A request containing a storage key, path, or
   destination filename is rejected ([ADR-0008](../decisions/0008-object-storage-r2.md)).
6. **Store the full identifier; mask it for display.** Reversed by
   [ADR-0026](../decisions/0026-store-the-full-identifier.md) — this rule previously truncated
   to four characters at the API boundary. It now keeps the whole value in `identifier` and
   **derives** `identifier_last4` from it server-side, so a client cannot send a mask that
   disagrees with its number. **The full value is returned on every document response**, the
   list included — [ADR-0027](../decisions/0027-identifier-in-the-list-response.md) reversed
   0026's detail-only rule so the archive can show and copy a number without a round-trip, at
   the cost of the persisted cache holding every number on the device (debt D47). Plaintext, by
   explicit decision: encryption stays vault-only (invariant 7, ADR-0009), so no copy in the
   app may claim otherwise. Revealing it in the UI is a display state, **not** an
   authorization boundary.
7. Setting or changing `expires_on` reconciles that document's pending reminders. Clearing
   it deletes them.
8. Default lead times are 90, 30, and 7 days before expiry — created automatically for
   `identity` and `certificate` types, which are the ones with painful renewal timelines.
9. Deleting a document soft-deletes its files and reminders, and **does not delete the R2
   objects** ([conventions/data.md](../conventions/data.md) §3). Object cleanup is a
   separate job so an accidental delete stays recoverable.
10. A file row with `uploaded_at = null` older than 24 hours is abandoned — swept, along
    with any orphaned R2 object.
11. Uploads are limited to 25 MB and an allowlist: PDF, JPEG, PNG, HEIC, WebP, TIFF.
12. Every read and write is scoped to `space_id IN actor.spaceIds`. Cross-space access
    returns **404, not 403** ([conventions/api.md](../conventions/api.md) §3).
13. **`holder` is a label, and never a permission.** It records whose document a record *is* —
    a spouse's Aadhaar, a child's passport — so one archive can hold a household. Nobody is
    invited and nothing is shared by setting it: `space_id` remains the only thing that decides
    who may read a document (invariants 2 and 3), and `distinctHolders()` is scoped like every
    other read. Sharing, when it arrives, is a space growing a second member — a different
    mechanism, and this column will not change for it.

    Three consequences worth stating, because each one is easy to undo:

    - **`null` is "mine", and is drawn as absence.** The account owner has no name anywhere in
      the app; a "Me" badge on nine rows in ten would be noise. Same rule as `other` for
      `doc_type` and "no expiry" for `expires_on`.
    - **`relation` cannot outlive `holder`.** One helper writes both (`holderColumns()`), and
      clearing the name clears the relation in the same statement — a relation with nobody
      attached would render as a household member who does not exist.
    - **The `?holder=` filter needs a sentinel for "mine".** It is the literal `mine`
      (`HOLDER_MINE`), not an empty string, because `?holder=` and `?holder` are the same thing
      to enough query-string parsers to make the empty case unreliable. A person genuinely
      named "mine" collides; that is accepted, and noted in the schema.

## 5. API surface

Universal rules — pagination, `problem+json`, `Idempotency-Key`, auth — are in
[conventions/api.md](../conventions/api.md) and not restated.

```
GET    /api/v1/documents
       ?q=          full-text over search_vector (+ document_text from M2)
       ?type=       doc_type, repeatable
       ?tag=        repeatable
       ?expiring_before=YYYY-MM-DD
       ?has_file=true|false
       ?holder=     an exact holder name, or the literal `mine` for holder IS NULL — §4 rule 13
       ?sort=expires_on|created_at|title   ?order=asc|desc
       Default sort: expires_on asc, nulls last — the useful default, not created_at

POST   /api/v1/documents
GET    /api/v1/documents/:id                 includes files[] and reminders[]
PATCH  /api/v1/documents/:id
DELETE /api/v1/documents/:id                 soft delete

GET    /api/v1/documents/issuers             distinct issuers, for the §9(1) autocomplete
GET    /api/v1/documents/holders             distinct holders, each with its most recent relation
                                             — PAIRS, not names, so picking a person fills both

POST   /api/v1/documents/:id/files:presign-upload
       → { file_id, upload_url, storage_key, version, expires_at }
POST   /api/v1/documents/:id/files:confirm            { file_id, sha256? }
POST   /api/v1/documents/:id/files:presign-download   { file_id }
DELETE /api/v1/documents/:id/files/:fileId
PATCH  /api/v1/documents/:id/files/:fileId    is_primary only

GET    /api/v1/documents/:id/reminders
POST   /api/v1/documents/:id/reminders        { due_on, lead_days, channel }
DELETE /api/v1/reminders/:id
POST   /api/v1/reminders/:id/dismiss

GET    /api/v1/push/public-key                the VAPID key, or null when unconfigured
POST   /api/v1/push/subscriptions             register this browser for reminders
```

**Two of these moved from what this section originally specified, for a measured reason.**
`:presign-download` took the file in the path (`/files/:fileId:presign-download`) and `:dismiss`
was a suffix on `/reminders/:id`. A `:verb` suffix immediately after a **path parameter** breaks:
Fastify routes it correctly, but `@fastify/swagger` emits `/files/{fileId}:{presign}-download`, and
[conventions/api.md](../conventions/api.md) calls the OpenAPI document the contract. So the file is
now named in the body — mirroring `:confirm`, which already did — and `dismiss` is a plain path
segment. §2 of api.md records the rule; a `:verb` after a *static* segment is fine and unchanged.

Notable: **`400`**, not 413, when the declared `size_bytes` exceeds the limit — it is a Zod
rejection at presign time, before any bytes move, and §3's table of statuses reserves 413 for a
body that is itself too large. `409` on a `:confirm` for a file already confirmed. `503` from the
file endpoints when R2 is unconfigured, which is a normal state rather than an error.

**The size and mime limits are enforced by storage too, not only by us.** Both are signed into the
presigned URL, so a client that ignores the declared values gets `SignatureDoesNotMatch` from R2.
Verified against a real S3 implementation.

## 6. Background jobs

Registered with pg-boss ([ADR-0012](../decisions/0012-pg-boss-background-jobs.md)) — **except the
clock**. [ADR-0028](../decisions/0028-external-trigger-for-the-daily-scan.md) moved the daily trigger
to Cloud Scheduler calling `POST /api/v1/maintenance:run-daily`, because a pg-boss `schedule` needs
something to be running when it fires and the API is scale-to-zero. So in production the "cron" rows
below fire from **outside** the process, and the scan **delivers inline** rather than enqueueing:
`runRemindersInline()`, not `scanReminders()`. The queue entries still exist and are still right for a
worker that is actually running; they are just not what runs.

| Job | Trigger | Does | On failure |
|---|---|---|---|
| `reminders.scan` | **HTTP, daily 08:00 UTC** (Cloud Scheduler → `/maintenance:run-daily`) | Find `due_on - lead_days <= today` and `sent_at is null`; deliver each one **in the request** | Per-reminder `try`/`catch` so one bad push cannot stop the rest; the retry is **tomorrow**, because `sent_at` is written only after a successful send. Counts come back in the response, so "ran and delivered nothing" is distinguishable from "did not run" |
| `reminders.deliver` | queued | Send via `channel`; set `sent_at` | Retry 3×; leave `sent_at` null so the next scan retries |
| `documents.extract-text` | on `:confirm` (M2) | OCR → `document_text`; refresh search | Retry 2×, then give up. The document stays usable without extracted text |
| `documents.sweep-abandoned` | **the same HTTP call**, immediately after the deliveries | Delete unconfirmed file rows >24h old and their orphaned R2 objects | Retry next run. Ordered *after* the scan rather than an hour later — one call means ordering replaces the gap that two cron schedules needed |

## 7. UI surface

Restyled and partly restructured by
[ADR-0025](../decisions/0025-ledger-design-system.md) (2026-07-29). Read that first for the tokens,
the expiry ladder and the navigation rule; this section records what the screens *are*.

- **Now** (`/home`) — the deadline feed. Eyebrow date → a serif headline counting what needs you →
  *Needs you* (a grouped card of everything expired, expiring today, or inside **45 days**) → the push
  ask → **The horizon** (the next four dated documents beyond 45 days, five at 430px) → a no-scan
  nudge that deep-links into a filtered archive → a ledger footer.

  > **Two changes from what this section said before, both deliberate.**
  >
  > **1. The horizon is new, and it is the point.** The previous version had *Needs attention* (90
  > days) and *Missing a file*, and its hardest state was the **good** one: with nothing expiring it
  > said "Nothing expiring in the next 90 days. That is the point." To someone who opens this app
  > twice a month that is worthless — it answers a question they did not ask. Now always shows the
  > forward timeline, so the answer is never *nothing*; it is "nothing until 4 March".
  >
  > **2. One threshold at 45 days, replacing tiers at 30 and 90.** The older text asked for "expiring
  > in 30 and 90 days, recently added, documents with no file". The two expiry cards **duplicated each
  > other** — `?expiring_before=` is a single upper bound, so anything inside 30 days is also inside 90
  > and appeared in both — and "recently added" repeated whatever the others showed, because the
  > Documents tab is already the full list. Merging them left one list; ADR-0025 then made 45 days its
  > only boundary. **It is a display threshold, not a business rule**: reminders still fire at 90/30/7
  > server-side per `DEFAULT_LEAD_DAYS`.
  >
  > Both changes answer the one question the
  > [backlog entry](../product/idea-backlog.md) that proposed this screen actually posed: *what needs
  > doing* — and, now, *when is the next thing*.

- **Documents** (`/library?scope=documents`) — the archive, now a **scope of the library** rather than
  a screen of its own ([ADR-0032](../decisions/0032-one-library-tab.md)). `/documents` still resolves:
  it is a redirect that carries its search params across. A sticky header carrying the scope pills and
  a folding search, then the full list sorted soonest-first, then `Load 20 more`. Filter state lives in
  the **URL** and filters **server-side**, so the Now screen's nudge can link into a filtered view and
  a back-navigation returns to the list the user was reading.

  **The chips are gone as controls, and the parameters are not.**
  [ADR-0033](../decisions/0033-handoff-5-the-rest.md) removed the row to match handoff 5, on the
  maintainer's confirmation that search alone is enough — which was ADR-0032's own stated reopening
  condition. `?scan=no`, `?type=`, `?who=` and the rest still filter server-side and still round-trip
  through the URL, so the Now screen's nudge and any saved link keep working; what replaces the chips
  is a `Clear` beside the count, drawn whenever something is narrowing. Rule 13's Whose *filter* is
  retired; the `holder` parameter, `GET /documents/holders` and capture's Whose step are untouched.

  **Whose is a panel, not a cycle**, and it is **not drawn until a second person exists** — the same
  "draw it the day the thing exists" rule that keeps the sum-insured card off the Things list until a
  contents policy is filed. (This sentence used to cite the *domain switcher*; there is no longer one —
  [ADR-0031](../decisions/0031-things-is-a-fourth-tab.md) made Things a fourth tab and deleted it, and
  [ADR-0032](../decisions/0032-one-library-tab.md) then merged the two collections into one screen
  whose scope pills are a filter, not navigation.) Its options are
  *Mine* plus one per known holder. Note the vocabulary split, which is deliberate: the filter says
  **Mine** because it selects a set of documents, while the form says **Me** because it names a person.
- **Document detail** — back link → eyebrow type → serif title → a status block tinted by expiry state,
  carrying the reminder chips → *Details* (including *Whose*, which reads **Mine** rather than
  disappearing — it is a `<dl>` of every field, the same way an absent country reads "Not set" — and the
  per-type `custom_attrs`, read-only) → the
  `•••• last4` block and its explanation → *Scans* → a quiet text-only delete → **the page foot: when the
  record was added, and when it last changed**. Inline preview is M2.

  **The foot sits *below* the delete, and it is `RecordMeta` on both detail screens** — the same
  component the thing screen ends on ([things.md](things.md) §7), because two screens stating one fact in
  two shapes is the drift `documentRowProps.ts` exists to prevent elsewhere. It draws `Added 12 Jan 2026`,
  plus `· Updated 3 Feb 2026` **only when the rendered days differ**: a record nobody has edited would
  otherwise claim an update on the day it was captured. Neither `version` nor the id is drawn: "Version"
  already names a *scan* on this screen, and the id is in the URL.

  **Both dates here are *instants*, so they are drawn on the reader's clock** — as is a scan row's
  *Added*, and the Build card's build times. [design.md §11](../conventions/design.md) holds the rule and
  the two-kinds-of-date table; the short version is that `expires_on` is a calendar date and gets sliced,
  while `created_at` gets converted.
- **Rows carry the holder as a hairline pill beside the title**, and nothing at all for the owner's
  own. The pill is `shrink-0` and the title `min-w-0 truncate`, so a long title shortens and the
  **name never does** — a name truncated to "Priy…" loses the only thing distinguishing two otherwise
  identical documents.
- **The people picker** (`DocumentForm`) — *Whose document is it?* as a chip row: **Me**, one chip per
  known holder, and a dashed **Someone else** that opens *Their name* / *How they're related*.

  > **Exactly one chip is selected, always, and openness is DERIVED — not stored.**
  >
  > Storing it and seeding from `initial.holder` looked right and was wrong: every saved holder is
  > *also* a suggestion (`distinctHolders()` returns all of them), so editing a document filed for
  > Priya lit **her chip and the dashed one together**, with an editable second copy of her name
  > below. Choosing **Me** then left an empty *Their name* open beneath it, reading as a required
  > field. Both bugs were invisible to tests asserting on the submitted payload — the payload was
  > correct the whole time — and took *rendering the edit screen* to find (debt D37/D64).
  >
  > So: open when the current name has no chip, or when the user asked. Picking any chip closes it.
- **Create / edit** — title-first, everything else progressively disclosed; **title is the only required
  field** and is drawn by border weight rather than an asterisk. Capture friction is the main risk
  ([product/brain.md](../product/brain.md) principle 2). Add opens a **bottom sheet** from the tab bar
  and stays open after saving to offer optional next steps; `/documents/new` remains a real route for
  deep links.
- **Upload** — the OS picker, which offers camera, photo library and files. `capture` is
  deliberately **not** set: with it, a phone opens the camera and *only* the camera. Progress is real
  (`XMLHttpRequest`, because `fetch` cannot report it), and too-large / unsupported / dropped-connection
  are three separate inline states on the row they belong to.
- **The type picker is a row of pills, never a `<select>`** — ADR-0025 §7. There is no dropdown anywhere
  in the app.

## 8. Cross-domain links

Anticipated, not built. Recorded because cross-domain links are where the value
concentrates ([product/brain.md](../product/brain.md) principle 4).

| To | Relationship | Notes |
|---|---|---|
| **Assets** | A warranty or receipt documents an asset | Likely `asset_id` on `documents`, or a join table if many-to-many |
| **Money** | A receipt evidences a transaction | Probably a join table |
| **People** | `issuer` becomes a real person or organization record | The free-text → entity upgrade in §9 |
| **Vault** | A document references a credential (a policy and its login) | Careful: the link crosses Tier 0 and Tier 2. The *existence* of a link is Tier 0 metadata; do not leak vault content into it |

## 9. Open questions

Domain-internal. Product-level questions live in
[product/open-questions.md](../product/open-questions.md).

1. **`issuer` as free text vs an `issuers` table.** Paperless-ngx models it as a
   `correspondents` table ([prior-art.md](../prior-art.md) §1), which is cleaner once there
   are hundreds of documents and is the natural bridge to People. Starting with free text
   plus autocomplete-over-distinct because it needs no extra UI. Revisit when the archive
   passes ~100 documents.
2. **User-defined `custom_attrs` fields.** The per-type shapes are now specified in §3 and
   validated by a Zod discriminated union, so this is settled for the built-in types. Still
   open: whether users can add their own fields later. That needs a field-metadata table,
   not just JSONB, and would weaken the Zod contract — deferred until there is evidence
   anyone wants it.
3. **Client-side vs server-side thumbnails.** Client-side is free and immediate; server-side
   is consistent and cacheable. Deferred to M2.
4. **Whether `reminders` should carry a nullable `document_id` FK** alongside the
   polymorphic key, purely to get referential integrity for the common case. Rejected for
   now as inconsistent, which is why rule 10's sweep job exists — but the trade is real.
5. **Duplicate detection.** `sha256` is stored **when the client sends it**, and nothing acts on
   it yet. Warn on re-uploading identical bytes, or allow it silently?

   Built as optional rather than required, which §3's `not null` originally implied: the browser
   would have to read the whole file to hash it before uploading, doubling the work on a phone, for
   a feature nobody has asked for. The column is nullable and the API records what it is given.

## 10. Files

Real paths, as built.

```
apps/api/src/domains/documents/
  documents.routes.ts              HTTP. Read the `::` block comment before adding a route
  documents.service.ts             metadata rules 1, 2, 6, 7, 8, 9
  documents.files.service.ts       the upload state machine — rules 3, 4, 5, 10, 11
  documents.repository.ts          the only SQL. See the note on `fileCountSql`
  documents.schema.ts              Drizzle tables, re-exported from db/schema/index.ts
  documents.test.ts                metadata, list, search, pagination, cross-space
  documents.files.test.ts          the file lifecycle
apps/api/src/domains/reminders/
  reminders.repository.ts          reminders + push_subscriptions
  reminders.service.ts
  reminders.routes.ts              the endpoints NOT nested under a document
  reminders.test.ts                endpoints and the job handlers, called directly
apps/api/src/jobs/reminders.ts     scan · deliver · sweep
apps/api/src/lib/storage.ts        R2 presigning; the ONLY place an object key is built
apps/api/src/lib/push.ts           Web Push (webpush-webcrypto, MIT — not web-push, MPL-2.0)
apps/api/src/lib/cursor.ts         keyset pagination, shared across domains
apps/api/src/lib/idempotency.*     Idempotency-Key, closing debt D9
packages/shared/src/documents.ts   Zod contract, incl. custom_attrs per doc_type
packages/shared/src/reminders.ts   the generic half
apps/web/src/features/documents/   list, detail, form, files, reminders, expiry badge
apps/web/src/routes/_authed/library.tsx         the archive, as a scope (ADR-0032)
apps/web/src/routes/_authed/documents.*.tsx     detail and new; index.tsx is now a redirect
apps/web/src/components/TabBar.tsx persistent app chrome — read it before adding a route
apps/web/src/components/ui/skeleton.tsx
apps/web/public/push-sw.js         without this, a delivered notification shows nothing
scripts/generate-icons.mjs         rasterises favicon.svg into the PWA icons (D16)

apps/api/src/jobs/documents-extract.ts   (planned)  M2 — OCR
```

**Two files this doc did not originally anticipate.** `documents.files.service.ts` exists because
the upload lifecycle is a separate state machine and one 600-line service would have buried the
metadata rules. `apps/web/public/push-sw.js` exists because `userVisibleOnly: true` obliges every
push to show a notification, so a worker with no `push` listener receives the message and displays
nothing — the reminder feature ends in that file, not in the API.
