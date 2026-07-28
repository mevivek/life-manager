import { randomUUID } from 'node:crypto'
import type { FastifyInstance } from 'fastify'
import { afterAll, beforeAll, expect, it } from 'vitest'
import { buildApp } from '../app.js'
import { describeDb, withCleanDatabase } from '../test/db.js'
import { authAs, seedTwoUsers, seedUserWithSpace } from '../test/factories.js'

/**
 * `Idempotency-Key` behaviour. conventions/api.md §5, closing debt **D9**.
 *
 * The failure this exists to prevent is concrete and was named in D9's trigger: a mobile client
 * retries `POST /documents` on a flaky connection and creates **two** documents. The first test
 * below is that exact scenario.
 */

let app: FastifyInstance

describeDb('Idempotency-Key', () => {
  withCleanDatabase()

  beforeAll(async () => {
    app = await buildApp({ startJobs: false })
    await app.ready()
  })

  afterAll(async () => {
    await app.close()
  })

  it('replays the first response instead of creating a second document — debt D9', async () => {
    const user = await seedUserWithSpace(app)
    const key = randomUUID()
    const payload = { title: 'Passport' }

    const first = await app.inject({
      method: 'POST',
      url: '/api/v1/documents',
      ...authAs(user),
      headers: { ...authAs(user).headers, 'idempotency-key': key },
      payload,
    })
    const second = await app.inject({
      method: 'POST',
      url: '/api/v1/documents',
      ...authAs(user),
      headers: { ...authAs(user).headers, 'idempotency-key': key },
      payload,
    })

    expect(first.statusCode).toBe(201)
    expect(second.statusCode).toBe(201)
    // The same document, not a second one.
    expect(second.json().id).toBe(first.json().id)
    expect(second.headers['idempotent-replay']).toBe('true')

    const list = await app.inject({ method: 'GET', url: '/api/v1/documents', ...authAs(user) })
    expect(list.json().data).toHaveLength(1)
  })

  it('409s when the same key is reused with a different body', async () => {
    const user = await seedUserWithSpace(app)
    const key = randomUUID()

    await app.inject({
      method: 'POST',
      url: '/api/v1/documents',
      headers: { ...authAs(user).headers, 'idempotency-key': key },
      payload: { title: 'Passport' },
    })

    const different = await app.inject({
      method: 'POST',
      url: '/api/v1/documents',
      headers: { ...authAs(user).headers, 'idempotency-key': key },
      payload: { title: 'Driving licence' },
    })

    // Replaying the first response here would silently discard the second operation, hiding a
    // client bug (a key reused for a different thing) rather than reporting it.
    expect(different.statusCode).toBe(409)
  })

  it('treats a semantically identical body as the same request despite key order', async () => {
    const user = await seedUserWithSpace(app)
    const key = randomUUID()

    const first = await app.inject({
      method: 'POST',
      url: '/api/v1/documents',
      headers: { ...authAs(user).headers, 'idempotency-key': key },
      payload: { title: 'Passport', doc_type: 'identity' },
    })
    const reordered = await app.inject({
      method: 'POST',
      url: '/api/v1/documents',
      headers: { ...authAs(user).headers, 'idempotency-key': key },
      payload: { doc_type: 'identity', title: 'Passport' },
    })

    // Hashing the PARSED body rather than raw bytes is what makes this a replay and not a 409.
    expect(reordered.statusCode).toBe(201)
    expect(reordered.json().id).toBe(first.json().id)
  })

  it('scopes keys per space, so two spaces can use the same key', async () => {
    const { alice, bob } = await seedTwoUsers(app)
    const key = 'shared-key-value'

    const aliceResponse = await app.inject({
      method: 'POST',
      url: '/api/v1/documents',
      headers: { ...authAs(alice).headers, 'idempotency-key': key },
      payload: { title: 'Alice passport' },
    })
    const bobResponse = await app.inject({
      method: 'POST',
      url: '/api/v1/documents',
      headers: { ...authAs(bob).headers, 'idempotency-key': key },
      payload: { title: 'Bob passport' },
    })

    expect(aliceResponse.statusCode).toBe(201)
    expect(bobResponse.statusCode).toBe(201)
    // A key guessed from another space must not collide — otherwise one tenant could make
    // another's write replay, or worse, read the replayed body.
    expect(bobResponse.json().id).not.toBe(aliceResponse.json().id)
    expect(bobResponse.json().title).toBe('Bob passport')
  })

  it('scopes keys per endpoint', async () => {
    const user = await seedUserWithSpace(app)
    const key = randomUUID()

    const created = await app.inject({
      method: 'POST',
      url: '/api/v1/documents',
      headers: { ...authAs(user).headers, 'idempotency-key': key },
      payload: { title: 'Passport' },
    })
    expect(created.statusCode).toBe(201)

    // Same key, different endpoint — must not replay the document creation.
    const reminder = await app.inject({
      method: 'POST',
      url: `/api/v1/documents/${created.json().id}/reminders`,
      headers: { ...authAs(user).headers, 'idempotency-key': key },
      payload: { due_on: '2030-01-01' },
    })
    expect(reminder.statusCode).toBe(201)
    expect(reminder.json()).toHaveProperty('due_on')
  })

  it('releases the claim when the operation fails, so a genuine retry still works', async () => {
    const user = await seedUserWithSpace(app)
    const key = randomUUID()

    // 422: a business-rule failure, i.e. the operation did not happen.
    const failed = await app.inject({
      method: 'POST',
      url: '/api/v1/documents',
      headers: { ...authAs(user).headers, 'idempotency-key': key },
      payload: { title: 'Passport', issued_on: '2020-01-01', expires_on: '2019-01-01' },
    })
    expect(failed.statusCode).toBe(422)

    // Without releasing the claim, this would answer 409 forever and the key would be wedged.
    const retried = await app.inject({
      method: 'POST',
      url: '/api/v1/documents',
      headers: { ...authAs(user).headers, 'idempotency-key': key },
      payload: { title: 'Passport', issued_on: '2020-01-01', expires_on: '2019-01-01' },
    })
    expect(retried.statusCode).toBe(422)
  })

  it('leaves a mutation without the header behaving exactly as before', async () => {
    const user = await seedUserWithSpace(app)

    // §5 says every mutation *accepts* the header, not that it requires one. Two identical
    // requests with no key are two documents, which is correct.
    for (const _ of [1, 2]) {
      const response = await app.inject({
        method: 'POST',
        url: '/api/v1/documents',
        ...authAs(user),
        payload: { title: 'Passport' },
      })
      expect(response.statusCode).toBe(201)
    }

    const list = await app.inject({ method: 'GET', url: '/api/v1/documents', ...authAs(user) })
    expect(list.json().data).toHaveLength(2)
  })

  it('makes a retried DELETE idempotent rather than a 404', async () => {
    const user = await seedUserWithSpace(app)
    const created = await app.inject({
      method: 'POST',
      url: '/api/v1/documents',
      ...authAs(user),
      payload: { title: 'Passport' },
    })
    const key = randomUUID()

    const first = await app.inject({
      method: 'DELETE',
      url: `/api/v1/documents/${created.json().id}`,
      headers: { ...authAs(user).headers, 'idempotency-key': key },
    })
    expect(first.statusCode).toBe(204)

    // A retried DELETE would otherwise 404 — technically correct, but it makes a client's retry
    // look like a failure. The 204 is stored and replayed.
    const retried = await app.inject({
      method: 'DELETE',
      url: `/api/v1/documents/${created.json().id}`,
      headers: { ...authAs(user).headers, 'idempotency-key': key },
    })
    expect(retried.statusCode).toBe(204)
  })
})
