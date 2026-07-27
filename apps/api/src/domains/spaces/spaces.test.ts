import type { FastifyInstance } from 'fastify'
import { afterAll, beforeAll, expect, it } from 'vitest'
import { buildApp } from '../../app.js'
import type { ActorContext } from '../../auth/actor.js'
import { listMembershipsForUser } from '../../auth/memberships.repository.js'
import { describeDb, withCleanDatabase } from '../../test/db.js'
import { seedUserWithSpace } from '../../test/factories.js'
import { listForActor } from './spaces.repository.js'

/**
 * The M0 form of the mandatory isolation test (conventions/testing.md §2).
 *
 * There is no domain table yet, so there is no `GET /documents/:id` to attempt cross-space. The
 * equivalent at this milestone is: an actor cannot see another actor's space through the
 * repository that `/me` reads, even when handed that space's id.
 */
describeDb('spaces.repository.listForActor', () => {
  let app: FastifyInstance
  withCleanDatabase()

  beforeAll(async () => {
    app = await buildApp({ startJobs: false })
    await app.ready()
  })

  afterAll(async () => {
    await app.close()
  })

  /** Built from real memberships, the way the actor hook does. Never invented field by field. */
  async function actorFor(userId: string): Promise<ActorContext> {
    const memberships = await listMembershipsForUser(userId)
    const first = memberships[0]
    if (first === undefined) throw new Error('fixture user has no membership')
    return {
      userId,
      spaceIds: memberships.map((membership) => membership.spaceId),
      role: first.role,
    }
  }

  it('returns only the actor own space', async () => {
    const alice = await seedUserWithSpace(app)
    await seedUserWithSpace(app)

    const result = await listForActor(await actorFor(alice.userId))

    expect(result).toHaveLength(1)
    expect(result[0]?.role).toBe('owner')
    expect(result[0]?.kind).toBe('personal')
  })

  it('returns nothing when handed another user space id — the filter, not the caller, decides', async () => {
    const alice = await seedUserWithSpace(app)
    const bob = await seedUserWithSpace(app)
    const bobActor = await actorFor(bob.userId)

    // A forged actor: Alice's user id with Bob's space id. This is precisely the shape of a
    // cross-space attempt, and the query must return nothing because BOTH predicates apply.
    const forged: ActorContext = {
      userId: alice.userId,
      spaceIds: bobActor.spaceIds,
      role: 'owner',
    }
    const result = await listForActor(forged)

    expect(result).toEqual([])
  })

  it('returns nothing for an actor with no spaces at all', async () => {
    const alice = await seedUserWithSpace(app)

    const result = await listForActor({ userId: alice.userId, spaceIds: [], role: 'member' })

    expect(result).toEqual([])
  })
})
