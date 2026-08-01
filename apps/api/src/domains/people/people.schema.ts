import { pgTable, text } from 'drizzle-orm/pg-core'
import { primaryId, softDelete, timestamps, versioned } from '../../db/columns.js'
import { spaceScoped, spaceScopedIndex } from '../../db/schema/scoped-columns.js'

/**
 * The People table. Decided by
 * [ADR-0034](../../../../../docs/decisions/0034-people-is-a-directory.md).
 *
 * Re-exported from `db/schema/index.ts`, which is the single barrel `drizzle.config.ts` and
 * `db/client.ts` read — a table missing from it does not exist as far as migrations or the query
 * builder are concerned, and the failure is a silently absent table rather than an error
 * (agent-playbooks/add-a-domain.md §3, `scripts/check-schema-barrel.mjs`).
 *
 * ═══════════════════════════════════════════════════════════════════════════════════════
 *  NOTHING POINTS AT THIS TABLE. That is the decision, not an omission.
 * ═══════════════════════════════════════════════════════════════════════════════════════
 *
 * `documents.holder` and `things.holder` stay plain `text`. There is no `person_id` anywhere and
 * adding one is an ADR, not an edit — ADR-0034 argues the alternative and writes down the trigger
 * for revisiting it. The short version, in the comp's own two sentences:
 *
 *  - *"Renaming someone renames them everywhere they're filed."*  → a bulk `UPDATE` over those
 *    strings, in one transaction (`people.service.ts`'s `update`).
 *  - *"Removing them leaves the documents alone."*  → a soft delete of THIS row and nothing else.
 *
 * A foreign key can do neither: removing a person would have to null the records, block the delete,
 * or cascade.
 *
 * **Nobody in here has an account.** No sign-in, no notification, no permission — a holder is a
 * label on a filing (documents.md §4 rule 13), and `scoped()` remains the only thing deciding what a
 * caller may read (invariants 2 and 3).
 */
export const people = pgTable(
  'people',
  {
    id: primaryId(),
    ...spaceScoped(),
    ...timestamps(),
    ...softDelete(),
    /**
     * Optimistic concurrency — ADR-0024. A user edits this row, so it needs one, and its `PATCH`
     * takes `version` as a **required** field while its `DELETE` takes `?version=` (debt D41).
     *
     * It matters more here than on most tables: a stale `PATCH` would not merely overwrite a name,
     * it would rename every document and thing filed under whatever name the caller last read.
     */
    ...versioned(),

    /**
     * What they are called, and **the join key to every record filed under them** — the string
     * `documents.holder` and `things.holder` hold a copy of.
     *
     * Deliberately **not unique**. Two people called Arun are indistinguishable and ADR-0034 accepts
     * that in as many words ("the cost, stated plainly"); a unique index would turn a visible
     * collision into a failed "Add someone" on a real household.
     */
    name: text('name').notNull(),

    /**
     * "Wife", "Son (12)". A display aid, never an identifier — the comp: *"The relation just helps
     * you tell two Aruns apart."*
     *
     * Free text rather than an enum, because "Flatmate" and "Mother-in-law" are real answers;
     * `RELATION_SUGGESTIONS` in `packages/shared/src/people.ts` is a chip list, not a constraint.
     */
    relation: text('relation'),
  },
  (table) => [
    /**
     * `(space_id) where deleted_at is null` — conventions/data.md §2, and the only index this table
     * gets. The list is a household's handful of names read whole and sorted in memory-sized
     * quantities; an index for the `name` sort would be cost with no measurable win. Add one when a
     * real directory makes the sort visible in a query plan (the same call things.md §3 made).
     */
    spaceScopedIndex('people', table),
  ],
)
