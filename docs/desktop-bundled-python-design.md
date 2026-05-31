# 方案 A：嵌入式 Python 完整实现设计

## 背景与目的

### 当前架构的问题

`bb/gui` 分支的 Hermes Desktop（`Hermes.exe`）目前是一个**不完整的桌面应用**：

```
┌─────────────────────────────────────┐
│  Hermes.exe (Electron)              │
│  - React 桌面 UI ✓                   │
│  - 终端模拟 (node-pty) ✓              │
│  - 后端进程管理 ✓                     │
│  - Dashboard web 服务 ✓              │
│  - 首次启动时下载安装 Python 环境 ✗   │  ← 用户必须等待 install.ps1
└─────────────────────────────────────┘
              │ spawn (启动时运行 install.ps1)
              ▼
    install.ps1 -Stage <name> -NonInteractive -Json
              │
              ├─ Stage-Python       下载 Python embeddable
              ├─ Stage-Venv         创建虚拟环境
              ├─ Stage-Deps         pip install -e .
              ├─ Stage-Desktop      构建 node-pty 等原生模块
              └─ Stage-BrowserTools 安装浏览器驱动
```

**核心问题：**
1. **首次启动体验差** — 用户下载安装包后，打开应用还需要等待 5-10 分钟安装 Python 依赖
2. **必须联网** — 即使是已经安装过 hermes CLI 的用户，桌面 app 仍然会触发 bootstrap
3. **分叉维护** — `hermes` 有两条安装路径：`install.ps1`（CLI）和 `Electron bootstrap`（桌面），两者需要保持同步
4. **不可离线分发** — 无法将 Hermes 打包成真正的"一键安装"应用

### Hermes Desktop 的定位

Hermes Desktop 的核心价值在于：

- **跨平台的本地桌面 UI** — 比 CLI 更友好的交互界面
- **内置终端模拟** — node-pty 驱动的真实 PTY，支持交互式命令
- **与操作系统深度集成** — 系统托盘、通知、本地文件访问
- **统一的用户体验** — 无需用户手动配置 Python 环境

因此 Hermes Desktop **应该是一个完整的、独立的桌面应用**，而不是一个需要用户手动完成安装的半成品。

### 用户期望 vs 现状

| 维度 | 用户期望 | 现状 |
|------|----------|------|
| 下载后首次使用 | 双击即用 | 必须等待 5-10 分钟安装 |
| 网络要求 | 可选（离线也能用）| 首次必须联网下载依赖 |
| 安装包大小 | 独立分发，无需额外依赖 | ~114MB installer + 后续下载 |
| 更新体验 | 内置自动更新 | 需要 `hermes update` 或重新安装 |
| 多用户环境 | 每个用户独立环境 | 共享同一 hermes 安装 |

### 目标

本方案旨在将 Hermes Desktop 打造成**真正的独立桌面应用**：

1. **开箱即用** — 下载、安装、双击运行，无需任何额外步骤
2. **离线可用** — 包含完整 Python 运行时和 hermes-agent 代码
3. **隔离更新** — 通过 electron-updater 更新整个应用，而非依赖 npm/pip
4. **统一版本** — 桌面版和 CLI 版使用完全相同的 hermes-agent 代码，只是分发方式不同

### 实现思路

将 Python 运行时和 hermes-agent 代码**嵌入到 Electron 应用包中**，实现真正的独立分发：

```
Hermes.exe (完整打包)
├── app.asar                 # React UI + Electron 代码
├── resources/
│   ├── python/              # 便携 Python 3.11 embeddable
│   ├── hermes/              # hermes-agent 源代码（固定版本快照）
│   └── site-packages/       # Python 依赖（预安装）
├── native-deps/             # node-pty 等原生模块
└── install-stamp.json       # 构建版本信息
```

