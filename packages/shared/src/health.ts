import { z } from 'zod'
import { isoDateTimeSchema } from './common.js'

/**
 * `GET /api/v1/health` — public, and deliberately does not touch the database. A health
 * check that fails when Postgres is asleep would make Neon's scale-to-zero look like an
 * outage.
 *
 * ── This response is also how the app answers "are the two halves in sync?" ──
 *
 * The web app deploys on push to Cloudflare Pages; the API deploys on push through Cloud Build,
 * and its guard step skips the build when nothing under `apps/api` changed. So the two halves
 * legitimately move independently — and once did so by ten commits, which is how a `documents`
 * response missing a field the client's schema required turned into an archive that would not
 * load with nothing in the UI naming the cause. `version` (the deployed commit) is what makes that
 * comparable from inside the app; `apps/web/src/features/health/BuildCard.tsx` draws it.
 */
export const healthResponseSchema = z.object({
  status: z.literal('ok'),
  /** The deployed commit sha. `APP_VERSION`, set by the deploy step; a local default otherwise. */
  version: z.string(),

  /**
   * **`process.uptime()`, and therefore NOT a deploy time.**
   *
   * The API is Cloud Run with `--min-instances=0` (ADR-0021), so the process is killed and restarted
   * whenever traffic stops — several times a day. A reading of 300 means the instance woke five
   * minutes ago and says nothing at all about when the image shipped. Anything rendering this must
   * label it as *awake for*; `built_at` is the field that answers "when was this deployed".
   */
  uptime_seconds: z.number().nonnegative(),

  /**
   * When the running image was deployed, baked in at deploy time from `BUILD_TIME`.
   *
   * **`nullable()`, not `optional()`**, so the key is present on every response with exactly one
   * representation of "not known". An optional key would give the client two (`null` and
   * `undefined`) for one state, and debt D46 is the record of what a field that is sometimes absent
   * costs: the persisted cache rehydrates without re-running Zod, so `undefined` where the type says
   * otherwise reaches a component and crashes it. The rest of the contract is nullable for the same
   * reason (`uploaded_at`, `holder`, `expires_on`).
   *
   * `null` is the honest answer for a local `pnpm dev` and for any image built without the variable.
   * A renderer must say so, and must never substitute the current time or the process start time.
   */
  built_at: isoDateTimeSchema.nullable(),
})
export type HealthResponse = z.infer<typeof healthResponseSchema>
