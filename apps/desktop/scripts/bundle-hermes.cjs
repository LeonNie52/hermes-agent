'use strict'

const { execSync } = require('child_process')
const fs = require('fs')
const path = require('path')

const APP_ROOT = path.resolve(__dirname, '..')
const REPO_ROOT = path.resolve(APP_ROOT, '..', '..')
const HERMES_DEST = path.join(APP_ROOT, 'resources', 'hermes')

const EXCLUDE = new Set([
  'node_modules',
  'apps',
  'website',
  'tests',
  'docs',
  '.git',
  '__pycache__',
  '.venv',
  'venv',
  '.pytest_cache',
  '.ruff_cache',
  '.mypy_cache',
  'dist',
  'build',
  'release',
  'resources',
])

const EXCLUDE_SUFFIX = ['.pyc', '.egg-info']

function shouldExclude(name) {
  if (EXCLUDE.has(name)) return true
  if (name.startsWith('.')) return true
  return EXCLUDE_SUFFIX.some(s => name.endsWith(s))
}

function copyDir(src, dest) {
  fs.mkdirSync(dest, { recursive: true })
  const entries = fs.readdirSync(src, { withFileTypes: true })

  for (const entry of entries) {
    const srcPath = path.join(src, entry.name)
    const destPath = path.join(dest, entry.name)

    if (shouldExclude(entry.name)) continue

    if (entry.isDirectory()) {
      copyDir(srcPath, destPath)
    } else if (entry.isFile()) {
      fs.mkdirSync(path.dirname(destPath), { recursive: true })
      fs.copyFileSync(srcPath, destPath)
    }
  }
}

function main() {
  console.log('[bundle-hermes] Ensuring submodules are checked out...')
  try {
    execSync('git submodule update --init --recursive', {
      cwd: REPO_ROOT,
      stdio: 'inherit',
      timeout: 60_000
    })
  } catch (e) {
    console.warn('[bundle-hermes] Warning: submodule update failed (continuing)')
  }

  console.log('[bundle-hermes] Copying hermes-agent source...')

  if (fs.existsSync(HERMES_DEST)) {
    fs.rmSync(HERMES_DEST, { recursive: true, force: true })
  }

  copyDir(REPO_ROOT, HERMES_DEST)
  console.log('[bundle-hermes] Done.')
}

main()
