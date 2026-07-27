import { meResponseSchema } from '@life-manager/shared'
import type { FastifyInstance } from 'fastify'
import { afterAll, beforeAll, expect, it } from 'vitest'
import { buildApp } from '../../app.js'
import { describeDb, withCleanDatabase } from '../../test/db.js'
import { authAs, seedUserWithSpace } from '../../test/factories.js'

describeDb('GET /api/v1/me', () => {
  let app: FastifyInstance
  withCleanDatabase()

  beforeAll(async () => {
    app = await buildApp({ startJobs: false })
    await app.ready()
  })

  afterAll(async () => {
    await app.close()
  })

  it('is 401 problem+json with no session — authentication is the default', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/v1/me' })

    expect(res.statusCode).toBe(401)
    expect(res.headers['content-type']).toContain('application/problem+json')
    expect(res.json().type).toBe('https://life-manager.app/problems/unauthorized')
  })

  it('is 401 for a syntactically valid but forged session cookie', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/v1/me',
      headers: { cookie: 'better-auth.session_token=not-a-real-token.not-a-real-signature' },
    })

    expect(res.statusCode).toBe(401)
  })

  it('returns a body matching the shared schema, with snake_case field names', async () => {
    const alice = await seedUserWithSpace(app, { name: 'Alice' })

    const res = await app.inject({ method: 'GET', url: '/api/v1/me', ...authAs(alice) })

    const parsed = meResponseSchema.safeParse(res.json())
    expect(parsed.success, JSON.stringify(parsed.error?.issues)).toBe(true)
    expect(Object.keys(res.json()).sort()).toEqual(['email', 'spaces', 'user_id'])
  })

  it('shows the actor their own email and no one else', async () => {
    const alice = await seedUserWithSpace(app)
    const bob = await seedUserWithSpace(app)

    const res = await app.inject({ method: 'GET', url: '/api/v1/me', ...authAs(alice) })

    expect(res.json().email).toBe(alice.email)
    expect(res.json().email).not.toBe(bob.email)
    expect(res.json().user_id).toBe(alice.userId)
  })

  it('appears in the OpenAPI document as requiring a session', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/v1/openapi.json' })

    const doc = res.json()
    expect(doc.paths['/api/v1/me']).toBeDefined()
    // /health opts out with `security: []`; /me does not, so it inherits the document default.
    expect(doc.paths['/api/v1/health'].get.security).toEqual([])
    expect(doc.paths['/api/v1/me'].get.security).toBeUndefined()
  })
})
