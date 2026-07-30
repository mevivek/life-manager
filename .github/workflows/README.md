# There are no GitHub Actions workflows in this repo, on purpose

**The pipeline is [`cloudbuild.deploy.yaml`](../../cloudbuild.deploy.yaml)**, run by the Cloud
Build trigger `deploy-api-on-push`: typecheck → lint → test → build → deploy → health-check.
The web half deploys separately, via Cloudflare Pages building on push from `main`.

A `ci.yml` used to sit here. It described that same sequence in 194 convincing lines and
**executed nothing** — GitHub Actions has never run on this repository, so every run died in
seconds with no runner, no steps and no logs (debt D24). It was deleted on 2026-07-30 rather
than fixed: a file that reads as a merge gate but is not one is worse than no file, because a
session reads it, believes a red build would have been caught, and skips the check that would
actually have caught it. That is the same failure ADR-0015 exists to prevent, in YAML instead
of prose.

Two things to know before adding a workflow here:

- **Adding one means adopting a second pipeline.** Cloud Build already tests and deploys. Two
  gates that can disagree is a worse problem than one gate you have to read a file to find.
- **If you do add one, prove it runs.** Push it and look at the Actions tab. A workflow that has
  never produced a log is indistinguishable from the one deleted here.

Editing the real pipeline has its own trap: the trigger holds its own inline copy of the config,
so a change needs a delete-and-recreate rather than an update (debt D25), and the deploy guard
diffs `HEAD~1..HEAD` — correct for a merge commit, wrong for a fast-forward, so a multi-commit
push can skip the API deploy entirely and has caused an outage (debt **D62**). Merge with
`--no-ff` until both are fixed. See [README.md](../../README.md) § Deploying.
