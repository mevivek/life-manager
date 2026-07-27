import type { MeResponse } from '@life-manager/shared'
import type { ActorContext } from '../../auth/actor.js'
import { NotFoundError } from '../../lib/errors.js'
import { listForActor } from '../spaces/spaces.repository.js'
import { findSelf } from './me.repository.js'

/**
 * Composes the two reads behind `GET /api/v1/me`. Thin, deliberately: the route must not call
 * two repositories itself (conventions/code.md §1 — routes call services, services call
 * repositories), and M1's first real service gets a shape to copy.
 */
export async function getMe(actor: ActorContext): Promise<MeResponse> {
  const [self, spaces] = await Promise.all([findSelf(actor), listForActor(actor)])

  if (self === undefined) {
    // A valid session whose user row is gone. Treat it as not-found rather than 500: it is
    // reachable by deleting a user out from under a live session, which ADR-0011's
    // reset-the-dev-database workflow does routinely.
    throw new NotFoundError('That account no longer exists.')
  }

  return {
    user_id: self.id,
    email: self.email,
    spaces,
  }
}
