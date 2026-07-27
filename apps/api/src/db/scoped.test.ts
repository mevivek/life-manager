import { PgDialect, pgTable, text, uuid } from 'drizzle-orm/pg-core'
import { describe, expect, it } from 'vitest'
import type { ActorContext } from '../auth/actor.js'
import { timestamptz } from './columns.js'
import { scoped } from './scoped.js'

/**
 * A pure unit test — no database. It compiles the predicate to SQL with Drizzle's own dialect
 * and asserts the text, which is the only way to prove BOTH halves of the filter are present
 * without a running Postgres.
 *
 * This is the highest-value test in the API. If `scoped()` ever emits only one predicate, or
 * matches everything for an actor with no spaces, every domain endpoint built on top of it
 * leaks — and nothing else in the suite would notice.
 */

// A stand-in for a future domain table. Not exported to the real schema.
const widgets = pgTable('widgets', {
  id: uuid('id').primaryKey(),
  spaceId: uuid('space_id').notNull(),
  deletedAt: timestamptz('deleted_at'),
  title: text('title'),
})

const dialect = new PgDialect()
const toSql = (actor: ActorContext) => dialect.sqlToQuery(scoped(actor, widgets))

const actorWith = (spaceIds: string[]): ActorContext => ({
  userId: '11111111-1111-4111-8111-111111111111',
  spaceIds,
  role: 'owner',
})

describe('scoped()', () => {
  it('emits both the space filter and the soft-delete filter', () => {
    const query = toSql(actorWith(['22222222-2222-4222-8222-222222222222']))

    expect(query.sql).toContain('"space_id" in')
    expect(query.sql).toContain('"deleted_at" is null')
  })

  it('parameterises the space ids rather than interpolating them', () => {
    // security-model.md §6: parameterise every query. An interpolated id here would be an
    // injection point reachable from a session.
    const query = toSql(actorWith(['22222222-2222-4222-8222-222222222222']))

    expect(query.sql).not.toContain('22222222')
    expect(query.params).toEqual(['22222222-2222-4222-8222-222222222222'])
  })

  it('lists every space the actor belongs to', () => {
    const query = toSql(
      actorWith(['22222222-2222-4222-8222-222222222222', '33333333-3333-4333-8333-333333333333']),
    )

    expect(query.params).toHaveLength(2)
  })

  it('matches NOTHING for an actor with no spaces', () => {
    // Not "everything", which is what a dropped predicate or a naive `in ()` would mean.
    const query = toSql(actorWith([]))

    expect(query.sql.toLowerCase()).toContain('false')
    expect(query.params).toEqual([])
  })
})
