import type { ReminderChannel } from '@life-manager/shared'
import { and, eq, inArray, isNull, lte, sql } from 'drizzle-orm'
import type { ActorContext } from '../../auth/actor.js'
import { db } from '../../db/client.js'
import { scoped } from '../../db/scoped.js'
import type { Executor } from '../documents/documents.repository.js'
import { documents, pushSubscriptions, reminders } from '../documents/documents.schema.js'

/**
 * SQL for `reminders` and `push_subscriptions`.
 *
 * Reminders are their **own domain**, not a part of Documents — the table is keyed by
 * `entity_type` + `entity_id` so Assets and Money (M4) reuse it (domains/documents.md §3). Keeping
 * the repository here rather than in `domains/documents/` is what makes that reuse a matter of
 * passing a different `entityType` instead of a refactor.
 */

export type ReminderRow = typeof reminders.$inferSelect

export const DOCUMENT_ENTITY_TYPE = 'document'

/**
 * The second entity type — ADR-0029, things.md §6. The table needed **no schema change** for it,
 * which is the whole point of it having been keyed by `entity_type` + `entity_id` from the start.
 *
 * ═══════════════════════════════════════════════════════════════════════════════════════
 *  NOTHING CREATES ONE OF THESE YET, and that is things.md §9(2), not an oversight.
 * ═══════════════════════════════════════════════════════════════════════════════════════
 *
 * Documents auto-create reminders for `identity` and `certificate` only (`AUTO_REMINDER_TYPES`). The
 * equivalent question here — *should every warranty get a reminder?* — is **unanswered**, and
 * things.md §6 says in as many words: "Do not decide it in a repository." So the capability exists
 * (this constant, the entity-typed queries below, `reminders[]` on the thing detail response) and the
 * switch is off until a human answers it in product/open-questions.md.
 *
 * **Before switching it on, read the note on `listDueForMaintenance`** — the scan's copy is
 * document-shaped and would tell a user their warranty "expires", which is the one thing ADR-0029
 * exists to prevent.
 */
export const THING_ENTITY_TYPE = 'thing'

export type ReminderEntityType = typeof DOCUMENT_ENTITY_TYPE | typeof THING_ENTITY_TYPE

/**
 * One entity's reminders.
 *
 * `entityType` is an explicit parameter rather than defaulted to `'document'`: a default would let a
 * new domain's call site silently read the *documents* reminders for an id that happens to collide,
 * and `entity_id` is polymorphic with no foreign key (documents.md §9 q4), so a collision is
 * expressible rather than impossible.
 */
export async function listForEntity(
  actor: ActorContext,
  entityType: ReminderEntityType,
  entityId: string,
  executor: Executor = db,
): Promise<ReminderRow[]> {
  return executor
    .select()
    .from(reminders)
    .where(
      and(
        scoped(actor, reminders),
        eq(reminders.entityType, entityType),
        eq(reminders.entityId, entityId),
      ),
    )
    .orderBy(reminders.dueOn, reminders.leadDays)
}

export async function findById(
  actor: ActorContext,
  id: string,
  executor: Executor = db,
): Promise<ReminderRow | undefined> {
  const rows = await executor
    .select()
    .from(reminders)
    .where(and(scoped(actor, reminders), eq(reminders.id, id)))
    .limit(1)

  return rows[0]
}

export async function insert(
  actor: ActorContext,
  spaceId: string,
  values: { entityId: string; dueOn: string; leadDays: number; channel: ReminderChannel },
  executor: Executor = db,
): Promise<string> {
  const rows = await executor
    .insert(reminders)
    .values({
      spaceId,
      createdBy: actor.userId,
      entityType: DOCUMENT_ENTITY_TYPE,
      entityId: values.entityId,
      dueOn: values.dueOn,
      leadDays: values.leadDays,
      channel: values.channel,
    })
    .returning({ id: reminders.id })

  const id = rows[0]?.id
  if (id === undefined) throw new Error('insert reminders returned no id')
  return id
}

