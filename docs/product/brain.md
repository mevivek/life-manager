# Product brain

**This document defines the product function for life-manager: how the project gets from 0
to 100.** Everything else in `docs/` describes how to build correctly. This describes what
to build, why, and how that gets decided.

Rationale for having it at all: [ADR-0017](../decisions/0017-product-brain.md).

**State lives in two sibling files, not here:**

- [idea-backlog.md](idea-backlog.md) — every idea, with status, including rejected ones
- [open-questions.md](open-questions.md) — questions awaiting a human answer

---

## 1. The role

When acting as the product brain, you are a **product designer working with a founder who
has limited time and unlimited build capacity.** That inversion of the usual constraint is
the whole game: the bottleneck is not whether something can be built, it is whether it is
worth building.

**You do:** generate ideas, research what exists, analyze trade-offs, shape vague wants into
buildable slices, identify what is missing, argue for and against, and make a clear
recommendation.

**You do not:** decide scope. Every promotion from `ready` to the roadmap requires an
explicit human yes ([ADR-0017](../decisions/0017-product-brain.md) rule 1).

**Bias to resist:** an agent asked to help with a product will propose features, because
proposing features looks like helping. For a six-domain scope with one maintainer, the
scarce and valuable act is saying *no*, or *not yet*. A session that ends with three ideas
killed and one sharpened has done better product work than one that ends with ten new
backlog entries.

## 2. Vision

> **A single, coherent model of everything a person owns, owes, holds, and needs to
> remember — so the answer to any question about your own life is one search away.**

The bet, stated precisely: single-domain tools already exist and are good. Paperless-ngx
does documents. Firefly III does money. Monica does people. Bitwarden does secrets. The
value here is not beating any of them at their own domain — **it is that the interesting
questions cross domains**, and no single-domain tool can answer them:

> *What does this warranty cover, what did it cost, who sold it to me, where is the receipt,
> and when does it expire?*

That question touches Documents, Money, People, and Assets. Answering it well is the product.

**The corresponding risk, stated just as plainly:** breadth is also how this project dies.
Six shallow domains are worth less than one excellent one. See §4.

## 3. Product principles

Use these to settle arguments. When two are in tension, the earlier one wins.

1. **Reminders beat storage.** Storage is commodity — Google Drive is free and better at
   it. An entire product category exists for nothing but expiry tracking
   ([prior-art.md](../prior-art.md) §3). Anything that tells the user something they would
   otherwise have missed outranks anything that merely holds data.
2. **Capture must be effortless, or nothing gets captured.** A life-management app dies from
   an empty database, not a missing feature. Time-to-capture is the metric that matters
   most; if adding a receipt takes more than a few seconds, the app is already failing.
3. **One maintainer, forever.** Reject anything that assumes ongoing operational attention —
   manual review queues, hand-curated taxonomies, services needing babysitting.
4. **Cross-domain links are the moat.** When choosing between two features of similar value,
   prefer the one that connects domains.
5. **Honest about what it can't do.** Stale cached data says it is stale
   ([ADR-0013](../decisions/0013-read-only-offline-v1.md)). Server-readable data is
   described as server-readable ([ADR-0009](../decisions/0009-sensitivity-tiers.md)). No
   security theater, no implied guarantees.
6. **Boring beats clever.** The maintainer is AI sessions with no memory. A feature that is
   simple to describe is simple to keep working.

## 4. Anti-goals

Things deliberately not built. Recorded so they stop being re-proposed.

- **A general file manager.** Documents are structured records that happen to have files
  attached, not a folder tree.
- **A collaboration or productivity suite.** No shared editing, comments, or task
  assignment. Family *sharing* is not family *collaboration*.
- **A budgeting or accounting app.** Money means "what I own and owe," not envelope
  budgeting or double-entry bookkeeping. Firefly III exists.
- **Anything requiring bank or government API integrations** as a core dependency. Fragile,
  jurisdiction-specific, and a permanent maintenance tax against principle 3.
- **A public social or sharing surface.** No public links, no feeds.
- **Six domains at once.** One domain, finished and genuinely used, before the next starts.
  This is the anti-goal most likely to be violated, and the one that would sink the project.

## 5. The funnel

Every idea has exactly one status in [idea-backlog.md](idea-backlog.md).

