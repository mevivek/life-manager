import { maintenanceRunResponseSchema } from '@life-manager/shared'
import type { FastifyInstance } from 'fastify'
import { Client } from 'pg'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { buildApp } from '../../app.js'
import { env } from '../../env.js'
import { describeDb, withCleanDatabase } from '../../test/db.js'
import { authAs, createDocument, seedUserWithSpace } from '../../test/factories.js'
import * as remindersRepository from '../reminders/reminders.repository.js'
import { secretsMatch } from './maintenance.service.js'

/**
 * `POST /api/v1/maintenance::run-daily`. ADR-0028.
 *
 * The weight here is on the DOOR rather than on the scan, because the scan's own logic is covered in
 * `reminders.test.ts` and the door is the new risk: this is the only endpoint in the API that runs
 * cross-space work with no session, so "who may call it" is the whole security story.
 */

const URL = '/api/v1/maintenance:run-daily'

/** `YYYY-MM-DD`, N days from now, in UTC — the same convention the scan compares against. */
function isoDaysFromNow(days: number): string {
  const date = new Date()
  date.setUTCDate(date.getUTCDate() + days)
  return date.toISOString().slice(0, 10)
}

describe('the constant-time secret comparison', () => {
  // Unit tests, no database and no app: this function is the security boundary, and it is worth
  // testing directly rather than only through a route that could stop calling it.
  it('accepts an exact match', () => {
    expect(secretsMatch('a'.repeat(32), 'a'.repeat(32))).toBe(true)
  })

  it('rejects a wrong secret of the same length', () => {
    expect(secretsMatch(`${'a'.repeat(31)}b`, 'a'.repeat(32))).toBe(false)
  })

  it('rejects a correct PREFIX rather than accepting it', () => {
    // The failure mode a naive `startsWith` or a truncating compare would have.
    expect(secretsMatch('a'.repeat(16), 'a'.repeat(32))).toBe(false)
  })

  it('does not throw on a length mismatch, in either direction', () => {
    // `timingSafeEqual` throws on unequal buffer lengths, which is why both sides are hashed first.
    // Without that, a one-character header would 500 instead of 401.
    expect(() => secretsMatch('x', 'a'.repeat(32))).not.toThrow()
    expect(() => secretsMatch('x'.repeat(500), 'a'.repeat(32))).not.toThrow()
    expect(secretsMatch('', 'a'.repeat(32))).toBe(false)
  })
})

describeDb('POST /api/v1/maintenance::run-daily', () => {
  let app: FastifyInstance
  withCleanDatabase()

  beforeAll(async () => {
    app = await buildApp({ startJobs: false })
    await app.ready()
  })

  afterAll(async () => {
    await app.close()
  })

  /**
   * `CRON_SECRET` is not set in the test environment, and that is deliberately left alone: `env.ts`
   * snapshots `process.env` at import time, so making it configured for some tests and not others
   * would mean module-registry surgery. Instead the unconfigured path is asserted here as the real
   * behaviour it is, and the configured path is asserted by calling the service directly below.
   */
  it('answers 503, not 401, when CRON_SECRET is unset — an unconfigured trigger is CLOSED', async () => {
    expect(env.CRON_SECRET).toBeUndefined()

    const res = await app.inject({ method: 'POST', url: URL })

    expect(res.statusCode).toBe(503)
    expect(res.headers['content-type']).toContain('application/problem+json')
    expect(res.json().type).toBe('https://life-manager.app/problems/not-configured')
  })

  it('still answers 503 when a key IS supplied — a wrong key cannot configure the endpoint', async () => {
    const res = await app.inject({
      method: 'POST',
      url: URL,
      headers: { 'x-cron-key': 'a'.repeat(32) },
    })

    // The order in `authorizeMaintenanceRequest` matters: not-configured is checked first, so this
    // deployment reports its own misconfiguration rather than blaming the caller's credential.
    expect(res.statusCode).toBe(503)
  })

  it('requires no session — it is 503/401, never a redirect or a 404', async () => {
    const res = await app.inject({ method: 'POST', url: URL })

    // If `config.public` were missing, the actor hook would answer 401 for the wrong reason. If the
    // `::` escape were wrong, this would 404. Both are silent failures in opposite directions.
    expect([401, 503]).toContain(res.statusCode)
  })

  it('404s on a suffix, which is what proves the `::` escape is right', async () => {
    // Without `::`, Fastify registers `maintenance` plus a parameter — and ANY suffix matches.
    const res = await app.inject({ method: 'POST', url: '/api/v1/maintenance:run-dailyGARBAGE' })

    expect(res.statusCode).toBe(404)
  })

  it('generates the single-colon path in the OpenAPI document', async () => {
    // conventions/api.md §3 calls the OpenAPI document the contract, and the `::` escape has been
    // seen generating a mangled path. Asserted because it fails silently.
    const res = await app.inject({ method: 'GET', url: '/api/v1/openapi.json' })
    const paths = Object.keys(res.json().paths)

    expect(paths).toContain('/api/v1/maintenance:run-daily')
    expect(paths.some((path) => path.includes('::'))).toBe(false)
    expect(paths.some((path) => path.includes('{run'))).toBe(false)
  })
})

