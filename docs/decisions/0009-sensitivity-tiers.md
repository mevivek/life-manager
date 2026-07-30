# ADR-0009: Sensitivity tiers — no application-level encryption for ordinary data

- **Status:** accepted — **data-minimisation half amended by [ADR-0026](0026-store-the-full-identifier.md)**;
  the encryption decision below stands unchanged
- **Date:** 2026-07-26

## Context

This app stores identity documents, financial contracts, and eventually passwords. The
instinct is to encrypt everything end-to-end. That instinct is wrong for most of this data,
and it is worth writing down exactly why, because a future session will otherwise propose
it as an obvious improvement.

Two facts force the decision:

1. **Encryption and functionality trade against each other directly.** If the server cannot
   read the data, the server cannot OCR it, search inside it, extract an expiry date from
   it, generate a thumbnail of it, or send a reminder about it while the phone is off.
2. **Not all data has the same threat model.** A passport scan and a banking password are
   not equivalent risks. A passport scan is a copy of a document already shown to airlines,
   hotels, and banks. A stored password is a live credential.

[prior-art.md](../prior-art.md) settles the empirical question. Every product in this
category with good features — Paperless-ngx, Papra, Trustworthy — has a server that reads
the data. Every product that encrypts everything on-device — Travel Document Vault,
Passport.app — has none of those features, cannot sync, and cannot share.

## Decision

**Three sensitivity tiers. Every domain declares exactly one. No application-level
encryption for anything except the vault.**

| Tier | Name | Server can read | Applies to |
|---|---|---|---|
| **0** | Server-readable | Yes | **Everything today** — documents, files, assets, money, people, notes |
| **1** | Server-side encrypted | Yes (holds the keys) | **Nothing.** Reserved. |
| **2** | End-to-end encrypted | No | **The vault only** (future) |

**Documents and their files are Tier 0.** Deliberately. Neon and R2 encrypt at rest at the
infrastructure level — that is automatic, free, and is *not* what Tier 1 means.

Tier 1 exists in this table but is intentionally unused. It is the slot for a future domain
where a database dump is the threat but server-side functionality still matters — plausibly
financial account numbers. Do not implement it speculatively.

**What Tier 0 defends against:** a lost laptop, a stolen phone, a network attacker, and
other *users* of the system. **What it does not defend against:** a compromised server or a
malicious operator. For a self-hosted personal app, the operator is the user, so this is a
coherent position rather than a compromise.

## Alternatives considered

- **Encrypt everything end-to-end, including documents.** Maximum privacy. Rejected because
  it permanently forecloses OCR, search-inside-document, auto-extracted expiry dates,
  thumbnails, and server-side reminders — and reminders are the single most valuable
  feature in this category ([prior-art.md](../prior-art.md) §3). It also roughly doubles
  the complexity of the first domain, before any of it has proven useful. This trade was
  considered explicitly and declined.
- **Per-document opt-in encryption** — the user tags a document as vault-grade at upload.
  Genuinely appealing and the most honest match to how sensitive the data actually is.
  Rejected for v1 only on complexity: it doubles every file code path (upload, download,
  preview, search, OCR) at the exact moment the goal is to get one domain working. It
  remains the most likely future extension, and the tier model is designed to accommodate
  it without redesign.
- **Server-side encryption of document files (Tier 1) from day one.** Protects against a
  raw R2 bucket dump while keeping all functionality. Rejected as security theater in this
  deployment: the API holds the keys and runs next to the data, so anything that
  compromises the bucket most likely compromises the keys too. Real value would require a
  separate KMS, which is infrastructure this project does not have.
- **No tier model at all** — just encrypt the vault when it is built. Rejected because the
  tier vocabulary is what stops a future session from making an ad-hoc encryption decision
  in some other domain. The model costs one table in a doc and prevents drift.

## Consequences

**Good:** The first domain stays simple and shippable. OCR, previews, full-text search, and
reminders all remain reachable — that is what Tier 0 *buys*, not what it concedes. There is
one place ([security-model.md](../security-model.md) §4) that answers "is this encrypted?"
for any data in the system, and the answer is unambiguous.

**Bad:** Anyone with database and bucket access can read every document. That includes a
cloud provider under legal compulsion, and any future breach of the API host. This is a
real limitation and must be stated plainly to any future user of the app — not buried in a
privacy policy.

**Constraint on future work:** moving Documents to Tier 2 later is a **product decision
with permanent feature cost**, not a refactor. It requires a superseding ADR, a client-side
re-encryption migration of every file, and deleting OCR, previews, and server-side search.
Do not treat it as a security improvement to be slipped in.

**Revisit if:** the app goes public with other people's data on it. A hosted multi-user
service has a materially different threat model from a self-hosted personal one, and Tier 1
for files would then stop being theater and start being necessary.
