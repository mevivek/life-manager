# ADR-0015: Documentation structured for cheap AI-session orientation

- **Status:** accepted
- **Date:** 2026-07-26

## Context

Almost every change to this codebase will be made by an AI session that has never seen it
before and will not remember it afterwards. Every session begins by rebuilding context from
nothing, under a limited context budget.

That produces a specific and unusual failure mode. A session that cannot cheaply find the
conventions will infer them from whatever code it happens to read — and a partial read
produces a confident, wrong inference. It writes a repository function that omits the space
filter, or introduces `owner_id` alongside `space_id`, or re-proposes Next.js. None of these
look like mistakes in the diff. They look like reasonable code written by someone missing
one fact.

So documentation here is not a courtesy for humans. It is the mechanism by which
architectural invariants survive contact with sessions that never read the reasoning behind
them.

## Decision

**Documentation is structured as a routing system, not a reference manual.** Four
components:

### 1. `CLAUDE.md` — a router, not a summary

Loaded automatically into every session. Contains status, the stack table, the
non-negotiable invariants, and — most importantly — **a task-to-document routing table**:
"working on X? read Y." It is kept deliberately short. A long entry point is skimmed, and
skimming is how invariants get missed.

### 2. ADRs — decisions with their rejected alternatives

One numbered, immutable file per decision in [`decisions/`](.). The **Alternatives
considered** section is the load-bearing part: it is what stops a session from
re-proposing an option that was already rejected for a reason that still holds. An ADR that
records only what was chosen invites the same debate every few sessions.

ADRs are **superseded, never edited in place** — the history of why is as useful as the
current state. [`decisions/index.md`](index.md) gives one line per ADR so a session can
find the right one without opening sixteen.

### 3. Domain docs with a fixed shape

One file per life domain, all following [`domains/_template.md`](../domains/_template.md)
section for section. Fixed structure means a session knows *where in the file* the entity
model, business rules, and API surface are, without reading the whole thing. Each domain
doc ends with a **Files** section mapping the domain to its code paths, so a session can
jump to the six files it needs instead of searching.

Domains are written to be readable in isolation. Working on Documents should not require
reading about Money.

### 4. Agent playbooks — recipes, not principles

[`agent-playbooks/`](../agent-playbooks/) contains step-by-step procedures for the recurring
structural tasks: adding a domain, adding an endpoint, changing the schema. Each lists the
files to create, in order, with the checks that must pass.

This is the piece that most obviously differs from ordinary project documentation. Its
premise: **inferring a convention from existing code is expensive and unreliable, while
following an explicit recipe is cheap and consistent.** Conventions documents say what good
looks like; playbooks say what to type.

### Maintenance rules

- A change that alters an invariant updates the relevant doc **in the same commit.** Docs
  that lag the code are worse than no docs, because they are trusted.
- A new architectural decision gets an ADR — not a commit message, not a chat reply.
  Neither is visible to the next session.
- Product direction is maintained separately in [`product/`](../product/), which has its own
  method — see [ADR-0017](0017-product-brain.md).

## Alternatives considered

- **A single large `ARCHITECTURE.md`.** Simple, one place to look. Rejected: a session must
  load all of it to find any of it, which is the exact cost this structure exists to avoid,
  and it grows into something nobody reads.
- **Docstrings and comments as the primary documentation.** Keeps documentation adjacent to
  code, so it drifts less. Rejected because it cannot carry *rejected alternatives* or
  cross-cutting invariants — and finding it requires already knowing which file to open,
  which is the problem.
- **A generated documentation site.** Nicer for humans, adds a build step, and adds nothing
  for an AI session reading files directly.
- **Conventions documents without playbooks.** The conventional approach. Rejected on the
  premise in §4 — knowing the principle is not the same as knowing the sequence, and the
  gap between them is where inconsistency enters.
- **Minimal documentation, letting the code speak.** Viable with a stable human team that
  holds context between sessions. Precisely wrong here: there is no continuity of memory to
  rely on.

## Consequences

**Good:** A session can orient from `CLAUDE.md` plus one domain doc — roughly two files
instead of a codebase scan. Invariants are stated where they will be found rather than
inferred. Rejected options stay rejected. New domains are mechanical rather than
improvisational.

**Bad:** Real maintenance cost — every architectural change now touches documentation too,
and the temptation to skip it will be constant. Documentation can drift and be trusted
anyway, which is worse than absence. Some duplication between conventions, playbooks, and
domain docs is unavoidable, and duplicated text drifts independently. A meaningful volume
of docs exists before a single line of code, which will feel like over-investment right up
until the third session gets it right without being told.

**Test of whether this works:** at M1, a session should be able to implement the Documents
domain having read only `CLAUDE.md`, `docs/README.md`, `docs/domains/documents.md`, and the
relevant playbook. If it needs more, the structure has failed and should be fixed —
[roadmap.md](../roadmap.md) treats that as a real deliverable.

**Revisit if:** documentation is repeatedly found to be stale. That signals the maintenance
cost exceeds the benefit, and the fix is *fewer, better* documents — not more.
