# Glossary

Shared vocabulary. These words have precise meanings in this repo — use them exactly, in
code, docs, and commit messages. Where a term has a common alternative that we
deliberately do *not* use, that is noted.

---

**Actor** — the authenticated user performing a request, together with the spaces they may
act in. Represented as `ActorContext { userId, spaceIds, role }`. Every repository function
takes an actor as its first argument. See [security-model.md](security-model.md) §3.

**ADR** — Architecture Decision Record. A numbered, immutable document capturing one
decision, its context, and its consequences. Stored in [decisions/](decisions/). ADRs are
superseded, never edited in place. See [ADR-0015](decisions/0015-docs-as-orientation.md).

**Attachment** — *not used.* Say **file**.

**DEK** — Data Encryption Key. A random key encrypting exactly one vault item. Stored
wrapped under the Space Key. Vault-only concept. See
[security-model.md](security-model.md) §5.

**Document** — a record in the Documents domain: metadata (title, type, issuer, expiry)
plus zero or more **files**. A document is the logical thing ("my passport"); a file is a
specific scan of it. See [domains/documents.md](domains/documents.md).

**Domain** — one area of life the app models: Documents, Things, Money, People, Notes,
Vault. Each has exactly one doc in [domains/](domains/) and is designed to be worked on
without reading the others.

**Cover** — a **thing's** warranty period, and deliberately *not* an expiry. A document
expires and becomes invalid; a thing whose cover has **ended** keeps working. Four states
(`active` · `ending` · `ended` · `none`), drawn as a proportional bar rather than the expiry
gauge, with a 60-day boundary. Say *cover ended*, never *warranty expired*.
[ADR-0029](decisions/0029-the-things-domain.md).

**E2EE** — end-to-end encrypted. Ciphertext only server-side; the server holds no key and
cannot decrypt. **Tier 2**. Applies to the vault only.

**File** — the bytes of an uploaded document scan, stored in R2 and described by a
`document_files` row. Files are versioned; replacing a scan does not destroy the old one.

**Holder** — whose a record is, as a **label** and never a permission. Free text, `null` for
the account owner's own — and `null` is drawn as *absence*, so there is no "Me" badge
anywhere. On both documents and things. `space_id` remains the only thing deciding who may
read a record. [documents.md](domains/documents.md) §4 rule 13.

**KEK** — Key Encryption Key. Derived client-side from the vault passphrase via Argon2id.
Never leaves the client, never sent to the server. Vault-only.

**Owner** — the `role` of the user who created a space. Distinguished from **member**.
Not to be confused with "the owner of a record" — records belong to a *space*, not a user.

**Personal space** — the space auto-created for each user at signup, with that user as its
sole member. Structurally identical to a shared space; there is no special-casing.

**Presigned URL** — a short-lived, single-purpose URL minted by the API that lets a client
read or write one specific R2 object directly. The API always chooses the object key; the
client never supplies one. See [ADR-0008](decisions/0008-object-storage-r2.md).

**Recovery code** — a one-time code generated client-side at vault setup, forming a second
independent wrap of the user's private key. The only way back into a vault after a
forgotten passphrase. Never transmitted to the server. Vault-only.

**Reminder** — a scheduled notification tied to any entity via
`(entity_type, entity_id, due_on, lead_days)`. Generic on purpose so every domain reuses
one table. The most valuable feature of the Documents domain — see
[prior-art.md](prior-art.md) §3.

**Repository** — the only layer permitted to write SQL. Every function takes an actor and
filters by space. See [conventions/code.md](conventions/code.md).

**Sensitivity tier** — how readable a piece of data is to the server. **Tier 0**
server-readable (everything today), **Tier 1** server-side encrypted (reserved, unused),
**Tier 2** end-to-end encrypted (vault only). Every domain doc states its tier. See
[security-model.md](security-model.md) §4.

**Service** — the layer holding business rules and owning transactions. Knows nothing about
HTTP; calls repositories.

**Space** — **the unit of ownership and sharing.** Every domain record carries a
`space_id`. A space has members with roles. This is the tenant boundary. Chosen over a
plain `owner_id` because family sharing is near-term — see
[ADR-0006](decisions/0006-space-based-ownership.md).

**Space Key** — the symmetric key protecting a space's vault items, stored once per member,
each copy wrapped to that member's public key. Vault-only.

**Thing** — a record in the Things domain: a physical object a household owns (a car, a
laptop, a boiler, a gold chain). Has **cover**, a serial, a purchase price, a place it is
kept and a service cycle — and it *owns the documents that prove it*, via
`documents.thing_id`. A thing has no expiry and no issuer. Say **thing**, not "asset" or
"product": the design's own word, and the tab says Things.
[domains/things.md](domains/things.md).

**Tenant** — *avoid.* Say **space**. "Tenant" implies organizational isolation we don't
model.

**User** — an authenticated identity, managed by Better Auth in our own Postgres. A user is
a member of one or more spaces. Users do not own records; spaces do.

**Vault** — the future end-to-end encrypted secrets/password domain. Does not exist yet;
its cryptographic design is fixed in [security-model.md](security-model.md) §5 so building
it is additive.

**Wrap / wrapped** — encrypting a key with another key. "The DEK is wrapped under the Space
Key" means `encrypt(SpaceKey, DEK)` is what gets stored. Always say wrapped, never
"encrypted key", to keep key-on-key operations distinguishable from data encryption.
