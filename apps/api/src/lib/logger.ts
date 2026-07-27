import { type LoggerOptions, pino } from 'pino'
import { env, isProduction, isTest } from '../env.js'

/**
 * The redaction list is a security control, not a nicety (security-model.md §6,
 * conventions/code.md §7). **Add to it whenever you add a sensitive field.**
 *
 * Every path is listed twice — once for the request/response objects Fastify serialises
 * automatically, once for anything we pass explicitly — because pino's `redact.paths` are
 * literal paths, not a pattern matched anywhere in the tree.
 */
export const REDACTED_PATHS = [
  // Session and credential transports.
  'req.headers.cookie',
  'req.headers.authorization',
  'res.headers["set-cookie"]',
  'headers.cookie',
  'headers.authorization',
  'headers["set-cookie"]',

  // Anything a body might carry. Auth endpoints post passwords through this process.
  'password',
  '*.password',
  'newPassword',
  '*.newPassword',
  'token',
  '*.token',
  'secret',
  '*.secret',

  // M5, the vault. Listed now so the list is not the thing that gets forgotten later.
  'passphrase',
  '*.passphrase',
  'recoveryCode',
  '*.recoveryCode',

  // M1, R2. A presigned URL is a bearer credential in a query string.
  'presignedUrl',
  '*.presignedUrl',
] as const

export const loggerOptions = {
  level: isTest ? 'silent' : env.LOG_LEVEL,
  redact: {
    paths: [...REDACTED_PATHS],
    censor: '[redacted]',
  },
  // Structured JSON to stdout in production — Fly's log shipper reads it. pino-pretty is a
  // development convenience and must never be in the production path.
  ...(isProduction || isTest
    ? {}
    : { transport: { target: 'pino-pretty', options: { translateTime: 'HH:MM:ss.l' } } }),
} satisfies LoggerOptions

/**
 * For anything outside a request: boot, shutdown, jobs, migrations. Inside a request use
 * `request.log`, which carries `reqId` automatically.
 */
export const logger = pino(loggerOptions)