用户数据（配置、会话、技能）仍然存储在 `%LOCALAPPDATA%\hermes\`，与应用包分离。

### 方案对比

| 方案 | 首次启动 | 离线可用 | 实现复杂度 | 安装包增量 |
|------|----------|----------|------------|------------|
| **A: 嵌入式 Python** | 即开即用 | 是 | 中等 | ~200MB |
| B: PyInstaller 打包 | 即开即用 | 是 | 高（需处理动态路径）| ~100MB |
| C: 保持现状 | 5-10 分钟 | 否 | 低 | 无增量 |

**选择方案 A 的理由：**
- 对用户友好：真正的一键安装体验
- 对开发者友好：代码路径与 CLI 基本一致，不需要 PyInstaller 的复杂 hack
- 可控性高：Python 版本、依赖版本完全在构建时确定
- 扩展性高：可以进一步优化（如增量更新、选择性嵌入可选依赖）

## 整体架构

```
Hermes.exe (Electron asar)
├── app.asar                 # React UI + Electron 代码
├── native-deps/             # node-pty 等原生模块
└── install-stamp.json

%LOCALAPPDATA%\hermes\       # 用户数据（首次安装后创建）
├── .env                     # API keys
├── config.yaml
├── sessions/
├── skills/                  # 用户安装的技能
└── logs/

Hermes.exe 内嵌（不暴露给用户）：
└── resources/
    ├── python/              # 便携 Python 3.11
    │   ├── python.exe
    │   └── ...
    ├── hermes/              # 源代码（固定版本快照，不跟随 git）
    │   ├── run_agent.py
    │   ├── tools/
    │   ├── agent/
    │   ├── hermes_cli/
    │   └── ...
    └── site-packages/       # pip install -t 导出的依赖
        ├── anthropic/
        ├── openai/
        ├── fastapi/
        └── ...
```

## 目录结构设计

```
apps/desktop/
├── resources/               # 新增：打包时放入 extraResources
│   ├── python/              # 嵌入式 Python
│   ├── hermes/              # hermes-agent 源代码（固定版本快照）
│   └── site-packages/       # Python 依赖
├── scripts/
│   ├── bundle-python.cjs    # 新增：下载 Python + 安装依赖
│   ├── bundle-hermes.cjs    # 新增：打包 hermes 源代码
│   ├── stage-native-deps.cjs # 已有
│   └── write-build-stamp.cjs # 已有
└── package.json
    └── build:
        extraResources:
          - from: resources/
            to: resources/
```

## 实现步骤

---

### Step 1：新增构建脚本 `scripts/bundle-python.cjs`

**职责：**
1. 下载嵌入式 Python（Windows embeddable zip）
2. 解压到 `apps/desktop/resources/python/`
3. 安装 hermes-agent 及所有依赖到 `site-packages/`

```javascript
// scripts/bundle-python.cjs
// 运行时机：在 electron-builder 之前，由 npm run dist:win 调用

const { execSync } = require('child_process')
const fs = require('fs')
const path = require('path')
const https = require('https')
const zlib = require('zlib')
const { pipeline } = require('stream')

const APP_ROOT = path.resolve(__dirname, '..')
const REPO_ROOT = path.resolve(APP_ROOT, '..', '..')
const RESOURCE_ROOT = path.join(APP_ROOT, 'resources')
const PYTHON_DIR = path.join(RESOURCE_ROOT, 'python')
const HERMES_DIR = path.join(RESOURCE_ROOT, 'hermes')
const SITE_PKGS = path.join(RESOURCE_ROOT, 'site-packages')

const PYTHON_VERSION = '3.11.9'  // 与 install.ps1 保持 major 一致（uv 安装 3.11）
// 具体 patch 版本需与 python.org 发布的 embeddable zip 对应
const PYTHON_URL = `https://www.python.org/ftp/python/${PYTHON_VERSION}/python-${PYTHON_VERSION}-embed-amd64.zip`

// 1. 下载并解压嵌入式 Python
function installPython() {
  console.log('[bundle-python] Downloading embedded Python...')
  const zipPath = path.join(RESOURCE_ROOT, 'python-embed.zip')

  // 下载（使用 curl，保持与 install.ps1 一致）
  execSync(`curl -L -o "${zipPath}" "${PYTHON_URL}"`, { stdio: 'inherit' })

  // 解压到 python/ 目录
  fs.mkdirSync(PYTHON_DIR, { recursive: true })
  execSync(`powershell -Command "Expand-Archive -Path '${zipPath}' -DestinationPath '${PYTHON_DIR}' -Force"`, { stdio: 'inherit' })

  fs.unlinkSync(zipPath)
  console.log('[bundle-python] Python installed.')
}

