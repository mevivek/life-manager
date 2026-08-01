import {
  personCreateSchema,
  personDeleteQuerySchema,
  personIdParamsSchema,
  personListResponseSchema,
  personSchema,
  personUpdateSchema,
  problemSchema,
  renamedResponseSchema,
} from '@life-manager/shared'
import type { FastifyInstance } from 'fastify'
import type { ZodTypeProvider } from 'fastify-type-provider-zod'
import { z } from 'zod'
import { requireActor } from '../../auth/actor.js'
import * as service from './people.service.js'

/**
 * HTTP for People. Four endpoints, decided by
 * [ADR-0034](../../../../../docs/decisions/0034-people-is-a-directory.md).
 *
 * No SQL, no business logic. Every handler resolves the actor and delegates. Every route is
 * protected: none sets `config.public`, and authentication is the default (conventions/api.md §6).
 *
 * There is no `:verb` action anywhere here, so the `::` escape that bit Things and Documents does not
 * come up — and there is no static sub-path either, so no route-ordering trap like
 * `/things/holders` before `/things/:id`. Read the block comment at the top of `things.routes.ts`
 * before adding either.
 */

/**
 * ── The params and the delete precondition come from `packages/shared` ──
 *
 * They were declared here first, with a note to move them. They have moved: invariant 9 makes the
 * shared schemas the only contract source, and a routes file declaring its own params is exactly how
 * a second, subtly different shape gets born — one the OpenAPI document and a typed client would then
 * disagree about by construction.
 */

/** The error responses every authenticated route can produce. Spread into each `response`. */
const commonErrors = {
  400: problemSchema,
  401: problemSchema,
  404: problemSchema,
  422: problemSchema,
  429: problemSchema,
} as const

/** Mutations add 409, from a version precondition or a replayed `Idempotency-Key`. */
const mutationErrors = { ...commonErrors, 409: problemSchema } as const

export async function peopleRoutes(app: FastifyInstance): Promise<void> {
  const route = app.withTypeProvider<ZodTypeProvider>()

  route.get(
    '/api/v1/people',
    {
      schema: {
        operationId: 'listPeople',
        summary: 'The directory, with how many records are filed under each name',
        description:
          'No cursor: a household’s directory is a handful of names, not a feed. ' +
          '`document_count` and `thing_count` are counted server-side in one query, because the ' +
          'remove sheet states the number and a client counting a loaded page would be counting ' +
          'one page. This is NOT the only source of names — `GET /documents/holders` still ' +
          'derives them from the records, so a holder typed at capture is still offered ' +
          '(ADR-0034).',
        tags: ['people'],
        response: { 200: personListResponseSchema, ...commonErrors },
      },
    },
    async (request) => service.list(requireActor(request)),
  )

  route.post(
    '/api/v1/people',
    {
      schema: {
        operationId: 'createPerson',
        summary: 'Add someone to the directory',
        description:
          'Only `name` is required. A person may exist with nothing filed under them — that is ' +
          'the case `SELECT DISTINCT holder` could not express, and the reason this table exists. ' +
          'Nobody created here has an account, a sign-in, or a notification.',
        tags: ['people'],
        body: personCreateSchema,
        response: { 201: personSchema, ...mutationErrors },
      },
    },
    async (request, reply) => {
      const person = await service.create(requireActor(request), request.body)
      return reply.status(201).send(person)
    },
  )

  route.patch(
    '/api/v1/people/:id',
    {
      schema: {
        operationId: 'updatePerson',
        summary: 'Rename someone, renaming them everywhere they are filed',
        description:
          'Changing `name` also rewrites `documents.holder` and `things.holder` for every live ' +
          'record in the space that matched the OLD name, in ONE transaction, and reports how ' +
          'many of each moved. That is what "renames them everywhere they’re filed" means ' +
          '(ADR-0034). An unchanged name — or a patch that only touches `relation` — reports 0 ' +
          'and 0. `version` is required (ADR-0024): a stale precondition is refused with 409 ' +
          'before a single record is rewritten.',
        tags: ['people'],
        params: personIdParamsSchema,
        body: personUpdateSchema,
        response: { 200: renamedResponseSchema, ...mutationErrors },
      },
    },
    async (request) => service.update(requireActor(request), request.params.id, request.body),
  )

  route.delete(
    '/api/v1/people/:id',
    {
      schema: {
        operationId: 'deletePerson',
        summary: 'Remove someone from the directory, leaving their records alone',
        description:
          'Soft-deletes the directory row and NOTHING else. Every document and thing filed under ' +
          'them keeps its holder string — "the records filed under them keep the name, they just ' +
          'stop being offered as a choice" (ADR-0034). Requires `?version=` (D41).',
        tags: ['people'],
        params: personIdParamsSchema,
        querystring: personDeleteQuerySchema,
        response: { 204: z.null(), ...mutationErrors },
      },
    },
    async (request, reply) => {
      await service.remove(requireActor(request), request.params.id, request.query.version)
      return reply.status(204).send(null)
    },
  )
}
