import { z } from 'zod'
import { isoDateTimeSchema, spaceRoleSchema, uuidSchema } from './common.js'

/**
 * ADR-0006. A `personal` space is not special-cased anywhere: it is a space with one
 * member. That is the whole reason family sharing (M3) is additive rather than a rewrite.
 */
export const spaceKindSchema = z.enum(['personal', 'shared'])
export type SpaceKind = z.infer<typeof spaceKindSchema>

export const spaceSchema = z.object({
  id: uuidSchema,
  name: z.string().min(1).max(120),
  kind: spaceKindSchema,
  created_at: isoDateTimeSchema,
})
export type Space = z.infer<typeof spaceSchema>

/** One row of `space_members`, flattened with the space it points at. */
export const spaceMembershipSchema = z.object({
  space_id: uuidSchema,
  name: z.string().min(1).max(120),
  kind: spaceKindSchema,
  role: spaceRoleSchema,
  joined_at: isoDateTimeSchema,
})
export type SpaceMembership = z.infer<typeof spaceMembershipSchema>
