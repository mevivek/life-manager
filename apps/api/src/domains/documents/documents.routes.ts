import {
  confirmUploadRequestSchema,
  documentCreateSchema,
  documentDeleteQuerySchema,
  documentDetailResponseSchema,
  documentFileParamsSchema,
  documentFileSchema,
  documentFileUpdateSchema,
  documentIdParamsSchema,
  documentListQuerySchema,
  documentListResponseSchema,
  documentSchema,
  documentUpdateSchema,
  holdersResponseSchema,
  presignDownloadRequestSchema,
  presignDownloadResponseSchema,
  presignUploadRequestSchema,
  presignUploadResponseSchema,
  problemSchema,
  reminderCreateSchema,
  reminderListResponseSchema,
  reminderSchema,
} from '@life-manager/shared'
import type { FastifyInstance } from 'fastify'
import type { ZodTypeProvider } from 'fastify-type-provider-zod'
import { z } from 'zod'
import { requireActor } from '../../auth/actor.js'
import * as remindersService from '../reminders/reminders.service.js'
import * as filesService from './documents.files.service.js'
import * as service from './documents.service.js'

/**
 * HTTP for Documents. domains/documents.md §5 — **this file must match §5 exactly**; if you add an
 * endpoint here, add it there in the same commit (agent-playbooks/add-a-domain.md §6).
 *
 * No SQL, no business logic. Every handler resolves the actor and delegates. Every route is
 * protected: none sets `config.public`, and authentication is the default (conventions/api.md §6).
 *
 * ═══════════════════════════════════════════════════════════════════════════════════════
 *  A LITERAL COLON IN A ROUTE PATTERN MUST BE WRITTEN `::`
 * ═══════════════════════════════════════════════════════════════════════════════════════
 *
 * conventions/api.md §2 specifies `:verb` suffixes for non-CRUD actions —
 * `POST /documents/:id/files:presign-upload`. Fastify's router treats `:` as the start of a **path
 * parameter**, so writing that pattern literally does not do what it looks like. Measured, not
 * guessed:
 *
 *   `'/documents/:id/files:presign-upload'`   ← WRONG
 *     · registers `files` + a param named `presign-upload`
 *     · `POST /documents/abc/filesGARBAGE` matches it (any suffix does)
 *     · on the two-param routes, `request.params.fileId` comes back **undefined**, because the
 *       segment parses as one param named `fileId:presign`
 *
 *   `'/documents/:id/files::presign-upload'`  ← CORRECT
 *     · registers the literal path `/documents/:id/files:presign-upload`
 *     · `POST /documents/abc/filesGARBAGE` 404s
 *     · params resolve as `{ id }`
 *
 * **And a second, separate trap: `::` may only follow a STATIC segment, never a parameter.**
 * `@fastify/swagger` mistranslates the escape when it sits directly after a param, so
 * `'/files/:fileId::presign-download'` *routes* correctly but generates the OpenAPI path
 * `/files/{fileId}:{presign}-download` — and conventions/api.md calls the OpenAPI document the
 * contract, so a wrong path there is a wrong contract. That is why `:presign-download` takes
 * `file_id` in its **body**, exactly like `:confirm`, and why `POST /reminders/:id/dismiss` uses a
 * plain path segment. conventions/api.md §2 records the rule.
 *
 * **The URLs clients call are otherwise unchanged** — only the registration string is escaped.
 * `documents.test.ts` asserts both the 404 and the generated OpenAPI paths, because both failures
 * are silent and in the too-permissive direction.
 */

/** The error responses every authenticated route can produce. Spread into each `response`. */
const commonErrors = {
  400: problemSchema,
  401: problemSchema,
  404: problemSchema,
  422: problemSchema,
  429: problemSchema,
} as const

/** Mutations add these two: 409 from `Idempotency-Key`, 503 from an unconfigured feature. */
const mutationErrors = { ...commonErrors, 409: problemSchema, 503: problemSchema } as const