export async function softDelete(
  actor: ActorContext,
  id: string,
  executor: Executor = db,
): Promise<number> {
  const now = new Date()
  const changed = await executor
    .update(reminders)
    .set({ deletedAt: now, updatedAt: now })
    .where(and(scoped(actor, reminders), eq(reminders.id, id)))
    .returning({ id: reminders.id })

  return changed.length
}

/**
 * Business rules 7 and 9: clears an entity's **pending** reminders.
 *
 * Pending only — `sent_at is null`. A reminder that already fired is history, and deleting it
 * because the expiry date moved would rewrite the record of a notification the user actually
 * received.
 */
export async function softDeletePendingFor(
  actor: ActorContext,
  entityId: string,
  executor: Executor = db,
): Promise<void> {
  const now = new Date()
  await executor
    .update(reminders)
    .set({ deletedAt: now, updatedAt: now })
    .where(
      and(
        scoped(actor, reminders),
        eq(reminders.entityType, DOCUMENT_ENTITY_TYPE),
        eq(reminders.entityId, entityId),
        isNull(reminders.sentAt),
      ),
    )
}

export async function dismiss(
  actor: ActorContext,
  id: string,
  executor: Executor = db,
): Promise<number> {
  const now = new Date()
  const changed = await executor
    .update(reminders)
    .set({ dismissedAt: now, updatedAt: now })
    .where(and(scoped(actor, reminders), eq(reminders.id, id)))
    .returning({ id: reminders.id })

  return changed.length
}

// ── The scan and delivery job's queries ──────────────────────────────────────

export type DueReminder = ReminderRow & { documentTitle: string | null }

/**
 * Every reminder due today or overdue, across **every space**.
 *
 * ── DELIBERATE DEVIATION from "every repository function takes `actor` first" ──
 *
 * A cron job has no actor: it acts on behalf of the system, over all spaces, so requiring an
 * `ActorContext` would mean inventing one — which conventions/code.md §2 explicitly forbids
 * ("never construct an ActorContext by hand outside the auth hook or a test fixture"). The same
 * exemption `listAllUsersForMaintenance` takes in `auth/memberships.repository.ts`, and the
 * name says so.
 *
 * **The safety property is that the results never reach an HTTP response.** They are consumed by
 * `jobs/reminders.ts` and turned into push messages addressed to the subscriptions of the
 * reminder's *own* space, so a row cannot leak into another space's view.
 *
 * `due_on - lead_days <= today` is the fire condition (spec §3), computed in SQL so "today" is
 * the database's date rather than the API process's — a distinction that matters exactly once a
 * year in the wrong timezone.
 *
 * ── This is still DOCUMENT-shaped, and it has to stay that way until things.md §9(2) is answered ──
 *
 * The join is to `documents`, and `jobs/reminders.ts` renders the notification as
 * `"{title} expires {due_on}"`. A `entity_type = 'thing'` row would come through here with a null
 * title and be announced as *"A document expires …"* — and if the join were naively widened, as
 * *"Dishwasher expires 20 Jan"*, which is precisely the sentence ADR-0029 exists to prevent (a
 * warranty ending is not an expiry; the dishwasher keeps washing dishes).
 *
 * Nothing creates a thing reminder today, so this cannot happen. **Widening the scan is part of
 * answering §9(2)**, not a preparatory refactor: it needs a second title source and a second copy
 * register ("Warranty ends", "Service due"), which is a product decision about wording.
 */
export async function listDueForMaintenance(today: string): Promise<DueReminder[]> {
  return db
    .select({
      ...getReminderColumns(),
      documentTitle: documents.title,
    })
    .from(reminders)
    .leftJoin(documents, eq(documents.id, reminders.entityId))
    .where(
      and(
        isNull(reminders.sentAt),
        isNull(reminders.dismissedAt),
        isNull(reminders.deletedAt),
        lte(sql`${reminders.dueOn} - ${reminders.leadDays}`, today),
      ),
    )
    .orderBy(reminders.dueOn)
    .limit(500)
}

