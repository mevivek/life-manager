import { AUTO_REMINDER_TYPES, type DocumentType, type Reminder } from '@life-manager/shared'
import { useState } from 'react'
import { Alert } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { Tag } from '@/components/ui/chip'
import { Input } from '@/components/ui/input'
import { Eyebrow, Label } from '@/components/ui/label'
import { ApiError } from '@/lib/api'
import { formatDateShort } from './ExpiryStatus'
import { useCreateReminder, useDeleteReminder } from './useDocuments'

/**
 * Reminders, as chips inside the status block. ADR-0024 §6.
 *
 * ── Read-mostly, and that is the design's point ──
 *
 * The previous version was a small CRUD panel: a list of rows, each with a Remove button, plus a form
 * with a date and a lead-day number field. It is now a row of `90 days before` / `30 days before` /
 * `7 days before` pills with one quiet line beneath them, because **for the documents that matter the
 * reminders are automatic**: `AUTO_REMINDER_TYPES` (identity, certificate) with an expiry get
 * `DEFAULT_LEAD_DAYS` created server-side (business rule 8).
 *
 * So the common case has nothing to manage, and presenting it as a form to fill in implied the user
 * had to set them up. Editing is still here — it unfolds — but it is the exception rather than the
 * frame.
 *
 * The lead times shown are **the reminders that actually exist**, read back from the API. They are
 * never derived from `DEFAULT_LEAD_DAYS` in the client: if the server's defaults change, or a job has
 * not run, this must show what is really scheduled rather than what we assume would be.
 */
export function DocumentReminders({
  documentId,
  reminders,
  expiresOn,
  docType,
}: {
  documentId: string
  reminders: Reminder[]
  expiresOn: string | null
  docType: DocumentType
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
      await create.mutateAsync({ due_on: dueOn, lead_days: Number(leadDays), channel: 'web_push' })
      setAdding(false)
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.message : 'Could not add that reminder.')
    }
  }

  /** Longest lead first, so the chips read as a countdown rather than in creation order. */
  const sorted = [...reminders].sort((a, b) => b.lead_days - a.lead_days)
  const automatic = AUTO_REMINDER_TYPES.includes(docType) && expiresOn !== null

  return (
    <div className="mt-3 border-t border-rule pt-3">
      <Eyebrow>Reminders</Eyebrow>

      {error !== null && <Alert className="mt-2">{error}</Alert>}

      {sorted.length > 0 ? (
        <div className="mt-2 flex flex-wrap gap-1.5">
          {sorted.map((reminder) => (
            <Tag key={reminder.id} className="gap-1.5">
              {reminder.lead_days === 0
                ? `On ${formatDateShort(reminder.due_on)}`
                : `${reminder.lead_days} days before`}
              {/* Sent and dismissed are real states worth showing — a reminder that has already
                  fired is not one that is still coming. */}
              {reminder.sent_at !== null && <span className="text-ink-3">· sent</span>}
              {reminder.dismissed_at !== null && <span className="text-ink-3">· dismissed</span>}
              <button
                type="button"
                onClick={() => remove.mutate(reminder.id)}
                disabled={remove.isPending}
                // A 44px hit area would make the pill enormous, so this one control is smaller than
                // `--tap-min` and compensates with padding. The chip itself is 30px tall by design.
                className="-mr-1 px-1 text-ink-3 hover:text-ink"
                aria-label={`Remove the ${reminder.lead_days}-day reminder`}
              >
                ×
              </button>
            </Tag>
          ))}
        </div>
      ) : (
        <p className="mt-2 text-meta leading-relaxed text-ink-3 [text-wrap:pretty]">
          {expiresOn === null
            ? // Q1's answer, stated rather than implied: no date is a normal state, so this is not a
              // problem to fix.
              'No expiry date, so there is nothing to count down to.'
            : 'No reminders on this one yet.'}
        </p>
      )}

      {automatic && sorted.length > 0 && (
        <p className="mt-2 text-meta leading-relaxed text-ink-3">
          Set automatically for identity documents and certificates with an expiry.
        </p>
      )}

      {adding ? (
        <div className="mt-3 flex flex-col gap-2.5 rounded-3 border border-rule p-3">
          <div className="flex gap-2.5">
            <div className="flex flex-1 flex-col gap-1.5">
              <Label htmlFor="reminder-due">Date</Label>
              <Input
                id="reminder-due"
                type="date"
                value={dueOn}
                className="px-3"
                onChange={(event) => setDueOn(event.target.value)}
              />
            </div>
            <div className="flex flex-1 flex-col gap-1.5">
              <Label htmlFor="reminder-lead">Days before</Label>
              <Input
                id="reminder-lead"
                type="number"
                min={0}
                value={leadDays}
                className="px-3"
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
            <Button variant="quiet" size="sm" onClick={() => setAdding(false)}>
              Cancel
            </Button>
          </div>
        </div>
      ) : (
        <Button variant="quiet" size="bare" className="mt-1" onClick={() => setAdding(true)}>
          Add a reminder
        </Button>
      )}
    </div>
  )
}
