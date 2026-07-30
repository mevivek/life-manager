/**
 * Domain errors. Services throw these; `lib/problem.ts` is the single place that turns them
 * into HTTP. conventions/code.md §6.
 *
 * A service must never reach for `reply.code(...)` — that is a layering violation and the
 * symptom list in conventions/code.md §1 names it explicitly.
 */
export abstract class AppError extends Error {
  abstract readonly status: number

  /** Slug used to build the RFC 9457 `type` URI. Stable — clients may branch on it. */
  abstract readonly slug: string

  constructor(message: string) {
    super(message)
    this.name = new.target.name
  }
}

/** 401 — no valid session. Thrown by the actor hook. */
export class UnauthorizedError extends AppError {
  readonly status = 401
  readonly slug = 'unauthorized'

  constructor(message = 'Authentication required.') {
    super(message)
  }
}

/**
 * 403 — reserved for "you ARE in this space but lack the role", which does not exist until
 * shared spaces ship at M3.
 *
 * **Cross-space access is never a 403.** The repository's `scoped()` filter means the row
 * simply is not returned, and the service throws `NotFoundError`. A 403 would confirm the
 * record exists, which leaks across spaces. conventions/api.md §3.
 */
export class ForbiddenError extends AppError {
  readonly status = 403
  readonly slug = 'forbidden'

  constructor(message = 'You do not have permission to do that.') {
    super(message)
  }
}

/**
 * 400 — the request itself is malformed, so no business rule was even reached.
 *
 * **Distinct from `ValidationError` (422) on purpose**, per conventions/api.md §3's table: 400 is
 * "malformed request, Zod rejected it" and 422 is "well-formed but violates a business rule". The
 * slug is the same one `problem.ts` already maps a bare Fastify 400 to, so a rejection raised here
 * and one raised by the route's own querystring schema look identical to a client.
 *
 * Raised by `lib/cursor.ts` for a cursor that is not one of ours: a garbage cursor is not a
 * business-rule violation, it is a request that does not parse.
 */
export class BadRequestError extends AppError {
  readonly status = 400
  readonly slug = 'validation-failed'

  constructor(message = 'The request was not valid.') {
    super(message)
  }
}

/** 404 — not found, or not visible to this actor. Both, deliberately indistinguishable. */
export class NotFoundError extends AppError {
  readonly status = 404
  readonly slug = 'not-found'

  constructor(message = 'Not found.') {
    super(message)
  }
}

/** 409 — version mismatch, duplicate, or a replayed `Idempotency-Key` with a new body. */
export class ConflictError extends AppError {
  readonly status = 409
  readonly slug = 'conflict'

  constructor(message = 'That conflicts with the current state.') {
    super(message)
  }
}

/** 422 — well-formed, but violates a business rule. Zod rejections are 400, not this. */
export class ValidationError extends AppError {
  readonly status = 422
  readonly slug = 'unprocessable'

  constructor(message = 'That is not allowed.') {
    super(message)
  }
}

/**
 * 503 — the feature exists in the code but is not configured on this deployment.
 *
 * Added at M1 for the two optional feature groups in `env.ts`: R2 (file endpoints) and VAPID (push
 * delivery). Both are deliberately optional so that `pnpm test` and a fresh clone need no external
 * credential, which means "unconfigured" is a real, expected runtime state rather than a bug.
 *
 * **Not a 500**, because nothing is broken, and **not a 404**, because the endpoint genuinely
 * exists and will work once configured. conventions/api.md §3's table does not list 503; it was
 * written before an optional-feature case existed, and §3 is updated alongside this.
 */
export class NotConfiguredError extends AppError {
  readonly status = 503
  readonly slug = 'not-configured'

  constructor(message = 'That feature is not configured on this deployment.') {
    super(message)
  }
}

export function isAppError(error: unknown): error is AppError {
  return error instanceof AppError
}