// 2. 修改 python3xx._pth 以允许 site-packages
// 嵌入式 Python 默认不加载 site-packages，需要显式启用并添加路径
function enableSitePackages() {
  // _pth 文件名取决于 Python 版本: python311._pth, python312._pth 等
  const majorMinor = PYTHON_VERSION.split('.').slice(0, 2).join('')
  const pthPath = path.join(PYTHON_DIR, `python${majorMinor}._pth`)

  if (!fs.existsSync(pthPath)) {
    console.warn(`[bundle-python] Warning: ${pthPath} not found; check Python version.`)
    return
  }

  const lines = fs.readFileSync(pthPath, 'utf8').split('\n')

  // 1. 取消注释 import site
  const modified = lines.map(line =>
    line.trim() === '#import site' ? 'import site' : line
  )

  // 2. 添加 site-packages 路径（相对于 python.exe 所在目录）
  //    嵌入式 Python 的 _pth 控制 sys.path，必须显式指定
  //    使用 ..\site-packages 因为 site-packages 与 python/ 同级
  const sitePkgsLine = '..\\site-packages'
  if (!modified.some(line => line.trim() === sitePkgsLine)) {
    modified.push(sitePkgsLine)
  }

  fs.writeFileSync(pthPath, modified.join('\n'))
}

// 3. 安装 hermes-agent 依赖到 site-packages
function installHermesDeps() {
  console.log('[bundle-python] Installing hermes-agent dependencies...')

  // 创建 site-packages 目录
  fs.mkdirSync(SITE_PKGS, { recursive: true })

  // 嵌入式 Python 默认不含 pip，需先安装 pip
  console.log('[bundle-python] Bootstrapping pip...')
  execSync(
    `"${path.join(PYTHON_DIR, 'python.exe')}" -m ensurepip --default-pip`,
    { stdio: 'inherit' }
  )

  // 设置环境变量，pyproject.toml 构建不需要 PYTHONPATH
  const env = {
    ...process.env,
    // 注意：HERMES_NO_BOOTSTRAP 当前在代码库中未被任何 Python 代码检查，
    // 仅作为未来实现的预留。实际防 bootstrap 依赖 electron main.cjs 侧的判断。
    HERMES_NO_BOOTSTRAP: '1',
  }

  // 从 pyproject.toml 读取依赖列表并安装到 site-packages
  // 使用 pip install --target 而非 -e，避免生成 .pth 文件干扰系统 Python
  const repoRoot = path.resolve(APP_ROOT, '..', '..')
  execSync(
    `"${path.join(PYTHON_DIR, 'python.exe')}" -m pip install ` +
    `"${repoRoot}[all]" ` +  // 安装 hermes-agent[all]（对标 install.ps1 的 uv sync --extra all）
    `--target "${SITE_PKGS}" ` +
    `--python-version ${PYTHON_VERSION.split('.').slice(0, 2).join('.')}`,
    { env, stdio: 'inherit' }
  )

  console.log('[bundle-python] Dependencies installed.')
}

// 4. 基准导入验证（对标 install.ps1 的 baseline-import gate）
//    确保关键包在 site-packages 中可导入，及早发现构建问题
function verifyBaselineImports() {
  console.log('[bundle-python] Verifying baseline imports...')

  const env = {
    ...process.env,
    PYTHONPATH: [HERMES_DIR, SITE_PKGS].filter(Boolean).join(path.delimiter),
    PYTHONHOME: PYTHON_DIR,
  }

  // 核心依赖验证（与 install.ps1 一致：dotenv, openai, rich, prompt_toolkit）
  try {
    execSync(
      `"${path.join(PYTHON_DIR, 'python.exe')}" -c "import dotenv, openai, rich, prompt_toolkit"`,
      { env, stdio: 'pipe', timeout: 30000 }
    )
    console.log('[bundle-python] Core imports OK.')
  } catch (e) {
    console.error('[bundle-python] Core imports FAILED. Build cannot proceed.')
    throw e
  }

  // Dashboard 依赖验证（fastapi + uvicorn，对标 install.ps1 的 web-import check）
  try {
    execSync(
      `"${path.join(PYTHON_DIR, 'python.exe')}" -c "import fastapi, uvicorn"`,
      { env, stdio: 'pipe', timeout: 30000 }
    )
    console.log('[bundle-python] Dashboard imports OK.')
  } catch (e) {
    console.warn('[bundle-python] Warning: fastapi/uvicorn not importable; hermes dashboard may not work.')
  }
}

