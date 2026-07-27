# ADR-0007: Better Auth, self-hosted in our own Postgres

- **Status:** accepted
- **Date:** 2026-07-26

## Context

Authentication requirements, in rough order of importance:

1. **Works for both transports** — cookies for the web PWA, bearer tokens for future native
   clients ([ADR-0002](0002-api-first-decoupling.md)).
2. **Users join cleanly to domain data.** Every record references a space, every space has
   members, every member is a user. If users live in an external system, that join crosses
   a network boundary and the two stores can drift.
3. **Passkeys eventually.** This app will hold identity documents and, later, a password
   vault. A reused password is the weakest link in that design, not the crypto
   ([security-model.md](../security-model.md) §5).
4. **The vault needs per-user crypto material** — Argon2id salts and parameters, an X25519
   public key, a wrapped private key. These belong in our schema, adjacent to the user.
5. Free at single-user scale, and not priced per monthly active user if it grows.

This was the closest call in the stack. It is recorded in full because a future session
will reasonably wonder why a solo maintainer didn't just use a managed service.

## Decision

**Better Auth, self-hosted inside the Fastify app, with its tables in our own Postgres.**

- Email + password to start; passkeys (WebAuthn) and TOTP 2FA are first-party plugins,
  enabled before going public.
- Web: `httpOnly`, `Secure`, `SameSite=Lax` session cookie. Native: bearer token. Both
  resolve to the same `ActorContext`.
- A Fastify hook resolves the session, loads space memberships, and attaches the actor.
- **Signup transactionally creates the user's personal space**
  ([ADR-0006](0006-space-based-ownership.md)).

Better Auth is a library, not a service. This is not "rolling your own auth" — password
hashing, session management, rate limiting, password reset, and account-enumeration
defenses are all handled by it.

## Alternatives considered

- **Supabase Auth.** The obvious managed choice: battle-tested, handles email delivery, and
  free at this scale. Rejected on requirements 2 and 4. Users would live in Supabase's
  `auth.users` while spaces and documents live in our Postgres — so every membership join
  crosses systems, and the two can drift (a user deleted in one, orphaned rows in the
  other). Storing vault key material would mean a parallel profile table keyed by an
  external ID. It also does not support passkeys natively, only via a third-party
  integration. Given [ADR-0005](0005-postgres-neon-drizzle.md) already rejected Supabase
  for the database, adopting it for auth alone means a second vendor for one feature.

  **Documented fallback:** if email deliverability or auth operations become a real burden,
  Supabase Auth is the escape hatch. It would require a profile table and an ID-mapping
  strategy. Write a superseding ADR.

- **Clerk.** Best-in-class DX, excellent prebuilt UI, passkeys and MFA included. Rejected on
  cost trajectory and lock-in: per-MAU pricing is irrelevant at one user and material if
  this goes public, the user store is fully external (requiring webhook-synced shadow
  records — precisely the drift problem in requirement 2), and the prebuilt UI assumes a
  React web app, which the future native clients are not.

- **Auth0 / WorkOS.** Enterprise-grade, more than this needs, priced accordingly.

- **Lucia.** Was the standard self-hosted TypeScript answer. Deprecated as a library in
  favor of being a learning resource — not a foundation to build on now.

- **Rolling our own sessions.** Rejected. Password hashing, timing-safe comparison, session
  rotation, reset-token expiry, and enumeration defenses are all easy to get subtly wrong,
  and this app guards identity documents and eventually a vault.

## Consequences

**Good:** One database holds users, spaces, and domain data — memberships are an ordinary
foreign key, and there is no synchronization to drift. Vault key material sits naturally
beside the user. Passkeys and 2FA are configuration, not migration. No per-MAU pricing, no
vendor lock-in on the most entangled part of any application.

**Bad:** Email delivery is now our problem — password resets and verification need an
external provider (Resend or similar) configured and monitored. Auth is in our threat
surface: a Better Auth CVE is our patch to apply. Less training-data coverage than
NextAuth, so a session may need its docs. Auth-related config lives in our environment
variables, which must never enter the repo
([security-model.md](../security-model.md) §6).

**Revisit if:** email operations become a recurring maintenance burden, or a Better Auth
security incident suggests the library isn't holding up. Fallback is Supabase Auth, above.
