import { describe, expect, it } from 'vitest'
import * as contract from './index.js'

/**
 * ═══════════════════════════════════════════════════════════════════════════════════════════════
 *  A RESPONSE field may not be required of the server. Debt D54, mechanised.
 * ═══════════════════════════════════════════════════════════════════════════════════════════════
 *
 * ── The outage this exists to prevent ──
 *
 * The web app and the API deploy on **separate triggers** with nothing ordering them: the client
 * ships via Cloudflare Pages on push, the API ships via a Cloud Build trigger whose guard step can
 * skip it entirely (debt **D62**, still open). So the two halves can be, and once were, ten commits
 * apart.
 *
 * On 2026-07-30 a response field was added to the shared contract as **required** — a plain
 * `.nullable()`, which in Zod makes the *key* mandatory even though the value may be null. The web
 * deploy landed, the API deploy did not, and `lib/api.ts` parses every document response with that
 * schema. A server that had never heard of the key failed the parse, and the throw took out the
 * **entire archive and the Now screen** — not one field. Debt D54 and D62 both record it.
 *
 * ── Why a test rather than the rule written down ──
 *
 * The mitigation in place today is a habit: "a response field added to the client must never be
 * required of the server." It is written in CLAUDE.md, in D54's remediation column, and at length
 * beside `documentSchema.thing_id`. None of that runs. A session adding a field reads none of it,
 * writes the obvious `.nullable()`, and is correct about everything except deploy ordering.
 *
 * This file needs no database, so unlike the API suites it runs in **every** container — which is
 * exactly where a schema edit is most likely to be made and least likely to be checked.
 *
 * ── What "tolerant" means ──
 *
 * That the schema accepts the key being **absent**: `.optional()`, `.nullish()`, or `.default(x)`.
 * `.nullable()` alone is NOT tolerant — it permits a null value, which is a different claim, and
 * the difference is the whole bug. The check is `field.safeParse(undefined).success`, which is
 * precisely Zod's own rule for whether an object key may be omitted.
 *
 * Prefer `.nullish().default(null)` over bare `.nullish()` where the consumer would otherwise have
 * to branch: the default keeps the *output* type `T | null`, so only the input becomes tolerant and
 * nothing downstream learns about `undefined`. For an array field use `.default([])` — a missing
 * array is worse than a missing scalar, because a consumer's first `.map` throws rather than
 * rendering absence (debt D74).
 */

// ── Reading a Zod 4 schema from the outside ──────────────────────────────────

/**
 * The slice of Zod 4's `def` this walk reads. Declared rather than imported because Zod's internal
 * types are not part of its public surface; naming the four properties used keeps the coupling
 * visible and `any`-free. If a Zod major renames one of these, the walk finds no schemas and the
 * non-empty assertion at the bottom of this file fails — which is the point of having it.
 */
interface ZodDef {
  readonly type: string
  readonly innerType?: unknown
  readonly element?: unknown
  readonly out?: unknown
  readonly options?: readonly unknown[]
}

interface ZodNode {
  readonly def: ZodDef
  safeParse(value: unknown): { success: boolean }
}

interface ZodObjectNode extends ZodNode {
  readonly shape: Readonly<Record<string, ZodNode>>
}

function isZodNode(value: unknown): value is ZodNode {
  if (typeof value !== 'object' || value === null) return false
  const def = (value as { def?: unknown }).def
  if (typeof def !== 'object' || def === null) return false
  return typeof (def as { type?: unknown }).type === 'string'
}

function isZodObject(value: unknown): value is ZodObjectNode {
  return isZodNode(value) && value.def.type === 'object'
}

/** Wrappers that hold exactly one inner schema, so a walk can see through them. */
const SINGLE_INNER = new Set([
  'optional',
  'nullable',
  'default',
  'prefault',
  'nonoptional',
  'readonly',
  'catch',
])

/**
 * The object schemas reachable from one field, each with the accessor that reached it.
 *
 * Recursive rather than one level deep: a response's interesting fields are frequently
 * `z.array(z.object({...}))`, and an inline nested object is exactly as capable of requiring a new
 * key as a top-level one.
 */
