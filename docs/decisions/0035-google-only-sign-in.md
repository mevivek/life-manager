# ADR-0035: Google-only sign-in, gated on the server actually having Google

- **Status:** accepted
- **Date:** 2026-07-31
- **Supersedes:** [ADR-0020](0020-google-oauth-alongside-password.md), **in part** — its
  *"email+password stays"* decision. Everything else in it stands: the pair-or-neither env rule,
  account linking, and `trustedProviders` as a security control.
- **Superseded by:** —

## Context

Design handoff 5 draws the sign-in screen with the email and password fields **removed**, leaving one
*Continue with Google* button and a reassurance line: *"One account, no password to forget. We read
your name and email, nothing else."*

**ADR-0020 considered and rejected exactly this**, four days ago, under *Alternatives considered*:

> **Google only, drop email+password.** Simpler: one code path, no password storage, and it eliminates
> the no-password-reset debt outright. Rejected because it makes a single Google account the only way
> into a system whose stated long-term goal is a password vault. A locked or lost Google account would
> mean losing access to everything, and "recover your Google account" is not a recovery story this
> project controls.

That reasoning was raised with the maintainer twice while building handoff 5, and recorded as debt
**D85** rather than built. They have now decided to proceed. This ADR records the reversal and the one
thing that has to change about *how* it ships.

**The deployment hazard is separate from the design question, and it is the sharper of the two.**
`GOOGLE_CLIENT_ID` and `GOOGLE_CLIENT_SECRET` are `.optional()` in `env.ts`, and `auth.ts` registers
`socialProviders` as an **empty object** when either is missing. Nothing in `cloudbuild.deploy.yaml`
sets them. So a build that deletes the password form and ships against an API without those
credentials produces a sign-in screen whose only control cannot work — and no way back in except a
redeploy.

## Decision

**The sign-in and sign-up screens are Google-only, and the server says whether that is possible.**

- **New endpoint `GET /api/v1/auth/providers`**, unauthenticated by necessity — it is read *before*
  anyone has a session. It returns `{ google: boolean, password: boolean }`, derived from the same
  `env` check `auth.ts` uses to register the provider. **One source of truth**: if the provider is not
  registered, the endpoint cannot claim it is.
- **With Google available, the screens are the comp**: the button, the reassurance line, and no
  fields. This is the normal case and the one the maintainer asked for.
- **Without it, the password form renders instead**, with a line saying Google is not configured on
  this server. Not a degraded mode to be embarrassed about — it is the same screen the app has today.

**This gate is not a hedge against the decision.** It is what makes the decision deployable: the
comp's screen is what a correctly-configured deployment shows, every time, and the fallback exists so
that a *misconfigured* one is recoverable rather than bricked. Deleting the fields unconditionally
would make a missing environment variable an outage instead of a warning.

**What ADR-0020's rejection got right, and what is being accepted.** The recovery argument has not
become wrong — a lost Google account still means a lost archive, and this project still does not
control that recovery. The maintainer is accepting that risk knowingly for a single-user app they own
the Google account for. It is written here rather than lost, because the day the **vault** ships
(ADR-0010) is the day it stops being an acceptable trade: a vault whose only key is a third party's
account is a different proposition from an archive of documents.

**Email+password is not removed from the server.** `emailAndPassword.enabled` stays `true` and the
existing accounts keep working. Only the *client screens* stop offering it. That is deliberate and it
is the recovery path: if a Google account is lost, the credentials still exist and the form is one
config flag away from being drawn again.

## Alternatives considered

- **Delete the fields unconditionally, exactly as drawn.** Rejected on the deployment hazard alone —
  see above. The comp cannot know which environment variables a deployment sets.
- **Delete email+password from the server too**, so there is genuinely one code path. Rejected: it
  destroys the recovery path this ADR is relying on, needs a migration for existing password accounts,
  and buys only the removal of code that is already written and tested.
- **A feature flag in the client build.** Rejected: it would be set at build time and the credentials
  live at run time, so the two can disagree — which is precisely the failure being avoided. The server
  is the only thing that knows.
- **Keep a quiet "sign in with a password instead" disclosure under the button.** Rejected because it
  is not what the comp draws, and because it re-introduces the choice the maintainer's decision was
  about removing. The fallback is for a broken deployment, not for a user preference.

## Consequences

**Good:**

- The screen matches the comp on any correctly-configured deployment.
- One route in, one account, no password to forget — which is the user-facing point.
- A misconfigured deployment degrades to a working sign-in instead of a dead button.
- The no-password-reset debt (**D12**) stops mattering for new accounts, since new accounts have no
  password.

**Bad, and real:**

- **A lost Google account is a lost archive**, and this project has no recovery for it. ADR-0020
  named this and it is now accepted rather than solved. **This must be revisited before the vault
  ships.**
- **One more unauthenticated endpoint**, which is a small surface but a real one. It returns two
  booleans about configuration, no secrets, and no information an attacker cannot get by looking at
  the sign-in page.
- **The sign-in screen now depends on a request.** It renders a skeleton until the capability resolves,
  where before it was static. Offline, it falls back to showing the password form — the honest choice,
  since a Google redirect cannot work offline either.
- **Two screens can disagree with the server for one render.** Accepted: the button simply fails as it
  would today with unconfigured OAuth.

**Revisit if:** the vault ships (ADR-0010) — at that point the recovery story has to be solved rather
than accepted. Or if password reset lands, which would make email+password a genuine second route
rather than a legacy one.
