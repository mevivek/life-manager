import { healthResponseSchema } from '@life-manager/shared'
import type { FastifyInstance } from 'fastify'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { buildApp } from '../../app.js'

/**
 * No database is involved here on purpose — see health.routes.ts. This suite therefore runs
 * on a machine with neither Docker nor a TEST_DATABASE_URL, which makes it the smoke test
 * that proves the Fastify + Zod + OpenAPI + problem+json wiring is intact.
 */
describe('GET /api/v1/health', () => {
  let app: FastifyInstance

  beforeAll(async () => {
    app = await buildApp({ startJobs: false })
    await app.ready()
  })

  afterAll(async () => {
    await app.close()
  })

  it('is public: 200 with no session at all', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/v1/health' })

    expect(res.statusCode).toBe(200)
  })

  it('returns a body matching the shared response schema', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/v1/health' })

    const parsed = healthResponseSchema.safeParse(res.json())
    expect(parsed.success, JSON.stringify(parsed.error?.issues)).toBe(true)
  })

  it('appears in the generated OpenAPI document, as OpenAPI 3.1', async () => {
    // agent-playbooks/add-an-endpoint.md §7 makes "appears correctly in the generated
    // OpenAPI spec" a checklist item. Asserting it here means every later endpoint inherits
    // a working generator rather than each author checking by hand.
    const res = await app.inject({ method: 'GET', url: '/api/v1/openapi.json' })

    expect(res.statusCode).toBe(200)
    const doc = res.json()
    expect(doc.openapi).toBe('3.1.0')
    expect(doc.paths['/api/v1/health']).toBeDefined()
    expect(doc.paths['/api/v1/health'].get.responses['200']).toBeDefined()
  })

  it('describes the 200 response with the real fields, not a bare object', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/v1/openapi.json' })

    const schema =
      res.json().paths['/api/v1/health'].get.responses['200'].content['application/json'].schema
    expect(Object.keys(schema.properties).sort()).toEqual(['status', 'uptime_seconds', 'version'])
  })
})

describe('error rendering', () => {
  let app: FastifyInstance

  beforeAll(async () => {
    app = await buildApp({ startJobs: false })
    await app.ready()
  })

  afterAll(async () => {
    await app.close()
  })

  it('renders an unmatched route as RFC 9457 problem+json, not Fastify default JSON', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/v1/definitely-not-a-route' })

    expect(res.statusCode).toBe(404)
    expect(res.headers['content-type']).toContain('application/problem+json')
    expect(res.json()).toMatchObject({
      type: 'https://life-manager.app/problems/not-found',
      status: 404,
    })
  })
})