function reachableObjects(node: unknown, depth = 0): { accessor: string; object: ZodObjectNode }[] {
  if (!isZodNode(node) || depth > 12) return []
  const { type } = node.def

  if (type === 'object') return isZodObject(node) ? [{ accessor: '', object: node }] : []
  if (type === 'array') {
    return reachableObjects(node.def.element, depth + 1).map(({ accessor, object }) => ({
      accessor: `[]${accessor}`,
      object,
    }))
  }
  if (type === 'pipe') return reachableObjects(node.def.out, depth + 1)
  if (SINGLE_INNER.has(type)) return reachableObjects(node.def.innerType, depth + 1)
  if (type === 'union') {
    return (node.def.options ?? []).flatMap((option, index) =>
      reachableObjects(option, depth + 1).map(({ accessor, object }) => ({
        accessor: `|${index}${accessor}`,
        object,
      })),
    )
  }
  // Records, enums, primitives, lazy — nothing with a fixed set of keys to check.
  return []
}

// ── Which schemas are responses ──────────────────────────────────────────────

/**
 * REQUEST schemas are exempt, and deliberately so: a create or update body **should** be strict.
 * Several are `z.strictObject` precisely so an unknown key is a 400 rather than silently dropped
 * (debt D27), and `documentUpdateSchema.version` is required on purpose so that a forgotten
 * optimistic-concurrency precondition is a type error rather than a data-loss path (ADR-0024).
 * Tolerance is a property of what the *server sends*, not of what it accepts.
 *
 * Classification is by name suffix so that a schema added later is classified without anyone
 * editing this list — the same reason `migrations.test.ts` reflects tables instead of listing them.
 */
const REQUEST_SUFFIX = /(Create|Update|Request|Query|Params)Schema$/

/**
 * The request bodies whose names predate that convention. Short, and each is a body a client sends:
 * `signUpSchema` / `signInSchema` are the auth forms, `pushSubscriptionSchema` is the browser's own
 * `PushSubscription.toJSON()` shape being posted to us.
 *
 * Everything NOT matched here or by the suffix is treated as a **response**, which is the safe
 * default: a new schema is checked unless it is explicitly declared a request. The failure mode of
 * getting this wrong is a test that asks for too much tolerance, not too little.
 */
const NAMED_REQUESTS = new Set(['signUpSchema', 'signInSchema', 'pushSubscriptionSchema'])

// ── The baseline ─────────────────────────────────────────────────────────────

/**
 * ═══════════════════════════════════════════════════════════════════════════════════════════════
 *  BASELINE — the response fields that are allowed to be required, and nothing else.
 * ═══════════════════════════════════════════════════════════════════════════════════════════════
 *
 * **What it means:** these fields were already being sent by the deployed API before any client
 * required them. A client requiring one cannot outrun the server, because the server has been
 * sending it for longer than the requirement has existed.
 *
 * **Adding a field here is a deploy-ordering decision, not a formality.** You are asserting that
 * production's API already sends this key — which means the API deploy has landed *and been
 * verified* (`node scripts/verify-deployment.mjs`, or `/api/v1/health`'s `version`) **before** the
 * client that requires it merges. Given that nothing orders the two triggers, and that the guard can
 * skip the API deploy outright (D62), the honest default is `.nullish()` and this list should almost
 * never grow. Removing from it is always safe.
 *
 * **It is a ratchet, not an audit.** Adding this test cannot retroactively make the deployed API
 * tolerant of its own existing contract; every field below is grandfathered exactly as it shipped.
 * What the ratchet buys is that the *next* field cannot be added required by accident — which is
 * the only field the outage could have come from.
 *
 * A field listed here that no longer exists in its schema is reported as stale, so the list cannot
 * quietly accumulate dead names. A field listed here that has since become *tolerant* is not
 * reported: that is a pure improvement, and failing for it would punish the fix.
 */

/** `documentSchema`'s own fields, shared with the detail response that extends it. */
const DOCUMENT_FIELDS = [
  'id',
  'space_id',
  'title',
  'doc_type',
  'issuer',
  'holder',
  'relation',
  'identifier',
  'issued_on',
  'expires_on',
  'country',
  'notes',
  'tags',
  'custom_attrs',
  'file_count',
  'created_at',
  'updated_at',
  'version',
] as const

