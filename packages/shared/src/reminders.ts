import { z } from 'zod'
import { isoDateSchema, uuidSchema } from './common.js'
import { reminderChannelSchema, reminderEntityTypeSchema, reminderSchema } from './documents.js'

/**
 * Reminders are **generic on purpose** — keyed by `entity_type` + `entity_id` rather than owned
 * by Documents, so Assets and Money (M4) reuse this table instead of each inventing their own
 * (domains/documents.md §3).
 *
 * `reminderSchema` itself lives in `documents.ts` because that is where the `entity_type` enum and
 * the channel enum are defined and re-exporting them from two places would be worse.
 *
 * ── The second entity type has arrived, and the predicted edit was made ──
 *
 * This note used to say: *"when the second entity type arrives, move `reminderSchema` here and widen
 * `entity_type` from a literal to an enum — that is the one edit this split costs."* ADR-0029's
 * Things API is that arrival. **Half of it was done:** `entity_type` is now
 * `reminderEntityTypeSchema` (`document | thing`), which is what a thing's detail response needs to
 * validate at all.
 *
 * The **move** was deliberately not done. `documentDetailResponseSchema` nests `reminderSchema`, so
 * moving it here would make `documents.ts` import `reminders.ts` while `reminders.ts` imports
 * `reminderChannelSchema` from `documents.ts` — the circular import the original note was avoiding,
 * now real rather than hypothetical. `things.ts` imports it from `documents.ts` for the same reason.
 * Moving it needs the channel enum moved too, which is a bigger, separate change.
 */

export type { Reminder, ReminderChannel, ReminderEntityType } from './documents.js'
export { reminderChannelSchema, reminderEntityTypeSchema, reminderSchema }

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
