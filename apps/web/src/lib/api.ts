import {
  type AuthProvidersResponse,
  authProvidersResponseSchema,
  type ConfirmUploadRequest,
  type CreatePerson,
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
  type HoldersResponse,
  healthResponseSchema,
  holdersResponseSchema,
  type MeResponse,
  meResponseSchema,
  type Person,
  type PersonListResponse,
  type PresignDownloadResponse,
  type PresignPhotoDownloadResponse,
  type PresignPhotoUploadRequest,
  type PresignPhotoUploadResponse,
  type PresignUploadRequest,
  type PresignUploadResponse,
  type Problem,
  type PushSubscription as PushSubscriptionPayload,
  personListResponseSchema,
  personSchema,
  presignDownloadResponseSchema,
  presignPhotoDownloadResponseSchema,
  presignPhotoUploadResponseSchema,
  presignUploadResponseSchema,
  problemSchema,
  pushPublicKeyResponseSchema,
  pushSubscribeResponseSchema,
  type Reminder,
  type ReminderCreate,
  type RenamedResponse,
  reminderListResponseSchema,
  reminderSchema,
  renamedResponseSchema,
  type Thing,
  type ThingCreate,
  type ThingDetailResponse,
  type ThingHoldersResponse,
  type ThingListQuery,
  type ThingListResponse,
  type ThingPhoto,
  type ThingService,
  type ThingServiceCreate,
  type ThingUpdate,
  thingDetailResponseSchema,
  thingHoldersResponseSchema,
  thingListResponseSchema,
  thingPhotoSchema,
  thingSchema,
  thingServiceSchema,
  type UpdatePerson,
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
function toQueryString(query: Partial<DocumentListQuery> | Partial<ThingListQuery>): string {
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

    /**
     * `idempotencyKey` is what makes an outbox replay safe (ADR-0024).
     *
     * Without it, a PATCH that SUCCEEDED on the server but whose response was lost — a dropped
     * connection at exactly the wrong moment, which is the normal case for a phone — would be
     * replayed with the version it originally read. The server has since bumped that version, so the
     * replay gets a 409 and the user is shown a conflict against *their own* successful write.
     *
     * With the key, the second attempt replays the cached response instead. The API honours the
     * header on every mutating method (`lib/idempotency.plugin.ts`), so this is purely a matter of
     * the client bothering to send one.
     */
    update: (id: string, patch: DocumentUpdate, idempotencyKey?: string): Promise<Document> =>
      request(`/api/v1/documents/${id}`, documentSchema, {
        method: 'PATCH',
        body: patch,
        idempotencyKey,
      }),

    /**
     * `version` is REQUIRED — debt D41, closed.
     *
     * A delete built against a stale read would otherwise destroy whatever was written since, and a
     * delete is the one write this app cannot undo: there is no restore endpoint. Required in the
     * signature means a call site that forgets is a type error rather than a lost document.
     *
     * It travels as a query parameter because `fetch` will not reliably send a body on a `DELETE`.
     */
    remove: (id: string, version: number): Promise<null> =>
      request(`/api/v1/documents/${id}?version=${version}`, noContentSchema, { method: 'DELETE' }),

    /**
     * The people picker's suggestions — pairs, so choosing a known person fills the relation too.
     *
     * Autocomplete for a *label*. It grants nobody access to anything: a holder is a word on a
     * document, and `space_id` is still the only thing that decides who can read one.
     */
    holders: (): Promise<HoldersResponse['data']> =>
      request('/api/v1/documents/holders', holdersResponseSchema).then((body) => body.data),

    issuers: (): Promise<string[]> =>
      request('/api/v1/documents/issuers', z.object({ data: z.array(z.string()) })).then(
        (response) => response.data,
      ),
  },

  /**
   * Things. ADR-0029, domains/things.md §5.
   *
   * **The server half exists now** — this block used to open by saying every call here 404s, which was
   * true while the client shipped first and is not any more (things.md §10). The paths below were
   * written against the contract in `packages/shared/src/things.ts` and the API implemented that
   * contract unchanged, which is what invariant 9 is for.
   */
  things: {
    list: (query: Partial<ThingListQuery> = {}): Promise<ThingListResponse> =>
      request(`/api/v1/things${toQueryString(query)}`, thingListResponseSchema),

    get: (id: string): Promise<ThingDetailResponse> =>
      request(`/api/v1/things/${id}`, thingDetailResponseSchema),

    create: (input: ThingCreate, idempotencyKey?: string): Promise<Thing> =>
      request('/api/v1/things', thingSchema, { method: 'POST', body: input, idempotencyKey }),

    update: (id: string, patch: ThingUpdate, idempotencyKey?: string): Promise<Thing> =>
      request(`/api/v1/things/${id}`, thingSchema, {
        method: 'PATCH',
        body: patch,
        idempotencyKey,
      }),

    /** `version` is REQUIRED, same as a document's — a stale delete must 409, not destroy an edit. */
    remove: (id: string, version: number): Promise<null> =>
      request(`/api/v1/things/${id}?version=${version}`, noContentSchema, { method: 'DELETE' }),

    holders: (): Promise<ThingHoldersResponse['data']> =>
      request('/api/v1/things/holders', thingHoldersResponseSchema).then((body) => body.data),

    /**
     * Logs a service. The **server** recomputes `service_due_on` from this date plus the interval
     * (things.md §4 rule 3) — the client does not send a next date, because a cycle whose next date
     * is client-computed is a cycle two devices can disagree about.
     */
    logService: (
      thingId: string,
      input: ThingServiceCreate,
      idempotencyKey?: string,
    ): Promise<ThingService> =>
      request(`/api/v1/things/${thingId}/services`, thingServiceSchema, {
        method: 'POST',
        body: input,
        idempotencyKey,
      }),

    /**
     * A thing's photos. things.md §5, and the same three-step dance as a document's scans: presign →
     * PUT the bytes straight to storage → confirm.
     *
     * Two differences from `api.files`, both from the contract rather than from taste:
     *
     *  - **The photo is named in the BODY on the download verb**, not in the path. `:presign-download`
     *     after a `:photoId` parameter routes correctly and generates a broken OpenAPI path —
     *     conventions/api.md §2, and the block comment at the top of `things.routes.ts`.
     *  - **`is_hero` is promotion-only.** `thingPhotoUpdateSchema` is `z.literal(true)`, so there is no
     *     `demote`; you promote another photo instead. A thing with photos and no main one would render
     *     an empty hero slot, which is worse than the wrong photo winning.
     *
     * ── ONE colon on the wire, always ──
     *
     * These three paths carried `photos::presign-upload` and shipped a 404 on every photo verb. The `::`
     * in `things.routes.ts` is Fastify's **registration-time** escape for one literal colon — it never
     * reaches a URL. conventions/api.md §2 says so in as many words ("The URL clients call is unchanged;
     * only the registration string is escaped"), `things.test.ts` asserts the OpenAPI paths with a single
     * colon, and `api.files` below has always written one. A client writes what the server registered,
     * unescaped.
     *
     * The bytes themselves go through `api.files.upload` — one `XMLHttpRequest` implementation for both
     * domains, because a second copy is a second place for the `withCredentials` rule to be forgotten.
     */
    photos: {
      presignUpload: (
        thingId: string,
        input: PresignPhotoUploadRequest,
      ): Promise<PresignPhotoUploadResponse> =>
        request(
          `/api/v1/things/${thingId}/photos:presign-upload`,
          presignPhotoUploadResponseSchema,
          { method: 'POST', body: input },
        ),

      confirm: (thingId: string, photoId: string): Promise<ThingPhoto> =>
        request(`/api/v1/things/${thingId}/photos:confirm`, thingPhotoSchema, {
          method: 'POST',
          body: { photo_id: photoId },
        }),

      presignDownload: (thingId: string, photoId: string): Promise<PresignPhotoDownloadResponse> =>
        request(
          `/api/v1/things/${thingId}/photos:presign-download`,
          presignPhotoDownloadResponseSchema,
          { method: 'POST', body: { photo_id: photoId } },
        ),

      makeHero: (thingId: string, photoId: string): Promise<ThingPhoto> =>
        request(`/api/v1/things/${thingId}/photos/${photoId}`, thingPhotoSchema, {
          method: 'PATCH',
          body: { is_hero: true },
        }),

      remove: (thingId: string, photoId: string): Promise<null> =>
        request(`/api/v1/things/${thingId}/photos/${photoId}`, noContentSchema, {
          method: 'DELETE',
        }),
    },
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
     * The one request in this file that does not go to our own origin, and the one that must NOT
     * send credentials: the presigned URL carries its own authorisation, and attaching our session
     * cookie to a third-party request would leak it. `withCredentials = false` is the default and is
     * asserted below rather than assumed.
     *
     * `content-type` and `content-length` are signed into the URL, so they must match what was
     * declared at presign time or storage rejects the upload.
     *
     * ═══════════════════════════════════════════════════════════════════════════════════════
     *  `XMLHttpRequest`, not `fetch`, and only because of `onProgress`.
     * ═══════════════════════════════════════════════════════════════════════════════════════
     *
     * `fetch` cannot report upload progress. A request body stream would let you *count bytes you
     * hand over*, but that is not the same number as bytes acknowledged, it needs `duplex: 'half'`,
     * and Safari does not support it at all. `XMLHttpRequest.upload.onprogress` is the only thing that
     * reports real progress in every browser this app runs in.
     *
     * A percentage is worth this: a 6MB scan over a phone connection is the app's slowest operation by
     * an order of magnitude, and a spinner with no number is indistinguishable from a hang. ADR-0025
     * §5 draws the bar; a faked animation would be a lie about the one thing the user is waiting on.
     */
    upload: (
      uploadUrl: string,
      file: File,
      onProgress?: (fraction: number) => void,
    ): Promise<void> =>
      new Promise((resolve, reject) => {
        const request_ = new XMLHttpRequest()
        request_.open('PUT', uploadUrl, true)
        request_.withCredentials = false
        request_.setRequestHeader('content-type', file.type)

        request_.upload.onprogress = (event) => {
          // `lengthComputable` is false for a chunked body. Reporting nothing is better than
          // reporting a fraction of an unknown total.
          if (event.lengthComputable && event.total > 0) onProgress?.(event.loaded / event.total)
        }

        request_.onload = () => {
          if (request_.status >= 200 && request_.status < 300) {
            resolve()
            return
          }
          // Storage errors are XML, not problem+json, so there is nothing useful to parse. Surface
          // the status rather than swallowing it (conventions/code.md §6).
          reject(
            new ApiError({
              type: 'about:blank',
              title: 'Upload failed',
              status: request_.status,
              detail: `Storage rejected the upload (${request_.status}).`,
            }),
          )
        }

        /**
         * Both handlers, not just `onerror`.
         *
         * A dropped connection mid-upload fires `onerror`, but a request the browser aborts — closing
         * the tab, navigating away — fires `onabort` and nothing else. Without it that promise never
         * settles, and the mutation sits `isPending` forever with a progress bar frozen at 70%.
         *
         * Needs its own translation because this request bypasses `request()` entirely; without it an
         * offline upload is the one write that still reports a raw network error.
         */
        request_.onerror = () => reject(new OfflineError('write', new Error('Upload failed')))
        request_.onabort = () => reject(new OfflineError('write', new Error('Upload aborted')))

        request_.send(file)
      }),
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

  /**
   * The People directory — [ADR-0034](../../../../docs/decisions/0034-people-is-a-directory.md).
   *
   * `rename` is `update` under another name, and it is separate because it returns more: a name change
   * bulk-updates `holder` on every document and thing that matched, and the response says how many.
   * The app reports that, so the call site needs it.
   */
  people: {
    list: (): Promise<PersonListResponse> => request('/api/v1/people', personListResponseSchema),

    create: (input: CreatePerson, idempotencyKey?: string): Promise<Person> =>
      request('/api/v1/people', personSchema, { method: 'POST', body: input, idempotencyKey }),

    update: (id: string, patch: UpdatePerson, idempotencyKey?: string): Promise<RenamedResponse> =>
      request(`/api/v1/people/${id}`, renamedResponseSchema, {
        method: 'PATCH',
        body: patch,
        idempotencyKey,
      }),

    /** `version` in the query string, per D41 — a stale delete must 409, not clobber an edit. */
    remove: (id: string, version: number): Promise<null> =>
      request(`/api/v1/people/${id}?version=${version}`, noContentSchema, { method: 'DELETE' }),
  },

  auth: {
    /**
     * What this deployment can sign you in with — ADR-0035. Read **before** any session exists, so the
     * sign-in screen knows whether its one button can work.
     */
    providers: (): Promise<AuthProvidersResponse> =>
      request('/api/v1/auth/providers', authProvidersResponseSchema),
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
