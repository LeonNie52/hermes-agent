'use strict'

const { execSync } = require('child_process')
const fs = require('fs')
const path = require('path')

const APP_ROOT = path.resolve(__dirname, '..')
const REPO_ROOT = path.resolve(APP_ROOT, '..', '..')
const RESOURCE_ROOT = path.join(APP_ROOT, 'resources')
const PYTHON_DIR = path.join(RESOURCE_ROOT, 'python')
const SITE_PKGS = path.join(RESOURCE_ROOT, 'site-packages')

const PYTHON_VERSION = '3.11.9'
const PYTHON_URL =
  `https://www.python.org/ftp/python/${PYTHON_VERSION}/python-${PYTHON_VERSION}-embed-amd64.zip`

function maybePrintPythonInfo() {
  const pythonExe = path.join(PYTHON_DIR, 'python.exe')
  if (!fs.existsSync(pythonExe)) return

  const pthFile = `python${PYTHON_VERSION.split('.').slice(0, 2).join('')}._pth`
  const pthPath = path.join(PYTHON_DIR, pthFile)

  try {
    const sha = execSync('cmd /c certutil -hashfile "'
      + pythonExe.replace(/"/g, '') + '" SHA256', {
      encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], cwd: PYTHON_DIR
    }).split('\n')[1]?.trim()
    console.log(`  python.exe SHA256: ${sha}`)
  } catch { }

  if (fs.existsSync(pthPath)) {
    const content = fs.readFileSync(pthPath, 'utf8')
    const hasImportSite = content.includes('import site')
    const hasSitePkgs = content.includes('..\\site-packages')
    console.log(`  ${pthFile}: import site=${hasImportSite} site-packages=${hasSitePkgs}`)
  }
}

function installPython() {
  console.log('[bundle-python] Downloading embedded Python ' + PYTHON_VERSION + ' ...')
  const zipPath = path.join(RESOURCE_ROOT, 'python-embed.zip')

  fs.mkdirSync(RESOURCE_ROOT, { recursive: true })

  const curlCmd = `curl -f --connect-timeout 30 --max-time 600 -L -o "${zipPath}" "${PYTHON_URL}"`
  try {
    execSync(curlCmd, { stdio: 'inherit', timeout: 600_000 })
  } catch (e) {
    try { fs.unlinkSync(zipPath) } catch { }
    throw new Error(`Failed to download Python: ${PYTHON_URL}\n${e.message}`)
  }

  fs.mkdirSync(PYTHON_DIR, { recursive: true })

  execSync(
    `powershell -Command "Expand-Archive -Path '${zipPath}' -DestinationPath '${PYTHON_DIR}' -Force"`,
    { stdio: 'inherit' }
  )

  fs.unlinkSync(zipPath)
  console.log('[bundle-python] Python ' + PYTHON_VERSION + ' installed.')
}

function enableSitePackages() {
  const majorMinor = PYTHON_VERSION.split('.').slice(0, 2).join('')
  const pthPath = path.join(PYTHON_DIR, `python${majorMinor}._pth`)

  if (!fs.existsSync(pthPath)) {
    console.warn(`[bundle-python] Warning: ${pthPath} not found; check Python version.`)
    return
  }

  let lines = fs.readFileSync(pthPath, 'utf8').split('\n')

  const alreadyHasImportSite = lines.some(l => l.trim() === 'import site')
  const alreadyHasSitePkgLine = lines.some(l => l.trim() === '..\\site-packages')
  const alreadyHasHermesLine = lines.some(l => l.trim() === '..\\hermes')

  lines = lines.map(line => line.trim() === '#import site' ? 'import site' : line)

  if (!alreadyHasSitePkgLine) {
    lines.push('..\\site-packages')
  }

  if (!alreadyHasHermesLine) {
    lines.push('..\\hermes')
  }

  fs.writeFileSync(pthPath, lines.join('\n'))

  console.log(
    '[bundle-python] _pth updated:' +
    (!alreadyHasImportSite ? ' site' : '') +
    (!alreadyHasSitePkgLine ? ' site-packages' : '') +
    (!alreadyHasHermesLine ? ' hermes' : ' [already configured]')
  )
}

