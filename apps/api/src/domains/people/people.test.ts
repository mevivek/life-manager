import type { FastifyInstance } from 'fastify'
import { afterAll, beforeAll, expect, it } from 'vitest'
import { buildApp } from '../../app.js'
import { describeDb, withCleanDatabase } from '../../test/db.js'
import {
  authAs,
  createDocument,
  createPerson,
  createThing,
  seedTwoUsers,
  seedUserWithSpace,
  type UserFixture,
} from '../../test/factories.js'

/**
 * People integration tests, against a real Postgres.
 *
 * Structured around **ADR-0034**, which is the whole of this domain's specification, and each test
 * names the sentence it is defending. Two of the three sentences are about what does NOT happen, so
 * most of this file asserts absence — that a delete left `holder` alone, that a rename stopped at a
 * space boundary, that an unchanged name reported nothing.
 *
 * Every data endpoint gets a **cross-space 404** test. Non-negotiable (conventions/testing.md §2).
 *
 * Two habits from M1's mistakes are deliberate here:
 *
 *  - **Every count assertion drives a NON-ZERO value** (debt D33). `file_count` was broken for the
 *    whole of M1 because every assertion on it happened to expect 0, so a query returning a constant
 *    zero satisfied all of them. `document_count`, `thing_count`, `documents_updated` and
 *    `things_updated` are all that shape of field and all get that treatment.
 *  - **A propagation is asserted from both ends**: the rows that must move, and a control row that
 *    must not. A bulk `UPDATE` with a broken `WHERE` renames everything, and a test that only checks
 *    the rows it wanted passes.
 */

let app: FastifyInstance

/** A person's `holder`-eye view: what a document or thing currently reads. */
async function holdersOfDocuments(user: UserFixture): Promise<Record<string, string | null>> {
  const list = await app.inject({ method: 'GET', url: '/api/v1/documents', ...authAs(user) })
  const rows = list.json().data as { title: string; holder: string | null }[]
  return Object.fromEntries(rows.map((row) => [row.title, row.holder]))
}

async function holdersOfThings(user: UserFixture): Promise<Record<string, string | null>> {
  const list = await app.inject({ method: 'GET', url: '/api/v1/things', ...authAs(user) })
  const rows = list.json().data as { name: string; holder: string | null }[]
  return Object.fromEntries(rows.map((row) => [row.name, row.holder]))
}

