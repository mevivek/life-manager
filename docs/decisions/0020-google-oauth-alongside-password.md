# ADR-0020: Google sign-in, alongside email+password rather than replacing it

- **Status:** accepted
- **Date:** 2026-07-27
- **Superseded by:** [ADR-0035](0035-google-only-sign-in.md), **in part** — only the
  *"email+password stays"* decision, and only on the **client screens**: sign-in and sign-up are
  Google-only when the server reports Google is configured. `emailAndPassword` remains enabled on the
  server as the recovery path. Everything else here stands — the pair-or-neither env rule, account
  linking, and `trustedProviders` as a security control. **Its recovery argument was not refuted, it
  was knowingly accepted**; 0035 records that and says it must be revisited before the vault ships.
  The body below is left exactly as accepted (ADR-0015).

## Context

M0 shipped with email+password only, and with a gap recorded as debt: **there is no password
reset and no email verification**, because both need a transactional email provider that was
deferred. The practical consequence is that a forgotten password means hand-deleting a row from
the database.

Separately, the maintainer already has a Google Cloud project for this app, which is where an
OAuth client lives, so the marginal setup cost of Google sign-in is one console form.

Better Auth supports social providers as configuration
([ADR-0007](0007-better-auth-self-hosted.md)), so this is not a question of capability. The real
question is whether Google *replaces* email+password or sits beside it.

## Decision

**Google OAuth is enabled, and email+password stays.** Both routes resolve to one account.

- `socialProviders.google` is registered **only when both `GOOGLE_CLIENT_ID` and
  `GOOGLE_CLIENT_SECRET` are present.** `env.ts` enforces them as a pair, so a half-configured
  deployment fails at boot with a named variable rather than at the OAuth redirect, which is a
  much worse place to discover it.
- **Account linking is on, with `google` as a `trustedProviders` entry.** So signing in with
  Google using an email that already has a password account resolves to the same user instead of
  creating a duplicate.
- The redirect URI is derived by Better Auth as `${baseURL}${basePath}/callback/google` —
  `https://api.mevivek.dev/api/v1/auth/callback/google`. It must be registered verbatim in the
  Google console.
- One shared `GoogleButton` component serves both sign-in and sign-up, because the OAuth flow is
  identical for both — Google tells us whether the account is new.

### `trustedProviders` is a security control, not a convenience

Linking accounts by email address is only safe when the provider **verifies** the address. Google
does, and the created user row carries `email_verified = true` from Google's own claim. Adding a
provider that does *not* verify emails to that list would be an account-takeover vector: anyone
able to create an account at that provider using the maintainer's email address could then link
to, and sign in as, the existing account. **Do not add a provider to `trustedProviders` without
confirming it verifies email addresses.**

## Alternatives considered

- **Google only, drop email+password.** Simpler: one code path, no password storage, and it
  eliminates the no-password-reset debt outright rather than merely mitigating it. Rejected
  because it makes a single Google account the only way into a system whose stated long-term goal
  is a password vault ([ADR-0010](0010-vault-key-hierarchy.md)). A locked or lost Google account
  would mean losing access to everything, and "recover your Google account" is not a recovery
  story this project controls. Two independent routes in is worth the extra code path.
- **Email+password only, and build password reset instead.** The orthodox fix for the actual debt.
  Rejected for now on cost, not principle: it needs an email provider, deliverability
  configuration, and reset-token handling, against Google sign-in's one console form. Password
  reset remains on the roadmap — this decision reduces its urgency, it does not cancel it.
- **Magic links.** No passwords at all, and Better Auth supports them. Rejected for the same
  reason as password reset: it needs the email provider that does not exist yet. Worth
  reconsidering when that lands, since it would suit a single-user app well.
- **Passkeys instead.** Genuinely the right long-term answer, and already the recorded intent for
  this app ([security-model.md](../security-model.md) §2). Not rejected — deferred. Passkeys are a
  hard prerequisite for the vault (debt D3) and remain so. Google sign-in is a cheap improvement
  in the meantime, not a substitute.
- **Google identity for the vault too.** Explicitly not done. Vault access derives from a
  passphrase the server never sees ([ADR-0010](0010-vault-key-hierarchy.md)); tying it to an OAuth
  session would mean the server could unlock it, which is not end-to-end encryption. Signing in
  and unlocking the vault are, and must stay, separate acts.

## Consequences

**Good:** A working second route in, so a forgotten password is no longer an
edit-the-database event. Email is verified by Google, which is stronger than anything this app
would do itself at M0. No email provider needed. The provider is optional, so a deployment
without credentials still boots and still works.

**Bad:** A dependency on Google for one of the two sign-in paths, and on an OAuth client that
lives in a console rather than in this repo — a config change nothing here can detect. Client
secret rotation is now a thing that must be remembered. Two authentication paths mean two paths
to test, and account linking is a subtle area where the safe behaviour depends on a provider
property (email verification) that is invisible in our own code.

**Confirmed while verifying, worth recording:** the personal-space creation hook
([ADR-0006](0006-space-based-ownership.md)) fires for OAuth signups as well as email+password, so
a Google-created user gets exactly one personal space with the `owner` role. That was an
assumption until it was observed.

**Revisit if:** passkeys land (this becomes the fallback rather than the convenient path), or an
email provider is added (password reset and magic links become available, reducing the reliance on
Google).
