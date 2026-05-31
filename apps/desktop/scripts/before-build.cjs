/**
 * Desktop bundles ship precompiled renderer assets. Returning false here tells
 * electron-builder to skip the node_modules collector/install step, which
 * avoids workspace dependency graph explosions and keeps packaging
 * deterministic across environments.
 *
 * For `npm run dist:win:bundled`, the Python payload is pre-bundled into
 * `resources/` by `bundle-python.cjs` + `bundle-hermes.cjs` and shipped via
 * `extraResources`.  For the default (non-bundled) `npm run dist:win`, the
 * Electron app fetches the backend at first launch via `install.ps1`'s stage
 * protocol (Windows).  See `electron/main.cjs`.
 */
module.exports = async function beforeBuild() {
  return false
}
