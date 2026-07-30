#!/usr/bin/env node
/**
 * Fails if a domain table is defined but not re-exported from the schema barrel.
 *
 *     pnpm check:schema-barrel          # or: node scripts/check-schema-barrel.mjs
 *
 * ── Where it runs, and why `lint` rather than `typecheck` or `test` ──
 *
 * It is the FIRST thing `pnpm lint` does — `package.json` is JSON and cannot hold this comment, so
 * the reasoning lives here:
 *
 *  • It shipped wired only into `cloudbuild.deploy.yaml`, which meant no local feedback at all: a
 *    session added a table, saw green, and found out on push. A guardrail nobody runs is a comment.
 *  • `lint` is the right host because this IS static analysis — Node builtins, a few file reads, no
 *    install, no build, no Postgres (which is the whole point: the database-backed half in
 *    `migrations.test.ts` SKIPS wherever no Postgres is reachable, ADR-0018). Measured at ~70ms
 *    against `biome check .`'s seconds, so the common path does not notice it.
 *  • `typecheck` and `test` both go through Turborepo/Vitest and would have paid a second process
 *    tree for it; `lint` is a plain root script, so nothing about `turbo.json`'s task graph, its
 *    cache keys, or what the pipeline's `typecheck`/`test` steps mean changes.
 *  • It runs BEFORE `biome check .`, not after: a formatting nit must not be able to hide a table
 *    that will be missing in production. Cheapest and most consequential check first.
 *  • Invoked as `node scripts/…` and not `pnpm check:schema-barrel`, because a nested `pnpm run`
 *    costs ~1.6s of process spawn here — 20× the check itself.
 *
 * `pnpm check:schema-barrel` exists for running it alone. The pipeline keeps its own `checks` step
 * too, and that redundancy is deliberate: that step sits before the deploy guard and before
 * `pnpm install`, so it runs even on a push whose deploy is skipped.
 *
 * ── The rule this enforces, and why a sentence in a doc was not enough ──
 *
 * `apps/api/src/db/schema/index.ts` is the single barrel `drizzle.config.ts` and `db/client.ts`
 * read. Its own header states the consequence: **a table not re-exported there does not exist** as
 * far as migrations or the query builder are concerned. CLAUDE.md § Layout repeats it.
 *
 * The failure mode is the worst shape available: `drizzle-kit generate` simply does not see the
 * table, so no `create table` is emitted, no migration file changes, nothing goes red — and every
 * local test passes, because those tests run against a database somebody pushed or migrated at a
 * moment when the table happened to exist. The table is then missing **in production only**, and
 * the first evidence is a 500 from a live endpoint. Migrations now run on boot (ADR-0023), which
 * makes the gap arrive at deploy time rather than at first query, but does not close it: a
 * migration that was never generated cannot be applied.
 *
 * ── Why this is a script and not a test ──
 *
 * It needs **no database**, so it runs in every container and in the pipeline step that executes
 * regardless of the deploy path guard. `apps/api/src/db/migrations.test.ts` asserts the other half
 * of the same claim — barrel vs. `information_schema` — but it is database-backed, so it SKIPS
 * wherever Postgres is unavailable (ADR-0018), which is precisely where a session is most likely
 * to add a table and see green. The two are deliberately redundant.
 *
 * ── Static, on purpose ──
 *
 * It reads the TypeScript as text rather than importing it: importing would need a build or a
 * loader, and the whole value here is being cheap enough that nothing is tempted to skip it.
 * Node builtins only, no dependencies.
 */
import { readdirSync, readFileSync } from 'node:fs'
import { dirname, join, relative } from 'node:path'
import { fileURLToPath } from 'node:url'

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..')
const barrelPath = join(repoRoot, 'apps/api/src/db/schema/index.ts')
const domainsDir = join(repoRoot, 'apps/api/src/domains')

/**
 * Strips comments before matching, so a `pgTable(` inside a doc comment is not read as a
 * definition. `db/schema/scoped-columns.ts` has exactly such an example in its header, and while
 * that file is outside this scan today, the next one like it may not be.
 *
 * Crude by design — it does not understand strings containing `//`. The only thing it is used for
 * is finding `export const x = pgTable('name'` lines, and a `//` inside such a line would be a
 * comment anyway.
 */
function stripComments(source) {
  return source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^[ \t]*\/\/.*$/gm, '')
}

