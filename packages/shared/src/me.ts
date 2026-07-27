import { z } from 'zod'
import { uuidSchema } from './common.js'
import { spaceMembershipSchema } from './spaces.js'

/**
 * `GET /api/v1/me` — the M0 acceptance contract.
 *
 * roadmap.md M0 is "done when you can sign up on your phone, and the API proves the session
 * resolves to an ActorContext with exactly one space." This response IS that proof: `spaces`
 * is rendered straight from `ActorContext`, which is built from a live `space_members`
 * query on every request.
 */
export const meResponseSchema = z.object({
  user_id: uuidSchema,
  email: z.string(),
  spaces: z.array(spaceMembershipSchema),
})
export type MeResponse = z.infer<typeof meResponseSchema>
