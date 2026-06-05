'use strict'

const { execSync } = require('child_process')
const fs = require('fs')
const path = require('path')

const APP_ROOT = path.resolve(__dirname, '..')
const RESOURCE_ROOT = path.join(APP_ROOT, 'resources')
const GIT_DIR = path.join(RESOURCE_ROOT, 'git')

const GIT_VERSION = '2.54.0.windows.1'
const GIT_URL =
  `https://github.com/git-for-windows/git/releases/download/v${GIT_VERSION}/PortableGit-2.54.0-64-bit.7z.exe`

function main() {
  const bashExe = path.join(GIT_DIR, 'bin', 'bash.exe')
  if (fs.existsSync(bashExe)) {
    console.log('[bundle-git] PortableGit already bundled, skipping.')
    return
  }

  fs.mkdirSync(RESOURCE_ROOT, { recursive: true })

  const installerPath = path.join(RESOURCE_ROOT, 'PortableGit.7z.exe')
  console.log(`[bundle-git] Downloading PortableGit ${GIT_VERSION} ...`)

  const curlCmd =
    `curl -f --connect-timeout 30 --max-time 600 -L -o "${installerPath}" "${GIT_URL}"`
  try {
    execSync(curlCmd, { stdio: 'inherit', timeout: 600_000 })
  } catch (e) {
    try { fs.unlinkSync(installerPath) } catch {}
    throw new Error(`Failed to download PortableGit: ${GIT_URL}\n${e.message}`)
  }

  console.log('[bundle-git] Extracting PortableGit ...')
  fs.mkdirSync(GIT_DIR, { recursive: true })

  execSync(
    `"${installerPath}" -o"${GIT_DIR}" -y`,
    { stdio: 'inherit', timeout: 300_000 }
  )

  fs.unlinkSync(installerPath)

  if (fs.existsSync(bashExe)) {
    console.log('[bundle-git] PortableGit installed.')
    try {
      const ver = execSync(`"${bashExe}" --version`, {
        encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], timeout: 5000
      }).trim().split('\n')[0]
      console.log(`  bash: ${ver}`)
    } catch {}
  } else {
    console.warn('[bundle-git] Warning: bash.exe not found after extraction.')
  }
}

main()
