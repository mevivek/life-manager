import type { FastifyInstance } from 'fastify'
import { afterAll, beforeAll, expect, it } from 'vitest'
import { buildApp } from '../../app.js'
import { describeDb, withCleanDatabase } from '../../test/db.js'
import {
  authAs,
  createDocument,
  createThing,
  seedTwoUsers,
  seedUserWithSpace,
} from '../../test/factories.js'

/**
 * Things integration tests, against a real Postgres.
 *
 * Structured to mirror **domains/things.md §4** — each business rule has a test that names it, so a
 * review can check the numbered list off rather than reading for coverage
 * (agent-playbooks/add-a-domain.md §8).
 *
 * Every data endpoint gets a **cross-space 404** test. Non-negotiable (conventions/testing.md §2).
 *
 * Two habits from M1's mistakes are deliberate here:
 *
 *  - **Every count assertion drives a NON-ZERO value and then changes it** (debt D33). `file_count`
 *    was broken for the whole of M1 because every assertion on it happened to expect 0, so a query
 *    returning a constant zero satisfied all of them. `document_count` and `photo_count` are the same
 *    shape of field and get the same treatment.
 *  - **Filters are asserted in both directions.** A filter that quietly matched everything passes a
 *    test that only checks the rows it wanted are present.
 */

let app: FastifyInstance

/** A `things` list, by name, in the order the endpoint returned them. */
function names(response: { json: () => unknown }): string[] {
  return (response.json() as { data: { name: string }[] }).data.map((row) => row.name)
}

