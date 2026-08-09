# Verification Evidence

## Product checks

- Windows Node 24.18.0 与隔离 Node 22.23.2: typecheck、lint、77/77 Node 测试通过；真实 tarball 隔离安装通过两个 bin、npx、apply、status、hook、MCP initialize 和 unapply，PATH 不含 Python/Cargo/Rust。
- WSL Node 24.14.0 与隔离 Linux Node 22.23.2: typecheck、lint、76 个 Node 测试通过，1 个 Windows-only shim 测试按设计跳过；tarball 隔离安装通过，PATH 不含 Python/Cargo/Rust。
- Node 22 首轮暴露更新超时计时器被 `unref()` 后可能提前结束事件循环；移除 `unref()` 后 Windows/WSL Node 22 均复跑通过。
- Python migration-oracle suite: Windows 与 WSL 均为 105/105 通过。
- WSL 首轮借用 Windows npm CLI 时继承了跨系统 cache 路径；烟测现从第一条 npm 命令起使用临时 cache，复跑后仓库未再生成异常目录。
- npm registry: `npm view multi-teammates-agents version dist-tags --json` 返回 E404；这说明当前公开 registry 未返回该包或当前账号无读取权限。本任务没有执行 publish，也不把 E404 单独当作最终所有权证明。

## Real host evidence

- Codex CLI 0.147.0 direct read-only Episode 通过。
- Codex real managed E2E 通过：隔离项目、1 轮、4 个唯一 Episode、Manager → Executor → independent read-only Auditor → completion；verified evidence 确认 `evidence.txt` 为 `ALPHA`。
- 该 E2E 首轮暴露 `read-token` 被字段脱敏误伤的根因；修复为只对精确敏感字段名做字段级脱敏，并增加自动回归后复跑通过。
- Claude Code 2.1.220 可启动并产出 stream-json，但真实调用返回 `OAuth session expired and could not be refreshed`；最终只读 `claude auth status` 进一步确认 `loggedIn: false`、`authMethod: none`。未伪造 beta/stable 通过。

## CI evidence

- workflow 定义覆盖 `ubuntu-latest`、`windows-latest`、`macos-15-intel`、`macos-15` 与 Node 22/24。
- 官方 action release 核验后使用 `actions/checkout@v7` 和 `actions/setup-node@v6`；每个矩阵项执行 pack/install smoke。
- GitHub CLI 已具备仓库/workflow 权限，但本地分支领先远端；远端默认分支尚无该 workflow，`gh run list --workflow npm-control-plane.yml` 返回 HTTP 404。因此未擅自 push，远程矩阵仍无结果，rc gate 保持 false。
