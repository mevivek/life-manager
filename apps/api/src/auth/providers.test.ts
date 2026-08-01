import type { FastifyInstance } from 'fastify'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { buildApp } from '../app.js'
import { isGoogleConfigured } from './auth.js'

/**
 * `GET /api/v1/auth/providers` — ADR-0035.
 *
 * Plain `describe`, not `describeDb`: the route reads no table, and a database-gated suite would skip
 * on a machine without Postgres — which is precisely the machine where "does the anti-lockout endpoint
 * still answer?" is worth knowing.
 *
 * The suite env sets no `GOOGLE_*` pair (`vitest.config.ts`), so this file exercises the
 * **unconfigured** deployment: the one the fallback exists for.
 */
describe('GET /api/v1/auth/providers', () => {
  let app: FastifyInstance

  beforeAll(async () => {
    app = await buildApp({ startJobs: false })
    await app.ready()
  })

  afterAll(async () => {
    await app.close()
  })

  it('answers with no session at all', async () => {
    // The reason the endpoint exists: it is read *before* anyone can have one. If this ever starts
    // needing a session the sign-in screen can never resolve its capability, and it renders a
    // skeleton forever.
    const res = await app.inject({ method: 'GET', url: '/api/v1/auth/providers' })

    expect(res.statusCode).toBe(200)
    expect(res.json()).toEqual({ google: false, password: true })
  })

  it('reports google as false when the credentials are absent', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/v1/auth/providers' })

    expect(res.json().google).toBe(false)
  })

  it('reports exactly what auth.ts registered, never a second opinion', async () => {
    // The one assertion that would catch the failure ADR-0035 is about: an endpoint claiming a
    // capability the auth instance lacks. Both sides read `isGoogleConfigured`, so this compares the
    // wire against the constant `socialProviders` is built from rather than against a literal.
    const res = await app.inject({ method: 'GET', url: '/api/v1/auth/providers' })

    expect(res.json().google).toBe(isGoogleConfigured)
  })

  it('keeps password true — the server side of email+password is not removed', async () => {
    // ADR-0035 is explicit: the screens stop offering it, the server does not stop accepting it,
    // because it is the recovery path for a lost Google account.
    const res = await app.inject({ method: 'GET', url: '/api/v1/auth/providers' })

    expect(res.json().password).toBe(true)
  })

  it('is not swallowed by the Better Auth catch-all', async () => {
    // `/api/v1/auth/*` is registered in the same plugin. If find-my-way ever preferred the wildcard,
    // this path would reach Better Auth, which has no such endpoint — a 404, not our JSON.
    const res = await app.inject({ method: 'GET', url: '/api/v1/auth/providers' })

    expect(res.headers['content-type']).toContain('application/json')
    expect(Object.keys(res.json()).sort()).toEqual(['google', 'password'])
  })
})
