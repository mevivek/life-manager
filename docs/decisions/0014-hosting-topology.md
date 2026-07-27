# ADR-0014: Hosting topology — Cloudflare Pages, Fly.io, Neon, R2

- **Status:** accepted
- **Date:** 2026-07-26
- **Superseded by:** [ADR-0021](0021-cloud-run-for-the-api.md) — Cloud Run, not Fly, is what the API actually runs on

## Context

The stated budget is free tiers now, with a documented path to paying later if the project
grows. The maintainer is solo, so **operational burden is a first-class cost** — time spent
on TLS renewals, backups, and patching is time not spent building.

Four things need hosting: a static web build, a Node API container, Postgres, and object
storage.

## Decision

| Component | Host | Tier | Notes |
|---|---|---|---|
| Web PWA | **Cloudflare Pages** | Free | Static build, global CDN, unlimited bandwidth |
| API | **Fly.io** | ~$0–5/mo | Node container, scale-to-zero, one small machine |
| Database | **Neon** | Free | Serverless Postgres, branching, scale-to-zero |
| Files | **Cloudflare R2** | Free to 10 GB | Private bucket, zero egress |
| Email | **Resend** | Free to 3k/mo | Password reset and verification |

Database and storage rationale live in [ADR-0005](0005-postgres-neon-drizzle.md) and
[ADR-0008](0008-object-storage-r2.md). This ADR covers the compute and the shape of the
whole.

**Be honest about the cost:** everything here is genuinely free except the API. A Node
process that must stay reachable is the one thing nobody gives away unconditionally.
Fly.io's scale-to-zero machines make it a few dollars a month at single-user traffic, not
zero. That is the realistic floor.

**The topology is deliberately unremarkable.** The web build is static files and the API is
a stateless container reading config from environment variables. Every component can be
moved to another provider without a code change — which is the actual design goal, more
than any individual choice here.

## Alternatives considered

**API host:**

- **Railway.** Nicer developer experience than Fly, arguably the best of the group.
  Rejected because it has no meaningful free tier — it starts billing from the first
  deploy.
- **Render.** Has a free web service tier, but it spins down after inactivity with a cold
  start measured in tens of seconds. On a personal app opened once a day, *every* visit
  would hit that. Fly's scale-to-zero resumes far faster.
- **Vercel / Cloudflare Workers (serverless functions).** Free-tier friendly and would pair
  neatly with the web host. Rejected on fit: Fastify expects a long-lived Node process
  ([ADR-0004](0004-zod-single-contract-source.md)), and pg-boss requires one to run workers
  and cron ([ADR-0012](0012-pg-boss-background-jobs.md)). Going serverless would mean
  giving up the background-job design or running it somewhere else — reintroducing the
  extra service that ADR avoided.
- **A single VPS running everything** (Hetzner or similar, ~$6/mo). Cheapest at scale, no
  vendor lock-in, and genuinely tempting. Rejected on operational burden: backups, TLS
  renewal, OS patching, Postgres administration, and uptime all become the maintainer's
  job. For a solo project competing with limited time, managed services buy back the
  scarcest resource. Also loses Neon branching, which
  [ADR-0011](0011-pre-v1-schema-resets.md) depends on.

**Web host:** Vercel and Netlify are equivalent for a static SPA. Cloudflare Pages wins on
already being the R2 provider — one account, one dashboard, one bill.

## Consequences

**Good:** Near-zero cost at current scale. No servers to patch, no TLS to renew, no backup
scripts to write. Every component is independently replaceable. Deploys are a git push.

**Bad:** Four vendors instead of one — four accounts, four sets of credentials, four
dashboards when something breaks. Cold starts compound: a request after idle may wake both
the Fly machine and the Neon compute. Free tiers can change or disappear, and this stack
depends on several. Cloudflare hosts both the web app and the files, so a Cloudflare
outage takes out most of the product.

**Operational gaps, currently unaddressed** — also listed in
[security-model.md](../security-model.md) §7:

- No backup/restore runbook. Neon has point-in-time recovery on its free tier, but it has
  never been tested here. **Do this before storing anything irreplaceable.**
- No credential rotation procedure for R2 or the database.
- No uptime monitoring or alerting.

**Interaction to watch:** pg-boss's daily cron wakes the Neon compute on schedule, so the
database is not truly idle. Keep an eye on free-tier compute hours
([ADR-0012](0012-pg-boss-background-jobs.md)).

**Amended 2026-07-27 — the always-on requirement is now conditional.** Scheduled jobs are
switched off in development (see `apps/api/src/jobs/index.ts`), and nothing is scheduled at all
until M1. That matters more than it sounds, because *"a cron must fire while nobody is using the
app"* was the single requirement that ruled out request-driven hosting. With no schedule running:

- **Cloud Run's free tier becomes viable without Cloud Scheduler.** Its 180,000 vCPU-seconds/month
  cannot cover an always-on instance — a month is ~2.6M seconds — but it covers a scale-to-zero
  personal app many times over.
- Fly is still fine, and still cheap, but is no longer *required*.
- The Neon compute-hours concern above is moot until a schedule is switched on
  ([review.md](../product/review.md) D8).

**So the host choice is genuinely open again**, and should be made when the app actually needs to
be reachable with the laptop closed — not before. This ADR is not yet superseded, because Fly
remains the recorded choice; whoever changes it writes the superseding ADR then. Until then,
[a Cloudflare Tunnel](../roadmap.md) validates ADR-0019's cookie path without committing to any
host.

**Revisit if:** the app goes public — at that point the free tiers stop being appropriate
regardless of cost, because they lack the uptime guarantees and backup posture other
people's data deserves.
