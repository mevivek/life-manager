#!/usr/bin/env node
/**
 * Generates a VAPID key pair for Web Push reminder delivery.
 *
 *     node scripts/generate-vapid-keys.mjs
 *
 * **Use this rather than another VAPID tool.** `webpush-webcrypto` encodes its private key in its
 * own format — not the 43-character base64url `d` value that `web-push --generate-vapid-keys` and
 * most online generators emit — so a pair from elsewhere will not load. The public half *is*
 * standard: it is base64url of the raw uncompressed P-256 point, which is exactly what a browser
 * wants as `applicationServerKey`.
 *
 * The output is a secret. It is printed to stdout for you to paste into a secret store, and
 * deliberately not written to any file — `.env` files and this repo never hold values
 * (CLAUDE.md invariant 11, security-model.md §6).
 */
import { webcrypto } from 'node:crypto'
import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

/**
 * `webpush-webcrypto` is a dependency of `apps/api`, not of the repo root, and pnpm workspaces do
 * not hoist it — so a bare `import 'webpush-webcrypto'` from this file fails with
 * ERR_MODULE_NOT_FOUND. Node resolves from the importing *file's* location, not the cwd, so
 * running the script from `apps/api` would not help either.
 *
 * Resolving against `apps/api/package.json` is what lets this stay a root-level script, next to
 * `verify-deployment.mjs`, and still be run as `node scripts/generate-vapid-keys.mjs`.
 */
const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..')
const requireFromApi = createRequire(pathToFileURL(join(repoRoot, 'apps/api/package.json')))
const { ApplicationServerKeys, setWebCrypto } = await import(
  pathToFileURL(requireFromApi.resolve('webpush-webcrypto')).href
)

// Required under Node: the library probes for a global it does not find and throws
// `Could not find global Crypto module` otherwise.
setWebCrypto(webcrypto)

const keys = await ApplicationServerKeys.generate()
const { publicKey, privateKey } = await keys.toJSON()

console.log(`
Generated a VAPID key pair.

  VAPID_PUBLIC_KEY=${publicKey}
  VAPID_PRIVATE_KEY=${privateKey}
  VAPID_SUBJECT=mailto:you@example.com

Where each one goes:

  · VAPID_PUBLIC_KEY   served to browsers by GET /api/v1/push/public-key. Public by design —
                       it identifies the sender and authorises nothing.
  · VAPID_PRIVATE_KEY  SECRET. Secret Manager in production, apps/api/.env locally. Never
                       commit it, never paste it into a chat or a ticket.
  · VAPID_SUBJECT      a mailto: or https: contact for the push service operator (RFC 8292).

All three must be set together, or none — see apps/api/src/env.ts. Rotating the pair
invalidates every existing browser subscription, so every device must re-subscribe.
`)
