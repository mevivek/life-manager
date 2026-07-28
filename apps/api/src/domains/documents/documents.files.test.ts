import type { FastifyInstance } from 'fastify'
import { afterAll, beforeAll, expect, it } from 'vitest'
import { buildApp } from '../../app.js'
import { describeDb, withCleanDatabase } from '../../test/db.js'
import { authAs, createDocument, seedTwoUsers, seedUserWithSpace } from '../../test/factories.js'

/**
 * File lifecycle tests — domains/documents.md §4 rules 3, 4, 5, 11 and §5's file endpoints.
 *
 * **These run with fake R2 credentials** (see `vitest.config.ts`). That is not a compromise:
 * presigning is a purely local SigV4 computation with no network call and no credential validation,
 * so the real code path is exercised end to end and only the bytes are absent. The one thing not
 * covered here is R2 actually accepting the PUT, which no unit test could cover anyway.
 */

let app: FastifyInstance

const PDF = { mime: 'application/pdf', size_bytes: 1024 }

async function presign(
  user: { sessionCookie: string },
  documentId: string,
  body: Record<string, unknown> = PDF,
) {
  return app.inject({
    method: 'POST',
    url: `/api/v1/documents/${documentId}/files:presign-upload`,
    ...authAs(user),
    payload: body,
  })
}

async function confirm(user: { sessionCookie: string }, documentId: string, fileId: string) {
  return app.inject({
    method: 'POST',
    url: `/api/v1/documents/${documentId}/files:confirm`,
    ...authAs(user),
    payload: { file_id: fileId },
  })
}

