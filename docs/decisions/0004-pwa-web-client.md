# 0004 — PWA web client, offline scope limited to cached reads

## Context

The web app should be installable and usable on mobile devices without building a
native app immediately, while multi-device sync (see project context in
[`CLAUDE.md`](../../CLAUDE.md)) is still handled by the backend.

## Decision

- `apps/web` ships as a PWA: web app manifest + service worker, installable on
  phone/laptop.
- Offline scope for v1 is limited to an app shell and the last-fetched data being
  viewable offline. Writing data while offline and syncing on reconnect is
  explicitly **not** built now.

## Consequences

- Fast to ship, matches "web app first" while still being usable like an app on a
  phone home screen.
- If offline writes are needed later, that's a new ADR (it involves conflict
  resolution, a local write queue, and sync-on-reconnect logic) — don't assume it
  exists until such a doc says so.
