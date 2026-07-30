# life-manager

Personal life-management app: documents, physical assets, money, people, notes, and
eventually a secrets/password vault. Built incrementally, almost entirely across separate
AI-agent sessions.

**This file is a router, not a summary.** It exists so a new session can orient in one
read, then open only what its task needs. Full index: [`docs/README.md`](docs/README.md).

---

## Status

**[M1](docs/roadmap.md) — Documents — is BUILT and DEPLOYED, but NOT DONE.** `pnpm typecheck lint
build` are green. **The suite is 360 tests: web 206 · api 125 · shared 29 — 360/0 measured on
2026-07-30 against a real Postgres**, not inferred from a green pipeline. A container with no Docker
measures **248 passed / 112 skipped**; all 112 skipped are the API's — the maintenance
endpoint's four constant-time-comparison tests are deliberately NOT database-backed, so they run
everywhere.

**Those numbers are M1's and are no longer the suite.** After M4 step 1 (the Things API) it is
**674 tests: web 409 · api 213 · shared 52 — 674/0 measured on 2026-07-30** against a real Postgres,
three consecutive runs. With no database available it is **477 passed / 197 skipped**; all 197 skipped
are the API's. The M1 figures are kept above because the paragraph they sit in is about M1's "done
when", and because a count in this file has been wrong before — take the measurement, don't trust
either number.

**You can run the database-backed suites in this container without Docker.** Postgres 16 is installed
at `/usr/lib/postgresql/16/bin`, and `initdb` refuses to run as root, so:
`chown postgres <datadir> && su postgres -c "…/initdb -D <datadir> -U postgres --auth=trust"`, start
it on a spare port, `createdb`, then
`CI=true TEST_DATABASE_URL=postgres://postgres@127.0.0.1:<port>/<db> pnpm test`. `CI=true` is what
makes the harness throw instead of skip. Do **not** write that URL into `apps/api/.env`.

**R2 and VAPID are now provisioned, and the database holds real documents** (2026-07-30). Uploads
were confirmed working from the maintainer's phone, and `node scripts/verify-deployment.mjs` passes
**42/42** against production including a real presign → PUT → confirm round-trip against R2, and the
two ADR-0028 checks that assert the maintenance trigger REFUSES an unauthenticated call.

**What M1 still lacks is a notification that has actually arrived — and the code for it now exists.**
[ADR-0028](docs/decisions/0028-external-trigger-for-the-daily-scan.md) built the way out:
`POST /api/v1/maintenance::run-daily`, called daily by Cloud Scheduler, authenticated by a
constant-time-compared `X-Cron-Key`, serialised by an advisory lock. The request wakes the API, the
scan **and the deliveries** run inline, and everything sleeps again — so `ENABLE_SCHEDULED_JOBS` stays
off **permanently** and **D8 is closed by avoidance** rather than accepted.

**Delivering inline is the whole point, not an implementation detail.** `scanReminders()` enqueues to
pg-boss and is now the wrong function to call from the trigger: on a scale-to-zero instance the queued
`deliver` job sits there until some later request happens to wake a worker, so reminders would look
scheduled and still never arrive. Use `runRemindersInline()`. Both exist and that duplication is
deliberate — ADR-0012 still wants the queue for M2's OCR.

**PROVISIONED AND PROVEN IN PRODUCTION, 2026-07-30 — one link short of done.** `CRON_SECRET` is bound
and the Cloud Scheduler job `life-manager-daily-scan` exists (`ENABLED`, `0 8 * * *`, `Etc/UTC`). A real
call against production returned:

    { "status": "ran", "today": "2026-07-30", "found": 1, "delivered": 0,
      "undelivered": 1, "errored": 0, "swept": 0, "duration_ms": 579 }

So the whole chain works — auth, content type, advisory lock, scan, counts. **`undelivered: 1` with
`errored: 0` means the scan found a due reminder and had nowhere to send it**: no live push subscription
in the space, because reminders have not been switched on from the You screen on the phone yet. Nothing
was lost — `sent_at` is written only after a successful send, so that reminder is still pending.

**What is left is observation, not code:** turn reminders on from You, call the endpoint again, and see
`delivered: 1` with a notification on the phone. Until that is *seen*, M1's "done when" is unmet — do
not mark it done on the strength of the counts above. To call it by hand without putting the secret on a
command line:

    $key = (gcloud.cmd secrets versions access latest --secret=CRON_SECRET --project=life-manager-01)
    Invoke-RestMethod -Method Post -Uri https://api.mevivek.dev/api/v1/maintenance:run-daily `
      -Headers @{ 'X-Cron-Key' = $key } | ConvertTo-Json

Read the **counts**: `found 0` means nothing was due, not that it works. And **never** run a bare
`gcloud scheduler jobs describe` — it prints the `X-Cron-Key` header in full (debt D52).

