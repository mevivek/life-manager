# Review method

**How to run a review: the four lenses, the procedure, how findings become work, and the ways a
review goes wrong.**

One of the four brain modes ([brain.md](brain.md) §2 and §9). This half is **stable** — it changes
when the method changes, which is rarely. The findings it produces live in
[review.md](review.md): the **debt register** and the log of what each review actually checked.

They were one file until 2026-07-30, when it reached 65 KB and became the largest doc in the repo —
a churning register wrapped around a method nobody needed to re-read. Splitting them is what lets a
session open the register without paying for the method, and vice versa.

**Section numbers are kept exactly as they were** (§1, §2, §4, §5 here; §3 and §6 in review.md), so
every existing `#2-running-a-review` and `#3-debt-register` link still resolves. The gaps are
deliberate — do not renumber them.

**Run a review at the end of every milestone**, and any time something feels off. It is a required
step in [roadmap.md](../roadmap.md) precisely because nothing else forces it and it ships no feature.

---

## 1. The four lenses

Run all four. They catch different things and a review that only does one is not a review.

### Lens 1 — Intent: does the code match the spec?

The domain doc is the spec ([ADR-0015](../decisions/0015-docs-as-orientation.md)). Drift
here means the doc has become fiction, and the next session will trust it anyway.

- [ ] Every entity and column in domain doc §3 exists, with the stated type
- [ ] Every numbered business rule in §4 is implemented **and has a test**
- [ ] Every endpoint in §5 exists; no endpoint exists that §5 doesn't list
- [ ] Jobs in §6 are registered and their failure behavior matches what's written
- [ ] §10 **Files** lists real paths, with `(planned)` markers removed
- [ ] Where code and doc disagree, decide which is right — then fix the other. **Do not
      leave both.**

### Lens 2 — Invariants: are the twelve still holding?

The [`CLAUDE.md`](../../CLAUDE.md) invariants are the ones that break silently. Most are
mechanically checkable — actually run the checks rather than eyeballing.

- [ ] **Every** repository function takes `actor: ActorContext` first
- [ ] **Every** domain table has `space_id`; no `owner_id` or `user_id` has crept onto a
      domain table
- [ ] **Every** repository query filters space and `deleted_at` — via the shared `scoped()`
      helper, not hand-written
- [ ] No Drizzle query or raw SQL outside a repository
- [ ] **Every** data endpoint has a cross-space 404 test
      ([conventions/testing.md](../conventions/testing.md) §2)
- [ ] No cross-space path returns 403 where it should return 404
- [ ] No database URL or storage credential outside `apps/api`
- [ ] No business rule that exists only in the web client
- [ ] No storage object key supplied by a client
- [ ] No hand-written type mirroring a Zod schema
- [ ] No hand-rolled crypto; primitives match [security-model.md](../security-model.md) §5
- [ ] No secrets in the repo, in code, docs, or commit messages
- [ ] No `catch {}` swallowing an error in an auth, crypto, or job path

Useful starting greps — verify results rather than trusting a clean exit:

```bash
rg 'owner_id|user_id' --glob '*/domains/**/*.schema.ts'   # expect: nothing
rg 'db\.(select|insert|update|delete)' --glob '*.routes.ts' --glob '*.service.ts'  # expect: nothing
rg 'export async function' --glob '*.repository.ts' -A1 | rg -v 'actor'  # expect: nothing
rg 'as any|@ts-ignore|!\.' --glob 'apps/**/*.ts'          # expect: only justified, commented
```

### Lens 3 — Docs: do they still describe reality?

- [ ] `CLAUDE.md` **Status** and **Conventions** sections are current — these go stale first,
      and they are the first thing every session reads
- [ ] Stack table matches what's actually installed
- [ ] Every internal link resolves
- [ ] **Deployment and provisioning status is asserted in exactly ONE place** — [roadmap.md § Current position](../roadmap.md#current-position) — and README, `architecture.md` §9
      and `CLAUDE.md` still *link* rather than restate. This is debt **D28**'s structural fix; it drifted twice when five files each claimed it
- [ ] No accepted ADR is contradicted by shipped code. **If one is, that is either a bug or
      a missing superseding ADR — decide which**
- [ ] Playbooks match what you'd actually do now. If you improvised around one, fix it
- [ ] [open-questions.md](open-questions.md): anything answered in practice but still listed
      as open?
- [ ] Known gaps in [security-model.md](../security-model.md) §7 still accurate

### Lens 4 — Use: is it actually being used?

The lens most likely to be skipped and the most valuable. Built ≠ useful.

- [ ] Is the milestone's feature being used in real life, weekly?
- [ ] What was built and **never** used? Candidate for **deletion** — unused code is pure
      cost, and deleting it is a win, not a loss
- [ ] What is the human still doing manually that this should have caught?
- [ ] Is time-to-capture still fast? ([brain.md](brain.md) principle 2 — degrades silently)
- [ ] Is the data real, or still test fixtures? An empty database means the feature failed
      regardless of quality
- [ ] Which cross-domain question got closer to answerable?

## 2. Running a review

1. **Read the intent first** — the domain doc and the milestone in
   [roadmap.md](../roadmap.md) — *before* reading code. Reading code first anchors you to
   what exists and you stop seeing what's missing.
2. **Work the four lenses in order.** Intent, invariants, docs, use.
3. **Record every finding** in the debt register — [review.md](review.md) §3 — even trivial ones. A
   finding not written down is a finding lost.
4. **Fix cheap things immediately.** A stale doc line or a missing test is faster to fix now
   than to describe.
5. **Triage the rest** — see §4.
6. **Then re-plan if needed** ([brain.md](brain.md) §10).

**A review that finds nothing was not a review.** Say what you checked and how, so the next
reviewer can trust or repeat it. If the checks genuinely passed, name the ones you ran.

## 4. Turning findings into work

| Severity | Meaning | Action |
|---|---|---|
| **high** | Data loss, security hole, or a broken invariant | Fix before the next feature. Displaces planned work |
| **med** | Real problem, contained | Register with a trigger; schedule it |
| **low** | Papercut or cosmetic | Register; batch them |

- **Broken invariant is always at least high**, regardless of whether anything has gone
  wrong yet. It means the mechanism failed, and the next session will copy the broken
  pattern.
- **A finding that recurs across two reviews escalates.** Recurrence means the fix didn't
  hold or the underlying cause was never addressed — treat the *mechanism* as the bug, not
  the instance.
- Product findings go to [idea-backlog.md](idea-backlog.md); technical debt stays here;
  anything needing a human decision goes to [open-questions.md](open-questions.md).

## 5. Review anti-patterns

| Anti-pattern | Why it's bad |
|---|---|
| **Reviewing only the diff** | Drift is cumulative. The bug is usually the interaction between two individually fine changes |
| **Finding nothing** | Not a clean bill of health — an ineffective review. State what you actually checked |
| **Fixing everything mid-review** | You lose the overview and the review never finishes. Fix cheap things, register the rest |
| **Registering without triggers** | Debt nobody will ever pay |
| **Skipping lens 4** | The one that reveals you built the wrong thing. Also the easiest to skip, because it needs honesty rather than greps |
| **Trusting the docs as ground truth** | The doc may be the thing that's wrong. Check both directions |
| **Reviewing your own work in the same session** | You'll see intent rather than what's there. Prefer a fresh session |
| **Appending findings to the nearest table** | D24–D26 were appended to *this* table rather than the register in [review.md](review.md) §3, so their severity, status and trigger silently vanished — GitHub Flavored Markdown drops cells past the header's column count. Findings go in the register, and nowhere else |
