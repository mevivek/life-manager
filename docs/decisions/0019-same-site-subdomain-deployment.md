# ADR-0019: One domain, two subdomains — `app.mevivek.dev` and `api.mevivek.dev`

- **Status:** accepted
- **Date:** 2026-07-27
- **Amended:** 2026-07-27 — **`COOKIE_DOMAIN` and `crossSubDomainCookies` are NOT required, and
  are now deliberately unset.** Written before the design had ever run; verified the same day over
  a real Cloudflare Tunnel on the actual hostnames, which showed the cookie works host-only. Also
  corrects how `Secure` is decided. The core decision — two subdomains of one registrable domain
  — is unchanged and confirmed, so this is an amendment rather than a supersession. Details in
  the Decision section below.
- **Supersedes:** —
- **Superseded by:** —

## Context

Two accepted decisions interact in a way neither of them noticed, and the collision breaks login
on a phone.

- [security-model.md](../security-model.md) §2 mandates the web session cookie be
  `httpOnly; Secure; SameSite=Lax`. The rationale is explicit and good: `httpOnly` means an XSS
  bug cannot exfiltrate the session.
- [ADR-0014](0014-hosting-topology.md) puts the web app on Cloudflare Pages and the API on
  Fly.io — two different providers, and by default two different hostnames.

On the default hostnames (`something.pages.dev` and `something.fly.dev`) those are different
**sites**, not merely different origins. A `SameSite=Lax` cookie is not sent on a cross-site
subresource request, so the browser silently omits the session on every API call. The symptom is
that sign-in appears to succeed and the next request is a 401 — no error, nothing in the console,
and it is indistinguishable from a server bug.

Locally none of this shows up: `localhost:5173` → `localhost:8080` is same-site, and the Vite dev
proxy makes it same-origin anyway. So this fails **only** in production, which is the worst place
to discover it.

The maintainer owns `mevivek.dev`.

## Decision

**The web app is served from `app.mevivek.dev` and the API from `api.mevivek.dev`.**

Subdomains of one registrable domain are the **same site**, so `SameSite=Lax` is satisfied and
`security-model.md` §2 stands unchanged.

### What is actually required — corrected against a live test

The original version of this ADR listed three required settings, one of which was wrong. Verified
on 2026-07-27 over a Cloudflare Tunnel serving the real `app.mevivek.dev` and `api.mevivek.dev`:

| Where | Setting | |
|---|---|---|
| `auth.ts` | `defaultCookieAttributes: { httpOnly: true, sameSite: 'lax', path: '/' }` | required |
| `auth.ts` | `useSecureCookies` derived from `API_BASE_URL`'s scheme | required |
| `apps/api` env | `COOKIE_DOMAIN` / `crossSubDomainCookies` | **NOT required — leave unset** |

**Why `COOKIE_DOMAIN` is not needed.** `SameSite` is defined in terms of *site* — the registrable
domain — not the host. A host-only cookie set by `api.mevivek.dev` is therefore sent on a
`fetch` initiated by `app.mevivek.dev`, because that request is same-site. Confirmed: signup
returned `__Secure-better-auth.session_token; HttpOnly; Secure; SameSite=Lax` with **no `Domain`
attribute**, and `GET /api/v1/me` from the app origin succeeded.

`crossSubDomainCookies` exists for a different problem — making one session cookie *readable* by
several subdomains, which matters when more than one host needs to inspect it. Here only the API
ever reads it, so widening it buys nothing and costs real isolation: `Domain=.mevivek.dev` would
send the session cookie to **every** subdomain of the domain, including the maintainer's personal
site and an unrelated `homeassistant` tunnel. Narrower is both simpler and safer.

**Why `Secure` is keyed off the URL scheme, not `NODE_ENV`.** The two disagree in exactly the
case that matters — running the real HTTPS shape while still `NODE_ENV=development`, which is what
tunnel-based verification is. The original `useSecureCookies: isProduction` would have silently
dropped `Secure` during that test, so the thing verified would not have been the thing that ships.
Deriving it from `new URL(env.API_BASE_URL).protocol === 'https:'` makes the flag follow reality.

