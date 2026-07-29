import { createFileRoute } from '@tanstack/react-router'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { useDocument } from '@/features/documents/useDocuments'
import { useOutbox, useResolveConflict } from '@/features/outbox/useOutbox'
import type { OutboxEntry } from '@/lib/outbox'
import { formatBytes } from '@/lib/storage-quota'

export const Route = createFileRoute('/_authed/outbox')({ component: OutboxPage })

/**
 * Where a rejected offline edit gets decided.
 *
 * [ADR-0024](../../../../docs/decisions/0024-offline-writes-outbox.md) allows offline writes only
 * because a conflict is **surfaced** rather than resolved: "On a 409, surface the conflict to the user
 * — do not auto-merge." This screen is that clause. Two buttons, no merge, and the server's current
 * value shown next to what you tried to write so the choice is informed rather than a guess.
 *
 * There is no third option on purpose. A "merge" button would have to decide which field wins, and
 * ADR-0024 keeps field-level merge explicitly out of scope until conflicts prove frequent enough to
 * justify the risk.
 */
function OutboxPage() {
  const { pending, conflicts } = useOutbox()

  return (
    <div className="flex flex-col gap-6">
      <h1 className="text-xl font-semibold">Unsent changes</h1>

      {conflicts.length === 0 && pending.length === 0 && (
        <Card>
          <CardContent className="pt-4 text-sm text-muted-foreground">
            Everything you have changed has been sent.
          </CardContent>
        </Card>
      )}

      {conflicts.map((entry) => (
        <ConflictCard key={entry.id} entry={entry} />
      ))}

      {pending.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle>Waiting to send</CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col gap-2 text-sm text-muted-foreground">
            {/* Listed but not actionable: these need no decision, only a connection. Offering a
                "send now" button would invite tapping it repeatedly while offline. */}
            {pending.map((entry) => (
              <p key={entry.id}>{describe(entry)}</p>
            ))}
          </CardContent>
        </Card>
      )}
    </div>
  )
}

/** A short human description of a queued write, without dumping the raw patch on screen. */
function describe(entry: OutboxEntry): string {
  switch (entry.kind) {
    case 'document.create':
      return `New document: ${entry.input.title}`
    case 'file.upload':
      return `Photo waiting to upload (${formatBytes(entry.sizeBytes)})`
    case 'document.update': {
      const fields = Object.keys(entry.patch).filter((key) => key !== 'version')
      return `Edit to ${fields.join(', ')}`
    }
    default: {
      // Exhaustive switch with a `never` default (conventions/code.md §5): a new entry kind becomes
      // a compile error here rather than rendering as blank text on the one screen that explains
      // what is unsent.
      const exhaustive: never = entry
      throw new Error(`unhandled outbox entry: ${JSON.stringify(exhaustive)}`)
    }
  }
}

function ConflictCard({ entry }: { entry: OutboxEntry }) {
  const { discard, keepMine } = useResolveConflict()

  // Only an update can conflict today — a create has no version to be stale. Narrowed rather than
  // asserted so adding a conflicting entry kind later is a compile error here.
  const documentId = entry.kind === 'document.update' ? entry.documentId : null
  const current = useDocument(documentId ?? '')

  return (
    <Card>
      <CardHeader>
        <CardTitle>This was changed somewhere else</CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-4 text-sm">
        <p className="text-muted-foreground">{entry.error}</p>

        <div className="flex flex-col gap-3">
          <div>
            <p className="font-medium">Your change</p>
            <p className="text-muted-foreground">{describe(entry)}</p>
          </div>
          <div>
            <p className="font-medium">Currently saved</p>
            <p className="selectable text-muted-foreground">
              {current.isPending
                ? 'Loading…'
                : current.data === undefined
                  ? 'This document no longer exists.'
                  : `${current.data.title} (version ${current.data.version})`}
            </p>
          </div>
        </div>

        <div className="flex gap-2">
          <Button
            // Disabled until the current value has loaded: "keep mine" needs the server's version to
            // apply on top of, and without it the retry would be refused for the same reason again.
            disabled={current.data === undefined}
            onClick={() => {
              if (current.data === undefined) return
              void keepMine(entry.id, current.data.version)
            }}
          >
            Keep my change
          </Button>
          <Button variant="ghost" onClick={() => void discard(entry.id)}>
            Discard mine
          </Button>
        </div>
      </CardContent>
    </Card>
  )
}
