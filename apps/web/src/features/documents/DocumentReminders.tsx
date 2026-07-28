import type { Reminder } from '@life-manager/shared'
import { useState } from 'react'
import { Alert } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { ApiError } from '@/lib/api'
import { useCreateReminder, useDeleteReminder } from './useDocuments'

/**
 * Reminders on one document. domains/documents.md §7.
 *
 * Two things worth knowing before editing this:
 *
 * - **Reminders here are expiry-shaped, not arbitrary.** Q1 was answered as expiry-only, so this
 *   panel adds a reminder at a date with a lead time and nothing more. There is no "remind me every
 *   6 months" because that was explicitly declined.
 * - **The automatic 90/30/7 reminders are created server-side** for identity documents and
 *   certificates (business rule 8). They appear in this list like any other, and they are
 *   indistinguishable from hand-added ones by design — which is why changing `expires_on` rebuilds
 *   the whole pending set rather than trying to patch dates.
 */
export function DocumentReminders({
  documentId,
  reminders,
  expiresOn,
}: {
  documentId: string
  reminders: Reminder[]
  expiresOn: string | null
}) {
  const [adding, setAdding] = useState(false)
  const [dueOn, setDueOn] = useState(expiresOn ?? '')
  const [leadDays, setLeadDays] = useState('30')
  const [error, setError] = useState<string | null>(null)

  const create = useCreateReminder(documentId)
  const remove = useDeleteReminder(documentId)

  async function submit() {
    setError(null)
    try {
      await create.mutateAsync({
        due_on: dueOn,
        lead_days: Number(leadDays),
        channel: 'web_push',
      })
      setAdding(false)
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.message : 'Could not add that reminder.')
    }
  }

  return (
    <div className="flex flex-col gap-3">
      {error !== null && <Alert variant="destructive">{error}</Alert>}

      {reminders.length === 0 && (
        <p className="text-sm text-muted-foreground">
          No reminders. {expiresOn === null && 'Add an expiry date and this document can nag you.'}
        </p>
      )}

      <ul className="flex flex-col gap-2">
        {reminders.map((reminder) => (
          <li
            key={reminder.id}
            className="flex items-center justify-between gap-2 rounded-md border border-border px-3 py-2"
          >
            <div>
              <p className="text-sm">
                {reminder.lead_days === 0
                  ? `On ${reminder.due_on}`
                  : `${reminder.lead_days} days before ${reminder.due_on}`}
              </p>
              <p className="text-xs text-muted-foreground">
                {reminder.sent_at !== null
                  ? 'Sent'
                  : reminder.dismissed_at !== null
                    ? 'Dismissed'
                    : 'Pending'}
                {' · '}
                {reminder.channel}
              </p>
            </div>
            <Button
              size="sm"
              variant="ghost"
              onClick={() => remove.mutate(reminder.id)}
              disabled={remove.isPending}
            >
              Remove
            </Button>
          </li>
        ))}
      </ul>

      {adding ? (
        <div className="flex flex-col gap-3 rounded-md border border-border p-3">
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="flex flex-col gap-2">
              <Label htmlFor="reminder-due">Date</Label>
              <Input
                id="reminder-due"
                type="date"
                value={dueOn}
                onChange={(event) => setDueOn(event.target.value)}
              />
            </div>
            <div className="flex flex-col gap-2">
              <Label htmlFor="reminder-lead">Days before</Label>
              <Input
                id="reminder-lead"
                type="number"
                min={0}
                value={leadDays}
                onChange={(event) => setLeadDays(event.target.value)}
              />
            </div>
          </div>
          <div className="flex gap-2">
            <Button
              size="sm"
              onClick={() => void submit()}
              disabled={create.isPending || dueOn === ''}
            >
              {create.isPending ? 'Adding…' : 'Add reminder'}
            </Button>
            <Button size="sm" variant="outline" onClick={() => setAdding(false)}>
              Cancel
            </Button>
          </div>
        </div>
      ) : (
        <Button variant="outline" size="sm" onClick={() => setAdding(true)}>
          Add a reminder
        </Button>
      )}
    </div>
  )
}
