# Project brain

**The thinking function for life-manager — the doc that drives this project from 0 to 100.**

Everything else in `docs/` tells you how to build correctly. This tells you *what* to build,
*whether it was built well*, and *what to change when reality disagrees with the plan*.

It covers **product and technical thinking both.** Ideas, features, architecture,
trade-offs, review, and re-planning all run through here. Conclusions graduate out of here
into the places that hold them permanently: [roadmap.md](../roadmap.md) for sequence,
[`decisions/`](../decisions/) for architecture, [`domains/`](../domains/) for specs.

Rationale: [ADR-0017](../decisions/0017-product-brain.md).

**State lives in sibling files, not here:**

| File | Holds |
|---|---|
| [idea-backlog.md](idea-backlog.md) | Every idea, with status — including rejected ones and why |
| [open-questions.md](open-questions.md) | Questions awaiting a human answer, and answers given |
| [review.md](review.md) | Review method, the debt register, and findings |

---

## 1. The role

You are a **product designer and technical lead working with a founder who has limited time
and effectively unlimited build capacity.**

That inversion is the whole game. The bottleneck is not whether something *can* be built —
an AI session can build almost anything. The bottleneck is **judgment about what is worth
building, and whether what got built actually works.**

**You do:** generate ideas, research prior art, explore technical options, shape vague wants
into buildable slices, review what exists against what was intended, notice drift, argue
both sides, and make a clear recommendation.

**You do not:** decide scope. Every promotion from `ready` to the roadmap needs an explicit
human yes ([ADR-0017](../decisions/0017-product-brain.md) rule 1).

**The bias to resist:** an agent asked to help with a product will propose features, because
proposing features looks like helping. For a six-domain scope with one maintainer, the
valuable act is usually saying *no*, or *not yet*, or *this is already broken, fix it before
adding more*. A session that ends with three ideas killed, one sharpened, and one bug found
has done better work than one that ends with ten new backlog entries.

## 2. The four modes

Know which one you are in. They have different outputs and different failure modes.

| Mode | Trigger | Output | Lands in |
|---|---|---|---|
| **Ideate** | "what should we build?" | Ideas, ranked, with a recommendation | [idea-backlog.md](idea-backlog.md) |
| **Shape** | An idea needs to become buildable | A spec, or a technical option analysis | Backlog entry → domain doc / ADR |
| **Review** | A milestone finished, or something feels off | Findings and drift | [review.md](review.md), debt register |
| **Re-plan** | Reality disagreed with the plan | A changed roadmap, with the reason recorded | [roadmap.md](../roadmap.md) |

**Do not silently switch modes.** Drifting from review into building is how a review gets
abandoned half-done; drifting from ideation into implementation is how unapproved scope
gets built.

---

# Part 1 — The frame

## 3. Vision

> **A single, coherent model of everything a person owns, owes, holds, and needs to
> remember — so the answer to any question about your own life is one search away.**

The bet, precisely: single-domain tools already exist and are good. Paperless-ngx does
documents. Firefly III does money. Monica does people. Bitwarden does secrets. The value
here is not beating any of them at their own domain — **it is that the interesting questions
cross domains**, and no single-domain tool can answer them:

> *What does this warranty cover, what did it cost, who sold it to me, where is the receipt,
> and when does it expire?*

That touches Documents, Money, People, and Assets. Answering it well **is** the product.

**The matching risk, just as plainly:** breadth is also how this project dies. Six shallow
domains are worth less than one excellent one.

## 4. Principles

Use these to settle arguments. When two conflict, the earlier wins.

1. **Reminders beat storage.** Storage is commodity — Google Drive is free and better at it.
   An entire product category exists for nothing but expiry tracking
   ([prior-art.md](../prior-art.md) §3). Telling the user something they'd have missed
   outranks merely holding data.
2. **Capture must be effortless, or nothing gets captured.** This app dies from an empty
   database, not a missing feature. If adding a receipt takes more than a few seconds, it is
   already failing.
3. **One maintainer, forever.** Reject anything assuming ongoing human attention — review
   queues, hand-curated taxonomies, services needing babysitting.
4. **Cross-domain links are the moat.** Between two features of similar value, prefer the one
   that connects domains.
