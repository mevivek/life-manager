import { QueryClientProvider } from '@tanstack/react-query'
import { render, screen, waitFor } from '@testing-library/react'
import { HttpResponse, http } from 'msw'
import { describe, expect, it } from 'vitest'
import { createQueryClient } from '@/lib/query-client'
import { server } from '@/test/msw'
import { awakeFor, BuildCard, builtLabel, isCommit, shortCommit } from './BuildCard'

/**
 * The Build card — what is deployed, for both halves, and whether they agree.
 *
 * The bug this exists for was invisible from inside the app: the web bundle ran ten commits ahead of
 * the API, `documentSchema` required a field the old server did not send, and the archive simply
 * failed to load. So the assertions here are about the **comparison**, not the strings: a mismatch
 * must be stated in words, a match must not be alarmed about, a placeholder version must not be
 * mistaken for either, and an unread server must not be described as a stale one.
 *
 * MSW intercepts at the network layer, so `lib/api`'s real Zod parse of `healthResponseSchema` runs —
 * which is what makes the `built_at` cases real rather than a test of a fixture shape.
 */

/** Two real 40-char shas. Distinct in their first 7 characters, so the short forms differ too. */
const WEB_SHA = '9f3c1ab7d2e45f6081c9ab3d4e5f60718293a4b5'
const API_SHA = '4d81e0cf5a6b7c8d9e0f1a2b3c4d5e6f70819a2b'

/**
 * `webCommit` / `webBuiltAt` are left at their defaults unless a test needs the web half to be a real
 * sha — the defaults are the `define`d globals, so the unspecified case is what actually ships.
 */
function renderCard(
  props: { webCommit?: string; webBuiltAt?: string } = {},
  options: { retry?: boolean } = {},
) {
  const client = createQueryClient()
  if (options.retry === false) {
    // The real client retries a 500 twice, which is right in production and is 30 seconds of nothing
    // in a test asserting the error state.
    client.setDefaultOptions({ queries: { ...client.getDefaultOptions().queries, retry: false } })
  }
  return render(
    <QueryClientProvider client={client}>
      <BuildCard {...props} />
    </QueryClientProvider>,
  )
}

/** A health response, with the fields this card reads. */
function health(body: {
  version: string
  built_at?: string | null
  uptime_seconds?: number
}): void {
  server.use(
    http.get('*/api/v1/health', () =>
      HttpResponse.json({
        status: 'ok',
        version: body.version,
        uptime_seconds: body.uptime_seconds ?? 1,
        built_at: body.built_at ?? null,
      }),
    ),
  )
}

