# Documentation

Start here, then read only what your task needs. These docs are structured as a **routing
system**, not a manual — the goal is that a session orients from two or three files rather
than scanning the codebase ([ADR-0015](decisions/0015-docs-as-orientation.md)).

## Read budget

**There is more here than any one session should read. That is intentional — but it only
works if you route instead of reading everything.**

- **Baseline: 3 files.** [`CLAUDE.md`](../CLAUDE.md) → this routing table → the one domain
  doc or playbook your task names. That should be enough to start work.
- **Add a fourth** only when the table below tells you to — `security-model.md` for anything
  touching auth, ownership, or crypto; a specific ADR when you're about to contradict a
  decision.
- **Don't read `decisions/` front to back.** Use [its index](decisions/index.md) to find the
  one ADR you need.

If you find yourself needing five or more files to make a routine change, **the structure
has failed — say so and fix the routing**, rather than compensating by reading more. Docs
that must be read exhaustively are no better than no docs
([ADR-0015](decisions/0015-docs-as-orientation.md), consequences).

---

## Doing X? Read Y.

| Your task | Read, in this order |
|---|---|
| **Just arrived, no specific task** | [`CLAUDE.md`](../CLAUDE.md) → this file → [architecture.md](architecture.md) |
| **Working on the Documents domain** | [domains/documents.md](domains/documents.md) → [conventions/api.md](conventions/api.md) → the relevant playbook |
| **Adding an endpoint** | [agent-playbooks/add-an-endpoint.md](agent-playbooks/add-an-endpoint.md) → the domain doc |
| **Adding a whole new domain** | [agent-playbooks/add-a-domain.md](agent-playbooks/add-a-domain.md) → [domains/_template.md](domains/_template.md) |
| **Changing the database schema** | [agent-playbooks/change-the-schema.md](agent-playbooks/change-the-schema.md) → [conventions/data.md](conventions/data.md) |
| **Anything touching auth, ownership, or crypto** | [security-model.md](security-model.md) **in full** → [ADR-0006](decisions/0006-space-based-ownership.md) → [ADR-0009](decisions/0009-sensitivity-tiers.md) |
| **Building the vault** | [security-model.md](security-model.md) §5 → [ADR-0010](decisions/0010-vault-key-hierarchy.md) |
| **File upload or download** | [ADR-0008](decisions/0008-object-storage-r2.md) → [architecture.md](architecture.md) §6 |
| **Writing tests** | [conventions/testing.md](conventions/testing.md) |
| **Deciding what to build next** | [product/brain.md](product/brain.md) → [product/idea-backlog.md](product/idea-backlog.md) → [roadmap.md](roadmap.md) |
| **Brainstorming features with the human** | [product/brain.md](product/brain.md) §7 |
| **Shaping a technical question / architecture call** | [product/brain.md](product/brain.md) §8b → [decisions/index.md](decisions/index.md) |
| **Reviewing a finished milestone** | [product/review.md](product/review.md) |
| **Changing the plan** | [product/brain.md](product/brain.md) §10 |
| **Wondering why something is the way it is** | [decisions/index.md](decisions/index.md) |
| **Tempted to change the stack** | [decisions/index.md](decisions/index.md) — the alternative was probably already rejected |
| **Deploying or debugging hosting** | [ADR-0014](decisions/0014-hosting-topology.md) |

---

## The documents

### Orientation

- [**architecture.md**](architecture.md) — system shape, layering, request lifecycle, file
  handling, deployment. What the system *is*.
- [**security-model.md**](security-model.md) — trust boundaries, the actor context,
  sensitivity tiers, the vault key hierarchy. **Read in full before touching auth,
  ownership, or crypto.**
- [**glossary.md**](glossary.md) — precise meanings of *space*, *actor*, *tier*, *wrap*,
  and the rest. Use these words exactly.
- [**prior-art.md**](prior-art.md) — comparable products, what to borrow, what we reject
  and why.
- [**roadmap.md**](roadmap.md) — sequenced milestones. Where the project is going.

### Conventions — how to write code here

- [**conventions/code.md**](conventions/code.md) — layering, naming, errors, logging, the
  actor rule
- [**conventions/api.md**](conventions/api.md) — REST rules: versioning, pagination,
  `problem+json`, idempotency
- [**conventions/data.md**](conventions/data.md) — schema rules: `space_id`, timestamps,
  soft deletes, JSONB, search
- [**conventions/testing.md**](conventions/testing.md) — what to test at which layer

### Decisions

- [**decisions/index.md**](decisions/index.md) — one line per ADR, plus a by-topic view

Seventeen ADRs covering the stack, ownership, security, hosting, and process. Each records
its **rejected alternatives**, which is usually the part you need.

### Domains

- [**domains/documents.md**](domains/documents.md) — the first domain, fully specified
- [**domains/_template.md**](domains/_template.md) — the fixed shape every domain doc follows

Planned: Assets, Money, People, Notes, Vault. Each gets a doc before it gets code.

### Playbooks — step-by-step recipes

- [**agent-playbooks/add-a-domain.md**](agent-playbooks/add-a-domain.md)
- [**agent-playbooks/add-an-endpoint.md**](agent-playbooks/add-an-endpoint.md)
- [**agent-playbooks/change-the-schema.md**](agent-playbooks/change-the-schema.md)

Conventions say what good looks like; playbooks say what to type. If a playbook doesn't
cover what you hit, **fix it in the same commit.**

### Product — what to build, and whether it was built well

- [**product/brain.md**](product/brain.md) — **the project brain.** Vision, principles,
  anti-goals, and the four working modes: ideate, shape, review, re-plan. Covers product
  *and* technical thinking
- [**product/review.md**](product/review.md) — review method, the four lenses, and the
  **debt register**
- [**product/idea-backlog.md**](product/idea-backlog.md) — every idea with its status,
  including rejected ones and why
- [**product/open-questions.md**](product/open-questions.md) — questions needing a human
  answer, and answers already given

**The AI proposes; the human decides scope.** Nothing reaches the roadmap without an
explicit yes ([ADR-0017](decisions/0017-product-brain.md)).

**Conclusions graduate out of here** — into [roadmap.md](roadmap.md) for sequence,
[decisions/](decisions/index.md) for architecture, [domains/](domains/) for specs. The brain
is where thinking happens, not where it is stored.

---

## Rules for these documents

1. **A change that alters an invariant updates the doc in the same commit.** Stale docs are
   worse than none, because they are trusted.
2. **New architectural decision → an ADR.** Not a commit message, not a chat reply. Neither
   is visible to the next session.
3. **New product idea → the backlog**, with a status. Ideas raised only in conversation are
   lost.
4. **Domain docs follow the template exactly** — same sections, same order.
5. **Use the glossary's words.** Say *space*, not tenant or org.
