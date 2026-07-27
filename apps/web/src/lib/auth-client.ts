import { createAuthClient } from 'better-auth/react'
import { AUTH_BASE_URL } from './api-origin'

/**
 * Better Auth's browser client. Same major version as the API's `better-auth` dependency, on
 * purpose — a client/server mismatch here fails silently rather than loudly.
 *
 * `baseURL` must be an ABSOLUTE url including the `/api/v1/auth` path that matches `basePath` on
 * the server. A relative path throws `Invalid base URL` — see lib/api-origin.ts.
 */
export const authClient = createAuthClient({
  baseURL: AUTH_BASE_URL,
  fetchOptions: {
    // The session cookie is httpOnly; without credentials it is neither sent nor stored.
    credentials: 'include',
  },
})

export const { signIn, signUp, signOut, useSession } = authClient
