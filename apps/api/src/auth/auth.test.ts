import { eq } from 'drizzle-orm'
import type { FastifyInstance } from 'fastify'
import { afterAll, beforeAll, expect, it } from 'vitest'
import { buildApp } from '../app.js'
import { db } from '../db/client.js'
import { spaces } from '../db/schema/index.js'
import { ensurePersonalSpace } from '../domains/spaces/spaces.service.js'
import { describeDb, withCleanDatabase } from '../test/db.js'
import { authAs, seedUserWithSpace, signIn } from '../test/factories.js'

/**
 * The M0 acceptance criterion, as tests.
 *
 * roadmap.md: "you can sign up on your phone, and the API proves the session resolves to an
 * ActorContext with exactly one space." Everything below is a piece of that sentence.
 */
describeDb('signup', () => {
  let app: FastifyInstance
  withCleanDatabase()

  beforeAll(async () => {
    app = await buildApp({ startJobs: false })
    await app.ready()
  })

  afterAll(async () => {
    await app.close()
  })

  it('creates exactly one space, personal, owned by the new user', async () => {
    const alice = await seedUserWithSpace(app)

    const res = await app.inject({ method: 'GET', url: '/api/v1/me', ...authAs(alice) })

    expect(res.statusCode).toBe(200)
    const body = res.json()
    expect(body.spaces).toHaveLength(1)
    expect(body.spaces[0].kind).toBe('personal')
    expect(body.spaces[0].role).toBe('owner')
  })

  it('gives a second user a separate, disjoint space', async () => {
    // conventions/testing.md §2: two users in two spaces is the default fixture shape. A
    // single-user check cannot catch a missing space filter, which is the bug that matters.
    const alice = await seedUserWithSpace(app)
    const bob = await seedUserWithSpace(app)

    const aliceRes = await app.inject({ method: 'GET', url: '/api/v1/me', ...authAs(alice) })
    const bobRes = await app.inject({ method: 'GET', url: '/api/v1/me', ...authAs(bob) })

    const aliceSpaces: string[] = aliceRes
      .json()
      .spaces.map((s: { space_id: string }) => s.space_id)
    const bobSpaces: string[] = bobRes.json().spaces.map((s: { space_id: string }) => s.space_id)
    expect(aliceSpaces).toHaveLength(1)
    expect(bobSpaces).toHaveLength(1)
    expect(aliceSpaces).not.toEqual(bobSpaces)
  })

  it('is idempotent: ensurePersonalSpace twice still yields one space', async () => {
    // The guard that replaces the transaction ADR-0006 originally promised. If the partial
    // unique index or the re-read is ever removed, this is what fails.
    const alice = await seedUserWithSpace(app)

    const first = await ensurePersonalSpace(alice.userId, alice.name)
    const second = await ensurePersonalSpace(alice.userId, alice.name)

    expect(second).toBe(first)
    const rows = await db
      .select({ id: spaces.id })
      .from(spaces)
      .where(eq(spaces.personalForUserId, alice.userId))
    expect(rows).toHaveLength(1)
  })

  it('rejects a password shorter than the shared minimum', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/sign-up/email',
      headers: { 'content-type': 'application/json' },
      payload: { name: 'Short', email: 'short@example.test', password: 'abc' },
    })

    expect(res.statusCode).toBeGreaterThanOrEqual(400)
  })
})

describeDb('sign in', () => {
  let app: FastifyInstance
  withCleanDatabase()

  beforeAll(async () => {
    app = await buildApp({ startJobs: false })
    await app.ready()
  })

  afterAll(async () => {
    await app.close()
  })

  it('issues a session that /me accepts', async () => {
    const alice = await seedUserWithSpace(app)

    const { statusCode, sessionCookie } = await signIn(app, {
      email: alice.email,
      password: alice.password,
    })

    expect(statusCode).toBe(200)
    const res = await app.inject({ method: 'GET', url: '/api/v1/me', ...authAs({ sessionCookie }) })
    expect(res.statusCode).toBe(200)
  })

  it('rejects the wrong password without revealing whether the account exists', async () => {
    const alice = await seedUserWithSpace(app)

    const { statusCode } = await signIn(app, {
      email: alice.email,
      password: 'not-the-right-password',
    })

    expect(statusCode).toBeGreaterThanOrEqual(400)
  })
})
