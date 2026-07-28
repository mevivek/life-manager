# ADR-0022: `webpush-webcrypto` for Web Push, not `web-push`

- **Status:** accepted
- **Date:** 2026-07-28

## Context

M1's headline deliverable is expiry reminders that actually fire
([domains/documents.md](../domains/documents.md) §6, [prior-art.md](../prior-art.md) §3 — storage
without reminders is the commodity half of the feature). Delivery is Web Push, which means two RFCs:

- **RFC 8291** — message encryption. ECDH on P-256, HKDF, AES-128-GCM.
- **RFC 8292** — VAPID. An ES256-signed JWT identifying the sender.

Neither is optional and neither is small. The obvious dependency is **`web-push`**, which is the
de-facto standard, appears in every tutorial, and is what a future session will reach for.

**It is MPL-2.0.** This project's allowed licences are Apache-2.0, MIT, BSD, ISC, CDDL and EPL. MPL-2.0
is not on that list — it is weak copyleft at file granularity, so it is not in the same category as
GPL or SSPL, but the allowed list is explicit and MPL is not in it.

## Decision

**Use `webpush-webcrypto` (MIT, zero dependencies), isolated behind
`apps/api/src/lib/push.ts`.**

The wrapper exposes one function — `sendPush(target, message)` — returning a discriminated outcome
(`sent` · `expired` · `not-configured` · `failed`) rather than throwing, because the caller is a job
that must distinguish "retry later" from "stop retrying this endpoint forever" from "push is not set
up on this deployment". Those have different consequences and a thrown error collapses them.

Two practical notes that cost time and are recorded so they do not again:

- **The library needs WebCrypto handed to it explicitly.** It probes for a global it does not find
  under Node 22 and throws `Could not find global Crypto module` on first use. `setWebCrypto(webcrypto)`
  runs once at module load in the wrapper.
- **It ships no type declarations**, so `apps/api/src/types/webpush-webcrypto.d.ts` describes the
  three exports actually used. That file was written against the installed 1.0.5 at runtime, not
  copied from a README.
- **Its private-key encoding is its own**, not the 43-character base64url `d` value that
  `web-push --generate-vapid-keys` and online generators emit. Key pairs are therefore **not**
  interchangeable between tools, which is why `scripts/generate-vapid-keys.mjs` exists and why
  `.env.example` says to use it.

## Alternatives considered

- **`web-push`.** The default choice, mature, well documented. **Rejected on licence only** — MPL-2.0
  is not on the allowed list. Worth stating plainly: this is a compliance decision, not a technical
  judgement, and `web-push` is the better-known library. If the allowed-licence list ever admits
  MPL-2.0, revisiting this is a small, contained change because delivery lives behind one wrapper.
- **Implementing RFC 8291 + RFC 8292 by hand** with `node:crypto`. Genuinely feasible — every
  primitive needed (ECDH, HKDF, AES-128-GCM, ES256 signing) is in the standard library, so it would
  not mean *inventing* cryptography. **Rejected under [CLAUDE.md](../../CLAUDE.md) invariant 8
  anyway:** composing those primitives correctly is exactly the class of code that looks right,
  passes a happy-path test, and is subtly wrong in a way nobody notices — and a silently broken
  encryption step here means notifications that never arrive rather than an error.
- **`@block65/webcrypto-web-push`.** Also MIT, also WebCrypto-based, and a reasonable second choice.
  `webpush-webcrypto` was preferred for having zero dependencies at all.
- **Skipping Web Push and sending email instead.** Would need a mail provider, which the project
  does not have (debt D11 records that this is also why there is no password reset). Deferred rather
  than rejected: `reminders.channel` is an enum that already includes `email`, and the scan job
  dispatches on it, so adding email later is a handler and a credential — not a redesign. The service
  rejects a non-`web_push` channel today with a message saying it is unimplemented, rather than
  pretending to accept it.
- **A third-party push service** (OneSignal, Pusher Beams). Rejected: it would put a vendor between
  this app and its users' notifications for a feature that is ~100 lines with a library, and it
  would mean sending document titles to a third party — which is a Tier 0 data-sharing decision
  ([ADR-0009](0009-sensitivity-tiers.md)) taken for convenience.

## Consequences

**Good:** MIT and dependency-free, so the licence and supply-chain surface are both minimal. The
whole of delivery is one file, so swapping the library — or adding a channel — touches one place.
Nothing cryptographic is hand-written.

**Bad, and worth stating honestly:**

- **It is a far less-used package than `web-push`,** which means fewer eyes and a real bus-factor
  risk. Mitigated by the wrapper boundary rather than eliminated: if it is abandoned, the surface to
  replace is `sendPush` and a type declaration.
- **The key format is non-standard**, so a pair generated anywhere else will not load. That is a
  papercut with a sharp edge — the failure happens at delivery time, inside a background job, which
  is the least visible place. `scripts/generate-vapid-keys.mjs` and `.env.example` both say so.
- **We maintain type declarations for someone else's package.** They will drift if the library
  updates.

**Revisit if:** the allowed-licence list changes; the package is abandoned; or a second delivery
channel (email, FCM, APNs) arrives and it becomes worth a common abstraction rather than one
provider behind one wrapper.
