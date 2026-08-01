# ADR-0034: People is a directory of names, not a foreign key

- **Status:** accepted
- **Date:** 2026-07-31
- **Supersedes:** —
- **Superseded by:** —

## Context

Design handoff 5 draws a **People** sub-domain: a list under You, a person detail screen, an
add/edit/remove sheet, and a *"Whose document is this?"* sheet on a document's detail. It was deferred
as debt **D84** on 2026-07-31 and the maintainer has now asked for it, which is the human yes
invariant 12 requires.

Today `holder` is a plain `text` column on both `documents` and `things`, with a sibling `relation`,
and `GET /documents/holders` derives the list of people by `SELECT DISTINCT`. There is no `people`
table.

The obvious reading of *"turn `holder` from a label into a record"* is a foreign key:
`documents.person_id → people.id`. **The comp says otherwise, in two sentences that are only
satisfiable without one.**

> Renaming someone renames them everywhere they're filed. **Removing them leaves the documents alone.**

> The 4 records filed under them **keep the name** — they just stop being offered as a choice.

A foreign key cannot do that. Removing a person would have to `SET NULL` (the records lose the name,
contradicting both sentences), `RESTRICT` (the remove button fails on exactly the people who have
anything filed, which is all of them), or `CASCADE` (deletes the user's documents, which is absurd).

## Decision

**`people` is a directory: a list of names the user maintains, offered as choices.** The `holder`
string on a document or a thing stays the source of truth for what that record is filed under.

- **New table `people`** — `space_id` (invariant 2), `name`, `relation` nullable, `versioned()`
  because a user edits it, soft delete. No column anywhere points at it.
- **`documents.holder` and `things.holder` are untouched**, as are their `relation` columns and every
  existing response shape. This domain adds tables and endpoints; it changes none.
- **Rename is a bulk update, and it is the one place the two halves meet.**
  `PATCH /api/v1/people/:id` with a changed `name` also updates `holder` on every document and thing
  in the space that currently matches the old name, in **one transaction**. That is what makes
  *"renames them everywhere they're filed"* true.
- **Remove is a soft delete of the directory row and nothing else.** The records keep their `holder`
  string; the name simply stops being offered.
- **The directory is not the only source of names.** `GET /documents/holders` still derives names from
  the records themselves, so a holder typed during capture before anyone was added to People is still
  offered. The Whose sheet unions the two.

### Why this is the right shape and not merely the easy one

**It matches how the data is actually used.** A holder is a *label on a filing*, not a party to it —
nobody in `people` has an account, gets notified, or can sign in, and the comp says so on the screen:
*"Nobody here has an account and nobody gets notified — it's your filing, kept under their name."*
A foreign key models a relationship between two entities that both exist independently; this is one
entity with a name written on it.

**It keeps a rename honest about what it did.** With a FK, renaming is free and instant because nothing
was ever copied — but so is the failure mode where a person is deleted and four documents silently
lose their attribution. With strings, a rename is a real write over real rows, and the app can say how
many it touched.

**It is reversible.** Adding a `person_id` later is a migration; removing a FK that half the app
depends on is not. If People grows into something with its own facts — a date of birth, a contact,
their own documents — that is the trigger to revisit.

### The cost, stated plainly

Two records with the same holder string are the same person, and two people with the same name are
indistinguishable. That is accepted: this is a single household's archive, the comp's own relation
field exists precisely to *"help you tell two Aruns apart"* on screen, and a collision is visible
rather than silent.

A rename is also **not atomic with respect to readers** — a client mid-page-load during a rename can
see a mix. Accepted for a single-user app; the transaction means the database is never inconsistent.

## Alternatives considered

- **`person_id` foreign key on both tables.** Rejected above: it cannot express the comp's remove
  semantics, and it is a contract change to two shipped domains (a new field on `documentSchema` and
  `thingSchema` is a deploy-ordering hazard — debt D54) for a property nothing yet needs.
- **Both — a FK *and* the string, kept in sync.** Rejected: two sources of truth for one fact, and the
  first divergence is invisible. This is the shape that produces "the row says Priya and the join says
  Arun" with no way to know which is right.
- **No table at all; keep deriving people from `SELECT DISTINCT holder`.** This is today's behaviour
  and it *almost* works — the Whose chip already offers real names. It cannot do the two things the
  comp asks for: a person with **nothing filed yet** cannot exist (so "Add someone" has nowhere to put
  them), and a **relation** has nowhere to live except duplicated on every record.
- **Make `relation` authoritative on the person and drop it from the records.** Rejected as scope: the
  columns exist, are populated, and are returned in shipped responses. The directory's relation wins
  for display; the record's stays as a fallback and as history.

## Consequences

**Good:**

- Every existing response shape is unchanged, so there is **no deploy-ordering hazard** — the web and
  API can ship in either order (D54).
- A person can exist before anything is filed under them, which is what "Add someone" needs.
- Remove and rename both do exactly what the screen says they do.
- The domain is additive: new table, new routes, no migration of existing data.

**Bad, and real:**

- **Rename is O(rows) and touches two domains' tables from a third domain's service.** That is a real
  coupling, and it is confined to one transaction in one function so it is at least findable.
- **Same-name collisions are unresolvable.** Two people called Arun share one holder string, and the
  app cannot tell them apart. The relation is a display-level mitigation, not a fix.
- **`people` and the derived holder list can disagree** — a name typed at capture is offered but is
  not in the directory. The Whose sheet unions them, which is correct but means "the list of people"
  has two sources a reader has to know about.

**Revisit if:** People acquires facts of its own (a birthday, a contact, documents *they* own rather
than documents filed *for* them). That is the point at which a person becomes an entity rather than a
label, and a `person_id` earns its migration.
