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

  /**
   * The document identifier — ADR-0026, and the reason this list stopped being belt-and-braces.
   *
   * Until then the API truncated to four characters at the boundary, so the worst a log could leak
   * was a mask. It now stores the value in full, which means a request body or a detail response
   * caught in a log line is a whole Aadhaar or passport number. `identifier_last4` is deliberately
   * NOT redacted: it is the display form, it is in every list, and censoring it would make request
   * logs unreadable while protecting nothing.
   */
  'identifier',
  '*.identifier',

  /**
   * A thing's serial — IMEI, vehicle registration, hallmark, order number. things.md §4 rule 7 puts
   * it in this list by name, for exactly the reason `identifier` is here: it is stored **in full**
   * and in plaintext (invariant 7, ADR-0009), so a request body or a detail response caught in a log
   * line is a whole registration number.
   *
   * `serial_last4` is deliberately NOT redacted, on the same reasoning as `identifier_last4`: it is
   * the display form, it is on every list row, and censoring it would make request logs unreadable
   * while protecting nothing.
   */
  'serial',
  '*.serial',
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
