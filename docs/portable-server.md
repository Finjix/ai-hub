# AI Hub 便携服务端

本目录包含 Windows x64 Node.js 24.21.0 和完整生产服务，无需安装 Node.js、npm 或数据库。

1. 解压到有写入权限的目录，不要直接在 ZIP 内运行。
2. 双击 `start-server.cmd`。窗口保持运行，关闭窗口或按 Ctrl+C 会停止服务。
3. 在本机打开 `http://localhost:3000/admin`。
4. 其他局域网电脑在客户端填写 `http://本机局域网IPv4:3000`。IP 可以在本机执行 `ipconfig` 查看。
5. 如果 Windows 防火墙阻止访问，为便携 `runtime/node.exe` 允许专用网络访问，或放行入站 TCP 3000。

后台和客户端均免登录，局域网访问者可发布资源，这是首版指定行为。

## 数据与升级

`data` 包含 SQLite 数据库、skill 包、客户端更新文件和日志。升级服务端时，先停止旧服务，再将整个 `data` 复制到新版本目录，最后启动新版本。不要在服务运行时只复制 SQLite 主文件；WAL 文件可能尚未合并。复制整个已停止服务的数据目录即可保留服务器标识和发布记录。

日志位于 `data/logs/server.log`。客户端安装位置与数据存储在各自用户电脑上，服务端升级不会删除它们。

默认端口 3000。如需换端口，在命令提示符中先执行 `set PORT=3002`，再运行 `start-server.cmd`，同时修改客户端服务器地址。

服务端默认手动启动；如需随 Windows 登录启动，可将 `start-server.cmd` 的快捷方式加入当前用户的启动目录。

## 发布资源

Skill ZIP 每包一个 skill：根目录或唯一顶级目录内放置 `SKILL.md`，frontmatter 必须包含 `name` 与 `description`。上传后为草稿，点击发布才会进入客户端技能广场。版本采用 `1.0.0` 等标准 SemVer，同一版本不可覆盖。

应用更新上传同一构建的 `AI-Hub-Setup-版本.exe`、对应 `.exe.blockmap` 与 `latest.yml`。后台验证大小和 SHA-512 后发布。客户端启动自动下载，用户点击“重启更新”才会安装。

## 安装目录

客户端按当前项目要求写入 Windows 当前用户的 `.codex/skills`。请在实际使用的 Codex 中确认能识别该目录。新版官方文档使用 `.agents/skills`，本应用首版不会自动迁移或同步到该目录。
