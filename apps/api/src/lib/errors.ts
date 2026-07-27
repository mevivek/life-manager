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

export function isAppError(error: unknown): error is AppError {
  return error instanceof AppError
}
