import {
  problemSchema,
  pushPublicKeyResponseSchema,
  pushSubscribeResponseSchema,
  pushSubscriptionSchema,
  reminderIdParamsSchema,
  reminderSchema,
} from '@life-manager/shared'
import type { FastifyInstance } from 'fastify'
import type { ZodTypeProvider } from 'fastify-type-provider-zod'
import { z } from 'zod'
import { requireActor } from '../../auth/actor.js'
import * as service from './reminders.service.js'

/**
 * Reminder endpoints that are **not** nested under a document. domains/documents.md §5:
 * `DELETE /reminders/:id` and `POST /reminders/:id:dismiss` are addressed by reminder id, because
 * a client holding a reminder (from a push notification) does not necessarily know its document.
 *
 * The document-nested reminder endpoints live in `documents.routes.ts`, next to the resource they
 * hang off.
 *
 * **`dismiss` is a path segment, not the `:dismiss` suffix** conventions/api.md §2 would suggest.
 * A `:verb` immediately after a path parameter generates a broken OpenAPI path — see the block
 * comment in `documents.routes.ts` for the measurement and §2 for the amended rule.
 */

const commonErrors = {
  400: problemSchema,
  401: problemSchema,
  404: problemSchema,
  422: problemSchema,
  429: problemSchema,
} as const

export async function remindersRoutes(app: FastifyInstance): Promise<void> {
  const route = app.withTypeProvider<ZodTypeProvider>()

  route.delete(
    '/api/v1/reminders/:id',
    {
      schema: {
        operationId: 'deleteReminder',
        summary: 'Soft-delete a reminder',
        tags: ['reminders'],
        params: reminderIdParamsSchema,
        response: { 204: z.null(), ...commonErrors, 409: problemSchema },
      },
    },
    async (request, reply) => {
      await service.remove(requireActor(request), request.params.id)
      return reply.status(204).send(null)
    },
  )

  route.post(
    '/api/v1/reminders/:id/dismiss',
    {
      schema: {
        operationId: 'dismissReminder',
        summary: 'Acknowledge a reminder so it stops being surfaced',
        description:
          'Distinct from delete: a dismissed reminder stays as the record that it fired and was ' +
          'seen. Deleting it would erase that. A path segment rather than the `:dismiss` suffix ' +
          'in domains/documents.md §5 — a :verb after a path parameter breaks OpenAPI generation.',
        tags: ['reminders'],
        params: reminderIdParamsSchema,
        response: { 200: reminderSchema, ...commonErrors, 409: problemSchema },
      },
    },
    async (request) => service.dismiss(requireActor(request), request.params.id),
  )

  // ── Web Push registration ──────────────────────────────────────────────────

  route.get(
    '/api/v1/push/public-key',
    {
      schema: {
        operationId: 'getPushPublicKey',
        summary: 'The VAPID public key the browser needs in order to subscribe',
        description:
          'Returns null when push is not configured, so a client can hide the notification UI ' +
          'rather than offer a button that fails.',
        tags: ['reminders'],
        response: { 200: pushPublicKeyResponseSchema, ...commonErrors },
      },
    },
    async () => ({ public_key: service.pushPublicKey() }),
  )

  route.post(
    '/api/v1/push/subscriptions',
    {
      schema: {
        operationId: 'subscribeToPush',
        summary: 'Register this browser to receive reminder notifications',
        description:
          'Idempotent by endpoint: re-subscribing updates the existing row rather than creating ' +
          'a second one, so a notification is never delivered twice to one browser.',
        tags: ['reminders'],
        body: pushSubscriptionSchema,
        response: { 201: pushSubscribeResponseSchema, ...commonErrors, 409: problemSchema },
      },
    },
    async (request, reply) => {
      const result = await service.subscribeToPush(requireActor(request), request.body)
      return reply.status(201).send(result)
    },
  )
}
