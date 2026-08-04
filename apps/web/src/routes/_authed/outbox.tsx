import { createFileRoute } from '@tanstack/react-router'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { Eyebrow } from '@/components/ui/label'
import { useDocument } from '@/features/documents/useDocuments'
import { useOutbox, useResolveConflict } from '@/features/outbox/useOutbox'
import { useThing } from '@/features/things/useThings'
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
 *
 * ── Dressed in the Ledger system (ADR-0025), and the tones are load-bearing ──
 *
 * A conflict is `--status-late`-tinted; things merely waiting to send are `--sunken`, the quietest
 * panel there is. That difference *is* the information on this screen: one row needs a decision from
 * you and the rest need a network. Rendering both as neutral cards — which is what this looked like
 * before — made the user read every entry to find the one that wanted something.
 */
function OutboxPage() {
  const { pending, conflicts } = useOutbox()

  return (
    <div>
      <h1 className="font-heading text-title font-face-h leading-tight">Unsent changes</h1>

      {conflicts.length === 0 && pending.length === 0 && (
        <p className="mt-2 text-body leading-relaxed text-ink-2 [text-wrap:pretty]">
          Everything you’ve changed has been sent. Nothing is waiting on a connection.
        </p>
      )}

      {conflicts.length > 0 && (
        <section className="mt-5">
          <div className="pb-2.5">
            <Eyebrow>Needs a decision</Eyebrow>
          </div>
          <div className="flex flex-col gap-3">
            {conflicts.map((entry) => (
              <ConflictCard key={entry.id} entry={entry} />
            ))}
          </div>
        </section>
      )}

      {pending.length > 0 && (
        <section className="mt-6">
          <div className="flex items-baseline justify-between pb-2.5">
            <Eyebrow>Waiting to send</Eyebrow>
            <span className="text-meta text-ink-3">{pending.length}</span>
          </div>
          {/* Listed but not actionable: these need no decision, only a connection. Offering a
              "send now" button would invite tapping it repeatedly while offline. */}
          <Card tone="sunken" className="border-rule p-card">
            <ul className="flex list-none flex-col gap-2">
              {pending.map((entry) => (
                <li key={entry.id} className="text-body text-ink-2">
                  {describe(entry)}
                </li>
              ))}
            </ul>
          </Card>
          <p className="mt-2 text-meta leading-relaxed text-ink-3 [text-wrap:pretty]">
            These go out on their own the next time you have a connection.
          </p>
        </section>
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
    case 'thing.create':
      return `New thing: ${entry.input.name}`
    case 'thing.update': {
      const fields = Object.keys(entry.patch).filter((key) => key !== 'version')
      return `Edit to ${fields.join(', ')}`
    }
    case 'thing.service':
      return `Service logged for ${entry.input.serviced_on}`
    case 'thing.photo':
      return `Photo waiting to upload (${formatBytes(entry.sizeBytes)})`
    default: {
      // Exhaustive switch with a `never` default (conventions/code.md §5): a new entry kind becomes
      // a compile error here rather than rendering as blank text on the one screen that explains
      // what is unsent.
      const exhaustive: never = entry
      throw new Error(`unhandled outbox entry: ${JSON.stringify(exhaustive)}`)
    }
  }
}

/**
 * Picks the card that knows how to read the record the conflict is about.
 *
 * **Two components rather than one with two hooks in it.** A single card would have to call both
 * `useDocument` and `useThing` on every render — hooks cannot be conditional — so every thing conflict
 * would fire a `GET /documents/` and vice versa. Splitting keeps each hook unconditional *within* its
 * own component and fires exactly one request.
 */
function ConflictCard({ entry }: { entry: OutboxEntry }) {
  if (entry.kind === 'document.update') return <DocumentConflictCard entry={entry} />
  if (entry.kind === 'thing.update') return <ThingConflictCard entry={entry} />

  /**
   * Nothing else can conflict today: a create has no version to be stale against, and the queue's
   * other kinds are appends. This branch is not dead code though — `MAX_ONLINE_ATTEMPTS` marks *any*
   * kind `'conflict'` when it repeatedly fails while online, so a queued photo can land here. It gets
   * the same card without a "currently saved" row, because there is no single record to show.
   */
  return <ConflictShell entry={entry} current={{ isPending: false, label: null }} />
}

function DocumentConflictCard({ entry }: { entry: OutboxEntry & { kind: 'document.update' } }) {
  const current = useDocument(entry.documentId)

  return (
    <ConflictShell
      entry={entry}
      current={{
        isPending: current.isPending,
        label:
          current.data === undefined
            ? 'This document no longer exists.'
            : `${current.data.title} (version ${current.data.version})`,
        version: current.data?.version,
      }}
    />
  )
}

function ThingConflictCard({ entry }: { entry: OutboxEntry & { kind: 'thing.update' } }) {
  const current = useThing(entry.thingId)

  return (
    <ConflictShell
      entry={entry}
      current={{
        isPending: current.isPending,
        label:
          current.data === undefined
            ? 'This thing no longer exists.'
            : `${current.data.name} (version ${current.data.version})`,
        version: current.data?.version,
      }}
    />
  )
}

type CurrentValue = {
  isPending: boolean
  /** `null` when this kind has no single record to show — see `ConflictCard`'s last branch. */
  label: string | null
  /** Absent when the record could not be read; "Keep my change" needs it and stays disabled without it. */
  version?: number
}

function ConflictShell({ entry, current }: { entry: OutboxEntry; current: CurrentValue }) {
  const { discard, keepMine } = useResolveConflict()

  return (
    <Card tone="late" className="p-card">
      <p className="text-row font-medium leading-snug">This was changed somewhere else</p>
      <p className="mt-1 text-body leading-relaxed text-ink-2 [text-wrap:pretty]">{entry.error}</p>

      <dl className="mt-3.5 flex flex-col gap-2.5">
        <div>
          <dt className="font-mono text-label font-medium uppercase tracking-label text-ink-3">
            Your change
          </dt>
          <dd className="mt-0.5 text-body">{describe(entry)}</dd>
        </div>
        {current.label !== null && (
          <div>
            <dt className="font-mono text-label font-medium uppercase tracking-label text-ink-3">
              Currently saved
            </dt>
            <dd className="selectable mt-0.5 text-body">
              {current.isPending ? 'Loading…' : current.label}
            </dd>
          </div>
        )}
      </dl>

      <div className="mt-4 flex flex-wrap gap-2">
        <Button
          size="sm"
          // Disabled until the current value has loaded: "keep mine" needs the server's version to
          // apply on top of, and without it the retry would be refused for the same reason again.
          disabled={current.version === undefined}
          onClick={() => {
            if (current.version === undefined) return
            void keepMine(entry.id, current.version)
          }}
        >
          Keep my change
        </Button>
        {/*
          `destructive`, not `quiet`. Discarding is the one irreversible button on this screen — the
          queued write is deleted and there is nowhere to get it back from — and the design reserves
          `--status-late` text for exactly that. It is still text rather than a filled red block, so it
          does not outshout "Keep my change".
        */}
        <Button variant="destructive" size="sm" onClick={() => void discard(entry.id)}>
          Discard mine
        </Button>
      </div>
    </Card>
  )
}
