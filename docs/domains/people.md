# Domain: People

- **Status:** **built**, both halves, in one session. Smaller than it sounds — see §3
- **Milestone:** pulled forward from *Beyond* by design handoff 5, on an explicit human yes
  (invariant 12) recorded 2026-07-31. [ADR-0034](../decisions/0034-people-is-a-directory.md)
- **Sensitivity tier:** **0 — server-readable.** A name and a relation. Not vault material
  ([ADR-0009](../decisions/0009-sensitivity-tiers.md))
- **Depends on:** Documents and Things, for the `holder` strings §4 rule 3 rewrites

## 1. Purpose

People is **the list of names you file under** — your wife, your son, the household — so that
*"whose is this?"* has a set of answers you maintain rather than a string you retype.

That is the whole of it. It is the smallest domain in the app and it is deliberately small.

## 2. Scope

**In scope:** a name, an optional relation, and the ability to rename or remove one.

**Out of scope, and each for a reason:**

- **Accounts, invitations, sharing, permissions.** Nobody in here can sign in, is notified, or can see
  anything. The screen says so: *"Nobody here has an account and nobody gets notified — it's your
  filing, kept under their name."* Multi-user sharing belongs to **Spaces**
  ([ADR-0006](../decisions/0006-space-based-ownership.md)), which already exists and is a different
  idea entirely — a space is who can *read* the archive, a person is whose *name is on a document*.
- **Documents or things a person owns in their own right.** A record is filed **for** someone; it is
  not theirs. If that distinction ever needs to be real, it is the trigger in ADR-0034 to revisit.
- **Contact details, birthdays, photographs.** No field here exists that the filing does not need.

## 3. Entity model

**One table, and nothing points at it.** That is the decision
([ADR-0034](../decisions/0034-people-is-a-directory.md)), not an omission.

| Column | Type | Notes |
|---|---|---|
| `id` | `uuid pk` | |
| `space_id` | `uuid not null` | Invariant 2. Every query filters on it |
| `name` | `text not null` | **Also the join key** — `documents.holder` holds a copy of this string |
| `relation` | `text` | "Wife", "Son (12)". A display aid; the comp says it is there *"to tell two Aruns apart"* |
| `version` | `integer not null` | ADR-0024's precondition counter — a user edits this row |
| `created_at` · `updated_at` · `deleted_at` | | Universal columns |

**`documents.holder`, `documents.relation`, `things.holder` and `things.relation` are unchanged.**
This domain adds tables and endpoints and alters no existing shape, which is why it carries **no
deploy-ordering hazard** (debt D54).

