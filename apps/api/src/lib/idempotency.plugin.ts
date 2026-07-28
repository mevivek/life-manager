import { createHash } from 'node:crypto'
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify'
import fp from 'fastify-plugin'
import { requireActor } from '../auth/actor.js'
import { ConflictError } from './errors.js'
import * as repository from './idempotency.repository.js'
import { PROBLEM_CONTENT_TYPE } from './problem.js'

/**
 * `Idempotency-Key` handling, as one plugin rather than per route. conventions/api.md §5, and
 * the closing of debt **D9**.
 *
 * Why this exists at all: a mobile client retries on a flaky connection, and without this a
 * retried `POST /documents` creates two documents. That is not hypothetical — it is the single
 * failure mode §5 was written to prevent, and D9's trigger named this exact endpoint.
 *
 * **The header is optional, and that is deliberate.** §5 says every mutation *accepts* the
 * header, not that it requires one. Requiring it would break `curl` and every hand-written
 * request for a guarantee only an unreliable client needs. A mutation without the header behaves
 * exactly as it did before.
 *
 * Flow, for a mutation that does send one:
 *
 * 1. `preHandler` — hash the body and **claim** the key with a single `insert … on conflict do
 *    nothing`. Winning the claim means we own the operation.
 * 2. Lost the claim, stored response present → **replay** it, handler never runs.
 * 3. Lost the claim, different body hash → **409**. A key reused for a different operation is a
 *    client bug; replaying the first response would hide it.
 * 4. Lost the claim, no stored response yet → the original is still in flight → **409**.
 * 5. `onSend` — record a 2xx response for replay, or release the claim on a failure so a real
 *    retry is still possible.
 */

const MUTATING_METHODS = new Set(['POST', 'PATCH', 'PUT', 'DELETE'])
const HEADER = 'idempotency-key'

/**
 * Per-request bookkeeping. On the request rather than in a module-level map, so nothing leaks
 * between requests and there is no cache to invalidate.
 */
type IdempotencyState = { key: string; endpoint: string; spaceId: string }

declare module 'fastify' {
  interface FastifyRequest {
    /** Set only when this request claimed an idempotency key. */
    idempotency?: IdempotencyState
  }
}

/**
 * Hashes the body so "same key, different body" is detectable. `JSON.stringify` of the *parsed*
 * body rather than the raw bytes: two byte-different but semantically identical retries (key
 * order, whitespace) are the same operation, and treating them as a conflict would be wrong.
 */
function hashBody(body: unknown): string {
  const canonical = body === undefined ? '' : JSON.stringify(body)
  return createHash('sha256').update(canonical).digest('hex')
}

export const idempotencyPlugin = fp(
  async (app: FastifyInstance) => {
    app.decorateRequest('idempotency', undefined)

    app.addHook('preHandler', async (request: FastifyRequest, reply: FastifyReply) => {
      if (!MUTATING_METHODS.has(request.method)) return

      const header = request.headers[HEADER]
      const key = typeof header === 'string' ? header.trim() : undefined
      if (key === undefined || key.length === 0) return

      if (key.length > 200) {
        throw new ConflictError('Idempotency-Key must be at most 200 characters.')
      }

      // Public routes have no actor and no space to scope a replay to. There are none that
      // mutate, and if one is ever added, silently skipping the cache is the safe default.
      if (request.routeOptions.config.public === true) return

      const actor = requireActor(request)
      const spaceId = actor.spaceIds[0]
      if (spaceId === undefined) return

      const endpoint = `${request.method} ${request.routeOptions.url ?? request.url}`
      const requestHash = hashBody(request.body)

      const existing = await repository.claim(actor, spaceId, { key, endpoint, requestHash })

      if (existing === null) {
        request.idempotency = { key, endpoint, spaceId }
        return
      }

      if (existing.requestHash !== requestHash) {
        throw new ConflictError(
          'That Idempotency-Key was already used for a different request body.',
        )
      }

      if (existing.statusCode === null) {
        throw new ConflictError(
          'A request with that Idempotency-Key is still in progress. Retry shortly.',
        )
      }

      request.log.info({ endpoint }, 'replaying idempotent response')
      // `send` here ends the request: the handler never runs, which is the entire point.
      return reply
        .status(existing.statusCode)
        .header('idempotent-replay', 'true')
        .send(existing.responseBody)
    })

    app.addHook('onSend', async (request, reply, payload) => {
      const state = request.idempotency
      if (state === undefined) return payload

      // `state` is only set after `requireActor` succeeded in `preHandler`, and nothing clears
      // `request.actor` afterwards — so this cannot throw here. Using the accessor rather than
      // reading `request.actor` keeps `!` and hand-built actors out of the file
      // (conventions/code.md §2 and §5).
      const actor = requireActor(request)

      // Claimed but resolved as an error: release so the client can retry for real. A permanent
      // claim would turn one transient 500 into a key that answers 409 forever.
      if (reply.statusCode < 200 || reply.statusCode >= 300) {
        await repository.release(actor, state.spaceId, {
          key: state.key,
          endpoint: state.endpoint,
        })
        return payload
      }

      // Only JSON is replayable, and everything this API returns on success is JSON
      // (conventions/api.md §8). A problem+json body is never a 2xx, so it never lands here.
      if (typeof payload !== 'string' || reply.getHeader('content-type') === PROBLEM_CONTENT_TYPE) {
        return payload
      }

      let parsed: unknown
      try {
        parsed = JSON.parse(payload)
      } catch {
        // Not JSON, so not replayable. Release rather than storing something we cannot replay,
        // and say so — silently keeping the claim would make retries fail forever.
        request.log.warn(
          { endpoint: state.endpoint },
          'idempotent response was not JSON; claim released',
        )
        await repository.release(actor, state.spaceId, {
          key: state.key,
          endpoint: state.endpoint,
        })
        return payload
      }

      await repository.complete(actor, state.spaceId, {
        key: state.key,
        endpoint: state.endpoint,
        statusCode: reply.statusCode,
        responseBody: parsed,
      })

      return payload
    })
  },
  { name: 'idempotency' },
)
