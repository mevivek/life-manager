# ADR-0010: Vault key hierarchy, fixed before the vault is built

- **Status:** accepted
- **Date:** 2026-07-26

## Context

A real secrets/password vault is a long-term goal. It will not be built for several
milestones ([roadmap.md](../roadmap.md) M5). Nonetheless its cryptographic design is fixed
now, because it constrains three things that are being decided today:

1. **Ownership.** If sharing is space-based ([ADR-0006](0006-space-based-ownership.md)) but
   the vault is designed around a single user's passphrase, the two collide the moment
   family sharing meets the vault — and the fix is a redesign of the key hierarchy after
   real encrypted data exists.
2. **Auth.** The vault needs per-user crypto material stored beside the user record, which
   is part of why auth is self-hosted ([ADR-0007](0007-better-auth-self-hosted.md)).
3. **Recovery.** Whether recovery is possible at all is a cryptographic property, not a
   feature. It cannot be retrofitted onto data already encrypted without it.

Designing it now costs a document. Designing it later costs a migration of encrypted data
that, by construction, the server cannot help with.

## Decision

**A four-level key hierarchy, all cryptography client-side, with a one-time recovery code
as a second independent unwrap path.** Full diagram and detail in
[security-model.md](../security-model.md) §5.

```
vault passphrase ──Argon2id──► KEK ──unwraps──► user X25519 private key
                                                          │
                                                   unwraps│
                                                          ▼
                                    Space Key (wrapped once per member,
                                     to that member's public key)
                                                          │
                                                   unwraps│
                                                          ▼
                                    per-item DEK ──AES-256-GCM──► ciphertext

recovery code ──Argon2id──► RKEK ──unwraps──► user X25519 private key (2nd wrap)
```

Four properties this shape guarantees:

- **The server never holds a key or a plaintext.** It stores wrapped keys, salts, Argon2id
  parameters, and ciphertext. The vault passphrase is never transmitted.
- **Passphrase change re-wraps one key**, not every item.
- **Sharing is one operation**: wrap the Space Key to a new member's public key. A personal
  vault is a space with one member, so **sharing and E2EE compose rather than collide.**
  This is the reason the design is space-shaped from the start.
- **Recovery is possible exactly once, without the server.** The recovery code is generated
  client-side, shown once at setup, and never transmitted.

Primitives are fixed in [security-model.md](../security-model.md) §5: Argon2id via WASM,
AES-256-GCM, X25519, HKDF-SHA256, `crypto.getRandomValues`. **Never hand-roll a primitive.**

## Alternatives considered

- **Passphrase → key → items, with no keypair and no space layer.** The simplest design
  that works for one user. Rejected because sharing is impossible without a keypair to wrap
  to, and retrofitting one means re-encrypting every item after the vault holds real data.
  The whole point of deciding now is to avoid that.
- **Derive the vault key from the login password.** One secret for the user to remember,
  much better UX. Rejected: the server sees the login password at authentication time, so
  the server could derive the vault key. That is not end-to-end encryption. The two secrets
  must be independent.
- **No recovery at all (strict zero-knowledge).** Smallest attack surface, cleanest story.
  Rejected as a product decision: permanent total loss from one forgotten passphrase is too
  sharp an edge for a personal app someone relies on. The recovery code preserves
  zero-knowledge — the server still holds nothing useful — while making loss survivable once.
- **Server-assisted recovery / key escrow.** Friendly UX, and what most consumer products
  do. Rejected outright: if the server can restore access, the server can decrypt, and the
  vault is not E2EE. This was explicitly declined.
- **Reuse an existing vault (Bitwarden, 1Password) via API.** Honestly the sensible
  suggestion for a real user, and worth saying out loud. Rejected because a unified model
  across domains is the actual thesis of this project
  ([prior-art.md](../prior-art.md), final section) — but if the vault is ever descoped,
  integrating an existing one is the right answer, not shipping weaker crypto.
- **libsodium / TweetNaCl instead of WebCrypto.** Nicer API, well-audited. WebCrypto is
  native, requires no WASM payload for the common operations, and is hardware-accelerated.
  Argon2id is the one gap, filled with WASM.

## Consequences

**Good:** Building the vault at M5 requires no new cryptographic decisions — only
implementation. Sharing a vault with a family member needs no redesign. Passphrase rotation
is cheap. Auth and ownership decisions made today are already compatible with it.

**Bad:** More moving parts than a single-user vault needs on day one — a keypair and a space
key that, for one user, are pure overhead. Client-side crypto means key handling in browser
memory, with all the care that implies (auto-lock on idle, never persist an unwrapped key).
Argon2id in WASM adds bundle weight to the web client.

**Expensive operation to plan for:** *removing* a member from a shared vault requires
rotating the Space Key and re-wrapping every item DEK, because the removed member may have
cached the plaintext. Document this in the vault domain doc when it is written.

**Hard prerequisites before M5, do not skip:** passkeys or 2FA on the account, and a tested
backup/restore path ([security-model.md](../security-model.md) §7). An unrecoverable vault
behind a password-only login is a liability.

**Revisit if:** a genuine cryptographic weakness is found in this construction — in which
case fix it *before* the vault holds data, since afterwards every change requires
client-side re-encryption.
