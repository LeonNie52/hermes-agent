'use strict'

/**
 * test-bundled-paths.cjs
 *
 * Verifies that apps/desktop/electron/main.cjs's "bundled Python" resolver
 * (step 3 of resolveHermesBackend + ensureBundledEnvironment) points at
 * the paths electron-builder actually stages to in a packaged app.
 *
 * The bug this guards against: writing path.join(process.resourcesPath,
 * 'resources', 'python') when process.resourcesPath IS the resources
 * directory. The result is a non-existent path, the bundled-backend
 * resolver returns false, control falls through to bootstrap-needed,
 * and bootstrap-runner.cjs reaches out to raw.githubusercontent.com to
 * fetch install.ps1 on every launch -- a 30s stall + hard network
 * requirement that contradicts the whole point of bundling.
 *
 * Run from apps/desktop/ after a `dist:win:bundled`:
 *   node scripts/test-bundled-paths.cjs
 *
 * Exits 0 if every expected path exists AND every path-construction
 * line in main.cjs's bundle feature uses the correct segment (no extra
 * 'resources' between resourcesPath and the resource name). Exits 1
 * otherwise, with a diagnostic on the first failure.
 */

const fs = require('node:fs')
const path = require('node:path')

const APP_ROOT = path.resolve(__dirname, '..')
const MAIN_CJS = path.join(APP_ROOT, 'electron', 'main.cjs')

// Default to a freshly-built release/win-unpacked so this script is
// useful right after `dist:win:bundled`. HERMES_TEST_RESOURCES can
// override (e.g. for CI pointing at an installed app's resources dir).
const RESOURCE_ROOT = process.env.HERMES_TEST_RESOURCES
  ? path.resolve(process.env.HERMES_TEST_RESOURCES)
  : path.join(APP_ROOT, 'release', 'win-unpacked', 'resources')

let failures = 0

function check(label, ok, detail) {
  if (ok) {
    console.log(`  PASS  ${label}`)
  } else {
    console.log(`  FAIL  ${label}${detail ? '\n        ' + detail : ''}`)
    failures += 1
  }
}

console.log(`Verifying bundled-backend path logic in main.cjs`)
console.log(`Resource root: ${RESOURCE_ROOT}\n`)

// --- 1. Static check: source must not contain the double-'resources'
//     path bug. The defensive grep catches a regression of the exact
//     shape we introduced and then had to fix. ----------------------------

console.log('[1] Source-level guards (no double-resources paths)')
const source = fs.readFileSync(MAIN_CJS, 'utf8')

// Bundle feature introduced a small set of path patterns. None of them
// should have an extra 'resources' segment between process.resourcesPath
// and the resource name.
const forbiddenRe = /process\.resourcesPath\s*,\s*'resources'\s*,/g
const forbiddenMatches = source.match(forbiddenRe) || []
check(
  `no path.join(process.resourcesPath, 'resources', ...) in main.cjs`,
  forbiddenMatches.length === 0,
  forbiddenMatches.length
    ? `found ${forbiddenMatches.length} occurrence(s); the path is double-prefixed`
    : null
)

// --- 2. Runtime check: paths main.cjs constructs at runtime must
//     resolve to files that actually exist in a packaged build. ---------

console.log('\n[2] Runtime path expectations (mirror of step 3 + ensureBundledEnvironment)')
if (!fs.existsSync(RESOURCE_ROOT)) {
  check(`resource root exists: ${RESOURCE_ROOT}`, false, 'run `dist:win:bundled` first')
  process.exit(1)
}

// Mirror the path construction from main.cjs:
//   process.resourcesPath === RESOURCE_ROOT in a packaged app
const expected = {
  'python.exe':                path.join(RESOURCE_ROOT, 'python', 'python.exe'),
  'python311.dll':             path.join(RESOURCE_ROOT, 'python', 'python311.dll'),
  'python311._pth':            path.join(RESOURCE_ROOT, 'python', 'python311._pth'),
  'hermes/hermes_cli/main.py': path.join(RESOURCE_ROOT, 'hermes', 'hermes_cli', 'main.py'),
  'site-packages/':            path.join(RESOURCE_ROOT, 'site-packages'),
  'git/bin/bash.exe':          path.join(RESOURCE_ROOT, 'git', 'bin', 'bash.exe'),
  'git/cmd/git.exe':           path.join(RESOURCE_ROOT, 'git', 'cmd', 'git.exe')
}

for (const [label, p] of Object.entries(expected)) {
  const kind = fs.existsSync(p) && fs.statSync(p).isDirectory() ? 'dir' : 'file'
  check(`${label} (${kind}) exists`, fs.existsSync(p), `expected at ${p}`)
}

// --- 3. The exact buggy paths must NOT exist (defense against a future
//     edit that re-introduces the double-resources pattern). -----------

console.log("\n[3] Negative guards (double-prefixed paths must NOT exist)")
const bogus = {
  'python at /resources/resources/python/':     path.join(RESOURCE_ROOT, 'resources', 'python'),
  'hermes at /resources/resources/hermes/':     path.join(RESOURCE_ROOT, 'resources', 'hermes'),
  'site-packages at /resources/resources/.../': path.join(RESOURCE_ROOT, 'resources', 'site-packages')
}
for (const [label, p] of Object.entries(bogus)) {
  check(`${label} absent`, !fs.existsSync(p), `would be a regression`)
}

console.log('')
if (failures === 0) {
  console.log('All checks passed.')
  process.exit(0)
} else {
  console.log(`${failures} check(s) failed.`)
  process.exit(1)
}
