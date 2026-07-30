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

    /**
     * Cloudflare R2 (ADR-0008). Optional as a **group of four**: with none of them, file
     * endpoints answer 503 and the rest of Documents works normally. That matters more than it
     * sounds — it means `pnpm test` and a fresh clone need no storage credential at all, and
     * presigning is pure local computation so tests exercise the real code path with fake keys.
     *
     * `R2_PUBLIC_BASE_URL` is deliberately absent and must stay absent: the bucket has no public
     * access, ever (ADR-0008). Every read goes through a presigned GET.
     */
    R2_ACCOUNT_ID: z.string().min(1).optional(),
    R2_ACCESS_KEY_ID: z.string().min(1).optional(),
    R2_SECRET_ACCESS_KEY: z.string().min(1).optional(),
    R2_BUCKET: z.string().min(1).optional(),

    /** How long a presigned upload or download URL stays valid. Minutes, per ADR-0008. */
    R2_PRESIGN_TTL_SECONDS: z.coerce.number().int().min(30).max(3600).default(600),

    /**
     * Overrides the derived R2 endpoint, for pointing at any S3-compatible server instead.
     *
     * **Leave this unset in production.** Its purpose is verifying the upload path end to end
     * against a local MinIO — which is the one part of ADR-0008's flow that unit tests cannot
     * cover, because presigning is offline and a fake bucket never checks the signature. Setting it
     * also switches the client to **path-style** addressing, which a localhost endpoint requires
     * and R2 does not.
     */
    R2_ENDPOINT: z.url().optional(),

    /**
     * Web Push / VAPID (RFC 8292), for reminder delivery.
     *
     * Optional as a **group** for the same reason as R2. The public key is public by design — it
     * is served to the browser so it can subscribe — while the private key never leaves the API.
     * Generate a pair with `node scripts/generate-vapid-keys.mjs`; the format is that script's,
     * not the one other VAPID tools emit, so do not mix sources.
     */
    VAPID_PUBLIC_KEY: z.string().min(1).optional(),
    VAPID_PRIVATE_KEY: z.string().min(1).optional(),
    /** `mailto:` or an https URL. RFC 8292 requires a contact for the push service operator. */
    VAPID_SUBJECT: z.string().min(1).optional(),

    /**
     * Whether to register pg-boss's recurring schedules.
     *
     * **Off by default, decided 2026-07-27** (product/open-questions.md §2): a daily cron against
     * a database with three test documents earns nothing, and a schedule means *something must
     * always be running*, which is what forces an always-on host and keeps Neon's compute awake
     * (ADR-0012, ADR-0014). Handlers are registered regardless, so `boss.send('reminders.scan',
     * {})` still works in development — only the clock is switched off.
     */
    ENABLE_SCHEDULED_JOBS: z
      .enum(['true', 'false'])
      .default('false')
      .transform((value) => value === 'true'),

    /**
     * Shared secret for `POST /api/v1/maintenance::run-daily`, sent as `X-Cron-Key` (ADR-0028).
     *
     * **Optional, and unset means the endpoint is CLOSED, not open.** With no value the route answers
     * 503 — the same "configured feature, absent credential" posture as R2 and VAPID, and the reason
     * `pnpm test` and a fresh clone need no secret. Fail-closed is the only acceptable default here:
     * this endpoint sends notifications and writes `sent_at`, so an unauthenticated caller could burn
     * a user's real reminders.
     *
     * 32 characters minimum, generated with `openssl rand -base64 32`. It is compared against the
     * header in constant time (see `maintenance.service.ts`) — a `===` on a secret leaks its prefix
     * through timing, and the fix is cheaper than the argument about whether it is exploitable.
     *
     * **Why a shared secret rather than a Google OIDC token**, which is Cloud Scheduler's more
     * idiomatic option: the Cloud Run service must stay publicly invocable because the browser calls
     * it, so platform-level IAM cannot protect one path. Verifying the OIDC JWT in-process would mean
     * a JWKS fetch, a cache, and a JWT verifier this project does not have — and CLAUDE.md invariant 8
     * forbids hand-rolling that. A 32-byte secret in Secret Manager, compared in constant time, is a
     * mechanism whose failure modes fit in a paragraph. Revisit if the API ever stops needing to be
     * public.
     */
    CRON_SECRET: z.string().min(32, 'must be at least 32 characters').optional(),

    /**
     * Escape hatch for the migrate-on-boot in `server.ts` (ADR-0023).
     *
     * **Defaults to applying them**, and that default is the entire point: nothing else applies
     * migrations on this deployment, and a variable that had to be set to make deploys work would
     * need a `gcloud` change — which is exactly the manual step debt D22 was closed to remove.
     *
     * Set it only to get a process up against a database you deliberately do not want touched.
     */
    SKIP_MIGRATIONS_ON_BOOT: z
      .enum(['true', 'false'])
      .default('false')
      .transform((value) => value === 'true'),
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
  .refine(
    (value) => {
      const parts = [
        value.R2_ACCOUNT_ID,
        value.R2_ACCESS_KEY_ID,
        value.R2_SECRET_ACCESS_KEY,
        value.R2_BUCKET,
      ]
      return parts.every((part) => part === undefined) || parts.every((part) => part !== undefined)
    },
    {
      message:
        'R2_ACCOUNT_ID, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY and R2_BUCKET must all be set, or none. A half-configured bucket fails at the first upload, long after boot.',
      path: ['R2_BUCKET'],
    },
  )
  .refine(
    (value) => {
      const parts = [value.VAPID_PUBLIC_KEY, value.VAPID_PRIVATE_KEY, value.VAPID_SUBJECT]
      return parts.every((part) => part === undefined) || parts.every((part) => part !== undefined)
    },
    {
      message:
        'VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY and VAPID_SUBJECT must all be set, or none. A half-configured pair fails at delivery time, which is a background job and therefore invisible.',
      path: ['VAPID_PRIVATE_KEY'],
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

/**
 * Narrowed accessors for the two optional feature groups.
 *
 * Returning a fully-typed object or `null` — rather than letting callers read four independent
 * `string | undefined`s — is what stops every call site re-deriving "is this configured?" and
 * getting it subtly different. The `refine` above guarantees all-or-nothing, so one check here is
 * enough to narrow all four.
 */
export function r2Config(): {
  accountId: string
  accessKeyId: string
  secretAccessKey: string
  bucket: string
  ttlSeconds: number
  /** Set only when `R2_ENDPOINT` overrides the derived R2 host. */
  endpointOverride: string | undefined
} | null {
  const { R2_ACCOUNT_ID, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY, R2_BUCKET } = env
  if (
    R2_ACCOUNT_ID === undefined ||
    R2_ACCESS_KEY_ID === undefined ||
    R2_SECRET_ACCESS_KEY === undefined ||
    R2_BUCKET === undefined
  ) {
    return null
  }

  return {
    accountId: R2_ACCOUNT_ID,
    accessKeyId: R2_ACCESS_KEY_ID,
    secretAccessKey: R2_SECRET_ACCESS_KEY,
    bucket: R2_BUCKET,
    ttlSeconds: env.R2_PRESIGN_TTL_SECONDS,
    endpointOverride: env.R2_ENDPOINT,
  }
}

export function vapidConfig(): {
  publicKey: string
  privateKey: string
  subject: string
} | null {
  const { VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY, VAPID_SUBJECT } = env
  if (
    VAPID_PUBLIC_KEY === undefined ||
    VAPID_PRIVATE_KEY === undefined ||
    VAPID_SUBJECT === undefined
  ) {
    return null
  }

  return {
    publicKey: VAPID_PUBLIC_KEY,
    privateKey: VAPID_PRIVATE_KEY,
    subject: VAPID_SUBJECT,
  }
}
