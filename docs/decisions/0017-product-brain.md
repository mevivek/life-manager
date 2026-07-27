# ADR-0017: A product brain — product direction as a living, AI-driven, human-approved doc

- **Status:** accepted
- **Date:** 2026-07-27

## Context

Everything else in `docs/` answers *how to build correctly*. Nothing answers **what to
build, and why it is worth building** — and for this project that gap is worse than usual.

The scope is enormous: documents, physical assets, money, people, notes, and a secrets
vault. Six domains, each of which is a viable product on its own
([prior-art.md](../prior-art.md)). A solo maintainer working through AI sessions can build
almost anything, but has severely limited capacity to decide what is *worth* building. The
binding constraint on this project is product judgment, not implementation throughput.

Left unmanaged, this produces a predictable failure. Each session picks up whatever seems
next, builds it competently, and moves on. Feature ideas raised in chat evaporate — chat is
not visible to the next session ([ADR-0015](0015-docs-as-orientation.md)). Six months in
there is a lot of working code and no coherent product, and nobody can reconstruct why any
of it exists.

The roadmap ([roadmap.md](../roadmap.md)) records *decided* sequence. It is deliberately not
the place for half-formed ideas, rejected features, or open product questions — mixing them
would make it unusable as a plan.

## Decision

**A dedicated product function, documented in [`docs/product/`](../product/), operated by
the AI session and owned by the human.**

Three files with distinct jobs:

| File | Role | Changes |
|---|---|---|
| [`brain.md`](../product/brain.md) | Vision, product principles, the decision funnel, and the method for running a session with the human | Rarely |
| [`idea-backlog.md`](../product/idea-backlog.md) | Every idea ever raised, with status — including rejected ones and why | Often |
| [`open-questions.md`](../product/open-questions.md) | Questions genuinely needing a human answer, and answers once given | Often |

**The operating rules, which are the actual decision here:**

1. **The AI proposes; the human decides.** A session may generate, research, analyze, and
   recommend. It may not promote an idea to the roadmap on its own. Product scope is the
   human's call, and this is the one place where an agent's default bias toward being
   helpful by building more is actively harmful.
2. **Ideas are captured, never lost.** Anything raised — by the human, by a session, by
   research — is written to the backlog with a status, including rejected ideas and the
   reason. This is the same principle as an ADR's "alternatives considered": without the
   reason recorded, the same idea returns every few sessions.
3. **A funnel with explicit gates.** `raw → shaped → ready → roadmap → built`, with a stated
   condition for each transition (defined in `brain.md`). Nothing skips the human at the
   `ready → roadmap` gate.
4. **Questions accumulate rather than blocking.** A session that hits a product question it
   cannot answer writes it to `open-questions.md` and continues with the rest of the work,
   rather than stalling or inventing an answer.
5. **Product decisions of architectural consequence still get an ADR.** The brain is for
   deciding *what*; ADRs remain the record for *how*. A product decision that constrains
   the architecture — as [ADR-0009](0009-sensitivity-tiers.md) did — produces both.

## Alternatives considered

- **Track product direction in the roadmap alone.** No new files, one place to look.
  Rejected because it conflates two different things: a roadmap is a commitment, a backlog
  is an option set. Filling the roadmap with speculative ideas destroys its value as a plan,
  and the pressure is always to promote rather than discard.
- **Use GitHub Issues.** The conventional answer, with good tooling. Rejected on the same
  logic as [ADR-0015](0015-docs-as-orientation.md): issues are not in the repository, so a
  session does not see them while reading files. It would put the product context outside
  the only place sessions reliably look. (Issues remain fine for tracking *execution* of
  work already on the roadmap.)
- **A single `product.md`.** Simpler. Rejected because the three files change at completely
  different rates — vision is near-static, the backlog churns every session — and mixing
  them means re-reading stable content constantly.
- **Let the AI promote ideas to the roadmap autonomously.** Faster, less human involvement.
  Rejected as the most dangerous option available: an agent optimizing for visible progress
  will build features, and the scarce resource here is *judgment about what not to build*.
  A six-domain scope with a solo maintainer fails by dilution, not by slowness.
- **No product documentation at all — decide feature by feature in conversation.** The
  status quo for most personal projects. Rejected because conversation is invisible to the
  next session, which is the founding constraint of this entire documentation system.

## Consequences

**Good:** Product thinking becomes a durable artifact instead of evaporating with each chat.
A session can meaningfully contribute to *what to build* rather than only *how*, because the
context to do so is on disk. Rejected ideas stay rejected with reasons. The roadmap stays
clean. The human keeps scope control at an explicit gate rather than by vigilance.

**Bad:** Real maintenance cost — another set of documents that can go stale, and a stale
backlog is actively misleading. There is a genuine risk of the backlog becoming a graveyard
that nobody prunes; `brain.md` therefore mandates a review pass at each milestone. It also
adds ceremony to what could be a two-message conversation, which will feel like overhead on
small ideas.

**Failure mode to watch:** a session that writes elaborate product analysis instead of
shipping. The brain exists to *serve* delivery, not substitute for it. If the backlog is
growing faster than the roadmap is being completed, that is the signal.

**Revisit if:** the funnel is being routinely bypassed — that means the gates are wrong or
too heavy, and the honest fix is fewer stages, not more enforcement.
