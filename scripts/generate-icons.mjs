#!/usr/bin/env node
import { readFileSync, writeFileSync } from 'node:fs'
/**
 * Rasterises `apps/web/public/favicon.svg` into the PWA's PNG icons.
 *
 *     node scripts/generate-icons.mjs
 *
 * **Why a script rather than committed art:** the icon is a 6-line SVG, so the PNGs are a build
 * artefact of it. Regenerating beats hand-editing four bitmaps whenever the mark changes.
 *
 * **Why Chromium rather than sharp or ImageMagick:** it renders SVG with proper antialiasing and is
 * already present (`PLAYWRIGHT_BROWSERS_PATH`), so this adds no dependency to the repo. It does
 * need `playwright-core` available — which is a dev-only concern, and the PNGs are committed, so
 * nobody has to run this to build or deploy the app. Closes debt D16.
 *
 * ── The maskable variant is not the same image ──
 *
 * Android crops a maskable icon to whatever shape the launcher wants — circle, squircle, rounded
 * square — and only the middle **80%** is guaranteed to survive (the "safe zone"). Shipping the
 * ordinary icon as maskable is the common mistake: the rounded corners get cropped again, and the
 * glyph loses its edges. So the maskable one is drawn on a full-bleed background with the glyph
 * scaled down into the safe zone.
 */
import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..')
const publicDir = join(repoRoot, 'apps/web/public')

// Resolved from apps/web, where playwright-core would be installed as a devDependency.
const requireFromWeb = createRequire(pathToFileURL(join(repoRoot, 'apps/web/package.json')))
let chromium
try {
  // `playwright-core` is CommonJS, so a dynamic import may expose its exports on `default`
  // depending on Node's interop path. Check both rather than assuming one.
  const mod = await import(pathToFileURL(requireFromWeb.resolve('playwright-core')).href)
  chromium = mod.chromium ?? mod.default?.chromium
  if (chromium === undefined) throw new Error('playwright-core exposed no chromium export')
} catch {
  console.error(
    'playwright-core is not installed. The committed PNGs are already correct, so this script is\n' +
      'only needed when favicon.svg changes:\n\n' +
      '    pnpm --filter web add -D playwright-core\n',
  )
  process.exit(1)
}

const svg = readFileSync(join(publicDir, 'favicon.svg'), 'utf8')

/**
 * The background from the SVG, so a transparent-corner PNG never shows through as white.
 *
 * Keep this in step with the `<rect>` fill in `favicon.svg`. It is the Ledger's light-theme `--ink`
 * (`apps/web/src/styles.css`), not a colour of its own — the icon has no brand accent, by design.
 */
const BACKGROUND = '#15140f'

/**
 * `maskable` wraps the mark in a full-bleed background and scales it to 80%, per the safe-zone
 * rule above. `padding` is a fraction of the canvas.
 */
function pageFor(size, { maskable = false } = {}) {
  const inset = maskable ? size * 0.1 : 0
  const inner = size - inset * 2
  return `<!doctype html><html><body style="margin:0;width:${size}px;height:${size}px;background:${BACKGROUND}">
    <div style="position:absolute;inset:${inset}px;width:${inner}px;height:${inner}px">
      ${svg.replace('<svg', `<svg width="${inner}" height="${inner}"`)}
    </div>
  </body></html>`
}

const TARGETS = [
  { file: 'pwa-192.png', size: 192 },
  { file: 'pwa-512.png', size: 512 },
  { file: 'pwa-512-maskable.png', size: 512, maskable: true },
  // iOS ignores the manifest for the home-screen icon and uses this. It must NOT have transparent
  // corners — iOS applies its own mask and a transparent corner renders black.
  { file: 'apple-touch-icon.png', size: 180 },
]

/**
 * An explicit browser path is **required**, not a convenience.
 *
 * `playwright-core` pins a browser revision and refuses to launch anything else, so on a machine
 * whose Chromium came from somewhere other than `playwright install` — including this project's own
 * container, where one is preinstalled — the revisions will not match and `launch()` fails with
 * "Executable doesn't exist". Pass the path in:
 *
 *     CHROMIUM_PATH=/opt/pw-browsers/chromium-*\/chrome-linux/chrome node scripts/generate-icons.mjs
 */
// biome-ignore lint/suspicious/noUndeclaredEnvVars: script-only, documented directly above
const executablePath = process.env.CHROMIUM_PATH
if (executablePath === undefined || executablePath === '') {
  console.error('Set CHROMIUM_PATH to a Chromium binary. See the comment in this file for why.')
  process.exit(1)
}

const browser = await chromium.launch({ executablePath, args: ['--no-sandbox'] })

for (const { file, size, maskable } of TARGETS) {
  const page = await browser.newPage({
    viewport: { width: size, height: size },
    // Render at 1× exactly: the viewport IS the icon size, so any scale factor would resample.
    deviceScaleFactor: 1,
  })
  await page.setContent(pageFor(size, { maskable }))
  const png = await page.screenshot({ type: 'png', omitBackground: false })
  writeFileSync(join(publicDir, file), png)
  await page.close()
  console.log(`  wrote ${file} (${size}x${size}, ${png.length} bytes)`)
}

await browser.close()
console.log('\nIcons regenerated. Commit the PNGs — they are what ships.')