/** `thingSchema`'s own fields, shared with the detail response that extends it. */
const THING_FIELDS = [
  'id',
  'space_id',
  'name',
  'kind',
  'brand',
  'model',
  'serial',
  'purchased_on',
  'price',
  'currency',
  'warranty_ends_on',
  'service_every_months',
  'service_due_on',
  'kept_at',
  'holder',
  'relation',
  'ownership',
  'ownership_who',
  'ownership_since',
  'notes',
  'document_count',
  'photo_count',
  'created_at',
  'updated_at',
  'version',
] as const

/** A `{ holder, relation }` suggestion pair — the same inline shape in both holders responses. */
const HOLDER_PAIR = ['holder', 'relation'] as const

const BASELINE: Readonly<Record<string, readonly string[]>> = {
  // ── Documents ──
  documentSchema: DOCUMENT_FIELDS,
  documentDetailResponseSchema: [...DOCUMENT_FIELDS, 'files', 'reminders'],
  documentListResponseSchema: ['data', 'next_cursor'],
  documentFileSchema: [
    'id',
    'document_id',
    'version',
    'mime',
    'size_bytes',
    'sha256',
    'is_primary',
    'uploaded_at',
    'created_at',
  ],
  holdersResponseSchema: ['data'],
  'holdersResponseSchema.data[]': HOLDER_PAIR,
  presignUploadResponseSchema: ['file_id', 'upload_url', 'storage_key', 'version', 'expires_at'],
  presignDownloadResponseSchema: ['download_url', 'expires_at'],

  // ── Reminders ──
  reminderSchema: [
    'id',
    'entity_type',
    'entity_id',
    'due_on',
    'lead_days',
    'channel',
    'sent_at',
    'dismissed_at',
    'created_at',
  ],
  reminderListResponseSchema: ['data'],
  pushSubscribeResponseSchema: ['id'],
  pushPublicKeyResponseSchema: ['public_key'],

  // ── Things (ADR-0029). `photos`/`services`/`documents`/`reminders` are grandfathered here
  //    rather than endorsed: debt D74 is open against exactly those four, because a missing ARRAY
  //    throws on the first `.map` where a missing scalar renders as absence. `.default([])` on each
  //    is the fix, and it needs no baseline entry once made. ──
  thingSchema: THING_FIELDS,
  thingDetailResponseSchema: [...THING_FIELDS, 'photos', 'services', 'documents', 'reminders'],
  thingListResponseSchema: ['data', 'next_cursor'],
  thingServiceSchema: [
    'id',
    'thing_id',
    'serviced_on',
    'cost',
    'currency',
    'provider',
    'notes',
    'created_at',
  ],
  thingPhotoSchema: [
    'id',
    'thing_id',
    'mime',
    'size_bytes',
    'sha256',
    'is_hero',
    'uploaded_at',
    'created_at',
  ],
  linkedDocumentSchema: ['id', 'title', 'doc_type', 'issuer', 'expires_on'],
  thingHoldersResponseSchema: ['data'],
  'thingHoldersResponseSchema.data[]': HOLDER_PAIR,
  presignPhotoUploadResponseSchema: ['photo_id', 'upload_url', 'storage_key', 'expires_at'],
  presignPhotoDownloadResponseSchema: ['download_url', 'expires_at'],

  // ── Spaces / me ──
  spaceSchema: ['id', 'name', 'kind', 'created_at'],
  spaceMembershipSchema: ['space_id', 'name', 'kind', 'role', 'joined_at'],
  meResponseSchema: ['user_id', 'email', 'spaces'],

  // ── People (ADR-0034), and the auth capability probe (ADR-0035) ──
  //
  // Both are BRAND-NEW endpoints, which is the one case where a required response field is safe
  // without the API having shipped first: a client that outruns the server gets a **404 for the whole
  // route**, not a half-populated object, so there is no partial shape for Zod to throw on. The
  // screens handle that — People renders its error state, and the sign-in screen falls back to the
  // password form, which is the entire point of ADR-0035.
  //
  // This is the same call Things made when it was new (`THING_FIELDS` above). It does NOT extend to
  // adding a field to one of these later: at that point the endpoint already exists, a lagging API
  // returns the old shape, and the field must be `.nullish()`. `document_count`, `thing_count` and
  // the two rename counters are already tolerant for exactly that reason.
  personSchema: ['id', 'space_id', 'name', 'relation', 'version', 'created_at', 'updated_at'],
  personListResponseSchema: ['data'],
  renamedResponseSchema: ['person'],
  authProvidersResponseSchema: ['google', 'password'],

  // ── Operational. `healthResponseSchema` is the one response a client MUST be able to read from
  //    any server age at all, since it is how the app detects the skew in the first place. ──
  healthResponseSchema: ['status', 'version', 'uptime_seconds', 'built_at'],
  maintenanceRunResponseSchema: [
    'status',
    'today',
    'found',
    'delivered',
    'undelivered',
    'errored',
    'swept',
    'duration_ms',
  ],

  // ── RFC 9457, whose members are the standard's, not ours ──
  problemSchema: ['type', 'title', 'status', 'detail'],
  'problemSchema.errors[]': ['path', 'message'],
}

