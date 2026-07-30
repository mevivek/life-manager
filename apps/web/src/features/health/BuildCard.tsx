import { Eyebrow } from '@/components/ui/label'
import { Stat } from '@/components/ui/stat'
import { formatDateShort } from '@/features/documents/ExpiryStatus'
import { useHealth } from './useHealth'

/**
 * **Build** — what is deployed, for both halves, and whether they agree.
 *
 * ═══════════════════════════════════════════════════════════════════════════════════════
 *  Why this is a feature and not decoration
 * ═══════════════════════════════════════════════════════════════════════════════════════
 *
 * The web app deployed with new code while the API stayed **ten commits behind**. `documentSchema`
 * had gained a required `thing_id`, the old API did not send it, so the Zod parse in `lib/api.ts`
 * threw and the Documents archive would not load — and **nothing in the app made the skew visible**.
 * The version string is not the point; the *comparison* is. A number nobody can compare is furniture.
 *
 * It lives on You because that is the tab ADR-0025 §10 describes as "one honest place to answer
 * 'what is this app doing with my stuff'" — account, what we hold, notification truth. The design
 * comp drew `Version 1.0.4` here and it was never built; this is that row, doing a job.
 *
 * ── Three rules, each with a failure mode ──
 *
 * 1. **`uptime_seconds` is never rendered as a deploy time.** The API is Cloud Run with
 *    `--min-instances=0` (ADR-0021), so the process dies whenever traffic stops and `process.uptime()`
 *    restarts from zero several times a day. It is shown, labelled *awake for*, with the reason
 *    beside it. Labelling it "last deployed" would be the same class of lie as the comp's "Undo"
 *    button (`components/ui/toast.tsx`) or its "encrypted at rest" — both refused on the same ground.
 * 2. **An unknown build time renders as "Unknown".** `built_at` is `null` on any image deployed
 *    without `BUILD_TIME`, which includes every image built before this existed. There is nothing to
 *    substitute, and a plausible-looking wrong date is worse than an absent one.
 * 3. **The skew warning only fires when both values are commits.** Locally the bundle is stamped
 *    `dev` and the API defaults to `0.0.0-dev`; those disagree permanently and mean nothing. See
 *    `isCommit`.
 *
 * ── Why the sentences are not in `lib/voice.ts` ──
 *
 * Voice is the two registers for the app's ~9 prose sentences, and `voice.test.ts` enforces that
 * **plain differs from warm and never says less**. These sentences are already nothing but fact —
 * there is no reassurance for plain to drop, so a second register would have to be invented purely to
 * differ, which is how a register stops meaning anything. They also sit on a screen that speaks
 * entirely outside voice already (every string in `you.tsx`, including `PushStatus`'s four states),
 * so putting these two inside it would split one screen's copy across two systems.
 */
export function BuildCard({
  /**
   * The two halves of "what this bundle is", defaulted from the `define`d globals.
   *
   * **Parameters rather than direct reads because the globals are compile-time constants.** Vite
   * substitutes `__APP_VERSION__` into the emitted source as a literal, so there is no variable to
   * reassign and no module to stub — a test could not render this card in the skew state at all if it
   * read them inline. `you.tsx` passes neither, so the shipped behaviour is exactly the globals.
   */
  webCommit = __APP_VERSION__,
  webBuiltAt = __BUILT_AT__,
}: {
  webCommit?: string
  webBuiltAt?: string
} = {}) {
  const health = useHealth()

  const server = serverBuild(health)

  return (
    <section className="mt-5">
      <Eyebrow>Build</Eyebrow>
      <dl className="mt-1">
        <Stat
          term="This app"
          mono
          value={<Commit value={webCommit} />}
          note={builtLabel(webBuiltAt)}
        />
        <Stat
          term="The server"
          mono={server.commit !== null}
          value={server.commit === null ? server.state : <Commit value={server.commit} />}
          note={server.note}
        />
        {/*
          Shown only when it was actually read, and never as a deploy time. The note is not optional
          politeness — without it a reading of "4 minutes" on an app deployed last week is read as a
          deploy that just happened.
        */}
        {health.data !== undefined && (
          <Stat
            term="Awake for"
            value={awakeFor(health.data.uptime_seconds)}
            note="Resets on every cold start, not on every deploy"
          />
        )}
      </dl>
      <BuildAgreement web={webCommit} api={server.commit} />
    </section>
  )
}

/**
 * A commit, short form, with the whole thing available.
 *
 * Seven characters is git's own short form and what a maintainer recognises; the full value is on
 * `title` and the span is `.selectable` — the app-shell rules in `styles.css` make text unselectable
 * by default, so without that class the one value somebody needs to paste into `git show` cannot be
 * copied. Mono because a sha is what the machine names (design.md §3), and it is the `Stat`'s `mono`
 * that supplies the face; this span only handles selection and the tooltip.
 *
 * **Only a sha is shortened.** `0.0.0-dev` clipped to seven characters is `0.0.0-d` — a value that
 * looks like a truncation bug and hides the one thing it was trying to say, which is that this build
 * was never stamped with a commit at all.
 */
function Commit({ value }: { value: string }) {
  return (
    <span className="selectable" title={value}>
      {isCommit(value) ? shortCommit(value) : value}
    </span>
  )
}

