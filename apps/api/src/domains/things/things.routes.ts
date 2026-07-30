import {
  confirmPhotoUploadRequestSchema,
  presignPhotoDownloadRequestSchema,
  presignPhotoDownloadResponseSchema,
  presignPhotoUploadRequestSchema,
  presignPhotoUploadResponseSchema,
  problemSchema,
  thingCreateSchema,
  thingDeleteQuerySchema,
  thingDetailResponseSchema,
  thingHoldersResponseSchema,
  thingIdParamsSchema,
  thingListQuerySchema,
  thingListResponseSchema,
  thingPhotoParamsSchema,
  thingPhotoSchema,
  thingPhotoUpdateSchema,
  thingSchema,
  thingServiceCreateSchema,
  thingServiceParamsSchema,
  thingServiceSchema,
  thingUpdateSchema,
} from '@life-manager/shared'
import type { FastifyInstance } from 'fastify'
import type { ZodTypeProvider } from 'fastify-type-provider-zod'
import { z } from 'zod'
import { requireActor } from '../../auth/actor.js'
import * as photosService from './things.photos.service.js'
import * as service from './things.service.js'

/**
 * HTTP for Things. domains/things.md §5 — **this file must match §5 exactly**; if you add an endpoint
 * here, add it there in the same commit (agent-playbooks/add-a-domain.md §6).
 *
 * No SQL, no business logic. Every handler resolves the actor and delegates. Every route is
 * protected: none sets `config.public`, and authentication is the default (conventions/api.md §6).
 *
 * ═══════════════════════════════════════════════════════════════════════════════════════
 *  A LITERAL COLON IN A ROUTE PATTERN MUST BE WRITTEN `::` — and only after a STATIC segment
 * ═══════════════════════════════════════════════════════════════════════════════════════
 *
 * Both halves of this were measured at M1 and both fail silently in the too-permissive direction.
 * The long version is the block comment at the top of `documents.routes.ts`; the short version:
 *
 *   `'/things/:id/photos:presign-upload'`    ← WRONG. Fastify parses `:presign-upload` as a PARAM,
 *                                              so `POST /things/abc/photosGARBAGE` matches.
 *   `'/things/:id/photos::presign-upload'`   ← CORRECT. Registers the literal path; garbage 404s.
 *
 * And: `@fastify/swagger` mistranslates the escape when it sits directly after a parameter, so
 * `'/photos/:photoId::presign-download'` *routes* correctly but generates the OpenAPI path
 * `/photos/{photoId}:{presign}-download` — and conventions/api.md §3 calls the OpenAPI document the
 * contract. **That is why `::presign-download` and `::confirm` name the photo in the BODY**, which is
 * also what `presignPhotoDownloadRequestSchema` and `confirmPhotoUploadRequestSchema` already encode.
 *
 * `things.test.ts` asserts both the 404 and the generated OpenAPI paths.
 */

/** The error responses every authenticated route can produce. Spread into each `response`. */
const commonErrors = {
  400: problemSchema,
  401: problemSchema,
  404: problemSchema,
  422: problemSchema,
  429: problemSchema,
} as const

/** Mutations add these two: 409 from a version precondition or `Idempotency-Key`, 503 from R2. */
const mutationErrors = { ...commonErrors, 409: problemSchema, 503: problemSchema } as const

