# life-manager

A personal life-management app — one coherent place for the documents, possessions, money,
people, and secrets that make up a life.

**Status: M0 scaffold complete, not yet deployed.** The monorepo, API, web app, database schema,
auth and CI all work locally. Nothing has run anywhere but `localhost` yet — see
[`docs/roadmap.md`](docs/roadmap.md) for what remains.

---

## The idea

Single-domain tools already exist and are good. Paperless-ngx does documents. Firefly III
does money. Bitwarden does secrets. The bet here isn't to beat any of them at their own
domain — it's that **the interesting questions cross domains**:

> *What does this warranty cover, what did it cost, who sold it to me, where's the receipt,
> and when does it expire?*

No single-domain tool can answer that.

## What it will be

- **Documents** — identity papers, contracts, warranties, receipts, certificates, with
  expiry reminders that actually fire
- **Assets** — what you own, where it is, what it's worth
- **Money** — what you own and owe (not a budgeting app)
- **People** — who matters and what you need to remember about them
- **Notes** — everything that doesn't fit the above
- **Vault** — an end-to-end encrypted password and secrets store

Built one domain at a time, starting with Documents.

## Design constraints

- **Multi-user from day one**, though it starts as a single-user app
- **Synced across devices** — phone and laptop, server as the source of truth
- **Backend and frontend fully decoupled**, so native mobile clients are plug-and-play
- **Web client is a PWA** — installable, works offline for reading
- **Family sharing** is a near-term goal, so ownership is modeled on shared *spaces* from
  the first table
- **End-to-end encryption for the vault** — designed up front so it doesn't require a
  redesign later
- Built almost entirely by AI-agent sessions, which shapes nearly every decision below

## Stack

TypeScript throughout. Vite + React PWA, Fastify API, Postgres on Neon with Drizzle, Better
Auth, Cloudflare R2 for files, pg-boss for background jobs.

Rationale for each choice — and the alternatives rejected — is in
[`docs/decisions/`](docs/decisions/index.md).

## Documentation

Everything lives in [`docs/`](docs/README.md), organized so a fresh reader (human or AI) can
orient from two or three files:

| | |
|---|---|
| [`docs/README.md`](docs/README.md) | Start here — a "doing X? read Y" routing table |
| [`docs/architecture.md`](docs/architecture.md) | How the system fits together |
| [`docs/security-model.md`](docs/security-model.md) | Trust boundaries, data sensitivity, the vault design |
| [`docs/decisions/`](docs/decisions/index.md) | Why each choice was made, and what was rejected |
| [`docs/domains/`](docs/domains/) | One spec per life domain |
| [`docs/product/`](docs/product/brain.md) | Vision, principles, and the idea backlog |
| [`docs/roadmap.md`](docs/roadmap.md) | What's next |

[`CLAUDE.md`](CLAUDE.md) is the entry point for AI sessions.

## Getting started

### Prerequisites

- **Node 22.15+** — `.node-version` pins it
- **pnpm 11** — `corepack enable pnpm`, or `npm i -g pnpm` if Corepack cannot write to your Node
  install directory (it needs admin on Windows)
- **A Neon account** with a project and a `dev` branch
- **Docker Desktop — optional.** Only for running the database-backed API tests; see below

### Setup

```bash
pnpm install
```

