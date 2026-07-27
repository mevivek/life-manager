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

const envSchema = z.object({
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
  WEB_ORIGIN: originSchema,

  /**
   * `Domain` attribute for the session cookie, e.g. `.mevivek.dev`. Undefined in local dev,
   * where `localhost` is already same-site. ADR-0019.
   */
  COOKIE_DOMAIN: z.string().min(1).optional(),
})

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