describeDb('the daily maintenance run', () => {
  let app: FastifyInstance
  withCleanDatabase()

  beforeAll(async () => {
    app = await buildApp({ startJobs: false })
    await app.ready()
  })

  afterAll(async () => {
    await app.close()
  })

  /**
   * The service is called directly rather than through the route, because the route's door needs
   * `CRON_SECRET` and the run itself does not. What is being tested is the WORK, and going through
   * `inject` would only add an authorisation concern already covered above.
   */
  it('finds a due reminder, reports it undelivered with no subscription, and leaves sent_at null', async () => {
    const { runDailyMaintenance } = await import('./maintenance.service.js')
    const user = await seedUserWithSpace(app)
    const document = await createDocument(app, user)

    const created = await app.inject({
      method: 'POST',
      url: `/api/v1/documents/${document.id}/reminders`,
      ...authAs(user),
      // Due today with a zero lead → inside the window now.
      payload: { due_on: isoDaysFromNow(0), lead_days: 0 },
    })
    expect(created.statusCode).toBe(201)

    const result = await runDailyMaintenance()

    expect(result.status).toBe('ran')
    expect(result.today).toBe(new Date().toISOString().slice(0, 10))
    // A NON-ZERO count. Debt D33 was `file_count` being 0 for all of M1 because every test happened
    // to expect 0, so an assertion that the scan found something is the point of this test.
    expect(result.found).toBe(1)
    // No push subscription exists in this space, so nothing could be delivered — and that must be
    // reported as pending rather than as success.
    expect(result.delivered).toBe(0)
    expect(result.undelivered).toBe(1)
    expect(result.errored).toBe(0)

    // `sent_at` stays null, which is what makes tomorrow's run retry it. If this ever flips to
    // non-null on a failed delivery, the notification is lost silently and forever.
    const stillDue = await remindersRepository.listDueForMaintenance(isoDaysFromNow(0))
    expect(stillDue).toHaveLength(1)
  })

  it('reports zeroes rather than failing when nothing is due', async () => {
    const { runDailyMaintenance } = await import('./maintenance.service.js')
    await seedUserWithSpace(app)

    const result = await runDailyMaintenance()

    expect(result.status).toBe('ran')
    expect(result.found).toBe(0)
    expect(result.errored).toBe(0)
  })

  it('ignores a reminder whose lead window has not opened', async () => {
    const { runDailyMaintenance } = await import('./maintenance.service.js')
    const user = await seedUserWithSpace(app)
    const document = await createDocument(app, user)

    await app.inject({
      method: 'POST',
      url: `/api/v1/documents/${document.id}/reminders`,
      ...authAs(user),
      payload: { due_on: isoDaysFromNow(100), lead_days: 7 },
    })

    const result = await runDailyMaintenance()

    expect(result.found).toBe(0)
  })

  it('returns a body matching the shared schema', async () => {
    const { runDailyMaintenance } = await import('./maintenance.service.js')

    const parsed = maintenanceRunResponseSchema.safeParse(await runDailyMaintenance())

    expect(parsed.success, JSON.stringify(parsed.error?.issues)).toBe(true)
  })

  it('declines a run while another holds the lock, rather than double-sending', async () => {
    const { runDailyMaintenance, MAINTENANCE_LOCK_KEY } = await import('./maintenance.service.js')
    const user = await seedUserWithSpace(app)
    const document = await createDocument(app, user)
    await app.inject({
      method: 'POST',
      url: `/api/v1/documents/${document.id}/reminders`,
      ...authAs(user),
      payload: { due_on: isoDaysFromNow(0), lead_days: 0 },
    })

    /**
     * The lock is taken HERE, on its own connection, rather than by racing two runs against each
     * other.
     *
     * An earlier version did `Promise.all([runDailyMaintenance(), runDailyMaintenance()])` and
     * asserted one of each status. That passes most of the time and fails perhaps one run in ten:
     * whichever call connects first can finish its whole scan — which is fast, on one reminder with
     * no subscriptions — and release the lock before the second one asks for it, at which point both
     * legitimately return 'ran'. conventions/testing.md §5 requires tests that pass in any order and
     * in parallel, and a race is neither.
     *
     * `pg_advisory_lock` blocks rather than trying, so by the time it returns the lock is definitely
     * held and the assertion below is about behaviour rather than timing.
     */
    const holder = new Client({ connectionString: env.DATABASE_URL_UNPOOLED })
    await holder.connect()
    try {
      await holder.query('select pg_advisory_lock($1)', [MAINTENANCE_LOCK_KEY])

      const result = await runDailyMaintenance()

      expect(result.status).toBe('skipped_locked')
      // The declined run reports no work, so a caller summing counts cannot double-count.
      expect(result.found).toBe(0)
      expect(result.swept).toBe(0)
    } finally {
      await holder.query('select pg_advisory_unlock($1)', [MAINTENANCE_LOCK_KEY])
      await holder.end()
    }

    // And with the lock free again, the same run does the work — proving the skip was the lock's doing
    // and not a scan that had nothing to find.
    const afterRelease = await runDailyMaintenance()
    expect(afterRelease.status).toBe('ran')
    expect(afterRelease.found).toBe(1)
  })
})