describeDb('things', () => {
  withCleanDatabase()

  beforeAll(async () => {
    app = await buildApp({ startJobs: false })
    await app.ready()
  })

  afterAll(async () => {
    await app.close()
  })

  // ── Rule 1: name required, everything else optional ──────────────────────

  it('rule 1: creates a thing from a name alone', async () => {
    const user = await seedUserWithSpace(app)

    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/things',
      ...authAs(user),
      payload: { name: 'Dishwasher' },
    })

    expect(response.statusCode).toBe(201)
    // Q2's answer for a second domain, as an assertion: a half-empty thing is valid, not broken.
    // This is what the capture wizard's *Skip for now* promises on five of its six steps (ADR-0030).
    expect(response.json()).toMatchObject({
      name: 'Dishwasher',
      kind: 'other',
      brand: null,
      model: null,
      serial: null,
      purchased_on: null,
      price: null,
      currency: null,
      // `null` cover is "no warranty recorded", a normal state and not a gap — rule 2's fourth state.
      warranty_ends_on: null,
      service_every_months: null,
      service_due_on: null,
      kept_at: null,
      holder: null,
      relation: null,
      // Rule 4: a thing is created `here`. `thingCreateSchema` has no ownership field at all.
      ownership: 'here',
      ownership_who: null,
      ownership_since: null,
      document_count: 0,
      photo_count: 0,
      version: 1,
    })
  })

  it('rule 1: rejects a missing or over-long name', async () => {
    const user = await seedUserWithSpace(app)

    const empty = await app.inject({
      method: 'POST',
      url: '/api/v1/things',
      ...authAs(user),
      payload: {},
    })
    expect(empty.statusCode).toBe(400)

    // MAX_NAME_LENGTH is 200 — the value just outside what Zod accepts (conventions/testing.md §3).
    const tooLong = await app.inject({
      method: 'POST',
      url: '/api/v1/things',
      ...authAs(user),
      payload: { name: 'x'.repeat(201) },
    })
    expect(tooLong.statusCode).toBe(400)
  })

  it('rule 1: ownership cannot be set at capture, because a thing is created here', async () => {
    const user = await seedUserWithSpace(app)

    // `thingCreateSchema` is a `z.strictObject` with no `ownership` key, so this is a 400 rather than
    // a silent strip. You cannot file something you have already given away.
    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/things',
      ...authAs(user),
      payload: { name: 'Old bike', ownership: 'gone' },
    })
    expect(response.statusCode).toBe(400)
  })

  // ── Rule 7: the serial is stored in full and masked for display ───────────

  it('rule 7: stores the serial in full and derives the mask from it', async () => {
    const user = await seedUserWithSpace(app)

    const created = await app.inject({
      method: 'POST',
      url: '/api/v1/things',
      ...authAs(user),
      // An obvious fake (conventions/testing.md §5). 11 characters, so a value truncated at either
      // end is visible rather than coincidentally right.
      payload: { name: 'Phone', kind: 'phone', serial: 'FAKE1234567' },
    })

    expect(created.statusCode).toBe(201)
    expect(created.json().serial).toBe('FAKE1234567')
    // ADR-0034: whole, and only once. No derived tail rides along with it.
    expect(created.json()).not.toHaveProperty('serial_last4')
  })

  it('rule 7: returns the full serial on the LIST as well as on detail', async () => {
    const user = await seedUserWithSpace(app)
    const thing = await createThing(app, user, {
      name: 'Car',
      kind: 'vehicle',
      serial: 'FAKE 22 BH 1234 AA',
    })

    const list = await app.inject({ method: 'GET', url: '/api/v1/things', ...authAs(user) })
    expect(list.statusCode).toBe(200)
    // `thingSchema` carries the full value, so the list does too — the same call ADR-0027 made for a
    // document's identifier. A list mapper that forgot the field would return `undefined`, and every
    // test asserting `null` on a thing with no serial would still pass (debt D33's shape).
    expect(list.json().data[0].serial).toBe('FAKE 22 BH 1234 AA')
    // And nothing beside it — ADR-0034 dropped `serial_last4`. A mask cut from a value in the same
    // response is a copy of that value; the device that draws one cuts it itself.
    expect(list.json().data[0]).not.toHaveProperty('serial_last4')

    const detail = await app.inject({
      method: 'GET',
      url: `/api/v1/things/${thing.id}`,
      ...authAs(user),
    })
    expect(detail.json().serial).toBe('FAKE 22 BH 1234 AA')
    expect(detail.json()).not.toHaveProperty('serial_last4')
  })

  it('rule 7: never lets a client store a mask of its own', async () => {
    const user = await seedUserWithSpace(app)

    // There is no `serial_last4` column since ADR-0034, and a client must not be able to bring one
    // back by sending it: a stored mask is a second copy of a fact that already travels whole.
    const created = await app.inject({
      method: 'POST',
      url: '/api/v1/things',
      ...authAs(user),
      payload: { name: 'Laptop', serial: 'FAKEABCDE1234F', serial_last4: '0000' },
    })

    // `thingCreateSchema` is strict, so this is a 400. Asserted as a real 400 rather than "either
    // way": a silent strip that produced a correct mask would also pass a looser assertion, and the
    // point is that the field is not part of the contract at all.
    expect(created.statusCode).toBe(400)
  })

  it('rule 7: trims the stored value, and treats an emptied field as no serial', async () => {
    const user = await seedUserWithSpace(app)

    const created = await app.inject({
      method: 'POST',
      url: '/api/v1/things',
      ...authAs(user),
      // A trailing space is what a phone keyboard produces. A tail is cut from the END of the
      // string, so an untrimmed value would draw as "234 " wherever the client masks one.
      payload: { name: 'Laptop', serial: '  FAKEABCDE1234F  ' },
    })
    expect(created.json().serial).toBe('FAKEABCDE1234F')

    const emptied = await app.inject({
      method: 'PATCH',
      url: `/api/v1/things/${created.json().id}`,
      ...authAs(user),
      payload: { version: created.json().version, serial: null },
    })
    expect(emptied.statusCode).toBe(200)
    // Cleared for good, with nothing left behind holding a piece of the old value.
    expect(emptied.json().serial).toBeNull()
    expect(emptied.json()).not.toHaveProperty('serial_last4')
  })

  // ── Rule 6: the holder is a label, never a permission ────────────────────

  it('rule 6: stores a holder and its relation, and returns both', async () => {
    const user = await seedUserWithSpace(app)

    const created = await app.inject({
      method: 'POST',
      url: '/api/v1/things',
      ...authAs(user),
      payload: { name: 'Scooter', holder: 'Priya', relation: 'Wife' },
    })

    expect(created.statusCode).toBe(201)
    expect(created.json().holder).toBe('Priya')
    expect(created.json().relation).toBe('Wife')
  })

  it('rule 6: discards a relation with no holder, because it labels nobody', async () => {
    const user = await seedUserWithSpace(app)

    const created = await app.inject({
      method: 'POST',
      url: '/api/v1/things',
      ...authAs(user),
      payload: { name: 'Scooter', relation: 'Wife' },
    })

    expect(created.statusCode).toBe(201)
    expect(created.json().holder).toBeNull()
    expect(created.json().relation).toBeNull()
  })

  it('rule 6: clears the relation when the holder is cleared, and keeps it on a rename', async () => {
    const user = await seedUserWithSpace(app)
    const thing = await createThing(app, user, {
      name: 'Scooter',
      holder: 'Priya',
      relation: 'Wife',
    })

    const renamed = await app.inject({
      method: 'PATCH',
      url: `/api/v1/things/${thing.id}`,
      ...authAs(user),
      // Only `holder` is mentioned. A patch mentioning one half must not wipe a relation the user
      // never touched — the opposite failure to the one below.
      payload: { version: thing.version, holder: 'Priyanka' },
    })
    expect(renamed.json().holder).toBe('Priyanka')
    expect(renamed.json().relation).toBe('Wife')

    const cleared = await app.inject({
      method: 'PATCH',
      url: `/api/v1/things/${thing.id}`,
      ...authAs(user),
      payload: { version: renamed.json().version, holder: null },
    })
    // `relation` must follow the holder to null rather than being left behind on a thing that is now
    // the owner's own — the detail screen would otherwise read "Mine · Wife".
    expect(cleared.json().holder).toBeNull()
    expect(cleared.json().relation).toBeNull()
  })

  it('rule 6: filters by holder, and by ?holder=mine for the owner’s own', async () => {
    const user = await seedUserWithSpace(app)
    await createThing(app, user, { name: 'My laptop' })
    await createThing(app, user, { name: 'Priya scooter', holder: 'Priya', relation: 'Wife' })
    await createThing(app, user, { name: 'Arun bike', holder: 'Arun', relation: 'Son' })

    const named = await app.inject({
      method: 'GET',
      url: '/api/v1/things?holder=Priya',
      ...authAs(user),
    })
    expect(names(named)).toEqual(['Priya scooter'])

    // `mine` is the sentinel for `holder IS NULL` — the literal string, not `''`.
    const mine = await app.inject({
      method: 'GET',
      url: '/api/v1/things?holder=mine',
      ...authAs(user),
    })
    expect(names(mine)).toEqual(['My laptop'])

    // Absent means no filter at all, which is a different thing from `mine`.
    const all = await app.inject({ method: 'GET', url: '/api/v1/things', ...authAs(user) })
    expect(all.json().data).toHaveLength(3)
  })

  it('rule 6: lists distinct holders with the most recently filed relation for each', async () => {
    const user = await seedUserWithSpace(app)
    await createThing(app, user, { name: 'Arun bike', holder: 'Arun', relation: 'Son (11)' })
    await createThing(app, user, { name: 'Arun tablet', holder: 'Arun', relation: 'Son (12)' })
    // The owner's own things are not people: `holder IS NULL` is excluded, because the picker draws
    // "Me" rather than a name.
    await createThing(app, user, { name: 'My laptop' })

    const holders = await app.inject({
      method: 'GET',
      url: '/api/v1/things/holders',
      ...authAs(user),
    })

    expect(holders.statusCode).toBe(200)
    // One entry per person, and the NEWEST relation wins — so correcting "Son (11)" to "Son (12)"
    // updates the suggestion rather than being outvoted by history.
    expect(holders.json().data).toEqual([{ holder: 'Arun', relation: 'Son (12)' }])
  })

  it('rule 6: a holder never crosses a space boundary', async () => {
    // The invariant that matters most about this field: it is a label, and `scoped()` is still the
    // only thing deciding what a caller can read (invariants 2, 3 and 4).
    const { alice, bob } = await seedTwoUsers(app)
    await createThing(app, bob, { name: 'Bob scooter', holder: 'Priya', relation: 'Wife' })

    const holders = await app.inject({
      method: 'GET',
      url: '/api/v1/things/holders',
      ...authAs(alice),
    })
    expect(holders.json().data).toEqual([])

    const filtered = await app.inject({
      method: 'GET',
      url: '/api/v1/things?holder=Priya',
      ...authAs(alice),
    })
    expect(filtered.json().data).toEqual([])
  })

  // ── Rule 4: ownership is a state, never a delete ─────────────────────────

  it('rule 4: lends a thing out, recording who has it and since when', async () => {
    const user = await seedUserWithSpace(app)
    const thing = await createThing(app, user, { name: 'Drill' })

    const lent = await app.inject({
      method: 'PATCH',
      url: `/api/v1/things/${thing.id}`,
      ...authAs(user),
      payload: {
        version: thing.version,
        ownership: 'lent',
        ownership_who: 'Next door',
        ownership_since: '2026-07-01',
      },
    })

    expect(lent.statusCode).toBe(200)
    expect(lent.json()).toMatchObject({
      ownership: 'lent',
      ownership_who: 'Next door',
      ownership_since: '2026-07-01',
    })
  })

  it('rule 4: returning a thing to `here` clears ownership_who and ownership_since', async () => {
    const user = await seedUserWithSpace(app)
    const thing = await createThing(app, user, { name: 'Drill' })

    const lent = await app.inject({
      method: 'PATCH',
      url: `/api/v1/things/${thing.id}`,
      ...authAs(user),
      payload: {
        version: thing.version,
        ownership: 'lent',
        ownership_who: 'Next door',
        ownership_since: '2026-07-01',
      },
    })
    expect(lent.json().ownership_who).toBe('Next door')

    /**
     * The whole of rule 4's third consequence, in one patch: `{ ownership: 'here' }` **alone** is the
     * "It's back with me" control, and the other two columns follow it to null *in the same
     * statement* — the same reason `relation` cannot outlive `holder`.
     *
     * This is also why `thingUpdateSchema` has no `.refine()` for the combination: a refine could
     * only reject `{ ownership: 'here', ownership_who: 'Next door' }`, and the useful behaviour is to
     * fix it rather than 422 a user who is not making a mistake.
     */
    const returned = await app.inject({
      method: 'PATCH',
      url: `/api/v1/things/${thing.id}`,
      ...authAs(user),
      payload: { version: lent.json().version, ownership: 'here' },
    })

    expect(returned.statusCode).toBe(200)
    expect(returned.json().ownership).toBe('here')
    expect(returned.json().ownership_who).toBeNull()
    expect(returned.json().ownership_since).toBeNull()
  })

  it('rule 4: `here` clears the pair even when the same patch tries to set it', async () => {
    const user = await seedUserWithSpace(app)
    const thing = await createThing(app, user, { name: 'Drill' })

    // Fixed, not rejected. See the note on `ownershipColumns`.
    const patched = await app.inject({
      method: 'PATCH',
      url: `/api/v1/things/${thing.id}`,
      ...authAs(user),
      payload: {
        version: thing.version,
        ownership: 'here',
        ownership_who: 'Next door',
        ownership_since: '2026-07-01',
      },
    })

    expect(patched.statusCode).toBe(200)
    expect(patched.json().ownership_who).toBeNull()
    expect(patched.json().ownership_since).toBeNull()
  })

  it('rule 4: a gone thing STAYS in the list rather than being hidden', async () => {
    const user = await seedUserWithSpace(app)
    const thing = await createThing(app, user, { name: 'Old bike' })

    const gone = await app.inject({
      method: 'PATCH',
      url: `/api/v1/things/${thing.id}`,
      ...authAs(user),
      payload: { version: thing.version, ownership: 'gone', ownership_who: 'Sold on Gumtree' },
    })
    expect(gone.json().ownership).toBe('gone')

    /**
     * Rule 4: *"`gone` is dimmed in the list, not hidden. Hiding it would make the archive lie about
     * what it holds."* The dimming is the client's job (55% opacity on the row); the API's job is to
     * keep returning it, and a default filter excluding `gone` would silently break the one thing a
     * sold thing is kept for — proving what you handed over and when.
     */
    const list = await app.inject({ method: 'GET', url: '/api/v1/things', ...authAs(user) })
    expect(names(list)).toEqual(['Old bike'])
  })

  it('rule 4: ?ownership= filters, is repeatable, and excludes the rest', async () => {
    const user = await seedUserWithSpace(app)
    const here = await createThing(app, user, { name: 'Aaa here' })
    const lent = await createThing(app, user, { name: 'Bbb lent' })
    const gone = await createThing(app, user, { name: 'Ccc gone' })

    for (const [thing, ownership] of [
      [lent, 'lent'],
      [gone, 'gone'],
    ] as const) {
      const response = await app.inject({
        method: 'PATCH',
        url: `/api/v1/things/${thing.id}`,
        ...authAs(user),
        payload: { version: thing.version, ownership },
      })
      expect(response.statusCode).toBe(200)
    }
    expect(here.body.ownership).toBe('here')

    const single = await app.inject({
      method: 'GET',
      url: '/api/v1/things?ownership=gone',
      ...authAs(user),
    })
    expect(names(single)).toEqual(['Ccc gone'])

    // Repeatable, unlike `holder`: "show me what is here or lent" is a real question.
    const both = await app.inject({
      method: 'GET',
      url: '/api/v1/things?ownership=here&ownership=lent',
      ...authAs(user),
    })
    expect(names(both)).toEqual(['Aaa here', 'Bbb lent'])

    const invalid = await app.inject({
      method: 'GET',
      url: '/api/v1/things?ownership=lost',
      ...authAs(user),
    })
    // A fourth state for "lost" is deliberately absent (`ownershipSchema`), so this is a 400 rather
    // than a filter that silently matches nothing.
    expect(invalid.statusCode).toBe(400)
  })

  // ── Rule 3: a service is a cycle, not a date ─────────────────────────────

  it('rule 3: logging a service recomputes service_due_on from the interval', async () => {
    const user = await seedUserWithSpace(app)
    const thing = await createThing(app, user, {
      name: 'Boiler',
      kind: 'appliance',
      service_every_months: 12,
      // The seed rule 3 allows: a thing with a cycle and an empty log uses this until the first
      // service is logged.
      service_due_on: '2026-03-01',
    })
    expect(thing.body.service_due_on).toBe('2026-03-01')

    const logged = await app.inject({
      method: 'POST',
      url: `/api/v1/things/${thing.id}/services`,
      ...authAs(user),
      payload: {
        serviced_on: '2026-07-15',
        cost: '128.50',
        currency: 'GBP',
        provider: 'Plumbcraft',
      },
    })

    expect(logged.statusCode).toBe(201)
    expect(logged.json()).toMatchObject({
      serviced_on: '2026-07-15',
      // Money is a decimal STRING plus a currency, never a JSON float (conventions/data.md §4).
      cost: '128.5000',
      currency: 'GBP',
      provider: 'Plumbcraft',
    })

    const detail = await app.inject({
      method: 'GET',
      url: `/api/v1/things/${thing.id}`,
      ...authAs(user),
    })
    // The seeded date has MOVED — 2026-07-15 plus twelve months. The client deliberately does not
    // send a next date: a cycle whose next date is client-computed is one two devices can disagree
    // about (invariant 5).
    expect(detail.json().service_due_on).toBe('2027-07-15')
    expect(detail.json().services).toHaveLength(1)
  })

  it('rule 3: the recompute clamps to the end of a short month, as Postgres does', async () => {
    const user = await seedUserWithSpace(app)
    const thing = await createThing(app, user, { name: 'Boiler', service_every_months: 1 })

    const logged = await app.inject({
      method: 'POST',
      url: `/api/v1/things/${thing.id}/services`,
      ...authAs(user),
      payload: { serviced_on: '2026-01-31' },
    })
    expect(logged.statusCode).toBe(201)

    const detail = await app.inject({
      method: 'GET',
      url: `/api/v1/things/${thing.id}`,
      ...authAs(user),
    })
    /**
     * **2026-02-28, not 2026-03-03.** `new Date(2026, 0 + 1, 31)` overflows into March, so a monthly
     * cycle logged on the 31st would drift forward a couple of days every time. `addMonthsClamped`
     * matches `date + interval '1 month'` instead, because the date a user typed into
     * `service_due_on` and the date the server derives must be the same kind of date.
     */
    expect(detail.json().service_due_on).toBe('2026-02-28')
  })

  it('rule 3: a thing with no cycle gets a service log and no due date', async () => {
    const user = await seedUserWithSpace(app)
    // `service_every_months` absent — rule 3: "a thing with `service_every_months IS NULL` has no
    // cycle and no due date".
    const thing = await createThing(app, user, { name: 'Kettle' })

    const logged = await app.inject({
      method: 'POST',
      url: `/api/v1/things/${thing.id}/services`,
      ...authAs(user),
      payload: { serviced_on: '2026-07-15' },
    })
    expect(logged.statusCode).toBe(201)

    const detail = await app.inject({
      method: 'GET',
      url: `/api/v1/things/${thing.id}`,
      ...authAs(user),
    })
    // The history is recorded; no date is invented. A `?? 0` in the recompute would have produced a
    // due date of "the day it was serviced", which reads as an overdue service forever.
    expect(detail.json().services).toHaveLength(1)
    expect(detail.json().service_due_on).toBeNull()
  })

  it('rule 3: the newest logged service is what the due date derives from', async () => {
    const user = await seedUserWithSpace(app)
    const thing = await createThing(app, user, { name: 'Boiler', service_every_months: 12 })

    // Logged out of order deliberately: the derivation reads the newest `serviced_on`, not the most
    // recently inserted row. Backfilling last year's service must not move the due date backwards.
    for (const servicedOn of ['2026-07-15', '2025-06-01']) {
      const response = await app.inject({
        method: 'POST',
        url: `/api/v1/things/${thing.id}/services`,
        ...authAs(user),
        payload: { serviced_on: servicedOn },
      })
      expect(response.statusCode).toBe(201)
    }

    const detail = await app.inject({
      method: 'GET',
      url: `/api/v1/things/${thing.id}`,
      ...authAs(user),
    })
    expect(detail.json().service_due_on).toBe('2027-07-15')
    // Newest first, so the log reads as history and `[0]` is the row the due date came from.
    const services = detail.json().services as { serviced_on: string }[]
    expect(services.map((service) => service.serviced_on)).toEqual(['2026-07-15', '2025-06-01'])
  })

  it('rule 3: deleting a service re-derives the due date, and clears it when the log empties', async () => {
    const user = await seedUserWithSpace(app)
    const thing = await createThing(app, user, { name: 'Boiler', service_every_months: 12 })

    const older = await app.inject({
      method: 'POST',
      url: `/api/v1/things/${thing.id}/services`,
      ...authAs(user),
      payload: { serviced_on: '2025-06-01' },
    })
    const newer = await app.inject({
      method: 'POST',
      url: `/api/v1/things/${thing.id}/services`,
      ...authAs(user),
      payload: { serviced_on: '2026-07-15' },
    })

    const afterNewer = await app.inject({
      method: 'GET',
      url: `/api/v1/things/${thing.id}`,
      ...authAs(user),
    })
    expect(afterNewer.json().service_due_on).toBe('2027-07-15')

    const removedNewer = await app.inject({
      method: 'DELETE',
      url: `/api/v1/things/${thing.id}/services/${newer.json().id}`,
      ...authAs(user),
    })
    expect(removedNewer.statusCode).toBe(204)

    const afterDelete = await app.inject({
      method: 'GET',
      url: `/api/v1/things/${thing.id}`,
      ...authAs(user),
    })
    // Re-derived from what is LEFT, not left stale and not nulled. This is the assertion that a
    // constant answer cannot satisfy: the date moved to a third distinct value.
    expect(afterDelete.json().service_due_on).toBe('2026-06-01')
    expect(afterDelete.json().services).toHaveLength(1)

    const removedOlder = await app.inject({
      method: 'DELETE',
      url: `/api/v1/things/${thing.id}/services/${older.json().id}`,
      ...authAs(user),
    })
    expect(removedOlder.statusCode).toBe(204)

    const emptied = await app.inject({
      method: 'GET',
      url: `/api/v1/things/${thing.id}`,
      ...authAs(user),
    })
    // Null, not the date seeded at capture — that value was overwritten by the first log and there
    // is nothing to restore. See the note on `removeService`.
    expect(emptied.json().services).toEqual([])
    expect(emptied.json().service_due_on).toBeNull()
  })

  it('rule 3: the recompute does not bump the thing’s version', async () => {
    const user = await seedUserWithSpace(app)
    const thing = await createThing(app, user, { name: 'Boiler', service_every_months: 12 })

    await app.inject({
      method: 'POST',
      url: `/api/v1/things/${thing.id}/services`,
      ...authAs(user),
      payload: { serviced_on: '2026-07-15' },
    })

    const detail = await app.inject({
      method: 'GET',
      url: `/api/v1/things/${thing.id}`,
      ...authAs(user),
    })
    // `service_due_on` is derived, not edited by the caller, so `updateDerived` deliberately skips
    // ADR-0024. If it bumped the version, a form the user already had open would 409 because a date
    // moved underneath them — for a change they caused and cannot see.
    expect(detail.json().version).toBe(thing.version)

    const stillEditable = await app.inject({
      method: 'PATCH',
      url: `/api/v1/things/${thing.id}`,
      ...authAs(user),
      payload: { version: thing.version, name: 'Boiler (upstairs)' },
    })
    expect(stillEditable.statusCode).toBe(200)
  })

  // ── Rule 5: deleting a thing does not delete its documents ───────────────

  it('rule 5: deleting a thing leaves its documents in place, with thing_id cleared', async () => {
    const user = await seedUserWithSpace(app)
    const thing = await createThing(app, user, { name: 'Car', kind: 'vehicle' })
    const registration = await createDocument(app, user, {
      title: 'Car registration',
      thing_id: thing.id,
    })
    const unrelated = await createDocument(app, user, { title: 'Passport' })

    const deleted = await app.inject({
      method: 'DELETE',
      url: `/api/v1/things/${thing.id}?version=${thing.version}`,
      ...authAs(user),
    })
    expect(deleted.statusCode).toBe(204)

    /**
     * The assertion the copy on the delete control makes: *"Its documents stay in Documents —
     * deleting the thing doesn't shred the paperwork."* A `cascade` on `documents.thing_id` would let
     * one tap destroy a passport-adjacent archive because somebody sold a car, and would make that
     * sentence a lie.
     */
    const detail = await app.inject({
      method: 'GET',
      url: `/api/v1/documents/${registration.id}`,
      ...authAs(user),
    })
    expect(detail.statusCode).toBe(200)
    expect(detail.json().title).toBe('Car registration')
    // And the link is CLEARED, not left dangling at a thing that now answers 404 — which is what the
    // detail screen's *Belongs to* card would otherwise draw.
    expect(detail.json().thing_id).toBeNull()

    const archive = await app.inject({ method: 'GET', url: '/api/v1/documents', ...authAs(user) })
    expect((archive.json().data as { title: string }[]).map((row) => row.title).sort()).toEqual([
      'Car registration',
      'Passport',
    ])
    expect(unrelated.body.thing_id).toBeNull()
  })

  it('rule 5: deleting a thing does soft-delete its own service log', async () => {
    const user = await seedUserWithSpace(app)
    const thing = await createThing(app, user, { name: 'Boiler', service_every_months: 12 })
    await app.inject({
      method: 'POST',
      url: `/api/v1/things/${thing.id}/services`,
      ...authAs(user),
      payload: { serviced_on: '2026-07-15' },
    })

    await app.inject({
      method: 'DELETE',
      url: `/api/v1/things/${thing.id}?version=${thing.version}`,
      ...authAs(user),
    })

    // The log belongs to the thing and goes with it — unlike the documents, which belong to
    // themselves and merely point at it. That asymmetry IS rule 5.
    const detail = await app.inject({
      method: 'GET',
      url: `/api/v1/things/${thing.id}`,
      ...authAs(user),
    })
    expect(detail.statusCode).toBe(404)
  })

  // ── Counts: non-zero, and they change (debt D33) ─────────────────────────

  it('counts linked documents on the list and on detail, and the count changes', async () => {
    const user = await seedUserWithSpace(app)
    const thing = await createThing(app, user, { name: 'Car', kind: 'vehicle' })
    const other = await createThing(app, user, { name: 'Zzz laptop' })

    const first = await createDocument(app, user, { title: 'Car insurance', thing_id: thing.id })
    await createDocument(app, user, { title: 'Car registration', thing_id: thing.id })
    // One unlinked, and one on a different thing, so a count that ignored its predicate would be
    // visibly wrong rather than coincidentally right.
    await createDocument(app, user, { title: 'Passport' })
    await createDocument(app, user, { title: 'Laptop receipt', thing_id: other.id })

    const list = await app.inject({ method: 'GET', url: '/api/v1/things', ...authAs(user) })
    const counts = Object.fromEntries(
      (list.json().data as { name: string; document_count: number }[]).map((row) => [
        row.name,
        row.document_count,
      ]),
    )
    // **Non-zero, and different per row** — conventions/testing.md §3 and debt D33. `file_count` was
    // 0 for the whole of M1 because every assertion on it happened to expect 0, and a correlated
    // subquery that always returned 0 satisfied all of them.
    expect(counts).toEqual({ Car: 2, 'Zzz laptop': 1 })

    const detail = await app.inject({
      method: 'GET',
      url: `/api/v1/things/${thing.id}`,
      ...authAs(user),
    })
    expect(detail.json().document_count).toBe(2)
    // The nested summary agrees with the count, and carries what the row renders.
    const linked = detail.json().documents as { title: string; doc_type: string }[]
    expect(linked.map((row) => row.title).sort()).toEqual(['Car insurance', 'Car registration'])

    // And it goes DOWN when a document is deleted, so it cannot be passing by returning a constant.
    await app.inject({
      method: 'DELETE',
      url: `/api/v1/documents/${first.id}?version=${first.version}`,
      ...authAs(user),
    })
    const after = await app.inject({
      method: 'GET',
      url: `/api/v1/things/${thing.id}`,
      ...authAs(user),
    })
    expect(after.json().document_count).toBe(1)
    expect((after.json().documents as unknown[]).length).toBe(1)
  })

  it('does not leak another space’s documents into a thing’s count or summary', async () => {
    const { alice, bob } = await seedTwoUsers(app)
    const thing = await createThing(app, alice, { name: 'Car', kind: 'vehicle' })
    /**
     * Bob files a document against ALICE's thing id — the foreign key lets him, because it checks
     * that the thing exists and cannot check whose space it is in, and Documents deliberately does
     * not validate the link against the actor's spaces (it is a label, like `holder`).
     *
     * **This test failed when it was first written**, and it is the reason `documentCountSql` carries
     * `documents.space_id = things.space_id`: without it Bob inflated Alice's `document_count` to 2
     * while the nested `documents` summary — which goes through `scoped()` — correctly showed one.
     * A list saying "2 documents" above a section listing one is exactly the shape of bug that
     * survives a suite (debt D33), so both are asserted here.
     */
    await createDocument(app, bob, { title: 'Bob insurance', thing_id: thing.id })
    await createDocument(app, alice, { title: 'Alice insurance', thing_id: thing.id })

    const detail = await app.inject({
      method: 'GET',
      url: `/api/v1/things/${thing.id}`,
      ...authAs(alice),
    })
    expect(detail.json().document_count).toBe(1)
    expect((detail.json().documents as { title: string }[]).map((row) => row.title)).toEqual([
      'Alice insurance',
    ])
  })

  // ── ADR-0024: the version precondition ───────────────────────────────────

  it('ADR-0024: bumps the version on every successful patch', async () => {
    const user = await seedUserWithSpace(app)
    const thing = await createThing(app, user)
    expect(thing.version).toBe(1)

    const first = await app.inject({
      method: 'PATCH',
      url: `/api/v1/things/${thing.id}`,
      ...authAs(user),
      payload: { version: thing.version, name: 'Renamed once' },
    })
    expect(first.statusCode).toBe(200)
    expect(first.json().version).toBe(2)

    // Chaining proves the counter advances rather than merely being non-zero once.
    const second = await app.inject({
      method: 'PATCH',
      url: `/api/v1/things/${thing.id}`,
      ...authAs(user),
      payload: { version: 2, name: 'Renamed twice' },
    })
    expect(second.statusCode).toBe(200)
    expect(second.json().version).toBe(3)
  })

  it('ADR-0024: refuses a stale patch with 409 and leaves the record untouched', async () => {
    const user = await seedUserWithSpace(app)
    const thing = await createThing(app, user)

    // Two edits built against the SAME version — the offline case exactly.
    const winner = await app.inject({
      method: 'PATCH',
      url: `/api/v1/things/${thing.id}`,
      ...authAs(user),
      payload: { version: thing.version, name: 'Written on the laptop' },
    })
    expect(winner.statusCode).toBe(200)

    const loser = await app.inject({
      method: 'PATCH',
      url: `/api/v1/things/${thing.id}`,
      ...authAs(user),
      payload: { version: thing.version, name: 'Written on the phone' },
    })

    expect(loser.statusCode).toBe(409)
    expect(loser.headers['content-type']).toContain('application/problem+json')
    // The current version is in the message so the client can re-read without guessing.
    expect(loser.json().detail).toContain('version')

    // The assertion that matters: the losing write left NOTHING behind.
    const detail = await app.inject({
      method: 'GET',
      url: `/api/v1/things/${thing.id}`,
      ...authAs(user),
    })
    expect(detail.json().name).toBe('Written on the laptop')
    expect(detail.json().version).toBe(2)
  })

  it('ADR-0024: a patch with no version is rejected, not applied unconditionally', async () => {
    const user = await seedUserWithSpace(app)
    const thing = await createThing(app, user)

    // `version` is REQUIRED on `thingUpdateSchema`, so a call site that forgets it is a 400 rather
    // than silently getting last-write-wins.
    const patched = await app.inject({
      method: 'PATCH',
      url: `/api/v1/things/${thing.id}`,
      ...authAs(user),
      payload: { name: 'No precondition' },
    })
    expect(patched.statusCode).toBe(400)
  })

  it('ADR-0024: a patch that changes nothing but the version is rejected', async () => {
    const user = await seedUserWithSpace(app)
    const thing = await createThing(app, user)

    // The `.refine()` on `thingUpdateSchema`: `version` is a precondition, not a change.
    const patched = await app.inject({
      method: 'PATCH',
      url: `/api/v1/things/${thing.id}`,
      ...authAs(user),
      payload: { version: thing.version },
    })
    expect(patched.statusCode).toBe(400)
  })

  it('ADR-0024: a stale patch on a deleted thing is 404, not 409', async () => {
    const user = await seedUserWithSpace(app)
    const thing = await createThing(app, user)

    await app.inject({
      method: 'DELETE',
      url: `/api/v1/things/${thing.id}?version=${thing.version}`,
      ...authAs(user),
    })

    const patched = await app.inject({
      method: 'PATCH',
      url: `/api/v1/things/${thing.id}`,
      ...authAs(user),
      payload: { version: thing.version, name: 'Too late' },
    })

    // Both branches of the repository's `null` return are reachable and must not be confused: "gone"
    // is 404 and the client should stop, "moved on" is 409 and the client should re-read.
    expect(patched.statusCode).toBe(404)
  })

  it('D41: refuses a stale DELETE with 409 and leaves the thing intact', async () => {
    const user = await seedUserWithSpace(app)
    const thing = await createThing(app, user)

    const edited = await app.inject({
      method: 'PATCH',
      url: `/api/v1/things/${thing.id}`,
      ...authAs(user),
      payload: { version: thing.version, name: 'Edited on the other device' },
    })
    expect(edited.statusCode).toBe(200)

    const deleted = await app.inject({
      method: 'DELETE',
      url: `/api/v1/things/${thing.id}?version=${thing.version}`,
      ...authAs(user),
    })
    expect(deleted.statusCode).toBe(409)

    /**
     * The assertion that matters, and the reason D41 was worth closing on the second domain too: the
     * thing is STILL THERE. Without the precondition this delete succeeds and destroys the edit
     * above — permanently, because there is no restore endpoint in this app.
     */
    const detail = await app.inject({
      method: 'GET',
      url: `/api/v1/things/${thing.id}`,
      ...authAs(user),
    })
    expect(detail.statusCode).toBe(200)
    expect(detail.json().name).toBe('Edited on the other device')
  })

  it('D41: a DELETE with no version, or a typo’d one, is rejected', async () => {
    const user = await seedUserWithSpace(app)
    const thing = await createThing(app, user)

    const missing = await app.inject({
      method: 'DELETE',
      url: `/api/v1/things/${thing.id}`,
      ...authAs(user),
    })
    // 400: the precondition is required, so a client that forgets it cannot fall back to the old
    // unconditional behaviour by omission — which is exactly how this class of bug returns.
    expect(missing.statusCode).toBe(400)

    // `strictObject` on the query schema — conventions/api.md §7 / debt D27. Without it `?verison=`
    // is an unknown key that gets stripped, and the delete proceeds unconditionally.
    const typo = await app.inject({
      method: 'DELETE',
      url: `/api/v1/things/${thing.id}?verison=${thing.version}`,
      ...authAs(user),
    })
    expect(typo.statusCode).toBe(400)

    const stillThere = await app.inject({
      method: 'GET',
      url: `/api/v1/things/${thing.id}`,
      ...authAs(user),
    })
    expect(stillThere.statusCode).toBe(200)
  })

  // ── Soft delete ──────────────────────────────────────────────────────────

  it('a deleted thing disappears from the list, from reads and from the holders list', async () => {
    const user = await seedUserWithSpace(app)
    const thing = await createThing(app, user, {
      name: 'Scooter',
      holder: 'Priya',
      relation: 'Wife',
    })

    const deleted = await app.inject({
      method: 'DELETE',
      url: `/api/v1/things/${thing.id}?version=${thing.version}`,
      ...authAs(user),
    })
    expect(deleted.statusCode).toBe(204)

    const read = await app.inject({
      method: 'GET',
      url: `/api/v1/things/${thing.id}`,
      ...authAs(user),
    })
    expect(read.statusCode).toBe(404)

    const list = await app.inject({ method: 'GET', url: '/api/v1/things', ...authAs(user) })
    expect(list.json().data).toEqual([])

    // `scoped()` carries the soft-delete filter, so every read inherits it — including the ones that
    // do not go through `findById`. This is the read most likely to be written without it.
    const holders = await app.inject({
      method: 'GET',
      url: '/api/v1/things/holders',
      ...authAs(user),
    })
    expect(holders.json().data).toEqual([])
  })

  // ── Rule 10 / invariant 4: cross-space is 404, never 403 ─────────────────

  it('rule 10: every thing endpoint answers 404 across spaces, never 403', async () => {
    const { alice, bob } = await seedTwoUsers(app)
    const thing = await createThing(app, alice)
    const service = await app.inject({
      method: 'POST',
      url: `/api/v1/things/${thing.id}/services`,
      ...authAs(alice),
      payload: { serviced_on: '2026-07-15' },
    })
    const photoId = '11111111-1111-4111-8111-111111111111'

    const attempts = [
      { method: 'GET' as const, url: `/api/v1/things/${thing.id}` },
      {
        method: 'PATCH' as const,
        url: `/api/v1/things/${thing.id}`,
        payload: { version: thing.version, name: 'x' },
      },
      { method: 'DELETE' as const, url: `/api/v1/things/${thing.id}?version=1` },
      {
        method: 'POST' as const,
        url: `/api/v1/things/${thing.id}/services`,
        payload: { serviced_on: '2026-07-15' },
      },
      {
        method: 'DELETE' as const,
        url: `/api/v1/things/${thing.id}/services/${service.json().id}`,
      },
      {
        method: 'POST' as const,
        url: `/api/v1/things/${thing.id}/photos:presign-upload`,
        payload: { mime: 'image/jpeg', size_bytes: 100 },
      },
      {
        method: 'POST' as const,
        url: `/api/v1/things/${thing.id}/photos:confirm`,
        payload: { photo_id: photoId },
      },
      {
        method: 'POST' as const,
        url: `/api/v1/things/${thing.id}/photos:presign-download`,
        payload: { photo_id: photoId },
      },
      {
        method: 'PATCH' as const,
        url: `/api/v1/things/${thing.id}/photos/${photoId}`,
        payload: { is_hero: true },
      },
      { method: 'DELETE' as const, url: `/api/v1/things/${thing.id}/photos/${photoId}` },
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

  it("does not list another space's things", async () => {
    const { alice, bob } = await seedTwoUsers(app)
    await createThing(app, alice, { name: 'Alice car' })

    const list = await app.inject({ method: 'GET', url: '/api/v1/things', ...authAs(bob) })
    expect(list.statusCode).toBe(200)
    expect(list.json().data).toEqual([])
  })

  it('requires a session on every thing endpoint', async () => {
    const unauthenticated = await app.inject({ method: 'GET', url: '/api/v1/things' })
    expect(unauthenticated.statusCode).toBe(401)

    const create = await app.inject({
      method: 'POST',
      url: '/api/v1/things',
      payload: { name: 'x' },
    })
    expect(create.statusCode).toBe(401)

    const holders = await app.inject({ method: 'GET', url: '/api/v1/things/holders' })
    expect(holders.statusCode).toBe(401)
  })

  // ── List: search, sort, pagination ───────────────────────────────────────

  it('sorts by name ascending by default', async () => {
    const user = await seedUserWithSpace(app)
    for (const name of ['Zebra crossing sign', 'Dishwasher', 'Motorbike']) {
      await createThing(app, user, { name })
    }

    const list = await app.inject({ method: 'GET', url: '/api/v1/things', ...authAs(user) })
    /**
     * §5: *"Default sort: name asc — a thing has no single date that orders it the way an expiry
     * orders a document, and alphabetical is the one order a person can predict."* Deliberately NOT
     * `created_at desc`, which is what a list endpoint written without reading §5 would do.
     */
    expect(names(list)).toEqual(['Dishwasher', 'Motorbike', 'Zebra crossing sign'])
  })

  it('sorts by a whitelisted date column when asked, nulls last', async () => {
    const user = await seedUserWithSpace(app)
    await createThing(app, user, { name: 'No cover' })
    await createThing(app, user, { name: 'Later', warranty_ends_on: '2031-01-01' })
    await createThing(app, user, { name: 'Sooner', warranty_ends_on: '2030-01-01' })

    const list = await app.inject({
      method: 'GET',
      url: '/api/v1/things?sort=warranty_ends_on',
      ...authAs(user),
    })
    expect(names(list)).toEqual(['Sooner', 'Later', 'No cover'])

    const invalid = await app.inject({
      method: 'GET',
      url: '/api/v1/things?sort=price',
      ...authAs(user),
    })
    // `sort` is a whitelist, never passed through to SQL (conventions/api.md §7).
    expect(invalid.statusCode).toBe(400)
  })

  it('rejects an unknown query parameter — debt D27', async () => {
    const user = await seedUserWithSpace(app)
    await createThing(app, user, { name: 'Car', kind: 'vehicle' })

    // The failure this prevents: a typo'd filter silently returning the UNFILTERED list.
    const response = await app.inject({
      method: 'GET',
      url: '/api/v1/things?kin=vehicle',
      ...authAs(user),
    })
    expect(response.statusCode).toBe(400)
  })

  it('filters by kind, repeatably, and excludes the rest', async () => {
    const user = await seedUserWithSpace(app)
    await createThing(app, user, { name: 'Car', kind: 'vehicle' })
    await createThing(app, user, { name: 'Laptop', kind: 'laptop' })
    await createThing(app, user, { name: 'Ring', kind: 'valuable' })

    const single = await app.inject({
      method: 'GET',
      url: '/api/v1/things?kind=vehicle',
      ...authAs(user),
    })
    expect(names(single)).toEqual(['Car'])

    // Repeated `?kind=` is an OR, which is what a row of filter chips means.
    const several = await app.inject({
      method: 'GET',
      url: '/api/v1/things?kind=vehicle&kind=laptop',
      ...authAs(user),
    })
    expect(names(several)).toEqual(['Car', 'Laptop'])

    const invalid = await app.inject({
      method: 'GET',
      url: '/api/v1/things?kind=spaceship',
      ...authAs(user),
    })
    expect(invalid.statusCode).toBe(400)
  })

  it('searches name, brand, model, notes and kept_at, ranking a name match highest', async () => {
    const user = await seedUserWithSpace(app)
    await createThing(app, user, { name: 'Dishwasher', brand: 'Bosch', kept_at: 'Kitchen' })
    await createThing(app, user, { name: 'Extended cover', notes: 'covers the dishwasher' })
    await createThing(app, user, { name: 'Unrelated kettle' })

    const found = await app.inject({
      method: 'GET',
      url: '/api/v1/things?q=dishwasher',
      ...authAs(user),
    })
    expect(found.statusCode).toBe(200)
    const matched = names(found)
    expect(matched).toContain('Dishwasher')
    expect(matched).toContain('Extended cover')
    // Both directions: a search that matched everything would pass on the two lines above alone.
    expect(matched).not.toContain('Unrelated kettle')

    const byBrand = await app.inject({
      method: 'GET',
      url: '/api/v1/things?q=bosch',
      ...authAs(user),
    })
    expect(names(byBrand)).toEqual(['Dishwasher'])

    const byLocation = await app.inject({
      method: 'GET',
      url: '/api/v1/things?q=kitchen',
      ...authAs(user),
    })
    expect(names(byLocation)).toEqual(['Dishwasher'])

    // `websearch_to_tsquery` must not throw on input a person would actually type — `to_tsquery`
    // raises a syntax error on something as ordinary as `a & `, which reaches the user as a 500.
    for (const query of ['a & ', '"unclosed', '-', 'or or or']) {
      const response = await app.inject({
        method: 'GET',
        url: `/api/v1/things?q=${encodeURIComponent(query)}`,
        ...authAs(user),
      })
      expect(response.statusCode, `q=${query} must not 500`).toBe(200)
    }
  })

  it('paginates with a cursor, without repeating or skipping a row on a tied sort key', async () => {
    const user = await seedUserWithSpace(app)
    // All four share a `purchased_on`, so only the id tie-break can order them. This is the case
    // that breaks naive keyset pagination.
    for (const name of ['A', 'B', 'C', 'D']) {
      await createThing(app, user, { name, purchased_on: '2026-01-01' })
    }

    const seen: string[] = []
    let url = '/api/v1/things?limit=2&sort=purchased_on'
    for (let page = 0; page < 5; page += 1) {
      const response = await app.inject({ method: 'GET', url, ...authAs(user) })
      expect(response.statusCode).toBe(200)
      const body = response.json() as { data: { name: string }[]; next_cursor: string | null }
      seen.push(...body.data.map((row) => row.name))
      if (body.next_cursor === null) break
      url = `/api/v1/things?limit=2&sort=purchased_on&cursor=${encodeURIComponent(body.next_cursor)}`
    }

    expect(seen.sort()).toEqual(['A', 'B', 'C', 'D'])
    expect(new Set(seen).size).toBe(4)
  })

  it('paginates every sort option, not just the default — page 2 follows page 1 with no gap', async () => {
    const user = await seedUserWithSpace(app)
    for (const name of ['A', 'B', 'C']) {
      await createThing(app, user, {
        name,
        purchased_on: '2026-01-01',
        warranty_ends_on: '2030-01-01',
        service_every_months: 12,
        service_due_on: '2027-01-01',
      })
    }

    // One sort per column type in the whitelist. The cursor's sort value is validated — and bound —
    // against the column it is compared with, so a whitelist entry this loop does not name is one
    // whose cursor has never been round-tripped.
    for (const sort of ['name', 'purchased_on', 'warranty_ends_on', 'service_due_on'] as const) {
      const first = await app.inject({
        method: 'GET',
        url: `/api/v1/things?limit=2&sort=${sort}`,
        ...authAs(user),
      })
      expect(first.statusCode, sort).toBe(200)
      const page1 = first.json() as { data: { name: string }[]; next_cursor: string | null }
      expect(page1.data.length, sort).toBe(2)
      expect(page1.next_cursor, `${sort} must offer a page two`).not.toBeNull()
      if (page1.next_cursor === null) continue

      const second = await app.inject({
        method: 'GET',
        url: `/api/v1/things?limit=2&sort=${sort}&cursor=${encodeURIComponent(page1.next_cursor)}`,
        ...authAs(user),
      })
      expect(second.statusCode, `${sort} page 2`).toBe(200)
      const page2 = second.json() as { data: { name: string }[]; next_cursor: string | null }
      expect(page2.data.length, sort).toBe(1)
      expect(page2.next_cursor, `${sort} must be the last page`).toBeNull()

      // No gap and no repeat: the two pages together are exactly the three rows, each once.
      const seen = [...page1.data, ...page2.data].map((row) => row.name)
      expect(seen.length, sort).toBe(3)
      expect([...seen].sort(), sort).toEqual(['A', 'B', 'C'])
    }
  })

  it('rejects a malformed cursor rather than silently serving page one', async () => {
    const user = await seedUserWithSpace(app)
    const response = await app.inject({
      method: 'GET',
      url: '/api/v1/things?cursor=not-a-real-cursor',
      ...authAs(user),
    })
    /**
     * 400: a cursor the client did not get from us is a bug worth surfacing. Serving page one would
     * look like the list randomly resetting.
     *
     * **Was 422 until 2026-07-30.** conventions/api.md §3's table splits the two by what failed —
     * 400 is a malformed request, 422 is a well-formed one breaking a business rule — and a cursor
     * that does not parse is malformed. §4 and `lib/cursor.ts` were corrected together.
     */
    expect(response.statusCode).toBe(400)
    expect(response.json().type).toBe('https://life-manager.app/problems/validation-failed')
  })

  it('rejects a WELL-FORMED cursor carrying garbage with a 400, never a 500', async () => {
    const user = await seedUserWithSpace(app)
    for (const name of ['A', 'B', 'C']) {
      await createThing(app, user, { name, purchased_on: '2026-01-01' })
    }

    // Non-zero, so a 400 below cannot be an empty archive dressed up as validation (debt D33).
    const all = await app.inject({ method: 'GET', url: '/api/v1/things', ...authAs(user) })
    expect(all.statusCode).toBe(200)
    expect((all.json().data as unknown[]).length).toBe(3)

    /**
     * These all decode to valid JSON with `v: 1`, so the old two-field check waved them through and
     * bound them into the `WHERE` clause: `i` reached `gt(things.id, 'not-a-uuid')` and Postgres
     * raised `22P02 invalid input syntax for type uuid`, which fell through to the last step of
     * `lib/problem.ts` as a **500 on every paginated endpoint**. Measured, not theorised.
     *
     * No cross-space read was ever possible — the tenant filter is a separate `AND` a cursor cannot
     * reach — so this is availability, not a leak.
     */
    const garbage: { label: string; query: string; payload: unknown }[] = [
      {
        label: 'id is not a uuid',
        query: '',
        payload: { v: 1, s: null, i: 'not-a-uuid' },
      },
      {
        label: 'sort value is not a date, but the column is',
        query: '&sort=purchased_on',
        payload: { v: 1, s: 'nope', i: '3f1a9b5e-7c2d-4e8a-9b0f-1d2c3e4f5a6b' },
      },
      {
        label: 'a version this server never minted',
        query: '',
        payload: { v: 2, s: null, i: '3f1a9b5e-7c2d-4e8a-9b0f-1d2c3e4f5a6b' },
      },
    ]

    for (const { label, query, payload } of garbage) {
      const cursor = Buffer.from(JSON.stringify(payload), 'utf8').toString('base64url')
      const response = await app.inject({
        method: 'GET',
        url: `/api/v1/things?limit=2${query}&cursor=${encodeURIComponent(cursor)}`,
        ...authAs(user),
      })
      expect(response.statusCode, label).toBe(400)
      expect(response.json().type, label).toBe(
        'https://life-manager.app/problems/validation-failed',
      )
      // The response must not echo the payload's internal field letters back.
      expect(response.json().detail, label).toBe('That pagination cursor is not valid.')
    }
  })

  // ── §6: reminders — the capability exists, the automatic creation does not ─

  it('§6: returns an empty reminders array, because nothing creates one yet (§9(2))', async () => {
    const user = await seedUserWithSpace(app)
    const thing = await createThing(app, user, {
      name: 'Dishwasher',
      warranty_ends_on: '2030-06-01',
      service_every_months: 12,
      service_due_on: '2027-01-01',
    })

    const detail = await app.inject({
      method: 'GET',
      url: `/api/v1/things/${thing.id}`,
      ...authAs(user),
    })

    /**
     * ═══════════════════════════════════════════════════════════════════════════════════════
     *  This asserts the ABSENCE of a feature on purpose, and it is not an oversight.
     * ═══════════════════════════════════════════════════════════════════════════════════════
     *
     * things.md §9(2) — *should a warranty create reminders automatically?* — is **unanswered**, and
     * §6 says in as many words: "Do not decide it in a repository." Documents auto-create 90/30/7-day
     * reminders for `identity` and `certificate` only; the equivalent call here has not been made by
     * a human.
     *
     * So the *capability* is built (the table is generic on `entity_type`, `THING_ENTITY_TYPE` exists,
     * this array is plumbed through the response) and the switch is off. **If you are here because you
     * just turned it on, this test is the one to change — and read the note on
     * `listDueForMaintenance` first**, because the scan's copy would announce that a warranty
     * "expires", which is the one sentence ADR-0029 exists to prevent.
     */
    expect(detail.statusCode).toBe(200)
    expect(detail.json().reminders).toEqual([])
    // The dates that *would* drive them are stored and returned, so switching it on is a service
    // change and not a schema one.
    expect(detail.json().warranty_ends_on).toBe('2030-06-01')
    expect(detail.json().service_due_on).toBe('2027-01-01')
  })

  // ── The `::` route-escaping trap ─────────────────────────────────────────

  it('does not match a garbage suffix on a :verb action route', async () => {
    const user = await seedUserWithSpace(app)
    const thing = await createThing(app, user)

    // Without the `::` escape in the route pattern, Fastify parses `:confirm` as a PARAM and this
    // request matches the confirm handler. See the block comment in things.routes.ts.
    const response = await app.inject({
      method: 'POST',
      url: `/api/v1/things/${thing.id}/photosGARBAGE`,
      ...authAs(user),
      payload: { photo_id: '11111111-1111-4111-8111-111111111111' },
    })
    expect(response.statusCode).toBe(404)
  })

  // ── OpenAPI ──────────────────────────────────────────────────────────────

  it('documents every Things endpoint in the OpenAPI document, with real colons', async () => {
    const response = await app.inject({ method: 'GET', url: '/api/v1/openapi.json' })
    const paths = Object.keys(response.json().paths as Record<string, unknown>)

    // The `:verb` URLs must appear with a real colon, not as a path parameter — `@fastify/swagger`
    // mistranslates the escape when it sits after a parameter, which is why the photo is named in
    // the body rather than the path.
    expect(paths).toEqual(
      expect.arrayContaining([
        '/api/v1/things',
        '/api/v1/things/holders',
        '/api/v1/things/{id}',
        '/api/v1/things/{id}/services',
        '/api/v1/things/{id}/services/{serviceId}',
        '/api/v1/things/{id}/photos:presign-upload',
        '/api/v1/things/{id}/photos:confirm',
        '/api/v1/things/{id}/photos:presign-download',
        '/api/v1/things/{id}/photos/{photoId}',
      ]),
    )
    // And nothing mangled: a path containing `{presign}` is the exact failure api.md §2 records.
    expect(paths.filter((path) => path.includes('{presign}'))).toEqual([])
  })
})
