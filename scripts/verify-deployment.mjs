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
 *
 * That same fallback is why §1 also walks every asset the HTML names — plus every lazy route chunk
 * the entry names — and asserts each one's **content-type**. A file that was never uploaded still
 * answers 200, so status codes cannot see it. See the long comment in §1.
 */
import fs from 'node:fs'
import { createRequire } from 'node:module'
import path from 'node:path'

const APP = process.env.APP_ORIGIN ?? 'https://app.mevivek.dev'
const API = process.env.API_ORIGIN ?? 'https://api.mevivek.dev'

const repoRoot = path.resolve(import.meta.dirname, '..')
const require = createRequire(path.join(repoRoot, 'apps/api/package.json'))
const { Client } = require('pg')

/**
 * `apps/api/.env`, if it exists.
 *
 * **Optional, deliberately.** It is read for exactly one thing — the database credential used by the
 * cleanup step at the end — and requiring it would mean a machine that has never run the API locally
 * cannot run any of these checks at all. That is the wrong trade: the 25 checks are the point, and
 * the cleanup is a tidy-up.
 *
 * `DATABASE_URL_UNPOOLED` in the real environment takes precedence, so CI or a one-off run can
 * supply it without a file existing anywhere.
 */
function readEnvFile() {
  const envPath = path.join(repoRoot, 'apps/api/.env')
  if (!fs.existsSync(envPath)) return {}

  return Object.fromEntries(
    fs
      .readFileSync(envPath, 'utf8')
      .split('\n')
      .filter((line) => /^[A-Z_]+=/.test(line))
      .map((line) => {
        const i = line.indexOf('=')
        return [line.slice(0, i), line.slice(i + 1).trim()]
      }),
  )
}

