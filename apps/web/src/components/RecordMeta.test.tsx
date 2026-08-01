import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { formatStamp, RecordMeta } from './RecordMeta'

/**
 * The page foot both detail screens end on.
 *
 * Two things here can be wrong without anything looking wrong: **which day** an instant is rendered as,
 * and whether an untouched record claims to have been updated. Both are one grey line at the bottom of a
 * screen, which is precisely why they need a test rather than a glance — the line is legible, plausible
 * and off by a day.
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

describe('formatStamp', () => {
  it('is the short form the rest of the app uses', () => {
    expect(formatStamp('2026-09-12T00:00:00.000Z')).toBe('12 Sep 2026')
  })

  /**
   * The bug this helper exists to avoid, asserted from **both** sides of midnight.
   *
   * `created_at` is an instant, not a calendar date, so `iso.slice(0, 10)` renders the UTC day and
   * disagrees with the user about the day they did something. Building the instants from *local* parts
   * is what makes the expectation deterministic in any zone: 00:30 on the 31st is still the 30th in UTC
   * east of Greenwich, and 23:30 on the 30th is already the 31st in UTC west of it — so a UTC-slicing
   * implementation fails one of these two wherever the runner is standing.
   *
   * (In a runner pinned to UTC the two agree and neither fails. That is a limit of the test, not of the
   * helper: there is no zone in which the local day is wrong, and CI running in UTC is the case where
   * the bug is invisible anyway.)
   */
  it('reads the reader’s calendar day, not UTC’s', () => {
    expect(formatStamp(new Date(2026, 6, 31, 0, 30).toISOString())).toBe('31 Jul 2026')
    expect(formatStamp(new Date(2026, 6, 30, 23, 30).toISOString())).toBe('30 Jul 2026')
  })

  it('is null for anything it cannot read', () => {
    expect(formatStamp(null)).toBeNull()
    expect(formatStamp('')).toBeNull()
    // `new Date('nonsense')` is an Invalid Date rather than a throw, and would render "NaN NaN NaN".
    expect(formatStamp('not a timestamp')).toBeNull()
  })
})