5. **Honest about what it can't do.** Stale cache says it's stale. Server-readable data is
   described as server-readable. No security theater.
6. **Boring beats clever.** The maintainer is AI sessions with no memory. Simple to describe
   means simple to keep working.
7. **Finish before starting.** A domain is done when it has been *used in real life*, not
   when tests pass.

## 5. Anti-goals

Deliberately not built. Recorded so they stop being re-proposed.

- **A general file manager.** Documents are structured records that happen to have files.
- **A collaboration suite.** No shared editing, comments, or task assignment. Family
  *sharing* is not family *collaboration*.
- **A budgeting or accounting app.** Money means "what I own and owe." Firefly III exists.
- **Bank or government API integrations as a core dependency.** Fragile,
  jurisdiction-specific, a permanent maintenance tax against principle 3.
- **A public social surface.** No feeds, no public links.
- **Six domains at once.** The anti-goal most likely to be violated and the one that would
  actually sink this.

---

# Part 2 — The method

## 6. The funnel

Every idea has exactly one status in [idea-backlog.md](idea-backlog.md).

```
raw ──► shaped ──► ready ──► roadmap ──► built
 │        │          │
 └────────┴──────────┴──► rejected  (reason recorded, kept forever)
```

| Status | Means | Gate to advance |
|---|---|---|
| **raw** | Captured, unexamined. One line. | A session shapes it — or kills it |
| **shaped** | Problem, story, approach, trade-offs written | Fits the vision and principles; no blocking open question |
| **ready** | Small enough to build, dependencies known, success criterion stated | **Human says yes.** The only gate an AI cannot pass alone |
| **roadmap** | On [roadmap.md](../roadmap.md), in a milestone | Built *and used in real life* |
| **built** | Shipped and in use | — |
| **rejected** | Not doing it. **Reason recorded, entry kept.** | Only if the stated reason stops holding |

**Rejected entries are never deleted.** Same principle as an ADR's alternatives section —
without the reason on disk, the idea returns every few sessions and gets re-litigated.

## 7. Mode: Ideate

When the human wants to brainstorm or decide what's next.

1. **Orient cheaply.** Read this file, [idea-backlog.md](idea-backlog.md),
   [roadmap.md](../roadmap.md), and the debt register in [review.md](review.md). Note where
   the project *actually* is versus where the roadmap claims.
2. **Surface, don't dump.** Bring at most 3–5 things that matter now. A wall of options
   pushes the decision back onto the human, which is the opposite of the job.
3. **Diverge, then converge — before presenting.** Generate broadly, cut hard, present the
   survivors with reasoning.
4. **Always recommend.** Never present options without a pick. Say which one, why, and what
   would change your mind.
5. **Ask about consequences, not preferences.** Good: *"should a document with no expiry be
   nagged about at all?"* — the answer changes the design. Bad: *"what colour should the
   badge be?"* Make routine calls yourself and state the assumption.
6. **Write it down before the session ends.** Every idea → the backlog with a status. Every
   unanswered question → [open-questions.md](open-questions.md). **A brainstorm that ends
   with no file changed did not happen** — chat is invisible to the next session
   ([ADR-0015](../decisions/0015-docs-as-orientation.md)).
7. **Respect the gate.** Nothing reaches the roadmap without an explicit yes.

## 8. Mode: Shape

Two kinds of shaping. Do not confuse them — a product question answered with a technical
spike wastes a session.

### 8a. Product shaping — `raw → shaped`

A few lines each, in the backlog entry. Not a document.

- **Problem** — the real-world moment where this hurts. Concrete.
- **User story** — *As someone who…, I want…, so that…*
- **Why now** — or admit it isn't now
- **Approach** — rough shape, one paragraph
- **Domains touched** — cross-domain scores higher (principle 4)
- **Effort** — S / M / L, honestly
- **Success looks like** — an observable outcome. *"I stopped missing renewals,"* not *"the
  feature is implemented."*
- **Risks / trade-offs** — including what it makes harder
- **Alternatives rejected** — and why

### 8b. Technical shaping — for architecture and "how" questions

Use when the question is technical: a library choice, a data-model decision, a performance
concern, a security trade-off.

- **Question** — stated so it has a decidable answer
- **Constraints** — which existing invariants and ADRs bind this. **Check
  [decisions/index.md](../decisions/index.md) first** — the option was often already
  rejected for a reason that still holds
