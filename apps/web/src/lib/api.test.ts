import { HttpResponse, http } from 'msw'
import { describe, expect, it } from 'vitest'
import { server } from '@/test/msw'
import { ApiError, api } from './api'

describe('api client', () => {
  it('parses a response through the shared Zod schema', async () => {
    const result = await api.me()

    expect(result.spaces).toHaveLength(1)
    expect(result.spaces[0]?.kind).toBe('personal')
  })

  it('throws rather than returning a partial object when the contract drifts', async () => {
    // The failure this catches: an API that quietly stops sending a field, which without schema
    // parsing shows up as `undefined` three components away from the cause.
    server.use(
      http.get('*/api/v1/me', () => HttpResponse.json({ user_id: 'not-a-uuid', email: 'x' })),
    )

    await expect(api.me()).rejects.toThrow()
  })

  it('turns problem+json into an ApiError carrying the status', async () => {
    server.use(
      http.get('*/api/v1/me', () =>
        HttpResponse.json(
          {
            type: 'https://life-manager.app/problems/unauthorized',
            title: 'Authentication required',
            status: 401,
            detail: 'Authentication required.',
          },
          { status: 401, headers: { 'content-type': 'application/problem+json' } },
        ),
      ),
    )

    const error = await api.me().catch((caught: unknown) => caught)

    expect(error).toBeInstanceOf(ApiError)
    expect((error as ApiError).isUnauthenticated).toBe(true)
  })

  it('still produces an ApiError when the body is not problem+json at all', async () => {
    // A proxy or Cloudflare error page will do exactly this. It must not become a parse crash.
    server.use(http.get('*/api/v1/me', () => new HttpResponse('<html>502</html>', { status: 502 })))

    const error = await api.me().catch((caught: unknown) => caught)

    expect(error).toBeInstanceOf(ApiError)
    expect((error as ApiError).status).toBe(502)
  })
})
