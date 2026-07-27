import { z } from 'zod'

/**
 * The ONLY module in the codebase that reads `process.env`. Everything else imports `env`.
 *
 * It throws at boot on anything missing or malformed, on purpose: a missing `DATABASE_URL`
 * should stop the process with a message that names the variable, not surface forty seconds
 * later as a connection error on the first request.
 *
 * Variable documentation lives in `.env.example` at the repo root. Values never do
 * (security-model.md §6, CLAUDE.md invariant 11).
 */

const logLevelSchema = z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent'])

/**
 * An absolute origin with no path — `https://api.mevivek.dev`, not
 * `https://api.mevivek.dev/api/v1`. Better Auth treats a `baseURL` that contains a path as
 * an override of `basePath`, which would silently relocate every auth route.
 */
const originSchema = z
  .url()
  .refine((value) => new URL(value).pathname === '/', 'must be an origin with no path')

/**
 * A comma-separated list of origins, e.g.
 * `https://app.mevivek.dev,http://localhost:5173`.
 *
 * A list rather than a single value because CORS and Better Auth's `trustedOrigins` must accept
 * every front end that legitimately talks to this API, and there is more than one: the deployed
 * app, and `localhost:5173` during development. With a single value those two are mutually
 * exclusive — pointing the API at a tunnel hostname makes local development fail with a 403
 * from the origin check, which reads like a bug rather than a config choice.
 *
 * Order matters only in that the FIRST entry is treated as canonical wherever one origin is
 * needed.
 */
const originListSchema = z
  .string()
  .transform((value) =>
    value
      .split(',')
      .map((entry) => entry.trim())
      .filter((entry) => entry.length > 0),
  )
  .pipe(z.array(originSchema).min(1, 'needs at least one origin'))

const envSchema = z
  .object({
    NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
    PORT: z.coerce.number().int().min(1).max(65535).default(8080),
    HOST: z.string().min(1).default('127.0.0.1'),
    LOG_LEVEL: logLevelSchema.default('info'),

    /** Reported by `GET /api/v1/health`. Fly sets it from the release; local dev does not. */
    APP_VERSION: z.string().min(1).default('0.0.0-dev'),

    /** Neon POOLED endpoint. The app's pg Pool. ADR-0005. */
    DATABASE_URL: z.string().min(1),

    /**
     * Neon DIRECT endpoint, same database. drizzle-kit and pg-boss only.
     * pg-boss needs LISTEN/NOTIFY and session-level advisory locks; neither survives
     * PgBouncer transaction pooling, and a session lock taken on one backend and released on
     * another leaks forever. ADR-0012.
     */
    DATABASE_URL_UNPOOLED: z.string().min(1),

    BETTER_AUTH_SECRET: z.string().min(32, 'must be at least 32 characters'),

    API_BASE_URL: originSchema,

    /** One or more comma-separated origins. See `originListSchema`. Typed as `string[]`. */
    WEB_ORIGIN: originListSchema,

    /**
     * `Domain` attribute for the session cookie, e.g. `.mevivek.dev`.
     *
     * **Normally leave this UNSET, including in production.** `SameSite=Lax` keys on the
     * registrable domain, not the host, so a host-only cookie on the API subdomain is already sent
     * on requests from the app subdomain. Setting a `Domain` widens the cookie to *every*
     * subdomain of mevivek.dev — the personal site and any other tunnel included — for no benefit.
     * Verified over the real tunnel; ADR-0019 amended accordingly.
     */
    COOKIE_DOMAIN: z.string().min(1).optional(),

    /**
     * Google OAuth. Optional as a PAIR: with neither, the provider is simply not registered and
     * email+password still works. The client id is public by design (it is visible in the browser
     * during the OAuth redirect); the secret is not.
     */
    GOOGLE_CLIENT_ID: z.string().min(1).optional(),
    GOOGLE_CLIENT_SECRET: z.string().min(1).optional(),
  })
  .refine(
    (value) =>
      (value.GOOGLE_CLIENT_ID === undefined) === (value.GOOGLE_CLIENT_SECRET === undefined),
    {
      message:
        'GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET must be set together, or neither. Half-configured OAuth fails at the redirect, which is a confusing place to discover it.',
      path: ['GOOGLE_CLIENT_SECRET'],
    },
  )

export type Env = z.infer<typeof envSchema>

/**
 * A `.env` file cannot express "absent" — `COOKIE_DOMAIN=` yields `''`, not `undefined`, so
 * `.optional()` would never fire and `.min(1)` would fail on a variable that is legitimately
 * unset. Treat empty as absent before parsing.
 */
function withoutEmptyValues(source: NodeJS.ProcessEnv): Record<string, string> {
  const result: Record<string, string> = {}
  for (const [key, value] of Object.entries(source)) {
    if (value !== undefined && value !== '') result[key] = value
  }
  return result
}

function parseEnv(source: NodeJS.ProcessEnv): Env {
  const parsed = envSchema.safeParse(withoutEmptyValues(source))
  if (parsed.success) return parsed.data

  const detail = parsed.error.issues
    .map((issue) => `  ${issue.path.join('.') || '(root)'}: ${issue.message}`)
    .join('\n')

  // Names only. Never echo a value — this message reaches logs and terminals.
  throw new Error(`Invalid environment. Fix these variables (see .env.example):\n${detail}\n`)
}

export const env: Env = parseEnv(process.env)

export const isProduction = env.NODE_ENV === 'production'
export const isTest = env.NODE_ENV === 'test'

/**
 * Whether to mark session cookies `Secure`.
 *
 * Derived from the API's own scheme rather than from `NODE_ENV`, because those disagree in the
 * case that matters: exercising the real deployment shape over an HTTPS tunnel while still
 * running `NODE_ENV=development`. Keying off `NODE_ENV` there would silently drop `Secure`, so
 * the thing being tested would not be the thing that ships (security-model.md §2, ADR-0019).
 */
export const useSecureCookies = new URL(env.API_BASE_URL).protocol === 'https:'
