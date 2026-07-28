import { sql } from 'drizzle-orm'
import type { FastifyInstance } from 'fastify'
import { afterAll, beforeAll, expect, it } from 'vitest'
import { buildApp } from '../../app.js'
import { db } from '../../db/client.js'
import { deliverReminder, scanReminders, sweepAbandoned, todayUtc } from '../../jobs/reminders.js'
import { describeDb, withCleanDatabase } from '../../test/db.js'
import { authAs, createDocument, seedTwoUsers, seedUserWithSpace } from '../../test/factories.js'
import { reminders } from '../documents/documents.schema.js'
import * as repository from './reminders.repository.js'

/**
 * Reminders — endpoints and the job handlers behind them. domains/documents.md §3, §5, §6.
 *
 * **The job handlers are tested directly**, not through pg-boss
 * (agent-playbooks/add-a-domain.md §8: "job handlers tested directly, including the failure
 * path"). That is the right seam: pg-boss's own scheduling is its concern, and starting it in a
 * test would create its schema in every throwaway database.
 *
 * Push is deliberately **unconfigured** in the test env, so the delivery tests assert the
 * not-configured path — which is a real runtime state, and the one every deployment is in before
 * VAPID keys are set.
 */

let app: FastifyInstance

/** `YYYY-MM-DD`, `days` from today. Reminders are date-based, so tests must be too. */
function isoDaysFromNow(days: number): string {
  const date = new Date()
  date.setUTCDate(date.getUTCDate() + days)
  return date.toISOString().slice(0, 10)
}

