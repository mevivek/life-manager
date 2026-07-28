import { z } from 'zod'
import { isoDateSchema, uuidSchema } from './common.js'
import { reminderChannelSchema, reminderSchema } from './documents.js'

/**
 * Reminders are **generic on purpose** — keyed by `entity_type` + `entity_id` rather than owned
 * by Documents, so Assets and Money (M4) reuse this table instead of each inventing their own
 * (domains/documents.md §3).
 *
 * `reminderSchema` itself lives in `documents.ts` because that is where the only current
 * `entity_type` is defined and re-exporting it from two places would be worse. When the second
 * entity type arrives, move `reminderSchema` here and widen `entity_type` from a literal to an
 * enum — that is the one edit this split costs, and it is cheaper than a circular import today.
 */

export type { Reminder, ReminderChannel } from './documents.js'
export { reminderChannelSchema, reminderSchema }

/**
 * `POST /api/v1/documents/:id/reminders`.
 *
 * `due_on` is required rather than defaulted from `documents.expires_on`: a reminder whose date
 * silently tracked another column would surprise anyone who set it deliberately. The *automatic*
 * reminders (business rule 8) are created by the service, which does read `expires_on`.
 */
export const reminderCreateSchema = z.strictObject({
  due_on: isoDateSchema,
  /** Fires at `due_on - lead_days`. Several rows on one entity = several lead times (§3). */
  lead_days: z.number().int().min(0).max(3650).default(0),
  /**
   * `web_push` is the only channel with a delivery path at M1. The others are in the enum
   * because the column stores them and the scan job dispatches on them — a narrower enum here
   * would have to widen later for no benefit. An unimplemented channel is rejected by the
   * service, not by this schema, so the error says *why*.
   */
  channel: reminderChannelSchema.default('web_push'),
})
export type ReminderCreate = z.infer<typeof reminderCreateSchema>

export const reminderListResponseSchema = z.object({
  data: z.array(reminderSchema),
})
export type ReminderListResponse = z.infer<typeof reminderListResponseSchema>

export const reminderIdParamsSchema = z.object({ id: uuidSchema })

// ── Web Push subscription ────────────────────────────────────────────────────

/**
 * The browser's `PushSubscription`, as `PushSubscription.toJSON()` produces it. The field names
 * are the Push API's, **not** ours, which is why they are camelCase in an otherwise snake_case
 * contract (the same exemption `auth.ts` takes for Better Auth's shapes).
 */
export const pushSubscriptionSchema = z.strictObject({
  endpoint: z.url().max(2000),
  keys: z.strictObject({
    p256dh: z.string().min(1).max(200),
    auth: z.string().min(1).max(200),
  }),
})
export type PushSubscription = z.infer<typeof pushSubscriptionSchema>

export const pushSubscribeResponseSchema = z.object({
  id: uuidSchema,
})

/**
 * `GET /api/v1/push/public-key` — the VAPID public key the browser needs to subscribe.
 *
 * Public by design: it is the *public* half of the VAPID pair, it must reach an unauthenticated
 * service worker registration, and it identifies the sender rather than authorising anything.
 * The private half never leaves the API. security-model.md §5.
 */
export const pushPublicKeyResponseSchema = z.object({
  /** `null` when push is not configured, so the client can hide the UI rather than guess. */
  public_key: z.string().nullable(),
})
