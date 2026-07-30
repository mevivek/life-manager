import { HttpResponse, http } from 'msw'
import { setupServer } from 'msw/node'

/**
 * conventions/testing.md §5: "No network calls." MSW intercepts at the network layer, so the
 * component under test runs its REAL `lib/api` client and its real fetch call — only the wire is
 * faked. Mocking the client module instead would test the mock.
 *
 * These handlers mirror the shapes in `packages/shared`. If the contract changes and these do
 * not, the Zod parse in `lib/api` fails and the test goes red — which is the point.
 */
export const handlers = [
  /**
   * `built_at` is present and `null` here on purpose — the shape a deployed image without
   * `BUILD_TIME` actually returns, which is the majority of them. Tests that want a real deploy time
   * or a real commit sha override this handler with their own; `BuildCard.test.tsx` does both.
   *
   * `version` is deliberately NOT sha-shaped, matching the API's own `0.0.0-dev` default, so mounting
   * the You screen in an unrelated test cannot make the build-skew warning appear.
   */
  http.get('*/api/v1/health', () =>
    HttpResponse.json({
      status: 'ok',
      version: '0.0.0-test',
      uptime_seconds: 1,
      built_at: null,
    }),
  ),

  http.get('*/api/v1/me', () =>
    HttpResponse.json({
      user_id: '11111111-1111-4111-8111-111111111111',
      email: 'test@example.test',
      spaces: [
        {
          space_id: '22222222-2222-4222-8222-222222222222',
          name: "Test Person's space",
          kind: 'personal',
          role: 'owner',
          joined_at: '2026-07-27T00:00:00.000Z',
        },
      ],
    }),
  ),

  http.post('*/api/v1/auth/sign-in/email', () =>
    HttpResponse.json({
      user: { id: '11111111-1111-4111-8111-111111111111', email: 'test@example.test' },
    }),
  ),

  /**
   * Things — ADR-0029.
   *
   * The real endpoints exist now — M4 step 1 built them (`apps/api/src/domains/things/`), so these
   * handlers stand in for a server that answers, exactly like the document ones. This comment used to
   * say the endpoints did not exist and a Things screen 404'd against the real API; that stopped being
   * true when the server half landed, and a stale "it isn't built yet" note is how a session comes to
   * trust a mock over the contract. Two consequences, both unchanged:
   *
   *  - **They must match `thingListResponseSchema` exactly**, because `lib/api` parses them with the
   *    real Zod schema. A field the contract requires and this handler omits is a red test rather than
   *    a shape two sessions disagree about — which is the whole reason the contract came first
   *    (invariant 9).
   *  - **The default is EMPTY.** A default page of fixtures here would make every unrelated test that
   *    happens to mount the shell assert against invented things. Tests that want rows call
   *    `server.use(...)` with their own, so the fixture lives beside the assertion it serves.
   */
  http.get('*/api/v1/things', () => HttpResponse.json({ data: [], next_cursor: null })),

  http.get('*/api/v1/things/holders', () => HttpResponse.json({ data: [] })),
]

export const server = setupServer(...handlers)
