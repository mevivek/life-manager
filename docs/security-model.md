# Security model

This document is the single authority on trust boundaries, data sensitivity, and
encryption in life-manager. If you are about to write anything involving crypto, keys,
authorization, or a decision about what the server may read — read this first, in full.

Related: [ADR-0009](decisions/0009-sensitivity-tiers.md) (what is encrypted and what
isn't), [ADR-0010](decisions/0010-vault-key-hierarchy.md) (the vault key hierarchy),
[ADR-0006](decisions/0006-space-based-ownership.md) (how ownership works).

---

## 1. Trust boundaries

There are exactly four, and the API is the only thing that crosses more than one.

```
  ┌──────────────┐   HTTPS    ┌──────────────┐
  │  Client      │──────────► │   API        │
  │  (web / iOS  │            │  (Fastify)   │
  │   / Android) │ ◄──────────│              │
  └──────┬───────┘            └──┬────────┬──┘
         │                       │        │
         │  presigned URL        │        │
         │  (bytes direct)       │        │
         ▼                       ▼        ▼
  ┌──────────────┐        ┌──────────┐ ┌──────────┐
  │  R2 (files)  │        │ Postgres │ │  pg-boss │
  └──────────────┘        └──────────┘ └──────────┘
```

**Boundary rules — these are invariants, not preferences:**

1. **Only `apps/api` talks to Postgres or R2 credentials.** No client, no build step, no
   script outside `apps/api` may hold a database URL or an R2 access key. If you find
   yourself wanting a Supabase-style "client talks to the DB with RLS" shortcut, that is
   a violation — see [ADR-0002](decisions/0002-api-first-decoupling.md).
2. **Clients are untrusted.** Every field a client sends is attacker-controlled, including
   IDs, `space_id`, filenames, and pagination cursors. Validate everything at the edge
   with Zod ([ADR-0004](decisions/0004-zod-single-contract-source.md)).
3. **Authorization is server-side, always.** Hiding a button is not a security control.
   Every read and every write re-checks space membership on the server.
4. **File bytes never transit the API.** Uploads and downloads go client ↔ R2 directly
   via short-lived presigned URLs minted by the API. The API decides the object key; the
   client never supplies one ([ADR-0008](decisions/0008-object-storage-r2.md)).

## 2. Identity and sessions

Auth is [Better Auth](https://better-auth.com), self-hosted inside the API, with its
tables in our own Postgres ([ADR-0007](decisions/0007-better-auth-self-hosted.md)).

| Client | Session transport | Why |
|---|---|---|
| Web (PWA) | `httpOnly`, `Secure`, `SameSite=Lax` cookie | Not readable by JS, so XSS cannot exfiltrate the session |
| Native (future) | `Authorization: Bearer <token>` | Cookies are awkward on native; same session store either way |

Both resolve to the same `ActorContext` inside the API, so no endpoint needs to know
which client type it is serving.

Planned, not yet built: passkeys (WebAuthn) and TOTP 2FA, both first-party Better Auth
plugins. Passkeys are the intended long-term primary login for this app — a life vault
protected by a reused password is the weak link, not the crypto.

## 3. The actor context

Every request that touches data resolves to exactly one:

```ts
type ActorContext = {
  userId: string        // authenticated user
  spaceIds: string[]    // spaces this user is a member of
  role: 'owner' | 'member'  // role in the space being acted upon
}
```

**The repository layer cannot be called without one.** This is the primary tenant-isolation
mechanism — not a convention, a type-level requirement. Every repository function takes
`actor` as its first parameter and every query it issues filters on
`space_id IN actor.spaceIds`. See [conventions/code.md](conventions/code.md) for the
layering that enforces this and [conventions/data.md](conventions/data.md) for the schema
rules that make it possible.

Postgres row-level security is **planned defense-in-depth, not yet implemented** — see
[ADR-0006](decisions/0006-space-based-ownership.md) for why it is deferred and what
triggers building it (going public).

## 4. Sensitivity tiers

Every piece of data in the system belongs to exactly one tier. Each domain doc states its
tier explicitly. **Do not invent a tier for a new domain — pick one of these three.**

| Tier | Name | Who can read plaintext | Used by |
|---|---|---|---|
| **0** | Server-readable | The API, and therefore the server operator | **Everything today**: documents, files, assets, money, people, notes |
| **1** | Server-side encrypted | The API (holds the keys); protects against a raw database or bucket dump | *Nothing yet.* Reserved. |
| **2** | End-to-end encrypted | Only the user's client. The server stores ciphertext and cannot decrypt it. | **The vault only** (future) |

### Why documents are Tier 0, deliberately

This is a decision, not an oversight. Every capability that makes a document manager
actually useful requires the server to read the data:

- OCR and search *inside* a PDF
- Auto-extracting expiry dates from a scanned passport
- Reminders that fire while your phone is off
- Thumbnails and previews
- Server-side full-text search across the whole archive

Products that encrypt everything end-to-end give all of that up permanently — see
[prior-art.md](prior-art.md). We chose the capability. Neon and R2 still encrypt at rest
at the infrastructure level; that is free and automatic and is *not* what Tier 1 means.

**What this means concretely:** the server operator (you) can read your own documents.
The threat model that Tier 0 defends against is a lost laptop, a stolen phone, a
network attacker, and another *user* of the system — not a compromised server.

### Upgrading a tier later

Tier is a per-domain property recorded in the domain doc. Moving Documents from Tier 0 to
Tier 2 later is possible but is a **product decision with permanent feature cost**, not a
refactor. It would require: adding the envelope columns from §5, a client-side migration
that downloads and re-encrypts every file, and deleting OCR/preview/server-search. Do not
do this without an ADR that supersedes [ADR-0009](decisions/0009-sensitivity-tiers.md).

## 5. Vault key hierarchy (Tier 2 — designed now, built later)

The vault does not exist yet. Its cryptographic design is fixed now so that building it is
an additive feature rather than a redesign of ownership, sharing, and auth. Full rationale
in [ADR-0010](decisions/0010-vault-key-hierarchy.md).

### Design goals

1. The server never sees a vault plaintext or any unwrapped key. Ever.
2. Changing the vault passphrase must not require re-encrypting every item.
3. Sharing a vault with a family member must be possible without a redesign.
4. Losing the passphrase must be survivable exactly once, via a recovery code, with no
   server involvement.

### The hierarchy

```
vault passphrase ──Argon2id(salt, params)──► KEK  (never leaves the client)
                                              │
                        ┌─────────────────────┴─────────────────────┐
                        │ unwraps                                    │
                        ▼                                            │
              user private key (X25519)                              │
                        │                                            │
                        │ unwraps                                    │
                        ▼                                            │
                   Space Key  ◄── wrapped separately to EACH member's public key
                        │
                        │ unwraps
                        ▼
              per-item DEK ──AES-256-GCM──► vault item ciphertext

recovery code ──Argon2id(salt2)──► RKEK ──unwraps──► user private key (second wrap)
```

**Read it as five facts:**

- The **KEK** is derived client-side from the vault passphrase via Argon2id. The passphrase
  is never sent to the server. Only the salt and Argon2id parameters are stored server-side.
- Each user has an **X25519 keypair**. The public key is stored in plaintext; the private
  key is stored only as ciphertext, wrapped under the KEK.
- Each space has a **Space Key**, generated client-side. It is stored once per member,
  each copy wrapped to that member's public key. **A personal vault is just a space with
  one member** — which is why sharing and E2EE compose here instead of colliding.
- Each vault item has its own random **DEK**. The item is AES-256-GCM encrypted under the
  DEK; the DEK is stored wrapped under the Space Key.
- The **recovery code** is a second, independent wrap of the user's private key. It is
  shown exactly once at vault setup, generated client-side, and never transmitted.

### Consequences of this shape

- **Passphrase change** re-wraps one key (the private key). Not every item. Cheap.
- **Adding a family member to a vault** = wrap the Space Key to their public key. One
  operation, no re-encryption of items.
- **Removing a member** deletes their wrapped Space Key copy — but they may have cached
  the plaintext, so removal must also rotate the Space Key and re-wrap every item DEK.
  This is expensive and must be documented in the vault domain doc when it is written.
- **Forgetting both passphrase and recovery code means permanent, unrecoverable loss.**
  There is no server-side reset. This must be stated in the UI at vault setup, not buried.

### Primitives — do not deviate

| Purpose | Algorithm | Source |
|---|---|---|
| Passphrase → KEK | Argon2id | WASM (`hash-wasm` or equivalent) |
| Symmetric encryption | AES-256-GCM | WebCrypto `SubtleCrypto` |
| Key agreement / wrapping | X25519 (ECDH) + AES-KW | WebCrypto |
| Key derivation | HKDF-SHA256 | WebCrypto |
| Randomness | `crypto.getRandomValues` | WebCrypto |

Argon2id parameters are stored per-user so they can be raised over time without
invalidating old vaults. Start at OWASP's current recommendation; record the actual
values in the vault domain doc when it is written.

**Never hand-roll a primitive.** No custom ciphers, no custom padding, no "simple XOR for
now", no `Math.random()` for anything cryptographic. If a task seems to require inventing
crypto, it is the wrong task — stop and write an ADR.

### Explicit non-goals

- **Server-side search over vault data.** Blind indexes, order-preserving encryption, and
  encrypted search schemes are out of scope. Vault search happens client-side after
  unlock, over decrypted-in-memory data.
- **Server-assisted recovery.** Deliberately impossible. See goal 4.
- **Protecting against a malicious client.** If the user's own device is compromised while
  the vault is unlocked, the vault is compromised. That is inherent to E2EE.

## 6. Application security rules

These apply to all code, all tiers.

- **Parameterize every query.** Drizzle does this by default; if you reach for
  `sql.raw()`, you are probably wrong. Never concatenate caller input into SQL.
- **Never log secrets or PII.** Not passphrases, tokens, session cookies, key material,
  presigned URLs, or document contents. The pino logger has a redaction list — add to it
  when you add a sensitive field.
- **Never swallow errors.** Surface them via the logger or rethrow. A silent `catch {}` in
  an auth or crypto path is a security bug.
- **Rate-limit auth endpoints.** Login, signup, password reset, and vault unlock attempts.
- **Presigned URLs are short-lived** — minutes, not hours — and single-purpose (a PUT URL
  cannot GET).
- **No secrets in the repo.** No `.env` files committed, no keys in code, no credentials
  in docs or commit messages. Config comes from environment variables at runtime.
- **Outbound fetches are allowlisted.** Any new call to an external host needs the host
  recorded, and must not follow redirects (SSRF).

## 7. Known gaps

Honest list of what is *not* handled yet. Do not assume these are done.

| Gap | Debt | Trigger to fix |
|---|---|---|
| Postgres RLS not enabled | D1 | Before going public |
| No audit log of reads/writes | D2 | Before multi-member spaces ship |
| No 2FA / passkeys. **Google sign-in is not a second factor** — it is a second password-grade route ([ADR-0020](decisions/0020-google-oauth-alongside-password.md)) | D3 | Before going public; hard prerequisite for the vault |
| No backup/restore runbook; Neon PITR never tested | D4 | Before storing anything irreplaceable |
| No key rotation procedure for R2 / DB credentials | D5 | Before going public |
| **No password reset and no email verification.** `requireEmailVerification: false`, no mail provider. A password-only account has no recovery path but editing the database | D11 | Before M3, or sooner if it bites |
| **The Neon dev credential was exposed in a chat transcript and is unrotated.** Neon's free tier has no IP allowlist, so the string alone is full read/write/drop | D18 | **Before the first real document is stored** |
| Vault entirely unbuilt | — | M5 — see [roadmap.md](roadmap.md) |

**This table restates [review.md](product/review.md) §3 and has drifted from it once already** —
D11 and D18 were missing until the M0 review (debt D31). If you change one, change both; the
register is the authoritative list.
