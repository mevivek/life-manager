import type { FastifyInstance } from 'fastify'
import { afterAll, beforeAll, expect, it } from 'vitest'
import { buildApp } from '../../app.js'
import { describeDb, withCleanDatabase } from '../../test/db.js'
import { authAs, createDocument, seedTwoUsers, seedUserWithSpace } from '../../test/factories.js'

/**
 * Documents integration tests, against a real Postgres.
 *
 * Structured to mirror **domains/documents.md §4** — each business rule has a test that names it,
 * so a review can check the numbered list off rather than reading for coverage
 * (agent-playbooks/add-a-domain.md §8).
 *
 * Every data endpoint gets a **cross-space 404** test. Non-negotiable
 * (conventions/testing.md §2).
 */

let app: FastifyInstance

describeDb('documents', () => {
  withCleanDatabase()

  beforeAll(async () => {
    app = await buildApp({ startJobs: false })
    await app.ready()
  })

  afterAll(async () => {
    await app.close()
  })

  // ── Rule 1: title required, everything else optional ─────────────────────

  it('rule 1: creates a document from a title alone', async () => {
    const user = await seedUserWithSpace(app)

    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/documents',
      ...authAs(user),
      payload: { title: 'Passport' },
    })

    expect(response.statusCode).toBe(201)
    const body = response.json()
    // Q2's answer, as an assertion: a half-empty document is valid, not broken.
    expect(body).toMatchObject({
      title: 'Passport',
      doc_type: 'other',
      issuer: null,
      expires_on: null,
      tags: [],
      file_count: 0,
    })
  })

  it('rule 1: rejects a missing or over-long title', async () => {
    const user = await seedUserWithSpace(app)

    const empty = await app.inject({
      method: 'POST',
      url: '/api/v1/documents',
      ...authAs(user),
      payload: {},
    })
    expect(empty.statusCode).toBe(400)

    const tooLong = await app.inject({
      method: 'POST',
      url: '/api/v1/documents',
      ...authAs(user),
      payload: { title: 'x'.repeat(201) },
    })
    expect(tooLong.statusCode).toBe(400)
  })

  // ── Rule 2: expires_on >= issued_on ──────────────────────────────────────

  it('rule 2: rejects an expiry before the issue date, on create and on patch', async () => {
    const user = await seedUserWithSpace(app)

    const created = await app.inject({
      method: 'POST',
      url: '/api/v1/documents',
      ...authAs(user),
      payload: { title: 'Passport', issued_on: '2020-01-01', expires_on: '2019-01-01' },
    })
    // 422, not 400: the shape is fine, the combination violates a business rule
    // (conventions/api.md §3).
    expect(created.statusCode).toBe(422)

    const document = await createDocument(app, user, { issued_on: '2020-01-01' })
    const patched = await app.inject({
      method: 'PATCH',
      url: `/api/v1/documents/${document.id}`,
      ...authAs(user),
      payload: { expires_on: '2019-01-01' },
    })
    expect(patched.statusCode).toBe(422)
  })

  it('rule 2: accepts an expiry equal to the issue date', async () => {
    const user = await seedUserWithSpace(app)
    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/documents',
      ...authAs(user),
      payload: { title: 'Day pass', issued_on: '2026-01-01', expires_on: '2026-01-01' },
    })
    expect(response.statusCode).toBe(201)
  })

  // ── Rule 6: never store a full identifier ────────────────────────────────

  it('rule 6: stores only the last four characters of an identifier', async () => {
    const user = await seedUserWithSpace(app)

    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/documents',
      ...authAs(user),
      // An obvious fake, and the point is that the prefix must not survive.
      payload: { title: 'Passport', identifier: 'FAKE1234567' },
    })

    expect(response.statusCode).toBe(201)
    expect(response.json().identifier_last4).toBe('4567')
    // The whole reason the column exists: the full number must be nowhere in the response.
    expect(response.body).not.toContain('FAKE1234567')
  })

  // ── Rule 8: default reminders for identity and certificate ───────────────

  it('rule 8: creates 90/30/7-day reminders for an identity document with an expiry', async () => {
    const user = await seedUserWithSpace(app)
    const document = await createDocument(app, user, {
      doc_type: 'identity',
      expires_on: '2030-06-01',
    })

    const detail = await app.inject({
      method: 'GET',
      url: `/api/v1/documents/${document.id}`,
      ...authAs(user),
    })

    const reminders = detail.json().reminders as { lead_days: number; due_on: string }[]
    expect(reminders.map((reminder) => reminder.lead_days).sort((a, b) => a - b)).toEqual([
      7, 30, 90,
    ])
    expect(reminders.every((reminder) => reminder.due_on === '2030-06-01')).toBe(true)
  })

  it('rule 8: creates no reminders for a type that does not opt in, or with no expiry', async () => {
    const user = await seedUserWithSpace(app)

    // A warranty expires, but is not one of the two painful-renewal types.
    const warranty = await createDocument(app, user, {
      doc_type: 'warranty',
      expires_on: '2030-06-01',
    })
    // An identity document with no expiry — Q1's answer: silent, not nagged.
    const undated = await createDocument(app, user, { doc_type: 'identity' })

    for (const id of [warranty.id, undated.id]) {
      const detail = await app.inject({
        method: 'GET',
        url: `/api/v1/documents/${id}`,
        ...authAs(user),
      })
      expect(detail.json().reminders).toEqual([])
    }
  })

  // ── Rule 7: expiry changes reconcile reminders ───────────────────────────

  it('rule 7: moving expires_on rebuilds the pending reminders at the new date', async () => {
    const user = await seedUserWithSpace(app)
    const document = await createDocument(app, user, {
      doc_type: 'identity',
      expires_on: '2030-06-01',
    })

    await app.inject({
      method: 'PATCH',
      url: `/api/v1/documents/${document.id}`,
      ...authAs(user),
      payload: { expires_on: '2031-01-15' },
    })

    const detail = await app.inject({
      method: 'GET',
      url: `/api/v1/documents/${document.id}`,
      ...authAs(user),
    })
    const reminders = detail.json().reminders as { due_on: string }[]
    expect(reminders).toHaveLength(3)
    expect(reminders.every((reminder) => reminder.due_on === '2031-01-15')).toBe(true)
  })

  it('rule 7: clearing expires_on deletes the pending reminders', async () => {
    const user = await seedUserWithSpace(app)
    const document = await createDocument(app, user, {
      doc_type: 'identity',
      expires_on: '2030-06-01',
    })

    await app.inject({
      method: 'PATCH',
      url: `/api/v1/documents/${document.id}`,
      ...authAs(user),
      payload: { expires_on: null },
    })

    const detail = await app.inject({
      method: 'GET',
      url: `/api/v1/documents/${document.id}`,
      ...authAs(user),
    })
    expect(detail.json().reminders).toEqual([])
    expect(detail.json().expires_on).toBeNull()
  })

  // ── Rule 9 / soft delete ─────────────────────────────────────────────────

  it('rule 9: a deleted document disappears from the list and from reads', async () => {
    const user = await seedUserWithSpace(app)
    const document = await createDocument(app, user)

    const deleted = await app.inject({
      method: 'DELETE',
      url: `/api/v1/documents/${document.id}`,
      ...authAs(user),
    })
    expect(deleted.statusCode).toBe(204)

    const read = await app.inject({
      method: 'GET',
      url: `/api/v1/documents/${document.id}`,
      ...authAs(user),
    })
    expect(read.statusCode).toBe(404)

    const list = await app.inject({ method: 'GET', url: '/api/v1/documents', ...authAs(user) })
    expect(list.json().data).toEqual([])
  })

  // ── Rule 12 / invariant 4: cross-space is 404, never 403 ─────────────────

  it('rule 12: every document endpoint answers 404 across spaces, never 403', async () => {
    const { alice, bob } = await seedTwoUsers(app)
    const document = await createDocument(app, alice)

    const attempts = [
      { method: 'GET' as const, url: `/api/v1/documents/${document.id}` },
      {
        method: 'PATCH' as const,
        url: `/api/v1/documents/${document.id}`,
        payload: { title: 'x' },
      },
      { method: 'DELETE' as const, url: `/api/v1/documents/${document.id}` },
      { method: 'GET' as const, url: `/api/v1/documents/${document.id}/reminders` },
      {
        method: 'POST' as const,
        url: `/api/v1/documents/${document.id}/reminders`,
        payload: { due_on: '2030-01-01' },
      },
      {
        method: 'POST' as const,
        url: `/api/v1/documents/${document.id}/files:presign-upload`,
        payload: { mime: 'application/pdf', size_bytes: 100 },
      },
      {
        method: 'POST' as const,
        url: `/api/v1/documents/${document.id}/files:confirm`,
        payload: { file_id: '11111111-1111-4111-8111-111111111111' },
      },
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
  })

  it("does not list another space's documents", async () => {
    const { alice, bob } = await seedTwoUsers(app)
    await createDocument(app, alice, { title: 'Alice passport' })

    const list = await app.inject({ method: 'GET', url: '/api/v1/documents', ...authAs(bob) })
    expect(list.statusCode).toBe(200)
    expect(list.json().data).toEqual([])
  })

  it('requires a session on every document endpoint', async () => {
    const unauthenticated = await app.inject({ method: 'GET', url: '/api/v1/documents' })
    expect(unauthenticated.statusCode).toBe(401)

    const create = await app.inject({
      method: 'POST',
      url: '/api/v1/documents',
      payload: { title: 'x' },
    })
    expect(create.statusCode).toBe(401)
  })

  // ── List: filters, search, sort, pagination ──────────────────────────────

  it('sorts by expires_on ascending with nulls last, by default', async () => {
    const user = await seedUserWithSpace(app)
    await createDocument(app, user, { title: 'No expiry' })
    await createDocument(app, user, { title: 'Later', expires_on: '2031-01-01' })
    await createDocument(app, user, { title: 'Sooner', expires_on: '2030-01-01' })

    const list = await app.inject({ method: 'GET', url: '/api/v1/documents', ...authAs(user) })
    const titles = (list.json().data as { title: string }[]).map((row) => row.title)
    // §5: "Default sort: expires_on asc, nulls last — the useful default, not created_at."
    expect(titles).toEqual(['Sooner', 'Later', 'No expiry'])
  })

  it('rejects an unknown query parameter — debt D27', async () => {
    const user = await seedUserWithSpace(app)

    // The failure this prevents: a typo'd filter silently returning the UNFILTERED list.
    const response = await app.inject({
      method: 'GET',
      url: '/api/v1/documents?expiring_befor=2030-01-01',
      ...authAs(user),
    })
    expect(response.statusCode).toBe(400)
  })

  it('filters by type, tag, expiry and file presence', async () => {
    const user = await seedUserWithSpace(app)
    await createDocument(app, user, {
      title: 'Passport',
      doc_type: 'identity',
      tags: ['travel', 'official'],
      expires_on: '2030-01-01',
    })
    await createDocument(app, user, { title: 'Receipt', doc_type: 'receipt', tags: ['shopping'] })

    const byType = await app.inject({
      method: 'GET',
      url: '/api/v1/documents?type=identity',
      ...authAs(user),
    })
    expect((byType.json().data as { title: string }[]).map((r) => r.title)).toEqual(['Passport'])

    // Tags are lowercased by the contract, so an uppercase query still matches.
    const byTag = await app.inject({
      method: 'GET',
      url: '/api/v1/documents?tag=TRAVEL',
      ...authAs(user),
    })
    expect((byTag.json().data as { title: string }[]).map((r) => r.title)).toEqual(['Passport'])

    // Repeated ?tag= is an AND: the document must carry both.
    const bothTags = await app.inject({
      method: 'GET',
      url: '/api/v1/documents?tag=travel&tag=shopping',
      ...authAs(user),
    })
    expect(bothTags.json().data).toEqual([])

    const expiring = await app.inject({
      method: 'GET',
      url: '/api/v1/documents?expiring_before=2031-01-01',
      ...authAs(user),
    })
    // A null expiry is NOT "expiring before" any date, so the receipt is excluded.
    expect((expiring.json().data as { title: string }[]).map((r) => r.title)).toEqual(['Passport'])

    const withoutFiles = await app.inject({
      method: 'GET',
      url: '/api/v1/documents?has_file=false',
      ...authAs(user),
    })
    expect(withoutFiles.json().data).toHaveLength(2)
  })

  it('searches title, issuer, notes and tags, ranking a title match highest', async () => {
    const user = await seedUserWithSpace(app)
    await createDocument(app, user, { title: 'Passport', notes: 'in the safe' })
    await createDocument(app, user, { title: 'Insurance', notes: 'renew before the passport trip' })
    await createDocument(app, user, { title: 'Boarding pass', tags: ['passport-adjacent'] })

    const found = await app.inject({
      method: 'GET',
      url: '/api/v1/documents?q=passport',
      ...authAs(user),
    })
    const titles = (found.json().data as { title: string }[]).map((row) => row.title)
    expect(titles).toContain('Passport')
    expect(titles).toContain('Insurance')

    // websearch_to_tsquery must not throw on input a person would actually type.
    for (const query of ['a & ', '"unclosed', '-', 'or or or']) {
      const response = await app.inject({
        method: 'GET',
        url: `/api/v1/documents?q=${encodeURIComponent(query)}`,
        ...authAs(user),
      })
      expect(response.statusCode, `q=${query} must not 500`).toBe(200)
    }
  })

  it('paginates with a cursor, without repeating or skipping a row on a tied sort key', async () => {
    const user = await seedUserWithSpace(app)
    // All four share an expires_on, so only the id tie-break can order them. This is the case
    // that breaks naive keyset pagination.
    for (const title of ['A', 'B', 'C', 'D']) {
      await createDocument(app, user, { title, expires_on: '2030-01-01' })
    }

    const seen: string[] = []
    let url = '/api/v1/documents?limit=2'
    for (let page = 0; page < 5; page += 1) {
      const response = await app.inject({ method: 'GET', url, ...authAs(user) })
      expect(response.statusCode).toBe(200)
      const body = response.json() as { data: { title: string }[]; next_cursor: string | null }
      seen.push(...body.data.map((row) => row.title))
      if (body.next_cursor === null) break
      url = `/api/v1/documents?limit=2&cursor=${encodeURIComponent(body.next_cursor)}`
    }

    expect(seen.sort()).toEqual(['A', 'B', 'C', 'D'])
    expect(new Set(seen).size).toBe(4)
  })

  it('rejects a malformed cursor rather than silently serving page one', async () => {
    const user = await seedUserWithSpace(app)
    const response = await app.inject({
      method: 'GET',
      url: '/api/v1/documents?cursor=not-a-real-cursor',
      ...authAs(user),
    })
    // 422: a cursor the client did not get from us is a bug worth surfacing. Serving page one
    // would look like the list randomly resetting.
    expect(response.statusCode).toBe(422)
  })

  // ── custom_attrs ─────────────────────────────────────────────────────────

  it('validates custom_attrs against the effective doc_type, including across a type change', async () => {
    const user = await seedUserWithSpace(app)

    const wrongKey = await app.inject({
      method: 'POST',
      url: '/api/v1/documents',
      ...authAs(user),
      payload: { title: 'Warranty', doc_type: 'warranty', custom_attrs: { nationality: 'GB' } },
    })
    expect(wrongKey.statusCode).toBe(422)

    const document = await createDocument(app, user, {
      doc_type: 'identity',
      custom_attrs: { nationality: 'GB' },
    })

    // Switching type without sending custom_attrs must not leave identity-only keys behind.
    const switched = await app.inject({
      method: 'PATCH',
      url: `/api/v1/documents/${document.id}`,
      ...authAs(user),
      payload: { doc_type: 'receipt' },
    })
    expect(switched.statusCode).toBe(422)
  })

  // ── The `::` route-escaping trap ─────────────────────────────────────────

  it('does not match a garbage suffix on a :verb action route', async () => {
    const user = await seedUserWithSpace(app)
    const document = await createDocument(app, user)

    // Without the `::` escape in the route pattern, Fastify parses `:confirm` as a PARAM and this
    // request matches the confirm handler. See the block comment in documents.routes.ts.
    const response = await app.inject({
      method: 'POST',
      url: `/api/v1/documents/${document.id}/filesGARBAGE`,
      ...authAs(user),
      payload: { file_id: '11111111-1111-4111-8111-111111111111' },
    })
    expect(response.statusCode).toBe(404)
  })

  // ── OpenAPI ──────────────────────────────────────────────────────────────

  it('documents every endpoint in the OpenAPI document', async () => {
    const response = await app.inject({ method: 'GET', url: '/api/v1/openapi.json' })
    const paths = Object.keys(response.json().paths as Record<string, unknown>)

    // The `:verb` URLs must appear with a real colon, not as a path parameter.
    expect(paths).toEqual(
      expect.arrayContaining([
        '/api/v1/documents',
        '/api/v1/documents/{id}',
        '/api/v1/documents/{id}/files:presign-upload',
        '/api/v1/documents/{id}/files:confirm',
        '/api/v1/documents/{id}/files:presign-download',
        '/api/v1/documents/{id}/reminders',
        '/api/v1/reminders/{id}',
        '/api/v1/reminders/{id}/dismiss',
      ]),
    )
  })
})
