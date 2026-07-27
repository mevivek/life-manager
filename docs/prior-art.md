# Prior art

Researched July 2026, before any code was written. The point of this document is to save a
future session from re-deriving decisions that already have public evidence behind them,
and to record what we deliberately are *not* building.

Four categories exist. None is what life-manager is, but each teaches something.

---

## 1. Self-hosted document archives — the closest architectural comparable

### Paperless-ngx

Mature, Python, large community. The reference implementation for "scan everything, find
anything."

**Its data model, which we independently arrived at:** all metadata lives in Postgres —
titles, correspondents, tags, dates, and the extracted full text used for search. Files
live in object storage under system-managed names, never user-supplied ones. Document
ingestion runs as background worker jobs.

**Worth borrowing:**

- Modelling the sender/issuer as its own `correspondents` table rather than a free-text
  column. We start with free text for simplicity but record this as the upgrade path —
  see the open question in [domains/documents.md](domains/documents.md).
- Background ingestion as a job pipeline, not inline in the upload request.
- Storing extracted text as a first-class column feeding the search index.

**Worth avoiding:** its five-service deployment — web UI, API, consumer, Celery workers,
Redis broker. That is a lot of infrastructure for a personal app. We get the same
capability from pg-boss on the Postgres we already run
([ADR-0012](decisions/0012-pg-boss-background-jobs.md)).

### Papra

The single closest comparable to this project: TypeScript, minimal, single maintainer,
small deployment footprint, organized around **organizations** as the ownership boundary.

That last point is independent confirmation of
[ADR-0006](decisions/0006-space-based-ownership.md) — a solo-built document app still
reached for a group-ownership primitive rather than a bare `user_id`. Papra is positioned
explicitly as the lightweight alternative to Paperless-ngx, which is roughly the
positioning life-manager's Documents domain occupies too.

---

## 2. Commercial family vaults — the product category

**Trustworthy**, **Everplans**, **FutureVault**.

These validate the product concept and, more importantly, the direction of travel.
Trustworthy's entire pitch is a shared "family operating system" — the ownership model
this project chose on day one.

**Their document taxonomy** — passports, birth certificates, Social Security cards,
driver's licenses, marriage certificates, wills, trusts, powers of attorney, insurance
policies — maps almost exactly onto our `doc_type` enum. Reasonable evidence the enum is
cut along the right lines.

**Their headline features worth stealing later, not in v1:**

- Email-inbox ingestion: forward a receipt or policy to an address and it files itself.
- AI-extracted renewal dates from uploaded scans.

Both are on [roadmap.md](roadmap.md) (M4+). Both are only possible because their data is
server-readable — see §5.

---

## 3. Expiry-reminder apps — the most useful finding in the survey

**GetReminded**, **DocuReminder**, **RemindMe**, **Warranty Keeper**.

An entire product niche exists for *nothing but* tracking expiry dates — passports, visas,
insurance, warranties, rental agreements, work IDs. Several of these apps store no
documents at all. They just track dates and notify.

**The lesson: reminders, not storage, are the feature people actually pay for.** Storage is
commodity — Google Drive already does it, for free, with better apps.

**Concrete effect on this project:** the generic `reminders` table is a **first-milestone
deliverable**, not a follow-up. A Documents domain that stores files but doesn't tell you
your passport expires in 90 days has built the commodity half and skipped the valuable
half. See [roadmap.md](roadmap.md) M1.

---

## 4. Privacy-first on-device vaults — the road not taken

**Travel Document Vault**, **Passport.app**.

The opposite trade: documents encrypted on-device, no server, often no account at all.

What they give up, permanently: cross-device sync, search inside a document, OCR,
server-side reminders that fire when the phone is off, and any form of family sharing.

That is precisely the set of trades this project declined. Recorded here so a future
session doesn't propose "let's encrypt everything end-to-end" without knowing what it
costs.

---

## 5. Why this survey supports the Tier 0 decision

Reading the four categories together produces the strongest argument for
[ADR-0009](decisions/0009-sensitivity-tiers.md):

Every capability that separates a good document manager from a folder of PDFs — OCR,
search-inside-document, auto-extracted expiry dates, previews, reminders that work while
your phone is off — **requires a server that can read the data.** Paperless-ngx, Papra, and
Trustworthy all have these features. Travel Document Vault and Passport.app cannot, and
never will.

Keeping documents server-readable is therefore not a shortcut taken for simplicity. It is
what keeps the entire feature set of the good products in this category reachable.
End-to-end encryption is reserved for the one domain where the trade genuinely inverts —
the password vault, where there is nothing useful to compute server-side anyway.

---

## What life-manager is that none of these are

Each product above solves one domain. Paperless-ngx does documents. Firefly III does
money. Homebox does physical inventory. Monica does people. Bitwarden does secrets. Wallos
does subscriptions.

The bet here is that **one coherent model across all of them** is worth more than any one
of them individually — because the interesting queries cross domains. *What does this
warranty cover, what did it cost, who sold it to me, and when does it expire?* No
single-domain tool can answer that.

That is also the main risk: scope. The mitigation is the domain structure — one domain at
a time, each fully specified before it is built, each isolated enough that a future
session can work on it without reading the others. See
[agent-playbooks/add-a-domain.md](agent-playbooks/add-a-domain.md).

---

## Sources

- [Papra vs Paperless-ngx](https://papra.app/en/papra-vs-paperless-ngx/)
- [Best apps for digital storage of personal and identity documents (2026)](https://www.quicken.com/blog/best-apps-for-digital-storage-and-organization-of-personal-and-identity-documents-2026/)
- [Household document and renewal reminder tools (2026)](https://www.quicken.com/blog/top-apps-and-tools-for-household-document-and-renewal-reminders-2026/)
- [GetReminded](https://www.getreminded.com/faq/)
- [awesome-selfhosted — money & document management](https://awesome-selfhosted.net/)
- [FutureVault — personal life management vault](https://www.futurevault.com/personal-life-management-vault/)