function main() {
  if (fs.existsSync(path.join(PYTHON_DIR, 'python.exe'))) {
    console.log('[bundle-python] Python already bundled, skipping.')
    return
  }

  fs.mkdirSync(RESOURCE_ROOT, { recursive: true })
  installPython()
  enableSitePackages()
  installHermesDeps()
  verifyBaselineImports()

  console.log('[bundle-python] Bundle complete.')
}

main()
```

**修改 `package.json` 构建脚本：**

`bundle-python.cjs` 和 `bundle-hermes.cjs` 应作为 `dist:win` 等分发脚本的前置步骤，
而非加在 `build` 脚本中（`build` 用于开发构建，不需要嵌入 Python）。

```json
{
  "scripts": {
    "build": "tsc -b && vite build",
    "dist:win": "node scripts/bundle-python.cjs && node scripts/bundle-hermes.cjs && node scripts/stage-native-deps.cjs && node scripts/write-build-stamp.cjs && npm run build && electron-builder --win"
  }
}
```

---

### Step 2：新增打包脚本 `scripts/bundle-hermes.cjs`

**职责：** 
1. 确保 submodule 已 checkout（`git submodule update --init --recursive`）
2. 复制 hermes-agent 源代码到 `resources/hermes/`，排除不需要的文件（tests、docs、node_modules 等）

```javascript
// scripts/bundle-hermes.cjs

const fs = require('fs')
const path = require('path')

const APP_ROOT = path.resolve(__dirname, '..')
const REPO_ROOT = path.resolve(APP_ROOT, '..', '..')
const HERMES_SRC = REPO_ROOT
const HERMES_DEST = path.join(APP_ROOT, 'resources', 'hermes')

// 需要排除的文件/目录（与打包无关或体积大）
// 注意：readdirSync 返回的名称不含尾部斜杠
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
  'resources',  // apps/desktop/resources/ 已在上面被 apps 排除
])

// 需要按扩展名/后缀排除的模式
const EXCLUDE_GLOB = ['.pyc', '.egg-info']

function shouldExclude(name) {
  if (EXCLUDE.has(name)) return true
  if (name.startsWith('.')) return true
  return EXCLUDE_GLOB.some(pattern => name.endsWith(pattern))
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
      fs.copyFileSync(srcPath, destPath)
    }
  }
}

function main() {
  console.log('[bundle-hermes] Ensuring submodules are checked out...')
  // install.ps1 的 Stage-Repository 运行 `git submodule update --init --recursive`
  // bundled 源码快照不会自动包含 submodule 内容，需要在复制前确保 checkout
  try {
    execSync('git submodule update --init --recursive', {
      cwd: HERMES_SRC,
      stdio: 'inherit',
      timeout: 60000
    })
  } catch (e) {
    console.warn('[bundle-hermes] Warning: submodule update failed (continuing)')
  }

  console.log('[bundle-hermes] Copying hermes-agent source...')
  copyDir(HERMES_SRC, HERMES_DEST)
  console.log('[bundle-hermes] Done.')
}

main()
```

---

### Step 3：修改 `main.cjs` 后端解析逻辑

**文件：** `apps/desktop/electron/main.cjs`

**改动 1：新增 bundled backend 类型（在开发源检查之后、PATH 检查之前）**

```javascript
// 约 line 1250 附近（isHermesSourceRoot 分支之后），在 resolveHermesBackend 函数中
// bundled backend 优先级：排在 dev source 之后，排在 PATH / system Python 之前，
// 确保打包后的应用优先使用内置 Python，而非可能过时的系统安装

