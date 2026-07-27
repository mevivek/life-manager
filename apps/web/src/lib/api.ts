import {
  type HealthResponse,
  healthResponseSchema,
  type MeResponse,
  meResponseSchema,
  type Problem,
  problemSchema,
} from '@life-manager/shared'
import { API_ORIGIN } from './api-origin'

/**
 * THE typed API client. conventions/code.md §9: "All API calls go through one typed client in
 * lib/api. No bare `fetch` in a component." Greppable enforcement:
 *
 *     rg '\bfetch\(' apps/web/src   # expect: only this file
 *
 * Responses are parsed with the SAME Zod schemas the server serialises with (ADR-0004), so a
 * contract drift shows up here as a thrown error rather than as `undefined` three components
 * deep.
 */

/** A parsed RFC 9457 problem, or a synthetic one for a response that was not problem+json. */
export class ApiError extends Error {
  readonly status: number
  readonly problem: Problem

  constructor(problem: Problem) {
    super(problem.detail)
    this.name = 'ApiError'
    this.status = problem.status
    this.problem = problem
  }

  /** True when the user simply is not signed in — routes use this to redirect rather than shout. */
  get isUnauthenticated(): boolean {
    return this.status === 401
  }
}

async function request<T>(path: string, schema: { parse: (value: unknown) => T }): Promise<T> {
  const response = await fetch(`${API_ORIGIN}${path}`, {
    /**
     * Non-negotiable. The session is an httpOnly cookie (security-model.md §2), so without
     * this the browser sends no credentials and every authenticated call is a silent 401.
     */
    credentials: 'include',
    headers: { accept: 'application/json' },
  })

  if (!response.ok) throw await toApiError(response)

  return schema.parse(await response.json())
}

async function toApiError(response: Response): Promise<ApiError> {
  try {
    const parsed = problemSchema.safeParse(await response.json())
    if (parsed.success) return new ApiError(parsed.data)
  } catch {
    // Body was not JSON at all — fall through to the synthetic problem below. Deliberately
    // swallowed: we are already on the error path and the status is what matters.
  }

  return new ApiError({
    type: 'about:blank',
    title: 'Request failed',
    status: response.status,
    detail: `The server responded with ${response.status}.`,
  })
}

export const api = {
  health: (): Promise<HealthResponse> => request('/api/v1/health', healthResponseSchema),
  me: (): Promise<MeResponse> => request('/api/v1/me', meResponseSchema),
}
