import type { FastifyInstance } from 'fastify'
import { afterAll, beforeAll, expect, it } from 'vitest'
import { buildApp } from '../../app.js'
import { describeDb, withCleanDatabase } from '../../test/db.js'
import { authAs, createThing, seedTwoUsers, seedUserWithSpace } from '../../test/factories.js'

/**
 * Thing photo lifecycle tests — domains/things.md §3 (`thing_photos`), §4 rule 11 and §5's photo
 * verbs.
 *
 * **These run with fake R2 credentials** (see `vitest.config.ts`), exactly as
 * `documents.files.test.ts` does. That is not a compromise: presigning is a purely local SigV4
 * computation with no network call and no credential validation, so the real code path is exercised
 * end to end and only the bytes are absent.
 *
 * The one behaviour here that has no counterpart in Documents is `make_hero` on the **presign**
 * request rather than at confirm. That is what the contract already specified, and it is why
 * `thing_photos_one_hero_key` also requires `uploaded_at is not null` — an unconfirmed row may carry
 * the flag as an intention, and only a confirmed one may hold the slot.
 */

let app: FastifyInstance

const JPEG = { mime: 'image/jpeg', size_bytes: 2048 }

async function presign(
  user: { sessionCookie: string },
  thingId: string,
  body: Record<string, unknown> = JPEG,
) {
  return app.inject({
    method: 'POST',
    url: `/api/v1/things/${thingId}/photos:presign-upload`,
    ...authAs(user),
    payload: body,
  })
}

async function confirm(user: { sessionCookie: string }, thingId: string, photoId: string) {
  return app.inject({
    method: 'POST',
    url: `/api/v1/things/${thingId}/photos:confirm`,
    ...authAs(user),
    payload: { photo_id: photoId },
  })
}

async function photosOf(user: { sessionCookie: string }, thingId: string) {
  const detail = await app.inject({
    method: 'GET',
    url: `/api/v1/things/${thingId}`,
    ...authAs(user),
  })
  return detail.json().photos as { id: string; is_hero: boolean; uploaded_at: string | null }[]
}