// 2.5. Bundled Python -- embedded Python shipped inside the app package.
//   Activated only when packaged (app.asar exists); in dev mode with a
//   source checkout, step 2 picks up the live Python code instead.
//   This must come BEFORE steps 3-5 (bootstrap-complete, hermes on PATH,
//   system Python) so a packaged app always uses its bundled runtime
//   rather than a potentially-stale system install.
if (IS_PACKAGED) {
  const bundledPython = path.join(
    process.resourcesPath,
    'resources',
    'python',
    'python.exe'
  )

  if (fileExists(bundledPython)) {
    const bundledHermes = path.join(
      process.resourcesPath,
      'resources',
      'hermes'
    )
    const bundledSitePackages = path.join(
      process.resourcesPath,
      'resources',
      'site-packages'
    )
    const bundledPythonHome = path.join(
      process.resourcesPath,
      'resources',
      'python'
    )

    return {
      kind: 'bundled',
      command: bundledPython,
      args: ['-m', 'hermes_cli.main', ...dashboardArgs],
      env: {
        PYTHONHOME: bundledPythonHome,
        PYTHONPATH: [bundledHermes, bundledSitePackages, process.env.PYTHONPATH]
          .filter(Boolean).join(path.delimiter),
        HERMES_HOME,  // 继承 Electron 侧解析的 HERMES_HOME
        HERMES_BUNDLED: '1',
        HERMES_RESOURCES: path.join(process.resourcesPath, 'resources'),
      },
      shell: false,
      label: 'Bundled Python (embedded)',
      root: bundledHermes,
      bootstrap: false,
    }
  }
}
```

**改动 2：修改后端启动路径计算（无需修改）**

`createActiveBackend` 和 `createPythonBackend` 接收 `root` 参数并设置 `PYTHONPATH`。
bundled backend 在返回值中直接设置了 `PYTHONPATH`，因此 `createActiveBackend` 不需要特殊处理。

现有代码中 `createActiveBackend` 的 `const root = backend.root || ACTIVE_HERMES_ROOT` 默认行为
对 bundled backend 是安全的——`backend.root` 已设为 `bundledHermes`。

**改动 3：跳过 bootstrap 条件增强**

```javascript
// 约 line 1375 ensureRuntime 函数中
// bundled 模式永远不需要 bootstrap
async function ensureRuntime(backend) {
  if (backend.kind === 'bundled' || !backend.bootstrap) {
    await advanceBootProgress('runtime.external', `Using ${backend.label}`, 32)
    return backend
  }

  if (backend.kind === 'bootstrap-needed') {
    // ... 原有的 bootstrap 逻辑 ...
  }
}
```

---

### Step 4：修改 `package.json` extraResources 配置

```json
{
  "build": {
    "extraResources": [
      {
        "from": "build/native-deps",
        "to": "native-deps"
      },
      {
        "from": "build/install-stamp.json",
        "to": "install-stamp.json"
      },
      {
        "from": "resources",
        "to": "resources",
        "filter": ["**/*"]
      }
    ]
  }
}
```

---

### Step 5：处理 hermes-agent 入口点

**问题：** bundled Python 需要以模块方式运行 hermes-agent，但与 dev 模式使用相同的入口点。

**方案：** 使用 `-m hermes_cli.main` 入口（与现有 `createPythonBackend` 一致），无需额外包装。

```javascript
// main.cjs 中 bundled backend 的 args（使用与 createPythonBackend 一致的入口）
args: [
  '-m', 'hermes_cli.main',
  'dashboard',
  '--no-open',
  '--tui',
  '--host', '127.0.0.1',
  '--port', String(port)
]
```

**注意：** `hermes_cli.main` 存在于 `pyproject.toml` 的 `py-modules` 列表中，
复制到 `resources/hermes/hermes_cli/` 后可通过 `PYTHONPATH` 找到。
不需要创建 `hermes/__main__.py`（代码库中没有 `hermes/` 包，该模式不适用）。

---

### Step 6：处理 .env 和 config 路径

**关键点：** bundled 模式下 HERMES_HOME 由 Electron 侧 `resolveHermesHome()` 决定
（Windows: `%LOCALAPPDATA%\hermes`），并通过 spawn env 传入 Python 进程。
`get_hermes_home()` 读取 `HERMES_HOME` 环境变量，因此路径一致。

```javascript
// main.cjs 中 spawn 时确保 HERMES_HOME 正确
env: {
  ...process.env,
  HERMES_HOME,  // 已由 resolveHermesHome() 解析为 %LOCALAPPDATA%\hermes
  HERMES_BUNDLED: '1',
  HERMES_RESOURCES: path.join(process.resourcesPath, 'resources'),
  PYTHONHOME: bundledPythonHome,
  PYTHONPATH: [...],
}
```

**确保 `hermes_constants.py` 能正确读取 `HERMES_HOME`：**

`get_hermes_home()` 已在 OS 层读取 `HERMES_HOME` 环境变量（line 63），无需修改。

---

### Step 7：处理需要运行时动态获取的信息

**install-stamp.json 的读取：**

```javascript
// install-stamp.json 在 extraResources 中映射为 install-stamp.json
// 运行时路径：path.join(process.resourcesPath, 'install-stamp.json')
const stampPath = path.join(process.resourcesPath, 'install-stamp.json')
if (fs.existsSync(stampPath)) {
  const stamp = JSON.parse(fs.readFileSync(stampPath, 'utf8'))
}
```

**注意：** `install-stamp.json` 通过 `extraResources` 直接放在 resources 根目录
（`build/install-stamp.json` → `install-stamp.json`），不在 `resources/` 子目录下。
避免与 `resources/` extraResources 的路径混淆。

**版本信息：**

```javascript
// hermes --version 在 bundled 模式下应正常工作
// 版本号从 install-stamp.json 获取，而非依赖 Python 包的 __version__
```

---

### Step 8：构建流程整合

**新的 `npm run dist:win` 流程：**

```
1. bundle-python          下载嵌入式 Python + 安装依赖（新增）
2. bundle-hermes          复制 hermes 源代码（新增）
3. stage-native-deps      复制 node-pty 到 build/native-deps
4. write-build-stamp      生成 install-stamp.json
5. tsc -b                 TypeScript 编译
6. vite build             前端构建
7. electron-builder --win 打包（包含 resources/）
```

**开发构建 `npm run build`：**

```
1. tsc -b                 TypeScript 编译
2. vite build             前端构建
```

开发模式下不使用 bundled Python，直接通过 `resolveHermesBackend` 的第 2 步
找到开发源码根目录并 spawn 系统 Python，与现有行为一致。

---

### 与 `install.ps1` 的功能对标分析

`install.ps1` 除了安装 Python 依赖外，还处理以下事项。bundled 方案需要逐一覆盖：

| install.ps1 阶段 | 对应处理 | bundled 方案状态 |
|---|---|---|
| **Stage-uv** | 安装 uv 包管理器 | **无需处理** — 构建时用 pip，运行时不需要 uv |
| **Stage-git** | 安装 PortableGit（含 bash.exe） | **需要处理** — `terminal` 工具在 Windows 上依赖 bash.exe |
| **Stage-node** | 安装 Node.js | **需要处理** — 浏览器工具依赖 npm + npx |
| **Stage-system-packages** | ripgrep + ffmpeg | **运行时检查** — 可选，降级优雅 |
| **Stage-repository** | 克隆源码 + `git submodule update` | **需要处理** — 源码快照不包含 submodule 内容 |
| **Stage-venv** | 创建 venv | **无需处理** — 使用嵌入式 Python 直连 site-packages |
| **Stage-dependencies** | pip install hermes-agent + extras | **已处理** — 构建时 `pip install --target` |
| **Stage-node-deps** | npm install + playwright install chromium | **需要处理** — 浏览器工具运行依赖 |
| **Stage-desktop** | 构建 Electron 桌面应用 | **无需处理** — 应用本身就是打包产物 |
| **Stage-path** | 添加 hermes 到 PATH | **无需处理** — 无独立 CLI |
| **Stage-config-templates** | 创建 HERMES_HOME 目录、.env、config.yaml、skills sync | **需要处理** — 首次运行必需 |
| **Stage-platform-sdks** | 安装 messaging SDKs | **运行时检查** — 按需安装 |
| **Stage-bootstrap-marker** | 写 `.hermes-bootstrap-complete` | **可选** — 防止重复初始化 |

---

### Step 9：首次运行初始化（对标 install.ps1 的 post-install 阶段）

bundled 模式下，以下资源不在 bundle 中但首次运行必需：

#### 9a. HERMES_HOME 目录结构

```javascript
// main.cjs 中，在 spawn bundled backend 之前确保目录结构存在
function ensureHermesHomeStructure() {
  const dirs = [
    'cron', 'sessions', 'logs', 'pairing', 'hooks',
    'image_cache', 'audio_cache', 'memories', 'skills'
  ]
  for (const dir of dirs) {
    fs.mkdirSync(path.join(HERMES_HOME, dir), { recursive: true })
  }
}
```

#### 9b. Git / bash.exe（terminal 工具依赖）

Windows 上 `terminal` 工具需要 bash.exe（来自 Git for Windows）。有两种策略：

**策略 A（推荐）：在 Electron 侧安装 PortableGit**（与 install.ps1 一致）

```javascript
// 首次运行时检查 bash.exe 是否存在；不存在则下载 PortableGit
async function ensureGitBash() {
  const gitDir = path.join(HERMES_HOME, 'git')
  const bashExe = path.join(gitDir, 'bin', 'bash.exe')
  if (fs.existsSync(bashExe)) return bashExe

  // 下载 PortableGit（与 install.ps1 同样的 URL + 版本）
  const url = `https://github.com/git-for-windows/git/releases/download/v2.54.0.windows.1/PortableGit-2.54.0-64-bit.7z.exe`
  // ... 下载、解压、设置 HERMES_GIT_BASH_PATH ...
}
```

**策略 B：依赖用户系统已有 Git** — 检测 PATH 上的 `bash.exe`，未找到时降级提示。

选择策略 A 以保证离线体验一致。bash.exe (~50MB) 可考虑在构建时嵌入，或在首次运行时下载并缓存到 `HERMES_HOME/git/`。

#### 9c. Node.js 和浏览器工具

```javascript
// 浏览器工具（agent-browser + Playwright Chromium）是可选的；
// 首次使用 browser_* 工具时按需安装（或首次启动时后台安装）
async function ensureBrowserTools() {
  // 若用户已有 Node.js，在 HERMES_HOME 侧按 install.ps1 模式安装
  const nodeDir = path.join(HERMES_HOME, 'node')
  // ... install agent-browser, playwright chromium ...
}
```

**注意：** Playwright Chromium 约 170MB，不适合嵌入。应在首次运行时下载并缓存到 `%LOCALAPPDATA%\ms-playwright\`（Playwright 的默认路径）。

#### 9d. Skills 同步

```javascript
// 首次运行时将 bundled 技能同步到 HERMES_HOME/skills/
async function syncBundledSkills() {
  const bundledSkillsDir = path.join(
    process.resourcesPath, 'resources', 'hermes', 'skills'
  )
  const userSkillsDir = path.join(HERMES_HOME, 'skills')
  // 调用 Python: python -m tools.skills_sync --source <bundled> --dest <user>
}
```

或简化为：首次运行时使用文件清单比较，将 bundled skills 中没有冲突的文件复制过去。

#### 9e. Submodules

`install.ps1` 运行 `git submodule update --init --recursive`。bundled 源码快照不自动包含 submodule 内容，需要在 `bundle-hermes.cjs` 中处理：

```javascript
// bundle-hermes.cjs 中额外处理
function copySubmodules() {
  // .gitmodules 文件列出了 submodule 路径
  const gitmodulesPath = path.join(HERMES_SRC, '.gitmodules')
  if (!fs.existsSync(gitmodulesPath)) return

  // 解析 .gitmodules 中的 path 字段
  // 对每个 submodule path，复制其内容到资源目录
}
```

或者更简单：在 CI 构建前运行 `git submodule update --init --recursive`，然后复制时 submodule 目录已有内容。

#### 9f. 首次运行启动流程

```javascript
// main.cjs 中 bundled backend 启动的完整流程
async function startBundledBackend(dashboardArgs) {
  const backend = resolveHermesBackend(dashboardArgs)  // kind === 'bundled'

  // 1. 确保 HERMES_HOME 目录结构
  ensureHermesHomeStructure()

  // 2. 确保 .env 和 config.yaml 存在（从模板复制，与 install.ps1 的 Copy-ConfigTemplates 一致）
  await ensureConfigFiles()

  // 3. 确保 bash.exe 可用（terminal 工具依赖）
  await ensureGitBash()

  // 4. 同步 skills（首次，后续按清单增量同步）
  await syncBundledSkillsIfNeeded()

  // 5. 后台可选：安装浏览器工具
  ensureBrowserTools()  // fire-and-forget, 不阻塞启动

  // 6. spawn Python 后端
  return spawnBackend(backend)
}
```

## 关键注意事项

| 问题 | 解决方案 |
|------|----------|
| Embedded Python 默认禁用 site-packages | 修改 `python3xx._pth`：取消注释 `import site` + 添加 `..\site-packages` 行 |
| 嵌入式 Python 不含 pip | 构建时运行 `python -m ensurepip --default-pip` |
| 依赖安装耗时 | CI 中缓存 `resources/` 目录，按 `pyproject.toml` hash 更新 |
| 磁盘空间（Python + 依赖 ~200MB） | Windows installer 可以接受，NSIS 可压缩到 ~80MB |
| 路径中有空格 | spawn 时用 `shell: false`，args 数组自动处理引号 |
| hermes update 行为 | bundled 模式通过 electron-updater 更新整个 app，不走 `hermes update` |
| terminal 工具需要 bash.exe | 首次运行时安装 PortableGit 到 `HERMES_HOME/git/`（策略 A），或检查系统 Git |
| 浏览器工具（Node.js + Playwright） | 首次运行时后台安装；不阻塞启动；Playwright Chromium ~170MB 需下载缓存 |
| submodule 内容 | `bundle-hermes.cjs` 在复制前确保 submodule checkout 完成；或在 CI 中预处理 |
| 技能（skills）首次同步 | 首次运行时从 bundled `resources/hermes/skills/` 同步到 `HERMES_HOME/skills/` |
| HERMES_HOME 目录结构初始化 | 首次运行时创建 cron/sessions/logs/skills/memories 等子目录 |
| .env / config.yaml 模板 | 首次运行时若不存在则从 bundled 模板复制（或生成最小默认） |
| HERMES_NO_BOOTSTRAP 尚未实现 | 当前不在任何 Python 代码中检查；bootstrap 防护依赖 `main.cjs` 侧判断 |
| 构建时依赖过时 | `installPython()` 应检查 `pyproject.toml` 变更（hash 或 mtime），而非仅检查 `python.exe` 存在 |

---

## 文件改动清单

| 文件 | 操作 | 改动量 | 说明 |
|------|------|--------|------|
| `apps/desktop/scripts/bundle-python.cjs` | 新增 | ~220 行 | 下载 Python + pip install[all] + 基准导入验证 |
| `apps/desktop/scripts/bundle-hermes.cjs` | 新增 | ~100 行 | submodule checkout + 源码复制 |
| `apps/desktop/electron/main.cjs` | 修改 | ~120 行 | bundled backend 解析 + 首次运行初始化（Git/bash.exe、skills sync、目录结构） |
| `apps/desktop/package.json` | 修改 | +5 行 | dist:win 脚本 + extraResources |
| `pyproject.toml` | 确认 | — | 确认 `[all]` extra 完整 |

---

## CI 构建优化

首次完整打包耗时约 5-10 分钟（下载 Python + pip install），建议：

```yaml
# .github/workflows/desktop-bundle.yml
- name: Cache Python bundle
  uses: actions/cache@v4
  with:
    path: apps/desktop/resources
    key: python-bundle-${{ hashFiles('pyproject.toml', 'uv.lock') }}
```

这样只在依赖文件变化时重新下载 Python 和安装包。