/**
 * The sentence that is the whole point of the card.
 *
 * Three outcomes, and the third is the one that needs care: **silence**. Neither a warning nor a
 * confirmation is drawn when either side is not a commit, because "dev" against "0.0.0-dev" is the
 * permanent state of local development and a scary banner there trains the maintainer to ignore it.
 */
function BuildAgreement({ web, api }: { web: string; api: string | null }) {
  if (!isCommit(web) || !isCommit(api)) return null

  if (shortCommit(web) === shortCommit(api)) {
    return (
      <p className="mt-2.5 text-meta leading-relaxed text-ink-3 [text-wrap:pretty]">
        The app and the server are on the same build.
      </p>
    )
  }

  return (
    /*
      Weight and words, no colour. design.md §4 spends colour only on a document's expiry status, and
      a build skew is not a document — borrowing `--status-late` here would make the palette mean two
      different things. Emphasis by weight is the app's own mechanism for the same job (§6, where
      required fields are drawn by weight rather than an asterisk).
    */
    <div className="mt-2.5">
      <p className="text-body font-medium leading-snug [text-wrap:pretty]">
        The app and the server are on different builds.
      </p>
      <p className="mt-1 text-meta leading-relaxed text-ink-3 [text-wrap:pretty]">
        That is normal for a minute or two after a deploy. If it lasts, one half did not ship — and
        while they disagree a list can fail to load, because the app expects fields the server is
        not sending yet.
      </p>
    </div>
  )
}

/** Git's short form. */
export function shortCommit(value: string): string {
  return value.slice(0, 7)
}

/**
 * Whether a version string is a commit sha at all — and therefore whether comparing it means
 * anything.
 *
 * **This is the guard against a false mismatch in local development.** The bundle's
 * `__APP_VERSION__` falls back to `'dev'` (`vite.config.ts`) and the API's `APP_VERSION` defaults to
 * `'0.0.0-dev'` (`apps/api/src/env.ts`); a naive `!==` would draw "different builds" on every
 * `pnpm dev` for ever. Both placeholders fail this test — `'dev'` is three characters and
 * `'0.0.0-dev'` contains characters that are not hex — as does the `_SHA: main` fallback in
 * `cloudbuild.deploy.yaml`. Deliberately a shape check rather than a denylist of known placeholders:
 * a new placeholder somebody invents later is not a commit either.
 */
export function isCommit(value: string | null): value is string {
  return value !== null && /^[0-9a-f]{7,40}$/i.test(value)
}

/** The server row's three reachable states, collapsed to what the row needs to draw. */
function serverBuild(health: ReturnType<typeof useHealth>): {
  commit: string | null
  state: string
  note: string
} {
  if (health.data !== undefined) {
    return { commit: health.data.version, state: '', note: builtLabel(health.data.built_at) }
  }

  /*
    Paused, not failed: queries keep the default `networkMode: 'online'` (see `lib/query-client.ts`),
    so offline this query never fires and never settles. Reporting "unreachable" would be a guess
    about the server; the truth is that nobody asked it. `['health']` is NOT on the persist allowlist
    in `lib/persister.ts`, so there is no stale server build on disk to show here by accident — which
    is what makes "not checked" the only honest answer rather than a choice.
  */
  if (health.fetchStatus === 'paused') {
    return {
      commit: null,
      state: 'Not checked',
      note: 'No connection, so the server was not asked',
    }
  }

  if (health.isError) {
    return { commit: null, state: 'Unreachable', note: 'The server did not answer' }
  }

  return { commit: null, state: '…', note: 'Asking the server' }
}

/**
 * A build time, or an honest absence of one.
 *
 * `formatDateShort` is reused for the calendar half — it slices `YYYY-MM-DD` off the front, so a full
 * ISO instant works and there is one month table in the app rather than two. What it cannot do is the
 * **time**, and dropping that would be wrong here rather than merely lossy: two deploys on one
 * afternoon are the normal case, and "30 Jul 2026" for both is a row that cannot tell them apart.
 *
 * Rendered in **UTC**, and labelled. The two halves are stamped by two different machines, so a value
 * silently converted to the reader's zone stops being comparable with the one beside it — and an
 * unlabelled local time is indistinguishable from an unlabelled UTC one.
 */
export function builtLabel(iso: string | null): string {
  if (iso === null) return 'Build time unknown'
  const at = new Date(iso)
  if (Number.isNaN(at.getTime())) return 'Build time unknown'
  // BOTH halves come from the same normalised string, not from the input. `formatDateShort` slices
  // characters, so feeding it the raw value would print the offset's calendar date beside a UTC time
  // for anything not stamped `Z` — a row that is wrong by a day for half of every evening.
  const utc = at.toISOString()
  return `Built ${formatDateShort(utc)}, ${utc.slice(11, 16)} UTC`
}

/**
 * `uptime_seconds` in words — *how long this instance has been awake*, and nothing more.
 *
 * Rounded to one unit because precision here invites the misreading the label exists to prevent: a
 * number to the second looks like a measurement of something that matters.
 */
export function awakeFor(seconds: number): string {
  if (seconds < 90) {
    const whole = Math.round(seconds)
    return `${whole} ${whole === 1 ? 'second' : 'seconds'}`
  }
  const minutes = Math.round(seconds / 60)
  if (minutes < 90) return `${minutes} ${minutes === 1 ? 'minute' : 'minutes'}`
  const hours = Math.round(seconds / 3600)
  return `${hours} ${hours === 1 ? 'hour' : 'hours'}`
}
