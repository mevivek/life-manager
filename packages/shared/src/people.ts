import { z } from 'zod'
import { isoDateTimeSchema, uuidSchema } from './common.js'

/**
 * People — **a directory of names you file under**, not parties to anything.
 * [ADR-0034](../../../docs/decisions/0034-people-is-a-directory.md).
 *
 * ═══════════════════════════════════════════════════════════════════════════════════════
 *  Nothing points at this table. That is the decision, not an omission.
 * ═══════════════════════════════════════════════════════════════════════════════════════
 *
 * `documents.holder` and `things.holder` stay plain strings. This domain is the **list of names the
 * app offers you**, and a rename is a bulk update over those strings rather than a join. The comp's
 * own two sentences are what force it:
 *
 *  - *"Renaming someone renames them everywhere they're filed. Removing them leaves the documents
 *    alone."*
 *  - *"The 4 records filed under them keep the name — they just stop being offered as a choice."*
 *
 * A foreign key cannot express that: removing a person would have to null the records, block the
 * delete, or cascade. Read ADR-0034 before proposing `person_id` — the alternative is argued there,
 * and the trigger for revisiting it is written down.
 *
 * **Nobody in here has an account.** No sign-in, no notification, no permission. Whose a document is
 * filed under is a *label*, exactly as `documents.md` §4 rule 13 says, and this changes none of that.
 */

export const MAX_PERSON_NAME_LENGTH = 120
export const MAX_RELATION_LENGTH = 60

/**
 * The relations offered as chips, from the comp. **Suggestions, never an enum on the wire** — the
 * field takes any string, because "Flatmate", "Business partner" and "Mother-in-law" are all real
 * answers and a closed list would make the app argue with its user about their own household.
 */
export const RELATION_SUGGESTIONS = [
  'Wife',
  'Husband',
  'Partner',
  'Son',
  'Daughter',
  'Mother',
  'Father',
  'Household',
] as const

export const personSchema = z.object({
  id: uuidSchema,
  space_id: uuidSchema,
  /**
   * What they are called, and **the join key to every record filed under them**.
   *
   * This is why a rename is a real write: `documents.holder` holds a copy of this string. Changing it
   * is `PATCH /people/:id`, which updates both in one transaction (ADR-0034).
   */
  name: z.string().min(1).max(MAX_PERSON_NAME_LENGTH),
  /**
   * "Wife", "Son (12)". Optional, and the comp says what it is for: *"The relation just helps you tell
   * two Aruns apart."* It is a display aid, not an identifier.
   */
  relation: z.string().max(MAX_RELATION_LENGTH).nullable(),
  /**
   * How many documents and things currently carry this person's name.
   *
   * Counted server-side because the remove sheet states it — *"The 4 records filed under them keep the
   * name"* — and a client that counted it from a loaded page would be counting one page.
   *
   * `.nullish().default(null)` and not `.nullable()`: the web and API deploy on separate triggers, so
   * a field the client *requires* takes the app down while the API lags (debt **D54**).
   */
  document_count: z.number().int().min(0).nullish().default(null),
  thing_count: z.number().int().min(0).nullish().default(null),
  /** ADR-0024's optimistic-concurrency counter. A `PATCH` must send the version it read. */
  version: z.number().int().min(1),
  created_at: isoDateTimeSchema,
  updated_at: isoDateTimeSchema,
})
export type Person = z.infer<typeof personSchema>

// ── Requests ─────────────────────────────────────────────────────────────────

/**
 * `POST /api/v1/people`.
 *
 * **One required field**, matching every other capture surface in this app (Q2, ADR-0030): a name is
 * enough, and the relation is offered but never demanded.
 */
export const createPersonSchema = z.strictObject({
  name: z.string().trim().min(1, 'A name is required').max(MAX_PERSON_NAME_LENGTH),
  relation: z.string().trim().max(MAX_RELATION_LENGTH).nullish(),
})
export type CreatePerson = z.infer<typeof createPersonSchema>

/**
 * `PATCH /api/v1/people/:id`.
 *
 * **`version` is required**, so a forgotten precondition is a type error rather than silent
 * last-write-wins — the rule `add-a-domain.md` §3 states for every editable table.
 *
 * Changing `name` here is the bulk rename: the service updates `documents.holder` and `things.holder`
 * for every row in the space that matched the *old* name, in the same transaction. That is the whole
 * of what "renames them everywhere they're filed" means (ADR-0034).
 */
export const updatePersonSchema = z.strictObject({
  version: z.number().int().min(1),
  name: z.string().trim().min(1).max(MAX_PERSON_NAME_LENGTH).optional(),
  relation: z.string().trim().max(MAX_RELATION_LENGTH).nullish(),
})
export type UpdatePerson = z.infer<typeof updatePersonSchema>

// ── Responses ────────────────────────────────────────────────────────────────

/**
 * `GET /api/v1/people`.
 *
 * **No cursor.** A household's directory is a handful of names, not a feed — paging it would be
 * ceremony around a list that fits on one screen. If that is ever wrong, adding a cursor is additive.
 */
export const personListResponseSchema = z.object({
  data: z.array(personSchema),
})
export type PersonListResponse = z.infer<typeof personListResponseSchema>

/**
 * `PATCH /api/v1/people/:id` — the person, plus what the rename actually touched.
 *
 * The counts are returned because the app **says** what it did (*"Renamed, and 4 records updated"*),
 * and a client cannot know: the rows it changed are in two other domains and may not be loaded. Zero
 * is a normal answer — renaming someone with nothing filed under them touches nothing.
 */
export const renamedResponseSchema = z.object({
  person: personSchema,
  documents_updated: z.number().int().min(0).nullish().default(0),
  things_updated: z.number().int().min(0).nullish().default(0),
})
export type RenamedResponse = z.infer<typeof renamedResponseSchema>