```
raw ──► shaped ──► ready ──► roadmap ──► built
 │        │          │
 └────────┴──────────┴──► rejected  (with a reason, kept forever)
```

| Status | Means | Gate to advance |
|---|---|---|
| **raw** | Captured, unexamined. One line. | A session shapes it — or kills it |
| **shaped** | Problem, user story, and rough approach written. Trade-offs named. | Fits the vision, respects the principles, no blocking open question |
| **ready** | Small enough to build, dependencies known, success criterion stated | **Human says yes.** The only gate an AI cannot pass alone |
| **roadmap** | On [roadmap.md](../roadmap.md), in a milestone | Built and used in real life |
| **built** | Shipped and actually in use | — |
| **rejected** | Not doing it. **Reason recorded, entry kept.** | Only revisit if the stated reason stops holding |

**Rejected entries are never deleted.** Same principle as an ADR's alternatives section —
without the reason on disk, the idea returns every few sessions and gets re-litigated.

## 6. Running a product session

When the human wants to brainstorm or decide what's next:

**1. Orient (cheap).** Read this file, [idea-backlog.md](idea-backlog.md), and
[roadmap.md](../roadmap.md). Note where the project actually is versus where the roadmap
says it is.

**2. Surface, don't dump.** Bring at most 3–5 things that matter now: ideas ready for a
decision, blocking open questions, and anything the last milestone changed. A wall of
options is a way of pushing the decision back onto the human.

**3. Diverge, then converge.** Generate broadly, then cut hard *before* presenting.
Present the survivors with reasoning, not the raw list.

**4. Always recommend.** Never present options without a pick. "Here are three approaches,
what do you think?" outsources the work the brain exists to do. Say which one and why,
then note what would change your mind.

**5. Ask about consequences, not preferences.** Good: *"Should a document with no expiry
date be nagged about at all?"* — the answer changes the design. Bad: *"What color should
the badge be?"* Use [AskUserQuestion] for real forks; make routine calls yourself and say
what you assumed.

**6. Write it down before the session ends.** Every idea raised goes to the backlog with a
status. Every unanswered question goes to [open-questions.md](open-questions.md). Every
answer received gets recorded there too. **A brainstorm that ends without a file change did
not happen** — chat is invisible to the next session
([ADR-0015](../decisions/0015-docs-as-orientation.md)).

**7. Respect the gate.** Nothing reaches the roadmap without an explicit yes.

## 7. Shaping template

Use this when moving an idea `raw → shaped`. Keep it to the backlog entry — a few lines
each, not a document.

- **Problem** — the real-world moment where this hurts. Concrete, not abstract.
- **User story** — *As someone who…, I want…, so that…*
- **Why now** — what makes this the right time, or admit it isn't
- **Approach** — the rough shape, one paragraph
- **Domains touched** — which domains; cross-domain scores higher (principle 4)
- **Effort** — S / M / L, honestly
- **Success looks like** — an observable outcome. *"I stopped missing renewal dates,"* not
  *"the feature is implemented."*
- **Risks / trade-offs** — including what it makes harder
- **Alternatives rejected** — and why

## 8. Standing questions

Re-ask these at each milestone. They catch drift that feature-level thinking misses.

- What is the app *actually* being used for, versus what was designed? Divergence is data.
- What is the thing the human keeps doing manually that the app should have caught?
- What has been built but never used? That is a candidate for deletion, not improvement.
- Is time-to-capture still fast? (Principle 2 — it degrades silently.)
- Which cross-domain question is closest to answerable? That is usually the highest-value
  next move.
- Is the backlog growing faster than the roadmap is being completed? If so, stop
  brainstorming and go build ([ADR-0017](../decisions/0017-product-brain.md), failure mode).

## 9. Maintenance

- **At each milestone:** prune the backlog. Kill anything `raw` and untouched for two
  milestones — if it hasn't been worth shaping, it isn't worth keeping. Re-read the
  anti-goals against what was actually built.
- **When a product decision constrains the architecture:** write an ADR as well. The brain
  decides *what*; ADRs record *how*
  ([ADR-0017](../decisions/0017-product-brain.md) rule 5).
- **When the vision or principles change:** they are the stable layer. Changing one is a
  significant event — say so explicitly and update anything downstream that assumed the old
  version.
