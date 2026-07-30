import { randomUUID } from 'node:crypto'
import type { FastifyInstance } from 'fastify'

/**
 * Test fixtures. conventions/testing.md §4: prefer factory helpers over inline literals, so a
 * schema change edits one file instead of forty tests.
 *
 * **Obvious fakes only** (§5). Nothing here is or resembles a real credential.
 */

/** Long enough for `minPasswordLength: 12`, and unmistakably not a real password. */
const FIXTURE_PASSWORD = 'not-a-real-password'

export type UserFixture = {
  userId: string
  email: string
  name: string
  password: string
  /** Ready to spread into `app.inject({ headers })` via `authAs()`. */
  sessionCookie: string
}

/**
 * Creates a user by POSTing to the REAL signup endpoint, not by inserting rows.
 *
 * That choice is the point: it means every test that uses this fixture also exercises the
 * signup → personal-space path, so ADR-0006's guarantee is *tested* rather than assumed. A
 * fixture that inserted a `spaces` row directly would keep passing after the after-hook broke.
 */
export async function seedUserWithSpace(
  app: FastifyInstance,
  overrides: { name?: string; email?: string } = {},
): Promise<UserFixture> {
  const name = overrides.name ?? 'Test Person'
  const email = overrides.email ?? `user-${randomUUID()}@example.test`

  const response = await app.inject({
    method: 'POST',
    url: '/api/v1/auth/sign-up/email',
    headers: { 'content-type': 'application/json' },
    payload: { name, email, password: FIXTURE_PASSWORD },
  })

  if (response.statusCode >= 400) {
    throw new Error(`seedUserWithSpace: signup returned ${response.statusCode}: ${response.body}`)
  }

  const body = response.json<{ user?: { id?: string } }>()
  const userId = body.user?.id
  if (typeof userId !== 'string') {
    throw new Error(`seedUserWithSpace: signup response had no user id: ${response.body}`)
  }

  return { userId, email, name, password: FIXTURE_PASSWORD, sessionCookie: cookieHeader(response) }
}

export async function signIn(
  app: FastifyInstance,
  credentials: { email: string; password: string },
): Promise<{ statusCode: number; sessionCookie: string }> {
  const response = await app.inject({
    method: 'POST',
    url: '/api/v1/auth/sign-in/email',
    headers: { 'content-type': 'application/json' },
    payload: credentials,
  })

  return { statusCode: response.statusCode, sessionCookie: cookieHeader(response) }
}

/** The exact shape conventions/testing.md §2's example uses, so M1's copy-paste works. */
export function authAs(fixture: { sessionCookie: string }): { headers: { cookie: string } } {
  return { headers: { cookie: fixture.sessionCookie } }
}

/**
 * Creates a document through the **real endpoint**, for the same reason `seedUserWithSpace` uses
 * the real signup: a fixture that inserted rows directly would keep passing after the service's
 * business rules broke.
 *
 * Returns the parsed response so a test can assert on ids without re-fetching.
 */
export async function createDocument(
  app: FastifyInstance,
  user: UserFixture,
  overrides: Record<string, unknown> = {},
): Promise<{ id: string; version: number; body: Record<string, unknown> }> {
  const response = await app.inject({
    method: 'POST',
    url: '/api/v1/documents',
    ...authAs(user),
    payload: { title: 'Passport', ...overrides },
  })

  if (response.statusCode !== 201) {
    throw new Error(`createDocument: expected 201, got ${response.statusCode}: ${response.body}`)
  }

  const body = response.json<Record<string, unknown>>()
  const id = body.id
  if (typeof id !== 'string') throw new Error(`createDocument: no id in ${response.body}`)

  /**
   * `version` is returned so every `PATCH` in the suite can send its precondition (ADR-0024).
   *
   * Asserted rather than defaulted, and asserted to be a real starting version rather than merely
   * present. A `?? 1` here would let the response schema stop returning `version` entirely while the
   * whole suite carried on passing against a hard-coded guess — which is exactly how `file_count`
   * stayed 0 for the whole of M1 (debt D33).
   */
  const version = body.version
  if (typeof version !== 'number' || version < 1) {
    throw new Error(`createDocument: expected a version >= 1, got ${JSON.stringify(version)}`)
  }

  return { id, version, body }
}

/**
 * Creates a thing through the **real endpoint**, for the same reason `createDocument` does: a fixture
 * that inserted rows directly would keep passing after the service's business rules broke.
 *
 * This is also the fixture `documents.test.ts` needs now that `documents.thing_id` has a **real
 * foreign key** (things.md §4 rule 5). Before the constraint existed those tests linked to
 * fabricated uuids; a document can only point at a thing that exists, so they create one first.
 */
export async function createThing(
  app: FastifyInstance,
  user: UserFixture,
  overrides: Record<string, unknown> = {},
): Promise<{ id: string; version: number; body: Record<string, unknown> }> {
  const response = await app.inject({
    method: 'POST',
    url: '/api/v1/things',
    ...authAs(user),
    payload: { name: 'Dishwasher', ...overrides },
  })

  if (response.statusCode !== 201) {
    throw new Error(`createThing: expected 201, got ${response.statusCode}: ${response.body}`)
  }

  const body = response.json<Record<string, unknown>>()
  const id = body.id
  if (typeof id !== 'string') throw new Error(`createThing: no id in ${response.body}`)

  /**
   * Asserted to be a real starting version rather than merely present — the same reasoning as
   * `createDocument`'s. A `?? 1` here would let the response schema stop returning `version`
   * entirely while the whole suite carried on passing against a hard-coded guess (debt D33).
   */
  const version = body.version
  if (typeof version !== 'number' || version < 1) {
    throw new Error(`createThing: expected a version >= 1, got ${JSON.stringify(version)}`)
  }

  return { id, version, body }
}

/**
 * Two users in two separate spaces — the fixture every cross-space test needs.
 *
 * conventions/testing.md §2: "a test with a single user cannot catch a missing space filter." This
 * exists so that writing the mandatory cross-space 404 test is a one-liner and nobody skips it for
 * being tedious.
 */
export async function seedTwoUsers(
  app: FastifyInstance,
): Promise<{ alice: UserFixture; bob: UserFixture }> {
  const alice = await seedUserWithSpace(app, { name: 'Alice' })
  const bob = await seedUserWithSpace(app, { name: 'Bob' })
  return { alice, bob }
}

function cookieHeader(response: { cookies: { name: string; value: string }[] }): string {
  return response.cookies.map((cookie) => `${cookie.name}=${cookie.value}`).join('; ')
}
