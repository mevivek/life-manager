import { healthResponseSchema } from '@life-manager/shared'
import Fastify, { type FastifyInstance } from 'fastify'
import { serializerCompiler, validatorCompiler } from 'fastify-type-provider-zod'
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import { buildApp } from '../../app.js'
import { env } from '../../env.js'

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
    // `built_at` joined the set with the build card (BuildCard.tsx). Widening this assertion is the
    // point of having it: an EXACT key set means a field added to the contract cannot reach the wire
    // without someone stating that it is intended, here.
    expect(Object.keys(schema.properties).sort()).toEqual([
      'built_at',
      'status',
      'uptime_seconds',
      'version',
    ])
  })

  it('reports a version and a non-zero-length one — the client compares it to its own', async () => {
    const body = await app.inject({ method: 'GET', url: '/api/v1/health' }).then((r) => r.json())

    // `vitest.config.ts` sets APP_VERSION to this. Asserted as a real value rather than "is a
    // string": the whole feature is a comparison, and an empty version compares equal to nothing
    // useful. design.md §10 — assert a real value, never a vacuous one.
    expect(body.version).toBe('0.0.0-test')
    // And NOT sha-shaped, which the client relies on: `isCommit` in BuildCard.tsx is what stops a
    // placeholder version drawing a "different builds" warning in local development.
    expect(body.version).not.toMatch(/^[0-9a-f]{7,40}$/i)
    expect(body.uptime_seconds).toBeGreaterThanOrEqual(0)
  })
})

/**
 * `built_at` — the deploy time, and the honest absence of one.
 *
 * `env.ts` snapshots `process.env` at import time, which is why `maintenance.test.ts` asserts its
 * unconfigured path against the real environment rather than reconfiguring it. Same constraint here,
 * but the configured path matters enough to earn the module-registry surgery: `vi.resetModules()`
 * plus a fresh dynamic import of the route module is what lets the SET case run the real handler and
 * the real Zod response serialisation. The route is registered on a bare Fastify with only the two
 * compilers — it touches no database, no session and no plugin.
 */
describe('GET /api/v1/health — built_at', () => {
  afterEach(() => {
    vi.unstubAllEnvs()
    vi.resetModules()
  })

  async function healthBodyWith(buildTime: string | undefined): Promise<Record<string, unknown>> {
    // '' rather than a delete: `withoutEmptyValues` in env.ts treats empty as absent, which is the
    // same thing a `.env` file with a bare `BUILD_TIME=` produces.
    vi.stubEnv('BUILD_TIME', buildTime ?? '')
    vi.resetModules()
    const { healthRoutes: fresh } = await import('./health.routes.js')

    const bare = Fastify()
    bare.setValidatorCompiler(validatorCompiler)
    bare.setSerializerCompiler(serializerCompiler)
    await bare.register(fresh)
    try {
      const res = await bare.inject({ method: 'GET', url: '/api/v1/health' })
      expect(res.statusCode).toBe(200)
      return res.json()
    } finally {
      await bare.close()
    }
  }

  it('is null when BUILD_TIME is unset — a build with no stamp says so, it does not guess', async () => {
    expect(env.BUILD_TIME).toBeUndefined()

    const body = await healthBodyWith(undefined)

    // Present and null, not absent: one representation of "not known" (see healthResponseSchema).
    expect(body).toHaveProperty('built_at')
    expect(body.built_at).toBeNull()
    // What this really guards is the plausible substitute. A time derived from `uptime_seconds`
    // would parse, serialise, and read as a deploy time while being the last cold start.
    expect(body.uptime_seconds).toBeGreaterThanOrEqual(0)
  })

  it('echoes BUILD_TIME verbatim when set', async () => {
    const body = await healthBodyWith('2026-07-30T08:15:00Z')

    expect(body.built_at).toBe('2026-07-30T08:15:00Z')
    expect(body.status).toBe('ok')
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
