import {
  type ConfirmUploadRequest,
  type Document,
  type DocumentCreate,
  type DocumentDetailResponse,
  type DocumentFile,
  type DocumentListQuery,
  type DocumentListResponse,
  type DocumentUpdate,
  documentDetailResponseSchema,
  documentFileSchema,
  documentListResponseSchema,
  documentSchema,
  type HealthResponse,
  healthResponseSchema,
  type MeResponse,
  meResponseSchema,
  type PresignDownloadResponse,
  type PresignUploadRequest,
  type PresignUploadResponse,
  type Problem,
  type PushSubscription as PushSubscriptionPayload,
  presignDownloadResponseSchema,
  presignUploadResponseSchema,
  problemSchema,
  pushPublicKeyResponseSchema,
  pushSubscribeResponseSchema,
  type Reminder,
  type ReminderCreate,
  reminderListResponseSchema,
  reminderSchema,
} from '@life-manager/shared'
import { z } from 'zod'
import { API_ORIGIN } from './api-origin'

/**
 * THE typed API client. conventions/code.md §9: "All API calls go through one typed client in
 * lib/api. No bare `fetch` in a component." Greppable enforcement:
 *
 *     rg '\bfetch\(' apps/web/src   # expect: only this file
 *
 * Responses are parsed with the SAME Zod schemas the server serialises with (ADR-0004), so a
 * contract drift shows up here as a thrown error rather than as `undefined` three components
 * deep.
 */

/** A parsed RFC 9457 problem, or a synthetic one for a response that was not problem+json. */
export class ApiError extends Error {
  readonly status: number
  readonly problem: Problem

  constructor(problem: Problem) {
    super(problem.detail)
    this.name = 'ApiError'
    this.status = problem.status
    this.problem = problem
  }

  /** True when the user simply is not signed in — routes use this to redirect rather than shout. */
  get isUnauthenticated(): boolean {
    return this.status === 401
  }
}

/**
 * The request never reached the server — no connection, DNS failure, or a dead uplink.
 *
 * Distinct from `ApiError`, which means the server answered and said no. The distinction is what
 * lets `query-client.ts` skip retrying this (retrying an offline request just delays the message by
 * a few seconds) and lets the UI say something true about whether a write landed.
 *
 * [ADR-0013](../../../../docs/decisions/0013-read-only-offline-v1.md) is the reason the write
 * wording is so definite: writes are never queued, so "not saved" is a fact and not a guess. The ADR
 * rejects the alternative outright — "a queued write that appears to succeed and then loses data is
 * worse than a write that plainly failed".
 */
export class OfflineError extends Error {
  constructor(kind: 'read' | 'write', cause?: unknown) {
    super(
      kind === 'write'
        ? 'No connection — your change was not saved. Reconnect and try again.'
        : 'No connection — could not reach the server.',
      // Preserved rather than discarded: security-model.md §6 forbids swallowing errors, and the
      // underlying TypeError is the only thing that distinguishes DNS from TLS from a dropped uplink.
      { cause },
    )
    this.name = 'OfflineError'
  }
}

type RequestOptions = {
  method?: 'GET' | 'POST' | 'PATCH' | 'DELETE'
  body?: unknown
  /**
   * Sent as `Idempotency-Key` (conventions/api.md §5). Supply one per **logical operation**, not
   * per attempt — the whole point is that a retry carries the same key so the server replays
   * rather than repeating the write.
   */
  idempotencyKey?: string
}