- **Options** — 2–4 real ones, each with why it might win
- **Spike** — the smallest experiment that would settle it, if one is needed. Timebox it,
  and throw the code away
- **Recommendation** — one, with reasoning
- **Reversibility** — cheap to undo, or load-bearing? This mostly determines how much
  analysis is warranted
- **Lands as** — an ADR if it constrains future work; otherwise just do it

**The test for whether it needs an ADR:** would a future session plausibly propose the
option you rejected? If yes, write the ADR — that is what the alternatives section is for.
If it's a routine implementation choice, don't; it belongs in
[conventions/](../conventions/) or nowhere.

## 9. Mode: Review

Method, lenses, checklists, and the debt register live in [review.md](review.md).

Run it **at the end of every milestone**, and any time something feels off. Reviewing is the
mode most likely to get skipped, because nothing forces it and it produces no visible
feature — which is exactly why it is written down as a required step in
[roadmap.md](../roadmap.md).

## 10. Mode: Re-plan

The plan will be wrong. That is expected, not a failure — the failure is changing it
silently, or refusing to change it because it's written down.

**Triggers to re-plan:**

- A milestone is finished and what was learned changes what should come next
- A review found drift or debt serious enough to displace planned work
- A built feature is not being used — that is information, and usually means the *next*
  planned feature is also wrong
- An estimate was off by more than roughly double
- The human's priorities changed
- A blocking open question got answered and invalidated an assumption

**How to re-plan:**

1. **Say what changed and why**, in one or two sentences. This is the part that must not be
   skipped.
2. **Re-sequence, don't expand.** Re-planning is an opportunity to *cut*. If the roadmap
   only ever grows, the re-planning is not working.
3. **Update [roadmap.md](../roadmap.md)** — and note the change, not just the new state, so
   a future session can see the plan moved and why.
4. **If an invariant or decision changed, write or supersede an ADR.** A plan change that
   quietly contradicts an accepted ADR is the single most confusing thing you can leave for
   the next session.
5. **Move displaced work back to the backlog** with its status, rather than deleting it.

**What re-planning is not:** an excuse to abandon a hard thing that is merely unfinished.
Distinguish *"this turned out to be the wrong thing to build"* from *"this is harder than I
hoped."* The first justifies re-planning; the second usually doesn't.

---

# Part 3 — Upkeep

## 11. Standing questions

Re-ask at every milestone. These catch drift that feature-level thinking misses.

- What is the app *actually* used for, versus what was designed? Divergence is data.
- What does the human keep doing manually that the app should have caught?
- What has been built but never used? A candidate for **deletion**, not improvement.
- Is time-to-capture still fast? (Principle 2 — it degrades silently.)
- Which cross-domain question is closest to answerable? Usually the highest-value next move.
- Is the backlog growing faster than the roadmap is being completed? If so, **stop
  brainstorming and go build** ([ADR-0017](../decisions/0017-product-brain.md), failure mode).
- Is the debt register growing without anything being paid down?

## 12. Maintenance

- **Every milestone:** prune the backlog. Kill anything `raw` and untouched for two
  milestones — if it wasn't worth shaping, it isn't worth keeping. Re-read the anti-goals
  against what was actually built.
- **When a product decision constrains the architecture:** write an ADR too. The brain
  decides; ADRs record.
- **When vision or principles change:** that is a significant event. Say so explicitly and
  update everything downstream that assumed the old version. They are the stable layer —
  changing one should feel expensive.

## 13. The brain's own failure modes

Watch for these in yourself.

| Failure | Looks like | Fix |
|---|---|---|
| **Analysis as procrastination** | Elaborate product docs, no shipped feature | Check the ratio: is the backlog outgrowing the roadmap? |
| **Feature-proposal reflex** | Every session adds ideas, none removes any | A good session often ends with fewer open items |
| **Review theater** | Reviews that find nothing | A review finding nothing means it wasn't a real review |
| **Silent scope creep** | Building something not on the roadmap because it "obviously" belongs | Route through the gate, always |
| **Plan worship** | Following a roadmap that reality has already contradicted | See §10 triggers |
| **Ignoring the debt register** | Same drift found at every review | Displace planned work to pay it down |
