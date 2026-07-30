import { GetObjectCommand, PutObjectCommand, S3Client } from '@aws-sdk/client-s3'
import { getSignedUrl } from '@aws-sdk/s3-request-presigner'
import { r2Config } from '../env.js'
import { NotConfiguredError } from './errors.js'

/**
 * Cloudflare R2, via presigned URLs. ADR-0008, and **the only module that constructs an object
 * key** — invariant 6: "The API chooses every storage object key. Clients never supply one."
 *
 * That invariant is the entire security property of direct-to-storage transfer. A client cannot
 * address another space's object because it never names anything: it receives a URL scoped to one
 * object it has already been authorized for, and a PUT URL cannot GET.
 *
 * R2 rather than S3 because egress is free, which is the dominant cost for a read-heavy personal
 * archive on mobile. The S3 SDK works unchanged because R2 is S3-compatible, so the provider stays
 * replaceable (ADR-0008).
 *
 * **Presigning is offline.** `getSignedUrl` is a local SigV4 computation — no network call, no
 * credential validation against the service. That is why tests can exercise this code path with
 * obviously-fake keys and still assert the real URL shape.
 */

/**
 * `spaces/{spaceId}/documents/{documentId}/{fileId}` — exactly as ADR-0008 specifies.
 *
 * Every segment is a server-generated UUID or a value read from a row the actor already passed the
 * space filter for. Nothing here comes from a request body, so there is no traversal to sanitise:
 * the shape is unreachable rather than merely validated.
 *
 * **No filename, and that is deliberate.** ADR-0008's step-1 sketch shows a `filename` in the
 * request, but business rule 5 forbids a client-supplied destination filename and
 * `document_files` has no column for one. The domain doc is the later and more specific
 * statement, so it wins; the mismatch is recorded in the debt register.
 */
export function objectKeyFor(args: {
  spaceId: string
  documentId: string
  fileId: string
}): string {
  return `spaces/${args.spaceId}/documents/${args.documentId}/${args.fileId}`
}

/**
 * `spaces/{spaceId}/things/{thingId}/{photoId}` — things.md §3, the same shape as a document file's
 * key and for the same reasons.
 *
 * A separate function rather than a generalised `objectKeyFor({ kind, ownerId, fileId })`: the two
 * keys are the *only* two, a generic one would take the collection name as a parameter, and a
 * parameterised key is one string away from being a client-supplied path. Invariant 6 is easier to
 * keep true when each key shape is a literal in one function.
 *
 * Every segment is a server-generated UUID or a value read from a row the actor already passed the
 * space filter for, so there is no traversal to sanitise — the shape is unreachable rather than
 * merely validated.
 */
export function thingPhotoKeyFor(args: {
  spaceId: string
  thingId: string
  photoId: string
}): string {
  return `spaces/${args.spaceId}/things/${args.thingId}/${args.photoId}`
}

/**
 * Built lazily and cached, rather than at module load. Importing this module must not throw when
 * R2 is unconfigured — the whole point of the optional group in `env.ts` is that Documents works
 * without storage, and a module-level `new S3Client(...)` would take the process down at boot.
 */
let client: S3Client | undefined

function s3(): { client: S3Client; bucket: string; ttlSeconds: number } {
  const config = r2Config()
  if (config === null) {
    throw new NotConfiguredError(
      'File storage is not configured on this deployment. Set the R2_* variables.',
    )
  }

  client ??= new S3Client({
    // R2's S3 endpoint. `auto` is the only region R2 accepts, and SigV4 needs *a* region.
    region: 'auto',
    endpoint: config.endpointOverride ?? `https://${config.accountId}.r2.cloudflarestorage.com`,
    /**
     * Path-style only when an endpoint override is in play. R2 uses virtual-hosted addressing, but
     * a localhost S3 server cannot — `bucket.127.0.0.1` does not resolve. See `R2_ENDPOINT`.
     */
    ...(config.endpointOverride === undefined ? {} : { forcePathStyle: true }),
    credentials: {
      accessKeyId: config.accessKeyId,
      secretAccessKey: config.secretAccessKey,
    },

    /**
     * **`WHEN_REQUIRED`, and this is load-bearing for presigned uploads.**
     *
     * Recent AWS SDK versions default to `WHEN_SUPPORTED`, which computes a CRC32 of the request
     * body and signs it into the URL. For a presigned PUT there *is* no body yet, so the SDK
     * signs the checksum of an **empty** payload — `x-amz-checksum-crc32=AAAAAA==`. The client
     * then uploads real bytes, the checksum does not match, and storage rejects the PUT.
     *
     * Caught by the test asserting what is in `X-Amz-SignedHeaders`; it would otherwise have
     * surfaced as "uploads mysteriously fail against real R2" long after this code was written.
     */
    requestChecksumCalculation: 'WHEN_REQUIRED',
  })

  return { client, bucket: config.bucket, ttlSeconds: config.ttlSeconds }
}

export type PresignedUrl = { url: string; expiresAt: Date }

/**
 * A short-lived PUT for exactly one object.
 *
 * `ContentLength` is signed into the URL, so the client cannot upload more bytes than it declared
 * at presign time — which is what makes business rule 11's 25 MB limit an actual limit rather than
 * a number checked on a value the client chose. Without it, `size_bytes` would be a suggestion.
 *
 * `ContentType` is signed for the same reason: the mime allowlist would otherwise be advisory.
 */
export async function presignUpload(args: {
  key: string
  mime: string
  sizeBytes: number
}): Promise<PresignedUrl> {
  const { client: s3Client, bucket, ttlSeconds } = s3()

  const url = await getSignedUrl(
    s3Client,
    new PutObjectCommand({
      Bucket: bucket,
      Key: args.key,
      ContentType: args.mime,
      ContentLength: args.sizeBytes,
    }),
    {
      expiresIn: ttlSeconds,
      /**
       * **`signableHeaders` is required for `content-type` to actually be enforced.**
       *
       * Setting `ContentType` on the command alone does *not* put it in `X-Amz-SignedHeaders` —
       * measured, not assumed: the URL came back signing only `content-length;host`, so the mime
       * allowlist would have been advisory and a client could presign a PDF and upload HTML.
       * Naming both headers here makes storage reject a mismatch, which is what turns business
       * rule 11 into an actual constraint rather than a check on a value the client chose.
       */
      signableHeaders: new Set(['content-length', 'content-type']),
    },
  )

  return { url, expiresAt: new Date(Date.now() + ttlSeconds * 1000) }
}

/**
 * A short-lived GET for exactly one object.
 *
 * `ResponseContentDisposition: attachment` so a stored HTML or SVG file cannot execute in the
 * user's session if it is ever opened directly. The bucket is private and every URL is
 * short-lived, but a document archive is precisely where a hostile file ends up, and the header
 * costs nothing.
 */
export async function presignDownload(args: { key: string; mime: string }): Promise<PresignedUrl> {
  const { client: s3Client, bucket, ttlSeconds } = s3()

  const url = await getSignedUrl(
    s3Client,
    new GetObjectCommand({
      Bucket: bucket,
      Key: args.key,
      ResponseContentType: args.mime,
      ResponseContentDisposition: 'attachment',
    }),
    { expiresIn: ttlSeconds },
  )

  return { url, expiresAt: new Date(Date.now() + ttlSeconds * 1000) }
}

/** Whether file endpoints can work at all. Lets a route answer 503 before doing any work. */
export function isStorageConfigured(): boolean {
  return r2Config() !== null
}
