# life-manager

A personal life-management app — one coherent place for the documents, possessions, money,
people, and secrets that make up a life.

**Status: pre-code.** Architecture and product direction are documented; no application
code exists yet.

---

## The idea

Single-domain tools already exist and are good. Paperless-ngx does documents. Firefly III
does money. Bitwarden does secrets. The bet here isn't to beat any of them at their own
domain — it's that **the interesting questions cross domains**:

> *What does this warranty cover, what did it cost, who sold it to me, where's the receipt,
> and when does it expire?*

No single-domain tool can answer that.

## What it will be

- **Documents** — identity papers, contracts, warranties, receipts, certificates, with
  expiry reminders that actually fire
- **Assets** — what you own, where it is, what it's worth
- **Money** — what you own and owe (not a budgeting app)
- **People** — who matters and what you need to remember about them
- **Notes** — everything that doesn't fit the above
- **Vault** — an end-to-end encrypted password and secrets store

Built one domain at a time, starting with Documents.

## Design constraints

- **Multi-user from day one**, though it starts as a single-user app
- **Synced across devices** — phone and laptop, server as the source of truth
- **Backend and frontend fully decoupled**, so native mobile clients are plug-and-play
- **Web client is a PWA** — installable, works offline for reading
- **Family sharing** is a near-term goal, so ownership is modeled on shared *spaces* from
  the first table
- **End-to-end encryption for the vault** — designed up front so it doesn't require a
  redesign later
- Built almost entirely by AI-agent sessions, which shapes nearly every decision below

## Stack

TypeScript throughout. Vite + React PWA, Fastify API, Postgres on Neon with Drizzle, Better
Auth, Cloudflare R2 for files, pg-boss for background jobs.

Rationale for each choice — and the alternatives rejected — is in
[`docs/decisions/`](docs/decisions/index.md).

## Documentation

Everything lives in [`docs/`](docs/README.md), organized so a fresh reader (human or AI) can
orient from two or three files:

| | |
|---|---|
| [`docs/README.md`](docs/README.md) | Start here — a "doing X? read Y" routing table |
| [`docs/architecture.md`](docs/architecture.md) | How the system fits together |
| [`docs/security-model.md`](docs/security-model.md) | Trust boundaries, data sensitivity, the vault design |
| [`docs/decisions/`](docs/decisions/index.md) | Why each choice was made, and what was rejected |
| [`docs/domains/`](docs/domains/) | One spec per life domain |
| [`docs/product/`](docs/product/brain.md) | Vision, principles, and the idea backlog |
| [`docs/roadmap.md`](docs/roadmap.md) | What's next |

[`CLAUDE.md`](CLAUDE.md) is the entry point for AI sessions.

## Getting started

Nothing to run yet. The first milestone ([M0](docs/roadmap.md)) scaffolds the monorepo, and
this section gets real instructions then.

## License

Not yet chosen. Personal project.
