# ADR-0021: Cloud Run for the API, not Fly.io

- **Status:** accepted
- **Date:** 2026-07-27
- **Supersedes:** [ADR-0014](0014-hosting-topology.md), for the API component only. Its choices for
  Postgres (Neon), files (R2) and the web app (Cloudflare Pages) still stand.

## Context

[ADR-0014](0014-hosting-topology.md) chose Fly.io for the API and explicitly rejected
"serverless" hosts, on one argument: Fastify needs a long-lived process, and **pg-boss needs one
running to poll the queue and fire the daily reminder cron**. That reasoning was sound when
written.

It stopped being true on the same day. Scheduled jobs were deliberately switched off in
development, and nothing is scheduled at all until M1
([open-questions.md](../product/open-questions.md)). With no cron, **nothing has to be running
while nobody is using the app** — which was the entire basis for requiring an always-on host.

ADR-0014 was amended to note the reopening but deliberately left Fly as the recorded choice,
because nothing had been deployed. Something has now been deployed, so this ADR closes it.

## Decision

**The API runs on Google Cloud Run** in project `life-manager-01`, region `us-central1`, reached at
`api.mevivek.dev` through a Cloud Run domain mapping.

Operational detail — image, secrets, service account, rebuild commands — is in
[README.md](../../README.md) § Deploying, not duplicated here.

Three properties are load-bearing rather than incidental:

1. **`--min-instances=0`.** Cloud Run's free tier is 180,000 vCPU-seconds/month; a month is
   ~2,600,000 seconds. A single always-on instance therefore costs roughly **14× the free
   allowance**. Scale-to-zero is not a tuning preference — it is the difference between free and
   billed, and any future change that sets a minimum above zero silently starts a bill.
2. **`--max-instances=3`.** Caps the worst case. A personal app has no legitimate reason to fan out.
3. **A dedicated runtime service account with `secretAccessor` on four secrets and no
   project-level roles** — not the default compute service account, which carries broad project
   permissions by default. The API's own trust boundary
   ([security-model.md](../security-model.md) §1) is undermined if its identity can read the whole
   project.

Cold start measured at deploy: **~450–670ms**, warm ~356ms.

## Alternatives considered

- **Fly.io, as ADR-0014 specified.** Still a good option, and genuinely simpler — one machine, one
  concept, a much smaller blast radius than a cloud project. Rejected on two counts. First, cost:
  Fly is ~$0–5/month where Cloud Run at this traffic is $0. Second, and more decisive, the
  original *reason* for preferring it — needing an always-on process for cron — no longer applies,
  so it was being chosen on an argument that had expired.
- **Render's free tier.** Genuinely free and needs no billing account. Rejected on cold start:
  tens of seconds after idle, and a personal app opened once a day hits that on *every* visit.
  Cloud Run's sub-second cold start is a different category of experience.
- **A single VPS.** Cheapest at scale. Rejected for the same reason ADR-0014 rejected it —
  backups, TLS renewal, patching and uptime all become the maintainer's job, which is the scarcest
  resource here.
- **Cloudflare Workers**, pairing with the web host. Rejected: Fastify does not run there, so it
  would mean rewriting the API against a different runtime to save nothing.

## Consequences

**Good:** $0 at this scale, sub-second cold starts, builds happen server-side via Cloud Build so
**Docker is not required locally** (it is not installed and now need not be). Deploys are two
reproducible commands, which means a GitHub Actions workflow can later reproduce a path already
proven rather than guessing.

**Bad, and worth stating honestly:**

- **A cloud project is a larger blast radius than one small VM.** Mitigated by a `$5` budget alert
  and `--max-instances=3`, not eliminated.
- **Billing had to be enabled**, which required unlinking three dormant projects to get under the
  five-project quota. Cloud Run's free tier still requires an active billing account.
- **More moving parts than Fly:** Artifact Registry (with a cleanup policy, or image storage grows
  forever), Secret Manager, a service account, a domain mapping. Each is a thing that can be
  misconfigured.
- **Region lock-in for the free tier.** `us-central1` is free-tier eligible; moving region is not
  a flag change.

**Two traps that cost real time and are documented in the README rather than here** because they
are operational: the domain mapping's DNS record must be **DNS-only, not Cloudflare-proxied**, or
certificate validation silently never completes; and `CertificateProvisioned: True` reports
*issuance*, not edge propagation, so the hostname can be dark for up to an hour after the
condition goes green. Both look like misconfiguration and are not.

**Still on Fly's side of the ledger:** `apps/api/fly.toml` and the Fly notes in the Dockerfile
remain in the repo. They are harmless and make reverting cheap, but they are **no longer the
deployment path** — do not treat them as current.

**Revisit if:** scheduled jobs are switched on and turn out to need an always-on process after all
(measure before assuming — a Cloud Scheduler ping is usually enough), or the app goes public and
free-tier uptime guarantees stop being appropriate.