// ── The walk ─────────────────────────────────────────────────────────────────

interface Finding {
  readonly path: string
  readonly field: string
}

interface WalkResult {
  readonly requiredFields: Map<string, Set<string>>
  readonly violations: Finding[]
}

function walkResponseSchemas(): WalkResult {
  /**
   * Export name for every schema instance, so a nested schema is always reported under its own
   * canonical name rather than under whichever response happened to reach it first. Without this,
   * `documentFileSchema` would be `documentDetailResponseSchema.files[]` and the baseline key would
   * depend on iteration order.
   */
  const canonicalNames = new Map<ZodNode, string>()
  for (const [name, value] of Object.entries(contract)) {
    if (isZodNode(value)) canonicalNames.set(value, name)
  }

  const requiredFields = new Map<string, Set<string>>()
  const violations: Finding[] = []
  const visited = new Set<ZodNode>()

  function walk(path: string, object: ZodObjectNode): void {
    if (visited.has(object)) return
    visited.add(object)

    const required = new Set<string>()
    for (const [field, fieldSchema] of Object.entries(object.shape)) {
      // Zod's own rule for "this key may be omitted from the object".
      if (!fieldSchema.safeParse(undefined).success) {
        required.add(field)
        if (!(BASELINE[path] ?? []).includes(field)) violations.push({ path, field })
      }
      for (const { accessor, object: child } of reachableObjects(fieldSchema)) {
        walk(canonicalNames.get(child) ?? `${path}.${field}${accessor}`, child)
      }
    }
    requiredFields.set(path, required)
  }

  // Widened to `unknown` first: the namespace object's inferred value union is a hundred-member
  // literal type, and a type predicate cannot narrow a tuple whose slot is typed that narrowly.
  const roots = (Object.entries(contract) as [string, unknown][])
    .filter((entry): entry is [string, ZodObjectNode] => isZodObject(entry[1]))
    .filter(([name]) => !REQUEST_SUFFIX.test(name) && !NAMED_REQUESTS.has(name))
    .sort(([a], [b]) => a.localeCompare(b))

  for (const [name, schema] of roots) walk(name, schema)

  return { requiredFields, violations }
}

const { requiredFields, violations } = walkResponseSchemas()

function explain(findings: readonly Finding[]): string {
  const lines = findings.map(({ path, field }) => `  ✗ ${path}.${field}`)
  return [
    '',
    `${findings.length} RESPONSE field(s) are required of the server:`,
    ...lines,
    '',
    'A required response field asserts that the deployed API already sends the key. The web app and',
    'the API deploy on SEPARATE triggers with nothing ordering them, and the API guard can skip its',
    'deploy entirely (debt D62) — so the client is never entitled to assume the server is the same',
    'age as it is. When it does, Zod throws on the parse and the whole screen fails to load, not one',
    'field. That is debt D54, and it is a production outage that already happened.',
    '',
    'Fix, in order of preference:',
    '  • a scalar  →  .nullish().default(null)   keeps the output type `T | null`; only input is tolerant',
    '  • an array  →  z.array(x).default([])     a missing array throws on the first .map (debt D74)',
    '  • optional information  →  .optional()',
    '',
    'If the field genuinely must be required, the API deploy has to land and be VERIFIED in',
    'production before the client requiring it merges — and only then does its name belong in',
    'BASELINE, with that ordering actually done rather than intended.',
    '',
  ].join('\n')
}

