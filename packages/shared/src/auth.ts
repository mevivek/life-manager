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