They are still different **origins**, so CORS is still required: `@fastify/cors` with
`credentials: true` and `origin: env.WEB_ORIGIN` — exact origins, never `*`, because every
browser rejects a wildcard origin combined with credentials. The web client sends
`credentials: 'include'` on every request. `WEB_ORIGIN` is a comma-separated **list** so the
deployed app and `localhost:5173` can both be trusted; with a single value, pointing the API at a
deployed hostname makes local development fail with a 403 from the origin check, which reads like
a bug rather than a configuration choice.

## Alternatives considered

- **`SameSite=None; Secure; Partitioned` on the default `pages.dev` / `fly.dev` hostnames.**
  Requires no domain and no DNS. Rejected: it directly contradicts
  [security-model.md](../security-model.md) §2, and it puts the session on the wrong side of
  ongoing browser third-party-cookie changes — a cookie whose delivery depends on the current
  state of third-party cookie deprecation is not something to build a session on. `Partitioned`
  would also isolate storage per top-level site, which is precisely the wrong shape here.
- **Bearer tokens in the web app instead of a cookie.** The API already supports it (the Better
  Auth `bearer` plugin is enabled for native clients). Rejected for the web client: a token the
  JavaScript can read is a token an XSS bug can exfiltrate, which is the exact threat §2's
  `httpOnly` choice exists to remove. Native clients are a different case — there is no XSS
  surface and no cookie jar worth fighting.
- **Proxying `/api` through a Cloudflare Worker or Pages Function on the app's own origin.**
  Genuinely works, and makes everything same-origin so cookies stop being a question at all.
  Rejected because it adds a third deploy target and a network hop in front of every request, to
  solve a problem that a DNS record already solves once you own a domain. Worth reconsidering
  only if the domain were ever lost.
- **Serving the web app from Fly too, same origin as the API.** Same-origin, one deploy target,
  no CORS. Rejected: it throws away Cloudflare's free global CDN for static assets, puts static
  file serving on the one component that is billed for uptime, and undoes
  [ADR-0014](0014-hosting-topology.md)'s cost argument. It also weakens
  [ADR-0002](0002-api-first-decoupling.md)'s separation, which exists so that a native client is
  plug-and-play.
- **A path-based split on one host** (`mevivek.dev/api` → Fly). Same-origin and no cookie
  question. Rejected for the same reason as the Worker proxy: it needs a reverse proxy in front
  of both, which is a component that does not otherwise exist.

## Consequences

**Good:** `security-model.md` §2 is satisfied literally, with no exception and no footnote. The
session is `httpOnly` and `SameSite=Lax` in production exactly as designed. Local development
stays same-origin and therefore free of all of this. Adding a third client later (Android) uses
the bearer transport against the same session store, needing no cookie changes.

**Bad:** M0 cannot be fully verified without DNS. Two DNS records are prerequisites for the
acceptance test, and propagation is a wait, not a command. The `_headers` CSP names
`https://api.mevivek.dev` explicitly in `connect-src`, so a future domain change touches that file
too.

**Verified without hosting.** The acceptance test does *not* require Fly or Cloudflare Pages. A
**Cloudflare Tunnel** pointing both hostnames at `localhost` exercises the identical cookie path —
real HTTPS, real hostnames, real cross-subdomain request — while the laptop is the origin. That is
how this ADR was confirmed, and it is the cheapest way to re-check it after any auth change. See
[README.md](../../README.md) § Serving it on your phone. The limitation is inherent: the tunnel
lives only as long as the laptop is awake, so it verifies the design without being hosting.

**Also:** losing or changing the domain breaks production login. That is a real single point of
failure, and the mitigation is simply knowing it — recorded in the debt register.

**Revisit if:** the domain changes (update `COOKIE_DOMAIN`, `API_BASE_URL`, `WEB_ORIGIN`,
`VITE_API_URL`, and `apps/web/public/_headers` together), or browsers change same-site semantics
for subdomains — which would be a much larger event than this project.