Then fill in `apps/api/.env`. It is created for you with placeholders and comments, and three
lines need a real value — the two Neon connection strings (pooled *and* direct; they are not
interchangeable) and a generated `BETTER_AUTH_SECRET`:

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('base64url'))"
```

`.env` files are gitignored and must stay that way. `.env.example` at the repo root documents
every variable and holds **no values**.

Create the schema on your Neon dev branch, then start both apps:

```bash
pnpm --filter api db:push     # pre-v1 you may reset rather than migrate — ADR-0011
pnpm dev                      # api on :8080, web on :5173
```

Open <http://localhost:5173> and sign up. The Vite dev server proxies `/api` to the API, so
everything is same-origin locally and cookies need no special handling.

### The commands

| Command | What |
|---|---|
| `pnpm dev` | Both apps, watching |
| `pnpm typecheck` | `tsc` across all three packages |
| `pnpm lint` / `pnpm format` | Biome, check / write |
| `pnpm test` | Vitest: shared, api, web |
| `pnpm build` | shared → api → web |
| `pnpm --filter api db:generate` | Generate a migration from the Drizzle schema |
| `pnpm --filter api db:migrate` | Apply committed migrations |
| `pnpm --filter api db:seed` | Idempotent; repairs any user missing a personal space |
| `pnpm --filter api auth:generate` | Regenerate Better Auth's tables — read the header comment in `src/db/schema/auth.ts` first |

### Running the database-backed tests

The API's integration tests need a real Postgres
([ADR-0018](docs/decisions/0018-testcontainers-for-api-tests.md)). Two ways, in priority order:

1. **Set `TEST_DATABASE_URL`** in `apps/api/.env` to any throwaway Postgres. No Docker needed.
   The harness creates one database per test worker on that server and **truncates tables between
   tests** — so never point it at anything you care about, and never at your Neon dev branch.
2. **Start Docker Desktop** and set nothing. The harness starts a `postgres:17-alpine`
   Testcontainer for the run and throws it away afterwards.

With **neither**, `pnpm test` still passes — the database suites **skip** rather than fail, and
print a box telling you so. That is deliberate, so a fresh clone is not red by default. It also
means **a green `pnpm test` does not by itself prove the API was tested** — check the skip count.
CI has a Postgres service container and fails rather than skipping.

### Serving it on your phone (no hosting required)

A **Cloudflare Tunnel** publishes the two real hostnames straight from this laptop, over real
HTTPS on the real domain. That is enough to install the PWA and to exercise the cross-subdomain
cookie path in [ADR-0019](docs/decisions/0019-same-site-subdomain-deployment.md) — the thing that
cannot be tested on `localhost`. **The laptop is the server: close it and the app stops.**

Already set up (one-time, done 2026-07-27): `cloudflared` installed, `cloudflared tunnel login`
authorized for `mevivek.dev`, tunnel `life-manager` created, and CNAMEs for `app.mevivek.dev` and
`api.mevivek.dev` pointed at it. The apex and `www` are untouched.

Config lives at `~/.cloudflared/life-manager.yml` — **deliberately not `config.yml`**, so a
pre-existing unrelated tunnel that uses the default file is unaffected.

Three processes, in this order:

```bash
# 1. API on :8080
pnpm --filter api dev

# 2. Web on :5173 — pick ONE:
pnpm --filter web dev                      # dev server; NO service worker, so no PWA install
pnpm --filter web build && pnpm --filter web preview   # built output; PWA installable

# 3. Tunnel
cloudflared --config ~/.cloudflared/life-manager.yml tunnel run life-manager
```

Then open <https://app.mevivek.dev> on the phone.

Four things that will bite, all already handled in config — don't undo them:

- **`allowedHosts`** must list `app.mevivek.dev` in **both** `server` and `preview` in
  `apps/web/vite.config.ts`. Vite rejects unknown `Host` headers and the phone just gets a blank
  page.
- **`WEB_ORIGIN`** is a comma-separated list precisely so the tunnel host and `localhost:5173` are
  both trusted. A single value makes them mutually exclusive.
- **`VITE_API_URL`** is baked in at build time. Change it and you must rebuild.
- **PWA install needs the built output.** `devOptions.enabled` is false, so the dev server serves
  no manifest or service worker at all.

`cloudflared` is not on `PATH` in a fresh shell after install; it lives at
`C:\Program Files (x86)\cloudflared\cloudflared.exe`.

### Deploying

**Not done, and no deploy has ever been executed.** The tunnel above covers phone testing; hosting
is only needed for the app to work with the laptop closed.

`apps/api/fly.toml` and `apps/api/Dockerfile` exist but have never run.
[ADR-0014](docs/decisions/0014-hosting-topology.md) records Fly as the choice **but was amended**:
now that no cron is scheduled, nothing must run unattended, so Cloud Run's free tier is viable too
and the host choice is genuinely open. Whoever picks one writes the superseding ADR.

#### Deploy from CI, not from a laptop

**This is the design constraint, and it is easy to get wrong by starting with a local
`gcloud`/`fly` deploy.** A deploy that only works from one machine's terminal means:

- no AI session without shell access — Claude on the web or a phone — can ship anything;
- the deploy depends on locally installed CLIs and a local login that expires;
- nothing is reproducible.

So both halves should deploy **on push to this branch**:

| Half | Mechanism | Local tooling needed |
|---|---|---|
| Web | Cloudflare Pages ↔ GitHub integration | **none** — configured once in the dashboard |
| API | GitHub Actions → Cloud Build → Cloud Run | **none** — the image builds server-side |

The API path deliberately avoids local Docker (not installed, and not worth requiring). Cloud
Build builds the existing `apps/api/Dockerfile` **with the repo root as context** — that is not
optional, since the build needs `pnpm-lock.yaml`, `pnpm-workspace.yaml` and `packages/shared`.

**Browser-only prerequisites** (all doable from a phone):

1. **Cloudflare Pages** → connect `mevivek/life-manager`, branch `redo/architecture-scaffold`,
   build `pnpm build --filter=@life-manager/web`, output `apps/web/dist`, env
   `VITE_API_URL=https://api.mevivek.dev`. Then attach `app.mevivek.dev`.
