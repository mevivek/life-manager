# ADR-0019: One domain, two subdomains — `app.mevivek.dev` and `api.mevivek.dev`

- **Status:** accepted
- **Date:** 2026-07-27
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
`security-model.md` §2 stands unchanged. Three settings implement it, and all three are required:

| Where | Setting |
|---|---|
| `apps/api` env | `COOKIE_DOMAIN=.mevivek.dev` |
| `auth.ts` | `advanced.crossSubDomainCookies: { enabled: true, domain: env.COOKIE_DOMAIN }` |
| `auth.ts` | `advanced.defaultCookieAttributes: { httpOnly: true, sameSite: 'lax', path: '/' }` |

Without `crossSubDomainCookies` the cookie's `Domain` defaults to the API host alone and is
invisible to the app host. `COOKIE_DOMAIN` is **unset in local development**, where it is not
needed and where a `Domain` attribute on `localhost` is ignored anyway.

They are still different **origins**, so CORS is still required: `@fastify/cors` with
`credentials: true` and `origin: env.WEB_ORIGIN` — an exact origin, never `*`, because every
browser rejects a wildcard origin combined with credentials. The web client sends
`credentials: 'include'` on every request.

`Secure` is on in production only (`useSecureCookies: isProduction`), because it prevents the
cookie being set over plain `http://localhost`.

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

**Bad:** M0 cannot be fully verified without DNS. Two DNS records and a Fly certificate are now
prerequisites for the acceptance test, and certificate issuance plus propagation is a wait, not a
command. `COOKIE_DOMAIN` becomes a variable whose *absence* is meaningful locally and whose
presence is required in production — a configuration asymmetry that is easy to get wrong in one
direction only. The `_headers` CSP now names `https://api.mevivek.dev` explicitly in
`connect-src`, so a future domain change touches that file too.

**Also:** losing or changing the domain breaks production login. That is a real single point of
failure, and the mitigation is simply knowing it — recorded in the debt register.

**Revisit if:** the domain changes (update `COOKIE_DOMAIN`, `API_BASE_URL`, `WEB_ORIGIN`,
`VITE_API_URL`, and `apps/web/public/_headers` together), or browsers change same-site semantics
for subdomains — which would be a much larger event than this project.