/** `export const documents = pgTable(\n  'documents',` → `{ constName, tableName }`. */
const TABLE_DEFINITION = /^export\s+const\s+(\w+)\s*=\s*pgTable\(\s*(?:\r?\n\s*)?['"]([^'"]+)['"]/gm

function findDomainSchemaFiles() {
  const files = []
  for (const entry of readdirSync(domainsDir, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue
    const domainDir = join(domainsDir, entry.name)
    for (const file of readdirSync(domainDir)) {
      if (file.endsWith('.schema.ts')) files.push(join(domainDir, file))
    }
  }
  return files.sort()
}

/**
 * The specifiers the barrel re-exports, and how.
 *
 * Both forms are read because both are legal: `export * from './x.js'` is what the barrel uses
 * today, and a future named re-export must not silently look like an omission. The `.js` in a
 * specifier is the runtime extension of a `.ts` file (NodeNext resolution), so it is mapped back.
 */
function readBarrel() {
  const source = stripComments(readFileSync(barrelPath, 'utf8'))
  const starred = new Set()
  const named = new Map()

  for (const match of source.matchAll(/^export\s+\*\s+from\s+['"]([^'"]+)['"]/gm)) {
    starred.add(resolveSpecifier(match[1]))
  }
  for (const match of source.matchAll(/^export\s+\{([^}]*)\}\s+from\s+['"]([^'"]+)['"]/gm)) {
    const path = resolveSpecifier(match[2])
    const names = match[1]
      .split(',')
      .map((part) =>
        part
          .trim()
          .split(/\s+as\s+/)[0]
          .trim(),
      )
      .filter((name) => name.length > 0)
    named.set(path, new Set([...(named.get(path) ?? []), ...names]))
  }

  return { starred, named }
}

function resolveSpecifier(specifier) {
  return join(dirname(barrelPath), specifier.replace(/\.js$/, '.ts'))
}

const { starred, named } = readBarrel()
const missing = []
let tableCount = 0

for (const file of findDomainSchemaFiles()) {
  const source = stripComments(readFileSync(file, 'utf8'))
  for (const match of source.matchAll(TABLE_DEFINITION)) {
    const [, constName, tableName] = match
    tableCount += 1
    const exported = starred.has(file) || (named.get(file)?.has(constName) ?? false)
    if (!exported) missing.push({ constName, tableName, file })
  }
}

/**
 * A scan that finds nothing must fail, not pass.
 *
 * Debt D33's lesson, applied to a script instead of a test: if the convention moves — domain
 * schemas renamed, `pgTable` wrapped in a helper — the regex quietly matches zero tables and every
 * diff is empty. "No tables are missing" and "no tables were looked at" produce identical output
 * unless one of them is made an error. The floor is deliberately low; it only has to be non-zero.
 */
if (tableCount === 0) {
  console.error(
    'check-schema-barrel: found NO pgTable definitions under apps/api/src/domains/*/*.schema.ts.\n' +
      'That is a broken check, not a clean result — either the convention moved (see\n' +
      'docs/agent-playbooks/add-a-domain.md §3) or this script needs updating. Failing loudly.',
  )
  process.exit(1)
}

if (missing.length > 0) {
  console.error(
    `check-schema-barrel: ${missing.length} table(s) are defined but NOT re-exported from\n` +
      `${relative(repoRoot, barrelPath)}:\n`,
  )
  for (const { constName, tableName, file } of missing) {
    console.error(`  ✗ "${tableName}"  (export const ${constName})`)
    console.error(`      defined in: ${relative(repoRoot, file)}`)
  }
  console.error(
    '\nA table missing from the barrel is invisible to drizzle-kit, so no `create table` is\n' +
      'generated and nothing goes red — it is missing IN PRODUCTION while every local test passes.\n' +
      'Fix by adding the re-export, then regenerating migrations:\n\n' +
      `    // ${relative(repoRoot, barrelPath)}\n` +
      "    export * from '../../domains/<domain>/<domain>.schema.js'\n\n" +
      '    pnpm --filter @life-manager/api db:generate\n',
  )
  process.exit(1)
}

console.log(
  `check-schema-barrel: ${tableCount} domain table(s) checked, all re-exported from ` +
    `${relative(repoRoot, barrelPath)}.`,
)