**Deploying M1 first required [ADR-0023](docs/decisions/0023-migrate-on-boot.md).** Nothing had been
applying migrations since ADR-0021 dropped Fly's `release_command`, and because `/health` does not
touch the database, both the pipeline's check and the deploy verifier would have gone green against
an API with five missing tables. The API now migrates itself on boot, under an advisory lock.

**[M0](docs/roadmap.md) done and verified on a real phone**, and reviewed 2026-07-28.

**It has run on the real domain, not just `localhost`.** Verified 2026-07-27 over a Cloudflare
Tunnel serving `app.mevivek.dev` and `api.mevivek.dev`: 21/21 public checks, including the
cross-subdomain session cookie from [ADR-0019](docs/decisions/0019-same-site-subdomain-deployment.md)
— which is the one thing `localhost` cannot exercise. The PWA installs. Google sign-in works and
created a real account with a personal space. Schema is applied to the Neon dev branch.

**It is deployed, and nothing runs on the maintainer's laptop.** `app.mevivek.dev` is Cloudflare
Pages (builds on push from `main`); `api.mevivek.dev` is Cloud Run, scale-to-zero
([ADR-0021](docs/decisions/0021-cloud-run-for-the-api.md), superseding ADR-0014's Fly choice);
Postgres is Neon. Re-verify any deploy with `node scripts/verify-deployment.mjs` — 42 checks,
including the ones `localhost` structurally cannot perform.
**Do not trust ANY probe of the deployed app from an agent container.** This file used to say that
`curl` goes through the agent HTTPS proxy — which has been seen returning SPA-fallback HTML for an
asset the origin serves correctly — but that **Node's `fetch` ignores `HTTPS_PROXY` and reaches the
origin**. *That second half is false*, and believing it cost real time on 2026-07-30: a `fetch`-based
probe reported four chunks "missing" from a deploy, and minutes later the same probe returned **503**
for every path and served the literal body `DNS resolution failure` for `_redirects`. The evidence was
the proxy's, not the origin's, and a conclusion had already been half-drawn from it.
**So: a negative result from here is not evidence.** Re-run it several times, check
`curl -sS "$HTTPS_PROXY/__agentproxy/status"`, and treat a real device's screenshot as the only
trustworthy observation of production.

**Both halves deploy on push.** Web via Cloudflare Pages; API via the Cloud Build trigger
`deploy-api-on-push`, which tests, builds, deploys and health-checks. **GitHub Actions does not
run on this repo at all** — `.github/workflows/ci.yml` looks authoritative and executes nothing
(debt D24). `cloudbuild.deploy.yaml` is the real pipeline, and editing it requires pushing the new
copy to the trigger — which needs a delete-and-recreate, not an update (debt D25).
**A doc-only commit deliberately deploys nothing**, so do not read a skipped build as a broken
pipeline. See [README.md](README.md) § Deploying.

What M1 added, so you do not go looking for it: `documents`, `document_files`, `reminders`,
`push_subscriptions`, `idempotency_keys`; full-text search; presigned R2 upload/download with
versioning; Web Push; three pg-boss handlers; cursor pagination; `Idempotency-Key`. Then, from the
design handoffs: `identifier` (ADR-0026/0027), `holder` + `relation` with
`GET /api/v1/documents/holders`, and the three device-scoped **Feel** preferences on You — density,
heading face, and a two-register **voice** (`lib/feel.ts`, `lib/voice.ts`; design.md §12). Then
ADR-0028's `POST /api/v1/maintenance::run-daily` — the only endpoint with no session, and the only one
whose credential is a header rather than a cookie.

What **M4 step 1** added on top: `things`, `thing_services`, `thing_photos` with their own full-text
search and presign contract, `GET /api/v1/things/holders`, a service log whose `service_due_on` the
server recomputes, and **the foreign key on `documents.thing_id`** — `on delete set null`, because
deleting a car must not shred its paperwork. That constraint is why a document can no longer be linked
to a made-up uuid, which is what `documents.test.ts` used to do.

**The offline read cache from [ADR-0013](docs/decisions/0013-read-only-offline-v1.md) is built** —
pulled ahead of M1's "done when" by an explicit product call, so the app can be iterated on without
provisioning R2 or VAPID. The Query cache persists to IndexedDB via `apps/web/src/lib/persister.ts`;
there is still deliberately **no `runtimeCaching` for the API** in the service worker, because two
caches of Tier 0 data would mean two purge paths. Four things about it are easy to undo by accident:
`mutations.networkMode: 'always'` (without it TanStack Query pauses and silently replays offline
writes, bypassing the outbox entirely), `shouldDehydrateMutation: () => false`, the
sign-out/sign-in purge in `apps/web/src/lib/session.ts`, and **`RestoreGate` in
`apps/web/src/App.tsx`**.

**That last one was broken for the whole life of the feature, and the cache bought nothing (D49,
fixed 2026-07-30).** `PersistQueryClientProvider` does *not* restore before rendering children — it
renders them at once and restores in a `useEffect` — so the router started loading first and
`_authed`'s `ensureQueryData(['me'])` saw an empty cache **every launch**. Online, every cold start
waited on the API behind a blank page (`/health` measured at **8825ms cold vs 22ms warm**, D50);
offline the guard awaited a *paused* fetch that never settles, so the app rendered **nothing at all**
rather than the cached archive. Two rules follow, and neither is optional:
**a query a route guard `await`s must be `networkMode: 'offlineFirst'`** (`features/spaces/useMe.ts`
— the global `'online'` default is right for components and fatal here), and **anything reading the
persisted cache must render below `RestoreGate`**. `apps/web/src/lib/startup.test.tsx` fails if either
regresses. Note what did *not* catch this: `offline.test.ts` asserted `me` was on the persist
allowlist and passed throughout — being in the cache file and reaching the guard in time are
different claims.

**Offline WRITES exist too, via an outbox** ([ADR-0024](docs/decisions/0024-offline-writes-outbox.md),
superseding 0013's read-only stance). Edits and captures queue in IndexedDB and replay on reconnect;
a stale write is refused with **409** and surfaced at `/outbox` for the user to decide, never merged.
**`DELETE` carries a `?version=` precondition too** (D41, closed) — a stale delete is refused with 409
rather than destroying a newer edit. It is still **not queued offline**, but that is now a product
choice rather than a safety gap: a delete that sits queued for hours and then conflicts is confusing,
and unlike an edit there is nothing to re-apply.

That has two consequences in the UI, and both are easy to break by writing the obvious code:
**`useCreateDocument` and `useUpdateDocument` can return `{ queued: true }` instead of a document**, so
every caller has to branch (`CaptureSheet.tsx`'s saved step does — there is no id to
navigate to yet, so it drops the two actions that need one); and **an edit must send the `version` the
form was populated from**, not a fresh read,
or the precondition it exists to enforce is defeated.

**The whole web client now wears the Ledger design system
([ADR-0025](docs/decisions/0025-ledger-design-system.md), 2026-07-29)** — warm paper light + dark at
parity, Newsreader + IBM Plex self-hosted, and colour spent *only* on expiry status. **The practical
rules live in [conventions/design.md](docs/conventions/design.md)** — read that before touching
anything visual; the ADR is there for *why*. Six things will bite a session that reads neither:

1. **`cn()` must be told about every new `--text-*`, `--radius-*` or `--spacing-*` token**
   (`apps/web/src/lib/utils.ts`). `tailwind-merge` cannot tell a colour from a size, and getting this
   wrong shipped a button rendering **ink on ink** with perfectly correct markup. `utils.test.ts`
   walks the lists.
2. **The expiry ladder is five states that each change shape, words, weight AND case**
   (`ExpiryStatus.tsx`). Colour is the fourth wheel — the ladder must stay readable in greyscale.
3. **45 days is the expiry threshold in the client**, and it decides a glyph and a sentence. Cover's is
   **60** and a service's is 45 ([design.md §2a](docs/conventions/design.md)) — three numbers, two
   ladders, each named beside the ladder that reads it. Reminders still fire at 90/30/7 server-side;
   all of them are allowed to disagree with it.
4. **Three tabs, forever — Now · Documents · You.** ADR-0025 §4 reversed the old one-tab-per-domain
   plan; the second design handoff then replaced **Add** with **You**, because a tab is a *place* and Add
   was a sheet. Add lives in the Now header and as the one emphatic pill on each collection. **The domain
   switcher now exists**, because domain two does: `components/DomainSwitcher.tsx` draws
   `Documents` / `Things` as segmented pills beneath the title. It is pills rather than ADR-0025's
   mocked `Documents ⌄` dropdown — a menu to choose between two things is a tap to reveal what fits on
   screen — and **domain four is the trigger to revisit that**, when a pill row stops fitting 390px.
5. **A screen whose content can be short needs `flex-1` and a footer with `mt-auto`.** The shell is
   `min-h-dvh`, so without it a sparse archive leaves a screen of dead space above the tab bar —
   reported from a real phone, invisible to every twelve-document fixture.
6. **A document can be filed for somebody else** — `holder` + `relation`, on the row, the detail
   screen, a *Whose* filter and a picker in the form. **It is a label, not a permission**, and `null`
   means "mine" and is drawn as *absence*: no "Me" badge anywhere. See
   [documents.md](docs/domains/documents.md) §4 rule 13 before touching any of it. Two of its bugs were
   found only by rendering the edit screen — the same class as D43, again.

**A FOURTH design handoff landed on 2026-07-30, and it is the authoritative one now.** It brought a
whole second domain and rewrote capture. Three things follow, and the first one will look like a bug if
you don't know it:

- **THINGS IS NOW WHOLE — the server half landed 2026-07-30, and the note that used to be here said the
  opposite.** [ADR-0029](docs/decisions/0029-the-things-domain.md) pulled M4's Assets forward as
  **Things** — the physical objects a household owns, which *own the paperwork proving them* — and
  shipped the client first. M4 step 1 built `things`, `thing_services`, `thing_photos`, the repository,
  two services and every endpoint in [things.md](docs/domains/things.md) §5, implementing
  `packages/shared/src/things.ts` **unchanged** (invariant 9). `useThings` no longer 404s.
  **`apps/api/src/db/scoped.ts` was not touched**, which is the ADR-0006 promise ADR-0029 said this
  domain would measure. Two things are still off: **§9(2) is unanswered so nothing creates a thing
  reminder** (the capability is built, the switch is not — things.md §6, debt D58), and **Things writes
  do not use the offline outbox yet**. things.md §10 lists every file and what is left.
- **COVER IS NOT EXPIRY, and that is the one design rule most likely to be broken by accident.** A
  passport that expires is *invalid*; a dishwasher whose warranty ends **keeps washing dishes**. So
  there is a second status ladder — four states, a proportional depleting **bar** rather than the
  expiry gauge's three discrete bars, and a **60-day** boundary where the expiry ladder's is 45.
  `ended` states a date and never says "Expired", never pulses. `features/things/CoverStatus.tsx`,
  [design.md §2a](docs/conventions/design.md). Two ladders is the whole inventory; a third is a smell.
- **CAPTURE IS A SIX-STEP WIZARD NOW**, on two tracks
  ([ADR-0030](docs/decisions/0030-capture-as-a-stepped-wizard.md)) — the single-page form with its
  *"Add more now"* disclosure is gone. **Q2 is unchanged and this is the trap**: exactly one field is
  required per track (`title` for a document, the lead field for a thing), and every other step draws a
  visible *Skip for now*. Adding a guard to a step because a blank one looks unfinished turns six
  invitations into six required fields, which is what the ADR exists to prevent.

Two smaller things the same handoff changed: the tab bar is **still three tabs** — Things arrived as
the switcher ADR-0025 §4 promised, even though the comp's own default knob says fourth tab — and a
**vehicle registration is two live formats**, so `Vehicle RC` no longer masks to `AA##AA####` (that
made a Bharat-series plate `22 BH 1234 AA` untypeable). The series is an explicit choice and the
digit-count hint drops for it, because two formats have no single length.

What still does **not** exist: OCR and previews (M2), offline *download* of files, password reset,
Playwright, R2 object deletion, and **any way for a user to undo a delete** (soft-delete sets
`deleted_at`, but there is no restore endpoint — so no "Undo" and no "recoverable for 30 days" copy;
ADR-0025 § Open items). **`ENABLE_SCHEDULED_JOBS` is off**, so
the reminder scan is registered and manually triggerable but has never run unattended. Several of
these look like missing conventions rather than deferred work — they are in the
[debt register](docs/product/review.md#3-debt-register) as D1–D59 with triggers, so check there
before "fixing" one. **D54 and D55 are the two newest and both are traps for a fresh session:**
the web and API deploy on separate triggers, so a response field added to the client must never be
*required* of the server (it took the archive down once); and `lib/outbox.test.ts` is **flaky**, so
do not accept anyone's description of a failure in it as expected.

## Start here — next actions

**What is missing is credentials and use, not code.** Run `./scripts/provision.sh <r2|vapid|neon>` —
it prompts, so no secret reaches a transcript. Full list in [roadmap.md](docs/roadmap.md) § Next
actions §4. In order: provision R2 (**and its bucket CORS policy**, README § Provisioning R2 — the
browser PUTs straight to R2, so without it every upload fails while the API looks healthy) · provision
VAPID · ~~rotate the Neon credential (D18)~~ **done 2026-07-30** · put real documents in · switch
`ENABLE_SCHEDULED_JOBS=true` (this fires D8) · redo lens 4 of the M1 review.

**To iterate without any cloud account:** `docker compose -f docker-compose.dev.yml up -d` gives a
local S3, so the whole upload path runs. It does **not** validate signatures (D39), so it cannot
verify the presign contract.

Four things worth knowing before you touch anything:

1. **Check the skip count, every time.** `pnpm test` **skips** the database-backed suites without
   Docker or `TEST_DATABASE_URL`, and M0 reported "40 tests pass" from a machine where 17 never ran.
   **674/0 is the target; 477 passed / 197 skipped is what a container with no database shows you** —
   every one of the 197 is the API's, and most of the 477 that do run are web tests needing no
   database. Cheaper than trusting a green deploy: start the local Postgres 16 as described under
   Status and run it properly.
2. **A `:verb` in a route pattern needs `::`, and may only follow a static segment.** Both halves of
   that were found by measurement and both fail silently in the too-permissive direction —
   [conventions/api.md](docs/conventions/api.md) §2 and the block comment in `documents.routes.ts`.
3. **When you assert a count, assert a non-zero one.** `file_count` was 0 for all of M1 because
   every test happened to expect 0 (debt D33). The browser found it; the suite could not. **It paid
   off immediately on Things:** a `document_count` test that drove the number to 2, 1 and 2-in-another-
   space caught a missing `space_id` predicate that let another space inflate the count — while the
   nested `documents` list beside it was correct all along.
4. **Q1 → expiry-only reminders; Q2 → title-only capture.** Both are decisions, not defaults
   ([open-questions.md](docs/product/open-questions.md) §2). Do not add a required field or a
   review-date column without re-answering them.

---

## Doing X? Read Y.

| Task | Read |
|---|---|
| Anything touching **auth, ownership, or crypto** | [`docs/security-model.md`](docs/security-model.md) **in full**, first |
| **Anything in the THINGS domain** — a warranty, a serial, a service date, an owned object | [`domains/things.md`](docs/domains/things.md) then [`ADR-0029`](docs/decisions/0029-the-things-domain.md). **Both halves are built now** (things.md §10 lists every file). Three traps: a **serial** is plaintext and derives `serial_last4` server-side, so it is in `REDACTED_PATHS` and no copy may call it encrypted; the **ownership triple** moves together and returning to `here` clears the other two in one statement; and **nothing creates a thing reminder** because §9(2) is unanswered — an empty `reminders[]` is correct, not a bug |
| **Showing a warranty or a service date anywhere** | [`conventions/design.md`](docs/conventions/design.md) §2a — the **cover ladder**, four states. **Cover is NOT expiry**: a lapsed warranty still washes dishes, so it never borrows `ExpiryStatus`'s gauge, never says "Expired", and never pulses. Its boundary is 60 days where the expiry ladder's is 45 |
| **Touching capture / the Add sheet** | [`ADR-0030`](docs/decisions/0030-capture-as-a-stepped-wizard.md) — six steps, two tracks. **Q2 survives it: exactly one field is required per track and every other step draws a visible *Skip for now*.** Adding a validation guard to a step because a blank one looks unfinished is the regression this ADR exists to prevent |
| **Adding a route with a `:verb` action** | [`docs/conventions/api.md`](docs/conventions/api.md) §2 — the `::` escape, and why a colon may not follow a parameter |
| **Anything visual — a screen, a component, a colour, a size** | [`conventions/design.md`](docs/conventions/design.md) — the practical rules; [`ADR-0025`](docs/decisions/0025-ledger-design-system.md) for why they exist. Four bugs in this design's own implementation were found *only by rendering it* — **look at it at 390px, in both themes, before calling it done** (debt D37, D43) |
| **Seeing the ORIGINAL comp** — what a screen was drawn as, before the code | [`docs/design/`](docs/design/README.md) — the three Claude Design handoff bundles the system was built from. Handoff 3 is authoritative. **Read the source, don't render it** (the comps link the Google Fonts CDN we deliberately don't; the design.md rules are the faithful translation) |
| **A headline's FACE, screen DENSITY, or the app's VOICE/copy** | [`conventions/design.md`](docs/conventions/design.md) §12 — the three device-scoped Feel preferences. `lib/feel.ts` + `useFeel.tsx` (density/face as `data-*`, never inline `style`), `lib/voice.ts` (two copy registers, walked by `voice.test.ts` — plain never says LESS than warm). **Every headline uses `font-heading`, not `font-serif`**, or it opts out of the face preference |
| **Adding a screen, or touching layout** | `apps/web/src/components/TabBar.tsx` (three tabs, forever — ADR-0025 §4) and the `@layer base` block in `apps/web/src/styles.css` — the app-shell rules, each annotated with the web-page tell it removes |
| **Anything touching a document's NUMBER** | [`ADR-0026`](docs/decisions/0026-store-the-full-identifier.md) then [`ADR-0027`](docs/decisions/0027-identifier-in-the-list-response.md) — the full value is stored **plaintext** and returned on **every** document response, list included (0027 reversed 0026's detail-only rule). `identifier_last4` is DERIVED, never sent by a client. Reveal is a display state, **not** an authorization boundary. The cache now holds every number on the device — debt **D47** |
| **Anything touching `holder` — the people picker, the Whose filter, the row pill** | [`documents.md`](docs/domains/documents.md) §4 rule 13. **A holder is a LABEL, never a permission** — `space_id` is still the only thing deciding who can read a document. `null` is "mine" and is drawn as *absence*, so there is no "Me" badge on a row. `relation` cannot outlive `holder` (one helper writes both). The `?holder=` filter's "mine" is the literal sentinel `HOLDER_MINE`, not `''`. And in `DocumentForm` the name fields' openness is **derived, not stored** — storing it lit two chips at once |
| **Showing an expiry date anywhere** | `apps/web/src/features/documents/ExpiryStatus.tsx` — the five-state ladder. Never hand-roll a second one, and never put a business rule in it: the 45-day boundary is display only |
| **Adding or changing a FIELD on any cached response** | [`lib/persister.ts`](apps/web/src/lib/persister.ts)'s buster note and debt **D46** — the persisted cache is **rehydrated without re-running Zod**, so the first render after a deploy can hand a component last week's shape. A field the schema says is `string \| null` arrives `undefined`. This crashed the app at its root error boundary on a real phone |
| **A stale client, a chunk that no longer exists, or that Reload button** | [`lib/recovery.ts`](apps/web/src/lib/recovery.ts) and debt **D56/D57**. A deploy changes every hashed chunk name, so a client holding an old `index.html` asks for a chunk that is gone — and because the origin's SPA fallback is `/* /index.html 200`, it gets **HTML at 200**, which a module script cannot execute. `installStaleChunkRecovery()` recovers once per session; the error boundary's Reload runs the same hard recovery, because a bare `location.reload()` provably cannot escape (the worker re-serves the same stale document). **A client already stale when this shipped is not rescued by it** — that needs site data cleared by hand |
| **Anything touching caching, offline, or a new `useQuery` key** | [`ADR-0024`](docs/decisions/0024-offline-writes-outbox.md) (which supersedes 0013) then `apps/web/src/lib/persister.ts` — the persist allowlist is opt-in, so a new query key is NOT cached until you add it. Then `apps/web/src/App.tsx`: the cache is only restored *before* the router because `RestoreGate` holds it there (D49), and a query awaited by a route guard needs `networkMode: 'offlineFirst'` or it hangs forever offline |
| **Calling a document mutation from a new place** | `useDocuments.ts` — `useCreateDocument` and `useUpdateDocument` may return `{ queued: true }` rather than a document (ADR-0024), so every call site branches; an edit must send the version the form was **read** at |
| **Adding a mutable column or a new writable domain** | `versioned()` in `apps/api/src/db/columns.ts` — an editable table needs the ADR-0024 version column, and its `PATCH` must take the version as a **required** field so a forgotten precondition is a type error rather than silent last-write-wins |
| **Anything touching the daily scan, reminders firing, or that `maintenance` endpoint** | [`ADR-0028`](docs/decisions/0028-external-trigger-for-the-daily-scan.md) — pg-boss keeps the queue and loses the clock. The trigger must call **`runRemindersInline()`, not `scanReminders()`**: a queued job on a scale-to-zero instance never drains. `CRON_SECRET` unset ⇒ **503, not 200** — closed is the only safe default for something that writes `sent_at`. The advisory lock is what stops a scheduler retry double-sending |
| Working on **Documents** | [`docs/domains/documents.md`](docs/domains/documents.md) |
| **The tab bar, or where a domain lives** | Still **three tabs** — `TabBar.tsx` is unchanged. Domain two arrived as the **switcher** ADR-0025 §4 promised (`components/DomainSwitcher.tsx`), not a fourth tab. The comp draws both and defaults to the tab; [`ADR-0029`](docs/decisions/0029-the-things-domain.md) § *Alternatives* is why we didn't |
| **Adding an endpoint** | [`docs/agent-playbooks/add-an-endpoint.md`](docs/agent-playbooks/add-an-endpoint.md) |
| **Adding a domain** | [`docs/agent-playbooks/add-a-domain.md`](docs/agent-playbooks/add-a-domain.md) |
| **Changing the schema** | [`docs/agent-playbooks/change-the-schema.md`](docs/agent-playbooks/change-the-schema.md) |
| **Deciding what to build, or shaping a technical call** | [`docs/product/brain.md`](docs/product/brain.md) — the project brain |
| **Reviewing a finished milestone** | [`docs/product/review.md`](docs/product/review.md) |
| **"Why is it like this?"** | [`docs/decisions/index.md`](docs/decisions/index.md) |
| **Running it locally for the first time** | [`README.md`](README.md) § Getting started |
| **"Is this missing, or deferred?"** | [debt register](docs/product/review.md#3-debt-register) — D1–D59, each with a trigger. D24/D25 are traps, not gaps. D32/D33 are the two M1 bugs most likely to recur. D50/D51 explain a slow launch — measure before re-diagnosing. **D53 before touching `scripts/provision.*`** |
| Anything else | [`docs/README.md`](docs/README.md) routing table |

**Baseline is three files: this one, the routing table, and the one doc your task names.**
There is more documentation than any single session should read — route to it, don't sweep
it ([read budget](docs/README.md#read-budget)).

---

## Invariants

Non-negotiable. Breaking one is a bug even if tests pass. Each links to its reasoning.

1. **Only `apps/api` touches Postgres or R2.** No client, build step, or script outside it
   holds a database URL or storage credential.
   ([ADR-0002](docs/decisions/0002-api-first-decoupling.md))
2. **Records belong to a *space*, never a user.** Every domain table carries `space_id`.
   ([ADR-0006](docs/decisions/0006-space-based-ownership.md))
3. **Every repository function takes `actor: ActorContext` first** and filters
   `space_id IN actor.spaceIds` and `deleted_at IS NULL`.
   ([conventions/code.md](docs/conventions/code.md) §2)
4. **Cross-space access returns 404, never 403.** A 403 confirms the record exists.
   ([conventions/api.md](docs/conventions/api.md) §3)
5. **No business logic in a client.** Client validation is UX only; the server is
   authoritative. A rule only in the web app does not exist — Android won't have it.
6. **The API chooses every storage object key.** Clients never supply one.
   ([ADR-0008](docs/decisions/0008-object-storage-r2.md))
7. **No application-level encryption of ordinary data.** Encryption is vault-only, and that
   is what keeps OCR, search, and reminders possible. **This still holds after
   [ADR-0026](docs/decisions/0026-store-the-full-identifier.md)**, which stores full document
   identifiers — in *plaintext*. No copy in the app may say "encrypted" (debt D44).
   ([ADR-0009](docs/decisions/0009-sensitivity-tiers.md))
8. **Never hand-roll crypto.** Fixed primitives in
   [security-model.md](docs/security-model.md) §5.
9. **Zod schemas in `packages/shared` are the only contract source.** Never hand-write a
   type that mirrors a schema. ([ADR-0004](docs/decisions/0004-zod-single-contract-source.md))
10. **Never weaken a test to get a green build.**
    ([conventions/testing.md](docs/conventions/testing.md) §5)
11. **No secrets in the repo.** Not in code, docs, commit messages, or `.env` files.
12. **The AI proposes; the human decides product scope.** Nothing reaches the roadmap
    without an explicit yes. ([ADR-0017](docs/decisions/0017-product-brain.md))

---

## Stack (installed — versions are what `pnpm install` actually resolved)

| Layer | Choice | Version | ADR |
|---|---|---|---|
| Runtime | Node.js | **22.15** (`.node-version`, `engines`) | — |
| Package manager | pnpm | **11.17** (`packageManager`) | [0001](docs/decisions/0001-typescript-monorepo.md) |
| Language | TypeScript `strict` + `noUncheckedIndexedAccess` | **7.0** (Go-native `tsgo`) | [0001](docs/decisions/0001-typescript-monorepo.md) |
| Monorepo | pnpm workspaces + Turborepo | turbo 2.10 | [0001](docs/decisions/0001-typescript-monorepo.md) |
| Contract | Zod | **4.4** | [0004](docs/decisions/0004-zod-single-contract-source.md) |
| Web | Vite + React SPA, PWA via `vite-plugin-pwa` | vite 8.1 · react 19.2 · pwa 1.3 | [0003](docs/decisions/0003-vite-spa-pwa-over-nextjs.md) |
| Routing / data | TanStack Router + TanStack Query | router 1.170 · query 5.101 | [0003](docs/decisions/0003-vite-spa-pwa-over-nextjs.md) |
| UI | Tailwind v4 + shadcn/ui primitives, wearing the **Ledger** design system | tailwind 4.3 | [0003](docs/decisions/0003-vite-spa-pwa-over-nextjs.md) · [0024](docs/decisions/0025-ledger-design-system.md) |
| Type | Newsreader (serif) + IBM Plex Sans/Mono, **self-hosted** — not the Google CDN, which breaks offline | `@fontsource*`, OFL-1.1, latin only | [0024](docs/decisions/0025-ledger-design-system.md) |
| API | Fastify + `fastify-type-provider-zod` → OpenAPI 3.1 | fastify 5.10 · provider 7.0 | [0004](docs/decisions/0004-zod-single-contract-source.md) |
| Database | Postgres 18 on Neon | 18.4 | [0005](docs/decisions/0005-postgres-neon-drizzle.md) |
| ORM | Drizzle + drizzle-kit | 0.45 / 0.31 | [0005](docs/decisions/0005-postgres-neon-drizzle.md) |
| Auth | Better Auth, self-hosted in our Postgres | 1.6 | [0007](docs/decisions/0007-better-auth-self-hosted.md) |
| Files | Cloudflare R2, private, presigned URLs | `@aws-sdk/client-s3` 3.1096 · **bucket not provisioned** | [0008](docs/decisions/0008-object-storage-r2.md) |
| Jobs | pg-boss on the same Postgres — no Redis | 12.26 · 3 handlers · **schedules OFF** | [0012](docs/decisions/0012-pg-boss-background-jobs.md) |
| Tests | Vitest (real Postgres) + MSW; Playwright **still not installed** (D35) | vitest 4.1 · msw 2.15 | [0016](docs/decisions/0016-testing-and-tooling.md) · [0018](docs/decisions/0018-testcontainers-for-api-tests.md) |
| Web Push | `webpush-webcrypto` — **not `web-push`, which is MPL-2.0** | 1.0.5 (MIT, zero deps) | — |
| Lint/format | Biome | 2.5 | [0016](docs/decisions/0016-testing-and-tooling.md) |
| Hosting | Cloudflare Pages · **Cloud Run** · Neon · R2 | **deployed** 2026-07-27; R2 not yet used | [0021](docs/decisions/0021-cloud-run-for-the-api.md) · [0019](docs/decisions/0019-same-site-subdomain-deployment.md) |

**Version couplings — bumping one of these forces the others:**
`@vitejs/plugin-react@6` peer-requires `vite@^8` exactly · `fastify-type-provider-zod@7` needs
`zod >=4.2` **and** `@fastify/swagger >=9.5.1` · `@better-auth/drizzle-adapter` peer-requires
`drizzle-orm ^0.45.2`, and `better-auth` itself sets the Zod floor · Vitest 4 dropped
`vitest.workspace.ts` for `test.projects` · Turbo 2 renamed `pipeline` to `tasks` · Tailwind 4 has
no `tailwind.config.js` · pnpm 11 reads settings from `pnpm-workspace.yaml`, **not** `.npmrc`.

**Before proposing a stack change, read [`docs/decisions/index.md`](docs/decisions/index.md)
— the alternative was probably already considered and rejected for a reason that still
holds.** Notably: Next.js, Supabase, Prisma, Redis, tRPC, GraphQL, and offline-first sync
were each evaluated and declined.

---

## Layout

```
apps/web/          Vite React SPA (PWA) — the first client
  src/routes/        TanStack Router file routes. `_authed.tsx` guards everything under it
  src/features/      One folder per domain: components, hooks, forms
  src/components/ui/ shadcn-style primitives
  src/lib/           api.ts (the ONE typed client), auth-client, query-client, api-origin
apps/api/          Fastify — the ONLY thing that touches Postgres and R2
  src/domains/<d>/   <d>.routes.ts → <d>.service.ts → <d>.repository.ts, + <d>.test.ts
  src/db/            client, columns, schema/, migrate, seed, and scoped.ts — THE tenant filter
  src/auth/          Better Auth setup, the actor hook, ActorContext
  src/jobs/          pg-boss lifecycle; registerJobs() is empty until M1
  src/lib/           env, logger, errors, problem+json, openapi, security plugin
  src/test/          global-setup, per-file setup, factories, describeDb
  drizzle/           committed migration SQL
packages/shared/   Zod schemas + inferred types, imported by both
docs/              See docs/README.md
```

**Two files are worth reading before touching anything space-scoped:**
`apps/api/src/db/scoped.ts` (the only place the tenant filter is written) and
`apps/api/src/db/schema/scoped-columns.ts` (the columns and index every domain table gets).

**Domain tables live in their domain folder**, not in `db/schema/` — `documents.schema.ts` sits
beside the repository that queries it, per [add-a-domain.md](docs/agent-playbooks/add-a-domain.md) §3.
`db/schema/index.ts` is the single barrel `drizzle.config.ts` and `db/client.ts` read, so **a table
not re-exported there does not exist** as far as migrations are concerned.

---

## Conventions

**Real now.** [`docs/conventions/`](docs/conventions/) describes them; these enforce them:

| Enforced by | What |
|---|---|
| `biome.json` | Format + lint. `pnpm lint`, `pnpm format`. `no-explicit-any`, `noNonNullAssertion`, `noFloatingPromises` are **errors** |
| `tsconfig.base.json` | `strict` + `noUncheckedIndexedAccess`, monorepo-wide |
| `turbo.json` | `pnpm typecheck`, `pnpm build` — ordered so `packages/shared` builds first |
| `vitest.config.ts` (root) | `pnpm test` runs all three packages |
| `apps/web/src/lib/utils.test.ts` | The design system's token/`cn()` coupling — a new `--text-*` or `--radius-*` token not declared in `utils.ts` fails here rather than shipping an invisible button ([conventions/design.md](docs/conventions/design.md) §1) |
| `cloudbuild.deploy.yaml` | typecheck → lint → test → build → deploy on push, no secrets. **The real pipeline.** `.github/workflows/ci.yml` describes the same steps and enforces *nothing* — Actions never runs here (debt D24) |

Two traps worth knowing before you edit tooling config:

- **`biome.json` must not contain comments.** Biome silently falls back to its defaults when it
  cannot deserialise the config, so one `//` turns into every file failing `format` with nothing
  naming the cause.
- **`pnpm` settings live in `pnpm-workspace.yaml`**, not `.npmrc`. Install scripts are blocked by
  default and allowlisted there.

Database-backed tests need Docker or `TEST_DATABASE_URL`; with neither they **skip, not fail**
([ADR-0018](docs/decisions/0018-testcontainers-for-api-tests.md)) — so a green `pnpm test` does not
by itself mean the API was tested. Check the skip count.

---

## Working agreements

- **One domain at a time.** Finish and actually use it before starting the next. Six
  shallow domains are worth less than one good one
  ([product/brain.md](docs/product/brain.md) §5).
- **Pre-v1, the dev database may be reset rather than migrated** — until M3
  ([ADR-0011](docs/decisions/0011-pre-v1-schema-resets.md)).
- **Multi-user isolation is a day-one requirement**, even with one user
  ([ADR-0006](docs/decisions/0006-space-based-ownership.md)).
- **A new architectural decision gets an ADR** under `docs/decisions/`. A commit message or
  chat reply is not visible to the next session.
- **A new product idea goes in [the backlog](docs/product/idea-backlog.md)** with a status,
  including if it's rejected — with the reason.
- **A change that alters an invariant updates the docs in the same commit.**
- **Docs use the [glossary's](docs/glossary.md) words.** Say *space*, not tenant or org.
