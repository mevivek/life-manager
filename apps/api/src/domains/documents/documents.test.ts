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
      payload: { version: document.version, expires_on: '2019-01-01' },
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

  /**
   * ── Rule 6, as revised by ADR-0026 ────────────────────────────────────────
   *
   * This block previously asserted the opposite — that the full identifier was discarded and only
   * four characters survived. **The rule changed by explicit product decision, so the test is
   * rewritten to the new rule rather than relaxed.** The assertions here are strictly stronger than
   * the ones they replace: the old test checked that a prefix was absent from one response, these
   * check the mask is derived correctly, that the full value is reachable *only* through the detail
   * endpoint, and that no list response carries it (invariant 10 — a test is never weakened to go
   * green, and a changed rule is not the same as a failing one).
   */

  it('rule 6: stores the identifier in full and derives the mask from it', async () => {
    const user = await seedUserWithSpace(app)

    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/documents',
      ...authAs(user),
      // An obvious fake. 11 characters, so a mask taken from the wrong end is visible.
      payload: { title: 'Passport', identifier: 'FAKE1234567' },
    })

    expect(response.statusCode).toBe(201)
    expect(response.json().identifier_last4).toBe('4567')

    const detail = await app.inject({
      method: 'GET',
      url: `/api/v1/documents/${response.json().id}`,
      ...authAs(user),
    })
    expect(detail.statusCode).toBe(200)
    expect(detail.json().identifier).toBe('FAKE1234567')
    expect(detail.json().identifier_last4).toBe('4567')
  })

  /**
   * ── ADR-0027 reverses ADR-0026's detail-only rule ──
   *
   * This test previously asserted the opposite: that the full identifier was **absent** from every
   * list response, because "a list of 100 documents has no use for 100 full numbers". The archive
   * turned out to be exactly where a person goes when they need a number, and a detail round-trip on
   * a cold-starting API is seconds of standing at a counter — so the field moved onto
   * `documentSchema` by explicit decision.
   *
   * Rewritten rather than deleted, and it still asserts something the old one did not: that the mask
   * is present **alongside** the full value, so the client always has something to render by default.
   */
  it('ADR-0027: returns the full identifier in the list, alongside the mask', async () => {
    const user = await seedUserWithSpace(app)

    await app.inject({
      method: 'POST',
      url: '/api/v1/documents',
      ...authAs(user),
      payload: { title: 'Aadhaar', identifier: 'FAKE729481038109' },
    })

    const list = await app.inject({ method: 'GET', url: '/api/v1/documents', ...authAs(user) })

    expect(list.statusCode).toBe(200)
    expect(list.json().data[0].identifier).toBe('FAKE729481038109')
    // The mask must still be there. It is what rows render until the user reveals, so a response
    // carrying only the full value would force every client to derive its own — and a client-derived
    // mask is a second implementation of a rule the server owns.
    expect(list.json().data[0].identifier_last4).toBe('8109')
  })

  // ── Holders: a label, not a permission ───────────────────────────────────

  it('stores a holder and its relation, and returns both', async () => {
    const user = await seedUserWithSpace(app)

    const created = await app.inject({
      method: 'POST',
      url: '/api/v1/documents',
      ...authAs(user),
      payload: { title: 'Aadhaar', holder: 'Priya', relation: 'Wife' },
    })

    expect(created.statusCode).toBe(201)
    expect(created.json().holder).toBe('Priya')
    expect(created.json().relation).toBe('Wife')
  })

  it('discards a relation with no holder, because it labels nobody', async () => {
    const user = await seedUserWithSpace(app)

    const created = await app.inject({
      method: 'POST',
      url: '/api/v1/documents',
      ...authAs(user),
      payload: { title: 'Passport', relation: 'Wife' },
    })

    // "Wife" on a document with no name attached would render as "Mine · Wife" on the detail screen,
    // and the people picker has nobody to suggest it against.
    expect(created.statusCode).toBe(201)
    expect(created.json().holder).toBeNull()
    expect(created.json().relation).toBeNull()
  })

  it('clears the relation when the holder is cleared, in one patch', async () => {
    const user = await seedUserWithSpace(app)

    const created = await app.inject({
      method: 'POST',
      url: '/api/v1/documents',
      ...authAs(user),
      payload: { title: 'Aadhaar', holder: 'Priya', relation: 'Wife' },
    })

    const patched = await app.inject({
      method: 'PATCH',
      url: `/api/v1/documents/${created.json().id}`,
      ...authAs(user),
      // Only `holder` is mentioned. `relation` must follow it to null rather than being left behind
      // on a document that is now the owner's own.
      payload: { holder: null, version: created.json().version },
    })

    expect(patched.statusCode).toBe(200)
    expect(patched.json().holder).toBeNull()
    expect(patched.json().relation).toBeNull()
  })

  it('keeps the relation when only the holder is renamed', async () => {
    const user = await seedUserWithSpace(app)

    const created = await app.inject({
      method: 'POST',
      url: '/api/v1/documents',
      ...authAs(user),
      payload: { title: 'Aadhaar', holder: 'Priya', relation: 'Wife' },
    })

    const patched = await app.inject({
      method: 'PATCH',
      url: `/api/v1/documents/${created.json().id}`,
      ...authAs(user),
      payload: { holder: 'Priyanka', version: created.json().version },
    })

    // The opposite failure to the one above: a patch mentioning only `holder` must not wipe a
    // relation the user never touched.
    expect(patched.json().holder).toBe('Priyanka')
    expect(patched.json().relation).toBe('Wife')
  })

  it('filters by holder, and by ?holder=mine for the owner’s own', async () => {
    const user = await seedUserWithSpace(app)

    for (const payload of [
      { title: 'My Aadhaar' },
      { title: 'Priya Aadhaar', holder: 'Priya', relation: 'Wife' },
      { title: 'Arun passport', holder: 'Arun', relation: 'Son' },
    ]) {
      await app.inject({ method: 'POST', url: '/api/v1/documents', ...authAs(user), payload })
    }

    const named = await app.inject({
      method: 'GET',
      url: '/api/v1/documents?holder=Priya',
      ...authAs(user),
    })
    expect(named.json().data.map((row: { title: string }) => row.title)).toEqual(['Priya Aadhaar'])

    // `mine` is the sentinel for `holder IS NULL` — see `documentListQuerySchema`.
    const mine = await app.inject({
      method: 'GET',
      url: '/api/v1/documents?holder=mine',
      ...authAs(user),
    })
    expect(mine.json().data.map((row: { title: string }) => row.title)).toEqual(['My Aadhaar'])

    // Absent means no filter at all, which is a different thing from `mine`.
    const all = await app.inject({ method: 'GET', url: '/api/v1/documents', ...authAs(user) })
    expect(all.json().data).toHaveLength(3)
  })

  it('lists distinct holders with the most recently filed relation for each', async () => {
    const user = await seedUserWithSpace(app)

    await app.inject({
      method: 'POST',
      url: '/api/v1/documents',
      ...authAs(user),
      payload: { title: 'Arun passport', holder: 'Arun', relation: 'Son (11)' },
    })
    await app.inject({
      method: 'POST',
      url: '/api/v1/documents',
      ...authAs(user),
      payload: { title: 'Arun Aadhaar', holder: 'Arun', relation: 'Son (12)' },
    })
    // The owner's own documents are not people: `holder IS NULL` is excluded, because the picker
    // draws "Me" rather than a name.
    await app.inject({
      method: 'POST',
      url: '/api/v1/documents',
      ...authAs(user),
      payload: { title: 'My PAN' },
    })

    const holders = await app.inject({
      method: 'GET',
      url: '/api/v1/documents/holders',
      ...authAs(user),
    })

    expect(holders.statusCode).toBe(200)
    // One entry per person, and the NEWEST relation wins — so correcting "Son (11)" to "Son (12)"
    // updates the suggestion rather than being outvoted by history.
    expect(holders.json().data).toEqual([{ holder: 'Arun', relation: 'Son (12)' }])
  })

  it('does not let a holder cross a space boundary', async () => {
    // The invariant that matters most about this field: it is a label, and `scoped()` is still the
    // only thing that decides what a caller can read (invariants 2, 3 and 4).
    const mine = await seedUserWithSpace(app)
    const theirs = await seedUserWithSpace(app)

    await app.inject({
      method: 'POST',
      url: '/api/v1/documents',
      ...authAs(theirs),
      payload: { title: 'Their Aadhaar', holder: 'Priya', relation: 'Wife' },
    })

    const holders = await app.inject({
      method: 'GET',
      url: '/api/v1/documents/holders',
      ...authAs(mine),
    })
    expect(holders.json().data).toEqual([])

    const filtered = await app.inject({
      method: 'GET',
      url: '/api/v1/documents?holder=Priya',
      ...authAs(mine),
    })
    expect(filtered.json().data).toEqual([])
  })

  it('never lets a client set the mask directly, in a list or anywhere else', async () => {
    const user = await seedUserWithSpace(app)

    // `identifier_last4` is DERIVED. A create that tries to supply one must not be able to make the
    // mask disagree with the number it masks — that is the drift `identifierColumns` exists to stop,
    // and it is the one invariant ADR-0027 did NOT relax.
    const created = await app.inject({
      method: 'POST',
      url: '/api/v1/documents',
      ...authAs(user),
      payload: { title: 'PAN card', identifier: 'FAKEABCDE1234F', identifier_last4: '0000' },
    })

    // Query schemas are strict, and so is the create body: an unknown field is a 400 rather than a
    // silent strip (conventions/api.md §7, debt D27). Either way the mask must never be '0000'.
    if (created.statusCode === 201) {
      expect(created.json().identifier_last4).toBe('234F')
    } else {
      expect(created.statusCode).toBe(400)
    }
  })

  it('rule 6: trims before masking, and treats an emptied field as no identifier', async () => {
    const user = await seedUserWithSpace(app)

    const created = await app.inject({
      method: 'POST',
      url: '/api/v1/documents',
      ...authAs(user),
      // A trailing space is what a phone keyboard produces. The mask comes off the END of the
      // string, so an untrimmed value masks to "109 " — wrong in the one place the mask is shown.
      payload: { title: 'PAN card', identifier: '  FAKEABCDE1234F  ' },
    })
    expect(created.json().identifier_last4).toBe('234F')

    // `null`, not `''` — `identifierInputSchema` is `min(1)`, and `DocumentForm` already maps a blank
    // field to null in its own schema so validation and submission cannot disagree.
    const emptied = await app.inject({
      method: 'PATCH',
      url: `/api/v1/documents/${created.json().id}`,
      ...authAs(user),
      payload: { identifier: null, version: created.json().version },
    })
    expect(emptied.statusCode).toBe(200)
    expect(emptied.json().identifier_last4).toBeNull()

    const detail = await app.inject({
      method: 'GET',
      url: `/api/v1/documents/${created.json().id}`,
      ...authAs(user),
    })
    // Both columns clear together. Leaving yesterday's mask on the row is the drift
    // `identifierColumns` exists to prevent, and it would show in every list.
    expect(detail.json().identifier).toBeNull()
    expect(detail.json().identifier_last4).toBeNull()
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
      payload: { version: document.version, expires_on: '2031-01-15' },
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
      payload: { version: document.version, expires_on: null },
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
      url: `/api/v1/documents/${document.id}?version=${document.version}`,
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

  // ── ADR-0024: the version precondition ───────────────────────────────────

  it('ADR-0024: bumps the version on every successful patch', async () => {
    const user = await seedUserWithSpace(app)
    const document = await createDocument(app, user)
    expect(document.version).toBe(1)

    const first = await app.inject({
      method: 'PATCH',
      url: `/api/v1/documents/${document.id}`,
      ...authAs(user),
      payload: { version: document.version, title: 'Renamed once' },
    })
    expect(first.statusCode).toBe(200)
    expect(first.json().version).toBe(2)

    // The new version is what the next write must present — chaining proves the counter advances
    // rather than merely being non-zero once.
    const second = await app.inject({
      method: 'PATCH',
      url: `/api/v1/documents/${document.id}`,
      ...authAs(user),
      payload: { version: 2, title: 'Renamed twice' },
    })
    expect(second.statusCode).toBe(200)
    expect(second.json().version).toBe(3)
  })

  it('ADR-0024: refuses a stale patch with 409 and leaves the record untouched', async () => {
    const user = await seedUserWithSpace(app)
    const document = await createDocument(app, user)

    // Two edits built against the SAME version — the offline case exactly: one write left the
    // outbox, the other was made on another device first.
    const winner = await app.inject({
      method: 'PATCH',
      url: `/api/v1/documents/${document.id}`,
      ...authAs(user),
      payload: { version: document.version, title: 'Written on the laptop' },
    })
    expect(winner.statusCode).toBe(200)

    const loser = await app.inject({
      method: 'PATCH',
      url: `/api/v1/documents/${document.id}`,
      ...authAs(user),
      payload: { version: document.version, title: 'Written on the phone' },
    })

    // 409, not 200 — conventions/api.md §91 reserves it for exactly "version mismatch".
    expect(loser.statusCode).toBe(409)
    expect(loser.headers['content-type']).toContain('application/problem+json')
    // The current version is in the message so the client can re-read without guessing.
    expect(loser.json().detail).toContain('version')

    // The assertion that matters: the losing write left NOTHING behind. This is the whole point of
    // ADR-0024 — the alternative design silently kept 'Written on the phone'.
    const detail = await app.inject({
      method: 'GET',
      url: `/api/v1/documents/${document.id}`,
      ...authAs(user),
    })
    expect(detail.json().title).toBe('Written on the laptop')
    expect(detail.json().version).toBe(2)
  })

  it('D41: refuses a stale DELETE with 409 and leaves the document intact', async () => {
    const user = await seedUserWithSpace(app)
    const document = await createDocument(app, user)

    // Somebody edits it after this client last read it — the two-devices case.
    const edited = await app.inject({
      method: 'PATCH',
      url: `/api/v1/documents/${document.id}`,
      ...authAs(user),
      payload: { version: document.version, title: 'Edited on the other device' },
    })
    expect(edited.statusCode).toBe(200)

    // The delete still carries the version it loaded, which is now stale.
    const deleted = await app.inject({
      method: 'DELETE',
      url: `/api/v1/documents/${document.id}?version=${document.version}`,
      ...authAs(user),
    })
    expect(deleted.statusCode).toBe(409)

    /**
     * The assertion that matters, and the reason D41 was worth closing: the document is STILL THERE.
     * Before the precondition, this delete succeeded and destroyed the edit above — permanently,
     * because there is no restore endpoint in this app.
     */
    const detail = await app.inject({
      method: 'GET',
      url: `/api/v1/documents/${document.id}`,
      ...authAs(user),
    })
    expect(detail.statusCode).toBe(200)
    expect(detail.json().title).toBe('Edited on the other device')
  })

  it('D41: a DELETE with no version is rejected, not treated as unconditional', async () => {
    const user = await seedUserWithSpace(app)
    const document = await createDocument(app, user)

    const deleted = await app.inject({
      method: 'DELETE',
      url: `/api/v1/documents/${document.id}`,
      ...authAs(user),
    })

    // 400: the precondition is required, so a client that forgets it cannot fall back to the old
    // unconditional behaviour by omission — which is exactly how this class of bug returns.
    expect(deleted.statusCode).toBe(400)

    const detail = await app.inject({
      method: 'GET',
      url: `/api/v1/documents/${document.id}`,
      ...authAs(user),
    })
    expect(detail.statusCode).toBe(200)
  })

  it('D41: a typo in the version parameter is rejected, not ignored', async () => {
    const user = await seedUserWithSpace(app)
    const document = await createDocument(app, user)

    // `strictObject` on the query schema — conventions/api.md §7 / debt D27. Without it, `?verison=`
    // is an unknown key that gets stripped, and the delete proceeds unconditionally.
    const deleted = await app.inject({
      method: 'DELETE',
      url: `/api/v1/documents/${document.id}?verison=${document.version}`,
      ...authAs(user),
    })
    expect(deleted.statusCode).toBe(400)
  })

  it('ADR-0024: a stale patch on a deleted document is 404, not 409', async () => {
    const user = await seedUserWithSpace(app)
    const document = await createDocument(app, user)

    await app.inject({
      method: 'DELETE',
      url: `/api/v1/documents/${document.id}?version=${document.version}`,
      ...authAs(user),
    })

    const patched = await app.inject({
      method: 'PATCH',
      url: `/api/v1/documents/${document.id}`,
      ...authAs(user),
      payload: { version: document.version, title: 'Too late' },
    })

    // Both branches of the repository's `null` return are reachable, and they must not be confused:
    // "gone" is 404 and the client should stop, "moved on" is 409 and the client should re-read.
    expect(patched.statusCode).toBe(404)
  })

  it('rule 12: every document endpoint answers 404 across spaces, never 403', async () => {
    const { alice, bob } = await seedTwoUsers(app)
    const document = await createDocument(app, alice)

    const attempts = [
      { method: 'GET' as const, url: `/api/v1/documents/${document.id}` },
      {
        method: 'PATCH' as const,
        url: `/api/v1/documents/${document.id}`,
        payload: { version: document.version, title: 'x' },
      },
      { method: 'DELETE' as const, url: `/api/v1/documents/${document.id}?version=1` },
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
      payload: { version: document.version, doc_type: 'receipt' },
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