> ### Why a string and not a foreign key
>
> Because the comp requires two things a foreign key cannot do:
>
> - *"Removing them leaves the documents alone."*
> - *"The 4 records filed under them **keep the name** — they just stop being offered as a choice."*
>
> A FK on delete must `SET NULL` (the records lose the name), `RESTRICT` (the button fails on exactly
> the people who have anything filed) or `CASCADE` (deletes the user's documents). All three
> contradict the design. The full argument, the alternatives and the revisit trigger are in ADR-0034 —
> **read it before proposing `person_id`.**

## 4. Business rules

Numbered and testable; each maps to a test in `apps/api/src/domains/people/people.test.ts`.

1. **A name is the only required field.** The relation is optional, exactly as one required field per
   track is the rule everywhere else in this app (Q2, [ADR-0030](../decisions/0030-capture-as-a-stepped-wizard.md)).
2. **A person is space-scoped.** Cross-space reads return **404, never 403** (invariant 4).
3. **Renaming a person rewrites every record filed under the old name, in one transaction.**
   `documents.holder` and `things.holder` are updated where they equal the old name, within the actor's
   space only. The response reports how many of each were touched, because the app says so on screen
   and the client cannot count rows it has not loaded.
4. **Removing a person is a soft delete of the directory row and nothing else.** No document or thing
   is read or written. The name stays on every record; it just stops being offered.
5. **`version` is a required precondition on both `PATCH` and `DELETE`.** A stale write is a **409**,
   never a silent last-write-wins (ADR-0024, debt D41).
6. **The directory is not the only source of names.** `GET /documents/holders` still derives names
   from the records themselves, so a holder typed during capture before anyone was added to People is
   still offered. The Whose sheet unions the two — a name can exist in the records, in the directory,
   or both.
7. **Two people with the same name are one person, as far as filing goes.** Accepted, and visible
   rather than silent: this is a single household's archive, and the relation is the tie-breaker on
   screen. See ADR-0034 § *The cost, stated plainly*.

## 5. API surface

```
GET    /api/v1/people                  → { data: Person[] }   counts included, no cursor (§9.1)
POST   /api/v1/people                  → Person, 201
PATCH  /api/v1/people/:id              → { person, documents_updated, things_updated }
DELETE /api/v1/people/:id?version=     → 204
```

`document_count` and `thing_count` on each row are computed server-side — the remove sheet states the
number, and a client counting a loaded page would be counting one page.

## 6. Background jobs

None. Nothing here expires, and nothing about a name needs watching.

## 7. UI surface

- **`/people`** — reached from a row on **You**, not from the tab bar. It is a setting-shaped list,
  not a collection, and the bar is full at three
  ([design.md §8](../conventions/design.md)). A "You" row sits first, for everything with no holder.
- **`/people/$personId`** — that person's documents *and* things in one dated list, rendered with the
  same `DocumentRow` / `ThingRow` the library uses, through `libraryDocumentRowProps` so a row is one
  shape everywhere ([ADR-0033](../decisions/0033-handoff-5-the-rest.md)).
- **The person sheet** — add and edit, with the relation suggestions from `RELATION_SUGGESTIONS` plus
  free text. On edit it carries Remove, and the note stating how many records keep the name.
- **`RelationField`** (`features/people/RelationField.tsx`) — **the only relation field**, on all
  three surfaces that ask: this sheet, the capture wizard's Whose step, and the full document form.
  The last two shipped as a bare input with no suggestions, which meant the answer list depended on
  which door you came in through. Chips rather than a `<select>`, per
  [design.md §6](../conventions/design.md) — the eight fit on a 390px screen, and the value is free
  text a closed list could not express. `RelationField.test.tsx` asserts all three use it.
- **The "Whose document is this?" sheet** on a document's detail, which is what made the Whose field
  editable at last — it had been a no-op since the field was added.

## 8. Cross-domain links

**This is the domain that exists to be linked from**, and the link is a string rather than a key.

- **Documents** — `holder`, rewritten by rule 3.
- **Things** — `holder`, the same.
- **Spaces** — deliberately unrelated; see §2.
- **The Vault (M5)** — if it ever files under a person, it inherits this shape for free, and inherits
  rule 7's collision caveat with it.

## 9. Open questions

1. **No cursor on the list.** A household's directory is a handful of names, so paging it would be
   ceremony. Adding a cursor later is additive. Revisit if anyone ever has fifty.
2. **A rename is not atomic with respect to readers.** A client mid-load during a rename can see a
   mix of old and new. The transaction means the *database* is never inconsistent. Accepted for a
   single-user app.
3. **Merging two people is not offered.** If a name was typed two ways ("Priya", "priya"), the fix is
   to rename one to the other — which works, and merges them by side effect, but is not signposted.

## 10. Files

```
packages/shared/src/people.ts                    the contract
apps/api/src/domains/people/people.schema.ts     the one table
apps/api/src/domains/people/people.repository.ts actor-first, space-filtered (invariant 3)
apps/api/src/domains/people/people.service.ts    rule 3's transaction lives here
apps/api/src/domains/people/people.routes.ts     §5
apps/api/src/domains/people/people.test.ts       rules 1–7
apps/web/src/features/people/                    hooks, the list, the sheets
apps/web/src/routes/_authed/people.tsx           the directory
apps/web/src/routes/_authed/people.$personId.tsx one person's records
```