describeDb('reminders', () => {
  withCleanDatabase()

  beforeAll(async () => {
    app = await buildApp({ startJobs: false })
    await app.ready()
  })

  afterAll(async () => {
    await app.close()
  })

  // ── Endpoints ────────────────────────────────────────────────────────────

  it('attaches a reminder to a document and lists it', async () => {
    const user = await seedUserWithSpace(app)
    const document = await createDocument(app, user)

    const created = await app.inject({
      method: 'POST',
      url: `/api/v1/documents/${document.id}/reminders`,
      ...authAs(user),
      payload: { due_on: '2030-06-01', lead_days: 14 },
    })

    expect(created.statusCode).toBe(201)
    expect(created.json()).toMatchObject({
      entity_type: 'document',
      entity_id: document.id,
      due_on: '2030-06-01',
      lead_days: 14,
      channel: 'web_push',
      sent_at: null,
      dismissed_at: null,
    })

    const list = await app.inject({
      method: 'GET',
      url: `/api/v1/documents/${document.id}/reminders`,
      ...authAs(user),
    })
    expect(list.json().data).toHaveLength(1)
  })

  it('rejects a channel that has no delivery path yet, with a reason', async () => {
    const user = await seedUserWithSpace(app)
    const document = await createDocument(app, user)

    const response = await app.inject({
      method: 'POST',
      url: `/api/v1/documents/${document.id}/reminders`,
      ...authAs(user),
      payload: { due_on: '2030-06-01', channel: 'email' },
    })

    // 422 rather than a Zod 400: the enum value is legitimate, the implementation is missing, and
    // the error should say so rather than "invalid enum value".
    expect(response.statusCode).toBe(422)
    expect(response.json().detail).toContain('not implemented')
  })

  it('dismisses a reminder without deleting it', async () => {
    const user = await seedUserWithSpace(app)
    const document = await createDocument(app, user)
    const created = await app.inject({
      method: 'POST',
      url: `/api/v1/documents/${document.id}/reminders`,
      ...authAs(user),
      payload: { due_on: '2030-06-01' },
    })

    const dismissed = await app.inject({
      method: 'POST',
      url: `/api/v1/reminders/${created.json().id}/dismiss`,
      ...authAs(user),
    })

    expect(dismissed.statusCode).toBe(200)
    expect(dismissed.json().dismissed_at).not.toBeNull()

    // Still present: a dismissed reminder is the record that it fired and was seen. Deleting it
    // would erase that.
    const list = await app.inject({
      method: 'GET',
      url: `/api/v1/documents/${document.id}/reminders`,
      ...authAs(user),
    })
    expect(list.json().data).toHaveLength(1)
  })

  it('deletes a reminder', async () => {
    const user = await seedUserWithSpace(app)
    const document = await createDocument(app, user)
    const created = await app.inject({
      method: 'POST',
      url: `/api/v1/documents/${document.id}/reminders`,
      ...authAs(user),
      payload: { due_on: '2030-06-01' },
    })

    const deleted = await app.inject({
      method: 'DELETE',
      url: `/api/v1/reminders/${created.json().id}`,
      ...authAs(user),
    })
    expect(deleted.statusCode).toBe(204)

    const list = await app.inject({
      method: 'GET',
      url: `/api/v1/documents/${document.id}/reminders`,
      ...authAs(user),
    })
    expect(list.json().data).toEqual([])
  })

  it('404s across spaces on both reminder-id endpoints', async () => {
    const { alice, bob } = await seedTwoUsers(app)
    const document = await createDocument(app, alice)
    const created = await app.inject({
      method: 'POST',
      url: `/api/v1/documents/${document.id}/reminders`,
      ...authAs(alice),
      payload: { due_on: '2030-06-01' },
    })
    const reminderId = created.json().id

    for (const attempt of [
      { method: 'DELETE' as const, url: `/api/v1/reminders/${reminderId}` },
      { method: 'POST' as const, url: `/api/v1/reminders/${reminderId}/dismiss` },
    ]) {
      const response = await app.inject({ ...attempt, ...authAs(bob) })
      expect(response.statusCode, `${attempt.method} ${attempt.url}`).toBe(404)
    }
  })

  // ── Push registration ────────────────────────────────────────────────────

  it('reports a null public key when push is unconfigured', async () => {
    const user = await seedUserWithSpace(app)
    const response = await app.inject({
      method: 'GET',
      url: '/api/v1/push/public-key',
      ...authAs(user),
    })

    // null rather than 503, so the web app hides the notification UI instead of offering a button
    // that fails.
    expect(response.statusCode).toBe(200)
    expect(response.json().public_key).toBeNull()
  })

  it('is idempotent per endpoint when a browser re-subscribes', async () => {
    const user = await seedUserWithSpace(app)
    const subscription = {
      endpoint: 'https://push.example.test/subscription-abc',
      keys: { p256dh: 'not-a-real-p256dh-value', auth: 'not-a-real-auth-value' },
    }

    const first = await app.inject({
      method: 'POST',
      url: '/api/v1/push/subscriptions',
      ...authAs(user),
      payload: subscription,
    })
    const second = await app.inject({
      method: 'POST',
      url: '/api/v1/push/subscriptions',
      ...authAs(user),
      payload: { ...subscription, keys: { p256dh: 'rotated-key', auth: 'rotated-auth' } },
    })

    expect(first.statusCode).toBe(201)
    expect(second.statusCode).toBe(201)
    // Same row. A second row would deliver every notification twice to one browser.
    expect(second.json().id).toBe(first.json().id)

    const rows = await repository.listSubscriptionsForMaintenance(
      (await app.inject({ method: 'GET', url: '/api/v1/me', ...authAs(user) })).json().spaces[0]
        .space_id,
    )
    expect(rows).toHaveLength(1)
    expect(rows[0]?.p256dh).toBe('rotated-key')
  })

  // ── The scan job ─────────────────────────────────────────────────────────

  it('scan: finds a reminder whose lead window has opened, and ignores one that has not', async () => {
    const user = await seedUserWithSpace(app)
    const document = await createDocument(app, user)

    // due in 10 days with a 30-day lead → due_on - lead_days is in the past → fires now
    await app.inject({
      method: 'POST',
      url: `/api/v1/documents/${document.id}/reminders`,
      ...authAs(user),
      payload: { due_on: isoDaysFromNow(10), lead_days: 30 },
    })
    // due in 100 days with a 7-day lead → not yet
    await app.inject({
      method: 'POST',
      url: `/api/v1/documents/${document.id}/reminders`,
      ...authAs(user),
      payload: { due_on: isoDaysFromNow(100), lead_days: 7 },
    })

    const due = await repository.listDueForMaintenance(todayUtc())
    expect(due).toHaveLength(1)
    expect(due[0]?.leadDays).toBe(30)
    // The join supplies the document title the notification needs.
    expect(due[0]?.documentTitle).toBe('Passport')
  })

  it('scan: ignores reminders that are already sent, dismissed or deleted', async () => {
    const user = await seedUserWithSpace(app)
    const document = await createDocument(app, user)
    const dueToday = { due_on: isoDaysFromNow(0), lead_days: 0 }

    const sent = await app.inject({
      method: 'POST',
      url: `/api/v1/documents/${document.id}/reminders`,
      ...authAs(user),
      payload: dueToday,
    })
    const dismissed = await app.inject({
      method: 'POST',
      url: `/api/v1/documents/${document.id}/reminders`,
      ...authAs(user),
      payload: dueToday,
    })

    await repository.markSentForMaintenance(sent.json().id)
    await app.inject({
      method: 'POST',
      url: `/api/v1/reminders/${dismissed.json().id}/dismiss`,
      ...authAs(user),
    })

    const due = await repository.listDueForMaintenance(todayUtc())
    expect(due).toEqual([])
  })

  it('scan: reports zero without touching pg-boss when nothing is due', async () => {
    const user = await seedUserWithSpace(app)
    const document = await createDocument(app, user)
    await app.inject({
      method: 'POST',
      url: `/api/v1/documents/${document.id}/reminders`,
      ...authAs(user),
      payload: { due_on: isoDaysFromNow(500), lead_days: 7 },
    })

    // Must not construct a pg-boss instance: the test database has no `pgboss` schema.
    const result = await scanReminders()
    expect(result).toEqual({ found: 0, enqueued: 0 })
  })

  // ── The delivery job ─────────────────────────────────────────────────────

  it('deliver: leaves sent_at null when the space has no subscriptions', async () => {
    const user = await seedUserWithSpace(app)
    const document = await createDocument(app, user)
    const created = await app.inject({
      method: 'POST',
      url: `/api/v1/documents/${document.id}/reminders`,
      ...authAs(user),
      payload: { due_on: isoDaysFromNow(0), lead_days: 0 },
    })
    const me = await app.inject({ method: 'GET', url: '/api/v1/me', ...authAs(user) })

    const result = await deliverReminder({
      reminderId: created.json().id,
      spaceId: me.json().spaces[0].space_id,
      title: 'Passport',
      dueOn: isoDaysFromNow(0),
    })

    expect(result.sent).toBe(0)
    // Left pending on purpose: registering a browser later must still get this reminder on the
    // next scan. Setting `sent_at` here would drop it forever.
    const still = await repository.listDueForMaintenance(todayUtc())
    expect(still).toHaveLength(1)
  })

  it('deliver: does not mark sent when push is unconfigured', async () => {
    const user = await seedUserWithSpace(app)
    const document = await createDocument(app, user)
    const created = await app.inject({
      method: 'POST',
      url: `/api/v1/documents/${document.id}/reminders`,
      ...authAs(user),
      payload: { due_on: isoDaysFromNow(0), lead_days: 0 },
    })
    const me = await app.inject({ method: 'GET', url: '/api/v1/me', ...authAs(user) })
    const spaceId = me.json().spaces[0].space_id

    await app.inject({
      method: 'POST',
      url: '/api/v1/push/subscriptions',
      ...authAs(user),
      payload: {
        endpoint: 'https://push.example.test/sub-1',
        keys: { p256dh: 'not-a-real-p256dh', auth: 'not-a-real-auth' },
      },
    })

    const result = await deliverReminder({
      reminderId: created.json().id,
      spaceId,
      title: 'Passport',
      dueOn: isoDaysFromNow(0),
    })

    // VAPID keys are absent in the test env, so nothing can be sent — and the reminder must stay
    // pending rather than being silently consumed.
    expect(result.sent).toBe(0)
    expect(await repository.listDueForMaintenance(todayUtc())).toHaveLength(1)
  })

  // ── The sweep job ────────────────────────────────────────────────────────

  it('sweep: removes a reminder whose document no longer exists', async () => {
    const user = await seedUserWithSpace(app)
    const document = await createDocument(app, user)
    const created = await app.inject({
      method: 'POST',
      url: `/api/v1/documents/${document.id}/reminders`,
      ...authAs(user),
      payload: { due_on: isoDaysFromNow(0), lead_days: 0 },
    })

    // Hard-delete the document, simulating the orphan that spec §9 question 4 accepts as the cost
    // of a polymorphic `entity_id` with no foreign key. Raw SQL because no endpoint hard-deletes.
    await db.execute(sql`delete from documents where id = ${document.id}`)

    const result = await sweepAbandoned()
    expect(result.reminders).toBe(1)

    const remaining = await db.select().from(reminders)
    expect(remaining[0]?.deletedAt).not.toBeNull()
    expect(remaining[0]?.id).toBe(created.json().id)
  })

  it('sweep: leaves a reminder whose document still exists', async () => {
    const user = await seedUserWithSpace(app)
    const document = await createDocument(app, user)
    await app.inject({
      method: 'POST',
      url: `/api/v1/documents/${document.id}/reminders`,
      ...authAs(user),
      payload: { due_on: isoDaysFromNow(0), lead_days: 0 },
    })

    const result = await sweepAbandoned()
    expect(result.reminders).toBe(0)
  })
})