describeDb('people', () => {
  withCleanDatabase()

  beforeAll(async () => {
    app = await buildApp({ startJobs: false })
    await app.ready()
  })

  afterAll(async () => {
    await app.close()
  })

  // ── Create: one required field, and a person may exist with nothing filed ──

  it('creates a person from a name alone, with nothing filed under them', async () => {
    const user = await seedUserWithSpace(app)

    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/people',
      ...authAs(user),
      payload: { name: 'Priya' },
    })

    expect(response.statusCode).toBe(201)
    /**
     * A person with **nothing filed** is the case `SELECT DISTINCT holder` could not express, and
     * ADR-0034's stated reason for the table existing at all — "Add someone" has to have somewhere
     * to put them. So zero counts here are the correct answer, not a weak assertion; the non-zero
     * ones debt D33 demands are two tests below.
     */
    expect(response.json()).toMatchObject({
      name: 'Priya',
      relation: null,
      document_count: 0,
      thing_count: 0,
      version: 1,
    })
  })

  it('accepts a relation, and rejects a missing or over-long name', async () => {
    const user = await seedUserWithSpace(app)

    const withRelation = await createPerson(app, user, { name: 'Arun', relation: 'Son (12)' })
    expect(withRelation.body.relation).toBe('Son (12)')

    const empty = await app.inject({
      method: 'POST',
      url: '/api/v1/people',
      ...authAs(user),
      payload: {},
    })
    expect(empty.statusCode).toBe(400)

    // MAX_PERSON_NAME_LENGTH is 120 — the value just outside what Zod accepts (testing.md §3).
    const tooLong = await app.inject({
      method: 'POST',
      url: '/api/v1/people',
      ...authAs(user),
      payload: { name: 'x'.repeat(121) },
    })
    expect(tooLong.statusCode).toBe(400)
  })

  // ── The counts: non-zero, correct per row, and they change (debt D33) ─────

  it('counts the documents and things filed under each name, non-zero and per row', async () => {
    const user = await seedUserWithSpace(app)
    await createPerson(app, user, { name: 'Priya' })
    await createPerson(app, user, { name: 'Arun' })
    // Somebody with nothing filed, so a count that ignored its predicate would be visibly wrong
    // rather than coincidentally right.
    await createPerson(app, user, { name: 'Zoya' })

    const passport = await createDocument(app, user, { title: 'Passport', holder: 'Priya' })
    await createDocument(app, user, { title: 'Visa', holder: 'Priya' })
    await createDocument(app, user, { title: 'School form', holder: 'Arun' })
    // Filed under nobody — "Mine" is the ABSENCE of a holder, so it counts against nobody.
    await createDocument(app, user, { title: 'Council tax' })
    await createThing(app, user, { name: 'Bike', holder: 'Priya' })

    const list = await app.inject({ method: 'GET', url: '/api/v1/people', ...authAs(user) })
    expect(list.statusCode).toBe(200)

    const byName = Object.fromEntries(
      (list.json().data as { name: string; document_count: number; thing_count: number }[]).map(
        (row) => [row.name, [row.document_count, row.thing_count]],
      ),
    )
    // **Non-zero, and different per row** — conventions/testing.md §3 and debt D33.
    expect(byName).toEqual({
      Arun: [1, 0],
      Priya: [2, 1],
      Zoya: [0, 0],
    })

    // And it goes DOWN when a document is deleted, so it cannot be passing by returning a constant.
    await app.inject({
      method: 'DELETE',
      url: `/api/v1/documents/${passport.id}?version=${passport.version}`,
      ...authAs(user),
    })
    const after = await app.inject({ method: 'GET', url: '/api/v1/people', ...authAs(user) })
    const priya = (after.json().data as { name: string; document_count: number }[]).find(
      (row) => row.name === 'Priya',
    )
    expect(priya?.document_count).toBe(1)
  })

  it('does not count another space’s records under a name it shares', async () => {
    const { alice, bob } = await seedTwoUsers(app)
    await createPerson(app, alice, { name: 'Priya' })
    await createDocument(app, alice, { title: 'Alice visa', holder: 'Priya' })
    /**
     * Bob files a document under the same free-text name. Without
     * `documents.space_id = people.space_id` in `documentCountSql` this inflates Alice's count — the
     * cross-space leak add-a-domain.md §4 records from M4 step 1, except that here the attacker's
     * input is a **guessed name** rather than a guessed uuid, which is a far shorter guess.
     */
    await createDocument(app, bob, { title: 'Bob visa', holder: 'Priya' })
    await createThing(app, bob, { name: 'Bob bike', holder: 'Priya' })

    const list = await app.inject({ method: 'GET', url: '/api/v1/people', ...authAs(alice) })
    expect(list.json().data).toHaveLength(1)
    expect(list.json().data[0]).toMatchObject({
      name: 'Priya',
      document_count: 1,
      thing_count: 0,
    })
  })

  // ── The rename: "renames them everywhere they're filed" ───────────────────

  it('renames the person AND every record filed under them, reporting non-zero counts', async () => {
    const user = await seedUserWithSpace(app)
    const priya = await createPerson(app, user, { name: 'Priya', relation: 'Wife' })

    await createDocument(app, user, { title: 'Passport', holder: 'Priya' })
    await createDocument(app, user, { title: 'Visa', holder: 'Priya' })
    await createThing(app, user, { name: 'Bike', holder: 'Priya' })
    // The control. A bulk UPDATE with a broken `WHERE` renames this too, and a test that only
    // checked the rows it wanted moved would pass.
    await createDocument(app, user, { title: 'Arun school form', holder: 'Arun' })
    // And one filed under nobody: `holder IS NULL` must not be swept up by an `IS DISTINCT FROM`
    // style predicate.
    await createDocument(app, user, { title: 'Council tax' })

    const renamed = await app.inject({
      method: 'PATCH',
      url: `/api/v1/people/${priya.id}`,
      ...authAs(user),
      payload: { version: priya.version, name: 'Priya Mehra' },
    })

    expect(renamed.statusCode).toBe(200)
    expect(renamed.json().person).toMatchObject({
      name: 'Priya Mehra',
      // The relation is untouched by a rename — it is a display aid, not part of the key.
      relation: 'Wife',
      version: 2,
    })

    /**
     * **The non-zero counts debt D33 exists for.** `documents_updated: 2, things_updated: 1` is the
     * *"and 4 records updated"* the app says out loud, and it is a number no client could compute —
     * the rows changed are in two other domains and may not be loaded.
     */
    expect(renamed.json().documents_updated).toBe(2)
    expect(renamed.json().things_updated).toBe(1)

    // The records themselves moved — the actual propagation, read back through the real endpoints.
    expect(await holdersOfDocuments(user)).toEqual({
      Passport: 'Priya Mehra',
      Visa: 'Priya Mehra',
      // Untouched. This is the assertion that fails if the `WHERE holder = oldName` is dropped.
      'Arun school form': 'Arun',
      'Council tax': null,
    })
    expect(await holdersOfThings(user)).toEqual({ Bike: 'Priya Mehra' })

    // And the directory's counts follow the records to the new name rather than being stranded.
    const list = await app.inject({ method: 'GET', url: '/api/v1/people', ...authAs(user) })
    expect(list.json().data[0]).toMatchObject({
      name: 'Priya Mehra',
      document_count: 2,
      thing_count: 1,
    })
  })

  it('does not rename another space’s records that share the old name', async () => {
    const { alice, bob } = await seedTwoUsers(app)
    const priya = await createPerson(app, alice, { name: 'Priya' })
    await createDocument(app, alice, { title: 'Alice passport', holder: 'Priya' })
    await createDocument(app, bob, { title: 'Bob passport', holder: 'Priya' })
    await createThing(app, bob, { name: 'Bob bike', holder: 'Priya' })

    const renamed = await app.inject({
      method: 'PATCH',
      url: `/api/v1/people/${priya.id}`,
      ...authAs(alice),
      payload: { version: priya.version, name: 'Priya Mehra' },
    })

    expect(renamed.statusCode).toBe(200)
    // One document, and specifically **not** Bob's. `scoped(actor, documents)` is what confines the
    // bulk update; a rename can no more cross a space boundary than a list can.
    expect(renamed.json().documents_updated).toBe(1)
    expect(renamed.json().things_updated).toBe(0)

    expect(await holdersOfDocuments(alice)).toEqual({ 'Alice passport': 'Priya Mehra' })
    expect(await holdersOfDocuments(bob)).toEqual({ 'Bob passport': 'Priya' })
    expect(await holdersOfThings(bob)).toEqual({ 'Bob bike': 'Priya' })
  })

  it('reports 0 and 0 when the name does not change', async () => {
    const user = await seedUserWithSpace(app)
    const priya = await createPerson(app, user, { name: 'Priya' })
    await createDocument(app, user, { title: 'Passport', holder: 'Priya' })
    await createThing(app, user, { name: 'Bike', holder: 'Priya' })

    // A patch that only touches `relation`. There are records filed under this person, so a naive
    // `UPDATE … SET holder = 'Priya' WHERE holder = 'Priya'` would report 1 and 1 — the app would
    // say "and 2 records updated" about a rename that renamed nothing.
    const relationOnly = await app.inject({
      method: 'PATCH',
      url: `/api/v1/people/${priya.id}`,
      ...authAs(user),
      payload: { version: priya.version, relation: 'Wife' },
    })
    expect(relationOnly.statusCode).toBe(200)
    expect(relationOnly.json().person).toMatchObject({ name: 'Priya', relation: 'Wife' })
    expect(relationOnly.json().documents_updated).toBe(0)
    expect(relationOnly.json().things_updated).toBe(0)

    // And a patch that sends the SAME name explicitly, which is what a form that always submits
    // every field does.
    const sameName = await app.inject({
      method: 'PATCH',
      url: `/api/v1/people/${priya.id}`,
      ...authAs(user),
      payload: { version: 2, name: 'Priya' },
    })
    expect(sameName.statusCode).toBe(200)
    expect(sameName.json().documents_updated).toBe(0)
    expect(sameName.json().things_updated).toBe(0)

    // Nothing moved, and nothing was quietly cleared either.
    expect(await holdersOfDocuments(user)).toEqual({ Passport: 'Priya' })
    expect(await holdersOfThings(user)).toEqual({ Bike: 'Priya' })
  })

  // ── The delete: "removing them leaves the documents alone" ────────────────

  it('removes the person and leaves every record’s holder exactly as it was', async () => {
    const user = await seedUserWithSpace(app)
    const priya = await createPerson(app, user, { name: 'Priya' })
    await createDocument(app, user, { title: 'Passport', holder: 'Priya' })
    await createDocument(app, user, { title: 'Visa', holder: 'Priya' })
    await createThing(app, user, { name: 'Bike', holder: 'Priya' })

    const removed = await app.inject({
      method: 'DELETE',
      url: `/api/v1/people/${priya.id}?version=${priya.version}`,
      ...authAs(user),
    })
    expect(removed.statusCode).toBe(204)

    // Gone from the directory — it "stops being offered as a choice".
    const list = await app.inject({ method: 'GET', url: '/api/v1/people', ...authAs(user) })
    expect(list.json().data).toEqual([])

    /**
     * **And the records still read "Priya".** This is the assertion ADR-0034 rejected a foreign key
     * over: a `SET NULL` would have emptied these, a `RESTRICT` would have failed the delete on
     * exactly the people who have anything filed, and a `CASCADE` would have deleted the documents.
     */
    expect(await holdersOfDocuments(user)).toEqual({ Passport: 'Priya', Visa: 'Priya' })
    expect(await holdersOfThings(user)).toEqual({ Bike: 'Priya' })

    // The derived holder list still offers the name too, which is what makes a record filed under a
    // removed person still editable without retyping (ADR-0034: the directory is not the only source).
    const holders = await app.inject({
      method: 'GET',
      url: '/api/v1/documents/holders',
      ...authAs(user),
    })
    expect((holders.json().data as { holder: string }[]).map((row) => row.holder)).toEqual([
      'Priya',
    ])
  })

  // ── ADR-0024 / D41: the version precondition ──────────────────────────────

  /**
   * The gap this closes: `personUpdateSchema` had no refine, so `{ version }` alone was a legal 200
   * that bumped the version, reported "0 records moved" and changed nothing. A no-op that CONSUMES
   * the caller's precondition is worse than a 400 — the client's next write then fails on a version
   * it never chose to advance.
   */
  it('rejects a patch that changes nothing, rather than burning the precondition', async () => {
    const user = await seedUserWithSpace(app)
    const priya = await createPerson(app, user, { name: 'Priya' })

    const response = await app.inject({
      method: 'PATCH',
      url: `/api/v1/people/${priya.id}`,
      ...authAs(user),
      payload: { version: priya.version },
    })

    expect(response.statusCode).toBe(400)

    // And the version is untouched, which is the half that actually bites.
    const after = await app.inject({ method: 'GET', url: '/api/v1/people', ...authAs(user) })
    expect(after.json().data[0].version).toBe(priya.version)
  })

  it('ADR-0024: refuses a stale rename with 409 and renames NOTHING', async () => {
    const user = await seedUserWithSpace(app)
    const priya = await createPerson(app, user, { name: 'Priya' })
    await createDocument(app, user, { title: 'Passport', holder: 'Priya' })
    await createThing(app, user, { name: 'Bike', holder: 'Priya' })

    // Two edits built against the SAME version — the offline case exactly.
    const winner = await app.inject({
      method: 'PATCH',
      url: `/api/v1/people/${priya.id}`,
      ...authAs(user),
      payload: { version: priya.version, name: 'Priya Mehra' },
    })
    expect(winner.statusCode).toBe(200)
    expect(winner.json().documents_updated).toBe(1)

    const loser = await app.inject({
      method: 'PATCH',
      url: `/api/v1/people/${priya.id}`,
      ...authAs(user),
      payload: { version: priya.version, name: 'Priyanka' },
    })
    expect(loser.statusCode).toBe(409)
    expect(loser.headers['content-type']).toContain('application/problem+json')
    // The current version is in the message so the client can re-read without guessing.
    expect(loser.json().detail).toContain('version')

    /**
     * The assertion that matters, and the reason the conditional person update goes FIRST inside the
     * transaction: the losing write rewrote nothing. A rename that 409'd *after* the bulk update
     * would have to be rolled back, and a rename that skipped the transaction entirely would leave
     * every record renamed by a write the API reported as refused.
     */
    expect(await holdersOfDocuments(user)).toEqual({ Passport: 'Priya Mehra' })
    expect(await holdersOfThings(user)).toEqual({ Bike: 'Priya Mehra' })
  })

  it('ADR-0024: a rename with no version is rejected, not applied unconditionally', async () => {
    const user = await seedUserWithSpace(app)
    const priya = await createPerson(app, user, { name: 'Priya' })

    // `version` is REQUIRED on `personUpdateSchema`, so a call site that forgets it is a 400 rather
    // than silently getting last-write-wins — over two other domains' tables, in this case.
    const patched = await app.inject({
      method: 'PATCH',
      url: `/api/v1/people/${priya.id}`,
      ...authAs(user),
      payload: { name: 'No precondition' },
    })
    expect(patched.statusCode).toBe(400)
  })

  it('D41: refuses a stale remove with 409 and leaves the person in the directory', async () => {
    const user = await seedUserWithSpace(app)
    const priya = await createPerson(app, user, { name: 'Priya' })

    const renamed = await app.inject({
      method: 'PATCH',
      url: `/api/v1/people/${priya.id}`,
      ...authAs(user),
      payload: { version: priya.version, name: 'Priya Mehra' },
    })
    expect(renamed.statusCode).toBe(200)

    const removed = await app.inject({
      method: 'DELETE',
      url: `/api/v1/people/${priya.id}?version=${priya.version}`,
      ...authAs(user),
    })
    expect(removed.statusCode).toBe(409)

    const list = await app.inject({ method: 'GET', url: '/api/v1/people', ...authAs(user) })
    expect((list.json().data as { name: string }[]).map((row) => row.name)).toEqual(['Priya Mehra'])
  })

  it('D41: a remove with no version is rejected', async () => {
    const user = await seedUserWithSpace(app)
    const priya = await createPerson(app, user, { name: 'Priya' })

    const removed = await app.inject({
      method: 'DELETE',
      url: `/api/v1/people/${priya.id}`,
      ...authAs(user),
    })
    expect(removed.statusCode).toBe(400)
  })

  it('ADR-0024: a stale patch on a removed person is 404, not 409', async () => {
    const user = await seedUserWithSpace(app)
    const priya = await createPerson(app, user, { name: 'Priya' })

    await app.inject({
      method: 'DELETE',
      url: `/api/v1/people/${priya.id}?version=${priya.version}`,
      ...authAs(user),
    })

    // The two failures are different answers to different questions: "gone" is 404 and the client
    // should stop, "moved on" is 409 and the client should re-read.
    const patched = await app.inject({
      method: 'PATCH',
      url: `/api/v1/people/${priya.id}`,
      ...authAs(user),
      payload: { version: priya.version, name: 'Priya Mehra' },
    })
    expect(patched.statusCode).toBe(404)
  })

  // ── Invariant 4: cross-space is 404, never 403 ────────────────────────────

  it('invariant 4: every people endpoint answers 404 across spaces, never 403', async () => {
    const { alice, bob } = await seedTwoUsers(app)
    const priya = await createPerson(app, alice, { name: 'Priya' })

    const attempts = [
      {
        method: 'PATCH' as const,
        url: `/api/v1/people/${priya.id}`,
        payload: { version: priya.version, name: 'Priya Mehra' },
      },
      { method: 'DELETE' as const, url: `/api/v1/people/${priya.id}?version=${priya.version}` },
    ]

    for (const attempt of attempts) {
      const response = await app.inject({ ...attempt, ...authAs(bob) })
      expect(
        response.statusCode,
        `${attempt.method} ${attempt.url} must be 404 for another space`,
      ).toBe(404)
      // A 403 would confirm the record exists. That is the leak, and it is why this asserts the
      // exact code rather than "not 2xx".
      expect(response.statusCode).not.toBe(403)
    }

    // And the failed rename must not have propagated to Alice's records on its way to the 404.
    await createDocument(app, alice, { title: 'Alice passport', holder: 'Priya' })
    expect(await holdersOfDocuments(alice)).toEqual({ 'Alice passport': 'Priya' })
  })

  it('does not list another space’s people', async () => {
    const { alice, bob } = await seedTwoUsers(app)
    await createPerson(app, alice, { name: 'Priya' })

    const list = await app.inject({ method: 'GET', url: '/api/v1/people', ...authAs(bob) })
    expect(list.statusCode).toBe(200)
    // Asserted as EMPTY rather than "does not contain Priya": a list that leaked every space's rows
    // would still not contain a name Bob happened not to look for.
    expect(list.json().data).toEqual([])
  })

  it('requires a session on every people endpoint', async () => {
    const user = await seedUserWithSpace(app)
    const priya = await createPerson(app, user, { name: 'Priya' })

    const attempts = [
      { method: 'GET' as const, url: '/api/v1/people' },
      { method: 'POST' as const, url: '/api/v1/people', payload: { name: 'Nobody' } },
      {
        method: 'PATCH' as const,
        url: `/api/v1/people/${priya.id}`,
        payload: { version: 1, name: 'x' },
      },
      { method: 'DELETE' as const, url: `/api/v1/people/${priya.id}?version=1` },
    ]

    for (const attempt of attempts) {
      const response = await app.inject(attempt)
      expect(response.statusCode, `${attempt.method} ${attempt.url} must be 401`).toBe(401)
    }
  })
})
