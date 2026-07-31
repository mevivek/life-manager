#!/usr/bin/env node
/**
 * ═══════════════════════════════════════════════════════════════════════════════════════════════
 *  Fail on a Cloud Build substitution token that Cloud Build will reject.
 * ═══════════════════════════════════════════════════════════════════════════════════════════════
 *
 * Cloud Build resolves `$NAME` and `${NAME}` in a build config before any step runs. A name that is
 * neither a built-in nor a user substitution (`_`-prefixed) is a hard error:
 *
 *   generic::invalid_argument: invalid value for 'build.substitutions':
 *   key in the template "UPPERCASE" is not a valid built-in substitution
 *
 * **The build is rejected at submission, so ZERO steps run.** That is why this check cannot live in
 * the pipeline: a config the pipeline would reject never reaches the step that would have caught it.
 * It has to run before the push, which is why it is wired into `pnpm lint`.
 *
 * This exists because of a real outage on 2026-07-31 (debt D82). The token was not even code — it
 * was a bash comment explaining this exact escaping rule:
 *
 *   # Lowercase shell variables on purpose: Cloud Build substitutes $UPPERCASE and ${UPPERCASE}
 *
 * A `#` line inside a YAML `|` block is part of the step's args string, not a YAML comment, so the
 * example token was live config. Every build failed for 25 minutes with no step output to explain
 * it, and `gcloud builds log` could not even fetch the logs (the pipeline uses CLOUD_LOGGING_ONLY,
 * so there is no logs bucket) — the cause was only visible in `describe`'s statusDetail.
 *
 * Escaping, for reference: `$$` yields a literal `$`, so `$$IMG` reaches bash as `$IMG`.
 */
import { readdirSync, readFileSync } from 'node:fs'

/**
 * Cloud Build's built-in substitutions. A name here is legal in any build config.
 * Source: cloud.google.com/build/docs/configuring-builds/substitute-variable-values
 */
const BUILT_INS = new Set([
  'PROJECT_ID',
  'PROJECT_NUMBER',
  'BUILD_ID',
  'LOCATION',
  'TRIGGER_NAME',
  'TRIGGER_BUILD_CONFIG_PATH',
  'COMMIT_SHA',
  'SHORT_SHA',
  'REVISION_ID',
  'REPO_NAME',
  'REPO_FULL_NAME',
  'BRANCH_NAME',
  'TAG_NAME',
  'REF_NAME',
  'SERVICE_ACCOUNT',
  'SERVICE_ACCOUNT_EMAIL',
])

const files = readdirSync('.').filter((f) => /^cloudbuild.*\.ya?ml$/.test(f))
if (files.length === 0) {
  console.error('check-cloudbuild-subs: no cloudbuild*.yaml found — run this from the repo root.')
  process.exit(1)
}

/** `$$` first, so an escaped dollar is consumed and never read as a token. */
const TOKEN = /\$\$|\$\{([A-Za-z_][A-Za-z0-9_]*)\}|\$([A-Za-z_][A-Za-z0-9_]*)/g

const problems = []
let tokensChecked = 0

for (const file of files) {
  const lines = readFileSync(file, 'utf8').split('\n')
  lines.forEach((line, i) => {
    for (const match of line.matchAll(TOKEN)) {
      if (match[0] === '$$') continue
      const name = match[1] ?? match[2] ?? ''
      // Lower-case names are shell variables: Cloud Build leaves them alone.
      if (name !== name.toUpperCase()) continue
      tokensChecked++
      // `_`-prefixed names are user substitutions, declared in the file's own `substitutions:` block
      // or supplied by the trigger. Cloud Build accepts an undeclared one only if the trigger
      // supplies it, which this check cannot see — so it deliberately does not police them.
      if (name.startsWith('_')) continue
      if (BUILT_INS.has(name)) continue
      problems.push({ file, line: i + 1, name, text: line.trim() })
    }
  })
}

if (problems.length > 0) {
  console.error(
    `check-cloudbuild-subs: ${problems.length} token(s) Cloud Build will REJECT the whole config over:\n`,
  )
  for (const p of problems) {
    console.error(`  ✗ ${p.name}  —  ${p.file}:${p.line}`)
    console.error(`      ${p.text}`)
  }
  console.error(
    '\nCloud Build resolves these before any step runs, so the build fails at submission with',
  )
  console.error('zero step output. Fix by one of:')
  console.error(
    '  • it is a shell variable  -> make it lower-case (never substituted), or write $$NAME',
  )
  console.error('  • it is a real substitution -> rename it with a leading underscore')
  console.error('  • it is only an EXAMPLE in prose -> reword it. A `#` line inside a `|` block is')
  console.error(
    '    part of the step args, not a YAML comment, so an example token is live config.',
  )
  process.exit(1)
}

// A non-zero floor: "nothing invalid" and "nothing examined" must not print the same thing (D33).
if (tokensChecked === 0) {
  console.error(
    `check-cloudbuild-subs: examined ${files.length} file(s) and found NO substitution tokens at all.`,
  )
  console.error('That is almost certainly a broken matcher, not a clean config.')
  process.exit(1)
}

console.log(
  `check-cloudbuild-subs: ${tokensChecked} substitution token(s) across ${files.join(', ')} — all valid.`,
)
