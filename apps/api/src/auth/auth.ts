import { randomUUID } from 'node:crypto'
import { drizzleAdapter } from '@better-auth/drizzle-adapter'
import { MIN_PASSWORD_LENGTH } from '@life-manager/shared'
import { betterAuth } from 'better-auth'
import { bearer } from 'better-auth/plugins/bearer'
import { db } from '../db/client.js'
import * as schema from '../db/schema/index.js'
import { ensurePersonalSpace } from '../domains/spaces/spaces.service.js'
import { env, isTest, useSecureCookies } from '../env.js'
import { logger } from '../lib/logger.js'

/**
 * The Google provider config, or `undefined` when this deployment has no credentials.
 *
 * Written ONCE, here, and read twice below: by `socialProviders` and by `isGoogleConfigured`. The
 * `=== undefined` pair is also what narrows both values to `string`, so the object below needs no
 * assertion.
 */
const googleProvider =
  env.GOOGLE_CLIENT_ID === undefined || env.GOOGLE_CLIENT_SECRET === undefined
    ? undefined
    : { clientId: env.GOOGLE_CLIENT_ID, clientSecret: env.GOOGLE_CLIENT_SECRET }

/**
 * Whether Google OAuth is actually available on THIS deployment.
 *
 * **One source of truth, and that is the entire reason it is a named export rather than a condition
 * the endpoint re-derives** (ADR-0035). `GET /api/v1/auth/providers` tells the sign-in screen whether
 * its one button can work, and the screens delete the password fields on the strength of that answer.
 * Two copies of the condition could disagree — and the way they would disagree is a screen with a
 * single dead control and no way back in but a redeploy.
 *
 * Derived from the same `googleProvider` value that decides registration, so this cannot claim a
 * capability the auth instance does not have.
 */
export const isGoogleConfigured = googleProvider !== undefined

/**
 * Better Auth, self-hosted, with its tables in our own Postgres (ADR-0007).
 *
 * Every non-obvious option below is load-bearing. Read the comment before changing one.
 */