describeDb('thing photos', () => {
  withCleanDatabase()

  beforeAll(async () => {
    app = await buildApp({ startJobs: false })
    await app.ready()
  })

  afterAll(async () => {
    await app.close()
  })

  // ── Invariant 6: the API chooses the key ─────────────────────────────────

  it('invariant 6: the API chooses the object key, in the ADR-0008 shape', async () => {
    const user = await seedUserWithSpace(app)
    const thing = await createThing(app, user)

    const response = await presign(user, thing.id)
    expect(response.statusCode).toBe(201)

    const body = response.json()
    // `spaces/{spaceId}/things/{thingId}/{photoId}` — things.md §3. Note `things`, not `documents`:
    // one bucket, two collections, and a key that names which.
    expect(body.storage_key).toMatch(
      new RegExp(`^spaces/[0-9a-f-]{36}/things/${thing.id}/[0-9a-f-]{36}$`),
    )
    expect(body.upload_url).toContain(body.storage_key)
  })

  it('invariant 6: rejects any attempt to supply a key, path or filename', async () => {
    const user = await seedUserWithSpace(app)
    const thing = await createThing(app, user)

    // `presignPhotoUploadRequestSchema` is a `z.strictObject`, so there is no key for one to land in.
    for (const field of ['storage_key', 'key', 'path', 'filename']) {
      const response = await presign(user, thing.id, { ...JPEG, [field]: '../../etc/passwd' })
      expect(response.statusCode, `${field} must be rejected`).toBe(400)
    }
  })

  // ── Rule 11: size and mime limits, before any bytes move ─────────────────

  it('rule 11: rejects an oversized photo at presign time', async () => {
    const user = await seedUserWithSpace(app)
    const thing = await createThing(app, user)

    const response = await presign(user, thing.id, {
      mime: 'image/jpeg',
      size_bytes: 26 * 1024 * 1024,
    })
    expect(response.statusCode).toBe(400)
  })

  it('rule 11: accepts the image allowlist and rejects PDF', async () => {
    const user = await seedUserWithSpace(app)
    const thing = await createThing(app, user)

    for (const mime of ['image/jpeg', 'image/png', 'image/heic', 'image/webp', 'image/tiff']) {
      const response = await presign(user, thing.id, { mime, size_bytes: 100 })
      expect(response.statusCode, `${mime} must be accepted`).toBe(201)
    }

    // **PDF is the interesting rejection**, not a random type: it is on the *document* allowlist, and
    // accepting it here would put a document in a slot whose UI is a thumbnail strip (rule 11).
    for (const mime of ['application/pdf', 'application/zip', 'text/html']) {
      const response = await presign(user, thing.id, { mime, size_bytes: 100 })
      expect(response.statusCode, `${mime} must be rejected`).toBe(400)
    }
  })

  it('rule 11: signs the declared size and type into the URL, so storage enforces them too', async () => {
    const user = await seedUserWithSpace(app)
    const thing = await createThing(app, user)

    const response = await presign(user, thing.id)
    const url = response.json().upload_url as string
    const signed = new URL(url).searchParams.get('X-Amz-SignedHeaders') ?? ''

    // Without BOTH in SignedHeaders the limits are advisory: `size_bytes` becomes a suggestion the
    // client can exceed, and the mime allowlist becomes a value the client chose.
    expect(signed).toContain('content-length')
    expect(signed).toContain('content-type')

    // And no checksum of an empty body. The SDK's default signs the CRC32 of the (absent) payload,
    // which real storage then rejects when actual bytes arrive.
    expect(url).not.toContain('x-amz-checksum')
  })

  // ── The hero photo ───────────────────────────────────────────────────────

  it('the first confirmed photo becomes the hero', async () => {
    const user = await seedUserWithSpace(app)
    const thing = await createThing(app, user)

    const photo = await presign(user, thing.id)
    const confirmed = await confirm(user, thing.id, photo.json().photo_id)

    expect(confirmed.statusCode).toBe(200)
    // `make_hero` defaults to true on the presign request, so the common case needs no decision from
    // the client — things.md §3: the hero is the one shown at the top of the detail screen and as the
    // list thumbnail, and a thing with photos and no hero renders as having none.
    expect(confirmed.json().is_hero).toBe(true)
  })

  it('an unconfirmed hero intention does not occupy the slot', async () => {
    const user = await seedUserWithSpace(app)
    const thing = await createThing(app, user)

    /**
     * The reason `thing_photos_one_hero_key` also requires `uploaded_at is not null`.
     *
     * `make_hero` is declared at **presign** time, so the flag is written to a row that has no bytes
     * yet. Without that predicate an abandoned upload would hold the hero slot with a photo that
     * cannot be displayed, and this second presign would be **rejected by the unique index** — a 500
     * on "add a photo" after one earlier upload was abandoned.
     */
    const abandoned = await presign(user, thing.id)
    expect(abandoned.statusCode).toBe(201)

    const real = await presign(user, thing.id)
    expect(real.statusCode).toBe(201)

    const confirmed = await confirm(user, thing.id, real.json().photo_id)
    expect(confirmed.statusCode).toBe(200)
    expect(confirmed.json().is_hero).toBe(true)

    // And the abandoned row is still there, unconfirmed, holding nothing.
    const photos = await photosOf(user, thing.id)
    expect(photos).toHaveLength(2)
    expect(photos.filter((photo) => photo.is_hero)).toHaveLength(1)
    expect(photos.find((photo) => photo.uploaded_at === null)?.is_hero).toBe(false)
  })

  it('a later hero demotes the earlier one, so there is always exactly one', async () => {
    const user = await seedUserWithSpace(app)
    const thing = await createThing(app, user)

    const first = await presign(user, thing.id)
    await confirm(user, thing.id, first.json().photo_id)
    const second = await presign(user, thing.id)
    const confirmedSecond = await confirm(user, thing.id, second.json().photo_id)
    expect(confirmedSecond.json().is_hero).toBe(true)

    const photos = await photosOf(user, thing.id)
    // Exactly one, always. The database enforces it too — see migrations.test.ts.
    expect(photos.filter((photo) => photo.is_hero)).toHaveLength(1)
    expect(photos.find((photo) => photo.is_hero)?.id).toBe(second.json().photo_id)
  })

  it('respects make_hero: false, leaving the existing hero alone', async () => {
    const user = await seedUserWithSpace(app)
    const thing = await createThing(app, user)

    const first = await presign(user, thing.id)
    await confirm(user, thing.id, first.json().photo_id)

    const second = await presign(user, thing.id, { ...JPEG, make_hero: false })
    const confirmed = await confirm(user, thing.id, second.json().photo_id)

    expect(confirmed.json().is_hero).toBe(false)
    const photos = await photosOf(user, thing.id)
    expect(photos.find((photo) => photo.is_hero)?.id).toBe(first.json().photo_id)
  })

  it('promotes an older photo on request, demoting the newer one', async () => {
    const user = await seedUserWithSpace(app)
    const thing = await createThing(app, user)

    const first = await presign(user, thing.id)
    await confirm(user, thing.id, first.json().photo_id)
    const second = await presign(user, thing.id)
    await confirm(user, thing.id, second.json().photo_id)

    const promoted = await app.inject({
      method: 'PATCH',
      url: `/api/v1/things/${thing.id}/photos/${first.json().photo_id}`,
      ...authAs(user),
      payload: { is_hero: true },
    })
    expect(promoted.statusCode).toBe(200)
    expect(promoted.json().is_hero).toBe(true)

    const photos = await photosOf(user, thing.id)
    expect(photos.filter((photo) => photo.is_hero)).toHaveLength(1)
    expect(photos.find((photo) => photo.is_hero)?.id).toBe(first.json().photo_id)
  })

  it('refuses to demote a photo directly — you promote another one instead', async () => {
    const user = await seedUserWithSpace(app)
    const thing = await createThing(app, user)
    const photo = await presign(user, thing.id)
    await confirm(user, thing.id, photo.json().photo_id)

    // `thingPhotoUpdateSchema` is `{ is_hero: z.literal(true) }`. A thing with photos and no hero
    // renders with an empty thumbnail slot, which is worse than the wrong photo winning.
    const demoted = await app.inject({
      method: 'PATCH',
      url: `/api/v1/things/${thing.id}/photos/${photo.json().photo_id}`,
      ...authAs(user),
      payload: { is_hero: false },
    })
    expect(demoted.statusCode).toBe(400)
  })

  it('refuses to make an unconfirmed photo the hero', async () => {
    const user = await seedUserWithSpace(app)
    const thing = await createThing(app, user)
    const photo = await presign(user, thing.id)

    const promoted = await app.inject({
      method: 'PATCH',
      url: `/api/v1/things/${thing.id}/photos/${photo.json().photo_id}`,
      ...authAs(user),
      payload: { is_hero: true },
    })
    // 409: there are no bytes behind it, so the thumbnail would be a broken image.
    expect(promoted.statusCode).toBe(409)
  })

  it('promotes a successor when the hero is deleted', async () => {
    const user = await seedUserWithSpace(app)
    const thing = await createThing(app, user)

    const first = await presign(user, thing.id)
    await confirm(user, thing.id, first.json().photo_id)
    const second = await presign(user, thing.id)
    await confirm(user, thing.id, second.json().photo_id)

    // The second is hero. Deleting it must not leave the thing with photos and no hero.
    const deleted = await app.inject({
      method: 'DELETE',
      url: `/api/v1/things/${thing.id}/photos/${second.json().photo_id}`,
      ...authAs(user),
    })
    expect(deleted.statusCode).toBe(204)

    const photos = await photosOf(user, thing.id)
    expect(photos).toHaveLength(1)
    expect(photos[0]?.is_hero).toBe(true)
    expect(photos[0]?.id).toBe(first.json().photo_id)
  })

  // ── Confirm semantics ────────────────────────────────────────────────────

  it('409s on a second confirm of the same photo', async () => {
    const user = await seedUserWithSpace(app)
    const thing = await createThing(app, user)

    const photo = await presign(user, thing.id)
    expect((await confirm(user, thing.id, photo.json().photo_id)).statusCode).toBe(200)

    // Not idempotent-by-silence on purpose: a second confirm means the client lost track of state, and
    // `Idempotency-Key` is the mechanism for a *retried* confirm (conventions/api.md §5).
    const again = await confirm(user, thing.id, photo.json().photo_id)
    expect(again.statusCode).toBe(409)
  })

  it('records a sha256 when one is given, and accepts its absence', async () => {
    const user = await seedUserWithSpace(app)
    const thing = await createThing(app, user)
    const photo = await presign(user, thing.id)

    const digest = 'a'.repeat(64)
    const confirmed = await app.inject({
      method: 'POST',
      url: `/api/v1/things/${thing.id}/photos:confirm`,
      ...authAs(user),
      payload: { photo_id: photo.json().photo_id, sha256: digest },
    })
    expect(confirmed.statusCode).toBe(200)
    expect(confirmed.json().sha256).toBe(digest)

    const second = await presign(user, thing.id)
    const badDigest = await app.inject({
      method: 'POST',
      url: `/api/v1/things/${thing.id}/photos:confirm`,
      ...authAs(user),
      payload: { photo_id: second.json().photo_id, sha256: 'NOTAHEXDIGEST' },
    })
    expect(badDigest.statusCode).toBe(400)
  })

  // ── photo_count: non-zero, and it changes (debt D33) ─────────────────────

  it('counts confirmed photos in photo_count, and the count changes', async () => {
    const user = await seedUserWithSpace(app)
    const thing = await createThing(app, user)

    /**
     * The assertion whose absence hid a real bug for the whole of M1's build: every `file_count`
     * assertion happened to expect **0** — a new record, an unconfirmed upload — so a correlated
     * subquery that always returned 0 passed all of them. Debt D33.
     *
     * Asserted on the list AND on detail, because those were not equally wrong last time.
     */
    const unconfirmed = await presign(user, thing.id)
    const listBefore = await app.inject({ method: 'GET', url: '/api/v1/things', ...authAs(user) })
    // An abandoned upload must not count — a thumbnail slot with nothing to put in it.
    expect((listBefore.json().data as { photo_count: number }[])[0]?.photo_count).toBe(0)

    await confirm(user, thing.id, unconfirmed.json().photo_id)
    const listAfter = await app.inject({ method: 'GET', url: '/api/v1/things', ...authAs(user) })
    expect((listAfter.json().data as { photo_count: number }[])[0]?.photo_count).toBe(1)

    const second = await presign(user, thing.id)
    await confirm(user, thing.id, second.json().photo_id)
    const listTwo = await app.inject({ method: 'GET', url: '/api/v1/things', ...authAs(user) })
    // Two, so this cannot pass by returning a constant.
    expect((listTwo.json().data as { photo_count: number }[])[0]?.photo_count).toBe(2)

    const detail = await app.inject({
      method: 'GET',
      url: `/api/v1/things/${thing.id}`,
      ...authAs(user),
    })
    expect(detail.json().photo_count).toBe(2)

    // And a deleted photo stops counting — the count goes back DOWN.
    await app.inject({
      method: 'DELETE',
      url: `/api/v1/things/${thing.id}/photos/${second.json().photo_id}`,
      ...authAs(user),
    })
    const listAfterDelete = await app.inject({
      method: 'GET',
      url: '/api/v1/things',
      ...authAs(user),
    })
    expect((listAfterDelete.json().data as { photo_count: number }[])[0]?.photo_count).toBe(1)
  })

  // ── Download ─────────────────────────────────────────────────────────────

  it('refuses to presign a download for an unconfirmed upload', async () => {
    const user = await seedUserWithSpace(app)
    const thing = await createThing(app, user)
    const photo = await presign(user, thing.id)

    const response = await app.inject({
      method: 'POST',
      url: `/api/v1/things/${thing.id}/photos:presign-download`,
      ...authAs(user),
      payload: { photo_id: photo.json().photo_id },
    })
    // A URL that 404s at R2 would look like a storage fault rather than a state error.
    expect(response.statusCode).toBe(409)
  })

  it('presigns a download for a confirmed photo, as an attachment', async () => {
    const user = await seedUserWithSpace(app)
    const thing = await createThing(app, user)
    const photo = await presign(user, thing.id)
    await confirm(user, thing.id, photo.json().photo_id)

    const response = await app.inject({
      method: 'POST',
      url: `/api/v1/things/${thing.id}/photos:presign-download`,
      ...authAs(user),
      payload: { photo_id: photo.json().photo_id },
    })

    expect(response.statusCode).toBe(201)
    const url = response.json().download_url as string
    // `attachment`, so a stored SVG cannot execute in the user's session if it is opened directly.
    expect(url.toLowerCase()).toContain('attachment')
  })

  // ── Invariant 6 again: the key never leaks ───────────────────────────────

  it('never exposes a storage key in any response but the presign', async () => {
    const user = await seedUserWithSpace(app)
    const thing = await createThing(app, user)
    const photo = await presign(user, thing.id)
    await confirm(user, thing.id, photo.json().photo_id)

    const detail = await app.inject({
      method: 'GET',
      url: `/api/v1/things/${thing.id}`,
      ...authAs(user),
    })
    // The presign response returns it once, for transparency. Nothing else should — exposing it would
    // invite a client to construct one (invariant 6), and `thingPhotoSchema` deliberately omits it.
    expect(detail.body).not.toContain('spaces/')
    const photos = detail.json().photos as Record<string, unknown>[]
    expect(photos[0]).not.toHaveProperty('storage_key')
  })

  // ── Cross-space ──────────────────────────────────────────────────────────

  it("404s when reaching for another space's photo", async () => {
    const { alice, bob } = await seedTwoUsers(app)
    const thing = await createThing(app, alice)
    const photo = await presign(alice, thing.id)
    await confirm(alice, thing.id, photo.json().photo_id)
    const photoId = photo.json().photo_id

    const attempts = [
      {
        method: 'POST' as const,
        url: `/api/v1/things/${thing.id}/photos:presign-download`,
        payload: { photo_id: photoId },
      },
      {
        method: 'PATCH' as const,
        url: `/api/v1/things/${thing.id}/photos/${photoId}`,
        payload: { is_hero: true },
      },
      { method: 'DELETE' as const, url: `/api/v1/things/${thing.id}/photos/${photoId}` },
    ]

    for (const attempt of attempts) {
      const response = await app.inject({ ...attempt, ...authAs(bob) })
      expect(response.statusCode, `${attempt.method} ${attempt.url}`).toBe(404)
      expect(response.statusCode).not.toBe(403)
    }

    // And Alice's photo is untouched by the attempts.
    const photos = await photosOf(alice, thing.id)
    expect(photos).toHaveLength(1)
    expect(photos[0]?.is_hero).toBe(true)
  })

  it('a photo id from another thing is 404, even within one space', async () => {
    const user = await seedUserWithSpace(app)
    const car = await createThing(app, user, { name: 'Car' })
    const laptop = await createThing(app, user, { name: 'Laptop' })
    const photo = await presign(user, car.id)
    await confirm(user, car.id, photo.json().photo_id)

    // `findPhoto` filters on `thing_id` as well as the photo id, so a photo cannot be addressed
    // through the wrong parent — which would otherwise let a delete on one thing remove another's.
    const response = await app.inject({
      method: 'DELETE',
      url: `/api/v1/things/${laptop.id}/photos/${photo.json().photo_id}`,
      ...authAs(user),
    })
    expect(response.statusCode).toBe(404)

    const photos = await photosOf(user, car.id)
    expect(photos).toHaveLength(1)
  })

  it('deleting a thing soft-deletes its photos', async () => {
    const user = await seedUserWithSpace(app)
    const thing = await createThing(app, user)
    const photo = await presign(user, thing.id)
    await confirm(user, thing.id, photo.json().photo_id)

    await app.inject({
      method: 'DELETE',
      url: `/api/v1/things/${thing.id}?version=${thing.version}`,
      ...authAs(user),
    })

    // The thing is gone, so its photos are unreachable through it. The R2 objects are deliberately
    // left in place (ADR-0008) — recoverability beats tidiness.
    const detail = await app.inject({
      method: 'GET',
      url: `/api/v1/things/${thing.id}`,
      ...authAs(user),
    })
    expect(detail.statusCode).toBe(404)
  })
})
