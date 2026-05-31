# 修改记录：desktop-bundled-python-design.md

## 严重错误修复

### 1. 入口包名错误（原 line 455-462, 371）
- **原**: `from hermes.cli import main`，创建 `hermes/__main__.py`
- **改**: 使用 `-m hermes_cli.main`（与现有 `createPythonBackend` 一致）
- **原因**: 代码库中没有 `hermes/` 包，CLI 入口是 `hermes_cli.main:main`

### 2. `requirements.txt` 不存在（原 line 226）
- **原**: `pip install -r requirements.txt`
- **改**: `pip install <repoRoot>` 安装 hermes-agent 包（解析 pyproject.toml 依赖）
- **原因**: 项目使用 `pyproject.toml` + `uv.lock`，不存在 `requirements.txt`

### 3. `--no-deps` 阻止依赖安装（原 line 228）
- **原**: `--no-deps` 标记
- **改**: 移除该标记
- **原因**: `--no-deps` 表示不安装传递依赖，会导致运行时缺失大量包

### 4. 嵌入式 Python 不含 pip（原 lines 159-234）
- **原**: 未处理 pip 安装
- **改**: 新增 `python -m ensurepip --default-pip` 步骤
- **原因**: python.org 的 embeddable zip 不包含 pip 模块

### 5. EXCLUDE 集合尾部斜杠错误（原 lines 282-301）
- **原**: EXCLUDE 用 `'node_modules/'`、`'apps/'` 等带斜杠名称
- **改**: 去掉尾部斜杠（`'node_modules'`、`'apps'`），新增 `EXCLUDE_GLOB` 处理 `.pyc`/`.egg-info` 模式
- **原因**: `fs.readdirSync` 返回名称不含尾部斜杠，导致所有匹配失败

### 6. `_pth` 文件处理不完整（原 lines 197-206）
- **原**: 仅取消注释 `import site`，文件名硬编码 `python312._pth`
- **改**: 参数化 `_pth` 文件名，额外添加 `..\\site-packages` 到 `_pth` 中
- **原因**: `_pth` 控制 `sys.path`，不添加路径则 `import site` 后仍找不到 `site-packages/` 下的包

### 7. Python 版本不一致（原 line 177）
- **原**: `PYTHON_VERSION = '3.12.8'`
- **改**: `PYTHON_VERSION = '3.11.9'`，添加注释说明需与 python.org 发布的版本对应
- **原因**: `install.ps1` 使用 Python 3.11，文档声称保持一致却用了 3.12

### 8. "Tauri" 提及错误（原 line 63）
- **原**: "通过 Tauri 内置 updater 更新整个应用"
- **改**: "通过 electron-updater 更新整个应用"
- **原因**: 项目使用 Electron + electron-builder，不是 Tauri

## 重要遗漏修复

### 9. `HERMES_NO_BOOTSTRAP` 不存在（原 lines 219, 376）
- **原**: 多处设置 `HERMES_NO_BOOTSTRAP: '1'`，暗示代码会响应此变量
- **改**: 添加注释说明当前无 Python 代码检查该变量，实际防护依赖 `main.cjs` 侧判断；在关键注意事项表中补充说明

### 10. 内置 Python 的解析优先级错误（原 line 354）
- **原**: bundled 检查放在 `bootstrap-needed` 之前的最末尾
- **改**: 移至 `IS_PACKAGED` 检查中，排在 dev source 之后、PATH/venv 检查之前
- **原因**: 打包后的应用必须优先使用内置 Python，而非可能过时的系统安装

### 11. `_pth` 文件名硬编码（原 line 199）
- **原**: 硬编码 `python312._pth`
- **改**: 参数化为 `python${PYTHON_VERSION.majorMinor}._pth`，添加报错处理

### 12. 缺少 `PYTHONHOME` 环境变量（原 lines 366-388）
- **原**: 未设置 `PYTHONHOME`
- **改**: 在 spawn env 中添加 `PYTHONHOME = bundledPythonHome`
- **原因**: Windows 嵌入式 Python 通常需要 `PYTHONHOME` 定位标准库

### 13. `sys.path.insert` 与 `PYTHONPATH` 冗余（原 lines 370-376）
- **原**: 同时在 args 中用 `-c "import sys; sys.path.insert(...)"` 和 env 中设 `PYTHONPATH`
- **改**: 移除 args 中的 `-c` 内联代码，仅通过 `PYTHONPATH` 和 `-m hermes_cli.main` 启动