async function request<T>(
  path: string,
  schema: { parse: (value: unknown) => T },
  options: RequestOptions = {},
): Promise<T> {
  const { method = 'GET', body, idempotencyKey } = options

  let response: Response
  try {
    response = await fetch(`${API_ORIGIN}${path}`, {
      method,
      /**
       * Non-negotiable. The session is an httpOnly cookie (security-model.md §2), so without
       * this the browser sends no credentials and every authenticated call is a silent 401.
       */
      credentials: 'include',
      headers: {
        accept: 'application/json',
        ...(body === undefined ? {} : { 'content-type': 'application/json' }),
        ...(idempotencyKey === undefined ? {} : { 'idempotency-key': idempotencyKey }),
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    })
  } catch (cause) {
    // `fetch` rejects — rather than resolving with a status — when the request never reached the
    // server at all. Raw, that surfaces to the user as "Failed to fetch", which names the mechanism
    // instead of the problem. ADR-0013 requires an offline write to fail *plainly*, so translate it.
    throw new OfflineError(method === 'GET' ? 'read' : 'write', cause)
  }

  if (!response.ok) throw await toApiError(response)

  // 204 has no body to parse. Callers pass `z.null()` for these.
  if (response.status === 204) return schema.parse(null)

  return schema.parse(await response.json())
}

/**
 * Builds a querystring from a list query, dropping `undefined` and expanding arrays into repeated
 * parameters — which is the shape `documentListQuerySchema`'s `repeatable()` expects.
 *
 * **Only keys the schema declares may appear here.** The server rejects unknown query parameters
 * (debt D27), so a stray key is a 400 rather than a silently ignored filter — which is the desired
 * behaviour, but it means this function must not invent parameter names.
 */
function toQueryString(query: Partial<DocumentListQuery>): string {
  const params = new URLSearchParams()

  for (const [key, value] of Object.entries(query)) {
    if (value === undefined || value === '') continue
    if (Array.isArray(value)) {
      for (const item of value) params.append(key, String(item))
    } else {
      params.set(key, String(value))
    }
  }

  const serialised = params.toString()
  return serialised === '' ? '' : `?${serialised}`
}

async function toApiError(response: Response): Promise<ApiError> {
  try {
    const parsed = problemSchema.safeParse(await response.json())
    if (parsed.success) return new ApiError(parsed.data)
  } catch {
    // Body was not JSON at all — fall through to the synthetic problem below. Deliberately
    // swallowed: we are already on the error path and the status is what matters.
  }

  return new ApiError({
    type: 'about:blank',
    title: 'Request failed',
    status: response.status,
    detail: `The server responded with ${response.status}.`,
  })
}

/** For `DELETE` endpoints, which answer 204 with no body. */
const noContentSchema = z.null()

export const api = {
  health: (): Promise<HealthResponse> => request('/api/v1/health', healthResponseSchema),
  me: (): Promise<MeResponse> => request('/api/v1/me', meResponseSchema),

  documents: {
    list: (query: Partial<DocumentListQuery> = {}): Promise<DocumentListResponse> =>
      request(`/api/v1/documents${toQueryString(query)}`, documentListResponseSchema),

    get: (id: string): Promise<DocumentDetailResponse> =>
      request(`/api/v1/documents/${id}`, documentDetailResponseSchema),

    create: (input: DocumentCreate, idempotencyKey?: string): Promise<Document> =>
      request('/api/v1/documents', documentSchema, {
        method: 'POST',
        body: input,
        idempotencyKey,
      }),

    update: (id: string, patch: DocumentUpdate): Promise<Document> =>
      request(`/api/v1/documents/${id}`, documentSchema, { method: 'PATCH', body: patch }),

    remove: (id: string): Promise<null> =>
      request(`/api/v1/documents/${id}`, noContentSchema, { method: 'DELETE' }),

    issuers: (): Promise<string[]> =>
      request('/api/v1/documents/issuers', z.object({ data: z.array(z.string()) })).then(
        (response) => response.data,
      ),
  },

  files: {
    presignUpload: (
      documentId: string,
      input: PresignUploadRequest,
    ): Promise<PresignUploadResponse> =>
      request(`/api/v1/documents/${documentId}/files:presign-upload`, presignUploadResponseSchema, {
        method: 'POST',
        body: input,
      }),

    confirm: (documentId: string, input: ConfirmUploadRequest): Promise<DocumentFile> =>
      request(`/api/v1/documents/${documentId}/files:confirm`, documentFileSchema, {
        method: 'POST',
        body: input,
      }),

    presignDownload: (documentId: string, fileId: string): Promise<PresignDownloadResponse> =>
      request(
        `/api/v1/documents/${documentId}/files:presign-download`,
        presignDownloadResponseSchema,
        { method: 'POST', body: { file_id: fileId } },
      ),

    makePrimary: (documentId: string, fileId: string): Promise<DocumentFile> =>
      request(`/api/v1/documents/${documentId}/files/${fileId}`, documentFileSchema, {
        method: 'PATCH',
        body: { is_primary: true },
      }),

    remove: (documentId: string, fileId: string): Promise<null> =>
      request(`/api/v1/documents/${documentId}/files/${fileId}`, noContentSchema, {
        method: 'DELETE',
      }),

    /**
     * PUTs the bytes **straight to storage**, not through the API (ADR-0008).
     *
     * The one `fetch` in this file that does not go to our own origin, and the one that must NOT
     * send credentials: the presigned URL carries its own authorisation, and attaching our session
     * cookie to a third-party request would leak it. `credentials: 'omit'` is deliberate.
     *
     * `content-type` and `content-length` are signed into the URL, so they must match what was
     * declared at presign time or storage rejects the upload.
     */
    upload: async (uploadUrl: string, file: File): Promise<void> => {
      let response: Response
      try {
        response = await fetch(uploadUrl, {
          method: 'PUT',
          credentials: 'omit',
          headers: { 'content-type': file.type },
          body: file,
        })
      } catch (cause) {
        // Needs its own translation: this `fetch` bypasses `request()` entirely, so without it an
        // offline upload is the one write that still reports "Failed to fetch".
        throw new OfflineError('write', cause)
      }

      if (!response.ok) {
        // Storage errors are XML, not problem+json, so there is nothing useful to parse. Surface
        // the status rather than swallowing it (conventions/code.md §6).
        throw new ApiError({
          type: 'about:blank',
          title: 'Upload failed',
          status: response.status,
          detail: `Storage rejected the upload (${response.status}).`,
        })
      }
    },
  },

  reminders: {
    listForDocument: (documentId: string): Promise<Reminder[]> =>
      request(`/api/v1/documents/${documentId}/reminders`, reminderListResponseSchema).then(
        (response) => response.data,
      ),

    create: (documentId: string, input: ReminderCreate): Promise<Reminder> =>
      request(`/api/v1/documents/${documentId}/reminders`, reminderSchema, {
        method: 'POST',
        body: input,
      }),

    remove: (id: string): Promise<null> =>
      request(`/api/v1/reminders/${id}`, noContentSchema, { method: 'DELETE' }),

    dismiss: (id: string): Promise<Reminder> =>
      request(`/api/v1/reminders/${id}/dismiss`, reminderSchema, { method: 'POST' }),
  },

  push: {
    publicKey: (): Promise<string | null> =>
      request('/api/v1/push/public-key', pushPublicKeyResponseSchema).then(
        (response) => response.public_key,
      ),

    subscribe: (subscription: PushSubscriptionPayload): Promise<{ id: string }> =>
      request('/api/v1/push/subscriptions', pushSubscribeResponseSchema, {
        method: 'POST',
        body: subscription,
      }),
  },
}
