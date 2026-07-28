/**
 * Deployment smoke check. Run it against the DEPLOYED app after any deploy, auth change, or
 * DNS change:
 *
 *     node scripts/verify-deployment.mjs
 *
 * It is not a test suite and does not pretend to be — [ADR-0016](../docs/decisions/0016-testing-and-tooling.md)
 * specifies Playwright for E2E and that is still unwritten (debt D17). This exists because the
 * most valuable checks here **cannot run on localhost at all**: the cross-subdomain session
 * cookie from ADR-0019 needs two real hostnames over real HTTPS, and every attempt to verify it
 * locally passes for the wrong reason (the Vite dev proxy makes everything same-origin).
 *
 * It creates one throwaway user and deletes it again. It reads DATABASE_URL_UNPOOLED from
 * apps/api/.env only for that cleanup; nothing here prints a secret.
 *
 * Written after a Cloudflare Pages build shipped a bundle with an empty VITE_API_URL — which
 * looked completely healthy from the outside, because the SPA fallback in `_redirects`
 * (`/* /index.html 200`) answers *every* path with HTML and a 200. Checking "does the app load"
 * is therefore worthless. §1 checks the API origin is actually baked into the shipped JavaScript,
 * which is the thing that was broken.
 */
import fs from 'node:fs'
import { createRequire } from 'node:module'
import path from 'node:path'

const APP = process.env.APP_ORIGIN ?? 'https://app.mevivek.dev'
const API = process.env.API_ORIGIN ?? 'https://api.mevivek.dev'

const repoRoot = path.resolve(import.meta.dirname, '..')
const require = createRequire(path.join(repoRoot, 'apps/api/package.json'))
const { Client } = require('pg')

const env = Object.fromEntries(
  fs
    .readFileSync(path.join(repoRoot, 'apps/api/.env'), 'utf8')
    .split('\n')
    .filter((line) => /^[A-Z_]+=/.test(line))
    .map((line) => {
      const i = line.indexOf('=')
      return [line.slice(0, i), line.slice(i + 1).trim()]
    }),
)

let pass = 0
let fail = 0
const ok = (condition, label, extra = '') => {
  if (condition) {
    pass++
    console.log(`  PASS  ${label}${extra ? `  — ${extra}` : ''}`)
  } else {
    fail++
    console.log(`  FAIL  ${label}${extra ? `  — ${extra}` : ''}`)
  }
}

const email = `deploy-check-${Date.now()}@example.test`
const password = 'correct-horse-battery-staple-9'

console.log(`\napp: ${APP}\napi: ${API}`)

console.log('\n[1] the shipped bundle points at the API (the check that matters)')
{
  const html = await (await fetch(`${APP}/`)).text()
  ok(html.includes('<div id="root"'), 'app HTML served')

  const names = new Set([...html.matchAll(/\/assets\/([A-Za-z0-9_.-]+\.js)/g)].map((m) => m[1]))
  try {
    const sw = await (await fetch(`${APP}/sw.js`)).text()
    for (const m of sw.matchAll(/assets\/([A-Za-z0-9_.-]+\.js)/g)) names.add(m[1])
  } catch {
    /* no service worker in a dev build */
  }

  let hit = null
  for (const name of names) {
    const js = await (await fetch(`${APP}/assets/${name}`)).text()
    if (js.includes(new URL(API).host)) {
      hit = name
      break
    }
  }
  ok(
    hit !== null,
    `API origin is baked into the JavaScript (${names.size} chunks searched)`,
    hit ??
      'NOT FOUND — VITE_API_URL was empty at build time; the app will call itself and get HTML',
  )
}

console.log('\n[2] PWA installability')
{
  const m = await fetch(`${APP}/manifest.webmanifest`)
  ok(m.ok, 'manifest served')
  if (m.ok) {
    const j = await m.json()
    ok(j.display === 'standalone', "display is 'standalone'", j.display)
  }
  ok((await fetch(`${APP}/sw.js`)).ok, 'service worker served')
}

console.log('\n[3] API reachability and contract')
{
  const h = await fetch(`${API}/api/v1/health`)
  ok(h.ok, 'GET /api/v1/health', `${h.status}`)
  if (h.ok) console.log(`        ${await h.text()}`)

  const spec = await (await fetch(`${API}/api/v1/openapi.json`)).json()
  ok(spec.openapi?.startsWith('3.1'), 'OpenAPI 3.1', spec.openapi)

  const nf = await fetch(`${API}/api/v1/definitely-not-here`)
  ok(nf.status === 404, 'unknown route → 404', `${nf.status}`)
  ok(
    (nf.headers.get('content-type') ?? '').includes('application/problem+json'),
    'errors are problem+json',
  )

  ok((await fetch(`${API}/api/v1/me`)).status === 401, 'unauthenticated /me → 401')
}

console.log('\n[4] CORS from the app origin')
{
  const r = await fetch(`${API}/api/v1/me`, {
    method: 'OPTIONS',
    headers: {
      origin: APP,
      'access-control-request-method': 'GET',
      'access-control-request-headers': 'content-type',
    },
  })
  ok(r.status < 400, 'preflight accepted', `${r.status}`)
  ok(
    r.headers.get('access-control-allow-origin') === APP,
    'allow-origin is the exact app origin, not *',
    r.headers.get('access-control-allow-origin') ?? 'none',
  )
  ok(r.headers.get('access-control-allow-credentials') === 'true', 'allow-credentials: true')
}

