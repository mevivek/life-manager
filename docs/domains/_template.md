# Domain: <Name>

> **Template.** Copy to `<domain>.md` and fill in every section, in this order. The fixed
> order is the point — a session must be able to jump to §4 for business rules without
> reading §1–3. Do not add, remove, or reorder sections. If a section genuinely doesn't
> apply, write "None" rather than deleting it.
>
> Recipe for building a new domain:
> [agent-playbooks/add-a-domain.md](../agent-playbooks/add-a-domain.md).
> Why domain docs look like this: [ADR-0015](../decisions/0015-docs-as-orientation.md).

- **Status:** planned | in progress | built
- **Milestone:** see [roadmap.md](../roadmap.md)
- **Sensitivity tier:** 0 | 1 | 2 — see [security-model.md](../security-model.md) §4
- **Depends on:** other domains, or "none"

## 1. Purpose

Two or three sentences. What real-world need this domain serves and what question it lets
the user answer. Not a feature list.

## 2. Scope

**In scope:** what this domain owns.

**Out of scope:** what it deliberately does not own, and which domain owns it instead.
This section prevents domains from growing into each other.

## 3. Entity model

One subsection per table. For each: purpose, then the columns.

Every table carries the universal columns from
[conventions/data.md](../conventions/data.md) §1 — `id`, `space_id`, `created_by`,
`created_at`, `updated_at`, and `deleted_at` where deletable. **List them only where
something is unusual**; assume them otherwise.

Show relationships as a small diagram when there is more than one table.

## 4. Business rules

Numbered, testable statements. Each one should map to a test
([conventions/testing.md](../conventions/testing.md)).

Good: *"A document may have at most one primary file."*
Bad: *"Files are handled properly."*

Cover: validation beyond types, state transitions, cascade behavior, and anything a
reasonable implementer would get wrong without being told.

## 5. API surface

Endpoints in the format of [conventions/api.md](../conventions/api.md), with the
non-obvious query parameters and status codes. Do not restate the universal rules
(pagination, `problem+json`, idempotency) — link to them.

## 6. Background jobs

Jobs this domain registers with pg-boss
([ADR-0012](../decisions/0012-pg-boss-background-jobs.md)): name, trigger, what it does,
and failure behavior. "None" if there are none.

## 7. UI surface

The screens the web client needs, one line each. Enough to know what exists, not a design
spec.

## 8. Cross-domain links

Relationships to other domains — existing or anticipated. Per
[product/brain.md](../product/brain.md) principle 4, these are where the product's value
concentrates, so record intent even before the other domain exists.

## 9. Open questions

Decisions deliberately deferred, with the current leaning and what would settle it.
Product-level questions go to
[product/open-questions.md](../product/open-questions.md) instead; keep this section for
domain-internal technical ones.

## 10. Files

**Keep this current.** It is what lets a session jump straight to the code instead of
searching. Paths may be listed before they exist — mark them `(planned)`.

```
apps/api/src/domains/<domain>/
  <domain>.routes.ts
  <domain>.service.ts
  <domain>.repository.ts
  <domain>.schema.ts
  <domain>.test.ts
packages/shared/src/<domain>.ts
apps/web/src/features/<domain>/
```
