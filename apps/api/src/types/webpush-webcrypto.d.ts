/**
 * Type declarations for `webpush-webcrypto`, which ships none.
 *
 * conventions/code.md §5: isolate an untyped dependency in one place with a comment, rather than
 * letting `any` spread to call sites. `lib/push.ts` is the only importer, and the shapes below were
 * verified against the installed 1.0.5 at runtime rather than copied from a README.
 *
 * Kept as a `.d.ts` beside the code rather than published as `@types/*`: it describes only the
 * three exports this project uses, so it is not a faithful description of the whole package.
 */
declare module 'webpush-webcrypto' {
  /**
   * `publicKey` is base64url of the raw uncompressed P-256 point — the value a browser passes as
   * `applicationServerKey`. `privateKey` is **this library's own encoding**, not the 43-character
   * base64url `d` value other VAPID tools emit, so key pairs are not interchangeable between
   * tools. `scripts/generate-vapid-keys.mjs` produces the right format.
   */
  export type ApplicationServerKeysJSON = { publicKey: string; privateKey: string }

  export class ApplicationServerKeys {
    static generate(): Promise<ApplicationServerKeys>
    static fromJSON(json: ApplicationServerKeysJSON): Promise<ApplicationServerKeys>
    toJSON(): Promise<ApplicationServerKeysJSON>
  }

  export function generatePushHTTPRequest(args: {
    applicationServerKeys: ApplicationServerKeys
    payload: string
    target: { endpoint: string; keys: { p256dh: string; auth: string } }
    adminContact: string
    ttl: number
  }): Promise<{
    endpoint: string
    headers: Record<string, string>
    /** An `ArrayBuffer` in 1.0.5. The encrypted `aes128gcm` body. */
    body: ArrayBuffer
  }>

  /**
   * Hands the library a WebCrypto implementation.
   *
   * **Required under Node 22.** The library probes for a global it does not find and throws
   * `Could not find global Crypto module` on the first call otherwise — measured, not guessed.
   */
  export function setWebCrypto(crypto: unknown): void
}
