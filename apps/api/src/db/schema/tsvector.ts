import { customType } from 'drizzle-orm/pg-core'

/**
 * Postgres `tsvector`. Drizzle has no built-in for it, so this is the one wrapper the whole
 * codebase uses — conventions/code.md §5's "isolate it in one place with a comment".
 *
 * `driverData: string` because that is what `node-postgres` hands back for a tsvector, and
 * nothing reads the column in application code anyway: it is written by Postgres (a generated
 * column, conventions/data.md §6) and only ever appears in a `WHERE` or `ORDER BY`. Selecting
 * it would be pointless — the searchable text is already in `title`, `issuer`, `notes`, `tags`.
 */
export const tsvector = customType<{ data: string; driverData: string; notNull: true }>({
  dataType() {
    return 'tsvector'
  },
})