describeDb('document files', () => {
  withCleanDatabase()

  beforeAll(async () => {
    app = await buildApp({ startJobs: false })
    await app.ready()
  })

  afterAll(async () => {
    await app.close()
  })

  // ── Rule 5 / invariant 6: the API chooses the key ────────────────────────

  it('rule 5: the API chooses the object key, in the ADR-0008 shape', async () => {
    const user = await seedUserWithSpace(app)
    const document = await createDocument(app, user)

    const response = await presign(user, document.id)
    expect(response.statusCode).toBe(201)

    const body = response.json()
    // `spaces/{spaceId}/documents/{documentId}/{fileId}` — ADR-0008.
    expect(body.storage_key).toMatch(
      new RegExp(`^spaces/[0-9a-f-]{36}/documents/${document.id}/[0-9a-f-]{36}$`),
    )
    expect(body.upload_url).toContain(body.storage_key)
    expect(body.version).toBe(1)
  })

  it('rule 5: rejects any attempt to supply a key, path or filename', async () => {
    const user = await seedUserWithSpace(app)
    const document = await createDocument(app, user)

    for (const field of ['storage_key', 'key', 'path', 'filename']) {
      const response = await presign(user, document.id, { ...PDF, [field]: '../../etc/passwd' })
      expect(response.statusCode, `${field} must be rejected`).toBe(400)
    }
  })

  // ── Rule 11: size and mime limits, before any bytes move ─────────────────

  it('rule 11: rejects an oversized file at presign time', async () => {
    const user = await seedUserWithSpace(app)
    const document = await createDocument(app, user)

    const response = await presign(user, document.id, {
      mime: 'application/pdf',
      size_bytes: 26 * 1024 * 1024,
    })
    expect(response.statusCode).toBe(400)
  })

  it('rule 11: rejects a mime type outside the allowlist', async () => {
    const user = await seedUserWithSpace(app)
    const document = await createDocument(app, user)

    const response = await presign(user, document.id, { mime: 'application/zip', size_bytes: 10 })
    expect(response.statusCode).toBe(400)
  })

  it('rule 11: signs the declared size and type into the URL, so storage enforces them too', async () => {
    const user = await seedUserWithSpace(app)
    const document = await createDocument(app, user)

    const response = await presign(user, document.id)
    const url = response.json().upload_url as string
    const signed = new URL(url).searchParams.get('X-Amz-SignedHeaders') ?? ''

    // Without BOTH in SignedHeaders, the limits are advisory: `size_bytes` becomes a suggestion
    // the client can exceed, and the mime allowlist becomes a value the client chose.
    expect(signed).toContain('content-length')
    expect(signed).toContain('content-type')

    // And no checksum of an empty body. The SDK's default would sign the CRC32 of the (absent)
    // payload, which real storage then rejects when actual bytes arrive.
    expect(url).not.toContain('x-amz-checksum')
  })

  // ── Rule 4: server-assigned monotonic versions ───────────────────────────

  it('rule 4: assigns versions monotonically, and never recycles a deleted one', async () => {
    const user = await seedUserWithSpace(app)
    const document = await createDocument(app, user)

    const first = await presign(user, document.id)
    expect(first.json().version).toBe(1)
    await confirm(user, document.id, first.json().file_id)

    const second = await presign(user, document.id)
    expect(second.json().version).toBe(2)
    await confirm(user, document.id, second.json().file_id)

    // Delete v2, then upload again: the next version must be 3, not a reused 2. The unique index
    // on (document_id, version) is not partial on deleted_at precisely so history stays honest.
    await app.inject({
      method: 'DELETE',
      url: `/api/v1/documents/${document.id}/files/${second.json().file_id}`,
      ...authAs(user),
    })

    const third = await presign(user, document.id)
    expect(third.json().version).toBe(3)
  })

  // ── Rule 3: at most one primary ──────────────────────────────────────────

  it('rule 3: a new confirmed version becomes primary and demotes the previous one', async () => {
    const user = await seedUserWithSpace(app)
    const document = await createDocument(app, user)

    const v1 = await presign(user, document.id)
    const confirmed1 = await confirm(user, document.id, v1.json().file_id)
    expect(confirmed1.json().is_primary).toBe(true)

    const v2 = await presign(user, document.id)
    const confirmed2 = await confirm(user, document.id, v2.json().file_id)
    expect(confirmed2.json().is_primary).toBe(true)

    const detail = await app.inject({
      method: 'GET',
      url: `/api/v1/documents/${document.id}`,
      ...authAs(user),
    })
    const files = detail.json().files as { version: number; is_primary: boolean }[]
    // Exactly one primary, always. The database enforces it too — see migrations.test.ts.
    expect(files.filter((file) => file.is_primary)).toHaveLength(1)
    expect(files.find((file) => file.is_primary)?.version).toBe(2)
  })

  it('rule 3: promoting an older version demotes the newer one', async () => {
    const user = await seedUserWithSpace(app)
    const document = await createDocument(app, user)

    const v1 = await presign(user, document.id)
    await confirm(user, document.id, v1.json().file_id)
    const v2 = await presign(user, document.id)
    await confirm(user, document.id, v2.json().file_id)

    const promoted = await app.inject({
      method: 'PATCH',
      url: `/api/v1/documents/${document.id}/files/${v1.json().file_id}`,
      ...authAs(user),
      payload: { is_primary: true },
    })
    expect(promoted.statusCode).toBe(200)
    expect(promoted.json().version).toBe(1)

    const detail = await app.inject({
      method: 'GET',
      url: `/api/v1/documents/${document.id}`,
      ...authAs(user),
    })
    const files = detail.json().files as { version: number; is_primary: boolean }[]
    expect(files.filter((file) => file.is_primary)).toHaveLength(1)
    expect(files.find((file) => file.is_primary)?.version).toBe(1)
  })

  it('promotes a successor when the primary is deleted', async () => {
    const user = await seedUserWithSpace(app)
    const document = await createDocument(app, user)

    const v1 = await presign(user, document.id)
    await confirm(user, document.id, v1.json().file_id)
    const v2 = await presign(user, document.id)
    await confirm(user, document.id, v2.json().file_id)

    // v2 is primary. Deleting it must not leave the document with files but no primary, which
    // would render as "no file at all".
    await app.inject({
      method: 'DELETE',
      url: `/api/v1/documents/${document.id}/files/${v2.json().file_id}`,
      ...authAs(user),
    })

    const detail = await app.inject({
      method: 'GET',
      url: `/api/v1/documents/${document.id}`,
      ...authAs(user),
    })
    const files = detail.json().files as { version: number; is_primary: boolean }[]
    expect(files).toHaveLength(1)
    expect(files[0]?.is_primary).toBe(true)
  })

  // ── Confirm semantics ────────────────────────────────────────────────────

  it('409s on a second confirm of the same file', async () => {
    const user = await seedUserWithSpace(app)
    const document = await createDocument(app, user)

    const file = await presign(user, document.id)
    expect((await confirm(user, document.id, file.json().file_id)).statusCode).toBe(200)

    const again = await confirm(user, document.id, file.json().file_id)
    expect(again.statusCode).toBe(409)
  })

  it('does not count an unconfirmed upload as a file', async () => {
    const user = await seedUserWithSpace(app)
    const document = await createDocument(app, user)
    await presign(user, document.id)

    const list = await app.inject({ method: 'GET', url: '/api/v1/documents', ...authAs(user) })
    // An abandoned upload must not make `has_file` true — otherwise the "documents with no file"
    // view silently stops listing documents whose only upload failed halfway.
    expect((list.json().data as { file_count: number }[])[0]?.file_count).toBe(0)

    const withFile = await app.inject({
      method: 'GET',
      url: '/api/v1/documents?has_file=true',
      ...authAs(user),
    })
    expect(withFile.json().data).toEqual([])
  })

  it('refuses to presign a download for an unconfirmed upload', async () => {
    const user = await seedUserWithSpace(app)
    const document = await createDocument(app, user)
    const file = await presign(user, document.id)

    const response = await app.inject({
      method: 'POST',
      url: `/api/v1/documents/${document.id}/files:presign-download`,
      ...authAs(user),
      payload: { file_id: file.json().file_id },
    })
    // A URL that 404s at R2 would look like a storage fault rather than a state error.
    expect(response.statusCode).toBe(409)
  })

  it('presigns a download for a confirmed file, as an attachment', async () => {
    const user = await seedUserWithSpace(app)
    const document = await createDocument(app, user)
    const file = await presign(user, document.id)
    await confirm(user, document.id, file.json().file_id)

    const response = await app.inject({
      method: 'POST',
      url: `/api/v1/documents/${document.id}/files:presign-download`,
      ...authAs(user),
      payload: { file_id: file.json().file_id },
    })

    expect(response.statusCode).toBe(201)
    const url = response.json().download_url as string
    // `attachment`, so a stored HTML or SVG cannot execute in the user's session.
    expect(url.toLowerCase()).toContain('attachment')
  })

  // ── Cross-space ──────────────────────────────────────────────────────────

  it('never exposes a storage key in any response', async () => {
    const user = await seedUserWithSpace(app)
    const document = await createDocument(app, user)
    const file = await presign(user, document.id)
    await confirm(user, document.id, file.json().file_id)

    const detail = await app.inject({
      method: 'GET',
      url: `/api/v1/documents/${document.id}`,
      ...authAs(user),
    })
    // The presign response returns it once, for transparency. Nothing else should — exposing it
    // would invite a client to construct one (invariant 6).
    expect(detail.body).not.toContain('spaces/')
    const files = detail.json().files as Record<string, unknown>[]
    expect(files[0]).not.toHaveProperty('storage_key')
  })

  it("404s when reaching for another space's file", async () => {
    const { alice, bob } = await seedTwoUsers(app)
    const document = await createDocument(app, alice)
    const file = await presign(alice, document.id)
    await confirm(alice, document.id, file.json().file_id)
    const fileId = file.json().file_id

    const attempts = [
      {
        method: 'POST' as const,
        url: `/api/v1/documents/${document.id}/files:presign-download`,
        payload: { file_id: fileId },
      },
      {
        method: 'PATCH' as const,
        url: `/api/v1/documents/${document.id}/files/${fileId}`,
        payload: { is_primary: true },
      },
      { method: 'DELETE' as const, url: `/api/v1/documents/${document.id}/files/${fileId}` },
    ]

    for (const attempt of attempts) {
      const response = await app.inject({ ...attempt, ...authAs(bob) })
      expect(response.statusCode, `${attempt.method} ${attempt.url}`).toBe(404)
    }
  })

  it('rule 9: deleting a document soft-deletes its files', async () => {
    const user = await seedUserWithSpace(app)
    const document = await createDocument(app, user)
    const file = await presign(user, document.id)
    await confirm(user, document.id, file.json().file_id)

    await app.inject({
      method: 'DELETE',
      url: `/api/v1/documents/${document.id}`,
      ...authAs(user),
    })

    // The document is gone, so its files are unreachable through it. The R2 objects are
    // deliberately left in place (ADR-0008) — recoverability beats tidiness.
    const detail = await app.inject({
      method: 'GET',
      url: `/api/v1/documents/${document.id}`,
      ...authAs(user),
    })
    expect(detail.statusCode).toBe(404)
  })
})