const env = readEnvFile()
// This script is never a Turborepo task, so there is no turbo.json cache key to declare this
// variable in. The suppression below must stay on ONE line touching the code — a second comment line
// between them detaches it, and Biome then reports the suppression itself as unused.
// biome-ignore lint/suspicious/noUndeclaredEnvVars: script-only, documented directly above
const cleanupDatabaseUrl = process.env.DATABASE_URL_UNPOOLED ?? env.DATABASE_URL_UNPOOLED

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
  let swText = ''
  try {
    swText = await (await fetch(`${APP}/sw.js`)).text()
    for (const m of swText.matchAll(/assets\/([A-Za-z0-9_.-]+\.js)/g)) names.add(m[1])
  } catch {
    /* no service worker in a dev build */
  }

  /**
   * **Every asset the app names must really exist — and a 200 does not prove that it does.**
   *
   * The SPA fallback in `_redirects` (`/* /index.html 200`) answers a *missing* asset with the
   * app's own HTML at status 200. So `res.ok` is true for a file that was never uploaded, and a
   * browser then refuses to execute HTML as a `type="module"` script: a blank screen that every
   * other probe in this file would call healthy. §1's existing check cannot catch it either — it
   * asks only whether *some* chunk contains the API host, which any one chunk can satisfy.
   *
   * So the assertion is on the CONTENT-TYPE, not the status. Same lesson as debt D33: a check that
   * cannot distinguish "correct" from "never served" is not a check.
   *
   * The route chunks come from the entry's `__vite__mapDeps` table, which is how a code-split
   * TanStack Router build names its lazy chunks. They are worth walking because a missing one
   * breaks exactly one screen — the failure that survives a manual look at the dashboard.
   *
   * ── Use `fetch`, not `curl`, when checking this by hand ──
   *
   * From inside an agent container, `curl` goes through the agent HTTPS proxy, and the proxy has
   * been observed returning the SPA fallback for a large asset that the origin serves correctly —
   * i.e. it manufactures precisely the failure this check looks for. Node's `fetch` does not honour
   * `HTTPS_PROXY` by default and reaches the origin. A "missing" asset seen only via `curl` is an
   * artefact; confirm with `fetch` before believing it.
   */
  const referenced = new Map()
  for (const m of html.matchAll(/(?:src|href)="(\/assets\/[A-Za-z0-9_.-]+\.(?:js|css))"/g)) {
    referenced.set(m[1], 'index.html')
  }
  ok(referenced.size > 0, 'the HTML names hashed assets', `${referenced.size} referenced`)

  const missing = []
  const seen = new Set()
  /** Fetches `url`, records it if the fallback answered, and returns the body (or null). */
  const fetchAsset = async (url, source) => {
    if (seen.has(url)) return null
    seen.add(url)
    const res = await fetch(`${APP}${url}`)
    const type = res.headers.get('content-type') ?? ''
    // An asset answered with HTML was never deployed; the fallback is replying on its behalf.
    if (!res.ok || type.includes('text/html')) {
      missing.push(`${url} (${source}) → ${res.status} ${type.split(';')[0]}`)
      return null
    }
    return await res.text()
  }

  for (const [url, source] of [...referenced]) {
    const body = await fetchAsset(url, source)
    if (body === null || !url.endsWith('.js')) continue
    for (const m of body.matchAll(/"(assets\/[A-Za-z0-9_.-]+\.js)"/g)) {
      referenced.set(`/${m[1]}`, 'route chunk')
    }
  }
  // Second pass: the lazy chunks discovered in the entry above.
  for (const [url, source] of [...referenced]) await fetchAsset(url, source)

  ok(
    missing.length === 0,
    `every referenced asset is really served, not the SPA fallback (${seen.size} fetched)`,
    missing.join('; '),
  )

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

    /**
     * ═══════════════════════════════════════════════════════════════════════════════════════
     *  A REAL upload, against real R2. This is debt D39's gap, and nothing else covers it.
     * ═══════════════════════════════════════════════════════════════════════════════════════
     *
     * `docker-compose.dev.yml` runs Adobe S3Mock, which accepts presigned URLs **without validating
     * the signature**. So a green local upload says only that the three-step flow is wired up; it
     * says nothing about whether the URL we mint is one that real storage will accept. Both storage
     * bugs M1 hit were signature-content bugs that would have passed there.
     *
     * This is the check that would have caught them, and it can only run against production.
     */
    const bytes = Buffer.from('deploy-check upload probe')
    const presigned = await fetch(`${API}/api/v1/documents/${documentId}/files:presign-upload`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ mime: 'image/png', size_bytes: bytes.length, make_primary: true }),
    })

    if (presigned.status === 503) {
      // Storage genuinely unconfigured. Honest, and not a failure of the deployment.
      console.log('  SKIP  upload round-trip — storage is not configured (503)')
    } else if (!presigned.ok) {
      ok(false, 'presign upload', `${presigned.status} ${(await presigned.text()).slice(0, 200)}`)
    } else {
      const { upload_url, file_id } = await presigned.json()

      const put = await fetch(upload_url, {
        method: 'PUT',
        // Exactly what the browser sends: the signed content-type, plus an Origin. A mismatch here
        // is the difference between a working upload and a 403 the user sees as "cannot upload".
        headers: { 'content-type': 'image/png', origin: APP },
        body: bytes,
      })

      /**
       * ═══════════════════════════════════════════════════════════════════════════════════════
       *  Does the app's OWN Content-Security-Policy permit talking to this host?
       * ═══════════════════════════════════════════════════════════════════════════════════════
       *
       * This is the check that was missing when uploads silently failed in production. CSP is
       * enforced only by browsers, so every other assertion in this file — the presign, the PUT, the
       * CORS preflight, the confirm — passed while the app could not upload at all. `connect-src`
       * named the API and not R2, and ADR-0008 sends file bytes straight to R2.
       *
       * The failure mode is what made it expensive: a blocked request reaches JavaScript as a bare
       * network error, indistinguishable from being offline, so the client queued each upload under
       * "waiting to send" forever.
       *
       * Comparing the policy against a REAL presigned origin rather than a hard-coded host is the
       * point — rename the bucket and this still tells the truth.
       */
      const cspHeader = (await fetch(`${APP}/`)).headers.get('content-security-policy') ?? ''
      const connectSrc = /connect-src ([^;]*)/.exec(cspHeader)?.[1]?.trim().split(/\s+/) ?? []
      const uploadHost = new URL(upload_url).hostname
      const permitted = connectSrc.some((source) => {
        if (source === '*') return true
        const host = source.replace(/^https?:\/\//, '').replace(/\/.*$/, '')
        if (host.startsWith('*.')) return uploadHost.endsWith(host.slice(1))
        return host === uploadHost
      })
      ok(
        permitted,
        "the app's CSP allows uploading to storage",
        permitted
          ? uploadHost
          : `connect-src does not permit ${uploadHost} — every browser upload will fail while every check here passes`,
      )
      ok(
        put.ok,
        'PUT the bytes to real storage',
        put.ok ? `${put.status}` : `${put.status} ${(await put.text()).slice(0, 300)}`,
      )

      /**
       * **The header that decides whether a BROWSER can upload, as opposed to this script.**
       *
       * Node ignores CORS entirely, so the PUT above can succeed while every upload from the app
       * fails. The browser requires `access-control-allow-origin` on the PUT's own response — a
       * passing preflight is not enough — and when it is missing the browser rejects the request at
       * the network layer. Our client cannot tell that apart from being offline, so the write is
       * queued as "waiting to send" and never sent. That is precisely the symptom reported from a
       * phone with full signal.
       */
      ok(
        put.headers.get('access-control-allow-origin') !== null,
        'the upload response carries CORS headers, so a browser can read it',
        put.headers.get('access-control-allow-origin') ??
          'ABSENT — uploads work from a server and FAIL in the browser',
      )

      const confirmed = await fetch(`${API}/api/v1/documents/${documentId}/files:confirm`, {
        method: 'POST',
        headers,
        body: JSON.stringify({ file_id }),
      })
      ok(confirmed.ok, 'confirm the upload', `${confirmed.status}`)

      // D33: assert a NON-ZERO count. `file_count` was 0 for all of M1 because every assertion
      // happened to expect 0.
      const after = await fetch(`${API}/api/v1/documents/${documentId}`, { headers })
      if (after.ok) {
        const full = await after.json()
        ok(full.file_count === 1, 'file_count reflects the upload', `${full.file_count}`)
      }
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

    /**
     * **No `content-type` on a DELETE**, which is why this does not reuse `headers`.
     *
     * `headers` carries `content-type: application/json` for the writes above. Sending it on a
     * request with no body makes Fastify reject it at the body parser with a 400 — "Body cannot be
     * empty when content-type is set to application/json" — before the route runs at all.
     *
     * That produced a FAILING check against a perfectly healthy production API, which is the worst
     * kind of verifier bug: it accuses the deployment of something the deployment did not do.
     */
    // `?version=` is required since D41 — a delete without it is refused rather than applied.
    const current = await (await fetch(`${API}/api/v1/documents/${documentId}`, { headers })).json()
    const deleted = await fetch(
      `${API}/api/v1/documents/${documentId}?version=${current.version}`,
      { method: 'DELETE', headers: { cookie, origin: APP } },
    )
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
if (cleanupDatabaseUrl === undefined) {
  /**
   * Skipped, loudly, rather than failing the run.
   *
   * Every check above has already passed or failed on its own merits; not having a database
   * credential to hand says nothing about the deployment. But it is NOT silent: the throwaway
   * account is real and it stays until something removes it, so the message has to name the account
   * and how to clear it rather than printing a tidy nothing.
   */
  console.log('  SKIP  throwaway user NOT removed — no database credential available')
  console.log(`        left behind: ${email}`)
  console.log(
    '        to clear it, set DATABASE_URL_UNPOOLED and re-run, or add it to apps/api/.env',
  )
} else {
  const db = new Client({ connectionString: cleanupDatabaseUrl })
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
