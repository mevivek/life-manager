/// <reference types="vite/client" />
/// <reference types="vite-plugin-pwa/client" />

interface ImportMetaEnv {
  /**
   * Origin of the API. Baked into the bundle at build time, so it is PUBLIC by construction —
   * never put anything secret behind a `VITE_` prefix (CLAUDE.md invariant 1).
   *
   * Empty in local development: the Vite dev proxy forwards `/api` to the API, which makes
   * requests same-origin. Set to `https://api.mevivek.dev` in the Cloudflare Pages project.
   */
  readonly VITE_API_URL?: string
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}

/**
 * The persisted Query cache's buster, substituted at build time by `define` in `vite.config.ts`.
 *
 * A global rather than an `import.meta.env` entry because it must be a compile-time constant the
 * bundler can inline: `lib/persister.ts` reads it at module scope, before React mounts.
 */
declare const __APP_VERSION__: string
