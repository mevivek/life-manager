import { z } from 'zod'

/**
 * Sign-up / sign-in form shapes.
 *
 * These are for CLIENT-SIDE FORM VALIDATION ONLY (conventions/code.md §9). Better Auth owns
 * the actual endpoints and re-validates everything server-side; duplicating the rules here
 * buys a better form experience and nothing else. A rule that exists only here does not
 * exist — see CLAUDE.md invariant 5.
 *
 * The field names are `email` / `password` / `name` rather than snake_case because they are
 * Better Auth's request shape, not ours. conventions/api.md §8 governs endpoints we write.
 */

export const MIN_PASSWORD_LENGTH = 12

export const passwordSchema = z
  .string()
  .min(MIN_PASSWORD_LENGTH, `Use at least ${MIN_PASSWORD_LENGTH} characters`)
  .max(128)

export const signUpSchema = z.object({
  name: z.string().min(1, 'Required').max(120),
  email: z.email('Enter a valid email address'),
  password: passwordSchema,
})
export type SignUpInput = z.infer<typeof signUpSchema>

export const signInSchema = z.object({
  email: z.email('Enter a valid email address'),
  // Deliberately NOT `passwordSchema`: applying the length rule on sign-in would tell an
  // existing user with an older, shorter password that their own password is invalid.
  password: z.string().min(1, 'Required'),
})
export type SignInInput = z.infer<typeof signInSchema>

// ── What this deployment can actually do ─────────────────────────────────────

/**
 * `GET /api/v1/auth/providers` — **unauthenticated by necessity**, because it is read before anyone
 * has a session. [ADR-0035](../../../docs/decisions/0035-google-only-sign-in.md).
 *
 * The sign-in screen is Google-only (handoff 5). Whether that screen can *work* depends on two
 * environment variables the client cannot see: `auth.ts` registers `socialProviders` as an **empty
 * object** when either is missing, so a build that deleted the password form unconditionally would
 * ship a screen whose only control is dead, with no way back in but a redeploy.
 *
 * So the server says. Both booleans are derived from the same `env` check that decides whether the
 * provider is registered at all — **one source of truth**, so this cannot claim a capability the auth
 * instance does not have.
 *
 * No secrets and no new information: whether a site offers Google sign-in is visible by looking at its
 * sign-in page.
 */
export const authProvidersResponseSchema = z.object({
  /** Google OAuth is configured and registered. When false, the screens fall back to the form. */
  google: z.boolean(),
  /**
   * Email + password is accepted. Stays `true` — ADR-0035 removes it from the *screens*, not from the
   * server, because it is the recovery path if a Google account is ever lost.
   */
  password: z.boolean(),
})
export type AuthProvidersResponse = z.infer<typeof authProvidersResponseSchema>