### 14. 第 5 步和第 3 步方案矛盾
- **原**: Step 5 建议创建 `hermes/__main__.py` + `-m hermes`，Step 3 用 `-c` 内联代码
- **改**: 统一为 `-m hermes_cli.main` 入口，删除 `hermes/__main__.py` 创建步骤

## 次要修正

### 15. `install-stamp.json` 路径混乱（Step 7）
- **原**: 引用 `resources/install-stamp.json` 和 `build/install-stamp.json` 两个路径
- **改**: 明确运行时路径为 `process.resourcesPath/install-stamp.json`，与 extraResources 映射一致

### 16. 构建脚本位置调整
- **原**: `bundle-python.cjs` 和 `bundle-hermes.cjs` 加在 `build` 脚本中
- **改**: 移至 `dist:win` 脚本，`build` 保持为开发构建（`tsc -b && vite build`）
- **原因**: 开发模式下不需要嵌入 Python，嵌入步骤属于分发打包阶段

### 17. CI 缓存键更新
- **原**: `hashFiles('pyproject.toml', 'requirements.txt')`
- **改**: `hashFiles('pyproject.toml', 'uv.lock')`
- **原因**: 项目使用 `uv.lock` 锁定依赖版本

### 18. 文件改动清单更新
- **原**: 包含不存在的 `hermes/__main__.py`
- **改**: 移除该项，调整行数估算

### 19. 新增注意事项
- 构建时依赖过时：`installPython()` 应根据 `pyproject.toml` hash/mtime 而非仅 `python.exe` 存在来判断
- `HERMES_NO_BOOTSTRAP` 尚未在 Python 代码中实现
- 嵌入式 Python 不含 pip 需通过 `ensurepip` 引导

## 对标 install.ps1 补充遗漏（第二轮审查）

### 20. pip install 缺少 [all] extras
- **原**: `pip install "${repoRoot}"` 仅安装基础依赖，不含 `fastapi`、`uvicorn`、messaging SDK 等
- **改**: `pip install "${repoRoot}[all]"` 对标 install.ps1 的 `uv sync --extra all`
- **原因**: 缺少 extras 会导致 dashboard、messaging 等功能不可用

### 21. 遗漏 Git/bash.exe 依赖
- **问题**: `terminal` 工具在 Windows 上需要 bash.exe（来自 Git for Windows）；install.ps1 的 Stage-Git 安装 PortableGit 提供此能力
- **改**: 新增 Step 9b，描述两种策略：安装 PortableGit 到 `HERMES_HOME/git/`（推荐）或检测系统 Git

### 22. 遗漏 Node.js + 浏览器工具
- **问题**: browser_* 工具依赖 npm install + Playwright Chromium（~170MB）；install.ps1 的 Stage-Node + Stage-NodeDeps 处理此事
- **改**: 新增 Step 9c，描述首次运行时后台安装策略（不阻塞启动）

### 23. 遗漏 submodule 内容
- **问题**: bundled 源码快照使用 `fs.copyFileSync` 复制，子目录若为空（submodule 未 checkout）则内容缺失
- **改**: `bundle-hermes.cjs` 增加 `git submodule update --init --recursive` 步骤；添加 try/catch 优雅降级

### 24. 遗漏 Skills 首次同步
- **问题**: install.ps1 的 Stage-ConfigTemplates 调用 `tools/skills_sync.py` 将 bundled skills 复制到 `HERMES_HOME/skills/`
- **改**: 新增 Step 9d，描述首次运行时 skills 同步策略

### 25. 遗漏 HERMES_HOME 目录结构初始化
- **问题**: install.ps1 的 Copy-ConfigTemplates 创建 cron/sessions/logs/skills/memories 等目录
- **改**: 新增 Step 9a，`ensureHermesHomeStructure()` 函数

### 26. 遗漏基准导入验证
- **问题**: install.ps1 在 Install-Dependencies 末尾验证 `dotenv, openai, rich, prompt_toolkit` 和 `fastapi, uvicorn` 可导入
- **改**: `bundle-python.cjs` 增加 `verifyBaselineImports()` 函数，构建时及早发现依赖问题