describe('response schemas tolerate an older server (debt D54)', () => {
  it('requires no response field that a lagging API could omit', () => {
    expect(violations, explain(violations)).toEqual([])
  })

  it('walked a non-trivial number of response schemas', () => {
    /**
     * Debt D33's rule, aimed at this file's own machinery. Every assertion here is of the form
     * "nothing was found", so a walk that silently reaches nothing — a Zod major renaming `def`, a
     * change to how `index.ts` re-exports — passes perfectly while checking zero fields. A floor is
     * the only thing that tells silence from success. It is not an inventory; raise it never.
     */
    expect(requiredFields.size).toBeGreaterThanOrEqual(20)

    // And the walk must actually be seeing shapes, not empty ones.
    const totalRequired = [...requiredFields.values()].reduce((sum, set) => sum + set.size, 0)
    expect(totalRequired).toBeGreaterThanOrEqual(100)
  })

  it('keeps BASELINE free of names that no longer exist', () => {
    /**
     * Two kinds of rot, both reported. A baseline key naming a schema the walk never reached means
     * the schema was renamed or reclassified as a request — and its grandfathering silently moved
     * with it. A baseline field absent from its schema is a dead name.
     *
     * A baseline field that still exists but has since become tolerant is deliberately NOT reported:
     * making a field tolerant is the improvement this file is asking for, and failing the build for
     * it would make the fix cost more than the habit.
     */
    const staleSchemas = Object.keys(BASELINE).filter((path) => !requiredFields.has(path))
    expect(staleSchemas, 'BASELINE names schemas the walk never reached').toEqual([])

    const staleFields: string[] = []
    for (const [path, fields] of Object.entries(BASELINE)) {
      const shape = requiredFields.get(path)
      if (shape === undefined) continue
      const live = shapeFieldNames(path)
      for (const field of fields) if (!live.has(field)) staleFields.push(`${path}.${field}`)
    }
    expect(staleFields, 'BASELINE names fields that no longer exist').toEqual([])
  })

  it('still tolerates absence of the field whose requirement caused the outage', () => {
    /**
     * A regression test for the specific field, not just the general rule — `documentSchema.thing_id`
     * is what took the archive down. It is here because a BASELINE-style check can only ever say
     * "nothing new is wrong"; this says "the thing that was wrong is still right".
     */
    const document = contract.documentSchema
    expect(document.shape.thing_id.safeParse(undefined).success).toBe(true)

    // And the tolerance is input-only: absence still parses to `null`, so no consumer sees
    // `undefined` and nothing has to branch on two spellings of "not linked".
    const parsed = document.shape.thing_id.parse(undefined)
    expect(parsed).toBeNull()

    // Tolerance is not laxity — a bad value is still rejected. Without this the test would pass
    // against a field changed to `z.unknown()`, which tolerates absence and everything else too.
    expect(document.shape.thing_id.safeParse('not-a-uuid').success).toBe(false)
  })
})

/**
 * The live field names of the object at `path`, for the stale check. Recomputed rather than cached
 * during the walk because the walk only records *required* fields, and a field that became tolerant
 * must still count as existing.
 */
function shapeFieldNames(path: string): Set<string> {
  const direct = (contract as Record<string, unknown>)[path]
  if (isZodObject(direct)) return new Set(Object.keys(direct.shape))

  // A nested path such as `problemSchema.errors[]`: re-resolve it from its root.
  const [rootName, ...rest] = path.split('.')
  const root = (contract as Record<string, unknown>)[rootName ?? '']
  let current: ZodObjectNode | undefined = isZodObject(root) ? root : undefined
  for (const segment of rest) {
    if (current === undefined) return new Set()
    const field: string = segment.replace(/(\[\]|\|\d+)+$/, '')
    const next: ZodNode | undefined = current.shape[field]
    current = next === undefined ? undefined : reachableObjects(next)[0]?.object
  }
  return current === undefined ? new Set() : new Set(Object.keys(current.shape))
}