function getReminderColumns() {
  return {
    id: reminders.id,
    spaceId: reminders.spaceId,
    createdBy: reminders.createdBy,
    createdAt: reminders.createdAt,
    updatedAt: reminders.updatedAt,
    deletedAt: reminders.deletedAt,
    entityType: reminders.entityType,
    entityId: reminders.entityId,
    dueOn: reminders.dueOn,
    leadDays: reminders.leadDays,
    channel: reminders.channel,
    sentAt: reminders.sentAt,
    dismissedAt: reminders.dismissedAt,
  }
}

/**
 * Marks a reminder delivered. Maintenance, same exemption as above.
 *
 * `sent_at` **is** the delivery job's idempotency (spec §3), so this is the write that makes a
 * retried job stop re-notifying. It is set only after a successful send: on failure the column
 * stays null and the next scan picks it up again (spec §6).
 */
export async function markSentForMaintenance(id: string): Promise<void> {
  const now = new Date()
  await db.update(reminders).set({ sentAt: now, updatedAt: now }).where(eq(reminders.id, id))
}

/**
 * Reminders whose document no longer exists. spec §9 question 4: `entity_id` is polymorphic and
 * therefore has no foreign key, and this sweep is the price of that choice — recorded honestly
 * rather than pretended away.
 */
export async function listOrphanedForMaintenance(limit = 500): Promise<string[]> {
  const rows = await db
    .select({ id: reminders.id })
    .from(reminders)
    .leftJoin(documents, eq(documents.id, reminders.entityId))
    .where(
      and(
        isNull(reminders.deletedAt),
        eq(reminders.entityType, DOCUMENT_ENTITY_TYPE),
        isNull(documents.id),
      ),
    )
    .limit(limit)

  return rows.map((row) => row.id)
}

export async function softDeleteManyForMaintenance(ids: string[]): Promise<void> {
  if (ids.length === 0) return
  const now = new Date()
  await db
    .update(reminders)
    .set({ deletedAt: now, updatedAt: now })
    .where(inArray(reminders.id, ids))
}

// ── Push subscriptions ───────────────────────────────────────────────────────

export type PushSubscriptionRow = typeof pushSubscriptions.$inferSelect

/**
 * Registers a browser's push endpoint, or revives it if it was previously seen.
 *
 * `on conflict (endpoint) do update` rather than insert-or-fail: a browser re-subscribing is
 * routine (keys rotate, the service worker re-registers), and it must not create a second row
 * that would deliver the same notification twice. Clearing `expired_at` and `deleted_at` is what
 * makes re-granting permission work after a previous endpoint went stale.
 */
export async function upsertSubscription(
  actor: ActorContext,
  spaceId: string,
  values: { endpoint: string; p256dh: string; auth: string },
): Promise<string> {
  const rows = await db
    .insert(pushSubscriptions)
    .values({ ...values, spaceId, createdBy: actor.userId })
    .onConflictDoUpdate({
      target: pushSubscriptions.endpoint,
      set: {
        p256dh: values.p256dh,
        auth: values.auth,
        spaceId,
        createdBy: actor.userId,
        expiredAt: null,
        deletedAt: null,
        updatedAt: new Date(),
      },
    })
    .returning({ id: pushSubscriptions.id })

  const id = rows[0]?.id
  if (id === undefined) throw new Error('upsert push_subscriptions returned no id')
  return id
}

/** Live subscriptions for one space. Maintenance — called by the delivery job, no actor. */
export async function listSubscriptionsForMaintenance(
  spaceId: string,
): Promise<PushSubscriptionRow[]> {
  return db
    .select()
    .from(pushSubscriptions)
    .where(
      and(
        eq(pushSubscriptions.spaceId, spaceId),
        isNull(pushSubscriptions.expiredAt),
        isNull(pushSubscriptions.deletedAt),
      ),
    )
}

/**
 * Marks an endpoint dead after a 404/410 from the push service.
 *
 * Those two statuses mean the browser has permanently discarded the subscription, so retrying
 * forever would be a slow leak of failing requests every single day. Any other failure leaves the
 * row alone, because it might be transient.
 */
export async function markSubscriptionExpiredForMaintenance(id: string): Promise<void> {
  await db
    .update(pushSubscriptions)
    .set({ expiredAt: new Date(), updatedAt: new Date() })
    .where(eq(pushSubscriptions.id, id))
}