export async function documentsRoutes(app: FastifyInstance): Promise<void> {
  const route = app.withTypeProvider<ZodTypeProvider>()

  route.get(
    '/api/v1/documents',
    {
      schema: {
        operationId: 'listDocuments',
        summary: 'List documents, filtered and sorted',
        description:
          'Default sort is expires_on ascending with nulls last — "what needs doing about it" ' +
          'rather than "what is newest". Unknown query parameters are rejected, not ignored.',
        tags: ['documents'],
        querystring: documentListQuerySchema,
        response: { 200: documentListResponseSchema, ...commonErrors },
      },
    },
    async (request) => service.list(requireActor(request), request.query),
  )

  route.post(
    '/api/v1/documents',
    {
      schema: {
        operationId: 'createDocument',
        summary: 'Create a document',
        description:
          'Only `title` is required. Every other field is optional and backfillable — capture ' +
          'friction is the bigger risk (product/open-questions.md Q2).',
        tags: ['documents'],
        body: documentCreateSchema,
        response: { 201: documentSchema, ...mutationErrors },
      },
    },
    async (request, reply) => {
      const document = await service.create(requireActor(request), request.body)
      return reply.status(201).send(document)
    },
  )

  route.get(
    '/api/v1/documents/issuers',
    {
      schema: {
        operationId: 'listIssuers',
        summary: 'Distinct issuers in the actor’s spaces, for autocomplete',
        description:
          'Registered BEFORE /documents/:id so the static segment wins the match. See ' +
          'domains/documents.md §9 question 1: free text plus autocomplete, not an issuers table.',
        tags: ['documents'],
        response: { 200: z.object({ data: z.array(z.string()) }), ...commonErrors },
      },
    },
    async (request) => ({ data: await service.listIssuers(requireActor(request)) }),
  )

  route.get(
    '/api/v1/documents/holders',
    {
      schema: {
        operationId: 'listHolders',
        summary: 'Distinct holders in the actor’s spaces, with their most recent relation',
        description:
          'Registered BEFORE /documents/:id so the static segment wins the match — the same trap ' +
          '/documents/issuers documents. Holders are free text, not accounts: this is autocomplete ' +
          'for a label, and it grants nobody access to anything.',
        tags: ['documents'],
        response: { 200: holdersResponseSchema, ...commonErrors },
      },
    },
    async (request) => ({ data: await service.listHolders(requireActor(request)) }),
  )

  route.get(
    '/api/v1/documents/:id',
    {
      schema: {
        operationId: 'getDocument',
        summary: 'One document, with its files and reminders',
        tags: ['documents'],
        params: documentIdParamsSchema,
        response: { 200: documentDetailResponseSchema, ...commonErrors },
      },
    },
    async (request) => service.getDetail(requireActor(request), request.params.id),
  )

  route.patch(
    '/api/v1/documents/:id',
    {
      schema: {
        operationId: 'updateDocument',
        summary: 'Partially update a document',
        description:
          'An absent key means "do not change"; an explicit null means "clear". Changing ' +
          'expires_on reconciles pending reminders.',
        tags: ['documents'],
        params: documentIdParamsSchema,
        body: documentUpdateSchema,
        response: { 200: documentSchema, ...mutationErrors },
      },
    },
    async (request) => service.update(requireActor(request), request.params.id, request.body),
  )

  route.delete(
    '/api/v1/documents/:id',
    {
      schema: {
        operationId: 'deleteDocument',
        summary: 'Soft-delete a document, its files and its pending reminders',
        description:
          'Requires `?version=` — the version the client last read. A delete built against stale ' +
          'data is refused with 409 rather than destroying an edit made elsewhere (ADR-0024, D41). ' +
          'Does not delete the stored objects — cleanup is a separate job so an accidental ' +
          'delete stays recoverable (ADR-0008).',
        tags: ['documents'],
        params: documentIdParamsSchema,
        querystring: documentDeleteQuerySchema,
        response: { 204: z.null(), ...mutationErrors },
      },
    },
    async (request, reply) => {
      await service.remove(requireActor(request), request.params.id, request.query.version)
      return reply.status(204).send(null)
    },
  )

  // ── Files ──────────────────────────────────────────────────────────────────
  //
  // `::` is a literal colon — see the block comment at the top of this file. Bytes never pass
  // through these endpoints (ADR-0008, conventions/api.md §9).

  route.post(
    '/api/v1/documents/:id/files::presign-upload',
    {
      schema: {
        operationId: 'presignUpload',
        summary: 'Mint a short-lived PUT URL for one object',
        description:
          'The API chooses the object key; a client never supplies one. Size and mime are ' +
          'signed into the URL, so the declared limits are enforced by storage too.',
        tags: ['documents', 'files'],
        params: documentIdParamsSchema,
        body: presignUploadRequestSchema,
        response: { 201: presignUploadResponseSchema, ...mutationErrors },
      },
    },
    async (request, reply) => {
      const result = await filesService.presignUploadFor(
        requireActor(request),
        request.params.id,
        request.body,
      )
      return reply.status(201).send(result)
    },
  )

  route.post(
    '/api/v1/documents/:id/files::confirm',
    {
      schema: {
        operationId: 'confirmUpload',
        summary: 'Record that the bytes are in place',
        description: '409 if that file was already confirmed.',
        tags: ['documents', 'files'],
        params: documentIdParamsSchema,
        body: confirmUploadRequestSchema,
        response: { 200: documentFileSchema, ...mutationErrors },
      },
    },
    async (request) =>
      filesService.confirmUpload(requireActor(request), request.params.id, request.body),
  )

  route.post(
    '/api/v1/documents/:id/files::presign-download',
    {
      schema: {
        operationId: 'presignDownload',
        summary: 'Mint a short-lived GET URL for one object',
        description:
          'The file is named in the body, not the path — a :verb suffix after a path parameter ' +
          'generates a broken OpenAPI path. See the block comment above.',
        tags: ['documents', 'files'],
        params: documentIdParamsSchema,
        body: presignDownloadRequestSchema,
        response: { 201: presignDownloadResponseSchema, ...mutationErrors },
      },
    },
    async (request, reply) => {
      const result = await filesService.presignDownloadFor(
        requireActor(request),
        request.params.id,
        request.body.file_id,
      )
      return reply.status(201).send(result)
    },
  )

  route.patch(
    '/api/v1/documents/:id/files/:fileId',
    {
      schema: {
        operationId: 'updateDocumentFile',
        summary: 'Promote a file version to primary',
        tags: ['documents', 'files'],
        params: documentFileParamsSchema,
        body: documentFileUpdateSchema,
        response: { 200: documentFileSchema, ...mutationErrors },
      },
    },
    async (request) =>
      filesService.makePrimary(requireActor(request), request.params.id, request.params.fileId),
  )

  route.delete(
    '/api/v1/documents/:id/files/:fileId',
    {
      schema: {
        operationId: 'deleteDocumentFile',
        summary: 'Soft-delete one file version',
        description:
          'The stored object is left in place. If the deleted version was primary, the newest ' +
          'remaining confirmed version is promoted.',
        tags: ['documents', 'files'],
        params: documentFileParamsSchema,
        response: { 204: z.null(), ...mutationErrors },
      },
    },
    async (request, reply) => {
      await filesService.removeFile(requireActor(request), request.params.id, request.params.fileId)
      return reply.status(204).send(null)
    },
  )

  // ── Reminders on a document ────────────────────────────────────────────────

  route.get(
    '/api/v1/documents/:id/reminders',
    {
      schema: {
        operationId: 'listDocumentReminders',
        summary: 'Reminders attached to a document',
        tags: ['documents', 'reminders'],
        params: documentIdParamsSchema,
        response: { 200: reminderListResponseSchema, ...commonErrors },
      },
    },
    async (request) => ({
      data: await remindersService.listForDocument(requireActor(request), request.params.id),
    }),
  )

  route.post(
    '/api/v1/documents/:id/reminders',
    {
      schema: {
        operationId: 'createDocumentReminder',
        summary: 'Attach a reminder to a document',
        tags: ['documents', 'reminders'],
        params: documentIdParamsSchema,
        body: reminderCreateSchema,
        response: { 201: reminderSchema, ...mutationErrors },
      },
    },
    async (request, reply) => {
      const reminder = await remindersService.createForDocument(
        requireActor(request),
        request.params.id,
        request.body,
      )
      return reply.status(201).send(reminder)
    },
  )
}