describeDb('the trigger accepts a POST with no body', () => {
  let app: FastifyInstance
  withCleanDatabase()

  beforeAll(async () => {
    app = await buildApp({ startJobs: false })
    await app.ready()
  })

  afterAll(async () => {
    await app.close()
  })

  /**
   * **Cloud Scheduler sends a POST with no body**, and so does any hand-rolled `curl -X POST` or
   * PowerShell `Invoke-RestMethod -Method Post`. Fastify answers 415 for a content type it has no
   * parser for, and it does that in the content-type parser — BEFORE any schema or handler runs, so
   * neither the Zod schema nor the auth check can influence it.
   *
   * The assertion is "not 415" rather than a specific code, because `CRON_SECRET` is unset in tests so
   * the correct answer here is 503. What matters is that the request reaches the handler at all.
   */
  const bodylessPost = (headers: Record<string, string>) =>
    app.inject({ method: 'POST', url: URL, headers })

  it('with no content-type at all', async () => {
    const res = await bodylessPost({})
    expect(res.statusCode).not.toBe(415)
  })

  it('with application/x-www-form-urlencoded — what PowerShell sends by default', async () => {
    const res = await bodylessPost({ 'content-type': 'application/x-www-form-urlencoded' })
    expect(res.statusCode).not.toBe(415)
  })

  it('with application/octet-stream — what Cloud Scheduler sends', async () => {
    const res = await bodylessPost({ 'content-type': 'application/octet-stream' })
    expect(res.statusCode).not.toBe(415)
  })

  it('with application/json and no body', async () => {
    const res = await bodylessPost({ 'content-type': 'application/json' })
    expect(res.statusCode).not.toBe(415)
  })
})
