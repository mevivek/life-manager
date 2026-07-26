# Domain: Documents

First domain being implemented (see [`CLAUDE.md`](../../CLAUDE.md)). Covers IDs,
certificates, contracts, warranties, and receipts — anything that's fundamentally
"a document about something," with an optional scanned/photographed attachment.

Status: **designed, not yet implemented.** No `apps/api` or `apps/web` code exists
yet — this doc describes the target shape so implementation can start directly from
it instead of re-deriving the design.

## Entity model

### `documents` table

| field | type | notes |
|---|---|---|
| `id` | uuid | PK |
| `user_id` | uuid | FK to auth user; see [`0003`](../decisions/0003-multiuser-from-day-one.md) |
| `title` | text | e.g. "Passport", "Laptop warranty" |
| `category` | enum | `identity` \| `financial_legal` \| `warranty_receipt` \| `certificate` |
| `issue_date` | date, nullable | |
| `expiry_date` | date, nullable | drives the expiry-reminder rule below |
| `tags` | text[] | free-form |
| `notes` | text, nullable | |
| `metadata` | jsonb | category-specific fields, see below |
| `created_at` / `updated_at` | timestamptz | |

`metadata` is jsonb rather than per-category tables so new category-specific fields
don't require a schema migration — consistent with
[`0005`](../decisions/0005-pre-v1-no-migration-discipline.md) not being a reason to
skip normal data-modeling judgment elsewhere.

Category-specific `metadata` shape (convention, validated in `packages/shared` once
it exists — not DB-enforced):
- **identity** — `documentNumber`, `issuingAuthority`, `country`
- **financial_legal** — `counterparty`, `contractValue`, `renewalTerms`
- **warranty_receipt** — `vendor`, `purchasePrice`, `purchaseDate`
- **certificate** — `issuingBody`, `credentialId`

### `document_files` table

One document can have multiple attachments (front/back scan, PDF, photo).

| field | type | notes |
|---|---|---|
| `id` | uuid | PK |
| `document_id` | uuid | FK to `documents.id` |
| `storage_path` | text | private Supabase Storage path; see [`0002`](../decisions/0002-supabase-for-auth-and-storage.md) |
| `file_name` | text | |
| `mime_type` | text | |

## Business rules

- **Expiry reminders**: a document with `expiry_date` within 30 days is flagged
  (list-view badge + dashboard banner e.g. "3 documents expiring soon"). No
  email/push delivery yet — in-app only for v1.

## Planned API surface (not yet built)

Under `/api/v1/documents`:
- `GET /` — list, filterable by `category`, `tag`, and an `expiringWithinDays` query
- `POST /` — create
- `GET /:id` — detail, including attached files
- `PATCH /:id` — update
- `DELETE /:id`
- `POST /:id/files` — attach a file (backend writes to Storage, returns signed URL)
- `DELETE /:id/files/:fileId`

All scoped to the authenticated user per
[`0003`](../decisions/0003-multiuser-from-day-one.md).

## Open questions (explicitly deferred, not decided)

- Reminder delivery beyond the in-app banner (email? push?) — not needed for v1.
- Whether `metadata` shape per category should be validated server-side beyond
  "it's an object" — likely yes once `packages/shared` exists, not decided in
  detail yet.