export const auth = betterAuth({
  appName: 'life-manager',
  secret: env.BETTER_AUTH_SECRET,

  /**
   * ORIGIN ONLY. If `baseURL` contains a path it OVERRIDES `basePath`, silently relocating
   * every auth route — `src/env.ts` refuses a value with a path for exactly this reason.
   */
  baseURL: env.API_BASE_URL,

  /**
   * conventions/api.md §1: everything lives under `/api/v1/`. Better Auth's own default is
   * `/api/auth`, which would be the one unversioned surface in the API.
   *
   * Consequence to know: the endpoint paths *below* this prefix are shaped by the library
   * (`/sign-up/email`, `/sign-in/email`, …) and they do NOT appear in
   * `/api/v1/openapi.json`, because @fastify/swagger only sees routes Fastify declared with a
   * schema. Registered as debt (docs/product/review.md D13).
   */
  basePath: '/api/v1/auth',

  trustedOrigins: env.WEB_ORIGIN,

  database: drizzleAdapter(db, {
    provider: 'pg',
    schema,
    /**
     * Better Auth's defaults are singular (`user`, `session`); conventions/data.md §7 requires
     * plural snake_case. This is a config option, not an edit to generated code.
     */
    usePlural: true,
  }),

  emailAndPassword: {
    enabled: true,
    /**
     * OFF at M0, and that is a real gap rather than an oversight: verification needs a
     * transactional email provider, which is M1. Consequence, stated plainly: **there is no
     * password reset**, so a forgotten password means deleting the row from the database.
     * Registered as debt (docs/product/review.md D12) with a trigger.
     */
    requireEmailVerification: false,
    minPasswordLength: MIN_PASSWORD_LENGTH,
    maxPasswordLength: 128,
  },

  /**
   * Google OAuth, registered only when BOTH credentials are present (env.ts enforces the pair).
   * Without them this is an empty object and email+password is the only route in.
   *
   * Better Auth derives the redirect URI as `${baseURL}${basePath}/callback/google`, i.e.
   * `https://api.mevivek.dev/api/v1/auth/callback/google`. That exact string must be registered
   * in the Google Cloud console — a mismatch fails at the redirect with Google's own error page,
   * not ours, which is a confusing place to debug.
   *
   * `googleProvider` above is the ONE place the credentials are checked; `isGoogleConfigured` — what
   * `GET /api/v1/auth/providers` answers with — is derived from the same value (ADR-0035).
   */
  socialProviders: googleProvider === undefined ? {} : { google: googleProvider },

  /**
   * Account linking, so signing in with Google using an email that already has a password
   * account resolves to ONE user rather than a duplicate.
   *
   * **`trustedProviders` is a security control, not a convenience.** Linking by email is only
   * safe when the provider verifies the address. Google does. Listing an unverified provider
   * here would let anyone who can create an account with your email address take over your
   * existing one, so do not add a provider without checking that it verifies emails.
   */
  account: {
    accountLinking: {
      enabled: true,
      trustedProviders: ['google'],
    },
  },

  /**
   * Native clients send `Authorization: Bearer <token>` against the SAME session store as the
   * web cookie (security-model.md §2). Enabling it now costs nothing and means the actor hook
   * has one code path instead of a branch on client type later.
   */
  plugins: [bearer()],

  advanced: {
    /**
     * conventions/data.md §4: identifiers are uuid. Better Auth's default generator produces a
     * 32-character random string, which would force `created_by` — and therefore every future
     * domain table — to use `text` instead. See src/db/schema/auth.ts.
     *
     * `generateId: 'uuid'` also exists in 1.6, but it delegates id generation to the database
     * for postgres; generating here keeps it independent of adapter behaviour.
     */
    database: { generateId: () => randomUUID() },

    /**
     * security-model.md §2: httpOnly, Secure, SameSite=Lax.
     *
     * Keyed off the API's scheme, not `NODE_ENV` — see `useSecureCookies` in env.ts. `Secure`
     * over plain http://localhost would mean the cookie is never stored, and keying off
     * NODE_ENV would mean an HTTPS tunnel test silently ran without it.
     */
    useSecureCookies,
    defaultCookieAttributes: {
      httpOnly: true,
      sameSite: 'lax',
      path: '/',
    },

    /**
     * ADR-0019. The web app is `app.mevivek.dev` and the API is `api.mevivek.dev`. Those are
     * subdomains of one registrable domain, so they are same-SITE and a `SameSite=Lax` cookie
     * is sent on the API call — but the cookie needs `Domain=.mevivek.dev` to be visible from
     * both. Undefined locally, where the Vite proxy makes everything same-ORIGIN anyway.
     */
    ...(env.COOKIE_DOMAIN === undefined
      ? {}
      : { crossSubDomainCookies: { enabled: true, domain: env.COOKIE_DOMAIN } }),
  },

  /**
   * Library-level limiter, in addition to the tighter per-route bucket on the Fastify side.
   *
   * Off in tests: its default signup window is a few requests per ten seconds, which makes a
   * fixture that signs up three users impossible. The limiter we own — the per-route bucket in
   * auth.routes.ts — is the one that matters and it stays on outside tests.
   */
  rateLimit: { enabled: !isTest },

  /**
   * Explicitly off. `@better-auth/telemetry` is a bundled dependency and this application
   * holds one person's identity documents; nothing about it phones home.
   */
  telemetry: { enabled: false },

  databaseHooks: {
    user: {
      create: {
        /**
         * Runs AFTER the user-insert transaction commits (better-auth #7260), which is why
         * `ensurePersonalSpace` is idempotent and guarded by a unique index rather than
         * relying on being inside that transaction. Full reasoning in spaces.service.ts.
         */
        after: async (user) => {
          try {
            await ensurePersonalSpace(user.id, user.name)
          } catch (error) {
            // Log with context and RETHROW — never swallow (conventions/code.md §6). Better
            // Auth surfaces the failure, the user retries, and the retry is safe.
            logger.error({ err: error, userId: user.id }, 'failed to create personal space')
            throw error
          }
        },
      },
    },
  },
})
