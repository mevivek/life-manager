import { PROBLEM_BASE_URI, type Problem } from '@life-manager/shared'
import type { FastifyError, FastifyInstance, FastifyReply, FastifyRequest } from 'fastify'
import {
  hasZodFastifySchemaValidationErrors,
  isResponseSerializationError,
} from 'fastify-type-provider-zod'
import { isAppError } from './errors.js'

/**
 * RFC 9457 `application/problem+json`, for every error the API emits. conventions/api.md §3.
 *
 * One error handler and one not-found handler, and no route sets an error status itself.
 * Centralising it is what makes "cross-space returns 404, never 403" a property of the
 * codebase rather than of each author's memory.
 */

export const PROBLEM_CONTENT_TYPE = 'application/problem+json'

/** Human-readable titles, keyed by slug. The slug comes from the error class, so it cannot
 * drift from the `type` URI. */
const TITLES: Record<string, string> = {
  'validation-failed': 'Validation failed',
  unauthorized: 'Authentication required',
  forbidden: 'Forbidden',
  'not-found': 'Not found',
  conflict: 'Conflict',
  unprocessable: 'Unprocessable',
  'payload-too-large': 'Payload too large',
  'rate-limited': 'Too many requests',
  'unsupported-media-type': 'Unsupported media type',
  'not-configured': 'Feature not configured',
  'internal-error': 'Internal server error',
}

/**
 * The only `detail` a 500 is ever allowed to carry. No `err.message`, no stack, no SQL, no
 * Postgres text — conventions/api.md §3 and code.md §6.
 */
const OPAQUE_500_DETAIL = 'Something went wrong. The failure has been logged.'

export function toProblem(args: {
  slug: string
  status: number
  detail: string
  instance?: string
  errors?: Problem['errors']
}): Problem {
  return {
    type: `${PROBLEM_BASE_URI}/${args.slug}`,
    title: TITLES[args.slug] ?? 'Error',
    status: args.status,
    detail: args.detail,
    ...(args.instance === undefined ? {} : { instance: args.instance }),
    ...(args.errors === undefined ? {} : { errors: args.errors }),
  }
}

function send(reply: FastifyReply, problem: Problem): FastifyReply {
  return reply.status(problem.status).type(PROBLEM_CONTENT_TYPE).send(problem)
}

/** Maps a bare Fastify status onto a slug for the cases we do not raise ourselves. */
function slugForStatus(status: number): string {
  switch (status) {
    case 400:
      return 'validation-failed'
    case 401:
      return 'unauthorized'
    case 403:
      return 'forbidden'
    case 404:
      return 'not-found'
    case 409:
      return 'conflict'
    case 413:
      return 'payload-too-large'
    case 415:
      return 'unsupported-media-type'
    case 422:
      return 'unprocessable'
    case 429:
      return 'rate-limited'
    case 503:
      return 'not-configured'
    default:
      return 'internal-error'
  }
}

/** Builds the `429` body so the rate limiter's response conforms like everything else. */
export function rateLimitProblem(request: FastifyRequest, retryAfterSeconds: number): Problem {
  return toProblem({
    slug: 'rate-limited',
    status: 429,
    detail: `Too many requests. Try again in ${retryAfterSeconds} second(s).`,
    instance: request.url,
  })
}

export function registerProblemHandlers(app: FastifyInstance): void {
  app.setNotFoundHandler((request, reply) =>
    send(
      reply,
      toProblem({
        slug: 'not-found',
        status: 404,
        detail: 'No route matches that path.',
        instance: request.url,
      }),
    ),
  )

  // The explicit type argument matters: Fastify 5 types the handler's error as `unknown`,
  // so without it step 4 cannot read `statusCode`.
  app.setErrorHandler<FastifyError>((error, request, reply) => {
    // The guards below take `unknown`, so narrowing them against `error` directly would
    // whittle its declared `FastifyError` type down to nothing by the time step 4 needs
    // `error.statusCode`. Narrow a separate alias instead.
    const thrown: unknown = error

    // 1. Request failed its Zod schema → 400 with per-field detail. Safe to return: the
    //    client sent it.
    if (hasZodFastifySchemaValidationErrors(thrown)) {
      return send(
        reply,
        toProblem({
          slug: 'validation-failed',
          status: 400,
          detail: 'The request did not match the expected shape.',
          instance: request.url,
          errors: thrown.validation.map((issue) => ({
            path: issue.instancePath.replace(/^\//, '') || '(body)',
            message: issue.message ?? 'Invalid',
          })),
        }),
      )
    }

    // 2. A RESPONSE failed its own schema. That is a bug in our code, and the client must
    //    learn nothing about it.
    if (isResponseSerializationError(thrown)) {
      request.log.error(
        { err: thrown, method: thrown.method, url: thrown.url, issues: thrown.cause.issues },
        'response failed its own schema',
      )
      return send(
        reply,
        toProblem({
          slug: 'internal-error',
          status: 500,
          detail: OPAQUE_500_DETAIL,
          instance: request.url,
        }),
      )
    }

    // 3. A domain error thrown by a service.
    if (isAppError(thrown)) {
      request.log.info(
        { err: thrown.name, userId: request.actor?.userId },
        'request rejected by a domain rule',
      )
      return send(
        reply,
        toProblem({
          slug: thrown.slug,
          status: thrown.status,
          detail: thrown.message,
          instance: request.url,
        }),
      )
    }

    // 4. A Fastify or plugin error that already carries a client-safe 4xx.
    const status = error.statusCode ?? 500
    if (status >= 400 && status < 500) {
      request.log.warn({ err: error, userId: request.actor?.userId }, 'client error')
      return send(
        reply,
        toProblem({
          slug: slugForStatus(status),
          status,
          detail: error.message,
          instance: request.url,
        }),
      )
    }

    // 5. Anything else is a bug. Log everything, return nothing.
    request.log.error({ err: error, userId: request.actor?.userId }, 'unhandled error')
    return send(
      reply,
      toProblem({
        slug: 'internal-error',
        status: 500,
        detail: OPAQUE_500_DETAIL,
        instance: request.url,
      }),
    )
  })
}