export async function thingsRoutes(app: FastifyInstance): Promise<void> {
  const route = app.withTypeProvider<ZodTypeProvider>()

  route.get(
    '/api/v1/things',
    {
      schema: {
        operationId: 'listThings',
        summary: 'List things, filtered and sorted',
        description:
          'Default sort is name ascending. A thing has no single date that orders it the way an ' +
          'expiry orders a document — cover, service and purchase all compete — so it sorts ' +
          'alphabetically, which is the one order a person can predict. Unknown query parameters ' +
          'are rejected, not ignored.',
        tags: ['things'],
        querystring: thingListQuerySchema,
        response: { 200: thingListResponseSchema, ...commonErrors },
      },
    },
    async (request) => service.list(requireActor(request), request.query),
  )

  route.post(
    '/api/v1/things',
    {
      schema: {
        operationId: 'createThing',
        summary: 'Create a thing',
        description:
          'Only `name` is required — Q2 applied to a second domain. A thing may exist with no ' +
          'kind detail, no price, no cover and no photo, which is what the capture wizard’s ' +
          '“Skip for now” promises (ADR-0030). Ownership is always `here` at creation.',
        tags: ['things'],
        body: thingCreateSchema,
        response: { 201: thingSchema, ...mutationErrors },
      },
    },
    async (request, reply) => {
      const thing = await service.create(requireActor(request), request.body)
      return reply.status(201).send(thing)
    },
  )

  route.get(
    '/api/v1/things/holders',
    {
      schema: {
        operationId: 'listThingHolders',
        summary: 'Distinct holders in the actor’s spaces, with their most recent relation',
        description:
          'Registered BEFORE /things/:id so the static segment wins the match — the same trap ' +
          '/documents/holders documents. Holders are free text, not accounts: this is ' +
          'autocomplete for a label, and it grants nobody access to anything.',
        tags: ['things'],
        response: { 200: thingHoldersResponseSchema, ...commonErrors },
      },
    },
    async (request) => ({ data: await service.listHolders(requireActor(request)) }),
  )

  route.get(
    '/api/v1/things/:id',
    {
      schema: {
        operationId: 'getThing',
        summary: 'One thing, with its photos, services, documents and reminders',
        description:
          'The linked documents are a SUMMARY, not whole documents: nesting them would put every ' +
          'linked document’s full identifier on a Things response for no gain (ADR-0027).',
        tags: ['things'],
        params: thingIdParamsSchema,
        response: { 200: thingDetailResponseSchema, ...commonErrors },
      },
    },
    async (request) => service.getDetail(requireActor(request), request.params.id),
  )

  route.patch(
    '/api/v1/things/:id',
    {
      schema: {
        operationId: 'updateThing',
        summary: 'Partially update a thing',
        description:
          'An absent key means "do not change"; an explicit null means "clear". `version` is ' +
          'required (ADR-0024). Setting `ownership` to `here` clears `ownership_who` and ' +
          '`ownership_since` in the same statement — business rule 4.',
        tags: ['things'],
        params: thingIdParamsSchema,
        body: thingUpdateSchema,
        response: { 200: thingSchema, ...mutationErrors },
      },
    },
    async (request) => service.update(requireActor(request), request.params.id, request.body),
  )

  route.delete(
    '/api/v1/things/:id',
    {
      schema: {
        operationId: 'deleteThing',
        summary: 'Soft-delete a thing, unlinking its documents without deleting them',
        description:
          'Requires `?version=` — a delete built against stale data is refused with 409 rather ' +
          'than destroying an edit made elsewhere (ADR-0024, D41). Its documents STAY in ' +
          'Documents with `thing_id` cleared: deleting the thing does not shred the paperwork ' +
          '(business rule 5). Stored photo objects are left in place (ADR-0008).',
        tags: ['things'],
        params: thingIdParamsSchema,
        querystring: thingDeleteQuerySchema,
        response: { 204: z.null(), ...mutationErrors },
      },
    },
    async (request, reply) => {
      await service.remove(requireActor(request), request.params.id, request.query.version)
      return reply.status(204).send(null)
    },
  )

  // ── The service log ────────────────────────────────────────────────────────

  route.post(
    '/api/v1/things/:id/services',
    {
      schema: {
        operationId: 'logThingService',
        summary: 'Log a service, recomputing the next due date',
        description:
          'A service is a CYCLE, not a date (business rule 3): the server recomputes ' +
          '`service_due_on` as `serviced_on + service_every_months`. The client deliberately ' +
          'does not send a next date — a cycle whose next date is client-computed is one two ' +
          'devices can disagree about. A thing with no `service_every_months` has no cycle, so ' +
          'the entry is recorded and no due date appears.',
        tags: ['things'],
        params: thingIdParamsSchema,
        body: thingServiceCreateSchema,
        response: { 201: thingServiceSchema, ...mutationErrors },
      },
    },
    async (request, reply) => {
      const logged = await service.logService(
        requireActor(request),
        request.params.id,
        request.body,
      )
      return reply.status(201).send(logged)
    },
  )

  route.delete(
    '/api/v1/things/:id/services/:serviceId',
    {
      schema: {
        operationId: 'deleteThingService',
        summary: 'Remove one logged service, re-deriving the next due date',
        description:
          'The due date is recomputed from the newest remaining entry. Removing the last one ' +
          'clears it rather than restoring the date seeded at capture — that value was ' +
          'overwritten by the first log and there is nothing to restore.',
        tags: ['things'],
        params: thingServiceParamsSchema,
        response: { 204: z.null(), ...mutationErrors },
      },
    },
    async (request, reply) => {
      await service.removeService(
        requireActor(request),
        request.params.id,
        request.params.serviceId,
      )
      return reply.status(204).send(null)
    },
  )

  // ── Photos ─────────────────────────────────────────────────────────────────
  //
  // `::` is a literal colon — see the block comment at the top of this file. Bytes never pass
  // through these endpoints (ADR-0008, conventions/api.md §9).

  route.post(
    '/api/v1/things/:id/photos::presign-upload',
    {
      schema: {
        operationId: 'presignThingPhotoUpload',
        summary: 'Mint a short-lived PUT URL for one photo',
        description:
          'The API chooses the object key; a client never supplies one (invariant 6). Size and ' +
          'mime are signed into the URL, so the 25 MB limit and the image-only allowlist are ' +
          'enforced by storage too — not just checked on a value the client chose.',
        tags: ['things', 'photos'],
        params: thingIdParamsSchema,
        body: presignPhotoUploadRequestSchema,
        response: { 201: presignPhotoUploadResponseSchema, ...mutationErrors },
      },
    },
    async (request, reply) => {
      const result = await photosService.presignPhotoUploadFor(
        requireActor(request),
        request.params.id,
        request.body,
      )
      return reply.status(201).send(result)
    },
  )

  route.post(
    '/api/v1/things/:id/photos::confirm',
    {
      schema: {
        operationId: 'confirmThingPhotoUpload',
        summary: 'Record that the bytes are in place',
        description: '409 if that photo was already confirmed.',
        tags: ['things', 'photos'],
        params: thingIdParamsSchema,
        body: confirmPhotoUploadRequestSchema,
        response: { 200: thingPhotoSchema, ...mutationErrors },
      },
    },
    async (request) =>
      photosService.confirmPhotoUpload(requireActor(request), request.params.id, request.body),
  )

  route.post(
    '/api/v1/things/:id/photos::presign-download',
    {
      schema: {
        operationId: 'presignThingPhotoDownload',
        summary: 'Mint a short-lived GET URL for one photo',
        description:
          'The photo is named in the body, not the path — a :verb suffix after a path parameter ' +
          'generates a broken OpenAPI path. See the block comment above.',
        tags: ['things', 'photos'],
        params: thingIdParamsSchema,
        body: presignPhotoDownloadRequestSchema,
        response: { 201: presignPhotoDownloadResponseSchema, ...mutationErrors },
      },
    },
    async (request, reply) => {
      const result = await photosService.presignPhotoDownloadFor(
        requireActor(request),
        request.params.id,
        request.body.photo_id,
      )
      return reply.status(201).send(result)
    },
  )

  route.patch(
    '/api/v1/things/:id/photos/:photoId',
    {
      schema: {
        operationId: 'updateThingPhoto',
        summary: 'Promote a photo to be the main one',
        description:
          'Promotion only — demote by promoting another photo. A thing with photos and no main ' +
          'one renders with an empty thumbnail slot, which is worse than the wrong photo winning.',
        tags: ['things', 'photos'],
        params: thingPhotoParamsSchema,
        body: thingPhotoUpdateSchema,
        response: { 200: thingPhotoSchema, ...mutationErrors },
      },
    },
    async (request) =>
      photosService.makeHero(requireActor(request), request.params.id, request.params.photoId),
  )

  route.delete(
    '/api/v1/things/:id/photos/:photoId',
    {
      schema: {
        operationId: 'deleteThingPhoto',
        summary: 'Soft-delete one photo',
        description:
          'The stored object is left in place. If the deleted photo was the main one, the newest ' +
          'remaining confirmed photo is promoted.',
        tags: ['things', 'photos'],
        params: thingPhotoParamsSchema,
        response: { 204: z.null(), ...mutationErrors },
      },
    },
    async (request, reply) => {
      await photosService.removePhoto(
        requireActor(request),
        request.params.id,
        request.params.photoId,
      )
      return reply.status(204).send(null)
    },
  )
}
