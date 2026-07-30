/**
 * The single schema barrel. `drizzle.config.ts` and `db/client.ts` both read only this file, so
 * **a table not re-exported here does not exist** as far as migrations or the query builder are
 * concerned.
 *
 * Foundation tables (auth, spaces) are defined in this folder. **Domain tables are defined in
 * their domain folder** — `domains/documents/documents.schema.ts` — per
 * agent-playbooks/add-a-domain.md §3 and conventions/code.md §3, and re-exported from here.
 * One folder per domain beats schema files living away from the code that queries them.
 */
export * from '../../domains/documents/documents.schema.js'
export * from '../../domains/things/things.schema.js'
export * from './auth.js'
export * from './idempotency.js'
export * from './scoped-columns.js'
export * from './spaces.js'
export * from './tsvector.js'