console.log('\n[5] the ADR-0019 cross-subdomain session cookie')
let cookie = null
{
  const r = await fetch(`${API}/api/v1/auth/sign-up/email`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', origin: APP },
    body: JSON.stringify({ email, password, name: 'Deploy Check' }),
  })
  ok(r.ok, 'signup from the app origin', `${r.status}`)
  if (!r.ok) console.log(`        ${(await r.text()).slice(0, 200)}`)

  const raw = r.headers.getSetCookie?.() ?? []
  cookie = raw.map((c) => c.split(';')[0]).join('; ')
  const attrs = raw.join(' | ')
  ok(raw.length > 0, 'Set-Cookie present')
  ok(/HttpOnly/i.test(attrs), 'HttpOnly')
  ok(/Secure/i.test(attrs), 'Secure')
  ok(/SameSite=Lax/i.test(attrs), 'SameSite=Lax')
  // Deliberately host-only: a Domain attribute would broadcast the session to every
  // subdomain of the registrable domain. ADR-0019, amended.
  ok(!/Domain=/i.test(attrs), 'no Domain attribute (host-only)')
}

console.log('\n[6] the session works across subdomains')
{
  const r = await fetch(`${API}/api/v1/me`, { headers: { cookie, origin: APP } })
  ok(r.ok, 'GET /me with the cookie', `${r.status}`)
  if (r.ok) {
    const me = await r.json()
    ok(me.spaces?.length === 1, 'exactly one space', `${me.spaces?.length}`)
    ok(me.spaces?.[0]?.kind === 'personal' && me.spaces?.[0]?.role === 'owner', 'personal / owner')
  }
}

console.log('\n[7] the Documents domain actually works — i.e. its tables exist')
{
  /**
   * ═══════════════════════════════════════════════════════════════════════════════════════
   *  This section exists because the other 23 checks would all pass against a database
   *  with no `documents` table at all.
   * ═══════════════════════════════════════════════════════════════════════════════════════
   *
   * `GET /api/v1/health` does not touch the database, so neither the deploy pipeline's own
   * `verify` step nor this script would have noticed that nothing was applying migrations
   * (ADR-0023) — the same "looks perfectly healthy, is broken" shape as debt D23.
   *
   * A write, a read back, a filter and a delete. The write is the important one: it is the only
   * thing here that proves the schema is present and current rather than merely that the process
   * booted.
   */
  const headers = { cookie, origin: APP, 'content-type': 'application/json' }
  let documentId

  const created = await fetch(`${API}/api/v1/documents`, {
    method: 'POST',
    headers: { ...headers, 'idempotency-key': `deploy-check-${Date.now()}` },
    body: JSON.stringify({
      title: 'deploy check — safe to delete',
      doc_type: 'identity',
      expires_on: '2099-01-01',
    }),
  })
  ok(created.status === 201, 'POST /documents', `${created.status}`)

  if (created.status === 201) {
    const body = await created.json()
    documentId = body.id
    ok(typeof body.id === 'string', 'created document has an id')
    // Business rule 8: an identity document with an expiry gets 90/30/7-day reminders. This also
    // proves the `reminders` table exists, which no other check would.
    const detail = await fetch(`${API}/api/v1/documents/${documentId}`, { headers })
    if (detail.ok) {
      const full = await detail.json()
      ok(
        full.reminders?.length === 3,
        'three automatic reminders created',
        `${full.reminders?.length}`,
      )
      ok(Array.isArray(full.files), 'files[] present')
    } else {
      ok(false, 'GET /documents/:id', `${detail.status}`)
    }

    const list = await fetch(`${API}/api/v1/documents?limit=5`, { headers })
    ok(list.ok, 'GET /documents', `${list.status}`)
    if (list.ok) {
      const page = await list.json()
      ok(Array.isArray(page.data), 'list returns data[]')
      // `null`, never absent — conventions/api.md §4.
      ok('next_cursor' in page, 'next_cursor present (null on the last page)')
    }

    // Debt D27: a typo'd filter must fail loudly rather than return the unfiltered list.
    const typo = await fetch(`${API}/api/v1/documents?expiring_befor=2030-01-01`, { headers })
    ok(typo.status === 400, 'unknown query parameter rejected', `${typo.status}`)

    const deleted = await fetch(`${API}/api/v1/documents/${documentId}`, {
      method: 'DELETE',
      headers,
    })
    ok(deleted.status === 204, 'DELETE /documents/:id', `${deleted.status}`)
  }
}

console.log('\n[8] optional features report their configuration honestly')
{
  const headers = { cookie, origin: APP }

  // Not an assertion about whether they ARE configured — that is a deployment choice. What must
  // hold is that an unconfigured feature says so cleanly instead of throwing a 500.
  const pushKey = await fetch(`${API}/api/v1/push/public-key`, { headers })
  ok(pushKey.ok, 'GET /push/public-key', `${pushKey.status}`)
  if (pushKey.ok) {
    const { public_key: publicKey } = await pushKey.json()
    const configured = typeof publicKey === 'string' && publicKey.length > 0
    ok(publicKey === null || configured, 'push key is a string or null')
    console.log(
      configured
        ? '      → web push IS configured'
        : '      → web push is NOT configured (reminders will not be delivered)',
    )
  }
}

console.log('\n[cleanup]')
{
  const db = new Client({ connectionString: env.DATABASE_URL_UNPOOLED })
  await db.connect()
  // The document is soft-deleted above and its space is the throwaway user's, so deleting the
  // user cascades it away. Deleting the user is enough.
  await db.query('delete from users where email = $1', [email])
  const left = await db.query(
    "select count(*)::int n from users where email like 'deploy-check-%@example.test'",
  )
  ok(left.rows[0].n === 0, 'throwaway user removed')
  await db.end()
}

console.log(`\n================  ${pass} passed, ${fail} failed  ================`)
process.exit(fail ? 1 : 0)
