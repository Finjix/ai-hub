# AI Hub

Windows 桌面 skill 分发管理应用。Next.js + TypeScript + Electron 客户端，Next.js 管理后台及 API，SQLite 和服务器本地资源存储。

## 已实现

- 中文技能广场：搜索、说明、安装。
- 已安装管理：区分 AI Hub 和外部资源，仅卸载本应用管理的 skill。
- 启动自动更新 skill，直接覆盖本地修改；下载校验失败或文件替换中断时保留/恢复旧版本。
- 管理后台：ZIP 上传、元数据编辑、草稿发布、版本撤回、资源归档。
- Windows 应用更新：启动自动检测及下载，点击“重启更新”后升级。
- 服务端便携包：内置 Node.js 24.21.0，无需在目标机器安装环境。

首版客户端与管理后台均免登录；不包含插件、MCP 或项目级安装。技能安装目标固定为当前用户的 `.codex/skills`，不改动 Codex 内置 `.system` 或外部安装目录。当前机器附带的 Codex 0.162.0-alpha.2 已通过隔离目录中的实际识别测试。

## 直接使用交付包

1. 解压 `artifacts/server/ai-hub-server-0.1.0-win-x64.zip`，运行其中的 `start-server.cmd`。
2. 浏览器访问 `http://localhost:3000/admin`，上传 ZIP，再点击发布版本。
3. 安装 `artifacts/desktop/AI-Hub-Setup-0.1.0.exe`。
4. 客户端填写 `http://服务器局域网IPv4:3000`，同机测试可使用 `http://127.0.0.1:3000`。
5. 在技能广场安装资源。后续发布更高版本，客户端下次启动就会自动覆盖升级。

可以使用 `artifacts/examples/review-helper-1.0.0.zip` 体验上传发布流程。它不会自动预装到服务器或用户电脑。

服务端数据、迁移和防火墙配置见 [便携服务端说明](docs/portable-server.md)。Windows 更新安装包目前未签名。

## 开发

构建和便携服务端运行时固定为 **Windows x64 Node.js 24.21.0**。客户端自身使用 Electron 内置运行时，不依赖系统 Node.js。

首次运行先执行 `npm ci`，之后可双击根目录的 `start-dev.cmd`，在同一个命令行窗口中同时启动服务端和桌面客户端（输出以 `[server]` / `[desktop]` 前缀区分，按 Ctrl+C 或关闭客户端会一并停止）。脚本会先结束当前项目已有的开发进程及其子进程；如果 3000/3001 端口被其他程序占用，会提示退出，不会误杀其他程序。启动失败时窗口保留错误信息。也可以按下面的命令手动启动。

```powershell
npm ci
npm run dev:server
```

另一个终端运行：

```powershell
npm run dev:desktop
```

如果包管理器跳过 Electron 二进制的安装脚本，可显式运行 `node node_modules/electron/install.js` 后重试。服务端默认监听 3000，客户端开发页面监听 3001。服务端可通过 `AI_HUB_DATA_DIR` 指定持久化数据目录。

```powershell
npm test
npm run typecheck
npm run build
npm run smoke:server
npm run smoke:desktop
npm run package:desktop
npm run package:server
node scripts/smoke-server.mjs --portable
```

源码结构：`apps/desktop` 为页面与 Electron 主进程，`apps/server` 为后台与 API，`packages/shared` 为类型和归档校验。

当前交付已通过 21 项自动化测试、TypeScript 检查、真实 Electron 界面流程和便携服务端验证。真实 NSIS 安装包的 `0.1.0 → 0.1.1` 更新也已验证，包括确认重启、静默安装、自动重启和用户数据保留；验证记录在 `artifacts/verification/updater.json`。

如需重跑当前交付版本的安装包更新验证，先生成独立的测试新版，再运行测试（不会修改源码版本号）：

```powershell
node node_modules/electron-builder/cli.js --projectDir apps/desktop --win nsis --x64 --publish never --config.directories.output=../../artifacts/updater-test/v2 --config.extraMetadata.version=0.1.1
npm run smoke:updater
```

该测试仅在当前用户没有 AI Hub 安装及用户数据时运行，使用临时目录，结束后卸载测试安装。正式发布文件位于 `artifacts/desktop`，不要将 `artifacts/updater-test` 中的验证制品当作正式版本发布。

## 发布新客户端版本

```powershell
npm version patch -w @ai-hub/desktop --no-git-tag-version
npm run package:desktop
```

在后台的“桌面端更新”一次上传同次构建生成的 `.exe`、`.exe.blockmap` 与 `latest.yml`。后台校验大小与 SHA-512、拒绝旧版本和复用历史制品文件名，再切换线上更新清单。历史制品保留，供尚在下载的客户端使用。

启动脚本运行的是已构建生产服务，不会在目标机器执行 npm 安装。生成便携包时默认复制当前 Node.exe；也可用 `AI_HUB_NODE_EXE` 指定 Node.js 24.21.0 运行时。打包脚本不会删除已有服务端数据目录。
