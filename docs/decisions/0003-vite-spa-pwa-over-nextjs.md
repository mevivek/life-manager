# ADR-0003: Vite + React SPA as a PWA, not Next.js

- **Status:** accepted
- **Date:** 2026-07-26

## Context

The first client is a web app, installable as a PWA, synced across phone and laptop. It sits
entirely behind a login and talks only to the Fastify API
([ADR-0002](0002-api-first-decoupling.md)).

Next.js is the default answer to "build a React app" in 2026, and generally the safer,
better-documented choice. It is worth being explicit about why it is not the choice here.

## Decision

**Vite + React + TypeScript, built as a static SPA**, installable as a PWA via
`vite-plugin-pwa` (Workbox).

- **Routing:** TanStack Router — typed routes and params
- **Server state:** TanStack Query — caching, revalidation, optimistic updates
- **UI:** Tailwind v4 + shadcn/ui (Radix primitives, copied into the repo)
- **Forms:** React Hook Form + Zod resolver, schemas from `packages/shared`

The build output is static files on a CDN. There is no Node process serving the web app.

## Alternatives considered

- **Next.js.** Its principal value is SSR, React Server Components, and server actions.
  Under ADR-0002 all three are *unusable*: the data lives behind an API the browser is
  already authorized to call, and there is no SEO requirement for a private app behind a
  login. So the framework's main features are dead weight — and worse than dead weight,
  because their presence actively invites a future session to "just add a server action"
  or "just query the database from a route handler," quietly breaking the decoupling
  invariant. A static SPA has no server to misuse. Removing the temptation is a feature
  when most changes are made by sessions that haven't read every ADR.

  Secondary costs: a Node runtime to host and pay for rather than free static hosting, and
  a framework with a history of disruptive major-version migrations, each of which a
  future session would have to absorb.

- **TanStack Start.** Philosophically closer, built on TanStack Router and Vite. Rejected
  for the same reason as Next.js — its server capabilities are unused here — plus it is
  younger and less represented in training data. TanStack **Router** on its own gives the
  part that is actually wanted.

- **Remix / React Router framework mode.** Same analysis: a server-rendering framework
  where no server rendering is needed.

- **React Router (library mode) instead of TanStack Router.** The safer pick on training
  data alone, and a legitimate fallback. TanStack Router wins on typed routes and search
  params — route params validated by the same Zod schemas used everywhere else, so a
  malformed link is a compile error rather than a runtime crash — and it pairs naturally
  with TanStack Query, which is already in the stack.

  **Fallback:** if typed routing proves awkward in practice, swapping to React Router is a
  contained change (routing only, no data-layer impact). Record it as a superseding ADR.

- **Vue / Svelte / SolidJS.** All fine frameworks. React wins on training-data density,
  which under [ADR-0001](0001-typescript-monorepo.md)'s reasoning is a first-order
  concern here.

## Consequences

**Good:** No web server to run, secure, or pay for — static files on a global CDN. The web
client is structurally identical to the future mobile clients: an HTTP consumer that cannot
cheat. Fast builds and instant HMR. Service-worker control is direct rather than mediated
by framework conventions, which matters for PWA install and offline behavior
([ADR-0013](0013-read-only-offline-v1.md)).

**Bad:** No SSR, so first paint waits on a JS bundle plus an API round trip — acceptable
behind a login, and mitigated by the PWA app shell. No SEO whatsoever; correct here, but it
forecloses ever making public content pages from this app. More assembly required: routing,
data fetching, and PWA config are chosen and wired rather than provided. Bundle size needs
watching without automatic route-level code splitting.

**Revisit if:** the project ever needs public, indexable pages (a marketing site or shared
public documents). The right answer then is a separate static site, not converting this
app — but it would be worth reconsidering.
