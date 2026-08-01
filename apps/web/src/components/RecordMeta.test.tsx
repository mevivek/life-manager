import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { RecordMeta } from './RecordMeta'

/**
 * The page foot both detail screens end on.
 *
 * Two things here can be wrong without anything looking wrong: **which day** an instant is rendered as,
 * and whether an untouched record claims to have been updated. Both are one grey line at the bottom of a
 * screen, which is precisely why they need a test rather than a glance — the line is legible, plausible
 * and off by a day.
 *
 * The zone behaviour itself lives in `lib/datetime.test.ts`, pinned to two real zones. The fixtures here
 * are **midday UTC** so their rendered day is the same in every real offset — this file is about the
 * component's two branches, not about which clock it reads.
 */
describe('RecordMeta', () => {
  it('states when the record was added', () => {
    render(<RecordMeta createdAt="2026-01-12T09:00:00.000Z" updatedAt="2026-01-12T09:00:00.000Z" />)

    // One line, not two: `updated_at === created_at` is a record nobody has edited yet.
    expect(screen.getByText('Added 12 Jan 2026')).toBeInTheDocument()
    expect(screen.queryByText(/Updated/)).not.toBeInTheDocument()
  })

  it('adds when it last changed, once it has', () => {
    render(<RecordMeta createdAt="2026-01-12T09:00:00.000Z" updatedAt="2026-02-03T18:20:00.000Z" />)

    expect(screen.getByText('Added 12 Jan 2026 · Updated 3 Feb 2026')).toBeInTheDocument()
  })

  it('says nothing about an edit made the same day it was captured', () => {
    render(<RecordMeta createdAt="2026-01-12T09:00:00.000Z" updatedAt="2026-01-12T09:01:30.000Z" />)

    // The timestamps differ; the rendered days do not. "Added 12 Jan · Updated 12 Jan" is a line that
    // reads as a fact and carries none.
    expect(screen.getByText('Added 12 Jan 2026')).toBeInTheDocument()
    expect(screen.queryByText(/Updated/)).not.toBeInTheDocument()
  })

  it('renders nothing at all when the timestamp is missing', () => {
    // The D46 shape: a cache entry written by an older build, rehydrated without re-running Zod. An
    // absent line is self-healing on the next fetch; "Added —" would outlive it.
    const { container } = render(<RecordMeta createdAt={undefined} updatedAt={undefined} />)

    expect(container).toBeEmptyDOMElement()
  })
})