function installHermesDeps() {
  console.log('[bundle-python] Installing hermes-agent dependencies...')

  fs.mkdirSync(SITE_PKGS, { recursive: true })

  console.log('[bundle-python] Bootstrapping pip via get-pip.py...')
  const getPipUrl = 'https://bootstrap.pypa.io/get-pip.py'
  const getPipPath = path.join(RESOURCE_ROOT, 'get-pip.py')

  const curlCmd = `curl -f --connect-timeout 30 --max-time 120 -L -o "${getPipPath}" "${getPipUrl}"`
  try {
    execSync(curlCmd, { stdio: 'inherit', timeout: 120_000 })
  } catch (e) {
    try { fs.unlinkSync(getPipPath) } catch {}
    throw new Error(`Failed to download get-pip.py: ${getPipUrl}\n${e.message}`)
  }

  execSync(
    `"${path.join(PYTHON_DIR, 'python.exe')}" "${getPipPath}" --no-warn-script-location`,
    { stdio: 'inherit', timeout: 120_000 }
  )

  try { fs.unlinkSync(getPipPath) } catch {}

  const env = { ...process.env, HERMES_NO_BOOTSTRAP: '1' }

  console.log('[bundle-python] Installing hermes-agent[all] dependencies...')
  execSync(
    `"${path.join(PYTHON_DIR, 'python.exe')}" -m pip install ` +
    `"${REPO_ROOT}[all]" ` +
    `--target "${SITE_PKGS}"`,
    { env, stdio: 'inherit', timeout: 600_000 }
  )

  console.log('[bundle-python] Dependencies installed.')
}

function cleanupSourceDuplicates() {
  console.log('[bundle-python] Removing hermes-agent source duplicates from site-packages...')
  const sourcePyModules = [
    'run_agent.py', 'model_tools.py', 'toolsets.py', 'batch_runner.py',
    'trajectory_compressor.py', 'toolset_distributions.py', 'cli.py',
    'hermes_bootstrap.py', 'hermes_constants.py', 'hermes_state.py',
    'hermes_time.py', 'hermes_logging.py', 'utils.py'
  ]
  const sourcePackages = [
    'agent', 'tools', 'gateway', 'tui_gateway', 'cron', 'acp_adapter',
    'plugins', 'providers', 'hermes_cli'
  ]
  const distInfoGlob = 'hermes_agent-*.dist-info'

  let removed = 0
  for (const f of sourcePyModules) {
    const p = path.join(SITE_PKGS, f)
    if (fs.existsSync(p)) { fs.rmSync(p); removed++ }
  }
  for (const d of sourcePackages) {
    const p = path.join(SITE_PKGS, d)
    if (fs.existsSync(p)) { fs.rmSync(p, { recursive: true, force: true }); removed++ }
  }
  const entries = fs.readdirSync(SITE_PKGS)
  for (const e of entries) {
    if (e.startsWith('hermes_agent-') && e.endsWith('.dist-info')) {
      fs.rmSync(path.join(SITE_PKGS, e), { recursive: true, force: true })
      removed++
    }
  }
  console.log(`[bundle-python] Removed ${removed} duplicate entries.`)
}

function verifyBaselineImports() {
  console.log('[bundle-python] Verifying baseline imports...')
  const pythonExe = path.join(PYTHON_DIR, 'python.exe')

  const env = {
    ...process.env,
    PYTHONHOME: PYTHON_DIR,
  }

  try {
    execSync(
      `"${pythonExe}" -c "import dotenv, openai, rich, prompt_toolkit"`,
      { env, stdio: 'pipe', timeout: 30_000 }
    )
    console.log('[bundle-python] Core imports OK.')
  } catch (e) {
    console.error('[bundle-python] Core imports FAILED. Build cannot proceed.')
    throw e
  }

  try {
    execSync(
      `"${pythonExe}" -c "import fastapi, uvicorn"`,
      { env, stdio: 'pipe', timeout: 30_000 }
    )
    console.log('[bundle-python] Dashboard imports OK.')
  } catch (e) {
    console.warn('[bundle-python] Warning: fastapi/uvicorn not importable; hermes dashboard may not work.')
  }

  try {
    execSync(
      `"${pythonExe}" -c "import hermes_cli.main"`,
      { env, stdio: 'pipe', timeout: 30_000 }
    )
    console.log('[bundle-python] hermes_cli.main import OK.')
  } catch (e) {
    console.warn('[bundle-python] Warning: hermes_cli.main not importable; backend may not start.')
  }
}

function main() {
  const pythonExe = path.join(PYTHON_DIR, 'python.exe')
  const needsCleanup = fs.existsSync(path.join(SITE_PKGS, 'hermes_cli')) ||
    fs.existsSync(path.join(SITE_PKGS, 'agent')) ||
    fs.existsSync(path.join(SITE_PKGS, 'run_agent.py'))

  if (fs.existsSync(pythonExe) && !needsCleanup) {
    console.log('[bundle-python] Python already bundled.')
    maybePrintPythonInfo()
    return
  }

  if (!fs.existsSync(pythonExe)) {
    fs.mkdirSync(RESOURCE_ROOT, { recursive: true })
    installPython()
    enableSitePackages()
    installHermesDeps()
    cleanupSourceDuplicates()
    verifyBaselineImports()
  } else if (needsCleanup) {
    console.log('[bundle-python] Running cleanup on existing build...')
    cleanupSourceDuplicates()
  }

  maybePrintPythonInfo()
  console.log('[bundle-python] Bundle complete.')
}

main()
