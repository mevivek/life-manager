# Domain: Documents

- **Status:** planned
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
| `identifier_last4` | `text null` | **Last 4 characters only.** Never store a full passport or account number — §4 rule 6 |
| `issued_on` | `date null` | |
| `expires_on` | `date null` | **`date`, not timestamp.** A passport expires on a day, not an instant |
| `country` | `char(2) null` | ISO 3166-1 alpha-2 |
| `notes` | `text null` | |
| `tags` | `text[] not null default '{}'` | |
| `custom_attrs` | `jsonb not null default '{}'` | Type-specific fields, Zod-validated per `doc_type` ([conventions/data.md](../conventions/data.md) §5) |
| `search_vector` | `tsvector generated stored` | Weighted: title A, issuer B, notes/tags C |

Indexes: `(space_id) where deleted_at is null`, `(space_id, expires_on) where deleted_at is
null` (the reminder scan and the default sort), GIN on `search_vector`.

### `document_files`

A specific uploaded file. Versioned — renewing a passport must not destroy the old scan.

| Column | Type | Notes |
|---|---|---|
| `document_id` | `uuid not null` | → `documents(id)`, cascade |
| `version` | `int not null` | Monotonic per document, starting at 1 |
| `storage_key` | `text not null` | **Chosen by the API**: `spaces/{spaceId}/documents/{documentId}/{fileId}` |
| `mime` | `text not null` | Validated against an allowlist |
| `size_bytes` | `bigint not null` | |
| `sha256` | `text not null` | Integrity, and duplicate detection |
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
6. **Never store a full identifier.** Passport numbers, account numbers, and national IDs
   are truncated to `identifier_last4` at the API boundary. The full number is on the scan,
   which is access-controlled; a plaintext column is a needless liability.
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
       ?sort=expires_on|created_at|title   ?order=asc|desc
       Default sort: expires_on asc, nulls last — the useful default, not created_at

POST   /api/v1/documents
GET    /api/v1/documents/:id                 includes files[] and reminders[]
PATCH  /api/v1/documents/:id
DELETE /api/v1/documents/:id                 soft delete

POST   /api/v1/documents/:id/files:presign-upload
       → { fileId, uploadUrl, storageKey, expiresAt }
POST   /api/v1/documents/:id/files:confirm    → records the row, enqueues OCR
POST   /api/v1/documents/:id/files/:fileId:presign-download
DELETE /api/v1/documents/:id/files/:fileId
PATCH  /api/v1/documents/:id/files/:fileId    is_primary only

GET    /api/v1/documents/:id/reminders
POST   /api/v1/documents/:id/reminders        { due_on, lead_days, channel }
DELETE /api/v1/reminders/:id
POST   /api/v1/reminders/:id:dismiss
```

Notable: `413` when the declared `sizeBytes` exceeds the limit — checked at presign time,
before any bytes move. `409` on a `:confirm` for a file already confirmed.

## 6. Background jobs

Registered with pg-boss ([ADR-0012](../decisions/0012-pg-boss-background-jobs.md)).

| Job | Trigger | Does | On failure |
|---|---|---|---|
| `reminders.scan` | cron, daily 08:00 UTC | Find `due_on - lead_days <= today` and `sent_at is null`; enqueue one `deliver` per reminder | Retry with backoff; alert after 3 failures — a silent scan failure means silent missed renewals |
| `reminders.deliver` | queued | Send via `channel`; set `sent_at` | Retry 3×; leave `sent_at` null so the next scan retries |
| `documents.extract-text` | on `:confirm` (M2) | OCR → `document_text`; refresh search | Retry 2×, then give up. The document stays usable without extracted text |
| `documents.sweep-abandoned` | cron, daily | Delete unconfirmed file rows >24h old and their orphaned R2 objects | Retry next run |

## 7. UI surface

- **Dashboard / home** — expiring in 30 and 90 days, recently added, documents with no file.
  Proposed as the default route ([product/idea-backlog.md](../product/idea-backlog.md)).
- **Document list** — search, filter by type and tag, sorted by expiry. Expiry badges.
- **Document detail** — metadata, file versions, reminders, inline preview (M2).
- **Create / edit** — title-first, everything else progressively disclosed. Capture friction
  is the main risk ([product/brain.md](../product/brain.md) principle 2).
- **Upload** — drag-drop and camera capture, with progress.
- **Expiring soon** — a focused actionable list.

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
2. **Where `custom_attrs` schemas live.** A Zod discriminated union on `doc_type` in
   `packages/shared` is the plan. Unresolved: whether users can define their own fields
   later — that would need a metadata table, not just JSONB.
3. **Client-side vs server-side thumbnails.** Client-side is free and immediate; server-side
   is consistent and cacheable. Deferred to M2.
4. **Whether `reminders` should carry a nullable `document_id` FK** alongside the
   polymorphic key, purely to get referential integrity for the common case. Rejected for
   now as inconsistent, which is why rule 10's sweep job exists — but the trade is real.
5. **Duplicate detection.** `sha256` is stored, but nothing acts on it yet. Warn on
   re-uploading identical bytes, or allow it silently?

## 10. Files

All `(planned)` — the domain is not built.

```
apps/api/src/domains/documents/
  documents.routes.ts        (planned)
  documents.service.ts       (planned)
  documents.repository.ts    (planned)
  documents.schema.ts        (planned)  Drizzle tables
  documents.test.ts          (planned)
apps/api/src/domains/reminders/          (planned)  generic, not Documents-owned
apps/api/src/jobs/reminders.ts           (planned)
apps/api/src/jobs/documents-extract.ts   (planned)  M2
packages/shared/src/documents.ts         (planned)  Zod schemas
apps/web/src/features/documents/         (planned)
```
