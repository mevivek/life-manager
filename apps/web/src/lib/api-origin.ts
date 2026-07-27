/**
 * The single definition of "where is the API".
 *
 * `VITE_API_URL` is empty in local development, where the Vite dev proxy forwards `/api` to the
 * API and everything is same-origin. In production it is `https://api.mevivek.dev`, a different
 * origin but the same *site* as the app — which is what keeps the `SameSite=Lax` session cookie
 * working (ADR-0019).
 *
 * It resolves to an ABSOLUTE origin rather than an empty string, because Better Auth's client
 * throws `Invalid base URL` on a relative path — in the browser, not just in tests. Falling back
 * to `window.location.origin` gives the same same-origin behaviour with a URL that parses.
 */
function resolveApiOrigin(): string {
  const configured = import.meta.env.VITE_API_URL
  if (configured !== undefined && configured !== '') return configured.replace(/\/$/, '')

  if (typeof window === 'undefined') {
    throw new Error('VITE_API_URL must be set when there is no window to infer the origin from')
  }
  return window.location.origin
}

export const API_ORIGIN = resolveApiOrigin()

/** Better Auth's `baseURL` must include the path that matches the server's `basePath`. */
export const AUTH_BASE_URL = `${API_ORIGIN}/api/v1/auth`