2. **Google Cloud** → in project `life-manager`, enable Cloud Run, Cloud Build and Artifact
   Registry; create a deploy service account; download a JSON key.
3. **GitHub** → repo secrets: `GCP_PROJECT_ID`, `GCP_SA_KEY`, plus the API's runtime config
   (`DATABASE_URL`, `DATABASE_URL_UNPOOLED`, `BETTER_AUTH_SECRET`, `GOOGLE_CLIENT_SECRET`).

**The DNS records already point at the tunnel**, so cutting over means repointing
`api.mevivek.dev` and `app.mevivek.dev` away from it — plan for the tunnel and the deployment not
to coexist on the same hostnames.

**Generate a fresh `BETTER_AUTH_SECRET` for production.** Do not reuse the local one; it has been
on a development machine.

#### What is actually deployed (done 2026-07-27)

**The API runs on Cloud Run.** The web app does not — it is still served from the laptop by the
tunnel above.

| | |
|---|---|
| Project | `life-manager-01` (number `830606060895` — the same project as the Google OAuth client) |
| Service | `life-manager-api`, region `us-central1` (free-tier eligible) |
| Direct URL | `https://life-manager-api-830606060895.us-central1.run.app` |
| Custom domain | `api.mevivek.dev` via a Cloud Run **domain mapping** |
| Image | Artifact Registry `us-central1-docker.pkg.dev/life-manager-01/life-manager/api`, cleanup policy keeps the last 3 |
| Runtime identity | `life-manager-api@life-manager-01.iam.gserviceaccount.com` |
| Guard rails | `--min-instances=0`, `--max-instances=3`, `$5` budget alert on the billing account |

**`--min-instances=0` is load-bearing, not a preference.** Cloud Run's free tier is 180,000
vCPU-seconds/month and a month is ~2.6M seconds, so a single always-on instance costs roughly 14×
the free allowance. Anything that sets a minimum above zero turns this from free into billed.

Rebuild and redeploy:

```bash
gcloud builds submit --config cloudbuild.yaml --substitutions=_TAG=$(git rev-parse --short HEAD)
gcloud run deploy life-manager-api --region=us-central1 \
  --image=us-central1-docker.pkg.dev/life-manager-01/life-manager/api:$(git rev-parse --short HEAD) \
  --service-account=life-manager-api@life-manager-01.iam.gserviceaccount.com \
  --min-instances=0 --max-instances=3
```

**Secrets live in Secret Manager**, not as env vars on the service: `DATABASE_URL`,
`DATABASE_URL_UNPOOLED`, `BETTER_AUTH_SECRET`, `GOOGLE_CLIENT_SECRET`. The runtime service account
has `secretAccessor` **on those four secrets only and no project-level roles** — deliberately not
the default compute service account, which is broadly privileged. The first deploy failed on
exactly this permission; that failure is expected if the account is ever recreated.

Production uses a **different `BETTER_AUTH_SECRET`** from local. Rotating it invalidates every
session.

##### Two traps in the domain mapping, both of which cost time

1. **The DNS record must be DNS-only (grey cloud), not proxied.** Google cannot complete
   certificate validation through Cloudflare's proxy, and the failure is silent — the certificate
   simply never issues. This is the opposite of what a Cloudflare-proxied CNAME to `*.run.app`
   would need, so do not mix the two approaches.
2. **`CertificateProvisioned: True` does not mean it is serving.** That condition reports
   issuance in the control plane; propagation to the serving edge lags it by minutes to about an
   hour. During that window port 80 answers with a 302 while port 443 accepts the TCP connection
   and closes with `unexpected EOF / 0 bytes`. That looks like a misconfiguration and is not one —
   **wait, do not re-point DNS**, which restarts the process.

#### The web app: Cloudflare Pages

Project `life-manager`, connected to this GitHub repo, production branch `main`. It **builds on
push** — no local tooling needed.

| Setting | Value |
|---|---|
| Build command | `pnpm turbo run build --filter=@life-manager/web` |
| Output directory | `apps/web/dist` |
| Root directory | `/` (repo root) |
| Variable | `VITE_API_URL=https://api.mevivek.dev` |

