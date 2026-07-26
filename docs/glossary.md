# Glossary

Shared vocabulary used across ADRs and domain docs. Keep terms defined here rather
than redefining them (possibly inconsistently) in each domain doc.

**Entity**
A record belonging to a domain (a Document, a Thing, a Transaction, a Person, a
Note, a Credential). Entities share cross-cutting attributes: tags, attachments,
links to other entities, reminder dates, timestamps.

**Domain**
A life area with its own data shape and its own doc under `docs/domains/`
(Documents, Things/Assets, Money, People, Notes, Vault). Each domain owns its
entity model and business rules; cross-domain relationships go through the shared
Links concept, not direct foreign keys between domain tables.

**Tier A / Tier B (sensitivity tiers)**
- **Tier A** — Documents, Things, Money, People, Notes. Encrypted at rest/in
  transit, server holds the keys, standard account auth.
- **Tier B** — the Vault (secrets/credentials). Zero-knowledge: a master password
  derives an encryption key client-side; the backend only ever stores ciphertext it
  cannot read. Architecturally a separate subsystem, not a flag on a Tier A table.

**Vault**
The secrets/password-manager domain (Tier B). Not yet implemented; deferred until
after the Documents domain proves out the entity/tag/attachment pattern, but its
zero-knowledge design should be settled before the data model grows large (see the
phasing discussion — not yet captured as an ADR since implementation hasn't started).

**ADR (Architecture Decision Record)**
A short file under `docs/decisions/` capturing one architectural decision as
**Context / Decision / Consequences**. Written so a future session understands
*why* something is the way it is without re-deriving it from git history or chat
logs that aren't visible to it.

**Links**
The mechanism by which entities in different domains reference each other (e.g. a
Thing referencing the Document that is its warranty) without domain tables having
hard-wired foreign keys into each other.
