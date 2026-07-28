import type { PushSubscription, Reminder, ReminderCreate } from '@life-manager/shared'
import type { ActorContext } from '../../auth/actor.js'
import { vapidConfig } from '../../env.js'
import { NotFoundError, ValidationError } from '../../lib/errors.js'
import * as documentsRepository from '../documents/documents.repository.js'
import type { ReminderRow } from './reminders.repository.js'
import * as repository from './reminders.repository.js'

/**
 * Reminders. domains/documents.md §3 and §5.
 *
 * A separate domain from Documents because the table is polymorphic by design — Assets and Money
 * (M4) will reuse it. Today `entity_type` is always `'document'`, and that is the only reason this
 * service reaches into `documentsRepository` at all: to prove the target exists in the actor's
 * space before attaching a reminder to it.
 */

function toReminder(row: ReminderRow): Reminder {
  return {
    id: row.id,
    entity_type: 'document',
    entity_id: row.entityId,
    due_on: row.dueOn,
    lead_days: row.leadDays,
    channel: row.channel,
    sent_at: row.sentAt === null ? null : row.sentAt.toISOString(),
    dismissed_at: row.dismissedAt === null ? null : row.dismissedAt.toISOString(),
    created_at: row.createdAt.toISOString(),
  }
}

export async function listForDocument(
  actor: ActorContext,
  documentId: string,
): Promise<Reminder[]> {
  // Not merely a convenience: without this the endpoint would answer 200 with `[]` for a document
  // in another space, which distinguishes "exists but not yours" from "does not exist" — exactly
  // the leak invariant 4 forbids. A 404 here makes them identical.
  const document = await documentsRepository.findById(actor, documentId)
  if (document === undefined) throw new NotFoundError('No such document.')

  const rows = await repository.listForEntity(actor, documentId)
  return rows.map(toReminder)
}

export async function createForDocument(
  actor: ActorContext,
  documentId: string,
  input: ReminderCreate,
): Promise<Reminder> {
  const document = await documentsRepository.findById(actor, documentId)
  if (document === undefined) throw new NotFoundError('No such document.')

  /**
   * Only `web_push` has a delivery path at M1 (spec §6). Rejecting the others here rather than in
   * the Zod schema is deliberate: the column stores them and the scan job dispatches on them, so
   * the enum is correct — what is missing is an implementation, and the error should say that
   * rather than "invalid enum value".
   */
  if (input.channel !== 'web_push') {
    throw new ValidationError(
      `The "${input.channel}" channel is not implemented yet. Only web_push delivers at M1.`,
    )
  }

  const spaceId = document.spaceId
  const id = await repository.insert(actor, spaceId, {
    entityId: documentId,
    dueOn: input.due_on,
    leadDays: input.lead_days,
    channel: input.channel,
  })

  const created = await repository.findById(actor, id)
  if (created === undefined) throw new Error('reminder vanished immediately after creation')
  return toReminder(created)
}

export async function remove(actor: ActorContext, id: string): Promise<void> {
  const changed = await repository.softDelete(actor, id)
  if (changed === 0) throw new NotFoundError('No such reminder.')
}

export async function dismiss(actor: ActorContext, id: string): Promise<Reminder> {
  const changed = await repository.dismiss(actor, id)
  if (changed === 0) throw new NotFoundError('No such reminder.')

  const dismissed = await repository.findById(actor, id)
  if (dismissed === undefined) throw new NotFoundError('No such reminder.')
  return toReminder(dismissed)
}

// ── Push subscriptions ───────────────────────────────────────────────────────

export async function subscribeToPush(
  actor: ActorContext,
  input: PushSubscription,
): Promise<{ id: string }> {
  const spaceId = actor.spaceIds[0]
  if (spaceId === undefined) throw new ValidationError('You do not belong to a space yet.')

  const id = await repository.upsertSubscription(actor, spaceId, {
    endpoint: input.endpoint,
    p256dh: input.keys.p256dh,
    auth: input.keys.auth,
  })

  return { id }
}

/**
 * The VAPID public key, or `null` when push is unconfigured.
 *
 * `null` rather than a 503 so the web app can *hide* the notification UI instead of showing a
 * button that fails. A missing feature the user never sees is better than one that errors.
 */
export function pushPublicKey(): string | null {
  return vapidConfig()?.publicKey ?? null
}