describe('BuildCard', () => {
  it('shows both commits in short form, with the full sha available to copy', async () => {
    health({ version: API_SHA })

    renderCard({ webCommit: WEB_SHA })

    for (const sha of [WEB_SHA, API_SHA]) {
      const cell = await screen.findByTitle(sha)
      expect(cell).toHaveTextContent(shortCommit(sha))
      // Seven characters, not the whole thing: a 40-char sha in a 390px row wraps or clips. The full
      // value is on `title`, which is what `findByTitle` just matched.
      expect(cell.textContent).toHaveLength(7)
      // `.selectable` is what makes it copyable at all — the app-shell rules make text unselectable.
      expect(cell).toHaveClass('selectable')
    }
    expect(screen.getByTitle(WEB_SHA)).toHaveTextContent('9f3c1ab')
    expect(screen.getByTitle(API_SHA)).toHaveTextContent('4d81e0c')

    expect(screen.getByText('This app')).toBeInTheDocument()
    expect(screen.getByText('The server')).toBeInTheDocument()
  })

  it('says in words that the two halves are on different builds', async () => {
    health({ version: API_SHA })
    // Both sides real shas, so the comparison is live rather than skipped.
    expect(isCommit(WEB_SHA) && isCommit(API_SHA)).toBe(true)
    expect(shortCommit(WEB_SHA)).not.toBe(shortCommit(API_SHA))

    renderCard({ webCommit: WEB_SHA })

    expect(
      await screen.findByText('The app and the server are on different builds.'),
    ).toBeInTheDocument()
    // Informative, not alarming: it names the ordinary explanation before the bad one.
    expect(screen.getByText(/normal for a minute or two after a deploy/)).toBeInTheDocument()
  })

  it('does not claim a mismatch when the two commits agree', async () => {
    health({ version: WEB_SHA, built_at: '2026-07-30T08:15:00.000Z' })

    renderCard({ webCommit: WEB_SHA })

    expect(
      await screen.findByText('The app and the server are on the same build.'),
    ).toBeInTheDocument()
    expect(screen.queryByText(/different builds/)).not.toBeInTheDocument()
  })

  it('draws no mismatch warning in local development, where neither version is a commit', async () => {
    // `__APP_VERSION__` is 'test' here and 'dev' in a real local build; the API defaults to
    // '0.0.0-dev'. Those disagree permanently and mean nothing, and a warning on every `pnpm dev`
    // is a warning nobody reads.
    health({ version: '0.0.0-dev' })

    renderCard()

    await waitFor(() => expect(screen.getByText('0.0.0-dev')).toBeInTheDocument())
    expect(screen.queryByText(/different builds/)).not.toBeInTheDocument()
    // And no false reassurance either — silence, not "on the same build".
    expect(screen.queryByText(/same build/)).not.toBeInTheDocument()
  })

  it('says the server is unreachable rather than showing an empty or stale row', async () => {
    server.use(http.get('*/api/v1/health', () => new HttpResponse(null, { status: 500 })))

    renderCard({ webCommit: WEB_SHA }, { retry: false })

    expect(await screen.findByText('Unreachable')).toBeInTheDocument()
    expect(screen.getByText('The server did not answer')).toBeInTheDocument()
    // An unknown server build cannot be compared, so no claim is made in either direction.
    expect(screen.queryByText(/different builds/)).not.toBeInTheDocument()
    expect(screen.queryByText(/same build/)).not.toBeInTheDocument()
    // And the uptime row is absent rather than showing a zero it never read.
    expect(screen.queryByText('Awake for')).not.toBeInTheDocument()
  })

  it('renders an unknown build time as unknown, never as a fabricated date', async () => {
    health({ version: API_SHA, built_at: null })

    renderCard()

    // Two rows say it: the web half's `__BUILT_AT__` is a real value in this config, so the server
    // half is the one under test here.
    await waitFor(() => expect(screen.getByTitle(API_SHA)).toBeInTheDocument())
    expect(screen.getByText('Build time unknown')).toBeInTheDocument()
    // Nothing anywhere in the card invents a date for it. The web row legitimately carries one, so
    // this asserts the count rather than the absence.
    expect(screen.queryAllByText(/^Built /)).toHaveLength(1)
  })

  it('renders a real build time with its time of day, in UTC, for both halves', async () => {
    health({ version: API_SHA, built_at: '2026-07-29T17:04:00.000Z' })

    renderCard()

    // The date alone would be wrong rather than merely lossy: two deploys in one afternoon are the
    // normal case, and a row that cannot tell them apart cannot answer "did my fix ship?".
    expect(await screen.findByText('Built 29 Jul 2026, 17:04 UTC')).toBeInTheDocument()
    // The web half, from `__BUILT_AT__` in vitest.config.ts.
    expect(screen.getByText('Built 30 Jul 2026, 08:15 UTC')).toBeInTheDocument()
  })

  it('labels uptime as awake-for, with a real non-zero reading, and never as a deploy time', async () => {
    health({ version: API_SHA, uptime_seconds: 312, built_at: '2026-07-01T00:00:00.000Z' })

    renderCard()

    // 312s → "5 minutes". The API is scale-to-zero (ADR-0021), so this is when the instance woke —
    // a month after the build time on the row above it, which is exactly why the two are separate
    // rows with separate labels.
    expect(await screen.findByText('5 minutes')).toBeInTheDocument()
    expect(screen.getByText('Awake for')).toBeInTheDocument()
    expect(screen.getByText(/Resets on every cold start/)).toBeInTheDocument()
    expect(screen.queryByText(/deployed 5 minutes/i)).not.toBeInTheDocument()
  })
})

describe('build card helpers', () => {
  it('recognises a commit sha and rejects every placeholder in play', () => {
    expect(isCommit(WEB_SHA)).toBe(true)
    expect(isCommit('9f3c1ab')).toBe(true)
    // The three that exist today, and the shape check catches a fourth nobody has invented yet.
    expect(isCommit('dev')).toBe(false)
    expect(isCommit('0.0.0-dev')).toBe(false)
    expect(isCommit('main')).toBe(false)
    expect(isCommit('0.0.0-test')).toBe(false)
    expect(isCommit(null)).toBe(false)
  })

  it('formats a build time in UTC and refuses to invent one', () => {
    expect(builtLabel('2026-07-29T17:04:00.000Z')).toBe('Built 29 Jul 2026, 17:04 UTC')
    expect(builtLabel(null)).toBe('Build time unknown')
    expect(builtLabel('not a date')).toBe('Build time unknown')
  })

  it('says how long the instance has been awake in one unit', () => {
    expect(awakeFor(1)).toBe('1 second')
    expect(awakeFor(42)).toBe('42 seconds')
    expect(awakeFor(312)).toBe('5 minutes')
    expect(awakeFor(60)).toBe('60 seconds')
    expect(awakeFor(3600)).toBe('60 minutes')
    expect(awakeFor(9000)).toBe('3 hours')
  })
})