**Use `pnpm turbo run build`, not `pnpm build --filter=…`.** Turbo's `dependsOn: ["^build"]`
builds `packages/shared` first; the pnpm-filter form relies on `shared/dist` already existing,
which it never does on a fresh clone.

##### The trap that shipped a broken site

**`VITE_API_URL` is baked in at build time, and a build with it missing looks completely
healthy.** This actually happened: the first Pages build ran before the variable was saved, so
`api-origin.ts` fell back to `window.location.origin`, the app called *itself* for `/api/v1/...`,
and the SPA fallback in `public/_redirects` (`/* /index.html 200`) answered **every** request with
HTML and a 200.

Nothing looked wrong from outside. The page loaded, assets loaded, status codes were 200. Only
login broke, on a JSON parse error.

So **"does the site load" proves nothing here.** After any deploy, run:

```bash
node scripts/verify-deployment.mjs
```

Its first check greps the shipped JavaScript for the API origin, which is precisely the thing that
was broken. **If you change `VITE_API_URL`, you must rebuild** — editing the variable alone does
nothing to already-built assets.

#### The API deploys on push too — from Cloud Build, not GitHub Actions

**GitHub Actions does not run on this repository.** Every run dies in seconds with no runner
assigned, no steps and no logs — an account-level block, on every commit, including ones predating
any workflow change. Billing was corrected and a fresh push still failed identically.

So **two files claim to be CI, and only one of them runs:**

| File | Status |
|---|---|
| `.github/workflows/ci.yml` | **Never executes.** Kept because it is correct — if Actions is unblocked it takes over and the Cloud Build trigger can be deleted |
| `cloudbuild.deploy.yaml` | **This is the real pipeline** |

Trigger `deploy-api-on-push` is a **webhook** trigger, fired by a GitHub push webhook. A webhook
trigger was chosen because it needs no browser step: connecting a repository to Cloud Build
requires installing its GitHub App, whereas the trigger and the webhook can both be created from
the command line. The repo is public, so the build clones itself with no credential.

It runs `guard → clone → postgres → install → typecheck → lint → test → build → push → deploy →
verify`. **It is not a bare build-and-deploy:** the GitHub Actions job it replaced was gated on
`needs: verify`, and reproducing that gate was the point. A real Postgres sidecar runs on the
`cloudbuild` network, and `CI=true` makes the harness throw rather than skip when no database is
reachable — so a green build proves the integration tests actually ran.

Branch filtering is a **guard step**, not a trigger filter (this gcloud has no `--filter` for
webhook triggers). Non-`main` refs get tested and built but the deploy and verify steps skip, and
the guard exits **0** rather than failing — a skipped deploy is the correct outcome, and a red
build for it would train you to ignore red.

##### The one footgun: the trigger holds an INLINE copy of the config

A webhook trigger has no attached repository to read `cloudbuild.deploy.yaml` from, so the trigger
stores a snapshot. **Editing that file changes nothing until you push the new copy to the trigger:**

**`gcloud builds triggers update webhook` cannot do it.** It rejects `--inline-config` with a bare
`INVALID_ARGUMENT` and has no `--substitutions` flag at all. The trigger must be deleted and
recreated — the name is preserved, so the GitHub webhook URL keeps working:

```bash
P=life-manager-01
gcloud builds triggers delete deploy-api-on-push --region=global --project=$P --quiet
gcloud builds triggers create webhook --name=deploy-api-on-push --project=$P --region=global \
  --inline-config=cloudbuild.deploy.yaml \
  --secret="projects/$P/secrets/github-webhook-secret/versions/1" \
  --service-account="projects/$P/serviceAccounts/life-manager-deploy@$P.iam.gserviceaccount.com" \
  --substitutions='_SHA=$(body.after),_REF=$(body.ref)'
```

Then confirm it took, because a silent no-op is the failure mode:

```bash
gcloud builds triggers describe deploy-api-on-push --region=global --project=$P \
  --format="value(build.steps[].id)"
```

Forget this and you will edit the pipeline, push, and watch the old pipeline run — with nothing to
tell you why.

##### Identity

The build runs as `life-manager-deploy`, which can deploy Cloud Run and `actAs` the runtime
account but holds `secretAccessor` on **no secret** — verified against all three. The service's
secrets stay bound from Secret Manager and are read by the runtime account, so **the thing that
deploys cannot read them.** No long-lived credential exists: the webhook uses a Secret Manager
secret and an API key restricted to the Cloud Build API.

## License

Not yet chosen. Personal project.
