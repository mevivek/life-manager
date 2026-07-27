# ADR-0008: Cloudflare R2 with API-minted presigned URLs

- **Status:** accepted
- **Date:** 2026-07-26

## Context

The Documents domain stores scans and PDFs — passports, contracts, receipts, warranties.
Files are read frequently from a phone (that is the point of the app) and written
occasionally. They must be private, isolated per space, and never publicly addressable.

Two questions: where the bytes live, and how they get there.

## Decision

**Cloudflare R2, private bucket, with the API minting short-lived presigned URLs. Bytes
never transit the API.**

### Storage

R2 is S3-compatible, so the standard AWS SDK works and the provider is replaceable. **Zero
egress fees** is the decisive property: this is a read-heavy personal archive accessed from
mobile, and every other major provider charges for exactly the operation the app exists to
perform. 10 GB free storage comfortably covers a personal document set.

The bucket has no public access. Ever.

### Transfer

```
1. Client → API    POST /documents/:id/files:presign-upload  { filename, mime, sizeBytes }
2. API             verify space membership, generate fileId,
                   CHOOSE the object key, mint a presigned PUT (minutes-long TTL)
3. Client → R2     PUT the bytes directly
4. Client → API    confirm; API records document_files, enqueues OCR
```

**The API always chooses the object key. The client never supplies one:**

```
spaces/{spaceId}/documents/{documentId}/{fileId}
```

This is the security property that makes direct-to-storage transfer safe. A malicious
client cannot address another space's objects because it never names anything — it receives
a URL scoped to one object it has already been authorized for. Any request body containing
a storage path is a design error.

Presigned URLs are short-lived (minutes) and single-purpose — a PUT URL cannot GET.
Download is the mirror image.

## Alternatives considered

**Where:**

- **AWS S3.** The default, most mature, best tooling. Rejected on egress pricing, which is
  the dominant cost for this access pattern. R2's S3 compatibility means the migration path
  back is short if ever needed.
- **Supabase Storage.** Convenient if Supabase were already the platform. It isn't
  ([ADR-0005](0005-postgres-neon-drizzle.md), [ADR-0007](0007-better-auth-self-hosted.md)),
  and its free tier is 1 GB against R2's 10 GB.
- **Backblaze B2.** Cheapest storage, S3-compatible, free egress up to a multiple of stored
  data. Close call; R2 wins on unconditional zero egress and on already being the CDN
  provider for the web app ([ADR-0014](0014-hosting-topology.md)).
- **Bytes in Postgres as `bytea`.** Transactional consistency with metadata, one backup to
  manage, no second provider. Rejected: it bloats the database, makes backups slow and
  expensive, blows through Neon's free storage almost immediately, and streams poorly.
  Databases are bad filesystems.

**How:**

- **Proxying bytes through the API.** Simpler to reason about, and the API could enforce
  every rule inline. Rejected: it doubles bandwidth, forces the API to buffer or stream
  large uploads, makes request timeouts a real problem on mobile connections, and turns a
  scale-to-zero container ([ADR-0014](0014-hosting-topology.md)) into a bandwidth
  bottleneck. The presigned pattern gets the same authorization guarantee — the API still
  decides — without moving the bytes.
- **Letting the client choose the object key.** Never. Path traversal and cross-space
  addressing follow immediately.
- **Long-lived or public URLs.** A leaked URL becomes permanent unauthenticated access to
  a passport scan.

## Consequences

**Good:** Uploads and downloads scale independently of the API. No egress cost on the
app's most common operation. S3 compatibility keeps the provider replaceable. The key
structure makes cross-space access structurally impossible rather than merely checked.

**Bad:** A second system that can drift from Postgres — an orphaned R2 object whose row was
deleted, or a row whose object failed to upload. Mitigations: the confirm step in the
upload flow, and a periodic reconciliation job. Client upload logic is more complex than a
single multipart POST (three round trips, retry handling). Deleting a document does **not**
delete its R2 objects ([conventions/data.md](../conventions/data.md) §3) — cleanup is a
separate job, deliberately, so an accidental delete stays recoverable.

Files are **Tier 0** — stored unencrypted at the application level
([ADR-0009](0009-sensitivity-tiers.md)). R2 encrypts at rest, which is not the same thing.

**Revisit if:** R2 changes its egress pricing, or the vault needs file attachments — E2EE
file uploads would encrypt client-side before the PUT, which this flow already supports
unchanged.
