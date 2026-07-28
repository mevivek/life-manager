# Testing conventions

What to test, at which layer, and what not to bother with. Tooling rationale is in
[ADR-0016](../decisions/0016-testing-and-tooling.md).

The guiding principle for an AI-maintained codebase: **tests are the only thing that stops
a future session from silently breaking an invariant it never read about.** Write them for
the invariants first and the happy paths second.

---

## 1. The layers

| Layer | Tool | Runs against | Speed |
|---|---|---|---|
| Unit | Vitest | Pure functions, no I/O | ms |
| API integration | Vitest | **A real Postgres**, HTTP via `app.inject()` | ~seconds |
| Web component | Vitest + Testing Library + MSW | Mocked API | ms |
| E2E | Playwright | The full stack | ~minutes |

**API integration tests run against real Postgres, not a mock.** Most of what can go wrong
here — the space filter, soft deletes, cascades, `tsvector` search, JSONB validation — is
database behavior. A mocked database tests the mock. Use a Neon branch or a Testcontainers
Postgres; either is fine, both are cheap
([ADR-0011](../decisions/0011-pre-v1-schema-resets.md)).

## 2. The isolation test — mandatory

**Every endpoint that reads or writes domain data gets a test proving it cannot be reached
from another space.** Not a suggestion. This is the invariant most likely to be broken by a
session that didn't read [security-model.md](../security-model.md).

```ts
it('returns 404 for a document in another space', async () => {
  const { actor: alice } = await seedUserWithSpace()
  const { actor: bob }   = await seedUserWithSpace()
  const doc = await createDocument(bob, { title: 'Bob passport' })

  const res = await app.inject({
    method: 'GET',
    url: `/api/v1/documents/${doc.id}`,
    ...authAs(alice),
  })

  expect(res.statusCode).toBe(404)   // 404, never 403 — see conventions/api.md §3
})
```

Two users in two spaces is the default fixture shape. Not one user — a single-user fixture
cannot catch a missing space filter, which is exactly the bug that matters.

## 3. What to test

**Always:**

- Cross-space access returns 404 (§2)
- Authorization: unauthenticated → 401; wrong role in a shared space → 403
- Business rules stated in the domain doc
- Validation boundaries: the value just outside what Zod accepts
- Soft delete: deleted records disappear from lists and reads
- Anything that has broken before — a regression test is the cheapest doc there is
- **All crypto, when the vault is built** — key derivation, wrap/unwrap round-trips,
  recovery-code unlock, and the negative cases (wrong passphrase fails cleanly)

**Don't bother:**

- Framework behavior (Fastify routing, Drizzle's SQL generation)
- Third-party libraries
- Getters, trivial mappers, pure re-exports
- Snapshot tests of rendered markup — they break on cosmetic changes and get regenerated
  without being read, which makes them worse than nothing

## 4. Structure

Tests sit beside the code: `documents.service.test.ts` next to `documents.service.ts`.
Colocation means a session working on a domain sees its tests without going looking.

Use `describe` per unit, and name tests as behavior:

```
✅ it('returns 404 for a document in another space')
❌ it('test getDocument 2')
```

Arrange–Act–Assert, with a blank line between the three. Prefer factory helpers
(`seedUserWithSpace`, `createDocument`) over inline fixture literals — when the schema
changes, one helper changes instead of forty tests.

## 5. Rules

- **Never weaken an assertion to get a green build.** A failing test is information. If it
  is genuinely wrong, fix the test deliberately and say so in the commit message. Deleting
  or loosening a test to unblock a change is the single most damaging thing a session can
  do here.
- **Every fix gets a regression test** that fails before the fix and passes after. Confirm
  it actually fails first — a test that passes against the bug is worthless.
- **No shared mutable state between tests.** Each test seeds what it needs and cleans up.
  Tests must pass in any order and in parallel.
- **No network calls.** MSW on the web, real local Postgres for the API, nothing outbound.
- **No real secrets in fixtures.** Obvious fakes only, never a copied production value.
- Tests are code: same lint rules, same review standard.

## 6. E2E scope

Playwright covers the few flows where an integration test genuinely can't reach:

- Sign up → personal space auto-created → land on the document list
- Create a document → upload a file via presigned URL → see it in the list
- Install as a PWA and load offline (M2)

Keep the set small. E2E is the slowest and flakiest layer; use it for proof that the pieces
connect, not for coverage.

## 7. CI

GitHub Actions on every push and PR: `typecheck` → `lint` → `test` → `build`, plus
integration tests against an ephemeral Postgres. **A red build does not get merged.**

### Local green is not CI green — check the runs

**`pnpm typecheck lint test build` passing on a laptop says nothing about CI.** This is not a
hypothetical: for the whole of M0, every run failed and nobody noticed, because the checks were
only ever run locally. The jobs died in seconds with **no runner assigned, no steps, and no logs**
— an account-level GitHub Actions block, which looks nothing like a test failure and produces no
output to read.

So after pushing, confirm the run actually executed:

```bash
gh run list --branch <branch> --limit 3
gh api repos/mevivek/life-manager/actions/runs/<id>/jobs \
  --jq '.jobs[] | "\(.name) \(.conclusion) steps=\(.steps|length) runner=\(.runner_name)"'
```

**`steps=0` with an empty runner means the job never started.** Do not go hunting for a broken
test — nothing ran. Check billing and account-level Actions settings instead.

The reason this matters beyond tidiness: the deploy job is gated on `needs: verify`
([ADR-0021](../decisions/0021-cloud-run-for-the-api.md)), so a CI that cannot run is also a
deploy that cannot run. The gate behaved correctly and refused to ship — but silently.

No coverage threshold. A percentage target produces tests written to hit the number rather
than to catch bugs — the isolation test in §2 is worth more than 20 points of coverage.
